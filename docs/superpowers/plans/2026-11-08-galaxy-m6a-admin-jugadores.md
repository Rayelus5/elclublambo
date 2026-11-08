# Galaxy Survivor M6a · Panel de admin: jugadores y auditoría

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the admin panel's first part: find any player, see everything about them, change what an admin may change (always audited and compensated, never erasing history), manage their account (reset code, sessions, ban), and read and export the audit log.

**Architecture:**
- **The API:** `/galaxy/api/admin/*` behind `requireAdmin` (admin or superadmin, signed in with TOTP).
- **Every change** runs in one transaction with `writeAudit`, recording before, after, reason and IP. Economy changes are compensating ledger entries.
- **Destructive actions** ask for the admin's own password again. These are: ban, revoking a galaxy, taking currency away, renaming, changing experience and issuing a reset code.
- **The web:** a `/admin` area outside the game's screens, with a side nav. Players and Auditoría are live; Configuración, Moderación, Comunicación and Estadísticas are marked «Próximamente» until M6b–M6d.

**Tech Stack:** Fastify 5 + Kysely + Postgres, Zod, React 19 + RR7 + TanStack Query.

**Spec:** `games/galaxy/docs/GDD.md` §16.1 (roles, TOTP, password on destructive actions, audit log with filter and export) and §16.2 (players: search, view all, edit, accounts).

## Global Constraints

- **Roles:** moderators are not admins. Every M6a route needs admin or superadmin with an MFA session (`requireAdmin`).
- **The audit log:** every change writes `admin_audit_log` in the same transaction (actor, action, target, before, after, reason ≥ 3 characters, IP). The log is append-only. No secrets in before/after (reset codes are never logged).
- **Economy corrections** are compensating `credit`/`debit` entries with reason `admin_grant` / `admin_take` and the audit id in `ref`; a balance never goes below 0.
- **Destructive actions** need `password` in the body, checked against the acting admin's hash (401 `password_wrong`) and rate-limited.
- **A ban:**
  - sets `banned_until` (a date, or far future for permanent) and closes all of the player's sessions;
  - cancels their active listings and open trades;
  - is audited with its reason.
  Unbanning clears it.
- **Copy:** Spanish, direct titles, no special symbols, no final period. Consult ui-ux-pro-max before CSS; update DESIGN_SYSTEM.
- **The local DB is the user's:** use `pnpm exec supabase migration up` and `pnpm exec supabase test db`. Migration timestamps in UTC.

## Review Focus

1. **A non-admin** (a player, or a moderator, or an admin without TOTP) on any admin route → 401/403, and nothing changes.
2. **Taking more currency than the balance** → 409 with the balance unchanged. Every change leaves a ledger entry and an audit row together, or neither.
3. **Banning a player with an active listing, an open trade, sessions and a socket:**
   - the listing is cancelled and its galaxy freed;
   - the trade is cancelled and both sides' galaxies freed;
   - the sessions are gone, and the next request is 401.
4. **A wrong or missing password** on a destructive action → 401, nothing changes, and repeated tries are rate-limited.
5. **Revoking a galaxy that is equipped, exhibited, listed or offered:**
   - it is taken out of every place first (loadout, exhibit, listing, trade), then marked gone;
   - the audit records where it was.

---

### Task 1: Shared API and errors
- **Types:**
  - `AdminPlayerRow`;
  - `AdminPlayerList`;
  - `AdminPlayer` (profile, wallet, xp/level, roles, banned, mutes, clan, sessions, IPs, counts);
  - `AdminPlayerSection` pages for the galaxies, ledger, pulls, runs, market (listings and trades) and chat;
  - `AuditRow`;
  - `AuditPage`.
- **Schemas:**
  - `adminSearchSchema { q }` (a username prefix, an IP or a clan tag);
  - `adminWalletSchema { currency in coins|dust|signal|material|components, amount (≠0, ±1e9), reason, password? }`;
  - `adminGalaxyGrantSchema { tier, finish, seed?, reason }`;
  - `adminGalaxyRevokeSchema { reason, password }`;
  - `adminXpSchema { xp, reason, password }`;
  - `adminRenameSchema { username, reason, password }`;
  - `adminBanSchema { minutes | null (permanent), reason, password }`;
  - `adminReasonSchema`;
  - `auditQuerySchema { actor?, action?, target?, from?, to?, page }`.
- **Errors:** `password_wrong`, `player_not_found`.
- **Tests:** the schemas refuse what they must (amount 0, reason under 3 characters, a password missing on the destructive ones).

### Task 2: Migration and pgTAP
- **`accounts.leaderboard_excluded boolean default false`:** the season leaderboard and the clans tab leave excluded accounts out.
- **pgTAP:** the column exists with its default.

### Task 3: Server
- **Routes** (`apps/server/src/admin/{players,audit,routes}.ts`):
  - `GET /admin/players?q` (20 rows);
  - `GET /admin/players/:username`;
  - `GET /admin/players/:username/{galaxies,ledger,pulls,runs,market,chat}?page`;
  - `POST /admin/players/:username/wallet`;
  - `POST /admin/players/:username/galaxies` (grant a generated galaxy of the chosen tier and finish, with the seed given or random);
  - `POST /admin/players/:username/galaxies/:id/revoke`;
  - `POST /admin/players/:username/xp`;
  - `POST /admin/players/:username/rename`;
  - `POST /admin/players/:username/reset-code` (answers the code once; the audit never holds it);
  - `POST /admin/players/:username/sessions/close`;
  - `POST /admin/players/:username/ban` and `/unban`;
  - `POST /admin/players/:username/leaderboard` `{ excluded, reason }`;
  - `GET /admin/audit?…` (JSON, 50 per page) and `?format=csv` (UTF-8 with BOM, at most 5000 rows).
- **Password check:** `verifyPassword` against the actor's own account; rate limit `admin_password` 10 per 10 minutes.
- **Integration tests:** one for each Review Focus line, plus search by name, IP and clan, the full view, each edit's ledger and audit rows, the CSV header, and leaderboard exclusion.

### Task 4: Web
- **The area:**
  - `/admin` (guarded: an admin with MFA, or else back to `/`);
  - a layout with a side nav;
  - «Admin» on the top bar's badge links there.
- **Jugadores:**
  - **Search:** by name, IP or clan, with a results table (name, level, created, last seen, state).
  - **The player page:** a header with state chips (Baneado, Silenciado, Excluido) and actions, then tabs:
    - Resumen;
    - Galaxias;
    - Movimientos;
    - Tiradas;
    - Partidas (flags shown);
    - Comercio;
    - Chat;
    - Sesiones e IPs.
  - **Action dialogs:** reason, plus password when destructive. The reset code is shown once, with a copy button.
- **Auditoría:** filters, a table with expandable before/after, pages, and «Exportar CSV».
- **DESIGN_SYSTEM §8 sedecies:** the admin area is sober, dense and readable, and keeps the game's tokens.

### Task 5: e2e, DEPLOY_PRE step 19, verification, review, PR, PRE
- **e2e:**
  - the e2e admin (`admin.setup.ts`) signs in with TOTP, finds a new player by name, grants 500 coins with a reason, bans with the password and sees «Baneado»;
  - the player's session is gone;
  - the audit page lists the three actions;
  - CSV export downloads.
