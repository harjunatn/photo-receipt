import { createHash, createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { jakartaTimestamp, signRequest, stateFromStatus, verifyNotification } from '../supabase/functions/_shared/doku.ts';
import { handleCreate, handleNotify, handleStatus, readEnv, type Env } from '../supabase/functions/_shared/handlers.ts';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PKCS8 = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PKCS1 = keys.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const SECRET = 'SK-rahasia-uji';
const CLIENT = 'BRN-0000-1111111111111';

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
        state.payment = { id: 'pay-1', status: 'pending', amount: 15000, partner_ref: 'FS1', provider_ref: null, expires_at: null, created_at: new Date(0).toISOString() };
        return reply(200, { id: 'pay-1', amount: 15000, partner_ref: 'FS1' });
      }
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
      if (name === 'payment_settle_by_ref') {
        if (args.p_partner_ref === 'FS1' && args.p_amount === 15000) {
          state.payment!.status = 'paid';
          state.settled.push('paid');
        }
        return reply(200, null);
      }
      throw new Error(`rpc tak dikenal: ${name}`);
    }

    if (state.dokuDown) throw new TypeError('fetch failed');
    const path = url.replace('https://doku.test', '');
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
      expect(request).toEqual({ originalReferenceNo: 'DOKU-9', originalPartnerReferenceNo: 'FS1', serviceCode: '47', merchantId: '4455' });
      return reply(200, { responseCode: '2004700', latestTransactionStatus: state.paidAtDoku ? '00' : '03' });
    }
    throw new Error(`alamat tak dikenal: ${url}`);
  };
  return { state, fetchFn };
}

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
    expect((await handleNotify(signed(body), body.replace('FS1', 'FS2'), env(), fetchFn)).status).toBe(401);
    expect((await handleNotify(new Headers(), body, env(), fetchFn)).status).toBe(401);
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
