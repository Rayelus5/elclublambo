# Galaxy Survivor M6c-2 · Moderación del comercio: anuncios, trueques, reversiones y alertas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Moderación gains the trade part of GDD §16.4, for admins:
- the history of market listings and of trades, filtered by account and status;
- cancelling an active listing or an open trade;
- **reverting** a sale or a done trade, which shows each galaxy's lineage first and books compensating ledger entries;
- the suspicious-trade alerts, each marked as reviewed.

**Architecture:**
- **Server:** `admin/market.ts` (service) and `admin/market-routes.ts` under `/galaxy/api/admin/market/*`, all `requireAdmin`.
- **Holds:** the galaxy holds (loadout, pedestal, listing, open trade) are released by one `releaseHolds(trx, galaxyId)` extracted from M6a's `revokeGalaxy`.
- **Migration** `galaxy_market_moderation`:
  - a `deal_reversals` table, at most one per listing or trade;
  - review columns on `trade_alerts`.
- **Web:** two admin-only sub-tabs of Moderación, «Comercio» (listings and trades) and «Alertas».
  - The revert dialog fetches the lineage first and is disabled when a galaxy cannot go back.
  - `ActionDialog` gains an `intro` slot.

**Tech Stack:** Fastify 5, Kysely 0.29, Zod 4, React 19, React Router 7, TanStack Query 5, Vitest, pgTAP, Playwright.

**Spec:** `games/galaxy/docs/GDD.md`:
- §16.4 «Mercado y tratos»: cancel listings, revert deals with lineage and compensating entries, history, alerts of suspicious trade;
- §16.2: economy corrections are compensating ledger entries, never deleted history;
- §16.1: destructive actions ask for the password, and everything is audited;
- §14.5 and §14.6: trades and market.

## Global Constraints

- **Admin only** (TOTP). Moderators get 403 and do not see the tabs.
- **History is never rewritten.**
  - A reverted listing stays `sold` and a reverted trade stays `done`.
  - The reversal is a `deal_reversals` row, plus galaxy ownership moves and ledger entries with reason `market_revert` / `trade_revert`.
- **Reverting asks for the admin's password** (`confirmPassword`). Cancelling does not, because the owner can list or propose again.
- **Every change is audited in its transaction:** `market.cancel`, `trade.cancel`, `market.revert`, `trade.revert`, `alert.review`.
- **Lineage of a moved galaxy:**
  - who holds it now;
  - whether it is alive, or was disintegrated or revoked;
  - the fusion child that consumed it (`lineage @> {id}`), and that child's owner;
  - its later sales or trades after this deal.
- **A deal can be reverted only when every galaxy it moved is returnable:** alive, owned by its receiver, and with no later sale or trade.
  - Otherwise the server answers 409 `revert_blocked` with the lineage.
  - The admin then corrects by hand with the M6a wallet and galaxy tools.
- **Reverting a sale:**
  - the buyer gets the whole price back (credit);
  - the seller gives back what they received (price − commission), up to their balance;
  - any shortfall is recorded in the reversal and in the audit, never as a negative balance (ruling: balances cannot go negative).
- **Copy:** Spanish, direct titles, no special symbols, no final period. Consult ui-ux-pro-max before CSS; DESIGN_SYSTEM §8 novodecies.
- **Tests never publish live config to the local DB.**

## Review Focus

1. **Reverting a sale whose galaxy was resold, fused or disintegrated** → 409 `revert_blocked`, with lineage naming the third party; nothing moves.
2. **Reverting twice, or two admins at once** → one reversal, then 409 `already_reverted` (row lock plus unique index).
3. **A seller who spent the coins** → the buyer is refunded in full, the seller is taken to 0, and the shortfall is recorded; no negative balance.
4. **A reverted galaxy that its receiver had equipped, exhibited, listed or offered** is released from each hold before it moves.
5. **Cancelling a listing that sold or expired meanwhile** → 409 `listing_gone`. Cancelling a trade that closed meanwhile → 409 `trade_gone`.

---

### Task 1: Migration, shared and the holds helper
- **Migration** `<UTC ts>_galaxy_market_moderation.sql`:
  - **`galaxy.deal_reversals`:**
    - `id bigint identity pk`;
    - `listing_id uuid unique references market_listings`;
    - `trade_id uuid unique references trades`;
    - check that exactly one of the two is set;
    - `by_id uuid references accounts on delete set null`;
    - `reason text 3–300`;
    - `details jsonb object`;
    - `created_at`;
    - RLS and policy; grant select and insert.
  - **`trade_alerts`** gains `reviewed_at timestamptz`, `reviewed_by uuid` and `review_reason text`, with a check that the three are set together. Grant update of those columns. Add an index `(created_at desc) where reviewed_at is null`.
  - **pgTAP** `988_galaxy_market_moderation.test.sql`.
- **Shared** `api/admin-market.ts`:
  - **Schemas:**
    - `adminDealsQuerySchema {kind: 'listings'|'trades', status?, user?, page}`;
    - `adminReasonSchema` reused;
    - `adminRevertSchema {reason, password}`;
    - `adminAlertsQuerySchema {reviewed?: 'true'|'false', page}`.
  - **Types:** `AdminListingRow`, `AdminTradeRow`, `DealLineage {galaxies: GalaxyLineage[], returnable: boolean}`, `GalaxyLineage`, `AdminAlertRow`, plus pages.
  - **Errors:** `revert_blocked`, `already_reverted`, `alert_reviewed`.
- **`releaseHolds(trx, galaxyId): Promise<string[]>`** in `market/escrow.ts`, extracted from `revokeGalaxy`, which then uses it.

### Task 2: Server
- **History:**
  - `adminListings(db, q)` and `adminTrades(db, q)`, 50 a page, newest first, with each one's reversal if any;
  - `user` matches seller or buyer (side a or b).
- **Cancel:** `adminCancelListing` and `adminCancelTrade` lock the row, check the status, update it and audit.
- **Lineage:** `dealLineage(db, kind, id)`.
- **Revert:** `revertSale` and `revertTrade` run in one transaction:
  1. lock the deal row, then the galaxies in id order;
  2. if a reversal exists → 409 `already_reverted`;
  3. compute the lineage under the lock; if not returnable → 409 `revert_blocked` {lineage};
  4. `releaseHolds` on each galaxy;
  5. move the owners back;
  6. book the ledger entries (sale) with opKey `revert:<id>`;
  7. insert the reversal and write the audit.
- **Alerts:** `adminAlerts(db, q)` and `reviewAlert` (409 `alert_reviewed`).
- **Routes:** under `/galaxy/api/admin/market/`: `deals`, `listings/:id/cancel|revert`, `trades/:id/cancel|revert`, `lineage`, `alerts`, `alerts/:id/review`.
- **Integration tests** in `admin-market.test.ts`:
  - each Review Focus line;
  - a moderator gets 403;
  - the audit rows.

### Task 3: Web
- **Sub-tabs** «Comercio» and «Alertas» (admin only).
- **Comercio:**
  - a toggle between Anuncios and Trueques, filters by account and status, and a table;
  - row actions «Cancelar» (active or open) and «Revertir» (sold or done, not yet reverted).
- **The revert dialog** shows the lineage per galaxy («Vuelve de B a A» or why not). Its button «Revertir» is Nova, needs the password, and is disabled when the deal is not returnable.
- **Alertas:** pending first, each with its accounts and details, a link to its deal in Comercio, and «Marcar revisada».
- **Tests** in `admin-market.test.tsx`.

### Task 4: e2e, docs, verification, review, PR, PRE
- **e2e:**
  - two e2e players at the trade level do a trade, and an admin reverts it after seeing the lineage;
  - an admin cancels an e2e listing;
  - no CSP violations.
- **Docs:** DEPLOY_PRE step 22; DESIGN_SYSTEM §8 novodecies.
- **Then:** verification → fresh opus review → one fix pass → PR → merge on green → PRE check.
