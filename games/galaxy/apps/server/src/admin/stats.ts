import { type AdminStats, expectedTierRates, type StatsPeriod, type StatsSection, TIERS } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { ChatHub } from '../chat/hub';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';

// Live statistics for admins (GDD §16.6; M6d-2), read-only aggregates over the game's own tables: sessions (connected:
// seen in the last 5 minutes; sessions touch last_seen_at every 5), runs by start time in hourly or daily UTC buckets
// (empty ones filled), the ledger's flows in and out by currency and reason, pulls by tier against the live gacha
// config's expected shares, market and trade volume, and what waits for review. Each section also renders as CSV.

export type StatsDeps = { db: Kysely<DB>; config: ConfigReader; hub: Pick<ChatHub, 'size'>; now: () => Date };

const HOUR = 3_600_000;
const DAY = 86_400_000;
// Twice the sessions' touch interval (5 min): a player making requests never drops out between two touches.
const ONLINE_MS = 10 * 60_000;
const DAYS: Record<StatsPeriod, number> = { '24h': 1, '7d': 7, '30d': 30 };

/** The period's start, and its buckets' starts (24 hours, or UTC days ending today). */
function window(period: StatsPeriod, now: Date): { from: Date; buckets: Date[]; unit: 'hour' | 'day' } {
  if (period === '24h') {
    const top = Math.floor(now.getTime() / HOUR) * HOUR;
    // The window starts where its first hourly bar does, so every run counted is in a bar (M6d-2 review).
    return { from: new Date(top - 23 * HOUR), buckets: Array.from({ length: 24 }, (_, i) => new Date(top - (23 - i) * HOUR)), unit: 'hour' };
  }
  const today = Math.floor(now.getTime() / DAY) * DAY;
  const n = DAYS[period];
  const buckets = Array.from({ length: n }, (_, i) => new Date(today - (n - 1 - i) * DAY));
  return { from: buckets[0]!, buckets, unit: 'day' };
}

const num = (v: unknown) => Number(v ?? 0);

export async function adminStats(deps: StatsDeps, period: StatsPeriod): Promise<AdminStats> {
  const { db } = deps;
  const now = deps.now();
  const { from, buckets, unit } = window(period, now);

  const [online, newAccounts, active] = await Promise.all([
    db.selectFrom('galaxy.sessions').select(sql<number>`count(distinct account_id)::int`.as('n')).where('last_seen_at', '>', new Date(now.getTime() - ONLINE_MS)).where('expires_at', '>', now).executeTakeFirstOrThrow(),
    db.selectFrom('galaxy.accounts').select(sql<number>`count(*)::int`.as('n')).where('created_at', '>=', from).executeTakeFirstOrThrow(),
    db.selectFrom('galaxy.sessions').select(sql<number>`count(distinct account_id)::int`.as('n')).where('last_seen_at', '>=', from).executeTakeFirstOrThrow(),
  ]);

  // Each bucket as its UTC hour or day in text ("2026-11-08T13" or "2026-11-08T00"), so the process's time zone never
  // shifts it.
  const fmt = unit === 'hour' ? sql`to_char(date_trunc('hour', started_at at time zone 'UTC'), 'YYYY-MM-DD"T"HH24')` : sql`to_char(date_trunc('day', started_at at time zone 'UTC'), 'YYYY-MM-DD"T"HH24')`;
  const [byBucket, outcomes] = await Promise.all([
    sql<{ b: string; n: number }>`select ${fmt} as b, count(*)::int as n from galaxy.runs where started_at >= ${from} group by 1`.execute(db),
    db.selectFrom('galaxy.runs').select(['outcome', sql<number>`count(*)::int`.as('n')]).where('started_at', '>=', from).where('outcome', 'is not', null).groupBy('outcome').execute(),
  ]);
  // Not finished: still open while it can finish (runs.expireHours), unfinished for good after that.
  const { expireHours } = await deps.config.get('runs');
  const expiry = new Date(now.getTime() - expireHours * HOUR);
  const pending = await db
    .selectFrom('galaxy.runs')
    .select([sql<number>`count(*) filter (where started_at > ${expiry})::int`.as('open'), sql<number>`count(*) filter (where started_at <= ${expiry})::int`.as('unfinished')])
    .where('started_at', '>=', from)
    .where('outcome', 'is', null)
    .executeTakeFirstOrThrow();
  const counts = new Map(byBucket.rows.map((r) => [r.b, r.n]));
  const outcome = (o: string | null) => outcomes.find((r) => r.outcome === o)?.n ?? 0;

  const flows = await db
    .selectFrom('galaxy.ledger')
    .select(['currency', 'reason', sql<string>`coalesce(sum(case when delta > 0 then delta else 0 end), 0)`.as('in'), sql<string>`coalesce(sum(case when delta < 0 then -delta else 0 end), 0)`.as('out')])
    .where('created_at', '>=', from)
    .groupBy(['currency', 'reason'])
    .execute();
  const order = ['coins', 'dust', 'signal'];
  const currencies = [...new Set(flows.map((f) => f.currency))]
    .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b))
    .map((currency) => {
      const byReason = flows
        .filter((f) => f.currency === currency)
        .map((f) => ({ reason: f.reason, in: num(f.in), out: num(f.out) }))
        .sort((a, b) => b.in + b.out - (a.in + a.out) || a.reason.localeCompare(b.reason));
      return { currency, in: byReason.reduce((n, r) => n + r.in, 0), out: byReason.reduce((n, r) => n + r.out, 0), byReason };
    });

  const [pulls, gacha] = await Promise.all([
    db.selectFrom('galaxy.gacha_pulls').select(['tier', sql<number>`count(*)::int`.as('n')]).where('created_at', '>=', from).groupBy('tier').execute(),
    deps.config.get('gacha'),
  ]);
  const expected = expectedTierRates(gacha);
  const tiers = TIERS.map((_, tier) => ({ tier, count: pulls.find((p) => p.tier === tier)?.n ?? 0, expected: expected[tier] ?? 0 }));

  // Group runs (phase 7): those that ended in the period, their players, and who left or stood idle in them.
  const [coopRuns, coopRows] = await Promise.all([
    db
      .selectFrom('galaxy.coop_runs')
      .select([
        sql<number>`count(*)::int`.as('n'),
        sql<number>`(count(*) filter (where outcome = 'extracted'))::int`.as('extracted'),
        sql<number>`(count(*) filter (where outcome = 'died'))::int`.as('died'),
        sql<number>`(count(*) filter (where outcome = 'interrupted'))::int`.as('interrupted'),
        sql<string | null>`avg(depth)`.as('depth'),
      ])
      .where('state', '<>', 'running')
      .where('ended_at', '>=', from)
      .executeTakeFirstOrThrow(),
    sql<{ players: number; abandons: number; idle: number }>`
      select
        (select count(*)::int from galaxy.runs r join galaxy.coop_runs c on c.id = r.coop_run_id where c.state <> 'running' and c.ended_at >= ${from}) as players,
        (select count(*)::int from galaxy.runs where left_at >= ${from}) as abandons,
        (select count(*)::int from galaxy.runs where coop_run_id is not null and finished_at >= ${from} and 'coop_idle' = any(flags)) as idle`.execute(db),
  ]);
  const [listed, sold, trades, alerts, reports] = await Promise.all([
    db.selectFrom('galaxy.market_listings').select(sql<number>`count(*)::int`.as('n')).where('listed_at', '>=', from).executeTakeFirstOrThrow(),
    db
      .selectFrom('galaxy.market_listings')
      .select([sql<number>`count(*)::int`.as('n'), sql<string>`coalesce(sum(price), 0)`.as('coins'), sql<string>`coalesce(sum(commission), 0)`.as('commission')])
      .where('status', '=', 'sold')
      .where('sold_at', '>=', from)
      .executeTakeFirstOrThrow(),
    db.selectFrom('galaxy.trades').select(['status', sql<number>`count(*)::int`.as('n')]).where('closed_at', '>=', from).groupBy('status').execute(),
    db.selectFrom('galaxy.trade_alerts').select(sql<number>`count(*)::int`.as('n')).where('reviewed_at', 'is', null).executeTakeFirstOrThrow(),
    sql<{ n: number }>`
      select count(distinct r.message_id)::int as n from galaxy.chat_reports r
      left join galaxy.chat_report_reviews v on v.message_id = r.message_id
      where v.reviewed_at is null or r.created_at > v.reviewed_at`.execute(db),
  ]);

  return {
    period,
    from: from.toISOString(),
    to: now.toISOString(),
    players: { online: online.n, sockets: deps.hub.size(), newAccounts: newAccounts.n, activeAccounts: active.n },
    runs: {
      buckets: buckets.map((b) => ({ at: b.toISOString(), count: counts.get(b.toISOString().slice(0, 13)) ?? 0 })),
      outcomes: { extracted: outcome('extracted'), died: outcome('died'), abandoned: outcome('abandoned'), open: pending.open, unfinished: pending.unfinished },
    },
    currencies,
    pulls: { total: tiers.reduce((n, t) => n + t.count, 0), tiers },
    market: {
      listed: listed.n,
      sold: sold.n,
      coins: num(sold.coins),
      commission: num(sold.commission),
      tradesDone: trades.find((t) => t.status === 'done')?.n ?? 0,
      tradesCancelled: trades.find((t) => t.status === 'cancelled')?.n ?? 0,
    },
    groups: {
      runs: coopRuns.n,
      players: coopRows.rows[0]?.players ?? 0,
      extracted: coopRuns.extracted,
      died: coopRuns.died,
      interrupted: coopRuns.interrupted,
      avgDepth: Math.round(num(coopRuns.depth) * 10) / 10,
      abandons: coopRows.rows[0]?.abandons ?? 0,
      idle: coopRows.rows[0]?.idle ?? 0,
    },
    pending: { alerts: alerts.n, reports: reports.rows[0]?.n ?? 0 },
  };
}

const TIER_CSV = ['comun', 'poco_comun', 'rara', 'epica', 'legendaria', 'mitica'];

/** A CSV cell: as is, or quoted (doubling its quotes) when it has a comma, a quote or a line break. */
const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: (string | number)[][]) => `${rows.map((r) => r.map(cell).join(',')).join('\n')}\n`;

/** One section of the statistics as CSV, with a header row (the page's own figures). */
export function statsCsv(s: AdminStats, section: StatsSection): string {
  if (section === 'runs') return csv([[s.period === '24h' ? 'hora' : 'dia', 'partidas'], ...s.runs.buckets.map((b) => [b.at, b.count])]);
  if (section === 'currencies') return csv([['moneda', 'motivo', 'entra', 'sale'], ...s.currencies.flatMap((c) => c.byReason.map((r) => [c.currency, r.reason, r.in, r.out]))]);
  if (section === 'pulls') return csv([['rareza', 'tiradas', 'esperado'], ...s.pulls.tiers.map((t) => [TIER_CSV[t.tier] ?? t.tier, t.count, t.expected])]);
  if (section === 'groups')
    return csv([
      ['cifra', 'valor'],
      ['partidas', s.groups.runs],
      ['jugadores', s.groups.players],
      ['extracciones', s.groups.extracted],
      ['derrotas', s.groups.died],
      ['interrumpidas', s.groups.interrupted],
      ['capa_media', s.groups.avgDepth],
      ['abandonos', s.groups.abandons],
      ['inactivos', s.groups.idle],
    ]);
  return csv([
    ['cifra', 'valor'],
    ['anuncios', s.market.listed],
    ['ventas', s.market.sold],
    ['monedas', s.market.coins],
    ['comision', s.market.commission],
    ['trueques_cerrados', s.market.tradesDone],
    ['trueques_cancelados', s.market.tradesCancelled],
  ]);
}
