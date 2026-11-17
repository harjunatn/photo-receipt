import { useState } from 'preact/hooks';
import { formatRupiah } from '../lib/settings';
import type { PaymentRow, PaymentStatus } from './api';
import type { PageProps } from './Dashboard';
import { LoadState, PageHead, Pager, dateTime, useLoad } from './ui';

const PAGE_SIZE = 50;

type Filter = PaymentStatus | 'all' | 'orphan';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Semua' },
  { id: 'paid', label: 'Lunas' },
  { id: 'orphan', label: 'Lunas tanpa sesi' },
  { id: 'expired', label: 'Tidak dibayar' },
  { id: 'failed', label: 'Gagal' },
  { id: 'pending', label: 'Menunggu' },
];

function state(row: PaymentRow): { label: string; tag: string } {
  if (row.status === 'paid') return row.has_session ? { label: 'Lunas', tag: 'ok' } : { label: 'Lunas tanpa sesi', tag: 'err' };
  if (row.status === 'pending') return { label: 'Menunggu', tag: 'warn' };
  return row.status === 'expired' ? { label: 'Tidak dibayar', tag: '' } : { label: 'Gagal', tag: '' };
}

/** Every QR made for automatic QRIS, to match the money received against the sessions held. */
export function Payments({ api }: PageProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [offset, setOffset] = useState(0);
  const load = useLoad(() => api.listPayments(filter, offset, PAGE_SIZE), [api, filter, offset]);

  return (
    <>
      <PageHead
        title="Pembayaran QRIS"
        lead="Setiap kode QR otomatis yang dibuat tablet. “Lunas tanpa sesi” berarti uangnya masuk tetapi sesi fotonya tidak tercatat selesai — periksa, dan kembalikan uangnya kalau perlu."
      >
        <button class="btn small" onClick={load.reload}>
          {load.loading ? 'Memuat…' : 'Muat ulang'}
        </button>
      </PageHead>

      <section class={`panel ${load.loading ? 'busy' : ''}`}>
        <div class="chips tight">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              class={`chip ${filter === option.id ? 'on' : ''}`}
              onClick={() => {
                setFilter(option.id);
                setOffset(0);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <LoadState load={load} />
        {load.data?.rows.length === 0 && (
          <p class="hint">
            {filter === 'orphan' ? 'Tidak ada. Semua pembayaran yang lunas punya sesinya.' : 'Belum ada pembayaran untuk pilihan ini.'}
          </p>
        )}
        {load.data && load.data.rows.length > 0 && (
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Dibuat</th>
                  <th>Perangkat</th>
                  <th>Pilihan</th>
                  <th>Status</th>
                  <th>Dibayar</th>
                  <th>Referensi</th>
                  <th class="num">Nominal</th>
                </tr>
              </thead>
              <tbody>
                {load.data.rows.map((row) => {
                  const shown = state(row);
                  return (
                    <tr key={row.id}>
                      <td>{dateTime(row.created_at)}</td>
                      <td>{row.device_name}</td>
                      <td>{row.package_name ?? ''}</td>
                      <td>
                        <span class={`tag ${shown.tag}`}>{shown.label}</span>
                      </td>
                      <td>{row.paid_at ? dateTime(row.paid_at) : '—'}</td>
                      <td class="mono">
                        <small>{row.provider_ref ?? row.partner_ref}</small>
                      </td>
                      <td class="num">{formatRupiah(row.amount)}</td>
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
