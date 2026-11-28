import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { COLORS } from '../theme';
import type { Establishment } from '../types';
import { usePersistedState } from '../utils/usePersistedState';
import { FilterBar } from './FilterBar';
import { MapPinIcon } from './Icons';
import { FacilityCardSkeleton, SkeletonList } from './Skeleton';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  userCode: string;
  /** Start filtered on this city (e.g. the city chosen on the plan screen) */
  initialCenter?: string;
}

const PAGE = 60;
const TABLE_PAGE = 200;
type StatusKey = 'active' | 'closed' | 'all';
const VIEWS = ['table', 'list', 'small', 'large'] as const;
type ViewMode = (typeof VIEWS)[number];

/**
 * View-only page of every establishment in the permanent registry (Excel import + ones employees added).
 * Rendered inside the app's main area (under the top bar, next to the navigation) — not over them.
 */
export const EstablishmentsView: React.FC<Props> = ({ isOpen, onClose, userCode, initialCenter }) => {
  const [rows, setRows] = useState<Establishment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [center, setCenter] = useState('الكل');
  const [status, setStatus] = useState<StatusKey>('active');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [view, setView] = usePersistedState<ViewMode>('establishments_view', 'small', VIEWS);
  const [toast, setToast] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api
      .getEstablishments(userCode)
      .then((r) => {
        const list = [...(r.establishments || [])];
        // natural order: Q1, Q2 … Q10 (not Q1, Q10, Q100)
        list.sort((a, b) => a.center.localeCompare(b.center, 'ar') || a.facility_code.localeCompare(b.facility_code, 'en', { numeric: true }));
        setRows(list);
      })
      .catch((e: any) => setError(e?.message || 'تعذر تحميل المنشآت'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!isOpen) return;
    setCenter(initialCenter && initialCenter !== 'الكل' ? initialCenter : 'الكل');
    load();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const step = view === 'table' ? TABLE_PAGE : PAGE;
  useEffect(() => setLimit(step), [center, status, search, step]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // older browsers / non-secure context
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setToast(`تم نسخ ${what}`);
  };

  const byStatus = useMemo(
    () => rows.filter((r) => (status === 'all' ? true : status === 'active' ? r.is_active : !r.is_active)),
    [rows, status]
  );

  const centers = useMemo(() => {
    const counts: Record<string, number> = {};
    byStatus.forEach((r) => { counts[r.center] = (counts[r.center] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [byStatus]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return byStatus.filter((r) => {
      if (center !== 'الكل' && r.center !== center) return false;
      if (!q) return true;
      return [r.name, r.address, r.facility_code, r.owner, r.phone, r.activity_type].some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [byStatus, center, search]);

  const statusCounts = useMemo(
    () => ({ active: rows.filter((r) => r.is_active).length, closed: rows.filter((r) => !r.is_active).length, all: rows.length }),
    [rows]
  );

  if (!isOpen) return null;
  const host = document.querySelector('.app-main');

  const page = (
    <div
      role="region"
      aria-label="عرض المنشآت"
      className="screen est-page scroll-container"
      style={{
        position: host ? 'absolute' : 'fixed', inset: 0, zIndex: 30, backgroundColor: COLORS.bg,
        overflowY: 'auto', direction: 'rtl', padding: '0 14px 28px',
      }}
    >
      <div className="est-head">
        <button type="button" onClick={onClose} className="est-back" aria-label="رجوع">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
          <span>رجوع</span>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '18px', fontWeight: 800, color: COLORS.ink }}>عرض المنشآت</div>
          <div className="text-ellipsis" style={{ fontSize: '12px', color: COLORS.muted, fontWeight: 600 }}>
            كل المنشآت المسجلة في السيستم — للعرض فقط
          </div>
        </div>
        <div className="est-views" role="group" aria-label="حجم العرض">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              className={view === v ? 'on' : ''}
              onClick={() => setView(v)}
              title={VIEW_TITLES[v]}
            >
              <ViewIcon mode={v} />
            </button>
          ))}
        </div>
      </div>

      <div className="est-actions">
        <button
          type="button"
          className="est-export"
          onClick={() => window.open(api.establishmentsExportUrl(), '_blank')}
          title="تحميل كل المنشآت (النشطة والمغلقة) في شيت Excel منسّق"
        >
          <span className="est-xls">XLS</span>
          <span className="text-ellipsis">تصدير كل المنشآت Excel</span>
        </button>
      </div>

      <FilterBar
        dropdowns={[
          {
            key: 'center',
            label: 'المدينة',
            value: center,
            onChange: setCenter,
            defaultValue: 'الكل',
            options: [
              { value: 'الكل', label: 'كل المدن', badge: byStatus.length },
              ...centers.map(([c, n]) => ({ value: c, label: c, badge: n })),
            ],
          },
        ]}
        search={{ value: search, onChange: setSearch, placeholder: 'ابحث بالاسم، الكود، العنوان أو التليفون...' }}
        segmented={{
          label: 'الحالة',
          value: status,
          onChange: (v) => setStatus(v as StatusKey),
          defaultValue: 'active',
          options: [
            { value: 'active', label: 'نشطة', badge: statusCounts.active },
            { value: 'closed', label: 'مغلقة', badge: statusCounts.closed },
            { value: 'all', label: 'الكل', badge: statusCounts.all },
          ],
        }}
        resultText={loading ? 'جارٍ التحميل…' : `عرض ${filtered.length} من ${rows.length} منشأة`}
      />

      <div style={{ marginTop: '10px' }}>
        {loading ? (
          <SkeletonList count={6}><FacilityCardSkeleton /></SkeletonList>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '30px 10px', color: COLORS.red, fontWeight: 700 }}>
            {error}
            <div>
              <button type="button" onClick={load} className="est-more" style={{ marginTop: '12px', width: 'auto', padding: '10px 18px' }}>
                إعادة المحاولة
              </button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 10px', color: COLORS.muted, fontWeight: 700 }}>لا توجد منشآت مطابقة</div>
        ) : (
          <>
            {view === 'table' ? (
              <EstablishmentsTable rows={filtered.slice(0, limit)} onCopy={copy} />
            ) : (
              <div className={`est-grid est-${view}`}>
                {filtered.slice(0, limit).map((r) => (
                  <EstablishmentCard key={r.facility_code} e={r} view={view} onCopy={copy} />
                ))}
              </div>
            )}
            {filtered.length > limit && (
              <button type="button" className="est-more" onClick={() => setLimit((l) => l + step)}>
                عرض المزيد ({filtered.length - limit} متبقية)
              </button>
            )}
          </>
        )}
      </div>

      {toast && <div className="est-toast" role="status">{toast}</div>}
    </div>
  );

  return host ? createPortal(page, host) : page;
};

const VIEW_TITLES: Record<ViewMode, string> = {
  table: 'جدول (زي الإكسل) بكل البيانات',
  list: 'قائمة مختصرة',
  small: 'كروت صغيرة',
  large: 'كروت كبيرة بكل التفاصيل',
};

const ViewIcon: React.FC<{ mode: ViewMode }> = ({ mode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {mode === 'table' && (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
      </>
    )}
    {mode === 'list' && (
      <>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <path d="M3 6h.01M3 12h.01M3 18h.01" />
      </>
    )}
    {mode === 'small' && (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    )}
    {mode === 'large' && (
      <>
        <rect x="3" y="3" width="18" height="8" rx="2" />
        <rect x="3" y="14" width="18" height="7" rx="2" />
      </>
    )}
  </svg>
);

const CopyBtn: React.FC<{ text: string; what: string; onCopy: (t: string, w: string) => void; size?: number }> = ({ text, what, onCopy, size = 14 }) => (
  <button
    type="button"
    className="est-copy"
    onClick={(ev) => {
      ev.stopPropagation();
      onCopy(text, what);
    }}
    title={`نسخ ${what}`}
    aria-label={`نسخ ${what}`}
  >
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  </button>
);

const Field: React.FC<{ label: string; value?: string; ltr?: boolean; onCopy: (t: string, w: string) => void }> = ({ label, value, ltr, onCopy }) =>
  value ? (
    <div className="est-field">
      <span className="est-field-label">{label}:</span>
      <span className="est-sel text-wrap" style={{ direction: ltr ? 'ltr' : undefined, flex: 1 }}>{value}</span>
      <CopyBtn text={value} what={label} onCopy={onCopy} size={13} />
    </div>
  ) : null;

function cardText(e: Establishment): string {
  return [
    `${e.name} (${e.facility_code})`,
    `المدينة: ${e.center}`,
    e.address && `العنوان: ${e.address}`,
    e.activity_type && `النشاط: ${e.activity_type}`,
    e.owner && `المالك: ${e.owner}`,
    e.phone && `التليفون: ${e.phone}`,
    e.last_visit_date && `آخر زيارة: ${e.last_visit_date}`,
    e.water_qty && `كمية المياه: ${e.water_qty}`,
    e.treatment_unit && `وحدة المعالجة: ${e.treatment_unit}`,
    `الحالة: ${e.is_active ? 'نشطة' : `مغلقة${e.status_raw ? ` — ${e.status_raw}` : ''}`}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const EstablishmentCard: React.FC<{ e: Establishment; view: ViewMode; onCopy: (t: string, w: string) => void }> = ({ e, view, onCopy }) => {
  const statusPill = (
    <span
      className="text-ellipsis"
      style={{
        fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '20px', minWidth: 0, flexShrink: 1,
        backgroundColor: e.is_active ? COLORS.greenSoft : COLORS.redSoft, color: e.is_active ? COLORS.green : COLORS.red,
      }}
      title={e.status_raw}
    >
      {e.is_active ? 'نشطة' : `مغلقة${e.status_raw ? ` — ${e.status_raw}` : ''}`}
    </span>
  );
  const code = (
    <span className="est-code est-sel">{e.facility_code}</span>
  );

  if (view === 'list') {
    return (
      <div className="est-card est-row" style={{ opacity: e.is_active ? 1 : 0.75 }}>
        {code}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="est-sel text-ellipsis" style={{ fontSize: '14px', fontWeight: 800, color: COLORS.ink }} title={e.name}>{e.name}</div>
          <div className="est-sel text-ellipsis" style={{ fontSize: '12px', color: COLORS.muted }}>
            {e.center}{e.address ? ` • ${e.address}` : ''}
          </div>
        </div>
        {!e.is_active && statusPill}
        <CopyBtn text={cardText(e)} what="بيانات المنشأة" onCopy={onCopy} />
      </div>
    );
  }

  return (
    <div className="est-card" style={{ opacity: e.is_active ? 1 : 0.75 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        {code}
        <CopyBtn text={e.facility_code} what="الكود" onCopy={onCopy} size={13} />
        <span style={{ flex: 1 }} />
        {statusPill}
        <button type="button" className="est-copy-all" onClick={() => onCopy(cardText(e), 'بيانات المنشأة')} title="نسخ كل بيانات الكارت">
          نسخ الكل
        </button>
      </div>
      <div className="est-sel text-wrap" style={{ fontSize: view === 'large' ? '16px' : '15px', fontWeight: 800, color: COLORS.ink, lineHeight: 1.4 }}>
        {e.name}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '5px', fontSize: '12.5px', color: COLORS.muted, minWidth: 0 }}>
        <MapPinIcon size={14} color={COLORS.primary} style={{ flexShrink: 0, marginTop: '2px' }} />
        <span className="est-sel text-wrap" style={{ minWidth: 0, flex: 1 }}>
          <b style={{ color: COLORS.ink }}>{e.center}</b>
          {e.address ? ` • ${e.address}` : ''}
        </span>
        {e.address && <CopyBtn text={e.address} what="العنوان" onCopy={onCopy} size={13} />}
      </div>
      {view === 'small' ? (
        <>
          <Field label="النشاط" value={e.activity_type} onCopy={onCopy} />
          <Field label="التليفون" value={e.phone} ltr onCopy={onCopy} />
        </>
      ) : (
        <>
          <Field label="النشاط" value={e.activity_type} onCopy={onCopy} />
          <Field label="المالك" value={e.owner} onCopy={onCopy} />
          <Field label="التليفون" value={e.phone} ltr onCopy={onCopy} />
          <Field label="آخر زيارة" value={e.last_visit_date} ltr onCopy={onCopy} />
          <Field label="كمية المياه" value={e.water_qty} onCopy={onCopy} />
          <Field label="وحدة المعالجة" value={e.treatment_unit} onCopy={onCopy} />
        </>
      )}
    </div>
  );
};

const TABLE_COLUMNS: { key: string; label: string; get: (e: Establishment) => string; cls?: string }[] = [
  { key: 'code', label: 'الكود', get: (e) => e.facility_code, cls: 'c-code' },
  { key: 'name', label: 'اسم المنشأة', get: (e) => e.name, cls: 'c-name' },
  { key: 'center', label: 'المدينة', get: (e) => e.center },
  { key: 'address', label: 'العنوان', get: (e) => e.address, cls: 'c-wide' },
  { key: 'activity', label: 'النشاط', get: (e) => e.activity_type },
  { key: 'owner', label: 'صاحب المنشأة', get: (e) => e.owner, cls: 'c-mid' },
  { key: 'phone', label: 'التليفون', get: (e) => e.phone, cls: 'c-ltr' },
  { key: 'last', label: 'آخر مرور', get: (e) => e.last_visit_date, cls: 'c-ltr' },
  { key: 'water', label: 'كمية المياه', get: (e) => e.water_qty },
  { key: 'unit', label: 'وحدة المعالجة', get: (e) => e.treatment_unit },
  { key: 'status', label: 'الحالة', get: (e) => (e.is_active ? 'نشطة' : `مغلقة${e.status_raw ? ` — ${e.status_raw}` : ''}`), cls: 'c-status' },
];

/** Spreadsheet-like view: every column, sticky header and code/name columns, selectable cells. */
const EstablishmentsTable: React.FC<{ rows: Establishment[]; onCopy: (t: string, w: string) => void }> = ({ rows, onCopy }) => (
  <div className="est-table-wrap">
    <table className="est-table">
      <thead>
        <tr>
          <th className="c-n">م</th>
          {TABLE_COLUMNS.map((c) => (
            <th key={c.key} className={c.cls}>{c.label}</th>
          ))}
          <th className="c-copy" aria-label="نسخ" />
        </tr>
      </thead>
      <tbody>
        {rows.map((e, i) => (
          <tr key={e.facility_code} className={e.is_active ? '' : 'closed'}>
            <td className="c-n">{i + 1}</td>
            {TABLE_COLUMNS.map((c) => (
              <td key={c.key} className={`est-sel ${c.cls || ''}`}>{c.get(e)}</td>
            ))}
            <td className="c-copy">
              <CopyBtn text={cardText(e)} what="بيانات المنشأة" onCopy={onCopy} size={13} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
