import React, { useState } from 'react';
import { api } from '../api';
import { exportPlanPdf } from '../utils/pdfExport';

interface Props {
  userCode: string;
  planId: string;
  /** Limit the export to one city ('' / undefined = every city the user can see) */
  center?: string;
  compact?: boolean;
}

/** Two buttons: styled Excel (built on the server) and PDF (built in the browser), same columns in both. */
export const ExportButtons: React.FC<Props> = ({ userCode, planId, center, compact = false }) => {
  const [pdfProgress, setPdfProgress] = useState<number | null>(null);

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
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: compact ? '10px 12px' : '12px 14px',
    borderRadius: '12px',
    fontSize: '13px',
    fontWeight: 800,
    minWidth: 0,
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
      <button
        type="button"
        onClick={downloadExcel}
        disabled={!planId}
        style={{ ...base, backgroundColor: '#E8F5EC', color: '#1E7B34', border: '1px solid #BFE3CB' }}
        title="ملف Excel منسّق بالأعمدة: اسم المنشأة، الكود، العنوان، المدينة، تاريخ آخر معاينة، حالة الخطة"
      >
        <FileBadge label="XLS" color="#1E7B34" />
        <span>تصدير Excel{scope ? ` — ${scope}` : ''}</span>
      </button>
      <button
        type="button"
        onClick={downloadPdf}
        disabled={!planId || pdfProgress !== null}
        style={{ ...base, backgroundColor: '#FDECEC', color: '#B91C1C', border: '1px solid #F5C2C2', opacity: pdfProgress !== null ? 0.85 : 1 }}
        title="ملف PDF بنفس أعمدة الإكسيل، A4 عرضي"
      >
        <FileBadge label="PDF" color="#B91C1C" />
        <span>{pdfProgress !== null ? `جارٍ إنشاء PDF… ${pdfProgress}%` : `تصدير PDF${scope ? ` — ${scope}` : ''}`}</span>
      </button>
    </div>
  );
};

const FileBadge: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <span
    aria-hidden="true"
    style={{
      fontSize: '9.5px', fontWeight: 800, letterSpacing: '0.3px', color: '#FFFFFF', backgroundColor: color,
      borderRadius: '5px', padding: '2px 5px', lineHeight: 1.4, direction: 'ltr',
    }}
  >
    {label}
  </span>
);
