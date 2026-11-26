/**
 * doku-setup: where a franchise's admin (or the superadmin) fills in the keys of
 * the franchise's own DOKU account. The secret parts are sealed before they are
 * stored and are never sent back; they can only be replaced.
 */
import { callerOf, UUID } from './accounts.ts';
import { createDoku, DokuError, importPrivateKey } from './doku.ts';
import { forgetDoku, resolveDoku, rpc, type Env, type Reply } from './handlers.ts';
import { open, seal } from './secrets.ts';

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const refuse = (error: string, message?: string): Reply => ({ status: 200, body: message ? { error, message } : { error } });

export async function handleDokuSetup(input: Record<string, unknown>, bearer: string, env: Env, fetchFn: Fetch = fetch, now: () => Date = () => new Date()): Promise<Reply> {
  const caller = await callerOf(env, fetchFn, bearer);
  if (!caller) return { status: 401, body: { error: 'signed-out' } };
  const franchiseId = text(input.franchise_id);
  if (!UUID.test(franchiseId)) return refuse('bad-request');
  if ((await rpc<boolean>(env, fetchFn, 'svc_can_access', { p_user: caller.id, p_franchise: franchiseId })) !== true) return refuse('forbidden');

  const current = await resolveDoku(env, fetchFn, franchiseId);

  if (input.action === 'get') {
    const shown = current.source === 'server' && env.doku
      ? { clientId: env.doku.clientId, merchantId: env.doku.merchantId, terminalId: env.doku.terminalId, postalCode: env.doku.postalCode, sandbox: env.doku.baseUrl.includes('sandbox'), publicKeyPem: '' }
      : {
          clientId: text(current.saved.doku?.clientId),
          merchantId: text(current.saved.doku?.merchantId),
          terminalId: text(current.saved.doku?.terminalId),
          postalCode: text(current.saved.doku?.postalCode),
          sandbox: current.saved.doku?.sandbox === true,
          publicKeyPem: text(current.saved.doku?.publicKeyPem),
        };
    return {
      status: 200,
      body: {
        // Whether keys can be saved at all: the master key must be set once by the platform owner.
        // A wallet franchise has nothing to fill in: its QRIS runs on the platform's account.
        can_save: env.secretsKey !== '' && current.source !== 'platform',
        source: current.source,
        doku: shown,
        has_keys: current.config !== null,
        notify_url: `${env.supabaseUrl}${env.notifyPath}`,
        updated_at: current.saved.updated_at ?? null,
      },
    };
  }

  if (input.action === 'save') {
    if (!env.secretsKey) return refuse('no-master-key', 'Kunci induk (SECRETS_KEY) belum disetel di Supabase. Hubungi pemilik platform.');
    const doku = {
      clientId: text(input.client_id),
      merchantId: text(input.merchant_id),
      terminalId: text(input.terminal_id),
      postalCode: text(input.postal_code),
      sandbox: input.sandbox === true,
      publicKeyPem: text(input.public_key_pem).slice(0, 4000),
    };
    if (!doku.clientId || doku.clientId.length > 80) return refuse('invalid', 'Client ID belum diisi.');
    if (!doku.merchantId || doku.merchantId.length > 40) return refuse('invalid', 'Merchant ID belum diisi.');
    if (!doku.terminalId || doku.terminalId.length > 40) return refuse('invalid', 'Terminal ID belum diisi.');
    if (!/^\d{5}$/.test(doku.postalCode)) return refuse('invalid', 'Kode pos harus 5 angka.');

    // Secret parts left empty keep what is already saved.
    let kept: { secretKey?: unknown; privateKeyPem?: unknown } = {};
    if (current.saved.sealed) {
      const opened = await open(current.saved.sealed, env.secretsKey, franchiseId);
      try {
        kept = opened ? JSON.parse(opened) : {};
      } catch {
        kept = {};
      }
    }
    const secretKey = text(input.secret_key) || text(kept.secretKey);
    const privateKeyPem = text(input.private_key_pem) || text(kept.privateKeyPem);
    if (!secretKey) return refuse('invalid', 'Secret Key belum diisi.');
    if (!privateKeyPem) return refuse('invalid', 'Private key belum diisi. Buat pasangan kunci baru atau tempel private key yang sudah ada.');
    if (secretKey.length > 400 || privateKeyPem.length > 8000) return refuse('invalid', 'Kunci terlalu panjang.');
    try {
      await importPrivateKey(privateKeyPem);
    } catch (cause) {
      return refuse('invalid', cause instanceof Error ? cause.message : 'Private key tidak bisa dibaca.');
    }
    // A public key kept for display only goes with the private key it was made with.
    if (!text(input.private_key_pem) && !doku.publicKeyPem) doku.publicKeyPem = text(current.saved.doku?.publicKeyPem);

    await rpc(env, fetchFn, 'svc_doku_save', {
      p_franchise: franchiseId,
      p_doku: doku,
      p_sealed: await seal(JSON.stringify({ secretKey, privateKeyPem }), env.secretsKey, franchiseId),
    });
    forgetDoku(env, franchiseId);
    return { status: 200, body: { ok: true } };
  }

  if (input.action === 'test') {
    if (!current.config) {
      return refuse('not-configured', current.source === 'unreadable' ? 'Kunci yang tersimpan tidak bisa dibuka. Simpan ulang kuncinya.' : 'Kunci DOKU belum diisi.');
    }
    try {
      const checked = await createDoku(current.config, fetchFn, now).check();
      if (checked.signature === 'refused') {
        return { status: 200, body: { ok: false, step: 'secret', message: `Client ID dan private key diterima DOKU, tetapi Secret Key ditolak (${checked.message}).` } };
      }
      return {
        status: 200,
        body: {
          ok: true,
          sure: checked.signature === 'ok',
          message:
            checked.signature === 'ok'
              ? 'DOKU menerima Client ID, private key dan Secret Key.'
              : `DOKU menerima Client ID dan private key. Secret Key belum bisa dipastikan (${checked.message}); coba satu pembayaran kecil.`,
        },
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'DOKU tidak bisa dihubungi.';
      return { status: 200, body: { ok: false, step: cause instanceof DokuError ? 'token' : 'network', message } };
    }
  }

  if (input.action === 'clear') {
    await rpc(env, fetchFn, 'svc_doku_clear', { p_franchise: franchiseId });
    forgetDoku(env, franchiseId);
    return { status: 200, body: { ok: true } };
  }

  return refuse('bad-request');
}
