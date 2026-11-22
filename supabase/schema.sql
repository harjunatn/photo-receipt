-- Skema Supabase untuk platform booth dengan banyak franchise.
-- Tempel seluruh berkas ini di Supabase → SQL Editor → Run. Aman dijalankan ulang.
-- (Pindah dari skema lama satu-pemilik: jalankan supabase/reset.sql dulu. Itu MENGHAPUS semua data.)
--
-- Siapa boleh apa:
--   * Superadmin (pemilik platform) masuk dengan email + password dan boleh melihat serta mengubah
--     semua franchise. Akun pertama yang masuk ke dashboard menjadi superadmin, SEKALI saja; sesudah
--     itu superadmin hanya bisa ditambah lewat SQL (insert into public.superadmins ...).
--   * Admin franchise masuk dengan akun yang dibuatkan superadmin dan hanya melihat data
--     franchise-nya sendiri: perangkat, transaksi, voucher, frame, pengaturan.
--   * Tablet booth TIDAK punya akun. Tablet dipasangkan dengan kode perangkat + PIN, lalu hanya
--     bisa memanggil fungsi device_* di bawah dengan token rahasianya. Tabel tidak bisa dibaca
--     langsung oleh tablet maupun oleh orang yang hanya memegang anon key.
--   * Kunci pembayaran tiap franchise hanya bisa dibaca Edge Functions (service role).

-- ---------------------------------------------------------------- tabel

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- Pengaturan platform, satu baris: nama, akun media sosial, tulisan watermark, masa tenggang langganan.
create table if not exists public.platform (
  id int primary key default 1 check (id = 1),
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  -- Diisi saat akun pertama menjadi superadmin. Sesudah itu klaim otomatis tertutup untuk selamanya,
  -- juga kalau tabel superadmins suatu saat kosong (misalnya akunnya terhapus).
  superadmin_claimed_at timestamptz
);
alter table public.platform add column if not exists superadmin_claimed_at timestamptz;
insert into public.platform (id) values (1) on conflict (id) do nothing;
-- Nilai awal, sama dengan bawaan di aplikasi, supaya tablet, dashboard dan halaman unduh tamu memakai
-- nilai yang sama sebelum superadmin mengubahnya di Pengaturan platform.
update public.platform
  set config = '{"name": "jepretin", "watermark": "didukung oleh jepretin", "receiptLine": "@jepretin", "graceDays": 7}'::jsonb
  where id = 1 and config = '{}'::jsonb;

drop trigger if exists platform_touch on public.platform;
create trigger platform_touch before update on public.platform
  for each row execute function public.touch_updated_at();

create table if not exists public.superadmins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.franchises (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  -- Pengaturan yang sama untuk semua tablet franchise ini: nama outlet, logo, harga, cara bayar.
  config jsonb not null default '{}'::jsonb,
  -- Berubah setiap kali config berubah; tablet memakainya untuk tahu kapan harus mengambil ulang.
  config_at timestamptz not null default now(),
  -- false = dihentikan superadmin: booth berhenti menerima tamu.
  active boolean not null default true,
  -- Langganan berlaku sampai tanggal ini (termasuk). Kosong = tanpa batas.
  paid_until date,
  -- Catatan superadmin; tidak terlihat oleh admin franchise.
  note text,
  created_at timestamptz not null default now()
);

create or replace function public.franchise_touch_config()
returns trigger language plpgsql as $$
begin
  if new.config is distinct from old.config then
    new.config_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists franchise_touch on public.franchises;
create trigger franchise_touch before update on public.franchises
  for each row execute function public.franchise_touch_config();

-- Akun admin franchise. Satu akun hanya untuk satu franchise.
create table if not exists public.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  franchise_id uuid not null references public.franchises (id) on delete cascade,
  -- Password masih buatan superadmin: dashboard meminta menggantinya saat pertama masuk.
  must_change_password boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists members_franchise on public.members (franchise_id);

-- Kunci pembayaran (DOKU) tiap franchise. Hanya Edge Functions yang membaca dan menulisnya.
create table if not exists public.franchise_secrets (
  franchise_id uuid primary key references public.franchises (id) on delete cascade,
  -- Bagian yang tidak rahasia: clientId, merchantId, terminalId, postalCode, sandbox, publicKeyPem.
  doku jsonb not null default '{}'::jsonb,
  -- Secret Key dan private key, terenkripsi oleh Edge Function; kunci induknya hanya ada di sana.
  doku_sealed text,
  updated_at timestamptz not null default now()
);

-- Kode perangkat: 6 huruf/angka yang tidak mudah tertukar (tanpa I/1, O/0), dibuat di server supaya
-- tidak ada yang bisa menebak-nebak kode franchise lain lewat bentrokan.
create or replace function public.new_device_code()
returns text
language plpgsql volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text;
begin
  loop
    select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '') into result from generate_series(1, 6);
    exit when to_regclass('public.devices') is null or not exists (select 1 from public.devices where code = result);
  end loop;
  return result;
end;
$$;

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  franchise_id uuid not null references public.franchises (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  -- Kode perangkat dan PIN diketik sekali di tablet untuk memasangkannya. Kodenya diisi oleh trigger di bawah.
  code text not null unique,
  pin text not null default lpad(floor(random() * 1000000)::int::text, 6, '0') check (pin ~ '^[0-9]{4,8}$'),
  pin_fails int not null default 0,
  -- SHA-256 dari token tablet; kosong selama belum dipasangkan.
  token_hash text unique,
  -- Id frame yang ditawarkan tablet ini, berurutan. null = tablet memakai pilihan standar.
  frames text[] check (frames is null or (cardinality(frames) <= 60 and octet_length(array_to_string(frames, ',')) <= 4000)),
  active boolean not null default true,
  status jsonb not null default '{}'::jsonb,
  -- Cadangan pengaturan yang diatur di tablet itu sendiri (printer, sesi & kamera, teks struk, riwayat,
  -- PIN petugas). Tablet pengganti yang dipasangkan dengan kode yang sama langsung memakainya.
  settings jsonb,
  settings_at timestamptz,
  paired_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists devices_franchise on public.devices (franchise_id);

create or replace function public.device_before_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.code is null then
    new.code := new_device_code();
  end if;
  return new;
end;
$$;

drop trigger if exists devices_code on public.devices;
create trigger devices_code before insert on public.devices
  for each row execute function public.device_before_insert();

-- Tagihan QRIS otomatis. Dibuat dan diperbarui hanya oleh Edge Functions (lihat supabase/functions).
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  franchise_id uuid not null references public.franchises (id) on delete cascade,
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
create index if not exists payments_franchise on public.payments (franchise_id, created_at desc);
create index if not exists payments_device on public.payments (device_id, created_at desc);

create table if not exists public.transactions (
  -- Dibuat di tablet, sehingga kiriman ulang saat internet putus-nyambung tidak menggandakan baris.
  id uuid primary key,
  franchise_id uuid not null references public.franchises (id) on delete cascade,
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
  payment_id uuid references public.payments (id) on delete set null,
  share_code text,
  created_at timestamptz not null default now()
);
-- false: sesi tunai atau QRIS manual yang dimulai tanpa konfirmasi petugas (pengaturan franchise mematikannya),
-- supaya uangnya bisa dicocokkan belakangan.
alter table public.transactions add column if not exists staff_confirmed boolean not null default true;
-- true: lembar tambahan dari sesi yang sudah ada (cetak ulang yang dibayar lagi). Barisnya menambah uang dan
-- lembar, tetapi tidak dihitung sebagai sesi baru.
alter table public.transactions add column if not exists extra boolean not null default false;
create index if not exists transactions_franchise_at on public.transactions (franchise_id, at desc);
create index if not exists transactions_device_at on public.transactions (device_id, at desc);
create index if not exists transactions_share on public.transactions (share_code) where share_code is not null;
-- Satu pembayaran hanya untuk satu sesi.
create unique index if not exists transactions_payment on public.transactions (payment_id) where payment_id is not null;

create table if not exists public.vouchers (
  franchise_id uuid not null references public.franchises (id) on delete cascade,
  -- Seperti yang dicetak: AWALAN-XXXXXX.
  code text not null check (length(code) between 3 and 40),
  -- Hanya huruf dan angka, huruf besar: tamu boleh mengetik tanpa tanda hubung.
  norm text generated always as (upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g'))) stored,
  label text check (label is null or length(label) <= 120),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  used_at timestamptz,
  used_by uuid references public.devices (id) on delete set null,
  used_by_name text,
  primary key (franchise_id, code),
  unique (franchise_id, norm)
);
create index if not exists vouchers_created on public.vouchers (franchise_id, created_at desc);

-- Hasil foto digital yang bisa diunduh tamu lewat QR di struk, selama 3 hari (sama dengan aturan hapus di R2).
-- Berkasnya ada di Cloudflare R2; di sini hanya catatan berkas mana yang sudah terunggah.
create table if not exists public.shares (
  -- Kode acak yang tercetak di struk (12 huruf/angka kecil). Sulit ditebak, jadi menjadi kuncinya.
  code text primary key check (code ~ '^[a-z0-9]{12}$'),
  franchise_id uuid not null references public.franchises (id) on delete cascade,
  device_id uuid references public.devices (id) on delete set null,
  device_name text not null,
  -- Per jenis berkas (photo, thumb, live, slideshow): {key, size, type, at}.
  files jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists shares_franchise on public.shares (franchise_id, created_at desc);

-- Edit foto AI di halaman unduh tamu: satu baris untuk tiap percobaan mengubah satu foto sesi dengan satu gaya.
-- Dipakai untuk jatah (satu hasil per sesi), batas per franchise per bulan, dan hitungan biaya pemilik platform.
create table if not exists public.ai_edits (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.shares (code) on delete cascade,
  franchise_id uuid not null references public.franchises (id) on delete cascade,
  style text not null,
  -- Foto polos mana dari sesi itu yang diubah: p1 … p6.
  photo text not null,
  -- pending: sedang dikerjakan · done: jadi · failed: gagal atau ditolak AI (tidak menghabiskan jatah tamu)
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  -- Alasan kegagalan, untuk pemilik platform.
  detail text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ai_edits_code on public.ai_edits (code);
create index if not exists ai_edits_franchise on public.ai_edits (franchise_id, created_at desc);

-- Frame buatan franchise sendiri: gambar dengan lubang transparan tempat foto.
create table if not exists public.frames (
  id uuid primary key default gen_random_uuid(),
  franchise_id uuid not null references public.franchises (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  blurb text not null default '' check (length(blurb) <= 80),
  -- { width, height, slots: [{x, y, w, h}], print: 'ink' | 'dither' } dalam piksel gambar.
  layout jsonb not null check (jsonb_typeof(layout -> 'slots') = 'array' and jsonb_array_length(layout -> 'slots') between 1 and 6),
  -- Gambar frame (data URL) dan versi kecilnya untuk daftar.
  image text not null check (image ~ '^data:image/(png|webp|jpeg);base64,' and octet_length(image) <= 2600000),
  thumb text not null default '' check (thumb = '' or (thumb ~ '^data:image/(png|webp|jpeg);base64,' and octet_length(thumb) <= 200000)),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists frames_franchise on public.frames (franchise_id, created_at);

drop trigger if exists frames_touch on public.frames;
create trigger frames_touch before update on public.frames
  for each row execute function public.touch_updated_at();

-- Batas per franchise, supaya satu franchise tidak bisa memenuhi database yang dipakai bersama.
create or replace function public.enforce_quota()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  cap int := tg_argv[0]::int;
  over uuid;
begin
  execute format(
    'select t.franchise_id from public.%I t where t.franchise_id in (select franchise_id from added) group by 1 having count(*) > $1 limit 1',
    tg_table_name
  ) into over using cap;
  if over is not null then
    raise exception 'Batas % per franchise tercapai (%).', tg_table_name, cap using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists devices_quota on public.devices;
create trigger devices_quota after insert on public.devices
  referencing new table as added for each statement execute function public.enforce_quota('200');
drop trigger if exists frames_quota on public.frames;
create trigger frames_quota after insert on public.frames
  referencing new table as added for each statement execute function public.enforce_quota('20');
drop trigger if exists vouchers_quota on public.vouchers;
create trigger vouchers_quota after insert on public.vouchers
  referencing new table as added for each statement execute function public.enforce_quota('20000');

-- ---------------------------------------------------------------- siapa pemanggilnya

create or replace function public.is_superadmin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from superadmins where user_id = auth.uid());
$$;

-- Franchise milik akun yang sedang masuk; kosong untuk superadmin dan akun tak dikenal.
create or replace function public.my_franchise()
returns uuid
language sql stable security definer set search_path = public
as $$
  select franchise_id from members where user_id = auth.uid();
$$;

create or replace function public.can_access(p_franchise uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_franchise is not null and (
    exists (select 1 from superadmins where user_id = auth.uid())
    or exists (select 1 from members where user_id = auth.uid() and franchise_id = p_franchise)
  );
$$;

-- Berapa hari booth masih jalan setelah langganan lewat.
create or replace function public.grace_days()
returns int
language sql stable security definer set search_path = public
as $$
  select case when (config ->> 'graceDays') ~ '^[0-9]{1,3}$' then (config ->> 'graceDays')::int else 7 end
  from platform where id = 1;
$$;

-- active: berjalan · grace: langganan lewat tetapi masih dalam masa tenggang ·
-- expired: masa tenggang habis · suspended: dihentikan superadmin.
create or replace function public.franchise_state(p_active boolean, p_paid_until date, p_grace int)
returns text
language sql stable
as $$
  select case
    when not p_active then 'suspended'
    when p_paid_until is null then 'active'
    when (now() at time zone 'Asia/Jakarta')::date <= p_paid_until then 'active'
    when (now() at time zone 'Asia/Jakarta')::date <= p_paid_until + greatest(coalesce(p_grace, 0), 0) then 'grace'
    else 'expired'
  end;
$$;

-- Siapa akun ini bagi dashboard. Di pemasangan yang masih kosong, akun pertama yang masuk menjadi
-- superadmin. Klaim itu hanya terjadi sekali: begitu tercatat di platform.superadmin_claimed_at, ia
-- tidak terbuka lagi walaupun tabel superadmins kosong, dan tidak pernah berlaku kalau sudah ada franchise.
create or replace function public.whoami()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m members;
  f franchises;
  claimed timestamptz;
begin
  if uid is null then
    return jsonb_build_object('error', 'signed-out');
  end if;
  if (select superadmin_claimed_at is null from platform where id = 1) then
    -- Baris platform dikunci, jadi dua akun yang masuk bersamaan tidak bisa sama-sama mengklaim.
    select superadmin_claimed_at into claimed from platform where id = 1 for update;
    if claimed is null
       and not exists (select 1 from superadmins)
       and not exists (select 1 from franchises)
       and not exists (select 1 from members) then
      insert into superadmins (user_id) values (uid);
      update platform set superadmin_claimed_at = now() where id = 1;
    end if;
  end if;
  select * into m from members where user_id = uid;
  if found then
    select * into f from franchises where id = m.franchise_id;
  end if;
  return jsonb_build_object(
    'user_id', uid,
    'superadmin', exists (select 1 from superadmins where user_id = uid),
    'must_change_password', coalesce(m.must_change_password, false),
    'franchise', case when f.id is null then null else jsonb_build_object('id', f.id, 'name', f.name) end
  );
end;
$$;

-- Dipanggil dashboard setelah admin franchise mengganti password buatan superadmin.
create or replace function public.password_changed()
returns void
language sql security definer set search_path = public
as $$
  update members set must_change_password = false where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------- hak akses

alter table public.platform enable row level security;
alter table public.superadmins enable row level security;
alter table public.franchises enable row level security;
alter table public.members enable row level security;
alter table public.franchise_secrets enable row level security;
alter table public.devices enable row level security;
alter table public.transactions enable row level security;
alter table public.vouchers enable row level security;
alter table public.payments enable row level security;
alter table public.shares enable row level security;
alter table public.ai_edits enable row level security;
alter table public.frames enable row level security;

revoke all on public.platform, public.superadmins, public.franchises, public.members, public.franchise_secrets,
              public.devices, public.transactions, public.vouchers, public.payments, public.shares, public.frames
  from anon, authenticated;

-- Platform: semua akun membaca; hanya superadmin mengubah.
drop policy if exists platform_read on public.platform;
create policy platform_read on public.platform for select to authenticated using (true);
drop policy if exists platform_write on public.platform;
create policy platform_write on public.platform for update to authenticated
  using ((select public.is_superadmin())) with check ((select public.is_superadmin()));
grant select (id, config, updated_at), update (config) on public.platform to authenticated;

-- Franchise: admin membaca miliknya sendiri (tanpa catatan superadmin). Perubahan lewat fungsi
-- save_outlet (pengaturan) dan admin_* (nama, langganan), bukan langsung ke tabel.
drop policy if exists franchise_read on public.franchises;
create policy franchise_read on public.franchises for select to authenticated
  using ((select public.is_superadmin()) or id = (select public.my_franchise()));
grant select (id, name, config, config_at, active, paid_until, created_at) on public.franchises to authenticated;

-- Keanggotaan: tiap akun melihat barisnya sendiri. Ditulis hanya lewat Edge Function admin.
drop policy if exists member_read on public.members;
create policy member_read on public.members for select to authenticated
  using ((select public.is_superadmin()) or user_id = auth.uid());
grant select on public.members to authenticated;

-- superadmins dan franchise_secrets: tanpa policy, jadi hanya lewat fungsi.

drop policy if exists tenant_all on public.devices;
create policy tenant_all on public.devices for all to authenticated
  using ((select public.is_superadmin()) or franchise_id = (select public.my_franchise()))
  with check ((select public.is_superadmin()) or franchise_id = (select public.my_franchise()));
-- Kode, token dan cadangan pengaturan tablet tidak bisa ditulis dari dashboard: kode dibuat server,
-- token hanya lewat pemasangan tablet, dan melepas tablet lewat fungsi device_unpair.
grant select, delete on public.devices to authenticated;
grant insert (franchise_id, name) on public.devices to authenticated;
grant update (name, pin, pin_fails, frames, active) on public.devices to authenticated;

drop policy if exists tenant_all on public.vouchers;
create policy tenant_all on public.vouchers for all to authenticated
  using ((select public.is_superadmin()) or franchise_id = (select public.my_franchise()))
  with check ((select public.is_superadmin()) or franchise_id = (select public.my_franchise()));
-- Voucher dibuat dan dihapus dari dashboard; yang menandainya terpakai hanya tablet (lewat fungsi).
grant select, delete on public.vouchers to authenticated;
grant insert (franchise_id, code, label, expires_at) on public.vouchers to authenticated;

-- Dashboard mendapat kabar langsung saat voucher dipakai di booth (Supabase Realtime). Aturan akses di
-- atas tetap berlaku: setiap akun hanya menerima perubahan voucher franchise-nya sendiri. Dashboard hanya
-- mendengarkan UPDATE, karena kabar DELETE tidak disaring oleh aturan akses.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vouchers'
     ) then
    alter publication supabase_realtime add table public.vouchers;
  end if;
end $$;

drop policy if exists tenant_all on public.frames;
create policy tenant_all on public.frames for all to authenticated
  using ((select public.is_superadmin()) or franchise_id = (select public.my_franchise()))
  with check ((select public.is_superadmin()) or franchise_id = (select public.my_franchise()));
grant select, insert, update, delete on public.frames to authenticated;

-- Transaksi, pembayaran dan hasil foto hanya dibaca; yang menulis adalah tablet (lewat fungsi) dan Edge Functions.
drop policy if exists tenant_read on public.transactions;
create policy tenant_read on public.transactions for select to authenticated
  using ((select public.is_superadmin()) or franchise_id = (select public.my_franchise()));
grant select on public.transactions to authenticated;

drop policy if exists tenant_read on public.payments;
create policy tenant_read on public.payments for select to authenticated
  using ((select public.is_superadmin()) or franchise_id = (select public.my_franchise()));
grant select on public.payments to authenticated;

drop policy if exists tenant_read on public.shares;
create policy tenant_read on public.shares for select to authenticated
  using ((select public.is_superadmin()) or franchise_id = (select public.my_franchise()));
grant select on public.shares to authenticated;

drop policy if exists tenant_read on public.ai_edits;
create policy tenant_read on public.ai_edits for select to authenticated
  using ((select public.is_superadmin()) or franchise_id = (select public.my_franchise()));
grant select on public.ai_edits to authenticated;

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
    return jsonb_build_object('error', 'invalid');
  end if;
  if not d.active then
    return jsonb_build_object('error', 'inactive');
  end if;
  -- Sepuluh PIN salah mengunci kode ini sampai dibuatkan PIN baru di dashboard.
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
  return jsonb_build_object('token', t, 'id', d.id, 'name', d.name, 'code', d.code, 'settings', d.settings);
end;
$$;

-- Detak tablet: melaporkan keadaannya dan mengambil pengaturan. Pengaturan franchise dan platform
-- hanya dikirim kalau berubah sejak versi yang sudah dipegang tablet (p_known). Keadaan langganan
-- dan versi frame buatan sendiri selalu dikirim.
create or replace function public.device_sync(p_token text, p_status jsonb default '{}'::jsonb, p_known text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  d devices;
  f franchises;
  pl platform;
  version text;
  grace int := grace_days();
  result jsonb;
begin
  update devices
    set last_seen_at = now(), status = coalesce(p_status, '{}'::jsonb)
    where token_hash = token_hash(p_token) and active
    returning * into d;
  if not found then
    return jsonb_build_object('error', 'unpaired');
  end if;
  select * into f from franchises where id = d.franchise_id;
  select * into pl from platform where id = 1;
  version := f.config_at::text || '|' || pl.updated_at::text;
  result := jsonb_build_object(
    'id', d.id,
    'name', d.name,
    'frames', to_jsonb(d.frames),
    'outlet_version', version,
    'franchise', jsonb_build_object('id', f.id, 'name', f.name),
    'subscription', jsonb_build_object(
      'active', f.active,
      'paid_until', f.paid_until,
      'grace_days', grace,
      'state', franchise_state(f.active, f.paid_until, grace)
    ),
    'frames_version', (
      select coalesce(max(updated_at)::text, '') || '#' || count(*)
      from frames where franchise_id = f.id and active
    )
  );
  if p_known is distinct from version then
    result := result || jsonb_build_object('outlet', f.config, 'platform', pl.config);
  end if;
  return result;
end;
$$;

-- Frame buatan franchise untuk tablet ini. p_known: { "<id>": "<updated_at>" } yang sudah dipegang
-- tablet; hanya frame yang baru atau berubah yang dikirim lengkap dengan gambarnya.
create or replace function public.device_frames(p_token text, p_known jsonb default '{}'::jsonb)
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
    'ids', coalesce((
      select jsonb_agg(fr.id order by fr.created_at)
      from frames fr where fr.franchise_id = d.franchise_id and fr.active
    ), '[]'::jsonb),
    'frames', coalesce((
      select jsonb_agg(jsonb_build_object('id', fr.id, 'name', fr.name, 'blurb', fr.blurb, 'layout', fr.layout,
                                          'image', fr.image, 'updated_at', fr.updated_at::text) order by fr.created_at)
      from frames fr
      where fr.franchise_id = d.franchise_id and fr.active
        and coalesce(p_known, '{}'::jsonb) ->> fr.id::text is distinct from fr.updated_at::text
    ), '[]'::jsonb)
  );
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
  insert into transactions (id, franchise_id, device_id, device_name, at, session_no, frame, package, price, method, voucher_code, prints, staff_confirmed, extra, payment_id, share_code)
  select r.id, d.franchise_id, d.id, d.name, r.at, r.session_no, left(r.frame, 80), left(r.package, 80),
         greatest(coalesce(r.price, 0), 0), r.method, left(r.voucher_code, 40), greatest(coalesce(r.prints, 1), 1),
         -- Tablet versi lama tidak mengirimnya; itu berarti dikonfirmasi, seperti cara kerjanya dulu.
         coalesce(r.staff_confirmed, true),
         coalesce(r.extra, false),
         -- Hanya pembayaran lunas milik tablet ini, dan yang belum dipakai sesi lain, yang boleh ditautkan.
         (select p.id from payments p
           where p.id = r.payment_id and p.device_id = d.id and p.status = 'paid'
             and not exists (select 1 from transactions t where t.payment_id = p.id)),
         case when r.share_code ~ '^[a-z0-9]{12}$' then r.share_code end
  from jsonb_to_recordset(p_rows)
    as r(id uuid, at timestamptz, session_no int, frame text, package text, price int, method text, voucher_code text, prints int,
         staff_confirmed boolean, extra boolean, payment_id uuid, share_code text)
  where r.id is not null and r.at is not null and r.method in ('free', 'voucher', 'qris', 'cash')
  on conflict (id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- Memakai voucher franchise tablet ini. Satu pernyataan UPDATE, jadi dua tablet yang mengetik
-- kode yang sama pada detik yang sama tidak bisa sama-sama berhasil.
create or replace function public.device_redeem_voucher(p_token text, p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  d devices;
  f franchises;
  v vouchers;
  wanted text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  select * into d from devices where token_hash = token_hash(p_token) and active;
  if not found then
    return jsonb_build_object('status', 'unpaired');
  end if;
  select * into f from franchises where id = d.franchise_id;
  if franchise_state(f.active, f.paid_until, grace_days()) in ('expired', 'suspended') then
    return jsonb_build_object('status', 'subscription');
  end if;
  update vouchers
    set used_at = now(), used_by = d.id, used_by_name = d.name
    where franchise_id = d.franchise_id and norm = wanted and used_at is null and (expires_at is null or expires_at > now())
    returning * into v;
  if found then
    return jsonb_build_object('status', 'ok', 'code', v.code);
  end if;
  select * into v from vouchers where franchise_id = d.franchise_id and norm = wanted;
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
      where t.device_id = d.id and t.franchise_id = d.franchise_id and t.at >= p_from and t.at < p_to
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
              where t.device_id = d.id and t.franchise_id = d.franchise_id and t.at >= p_from and t.at < p_to
                and (p_method is null or t.method = p_method)),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.at desc)
      from (
        select t.id, t.device_id, t.device_name, t.at, t.session_no, t.frame, t.package, t.price, t.method, t.voucher_code, t.prints, t.share_code,
               t.staff_confirmed
        from transactions t
        where t.device_id = d.id and t.franchise_id = d.franchise_id and t.at >= p_from and t.at < p_to
          and (p_method is null or t.method = p_method)
        order by t.at desc
        offset greatest(coalesce(p_offset, 0), 0)
        limit least(greatest(coalesce(p_limit, 50), 1), 1000)
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- Tablet mencadangkan pengaturannya sendiri. Hanya objek JSON yang kecil yang diterima.
create or replace function public.device_save_settings(p_token text, p_settings jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if jsonb_typeof(p_settings) is distinct from 'object' or octet_length(p_settings::text) > 65536 then
    return jsonb_build_object('error', 'invalid');
  end if;
  update devices
    set settings = p_settings, settings_at = now(), last_seen_at = now()
    where token_hash = token_hash(p_token) and active;
  if not found then
    return jsonb_build_object('error', 'unpaired');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Nama dan tulisan platform yang memang tampil di setiap booth dan struk. Boleh dibaca siapa saja,
-- supaya tablet yang belum dipasangkan menampilkan nama platform, bukan nama salah satu franchise.
create or replace function public.platform_public()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('name', config -> 'name', 'watermark', config -> 'watermark', 'receiptLine', config -> 'receiptLine')
  from platform where id = 1;
$$;
grant execute on function public.platform_public() to anon, authenticated;

revoke execute on function public.token_hash(text) from public, anon, authenticated;
revoke execute on function public.new_device_code() from public, anon, authenticated;
revoke execute on function public.franchise_state(boolean, date, int) from public, anon, authenticated;
revoke execute on function public.enforce_quota() from public, anon, authenticated;
revoke execute on function public.device_before_insert() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.franchise_touch_config() from public, anon, authenticated;
grant execute on function public.device_pair(text, text) to anon, authenticated;
grant execute on function public.device_sync(text, jsonb, text) to anon, authenticated;
grant execute on function public.device_frames(text, jsonb) to anon, authenticated;
grant execute on function public.device_push(text, jsonb) to anon, authenticated;
grant execute on function public.device_redeem_voucher(text, text) to anon, authenticated;
grant execute on function public.device_stats(text, timestamptz, timestamptz, text) to anon, authenticated;
grant execute on function public.device_transactions(text, timestamptz, timestamptz, text, int, int) to anon, authenticated;
grant execute on function public.device_save_settings(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- fungsi untuk dashboard

revoke execute on function public.is_superadmin() from public, anon;
revoke execute on function public.my_franchise() from public, anon;
revoke execute on function public.can_access(uuid) from public, anon;
revoke execute on function public.whoami() from public, anon;
revoke execute on function public.password_changed() from public, anon;
grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.my_franchise() to authenticated;
grant execute on function public.can_access(uuid) to authenticated;
grant execute on function public.whoami() to authenticated;
grant execute on function public.password_changed() to authenticated;

-- Keadaan langganan satu franchise, untuk spanduk di dashboard.
create or replace function public.franchise_status(p_franchise uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  f franchises;
  grace int := grace_days();
begin
  if not can_access(p_franchise) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into f from franchises where id = p_franchise;
  if not found then
    return jsonb_build_object('error', 'not-found');
  end if;
  return jsonb_build_object(
    'id', f.id, 'name', f.name, 'active', f.active, 'paid_until', f.paid_until, 'grace_days', grace,
    'state', franchise_state(f.active, f.paid_until, grace),
    'today', (now() at time zone 'Asia/Jakarta')::date
  );
end;
$$;

-- Melepas tablet dari sebuah perangkat: tokennya dihapus, jadi tablet itu harus dipasangkan lagi.
create or replace function public.device_unpair(p_device uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  update devices set token_hash = null
    where id = p_device and can_access(franchise_id);
  if not found then
    return jsonb_build_object('error', 'not-found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Menyimpan pengaturan franchise (nama outlet, logo, harga, cara bayar).
create or replace function public.save_outlet(p_franchise uuid, p_config jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not can_access(p_franchise) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if jsonb_typeof(p_config) is distinct from 'object' or octet_length(p_config::text) > 2000000 then
    return jsonb_build_object('error', 'invalid');
  end if;
  update franchises set config = p_config where id = p_franchise;
  if not found then
    return jsonb_build_object('error', 'not-found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Ringkasan per hari, per perangkat, per cara bayar. Omzet hanya menghitung uang yang
-- benar-benar diterima (QRIS dan tunai); voucher dan sesi gratis dihitung nol.
-- Tanpa p_franchise: semua franchise yang boleh dilihat pemanggil.
create or replace function public.stats_daily(p_from timestamptz, p_to timestamptz, p_tz text default 'Asia/Jakarta', p_franchise uuid default null)
returns table (day date, device_id uuid, device_name text, method text, sessions bigint, prints bigint, revenue bigint)
language sql stable security invoker set search_path = public
as $$
  select (t.at at time zone p_tz)::date, t.device_id, t.device_name, t.method,
         -- Cetak ulang berbayar menambah lembar dan uang, bukan sesi.
         count(*) filter (where not t.extra), coalesce(sum(t.prints), 0),
         coalesce(sum(case when t.method in ('qris', 'cash') then t.price else 0 end), 0)
  from transactions t
  where t.at >= p_from and t.at < p_to and (p_franchise is null or t.franchise_id = p_franchise)
  group by 1, t.device_id, t.device_name, t.method;
$$;

-- Jumlah voucher per status, untuk kartu ringkasan di menu Voucher.
create or replace function public.voucher_counts(p_franchise uuid default null)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  select jsonb_build_object(
    'active', count(*) filter (where used_at is null and (expires_at is null or expires_at > now())),
    'used', count(*) filter (where used_at is not null),
    'expired', count(*) filter (where used_at is null and expires_at <= now())
  )
  from vouchers
  where p_franchise is null or franchise_id = p_franchise;
$$;

revoke execute on function public.grace_days() from public, anon;
grant execute on function public.grace_days() to authenticated, service_role;
grant execute on function public.franchise_status(uuid) to authenticated;
grant execute on function public.device_unpair(uuid) to authenticated;
revoke execute on function public.device_unpair(uuid) from public, anon;
grant execute on function public.save_outlet(uuid, jsonb) to authenticated;
grant execute on function public.stats_daily(timestamptz, timestamptz, text, uuid) to authenticated;
grant execute on function public.voucher_counts(uuid) to authenticated;
revoke execute on function public.franchise_status(uuid) from public, anon;
revoke execute on function public.save_outlet(uuid, jsonb) from public, anon;
revoke execute on function public.stats_daily(timestamptz, timestamptz, text, uuid) from public, anon;
revoke execute on function public.voucher_counts(uuid) from public, anon;

-- ---------------------------------------------------------------- fungsi untuk superadmin

-- Semua franchise dengan keadaan langganan dan ringkasan 30 hari terakhir.
create or replace function public.admin_franchises()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  grace int := grace_days();
begin
  if not is_superadmin() then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return jsonb_build_object('today', (now() at time zone 'Asia/Jakarta')::date, 'grace_days', grace, 'franchises', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'name', f.name, 'active', f.active, 'paid_until', f.paid_until, 'note', f.note,
      'state', franchise_state(f.active, f.paid_until, grace), 'created_at', f.created_at,
      'devices', (select count(*) from devices d where d.franchise_id = f.id),
      'devices_online', (select count(*) from devices d where d.franchise_id = f.id and d.last_seen_at > now() - interval '3 minutes'),
      'last_seen_at', (select max(d.last_seen_at) from devices d where d.franchise_id = f.id),
      'members', (select count(*) from members m where m.franchise_id = f.id),
      'sessions_30d', (select count(*) from transactions t where t.franchise_id = f.id and not t.extra and t.at > now() - interval '30 days'),
      'revenue_30d', (select coalesce(sum(case when t.method in ('qris', 'cash') then t.price else 0 end), 0)
                      from transactions t where t.franchise_id = f.id and t.at > now() - interval '30 days')
    ) order by f.created_at)
    from franchises f
  ), '[]'::jsonb));
end;
$$;

-- Membuat (p_id kosong) atau mengubah franchise: nama, aktif/berhenti, langganan sampai, catatan.
create or replace function public.admin_save_franchise(p_id uuid, p_name text, p_active boolean, p_paid_until date, p_note text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  result uuid;
begin
  if not is_superadmin() then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 80 then
    return jsonb_build_object('error', 'name');
  end if;
  if p_id is null then
    -- Layar tamu tablet franchise baru langsung memakai namanya sendiri, sampai diganti di Pengaturan.
    insert into franchises (name, active, paid_until, note, config)
    values (trim(p_name), coalesce(p_active, true), p_paid_until, nullif(trim(coalesce(p_note, '')), ''),
            jsonb_build_object('brand', jsonb_build_object('title', trim(p_name))))
    returning id into result;
  else
    update franchises
      set name = trim(p_name), active = coalesce(p_active, true), paid_until = p_paid_until,
          note = nullif(trim(coalesce(p_note, '')), '')
      where id = p_id
      returning id into result;
    if result is null then
      return jsonb_build_object('error', 'not-found');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', result);
end;
$$;

-- Akun admin sebuah franchise, dengan emailnya.
create or replace function public.admin_members(p_franchise uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_superadmin() then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return jsonb_build_object('members', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'created_at', m.created_at,
                                        'last_sign_in_at', u.last_sign_in_at, 'must_change_password', m.must_change_password)
                     order by m.created_at)
    from members m join auth.users u on u.id = m.user_id
    where m.franchise_id = p_franchise
  ), '[]'::jsonb));
end;
$$;

revoke execute on function public.admin_franchises() from public, anon;
revoke execute on function public.admin_save_franchise(uuid, text, boolean, date, text) from public, anon;
revoke execute on function public.admin_members(uuid) from public, anon;
grant execute on function public.admin_franchises() to authenticated;
grant execute on function public.admin_save_franchise(uuid, text, boolean, date, text) to authenticated;
grant execute on function public.admin_members(uuid) to authenticated;

-- ---------------------------------------------------------------- akun dan kunci (hanya untuk Edge Functions)
--
-- Fungsi svc_* dipanggil Edge Functions dengan service role, setelah fungsi itu sendiri memeriksa
-- siapa pemanggilnya. Pemegang anon/publishable key dan akun dashboard tidak bisa memanggilnya.

create or replace function public.svc_is_superadmin(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from superadmins where user_id = p_user);
$$;

create or replace function public.svc_can_access(p_user uuid, p_franchise uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from franchises where id = p_franchise) and (
    exists (select 1 from superadmins where user_id = p_user)
    or exists (select 1 from members where user_id = p_user and franchise_id = p_franchise)
  );
$$;

-- Akun dengan email ini, kalau sudah ada: id-nya, dan apakah sudah terpakai (superadmin atau admin franchise lain).
create or replace function public.svc_user_by_email(p_email text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select jsonb_build_object(
      'user_id', u.id,
      'superadmin', exists (select 1 from superadmins s where s.user_id = u.id),
      'franchise_id', (select m.franchise_id from members m where m.user_id = u.id)
    )
    from auth.users u where lower(u.email) = lower(trim(p_email))
    limit 1
  ), '{}'::jsonb);
$$;

create or replace function public.svc_member_add(p_user uuid, p_franchise uuid, p_temp boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from franchises where id = p_franchise) then
    return jsonb_build_object('error', 'not-found');
  end if;
  insert into members (user_id, franchise_id, must_change_password)
  values (p_user, p_franchise, coalesce(p_temp, false))
  on conflict (user_id) do nothing;
  if not exists (select 1 from members where user_id = p_user and franchise_id = p_franchise) then
    return jsonb_build_object('error', 'taken');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Franchise sebuah akun admin (kosong kalau bukan admin franchise mana pun), untuk memeriksa sebelum mengubahnya.
create or replace function public.svc_member_of(p_user uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'franchise_id', (select franchise_id from members where user_id = p_user),
    'superadmin', exists (select 1 from superadmins where user_id = p_user)
  );
$$;

create or replace function public.svc_member_flag(p_user uuid, p_temp boolean)
returns void
language sql security definer set search_path = public
as $$
  update members set must_change_password = coalesce(p_temp, false) where user_id = p_user;
$$;

create or replace function public.svc_member_remove(p_user uuid)
returns void
language sql security definer set search_path = public
as $$
  delete from members where user_id = p_user;
$$;

-- Akun admin sebuah franchise yang bukan superadmin: login mereka ikut dihapus saat franchise dihapus.
create or replace function public.svc_franchise_members(p_franchise uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(m.user_id), '[]'::jsonb)
  from members m
  where m.franchise_id = p_franchise and not exists (select 1 from superadmins s where s.user_id = m.user_id);
$$;

-- Menghapus franchise beserta SEMUA datanya (perangkat, transaksi, voucher, frame, keanggotaan adminnya).
create or replace function public.svc_franchise_delete(p_franchise uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  delete from franchises where id = p_franchise;
  return found;
end;
$$;

-- Kunci DOKU sebuah franchise: bagian terbuka dan bagian terenkripsi.
create or replace function public.svc_doku_get(p_franchise uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select jsonb_build_object('doku', s.doku, 'sealed', s.doku_sealed, 'updated_at', s.updated_at)
    from franchise_secrets s where s.franchise_id = p_franchise
  ), '{}'::jsonb);
$$;

create or replace function public.svc_doku_save(p_franchise uuid, p_doku jsonb, p_sealed text)
returns void
language sql security definer set search_path = public
as $$
  insert into franchise_secrets (franchise_id, doku, doku_sealed, updated_at)
  values (p_franchise, coalesce(p_doku, '{}'::jsonb), p_sealed, now())
  on conflict (franchise_id) do update
    set doku = excluded.doku, doku_sealed = excluded.doku_sealed, updated_at = now();
$$;

create or replace function public.svc_doku_clear(p_franchise uuid)
returns void
language sql security definer set search_path = public
as $$
  delete from franchise_secrets where franchise_id = p_franchise;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'svc_is_superadmin(uuid)', 'svc_can_access(uuid, uuid)', 'svc_user_by_email(text)', 'svc_member_add(uuid, uuid, boolean)',
    'svc_member_of(uuid)', 'svc_member_flag(uuid, boolean)', 'svc_member_remove(uuid)',
    'svc_franchise_members(uuid)', 'svc_franchise_delete(uuid)',
    'svc_doku_get(uuid)', 'svc_doku_save(uuid, jsonb, text)', 'svc_doku_clear(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- pembayaran QRIS (hanya untuk Edge Functions)
--
-- Fungsi payment_* dipanggil oleh Edge Functions dengan service role. Tablet dan pemegang
-- anon/publishable key tidak bisa memanggilnya langsung.

-- Membuka tagihan untuk satu pilihan harga. Nominal diambil dari pengaturan franchise di server,
-- bukan dari tablet, sehingga tablet tidak bisa meminta QR dengan harga yang diubah.
create or replace function public.payment_begin(p_token text, p_package_id text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  d devices;
  f franchises;
  cfg jsonb;
  pkg jsonb;
  price int;
  p payments;
begin
  select * into d from devices where token_hash = token_hash(p_token) and active;
  if not found then
    return jsonb_build_object('error', 'unpaired');
  end if;
  select * into f from franchises where id = d.franchise_id;
  if franchise_state(f.active, f.paid_until, grace_days()) in ('expired', 'suspended') then
    return jsonb_build_object('error', 'subscription');
  end if;
  cfg := f.config;
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
  insert into payments (franchise_id, device_id, device_name, package_id, package_name, amount, partner_ref)
  values (d.franchise_id, d.id, d.name, p_package_id, left(pkg ->> 'name', 80), price,
          'FS' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDDHH24MISS') || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)))
  returning * into p;
  return jsonb_build_object('id', p.id, 'amount', p.amount, 'partner_ref', p.partner_ref, 'franchise_id', p.franchise_id,
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
  return jsonb_build_object('id', p.id, 'status', p.status, 'amount', p.amount, 'partner_ref', p.partner_ref, 'franchise_id', p.franchise_id,
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

-- Franchise pemilik sebuah tagihan, dicari lewat nomor referensi kita. Dipakai untuk memilih kunci
-- yang memeriksa tanda tangan pemberitahuan dari penyedia pembayaran.
create or replace function public.payment_franchise(p_partner_ref text)
returns uuid
language sql stable security definer set search_path = public
as $$
  select franchise_id from payments where partner_ref = p_partner_ref;
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
  return jsonb_build_object('franchise_id', d.franchise_id, 'payments', coalesce((
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

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'payment_begin(text, text)', 'payment_attach(uuid, text, text, timestamptz, jsonb)', 'payment_get(text, uuid)',
    'payment_settle(uuid, text, jsonb)', 'payment_franchise(text)', 'payment_settle_by_ref(text, int, jsonb)', 'payment_stale(text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end;
$$;

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
  -- Rem darurat: satu tablet tidak bisa mendaftarkan kode tanpa henti.
  if not exists (select 1 from shares where code = p_code)
     and (select count(*) from shares where device_id = d.id and created_at > now() - interval '1 hour') >= 300 then
    return jsonb_build_object('error', 'too-many');
  end if;
  insert into shares (code, franchise_id, device_id, device_name, expires_at)
  values (p_code, d.franchise_id, d.id, d.name, now() + interval '3 days')
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

-- Hasil foto untuk halaman unduh tamu dan dashboard, masing-masing dengan nama dan warna outlet
-- franchise-nya, ditambah pengaturan platform (nama, watermark).
create or replace function public.share_lookup(p_codes text[])
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'platform', (select config from platform where id = 1),
    'shares', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'files', s.files, 'created_at', s.created_at,
                                          'expires_at', s.expires_at, 'device_name', s.device_name,
                                          'brand', (select f.config -> 'brand' from franchises f where f.id = s.franchise_id),
                                          -- Edit foto AI: percobaan yang gagal, dan apakah satu sedang dikerjakan.
                                          'ai', jsonb_build_object(
                                            'failed', (select count(*) from ai_edits e where e.code = s.code
                                                        and (e.status = 'failed' or (e.status = 'pending' and e.created_at <= now() - interval '3 minutes'))),
                                            'busy', exists (select 1 from ai_edits e where e.code = s.code
                                                             and e.status = 'pending' and e.created_at > now() - interval '3 minutes'))))
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

-- ---------------------------------------------------------------- edit foto AI

-- Membuka satu percobaan edit foto AI untuk sebuah sesi, kalau masih boleh. Dipanggil Edge Function share-ai
-- sebelum fotonya dikirim ke layanan AI, supaya jatah dan batas biaya dijaga di satu tempat:
--   off       fitur dimatikan di Pengaturan platform
--   used      sesi ini sudah punya hasil AI (jatahnya satu)
--   busy      percobaan lain untuk sesi ini masih berjalan
--   tries     sudah tiga kali gagal
--   limit     franchise ini sudah mencapai batas bulanannya
create or replace function public.share_ai_begin(p_code text, p_style text, p_photo text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s shares;
  cfg jsonb;
  cap int;
  month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta';
  new_id uuid;
begin
  -- Baris sesi dikunci, supaya dua ketukan bersamaan tidak sama-sama lolos.
  select * into s from shares where code = p_code for update;
  if not found then
    return jsonb_build_object('error', 'not-found');
  end if;
  if s.expires_at < now() then
    return jsonb_build_object('error', 'expired');
  end if;
  select config -> 'ai' into cfg from platform where id = 1;
  if coalesce(cfg ->> 'enabled', 'false') <> 'true' then
    return jsonb_build_object('error', 'off');
  end if;
  if s.files ? 'ai' or exists (select 1 from ai_edits where code = p_code and status = 'done') then
    return jsonb_build_object('error', 'used');
  end if;
  if coalesce(p_photo, '') !~ '^p[1-6]$' or not (s.files ? p_photo) then
    return jsonb_build_object('error', 'no-photo');
  end if;
  if exists (select 1 from ai_edits where code = p_code and status = 'pending' and created_at > now() - interval '3 minutes') then
    return jsonb_build_object('error', 'busy');
  end if;
  if (select count(*) from ai_edits where code = p_code and status <> 'done') >= 3 then
    return jsonb_build_object('error', 'tries');
  end if;
  cap := case when (cfg ->> 'monthlyLimit') ~ '^[0-9]{1,6}$' then (cfg ->> 'monthlyLimit')::int else 300 end;
  if (select count(*) from ai_edits
       where franchise_id = s.franchise_id and created_at >= month_start
         and (status = 'done' or (status = 'pending' and created_at > now() - interval '3 minutes'))) >= cap then
    return jsonb_build_object('error', 'limit');
  end if;
  insert into ai_edits (code, franchise_id, style, photo)
  values (p_code, s.franchise_id, left(coalesce(p_style, ''), 40), p_photo)
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'key', s.files -> p_photo ->> 'key', 'type', s.files -> p_photo ->> 'type');
end;
$$;

-- Menutup percobaan itu: berhasil (berkas hasilnya dicatat di sesi) atau gagal (dengan alasannya).
create or replace function public.share_ai_finish(p_id uuid, p_ok boolean, p_file jsonb default null, p_detail text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  e ai_edits;
begin
  update ai_edits
    set status = case when p_ok then 'done' else 'failed' end, finished_at = now(), detail = left(p_detail, 500)
    where id = p_id and status = 'pending'
    returning * into e;
  if not found then
    return jsonb_build_object('error', 'not-found');
  end if;
  if p_ok then
    update shares set files = files || jsonb_build_object('ai', coalesce(p_file, '{}'::jsonb) || jsonb_build_object('style', e.style))
      where code = e.code;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Pemakaian edit foto AI bulan ini, untuk pemilik platform: jumlah seluruhnya dan per franchise.
create or replace function public.ai_usage()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta';
begin
  if not is_superadmin() then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return jsonb_build_object(
    'done', (select count(*) from ai_edits where status = 'done' and created_at >= month_start),
    'failed', (select count(*) from ai_edits where status = 'failed' and created_at >= month_start),
    'last_error', (select detail from ai_edits where status = 'failed' and detail is not null order by created_at desc limit 1),
    'franchises', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'done', u.done) order by u.done desc, f.name)
      from (select franchise_id, count(*) as done from ai_edits
             where status = 'done' and created_at >= month_start group by franchise_id) u
      join franchises f on f.id = u.franchise_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.share_ai_begin(text, text, text) from public, anon, authenticated;
revoke execute on function public.share_ai_finish(uuid, boolean, jsonb, text) from public, anon, authenticated;
revoke execute on function public.ai_usage() from public, anon;
grant execute on function public.share_ai_begin(text, text, text) to service_role;
grant execute on function public.share_ai_finish(uuid, boolean, jsonb, text) to service_role;
grant execute on function public.ai_usage() to authenticated;
