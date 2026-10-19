# F5 — Whole-app security review (2026-10-19)

Scope: the whole app at `d449a9a` (F1–F4 plus F5 Task 0, the balance preflight and AppKit `customRpcUrls`). The F4 treasury
money math was reviewed in depth already (`.superpowers/sdd/f4*/progress.md`) and is out of scope. Its authz surface is in
scope and is covered below.

Severity: crit / high / med / low / info. Status: **fixed** (commit + test), **→ Task N** (a later F5 task owns it),
**accepted** (reason given) or **controller decision**.

## Findings

| id | area | sev | evidence | fix / decision | test |
|---|---|---|---|---|---|
| S1 | Logs / secrets | high | viem `HttpRequestError`/`RpcRequestError` put the full RPC URL in `message` (`node_modules/viem/errors/request.ts`: `URL: ${getUrl(url)}`, and `getUrl` only strips userinfo). The Infura key lives in the path. About 90 server `console.error/warn` calls logged the raw error or `.message`, e.g. `src/app/api/cron/dao/route.ts:96` (`scan failed`, chainId, e) and `src/lib/treasury/scan.ts:174`. | **fixed** `7e26834`. `src/lib/security/redact.ts`: `safeError(e)` (message + up to 3 `cause` levels; every `http(s)/ws(s)` URL becomes `<scheme>://<host>/***`; never throws) and `redactUrl(url)`. Every server log of a caught error, or of a `.message`, now goes through `safeError`. Client components untouched. | `tests/unit/security/redact.test.ts` (8); `tests/unit/treasury/cron-route.test.ts` "F5 S1" (RED on the old route: the logged string contained `abc123KEY`) |
| S2 | Server actions / RPC spend | med | `src/app/(forum)/layout.tsx:95-97` scheduled `reverifyMyPendingIntents` (up to 5 `confirmIntent`, each with receipts and block reads) and `settlePendingDonations({memberId, limit: 5})` (the finalized block, receipts, Safe valuation) via `after()` on **every** forum render. `attach_intent_tx` accepts any well-formed hash, so a member with up to 5 junk-hash intents (pending for 7 days) who reloads in a loop multiplies reads on the RPC key, one batch per request. | **fixed** `d9c90ec`. `src/lib/payments/recheck-throttle.ts`: `shouldRecheckMember` allows at most one background recheck per member per 30 s per server process, with bounded memory. This is the same approach as the existing `shouldSettleFromView`. The cron still settles everything. The f3b e2e polls for 60 s, so a 30 s window keeps it green. | `tests/unit/payments/recheck-throttle.test.ts` (4); `tests/unit/onboarding/forum-layout.test.tsx` "F5 S2" (RED: 3 renders scheduled 6 `after()`s; GREEN: 2) |
| S3 | Server actions / RPC spend | med | The explicit on-chain actions have no per-member bound: `verifyIntentAction` (`src/lib/payments/tip-actions.ts:73`), `postAlphaAction` (`src/lib/chat/alpha.ts:51`), `markWithdrawalPaidAction` and `markRafflePaidAction`. Each authorizes first (RLS ownership, channel bits, `treasurerId`), and then every call spends RPC reads. | **→ Task 2**: the `chain_verify` pre-hit (120 / 10 min). Review Focus 1 applies: a limited `verifyIntentAction` must answer `pending`. | Task 2 |
| S4 | Auth / server actions | low | `completeLogin(inviteCode)` (`src/lib/auth/actions.ts:20`) does not check the shape of `inviteCode`. A non-string reaches `redeem_invite`, which fails harmlessly with `/invite/[object Object]?error=unknown`. Brute force is bounded only by 128-bit codes. | **→ Task 2**: it edits `completeLogin` for the `redeem_invite` pre-hit. Add `typeof inviteCode === "string" && /^[A-Za-z0-9_-]{1,64}$/` there (codes are base64url of 16 bytes) and treat anything else as no invite. | Task 2 |
| S5 | SQL / presence | low | `touch_presence(p_device uuid)` (`supabase/migrations/20261019000008_presence_per_device.sql:23`) inserts one `member_presence` row per new device id, and only rows older than 1 day are pruned. A scripted member can grow the table for a day. Toggling `touch_presence`/`leave_presence` with fresh ids makes every call a `presence_changed` broadcast to every member. Members only; no data exposure. | **controller decision** (not in the F5-R1 table). Proposal: add a `presence` bucket (120/min) in Task 2, or cap device rows per member (delete all but the newest 10 on insert, like `save_push_subscription`). | — |
| S6 | Market / third-party quota | low | `/mercado/<id>` (`src/lib/market/cache.ts`) caches only successes. Any well-formed but unknown id (`COIN_ID_RE`) fetches CoinGecko on every view, so a member can burn the shared CoinGecko rate limit and degrade the market pages (display-only data). | **accepted** (low; member-only; display data; the treasury no longer depends on CoinGecko beyond its fallback, F4a-R10). Backlog: negative-cache `CoinNotFoundError` in `market_cache` for 5 min. | — |
| S7 | RLS/grants / GraphQL | info | `supabase/config.toml` exposes `graphql_public`, but `pg_graphql` is **not installed** locally (`pg_extension`). Supabase Cloud projects ship with it enabled. With RLS everywhere and no `anon` grants it exposes nothing, but it is unused attack surface. | **→ Task 8** (guide): "deshabilitar pg_graphql en Cloud" (Database → Extensions), or remove `graphql_public` from the exposed schemas. | — |
| S8 | Realtime | info | `realtime.messages` has only SELECT policies, so clients cannot broadcast. Every topic (`channel:`, `member:`, `ticket:`, `dao`, `activity`, `presence`) is private, and every server `realtime.send(..., true)` is private. | **→ Task 8**: in Cloud (Realtime → Settings) turn off "Allow public access" (private channels only), as defense in depth. | — |
| S9 | Auth / SIWE | info | The SIWE `domain`/`uri` come from `window.location` (`src/components/auth/login-panel.tsx:52`). GoTrue validates the message URI against Site URL and the redirect allowlist (local: `site_url = "http://localhost:3000"`). Locally the Email provider is enabled (`[auth.email] enable_signup = true`). A non-wallet user gets no member row and no access, but it is needless surface. | **→ Task 8**: Site URL `https://elclub.party`, redirect URLs only `https://elclub.party/**` (preproduction: `https://pre.elclub.party`). Email and Phone providers off, `enable_signup` on (F5-R15). `web3` rate limit per F5-R2. | — |
| S10 | Bundle / secrets | info | `NEXT_PUBLIC_LINEA_RPC_URL` / `NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL` are inlined into the client bundle. They feed the raffle verifier (`src/lib/treasury/raffle-verify-chain.ts:21`) and, since Task 0, AppKit `customRpcUrls` (`src/lib/web3/appkit.ts:25-26`). A provider URL with a key put there by mistake would ship publicly. | **→ Task 7**: `productionEnvProblems` must refuse non-empty values in production. `.env.example` already warns. | Task 7 |
| S11 | Headers / CSP | info | `next.config.ts` sends only `frame-src` + `frame-ancestors 'none'`, with no `default-src`, nosniff, Referrer-Policy, HSTS or the rest. | **→ Task 3** (F5-R3/R4). | Task 3 |
| S12 | Dependencies | info | `pnpm audit --prod`: one high, `braces <=3.0.3` (GHSA-vfj7-8cjw-p6xm, stack-exhaustion DoS on crafted glob patterns). The only paths are `shadcn > fast-glob/ts-morph/@shadcn/registry > micromatch > braces`. | **accepted**: not reachable. `shadcn` is a CLI. The app only `@import`s its `tailwind.css` at build time, and no runtime code parses user glob patterns. No patched version exists. Optional: move `shadcn` to `devDependencies`. | — |
| S13 | Session | info | `@supabase/ssr` session cookies are readable by JS (not HttpOnly, by design: the browser client needs them), so an XSS would expose the JWT. | **accepted**: no `dangerouslySetInnerHTML`/`innerHTML`/`eval` in `src`. Chat docs are re-sanitized server-side (`sanitizeDoc`) and in SQL. Links pass through `classifyLink`/`/out`. Task 3's CSP is the remaining layer. | — |
| S14 | Server actions / CSRF | info | Next's server-action CSRF check compares `Origin` with `Host`/`X-Forwarded-Host`. In preproduction behind Cloudflare Tunnel, the tunnel must forward the original host (the default; do not set `httpHostHeader` to another value), or every action fails. | **→ Task 5** (preproduction compose/tunnel). | — |

## Areas checked and clean

- **Auth.**
  - `completeLogin` uses the admin client only on the `bootstrap` decision. That decision requires `isSuperAdminWallet(walletFromUser(user), SUPER_ADMIN_WALLET)`, and `bootstrap_super_admin` re-derives the wallet from `auth.identities` under an advisory lock, closing for good once any bootstrap member exists.
  - `walletFromUser` picks the earliest `web3` identity, the same as `auth_wallet_address()` (`order by created_at limit 1`).
  - `safeNextPath` rejects `//`, `/\`, control characters and whitespace (the TAB/CR/LF smuggling), and `/login`.
  - `/login/complete` requires `Sec-Fetch-Site: same-origin|none` and re-checks the redirect origin.
  - `proxy.ts` uses `getUser()` (server-validated) and overwrites the client's `x-pathname`. Its public prefixes are `/login`, `/invite/*`, `/no-access`, `/banned` and `/api/cron`, and `/api/cron/dao` self-authenticates.
  - The invite page does not look the code up (no oracle).
- **RLS / grants** (live DB at `20261019600006`).
  - No `public` table without RLS.
  - No `public` function is executable by `anon`.
  - Every `public`/`private` function has `search_path=""`.
  - `private` has no USAGE for `anon`/`authenticated`.
  - The only non-SELECT policies are the three Storage ones below; there are no write policies on `public` tables.
  - The 12 SECURITY INVOKER functions are pure helpers, `economy_config` and `search_*` (all under RLS).
  - Every function granted to `authenticated` checks membership or permission bits, either directly or through `channel_permissions`, which returns 0 for non-active members (checked by a `prosrc` scan).
  - The service-only treasury RPCs are not granted to `authenticated`: `approve_withdrawal`, `record_*`, `confirm_tip`, `credit_donation`, `draw_raffle`, `claim_push_notifications`, `post_message_as`.
  - The full pgTAP suite (`pnpm db:test`) passes; see the report.
- **Server actions** (20 `"use server"` modules).
  - Every one derives the member from the session; none takes a member id from input.
  - Every admin-client call comes after an authorization:
    - alpha: channel bits;
    - treasury: `treasurerId()`, re-checked in SQL;
    - storage cleanups: paths returned by the definer RPC that authorized the delete, or the caller's own avatar folder (regex + id).
  - Inputs are shape-checked before any RPC (UUID/hash/amount regexes, enums, lengths). The one gap is S4.
  - Error strings reaching clients pass the `rpcErrorCode` whitelist.
  - PostgREST `.or()` strings interpolate user text only with the caller's own client under RLS, and metacharacters are stripped.
- **Storage.**
  - `chat-images` is private (5 MB, png/jpeg/webp/gif); `avatars` is public by design (2 MB, png/jpeg/webp).
  - Insert policies pin the path to `<channel>/<current member>/<uuid>.<ext>` with view+attach bits, and `avatars` to `<current member>/<uuid>.<ext>`.
  - There is no UPDATE policy (so no upsert), and DELETE only on the member's own avatar folder.
  - `_post_message_core` takes MIME and size from `storage.objects.metadata`, never from the client.
  - Upload rate → Task 2.
- **Realtime.** Only SELECT (receive) policies, each tied to `can_view` / own member id / `_can_access_ticket` / `is_active_member`. All client channels use `{ private: true }`. See S8.
- **Push.** `isAllowedPushEndpoint` mirrors `_valid_push_endpoint`: https only, no userinfo, port or fragment, an exact host allowlist, ≤ 2048 characters. Dispatch logs only `hostOf(endpoint)`. Subscriptions are capped at 10 per member.
- **Cron.** The bearer check is constant-time (`timingSafeEqual` over padded buffers plus a length check). It answers 503 when `CRON_SECRET` is unset, and `connection()` runs before the env read, so nothing is prerendered.
- **Secrets.**
  - `SUPABASE_SERVICE_ROLE_KEY` is read only in `src/lib/supabase/admin.ts` (`server-only`).
  - `LINEA_*_RPC_URL` only in `src/lib/payments/chain-client.ts` and `src/lib/chat/linea.ts`, both `server-only`.
  - `VAPID_PRIVATE_KEY` only in `src/lib/push/dispatch.ts` (`server-only`); `COINGECKO_API_KEY` only in `src/lib/market/coingecko.ts` (`server-only`).
  - `CRON_SECRET` only in the route handler.
  - No `NEXT_PUBLIC_*` holds a secret (S10 is the foot-gun).
  - `.env*` is ignored, and only `.env.example` was ever committed (`git log --all`).
- **Links.** `/out` requires a session and accepts only http(s) URLs without userinfo, with a homograph warning. `public/sw.js` `safeUrl` falls back to `/` for any non-same-origin URL, both on push and on click.
- **Task 0 preflight.** `src/lib/payments/preflight.ts` is UX-only. It reads balances in the browser, and every credit is still verified on-chain server-side (`verifyTransfer`). A failed read never blocks, and the wallet stays the last guard.
- **Uncaught chain errors.** Every server path that talks to the RPC catches: `verifyTransfer`, `finalityLagSeconds`, `valueSafe` callers, and cron steps. No raw viem error reaches Next's own error logging.
