import React, { useEffect, useState } from 'react';
import { ACTIVITY_TYPES, OFFICIAL_CENTERS } from '../constants';
import { COLORS } from '../theme';
import type { User } from '../types';
import { api } from '../api';
import { XIcon } from './Icons';
import { Select } from './pickers/Select';
import { DatePicker, toYmd } from './pickers/DatePicker';

interface Props {
  user: User;
  planId: string;
  defaultCenter?: string;
  onClose: () => void;
  onCreated: () => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  minHeight: '40px',
  borderRadius: '10px',
  border: `1px solid ${COLORS.border}`,
  backgroundColor: '#FFFFFF',
  fontSize: '13px',
};

const Field: React.FC<{ label: string; required?: boolean; children: React.ReactNode }> = ({ label, required, children }) => (
  <div style={{ minWidth: 0 }}>
    <label style={{ fontSize: '12px', fontWeight: 700, color: COLORS.ink, display: 'block', marginBottom: '4px' }}>
      {label}
      {required && <span style={{ color: '#DC2626' }}> *</span>}
    </label>
    {children}
  </div>
);

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>{children}</div>
);

/** نموذج إضافة منشأة جديدة — متاح لكل الموظفين، بنفس أعمدة شيتات الإكسيل */
export const AddFacilityModal: React.FC<Props> = ({ user, planId, defaultCenter, onClose, onCreated }) => {
  const isAdmin = user.role === 'admin';
  const centers = isAdmin ? OFFICIAL_CENTERS : OFFICIAL_CENTERS.filter((c) => (user.assigned_centers || []).includes(c));
  const initialCenter =
    (defaultCenter && centers.includes(defaultCenter) && defaultCenter) ||
    (user.home_center && centers.includes(user.home_center) && user.home_center) ||
    centers[0] ||
    '';

  const [serial, setSerial] = useState('');
  const [suggestedSerial, setSuggestedSerial] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [center, setCenter] = useState(initialCenter);
  const [address, setAddress] = useState('');
  const [owner, setOwner] = useState('');
  const [phone, setPhone] = useState('');
  const [activity, setActivity] = useState('أخرى');
  const [lastVisit, setLastVisit] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.nextSerial(user.code, planId).then((r) => setSuggestedSerial(r.next_serial)).catch(() => setSuggestedSerial(null));
  }, [user.code, planId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const serialNo = Number(serial);
    if (!serial.trim() || !Number.isInteger(serialNo) || serialNo < 1) return setError('رقم التسلسل مطلوب (رقم صحيح أكبر من صفر)');
    if (!name.trim()) return setError('اسم المنشأة مطلوب');
    if (!code.trim()) return setError('كود المنشأة مطلوب');
    if (!center) return setError('اختر المدينة');
    setSubmitting(true);
    try {
      const res = await api.createFacility(user.code, planId, {
        serial_no: serialNo,
        name: name.trim(),
        facility_code: code.trim().toUpperCase(),
        center,
        address: address.trim(),
        owner: owner.trim(),
        phone: phone.trim(),
        activity_type: activity,
        last_visit_date: lastVisit,
        plan_notes: notes.trim(),
      });
      alert(`تمت إضافة المنشأة "${res.facility.name}" بنجاح — التسلسل ${res.facility.serial_no}`);
      onCreated();
    } catch (err: any) {
      setError(err.message || 'تعذر الحفظ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          padding: '18px',
          width: '100%',
          maxWidth: '520px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          maxHeight: '92vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 800, color: COLORS.ink, margin: 0 }}>＋ إضافة منشأة جديدة</h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', display: 'flex', cursor: 'pointer', padding: '4px' }}
          >
            <XIcon size={18} color={COLORS.muted} />
          </button>
        </div>

        {centers.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#B45309', backgroundColor: '#FEF3C7', padding: '10px', borderRadius: '8px' }}>
            لا توجد مدن مخصصة لك — اطلب من الأدمن تخصيص مدينة لحسابك أولاً.
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Row>
              <Field label="التسلسل" required>
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                  placeholder={suggestedSerial ? `مثال: ${suggestedSerial}` : ''}
                  required
                  style={inputStyle}
                />
                {suggestedSerial && (
                  <button
                    type="button"
                    onClick={() => setSerial(String(suggestedSerial))}
                    style={{ marginTop: '4px', background: 'none', border: 'none', padding: 0, fontSize: '11px', color: COLORS.primary, fontWeight: 700, cursor: 'pointer' }}
                  >
                    أول رقم متاح: {suggestedSerial}
                  </button>
                )}
              </Field>
              <Field label="الكود" required>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="مثال: SH155"
                  required
                  style={{ ...inputStyle, direction: 'ltr', textAlign: 'right' }}
                />
              </Field>
            </Row>

            <Field label="اسم المنشأة" required>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: مصنع الأمل للألبان"
                required
                style={inputStyle}
              />
            </Field>

            <Row>
              <Field label="المدينة" required>
                <Select value={center} onChange={setCenter} options={centers} title="اختر المدينة" />
              </Field>
              <Field label="النشاط">
                <Select value={activity} onChange={setActivity} options={ACTIVITY_TYPES} title="اختر نوع النشاط" />
              </Field>
            </Row>

            <Field label="عنوان المنشأة">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="مثال: شارع الجيش - بجوار المستشفى العام"
                style={inputStyle}
              />
            </Field>

            <Row>
              <Field label="صاحب المنشأة">
                <input value={owner} onChange={(e) => setOwner(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="وسيلة الاتصال">
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                  placeholder="01xxxxxxxxx"
                  style={{ ...inputStyle, direction: 'ltr', textAlign: 'right' }}
                />
              </Field>
            </Row>

            <Field label="تاريخ آخر مرور (إن وجد)">
              <DatePicker value={lastVisit} onChange={setLastVisit} max={toYmd(new Date())} title="تاريخ آخر مرور" placeholder="لم تتم زيارتها من قبل" />
            </Field>

            <Field label="ملاحظات">
              <input value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} />
            </Field>

            {error && (
              <div style={{ fontSize: '12px', color: '#DC2626', backgroundColor: '#FEE2E2', padding: '8px 10px', borderRadius: '8px' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  flex: 1,
                  padding: '11px',
                  backgroundColor: COLORS.primary,
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 800,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? 'جارٍ الحفظ...' : 'حفظ المنشأة'}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={onClose}
                style={{
                  padding: '11px 16px',
                  backgroundColor: '#E2E8F0',
                  color: '#334155',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                إلغاء
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
