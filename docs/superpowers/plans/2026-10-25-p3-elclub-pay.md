# P3 — ElClub Pay y donaciones públicas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enlace/página de pago `elclub.party/pay/<alias o dirección>` (ES y `/en/pay/...`) donde cualquiera paga USDC o ETH en Base o Arbitrum directamente al destinatario, con recibo verificable, botón para incrustar y perfiles públicos mínimos; y donaciones de no miembros a la Safe del club desde la parte pública (movidas de P2).

**Architecture:** Perfiles públicos en una tabla propia (`public_profiles`, espacio de nombres separado del handle del club). La página de pago no exige sesión: basta conectar la wallet (wagmi) y firmar la transferencia (`useSendTransfer`, Builder Code en Base). El recibo es una página sin estado que lee la transacción de la cadena (`inspectTransfer`) y se cachea cuando es final. Las donaciones públicas usan una tabla de intenciones propia y una confirmación en servicio que inserta en `donations` con `member_id` nulo; si el donante entra después al club, un trigger le asigna sus donaciones y el rol Mecenas.

**Tech Stack:** Next.js 16.4.1 (cacheComponents, `"use cache"`, `proxy.ts`), React 19, Tailwind v4, wagmi/viem, Supabase (Postgres + GoTrue web3), Vitest, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-base-arbitrum-y-parte-publica-design.md` (P3, decisiones 11 y 12, D9, D14, D22). Parte de P2 (`docs/superpowers/plans/2026-10-24-p2-parte-publica.md`): rutas `(public)/[lang]`, `localizedPath`, `getPublicSession`, `PublicConnect`, `APP_TOP_SEGMENTS`.

## Global Constraints
- Sin custodia y sin comisión: el pago va de la wallet del pagador a la del destinatario en una sola transacción; nada pasa por ElClub. (anti-objetivo, D13).
- Toda transacción en Base lleva el Builder Code: usar siempre `useSendTransfer()` (`src/lib/payments/use-send-transfer.ts`).
- Activos: solo la lista cerrada `assetsFor(...)` (USDC nativo y ETH de Base/Arbitrum del entorno, `src/lib/economy/assets.ts`).
- Sin datos personales on-chain (no hay memo en la transacción).
- El perfil público es independiente del club: alias propio, y solo muestra «Miembro de ElClub.» si el usuario lo activa (decisión 12). Aviso: «Tu dirección es pública de todos modos».
- D22: el perfil indica en qué redes recibe; la página de pago solo ofrece activos de esas redes. Aviso al configurar: «Si tu dirección es de un exchange o una smart wallet, deja solo la red que admite».
- Ninguna función nueva se concede a `anon`; las lecturas públicas van por servidor con `createAdminClient()`.
- Límite de peticiones con `private.rate_limit` (sujeto `'u:' || auth.uid()`) en escrituras; `hitRateLimit` antes de cualquier lectura on-chain disparada por un usuario con sesión.
- Pantallas de dinero: «ElClub. no custodia fondos.»; en donaciones además «Donar no da derechos económicos.».
- Rutas e i18n como P2: segmentos internos en inglés; `pay` es igual en ES y EN; `donate` ↔ `donar`; páginas `instant = false` + lecturas de sesión dentro de `<Suspense>`; metadata con `alternatesFor(route, params, lang)`; indexable solo en producción.
- UI: `ui-ux-pro-max` antes de cada pantalla; tokens de `globals.css`; AA; 375–1920 sin scroll horizontal; objetivos ≥ 44 px; reduced motion.
- Tests: `pnpm test:unit` mientras el usuario prueba; `pnpm test`, `db:test` y e2e borran la BD local (autorizado). Wallets de test, nunca las del usuario.

## Review Focus
1. **Pagar a una dirección sin perfil.** Funciona, pero la página avisa claramente que no hay perfil verificado y muestra la dirección completa para comprobarla. Test en Task 4.
2. **La wallet del pagador está en otra red o sin saldo suficiente.** «Pagar» cambia de red y, sin saldo, lo dice antes de firmar (preflight); nunca envía una transacción condenada. Test en Task 4.
3. **El recibo de una transacción que no es un pago válido** (otro token, revertida, inexistente, de otra red): el recibo lo dice sin inventar datos; una pendiente muestra «pendiente» y se refresca. Test en Task 5.
4. **Un no miembro dona y después entra al club.** Sus donaciones pasan a contar como suyas y recibe Mecenas si suman ≥ 1 USD. Test en Task 7.
5. **Alias ya cogido, reservado o con mayúsculas/espacios.** Mensaje claro junto al campo; el alias se guarda normalizado en minúsculas. Test en Tasks 2 y 3.

## Decisiones del constructor (rulings; coste si es incorrecta)
- **P3-R1 Pagar no exige sesión SIWE.** Conectar la wallet basta; el recibo se verifica leyendo la cadena. (Bajo.)
- **P3-R2 Recibo sin estado:** `/pay/tx/<chainId>/<hash>` lee la transacción y decodifica transferencias nativas o `Transfer` de USDC oficial; se cachea con `"use cache"` solo cuando es final; no se guarda nada en BD. (Bajo: más llamadas RPC; mitigado con caché.)
- **P3-R3 Alias** `^[a-z0-9_]{3,20}$`, normalizado a minúsculas, con la lista reservada del club más las palabras de rutas (`pay`, `tx`, `tools`, `herramientas`, `start`, `donar`, `donate`, `en`, `es`, `elclubpay`). Se puede cambiar (límite 30/h); los enlaces antiguos dejan de funcionar. (Bajo.)
- **P3-R4 La página de una dirección sin perfil** acepta todas las redes del entorno y muestra un aviso. (Bajo.)
- **P3-R5 Botón incrustable = enlace + imagen SVG** (`/pay/<alias>/badge`), no iframe (la CSP prohíbe que nos incrusten: `frame-ancestors 'none'`). (Bajo.)
- **P3-R6 Sin código QR en v1** (evita una dependencia nueva). (Bajo.)
- **P3-R7 Donación pública requiere cuenta pública (SIWE)** para atar la dirección donante; tabla propia `public_donation_intents`; la donación confirmada entra en `donations` con `member_id` nulo y `public_intent_id`. (Medio.)
- **P3-R8 Lista del club:** un donante externo aparece como «Donante externo · 0x12…ab» solo si marcó «Aparecer en la lista de donantes del club»; la parte pública no muestra la lista del club (D15), solo totales y saldos de la Safe. (Bajo.)
- **P3-R9 Al entrar al club**, un trigger `after insert on members` asigna las donaciones con `member_id` nulo y la misma `donor_address` y concede Mecenas si suman ≥ `donor_role_min_usd6`. (Bajo.)
- **P3-R10 `/donar`**: miembro → la página del club como hoy; cualquier otro → la página pública (reescritura del proxy, como `/`). EN: `/en/donate`. (Bajo.)
- **P3-R11 Índices:** la herramienta de Pay y la página de donar son indexables en producción; `/pay/<x>` y los recibos son `noindex`. (Bajo.)
- **P3-R12 En la landing y el hub,** ElClub Pay pasa a activo; el Comprobador sigue «Próximamente» hasta P4. (Bajo.)

## Mapa de rutas (amplía el de P2)

| Ruta lógica | ES | EN | Interna |
|---|---|---|---|
| `payTool` | `/herramientas/pay` | `/en/tools/pay` | `/{lang}/tools/pay` |
| `pay` | `/pay/{target}` | `/en/pay/{target}` | `/{lang}/pay/{target}` |
| `payReceipt` | `/pay/tx/{chainId}/{hash}` | `/en/pay/tx/{chainId}/{hash}` | `/{lang}/pay/tx/{chainId}/{hash}` |
| `donate` | `/donar` (no miembros) | `/en/donate` | `/{lang}/donate` |

`{target}` = alias (`^[a-z0-9_]{3,20}$`) o dirección (`^0x[0-9a-fA-F]{40}$`); `{chainId}` ∈ redes del entorno; `{hash}` = `^0x[0-9a-fA-F]{64}$`. Sufijos permitidos tras `{target}`: `opengraph-image`, `twitter-image`, `badge`.

---

### Task 1: Rutas, proxy y sesión de las nuevas páginas

**Files:**
- Modify: `src/lib/i18n/routes.ts`, `src/lib/i18n/public-routing.ts`, `src/lib/auth/public-paths.ts`, `src/proxy.ts`, `src/app/sitemap.ts`, `src/app/robots.ts`
- Create: marcadores `src/app/(public)/[lang]/tools/pay/page.tsx`, `pay/[target]/page.tsx`, `pay/tx/[chainId]/[hash]/page.tsx`, `donate/page.tsx` (h1 del diccionario; Tasks 3–5 y 9 los sustituyen)
- Test: `tests/unit/i18n/routes.test.ts`, `tests/unit/i18n/public-routing.test.ts`, `tests/unit/i18n/app-top-segments.test.ts`, `e2e/p2-routing.spec.ts` (ampliar)

**Interfaces:**
- Produces: `RouteKey` gana `"payTool" | "pay" | "payReceipt" | "donate"`; `localizedPath(lang, "pay", { target })`, `localizedPath(lang, "payReceipt", { chainId, hash })`; `decidePublicRoute("/donar", state)` → `pass` para `member`, `rewrite /es/donate` para el resto; el proxy lee la membresía también para `/donar`.

- [ ] **Step 1: Failing tests** — una fila por ruta del mapa en ambos sentidos; `toInternalPath("/pay/ab")` → null (alias corto); `toInternalPath("/pay/0xABC…40hex")` válido; `toInternalPath("/pay/alias/badge")` válido; `toInternalPath("/pay/tx/1/0x…")` → null (cadena fuera del entorno); `decidePublicRoute("/donar","member")` → pass; `decidePublicRoute("/donar","anon")` → rewrite `/es/donate`; `/es/donate` → 308 `/donar`; e2e: anónimo en `/donar` ve la página pública (200), miembro ve la del club, `/pay/<dirección>` 200 sin sesión.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/i18n` — FAIL.
- [ ] **Step 3: Implement.** `PUBLIC_PREFIXES` gana `/pay`; `sitemap` añade `payTool` y `donate`; `robots` permite `/herramientas` (ya) y `/donar` + `/en/donate`; `/pay/*` y los recibos no se permiten en robots y llevan `noindex`.
- [ ] **Step 4: Run** unit + `pnpm test:e2e e2e/p2-routing.spec.ts` — PASS.
- [ ] **Step 5: Commit** — `feat(pay): rutas de ElClub Pay y /donar público`

---

### Task 2: BD de perfiles públicos

**Files:**
- Create: `supabase/migrations/20261025200001_public_profiles.sql`, `supabase/tests/p3_01_public_profiles.test.sql`, `tests/fixtures/public-aliases.json` (lista reservada compartida SQL/TS)

**Interfaces:**
- Produces:
  - `public_profiles(user_id uuid pk references auth.users on delete cascade, alias citext unique not null check (alias::text ~ '^[a-z0-9_]{3,20}$'), display_name text check (char_length(btrim) between 1 and 40), wallet_address text not null check (~ '^0x[0-9a-f]{40}$'), accept_networks text[] not null default '{base,arbitrum}' check (cardinality ≥ 1 and accept_networks <@ '{base,arbitrum}'), show_member_badge boolean not null default false, created_at, updated_at)`; RLS on, todo revocado.
  - `upsert_public_profile(p_alias text, p_display_name text, p_accept_networks text[], p_show_member_badge boolean) returns jsonb` — `authenticated`; `is_public_account()`; `private.rate_limit('u:'||auth.uid(), 'profile', 30, '1 hour')`; normaliza (btrim, ASCII a minúsculas como `set_handle`), `alias_invalid` / `alias_reserved` / `alias_taken`; `wallet_address = auth_wallet_address()`.
  - `my_public_profile() returns jsonb` — `authenticated` (null si no tiene).
  - `public_profile_view(p_target text) returns jsonb` — **service_role**: por alias (minúsculas) o por dirección (perfil cuyo `wallet_address` coincide); `{ alias, displayName, address, acceptNetworks, isMember }` donde `isMember` = `show_member_badge` y existe miembro `active` con ese `auth_user_id`; dirección sin perfil → `{ alias: null, displayName: null, address, acceptNetworks: ['base','arbitrum'], isMember: false }`; alias inexistente → null.
  - `public_profile_by_address(p_address text) returns jsonb` — **service_role** (alias o null; lo usa el recibo).

- [ ] **Step 1: Failing pgTAP** (plan explícito): crear, leer, cambiar alias; `Alias_1 ` se guarda `alias_1`; `ab` → `alias_invalid`; `admin`, `pay`, `donar` → `alias_reserved`; duplicado → `alias_taken`; `accept_networks` vacío o con `linea` → error; un baneado del club → `forbidden`; `anon` no ejecuta nada; `authenticated` no ejecuta `public_profile_view`; `isMember` solo con la insignia activada y miembro activo.
- [ ] **Step 2–4:** `pnpm db:test` FAIL → migración → PASS.
- [ ] **Step 5: Commit** — `feat(db): perfiles públicos de ElClub Pay`

---

### Task 3: Herramienta de Pay — perfil, enlace y botón incrustable

**Files:**
- Modify: `src/app/(public)/[lang]/tools/pay/page.tsx`, diccionarios (`pay.tool`)
- Create: `src/components/pay/profile-form.tsx`, `src/components/pay/link-builder.tsx`, `src/components/pay/embed-snippet.tsx`, `src/lib/pay/actions.ts`, `src/lib/pay/queries.ts`, `src/lib/pay/link.ts`, `src/app/(public)/[lang]/pay/[target]/badge/route.ts`
- Test: `tests/unit/pay/link.test.ts`, `tests/unit/pay/profile-form.test.tsx`, `tests/unit/pay/badge-route.test.ts`

**Interfaces:**
- Consumes: Task 1 rutas; Task 2 RPCs; `getPublicSession`, `PublicConnectLazy`, `AssetLogo`, `assetsFor`, `parseAmount`.
- Produces:
  - `savePublicProfileAction(input: { alias; displayName; acceptNetworks: NetworkKey[]; showMemberBadge }): Promise<{ ok:true; profile } | { ok:false; error: "alias_invalid"|"alias_reserved"|"alias_taken"|"rate_limited"|"forbidden"|"not_authenticated"|"unknown" }>`.
  - `getMyPublicProfile()`; `getPublicProfileView(target: string)` (admin; null si no existe alias); `getProfileByAddress(address)`.
  - `buildPayUrl(origin: string, lang: Lang, target: string, opts?: { amount?: string; asset?: AssetId }): string` y `parsePayQuery(searchParams): { amount: string | null; asset: AssetId | null }` (descarta valores inválidos o activos no permitidos).
  - Proxy: un alias inexistente en `/pay/<alias>` o `/en/pay/<alias>` (la página, no `badge` ni OG) da 404 real con la técnica de los sorteos inexistentes de P2 (`src/lib/public-giveaways/exists.ts`: service role, sin grant a `anon`); una dirección válida nunca da 404. Test en `tests/unit/pay/proxy-alias-404.test.ts` y e2e en Task 10.
  - Badge `GET` → SVG (≤ 2 KB, colores de `@/styles/tokens`, texto «Pagar con ElClub Pay»/«Pay with ElClub Pay» y `@alias`), `Content-Type: image/svg+xml`, `Cache-Control: public, max-age=3600`, alias inexistente → SVG genérico (nunca 500); el texto del alias se escapa.
  - Página: sin sesión → explicación en 3 líneas + `PublicConnect`; con sesión → formulario de perfil (alias, nombre opcional, redes con logos y aviso D22, insignia «Miembro de ElClub.» solo si `isMember`, aviso «Tu dirección es pública de todos modos») y, con perfil, el constructor de enlace (importe y activo opcionales, copiar) y el fragmento HTML incrustable con vista previa.

- [ ] **Step 1: `ui-ux-pro-max`.** **Step 2: Failing tests** — `buildPayUrl` ES/EN con y sin opciones; `parsePayQuery` descarta `amount=-1`, `asset=DOGE:1`; formulario: error `alias_taken` junto al campo (Review Focus 5); la insignia no aparece si no es miembro; el badge escapa `<script>` en el alias y devuelve SVG genérico para alias inexistente.
- [ ] **Step 3–5:** FAIL → Implement → PASS (`pnpm lint`, `typecheck`, `test:unit`).
- [ ] **Step 6: Commit** — `feat(pay): perfil público, enlace de pago y botón incrustable`

---

### Task 4: Página de pago `/pay/<alias o dirección>`

**Files:**
- Modify: `src/app/(public)/[lang]/pay/[target]/page.tsx`, diccionarios (`pay.page`)
- Create: `src/components/pay/pay-widget.tsx`, `src/app/(public)/[lang]/pay/[target]/opengraph-image.tsx` (+ `twitter-image.tsx`)
- Test: `tests/unit/pay/pay-widget.test.tsx`, `tests/unit/pay/pay-page.test.tsx`

**Interfaces:**
- Consumes: Task 3 `getPublicProfileView`, `parsePayQuery`; `useSendTransfer`, `useEnsureChain`, `useAssetBalances`, `useBalancePreflight`, `AssetPicker`, `assetsFor(chainIds, accept)`, `parseAmount`, `formatAmount`; AppKit para conectar (`useAppKit().open()`), sin firma SIWE.
- Produces: página (noindex, título «Pagar a @alias»/«Pay @alias», OG con alias o dirección abreviada) que muestra destinatario (alias + nombre + insignia si procede, dirección completa con copiar), **aviso de dirección sin perfil** (Review Focus 1) y `PayWidget`:
  - activos filtrados por `acceptNetworks` y ordenados por saldo; importe precargado de `?amount`, activo de `?asset`;
  - **Review Focus 2**: si la wallet está en otra red, «Pagar» llama a `ensure(chainId)` y continúa; `preflight` comprueba saldo (y gas para USDC) antes de firmar y muestra «Saldo insuficiente» sin enviar;
  - tras `send` → `router.push(localizedPath(lang, "payReceipt", { chainId, hash }))`;
  - aviso «ElClub. no custodia fondos. El pago va directo a esta dirección.».
  - Alias inexistente → 404 real desde el proxy (Task 3); dirección válida siempre 200.

- [ ] **Step 1: `ui-ux-pro-max`.** **Step 2: Failing tests** — dirección sin perfil muestra el aviso y la dirección completa; con `acceptNetworks=['base']` solo hay activos de Base; wallet en otra red: `ensure` se llama antes de `send`; saldo insuficiente: `send` no se llama y aparece el texto; `?amount=5&asset=USDC:84532` precarga; éxito navega al recibo.
- [ ] **Step 3–5:** FAIL → Implement → PASS.
- [ ] **Step 6: Commit** — `feat(pay): página de pago sin custodia`

---

### Task 5: Recibo verificable

**Files:**
- Create: `src/lib/pay/inspect.ts`, `src/app/(public)/[lang]/pay/tx/[chainId]/[hash]/page.tsx` (sustituye el marcador), `src/components/pay/receipt.tsx`
- Modify: diccionarios (`pay.receipt`)
- Test: `tests/unit/pay/inspect.test.ts`, `tests/unit/pay/receipt.test.tsx`

**Interfaces:**
- Consumes: `chainClient`, `NETWORKS`, `defaultConfirmations`, `explorerTx`, `explorerAddress`, `getProfileByAddress`.
- Produces:
  - `inspectTransfer(chain: ChainId, hash: \`0x${string}\`, client = chainClient(chain)): Promise<{ status: "ok"; final: boolean; confirmations: number; token: "ETH" | "USDC"; from; to; amount: bigint; blockTimestamp: number } | { status: "pending" } | { status: "error"; code: "tx_not_found" | "tx_failed" | "not_a_payment" | "rpc_unavailable" }>` — nativo: `tx.value > 0` y sin logs de USDC; USDC: primer `Transfer` del contrato oficial de esa red; varios logs USDC → el primero (documentado).
  - Página: datos del pago (de, a — con `@alias` si tiene perfil —, token, importe, fecha, confirmaciones), enlace al explorador, «Comprobado en la cadena» solo si `final`; pendiente → «Pendiente» y refresco automático cada 5 s (cliente) hasta final; errores con texto propio (**Review Focus 3**). Lectura final cacheada con `"use cache"` + `cacheLife("max")` y `cacheTag`; pendiente sin caché.

- [ ] **Step 1: Failing tests** con viem simulado — nativo ok; USDC ok; revertida → `tx_failed`; inexistente → `tx_not_found`; transferencia de otro token → `not_a_payment`; por debajo de confirmaciones → `final:false`; RPC caída → `rpc_unavailable`; el componente muestra «Pendiente» y no «Comprobado» cuando `final:false`.
- [ ] **Step 2–4:** FAIL → Implement → PASS.
- [ ] **Step 5: Commit** — `feat(pay): recibo verificable leído de la cadena`

---

### Task 6: BD de donaciones públicas

**Files:**
- Create: `supabase/migrations/20261025200002_public_donations.sql`, `supabase/tests/p3_02_public_donations.test.sql`

**Interfaces:**
- Produces:
  - `public_donation_intents(id uuid pk, user_id uuid not null references auth.users on delete cascade, donor_address text not null, chain_id int not null references chains, token text check in ('USDC','ETH'), amount numeric(78,0) > 0, recipient_address text not null, anonymous boolean not null default false, listed boolean not null default false, status text default 'pending' check in ('pending','confirmed','failed'), main_tx_hash text, fail_reason text, created_at, expires_at default now()+'24 hours')`; RLS on, todo revocado.
  - `donations`: `intent_id` pasa a admitir null, nueva `public_intent_id uuid unique references public_donation_intents`, `check (num_nonnulls(intent_id, public_intent_id) = 1)`, nueva `listed boolean not null default false` (los miembros siguen con `donor_visible`).
  - `create_public_donation_intent(p_chain_id int, p_token text, p_amount numeric, p_anonymous boolean, p_listed boolean) returns jsonb` — `authenticated`; `is_public_account()` y **no** miembro activo (`use_club_donation` si lo es); mismos límites, rangos, Safe por `chains.safe_address` y tope de 20 pendientes que `create_donation_intent`; `private.rate_limit('u:'||auth.uid(), 'payment_intent', 30, '10 minutes')`.
  - `attach_public_donation_tx(p_intent uuid, p_hash text) returns void` — `authenticated`, dueño, pendiente y no caducada.
  - `confirm_public_donation(p_intent uuid, p_main jsonb, p_usd6 numeric, p_eth_price_e8 numeric) returns jsonb` — **service_role**; misma validación de `usd6` que `confirm_donation`; anti-reutilización contra `onchain_transfers` y `donations (chain_id, tx_hash, log_index)`; inserta en `donations` con `member_id null`, `public_intent_id`, `donor_address`, `anonymous`, `listed`; `already` idempotente.
  - `fail_public_donation(p_intent uuid, p_reason text)` — service_role.
  - `my_public_donations() returns jsonb` — `authenticated`: total USD6 confirmado y lista propia.
  - `public_donation_overview() returns jsonb` — **service_role**: total USD6 y nº de donaciones (sin nombres ni direcciones).
  - Trigger `after insert on members` (P3-R9): `update donations set member_id = new.id where member_id is null and donor_address = new.wallet_address`; si el total ≥ `donor_role_min_usd6`, concede el rol `system_key='donor'` (`on conflict do nothing`) y `audit_log donor_role_granted`.
  - `donor_ranking` (redefinida, misma firma y salida): añade filas de donantes externos `listed` y no anónimos agrupados por `donor_address` con `label = 'Donante externo · ' || _short_address(donor_address)` y `member_id null`; las de miembros no cambian.

- [ ] **Step 1: Failing pgTAP** (plan explícito): intent público ok; un miembro activo recibe `use_club_donation`; baneado `forbidden`; `confirm_public_donation` inserta con `member_id` nulo; el mismo hash dos veces → `already`, en otra intención → `tx_already_used`; ranking: externo `listed` aparece con la etiqueta, no `listed` no aparece, anónimo no aparece; **Review Focus 4**: wallet pública dona 2 USD, canjea una invitación → sus donaciones tienen `member_id` y tiene el rol Mecenas; las donaciones de P1 siguen pasando sus tests.
- [ ] **Step 2–4:** `pnpm db:test` FAIL → migración → PASS (p1_03 intacto).
- [ ] **Step 5: Commit** — `feat(db): donaciones de no miembros y Mecenas al entrar`

---

### Task 7: Lógica TS de donaciones públicas

**Files:**
- Create: `src/lib/donations/public-actions.ts`, `src/lib/donations/public-queries.ts`
- Modify: `src/lib/payments/confirm.ts` (rama pública reutilizando la verificación y el precio), `src/lib/donations/queries.ts` (`DonorRankRow.memberId` puede ser null)
- Test: `tests/unit/donations/public-actions.test.ts`

**Interfaces:**
- Consumes: Task 6 RPCs; `verifyTransfer`, `verifyClubSafe`, `readEthUsd`, `usd6For`, `hitRateLimit`, `getPublicSession`.
- Produces: `createPublicDonationIntentAction(input: { chainId; token; amount: string; anonymous; listed })`; `attachPublicDonationTxAction(intentId, hash)`; `verifyPublicDonationAction(intentId): Promise<{ status: "confirmed" } | { status: "pending"; reason? } | { status: "failed"; code }>` (sesión = dueño; `hitRateLimit("chain_verify")`; `verifyTransfer` de `donor_address` a la Safe por el importe exacto y no antes de `created_at`; Safe desplegada; precio de ETH; `confirm_public_donation`; códigos definitivos → `fail_public_donation`); `getMyPublicDonations()`, `getPublicDonationOverview()`.

- [ ] **Step 1: Failing tests** (Supabase y viem simulados): un `tx_mismatch` marca fallida; sin precio de ETH queda `pending/price_unavailable`; Safe no desplegada `pending/safe_not_deployed`; otro usuario no puede verificar la intención ajena.
- [ ] **Step 2–4:** FAIL → Implement → PASS.
- [ ] **Step 5: Commit** — `feat(donations): donar desde la parte pública`

---

### Task 8: Página pública de donar

**Files:**
- Modify: `src/app/(public)/[lang]/donate/page.tsx`, diccionarios (`donate`)
- Create: `src/components/public-donations/public-donate-panel.tsx`
- Test: `tests/unit/public-donations/public-donate-panel.test.tsx`

**Interfaces:**
- Consumes: Task 7; `getSafeBalances()`, `donationChains()`, `useSendTransfer`, `useEnsureChain`, `AssetPicker`, `PublicConnectLazy`.
- Produces: página (indexable en producción) con: qué es donar a ElClub. (3 líneas), saldos de la Safe por red, total donado (`public_donation_overview`), y el panel: sin sesión → `PublicConnect`; con sesión de no miembro → elegir activo e importe, «Donación anónima», «Aparecer en la lista de donantes del club como donante externo», enviar → adjuntar hash (reintentos 1/2/4 s) → verificar (cada 3 s hasta 120 s, luego «tardando»); «Tu total donado»; aviso «Si entras en el club, tus donaciones cuentan para el rol Mecenas»; avisos de custodia y derechos económicos. Con sesión de miembro → enlace «Dona desde el club» a `/donar`. Sin Safe desplegada en ninguna red → «Donaciones aún no disponibles».

- [ ] **Step 1: `ui-ux-pro-max`.** **Step 2: Failing tests** — miembro ve el enlace al club; sin Safe → mensaje y sin formulario; el flujo llama a `send` con `to` = Safe de la red elegida; el envío deja el hash guardado antes de verificar (persistencia en `localStorage` por intención, como el botón de premios de P2).
- [ ] **Step 3–5:** FAIL → Implement → PASS.
- [ ] **Step 6: Commit** — `feat(donations): página pública de donar`

---

### Task 9: Club, hub y landing

**Files:**
- Modify: `src/components/donations/donor-list.tsx` (filas de donante externo sin enlace a perfil), `src/app/(public)/[lang]/tools/page.tsx` y `src/components/public/tool-card.tsx` (Pay activo), `src/components/landing/pay-demo.tsx` y `final-cta.tsx` (CTA «Crear enlace de pago» → `payTool`), diccionarios
- Test: `tests/unit/donations/donor-list.test.tsx`, `tests/unit/public/tools-hub.test.tsx`, `tests/unit/landing/landing.test.tsx`

- [ ] **Step 1: Failing tests** — fila `memberId: null` muestra «Donante externo · 0x12…ab» sin enlace; hub enlaza ElClub Pay a `payTool` en ES y EN; landing: «Crear enlace de pago» es un enlace a `payTool` y ya no lleva «Próximamente»; el Comprobador sigue con «Próximamente».
- [ ] **Step 2–4:** FAIL → Implement → PASS.
- [ ] **Step 5: Commit** — `feat(public): ElClub Pay activo en el hub y la landing; donantes externos en el club`

---

### Task 10: E2E, verificación completa y documentación

**Files:**
- Create: `e2e/p3-pay.spec.ts`, `e2e/p3-donations.spec.ts`
- Modify: spec (P3 «Hecho» + rulings + HACER A MANO), guía del club si menciona donaciones (una línea sobre donantes externos)

- [ ] **Step 1: e2e** (wallets de test; nodo Hardhat y USDC de los helpers de P1/P2):
  - `p3-pay`: wallet A crea perfil `alias` (solo Base) desde `/herramientas/pay`; copia el enlace con importe; wallet B sin sesión abre `/pay/<alias>?amount=…`, solo ve activos de Base, paga USDC y llega al recibo, que pasa de «Pendiente» a «Comprobado en la cadena» con `@alias`; pagar a una dirección sin perfil muestra el aviso; el badge responde SVG; EN conserva la página.
  - `p3-donations`: wallet sin invitación conecta en `/donar`, dona USDC marcando «Aparecer en la lista»; un miembro ve «Donante externo · 0x…» en `/donar` del club; esa wallet canjea una invitación y aparece como miembro con Mecenas (**Review Focus 4**).
- [ ] **Step 2: Verificación completa** — `pnpm lint`, `typecheck`, `test`, `db:test`, `test:e2e`, `E2E_PROD=1 pnpm test:e2e`: todo en verde o documentado.
- [ ] **Step 3: Docs** — P3 «Hecho» con rulings; HACER A MANO: «Probar en PRE: crear un perfil de Pay, pagar desde otra wallet y abrir el recibo; donar desde una wallet sin invitación».
- [ ] **Step 4: Commit** — `test(e2e): ElClub Pay y donaciones públicas; docs P3`
