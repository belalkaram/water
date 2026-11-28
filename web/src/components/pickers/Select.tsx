import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PickerShell, useIsMobile } from './PickerShell';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  /** رقم صغير يظهر بجانب الاختيار (مثلاً عدد المنشآت) */
  badge?: number | string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: (string | SelectOption)[];
  placeholder?: string;
  /** عنوان الـ bottom sheet على الموبايل */
  title?: string;
  /** إظهار خانة بحث (تلقائياً لو الاختيارات أكتر من 8) */
  searchable?: boolean;
  disabled?: boolean;
  id?: string;
  size?: 'md' | 'lg';
  /** عنوان صغير داخل الزر قبل القيمة، مثل «المدينة:» */
  prefix?: string;
  /** تمييز الزر لما تكون القيمة غير الافتراضية (فلتر مفعّل) */
  highlighted?: boolean;
}

const norm = (o: string | SelectOption): SelectOption => (typeof o === 'string' ? { value: o, label: o } : o);

/** قائمة منسدلة احترافية: popover على الديسكتوب و bottom sheet على الموبايل، مع بحث ودعم الكيبورد */
export const Select: React.FC<Props> = ({ value, onChange, options, placeholder = 'اختر...', title, searchable, disabled, id, size = 'md', prefix, highlighted }) => {
  const opts = useMemo(() => options.map(norm), [options]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Scroll the list only when opening or moving with the keyboard. Scrolling on hover/touch made
  // phones pick the wrong item: the tap's emulated mouseenter scrolled the list under the finger,
  // so the click then landed on the option above (tap the 4th → got the 3rd).
  const scrollOnActive = useRef(false);
  const mobile = useIsMobile();
  const showSearch = searchable ?? opts.length > 8;

  const filtered = useMemo(() => {
    const s = q.trim();
    return s ? opts.filter((o) => o.label.includes(s) || (o.hint || '').includes(s)) : opts;
  }, [opts, q]);

  const current = opts.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    setQ('');
    scrollOnActive.current = true;
    setActive(Math.max(0, opts.findIndex((o) => o.value === value)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !scrollOnActive.current) return;
    scrollOnActive.current = false;
    // scroll only the list's own container (scrollIntoView can shift the whole page sideways on mobile)
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    const box = (listRef.current?.closest('.pk-sheet-body') as HTMLElement | null) || listRef.current;
    if (!el || !box) return;
    const e = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (e.top < b.top) box.scrollTop -= b.top - e.top + 4;
    else if (e.bottom > b.bottom) box.scrollTop += e.bottom - b.bottom + 4;
  }, [active, open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    btnRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      scrollOnActive.current = true;
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      scrollOnActive.current = true;
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[active]) pick(filtered[active].value);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        id={id}
        type="button"
        disabled={disabled}
        className={`pk-trigger pk-${size}${open ? ' pk-open' : ''}${highlighted ? ' pk-highlight' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
      >
        <span className={current ? 'pk-value' : 'pk-placeholder'}>
          {prefix && <span className="pk-prefix">{prefix}</span>}
          {current ? current.label : placeholder}
        </span>
        <svg className="pk-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <PickerShell open={open} onClose={() => setOpen(false)} anchorRef={btnRef} title={title} estHeight={showSearch ? 340 : 290}>
        {showSearch && (
          <div className="pk-search">
            <input
              autoFocus={!mobile /* on phones the keyboard popping up/down shifts the sheet under the finger */}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
              placeholder="بحث..."
            />
          </div>
        )}
        <div ref={listRef} className="pk-list" role="listbox">
          {filtered.length === 0 && <div className="pk-empty">لا توجد نتائج</div>}
          {filtered.map((o, i) => {
            const selected = o.value === value;
            return (
              <div
                key={o.value}
                data-idx={i}
                role="option"
                aria-selected={selected}
                className={`pk-option${selected ? ' pk-selected' : ''}${i === active ? ' pk-active' : ''}`}
                onPointerEnter={(e) => {
                  if (e.pointerType === 'mouse') setActive(i);
                }}
                onClick={() => pick(o.value)}
              >
                <span className="pk-option-text">
                  <span>{o.label}</span>
                  {o.hint && <small>{o.hint}</small>}
                </span>
                {o.badge !== undefined && <span className="pk-badge">{o.badge}</span>}
                {selected && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </PickerShell>
    </>
  );
};
