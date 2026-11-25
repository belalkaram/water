const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, transaction } = require('../db');
const C = require('../constants');

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTH_ALIASES = { 'ابريل': 4, 'اغسطس': 8, 'اكتوبر': 10 };

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `خطة ${MONTHS_AR[m - 1]} ${y}`;
}

// Calendar month in Egypt time (UTC+2), so the 1st of the month flips at local midnight
function currentYm(d = new Date()) {
  const local = new Date(d.getTime() + 2 * 3600 * 1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

// "خطة ديسمبر 2026" -> "2026-12" (null when no month name + year is found)
function ymFromLabel(label) {
  const m = String(label || '').match(/(يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)\s*(\d{4})/);
  if (!m) return null;
  const month = MONTHS_AR.indexOf(m[1]) + 1 || MONTH_ALIASES[m[1]];
  return month ? `${m[2]}-${String(month).padStart(2, '0')}` : null;
}

// A facility is due in month M when its last visit is on or before the end of month (M - 6),
// i.e. strictly before the 1st of month (M - 5). Empty last_visit => always due.
function dueCutoff(ym) {
  return `${addMonths(ym, -(C.REVISIT_MONTHS - 1))}-01`;
}

async function dueEstablishments(ym) {
  const cutoff = dueCutoff(ym);
  return queryAll(
    `SELECT * FROM establishments
     WHERE is_active = 1 AND (reinspect_flag = 1 OR last_visit_date = '' OR last_visit_date IS NULL OR last_visit_date < ?)
     ORDER BY center, facility_code`,
    [cutoff]
  );
}

// A plan row still needs a visit when it is not done, or was visited without completing the inspection
// (closed / refused / not found / other) — no sample was taken.
const UNFINISHED_SQL = "(f.status <> 'completed' OR COALESCE(f.visit_outcome, '') NOT IN ('inspected', ''))";

async function previousPlan(ym) {
  return queryOne(
    'SELECT * FROM plans WHERE plan_month IS NOT NULL AND plan_month < ? ORDER BY plan_month DESC LIMIT 1', [ym]
  );
}

// Unfinished rows of the plan right before `ym`, deduped by facility code. Skips establishments that were
// deactivated, or that were inspected again after that plan started (e.g. through another plan).
async function unfinishedFromPrevious(ym) {
  const prev = await previousPlan(ym);
  if (!prev) return { prev: null, rows: [] };
  const rows = await queryAll(
    `SELECT f.* FROM facilities f
     WHERE f.plan_id = ? AND ${UNFINISHED_SQL}
       AND NOT EXISTS (
         SELECT 1 FROM establishments e WHERE e.facility_code = f.facility_code
           AND (e.is_active = 0 OR COALESCE(e.last_visit_date, '') >= ?))
     ORDER BY f.serial_no ASC`,
    [prev.id, `${prev.plan_month}-01`]
  );
  const seen = new Set();
  const unique = rows.filter((r) => {
    if (seen.has(r.facility_code)) return false;
    seen.add(r.facility_code);
    return true;
  });
  return { prev, rows: unique };
}

async function previewMonthlyPlan(ym) {
  const rows = await dueEstablishments(ym);
  const { rows: leftovers } = await unfinishedFromPrevious(ym);
  const codes = new Set(rows.map((r) => r.facility_code));
  const byCenter = {};
  rows.forEach((r) => { byCenter[r.center] = (byCenter[r.center] || 0) + 1; });
  let extra = 0;
  leftovers.forEach((r) => {
    if (codes.has(r.facility_code)) return;
    extra += 1;
    byCenter[r.center] = (byCenter[r.center] || 0) + 1;
  });
  const existing = await queryOne('SELECT id FROM plans WHERE plan_month = ?', [ym]);
  return {
    plan_month: ym, month_label: monthLabel(ym), total: rows.length + extra,
    carried: leftovers.length, by_center: byCenter, exists: Boolean(existing),
  };
}

// Moves every unfinished row of the previous month's plan into the plan of `ym`.
// Idempotent: a facility code already present in the target plan is never added twice.
// Chained by construction: a carried row that is left unfinished is carried again the month after.
async function carryOverUnfinished(ym, { userName = 'النظام', userId = 'system' } = {}) {
  const target = await queryOne('SELECT * FROM plans WHERE plan_month = ?', [ym]);
  if (!target) return { carried: 0, reason: 'no_plan' };
  const { prev, rows } = await unfinishedFromPrevious(ym);
  if (!prev || rows.length === 0) return { carried: 0, from: prev ? prev.plan_month : null };

  const existing = await queryAll('SELECT facility_code FROM facilities WHERE plan_id = ?', [target.id]);
  const have = new Set(existing.map((r) => r.facility_code));
  const todo = rows.filter((r) => !have.has(r.facility_code));
  if (todo.length === 0) return { carried: 0, from: prev.plan_month };

  const now = new Date().toISOString();
  const note = `مرحّلة من ${prev.month_label}`;
  await transaction(async ({ run: tRun, queryOne: tOne }) => {
    const max = await tOne('SELECT COALESCE(MAX(serial_no), 0) AS m FROM facilities WHERE plan_id = ?', [target.id]);
    let serial = Number(max.m) || 0;
    const CHUNK = 40;
    for (let i = 0; i < todo.length; i += CHUNK) {
      const chunk = todo.slice(i, i + CHUNK);
      const clauses = [];
      const params = [];
      for (const f of chunk) {
        serial += 1;
        clauses.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?)");
        params.push(uuidv4(), target.id, serial, f.name, f.address || '', f.center, f.facility_code,
          f.target_date || '', note, f.activity_type || '', now, prev.plan_month);
      }
      await tRun(
        `INSERT INTO facilities (id, plan_id, serial_no, name, address, center, facility_code, target_date, plan_notes, activity_type, status, updated_at, carried_from)
         VALUES ${clauses.join(', ')}`,
        params
      );
    }
    await tRun('UPDATE plans SET total_facilities = (SELECT COUNT(*) FROM facilities WHERE plan_id = ?) WHERE id = ?', [target.id, target.id]);
    await tRun(
      `INSERT INTO activity_feed (id, plan_id, facility_id, facility_name, center, worker_id, worker_name, action, summary, created_at)
       VALUES (?, ?, NULL, ?, '', ?, ?, 'carried_over', ?, ?)`,
      [uuidv4(), target.id, target.month_label, userId, userName,
        `تم ترحيل ${todo.length} منشأة لم تتم من ${prev.month_label} إلى ${target.month_label}`, now]
    );
  });
  return { carried: todo.length, from: prev.plan_month };
}

// Idempotent: returns { created:false } if the month already has a plan.
async function generateMonthlyPlan(ym, { generatedBy = 'auto', userName = 'النظام' } = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw new Error('صيغة الشهر غير صحيحة');
  const label = monthLabel(ym);
  const existing = await queryOne('SELECT * FROM plans WHERE plan_month = ? OR month_label = ?', [ym, label]);
  if (existing) return { created: false, plan: existing };

  const rows = await dueEstablishments(ym);
  const { prev, rows: leftovers } = await unfinishedFromPrevious(ym);
  if (rows.length === 0 && leftovers.length === 0) return { created: false, plan: null, empty: true };
  const leftoverCodes = new Set(leftovers.map((r) => r.facility_code));
  const carriedNote = prev ? `مرحّلة من ${prev.month_label}` : '';

  const planId = uuidv4();
  const now = new Date().toISOString();
  try {
    await transaction(async ({ run: tRun }) => {
      await tRun(
        `INSERT INTO plans (id, month_label, filename, uploaded_by, total_facilities, created_at, plan_month, generated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [planId, label, 'auto-generated', userName, rows.length, now, ym, generatedBy]
      );
      const CHUNK = 40;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const clauses = [];
        const params = [];
        chunk.forEach((e, j) => {
          const carried = leftoverCodes.has(e.facility_code);
          clauses.push("(?, ?, ?, ?, ?, ?, ?, '', ?, ?, 'available', ?, ?)");
          params.push(uuidv4(), planId, i + j + 1, e.name, e.address || '', e.center, e.facility_code,
            carried ? carriedNote : '', e.activity_type || '', now, carried ? prev.plan_month : '');
        });
        await tRun(
          `INSERT INTO facilities (id, plan_id, serial_no, name, address, center, facility_code, target_date, plan_notes, activity_type, status, updated_at, carried_from)
           VALUES ${clauses.join(', ')}`,
          params
        );
      }
      if (rows.length) {
        await tRun(
          `UPDATE establishments SET reinspect_flag = 0 WHERE facility_code IN (${rows.map(() => '?').join(',')})`,
          rows.map((r) => r.facility_code)
        );
      }
    });
  } catch (err) {
    // Lost a race against another generator (unique plan_month index) — treat as already created.
    const again = await queryOne('SELECT * FROM plans WHERE plan_month = ?', [ym]);
    if (again) return { created: false, plan: again };
    throw err;
  }
  // Leftovers that are not in the registry's due list (e.g. rows that came from an uploaded plan)
  const extra = await carryOverUnfinished(ym, { userName });
  return {
    created: true,
    plan: await queryOne('SELECT * FROM plans WHERE id = ?', [planId]),
    total: rows.length + extra.carried,
    carried: leftovers.length,
  };
}

// Make sure the current month has a plan and holds everything left over from last month.
async function ensureCurrentMonth() {
  const ym = currentYm();
  const gen = await generateMonthlyPlan(ym, { generatedBy: 'auto' });
  if (gen.created) return { month: ym, created: true, carried: gen.carried || 0 };
  const carry = await carryOverUnfinished(ym);
  return { month: ym, created: false, carried: carry.carried };
}

module.exports = {
  MONTHS_AR, monthLabel, currentYm, addMonths, ymFromLabel, dueCutoff,
  previewMonthlyPlan, generateMonthlyPlan, carryOverUnfinished, ensureCurrentMonth,
};
