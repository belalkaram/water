// Offline work: cached plan data + a queue of inspections saved without internet.
// The queue is uploaded automatically as soon as there is internet:
//  - while the site is open (this file: on the `online` event, on start, and every 30 s), and
//  - on Android, also with the site closed, through the service worker's Background Sync (public/sw.js).
// iPhone has no Background Sync: the upload happens the next time the site is opened.
import type { ActivityItem, Facility, MonthlyPlan, User } from '../types';
import { kvDelete, kvGet, kvSet, queueAll, queueDelete, queuePut, type QueuedInspection } from './store';

export const SYNC_TAG = 'upload-inspections';

export interface SyncNotice {
  id: string;
  facility_name: string;
  status: 'cancelled' | 'rejected' | 'conflict' | 'skipped';
  reason: string;
  at: string;
}

export interface SyncState {
  pending: number;
  uploading: boolean;
  notices: SyncNotice[];
  lastResult?: { uploaded: number; at: string };
}

let state: SyncState = { pending: 0, uploading: false, notices: [] };
const listeners = new Set<(s: SyncState) => void>();

function emit(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export function subscribeSync(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ─── cache of what the worker needs to keep working offline ────────────────────
const k = (userId: string, what: string) => `cache:${userId}:${what}`;

export const cachePlans = (userId: string, plans: MonthlyPlan[]) => kvSet(k(userId, 'plans'), plans);
export const cachedPlans = (userId: string) => kvGet<MonthlyPlan[]>(k(userId, 'plans'));
export const cacheFacilities = (userId: string, planId: string, rows: Facility[]) => kvSet(k(userId, `facilities:${planId}`), rows);
export const cachedFacilities = (userId: string, planId: string) => kvGet<Facility[]>(k(userId, `facilities:${planId}`));
export const cacheFeed = (userId: string, planId: string, rows: ActivityItem[]) => kvSet(k(userId, `feed:${planId}`), rows);
export const cachedFeed = (userId: string, planId: string) => kvGet<ActivityItem[]>(k(userId, `feed:${planId}`));

/** What the service worker needs to upload on its own (same token the site uses). */
export function saveAuthForWorker(token: string | null, apiBase: string, userId?: string) {
  if (!token) return kvDelete('auth');
  return kvSet('auth', { token, apiBase, userId: userId || '' });
}

// ─── queue ─────────────────────────────────────────────────────────────────────
function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function refreshPending(userId?: string) {
  const all = await queueAll().catch(() => [] as QueuedInspection[]);
  const notices = ((await kvGet<SyncNotice[]>('notices')) || []).slice(-30);
  emit({ pending: userId ? all.filter((q) => q.user_id === userId).length : all.length, notices });
  return all;
}

/** Facilities of a plan with the inspections still waiting on this phone shown as done (pending upload). */
export async function overlayPending(userId: string, planId: string, rows: Facility[]): Promise<Facility[]> {
  const mine = (await queueAll().catch(() => [] as QueuedInspection[])).filter((q) => q.user_id === userId && q.plan_id === planId);
  if (!mine.length) return rows;
  const byId = new Map(mine.map((q) => [q.facility_id, q]));
  return rows.map((f) => {
    const q = byId.get(f.id);
    if (!q || f.status === 'completed') return f;
    return {
      ...f,
      status: 'completed',
      visit_outcome: (q.payload.visit_outcome as Facility['visit_outcome']) || 'inspected',
      completed_at: q.created_at,
      pending_sync: true,
    };
  });
}

export async function enqueueInspection(user: User, facility: Facility, payload: Record<string, unknown>): Promise<Facility> {
  const queue_id = uuid();
  const created_at = new Date().toISOString();
  await queuePut({
    queue_id,
    user_id: user.id,
    facility_id: facility.id,
    facility_name: facility.name,
    plan_id: facility.plan_id,
    created_at,
    payload: { ...payload, client_id: queue_id },
  });
  await refreshPending(user.id);
  // Android: let the browser upload even if the site gets closed before the internet comes back
  try {
    const reg = await navigator.serviceWorker?.ready;
    await (reg as any)?.sync?.register(SYNC_TAG);
  } catch {
    // no Background Sync (iPhone, Firefox) — the site uploads when it is opened again
  }
  return {
    ...facility,
    status: 'completed',
    completed_by_id: user.id,
    completed_by_name: user.name,
    completed_at: created_at,
    visit_outcome: (payload.visit_outcome as Facility['visit_outcome']) || 'inspected',
    pending_sync: true,
  };
}

type BatchResult = { queue_id: string; facility_name?: string; status: string; reason?: string };

let flushing: Promise<number> | null = null;

/**
 * Upload this user's queued inspections. Returns how many were stored on the server.
 * Never throws: with no internet (or a rejected session) the queue simply stays for the next try.
 */
export function flushQueue(
  user: User | null,
  send: (operations: unknown[]) => Promise<{ results: BatchResult[] }>
): Promise<number> {
  if (!user) return Promise.resolve(0);
  if (flushing) return flushing;
  flushing = (async () => {
    let uploaded = 0;
    try {
      const mine = (await queueAll()).filter((q) => q.user_id === user.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
      if (!mine.length || !navigator.onLine) return 0;
      emit({ uploading: true });
      const notices = (await kvGet<SyncNotice[]>('notices')) || [];
      // small batches: each one carries signatures (base64 images)
      for (let i = 0; i < mine.length; i += 5) {
        const chunk = mine.slice(i, i + 5);
        const { results } = await send(
          chunk.map((q) => ({ queue_id: q.queue_id, action: 'complete', facility_id: q.facility_id, created_at: q.created_at, payload: q.payload }))
        );
        const done: string[] = [];
        for (const r of results || []) {
          done.push(r.queue_id);
          if (r.status === 'applied') uploaded += 1;
          else {
            const q = chunk.find((c) => c.queue_id === r.queue_id);
            notices.push({
              id: r.queue_id,
              facility_name: r.facility_name || q?.facility_name || '',
              status: (r.status as SyncNotice['status']) || 'skipped',
              reason: r.reason || '',
              at: new Date().toISOString(),
            });
          }
        }
        await queueDelete(done);
      }
      await kvSet('notices', notices.slice(-30));
      if (uploaded) emit({ lastResult: { uploaded, at: new Date().toISOString() } });
    } catch {
      // offline again / server error / session rejected → keep the queue
    } finally {
      emit({ uploading: false });
      await refreshPending(user.id);
      flushing = null;
    }
    return uploaded;
  })();
  return flushing;
}

export async function dismissNotices() {
  await kvSet('notices', []);
  emit({ notices: [] });
}
