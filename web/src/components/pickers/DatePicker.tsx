import React, { useMemo, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { arEG } from 'react-day-picker/locale';
import 'react-day-picker/style.css';
import { PickerShell } from './PickerShell';

export const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const AR_DAYS_SHORT = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];

const pad = (n: number) => String(n).padStart(2, '0');
export const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseYmd(s?: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}
/** «الخميس 27 نوفمبر 2026» */
export function formatLongAr(s?: string): string {
  const d = parseYmd(s);
  return d ? `${AR_DAYS[d.getDay()]} ${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
}

const ymIndex = (y: number, m: number) => y * 12 + m;
const YEARS_PER_PAGE = 12;

// ─── Shared header + month / year grids (also used by MonthPicker) ──────────

const Arrow: React.FC<{ dir: 'prev' | 'next'; disabled?: boolean; onClick: () => void; label: string }> = ({ dir, disabled, onClick, label }) => (
  <button type="button" className="pk-nav" disabled={disabled} onClick={onClick} aria-label={label}>
    {/* RTL: السابق يشير لليمين والتالي لليسار */}
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 'prev' ? 'm9 18 6-6-6-6' : 'm15 18-6-6 6-6'} />
    </svg>
  </button>
);

export const PickerHeader: React.FC<{
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  prevLabel: string;
  nextLabel: string;
  children: React.ReactNode;
}> = ({ onPrev, onNext, prevDisabled, nextDisabled, prevLabel, nextLabel, children }) => (
  <div className="pk-head">
    <Arrow dir="prev" disabled={prevDisabled} onClick={onPrev} label={prevLabel} />
    <div className="pk-head-title">{children}</div>
    <Arrow dir="next" disabled={nextDisabled} onClick={onNext} label={nextLabel} />
  </div>
);

/** زر في العنوان يفتح شبكة الشهور أو السنين */
export const HeadButton: React.FC<{ active?: boolean; onClick: () => void; children: React.ReactNode; label: string }> = ({ active, onClick, children, label }) => (
  <button type="button" className={`pk-head-btn${active ? ' pk-head-btn-on' : ''}`} onClick={onClick} aria-label={label}>
    {children}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  </button>
);

export const MonthGrid: React.FC<{
  year: number;
  selected?: { y: number; m: number } | null;
  isDisabled?: (m: number) => boolean;
  onPick: (m: number) => void;
}> = ({ year, selected, isDisabled, onPick }) => {
  const now = new Date();
  return (
    <div className="pk-grid">
      {AR_MONTHS.map((name, i) => {
        const sel = !!selected && selected.y === year && selected.m === i;
        const cur = now.getFullYear() === year && now.getMonth() === i;
        return (
          <button
            key={name}
            type="button"
            disabled={isDisabled?.(i)}
            className={`pk-cell${sel ? ' pk-selected' : ''}${cur ? ' pk-now' : ''}`}
            onClick={() => onPick(i)}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
};

export const YearGrid: React.FC<{
  start: number;
  selected?: number | null;
  minYear?: number;
  maxYear?: number;
  onPick: (y: number) => void;
}> = ({ start, selected, minYear, maxYear, onPick }) => {
  const thisYear = new Date().getFullYear();
  return (
    <div className="pk-grid">
      {Array.from({ length: YEARS_PER_PAGE }, (_, i) => start + i).map((y) => (
        <button
          key={y}
          type="button"
          disabled={(minYear !== undefined && y < minYear) || (maxYear !== undefined && y > maxYear)}
          className={`pk-cell${selected === y ? ' pk-selected' : ''}${thisYear === y ? ' pk-now' : ''}`}
          onClick={() => onPick(y)}
        >
          {y}
        </button>
      ))}
    </div>
  );
};

export const yearPageStart = (y: number) => y - ((y % YEARS_PER_PAGE) + YEARS_PER_PAGE) % YEARS_PER_PAGE;
export { YEARS_PER_PAGE };

// ─── DatePicker ───────────────────────────────────────────────────────────

interface Props {
  value: string; // YYYY-MM-DD أو ''
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  title?: string;
  clearable?: boolean;
  id?: string;
  size?: 'md' | 'lg';
}

type View = 'days' | 'months' | 'years';

/** حقل تاريخ بتقويم عربي (react-day-picker) — popover على الديسكتوب و bottom sheet على الموبايل.
 *  الضغط على اسم الشهر يفتح شبكة الشهور، والضغط على السنة يفتح شبكة السنين. */
export const DatePicker: React.FC<Props> = ({ value, onChange, min, max, placeholder = 'اختر التاريخ', title = 'اختر التاريخ', clearable = true, id, size = 'md' }) => {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('days');
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = parseYmd(value);
  const minD = parseYmd(min);
  const maxD = parseYmd(max);
  const today = new Date();
  const todayYmd = toYmd(today);
  const todayAllowed = (!min || todayYmd >= min) && (!max || todayYmd <= max);
  const [month, setMonth] = useState<Date>(selected || maxD || today);
  const [yearPage, setYearPage] = useState(yearPageStart(month.getFullYear()));

  const y = month.getFullYear();
  const m = month.getMonth();
  const minIdx = minD ? ymIndex(minD.getFullYear(), minD.getMonth()) : -Infinity;
  const maxIdx = maxD ? ymIndex(maxD.getFullYear(), maxD.getMonth()) : Infinity;
  const clampMonth = (yy: number, mm: number) => {
    const idx = Math.min(maxIdx, Math.max(minIdx, ymIndex(yy, mm)));
    return new Date(Math.floor(idx / 12), idx % 12, 1);
  };

  const disabled = useMemo(() => {
    const out: any[] = [];
    if (minD) out.push({ before: minD });
    if (maxD) out.push({ after: maxD });
    return out;
  }, [min, max]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => {
    if (!open) {
      setMonth(selected || (maxD && maxD < today ? maxD : today));
      setView('days');
    }
    setOpen((o) => !o);
  };
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    btnRef.current?.focus();
  };

  let header: React.ReactNode;
  let body: React.ReactNode;

  if (view === 'days') {
    header = (
      <PickerHeader
        onPrev={() => setMonth(new Date(y, m - 1, 1))}
        onNext={() => setMonth(new Date(y, m + 1, 1))}
        prevDisabled={ymIndex(y, m) <= minIdx}
        nextDisabled={ymIndex(y, m) >= maxIdx}
        prevLabel="الشهر السابق"
        nextLabel="الشهر التالي"
      >
        <HeadButton onClick={() => setView('months')} label="اختر الشهر">
          {AR_MONTHS[m]}
        </HeadButton>
        <HeadButton
          onClick={() => {
            setYearPage(yearPageStart(y));
            setView('years');
          }}
          label="اختر السنة"
        >
          {y}
        </HeadButton>
      </PickerHeader>
    );
    body = (
      <DayPicker
        mode="single"
        dir="rtl"
        locale={arEG}
        weekStartsOn={6}
        month={month}
        onMonthChange={setMonth}
        selected={selected}
        onSelect={(d) => d && pick(toYmd(d))}
        disabled={disabled}
        startMonth={minD}
        endMonth={maxD}
        hideNavigation
        showOutsideDays
        fixedWeeks
        formatters={{
          formatDay: (d) => String(d.getDate()),
          formatWeekdayName: (d) => AR_DAYS_SHORT[d.getDay()],
        }}
      />
    );
  } else if (view === 'months') {
    header = (
      <PickerHeader
        onPrev={() => setMonth(clampMonth(y - 1, m))}
        onNext={() => setMonth(clampMonth(y + 1, m))}
        prevDisabled={ymIndex(y - 1, 11) < minIdx}
        nextDisabled={ymIndex(y + 1, 0) > maxIdx}
        prevLabel="السنة السابقة"
        nextLabel="السنة التالية"
      >
        <HeadButton
          active
          onClick={() => {
            setYearPage(yearPageStart(y));
            setView('years');
          }}
          label="اختر السنة"
        >
          {y}
        </HeadButton>
      </PickerHeader>
    );
    body = (
      <MonthGrid
        year={y}
        selected={selected ? { y: selected.getFullYear(), m: selected.getMonth() } : null}
        isDisabled={(mi) => ymIndex(y, mi) < minIdx || ymIndex(y, mi) > maxIdx}
        onPick={(mi) => {
          setMonth(new Date(y, mi, 1));
          setView('days');
        }}
      />
    );
  } else {
    const minYear = minD?.getFullYear();
    const maxYear = maxD?.getFullYear();
    header = (
      <PickerHeader
        onPrev={() => setYearPage((p) => p - YEARS_PER_PAGE)}
        onNext={() => setYearPage((p) => p + YEARS_PER_PAGE)}
        prevDisabled={minYear !== undefined && yearPage <= minYear}
        nextDisabled={maxYear !== undefined && yearPage + YEARS_PER_PAGE - 1 >= maxYear}
        prevLabel="سنين سابقة"
        nextLabel="سنين تالية"
      >
        <span className="pk-head-range">
          من {yearPage} إلى {yearPage + YEARS_PER_PAGE - 1}
        </span>
      </PickerHeader>
    );
    body = (
      <YearGrid
        start={yearPage}
        selected={selected?.getFullYear() ?? null}
        minYear={minYear}
        maxYear={maxYear}
        onPick={(yy) => {
          setMonth(clampMonth(yy, m));
          setView('months');
        }}
      />
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        id={id}
        type="button"
        className={`pk-trigger pk-${size}${open ? ' pk-open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <svg className="pk-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="3" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span className={value ? 'pk-value' : 'pk-placeholder'}>{value ? formatLongAr(value) : placeholder}</span>
        <svg className="pk-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <PickerShell open={open} onClose={() => setOpen(false)} anchorRef={btnRef} title={title} fixedWidth={336} estHeight={420}>
        <div className="pk-calendar">
          {header}
          <div className={`pk-view pk-view-${view}`}>{body}</div>
          <div className="pk-cal-foot">
            <button
              type="button"
              className="pk-link"
              disabled={!todayAllowed}
              onClick={() => (view === 'days' ? pick(todayYmd) : (setMonth(today), setView('days')))}
            >
              {view === 'days' ? 'اليوم' : 'الرجوع لليوم'}
            </button>
            {clearable && value && (
              <button type="button" className="pk-link pk-link-muted" onClick={() => pick('')}>
                مسح التاريخ
              </button>
            )}
          </div>
        </div>
      </PickerShell>
    </>
  );
};
