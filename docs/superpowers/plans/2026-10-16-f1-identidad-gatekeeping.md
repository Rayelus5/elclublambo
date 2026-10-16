# F1 — Identidad, invitaciones y gatekeeping · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una wallet solo entra al foro siendo SuperAdmin (bootstrap) o canjeando una invitación válida. Cada miembro queda enlazado a su padrino, y un admin puede banear con penalización en cascada al padrino.

**Architecture:**
- Next.js 16 (App Router) + Supabase local. El login usa Supabase Web3 Auth nativo (`signInWithWeb3` con mensaje + firma EIP-4361 construidos con viem). La conexión de wallet va con Reown AppKit + wagmi 3, limitada a `linea` y `lineaSepolia`.
- **La puerta de acceso es la tabla `members` + RLS, no el registro.** Las escrituras sensibles solo ocurren por RPC `SECURITY DEFINER`.
- Permisos como bitfield `bigint`, con valores idénticos en SQL y en TS.

**Tech Stack:** next 16.4 · react 19.3 · typescript strict · tailwindcss 4.3 · shadcn/ui · @supabase/supabase-js 2.118 + @supabase/ssr 0.12 · supabase CLI 2.121 (devDep) · wagmi 3.7 + viem 2.57 + @reown/appkit 1.8 + @reown/appkit-adapter-wagmi · @tanstack/react-query 5 · motion · lucide-react · vitest 5 + @testing-library/react · @playwright/test 1.64 · pgTAP (`supabase test db`) · pnpm vía corepack.

**Spec:** `docs/superpowers/specs/2026-10-16-plan-maestro.md` (§1 diseño, §2 auth/RBAC, §3 tablas de identidad, §4 F1).

## Global Constraints

- **Cadenas permitidas en la app:** `linea` (59144) y `lineaSepolia` (59141). En desarrollo, `NEXT_PUBLIC_CHAIN=lineaSepolia`.
- **Wallets mostradas en AppKit:** solo MetaMask y OKX (`featuredWalletIds`/`includeWalletIds`), con `features: { email: false, socials: false, swaps: false, onramp: false }`.
- **Direcciones:**
  - En BD siempre en minúsculas, con `CHECK (wallet_address ~ '^0x[0-9a-f]{40}$')` y UNIQUE.
  - La dirección del miembro sale **solo** de `auth.identities.identity_data->>'address'` (provider `web3`), nunca de un parámetro del cliente.
- **Variables de entorno (`.env.example`):**
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPER_ADMIN_WALLET`, `NEXT_PUBLIC_REOWN_PROJECT_ID`, `NEXT_PUBLIC_CHAIN`
- **Valores para `.env.local` (no se commitea):**
  - `SUPER_ADMIN_WALLET=0x9F202eb556F95308de0268f60b5757d83744De02`
  - `NEXT_PUBLIC_REOWN_PROJECT_ID=9483db619656952694efb7e5c936cce8`
  - Wallet de pruebas manuales del usuario: `0xD590d5D858d5B61C357e7a40Ee6b6a72D938b82d`
- **Permisos (bigint):**
  - `VIEW_CHANNEL=1`, `CREATE_THREADS=2`, `SEND_REPLIES=4`, `MANAGE_MESSAGES=8`
  - `CREATE_INVITES=16`, `BAN_MEMBERS=32`, `MANAGE_ROLES=64`, `MANAGE_CHANNELS=128`
  - `MANAGE_TREASURY=256`, `ADMINISTRATOR=512`
- **Roles semilla:**

  | Rol | position | Permisos | Flags |
  |---|---|---|---|
  | `@everyone` | 0 | 7 (VIEW+CREATE_THREADS+SEND_REPLIES) | `is_everyone` |
  | `Padrino` | 10 | 16 | — |
  | `SuperAdmin` | 1000 | 512 | `is_system` |

- **Permisos efectivos globales:**
  - `p = OR(permisos de @everyone y de los roles del miembro)`.
  - Si `p & 512` → todos los bits (1023), y los overrides **no** aplican a admins.
  - Si no, `(p & ~deny) | allow`.
- **Invitaciones:**
  - `max_uses` entre 1 y 100.
  - `expires_at` entre `now()+1h` y `now()+30d`.
  - Código de 128 bits en base64url (22 caracteres).
  - Válida solo si `revoked_at IS NULL AND expires_at > now() AND uses < max_uses` y el creador está `active`.
- **Errores de RPC** (`raise exception '<code>'`, el TS los mapea a copy en español): `not_authenticated`, `not_member`, `already_member`, `forbidden`, `bootstrap_closed`, `wallet_mismatch`, `invite_not_found`, `invite_expired`, `invite_exhausted`, `invite_revoked`, `invalid_input`, `hierarchy`.
- **Todas las funciones SQL:**
  - `SECURITY DEFINER` + `SET search_path = ''` y nombres totalmente cualificados.
  - `revoke execute ... from public, anon`, y `grant` explícito a `authenticated` o `service_role`.
- **Tablas:** RLS activa en todas, y `revoke all ... from anon` en todas las tablas `public`.
- **UI:**
  - Tokens de la spec §1, sin hex sueltos en componentes.
  - Lucide SVG, objetivos ≥44px, foco de 2px `--accent` con offset de 2px.
  - Motion de 150–250ms ease-out y `prefers-reduced-motion`.
  - Antes de cada tarea de UI: `python <skill>/scripts/search.py "<query>" --domain ux|style --stack nextjs`, dejando el resumen en el mensaje del commit.
- **Copy:** en español de tú.

## Review Focus

1. **Misma wallet con distinto casing** (checksum vs minúsculas) → un solo miembro. Un segundo `auth.users` para la misma dirección recibe `already_member`, no un miembro duplicado. *(Task 6, test `redeem_rejects_same_wallet_other_auth_user`)*
2. **Último uso de una invitación canjeado dos veces** → el segundo canje falla con `invite_exhausted`. *(Task 6, `redeem_exhausts_at_max_uses`)*
3. **Miembro baneado con JWT aún válido** → no lee nada: `select` de `members` devuelve 0 filas con sus mismos claims. *(Task 7, `banned_member_reads_nothing`)*
4. **`SUPER_ADMIN_WALLET` con espacios o en checksum** → coincide igualmente. Si la variable está vacía → nadie es admin. *(Task 4, tests de `isSuperAdminWallet`)*
5. **Invitación cuyo creador fue baneado** → `invite_revoked`, aunque no hubiera penalización al padrino. *(Task 7, `ban_revokes_target_invites`)*

---

## Estructura de archivos

```
.env.example · .gitignore · package.json · tsconfig.json · next.config.ts · eslint.config.mjs
vitest.config.ts · playwright.config.ts · components.json
supabase/config.toml
supabase/migrations/20261016000001_identity.sql        # tablas, RLS, roles semilla
supabase/migrations/20261016000002_permissions.sql     # helpers de permisos y membresía
supabase/migrations/20261016000003_bootstrap.sql
supabase/migrations/20261016000004_invites.sql
supabase/migrations/20261016000005_moderation.sql      # ban_member, set_member_role
supabase/tests/000_helpers.test.sql                    # schema tests.* (persistente, sin rollback)
supabase/tests/0NN_<area>.test.sql
src/styles/tokens.ts            # fuente de verdad de colores (la usan los tests de contraste)
src/app/globals.css             # tokens CSS + @theme de Tailwind
src/app/layout.tsx              # fuentes next/font + Providers
src/app/(gate)/login/page.tsx · src/app/(gate)/invite/[code]/page.tsx
src/app/(gate)/no-access/page.tsx · src/app/(gate)/banned/page.tsx
src/app/(forum)/layout.tsx · src/app/(forum)/page.tsx
src/app/(forum)/invites/page.tsx · src/app/(forum)/u/[address]/page.tsx
src/app/(forum)/admin/members/page.tsx
src/proxy.ts
src/lib/supabase/{browser,server,admin}.ts
src/lib/web3/{chains,appkit,siwe}.ts
src/lib/auth/{wallet,post-login,actions}.ts
src/lib/permissions/bits.ts
src/lib/errors.ts               # código RPC → copy
src/lib/invites/actions.ts · src/lib/moderation/actions.ts
src/components/providers.tsx · src/components/ui/*  (shadcn)
src/components/auth/login-panel.tsx · src/components/shell/*
src/components/invites/* · src/components/members/*
tests/unit/** · tests/integration/** · e2e/** · e2e/helpers/auth.ts
```

---

### Task 1: Scaffold y toolchain

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`
- Create: `.gitignore`, `.env.example`, `supabase/config.toml`, `supabase/tests/000_helpers.test.sql`
- Create: `tests/unit/smoke.test.ts`, `supabase/tests/001_smoke.test.sql`

**Interfaces:**
- **Produces:**
  - Scripts: `pnpm dev | build | lint | typecheck | test | test:e2e | db:start | db:reset | db:test`
  - Helpers SQL del schema `tests`:
    - `tests.create_wallet_user(p_address text) returns uuid`: inserta en `auth.users` + `auth.identities` con provider `'web3'`, `provider_id 'web3:ethereum:'||p_address` y `identity_data {address, chain:'ethereum', network:59141}`.
    - `tests.authenticate_as(p_user uuid)`: `set local role authenticated` + `request.jwt.claims`.
    - `tests.clear_authentication()`.
  - `tests.create_member(p_address text, p_invited_by uuid default null, p_bootstrap boolean default false) returns uuid`. **Se añade en la Task 3**, cuando existe `members`.

- [ ] **Step 1:** `corepack enable pnpm`. Luego `pnpm create next-app@16.4 . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm` en un directorio temporal, y luego mover los archivos generados a la raíz conservando `README.md` e `INSTRUCCIONES_PROYECTO.md` (create-next-app se niega a ejecutarse en un directorio con archivos que choquen).
- [ ] **Step 2:** Configuración base:
  - En `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`.
  - Añadir devDeps: `supabase vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @playwright/test`.
  - En `.gitignore`: `.env*.local`, `supabase/.temp`, `.claude/skills/superpowers/` y `.claude/skills/ui-ux-pro-max/` (repos clonados con su propio `.git`).
- [ ] **Step 3:** `pnpm supabase init`. En `config.toml`:
  - `[auth.web3.ethereum] enabled = true`
  - `site_url = "http://localhost:3000"`
  - `additional_redirect_urls = ["http://localhost:3000/**"]`
  - `[auth.rate_limit] web3 = 30`
- [ ] **Step 4:** Tests de humo:
  - `tests/unit/smoke.test.ts` → `expect(1+1).toBe(2)`.
  - `supabase/tests/001_smoke.test.sql` → `select plan(1); select has_extension('pgtap'); select * from finish();`.
  - Escribir `000_helpers.test.sql` **sin** `begin/rollback`, terminando con `select plan(1); select ok(true); select * from finish();`.
- [ ] **Step 5:** `pnpm db:start && pnpm db:test && pnpm test && pnpm typecheck && pnpm lint`. Esperado: todo PASS.
- [ ] **Step 6:** Commit `chore: scaffold next16 + supabase local + test toolchain`.

### Task 2: Spike de Web3 Auth nativo (gate de decisión)

**Files:**
- Create: `src/lib/web3/chains.ts`, `src/lib/web3/siwe.ts`
- Create: `tests/unit/siwe.test.ts`, `tests/integration/web3-auth.test.ts`
- Create: `docs/superpowers/notes/2026-10-16-web3-auth-spike.md`

**Interfaces:**
- **Produces:**
  - `APP_CHAINS` (`[lineaSepolia, linea]` de `viem/chains`) y `getAppChain(): Chain`, según `NEXT_PUBLIC_CHAIN` (default `lineaSepolia`).
  - `buildLoginMessage(p: { address: Address; chainId: number; nonce: string; domain: string; uri: string; now?: Date }): string`, sobre `createSiweMessage` de `viem/siwe`, con:
    - `statement` = "Entra en El Club Lambo. Esta firma no cuesta gas ni mueve fondos."
    - `version '1'`, `issuedAt = notBefore = now` y `expirationTime = now + 5 min`.
    - Lanza `invalid_input` si el chainId no es 59144/59141.
  - `generateNonce(): string` (viem `generateSiweNonce`).

- [ ] **Step 1:** Tests unitarios en `tests/unit/siwe.test.ts`:
  - `rejects_foreign_chain`: chainId 1 lanza error.
  - `message_contains_statement_and_bounds`: `parseSiweMessage(msg)` tiene `chainId 59141`, `notBefore` y `expirationTime - issuedAt == 300000ms`.
  - `address_is_checksummed`: una dirección en minúsculas sale en EIP-55.
- [ ] **Step 2:** `pnpm test tests/unit/siwe.test.ts` → FAIL. Implementar. → PASS.
- [ ] **Step 3:** Test de integración `web3-auth.test.ts` contra Supabase local (se salta si `SUPABASE_URL` no responde):
  - `privateKeyToAccount(generatePrivateKey())` firma `buildLoginMessage({... domain:'localhost:3000', uri:'http://localhost:3000/login'})`.
  - `supabase.auth.signInWithWeb3({ chain:'ethereum', message, signature })` devuelve una sesión.
  - `user.identities[0].provider === 'web3'` y `identity_data.address` es igual a la dirección checksum.
  - Repetir el login con la misma cuenta devuelve el mismo `user.id`.
- [ ] **Step 4:** Ejecutar. **Gate:**
  - Si PASS → anotar en la nota del spike el provider, el formato de `identity_data` y el casing observado, y seguir.
  - Si FAIL por limitación de Supabase (no por bug propio) → **parar** y reescribir las Tasks 3–4 para el plan B (ruta `/api/auth/siwe` + `verifySiweMessage` + JWT firmado), consultando al usuario.
- [ ] **Step 5:** Commit `feat(auth): siwe message builder + native supabase web3 spike`.

### Task 3: Migración de identidad (tablas, RLS por defecto, roles semilla)

**Files:**
- Create: `supabase/migrations/20261016000001_identity.sql`, `supabase/tests/010_identity_schema.test.sql`
- Modify: `supabase/tests/000_helpers.test.sql` (añadir `tests.create_member`)

**Interfaces:**
- **Produces:** las siguientes tablas. Todas llevan `created_at timestamptz default now()`, y los ids son `uuid default gen_random_uuid()`.
  - `members`:
    - `id`, `auth_user_id uuid unique not null references auth.users on delete restrict`, `wallet_address text unique not null` (check en minúsculas)
    - `display_name text check (char_length between 2 and 32)`, `avatar_path text`
    - `status text not null default 'active' check in ('active','banned','left')`
    - `invited_by_member_id uuid references members`, `invite_id uuid`, `is_bootstrap boolean not null default false`, `needs_review_since timestamptz`
    - `check (invited_by_member_id is not null or is_bootstrap)`
    - índice sobre `invited_by_member_id`
  - `invites`:
    - `id`, `code text unique not null`, `created_by uuid not null references members`
    - `max_uses int check 1..100`, `uses int default 0 check (uses <= max_uses)`
    - `expires_at timestamptz not null`, `revoked_at timestamptz`, `revoked_reason text`
  - FK `members.invite_id → invites`, deferrable.
  - `invite_redemptions`: `invite_id`, `member_id unique`, `redeemed_at`.
  - `roles`:
    - `id`, `name unique`, `color text check ~ '^#[0-9A-F]{6}$'`, `position int`, `permissions bigint not null default 0`
    - `is_everyone bool`, `is_system bool`
    - índice único parcial: un solo `is_everyone`.
  - `member_roles`: `(member_id, role_id)` PK.
  - `member_permission_overrides`: `member_id` PK, `allow bigint default 0`, `deny bigint default 0`, `reason text`, `set_by uuid`.
  - `bans`: `id`, `member_id`, `banned_by`, `reason text not null`, `sponsor_member_id uuid`, `sponsor_penalized bool`, `lifted_at`.
  - `audit_log`: `id bigint identity`, `actor_member_id`, `action text`, `target_type text`, `target_id uuid`, `payload jsonb`.
  - `app_config`: `key text` PK, `value jsonb`. Semilla: `withdrawals_enabled=false`, `weighted_raffles_enabled=false`.
  - Roles semilla: los de Global Constraints.

- [ ] **Step 1:** Tests en `010_identity_schema.test.sql`:
  - `has_table` para cada tabla y `col_is_unique('members','wallet_address')`.
  - `throws_ok` al insertar una wallet en mayúsculas (`23514`).
  - `throws_ok` al insertar un miembro sin padrino ni `is_bootstrap`.
  - Que `pg_class.relrowsecurity` sea true para todas las tablas de `public`.
  - Como `anon`: `throws_ok('select * from public.members', '42501')`.
  - Que existan los 3 roles semilla con sus permisos exactos.
- [ ] **Step 2:** `pnpm db:test` → FAIL.
- [ ] **Step 3:** Escribir la migración:
  - RLS activa en todo, sin políticas todavía; las políticas de lectura llegan en la Task 4.
  - `revoke all on all tables in schema public from anon`.
  - `audit_log` sin grants de escritura a `authenticated`.
  - Añadir `tests.create_member` al helper.
- [ ] **Step 4:** `pnpm db:reset && pnpm db:test` → PASS.
- [ ] **Step 5:** Commit `feat(db): identity schema with deny-by-default RLS and seed roles`.

### Task 4: Permisos y membresía (SQL + TS)

**Files:**
- Create: `supabase/migrations/20261016000002_permissions.sql`, `supabase/tests/020_permissions.test.sql`
- Create: `src/lib/permissions/bits.ts`, `src/lib/auth/wallet.ts`
- Create: `tests/unit/permissions.test.ts`, `tests/unit/wallet.test.ts`

**Interfaces:**
- **Produces (SQL):**
  - `public.auth_wallet_address() returns text`: minúsculas de la identity `web3` de `auth.uid()`, o null.
  - `public.current_member_id() returns uuid` (cualquier estado).
  - `public.is_active_member() returns boolean`.
  - `public.my_membership_status() returns text`: `'none'|'active'|'banned'|'left'`, grant a `authenticated`.
  - `public.member_global_permissions(p_member uuid) returns bigint`.
  - `public.has_global_perm(p_bit bigint) returns boolean`: para el miembro actual, y false si no está activo.
  - `public.member_top_position(p_member uuid) returns int`.
  - Políticas `SELECT`:
    - `members`, `roles`, `member_roles`, `app_config` → `is_active_member()`.
    - `bans`, `member_permission_overrides`, `audit_log` → `has_global_perm(32)`.
  - `members`: `grant update (display_name, avatar_path)` + política de UPDATE `auth_user_id = auth.uid() and is_active_member()`.
- **Produces (TS):**
  - `Perm` (objeto const con los bits de Global Constraints) y `ALL_PERMS = 1023n`.
  - `hasPerm(perms: bigint, bit: bigint): boolean`: admin → true.
  - `normalizeAddress(a: string): \`0x${string}\``: trim + minúsculas; lanza error si no es dirección.
  - `isSuperAdminWallet(address: string, envValue: string | undefined): boolean`.

- [ ] **Step 1:** Tests pgTAP:
  - `member_global_permissions`: un miembro sin roles → 7; con Padrino → 23; SuperAdmin → 1023.
  - Padrino con `deny=16` → 7.
  - SuperAdmin con `deny=512` → sigue 1023.
  - `has_global_perm(16)` es false para un miembro baneado aunque tenga Padrino.
  - `my_membership_status()` → `'none'` para un usuario autenticado sin miembro.
  - Un `authenticated` no miembro → `select count(*) from members` = 0.
  - Un activo no puede hacer `update members set status='banned'` (42501).
- [ ] **Step 2:** Tests de Vitest:
  - Bits exactos (`Perm.CREATE_INVITES === 16n`, …) y `hasPerm(512n, 16n) === true`.
  - `isSuperAdminWallet('0x9f20…de02', ' 0x9F202eb556F95308de0268f60b5757d83744De02 ') === true`.
  - Con el env `''` o `undefined` → false.
  - `normalizeAddress('nope')` lanza error.
- [ ] **Step 3:** Ejecutar ambas suites → FAIL. Implementar. → PASS.
- [ ] **Step 4:** Commit `feat(auth): membership + global permission helpers (sql/ts parity)`.

### Task 5: Bootstrap del SuperAdmin

**Files:**
- Create: `supabase/migrations/20261016000003_bootstrap.sql`, `supabase/tests/030_bootstrap.test.sql`

**Interfaces:**
- **Produces:** `public.bootstrap_super_admin(p_auth_user_id uuid, p_wallet text) returns uuid`, solo para `service_role`.
  - Valida que `lower(p_wallet)` sea igual a la identity web3 de ese usuario (`wallet_mismatch`).
  - Valida que ningún miembro tenga ya el rol SuperAdmin (`bootstrap_closed`).
  - Crea el miembro con `is_bootstrap=true` y le asigna SuperAdmin.
  - Escribe `audit_log` con `action='bootstrap_super_admin'`.
  - Es idempotente: si ese mismo usuario ya es el miembro bootstrap, devuelve su id.

- [ ] **Step 1:** Tests:
  - Como `authenticated` → `throws_ok(..., '42501')`.
  - Como `service_role`:
    - Crea el miembro y le asigna el rol.
    - Llamarlo otra vez para el mismo usuario devuelve el mismo id.
    - Para un segundo usuario lanza `bootstrap_closed`.
    - Con una wallet distinta a su identity lanza `wallet_mismatch`.
- [ ] **Step 2:** FAIL → implementar → `pnpm db:test` PASS.
- [ ] **Step 3:** Commit `feat(auth): one-shot super admin bootstrap rpc`.

### Task 6: Invitaciones (crear, revocar, canjear)

**Files:**
- Create: `supabase/migrations/20261016000004_invites.sql`, `supabase/tests/040_invites.test.sql`

**Interfaces:**
- **Produces** (todas para `authenticated`):
  - `public.create_invite(p_max_uses int, p_expires_at timestamptz) returns public.invites`
    - Requiere estar activo y `has_global_perm(16)`; si no, `forbidden`.
    - Rangos de Global Constraints; fuera de ellos, `invalid_input`.
    - Código: `translate(rtrim(encode(extensions.gen_random_bytes(16),'base64'),'='),'+/','-_')`.
    - Audit `invite_created`.
  - `public.revoke_invite(p_invite_id uuid, p_reason text) returns void`
    - Permitido al creador o a quien tenga `has_global_perm(32)`; si no, `forbidden`. Audit.
  - `public.redeem_invite(p_code text) returns uuid` (member id):
    1. `not_authenticated` si no hay `auth.uid()`; `already_member` si ya existe un miembro con ese `auth_user_id` **o con esa wallet**.
    2. Bloquea la invitación con `select ... for update`.
    3. Comprueba en orden: `invite_not_found` → `invite_revoked` (o creador no activo) → `invite_expired` → `invite_exhausted`.
    4. Inserta el miembro con `invited_by_member_id = created_by`, `uses = uses + 1`, y la redención. Audit `invite_redeemed`.
  - Política `SELECT` en `invites`: `created_by = current_member_id() or has_global_perm(32)`.

- [ ] **Step 1:** Tests:
  - `create_invite` sin permiso → `forbidden`; con Padrino → fila con código de 22 caracteres.
  - `max_uses=0` y `expires_at = now()+10min` → `invalid_input`.
  - Canje válido: el miembro tiene `invited_by` = creador y `uses=1`.
  - `redeem_exhausts_at_max_uses`: con `max_uses=1`, el segundo usuario recibe `invite_exhausted`.
  - Invitación caducada (`update expires_at = now()-'1s'` como superuser) → `invite_expired`.
  - Revocada → `invite_revoked`.
  - Código inexistente → `invite_not_found`.
  - `redeem_rejects_same_wallet_other_auth_user`: dos `auth.users` con la misma dirección en distinto casing → el segundo recibe `already_member`.
  - Un miembro solo ve sus propias invitaciones (`count`).
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** Commit `feat(invites): create/revoke/redeem rpcs with sponsor linkage`.

### Task 7: Moderación — baneo con penalización en cascada y rol Padrino

**Files:**
- Create: `supabase/migrations/20261016000005_moderation.sql`, `supabase/tests/050_moderation.test.sql`

**Interfaces:**
- **Produces:**
  - `public.ban_member(p_target uuid, p_reason text, p_penalize_sponsor boolean) returns uuid` (ban id). En una sola transacción:
    1. El actor debe estar activo y tener el bit 32; si no, `forbidden`.
    2. `member_top_position(actor) > member_top_position(target)`; si no, `hierarchy`. El miembro bootstrap no se puede banear (`hierarchy`).
    3. `reason` entre 3 y 500 caracteres.
    4. `status='banned'` y revocar las invitaciones activas del objetivo (`revoked_reason='member_banned'`).
    5. Poner `needs_review_since=now()` a sus ahijados activos.
    6. Si `p_penalize_sponsor` y hay padrino que no es admin: upsert de override con `deny = deny | 16` y revocar sus invitaciones activas (`'sponsor_penalized'`).
    7. Borrar `auth.sessions` del objetivo, insertar en `bans` y audit `member_banned` con payload `{penalized_sponsor}`.
  - `public.set_member_role(p_member uuid, p_role uuid, p_enabled boolean) returns void`
    - Requiere bit 64 (`MANAGE_ROLES`) o 512, y que la posición del rol sea menor que la posición más alta del actor (`hierarchy`).
    - Prohibido tocar `is_everyone` o SuperAdmin (`forbidden`). Audit.

- [ ] **Step 1:** Tests:
  - Sin permiso → `forbidden`; a un igual o superior → `hierarchy`.
  - `ban_revokes_target_invites`: tras el baneo, canjear una invitación del baneado → `invite_revoked`.
  - Con penalización: las invitaciones activas del padrino quedan revocadas, `member_global_permissions(padrino) & 16 = 0` y `create_invite` del padrino → `forbidden`.
  - Sin penalización: el padrino conserva el bit 16.
  - Los ahijados del baneado tienen `needs_review_since` no nulo.
  - `banned_member_reads_nothing`: con los claims del baneado, `select count(*) from members` = 0.
  - Se escribe la fila en `audit_log`.
  - `set_member_role` asigna Padrino desde SuperAdmin; desde Padrino → `forbidden`.
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** Commit `feat(moderation): ban with optional sponsor penalty cascade`.

### Task 8: Clientes Supabase, proxy y orquestación post-login

**Files:**
- Create: `src/lib/supabase/{browser,server,admin}.ts`, `src/proxy.ts`
- Create: `src/lib/auth/post-login.ts`, `src/lib/auth/actions.ts`, `src/lib/errors.ts`
- Create: `tests/unit/post-login.test.ts`, `tests/unit/errors.test.ts`

**Interfaces:**
- **Consumes:** `isSuperAdminWallet`, `normalizeAddress` (Task 4); RPCs `my_membership_status`, `bootstrap_super_admin`, `redeem_invite`.
- **Produces:**
  - `createBrowserClient()`, `createServerClient()` (cookies de `next/headers`) y `createAdminClient()` (service role, con `import 'server-only'`).
  - `resolvePostLogin(i: { status: 'none'|'active'|'banned'|'left'; isSuperAdmin: boolean; inviteCode: string | null }): 'enter' | 'bootstrap' | 'redeem' | 'banned' | 'no_access'`, función pura:
    - `banned` → `'banned'`; `active` → `'enter'`.
    - `none` + superadmin → `'bootstrap'`; `none` + código → `'redeem'`; resto → `'no_access'`.
  - `completeLogin(inviteCode: string | null): Promise<{ redirectTo: string; error?: string }>` (Server Action):
    - Obtiene la wallet con `getUser()` → identity web3 y llama a `resolvePostLogin`.
    - Ejecuta el bootstrap con el cliente admin, o `redeem_invite` con el cliente de servidor.
    - Destinos: `/`, `/banned`, `/no-access` o `/invite/<code>?error=<code>`.
  - `rpcErrorMessage(code: string): string`: copy en español para cada código de Global Constraints, con fallback "Algo falló. Inténtalo de nuevo."
  - `proxy.ts`:
    - Refresca la sesión (patrón `@supabase/ssr`).
    - Rutas públicas: `/login`, `/invite/*`, `/no-access`, `/banned` y `/_next/*`.
    - Sin sesión → `/login?next=<path>`.
- [ ] **Step 1:** Tests unitarios:
  - La tabla completa de `resolvePostLogin`, con 8 casos que incluyen banned+superadmin → `'banned'`.
  - `rpcErrorMessage('invite_expired')` contiene "caducado"; un código desconocido devuelve el fallback.
- [ ] **Step 2:** FAIL → implementar → PASS; `pnpm typecheck`.
- [ ] **Step 3:** Commit `feat(auth): post-login orchestration, ssr clients and route proxy`.

### Task 9: Tokens de diseño, fuentes y providers Web3

**Files:**
- Create: `src/styles/tokens.ts`, `src/lib/web3/appkit.ts`, `src/components/providers.tsx`, `components.json`
- Create: `tests/unit/tokens.test.ts`
- Modify: `src/app/globals.css`, `src/app/layout.tsx`

**Interfaces:**
- **Produces:**
  - `colors` (valores de la spec §1) y `contrastRatio(fg: string, bg: string): number` (WCAG 2.x).
  - Utilidades de Tailwind: `bg-bg`, `bg-surface`, `text-fg`, `text-fg-muted`, `border-border`, `bg-accent`, `text-accent`, `font-display`, `font-body`, `font-mono`.
  - `<Providers>` (WagmiProvider + QueryClientProvider + AppKit):
    - `createAppKit` con `networks: APP_CHAINS`, `projectId` del env, `themeMode 'dark'`.
    - `themeVariables`: `--w3m-accent: #61DFFF`, `--w3m-border-radius-master: 2px`, `--w3m-font-family: DM Sans`.
- [ ] **Step 1:** `search.py "web3 forum dark shell" --stack nextjs` y `--domain typography`, y anotar las reglas aplicadas.
- [ ] **Step 2:** Tests en `tokens.test.ts`:
  - Ratio ≥ 4.5 para fg/bg, fg-muted/bg, fg-muted/surface-2, bg/accent (texto oscuro sobre acento), danger/bg y success/bg.
  - Cada token de `colors` aparece con el mismo valor en `globals.css` (leído con `fs`).
- [ ] **Step 3:** FAIL → implementar:
  - `next/font/google`: `Archivo({ axes:['wdth'], weight variable })`, `DM_Sans`, `JetBrains_Mono` como CSS vars.
  - `@theme` en `globals.css`; `shadcn init` mapeando sus vars a nuestros tokens.
  - Estilos de foco y `@media (prefers-reduced-motion)`.
  → PASS.
- [ ] **Step 4:** Commit `feat(ui): design tokens, fonts and web3 providers`.

### Task 10: Login e invitación (UI)

**Files:**
- Create: `src/components/auth/login-panel.tsx`, `src/app/(gate)/login/page.tsx`, `src/app/(gate)/invite/[code]/page.tsx`
- Create: `src/app/(gate)/no-access/page.tsx`, `src/app/(gate)/banned/page.tsx`
- Create: `tests/unit/login-panel.test.tsx`

**Interfaces:**
- **Consumes:** `buildLoginMessage`, `generateNonce`, `getAppChain`, `completeLogin`, `rpcErrorMessage`.
- **Produces:** `<LoginPanel inviteCode?: string | null />`. Estados: `disconnected → connected (botón "Firmar y entrar") → signing → error`.
  - Al firmar: `signMessageAsync` (wagmi) → `supabase.auth.signInWithWeb3({ chain:'ethereum', message, signature })` → `completeLogin(inviteCode)` → `router.replace(redirectTo)`.
  - Si la wallet está en otra red: botón "Cambiar a Linea" (`switchChain`) antes de firmar.
- [ ] **Step 1:** `search.py "login wallet connect hero bold minimal" --domain ux` y `--domain style`.
- [ ] **Step 2:** Tests RTL, con hooks de wagmi y el cliente de supabase mockeados:
  - Desconectado → muestra "Conectar wallet".
  - Conectado en chainId 1 → muestra "Cambiar a Linea" y no firma.
  - Firma OK → `completeLogin` recibe el código de invitación y redirige.
  - Error de `signInWithWeb3` → alerta con `role="alert"`.
  - El botón tiene altura ≥44px (clase `min-h-11`).
- [ ] **Step 3:** FAIL → implementar.
  - `/login`: hero con display Archivo 900 "El Club." y el panel.
  - `/invite/[code]`: título "Te han invitado", el panel con el código y `?error` mapeado.
  - `/no-access` y `/banned`: copy en español sin datos sensibles.
  → PASS.
- [ ] **Step 4:** Commit `feat(auth): wallet login and invite landing`.

### Task 11: Shell del foro y guarda de membresía

**Files:**
- Create: `src/app/(forum)/layout.tsx`, `src/app/(forum)/page.tsx`, `src/components/shell/{sidebar,topbar,right-rail}.tsx`
- Create: `tests/unit/shell.test.tsx`

**Interfaces:**
- **Consumes:** `createServerClient`, `my_membership_status`, `has_global_perm`.
- **Produces:**
  - El layout redirige con `status !== 'active'`: `banned` → `/banned`, resto → `/no-access`.
  - Grid de 3 columnas (264px | 1fr | 320px). Por debajo de 1024px el rail se oculta; por debajo de 768px el sidebar es un drawer (Radix Dialog).
  - Navegación:
    - "Inicio", "Invitaciones" (solo si tiene bit 16 o 512) y "Miembros" (admin, bit 32).
    - Avatar y dirección corta en mono.
- [ ] **Step 1:** `search.py "app shell sidebar navigation" --domain ux --stack nextjs`.
- [ ] **Step 2:** Tests RTL de `<Sidebar perms>`:
  - Oculta "Invitaciones" sin el bit 16 y lo muestra con 16 o con 512.
  - Los enlaces tienen nombre accesible.
- [ ] **Step 3:** FAIL → implementar → PASS.
- [ ] **Step 4:** Commit `feat(shell): forum layout with membership guard`.

### Task 12: Gestión de invitaciones (UI)

**Files:**
- Create: `src/lib/invites/actions.ts`, `src/components/invites/{create-invite-form,invite-list}.tsx`, `src/app/(forum)/invites/page.tsx`
- Create: `tests/unit/create-invite-form.test.tsx`

**Interfaces:**
- **Consumes:** RPCs `create_invite`, `revoke_invite`.
- **Produces:**
  - `createInviteAction(fd: FormData): Promise<{ url?: string; error?: string }>`, que devuelve la URL `${origin}/invite/${code}`.
  - `revokeInviteAction(id: string)`.
  - Formulario:
    - Usos: 1, 5, 10, 25 o 100.
    - Caducidad: 1 h, 24 h, 7 días o 30 días.
    - Botón "Copiar enlace".
  - Lista con estado (activa, agotada, caducada, revocada) y usos en mono.
- [ ] **Step 1:** `search.py "form copy link status badge" --domain ux`.
- [ ] **Step 2:** Tests RTL:
  - Envía `max_uses` y `expires_in` elegidos.
  - Tras crear, muestra la URL y el botón de copiar llama a `navigator.clipboard.writeText`.
  - Un error de la acción se muestra con `role="alert"` y el copy de `rpcErrorMessage`.
- [ ] **Step 3:** FAIL → implementar → PASS.
- [ ] **Step 4:** Commit `feat(invites): invite management page`.

### Task 13: Perfil con árbol de padrinos

**Files:**
- Create: `src/app/(forum)/u/[address]/page.tsx`, `src/components/members/sponsor-tree.tsx`
- Create: `tests/unit/sponsor-tree.test.tsx`

**Interfaces:**
- **Consumes:** `members` (SELECT con RLS).
- **Produces:**
  - `<SponsorTree sponsor: MemberSummary | null; invitees: MemberSummary[] />`, con `MemberSummary = { id; walletAddress; displayName: string | null; status }`.
  - La página busca por `wallet_address = lower(param)`; si no existe, devuelve 404.
- [ ] **Step 1:** `search.py "profile page tree relationships" --domain ux`.
- [ ] **Step 2:** Tests RTL:
  - Bootstrap sin padrino → "Miembro fundador".
  - Lista de ahijados enlazada a `/u/<addr>`.
  - Un ahijado baneado muestra la insignia "Baneado".
  - Sin ahijados → "Aún no ha invitado a nadie".
- [ ] **Step 3:** FAIL → implementar → PASS.
- [ ] **Step 4:** Commit `feat(profile): public sponsor tree`.

### Task 14: Panel de miembros con baneo en cascada

**Files:**
- Create: `src/lib/moderation/actions.ts`, `src/components/members/{member-table,ban-dialog}.tsx`, `src/app/(forum)/admin/members/page.tsx`
- Create: `tests/unit/ban-dialog.test.tsx`

**Interfaces:**
- **Consumes:** RPCs `ban_member`, `set_member_role`.
- **Produces:**
  - `banMemberAction({ memberId, reason, penalizeSponsor })` y `toggleSponsorRoleAction({ memberId, enabled })`.
  - La página exige bit 32; si no, `notFound()`.
  - `<BanDialog member sponsor />` (Radix AlertDialog):
    - Motivo obligatorio (3–500 caracteres).
    - Checkbox "Penalizar también a <sponsor>: pierde el permiso de invitar y se anulan sus invitaciones activas", que solo aparece si hay padrino.
    - Botón destructivo "Banear".
  - La tabla marca a los miembros con `needs_review_since`.
- [ ] **Step 1:** `search.py "destructive confirmation dialog" --domain ux`.
- [ ] **Step 2:** Tests RTL:
  - El checkbox no se renderiza si `sponsor=null`.
  - Enviar sin motivo queda bloqueado con un mensaje.
  - Al confirmar se llama a la acción con `penalizeSponsor=true` si el checkbox estaba marcado.
  - El foco vuelve al disparador al cancelar.
- [ ] **Step 3:** FAIL → implementar → PASS.
- [ ] **Step 4:** Commit `feat(moderation): admin members panel with cascade ban`.

### Task 15: E2E de los criterios de "hecho" de F1 y verificación final

**Files:**
- Create: `e2e/helpers/auth.ts`, `e2e/gatekeeping.spec.ts`

**Interfaces:**
- **Produces:**
  - `loginAs(context: BrowserContext, pk: Hex): Promise<void>`:
    - En Node, firma `buildLoginMessage` con `privateKeyToAccount(pk)`.
    - Ejecuta `signInWithWeb3` con un `createServerClient` de `@supabase/ssr` cuyo `setAll` recoge las cookies, y las añade con `context.addCookies`.
    - Después navega a `/login/complete` (pequeño route handler que ejecuta `completeLogin` con `?invite=`).
  - El SuperAdmin de E2E usa una clave generada cuya dirección se inyecta como `SUPER_ADMIN_WALLET` en el `webServer` de Playwright. **Nunca** la wallet real.
- [ ] **Step 1:** Specs:
  1. Una wallet sin invitación acaba en `/no-access`.
  2. El SuperAdmin entra a `/` sin invitación.
  3. El admin crea una invitación en la UI, B la canjea y llega a `/`; el perfil de B muestra al admin como padrino.
  4. Una invitación caducada (forzada vía service role) muestra el error "caducado".
  5. El admin da Padrino a B, B invita a C, el admin banea a C con penalización: B ya no ve "Invitaciones" y su invitación pendiente da `invite_revoked`.
- [ ] **Step 2:** Si `/login/complete` no existía, crearlo. Ejecutar `pnpm test:e2e` → PASS.
- [ ] **Step 3:** Verificación completa: `pnpm lint && pnpm typecheck && pnpm test && pnpm db:test && pnpm test:e2e`, con la salida pegada en el resumen.
- [ ] **Step 4:** Revisión manual con `run` a 375, 768, 1024 y 1440px, con la wallet de pruebas real del usuario en Linea Sepolia, siguiendo el checklist de ui-ux-pro-max.
- [ ] **Step 5:** Commit `test(e2e): f1 gatekeeping acceptance suite`. Después, `requesting-code-review` y `finishing-a-development-branch`.
