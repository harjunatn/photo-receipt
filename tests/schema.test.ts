import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The database schema run in a real Postgres (PGlite), to check what matters most
 * with several franchises in one database: nobody sees or changes another's data.
 */

const SCHEMA = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const RESET = readFileSync(new URL('../supabase/reset.sql', import.meta.url), 'utf8');

/** The last single-owner schema, from the repository's history; empty where that history is not available (a shallow clone). */
const OLD_SCHEMA = (() => {
  try {
    return execFileSync('git', ['show', '0f3b0c8:supabase/schema.sql'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
})();

// What Supabase provides around the schema: its roles, and the signed-in user's id.
const SUPABASE = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text, last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  -- Like Supabase's defaults: new functions are callable by every role unless revoked.
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const OWNER = '00000000-0000-0000-0000-00000000000a';
const ANI = '00000000-0000-0000-0000-00000000000b';
const BUDI = '00000000-0000-0000-0000-00000000000c';
const STRANGER = '00000000-0000-0000-0000-00000000000d';

let db: PGlite;
let franchiseA = '';
let franchiseB = '';
let tokenA = '';
let tokenB = '';

type Row = Record<string, any>;

async function rows(sql: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(sql, params)).rows;
}

async function one(sql: string, params: unknown[] = []): Promise<any> {
  return (await rows(sql, params))[0]?.r;
}

/** Runs queries the way a signed-in dashboard account would: as the authenticated role with that user id. */
async function asUser<T>(uid: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`reset role; select set_config('test.uid', '${uid}', false); set role authenticated;`);
  try {
    return await work();
  } finally {
    await db.exec(`reset role; select set_config('test.uid', '', false);`);
  }
}

async function asRole<T>(role: 'anon' | 'service_role', work: () => Promise<T>): Promise<T> {
  await db.exec(`reset role; set role ${role};`);
  try {
    return await work();
  } finally {
    await db.exec('reset role;');
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE);
  await db.exec(SCHEMA);
  await db.exec(`insert into auth.users (id, email) values
    ('${OWNER}', 'pemilik@contoh.id'), ('${ANI}', 'ani@contoh.id'), ('${BUDI}', 'budi@contoh.id'), ('${STRANGER}', 'asing@contoh.id');`);
  // The platform owner signs in first and becomes superadmin; then sets up two franchises with one admin each.
  await asUser(OWNER, async () => {
    expect((await one('select whoami() r')).superadmin).toBe(true);
    franchiseA = (await one(`select admin_save_franchise(null, 'Booth Ani', true, null, 'teman lama') r`)).id;
    franchiseB = (await one(`select admin_save_franchise(null, 'Booth Budi', true, null, null) r`)).id;
  });
  await asRole('service_role', async () => {
    expect((await one('select svc_member_add($1, $2, true) r', [ANI, franchiseA])).ok).toBe(true);
    expect((await one('select svc_member_add($1, $2, false) r', [BUDI, franchiseB])).ok).toBe(true);
  });
  await asUser(ANI, async () => {
    await db.query(`insert into devices (franchise_id, name) values ($1, 'Tablet Ani')`, [franchiseA]);
    await db.query(`insert into vouchers (franchise_id, code) values ($1, 'FOTO-SAMA1'), ($1, 'FOTO-ANI22')`, [franchiseA]);
    expect((await one(`select save_outlet($1, $2::jsonb) r`, [franchiseA, JSON.stringify({ brand: { title: 'Ani Snap', accent: '#aa0000' }, payment: { qris: true, qrisAuto: true }, packages: [{ id: 'satu', name: '1 lembar', price: 15000, active: true }] })])).ok).toBe(true);
  });
  await asUser(BUDI, async () => {
    await db.query(`insert into devices (franchise_id, name) values ($1, 'Tablet Budi')`, [franchiseB]);
    await db.query(`insert into vouchers (franchise_id, code) values ($1, 'FOTO-SAMA1')`, [franchiseB]);
    await one(`select save_outlet($1, $2::jsonb) r`, [franchiseB, JSON.stringify({ brand: { title: 'Budi Booth' }, payment: { qris: true, qrisAuto: true }, packages: [{ id: 'satu', name: '1 lembar', price: 20000, active: true }] })]);
  });
  // Each tablet is paired with the code and PIN the database made for its device.
  const pair = async (name: string) => {
    const [device] = await rows('select code, pin from devices where name = $1', [name]);
    expect(device.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(device.pin).toMatch(/^\d{6}$/);
    return (await one('select device_pair($1, $2) r', [device.code, device.pin])).token as string;
  };
  tokenA = await pair('Tablet Ani');
  tokenB = await pair('Tablet Budi');
}, 60_000);

describe('schema', () => {
  it('can be run again without error, and without undoing what the platform owner saved', async () => {
    await db.exec(`update platform set config = '{"name":"Nama Baru","graceDays":3}'`);
    await db.exec(SCHEMA);
    expect((await rows('select config from platform'))[0].config).toEqual({ name: 'Nama Baru', graceDays: 3 });
    await db.exec(`update platform set config = '{"name":"jepretin","watermark":"didukung oleh jepretin","receiptLine":"@jepretin","graceDays":7}'`);
  });

  it('lets the dashboard hear of used vouchers live, and adds the table to Realtime only once', async () => {
    const fresh = new PGlite();
    await fresh.exec(SUPABASE);
    await fresh.exec('create publication supabase_realtime');
    await fresh.exec(SCHEMA);
    await fresh.exec(SCHEMA);
    const published = await fresh.query<{ tablename: string }>(`select tablename from pg_publication_tables where pubname = 'supabase_realtime'`);
    expect(published.rows.map((row) => row.tablename)).toEqual(['vouchers']);
    await fresh.close();
  });

  it('starts with the same platform settings the app shows by default', async () => {
    const fresh = new PGlite();
    await fresh.exec(SUPABASE);
    await fresh.exec(SCHEMA);
    const config = (await fresh.query<{ config: unknown }>('select config from platform')).rows[0].config;
    expect(config).toEqual({ name: 'jepretin', watermark: 'didukung oleh jepretin', receiptLine: '@jepretin', graceDays: 7 });
    await fresh.close();
  });

  it.skipIf(!OLD_SCHEMA)('replaces the earlier single-owner schema after a reset', async () => {
    const fresh = new PGlite();
    await fresh.exec(SUPABASE);
    await fresh.exec(OLD_SCHEMA);
    await fresh.exec(RESET);
    await fresh.exec(SCHEMA);
    const tables = await fresh.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' order by 1`);
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      'devices', 'frames', 'franchise_secrets', 'franchises', 'members', 'payments', 'platform', 'shares', 'superadmins', 'transactions', 'vouchers',
    ]);
    const left = await fresh.query(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname in ('is_owner', 'claim_owner')`);
    expect(left.rows).toHaveLength(0);
    await fresh.close();
  }, 60_000);
});

describe('accounts', () => {
  it('makes only the first account superadmin', async () => {
    await asUser(ANI, async () => {
      const me = await one('select whoami() r');
      expect(me).toMatchObject({ superadmin: false, must_change_password: true, franchise: { id: franchiseA, name: 'Booth Ani' } });
    });
    await asUser(STRANGER, async () => {
      expect(await one('select whoami() r')).toMatchObject({ superadmin: false, franchise: null });
    });
  });

  it('lets an admin clear the "change your password" flag, only for themself', async () => {
    await asUser(BUDI, () => db.exec('select password_changed()'));
    expect((await rows('select must_change_password from members where user_id = $1', [ANI]))[0].must_change_password).toBe(true);
    await asUser(ANI, () => db.exec('select password_changed()'));
    expect((await rows('select must_change_password from members where user_id = $1', [ANI]))[0].must_change_password).toBe(false);
  });

  it('keeps one account to one franchise', async () => {
    await asRole('service_role', async () => {
      expect((await one('select svc_member_add($1, $2, false) r', [ANI, franchiseB])).error).toBe('taken');
      expect(await one('select svc_can_access($1, $2) r', [ANI, franchiseA])).toBe(true);
      expect(await one('select svc_can_access($1, $2) r', [ANI, franchiseB])).toBe(false);
      expect(await one('select svc_can_access($1, $2) r', [OWNER, franchiseB])).toBe(true);
      expect(await one('select svc_user_by_email($1) r', [' ANI@contoh.id '])).toMatchObject({ user_id: ANI, franchise_id: franchiseA, superadmin: false });
    });
  });
});

describe('one franchise cannot reach another', () => {
  it('shows an admin only their own franchise, devices, vouchers and transactions', async () => {
    await db.query(`select device_push($1, $2::jsonb)`, [tokenA, JSON.stringify([{ id: crypto.randomUUID(), at: new Date().toISOString(), method: 'cash', price: 15000 }])]);
    await db.query(`select device_push($1, $2::jsonb)`, [tokenB, JSON.stringify([{ id: crypto.randomUUID(), at: new Date().toISOString(), method: 'cash', price: 20000 }])]);
    await asUser(ANI, async () => {
      expect((await rows('select id, name from franchises')).map((row) => row.name)).toEqual(['Booth Ani']);
      expect((await rows('select name from devices')).map((row) => row.name)).toEqual(['Tablet Ani']);
      expect(await rows('select code from vouchers order by code')).toHaveLength(2);
      expect((await rows('select price from transactions')).map((row) => row.price)).toEqual([15000]);
      const stats = await rows(`select * from stats_daily(now() - interval '1 day', now() + interval '1 day', 'Asia/Jakarta', null)`);
      expect(stats.map((row) => Number(row.revenue))).toEqual([15000]);
      // Asking for the other franchise by name gives nothing rather than its numbers.
      expect(await rows(`select * from stats_daily(now() - interval '1 day', now() + interval '1 day', 'Asia/Jakarta', $1)`, [franchiseB])).toHaveLength(0);
      expect(await one('select voucher_counts($1) r', [franchiseB])).toMatchObject({ active: 0 });
    });
  });

  it('refuses writes into another franchise', async () => {
    await asUser(ANI, async () => {
      await expect(db.query(`insert into devices (franchise_id, name) values ($1, 'Selundupan')`, [franchiseB])).rejects.toThrow(/row-level security/);
      await expect(db.query(`insert into vouchers (franchise_id, code) values ($1, 'GRATIS-1')`, [franchiseB])).rejects.toThrow(/row-level security/);
      expect((await db.query(`update devices set name = 'Diambil' where name = 'Tablet Budi'`)).affectedRows).toBe(0);
      expect((await db.query(`delete from vouchers where franchise_id = $1`, [franchiseB])).affectedRows).toBe(0);
      // Moving one's own device into the other franchise is refused too.
      await expect(db.query(`update devices set franchise_id = $1 where name = 'Tablet Ani'`, [franchiseB])).rejects.toThrow(/permission denied/);
      const [budi] = await rows(`select id from devices where name = 'Tablet Ani'`);
      expect(await one('select device_unpair($1) r', [budi.id])).toEqual({ ok: true });
      expect(await one(`select save_outlet($1, '{}'::jsonb) r`, [franchiseB])).toEqual({ error: 'forbidden' });
      expect(await one(`select franchise_status($1) r`, [franchiseB])).toEqual({ error: 'forbidden' });
    });
    expect((await rows(`select name from devices where franchise_id = $1`, [franchiseB]))[0].name).toBe('Tablet Budi');
    // Ani unpaired her own tablet just now; it pairs again like any other.
    const [device] = await rows(`select code, pin from devices where name = 'Tablet Ani'`);
    expect(await one(`select device_sync($1) r`, [tokenA])).toEqual({ error: 'unpaired' });
    tokenA = (await one('select device_pair($1, $2) r', [device.code, device.pin])).token;
  });

  it("lets an admin write only what a dashboard needs: no codes, tokens or other tenants' devices", async () => {
    const [other] = await rows(`select id from devices where franchise_id = $1`, [franchiseB]);
    await asUser(ANI, async () => {
      // Device codes are made by the database, so nobody can probe for another franchise's code.
      await expect(db.query(`insert into devices (franchise_id, name, code) values ($1, 'Tebak', 'ZZZ999')`, [franchiseA])).rejects.toThrow(/permission denied/);
      await expect(db.query(`update devices set code = 'ZZZ999'`)).rejects.toThrow(/permission denied/);
      // Nor can a token be planted, or the status and settings columns be stuffed.
      await expect(db.query(`update devices set token_hash = 'abc'`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`update devices set status = '{}'`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`update devices set settings = '{}'`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`update devices set pin = 'abc'`)).rejects.toThrow(/check constraint/);
      expect(await one('select device_unpair($1) r', [other.id])).toEqual({ error: 'not-found' });
      // Vouchers are made and deleted, never marked used, from the dashboard.
      await expect(db.query(`update vouchers set used_at = null`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`insert into vouchers (franchise_id, code, used_by) values ($1, 'X-1', $2)`, [franchiseA, other.id])).rejects.toThrow(/permission denied/);
      // A frame must be a real picture, not an address to fetch.
      const layout = JSON.stringify({ width: 10, height: 10, slots: [{ x: 1, y: 1, w: 5, h: 5 }] });
      await expect(db.query(`insert into frames (franchise_id, name, layout, image) values ($1, 'x', $2::jsonb, 'data:image/svg+xml;base64,AAAA')`, [franchiseA, layout])).rejects.toThrow(/check constraint/);
      await expect(db.query(`insert into frames (franchise_id, name, layout, image, thumb) values ($1, 'x', $2::jsonb, 'data:image/png;base64,AAAA', 'https://contoh.id/x.png')`, [franchiseA, layout])).rejects.toThrow(/check constraint/);
    });
    await asRole('anon', async () => {
      for (const call of [`franchise_state(true, null, 7)`, 'new_device_code()', `device_unpair('${other.id}')`]) {
        await expect(db.query(`select ${call}`)).rejects.toThrow(/permission denied/);
      }
    });
  });

  it('caps how much one franchise can store', async () => {
    const layout = JSON.stringify({ width: 10, height: 10, slots: [{ x: 1, y: 1, w: 5, h: 5 }] });
    await asUser(ANI, async () => {
      await db.query(`insert into frames (franchise_id, name, layout, image) select $1, 'kuota ' || n, $2::jsonb, 'data:image/png;base64,AAAA' from generate_series(1, 20) n`, [franchiseA, layout]);
      await expect(db.query(`insert into frames (franchise_id, name, layout, image) values ($1, 'satu lagi', $2::jsonb, 'data:image/png;base64,AAAA')`, [franchiseA, layout])).rejects.toThrow(/Batas frames/);
      await db.query(`delete from frames where name like 'kuota %'`);
      await expect(db.query(`insert into devices (franchise_id, name) select $1, 'banyak ' || n from generate_series(1, 200) n`, [franchiseA])).rejects.toThrow(/Batas devices/);
    });
    // The other franchise is not affected by the first one's count.
    await asUser(BUDI, () => db.query(`insert into frames (franchise_id, name, layout, image) values ($1, 'punya budi', $2::jsonb, 'data:image/png;base64,AAAA')`, [franchiseB, layout]));
    await db.exec(`delete from frames where name = 'punya budi'`);
  });

  it('keeps subscription, notes and superadmin tools away from franchise admins', async () => {
    await asUser(ANI, async () => {
      await expect(db.query('select note from franchises')).rejects.toThrow(/permission denied/);
      await expect(db.query(`update franchises set paid_until = '2099-01-01'`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`insert into members (user_id, franchise_id) values ($1, $2)`, [STRANGER, franchiseA])).rejects.toThrow(/permission denied/);
      await expect(db.query('select * from superadmins')).rejects.toThrow(/permission denied/);
      await expect(db.query('select * from franchise_secrets')).rejects.toThrow(/permission denied/);
      expect(await one('select admin_franchises() r')).toEqual({ error: 'forbidden' });
      expect(await one(`select admin_save_franchise($1, 'Punyaku', true, '2099-01-01', null) r`, [franchiseA])).toEqual({ error: 'forbidden' });
      expect(await one(`select admin_members($1) r`, [franchiseA])).toEqual({ error: 'forbidden' });
      await expect(db.query(`update platform set config = '{"name":"punyaku"}'`).then((result) => result.affectedRows)).resolves.toBe(0);
      await expect(db.query(`update platform set superadmin_claimed_at = null`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`select svc_doku_get($1)`, [franchiseA])).rejects.toThrow(/permission denied/);
      await expect(db.query(`select svc_member_add($1, $2, false)`, [STRANGER, franchiseA])).rejects.toThrow(/permission denied/);
      await expect(db.query(`select payment_begin('x', 'satu')`)).rejects.toThrow(/permission denied/);
    });
  });

  it('gives someone holding only the public key nothing but the tablet functions', async () => {
    await asRole('anon', async () => {
      for (const table of ['franchises', 'devices', 'transactions', 'vouchers', 'payments', 'shares', 'frames', 'members', 'platform']) {
        await expect(db.query(`select * from ${table}`)).rejects.toThrow(/permission denied/);
      }
      for (const call of ['whoami()', 'admin_franchises()', `save_outlet('${franchiseA}', '{}')`, `svc_is_superadmin('${OWNER}')`, `svc_franchise_delete('${franchiseA}')`, `share_lookup(array['x'])`, `token_hash('x')`]) {
        await expect(db.query(`select ${call}`)).rejects.toThrow(/permission denied/);
      }
      expect(await one(`select device_sync('salah') r`)).toEqual({ error: 'unpaired' });
    });
  });

  it('tells anyone the platform name and its public lines, and nothing else of the platform', async () => {
    await db.exec(`update platform set config = '{"name":"jepretin","watermark":"didukung oleh jepretin","receiptLine":"@jepretin","graceDays":7,"catatan":"rahasia"}'`);
    for (const role of ['anon', 'service_role'] as const) {
      await asRole(role, async () => {
        expect(await one('select platform_public() r')).toEqual({ name: 'jepretin', watermark: 'didukung oleh jepretin', receiptLine: '@jepretin' });
      });
    }
    await asUser(ANI, async () => {
      expect((await one('select platform_public() r')).name).toBe('jepretin');
    });
    // A platform whose owner saved only a name: the tablet fills the rest with its defaults.
    await db.exec(`update platform set config = '{"name":"Nama Baru"}'`);
    await asRole('anon', async () => {
      expect(await one('select platform_public() r')).toEqual({ name: 'Nama Baru', watermark: null, receiptLine: null });
    });
    await db.exec(`update platform set config = '{"name":"jepretin","watermark":"didukung oleh jepretin","receiptLine":"@jepretin","graceDays":7}'`);
  });

  it('lets the superadmin see and change everything', async () => {
    await asUser(OWNER, async () => {
      expect(await rows('select name from devices order by name')).toHaveLength(2);
      const list = await one('select admin_franchises() r');
      expect(list.franchises.map((f: Row) => [f.name, f.devices, f.members, f.sessions_30d, Number(f.revenue_30d), f.note])).toEqual([
        ['Booth Ani', 1, 1, 1, 15000, 'teman lama'],
        ['Booth Budi', 1, 1, 1, 20000, null],
      ]);
      expect((await one('select admin_members($1) r', [franchiseA])).members[0]).toMatchObject({ email: 'ani@contoh.id' });
      expect((await db.query(`update devices set name = 'Tablet Budi 2' where franchise_id = $1`, [franchiseB])).affectedRows).toBe(1);
      expect((await db.query(`update platform set config = '{"name":"jepretin","graceDays":7}'`)).affectedRows).toBe(1);
      expect(await one(`select save_outlet($1, (select config from franchises where id = $1)) r`, [franchiseB])).toEqual({ ok: true });
    });
  });
});

describe('tablets', () => {
  it('get their own franchise settings, the platform settings and the subscription state', async () => {
    const first = await one(`select device_sync($1, '{"printer":"connected"}'::jsonb, null) r`, [tokenA]);
    expect(first.outlet.brand.title).toBe('Ani Snap');
    expect(first.platform.name).toBe('jepretin');
    expect(first.franchise).toEqual({ id: franchiseA, name: 'Booth Ani' });
    expect(first.subscription).toMatchObject({ active: true, paid_until: null, grace_days: 7, state: 'active' });
    // Nothing changed: the settings are not sent again.
    const again = await one(`select device_sync($1, '{}'::jsonb, $2) r`, [tokenA, first.outlet_version]);
    expect(again.outlet).toBeUndefined();
    expect(again.subscription.state).toBe('active');
    // A change to the platform settings reaches every tablet.
    await db.exec(`update platform set config = config || '{"social":"@jepretin"}'`);
    const after = await one(`select device_sync($1, '{}'::jsonb, $2) r`, [tokenA, first.outlet_version]);
    expect(after.platform.social).toBe('@jepretin');
    expect((await one(`select device_sync($1) r`, [tokenB])).outlet.brand.title).toBe('Budi Booth');
  });

  it('record whether staff confirmed a cash or static-QRIS payment, and count an older tablet as confirmed', async () => {
    const at = new Date().toISOString();
    const loose = crypto.randomUUID();
    const older = crypto.randomUUID();
    await db.query(`select device_push($1, $2::jsonb)`, [
      tokenA,
      JSON.stringify([
        { id: loose, at, method: 'cash', price: 15000, staff_confirmed: false },
        // A tablet that has not updated yet does not send the field.
        { id: older, at, method: 'cash', price: 15000 },
      ]),
    ]);
    const stored = await rows('select id, staff_confirmed from transactions where id = any($1::uuid[])', [[loose, older]]);
    expect(Object.fromEntries(stored.map((row) => [row.id, row.staff_confirmed]))).toEqual({ [loose]: false, [older]: true });
    const listed = await one(`select device_transactions($1, now() - interval '1 day', now() + interval '1 day') r`, [tokenA]);
    expect(listed.rows.find((row: Row) => row.id === loose).staff_confirmed).toBe(false);
    await asUser(ANI, async () => {
      expect((await rows('select staff_confirmed from transactions where id = $1', [loose]))[0].staff_confirmed).toBe(false);
    });
    await db.query('delete from transactions where id = any($1::uuid[])', [[loose, older]]);
  });

  it('redeem only their own franchise vouchers, even when two franchises use the same code', async () => {
    expect(await one(`select device_redeem_voucher($1, 'foto ani22') r`, [tokenB])).toEqual({ status: 'not-found' });
    expect(await one(`select device_redeem_voucher($1, 'fotosama1') r`, [tokenB])).toEqual({ status: 'ok', code: 'FOTO-SAMA1' });
    // Budi's guest used Budi's code; Ani's code with the same letters is still unused.
    expect(await one(`select device_redeem_voucher($1, 'FOTO-SAMA1') r`, [tokenA])).toEqual({ status: 'ok', code: 'FOTO-SAMA1' });
    expect(await one(`select device_redeem_voucher($1, 'FOTO-SAMA1') r`, [tokenA])).toEqual({ status: 'used' });
  });

  it('are charged the price of their own franchise, and payments stay with it', async () => {
    const a = await asRole('service_role', () => one(`select payment_begin($1, 'satu') r`, [tokenA]));
    const b = await asRole('service_role', () => one(`select payment_begin($1, 'satu') r`, [tokenB]));
    expect([a.amount, a.franchise_id]).toEqual([15000, franchiseA]);
    expect([b.amount, b.franchise_id]).toEqual([20000, franchiseB]);
    await asRole('service_role', async () => {
      expect(await one('select payment_franchise($1) r', [b.partner_ref])).toBe(franchiseB);
      expect((await one('select payment_get($1, $2) r', [tokenA, b.id])).error).toBe('not-found');
      expect((await one('select payment_stale($1) r', [tokenA])).franchise_id).toBe(franchiseA);
    });
    await asUser(ANI, async () => {
      expect((await rows('select amount from payments')).map((row) => row.amount)).toEqual([15000]);
    });
  });

  it('fetch only their own franchise custom frames, and only the ones that changed', async () => {
    const layout = JSON.stringify({ width: 100, height: 200, slots: [{ x: 10, y: 10, w: 80, h: 60 }], print: 'ink' });
    await asUser(ANI, () => db.query(`insert into frames (franchise_id, name, layout, image) values ($1, 'Frame Ani', $2::jsonb, 'data:image/png;base64,AAAA')`, [franchiseA, layout]));
    await asUser(BUDI, async () => {
      expect(await rows('select name from frames')).toHaveLength(0);
      await expect(db.query(`insert into frames (franchise_id, name, layout, image) values ($1, 'Selundupan', $2::jsonb, 'data:image/png;base64,AAAA')`, [franchiseA, layout])).rejects.toThrow(/row-level security/);
    });
    const first = await one(`select device_frames($1, '{}'::jsonb) r`, [tokenA]);
    expect(first.frames.map((f: Row) => f.name)).toEqual(['Frame Ani']);
    expect((await one(`select device_frames($1) r`, [tokenB])).ids).toEqual([]);
    const known = JSON.stringify({ [first.frames[0].id]: first.frames[0].updated_at });
    const again = await one(`select device_frames($1, $2::jsonb) r`, [tokenA, known]);
    expect(again.ids).toEqual([first.frames[0].id]);
    expect(again.frames).toEqual([]);
    await db.exec(`update frames set name = 'Frame Ani Baru'`);
    expect((await one(`select device_frames($1, $2::jsonb) r`, [tokenA, known])).frames[0].name).toBe('Frame Ani Baru');
    // The sync tells the tablet when to ask again.
    const before = (await one(`select device_sync($1) r`, [tokenA])).frames_version;
    await db.exec(`update frames set active = false`);
    expect((await one(`select device_sync($1) r`, [tokenA])).frames_version).not.toBe(before);
    expect((await one(`select device_frames($1) r`, [tokenA])).ids).toEqual([]);
  });

  it('show each guest the brand of the franchise that took the photo', async () => {
    await asRole('service_role', async () => {
      expect((await one(`select share_claim($1, 'aaaaaaaaaaa2') r`, [tokenA])).ok).toBe(true);
      expect((await one(`select share_claim($1, 'bbbbbbbbbbb3') r`, [tokenB])).ok).toBe(true);
      expect((await one(`select share_claim($1, 'aaaaaaaaaaa2') r`, [tokenB])).error).toBe('taken');
      const found = await one(`select share_lookup(array['aaaaaaaaaaa2', 'bbbbbbbbbbb3']) r`);
      const brands = Object.fromEntries(found.shares.map((share: Row) => [share.code, share.brand.title]));
      expect(brands).toEqual({ aaaaaaaaaaa2: 'Ani Snap', bbbbbbbbbbb3: 'Budi Booth' });
      expect(found.platform.name).toBe('jepretin');
    });
  });
});

describe('subscription', () => {
  const setPaidUntil = (daysFromToday: number | null, active = true) =>
    asUser(OWNER, () =>
      one(
        `select admin_save_franchise($1, 'Booth Budi', $2, case when $3::int is null then null else (now() at time zone 'Asia/Jakarta')::date + $3::int end, null) r`,
        [franchiseB, active, daysFromToday],
      ),
    );
  const state = async () => (await one(`select device_sync($1) r`, [tokenB])).subscription.state;

  it('runs through its paid date, then a grace period, then stops the booth', async () => {
    await setPaidUntil(0);
    expect(await state()).toBe('active');
    await setPaidUntil(-1);
    expect(await state()).toBe('grace');
    await setPaidUntil(-7);
    expect(await state()).toBe('grace');
    await setPaidUntil(-8);
    expect(await state()).toBe('expired');
    expect((await asRole('service_role', () => one(`select payment_begin($1, 'satu') r`, [tokenB]))).error).toBe('subscription');
    expect(await one(`select device_redeem_voucher($1, 'APA-SAJA') r`, [tokenB])).toEqual({ status: 'subscription' });
    // Sessions already taken are still recorded, and the other franchise is not affected.
    expect((await one(`select device_push($1, '[]'::jsonb) r`, [tokenB])).ok).toBe(true);
    expect((await one(`select device_sync($1) r`, [tokenA])).subscription.state).toBe('active');
    await asUser(BUDI, async () => {
      expect(await one('select franchise_status($1) r', [franchiseB])).toMatchObject({ state: 'expired', grace_days: 7 });
    });
  });

  it('can be stopped and resumed by the superadmin', async () => {
    await setPaidUntil(30, false);
    expect(await state()).toBe('suspended');
    await setPaidUntil(30, true);
    expect(await state()).toBe('active');
    await setPaidUntil(null);
    expect(await state()).toBe('active');
  });
});

describe('the first superadmin', () => {
  it('is claimed once; an empty superadmin table later does not hand the platform to whoever signs in next', async () => {
    // The worst case: the owner's login is deleted, taking the superadmin row with it.
    await db.exec(`delete from auth.users where id = '${OWNER}'`).catch(() => undefined);
    await db.exec(`delete from superadmins`);
    await asUser(ANI, async () => {
      expect((await one('select whoami() r')).superadmin).toBe(false);
      expect(await one('select admin_franchises() r')).toEqual({ error: 'forbidden' });
    });
    await asUser(STRANGER, async () => {
      expect((await one('select whoami() r')).superadmin).toBe(false);
    });
    expect(await rows('select 1 from superadmins')).toHaveLength(0);
    // The owner is put back by SQL, as the README says.
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'pemilik@contoh.id') on conflict do nothing; insert into superadmins (user_id) values ('${OWNER}')`);
  });

  it('is never claimed on an installation that already has franchises, even if the claim was never recorded', async () => {
    await db.exec(`delete from superadmins; update platform set superadmin_claimed_at = null`);
    await asUser(STRANGER, async () => {
      expect((await one('select whoami() r')).superadmin).toBe(false);
    });
    await db.exec(`insert into superadmins (user_id) values ('${OWNER}'); update platform set superadmin_claimed_at = now()`);
  });
});

describe('deleting a franchise', () => {
  it('takes its devices, sales and admin memberships with it, and nothing else', async () => {
    await asRole('service_role', async () => {
      expect(await one('select svc_franchise_members($1) r', [franchiseB])).toEqual([BUDI]);
      expect(await one('select svc_franchise_delete($1) r', [franchiseB])).toBe(true);
      expect(await one('select svc_franchise_delete($1) r', [franchiseB])).toBe(false);
    });
    expect(await rows('select 1 from devices where franchise_id = $1', [franchiseB])).toHaveLength(0);
    expect(await rows('select 1 from members where user_id = $1', [BUDI])).toHaveLength(0);
    expect(await one(`select device_sync($1) r`, [tokenB])).toEqual({ error: 'unpaired' });
    expect((await one(`select device_sync($1) r`, [tokenA])).franchise.name).toBe('Booth Ani');
    expect(await rows('select 1 from transactions where franchise_id = $1', [franchiseA])).toHaveLength(1);
  });
});
