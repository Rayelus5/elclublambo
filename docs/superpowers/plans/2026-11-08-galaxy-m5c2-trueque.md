# Galaxy Survivor M5c-2 · Trueque

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** two players swap one galaxy for one galaxy, confirmed by both. What each side offers stays in escrow, and every change makes a new version, so the swap only happens when both confirm the same one.

**Architecture:**
- **A trade** (`galaxy.trades`) has two sides. Each side offers at most one galaxy, held in escrow like a market listing; a galaxy held by a trade or a listing cannot be spent anywhere else.
- **Versions:** a trade has a version number. Any change of what either side offers bumps it and clears the other side's confirmation; the side making the change confirms the new version.
- **Confirming** names the version. When both sides have confirmed the current one, the swap runs in the same transaction: the trade row is locked, then the two galaxies in a fixed order, then they are checked again and swapped.
- **Shared with M5c-1:** the gates (level 10, 3 days) and the per-account market lock; the daily cap is `market.perDay.trades`; the alerts are a shared IP, or a tier gap of 3 or more (`unbalanced`).

**Tech Stack:** as in M5c-1 (Fastify, Kysely, Postgres, React, TanStack Query).

**Spec:** `games/galaxy/docs/GDD.md` §14.5 (trueque), §14.7 (antiabuso).

## Global Constraints

- **1:1:** each side gives exactly one galaxy, and the swap needs both. A trade where one side offers nothing cannot be confirmed by either side.
- **Escrow:** an offered galaxy is not equipped, exhibited, listed, fused, disintegrated, levelled, or offered in another trade (409 `galaxy_in_trade`). An equipped, exhibited or listed galaxy cannot be offered.
- **Versions:** confirming a version that is not the current one → 409 `trade_changed`.
- **Gates:** level 10 and 3 days of account (as the market). At most 5 open trades per account; a daily cap on proposals (`market.perDay.trades`, 10).
- **Expiry:** a trade expires after `market.tradeDays` (3) with no job, the same way a listing does: open and not expired.
- **Copy:** Spanish, direct titles, no special symbols, no final period. Consult ui-ux-pro-max; update DESIGN_SYSTEM.

## Review Focus

1. **Both confirm at the same time:** the swap runs once, never twice, and never leaves half a swap.
2. **A change while the other side confirms:** the stale confirmation is refused (409 `trade_changed`). A confirmation never applies to a version the player did not see.
3. **A galaxy offered in two trades, or listed and offered:** refused, including under concurrency.
4. **Cancelling** (either side) **or expiry while the other confirms:** one wins, and the escrow is freed.
5. **The swap moves the galaxies with their level and «Destacada»;** a banned side cannot complete a swap.

---

### Task 1: Rules, config and API

- **Config:** `market` gets `perDay.trades` (10), `tradeDays` (3), `openTrades` (5) and `tradeAlertTierGap` (3).
- **Types:**
  - `TradeView { id, version, status, expiresAt, me: TradeSide, them: TradeSide & { username } }`;
  - `TradeSide { galaxy: GalaxySummary | null, confirmed: boolean }`;
  - `MyTrades { open, closed (last 20), rules }`.
- **Schemas:**
  - `tradeProposeSchema { username, give: uuid, want?: uuid }`;
  - `tradeOfferSchema { give: uuid | null, want: uuid | null, version }`;
  - `tradeConfirmSchema { version }`.
- **Errors:** `galaxy_in_trade`, `trade_changed`, `trade_gone`, `trade_self`, `trade_limit`, `trade_incomplete`.

### Task 2: Migration and pgTAP

- **`galaxy.trades`:**
  - `id`, `version`, `status` (open, done, cancelled, expired);
  - `a_id`, `b_id`, `a_galaxy`, `b_galaxy`, `a_confirmed`, `b_confirmed`;
  - `created_at`, `expires_at`, `done_at`;
  - checks: done ⇔ both galaxies and both confirmed; a ≠ b.
- **Index:** one open trade per offered galaxy, as two partial unique indexes.
- **pgTAP:** about 10 checks.

### Task 3: Server

- **Routes:**
  - `GET /galaxy/api/trades` (mine);
  - `POST /trades` (propose: my galaxy, optionally the one I want of theirs);
  - `POST /trades/:id/offer` (change what I give or want, with the version);
  - `POST /trades/:id/confirm` (version);
  - `POST /trades/:id/cancel`.
- **The other player's galaxies:** `GET /galaxy/api/profiles/:username/collection` already lists them; «want» uses those ids.
- **Escrow:** `escrow.ts` gets `isTraded`. Every door (equip, exhibit, list, fuse, disintegrate, level, propose) checks it.
- **Locking:** the trade row is locked first, then the galaxies in id order, then the market lock for each side in id order (no cycles).
- **Integration tests:** one for each Review Focus line, plus the gates, the limits, the alerts and expiry.

### Task 4: Web

- **The profile:** another player's profile gets «Proponer trueque». It opens the composer: «Doy» (my galaxy, from the picker) and «Quiero» (one of theirs, from their public collection).
- **The market:** a «Trueques» tab (`?pestana=trueques`) with the open trades.
- **Each trade:** both cards and «Tú das» / «Recibes». The confirmation state says «Confirmado» or «Esperando a …». Actions: «Confirmar», «Cambiar», «Cancelar».
- **A change by the other side** shows «Ha cambiado el trato. Revísalo y confirma de nuevo».
- **Collection:** galaxies in a trade carry the «En trueque» badge.
- **DESIGN_SYSTEM:** §8 quindecies.

### Task 5: e2e, DEPLOY_PRE step 18, verification, review, PR, PRE
