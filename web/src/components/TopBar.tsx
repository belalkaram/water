import React from 'react';
import { COLORS } from '../theme';
import type { User } from '../types';
import { LogOutIcon } from './Icons';
import { InstallButton } from './InstallButton';

interface Props {
  user: User;
  onLogout: () => void;
  deferredPrompt?: any;
  onInstall?: () => void;
}

export const TopBar: React.FC<Props> = ({ user, onLogout, deferredPrompt, onInstall }) => {
  return (
    <header
      className="top-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        backgroundColor: COLORS.surface,
        borderBottom: `1px solid ${COLORS.border}`,
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}
    >
      {/* Right section: Logo + App/User Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
        <img
          src="/logo.jpg"
          alt="شعار الشركة"
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '19px',
            objectFit: 'cover',
            border: `1.5px solid ${COLORS.border}`,
            flexShrink: 0,
          }}
        />

        <div className="top-bar-title" style={{ textAlign: 'right', marginRight: '2px', minWidth: 0 }}>
          <div style={{ fontSize: '15px', fontWeight: '800', color: COLORS.ink, lineHeight: 1.2 }}>
            الإدارة العامة للصرف الصناعي
          </div>
          <div style={{ fontSize: '11px', color: COLORS.muted, marginTop: '2px', fontWeight: '500' }}>
            {user.name} <span style={{ color: COLORS.primary, fontWeight: '700' }}>({user.code})</span>
          </div>
        </div>
      </div>

      {/* Left section: Install App button + Logout on the far left */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginRight: '8px' }}>
        <InstallButton deferredPrompt={deferredPrompt} onInstall={onInstall} />

        <button
          type="button"
          onClick={onLogout}
          title="تسجيل الخروج"
          aria-label="تسجيل الخروج"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FEE2E2',
            color: COLORS.red,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background-color 0.15s ease',
          }}
        >
          {/* Mirrored so the arrow points left (toward the screen edge) */}
          <LogOutIcon size={18} color={COLORS.red} style={{ transform: 'scaleX(-1)' }} />
        </button>
      </div>
    </header>
  );
};
