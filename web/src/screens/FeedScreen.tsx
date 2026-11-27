import React, { useMemo, useState } from 'react';
import { FeedItemSkeleton, SkeletonList } from '../components/Skeleton';
import { COLORS } from '../theme';
import type { ActivityItem, MonthlyPlan } from '../types';
import { FilterBar } from '../components/FilterBar';
import { usePersistedState } from '../utils/usePersistedState';
import {
  CarIcon,
  CheckCircleIcon,
  ClipboardListIcon,
  ClockIcon,
  FilterIcon,
  MapPinIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  UnlockIcon,
  XIcon,
} from '../components/Icons';

interface Props {
  feed: ActivityItem[];
  onRefresh: () => void;
  refreshing: boolean;
  loading?: boolean;
  onSelectFacilityId?: (facilityId: string) => void;
  userId: string;
  plans: MonthlyPlan[];
  selectedPlanId: string;
  onSelectPlan: (id: string) => void;
}

type ActionFilterType = 'all' | 'completed' | 'reserved' | 'released' | 'expired' | 'unlocked';

const ACTION_FILTERS: { key: ActionFilterType; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'completed', label: 'منجزة' },
  { key: 'reserved', label: 'في الطريق' },
  { key: 'released', label: 'إلغاء حجز' },
  { key: 'unlocked', label: 'إعادة فتح' },
];

function renderActionBadge(action: string) {
  switch (action) {
    case 'reserved':
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            borderRadius: '6px',
            backgroundColor: COLORS.amberSoft,
            color: COLORS.amber,
          }}
        >
          <CarIcon size={14} color={COLORS.amber} />
        </span>
      );
    case 'released':
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            borderRadius: '6px',
            backgroundColor: '#F1F5F9',
            color: COLORS.muted,
          }}
        >
          <RotateCcwIcon size={14} color={COLORS.muted} />
        </span>
      );
    case 'expired':
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            borderRadius: '6px',
            backgroundColor: COLORS.redSoft,
            color: COLORS.red,
          }}
        >
          <ClockIcon size={14} color={COLORS.red} />
        </span>
      );
    case 'completed':
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            borderRadius: '6px',
            backgroundColor: COLORS.greenSoft,
            color: COLORS.green,
          }}
        >
          <CheckCircleIcon size={14} color={COLORS.green} />
        </span>
      );
    case 'unlocked':
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            borderRadius: '6px',
            backgroundColor: COLORS.amberSoft,
            color: COLORS.amber,
          }}
        >
          <UnlockIcon size={14} color={COLORS.amber} />
        </span>
      );
    case 'plan_uploaded':
    default:
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            borderRadius: '6px',
            backgroundColor: '#E0F2FE',
            color: COLORS.primary,
          }}
        >
          <ClipboardListIcon size={14} color={COLORS.primary} />
        </span>
      );
  }
}

export const FeedScreen: React.FC<Props> = ({
  feed, onRefresh, refreshing, loading = false, onSelectFacilityId, userId, plans, selectedPlanId, onSelectPlan,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = usePersistedState<ActionFilterType>(
    `filters_feed_action_${userId}`,
    'all',
    ACTION_FILTERS.map((f) => f.key)
  );
  const [centerFilter, setCenterFilter] = usePersistedState<string>(`filters_feed_center_${userId}`, 'الكل');

  // Dynamically extract unique centers present in the feed
  const uniqueCenters = useMemo(() => {
    const centers = new Set<string>();
    feed.forEach((item) => {
      if (item.center && item.center.trim()) {
        centers.add(item.center.trim());
      }
    });
    return Array.from(centers).sort();
  }, [feed]);

  // Filter feed based on search query, action type, and center
  const filteredFeed = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return feed.filter((item) => {
      // Action type filter
      if (actionFilter !== 'all' && item.action !== actionFilter) {
        return false;
      }

      // Center filter
      if (centerFilter !== 'الكل' && item.center !== centerFilter) {
        return false;
      }

      // Search query filter (matches worker_name, summary, or center)
      if (q) {
        const matchesWorker = item.worker_name && item.worker_name.toLowerCase().includes(q);
        const matchesSummary = item.summary && item.summary.toLowerCase().includes(q);
        const matchesCenter = item.center && item.center.toLowerCase().includes(q);
        if (!matchesWorker && !matchesSummary && !matchesCenter) {
          return false;
        }
      }

      return true;
    });
  }, [feed, searchQuery, actionFilter, centerFilter]);

  const hasActiveFilters = searchQuery.trim() !== '' || actionFilter !== 'all' || centerFilter !== 'الكل';

  return (
    <div
      className="scroll-container screen"
      style={{
        flex: 1,
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        paddingBottom: '80px',
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: '800', color: COLORS.ink, margin: 0 }}>
            سجل نشاط الفريق الحي
          </h2>
          <span
            style={{
              fontSize: '11px',
              fontWeight: '700',
              backgroundColor: '#F1F5F9',
              color: '#475569',
              padding: '2px 7px',
              borderRadius: '10px',
            }}
          >
            {filteredFeed.length}
          </span>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          style={{
            color: COLORS.primary,
            fontWeight: '700',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <span style={{ display: 'inline-flex', animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>
            <RefreshCwIcon size={13} color={COLORS.primary} />
          </span>
          <span>{refreshing ? 'جارٍ التحديث...' : 'تحديث'}</span>
        </button>
      </div>

      {/* Unified filters */}
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
                  options: plans.map((p) => ({ value: p.id, label: p.month_label })),
                }]
              : []),
            {
              key: 'center',
              label: 'المدينة',
              value: centerFilter,
              onChange: setCenterFilter,
              defaultValue: 'الكل',
              options: [
                { value: 'الكل', label: 'كل المدن', badge: feed.length },
                ...uniqueCenters.map((c) => ({ value: c, label: c, badge: feed.filter((i) => i.center === c).length })),
              ],
            },
          ]}
          search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'ابحث باسم الموظف، المنشأة، أو الملاحظة...' }}
          segmented={{
            label: 'النشاط',
            value: actionFilter,
            onChange: (v) => setActionFilter(v as ActionFilterType),
            defaultValue: 'all',
            options: ACTION_FILTERS.map((f) => ({ value: f.key, label: f.label })),
          }}
          resultText={hasActiveFilters ? `عرض ${filteredFeed.length} من ${feed.length} نشاط` : undefined}
        />
      </div>

      {/* Feed List or Empty State */}
      {loading ? (
        <SkeletonList count={6}><FeedItemSkeleton /></SkeletonList>
      ) : feed.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '50px 20px',
            color: COLORS.muted,
            fontSize: '14px',
          }}
        >
          لا يوجد نشاط مسجل في الخطة المحددة بعد.
        </div>
      ) : filteredFeed.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 20px',
            backgroundColor: '#FFFFFF',
            borderRadius: '14px',
            border: `1px solid ${COLORS.border}`,
            color: COLORS.muted,
            fontSize: '13px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
            <SearchIcon size={32} color={COLORS.muted} />
          </div>
          <p style={{ margin: 0, fontWeight: '600' }}>لا توجد أنشطة مطابقة للبحث أو الفلتر المحدد.</p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setActionFilter('all');
              setCenterFilter('الكل');
            }}
            style={{
              marginTop: '10px',
              padding: '6px 14px',
              backgroundColor: COLORS.primary,
              color: '#FFFFFF',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: '700',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            عرض جميع الأنشطة
          </button>
        </div>
      ) : (
        filteredFeed.map((item) => {
          const hasFacility = Boolean(item.facility_id);
          return (
            <div
              key={item.id}
              onClick={() => {
                if (hasFacility && onSelectFacilityId) {
                  onSelectFacilityId(item.facility_id!);
                }
              }}
              style={{
                backgroundColor: COLORS.surface,
                borderRadius: '14px',
                padding: '12px 14px',
                border: `1px solid ${COLORS.border}`,
                boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                cursor: hasFacility ? 'pointer' : 'default',
                transition: 'background-color 0.15s ease, border-color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (hasFacility) {
                  e.currentTarget.style.backgroundColor = '#F0F9FF';
                  e.currentTarget.style.borderColor = COLORS.primary;
                }
              }}
              onMouseLeave={(e) => {
                if (hasFacility) {
                  e.currentTarget.style.backgroundColor = COLORS.surface;
                  e.currentTarget.style.borderColor = COLORS.border;
                }
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    color: COLORS.muted,
                    direction: 'ltr',
                    fontWeight: '500',
                  }}
                >
                  {new Date(item.created_at).toLocaleTimeString('ar-EG', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  —{' '}
                  {new Date(item.created_at).toLocaleDateString('ar-EG', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '13px', fontWeight: '800', color: COLORS.ink }}>
                    {item.worker_name}
                  </span>
                  {renderActionBadge(item.action)}
                </div>
              </div>

              <p style={{ fontSize: '14px', color: COLORS.ink, fontWeight: '500', margin: '2px 0', lineHeight: 1.4 }}>
                {item.summary}
              </p>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                {item.center && (
                  <span style={{ fontSize: '11px', color: COLORS.muted }}>
                    المركز: {item.center}
                  </span>
                )}
                {hasFacility && (
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: '700',
                      color: item.action === 'completed' ? COLORS.green : COLORS.primary,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    {item.action === 'completed' ? (
                      <>
                        <ClipboardListIcon size={14} color={COLORS.green} />
                        <span>عرض تفاصيل المعاينة والعينات</span>
                      </>
                    ) : (
                      <>
                        <MapPinIcon size={14} color={COLORS.primary} />
                        <span>عرض المنشأة</span>
                      </>
                    )}
                    <span>←</span>
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
