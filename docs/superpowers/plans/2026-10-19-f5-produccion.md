# F5 — Endurecimiento y producción — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden elclublambo and put it live. That covers a whole-app security review with fixes, Postgres rate limits, and full security headers with a CSP. Production is Vercel + Supabase Cloud on Linea mainnet, with migrations applied before code. Preproduction is Docker self-hosted on the user's Proxmox (`pre.elclub.party`), deployed from `develop`. On top of that come an RPC checker and a mainnet readiness check in code. Last, three Spanish guides written from what was actually built.

**Architecture:**
- **Rate limits live in Postgres**, so production and the self-hosted preproduction behave the same. A fixed-window counter (`private.rate_limit_hits`) is bumped by `private.rate_limit(...)` inside the abusable definer RPCs.
  - Postgres rolls a raise back together with the hit. So actions that fail often and cost something (invite redemption, on-chain verification) are charged first, in their own transaction, through the public `rate_limit_hit(bucket)`, from the server action.
  - Uploads are limited in the Storage insert policies by counting recent objects.
- **Headers are one pure module** (`src/lib/security/headers.ts`) that `next.config.ts` calls. The CSP is static, with no nonces, and is derived from env at build time.
- **Deploy order is enforced by CI.**
  - Production: on push to `main`, `verify` → `supabase db push` → the Vercel deploy hook. Git deployments are off in `vercel.json`, so nothing builds before the migration and no preview exists.
  - Preproduction: on push to `develop`, a self-hosted runner does `docker compose build` → `supabase db push --db-url` → `up -d`.

**Tech Stack:** Next.js 16.4 App Router (cacheComponents, Partial Prefetching, `proxy.ts`), Supabase (definer RPCs, RLS, pgTAP, Storage policies, Realtime private topics), viem 2.57, Reown AppKit 1.8, Vitest, Playwright (dev and `E2E_PROD=1`), GitHub Actions, Vercel, Docker Compose, Cloudflare Tunnel.

**Spec:** `docs/superpowers/specs/2026-10-19-f5-produccion-design.md`. Also used:
- the master plan `docs/superpowers/specs/2026-10-16-plan-maestro.md` §"Retiros y sorteos ponderados" (flags off on mainnet);
- the F4 notes carried into the guides: `.env.example` comments, ruling F4a-R10 in `src/lib/treasury/valuation.ts`, and `src/lib/treasury/scan.ts` (`CHUNK = 2000n`);
- `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`, which says nonces need dynamic rendering and that "Partial Prerendering (PPR) is incompatible with nonce-based CSP";
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md` (standalone).

## Decisiones del constructor (rulings F5-R*, the spec's "Decisiones dejadas al constructor" plus gaps found while planning)
- **F5-R1, rate-limit thresholds.** See the table in Global Constraints. Each is ≥ 3× what an active human does.
- **F5-R2, rate-limit mechanics.**
  - **Counter:** a fixed-window counter keyed by `(subject, bucket, window_start)`, where `window_start = date_bin(window, now(), '2000-01-01Z')`. The subject is the member id, or `'u:' || auth.uid()` before membership.
  - **Charged inside the RPC:** a hit counts only when the RPC commits, so these limit successful actions.
  - **Charged first, from the server action:** `redeem_invite` and on-chain verification. The pre-hit `rate_limit_hit(bucket)` runs in its own transaction.
  - **Accepted gap:** a direct PostgREST call to `redeem_invite` skips the pre-hit. Codes have 128 random bits (`gen_random_bytes(16)`).
  - **Login/nonce:** `signInWithWeb3` talks straight to GoTrue, so this is GoTrue's `web3` rate limit (30 per 5 min per IP, as in `supabase/config.toml`). It is set in the Cloud dashboard and the self-hosted env, not in Postgres.
- **F5-R3, CSP without nonces.**
  - `cacheComponents` is PPR, and the Next 16 docs say nonce CSP is incompatible with it. SRI is experimental and does not cover Next's inline RSC scripts.
  - So `script-src 'self' 'unsafe-inline'` (plus `'unsafe-eval'` only in dev) and `style-src 'self' 'unsafe-inline'` (AppKit and Tiptap inject styles).
  - Everything else is strict: `default-src 'self'`, an explicit `connect-src`/`img-src`/`font-src`/`frame-src`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` and `frame-ancestors 'none'`.
  - The header is computed when `next.config.ts` loads, so the Supabase origin and the public RPCs are baked at build time, like every `NEXT_PUBLIC_*`.
- **F5-R4, HTTPS-only headers.** HSTS (`max-age=63072000; includeSubDomains`, no `preload`) and `upgrade-insecure-requests` are sent only when `NEXT_PUBLIC_SITE_URL` starts with `https://`. Local e2e runs on `http://localhost` against `http://127.0.0.1:54321`, which they would break.
- **F5-R5, previews.** `vercel.json` has `"git": {"deploymentEnabled": false}`, so there are no previews at all. Production deploys only through the deploy hook. As defense in depth, every Vercel variable is scoped to **Production** only.
- **F5-R6, regions.** Supabase Cloud in **Central EU (Frankfurt) `eu-central-1`**, and Vercel functions in **`fra1`**.
- **F5-R7, preproduction images.**
  - `Dockerfile` is multi-stage on `node:22-bookworm-slim` (glibc, for SWC/Turbopack), runs as the non-root user `nextjs` (uid 1001), and is standalone only when built with `NEXT_OUTPUT=standalone`. Vercel and Windows dev are unchanged.
  - `deploy/preprod/docker-compose.yml` has three services:
    - `web`, on `127.0.0.1:3000`;
    - `cron`, which is `alpine:3.20` with busybox `crond` running `curl` GET hourly at minute 0;
    - `cloudflared`, pinned, as a locally-managed tunnel whose ingress lives in the repo.
  - All three join the external network `supabase_default` from the official self-hosted Supabase compose, which stays a separate project in `/opt/supabase/docker`.
  - Server and browser both use `NEXT_PUBLIC_SUPABASE_URL=https://pre-api.elclub.party`.
- **F5-R8, Studio is never exposed.** The tunnel routes `pre-api.elclub.party` to Kong only for `^/(auth|rest|realtime|storage)/v1/`, and everything else gets 404. Studio is reached only by SSH port-forward to `127.0.0.1:8000`. Every published host port binds `127.0.0.1`.
- **F5-R9, `check-rpc`.**
  - **Archive probe:** `eth_call` of USDC `totalSupply()` (`0x18160ddd`) at `latest − 1_000_000`, clamped to ≥ 1.
  - **Logs probe:** `eth_getLogs` over 2001 blocks `[latest−2100, latest−100]` on USDC `Transfer`, with `to = 0x…0001`, so the result is tiny and only the range limit is tested.
  - **Chain:** from `--chain 59144|59141`, else from `NEXT_PUBLIC_CHAIN`.
  - **URL:** from `LINEA_RPC_URL` / `LINEA_SEPOLIA_RPC_URL`, printed only as `origin + "/***"`.
- **F5-R10, mainnet readiness.**
  - `productionEnvProblems(env)` fails the build when `VERCEL_ENV === "production"`.
  - The DB defaults (both flags false on 59144) are pinned by pgTAP.
  - Turning weighted raffles or withdrawals on for 59144 stays a SuperAdmin decision, as the master plan says ("detrás de un flag, desactivado por defecto"). It is documented in the guide as "solo tras revisión legal" and is not blocked in SQL.
- **F5-R11, logs.** viem's `HttpRequestError`/`RpcRequestError` messages contain the RPC URL, which holds the Infura key. Server code logs errors through `safeError(e)`, which redacts URLs. This is a security-review finding fixed in Task 1.
- **F5-R12, production CI gate.** A `verify` job (`pnpm typecheck`, `pnpm lint`, `pnpm test:unit`) runs before `migrate`, so a red tree never migrates production.
- **F5-R13, Reown projects.** There are two:
  - "elclub prod", allowlist `elclub.party`;
  - "elclub dev/pre", allowlist `pre.elclub.party` and `localhost`.
- **F5-R14, cron runtime.** `export const maxDuration = 300` on `/api/cron/dao`. The route already accepts GET (`export const GET = handle`, tested), so no method change is needed.
- **F5-R15, auth providers.** In Supabase Cloud and self-hosted, the Email and Phone providers are disabled (SIWE only), and `enable_signup` stays true, which Web3 sign-up needs.

## Global Constraints
- **Rate limits (F5-R1).** All of them raise `rate_limited`, whose copy already exists in `src/lib/errors.ts`.

  | bucket | charged in | max | window |
  |---|---|---|---|
  | `message_min` / `message_hour` | `_post_message_core` when the author is a member: covers `post_message`, `post_message_as`, `create_bounty`, `create_poll` | 30 / 600 | 1 min / 1 h |
  | `reaction` | `toggle_reaction` | 60 | 1 min |
  | `ticket` | `open_ticket`, `post_ticket_message` | 20 | 1 min |
  | `payment_intent` | `create_tip_intent`, `create_bounty_payment_intent`, `create_donation_intent` | 30 | 10 min |
  | `poll_vote` | `cast_poll_vote` | 30 | 1 min |
  | `raffle_entry` | `enter_raffle`, `leave_raffle` | 30 | 10 min |
  | `invite_create` | `create_invite` | 30 | 1 day |
  | `withdrawal` | `request_withdrawal`, `cancel_withdrawal` | 20 | 1 day |
  | `profile` | `update_profile`, `set_handle`, `set_avatar` | 30 | 1 h |
  | `chain_verify` | pre-hit from `verifyIntentAction`, `postAlphaAction`, `markWithdrawalPaidAction`, `markRafflePaidAction` | 120 | 10 min |
  | `redeem_invite` | pre-hit from `completeLogin` before `redeem_invite`; subject `'u:'||auth.uid()` | 10 | 1 h |
  | uploads | Storage insert policies: `chat-images` / `avatars`, objects created by the member in the last hour | 60 / 20 | 1 h |
  | reports | unchanged: the existing `report_message` 10 per hour | — | — |
  | login | GoTrue `web3` = 30 per 5 min per IP; `token_refresh` 150, `sign_in_sign_ups` 30, `token_verifications` 30 | — | — |

- **CSP sources.** Every external origin the browser uses, found by grep in `src/` and `node_modules/@reown|@walletconnect`:
  - **Supabase:** the origin of `NEXT_PUBLIC_SUPABASE_URL`, plus its `wss:` (or `ws:` for `http:`) twin. This covers REST, Auth, Storage signed and public URLs, and Realtime.
  - **Public RPCs:** `https://rpc.linea.build` and `https://rpc.sepolia.linea.build` (viem defaults for the in-page raffle verifier), plus the origins of `NEXT_PUBLIC_LINEA_RPC_URL` and `NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL` when set (tests only).
  - **Reown/WalletConnect:**
    - `https://api.web3modal.org` (connect + img);
    - `https://rpc.walletconnect.org` and `https://rpc.walletconnect.com`;
    - `wss://relay.walletconnect.org` and `wss://relay.walletconnect.com`;
    - `https://pulse.walletconnect.org`;
    - `https://verify.walletconnect.org` and `https://verify.walletconnect.com` (connect + frame);
    - `https://fonts.reown.com` (font, from AppKit `ThemeUtil`);
    - the existing `frame-src` list (secure, secure-mobile, verify, dexscreener).
  - **Images:**
    - `https://api.dicebear.com`;
    - `https://coin-images.coingecko.com` and `https://assets.coingecko.com` (the `IMAGE_HOSTS` in `src/lib/market/coingecko.ts`);
    - `data:` and `blob:` (composer previews).
  - CoinGecko's API, the RPC provider, web-push and the DexScreener API are server-side or iframe only, and are not in `connect-src`.
- **Other headers:**
  - `X-Content-Type-Options: nosniff`;
  - `Referrer-Policy: strict-origin-when-cross-origin`;
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()`;
  - `X-Frame-Options: DENY`;
  - `Cross-Origin-Opener-Policy: same-origin-allow-popups`, so wallet popups keep their opener;
  - HSTS per F5-R4.
- **Production values:**
  - domain `elclub.party`, preproduction `pre.elclub.party`, preproduction API `pre-api.elclub.party`;
  - Vercel region `fra1`, cron `0 * * * *` on `/api/cron/dao`;
  - `NEXT_PUBLIC_CHAIN=linea` in production, `lineaSepolia` in preproduction;
  - `NEXT_PUBLIC_LINEA_RPC_URL` and `NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL` empty in production and preproduction.
- **Secrets never reach the bundle, the repo or the logs.** This covers `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `LINEA_*_RPC_URL`, `VAPID_PRIVATE_KEY`, the GitHub secrets and the tunnel credentials. No `.env*` file is committed, and the templates live under `deploy/` with empty values.
- **Irreversible external actions** (creating projects, DNS, deploys, pushes to `main`/`develop`) are never done by a task. The guides tell the user how, or I do them over MCP only with their confirmation.
- **Generic project guards** (existing tests enforce them):
  - every function `security definer set search_path = ''`;
  - `revoke ... from public, anon` (and from `authenticated` for internal functions);
  - re-create a function by copying its **latest** definition (named per task) and changing only what the task says;
  - schema `private` is usable by no API role.
- **Local DB:** `pnpm db:test`, `pnpm test:e2e` and `tests/integration` write the user's local DB.
  - During tasks, run single pgTAP files (`pnpm exec supabase test db supabase/tests/000_helpers.test.sql supabase/tests/<file>`) and `pnpm test:unit`.
  - Run the full suites only where a step says so and the controller has cleared it (memory rule).
- **Files:** never write files with PowerShell `Set-Content`/`Out-File` (they add a BOM). Shell scripts and YAML use LF line endings, and `.gitattributes` gains `*.sh text eol=lf` and `*.yml text eol=lf`.
- **Guides:** Spanish ("tú"), step by step, for someone who has never used Vercel or Supabase Cloud. Every value is copied from this plan, never invented.

## Review Focus
1. **A fast but honest member hits a limit.** Examples: a burst of short chat messages, reacting down a thread, or a payment dialog polling `verifyIntentAction` every 3 s for 120 s (40 calls, plus `pending-sends-sync` on reload).

   Expected:
   - 30 messages in one minute pass, and the 31st raises `rate_limited`;
   - a verification that hits the limit answers `{status: "pending"}`, never `failed`, so the dialog keeps waiting and the cron settles later.

   Tests in Task 2.
2. **The CSP breaks something only a production build shows:** the Reown modal (wallet images from `api.web3modal.org`, fonts from `fonts.reown.com`), Realtime `wss:`, a signed chat image, the DexScreener iframe, the raffle verifier's public RPC, or a tip payment. Expected: zero `securitypolicyviolation` events in these flows under `E2E_PROD=1`. Tests in Task 3 (new spec, plus a watcher added to the f3b tip and f4d verifier specs).
3. **A secret ends up in logs or output:**
   - a viem RPC error logged by the cron with the Infura URL;
   - `check-rpc` failing with the URL in an exception;
   - the readiness error listing a value;
   - a sentinel secret inlined in `.next/static`.

   Expected: only names or `origin/***` ever print, and the bundle has none. Tests in Tasks 1, 6 and 7.
4. **Code is served before its migration, or a migration fails mid-deploy.** Expected:
   - the production workflow runs `verify` → `migrate` → `deploy` strictly in sequence (`needs:`), with `concurrency` not cancelling a running deploy;
   - a failed `db push` never calls the hook;
   - preproduction builds before migrating and restarts only after migrating.

   Tests in Tasks 4 and 5.
5. **A preview or the preproduction reaches the production DB.** Expected:
   - `vercel.json` disables git deployments, so no previews exist;
   - the preproduction template points only at `pre-api.elclub.party`;
   - the production readiness check refuses a Sepolia or test configuration.

   Tests in Tasks 4, 5 and 7.

---

### Task 1: Whole-app security review, findings file, test-first fixes

**Files:**
- Create: `docs/superpowers/notes/2026-10-19-f5-security-review.md`, `src/lib/security/redact.ts`, `tests/unit/security/redact.test.ts`
- Modify: every server file that logs a caught error object (`grep -rnE "console\.(error|warn)\(.*\b(e|err|error)\)" src` lists about 35, including `src/app/api/cron/dao/route.ts`, `src/app/(forum)/dao/page.tsx`, `src/app/(forum)/dao/tesoreria/page.tsx`, `src/app/(forum)/layout.tsx` and `src/lib/treasury/*`), plus whatever the review finds.
- Fix migrations, if any: `supabase/migrations/2026101970000N_<topic>.sql` (N = 1, 2, … in order). Fix tests go in `supabase/tests/98N_*.test.sql` / `tests/unit/...`.

**Interfaces:**
- Produces: `safeError(e: unknown): string` in `src/lib/security/redact.ts`. It takes the error message (and `cause` chain, at most 3 levels) and replaces every `https?://` or `wss?://` URL with `<scheme>://<host>/***`, dropping userinfo, path, query and hash. It never throws.
- Produces: `redactUrl(url: string): string`, which returns `origin + "/***"`, or `"(invalid url)"`. Task 6 reuses the same rule in `.mjs`.

- [ ] **Step 1: Write the failing redaction tests** `tests/unit/security/redact.test.ts`:
  - `safeError(new HttpRequestError({ url: "https://linea-mainnet.infura.io/v3/abc123KEY", body: {} }))` (viem) does not contain `abc123KEY` and contains `https://linea-mainnet.infura.io/***`;
  - an `Error` whose `cause` is an `RpcRequestError` with the same URL is redacted too;
  - `wss://x.supabase.co/realtime/v1?apikey=SECRET` → no `SECRET`;
  - `safeError("plain")` returns `"plain"`, and `safeError(undefined)` returns `"unknown"`;
  - `redactUrl("https://u:p@h.io/v3/k?x=1")` returns `"https://h.io/***"`.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/security/redact.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `redact.ts`. Replace each logged error object in server code with `safeError(e)`; message strings that are already `.message` also go through `safeError`. Client components are untouched.
- [ ] **Step 4: Run** `pnpm test:unit`. Expected: PASS, after updating any spy that asserted the raw error argument so it asserts the redacted string.
- [ ] **Step 5: Audit.** Write `docs/superpowers/notes/2026-10-19-f5-security-review.md` with one row per finding: id `S1…`, area, severity (crit/high/med/low/info), evidence (`file:line`), fix or "accepted + why", and test. S1 is the log redaction above. Areas and leads, each checked and recorded even when clean:
  - **Auth:**
    - `completeLogin` bootstrap path (admin client only after `isSuperAdminWallet`);
    - `walletFromUser` identity ordering;
    - `safeNextPath`;
    - the SIWE domain/URI vs Supabase Site URL;
    - `proxy.ts` public prefixes (`/api/cron` must self-authenticate).
  - **RLS/grants:**
    - run the existing guard tests;
    - list any table in `public` without RLS (`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where nspname='public' and relkind='r' and not relrowsecurity`);
    - any function executable by `anon` that writes;
    - the `graphql_public` exposure (decide: keep, or note "deshabilitar pg_graphql en Cloud" for Task 8).
  - **Server actions:** all 22 `"use server"` files. Each must validate its input shape before any admin-client call and authorize before spending RPC. Lead: `settlePendingDonations(undefined, { memberId, limit: 5 })` in `src/app/(forum)/layout.tsx` runs RPC reads on every navigation of a member with pending donations. Record whether reload spam can amplify RPC spend, and bound it if so (for example the `chain_verify` pre-hit from Task 2, or a per-member throttle).
  - **Storage:** buckets are private except `avatars` (public by design), the insert policies' path checks, and no UPDATE policy.
  - **Realtime:** the `realtime.messages` policies and private topics only.
  - **Push:** `isAllowedPushEndpoint` (SSRF), and that the endpoint is never logged.
  - **Cron:** the constant-time bearer and the 503 when unset.
  - **Secrets:**
    - `SUPABASE_SERVICE_ROLE_KEY` is read only in `src/lib/supabase/admin.ts`;
    - every module touching `LINEA_*_RPC_URL`, VAPID private or `CRON_SECRET` imports `server-only`;
    - no `NEXT_PUBLIC_` variable holds a secret.
  - **Links:** the `/out` guard and `safeUrl` in `public/sw.js`.
  - **Dependencies:** `pnpm audit --prod`. Record each high/critical finding with whether it is reachable.
- [ ] **Step 6: Fix each finding test-first**, one commit per finding (`fix(security): S<n> <summary>`): write the failing pgTAP/unit test, run it red, fix, run it green. A finding judged "accepted" gets its reason in the file and no code. The controller may split this step into sub-tasks per finding.
- [ ] **Step 7: Run** `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, and the pgTAP files touched. Expected: PASS.
- [ ] **Step 8: Commit** the redaction as `fix(security): S1 redact RPC URLs (and keys) from server error logs`, and the findings file as `docs(security): F5 whole-app security review`.

### Task 2: Rate limiting in Postgres

**Files:**
- Create: `supabase/migrations/20261019700101_rate_limits.sql`, `supabase/tests/990_rate_limits.test.sql`, `src/lib/rate-limit.ts`, `tests/unit/rate-limit.test.ts`
- Modify: `src/lib/payments/tip-actions.ts`, `src/lib/chat/alpha.ts`, `src/lib/treasury/withdrawal-actions.ts`, `src/lib/treasury/raffle-actions.ts`, `src/lib/auth/actions.ts`, and their existing unit tests (`tests/unit/complete-login.test.ts`, `tests/unit/treasury/raffle-actions.test.ts`, and the payments/chat action tests).

**Interfaces:**
- Schema:
  - `private.rate_limit_hits (subject text not null, bucket text not null, window_start timestamptz not null, hits int not null, primary key (subject, bucket, window_start))`;
  - RLS on, and `revoke all ... from public, anon, authenticated, service_role`.
- Produces (internal, owner only): `private.rate_limit(p_subject text, p_bucket text, p_max int, p_window interval) returns void`.
  - It upserts `hits = hits + 1` for `date_bin(p_window, now(), '2000-01-01Z')` and raises `rate_limited` when the new `hits > p_max`.
  - It deletes the same subject+bucket's rows older than `now() - greatest(p_window, '1 day')`.
  - A null subject is a no-op (system writes).
- Produces (member JWT): `public.rate_limit_hit(p_bucket text) returns void`.
  - Subject = `current_member_id()::text`, else `'u:' || auth.uid()`; `not_authenticated` when both are null.
  - Buckets: `chain_verify` (120, 10 min) and `redeem_invite` (10, 1 h). Any other bucket raises `invalid_input`.
  - Granted to `authenticated` only.
- Produces (policy helper): `public.upload_quota_ok(p_bucket text) returns boolean`, stable definer, granted to `authenticated`.
  - It is true when the count of `storage.objects` in that bucket, whose member segment is `current_member_id()` and with `created_at > now() - interval '1 hour'`, is below 60 (`chat-images`) or 20 (`avatars`).
  - The member segment is the second path segment for `chat-images` and the first for `avatars`. Unknown buckets → false.
- Modifies (latest definitions; add one `perform private.rate_limit(v_me::text, '<bucket>', <max>, '<window>')` after the existing auth/forbidden checks and before the first write):
  - `_post_message_core` (`20261016200006`): `message_min` then `message_hour`, only when the author is not null;
  - `toggle_reaction` (`20261016200004`);
  - `open_ticket` and `post_ticket_message` (`20261017300006`);
  - `create_tip_intent` (`20261018600002`), `create_bounty_payment_intent` (`20261018700003`), `create_donation_intent` (`20261019300001`);
  - `cast_poll_vote` (`20261019500003`);
  - `enter_raffle` and `leave_raffle` (`20261019400003`);
  - `create_invite` (`20261016000004`);
  - `request_withdrawal` (`20261019600001`), and `cancel_withdrawal` (latest per `grep -l "function public.cancel_withdrawal(" supabase/migrations | sort | tail -1`);
  - `update_profile`, `set_handle` and `set_avatar` (`20261018500001`);
  - the policies `chat_images_insert` (latest `20261016200006`) and `avatars_insert` (`20261018500001`) gain `and public.upload_quota_ok('<bucket>')` inside the `then` branch.
- Produces (TS, `src/lib/rate-limit.ts`, `server-only`): `hitRateLimit(supabase: SupabaseClient, bucket: "chain_verify" | "redeem_invite"): Promise<"ok" | "rate_limited" | "error">`.
  - **On `rate_limited` or `error`:**
    - `verifyIntentAction` returns `{ status: "pending" }`;
    - `postAlphaAction` returns `{ error: "rate_limited" }` (on `error`: `"network"`);
    - `markWithdrawalPaidAction` and `markRafflePaidAction` return `fail("rate_limited")` (on `error`: `fail("unknown")`);
    - `completeLogin`'s `redeem` redirects to `/invite/<code>?error=rate_limited` without calling `redeem_invite`.
  - **Call points:**
    - `verifyIntentAction`: after the ownership read, before `confirmIntent`;
    - `postAlphaAction`: after the permission checks, before `verifyLineaContract`;
    - `markWithdrawalPaidAction` and `markRafflePaidAction`: before `verifyPayout` / `verifyPrizePayout`;
    - `completeLogin`: before `redeem_invite`.

- [ ] **Step 1: Write the failing pgTAP** `990_rate_limits.test.sql`:
  1. **Grants:**
     - `rate_limit_hit` is executable by `authenticated` and not by `anon`;
     - `private.rate_limit` is executable by no API role;
     - as `authenticated`, `select * from private.rate_limit_hits` raises `42501`.
  2. **Helper:**
     - 3 calls with max 3 pass and the 4th raises `rate_limited`;
     - a different subject or bucket is independent;
     - a row seeded in the previous window (`window_start - p_window`) does not count;
     - a stale row older than 1 day is deleted by the next call;
     - a null subject is a no-op.
  3. **Messages (Review Focus 1):**
     - as member A, 30 `post_message` calls in one transaction pass and the 31st raises `rate_limited`;
     - after `delete from private.rate_limit_hits`, seeding `message_hour` hits = 600 makes the next post raise;
     - member B is unaffected;
     - `post_message_as` (service role, `p_member` = A) is charged to A.
  4. **One assertion per remaining bucket at its max+1:** `reaction` 61st, `ticket` 21st, `payment_intent` 31st (tips), `poll_vote` 31st, `raffle_entry` 31st, `invite_create` 31st, `withdrawal` 21st, `profile` 31st.
  5. **`rate_limit_hit`:**
     - `chain_verify` 120 pass and the 121st raises;
     - `redeem_invite` as an authenticated non-member is keyed `'u:'||uid`, 10 pass and the 11th raises;
     - `'other'` raises `invalid_input`.
  6. **Uploads:** with 59 seeded `chat-images` objects under A's segment in the last hour, `upload_quota_ok('chat-images')` is true; at 60 it is false; objects older than 1 hour don't count. Same at 19/20 for `avatars`.
- [ ] **Step 2: Run** `990`. Expected: FAIL.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** `990`, then every pgTAP file that calls a modified RPC (`200`–`255`, `300`–`350`, `500`, `600`–`620`, `700`–`720`, `800`, `951`–`956`, `961`–`965`, `971`–`973`). Where an existing test trips `rate_limited` only because it loops one member past a limit, add `delete from private.rate_limit_hits;` (run as owner) before that block. Never raise a limit to make a test pass. Expected: PASS.
- [ ] **Step 5: Write the failing unit tests:**
  - `tests/unit/rate-limit.test.ts`: `hitRateLimit` maps `{error: {message: "rate_limited"}}` → `"rate_limited"`, a network error → `"error"`, and success → `"ok"`.
  - In the action tests:
    - `verifyIntentAction` with a mocked `rate_limited` resolves `{status: "pending"}` and never calls `confirmIntent`;
    - `postAlphaAction` never calls `verifyLineaContract` when limited;
    - `completeLogin` with an invite and a limited pre-hit redirects to `/invite/<code>?error=rate_limited` and never calls `redeem_invite`;
    - the mark-paid actions never call `verifyPayout`/`verifyPrizePayout` when limited.
- [ ] **Step 6: Run** them. Expected: FAIL. **Implement** `rate-limit.ts` and the call points. **Run** `pnpm test:unit` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 7: Full run (controller clears it first):** `pnpm db:test`, then `pnpm test:e2e`. Expected: PASS. An e2e that legitimately posts more than 30 messages per minute as one member means the threshold is wrong for humans too: stop and report rather than editing the spec.
- [ ] **Step 8: Commit** `feat(security): Postgres rate limits on abusable RPCs, uploads and on-chain verification`.

### Task 3: Security headers and full CSP

**Files:**
- Create: `src/lib/security/headers.ts`, `e2e/helpers/csp.ts`, `e2e/f5-headers.spec.ts`
- Modify: `next.config.ts`, `tests/unit/csp-headers.test.ts` (rewritten; it currently asserts there is *no* `default-src`), `e2e/f3b-tips.spec.ts` (payment test), `e2e/f4d-raffles.spec.ts` (verifier test)

**Interfaces:**
- Produces in `src/lib/security/headers.ts`:
  - `type HeaderEnv = { supabaseUrl: string | undefined; siteUrl: string | undefined; publicRpcUrls: (string | undefined)[]; dev: boolean }`;
  - `headerEnvFromProcess(env: NodeJS.ProcessEnv = process.env): HeaderEnv`. It reads `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_LINEA_RPC_URL`, `NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL` and `NODE_ENV === "development"`;
  - `buildCsp(env: HeaderEnv): string`. Directives in this order, joined by `"; "`, with the sources from Global Constraints: `default-src`, `script-src`, `style-src`, `img-src`, `font-src`, `connect-src`, `frame-src`, `worker-src 'self'`, `manifest-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, and `upgrade-insecure-requests` (https only). Malformed or empty URLs are skipped, never thrown on.
  - `securityHeaders(env: HeaderEnv): { key: string; value: string }[]`.
- `next.config.ts`: `headers()` returns `[{ source: "/:path*", headers: securityHeaders(headerEnvFromProcess()) }]`. The `FRAME_SRC` constant moves into `headers.ts`.
- Produces in `e2e/helpers/csp.ts`: `watchCsp(page: Page): () => Promise<string[]>`. It installs `addInitScript` listening for `securitypolicyviolation` (pushing `` `${e.violatedDirective} ${e.blockedURI}` ``) into `window.__cspViolations`, and returns a reader.

- [ ] **Step 1: Rewrite the failing unit test** `tests/unit/csp-headers.test.ts`, using `buildCsp`/`securityHeaders` with a fixture env `{ supabaseUrl: "https://abc.supabase.co", siteUrl: "https://elclub.party", publicRpcUrls: [], dev: false }`:
  - `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` and `frame-ancestors 'none'` are present;
  - `connect-src` contains `https://abc.supabase.co`, `wss://abc.supabase.co`, `https://rpc.linea.build`, `https://rpc.sepolia.linea.build`, `wss://relay.walletconnect.org`, `https://api.web3modal.org` and `https://pulse.walletconnect.org`;
  - `img-src` contains `https://abc.supabase.co`, `https://api.dicebear.com`, `https://coin-images.coingecko.com`, `https://assets.coingecko.com`, `https://api.web3modal.org`, `data:` and `blob:`;
  - `font-src` contains `https://fonts.reown.com`;
  - `frame-src` keeps the 7 existing origins, each matching `^https://[a-z0-9.-]+$`;
  - `script-src` is exactly `'self' 'unsafe-inline'` when not dev, and gains `'unsafe-eval'` in dev;
  - with `supabaseUrl: "http://127.0.0.1:54321"` and `siteUrl: "http://localhost:3000"`: `ws://127.0.0.1:54321` is present, and there is no `upgrade-insecure-requests` and no `Strict-Transport-Security` header;
  - with https: HSTS is `max-age=63072000; includeSubDomains`, and `upgrade-insecure-requests` is present;
  - `publicRpcUrls: ["http://127.0.0.1:8545/abc"]` adds `http://127.0.0.1:8545` (origin only);
  - `"not a url"` and `undefined` are skipped;
  - the other five headers have the exact values from Global Constraints;
  - `nextConfig.headers()` applies them on `/:path*`.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/csp-headers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `headers.ts` and wire `next.config.ts`.
- [ ] **Step 4: Run** it again, plus `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Write the e2e** `e2e/f5-headers.spec.ts`:
  - `GET /login` has the CSP containing `default-src 'self'`, `nosniff`, `X-Frame-Options: DENY`, and no HSTS on http;
  - **"no CSP violation across the main flows"** (Review Focus 2), with `watchCsp` installed and the reader returning `[]` at the end:
    1. on `/login`, open the wallet modal and wait for a wallet image;
    2. `loginAs`, open General, and upload `e2e/fixtures/avatar.png` as a chat image until it renders;
    3. seed an Alpha message with the admin client's `post_message_as` (`p_alpha_address` = any address, as the f2b specs seed messages) and wait for the DexScreener `iframe`;
    4. in a second context logged in as another member, see a message posted by the first arrive (Realtime);
    5. open `/mercado`.
- [ ] **Step 6: Add `watchCsp`** to the tip payment test in `e2e/f3b-tips.spec.ts` and the verifier test in `e2e/f4d-raffles.spec.ts`, asserting `[]` at their end.
- [ ] **Step 7: Run (controller clears it):**
  - `pnpm exec playwright test e2e/f5-headers.spec.ts e2e/f3b-tips.spec.ts e2e/f4d-raffles.spec.ts`, then the same with `E2E_PROD=1`. Expected: PASS in both.
  - A violation means a missing origin: add it to the constant list with a comment naming the caller (never `*` or a scheme-only source), and add it to the unit test.
- [ ] **Step 8: Commit** `feat(security): full CSP and security headers, env-derived Supabase origin, e2e violation watch`.

### Task 4: Production deploy wiring (Vercel + GitHub Actions)

**Files:**
- Create: `vercel.json`, `.github/workflows/production.yml`, `tests/unit/deploy/production-wiring.test.ts`, `.gitattributes` (or modify it if it exists)
- Modify: `src/app/api/cron/dao/route.ts` (add `export const maxDuration = 300;`), `tests/unit/treasury/cron-route.test.ts`, `.env.example` (the `CRON_SECRET` comment: "GET (Vercel Cron) o POST")

**Interfaces:**
- `vercel.json`, exact:
  ```json
  {
    "$schema": "https://openapi.vercel.sh/vercel.json",
    "framework": "nextjs",
    "regions": ["fra1"],
    "git": { "deploymentEnabled": false },
    "crons": [{ "path": "/api/cron/dao", "schedule": "0 * * * *" }]
  }
  ```
- `.github/workflows/production.yml`:
  - **Triggers:** `on: push: branches: [main]` and `workflow_dispatch`.
  - **Concurrency:** `concurrency: { group: production, cancel-in-progress: false }`; `permissions: { contents: read }`.
  - **Jobs, in order:**
    - **`verify`** (`ubuntu-latest`): `actions/checkout@v4`, `pnpm/action-setup@v4` (reads `packageManager`), `actions/setup-node@v4` with `node-version: 22` and `cache: pnpm`, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`.
    - **`migrate`** (`needs: verify`, `environment: production`): `actions/checkout@v4` and `supabase/setup-cli@v1`, with `version` pinned to the output of `pnpm exec supabase --version`. Then `supabase link --project-ref "$SUPABASE_PROJECT_REF"` and `supabase db push --yes` (check `supabase db push --help` for the non-interactive flag and pin the one that exists). Env from secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`.
    - **`deploy`** (`needs: migrate`, `environment: production`): `curl -fsS -X POST "$VERCEL_DEPLOY_HOOK_URL"`, with the env from the secret `VERCEL_DEPLOY_HOOK_URL`.
  - No `pull_request` trigger, and no secret is echoed.

- [ ] **Step 1: Write the failing tests:**
  - `production-wiring.test.ts`:
    - parse `vercel.json`: it equals the object above;
    - read `production.yml` as text:
      - `on:` has `main` and no `pull_request`;
      - `cancel-in-progress: false`;
      - `migrate` has `needs: verify` and `deploy` has `needs: migrate`;
      - the index of `db push` < the index of `VERCEL_DEPLOY_HOOK_URL`;
      - every `${{ secrets.X }}` is one of the four names above;
      - no line `echo`es a secret.
  - `cron-route.test.ts`: `maxDuration === 300`. The existing "GET (Vercel Cron) has the same auth" test stays.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/deploy/production-wiring.test.ts tests/unit/treasury/cron-route.test.ts`. Expected: FAIL.
- [ ] **Step 3: Create** the files, `maxDuration`, and `.gitattributes` (`*.sh text eol=lf`, `*.yml text eol=lf`, `Dockerfile text eol=lf`).
- [ ] **Step 4: Run** them again, plus `pnpm test:unit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(deploy): vercel.json (fra1, hourly cron, no git deploys), production workflow verify → migrate → deploy hook`.

### Task 5: Preproduction artifacts (Docker, compose, tunnel, self-hosted runner)

**Files:**
- Create:
  - `Dockerfile`, `.dockerignore`;
  - `deploy/preprod/docker-compose.yml`, `deploy/preprod/cloudflared/config.yml`, `deploy/preprod/cron/crontab`;
  - `deploy/preprod/web.env.example`, `deploy/prod/vercel.env.example`;
  - `.github/workflows/preproduction.yml`, `tests/unit/deploy/preprod-wiring.test.ts`
- Modify: `next.config.ts` (`output`), `tests/unit/csp-headers.test.ts` or a new `tests/unit/next-config.test.ts` (output switch)

**Interfaces:**
- `next.config.ts`: `output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined`.
- `Dockerfile` stages, all on `node:22-bookworm-slim`:
  - **`deps`:** `corepack enable`. Copy `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml`, then `pnpm install --frozen-lockfile`.
  - **`build`:**
    - `ARG` for every `NEXT_PUBLIC_*` in `.env.example`, plus `ENV NEXT_OUTPUT=standalone` and `NEXT_TELEMETRY_DISABLED=1`;
    - `pnpm build`.
  - **`run`:**
    - user `nextjs` (uid 1001);
    - copy `.next/standalone`, `.next/static` → `.next/static` and `public`;
    - `ENV PORT=3000 HOSTNAME=0.0.0.0 NODE_ENV=production`;
    - `CMD ["node", "server.js"]`, plus a `HEALTHCHECK` with `node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`.
  - No secret is an `ARG`: server secrets come only at runtime through `env_file`.
- `.dockerignore`: `node_modules`, `.next`, `.git`, `.env*`, `e2e`, `tests`, `playwright-report`, `test-results`, `.claude`, `docs`.
- `deploy/preprod/docker-compose.yml`:
  - project `name: elclub-pre`;
  - network `supabase_default` declared `external: true`;
  - **`web`:**
    - `build.context: ../..`, with `build.args` listing each `NEXT_PUBLIC_*` as `${VAR}`;
    - `env_file: ${ELCLUB_ENV_FILE:-/opt/elclub/pre/web.env}`;
    - `ports: ["127.0.0.1:3000:3000"]`, `restart: unless-stopped`.
  - **`cron`:**
    - `alpine:3.20`, with `env_file` the same as `web` and `depends_on: web`;
    - mounts `./cron/crontab:/etc/crontabs/root:ro`;
    - `command: sh -c 'apk add --no-cache curl && umask 077 && printf "CRON_SECRET=%s\n" "$$CRON_SECRET" > /etc/elclub-cron.env && exec crond -f -l 8'`. The `$$` stops compose from interpolating the value at parse time. busybox `crond` does not pass the container env to jobs, which is why the file exists.
  - **`cloudflared`:**
    - `cloudflare/cloudflared` pinned to a dated tag;
    - `command: tunnel --config /etc/cloudflared/config.yml run`;
    - mounts `./cloudflared/config.yml` and `/opt/elclub/pre/cloudflared/credentials.json` read-only;
    - networks: default + `supabase_default`.
  - No other `ports:`.
- `deploy/preprod/cron/crontab` (LF, trailing newline): `0 * * * * . /etc/elclub-cron.env && curl -fsS -o /dev/null -w "cron %{http_code}\n" -H "Authorization: Bearer $CRON_SECRET" http://web:3000/api/cron/dao > /proc/1/fd/1 2>&1`. Only the status code is logged, never the header.
- `deploy/preprod/cloudflared/config.yml`:
  ```yaml
  tunnel: elclub-pre
  credentials-file: /etc/cloudflared/credentials.json
  ingress:
    - hostname: pre.elclub.party
      service: http://web:3000
    - hostname: pre-api.elclub.party
      path: ^/(auth|rest|realtime|storage)/v1/
      service: http://kong:8000
    - hostname: pre-api.elclub.party
      service: http_status:404
    - service: http_status:404
  ```
- `.github/workflows/preproduction.yml`:
  - **Triggers and concurrency:** `on: push: branches: [develop]` and `workflow_dispatch`; `concurrency: { group: preproduction, cancel-in-progress: false }`.
  - **Job `deploy`:** `runs-on: [self-hosted, linux, elclub-pre]`, `environment: preproduction`, `env: { ELCLUB_ENV_FILE: /opt/elclub/pre/web.env, COMPOSE: docker compose --env-file /opt/elclub/pre/web.env -f deploy/preprod/docker-compose.yml }`.
  - **Steps, in order:**
    1. checkout;
    2. **Build:** `$COMPOSE build web`;
    3. `supabase/setup-cli@v1` (same pinned version as Task 4);
    4. **Migrate:** `supabase db push --db-url "$PREPROD_DB_URL"` (secret), with the same non-interactive flag;
    5. **Restart:** `$COMPOSE up -d --no-build web cron cloudflared`;
    6. **Smoke:** `curl -fsS -o /dev/null http://127.0.0.1:3000/login`, retried 10× at 3 s;
    7. `docker image prune -f`.
  - No `pull_request` trigger. A self-hosted runner must never run fork code.
- `deploy/preprod/web.env.example`: every key of `.env.example`, empty unless fixed by this plan:
  - `NEXT_PUBLIC_SUPABASE_URL=https://pre-api.elclub.party`, `NEXT_PUBLIC_SITE_URL=https://pre.elclub.party`, `NEXT_PUBLIC_CHAIN=lineaSepolia`;
  - `NEXT_PUBLIC_LINEA_RPC_URL=` and `NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL=` (empty).
- `deploy/prod/vercel.env.example`: the same keys for production:
  - `NEXT_PUBLIC_SITE_URL=https://elclub.party`, `NEXT_PUBLIC_CHAIN=linea`;
  - the Supabase URL left as `https://<ref>.supabase.co`;
  - the public RPCs empty;
  - the overrides (`ETH_USD_FEED_ADDRESS_59141`, `WETH_ADDRESS_59141`, `COINGECKO_DISABLED`, `COINGECKO_API_BASE`) absent, with a comment saying why;
  - plus `ENABLE_EXPERIMENTAL_COREPACK=1` (Vercel uses `pnpm@12.11.2` from `packageManager`).

- [ ] **Step 1: Write the failing tests** `preprod-wiring.test.ts`, text/JSON assertions:
  - **Compose:**
    - every `ports:` entry starts with `127.0.0.1:`;
    - `supabase_default` is external;
    - no service publishes `8000`, `5432` or `54323`.
  - **Tunnel config:**
    - the only rule sending `pre-api.elclub.party` to `kong` carries the path `^/(auth|rest|realtime|storage)/v1/`;
    - a `pre-api` catch-all `http_status:404` follows it;
    - the last rule is `http_status:404` (Review Focus 5: Studio never exposed).
  - **Dockerfile:**
    - has `USER nextjs`;
    - no `ARG` named like `SERVICE_ROLE|SECRET|PRIVATE|RPC_URL` other than `NEXT_PUBLIC_*`;
    - copies `.next/static`.
  - **`.dockerignore`:** contains `.env*`.
  - **Workflow:**
    - `develop` and no `pull_request`;
    - index of `build web` < index of `db push` < index of `up -d`;
    - `runs-on` includes `self-hosted`.
  - **`web.env.example`:**
    - has every key of `.env.example`;
    - contains no `supabase.co`;
    - has `NEXT_PUBLIC_SUPABASE_URL=https://pre-api.elclub.party`, `NEXT_PUBLIC_SITE_URL=https://pre.elclub.party` and `NEXT_PUBLIC_CHAIN=lineaSepolia`.
  - **Crontab:** contains `0 * * * *` and `/api/cron/dao`, and does not contain `-v` or `--verbose` (which would print the header).
  - **`next-config`:** with `vi.stubEnv("NEXT_OUTPUT", "standalone")` and a fresh import, `output === "standalone"`; without it, `undefined`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Create** the files.
- [ ] **Step 4: Run** `pnpm test:unit`. Expected: PASS.
- [ ] **Step 5: Verify the image** if Docker is available locally (`docker --version`):
  - `docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 --build-arg NEXT_PUBLIC_REOWN_PROJECT_ID=placeholder --build-arg NEXT_PUBLIC_CHAIN=lineaSepolia -t elclub-web:test .`, then `docker run --rm -p 127.0.0.1:3001:3000 --env-file .env.local elclub-web:test`;
  - `curl -sI http://127.0.0.1:3001/login` returns 200 or 307 with the CSP header.

  Without Docker, record in the commit body that the image is first built on the homelab (Task 9 verifies it).
- [ ] **Step 6: Commit** `feat(deploy): preproduction Docker image (standalone), compose with cron and tunnel, self-hosted develop workflow, env templates`.

### Task 6: `scripts/check-rpc.mjs`

**Files:**
- Create: `scripts/check-rpc.mjs`, `tests/unit/scripts/check-rpc.test.ts` (`// @vitest-environment node`)
- Modify: `package.json` (`"check:rpc": "node scripts/check-rpc.mjs"`)

**Interfaces** (all exported from `scripts/check-rpc.mjs`, plain ESM with JSDoc types; `main()` runs only when `import.meta.url === pathToFileURL(process.argv[1]).href`):
- `CHAINS = { 59144: { name: "Linea", usdc: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff", rpcEnv: "LINEA_RPC_URL" }, 59141: { name: "Linea Sepolia", usdc: "0xFEce4462D57bD51A6A552365A011b95f0E16d9B7", rpcEnv: "LINEA_SEPOLIA_RPC_URL" } }`. A unit test pins them equal to `NETWORKS[...].usdc`.
- `resolveChain(argv: string[], env: Record<string, string | undefined>): 59144 | 59141`. It reads `--chain <id>` first, else `NEXT_PUBLIC_CHAIN` (`linea` → 59144, `lineaSepolia` or unset → 59141), and throws `Error("chain_invalid")` otherwise.
- `redactUrl(url: string): string`, the same contract as Task 1.
- `rpc(url: string, method: string, params: unknown[], fetchImpl = fetch): Promise<unknown>`. JSON-RPC 2.0 with a 15 s `AbortSignal.timeout`. It throws `Error(\`${method}: ${code} ${message}\`)` on a JSON-RPC error or a non-2xx response, and never includes the URL.
- `checkRpc(url: string, chainId: 59144 | 59141, fetchImpl = fetch): Promise<{ ok: boolean; lines: string[] }>`. Steps in order, each adding `OK …` or `FAIL …`; a failure stops later steps:
  1. `eth_chainId` equals `chainId`;
  2. `eth_blockNumber` → `latest`;
  3. **archive:** `eth_call {to: usdc, data: "0x18160ddd"}` at `toHex(max(1, latest − 1_000_000))` returns a 32-byte hex string;
  4. **logs:** `eth_getLogs {address: usdc, fromBlock: latest−2100, toBlock: latest−100, topics: [TRANSFER_TOPIC, null, "0x" + "0".repeat(63) + "1"]}` returns an array, where `TRANSFER_TOPIC = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`.

  Every line and the thrown message pass through a sanitizer that replaces the full URL and each path or query segment of length ≥ 8 with `***`.
- `main()`: prints `Comprobando <redactUrl(url)> en <name> (<id>)`, then the lines, and exits with 0 (all OK), 1 (any FAIL) or 2 (the env var is missing, printing only its name).

- [ ] **Step 1: Write the failing tests:**
  - `resolveChain` (both sources, the flag wins, and `"mainnet"` throws);
  - `redactUrl`;
  - with a fake `fetchImpl` scripted per method:
    - all good → `ok: true` and 4 `OK` lines;
    - a wrong chain id → `FAIL` at step 1 and no later call;
    - the archive call answering `{error: {code: -32000, message: "missing trie node"}}` → `FAIL archive` and `ok: false`;
    - `eth_getLogs` answering `{error: {code: -32005, message: "query exceeds max block range 1000"}}` → `FAIL eth_getLogs`;
    - a fetch rejecting with `TypeError("fetch failed: https://linea-mainnet.infura.io/v3/SECRETKEY123")` → no output line contains `SECRETKEY123`;
    - the archive block for `latest = 500` is `0x1`;
    - the getLogs range spans exactly 2001 blocks;
  - `CHAINS[n].usdc === NETWORKS[n].usdc` for both chains.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/scripts/check-rpc.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it again. Expected: PASS. Then `node scripts/check-rpc.mjs --chain 59141` with no env var: exit 2 and only the name `LINEA_SEPOLIA_RPC_URL` printed.
- [ ] **Step 5: Commit** `feat(deploy): check-rpc script (archive state + 2000-block getLogs), key never printed`.

### Task 7: Mainnet readiness in code and tests

**Files:**
- Create: `src/lib/deploy/readiness.ts`, `tests/unit/deploy/readiness.test.ts`, `supabase/tests/991_mainnet_defaults.test.sql`
- Modify: `next.config.ts`, `tests/unit/economy/networks.test.ts`

**Interfaces:**
- Produces `productionEnvProblems(env: Record<string, string | undefined>): string[]`, returning problem codes that name variables, never values:
  - `NEXT_PUBLIC_CHAIN must be linea`;
  - `NEXT_PUBLIC_LINEA_RPC_URL must be empty` and `NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL must be empty`;
  - `LINEA_RPC_URL is required`;
  - `NEXT_PUBLIC_SITE_URL must be https`;
  - `NEXT_PUBLIC_SUPABASE_URL must be https`;
  - `CRON_SECRET must be at least 32 characters`;
  - `SUPER_ADMIN_WALLET must be a 0x address`;
  - `<NAME> must be unset in production` for each of `ETH_USD_FEED_ADDRESS_59141`, `WETH_ADDRESS_59141`, `ETH_USD_FEED_ADDRESS_59144`, `WETH_ADDRESS_59144`, `COINGECKO_DISABLED`, `COINGECKO_API_BASE`;
  - `TIP_CONFIRMATIONS must be empty or >= 3`.
- Produces `assertProductionReady(env = process.env): void`. When `env.VERCEL_ENV === "production"` and there are problems, it throws `Error("Configuración de producción inválida: " + problems.join("; "))`. Otherwise it is a no-op. `next.config.ts` calls it at module top level.

- [ ] **Step 1: Write the failing tests:**
  - **`readiness.test.ts`:**
    - a complete valid env → `[]`;
    - each bad field alone → exactly its code;
    - `assertProductionReady` with `VERCEL_ENV: "preview"` or unset never throws;
    - with `"production"` and `LINEA_RPC_URL: "https://x/v3/TOPSECRET"` plus `NEXT_PUBLIC_LINEA_RPC_URL: "https://pub/KEY2"`, the thrown message contains `NEXT_PUBLIC_LINEA_RPC_URL` and contains neither `TOPSECRET` nor `KEY2` (Review Focus 3).
  - **`networks.test.ts`** (pins F5 spec §7):
    - `NETWORKS[59144]` equals usdc `0x176211869cA2b568f2A7D4EE941E073a821EE1ff`, weth `0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f`, ethUsdFeed `0x3c6Cd9Cc7c7a4c2Cf5a82734CD249D7D593354dA`, heartbeat `86400`, `testnet: false`;
    - each address equals viem `getAddress(addr)` (checksummed);
    - `addressesFor(59144)` with `WETH_ADDRESS_59144`, `ETH_USD_FEED_ADDRESS_59144`, `WETH_ADDRESS_59141` and `ETH_USD_FEED_ADDRESS_59141` all stubbed to `0x000…0bad` still returns the `NETWORKS[59144]` values.
  - **`991_mainnet_defaults.test.sql`:**
    - the column defaults of `chain_config.withdrawals_enabled` and `weighted_raffles_enabled` are `false`;
    - after all migrations, the 59144 row has both `false`;
    - `app_config.active_chain_id` defaults to `59141` (production switches it by hand, Task 8).
- [ ] **Step 2: Run** them. Expected: FAIL (module missing; the SQL may already pass, which is fine for a pin).
- [ ] **Step 3: Implement** `readiness.ts` and the `next.config.ts` call.
- [ ] **Step 4: Run** `pnpm test:unit`, pgTAP `991` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Bundle check** (Review Focus 3):
  - Build with sentinels: `SUPABASE_SERVICE_ROLE_KEY=SENTINELSRK CRON_SECRET=SENTINELCRON LINEA_RPC_URL=https://h.example/v3/SENTINELRPC VAPID_PRIVATE_KEY=SENTINELVAPID pnpm build` (other vars from `.env.local`).
  - Then `grep -rlE "SENTINEL(SRK|CRON|RPC|VAPID)" .next/static`. Expected: no output.
- [ ] **Step 6: Commit** `feat(deploy): mainnet readiness check fails a misconfigured production build; pin mainnet addresses and flag defaults`.

### Task 8: Guía de producción, matriz de entornos y MCP

**Files:**
- Create: `docs/deploy/produccion.md`, `docs/deploy/entornos.md`, `tests/unit/deploy/guides.test.ts`

**Interfaces:**
- Consumes: every name and value from Tasks 2–7:
  - `vercel.json` and the workflow secret names `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, `VERCEL_DEPLOY_HOOK_URL`, plus environment `production`;
  - `deploy/prod/vercel.env.example`;
  - `pnpm check:rpc`;
  - the readiness codes;
  - the rate-limit table and the CSP origins.

- [ ] **Step 1: Write the failing test** `guides.test.ts`:
  - every key in `.env.example` appears in `entornos.md`, and so do `NEXT_OUTPUT` and `ENABLE_EXPERIMENTAL_COREPACK`;
  - `produccion.md` contains each of these strings:
    - `fra1`, `eu-central-1`, `Web3`, `Site URL`, `Redirect URLs`, `Allow public access`, `Rate Limits`;
    - `deploymentEnabled`, `Deploy Hook`, `CRON_SECRET`, `SUPER_ADMIN_WALLET`, `generate-vapid-keys`, `Reown`;
    - `2-de-3`, `db dump`, `check:rpc`, `archive`, `tx=rollback`, `/settings/economia`, `Linea mainnet`;
    - `NEXT_PUBLIC_LINEA_RPC_URL`, `ENABLE_EXPERIMENTAL_COREPACK`, `Production`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Write `docs/deploy/produccion.md`** in Spanish, numbered, each step with "Comprueba:" (what the user should see). Sections, in order:
  1. **Qué vas a montar:** a diagram in text (Cloudflare DNS → Vercel `fra1` ↔ Supabase `eu-central-1`; GitHub Actions `main` → migraciones → deploy hook), and what never happens (previews, code before migration).
  2. **Cuentas y claves que necesitas:** Infura mainnet; run `pnpm check:rpc -- --chain 59144` with `LINEA_RPC_URL` set. It must print 4 `OK`. If archive or `eth_getLogs` fails, change the Infura plan or provider: the cron's Safe scan reads 2000-block windows and values the Safe at past blocks.
  3. **Supabase Cloud:**
     - create the project (Free, region Central EU Frankfurt, strong DB password saved in a password manager);
     - **Authentication → Sign In / Providers:** enable **Web3 Wallet → Ethereum**, disable Email and Phone, and keep "Allow new users to sign up" on;
     - **Authentication → URL Configuration:** Site URL `https://elclub.party`, Redirect URLs `https://elclub.party/**`;
     - **Authentication → Rate Limits:** Web3 30, token refresh 150, sign-ups/sign-ins 30, token verifications 30 (per 5 min/IP, as in `supabase/config.toml`);
     - **Realtime → Settings:** turn off "Allow public access" (private channels only; the app uses only private topics);
     - **Project Settings → Data API:** exposed schemas `public, graphql_public`, max rows 1000, never add `private`, and the security-review ruling on GraphQL (Task 1);
     - **JWT expiry 3600**;
     - API keys: the publishable or anon key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`, the secret or service_role key → `SUPABASE_SERVICE_ROLE_KEY` (sensitive), with a note on new `sb_publishable_`/`sb_secret_` keys vs legacy;
     - **never enable PostgREST `tx=rollback`** (`db-tx-end` stays `commit`): it would let a client dry-run definer RPCs to probe results without a trace;
     - a first `supabase db push --dry-run` from the user's PC (`supabase link`, then `db push --dry-run`) to see the 90+ migrations listed before CI applies them.
  4. **Vercel (Pro):**
     - import the GitHub repo, framework Next.js, Node 22;
     - **Environment Variables:** each key from `deploy/prod/vercel.env.example`, **Production only**, with secrets marked Sensitive;
     - `ENABLE_EXPERIMENTAL_COREPACK=1`;
     - confirm the region `fra1` comes from `vercel.json`;
     - **Settings → Git:** check that `vercel.json` disables git deployments (`deploymentEnabled`); create a **Deploy Hook** for branch `main` and copy the URL;
     - **Cron Jobs** tab shows `/api/cron/dao` hourly once deployed;
     - **Domains:** `elclub.party` plus `www.elclub.party` → redirect to apex.
  5. **Cloudflare DNS:**
     - the apex and `www` records with the exact values Vercel's Domains page shows, set to **DNS only** (grey cloud);
     - SSL handled by Vercel;
     - do not touch `pre`/`pre-api` (the homelab guide creates them).
  6. **GitHub:**
     - create the `develop` branch;
     - Environments `production` (secrets `SUPABASE_ACCESS_TOKEN` from supabase.com/dashboard/account/tokens, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, `VERCEL_DEPLOY_HOOK_URL`) and `preproduction` (`PREPROD_DB_URL`, filled by the homelab guide);
     - branch protection on `main` and `develop`: PR required, no force-push;
     - the flow develop → PR → main.
  7. **Secrets to generate:**
     - `CRON_SECRET` (`openssl rand -hex 32`);
     - VAPID: `pnpm exec web-push generate-vapid-keys --json`, one pair per environment, with `VAPID_SUBJECT=mailto:<tu correo>`;
     - Reown: create project "elclub prod" at dashboard.reown.com, Domain allowlist `elclub.party`, and copy the Project ID.
  8. **First deploy:**
     - merge to `main`, then watch Actions verify → migrate → deploy;
     - Vercel shows a Production deployment "via Deploy Hook";
     - **if the hook does not deploy because git deployments are disabled:** the fallback is to set `"git": {"deploymentEnabled": {"main": false}}` plus Vercel → Settings → Git → Ignored Build Step `exit 0` for other branches. The guide states the check and the fallback (spec risk).
  9. **Arranque:**
     - log in with the wallet set in `SUPER_ADMIN_WALLET`, which bootstraps the SuperAdmin;
     - in **`/settings/economia`**, switch the active chain to **Linea mainnet** (the DB default is Sepolia) and paste the Safe address;
     - check withdrawals and weighted raffles are **off** (default). Turn them on only after legal review (master plan).
  10. **Safe 1-de-1 → 2-de-3** (before real money): app.safe.global → Linea → Settings → Setup → add 2 owners (own wallets, never shared), then threshold 2 of 3. The address does not change, so nothing changes in the app.
  11. **Comprobaciones:**
      - headers via `curl -sI https://elclub.party/login` (CSP, HSTS);
      - login, a tip of 0.01 USDC between two of your test accounts;
      - the cron run visible in Vercel logs (200 JSON);
      - `pnpm check:rpc`.
  12. **Copias (Supabase Free has no downloadable backups, and pauses after 7 days without activity; the hourly cron keeps it active):**
      - `supabase db dump --db-url "$URL" -f roles.sql --role-only`;
      - `supabase db dump --db-url "$URL" -f schema.sql`;
      - `supabase db dump --db-url "$URL" -f data.sql --use-copy --data-only`;
      - Storage with `supabase storage cp -r ss:///chat-images ./backup/chat-images --experimental` (same for `avatars`);
      - weekly, kept off-site; plus a restore drill into a scratch project;
      - upgrade to Pro for PITR when real money arrives.
  13. **Notas F4 de producción:**
      - Infura must serve archive state and `eth_getLogs` ≥ 2000 blocks (`check:rpc`);
      - `NEXT_PUBLIC_LINEA_*_RPC_URL` stay empty (the build fails otherwise);
      - never `tx=rollback`;
      - withdrawals off by default;
      - weighted raffles off on mainnet;
      - every `NEXT_PUBLIC_*` or CSP-relevant change needs a **rebuild** (Vercel → Redeploy without cache);
      - after any DB wipe, reconfigure the Safe and the active chain in `/settings/economia`;
      - Linea finality takes time: payouts and draws settle on a later cron run, which is normal.
  14. **Límites y qué ve un miembro:** the rate-limit table in plain words.
- [ ] **Step 4: Write `docs/deploy/entornos.md`:**
  - **The matrix:** one row per variable, with columns desarrollo / preproducción / producción / secreta / build-time. Each cell is an exact value, "vacía", or "<tu valor>". Mark `NEXT_PUBLIC_*` as build-time (and the CSP derived from them).
  - **"Qué MCP instalar y qué puedo hacer con cada uno":**
    - **Vercel MCP:** read projects, deployments, build and runtime logs, and env names;
    - **Supabase MCP:** recommend `read_only=true` and `project_ref` scoped for production. I can list tables, run read-only SQL and read logs/advisors, but never apply migrations to production (CI does);
    - **Cloudflare MCP:** DNS records and Tunnel inspection;
    - each with "qué haría yo solo con tu confirmación" and "nada depende de que esté instalado".
- [ ] **Step 5: Run** `pnpm vitest run tests/unit/deploy/guides.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `docs(deploy): guía de producción paso a paso, matriz de entornos y MCP`.

### Task 9: Guía de preproducción en el homelab (para otra IA en Proxmox)

**Files:**
- Create: `docs/deploy/preproduccion-homelab.md`
- Modify: `tests/unit/deploy/guides.test.ts`

**Interfaces:**
- Consumes: Task 5's files, paths and names (`/opt/elclub/pre/web.env`, `/opt/elclub/pre/cloudflared/credentials.json`, runner label `elclub-pre`, project `elclub-pre`, network `supabase_default`), `PREPROD_DB_URL`, and `pnpm check:rpc -- --chain 59141`.

- [ ] **Step 1: Extend the failing test.** `preproduccion-homelab.md` contains:
  - `pre.elclub.party`, `pre-api.elclub.party`, `supabase_default`, `elclub-pre`;
  - `GOTRUE_EXTERNAL_WEB3_ETHEREUM_ENABLED`, `127.0.0.1`, `cloudflared tunnel ingress rule`, `http_status:404`;
  - `PREPROD_DB_URL`, `private_only`, `pg_dump`, `select version()`;
  - every key of `deploy/preprod/web.env.example`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Write the guide.** It is self-contained: it opens with "Contexto para la IA operadora" (what elclublambo is, what preproduction is for, the rules: never expose Studio or Postgres, never put production keys here, always ask the human before DNS changes). Then numbered steps, each with commands and a "Comprueba:" line:
  1. **VM:** Proxmox Debian 12 VM (not LXC, since Docker in an unprivileged LXC is fragile): 4 vCPU, 8 GB RAM, 60 GB disk, static LAN IP. Install SSH keys and `unattended-upgrades`.
  2. **Docker Engine + compose plugin** from Docker's apt repo. Comprueba: `docker compose version`.
  3. **Supabase self-hosted:**
     - `git clone --depth 1 https://github.com/supabase/supabase /opt/supabase`, `cd /opt/supabase/docker`, `cp .env.example .env`;
     - generate `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` (per Supabase's self-hosting docs) and `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`;
     - set `SITE_URL=https://pre.elclub.party`, `ADDITIONAL_REDIRECT_URLS=https://pre.elclub.party/**`, `API_EXTERNAL_URL=https://pre-api.elclub.party`, `SUPABASE_PUBLIC_URL=https://pre-api.elclub.party`;
     - disable email/phone signup but keep `DISABLE_SIGNUP=false`;
     - in `docker-compose.yml` → `auth.environment` add `GOTRUE_EXTERNAL_WEB3_ETHEREUM_ENABLED: "true"` and `GOTRUE_RATE_LIMIT_WEB3: "30"` (verify the names against the GoTrue version in the compose);
     - change every published port to `127.0.0.1:`.
  4. **Start Supabase and check it:**
     - `docker compose up -d` (project name `supabase`, so network `supabase_default`);
     - Comprueba: `docker network ls | grep supabase_default`;
     - `select version()` must be PostgreSQL ≥ 17 (local `major_version = 17`). If it is lower, run the full pgTAP suite against it before continuing and report to the human.
  5. **Realtime private only:** `docker exec supabase-db psql -U postgres -c "update _realtime.tenants set private_only = true"`, then restart realtime. Check the column exists first; if it does not, note it and continue, since the app only uses private topics.
  6. **Studio access:** only over `ssh -L 8000:127.0.0.1:8000 <vm>`, then `http://localhost:8000`.
  7. **Repo and env:**
     - `/opt/elclub/pre/web.env` from `deploy/preprod/web.env.example`, mode 600, owned by the runner user;
     - fill it: the self-hosted `ANON_KEY`/`SERVICE_ROLE_KEY`, Sepolia Infura URL, its own `CRON_SECRET` and VAPID pair, and the Reown "elclub dev/pre" project ID;
     - Comprueba: `pnpm check:rpc -- --chain 59141` from a checkout prints 4 `OK`.
  8. **Cloudflare Tunnel (locally-managed):**
     - install `cloudflared`, `cloudflared tunnel login`, `cloudflared tunnel create elclub-pre`;
     - copy the credentials JSON to `/opt/elclub/pre/cloudflared/credentials.json` (600);
     - `cloudflared tunnel route dns elclub-pre pre.elclub.party` and `... pre-api.elclub.party` (ask the human first);
     - Comprueba:
       - `cloudflared tunnel ingress validate --config deploy/preprod/cloudflared/config.yml`;
       - `cloudflared tunnel ingress rule --config ... https://pre-api.elclub.party/project/default` → `http_status:404`;
       - `.../rest/v1/` → `http://kong:8000`.
  9. **GitHub self-hosted runner:**
     - a dedicated user `gh-runner` in group `docker`;
     - repo → Settings → Actions → Runners → New (Linux x64), labels `self-hosted,linux,elclub-pre`, installed as a service (`./svc.sh install gh-runner && ./svc.sh start`);
     - the repo must not run workflows from forks (Settings → Actions → "Require approval for all outside collaborators");
     - environment `preproduction` secret `PREPROD_DB_URL=postgresql://postgres.<POOLER_TENANT_ID>:<POSTGRES_PASSWORD>@127.0.0.1:5432/postgres` (Supavisor session port; check the user and tenant format in the self-hosted `.env`).
  10. **First deploy:** push to `develop` (the human does it), then watch build → migrate → restart → smoke. Comprueba:
      - `https://pre.elclub.party/login` loads;
      - `curl -s https://pre-api.elclub.party/` returns 404;
      - login with a test wallet bootstraps the SuperAdmin of preproduction (`SUPER_ADMIN_WALLET` = a test wallet of the human, never their real one);
      - `/settings/economia` gets the Sepolia Safe;
      - `docker logs elclub-pre-cron-1` shows a 200 at the next full hour.
  11. **Mantenimiento:**
      - update Supabase: `git pull` in `/opt/supabase`, review the `.env` diff, `docker compose pull && up -d`;
      - backups: a nightly `pg_dump` of the preproduction DB with 7-day rotation is optional (preproduction data is disposable);
      - disk: `docker system df`, `docker image prune`;
      - after any DB wipe, reconfigure the Safe and the active chain;
      - every change to `NEXT_PUBLIC_*` needs a rebuild (re-run the workflow);
      - logs: `docker compose -p elclub-pre logs -f web`.
  12. **Solución de problemas:**
      - login fails because the Web3 provider is off or the Site URL is wrong;
      - the CSP blocks Supabase because the image was built with another `NEXT_PUBLIC_SUPABASE_URL`;
      - the runner cannot reach Docker (group);
      - the tunnel returns 502 (the service name, or the network is not joined).
- [ ] **Step 4: Run** `pnpm vitest run tests/unit/deploy/guides.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `docs(deploy): guía autocontenida de preproducción en el homelab (Proxmox, Supabase self-hosted, tunnel, runner)`.
