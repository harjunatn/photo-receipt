-- MENGHAPUS SEMUA DATA aplikasi di proyek Supabase ini: franchise, perangkat, transaksi, voucher,
-- pembayaran, hasil foto, frame, dan kunci pembayaran. Akun login (Authentication → Users) tidak ikut terhapus.
--
-- Hanya dipakai sekali saat pindah dari skema lama (satu pemilik) ke skema banyak franchise, atau
-- untuk memulai dari nol. Sesudahnya jalankan supabase/schema.sql.

drop table if exists
  public.frames, public.shares, public.vouchers, public.transactions, public.payments, public.devices,
  public.franchise_secrets, public.members, public.franchises, public.superadmins, public.platform,
  public.outlet, public.owners
  cascade;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'device\_%' or p.proname like 'payment\_%' or p.proname like 'share\_%'
           or p.proname like 'svc\_%' or p.proname like 'admin\_%'
           or p.proname = any (array[
             'is_owner', 'claim_owner', 'touch_updated_at', 'token_hash', 'stats_daily', 'voucher_counts',
             'franchise_touch_config', 'is_superadmin', 'my_franchise', 'can_access', 'grace_days', 'franchise_state',
             'whoami', 'password_changed', 'franchise_status', 'save_outlet', 'new_device_code', 'enforce_quota', 'device_before_insert'
           ]))
  loop
    execute 'drop function if exists ' || r.signature || ' cascade';
  end loop;
end;
$$;
