import React, { useRef, useState } from 'react';
import { PickerShell } from './PickerShell';
import { AR_MONTHS, HeadButton, MonthGrid, PickerHeader, YEARS_PER_PAGE, YearGrid, yearPageStart } from './DatePicker';

interface Props {
  value: string; // YYYY-MM
  onChange: (value: string) => void;
  title?: string;
}

/** اختيار شهر/سنة: شبكة 12 شهر، والضغط على السنة يفتح شبكة السنين — بنفس شكل التقويم */
export const MonthPicker: React.FC<Props> = ({ value, onChange, title = 'اختر الشهر' }) => {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'months' | 'years'>('months');
  const btnRef = useRef<HTMLButtonElement>(null);
  const m = /^(\d{4})-(\d{2})$/.exec(value || '');
  const selYear = m ? Number(m[1]) : null;
  const selMonth = m ? Number(m[2]) - 1 : null;
  const now = new Date();
  const [year, setYear] = useState(selYear ?? now.getFullYear());
  const [yearPage, setYearPage] = useState(yearPageStart(year));

  const pick = (mi: number) => {
    onChange(`${year}-${String(mi + 1).padStart(2, '0')}`);
    setOpen(false);
    btnRef.current?.focus();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`pk-trigger pk-md${open ? ' pk-open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            setYear(selYear ?? now.getFullYear());
            setView('months');
          }
          setOpen((o) => !o);
        }}
      >
        <svg className="pk-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="3" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span className={m ? 'pk-value' : 'pk-placeholder'}>{m ? `${AR_MONTHS[selMonth!]} ${selYear}` : 'اختر الشهر'}</span>
        <svg className="pk-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <PickerShell open={open} onClose={() => setOpen(false)} anchorRef={btnRef} title={title} fixedWidth={320} estHeight={300}>
        <div className="pk-calendar">
          {view === 'months' ? (
            <>
              <PickerHeader
                onPrev={() => setYear((y) => y - 1)}
                onNext={() => setYear((y) => y + 1)}
                prevLabel="السنة السابقة"
                nextLabel="السنة التالية"
              >
                <HeadButton
                  onClick={() => {
                    setYearPage(yearPageStart(year));
                    setView('years');
                  }}
                  label="اختر السنة"
                >
                  {year}
                </HeadButton>
              </PickerHeader>
              <div className="pk-view">
                <MonthGrid year={year} selected={m ? { y: selYear!, m: selMonth! } : null} onPick={pick} />
              </div>
            </>
          ) : (
            <>
              <PickerHeader
                onPrev={() => setYearPage((p) => p - YEARS_PER_PAGE)}
                onNext={() => setYearPage((p) => p + YEARS_PER_PAGE)}
                prevLabel="سنين سابقة"
                nextLabel="سنين تالية"
              >
                <span className="pk-head-range">
                  من {yearPage} إلى {yearPage + YEARS_PER_PAGE - 1}
                </span>
              </PickerHeader>
              <div className="pk-view">
                <YearGrid
                  start={yearPage}
                  selected={selYear}
                  onPick={(y) => {
                    setYear(y);
                    setView('months');
                  }}
                />
              </div>
            </>
          )}
        </div>
      </PickerShell>
    </>
  );
};
