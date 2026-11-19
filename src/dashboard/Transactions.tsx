import { useMemo, useState } from 'preact/hooks';
import { Overlay } from '../ui/components';
import { download } from '../lib/kiosk';
import { buildPdf } from '../lib/export/pdf';
import { buildXlsx, type SheetColumn } from '../lib/export/xlsx';
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

type ExportKind = 'xlsx' | 'pdf' | 'csv';
const EXPORT_LABEL: Record<ExportKind, string> = { xlsx: 'Unduh Excel', pdf: 'Unduh PDF', csv: 'CSV' };

/** Whether staff confirmed the payment: only cash and static QRIS can be taken without, when the franchise allows it. */
const unconfirmed = (tx: Tx) => tx.staff_confirmed === false;
const confirmation = (tx: Tx) => (unconfirmed(tx) ? 'Tidak' : tx.method === 'cash' || tx.method === 'qris' ? 'Ya' : '');

/** Money that actually came in: QRIS and cash; vouchers and free sessions bring none. */
const received = (tx: Tx) => (tx.method === 'qris' || tx.method === 'cash' ? tx.price : 0);

function csvRows(all: Tx[]): (string | number)[][] {
  return [
    ['waktu', 'perangkat', 'no_sesi', 'frame', 'pilihan', 'cara_bayar', 'konfirmasi_petugas', 'harga', 'uang_diterima', 'voucher', 'lembar'],
    ...all.map((tx) => [
      dateTime(tx.at),
      tx.device_name,
      tx.session_no ?? '',
      tx.frame ?? '',
      tx.package ?? '',
      PAY_METHOD_LABEL[tx.method],
      confirmation(tx),
      tx.price,
      received(tx),
      tx.voucher_code ?? '',
      tx.prints,
    ]),
  ];
}

const SHEET_COLUMNS: SheetColumn[] = [
  { header: 'Waktu', width: 17, format: 'datetime' },
  { header: 'Perangkat', width: 22 },
  { header: 'No. sesi', width: 9, format: 'integer' },
  { header: 'Frame', width: 16 },
  { header: 'Pilihan', width: 16 },
  { header: 'Cara bayar', width: 12 },
  { header: 'Konfirmasi petugas', width: 19 },
  { header: 'Voucher', width: 16 },
  { header: 'Lembar', width: 9, format: 'integer', sum: true },
  { header: 'Harga', width: 13, format: 'rupiah', sum: true },
  { header: 'Uang diterima', width: 15, format: 'rupiah', sum: true },
];

function sheetRow(tx: Tx): (string | number | Date | null)[] {
  return [
    new Date(tx.at),
    tx.device_name,
    tx.session_no,
    tx.frame,
    tx.package,
    PAY_METHOD_LABEL[tx.method],
    confirmation(tx),
    tx.voucher_code,
    tx.prints,
    tx.price,
    received(tx),
  ];
}

function shortDate(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

/** The report as a printable PDF table, with the period, filters and totals above it. */
function pdfReport(all: Tx[], context: { brand: string; period: string; method: string; device: string }) {
  const sessions = all.length;
  const prints = all.reduce((sum, tx) => sum + tx.prints, 0);
  const money = all.reduce((sum, tx) => sum + received(tx), 0);
  const loose = all.filter(unconfirmed);
  return {
    title: `Laporan transaksi ${context.brand}`,
    lines: [
      `Periode ${context.period} · Cara bayar: ${context.method} · Perangkat: ${context.device}`,
      `${sessions.toLocaleString('id-ID')} sesi · ${prints.toLocaleString('id-ID')} lembar dicetak · Uang diterima ${formatRupiah(money)} (QRIS dan tunai)`,
      ...(loose.length > 0
        ? [`${loose.length.toLocaleString('id-ID')} sesi tanpa konfirmasi petugas, senilai ${formatRupiah(loose.reduce((sum, tx) => sum + received(tx), 0))}: cocokkan dengan uang yang diterima.`]
        : []),
    ],
    columns: [
      { header: 'Waktu', width: 100 },
      { header: 'Perangkat', width: 120 },
      { header: 'No.', width: 40, align: 'right' as const },
      { header: 'Frame · pilihan', width: 170 },
      { header: 'Cara bayar', width: 125 },
      { header: 'Lembar', width: 45, align: 'right' as const },
      { header: 'Harga', width: 80, align: 'right' as const },
      { header: 'Diterima', width: 90, align: 'right' as const },
    ],
    rows: all.map((tx) => [
      dateTime(tx.at),
      tx.device_name,
      tx.session_no === null ? '' : String(tx.session_no),
      [tx.frame, tx.package].filter(Boolean).join(' · '),
      tx.voucher_code ? `${PAY_METHOD_LABEL[tx.method]} ${tx.voucher_code}` : unconfirmed(tx) ? `${PAY_METHOD_LABEL[tx.method]} · tanpa konfirmasi` : PAY_METHOD_LABEL[tx.method],
      String(tx.prints),
      formatRupiah(tx.price),
      formatRupiah(received(tx)),
    ]),
    total: ['Total', '', '', '', '', prints.toLocaleString('id-ID'), formatRupiah(all.reduce((sum, tx) => sum + tx.price, 0)), formatRupiah(money)],
    footer: `Dibuat ${new Date().toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
  };
}

/** Every finished session from every tablet, filterable and exportable. */
export function Transactions({ api }: PageProps) {
  const [preset, setPreset] = useState<Preset>('7');
  const [[first, last], setDays] = useState(() => presetDays('7', new Date()));
  const [method, setMethod] = useState<PayMethod | ''>('');
  const [deviceId, setDeviceId] = useState('');
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(savedPageSize);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
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

  /** Every transaction matching the filters, page by page, up to EXPORT_LIMIT. */
  const collectAll = async (current: TxFilter): Promise<Tx[]> => {
    const all: Tx[] = [];
    for (;;) {
      const page = await api.listTransactions(current, all.length, 1000);
      all.push(...page.rows);
      if (page.rows.length === 0 || all.length >= page.total || all.length >= EXPORT_LIMIT) break;
    }
    return all.slice(0, EXPORT_LIMIT);
  };

  const exportAs = async (kind: ExportKind) => {
    if (!filter) return;
    setExporting(kind);
    try {
      const all = await collectAll(filter);
      const name = `transaksi-${first}-sd-${last}`;
      if (kind === 'csv') {
        // The BOM makes Excel read the file as UTF-8.
        download(`${name}.csv`, new Blob(['\ufeff', toCsv(csvRows(all))], { type: 'text/csv' }));
      } else if (kind === 'xlsx') {
        const sheet = buildXlsx('Transaksi', SHEET_COLUMNS, all.map(sheetRow));
        download(`${name}.xlsx`, new Blob([sheet], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      } else {
        const outlet = (await api.getOutlet().catch(() => null)) as { brand?: { title?: unknown } } | null;
        const brand = typeof outlet?.brand?.title === 'string' && outlet.brand.title.trim() ? outlet.brand.title.trim() : api.franchise.name;
        const deviceName = devices.data?.find((device) => device.id === deviceId)?.name;
        const report = pdfReport(all, {
          brand,
          period: `${shortDate(first)} – ${shortDate(last)}`,
          method: method ? PAY_METHOD_LABEL[method] : 'Semua',
          device: deviceName ?? 'Semua',
        });
        download(`${name}.pdf`, new Blob([buildPdf(report)], { type: 'application/pdf' }));
      }
      if (all.length >= EXPORT_LIMIT) toast(`Hanya ${EXPORT_LIMIT.toLocaleString('id-ID')} baris pertama yang diunduh. Persempit rentang tanggalnya.`);
    } catch (cause) {
      toast(describe(cause));
    }
    setExporting(null);
  };

  return (
    <>
      <PageHead title="Transaksi" lead="Semua sesi yang selesai, dari semua perangkat.">
        {(['xlsx', 'pdf', 'csv'] as const).map((kind) => (
          <button key={kind} class="btn small" disabled={exporting !== null || !filter || !load.data?.total} onClick={() => void exportAs(kind)}>
            {exporting === kind ? 'Menyiapkan…' : EXPORT_LABEL[kind]}
          </button>
        ))}
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
                          {unconfirmed(tx) && (
                            <>
                              {' '}
                              <span class="tag warn" title="Sesi dimulai tanpa PIN petugas, karena konfirmasi dimatikan di Pengaturan.">
                                tanpa konfirmasi
                              </span>
                            </>
                          )}
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
