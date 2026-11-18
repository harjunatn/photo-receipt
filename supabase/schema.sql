-- Hello Snaply — skema Supabase.
-- Tempel seluruh berkas ini di Supabase → SQL Editor → Run. Aman dijalankan ulang.
--
-- Siapa boleh apa:
--   * Pemilik masuk dengan email + password (Supabase Auth) dan boleh membaca/mengubah semua tabel.
--   * Tablet booth TIDAK punya akun. Tablet dipasangkan dengan kode perangkat + PIN, lalu hanya
--     bisa memanggil fungsi device_* di bawah dengan token rahasianya. Tabel tidak bisa dibaca
--     langsung oleh tablet maupun oleh orang yang hanya memegang anon key.

-- ---------------------------------------------------------------- pemilik

create table if not exists public.owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from owners where user_id = auth.uid());
$$;

-- Akun pertama yang masuk ke dashboard menjadi pemilik. Akun lain setelah itu ditolak.
create or replace function public.claim_owner()
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  lock table owners in exclusive mode;
  if not exists (select 1 from owners) then
    insert into owners (user_id) values (auth.uid());
  end if;
  return exists (select 1 from owners where user_id = auth.uid());
end;
$$;

-- ---------------------------------------------------------------- tabel

-- Pengaturan yang sama untuk semua tablet: nama outlet, teks struk, harga, cara bayar.
create table if not exists public.outlet (
  id int primary key default 1 check (id = 1),
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.outlet (id) values (1) on conflict (id) do nothing;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists outlet_touch on public.outlet;
create trigger outlet_touch before update on public.outlet
  for each row execute function public.touch_updated_at();

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Kode perangkat dan PIN diketik sekali di tablet untuk memasangkannya.
  code text not null unique,
  pin text not null,
  pin_fails int not null default 0,
  -- SHA-256 dari token tablet; kosong selama belum dipasangkan.
  token_hash text unique,
  -- Id frame yang ditawarkan tablet ini, berurutan. null = tablet memakai pilihannya sendiri.
  frames text[],
  active boolean not null default true,
  status jsonb not null default '{}'::jsonb,
  paired_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  -- Dibuat di tablet, sehingga kiriman ulang saat internet putus-nyambung tidak menggandakan baris.
  id uuid primary key,
  device_id uuid references public.devices (id) on delete set null,
  -- Salinan nama, supaya riwayat tetap terbaca setelah perangkatnya dihapus.
  device_name text not null,
  at timestamptz not null,
  session_no int,
  frame text,
  package text,
  price int not null default 0,
  method text not null check (method in ('free', 'voucher', 'qris', 'cash')),
  voucher_code text,
  prints int not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists transactions_at on public.transactions (at desc);
create index if not exists transactions_device_at on public.transactions (device_id, at desc);

create table if not exists public.vouchers (
  -- Seperti yang dicetak: AWALAN-XXXXXX.
  code text primary key,
  -- Hanya huruf dan angka, huruf besar: tamu boleh mengetik tanpa tanda hubung.
  norm text generated always as (upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g'))) stored unique,
  label text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  used_at timestamptz,
  used_by uuid references public.devices (id) on delete set null,
  used_by_name text
);
create index if not exists vouchers_created on public.vouchers (created_at desc);

-- Tagihan QRIS otomatis. Dibuat dan diperbarui hanya oleh Edge Functions (lihat supabase/functions).
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references public.devices (id) on delete set null,
  device_name text not null,
  package_id text,
  package_name text,
  amount int not null check (amount > 0),
  -- pending: menunggu dibayar · paid: lunas · expired: QR habis waktunya · failed: gagal dibuat/ditolak
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'failed')),
  -- Nomor referensi kita yang dikirim ke penyedia pembayaran, dan nomor balasan dari mereka.
  partner_ref text not null unique,
  provider_ref text,
  qr_content text,
  expires_at timestamptz,
  paid_at timestamptz,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists payments_created on public.payments (created_at desc);
create index if not exists payments_device on public.payments (device_id, created_at desc);

alter table public.transactions add column if not exists payment_id uuid references public.payments (id) on delete set null;

-- Hasil foto digital yang bisa diunduh tamu lewat QR di struk, selama 3 hari (sama dengan aturan hapus di R2). Berkasnya ada di
-- Cloudflare R2; di sini hanya catatan berkas mana yang sudah terunggah.
create table if not exists public.shares (
  -- Kode acak yang tercetak di struk (12 huruf/angka kecil). Sulit ditebak, jadi menjadi kuncinya.
  code text primary key check (code ~ '^[a-z0-9]{12}$'),
  device_id uuid references public.devices (id) on delete set null,
  device_name text not null,
  -- Per jenis berkas (photo, thumb, live, slideshow): {key, size, type, at}.
  files jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists shares_created on public.shares (created_at desc);

alter table public.transactions add column if not exists share_code text;
create index if not exists transactions_share on public.transactions (share_code) where share_code is not null;
-- Satu pembayaran hanya untuk satu sesi.
create unique index if not exists transactions_payment on public.transactions (payment_id) where payment_id is not null;

-- ---------------------------------------------------------------- hak akses

alter table public.owners enable row level security;
alter table public.outlet enable row level security;
alter table public.devices enable row level security;
alter table public.transactions enable row level security;
alter table public.vouchers enable row level security;
alter table public.payments enable row level security;
alter table public.shares enable row level security;

drop policy if exists owner_all on public.outlet;
create policy owner_all on public.outlet for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists owner_all on public.devices;
create policy owner_all on public.devices for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists owner_all on public.transactions;
create policy owner_all on public.transactions for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists owner_all on public.vouchers;
create policy owner_all on public.vouchers for all to authenticated using (public.is_owner()) with check (public.is_owner());
-- Pemilik hanya membaca pembayaran; yang menulis adalah Edge Functions.
drop policy if exists owner_read on public.payments;
create policy owner_read on public.payments for select to authenticated using (public.is_owner());
revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;
-- Hasil foto: pemilik hanya membaca; yang menulis adalah Edge Functions.
drop policy if exists owner_read on public.shares;
create policy owner_read on public.shares for select to authenticated using (public.is_owner());
revoke all on public.shares from anon, authenticated;
grant select on public.shares to authenticated;
-- owners: tanpa policy, jadi hanya bisa disentuh lewat claim_owner().

revoke all on public.owners, public.outlet, public.devices, public.transactions, public.vouchers from anon;
grant select, insert, update, delete on public.outlet, public.devices, public.transactions, public.vouchers to authenticated;

-- ---------------------------------------------------------------- fungsi untuk tablet

create or replace function public.token_hash(p_token text)
returns text language sql immutable
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- Memasangkan tablet. Memasangkan ulang membuat token baru, sehingga tablet lama dengan kode yang sama terputus.
create or replace function public.device_pair(p_code text, p_pin text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  d devices;
  t text;
begin
  select * into d from devices where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found then
    perform pg_sleep(0.4);
    return jsonb_build_object('error', 'invalid');
  end if;
  if not d.active then
    return jsonb_build_object('error', 'inactive');
  end if;
  -- Sepuluh PIN salah mengunci kode ini sampai pemilik membuat PIN baru di dashboard.
  if d.pin_fails >= 10 then
    return jsonb_build_object('error', 'locked');
  end if;
  if d.pin <> coalesce(p_pin, '') then
    update devices set pin_fails = pin_fails + 1 where id = d.id;
    return jsonb_build_object('error', 'invalid');
  end if;
  t := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update devices
    set token_hash = token_hash(t), pin_fails = 0, paired_at = now(), last_seen_at = now()
    where id = d.id;
  return jsonb_build_object('token', t, 'id', d.id, 'name', d.name, 'code', d.code);
end;
$$;

-- Detak tablet: melaporkan keadaannya dan mengambil pengaturan. Pengaturan outlet hanya
-- dikirim kalau berubah sejak versi yang sudah dipegang tablet (p_known).
create or replace function public.device_sync(p_token text, p_status jsonb default '{}'::jsonb, p_known text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  d devices;
  o outlet;
  result jsonb;
begin
  update devices
    set last_seen_at = now(), status = coalesce(p_status, '{}'::jsonb)
    where token_hash = token_hash(p_token) and active
    returning * into d;
  if not found then
    return jsonb_build_object('error', 'unpaired');
  end if;
  select * into o from outlet where id = 1;
  result := jsonb_build_object(
    'id', d.id,
    'name', d.name,
    'frames', to_jsonb(d.frames),
    'outlet_version', o.updated_at::text
  );
  if p_known is distinct from o.updated_at::text then
    result := result || jsonb_build_object('outlet', o.config);
  end if;
  return result;
end;
$$;

-- Menerima transaksi dari antrean tablet. Baris yang sudah pernah diterima dilewati.
create or replace function public.device_push(p_token text, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  d devices;
begin
  select * into d from devices where token_hash = token_hash(p_token) and active;
  if not found then
    return jsonb_build_object('error', 'unpaired');
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 500 then
    return jsonb_build_object('error', 'bad-request');
  end if;
  insert into transactions (id, device_id, device_name, at, session_no, frame, package, price, method, voucher_code, prints, payment_id, share_code)
  select r.id, d.id, d.name, r.at, r.session_no, left(r.frame, 80), left(r.package, 80),
         greatest(coalesce(r.price, 0), 0), r.method, left(r.voucher_code, 40), greatest(coalesce(r.prints, 1), 1),
         -- Hanya pembayaran lunas milik tablet ini, dan yang belum dipakai sesi lain, yang boleh ditautkan.
         (select p.id from payments p
           where p.id = r.payment_id and p.device_id = d.id and p.status = 'paid'
             and not exists (select 1 from transactions t where t.payment_id = p.id)),
         case when r.share_code ~ '^[a-z0-9]{12}$' then r.share_code end
  from jsonb_to_recordset(p_rows)
    as r(id uuid, at timestamptz, session_no int, frame text, package text, price int, method text, voucher_code text, prints int, payment_id uuid, share_code text)
  where r.id is not null and r.at is not null and r.method in ('free', 'voucher', 'qris', 'cash')
  on conflict (id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- Memakai voucher. Satu pernyataan UPDATE, jadi dua tablet yang mengetik kode yang sama
-- pada detik yang sama tidak bisa sama-sama berhasil.
create or replace function public.device_redeem_voucher(p_token text, p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  d devices;
  v vouchers;
  wanted text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  select * into d from devices where token_hash = token_hash(p_token) and active;
  if not found then
    return jsonb_build_object('status', 'unpaired');
  end if;
  update vouchers
    set used_at = now(), used_by = d.id, used_by_name = d.name
    where norm = wanted and used_at is null and (expires_at is null or expires_at > now())
    returning * into v;
  if found then
    return jsonb_build_object('status', 'ok', 'code', v.code);
  end if;
  select * into v from vouchers where norm = wanted;
  if not found then
    return jsonb_build_object('status', 'not-found');
  end if;
  return jsonb_build_object('status', case when v.used_at is not null then 'used' else 'expired' end);
end;
$$;

-- Laporan untuk layar petugas di tablet: hanya transaksi tablet itu sendiri.
create or replace function public.device_stats(p_token text, p_from timestamptz, p_to timestamptz, p_tz text default 'Asia/Jakarta')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  d devices;
  zone text := coalesce((select name from pg_timezone_names where name = p_tz), 'Asia/Jakarta');
begin
  select * into d from devices where token_hash = token_hash(p_token) and active;
  if not found then
    return jsonb_build_object('error', 'unpaired');
  end if;
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_object('day', s.day, 'device_id', d.id, 'device_name', d.name, 'method', s.method,
                                        'sessions', s.sessions, 'prints', s.prints, 'revenue', s.revenue))
    from (
      select (t.at at time zone zone)::date as day, t.method, count(*) as sessions, coalesce(sum(t.prints), 0) as prints,
             coalesce(sum(case when t.method in ('qris', 'cash') then t.price else 0 end), 0) as revenue
      from transactions t
      where t.device_id = d.id and t.at >= p_from and t.at < p_to
      group by 1, 2
    ) s
  ), '[]'::jsonb));
end;
$$;

create or replace function public.device_transactions(p_token text, p_from timestamptz, p_to timestamptz,
                                                      p_method text default null, p_offset int default 0, p_limit int default 50)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  d devices;
begin
  select * into d from devices where token_hash = token_hash(p_token) and active;
  if not found then
    return jsonb_build_object('error', 'unpaired');
  end if;
  return jsonb_build_object(
    'total', (select count(*) from transactions t
              where t.device_id = d.id and t.at >= p_from and t.at < p_to and (p_method is null or t.method = p_method)),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.at desc)
      from (
        select t.id, t.device_id, t.device_name, t.at, t.session_no, t.frame, t.package, t.price, t.method, t.voucher_code, t.prints, t.share_code
        from transactions t
        where t.device_id = d.id and t.at >= p_from and t.at < p_to and (p_method is null or t.method = p_method)
        order by t.at desc
        offset greatest(coalesce(p_offset, 0), 0)
        limit least(greatest(coalesce(p_limit, 50), 1), 1000)
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.device_stats(text, timestamptz, timestamptz, text) to anon, authenticated;
grant execute on function public.device_transactions(text, timestamptz, timestamptz, text, int, int) to anon, authenticated;

-- ---------------------------------------------------------------- fungsi untuk dashboard

-- Ringkasan per hari, per perangkat, per cara bayar. Omzet hanya menghitung uang yang
-- benar-benar diterima (QRIS dan tunai); voucher dan sesi gratis dihitung nol.
create or replace function public.stats_daily(p_from timestamptz, p_to timestamptz, p_tz text default 'Asia/Jakarta')
returns table (day date, device_id uuid, device_name text, method text, sessions bigint, prints bigint, revenue bigint)
language sql stable security invoker set search_path = public
as $$
  select (t.at at time zone p_tz)::date, t.device_id, t.device_name, t.method,
         count(*), coalesce(sum(t.prints), 0),
         coalesce(sum(case when t.method in ('qris', 'cash') then t.price else 0 end), 0)
  from transactions t
  where t.at >= p_from and t.at < p_to
  group by 1, t.device_id, t.device_name, t.method;
$$;

-- Jumlah voucher per status, untuk kartu ringkasan di menu Voucher.
create or replace function public.voucher_counts()
returns jsonb
language sql stable security invoker set search_path = public
as $$
  select jsonb_build_object(
    'active', count(*) filter (where used_at is null and (expires_at is null or expires_at > now())),
    'used', count(*) filter (where used_at is not null),
    'expired', count(*) filter (where used_at is null and expires_at <= now())
  )
  from vouchers;
$$;

revoke execute on function public.token_hash(text) from public, anon, authenticated;
grant execute on function public.device_pair(text, text) to anon, authenticated;
grant execute on function public.device_sync(text, jsonb, text) to anon, authenticated;
grant execute on function public.device_push(text, jsonb) to anon, authenticated;
grant execute on function public.device_redeem_voucher(text, text) to anon, authenticated;
grant execute on function public.claim_owner() to authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.stats_daily(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.voucher_counts() to authenticated;

-- ---------------------------------------------------------------- pembayaran QRIS (hanya untuk Edge Functions)
--
-- Fungsi payment_* dipanggil oleh Edge Functions dengan service role. Tablet dan pemegang
-- anon/publishable key tidak bisa memanggilnya langsung.

-- Membuka tagihan untuk satu pilihan harga. Nominal diambil dari pengaturan outlet di server,
-- bukan dari tablet, sehingga tablet tidak bisa meminta QR dengan harga yang diubah.
create or replace function public.payment_begin(p_token text, p_package_id text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  d devices;
  cfg jsonb;
  pkg jsonb;
  price int;
  p payments;
begin
  select * into d from devices where token_hash = token_hash(p_token) and active;
  if not found then
    return jsonb_build_object('error', 'unpaired');
  end if;
  select config into cfg from outlet where id = 1;
  if coalesce((cfg #>> '{payment,qris}')::boolean, false) is not true
     or coalesce((cfg #>> '{payment,qrisAuto}')::boolean, false) is not true then
    return jsonb_build_object('error', 'disabled');
  end if;
  select value into pkg
    from jsonb_array_elements(case when jsonb_typeof(cfg -> 'packages') = 'array' then cfg -> 'packages' else '[]'::jsonb end)
    where value ->> 'id' = p_package_id and (value ->> 'active')::boolean
    limit 1;
  price := floor((pkg ->> 'price')::numeric);
  if pkg is null or price is null or price <= 0 then
    return jsonb_build_object('error', 'no-package');
  end if;
  -- Rem darurat: satu tablet tidak bisa membuat QR tanpa henti.
  if (select count(*) from payments where device_id = d.id and created_at > now() - interval '10 minutes') >= 30 then
    return jsonb_build_object('error', 'too-many');
  end if;
  insert into payments (device_id, device_name, package_id, package_name, amount, partner_ref)
  values (d.id, d.name, p_package_id, left(pkg ->> 'name', 80), price,
          'FS' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDDHH24MISS') || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)))
  returning * into p;
  return jsonb_build_object('id', p.id, 'amount', p.amount, 'partner_ref', p.partner_ref,
                            'device_name', p.device_name, 'package_name', p.package_name);
end;
$$;

-- Menyimpan QR yang diberikan penyedia pembayaran.
create or replace function public.payment_attach(p_id uuid, p_provider_ref text, p_qr text, p_expires timestamptz, p_detail jsonb)
returns void
language sql security definer set search_path = public
as $$
  update payments
    set provider_ref = p_provider_ref, qr_content = p_qr, expires_at = p_expires, detail = coalesce(p_detail, '{}'::jsonb)
    where id = p_id and status = 'pending';
$$;

-- Keadaan satu tagihan, hanya untuk tablet yang membuatnya.
create or replace function public.payment_get(p_token text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  d devices;
  p payments;
begin
  select * into d from devices where token_hash = token_hash(p_token) and active;
  if not found then
    return jsonb_build_object('error', 'unpaired');
  end if;
  select * into p from payments where id = p_id and device_id = d.id;
  if not found then
    return jsonb_build_object('error', 'not-found');
  end if;
  return jsonb_build_object('id', p.id, 'status', p.status, 'amount', p.amount, 'partner_ref', p.partner_ref,
                            'provider_ref', p.provider_ref, 'expires_at', p.expires_at, 'created_at', p.created_at);
end;
$$;

-- Menutup tagihan yang masih menunggu: lunas, kedaluwarsa, atau gagal. Tagihan yang sudah
-- ditutup tidak berubah lagi, kecuali kedaluwarsa/gagal yang ternyata lunas (uang tetap dicatat).
create or replace function public.payment_settle(p_id uuid, p_status text, p_detail jsonb)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  result text;
begin
  if p_status not in ('paid', 'expired', 'failed') then
    raise exception 'status tidak dikenal: %', p_status;
  end if;
  update payments
    set status = p_status,
        paid_at = case when p_status = 'paid' then now() else paid_at end,
        detail = detail || coalesce(p_detail, '{}'::jsonb)
    where id = p_id and (status = 'pending' or (p_status = 'paid' and status in ('expired', 'failed')))
    returning status into result;
  if result is null then
    select status into result from payments where id = p_id;
  end if;
  return result;
end;
$$;

-- Menutup tagihan berdasarkan nomor referensi kita, untuk pemberitahuan dari penyedia pembayaran.
-- Nominal harus sama dengan tagihannya; pemberitahuan dengan nominal lain diabaikan.
create or replace function public.payment_settle_by_ref(p_partner_ref text, p_amount int, p_detail jsonb)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  p payments;
begin
  select * into p from payments where partner_ref = p_partner_ref;
  if not found or p.amount is distinct from p_amount then
    return null;
  end if;
  return payment_settle(p.id, 'paid', p_detail);
end;
$$;

-- Tagihan milik satu tablet yang masih menunggu padahal waktunya sudah habis (atau QR-nya tidak
-- pernah jadi), supaya bisa diselesaikan: dibayar belakangan, atau ditutup sebagai tidak dibayar.
create or replace function public.payment_stale(p_token text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  d devices;
begin
  select * into d from devices where token_hash = token_hash(p_token) and active;
  if not found then
    return jsonb_build_object('error', 'unpaired');
  end if;
  return jsonb_build_object('payments', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'status', p.status, 'partner_ref', p.partner_ref,
                                        'provider_ref', p.provider_ref, 'expires_at', p.expires_at, 'created_at', p.created_at)
                     order by p.created_at)
    from (
      select * from payments
      where device_id = d.id and status = 'pending'
        and coalesce(expires_at, created_at + interval '1 minute') < now() - interval '15 seconds'
      order by created_at
      limit 10
    ) p
  ), '[]'::jsonb));
end;
$$;

revoke execute on function public.payment_stale(text) from public, anon, authenticated;
grant execute on function public.payment_stale(text) to service_role;
revoke execute on function public.payment_settle_by_ref(text, int, jsonb) from public, anon, authenticated;
grant execute on function public.payment_settle_by_ref(text, int, jsonb) to service_role;
revoke execute on function public.payment_begin(text, text) from public, anon, authenticated;
revoke execute on function public.payment_attach(uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke execute on function public.payment_get(text, uuid) from public, anon, authenticated;
revoke execute on function public.payment_settle(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.payment_begin(text, text) to service_role;
grant execute on function public.payment_attach(uuid, text, text, timestamptz, jsonb) to service_role;
grant execute on function public.payment_get(text, uuid) to service_role;
grant execute on function public.payment_settle(uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------- hasil foto (hanya untuk Edge Functions)

-- Mendaftarkan kode hasil foto untuk tablet ini sebelum berkasnya diunggah. Kode yang sudah
-- dipakai tablet lain ditolak. Masa simpan 3 hari dihitung sejak pendaftaran pertama; samakan dengan
-- aturan hapus otomatis di bucket R2 dan SHARE_DAYS di src/lib/cloud/shared.ts.
create or replace function public.share_claim(p_token text, p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  d devices;
  s shares;
begin
  select * into d from devices where token_hash = token_hash(p_token) and active;
  if not found then
    return jsonb_build_object('error', 'unpaired');
  end if;
  if coalesce(p_code, '') !~ '^[a-z0-9]{12}$' then
    return jsonb_build_object('error', 'bad-code');
  end if;
  insert into shares (code, device_id, device_name, expires_at)
  values (p_code, d.id, d.name, now() + interval '3 days')
  on conflict (code) do nothing;
  select * into s from shares where code = p_code;
  if s.device_id is distinct from d.id then
    return jsonb_build_object('error', 'taken');
  end if;
  if s.expires_at < now() then
    return jsonb_build_object('error', 'expired');
  end if;
  return jsonb_build_object('ok', true, 'expires_at', s.expires_at);
end;
$$;

-- Mencatat satu berkas yang sudah terunggah.
create or replace function public.share_add_file(p_token text, p_code text, p_kind text, p_file jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  d devices;
begin
  select * into d from devices where token_hash = token_hash(p_token) and active;
  if not found then
    return jsonb_build_object('error', 'unpaired');
  end if;
  update shares set files = files || jsonb_build_object(p_kind, p_file)
    where code = p_code and device_id = d.id;
  if not found then
    return jsonb_build_object('error', 'not-found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Hasil foto untuk halaman unduh tamu dan dashboard, beserta nama dan warna outlet.
create or replace function public.share_lookup(p_codes text[])
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'brand', (select config -> 'brand' from outlet where id = 1),
    'shares', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'files', s.files, 'created_at', s.created_at,
                                          'expires_at', s.expires_at, 'device_name', s.device_name))
      from shares s
      where s.code = any (p_codes[1:60])
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.share_claim(text, text) from public, anon, authenticated;
revoke execute on function public.share_add_file(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.share_lookup(text[]) from public, anon, authenticated;
grant execute on function public.share_claim(text, text) to service_role;
grant execute on function public.share_add_file(text, text, text, jsonb) to service_role;
grant execute on function public.share_lookup(text[]) to service_role;
