import { useState } from 'preact/hooks';
import { appLinks, financeHandoverText } from '../lib/cloud/shared';
import { formatRupiah } from '../lib/settings';
import { toast } from '../ui/components';
import { newTempPassword, type AdminApi, type Franchise, type MemberRow, type PayoutApi, type PayoutRow } from './api';
import type { AdminPageProps } from './Dashboard';
import { HandoverDialog, type Handover } from './Handover';
import { CopyButton, LoadState, PageHead, Tile, dateTime, describe, useLoad } from './ui';
import { PayoutTable } from './Wallet';

/** The payouts page in the platform owner's menu: the same work finance staff do, plus who those staff are. */
export function PayoutsPage({ admin, open, recount }: AdminPageProps) {
  return <Payouts api={admin} admin={admin} open={(franchise) => open(franchise, 'dompet')} onSettled={recount} />;
}

/**
 * Payout requests of titip saldo franchises to transfer by hand, and what every
 * wallet holds. Finance staff see exactly this and nothing else; the platform
 * owner also gets links into each franchise and the list of finance accounts.
 */
export function Payouts(props: { api: PayoutApi; admin?: AdminApi; open?: (franchise: Franchise) => void; onSettled?: () => void }) {
  const { api, admin, open } = props;
  const load = useLoad(() => api.payoutBoard(), [api]);
  const afterSettle = () => {
    load.reload();
    props.onSettled?.();
  };
  const board = load.data;
  const waiting = board?.requests.filter((row) => row.status === 'requested') ?? [];
  const settled = board?.requests.filter((row) => row.status !== 'requested') ?? [];

  return (
    <>
      <PageHead
        title="Pencairan"
        lead="Franchise titip saldo mengajukan pencairan dari menu Dompet. Transfer manual dari rekening platform, lalu tandai di sini; pencatatannya mengikuti sendiri."
      >
        <button class="btn small" onClick={load.reload}>
          {load.loading ? 'Memuat…' : 'Muat ulang'}
        </button>
      </PageHead>

      <LoadState load={load} />

      {board && (
        <>
          <div class="tiles">
            <Tile
              label="Menunggu ditransfer"
              value={formatRupiah(waiting.reduce((sum, row) => sum + row.amount, 0))}
              note={waiting.length === 0 ? 'tidak ada pengajuan' : `${waiting.length} pengajuan`}
            />
            <Tile label="Uang franchise di platform" value={formatRupiah(board.held)} note="saldo yang belum dicairkan" />
            <Tile label="Biaya platform" value={formatRupiah(board.platform_fees)} note="pendapatan dari titip saldo" />
            <Tile label="Biaya DOKU" value={formatRupiah(board.doku_fees)} note="dipotong DOKU dari QRIS titipan" />
          </div>

          <section class={`panel ${load.loading ? 'busy' : ''}`}>
            <h2>Menunggu ditransfer</h2>
            {waiting.length === 0 && <p class="hint">Tidak ada pengajuan yang menunggu.</p>}
            {waiting.map((row) => (
              <Request key={row.id} api={api} row={row} onDone={afterSettle} />
            ))}
          </section>

          <section class={`panel ${load.loading ? 'busy' : ''}`}>
            <h2>Saldo tiap franchise</h2>
            {board.wallets.length === 0 ? (
              <p class="hint">
                Belum ada franchise yang memakai titip saldo.
                {admin && (
                  <>
                    {' '}
                    Nyalakan di menu <b>Franchise</b> → <b>Atur</b> → <b>Titip saldo</b>.
                  </>
                )}
              </p>
            ) : (
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Franchise</th>
                      <th>Titip saldo</th>
                      <th class="num">Saldo tersedia</th>
                      <th class="num">Sedang diajukan</th>
                      <th class="num">Sudah dicairkan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.wallets.map((wallet) => (
                      <tr key={wallet.id}>
                        <td>
                          {open ? (
                            <button class="link" onClick={() => open({ id: wallet.id, name: wallet.name })}>
                              {wallet.name}
                            </button>
                          ) : (
                            wallet.name
                          )}
                        </td>
                        <td>
                          <span class={`tag ${wallet.enabled ? 'ok' : ''}`}>{wallet.enabled ? 'Aktif' : 'Dimatikan'}</span>
                        </td>
                        <td class="num">{formatRupiah(wallet.available)}</td>
                        <td class="num">{formatRupiah(wallet.pending)}</td>
                        <td class="num">{formatRupiah(wallet.paid_out)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section class={`panel ${load.loading ? 'busy' : ''}`}>
            <h2>Riwayat pencairan</h2>
            {settled.length === 0 ? <p class="hint">Belum ada pencairan yang selesai.</p> : <PayoutTable rows={settled} withFranchise />}
          </section>
        </>
      )}

      {admin && <FinanceStaff admin={admin} />}
    </>
  );
}

/** For the platform owner only: the accounts that may open this page and nothing else. */
function FinanceStaff({ admin }: { admin: AdminApi }) {
  const load = useLoad(() => admin.listFinance(), [admin]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [handover, setHandover] = useState<Handover | null>(null);
  // The account whose Hapus button was pressed once; a second press removes it.
  const [confirmRemove, setConfirmRemove] = useState('');

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await action();
      if (done) toast(done);
      load.reload();
    } catch (cause) {
      toast(describe(cause));
    }
    setBusy(false);
  };

  const add = (event: Event) => {
    event.preventDefault();
    const wanted = email.trim();
    if (!wanted) return;
    const password = newTempPassword();
    void run(async () => {
      await admin.addFinance(wanted, password);
      setHandover({ email: wanted, password });
      setEmail('');
    }, '');
  };

  const resetPassword = (user: MemberRow) => {
    const password = newTempPassword();
    void run(async () => {
      await admin.setFinancePassword(user.user_id, password);
      setHandover({ email: user.email, password });
    }, '');
  };

  return (
    <section class="panel">
      <h2>Akun keuangan</h2>
      <p class="hint">
        Akun untuk orang yang mengurus pencairan. Ia masuk di <b class="mono">{appLinks().finance}</b> dan hanya melihat halaman ini: tidak
        ada dashboard, transaksi, foto, atau pengaturan franchise mana pun, dan tidak bisa mengubah biaya atau menyalakan titip saldo.
      </p>
      <LoadState load={load} />
      {load.data?.length === 0 && <p class="hint">Belum ada. Selama kosong, hanya kamu (superadmin) yang bisa menandai pencairan.</p>}
      {load.data?.map((user) => (
        <div class="member" key={user.user_id}>
          <div>
            <b>{user.email}</b>
            <small class="hint">
              {user.last_sign_in_at ? `Terakhir masuk ${dateTime(user.last_sign_in_at)}` : 'Belum pernah masuk'}
              {user.must_change_password ? ' · masih memakai password sementara' : ''}
            </small>
          </div>
          <div class="row">
            <button class="btn small" disabled={busy} onClick={() => resetPassword(user)}>
              Password baru
            </button>
            <button
              class="btn small danger"
              disabled={busy}
              onClick={() => {
                if (confirmRemove !== user.user_id) return setConfirmRemove(user.user_id);
                void run(async () => {
                  await admin.removeFinance(user.user_id);
                  setConfirmRemove('');
                }, `Akun ${user.email} dihapus.`);
              }}
            >
              {confirmRemove === user.user_id ? 'Yakin hapus?' : 'Hapus'}
            </button>
          </div>
        </div>
      ))}
      <form class="row" onSubmit={add}>
        <label class="field grow">
          <span>Tambah akun keuangan (email)</span>
          <input type="email" maxLength={200} value={email} placeholder="keuangan@contoh.id" onInput={(event) => setEmail(event.currentTarget.value)} />
        </label>
        <button class="btn small" disabled={busy || !email.trim()} style={{ alignSelf: 'flex-end' }}>
          + Tambah
        </button>
      </form>

      {handover && (
        <HandoverDialog
          handover={handover}
          who="petugas keuangan"
          links={[{ label: 'Halaman keuangan', url: appLinks().finance }]}
          text={financeHandoverText(handover, appLinks())}
          copied="Disalin: email, password, dan tautan halaman keuangan."
          onClose={() => setHandover(null)}
        />
      )}
    </section>
  );
}

/** One open request: where to send how much, and the two ways to close it. */
function Request({ api, row, onDone }: { api: PayoutApi; row: PayoutRow; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // Both buttons ask once more: marking as transferred cannot be taken back from here.
  const [confirm, setConfirm] = useState<'paid' | 'rejected' | null>(null);

  const settle = async (paid: boolean) => {
    const wanted = paid ? 'paid' : 'rejected';
    if (confirm !== wanted) return setConfirm(wanted);
    setBusy(true);
    try {
      await api.settlePayout(row.id, paid, note.trim());
      toast(
        paid
          ? `Pencairan ${formatRupiah(row.amount)} untuk ${row.franchise ?? 'franchise'} ditandai sudah ditransfer.`
          : `Pengajuan ${row.franchise ?? 'franchise'} ditolak. Saldonya kembali tersedia.`,
      );
      onDone();
    } catch (cause) {
      toast(describe(cause));
    }
    setBusy(false);
    setConfirm(null);
  };

  return (
    <div class="payout-request">
      <div class="row">
        <h3 class="grow">{row.franchise}</h3>
        <span class="hint">Diajukan {dateTime(row.requested_at)}</span>
      </div>
      <dl class="facts">
        <div>
          <dt>Jumlah</dt>
          <dd class="code-cell">
            {formatRupiah(row.amount)}
            <CopyButton text={String(row.amount)} label="Salin jumlah" />
          </dd>
        </div>
        <div>
          <dt>Bank</dt>
          <dd>{row.bank.bank}</dd>
        </div>
        <div>
          <dt>Nomor rekening</dt>
          <dd class="mono code-cell">
            {row.bank.account_no}
            <CopyButton text={row.bank.account_no.replace(/\D/g, '')} label="Salin nomor rekening" />
          </dd>
        </div>
        <div>
          <dt>Atas nama</dt>
          <dd>{row.bank.holder}</dd>
        </div>
      </dl>
      <label class="field">
        <span>Catatan untuk franchise (boleh kosong)</span>
        <input
          type="text"
          maxLength={200}
          value={note}
          placeholder="Misalnya nomor referensi transfer, atau alasan ditolak"
          onInput={(event) => setNote(event.currentTarget.value)}
        />
      </label>
      <div class="row">
        <button class="btn small primary" disabled={busy} onClick={() => void settle(true)}>
          {confirm === 'paid' ? `Yakin sudah transfer ${formatRupiah(row.amount)}?` : 'Tandai sudah ditransfer'}
        </button>
        <button class="btn small danger" disabled={busy} onClick={() => void settle(false)}>
          {confirm === 'rejected' ? 'Yakin tolak?' : 'Tolak'}
        </button>
        {confirm && (
          <button class="link" disabled={busy} onClick={() => setConfirm(null)}>
            Batal
          </button>
        )}
      </div>
    </div>
  );
}
