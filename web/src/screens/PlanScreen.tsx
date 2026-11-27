import React, { useMemo, useState } from 'react';
import { COLORS } from '../theme';
import type { Facility, MonthlyPlan, User } from '../types';
import { FacilityCardSkeleton, SkeletonList, SummarySkeleton } from '../components/Skeleton';
import { FacilityCard } from '../components/FacilityCard';
import { RefreshCwIcon, RotateCcwIcon, SearchIcon, XIcon } from '../components/Icons';
import { api } from '../api';
import { ExportButtons } from '../components/ExportButtons';
import { AddFacilityModal } from '../components/AddFacilityModal';
import { FilterBar } from '../components/FilterBar';
import { usePersistedState } from '../utils/usePersistedState';
import { Select } from '../components/pickers/Select';


type StatusFilter = 'all' | 'available' | 'reserved' | 'completed' | 'mine';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'available', label: 'متاح' },
  { key: 'reserved', label: 'في الطريق' },
  { key: 'completed', label: 'تمت' },
  { key: 'mine', label: 'خاصتي' },
];

interface Props {
  user: User;
  plans: MonthlyPlan[];
  selectedPlanId: string;
  onSelectPlan: (id: string) => void;
  facilities: Facility[];
  onSelectFacility: (f: Facility) => void;
  onRefresh: () => void;
  refreshing: boolean;
  loading?: boolean;
}

export const PlanScreen: React.FC<Props> = ({
  user,
  plans,
  selectedPlanId,
  onSelectPlan,
  facilities,
  onSelectFacility,
  onRefresh,
  refreshing,
  loading = false,
}) => {
  const [search, setSearch] = useState('');
  // filters are remembered per user on this device
  const [centerFilter, setCenterFilter] = usePersistedState<string>(`filters_plan_center_${user.id}`, 'الكل');
  const [statusFilter, setStatusFilter] = usePersistedState<StatusFilter>(
    `filters_plan_status_${user.id}`,
    'all',
    STATUS_FILTERS.map((s) => s.key)
  );
  const isAdmin = user.role === 'admin';

  // Add Facility Modal (all employees)
  const [showAddModal, setShowAddModal] = useState(false);

  // Admin: Bulk Reset Modal State
  const [showBulkResetModal, setShowBulkResetModal] = useState(false);
  const [bulkTarget, setBulkTarget] = useState<'completed' | 'reserved' | 'all'>('completed');
  const [bulkMode, setBulkMode] = useState<'keep_history' | 'wipe'>('keep_history');
  const [submittingBulk, setSubmittingBulk] = useState(false);

  // Centers with counts
  const centersWithCount = useMemo(() => {
    const counts: Record<string, number> = {};
    facilities.forEach((f) => {
      const c = f.center || 'أخرى';
      counts[c] = (counts[c] || 0) + 1;
    });

    const list = [{ name: 'الكل', count: facilities.length }];
    Object.keys(counts)
      .sort((a, b) => counts[b] - counts[a])
      .forEach((name) => {
        list.push({ name, count: counts[name] });
      });
    return list;
  }, [facilities]);

  const filteredFacilities = useMemo(() => {
    return facilities.filter((f) => {
      if (centerFilter !== 'الكل' && f.center !== centerFilter) return false;
      if (statusFilter === 'mine') {
        if (f.reserved_by_id !== user.id && f.completed_by_id !== user.id) return false;
      } else if (statusFilter !== 'all' && f.status !== statusFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          (f.name && f.name.toLowerCase().includes(q)) ||
          (f.address && f.address.toLowerCase().includes(q)) ||
          (f.facility_code && f.facility_code.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [facilities, centerFilter, statusFilter, search, user.id]);

  const statusCounts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: 0, available: 0, reserved: 0, completed: 0, mine: 0 };
    facilities.forEach((f) => {
      if (centerFilter !== 'الكل' && f.center !== centerFilter) return;
      c.all++;
      c[f.status]++;
      if (f.reserved_by_id === user.id || f.completed_by_id === user.id) c.mine++;
    });
    return c;
  }, [facilities, centerFilter, user.id]);

  const completedCount = facilities.filter((f) => f.status === 'completed').length;
  const reservedCount = facilities.filter((f) => f.status === 'reserved').length;
  const availableCount = facilities.filter((f) => f.status === 'available').length;
  const progress = facilities.length ? Math.round((completedCount / facilities.length) * 100) : 0;

  const currentPlan = plans.find((p) => p.id === selectedPlanId) || plans[0];

  // Admin: Bulk Reset Submit
  const handleBulkResetSubmit = async () => {
    const targetLabel =
      bulkTarget === 'completed'
        ? 'المنشآت المكتملة'
        : bulkTarget === 'reserved'
        ? 'المنشآت المحجوزة'
        : 'جميع منشآت الخطة';

    const modeLabel =
      bulkMode === 'keep_history' ? 'مع الاحتفاظ بالسجل التاريخي' : 'مع مسح وتصفير السجل تماماً';

    if (!window.confirm(`هل أنت متأكد من إعادة فتح ${targetLabel} (${modeLabel})؟`)) {
      return;
    }

    setSubmittingBulk(true);
    try {
      const res = await api.bulkResetPlan(user.code, selectedPlanId, bulkTarget, bulkMode);
      setShowBulkResetModal(false);
      onRefresh();
      alert(res.message || `تمت إعادة فتح المنشآت بنجاح (${res.count} منشأة)`);
    } catch (err: any) {
      alert('تعذر عمل ريسيت: ' + err.message);
    } finally {
      setSubmittingBulk(false);
    }
  };

  return (
    <div
      className="scroll-container screen"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 14px',
        gap: '12px',
        backgroundColor: '#F8FAFC',
      }}
    >
      {/* Plan Header */}
      {currentPlan ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '2px 4px',
            flexShrink: 0,
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div>
            <h2 style={{ fontSize: '17px', fontWeight: '800', color: COLORS.ink, margin: 0 }}>
              {currentPlan.month_label}
            </h2>
            <span style={{ fontSize: '12px', color: COLORS.muted }}>
              إجمالي الخطة: {facilities.length} منشأة صناعية
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {selectedPlanId && (
              <button
                  type="button"
                  onClick={() => setShowAddModal(true)}
                  style={{
                    padding: '6px 10px',
                    backgroundColor: COLORS.primary,
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '10px',
                    fontSize: '12px',
                    fontWeight: '800',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    cursor: 'pointer',
                    boxShadow: '0 1px 3px rgba(2, 132, 199, 0.25)',
                  }}
                >
                  <span>＋ إضافة منشأة</span>
                </button>
            )}
            {isAdmin && (
              <>

                <button
                  type="button"
                  onClick={() => setShowBulkResetModal(true)}
                  title="إعادة فتح الأماكن (ريسيت الخطة)"
                  style={{
                    padding: '6px 10px',
                    backgroundColor: '#FEF3C7',
                    border: '1px solid #FDE68A',
                    color: '#B45309',
                    borderRadius: '10px',
                    fontSize: '12px',
                    fontWeight: '800',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    cursor: 'pointer',
                  }}
                >
                  <RotateCcwIcon size={13} color={COLORS.amber} />
                  <span>ريسيت للخطة</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onRefresh}
              style={{
                padding: '6px 10px',
                backgroundColor: '#FFFFFF',
                border: `1px solid ${COLORS.border}`,
                borderRadius: '10px',
                color: COLORS.primary,
                fontWeight: '700',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  animation: refreshing ? 'spin 1s linear infinite' : 'none',
                }}
              >
                <RefreshCwIcon size={14} color={COLORS.primary} />
              </span>
              <span>{refreshing ? '...' : 'تحديث'}</span>
            </button>
          </div>
        </div>
      ) : null}

      {/* Progress & KPI Summary Card */}
      {loading && <SummarySkeleton />}
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          padding: '12px 14px',
          border: `1px solid ${COLORS.border}`,
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          display: loading ? 'none' : 'flex',
          flexDirection: 'column',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '12px', fontSize: '12px', fontWeight: '700' }}>
            <span style={{ color: COLORS.green }}>
              تم: <strong>{completedCount}</strong>
            </span>
            <span style={{ color: COLORS.amber }}>
              في الطريق: <strong>{reservedCount}</strong>
            </span>
            <span style={{ color: COLORS.primary }}>
              متاح: <strong>{availableCount}</strong>
            </span>
          </div>

          <span
            style={{
              fontSize: '12px',
              fontWeight: '800',
              color: progress > 0 ? COLORS.green : COLORS.muted,
              backgroundColor: progress > 0 ? '#ECFDF5' : '#F1F5F9',
              padding: '2px 8px',
              borderRadius: '10px',
            }}
          >
            {progress}% مكتمل
          </span>
        </div>

        {/* Progress Bar */}
        <div
          style={{
            height: '6px',
            backgroundColor: '#E2E8F0',
            borderRadius: '3px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${Math.max(progress, 0)}%`,
              backgroundColor: COLORS.green,
              borderRadius: '3px',
              transition: 'width 0.4s ease',
            }}
          />
        </div>
      </div>

      {/* Unified filters: plan + city dropdowns, search, status segments */}
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          padding: '12px',
          border: `1px solid ${COLORS.border}`,
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          flexShrink: 0,
        }}
      >
        <FilterBar
          dropdowns={[
            ...(plans.length > 0
              ? [{
                  key: 'plan',
                  label: 'الخطة',
                  value: selectedPlanId,
                  onChange: onSelectPlan,
                  options: plans.map((p) => ({ value: p.id, label: p.month_label, badge: p.total_facilities })),
                }]
              : []),
            {
              key: 'center',
              label: 'المدينة',
              value: centerFilter,
              onChange: setCenterFilter,
              defaultValue: 'الكل',
              options: centersWithCount.map((c) => ({
                value: c.name,
                label: c.name === 'الكل' ? 'كل المدن' : c.name,
                badge: c.count,
              })),
            },
          ]}
          search={{ value: search, onChange: setSearch, placeholder: 'ابحث باسم المنشأة، العنوان، أو الكود...' }}
          segmented={{
            label: 'الحالة',
            value: statusFilter,
            onChange: (v) => setStatusFilter(v as StatusFilter),
            defaultValue: 'all',
            options: STATUS_FILTERS.map((sf) => ({ value: sf.key, label: sf.label, badge: statusCounts[sf.key] })),
          }}
          resultText={`عرض ${filteredFacilities.length} من ${facilities.length} منشأة`}
        />
      </div>

      <ExportButtons userCode={user.code} planId={selectedPlanId} center={centerFilter} compact />

      {/* Facilities Cards List */}
      <div className="facility-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '80px' }}>
        {loading ? (
          <SkeletonList count={6}><FacilityCardSkeleton /></SkeletonList>
        ) : filteredFacilities.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '40px 20px',
              backgroundColor: '#FFFFFF',
              borderRadius: '16px',
              border: `1px solid ${COLORS.border}`,
              color: COLORS.muted,
              fontSize: '14px',
              fontWeight: '600',
              marginTop: '6px',
            }}
          >
            <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center' }}>
              <SearchIcon size={36} color={COLORS.muted} />
            </div>
            <p style={{ margin: 0 }}>لا توجد منشآت مطابقة للبحث أو الفلتر المحدد</p>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setCenterFilter('الكل');
                setStatusFilter('all');
              }}
              style={{
                marginTop: '10px',
                padding: '7px 16px',
                backgroundColor: COLORS.primary,
                color: '#FFF',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: '700',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              عرض جميع المنشآت
            </button>
          </div>
        ) : (
          filteredFacilities.map((f) => (
            <FacilityCard key={f.id} facility={f} onClick={() => onSelectFacility(f)} />
          ))
        )}
      </div>

      {showAddModal && (
        <AddFacilityModal
          user={user}
          planId={selectedPlanId}
          defaultCenter={centerFilter !== 'الكل' ? centerFilter : undefined}
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            setShowAddModal(false);
            onRefresh();
          }}
        />
      )}

      {/* Admin: Bulk Reset Modal */}
      {showBulkResetModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            backdropFilter: 'blur(3px)',
          }}
        >
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '16px',
              padding: '18px',
              width: '100%',
              maxWidth: '440px',
              boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '800', color: COLORS.amber, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <RotateCcwIcon size={18} color={COLORS.amber} />
                <span>إعادة فتح / ريسيت للخطة (الأدمن)</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowBulkResetModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                <XIcon size={18} color={COLORS.muted} />
              </button>
            </div>

            <p style={{ fontSize: '13px', color: COLORS.ink, margin: 0, lineHeight: 1.4 }}>
              يمكنك إعادة فتح المنشآت التي تمت معاينتها أو المحجوزة لتصبح متاحة للمعاينة من جديد.
            </p>

            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: COLORS.ink, display: 'block', marginBottom: '4px' }}>
                أي المنشآت تريد إعادة فتحها؟
              </label>
              <Select
                value={bulkTarget}
                onChange={(v) => setBulkTarget(v as any)}
                title="أي المنشآت تريد إعادة فتحها؟"
                options={[
                  { value: 'completed', label: 'المنشآت المكتملة فقط', hint: `${completedCount} منشأة` },
                  { value: 'reserved', label: 'المنشآت المحجوزة في الطريق فقط', hint: `${reservedCount} منشأة` },
                  { value: 'all', label: 'كافة المنشآت المقفولة والمحجوزة' },
                ]}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: COLORS.ink, display: 'block', marginBottom: '4px' }}>
                نوع الريسيت:
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px',
                    borderRadius: '8px',
                    border: `1px solid ${bulkMode === 'keep_history' ? COLORS.primary : COLORS.border}`,
                    backgroundColor: bulkMode === 'keep_history' ? '#F0F9FF' : '#FFFFFF',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="bulkMode"
                    value="keep_history"
                    checked={bulkMode === 'keep_history'}
                    onChange={() => setBulkMode('keep_history')}
                  />
                  <span>
                    <strong>حفظ السجل القديم في الأرشيف (موصى به):</strong> يفتح المنشآت لمعاينة جديدة مع بقاء المعاينات السابقة في السجل.
                  </span>
                </label>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px',
                    borderRadius: '8px',
                    border: `1px solid ${bulkMode === 'wipe' ? COLORS.red : COLORS.border}`,
                    backgroundColor: bulkMode === 'wipe' ? '#FEF2F2' : '#FFFFFF',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="bulkMode"
                    value="wipe"
                    checked={bulkMode === 'wipe'}
                    onChange={() => setBulkMode('wipe')}
                  />
                  <span style={{ color: COLORS.red }}>
                    <strong>مسح وتصفير شامل:</strong> يحذف المعاينات السابقة لهذه المنشآت نهائياً كأنها لم تُعاين قط.
                  </span>
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <button
                type="button"
                disabled={submittingBulk}
                onClick={handleBulkResetSubmit}
                style={{
                  flex: 1,
                  padding: '11px',
                  backgroundColor: COLORS.amber,
                  color: '#FFFFFF',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: '800',
                  cursor: submittingBulk ? 'not-allowed' : 'pointer',
                }}
              >
                {submittingBulk ? 'جارٍ إعادة الفتح...' : 'تأكيد وإعادة الفتح'}
              </button>

              <button
                type="button"
                disabled={submittingBulk}
                onClick={() => setShowBulkResetModal(false)}
                style={{
                  padding: '11px 16px',
                  backgroundColor: '#E2E8F0',
                  color: '#334155',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: '700',
                  cursor: 'pointer',
                }}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
