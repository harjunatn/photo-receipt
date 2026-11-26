import { useEffect, useState } from 'preact/hooks';
import { formatRupiah } from '../lib/settings';
import { toast } from '../ui/components';
import { CardFlow } from '../ui/CardFlow';
import type { BankAccount, OwnerApi, PayoutRow, PayoutStatus, WalletSummary } from './api';
import type { PageProps } from './Dashboard';
import { LoadState, PageHead, Pager, Tile, dateTime, describe, useLoad } from './ui';

const PAGE_SIZE = 50;

export const PAYOUT_STATE: Record<PayoutStatus, { label: string; tag: string }> = {
  requested: { label: 'Menunggu ditransfer', tag: 'warn' },
  paid: { label: 'Sudah ditransfer', tag: 'ok' },
  rejected: { label: 'Ditolak', tag: 'err' },
};

/** "BCA · 0000 1111 22 · a.n. Budi Santoso" */
export const bankLine = (bank: BankAccount) => `${bank.bank} · ${bank.account_no} · a.n. ${bank.holder}`;

/** What is left of one QRIS payment after both fees. */
export const netOf = (row: { amount: number; fee_doku: number; fee_platform: number }) => row.amount - row.fee_doku - row.fee_platform;

/** Digits only, as a whole number of rupiah: "150.000" and "Rp 150000" both mean 150000. */
export function parseAmount(text: string): number {
  const digits = text.replace(/\D/g, '');
  return digits ? Number(digits.slice(0, 12)) : 0;
}

/** Titip saldo: the money guests paid by QRIS through the platform's account, what was taken off it, and getting it paid out. */
export function Wallet({ api }: PageProps) {
  const summary = useLoad(() => api.walletSummary(), [api]);
  const payouts = useLoad(() => api.walletPayouts(), [api]);
  const [offset, setOffset] = useState(0);
  const entries = useLoad(() => api.walletEntries(offset, PAGE_SIZE), [api, offset]);

  const reload = () => {
    summary.reload();
    payouts.reload();
    entries.reload();
  };

  const data = summary.data;
  const loading = summary.loading || payouts.loading || entries.loading;

  return (
    <>
      <PageHead
        title="Dompet"
        lead="Uang QRIS yang dibayar tamu lewat akun platform, sudah dipotong biaya per transaksi. Dari sini kamu mengajukan pencairan ke rekeningmu."
      >
        <button class="btn small" onClick={reload}>
          {loading ? 'Memuat…' : 'Muat ulang'}
        </button>
      </PageHead>

      <LoadState load={summary} />

      {data && !data.enabled && (
        <p class="banner">
          {data.blocked
            ? 'Titip saldo dihentikan oleh platform untuk franchise ini, jadi QRIS baru tidak lagi masuk ke dompet. Saldo yang masih ada tetap bisa dicairkan.'
            : data.transactions > 0
              ? 'Titip saldo sedang tidak dipakai, jadi QRIS baru tidak lagi masuk ke dompet. Saldo yang masih ada tetap bisa dicairkan. Memakainya lagi: Pengaturan → Cara bayar → QRIS.'
              : 'Titip saldo belum dipakai. Pilih di Pengaturan → Cara bayar → QRIS → Otomatis, titip saldo.'}
        </p>
      )}

      {data && (
        <>
          <div class="tiles">
            <Tile label="Saldo tersedia" value={formatRupiah(data.available)} note="bisa diajukan untuk dicairkan" />
            <Tile label="Sedang diajukan" value={formatRupiah(data.pending)} note="menunggu ditransfer" />
            <Tile label="Sudah dicairkan" value={formatRupiah(data.paid_out)} note="sudah masuk ke rekeningmu" />
            <Tile
              label="QRIS masuk"
              value={formatRupiah(data.gross)}
              note={`${data.transactions.toLocaleString('id-ID')} transaksi · potongan ${formatRupiah(data.fees_doku + data.fees_platform)}`}
            />
          </div>

          <CardFlow minWidth={340}>
            <RequestPanel api={api} summary={data} onDone={reload} />
            <BankPanel api={api} bank={data.bank} onDone={summary.reload} />
            <section class="panel">
              <h2>Potongan per transaksi</h2>
              <dl class="facts">
                <div>
                  <dt>Biaya DOKU</dt>
                  <dd>{formatRupiah(data.doku_fee)}</dd>
                </div>
                <div>
                  <dt>Biaya platform</dt>
                  <dd>{formatRupiah(data.platform_fee)}</dd>
                </div>
              </dl>
              <p class="hint">
                Dipotong dari tiap QRIS yang lunas. Contoh: tamu membayar {formatRupiah(25_000)}, yang masuk ke dompetmu{' '}
                <b>{formatRupiah(25_000 - data.doku_fee - data.platform_fee)}</b>. Pembayaran tunai dan voucher tidak lewat dompet.
              </p>
            </section>
          </CardFlow>
        </>
      )}

      <section class={`panel ${payouts.loading ? 'busy' : ''}`}>
        <h2>Riwayat pencairan</h2>
        <LoadState load={payouts} />
        {payouts.data?.length === 0 && <p class="hint">Belum ada pencairan.</p>}
        {payouts.data && payouts.data.length > 0 && <PayoutTable rows={payouts.data} />}
      </section>

      <section class={`panel ${entries.loading ? 'busy' : ''}`}>
        <h2>QRIS masuk</h2>
        <LoadState load={entries} />
        {entries.data?.rows.length === 0 && (
          <p class="hint">
            Belum ada QRIS yang masuk ke dompet. Supaya tamu bisa membayar lewat akun platform, buka <b>Pengaturan</b> → <b>Cara bayar</b>, nyalakan{' '}
            <b>QRIS</b> dan pilih <b>Otomatis (DOKU)</b>.
          </p>
        )}
        {entries.data && entries.data.rows.length > 0 && (
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Dibayar</th>
                  <th>Perangkat</th>
                  <th>Pilihan</th>
                  <th>Referensi</th>
                  <th class="num">Dibayar tamu</th>
                  <th class="num">Biaya DOKU</th>
                  <th class="num">Biaya platform</th>
                  <th class="num">Masuk dompet</th>
                </tr>
              </thead>
              <tbody>
                {entries.data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{dateTime(row.paid_at)}</td>
                    <td>{row.device_name}</td>
                    <td>{row.package_name ?? ''}</td>
                    <td class="mono">
                      <small>{row.partner_ref}</small>
                    </td>
                    <td class="num">{formatRupiah(row.amount)}</td>
                    <td class="num">−{formatRupiah(row.fee_doku)}</td>
                    <td class="num">−{formatRupiah(row.fee_platform)}</td>
                    <td class="num">
                      <b>{formatRupiah(netOf(row))}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {entries.data && <Pager offset={offset} limit={PAGE_SIZE} total={entries.data.total} onChange={setOffset} />}
      </section>
    </>
  );
}

/** Payout requests with where each stands. The platform owner's list also names the franchise. */
export function PayoutTable({ rows, withFranchise = false }: { rows: PayoutRow[]; withFranchise?: boolean }) {
  return (
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Diajukan</th>
            {withFranchise && <th>Franchise</th>}
            <th>Rekening tujuan</th>
            <th>Status</th>
            <th>Selesai</th>
            {withFranchise && <th>Oleh</th>}
            <th>Catatan</th>
            <th class="num">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{dateTime(row.requested_at)}</td>
              {withFranchise && <td>{row.franchise ?? ''}</td>}
              <td>{bankLine(row.bank)}</td>
              <td>
                <span class={`tag ${PAYOUT_STATE[row.status].tag}`}>{PAYOUT_STATE[row.status].label}</span>
              </td>
              <td>{row.settled_at ? dateTime(row.settled_at) : '—'}</td>
              {withFranchise && <td>{row.settled_by ?? '—'}</td>}
              <td>{row.note ?? ''}</td>
              <td class="num">{formatRupiah(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Asking for a payout: how much, and why not just now when it is not allowed. */
function RequestPanel({ api, summary, onDone }: { api: OwnerApi; summary: WalletSummary; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const wanted = parseAmount(amount);
  const waitUntil = summary.next_request_at && Date.parse(summary.next_request_at) > Date.now() ? summary.next_request_at : null;
  const blocked = !summary.bank
    ? 'Isi rekening tujuan dulu, supaya pemilik platform tahu ke mana uangnya ditransfer.'
    : summary.pending > 0
      ? `Pengajuan ${formatRupiah(summary.pending)} sedang menunggu ditransfer oleh pemilik platform. Pengajuan berikutnya bisa dibuat setelah itu selesai.`
      : waitUntil
        ? `Pengajuan berikutnya bisa dibuat mulai ${dateTime(waitUntil)}.`
        : summary.available <= 0
          ? 'Belum ada saldo yang bisa dicairkan.'
          : '';

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.walletRequest(wanted);
      setAmount('');
      toast(`Pencairan ${formatRupiah(wanted)} diajukan. Pemilik platform akan mentransfernya ke rekeningmu.`);
      onDone();
    } catch (cause) {
      toast(describe(cause));
    }
    setBusy(false);
  };

  return (
    <form class="panel" onSubmit={(event) => void submit(event)}>
      <h2>Cairkan saldo</h2>
      {blocked ? (
        <p class={summary.pending > 0 ? 'banner' : 'hint'}>{blocked}</p>
      ) : (
        <>
          <label class="field">
            <span>Jumlah (Rp)</span>
            <input
              type="text"
              inputMode="numeric"
              value={amount}
              placeholder={summary.available.toLocaleString('id-ID')}
              onInput={(event) => setAmount(event.currentTarget.value)}
            />
            <small class="hint">
              {wanted > summary.available
                ? `Melebihi saldo yang tersedia (${formatRupiah(summary.available)}).`
                : `Paling banyak ${formatRupiah(summary.available)}.`}
            </small>
          </label>
          <div class="chips tight">
            <button type="button" class="chip" onClick={() => setAmount(summary.available.toLocaleString('id-ID'))}>
              Semua saldo
            </button>
          </div>
          <div class="row">
            <button class="btn small primary" disabled={busy || wanted <= 0 || wanted > summary.available}>
              {busy ? 'Mengajukan…' : wanted > 0 ? `Ajukan ${formatRupiah(wanted)}` : 'Ajukan pencairan'}
            </button>
          </div>
        </>
      )}
      <p class="hint">
        Pemilik platform mentransfernya ke rekening tujuanmu, lalu menandainya di sini.
        {summary.payout_days > 0 ? ` Pencairan bisa diajukan sekali tiap ${summary.payout_days} hari.` : ''}
      </p>
    </form>
  );
}

/** Where payouts are sent. Each request keeps the account it was made with, so changing it later does not change open requests. */
function BankPanel({ api, bank, onDone }: { api: OwnerApi; bank: BankAccount | null; onDone: () => void }) {
  const [draft, setDraft] = useState<BankAccount>(bank ?? { bank: '', account_no: '', holder: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(bank ?? { bank: '', account_no: '', holder: '' });
  }, [bank?.bank, bank?.account_no, bank?.holder]);

  // Each field changes on its own, so a browser filling in several at once does not lose any.
  const set = (field: keyof BankAccount) => (event: { currentTarget: HTMLInputElement }) => {
    const value = event.currentTarget.value;
    setDraft((previous) => ({ ...previous, [field]: value }));
  };

  const clean = { bank: draft.bank.trim(), account_no: draft.account_no.trim(), holder: draft.holder.trim() };
  const valid = clean.bank.length >= 2 && /^[0-9][0-9 .-]{3,28}[0-9]$/.test(clean.account_no) && clean.holder.length >= 2;
  const dirty = clean.bank !== (bank?.bank ?? '') || clean.account_no !== (bank?.account_no ?? '') || clean.holder !== (bank?.holder ?? '');

  const save = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.walletSaveBank(clean);
      toast('Rekening tujuan disimpan.');
      onDone();
    } catch (cause) {
      toast(describe(cause));
    }
    setBusy(false);
  };

  return (
    <form class="panel" onSubmit={(event) => void save(event)}>
      <h2>Rekening tujuan</h2>
      <label class="field">
        <span>Bank atau e-wallet</span>
        <input type="text" maxLength={40} value={draft.bank} placeholder="BCA" onInput={set('bank')} />
      </label>
      <label class="field">
        <span>Nomor rekening</span>
        <input
          type="text"
          inputMode="numeric"
          maxLength={30}
          value={draft.account_no}
          onInput={set('account_no')}
        />
        {draft.account_no.trim() !== '' && !/^[0-9][0-9 .-]{3,28}[0-9]$/.test(clean.account_no) && (
          <small class="hint">Hanya angka (boleh dengan spasi, titik, atau strip), 5 sampai 30 karakter.</small>
        )}
      </label>
      <label class="field">
        <span>Atas nama</span>
        <input type="text" maxLength={80} value={draft.holder} onInput={set('holder')} />
      </label>
      <p class="hint">Periksa lagi sebelum menyimpan: transfer dilakukan persis ke rekening ini.</p>
      <div class="row">
        <button class="btn small primary" disabled={busy || !dirty || !valid}>
          {busy ? 'Menyimpan…' : dirty ? 'Simpan rekening' : 'Tersimpan'}
        </button>
      </div>
    </form>
  );
}
