# Galaxy Survivor M6c-1 · Moderación: chats, denuncias, silencios y clanes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the panel gains **Moderación** (GDD §16.4):
- live view of the global chat and of each clan's;
- hide and restore messages;
- the **report queue**;
- mutes (list, mute, lift);
- clans: rename, kick, transfer the leadership, dissolve.

Moderators get into the panel and see only the chat parts (§16.1). Every action is audited.

**Architecture:**
- **Server:** a new `admin/moderation.ts` (service) plus `admin/moderation-routes.ts` under `/galaxy/api/admin/moderation/*` and `/galaxy/api/admin/clans/*`.
  - The chat routes use `requireStaff`, which allows moderator, admin and superadmin signed in with TOTP. The clan routes use `requireAdmin`.
  - The in-game hide and mute (`/chat/messages/:id/hide`, `/chat/mutes`) now write the audit too, and the mute uses `guardTarget`.
- **Migration** `galaxy_chat_report_reviews`: the last review of each reported message.
- **Web:** `/admin/moderacion` with sub-routes (Denuncias, Chat en vivo, Silencios, Clanes). The live view polls every 5 s.
- **`ActionDialog`** is made generic (a URL instead of a player's name) so moderation reuses it.

**Tech Stack:** Fastify 5, Kysely 0.29, Zod 4, React 19, React Router 7, TanStack Query 5, Vitest, pgTAP, Playwright.

**Spec:** `games/galaxy/docs/GDD.md`:
- §16.1: roles; «El moderador solo modera chats, denuncias y silencios»; destructive actions ask for the password; audit;
- §16.4: Moderación, chats and clans;
- §14.4: the chat rules.

## Global Constraints

- **Moderators** (role `moderator`, TOTP) reach only the chat moderation:
  - Denuncias, Chat en vivo and Silencios, in the API and in the panel;
  - Clanes, Jugadores, Auditoría and Configuración stay admin-only (403 / redirect).
- **Audit:** every moderation change writes `admin_audit_log` in the same transaction. It records actor, IP, reason, and before/after where it applies.
  - Actions: `chat.hide`, `chat.restore`, `chat.review`, `chat.mute`, `chat.unmute`, `clan.edit`, `clan.kick`, `clan.leader`, `clan.dissolve`.
- **Messages are never deleted.** Hide and restore only flip `hidden_*`.
- **Dissolving a clan asks for the password** (`confirmPassword`, the M6a lockout); nothing else here does.
- **Staff targets:** muting and kicking go through `guardTarget`:
  - nobody acts on a superadmin;
  - only a superadmin acts on other staff;
  - nobody mutes themselves.
- **Copy:** Spanish, direct titles, no special symbols, no final period. Consult ui-ux-pro-max before CSS; DESIGN_SYSTEM §8 octodecies; reduced motion respected.
- **Tests never publish live config to the local DB.**

## Review Focus

1. **A message a moderator kept visible** is not hidden again by the next single report: only reports newer than its last review count toward `chat.hideAfter`.
2. **Two moderators resolving the same report:** the second gets 409 `report_reviewed`, and only one review and one audit row exist.
3. **A moderator calling a clan or player endpoint** gets 403. A moderator opening `/admin/jugadores` lands on `/admin/moderacion`.
4. **Kicking a clan's leader from the panel** hands the lead to the successor (oldest officer, else oldest member). Kicking its last member dissolves the clan.
5. **Muting staff** follows `guardTarget`:
   - from the panel and from the in-game chat;
   - a moderator muting an admin → 403 `staff_target`.

---

### Task 1: Shared, migration and the staff guard

- **Migration** `supabase/migrations/<ts>_galaxy_chat_report_reviews.sql`. The table `galaxy.chat_report_reviews` has:
  - `message_id bigint primary key references galaxy.chat_messages on delete cascade`;
  - `outcome text check in ('hidden','kept')`;
  - `by_id uuid references accounts on delete set null`;
  - `reason text check length 3–300`;
  - `reviewed_at timestamptz default now()`.
  
  RLS and the `galaxy_api` policy as the chat tables. Grant select, insert and update. Add an index `chat_reports (message_id, created_at)`.
  
  pgTAP `supabase/tests/987_galaxy_moderation.test.sql`: table, columns, outcome check, cascade, no grants to anon.
- **`packages/shared/src/api/moderation.ts`** (exported from index):
  - **Schemas:**
    - `modChannelQuerySchema {channel: 'global' | /^clan:[0-9a-f-]{36}$/, before?: numeric string}`;
    - `modReasonSchema {reason}` (3–300);
    - `modResolveSchema {outcome: 'hidden'|'kept', reason}`;
    - `modMuteSchema {username, minutes: 1–43200, reason: 3–140}`;
    - `modUnmuteSchema {reason}`;
    - `adminClanQuerySchema {q?: 0–64}`;
    - `adminClanTagParamSchema`;
    - `adminClanEditSchema {name?, tag?, description?, reason}` refined so at least one field is present, reusing the clan name/tag rules (export them from `api/clans.ts`);
    - `adminClanMemberSchema {username, reason}`;
    - `adminClanDissolveSchema {reason, password}`.
  - **Types:**
    - `ModChannel {key, label, lastAt}`;
    - `ModMessage {id, channel, author, body, at, hidden: null | {reason:'moderator'|'reports', by: string|null, at}, reports: number}`;
    - `ModReport {message: ModMessage, reasons: string[], firstAt, lastAt}`;
    - `ModMute {username, until, reason, by: string|null}`;
    - `AdminClanRow {tag, name, members, leader: string|null, createdAt}`;
    - `AdminClan {…row, description, emblem, color, open, members: {username, role, joinedAt}[]}`.
  - **Errors:** `report_reviewed`.
- **`requireStaff(req)`** in `auth/guards.ts`: TOTP plus moderator, admin or superadmin, otherwise 403 `forbidden`. `isModerator` in chat/service delegates to the same rule.
- **Tests:** shared schema tests (edit needs a field; tag upper-cased; mute minutes bounds). Guard unit test (moderator without mfa → 403, with mfa → ok; player → 403).

### Task 2: Server, chat moderation

- **Service** `apps/server/src/admin/moderation.ts`. Signatures take `(deps: ChatDeps, actor: AuditActor, …)` and each runs in one transaction:
  - `modChannels(db)` → global, plus clans with messages in the last 30 days (by last message, 50 at most), labelled `[TAG] name`.
  - `modMessages(deps, channel, before?)`: 100 newest first, hidden included, with the report count.
  - `modHide(deps, actor, id, reason)` → hides it (`hidden_reason 'moderator'`, by the actor), broadcasts `deleted`, audits `chat.hide`. 409 `message_hidden` if already hidden.
  - `modRestore(deps, actor, id, reason)` → clears `hidden_*` and audits `chat.restore` with `before: {reason, by}`. 409 `message_visible` if not hidden. Ruling: no push, the message shows on the next history load.
  - `modReports(db)` → the queue: messages with at least one report newer than their review, oldest pending first, 50.
  - `resolveReport(deps, actor, id, outcome, reason)` locks the message row (`for update`). With no pending reports it answers 409 `report_reviewed`.
    - `hidden` hides it if visible.
    - `kept` restores it if hidden.
    - Either way it upserts the review and audits `chat.review` (`after {outcome}`).
  - `modMutes(db, now)` → active mutes, soonest end first.
  - `modMute(deps, actor, session, req)` → `guardTarget` (self false), upsert, audit `chat.mute`.
  - `modUnmute(deps, actor, session, username, reason)` → `until = now()` (no delete grant needed), audit `chat.unmute`. 404 `mute_not_found` if not muted.
- **`reportMessage`** counts only reports newer than the message's review toward `chat.hideAfter`.
- **The in-game routes:**
  - `hideMessage` and `muteAccount` gain the audit. Their reason is fixed copy: `Ocultado desde el chat` for hide; mute keeps its own reason.
  - `muteAccount` uses `guardTarget`.
  - They take an `AuditActor` built with `clientIp(req, env.TRUST_CF_IP)`. `registerChatRoutes` receives `trustCfIp`.
- **Routes** in `apps/server/src/admin/moderation-routes.ts`, registered from app.ts. Changes are rate-limited at 60/min as M6a's `actorOf`.
  - `GET  /galaxy/api/admin/moderation/channels`
  - `GET  /galaxy/api/admin/moderation/messages?channel=&before=`
  - `POST /galaxy/api/admin/moderation/messages/:id/hide {reason}`
  - `POST /galaxy/api/admin/moderation/messages/:id/restore {reason}`
  - `GET  /galaxy/api/admin/moderation/reports`
  - `POST /galaxy/api/admin/moderation/reports/:id {outcome, reason}`
  - `GET  /galaxy/api/admin/moderation/mutes`
  - `POST /galaxy/api/admin/moderation/mutes {username, minutes, reason}`
  - `POST /galaxy/api/admin/moderation/mutes/:username/lift {reason}`
- **Errors:** `message_hidden`, `message_visible`, `mute_not_found`.
- **Integration tests** in `apps/server/test/integration/moderation.test.ts`, on the real config reader with no publish:
  - 401 anonymous; 403 player; a moderator with TOTP gets 200 on the chat routes;
  - hide, restore and audit rows;
  - the queue lists a reported message, `kept` restores an auto-hidden one, and one more report does not re-hide it;
  - a second resolve → 409 with one review row;
  - mute and lift; a moderator muting an admin → 403 `staff_target`;
  - the in-game hide and mute write the audit.

### Task 3: Server, clan moderation (admin only)

- **In `clans/service.ts`:** extract `removeMember(trx, clanId, accountId)`. It covers leader succession via `successor` and dissolving when empty, and both `leaveClan` and the admin kick use it.
- **Service** `apps/server/src/admin/clans.ts`:
  - `adminClans(db, q)`: tag or folded-name prefix; empty → newest 20.
  - `adminClan(db, tag)`.
  - `adminEditClan(deps, actor, tag, req)`: 409 `clan_name_taken` / `clan_tag_taken`; audit `clan.edit` with before/after of the changed fields.
  - `adminKick(deps, actor, session, tag, username, reason)`:
    - `guardTarget` (self true);
    - `removeMember` plus a `clan_kicks` row for `clans.kickHours`;
    - audit `clan.kick` (`after {dissolved}`).
  - `adminTransfer(deps, actor, tag, username, reason)`: 409 `not_in_clan`; the old leader becomes officer; audit `clan.leader` with before/after leader.
  - `adminDissolve(deps, actor, session, tag, reason, password)`: `confirmPassword`, then delete; audit `clan.dissolve` with `before {tag, name, members}`.
  
  Each one takes the clan's lock (`lockClan`) as `clans/service.ts` does.
- **Routes**, in the same routes file, `requireAdmin`:
  - `GET  /galaxy/api/admin/clans?q=`
  - `GET  /galaxy/api/admin/clans/:tag`
  - `POST /galaxy/api/admin/clans/:tag/edit`
  - `POST /galaxy/api/admin/clans/:tag/kick`
  - `POST /galaxy/api/admin/clans/:tag/leader`
  - `POST /galaxy/api/admin/clans/:tag/dissolve`
- **Integration tests** in `apps/server/test/integration/admin-clans.test.ts`:
  - a moderator gets 403;
  - search and detail;
  - edit name, tag and description, then a taken name → 409;
  - kicking the leader hands the lead to the oldest officer;
  - kicking the last member dissolves the clan;
  - transfer;
  - dissolve with the wrong password → 401 and the clan stays; with the right one it is gone; audit rows.

### Task 4: Web

- **Staff access:**
  - `isStaff(me)` in `auth/useMe.ts`;
  - the TopBar shield shows for staff with TOTP, and the badge reads «Moderador» for a moderator only;
  - `AdminLayout` admits staff, and moderators see only the «Moderación» link;
  - the `/admin` index is `<AdminHome>`, which sends admins to `jugadores` and moderators to `moderacion`;
  - `<AdminOnly>` wraps jugadores, auditoría, configuración and clanes, redirecting moderators to `/admin/moderacion`;
  - «Moderación» leaves the «Próximamente» list.
- **`ActionDialog`:** `username` and `path` are replaced by `url` (after `/galaxy/api`), with a generic `useAdminPost()` in `api/admin.ts`. `PlayerScreen` passes `/admin/players/<name>/<path>`.
- **`api/moderation.ts`:**
  - `useModChannels`;
  - `useModMessages(channel)`, refetching every 5000 ms (not in background) with `before` paging;
  - `useModReports`;
  - `useModMutes`;
  - `useAdminClans(q)`;
  - `useAdminClan(tag)`.
- **`admin/ModerationScreen.tsx`.** Routes: `moderacion` (Denuncias), `moderacion/chat`, `moderacion/silencios`, `moderacion/clanes` and `moderacion/clanes/:tag`, under a sub-nav labelled «Apartados de moderación».
  - **Denuncias:** each card shows the message, author, channel, when, how many reports and their reasons, and whether it is hidden. Actions «Ocultar» or «Dejar visible» (a reason dialog), and «Silenciar a <autor>». Empty state: «No hay denuncias pendientes».
  - **Chat en vivo:** a channel select, then messages newest first. A hidden message is dimmed and says by whom. Per row, «Ocultar» or «Restaurar» and «Silenciar», plus «Ver anteriores». For admins only, a link «Filtro de palabras» to `/admin/configuracion/chat`.
  - **Silencios:** a mute form (username, a duration select of 10 min / 1 h / 24 h / 7 días / 30 días, reason) and the list with «Levantar».
  - **Clanes:** search, then a list. A clan's page shows its data and members, with «Editar», «Disolver» (password), «Expulsar» and «Hacer líder».
- **Copy** goes in `copy.admin.moderation`, and the new error codes in `errors`.
- **CSS:** `.admin-subnav`, `.mod-report`, `.mod-message` (hidden state), `.mod-mutes`, `.admin-clan`. Reduced motion respected.
- **Tests** in `apps/web/test/admin-moderation.test.tsx`:
  - a moderator sees only Moderación and is redirected from jugadores;
  - the queue resolves with a reason (body checked);
  - the live view lists hidden messages and restores one;
  - mute with a duration;
  - a clan dissolve asks for the password;
  - `admin.test.tsx` still passes with the generic dialog.

### Task 5: e2e, docs, verification, review, PR, PRE

- **e2e** `apps/web/e2e/admin-moderation.spec.ts`:
  - set-up: a CLI moderator signs in with TOTP, and two e2e players are at level 5 (XP straight into their own rows, as `chat.spec`);
  - the player writes and the other reports;
  - the moderator sees only Moderación, finds the report and keeps it visible with a reason, hides a message in Chat en vivo and restores it, mutes the player and lifts the mute;
  - the moderator's API call to `/admin/players?q=x` → 403;
  - no CSP violations.
- **The setup admin** creates a clan with an e2e player (XP for `clans.minLevel`) and renames it from Clanes.
- **Docs:**
  - DEPLOY_PRE step 21: migration `galaxy_chat_report_reviews`; check with `rayelus` and a CLI moderator;
  - DESIGN_SYSTEM §8 octodecies «Moderación».
- **Verification:**
  - typecheck, lint, tests (excluding M1 `config.test.ts` locally), pgTAP (`pnpm exec supabase migration up` then `pnpm exec supabase test db`), e2e;
  - a memory-killed run is not relaunched; CI decides.
- **Then:** fresh opus final review → one fix pass → PR to develop → merge on green → PRE check with an `e2e_pre_*` account.
