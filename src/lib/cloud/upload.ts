import { deleteUpload, listUploads, putUpload, type UploadRecord } from '../db';
import { createStore } from '../store';
import { callFunction, pairingStore } from './device';
import { SHARE_DAYS } from './shared';

/** How many files are still waiting to go up, for the staff's connection screen. */
export const uploadsWaiting = createStore(0);

const TIMEOUT_MS = 120_000;
let running = false;

async function refreshCount(): Promise<void> {
  uploadsWaiting.set((await listUploads().catch(() => [])).length);
}

/** Keeps a session's files on the tablet until they are in the cloud, then sends them. */
export async function queueShareFiles(code: string, files: { kind: UploadRecord['kind']; blob: Blob }[]): Promise<void> {
  const now = Date.now();
  for (const file of files) {
    await putUpload({ id: `${code}:${file.kind}`, code, kind: file.kind, blob: file.blob, createdAt: now, attempts: 0 });
  }
  await refreshCount();
  void pumpUploads();
}

type SignReply = { url?: string; method?: string; headers?: Record<string, string>; error?: string };

/**
 * Sends waiting files one by one: a signed address from the server, the file
 * straight to cloud storage, then a note to the server that it arrived. Files
 * that cannot be sent now stay queued for the next try.
 */
export async function pumpUploads(): Promise<void> {
  const pairing = pairingStore.get();
  if (running || !pairing) return;
  running = true;
  try {
    for (const upload of await listUploads()) {
      // Past their days the files would be deleted from the cloud anyway.
      if (Date.now() - upload.createdAt > SHARE_DAYS * 86_400_000) {
        await deleteUpload(upload.id);
        continue;
      }
      const base = { token: pairing.token, code: upload.code, kind: upload.kind };
      const signed = await callFunction<SignReply>('share-upload', { ...base, action: 'sign', size: upload.blob.size });
      // Not set up yet, or not reachable: try again later, keeping every file.
      if (signed.error === 'not-configured' || signed.error === 'unpaired') break;
      // A code this tablet can never use: drop the file rather than retry forever.
      if (signed.error || !signed.url) {
        await deleteUpload(upload.id);
        continue;
      }
      const put = await fetch(signed.url, {
        method: signed.method ?? 'PUT',
        headers: signed.headers,
        body: upload.blob,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }).catch(() => null);
      if (!put?.ok) {
        await putUpload({ ...upload, attempts: upload.attempts + 1 });
        break;
      }
      const done = await callFunction<{ ok?: boolean; error?: string }>('share-upload', { ...base, action: 'done' });
      if (done.ok) await deleteUpload(upload.id);
      else break;
    }
  } catch {
    // Offline or the server is unreachable: the next sync tries again.
  } finally {
    running = false;
    await refreshCount();
  }
}
