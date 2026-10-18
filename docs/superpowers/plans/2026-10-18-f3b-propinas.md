# F3b — Propinas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members tip messages (including Alpha posts and thread replies) and profiles in ETH or USDC on the active network.
- The platform fee is added on top.
- A tip can be anonymous.
- The server verifies every transfer on-chain and only then credits it.
- A credited tip shows a badge, a total and a donor list. A tip on a message also posts a system notice in the message's thread and notifies the recipient.

**Architecture:**
- **Payment intents:** a generic `payment_intents` table is created before signing, by RPC, and snapshots amounts, addresses and the fee. Its `purpose` column is reused by F3c (bounty) and F3d (donation).
- **Signing:** the client signs plain transfers with wagmi: the fee first, then the main transfer.
- **Verification:** a server-only viem verifier checks each transaction against the intent.
- **Crediting:** a service-role RPC `confirm_tip` records both transfers in `onchain_transfers`, whose PK is `(chain_id, tx_hash, log_index)` so a transfer can never be reused. It also inserts the tip, posts the system notice and notifies.
- **System notices:** they are `messages` with `kind = 'system'` and a null `author_id`. They are only ever inserted by definer functions.

**Tech Stack:** Next.js 16, Supabase (pgTAP), wagmi/viem (already installed with Reown AppKit), Vitest, Playwright plus a local Hardhat node for on-chain E2E.

**Spec:** `docs/superpowers/specs/2026-10-18-f3-economia-design.md` covers decisions 1, 3, 4, 5, 6 and 12, the "Decisiones mías" on intents, separate transfers, confirmation and notices, and the "Comportamiento" section on money sending. F3a (`docs/superpowers/plans/2026-10-18-f3a-perfiles-red-guia.md`) is merged on this branch and provides:
- `NETWORKS`, `ChainId`, `explorerTx`, `getEconomyConfig`, `bpsToPercentText` and `percentTextToBps` (`src/lib/economy/*`);
- `<NetworkBadge>` and `<HowItWorksLink section="propinas">`;
- `memberName`, `mentionLabel` and `MemberAvatar`;
- the `economy_config()` SQL function.

## Global Constraints

**Tokens, units and limits**
- **Tokens:** `ETH` (18 decimals; the native transfer is recorded with `log_index = -1`) and `USDC` (6 decimals; the official contract per chain comes from `NETWORKS[chain].usdc`). Amounts are stored as `numeric(78,0)` in base units and handled as `bigint` in TypeScript. Never use floats.
- **Limits per tip:**

  | Token | Minimum | Maximum |
  |---|---|---|
  | USDC | 0.01 (10000 base units) | 100000 |
  | ETH | 0.00001 (10^13 wei) | 100 |

  Error code: `amount_out_of_range`.
- **Fee:** `fee = ceil(amount × fee_bps / 10000)`. The chosen `fee_bps` must satisfy minimum ≤ `fee_bps` ≤ 5000 (`fee_out_of_range`). It is snapshotted in the intent. The payer pays `amount + fee`, and the recipient receives `amount` exactly.
- **No fee transfer:** when `fee_bps = 0`, no fee transfer is made.

**Intents**
- A tip uses the active chain only (`chain_invalid` otherwise).
- The payer must differ from the recipient (`self_payment`).
- The recipient's wallet is snapshotted at intent time.
- `platform_wallet` is required when fee > 0 (`platform_not_configured`, ruling F3a-R4).
- Intents expire after 24 h.
- A member may have at most 20 `pending` intents (`too_many_intents`).

**Verification** (server, viem, per chain)
- **RPC:** `LINEA_RPC_URL` for 59144 and `LINEA_SEPOLIA_RPC_URL` for 59141, each falling back to viem's public RPC. Both get a timeout of 8000 ms and 1 retry.
- **Receipt and timing:**
  - `status === "success"`;
  - the block is ≥ `TIP_CONFIRMATIONS` deep (env, default `3`; E2E sets `1`), otherwise `pending`;
  - block timestamp ≥ intent `created_at` − 120 s (`tx_too_old`).
- **Transfer contents:**
  - **ETH:** `tx.from` = the payer wallet, `tx.to` = the expected address, and `tx.value` = the expected amount exactly.
  - **USDC:** a `Transfer(from = payer, to = expected, value = amount)` log emitted by the chain's USDC address. Its `logIndex` is recorded.
- **Uniqueness:** a transfer already present in `onchain_transfers` fails with `tx_already_used`.
- Error codes: `tx_not_found`, `tx_failed`, `tx_mismatch`, `tx_too_old`, `tx_already_used`, `rpc_unavailable`.

**System notice and display**
- **Notice text:** "`<actor>` ha enviado `<amount> <TOKEN>` a `<@recipient>` por este mensaje".
  - `<actor>` is the donor's `mentionLabel`, or "Anónimo" for an anonymous tip.
  - `<amount>` uses a Spanish decimal comma and no trailing zeros (e.g. "12,5 USDC", "0,001 ETH").
- **Anonymity:** an anonymous donor's identity never reaches other members by any path: the donor list, the notice, the notification actor, push or realtime. The donor sees their own tips marked "(tú, anónimo)". The UI says on-chain is still traceable.

**Copy and process**
- Spanish "tú" copy; design tokens; ≥44px targets; ui-ux-pro-max `search.py` before UI tasks.
- DB wipes, `db:test` and `test:e2e` are authorised.
- Never use real wallets. Only Hardhat's well-known test accounts and generated keys are allowed.

## Review Focus

1. **Replay or forgery:** each of these must fail with its code, never credit:
   - the same tx hash submitted for two intents, or twice;
   - a USDC transfer from a lookalike token contract;
   - a transfer to the right address with the wrong amount;
   - a transfer made before the intent existed.

   Pinned in Task 2 and Task 3.
2. **Anonymity leak:** an anonymous tip must not expose the donor through `tips_summary`, the donor list, the notice text, the notification `actor_id`, push or realtime payloads. Pinned in Task 1.
3. **Wrong network or wallet:** the connected wallet on another chain, or a different address from the session wallet, means nothing is signed and the dialog explains why. Pinned in Task 4.
4. **Interrupted flow:** if the tab closes after signing, the stored hashes are re-verified on the next visit and the tip is credited once. Pinned in Task 3.
5. **Tip on a message the payer cannot see, or one that was deleted:** the intent is refused (`not_found`). A system notice is never a tip target. Pinned in Task 1.

---

### Task 1: Tips schema, intents and confirm RPC

**Files:**
- Create: `supabase/migrations/20261018600001_tips.sql`, `supabase/tests/600_tips.test.sql`
- Modify: `src/lib/errors.ts` (new codes, Spanish copy)

**Interfaces:**
- Produces:
  - **`public.payment_intents`**
    - Columns: `id uuid pk`, `member_id uuid → members`, `purpose text check in ('tip','bounty','donation')`, `chain_id int check in (59144,59141)`, `token text check in ('ETH','USDC')`, `amount numeric(78,0) > 0`, `fee_bps int 0..5000`, `min_fee_bps int`, `fee_amount numeric(78,0) >= 0`, `recipient_member_id uuid null`, `recipient_address text`, `platform_address text null`, `target_type text check in ('message','profile','bounty','dao')`, `target_id uuid null`, `anonymous bool`, `status text check in ('pending','confirmed','failed','expired') default 'pending'`, `fee_tx_hash text null`, `main_tx_hash text null`, `failure_code text null`, `created_at`, `expires_at = created_at + 24h`.
    - RLS: SELECT own rows only. No client writes.
  - **`public.onchain_transfers`**
    - Columns: `chain_id int`, `tx_hash text` (lowercase `^0x[0-9a-f]{64}$`), `log_index int` (-1 for native), `intent_id uuid`, `role text check in ('main','fee')`, `primary key (chain_id, tx_hash, log_index)`.
    - RLS on, no client access.
  - **`public.tips`**
    - Columns: `id`, `intent_id unique`, `chain_id`, `from_member`, `to_member`, `target_type ('message'|'profile')`, `message_id null → messages on delete set null`, `token`, `amount`, `fee_amount`, `anonymous`, `main_tx_hash`, `fee_tx_hash null`, `block_number bigint`, `created_at`.
    - RLS on, no direct client SELECT. Reads go through the RPCs below.
  - **`messages` changes:**
    - `kind` check adds `'system'`;
    - `author_id` becomes nullable, with `check ((kind = 'system') = (author_id is null))`;
    - new column `tip_id uuid null → tips`.
    - `edit_message`, `report_message`, `toggle_reaction` (reactions allowed) and the F2 renderers must tolerate a null author. Editing and reporting a system message raise `forbidden`.
  - **RPCs (authenticated, definer):**
    - `create_tip_intent(p_target_type text, p_target_id uuid, p_token text, p_amount numeric, p_fee_bps int, p_anonymous boolean) returns jsonb`. It returns `{ id, chainId, token, amount, feeAmount, recipientAddress, platformAddress, expiresAt }` with amounts as strings. A message target must be visible (`can(channel, 1)`), not deleted and not `kind='system'`; otherwise `not_found`.
    - `attach_intent_tx(p_intent uuid, p_role text, p_tx_hash text) returns void`. Only for own pending, unexpired intents. It writes the hash once (`tx_already_attached` if a different hash is already set).
    - `tips_summary(p_message_ids uuid[]) returns table (message_id uuid, token text, total numeric, tip_count int)`. It covers visible messages only.
    - `message_tips(p_message_id uuid) returns table (tip_id uuid, donor_id uuid null, is_me boolean, token text, amount numeric, chain_id int, main_tx_hash text, created_at timestamptz)`. `donor_id` is null when anonymous, unless the caller is the donor (then `is_me = true`). It covers visible messages only.
    - `member_tips(p_member uuid, p_limit int default 20)`: same shape, for profile and message tips received by that member. Message tips appear only if the message is visible to the caller.
  - **RPC (service_role only):** `confirm_tip(p_intent uuid, p_main jsonb, p_fee jsonb) returns uuid`.
    - Inputs: `p_main` is `{ "txHash", "logIndex", "blockNumber" }`; `p_fee` has the same shape or null.
    - It rechecks the intent: pending, not expired, purpose `tip`, and the hashes match the attached ones.
    - It inserts the `onchain_transfers` rows; a unique violation raises `tx_already_used`.
    - It inserts `tips` and marks the intent `confirmed`.
    - For a message tip, it inserts the system notice as a thread reply on the tipped message's thread root (the message itself if it is a root), with `tip_id` set. It bumps `reply_count` and `last_reply_at` exactly as normal replies do and broadcasts through the existing message trigger.
    - It inserts a `notifications` row of new kind `'tip_received'` for the recipient, with `actor_id` = the donor (or null if anonymous), `message_id` when applicable and `data = { "tipId": … }`. `_push_build` gets a case: "Has recibido una propina de `<actor|Anónimo>`".
    - Return value: the tip id.
  - **RPC (service_role only):** `fail_intent(p_intent uuid, p_code text) returns void`.
  - **Expiry:** pending intents past `expires_at` count as expired in every read and RPC. No cron is needed.

- [ ] **Step 1: Write the failing pgTAP `600_tips.test.sql`**

  Assertions:

  *Intent creation*
  - Fee math: 10 USDC (10000000) at 260 bps gives fee 260000; 1 base-unit-rounding case: amount 10001 at 1 bps gives fee 2 (ceil).
  - `create_tip_intent` errors:
    - `self_payment`;
    - `not_found` for a hidden-channel message, a deleted message and a system message;
    - `fee_out_of_range` below the minimum or above 5000;
    - `amount_out_of_range` at both bounds;
    - `platform_not_configured` with fee > 0 and a null platform wallet;
    - `chain_invalid` is not reachable from the client (the chain comes from the config), so assert that the snapshot equals the active chain;
    - `too_many_intents` at 21.

  *Hashes*
  - `attach_intent_tx` rejects another member's intent, an expired intent, and a second different hash.

  *Confirmation*
  - `confirm_tip` is not executable by `authenticated`.
  - Happy path: the tip row exists, the intent is confirmed, and the notice message has `kind 'system'`, a null author, `thread_root_id` = the tipped root and the exact text.
  - The notification row has kind `tip_received`.
  - Replaying the same `txHash`/`logIndex` on another intent raises `tx_already_used`.

  *Anonymity* (Review Focus 2)
  - An anonymous confirm: `message_tips` from a third member shows `donor_id` null, the donor sees `is_me`, the notice text starts with "Anónimo", and the notification's `actor_id` is null.

  *Visibility*
  - `tips_summary` returns nothing for a message in a hidden channel.

  *System messages*
  - A system message cannot be edited or reported (`forbidden`).
  - The existing message tests still pass.

- [ ] **Step 2: Run `pnpm db:test` and confirm it FAILS.**
- [ ] **Step 3: Write the migration.** Redefine the functions that join on `author_id` (search, notify and quote paths) so they skip `kind='system'` rows where an author is required: a system message never notifies channel followers. The amount text is formatted in SQL, matching the TS formatter in Task 2: trim trailing zeros and use a decimal comma.
- [ ] **Step 4: Run `pnpm db:test`.** Expected: all pass.
- [ ] **Step 5: Commit** `feat(tips): payment intents, tips ledger, system notices and confirm RPC`.

### Task 2: Amount math and on-chain verifier

**Files:**
- Create: `src/lib/payments/amounts.ts`, `src/lib/payments/verify.ts` (server-only), `src/lib/payments/chain-client.ts` (server-only)
- Test: `tests/unit/payments/amounts.test.ts`, `tests/unit/payments/verify.test.ts`

**Interfaces:**
- Produces:
  - **Amount types and helpers:**
    - `type Token = "ETH" | "USDC"`;
    - `TOKEN_DECIMALS: Record<Token, number>`;
    - `TIP_LIMITS: Record<Token, { min: bigint; max: bigint }>`;
    - `parseAmount(text: string, token: Token): bigint | null`, which accepts "12,5", "12.5" and "0,000001" and rejects more decimals than the token has, negatives and empty input;
    - `formatAmount(units: bigint, token: Token): string`, using a Spanish comma and no trailing zeros: `formatAmount(12500000n, "USDC") === "12,5"`;
    - `feeFor(amount: bigint, bps: number): bigint`, which rounds up.
  - **Chain client:** `chainClient(chain: ChainId): PublicClient`, built from the env RPC URLs in Global Constraints.
  - **Verifier:** `verifyTransfer(input: { chain: ChainId; token: Token; txHash: \`0x${string}\`; from: string; to: string; amount: bigint; notBefore: Date; confirmations?: number }, client?: PublicClient): Promise<{ status: "ok"; logIndex: number; blockNumber: bigint } | { status: "pending" } | { status: "error"; code: "tx_not_found" | "tx_failed" | "tx_mismatch" | "tx_too_old" | "rpc_unavailable" }>`.

- [ ] **Step 1: Write the failing tests**
  - `amounts.test.ts`: parse and format round-trips; `feeFor(10000000n, 260) === 260000n` and `feeFor(10001n, 1) === 2n`; the limits match Global Constraints; a parity table of formatted amounts identical to the SQL formatter cases in Task 1.
  - `verify.test.ts` injects a fake client (`getTransaction`, `getTransactionReceipt`, `getBlock`, `getBlockNumber`). Cases:
    - **ETH:** the happy path; wrong `to`; wrong value; wrong `from` (`tx_mismatch`).
    - **USDC:** the happy path picks the right log among several; a Transfer from a different contract address (`tx_mismatch`, Review Focus 1); value off by one.
    - **Status and timing:** a reverted receipt (`tx_failed`); a not-found tx; too few confirmations (`pending`); a block timestamp before `notBefore` − 120 s (`tx_too_old`).
    - **RPC failures:** RPC throws (`rpc_unavailable`).
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/payments`. Expected: FAIL.
- [ ] **Step 3: Implement.** Decode USDC logs with viem `parseEventLogs` using the ERC-20 `Transfer` ABI, filtered by `address === NETWORKS[chain].usdc` (case-insensitive). The confirmation depth comes from `confirmations ?? Number(process.env.TIP_CONFIRMATIONS ?? 3)`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(payments): amount math and on-chain transfer verifier`.

### Task 3: Tip server actions and re-verification

**Files:**
- Create: `src/lib/payments/tip-actions.ts` (server actions), `src/lib/payments/confirm.ts` (server-only)
- Test: `tests/unit/payments/tip-actions.test.ts`, `tests/unit/payments/confirm.test.ts`
- Modify: `src/app/(forum)/layout.tsx`, which schedules `after(() => reverifyMyPendingIntents())`.

**Interfaces:**
- Consumes: the Task 1 RPCs and the Task 2 verifier.
- Produces:
  - **Server actions:**
    - `createTipIntentAction(input: { targetType: "message" | "profile"; targetId: string; token: Token; amount: string; feeBps: number; anonymous: boolean }): Promise<{ ok: true; intent: TipIntent } | { ok: false; error: string }>`, where `TipIntent` has amounts as decimal strings of base units;
    - `attachTxAction(intentId: string, role: "main" | "fee", txHash: string)`;
    - `verifyIntentAction(intentId: string): Promise<{ status: "confirmed"; tipId: string } | { status: "pending" } | { status: "failed"; error: string }>`.
  - **Server-only confirmation:**
    - `confirmIntent(intentId: string): Promise<…same union…>`. It verifies the fee (if any) and the main transfer with `verifyTransfer`, then calls `confirm_tip` through the admin client.
    - A permanent error (`tx_mismatch`, `tx_failed`, `tx_too_old`, `tx_already_used`) calls `fail_intent`.
    - `pending` and `rpc_unavailable` leave the intent pending.
  - **Re-verification:** `reverifyMyPendingIntents(): Promise<void>` runs `confirmIntent` for the caller's pending, unexpired intents with all required hashes attached, at most 5 per call, swallowing and logging errors (Review Focus 4).

- [ ] **Step 1: Write the failing tests** (mock the Supabase clients and `verifyTransfer`)
  - The fee is verified before the main transfer, against the platform address.
  - The main transfer is verified against the recipient address.
  - `confirm_tip` receives the log indexes from the verifier.
  - Each permanent error maps to `fail_intent` plus the Spanish message.
  - `pending` causes no RPC write.
  - A second `verifyIntentAction` after confirmation returns the same tip id without calling `confirm_tip` again.
  - `reverifyMyPendingIntents` skips intents missing a required hash and caps at 5.
- [ ] **Step 2: Run them and confirm they FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: green.
- [ ] **Step 5: Commit** `feat(payments): tip intent, attach and verify actions with re-verification`.

### Task 4: Tip dialog and wallet sending

**Files:**
- Create: `src/components/payments/tip-dialog.tsx`, `src/components/payments/fee-control.tsx`, `src/lib/payments/use-send-transfer.ts` (client hook)
- Test: `tests/unit/payments/tip-dialog.test.tsx`, `tests/unit/payments/fee-control.test.tsx`, `tests/unit/payments/use-send-transfer.test.ts`
- Modify:
  - the message actions menu in `src/components/chat/message-item.tsx`: "Dar propina" for every non-own, non-system message, including Alpha posts and thread replies;
  - `src/app/(forum)/u/[address]/page.tsx`: a "Dar propina" button when the profile is not the viewer's own;
  - the forum layout: pass `EconomyConfig` to a client provider `src/components/payments/economy-provider.tsx` (`useEconomy()`).

**Interfaces:**
- Consumes: the Task 3 actions, F3a `NetworkBadge`, `HowItWorksLink`, `MemberAvatar`, `mentionLabel`, `NETWORKS` and `useEconomy()`.
- Produces:
  - `<TipDialog target={{ type: "message"; messageId: string } | { type: "profile" }} recipient={MemberIdentity & { id: string }} open onOpenChange />`;
  - `useSendTransfer(): { send(input: { chain: ChainId; token: Token; to: \`0x${string}\`; amount: bigint }): Promise<\`0x${string}\`> }`. It uses wagmi `useSendTransaction` for ETH and `useWriteContract` with the ERC-20 `transfer` for USDC.

**Dialog states, in order:**
1. **Form**, containing:
   - the `NetworkBadge`;
   - the recipient (avatar, `mentionLabel`, short wallet);
   - an ETH/USDC segmented control;
   - the amount;
   - the fee control (the minimum shown and locked as the floor, plus an optional increase in 0.5% steps up to 50%, or a typed percent);
   - the total;
   - the "Propina anónima" checkbox, with the note "Solo se oculta en el foro: en la blockchain la transacción es pública.";
   - `HowItWorksLink section="propinas"`.

   "Continuar" is disabled with an inline reason when:
   - the amount is out of range;
   - the fee is > 0 and `platform` is null for the active chain ("La plataforma aún no tiene wallet configurada en esta red.");
   - the recipient is the viewer.
2. **Wallet check**, before signing (Review Focus 3):
   - **No connected wallet:** a "Conectar wallet" button opens AppKit.
   - **Connected address ≠ session wallet:** "Conecta la wallet `<short session wallet>` para enviar." and nothing is signed.
   - **Wrong chain:** a "Cambiar a `<network>`" button calls `switchChain`.
3. **Signing:** the steps "1/2 Comisión" and "2/2 Propina", or a single step when there is no fee. After each hash, call `attachTxAction`. If the wallet rejects, return to the form with "Has cancelado la firma." The intent stays pending until it expires.
4. **Verifying:** call `verifyIntentAction` every 3 s for up to 2 min. After that: "Seguimos verificando. Puedes cerrar: la propina se acreditará sola cuando se confirme."
5. **Done:** "Propina enviada" with explorer links (`explorerTx`).

- [ ] **Step 1: Write the failing tests** (mock wagmi hooks and the actions)
  - The form validation messages above.
  - The fee control floor is the minimum and the total = amount + `feeFor`.
  - The anonymous note is shown.
  - The mismatched-wallet state blocks signing.
  - The wrong chain shows the switch button.
  - With a fee, `send` is called twice in the order fee → main, each followed by `attachTxAction`.
  - A rejected signature returns to the form with the message.
  - Verifying → done renders the explorer links.
  - The menu shows "Dar propina" on others' text and Alpha messages and replies, but not on one's own or on system messages.
- [ ] **Step 2: Run them and confirm they FAIL.**
- [ ] **Step 3: Implement.** Run ui-ux-pro-max `search.py` "payment confirmation dialog" first. The fee steps use `percentTextToBps`/`bpsToPercentText`.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint && pnpm build`. Expected: green.
- [ ] **Step 5: Commit** `feat(tips): tip dialog with fee control, wallet checks and signing flow`.

### Task 5: Tip display, notices, profile and notifications

**Files:**
- Create: `src/components/payments/tips-badge.tsx`, `src/components/payments/tips-popover.tsx`, `src/components/chat/system-notice.tsx`, `src/components/profile/tips-received.tsx`, `src/lib/payments/queries.ts`
- Test: `tests/unit/payments/tips-badge.test.tsx`, `tests/unit/chat/system-notice.test.tsx`, `tests/unit/profile/tips-received.test.tsx`
- Modify:
  - `src/lib/chat/queries.ts` (attach the tip summaries for loaded messages through `tips_summary`; tolerate a null author);
  - `src/components/chat/message-item.tsx` (render `kind === "system"` with `SystemNotice` and no actions menu except "Copiar enlace"; render `TipsBadge` under tipped messages);
  - the chat realtime handler (refetch the summary for the root and the thread on a new system message carrying `tip_id`);
  - the notifications list item and copy for `tip_received`;
  - `src/app/(forum)/u/[address]/page.tsx` (the `TipsReceived` section);
  - `src/app/(forum)/guia/[section]` (remove "Disponible próximamente" from Propinas).

**Interfaces:**
- Consumes: the Task 1 read RPCs; `formatAmount`; `explorerTx`.
- Produces:
  - `getTipSummaries(messageIds: string[]): Promise<Map<string, { token: Token; total: bigint; count: number }[]>>`;
  - `getMessageTips(messageId)`;
  - `getMemberTips(memberId)`.

**Display:**
- **Badge:** "Recompensado · 12,5 USDC · 0,001 ETH", with tokens in the order USDC then ETH. It opens a popover listing each donor as `memberName` (or "Anónimo", or "Tú (anónimo)"), the amount, a relative time and an explorer link.
- **System notice:** a compact row with a coin icon, the text and an explorer link. The author label is "El Club".
- **Profile:** totals per token for the active chain, plus the 20 most recent tips received with the same anonymity rules.

- [ ] **Step 1: Write the failing tests**
  - The badge text and ordering.
  - The popover anonymity labels.
  - The system notice renders "El Club", the text and the link, with no reply/edit/report actions.
  - The profile section totals for the active chain only.
  - The notification item copy: "`<actor>` te ha enviado una propina" or "Has recibido una propina anónima".
- [ ] **Step 2: Run them and confirm they FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint && pnpm build`. Expected: green.
- [ ] **Step 5: Commit** `feat(tips): tip badges, donor list, thread notices, profile tips and notifications`.

### Task 6: On-chain E2E with a local Hardhat node

**Files:**
- Create:
  - `e2e/chain/hardhat.config.cjs` (chainId 59141, automine, the default test accounts);
  - `e2e/chain/start-chain.mjs`, which starts `hardhat node` on port 8545, then:
    - deploys a minimal ERC-20 mock;
    - copies its runtime bytecode to `0xFEce4462D57bD51A6A552365A011b95f0E16d9B7` with `hardhat_setCode`;
    - mints to the test accounts;
  - `e2e/chain/MockUSDC.sol` (or precompiled bytecode in `e2e/chain/mock-usdc.json`, 6 decimals, with a standard `Transfer` event);
  - `e2e/helpers/wallet.ts`, which injects an EIP-1193 provider into the page (`page.addInitScript`). It forwards `eth_*` requests to `http://127.0.0.1:8545` for one Hardhat account and announces it via EIP-6963 so AppKit/wagmi list it;
  - `e2e/f3b-tips.spec.ts`.
- Modify:
  - `playwright.config.ts`: a second `webServer` entry for `start-chain.mjs`, and env `LINEA_SEPOLIA_RPC_URL=http://127.0.0.1:8545`, `TIP_CONFIRMATIONS=1`;
  - `package.json`: devDependency `hardhat@^2` (Hardhat 2's JSON-RPC node).

**Interfaces:** consumes everything above. The tipping member logs in with the private key of the Hardhat account used by the injected wallet (`loginAs` accepts any key), so the session wallet equals the signer.

- [ ] **Step 1: Write the spec**
  1. **USDC tip with fee:**
     - The admin sets the minimum fee to 2.6% and the Sepolia platform wallet (a Hardhat account) in `/settings/economia`.
     - Member A (Hardhat account #3) tips a message by member B: 10 USDC with a fee.
     - Two signatures happen and the dialog ends on "Propina enviada".
     - B's message shows "Recompensado · 10 USDC".
     - The thread shows the notice "@… ha enviado 10 USDC a @… por este mensaje".
     - B's bell shows a new notice.
     - The platform account's mock-USDC balance increased by exactly 0.26.
  2. **Anonymous ETH tip on B's profile:** B's profile lists "Anónimo" and a third member sees "Anónimo". The thread notice case is covered by pgTAP.
  3. **Replay:** submitting the first tip's main hash to a new intent through `rpcAs`/actions ends in "Esa transacción ya se usó" (Review Focus 1).
  4. **Wallet on another address:** the injected wallet is account #4 while the session is #3, so the dialog shows "Conecta la wallet…" and nothing is signed (Review Focus 3).
  5. **Interrupted flow:** close the page right after the second signature, reopen the forum, and the tip is credited exactly once (Review Focus 4).
- [ ] **Step 2: Run the full suite** (`pnpm test:e2e`, then `E2E_PROD=1`). Put System32 on PATH. Expected: all pass. Fix any F3a/F3b residuals in specs and any real bugs (test first).
- [ ] **Step 3: Commit** `test(e2e): f3b tips on a local hardhat chain`.
