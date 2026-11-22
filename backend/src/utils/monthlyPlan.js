const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, transaction } = require('../db');
const C = require('../constants');

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `خطة ${MONTHS_AR[m - 1]} ${y}`;
}

function currentYm(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// A facility is due in month M when its last visit is on or before the end of month (M - 6),
// i.e. strictly before the 1st of month (M - 5). Empty last_visit => always due.
function dueCutoff(ym) {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) - (C.REVISIT_MONTHS - 1);
  const cy = Math.floor(idx / 12);
  const cm = (idx % 12) + 1;
  return `${cy}-${String(cm).padStart(2, '0')}-01`;
}

async function dueEstablishments(ym) {
  const cutoff = dueCutoff(ym);
  return queryAll(
    `SELECT * FROM establishments
     WHERE is_active = 1 AND (last_visit_date = '' OR last_visit_date IS NULL OR last_visit_date < ?)
     ORDER BY center, facility_code`,
    [cutoff]
  );
}

async function previewMonthlyPlan(ym) {
  const rows = await dueEstablishments(ym);
  const byCenter = {};
  rows.forEach((r) => { byCenter[r.center] = (byCenter[r.center] || 0) + 1; });
  const existing = await queryOne('SELECT id FROM plans WHERE plan_month = ?', [ym]);
  return { plan_month: ym, month_label: monthLabel(ym), total: rows.length, by_center: byCenter, exists: Boolean(existing) };
}

// Idempotent: returns { created:false } if the month already has a plan.
async function generateMonthlyPlan(ym, { generatedBy = 'auto', userName = 'النظام' } = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw new Error('صيغة الشهر غير صحيحة');
  const label = monthLabel(ym);
  const existing = await queryOne('SELECT * FROM plans WHERE plan_month = ? OR month_label = ?', [ym, label]);
  if (existing) return { created: false, plan: existing };

  const rows = await dueEstablishments(ym);
  if (rows.length === 0) return { created: false, plan: null, empty: true };

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
          clauses.push("(?, ?, ?, ?, ?, ?, ?, '', '', ?, 'available', ?)");
          params.push(uuidv4(), planId, i + j + 1, e.name, e.address || '', e.center, e.facility_code, e.activity_type || '', now);
        });
        await tRun(
          `INSERT INTO facilities (id, plan_id, serial_no, name, address, center, facility_code, target_date, plan_notes, activity_type, status, updated_at)
           VALUES ${clauses.join(', ')}`,
          params
        );
      }
    });
  } catch (err) {
    // Lost a race against another generator (unique plan_month index) — treat as already created.
    const again = await queryOne('SELECT * FROM plans WHERE plan_month = ?', [ym]);
    if (again) return { created: false, plan: again };
    throw err;
  }
  return { created: true, plan: await queryOne('SELECT * FROM plans WHERE id = ?', [planId]), total: rows.length };
}

module.exports = { MONTHS_AR, monthLabel, currentYm, dueCutoff, previewMonthlyPlan, generateMonthlyPlan };
