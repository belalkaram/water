import React, { useState } from 'react';
import { COLORS } from '../theme';
import { api } from '../api';
import { MonthPicker } from './pickers/MonthPicker';

interface Props {
  adminCode: string;
  onCreated: () => void;
}

interface Preview {
  plan_month: string;
  month_label: string;
  total: number;
  by_center: Record<string, number>;
  exists: boolean;
}

function nextMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const MonthlyPlanPanel: React.FC<Props> = ({ adminCode, onCreated }) => {
  const [month, setMonth] = useState(nextMonth());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  const doPreview = async () => {
    setBusy(true);
    try {
      setPreview(await api.previewMonthlyPlan(adminCode, month));
    } catch (err: any) {
      alert('خطأ: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const doGenerate = async () => {
    if (!preview) return;
    if (!window.confirm(`إنشاء ${preview.month_label} بعدد ${preview.total} منشأة؟`)) return;
    setBusy(true);
    try {
      await api.generateMonthlyPlan(adminCode, month);
      setPreview(null);
      onCreated();
      alert('تم إنشاء الخطة');
    } catch (err: any) {
      alert('خطأ: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        backgroundColor: COLORS.surface, borderRadius: '16px', padding: '16px',
        border: `1px solid ${COLORS.border}`, display: 'flex', flexDirection: 'column', gap: '10px',
      }}
    >
      <h3 style={{ fontSize: '15px', fontWeight: 800, color: COLORS.ink, margin: 0 }}>الخطة الشهرية التلقائية</h3>
      <p style={{ fontSize: '12px', color: COLORS.muted, margin: 0, lineHeight: 1.6 }}>
        تُجهَّز خطة الشهر الجديد تلقائياً في آخر يوم من كل شهر: كل منشأة مفتوحة مرّ على آخر معاينة لها 6 شهور أو لم تُعاين من قبل،
        وأول الشهر تُرحَّل إليها المنشآت التي لم تتم في الشهر السابق.
        هنا يمكنك معاينة أو إنشاء خطة شهر بشكل يدوي.
      </p>
      <div style={{ display: 'flex', gap: '8px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <MonthPicker value={month} onChange={(v) => { setMonth(v); setPreview(null); }} />
        </div>
        <button
          type="button" onClick={doPreview} disabled={busy || !month}
          style={{ padding: '10px 14px', borderRadius: '10px', backgroundColor: COLORS.primary, color: '#FFFFFF', fontSize: '13px', fontWeight: 800 }}
        >
          معاينة
        </button>
      </div>
      {preview && (
        <div style={{ padding: '10px', borderRadius: '10px', backgroundColor: COLORS.bg, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <strong style={{ fontSize: '13px', color: COLORS.ink }}>
            {preview.month_label}: {preview.total} منشأة مستحقة
          </strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {Object.entries(preview.by_center).map(([c, n]) => (
              <span key={c} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', backgroundColor: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
                {c}: {n}
              </span>
            ))}
          </div>
          {preview.exists ? (
            <span style={{ fontSize: '12px', color: COLORS.amber, fontWeight: 700 }}>هذه الخطة موجودة بالفعل</span>
          ) : preview.total === 0 ? (
            <span style={{ fontSize: '12px', color: COLORS.muted }}>لا توجد منشآت مستحقة</span>
          ) : (
            <button
              type="button" onClick={doGenerate} disabled={busy}
              style={{ padding: '10px', borderRadius: '10px', backgroundColor: COLORS.green, color: '#FFFFFF', fontSize: '13px', fontWeight: 800 }}
            >
              إنشاء {preview.month_label}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
