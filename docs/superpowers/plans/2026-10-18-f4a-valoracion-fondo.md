# F4a — Valoración a mercado del fondo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The DAO is valued at market (USDC + ETH + WETH in the Safe × price, minus liabilities). Shares are issued against that NAV, with a non-withdrawable "Fondo del club" position. The forum records hourly NAV snapshots and the Safe's operations (with treasurer notes and alerts for unexplained outflows), shows it all on `/dao`, and requires a legal acknowledgement before donating.

**Architecture:** The chain is read only on the server (viem):
- Safe balances: `balanceOf` for USDC/WETH, `getBalance` for ETH.
- ETH/USD price: Chainlink `latestRoundData`, with a CoinGecko fallback.
- Safe operations: ERC-20 `Transfer` logs.

SQL owns all accounting through service-role RPCs:
- the server passes the Safe's assets in USD, already valued;
- SQL subtracts the liabilities it knows;
- SQL issues shares, stores snapshots and operations, and notifies.

The existing cron (`/api/cron/dao`) drives snapshots, the operation scan and settlement.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (SECURITY DEFINER RPCs with `search_path=''`, pgTAP), viem, Vitest + RTL, Playwright on the local Hardhat chain.

**Spec:** `docs/superpowers/specs/2026-10-18-f4-gobernanza-design.md` (decisions 1, 2, 3, 5, 8 and 9; my decisions 1–5 and 16; behaviour "Donar").

## Global Constraints
- **Money units:**
  - USDC and USD are integers with 6 decimals (`*_usd6`, `numeric(78,0)`);
  - ETH and WETH are in wei;
  - ETH/USD prices have 8 decimals (`price_e8`);
  - never floats for money: `bigint` in TS, `numeric` in SQL.
- **Valuation:** `assets_usd6 = usdc + (eth_wei + weth_wei) · price_e8 / 10^20` (floor).
- **Share issuance (spec, my decision 3):**
  - `shares = S == 0 ? d·10¹² : floor(d · S / NAV_previo)`;
  - `NAV_previo = assets_usd6 − liabilities_usd6`, where the liabilities include **every** `pending_finality` donation (this one included, since the money is already in the Safe);
  - if `S == 0` and `NAV_previo > 0`, first mint `club_shares = NAV_previo · 10¹²`;
  - if the result is 0 shares, the donation is **not** credited (`shares_zero`, left for review).
- **Fondo del club:**
  - it is `dao_state.club_shares` and counts in `total_shares`;
  - it cannot be withdrawn, does not vote, does not enter raffles and opens no channel gates;
  - in the ranking/donut it is labelled exactly `Fondo del club`.
- **First valuation of a chain with an existing ledger (`nav_initialized = false`, `S > 0`):** if `NAV > value_usdc` (the F3 ledger value), mint club shares for the excess at the ledger share price: `floor((NAV − value_usdc) · S / value_usdc)`.
- **Price:**
  - Chainlink, accepted only if `updatedAt` is within the feed's heartbeat plus 10 % and `answer > 0`;
  - otherwise CoinGecko (`ethereum` in usd), accepted only if within ±20 % of the last snapshot's price (or there is no previous snapshot);
  - otherwise **no price**: credits and snapshots wait (transient), and nothing is made up;
  - USDC = 1 USD.
- **Verified addresses:** Chainlink feed and WETH addresses only from official docs (data.chain.link / docs.chain.link; the Linea docs for WETH), cited in a code comment with the date; never from memory.
  - If Linea Sepolia has no feed, `null` (CoinGecko fallback).
  - Env overrides for tests: `ETH_USD_FEED_ADDRESS_<chainId>`, `WETH_ADDRESS_<chainId>`, `COINGECKO_DISABLED=1`.
- **Snapshots:** at most one per chain every 55 minutes; a failed read skips the snapshot.
- **Operations scan:**
  - `Transfer` logs of USDC and WETH from or to the Safe, in chunks of at most 2000 blocks, up to `latest − TIP_CONFIRMATIONS`;
  - the first scan of a chain starts at the current block (no backfill);
  - a native-ETH change between two consecutive snapshots with no matching log becomes an `ETH` operation with no hash.
- **What counts as unexplained:** an outflow (USDC/WETH/ETH `out`) with no note.
  - Each one notifies the members with `MANAGE_TREASURY` (bit 256) exactly once (notification kind `treasury_outflow`).
  - Inflows that match a donation (`dao_ledger.tx_hash`) are linked and never listed publicly.
- **Privacy:** the public operations feed never shows the counterparty of an inflow and never lists donation inflows. Notes are at most 280 characters, written only by `MANAGE_TREASURY`.
- **Legal acknowledgement copy (exact):**
  - checkbox label: `Entiendo que es una donación sin esperar nada a cambio, que el fondo se invierte con riesgo y que las retiradas dependen de la disponibilidad y de la decisión del tesorero.`
  - "Continuar" stays disabled until it is ticked.
- **Generic project guards** (existing tests enforce them):
  - RLS on every new table, with no client policies;
  - every new function `security definer` with `search_path=''`;
  - `revoke execute ... from public, anon`;
  - service-only functions also revoked from `authenticated`.
- **UI:** Spanish copy, the existing design tokens, ≥44px targets, no new dependencies (charts stay hand-rolled SVG like `dao-charts.tsx`).

## Review Focus
1. **The RPC or the price is down while a donation reaches finality.** Expected: the donation stays pending (no shares at a wrong price), and the next run credits it. Test in Task 4.
2. **The Safe already holds money and nobody has shares** (the user's mainnet Safe holds 1 USDC). Expected: the club fund owns it, and the first donor gets exactly their share. Test in Task 1.
3. **Two donations finalized in the same run.** Expected: each is credited with the other still counted as a liability (until it is credited), so the order does not change who gets what beyond rounding. Test in Task 1.
4. **A swap USDC→WETH from the Safe.** Expected: the USDC outflow is flagged "sin explicar" and the treasurers are notified once; after a note it is explained and no longer alerts. Test in Task 2 and Task 7.
5. **A CoinGecko price far from the last snapshot** (bad data). Expected: rejected; no snapshot and no credit. Test in Task 3.

---

### Task 1: SQL — NAV-based share issuance, club fund and snapshots

**Files:**
- Create: `supabase/migrations/20261019100001_fund_nav.sql`
- Test: `supabase/tests/910_fund_nav.test.sql`

**Interfaces:**
- Produces (service role only):
  - `credit_donation(p_ledger uuid, p_assets_usd6 numeric) returns jsonb` → `{"shares": "<numeric text>", "clubMinted": "<numeric text>"}`. It replaces the one-argument version, which is dropped.
  - `record_nav_snapshot(p_chain int, p_snapshot jsonb) returns jsonb`.
    - Input keys: `usdcUnits`, `ethWei`, `wethWei`, `ethPriceE8` (all text integers), `priceSource` (`chainlink` | `coingecko`), `blockNumber` (text), `assetsUsd6` (text).
    - Returns `{"id", "navUsd6", "clubMinted", "skipped": bool}`; `skipped` is true when the last snapshot is younger than 55 minutes.
  - `_dao_liabilities_usd6(p_chain int) returns numeric`: the sum of `pending_finality` donation amounts. F4c/F4d extend it.
- Produces (members):
  - `dao_overview()` gains the keys `navUsd6`, `navAt`, `sharePriceUsd6` (`navUsd6 · 10¹² / totalShares`, floor; `0` when `S = 0`), `myValueUsd6` (`myShares · navUsd6 / totalShares`, floor), `clubShares`, and `composition` from the latest snapshot: `{usdcUnits, ethWei, wethWei, ethPriceE8, priceSource, takenAt}`, or `null`.
  - `dao_nav_history(p_range text) returns table (taken_at timestamptz, nav_usd6 text, share_price_usd6 text)`.
    - `p_range` is in `('24h','7d','30d','all')`; anything else raises `invalid_input`.
    - Oldest first, at most 500 points (evenly thinned).
  - `dao_ranking()` adds a row with `member_id null` and `label 'Fondo del club'` when `club_shares > 0`.
    - It sorts by shares like the others; ranks are recomputed over all rows.
    - `net_usdc` is `0` for that row.
- Schema:
  - `dao_state` gains `club_shares numeric(78,0) not null default 0`, `nav_initialized boolean not null default false` and `nav_at timestamptz`.
  - `value_usdc` keeps its name and now caches the last NAV in usd6.
  - New table `dao_nav_snapshots (id uuid pk, chain_id int, taken_at timestamptz default now(), usdc_units, eth_wei, weth_wei, eth_price_e8, assets_usd6, liabilities_usd6, nav_usd6, total_shares numeric(78,0), price_source text check in ('chainlink','coingecko'), block_number bigint)`, indexed on `(chain_id, taken_at desc)`.

- [ ] **Step 1: Write the failing pgTAP test** `supabase/tests/910_fund_nav.test.sql`. Assertions, in order:
  1. `credit_donation(uuid,numeric)` exists and `credit_donation(uuid)` does not. Neither `authenticated` nor `anon` can execute the new functions `credit_donation`, `record_nav_snapshot` or `_dao_liabilities_usd6`.
  2. **Empty fund:** chain 59141, `S=0`, no other pending; donation `d=10_000000` with `p_assets_usd6 = 10_000000`. Expected: `shares = 10_000000·10¹²`, `clubMinted = 0`, `dao_state.value_usdc = 10_000000`.
  3. **Club fund on an empty chain:** fresh chain 59144, `S=0`, Safe already worth `1_000000` (`p_assets_usd6 = 1_000000 + d`) and `d = 4_000000`. Expected: `clubMinted = 1_000000·10¹²` and donor shares `= 4_000000·10¹²`. The donor's share bps is 8000 and the club holds 2000 bps of `total_shares`.
  4. **Issuance at NAV:** `S = 10·10¹⁸`, NAV previous = `20_000000` (`p_assets_usd6 = 20_000000 + d`), `d = 10_000000`. Expected: `shares = floor(10_000000 · S / 20_000000) = 5·10¹⁸`.
  5. **Two pending donations:** both are subtracted as liabilities. Crediting the first with `assets = NAV_prev + d1 + d2` uses `NAV_prev`; afterwards `_dao_liabilities_usd6` returns `d2`.
  6. **Zero shares:** `d` tiny relative to an inflated NAV (`S = 1`, NAV `1_000000·10⁶`). `credit_donation` raises `shares_zero`, and the ledger row stays `pending_finality`.
  7. **Negative NAV:** `p_assets_usd6` lower than the liabilities gives `NAV_previo` clamped at 0 → with `S > 0` raises `invalid_state` (nothing written).
  8. **Snapshot:** `record_nav_snapshot` stores the row with `liabilities_usd6 = _dao_liabilities_usd6` and `nav_usd6 = assets − liabilities`, and updates `dao_state.value_usdc` and `nav_at`. A second call within 55 minutes returns `skipped = true` and inserts nothing.
  9. **First valuation with an F3 ledger:** `S = 10·10¹⁸`, `value_usdc = 10_000000`, `nav_initialized = false`, snapshot NAV `12_000000` → `club_shares = floor(2_000000 · S / 10_000000) = 2·10¹⁸` and `nav_initialized = true`. A second snapshot with a higher NAV mints nothing.
  10. **`dao_overview()` as a member:** `sharePriceUsd6`, `myValueUsd6` and `composition.priceSource` are as expected. `dao_ranking()` includes `Fondo del club` with `member_id` null.
  11. **`dao_nav_history`:** `dao_nav_history('7d')` returns the inserted snapshots oldest first, and `dao_nav_history('1y')` raises `invalid_input`.
- [ ] **Step 2: Run, verify it fails:** `pnpm exec supabase test db supabase/tests/000_helpers.test.sql supabase/tests/910_fund_nav.test.sql`. Expected: FAIL (functions missing).
- [ ] **Step 3: Write the migration.**
  - Drop `credit_donation(uuid)` and recreate it as `credit_donation(uuid, numeric)` with the Global Constraints formulas.
    - Keep `for update` on the ledger row and on `dao_state`.
    - Keep the idempotency: an already credited row returns its stored shares.
  - Update every grant line that named the old signature. `settle.ts` is updated in Task 4; until then the TypeScript does not compile against SQL, which is acceptable inside this plan because the tasks run in order.
  - Rewrite `dao_overview` and `dao_ranking` with `create or replace`, keeping every existing key. Add `dao_nav_history` and the snapshot table with RLS on.
- [ ] **Step 4: Run the test (PASS),** then `pnpm db:test`, where every existing treasury test must still pass. Update `800_treasury` / `840` assertions that call `credit_donation(uuid)` to the new signature, passing `assets = value_usdc + pending`, so that they keep their meaning.
- [ ] **Step 5: Commit** `feat(dao): market-value NAV share issuance, club fund and hourly snapshots (SQL)`.

### Task 2: SQL — Safe operations, treasurer notes and outflow alerts

**Files:**
- Create: `supabase/migrations/20261019100002_fund_operations.sql`
- Test: `supabase/tests/920_fund_operations.test.sql`

**Interfaces:**
- Produces (service role):
  - `record_safe_operations(p_chain int, p_ops jsonb, p_to_block bigint) returns jsonb` → `{"inserted": int, "alerts": int}`.
    - Each op is `{txHash|null, logIndex|null, asset: 'USDC'|'WETH'|'ETH', direction: 'in'|'out', amount (text), counterparty|null, blockNumber (text), occurredAt (iso)}`.
    - Idempotent on `(chain_id, tx_hash, log_index, asset)` for ops with a hash.
    - An ETH op (no hash) is keyed by `(chain_id, block_number, asset)`.
    - A USDC inflow whose `tx_hash` equals a `dao_ledger.tx_hash` of that chain gets `ledger_id`.
    - Advances `dao_scan_state.last_block = p_to_block`.
    - Every new **out** op inserts one notification of kind `treasury_outflow` per active member holding `MANAGE_TREASURY`, with data `{opId, asset, amount}`, and sets `alerted_at`.
  - `dao_scan_from(p_chain int) returns bigint`: the last scanned block, or null.
- Produces (members):
  - `set_operation_note(p_op uuid, p_note text) returns void`.
    - Requires active membership and global `MANAGE_TREASURY` (bit 256), else `forbidden`.
    - The note is trimmed to 1–280 characters, else `invalid_input`.
    - Sets `note`, `noted_by` and `noted_at`, plus an `audit_log` row `operation_noted`.
  - `dao_operations(p_limit int default 30) returns table (id uuid, asset text, direction text, amount text, tx_hash text, occurred_at timestamptz, note text, explained boolean)`.
    - Active chain, newest first, `limit` clamped 1..100.
    - Excludes ops with `ledger_id` (donations).
    - `explained = direction = 'in' or note is not null`.
    - Never returns the counterparty.
- Schema:
  - `dao_safe_operations (id uuid pk, chain_id, tx_hash text null check ^0x[0-9a-f]{64}$, log_index int null, asset, direction, amount numeric(78,0) > 0, counterparty text null, block_number bigint, occurred_at timestamptz, ledger_id uuid null references dao_ledger, note text, noted_by uuid references members, noted_at, alerted_at, created_at)`;
  - `dao_scan_state (chain_id pk, last_block bigint)`;
  - RLS on both with no client access.
- Notifications:
  - Add `treasury_outflow` to the `notifications_kind_check`.
  - `_push_build`: title `Salida de la tesorería`, body `<amount> <asset> salió de la Safe sin explicar` (formatted with `_format_token_amount` where it applies; ETH and WETH have 18 decimals), url `/dao/tesoreria`. Re-create it with `create or replace`, copying the latest definition (from `20261019000009_push_message_deeplink.sql`) and adding one branch.

- [ ] **Step 1: Write the failing pgTAP test** `920_fund_operations.test.sql`:
  1. **Insert:** three ops (USDC out, WETH in, USDC in matching a seeded `dao_ledger` tx hash) give `inserted = 3` and `alerts` = (number of treasurers × 1). Re-sending the same batch gives `inserted = 0` and `alerts = 0`.
  2. **Donation match:** the USDC inflow got `ledger_id`, and `dao_operations()` (as a member) does not list it.
  3. **Public feed:** `dao_operations()` returns the USDC out with `explained = false` and the WETH in with `explained = true`, with no counterparty column.
  4. **Notes by role:** a plain member calling `set_operation_note` gets `forbidden`. A member with a role carrying 256 succeeds; afterwards `explained = true`, and an `audit_log` row `operation_noted` exists.
  5. **Note length:** `''` and a 281-character note raise `invalid_input`.
  6. **Scan state:** `dao_scan_state.last_block` is advanced, and `dao_scan_from(59141)` returns it.
  7. **ETH op:** an op with no hash keyed by block is idempotent.
  8. **Push builder:** `_push_build` for a `treasury_outflow` notification returns the title `Salida de la tesorería` and the url `/dao/tesoreria`.
- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Write the migration** (kind check, tables, RPCs, `_push_build` branch, grants).
- [ ] **Step 4: Run the test (PASS)** and `pnpm db:test` (the push and notifications tests must stay green).
- [ ] **Step 5: Commit** `feat(dao): Safe operations log, treasurer notes and unexplained-outflow alerts (SQL)`.

### Task 3: TS — on-chain valuation (balances + price with fallback)

**Files:**
- Modify: `src/lib/economy/networks.ts`: add `weth: \`0x${string}\` | null`, `ethUsdFeed: \`0x${string}\` | null` and `ethUsdHeartbeatSec: number` to `Network`, with verified values and a comment citing source and date.
- Create: `src/lib/treasury/valuation.ts`
- Test: `tests/unit/treasury/valuation.test.ts`

**Interfaces:**
- Produces:
  - `addressesFor(chain: ChainId): { usdc; weth: Address | null; ethUsdFeed: Address | null; heartbeatSec: number }`. It applies the env overrides `WETH_ADDRESS_<id>` and `ETH_USD_FEED_ADDRESS_<id>`.
  - `readSafeAssets(chain: ChainId, safe: Address): Promise<{ usdc: bigint; eth: bigint; weth: bigint; blockNumber: bigint }>`.
    - All reads are pinned to one block number.
    - `weth = 0n` when the chain has none.
  - `readEthPrice(chain: ChainId, opts: { lastPriceE8: bigint | null; nowSec?: number }): Promise<{ priceE8: bigint; source: "chainlink" | "coingecko" } | null>`.
  - `assetsUsd6(a: { usdc: bigint; eth: bigint; weth: bigint }, priceE8: bigint): bigint`.

- [ ] **Step 1: Write failing tests** (viem client mocked via `vi.mock("@/lib/payments/chain-client")`, `fetch` stubbed):
  - `assetsUsd6({usdc: 5_000000n, eth: 10n**18n, weth: 5n*10n**17n}, 2500_00000000n) === 5_000000n + 3750_000000n`.
  - **Chainlink fresh** (`updatedAt = now − 1800`, heartbeat 3600, `answer = 2400e8`) → `{priceE8: 2400_00000000n, source: "chainlink"}`, with no fetch call.
  - **Chainlink stale** (`now − 4000 > 3600·1.1`) → CoinGecko `2410.5` → `241050000000n`, `source: "coingecko"`.
  - **CoinGecko 30 % away from `lastPriceE8`** → `null`.
  - **No feed configured, `COINGECKO_DISABLED=1`** → `null`.
  - **`answer <= 0`** → treated as stale.
  - `addressesFor(59141)` honours both env overrides.
  - `readSafeAssets` calls `getBlockNumber` once and reads every balance at that block.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/treasury/valuation.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Chainlink ABI: `latestRoundData()` and `decimals()`; if the decimals are not 8, rescale. CoinGecko: `https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd` with a 5 s timeout, parsed to `price_e8` without floats. Parse the decimal string: split on `.` and pad or cut to 8 digits.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(dao): on-chain fund valuation — Safe balances, Chainlink price with CoinGecko fallback`.

### Task 4: Server — settlement at NAV, snapshots and operations scan in the cron

**Files:**
- Modify: `src/lib/treasury/settle.ts` (`settleRow` calls `credit_donation(p_ledger, p_assets_usd6)`)
- Create: `src/lib/treasury/snapshot.ts`, `src/lib/treasury/scan.ts`
- Modify: `src/app/api/cron/dao/route.ts`
- Replace: `src/lib/treasury/reconcile.ts`. The old balance-vs-ledger check is removed; its exported function names stay only if other code imports them. Otherwise delete the file and its test, and drop `ReconcilePanel` from `/dao` (Task 5 adds the alerts list).
- Test: `tests/unit/treasury/settle.test.ts` (update), `tests/unit/treasury/snapshot.test.ts`, `tests/unit/treasury/scan.test.ts`, `tests/unit/treasury/cron-route.test.ts` (update)

**Interfaces:**
- Consumes: Task 1 and Task 2 RPCs, Task 3 valuation.
- Produces:
  - `valueSafe(chain: ChainId): Promise<{ assetsUsd6: bigint; priceE8: bigint; source; assets } | null>`, in `snapshot.ts`. It returns null when the Safe is unset or the price is unavailable.
  - `takeSnapshot(chain: ChainId): Promise<"taken" | "skipped" | "unavailable">`.
  - `scanSafeOperations(chain: ChainId): Promise<{ inserted: number; alerts: number } | null>`, in `scan.ts`.
  - The cron JSON gains, per chain, `snapshot` and `scan`. `settlePendingDonations` keeps its signature.

- [ ] **Step 1: Failing tests:**
  - **settle:** a finalized pending row credits via `credit_donation` with `p_assets_usd6` equal to the `valueSafe` result. When `valueSafe` returns null, the row stays pending (`outcome pending`) and `credit_donation` is not called. A `shares_zero` RPC error leaves it pending and logs `[treasury] shares_zero`.
  - **snapshot:** `takeSnapshot` passes `lastPriceE8` from the latest snapshot row to `readEthPrice`, maps the result to the `record_nav_snapshot` JSON (all integers as strings), and returns `"skipped"` when the RPC says `skipped`.
  - **scan:**
    - reads `dao_scan_from`; on null it starts at `latest − confirmations`, inserts nothing and records the block;
    - otherwise it fetches `Transfer` logs with `from = safe` or `to = safe` for USDC and WETH in 2000-block chunks;
    - it maps the direction, the counterparty, `amount` from `value`, and `occurredAt` from the block timestamp;
    - it adds an `ETH` op when `eth` changed between the last two snapshots by more than the sum of the logged WETH unwraps (just the native delta; direction by sign);
    - it calls `record_safe_operations` once per run.
  - **cron:** the order per chain is snapshot → scan → settle; a failure in one step does not stop the others; the response includes all three.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** with the service-role admin client, like `settle.ts`.
- [ ] **Step 4: Run → PASS;** `pnpm typecheck` clean (it must now compile against the Task 1 signature).
- [ ] **Step 5: Commit** `feat(dao): settle donations at market NAV; hourly snapshots and Safe operation scan in the cron`.

### Task 5: UI — `/dao` as a fund dashboard

**Files:**
- Modify: `src/lib/treasury/queries.ts`:
  - extend `DaoOverview` with `navUsd6`, `navAt`, `sharePriceUsd6`, `myValueUsd6`, `clubShares` and `composition`;
  - add `getNavHistory(supabase, range)` and `getOperations(supabase, limit)`;
  - `RankingEntry` accepts `memberId null` for the club.
- Create:
  - `src/components/treasury/fund-composition.tsx`: USDC/ETH/WETH amounts with their USD value, ETH price with the source label (`Chainlink` / `CoinGecko`) and the snapshot time.
  - `src/components/treasury/nav-chart.tsx`: client; range tabs `24 h · 7 días · 30 días · Todo` and a series toggle `Valor del fondo` / `Valor por participación`. It reuses the step-area SVG approach of `BalanceChart`, fetching `dao_nav_history` through the browser client.
  - `src/components/treasury/operations-list.tsx`: asset, ↑/↓, amount, note or `Sin explicar` (warning colour plus text), explorer link. Treasurers get an inline `Añadir nota` editor calling `set_operation_note` and refresh.
- Modify:
  - `src/components/treasury/dao-overview.tsx`: the balance becomes `Valor del fondo` (NAV); add `Tu parte` in USD (`myValueUsd6`) and `Valor por participación`.
  - `src/app/(forum)/dao/page.tsx`:
    - add the composition, the NavChart (replaces BalanceChart), and operations in a new section `Operaciones`;
    - remove `ReconcilePanel`;
    - link `Ver la Safe en el explorador` (`explorerAddress`).
  - `src/components/treasury/dao-charts.tsx` / `src/lib/treasury/charts.ts`: `donutSlices` keeps `Fondo del club` as a labelled slice with colour `var(--chart-rest)`. `Resto` becomes `var(--fg-muted)` if they collide; add a token if needed and keep the tokens test passing.
  - `src/components/notifications/notification-item.tsx`: `treasury_outflow` reads `Salida de la tesorería sin explicar: <amount> <asset>`, href `/dao/tesoreria`. The page is created in F4c; until then the href falls back to `/dao#operaciones`, and the guard must not 404.
- Test: `tests/unit/treasury/fund-composition.test.tsx`, `nav-chart.test.tsx`, `operations-list.test.tsx`, plus updates to `dao-overview.test.tsx` and `charts.test.ts`.

- [ ] **Step 1: Failing tests:**
  - **Composition:** `{usdcUnits: "5000000", ethWei: "1000000000000000000", wethWei: "0", ethPriceE8: "250000000000", priceSource: "chainlink"}` renders `5 USDC`, `1 ETH`, `2.500 USD` for ETH and `Precio ETH: 2.500 USD · Chainlink`.
  - **NavChart:** it calls `dao_nav_history` with `{p_range: "7d"}` by default, switches to `30d` when the tab is clicked, and switching the series shows `Valor por participación` in the aria summary. Empty data shows `El gráfico aparecerá con la primera valoración.`
  - **OperationsList:** a member sees `Sin explicar` and no editor. A treasurer (`canNote`) sees `Añadir nota`; saving calls `set_operation_note` with the trimmed text and shows it; an empty note keeps Save disabled.
  - **DaoOverview** shows `Tu parte: 120 USDC` from `myValueUsd6 = "120000000"`.
  - **The donut** includes `Fondo del club`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run → PASS;** `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** `feat(dao): fund dashboard — composition, NAV and share-value charts, operations with notes`.

### Task 6: Donation acknowledgement, estimate and guide

**Files:**
- Modify: `src/components/payments/tip-dialog.tsx` (donation mode only)
- Modify: `src/lib/guide/sections.ts` (+ its content component) and add the `fondo` section
- Test: `tests/unit/payments/tip-dialog-donation.test.tsx` (extend), `tests/unit/guide/*` (extend)

**Interfaces:**
- Consumes: `dao_overview()` (`sharePriceUsd6`) through the browser client, only when the dialog opens in donation mode.

- [ ] **Step 1: Failing tests:**
  - In donation mode, `Continuar` is disabled until the checkbox with the exact label from the Global Constraints is ticked, even with a valid amount.
  - Ticking it enables `Continuar`.
  - Tips and bounties show no such checkbox.
  - With `sharePriceUsd6 = "2000000"` and an amount of `10`, the dialog shows `≈ 5 participaciones al valor actual (el número exacto se fija al acreditar)`.
  - When `dao_overview` fails, the estimate line is simply absent.
  - The guide lists a section titled `El fondo común`; its page explains NAV, the club fund, the risk notice and that withdrawals and raffles arrive later (F4c/F4d), with the exact risk wording of the checkbox.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** The estimate uses bigint math: `amount_usd6 · 10¹² / sharePriceUsd6`, displayed with `formatShares`-like grouping divided by 10¹².
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(dao): mandatory donation acknowledgement, share estimate and the fund guide`.

### Task 7: E2E on the local chain

**Files:**
- Create: `e2e/chain/MockAggregator.sol` + `mock-aggregator.json` (ABI + runtime bytecode, like `mock-usdc.json`), `e2e/chain/MockWETH.sol` + `mock-weth.json`
- Modify:
  - `e2e/chain/shared.mjs`: `ETH_USD_FEED_ADDRESS`, `WETH_ADDRESS`, fixed test addresses;
  - `e2e/chain/start-chain.mjs`: setCode both, set the price to `2500e8`;
  - `playwright.config.ts`: env `ETH_USD_FEED_ADDRESS_59141`, `WETH_ADDRESS_59141`, `COINGECKO_DISABLED=1`.
- Create: `e2e/f4a-fund.spec.ts`
- Modify: `e2e/f3d-treasury.spec.ts` only where NAV changes expected values (the balance becomes the NAV, which equals the USDC on a USDC-only Safe, so most assertions stay).

- [ ] **Step 1: Write the spec** (serial; same helpers as f3d):
  1. **Setup:** the admin sets the Safe (a fresh unfunded address) and the platform wallet.
  2. **Club fund on first donation:** before any donation, the test sends `2 USDC` straight to the Safe. A donates `10 USDC` after ticking the acknowledgement. Then:
     - the cron runs;
     - `/dao` shows `Valor del fondo 12 USDC`;
     - the ranking has `Fondo del club` at about 16,66 % and A at about 83,33 %.
  3. **Investment:** using an impersonated Safe (`hardhat_impersonateAccount`), the Safe sends `5 USDC` to an address and receives `0.002 WETH`. Then:
     - the price is set to `3000e8`;
     - the cron runs;
     - `/dao` shows the composition `7 USDC` and `0,002 WETH`, the value `13 USDC`, and the chart has at least one point;
     - the operations list shows a USDC outflow `Sin explicar`, and the admin's bell has a `treasury_outflow` notification.
  4. **Note:** the admin adds the note `Compra de WETH`; the operation shows the note and `Sin explicar` disappears.
  5. **Second donor at NAV:** B donates `13 USDC`; after the cron, B's shares equal the shares of the whole fund before B (B ≈ 50 % of the non-club holders' value). Assert B's `Tu parte` ≈ `13 USDC` within 1 cent.
  6. **No browser errors.**
- [ ] **Step 2: Run** `pnpm test:e2e e2e/f4a-fund.spec.ts` (port 3000 free) → iterate until green; then the full suite with `E2E_PROD=1` and dev.
- [ ] **Step 3: Commit** `test(e2e): f4a fund valuation on the local chain (mock Chainlink feed + WETH)`.
