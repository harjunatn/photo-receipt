import { describe, expect, it } from 'vitest';
import { handleAdmin } from '../supabase/functions/_shared/accounts.ts';
import { open, seal } from '../supabase/functions/_shared/secrets.ts';

const ENV = { supabaseUrl: 'https://proyek.supabase.co', serviceKey: 'service-key' };
const SUPER = '33333333-3333-4333-8333-333333333333';
const ANI = '22222222-2222-4222-8222-222222222222';
const FRANCHISE_A = '11111111-1111-4111-8111-111111111111';
const FRANCHISE_B = '55555555-5555-4555-8555-555555555555';

/** Supabase Auth and the database, as far as managing franchise admins needs them. */
function world() {
  const users = new Map<string, { email: string; password: string }>([
    [SUPER, { email: 'pemilik@contoh.id', password: 'x' }],
    [ANI, { email: 'ani@contoh.id', password: 'x' }],
  ]);
  const members = new Map<string, { franchise: string; temp: boolean }>([[ANI, { franchise: FRANCHISE_A, temp: false }]]);
  const franchises = new Set([FRANCHISE_A, FRANCHISE_B]);
  const calls: string[] = [];
  let made = 0;
  let refuseMembership = false;

  const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = init.headers as Record<string, string>;
    const reply = (status: number, data: unknown) => new Response(data === undefined ? '' : JSON.stringify(data), { status });
    const body = init.body ? JSON.parse(String(init.body)) : {};

    if (url === `${ENV.supabaseUrl}/auth/v1/user`) {
      const who = { 'jwt-super': SUPER, 'jwt-ani': ANI }[headers.Authorization.replace('Bearer ', '')];
      return who ? reply(200, { id: who, email: users.get(who)!.email }) : reply(401, { msg: 'invalid JWT' });
    }
    if (url.startsWith(`${ENV.supabaseUrl}/auth/v1/admin/users`)) {
      // Only the service role may reach the admin API.
      expect(headers.Authorization).toBe('Bearer service-key');
      const id = url.split('/users/')[1];
      calls.push(`auth ${init.method}${id ? ' user' : ''}`);
      if (init.method === 'POST') {
        made += 1;
        const newId = `66666666-6666-4666-8666-66666666666${made}`;
        users.set(newId, { email: body.email, password: body.password });
        return reply(200, { id: newId, email: body.email });
      }
      if (!users.has(id)) return reply(404, { msg: 'User not found' });
      if (init.method === 'PUT') users.get(id)!.password = body.password;
      if (init.method === 'DELETE') {
        users.delete(id);
        members.delete(id);
      }
      return reply(200, {});
    }

    const name = url.split('/rpc/')[1];
    calls.push(name);
    if (name === 'svc_is_superadmin') return reply(200, body.p_user === SUPER);
    if (name === 'svc_can_access') return reply(200, franchises.has(body.p_franchise) && (body.p_user === SUPER || members.get(body.p_user)?.franchise === body.p_franchise));
    if (name === 'svc_franchise_members') return reply(200, [...members].filter(([, m]) => m.franchise === body.p_franchise).map(([id]) => id));
    if (name === 'svc_franchise_delete') {
      const existed = franchises.delete(body.p_franchise);
      for (const [id, m] of members) if (m.franchise === body.p_franchise) members.delete(id);
      return reply(200, existed);
    }
    if (name === 'svc_user_by_email') {
      const found = [...users].find(([, user]) => user.email === body.p_email);
      return reply(200, found ? { user_id: found[0], superadmin: found[0] === SUPER, franchise_id: members.get(found[0])?.franchise ?? null } : {});
    }
    if (name === 'svc_member_add') {
      if (refuseMembership) return reply(200, { error: 'not-found' });
      members.set(body.p_user, { franchise: body.p_franchise, temp: body.p_temp });
      return reply(200, { ok: true });
    }
    if (name === 'svc_member_of') return reply(200, { franchise_id: members.get(body.p_user)?.franchise ?? null, superadmin: body.p_user === SUPER });
    if (name === 'svc_member_flag') {
      members.get(body.p_user)!.temp = body.p_temp;
      return reply(200, undefined);
    }
    if (name === 'svc_member_remove') {
      members.delete(body.p_user);
      return reply(200, undefined);
    }
    throw new Error(`tak dikenal: ${url}`);
  };
  return { users, members, franchises, calls, fetchFn, refuseMembership: () => (refuseMembership = true) };
}

describe('franchise admin accounts', () => {
  const add = { action: 'member-add', franchise_id: FRANCHISE_B, email: ' Budi@Contoh.id ', password: 'sementara-123' };

  it('are managed by the superadmin only', async () => {
    const w = world();
    expect((await handleAdmin(add, '', ENV, w.fetchFn)).status).toBe(401);
    expect((await handleAdmin(add, 'jwt-palsu', ENV, w.fetchFn)).status).toBe(401);
    expect((await handleAdmin(add, 'jwt-ani', ENV, w.fetchFn)).body).toEqual({ error: 'forbidden' });
    expect(w.calls.filter((call) => call.startsWith('auth'))).toHaveLength(0);
    expect(w.users.size).toBe(2);
  });

  it('get a login with the password the superadmin chose, and must change it on first use', async () => {
    const w = world();
    const reply = await handleAdmin(add, 'jwt-super', ENV, w.fetchFn);
    expect(reply.body.ok).toBe(true);
    const id = String(reply.body.user_id);
    expect(w.users.get(id)).toEqual({ email: 'budi@contoh.id', password: 'sementara-123' });
    expect(w.members.get(id)).toEqual({ franchise: FRANCHISE_B, temp: true });
  });

  it('cannot reuse the email of a superadmin or of another franchise admin', async () => {
    const w = world();
    expect((await handleAdmin({ ...add, email: 'ani@contoh.id' }, 'jwt-super', ENV, w.fetchFn)).body.error).toBe('email-taken');
    expect((await handleAdmin({ ...add, email: 'pemilik@contoh.id' }, 'jwt-super', ENV, w.fetchFn)).body.error).toBe('email-taken');
    expect(w.members.get(ANI)).toEqual({ franchise: FRANCHISE_A, temp: false });
    expect(w.calls.filter((call) => call.startsWith('auth'))).toHaveLength(0);
  });

  it('are refused before anything is created when the email or password will not do', async () => {
    const w = world();
    expect((await handleAdmin({ ...add, email: 'bukan-email' }, 'jwt-super', ENV, w.fetchFn)).body.error).toBe('email');
    expect((await handleAdmin({ ...add, password: 'pendek' }, 'jwt-super', ENV, w.fetchFn)).body.error).toBe('password');
    expect((await handleAdmin({ ...add, franchise_id: 'x' }, 'jwt-super', ENV, w.fetchFn)).body.error).toBe('bad-request');
    expect(w.users.size).toBe(2);
  });

  it('are not created for a franchise that does not exist', async () => {
    const w = world();
    expect((await handleAdmin({ ...add, franchise_id: '99999999-9999-4999-8999-999999999999' }, 'jwt-super', ENV, w.fetchFn)).body.error).toBe('not-found');
    expect(w.calls.filter((call) => call.startsWith('auth'))).toHaveLength(0);
    // And should adding the membership fail after all, the new login is taken away again.
    w.refuseMembership();
    expect((await handleAdmin(add, 'jwt-super', ENV, w.fetchFn)).body.error).toBe('not-found');
    expect(w.users.size).toBe(2);
  });

  it('replace a leftover login without a role instead of taking it over', async () => {
    const w = world();
    const OLD = '77777777-7777-4777-8777-777777777777';
    w.users.set(OLD, { email: 'budi@contoh.id', password: 'password-lama' });
    const reply = await handleAdmin(add, 'jwt-super', ENV, w.fetchFn);
    expect(reply.body.ok).toBe(true);
    // The old login is gone (and with it anyone still signed in to it); the admin is a new login.
    expect(w.users.has(OLD)).toBe(false);
    expect(reply.body.user_id).not.toBe(OLD);
    expect(w.users.get(String(reply.body.user_id))).toEqual({ email: 'budi@contoh.id', password: 'sementara-123' });
    expect(w.members.get(String(reply.body.user_id))).toEqual({ franchise: FRANCHISE_B, temp: true });
  });

  it('can be given a new password, which again must be changed at the next sign-in', async () => {
    const w = world();
    expect((await handleAdmin({ action: 'member-password', user_id: ANI, password: 'baru-456789' }, 'jwt-super', ENV, w.fetchFn)).body).toEqual({ ok: true });
    expect(w.users.get(ANI)?.password).toBe('baru-456789');
    expect(w.members.get(ANI)?.temp).toBe(true);
    // The superadmin's own account is never changed through here.
    expect((await handleAdmin({ action: 'member-password', user_id: SUPER, password: 'baru-456789' }, 'jwt-super', ENV, w.fetchFn)).body).toEqual({ error: 'not-found' });
    expect(w.users.get(SUPER)?.password).toBe('x');
  });

  it('can be removed, login and all, but never the superadmin', async () => {
    const w = world();
    expect((await handleAdmin({ action: 'member-remove', user_id: SUPER }, 'jwt-super', ENV, w.fetchFn)).body).toEqual({ error: 'not-found' });
    expect((await handleAdmin({ action: 'member-remove', user_id: ANI }, 'jwt-super', ENV, w.fetchFn)).body).toEqual({ ok: true, login_deleted: true });
    expect(w.users.has(ANI)).toBe(false);
    expect(w.members.has(ANI)).toBe(false);
    expect(w.users.has(SUPER)).toBe(true);
  });
});

describe('deleting a franchise', () => {
  it("removes it together with its admins' logins, and is for the superadmin only", async () => {
    const w = world();
    expect((await handleAdmin({ action: 'franchise-delete', franchise_id: FRANCHISE_A }, 'jwt-ani', ENV, w.fetchFn)).body).toEqual({ error: 'forbidden' });
    expect(w.franchises.has(FRANCHISE_A)).toBe(true);

    expect((await handleAdmin({ action: 'franchise-delete', franchise_id: FRANCHISE_A }, 'jwt-super', ENV, w.fetchFn)).body).toEqual({ ok: true, logins_deleted: 1, logins_left: 0 });
    expect(w.franchises.has(FRANCHISE_A)).toBe(false);
    expect(w.users.has(ANI)).toBe(false);
    expect(w.users.has(SUPER)).toBe(true);
    expect((await handleAdmin({ action: 'franchise-delete', franchise_id: FRANCHISE_A }, 'jwt-super', ENV, w.fetchFn)).body).toEqual({ error: 'not-found' });
  });
});

describe('sealed keys', () => {
  it('open only with the master key they were sealed with, and never look the same twice', async () => {
    const first = await seal('rahasia', 'induk', 'franchise-a');
    const second = await seal('rahasia', 'induk', 'franchise-a');
    expect(first).not.toBe(second);
    expect(first).not.toContain('rahasia');
    expect(await open(first, 'induk', 'franchise-a')).toBe('rahasia');
    expect(await open(first, 'induk-lain', 'franchise-a')).toBeNull();
    expect(await open(first.slice(0, -4) + 'AAAA', 'induk', 'franchise-a')).toBeNull();
    expect(await open('bukan-segel', 'induk', 'franchise-a')).toBeNull();
  });

  it('cannot be opened on another franchise, even with the right master key', async () => {
    const sealed = await seal('rahasia', 'induk', 'franchise-a');
    expect(await open(sealed, 'induk', 'franchise-b')).toBeNull();
  });
});
