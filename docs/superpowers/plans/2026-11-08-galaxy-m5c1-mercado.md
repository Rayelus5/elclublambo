# Galaxy Survivor M5c-1 · Mercado y antiabuso del comercio

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a market where players sell galaxies for coins, with a minimum price per rarity enforced by the database, a 7 % commission as a coin sink, no double purchases, and the trade gates (level 10, 3-day-old account, daily caps, alerts for the admin).

**Architecture:** a listing puts the galaxy in escrow (a live listing blocks equipping, exhibiting, fusing, disintegrating and levelling it). Buying is one idempotent operation that locks the listing row first, then moves coins (buyer → seller minus the commission) and the galaxy's ownership in one transaction. A trigger refuses prices under the tier's minimum, read from the live config `market` (with the GDD defaults when it was never published). Suspicious sales (shared IP, a price far above the floor) are stored in `galaxy.trade_alerts` for the admin panel of M6. M5c-2 brings the 1:1 swap (trueque) on the same gates.

**Tech Stack:** Fastify 5 + Kysely + Postgres (Supabase local), Zod config registry, React 19 + RR7 + TanStack Query 5, Aseprite headless for the market art.

**Spec:** `games/galaxy/docs/GDD.md` §14.6 (mercado), §14.7 (antiabuso del comercio), §11 (economía: sumideros, idempotencia, libro de movimientos).

## Global Constraints

- **Only galaxies are sold** (§14.6), for coins.
- **Minimum price per rarity, enforced by a trigger.** Defaults: Común 50, Poco común 120, Rara 400, Épica 1500, Legendaria 6000 coins.
- **The commission is a coin sink:** 7 % by default, at least 1 coin, rounded down. The seller gets `price − commission`.
- **To trade:** account level 10 and 3 days old. Daily caps on listings and on purchases (Madrid day, like the other daily limits).
- **An alert for the admin** when buyer and seller shared an IP in the last 30 days, or when the price is ≥ 20× the tier's minimum. The sale still happens.
- Every economy action is idempotent (`runOperation`), and the ledger is append-only.
- **Copy:** Spanish, direct titles, no special symbols, no final period. Consult ui-ux-pro-max before CSS; update DESIGN_SYSTEM; respect `prefers-reduced-motion`.
- The local DB is the user's: `pnpm exec supabase migration up` and `pnpm exec supabase test db` only; tests write `e2e_*` and random-named rows.
- Migration timestamps in UTC (`date -u +%Y%m%d%H%M%S`).

## Review Focus

1. **Two buyers, one listing, at the same time:** exactly one pays and gets the galaxy; the other gets 409 `listing_gone` and keeps its coins → Task 3 (concurrency test with `Promise.all`).
2. **A galaxy in escrow cannot leave by another door:** equipping, exhibiting, fusing, disintegrating, levelling or listing it twice → 409 `galaxy_listed`; and an equipped or exhibited one cannot be listed → Task 3.
3. **The seller cancels while a buyer buys:** one wins; never both (coins taken and galaxy back) → Task 3.
4. **A forged price under the floor** sent straight to the DB (bypassing the service) is refused by the trigger; a price above `maxPrice` or not an integer is a 400 → Tasks 2 and 3.
5. **A retry after a lost answer** (same idempotency key) does not buy twice nor charge twice; an expired listing cannot be bought and frees the galaxy → Task 3.

---

### Task 1: Rules, config and API

**Files:**
- Create: `games/galaxy/packages/shared/src/market/rules.ts`, `games/galaxy/packages/shared/src/api/market.ts`, `games/galaxy/packages/shared/test/market.test.ts`
- Modify: `packages/shared/src/config/registry.ts` (key `market`), `packages/shared/src/errors.ts`, `packages/shared/src/index.ts`, `apps/web/src/copy/es.ts` (error texts)

**Interfaces:**
- Produces:
  - `MarketConfig = ConfigValue<'market'>`: `{ minPrice: Record<Tier, number>, maxPrice: 10_000_000, commission: 0.07, days: 7, perDay: { listings: 10, purchases: 10 }, minLevel: 10, minAccountDays: 3, alertMultiple: 20, sharedIpDays: 30 }`.
  - `minPriceFor(tier: Tier, cfg): number`.
  - `commissionOf(price: number, rate: number): number`: `max(1, floor(price × rate))`.
  - `tradeBlock(level: number, accountCreatedAt: Date, now: Date, cfg): 'level' | 'age' | null`.
  - The API (`api/market.ts`):
    - `MarketListing { id, galaxy: GalaxyCardData, seller: string, price, listedAt, expiresAt }`;
    - `MarketPage { listings, page, pages, rules: MarketRules }`;
    - `MarketRules { commission, minPrice, canTrade, reason, minLevel, minAccountDays, listingsLeft, purchasesLeft }`;
    - `MyMarket { active: MarketListing[], sold: SoldListing[] }`, where `SoldListing` adds `buyer, net, soldAt`;
    - `marketQuerySchema { tier?, sort: 'new'|'cheap'|'dear' = 'new', q? ≤40, page ≥1 }`;
    - `marketListSchema { galaxyId: uuid, price: int ≥1 }`;
    - `marketIdParamSchema`.
  - Errors: `trade_level`, `trade_age`, `trade_daily_cap`, `price_too_low`, `price_too_high`, `listing_gone`, `own_listing`, `galaxy_listed`.

- [ ] **Step 1:** failing tests in `packages/shared/test/market.test.ts`:
  - the defaults parse;
  - `minPrice` must grow with the tier (a lower legendary is refused);
  - `commissionOf(50, 0.07) === 3`, `commissionOf(10, 0.07) === 1`, `commissionOf(6000, 0.07) === 420`;
  - `tradeBlock` returns `'level'` before `'age'` and null at level 10 with 3 full days;
  - `marketListSchema` refuses 0, 1.5 and strings.
- [ ] **Step 2:** implement until GREEN.
- [ ] **Step 3:** commit `feat(galaxy): reglas, configuración y API del mercado`.

### Task 2: Migration and pgTAP

**Files:**
- Create: `supabase/migrations/<utc>_galaxy_market.sql`, `supabase/tests/984_galaxy_market.test.sql`
- Modify: `apps/server/src/db/schema.ts`

**Interfaces:**
- **`galaxy.market_listings`:**
  - columns: `id uuid pk default gen_random_uuid()`, `galaxy_id`, `seller_id`, `price bigint > 0`, `listed_at`, `expires_at`, `status in ('active','sold','cancelled','expired')`, `buyer_id null`, `sold_at null`, `commission bigint null`;
  - checks: sold ⇔ buyer, sold_at and commission all set;
  - index: unique partial on `(galaxy_id) where status = 'active'`.
- **Trigger `galaxy.market_min_price()`** (before insert or update of price): the price must be ≥ the galaxy's tier minimum from `game_config_active` key `market` (`data->'minPrice'->>tier name`), falling back to the GDD defaults. Otherwise it raises `check_violation`.
- **`galaxy.trade_alerts`:** `id bigint identity`, `kind in ('shared_ip','unbalanced')`, `listing_id`, `seller_id`, `buyer_id`, `details jsonb`, `created_at`.
- **Grants for `galaxy_api`:**
  - listings: select, insert, update;
  - alerts: select, insert;
  - no delete.
- RLS on, as on every galaxy table.

- [ ] **Step 1:** pgTAP (~12 checks):
  - the tables exist, with RLS and grants;
  - one active listing per galaxy;
  - a price under the floor fails (common 49, legendary 5999);
  - a price at the floor passes;
  - after publishing a `market` version with a higher floor, that floor applies;
  - sold without a buyer fails.
- [ ] **Step 2:** migration, `pnpm exec supabase migration up`, `pnpm exec supabase test db` GREEN, Kysely types.
- [ ] **Step 3:** commit `feat(galaxy): tablas del mercado con precio mínimo por rareza`.

### Task 3: Server

**Files:**
- Create: `apps/server/src/market/{service,routes}.ts`, `apps/server/test/integration/market.test.ts`
- Modify:
  - `app.ts`;
  - `collection/service.ts`: `galaxy_listed` in fuse, disintegrate and level; `listed` in the detail and the list;
  - `runs/hangar.ts` (equipping);
  - `planetarium/service.ts` (exhibiting).

**Interfaces:**
- **Routes:**
  - `GET /galaxy/api/market?tier&sort&q&page`: live listings by others and by you, excluding expired ones, 24 per page, plus `rules`;
  - `GET /market/mine`: active listings and the last 50 sales;
  - `POST /market/listings` (idempotency key);
  - `POST /market/listings/:id/cancel`;
  - `POST /market/listings/:id/buy` (idempotency key).
- **Buying** (`runOperation`):
  1. lock the listing (`for update`);
  2. it must be active and not expired, else 409 `listing_gone`;
  3. it must not be your own, else 409 `own_listing`;
  4. the gates and the purchase cap;
  5. `debit` the buyer `price` (`market_buy`), `credit` the seller `price − commission` (`market_sale`);
  6. move the galaxy: owner = buyer, unfeatured;
  7. mark the listing sold;
  8. alerts.
- **Listing:**
  1. lock the galaxy;
  2. it must be the owner's and alive;
  3. it must not be equipped, exhibited or listed;
  4. the gates and the listings cap;
  5. the price must be within `[minPrice(tier), maxPrice]`, else 400 `price_too_low` or `price_too_high` (the trigger is the backstop);
  6. stale active rows of this galaxy become `expired` first.
- **Daily caps** count listings created and purchases made since Madrid midnight (`madridDay`).

- [ ] **Step 1:** RED integration tests:
  - **The gates:** level 9 → 403 `trade_level`; a 2-day-old account → 403 `trade_age`.
  - **Listing:**
    - list at the floor; under it → 400; above `maxPrice` → 400;
    - an equipped galaxy can't be listed (409 `galaxy_equipped`), nor an exhibited one (409 `galaxy_exhibited`);
    - a listed galaxy refuses equip, exhibit, fuse, disintegrate, level and a second listing (409 `galaxy_listed`);
    - the 11th listing of the day → 429 `trade_daily_cap`.
  - **Browsing:** filters by tier, sorts by price, searches by name, hides expired listings.
  - **Buying:**
    - the buyer pays `price`; the seller gets `price − commission` (ledger reasons `market_buy` and `market_sale`); the galaxy changes owner;
    - a retry with the same key gives the same answer, with no second charge;
    - two buyers at once (`Promise.all`) → one 200, one 409 `listing_gone`;
    - cancel vs buy at once → exactly one wins;
    - buying your own listing → 409 `own_listing`;
    - not enough coins → 402, and the listing stays active;
    - an expired listing → 409 `listing_gone`, and the galaxy is free again.
  - **Alerts:** a shared IP (sessions with the same `ip`) creates a `shared_ip` alert; a price ≥ 20× the floor creates an `unbalanced` alert.
- [ ] **Step 2:** implement until GREEN; the whole suite; lint.
- [ ] **Step 3:** commit `feat(galaxy): mercado de galaxias con comisión, depósito y avisos`.

### Task 4: Web

**Files:**
- Create:
  - `apps/web/src/market/{MarketScreen,ListingCard,SellPanel,BuyDialog}.tsx`;
  - `apps/web/src/api/market.ts`;
  - `apps/web/test/market.test.tsx`;
  - `art/market/paint-market.lua` (Aseprite: the trading post header, 192×64, 4-frame strip, integer scale only).
- Modify:
  - `hub/TopBar.tsx`: «Mercado» opens `/mercado` (no longer locked);
  - `App.tsx` (route);
  - `collection/GalaxyDetailDialog.tsx`: an «En venta» chip, the actions blocked with their reason, «Vender» leading to `/mercado?vender=<id>`;
  - `copy/es.ts`, `styles/app.css`, `DESIGN_SYSTEM.md` §8 quattuordecies.

- [ ] **Step 1:** failing tests:
  - **The tabs:** Comprar, Vender and Mis anuncios.
  - **Without the gates,** a panel says «Necesitas nivel 10 y 3 días de cuenta para comerciar» and the buttons are off with that reason.
  - **Comprar:**
    - cards with galaxy, price and seller (linked);
    - the tier filter and the sort;
    - «Comprar» opens a confirmation with the price and your balance;
    - after buying, «Es tuya» with a link to the collection;
    - without coins, the button says what is missing.
  - **Vender:**
    - the picker leaves out equipped, exhibited and listed galaxies;
    - the price field shows the floor of the chosen tier and «Recibirás N monedas» after the commission;
    - under the floor the field says the minimum;
    - «Poner en venta» shows the remaining daily listings.
  - **Mis anuncios:** active listings with «Retirar» (confirmed) and the sales with buyer and net.
  - **Errors:** a 409 `listing_gone` says «Alguien se adelantó» and refreshes the list.
- [ ] **Step 2:** implement with ui-ux-pro-max; paint the header in Aseprite (headless script, like the station rooms); screenshots at 1280/1600/1920.
- [ ] **Step 3:** commit `feat(galaxy): pantalla del mercado con comprar, vender y mis anuncios`.

### Task 5: e2e, documentation, verification, review, PR and PRE

- [ ] **e2e** `market.spec.ts`:
  - two `e2e_*` accounts at level 10, aged 3 days (`created_at` set in their rows), with coins from the CLI;
  - one lists a galaxy from its collection; the other buys it from Comprar;
  - the seller sees the sale in Mis anuncios with the net; the buyer finds the galaxy in its collection;
  - no CSP violations.
- [ ] **DEPLOY_PRE step 17:** the migration, the `market` key, the checks.
- [ ] **Then:**
  - full verification;
  - opus review and one fix pass;
  - PR and CI; merge;
  - PRE check;
  - archive the ledger and update memory.
