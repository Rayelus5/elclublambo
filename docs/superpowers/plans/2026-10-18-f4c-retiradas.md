# F4c — Retiradas y panel del tesorero — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member can ask to withdraw part or all of their participaciones once SuperAdmin has switched withdrawals on for the network. A treasurer approves at the market formula, which fixes a USDC amount. The forum then verifies the Safe's USDC payout, whether the treasurer pastes the hash or the cron detects it, and burns the shares at finality. Everything is run from a new treasurer panel at `/dao/tesoreria`.

**Architecture:**
- **SQL owns the lifecycle** in `withdrawal_requests`, through SECURITY DEFINER RPCs.
  - The member-side RPCs (request, cancel, reject) run with the member's JWT.
  - Anything that needs an on-chain read runs as service role, called by a server action or the cron after viem has read the chain: quote, approve, record payout, finalize, revert and expire.
- **Approved, unpaid withdrawals are liabilities**, bounded by block exactly like pending donations (F4a-R4). Their locked shares leave the counted supply, so an approval never moves the share price.
- **Payouts are verified with the same rules as donations**, and only an outflow that matches an approved, current request can burn shares.
- **The cron gains two steps per chain**, payout detection and payout finalization, plus one global step that expires stale approvals.

**Tech Stack:** Next.js 16 App Router (cacheComponents, server actions), Supabase Postgres (definer RPCs with `search_path=''`, pgTAP), viem, Vitest + RTL, Playwright on the local Hardhat chain 59141 (mock USDC, WETH and price feed).

**Spec:** `docs/superpowers/specs/2026-10-18-f4-gobernanza-design.md`. Sections: user decisions 1, 4 and 5; my decisions 1 (liabilities and supply), 6, 6b, 7 and 8; §16 "Botón Retirar"; §17; §19; §20 (guide); Comportamiento "Pedir una retirada" and "El tesorero aprueba". Plus the F4a ledger at `.superpowers/sdd/f4a/progress.md`: rulings R1, R4, R5, R7, R10–R12 and "Carry to F4c" (a)–(d).

## Global Constraints
- **Money:** USDC amounts are `numeric(78,0)` with 6 decimals; shares are `numeric(78,0)`. Use `bigint` in TS and never floats. RPCs return large numbers as text.
- **Amount fixed at approval (strict, my decision 6):**
  - `amount_usdc_locked = floor(shares · NAV / S_eff)`.
  - `NAV = greatest(assets_usd6 − _dao_liabilities_usd6(chain, assets_block), 0)`.
  - `S_eff = _dao_supply(chain) = total_shares − approved_locked_shares`. This request is still pending at that point, so its shares are inside `S_eff`.
  - The treasurer cannot adjust the amount.
- **Liabilities (my decision 1):**
  - `_dao_liabilities_usd6(chain, block)` = pending donations (unchanged) + `amount_usdc_locked` of every `approved` request whose payout is not recorded at or before `block`, that is `payout_block is null or payout_block > block`.
  - With `block` null (read paths), every approved request without a payout counts.
  - Expired approvals stop counting (they are `pending` again).
- **Supply:** `dao_state.approved_locked_shares` is the sum of the shares of `approved` requests, including those whose payout is recorded but not yet burned. Every place that divides by "the supply" uses `S_eff`:
  - `credit_donation`
  - `dao_overview` (`sharePriceUsd6`, `myValueUsd6`, `myShareBps`)
  - `dao_ranking`
  - the `total_shares` column written by `record_nav_snapshot`, so `dao_nav_history` stays consistent
  - gating
- **Lock order (no deadlocks):** request row `for update` → `chain_config for share` (when it is read) → `dao_state for update` → `dao_positions`. `request_withdrawal` locks `dao_state` before it inserts.
- **NAV per the F4a rules:** an approval or quote whose `p_assets_block` predates a credited donation's block raises `assets_stale`, the same guard as `credit_donation` (minor 2).
  - Without a valuation (RPC or price down), nothing is fixed (`valuation_unavailable`, TS only).
  - A chain with `nav_initialized = false` raises `nav_not_ready`.
- **Statuses:** `pending | approved | paid | rejected | cancelled` (lowercase).
  - Member-facing labels (exact): `Pendiente`, `Aprobada`, `Pago detectado · esperando finalidad`, `Pagada`, `Rechazada`, `Cancelada`, `Caducada · pendiente de nueva aprobación`.
  - The last one applies when `status = 'pending' and last_expired_at is not null`.
- **Approval expiry:** 14 days after `approved_at`, if no payout is recorded.
  - The request goes back to `pending` with its shares still locked, and stops counting as a liability.
  - `amount_usdc_locked`, `approved_by`, `approved_at` and `self_approved` are cleared, and `last_expired_at` is set to now.
- **Payout match (my decision 6b):**
  - one USDC `Transfer` log from the chain's Safe to `destination_address`;
  - `value ≥ amount_usdc_locked`;
  - receipt `success`, the official USDC contract, `TIP_CONFIRMATIONS` (default 3) confirmations;
  - block time in `[approved_at − 120 s, approved_at + 14 days]`;
  - `(chain_id, tx_hash, log_index)` unique among payouts, and never a `dao_ledger` tx;
  - the request must be `approved` with no payout recorded.
  - Shares burn only once `payout_block ≤ finalized` and a re-verification at finality passes.
- **Gating (my decision 8), read by `_member_dao_standing`:**
  - `share_bps = floor((shares − locked_shares) · 10000 / S_eff)`, or 0 when `S_eff = 0`;
  - `net = locked_shares = 0 ? net_contributed_usdc : floor(net_contributed_usdc · (shares − locked_shares) / shares)`;
  - at the burn, `net_contributed_usdc = greatest(net_contributed_usdc − payout_amount, 0)`.
- **Switch (user decision 5):** `chain_config.withdrawals_enabled boolean not null default false` on both networks; only bit 512 changes it.
  - `request_withdrawal`, `quote_withdrawal` and `approve_withdrawal` need it on.
  - Cancel, reject, payout recording, finalization and expiry do not.
- **Error codes** (SQL raises them; `src/lib/errors.ts` gets the Spanish copy, exact):
  - `withdrawals_disabled`: `Las retiradas no están activadas en esta red.`
  - `withdrawal_exists`: `Ya tienes una retirada en curso. Cancélala o espera a que se resuelva.`
  - `insufficient_shares`: `No tienes tantas participaciones.`
  - `amount_too_small`: `La retirada mínima es de 1 USDC, salvo que retires todas tus participaciones.`
  - `nav_not_ready`: `El fondo aún no tiene valoración. Inténtalo tras la próxima.`
  - `valuation_unavailable`: `No se puede valorar el fondo ahora mismo (precio o red no disponibles). Inténtalo en unos minutos.`
  - `approval_expired`: `La aprobación de esta retirada caducó. Vuelve a aprobarla al precio actual.`
  - `payout_pending`: `La transacción aún no tiene confirmaciones suficientes. Vuelve a intentarlo en un momento.`
  - `reason_required`: `Escribe un motivo de 1 a 280 caracteres.`
  - `safe_changed`: `La Safe de esta red cambió durante la operación. Vuelve a intentarlo.`
  - Reused: `forbidden`, `not_found`, `invalid_input`, `invalid_state`, `assets_stale`, `tx_not_found`, `tx_failed`, `tx_mismatch`, `tx_too_old`, `tx_already_used`, `rpc_unavailable`.
- **Notification kinds** (added to `notifications_kind_check`):
  - `withdrawal_approved` (data `{requestId, amount}`)
  - `withdrawal_rejected` (`{requestId, reason}`)
  - `withdrawal_paid` (`{requestId, amount}`, the amount transferred)
  - `withdrawal_expired` (`{requestId}`)
  - `treasury_notice` (`{event: 'withdrawal_requested' | 'approval_expired', requestId}`), sent to every active holder of bit 256
- **Privacy (my decision 10):**
  - Public feeds and notices never name the person a withdrawal is paid to.
  - In `dao_operations`, a withdrawal payout's `tx_hash` is null for non-treasurers, because the explorer reveals the recipient.
  - Market values are labelled `USD` and paid or fixed amounts `USDC` (R7).
- **Generic project guards** (existing tests enforce them):
  - RLS on with no client policies;
  - every function `security definer set search_path = ''`;
  - `revoke ... from public, anon` (and from `authenticated` for service-only functions);
  - re-create a function by copying its **latest** definition (named per task) and changing only what the task says.
- **UI:**
  - Spanish copy, existing tokens, targets ≥ 44 px, no new dependencies;
  - the slider is a native `<input type="range">`;
  - color is never the only signal.
- **Local DB:** `pnpm db:test` and `pnpm test:e2e` wipe the user's local DB. Run single pgTAP files and `pnpm test:unit` during tasks, and the full suites only where a step says so and the controller has cleared it (memory rule).

## Review Focus
1. **A pasted hash that pays too little, pays the wrong wallet, or was already used** (by another withdrawal or a donation). Expected: refused with `tx_mismatch` or `tx_already_used`; nothing recorded and nothing burned. Tests in Task 4 (SQL) and Task 5 (verification).
2. **The Safe pays a member whose request was cancelled or rejected** (or who never asked). Expected: no burn; the outflow stays `Sin explicar` and alerts the treasurers once. Tests in Task 4 and Task 8.
3. **A donation credited, or a snapshot taken, while a withdrawal is approved but unpaid, and again while its payout is mined but not finalized.** Expected: the share price is unchanged by the withdrawal, and the payout stops counting as a liability from its block on. Tests in Tasks 3 and 4.
4. **An approval that expires while its payout is mined but not yet detected.** Expected: the cron detects payouts before it expires approvals, so a payout mined inside the window is recorded. A hash pasted after expiry gets `approval_expired`. Tests in Tasks 4 and 5.
5. **"Pedir retirada" double-clicked, or the member donates more while a request is pending.** Expected: one request (`withdrawal_exists`). Only the requested shares are locked; the new shares are unlocked and count for gating. Test in Task 2.

---

### Task 1: Carry from F4a — Safe-pinned cron writers, intent lock, cancel open intents, notice cleanup

**Files:**
- Create: `supabase/migrations/20261019300001_f4c_carry.sql`, `supabase/tests/950_f4c_carry.test.sql`
- Modify: `src/lib/treasury/snapshot.ts`, `src/lib/treasury/scan.ts`, `src/lib/economy/actions.ts`, `src/components/economy/economy-form.tsx`, `src/lib/errors.ts`
- Modify callers in `supabase/tests/910_fund_nav.test.sql`, `920_fund_operations.test.sql`, `925_fund_eth_cursor.test.sql`, `930_fund_final_fixes.test.sql`: set `chain_config.safe_address` in setup and pass it.
- Test: `tests/unit/treasury/snapshot.test.ts`, `scan.test.ts` (update); `tests/unit/economy/economy-form.test.tsx` (extend or create)

**Interfaces:**
- Produces (service role). Each one drops the old overload and raises `safe_changed` when `p_safe` is null or `lower(p_safe)` differs from `chain_config.safe_address`, read `for share` before any write:
  - `record_nav_snapshot(p_chain int, p_safe text, p_snapshot jsonb) returns jsonb`. The body is the latest from `20261019100001`.
  - `record_safe_operations(p_chain int, p_safe text, p_ops jsonb, p_to_block bigint) returns jsonb`. The body is the latest from `20261019100003`.
  - `set_dao_eth_cursor(p_chain int, p_safe text, p_block bigint) returns void`. The body is from `20261019100004`.
- Produces (bit 512): `cancel_open_donation_intents(p_chain int) returns int`.
  - Sets `status = 'expired'` on that chain's `pending` donation intents with `hashes_attached_at is null`.
  - Intents with an attached tx keep blocking, because they may be real payments.
  - Writes `audit_log` action `economy.intents_cancelled` with payload `{chain, count}`.
- Modifies:
  - `create_donation_intent(numeric,int,boolean)` (latest `20261019100005`) reads `chain_config ... for share` (carry b).
  - `set_chain_addresses` (latest `20261019100005`): in its reset branch, first delete the **unread** `treasury_outflow` notifications whose `data->>'opId'` belongs to that chain's operations (carry d).
- Produces (TS):
  - `SafeValuation` gains `safe: Address`.
  - `takeSnapshot` and `scanSafeOperations` pass the Safe they read.
  - `cancelOpenDonationIntentsAction(chain: number): Promise<{ error?: string; count?: number }>` in `src/lib/economy/actions.ts`.

- [ ] **Step 1: Write the failing pgTAP test** `950_f4c_carry.test.sql`:
  1. The old signatures `record_nav_snapshot(int,jsonb)`, `record_safe_operations(int,jsonb,bigint)` and `set_dao_eth_cursor(int,bigint)` no longer exist.
  2. Each new writer called with a Safe different from `chain_config` raises `safe_changed`, as does a call with null. With the configured Safe in any letter case, the call succeeds.
  3. `pg_get_functiondef('public.create_donation_intent(numeric,int,boolean)'::regprocedure) ~ 'for share'`.
  4. `cancel_open_donation_intents(59141)`:
     - a non-512 member gets `forbidden`;
     - as SuperAdmin, with one unattached and one attached pending intent, it returns `1`;
     - the attached intent still makes `set_chain_addresses` raise `safe_change_blocked`;
     - an `audit_log` row `economy.intents_cancelled` exists.
  5. A Safe change that resets the chain deletes the unread `treasury_outflow` notices for its operations and keeps the read ones.
- [ ] **Step 2: Run, verify it fails.** Run `pnpm exec supabase test db supabase/tests/000_helpers.test.sql supabase/tests/950_f4c_carry.test.sql`. Expected: FAIL.
- [ ] **Step 3: Write the migration** and update the callers in 910/920/925/930. Then run those four files and 950. Expected: PASS.
- [ ] **Step 4: Failing unit tests:**
  - `takeSnapshot` calls `record_nav_snapshot` with `p_safe` equal to the address `valueSafe` read.
  - `scanSafeOperations` passes the same `p_safe` to `record_safe_operations` and `set_dao_eth_cursor`.
  - When `setChainAddressesAction` returns `safe_change_blocked`, the economy form shows the button `Cancelar pagos de donación abiertos` with the help text `Cancela los pagos de donación que aún no tienen transacción. Si alguien está pagando justo ahora, su donación no se acreditará sola.`
  - Clicking the button calls the action, and the form shows `{n} pagos cancelados. Vuelve a guardar la Safe.`
- [ ] **Step 5: Implement, then run** `pnpm test:unit` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(dao): pin cron writers to the configured Safe, lock chain_config on donation intents, cancel open intents (F4a carry)`.

### Task 2: SQL — withdrawal requests, per-network switch, locked shares and gating

**Files:**
- Create: `supabase/migrations/20261019300002_withdrawals.sql`, `supabase/tests/951_withdrawals.test.sql`

**Interfaces:**
- Schema:
  - `withdrawal_requests`. Columns:
    - `id uuid pk`, `chain_id int` (check in 59144/59141), `member_id uuid → members`
    - `shares numeric(78,0)` (> 0), `status text` (default `'pending'`, check in the five statuses)
    - `amount_usdc_locked numeric(78,0)` (null or > 0), `destination_address text` (null or `^0x[0-9a-f]{40}$`)
    - `approved_by uuid → members`, `approved_at timestamptz`, `self_approved boolean not null default false`, `approval_count int not null default 0`, `last_expired_at timestamptz`
    - `rejected_by uuid`, `rejected_at`, `reject_reason text` (1–280 characters)
    - `cancelled_at`
    - `payout_tx_hash text` (`^0x[0-9a-f]{64}$`), `payout_log_index int`, `payout_block bigint`, `payout_amount numeric(78,0)`, `payout_recorded_at`, `payout_recorded_by uuid` (null means auto-detected)
    - `paid_at`, `created_at`, `updated_at`
  - `withdrawal_requests` checks:
    - `(status in ('approved','paid')) = (amount_usdc_locked is not null and approved_at is not null and destination_address is not null)`
    - `(status = 'paid') = (paid_at is not null)`
    - the payout columns are all null or all set, and set implies `status in ('approved','paid')`
    - `status = 'paid'` implies the payout columns are set
  - `withdrawal_requests` indexes:
    - unique `(chain_id, member_id) where status in ('pending','approved')`
    - unique `(chain_id, payout_tx_hash, payout_log_index) where payout_tx_hash is not null`
    - `(chain_id, status, created_at)`
  - `withdrawal_requests` has RLS on and no client access.
  - `dao_positions.locked_shares numeric(78,0) not null default 0`, check `0 ≤ locked_shares ≤ shares`.
  - `dao_state.approved_locked_shares numeric(78,0) not null default 0`, check `≤ total_shares − club_shares`.
  - `chain_config.withdrawals_enabled boolean not null default false`. The legacy `app_config.withdrawals_enabled` key is left untouched and unused (test `010` pins it).
  - `dao_safe_operations.withdrawal_id uuid null references withdrawal_requests`, filled in Task 4.
  - Trigger `withdrawal_requests_broadcast`, after insert or update of `status`, calls `broadcast_dao_event()`. Extend that function with a `withdrawal_requests` branch that uses `new.chain_id`; its latest definition is in `20261019000001`.
  - `notifications_kind_check` = the latest list from `20261019100002` plus the five F4c kinds.
- Produces (bit 512): `set_withdrawals_enabled(p_chain int, p_enabled boolean) returns void`. It raises `chain_invalid` for an unknown chain and writes `audit_log` action `economy.withdrawals` with payload `{chain, old, new}`.
- Produces (members):
  - `request_withdrawal(p_shares numeric) returns uuid`. It applies to the active chain.
    - Requires an active member, else `forbidden`, and the switch on, else `withdrawals_disabled`.
    - `p_shares` must be an integer > 0, else `invalid_input`, and `≤ dao_positions.shares`, else `insufficient_shares`.
    - Either `p_shares` equals the whole position, or `floor(p_shares · value_usdc / S_eff) ≥ 1_000000`; otherwise `amount_too_small`.
    - An existing active request raises `withdrawal_exists`, caught from the unique violation and also checked up front.
    - It sets `dao_positions.locked_shares = p_shares` and notifies the treasurers with `treasury_notice` `{event: 'withdrawal_requested', requestId}`.
  - `cancel_withdrawal(p_request uuid) returns void`.
    - Only the owner, else `not_found`, and only while `pending`, else `invalid_state`.
    - Sets `cancelled_at` and `locked_shares = 0`.
  - `dao_overview()` (latest `20261019100001`) gains these keys:
    - `withdrawalsEnabled` (bool, active chain), `supplyShares` (S_eff as text), `myLockedShares` (text)
    - `myWithdrawal`: the active request, else the newest request closed in the last 14 days, else null. Shape: `{id, status, shares, amountUsdc|null, approvedAt|null, expiresAt|null (approved_at + 14 d), payoutRecorded: bool, payoutTxHash|null, rejectReason|null, lastExpiredAt|null, createdAt}`.
    - `sharePriceUsd6`, `myValueUsd6` and `myShareBps` divide by `S_eff`. `myValueUsd6` and `myShareBps` use `myShares − (shares of my approved request)`.
  - `dao_ranking(int)` (latest `20261019100001`): each holder's shares minus their approved-locked shares, over `S_eff`.
- Produces (internal): `_dao_supply(p_chain int) returns numeric`.
- Modifies: `_member_dao_standing` (latest `20261018800002`) per the gating formulas in the Global Constraints.

- [ ] **Step 1: Write the failing pgTAP test** `951_withdrawals.test.sql`. The setup seeds positions directly as service role.
  1. **Grants:** `request_withdrawal`, `cancel_withdrawal` and `set_withdrawals_enabled` are not executable by `anon`. `_dao_supply` is not executable by `authenticated`.
  2. **Switch:**
     - `request_withdrawal` with the switch off raises `withdrawals_disabled`;
     - a bit-256-only member calling `set_withdrawals_enabled` gets `forbidden`;
     - SuperAdmin turns it on for 59141, and an `economy.withdrawals` audit row exists;
     - 59144 stays off.
  3. **Request:** A holds `10·10¹⁸` shares, with `value_usdc = 10_000000` and `S = 10·10¹⁸`.
     - Requesting `4·10¹⁸` returns an id with status `pending`, and `locked_shares = 4·10¹⁸`;
     - every treasurer received a `treasury_notice`;
     - a second request raises `withdrawal_exists`;
     - requesting `11·10¹⁸` raises `insufficient_shares`, and `0` raises `invalid_input`;
     - requesting `10¹⁷` (0,1 USD, not the whole position) raises `amount_too_small`.
  4. **Gating:** a channel gated `min_net_usdc = 7_000000` (view scope) and A's net of `10_000000`.
     - With the pending request, `gate_passes` is false: `10 · 6/10 = 6 < 7`;
     - `channel_lock_state` shows `myShareBps = 6000`;
     - after `cancel_withdrawal`, `gate_passes` is true and `locked_shares = 0`.
  5. **Cancel rules:** B cancelling A's request gets `not_found`. Cancelling a request forced to `approved` (seeded) raises `invalid_state`.
  6. **Donate while pending:** A requests 100 %, then a credited donation adds shares. `locked_shares` still equals the requested amount, and `share_bps` counts the new shares as unlocked.
  7. **Supply:** seed `approved_locked_shares = 4·10¹⁸` with a matching approved request.
     - `_dao_supply = 6·10¹⁸`;
     - `dao_overview().sharePriceUsd6` uses `S_eff`;
     - `dao_ranking()` gives A `(shares − 4·10¹⁸) / S_eff`.
  8. **`dao_overview().myWithdrawal`:** status, shares and `expiresAt = approvedAt + 14 days` for the seeded approved request; `withdrawalsEnabled = true`.
  9. **Realtime:** inserting a request sends one `dao_changed` broadcast. Assert it like `860_dao_realtime`.
- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Write the migration.** `economy_config()` also returns `withdrawalsEnabled` per chain under `chains[id]`.
- [ ] **Step 4: Run 951, then 810, 830, 860, 910 and 930.** Expected: PASS. The gating and overview files must not regress.
- [ ] **Step 5: Commit** `feat(dao): withdrawal requests with locked shares, per-network switch and unlocked-share gating (SQL)`.

### Task 3: SQL — approval at NAV, rejection, expiry, liabilities and supply, treasurer reads, push copy

**Files:**
- Create: `supabase/migrations/20261019300003_withdrawal_approval.sql`, `supabase/tests/952_withdrawal_approval.test.sql`

**Interfaces:**
- Consumes: Task 2 schema and `_dao_supply`.
- Modifies:
  - `_dao_liabilities_usd6(int,bigint)` per the Global Constraints.
  - `credit_donation(uuid,numeric,bigint)` (latest `20261019100005`): `v_total := _dao_supply(chain)`. When it is 0, the empty-fund branch applies, and the club takes the leftover NAV (user decision 9). It still adds to `total_shares`.
  - `record_nav_snapshot(int,text,jsonb)` (latest from Task 1) stores `_dao_supply(chain)` after the club mint in `total_shares`.
- Produces (service role):
  - `quote_withdrawal(p_request uuid, p_safe text, p_assets_usd6 numeric, p_assets_block bigint) returns jsonb`.
    - Returns `{amountUsdc, navUsd6, supplyShares, reservedUsdc}`; `reservedUsdc` is the sum of `amount_usdc_locked` over approved requests without a payout on the chain.
    - Read-only, with the same checks as approve.
  - `approve_withdrawal(p_request uuid, p_actor uuid, p_safe text, p_assets_usd6 numeric, p_assets_block bigint) returns jsonb`. Returns `{amountUsdc, selfApproved}`. Checks, in order:
    - actor active with bit 256, else `forbidden`;
    - request `pending`, else `invalid_state`;
    - switch on, else `withdrawals_disabled`;
    - `safe_changed`;
    - `nav_not_ready`;
    - `assets_stale`;
    - amount 0, or `< 1_000000` when the request is not the whole position, raises `amount_too_small`.
    - On success it sets `status = 'approved'`, `amount_usdc_locked`, `destination_address` (the member's `wallet_address`, lowercased), `approved_by`, `approved_at = now()`, `self_approved = (p_actor = member_id)` and `approval_count + 1`, and adds the shares to `approved_locked_shares`.
    - It writes `audit_log` action `withdrawal_approved` with payload `{request, amount, selfApproved, navUsd6, supplyShares, assetsBlock}` and notifies the member with `withdrawal_approved`.
  - `expire_withdrawal_approvals() returns int`.
    - Expires approved requests with no payout and `approved_at < now() − 14 days`, per the Global Constraints, and subtracts their shares from `approved_locked_shares`.
    - Notifies the member with `withdrawal_expired`, and the treasurers with `treasury_notice` `{event: 'approval_expired'}`.
- Produces (members with bit 256):
  - `reject_withdrawal(p_request uuid, p_reason text) returns void`.
    - The trimmed reason must be 1–280 characters, else `reason_required`.
    - Allowed from `pending`, or from `approved` with no payout recorded; otherwise `invalid_state`.
    - Releases the locks (subtracting from `approved_locked_shares` if it was approved), sets the `rejected_*` columns, writes audit `withdrawal_rejected` and notifies the member with `withdrawal_rejected`.
  - `treasury_withdrawals() returns table (id uuid, member_id uuid, member_label text, wallet text, shares text, position_shares text, status text, created_at timestamptz, approved_at timestamptz, expires_at timestamptz, approved_by_label text, self_approved boolean, amount_usdc text, estimate_usd6 text, last_expired_at timestamptz, reject_reason text, payout_tx_hash text, payout_amount text, payout_recorded_at timestamptz, paid_at timestamptz)`.
    - Active chain only. Returns the `pending` and `approved` requests, plus requests closed in the last 30 days.
    - `estimate_usd6 = floor(shares · value_usdc / S_eff)`; the treasurer sees the real label even for a hidden donor.
- Modifies: `_push_build` (latest `20261019100002`).
  - The `treasury_outflow` url becomes `/dao/tesoreria` (R1).
  - `treasury_notice` is gated on `256 | 512`.
  - New branches:
    - `withdrawal_approved`: title `Retirada aprobada`, body `Tu retirada de <amount> USDC está aprobada. El tesorero la pagará desde la Safe.`, url `/dao#retirada`
    - `withdrawal_rejected`: title `Retirada rechazada`, body `El tesorero rechazó tu retirada: «<reason, control chars stripped, ≤ 80>»`, url `/dao#retirada`
    - `withdrawal_paid`: title `Retirada pagada`, body `Has recibido <amount> USDC de la tesorería.`, url `/dao#retirada`
    - `withdrawal_expired`: title `Aprobación caducada`, body `Tu retirada no se pagó en 14 días y vuelve a estar pendiente de aprobación.`, url `/dao#retirada`
    - `treasury_notice`: title `Aviso de tesorería`, body `Hay una nueva solicitud de retirada.` or `Una retirada aprobada caducó sin pagarse.`, url `/dao/tesoreria`. An unknown event returns no row.
  - Format amounts with `_format_token_amount(..., 'USDC')`. A malformed amount returns no row, like `treasury_outflow`.

- [ ] **Step 1: Write the failing pgTAP test** `952_withdrawal_approval.test.sql`:
  1. **Grants:** `quote_withdrawal`, `approve_withdrawal` and `expire_withdrawal_approvals` are executable only by `service_role`. `reject_withdrawal` and `treasury_withdrawals` are not executable by `anon`.
  2. **Formula:** `S = 10·10¹⁸`, assets `20_000000` at block 100, no other liability, A requests `4·10¹⁸`.
     - `quote_withdrawal` gives `amountUsdc = 8_000000` and changes nothing;
     - `approve_withdrawal` fixes `8_000000`, `destination_address` = A's wallet and `approved_locked_shares = 4·10¹⁸`;
     - A has one `withdrawal_approved` notice;
     - an audit row with `selfApproved = false` exists.
  3. **Price unchanged:** after approval, `_dao_liabilities_usd6(59141, 100) = 8_000000` and `_dao_supply = 6·10¹⁸`. `dao_overview().sharePriceUsd6` with a NAV of `12_000000` equals the price before (`2_000000`).
  4. **Donation during approval:** crediting `d = 2_000000` with assets `22_000000` at block 101 mints `floor(2_000000 · 6·10¹⁸ / 12_000000) = 10¹⁸` shares, the same price.
  5. **Snapshot:** `record_nav_snapshot` stores `total_shares = S_eff` and `liabilities_usd6` including the `8_000000`.
  6. **Self-approval:** the treasurer approves their own request, giving `selfApproved = true`. `treasury_withdrawals()` shows `self_approved` and the audit payload says so.
  7. **Guards:**
     - switch off → `withdrawals_disabled`;
     - a non-256 actor → `forbidden`;
     - a different Safe → `safe_changed`;
     - an assets block older than a credited donation → `assets_stale`;
     - `nav_initialized = false` → `nav_not_ready`;
     - approving an approved request → `invalid_state`;
     - assets small enough that a partial request is worth `< 1_000000` → `amount_too_small`.
  8. **Reject:**
     - an empty reason gives `reason_required`;
     - rejecting an approved request releases `locked_shares` and `approved_locked_shares`;
     - the member gets `withdrawal_rejected`, and the request is listed as `rejected` with its reason.
  9. **Expiry:** an approval aged 15 days → `expire_withdrawal_approvals() = 1`.
     - The request is `pending` with `last_expired_at` set, `amount_usdc_locked` null, `locked_shares` kept and `approved_locked_shares` back to 0;
     - the liability is gone;
     - the member and the treasurers are notified;
     - a 13-day approval is untouched.
  10. **Push:** `_push_build` returns the exact titles, bodies and urls above for one row of each new kind. `treasury_outflow` now gives the url `/dao/tesoreria`. `treasury_notice` returns nothing for a recipient without 256.
- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run 952, 951, 910, 920 and 930.** Expected: PASS. 920's push-url assertion changes to `/dao/tesoreria`.
- [ ] **Step 5: Commit** `feat(dao): approve withdrawals at market NAV as liabilities, reject, 14-day expiry and treasurer reads (SQL)`.

### Task 4: SQL — payout recording, outflow matching, burn at finality, revert

**Files:**
- Create: `supabase/migrations/20261019300004_withdrawal_payouts.sql`, `supabase/tests/953_withdrawal_payouts.test.sql`

**Interfaces:**
- Produces (service role):
  - `record_withdrawal_payout(p_request uuid, p_safe text, p_payout jsonb, p_actor uuid) returns jsonb` → `{"status": "recorded" | "already"}`.
    - `p_payout = {txHash, logIndex, blockNumber, blockTime (iso), to, amount}`, all integers as text.
    - `p_actor` is null for auto-detection; otherwise it must be an active member with bit 256, else `forbidden`.
    - The checks follow the payout-match rule:
      - `safe_changed`;
      - `to ≠ destination_address` or `amount < amount_usdc_locked` gives `tx_mismatch`;
      - a block time before `approved_at − 120 s` gives `tx_too_old`;
      - a block time after `approved_at + 14 d` gives `approval_expired`;
      - a request that is not `approved` gives `approval_expired` if `last_expired_at` is set, else `invalid_state`;
      - a tx/log on another request or in `dao_ledger` gives `tx_already_used`;
      - the same tx/log already on this request returns `already`.
    - Sets the `payout_*` columns and links the matching `dao_safe_operations` row (same chain, tx, log, `USDC`, `out`) through `withdrawal_id`. With an actor, writes audit `withdrawal_payout_recorded`.
  - `finalize_withdrawal(p_request uuid, p_safe text, p_finalized_block bigint) returns jsonb` → `{"status": "paid" | "pending" | "already"}`.
    - Returns `pending` when no payout is recorded or `payout_block > p_finalized_block`.
    - Otherwise it burns, under the `dao_state` lock:
      - `status = 'paid'`, `paid_at = now()`;
      - `dao_positions.shares −= shares`, `locked_shares = 0`, `net_contributed_usdc = greatest(net − payout_amount, 0)`;
      - `dao_state.total_shares −= shares`, `approved_locked_shares −= shares`; `value_usdc` is unchanged.
    - Notifies the member with `withdrawal_paid` and `amount = payout_amount`.
  - `revert_withdrawal_payout(p_request uuid) returns void`.
    - Only `approved` requests with a payout recorded, else `invalid_state`.
    - Clears the `payout_*` columns and unlinks the operation (`withdrawal_id = null`, so it becomes unexplained).
  - `withdrawal_payout_candidates(p_chain int) returns table (request_id uuid, tx_hash text, log_index int, destination text, amount_usdc_locked text, approved_at timestamptz)`. It lists linked operations whose request is `approved` with no payout recorded.
  - `withdrawals_awaiting_finality(p_chain int) returns table (request_id uuid, tx_hash text, destination text, amount_usdc_locked text, approved_at timestamptz, payout_block text, payout_recorded_at timestamptz)`.
- Modifies `record_safe_operations(int,text,jsonb,bigint)` (latest from Task 1). Before alerting on a new `USDC` `out` operation, it looks for an `approved` request on that chain:
  - no payout recorded;
  - `destination_address = counterparty`;
  - `amount ≥ amount_usdc_locked`;
  - `occurred_at ≥ approved_at − 120 s`.
  - On a match it sets `withdrawal_id` and sends **no** `treasury_outflow`. Any other outflow alerts as before.
- Modifies `dao_operations(int)` (latest `20261019100003`; the signature is unchanged):
  - `explained` also holds when `withdrawal_id is not null`;
  - `note` is `coalesce(note, 'Retirada de un miembro')` for linked rows;
  - `tx_hash` of linked rows is null unless the caller has bit 256.

- [ ] **Step 1: Write the failing pgTAP test** `953_withdrawal_payouts.test.sql`. The setup approves A for `8_000000` with the Safe configured.
  1. **Grants:** all five new functions are service-only.
  2. **Matching scan:** `record_safe_operations` with a USDC out of `8_000000` to A's wallet after `approved_at` inserts the operation with `withdrawal_id`, and no treasurer gets `treasury_outflow`. `withdrawal_payout_candidates(59141)` lists it.
  3. **Non-matching outflows alert:**
     - `7_999999` to A;
     - `8_000000` to B;
     - an outflow to C whose request was cancelled;
     - a transfer dated before `approved_at − 120 s`.
     - Each one gets no `withdrawal_id` and one alert per treasurer.
  4. **Record:**
     - a payout of `8_500000` (overpaid) is `recorded`, and the same call again returns `already`;
     - `_dao_liabilities_usd6(59141, payout_block − 1) = 8_000000` and `_dao_liabilities_usd6(59141, payout_block) = 0`;
     - `_dao_supply` still excludes the locked shares.
  5. **Record guards:**
     - wrong `to` or `amount < locked` → `tx_mismatch`;
     - an early block time → `tx_too_old`;
     - a block time after 14 days → `approval_expired`;
     - an expired request (pending with `last_expired_at`) → `approval_expired`;
     - a tx/log equal to a `dao_ledger` donation → `tx_already_used`;
     - a tx/log already used by another request → `tx_already_used`;
     - a different Safe → `safe_changed`;
     - a non-256 actor → `forbidden`.
  6. **Expiry skips recorded payouts:** with `approved_at` aged 15 days, `expire_withdrawal_approvals()` leaves a request with a recorded payout `approved`.
  7. **Finalize:**
     - with `p_finalized_block < payout_block`, it returns `pending`;
     - at or after `payout_block`, it returns `paid`;
     - A's shares drop by the request's shares, `locked_shares = 0` and `net = greatest(10_000000 − 8_500000, 0)`;
     - `total_shares` and `approved_locked_shares` drop, and `value_usdc` is unchanged;
     - A has a `withdrawal_paid` notice with amount `8500000`;
     - a second call returns `already`.
  8. **Revert:** on another approved request with a recorded payout, `revert_withdrawal_payout` clears the payout, the operation's `withdrawal_id` is null, and `dao_operations()` shows it with `explained = false`.
  9. **Public feed:**
     - a linked payout shows to a plain member with note `Retirada de un miembro`, `explained = true` and `tx_hash` null;
     - a treasurer sees the hash;
     - no column names the counterparty.
- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run 953, 952, 951, 920 and 950.** Expected: PASS. Then run `pnpm db:test` once, if the controller allows it.
- [ ] **Step 5: Commit** `feat(dao): verified withdrawal payouts — outflow matching, burn at finality, revert (SQL)`.

### Task 5: Server — payout verification, withdrawal actions and cron steps

**Files:**
- Modify: `src/lib/payments/verify.ts`, `src/lib/errors.ts` (the F4c codes), `src/app/api/cron/dao/route.ts`
- Create: `src/lib/treasury/payouts.ts`, `src/lib/treasury/withdrawal-actions.ts`, `src/lib/treasury/withdrawals.ts`
- Test: `tests/unit/payments/verify.test.ts` (extend), `tests/unit/treasury/payouts.test.ts`, `tests/unit/treasury/withdrawal-actions.test.ts`, `tests/unit/treasury/withdrawals.test.ts`, `tests/unit/treasury/cron-route.test.ts` (update)

**Interfaces:**
- Consumes: the Task 3 and Task 4 RPCs, `valueSafe` (with `safe`), `defaultConfirmations`.
- Produces in `verify.ts`:
  - `VerifyInput` gains `atLeast?: boolean`. For USDC only, the match becomes `value >= amount` on the first log in log order.
  - The `ok` result gains `value: bigint`: the matched log's value, or `tx.value` for ETH.
- Produces in `withdrawals.ts` (isomorphic parsing):
  - `type WithdrawalStatus = "pending" | "approved" | "paid" | "rejected" | "cancelled"`
  - `interface MyWithdrawal { id; status; shares: bigint; amountUsdc: bigint | null; approvedAt: string | null; expiresAt: string | null; payoutRecorded: boolean; payoutTxHash: string | null; rejectReason: string | null; lastExpiredAt: string | null; createdAt: string }`
  - `withdrawalLabel(w: MyWithdrawal): string`, returning the exact labels from the Global Constraints
  - `interface TreasuryWithdrawal` (the camel-cased `treasury_withdrawals` row, amounts as bigint)
  - `getTreasuryWithdrawals(supabase): Promise<TreasuryWithdrawal[]>`
  - `DaoOverview` (in `queries.ts`) gains `withdrawalsEnabled: boolean`, `supplyShares: bigint`, `myLockedShares: bigint` and `myWithdrawal: MyWithdrawal | null`
  - `sharesForBps(myShares: bigint, bps: number): bigint`. Returns `myShares` at 10000, else `myShares · bps / 10000`.
  - `parsePercent(text: string): number | null`. Accepts `"12,5"` or `"12.5"` with up to 2 decimals in `(0, 100]`, and returns bps from 1 to 10000.
  - `estimateUsdc(shares: bigint, sharePriceUsd6: bigint): bigint` = `shares · sharePriceUsd6 / 10¹⁸`.
- Produces in `payouts.ts` (server-only):
  - `type PayoutTarget = { chain: ChainId; safe: Address; destination: string; amountLocked: bigint; approvedAt: Date }`
  - `verifyPayout(t: PayoutTarget, txHash: \`0x${string}\`): Promise<VerifyResult>` calls `verifyTransfer({ chain, token: "USDC", txHash, from: safe, to: destination, amount: amountLocked, atLeast: true, notBefore: approvedAt })`.
  - `detectWithdrawalPayouts(chain: ChainId): Promise<{ recorded: number }>`. For each candidate, it verifies and then records with `p_actor null`.
  - `finalizeWithdrawalPayouts(chain: ChainId): Promise<{ paid: number; reverted: number; pending: number }>`.
    - Re-verifies when `payout_block ≤ finalized`, then finalizes.
    - Reverts on `tx_failed` or `tx_mismatch`, or on `tx_not_found` once `payout_recorded_at` is older than 30 minutes.
    - Anything else stays pending.
  - `expireWithdrawalApprovals(): Promise<number>`.
- Produces in `withdrawal-actions.ts` (`"use server"`; each returns `{ ok: true, ... } | { ok: false; code; error }` like `actions.ts`):
  - `requestWithdrawalAction({ shares: string })` → `{ ok: true; id: string }`
  - `cancelWithdrawalAction(id: string)`
  - `quoteWithdrawalAction(id: string)` → `{ ok: true; quote: { amountUsdc: string; safeUsdc: string; availableUsdc: string; destination: string; selfApproval: boolean } }`, where `availableUsdc = max(safeUsdc − reservedUsdc, 0)`
  - `approveWithdrawalAction(id: string)` → `{ ok: true; amountUsdc: string }`
  - `rejectWithdrawalAction(id: string, reason: string)`
  - `markWithdrawalPaidAction(id: string, txHash: string)` → `{ ok: true; status: "recorded" | "already" }`
  - `setWithdrawalsEnabledAction(chain: number, enabled: boolean)`
  - The treasurer actions check `hasPerm(my_permissions, MANAGE_TREASURY)` before any service-role call (`forbidden`); SQL re-checks through `p_actor`.
  - Quote and approve take the request's chain, call `valueSafe`, return `valuation_unavailable` on null, and retry `assets_stale` once with a fresh valuation.
  - `markWithdrawalPaidAction` maps a verify `pending` result to `payout_pending`.
  - Every action calls `revalidatePath("/dao")` and `revalidatePath("/dao/tesoreria")`.
- Modifies the cron:
  - Per chain with a Safe: snapshot → scan → `payouts` (detect, then finalize) → settle.
  - After the chain loop: `expiredApprovals` = `expireWithdrawalApprovals()`, or `"failed"`.
  - `ChainReport` gains `payouts?: { recorded; paid; reverted; pending } | "failed"`.

- [ ] **Step 1: Failing tests:**
  - **verify:** with `atLeast`, a log of `8_500000` for an amount of `8_000000` gives `ok` with `value 8_500000n`, and `7_999999` gives `tx_mismatch`. Without `atLeast`, an exact match is still required (existing tests unchanged). A log from another token contract gives `tx_mismatch`.
  - **withdrawals:**
    - `parsePercent("12,5") === 1250`;
    - `"0"`, `"100,01"`, `"1,234"` and `"abc"` give `null`;
    - `sharesForBps(10n**19n, 10000) === 10n**19n`;
    - `estimateUsdc(4n*10n**18n, 2_000000n) === 8_000000n`;
    - `withdrawalLabel` of pending with `lastExpiredAt` is `Caducada · pendiente de nueva aprobación`, and of approved with `payoutRecorded` is `Pago detectado · esperando finalidad`.
  - **payouts:**
    - detect: a verified candidate calls `record_withdrawal_payout` with `p_actor: null` and the verified `value`, `logIndex`, `blockNumber` and `blockTimestamp`. A `pending` verification records nothing.
    - finalize: a payout above the finalized block is not verified; at finality `finalize_withdrawal` is called; `tx_mismatch` reverts; `tx_not_found` reverts only when recorded more than 30 minutes ago.
  - **actions:**
    - a non-treasurer gets `forbidden` and no admin client is created;
    - `valueSafe` returning null gives `valuation_unavailable`;
    - `assets_stale` is retried exactly once;
    - `approveWithdrawalAction` passes `p_actor` = the caller's member id and `p_safe` = the valuation's Safe;
    - `markWithdrawalPaidAction` rejects a malformed hash with `invalid_input` without an RPC call, and maps verify `pending` to `payout_pending`;
    - `requestWithdrawalAction` rejects a non-integer share string with `invalid_input`.
  - **cron:** the step order per chain is snapshot, scan, payouts, settle; expiry runs once after the loop; a throwing payouts step reports `"failed"` while the others still run. **Review Focus 4:** detect runs before expiry.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/payments/verify.test.ts tests/unit/treasury`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test:unit` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(dao): payout verification (at least the fixed amount), withdrawal server actions and cron payout/expiry steps`.

### Task 6: UI — "Retirar" on /dao, withdrawal status and guide

**Files:**
- Create: `src/components/treasury/withdraw-button.tsx`, `src/components/treasury/withdraw-dialog.tsx`, `src/components/treasury/withdrawal-status.tsx`
- Modify: `src/components/treasury/dao-overview.tsx` (new `withdraw?: ReactNode` slot inside the position block, wrapped in `id="retirada"` and `scroll-mt-20`), `src/app/(forum)/dao/page.tsx`, `src/lib/treasury/queries.ts` (parse the Task 2 keys), `src/components/guide/guide-content.tsx`
- Test: `tests/unit/treasury/withdraw-dialog.test.tsx`, `withdrawal-status.test.tsx`, `dao-overview.test.tsx` (extend), `tests/unit/guide/*` (extend)

**Interfaces:**
- Consumes: `DaoOverview.withdrawalsEnabled | myWithdrawal | myShares | myLockedShares | sharePriceUsd6`, the Task 5 helpers and the actions `requestWithdrawalAction` and `cancelWithdrawalAction`.
- Produces:
  - `WithdrawButton({ myShares: bigint; sharePriceUsd6: bigint })`
  - `WithdrawDialog({ open; onOpenChange; myShares; sharePriceUsd6 })`
  - `WithdrawalStatus({ withdrawal: MyWithdrawal; chainId: ChainId })`

- [ ] **Step 1: Failing tests:**
  - **The button:**
    - it renders only when `withdrawalsEnabled && myShares > 0 && no active request`;
    - with the switch off there is no button and no extra copy;
    - with an active request, `WithdrawalStatus` shows instead.
  - **The dialog:** title `Retirar participaciones`.
    - It has a range input labelled `Porcentaje a retirar` (min 1, max 100, step 1) and a text field labelled `Porcentaje (%)`, kept in sync. Typing `12,5` sets the slider to 12.5, and `100` selects everything.
    - With `myShares = 10·10¹⁸` and `sharePriceUsd6 = 2_000000` at 40 %, it shows `≈ 8 USDC al valor actual. El importe final se fija cuando el tesorero aprueba la retirada.`
    - It always shows `Tus participaciones quedan bloqueadas desde que confirmas: dejan de contar para los canales con candado. Las retiradas dependen de la disponibilidad y de la decisión del tesorero.`
    - `Pedir retirada` calls `requestWithdrawalAction` with `{ shares: "4000000000000000000" }` and disables itself while it is pending, so a double click sends one call. An error shows the mapped Spanish copy in `role="alert"`.
  - **`WithdrawalStatus`:**
    - `Pendiente` plus `Cancelar solicitud`, which calls `cancelWithdrawalAction`;
    - approved: `Aprobada · importe fijado: 8 USDC` and `Caduca el <fecha>`, with no cancel button;
    - payout recorded: `Pago detectado · esperando finalidad`;
    - paid: `Pagada` plus an explorer link to the payout tx;
    - rejected: `Rechazada: <motivo>`;
    - cancelled: `Cancelada`;
    - expired: `Caducada · pendiente de nueva aprobación`, with `Cancelar solicitud`;
    - the status is shown in text, never only by color.
  - **DaoOverview:** with an approved request, `Tu parte` shows `myValueUsd6` (unlocked part, in USD) and a line `Retirada aprobada: 8 USDC` (R7: the fixed amount is USDC).
  - **Guide:**
    - the `fondo` section gains the subsection `Cómo pedir una retirada`, which mentions that withdrawals are switched on per network by SuperAdmin, `14 días`, shares blocked from the request and paid in USDC;
    - the `dao` section no longer contains `Hoy las aportaciones no se pueden retirar`.
- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Implement.** Use the `@/components/ui/dialog` pattern of `TipDialog`. Do bigint math only through the Task 5 helpers. Load `ui-ux-pro-max` before styling (project rule).
- [ ] **Step 4: Run** `pnpm test:unit`, `pnpm typecheck` and `pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(dao): request and track withdrawals on /dao (percentage slider, USDC estimate, states) and the guide`.

### Task 7: UI — /dao/tesoreria panel, switch, in-app notifications, R1

**Files:**
- Create: `src/app/(forum)/dao/tesoreria/page.tsx`, `src/components/treasury/treasurer/withdrawals-table.tsx`, `approve-dialog.tsx`, `reject-dialog.tsx`, `mark-paid-dialog.tsx`, `withdrawals-switch.tsx`, `treasury-alerts.tsx`
- Modify:
  - `src/app/(forum)/dao/page.tsx`: a `Panel del tesorero` link for bit 256.
  - `src/lib/notifications/queries.ts` and `src/components/notifications/notification-item.tsx`: the five kinds, and `treasury_outflow` → `/dao/tesoreria` (R1).
  - `src/lib/economy/config.ts`: `withdrawalsEnabled` per chain.
- Test: `tests/unit/treasury/treasurer-panel.test.tsx`, `approve-dialog.test.tsx`, `mark-paid-dialog.test.tsx`, `withdrawals-switch.test.tsx`, `tests/unit/notifications/withdrawal-notification.test.tsx`, `queries.test.ts` (update the R1 href)

**Interfaces:**
- Consumes:
  - `getTreasuryWithdrawals`
  - `getOperations` (unexplained rows, reusing `OperationsList` with `canNote`)
  - the Task 5 actions
  - `readSafeAssets`, for the live Safe USDC shown in the header; when the read fails, the latest snapshot's `usdcUnits`, labelled with its time
- Produces: the page layout. Sections are `<section>` elements with an `h2` each, so F4d can append `Sorteos`.
  - The page is guarded by `hasPerm(my_permissions, MANAGE_TREASURY)`, else `notFound()`, and lives inside `Suspense` like `/dao`. `DaoLive` re-renders it.
  - Section order:
    1. `Retiradas pendientes`
    2. `Retiradas aprobadas`
    3. `Avisos`
    4. `Operaciones sin explicar`
    5. `Interruptor de retiradas` (only for bit 512)
    6. `Recientes`

- [ ] **Step 1: Failing tests:**
  - **Guard:** a non-treasurer gets `notFound`. A bit-256 member without 512 sees no `Interruptor de retiradas`.
  - **Pending row:** member label, wallet (short, with a copy button), shares as `% de su posición`, `≈ <estimate> USD` (R7: market estimate), requested date, and the buttons `Aprobar` and `Rechazar`. A self-request shows `Tu solicitud`.
  - **Approve dialog:** title `Aprobar retirada`. It calls `quoteWithdrawalAction` on open and shows:
    - `Importe que se fijará: 8 USDC`
    - `USDC disponible en la Safe: 10 USDC`
    - `Wallet de destino: 0x…` (full address, monospace)
    - `No hay USDC suficiente en la Safe: vende ETH antes de pagar.` when `availableUsdc < amountUsdc`; this does not block approval
    - `Es tu propia retirada: quedará registrada y marcada en el panel.` when `selfApproval`
    - The confirm button is `Aprobar y fijar importe`; on success the dialog shows `Aprobada por <amount> USDC. Paga desde la Safe y pega aquí el hash, o el foro detectará la transferencia.`
    - `valuation_unavailable` shows its copy, and the confirm button stays disabled.
  - **Approved row:**
    - `Aprobada · 8 USDC`, `Caduca el <fecha>`, the badge `Autoaprobada` when `self_approved`, and `Pago detectado · esperando finalidad` when a payout is recorded;
    - the buttons `Marcar como pagada` and `Rechazar` (rejecting is hidden once a payout is recorded).
  - **Mark-paid dialog:** an input `Hash de la transacción` validated against `^0x[0-9a-fA-F]{64}$` before the call, and the button `Comprobar pago`.
    - Success shows `Pago verificado. Las participaciones se quemarán cuando la red lo finalice.`
    - `payout_pending`, `tx_mismatch` and `approval_expired` show their copy.
  - **Reject dialog:** a `Motivo` textarea of 1–280 characters, with the button `Rechazar` disabled while it is empty.
  - **Avisos:**
    - approvals that expire within 48 h: `Caduca pronto: <label> · <amount> USDC`;
    - `Pagos aprobados sin USDC suficiente en la Safe` when the reserved amount is larger than the Safe's USDC;
    - an unexplained-outflow count linking to the section below;
    - `Sin avisos.` when there are none.
  - **Switch:** one switch per network (`role="switch"`) labelled `Retiradas en Linea` and `Retiradas en Linea Sepolia`. The mainnet one shows `Recomendado solo tras una revisión legal.` Toggling calls `setWithdrawalsEnabledAction(chain, next)` and shows the new state.
  - **Notifications in-app:**
    - copy `Tu retirada de <amount> USDC está aprobada`, `Tu retirada fue rechazada: <motivo>`, `Has recibido <amount> USDC de la tesorería`, `Tu aprobación de retirada caducó: vuelve a estar pendiente`, `Nueva solicitud de retirada`, `Una retirada aprobada caducó sin pagarse`;
    - the member kinds link to `/dao#retirada`, while `treasury_notice` and `treasury_outflow` link to `/dao/tesoreria`;
    - malformed data falls back to copy without the amount.
  - **/dao:** a treasurer sees the link `Panel del tesorero` → `/dao/tesoreria`; a member does not.
- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Implement.** Load `ui-ux-pro-max` first. The tables collapse to cards below `md`, with no horizontal scroll at 375 px.
- [ ] **Step 4: Run** `pnpm test:unit`, `pnpm typecheck` and `pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(dao): treasurer panel /dao/tesoreria — approve at fixed amount, reject, mark paid, alerts and per-network switch`.

### Task 8: E2E on the local chain

**Files:**
- Modify: `e2e/helpers/dao.ts`:
  - `resetLocalDao` also deletes 59141's `withdrawal_requests` after `dao_safe_operations`;
  - it resets `dao_state.approved_locked_shares`, `dao_positions.locked_shares` (via the delete) and `chain_config.withdrawals_enabled = false`;
  - it deletes notices of the five new kinds;
  - add `ageApproval(requestId, days)` (service role, shifts `approved_at` back) and `safeTransfer(safe, to, units)` (impersonate, then `sendToken`).
- Create: `e2e/f4c-withdrawals.spec.ts`
- Modify: `e2e/f4a-fund.spec.ts` / `e2e/f3d-treasury.spec.ts` only if an asserted string changed (the R1 href).

- [ ] **Step 1: Write the spec** (serial; `resetLocalDao` in `beforeAll` and `afterAll`; the same actors and helpers as f4a):
  1. **Setup:** the admin sets a fresh Safe. A donates `10 USDC` and the cron credits it. On `/dao`, A sees no `Retirar`. B, a member without bit 256, gets a 404 on `/dao/tesoreria`.
  2. **Switch:** the admin turns on `Retiradas en Linea Sepolia`, and A then sees `Retirar` on `/dao`.
  3. **Request and cancel:** A types `50` and sees `≈ 5 USDC al valor actual…`, then `Pedir retirada` → `Pendiente`. The admin has one `treasury_notice`. A clicks `Cancelar solicitud` → `Cancelada`, and requests 50 % again.
  4. **Approve:** in the panel, the admin's `Aprobar` dialog shows `Importe que se fijará: 5 USDC`, `USDC disponible en la Safe: 10 USDC` and A's wallet. After approval the row shows `Aprobada · 5 USDC`, and A sees `Aprobada · importe fijado: 5 USDC` plus a bell notice. `Valor por participación` on `/dao` is unchanged.
  5. **Pay by hash:** `safeTransfer(safe, A, 5 USDC)`; the admin pastes the hash → `Pago verificado…`. Then `mineBlock` and the cron: A sees `Pagada` with `Tu parte ≈ 5 USD`. The operations list shows `Retirada de un miembro` with no `Sin explicar`, and the admin's `treasury_outflow` count is unchanged.
  6. **Reject, expiry and auto-detection:**
     - A requests 100 %, and the admin rejects with `Prueba de rechazo` → A sees `Rechazada: Prueba de rechazo`.
     - A requests 100 % again and the admin approves. `ageApproval(id, 15)`, then the cron → A sees `Caducada · pendiente de nueva aprobación`.
     - The admin re-approves. `safeTransfer(safe, A, <fixed>)` without pasting, `mineBlock`, then the cron → A sees `Pagada`, and A's position is 0.
  7. **Unmatched transfer:** `safeTransfer(safe, B, 1 USDC)`, `mineBlock`, then the cron → one `treasury_outflow` for the admin, and the panel's `Operaciones sin explicar` lists it.
  8. **No browser errors** in any context (same filter as f4a).
- [ ] **Step 2: Run** `pnpm test:e2e e2e/f4c-withdrawals.spec.ts` (port 3000 free; the controller authorizes the DB wipe) and iterate until green. Then run `e2e/f3d-treasury.spec.ts e2e/f4a-fund.spec.ts e2e/f4c-withdrawals.spec.ts` together, to prove order independence.
- [ ] **Step 3: Commit** `test(e2e): f4c withdrawals — switch, request, approve, pay by hash, auto-detect, expiry, reject`.

---

## Plan decisions (for the controller's ledger)
- Plan decision: the switch is `chain_config.withdrawals_enabled` (per network, default false). The legacy global `app_config.withdrawals_enabled` key stays unused, because test 010 pins it and the spec wants a per-network switch.
- Plan decision: "Caducada" is not a status. An expired approval returns to `pending` with `last_expired_at` set, and the UI labels it `Caducada · pendiente de nueva aprobación`. Spec 6b says it goes back to pending while the behaviour section lists "Caducada"; this reconciles the two.
- Plan decision: one active request (pending **or** approved) per (chain, member). Positions are per chain, and an approved request is still "in progress".
- Plan decision: requesting needs the switch on, while cancel, reject, payout recording, finalization and expiry do not. Money that is already owed is never stranded by switching off.
- Plan decision: there is a minimum withdrawal of 1 USDC (estimated at request, fixed at approval) unless it is the whole position, and 0 is always refused (`amount_too_small`). This prevents dust payouts the treasurer cannot sensibly send.
- Plan decision: payouts are two-phase like donations. The payout is recorded when mined with confirmations, which stops it counting as a liability from its block; the shares burn at finality, and a permanent failure reverts the record. Waiting for finality before recording would leave the NAV understated for hours, and donations credited meanwhile would be over-issued.
- Plan decision: the gating `share_bps` divides by `S_eff`, so your gating % equals the % shown on `/dao`.
- Plan decision: the net-contribution reduction at the burn uses `payout_amount` (the USDC actually received), with a floor of 0. The spec says "se resta el USDC pagado".
- Plan decision: one transfer of at least the fixed amount pays a withdrawal, and split payouts are not matched. That keeps the UNIQUE tx/log rule and the anti-reuse check simple.
- Plan decision: the payout window is block time in [approved_at − 120 s, approved_at + 14 d], and the cron detects payouts before it expires approvals. This uses the same clock-skew allowance as payment verification and avoids expiring a request whose payout is already mined.
- Plan decision: auto-detection happens in `record_safe_operations`, which links a matching USDC outflow (to the destination, at least the fixed amount, after approval) and skips its alert; the cron then verifies it on-chain and records it. A real payout never raises a false "sin explicar" alert, and verification stays in TS like donations.
- Plan decision: in the public feed a withdrawal payout shows the note `Retirada de un miembro`, counts as explained, and has its tx hash hidden from non-treasurers. The `dao_operations` signature is unchanged. The hash would reveal the recipient (spec my decision 10).
- Plan decision: the destination is the member's login wallet, snapshotted at approval in `destination_address`. The spec shows "la wallet de destino" without a choice, and the login wallet is the identity.
- Plan decision: two extra notification kinds, `withdrawal_expired` for the member and `treasury_notice` for treasurers (new request, approval expired). The member's status visibly changes on expiry, and §19's "aviso de tesorería" needs a kind.
- Plan decision: the approve flow shows a read-only quote first, then approval recomputes at that moment with no tolerance parameter. The formula is strict ("fijado en ese momento"), and the dialog says the shown figure is the quote.
- Plan decision: "USDC disponible" = the Safe's live USDC minus the fixed amounts of other approved, unpaid withdrawals. It is informational and never blocks approval (my decision 7 only requires showing it).
- Plan decision: the treasurer panel lists the active chain's requests only. This matches `/dao` and `dao_operations`, which also work on the active chain.
- Plan decision: withdrawals are not written to `dao_ledger`. Its constraints (intent_id NOT NULL, donation kind) are donation-shaped, so `withdrawal_requests` is the record.
- Plan decision: `cancel_open_donation_intents` only expires intents with no tx attached. One with a hash may be a real payment, and the copy warns about a payment in flight.
- Plan decision: the cron writers (and the new payout and approval writers) raise `safe_changed` when `p_safe` is null or differs from `chain_config`. This is carry item (a), closing the race with a Safe change.
- Plan decision: the panel's "Avisos" (spec "avisos de la reconciliación") are unexplained outflows, approvals expiring within 48 h, and approved amounts above the Safe's USDC. After F4a, the reconciliation's only alerts are unexplained outflows; the other two are what a treasurer must act on.
- Plan decision: the withdrawal estimate in the member dialog and the fixed amount are labelled `USDC` (the payout token), while the panel's market estimate is labelled `USD`. This follows R7: paid and fixed amounts keep their token, market values are USD, and the spec words the estimate "en USDC".
- Plan decision: a payout reverts on `tx_not_found` only 30 minutes after `payout_recorded_at`, with no new column. This mirrors `donation_missing`, so a lagging RPC node cannot undo a real payout.
