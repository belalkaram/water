import React, { useEffect, useState } from 'react';
import { COLORS } from '../theme';
import type { User } from '../types';
import { api } from '../api';
import { clearAllCookies, removeCookie } from '../utils/cookies';
import { queueAll } from '../offline/store';
import { Trash2Icon } from '../components/Icons';

const LEGACY_REMEMBER_KEY = 'menoufia_remembered_code';

interface Props {
  onLogin: (user: User, token: string) => void;
  /** رسالة تظهر فوق النموذج (مثلاً عند انتهاء الجلسة) */
  notice?: string;
}

export const LoginScreen: React.FC<Props> = ({ onLogin, notice }) => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // remove the old saved "remember me" code from earlier versions
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_REMEMBER_KEY);
      removeCookie(LEGACY_REMEMBER_KEY);
    } catch {
      // ignore
    }
  }, []);

  const handleClearCookies = async () => {
    const waiting = (await queueAll().catch(() => [])).length;
    const extra = waiting
      ? `\n\nملحوظة: فيه ${waiting} معاينة محفوظة على التليفون لسه ما اترفعتش — دي مش هتتمسح، وهتترفع لما تدخل بنفس الكود وفيه نت.`
      : '';
    if (window.confirm('هل تريد مسح جميع ملفات تعريف الارتباط (الكوكيز) وبيانات الدخول المحفوظة؟' + extra)) {
      clearAllCookies();
      setCode('');
      setError('');
      alert('تم مسح جميع الكوكيز والبيانات المحفوظة بنجاح');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('أدخل كود الموظف أو الأدمن');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const cleanCode = code.trim().toUpperCase();
      const res = await api.login(cleanCode);

      onLogin(res.user, res.token);
    } catch (err: any) {
      setError(err.message || 'الكود غير مسجل أو تعذر الاتصال بالسيرفر');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '20px',
        backgroundColor: COLORS.bg,
      }}
    >
      <div
        className="login-card"
        style={{
          width: '100%',
          maxWidth: '440px',
          margin: '0 auto',
          backgroundColor: COLORS.surface,
          borderRadius: '24px',
          padding: '28px 20px',
          border: `1px solid ${COLORS.border}`,
          boxShadow: '0 8px 30px rgba(0,0,0,0.06)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <img
          src="/logo.jpg"
          alt="شعار الشركة"
          style={{
            width: '100px',
            height: '100px',
            borderRadius: '50px',
            objectFit: 'cover',
            border: `2px solid ${COLORS.border}`,
            marginBottom: '16px',
          }}
        />

        <h1 style={{ fontSize: '22px', fontWeight: '800', color: COLORS.ink, textAlign: 'center' }}>
          الإدارة العامة للصرف الصناعي
        </h1>
        <p style={{ fontSize: '13px', color: COLORS.muted, textAlign: 'center', marginTop: '4px', marginBottom: '24px' }}>
          شركة مياه الشرب والصرف الصحي بالمنوفية
        </p>

        {notice && !error && (
          <div
            style={{
              width: '100%',
              padding: '10px 14px',
              backgroundColor: COLORS.amberSoft,
              color: COLORS.amber,
              borderRadius: '10px',
              fontSize: '13px',
              fontWeight: '700',
              textAlign: 'center',
              marginBottom: '16px',
            }}
          >
            {notice}
          </div>
        )}

        {error && (
          <div
            style={{
              width: '100%',
              padding: '10px 14px',
              backgroundColor: COLORS.redSoft,
              color: COLORS.red,
              borderRadius: '10px',
              fontSize: '13px',
              fontWeight: '700',
              textAlign: 'center',
              marginBottom: '16px',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ width: '100%' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: COLORS.ink, marginBottom: '6px', textAlign: 'right' }}>
            كود الدخول
          </label>
          <input
            type="text"
            placeholder="مثال:  W101"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: '12px',
              border: `1.5px solid ${COLORS.border}`,
              backgroundColor: COLORS.bg,
              textAlign: 'center',
              fontSize: '18px',
              fontWeight: '800',
              color: COLORS.ink,
              letterSpacing: '1px',
              marginBottom: '12px',
            }}
          />

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px',
              backgroundColor: COLORS.primary,
              color: '#FFFFFF',
              borderRadius: '12px',
              fontSize: '16px',
              fontWeight: '800',
              opacity: loading ? 0.7 : 1,
              boxShadow: '0 3px 8px rgba(0, 107, 159, 0.3)',
            }}
          >
            {loading ? 'جارٍ تسجيل الدخول...' : 'دخول'}
          </button>
        </form>

        <button
          type="button"
          onClick={handleClearCookies}
          style={{
            marginTop: '20px',
            color: COLORS.muted,
            fontSize: '12px',
            fontWeight: '600',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            backgroundColor: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '6px 10px',
            borderRadius: '6px',
          }}
        >
          <Trash2Icon size={14} color={COLORS.muted} />
          <span>مسح ملفات تعريف الارتباط (الكوكيز) وسجل البيانات</span>
        </button>
      </div>
    </div>
  );
};
