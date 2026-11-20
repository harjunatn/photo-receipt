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
  /** Code of the session's download page; missing in sessions saved before it was kept here. */
  shareCode?: string;
}

const DB_NAME = 'booth';
const STORE = 'sessions';
const UPLOADS = 'uploads';
const FRAMES = 'frames';

/** One of the franchise's own frames, kept on the tablet so the booth works offline. */
export interface StoredFrame {
  id: string;
  name: string;
  blurb: string;
  layout: unknown;
  /** The frame picture as a data URL. */
  image: string;
  /** As the server reported it; tells whether the server has a newer one. */
  updatedAt: string;
}

/** A guest's digital copy waiting to go up to the cloud. */
export interface UploadRecord {
  /** code:kind */
  id: string;
  code: string;
  kind: 'photo' | 'thumb' | 'live' | 'slideshow';
  blob: Blob;
  /** With the photo: the videos that follow, so the download page waits for them. */
  expects?: ('live' | 'slideshow')[];
  createdAt: number;
  attempts: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    // Version 2 added the upload queue, version 3 the franchise's own frames; existing photos are kept.
    const request = indexedDB.open(DB_NAME, 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      if (!db.objectStoreNames.contains(UPLOADS)) db.createObjectStore(UPLOADS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FRAMES)) db.createObjectStore(FRAMES, { keyPath: 'id' });
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

export function listStoredFrames(): Promise<StoredFrame[]> {
  return run<StoredFrame[]>('readonly', (store) => store.getAll(), FRAMES);
}

export function putStoredFrame(frame: StoredFrame): Promise<IDBValidKey> {
  return run('readwrite', (store) => store.put(frame), FRAMES);
}

export function deleteStoredFrame(id: string): Promise<undefined> {
  return run('readwrite', (store) => store.delete(id), FRAMES);
}
