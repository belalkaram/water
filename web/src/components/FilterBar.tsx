import React from 'react';
import { Select, type SelectOption } from './pickers/Select';

export interface DropdownFilter {
  key: string;
  /** اسم الفلتر، يظهر داخل الزر: «المدينة: الكل» */
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  /** القيمة اللي تعني «بدون فلتر» — لو مش محددة يبقى الفلتر دايماً له قيمة (زي الخطة) ومش بيظهر كشريحة */
  defaultValue?: string;
}

export interface SegmentedFilter {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; badge?: number }[];
  defaultValue: string;
  label: string;
}

interface Props {
  dropdowns: DropdownFilter[];
  search?: { value: string; onChange: (v: string) => void; placeholder: string };
  segmented?: SegmentedFilter;
  /** «عرض 45 من 273 منشأة» */
  resultText?: string;
}

/**
 * شريط فلاتر موحّد لكل صفحات التطبيق:
 * قوائم منسدلة (الخطة/المدينة…) + بحث + أزرار حالة متساوية العرض، بدون أي سحب يمين وشمال،
 * وتحتهم الفلاتر المفعّلة كشرائح تتشال بضغطة + «مسح الكل».
 */
export const FilterBar: React.FC<Props> = ({ dropdowns, search, segmented, resultText }) => {
  const active: { key: string; text: string; clear: () => void }[] = [];
  dropdowns.forEach((d) => {
    if (d.defaultValue !== undefined && d.value !== d.defaultValue) {
      const opt = d.options.find((o) => o.value === d.value);
      active.push({ key: d.key, text: `${d.label}: ${opt?.label ?? d.value}`, clear: () => d.onChange(d.defaultValue!) });
    }
  });
  if (segmented && segmented.value !== segmented.defaultValue) {
    const opt = segmented.options.find((o) => o.value === segmented.value);
    active.push({ key: '__seg', text: `${segmented.label}: ${opt?.label ?? ''}`, clear: () => segmented.onChange(segmented.defaultValue) });
  }
  if (search && search.value.trim()) {
    active.push({ key: '__q', text: `بحث: «${search.value.trim()}»`, clear: () => search.onChange('') });
  }
  const clearAll = () => active.forEach((a) => a.clear());

  return (
    <div className="fb">
      {dropdowns.length > 0 && (
        <div className="fb-dropdowns">
          {dropdowns.map((d) => (
            <Select
              key={d.key}
              value={d.value}
              onChange={d.onChange}
              options={d.options}
              prefix={`${d.label}:`}
              title={`اختر ${d.label}`}
              highlighted={d.defaultValue !== undefined && d.value !== d.defaultValue}
            />
          ))}
        </div>
      )}

      {search && (
        <div className={`fb-search${search.value ? ' fb-search-on' : ''}`}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input type="search" value={search.value} onChange={(e) => search.onChange(e.target.value)} placeholder={search.placeholder} />
          {search.value && (
            <button type="button" className="fb-search-clear" onClick={() => search.onChange('')} aria-label="مسح البحث">
              ✕
            </button>
          )}
        </div>
      )}

      {segmented && (
        <div className="fb-seg" role="radiogroup" aria-label={segmented.label}>
          {segmented.options.map((o) => {
            const on = o.value === segmented.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                className={`fb-seg-btn${on ? ' fb-seg-on' : ''}`}
                onClick={() => segmented.onChange(o.value)}
              >
                <span className="fb-seg-label">{o.label}</span>
                {o.badge !== undefined && <span className="fb-seg-badge">{o.badge}</span>}
              </button>
            );
          })}
        </div>
      )}

      {(active.length > 0 || resultText) && (
        <div className="fb-active">
          {active.map((a) => (
            <button key={a.key} type="button" className="fb-pill" onClick={a.clear} title="إزالة الفلتر">
              <span>{a.text}</span>
              <span className="fb-pill-x">✕</span>
            </button>
          ))}
          {active.length > 1 && (
            <button type="button" className="fb-clear" onClick={clearAll}>
              مسح الكل
            </button>
          )}
          {resultText && <span className="fb-result">{resultText}</span>}
        </div>
      )}
    </div>
  );
};
