import type { PhotoStyle } from './image/style';
import type { PayMethod } from './log';
import type { Crop } from './receipt/crop';

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
  /** How the guest zoomed each photo, in the same order; missing in sessions saved before zooming existed. */
  crops?: (Crop | null)[];
}

const DB_NAME = 'booth';
const STORE = 'sessions';
const UPLOADS = 'uploads';

/** A guest's digital copy waiting to go up to the cloud. */
export interface UploadRecord {
  /** code:kind */
  id: string;
  code: string;
  kind: 'photo' | 'thumb' | 'live' | 'slideshow';
  blob: Blob;
  createdAt: number;
  attempts: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    // Version 2 added the upload queue; existing photos are kept.
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      if (!db.objectStoreNames.contains(UPLOADS)) db.createObjectStore(UPLOADS, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>, storeName = STORE): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const request = work(tx.objectStore(storeName));
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

export function putUpload(record: UploadRecord): Promise<IDBValidKey> {
  return run('readwrite', (store) => store.put(record), UPLOADS);
}

/** Oldest first. */
export async function listUploads(): Promise<UploadRecord[]> {
  const all = await run<UploadRecord[]>('readonly', (store) => store.getAll(), UPLOADS);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export function deleteUpload(id: string): Promise<undefined> {
  return run('readwrite', (store) => store.delete(id), UPLOADS);
}
