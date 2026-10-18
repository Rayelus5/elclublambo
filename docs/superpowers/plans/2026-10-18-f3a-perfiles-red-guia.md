# F3a — Perfiles, red y guía — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members get editable profiles (mandatory @handle, avatar, bio, links). The SuperAdmin configures the active network, Safe and platform addresses per network, and the minimum fee. Newcomers get a `/guia` and a first-login welcome.

**Architecture:**
- **Profiles:** columns on `members`, written only through SECURITY DEFINER RPCs; direct column UPDATE is revoked. Avatars live in a public `avatars` bucket under `<member_id>/`.
- **Economy config:** per-chain addresses in a `chain_config` table, plus the active chain and minimum fee in `app_config`. Only bit 512 (SuperAdmin, F2a-R9) can change them, and every change is audited.
- **Constants in code:** chain id, USDC address and explorer.
- **Forum layout:** it redirects to `/bienvenida` until the member completes the welcome, and the welcome's first step (the handle) is mandatory.

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before touching routing/layouts), Supabase (pgTAP via `pnpm db:test`), Tailwind 4 + shadcn, Vitest + RTL, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-f3-economia-design.md` (decisions 1, 2, 6, 10, 11, 13, plus "Decisiones mías" on config).

## Global Constraints

**Handles**
- Format: `^[a-z0-9_]{3,20}$`. Input is trimmed and lowercased before validation, so "Ray_L" is stored as `ray_l`. Unicode, dots and dashes are rejected.
- Reserved handles, rejected as `handle_reserved`, are listed in the shared fixture `tests/fixtures/handles.json`, used by both SQL and TS tests: `admin`, `administrador`, `superadmin`, `elclub`, `el_club`, `sistema`, `system`, `soporte`, `support`, `moderador`, `mod`, `staff`, `everyone`, `here`, `todos`, `anonimo`, `null`, `undefined`.
- After the first set, a member may change the handle once every 30 days (`handle_cooldown`). The old handle becomes free.
- RPC error codes: `handle_invalid`, `handle_reserved`, `handle_taken`, `handle_cooldown`.

**Profile fields**
- **Bio:** plain text of at most 280 characters, trimmed. An empty bio is stored as null.
- **Links:** at most 3. Each one is `https:` only, at most 200 characters, with a parseable host. They are rendered through the existing link guardian (`classifyLink` in `src/lib/chat/links.ts`, so non-allowed domains go through `/out`).
- **Avatar:** png, jpeg or webp, at most 2 MB (2097152 bytes). Object path is `<member_id>/<uuid>.<ext>`, with no overwrite. If no avatar is set, an identicon is generated from the wallet.

**Names**
- `memberName(m)` returns the `display_name` (trimmed) if set, otherwise `@handle`, otherwise the short wallet.
- `mentionLabel(m)` returns `@handle`, falling back to `@` + `memberName`.
- Mentions and system notices always use `mentionLabel`.

**Networks**

| Name | chainId | USDC | Explorer |
|---|---|---|---|
| Linea | 59144 | `0x176211869cA2b568f2A7D4EE941E073a821EE1ff` | `https://lineascan.build` |
| Linea Sepolia | 59141 | `0xFEce4462D57bD51A6A552365A011b95f0E16d9B7` | `https://sepolia.lineascan.build` |

- The USDC addresses come from Circle's docs (developers.circle.com/stablecoins/usdc-contract-addresses, checked 2026-10-18).
- The default active chain is 59141.
- The minimum fee is an integer in basis points, 0–5000 (0%–50%; 1 bps = 0.01%). The UI accepts a percent with up to 2 decimals.
- While 59141 is active, every member sees the label **"MODO PRUEBA · Linea Sepolia"** in the top bar.

**Copy and UI**
- All UI copy is Spanish.
- Tokens only, no hex values in components.
- Touch targets ≥44px.
- Run ui-ux-pro-max `search.py` before each UI task and note it in the commit as `UX applied: …`.

**Process and safety**
- Never commit `.env.local`.
- Never use real wallets in tests.
- No PowerShell file writes.
- **Never run `pnpm test:e2e` or `pnpm db:test` without telling the controller first,** because both wipe the shared local DB the user tests on.

## Review Focus

1. **Handle look-alikes and case:** "ADMIN", "Admin " and a Cyrillic "аdmin" must never yield a second admin-looking handle. They are rejected as reserved or invalid in both SQL and TS. Pinned in Task 1 and Task 3.
2. **Deep link without a handle:** a member without a handle who opens `/c/<id>` directly lands on `/bienvenida` and returns to `/c/<id>` after finishing. Pinned in Task 7.
3. **Foreign or forged avatar path:** `set_avatar` with another member's folder, a missing object, a wrong mime or an oversized object is rejected. Pinned in Task 1.
4. **Direct RPC calls by a non-SuperAdmin:** an active non-admin calling `set_active_chain`, `set_min_fee_bps` or `set_chain_addresses` through PostgREST gets `forbidden`. Pinned in Task 2.
5. **Hostile profile links:** `javascript:alert(1)`, `http://x.com` and a homograph `https://xn--…` link are either rejected on save or shown through `/out` with the warning. Pinned in Task 1 (save) and Task 4 (render).

---

### Task 1: Profile schema and RPCs

**Files:**
- Create: `supabase/migrations/20261018500001_profiles.sql`, `supabase/tests/500_profiles.test.sql`, `tests/fixtures/handles.json`

**Interfaces:**
- Produces:
  - **Columns on `public.members`:** `handle citext unique`, `handle_changed_at timestamptz`, `bio text`, `links jsonb not null default '[]'`, `welcome_completed_at timestamptz`.
  - **Handle and welcome RPCs:**
    - `public.set_handle(p_handle text) returns text`, which returns the stored handle;
    - `public.complete_welcome() returns void`, which requires `handle is not null`, otherwise `handle_required`.
  - **Profile RPCs:**
    - `public.update_profile(p_display_name text, p_bio text, p_links jsonb) returns void`;
    - `public.set_avatar(p_path text) returns void`, where null clears the avatar.
  - **Bucket `avatars`:** `public = true`, `file_size_limit = 2097152`, `allowed_mime_types = {image/png,image/jpeg,image/webp}`.
  - **Name changes:** `search_members` returns `(id, display_name, wallet_address, handle, avatar_path)` and also matches the handle. `_push_build` and the reports-UI actor name prefer `'@' || handle`.

- [ ] **Step 1: Write the fixture `tests/fixtures/handles.json`**

The fixture has the shape `{ "reserved": [...the list from Global Constraints...], "cases": [{ "input": "Ray_L", "result": "ray_l" }, { "input": "ab", "error": "handle_invalid" }, { "input": "ADMIN", "error": "handle_reserved" }, { "input": "аdmin", "error": "handle_invalid" }, { "input": "a.b.c", "error": "handle_invalid" }, { "input": "  ok_name  ", "result": "ok_name" }, { "input": "aaaaaaaaaaaaaaaaaaaaa", "error": "handle_invalid" }] }` (the last input is 21 characters).

- [ ] **Step 2: Write the failing pgTAP `500_profiles.test.sql`**

Assertions:

*Handles*
- every fixture case through `set_handle`: the result or the error code (`throws_ok` with the SQLSTATE/message pattern the codebase uses for coded errors; see `340_tickets.test.sql`);
- `handle_taken` across two members, and also for a case variant (`Bob_1` vs `bob_1`);
- a second `set_handle` within 30 days raises `handle_cooldown`; after `handle_changed_at` is backdated 31 days it succeeds and the old handle is free.

*Profile fields*
- `update_profile` rejects a 281-character bio (`bio_too_long`);
- `update_profile` rejects links that are not a JSON array, more than 3 entries, `javascript:`, `http:`, longer than 200 characters, or without a host (`links_invalid`);
- a whitespace-only bio stores null.

*Welcome*
- `complete_welcome` without a handle raises `handle_required`; with one it sets `welcome_completed_at`.

*Privileges*
- `authenticated` has no UPDATE on `members` (`column_privs` / `table_privs`).

*Avatar*
- `set_avatar` rejects another member's folder, a path that is not `<own id>/<uuid>.(png|jpg|webp)`, a missing `storage.objects` row, and metadata mime or size out of range (fail closed on null metadata, like F2b `20261016200006`);
- `set_avatar(null)` clears it.

*Bucket policies*
- a member can insert under their own folder only;
- no UPDATE policy exists;
- a member can delete their own objects.

*Search*
- `search_members('ray')` finds a member by handle prefix.

- [ ] **Step 3: Run it and confirm it fails.** Tell the controller first, because `db:test` resets the local DB. Run `pnpm db:test`. Expected: failures in 500_profiles.

- [ ] **Step 4: Write `20261018500001_profiles.sql`**

*Security baseline*
- All RPCs are SECURITY DEFINER with `set search_path = ''`, resolve the caller with `public.current_member_id()`, and require `public.is_active_member()`.

*Validation*
- The handle check constraint mirrors the regex.
- Reserved handles live in a SQL array constant inside `set_handle`, identical to the fixture.
- Bio length is counted in characters.

*Changed functions*
- `revoke update on public.members from authenticated`.
- `search_members` needs `drop function` + create, because the return type changes. Keep the F2d escaping and the active-only filter.
- Redefine `_push_build` and the reports-UI actor expression to use `coalesce('@' || handle, display_name, short wallet)`, sanitised as before.

- [ ] **Step 5: Run `pnpm db:test`.** Expected: all files pass.

- [ ] **Step 6: Commit** `feat(profiles): handle, bio, links, avatar schema and RPCs`.

### Task 2: Economy and network config schema

**Files:**
- Create: `supabase/migrations/20261018500002_economy_config.sql`, `supabase/tests/510_economy_config.test.sql`

**Interfaces:**
- Produces:
  - **Table `public.chain_config`:**
    - columns: `chain_id int primary key check (chain_id in (59144, 59141))`, `safe_address text`, `platform_wallet text` (both null or `^0x[0-9a-f]{40}$` lowercase), `updated_at`, `updated_by → members`;
    - seeded with both chains, both addresses null;
    - RLS: SELECT for active members; no client writes.
  - **`app_config` keys:** `active_chain_id` = `59141`, `min_fee_bps` = `0` (jsonb numbers).
  - **Read RPC:** `public.economy_config() returns jsonb`, invoker, active members only. Shape: `{ "activeChainId": 59141, "minFeeBps": 0, "chains": { "59144": { "safe": null, "platform": null }, "59141": { … } } }`.
  - **Admin RPCs**, each requiring `public.has_global_perm(512)` (otherwise `forbidden`) and writing `audit_log`:

    | RPC | Rule | Error | Audit action |
    |---|---|---|---|
    | `set_active_chain(p_chain int)` | — | — | `economy.active_chain` |
    | `set_min_fee_bps(p_bps int)` | 0..5000 | `fee_out_of_range` | `economy.min_fee` |
    | `set_chain_addresses(p_chain int, p_safe text, p_platform text)` | lowercases; rejects malformed and the zero address | `address_invalid` | `economy.addresses` |

- [ ] **Step 1: Write the failing pgTAP `510_economy_config.test.sql`**

Assertions:
- the defaults read through `economy_config()`;
- an active non-admin gets `forbidden` on all three setters (Review Focus 4);
- an admin sets 59144 / 260 bps / addresses, which are read back lowercased, and the audit rows exist with the old and new values;
- 5001 raises `fee_out_of_range`;
- chain 1 is rejected;
- the zero address raises `address_invalid`;
- an anon or non-member cannot select `chain_config` or call `economy_config()`.

- [ ] **Step 2: Run it and confirm it fails** (warn the controller; `pnpm db:test`).
- [ ] **Step 3: Write the migration** following the F1 audit pattern (`audit_log` insert with `actor_id`, `action`, `payload`).
- [ ] **Step 4: Run `pnpm db:test`.** Expected: pass.
- [ ] **Step 5: Commit** `feat(economy): network and fee config with superadmin RPCs`.

### Task 3: Member identity in TypeScript and names everywhere

**Files:**
- Create:
  - `src/lib/members/handle.ts`, `src/lib/members/name.ts`, `src/lib/members/identicon.ts`, `src/components/members/member-avatar.tsx`
  - `tests/unit/members/handle.test.ts`, `tests/unit/members/name.test.ts`, `tests/unit/members/identicon.test.ts`, `tests/unit/members/member-avatar.test.tsx`
- Modify, every consumer of `display_name` listed by `grep -rln "display_name\|displayName" src`:
  - `src/lib/chat/queries.ts` (directory), `src/lib/chat/actions.ts` (mention suggestions also match `handle`), `src/lib/chat/model.ts` (`DirectoryMember`);
  - `src/components/chat/message-item.tsx` (author line + `Avatar` → `MemberAvatar`), the mention chip renderer;
  - `src/lib/search/queries.ts`, `src/components/search/command-palette.tsx`;
  - `src/lib/notifications/queries.ts`, `src/lib/reports/queries.ts`, `src/lib/tickets/queries.ts`;
  - `src/components/members/*`, `src/app/(forum)/admin/members/page.tsx`, `src/components/settings/permission-matrix.tsx`, `src/app/(forum)/settings/channels/page.tsx`, `src/lib/channels/actions.ts`.

**Interfaces:**
- Consumes: Task 1 columns and `search_members` shape.
- Produces:
  - **Handle helpers:**
    - `HANDLE_RE: RegExp`;
    - `RESERVED_HANDLES: readonly string[]`, imported from the fixture JSON;
    - `normalizeHandle(input: string): { ok: true; handle: string } | { ok: false; error: "handle_invalid" | "handle_reserved" }`.
  - **Name helpers:**
    - `type MemberIdentity = { handle: string | null; displayName: string | null; walletAddress: string; avatarPath: string | null }`;
    - `memberName(m: MemberIdentity): string`;
    - `mentionLabel(m: MemberIdentity): string`;
    - `avatarUrl(path: string | null): string | null`, the public URL from `NEXT_PUBLIC_SUPABASE_URL` + `/storage/v1/object/public/avatars/` + path.
  - **Identicon:** `identicon(wallet: string): { cells: boolean[]; hue: number }`, a 5×5 grid that mirrors the left 3 columns, derived deterministically from the lowercase wallet hex.
  - **Avatar component:** `<MemberAvatar member={MemberIdentity} size={24 | 32 | 64 | 96} />`. It renders the image when a path is set, otherwise an inline SVG identicon whose colour uses `hsl(hue …)` via a CSS variable (the only computed colour allowed). `alt=""` is always set, because the name is next to it.
  - **Directory:** `DirectoryMember` becomes `MemberIdentity & { name: string }`.

- [ ] **Step 1: Write the failing unit tests**
  - `handle.test.ts` runs every fixture case through `normalizeHandle` (parity with Task 1).
  - `name.test.ts` covers the three fallbacks of `memberName`, `mentionLabel` with and without a handle, and `avatarUrl(null) === null`.
  - `identicon.test.ts`:
    - the same wallet always gives an equal result;
    - two wallets give different results;
    - the grid is mirrored, `cells[r*5+c] === cells[r*5+4-c]`.
  - `member-avatar.test.tsx`:
    - with a path, the `img` src ends with the path;
    - without one, an `svg` with `aria-hidden`.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/members`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement the four modules.**
- [ ] **Step 4: Switch every consumer** to `MemberIdentity` + `memberName`, or `mentionLabel` for mention chips and notices. Selects add `handle, avatar_path`. The chat author line shows `memberName` in bold followed by a muted `@handle` when both a display name and a handle exist. Update the existing unit tests whose expected names change. Keep every other behaviour.
- [ ] **Step 5: Run** `pnpm lint && pnpm typecheck && pnpm test`. Expected: all green.
- [ ] **Step 6: Commit** `feat(members): handle-aware names and avatars across the app`.

### Task 4: Profile page and editor

**Files:**
- Modify: `src/app/(forum)/u/[address]/page.tsx`. The param accepts a wallet or a handle: a `0x…40` param is looked up by wallet, anything else by lowercase handle, and an unknown value gives `notFound()`.
- Create:
  - `src/app/(forum)/perfil/page.tsx` (own profile editor);
  - `src/components/profile/profile-form.tsx`, `src/components/profile/avatar-upload.tsx`, `src/components/profile/profile-links.tsx`;
  - `src/lib/profile/actions.ts`, `src/lib/profile/upload.ts`;
  - `tests/unit/profile/profile-form.test.tsx`, `tests/unit/profile/profile-links.test.tsx`, `tests/unit/profile/actions.test.ts`.

**Interfaces:**
- Consumes:
  - Task 1 RPCs;
  - Task 3 `MemberAvatar`, `normalizeHandle`, `memberName`;
  - `classifyLink`, and `allowed_domains` loaded the way `/c/[channelId]` does.
- Produces:
  - **Server actions:**
    - `saveProfileAction(input: { displayName: string; bio: string; links: string[] }): Promise<{ ok: true } | { ok: false; error: string }>`;
    - `setHandleAction(handle: string): Promise<{ ok: true; handle: string } | { ok: false; error: string }>`;
    - `setAvatarAction(path: string | null)`.
  - **Upload:** `uploadAvatar(file: File): Promise<string>` returns the path and checks mime and size client-side before uploading.
  - Spanish error copy for each RPC code goes in `src/lib/errors.ts`.

- [ ] **Step 1: Write the failing tests**
  - `profile-form.test.tsx`:
    - the handle field shows "Podrás cambiarlo de nuevo el {fecha}" when it is within the cooldown;
    - the bio counter shows `280` remaining and blocks at 281;
    - the "Añadir enlace" button disappears at 3 links;
    - submitting calls `saveProfileAction` with trimmed values.
  - `profile-links.test.tsx` (Review Focus 5):
    - an allowed-domain link renders directly with `rel="noopener noreferrer nofollow ugc"`;
    - another domain renders as an `/out?u=` link;
    - an `xn--` host shows the punycode warning.
  - `actions.test.ts` maps each RPC error code to its Spanish message; for example `handle_taken` gives "Ese nombre ya está en uso".
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/profile`. Expected: FAIL.
- [ ] **Step 3: Implement the page, form, upload and actions.**
  - The profile page shows the avatar (96), `memberName`, `@handle`, the bio, links and the existing sponsor tree.
  - An "Editar perfil" link to `/perfil` appears only on one's own profile.
  - `/perfil` revalidates `/u/...` after a save.
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test`. Expected: green.
- [ ] **Step 5: Commit** `feat(profiles): profile page by handle and profile editor`.

### Task 5: Economy settings page and network badge

**Files:**
- Create:
  - `src/lib/economy/networks.ts`, `src/lib/economy/config.ts`;
  - `src/app/(forum)/settings/economia/page.tsx`, `src/components/economy/economy-form.tsx`, `src/components/economy/network-badge.tsx`;
  - `tests/unit/economy/networks.test.ts`, `tests/unit/economy/economy-form.test.tsx`, `tests/unit/economy/network-badge.test.tsx`.
- Modify:
  - `src/lib/permissions/settings.ts`: an "Economía" section, only when perms has bit 512 (not via `hasPerm`'s admin shortcut alone: check `(perms & 512n) !== 0n`);
  - `src/components/shell/sidebar.tsx` (`DesktopBar` + `DrawerBody`): show `<NetworkBadge>`;
  - `src/app/(forum)/layout.tsx`: load `economy_config()` in the existing `Promise.all`.

**Interfaces:**
- Consumes: Task 2 RPCs.
- Produces:
  - **Network constants:**
    - `NETWORKS: Record<59144 | 59141, { id; name: string; usdc: \`0x${string}\`; explorer: string; testnet: boolean }>`, with the values from Global Constraints;
    - `type ChainId = 59144 | 59141`;
    - `explorerTx(chain: ChainId, hash: string): string`;
    - `explorerAddress(chain: ChainId, addr: string): string`.
  - **Config:**
    - `type EconomyConfig = { activeChainId: ChainId; minFeeBps: number; chains: Record<ChainId, { safe: string | null; platform: string | null }> }`;
    - `getEconomyConfig(): Promise<EconomyConfig>`, server-only and wrapped in React `cache()`.
  - **Formatting:**
    - `bpsToPercentText(bps: number): string`, so 260 gives "2,6 %";
    - `percentTextToBps(text: string): number | null`, which accepts "2,6", "2.6" and "0,05", and rejects anything over 50 or with more than 2 decimals.
  - **Badge:** `<NetworkBadge chainId={ChainId} />`. For 59141 it shows "MODO PRUEBA · Linea Sepolia" in the warning token; for 59144 it shows "Linea" in a muted style. It is also used by F3b/F3d money dialogs.

- [ ] **Step 1: Write the failing tests**
  - `networks.test.ts`:
    - the exact USDC addresses and explorers;
    - `explorerTx(59141, "0xab")` gives `https://sepolia.lineascan.build/tx/0xab`;
    - the `percentTextToBps` cases ("2,6" → 260, "0,05" → 5, "50" → 5000, "50,01" → null, "1,234" → null, "-1" → null).
  - `network-badge.test.tsx` covers both texts.
  - `economy-form.test.tsx`:
    - switching the network asks for confirmation with the copy "Los envíos de dinero pasarán a Linea. ¿Continuar?";
    - an invalid address shows an inline error;
    - the fee field shows the preview "Sobre 10 USDC: 0,26 USDC".
- [ ] **Step 2: Run them and confirm they FAIL.**
- [ ] **Step 3: Implement.**
  - The settings page returns 404 for non-512 members, matching the layout's sections.
  - The form calls server actions in `src/lib/economy/actions.ts`, which wrap the three RPCs and `revalidatePath("/", "layout")`.
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test`. Expected: green.
- [ ] **Step 5: Commit** `feat(economy): superadmin economy settings and network badge`.

### Task 6: Guide pages

**Files:**
- Create:
  - `src/app/(forum)/guia/page.tsx` and `src/app/(forum)/guia/[section]/page.tsx`, where `section` is one of `propinas | bounties | dao | candados | redes`, with `generateStaticParams` and `notFound()` for others;
  - `src/lib/guide/sections.ts`, `src/components/guide/how-it-works-link.tsx`;
  - `tests/unit/guide/sections.test.ts`, `tests/unit/guide/how-it-works-link.test.tsx`.
- Modify:
  - `src/components/shell/sidebar.tsx`: a "Guía" section (icon `BookOpen`) after Tickets;
  - `src/lib/search/actions-list.ts`: a "Guía" action plus one action per section, with keywords such as "propinas donar", "bounty recompensa", "dao tesorería shares", "candado gating acceso", "red testnet mainnet".

**Interfaces:**
- Produces:
  - `GUIDE_SECTIONS: readonly { slug: GuideSlug; title: string; summary: string }[]`;
  - `type GuideSlug`;
  - `<HowItWorksLink section={GuideSlug} />`, which renders "¿Cómo funciona?" linking to `/guia/<slug>` and opening in the same tab (for F3b–F3d dialogs).

**Content:** Spanish, plain and concrete, with no hype. Each section has 3–6 short subsections covering what it is, how to do it step by step, what it costs (the minimum fee, shown live from `getEconomyConfig()`), and the risks.
- **Propinas:** P2P, non-custodial; the fee is added on top; anonymity is only in the forum, because on-chain is public; two signatures when there is a fee.
- **Bounties:** the `/bounty` command; marking a solution; the 7-day unpaid mark; expiry at 30 days; "pagado tarde".
- **DAO y shares:** USDC only; the Safe; shares and %; pending until finalized (can take hours); a direct transfer to the Safe does not count; withdrawals come later.
- **Canales con candado:** the two rules joined with "o", and where to see your situation.
- **Redes y seguridad:**
  - MODO PRUEBA vs mainnet;
  - always check the network label;
  - the forum never asks for a seed phrase or for signing anything other than a normal transfer to a shown address;
  - how to spot phishing (`/out` warnings).

The guide pages state what will exist. Sections for features not yet shipped carry the note "Disponible próximamente" until F3b–F3d remove it.

- [ ] **Step 1: Write the failing tests**
  - `sections.test.ts`: there are 5 slugs in this order, and each has a title and summary.
  - `how-it-works-link.test.tsx`: the href is `/guia/dao` and the accessible name is "¿Cómo funciona? Guía: DAO y shares".
  - Add to `tests/unit/search/actions-list.test.ts`: the "Guía" actions are always present.
- [ ] **Step 2: Run them and confirm they FAIL.**
- [ ] **Step 3: Implement** the pages (68ch reading column, `text-h1`/`text-h2` tokens), the link component and the nav and palette entries.
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test`. Expected: green, including the updated shell tests that count the nav links.
- [ ] **Step 5: Commit** `feat(guide): /guia sections, how-it-works links, nav and palette entries`.

### Task 7: Welcome flow and onboarding gate

**Files:**
- Create:
  - `src/app/(onboarding)/layout.tsx` and `src/app/(onboarding)/bienvenida/page.tsx`. This is a new route group with the same session, membership and ban checks as `ForumShell`, but without the shell;
  - `src/components/onboarding/welcome-steps.tsx`, `src/lib/onboarding/next-path.ts`;
  - `tests/unit/onboarding/welcome-steps.test.tsx`, `tests/unit/onboarding/next-path.test.ts`.
- Modify:
  - `src/app/(forum)/layout.tsx`: select `handle, welcome_completed_at` for the current member, and `redirect("/bienvenida?next=" + encodeURIComponent(path))` when `welcome_completed_at` is null. The current path comes from a header set in `src/proxy.ts`, `x-pathname`, because a layout does not receive the pathname.
  - `src/proxy.ts`: set the `x-pathname` request header.
  - `src/app/(forum)/guia/page.tsx`: a "Ver la bienvenida de nuevo" link to `/bienvenida?repetir=1`.
  - `e2e/helpers/auth.ts`: `loginAs` gains `opts.onboard` (default `true`). After `/login/complete`, if the member is active and has no handle, it sets `handle = 'u_' + wallet.slice(2, 12)` and `welcome_completed_at = now()` with the service role, so existing specs keep landing in the forum.

**Interfaces:**
- Consumes:
  - Task 1 `set_handle`, `complete_welcome`;
  - Task 4 `setHandleAction`;
  - Task 6 `GUIDE_SECTIONS`.
- Produces:
  - `safeNextPath(raw: string | null): string`. It returns `raw` only when it is a same-origin path starting with a single `/`, not `//` or `/\`, and not `/bienvenida`; otherwise `/`.
  - `completeWelcomeAction(): Promise<{ ok: true } | { ok: false; error: string }>`.

**Steps of the welcome:**
1. "Elige tu @handle" is mandatory, with live validation via `normalizeHandle` and the server error. If the member already has a handle, as in a replay, it shows as done.
2. "Propinas y bounties".
3. "La DAO y los canales con candado".
4. "Redes y seguridad", which shows the current `NetworkBadge`.

"Saltar" appears from step 2 on and completes the welcome. "Empezar" on step 4 completes it too. Both go to `safeNextPath(next)`. Each step links to its guide section.

- [ ] **Step 1: Write the failing tests**
  - `next-path.test.ts`: `/c/abc` → `/c/abc`; `//evil.com`, `/\evil`, `https://evil.com`, `/bienvenida` and null → `/`.
  - `welcome-steps.test.tsx`:
    - step 1 has no "Saltar";
    - "Siguiente" is disabled until the handle is valid;
    - a server `handle_taken` shows "Ese nombre ya está en uso";
    - with an existing handle, step 1 is marked done;
    - "Saltar" on step 2 calls `completeWelcomeAction` and navigates to `next`.
- [ ] **Step 2: Run them and confirm they FAIL.**
- [ ] **Step 3: Implement** the route group, the steps, the forum-layout redirect, the proxy header and the e2e helper change.
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Expected: green.
- [ ] **Step 5: Commit** `feat(onboarding): mandatory-handle welcome and onboarding gate`.

### Task 8: F3a acceptance E2E

**Files:**
- Create: `e2e/f3a-profiles.spec.ts`
- Modify: `e2e/screens.spec.ts`, adding `/bienvenida`, `/perfil`, `/u/<handle>`, `/guia/dao` and `/settings/economia` to the captures.

**Interfaces:** consumes everything above.

- [ ] **Step 1: Write the spec.** Use generated keys only. Every test also asserts no browser console errors, using the WalletConnect-pulse exclusion pattern from the existing specs.
  1. **New member with `onboard:false`:**
     - opens `/c/<General>` and lands on `/bienvenida?next=…`;
     - "Saltar" is absent on step 1;
     - tries `ADMIN` and sees the reserved error;
     - sets `ray_test1` and skips;
     - lands on `/c/<General>` (Review Focus 2).
  2. **Profile:**
     - edits the bio and links (`https://github.com/x`, `https://evil.example`), uploads `e2e/fixtures/avatar.png` (a small generated PNG committed with the spec) and saves;
     - `/u/ray_test1` shows the avatar `img`, the bio, a direct GitHub link and an `/out?u=` link for evil.example.
  3. **Mentions:** a mention of that member in General renders `@ray_test1`.
  4. **SuperAdmin:**
     - opens `/settings/economia`;
     - sets the minimum fee "2,6" and the Sepolia Safe and platform addresses (generated);
     - switches to Linea after confirming;
     - a member's top bar no longer shows "MODO PRUEBA";
     - switching back shows it again.
  5. **Non-admin:**
     - `/settings/economia` returns HTTP 404;
     - `rpcAs(context, "set_min_fee_bps", { p_bps: 0 })` returns `forbidden` (Review Focus 4).
  6. **Guide:** `/guia` lists 5 sections; Cmd+K "dao" offers "Guía: DAO y shares".
- [ ] **Step 2: Run the full suite.**
  - Tell the controller first, because it wipes the local DB.
  - Put System32 on PATH in the shell (`/c/Windows/System32`).
  - Run `pnpm test:e2e` (and once with `E2E_PROD=1`).
  - Expected: all pass (gated tests skipped).
- [ ] **Step 3: Commit** `test(e2e): f3a profiles, onboarding, economy settings and guide`.
