import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { COLORS } from '../theme';
import { BottomSheet } from './BottomSheet';
import { SmartphoneIcon } from './Icons';

interface Props {
  /** the browser's saved `beforeinstallprompt` event (Chrome / Edge / Android) */
  deferredPrompt?: any;
  onInstall?: () => void;
}

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const IS_IOS = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const IS_ANDROID = /android/i.test(ua);
const IS_MOBILE = IS_IOS || IS_ANDROID || /mobile/i.test(ua);

function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as any).standalone === true
  );
}

/**
 * زر «تثبيت التطبيق»:
 * - لو المتصفح بيدعم التثبيت المباشر (Chrome/Edge/Android) → نافذة التثبيت بتاعة المتصفح.
 * - على الموبايل لو مفيش تثبيت مباشر (آيفون Safari وبعض المتصفحات) → شرح خطوات الإضافة للشاشة الرئيسية.
 * - بيختفي لو التطبيق متثبت بالفعل.
 */
export const InstallButton: React.FC<Props> = ({ deferredPrompt, onInstall }) => {
  const [installed, setInstalled] = useState(isInstalled);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    const done = () => setInstalled(true);
    window.addEventListener('appinstalled', done);
    const mq = window.matchMedia('(display-mode: standalone)');
    const onMode = () => setInstalled(isInstalled());
    mq.addEventListener('change', onMode);
    return () => {
      window.removeEventListener('appinstalled', done);
      mq.removeEventListener('change', onMode);
    };
  }, []);

  if (installed) return null;
  const canPrompt = Boolean(deferredPrompt && onInstall);
  if (!canPrompt && !IS_MOBILE) return null; // desktop without native support: nothing useful to offer

  return (
    <>
      <button
        type="button"
        className="install-btn"
        onClick={() => (canPrompt ? onInstall!() : setGuideOpen(true))}
        title="تثبيت التطبيق على الجهاز"
        aria-label="تثبيت التطبيق"
      >
        <SmartphoneIcon size={15} color="#FFFFFF" />
        <span className="install-btn-label">تثبيت التطبيق</span>
        <span className="install-btn-short">تثبيت</span>
      </button>

      {/* portal: the top bar is its own stacking context, which would put the sheet under the bottom nav */}
      {createPortal(
      <BottomSheet isOpen={guideOpen} onClose={() => setGuideOpen(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingTop: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src="/icon-192.png" alt="" style={{ width: '48px', height: '48px', borderRadius: '12px', border: `1px solid ${COLORS.border}` }} />
            <div>
              <div style={{ fontSize: '16px', fontWeight: 800, color: COLORS.ink }}>تثبيت التطبيق على الموبايل</div>
              <div style={{ fontSize: '12px', color: COLORS.muted, marginTop: '2px' }}>
                يفتح من الشاشة الرئيسية زي أي تطبيق، وبملء الشاشة
              </div>
            </div>
          </div>

          <ol style={{ margin: 0, paddingRight: '20px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px', color: COLORS.ink, lineHeight: 1.7 }}>
            {IS_IOS ? (
              <>
                <li>
                  افتح الموقع من متصفح <strong>Safari</strong>.
                </li>
                <li>
                  اضغط زر <strong>المشاركة</strong>{' '}
                  <ShareGlyph /> في الشريط أسفل الشاشة (أو أعلاها في الآيباد).
                </li>
                <li>
                  انزل واختر <strong>«إضافة إلى الشاشة الرئيسية»</strong> (Add to Home Screen).
                </li>
                <li>
                  اضغط <strong>«إضافة»</strong> — هتلاقي أيقونة التطبيق على الشاشة الرئيسية.
                </li>
              </>
            ) : (
              <>
                <li>
                  افتح قائمة المتصفح <strong>⋮</strong> (أعلى الشاشة في Chrome، أو أسفلها في Samsung Internet).
                </li>
                <li>
                  اختر <strong>«تثبيت التطبيق»</strong> أو <strong>«إضافة إلى الشاشة الرئيسية»</strong>.
                </li>
                <li>
                  اضغط <strong>«تثبيت»</strong> — هتلاقي أيقونة التطبيق على الشاشة الرئيسية.
                </li>
              </>
            )}
          </ol>

          <button
            type="button"
            onClick={() => setGuideOpen(false)}
            style={{
              padding: '13px',
              borderRadius: '12px',
              border: 'none',
              backgroundColor: COLORS.primary,
              color: '#FFFFFF',
              fontSize: '15px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            تمام
          </button>
        </div>
      </BottomSheet>,
        document.body
      )}
    </>
  );
};

/** iOS share icon (square with an up arrow) */
const ShareGlyph: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.primary} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-3px' }}>
    <path d="M12 3v12M7 8l5-5 5 5" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
);
