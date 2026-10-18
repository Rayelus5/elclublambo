# F3d — Tesorería, dashboard, gating y reconciliación — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members donate USDC to the active network's Safe. Each donation becomes shares in a per-chain ledger, but only once its block is finalized.
- A public dashboard shows the balance, the history and a ranking. Each member chooses whether they appear in the ranking by name.
- Channels with gating actually gate, using two optional rules joined with "o": a minimum % or a minimum net contribution. A gated channel is visible with a lock and its content stays protected.
- A reconciliation job compares the ledger with the Safe's on-chain balance and alerts treasury managers.

**Architecture:**
- **Ledger:** per chain, append-only `dao_ledger`, plus `dao_state` and `dao_positions` maintained in SQL. Plan Maestro §2 gives the share math: `shares = S == 0 ? d·10¹² : d·S/V`, all `numeric(78,0)`.
- **Donations:** reuse the F3b intents (`purpose = 'donation'`, `target_type = 'dao'`, recipient = the chain's Safe, fee on top to the platform).
- **Two-phase crediting:**
  1. `record_donation` claims the transfers in `onchain_transfers` and writes a `pending_finality` ledger row once the transfer is mined and verified.
  2. `credit_donation` turns the row into shares once its block is at or below the chain's `finalized` block, after re-verifying the transfer. A transfer that no longer verifies is marked `reverted`.
- **Gating:** the stub `gate_passes` gets a real body. `channel_permissions` keeps hiding content.
  - New: `channel_lock_state` and `locked_channels()`, so the sidebar and `/c/<id>` can show a lock page for channels the member could see except for the gate.
- **Reconciliation:** a server job reads the Safe's USDC balance through viem and records the run. It notifies `MANAGE_TREASURY` (bit 256) holders on a mismatch and never changes the ledger.

**Tech Stack:** Next.js 16, Supabase (pgTAP), viem/wagmi, Vitest, Playwright with the F3b local Hardhat chain. Hardhat answers the `finalized` tag with its latest block.

**Spec:** `docs/superpowers/specs/2026-10-18-f3-economia-design.md`. It covers:
- decisions 2, 8, 9, 12 and 13 (test-mode gating);
- "Decisiones mías": finalization, minimum donation, intent, reconciliation, both rules joined with "o";
- the "Comportamiento" sections on shares and gating;
- Plan Maestro §2 and §3, the economy part.

On this branch: F3a (economy config, `NetworkBadge`, guide), F3b (intents, verifier, `confirmIntent` purpose dispatch, `TipDialog` with the never-pay-twice ledger: rulings F3b-R4 and F3b-R5), and F3c (bounty mode in the dialog, purpose dispatch extended).

## Global Constraints

**Donations**
- USDC only.
- Minimum 1 USDC (1000000 base units); maximum 1000000 USDC (`amount_out_of_range`).
- The recipient is `chain_config.safe_address` of the active chain. If it is null: `safe_not_configured`, with the copy "La tesorería aún no tiene Safe configurada en esta red."
- The fee is on top, paid to the platform, as with tips. Shares are computed on the donated amount only.

**Share math** (per chain; integers; floor division)
- `S` is `dao_state.total_shares` and `V` is `dao_state.value_usdc`.
- On credit: `shares = (S = 0) ? d × 10^12 : floor(d × S / V)`. Then `S += shares` and `V += d`; the position's `shares += shares` and `net_contributed_usdc += d`.
- `share_bps = floor(shares_u × 10000 / S)`, which is 0 when `S = 0`.
- A direct transfer to the Safe never touches the ledger.

**Finality**
- A ledger row is `pending_finality` until `receipt.blockNumber <= finalizedBlock.number`.
- At that point the transfer is re-verified with the F3b verifier (`confirmations: 1`).
- If it still verifies: `credited`. Otherwise: `reverted`, and its `onchain_transfers` rows are deleted so a corrected claim is possible.
- `credit_donation` is idempotent.

**Gating rules**
- Replace `gate_mode`/`gate_value` with two nullable columns:
  - `gate_min_share_bps int check 0..10000`;
  - `gate_min_net_usdc numeric(78,0) check >= 0`.
- Keep `gate_scope ('view'|'post')`. A gate is active when either rule is set.
- `gate_passes` is true when `(min_share set and share_bps >= min_share) OR (min_net set and net >= min_net)`, using the **active chain's** positions. On Sepolia this is test mode (decision 13).
- A migration converts existing `gate_mode` rows.

**Lock UX**
- **Requirement copy:** "Necesitas 1 % de la DAO o 100 USDC aportados". Use only the rules that are set, with a Spanish decimal comma.
- **Situation copy:** "Tu situación: 0,2 % · 20 USDC aportados en <red>".
- **Locked by view-gate:**
  - the channel appears in the sidebar with a `Lock` icon;
  - `/c/<id>` renders the lock page (requirement, situation, a "Donar a la DAO" button, and `HowItWorksLink section="candados"`) instead of a 404;
  - no messages, topic text beyond the name, pins or members are exposed.
- **Locked by post-gate:** the channel is readable and the composer is replaced by the requirement notice and the donate button.

**Ranking**
- `members.dao_ranking_visible boolean not null default false`. The default is anonymous because privacy comes first.
- The member toggles it in `/perfil` and on the dashboard, copy "Aparecer con mi nombre en el ranking de la DAO".
- Hidden members show as "Anónimo" in the ranking and history. Their % still counts for gating.

**Reconciliation**
- Table `dao_reconciliations`: `id`, `chain_id`, `ledger_value`, `onchain_balance`, `diff` (onchain − ledger), `ran_at`, `ran_by` (null for cron).
- When `diff <> 0`, insert a `treasury_mismatch` notification for every active member holding global bit 256, with `data = { chainId, diff, reconciliationId }`.
- Triggers: the "Reconciliar ahora" button on `/dao` (bit 256 only) and the route `POST /api/cron/dao` with header `Authorization: Bearer ${CRON_SECRET}`. The same route also settles pending donations.
- The UI labels:
  - a positive diff: "Hay fondos en la Safe que no están en el registro (transferencias directas)";
  - a negative diff: "La Safe tiene menos de lo registrado".

**Copy and process**
- Spanish "tú" copy, design tokens, ≥44px targets, ui-ux-pro-max before UI work.
- DB wipes, `db:test` and E2E are authorised.
- Only Hardhat test accounts and generated keys.

## Review Focus

1. **Inflation and replay:** each of these must not change shares or `V`:
   - a direct USDC transfer to the Safe;
   - the same tx claimed twice;
   - a donation tx re-claimed as a tip;
   - a donation credited twice through a `credit_donation` retry.

   Pinned in Task 1.
2. **Rounding:** the first donor gets `d·10¹²` shares. A second donor of the same amount gets equal shares, and the % values sum to ≤ 10000 bps. A tiny donation after a huge one must not round to a negative or absurd value. Pinned in Task 1.
3. **Lock leakage:** a member failing a view-gate cannot read messages, pins, attachments, search hits, notifications or realtime events of that channel, yet sees it locked in the sidebar. A member who also lacks VIEW from roles does not see it at all. Pinned in Task 2.
4. **Finality reorg:** a pending donation whose tx no longer verifies at finality time is marked `reverted` and never credits. Pinned in Task 3.
5. **Network switch:** after the admin switches the active chain, the dashboard, positions and gating read the new chain's ledger. Testnet shares never count on mainnet. Pinned in Task 1 and Task 2.

---

### Task 1: Treasury ledger, donations and dashboard reads (SQL)

**Files:**
- Create: `supabase/migrations/20261018800001_treasury.sql`, `supabase/tests/800_treasury.test.sql`
- Modify: `src/lib/errors.ts`

**Interfaces:**
- Produces:
  - **Tables** (RLS on, no client writes, no direct SELECT; reads go through RPCs):
    - `dao_ledger`: `id`, `chain_id`, `kind check in ('donation')` (F4 adds more), `member_id`, `amount_usdc`, `shares_delta numeric(78,0) null`, `intent_id unique`, `tx_hash`, `log_index`, `block_number bigint`, `status check in ('pending_finality','credited','reverted')`, `created_at`, `credited_at`;
    - `dao_state`: `chain_id` pk, `total_shares`, `value_usdc`, `updated_at`; seeded with 0 for both chains;
    - `dao_positions`: `(chain_id, member_id)` pk, `shares`, `net_contributed_usdc`.
  - **Column:** `members.dao_ranking_visible`.
  - **RPCs (authenticated):**
    - `create_donation_intent(p_amount numeric, p_fee_bps int) returns jsonb`: the same shape and validation style as `create_tip_intent`, with purpose `donation`, target `dao`, the recipient snapshot = the Safe, and anonymous false;
    - `set_dao_ranking_visible(p_visible boolean)`;
    - `dao_overview() returns jsonb`: `{ chainId, totalShares, valueUsdc, donors, myShares, myShareBps, myNet, myPending: [{ ledgerId, amount, txHash, createdAt }] }`, with amounts as text, for the active chain;
    - `dao_ranking(p_limit int default 50)`: rows `(rank, member_id null, label text, share_bps, net_usdc)`. A hidden member gets `member_id` null and label "Anónimo"; the caller always sees themselves;
    - `dao_history(p_limit int default 50)`: credited donations newest first `(ledger_id, member_id null, label, amount, tx_hash, credited_at)`, with the same anonymity rule;
    - `my_dao_position(p_chain int default null)`: used by the lock copy.
  - **RPCs (service_role only):**
    - `record_donation(p_intent uuid, p_main jsonb, p_fee jsonb) returns uuid`. It mirrors the `confirm_tip` rechecks, with NULL-safe checks and late credit per F3b-R2. It inserts `onchain_transfers` (unique), inserts a `pending_finality` ledger row and marks the intent `confirmed`. It returns the ledger id.
    - `credit_donation(p_ledger uuid) returns void`. It locks `dao_state` for the chain `FOR UPDATE`, applies the share math, updates the position and sets `credited`. Calling it on a credited row is a no-op; on a reverted row it raises `invalid_state`.
    - `revert_donation(p_ledger uuid) returns void`, which sets `reverted` and deletes its `onchain_transfers` rows.

- [ ] **Step 1: Write the failing pgTAP `800_treasury.test.sql`**
  - Intent: `safe_not_configured`; `amount_out_of_range` at 999999 and 1000000000001; fee floor (`fee_below_minimum`); the recipient equals the Safe.
  - Share math (Review Focus 2):
    - the first credit of 10 USDC gives `10000000 × 10¹²` shares;
    - the second credit of 10 USDC gives equal shares;
    - a third credit of 1 USDC gives `floor(1000000 × S / V)`;
    - the bps sum is ≤ 10000.
  - Idempotence and replay (Review Focus 1):
    - a second `credit_donation` is a no-op;
    - `record_donation` replaying the same tx raises `tx_already_used`, as does a tx already used by a tip;
    - `revert_donation` frees the transfer rows and a reverted row can't be credited.
  - Per chain (Review Focus 5): credits on 59141 don't move the 59144 state or positions, and `dao_overview` follows the active chain.
  - Anonymity: `dao_ranking` and `dao_history` show "Anónimo" and a null `member_id` for a hidden member to others, and their real identity to themselves.
  - Grants: the service-only functions are not executable by `authenticated`.
- [ ] **Step 2: Run `pnpm db:test` and confirm it FAILS.**
- [ ] **Step 3: Write the migration.** Reuse the F3b/F3c internal payment helpers if they exist. Otherwise copy the recheck pattern exactly.
- [ ] **Step 4: Run `pnpm db:test`.** Expected: all pass.
- [ ] **Step 5: Commit** `feat(treasury): per-chain dao ledger, donation intents, two-phase crediting and dashboard reads`.

### Task 2: Gating rules and lock state (SQL)

**Files:**
- Create: `supabase/migrations/20261018800002_gating.sql`, `supabase/tests/810_gating.test.sql`

**Interfaces:**
- Produces:
  - **Schema:** the channel columns from Global Constraints, with `gate_mode`/`gate_value` converted then dropped. Every function or view that reads `gate_mode` is redefined from its latest body (`grep -rn gate_mode supabase/migrations`).
  - **`gate_passes(p_member, p_channel, p_scope)`:** the real body per Global Constraints, reading `dao_positions` and `dao_state` of `active_chain_id`.
  - **Internal core:** `_channel_permissions_core(p_member, p_channel, p_ignore_view_gate boolean)`. `channel_permissions(member, channel)` calls it with false, and its behaviour is unchanged.
  - **`channel_lock_state(p_channel uuid) returns jsonb`:**
    - Returns null unless the caller would have VIEW with the view-gate ignored and lacks VIEW with it, or has VIEW but fails a post-gate.
    - Otherwise returns `{ scope: 'view'|'post', minShareBps, minNetUsdc, myShareBps, myNet, chainId, name, kind, parentId }` (name and kind only).
  - **`locked_channels()`:** rows `(id, parent_id, kind, name, position, scope)` for view-gated channels the caller sees locked.
  - **`set_channel_gate(p_channel uuid, p_min_share_bps int, p_min_net_usdc numeric, p_scope text)`:** requires `MANAGE_CHANNELS` on the channel plus `can't act on what you can't see` (F2a rule). It is audited, and nulls clear the rules.

- [ ] **Step 1: Write the failing pgTAP `810_gating.test.sql`**
  - Pass and fail cases for share-only, net-only and both rules joined with OR, at the exact thresholds (`>=` passes).
  - A view-gate failure leaves no VIEW, so these return nothing for that member (Review Focus 3):
    - the existing `messages` RLS selection;
    - `search_messages`;
    - `tips_summary`;
    - the pins query;
    - `visible_channels`.
  - `channel_lock_state` returns `scope 'view'` with the requirement.
  - `locked_channels` lists the channel.
  - A member lacking role VIEW gets nothing from either function.
  - A post-gate failure keeps VIEW, drops bits 2 and 4, and returns `scope 'post'` from `channel_lock_state`.
  - Switching the active chain flips the result according to that chain's positions (Review Focus 5).
  - `set_channel_gate` without `MANAGE_CHANNELS` raises `forbidden`, and an audit row is written.
  - Existing channel and permission tests stay green after the column change.
- [ ] **Step 2: Run `pnpm db:test` and confirm it FAILS.**
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run `pnpm db:test`.** Expected: all pass.
- [ ] **Step 5: Commit** `feat(gating): real DAO gating with share/net rules, lock state and gate admin RPC`.

### Task 3: Donation confirmation, settlement and reconciliation (server)

**Files:**
- Create:
  - `src/lib/treasury/actions.ts`: `createDonationIntentAction`, `setRankingVisibleAction`, `reconcileNowAction`;
  - `src/lib/treasury/settle.ts` (server-only): `settlePendingDonations(chain?: ChainId): Promise<{ credited: number; reverted: number; pending: number }>`;
  - `src/lib/treasury/reconcile.ts` (server-only): `reconcile(chain: ChainId, actor: string | null): Promise<{ ledgerValue: bigint; onchainBalance: bigint; diff: bigint; id: string }>`;
  - `src/lib/treasury/queries.ts`;
  - `src/app/api/cron/dao/route.ts`.
- Modify:
  - `src/lib/payments/confirm.ts`: purpose `'donation'` goes to `record_donation`, then a `settlePendingDonations` attempt for that row. The result union gains `{ status: "pending_finality"; ledgerId }`;
  - the forum layout: `after()` also calls `settlePendingDonations` for the caller's pending rows (at most 5).
- Test: `tests/unit/treasury/settle.test.ts`, `tests/unit/treasury/reconcile.test.ts`, `tests/unit/treasury/cron-route.test.ts`, `tests/unit/payments/confirm.test.ts` (the donation dispatch).

**Interfaces:**
- **Settlement:** for each `pending_finality` row (cap 20 per call):
  - read `getBlock({ blockTag: "finalized" })` from `chainClient(chain)`;
  - if `row.block_number <= finalized.number`, re-run `verifyTransfer` for the main transfer with `confirmations: 1`;
  - ok → `credit_donation`; a permanent error → `revert_donation`; otherwise leave the row.
  - An RPC error leaves every row untouched.
- **Reconcile:** the ledger value comes from `dao_state.value_usdc`. The on-chain balance comes from `readContract({ address: NETWORKS[chain].usdc, abi: erc20Abi, functionName: "balanceOf", args: [safe] })`. The run is recorded and notified through a service RPC `record_reconciliation(p_chain, p_ledger, p_onchain, p_actor)` added in this task's migration, `20261018800003_reconcile.sql`, with its pgTAP test `820_reconcile.test.sql`.
- **Cron route:** returns 401 without the exact bearer secret (a constant-time compare) and 503 when `CRON_SECRET` is unset. It runs `settlePendingDonations` and `reconcile` for both chains whose Safe is set, then returns JSON counts.

- [ ] **Step 1: Write the failing tests** (mock clients)
  - The finalized check: below, equal and above.
  - A permanent verify error leads to `revert_donation` (Review Focus 4).
  - An RPC error causes no writes.
  - The cap is 20.
  - Reconcile computes the diff sign and calls the RPC.
  - The route returns 401 and 503, and 200 runs both chains.
  - `confirmIntent` for a donation returns `pending_finality`.
  - pgTAP 820: a notification goes to bit-256 holders only on a nonzero diff, and the function is service-only.
- [ ] **Step 2: Run the tests and confirm they FAIL.**
- [ ] **Step 3: Implement.** Add `CRON_SECRET` to `.env.example` with an empty value and a comment.
- [ ] **Step 4: Run `pnpm db:test`, `pnpm test`, `pnpm typecheck` and `pnpm lint`.** Expected: green.
- [ ] **Step 5: Commit** `feat(treasury): donation confirmation with finality settlement, reconciliation and cron route`.

### Task 4: DAO dashboard and donate flow (UI)

**Files:**
- Create: `src/app/(forum)/dao/page.tsx`, `src/components/treasury/dao-overview.tsx`, `src/components/treasury/dao-ranking.tsx`, `src/components/treasury/dao-history.tsx`, `src/components/treasury/ranking-toggle.tsx`, `src/components/treasury/reconcile-panel.tsx`
- Test: `tests/unit/treasury/dao-overview.test.tsx`, `tests/unit/treasury/dao-ranking.test.tsx`, `tests/unit/treasury/reconcile-panel.test.tsx`, additions to the `tip-dialog` tests
- Modify:
  - `src/components/payments/tip-dialog.tsx`: add a donation mode, `mode={{ kind: "donation" }}`.
    - USDC is locked, the minimum is 1, and there is no anonymous checkbox.
    - The recipient shows as "Tesorería de la DAO (Safe)" with the short Safe address.
    - The done state says "Donación registrada. Tus participaciones se acreditarán cuando el bloque se finalice (puede tardar horas)."
    - Ledger `targetType 'dao'`.
  - `src/components/shell/sidebar.tsx`: a "DAO" section (icon `Landmark`) after Guía.
  - `src/lib/search/actions-list.ts`: "Tesorería de la DAO" and "Donar a la DAO".
  - `src/app/(forum)/perfil`: the ranking toggle.
  - `src/app/(forum)/guia/[section]`: remove "Disponible próximamente" from DAO y shares and from Canales con candado.

**Page `/dao`:**
- The `NetworkBadge`, then the balance (`valueUsdc` formatted), total donors and the "Donar a la DAO" button.
- "Tu participación": %, shares in a compact form, net contributed, and the pending donations, each with "Pendiente de finalización" and an explorer link.
- The ranking table: rank, name or "Anónimo", %, aportado; the viewer's own row is highlighted.
- The history list.
- The ranking toggle.
- For bit 256: the reconcile panel, showing the last run, the diff copy from Global Constraints and a "Reconciliar ahora" button.
- The legal notice: "La tesorería la custodian los firmantes de la Safe. Las participaciones son un registro interno de la comunidad, no un producto financiero."

- [ ] **Step 1: Write the failing tests.**
  - The overview formats amounts and pending items.
  - The ranking shows "Anónimo" and highlights the viewer.
  - The reconcile panel appears for bit 256 only and shows the diff copy by sign.
  - Donation mode in the dialog: USDC locked, minimum 1, no anonymous checkbox, the `safe_not_configured` copy when no Safe is set, and the done copy.
- [ ] **Step 2: Run the tests and confirm they FAIL.**
- [ ] **Step 3: Implement.** Run ui-ux-pro-max `search.py` "treasury dashboard ranking table" first. Data visuals use tables and text, not charts.
- [ ] **Step 4: Run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build`.** Expected: green.
- [ ] **Step 5: Commit** `feat(treasury): dao dashboard, donate mode, ranking visibility and reconcile panel`.

### Task 5: Gating UI — admin editor, locked sidebar, lock page

**Files:**
- Create: `src/components/settings/channel-gate-form.tsx`, `src/components/channels/lock-page.tsx`, `src/components/chat/post-gate-notice.tsx`, `src/lib/channels/lock.ts`
- Test: `tests/unit/settings/channel-gate-form.test.tsx`, `tests/unit/channels/lock-page.test.tsx`, `tests/unit/chat/post-gate-notice.test.tsx`, `tests/unit/channels/guard.test.ts`
- Modify:
  - `src/components/settings/channel-form.tsx`: an embedded gate section with:
    - "% mínimo de la DAO" (percent text → bps through `percentTextToBps`-style parsing);
    - "Aportación neta mínima (USDC)";
    - an "Aplicar a" segment with the options "Ver el canal" and "Escribir".
    It calls `set_channel_gate`.
  - `src/lib/channels/queries.ts` and the forum layout: load `locked_channels()` and merge them into the tree with a `locked` flag.
  - `src/components/shell/channel-tree.tsx`: locked rows get the `Lock` icon and the `aria-label` "<name>, bloqueado".
  - `src/lib/channels/guard.ts`: `isMissingChannel` returns false when `channel_lock_state` is non-null.
  - `src/app/(forum)/c/[channelId]/page.tsx`: a locked view-gate renders `LockPage`; a post-gate renders the channel with `PostGateNotice` instead of the composer.

**Interfaces:**
- **Lock copy:** `lockRequirementText(state): string` and `lockSituationText(state, chainName): string`, using the exact copy from Global Constraints.

- [ ] **Step 1: Write the failing tests.**
  - The copy helpers cover the share-only, net-only and both-rules variants, with decimal commas.
  - The lock page shows the requirement, the situation, the donate button (donation-mode dialog) and the guide link, and no message list.
  - The post-gate notice replaces the composer.
  - The gate form validates the % to 2 decimals and ≤ 100, and the net amount ≥ 0; both may be empty (clears the gate).
  - The guard lets locked channels through and still returns 404 for unknown or hidden ones.
  - Tree rows show the lock icon and label.
- [ ] **Step 2: Run the tests and confirm they FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build`.** Expected: green.
- [ ] **Step 5: Commit** `feat(gating): gate editor, locked channels in the sidebar, lock page and post-gate notice`.

### Task 6: Treasury and gating E2E

**Files:**
- Create: `e2e/f3d-treasury.spec.ts`
- Modify: `playwright.config.ts` (env `CRON_SECRET=e2e-cron-secret`)

- [ ] **Step 1: Write the spec** (Hardhat chain, injected wallet)
  1. **Setup:** the admin sets the Sepolia Safe (a Hardhat account) and the platform wallet, then creates the channel "VIP" with the gate "1 % o 5 USDC", scope view.
  2. **Locked:** member A sees "VIP" locked in the sidebar. `/c/<vip>` shows the lock page with "Necesitas 1 % de la DAO o 5 USDC aportados" and "Tu situación: 0 % · 0 USDC aportados en Linea Sepolia". Messages seeded in VIP are not visible.
  3. **Donate:**
     - A donates 10 USDC (with the fee): two signatures, then the "Donación registrada…" copy.
     - The dashboard shows it pending until settlement; call `POST /api/cron/dao` with the secret.
     - The dashboard shows 100 %, balance 10 USDC and A as "Anónimo" to member B.
     - A turns on the ranking toggle and B sees A's handle.
  4. **Unlocked:** A opens VIP and reads the seeded message.
  5. **Direct transfer:**
     - A sends 3 USDC straight to the Safe outside the app (through the Hardhat RPC).
     - The admin presses "Reconciliar ahora", which shows the positive-diff copy, and the admin's bell gets the `treasury_mismatch` notice.
     - The dashboard balance is still 10 (Review Focus 1).
  6. **Network switch:** the admin switches to Linea, so VIP is locked again for A (mainnet ledger empty) and `/dao` shows 0. Switching back restores both (Review Focus 5).
- [ ] **Step 2: Run the full suite (dev + `E2E_PROD=1`).** Expected: all pass.
- [ ] **Step 3: Commit** `test(e2e): f3d treasury, gating and reconciliation`.
