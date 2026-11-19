import { useEffect, useState } from 'preact/hooks';
import { addDays } from '../lib/cloud/shared';
import { formatRupiah } from '../lib/settings';
import { Overlay, toast } from '../ui/components';
import { newTempPassword, type AdminApi, type FranchiseRow, type MemberRow, type SubscriptionState } from './api';
import type { AdminPageProps } from './Dashboard';
import { addMonths, extendFrom } from './stats';
import { LoadState, PageHead, ago, dateOnly, dateTime, describe, useLoad } from './ui';

const STATE_LABEL: Record<SubscriptionState, string> = { active: 'Aktif', grace: 'Masa tenggang', expired: 'Langganan berakhir', suspended: 'Dihentikan' };
const STATE_TAG: Record<SubscriptionState, string> = { active: 'ok', grace: 'warn', expired: 'err', suspended: 'err' };

/** A password to hand over, shown once so the platform owner can pass it on. */
interface Handover {
  email: string;
  password: string;
}

/** The platform owner's list of franchises: who they are, whether they have paid, and how their booths are doing. */
export function Franchises({ admin, current, open, changed }: AdminPageProps) {
  const load = useLoad(() => admin.listFranchises(), [admin]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [handover, setHandover] = useState<Handover | null>(null);
  const rows = load.data?.franchises ?? [];
  const today = load.data?.today ?? new Date().toISOString().slice(0, 10);

  const add = async (event: Event) => {
    event.preventDefault();
    const wanted = name.trim();
    const adminEmail = email.trim();
    if (!wanted) return;
    setBusy(true);
    try {
      // A new franchise starts with one month, counted from today.
      const id = await admin.saveFranchise({ id: null, name: wanted, active: true, paid_until: addMonths(today, 1), note: '' });
      if (adminEmail) {
        const password = newTempPassword();
        try {
          await admin.addMember(id, adminEmail, password);
          setHandover({ email: adminEmail, password });
        } catch (cause) {
          toast(`Franchise dibuat, tetapi akun adminnya gagal: ${describe(cause)}`);
        }
      } else {
        toast('Franchise dibuat. Tambahkan akun adminnya lewat tombol Atur.');
      }
      setName('');
      setEmail('');
      setEditing(id);
      load.reload();
    } catch (cause) {
      toast(describe(cause));
    }
    setBusy(false);
  };

  return (
    <>
      <PageHead title="Franchise" lead="Semua franchise di platform ini: langganan, akun admin, dan keadaan booth-nya.">
        <button class="btn small" onClick={load.reload}>
          {load.loading ? 'Memuat…' : 'Muat ulang'}
        </button>
      </PageHead>

      {load.data && (
        <div class="tiles">
          <div class="tile">
            <span>Franchise berjalan</span>
            <b>{rows.filter((row) => row.state === 'active' || row.state === 'grace').length}</b>
            <small>dari {rows.length} franchise</small>
          </div>
          <div class="tile">
            <span>Tablet online</span>
            <b>{rows.reduce((sum, row) => sum + row.devices_online, 0)}</b>
            <small>dari {rows.reduce((sum, row) => sum + row.devices, 0)} tablet</small>
          </div>
          <div class="tile">
            <span>Sesi 30 hari</span>
            <b>{rows.reduce((sum, row) => sum + row.sessions_30d, 0).toLocaleString('id-ID')}</b>
            <small>semua franchise</small>
          </div>
          <div class="tile">
            <span>Uang diterima 30 hari</span>
            <b>{formatRupiah(rows.reduce((sum, row) => sum + row.revenue_30d, 0))}</b>
            <small>masuk ke masing-masing franchise</small>
          </div>
        </div>
      )}

      <form class="panel" onSubmit={(event) => void add(event)}>
        <h2>Tambah franchise</h2>
        <div class="filters">
          <label class="field">
            <span>Nama franchise</span>
            <input type="text" maxLength={80} value={name} placeholder="Booth Budi" onInput={(event) => setName(event.currentTarget.value)} />
          </label>
          <label class="field">
            <span>Email admin (boleh diisi nanti)</span>
            <input type="email" maxLength={200} value={email} placeholder="budi@contoh.id" onInput={(event) => setEmail(event.currentTarget.value)} />
          </label>
        </div>
        <p class="hint">Langganan langsung berjalan satu bulan dari hari ini. Password sementara untuk adminnya dibuatkan dan ditampilkan sekali.</p>
        <div class="row">
          <button class="btn small primary" disabled={busy || !name.trim()}>
            + Tambah franchise
          </button>
        </div>
      </form>

      <LoadState load={load} />
      {load.data && rows.length === 0 && <p class="hint">Belum ada franchise. Buat yang pertama di atas, misalnya untuk booth milikmu sendiri.</p>}

      <div class="admin-grid">
        {rows.map((row) => (
          <section class={`panel ${editing === row.id ? 'span' : ''}`} key={row.id}>
            <div class="row">
              <h2 class="grow">{row.name}</h2>
              {current?.id === row.id && <span class="tag">Sedang dibuka</span>}
              <span class={`tag ${STATE_TAG[row.state]}`}>{STATE_LABEL[row.state]}</span>
            </div>
            <dl class="facts">
              <div>
                <dt>Langganan sampai</dt>
                <dd>{row.paid_until ? dateOnly(row.paid_until) : 'Tanpa batas'}</dd>
              </div>
              <div>
                <dt>Tablet</dt>
                <dd>
                  {row.devices_online} online dari {row.devices}
                </dd>
              </div>
              <div>
                <dt>30 hari terakhir</dt>
                <dd>
                  {row.sessions_30d.toLocaleString('id-ID')} sesi · {formatRupiah(row.revenue_30d)}
                </dd>
              </div>
              <div>
                <dt>Terakhir aktif</dt>
                <dd>{ago(row.last_seen_at, Date.now())}</dd>
              </div>
            </dl>
            {row.note && <p class="hint">Catatan: {row.note}</p>}
            <div class="row">
              <button class="btn small primary" onClick={() => open({ id: row.id, name: row.name })}>
                Buka dashboard-nya
              </button>
              <button class="btn small" onClick={() => setEditing(editing === row.id ? null : row.id)}>
                {editing === row.id ? 'Tutup' : `Atur · ${row.members} admin franchise`}
              </button>
            </div>
            {editing === row.id && (
              <FranchiseEditor
                admin={admin}
                row={row}
                today={today}
                graceDays={load.data?.graceDays ?? 7}
                onSaved={(next) => {
                  changed(next, row.id);
                  load.reload();
                }}
                onDeleted={() => {
                  changed(null, row.id);
                  setEditing(null);
                  load.reload();
                }}
                onHandover={setHandover}
              />
            )}
          </section>
        ))}
      </div>

      {handover && (
        <Overlay>
          <div class="card dialog">
            <h2 class="heading small">Password sementara</h2>
            <p class="lead">Berikan ke admin franchise. Saat pertama masuk, ia diminta membuat password sendiri.</p>
            <dl class="facts">
              <div>
                <dt>Email</dt>
                <dd>{handover.email}</dd>
              </div>
              <div>
                <dt>Password</dt>
                <dd class="mono">{handover.password}</dd>
              </div>
            </dl>
            <p class="hint">Password ini tidak bisa ditampilkan lagi setelah jendela ini ditutup. Kalau hilang, buat password baru.</p>
            <div class="row center">
              <button
                class="btn small"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(`Email: ${handover.email}\nPassword sementara: ${handover.password}`)
                    .then(() => toast('Disalin.'))
                    .catch(() => toast('Browser tidak mengizinkan menyalin.'))
                }
              >
                Salin
              </button>
              <button class="btn small primary" onClick={() => setHandover(null)}>
                Sudah kucatat
              </button>
            </div>
          </div>
        </Overlay>
      )}
    </>
  );
}

function FranchiseEditor(props: {
  admin: AdminApi;
  row: FranchiseRow;
  today: string;
  graceDays: number;
  onSaved: (next: { id: string; name: string }) => void;
  onDeleted: () => void;
  onHandover: (handover: Handover) => void;
}) {
  const { admin, row, today } = props;
  const [name, setName] = useState(row.name);
  const [paidUntil, setPaidUntil] = useState(row.paid_until ?? '');
  const [active, setActive] = useState(row.active);
  const [note, setNote] = useState(row.note ?? '');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  // The account whose Hapus button was pressed once; a second press removes it.
  const [confirmRemove, setConfirmRemove] = useState('');
  const members = useLoad(() => admin.listMembers(row.id), [admin, row.id]);

  useEffect(() => {
    setName(row.name);
    setPaidUntil(row.paid_until ?? '');
    setActive(row.active);
    setNote(row.note ?? '');
  }, [row.name, row.paid_until, row.active, row.note]);

  const dirty = name.trim() !== row.name || paidUntil !== (row.paid_until ?? '') || active !== row.active || note.trim() !== (row.note ?? '');

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await action();
      if (done) toast(done);
    } catch (cause) {
      toast(describe(cause));
    }
    setBusy(false);
  };

  const save = () =>
    run(async () => {
      await admin.saveFranchise({ id: row.id, name: name.trim(), active, paid_until: paidUntil || null, note: note.trim() });
      props.onSaved({ id: row.id, name: name.trim() });
    }, 'Disimpan. Tablet mengikutinya dalam satu-dua menit.');

  const addMember = (event: Event) => {
    event.preventDefault();
    const wanted = email.trim();
    if (!wanted) return;
    const password = newTempPassword();
    void run(async () => {
      await admin.addMember(row.id, wanted, password);
      props.onHandover({ email: wanted, password });
      setEmail('');
      members.reload();
      props.onSaved({ id: row.id, name: row.name });
    }, '');
  };

  const resetPassword = (member: MemberRow) => {
    const password = newTempPassword();
    void run(async () => {
      await admin.setMemberPassword(member.user_id, password);
      props.onHandover({ email: member.email, password });
      members.reload();
    }, '');
  };

  const stopsOn = paidUntil ? addDays(paidUntil, props.graceDays) : '';

  return (
    <div class="admin-grid" style={{ margin: 0 }}>
      <div class="panel" style={{ boxShadow: 'none' }}>
        <h2>Langganan</h2>
        <label class="field">
          <span>Nama franchise</span>
          <input type="text" maxLength={80} value={name} onInput={(event) => setName(event.currentTarget.value)} />
        </label>
        <label class="field">
          <span>Berlaku sampai (termasuk tanggal ini)</span>
          <input type="date" value={paidUntil} onChange={(event) => setPaidUntil(event.currentTarget.value)} />
          <small class="hint">
            {paidUntil
              ? `Setelah tanggal itu booth masih jalan ${props.graceDays} hari (sampai ${dateOnly(stopsOn)}), lalu berhenti menerima tamu.`
              : 'Kosong berarti tanpa batas, misalnya untuk booth milikmu sendiri.'}
          </small>
        </label>
        <div class="chips tight">
          {[1, 3, 12].map((months) => (
            <button key={months} type="button" class="chip" onClick={() => setPaidUntil(extendFrom(paidUntil || null, today, months))}>
              + {months === 12 ? '1 tahun' : `${months} bulan`}
            </button>
          ))}
          <button type="button" class="chip" onClick={() => setPaidUntil('')}>
            Tanpa batas
          </button>
        </div>
        <label class="check">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.currentTarget.checked)} />
          <span>
            Franchise aktif
            <small>Matikan untuk menghentikan semua booth franchise ini, apa pun tanggal langganannya.</small>
          </span>
        </label>
        <label class="field">
          <span>Catatan (hanya kamu yang melihat)</span>
          <input type="text" maxLength={300} value={note} placeholder="Misalnya: transfer tiap tanggal 5" onInput={(event) => setNote(event.currentTarget.value)} />
        </label>
        <div class="row">
          <button class="btn small primary" disabled={busy || !dirty || !name.trim()} onClick={() => void save()}>
            {dirty ? 'Simpan' : 'Tersimpan'}
          </button>
        </div>
      </div>

      <div class="panel" style={{ boxShadow: 'none' }}>
        <h2>Akun admin franchise</h2>
        <p class="hint">Akun yang hanya bisa membuka franchise ini. Kamu sebagai superadmin tidak dihitung di sini.</p>
        <LoadState load={members} />
        {members.data?.length === 0 && <p class="hint">Belum ada. Tanpa akun admin, hanya superadmin yang bisa mengatur franchise ini.</p>}
        {members.data?.map((member) => (
          <div class="member" key={member.user_id}>
            <div>
              <b>{member.email}</b>
              <small class="hint">
                {member.last_sign_in_at ? `Terakhir masuk ${dateTime(member.last_sign_in_at)}` : 'Belum pernah masuk'}
                {member.must_change_password ? ' · masih memakai password sementara' : ''}
              </small>
            </div>
            <div class="row">
              <button class="btn small" disabled={busy} onClick={() => resetPassword(member)}>
                Password baru
              </button>
              <button
                class="btn small danger"
                disabled={busy}
                onClick={() => {
                  if (confirmRemove !== member.user_id) return setConfirmRemove(member.user_id);
                  void run(async () => {
                    await admin.removeMember(member.user_id);
                    setConfirmRemove('');
                    members.reload();
                    props.onSaved({ id: row.id, name: row.name });
                  }, `Akun ${member.email} dihapus.`);
                }}
              >
                {confirmRemove === member.user_id ? 'Yakin hapus?' : 'Hapus'}
              </button>
            </div>
          </div>
        ))}
        <form class="row" onSubmit={addMember}>
          <label class="field grow">
            <span>Tambah admin (email)</span>
            <input type="email" maxLength={200} value={email} placeholder="nama@contoh.id" onInput={(event) => setEmail(event.currentTarget.value)} />
          </label>
          <button class="btn small" disabled={busy || !email.trim()} style={{ alignSelf: 'flex-end' }}>
            + Tambah
          </button>
        </form>
      </div>

      <div class="panel span" style={{ boxShadow: 'none' }}>
        <h2>Hapus franchise</h2>
        <p class="hint">
          Menghapus <b>{row.name}</b> beserta semua tablet, transaksi, voucher, frame dan akun adminnya. Tidak bisa dibatalkan. Untuk
          menghentikan sementara, matikan "Franchise aktif" saja.
        </p>
        <div class="row">
          <label class="field grow">
            <span>Ketik nama franchise untuk menghapus</span>
            <input type="text" value={confirmDelete} placeholder={row.name} onInput={(event) => setConfirmDelete(event.currentTarget.value)} />
          </label>
          <button
            class="btn small danger"
            style={{ alignSelf: 'flex-end' }}
            disabled={busy || confirmDelete.trim() !== row.name}
            onClick={() =>
              void run(async () => {
                await admin.deleteFranchise(row.id);
                props.onDeleted();
              }, `Franchise ${row.name} dihapus.`)
            }
          >
            Hapus selamanya
          </button>
        </div>
      </div>
    </div>
  );
}
