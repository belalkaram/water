import React from 'react';
import { COLORS } from '../theme';
import type { UserRole } from '../types';
import { ClipboardListIcon, MessageSquareIcon, SettingsIcon } from './Icons';

export type TabType = 'plan' | 'feed' | 'admin';

interface Props {
  currentTab: TabType;
  onChangeTab: (tab: TabType) => void;
  userRole: UserRole;
}

type TabDef = {
  key: TabType;
  label: string;
  Icon: typeof ClipboardListIcon;
  adminOnly?: boolean;
};

// Order follows reading direction (RTL): first item sits on the right.
const TABS: TabDef[] = [
  { key: 'plan', label: 'الخطة', Icon: ClipboardListIcon },
  { key: 'feed', label: 'نشاط الفريق', Icon: MessageSquareIcon },
  { key: 'admin', label: 'الإدارة', Icon: SettingsIcon, adminOnly: true },
];

export const BottomNav: React.FC<Props> = ({ currentTab, onChangeTab, userRole }) => {
  const visible = TABS.filter((t) => !t.adminOnly || userRole === 'admin');

  return (
    <nav
      dir="rtl"
      aria-label="التنقل الرئيسي"
      className="bottom-nav"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        direction: 'rtl',
        backgroundColor: COLORS.surface,
        borderTop: `1px solid ${COLORS.border}`,
        flexShrink: 0,
        zIndex: 30,
        padding: '6px 8px calc(8px + env(safe-area-inset-bottom, 0px))',
        gap: '4px',
        boxShadow: '0 -4px 16px rgba(15, 41, 58, 0.06)',
      }}
    >
      {visible.map(({ key, label, Icon }) => {
        const active = currentTab === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChangeTab(key)}
            className={`nav-item${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              padding: '4px 2px',
              color: active ? COLORS.primary : COLORS.muted,
            }}
          >
            <span
              className="nav-pill"
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '56px',
                height: '30px',
                borderRadius: '15px',
                backgroundColor: active ? 'rgba(0, 107, 159, 0.12)' : 'transparent',
                transition: 'background-color 0.2s ease',
              }}
            >
              <Icon size={22} color={active ? COLORS.primary : COLORS.muted} strokeWidth={active ? 2.4 : 2} />
            </span>
            <span
              className="nav-label"
              style={{
                fontSize: '11px',
                fontWeight: active ? 800 : 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
              }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
