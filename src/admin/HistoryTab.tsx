import { useEffect, useState } from 'preact/hooks';
import { clearSessions, deleteSession, listSessions, type SessionRecord } from '../lib/db';
import { download } from '../lib/kiosk';
import { PAY_METHOD_LABEL } from '../lib/log';
import { composeReceipt, formatDateTime, loadImage, loadReceiptFonts, receiptToBits, sessionCode, type ComposedReceipt } from '../lib/receipt/compose';
import { frameById } from '../lib/receipt/frames';
import { settingsStore, useSettings } from '../lib/settings';
import { toast } from '../ui/components';
import { edit, printWithFeedback } from './actions';
import { Check, NumberField } from './fields';

/** Rebuilds a past session's receipt from its saved photos, with today's text and print settings. */
async function recompose(record: SessionRecord): Promise<ComposedReceipt> {
  const settings = settingsStore.get();
  await loadReceiptFonts();
  const photos = await Promise.all(record.photos.map((blob) => createImageBitmap(blob)));
  const logo = settings.receipt.logo ? await loadImage(settings.receipt.logo).catch(() => null) : null;
  return composeReceipt({
    width: settings.printer.dots,
    frame: frameById(record.frameId),
    photos,
    crops: record.crops?.map((crop) => crop ?? undefined),
    texts: settings.receipt,
    quote: record.quote,
    when: new Date(record.createdAt),
    sessionNo: record.no,
    logo,
  });
}

function Thumb({ blob }: { blob: Blob | undefined }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return url ? <img src={url} alt="" /> : null;
}

/** Past sessions kept on this device, for reprinting or handing a guest their file. */
export function HistoryTab() {
  const { storage } = useSettings();
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [busy, setBusy] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = () =>
    listSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  useEffect(() => void refresh(), []);

  const reprint = async (record: SessionRecord) => {
    setBusy(record.id);
    try {
      const composed = await recompose(record);
      if (await printWithFeedback(receiptToBits(composed, settingsStore.get().printer.raster, record.style ?? 'normal'))) toast('Cetak ulang terkirim.');
    } catch {
      toast('Foto sesi ini tidak bisa dibuka.');
    }
    setBusy('');
  };

  const save = async (record: SessionRecord) => {
    setBusy(record.id);
    try {
      const composed = await recompose(record);
      const blob = await new Promise<Blob | null>((resolve) => composed.canvas.toBlob(resolve, 'image/png'));
      if (blob) download(`struk-${sessionCode(new Date(record.createdAt), record.no)}.png`, blob);
    } catch {
      toast('Foto sesi ini tidak bisa dibuka.');
    }
    setBusy('');
  };

  return (
    <div class="admin-grid">
      <section class="panel">
        <h2>Penyimpanan foto</h2>
        <Check
          label="Simpan foto sesi di perangkat ini"
          hint="Diperlukan untuk cetak ulang. Foto tidak dikirim ke mana pun — hanya tersimpan di tablet ini."
          checked={storage.keepPhotos}
          onChange={(v) => edit((s) => void (s.storage.keepPhotos = v))}
        />
        <NumberField
          label="Jumlah sesi terakhir yang disimpan"
          hint="Sesi yang lebih lama dihapus otomatis."
          value={storage.maxSessions}
          min={5}
          max={1000}
          onChange={(v) => edit((s) => void (s.storage.maxSessions = v))}
        />
        {confirmClear ? (
          <div class="row">
            <button
              class="btn small danger"
              onClick={async () => {
                await clearSessions();
                setConfirmClear(false);
                await refresh();
                toast('Semua foto sesi dihapus.');
              }}
            >
              Ya, hapus semua foto
            </button>
            <button class="btn small" onClick={() => setConfirmClear(false)}>
              Batal
            </button>
          </div>
        ) : (
          <button class="btn small danger" disabled={!sessions?.length} onClick={() => setConfirmClear(true)}>
            Hapus semua foto tersimpan
          </button>
        )}
      </section>

      <section class="panel span">
        <h2>Sesi tersimpan {sessions ? `(${sessions.length})` : ''}</h2>
        <div class="list">
          {sessions === null && <p class="hint">Memuat…</p>}
          {sessions?.length === 0 && <p class="hint">Belum ada sesi tersimpan.</p>}
          {sessions?.map((record) => (
            <div class="list-item" key={record.id}>
              <Thumb blob={record.photos[0]} />
              <div class="grow">
                <b>
                  No. {String(record.no).padStart(3, '0')} · {record.packageName}
                </b>
                <div class="hint">
                  {formatDateTime(new Date(record.createdAt))} · {record.photos.length} foto · {(PAY_METHOD_LABEL[record.method] ?? record.method).toLowerCase()}
                </div>
              </div>
              <button class="btn small dark" disabled={busy !== ''} onClick={() => void reprint(record)}>
                {busy === record.id ? '…' : 'Cetak ulang'}
              </button>
              <button class="btn small" disabled={busy !== ''} onClick={() => void save(record)}>
                Unduh
              </button>
              <button
                class="btn small danger"
                disabled={busy !== ''}
                onClick={async () => {
                  await deleteSession(record.id);
                  await refresh();
                }}
              >
                Hapus
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
