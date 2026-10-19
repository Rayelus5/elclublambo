# F4e — Encuestas con voto secreto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member with the new channel permission "Crear encuestas" types `/encuesta` and publishes a poll in a channel. It has a question, 2–10 options, a close 1 h–30 d ahead and a weight mode: 1 persona 1 voto, lineal or cuadrático by participaciones, snapshotted at creation. Anyone who can view the channel votes secretly and can change their vote until the close. Before the close everyone sees only their own vote and the total number of voters. At the close the card shows bars with the % of weight per option and the number of voters, but only with at least 3 voters. Voters are notified. Nobody can ever read who voted what.

**Architecture:**
- **A poll is a message.** It is a `messages` row with `kind = 'poll'`, whose body is the question. A `polls` row (keyed by the message id) holds the mode, the close and the chain, and `poll_options` holds the options. Creation goes through `_post_message_core`, so VIEW, the channel kind, slowmode, the realtime `message_created` event and channel notifications all come for free, as with `/bounty`.
- **Ballots and weights live in `private`.** That schema was created in F4d and grants nothing to `anon`, `authenticated` or `service_role`. Only definer functions read `private.poll_votes` and `private.poll_weight_snapshots`. No RPC returns a member↔option pair except the caller's own open vote.
- **Closing is derived, finalizing is a cron step.**
  - A poll is closed when `now() ≥ closes_at`. From then on votes are refused, and `poll_details` computes the results on read from the frozen ballots, so the bars appear at the close instant.
  - The cron's `close_due_polls()` then freezes the tallies into `poll_options.result_tenths`, notifies the voters and **seals** the ballots: it nulls `option_id` and deletes the weight snapshot. After that, no member↔option link exists anywhere.
- **Live:** a new `poll_changed` broadcast on `channel:<id>` (ids only) fires when a new voter is counted and at finalize. Like any other event, the client re-reads the message through RLS. The card also re-reads itself at `closes_at`.

**Tech Stack:** Next.js 16 App Router (cacheComponents, server actions), Supabase Postgres (definer RPCs with `search_path=''`, pgTAP, Realtime private topics), Vitest + RTL, Playwright on the local Hardhat chain 59141.

**Spec:** `docs/superpowers/specs/2026-10-18-f4-gobernanza-design.md`. Sections: user decision 7; my decisions 12, 13, 14b, 14 and 15; §19 "encuesta cerrada (a quien votó)"; §20 (guide); Comportamiento "Encuesta en el chat"; Fuera de alcance "encuestas vinculantes"; the anti-goal "que se sepa qué votó cada miembro, o que el voto de alguien revele que es donante anónimo". Plus the master plan §2 ("snapshot al crear la encuesta") and §3 (`polls`, `poll_options`, `poll_weight_snapshots`, `poll_votes`), the F3c plan `docs/superpowers/plans/2026-10-18-f3c-bounties.md` (the message-kind and permission-bit pattern this plan copies) and F4d `20261019400002` (the `private` schema).

## Global Constraints
- **Permission bit.** `CREATE_POLLS = 131072`, a channel bit labelled `Crear encuestas`.
  - `CHANNEL_MASK` becomes `228367` (97295 | 131072) and `ALL_PERMS` becomes `262143`.
  - The member-safe mask becomes `207895` (76823 | 131072). `GLOBAL_MASK` (33776) and the override mask (33264) do not change.
  - Default grant: the roles `system_key = 'verified'` and `name = 'Moderador'` (spec 12).
  - Creating a poll needs bits `131074` (CREATE_POLLS | SEND_MESSAGES) on the channel. Voting needs only VIEW (bit 1) at the moment of voting.
- **Limits** (`POLL_LIMITS` in TS, literals in SQL):
  - question 1–300 characters, after collapsing whitespace runs (newlines included) to one space and trimming;
  - 2–10 options of 1–80 characters each, normalized the same way and distinct case-insensitively;
  - `closes_at` in `[now() + 1 h, now() + 30 d]`.
- **Weights (spec 13)** come from the snapshot taken in `create_poll`, on the active chain:
  - `u = greatest(dao_positions.shares − locked_shares, 0)`, for `members.status = 'active'` only;
  - `linear` = `u`; `quadratic` = `_isqrt(u)`, the integer square root (floor);
  - only rows with weight > 0 are stored. A member absent from the snapshot weighs 0 in a weighted poll;
  - `equal` stores no snapshot and every ballot weighs 1;
  - the club fund (`dao_state.club_shares`) has no member row, so it never votes.
- **Results (spec 14b)** come from `_poll_tally`:
  - `voterCount` = all ballots; `weightedVoterCount` = ballots with weight > 0.
  - They are published only if `voterCount ≥ 3` and (`equal` or `weightedVoterCount ≥ 3`). Otherwise the status is `insufficient` and no per-option number is stored or returned.
  - Per option, `tenths = floor((2000·w + T) / (2·T))`, where `w` is the option's weight and `T` the total weight. That is the % rounded half-up to 1 decimal, as an integer from 0 to 1000.
  - Never returned: per-option voter counts, absolute weights, `T`, or anyone's weight but your own (and of yours, only whether it is > 0).
- **Error codes** (SQL raises them; `src/lib/errors.ts` gets the copy, exact):
  - `question_required`: `Escribe la pregunta, de 1 a 300 caracteres.`
  - `poll_options_invalid`: `Pon de 2 a 10 opciones distintas, de 1 a 80 caracteres cada una.`
  - `poll_closed`: `La encuesta ya está cerrada.`
  - `poll_not_editable`: `Una encuesta no se puede editar: cambiaría lo que otros ya han votado.`
  - Reused: `forbidden`, `not_found`, `invalid_input`, `closes_at_invalid` (F4d copy), `chain_invalid`, `slowmode`, `too_long`.
- **Notification:** the new kind `poll_closed`, with `channel_id` and `message_id` = the poll message and `data = {}`. It goes to every voter who is active at finalize. Its excerpt is the question, joined under RLS like message notices.
- **Realtime event** `poll_changed`, payload `{id: <poll message id>, channel_id, thread_root_id: null}`, on topic `channel:<channel_id>`, private. It uses the same receive policy as `bounty_changed`.
- **Generic project guards** (existing tests enforce them):
  - RLS on with no client policies;
  - every function `security definer set search_path = ''`;
  - `revoke ... from public, anon` (and from `authenticated` for service-only functions);
  - re-create a function by copying its **latest** definition (named per task) and changing only what the task says.
- **UI:**
  - Spanish "tú" copy, existing tokens, targets ≥ 44 px, no new dependencies;
  - color is never the only signal (bars always carry the % as text);
  - no horizontal scroll at 375 px;
  - load `ui-ux-pro-max` before styling (project rule).
- **Local DB:** `pnpm db:test`, `pnpm test:e2e` and `tests/integration` write the user's local DB. During tasks run single pgTAP files (`pnpm exec supabase test db supabase/tests/000_helpers.test.sql supabase/tests/<file>`) and `pnpm test:unit`; run the full suites only where a step says so and the controller has cleared it (memory rule).

## Review Focus
1. **Someone tries to learn a member's vote:**
   - an admin or treasurer through any RPC;
   - a member through PostgREST on `polls` or `poll_options`;
   - the service role through REST on `private`;
   - anyone after the close, from what is left.

   Expected: no path. `has_schema_privilege(..., 'private', 'USAGE')` is false for all three API roles. `poll_details` returns `myOptionId` only for the caller and only while the poll is open. After finalize every ballot has `option_id = null` and the snapshot is gone. No `audit_log` row mentions a vote. Tests in Task 2 (grants) and Task 3.
2. **Voting at or after `closes_at` before the cron has finalized, or by someone who lost VIEW** (an overwrite, a ban, a view-gate). Expected: `poll_closed` / `forbidden`, and the open-time results never move after `closes_at`. Test in Task 3.
3. **Few voters.** Expected: `insufficient`, and no `result_tenths` is stored, in these cases:
   - 2 voters;
   - a weighted poll with 4 voters of whom only 1 or 2 have participaciones (one donor's choice would be 100 % of the bar and could unmask them);
   - a weighted poll where nobody has weight.

   Test in Task 3.
4. **Shares moving during a weighted poll:** a donation credited after creation, a withdrawal request locking shares after creation, a member with locked shares at creation, the club fund. Expected: the weights are those of the creation snapshot over unlocked shares, and the club never weighs. Test in Task 2.
5. **Editing or deleting a poll message.** Expected:
   - `edit_message` raises `poll_not_editable` and the UI offers no "Editar";
   - deleting (author or moderator; hard, or soft when it has thread replies) removes the `polls` row, its options and its ballots, and the soft-deleted tombstone has `kind = 'text'`;
   - `delete_channel` with a poll inside succeeds.

   Test in Task 2.

---

### Task 1: SQL + TS — CREATE_POLLS channel bit (131072)

**Files:**
- Create: `supabase/migrations/20261019500001_poll_permission.sql`, `supabase/tests/970_poll_permission.test.sql`
- Modify:
  - `src/lib/permissions/bits.ts`, `src/lib/permissions/labels.ts`;
  - `tests/fixtures/channel-permissions.json` and `tests/fixtures/channel-cases.ts`;
  - the tests that pin the old literals: `supabase/tests/020_permissions`, `030_bootstrap`, `050_moderation`, `060_permissions_v2`, `700_bounty_permission`, `810_gating`; `tests/unit/permissions.test.ts`, `permission-labels.test.ts`, `overwrite-actions.test.ts`, `role-form.test.tsx`.

**Interfaces:**
- Produces (TS):
  - `Perm.CREATE_POLLS = 131072n`, `ALL_PERMS = 262143n`, `CHANNEL_MASK = 228367n`;
  - `SAFE_ROLE_MASK` includes `Perm.CREATE_POLLS` (= `207895n`);
  - `CHANNEL_BIT_LIST` gains `{ bit: Perm.CREATE_POLLS, label: "Crear encuestas" }` after "Crear bounties". Update the count comments to 11 and 17.
- Produces (SQL), redefined from the latest bodies, changing only the mask literals as in `20261018700001`:
  - `channel_permissions` (latest `20261018800002_gating`): `v_gate_mask := 262143`, admin returns `228367`, the view-gate clears `~228367`, and the final mask is `228367`;
  - `member_global_permissions`, `can`, `has_any_channel_perm`, `set_overwrite`, `create_role` and `update_role` (latest `20261018700001`): `131071 → 262143`, `97295 → 228367`, `76823 → 207895`;
  - the `permission_overwrites_allow_check` / `_deny_check` constraints become `& ~228367`;
  - `update public.roles set permissions = permissions | 131072 where system_key = 'verified' or name = 'Moderador'`.

- [ ] **Step 1: Write the failing pgTAP** `970_poll_permission.test.sql`, modelled on `700`:
  - Verificado and Moderador hold 131072, and @everyone is unchanged (`8199`);
  - an overwrite allowing 131072 is accepted, and 262144 is rejected (`23514`);
  - `channel_permissions` returns 131072 for a member granted it, and omits it when denied;
  - the admin gets `228367` per channel and `262143` globally;
  - `can(ch, 131072)` and `has_any_channel_perm(131072)` work, and `can(null, 262144)` raises `invalid_input`;
  - a non-admin delegate can put 131072 on @everyone and on Verificado, but not `131072 | 8`;
  - `create_role(..., 262143 & ~512)` succeeds and `262144` raises `invalid_input`;
  - a view-gated channel the member fails returns 0 (the gate still clears every channel bit, the new one included).
- [ ] **Step 2: Write the failing TS assertions:**
  - `Perm.CREATE_POLLS === 131072n`, `ALL_PERMS === 262143n`, `CHANNEL_MASK === 228367n`, `SAFE_ROLE_MASK === 207895n`;
  - the label `Crear encuestas`;
  - the parity fixture gains a case `poll_bit_cascade` (an @everyone allow of 131072 on the category, a member deny on the channel), and its admin `expected` becomes `"228367"`.
- [ ] **Step 3: Run** the 970 pgTAP file and `pnpm vitest run tests/unit/permissions.test.ts tests/unit/permission-labels.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** the migration and the TS changes. Update the old literal assertions in the listed tests (`131071 → 262143`, `97295 → 228367`, `76823 → 207895`, and "131072 rejected" → "262144 rejected").
- [ ] **Step 5: Run** pgTAP 970, 020, 030, 050, 060, 080, 700 and 810, then `pnpm test:unit` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(permissions): CREATE_POLLS channel bit (Crear encuestas), granted to Verificado and Moderador`.

### Task 2: SQL — polls schema, private ballots and snapshot, create_poll, edit/delete integration

**Files:**
- Create: `supabase/migrations/20261019500002_polls.sql`, `supabase/tests/971_polls.test.sql`

**Interfaces:**
- Consumes: bit 131072 (Task 1); `_post_message_core(uuid, uuid, jsonb, text, boolean, uuid, uuid, jsonb, text)` (latest `20261016200006`); `_notify_message(uuid, boolean)`; the F4d schema `private`.
- Schema:
  - `messages_kind_check` (latest `20261018700002`) adds `'poll'`.
  - `public.polls`:
    - `message_id uuid primary key references messages on delete cascade`, `channel_id uuid not null references channels on delete cascade`, `author_id uuid not null references members`
    - `chain_id int not null` (check in 59144/59141), `weight_mode text not null` (check in `equal`/`linear`/`quadratic`), `closes_at timestamptz not null`, `created_at timestamptz not null default now()`
    - `finalized_at timestamptz`, `voter_count int`, `weighted_voter_count int`, `results_published boolean`
    - Check: `finalized_at`, `voter_count`, `weighted_voter_count` and `results_published` are all null or all set.
    - Index `(closes_at) where finalized_at is null`.
  - `public.poll_options`:
    - `id uuid primary key default gen_random_uuid()`, `poll_id uuid not null references polls(message_id) on delete cascade`
    - `position smallint` (1–10), `label text` (1–80, `= btrim(label)`), `result_tenths int null` (0–1000)
    - Unique `(poll_id, position)`, and a unique index on `(poll_id, lower(label))`.
  - `private.poll_weight_snapshots (poll_id uuid references public.polls(message_id) on delete cascade, member_id uuid references public.members, weight numeric(78,0) not null check (weight > 0), primary key (poll_id, member_id))`.
  - `private.poll_votes (poll_id uuid references public.polls(message_id) on delete cascade, member_id uuid references public.members, option_id uuid null references public.poll_options(id) on delete cascade, voted_at timestamptz not null default now(), primary key (poll_id, member_id))`.
  - RLS is on for all four tables. `revoke all` on both private tables `from public, anon, authenticated, service_role`.
  - `notifications_kind_check` = the list from `20261019400002` plus `poll_closed`.
- Produces (internal, no grants): `_isqrt(p numeric) returns numeric` (immutable, strict). It returns `floor(sqrt(p))`, corrected by ±1 until `r² ≤ p < (r+1)²`, and raises `invalid_input` for negatives.
- Produces (member JWT): `create_poll(p_channel uuid, p_question text, p_options text[], p_closes_at timestamptz, p_weight_mode text) returns uuid` (the message id). Checks, in order:
  - `forbidden`: not an active member, a null channel, or `(channel_permissions & 131074) <> 131074`;
  - `question_required`;
  - `poll_options_invalid`: a null array or element, a count outside 2–10, a length outside 1–80 after normalization, or a case-insensitive duplicate;
  - `invalid_input`: an unknown mode;
  - `closes_at_invalid`;
  - `chain_invalid`: the `app_config.active_chain_id` is unreadable.

  It then builds the body in SQL, as one paragraph holding the normalized question as a single text node, and calls `_post_message_core(v_me, p_channel, v_body, null, false, null, null, null, null)`. Next it sets `kind = 'poll'`, inserts the poll, the options (position = array order) and, for `linear`/`quadratic`, the snapshot per the Global Constraints. Last, it calls `_notify_message(v_id, false)`. It writes no audit row.
- Modifies:
  - `edit_message` (latest `20261018600001`): `kind = 'poll'` raises `poll_not_editable`, checked after the existing `forbidden` test.
  - `delete_message` (latest `20261018800021`): before choosing hard or soft, `delete from public.polls where message_id = p_id`. The cascades take the options, ballots and snapshot. The soft path's existing `kind` rule then turns the tombstone into `'text'`.

- [ ] **Step 1: Write the failing pgTAP** `971_polls.test.sql`. The setup has a text channel, member A (Verificado), member P (plain, no 131072) and SuperAdmin S, and seeds 59141 as the active chain with positions:
  - A: `9·10¹⁸` shares, with `1·10¹⁸` locked;
  - B: `4·10¹⁸`;
  - C: `0`;
  - D: `1·10¹⁸`, but banned;
  - `dao_state.club_shares = 5·10¹⁸`.

  Assertions:
  1. **Grants:**
     - `create_poll` is not executable by `anon`, and `_isqrt` by nobody but the owner;
     - `has_schema_privilege(r, 'private', 'USAGE')` is false for `anon`, `authenticated` and `service_role`;
     - as `authenticated`, `select * from private.poll_votes` raises `42501`;
     - as `authenticated`, `select count(*) from public.polls` and `public.poll_options` return 0 (RLS, no policy).
  2. **`_isqrt`:** `0→0`, `1→1`, `15→3`, `16→4`, `10^18 → 10^9`, and `2^256−1 → 340282366920938463463374607431768211455`; `-1` raises `invalid_input`.
  3. **Guards:**
     - P → `forbidden`;
     - A with SEND_MESSAGES denied on the channel → `forbidden`;
     - `'   '` → `question_required`, and 301 characters → `question_required`;
     - `'{Sí}'`, 11 options, `'{Sí,"  sí "}'`, an 81-character option, or `'{Sí,null}'` → `poll_options_invalid`;
     - `'majority'` → `invalid_input`;
     - closing in 59 minutes, or in 30 days and 1 minute → `closes_at_invalid`.
  4. **Create, equal:**
     - it returns a message id with `kind = 'poll'`;
     - `body_text = '¿Pizza o sushi?'` after `"¿Pizza\n  o sushi?"` is normalized;
     - 3 options in order with trimmed labels;
     - `chain_id = 59141`, and no snapshot rows (read as the owner);
     - one `message_created` broadcast (as in `230_realtime`) and the channel-follow notices of `_notify_message`.
  5. **Create, linear and quadratic (Review Focus 4):**
     - linear snapshot = A `8·10¹⁸` and B `4·10¹⁸` only (C has 0, D is banned, the club has no row);
     - quadratic = A `_isqrt(8·10¹⁸)` and B `2·10⁹`;
     - after creation, raising B's shares and A's `locked_shares` leaves the snapshot unchanged.
  6. **Edit:** `edit_message` on the poll by A raises `poll_not_editable`, and a normal message still edits.
  7. **Delete (Review Focus 5):**
     - A deletes a poll with no replies: the message, the poll, the options and every ballot row are gone (a ballot is seeded as the owner first);
     - a poll with a thread reply, deleted by a moderator: the message becomes a tombstone with `kind = 'text'` and no `polls` row is left;
     - `delete_channel` on a channel that holds a poll succeeds.
- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** 971, 970, 200, 210, 230 and 850. Expected: PASS.
- [ ] **Step 5: Commit** `feat(polls): poll messages with private ballots and a creation-time weight snapshot (SQL)`.

### Task 3: SQL — vote, change, results with privacy, finalize, notifications, realtime

**Files:**
- Create: `supabase/migrations/20261019500003_poll_votes.sql`, `supabase/tests/972_poll_votes.test.sql`

**Interfaces:**
- Consumes: the Task 2 schema and `_isqrt`.
- Produces (internal): `_poll_tally(p_poll uuid) returns jsonb` → `{voterCount, weightedVoterCount, status: 'published' | 'insufficient', results: [{optionId, tenths}] | null}`, per the Global Constraints, with options in position order. It reads the private tables, and is used both on read and at finalize, so the two always agree.
- Produces (member JWT):
  - `cast_poll_vote(p_poll uuid, p_option uuid) returns jsonb` → `{status: 'cast' | 'changed' | 'same', voterCount}`.
    - `forbidden`: not an active member, or no VIEW (bit 1) on the poll's channel right now;
    - `not_found`: an unknown poll;
    - `poll_closed`: `now() ≥ closes_at` or `finalized_at` set, checked after taking the poll row `for share`;
    - `invalid_input`: an option that does not belong to the poll.

    It upserts `private.poll_votes`. Only `cast` (a new voter) sends `poll_changed`; a change sends nothing. No audit row.
  - `poll_details(p_message_ids uuid[]) returns table (message_id uuid, weight_mode text, closes_at timestamptz, closed boolean, voter_count int, options jsonb, my_option_id uuid, i_voted boolean, my_has_weight boolean, results_status text, results jsonb)`.
    - Rows: polls whose message is not deleted, in `visible_channels()`, for an active caller only.
    - `options` = `[{id, label, position}]`.
    - **Open:** `voter_count` is the live count, `my_option_id` the caller's choice, `my_has_weight` whether a snapshot row exists for the caller (null for `equal`), `results_status = 'pending'` and `results` null.
    - **Closed, not finalized:** the values come from `_poll_tally`; `my_option_id` and `my_has_weight` are null and `i_voted` comes from the ballots.
    - **Finalized:** the values come from the stored columns (`results_published ? 'published' : 'insufficient'`, `result_tenths`), with the same nulls.
- Produces (service role): `close_due_polls() returns jsonb` → `{finalized}`.
  - It covers polls with `closes_at ≤ now()` and `finalized_at is null`, by `closes_at, message_id`, `for update`. For each one it:
    1. tallies;
    2. stores `result_tenths` only when published, plus `voter_count`, `weighted_voter_count`, `results_published` and `finalized_at = now()`;
    3. inserts one `poll_closed` notification per voter who is still active (`actor_id` null);
    4. runs `update private.poll_votes set option_id = null` for the poll;
    5. deletes its snapshot rows;
    6. sends `poll_changed`.
- Modifies `_push_build` (latest `20261019400003`):
  - `poll_closed` joins the `('mention','reply','channel_message')` checks, so a null `channel_id` returns no row, and joins their URL and excerpt branch: `/c/<channel>?m=<message>&h=n<id>`, with the question as the excerpt.
  - Title `Encuesta cerrada`, phrase `Ha cerrado la encuesta en la que votaste en #<canal>`.
  - The other kinds are unchanged.

- [ ] **Step 1: Write the failing pgTAP** `972_poll_votes.test.sql`. The setup has voters V1–V5, a treasurer T (bit 256), SuperAdmin S and A as the author. Positions for the weighted cases are seeded so the linear snapshot is V1 6, V2 3, V3 1 (×10¹⁸), with V4 and V5 at 0.
  1. **Grants:** `close_due_polls` is service-only; `cast_poll_vote` and `poll_details` are not executable by `anon`; `_poll_tally` is owner-only.
  2. **Vote and change:**
     - V1 votes and gets `cast` with `voterCount = 1`;
     - V1 votes the same option and gets `same`, then another option and gets `changed`, with the count still 1;
     - one `poll_changed` was sent in total (counted as in `720_bounty_realtime`);
     - an option of another poll → `invalid_input`;
     - a member with VIEW denied by an overwrite → `forbidden`;
     - a banned member → `forbidden`.
  3. **Open reads (Review Focus 1):**
     - V1 sees `my_option_id` = their option and `voter_count = 3` once V2 and V3 have voted;
     - V2 sees their own option, not V1's;
     - T and S see `my_option_id` null, `results_status = 'pending'` and `results` null;
     - no function returns a ballot: `select count(*) from audit_log where payload::text like '%<option id>%'` is 0.
  4. **Closed before finalize (Review Focus 2):**
     - with `closes_at` moved 1 minute into the past, `cast_poll_vote` raises `poll_closed`;
     - `poll_details` gives `closed = true`, `my_option_id` null, `i_voted = true` for V1 and `results` from the tally.
  5. **Equal results:** 3 voters (2 for Pizza, 1 for Sushi) give `tenths` `[667, 333, 0]` and `voter_count = 3`.
  6. **Linear results:** V1 votes X; V2, V3 and V4 vote Y. V4 weighs 0, so this gives `[600, 400]`, `voter_count = 4` and `weightedVoterCount = 3`, and the result is published.
  7. **Quadratic results:** snapshots 9, 4 and 1 ×10¹⁸ give 3, 2 and 1 ×10⁹. Votes X, Y, Y give `[500, 500]`.
  8. **Insufficient (Review Focus 3):** each case gives `results_status = 'insufficient'` and null `results`:
     - 2 voters in an equal poll;
     - a weighted poll with 4 voters but only V1 and V2 holding weight;
     - a weighted poll in which nobody holds weight.
  9. **Finalize:**
     - `close_due_polls()` gives `{finalized: n}`, with stored `result_tenths` only on published polls (null everywhere on the insufficient ones);
     - every voter gets one `poll_closed` notice and the non-voting author gets none;
     - every ballot of the poll has `option_id is null` and the snapshot rows are gone;
     - `poll_details` returns the same results as before finalizing;
     - a second call gives `{finalized: 0}`;
     - a voter banned before finalize gets no notice, but their ballot still counted.
  10. **Push:** `_push_build` for `poll_closed` returns `Encuesta cerrada`, `Ha cerrado la encuesta en la que votaste en #<canal>: «<question>»` and the URL with `?m=` and `&h=n`. For a recipient who lost VIEW it returns no row.
- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** 972, 971, 310 and 350 (push). Expected: PASS. Then run `pnpm db:test` once, if the controller allows it.
- [ ] **Step 5: Commit** `feat(polls): secret votes changeable until close, results only at close with a 3-voter floor, sealed ballots and voter notices (SQL)`.

### Task 4: Server — poll reads in the chat hydration, actions, cron step, errors, notification copy

**Files:**
- Create: `src/lib/polls/polls.ts` (isomorphic), `src/lib/polls/queries.ts`, `src/lib/polls/actions.ts`, `src/lib/polls/cron.ts`
- Modify:
  - `src/lib/chat/model.ts`, `src/lib/chat/queries.ts`, `src/lib/chat/context.ts`, `src/lib/chat/realtime.ts`;
  - `src/lib/errors.ts`;
  - `src/app/api/cron/dao/route.ts`;
  - `src/lib/notifications/queries.ts`, `src/components/notifications/notification-item.tsx`.
- Test: `tests/unit/polls/polls.test.ts`, `queries.test.ts`, `actions.test.ts`, `cron.test.ts`; `tests/unit/chat/poll-hydrate.test.ts`, `tests/unit/chat/context.test.ts` (extend); `tests/unit/treasury/cron-route.test.ts` (extend); `tests/unit/notifications/poll-notification.test.tsx`

**Interfaces:**
- Consumes: the Task 2–3 RPCs and `schedulePushDispatch`.
- Produces in `polls.ts`:
  - `type PollWeightMode = "equal" | "linear" | "quadratic"`
  - `const POLL_LIMITS = { questionMax: 300, optionsMin: 2, optionsMax: 10, optionMax: 80, minMs: 3_600_000, maxMs: 30 * 86_400_000 }`
  - `interface PollOption { id: string; label: string; position: number }`
  - `type PollResults = { status: "pending" } | { status: "insufficient" } | { status: "published"; tenths: Record<string, number> }`
  - `interface PollDetail { messageId: string; weightMode: PollWeightMode; closesAt: string; closed: boolean; voterCount: number; options: PollOption[]; myOptionId: string | null; iVoted: boolean; myHasWeight: boolean | null; results: PollResults }`
  - `normalizePollText(s: string): string`, which collapses whitespace and trims, like SQL
  - `validatePollDraft(d: { question: string; options: string[]; closesAt: Date; now: Date }): { ok: true } | { ok: false; code: "question_required" | "poll_options_invalid" | "closes_at_invalid"; field: "question" | "options" | "closesAt" }`, with the same rules as `create_poll`
  - `pollModeLabel(m: PollWeightMode): string`, giving exactly `1 persona, 1 voto` / `Ponderada · lineal según participación` / `Ponderada · cuadrática según participación`
  - `formatTenths(t: number): string` (`333 → "33,3 %"`, `1000 → "100 %"`, `0 → "0 %"`)
  - `voterCountLabel(n: number): string` (`1 votante` / `n votantes`)
  - `pollTimeLeft(closesAt: string, nowMs: number): string`, giving `Cierra en 3 d 4 h`, `Cierra en 5 h 10 min`, `Cierra en 12 min`, `Cierra en menos de 1 min` or `Cerrada`
  - `parsePollRow(row: unknown): PollDetail | null`, which rejects malformed rows
- Produces in `queries.ts`: `getPollDetails(supabase: SupabaseClient, messageIds: readonly string[]): Promise<Map<string, PollDetail>>`. An empty input makes no RPC call; an RPC error gives an empty map, so the card falls back to the plain message.
- Produces in `actions.ts` (`"use server"`, the `Fail` shape of `src/lib/bounties/actions.ts`, including `slowmodeSeconds`):
  - `createPollAction(input: { channelId: string; question: string; options: string[]; closesAt: string; weightMode: PollWeightMode }): Promise<{ ok: true; messageId: string } | Fail>`. It runs `validatePollDraft` first (with no RPC call on failure), then calls the RPC with the user's client, then `schedulePushDispatch()`.
  - `votePollAction(pollId: string, optionId: string): Promise<{ ok: true; status: "cast" | "changed" | "same"; voterCount: number } | Fail>`. Non-uuid input gives `invalid_input` with no RPC call.
- Produces in `cron.ts` (server-only): `finalizeDuePolls(): Promise<{ finalized: number }>`. It calls `close_due_polls` with the admin client, then `schedulePushDispatch()` when `finalized > 0`.
- Modifies:
  - `ChatMessage.kind` and `MessageRow.kind` add `"poll"`; `ChatMessage.poll?: PollDetail | null`; `ViewerPermissions.canPoll?: boolean`.
  - `hydrateMessages` loads `getPollDetails` for non-deleted `kind === "poll"` rows, in the same `Promise.all` as the bounties.
  - `loadChatContext` sets `canPoll: hasPerm(bits, Perm.CREATE_POLLS) && hasPerm(bits, Perm.SEND_MESSAGES)`.
  - `CHANNEL_EVENTS` adds `"poll_changed"`, which chat-view already reconciles by id.
  - The cron route runs `finalizeDuePolls()` once after the per-chain loop, isolated, and the response becomes `{ chains, polls: { finalized } | "failed" }`.
  - `NotificationKind` adds `"poll_closed"`. `hrefFor` treats it like a message notice (`/c/<channel>?m=<message>&h=n<id>`), its excerpt is the question, and `notificationCopy` gives `Ha cerrado la encuesta en la que votaste en #<canal>`.
  - `errors.ts` gains the four new codes with the exact copy.

- [ ] **Step 1: Failing tests:**
  - **polls.ts:**
    - `formatTenths` for 333, 1000, 0 and 5 (`"0,5 %"`);
    - `pollTimeLeft` at each boundary (3 d 4 h, 59 min, 30 s, past);
    - `validatePollDraft` rejects each case listed in Task 2 step 1.3 with the same code, and accepts a valid draft;
    - `parsePollRow` turns `results_status: "published"` with `[{optionId, tenths}]` into `tenths`, and returns null for an unknown mode or a missing `options` array.
  - **queries:** no call for `[]`; the map is keyed by `message_id`; an error gives an empty map.
  - **actions:**
    - a bad draft gives its code and no RPC call;
    - a valid draft calls `create_poll` with `p_question` normalized, `p_options`, `p_closes_at` as ISO and `p_weight_mode`;
    - `slowmode` carries `slowmodeSeconds`;
    - `votePollAction("x", …)` gives `invalid_input` and no RPC call, and `poll_closed` maps to its copy.
  - **hydrate:** a `poll` row gets `poll` from `getPollDetails`, and a deleted one gets `null`.
  - **context:** `canPoll` needs both bits.
  - **cron:** `finalizeDuePolls` returns `{finalized}`; the route reports `polls: "failed"` when it throws, and the chain steps still ran.
  - **notifications:** the href, the copy, and the excerpt is the question.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/polls tests/unit/chat/poll-hydrate.test.ts tests/unit/notifications/poll-notification.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test:unit` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(polls): poll reads in the chat, create/vote actions, cron finalize step, poll_closed notice copy`.

### Task 5: UI — `/encuesta` in the composer, the poll dialog, the guide section

**Files:**
- Create: `src/components/chat/poll-dialog.tsx`
- Modify:
  - `src/lib/chat/mentions.ts`: `SlashCommandId` adds `"encuesta"`, and `SLASH_COMMANDS` adds `{ id: "encuesta", label: "/encuesta", description: "Crear una encuesta con voto secreto" }` after `bounty`. `filterSlashCommands` gets the option `hasPoll?: boolean`.
  - `src/components/chat/composer-editor.tsx` (`onPoll?: () => void`) and `src/components/chat/composer.tsx` (`canPoll?: boolean`, mirroring `canBounty` / `openBounty`);
  - `src/components/chat/chat-view.tsx`: the root composer only gets `canPoll={viewer.canPoll === true && viewer.canPost === true}`;
  - `src/lib/guide/sections.ts`, `src/components/guide/guide-content.tsx`, `src/lib/search/actions-list.ts` (`GUIDE_KEYWORDS`).
- Test: `tests/unit/chat/poll-dialog.test.tsx`, `tests/unit/chat/composer-poll.test.tsx`, `tests/unit/chat/mentions.test.ts` (extend); `tests/unit/guide/*` (extend)

**Interfaces:**
- Consumes: `createPollAction`, `validatePollDraft`, `POLL_LIMITS`, `rpcErrorMessage`, `HowItWorksLink`.
- Produces:
  - `PollDialog({ open, onOpenChange, channelId, initialQuestion, onPosted, onSlowmode }: { open: boolean; onOpenChange: (o: boolean) => void; channelId: string; initialQuestion: string; onPosted: (id: string) => void; onSlowmode?: (seconds: number) => void })`
  - The guide slug `encuestas`: `{ slug: "encuestas", title: "Encuestas", summary: "Cómo se vota en secreto, cuánto pesa tu voto y cuándo se ven los resultados." }`, placed after `fondo`.

- [ ] **Step 1: Failing tests:**
  - **Slash:**
    - `filterSlashCommands("enc", { canAttach: true, hasAlpha: false, hasPoll: true })` gives `/encuesta`, and gives nothing without `hasPoll`;
    - the composer shows `/encuesta` only with `canPoll`, and choosing it opens `Nueva encuesta` with the composer text as the question (as `/bounty`).
  - **Dialog:** the title is `Nueva encuesta`. Fields:
    - `Pregunta` (textarea, counter `n/300`);
    - `Opciones`: two inputs `Opción 1` and `Opción 2`, a button `Añadir opción` that disappears at 10, and `Quitar opción N` from the third option on;
    - `Cierre`: a radio group `1 hora`, `1 día`, `3 días`, `7 días` and `Otra fecha`, where `Otra fecha` reveals a `datetime-local` input. The help is `Entre 1 hora y 30 días desde ahora.`;
    - `Peso del voto`: radios `1 persona, 1 voto` (default), `Lineal según participación` with `Cada voto pesa lo que sumaban tus participaciones sin bloquear al crear la encuesta.`, and `Cuadrática según participación` with `Cada voto pesa la raíz cuadrada de esas participaciones: quien más aportó pesa más, pero menos que en lineal.`

    It also shows the note `El voto es secreto: nadie, tampoco los admins, verá qué vota cada uno. Los resultados se publican al cerrar, si votan al menos 3 personas. La encuesta es consultiva: no ejecuta nada por sí sola.` and `HowItWorksLink section="encuestas"`.
  - **Dialog behaviour:**
    - submitting with an empty question shows the `question_required` copy on the field (`aria-invalid`, `aria-describedby`), and a duplicate option shows `poll_options_invalid`, both with no action call;
    - `Publicar encuesta` calls `createPollAction` once, even on a double click, with `closesAt` = now + the preset as ISO;
    - success closes the dialog and calls `onPosted(id)`;
    - `slowmode` calls `onSlowmode`, and other errors show in `role="alert"`.
  - **Guide:**
    - `GUIDE_SECTIONS` has `encuestas` after `fondo`;
    - the page has the subsections `Qué es`, `Cómo se vota`, `Cuánto pesa tu voto`, `Voto secreto` and `Resultados`;
    - between them the text mentions `/encuesta`, `Crear encuestas`, the three modes, `participaciones sin bloquear` at creation, that the Fondo del club does not vote, `hasta el cierre`, `al menos 3`, `% del peso`, and `consultiva`;
    - the command palette lists `Guía: Encuestas`.
- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Implement.** Load `ui-ux-pro-max` first, reuse `BountyDialog`'s layout and field patterns, and keep the dialog usable at 375 px with the option list scrolling inside the dialog.
- [ ] **Step 4: Run** `pnpm test:unit`, `pnpm typecheck` and `pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(polls): /encuesta command with the poll dialog, and the Encuestas guide section`.

### Task 6: UI — poll card in the message list, live updates, no edit

**Files:**
- Create: `src/components/chat/poll-card.tsx` (client)
- Modify:
  - `src/components/chat/message-item.tsx`: `message.kind === "poll"` renders `PollCard` under the question (the message body). `canEdit` is false for polls.
  - `src/components/chat/chat-view.tsx`: `onPollChanged` → `reconcile(message.id)`, as `bountyChanged`.
- Test: `tests/unit/chat/poll-card.test.tsx`, `tests/unit/chat/message-item-poll.test.tsx`, `tests/unit/chat/chat-view-poll.test.tsx`

**Interfaces:**
- Consumes: `PollDetail`, `votePollAction`, `pollModeLabel`, `formatTenths`, `voterCountLabel`, `pollTimeLeft`, `formatWhen` (`src/lib/treasury/panel.ts`), `HowItWorksLink`.
- Produces: `PollCard({ poll, onChanged, readOnly, now }: { poll: PollDetail; onChanged: () => void; readOnly?: boolean; now?: () => number })`. `readOnly` is used in the pinned variant and renders no vote controls.

- [ ] **Step 1: Failing tests:**
  - **Header:**
    - the badge `Encuesta` and `pollModeLabel`;
    - `pollTimeLeft`, with `Cierra el <formatWhen>` as its `title`;
    - `voterCountLabel`;
    - `Voto secreto · resultados al cerrar` and `Consultiva: el resultado no se aplica solo.`;
    - a `¿Cómo funciona?` link to the guide.
  - **Open, not voted:**
    - a `role="radiogroup"` named `Opciones` with one ≥ 44 px `role="radio"` per option, plus `Aún no has votado.`;
    - `Votar` is disabled until an option is picked, then calls `votePollAction` once (even on a double click) and then `onChanged`.
  - **Open, voted:**
    - `Tu voto: <label>` and `Puedes cambiarlo hasta el cierre.`;
    - `Cambiar voto` is enabled only when the selection differs;
    - an error shows the mapped copy in `role="alert"`;
    - no percentages are rendered anywhere while `results.status === "pending"`.
  - **Weighted:**
    - `myHasWeight === false` shows `Tu voto pesa 0: en esta encuesta cuentan las participaciones sin bloquear que tenías al crearla, y no tenías. Puedes votar igualmente.`;
    - `true` shows `Tu voto pesa según tus participaciones al crear la encuesta.`
  - **Closed:**
    - `Cerrada`, and `Votaste` when `iVoted`, without naming the option;
    - no radios.
  - **Published:**
    - a list named `Resultados`, one item per option in position order: `<label>`, `formatTenths`, and a bar whose width is `tenths / 10 %`, `aria-hidden`;
    - the footer `<n votantes> · % del peso total` (weighted) or `<n votantes> · % de los votos` (equal).
  - **Insufficient:**
    - `Muy pocos votos para mostrar los resultados sin revelar quién votó qué.` plus `voterCountLabel`;
    - weighted polls add `En una encuesta ponderada hacen falta al menos 3 votantes con participaciones.`
  - **Live:**
    - with fake timers, the time-left text updates every minute;
    - when `closesAt` passes, `onChanged` is called once. The timer is only armed when less than 24 h remain, to avoid the `setTimeout` overflow, and is re-armed by the minute ticker.
  - **Message item:**
    - a poll message by the viewer has no `Editar` in its menu;
    - the pinned variant renders `readOnly`;
    - a poll whose `poll` is null renders the plain question.
  - **Chat view:** a `poll_changed` event for a listed poll re-reads it, and the new voter count shows without a reload (as `chat-view-bounty.test.tsx`).
- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Implement.** Load `ui-ux-pro-max` first and reuse the bounty card's tokens. Results are text plus a bar, never colour alone. At 375 px, long option labels wrap and the % stays right-aligned.
- [ ] **Step 4: Run** `pnpm test:unit`, `pnpm typecheck` and `pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(polls): poll card in the chat — secret vote, change until close, live count, results bars at close`.

### Task 7: E2E

**Files:**
- Modify `e2e/helpers/dao.ts`:
  - new `seedPosition(memberId: string, shares: bigint, locked = 0n)`, using the service role to upsert `dao_positions` on `CHAIN_ID` and add to `dao_state.total_shares`;
  - new `agePoll(messageId: string, closedSecondsAgo: number)`, which sets `polls.closes_at` back;
  - `resetLocalDao` also deletes the notices of kind `poll_closed`.
- Create: `e2e/f4e-polls.spec.ts`

- [ ] **Step 1: Write the spec.** It runs serially, calls `resetLocalDao` in `beforeAll` and `afterAll`, and uses the f3c actors pattern: admin (SuperAdmin), A (Verificado), and B, C and D (plain members).
  1. **Permission:**
     - A types `/enc` in `general` and sees `/encuesta`;
     - B does not see it;
     - `rpcAs(b.context, "create_poll", …)` returns `forbidden`.
  2. **Create, equal:**
     - A publishes `¿Pizza, sushi o tacos?` with the options `Pizza`, `Sushi` and `Tacos`, `1 hora`, `1 persona, 1 voto`;
     - B's open page shows the card without a reload, with `0 votantes` and `Cierra en 59 min` or `Cierra en 1 h`.
  3. **Vote and change:**
     - B votes `Pizza` and sees `Tu voto: Pizza`; A's page shows `1 votante` live;
     - B changes to `Sushi`, and the count stays at 1;
     - C votes `Sushi` and D votes `Pizza`, which makes `3 votantes`;
     - no page shows a `%`;
     - the admin's `poll_details` via `rpcAs` gives `my_option_id` null;
     - `service().schema("private").from("poll_votes").select()` returns an error (Review Focus 1).
  4. **Close and results:**
     - `agePoll(id, 60)`; B reloads and sees `Sushi 66,7 %`, `Pizza 33,3 %`, `Tacos 0 %`, `3 votantes · % de los votos` and `Votaste`;
     - `runCron()`: B, C and D each have one bell notice `Ha cerrado la encuesta en la que votaste en #general`, and A has none;
     - the results are unchanged after the cron.
  5. **Insufficient:** a poll with 2 voters, aged, shows `Muy pocos votos para mostrar los resultados sin revelar quién votó qué.`
  6. **Weighted:**
     - `seedPosition` gives A 6, C 3 and D 1 participaciones (×10¹⁸); B has none;
     - A creates a `Lineal según participación` poll;
     - B sees the `Tu voto pesa 0…` copy and votes anyway;
     - A votes `Sí`, and B, C and D vote `No`;
     - aged and reloaded, it shows `Sí 60,0 %`, `No 40,0 %` and `4 votantes · % del peso total`.
  7. **Edit and delete:**
     - A's poll menu has no `Editar`;
     - A deletes the insufficient poll and it disappears from B's page live.
  8. **No browser errors** in any context (the same filter as f3c).
- [ ] **Step 2: Run** `pnpm test:e2e e2e/f4e-polls.spec.ts` (port 3000 free; the controller authorizes the DB wipe) and iterate until green. Then run `e2e/f3c-bounties.spec.ts e2e/f4c-withdrawals.spec.ts e2e/f4e-polls.spec.ts` together, to prove order independence.
- [ ] **Step 3: Commit** `test(e2e): f4e polls — permission, secret vote and change, live count, results at close, 3-voter floor, weighted %, notices`.

---

## Plan decisions (for the controller's ledger)
- Plan decision: the new bit is `CREATE_POLLS = 131072`, the next free bit after `CREATE_BOUNTIES`. It goes in the member-safe mask and is granted to Verificado and Moderador, as spec 12 says ("como el de bounties").
- Plan decision: a poll needs `CREATE_POLLS` and `SEND_MESSAGES`, and is root-only (no `/encuesta` in threads). It is a message in the channel, like `/bounty`; its thread stays open for discussion.
- Plan decision: the question is the message body, built server-side as one plain paragraph (whitespace collapsed, 1–300 characters), and `polls` is keyed by `message_id` instead of the master plan's `thread_id`/`question`. Realtime, search, channel notices and deletion then all reuse the message path.
- Plan decision: a poll cannot be edited (`poll_not_editable`). Changing the question or the options after votes would change what people voted on.
- Plan decision: deleting a poll message (author or moderator) deletes the poll, its options and its ballots, and a soft-deleted tombstone becomes `text`. Nothing is kept that could later be linked to voters.
- Plan decision: ballots and weight snapshots live in the F4d `private` schema, which no API role (`anon`, `authenticated`, `service_role`) can use. A leaked service key or a treasurer cannot read a vote through PostgREST or any RPC.
- Plan decision: at finalize, ballots are sealed (`option_id := null`) and the snapshot is deleted. After the close no member↔option link exists even for the database owner. The residual trust is that a DB superuser could read open ballots before the close; the guide does not claim otherwise.
- Plan decision: "closed" is derived from `now() ≥ closes_at`. Results are computed on read from the frozen ballots, so they appear at the close instant. The cron only freezes the tallies, sends the notices and seals the ballots, so a slow cron delays notices, never results.
- Plan decision: once the poll is closed, the card shows `Votaste` but not which option, even before finalize. The view then does not change when the ballots are sealed.
- Plan decision: weights are snapshotted at creation (master plan §2, spec 13) from unlocked shares on the active chain, for active members, storing only positive weights. A later donation, withdrawal or join cannot move a running poll. Inactive members and the club fund never weigh.
- Plan decision: quadratic weight = `_isqrt(unlocked shares)`, an exact integer square root in SQL ("precisión fija y aritmética entera"). Shares already carry 18 decimals, so the root keeps 9 digits of precision with no scaling.
- Plan decision: eligibility is judged at the moment of voting (VIEW now, spec 14). A cast vote stands even if the voter is later banned or loses access. The tally after `closes_at` is then deterministic and identical on read and at finalize. Voters who are no longer active just get no notice.
- Plan decision: results need 3 voters, and in weighted modes also 3 voters with weight > 0. With fewer, one donor's choice would be the whole bar, which would reveal what a (possibly hidden) donor voted (anti-goal). Below the floor nothing per-option is stored or returned.
- Plan decision: results expose only `tenths` per option (rounded half-up to 1 decimal) and the total voter count. Absolute weights, the weight total and per-option voter counts are never returned, so no voter's participaciones can be backed out.
- Plan decision: a vote can be changed but not withdrawn. Spec 14 only asks for changes, and a monotonic voter count keeps the live count simple.
- Plan decision: `poll_changed` is broadcast only when a new voter is counted and at finalize, never on a change. A change is then invisible to others, while the spec's live voter count still updates.
- Plan decision: no audit-log row is written for votes or polls. An audit trail of votes would be exactly the record the anti-goal forbids.
- Plan decision: `poll_closed` goes to every still-active voter at finalize, through the cron (spec §19). It carries the channel and message, so RLS and `_push_build` drop it for anyone who can no longer see the channel. The author gets nothing unless they voted.
- Plan decision: the cron step `finalizeDuePolls` runs once per run after the per-chain loop and is chain-independent. A failure is reported as `polls: "failed"` and stops nothing else.
- Plan decision: the guide gets its own section `/guia/encuestas` instead of a subsection of `fondo`. Polls live in channels, not in the fund, and the card and the dialog link to it with `HowItWorksLink`.
- Plan decision: the card arms its close timer only when less than 24 h remain, re-checked by its minute ticker. A 30-day `setTimeout` would overflow the 2³¹ ms limit and fire at once.
