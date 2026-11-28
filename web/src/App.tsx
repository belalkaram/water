import { useCallback, useEffect, useState } from 'react';
import type { ActivityItem, Facility, MonthlyPlan, User } from './types';
import { api, apiBaseForWorker, getSessionToken, hasSession, isNetworkError, onSessionExpired, setSessionToken } from './api';
import {
  cacheFacilities, cacheFeed, cachePlans, cachedFacilities, cachedFeed, cachedPlans, flushQueue, overlayPending,
  refreshPending, saveAuthForWorker, subscribeSync, type SyncState,
} from './offline/sync';
import { SyncBar } from './components/SyncBar';
import { TopBar } from './components/TopBar';
import { BottomNav, type TabType } from './components/BottomNav';
import { BottomSheet } from './components/BottomSheet';
import { FacilityDetail } from './components/FacilityDetail';
import { InspectionForm } from './components/InspectionForm';
import { LoginScreen } from './screens/LoginScreen';
import { PlanScreen } from './screens/PlanScreen';
import { FeedScreen } from './screens/FeedScreen';
import { AdminScreen } from './screens/AdminScreen';
import { removeCookie } from './utils/cookies';

const USER_COOKIE_KEY = 'menoufia_user';
const USER_STORAGE_KEY = 'menoufia_user';

export default function App() {
  const [user, setUser] = useState<User | null>(() => {
    try {
      // The user stays signed in only while the server-issued session is valid
      removeCookie(USER_COOKIE_KEY); // legacy long-lived cookie from older versions
      const saved = localStorage.getItem(USER_STORAGE_KEY);
      if (saved && hasSession()) return JSON.parse(saved);
      localStorage.removeItem(USER_STORAGE_KEY);
      return null;
    } catch {
      return null;
    }
  });
  const [sessionNotice, setSessionNotice] = useState('');

  const [tab, setTab] = useState<TabType>('plan');
  const [plans, setPlans] = useState<MonthlyPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [feed, setFeed] = useState<ActivityItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [activeFacility, setActiveFacility] = useState<Facility | null>(null);
  const [inspectingFacility, setInspectingFacility] = useState<Facility | null>(null);
  const [sync, setSync] = useState<SyncState>({ pending: 0, uploading: false, notices: [] });
  const [toast, setToast] = useState('');
  const [usingSaved, setUsingSaved] = useState(false);

  useEffect(() => subscribeSync(setSync), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Handle PWA BeforeInstallPrompt
  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallPwa = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  // Online / offline listeners
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const clearSignedInState = () => {
    setUser(null);
    setActiveFacility(null);
    setInspectingFacility(null);
    try {
      localStorage.removeItem(USER_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const handleLogin = (u: User, token: string) => {
    setSessionToken(token, u.id);
    setSessionNotice('');
    setUser(u);
    try {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(u));
    } catch {
      // ignore
    }
  };

  const handleLogout = async () => {
    if (user && sync.pending > 0) {
      // try to upload first; whatever is left stays on the phone for the next login with the same code
      if (navigator.onLine) await flushQueue(user, (ops) => api.syncBatch(user.code, ops));
      const left = (await refreshPending(user.id)).filter((q) => q.user_id === user.id).length;
      if (
        left > 0 &&
        !window.confirm(
          `فيه ${left} معاينة محفوظة على التليفون لسه ما اترفعتش.\n` +
            'لو خرجت هتفضل محفوظة، وهتترفع لما تدخل تاني بنفس الكود وفيه نت.\nتخرج دلوقتي؟'
        )
      )
        return;
    }
    api.logout();
    setSessionToken(null);
    clearSignedInState();
  };

  // Server ended the session → back to login (inspection drafts stay saved on the device)
  useEffect(() => {
    onSessionExpired(() => {
      clearSignedInState();
      setSessionNotice('انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى');
    });
    return () => onSessionExpired(null);
  }, []);

  const refreshAll = useCallback(
    async (currentUser: User, planIdOverride?: string) => {
      setRefreshing(true);
      // upload what was saved offline first — even with a session that ran out meanwhile (server allows it for uploads)
      if (navigator.onLine) await flushQueue(currentUser, (ops) => api.syncBatch(currentUser.code, ops));
      try {
        const loadedPlans = (await api.getPlans(currentUser.code)).plans || [];
        setPlans(loadedPlans);
        setUsingSaved(false);
        cachePlans(currentUser.id, loadedPlans);
        const ym = new Date().toISOString().slice(0, 7);
        // keep the chosen plan only if it still exists (an admin may have deleted it)
        const exists = (id?: string) => !!id && loadedPlans.some((p) => p.id === id);
        const targetPlanId =
          [planIdOverride, selectedPlanId].find(exists) ||
          loadedPlans.find((p) => p.plan_month === ym)?.id ||
          loadedPlans[0]?.id ||
          '';
        setSelectedPlanId(targetPlanId);

        if (!targetPlanId) {
          setFacilities([]);
          setFeed([]);
        }
        if (targetPlanId) {
          const [facRes, feedRes] = await Promise.all([
            api.getFacilities(currentUser.code, targetPlanId),
            api.getFeed(currentUser.code, targetPlanId),
          ]);
          cacheFacilities(currentUser.id, targetPlanId, facRes.facilities || []);
          cacheFeed(currentUser.id, targetPlanId, feedRes.feed || []);
          setFacilities(await overlayPending(currentUser.id, targetPlanId, facRes.facilities || []));
          setFeed(feedRes.feed || []);
        }
      } catch (err: any) {
        if (isNetworkError(err)) {
          // offline: keep working from what was saved on this phone the last time there was internet
          const savedPlans = (await cachedPlans(currentUser.id)) || [];
          if (savedPlans.length) {
            setUsingSaved(true);
            setPlans(savedPlans);
            const ym = new Date().toISOString().slice(0, 7);
            const exists = (id?: string) => !!id && savedPlans.some((p) => p.id === id);
            const pid =
              [planIdOverride, selectedPlanId].find(exists) || savedPlans.find((p) => p.plan_month === ym)?.id || savedPlans[0]?.id || '';
            setSelectedPlanId(pid);
            setFacilities(pid ? await overlayPending(currentUser.id, pid, (await cachedFacilities(currentUser.id, pid)) || []) : []);
            setFeed(pid ? (await cachedFeed(currentUser.id, pid)) || [] : []);
          }
        } else {
          console.error('Refresh error:', err);
        }
      } finally {
        refreshPending(currentUser.id);
        setLoadedOnce(true);
        setRefreshing(false);
      }
    },
    [selectedPlanId]
  );

  const selectPlan = (id: string) => {
    if (!user) return;
    setSelectedPlanId(id);
    setFacilities([]);
    setFeed([]);
    refreshAll(user, id);
  };

  useEffect(() => {
    if (user) {
      saveAuthForWorker(getSessionToken(), apiBaseForWorker(), user.id);
      refreshAll(user);
    }
  }, [user]);

  // Internet came back / the site came to the front / every 30 s: upload what was saved offline
  useEffect(() => {
    if (!user) return;
    const tryUpload = async () => {
      if (!navigator.onLine) return;
      const n = await flushQueue(user, (ops) => api.syncBatch(user.code, ops));
      if (n > 0) {
        setToast(`تم رفع ${n} معاينة كانت محفوظة على التليفون`);
        refreshAll(user, selectedPlanId);
      }
    };
    const onOnline = () => {
      tryUpload().then(() => refreshAll(user, selectedPlanId));
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') tryUpload();
    };
    const onWorkerMsg = (e: MessageEvent) => {
      if (e.data?.type === 'sync-done') {
        refreshPending(user.id);
        if (e.data.uploaded > 0) refreshAll(user, selectedPlanId);
      }
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    navigator.serviceWorker?.addEventListener('message', onWorkerMsg);
    const timer = setInterval(tryUpload, 30000);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('message', onWorkerMsg);
      clearInterval(timer);
    };
  }, [user, selectedPlanId, refreshAll]);

  // Handle actions
  const handleReserve = async (f: Facility) => {
    if (!user) return;
    try {
      const res = await api.reserveFacility(user.code, f.id);
      setFacilities((prev) => prev.map((item) => (item.id === res.facility.id ? res.facility : item)));
      setActiveFacility(res.facility);
      refreshAll(user, selectedPlanId);
    } catch (err: any) {
      alert('تعذر الحجز: ' + err.message);
    }
  };

  const handleRelease = async (f: Facility) => {
    if (!user) return;
    try {
      const res = await api.releaseFacility(user.code, f.id);
      setFacilities((prev) => prev.map((item) => (item.id === res.facility.id ? res.facility : item)));
      setActiveFacility(res.facility);
      refreshAll(user, selectedPlanId);
    } catch (err: any) {
      alert('تعذر إلغاء الحجز: ' + err.message);
    }
  };

  const handleUnlock = async (f: Facility) => {
    if (!user) return;
    try {
      const res = await api.unlockFacility(user.code, f.id);
      setFacilities((prev) => prev.map((item) => (item.id === res.facility.id ? res.facility : item)));
      setActiveFacility(null);
      refreshAll(user, selectedPlanId);
    } catch (err: any) {
      alert('تعذر فتح المكان: ' + err.message);
    }
  };

  const handleOpenFacilityById = async (facilityId: string) => {
    if (!user) return;
    const existing = facilities.find((f) => f.id === facilityId);
    if (existing && existing.inspection) {
      setActiveFacility(existing);
      return;
    }
    try {
      const { facility } = await api.getFacility(user.code, facilityId);
      setActiveFacility(facility);
    } catch (err: any) {
      if (existing) {
        setActiveFacility(existing);
      } else {
        alert('تعذر تحميل تفاصيل المنشأة: ' + (err.message || 'غير موجودة'));
      }
    }
  };

  if (!user) {
    return <LoginScreen onLogin={handleLogin} notice={sessionNotice} />;
  }

  return (
    <div
      className="app-shell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        position: 'relative',
      }}
    >
      {/* Top Mobile Bar */}
      <TopBar
        user={user}
        onLogout={handleLogout}
        deferredPrompt={deferredPrompt}
        onInstall={handleInstallPwa}
      />

      {/* Offline + pending-upload strip */}
      <SyncBar
        online={isOnline}
        usingSaved={usingSaved}
        sync={sync}
        onUploadNow={() =>
          flushQueue(user, (ops) => api.syncBatch(user.code, ops)).then((n) => {
            if (n > 0) setToast(`تم رفع ${n} معاينة`);
            refreshAll(user, selectedPlanId);
          })
        }
      />

      <div className="app-body">
      <main className="app-main">
      {/* Main Screens */}
      {tab === 'plan' && (
        <PlanScreen
          user={user}
          plans={plans}
          selectedPlanId={selectedPlanId}
          onSelectPlan={selectPlan}
          facilities={facilities}
          onSelectFacility={(f) => setActiveFacility(f)}
          onRefresh={() => refreshAll(user, selectedPlanId)}
          refreshing={refreshing}
          loading={!loadedOnce || (refreshing && facilities.length === 0)}
        />
      )}

      {tab === 'feed' && (
        <FeedScreen
          feed={feed}
          onRefresh={() => refreshAll(user, selectedPlanId)}
          refreshing={refreshing}
          loading={!loadedOnce || (refreshing && feed.length === 0)}
          onSelectFacilityId={handleOpenFacilityById}
          userId={user.id}
          isAdmin={user.role === 'admin'}
          plans={plans}
          selectedPlanId={selectedPlanId}
          onSelectPlan={selectPlan}
        />
      )}

      {tab === 'admin' && user.role === 'admin' && (
        <AdminScreen
          user={user}
          facilities={facilities}
          planId={selectedPlanId}
          onRefresh={() => refreshAll(user, selectedPlanId)}
          plans={plans}
          onSelectPlan={selectPlan}
        />
      )}

      </main>

      {/* Navigation: bottom bar on mobile, side rail on desktop */}
      <BottomNav
        currentTab={tab}
        onChangeTab={setTab}
        userRole={user.role}
      />
      </div>

      {/* Bottom Sheet Modal for Facility Detail */}
      <BottomSheet isOpen={Boolean(activeFacility)} onClose={() => setActiveFacility(null)}>
        {activeFacility && (
          <FacilityDetail
            facility={activeFacility}
            user={user}
            onReserve={handleReserve}
            onRelease={handleRelease}
            onStartInspection={(f) => {
              setActiveFacility(null);
              setInspectingFacility(f);
            }}
            onUnlock={handleUnlock}
            onClose={() => setActiveFacility(null)}
            onFacilityUpdated={(updated) => {
              setFacilities((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
              setActiveFacility(updated);
              refreshAll(user, selectedPlanId);
            }}
            onFacilityDeleted={(deletedId) => {
              setFacilities((prev) => prev.filter((f) => f.id !== deletedId));
              setActiveFacility(null);
              refreshAll(user, selectedPlanId);
            }}
          />
        )}
      </BottomSheet>

      {/* Full Screen Inspection Form */}
      {inspectingFacility && (
        <InspectionForm
          user={user}
          facility={inspectingFacility}
          onDone={(updated, savedOffline) => {
            setFacilities((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
            setInspectingFacility(null);
            if (savedOffline) {
              setToast('مفيش نت — المعاينة اتحفظت على التليفون وهتترفع لوحدها أول ما النت يرجع');
              refreshPending(user.id);
            } else {
              refreshAll(user, selectedPlanId);
            }
          }}
          onCancel={() => setInspectingFacility(null)}
        />
      )}
      {toast && (
        <div className="app-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
