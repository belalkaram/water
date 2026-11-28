import type { ActivityItem, Establishment, ConflictItem, Facility, MonthlyPlan, NewFacilityInput, PlanReport, PlanStats, User } from './types';

// Trailing slashes are stripped: «https://host/» + «/api/...» would give «//api», which Vercel
// answers with a redirect — and browsers refuse redirects on CORS preflight requests.
const DEFAULT_API_URL = (
  (import.meta.env.VITE_API_URL as string | undefined)?.trim() || (import.meta.env.PROD ? '' : 'http://localhost:4000')
).replace(/\/+$/, '');
// The server address is fixed by the build (VITE_API_URL); it can no longer be changed from the app.
try {
  localStorage.removeItem('menoufia_server_url'); // address saved by older versions
} catch {
  // ignore
}

export function getServerUrl(): string {
  return DEFAULT_API_URL;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// ─── Session (token issued by the server at login; its lifetime is decided by the server) ───
const SESSION_KEY = 'menoufia_session';
let sessionToken: string | null = (() => {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
})();
let onSessionEnded: (() => void) | null = null;

export function setSessionToken(token: string | null): void {
  sessionToken = token;
  try {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore storage errors
  }
}
export const hasSession = () => !!sessionToken;
/** App registers this to go back to the login screen when the server rejects the session */
export function onSessionExpired(handler: (() => void) | null): void {
  onSessionEnded = handler;
}
function sessionRejected(status: number) {
  if (status === 401 && sessionToken) {
    setSessionToken(null);
    onSessionEnded?.();
  }
}

// The second-to-last `_userCode` argument is kept for call-site compatibility; auth uses the session token.
async function request(path: string, options: RequestInit = {}, _userCode?: string) {
  const baseUrl = getServerUrl();
  const url = baseUrl ? `${baseUrl}${path}` : path;
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    sessionRejected(res.status);
    throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
  }
  return data;
}

export const api = {
  logout: () => request('/api/auth/logout', { method: 'POST' }).catch(() => undefined),

  login: (code: string): Promise<{ user: User; token: string }> =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ code }) }),

  getPlans: (code: string): Promise<{ plans: MonthlyPlan[] }> =>
    request('/api/plans', { method: 'GET' }, code),

  uploadPlanExcel: (
    code: string,
    monthLabel: string,
    file: File,
    onUploadProgress?: (percent: number) => void
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const baseUrl = getServerUrl();
      const uploadUrl = baseUrl ? `${baseUrl}/api/plans/upload` : '/api/plans/upload';
      xhr.open('POST', uploadUrl);
      if (sessionToken) xhr.setRequestHeader('Authorization', `Bearer ${sessionToken}`);

      if (xhr.upload && onUploadProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            onUploadProgress(pct);
          }
        };
      }

      xhr.onload = () => {
        let data: any = {};
        try {
          data = JSON.parse(xhr.responseText || '{}');
        } catch {
          data = { error: xhr.statusText || 'حدث خطأ في الخادم' };
        }
        sessionRejected(xhr.status);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          reject(new ApiError(data.error || `خطأ ${xhr.status}: ${xhr.statusText}`, xhr.status));
        }
      };

      xhr.onerror = () => {
        reject(new ApiError('فشل الاتصال بالسيرفر. تأكد من تشغيل السيرفر وعنوان الشبكة.', 0));
      };

      xhr.ontimeout = () => {
        reject(new ApiError('انتهت مهلة الانتظار أثناء معالجة المستند. يرجى التأكد من وضوح الصفحات أو المحاولة مجدداً.', 408));
      };

      xhr.timeout = 240000; // 4 minutes timeout for multi-page OCR

      const form = new FormData();
      form.append('month_label', monthLabel);
      form.append('file', file, file.name);
      xhr.send(form);
    });
  },

  getFacilities: (code: string, planId: string): Promise<{ facilities: Facility[] }> =>
    request(`/api/plans/${planId}/facilities`, { method: 'GET' }, code),

  getFacility: (code: string, facilityId: string): Promise<{ facility: Facility }> =>
    request(`/api/facilities/${facilityId}`, { method: 'GET' }, code),

  /** Admin: delete a whole plan (facilities, inspections, activity) */
  deletePlan: (planId: string): Promise<{ deleted: { plan: string; facilities: number; inspections: number } }> =>
    request(`/api/plans/${planId}`, { method: 'DELETE' }),

  /** Admin: delete one activity entry */
  deleteFeedItem: (id: string) => request(`/api/feed/${id}`, { method: 'DELETE' }),

  /** Admin: delete all activity of a plan, or of every plan with planId = 'all' */
  clearFeed: (planId: string | 'all'): Promise<{ deleted: number }> =>
    request(`/api/plans/${planId}/feed`, { method: 'DELETE' }),

  getFeed: (code: string, planId: string): Promise<{ feed: ActivityItem[] }> =>
    request(`/api/plans/${planId}/feed`, { method: 'GET' }, code),

  reserveFacility: (code: string, facilityId: string) =>
    request(`/api/facilities/${facilityId}/reserve`, { method: 'POST' }, code),

  completeFacility: (code: string, facilityId: string, payload: Record<string, unknown>) =>
    request(`/api/facilities/${facilityId}/complete`, { method: 'POST', body: JSON.stringify(payload) }, code),

  releaseFacility: (code: string, facilityId: string) =>
    request(`/api/facilities/${facilityId}/release`, { method: 'POST' }, code),

  getStats: (code: string, planId: string): Promise<PlanStats> =>
    request(`/api/plans/${planId}/stats`, { method: 'GET' }, code),

  getConflicts: (code: string): Promise<{ conflicts: ConflictItem[] }> =>
    request('/api/conflicts', { method: 'GET' }, code),

  resolveConflict: (code: string, id: string, decision: 'discard' | 'replace') =>
    request(`/api/conflicts/${id}/resolve`, { method: 'POST', body: JSON.stringify({ decision }) }, code),

  /** Styled Excel of the plan (admin: all cities, worker: own cities only) */
  exportUrl: (code: string, planId: string, center?: string) => {
    const base = getServerUrl();
    const path = `/api/plans/${planId}/export.xlsx?token=${encodeURIComponent(sessionToken || '')}${center ? `&center=${encodeURIComponent(center)}` : ''}`;
    return base ? `${base}${path}` : path;
  },

  /** Report rows used to build the PDF */
  getReport: (code: string, planId: string, center?: string): Promise<PlanReport> =>
    request(`/api/plans/${planId}/report${center ? `?center=${encodeURIComponent(center)}` : ''}`, { method: 'GET' }, code),

  carryOver: (code: string, month?: string): Promise<{ month: string; carried: number; from: string | null }> =>
    request('/api/plans/carry-over', { method: 'POST', body: JSON.stringify(month ? { month } : {}) }, code),

  rejectFacility: (code: string, facilityId: string, reason: string) =>
    request(`/api/facilities/${facilityId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }, code),

  unlockFacility: (code: string, facilityId: string) =>
    request(`/api/facilities/${facilityId}/unlock`, { method: 'POST' }, code),

  resetFacility: (code: string, facilityId: string, mode: 'keep_history' | 'wipe' = 'keep_history') =>
    request(`/api/facilities/${facilityId}/reset`, { method: 'POST', body: JSON.stringify({ mode }) }, code),

  bulkResetPlan: (
    code: string,
    planId: string,
    target: 'completed' | 'reserved' | 'all' = 'completed',
    mode: 'keep_history' | 'wipe' = 'keep_history'
  ) =>
    request(`/api/plans/${planId}/bulk-reset`, { method: 'POST', body: JSON.stringify({ target, mode }) }, code),

  /** View-only list of the permanent establishments registry */
  getEstablishments: (code: string): Promise<{ establishments: Establishment[] }> =>
    request('/api/establishments', { method: 'GET' }, code),

  nextSerial: (code: string, planId: string): Promise<{ next_serial: number }> =>
    request(`/api/plans/${planId}/next-serial`, { method: 'GET' }, code),

  createFacility: (code: string, planId: string, data: NewFacilityInput): Promise<{ facility: Facility }> =>
    request(`/api/plans/${planId}/facilities`, { method: 'POST', body: JSON.stringify(data) }, code),

  updateFacility: (code: string, facilityId: string, data: Partial<Facility>) =>
    request(`/api/facilities/${facilityId}`, { method: 'PUT', body: JSON.stringify(data) }, code),

  deleteFacility: (code: string, facilityId: string) =>
    request(`/api/facilities/${facilityId}`, { method: 'DELETE' }, code),

  getWorkers: (code: string): Promise<{ workers: User[] }> =>
    request('/api/workers', { method: 'GET' }, code),

  createWorker: (code: string, w: { name: string; code: string; assigned_centers: string[] }) =>
    request('/api/workers', { method: 'POST', body: JSON.stringify(w) }, code),

  updateWorker: (code: string, id: string, w: { name: string; code: string; assigned_centers: string[] }) =>
    request(`/api/workers/${id}`, { method: 'PUT', body: JSON.stringify(w) }, code),

  deleteWorker: (code: string, id: string) =>
    request(`/api/workers/${id}`, { method: 'DELETE' }, code),

  previewMonthlyPlan: (code: string, month: string) =>
    request(`/api/plans/monthly/preview?month=${encodeURIComponent(month)}`, { method: 'GET' }, code),

  generateMonthlyPlan: (code: string, month: string) =>
    request('/api/plans/generate-monthly', { method: 'POST', body: JSON.stringify({ month }) }, code),

  toggleWorker: (code: string, workerId: string) =>
    request(`/api/workers/${workerId}/toggle`, { method: 'PATCH' }, code),

  syncBatch: (code: string, operations: unknown[]) =>
    request('/api/sync/batch', { method: 'POST', body: JSON.stringify({ operations }) }, code),
};
