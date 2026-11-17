import './dashboard.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { cloudConfigured } from '../lib/cloud/shared';
import { useStore } from '../lib/store';
import { applyUpdate, updateReady } from '../lib/update';
import { ToastHost } from '../ui/components';
import { createSupabaseApi, getClient, type OwnerApi } from './api';
import { createDemoApi } from './demo';
import { Devices } from './Devices';
import { FrameSets } from './FrameSets';
import { Overview } from './Overview';
import { OutletSettings } from './OutletSettings';
import { Payments } from './Payments';
import { Transactions } from './Transactions';
import { describe } from './ui';
import { Vouchers } from './Vouchers';

const PAGES = [
  { id: 'ringkasan', label: 'Dashboard', view: Overview },
  { id: 'perangkat', label: 'Perangkat', view: Devices },
  { id: 'transaksi', label: 'Transaksi', view: Transactions },
  { id: 'pembayaran', label: 'Pembayaran QRIS', view: Payments },
  { id: 'voucher', label: 'Voucher', view: Vouchers },
  { id: 'frame', label: 'Koleksi Frame', view: FrameSets },
  { id: 'pengaturan', label: 'Pengaturan', view: OutletSettings },
] as const;

export type PageId = (typeof PAGES)[number]['id'];
export interface PageProps {
  api: OwnerApi;
  go: (page: PageId) => void;
}

type Phase = 'loading' | 'setup' | 'login' | 'denied' | 'ready';

function pageFromHash(): PageId {
  const wanted = location.hash.split('/')[1];
  return PAGES.find((page) => page.id === wanted)?.id ?? 'ringkasan';
}

/** The owner's dashboard: every tablet's sales, devices, vouchers and shared settings in one place. */
export function Dashboard() {
  const [demo, setDemo] = useState(() => new URLSearchParams(location.search).has('demo') && !cloudConfigured);
  const [phase, setPhase] = useState<Phase>('loading');
  const [api, setApi] = useState<OwnerApi | null>(null);
  const [page, setPage] = useState<PageId>(pageFromHash);
  const hasUpdate = useStore(updateReady);
  // undefined = not checked yet, so that "nobody signed in" (null) still shows the login form.
  const signedInAs = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (demo) {
      setApi(createDemoApi());
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
        setApi(null);
        setPhase('login');
        return;
      }
      // The first account to sign in becomes the owner; any other account is turned away.
      const { data, error } = await db.rpc('claim_owner');
      if (!error && data === true) {
        setApi(createSupabaseApi(db, email));
        setPhase('ready');
      } else {
        setPhase('denied');
      }
    };
    void db.auth.getSession().then(({ data }) => check(data.session?.user.id ?? null, data.session?.user.email ?? ''));
    // Deferred: Supabase must not be called from inside its own auth callback.
    const { data } = db.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => void check(session?.user.id ?? null, session?.user.email ?? ''), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [demo]);

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
    // A new version is picked up between pages, where no form is half filled in.
    if (hasUpdate) {
      history.replaceState(null, '', `#dashboard/${next}`);
      applyUpdate();
      return;
    }
    history.replaceState(null, '', `#dashboard/${next}`);
    setPage(next);
    window.scrollTo(0, 0);
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
          <span class="pill">Dashboard pemilik</span>
          <h1 class="heading small">Belum tersambung ke Supabase</h1>
          <p class="hint">
            Dashboard membaca data dari proyek Supabase kamu. Isi <b class="mono">VITE_SUPABASE_URL</b> dan{' '}
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

  if (phase === 'denied' || !api) {
    return (
      <div class="dash-gate">
        <section class="panel">
          <h1 class="heading small">Akun ini bukan pemilik</h1>
          <p class="hint">Dashboard ini sudah punya pemilik, dan akun yang baru masuk bukan akun itu.</p>
          <button class="btn small" onClick={() => void getClient().auth.signOut()}>
            Keluar
          </button>
        </section>
      </div>
    );
  }

  const View = PAGES.find((entry) => entry.id === page)!.view;
  return (
    <div class="dash">
      <nav class="dash-nav">
        <div class="dash-brand">
          <b>Foto Struk</b>
          <span class="pill">Dashboard</span>
        </div>
        <div class="dash-links">
          {PAGES.map((entry) => (
            <button key={entry.id} class={entry.id === page ? 'on' : ''} onClick={() => go(entry.id)}>
              {entry.label}
            </button>
          ))}
        </div>
        <div class="dash-user">
          <span class="hint">{api.email}</span>
          <button class="link" onClick={() => (api.demo ? location.assign('./#dashboard') : void api.signOut())}>
            {api.demo ? 'Tutup contoh' : 'Keluar'}
          </button>
        </div>
      </nav>
      <main class="dash-main">
        {api.demo && <p class="banner">Ini data contoh. Tidak ada yang tersimpan, dan semuanya kembali seperti semula saat halaman dimuat ulang.</p>}
        <View key={page} api={api} go={go} />
      </main>
      <ToastHost />
    </div>
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
        <span class="pill">Dashboard pemilik</span>
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
        <p class="hint">Akun pemilik dibuat di Supabase (Authentication → Users → Add user), bukan di sini.</p>
      </form>
    </div>
  );
}
