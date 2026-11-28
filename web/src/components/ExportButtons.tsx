import React, { useState } from 'react';
import { api } from '../api';
import { exportPlanPdf } from '../utils/pdfExport';
import { EstablishmentsView } from './EstablishmentsView';

interface Props {
  userCode: string;
  planId: string;
  /** Limit the export to one city ('' / undefined = every city the user can see) */
  center?: string;
  compact?: boolean;
}

/**
 * Three buttons: styled Excel (built on the server), «عرض المنشآت» (view-only registry page, no download)
 * and PDF (built in the browser, same columns as Excel).
 * Labels wrap / shrink instead of overflowing on narrow phones, even with a long city name.
 */
export const ExportButtons: React.FC<Props> = ({ userCode, planId, center, compact = false }) => {
  const [pdfProgress, setPdfProgress] = useState<number | null>(null);
  const [showEstablishments, setShowEstablishments] = useState(false);

  const scope = center && center !== 'الكل' ? center : undefined;

  const downloadExcel = () => {
    if (!planId) return;
    window.open(api.exportUrl(userCode, planId, scope), '_blank');
  };

  const downloadPdf = async () => {
    if (!planId || pdfProgress !== null) return;
    setPdfProgress(0);
    try {
      const report = await api.getReport(userCode, planId, scope);
      await exportPlanPdf(report, report.file_name, setPdfProgress);
    } catch (err: any) {
      alert('تعذر إنشاء ملف PDF: ' + (err?.message || 'خطأ غير متوقع'));
    } finally {
      setPdfProgress(null);
    }
  };

  const base: React.CSSProperties = {
    flex: '1 1 0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: compact ? '9px 8px' : '11px 10px',
    borderRadius: '12px',
    fontSize: '12.5px',
    fontWeight: 800,
    minWidth: 0,
    lineHeight: 1.25,
    textAlign: 'center',
  };

  return (
    <>
      <div className="export-row" style={{ display: 'flex', gap: '6px', width: '100%', minWidth: 0 }}>
        <button
          type="button"
          onClick={downloadExcel}
          disabled={!planId}
          style={{ ...base, backgroundColor: '#E8F5EC', color: '#1E7B34', border: '1px solid #BFE3CB' }}
          title={`ملف Excel منسّق بالأعمدة: اسم المنشأة، الكود، العنوان، المدينة، تاريخ آخر معاينة، حالة الخطة${scope ? ` — ${scope}` : ''}`}
        >
          <FileBadge label="XLS" color="#1E7B34" />
          <BtnLabel main="تصدير Excel" sub={scope} />
        </button>
        <button
          type="button"
          onClick={() => setShowEstablishments(true)}
          style={{ ...base, backgroundColor: '#E6F2F8', color: '#006B9F', border: '1px solid #B9DAEA' }}
          title="عرض كل المنشآت المسجلة في السيستم داخل الموقع (للعرض فقط، بدون تحميل)"
        >
          <EyeBadge />
          <BtnLabel main="عرض المنشآت" />
        </button>
        <button
          type="button"
          onClick={downloadPdf}
          disabled={!planId || pdfProgress !== null}
          style={{ ...base, backgroundColor: '#FDECEC', color: '#B91C1C', border: '1px solid #F5C2C2', opacity: pdfProgress !== null ? 0.85 : 1 }}
          title={`ملف PDF بنفس أعمدة الإكسيل، A4 عرضي${scope ? ` — ${scope}` : ''}`}
        >
          <FileBadge label="PDF" color="#B91C1C" />
          <BtnLabel main={pdfProgress !== null ? `جارٍ الإنشاء ${pdfProgress}%` : 'تصدير PDF'} sub={pdfProgress !== null ? undefined : scope} />
        </button>
      </div>
      <EstablishmentsView
        isOpen={showEstablishments}
        onClose={() => setShowEstablishments(false)}
        userCode={userCode}
        initialCenter={scope}
      />
    </>
  );
};

/** Main text + optional small second line (the city). Both shrink with an ellipsis instead of overflowing. */
const BtnLabel: React.FC<{ main: string; sub?: string }> = ({ main, sub }) => (
  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, alignItems: 'center' }}>
    <span className="text-ellipsis" style={{ maxWidth: '100%' }}>{main}</span>
    {sub && (
      <span className="text-ellipsis" style={{ maxWidth: '100%', fontSize: '10.5px', fontWeight: 700, opacity: 0.8 }}>
        {sub}
      </span>
    )}
  </span>
);

const EyeBadge: React.FC = () => (
  <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const FileBadge: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <span
    aria-hidden="true"
    style={{
      fontSize: '9.5px', fontWeight: 800, letterSpacing: '0.3px', color: '#FFFFFF', backgroundColor: color,
      borderRadius: '5px', padding: '2px 5px', lineHeight: 1.4, direction: 'ltr', flexShrink: 0,
    }}
  >
    {label}
  </span>
);
