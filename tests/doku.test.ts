import { createHash, createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { jakartaTimestamp, signRequest, stateFromStatus, verifyNotification } from '../supabase/functions/_shared/doku.ts';
import { handleCancel, handleCreate, handleNotify, handleStatus, handleSweep, readEnv, type Env } from '../supabase/functions/_shared/handlers.ts';
import { handleDokuSetup } from '../supabase/functions/_shared/setup.ts';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PKCS8 = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PKCS1 = keys.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const SECRET = 'SK-rahasia-uji';
const CLIENT = 'BRN-0000-1111111111111';
const FRANCHISE = '11111111-1111-4111-8111-111111111111';
const MASTER = 'kunci-induk-uji';

function env(overrides: Record<string, string> = {}): Env {
  const values: Record<string, string> = {
    SUPABASE_URL: 'https://proyek.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    DOKU_BASE_URL: 'https://doku.test',
    DOKU_CLIENT_ID: CLIENT,
    DOKU_SECRET_KEY: SECRET,
    DOKU_PRIVATE_KEY: PKCS8,
    DOKU_MERCHANT_ID: '4455',
    DOKU_TERMINAL_ID: 'A01',
    DOKU_POSTAL_CODE: '40123',
    // The franchise in these tests still uses the keys kept in the functions' own secrets.
    DOKU_ENV_FRANCHISE: FRANCHISE,
    SECRETS_KEY: MASTER,
    ...overrides,
  };
  return readEnv((name) => values[name]);
}

/** A stand-in for DOKU and for the database, refusing anything a real DOKU would refuse. */
function world() {
  const state = {
    payment: null as null | Record<string, unknown>,
    paidAtDoku: false,
    tokenRequests: 0,
    generated: [] as Record<string, unknown>[],
    settled: [] as string[],
    dokuDown: false,
    expired: [] as Record<string, unknown>[],
    expireRefused: false,
    /** What the franchise saved on the setup page; null while it has saved nothing. */
    saved: null as null | { doku: Record<string, unknown>; sealed: string; updated_at: string },
    /** Titip saldo: the platform owner switched this franchise to the platform's own DOKU account. */
    wallet: false,
  };
  let token = 0;

  const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = init.headers as Record<string, string>;
    const body = String(init.body ?? '');
    const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });

    if (url.startsWith('https://proyek.supabase.co/rest/v1/rpc/')) {
      expect(headers.apikey).toBe('service-key');
      const name = url.split('/rpc/')[1];
      const args = JSON.parse(body);
      if (name === 'payment_begin') {
        if (args.p_token !== 'token-tablet') return reply(200, { error: 'unpaired' });
        state.payment = { id: 'pay-1', franchise_id: FRANCHISE, status: 'pending', amount: 15000, partner_ref: 'FS1', provider_ref: null, expires_at: null, created_at: new Date(0).toISOString() };
        return reply(200, { id: 'pay-1', amount: 15000, partner_ref: 'FS1', franchise_id: FRANCHISE });
      }
      if (name === 'svc_doku_get') return reply(200, { ...(args.p_franchise === FRANCHISE && state.saved ? state.saved : {}), wallet: state.wallet });
      if (name === 'svc_doku_save') {
        state.saved = { doku: args.p_doku, sealed: args.p_sealed, updated_at: clock.toISOString() };
        return new Response('', { status: 200 });
      }
      if (name === 'svc_doku_clear') {
        state.saved = null;
        return new Response('', { status: 200 });
      }
      if (name === 'payment_franchise') return reply(200, args.p_partner_ref === 'FS1' && state.payment ? FRANCHISE : null);
      if (name === 'svc_can_access') return reply(200, args.p_franchise === FRANCHISE && (args.p_user === ADMIN_USER || args.p_user === SUPER_USER));
      if (name === 'svc_is_superadmin') return reply(200, args.p_user === SUPER_USER);
      if (name === 'payment_attach') {
        Object.assign(state.payment!, { provider_ref: args.p_provider_ref, expires_at: args.p_expires });
        // Like Supabase: a function returning void answers with an empty body.
        return new Response('', { status: 200 });
      }
      if (name === 'payment_get') return reply(200, args.p_id === 'pay-1' && state.payment ? state.payment : { error: 'not-found' });
      if (name === 'payment_settle') {
        state.settled.push(args.p_status);
        if (state.payment!.status === 'pending' || args.p_status === 'paid') state.payment!.status = args.p_status;
        return reply(200, state.payment!.status);
      }
      if (name === 'payment_stale') {
        if (args.p_token !== 'token-tablet') return reply(200, { error: 'unpaired' });
        const p = state.payment;
        const stale = p && p.status === 'pending' && Date.parse(String(p.expires_at ?? p.created_at)) + 15_000 < clock.getTime();
        return reply(200, { franchise_id: FRANCHISE, payments: stale ? [p] : [] });
      }
      if (name === 'payment_settle_by_ref') {
        if (args.p_partner_ref === 'FS1' && args.p_amount === 15000) {
          state.payment!.status = 'paid';
          state.settled.push('paid');
        }
        return reply(200, null);
      }
      throw new Error(`rpc tak dikenal: ${name}`);
    }

    // Supabase Auth: who a dashboard account's token belongs to.
    if (url === 'https://proyek.supabase.co/auth/v1/user') {
      const who = { 'jwt-admin': ADMIN_USER, 'jwt-super': SUPER_USER, 'jwt-lain': OTHER_USER }[headers.Authorization.replace('Bearer ', '')];
      return who ? reply(200, { id: who, email: 'akun@contoh.id' }) : reply(401, { msg: 'invalid JWT' });
    }

    if (state.dokuDown) throw new TypeError('fetch failed');
    // Keys saved by a franchise go to DOKU's real address; the ones from the functions' secrets to the test address.
    const path = url.replace(/^https:\/\/(doku\.test|api\.doku\.com)/, '');
    if (path === '/authorization/v1/access-token/b2b') {
      state.tokenRequests += 1;
      const verifier = createVerify('RSA-SHA256').update(`${headers['X-CLIENT-KEY']}|${headers['X-TIMESTAMP']}`);
      if (headers['X-CLIENT-KEY'] !== CLIENT || !verifier.verify(keys.publicKey, headers['X-SIGNATURE'], 'base64')) {
        return reply(401, { responseCode: '4017300', responseMessage: 'Unauthorized. Signature' });
      }
      expect(JSON.parse(body)).toEqual({ grantType: 'client_credentials' });
      token += 1;
      return reply(200, { responseCode: '2007300', accessToken: `tok-${token}`, tokenType: 'Bearer', expiresIn: 900 });
    }

    // Every transaction call must carry a signature over exactly what was sent.
    const bearer = headers.Authorization.replace('Bearer ', '');
    const digest = createHash('sha256').update(body).digest('hex');
    const expected = createHmac('sha512', SECRET).update(`POST:${path}:${bearer}:${digest}:${headers['X-TIMESTAMP']}`).digest('base64');
    if (headers['X-SIGNATURE'] !== expected || headers['X-PARTNER-ID'] !== CLIENT) return reply(401, { responseCode: '4014700', responseMessage: 'Unauthorized. Signature' });
    expect(headers['CHANNEL-ID']).toBe('H2H');
    expect(headers['X-EXTERNAL-ID']).toMatch(/^\d+$/);
    expect(headers['X-TIMESTAMP']).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+07:00$/);
    const request = JSON.parse(body);

    if (path === '/snap-adapter/b2b/v1.0/qr/qr-mpm-generate') {
      state.generated.push(request);
      if (request.merchantId !== '4455') return reply(404, { responseCode: '4044708', responseMessage: 'Invalid Merchant' });
      return reply(200, { responseCode: '2004700', referenceNo: 'DOKU-9', partnerReferenceNo: request.partnerReferenceNo, qrContent: '00020101021226...6304ABCD' });
    }
    if (path === '/snap-adapter/b2b/v1.0/qr/qr-mpm-query') {
      // The connection test asks about a QR that does not exist.
      if (request.originalReferenceNo === 'TES-KONEKSI') return reply(404, { responseCode: '4045101', responseMessage: 'Transaction Not Found' });
      expect(request).toEqual({ originalReferenceNo: 'DOKU-9', originalPartnerReferenceNo: 'FS1', serviceCode: '47', merchantId: '4455' });
      return reply(200, { responseCode: '2004700', latestTransactionStatus: state.paidAtDoku ? '00' : '03' });
    }
    if (path === '/snap-adapter/b2b/v1.0/qr/qr-expire') {
      state.expired.push(request);
      if (state.expireRefused) return reply(400, { responseCode: '4004701', responseMessage: 'Invalid Field Format' });
      return reply(200, { responseCode: '2004700', responseMessage: 'Successful' });
    }
    throw new Error(`alamat tak dikenal: ${url}`);
  };
  return { state, fetchFn };
}

const ADMIN_USER = '22222222-2222-4222-8222-222222222222';
const SUPER_USER = '33333333-3333-4333-8333-333333333333';
const OTHER_USER = '44444444-4444-4444-8444-444444444444';

const NOON = new Date('2026-11-17T05:00:00Z');
let clock = NOON;
const now = () => clock;

beforeEach(() => {
  // Each test starts 20 minutes later, so an access token cached by an earlier test has run out.
  clock = new Date(clock.getTime() + 20 * 60_000);
});

describe('DOKU signatures', () => {
  it('writes timestamps as Jakarta time with its offset', () => {
    expect(jakartaTimestamp(new Date('2026-11-17T05:00:09Z'))).toBe('2026-11-17T12:00:09+07:00');
    expect(jakartaTimestamp(new Date('2026-12-31T18:30:00Z'))).toBe('2027-01-01T01:30:00+07:00');
  });

  it('signs a transaction request the way DOKU recomputes it', async () => {
    const body = JSON.stringify({ a: 1 });
    const expected = createHmac('sha512', 's3cret')
      .update(`POST:/x:tok:${createHash('sha256').update(body).digest('hex')}:2026-11-17T12:00:00+07:00`)
      .digest('base64');
    expect(await signRequest('s3cret', 'POST', '/x', 'tok', body, '2026-11-17T12:00:00+07:00')).toBe(expected);
  });

  it('reads only a success code as paid', () => {
    expect(stateFromStatus('00')).toBe('paid');
    expect(stateFromStatus('03')).toBe('pending');
    expect(stateFromStatus('01')).toBe('pending');
    expect(stateFromStatus('06')).toBe('failed');
    expect(stateFromStatus(undefined)).toBe('pending');
  });
});

describe('qris-create', () => {
  it('makes a QR for the price the database gives, never one the tablet sends', async () => {
    const { state, fetchFn } = world();
    const reply = await handleCreate({ token: 'token-tablet', package_id: 'a', amount: 1 }, env(), fetchFn, now);
    expect(reply.body).toMatchObject({ id: 'pay-1', qr: '00020101021226...6304ABCD', amount: 15000 });
    expect(state.generated[0]).toMatchObject({
      partnerReferenceNo: 'FS1',
      amount: { value: '15000.00', currency: 'IDR' },
      merchantId: '4455',
      terminalId: 'A01',
      additionalInfo: { postalCode: '40123', feeType: '1' },
    });
    // Five minutes to pay by default, also told to DOKU.
    expect(Date.parse(String(reply.body.expires_at)) - clock.getTime()).toBe(5 * 60_000);
    expect(state.generated[0].validityPeriod).toBe(jakartaTimestamp(new Date(clock.getTime() + 5 * 60_000)));
    expect(state.payment).toMatchObject({ provider_ref: 'DOKU-9' });
  });

  it('accepts a private key in the older PKCS#1 form and one pasted with literal \\n', async () => {
    for (const key of [PKCS1, PKCS8.replace(/\n/g, '\\n')]) {
      clock = new Date(clock.getTime() + 20 * 60_000);
      const { fetchFn } = world();
      expect((await handleCreate({ token: 'token-tablet', package_id: 'a' }, env({ DOKU_PRIVATE_KEY: key }), fetchFn, now)).body.qr).toBeTruthy();
    }
  });

  it('reads a private key pasted without its BEGIN/END lines, in either form', async () => {
    const bare = (pem: string) => pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    for (const key of [bare(PKCS8), bare(PKCS1)]) {
      clock = new Date(clock.getTime() + 20 * 60_000);
      const { fetchFn } = world();
      expect((await handleCreate({ token: 'token-tablet', package_id: 'a' }, env({ DOKU_PRIVATE_KEY: key }), fetchFn, now)).body.qr).toBeTruthy();
    }
  });

  it('says plainly when the key is the public half, locked with a password, or cut short', async () => {
    const message = async (key: string) => {
      // Later than the minute for which a franchise's keys are remembered.
      clock = new Date(clock.getTime() + 20 * 60_000);
      const { fetchFn } = world();
      const reply = await handleCreate({ token: 'token-tablet', package_id: 'a' }, env({ DOKU_PRIVATE_KEY: key }), fetchFn, now);
      expect(reply.body.error).toBe('not-configured');
      return String(reply.body.message);
    };
    const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(await message(publicPem)).toContain('kunci PUBLIK');
    const locked = keys.privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'rahasia' }).toString();
    expect(await message(locked)).toContain('password');
    const cut = PKCS8.slice(0, 400) + '\n-----END PRIVATE KEY-----';
    const cutMessage = await message(cut);
    expect(cutMessage).toContain('terpotong');
    // The key's content never appears in the message.
    expect(cutMessage).not.toContain(PKCS8.split('\n')[1].slice(0, 20));
  });

  it('can leave the validity period out when DOKU does not accept it', async () => {
    const { state, fetchFn } = world();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, env({ DOKU_SEND_VALIDITY: 'off' }), fetchFn, now);
    expect('validityPeriod' in state.generated[0]).toBe(false);
  });

  it('refuses a tablet that is not paired without calling DOKU', async () => {
    const { state, fetchFn } = world();
    expect((await handleCreate({ token: 'lain', package_id: 'a' }, env(), fetchFn, now)).body).toEqual({ error: 'unpaired' });
    expect(state.tokenRequests).toBe(0);
  });

  it('says so when the DOKU keys are missing or unreadable', async () => {
    const { fetchFn } = world();
    expect((await handleCreate({ token: 'token-tablet', package_id: 'a' }, env({ DOKU_SECRET_KEY: '' }), fetchFn, now)).body.error).toBe('not-configured');
    const broken = await handleCreate({ token: 'token-tablet', package_id: 'a' }, env({ DOKU_PRIVATE_KEY: 'bukan kunci' }), fetchFn, now);
    expect(broken.body.error).toBe('not-configured');
  });

  it('marks the charge failed when DOKU rejects it', async () => {
    const { state, fetchFn } = world();
    const reply = await handleCreate({ token: 'token-tablet', package_id: 'a' }, env({ DOKU_MERCHANT_ID: 'salah' }), fetchFn, now);
    expect(reply.body).toMatchObject({ error: 'provider' });
    expect(String(reply.body.message)).toContain('Invalid Merchant');
    expect(state.payment?.status).toBe('failed');
  });

  it('is refused by DOKU when the secret key is wrong', async () => {
    const { state, fetchFn } = world();
    const reply = await handleCreate({ token: 'token-tablet', package_id: 'a' }, env({ DOKU_SECRET_KEY: 'salah' }), fetchFn, now);
    expect(reply.body.error).toBe('provider');
    expect(state.payment?.status).toBe('failed');
  });
});

describe('qris-status', () => {
  it('stays pending until DOKU reports the payment, then is paid for good', async () => {
    const { state, fetchFn } = world();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, env(), fetchFn, now);
    expect((await handleStatus({ token: 'token-tablet', id: 'pay-1' }, env(), fetchFn, now)).body).toEqual({ status: 'pending' });
    state.paidAtDoku = true;
    expect((await handleStatus({ token: 'token-tablet', id: 'pay-1' }, env(), fetchFn, now)).body).toEqual({ status: 'paid' });
    // Settled charges are answered from the database, without asking DOKU again.
    state.dokuDown = true;
    expect((await handleStatus({ token: 'token-tablet', id: 'pay-1' }, env(), fetchFn, now)).body).toEqual({ status: 'paid' });
    // One access token served all three DOKU calls.
    expect(state.tokenRequests).toBe(1);
  });

  it('expires an unpaid QR only after its time plus a short grace period', async () => {
    const { fetchFn } = world();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, env(), fetchFn, now);
    clock = new Date(clock.getTime() + 5 * 60_000 + 10_000);
    expect((await handleStatus({ token: 'token-tablet', id: 'pay-1' }, env(), fetchFn, now)).body.status).toBe('pending');
    clock = new Date(clock.getTime() + 10_000);
    expect((await handleStatus({ token: 'token-tablet', id: 'pay-1' }, env(), fetchFn, now)).body.status).toBe('expired');
  });

  it('still counts a payment that lands just as the QR runs out', async () => {
    const { state, fetchFn } = world();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, env(), fetchFn, now);
    clock = new Date(clock.getTime() + 6 * 60_000);
    state.paidAtDoku = true;
    expect((await handleStatus({ token: 'token-tablet', id: 'pay-1' }, env(), fetchFn, now)).body.status).toBe('paid');
  });

  it('keeps the QR open when DOKU cannot be reached', async () => {
    const { state, fetchFn } = world();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, env(), fetchFn, now);
    state.dokuDown = true;
    expect((await handleStatus({ token: 'token-tablet', id: 'pay-1' }, env(), fetchFn, now)).body).toEqual({ status: 'pending', unsure: true });
    expect(state.payment?.status).toBe('pending');
  });

  it('does not show another payment', async () => {
    const { fetchFn } = world();
    expect((await handleStatus({ token: 'token-tablet', id: 'lain' }, env(), fetchFn, now)).body).toEqual({ error: 'not-found' });
  });
});

describe('qris-cancel', () => {
  it('closes an unpaid QR at DOKU and marks it not paid', async () => {
    const { state, fetchFn } = world();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, env(), fetchFn, now);
    expect((await handleCancel({ token: 'token-tablet', id: 'pay-1' }, env(), fetchFn, now)).body).toEqual({ status: 'expired' });
    expect(state.expired[0]).toEqual({ partnerReferenceNo: 'FS1', referenceNo: 'DOKU-9', merchantId: '4455', reason: 'Dibatalkan di booth' });
    expect(state.payment?.status).toBe('expired');
  });

  it('reports a QR paid just before the guest left as paid, without closing it', async () => {
    const { state, fetchFn } = world();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, env(), fetchFn, now);
    state.paidAtDoku = true;
    expect((await handleCancel({ token: 'token-tablet', id: 'pay-1' }, env(), fetchFn, now)).body).toEqual({ status: 'paid' });
    expect(state.expired).toHaveLength(0);
  });

  it('keeps the QR open when DOKU will not close it, so it is checked again later', async () => {
    const { state, fetchFn } = world();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, env(), fetchFn, now);
    state.expireRefused = true;
    expect((await handleCancel({ token: 'token-tablet', id: 'pay-1' }, env(), fetchFn, now)).body).toEqual({ status: 'pending', unsure: true });
    expect(state.payment?.status).toBe('pending');
  });

  it('also closes a QR at DOKU whose time ran out on screen', async () => {
    const { state, fetchFn } = world();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, env(), fetchFn, now);
    clock = new Date(clock.getTime() + 6 * 60_000);
    expect((await handleStatus({ token: 'token-tablet', id: 'pay-1' }, env(), fetchFn, now)).body.status).toBe('expired');
    expect(state.expired).toHaveLength(1);
  });

  it('still marks a QR whose time ran out as not paid when DOKU will not close it', async () => {
    const { state, fetchFn } = world();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, env(), fetchFn, now);
    state.expireRefused = true;
    clock = new Date(clock.getTime() + 6 * 60_000);
    expect((await handleStatus({ token: 'token-tablet', id: 'pay-1' }, env(), fetchFn, now)).body.status).toBe('expired');
  });
});

describe('qris-sweep', () => {
  it('leaves a QR alone while it can still be paid', async () => {
    const { state, fetchFn } = world();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, env(), fetchFn, now);
    expect((await handleSweep({ token: 'token-tablet' }, env(), fetchFn, now)).body).toMatchObject({ checked: 0 });
    expect(state.payment?.status).toBe('pending');
  });

  it('records a QR paid after the guest walked away', async () => {
    const { state, fetchFn } = world();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, env(), fetchFn, now);
    state.paidAtDoku = true;
    clock = new Date(clock.getTime() + 6 * 60_000);
    expect((await handleSweep({ token: 'token-tablet' }, env(), fetchFn, now)).body).toMatchObject({ checked: 1, open: 0, results: [{ id: 'pay-1', status: 'paid' }] });
    expect(state.payment?.status).toBe('paid');
  });

  it('closes a forgotten unpaid QR', async () => {
    const { state, fetchFn } = world();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, env(), fetchFn, now);
    clock = new Date(clock.getTime() + 6 * 60_000);
    expect((await handleSweep({ token: 'token-tablet' }, env(), fetchFn, now)).body).toMatchObject({ results: [{ status: 'expired' }] });
    expect(state.expired).toHaveLength(1);
  });

  it('refuses a tablet that is not paired', async () => {
    const { fetchFn } = world();
    expect((await handleSweep({ token: 'lain' }, env(), fetchFn, now)).body).toEqual({ error: 'unpaired' });
  });
});

describe('doku-notify', () => {
  const PATH = '/functions/v1/doku-notify';
  const body = JSON.stringify({ order: { invoice_number: 'FS1', amount: 15000.0 }, transaction: { status: 'SUCCESS' } });

  function signed(raw: string, secret = SECRET, path = PATH): Headers {
    const digest = createHash('sha256').update(raw).digest('base64');
    const text = `Client-Id:${CLIENT}\nRequest-Id:r-1\nRequest-Timestamp:2026-11-17T05:00:00Z\nRequest-Target:${path}\nDigest:${digest}`;
    return new Headers({
      'Client-Id': CLIENT,
      'Request-Id': 'r-1',
      'Request-Timestamp': '2026-11-17T05:00:00Z',
      Signature: `HMACSHA256=${createHmac('sha256', secret).update(text).digest('base64')}`,
    });
  }

  it('checks the signature the way DOKU makes it', async () => {
    const headers = signed(body);
    const parts = { clientId: CLIENT, requestId: 'r-1', timestamp: '2026-11-17T05:00:00Z', signature: headers.get('Signature')! };
    expect(await verifyNotification(SECRET, parts, PATH, body)).toBe(true);
    expect(await verifyNotification(SECRET, parts, PATH, body.replace('15000', '1'))).toBe(false);
    expect(await verifyNotification('lain', parts, PATH, body)).toBe(false);
  });

  it('marks the charge paid on a genuine success notification', async () => {
    const { state, fetchFn } = world();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, env(), fetchFn, now);
    expect((await handleNotify(signed(body), body, env(), fetchFn)).status).toBe(200);
    expect(state.payment?.status).toBe('paid');
  });

  it('turns away a notification that is forged or altered', async () => {
    const { state, fetchFn } = world();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, env(), fetchFn, now);
    expect((await handleNotify(signed(body, 'kunci-penipu'), body, env(), fetchFn)).status).toBe(401);
    expect((await handleNotify(signed(body), body.replace('15000', '1'), env(), fetchFn)).status).toBe(401);
    expect((await handleNotify(new Headers(), body, env(), fetchFn)).status).toBe(401);
    expect(state.payment?.status).toBe('pending');
  });

  it('ignores a notification about a charge that is not ours, without saying whose keys it would need', async () => {
    const { state, fetchFn } = world();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, env(), fetchFn, now);
    const other = body.replace('FS1', 'FS2');
    expect(await handleNotify(signed(other, 'kunci-penipu'), other, env(), fetchFn)).toEqual({ status: 200, body: { ok: true, ignored: true } });
    expect(state.payment?.status).toBe('pending');
  });

  it('does nothing for a notification that is not a success', async () => {
    const { state, fetchFn } = world();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, env(), fetchFn, now);
    const failed = body.replace('SUCCESS', 'FAILED');
    expect((await handleNotify(signed(failed), failed, env(), fetchFn)).status).toBe(200);
    expect(state.payment?.status).toBe('pending');
  });
});

describe('doku-setup', () => {
  /** A franchise that has no keys in the functions' own secrets, like every franchise but the first. */
  const plain = (overrides: Record<string, string> = {}) => env({ DOKU_CLIENT_ID: '', DOKU_ENV_FRANCHISE: '', ...overrides });
  const fields = {
    franchise_id: FRANCHISE,
    client_id: CLIENT,
    merchant_id: '4455',
    terminal_id: 'A01',
    postal_code: '40123',
    secret_key: SECRET,
    private_key_pem: PKCS8,
    public_key_pem: '-----BEGIN PUBLIC KEY-----\nPUB\n-----END PUBLIC KEY-----',
  };
  const later = () => {
    clock = new Date(clock.getTime() + 20 * 60_000);
  };

  it('is only for accounts of that franchise and the superadmin', async () => {
    const { fetchFn } = world();
    const ask = (bearer: string) => handleDokuSetup({ action: 'get', franchise_id: FRANCHISE }, bearer, plain(), fetchFn, now);
    expect((await ask('')).status).toBe(401);
    expect((await ask('jwt-palsu')).status).toBe(401);
    expect((await ask('jwt-lain')).body).toEqual({ error: 'forbidden' });
    expect((await ask('jwt-admin')).body.source).toBe('none');
    expect((await ask('jwt-super')).body.source).toBe('none');
    expect((await handleDokuSetup({ action: 'save', ...fields }, 'jwt-lain', plain(), fetchFn, now)).body).toEqual({ error: 'forbidden' });
  });

  it('seals the keys, never hands the secret parts back, and pays that franchise with them', async () => {
    const { state, fetchFn } = world();
    expect((await handleDokuSetup({ action: 'save', ...fields }, 'jwt-admin', plain(), fetchFn, now)).body).toEqual({ ok: true });
    const stored = JSON.stringify(state.saved);
    expect(stored).not.toContain(SECRET);
    expect(stored).not.toContain('PRIVATE KEY');
    expect(state.saved?.doku).toMatchObject({ clientId: CLIENT, merchantId: '4455', sandbox: false });

    const shown = await handleDokuSetup({ action: 'get', franchise_id: FRANCHISE }, 'jwt-admin', plain(), fetchFn, now);
    expect(shown.body).toMatchObject({ source: 'saved', has_keys: true, can_save: true, notify_url: 'https://proyek.supabase.co/functions/v1/doku-notify' });
    expect(shown.body.doku).toMatchObject({ clientId: CLIENT, terminalId: 'A01', postalCode: '40123', publicKeyPem: fields.public_key_pem });
    expect(JSON.stringify(shown.body)).not.toContain(SECRET);
    expect(JSON.stringify(shown.body)).not.toContain('PRIVATE KEY');

    later();
    const made = await handleCreate({ token: 'token-tablet', package_id: 'a' }, plain(), fetchFn, now);
    expect(made.body.qr).toBeTruthy();
    expect(state.generated[0]).toMatchObject({ merchantId: '4455', terminalId: 'A01' });
  });

  it('keeps the saved secrets when only the other fields are changed', async () => {
    const { state, fetchFn } = world();
    await handleDokuSetup({ action: 'save', ...fields }, 'jwt-admin', plain(), fetchFn, now);
    const changed = await handleDokuSetup({ action: 'save', ...fields, secret_key: '', private_key_pem: '', public_key_pem: '', terminal_id: 'B02' }, 'jwt-super', plain(), fetchFn, now);
    expect(changed.body).toEqual({ ok: true });
    expect(state.saved?.doku).toMatchObject({ terminalId: 'B02', publicKeyPem: fields.public_key_pem });
    later();
    await handleCreate({ token: 'token-tablet', package_id: 'a' }, plain(), fetchFn, now);
    expect(state.generated[0]).toMatchObject({ terminalId: 'B02' });
  });

  it('tests the keys at DOKU without charging anyone, and says which part is refused', async () => {
    const { state, fetchFn } = world();
    const test = () => handleDokuSetup({ action: 'test', franchise_id: FRANCHISE }, 'jwt-admin', plain(), fetchFn, now);
    expect((await test()).body.error).toBe('not-configured');

    await handleDokuSetup({ action: 'save', ...fields }, 'jwt-admin', plain(), fetchFn, now);
    expect((await test()).body).toMatchObject({ ok: true, sure: true });
    expect(state.generated).toHaveLength(0);

    await handleDokuSetup({ action: 'save', ...fields, secret_key: 'SK-keliru' }, 'jwt-admin', plain(), fetchFn, now);
    expect((await test()).body).toMatchObject({ ok: false, step: 'secret' });

    const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    await handleDokuSetup({ action: 'save', ...fields, private_key_pem: stranger }, 'jwt-admin', plain(), fetchFn, now);
    expect((await test()).body).toMatchObject({ ok: false, step: 'token' });

    state.dokuDown = true;
    expect((await test()).body).toMatchObject({ ok: false, step: 'network' });
  });

  it('refuses incomplete or unusable input with a message that says what to fix', async () => {
    const { state, fetchFn } = world();
    const save = (change: Record<string, unknown>, e = plain()) => handleDokuSetup({ action: 'save', ...fields, ...change }, 'jwt-admin', e, fetchFn, now);
    expect((await save({}, plain({ SECRETS_KEY: '' }))).body.error).toBe('no-master-key');
    expect(String((await save({ postal_code: '12' })).body.message)).toContain('Kode pos');
    expect(String((await save({ secret_key: '' })).body.message)).toContain('Secret Key');
    expect(String((await save({ private_key_pem: '' })).body.message)).toContain('Private key');
    const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(String((await save({ private_key_pem: publicPem })).body.message)).toContain('kunci PUBLIK');
    expect(state.saved).toBeNull();
  });

  it('does not quietly fall back to other keys when the saved ones cannot be opened', async () => {
    const { fetchFn } = world();
    // This franchise is the one that may use the server keys, and has now saved its own.
    await handleDokuSetup({ action: 'save', ...fields }, 'jwt-admin', env(), fetchFn, now);
    const otherMaster = env({ SECRETS_KEY: 'kunci-induk-lain' });
    expect((await handleDokuSetup({ action: 'get', franchise_id: FRANCHISE }, 'jwt-admin', otherMaster, fetchFn, now)).body).toMatchObject({ source: 'unreadable', has_keys: false });
    later();
    expect((await handleCreate({ token: 'token-tablet', package_id: 'a' }, otherMaster, fetchFn, now)).body.error).toBe('not-configured');
  });

  it("sends a wallet franchise's QRIS through the platform's account, whatever keys it once saved", async () => {
    const { state, fetchFn } = world();
    // A franchise that is not the one named for the server keys, with none of its own: no QRIS.
    const settings = env({ DOKU_ENV_FRANCHISE: '' });
    const get = async (using = settings) => (await handleDokuSetup({ action: 'get', franchise_id: FRANCHISE }, 'jwt-super', using, fetchFn, now)).body;
    expect(await get()).toMatchObject({ source: 'none', has_keys: false, can_save: true });

    // Titip saldo: the platform's keys are used, and there is nothing for the franchise to fill in.
    state.wallet = true;
    expect(await get()).toMatchObject({ source: 'platform', has_keys: true, can_save: false });
    // Also when it saved keys of its own earlier: the platform owner decides where its money goes.
    await handleDokuSetup({ action: 'save', ...fields, terminal_id: 'C09' }, 'jwt-super', settings, fetchFn, now);
    expect(await get()).toMatchObject({ source: 'platform' });

    later();
    const made = await handleCreate({ token: 'token-tablet', package_id: 'a' }, settings, fetchFn, now);
    expect(made.body.error).toBeUndefined();
    expect(state.generated).toHaveLength(1);

    // Without the platform's keys in place, the franchise is told so rather than given a form.
    expect(await get(env({ DOKU_ENV_FRANCHISE: '', DOKU_CLIENT_ID: '' }))).toMatchObject({ source: 'platform', has_keys: false });
  });

  it('lets the first franchise keep using the server keys until it saves or after it clears its own', async () => {
    const { state, fetchFn } = world();
    const get = async () => (await handleDokuSetup({ action: 'get', franchise_id: FRANCHISE }, 'jwt-super', env(), fetchFn, now)).body;
    expect(await get()).toMatchObject({ source: 'server', has_keys: true });
    expect((await get()).doku).toMatchObject({ clientId: CLIENT, merchantId: '4455' });
    await handleDokuSetup({ action: 'save', ...fields, terminal_id: 'C03' }, 'jwt-super', env(), fetchFn, now);
    expect(await get()).toMatchObject({ source: 'saved' });
    expect((await handleDokuSetup({ action: 'clear', franchise_id: FRANCHISE }, 'jwt-super', env(), fetchFn, now)).body).toEqual({ ok: true });
    expect(state.saved).toBeNull();
    expect(await get()).toMatchObject({ source: 'server' });
  });
});
