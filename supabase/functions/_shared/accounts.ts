/**
 * Dashboard accounts. These functions are called by a signed-in account, so each
 * first asks Supabase Auth whose token it was handed, and then the database
 * what that account may do.
 */
import { rpc, type Env, type Reply } from './handlers.ts';

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type AuthEnv = Pick<Env, 'supabaseUrl' | 'serviceKey'>;

const text = (value: unknown) => (typeof value === 'string' ? value : '');
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The account behind a bearer token, or null when it is missing, expired or made up. */
export async function callerOf(env: AuthEnv, fetchFn: Fetch, bearer: string): Promise<{ id: string; email: string } | null> {
  if (!bearer) return null;
  const response = await fetchFn(`${env.supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${bearer}` },
  });
  if (!response.ok) return null;
  const user = (await response.json().catch(() => null)) as { id?: unknown; email?: unknown } | null;
  return user && typeof user.id === 'string' && UUID.test(user.id) ? { id: user.id, email: text(user.email) } : null;
}

/** Supabase Auth's admin API, which only the service role may call. */
async function authAdmin(env: AuthEnv, fetchFn: Fetch, method: 'POST' | 'PUT' | 'DELETE', path: string, body?: Record<string, unknown>) {
  const response = await fetchFn(`${env.supabaseUrl}/auth/v1/admin/${path}`, {
    method,
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const reply = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: response.ok, status: response.status, body: reply ?? {} };
}

const refuse = (error: string, message?: string): Reply => ({ status: 200, body: message ? { error, message } : { error } });

/** What the database knows of the login behind an email address. */
interface Existing {
  user_id?: string;
  superadmin?: boolean;
  finance?: boolean;
  franchise_id?: string | null;
}

/** Why an email cannot be given a new role, or '' when its login has none. One account, one role. */
function takenBy(existing: Existing): string {
  if (existing.superadmin) return 'Email itu adalah akun superadmin.';
  if (existing.finance) return 'Email itu sudah menjadi akun keuangan.';
  if (existing.franchise_id) return 'Email itu sudah menjadi admin sebuah franchise.';
  return '';
}

const authError = (reply: { body: Record<string, unknown>; status: number }) => text(reply.body.msg) || text(reply.body.message) || String(reply.status);

/**
 * admin, for the superadmin only: creates, re-keys and removes the accounts of
 * franchise admins and of finance staff, and deletes a franchise together with
 * its admins' logins. Passwords are chosen by the superadmin and handed over;
 * the dashboard then asks the account to choose its own.
 */
export async function handleAdmin(input: Record<string, unknown>, bearer: string, env: AuthEnv, fetchFn: Fetch = fetch): Promise<Reply> {
  const caller = await callerOf(env, fetchFn, bearer);
  if (!caller) return { status: 401, body: { error: 'signed-out' } };
  if ((await rpc<boolean>(env, fetchFn, 'svc_is_superadmin', { p_user: caller.id })) !== true) return refuse('forbidden');

  const password = text(input.password);
  const weak = password.length < 8 || password.length > 72;

  if (input.action === 'member-add') {
    const franchiseId = text(input.franchise_id);
    const email = text(input.email).trim().toLowerCase();
    if (!UUID.test(franchiseId)) return refuse('bad-request');
    if (!EMAIL.test(email) || email.length > 200) return refuse('email', 'Alamat email tidak sah.');
    if (weak) return refuse('password', 'Password minimal 8 karakter.');
    // Nothing is touched for a franchise that does not exist.
    if ((await rpc<boolean>(env, fetchFn, 'svc_can_access', { p_user: caller.id, p_franchise: franchiseId })) !== true) return refuse('not-found');

    const existing = await rpc<Existing>(env, fetchFn, 'svc_user_by_email', { p_email: email });
    if (existing.user_id) {
      const taken = takenBy(existing);
      if (taken) return refuse('email-taken', taken);
      // A login without any role, e.g. left over from a deleted franchise. It is replaced by a new one rather than
      // taken over, so that nobody still signed in to the old login ends up inside this franchise.
      const gone = await authAdmin(env, fetchFn, 'DELETE', `users/${existing.user_id}`);
      if (!gone.ok) return refuse('auth', `Supabase Auth menolak menghapus akun lama: ${text(gone.body.msg) || text(gone.body.message) || gone.status}`);
    }
    const made = await authAdmin(env, fetchFn, 'POST', 'users', { email, password, email_confirm: true });
    const userId = text(made.body.id);
    if (!made.ok || !UUID.test(userId)) return refuse('auth', `Supabase Auth menolak: ${text(made.body.msg) || text(made.body.message) || made.status}`);
    const added = await rpc<{ ok?: boolean; error?: string }>(env, fetchFn, 'svc_member_add', { p_user: userId, p_franchise: franchiseId, p_temp: true });
    if (!added.ok) {
      // Do not leave behind an account that can sign in but belongs nowhere.
      await authAdmin(env, fetchFn, 'DELETE', `users/${userId}`).catch(() => undefined);
      return refuse(added.error === 'not-found' ? 'not-found' : 'email-taken');
    }
    return { status: 200, body: { ok: true, user_id: userId } };
  }

  // Finance staff: an account that only handles payouts. It belongs to no franchise and is no superadmin.
  if (input.action === 'finance-add') {
    const email = text(input.email).trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 200) return refuse('email', 'Alamat email tidak sah.');
    if (weak) return refuse('password', 'Password minimal 8 karakter.');

    const existing = await rpc<Existing>(env, fetchFn, 'svc_user_by_email', { p_email: email });
    if (existing.user_id) {
      const taken = takenBy(existing);
      if (taken) return refuse('email-taken', taken);
      // A login without any role is replaced, as for a franchise admin: whoever still holds the old one stays outside.
      const gone = await authAdmin(env, fetchFn, 'DELETE', `users/${existing.user_id}`);
      if (!gone.ok) return refuse('auth', `Supabase Auth menolak menghapus akun lama: ${authError(gone)}`);
    }
    const made = await authAdmin(env, fetchFn, 'POST', 'users', { email, password, email_confirm: true });
    const userId = text(made.body.id);
    if (!made.ok || !UUID.test(userId)) return refuse('auth', `Supabase Auth menolak: ${authError(made)}`);
    const added = await rpc<{ ok?: boolean; error?: string }>(env, fetchFn, 'svc_finance_add', { p_user: userId, p_temp: true });
    if (!added.ok) {
      await authAdmin(env, fetchFn, 'DELETE', `users/${userId}`).catch(() => undefined);
      return refuse('email-taken');
    }
    return { status: 200, body: { ok: true, user_id: userId } };
  }

  if (input.action === 'finance-password' || input.action === 'finance-remove') {
    const userId = text(input.user_id);
    if (!UUID.test(userId)) return refuse('bad-request');
    const target = await rpc<{ finance?: boolean; superadmin?: boolean; franchise_id?: string | null }>(env, fetchFn, 'svc_member_of', { p_user: userId });
    // Only finance accounts are managed here; a superadmin or a franchise admin is never touched.
    if (!target.finance || target.superadmin || target.franchise_id) return refuse('not-found');

    if (input.action === 'finance-password') {
      if (weak) return refuse('password', 'Password minimal 8 karakter.');
      const updated = await authAdmin(env, fetchFn, 'PUT', `users/${userId}`, { password });
      if (!updated.ok) return refuse('auth', `Supabase Auth menolak: ${authError(updated)}`);
      await rpc(env, fetchFn, 'svc_finance_flag', { p_user: userId, p_temp: true });
      return { status: 200, body: { ok: true } };
    }

    // The role goes first: even if deleting the login fails, the account can no longer see any payout.
    await rpc(env, fetchFn, 'svc_finance_remove', { p_user: userId });
    const deleted = await authAdmin(env, fetchFn, 'DELETE', `users/${userId}`);
    return { status: 200, body: { ok: true, login_deleted: deleted.ok } };
  }

  if (input.action === 'franchise-delete') {
    const franchiseId = text(input.franchise_id);
    if (!UUID.test(franchiseId)) return refuse('bad-request');
    // Its admins' logins go first, so that none of them is left able to sign in to nothing.
    const members = (await rpc<string[] | null>(env, fetchFn, 'svc_franchise_members', { p_franchise: franchiseId })) ?? [];
    if ((await rpc<boolean>(env, fetchFn, 'svc_franchise_delete', { p_franchise: franchiseId })) !== true) return refuse('not-found');
    let loginsLeft = 0;
    for (const userId of members) {
      if (!UUID.test(userId)) continue;
      const deleted = await authAdmin(env, fetchFn, 'DELETE', `users/${userId}`).catch(() => null);
      if (!deleted?.ok) loginsLeft += 1;
    }
    return { status: 200, body: { ok: true, logins_deleted: members.length - loginsLeft, logins_left: loginsLeft } };
  }

  if (input.action === 'member-password' || input.action === 'member-remove') {
    const userId = text(input.user_id);
    if (!UUID.test(userId)) return refuse('bad-request');
    const target = await rpc<{ franchise_id?: string | null; superadmin?: boolean; finance?: boolean }>(env, fetchFn, 'svc_member_of', { p_user: userId });
    // Only franchise admins are managed here; a superadmin or finance account is never touched.
    if (!target.franchise_id || target.superadmin || target.finance) return refuse('not-found');

    if (input.action === 'member-password') {
      if (weak) return refuse('password', 'Password minimal 8 karakter.');
      const updated = await authAdmin(env, fetchFn, 'PUT', `users/${userId}`, { password });
      if (!updated.ok) return refuse('auth', `Supabase Auth menolak: ${text(updated.body.msg) || text(updated.body.message) || updated.status}`);
      await rpc(env, fetchFn, 'svc_member_flag', { p_user: userId, p_temp: true });
      return { status: 200, body: { ok: true } };
    }

    // Removing the membership first: even if deleting the login fails, the account can no longer see anything.
    await rpc(env, fetchFn, 'svc_member_remove', { p_user: userId });
    const deleted = await authAdmin(env, fetchFn, 'DELETE', `users/${userId}`);
    return { status: 200, body: { ok: true, login_deleted: deleted.ok } };
  }

  return refuse('bad-request');
}
