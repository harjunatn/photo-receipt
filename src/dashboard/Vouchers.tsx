import { useState } from 'preact/hooks';
import { download } from '../lib/kiosk';
import { toCsv } from '../lib/log';
import { generateVouchers, voucherStatus, type VoucherStatus } from '../lib/vouchers';
import { toast } from '../ui/components';
import type { VoucherRow } from './api';
import type { PageProps } from './Dashboard';
import { LoadState, PageHead, Pager, dateOnly, dateTime, describe, useLoad } from './ui';

const PAGE_SIZE = 50;
const STATUS_LABEL: Record<VoucherStatus, string> = { active: 'Aktif', used: 'Terpakai', expired: 'Kedaluwarsa' };
const STATUS_TAG: Record<VoucherStatus, string> = { active: 'ok', used: '', expired: 'warn' };
const FILTERS: (VoucherStatus | 'all')[] = ['active', 'used', 'expired', 'all'];

function statusOf(row: VoucherRow, now: number): VoucherStatus {
  return voucherStatus(
    { code: row.code, createdAt: 0, expiresAt: row.expires_at ? Date.parse(row.expires_at) : null, usedAt: row.used_at ? Date.parse(row.used_at) : null },
    now,
  );
}

/** Single-use codes that stand in for payment on any paired tablet. */
export function Vouchers({ api }: PageProps) {
  const [status, setStatus] = useState<VoucherStatus | 'all'>('active');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [prefix, setPrefix] = useState('FOTO');
  const [count, setCount] = useState('10');
  const [validDays, setValidDays] = useState('30');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState('');

  const counts = useLoad(() => api.voucherCounts(), [api]);
  const load = useLoad(() => api.listVouchers({ status, search }, offset, PAGE_SIZE), [api, status, search, offset]);
  const now = Date.now();
  const wanted = Math.floor(Number(count));
  const days = Math.floor(Number(validDays));

  const refresh = () => {
    counts.reload();
    load.reload();
  };

  const create = async (event: Event) => {
    event.preventDefault();
    if (!(wanted >= 1 && wanted <= 500)) {
      toast('Jumlah voucher harus antara 1 dan 500.');
      return;
    }
    setBusy(true);
    try {
      const made = generateVouchers([], { prefix, count: wanted, validDays: days > 0 ? days : null, now: Date.now() });
      await api.createVouchers(
        made.map((v) => ({ code: v.code, label: label.trim() || null, expires_at: v.expiresAt === null ? null : new Date(v.expiresAt).toISOString() })),
      );
      setFresh(made.map((v) => v.code));
      setStatus('active');
      setOffset(0);
      refresh();
      toast(`${made.length} voucher dibuat.`);
    } catch (cause) {
      toast(describe(cause));
    }
    setBusy(false);
  };

  const remove = async (code: string) => {
    setConfirmDelete('');
    try {
      await api.deleteVoucher(code);
      setFresh((list) => list.filter((other) => other !== code));
      refresh();
    } catch (cause) {
      toast(describe(cause));
    }
  };

  const copyFresh = async () => {
    try {
      await navigator.clipboard.writeText(fresh.join('\n'));
      toast('Kode disalin.');
    } catch {
      toast('Browser tidak mengizinkan menyalin. Unduh CSV saja.');
    }
  };

  return (
    <>
      <PageHead title="Voucher" lead="Kode sekali pakai, berlaku di semua tablet yang terpasang. Tablet perlu internet untuk menerimanya." />

      <div class="tiles">
        {(['active', 'used', 'expired'] as const).map((key) => (
          <div class="tile" key={key}>
            <span>{STATUS_LABEL[key]}</span>
            <b>{counts.data ? counts.data[key].toLocaleString('id-ID') : '—'}</b>
            <small>voucher</small>
          </div>
        ))}
      </div>

      <form class="panel" onSubmit={(event) => void create(event)}>
        <h2>Buat voucher</h2>
        <div class="filters">
          <label class="field">
            <span>Jumlah</span>
            <input type="number" inputMode="numeric" min={1} max={500} value={count} onInput={(event) => setCount(event.currentTarget.value)} />
          </label>
          <label class="field">
            <span>Awalan kode</span>
            <input type="text" maxLength={8} value={prefix} onInput={(event) => setPrefix(event.currentTarget.value.toUpperCase())} />
          </label>
          <label class="field">
            <span>Berlaku (hari, 0 = selamanya)</span>
            <input type="number" inputMode="numeric" min={0} max={3650} value={validDays} onInput={(event) => setValidDays(event.currentTarget.value)} />
          </label>
          <label class="field">
            <span>Catatan (opsional)</span>
            <input type="text" maxLength={60} value={label} placeholder="Promo pembukaan" onInput={(event) => setLabel(event.currentTarget.value)} />
          </label>
        </div>
        <div class="row">
          <button class="btn small primary" disabled={busy}>
            {busy ? 'Membuat…' : `Buat ${wanted >= 1 ? wanted : ''} voucher`}
          </button>
        </div>
        {fresh.length > 0 && (
          <div class="panel">
            <div class="row">
              <b class="grow">{fresh.length} kode baru</b>
              <button type="button" class="btn small" onClick={() => void copyFresh()}>
                Salin semua
              </button>
              <button
                type="button"
                class="btn small"
                onClick={() => download('voucher-baru.csv', new Blob([toCsv([['kode'], ...fresh.map((code) => [code])])], { type: 'text/csv' }))}
              >
                Unduh CSV
              </button>
            </div>
            <p class="mono codes">{fresh.join('   ')}</p>
          </div>
        )}
      </form>

      <section class={`panel ${load.loading ? 'busy' : ''}`}>
        <div class="row">
          <div class="chips tight grow">
            {FILTERS.map((option) => (
              <button
                key={option}
                class={`chip ${status === option ? 'on' : ''}`}
                onClick={() => {
                  setStatus(option);
                  setOffset(0);
                }}
              >
                {option === 'all' ? 'Semua' : STATUS_LABEL[option]}
              </button>
            ))}
          </div>
          <label class="field">
            <input
              type="search"
              placeholder="Cari kode"
              value={search}
              onInput={(event) => {
                setSearch(event.currentTarget.value);
                setOffset(0);
              }}
            />
          </label>
        </div>
        <LoadState load={load} />
        {load.data?.rows.length === 0 && <p class="hint">Tidak ada voucher untuk pilihan ini.</p>}
        {load.data && load.data.rows.length > 0 && (
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Status</th>
                  <th>Catatan</th>
                  <th>Berlaku sampai</th>
                  <th>Dipakai</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {load.data.rows.map((row) => {
                  const state = statusOf(row, now);
                  return (
                    <tr key={row.code}>
                      <td class="mono">{row.code}</td>
                      <td>
                        <span class={`tag ${STATUS_TAG[state]}`}>{STATUS_LABEL[state]}</span>
                      </td>
                      <td>{row.label ?? ''}</td>
                      <td>{row.expires_at ? dateOnly(row.expires_at) : 'Selamanya'}</td>
                      <td>{row.used_at ? `${dateTime(row.used_at)}${row.used_by_name ? ` · ${row.used_by_name}` : ''}` : '—'}</td>
                      <td class="num">
                        {confirmDelete === row.code ? (
                          <button class="link danger" onClick={() => void remove(row.code)}>
                            Yakin hapus?
                          </button>
                        ) : (
                          <button class="link" onClick={() => setConfirmDelete(row.code)}>
                            Hapus
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {load.data && <Pager offset={offset} limit={PAGE_SIZE} total={load.data.total} onChange={setOffset} />}
      </section>
    </>
  );
}
