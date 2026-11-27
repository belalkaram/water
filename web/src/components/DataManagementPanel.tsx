import React, { useState } from 'react';
import { COLORS } from '../theme';
import type { MonthlyPlan } from '../types';
import { api } from '../api';
import { Trash2Icon } from './Icons';

interface Props {
  plans: MonthlyPlan[];
  planId: string;
  onChanged: () => void;
}

const btn = (danger: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  padding: '11px 12px',
  borderRadius: '10px',
  border: danger ? 'none' : `1px solid #FECACA`,
  backgroundColor: danger ? COLORS.red : COLORS.redSoft,
  color: danger ? '#FFFFFF' : COLORS.red,
  fontSize: '13px',
  fontWeight: 800,
  cursor: 'pointer',
});

/** أدمن: مسح النشاط ومسح خطة كاملة — التغيير يظهر عند كل الموظفين */
export const DataManagementPanel: React.FC<Props> = ({ plans, planId, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const plan = plans.find((p) => p.id === planId);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      alert(await fn());
      onChanged();
    } catch (err: any) {
      alert('تعذر التنفيذ: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const clearPlanFeed = () => {
    if (!plan) return;
    if (!window.confirm(`حذف كل نشاط الفريق في ${plan.month_label} نهائياً؟\nسيختفي من عند كل الموظفين ولا يمكن استرجاعه.`)) return;
    run(async () => `تم حذف ${(await api.clearFeed(plan.id)).deleted} نشاط من ${plan.month_label}`);
  };

  const clearAllFeed = () => {
    if (!window.confirm('حذف نشاط الفريق في كل الخطط نهائياً؟\nسيختفي من عند كل الموظفين ولا يمكن استرجاعه.')) return;
    run(async () => `تم حذف ${(await api.clearFeed('all')).deleted} نشاط من كل الخطط`);
  };

  const deletePlan = () => {
    if (!plan) return;
    const typed = window.prompt(
      `⚠️ حذف ${plan.month_label} نهائياً\n\n` +
        `سيتم حذف كل منشآت الخطة (${plan.total_facilities}) وكل المعاينات المسجلة فيها ونشاطها، ` +
        `ولن تظهر لأي موظف. لا يمكن استرجاعها.\n` +
        `النظام لن يعيد إنشاءها تلقائياً — يمكنك إنشاؤها يدوياً من «الخطة الشهرية التلقائية».\n\n` +
        `للتأكيد اكتب اسم الخطة كما هو:\n${plan.month_label}`
    );
    if (typed === null) return;
    if (typed.trim() !== plan.month_label) {
      alert('الاسم غير مطابق — لم يتم حذف الخطة');
      return;
    }
    run(async () => {
      const { deleted } = await api.deletePlan(plan.id);
      return `تم حذف ${deleted.plan}: ${deleted.facilities} منشأة و ${deleted.inspections} معاينة`;
    });
  };

  return (
    <div
      style={{
        backgroundColor: COLORS.surface,
        borderRadius: '16px',
        padding: '16px',
        border: `1px solid #FECACA`,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <h3 style={{ fontSize: '15px', fontWeight: 800, color: COLORS.ink, margin: 0 }}>إدارة البيانات</h3>
      <p style={{ fontSize: '12px', color: COLORS.muted, margin: 0, lineHeight: 1.6 }}>
        الحذف نهائي ويظهر أثره عند كل الموظفين. الخطة المختارة حالياً: <strong>{plan?.month_label || '—'}</strong>
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
        <button type="button" disabled={busy || !plan} onClick={clearPlanFeed} style={btn(false)}>
          <Trash2Icon size={14} color={COLORS.red} />
          مسح نشاط هذه الخطة
        </button>
        <button type="button" disabled={busy} onClick={clearAllFeed} style={btn(false)}>
          <Trash2Icon size={14} color={COLORS.red} />
          مسح نشاط كل الخطط
        </button>
        <button type="button" disabled={busy || !plan} onClick={deletePlan} style={btn(true)}>
          <Trash2Icon size={14} color="#FFFFFF" />
          حذف هذه الخطة نهائياً
        </button>
      </div>
    </div>
  );
};
