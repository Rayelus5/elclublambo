# F3c — Bounties — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members with the new channel permission "Crear bounties" publish bounties with `/bounty`. Each bounty has an amount, a token and a description, and its solutions arrive in its thread. The author marks one reply as the solution and pays it through the F3b payment flow, fee on top.
- If the author has not paid 7 days after marking, the bounty and the author's profile show "Impagado". A later payment turns that into "Pagado tarde".
- A bounty with no solution marked becomes "Expirado" after 30 days.
- The author can cancel a bounty while no solution is marked.

**Architecture:**
- **Messages:** a bounty is a `messages` row with `kind = 'bounty'`, plus a `bounties` row holding the amount, token, chain and lifecycle timestamps.
- **Status:** derived at read time from the timestamps and `now()` (open, solution_marked, unpaid, paid, paid_late, expired, cancelled). No cron is involved.
- **Payment:** reuses the F3b intent, verification and ledger machinery with `purpose = 'bounty'`.
  - A service-role `confirm_bounty_payment` records the transfers and a `tips` row on the solution message, so the solution gets the "Recompensado" badge.
  - It also marks the bounty paid, posts a system notice in the bounty thread and notifies the solver.

**Tech Stack:** Next.js 16, Supabase (pgTAP), wagmi/viem, Vitest, Playwright with the F3b local Hardhat chain.

**Spec:** `docs/superpowers/specs/2026-10-18-f3-economia-design.md`, decisions 7, 12 and 14, plus "Decisiones mías" (the new bit, paid once, at least the announced amount, cancel). F3a/F3b are on this branch and provide:
- `payment_intents`, `onchain_transfers`, `tips`, system notices (`kind 'system'`) and the `tip_received` pattern;
- `verifyTransfer`, `confirmIntent`, `reverifyMyPendingIntents`;
- `TipDialog` with the pending-sends ledger (F3b rulings R4/R5);
- `NetworkBadge`, `HowItWorksLink` and the economy config.

## Global Constraints

**Permission**
- New channel bit: `CREATE_BOUNTIES = 65536`.
  - `CHANNEL_MASK` becomes `97295` (31759 | 65536).
  - `ALL_PERMS` becomes `131071`.
  - The member-safe mask becomes `76823` (11287 | 65536). Creating bounties is not a moderation power, so non-admin delegates may grant it to @everyone and to system_key roles.
- The UI label is "Crear bounties".
- Default grant: the migration adds 65536 to the Verificado role (`system_key = 'verified'`) permissions.

**Bounty amounts**

| Token | Minimum | Maximum |
|---|---|---|
| USDC | 1 (1000000 base units) | 100000 |
| ETH | 0.0001 | 100 |

Out of range raises `amount_out_of_range`.

**Chain**
- A bounty records the chain that was active when it was created.
- It can only be paid while that chain is active. Otherwise the error is `bounty_chain_inactive`, with the copy "Este bounty se publicó en <red>; podrás pagarlo cuando esa red vuelva a estar activa."

**Lifecycle**
- Columns on `bounties`: `created_at`, `solution_marked_at`, `paid_at`, `cancelled_at`.
- Derived status:
  - `cancelled` if `cancelled_at` is set.
  - Else `paid` if `paid_at` is set and `paid_at <= solution_marked_at + 7 days`.
  - Else `paid_late` if `paid_at` is set.
  - Else `unpaid` if `solution_marked_at` is set and `now() > solution_marked_at + 7 days`.
  - Else `solution_marked` if `solution_marked_at` is set.
  - Else `expired` if `now() > created_at + 30 days`.
  - Else `open`.
- Status chip copy:

  | Status | Chip |
  |---|---|
  | open | "Abierto" |
  | solution_marked | "Solución elegida · quedan N días para pagar" |
  | paid | "Pagado" |
  | paid_late | "Pagado tarde" |
  | unpaid | "Impagado" |
  | expired | "Expirado" |
  | cancelled | "Cancelado" |

**Rules (my rulings from the spec)**
- Marking a solution is final: it cannot be unmarked or changed. Otherwise the 7-day clock could be dodged.
- Only the author can mark, cancel or pay.
- The solution must be a non-deleted, non-system reply in the bounty's thread, written by someone other than the author.
- A bounty is paid exactly once (`already_paid`).
- The payment goes to the solution author's wallet, snapshotted at intent time, with the bounty's token and an amount ≥ the announced amount (`amount_below_bounty`). The fee is added on top, as with tips.
- A bounty payment is never anonymous.
- A bounty can only be created in a text channel where the author has `CREATE_BOUNTIES` and `SEND_MESSAGES`.

**Notices and notifications**
- System notice in the bounty thread on payment: "`<@author>` ha pagado el bounty: `<amount> <TOKEN>` a `<@solver>`".
- New notification kinds:
  - `bounty_solution`, for the solver when marked: "`<actor>` ha elegido tu respuesta como solución del bounty".
  - `bounty_paid`, for the solver when paid: "`<actor>` te ha pagado el bounty".
- Notification `data` keys are camelCase.

**Process**
- Spanish "tú" copy, design tokens, ≥44px targets, ui-ux-pro-max before UI work.
- DB wipes, `db:test` and E2E are authorised.
- Only Hardhat test accounts and generated keys.

## Review Focus

1. **Dodging the unpaid mark:** the author tries to unmark the solution, mark a second one, cancel after marking, or delete the bounty message after marking. Each attempt is refused, and deleting the message keeps the bounty row and its status on the profile. Pinned in Task 2.
2. **Paying the wrong person or amount:** an intent for a different recipient, a lower amount, another token, or a second payment of the same bounty is refused. Pinned in Task 2.
3. **Permission bit parity and escalation:** the new bit in SQL `channel_permissions` matches the TS mirror. A non-admin cannot grant bits beyond the new member-safe mask. Pinned in Task 1.
4. **Status around the boundaries:** at exactly 7 days and 30 days after the relevant timestamp, the status matches the derived-status rules. Pinned in Task 2.
5. **A bounty in a channel the viewer cannot see** never shows up on that viewer's profile view of the author, not even as an "Impagado" count. Unpaid counts include only bounties visible to the viewer. Pinned in Task 2.

---

### Task 1: CREATE_BOUNTIES permission bit

**Files:**
- Create: `supabase/migrations/20261018700001_bounty_permission.sql`, `supabase/tests/700_bounty_permission.test.sql`
- Modify:
  - `src/lib/permissions/bits.ts` (`CREATE_BOUNTIES`, `ALL_PERMS`, `CHANNEL_MASK`, plus any member-safe constant if one exists in TS);
  - `src/lib/permissions/labels.ts` ("Crear bounties");
  - `tests/fixtures/channel-permissions.json` and `tests/fixtures/channel-cases.ts` (parity cases with the new bit);
  - the permission matrix, if it hardcodes its rows.

**Interfaces:**
- Produces:
  - `Perm.CREATE_BOUNTIES = 65536n`;
  - SQL functions whose latest definitions use the literals `31759`, `11287` or `65535`, now redefined with `97295`, `76823` and `131071`. Find them with `grep -rn "31759\|11287\|65535" supabase/migrations`; the hits are in `20261016100001`–`100006` and `20261017300007`. Redefine from the latest body of each function.

- [ ] **Step 1: Write the failing tests.**
  - pgTAP `700`:
    - an overwrite allowing 65536 is accepted;
    - `channel_permissions` returns the bit for a member granted it on a channel and omits it when denied;
    - Verificado holds 65536 by default;
    - a non-admin delegate can put 65536 on @everyone, but still cannot put 8 (MANAGE_MESSAGES) on it;
    - a role permissions value above 131071 is rejected.
  - The TS parity test (`tests/unit/permissions*.test.ts`, reading `channel-permissions.json`) gains cases with 65536.
- [ ] **Step 2: Run `pnpm db:test` and `pnpm test`, and confirm both FAIL.**
- [ ] **Step 3: Implement the migration and the TS changes.**
- [ ] **Step 4: Run `pnpm db:test`, `pnpm test`, `pnpm typecheck` and `pnpm lint`.** Expected: green.
- [ ] **Step 5: Commit** `feat(permissions): CREATE_BOUNTIES channel bit`.

### Task 2: Bounty schema and RPCs

**Files:**
- Create: `supabase/migrations/20261018700002_bounties.sql`, `supabase/tests/710_bounties.test.sql`
- Modify: `src/lib/errors.ts`

**Interfaces:**
- Produces:
  - **Schema changes:**
    - `messages.kind` check adds `'bounty'`;
    - table `public.bounties`: `message_id uuid pk → messages on delete restrict`, `channel_id`, `author_id`, `chain_id`, `token`, `amount numeric(78,0)`, `solution_message_id uuid null`, `solver_id uuid null`, `solution_marked_at`, `paid_at`, `cancelled_at`, `paid_tip_id uuid null → tips`, `created_at`.
    - Deleting a bounty message soft-deletes it (`deleted_at`) as with any message. The bounty row stays.
    - RLS on; no client writes; no direct SELECT. Reads go through the RPCs.
  - **Status helper:** `public.bounty_status(b public.bounties) returns text`, implementing the derived-status rules exactly.
  - **Create:** `create_bounty(p_channel uuid, p_body jsonb, p_token text, p_amount numeric) returns uuid`, which returns the message id.
    - It reuses `_post_message_core`'s validation and insert path with kind `'bounty'`. Extend the core or wrap it; do not duplicate the doc and slowmode checks.
    - It requires bits 65536 and 2 on the channel.
    - It uses the active chain.
  - **Lifecycle:**
    - `mark_bounty_solution(p_bounty uuid, p_reply uuid) returns void`;
    - `cancel_bounty(p_bounty uuid) returns void`.
  - **Payment:**
    - `create_bounty_payment_intent(p_bounty uuid, p_amount numeric, p_fee_bps int) returns jsonb`, with the same shape as `create_tip_intent`, `purpose 'bounty'`, `target_type 'bounty'` and `target_id = bounty message id`. Anonymous is always false.
    - `confirm_bounty_payment(p_intent uuid, p_main jsonb, p_fee jsonb) returns uuid`, **service_role only**. It mirrors `confirm_tip`'s rechecks (NULL-safe, F3b-R2 late credit, `onchain_transfers` uniqueness). It inserts a `tips` row with `target_type 'message'` on the solution message, sets `paid_at` and `paid_tip_id`, posts the payment notice in the bounty thread, notifies the solver with `bounty_paid`, and returns the tip id.
  - **Reads:**
    - `bounty_details(p_message_ids uuid[]) returns table (message_id, token, amount_text, chain_id, status, solution_message_id, solver_id, solution_marked_at, pay_deadline timestamptz null, paid_tip_id)`. It covers visible messages only.
    - `member_bounty_record(p_member uuid) returns table (paid int, paid_late int, unpaid int, open int)`. It counts only bounties in channels the caller can view.
    - `member_unpaid_bounties(p_member uuid) returns table (message_id, channel_id, token, amount_text, solution_marked_at)`, visible to the caller only.
  - **Notifications:** `mark_bounty_solution` notifies the solver with `bounty_solution`. `_push_build` gains both kinds.

- [ ] **Step 1: Write the failing pgTAP `710_bounties.test.sql`**

  Assertions:

  *Creation*
  - `create_bounty` without 65536 raises `forbidden`.
  - Out of range raises `amount_out_of_range` at both bounds.
  - The created message has kind `bounty` and `chain_id` equals the active chain.

  *Marking a solution*
  - Marking succeeds on a valid reply.
  - Each of these is refused:
    - a reply by the author;
    - a reply in another thread;
    - a system notice;
    - a deleted reply;
    - a second mark (`already_marked`);
    - a mark by a non-author (`forbidden`);
    - a mark on a cancelled or expired bounty.

  *Cancelling*
  - Cancel works when open.
  - Cancel after marking raises `already_marked` (Review Focus 1).

  *Deleting*
  - Soft-deleting the bounty message keeps `member_bounty_record` counting it.

  *Status boundaries* (Review Focus 4)
  - Set the timestamps through the service role. At `solution_marked_at = now() − 7 days + 1 minute` the status is `solution_marked`; at −7 days −1 minute it is `unpaid`.
  - At `created_at` = −30 days −1 minute it is `expired`.
  - Paid within 7 days gives `paid`; paid after 7 days gives `paid_late`.

  *Payment intent* (Review Focus 2)
  - Before marking: `no_solution`.
  - Below the announced amount: `amount_below_bounty`.
  - By a non-author: `forbidden`.
  - Inactive chain: `bounty_chain_inactive`.
  - After it is paid: `already_paid`.
  - Recipient snapshot = the solver's wallet.

  *Confirmation*
  - `confirm_bounty_payment` is not executable by `authenticated`.
  - The happy path posts the notice text exactly and creates the tip on the solution message and the notification.
  - Replay raises `tx_already_used`.

  *Visibility* (Review Focus 5)
  - `member_bounty_record` excludes a hidden-channel bounty for a viewer without VIEW.

- [ ] **Step 2: Run `pnpm db:test` and confirm it FAILS.**
- [ ] **Step 3: Write the migration.** Generalise only where it removes duplication: a shared internal `_record_payment_transfers(intent, main, fee)` for `confirm_tip` and `confirm_bounty_payment` is welcome if both keep their tests green.
- [ ] **Step 4: Run `pnpm db:test`.** Expected: all pass.
- [ ] **Step 5: Commit** `feat(bounties): bounty schema, lifecycle, payment intent and confirm RPCs`.

### Task 3: Bounty server actions and purpose-aware confirmation

**Files:**
- Create: `src/lib/bounties/actions.ts`, `src/lib/bounties/queries.ts`
- Modify:
  - `src/lib/payments/confirm.ts`: `confirmIntent` dispatches on `intent.purpose`. `'tip'` goes to `confirm_tip`; `'bounty'` goes to `confirm_bounty_payment`. The verification is unchanged and shared.
  - `src/lib/payments/tip-actions.ts`: `verifyIntentAction` and `reverifyMyPendingIntents` stay purpose-agnostic.
- Test: `tests/unit/bounties/actions.test.ts`, `tests/unit/payments/confirm.test.ts` (new dispatch cases)

**Interfaces:**
- Produces:
  - **Server actions:**
    - `createBountyAction(input: { channelId: string; body: unknown; token: Token; amount: string }): Promise<{ ok: true; messageId: string } | { ok: false; error: string }>`;
    - `markSolutionAction(bountyId, replyId)`;
    - `cancelBountyAction(bountyId)`;
    - `createBountyPaymentIntentAction(input: { bountyId: string; amount: string; feeBps: number }): Promise<{ ok: true; intent: TipIntent } | { ok: false; error: string }>`.
  - **Queries:**
    - `getBountyDetails(supabase, messageIds)` returns `Map<string, BountyDetail>`;
    - `getMemberBountyRecord(supabase, memberId)`;
    - `getMemberUnpaidBounties(supabase, memberId)`.
  - **Type:** `type BountyStatus = "open" | "solution_marked" | "unpaid" | "paid" | "paid_late" | "expired" | "cancelled"`.

- [ ] **Step 1: Write the failing tests.**
  - The actions map each RPC error to its Spanish copy.
  - `confirmIntent` routes `purpose 'bounty'` to `confirm_bounty_payment` with the same verifier calls.
  - An unknown purpose fails closed and calls no RPC.
- [ ] **Step 2: Run the tests and confirm they FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `pnpm test`, `pnpm typecheck` and `pnpm lint`.** Expected: green.
- [ ] **Step 5: Commit** `feat(bounties): server actions and purpose-aware payment confirmation`.

### Task 4: Bounty UI

**Files:**
- Create: `src/components/chat/bounty-dialog.tsx`, `src/components/chat/bounty-card.tsx`, `src/components/profile/bounty-record.tsx`
- Test: `tests/unit/chat/bounty-dialog.test.tsx`, `tests/unit/chat/bounty-card.test.tsx`, `tests/unit/profile/bounty-record.test.tsx`, plus additions to the `tip-dialog` tests
- Modify:
  - `src/components/chat/composer.tsx` and `composer-editor.tsx`: a `/bounty` slash command, shown only when `canBounty` (bits 65536 and 2 on the channel). It opens `BountyDialog`, mirroring the `/alpha` flow.
  - `src/components/chat/message-item.tsx`: render `kind === 'bounty'` with `BountyCard`. In the bounty's thread, while the bounty is `open` and the viewer is its author, show "Marcar como solución" on others' replies.
  - `src/components/payments/tip-dialog.tsx`: add a bounty mode, `mode={{ kind: "bounty", bountyId, token, minAmount, chainId }}`.
    - The token is locked.
    - The amount is pre-filled with the announced amount; it can be raised but not lowered.
    - There is no anonymous checkbox.
    - Intents go through `createBountyPaymentIntentAction`.
    - When the bounty chain is not active, show the `bounty_chain_inactive` copy and do not sign.
    - The pending-sends ledger uses `targetType 'bounty'`.
  - `src/app/(forum)/u/[address]/page.tsx`: the `BountyRecord` section ("Bounties: N pagados · M pagados tarde · K impagados"), with the list of unpaid bounties linking to `/c/<channel>?m=<id>`.
  - Chat queries and realtime: load `bounty_details` for bounty messages, and refetch on bounty-related system notices.
  - `src/app/(forum)/guia/[section]`: remove "Disponible próximamente" from Bounties.
  - The permission matrix shows "Crear bounties" (via Task 1 labels).

**Bounty card:** the amount and token in large mono type, the network label, the status chip (exact copy from Global Constraints), and the description as the message body.
- **Author actions:** "Cancelar bounty" (open; confirm dialog) and "Pagar bounty" (`solution_marked`/`unpaid`, opens the bounty-mode dialog).
- **Everyone:** "Ver solución" jumps to the solution reply.
- Reuse the Alpha card's layout tokens.

- [ ] **Step 1: Write the failing tests.**
  - The dialog validates amount bounds and shows the `NetworkBadge` and `HowItWorksLink section="bounties"`.
  - The card renders each status chip text exactly, including "quedan N días para pagar" computed from `pay_deadline`.
  - Author actions appear only for the author and the right statuses.
  - "Marcar como solución" appears only for the author on others' non-system replies in an open bounty's thread.
  - Bounty mode in the tip dialog:
    - the token is locked;
    - the amount cannot go below the minimum;
    - there is no anonymous checkbox;
    - the inactive-chain copy shows.
  - The profile record shows the counts and the unpaid list.
- [ ] **Step 2: Run the tests and confirm they FAIL.**
- [ ] **Step 3: Implement.** Run ui-ux-pro-max `search.py` "bounty card status badge" first.
- [ ] **Step 4: Run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build`.** Expected: green.
- [ ] **Step 5: Commit** `feat(bounties): /bounty dialog, bounty card, solution marking, payment mode and profile record`.

### Task 5: Bounties E2E

**Files:**
- Create: `e2e/f3c-bounties.spec.ts`

**Interfaces:** consumes F3b's Hardhat chain, injected wallet and helpers.

- [ ] **Step 1: Write the spec.**
  1. **Create:** a Verificado member (Hardhat account #3) types `/bounty`, creates 5 USDC, and the card shows "Abierto".
  2. **Solve and pay:**
     - Member B replies in the thread; the author marks B's reply.
     - The card shows "Solución elegida · quedan 7 días para pagar" and B's bell shows the `bounty_solution` notice.
     - The author pays (5 USDC + a 2.6% fee): two signatures.
     - The card shows "Pagado", B's reply shows "Recompensado · 5 USDC" and the thread shows the payment notice.
  3. **Unpaid and paid late:**
     - A second bounty is marked, and `solution_marked_at` is backdated 8 days through the service role.
     - The card and the author's profile show "Impagado".
     - After paying, the status is "Pagado tarde".
  4. **Expired:** `created_at` is backdated 31 days, so the status is "Expirado" and there is no "Marcar como solución".
  5. **No permission:** a non-Verificado member doesn't see `/bounty`. A direct `rpcAs("create_bounty", …)` call returns `forbidden`.
- [ ] **Step 2: Run the full suite (dev + `E2E_PROD=1`).** Expected: all pass.
- [ ] **Step 3: Commit** `test(e2e): f3c bounties`.
