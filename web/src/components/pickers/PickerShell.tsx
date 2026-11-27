import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MOBILE_QUERY = '(max-width: 640px)';

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}

interface Props {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement>;
  /** عنوان يظهر في أعلى الـ bottom sheet على الموبايل */
  title?: string;
  /** أقل عرض للقائمة على الديسكتوب */
  minWidth?: number;
  /** عرض ثابت للـ popover (مثلاً التقويم) بدل عرض الحقل */
  fixedWidth?: number;
  /** أقصى ارتفاع متوقع (لتحديد الفتح لأعلى أو لأسفل) */
  estHeight?: number;
  children: React.ReactNode;
}

/**
 * غلاف موحد لكل القوائم المنبثقة (dropdown / calendar):
 * - الديسكتوب: popover أسفل الحقل (أو أعلاه لو مفيش مساحة).
 * - الموبايل: bottom sheet بعرض الشاشة وأزرار كبيرة سهلة اللمس.
 */
export const PickerShell: React.FC<Props> = ({ open, onClose, anchorRef, title, minWidth = 220, fixedWidth, estHeight = 320, children }) => {
  const mobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({ visibility: 'hidden' });

  // position the desktop popover relative to the trigger
  useLayoutEffect(() => {
    if (!open || mobile) return;
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      if (!a) return;
      const width = Math.min(window.innerWidth - 16, fixedWidth ?? Math.max(a.width, minWidth));
      const h = panelRef.current?.offsetHeight || estHeight;
      const below = window.innerHeight - a.bottom;
      const up = below < h + 12 && a.top > below;
      let right = window.innerWidth - a.right; // RTL: align right edges
      if (window.innerWidth - right - width < 8) right = Math.max(8, window.innerWidth - width - 8);
      setPos({
        position: 'fixed',
        right,
        width,
        top: up ? Math.max(8, a.top - h - 6) : a.bottom + 6,
        visibility: 'visible',
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, mobile, anchorRef, minWidth, fixedWidth, estHeight]);

  // close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        anchorRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchorRef]);

  // lock page scroll behind the mobile sheet
  useEffect(() => {
    if (!open || !mobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, mobile]);

  if (!open) return null;

  if (mobile) {
    return createPortal(
      <div className="pk-sheet-overlay" dir="rtl">
        <div ref={panelRef} className="pk-sheet" role="dialog" aria-label={title}>
          <div className="pk-sheet-handle" />
          {title && (
            <div className="pk-sheet-head">
              <span>{title}</span>
              <button type="button" className="pk-sheet-close" onClick={onClose} aria-label="إغلاق">
                ✕
              </button>
            </div>
          )}
          <div className="pk-sheet-body">{children}</div>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div ref={panelRef} className="pk-popover" style={pos} dir="rtl" role="dialog" aria-label={title}>
      {children}
    </div>,
    document.body
  );
};
