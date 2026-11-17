-- Struk Booth — skema Supabase.
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

-- ---------------------------------------------------------------- hak akses

alter table public.owners enable row level security;
alter table public.outlet enable row level security;
alter table public.devices enable row level security;
alter table public.transactions enable row level security;
alter table public.vouchers enable row level security;

drop policy if exists owner_all on public.outlet;
create policy owner_all on public.outlet for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists owner_all on public.devices;
create policy owner_all on public.devices for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists owner_all on public.transactions;
create policy owner_all on public.transactions for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists owner_all on public.vouchers;
create policy owner_all on public.vouchers for all to authenticated using (public.is_owner()) with check (public.is_owner());
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
  insert into transactions (id, device_id, device_name, at, session_no, frame, package, price, method, voucher_code, prints)
  select r.id, d.id, d.name, r.at, r.session_no, left(r.frame, 80), left(r.package, 80),
         greatest(coalesce(r.price, 0), 0), r.method, left(r.voucher_code, 40), greatest(coalesce(r.prints, 1), 1)
  from jsonb_to_recordset(p_rows)
    as r(id uuid, at timestamptz, session_no int, frame text, package text, price int, method text, voucher_code text, prints int)
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
