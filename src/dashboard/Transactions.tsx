import { useMemo, useState } from 'preact/hooks';
import { Overlay } from '../ui/components';
import { download } from '../lib/kiosk';
import { PAY_METHOD_LABEL, toCsv, type PayMethod } from '../lib/log';
import { formatRupiah } from '../lib/settings';
import { toast } from '../ui/components';
import { EyeIcon, QrIcon } from '../ui/icons';
import { ShareQrDialog } from '../ui/ShareQr';
import { shareUrl } from '../lib/cloud/shared';
import type { ShareState, Tx, TxFilter } from './api';
import type { PageProps } from './Dashboard';
import { dayKey, total } from './stats';
import { LoadState, PageHead, Pager, dateTime, describe, useLoad } from './ui';

const PAGE_SIZES = [20, 50, 100, 200];
const PAGE_SIZE_KEY = 'dashboard.tx-page-size';
const EXPORT_LIMIT = 20_000;

function savedPageSize(): number {
  try {
    const saved = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return PAGE_SIZES.includes(saved) ? saved : 50;
  } catch {
    return 50;
  }
}
const METHODS: PayMethod[] = ['qris', 'cash', 'voucher', 'free'];

/** Shortcuts that fill in the dates; typing a date by hand leaves none of them chosen. */
type Preset = 'today' | '7' | '30' | 'month' | 'custom';
const PRESETS: { id: Exclude<Preset, 'custom'>; label: string }[] = [
  { id: 'today', label: 'Hari ini' },
  { id: '7', label: '7 hari' },
  { id: '30', label: '30 hari' },
  { id: 'month', label: 'Bulan ini' },
];

function presetDays(preset: Preset, now: Date): [string, string] {
  const today = dayKey(now);
  if (preset === '7' || preset === '30') {
    return [dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (Number(preset) - 1))), today];
  }
  if (preset === 'month') return [dayKey(new Date(now.getFullYear(), now.getMonth(), 1)), today];
  return [today, today];
}

/** Every finished session from every tablet, filterable and exportable. */
export function Transactions({ api }: PageProps) {
  const [preset, setPreset] = useState<Preset>('7');
  const [[first, last], setDays] = useState(() => presetDays('7', new Date()));
  const [method, setMethod] = useState<PayMethod | ''>('');
  const [deviceId, setDeviceId] = useState('');
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(savedPageSize);
  const [exporting, setExporting] = useState(false);
  const [qrFor, setQrFor] = useState<Tx | null>(null);
  const [viewing, setViewing] = useState<Tx | null>(null);
  const devices = useLoad(() => api.listDevices(), [api]);

  const filter = useMemo<TxFilter | null>(() => {
    const from = new Date(`${first}T00:00:00`);
    const end = new Date(`${last}T00:00:00`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(end.getTime()) || end < from) return null;
    return { from, to: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1), method, deviceId };
  }, [first, last, method, deviceId]);

  const load = useLoad(async () => {
    if (!filter) return { rows: [] as Tx[], total: 0, sum: { sessions: 0, prints: 0, revenue: 0 } };
    const [page, stats] = await Promise.all([api.listTransactions(filter, offset, pageSize), api.dailyStats(filter.from, filter.to)]);
    const sum = total(stats, (row) => (!filter.method || row.method === filter.method) && (!filter.deviceId || row.device_id === filter.deviceId));
    return { ...page, sum };
  }, [api, filter, offset, pageSize]);

  const codes = (load.data?.rows ?? []).flatMap((tx) => (tx.share_code ? [tx.share_code] : []));
  const shares = useLoad(() => api.shareStates(codes), [api, codes.join(',')]);

  const change = (apply: () => void) => {
    apply();
    setOffset(0);
  };

  const exportCsv = async () => {
    if (!filter) return;
    setExporting(true);
    try {
      const all: Tx[] = [];
      for (;;) {
        const page = await api.listTransactions(filter, all.length, 1000);
        all.push(...page.rows);
        if (page.rows.length === 0 || all.length >= page.total || all.length >= EXPORT_LIMIT) break;
      }
      const rows = [
        ['waktu', 'perangkat', 'no_sesi', 'frame', 'pilihan', 'cara_bayar', 'harga', 'uang_diterima', 'voucher', 'lembar'],
        ...all.map((tx) => [
          dateTime(tx.at),
          tx.device_name,
          tx.session_no ?? '',
          tx.frame ?? '',
          tx.package ?? '',
          PAY_METHOD_LABEL[tx.method],
          tx.price,
          tx.method === 'qris' || tx.method === 'cash' ? tx.price : 0,
          tx.voucher_code ?? '',
          tx.prints,
        ]),
      ];
      // The BOM makes Excel read the file as UTF-8.
      download(`transaksi-${first}-sd-${last}.csv`, new Blob(['﻿', toCsv(rows)], { type: 'text/csv' }));
      if (all.length >= EXPORT_LIMIT) toast(`Hanya ${EXPORT_LIMIT.toLocaleString('id-ID')} baris pertama yang diekspor. Persempit rentang tanggalnya.`);
    } catch (cause) {
      toast(describe(cause));
    }
    setExporting(false);
  };

  return (
    <>
      <PageHead title="Transaksi" lead="Semua sesi yang selesai, dari semua perangkat.">
        <button class="btn small" disabled={exporting || !filter || !load.data?.total} onClick={() => void exportCsv()}>
          {exporting ? 'Menyiapkan…' : 'Unduh CSV'}
        </button>
      </PageHead>

      <section class="panel">
        <div class="chips tight">
          {PRESETS.map((option) => (
            <button
              key={option.id}
              class={`chip ${preset === option.id ? 'on' : ''}`}
              onClick={() =>
                change(() => {
                  setPreset(option.id);
                  setDays(presetDays(option.id, new Date()));
                })
              }
            >
              {option.label}
            </button>
          ))}
        </div>
        <div class="filters">
          <label class="field">
            <span>Dari</span>
            <input
              type="date"
              value={first}
              max={last}
              onChange={(event) =>
                change(() => {
                  setPreset('custom');
                  setDays([event.currentTarget.value, last]);
                })
              }
            />
          </label>
          <label class="field">
            <span>Sampai</span>
            <input
              type="date"
              value={last}
              min={first}
              onChange={(event) =>
                change(() => {
                  setPreset('custom');
                  setDays([first, event.currentTarget.value]);
                })
              }
            />
          </label>
          <label class="field">
            <span>Cara bayar</span>
            <select value={method} onChange={(event) => change(() => setMethod(event.currentTarget.value as PayMethod | ''))}>
              <option value="">Semua</option>
              {METHODS.map((option) => (
                <option key={option} value={option}>
                  {PAY_METHOD_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>Perangkat</span>
            <select value={deviceId} onChange={(event) => change(() => setDeviceId(event.currentTarget.value))}>
              <option value="">Semua</option>
              {devices.data?.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>Per halaman</span>
            <select
              value={pageSize}
              onChange={(event) =>
                change(() => {
                  const size = Number(event.currentTarget.value);
                  setPageSize(size);
                  try {
                    localStorage.setItem(PAGE_SIZE_KEY, String(size));
                  } catch {
                    // Remembered only where the browser allows it.
                  }
                })
              }
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!filter && <p class="banner">Tanggal “sampai” harus sama dengan atau setelah tanggal “dari”.</p>}
      </section>

      <LoadState load={load} />
      {load.data && (
        <>
          <div class="tiles">
            <div class="tile">
              <span>Uang diterima</span>
              <b>{formatRupiah(load.data.sum.revenue)}</b>
              <small>QRIS dan tunai</small>
            </div>
            <div class="tile">
              <span>Sesi</span>
              <b>{load.data.sum.sessions.toLocaleString('id-ID')}</b>
              <small>{load.data.sum.prints.toLocaleString('id-ID')} lembar dicetak</small>
            </div>
          </div>

          <section class={`panel ${load.loading ? 'busy' : ''}`}>
            {load.data.rows.length === 0 ? (
              <p class="hint">Tidak ada transaksi untuk pilihan ini.</p>
            ) : (
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Perangkat</th>
                      <th>Frame · pilihan</th>
                      <th>Cara bayar</th>
                      <th class="num">Harga</th>
                      <th>Hasil foto</th>
                      <th class="num">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {load.data.rows.map((tx) => (
                      <tr key={tx.id}>
                        <td>{dateTime(tx.at)}</td>
                        <td>{tx.device_name}</td>
                        <td>
                          {tx.frame} · {tx.package}
                        </td>
                        <td>
                          {PAY_METHOD_LABEL[tx.method]}
                          {tx.voucher_code && <small class="mono"> {tx.voucher_code}</small>}
                        </td>
                        <td class="num">{formatRupiah(tx.price)}</td>
                        <td>
                          <ShareThumb
                            code={tx.share_code}
                            state={tx.share_code ? shares.data?.[tx.share_code] : undefined}
                            onOpen={() => setViewing(tx)}
                          />
                        </td>
                        <td class="num">
                          {tx.share_code && (
                            <div class="actions">
                              <button class="icon-btn" title="Tampilkan QR unduhan" aria-label="Tampilkan QR unduhan" onClick={() => setQrFor(tx)}>
                                <QrIcon />
                              </button>
                              <button class="icon-btn" title="Lihat hasil foto" aria-label="Lihat hasil foto" onClick={() => setViewing(tx)}>
                                <EyeIcon />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager offset={offset} limit={pageSize} total={load.data.total} onChange={setOffset} />
          </section>
          {qrFor?.share_code && <ShareQrDialog code={qrFor.share_code} sessionAt={qrFor.at} onClose={() => setQrFor(null)} />}
          {viewing?.share_code && (
            <PhotoDialog tx={viewing} state={shares.data?.[viewing.share_code]} onClose={() => setViewing(null)} />
          )}
        </>
      )}
    </>
  );
}

/** The small picture of a session's digital copy, or why there is none. Tapping it opens the photo. */
function ShareThumb({ code, state, onOpen }: { code: string | null; state: ShareState | undefined; onOpen: () => void }) {
  if (!code) return <span class="hint">—</span>;
  if (state?.thumb) {
    return (
      <button class="thumb-btn" title="Lihat hasil foto" aria-label="Lihat hasil foto" onClick={onOpen}>
        <img class="share-thumb" src={state.thumb} alt="" loading="lazy" />
      </button>
    );
  }
  if (state?.status === 'expired') return <span class="hint">Kedaluwarsa</span>;
  return <span class="hint">{state ? 'Belum terunggah' : '…'}</span>;
}

/** A session's photo inside the dashboard, closed again with a button rather than a browser tab. */
function PhotoDialog({ tx, state, onClose }: { tx: Tx; state: ShareState | undefined; onClose: () => void }) {
  const code = tx.share_code ?? '';
  return (
    <Overlay onClose={onClose}>
      <div class="card dialog photo-dialog">
        <div class="row">
          <h2 class="heading small grow">Hasil foto</h2>
          <button class="btn small primary" onClick={onClose}>
            Tutup
          </button>
        </div>
        <p class="hint">
          {tx.device_name} · {dateTime(tx.at)}
        </p>
        {state?.photo ? (
          <img class="photo-dialog-img" src={state.photo} alt="Hasil foto sesi ini" />
        ) : (
          <p class="banner">
            {state?.status === 'expired'
              ? 'Masa simpan hasil foto ini sudah habis, jadi berkasnya sudah dihapus.'
              : 'Foto sesi ini belum terunggah dari tablet.'}
          </p>
        )}
        <div class="row center">
          {state?.photo && (
            <a class="btn small" href={state.photo} target="_blank" rel="noopener">
              Buka ukuran penuh
            </a>
          )}
          <a class="btn small" href={shareUrl(code)} target="_blank" rel="noopener">
            Halaman tamu
          </a>
        </div>
      </div>
    </Overlay>
  );
}
