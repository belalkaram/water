// Every page has its own address, so a refresh, the browser's back button or a shared link
// lands on the same page:
//   /login
//   /plan                      /feed                      /admin
//   /plan/establishments       /admin/establishments      (عرض المنشآت)
//   /plan/facility/<id>        /feed/facility/<id>        /admin/facility/<id>   (تفاصيل منشأة)
//   /plan/facility/<id>/inspect                                                   (فورم المعاينة)
import { useEffect, useState } from 'react';
import type { TabType } from './components/BottomNav';

export interface Route {
  tab: TabType;
  /** sub-page inside the tab */
  view: 'home' | 'establishments' | 'facility' | 'inspect';
  facilityId?: string;
  login: boolean;
}

const TABS: TabType[] = ['plan', 'feed', 'admin'];

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'login') return { tab: 'plan', view: 'home', login: true };
  const tab = (TABS.includes(parts[0] as TabType) ? parts[0] : 'plan') as TabType;
  if (parts[1] === 'establishments') return { tab, view: 'establishments', login: false };
  if (parts[1] === 'facility' && parts[2]) {
    return { tab, view: parts[3] === 'inspect' ? 'inspect' : 'facility', facilityId: parts[2], login: false };
  }
  return { tab, view: 'home', login: false };
}

export function routePath(r: Partial<Route> & { tab?: TabType }): string {
  if (r.login) return '/login';
  const tab = r.tab || 'plan';
  if (r.view === 'establishments') return `/${tab}/establishments`;
  if ((r.view === 'facility' || r.view === 'inspect') && r.facilityId) {
    return `/${tab}/facility/${encodeURIComponent(r.facilityId)}${r.view === 'inspect' ? '/inspect' : ''}`;
  }
  return `/${tab}`;
}

const EVENT = 'app:navigate';

export function navigate(path: string, { replace = false } = {}) {
  const current = window.location.pathname + window.location.search;
  if (path === current) return;
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(EVENT));
}

/** Current route; updates on navigate() and on the browser's back/forward buttons. */
export function useRoute(): Route {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener('popstate', on);
    window.addEventListener(EVENT, on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener(EVENT, on);
    };
  }, []);
  return parseRoute(path);
}
