import '../dashboard/dashboard.css';
import { useMemo, useState } from 'preact/hooks';
import { dayKey } from '../dashboard/stats';
import { Pager, dateTime, describe, useLoad } from '../dashboard/ui';
import { fetchBoothTransactions, outboxStore, pairingStore, type BoothTx } from '../lib/cloud/device';
import { download } from '../lib/kiosk';
import { PAY_METHOD_LABEL, toCsv, type PayMethod } from '../lib/log';
import { formatRupiah } from '../lib/settings';
import { useStore } from '../lib/store';
import { toast } from '../ui/components';
import { ShareQrDialog } from '../ui/ShareQr';
import { QrIcon } from '../ui/icons';

const PAGE_SIZE = 30;
const METHODS: PayMethod[] = ['qris', 'cash', 'voucher', 'free'];
const RANGES = [
  { days: 1, label: 'Hari ini' },
  { days: 7, label: '7 hari' },
  { days: 30, label: '30 hari' },
];

/** Every session this tablet finished, from the server, for staff to check against the cash drawer. */
export function BoothTxTab() {
  const pairing = useStore(pairingStore);
  const queued = useStore(outboxStore).length;
  const [days, setDays] = useState(1);
  const [method, setMethod] = useState<PayMethod | ''>('');
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [qrFor, setQrFor] = useState<BoothTx | null>(null);

  const range = useMemo(() => {
    const now = new Date();
    return {
      from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)),
      to: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
    };
  }, [days]);

  const load = useLoad(() => fetchBoothTransactions(range.from, range.to, method, offset, PAGE_SIZE), [pairing?.token, range, method, offset]);

  if (!pairing) {
    return (
      <div class="admin-grid">
        <p class="banner panel span">Sambungkan tablet ini ke dashboard dulu (tab Sambungan) untuk melihat transaksinya.</p>
      </div>
    );
  }

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: BoothTx[] = [];
      for (;;) {
        const page = await fetchBoothTransactions(range.from, range.to, method, all.length, 1000);
        all.push(...page.rows);
        if (page.rows.length === 0 || all.length >= page.total) break;
      }
      const rows = [
        ['waktu', 'no_sesi', 'frame', 'pilihan', 'cara_bayar', 'harga', 'uang_diterima', 'voucher', 'lembar'],
        ...all.map((tx) => [
          dateTime(tx.at),
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
      download(`transaksi-${pairing.name || 'tablet'}-${dayKey(range.from)}.csv`, new Blob(['﻿', toCsv(rows)], { type: 'text/csv' }));
    } catch (cause) {
      toast(describe(cause));
    }
    setExporting(false);
  };

  return (
    <div class="admin-grid">
      <section class="panel span">
        <div class="row">
          <div class="grow">
            <h2>Transaksi {pairing.name}</h2>
            <p class="hint">Hanya sesi dari tablet ini, sesuai yang tercatat di server.</p>
          </div>
          <button class="btn small" disabled={exporting || !load.data?.total} onClick={() => void exportCsv()}>
            {exporting ? 'Menyiapkan…' : 'Unduh CSV'}
          </button>
        </div>
        <div class="row">
          <div class="chips tight grow">
            {RANGES.map((option) => (
              <button
                key={option.days}
                class={`chip ${days === option.days ? 'on' : ''}`}
                onClick={() => {
                  setDays(option.days);
                  setOffset(0);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label class="field">
            <select
              value={method}
              onChange={(event) => {
                setMethod(event.currentTarget.value as PayMethod | '');
                setOffset(0);
              }}
            >
              <option value="">Semua cara bayar</option>
              {METHODS.map((option) => (
                <option key={option} value={option}>
                  {PAY_METHOD_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {queued > 0 && <p class="banner">{queued} sesi terakhir belum terkirim ke server, jadi belum muncul di daftar ini.</p>}
      </section>

      <section class={`panel span ${load.loading ? 'busy' : ''}`}>
        {load.error && <p class="banner err">Daftar transaksi butuh internet. {load.error}</p>}
        {!load.data && !load.error && <div class="spinner" />}
        {load.data?.rows.length === 0 && <p class="hint">Belum ada transaksi pada pilihan ini.</p>}
        {load.data && load.data.rows.length > 0 && (
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>No.</th>
                  <th>Frame · pilihan</th>
                  <th>Cara bayar</th>
                  <th class="num">Harga</th>
                  <th class="num">QR</th>
                </tr>
              </thead>
              <tbody>
                {load.data.rows.map((tx) => (
                  <tr key={tx.id}>
                    <td>{dateTime(tx.at)}</td>
                    <td class="mono">{tx.session_no ? String(tx.session_no).padStart(3, '0') : '—'}</td>
                    <td>
                      {tx.frame} · {tx.package}
                    </td>
                    <td>
                      {PAY_METHOD_LABEL[tx.method]}
                      {tx.voucher_code && <small class="mono"> {tx.voucher_code}</small>}
                    </td>
                    <td class="num">{formatRupiah(tx.price)}</td>
                    <td class="num">
                      {tx.share_code && (
                        <button class="icon-btn" title="Tampilkan QR unduhan" aria-label="Tampilkan QR unduhan" onClick={() => setQrFor(tx)}>
                          <QrIcon />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {load.data && <Pager offset={offset} limit={PAGE_SIZE} total={load.data.total} onChange={setOffset} />}
      </section>
      {qrFor?.share_code && <ShareQrDialog code={qrFor.share_code} sessionAt={qrFor.at} onClose={() => setQrFor(null)} />}
    </div>
  );
}
