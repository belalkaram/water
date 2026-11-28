require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { initDb, queryAll, queryOne, run, transaction } = require('./db');
const { parseExcelRows, ACTIVITY_TYPES } = require('./utils/centerParser');
const { parsePdfBuffer } = require('./utils/pdfParser');
const { parsePlanFile } = require('./utils/universalParser');
const { normalizePhone } = require('./utils/phone');
const { normalizePayload, hydrateInspection } = require('./utils/inspectionPayload');
const C = require('./constants');
const {
  previewMonthlyPlan, generateMonthlyPlan, carryOverUnfinished, ensureCurrentMonth, currentYm, monthLabel, ymFromLabel,
  runDailyPlanJob,
} = require('./utils/monthlyPlan');
const { buildPlanReport, buildPlanWorkbook, buildEstablishmentsWorkbook, reportFileName } = require('./utils/planExport');

const app = express();
const PORT = process.env.PORT || 4000;

// CORS headers for all requests + instant response for OPTIONS preflight
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-session-token');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'x-session-token'],
}));

app.use(express.json({ limit: '15mb' }));

// DB initialization helpers & middleware (runs before any routes)
let dbReady = false;
let dbInitPromise = null;

function ensureDb() {
  if (!process.env.DATABASE_URL) {
    const msg = 'متغير البيئة DATABASE_URL غير موجود في إعدادات Vercel! يرجى إضافته في إعدادات المشروع.';
    console.error('❌ ' + msg);
    return Promise.reject(new Error(msg));
  }
  if (!dbInitPromise) {
    dbInitPromise = initDb()
      .then(() => {
        dbReady = true;
      })
      .catch((err) => {
        dbInitPromise = null;
        console.error('❌ Failed to init DB:', err.message);
        throw err;
      });
  }
  return dbInitPromise;
}

app.use(async (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  try {
    if (!dbReady) {
      await ensureDb();
    }
    next();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 35 * 1024 * 1024 }, // 35MB max to support high-res multi-page scanned PDFs
});

// ─── Auth Middleware ──────────────────────────────────────────────────────────

// Session lifetime is a server-side policy only (never sent to or shown in the client).
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MINUTES || 60) * 60 * 1000;
const SESSION_ENDED = { error: 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى', code: 'SESSION_EXPIRED' };

function readToken(req) {
  const h = String(req.headers.authorization || '');
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return String(req.headers['x-session-token'] || '').trim();
}

async function authMiddleware(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json(SESSION_ENDED);
  try {
    const user = await queryOne(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`,
      [token, new Date().toISOString()]
    );
    if (!user) return res.status(401).json(SESSION_ENDED);
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin')
    return res.status(403).json({ error: 'هذا الإجراء متاح للأدمن فقط' });
  next();
}

// ─── City scoping (workers only see/touch their assigned centers) ─────────────

function parseCenters(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter((c) => C.OFFICIAL_CENTERS.includes(c)) : [];
  } catch { return []; }
}

// null = unrestricted (admin); otherwise the list of centers the user may access
function userCenters(user) {
  if (!user || user.role === 'admin') return null;
  return parseCenters(user.assigned_centers);
}

function canAccessCenter(user, center) {
  const list = userCenters(user);
  return list === null || list.includes(center);
}

// SQL fragment limiting a column to the user's centers. Empty list => matches nothing.
function centerScope(user, column = 'center') {
  const list = userCenters(user);
  if (list === null) return { sql: '', params: [] };
  if (list.length === 0) return { sql: ' AND 1 = 0', params: [] };
  return { sql: ` AND ${column} IN (${list.map(() => '?').join(',')})`, params: list };
}

function publicUser(u) {
  return {
    id: u.id, name: u.name, code: u.code, role: u.role, active: u.active,
    home_center: u.home_center || '', assigned_centers: parseCenters(u.assigned_centers),
  };
}

const FORBIDDEN_CENTER = { error: 'هذه المنشأة تابعة لمدينة غير مخصصة لك' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function logActivity({ plan_id, facility_id = null, facility_name, center = '', worker_id, worker_name, action, summary, inspection_id = null }) {
  await run(
    `INSERT INTO activity_feed (id, plan_id, facility_id, facility_name, center, worker_id, worker_name, action, summary, created_at, inspection_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), plan_id, facility_id, facility_name, center, worker_id, worker_name, action, summary, new Date().toISOString(), inspection_id]
  );
}

// ─── Main registry (establishments) helpers ───────────────────────────────────

// last visit = latest of (Excel baseline, the inspection day typed by the worker on the newest VALID 'inspected' inspection)
async function refreshLastVisit(codes) {
  const list = [...new Set(codes.filter(Boolean))];
  if (list.length === 0) return;
  await run(
    `UPDATE establishments e SET updated_at = ?, last_visit_date = GREATEST(COALESCE(e.baseline_visit_date, ''), COALESCE((
       SELECT MAX(COALESCE(NULLIF(i.visit_date, ''), SUBSTRING(i.created_at, 1, 10))) FROM inspections i JOIN facilities f ON f.id = i.facility_id
       WHERE f.facility_code = e.facility_code AND i.record_status = 'valid' AND i.visit_outcome = 'inspected'), ''))
     WHERE e.facility_code IN (${list.map(() => '?').join(',')})`,
    [new Date().toISOString(), ...list]
  );
}

async function purgeFeedForFacilities(facilityIds) {
  const ids = facilityIds.filter(Boolean);
  if (ids.length === 0) return;
  await run(`DELETE FROM activity_feed WHERE facility_id IN (${ids.map(() => '?').join(',')})`, ids);
}

// After an admin reopens / wipes inspections: re-derive last visit, and on wipe erase them from the team feed
async function finishReopen(facilities, wipe) {
  await refreshLastVisit(facilities.map((f) => f.facility_code));
  if (wipe) await purgeFeedForFacilities(facilities.map((f) => f.id));
}

async function attachLastVisit(rows) {
  const codes = [...new Set(rows.map((r) => r.facility_code).filter(Boolean))];
  if (codes.length === 0) return rows;
  const found = await queryAll(
    `SELECT facility_code, last_visit_date FROM establishments WHERE facility_code IN (${codes.map(() => '?').join(',')})`, codes
  );
  const map = Object.fromEntries(found.map((e) => [e.facility_code, e.last_visit_date || '']));
  return rows.map((r) => ({ ...r, last_visit_date: map[r.facility_code] || '' }));
}

function nextYm() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return currentYm(d);
}

// Put a rejected facility back into the registry as "due" and into next month's plan
async function queueForNextMonth(facility) {
  let est = await queryOne('SELECT * FROM establishments WHERE facility_code = ?', [facility.facility_code]);
  const now = new Date().toISOString();
  if (!est && C.OFFICIAL_CENTERS.includes(facility.center)) {
    await run(
      `INSERT INTO establishments (id, facility_code, name, address, center, activity_type, is_active, last_visit_date, baseline_visit_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, '', '', ?, ?)`,
      [uuidv4(), facility.facility_code, facility.name, facility.address || '', facility.center, facility.activity_type || '', now, now]
    );
    est = await queryOne('SELECT * FROM establishments WHERE facility_code = ?', [facility.facility_code]);
  }
  if (!est || !est.is_active) return { queued: false };
  const ym = nextYm();
  const plan = await queryOne('SELECT * FROM plans WHERE plan_month = ?', [ym]);
  if (!plan) {
    await run('UPDATE establishments SET reinspect_flag = 1, updated_at = ? WHERE id = ?', [now, est.id]);
    return { queued: true, month: ym, inserted: false };
  }
  const already = await queryOne('SELECT id FROM facilities WHERE plan_id = ? AND facility_code = ?', [plan.id, est.facility_code]);
  if (!already) {
    const max = await queryOne('SELECT COALESCE(MAX(serial_no), 0) AS m FROM facilities WHERE plan_id = ?', [plan.id]);
    await run(
      `INSERT INTO facilities (id, plan_id, serial_no, name, address, center, facility_code, target_date, plan_notes, activity_type, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', 'أُعيدت بعد رفض المعاينة', ?, 'available', ?)`,
      [uuidv4(), plan.id, Number(max.m) + 1, est.name, est.address || '', est.center, est.facility_code, est.activity_type || '', now]
    );
    await run('UPDATE plans SET total_facilities = total_facilities + 1 WHERE id = ?', [plan.id]);
  }
  await run('UPDATE establishments SET reinspect_flag = 0, updated_at = ? WHERE id = ?', [now, est.id]);
  return { queued: true, month: ym, inserted: !already };
}

async function expireStaleReservations(planId) {
  const cutoff = new Date(Date.now() - C.RESERVATION_TTL_HOURS * 3600 * 1000).toISOString();
  const stale = planId
    ? await queryAll("SELECT * FROM facilities WHERE plan_id = ? AND status = 'reserved' AND reserved_at < ?", [planId, cutoff])
    : await queryAll("SELECT * FROM facilities WHERE status = 'reserved' AND reserved_at < ?", [cutoff]);

  for (const f of stale) {
    const now = new Date().toISOString();
    await run(
      `UPDATE facilities SET status = 'available', reserved_by_id = NULL, reserved_by_name = NULL, reserved_at = NULL, updated_at = ? WHERE id = ?`,
      [now, f.id]
    );
    await logActivity({
      plan_id: f.plan_id, facility_id: f.id, facility_name: f.name, center: f.center,
      worker_id: f.reserved_by_id || 'system', worker_name: f.reserved_by_name || 'النظام',
      action: 'expired',
      summary: `انتهت مدة الحجز المؤقت (${C.RESERVATION_TTL_HOURS} ساعات) وعاد ${f.name} متاحاً`,
    });
  }
  return stale.length;
}

// A facility inspected late in an older plan (e.g. offline sync after the month rolled over) may already have
// been carried into a later plan. Remove those later copies while nobody has started on them.
async function dropLaterOpenCopies(facility) {
  const plan = await queryOne('SELECT plan_month FROM plans WHERE id = ?', [facility.plan_id]);
  if (!plan || !plan.plan_month) return 0;
  const copies = await queryAll(
    `SELECT f.id, f.plan_id FROM facilities f JOIN plans p ON p.id = f.plan_id
     WHERE f.facility_code = ? AND f.id <> ? AND f.status = 'available' AND p.plan_month > ?
       AND NOT EXISTS (SELECT 1 FROM inspections i WHERE i.facility_id = f.id)`,
    [facility.facility_code, facility.id, plan.plan_month]
  );
  for (const c of copies) {
    await run('DELETE FROM activity_feed WHERE facility_id = ?', [c.id]);
    await run('DELETE FROM facilities WHERE id = ?', [c.id]);
    await run('UPDATE plans SET total_facilities = GREATEST(0, total_facilities - 1) WHERE id = ?', [c.plan_id]);
  }
  return copies.length;
}

async function recordInspection(facility, user, payload, createdAt, { viaSync = false } = {}) {
  if (payload.client_id) {
    const dup = await queryOne('SELECT * FROM inspections WHERE client_id = ?', [payload.client_id]);
    if (dup) {
      return {
        result: 'duplicate',
        inspection: hydrateInspection(dup),
        facility: await queryOne('SELECT * FROM facilities WHERE id = ?', [facility.id]),
      };
    }
  }

  const now = new Date().toISOString();
  const inspId = uuidv4();
  const isConflict = facility.status === 'completed';
  const outcomeLabel = C.OUTCOME_LABELS[payload.visit_outcome];
  const totalCount = payload.samples.reduce((acc, s) => acc + s.count, 0);

  await transaction(async ({ run: tRun }) => {
    await tRun(
      `INSERT INTO inspections
       (id, facility_id, plan_id, worker_id, worker_name, samples_json, notes, gps_lat, gps_lng, gps_accuracy, signature_base64,
        created_at, synced_at, visit_outcome, compliance_json, violation_level, representative_name, representative_phone,
        followup_required, followup_date, client_id, record_status, visit_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?)`,
      [
        inspId, facility.id, facility.plan_id, user.id, user.name, JSON.stringify(payload.samples), payload.notes,
        payload.gps_lat, payload.gps_lng, payload.gps_accuracy, payload.signature_base64,
        createdAt || now, now,
        payload.visit_outcome, JSON.stringify(payload.compliance), payload.violation_level,
        payload.representative_name, payload.representative_phone,
        payload.client_id || '',
        isConflict ? 'conflict' : 'valid',
        payload.visit_date || '',
      ]
    );
    if (!isConflict) {
      await tRun(
        `UPDATE facilities
         SET status = 'completed', completed_by_id = ?, completed_by_name = ?, completed_at = ?,
             visit_outcome = ?,
             reserved_by_id = COALESCE(reserved_by_id, ?),
             reserved_by_name = COALESCE(reserved_by_name, ?),
             updated_at = ? WHERE id = ?`,
        [user.id, user.name, createdAt || now, payload.visit_outcome, user.id, user.name, now, facility.id]
      );
    }
  });

  if (!isConflict && payload.visit_outcome === 'inspected') {
    await refreshLastVisit([facility.facility_code]);
    await run('UPDATE establishments SET reinspect_flag = 0 WHERE facility_code = ?', [facility.facility_code]);
    await dropLaterOpenCopies(facility);
  }

  const summary = payload.visit_outcome === 'inspected'
    ? `أتم المعاينة${viaSync ? ' (متزامن)' : ''} في ${facility.name} بتاريخ ${payload.visit_date} (${payload.samples.length} نوع / ${totalCount} عينة)` +
      (payload.violation_level !== 'none' ? ` — مخالفة ${C.LEVEL_LABELS[payload.violation_level]}` : '')
    : `زيارة ${facility.name}: ${outcomeLabel}`;

  await logActivity({
    plan_id: facility.plan_id, facility_id: facility.id, facility_name: facility.name, center: facility.center,
    worker_id: user.id, worker_name: user.name, action: 'completed',
    summary: isConflict ? `⚠️ معاينة مكررة محفوظة للمراجعة — ${summary}` : summary,
    inspection_id: inspId,
  });

  return {
    result: isConflict ? 'conflict' : 'applied',
    inspection: hydrateInspection(await queryOne('SELECT * FROM inspections WHERE id = ?', [inspId])),
    facility: await queryOne('SELECT * FROM facilities WHERE id = ?', [facility.id]),
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Root
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html><html dir="rtl" lang="ar">
    <head><meta charset="UTF-8"><title>الإدارة العامة للصرف الصناعي — API</title>
    <style>body{font-family:sans-serif;max-width:600px;margin:60px auto;padding:20px;background:#f9fafb}
    h1{color:#1d4ed8}code{background:#e5e7eb;padding:2px 6px;border-radius:4px}
    .ok{color:#16a34a;font-weight:bold}ul{line-height:2}</style></head>
    <body>
      <h1>🏭 الإدارة العامة للصرف الصناعي — Backend</h1>
      <p class="ok">✅ السيرفر يعمل بنجاح — قاعدة البيانات: PostgreSQL (Neon)</p>
      <h3>Endpoints الرئيسية:</h3>
      <ul>
        <li><code>POST /api/auth/login</code> — تسجيل الدخول</li>
        <li><code>GET  /api/plans</code> — الخطط الشهرية</li>
        <li><code>GET  /api/plans/:id/facilities</code> — المنشآت</li>
        <li><code>GET  /api/health</code> — فحص الحالة</li>
      </ul>
      <p style="color:#6b7280;font-size:14px">الوقت: ${new Date().toLocaleString('ar-EG')}</p>
    </body></html>
  `);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'menoufia-inspections-backend', time: new Date().toISOString() });
});

// Login by code
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'أدخل كود الدخول' });
    const user = await queryOne('SELECT * FROM users WHERE UPPER(code) = ? AND active = 1', [code]);
    if (!user) return res.status(401).json({ error: 'الكود غير مسجل. تواصل مع الأدمن للحصول على كودك.' });
    const now = new Date();
    const token = crypto.randomBytes(32).toString('hex');
    await run('DELETE FROM sessions WHERE expires_at < ?', [now.toISOString()]);
    await run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [
      token, user.id, now.toISOString(), new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    ]);
    res.json({ user: publicUser(user), token });
  } catch (err) { next(err); }
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    const token = readToken(req);
    if (token) await run('DELETE FROM sessions WHERE token = ?', [token]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Admin: list workers
app.get('/api/workers', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const rows = await queryAll("SELECT * FROM users WHERE role = 'worker' ORDER BY created_at DESC");
    res.json({ workers: rows.map((w) => ({ ...publicUser(w), created_at: w.created_at })), centers: C.OFFICIAL_CENTERS });
  } catch (err) { next(err); }
});

function validateWorkerBody(body) {
  const name = String(body.name || '').trim();
  const code = String(body.code || '').trim().toUpperCase();
  const assigned = Array.isArray(body.assigned_centers) ? [...new Set(body.assigned_centers.map(String))] : [];
  if (!name || !code) return { error: 'الاسم والكود مطلوبان' };
  if (assigned.length === 0) return { error: 'اختر مدينة واحدة على الأقل للموظف' };
  const bad = assigned.filter((c) => !C.OFFICIAL_CENTERS.includes(c));
  if (bad.length) return { error: `مدن غير معتمدة: ${bad.join('، ')}` };
  let home = String(body.home_center || '').trim();
  if (!home) home = assigned[0];
  if (!assigned.includes(home)) return { error: 'المنطقة الأساسية يجب أن تكون ضمن المدن المخصصة' };
  return { name, code, assigned, home };
}

// Admin: create worker
app.post('/api/workers', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const v = validateWorkerBody(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const exists = await queryOne('SELECT id FROM users WHERE UPPER(code) = ?', [v.code]);
    if (exists) return res.status(409).json({ error: 'هذا الكود مستخدم بالفعل' });
    const id = uuidv4();
    const now = new Date().toISOString();
    await run(
      'INSERT INTO users (id, name, code, role, active, created_at, assigned_centers, home_center) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
      [id, v.name, v.code, 'worker', now, JSON.stringify(v.assigned), v.home]
    );
    res.status(201).json({ worker: { id, name: v.name, code: v.code, role: 'worker', active: 1, created_at: now, home_center: v.home, assigned_centers: v.assigned } });
  } catch (err) { next(err); }
});

// Admin: update worker (name, code, centers)
app.put('/api/workers/:id', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const worker = await queryOne("SELECT * FROM users WHERE id = ? AND role = 'worker'", [req.params.id]);
    if (!worker) return res.status(404).json({ error: 'الموظف غير موجود' });
    const v = validateWorkerBody(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const clash = await queryOne('SELECT id FROM users WHERE UPPER(code) = ? AND id <> ?', [v.code, worker.id]);
    if (clash) return res.status(409).json({ error: 'هذا الكود مستخدم بالفعل' });
    await run('UPDATE users SET name = ?, code = ?, assigned_centers = ?, home_center = ? WHERE id = ?',
      [v.name, v.code, JSON.stringify(v.assigned), v.home, worker.id]);
    // Release temporary reservations in cities the worker no longer covers
    await run(
      `UPDATE facilities SET status = 'available', reserved_by_id = NULL, reserved_by_name = NULL, reserved_at = NULL, updated_at = ?
       WHERE status = 'reserved' AND reserved_by_id = ? AND center NOT IN (${v.assigned.map(() => '?').join(',')})`,
      [new Date().toISOString(), worker.id, ...v.assigned]
    );
    res.json({ worker: { id: worker.id, name: v.name, code: v.code, role: 'worker', active: worker.active, created_at: worker.created_at, home_center: v.home, assigned_centers: v.assigned } });
  } catch (err) { next(err); }
});

// Admin: delete worker (past inspections keep the worker's name)
app.delete('/api/workers/:id', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const worker = await queryOne("SELECT * FROM users WHERE id = ? AND role = 'worker'", [req.params.id]);
    if (!worker) return res.status(404).json({ error: 'الموظف غير موجود' });
    await run(
      `UPDATE facilities SET status = 'available', reserved_by_id = NULL, reserved_by_name = NULL, reserved_at = NULL, updated_at = ?
       WHERE status = 'reserved' AND reserved_by_id = ?`,
      [new Date().toISOString(), worker.id]
    );
    await run('DELETE FROM users WHERE id = ?', [worker.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Admin: toggle worker active/inactive
app.patch('/api/workers/:id/toggle', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const worker = await queryOne("SELECT * FROM users WHERE id = ? AND role = 'worker'", [req.params.id]);
    if (!worker) return res.status(404).json({ error: 'الموظف غير موجود' });
    const nextActive = worker.active ? 0 : 1;
    await run('UPDATE users SET active = ? WHERE id = ?', [nextActive, worker.id]);
    res.json({ id: worker.id, active: nextActive });
  } catch (err) { next(err); }
});

// Domain constants
app.get('/api/meta', authMiddleware, (req, res) => {
  res.json({
    visit_outcomes: C.OUTCOME_LABELS,
    violation_levels: C.LEVEL_LABELS,
    compliance: C.COMPLIANCE_LABELS,
    reservation_ttl_hours: C.RESERVATION_TTL_HOURS,
    centers: userCenters(req.user) === null ? C.OFFICIAL_CENTERS : userCenters(req.user),
    all_centers: C.OFFICIAL_CENTERS,
  });
});

// List plans
app.get('/api/plans', authMiddleware, async (req, res, next) => {
  try {
    // Safety net: if the cron missed the 1st of the month, create this month's plan on first access.
    // Also moves whatever was left unfinished last month into this month's plan (idempotent).
    try { await ensureCurrentMonth(); } catch (e) { console.error('auto plan:', e.message); }
    const plans = await queryAll('SELECT * FROM plans ORDER BY created_at DESC');
    res.json({ plans });
  } catch (err) { next(err); }
});

// Admin: preview / generate a monthly plan from the permanent establishments registry
app.get('/api/plans/monthly/preview', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const ym = String(req.query.month || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return res.status(400).json({ error: 'صيغة الشهر غير صحيحة (YYYY-MM)' });
    res.json(await previewMonthlyPlan(ym));
  } catch (err) { next(err); }
});

app.post('/api/plans/generate-monthly', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const ym = String(req.body.month || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return res.status(400).json({ error: 'صيغة الشهر غير صحيحة (YYYY-MM)' });
    const out = await generateMonthlyPlan(ym, { generatedBy: 'manual', userName: req.user.name });
    if (!out.created) {
      return res.status(409).json({ error: out.empty ? 'لا توجد منشآت مستحقة في هذا الشهر' : `${monthLabel(ym)} موجودة بالفعل` });
    }
    res.status(201).json({ plan: out.plan, inserted: out.total, carried: out.carried || 0 });
  } catch (err) { next(err); }
});

// Admin: move what is left of the previous month's plan into the given month (default: current month)
app.post('/api/plans/carry-over', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const ym = String(req.body.month || currentYm());
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return res.status(400).json({ error: 'صيغة الشهر غير صحيحة (YYYY-MM)' });
    const out = await carryOverUnfinished(ym, { userName: req.user.name, userId: req.user.id });
    if (out.reason === 'no_plan') return res.status(404).json({ error: `لا توجد ${monthLabel(ym)} بعد — ولّدها أولاً` });
    res.json({ month: ym, carried: out.carried, from: out.from || null });
  } catch (err) { next(err); }
});

// Vercel Cron (1st of every month) — protected by CRON_SECRET
app.get('/api/cron/monthly-plan', async (req, res, next) => {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
    // runs daily; on the last day of the month it also prepares next month's plan
    res.json(await runDailyPlanJob());
  } catch (err) { next(err); }
});

// Upload plan (Excel or PDF) with granular Multer error handling
app.post(
  '/api/plans/upload',
  authMiddleware,
  adminOnly,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'حجم الملف يتجاوز الحد الأقصى المسموح به (35 ميجابايت). يرجى تقليل حجم الملف أو ضغطه والمحاولة مجدداً.',
          });
        }
        return res.status(400).json({ error: 'خطأ في استقبال الملف: ' + err.message });
      } else if (err) {
        return res.status(400).json({ error: 'فشل قراءة الملف المرفوع: ' + err.message });
      }
      next();
    });
  },
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'يرجى اختيار ملف الخطة (.xlsx أو .xls أو .csv أو .pdf)' });
    }

    try {
      const { parsed, detectedMonth } = await parsePlanFile(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

      if (!parsed || parsed.length === 0) {
        return res.status(400).json({
          error:
            'لم يتم العثور على منشآت مطابقة في الملف. تأكد من احتواء الجدول على الأعمدة الرئيسية: (التسلسل، مسمى المنشأة الصناعية، العنوان، كود المنشأة، تاريخ الإنجاز).',
        });
      }

      let monthLabel = String(req.body.month_label || '').trim();
      if (!monthLabel) {
        monthLabel = detectedMonth || `خطة ${new Date().toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' })}`;
      }

      if (await queryOne('SELECT id FROM plans WHERE month_label = ?', [monthLabel])) {
        return res.status(409).json({
          error: `توجد خطة بنفس الاسم "${monthLabel}" بالفعل. غيّر اسم الشهر (مثال: ${monthLabel} - محدث) لتجنب تكرار الخطة.`,
        });
      }

      // The registry is the source of truth for a facility's city: an uploaded file may say «قويسنا»
      // for a «قويسنا المنطقة الصناعية» facility, which would hide it from that city's filter.
      const codes = [...new Set(parsed.map((p) => p.facility_code).filter(Boolean))];
      if (codes.length) {
        const known = await queryAll(
          `SELECT facility_code, center FROM establishments WHERE facility_code IN (${codes.map(() => '?').join(',')})`, codes
        );
        const centerByCode = new Map(known.map((k) => [k.facility_code, k.center]));
        parsed.forEach((p) => { if (centerByCode.has(p.facility_code)) p.center = centerByCode.get(p.facility_code); });
      }

      const planId = uuidv4();
      const now = new Date().toISOString();
      // Give uploaded plans a calendar month (when the label names one that is still free) so carry-over works for them
      let planMonth = ymFromLabel(monthLabel);
      if (planMonth && (await queryOne('SELECT id FROM plans WHERE plan_month = ?', [planMonth]))) planMonth = null;

      await transaction(async ({ run: tRun }) => {
        await tRun(
          'INSERT INTO plans (id, month_label, filename, uploaded_by, total_facilities, created_at, plan_month, generated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [planId, monthLabel, req.file.originalname || 'plan.xlsx', req.user.name, parsed.length, now, planMonth, 'import']
        );

        const CHUNK_SIZE = 40;
        for (let i = 0; i < parsed.length; i += CHUNK_SIZE) {
          const chunk = parsed.slice(i, i + CHUNK_SIZE);
          const valueClauses = [];
          const params = [];
          for (const item of chunk) {
            valueClauses.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'available\', ?)');
            params.push(
              uuidv4(),
              planId,
              item.serial_no,
              item.name,
              item.address,
              item.center,
              item.facility_code,
              item.target_date,
              item.plan_notes,
              item.activity_type,
              now
            );
          }
          await tRun(
            `INSERT INTO facilities (id, plan_id, serial_no, name, address, center, facility_code, target_date, plan_notes, activity_type, status, updated_at)
             VALUES ${valueClauses.join(', ')}`,
            params
          );
        }
      });

      const byCenter = {};
      parsed.forEach((p) => {
        byCenter[p.center] = (byCenter[p.center] || 0) + 1;
      });

      const repeatedRows = await queryAll(
        `SELECT DISTINCT f.facility_code FROM facilities f
         JOIN inspections i ON i.facility_id = f.id AND i.record_status = 'valid' AND i.violation_level IN ('major','critical')
         WHERE f.plan_id <> ? AND f.facility_code IN (${parsed.map(() => '?').join(',')})`,
        [planId, ...parsed.map((p) => p.facility_code)]
      );
      const repeated = repeatedRows.length;

      await logActivity({
        plan_id: planId,
        facility_name: monthLabel,
        worker_id: req.user.id,
        worker_name: req.user.name,
        action: 'plan_uploaded',
        summary: `تم رفع خطة ${monthLabel} (${parsed.length} منشأة)`,
      });

      res.status(201).json({
        plan: await queryOne('SELECT * FROM plans WHERE id = ?', [planId]),
        inserted: parsed.length,
        by_center: byCenter,
        with_prior_major_violations: repeated,
      });
    } catch (err) {
      console.error('Plan upload error:', err);
      res.status(500).json({ error: 'فشل معالجة ملف الخطة: ' + (err.message || 'خطأ غير متوقع') });
    }
  }
);

// Facilities for a plan
app.get('/api/plans/:planId/facilities', authMiddleware, async (req, res, next) => {
  try {
    const { planId } = req.params;
    const { search = '', center = '', status = '' } = req.query;
    await expireStaleReservations(planId);

    let sql = 'SELECT * FROM facilities WHERE plan_id = ?';
    const params = [planId];
    const scope = centerScope(req.user);
    sql += scope.sql; params.push(...scope.params);
    if (center && center !== 'الكل') { sql += ' AND center = ?'; params.push(center); }
    if (status && status !== 'all') { sql += ' AND status = ?'; params.push(status); }
    if (search.trim()) {
      sql += ' AND (name LIKE ? OR address LIKE ? OR facility_code LIKE ?)';
      const q = `%${search.trim()}%`;
      params.push(q, q, q);
    }
    sql += ' ORDER BY serial_no ASC';
    const facilities = await queryAll(sql, params);

    const inspections = await queryAll(
      "SELECT * FROM inspections WHERE plan_id = ? AND record_status = 'valid' ORDER BY created_at DESC", [planId]
    );
    const inspByFacility = {};
    for (const insp of inspections) {
      if (!inspByFacility[insp.facility_id]) inspByFacility[insp.facility_id] = hydrateInspection(insp);
    }

    const priorRows = await queryAll(
      `SELECT f.facility_code AS code, i.violation_level AS level, i.created_at AS at
       FROM inspections i JOIN facilities f ON f.id = i.facility_id
       WHERE i.record_status = 'valid' AND i.plan_id <> ? ORDER BY i.created_at DESC`,
      [planId]
    );
    const prior = {};
    for (const r of priorRows) {
      if (!prior[r.code]) prior[r.code] = { visits: 0, worst: 'none', last_at: r.at };
      prior[r.code].visits += 1;
      if (C.VIOLATION_LEVELS.indexOf(r.level) > C.VIOLATION_LEVELS.indexOf(prior[r.code].worst))
        prior[r.code].worst = r.level;
    }

    res.json({
      facilities: (await attachLastVisit(facilities)).map((f) => ({
        ...f,
        inspection: inspByFacility[f.id] || null,
        history: prior[f.facility_code] || null,
      })),
    });
  } catch (err) { next(err); }
});

// Single facility with full inspection & history details (accessible by all users)
app.get('/api/facilities/:id', authMiddleware, async (req, res, next) => {
  try {
    const facility = await queryOne('SELECT * FROM facilities WHERE id = ?', [req.params.id]);
    if (!facility) return res.status(404).json({ error: 'المنشأة غير موجودة' });
    if (!canAccessCenter(req.user, facility.center)) return res.status(403).json(FORBIDDEN_CENTER);

    let insp = await queryOne(
      "SELECT * FROM inspections WHERE facility_id = ? AND record_status = 'valid' ORDER BY created_at DESC LIMIT 1",
      [facility.id]
    );
    if (!insp) {
      insp = await queryOne(
        "SELECT * FROM inspections WHERE facility_id = ? AND record_status NOT IN ('rejected', 'superseded', 'discarded') ORDER BY created_at DESC LIMIT 1",
        [facility.id]
      );
    }

    const priorRows = await queryAll(
      `SELECT f.facility_code AS code, i.violation_level AS level, i.created_at AS at
       FROM inspections i JOIN facilities f ON f.id = i.facility_id
       WHERE i.record_status = 'valid' AND f.facility_code = ? AND i.facility_id <> ? ORDER BY i.created_at DESC`,
      [facility.facility_code, facility.id]
    );
    const history = priorRows.length > 0 ? {
      visits: priorRows.length,
      worst: priorRows.reduce((w, r) => C.VIOLATION_LEVELS.indexOf(r.level) > C.VIOLATION_LEVELS.indexOf(w) ? r.level : w, 'none'),
      last_at: priorRows[0].at,
    } : null;

    res.json({
      facility: {
        ...(await attachLastVisit([facility]))[0],
        registry: await queryOne(
          'SELECT owner, phone, water_qty, treatment_unit, status_raw FROM establishments WHERE facility_code = ?', [facility.facility_code]
        ),
        inspection: insp ? hydrateInspection(insp) : null,
        history,
      },
    });
  } catch (err) { next(err); }
});

// Reserve facility
app.post('/api/facilities/:id/reserve', authMiddleware, async (req, res, next) => {
  try {
    const existing = await queryOne('SELECT plan_id FROM facilities WHERE id = ?', [req.params.id]);
    if (existing) await expireStaleReservations(existing.plan_id);
    const facility = await queryOne('SELECT * FROM facilities WHERE id = ?', [req.params.id]);
    if (!facility) return res.status(404).json({ error: 'المنشأة غير موجودة' });
    if (!canAccessCenter(req.user, facility.center)) return res.status(403).json(FORBIDDEN_CENTER);
    if (facility.status !== 'available') {
      return res.status(409).json({
        error: facility.status === 'completed'
          ? `تمت معاينة المكان بالفعل بواسطة ${facility.completed_by_name}`
          : `المكان محجوز مؤقتاً حالياً بواسطة ${facility.reserved_by_name}`,
        facility,
      });
    }
    const now = new Date().toISOString();
    await run(
      `UPDATE facilities SET status = 'reserved', reserved_by_id = ?, reserved_by_name = ?, reserved_at = ?, updated_at = ? WHERE id = ?`,
      [req.user.id, req.user.name, now, now, facility.id]
    );
    await logActivity({
      plan_id: facility.plan_id, facility_id: facility.id, facility_name: facility.name, center: facility.center,
      worker_id: req.user.id, worker_name: req.user.name, action: 'reserved',
      summary: `حجز مؤقت (في الطريق) إلى ${facility.name}`,
    });
    res.json({ facility: await queryOne('SELECT * FROM facilities WHERE id = ?', [facility.id]) });
  } catch (err) { next(err); }
});

// Release reservation
app.post('/api/facilities/:id/release', authMiddleware, async (req, res, next) => {
  try {
    const facility = await queryOne('SELECT * FROM facilities WHERE id = ?', [req.params.id]);
    if (!facility) return res.status(404).json({ error: 'المنشأة غير موجودة' });
    if (!canAccessCenter(req.user, facility.center)) return res.status(403).json(FORBIDDEN_CENTER);
    if (facility.status !== 'reserved')
      return res.status(409).json({ error: 'المكان ليس في حالة حجز مؤقت', facility });
    if (facility.reserved_by_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: `الحجز خاص بـ ${facility.reserved_by_name} ولا يمكنك إلغاؤه` });
    const now = new Date().toISOString();
    await run(
      `UPDATE facilities SET status = 'available', reserved_by_id = NULL, reserved_by_name = NULL, reserved_at = NULL, updated_at = ? WHERE id = ?`,
      [now, facility.id]
    );
    await logActivity({
      plan_id: facility.plan_id, facility_id: facility.id, facility_name: facility.name, center: facility.center,
      worker_id: req.user.id, worker_name: req.user.name, action: 'released',
      summary: `ألغى الحجز المؤقت وأصبح ${facility.name} متاحاً`,
    });
    res.json({ facility: await queryOne('SELECT * FROM facilities WHERE id = ?', [facility.id]) });
  } catch (err) { next(err); }
});

// Complete inspection
app.post('/api/facilities/:id/complete', authMiddleware, async (req, res, next) => {
  try {
    const facility = await queryOne('SELECT * FROM facilities WHERE id = ?', [req.params.id]);
    if (!facility) return res.status(404).json({ error: 'المنشأة غير موجودة' });
    if (!canAccessCenter(req.user, facility.center)) return res.status(403).json(FORBIDDEN_CENTER);
    if (facility.status === 'completed')
      return res.status(409).json({ error: `تم إقفال هذه المنشأة مسبقاً بواسطة ${facility.completed_by_name}`, facility });
    if (facility.status === 'reserved' && facility.reserved_by_id !== req.user.id && req.user.role !== 'admin')
      return res.status(409).json({ error: `المكان محجوز مؤقتاً بواسطة ${facility.reserved_by_name}`, facility });
    const checked = normalizePayload(req.body, facility);
    if (!checked.ok) return res.status(400).json({ error: checked.error });
    const out = await recordInspection(facility, req.user, checked.value, new Date().toISOString());
    res.status(out.result === 'duplicate' ? 200 : 201).json({ facility: out.facility, inspection: out.inspection });
  } catch (err) { next(err); }
});

// Admin: reject the completed inspection → back to the registry as "not visited", queued for next month
app.post('/api/facilities/:id/reject', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const facility = await queryOne('SELECT * FROM facilities WHERE id = ?', [req.params.id]);
    if (!facility) return res.status(404).json({ error: 'المنشأة غير موجودة' });
    const valid = await queryAll("SELECT id FROM inspections WHERE facility_id = ? AND record_status = 'valid'", [facility.id]);
    if (facility.status !== 'completed' && valid.length === 0) {
      return res.status(409).json({ error: 'لا توجد معاينة مكتملة لرفضها' });
    }
    const reason = String(req.body.reason || '').trim();
    const now = new Date().toISOString();
    await transaction(async ({ run: tRun }) => {
      await tRun("UPDATE inspections SET record_status = 'rejected', reject_reason = ? WHERE facility_id = ? AND record_status = 'valid'", [reason, facility.id]);
      await tRun(
        `UPDATE facilities
         SET status = 'available', reserved_by_id = NULL, reserved_by_name = NULL, reserved_at = NULL,
             completed_by_id = NULL, completed_by_name = NULL, completed_at = NULL, visit_outcome = '', updated_at = ?
         WHERE id = ?`,
        [now, facility.id]
      );
    });
    const ids = valid.map((v) => v.id);
    if (ids.length) await run(`DELETE FROM activity_feed WHERE inspection_id IN (${ids.map(() => '?').join(',')})`, ids);
    await run("DELETE FROM activity_feed WHERE facility_id = ? AND action = 'completed' AND inspection_id IS NULL", [facility.id]);
    await refreshLastVisit([facility.facility_code]);
    const next = await queueForNextMonth(facility);
    await logActivity({
      plan_id: facility.plan_id, facility_id: facility.id, facility_name: facility.name, center: facility.center,
      worker_id: req.user.id, worker_name: req.user.name, action: 'rejected',
      summary: `رفض الأدمن معاينة ${facility.name}${reason ? ` (${reason})` : ''} — عادت للقاعدة الأساسية${next.queued ? ` وأُضيفت لخطة ${next.month}` : ''}`,
    });
    const [fresh] = await attachLastVisit([await queryOne('SELECT * FROM facilities WHERE id = ?', [facility.id])]);
    res.json({ success: true, facility: fresh, next_plan: next });
  } catch (err) { next(err); }
});

// Excel / PDF downloads authenticate via ?code= because they are opened as plain links
// File downloads open in a new tab, so the session token comes in the query string
function authFromQuery(req, res, next) {
  if (!readToken(req) && req.query.token) req.headers['x-session-token'] = String(req.query.token);
  next();
}

async function loadReport(req, res) {
  const plan = await queryOne('SELECT * FROM plans WHERE id = ?', [req.params.planId]);
  if (!plan) { res.status(404).json({ error: 'الخطة غير موجودة' }); return null; }
  const center = String(req.query.center || '').trim();
  if (center && !canAccessCenter(req.user, center)) { res.status(403).json(FORBIDDEN_CENTER); return null; }
  await expireStaleReservations(plan.id);
  return buildPlanReport(plan, centerScope(req.user, 'f.center'), center && center !== 'الكل' ? center : '');
}

// Report rows (اسم المنشأة، الكود، العنوان، المدينة، تاريخ آخر معاينة، حالة الخطة) — used for the PDF export
app.get('/api/plans/:planId/report', authMiddleware, async (req, res, next) => {
  try {
    const report = await loadReport(req, res);
    if (report) res.json({ ...report, file_name: reportFileName(report, 'pdf') });
  } catch (err) { next(err); }
});

// Styled Excel of the plan — admins get every city, workers only their own cities
async function sendPlanExcel(req, res, next) {
  try {
    const report = await loadReport(req, res);
    if (!report) return;
    const buf = await buildPlanWorkbook(report);
    const name = reportFileName(report, 'xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="plan.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(Buffer.from(buf));
  } catch (err) { next(err); }
}
app.get('/api/plans/:planId/export.xlsx', authFromQuery, authMiddleware, sendPlanExcel);
app.get('/api/plans/:planId/plan.xlsx', authFromQuery, authMiddleware, sendPlanExcel);
// Admin: unlock a facility (backward compatibility)
app.post('/api/facilities/:id/unlock', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const facility = await queryOne('SELECT * FROM facilities WHERE id = ?', [req.params.id]);
    if (!facility) return res.status(404).json({ error: 'المنشأة غير موجودة' });
    const now = new Date().toISOString();
    await transaction(async ({ run: tRun }) => {
      await tRun("UPDATE inspections SET record_status = 'superseded' WHERE facility_id = ? AND record_status = 'valid'", [facility.id]);
      await tRun(
        `UPDATE facilities
         SET status = 'available', reserved_by_id = NULL, reserved_by_name = NULL, reserved_at = NULL,
             completed_by_id = NULL, completed_by_name = NULL, completed_at = NULL, visit_outcome = '', updated_at = ?
         WHERE id = ?`,
        [now, facility.id]
      );
    });
    await finishReopen([facility], false);
    await logActivity({
      plan_id: facility.plan_id, facility_id: facility.id, facility_name: facility.name, center: facility.center,
      worker_id: req.user.id, worker_name: req.user.name, action: 'unlocked',
      summary: `أعاد الأدمن فتح ${facility.name} للمعاينة`,
    });
    res.json({ facility: await queryOne('SELECT * FROM facilities WHERE id = ?', [facility.id]) });
  } catch (err) { next(err); }
});

// Admin: Reset / Re-open a facility (with options: keep_history or wipe)
app.post('/api/facilities/:id/reset', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const { mode = 'keep_history' } = req.body; // 'keep_history' | 'wipe'
    const facility = await queryOne('SELECT * FROM facilities WHERE id = ?', [req.params.id]);
    if (!facility) return res.status(404).json({ error: 'المنشأة غير موجودة' });

    const now = new Date().toISOString();
    await transaction(async ({ run: tRun }) => {
      if (mode === 'wipe') {
        await tRun('DELETE FROM inspections WHERE facility_id = ?', [facility.id]);
      } else {
        await tRun("UPDATE inspections SET record_status = 'superseded' WHERE facility_id = ? AND record_status = 'valid'", [facility.id]);
      }

      await tRun(
        `UPDATE facilities
         SET status = 'available',
             reserved_by_id = NULL, reserved_by_name = NULL, reserved_at = NULL,
             completed_by_id = NULL, completed_by_name = NULL, completed_at = NULL,
             visit_outcome = '', updated_at = ?
         WHERE id = ?`,
        [now, facility.id]
      );
    });

    const isWiped = mode === 'wipe';
    await finishReopen([facility], isWiped);
    if (!isWiped) await logActivity({
      plan_id: facility.plan_id,
      facility_id: facility.id,
      facility_name: facility.name,
      center: facility.center,
      worker_id: req.user.id,
      worker_name: req.user.name,
      action: isWiped ? 'reset_wipe' : 'reset_reopen',
      summary: isWiped
        ? `قام الأدمن بحذف المعاينة السابقة وتصفير ${facility.name} تماماً`
        : `أعاد الأدمن فتح ${facility.name} للمعاينة (مع الاحتفاظ بالسجل في الأرشيف)`,
    });

    res.json({
      success: true,
      mode,
      facility: await queryOne('SELECT * FROM facilities WHERE id = ?', [facility.id]),
    });
  } catch (err) {
    next(err);
  }
});

// Admin: Bulk reset facilities in a plan
app.post('/api/plans/:planId/bulk-reset', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const { planId } = req.params;
    const { target = 'completed', mode = 'keep_history' } = req.body; // target: 'completed' | 'reserved' | 'all'

    let whereClause = 'plan_id = ?';
    if (target === 'completed') {
      whereClause += " AND status = 'completed'";
    } else if (target === 'reserved') {
      whereClause += " AND status = 'reserved'";
    } else if (target === 'all') {
      whereClause += " AND status IN ('completed', 'reserved')";
    }

    const targetFacilities = await queryAll(`SELECT id, name, facility_code FROM facilities WHERE ${whereClause}`, [planId]);
    if (targetFacilities.length === 0) {
      return res.json({ success: true, count: 0, message: 'لا توجد منشآت مطابقة للشرط المطلوب' });
    }

    const facilityIds = targetFacilities.map((f) => f.id);
    const now = new Date().toISOString();

    await transaction(async ({ run: tRun }) => {
      if (mode === 'wipe') {
        for (const fid of facilityIds) {
          await tRun('DELETE FROM inspections WHERE facility_id = ?', [fid]);
        }
      } else {
        for (const fid of facilityIds) {
          await tRun("UPDATE inspections SET record_status = 'superseded' WHERE facility_id = ? AND record_status = 'valid'", [fid]);
        }
      }

      for (const fid of facilityIds) {
        await tRun(
          `UPDATE facilities
           SET status = 'available',
               reserved_by_id = NULL, reserved_by_name = NULL, reserved_at = NULL,
               completed_by_id = NULL, completed_by_name = NULL, completed_at = NULL,
               visit_outcome = '', updated_at = ?
           WHERE id = ?`,
          [now, fid]
        );
      }
    });

    await finishReopen(targetFacilities, mode === 'wipe');
    if (mode !== 'wipe') await logActivity({
      plan_id: planId,
      worker_id: req.user.id,
      worker_name: req.user.name,
      action: 'bulk_reset',
      summary: `قام الأدمن بإعادة فتح (${facilityIds.length}) منشأة للمعاينة في الخطة`,
    });

    res.json({
      success: true,
      count: facilityIds.length,
      message: `تمت إعادة فتح ${facilityIds.length} منشأة بنجاح`,
    });
  } catch (err) {
    next(err);
  }
});

// Any employee: register a new establishment (same fields as the Excel sheets) and add it to the plan.
// Workers can only add to their assigned centers. The establishment is also saved to the permanent registry.
// Suggested serial = after the highest serial used anywhere (all plans + registry). The user can change it.
app.get('/api/plans/:planId/next-serial', authMiddleware, async (req, res, next) => {
  try {
    const row = await queryOne(
      `SELECT GREATEST(COALESCE((SELECT MAX(serial_no) FROM facilities), 0), COALESCE((SELECT MAX(serial_no) FROM establishments), 0)) AS m`
    );
    res.json({ next_serial: Number(row.m) + 1 });
  } catch (err) { next(err); }
});

app.get('/api/activity-types', authMiddleware, (req, res) => {
  res.json({ activity_types: ACTIVITY_TYPES });
});

// Permanent establishments registry (including ones employees added).
// Workers only see the centers assigned to them, same as the plans.
async function loadEstablishments(user) {
  const scope = centerScope(user);
  const rows = await queryAll(
    `SELECT facility_code, name, address, center, activity_type, owner, phone, water_qty, treatment_unit,
            status_raw, is_active, last_visit_date
     FROM establishments WHERE 1 = 1${scope.sql}`,
    scope.params
  );
  // city, then natural code order (Q2 before Q10)
  return rows.sort((a, b) => a.center.localeCompare(b.center, 'ar')
    || String(a.facility_code).localeCompare(String(b.facility_code), 'en', { numeric: true }));
}

// View-only list for the «عرض المنشآت» page
app.get('/api/establishments', authMiddleware, async (req, res, next) => {
  try {
    const rows = await loadEstablishments(req.user);
    res.json({ establishments: rows.map((r) => ({ ...r, is_active: Number(r.is_active) === 1 })) });
  } catch (err) { next(err); }
});

// The whole registry as one styled Excel sheet (active + closed, with a status column)
app.get('/api/establishments/export.xlsx', authFromQuery, authMiddleware, async (req, res, next) => {
  try {
    const rows = await loadEstablishments(req.user);
    const centers = userCenters(req.user);
    const buf = await buildEstablishmentsWorkbook(rows, centers === null ? 'كل المدن' : centers.join('، ') || '—');
    const day = new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="establishments.xlsx"; filename*=UTF-8''${encodeURIComponent(`سجل-المنشآت-${day}.xlsx`)}`
    );
    res.send(Buffer.from(buf));
  } catch (err) { next(err); }
});

app.post('/api/plans/:planId/facilities', authMiddleware, async (req, res, next) => {
  try {
    const { planId } = req.params;
    const txt = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
    const name = txt(req.body.name, 200);
    const address = txt(req.body.address);
    const center = txt(req.body.center, 60);
    const code = txt(req.body.facility_code, 40).toUpperCase();
    const target_date = txt(req.body.target_date, 10);
    const activity_type = txt(req.body.activity_type, 60) || 'أخرى';
    const serial = Number(req.body.serial_no);
    const plan_notes = txt(req.body.plan_notes);
    const owner = txt(req.body.owner, 150);
    const phone = normalizePhone(txt(req.body.phone, 60));
    const water_qty = txt(req.body.water_qty, 60);
    const treatment_unit = txt(req.body.treatment_unit, 150);
    const last_visit_date = txt(req.body.last_visit_date, 10);

    if (!name) return res.status(400).json({ error: 'اسم المنشأة مطلوب' });
    if (!code) return res.status(400).json({ error: 'كود المنشأة مطلوب' });
    if (!Number.isInteger(serial) || serial < 1 || serial > 1000000) {
      return res.status(400).json({ error: 'رقم التسلسل مطلوب (رقم صحيح أكبر من صفر)' });
    }
    if (!ACTIVITY_TYPES.includes(activity_type)) return res.status(400).json({ error: 'اختر نوع النشاط من القائمة' });
    if (!C.OFFICIAL_CENTERS.includes(center)) return res.status(400).json({ error: 'اختر المدينة من القائمة' });
    if (!canAccessCenter(req.user, center)) return res.status(403).json({ error: 'لا يمكنك إضافة منشأة في مدينة غير مخصصة لك' });
    if (last_visit_date && (!/^\d{4}-\d{2}-\d{2}$/.test(last_visit_date) || last_visit_date > new Date().toISOString().slice(0, 10))) {
      return res.status(400).json({ error: 'تاريخ آخر مرور غير صحيح' });
    }

    const plan = await queryOne('SELECT * FROM plans WHERE id = ?', [planId]);
    if (!plan) return res.status(404).json({ error: 'الخطة غير موجودة' });

    const existing = await queryOne('SELECT name, center FROM establishments WHERE facility_code = ?', [code]);
    if (existing) return res.status(409).json({ error: `الكود ${code} مسجل بالفعل لمنشأة "${existing.name}" (${existing.center})` });
    const inPlan = await queryOne('SELECT name FROM facilities WHERE plan_id = ? AND facility_code = ?', [planId, code]);
    if (inPlan) return res.status(409).json({ error: `الكود ${code} موجود بالفعل في الخطة (${inPlan.name})` });

    const facilityId = uuidv4();
    const now = new Date().toISOString();
    const SERIAL_TAKEN = 'تعذر حفظ المنشأة بسبب وجود رقم تسلسل بنفس الرقم الموجود حالياً';

    // رقم التسلسل لازم يكون فريد في كل الخطط (الشيتات) وفي السجل الدائم
    const serialTaken = async (one) =>
      (await one('SELECT 1 FROM facilities WHERE serial_no = ? LIMIT 1', [serial])) ||
      (await one('SELECT 1 FROM establishments WHERE serial_no = ? LIMIT 1', [serial]));
    if (await serialTaken(queryOne)) return res.status(409).json({ error: SERIAL_TAKEN });

    const saved = await transaction(async ({ run: tRun, queryOne: tOne }) => {
      // lock so two employees saving the same serial at the same moment can't both succeed
      await tOne('SELECT pg_advisory_xact_lock(7340021)');
      if (await serialTaken(tOne)) return false;
      await tRun(
        `INSERT INTO establishments (id, facility_code, serial_no, name, address, center, activity_type, owner, phone, water_qty, treatment_unit,
                                     status_raw, is_active, last_visit_date, baseline_visit_date, source_file, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open', 1, ?, ?, ?, ?, ?)`,
        [uuidv4(), code, serial, name, address, center, activity_type, owner, phone, water_qty, treatment_unit,
          last_visit_date, last_visit_date, `أضافها ${req.user.name}`, now, now]
      );
      await tRun(
        `INSERT INTO facilities
         (id, plan_id, serial_no, name, address, center, facility_code, target_date, plan_notes, activity_type, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)`,
        [facilityId, planId, serial, name, address || center, center, code, target_date, plan_notes, activity_type, now]
      );
      await tRun('UPDATE plans SET total_facilities = total_facilities + 1 WHERE id = ?', [planId]);
      return true;
    });
    if (!saved) return res.status(409).json({ error: SERIAL_TAKEN });

    await logActivity({
      plan_id: planId,
      facility_id: facilityId,
      facility_name: name,
      center,
      worker_id: req.user.id,
      worker_name: req.user.name,
      action: 'facility_created',
      summary: `أضاف ${req.user.name} منشأة جديدة: ${name} (${code}) — تسلسل ${serial}`,
    });

    res.status(201).json({
      success: true,
      facility: await queryOne('SELECT * FROM facilities WHERE id = ?', [facilityId]),
    });
  } catch (err) {
    if (err && err.code === '23505') return res.status(409).json({ error: 'كود المنشأة مسجل بالفعل' });
    next(err);
  }
});

// Admin: Update facility details (CRUD)
app.put('/api/facilities/:id', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const facility = await queryOne('SELECT * FROM facilities WHERE id = ?', [req.params.id]);
    if (!facility) return res.status(404).json({ error: 'المنشأة غير موجودة' });

    const {
      name = facility.name,
      address = facility.address,
      center = facility.center,
      facility_code = facility.facility_code,
      target_date = facility.target_date,
      activity_type = facility.activity_type,
      plan_notes = facility.plan_notes,
    } = req.body;

    const now = new Date().toISOString();
    await run(
      `UPDATE facilities
       SET name = ?, address = ?, center = ?, facility_code = ?, target_date = ?,
           activity_type = ?, plan_notes = ?, updated_at = ?
       WHERE id = ?`,
      [
        name.trim(),
        address.trim(),
        center.trim(),
        facility_code.trim().toUpperCase(),
        target_date.trim(),
        activity_type.trim(),
        plan_notes.trim(),
        now,
        facility.id,
      ]
    );

    await logActivity({
      plan_id: facility.plan_id,
      facility_id: facility.id,
      facility_name: name.trim(),
      center: center.trim(),
      worker_id: req.user.id,
      worker_name: req.user.name,
      action: 'facility_updated',
      summary: `عدل الأدمن بيانات المنشأة: ${name.trim()} (${facility_code.trim()})`,
    });

    res.json({
      success: true,
      facility: await queryOne('SELECT * FROM facilities WHERE id = ?', [facility.id]),
    });
  } catch (err) {
    next(err);
  }
});

// Admin: Delete a facility completely (CRUD)
app.delete('/api/facilities/:id', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const facility = await queryOne('SELECT * FROM facilities WHERE id = ?', [req.params.id]);
    if (!facility) return res.status(404).json({ error: 'المنشأة غير موجودة' });

    await transaction(async ({ run: tRun }) => {
      await tRun('DELETE FROM inspections WHERE facility_id = ?', [facility.id]);
      await tRun('DELETE FROM facilities WHERE id = ?', [facility.id]);
      await tRun('UPDATE plans SET total_facilities = GREATEST(0, total_facilities - 1) WHERE id = ?', [facility.plan_id]);
    });
    await finishReopen([facility], true);

    await logActivity({
      plan_id: facility.plan_id,
      facility_name: facility.name,
      center: facility.center,
      worker_id: req.user.id,
      worker_name: req.user.name,
      action: 'facility_deleted',
      summary: `حذف الأدمن المنشأة: ${facility.name} (${facility.facility_code})`,
    });

    res.json({ success: true, id: facility.id });
  } catch (err) {
    next(err);
  }
});

// Admin: delete one activity entry
app.delete('/api/feed/:id', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    await run('DELETE FROM activity_feed WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Admin: delete all activity of one plan, or of every plan (planId = "all")
app.delete('/api/plans/:planId/feed', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const all = req.params.planId === 'all';
    const row = await queryOne(
      `SELECT COUNT(*) AS n FROM activity_feed${all ? '' : ' WHERE plan_id = ?'}`, all ? [] : [req.params.planId]
    );
    await run(`DELETE FROM activity_feed${all ? '' : ' WHERE plan_id = ?'}`, all ? [] : [req.params.planId]);
    res.json({ success: true, deleted: Number(row.n) });
  } catch (err) { next(err); }
});

// Admin: delete a whole plan (its facilities, inspections and activity). The month is remembered so the
// system does not re-create it automatically; the admin can still create it again by hand.
app.delete('/api/plans/:planId', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const plan = await queryOne('SELECT * FROM plans WHERE id = ?', [req.params.planId]);
    if (!plan) return res.status(404).json({ error: 'الخطة غير موجودة' });
    const codes = (await queryAll('SELECT DISTINCT facility_code FROM facilities WHERE plan_id = ?', [plan.id])).map((r) => r.facility_code);
    const counts = await queryOne(
      `SELECT (SELECT COUNT(*) FROM facilities WHERE plan_id = ?) AS facilities,
              (SELECT COUNT(*) FROM inspections WHERE plan_id = ?) AS inspections`,
      [plan.id, plan.id]
    );
    await transaction(async ({ run: tRun }) => {
      await tRun('DELETE FROM activity_feed WHERE plan_id = ?', [plan.id]);
      await tRun('DELETE FROM inspections WHERE plan_id = ?', [plan.id]);
      await tRun('DELETE FROM facilities WHERE plan_id = ?', [plan.id]);
      await tRun('DELETE FROM plans WHERE id = ?', [plan.id]);
      if (plan.plan_month) {
        await tRun(
          `INSERT INTO deleted_plan_months (plan_month, deleted_at, deleted_by) VALUES (?, ?, ?)
           ON CONFLICT (plan_month) DO UPDATE SET deleted_at = EXCLUDED.deleted_at, deleted_by = EXCLUDED.deleted_by`,
          [plan.plan_month, new Date().toISOString(), req.user.name]
        );
      }
    });
    // inspections are gone → re-derive each establishment's last visit from what is left
    await refreshLastVisit(codes);
    res.json({
      success: true,
      deleted: { plan: plan.month_label, facilities: Number(counts.facilities), inspections: Number(counts.inspections) },
    });
  } catch (err) { next(err); }
});

// Activity feed
app.get('/api/plans/:planId/feed', authMiddleware, async (req, res, next) => {
  try {
    const scope = centerScope(req.user);
    const feed = await queryAll(`SELECT * FROM activity_feed WHERE plan_id = ?${scope.sql} ORDER BY created_at DESC LIMIT 150`, [req.params.planId, ...scope.params]);
    res.json({ feed });
  } catch (err) { next(err); }
});

// Conflicts
app.get('/api/conflicts', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const rows = await queryAll(
      `SELECT i.id, i.worker_name, i.created_at, i.samples_json, i.notes, i.violation_level, i.visit_outcome,
              f.name AS facility_name, f.completed_by_name, f.center
       FROM inspections i JOIN facilities f ON f.id = i.facility_id
       WHERE i.record_status = 'conflict' ORDER BY i.created_at DESC`
    );
    res.json({ conflicts: rows.map((r) => ({ ...r, samples: JSON.parse(r.samples_json || '[]') })) });
  } catch (err) { next(err); }
});

app.post('/api/conflicts/:id/resolve', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const insp = await queryOne("SELECT * FROM inspections WHERE id = ? AND record_status = 'conflict'", [req.params.id]);
    if (!insp) return res.status(404).json({ error: 'لا توجد معاينة مكررة بهذا المعرف' });
    const decision = req.body.decision === 'replace' ? 'replace' : 'discard';
    await transaction(async ({ run: tRun }) => {
      if (decision === 'replace') {
        await tRun("UPDATE inspections SET record_status = 'superseded' WHERE facility_id = ? AND record_status = 'valid'", [insp.facility_id]);
        await tRun("UPDATE inspections SET record_status = 'valid' WHERE id = ?", [insp.id]);
        await tRun(
          `UPDATE facilities SET completed_by_id = ?, completed_by_name = ?, completed_at = ?, visit_outcome = ?, updated_at = ? WHERE id = ?`,
          [insp.worker_id, insp.worker_name, insp.created_at, insp.visit_outcome, new Date().toISOString(), insp.facility_id]
        );
      } else {
        await tRun("UPDATE inspections SET record_status = 'discarded' WHERE id = ?", [insp.id]);
      }
    });
    const confFac = await queryOne('SELECT facility_code FROM facilities WHERE id = ?', [insp.facility_id]);
    if (confFac) await refreshLastVisit([confFac.facility_code]);
    res.json({ ok: true, decision });
  } catch (err) { next(err); }
});

// Statistics
app.get('/api/plans/:planId/stats', authMiddleware, async (req, res, next) => {
  try {
    const { planId } = req.params;
    await expireStaleReservations(planId);
    const plan = await queryOne('SELECT * FROM plans WHERE id = ?', [planId]);
    if (!plan) return res.status(404).json({ error: 'الخطة غير موجودة' });

    const statScope = centerScope(req.user);
    const totals = await queryOne(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN status = 'reserved'  THEN 1 ELSE 0 END) AS reserved,
              SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available
       FROM facilities WHERE plan_id = ?${statScope.sql}`, [planId, ...statScope.params]
    );
    const byCenter = await queryAll(
      `SELECT center,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN status = 'reserved'  THEN 1 ELSE 0 END) AS reserved
       FROM facilities WHERE plan_id = ?${statScope.sql} GROUP BY center ORDER BY total DESC`, [planId, ...statScope.params]
    );
    const byActivity = await queryAll(
      `SELECT COALESCE(NULLIF(activity_type, ''), 'أخرى') AS activity_type,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM facilities WHERE plan_id = ?${statScope.sql} GROUP BY 1 ORDER BY total DESC`, [planId, ...statScope.params]
    );

    const insp = (await queryAll(
      `SELECT * FROM inspections WHERE plan_id = ? AND record_status = 'valid'
       AND facility_id IN (SELECT id FROM facilities WHERE plan_id = ?${statScope.sql})`,
      [planId, planId, ...statScope.params]
    )).map(hydrateInspection);
    const byWorkerMap = {};
    const outcomes = {};
    const levels = { none: 0, minor: 0, major: 0, critical: 0 };
    const sampleTypes = {};
    let totalSamples = 0;
    const complianceFails = {};
    for (const i of insp) {
      const w = (byWorkerMap[i.worker_name] = byWorkerMap[i.worker_name] || { worker_name: i.worker_name, visits: 0, samples: 0 });
      w.visits += 1;
      outcomes[i.visit_outcome] = (outcomes[i.visit_outcome] || 0) + 1;
      if (i.visit_outcome === 'inspected') levels[i.violation_level] = (levels[i.violation_level] || 0) + 1;
      for (const s of i.samples) {
        w.samples += s.count;
        totalSamples += s.count;
        sampleTypes[s.type] = (sampleTypes[s.type] || 0) + s.count;
      }
      for (const [k, v] of Object.entries(i.compliance)) {
        if (!C.COMPLIANCE_LABELS[k]) continue;
        const bad = k === 'illegal_connection' ? v === 'yes' : v === 'no';
        if (bad) complianceFails[k] = (complianceFails[k] || 0) + 1;
      }
    }

    const completed = Number(totals.completed) || 0;
    const total = Number(totals.total) || 0;
    res.json({
      plan,
      totals: { total, completed, reserved: Number(totals.reserved) || 0, available: Number(totals.available) || 0,
                completion_rate: total ? Math.round((completed / total) * 100) : 0 },
      by_center: byCenter.map((c) => ({ ...c, completed: Number(c.completed) || 0, reserved: Number(c.reserved) || 0 })),
      by_activity: byActivity.map((a) => ({ ...a, completed: Number(a.completed) || 0 })),
      by_worker: Object.values(byWorkerMap).sort((a, b) => b.visits - a.visits),
      outcomes,
      violation_levels: levels,
      total_samples: totalSamples,
      sample_types: Object.entries(sampleTypes).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      compliance_failures: Object.entries(complianceFails)
        .map(([key, count]) => ({ key, label: C.COMPLIANCE_LABELS[key], count }))
        .sort((a, b) => b.count - a.count),
    });
  } catch (err) { next(err); }
});

// Offline-First Batch Sync
app.post('/api/sync/batch', authMiddleware, async (req, res, next) => {
  try {
    const operations = Array.isArray(req.body.operations) ? req.body.operations : [];
    const results = [];
    await expireStaleReservations();

    for (const op of operations) {
      const facility = await queryOne('SELECT * FROM facilities WHERE id = ?', [op.facility_id]);
      if (!facility) {
        results.push({ queue_id: op.queue_id, status: 'skipped', reason: 'المنشأة غير موجودة' });
        continue;
      }
      if (!canAccessCenter(req.user, facility.center)) {
        results.push({ queue_id: op.queue_id, facility_name: facility.name, status: 'rejected', reason: FORBIDDEN_CENTER.error });
        continue;
      }
      const now = new Date().toISOString();

      if (op.action === 'reserve') {
        if (facility.status === 'available') {
          await run(
            `UPDATE facilities SET status = 'reserved', reserved_by_id = ?, reserved_by_name = ?, reserved_at = ?, updated_at = ? WHERE id = ?`,
            [req.user.id, req.user.name, op.created_at || now, now, facility.id]
          );
          await logActivity({
            plan_id: facility.plan_id, facility_id: facility.id, facility_name: facility.name, center: facility.center,
            worker_id: req.user.id, worker_name: req.user.name, action: 'reserved',
            summary: `حجز مؤقت (متزامن) إلى ${facility.name}`,
          });
          results.push({ queue_id: op.queue_id, facility_name: facility.name, status: 'applied' });
        } else if (facility.status === 'reserved' && facility.reserved_by_id === req.user.id) {
          results.push({ queue_id: op.queue_id, facility_name: facility.name, status: 'applied' });
        } else {
          results.push({ queue_id: op.queue_id, facility_name: facility.name, status: 'conflict', reason: `محجوز أو منتهي بالفعل (${facility.status})` });
        }
      } else if (op.action === 'release') {
        if (facility.status === 'reserved' && facility.reserved_by_id === req.user.id) {
          await run(
            `UPDATE facilities SET status = 'available', reserved_by_id = NULL, reserved_by_name = NULL, reserved_at = NULL, updated_at = ? WHERE id = ?`,
            [now, facility.id]
          );
          await logActivity({
            plan_id: facility.plan_id, facility_id: facility.id, facility_name: facility.name, center: facility.center,
            worker_id: req.user.id, worker_name: req.user.name, action: 'released',
            summary: `ألغى الحجز المؤقت (متزامن) وأصبح ${facility.name} متاحاً`,
          });
        }
        results.push({ queue_id: op.queue_id, facility_name: facility.name, status: 'applied' });
      } else if (op.action === 'complete') {
        const checked = normalizePayload(
          { ...(op.payload || {}), client_id: op.payload?.client_id || op.queue_id }, facility, { recordedAt: op.created_at }
        );
        if (!checked.ok) {
          results.push({ queue_id: op.queue_id, facility_name: facility.name, status: 'rejected', reason: checked.error });
          continue;
        }
        const out = await recordInspection(facility, req.user, checked.value, op.created_at || now, { viaSync: true });
        if (out.result === 'conflict') {
          results.push({
            queue_id: op.queue_id, facility_name: facility.name, status: 'conflict',
            reason: `تم إقفالها مسبقاً بواسطة ${facility.completed_by_name} — حُفظت معاينتك للمراجعة عند الأدمن`,
          });
        } else {
          results.push({ queue_id: op.queue_id, facility_name: facility.name, status: 'applied' });
        }
      } else {
        results.push({ queue_id: op.queue_id, status: 'skipped', reason: 'عملية غير معروفة' });
      }
    }
    res.json({ results });
  } catch (err) { next(err); }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err.message);
  res.status(500).json({ error: 'خطأ داخلي في السيرفر: ' + err.message });
});

// Boot when running directly (node src/server.js)
if (require.main === module) {
  ensureDb().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Menoufia Inspections Backend running on http://0.0.0.0:${PORT}`);
      console.log(`📦 Database: PostgreSQL (Neon)`);
    });
  }).catch((err) => {
    console.error('❌ Failed to initialize database:', err.message);
  });
}

module.exports = app;
module.exports.ensureDb = ensureDb;
