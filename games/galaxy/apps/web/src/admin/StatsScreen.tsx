import { type AdminStats, STATS_PERIODS, type StatsPeriod, type StatsSection, TIERS } from '@galaxy/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { ADMIN_KEY } from '../api/admin';
import { api } from '../api/client';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';

const t = copy.admin.stats;
const whole = new Intl.NumberFormat('es-ES');
const compact = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 1 });
const big = (n: number) => (Math.abs(n) >= 100_000 ? compact.format(n) : whole.format(n));
const hour = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const day = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const hourOf = (iso: string) => `${new Date(iso).getHours()} h`;
const csvHref = (period: StatsPeriod, section: StatsSection) => `/galaxy/api/admin/stats.csv?period=${period}&section=${section}`;

/**
 * Estadísticas (GDD §16.6; DESIGN_SYSTEM §8 unvicies), admins only. The figures of the period (the last 24 hours by
 * hour, 7 or 30 days by day), read again every 30 s: tiles, runs as one-series bars (each named with its number, with a
 * table), each currency's flows in and out (blue in, amber out; a palette validated for colour vision), rarities real
 * (a bar) against expected (a tick), the market, and a CSV per section.
 */
export function StatsScreen() {
  const [period, setPeriod] = useState<StatsPeriod>('24h');
  const stats = useQuery({
    queryKey: [...ADMIN_KEY, 'stats', period],
    queryFn: () => api<AdminStats>(`/admin/stats?period=${period}`),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
  const s = stats.data;
  return (
    <section className="admin-page stats">
      <h1>{copy.admin.sections.stats}</h1>
      <div className="stats-bar">
        <div className="deal-kinds" role="group" aria-label={t.periodsLabel}>
          {STATS_PERIODS.map((p) => (
            <button key={p} type="button" className="lip pill small" aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {t.periods[p]}
            </button>
          ))}
        </div>
        {stats.dataUpdatedAt ? <p className="stats-updated">{t.updated(hour.format(new Date(stats.dataUpdatedAt)))}</p> : null}
      </div>
      {stats.error ? (
        <p className="field-error" role="alert">
          {errorText(stats.error, copy.errors)}
        </p>
      ) : null}
      {s ? (
        <>
          <Tiles s={s} />
          <Runs s={s} />
          <Currencies s={s} />
          <Pulls s={s} />
          <Market s={s} />
        </>
      ) : null}
    </section>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="stat-tile" role="group" aria-label={label}>
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
      {detail ? <span className="stat-detail">{detail}</span> : null}
    </div>
  );
}

function Tiles({ s }: { s: AdminStats }) {
  const runs = s.runs.buckets.reduce((n, b) => n + b.count, 0);
  return (
    <div className="stat-tiles">
      <Tile label={t.tiles.online} value={big(s.players.online)} detail={t.tiles.sockets(s.players.sockets)} />
      <Tile label={t.tiles.newAccounts} value={big(s.players.newAccounts)} detail={t.tiles.active(s.players.activeAccounts)} />
      <Tile label={t.tiles.runs} value={big(runs)} />
      <Tile label={t.tiles.pulls} value={big(s.pulls.total)} />
      <Tile label={t.tiles.sold} value={big(s.market.coins)} />
      <Tile label={t.tiles.pending} value={big(s.pending.alerts + s.pending.reports)} detail={t.tiles.pendingDetail(s.pending.alerts, s.pending.reports)} />
    </div>
  );
}

function SectionHead({ title, period, section, children }: { title: string; period: StatsPeriod; section: StatsSection; children?: ReactNode }) {
  return (
    <header className="stats-head">
      <h2>{title}</h2>
      {children}
      <a className="stats-csv" href={csvHref(period, section)} download>
        {t.csv}
      </a>
    </header>
  );
}

/** One series of bars from a single baseline: ≤ 24 px thick, rounded at the data end, a hairline grid, a tooltip. */
function Runs({ s }: { s: AdminStats }) {
  const [hover, setHover] = useState<number | null>(null);
  const label = (iso: string) => (s.period === '24h' ? hourOf(iso) : day.format(new Date(iso)));
  const max = Math.max(1, ...s.runs.buckets.map((b) => b.count));
  const W = 720;
  const H = 180;
  // A gutter on the left for the axis labels, so no bar ever covers them.
  const G = 36;
  const n = Math.max(1, s.runs.buckets.length);
  const slot = (W - G) / n;
  const bar = Math.min(24, slot - 2);
  const every = Math.ceil(n / 8);
  const ticks = [0, Math.ceil(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  const y = (v: number) => H - (v / max) * (H - 8);
  return (
    <section className="lip panel stats-section">
      <SectionHead title={t.runsTitle} period={s.period} section="runs" />
      <div className="stats-chart">
        <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={t.runsChart}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={G} x2={W} y1={y(v)} y2={y(v)} className="stats-grid" />
              <text x={G - 6} y={y(v) + 4} className="stats-axis" textAnchor="end">
                {whole.format(v)}
              </text>
            </g>
          ))}
          {s.runs.buckets.map((b, i) => {
            const h = H - y(b.count);
            const x = G + i * slot + (slot - bar) / 2;
            return (
              <g key={b.at} data-bar tabIndex={0} aria-label={t.bar(label(b.at), b.count)} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
                <rect x={G + i * slot} y={0} width={slot} height={H} fill="transparent" />
                {b.count > 0 ? <path className={`stats-bar-mark${hover === i ? ' on' : ''}`} d={`M${x},${H} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${bar - 8} q4,0 4,4 v${Math.max(0, h - 4)} z`} /> : null}
                {i % every === 0 ? (
                  <text x={G + i * slot + slot / 2} y={H + 16} className="stats-axis" textAnchor="middle">
                    {label(b.at)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        {hover !== null && s.runs.buckets[hover] ? (
          <p className="stats-tip" style={{ left: `${((G + (hover + 0.5) * slot) / W) * 100}%` }} aria-hidden="true">
            <b>{whole.format(s.runs.buckets[hover]!.count)}</b>
            <span>{label(s.runs.buckets[hover]!.at)}</span>
          </p>
        ) : null}
      </div>
      <ul className="stats-outcomes">
        {(['extracted', 'died', 'abandoned', 'open'] as const).map((k) => (
          <li key={k}>{t.outcomes[k](s.runs.outcomes[k])}</li>
        ))}
      </ul>
      <table className="sr-only" aria-label={t.runsTable}>
        <thead>
          <tr>
            <th scope="col">{t.bucket}</th>
            <th scope="col">{t.runsCount}</th>
          </tr>
        </thead>
        <tbody>
          {s.runs.buckets.map((b) => (
            <tr key={b.at}>
              <td>{label(b.at)}</td>
              <td>{b.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Currencies({ s }: { s: AdminStats }) {
  const max = Math.max(1, ...s.currencies.flatMap((c) => [c.in, c.out]));
  return (
    <section className="lip panel stats-section">
      <SectionHead title={t.currenciesTitle} period={s.period} section="currencies">
        <p className="stats-legend" aria-hidden="true">
          <span className="key in" />
          {t.in}
          <span className="key out" />
          {t.out}
        </p>
      </SectionHead>
      {s.currencies.length === 0 ? <p className="panel-note">{t.noFlows}</p> : null}
      {s.currencies.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table stats-flows">
            <caption className="sr-only">{t.currenciesTitle}</caption>
            <thead>
              <tr>
                <th scope="col">{t.reason}</th>
                <th scope="col">{t.in}</th>
                <th scope="col">{t.out}</th>
                <th scope="col">{t.net}</th>
              </tr>
            </thead>
            {s.currencies.map((c) => (
              <tbody key={c.currency}>
                <tr className="stats-flow-total">
                  <th scope="row">{t.currency(c.currency)}</th>
                  <FlowCell value={c.in} max={max} kind="in" />
                  <FlowCell value={c.out} max={max} kind="out" />
                  <td className="num">{whole.format(c.in - c.out)}</td>
                </tr>
                {c.byReason.map((r) => (
                  <tr key={r.reason} className="stats-flow-reason">
                    <td>
                      <code>{r.reason}</code>
                    </td>
                    <td className="num">{r.in ? whole.format(r.in) : '—'}</td>
                    <td className="num">{r.out ? whole.format(r.out) : '—'}</td>
                    <td className="num">{whole.format(r.in - r.out)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      ) : null}
    </section>
  );
}

function FlowCell({ value, max, kind }: { value: number; max: number; kind: 'in' | 'out' }) {
  return (
    <td>
      <div className="stats-flow-cell">
        <span className="stats-flow-bar" aria-hidden="true">
          <i className={kind} style={{ inlineSize: `${(value / max) * 100}%` }} />
        </span>
        <span className="num">{whole.format(value)}</span>
      </div>
    </td>
  );
}

function Pulls({ s }: { s: AdminStats }) {
  const total = s.pulls.total;
  const max = Math.max(...s.pulls.tiers.map((x) => Math.max(x.expected, total ? x.count / total : 0)), 0.01);
  return (
    <section className="lip panel stats-section">
      <SectionHead title={t.pullsTitle} period={s.period} section="pulls">
        <p className="stats-legend" aria-hidden="true">
          <span className="key in" />
          {t.real}
          <span className="key tick" />
          {t.expected}
        </p>
      </SectionHead>
      <p className="stats-sub">{total ? t.pullsTotal(total) : t.noPulls}</p>
      <div className="admin-table-wrap">
        <table className="admin-table stats-pulls">
          <caption className="sr-only">{t.pullsTitle}</caption>
          <thead>
            <tr>
              <th scope="col">{t.tier}</th>
              <th scope="col">{t.real}</th>
              <th scope="col">{t.expected}</th>
            </tr>
          </thead>
          <tbody>
            {s.pulls.tiers.map((x) => {
              const real = total ? x.count / total : null;
              return (
                <tr key={x.tier} data-tier={TIERS[x.tier]}>
                  <th scope="row">
                    <i className="stats-tier" aria-hidden="true" />
                    {copy.tiers[TIERS[x.tier]!]}
                  </th>
                  <td>
                    <div className="stats-pull-cell">
                      <span className="stats-pull-bar" aria-hidden="true">
                        {real !== null ? <i className="in" style={{ inlineSize: `${(real / max) * 100}%` }} /> : null}
                        <b className="tick" style={{ insetInlineStart: `${(x.expected / max) * 100}%` }} />
                      </span>
                      <span className="num">{real !== null ? percent.format(real) : '—'}</span>
                    </div>
                  </td>
                  <td className="num">{percent.format(x.expected)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Market({ s }: { s: AdminStats }) {
  return (
    <section className="lip panel stats-section">
      <SectionHead title={t.marketTitle} period={s.period} section="market" />
      <div className="stat-tiles small">
        {(['listed', 'sold', 'coins', 'commission', 'tradesDone', 'tradesCancelled'] as const).map((k) => (
          <Tile key={k} label={t.market[k]} value={big(s.market[k])} />
        ))}
      </div>
    </section>
  );
}

