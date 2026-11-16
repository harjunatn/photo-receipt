import type { PhotoStyle } from './image/style';
import type { PayMethod } from './log';

/** A finished session with its photos, kept on this device so it can be reprinted. */
export interface SessionRecord {
  id: string;
  no: number;
  createdAt: number;
  packageName: string;
  price: number;
  method: PayMethod;
  frameId: string;
  style: PhotoStyle;
  quote: string;
  photos: Blob[];
}

const DB_NAME = 'booth';
const STORE = 'sessions';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/** Newest first. */
export async function listSessions(): Promise<SessionRecord[]> {
  const all = await run<SessionRecord[]>('readonly', (store) => store.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveSession(record: SessionRecord, maxSessions: number): Promise<void> {
  await run('readwrite', (store) => store.put(record));
  const all = await listSessions();
  for (const old of all.slice(Math.max(1, maxSessions))) await deleteSession(old.id);
}

export function deleteSession(id: string): Promise<void> {
  return run('readwrite', (store) => store.delete(id));
}

export function clearSessions(): Promise<void> {
  return run('readwrite', (store) => store.clear());
}
