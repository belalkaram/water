import React, { useCallback, useEffect, useState } from 'react';
import { COLORS } from '../theme';
import { OFFICIAL_CENTERS } from '../constants';
import type { User } from '../types';
import { api } from '../api';
import { UserPlusIcon } from './Icons';

interface Props {
  adminCode: string;
}

interface Draft {
  id: string | null; // null = new worker
  name: string;
  code: string;
  centers: string[];
}

const EMPTY: Draft = { id: null, name: '', code: '', centers: [] };

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: '10px',
  border: `1px solid ${COLORS.border}`,
  backgroundColor: COLORS.bg,
};

export const WorkersPanel: React.FC<Props> = ({ adminCode }) => {
  const [workers, setWorkers] = useState<User[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getWorkers(adminCode);
      setWorkers(res.workers);
    } catch {
      // ignore
    }
  }, [adminCode]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleCenter = (c: string) =>
    setDraft((d) =>
      d ? { ...d, centers: d.centers.includes(c) ? d.centers.filter((x) => x !== c) : [...d.centers, c] } : d
    );

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    if (!draft.name.trim() || !draft.code.trim()) return alert('أدخل اسم الموظف والكود');
    if (draft.centers.length === 0) return alert('اختر مدينة واحدة على الأقل');
    setBusy(true);
    try {
      const payload = { name: draft.name.trim(), code: draft.code.trim().toUpperCase(), assigned_centers: draft.centers };
      if (draft.id) await api.updateWorker(adminCode, draft.id, payload);
      else await api.createWorker(adminCode, payload);
      setDraft(null);
      await load();
    } catch (err: any) {
      alert('خطأ: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (w: User) => {
    if (!window.confirm(`${w.active ? 'إيقاف' : 'تفعيل'} الموظف ${w.name} (${w.code})؟`)) return;
    try {
      await api.toggleWorker(adminCode, w.id);
      load();
    } catch (err: any) {
      alert('خطأ: ' + err.message);
    }
  };

  const remove = async (w: User) => {
    if (!window.confirm(`حذف الموظف ${w.name} نهائياً؟\nلا يمكن التراجع. المعاينات السابقة تبقى محفوظة باسمه.`)) return;
    try {
      await api.deleteWorker(adminCode, w.id);
      load();
    } catch (err: any) {
      alert('خطأ: ' + err.message);
    }
  };

  const btn = (bg: string, color: string): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: '6px', backgroundColor: bg, color, fontSize: '11px', fontWeight: 700,
  });

  return (
    <div
      style={{
        backgroundColor: COLORS.surface, borderRadius: '16px', padding: '16px',
        border: `1px solid ${COLORS.border}`, display: 'flex', flexDirection: 'column', gap: '10px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 800, color: COLORS.ink, margin: 0 }}>
          إدارة الموظفين ({workers.length})
        </h3>
        {!draft && (
          <button
            type="button"
            onClick={() => setDraft({ ...EMPTY })}
            style={{ ...btn(COLORS.green, '#FFFFFF'), display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', fontSize: '12px' }}
          >
            <UserPlusIcon size={14} color="#FFFFFF" />
            <span>موظف جديد</span>
          </button>
        )}
      </div>

      {draft && (
        <form
          onSubmit={save}
          style={{
            display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px',
            border: `1px solid ${COLORS.primary}`, borderRadius: '12px',
          }}
        >
          <strong style={{ fontSize: '13px', color: COLORS.ink }}>{draft.id ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد'}</strong>
          <input
            type="text" placeholder="اسم الموظف" value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputStyle}
          />
          <input
            type="text" placeholder="كود الدخول (مثال: W104)" value={draft.code}
            onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
            style={{ ...inputStyle, textTransform: 'uppercase' }}
          />
          <div style={{ fontSize: '12px', fontWeight: 700, color: COLORS.muted }}>
            المدن التي يعمل بها ({draft.centers.length}) — لن يرى غيرها
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {OFFICIAL_CENTERS.map((c) => {
              const on = draft.centers.includes(c);
              return (
                <button
                  key={c} type="button" onClick={() => toggleCenter(c)}
                  style={{
                    padding: '6px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 700,
                    border: `1px solid ${on ? COLORS.primary : COLORS.border}`,
                    backgroundColor: on ? COLORS.primary : COLORS.bg,
                    color: on ? '#FFFFFF' : COLORS.ink,
                  }}
                >
                  {on ? '✓ ' : ''}{c}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="submit" disabled={busy}
              style={{ flex: 1, padding: '10px', backgroundColor: COLORS.green, color: '#FFFFFF', borderRadius: '10px', fontSize: '13px', fontWeight: 800 }}
            >
              {busy ? 'جارٍ الحفظ...' : 'حفظ'}
            </button>
            <button
              type="button" onClick={() => setDraft(null)}
              style={{ padding: '10px 16px', backgroundColor: COLORS.bg, color: COLORS.ink, borderRadius: '10px', fontSize: '13px', fontWeight: 700 }}
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {workers.map((w) => (
          <div
            key={w.id}
            style={{
              display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px',
              backgroundColor: COLORS.bg, borderRadius: '10px', border: `1px solid ${COLORS.border}`,
              opacity: w.active ? 1 : 0.7,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  fontSize: '13px', fontWeight: 700, color: w.active ? COLORS.ink : COLORS.muted,
                  textDecoration: w.active ? 'none' : 'line-through',
                }}
              >
                {w.name}
              </span>
              <span style={{ fontSize: '12px', fontWeight: 800, color: COLORS.primary, backgroundColor: COLORS.surface, padding: '2px 8px', borderRadius: '6px' }}>
                {w.code}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {(w.assigned_centers || []).length === 0 ? (
                <span style={{ fontSize: '11px', color: COLORS.red, fontWeight: 700 }}>⚠ لم تُحدد له مدن — لا يرى أي منشآت</span>
              ) : (
                (w.assigned_centers || []).map((c) => (
                  <span key={c} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', backgroundColor: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}>
                    {c}
                  </span>
                ))
              )}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                onClick={() => setDraft({ id: w.id, name: w.name, code: w.code, centers: w.assigned_centers || [] })}
                style={btn(COLORS.surface, COLORS.primary)}
              >
                تعديل
              </button>
              <button type="button" onClick={() => toggle(w)} style={btn(w.active ? COLORS.amberSoft : COLORS.greenSoft, w.active ? COLORS.amber : COLORS.green)}>
                {w.active ? 'إيقاف' : 'تفعيل'}
              </button>
              <button type="button" onClick={() => remove(w)} style={btn(COLORS.redSoft, COLORS.red)}>
                حذف
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
