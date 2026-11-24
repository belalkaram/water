import React from 'react';
import { COLORS } from '../theme';

interface BoxProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: React.CSSProperties;
}

/** A single shimmering placeholder block. */
export const SkeletonBox: React.FC<BoxProps> = ({ width = '100%', height = 12, radius = 8, style }) => (
  <span className="skeleton" style={{ display: 'block', width, height, borderRadius: radius, flexShrink: 0, ...style }} />
);

const cardStyle: React.CSSProperties = {
  backgroundColor: COLORS.surface,
  borderRadius: '16px',
  border: `1px solid ${COLORS.border}`,
  padding: '14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};

/** Placeholder with the same shape as a FacilityCard. */
export const FacilityCardSkeleton: React.FC = () => (
  <div style={cardStyle} aria-hidden="true">
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <SkeletonBox width={92} height={22} radius={11} />
      <SkeletonBox width={54} height={18} radius={6} />
    </div>
    <SkeletonBox width="72%" height={16} />
    <SkeletonBox width="48%" height={12} />
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
      <SkeletonBox width={110} height={12} />
      <SkeletonBox width={70} height={12} />
    </div>
  </div>
);

/** Placeholder for the KPI/progress card at the top of the plan screen. */
export const SummarySkeleton: React.FC = () => (
  <div style={cardStyle} aria-hidden="true">
    <div style={{ display: 'flex', gap: '14px' }}>
      <SkeletonBox width={52} height={14} />
      <SkeletonBox width={74} height={14} />
      <SkeletonBox width={56} height={14} />
    </div>
    <SkeletonBox height={8} radius={4} />
  </div>
);

/** Placeholder for an activity-feed row. */
export const FeedItemSkeleton: React.FC = () => (
  <div style={{ ...cardStyle, flexDirection: 'row', alignItems: 'center', gap: '12px' }} aria-hidden="true">
    <SkeletonBox width={38} height={38} radius={19} />
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <SkeletonBox width="60%" height={13} />
      <SkeletonBox width="85%" height={11} />
    </div>
  </div>
);

export const SkeletonList: React.FC<{ count?: number; children: React.ReactNode }> = ({ count = 5, children }) => (
  <div role="status" aria-label="جارٍ التحميل" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
    {Array.from({ length: count }).map((_, i) => (
      <React.Fragment key={i}>{children}</React.Fragment>
    ))}
  </div>
);
