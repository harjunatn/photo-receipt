import { useState } from 'preact/hooks';
import { PAY_METHOD_LABEL } from '../lib/log';
import { formatRupiah } from '../lib/settings';
import type { PageProps } from './Dashboard';
import { compactRupiah, dayKey, daysBack, groupTotals, isOnline, niceCeiling, seriesByDay, total, type Totals } from './stats';
import { LoadState, PageHead, dateTime, useLoad } from './ui';

const LONGEST_RANGE = 30;

/** The landing page: how much came in today and lately, from which tablets and by which way of paying. */
export function Overview({ api, go }: PageProps) {
  const [range, setRange] = useState<7 | 30>(7);
  const load = useLoad(async () => {
    const now = new Date();
    // Thirty days back always reaches the first of the current month as well.
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - LONGEST_RANGE);
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const [stats, devices, recent] = await Promise.all([
      api.dailyStats(from, to),
      api.listDevices(),
      api.listTransactions({ from, to, method: '', deviceId: '' }, 0, 8),
    ]);
    return { now, stats, devices, recent: recent.rows };
  }, [api]);

  if (!load.data) {
    return (
      <>
        <PageHead title="Dashboard" lead="Ringkasan semua booth." />
        <LoadState load={load} />
      </>
    );
  }

  const { now, stats, devices, recent } = load.data;
  const today = dayKey(now);
  const month = today.slice(0, 7);
  const days = daysBack(range, now);
  const inRange = stats.filter((row) => days.includes(row.day));
  const todayTotals = total(stats, (row) => row.day === today);
  const weekTotals = total(stats, (row) => daysBack(7, now).includes(row.day));
  const monthTotals = total(stats, (row) => row.day.startsWith(month));
  const online = devices.filter((device) => isOnline(device, now.getTime())).length;
  const byMethod = groupTotals(inRange, (row) => row.method);
  const byDevice = groupTotals(inRange, (row) => row.device_name);

  return (
    <>
      <PageHead title="Dashboard" lead="Ringkasan semua booth. Omzet hanya menghitung QRIS dan tunai.">
        <button class="btn small" onClick={load.reload}>
          {load.loading ? 'Memuat…' : 'Muat ulang'}
        </button>
      </PageHead>
      {load.error && <p class="banner err">{load.error}</p>}

      <div class="tiles">
        <Tile label="Omzet hari ini" value={formatRupiah(todayTotals.revenue)} note={`${todayTotals.sessions} sesi`} />
        <Tile label="Omzet 7 hari" value={formatRupiah(weekTotals.revenue)} note={`${weekTotals.sessions} sesi`} />
        <Tile label="Omzet bulan ini" value={formatRupiah(monthTotals.revenue)} note={`${monthTotals.sessions} sesi`} />
        <Tile label="Perangkat online" value={`${online} / ${devices.length}`} note={devices.length === 0 ? 'Belum ada perangkat' : 'dari semua perangkat'} />
      </div>

      <section class="panel">
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

      <div class="admin-grid">
        <section class="panel">
          <h2>Cara bayar · {range} hari</h2>
          <Shares rows={byMethod.map((row) => ({ ...row, label: PAY_METHOD_LABEL[row.key as keyof typeof PAY_METHOD_LABEL] ?? row.key }))} measure="sessions" />
        </section>
        <section class="panel">
          <h2>Per perangkat · {range} hari</h2>
          <Shares rows={byDevice.map((row) => ({ ...row, label: row.key }))} measure="revenue" />
        </section>
      </div>

      <section class="panel">
        <div class="row">
          <h2 class="grow">Transaksi terbaru</h2>
          <button class="btn small" onClick={() => go('transaksi')}>
            Lihat semua
          </button>
        </div>
        {recent.length === 0 ? (
          <p class="hint">Belum ada transaksi. Transaksi muncul di sini setelah tablet yang terpasang menyelesaikan sesi.</p>
        ) : (
          <div class="table-wrap">
            <table class="table">
              <tbody>
                {recent.map((tx) => (
                  <tr key={tx.id}>
                    <td>{dateTime(tx.at)}</td>
                    <td>{tx.device_name}</td>
                    <td>
                      {tx.frame} · {tx.package}
                    </td>
                    <td>{PAY_METHOD_LABEL[tx.method]}</td>
                    <td class="num">{formatRupiah(tx.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div class="tile">
      <span>{label}</span>
      <b>{value}</b>
      <small>{note}</small>
    </div>
  );
}

function dayLabel(day: string, long: boolean): string {
  const date = new Date(`${day}T00:00:00`);
  return date.toLocaleDateString('id-ID', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' });
}

/** Revenue per day as bars. Pointing at (or tapping) a bar reads out its day above the chart. */
function DayChart({ points }: { points: (Totals & { day: string })[] }) {
  const [active, setActive] = useState<number | null>(null);
  const top = niceCeiling(Math.max(...points.map((point) => point.revenue)));
  const sum = points.reduce((acc, point) => acc + point.revenue, 0);
  const shown = active !== null ? points[active] : null;
  // About six date labels fit under the chart on a phone.
  const every = Math.ceil(points.length / 7);

  return (
    <div class="chart">
      <p class="chart-readout">
        {shown ? (
          <>
            <b>{formatRupiah(shown.revenue)}</b> · {shown.sessions} sesi · {dayLabel(shown.day, true)}
          </>
        ) : (
          <>
            <b>{formatRupiah(sum)}</b> dalam {points.length} hari · arahkan ke batang untuk rinciannya
          </>
        )}
      </p>
      <div class="chart-plot" onMouseLeave={() => setActive(null)}>
        <div class="chart-grid" aria-hidden="true">
          {[1, 0.5, 0].map((part) => (
            <span key={part} style={{ bottom: `${part * 100}%` }}>
              <i>{part === 0 ? 'Rp0' : compactRupiah(top * part)}</i>
            </span>
          ))}
        </div>
        <div class="chart-bars">
          {points.map((point, index) => (
            <button
              key={point.day}
              class={`chart-col ${active === index ? 'on' : ''}`}
              aria-label={`${dayLabel(point.day, true)}: ${formatRupiah(point.revenue)}, ${point.sessions} sesi`}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(index)}
            >
              <i style={{ height: `${(point.revenue / top) * 100}%` }} />
            </button>
          ))}
        </div>
      </div>
      <div class="chart-axis" aria-hidden="true">
        {points.map((point, index) => (
          <span key={point.day}>{(points.length - 1 - index) % every === 0 ? dayLabel(point.day, false) : ''}</span>
        ))}
      </div>
    </div>
  );
}

/** A ranked list where each row's bar shows its share of the largest row. */
function Shares({ rows, measure }: { rows: (Totals & { key: string; label: string })[]; measure: 'sessions' | 'revenue' }) {
  const largest = Math.max(1, ...rows.map((row) => row[measure]));
  if (rows.length === 0) return <p class="hint">Belum ada data pada rentang ini.</p>;
  return (
    <div class="shares">
      {rows.map((row) => (
        <div class="share" key={row.key}>
          <div class="row">
            <span class="grow">{row.label}</span>
            <span class="hint">
              {row.sessions} sesi · {formatRupiah(row.revenue)}
            </span>
          </div>
          <div class="share-track">
            <i style={{ width: `${(row[measure] / largest) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
