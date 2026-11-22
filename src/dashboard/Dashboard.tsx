import './dashboard.css';
import './theme.css';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { cloudConfigured, DEFAULT_PLATFORM } from '../lib/cloud/shared';
import { useStore } from '../lib/store';
import { applyUpdate, updateReady } from '../lib/update';
import { ToastHost } from '../ui/components';
import { BoothIcon, GalleryIcon, HistoryIcon, HomeIcon, LayersIcon, ScanIcon, SlidersIcon, StoreIcon, TicketIcon } from '../ui/icons';
import {
  changeOwnPassword,
  NOT_FOUND,
  createSupabaseAdminApi,
  createSupabaseApi,
  getClient,
  loadAccount,
  type Account,
  type AdminApi,
  type Franchise,
  type FranchiseStatus,
  type OwnerApi,
} from './api';
import { createDemo } from './demo';
import { Devices } from './Devices';
import { FrameSets } from './FrameSets';
import { Franchises } from './Franchises';
import { Overview } from './Overview';
import { OutletSettings } from './OutletSettings';
import { Payments } from './Payments';
import { PlatformSettings } from './PlatformSettings';
import { Transactions } from './Transactions';
import { dateOnly, describe, useDismiss, useLoad } from './ui';
import { Vouchers } from './Vouchers';

/** Pages about one franchise. The platform owner picks which franchise they look at. */
const FRANCHISE_PAGES = [
  { id: 'ringkasan', label: 'Beranda', icon: HomeIcon, view: Overview },
  { id: 'perangkat', label: 'Booth Saya', icon: BoothIcon, view: Devices },
  { id: 'transaksi', label: 'Riwayat Sesi', icon: HistoryIcon, view: Transactions },
  { id: 'pembayaran', label: 'Kasir QRIS', icon: ScanIcon, view: Payments },
  { id: 'voucher', label: 'Kode Promo', icon: TicketIcon, view: Vouchers },
  { id: 'frame', label: 'Galeri Frame', icon: GalleryIcon, view: FrameSets },
  { id: 'pengaturan', label: 'Pengaturan', icon: SlidersIcon, view: OutletSettings },
] as const;

/** Pages only the platform owner has. */
const ADMIN_PAGES = [
  { id: 'franchise', label: 'Franchise', icon: StoreIcon, view: Franchises },
  { id: 'platform', label: 'Pengaturan platform', icon: LayersIcon, view: PlatformSettings },
] as const;

export type PageId = (typeof FRANCHISE_PAGES)[number]['id'] | (typeof ADMIN_PAGES)[number]['id'];
export interface PageProps {
  api: OwnerApi;
  go: (page: PageId) => void;
}
export interface AdminPageProps {
  admin: AdminApi;
  go: (page: PageId) => void;
  /** The franchise whose pages are open, if any. */
  current: Franchise | null;
  /** Opens a franchise's own pages, as its admin sees them. */
  open: (franchise: Franchise, page?: PageId) => void;
  /** Called after a franchise was renamed or deleted, so the menu follows. */
  changed: (franchise: Franchise | null, id: string) => void;
}

type Phase = 'loading' | 'setup' | 'login' | 'denied' | 'ready';

const CHOSEN_KEY = 'dashboard.franchise';

function pageFromHash(): PageId | null {
  const wanted = location.hash.split('/')[1];
  return [...FRANCHISE_PAGES, ...ADMIN_PAGES].find((page) => page.id === wanted)?.id ?? null;
}

function savedChoice(): Franchise | null {
  try {
    const saved = JSON.parse(localStorage.getItem(CHOSEN_KEY) ?? 'null') as Partial<Franchise> | null;
    return saved && typeof saved.id === 'string' && typeof saved.name === 'string' ? { id: saved.id, name: saved.name } : null;
  } catch {
    return null;
  }
}

/** The dashboard: a franchise's sales, devices, vouchers and settings; and for the platform owner, every franchise. */
export function Dashboard() {
  const [demo, setDemo] = useState(() => new URLSearchParams(location.search).has('demo') && !cloudConfigured);
  const [phase, setPhase] = useState<Phase>('loading');
  const [account, setAccount] = useState<Account | null>(null);
  // The franchise the platform owner is looking at. A franchise admin always sees their own.
  const [chosen, setChosen] = useState<Franchise | null>(savedChoice);
  const [page, setPage] = useState<PageId | null>(pageFromHash);
  const [platformName, setPlatformName] = useState(DEFAULT_PLATFORM.name);
  const hasUpdate = useStore(updateReady);
  // undefined = not checked yet, so that "nobody signed in" (null) still shows the login form.
  const signedInAs = useRef<string | null | undefined>(undefined);
  const demoData = useMemo(() => (demo ? createDemo() : null), [demo]);

  useEffect(() => {
    if (demoData) {
      setAccount(demoData.account);
      setPhase('ready');
      return;
    }
    if (!cloudConfigured) {
      setPhase('setup');
      return;
    }
    const db = getClient();
    const check = async (userId: string | null, email: string) => {
      if (userId === signedInAs.current) return;
      signedInAs.current = userId;
      if (!userId) {
        setAccount(null);
        setPhase('login');
        return;
      }
      try {
        const me = await loadAccount(db, email);
        setAccount(me);
        setPhase(me.superadmin || me.franchise ? 'ready' : 'denied');
      } catch {
        setPhase('denied');
      }
    };
    void db.auth.getSession().then(({ data }) => check(data.session?.user.id ?? null, data.session?.user.email ?? ''));
    // Deferred: Supabase must not be called from inside its own auth callback.
    const { data } = db.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => void check(session?.user.id ?? null, session?.user.email ?? ''), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [demoData]);

  const franchise = account?.superadmin ? chosen : (account?.franchise ?? null);
  const admin = useMemo<AdminApi | null>(
    () => (!account?.superadmin ? null : demoData ? demoData.admin : createSupabaseAdminApi(getClient())),
    [account, demoData],
  );
  const api = useMemo<OwnerApi | null>(() => {
    if (!account || !franchise) return null;
    return demoData ? demoData.apiFor(franchise) : createSupabaseApi(getClient(), account, franchise);
  }, [account, franchise?.id, franchise?.name, demoData]);

  const forget = () => {
    setChosen(null);
    try {
      localStorage.removeItem(CHOSEN_KEY);
    } catch {
      // Nothing was remembered.
    }
  };

  // The platform's name heads the menu; it is the owner's to change.
  useEffect(() => {
    const source = admin ?? api;
    if (!source) return;
    void source
      .getPlatform()
      .then((platform) => setPlatformName(platform.name))
      .catch(() => undefined);
  }, [admin, api]);

  // The browser tab says whose dashboard this is.
  useEffect(() => {
    document.title = franchise ? `${franchise.name} · ${platformName}` : `Dashboard · ${platformName}`;
  }, [franchise?.name, platformName]);

  const status = useLoad<FranchiseStatus | null>(async () => {
    if (!api) return null;
    try {
      return await api.status();
    } catch (cause) {
      // The franchise the platform owner had open was deleted meanwhile: back to the list.
      if (admin && cause instanceof Error && cause.message === NOT_FOUND) forget();
      throw cause;
    }
  }, [api]);

  // Typed addresses and the browser's back button change the page too.
  useEffect(() => {
    const follow = () => setPage(pageFromHash());
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  // On a phone the menu swipes sideways; keep the current page's entry in view.
  useEffect(() => {
    document.querySelector('.dash-links .on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [page, phase]);

  const go = (next: PageId) => {
    history.replaceState(null, '', `#dashboard/${next}`);
    // A new version is picked up between pages, where no form is half filled in.
    if (hasUpdate) {
      applyUpdate();
      return;
    }
    setPage(next);
    window.scrollTo(0, 0);
  };

  const choose = (next: Franchise | null) => {
    setChosen(next);
    try {
      if (next) localStorage.setItem(CHOSEN_KEY, JSON.stringify(next));
      else localStorage.removeItem(CHOSEN_KEY);
    } catch {
      // Remembered only where the browser allows it.
    }
  };

  if (phase === 'loading') {
    return (
      <div class="dash-gate">
        <div class="spinner" />
      </div>
    );
  }

  if (phase === 'setup') {
    return (
      <div class="dash-gate">
        <section class="panel">
          <span class="pill">Dashboard</span>
          <h1 class="heading small">Belum tersambung ke Supabase</h1>
          <p class="hint">
            Dashboard membaca data dari proyek Supabase. Isi <b class="mono">VITE_SUPABASE_URL</b> dan{' '}
            <b class="mono">VITE_SUPABASE_ANON_KEY</b> di Vercel (atau di berkas <b class="mono">.env.local</b>), jalankan{' '}
            <b class="mono">supabase/schema.sql</b> di SQL Editor Supabase, lalu deploy ulang.
          </p>
          <div class="row">
            <button class="btn small primary" onClick={() => setDemo(true)}>
              Lihat dengan data contoh
            </button>
            <a class="btn small" href="./">
              Ke layar booth
            </a>
          </div>
        </section>
      </div>
    );
  }

  if (phase === 'login') return <Login />;

  if (phase === 'denied' || !account) {
    return (
      <div class="dash-gate">
        <section class="panel">
          <h1 class="heading small">Akun ini belum terdaftar</h1>
          <p class="hint">Akun yang baru masuk belum menjadi admin franchise mana pun. Minta pemilik platform menambahkannya.</p>
          <button class="btn small" onClick={() => void getClient().auth.signOut()}>
            Keluar
          </button>
        </section>
      </div>
    );
  }

  if (account.mustChangePassword && !demoData) {
    return <NewPassword email={account.email} onDone={() => setAccount({ ...account, mustChangePassword: false })} />;
  }

  // Without a franchise picked, the platform owner starts at the list of franchises.
  const fallback: PageId = admin && !franchise ? 'franchise' : 'ringkasan';
  const wanted = page ?? fallback;
  const adminPage = ADMIN_PAGES.find((entry) => entry.id === wanted);
  const franchisePage = FRANCHISE_PAGES.find((entry) => entry.id === wanted);
  const current: PageId = adminPage && !admin ? 'ringkasan' : wanted;

  const signOut = () => {
    if (demoData) location.assign('./#dashboard');
    else void getClient().auth.signOut();
  };

  return (
    <div class="dash">
      <nav class="dash-nav">
        <div class="dash-brand">
          <b>{platformName}</b>
          <span class="pill">{admin ? 'Superadmin' : 'Dashboard'}</span>
        </div>
        <div class="dash-links">
          {admin && (
            <>
              <span class="dash-group">Platform</span>
              {ADMIN_PAGES.map((entry) => (
                <button key={entry.id} class={entry.id === current ? 'on' : ''} onClick={() => go(entry.id)}>
                  <entry.icon />
                  {entry.label}
                </button>
              ))}
            </>
          )}
          {franchise && (
            <>
              <span class="dash-group" title={franchise.name}>
                {franchise.name}
              </span>
              {FRANCHISE_PAGES.map((entry) => (
                <button key={entry.id} class={entry.id === current ? 'on' : ''} onClick={() => go(entry.id)}>
                  <entry.icon />
                  {entry.label}
                </button>
              ))}
            </>
          )}
        </div>
      </nav>
      <main class="dash-main">
        <header class="dash-top">
          <div class="dash-crumb">
            <span>{adminPage && admin ? 'Platform' : (franchise?.name ?? 'Platform')}</span>
            <span>{(adminPage ?? franchisePage ?? FRANCHISE_PAGES[0]).label}</span>
          </div>
          <AccountMenu email={account.email} leave={demoData ? 'Tutup contoh' : 'Keluar'} onLeave={signOut} />
        </header>
        {demoData && <p class="banner">Ini data contoh. Tidak ada yang tersimpan, dan semuanya kembali seperti semula saat halaman dimuat ulang.</p>}
        {adminPage && admin ? (
          <adminPage.view
            key={adminPage.id}
            admin={admin}
            go={go}
            current={franchise}
            open={(next, to = 'ringkasan') => {
              choose(next);
              go(to);
            }}
            changed={(next, id) => {
              if (franchise?.id === id) choose(next);
            }}
          />
        ) : api && franchise ? (
          <>
            {admin && (
              <p class="banner">
                Kamu melihat franchise <b>{franchise.name}</b> sebagai superadmin.{' '}
                <button class="link" onClick={() => go('franchise')}>
                  Ganti franchise
                </button>
              </p>
            )}
            <SubscriptionBanner status={status.data} superadmin={admin !== null} />
            {(() => {
              const View = (franchisePage ?? FRANCHISE_PAGES[0]).view;
              return <View key={`${franchise.id}:${current}`} api={api} go={go} />;
            })()}
          </>
        ) : (
          <section class="panel">
            <h2>Pilih franchise dulu</h2>
            <p class="hint">Halaman ini menampilkan data satu franchise. Buka daftar franchise, lalu pilih yang ingin dilihat.</p>
            <div class="row">
              <button class="btn small primary" onClick={() => go('franchise')}>
                Ke daftar franchise
              </button>
            </div>
          </section>
        )}
      </main>
      <ToastHost />
    </div>
  );
}

/** The signed-in account at the top right: its initial, opening to the email address and the way out. */
function AccountMenu({ email, leave, onLeave }: { email: string; leave: string; onLeave: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  return (
    <div class="dash-account" ref={box}>
      <button class="dash-avatar" aria-expanded={open} aria-label={`Akun ${email}`} title={email} onClick={() => setOpen(!open)}>
        {(email.trim()[0] ?? '?').toUpperCase()}
      </button>
      {open && (
        <div class="dash-account-menu">
          <span class="hint">Masuk sebagai</span>
          <b>{email}</b>
          <button class="btn small" onClick={onLeave}>
            {leave}
          </button>
        </div>
      )}
    </div>
  );
}

/** Tells the franchise when its subscription needs attention. Nothing while all is well. */
function SubscriptionBanner({ status, superadmin }: { status: FranchiseStatus | null; superadmin: boolean }) {
  if (!status || status.state === 'active') {
    // A week's notice before the paid date, so it never comes as a surprise.
    if (!status?.paid_until) return null;
    const daysLeft = Math.round((Date.parse(status.paid_until) - Date.parse(status.today)) / 86_400_000);
    if (daysLeft > 7) return null;
    return (
      <p class="banner">
        Langganan berlaku sampai <b>{dateOnly(status.paid_until)}</b> ({daysLeft === 0 ? 'hari ini' : `${daysLeft} hari lagi`}).
        {superadmin ? ' Perpanjang di menu Franchise.' : ' Hubungi pemilik platform untuk memperpanjang.'}
      </p>
    );
  }
  const stopsOn = status.paid_until ? new Date(Date.parse(status.paid_until) + status.grace_days * 86_400_000).toISOString() : null;
  const text =
    status.state === 'grace'
      ? `Langganan berakhir pada ${dateOnly(status.paid_until)}. Booth masih berjalan sampai ${dateOnly(stopsOn)}, lalu berhenti menerima tamu.`
      : status.state === 'expired'
        ? `Langganan berakhir pada ${dateOnly(status.paid_until)} dan masa tenggangnya sudah habis. Booth tidak menerima tamu sampai langganan diperpanjang.`
        : 'Franchise ini sedang dihentikan oleh pemilik platform. Booth tidak menerima tamu.';
  return (
    <p class={`banner ${status.state === 'grace' ? '' : 'err'}`}>
      {text}
      {superadmin ? ' Atur di menu Franchise.' : ' Hubungi pemilik platform.'}
    </p>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { error: problem } = await getClient().auth.signInWithPassword({ email: email.trim(), password });
      if (problem) setError(/invalid login/i.test(problem.message) ? 'Email atau password salah.' : describe(problem));
    } catch (cause) {
      setError(describe(cause));
    }
    setBusy(false);
  };

  return (
    <div class="dash-gate">
      <form class="panel" onSubmit={(event) => void submit(event)}>
        <span class="pill">Dashboard</span>
        <h1 class="heading small">Masuk</h1>
        <label class="field">
          <span>Email</span>
          <input type="email" autocomplete="username" required value={email} onInput={(event) => setEmail(event.currentTarget.value)} />
        </label>
        <label class="field">
          <span>Password</span>
          <input
            type="password"
            autocomplete="current-password"
            required
            value={password}
            onInput={(event) => setPassword(event.currentTarget.value)}
          />
        </label>
        {error && <p class="banner err">{error}</p>}
        <button class="btn small primary" disabled={busy}>
          {busy ? 'Memeriksa…' : 'Masuk'}
        </button>
        <p class="hint">Akun admin franchise dibuatkan oleh pemilik platform. Lupa password? Minta password baru ke pemilik platform.</p>
      </form>
    </div>
  );
}

/** First sign-in with the password the platform owner handed over: the admin chooses their own before going on. */
function NewPassword({ email, onDone }: { email: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: Event) => {
    event.preventDefault();
    if (password.length < 8) return setError('Password minimal 8 karakter.');
    if (password !== again) return setError('Kedua password tidak sama.');
    setBusy(true);
    setError('');
    try {
      await changeOwnPassword(getClient(), password);
      onDone();
    } catch (cause) {
      setError(describe(cause));
    }
    setBusy(false);
  };

  return (
    <div class="dash-gate">
      <form class="panel" onSubmit={(event) => void submit(event)}>
        <span class="pill">Selamat datang</span>
        <h1 class="heading small">Buat password sendiri</h1>
        <p class="hint">
          Kamu masuk sebagai <b>{email}</b> dengan password sementara. Ganti dengan password yang hanya kamu yang tahu.
        </p>
        <label class="field">
          <span>Password baru (minimal 8 karakter)</span>
          <input type="password" autocomplete="new-password" required value={password} onInput={(event) => setPassword(event.currentTarget.value)} />
        </label>
        <label class="field">
          <span>Ulangi password baru</span>
          <input type="password" autocomplete="new-password" required value={again} onInput={(event) => setAgain(event.currentTarget.value)} />
        </label>
        {error && <p class="banner err">{error}</p>}
        <div class="row">
          <button class="btn small primary" disabled={busy}>
            {busy ? 'Menyimpan…' : 'Simpan dan lanjut'}
          </button>
          <button type="button" class="link" onClick={() => void getClient().auth.signOut()}>
            Keluar
          </button>
        </div>
      </form>
    </div>
  );
}
