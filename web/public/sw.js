const CACHE_NAME = 'menoufia-v7';
const STATIC_ASSETS = ['/', '/manifest.json', '/logo.jpg', '/favicon-32.png', '/icon-192.png'];

// Background upload of inspections saved offline (Android/Chrome Background Sync).
// The site registers this tag when it saves an inspection without internet; the browser fires it
// once the phone is online again — even if the site is closed. Same IndexedDB layout as src/offline/store.ts.
const SYNC_TAG = 'upload-inspections';
const DB_NAME = 'menoufia-offline';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // API calls go straight to the network. With no internet the request fails, and the site
  // falls back to the plan saved on the phone (it must not get a fake "empty" answer).
  if (url.pathname.startsWith('/api/')) return;

  // Hashed build assets never change → cache first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
            return res;
          })
      )
    );
    return;
  }

  // Page / everything else: network first so a new deploy shows up immediately; cache only as offline fallback
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
        }
        return res;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
  );
});

// ─── Background upload ─────────────────────────────────────────────────────────
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'queue_id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r ? r.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

async function uploadQueue() {
  const db = await openDb();
  const auth = await idb(db, 'kv', 'readonly', (s) => s.get('auth'));
  if (!auth || !auth.token || !auth.userId) return 0;
  const queue = ((await idb(db, 'queue', 'readonly', (s) => s.getAll())) || [])
    .filter((q) => q.user_id === auth.userId)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (!queue.length) return 0;

  const notices = (await idb(db, 'kv', 'readonly', (s) => s.get('notices'))) || [];
  let uploaded = 0;
  for (let i = 0; i < queue.length; i += 5) {
    const chunk = queue.slice(i, i + 5);
    const res = await fetch(`${auth.apiBase}/api/sync/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({
        operations: chunk.map((q) => ({
          queue_id: q.queue_id, action: 'complete', facility_id: q.facility_id, created_at: q.created_at, payload: q.payload,
        })),
      }),
    }); // throws with no internet → the browser retries the sync later
    if (res.status === 401) break; // session gone (logged out): wait until the user signs in again
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { results = [] } = await res.json();
    const done = [];
    for (const r of results) {
      done.push(r.queue_id);
      if (r.status === 'applied') uploaded += 1;
      else {
        const q = chunk.find((c) => c.queue_id === r.queue_id);
        notices.push({
          id: r.queue_id, facility_name: r.facility_name || (q && q.facility_name) || '',
          status: r.status || 'skipped', reason: r.reason || '', at: new Date().toISOString(),
        });
      }
    }
    await idb(db, 'queue', 'readwrite', (s) => {
      done.forEach((id) => s.delete(id));
    });
  }
  await idb(db, 'kv', 'readwrite', (s) => {
    s.put(notices.slice(-30), 'notices');
  });
  return uploaded;
}

self.addEventListener('sync', (event) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil(
    uploadQueue().then(async (uploaded) => {
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      clients.forEach((c) => c.postMessage({ type: 'sync-done', uploaded }));
      if (uploaded > 0 && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        self.registration.showNotification('تم رفع المعاينات', {
          body: `تم رفع ${uploaded} معاينة كانت محفوظة على التليفون`,
          icon: '/icon-192.png',
          lang: 'ar',
          dir: 'rtl',
        });
      }
    })
  );
});
