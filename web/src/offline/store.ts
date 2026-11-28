// Tiny IndexedDB wrapper shared (same database, same layout) with public/sw.js.
// IndexedDB — not localStorage — because a day of offline inspections with signatures can pass 5 MB,
// and the service worker can read it to upload in the background.
//
//   kv     : key → value   (cached plans/facilities/feed, the auth the service worker needs, sync notices)
//   queue  : inspections saved offline, waiting to be uploaded (keyPath queue_id)

export const DB_NAME = 'menoufia-offline';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'queue_id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

function tx<T>(store: 'kv' | 'queue', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => resolve(r ? (r.result as T) : (undefined as T));
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export const kvGet = <T>(key: string): Promise<T | undefined> =>
  tx<T>('kv', 'readonly', (s) => s.get(key) as IDBRequest<T>).catch(() => undefined);

export const kvSet = (key: string, value: unknown): Promise<void> =>
  tx<void>('kv', 'readwrite', (s) => {
    s.put(value, key);
  }).catch(() => undefined);

export const kvDelete = (key: string): Promise<void> =>
  tx<void>('kv', 'readwrite', (s) => {
    s.delete(key);
  }).catch(() => undefined);

export interface QueuedInspection {
  queue_id: string;
  user_id: string;
  facility_id: string;
  facility_name: string;
  plan_id: string;
  created_at: string;
  payload: Record<string, unknown>;
}

export const queueAll = (): Promise<QueuedInspection[]> =>
  tx<QueuedInspection[]>('queue', 'readonly', (s) => s.getAll() as IDBRequest<QueuedInspection[]>).then((r) => r || []);

export const queuePut = (item: QueuedInspection): Promise<void> =>
  tx<void>('queue', 'readwrite', (s) => {
    s.put(item);
  });

export const queueDelete = (ids: string[]): Promise<void> =>
  tx<void>('queue', 'readwrite', (s) => {
    ids.forEach((id) => s.delete(id));
  });
