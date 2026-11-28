import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { COLORS } from '../theme';
import type { Establishment } from '../types';
import { FilterBar } from './FilterBar';
import { MapPinIcon, XIcon } from './Icons';
import { FacilityCardSkeleton, SkeletonList } from './Skeleton';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  userCode: string;
  /** Start filtered on this city (e.g. the city chosen on the plan screen) */
  initialCenter?: string;
}

const PAGE = 60;
type StatusKey = 'active' | 'closed' | 'all';

/** View-only page of every establishment in the permanent registry (Excel import + ones employees added). */
export const EstablishmentsView: React.FC<Props> = ({ isOpen, onClose, userCode, initialCenter }) => {
  const [rows, setRows] = useState<Establishment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [center, setCenter] = useState('الكل');
  const [status, setStatus] = useState<StatusKey>('active');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);

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
    setLimit(PAGE);
    load();
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => setLimit(PAGE), [center, status, search]);

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="عرض المنشآت"
      style={{ position: 'fixed', inset: 0, zIndex: 60, backgroundColor: COLORS.bg, overflowY: 'auto', direction: 'rtl' }}
    >
      <div style={{ maxWidth: '500px', margin: '0 auto', padding: '0 14px 40px' }}>
        <div
          style={{
            position: 'sticky', top: 0, zIndex: 2, backgroundColor: COLORS.bg, padding: '14px 0 10px',
            display: 'flex', alignItems: 'center', gap: '10px',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '18px', fontWeight: 800, color: COLORS.ink }}>عرض المنشآت</div>
            <div style={{ fontSize: '12px', color: COLORS.muted, fontWeight: 600 }}>
              كل المنشآت المسجلة في السيستم — للعرض فقط
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            style={{
              width: '40px', height: '40px', borderRadius: '12px', border: `1px solid ${COLORS.border}`,
              backgroundColor: COLORS.surface, display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            <XIcon size={20} color={COLORS.ink} />
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
          {loading ? (
            <SkeletonList count={6}><FacilityCardSkeleton /></SkeletonList>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '30px 10px', color: COLORS.red, fontWeight: 700 }}>
              {error}
              <div>
                <button
                  type="button"
                  onClick={load}
                  style={{
                    marginTop: '12px', padding: '10px 18px', borderRadius: '10px', border: 'none',
                    backgroundColor: COLORS.primary, color: '#fff', fontWeight: 800, cursor: 'pointer',
                  }}
                >
                  إعادة المحاولة
                </button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 10px', color: COLORS.muted, fontWeight: 700 }}>
              لا توجد منشآت مطابقة
            </div>
          ) : (
            <>
              {filtered.slice(0, limit).map((r) => <EstablishmentCard key={r.facility_code} e={r} />)}
              {filtered.length > limit && (
                <button
                  type="button"
                  onClick={() => setLimit((l) => l + PAGE)}
                  style={{
                    padding: '12px', borderRadius: '12px', border: `1px solid ${COLORS.border}`,
                    backgroundColor: COLORS.surface, color: COLORS.primary, fontWeight: 800, cursor: 'pointer',
                  }}
                >
                  عرض المزيد ({filtered.length - limit} متبقية)
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; value?: string; ltr?: boolean }> = ({ label, value, ltr }) =>
  value ? (
    <div style={{ display: 'flex', gap: '6px', fontSize: '12.5px', minWidth: 0 }}>
      <span style={{ color: COLORS.muted, fontWeight: 600, flexShrink: 0 }}>{label}:</span>
      <span className="text-wrap" style={{ color: COLORS.ink, fontWeight: 700, direction: ltr ? 'ltr' : undefined }}>{value}</span>
    </div>
  ) : null;

const EstablishmentCard: React.FC<{ e: Establishment }> = ({ e }) => (
  <div
    style={{
      backgroundColor: COLORS.surface, borderRadius: '14px', padding: '12px 14px', border: `1px solid ${COLORS.border}`,
      display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, opacity: e.is_active ? 1 : 0.75,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minWidth: 0 }}>
      <span
        style={{
          fontSize: '12px', fontWeight: 800, fontFamily: 'monospace, sans-serif', backgroundColor: '#F1F5F9',
          color: '#334155', padding: '2px 8px', borderRadius: '6px', border: '1px solid #E2E8F0', flexShrink: 0,
        }}
      >
        {e.facility_code}
      </span>
      <span
        className="text-ellipsis"
        style={{
          fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '20px', minWidth: 0,
          backgroundColor: e.is_active ? COLORS.greenSoft : COLORS.redSoft,
          color: e.is_active ? COLORS.green : COLORS.red,
        }}
        title={e.status_raw}
      >
        {e.is_active ? 'نشطة' : `مغلقة${e.status_raw ? ` — ${e.status_raw}` : ''}`}
      </span>
    </div>
    <div className="text-wrap" style={{ fontSize: '15px', fontWeight: 800, color: COLORS.ink, lineHeight: 1.4 }}>{e.name}</div>
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '5px', fontSize: '12.5px', color: COLORS.muted, minWidth: 0 }}>
      <MapPinIcon size={14} color={COLORS.primary} style={{ flexShrink: 0, marginTop: '2px' }} />
      <span className="text-wrap" style={{ minWidth: 0 }}>
        <b style={{ color: COLORS.ink }}>{e.center}</b>
        {e.address ? ` • ${e.address}` : ''}
      </span>
    </div>
    <Field label="النشاط" value={e.activity_type} />
    <Field label="المالك" value={e.owner} />
    <Field label="التليفون" value={e.phone} ltr />
    <Field label="آخر زيارة" value={e.last_visit_date} ltr />
    <Field label="كمية المياه" value={e.water_qty} />
    <Field label="وحدة المعالجة" value={e.treatment_unit} />
  </div>
);
