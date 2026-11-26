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
const FINA = '00000000-0000-0000-0000-00000000000f';

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
      'ai_edits', 'devices', 'finance_users', 'frames', 'franchise_secrets', 'franchises', 'members', 'payments', 'payouts', 'platform', 'shares', 'superadmins', 'transactions', 'vouchers', 'wallet_banks',
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

  it('count a paid extra copy as money and paper, not as another session', async () => {
    const session = crypto.randomUUID();
    const copy = crypto.randomUUID();
    const before = await rows(`select * from stats_daily(now() - interval '1 day', now() + interval '1 day', 'Asia/Jakarta', $1)`, [franchiseA]);
    const sum = (list: Row[], key: string) => list.reduce((total, row) => total + Number(row[key]), 0);
    await db.query(`select device_push($1, $2::jsonb)`, [
      tokenA,
      JSON.stringify([
        { id: session, at: new Date().toISOString(), session_no: 7, method: 'voucher', price: 5000, prints: 1 },
        // The second guest in the photo pays cash for a copy of their own.
        { id: copy, at: new Date().toISOString(), session_no: 7, package: 'Cetak ulang', method: 'cash', price: 5000, prints: 1, extra: true },
      ]),
    ]);
    expect((await rows('select extra from transactions where id = $1', [copy]))[0].extra).toBe(true);
    expect((await rows('select extra from transactions where id = $1', [session]))[0].extra).toBe(false);
    const after = await rows(`select * from stats_daily(now() - interval '1 day', now() + interval '1 day', 'Asia/Jakarta', $1)`, [franchiseA]);
    expect(sum(after, 'sessions') - sum(before, 'sessions')).toBe(1);
    expect(sum(after, 'prints') - sum(before, 'prints')).toBe(2);
    expect(sum(after, 'revenue') - sum(before, 'revenue')).toBe(5000);
    await db.query('delete from transactions where id = any($1::uuid[])', [[session, copy]]);
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

  it('guard the AI edit: only for a franchise that has it, one result per session, three tries, and that franchise\'s monthly limit', async () => {
    const file = (code: string) => JSON.stringify({ key: `s/${code}/p1.jpg`, size: 1000, type: 'image/jpeg' });
    const begin = (code: string, photo = 'p1') => one(`select share_ai_begin($1, 'anime', $2) r`, [code, photo]);
    const finish = (id: string, ok: boolean, result: string | null = null) =>
      one(`select share_ai_finish($1::uuid, $2, $3::jsonb, $4) r`, [id, ok, result, ok ? null : 'ditolak layanan AI']);
    const codes = ['ai0000000001', 'ai0000000002', 'ai0000000003', 'ai0000000004'];
    await asRole('service_role', async () => {
      for (const code of codes) {
        expect((await one(`select share_claim($1, $2) r`, [tokenA, code])).ok).toBe(true);
        expect((await one(`select share_add_file($1, $2, 'p1', $3::jsonb) r`, [tokenA, code, file(code)])).ok).toBe(true);
      }
      // Off for every franchise until the platform owner switches it on for that one.
      expect((await begin(codes[0])).error).toBe('off');
    });
    // Only the platform owner can: a franchise's own admin cannot give themselves the feature.
    await asUser(ANI, async () => {
      expect((await one('select admin_franchise_ai($1, true, 2) r', [franchiseA])).error).toBe('forbidden');
      await db.query('update franchises set ai_enabled = true where id = $1', [franchiseA]).catch(() => undefined);
    });
    expect((await rows('select ai_enabled from franchises where id = $1', [franchiseA]))[0].ai_enabled).toBe(false);
    await asUser(OWNER, async () => {
      expect((await one('select admin_franchise_ai($1, true, 100001) r', [franchiseA])).error).toBe('bad-request');
      expect((await one(`select admin_franchise_ai('00000000-0000-0000-0000-0000000000ff', true, 2) r`)).error).toBe('not-found');
      expect((await one('select admin_franchise_ai($1, true, 2) r', [franchiseA])).ok).toBe(true);
      const listed = (await one('select admin_franchises() r')).franchises as Row[];
      expect(listed.find((row) => row.id === franchiseA)).toMatchObject({ ai_enabled: true, ai_monthly_limit: 2, ai_month: 0 });
      expect(listed.find((row) => row.id === franchiseB)).toMatchObject({ ai_enabled: false, ai_monthly_limit: 300 });
    });
    // The franchise's tablets hear of it at their next sync, and the other franchise's do not.
    expect((await one(`select device_sync($1) r`, [tokenA])).platform.ai).toEqual({ enabled: true });
    expect((await one(`select device_sync($1) r`, [tokenB])).platform.ai).toEqual({ enabled: false });
    await asRole('service_role', async () => {
      // Another franchise's session stays without, whatever franchise A bought.
      expect((await one(`select share_claim($1, 'ai00000000b1') r`, [tokenB])).ok).toBe(true);
      expect((await one(`select share_add_file($1, 'ai00000000b1', 'p1', $2::jsonb) r`, [tokenB, file('ai00000000b1')])).ok).toBe(true);
      expect((await begin('ai00000000b1')).error).toBe('off');
      expect((await one(`select share_lookup(array['ai00000000b1']) r`)).shares[0].ai).toEqual({ on: false, failed: 0, busy: false });

      expect((await begin('ai0000000009')).error).toBe('not-found');
      expect((await begin(codes[0], 'p2')).error).toBe('no-photo');

      // Three tries that fail, then no more; a failure never becomes a result.
      for (let attempt = 0; attempt < 3; attempt++) {
        const started = await begin(codes[0]);
        expect(started).toMatchObject({ ok: true, key: `s/${codes[0]}/p1.jpg`, type: 'image/jpeg' });
        // A second tap while the first is still being drawn is turned away.
        expect((await begin(codes[0])).error).toBe('busy');
        expect((await finish(started.id, false)).ok).toBe(true);
        // Finishing twice changes nothing.
        expect((await finish(started.id, true, '{"key":"x"}')).error).toBe('not-found');
      }
      expect((await begin(codes[0])).error).toBe('tries');
      const failed = (await one(`select share_lookup(array[$1]) r`, [codes[0]])).shares[0];
      expect(failed.ai).toEqual({ on: true, failed: 3, busy: false });
      expect(failed.files.ai).toBeUndefined();

      // One result per session.
      const first = await begin(codes[1]);
      expect((await one(`select share_lookup(array[$1]) r`, [codes[1]])).shares[0].ai).toEqual({ on: true, failed: 0, busy: true });
      await finish(first.id, true, JSON.stringify({ key: `s/${codes[1]}/ai.jpg`, size: 5000, type: 'image/jpeg' }));
      const done = (await one(`select share_lookup(array[$1]) r`, [codes[1]])).shares[0];
      expect(done.files.ai).toMatchObject({ key: `s/${codes[1]}/ai.jpg`, style: 'anime' });
      expect((await begin(codes[1])).error).toBe('used');

      // The franchise's monthly limit (2 here) counts results, not failures.
      const second = await begin(codes[2]);
      await finish(second.id, true, JSON.stringify({ key: `s/${codes[2]}/ai.jpg`, size: 5000, type: 'image/jpeg' }));
      expect((await begin(codes[3])).error).toBe('limit');
    });

    // The platform owner sees this month's use; a franchise admin does not get the platform's totals.
    await asUser(OWNER, async () => {
      const usage = await one('select ai_usage() r');
      expect(usage).toMatchObject({ done: 2, failed: 3, last_error: 'ditolak layanan AI' });
      expect(usage.franchises).toEqual([{ id: franchiseA, name: 'Booth Ani', done: 2 }]);
    });
    await asUser(ANI, async () => {
      expect((await one('select ai_usage() r')).error).toBe('forbidden');
      expect(await rows('select status from ai_edits')).toHaveLength(5);
    });
    await asUser(BUDI, async () => expect(await rows('select status from ai_edits')).toHaveLength(0));
    await asRole('anon', async () => {
      await expect(db.query(`select share_ai_begin('ai0000000004', 'anime', 'p1')`)).rejects.toThrow();
    });

    // Switched off again: no new versions, and the tablets stop sending plain photos.
    const versionOn = (await one(`select device_sync($1) r`, [tokenA])).outlet_version;
    await asUser(OWNER, async () => expect((await one('select admin_franchise_ai($1, false, 2) r', [franchiseA])).ok).toBe(true));
    const off = await one(`select device_sync($1, '{}'::jsonb, $2) r`, [tokenA, versionOn]);
    expect(off.outlet_version).not.toBe(versionOn);
    expect(off.platform.ai).toEqual({ enabled: false });
    await asRole('service_role', async () => expect((await begin(codes[3])).error).toBe('off'));

    await db.query(`delete from shares where code = any($1::text[])`, [[...codes, 'ai00000000b1']]);
    expect(await rows('select 1 from ai_edits')).toHaveLength(0);
    await db.query('update franchises set ai_enabled = false, ai_monthly_limit = 300');
  });

  it('keep a wallet for a franchise that chooses to take QRIS through the platform: fees per payment, one payout request at a time, settled by the owner', async () => {
    const pay = async (token: string) => {
      const made = await asRole('service_role', () => one(`select payment_begin($1, 'satu') r`, [token]));
      await asRole('service_role', () => db.query(`select payment_settle($1, 'paid', '{}'::jsonb)`, [made.id]));
      return made.id as string;
    };
    const summary = (franchise: string) => one('select wallet_summary($1) r', [franchise]);

    // Not a wallet franchise yet: its QRIS goes to its own account, and nothing is held for it.
    const own = await pay(tokenA);
    expect((await rows('select wallet, fee_doku, fee_platform from payments where id = $1', [own]))[0]).toEqual({ wallet: false, fee_doku: 0, fee_platform: 0 });

    // The franchise's own admin chooses titip saldo, and with that agrees to the fees. Another franchise's admin cannot do it for her.
    await asUser(BUDI, async () => expect((await one('select wallet_choose($1, true) r', [franchiseA])).error).toBe('forbidden'));
    await asUser(ANI, async () => {
      expect(await summary(franchiseA)).toMatchObject({ enabled: false, blocked: false, agreed_at: null });
      expect((await one('select wallet_choose($1, null) r', [franchiseA])).error).toBe('bad-request');
      expect((await one('select wallet_choose($1, true) r', [franchiseA])).ok).toBe(true);
      expect((await summary(franchiseA)).agreed_at).toBeTruthy();
    });
    expect((await rows('select wallet_enabled, wallet_blocked, wallet_agreed_by from franchises where id = $1', [franchiseA]))[0]).toEqual({ wallet_enabled: true, wallet_blocked: false, wallet_agreed_by: ANI });
    expect((await rows('select wallet_enabled from franchises where id = $1', [franchiseB]))[0].wallet_enabled).toBe(false);

    // Two payments of 15.000: each leaves 15.000 - 500 (DOKU) - 200 (platform) = 14.300.
    const first = await pay(tokenA);
    await pay(tokenA);
    expect((await rows('select wallet, fee_doku, fee_platform from payments where id = $1', [first]))[0]).toEqual({ wallet: true, fee_doku: 500, fee_platform: 200 });
    // A QR that was never paid adds nothing.
    const open = await asRole('service_role', () => one(`select payment_begin($1, 'satu') r`, [tokenA]));

    // Every charge tells which DOKU account its QR belongs to: the platform's for this one, the franchise's own for the earlier one.
    expect(open.wallet).toBe(true);
    const ownRef = (await rows('select partner_ref from payments where id = $1', [own]))[0].partner_ref;
    await asRole('service_role', async () => {
      expect((await one('select payment_get($1, $2) r', [tokenA, open.id])).wallet).toBe(true);
      expect((await one('select payment_get($1, $2) r', [tokenA, own])).wallet).toBe(false);
      expect(await one('select payment_account($1) r', [open.partner_ref])).toEqual({ franchise_id: franchiseA, wallet: true });
      expect(await one('select payment_account($1) r', [ownRef])).toEqual({ franchise_id: franchiseA, wallet: false });
      expect(await one(`select payment_account('tidak-ada') r`)).toBeNull();
    });
    await asRole('anon', () => expect(db.query(`select payment_account('x')`)).rejects.toThrow(/permission denied/));

    await asUser(ANI, async () => {
      expect(await summary(franchiseA)).toMatchObject({ enabled: true, doku_fee: 500, platform_fee: 200, payout_days: 7, transactions: 2, gross: 30000, fees_doku: 1000, fees_platform: 400, available: 28600, pending: 0, paid_out: 0, bank: null, next_request_at: null });
      // Another franchise's wallet is none of her business.
      expect((await summary(franchiseB)).error).toBe('forbidden');
      expect((await one('select wallet_request($1, 10000) r', [franchiseB])).error).toBe('forbidden');

      // No bank account yet, then a bad one, then a good one.
      expect((await one('select wallet_request($1, 10000) r', [franchiseA])).error).toBe('no-bank');
      expect((await one(`select wallet_save_bank($1, 'BCA', 'bukan nomor', 'Ani') r`, [franchiseA])).error).toBe('bad-request');
      expect((await one(`select wallet_save_bank($1, 'BCA', '1234567890', 'Ani Wijaya') r`, [franchiseA])).ok).toBe(true);
      expect((await summary(franchiseA)).bank).toEqual({ bank: 'BCA', account_no: '1234567890', holder: 'Ani Wijaya' });

      // Never more than what is there.
      expect((await one('select wallet_request($1, 28601) r', [franchiseA])).error).toBe('amount');
      expect((await one('select wallet_request($1, 0) r', [franchiseA])).error).toBe('amount');
      expect((await one('select wallet_request($1, 20000) r', [franchiseA])).ok).toBe(true);
      expect(await summary(franchiseA)).toMatchObject({ available: 8600, pending: 20000, paid_out: 0 });
      // One request at a time.
      expect((await one('select wallet_request($1, 5000) r', [franchiseA])).error).toBe('pending');
      // She cannot mark her own request as paid.
      const mine = (await rows('select id, status, bank from payouts'))[0];
      expect(mine).toMatchObject({ status: 'requested', bank: { bank: 'BCA', account_no: '1234567890', holder: 'Ani Wijaya' } });
      expect((await one('select admin_payout_settle($1, true, null) r', [mine.id])).error).toBe('forbidden');
      expect((await one('select admin_payouts() r')).error).toBe('forbidden');
    });
    // The other franchise sees none of it.
    await asUser(BUDI, async () => {
      expect(await rows('select 1 from payouts')).toHaveLength(0);
      expect(await rows('select 1 from wallet_banks')).toHaveLength(0);
    });

    // The owner sees the request with where to send it, transfers by hand, and marks it.
    let requestId = '';
    await asUser(OWNER, async () => {
      const board = await one('select admin_payouts() r');
      expect(board.requests).toHaveLength(1);
      expect(board.requests[0]).toMatchObject({ franchise: 'Booth Ani', amount: 20000, status: 'requested', bank: { bank: 'BCA', account_no: '1234567890', holder: 'Ani Wijaya' } });
      expect(board.wallets).toEqual([{ id: franchiseA, name: 'Booth Ani', enabled: true, blocked: false, available: 8600, pending: 20000, paid_out: 0 }]);
      expect(board).toMatchObject({ platform_fees: 400, doku_fees: 1000, held: 28600 });
      requestId = board.requests[0].id;
      expect((await one(`select admin_payout_settle($1, true, 'BCA 25/11 ref 778899') r`, [requestId])).ok).toBe(true);
      // Marking it twice changes nothing.
      expect((await one('select admin_payout_settle($1, false, null) r', [requestId])).error).toBe('not-found');
      expect((await one('select admin_payouts() r')).held).toBe(8600);
      expect((await one('select admin_franchises() r')).franchises.find((row: Row) => row.id === franchiseA)).toMatchObject({ wallet_enabled: true, wallet_blocked: false, wallet_available: 8600 });
    });

    await asUser(ANI, async () => {
      expect(await summary(franchiseA)).toMatchObject({ available: 8600, pending: 0, paid_out: 20000 });
      // The next request has to wait its week.
      const soon = await one('select wallet_request($1, 5000) r', [franchiseA]);
      expect(soon.error).toBe('too-soon');
      expect(Date.parse(soon.next_request_at)).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    });
    // A week later she asks again, and this time the owner turns it down: the money is hers again, and she need not wait.
    await db.query(`update payouts set requested_at = requested_at - interval '8 days' where id = $1`, [requestId]);
    await asUser(ANI, async () => expect((await one('select wallet_request($1, 8600) r', [franchiseA])).ok).toBe(true));
    await asUser(OWNER, async () => {
      const open = (await one('select admin_payouts() r')).requests[0];
      expect(open).toMatchObject({ amount: 8600, status: 'requested' });
      expect((await one(`select admin_payout_settle($1, false, 'Nama rekening tidak cocok') r`, [open.id])).ok).toBe(true);
    });
    await asUser(ANI, async () => {
      expect(await summary(franchiseA)).toMatchObject({ available: 8600, pending: 0, paid_out: 20000 });
      expect((await rows(`select note from payouts where status = 'rejected'`))[0].note).toBe('Nama rekening tidak cocok');
      expect((await one('select wallet_request($1, 8600) r', [franchiseA])).ok).toBe(true);
    });

    // New fees apply to new payments only; what was already paid keeps the fees of its day.
    await db.query(`update platform set config = config || '{"wallet": {"dokuFee": 500, "platformFee": 1000, "payoutDays": 3}}'::jsonb where id = 1`);
    const later = await pay(tokenA);
    expect((await rows('select fee_doku, fee_platform from payments where id = $1', [later]))[0]).toEqual({ fee_doku: 500, fee_platform: 1000 });
    expect((await rows('select fee_platform from payments where id = $1', [first]))[0].fee_platform).toBe(200);
    await asUser(ANI, async () => expect(await summary(franchiseA)).toMatchObject({ payout_days: 3, platform_fee: 1000, fees_platform: 1400 }));

    // She goes back to her own account: new QRs no longer go through the platform, but the balance stays to be paid out.
    await asUser(ANI, async () => expect((await one('select wallet_choose($1, false) r', [franchiseA])).ok).toBe(true));
    const after = await pay(tokenA);
    expect((await rows('select wallet from payments where id = $1', [after]))[0].wallet).toBe(false);
    await asUser(ANI, async () => expect(await summary(franchiseA)).toMatchObject({ enabled: false, available: 13500, pending: 8600 }));
    // The QR made while titip saldo was on is still the platform account's, so that it is checked and settled there.
    await db.query(`update payments set created_at = created_at - interval '5 minutes' where id = $1`, [open.id]);
    await asRole('service_role', async () => {
      expect((await one('select payment_get($1, $2) r', [tokenA, open.id])).wallet).toBe(true);
      expect((await one('select payment_stale($1) r', [tokenA])).payments).toMatchObject([{ id: open.id, wallet: true }]);
    });

    // The platform owner can stop titip saldo for one franchise: it is off at once, and cannot be chosen until allowed again.
    await asUser(ANI, async () => {
      expect((await one('select wallet_choose($1, true) r', [franchiseA])).ok).toBe(true);
      expect((await one('select admin_franchise_wallet_allow($1, false) r', [franchiseA])).error).toBe('forbidden');
    });
    await asUser(OWNER, async () => {
      expect((await one('select admin_franchise_wallet_allow($1, null) r', [franchiseA])).error).toBe('bad-request');
      expect((await one('select admin_franchise_wallet_allow($1, false) r', [franchiseA])).ok).toBe(true);
      expect((await one('select admin_franchises() r')).franchises.find((row: Row) => row.id === franchiseA)).toMatchObject({ wallet_enabled: false, wallet_blocked: true });
      expect((await one('select admin_payouts() r')).wallets[0]).toMatchObject({ enabled: false, blocked: true, available: 13500 });
    });
    const stopped = await pay(tokenA);
    expect((await rows('select wallet, fee_platform from payments where id = $1', [stopped]))[0]).toEqual({ wallet: false, fee_platform: 0 });
    await asUser(ANI, async () => {
      expect((await one('select wallet_choose($1, true) r', [franchiseA])).error).toBe('blocked');
      // What she had collected is still hers to ask for.
      expect(await summary(franchiseA)).toMatchObject({ enabled: false, blocked: true, available: 13500, pending: 8600 });
    });
    // Allowing it again does not switch it on: that stays the franchise's own choice.
    await asUser(OWNER, async () => expect((await one('select admin_franchise_wallet_allow($1, true) r', [franchiseA])).ok).toBe(true));
    expect((await rows('select wallet_enabled, wallet_blocked from franchises where id = $1', [franchiseA]))[0]).toEqual({ wallet_enabled: false, wallet_blocked: false });
    await asUser(ANI, async () => expect((await one('select wallet_choose($1, true) r', [franchiseA])).ok).toBe(true));
    // The earlier switch, with which the platform owner turned it on for a franchise, is gone.
    await expect(db.query('select admin_franchise_wallet($1, true)', [franchiseA])).rejects.toThrow(/does not exist/);

    await db.query('delete from payouts');
    await db.query('delete from wallet_banks');
    await db.query('delete from payments where franchise_id = $1', [franchiseA]);
    await db.query('update franchises set wallet_enabled = false, wallet_blocked = false, wallet_agreed_at = null, wallet_agreed_by = null');
    await db.query(`update platform set config = config - 'wallet' where id = 1`);
  });

  it('let finance staff see and settle payout requests, and nothing else of any franchise', async () => {
    await db.query(`insert into auth.users (id, email) values ($1, 'fina@contoh.id')`, [FINA]);
    // One account, one role: a superadmin or a franchise admin is never also finance staff, nor the other way round.
    await asRole('service_role', async () => {
      expect((await one('select svc_finance_add($1, true) r', [OWNER])).error).toBe('taken');
      expect((await one('select svc_finance_add($1, true) r', [ANI])).error).toBe('taken');
      expect((await one('select svc_finance_add($1, true) r', [FINA])).ok).toBe(true);
      expect((await one('select svc_member_add($1, $2, false) r', [FINA, franchiseA])).error).toBe('taken');
      expect(await one('select svc_user_by_email($1) r', ['fina@contoh.id'])).toMatchObject({ user_id: FINA, finance: true, superadmin: false, franchise_id: null });
      expect(await one('select svc_member_of($1) r', [FINA])).toEqual({ franchise_id: null, superadmin: false, finance: true });
      expect((await one('select svc_member_of($1) r', [ANI])).finance).toBe(false);
      expect(await one('select svc_is_superadmin($1) r', [FINA])).toBe(false);
      expect(await one('select svc_can_access($1, $2) r', [FINA, franchiseA])).toBe(false);
    });

    // A request to settle: Ani's franchise takes QRIS through the platform, one payment comes in, she asks for 10.000.
    await asUser(ANI, async () => expect((await one('select wallet_choose($1, true) r', [franchiseA])).ok).toBe(true));
    const made = await asRole('service_role', () => one(`select payment_begin($1, 'satu') r`, [tokenA]));
    await asRole('service_role', () => db.query(`select payment_settle($1, 'paid', '{}'::jsonb)`, [made.id]));
    await asUser(ANI, async () => {
      expect((await one(`select wallet_save_bank($1, 'BCA', '1234567890', 'Ani Wijaya') r`, [franchiseA])).ok).toBe(true);
      expect((await one('select wallet_request($1, 10000) r', [franchiseA])).ok).toBe(true);
    });

    let requestId = '';
    await asUser(FINA, async () => {
      expect(await one('select whoami() r')).toMatchObject({ superadmin: false, finance: true, must_change_password: true, franchise: null });
      await db.exec('select password_changed()');
      expect((await one('select whoami() r')).must_change_password).toBe(false);

      // What the job needs: the open request with where to send it, and each wallet's balance.
      const board = await one('select admin_payouts() r');
      expect(board.requests).toHaveLength(1);
      expect(board.requests[0]).toMatchObject({ franchise: 'Booth Ani', amount: 10000, status: 'requested', settled_by: null, bank: { bank: 'BCA', account_no: '1234567890', holder: 'Ani Wijaya' } });
      expect(board.wallets).toEqual([{ id: franchiseA, name: 'Booth Ani', enabled: true, blocked: false, available: 4300, pending: 10000, paid_out: 0 }]);
      requestId = board.requests[0].id;

      // Nothing of any franchise's dashboard: no rows from the tables, and the franchise and superadmin tools refuse.
      for (const table of ['franchises', 'devices', 'transactions', 'vouchers', 'payments', 'payouts', 'wallet_banks', 'shares', 'frames', 'ai_edits', 'members']) {
        expect(await rows(`select 1 from ${table}`), table).toHaveLength(0);
      }
      for (const table of ['finance_users', 'superadmins', 'franchise_secrets']) {
        await expect(db.query(`select * from ${table}`), table).rejects.toThrow(/permission denied/);
      }
      for (const call of [
        'admin_franchises()', `admin_members('${franchiseA}')`, 'admin_finance()', `admin_franchise_wallet_allow('${franchiseA}', false)`, `wallet_choose('${franchiseA}', false)`,
        `admin_franchise_ai('${franchiseA}', true, 10)`, `admin_save_franchise('${franchiseA}', 'Punyaku', true, null, null)`, 'ai_usage()',
        `franchise_status('${franchiseA}')`, `wallet_summary('${franchiseA}')`, `wallet_request('${franchiseA}', 1000)`,
        `wallet_save_bank('${franchiseA}', 'BCA', '9999999999', 'Fina')`, `save_outlet('${franchiseA}', '{}')`,
      ]) {
        expect(await one(`select ${call} r`), call).toEqual({ error: 'forbidden' });
      }
      await expect(db.query(`update platform set config = '{"name":"punyaku"}'`).then((result) => result.affectedRows)).resolves.toBe(0);
      await expect(db.query(`insert into finance_users (user_id) values ($1)`, [STRANGER])).rejects.toThrow(/permission denied/);
      await expect(db.query(`select svc_finance_add($1, false)`, [STRANGER])).rejects.toThrow(/permission denied/);
      await expect(db.query(`update payouts set status = 'paid'`)).rejects.toThrow(/permission denied/);

      // The transfer is made by hand; marking it records who did.
      expect((await one(`select admin_payout_settle($1, true, 'BCA ref 112233') r`, [requestId])).ok).toBe(true);
      expect((await one('select admin_payouts() r')).requests[0]).toMatchObject({ status: 'paid', note: 'BCA ref 112233', settled_by: 'fina@contoh.id' });
    });
    expect((await rows('select settled_by from payouts where id = $1', [requestId]))[0].settled_by).toBe(FINA);

    // Only the platform owner sees who the finance staff are.
    await asUser(OWNER, async () => {
      const staff = (await one('select admin_finance() r')).users;
      expect(staff).toHaveLength(1);
      expect(staff[0]).toMatchObject({ user_id: FINA, email: 'fina@contoh.id', must_change_password: false });
      expect((await one('select admin_payouts() r')).requests[0].settled_by).toBe('fina@contoh.id');
    });
    await asUser(ANI, async () => {
      expect(await one('select admin_finance() r')).toEqual({ error: 'forbidden' });
      expect(await one('select is_finance() r')).toBe(false);
    });
    await asRole('anon', async () => {
      for (const call of ['is_finance()', 'admin_finance()', 'admin_payouts()', `admin_payout_settle('${requestId}', true, null)`]) {
        await expect(db.query(`select ${call}`), call).rejects.toThrow(/permission denied/);
      }
    });

    // Taken off the job: the same login gets nothing any more.
    await asRole('service_role', () => db.query('select svc_finance_remove($1)', [FINA]));
    await asUser(FINA, async () => {
      expect(await one('select whoami() r')).toMatchObject({ superadmin: false, finance: false, franchise: null });
      expect(await one('select admin_payouts() r')).toEqual({ error: 'forbidden' });
      expect(await one(`select admin_payout_settle($1, false, null) r`, [requestId])).toEqual({ error: 'forbidden' });
    });

    await db.query('delete from payouts');
    await db.query('delete from wallet_banks');
    await db.query('delete from payments where franchise_id = $1', [franchiseA]);
    await db.query('update franchises set wallet_enabled = false, wallet_agreed_at = null, wallet_agreed_by = null where id = $1', [franchiseA]);
    await db.query('delete from auth.users where id = $1', [FINA]);
  });

  it('never lets the platform fee take more than what is left after DOKU\'s', async () => {
    await db.query('update franchises set wallet_enabled = true where id = $1', [franchiseB]);
    await db.query(`update franchises set config = jsonb_set(config, '{packages}', '[{"id": "satu", "name": "murah", "price": 600, "active": true}]'::jsonb) where id = $1`, [franchiseB]);
    const cheap = await asRole('service_role', () => one(`select payment_begin($1, 'satu') r`, [tokenB]));
    expect((await rows('select amount, fee_doku, fee_platform from payments where id = $1', [cheap.id]))[0]).toEqual({ amount: 600, fee_doku: 500, fee_platform: 100 });
    await db.query('delete from payments where franchise_id = $1', [franchiseB]);
    await db.query(`update franchises set wallet_enabled = false, config = jsonb_set(config, '{packages}', '[{"id": "satu", "name": "1 lembar", "price": 20000, "active": true}]'::jsonb) where id = $1`, [franchiseB]);
  });

  it('carry the earlier platform-wide AI switch over to every franchise, once', async () => {
    // Before the switch moved to each franchise, it was one setting for all of them.
    await db.query(`update platform set config = config || '{"ai": {"enabled": true, "monthlyLimit": 50}}'::jsonb where id = 1`);
    await db.exec(SCHEMA);
    expect(await rows('select ai_enabled, ai_monthly_limit from franchises order by name')).toEqual([
      { ai_enabled: true, ai_monthly_limit: 50 },
      { ai_enabled: true, ai_monthly_limit: 50 },
    ]);
    expect((await rows(`select config ? 'ai' as has from platform where id = 1`))[0].has).toBe(false);
    // Running the schema again does not switch a franchise back on that the owner has switched off since.
    await db.query('update franchises set ai_enabled = false where id = $1', [franchiseB]);
    await db.exec(SCHEMA);
    expect((await rows('select ai_enabled from franchises where id = $1', [franchiseB]))[0].ai_enabled).toBe(false);
    expect((await rows('select ai_enabled from franchises where id = $1', [franchiseA]))[0].ai_enabled).toBe(true);
    await db.query('update franchises set ai_enabled = false, ai_monthly_limit = 300');
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
