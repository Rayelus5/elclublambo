# Galaxy Survivor M6b · Panel de admin: configuración viva, interruptores y simulador

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the admin edits every game parameter from the panel:
- each config key with live validation against its Zod schema, a diff against what is live, and its history;
- publishing creates a new version (audited, with reason and password);
- the feature switches (registro, mantenimiento, gachapón, incursiones, mercado, trueque, chat) in one place;
- a gacha simulator that runs the edited config **before** publishing.

**Architecture:**
- **Server:** the existing `/galaxy/api/admin/config` API gains:
  - the list of every key with its effective value, the default for keys never published;
  - a validate endpoint that answers the Zod issues;
  - a password on publish;
  - the history with author and note.
- **New switches:** `features.market|trades|chat` gate their routes with 503.
- **The simulator:** a pure shared function over `drawPull`; the web runs it on the draft config, nothing on the server.

**Spec:** `games/galaxy/docs/GDD.md` §16.3 (live config, versions, switches, maintenance) and §16.6 (gacha and economy simulator before publishing).

## Global Constraints

- **Admin-only:** admins and superadmins with TOTP. Publishing needs a reason and the admin's password (`confirmPassword`) and writes the audit in the same transaction (the existing `publish`).
- **Nothing invalid is published:** the server parses with the registry schema (the existing `config_invalid`) and now returns the issues (path and message).
- **Global multipliers (§16.3)** need payouts to read them. They come with live events in M7 (ruling).
- **Copy:** Spanish, direct titles, no special symbols, no final period. Consult ui-ux-pro-max; DESIGN_SYSTEM §8 septendecies.

## Review Focus

1. **A draft that fails its schema** shows each issue at its path and cannot be published; a forged publish is refused with the issues.
2. **Turning `market`, `trades` or `chat` off** makes their writes answer 503 at once (within the 10 s config cache); reading still works; turning them on restores them.
3. **A wrong password on publish** → 401, no new version, and it counts toward the M6a lockout.
4. **The simulator** with the live gacha config gives rates within 1 % of the expected base rates over 100 000 pulls (soft pity included), and is deterministic for a seed.
5. **Restoring an old version** publishes it as a new version (history is never rewritten).

### Task 1: Shared
- **`simulateGacha(cfg, bannerId, pulls, seed)`** returns `{ tiers: number[5], finishes: Record<Finish, number>, legendaryEvery: number, longestWithout: number }`.
- **`configIssues(key, data)`** returns `{ path: string, message: string }[]`.
- **Switches:** `features` gets `market`, `trades` and `chat` (default true).
- **Errors:** `market_disabled`, `trades_disabled`, `chat_disabled`.
- **Tests:** the simulator's determinism, its rates near the base rates over 100 000 pulls, the issues of a broken draft, and the new defaults.

### Task 2: Server
- **Routes:**
  - `GET /admin/config/keys` (every key: version or 0, the effective data, author, date, note);
  - `GET /admin/config/:key/versions` (exists);
  - `POST /admin/config/:key/validate` → `{ ok, issues }`;
  - `POST /admin/config/:key` with `{ data, reason, password }` (password required; 400 `config_invalid` with `issues`).
- **Switches:** `features.market` gates listing, buying and cancelling; `features.trades` gates every trade write; `features.chat` gates sending, reporting and moderation writes.
- **Integration tests:** one for each Review Focus line on the server.

### Task 3: Web
- **`/admin/configuracion`:**
  - the keys with their version and last change;
  - **Interruptores:** a toggle for each switch, each with reason and password;
  - **a key's editor:** JSON with live validation (issues by path), a diff of what changes against what is live, reason, password and «Publicar»;
  - **its history:** author, date and note, with «Cargar en el editor»;
  - **for `gacha`:** the simulator (banner, 1000 / 10 000 / 100 000 pulls) with tier and finish rates against the expected ones, average pulls per legendary and the longest drought.
- **Nav:** «Configuración» in the side nav is live.

### Task 4: e2e, DEPLOY_PRE step 20, verification, review, PR, PRE
- **e2e:**
  - a new admin turns the market off with reason and password; a player's listing answers 503; the admin turns it back on;
  - edits `chat.maxLength` to an invalid value (sees the issue), fixes it and publishes;
  - the history shows it;
  - the simulator runs 10 000 pulls.
