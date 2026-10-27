# Codebase audit: Linea coupling of ElClub. and the effort to go multichain (Arbitrum One, Base, Linea)

Scope: read-only audit of `C:\Users\rayel\Desktop\Proyectos\elclublambo` on branch `develop` (HEAD cd7687e). Sources are repo files cited as `path:line` (paths relative to the repo root). `.claude/worktrees/f2-foro/` is an old worktree copy and was ignored.

Target networks: Arbitrum One 42161 / Arbitrum Sepolia 421614, Base 8453 / Base Sepolia 84532, Linea 59144 / Linea Sepolia 59141.

## Q1. Where are the chain-specific values defined in the app layer?

### Takeaway
The app is already built around a closed two-network set (`59144 | 59141`) with one central registry (`src/lib/economy/networks.ts`), but several modules bypass it with hard-coded `linea`/`lineaSepolia` viem chain objects, `LINEA_*` env vars, `lineascan.build` and `dexscreener.com/linea` URLs. There are two independent "which chain" selectors: a build-time env var for login (`NEXT_PUBLIC_CHAIN`) and a runtime DB switch for money (`app_config.active_chain_id`).

### Cited Findings
**Central registry**
- `type ChainId = 59144 | 59141` (closed union used across the app) — `src/lib/economy/networks.ts:1`
- `NETWORKS` record per chain holds name, USDC, WETH, Chainlink ETH/USD proxy, heartbeat (86400 s), explorer (`https://lineascan.build`, `https://sepolia.lineascan.build`) and testnet flag — `src/lib/economy/networks.ts:3-50`
  - Linea USDC `0x1762…E1ff`, WETH `0xe5D7…f34f`, feed `0x3c6C…54dA` — `src/lib/economy/networks.ts:33-35`
  - Linea Sepolia USDC `0xFEce…d9B7`, WETH `0x0656…55a3`, feed `0x0B55…24bc` — `src/lib/economy/networks.ts:43-45`
  - Provenance comment (Circle docs, Chainlink directory, Consensys token list, fetched 2026-10-18) — `src/lib/economy/networks.ts:17-28`
- `CHAIN_IDS = [59144, 59141]` and `isChainId(n)` that literally tests `n === 59144 || n === 59141` — `src/lib/economy/networks.ts:52-56`
- Explorer helpers `explorerTx/Block/Address` built from `NETWORKS[chain].explorer` — `src/lib/economy/networks.ts:58-68`
- Fee helpers (`MAX_FEE_BPS = 5000`, bps/percent conversion, "fee over 10 USDC") are chain-agnostic — `src/lib/economy/networks.ts:70-91`

**viem chain objects / wallet config**
- `APP_CHAINS = [lineaSepolia, linea]` from `viem/chains` — `src/lib/web3/chains.ts:1-4`
- `getAppChain()` picks the login chain from `NEXT_PUBLIC_CHAIN` (`"linea"` | `"lineaSepolia"`, default `lineaSepolia`) — `src/lib/web3/chains.ts:6-16`
- Reown AppKit / WagmiAdapter networks = `APP_CHAINS`; browser RPC overrides keyed as `eip155:59144` / `eip155:59141` from `NEXT_PUBLIC_LINEA_RPC_URL` / `NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL` — `src/lib/web3/appkit.ts:20-33`
- AppKit restricted to MetaMask + OKX; Coinbase Wallet and Base Account connectors explicitly disabled because the Coinbase connector loads telemetry outside the CSP — `src/lib/web3/appkit.ts:68-73`

**Server RPC clients**
- `chainClient(chain)`: `chain === 59144 ? linea : lineaSepolia`, URL from `LINEA_RPC_URL` / `LINEA_SEPOLIA_RPC_URL` — `src/lib/payments/chain-client.ts:7-13`
- Alpha contract check uses its own client pinned to `linea` mainnet and `LINEA_RPC_URL` — `src/lib/chat/linea.ts:3,11-16`
- Raffle public verifier (browser) picks `linea`/`lineaSepolia` and `NEXT_PUBLIC_LINEA_*_RPC_URL` with a `chain === 59144` ternary — `src/lib/treasury/raffle-verify-chain.ts:5,20-30`

**Env vars (all Linea-named)**
- `.env.example:6,12,14,19,20` (`NEXT_PUBLIC_CHAIN=lineaSepolia`, `LINEA_RPC_URL`, `LINEA_SEPOLIA_RPC_URL`, `NEXT_PUBLIC_LINEA_RPC_URL`, `NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL`)
- `deploy/prod/vercel.env.example:9-15` (`NEXT_PUBLIC_CHAIN=linea`), `deploy/preprod/web.env.example:10-16` (`NEXT_PUBLIC_CHAIN=lineaSepolia`), `deploy/preprod/docker-compose.yml:19-22`, `Dockerfile:20-23,40-43` (build args)
- Production readiness check requires `NEXT_PUBLIC_CHAIN === "linea"`, `LINEA_RPC_URL` set and both `NEXT_PUBLIC_LINEA_*` empty — `src/lib/deploy/readiness.ts:28-33`
- `scripts/check-rpc.mjs:24-27,47,177` duplicates the USDC addresses and env names per chain (a unit test pins them equal to `networks.ts`).
- Test-only overrides `WETH_ADDRESS_59141` / `ETH_USD_FEED_ADDRESS_59141`, only honored when `chain === 59141` — `src/lib/treasury/valuation.ts:38-50`
- `TIP_CONFIRMATIONS` (default 3) is global, not per chain — `src/lib/payments/verify.ts:41-52`

**Safe + platform fee wallet**
- Not in code: per-chain `safe_address` and `platform_wallet` live in DB table `chain_config` (SuperAdmin-editable) — `supabase/migrations/20261018500002_economy_config.sql:5-13`; exposed to the app via `economy_config()` — same file `:27-46`; parsed in `src/lib/economy/config.ts:23-45`, which hard-codes the keys `"59144"`/`"59141"` and falls back to `59141` — `src/lib/economy/config.ts:34-44`
- Minimum platform fee is a single global `app_config.min_fee_bps` — `supabase/migrations/20261018500002_economy_config.sql:22-24`

**Prices**
- Chainlink ETH/USD read per chain via `addressesFor(chain)`, staleness = heartbeat·1.1; fallback CoinGecko `simple/price?ids=ethereum` with 20 % drift guard vs last snapshot — `src/lib/treasury/valuation.ts:11-14,85-104,114-148`
- No L2 sequencer-uptime feed check anywhere (grep for "sequencer" in `src/` returns nothing).

**Explorer / DexScreener**
- Alpha card hard-codes `https://lineascan.build/address/${address}` ("Ver en Lineascan") and `https://dexscreener.com/linea/${address}?embed=1…` — `src/components/chat/alpha-card.tsx:9,59-64,83`
- Allowed link domains seeded with `lineascan.build`, `sepolia.lineascan.build`, `linea.build`, `dexscreener.com`, `etherscan.io` — `supabase/migrations/20261016100004_channel_admin.sql:672-674`

**CSP**
- `PUBLIC_RPCS = ["https://rpc.linea.build", "https://rpc.sepolia.linea.build"]` in `connect-src` — `src/lib/security/headers.ts:31-36,108`
- RPC override origins from `NEXT_PUBLIC_LINEA_*_RPC_URL` — `src/lib/security/headers.ts:12,88,95-98`
- `frame-src` includes `https://dexscreener.com` (chain-agnostic origin) — `src/lib/security/headers.ts:19-28`
- Comment notes Reown's RPC (`rpc.walletconnect.org`) is used as wagmi transport "when the chain is supported (Linea mainnet)" — `src/lib/security/headers.ts:33-34,41`

**SIWE / Supabase web3 login**
- `buildLoginMessage` rejects any `chainId` not in `APP_CHAINS` — `src/lib/web3/siwe.ts:19-22`
- Login panel forces the wallet onto `getAppChain()` (env), shows "Cambiar a Linea" and the hint "selecciona la red Linea / Linea Sepolia" — `src/components/auth/login-panel.tsx:39-40,48-54,110-128`
- Supabase sign-in is `signInWithWeb3({ chain: "ethereum", message, signature })` — `src/components/auth/login-panel.tsx:64-68`; Supabase config only toggles `[auth.web3.ethereum] enabled = true` (no chain allowlist) — `supabase/config.toml:340-341`

### Inferences
- Adding a network to the registry is mechanically easy (one record per chain), but the `ChainId` union, `isChainId`, `CHAIN_IDS`, `config.ts` key literals and every `chain === 59144 ? linea : lineaSepolia` ternary (chain-client, raffle-verify-chain, linea.ts) must become a lookup table (e.g. `NETWORKS[id].viemChain`, `rpcEnv`, `publicRpcEnv`, `dexscreenerSlug`, `explorer`).
- Env var naming will multiply to 6 server RPCs + 6 browser overrides unless replaced by a generic scheme (e.g. `RPC_URL_<chainId>`), which also touches readiness.ts, Dockerfile, compose and Vercel env.
- The CSP must add the public RPCs of 4 more networks (Arbitrum/Base mainnet + Sepolia), plus any provider origin used.
- SIWE itself is chain-neutral (Supabase only checks `chain: "ethereum"`); making login accept any of the 6 chains is mostly UX (remove the forced switch).

### Gaps
- Did not verify whether `@reown/appkit` treats Arbitrum/Base as Reown-RPC-supported (it likely does, which would change which origins the wagmi fallback hits); needs checking in `node_modules/@reown`.
- Did not verify Arbitrum/Base USDC, WETH and Chainlink feed addresses/heartbeats; they must be sourced from Circle/Chainlink docs before coding.

## Q2. How is the database tied to a chain?

### Takeaway
Fifteen table definitions carry `check (chain_id in (59144, 59141))` (one more, `alpha_details`, is pinned to `= 59144`), 59 literal `in (59144, 59141)` checks appear across migrations, and about 34 SQL functions read the single global `app_config.active_chain_id` to decide which chain an action happens on. Data is already partitioned per chain (keys and unique indexes include `chain_id`), so the schema is "multi-chain ready" in storage but "single active chain" in behavior.

### Cited Findings
**Tables with a chain check constraint** (each needs the constraint widened, ideally replaced by an FK to `chain_config(chain_id)`):
- `chain_config` (PK) — `supabase/migrations/20261018500002_economy_config.sql:6`, seeded rows 59144/59141 at `:13`
- `payment_intents`, `tips`, `onchain_transfers` — `supabase/migrations/20261018600001_tips.sql:10,35,54`; `onchain_transfers` PK `(chain_id, tx_hash, log_index)` + `unique (intent_id, role)` — `:53-61`
- `bounties` — `supabase/migrations/20261018700002_bounties.sql:29`
- `dao_state` (PK, seeded 59144/59141), `dao_positions` (PK `(chain_id, member_id)`), `dao_ledger` — `supabase/migrations/20261018800001_treasury.sql:15,20,23,28,34`
- `dao_reconciliations` — `supabase/migrations/20261018800003_reconcile.sql:19`
- `dao_nav_snapshots` — `supabase/migrations/20261019100001_fund_nav.sql:29`
- `dao_scan_state` (PK), `dao_safe_operations` with unique `(chain_id, tx_hash, log_index, asset)` and `(chain_id, block_number, asset)` — `supabase/migrations/20261019100002_fund_operations.sql:22,28,46-48`
- `withdrawal_requests` with unique `(chain_id, member_id)` (one active request per chain) and `(chain_id, payout_tx_hash, payout_log_index)` — `supabase/migrations/20261019300002_withdrawals.sql:28,63-65`
- `raffles` (`draw_block_hash` regex check, payout unique `(chain_id, payout_tx_hash, payout_log_index)`) — `supabase/migrations/20261019400002_raffles.sql:28,41,79`
- `polls` — `supabase/migrations/20261019500002_polls.sql:43`
- `alpha_details.chain_id integer not null default 59144 check (chain_id = 59144)` — `supabase/migrations/20261016200001_messages.sql:69-73`; inserts never pass chain_id (rely on the default) — latest at `supabase/migrations/20261020100001_message_client_id.sql:200`

**Global active-chain switch**
- `app_config.active_chain_id` seeded `59141` — `supabase/migrations/20261018500002_economy_config.sql:22-24`; `set_active_chain(p_chain)` (SuperAdmin, audited) — same file `:49-70`; pgTAP pins the default — `supabase/tests/991_mainnet_defaults.test.sql:14`; F5 plan says production switches it by hand — `docs/superpowers/plans/2026-10-19-f5-produccion.md:553`
- Helper `_active_chain()` — `supabase/migrations/20261019000003_home_and_rail.sql:6-13`
- Functions that read `active_chain_id` (by grep over all migrations; counts are occurrences across redefinitions): `treasury_withdrawals`, `treasury_raffles`, `set_active_chain`, `economy_config`, `dao_overview`, `dao_operations`, `create_donation_intent`, `club_activity`, `request_withdrawal`, `dao_ranking`, `create_tip_intent`, `create_raffle`, `create_bounty_payment_intent`, `broadcast_dao_event`, `treasury_unexplained_outflows`, `set_chain_addresses`, `raffle_detail`, `leave_raffle`, `enter_raffle`, `home_open_bounties`, `dao_history`, `create_poll`, `broadcast_activity_event`, `_member_dao_standing`, `_active_chain`, `treasury_scan_gap`, `set_operation_note`, `my_dao_position`, `member_unpaid_bounties`, `member_bounty_record`, `dao_raffles`, `dao_nav_history`, `create_bounty`, `bounty_status` (~34 functions). Example: tip intent reads it — `supabase/migrations/20261018600001_tips.sql:165-167`; bounty payment refuses if active chain ≠ bounty chain — `supabase/migrations/20261018700002_bounties.sql:397-402`; `bounty_status` returns `'other_chain'` — `supabase/migrations/20261018800020_f3_final_fixes.sql:57-58`.
- Functions that take `p_chain` and validate `in (59144, 59141)` (cron/admin side, already parameterised): `cancel_open_donation_intents`, `close_due_raffles`, `expire_withdrawal_approvals`, `notify_unpaid_raffles`, `record_nav_snapshot`, `record_reconciliation`, `record_safe_operations`, `set_chain_addresses`, `set_dao_eth_cursor`, `set_weighted_raffles_enabled`, `set_withdrawals_enabled` (e.g. `supabase/migrations/20261019100002_fund_operations.sql:89`, `supabase/migrations/20261019300001_f4c_carry.sql:39,133,212,331,377`).
- Rate-limit migration re-defines several intent functions with the same active-chain read — `supabase/migrations/20261019700101_rate_limits.sql:556-558,667-669,784-786,922,955,1030`.
- Per-chain switches on `chain_config`: `withdrawals_enabled`, `weighted_raffles_enabled` (on for 59141 by default) — `supabase/migrations/20261019400002_raffles.sql:21,120`.

**Migrations touching chain values (by name)**: `20261016100004_channel_admin`, `20261016200001_messages`, `20261018500002_economy_config`, `20261018600001_tips`, `…600002_tips_fixes`, `…600003_tips_read_exact`, `…600004_member_tips_totals`, `20261018700002_bounties`, `…700003_bounty_fixes`, `…700004_bounty_clock_skew`, `20261018800001_treasury`, `…800002_gating`, `…800003_reconcile`, `…800010_treasury_fixes`, `…800011_reconcile_fixes`, `…800012_reconcile_share_lock`, `…800013_lock_state_all_gates`, `…800020_f3_final_fixes`, `20261019000001_dao_realtime`, `…000003_home_and_rail`, `…000004_polish_review_fixes`, `20261019100001_fund_nav` … `100005_fund_final_fixes`, `20261019300001_f4c_carry` … `300007_withdrawal_valuation_window`, `20261019400001_raffle_draw_math` … `400006_payout_fit_prize_cap`, `20261019500002_polls`, `…500003_poll_votes`, `20261019600001_f4_polish` … `600004_payout_pause`, `20261019700101_rate_limits`, `20261020100001_message_client_id` (alpha insert).

### Inferences
- Storage is already chain-scoped and replay-safe across chains: every on-chain identity key includes `chain_id` (`onchain_transfers`, `dao_safe_operations`, payouts). Cross-chain replay of the same tx hash is not a realistic risk because hashes are chain-specific, but the keys already guard it.
- The big DB job is behavioral: ~34 functions must take an explicit `p_chain` (validated against an "enabled chains" set) instead of reading `active_chain_id`, and all read RPCs (overview, ranking, history, home, rail, activity) must either take a chain or aggregate across chains.
- Widening constraints: replace 15 `check (chain_id in (…))` + `alpha_details = 59144` with an FK to `chain_config` (one migration); rewrite 59 literal `in (59144, 59141)` validations as `exists (select 1 from chain_config …)` or a `_is_chain(p)` helper. Because SQL functions are redefined many times, only the latest definition of each must be replaced, but each is a full `create or replace` of a long PL/pgSQL body.

### Gaps
- Exact final count of functions to rewrite needs a per-function "latest definition" pass; the ~34 figure is from a grep heuristic (multi-line signatures may be missed).

## Q3. Per feature: how it works today, what changes, and effort

### Takeaway
Login, explorer links and copy are small; tips/bounties are medium (flow already chain-parameterised end to end, but intent creation is bound to the global active chain); the DAO treasury (shares, NAV, scan, withdrawals, raffles, polls, gating) is large and the main risk, because shares, NAV and gating are per-chain funds and the product must decide between "one fund per chain" and "one aggregated fund".

### Cited Findings
**Login (SIWE)** — today: wallet must be on `NEXT_PUBLIC_CHAIN` before signing; SIWE message embeds that chainId; Supabase verifies with `chain: "ethereum"` — `src/components/auth/login-panel.tsx:39-68`, `src/lib/web3/siwe.ts:19-35`. Change: accept the connected chain if in the enabled list, drop the forced switch and Linea copy (`:110-128`). Effort S, low risk.

**Tips (ETH/USDC P2P + platform fee)** — intent created server-side on the active chain with `chain_config.platform_wallet` and `min_fee_bps` — `supabase/migrations/20261018600002_tips_fixes.sql:130-174`; client reads `economy.activeChainId` and the chain's platform address — `src/components/payments/tip-dialog.tsx:214-221`; guards that wallet chain = intent chain — `:375-381`, switch button — `:650-655`; balances read per chain via wagmi — `src/lib/payments/preflight.ts:58,63-95`; server verification checks RPC chainId, tx.chainId, receipt, confirmations, USDC contract from `NETWORKS[chain]` — `src/lib/payments/verify.ts:60-125`; dedup by `(chain_id, tx_hash, log_index)` — `supabase/migrations/20261018600001_tips.sql:53-61`; profile totals are per active chain — `src/app/(forum)/u/[address]/page.tsx:78-80`, `src/components/profile/tips-received.tsx:15-21`. Change: add a network picker, pass `p_chain` to `create_tip_intent`, fee config per chain (platform wallet already per chain), totals aggregated or per chain. Effort M.

**Bounties** — chain fixed at creation from active chain — `supabase/migrations/20261018700002_bounties.sql:252-260`; payment refused if active chain differs — `:397-402`; UI shows "se publicó en X; podrás pagarlo cuando esa red vuelva a estar activa" — `src/components/payments/tip-dialog.tsx:958-961`; profile/home lists filter by active chain — `supabase/migrations/20261018800020_f3_final_fixes.sql:171,189`, `supabase/migrations/20261019000003_home_and_rail.sql:31,122`. Change: pick chain at creation; pay on the bounty's own chain (removes the "other_chain" state). Effort M (it gets simpler).

**DAO treasury (Safe 2-of-3, shares, NAV, donations, withdrawals, reconciliation)** — one Safe per chain in `chain_config.safe_address`; `dao_state`/`dao_positions` per chain (PK `(chain_id, member_id)`) — `supabase/migrations/20261018800001_treasury.sql:14-30`; donation intents on the active chain — `supabase/migrations/20261019100005_fund_final_fixes.sql:51-81`; donations credited only after the block is `finalized` — `src/lib/treasury/finality.ts:5-18` (comment: ~6 h Linea Sepolia, ~2 h Linea); NAV = USDC + (ETH+WETH)·Chainlink price per chain — `src/lib/treasury/valuation.ts:55-78`; Safe scan via `getLogs` in chunks of 2000 blocks, max 10 chunks (20 000 blocks) per hourly run, balance-continuity check — `src/lib/treasury/scan.ts:23-25,150-253`; cron already loops over `CHAIN_IDS` and skips chains with no Safe: scan → withdrawal payouts → raffles → snapshot — `src/app/api/cron/dao/route.ts:84-140`; all member-facing reads (`dao_overview`, `dao_ranking`, `dao_history`, `my_dao_position`, `dao_operations`, `dao_nav_history`) read the active chain — e.g. `supabase/migrations/20261019100001_fund_nav.sql:263-290,313-318,372-377`; one active withdrawal per (chain, member) — `supabase/migrations/20261019300002_withdrawals.sql:63`; treasurer switches per chain (labels hard-coded "Retiradas en Linea / Linea Sepolia") — `src/components/treasury/treasurer/withdrawals-switch.tsx:13-14,126`; treasurer page text "operaciones de la Safe en {network}" — `src/app/(forum)/dao/tesoreria/page.tsx:124`. No Safe SDK is used (the Safe is only read; treasurers sign in the Safe app). Change: per-chain Safe deployment (3 Safes ×2 envs), Chainlink/WETH addresses per chain, pages need a chain selector or an aggregated view, cron loop works as is once `CHAIN_IDS` grows. Effort L.

**Raffles (commit-reveal with block hash)** — draw block = first block whose timestamp is past close and whose parent's is not, searched among blocks ≤ `finalized` — `src/lib/treasury/raffle-cron.ts:84-133,167-184`; `draw_block_hash` stored and checked — `supabase/migrations/20261019400002_raffles.sql:41,66`, `supabase/migrations/20261019400003_raffle_draw.sql:539-571`; public browser verifier with Linea-only client — `src/lib/treasury/raffle-verify-chain.ts:20-30`; copy "primer bloque de Linea posterior al cierre" — `src/app/(forum)/dao/page.tsx:164`, `src/components/guide/guide-content.tsx:299`; prize paid from that chain's Safe; `enter_raffle`/`create_raffle` read active chain — see Q2 list. Effort M (logic is chain-agnostic; client/verifier/copy are not).

**Polls** — chain fixed at creation from active chain; weights = unlocked shares on that chain, frozen in `private.poll_weight_snapshots` — `supabase/migrations/20261019500002_polls.sql:9-12,43,181-198`. Change: needs a decision: weight by shares of one chosen chain or the sum across chains (sum requires a common unit — shares of different funds are not comparable, USD value is). Effort M, product-risk.

**Channel gating** — passes if `share_bps >= min` OR `net_usdc >= min` "read from the ACTIVE chain's ledger" — `supabase/migrations/20261018800002_gating.sql:1-5,27-42`; lock text names the chain — `src/lib/channels/lock.ts:99`. Change: define cross-chain standing (sum of net USDC is natural; `share_bps` is per fund). Effort M.

**Alphas** — server checks `getCode` on Linea mainnet only (EIP-7702 designator excluded) — `src/lib/chat/linea.ts:11-26`, called from `src/lib/chat/alpha.ts:57`; DB pins `chain_id = 59144` — `supabase/migrations/20261016200001_messages.sql:72`; card links Lineascan + DexScreener `linea` slug — `src/components/chat/alpha-card.tsx:59-83`; dialog copy "Contrato en Linea" — `src/components/chat/alpha-dialog.tsx:82,122,148`. Change: chain picker in dialog, pass chain to `post_message` (new param on a large RPC redefined 5 times), widen check, per-chain explorer + DexScreener slug (`arbitrum`, `base`, `linea`), add explorers to `allowed_domains`. Effort S–M; independent from money, a good first slice.

**Market page** — CoinGecko top markets/coin pages, not chain-specific — `src/lib/market/coingecko.ts:15-17`. Effort none.

**Network badge "MODO PRUEBA"** — derived from `NETWORKS[chainId].testnet` — `src/components/economy/network-badge.tsx:22-24`; rendered in sidebar with `economy.activeChainId` — `src/app/(forum)/layout.tsx:123`, bounty dialog — `src/components/chat/bounty-dialog.tsx:96`. Change: becomes "per action" badge; the global "test mode" concept should be an environment property (PRE = all testnets) rather than a chain. Effort S.

**SuperAdmin economy form** — "Cambiar a {network}" active-chain switch and per-chain Safe/platform addresses — `src/components/economy/economy-form.tsx:28,129,293,317-335`. Change: switch replaced by per-chain enable toggles. Effort S.

**Guide, docs, /start landing, onboarding** — Linea copy in guide (`src/components/guide/guide-content.tsx:189,258,299,359-362`), DAO overview finality text (`src/components/treasury/dao-overview.tsx:138-139`), treasurer alert "Revisa el nodo RPC de Linea" (`src/components/treasury/treasurer/treasury-alerts.tsx:37`), /start (`src/app/start/page.tsx:7`, `src/app/start/opengraph-image.tsx:7`, `src/components/start/hero.tsx:14,70,101`, `features.tsx:70`, `final-cta.tsx:73,75`, `how-to-join.tsx:15,18,35`, `mocks.tsx:73`, `noise-to-signal.tsx:124`), onboarding receives `chainId` — `src/app/(onboarding)/bienvenida/page.tsx:42`. `docs/` has 24 files with ~250 "linea" mentions (plans/specs; historical). Effort S (copy), but the guide's finality explanation must become per-chain.

### Inferences
| Feature | Effort | Main risk |
|---|---|---|
| Registry/config/env/CSP refactor (networks, chain clients, AppKit, readiness, Docker/Vercel env) | M | Missed ternaries silently routing to Linea; CSP blocking new RPCs |
| Login SIWE | S | Low |
| Alphas | S–M | DexScreener slug mapping; `post_message` RPC rewrite |
| Tips | M | Fee per chain; intent must be bound to the chosen chain, never a client-trusted value without server validation |
| Bounties | M | Migrating existing bounties keyed to the old "active chain" semantics |
| DAO treasury (donations, NAV, scan, withdrawals, reconciliation) | L | Fund model (per-chain vs aggregated), 3 Safes ×2 envs, per-chain finality & block speed, Chainlink feeds |
| Raffles | M | Prize payout from the right Safe; verifier per chain; block-time semantics on Arbitrum |
| Polls / gating | M | Comparing standing across separate funds |
| UI copy, guide, /start, badge | S | Messaging (no longer "Construido en Linea") |
| Tests (unit + pgTAP + e2e) | M–L | Volume of fixtures (see Q4) |
- Overall order of magnitude (inference): the money-moving core is chain-parameterised in TypeScript already (verify/valuation/scan all take `chain`), so the cost concentrates in (a) DB functions bound to `active_chain_id`, (b) the treasury product model, and (c) tests.

### Gaps
- No product decision exists in the repo on whether the DAO should be one fund per chain or one aggregated fund; this choice drives most of the L estimate.

## Q4. Tests and e2e hard-coded to Linea

### Takeaway
Chain ids are pervasive in tests: ~636 literal occurrences of 59144/59141 in 68 unit/integration test files, ~755 in 41 pgTAP files, and 15 in 9 e2e files; the e2e stack runs a local Hardhat chain impersonating Linea Sepolia (59141).

### Cited Findings
- Counts by grep: `tests/` 636 occurrences / 68 files; `supabase/tests/` 755 / 41 files; `e2e/` 15 / 9 files; `src/` 51 / 12 files (grep over the repo, this audit).
- e2e local chain `CHAIN_ID = 59141 // Linea Sepolia`, start script asserts the node's chainId — `e2e/chain/shared.mjs:8`, `e2e/chain/start-chain.mjs:78-79`; mock USDC deployed at Linea Sepolia's USDC address — `playwright.config.ts:58`; feed/WETH overrides `ETH_USD_FEED_ADDRESS_59141` / `WETH_ADDRESS_59141` — `playwright.config.ts:36-37`.
- Mock injected wallet emits the configured chainId, handles `wallet_switchEthereumChain`, and implements `linea_estimateGas` (viem's Linea chain fee hook) — `e2e/helpers/wallet.ts:23-115,175`; SIWE helper `CHAIN_ID = 59141` — `e2e/helpers/auth.ts:21,38`; DAO helper resets chain 59141 state — `e2e/helpers/dao.ts:166,188-191`.
- `supabase/tests/991_mainnet_defaults.test.sql:14` pins `active_chain_id = 59141`.

### Inferences
- Most unit/pgTAP occurrences are fixtures and would keep working if Linea stays supported; new tests are needed for each new chain path, plus a second local chain id (or two Hardhat nodes) for cross-chain e2e. Per project memory, the pgTAP/e2e suites write to the user's local DB, so this work needs care.

### Gaps
- Did not classify each test occurrence as "fixture that still works" vs "assertion that breaks"; a precise count would need running the suites, which was out of scope.

## Q5. How are PRE and PRO split between Linea Sepolia and Linea mainnet?

### Takeaway
Two mechanisms, not one: the build-time env var `NEXT_PUBLIC_CHAIN` (`lineaSepolia` in PRE, `linea` in PRO) only drives the login network; the money network is the runtime DB row `app_config.active_chain_id` (default 59141, switched by hand in production by the SuperAdmin).

### Cited Findings
- `NEXT_PUBLIC_CHAIN=linea` in `deploy/prod/vercel.env.example:9`; `NEXT_PUBLIC_CHAIN=lineaSepolia` in `deploy/preprod/web.env.example:10`; inlined as Docker build arg — `Dockerfile:20,40`.
- Readiness guard forbids anything but `linea` in production — `src/lib/deploy/readiness.ts:28`.
- Money network = `app_config.active_chain_id`, default `59141`, changed via `set_active_chain` — `supabase/migrations/20261018500002_economy_config.sql:22-24,49-70`; "production switches it by hand, Task 8" — `docs/superpowers/plans/2026-10-19-f5-produccion.md:553`.
- Both Linea networks are always present in the PRO bundle and DB (`APP_CHAINS`, `chain_config` rows, cron loops both) — `src/lib/web3/chains.ts:4`, `src/app/api/cron/dao/route.ts:95`.

### Inferences
- For multichain, the natural model is "environment = mainnet set or testnet set" (PRO: 42161/8453/59144; PRE: 421614/84532/59141), replacing both `NEXT_PUBLIC_CHAIN` and `active_chain_id` with a per-environment enabled-chain list (e.g. `chain_config.enabled`). Today the PRO bundle can show testnets (badge "MODO PRUEBA"), which would become unnecessary.

### Gaps
- None material.

## Q6. Main risks of going multichain

### Takeaway
The highest risks are treasury accounting (separate per-chain funds vs one fund), different finality/block-speed characteristics hard-wired into constants, and price-oracle assumptions; replay and USDC decimals are low risk given the current design.

### Cited Findings
- Shares/NAV are per chain (`dao_state`/`dao_positions` keyed by chain) — `supabase/migrations/20261018800001_treasury.sql:14-30`; NAV snapshot per chain — `supabase/migrations/20261019100001_fund_nav.sql:29,178-234`.
- Finality: donations and raffle draws wait for the `finalized` block tag — `src/lib/treasury/finality.ts:10-17`, `src/lib/treasury/raffle-cron.ts:128-133`; tips use `TIP_CONFIRMATIONS` (default 3, global) — `src/lib/payments/verify.ts:41-52,85-86`.
- Scan throughput constants: 2000-block chunks, ≤20 000 blocks per hourly run — `src/lib/treasury/scan.ts:23-25`.
- USDC handled as 6-decimal base units in limits (`10_000n` min tip = 0.01 USDC; donation min `1_000_000n`) — `src/lib/payments/amounts.ts:7,12`; USDC contract taken from `NETWORKS[chain].usdc` only (no bridged variants) — `src/lib/payments/verify.ts:106`.
- Chainlink freshness uses a per-network heartbeat field — `src/lib/economy/networks.ts:11-12`, `src/lib/treasury/valuation.ts:96-98`; no sequencer-uptime check (grep).
- Replay protection keyed by `(chain_id, tx_hash, log_index)` and verification rejects RPC/tx chain mismatch — `supabase/migrations/20261018600001_tips.sql:59`, `src/lib/payments/verify.ts:63-67,95`.

### Inferences
- Treasury model: with per-chain funds, a member holds three separate share balances and NAVs; "% of the club", ranking, gating and poll weights need a cross-chain definition (USD value is the only common unit). An aggregated single fund would require a cross-chain NAV and share issuance at a global price — a redesign of `record_nav_snapshot`/settlement, and rebalancing between Safes is manual. Recommend per-chain funds + aggregated USD views as the lower-risk path.
- Block speed: Arbitrum produces blocks much faster than Linea/Base (sub-second vs ~2 s), so 20 000 blocks/hour may not keep up on Arbitrum and the 3-confirmation tip rule represents far less time; constants should become per-network (`scanChunk`, `maxChunks`, `confirmations`). Exact block times were not verified in this audit.
- Raffle draw on Arbitrum: several consecutive blocks can share a timestamp; the "first block past close whose parent is not" rule is still well-defined, but the verifier copy and guide must be adapted. Sequencer influence over block hashes exists on all three L2s (single sequencer); it is already the Linea situation.
- USDC: all three networks use 6-decimal native USDC, so decimals are not a risk; the risk is users sending bridged USDC.e (Arbitrum) which the verifier will (correctly) reject as `tx_mismatch` — needs UX copy. Addresses must be verified from Circle docs.
- Chainlink on Arbitrum/Base: Chainlink recommends checking the L2 sequencer uptime feed; the current code (written for Linea) does not, and heartbeats differ by network — must be confirmed per feed.
- Replay/double-spend across chains: low risk; keys already include chain_id and the verifier checks chainId. The real risk is an intent created for chain A being paid on chain B; the guards `guardSigner` and server `verifyTransfer(input.chain)` already bind payment to the intent's chain.
- Operational: 6 Safes (3 mainnet + 3 testnet) with 2-of-3 signers, 6 RPC endpoints (paid ones in PRO), and per-chain treasurer alerts.

### Gaps
- Arbitrum/Base finality lag for the `finalized` tag, block times, Chainlink feed addresses/heartbeats and native USDC addresses were not verified (no web research in this assignment).
