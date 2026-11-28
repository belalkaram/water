// Usage: node src/scripts/importEstablishments.js [--dry-run] [--docs <dir>] [--today YYYY-MM-DD] [--through YYYY-MM]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { initDb, queryAll, run } = require('../db');
const { detectActivityType } = require('../utils/centerParser');
const { normalizePhone } = require('../utils/phone');
const { generateMonthlyPlan } = require('../utils/monthlyPlan');
const C = require('../constants');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const argVal = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const DOCS = path.resolve(argVal('--docs', path.join(__dirname, '../../../docs')));
const TODAY = argVal('--today', new Date().toISOString().slice(0, 10));
const PLAN_MONTH = argVal('--through', '2026-12');

// file-name keyword → official center (most specific first)
const FILE_CENTER = [
  ['المنطقة الصناعية', 'قويسنا المنطقة الصناعية'],
  ['قويسنا', 'قويسنا'], ['اشمون', 'أشمون'], ['الباجور', 'الباجور'], ['الشهداء', 'الشهداء'],
  ['بركة', 'بركة السبع'], ['تلا', 'تلا'], ['سرس', 'سرس الليان'], ['شبين', 'شبين الكوم'], ['منوف', 'منوف'],
];

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Closed = out of service / no sewer discharge.
// Any status that says "مغلق" counts as closed, including "مغلق اثناء المعاينة" (owner's decision).
function isClosed(status) {
  const s = norm(status).toLowerCase();
  if (!s) return false;
  if (s.includes('close')) return true;
  if (s.includes('مغلق') || s.includes('غلق')) return true;
  if (/تغير النشاط|تغيير النشاط|محطة غاز|الغاء|لا ?يوجد صرف|غير مخدوم|لم يتم التوصيل/.test(s)) return true;
  return false;
}

function parseDate(v, issues, ctx) {
  if (v === null || v === undefined || v === '') return '';
  let d = null;
  if (v instanceof Date) d = new Date(v.getTime() + 12 * 3600e3); // avoid xlsx timezone drift
  else if (typeof v === 'number') d = new Date(Math.round((v - 25569) * 86400e3) + 12 * 3600e3);
  if (!d || isNaN(d) || d.getUTCFullYear() < 2015 || d.getUTCFullYear() > 2100) {
    issues.push(`${ctx}: تاريخ غير صالح (${String(v).slice(0, 30)}) — اعتُبر بدون تاريخ`);
    return '';
  }
  const iso = d.toISOString().slice(0, 10);
  if (iso > TODAY) {
    issues.push(`${ctx}: تاريخ مستقبلي (${iso}) — اعتُبر بدون تاريخ`);
    return '';
  }
  return iso;
}

function readFile(file, issues) {
  const center = FILE_CENTER.find(([k]) => file.includes(k))?.[1];
  if (!center) throw new Error('ملف غير معروف المدينة: ' + file);
  const wb = xlsx.readFile(path.join(DOCS, file), { cellDates: true });
  // A file can hold several establishment sheets (e.g. "صناعى" + "ادمى") — read every one of them.
  const sheets = [];
  const out = [];
  for (const sn of wb.SheetNames) {
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, raw: true });
    const hi = rows.slice(0, 25).findIndex((r) => {
      const t = r.map(norm).join('|');
      return t.includes('الكود') && t.includes('حالة النشاط') && t.includes('مرور');
    });
    if (hi < 0) continue;
    const H = {};
    rows[hi].forEach((c, j) => { if (c) H[norm(c)] = j; });
    const col = (...ks) => { for (const [h, j] of Object.entries(H)) if (ks.some((k) => h.includes(k))) return j; return -1; };
    const ix = {
      name: col('اسم'), addr: col('عنوان'), code: col('الكود'), status: col('حالة النشاط'), owner: col('صاحب'),
      act: col('النشاط والمواد'), phone: col('وسيلة الاتصال'), last: col('مرور'), water: col('كمية المياه'), unit: col('وحدة المعالجة'),
    };
    const before = out.length;
    for (let r = hi + 1; r < rows.length; r++) {
      const row = rows[r];
      const name = norm(row[ix.name]);
      if (!name) continue;
      const ctx = `${file} / ${sn} (سطر ${r + 1}) ${name}`;
      const code = norm(row[ix.code]).toUpperCase();
      if (!code) { issues.push(`${ctx}: بدون كود (ترويسة/تذييل صفحة وليست منشأة) — تم تجاهله`); continue; }
      const status = norm(row[ix.status]);
      if (!status) issues.push(`${ctx}: حالة النشاط فارغة — اعتُبرت مفتوحة`);
      const actText = ix.act >= 0 ? norm(row[ix.act]) : '';
      out.push({
        code, name, center, status, closed: isClosed(status),
        address: norm(row[ix.addr]), owner: norm(row[ix.owner]), phone: norm(normalizePhone(row[ix.phone])),
        activity: detectActivityType(`${name} ${actText}`) || 'أخرى',
        last: parseDate(row[ix.last], issues, ctx),
        water: norm(row[ix.water]), unit: norm(row[ix.unit]), file, sheet: sn,
      });
    }
    sheets.push(`${sn}=${out.length - before}`);
  }
  if (!sheets.length) throw new Error('لم يتم العثور على شيت المنشآت في ' + file);
  return { sheets, center, rows: out };
}

// One record per code. If the code is closed anywhere (any sheet / file) it is closed;
// otherwise the first open occurrence is kept.
function mergeByCode(all, issues) {
  const groups = new Map();
  for (const r of all) {
    if (!groups.has(r.code)) groups.set(r.code, []);
    groups.get(r.code).push(r);
  }
  const merged = [];
  for (const [code, rows] of groups) {
    if (rows.length > 1) {
      const where = rows.map((r) => `${r.file}/${r.sheet} "${r.name}" [${r.status || 'فارغ'}]`).join(' | ');
      const names = new Set(rows.map((r) => r.name));
      issues.push(`كود مكرر ${code}${names.size > 1 ? ' (أسماء مختلفة!)' : ''}: ${where}`);
    }
    const closed = rows.find((r) => r.closed);
    merged.push(closed ? { ...rows.find((r) => !r.closed) || closed, closed: true, status: closed.status } : rows[0]);
  }
  return merged;
}

(async () => {
  const issues = [];
  const files = fs.readdirSync(DOCS).filter((f) => /\.xls[xm]?$/i.test(f) && !f.startsWith('~$'));
  const raw = [];
  console.log(`📂 ${files.length} ملف في ${DOCS}${DRY ? ' (dry-run)' : ''}`);
  for (const f of files) {
    const { sheets, center, rows } = readFile(f, issues);
    const open = rows.filter((r) => !r.closed);
    console.log(`  ${center.padEnd(24)} شيتات [${sheets.join(', ')}]: ${rows.length} صف → ${open.length} مفتوح / ${rows.length - open.length} مغلق`);
    raw.push(...rows);
  }
  const all = mergeByCode(raw, issues);
  const open = all.filter((r) => !r.closed);
  const closedStatuses = {};
  all.filter((r) => r.closed).forEach((r) => { closedStatuses[r.status] = (closedStatuses[r.status] || 0) + 1; });
  console.log(`\nالإجمالي: ${all.length} | مفتوح (يُستورد): ${open.length} | مغلق (يُستبعد): ${all.length - open.length}`);
  console.log('الحالات المستبعدة:', JSON.stringify(closedStatuses));
  const keptOdd = {};
  open.filter((r) => r.status.toLowerCase() !== 'open').forEach((r) => { keptOdd[r.status || '(فارغ)'] = (keptOdd[r.status || '(فارغ)'] || 0) + 1; });
  console.log('حالات غير Open لكن مُدرجة:', JSON.stringify(keptOdd));
  if (open.some((r) => !C.OFFICIAL_CENTERS.includes(r.center))) throw new Error('مدينة غير رسمية!');
  console.log(`\n⚠️  ملاحظات على البيانات (${issues.length}):`);
  issues.forEach((i) => console.log('  - ' + i));

  if (DRY) {
    const { dueCutoff } = require('../utils/monthlyPlan');
    for (const ym of ['2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05']) {
      const cut = dueCutoff(ym);
      console.log(`  ${ym}: مستحق (آخر مرور < ${cut} أو فارغ) = ${open.filter((r) => !r.last || r.last < cut).length}`);
    }
    console.log('\n(dry-run: لم يُكتب أي شيء)');
    process.exit(0);
  }

  await initDb();
  const now = new Date().toISOString();
  for (const r of open) {
    await run(
      `INSERT INTO establishments (id, facility_code, name, address, center, activity_type, owner, phone, water_qty, treatment_unit,
                                   status_raw, is_active, last_visit_date, baseline_visit_date, source_file, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT (facility_code) DO UPDATE SET
         name = EXCLUDED.name, address = EXCLUDED.address, center = EXCLUDED.center, activity_type = EXCLUDED.activity_type,
         owner = EXCLUDED.owner, phone = EXCLUDED.phone, water_qty = EXCLUDED.water_qty, treatment_unit = EXCLUDED.treatment_unit,
         status_raw = EXCLUDED.status_raw, is_active = 1, source_file = EXCLUDED.source_file, updated_at = EXCLUDED.updated_at,
         baseline_visit_date = EXCLUDED.baseline_visit_date`,
      [uuidv4(), r.code, r.name, r.address, r.center, r.activity, r.owner, r.phone, r.water, r.unit, r.status, r.last, r.last, r.file, now, now]
    );
  }
  for (const r of all.filter((x) => x.closed)) {
    await run('UPDATE establishments SET is_active = 0, status_raw = ? WHERE facility_code = ?', [r.status, r.code]);
  }

  // last visit = latest of (Excel baseline, valid inspections made in the system)
  await run(
    `UPDATE establishments e SET last_visit_date = GREATEST(COALESCE(e.baseline_visit_date, ''), COALESCE((
       SELECT MAX(SUBSTRING(i.created_at, 1, 10)) FROM inspections i JOIN facilities f ON f.id = i.facility_id
       WHERE f.facility_code = e.facility_code AND i.record_status = 'valid' AND i.visit_outcome = 'inspected'), ''))`
  );

  const est = await queryAll('SELECT center, COUNT(*) AS n FROM establishments WHERE is_active = 1 GROUP BY center ORDER BY center');
  console.log('\n✅ السجل الدائم:', est.map((e) => `${e.center}=${e.n}`).join(' | '));

  const res = await generateMonthlyPlan(PLAN_MONTH, { generatedBy: 'import', userName: 'استيراد الإكسيل' });
  console.log(res.created ? `✅ تم توليد ${res.plan.month_label}: ${res.total} منشأة` : `ℹ️ خطة ${PLAN_MONTH} موجودة مسبقاً`);
  process.exit(0);
})().catch((e) => { console.error('❌', e); process.exit(1); });
