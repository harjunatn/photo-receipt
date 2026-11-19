import { useEffect, useState } from 'preact/hooks';
import { Check, TextField } from '../admin/fields';
import { toast } from '../ui/components';
import type { DokuFields, DokuState, OwnerApi } from './api';
import { LoadState, dateTime, describe, useLoad } from './ui';

function toPem(label: string, der: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(der)) binary += String.fromCharCode(byte);
  const lines = btoa(binary).match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

/**
 * Makes an RSA key pair in the browser, the kind DOKU asks for. The private half is only
 * kept in this page until it is saved (sealed) on the server; the public half is pasted at DOKU.
 */
export async function generateKeyPair(): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  return {
    privateKeyPem: toPem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    publicKeyPem: toPem('PUBLIC KEY', await crypto.subtle.exportKey('spki', pair.publicKey)),
  };
}

const SOURCE_TAG: Record<DokuState['source'], { tag: string; label: string }> = {
  saved: { tag: 'ok', label: 'Kunci tersimpan' },
  server: { tag: 'ok', label: 'Memakai kunci di server' },
  none: { tag: 'warn', label: 'Belum diisi' },
  unreadable: { tag: 'err', label: 'Kunci tidak bisa dibuka' },
};

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast('Browser tidak mengizinkan menyalin. Salin dengan tangan.');
  }
}

/** Where a franchise fills in the keys of its own DOKU account, so that QRIS payments go straight to it. */
export function DokuSetup({ api }: { api: OwnerApi }) {
  const load = useLoad(() => api.dokuGet(), [api]);
  const [fields, setFields] = useState<DokuFields | null>(null);
  const [mode, setMode] = useState<'keep' | 'generated' | 'paste'>('keep');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const state = load.data;

  useEffect(() => {
    if (!state) return;
    setFields({
      client_id: state.doku.clientId,
      merchant_id: state.doku.merchantId,
      terminal_id: state.doku.terminalId,
      postal_code: state.doku.postalCode,
      sandbox: state.doku.sandbox,
      secret_key: '',
      private_key_pem: '',
      public_key_pem: state.source === 'saved' ? state.doku.publicKeyPem : '',
    });
    setMode('keep');
  }, [state]);

  if (!state || !fields) {
    return (
      <section class="panel span">
        <h2>Akun DOKU</h2>
        <LoadState load={load} />
      </section>
    );
  }

  const set = (change: Partial<DokuFields>) => {
    setFields({ ...fields, ...change });
    setResult(null);
  };
  const saved = state.source === 'saved';
  const dirty =
    fields.client_id !== state.doku.clientId ||
    fields.merchant_id !== state.doku.merchantId ||
    fields.terminal_id !== state.doku.terminalId ||
    fields.postal_code !== state.doku.postalCode ||
    fields.sandbox !== state.doku.sandbox ||
    fields.secret_key !== '' ||
    fields.private_key_pem !== '';
  // The first save needs both secret parts; later ones may leave them as they are.
  const complete =
    fields.client_id.trim() !== '' &&
    fields.merchant_id.trim() !== '' &&
    fields.terminal_id.trim() !== '' &&
    /^\d{5}$/.test(fields.postal_code.trim()) &&
    (saved || (fields.secret_key.trim() !== '' && fields.private_key_pem.trim() !== ''));

  const generate = async () => {
    setBusy('keys');
    try {
      const pair = await generateKeyPair();
      set({ private_key_pem: pair.privateKeyPem, public_key_pem: pair.publicKeyPem });
      setMode('generated');
    } catch {
      toast('Browser ini tidak bisa membuat kunci. Pakai Chrome atau Safari versi baru.');
    }
    setBusy('');
  };

  const save = async () => {
    setBusy('save');
    try {
      await api.dokuSave(fields);
      toast('Kunci DOKU disimpan. Tablet memakainya dalam waktu sekitar satu menit.');
      load.reload();
    } catch (cause) {
      toast(describe(cause));
    }
    setBusy('');
  };

  const test = async () => {
    setBusy('test');
    setResult(null);
    try {
      setResult(await api.dokuTest());
    } catch (cause) {
      setResult({ ok: false, message: describe(cause) });
    }
    setBusy('');
  };

  const clear = async () => {
    setBusy('clear');
    try {
      await api.dokuClear();
      toast('Kunci DOKU dihapus.');
      setConfirmClear(false);
      load.reload();
    } catch (cause) {
      toast(describe(cause));
    }
    setBusy('');
  };

  return (
    <section class="panel span">
      <div class="row">
        <h2 class="grow">Akun DOKU franchise ini</h2>
        <span class={`tag ${SOURCE_TAG[state.source].tag}`}>{SOURCE_TAG[state.source].label}</span>
      </div>
      <p class="hint">
        Uang QRIS tamu masuk langsung ke akun DOKU yang kuncinya diisi di sini. Kunci rahasia disimpan terenkripsi di server dan
        tidak pernah ditampilkan lagi; kunci hanya bisa diganti.
        {state.updated_at ? ` Terakhir disimpan ${dateTime(state.updated_at)}.` : ''}
      </p>
      {!state.can_save && (
        <p class="banner err">
          Kunci belum bisa disimpan: kunci induk <b class="mono">SECRETS_KEY</b> belum disetel di Supabase. Hubungi pemilik platform.
        </p>
      )}
      {state.source === 'server' && (
        <p class="banner">
          Franchise ini masih memakai kunci DOKU yang dulu diisi langsung di server (Client ID <b class="mono">{state.doku.clientId}</b>). Itu
          tetap berjalan. Mengisi dan menyimpan kunci di sini akan menggantikannya.
        </p>
      )}
      {state.source === 'unreadable' && (
        <p class="banner err">Kunci yang tersimpan tidak bisa dibuka (kunci induk di server berubah). Isi ulang Secret Key dan private key, lalu simpan.</p>
      )}

      <div class="admin-grid" style={{ margin: 0 }}>
        <div class="panel" style={{ boxShadow: 'none' }}>
          <h2>1. Dari DOKU Back Office</h2>
          <TextField label="Client ID" hint="Integration → API Keys. Bentuknya BRN-…" value={fields.client_id} placeholder="BRN-0000-0000000000000" onChange={(v) => set({ client_id: v })} />
          <label class="field">
            <span>Secret Key</span>
            <input
              type="password"
              autocomplete="off"
              value={fields.secret_key}
              placeholder={saved ? 'Tersimpan. Kosongkan kalau tidak diganti.' : 'SK-…'}
              onInput={(event) => set({ secret_key: event.currentTarget.value })}
            />
            <small class="hint">Halaman yang sama dengan Client ID.</small>
          </label>
          <TextField
            label="Merchant ID (QRIS)"
            hint="Settings → Checkout Appearance → Pengaturan Kredensial QRIS. Angka pendek, bukan NMID."
            value={fields.merchant_id}
            onChange={(v) => set({ merchant_id: v })}
          />
          <TextField label="Terminal ID" value={fields.terminal_id} placeholder="A01" onChange={(v) => set({ terminal_id: v })} />
          <TextField label="Kode pos lokasi usaha (5 angka)" value={fields.postal_code} placeholder="40123" onChange={(v) => set({ postal_code: v.replace(/\D/g, '').slice(0, 5) })} />
          <Check label="Mode sandbox (uji coba DOKU)" hint="Matikan untuk pembayaran sungguhan." checked={fields.sandbox} onChange={(v) => set({ sandbox: v })} />
        </div>

        <div class="panel" style={{ boxShadow: 'none' }}>
          <h2>2. Pasangan kunci</h2>
          <p class="hint">
            DOKU mengenali permintaan dari aplikasi ini lewat sepasang kunci: <b>public key</b> ditempel di DOKU (Merchant Public Key),
            <b> private key</b> disimpan di sini.
          </p>
          <div class="chips tight">
            <button type="button" class={`chip ${mode === 'generated' ? 'on' : ''}`} disabled={busy !== ''} onClick={() => void generate()}>
              {busy === 'keys' ? 'Membuat…' : 'Buat pasangan kunci baru'}
            </button>
            <button
              type="button"
              class={`chip ${mode === 'paste' ? 'on' : ''}`}
              onClick={() => {
                setMode('paste');
                set({ private_key_pem: '', public_key_pem: '' });
              }}
            >
              Tempel private key yang sudah ada
            </button>
            {saved && mode !== 'keep' && (
              <button
                type="button"
                class="chip"
                onClick={() => {
                  setMode('keep');
                  set({ private_key_pem: '', public_key_pem: state.doku.publicKeyPem });
                }}
              >
                Tetap pakai yang tersimpan
              </button>
            )}
          </div>
          {mode === 'paste' && (
            <label class="field">
              <span>Private key (PEM)</span>
              <textarea
                class="mono"
                rows={5}
                value={fields.private_key_pem}
                placeholder="-----BEGIN PRIVATE KEY-----"
                onInput={(event) => set({ private_key_pem: event.currentTarget.value })}
              />
              <small class="hint">Pasangan dari Merchant Public Key yang sudah terdaftar di DOKU. Tempel utuh dengan baris BEGIN/END.</small>
            </label>
          )}
          {mode === 'generated' && (
            <p class="banner">
              Pasangan kunci baru sudah dibuat. <b>Salin public key di bawah dan tempel di DOKU</b> sebagai Merchant Public Key, lalu tekan
              Simpan kunci. Mengganti Merchant Public Key membuat kunci lama akun DOKU itu tidak berlaku lagi.
            </p>
          )}
          {fields.public_key_pem && (
            <label class="field">
              <span>Public key untuk DOKU</span>
              <textarea class="mono" rows={5} readOnly value={fields.public_key_pem} />
              <div class="row">
                <button type="button" class="btn small" onClick={() => void copy(fields.public_key_pem, 'Public key disalin.')}>
                  Salin public key
                </button>
              </div>
            </label>
          )}
          {mode === 'keep' && !saved && <p class="hint">Belum ada private key. Buat pasangan baru atau tempel yang sudah ada.</p>}

          <h2>3. Notification URL</h2>
          <p class="hint">Tempel alamat ini di DOKU Back Office sebagai Notification URL, supaya pembayaran yang masuk setelah tamu meninggalkan layar tetap tercatat.</p>
          <div class="row">
            <code class="mono share-qr-url grow">{state.notify_url}</code>
            <button type="button" class="btn small" onClick={() => void copy(state.notify_url, 'Alamat disalin.')}>
              Salin
            </button>
          </div>
        </div>
      </div>

      {result && <p class={`banner ${result.ok ? 'ok' : 'err'}`}>{result.message}</p>}
      <div class="row">
        <button class="btn small primary" disabled={busy !== '' || !dirty || !complete || !state.can_save} onClick={() => void save()}>
          {busy === 'save' ? 'Menyimpan…' : dirty ? 'Simpan kunci' : 'Tersimpan'}
        </button>
        <button class="btn small" disabled={busy !== '' || dirty || !state.has_keys} onClick={() => void test()}>
          {busy === 'test' ? 'Menghubungi DOKU…' : 'Tes koneksi'}
        </button>
        {saved &&
          (confirmClear ? (
            <>
              <button class="btn small danger" disabled={busy !== ''} onClick={() => void clear()}>
                Ya, hapus kunci
              </button>
              <button class="btn small" onClick={() => setConfirmClear(false)}>
                Batal
              </button>
            </>
          ) : (
            <button class="btn small" disabled={busy !== ''} onClick={() => setConfirmClear(true)}>
              Hapus kunci
            </button>
          ))}
      </div>
      {dirty && state.has_keys && <p class="hint">Simpan dulu perubahannya, baru Tes koneksi.</p>}
    </section>
  );
}
