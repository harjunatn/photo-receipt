import '../dashboard/dashboard.css';
import { useState } from 'preact/hooks';
import { DayChart, Shares } from '../dashboard/Overview';
import { Tile } from '../dashboard/ui';
import { dayKey, daysBack, groupTotals, seriesByDay, total } from '../dashboard/stats';
import { useLoad } from '../dashboard/ui';
import { fetchBoothStats, outboxStore, pairingStore } from '../lib/cloud/device';
import { logStore, PAY_METHOD_LABEL, startOfToday, totalsSince } from '../lib/log';
import { formatRupiah } from '../lib/settings';
import { useStore } from '../lib/store';
import { CardFlow } from '../ui/CardFlow';

/** Sales of this tablet only, from the server: the same figures the owner sees for it in the dashboard. */
export function BoothSalesTab() {
  const pairing = useStore(pairingStore);
  const queued = useStore(outboxStore).length;
  const log = useStore(logStore);
  const [range, setRange] = useState<7 | 30>(7);
  const load = useLoad(async () => {
    const now = new Date();
    // Thirty days back always reaches the first of the current month as well.
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { now, stats: await fetchBoothStats(from, to) };
  }, [pairing?.token]);

  if (!pairing) {
    return (
      <CardFlow>
        <p class="banner panel span">Sambungkan tablet ini ke dashboard dulu (tab Sambungan) untuk melihat penjualannya.</p>
      </CardFlow>
    );
  }

  const header = (
    <section class="panel span">
      <div class="row">
        <div class="grow">
          <h2>Penjualan {pairing.name}</h2>
          <p class="hint">Hanya sesi dari tablet ini. Omzet menghitung QRIS dan tunai; voucher dan sesi gratis Rp0.</p>
        </div>
        <button class="btn small" onClick={load.reload}>
          {load.loading ? 'Memuat…' : 'Muat ulang'}
        </button>
      </div>
      {queued > 0 && <p class="banner">{queued} sesi terakhir belum terkirim ke server, jadi belum ikut terhitung di sini.</p>}
    </section>
  );

  if (!load.data) {
    // Without the server, at least today's count from this tablet's own notes.
    const today = totalsSince(log, startOfToday());
    return (
      <CardFlow>
        {header}
        {load.error ? (
          <section class="panel span">
            <p class="banner err">Data penjualan butuh internet. {load.error}</p>
            <p class="hint">
              Catatan di tablet ini untuk hari ini: <b>{today.sessions} sesi</b>, <b>{formatRupiah(today.revenue)}</b>.
            </p>
          </section>
        ) : (
          <div class="spinner" />
        )}
      </CardFlow>
    );
  }

  const { now, stats } = load.data;
  const today = dayKey(now);
  const week = daysBack(7, now);
  const days = daysBack(range, now);
  const inRange = stats.filter((row) => days.includes(row.day));
  const todayTotals = total(stats, (row) => row.day === today);
  const weekTotals = total(stats, (row) => week.includes(row.day));
  const monthTotals = total(stats, (row) => row.day.startsWith(today.slice(0, 7)));

  return (
    <CardFlow>
      {header}
      {load.error && <p class="banner err panel span">{load.error}</p>}

      <div class="tiles panel span" style={{ padding: 0 }}>
        <Tile label="Hari ini" value={formatRupiah(todayTotals.revenue)} note={`${todayTotals.sessions} sesi · ${todayTotals.prints} lembar`} />
        <Tile label="7 hari" value={formatRupiah(weekTotals.revenue)} note={`${weekTotals.sessions} sesi`} />
        <Tile label="Bulan ini" value={formatRupiah(monthTotals.revenue)} note={`${monthTotals.sessions} sesi`} />
      </div>

      <section class="panel span">
        <div class="row">
          <h2 class="grow">Omzet per hari</h2>
          <div class="chips tight">
            {([7, 30] as const).map((option) => (
              <button key={option} class={`chip ${range === option ? 'on' : ''}`} onClick={() => setRange(option)}>
                {option} hari
              </button>
            ))}
          </div>
        </div>
        <DayChart points={seriesByDay(stats, days)} />
      </section>

      <section class="panel span">
        <h2>Cara bayar · {range} hari</h2>
        <Shares
          rows={groupTotals(inRange, (row) => row.method).map((row) => ({ ...row, label: PAY_METHOD_LABEL[row.key as keyof typeof PAY_METHOD_LABEL] ?? row.key }))}
          measure="sessions"
        />
      </section>
    </CardFlow>
  );
}
