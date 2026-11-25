// Builds the plan PDF in the browser. The browser shapes Arabic text and RTL correctly, so each A4 page is laid
// out as HTML (Cairo font), rasterised with html2canvas, and placed into a jsPDF document.
import type { PlanReport, ReportRow, ReportState } from '../types';

const PAGE_W = 1123; // A4 landscape at 96 dpi
const PAGE_H = 794;
const PAD = 36;
const HEADER_H = 92;
const FOOTER_H = 34;
const TABLE_HEAD_H = 40;
const SUMMARY_H = 96;

const BRAND = '#006B9F';
const BRAND_DARK = '#004F76';
const INK = '#0F293A';

export const STATE_COLORS: Record<ReportState, { bg: string; fg: string }> = {
  done: { bg: '#E6F4EA', fg: '#1E7B34' },
  in_progress: { bg: '#FFF4E0', fg: '#B45309' },
  pending: { bg: '#F1F5F9', fg: '#475569' },
  failed: { bg: '#FDECEC', fg: '#B91C1C' },
};

// Column widths in px (RTL order: first column sits on the right)
const COL_WIDTHS: Record<string, number> = {
  n: 44, name: 262, code: 92, address: 284, center: 124, last_visit: 108, status: 137,
};

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function cellHtml(row: ReportRow, key: string): string {
  if (key === 'status') {
    const c = STATE_COLORS[row.state];
    return `<span style="display:inline-block;padding:3px 8px;border-radius:999px;background:${c.bg};color:${c.fg};font-weight:700;font-size:11.5px;line-height:1.5">${esc(row.status)}</span>`;
  }
  if (key === 'last_visit' && row.last_visit === 'لم تُعاين') return `<span style="color:#94A3B8">${esc(row.last_visit)}</span>`;
  if (key === 'name') return `<strong style="font-weight:700">${esc(row.name)}</strong>`;
  return esc((row as unknown as Record<string, unknown>)[key]);
}

const CENTERED = new Set(['n', 'code', 'center', 'last_visit', 'status']);

function tableHead(report: PlanReport): string {
  return `<tr>${report.columns
    .map((c) => `<th style="width:${COL_WIDTHS[c.key]}px;background:${BRAND};color:#fff;font-weight:700;font-size:13px;padding:0 8px;height:${TABLE_HEAD_H}px;border:1px solid #0B5C86;text-align:center">${esc(c.header)}</th>`)
    .join('')}</tr>`;
}

function rowHtml(report: PlanReport, row: ReportRow, i: number): string {
  const bg = i % 2 ? '#F7FAFC' : '#FFFFFF';
  return `<tr style="background:${bg}">${report.columns
    .map((c) => `<td style="padding:7px 8px;border:1px solid #D7E2EB;font-size:12.5px;line-height:1.55;color:${INK};vertical-align:middle;text-align:${CENTERED.has(c.key) ? 'center' : 'right'};word-break:break-word">${cellHtml(row, c.key)}</td>`)
    .join('')}</tr>`;
}

function pageShell(report: PlanReport, body: string, pageNo: number, pages: number, logo: string): string {
  return `
  <div style="width:${PAGE_W}px;height:${PAGE_H}px;box-sizing:border-box;padding:${PAD}px ${PAD}px 0;background:#fff;direction:rtl;font-family:Cairo, 'Noto Sans Arabic', Arial, sans-serif;color:${INK};position:relative;overflow:hidden">
    <div style="height:${HEADER_H - 16}px;display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid ${BRAND};margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:14px">
        ${logo ? `<img src="${logo}" style="width:54px;height:54px;border-radius:12px;object-fit:cover" />` : ''}
        <div>
          <div style="font-size:19px;font-weight:800;color:${BRAND_DARK};line-height:1.3">${esc(report.company)}</div>
          <div style="font-size:15px;font-weight:700;color:${BRAND};line-height:1.4">${esc(report.title)}</div>
        </div>
      </div>
      <div style="text-align:left;font-size:12px;color:#475569;line-height:1.8">
        <div>المدينة: <strong style="color:${INK}">${esc(report.scope_label)}</strong></div>
        <div>تاريخ التصدير: <strong style="color:${INK}">${esc(report.exported_at)}</strong></div>
      </div>
    </div>
    ${body}
    <div style="position:absolute;bottom:0;left:${PAD}px;right:${PAD}px;height:${FOOTER_H}px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid #D7E2EB;font-size:11px;color:#64748B">
      <span>${esc(report.company)} — ${esc(report.title)}</span>
      <span>صفحة ${pageNo} من ${pages}</span>
    </div>
  </div>`;
}

function summaryHtml(report: PlanReport): string {
  const s = report.summary;
  const items: [string, string | number, string][] = [
    ['إجمالي المنشآت', s.total, BRAND_DARK],
    ['تمت', s.done, STATE_COLORS.done.fg],
    ['جارية', s.in_progress, STATE_COLORS.in_progress.fg],
    ['لم تتم', s.pending, STATE_COLORS.failed.fg],
    ['مرحّلة من شهر سابق', s.carried, '#475569'],
    ['نسبة الإنجاز', `${s.rate}%`, BRAND],
  ];
  return `<div style="display:flex;gap:10px;margin-top:14px">${items
    .map(([l, v, c]) => `<div style="flex:1;border:1px solid #D7E2EB;border-radius:12px;padding:10px 6px;text-align:center;background:#F7FAFC">
        <div style="font-size:22px;font-weight:800;color:${c};line-height:1.3">${esc(v)}</div>
        <div style="font-size:11.5px;color:#475569;font-weight:600">${esc(l)}</div></div>`)
    .join('')}</div>`;
}

async function loadLogo(): Promise<string> {
  try {
    const res = await fetch('/logo.jpg');
    if (!res.ok) return '';
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => resolve('');
      r.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

// Measure every row at the final column widths, then pack rows into pages.
function paginate(report: PlanReport, host: HTMLElement): ReportRow[][] {
  const probe = document.createElement('table');
  probe.style.cssText = `width:${PAGE_W - PAD * 2}px;border-collapse:collapse;table-layout:fixed;font-family:Cairo, Arial, sans-serif;direction:rtl`;
  probe.innerHTML = `<thead>${tableHead(report)}</thead><tbody>${report.rows.map((r, i) => rowHtml(report, r, i)).join('')}</tbody>`;
  host.appendChild(probe);
  const heights = Array.from(probe.querySelectorAll('tbody tr')).map((tr) => (tr as HTMLElement).getBoundingClientRect().height);
  host.removeChild(probe);

  const avail = PAGE_H - PAD - HEADER_H - FOOTER_H - TABLE_HEAD_H - 8;
  const pages: ReportRow[][] = [];
  let cur: ReportRow[] = [];
  let used = 0;
  report.rows.forEach((row, i) => {
    const h = heights[i] || 32;
    if (cur.length && used + h > avail) {
      pages.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(row);
    used += h;
  });
  if (cur.length || pages.length === 0) pages.push(cur);
  // Summary goes under the last page's table when it fits, otherwise on its own page
  const lastUsed = used;
  if (lastUsed + SUMMARY_H > avail && cur.length) pages.push([]);
  return pages;
}

export async function exportPlanPdf(report: PlanReport, fileName: string, onProgress?: (pct: number) => void): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  await Promise.all([
    document.fonts.load('400 13px Cairo'),
    document.fonts.load('700 13px Cairo'),
    document.fonts.load('800 13px Cairo'),
  ]).catch(() => undefined);

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;top:0;left:-20000px;width:0;height:0;overflow:visible;pointer-events:none;z-index:-1';
  document.body.appendChild(host);

  try {
    const logo = await loadLogo();
    const pages = paginate(report, host);
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    pdf.setProperties({ title: `${report.company} — ${report.title}`, creator: report.company });

    let rowIndex = 0;
    for (let p = 0; p < pages.length; p++) {
      const rows = pages[p];
      const isLast = p === pages.length - 1;
      const table = rows.length
        ? `<table style="width:100%;border-collapse:collapse;table-layout:fixed"><thead>${tableHead(report)}</thead><tbody>${rows
            .map((r) => rowHtml(report, r, rowIndex++))
            .join('')}</tbody></table>`
        : report.rows.length === 0
          ? '<div style="padding:60px;text-align:center;color:#64748B;font-size:15px">لا توجد منشآت في هذه الخطة</div>'
          : '';
      const body = table + (isLast ? summaryHtml(report) : '');
      const page = document.createElement('div');
      page.innerHTML = pageShell(report, body, p + 1, pages.length, logo);
      host.appendChild(page);
      const el = page.firstElementChild as HTMLElement;
      await Promise.all(Array.from(el.querySelectorAll('img')).map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
      const canvas = await html2canvas(el, { scale: 1.6, backgroundColor: '#FFFFFF', logging: false, useCORS: true, width: PAGE_W, height: PAGE_H });
      if (p > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.86), 'JPEG', 0, 0, pw, ph, undefined, 'FAST');
      host.removeChild(page);
      onProgress?.(Math.round(((p + 1) / pages.length) * 100));
      await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
    }
    pdf.save(fileName);
  } finally {
    document.body.removeChild(host);
  }
}
