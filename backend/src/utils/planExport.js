// Plan report shared by the Excel export (built here) and the PDF export (built in the browser).
// Columns are fixed on purpose: اسم المنشأة، الكود، العنوان، المدينة، تاريخ آخر معاينة، حالة الخطة.
const ExcelJS = require('exceljs');
const { queryAll } = require('../db');
const C = require('../constants');

const COMPANY = 'شركة مياه الشرب والصرف الصحي بالمنوفية';

const COLUMNS = [
  { key: 'n', header: 'م', width: 7 },
  { key: 'name', header: 'اسم المنشأة', width: 44 },
  { key: 'code', header: 'الكود', width: 15 },
  { key: 'address', header: 'العنوان', width: 52 },
  { key: 'center', header: 'المدينة', width: 24 },
  { key: 'last_visit', header: 'تاريخ آخر معاينة', width: 19 },
  { key: 'status', header: 'حالة الخطة', width: 30 },
];

// state -> colors used by both Excel and PDF
const STATUS_STYLE = {
  done: { fill: 'E6F4EA', font: '1E7B34' },
  in_progress: { fill: 'FFF4E0', font: 'B45309' },
  pending: { fill: 'F1F5F9', font: '475569' },
  failed: { fill: 'FDECEC', font: 'B91C1C' },
};

function statusOf(f) {
  if (f.status === 'completed') {
    if (!f.visit_outcome || f.visit_outcome === 'inspected') return { state: 'done', label: 'تمت' };
    return { state: 'failed', label: `لم تتم — ${C.OUTCOME_LABELS[f.visit_outcome] || 'زيارة غير مكتملة'}` };
  }
  if (f.status === 'reserved') return { state: 'in_progress', label: 'جارية (في الطريق)' };
  return { state: 'pending', label: 'لم تتم' };
}

// YYYY-MM-DD -> DD/MM/YYYY
function formatDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function exportStamp(d = new Date()) {
  const local = new Date(d.getTime() + 2 * 3600 * 1000).toISOString();
  return `${formatDate(local.slice(0, 10))} — ${local.slice(11, 16)}`;
}

/**
 * Rows of the plan report. `scope` is the SQL fragment from centerScope() (worker = own cities only).
 * Last visit comes live from the permanent registry, so it reflects inspections the moment they are saved.
 */
async function buildPlanReport(plan, scope, center) {
  const facilities = await queryAll(
    `SELECT f.*, e.last_visit_date AS est_last_visit FROM facilities f
     LEFT JOIN establishments e ON e.facility_code = f.facility_code
     WHERE f.plan_id = ?${scope.sql}${center ? ' AND f.center = ?' : ''}
     ORDER BY f.center, f.serial_no ASC`,
    [plan.id, ...scope.params, ...(center ? [center] : [])]
  );
  // Facilities not in the registry (uploaded plans): fall back to their newest valid inspection day
  const missing = facilities.filter((f) => !f.est_last_visit).map((f) => f.facility_code);
  const fallback = {};
  if (missing.length) {
    const found = await queryAll(
      `SELECT f.facility_code AS code, MAX(COALESCE(NULLIF(i.visit_date, ''), SUBSTRING(i.created_at, 1, 10))) AS d
       FROM inspections i JOIN facilities f ON f.id = i.facility_id
       WHERE i.record_status = 'valid' AND i.visit_outcome = 'inspected'
         AND f.facility_code IN (${missing.map(() => '?').join(',')})
       GROUP BY f.facility_code`,
      missing
    );
    found.forEach((r) => { fallback[r.code] = r.d; });
  }

  const rows = facilities.map((f, idx) => {
    const st = statusOf(f);
    const last = f.est_last_visit || fallback[f.facility_code] || '';
    return {
      n: idx + 1,
      name: f.name,
      code: f.facility_code,
      address: f.address || '',
      center: f.center,
      last_visit: last ? formatDate(last) : 'لم تُعاين',
      status: st.label,
      state: st.state,
      carried: Boolean(f.carried_from),
    };
  });
  const count = (s) => rows.filter((r) => r.state === s).length;
  const summary = {
    total: rows.length,
    done: count('done'),
    in_progress: count('in_progress'),
    pending: count('pending') + count('failed'),
    carried: rows.filter((r) => r.carried).length,
  };
  summary.rate = summary.total ? Math.round((summary.done / summary.total) * 100) : 0;

  return {
    company: COMPANY,
    title: plan.month_label,
    plan_month: plan.plan_month || '',
    scope_label: center || 'كل المدن',
    exported_at: exportStamp(),
    columns: COLUMNS.map(({ key, header }) => ({ key, header })),
    rows,
    summary,
  };
}

const FONT = 'Arial';
const BRAND = '006B9F';
const BRAND_DARK = '004F76';
const BORDER = { style: 'thin', color: { argb: 'FFC9D6E2' } };
const ALL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

function argb(hex) { return `FF${hex}`; }

async function buildPlanWorkbook(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY;
  wb.created = new Date();
  wb.views = [{ rtl: true }];

  const ws = wb.addWorksheet(report.title.slice(0, 31), {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 4, showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.25, footer: 0.25 },
      printTitlesRow: '4:4',
    },
    headerFooter: { oddFooter: '&Cصفحة &P من &N' },
  });
  ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));
  const lastCol = COLUMNS.length;

  // Row 1 — title
  ws.mergeCells(1, 1, 1, lastCol);
  const t = ws.getCell(1, 1);
  t.value = `${report.company} — ${report.title}`;
  t.font = { name: FONT, size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND_DARK) } };
  t.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
  ws.getRow(1).height = 36;

  // Row 2 — scope + export time
  ws.mergeCells(2, 1, 2, lastCol);
  const info = ws.getCell(2, 1);
  info.value = `المدينة: ${report.scope_label}     •     عدد المنشآت: ${report.summary.total}     •     تاريخ التصدير: ${report.exported_at}`;
  info.font = { name: FONT, size: 11, color: { argb: 'FF334155' } };
  info.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3F9' } };
  info.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
  ws.getRow(2).height = 24;
  ws.getRow(3).height = 6;

  // Row 4 — header
  const header = ws.getRow(4);
  COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: FONT, size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND) } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
    cell.border = ALL_BORDERS;
  });
  header.height = 30;

  // Data
  report.rows.forEach((r, idx) => {
    const row = ws.addRow({ n: r.n, name: r.name, code: r.code, address: r.address, center: r.center, last_visit: r.last_visit, status: r.status });
    const zebra = idx % 2 === 1 ? 'FFF7FAFC' : 'FFFFFFFF';
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = COLUMNS[col - 1].key;
      const centered = ['n', 'code', 'center', 'last_visit', 'status'].includes(key);
      cell.font = { name: FONT, size: 11, color: { argb: 'FF0F293A' }, bold: key === 'name' };
      cell.alignment = { horizontal: centered ? 'center' : 'right', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
      cell.border = ALL_BORDERS;
    });
    const sc = row.getCell(lastCol);
    const style = STATUS_STYLE[r.state];
    sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(style.fill) } };
    sc.font = { name: FONT, size: 11, bold: true, color: { argb: argb(style.font) } };
    if (r.last_visit === 'لم تُعاين') row.getCell(6).font = { name: FONT, size: 11, italic: true, color: { argb: 'FF94A3B8' } };
    // Long names/addresses wrap onto extra lines — give the row room so nothing is cut off
    const lines = Math.max(1, Math.ceil(String(r.name).length / 40), Math.ceil(String(r.address).length / 48));
    row.height = Math.max(24, 16 * lines + 8);
  });

  if (report.rows.length) {
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + report.rows.length, column: lastCol } };
  }

  // Summary block
  const s = report.summary;
  ws.addRow([]);
  const items = [
    ['إجمالي منشآت الخطة', s.total],
    ['تمت', s.done],
    ['جارية (في الطريق)', s.in_progress],
    ['لم تتم', s.pending],
    ['منها مرحّلة من شهر سابق', s.carried],
    ['نسبة الإنجاز', `${s.rate}%`],
  ];
  items.forEach(([label, value], i) => {
    const row = ws.addRow([]);
    ws.mergeCells(row.number, 2, row.number, 3);
    const l = row.getCell(2);
    l.value = label;
    l.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    l.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(i === items.length - 1 ? BRAND_DARK : BRAND) } };
    l.alignment = { horizontal: 'right', vertical: 'middle', indent: 1, readingOrder: 'rtl' };
    l.border = ALL_BORDERS;
    const v = row.getCell(4);
    v.value = value;
    v.font = { name: FONT, size: 12, bold: true, color: { argb: 'FF0F293A' } };
    v.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3F9' } };
    v.alignment = { horizontal: 'center', vertical: 'middle' };
    v.border = ALL_BORDERS;
    row.height = 24;
  });

  return wb.xlsx.writeBuffer();
}

function reportFileName(report, ext) {
  const base = `${report.title.replace(/^خطة\s*/, 'خطة-')}${report.scope_label !== 'كل المدن' ? `-${report.scope_label}` : ''}`
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '-');
  return `${base}.${ext}`;
}

// ─── Full establishments registry (the «عرض المنشآت» page) ─────────────────────
const EST_COLUMNS = [
  { key: 'n', header: 'م', width: 7 },
  { key: 'facility_code', header: 'الكود', width: 12 },
  { key: 'name', header: 'اسم المنشأة', width: 40 },
  { key: 'center', header: 'المدينة', width: 22 },
  { key: 'address', header: 'العنوان', width: 46 },
  { key: 'activity_type', header: 'النشاط', width: 14 },
  { key: 'owner', header: 'صاحب المنشأة', width: 26 },
  { key: 'phone', header: 'التليفون', width: 18 },
  { key: 'last_visit', header: 'تاريخ آخر مرور', width: 16 },
  { key: 'water_qty', header: 'كمية المياه (م3/شهر)', width: 16 },
  { key: 'treatment_unit', header: 'وحدة المعالجة', width: 16 },
  { key: 'state', header: 'الحالة', width: 26 },
];
const EST_CENTERED = ['n', 'facility_code', 'center', 'activity_type', 'phone', 'last_visit', 'water_qty', 'treatment_unit', 'state'];

/** Every establishment the user may see (rows already ordered), as one styled sheet. */
async function buildEstablishmentsWorkbook(rows, scopeLabel) {
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY;
  wb.created = new Date();
  wb.views = [{ rtl: true }];
  const ws = wb.addWorksheet('المنشآت', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 4, xSplit: 3, showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.25, footer: 0.25 },
      printTitlesRow: '4:4',
    },
    headerFooter: { oddFooter: '&Cصفحة &P من &N' },
  });
  ws.columns = EST_COLUMNS.map((c) => ({ key: c.key, width: c.width }));
  const lastCol = EST_COLUMNS.length;
  const active = rows.filter((r) => Number(r.is_active) === 1).length;

  ws.mergeCells(1, 1, 1, lastCol);
  const t = ws.getCell(1, 1);
  t.value = `${COMPANY} — سجل المنشآت`;
  t.font = { name: FONT, size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND_DARK) } };
  t.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
  ws.getRow(1).height = 36;

  ws.mergeCells(2, 1, 2, lastCol);
  const info = ws.getCell(2, 1);
  info.value = `المدن: ${scopeLabel}     •     الإجمالي: ${rows.length}  (نشطة ${active} / مغلقة ${rows.length - active})     •     تاريخ التصدير: ${exportStamp()}`;
  info.font = { name: FONT, size: 11, color: { argb: 'FF334155' } };
  info.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3F9' } };
  info.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
  ws.getRow(2).height = 24;
  ws.getRow(3).height = 6;

  const header = ws.getRow(4);
  EST_COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: FONT, size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND) } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
    cell.border = ALL_BORDERS;
  });
  header.height = 32;

  rows.forEach((r, idx) => {
    const isActive = Number(r.is_active) === 1;
    const row = ws.addRow({
      n: idx + 1, facility_code: r.facility_code, name: r.name, center: r.center, address: r.address || '',
      activity_type: r.activity_type || '', owner: r.owner || '', phone: r.phone || '',
      last_visit: formatDate(r.last_visit_date) || 'لم تُعاين', water_qty: r.water_qty || '', treatment_unit: r.treatment_unit || '',
      state: isActive ? 'نشطة' : `مغلقة${r.status_raw ? ` — ${r.status_raw}` : ''}`,
    });
    const zebra = idx % 2 === 1 ? 'FFF7FAFC' : 'FFFFFFFF';
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = EST_COLUMNS[col - 1].key;
      cell.font = { name: FONT, size: 11, color: { argb: 'FF0F293A' }, bold: key === 'name' };
      cell.alignment = { horizontal: EST_CENTERED.includes(key) ? 'center' : 'right', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
      cell.border = ALL_BORDERS;
    });
    const sc = row.getCell(lastCol);
    const style = isActive ? STATUS_STYLE.done : STATUS_STYLE.failed;
    sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(style.fill) } };
    sc.font = { name: FONT, size: 11, bold: true, color: { argb: argb(style.font) } };
    const lines = Math.max(1, Math.ceil(String(r.name).length / 36), Math.ceil(String(r.address || '').length / 42));
    row.height = Math.max(22, 16 * lines + 8);
  });

  if (rows.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: lastCol } };
  return wb.xlsx.writeBuffer();
}

module.exports = { buildPlanReport, buildPlanWorkbook, buildEstablishmentsWorkbook, reportFileName, STATUS_STYLE, COLUMNS };
