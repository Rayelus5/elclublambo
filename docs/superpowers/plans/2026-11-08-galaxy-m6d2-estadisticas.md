# Galaxy Survivor M6d-2 · Estadísticas en vivo y exportación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the panel's «Estadísticas» (GDD §16.6), for admins. It covers the last 24 hours, 7 days or 30 days, read again every 30 s. Each section exports to CSV.
- players connected now, new and active;
- runs by hour or by day, and how they ended;
- each currency's flows in and out, by reason;
- pulls and their rarities, real against expected;
- market volume (listings, sales, coins moved, commission) and trades;
- pending alerts and reports.

**Architecture:**
- **Server:**
  - `admin/stats.ts` aggregates in SQL over the existing tables (sessions, runs, ledger, gacha_pulls, market_listings, trades, trade_alerts, chat_reports);
  - `GET /galaxy/api/admin/stats?period=` answers `AdminStats`;
  - `GET /galaxy/api/admin/stats.csv?period=&section=` answers one section as CSV;
  - the live socket count comes from the chat hub.
- **No migration.**
- **Web:** `/admin/estadisticas`:
  - the figures on top;
  - runs as a bar chart in inline SVG;
  - flows and rarities as tables with their own bars, the real share next to the expected one;
  - market and trade figures;
  - «Exportar CSV» on each section.
  - «Estadísticas» leaves «Próximamente».

**Tech Stack:** Fastify 5, Kysely 0.29, Zod 4, React 19, TanStack Query 5, Vitest, Playwright.

**Spec:** `games/galaxy/docs/GDD.md`:
- §16.6, «Estadísticas en vivo»: players connected, runs per hour, each currency's flows in and out, pulls and rarities real against expected, market volume, alerts;
- §16.6, «Herramientas»: CSV export;
- §16.1: admins only.

## Global Constraints

- **Admin only** (TOTP); moderators and players get 403.
- **Reading only:** nothing writes, so nothing is audited.
- **Periods:** `24h`, buckets by hour (24); `7d` and `30d`, buckets by UTC day.
- **«Connected»:** distinct accounts whose session was seen in the last 5 minutes (sessions touch `last_seen_at` every 5 min), plus the live chat sockets.
- **Expected rarities** come from the live gacha config's base rates (`expectedTierRates`). A pull's tier is compared over all banners together. Ruling: the beta has one banner.
- **CSV:** UTF-8, comma-separated, with a header row. The file name is `estadisticas-<section>-<period>-<date>.csv`.
- **Copy:** Spanish, direct titles, no special symbols, no final period.
  - Consult ui-ux-pro-max and the dataviz skill before the charts.
  - Colour is never the only carrier: every bar has its number.
  - DESIGN_SYSTEM §8 unvicies.

## Review Focus

1. **A period with no activity** shows zeros and empty buckets, never an error or a missing hour or day.
2. **Rarities of zero pulls** show the expected shares and no real ones (no division by zero).
3. **Large numbers** (millions of coins) stay readable (es-ES grouping) in the tiles, tables and CSV.
4. **A moderator** gets 403 on both endpoints; a bad `period` or `section` gets 400.
5. **CSV** has the same figures the page shows for that period, and quotes text with commas or quotes.

---

### Task 1: Shared and server
- **Shared** `api/stats.ts`:
  - `STATS_PERIODS`, `STATS_SECTIONS` (`runs`, `currencies`, `pulls`, `market`);
  - `adminStatsQuerySchema`, `adminStatsCsvQuerySchema`;
  - the type `AdminStats` = `{ period, from, to, players {online, sockets, newAccounts, activeAccounts}, runs {buckets: {at, count}[], outcomes: {extracted, died, abandoned, open}}, currencies {currency, in, out, byReason {reason, in, out}[]}[], pulls {total, tiers {tier, count, expected}[]}, market {listed, sold, coins, commission, tradesDone, tradesCancelled}, pending {alerts, reports} }`.
- **Server:**
  - `admin/stats.ts`: `adminStats(deps, period)` and `statsCsv(stats, section)`;
  - the routes in `admin/stats-routes.ts`; the hub gains `size()`.
- **Integration tests** in `admin-stats.test.ts`. They measure deltas (before, act, after) because the local database is shared:
  - a session seen now counts as online;
  - a finished run lands in the current bucket;
  - a credit and a debit show in and out under their reason;
  - a real pull counts under its tier;
  - a sale counts in volume and commission;
  - empty buckets are filled;
  - zero pulls give no division;
  - moderator 403; bad query 400;
  - the CSV header and rows match `AdminStats`, quoting what needs it.

### Task 2: Web
- **`/admin/estadisticas`:**
  - period pills; a status line «Actualizado a las HH:MM» refreshed every 30 s;
  - tiles for connected, new, runs, pulls, sold coins, and pending alerts and reports;
  - runs as an SVG bar chart (accessible name and a hidden table);
  - currencies in a table of in, out and net per currency, expandable by reason;
  - rarities in a table of real against expected, with a two-bar mark;
  - market figures;
  - «Exportar CSV» links per section.
- **Web tests:** loading, the period changing the query, the charts and tables showing the numbers, CSV links, and the moderator redirect.

### Task 3: e2e, docs, verification, review, PR, PRE
- **e2e:** a new admin opens Estadísticas, switches to 7 days, sees the tiles and downloads the runs CSV; no CSP violations.
- **Docs:** DEPLOY_PRE step 24; DESIGN_SYSTEM §8 unvicies.
