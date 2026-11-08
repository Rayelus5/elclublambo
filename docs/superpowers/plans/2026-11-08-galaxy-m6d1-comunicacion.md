# Galaxy Survivor M6d-1 · Comunicación: buzón con regalos y avisos de la pantalla de título

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GDD §16.5 «Comunicación».

**For admins:**
- **The mailbox:** news for everyone or for a segment, with gifts attached (coins, dust, signal).
- **Notices:** banners on the title screen between two dates.

**For players:**
- the top bar's mail button opens their mailbox, with the unread count;
- each message opens, and its gift is collected once;
- the title screen shows the notices running now.

**Architecture:**
- **Migration** `galaxy_mailbox`:
  - `mailbox_messages`: title, body, gifts, audience, expiry, withdrawal;
  - `mailbox_receipts`: read and claimed, per message and account;
  - `title_notices`: text, tone and dates.
- **Server:**
  - `mail/service.ts` and `mail/routes.ts` for the player;
  - `admin/communication.ts` and `admin/communication-routes.ts`, admin only.
- **Audience:** evaluated against an account's level, join date and name.
  - A message reaches only accounts that existed when it was sent. Ruling: no farming its gift with new accounts.
- **A claim** inserts the receipt's `claimed_at` and credits each gift (`mail_gift`) in one transaction. The receipt's primary key makes it once only.
- **Web:**
  - a `Mailbox` sheet from the top bar;
  - `TitleNotices` under the logo, like `MaintenanceNotice`, each dismissible per browser;
  - `/admin/comunicacion` with Buzón and Avisos (live in the side nav).

**Tech Stack:** Fastify 5, Kysely 0.29, Zod 4, React 19, React Router 7, TanStack Query 5, Vitest, pgTAP, Playwright.

**Spec:** `games/galaxy/docs/GDD.md`:
- §16.5: Buzón for everyone or by segments, with gifts; Avisos on the title screen;
- §4: the top bar's mailbox;
- §16.1: audit and password;
- §16.2: economy changes are ledger entries.

## Global Constraints

- **Admin-only authoring** (TOTP), every change audited: `mail.send`, `mail.withdraw`, `notice.create`, `notice.end`.
- **Sending a message with gifts asks for the admin's password**, because it creates currency. One without gifts does not.
- **Gift bounds per message:** coins 0–100 000, dust 0–100 000, signal 0–100.
- **The audience:**
  - `all`;
  - or a segment, with any of: level from–to, joined from–to, and a list of up to 200 names.
  - The send dialog previews how many accounts it reaches.
- **The receiver's side:**
  - a message is visible while it is not withdrawn and not expired; the default expiry is 30 days, at most 365;
  - a gift is claimed once, and never after the message expires or is withdrawn;
  - a banned account cannot claim.
- **Notices:** a text of 1–200 characters, a tone (`info` or `warning`), a start and an end. The title screen shows the running ones, newest first, 3 at most.
- **Copy:** Spanish, direct titles, no special symbols, no final period. Consult ui-ux-pro-max before CSS; DESIGN_SYSTEM §8 vicies. Reduced motion respected.

## Review Focus

1. **Claiming a gift twice, or from two tabs at once** → one credit, then 409 `mail_claimed`.
2. **An account created after a message was sent** does not see it. An account outside its segment does not see it, and cannot claim by id: 404.
3. **A withdrawn or expired message** disappears from the mailbox, and its gift can no longer be claimed.
4. **Sending with gifts and a wrong password** → 401, nothing sent, and it counts toward the M6a lockout.
5. **A notice outside its dates** is not shown. Ending a notice now hides it at once.

---

### Task 1: Migration, shared and the audience
- **Migration and its pgTAP** `989_galaxy_mailbox.test.sql`. Grants:
  - insert and update(withdrawn_at) on messages;
  - insert and update(read_at, claimed_at) on receipts;
  - insert and update(ended_at) on notices.
- **Shared** `api/mail.ts`:
  - **Schemas:**
    - `mailGiftsSchema`;
    - `mailAudienceSchema` (`{ kind: 'all' }` or `{ kind: 'segment', minLevel?, maxLevel?, joinedFrom?, joinedTo?, usernames? }`, with at least one condition);
    - `adminMailSendSchema {title, body, gifts, audience, expiresInDays, reason, password?}`;
    - `adminMailPreviewSchema`;
    - `adminNoticeSchema {text, tone, startsAt, endsAt, reason}` (ends after it starts);
    - `adminReasonSchema` reused.
  - **Types:** `MailMessage`, `MyMailbox {messages, unread}`, `AdminMailRow` (recipients, read, claimed), `TitleNotice`, `AdminNoticeRow`.
  - **`inAudience(audience, account: {level, createdAt, username}, sentAt)`:** a pure function, tested in shared.
  - **Errors:** `mail_claimed`, `mail_gone`.

### Task 2: Server
- **Player:**
  - `GET /galaxy/api/mailbox`;
  - `POST /mailbox/:id/read`;
  - `POST /mailbox/:id/claim` (rate-limited);
  - `GET /galaxy/api/notices`.
- **Admin:**
  - `GET /admin/mail`;
  - `POST /admin/mail/preview`;
  - `POST /admin/mail`;
  - `POST /admin/mail/:id/withdraw`;
  - `GET /admin/notices`;
  - `POST /admin/notices`;
  - `POST /admin/notices/:id/end`.
- **Integration tests:** each Review Focus line, the audit rows and the ledger entries.

### Task 3: Web
- **TopBar:** the mail button, live with its unread badge, opens the `Mailbox` sheet (a list, then the message, then «Recoger» with what it gives).
- **Title screen:** `TitleNotices`.
- **Admin:** `/admin/comunicacion` with Buzón (compose with an audience preview, the sent list with withdraw) and Avisos (create and end). «Comunicación» leaves «Próximamente».
- **Tests:** web tests.
- **Art:** an Aseprite mail and gift icon set if the icon set lacks them.

### Task 4: e2e, docs, verification, review, PR, PRE
- **e2e:** an admin sends a message with 100 coins to one e2e player and publishes a notice; the player sees the badge, opens the message, collects it (the wallet grows) and sees the notice; no CSP violations.
- **Docs:** DEPLOY_PRE step 23; DESIGN_SYSTEM §8 vicies.
