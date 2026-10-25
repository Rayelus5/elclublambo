# P2 — Parte pública I Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abrir ElClub. a quien no tiene invitación: cuenta pública con la misma sesión SIWE, rutas en español (sin prefijo) e inglés (`/en`), landing pública creativa en `/`, hub `/herramientas`, sorteos verificables públicos (crear, compartir, apuntarse, drand, verificación, tarjeta OG, premio pagado por el organizador y verificado) y `/start` bilingüe con enlaces cruzados landing ↔ club.

**Architecture:** Un único árbol interno `src/app/(public)/[lang]/…` con segmentos en inglés (`es`|`en`); el proxy reescribe las URLs públicas en español (`/herramientas/sorteos/…`) a ese árbol y sirve la landing en `/` a quien no es miembro. Diccionarios TS tipados, sin librería. Los sorteos públicos viven en tablas propias (`public_giveaways*`) separadas del club, con el mismo azar drand y el mismo verificador del navegador que P1; toda lectura pública pasa por el servidor con service role, sin conceder nada a `anon`.

**Tech Stack:** Next.js 16.4.1 (App Router, `cacheComponents`, `proxy.ts`), React 19, Tailwind v4, motion 14 (`motion/react`, `LazyMotion`), Supabase (Postgres + GoTrue web3), viem, wagmi/AppKit, `@noble/curves`, Vitest + RTL, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-base-arbitrum-y-parte-publica-design.md` (P2, «Landing pública (P2) — contenido», D15, D16, D23, decisiones 8, 9, 12).

## Global Constraints
- Español sin prefijo, inglés con `/en` (D16). Herramientas en `/herramientas/...` y `/en/tools/...`; `/start` también en `/en/start`.
- Visitante sin sesión en `/` → landing pública; con sesión de miembro → foro como hoy; con sesión sin membresía → landing (D16, D23).
- Nada del club es visible para cuentas públicas (D15). Ninguna función nueva se concede a `anon`; las lecturas públicas van por servidor con `createAdminClient()`.
- Sorteos: solo peso igual, sin entrada de pago, nunca (anti-objetivo). Azar drand quicknet exactamente como P1 (`src/lib/giveaways/drand.ts`, `draw.ts`).
- ElClub. no custodia fondos: el premio cripto lo paga el organizador directamente al ganador; la app solo verifica (`verifyTransfer`).
- Builder Code (D14): toda transacción que la app pide firmar en Base lleva `dataSuffixFor(chain)` — usar `useSendTransfer()` de `src/lib/payments/use-send-transfer.ts`, que ya lo añade.
- Sin datos personales on-chain. Las direcciones de participantes se muestran (son públicas); se avisa al apuntarse.
- Límite de peticiones con `private.rate_limit` en crear sorteo y apuntarse (subject `'u:' || user_id`).
- CSP: sin orígenes nuevos (drand ya está permitido).
- Indexable solo en producción (`isProductionSite()` de `src/lib/start/site.ts`); OG por idioma.
- UI: `ui-ux-pro-max` antes de cada pantalla; solo tokens de `globals.css` (sin hex); AA; 375–1920 px sin scroll horizontal; objetivos táctiles ≥ 44 px; reduced motion completo con el patrón de `src/components/start/motion.tsx` (`MotionRoot`, `useMotionOn`, `Stage`).
- Textos cortos. Toda pantalla de dinero recuerda: «ElClub. no custodia fondos.»
- El foro privado, `/login`, `/invite`, `/no-access` y `/bienvenida` siguen solo en español.
- `pnpm test:unit` mientras el usuario prueba; `pnpm test`, `pnpm db:test` y e2e borran la BD local (autorizado: «Sí, cuando haga falta»).
- Ficheros: nunca con PowerShell `Set-Content`/`Out-File`. Commits con los trailers de la sesión.

## Review Focus
1. **Una cuenta pública intenta leer el club.** Una wallet con sesión y sin fila en `members` llama a RPCs del club (`giveaways_list`, `donation_overview`, `search`…) y abre `/c/<id>`: todo `forbidden`/redirección a `/no-access`, nunca datos. Test en Task 3 (pgTAP) y Task 13 (e2e).
2. **Sin sesión, pulsa «Participar» en un enlace compartido.** Se conecta, firma y vuelve al mismo sorteo en el mismo idioma, y queda apuntado con un clic más. Test en Task 8 (unit del flujo) y Task 13 (e2e).
3. **El sorteo cierra con menos participantes que premios, o con cero.** Los premios sobrantes quedan «sin ganador (no hubo suficientes participantes)»; con cero, el sorteo queda anulado y la semilla se revela. Test en Task 5 (pgTAP).
4. **El organizador marca pagado un hash incorrecto** (otro remitente, otro importe, otra red, otro destinatario o una transacción anterior al sorteo). Se rechaza con un mensaje claro y el premio sigue pendiente. Test en Task 6.
5. **Cambiar de idioma conserva la página.** El selector ES/EN de `/herramientas/sorteos/<id>` lleva a `/en/tools/giveaways/<id>` y viceversa, y ningún enlace de una página EN apunta a una URL en español. Test en Task 1 (rutas) y Task 13 (e2e).

## Decisiones del constructor (rulings; coste si es incorrecta)
- **P2-R1 i18n sin librería.** Diccionarios TS (`es` es la fuente; `en` debe tener las mismas claves por tipo). La raíz `<html lang="es">` no cambia; el layout público envuelve todo en `<div lang={lang}>`. (Bajo: un lector de pantalla lee el `<title>` de las páginas EN con voz española.)
- **P2-R2 Árbol interno único** `(public)/[lang]` con segmentos en inglés; el proxy reescribe las URLs en español y redirige (308) cualquier visita directa a `/es/...` a su URL canónica en español, salvo las rutas de imagen OG/Twitter. (Medio: si falla el mapa, una URL española da 404; está cubierto por tests.)
- **P2-R3 Tablas propias para los sorteos públicos** (`public_giveaways`, `public_giveaway_prizes`, `public_giveaway_entries`, `public_giveaway_allowlist`, `private.public_giveaway_seeds`) en vez de `giveaways.scope = 'public'`: la identidad pública es `auth.users`, no `members`, y así ninguna consulta puede mezclar club y público (D15). La columna `scope` de P1 queda sin uso. (Bajo.)
- **P2-R4 Apuntarse = tener sesión.** La firma SIWE del login es la firma «sin gas»; apuntarse es un clic. (Bajo.)
- **P2-R5 Premios públicos:** `crypto` (USDC de Base o Arbitrum, lo paga el organizador) y `custom` (texto). Sin `role` (no hay roles fuera del club). Sin ETH en v1. (Bajo.)
- **P2-R6 Apuntarse pasa por el servidor** (`enter_public_giveaway` solo para service role) para que el requisito «mínimo de transacciones» no se pueda saltar llamando a la RPC directamente. (Bajo.)
- **P2-R7 Sin listado público de sorteos:** se llega por enlace; el organizador ve «Mis sorteos». Evita spam y moderación. (Bajo.)
- **P2-R8 Indexación:** landing, `/herramientas`, `/herramientas/sorteos` y `/start` (ES y EN) indexables en producción con `sitemap.ts` nuevo; el detalle de cada sorteo es `noindex`. (Bajo.)
- **P2-R9 Donaciones de no miembros (decisión 11) pasan a P3** con ElClub Pay (misma familia: pagos públicos). (Medio: si las quieres ya, es un bloque más en este plan.)
- **P2-R10 Landing:** los bloques ElClub Pay y Comprobador se muestran como demostración animada con «Próximamente» y sus CTA desactivados hasta P3/P4. (Bajo.)
- **P2-R11 Sorteo al visitar:** si alguien abre un sorteo vencido cuya ronda drand ya salió, el servidor intenta cerrarlo y sortearlo (idempotente), además del cron horario. (Bajo.)
- **P2-R12 Miembros baneados** del club no pueden crear ni apuntarse a sorteos públicos. (Bajo.)
- **P2-R13 Lista de participantes pública** con dirección abreviada y, tras el cierre, descarga JSON con posición y dirección completa para verificar. Aviso al apuntarse. (Medio, RGPD: la dirección ya es pública y el participante la publica al apuntarse.)
- **P2-R14 Límites:** 5 sorteos creados por usuario y día; ≤ 10 abiertos a la vez por organizador; cierre entre ahora + 10 min y ahora + 90 días; ≤ 10 premios; ≤ 5000 participantes; lista permitida ≤ 2000 direcciones; mínimo de transacciones 0–1000. (Bajo: constantes.)
- **P2-R15 Nombre del organizador:** texto opcional `host_name` (≤ 60) por sorteo; si falta, dirección abreviada. Los alias públicos llegan en P3. (Bajo.)
- **P2-R16 Conexión pública:** mismo `signInWithWeb3` y mismo `uri` (`origin + "/login"`) que el club, con la frase traducida; `completeLogin` gana un modo `"public"` que devuelve `next` en lugar de `/no-access`. (Bajo.)
- **P2-R17 El club no se refactoriza:** `draw_giveaway` de P1 no se toca; el sorteo público usa un helper nuevo `private.giveaway_pick` y un test pgTAP comprueba que da las mismas posiciones que el fixture de paridad de P1. (Bajo.)

## Mapa de rutas (fuente de verdad de Task 1)

| Ruta lógica | ES (URL pública) | EN (URL pública) | Interna |
|---|---|---|---|
| `home` | `/` | `/en` | `/{lang}` |
| `start` | `/start` | `/en/start` | `/{lang}/start` |
| `tools` | `/herramientas` | `/en/tools` | `/{lang}/tools` |
| `giveaways` | `/herramientas/sorteos` | `/en/tools/giveaways` | `/{lang}/tools/giveaways` |
| `giveawayNew` | `/herramientas/sorteos/nuevo` | `/en/tools/giveaways/new` | `/{lang}/tools/giveaways/new` |
| `giveaway` | `/herramientas/sorteos/{id}` | `/en/tools/giveaways/{id}` | `/{lang}/tools/giveaways/{id}` |

`{id}` es un UUID. Cualquier otro sufijo bajo estos prefijos (p. ej. `/{id}/opengraph-image`) se traduce segmento a segmento con el mismo diccionario (`herramientas↔tools`, `sorteos↔giveaways`, `nuevo↔new`).

---

### Task 1: Núcleo i18n y mapa de rutas

**Files:**
- Create: `src/lib/i18n/config.ts`, `src/lib/i18n/routes.ts`, `src/lib/i18n/dictionaries/es.ts`, `src/lib/i18n/dictionaries/en.ts`, `src/lib/i18n/index.ts`
- Test: `tests/unit/i18n/routes.test.ts`, `tests/unit/i18n/dictionaries.test.ts`

**Interfaces:**
- Produces:
  - `type Lang = "es" | "en"`; `LANGS: readonly Lang[]`; `isLang(v: string): v is Lang`; `OG_LOCALE: Record<Lang, "es_ES" | "en_US">`.
  - `type RouteKey = "home" | "start" | "tools" | "giveaways" | "giveawayNew" | "giveaway"`.
  - `localizedPath(lang: Lang, route: RouteKey, params?: { id?: string }): string` — URL pública.
  - `toInternalPath(pathname: string): { internal: string; lang: Lang } | null` — URL pública → interna (null si no es una ruta pública).
  - `toPublicPath(internalPathname: string): string | null` — interna (`/es/...`, `/en/...`) → URL pública.
  - `switchLang(pathname: string, to: Lang): string` — misma página en el otro idioma (pathname público).
  - `alternatesFor(route: RouteKey, params?): { canonical: string; languages: { es: string; en: string; "x-default": string } }` — rutas relativas (el `metadataBase` pone el origen).
  - `type Dictionary = typeof es` (objeto `as const` anidado por pantalla: `common`, `landing`, `tools`, `giveaways`, `start`, `connect`); `getDictionary(lang: Lang): Dictionary`.

- [ ] **Step 1: Write the failing tests**

`routes.test.ts` — un test por fila del mapa en ambos sentidos (`localizedPath` y `toInternalPath`) y además:
```ts
expect(toInternalPath("/herramientas/sorteos/3f1c0b9e-1111-4c4c-8888-000000000001/opengraph-image"))
  .toEqual({ internal: "/es/tools/giveaways/3f1c0b9e-1111-4c4c-8888-000000000001/opengraph-image", lang: "es" });
expect(toInternalPath("/en/tools")).toEqual({ internal: "/en/tools", lang: "en" });
expect(toInternalPath("/c/abc")).toBeNull();          // el foro no es público
expect(toInternalPath("/es/tools")).toBeNull();        // la interna no es una URL pública
expect(toInternalPath("/herramientas/nada")).toBeNull();
expect(toPublicPath("/es/tools/giveaways/new")).toBe("/herramientas/sorteos/nuevo");
expect(toPublicPath("/es")).toBe("/");
expect(switchLang("/herramientas/sorteos/ID", "en")).toBe("/en/tools/giveaways/ID");
expect(switchLang("/en/start", "es")).toBe("/start");
expect(alternatesFor("giveaways").languages).toEqual({ es: "/herramientas/sorteos", en: "/en/tools/giveaways", "x-default": "/herramientas/sorteos" });
```
`dictionaries.test.ts` — recorre recursivamente `es` y `en`: mismas claves, ninguna cadena vacía, ninguna cadena EN igual a la ES salvo una lista explícita (`"ElClub."`, `"drand"`, `"USDC"`, `"Base"`, `"Arbitrum"`).

- [ ] **Step 2: Run tests to verify they fail**
Run: `pnpm vitest run tests/unit/i18n` — Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implement** los ficheros de Interfaces. `en.ts` exporta `export const en = { … } satisfies Dictionary` (falta de clave = error de tipos). En este task los diccionarios solo llevan `common` (nav: Herramientas/Tools, Sorteos/Giveaways, El club/The club, Conectar wallet/Connect wallet, Desconectar/Disconnect, aviso «ElClub. no custodia fondos.»/«ElClub. never holds your funds.»); cada task de UI añade su sección.

- [ ] **Step 4: Run tests** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(i18n): diccionarios ES/EN y mapa de rutas públicas`

---

### Task 2: Enrutado público, proxy, robots y sitemap

**Files:**
- Create: `src/app/(public)/[lang]/layout.tsx`, `src/app/(public)/[lang]/page.tsx` (marcador: h1 con `dict.common` hasta Task 11), `src/app/(public)/[lang]/tools/page.tsx` (marcador hasta Task 10), `src/app/sitemap.ts`
- Move: `src/app/start/{page,opengraph-image,twitter-image}.tsx` → `src/app/(public)/[lang]/start/` (contenido intacto; el `lang` aún no se usa — Task 12)
- Modify: `src/proxy.ts`, `src/lib/auth/public-paths.ts`, `src/app/robots.ts`, tests que leen `src/app/start/*` (`tests/unit/start/*`)
- Test: `tests/unit/i18n/public-routing.test.ts`, `tests/unit/start/start-proxy.test.ts` (ampliar), `tests/unit/start/start-metadata.test.ts` (rutas), `e2e/p2-routing.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`toInternalPath`, `toPublicPath`, `isLang`, `LANGS`).
- Produces:
  - Layout público: `generateStaticParams() → [{lang:"es"},{lang:"en"}]`, `dynamicParams = false`, envuelve en `<div lang={lang} className="flex min-h-full flex-col">`; `notFound()` si `!isLang`.
  - `PUBLIC_PREFIXES` gana `"/en"` y `"/herramientas"` (exacto y con `/`). `/` no se añade: el proxy la resuelve antes del gate (Step 3).
  - `decidePublicRoute(pathname: string, state: "anon" | "public" | "member"): { kind: "rewrite"; to: string } | { kind: "redirect"; to: string } | { kind: "pass" }` exportada desde `src/lib/i18n/public-routing.ts` (pura, para test).

- [ ] **Step 1: Write the failing tests** — `public-routing.test.ts`:
```ts
expect(decidePublicRoute("/", "anon")).toEqual({ kind: "rewrite", to: "/es" });
expect(decidePublicRoute("/", "public")).toEqual({ kind: "rewrite", to: "/es" });
expect(decidePublicRoute("/", "member")).toEqual({ kind: "pass" });
expect(decidePublicRoute("/start", "member")).toEqual({ kind: "rewrite", to: "/es/start" });
expect(decidePublicRoute("/herramientas/sorteos/nuevo", "anon")).toEqual({ kind: "rewrite", to: "/es/tools/giveaways/new" });
expect(decidePublicRoute("/en/tools", "anon")).toEqual({ kind: "pass" });
expect(decidePublicRoute("/es/tools", "anon")).toEqual({ kind: "redirect", to: "/herramientas" });
expect(decidePublicRoute("/es/start/opengraph-image", "anon")).toEqual({ kind: "pass" }); // imágenes OG internas
expect(decidePublicRoute("/c/abc", "anon")).toEqual({ kind: "pass" });
```
Ampliar `start-proxy.test.ts`: con el proxy real y Supabase simulado, `/` sin sesión responde con cabecera `x-middleware-rewrite` hacia `/es`; `/herramientas` sin sesión no redirige a `/login`.
`e2e/p2-routing.spec.ts`: anónimo → `/` 200 y no redirige a `/login`; `/en`, `/herramientas`, `/en/tools`, `/start`, `/en/start` 200; `/es/tools` → 308 a `/herramientas`; `/xx` 404; un miembro en `/` ve el foro (`gatekeeping` helpers existentes); `robots.txt` y `sitemap.xml` no indexan fuera de producción.

- [ ] **Step 2: Run tests** — Expected: FAIL.

- [ ] **Step 3: Implement.** En `proxy.ts`, antes del gate de sesión: `decidePublicRoute` con `state` = `"anon"` sin usuario; con usuario y pathname `/`, consulta `my_membership_status` (RPC, solo para `/`) → `"member"` si `active`, si no `"public"`. Para `rewrite`: `NextResponse.rewrite(new URL(to, request.url), { request: { headers: request.headers } })` manteniendo cookies de sesión con `applySessionHeaders` como el resto del proxy; `redirect` con 308. El gate `!user && !isPublicPath` no debe disparar para rutas que `toInternalPath` reconoce. `robots.ts` en producción: `allow: ["/$", "/en", "/start", "/herramientas", "/_next/"]`, `disallow: "/"` y `sitemap: <origin>/sitemap.xml`; el detalle de cada sorteo se excluye con `noindex` en su metadata (Task 8), no en robots. `sitemap.ts`: fuera de producción `[]`; en producción las rutas `home`, `start`, `tools`, `giveaways` en ES con `alternates.languages` EN.

- [ ] **Step 4: Run tests** — `pnpm vitest run tests/unit/i18n tests/unit/start` y `pnpm test:e2e e2e/p2-routing.spec.ts e2e/start-landing.spec.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(public): árbol /[lang], reescrituras del proxy, robots y sitemap`

---

### Task 3: Cuenta pública (sesión sin membresía)

**Files:**
- Create: `supabase/migrations/20261025100001_public_accounts.sql`, `supabase/tests/p2_01_public_accounts.test.sql`, `src/components/public/public-connect.tsx`, `src/components/public/account-chip.tsx`, `src/components/public/public-header.tsx`, `src/components/public/public-footer.tsx`, `src/lib/auth/public-session.ts`
- Modify: `src/lib/auth/actions.ts` (`completeLogin`), `src/lib/auth/post-login.ts`, `src/lib/web3/siwe.ts` (frase por idioma), `src/components/auth/no-access-view.tsx` (enlace «Ir a herramientas» → `localizedPath("es","tools")`), `src/app/(public)/[lang]/layout.tsx` (monta header y footer), diccionarios (`connect`)
- Test: `tests/unit/public/public-connect.test.tsx`, `tests/unit/complete-login.test.ts` (ampliar), `tests/unit/public/public-session.test.ts`

**Interfaces:**
- Produces:
  - SQL `public.is_public_account() returns boolean` — `security definer stable set search_path=''`: `auth.uid()` no nulo, `auth_wallet_address()` no nula y sin fila `members` con `status = 'banned'` para ese `auth_user_id`. `grant execute … to authenticated`.
  - `completeLogin(inviteCode: string | null, mode?: "club" | "public")`: con `mode = "public"` y estado `none`/`left`/`active` → `{ redirectTo: "public" }` (el cliente navega a `next`); `banned` → `/banned` como hoy. Sin `mode` nada cambia.
  - `getPublicSession(): Promise<{ userId: string; wallet: \`0x${string}\`; isMember: boolean } | null>` (server-only; `createServerClient` + `walletFromUser` + `my_membership_status`).
  - `<PublicConnect lang next label? />` (client, carga perezosa como `LoginPanelLazy`): conecta (AppKit), firma `buildLoginMessage` con la frase del idioma, `signInWithWeb3`, `completeLogin(null, "public")`, `router.replace(safeNextPath(next))` + `router.refresh()`.
  - `<AccountChip lang wallet />`: dirección abreviada + «Desconectar» (`supabase.auth.signOut()` y `router.refresh()`); si `isMember`, enlace «Ir al club» a `/`.
  - `<PublicHeader lang session />`: wordmark (enlace a `home`), nav (`tools`), selector ES/EN (`switchLang` con el pathname actual vía `usePathname`), `AccountChip` o `PublicConnect`. `<PublicFooter lang />`: aviso sin custodia, «No es asesoramiento financiero», enlace a `start` («Qué es ElClub.»), «Construido en Base · también en Arbitrum».

- [ ] **Step 1: Write the failing tests**
pgTAP `p2_01` (plan explícito): `is_public_account()` es true para `tests.create_wallet_user`, true para un miembro activo, false para un miembro baneado, false sin autenticar; **Review Focus 1**: autenticado como wallet sin miembro, `giveaways_list(10)`, `donation_overview()`, `giveaway_detail(<id real>)` y `search('a')` lanzan `forbidden` o no devuelven filas (usa la forma que cada RPC ya tiene en sus tests de P1).
Unit: `completeLogin(null, "public")` con estado `none` devuelve `{ redirectTo: "public" }` y no llama a `redeem_invite`; con `banned` devuelve `/banned`; `PublicConnect` en `lang="en"` firma un mensaje cuya frase es la EN (`"Sign in to ElClub. This signature costs no gas and moves no funds."`) y tras éxito navega a `next`; con `next="//evil"` navega a `/`.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/public tests/unit/complete-login.test.ts` y `pnpm db:test` — Expected: FAIL.
- [ ] **Step 3: Implement** según Interfaces (`ui-ux-pro-max` antes del header). Frases SIWE: ES = la actual; EN = la del test.
- [ ] **Step 4: Run** — Expected: PASS (y los tests de login existentes siguen en verde).
- [ ] **Step 5: Commit** — `feat(public): cuenta pública con la misma sesión SIWE, cabecera y pie públicos`

---

### Task 4: BD de sorteos públicos — esquema, crear, apuntarse, consultar

**Files:**
- Create: `supabase/migrations/20261025100002_public_giveaways.sql`, `supabase/tests/p2_02_public_giveaways.test.sql`

**Interfaces:**
- Produces (todas `security definer set search_path=''`, sin grant a `anon`):
  - Tablas (RLS activada, todo revocado a `public/anon/authenticated`):
    - `public_giveaways(id uuid pk default gen_random_uuid(), host_user_id uuid not null references auth.users(id) on delete cascade, host_address text not null check (~ '^0x[0-9a-f]{40}$'), host_name text check (char_length(btrim(host_name)) between 1 and 60), title text not null (1..80, btrim), description text (≤ 500), closes_at timestamptz not null, status text not null default 'open' check (in ('open','closed','drawn','void','cancelled')), min_tx_count int not null default 0 check (0..1000), has_allowlist boolean not null default false, seed_commit, seed_reveal, target_round bigint not null, drand_signature, drand_randomness, entry_count int, drawn_at, cancelled_at, created_at)` con los mismos checks de coherencia que `giveaways` de P1 (líneas 55-62 de `20261024200006_giveaways.sql`).
    - `public_giveaway_prizes(id, giveaway_id → cascade, rank 1..10, kind in ('crypto','custom'), chain_id → chains, token ('USDC' o null), amount numeric(78,0), label 1..120, winner_user_id uuid, winner_address text, winner_position int, status in ('pending','awarded','unawarded','paid','delivered'), unawarded_reason in ('not_enough_entries'), payout_tx_hash, payout_log_index, paid_at, delivered_at)` + `unique(giveaway_id, rank)`, `unique(chain_id, payout_tx_hash, payout_log_index)`, checks como P1 (`paid` solo crypto, `delivered` solo custom).
    - `public_giveaway_entries(giveaway_id → cascade, user_id uuid not null references auth.users(id) on delete cascade, wallet_address text not null, entered_at timestamptz not null default clock_timestamp(), position int, primary key (giveaway_id, user_id), unique (giveaway_id, wallet_address))`.
    - `public_giveaway_allowlist(giveaway_id → cascade, address text check (~ '^0x[0-9a-f]{40}$'), primary key (giveaway_id, address))`.
    - `private.public_giveaway_seeds(giveaway_id pk → cascade, seed bytea check (octet_length = 32))`, revocado incluso a `service_role`.
  - `create_public_giveaway(p_title text, p_description text, p_closes_at timestamptz, p_host_name text, p_min_tx_count int, p_allowlist text[], p_prizes jsonb) returns uuid` — `authenticated`; exige `is_public_account()`; `private.rate_limit('u:'||auth.uid(), 'public_giveaway_create', 5, '1 day')`; ≤ 10 abiertos del host (`too_many_open`); `p_closes_at` en `[now()+10 min, now()+90 days]` (`invalid_input`); 1–10 premios, `crypto` exige `chain_id` habilitado en `chains` + `token='USDC'` + `amount > 0`; allowlist ≤ 2000 direcciones normalizadas a minúsculas y deduplicadas (`has_allowlist = cardinality > 0`); semilla `gen_random_bytes(32)`, `seed_commit = '0x'||keccak256(seed)` y `target_round` con `_giveaway_target_round(p_closes_at)` (función de P1, reutilizada).
  - `cancel_public_giveaway(p_id uuid) returns void` — host; solo `open` y antes de `closes_at`; borra la semilla sin revelarla.
  - `enter_public_giveaway(p_id uuid, p_user uuid, p_wallet text) returns text` (`'entered'|'already'`) — **solo service_role**; sorteo `open` y antes de `closes_at` (`giveaway_closed`); `p_user` no baneado en `members` (`forbidden`); si `has_allowlist`, `p_wallet` debe estar (`not_allowed`); ≤ 5000 participantes (`giveaway_full`); `private.rate_limit('u:'||p_user, 'public_giveaway_entry', 30, '10 minutes')`; `on conflict do nothing`.
  - `leave_public_giveaway(p_id uuid) returns void` — `authenticated`, borra su entrada mientras esté abierto.
  - `public_giveaway_view(p_id uuid, p_viewer uuid) returns jsonb` — **solo service_role**: título, descripción, `hostName`, `hostAddress`, `closesAt`, `status`, `targetRound`, `seedCommit`, `seedReveal`, `drandSignature`, `drandRandomness`, `entryCount`, `minTxCount`, `hasAllowlist`, `isHost`, `iEntered`, `entries` (posición si existe y `wallet_address`; ordenado por posición y si no por `entered_at`), `prizes` (rango, kind, chainId, token, amount como texto, label, status, winnerPosition, winnerAddress, payoutTxHash). Devuelve `null` si no existe.
  - `my_public_giveaways(p_limit int) returns jsonb` — `authenticated`, los del host (`auth.uid()`), abiertos primero.

- [ ] **Step 1: Write the failing pgTAP test** `p2_02` (plan explícito) con `tests.create_wallet_user` para host y participantes: crear válido devuelve uuid y guarda `seed_commit` = `keccak256` de la semilla (lectura de la semilla como superusuario de test); rechaza `closes_at` a 5 min, a 91 días, 11 premios, premio crypto sin `amount`, `kind='role'`, y un baneado del club; el sexto `create` del día da `rate_limited`; el undécimo abierto da `too_many_open`; `enter` como `authenticated` da permiso denegado (42501); `enter` como service role da `entered` y luego `already`; con allowlist rechaza fuera de lista (`not_allowed`); tras `closes_at` da `giveaway_closed`; `public_giveaway_view` no expone `seed_reveal` mientras está abierto (`null`); `anon` no puede ejecutar ninguna función nueva; una wallet pública no puede leer `public_giveaway_entries` directamente.
- [ ] **Step 2: Run** `pnpm db:test` — Expected: FAIL.
- [ ] **Step 3: Implement** la migración (cabecera con el porqué de P2-R3, P2-R6, P2-R14). Recuerda: un `CASE … END` dentro de `IF` rompe el parser del CLI de Supabase (P1 T6); asígnalo a una variable.
- [ ] **Step 4: Run** `pnpm db:test` — Expected: PASS, y `p1_06_giveaways` sigue en verde.
- [ ] **Step 5: Commit** — `feat(db): sorteos públicos — esquema, crear, apuntarse y vista`

---

### Task 5: BD de sorteos públicos — cierre, sorteo, pagos; cron

**Files:**
- Create: `supabase/migrations/20261025100003_public_giveaways_draw.sql`, `supabase/tests/p2_03_public_giveaways_draw.test.sql`
- Modify: `src/lib/giveaways/cron.ts` (`runGiveawaySteps`), `tests/integration/giveaway-draw-parity.test.ts`
- Test: `tests/unit/giveaways/cron.test.ts` (ampliar)

**Interfaces:**
- Consumes: Task 4 tablas; P1 `_giveaway_target_round`, `drawOne`.
- Produces:
  - `private.giveaway_pick(p_seed bytea, p_randomness bytea, p_n int, p_k int) returns int[]` — posiciones 1-based con el algoritmo de P1 (`r1 = keccak(seed‖randomness)`, `i = uint256_be(r) mod len(L)`, quitar `L[i]`, `r = keccak(r)`); devuelve menos de `p_k` si `p_n < p_k`. Execute revocado a todos.
  - `close_due_public_giveaways() returns jsonb {closed, voided}` — service_role; posiciones por `row_number() over (order by entered_at, user_id)`; 0 participantes → `void`, semilla revelada, premios `unawarded/not_enough_entries`.
  - `public_giveaways_awaiting_draw() returns table(id uuid, target_round bigint)` — service_role.
  - `draw_public_giveaway(p_id uuid, p_round bigint, p_signature text) returns text` (`'drawn'|'already'`) — service_role; mismas comprobaciones de ronda que `draw_giveaway` de P1; `randomness = sha256(signature)`; ganadores con `giveaway_pick`; premio sin participante → `unawarded/not_enough_entries`; ganador → `awarded` con `winner_user_id`, `winner_address`, `winner_position`; revela y borra la semilla.
  - `record_public_giveaway_payout(p_prize uuid, p_payout jsonb, p_actor uuid) returns text` — service_role; `p_actor` debe ser el host; premio `crypto` y `awarded`; anti-reutilización contra `onchain_transfers`, `giveaway_prizes` y sus propios pagos; estado `paid`.
  - `mark_public_prize_delivered(p_prize uuid) returns void` — `authenticated`, host, premio `custom` en `awarded` → `delivered`.
  - `runGiveawaySteps()` además ejecuta el ciclo público (`close_due_public_giveaways`, `public_giveaways_awaiting_draw`, `drawOne` generalizado con un parámetro `rpc: "draw_giveaway" | "draw_public_giveaway"`) y devuelve `{ closed, voided, drawn, waiting, failed, public: { closed, voided, drawn, waiting, failed } }`; el atajo «drand no responde» se comparte entre ambos ciclos.

- [ ] **Step 1: Write the failing tests** — pgTAP `p2_03`: `giveaway_pick` con la semilla/aleatoriedad del fixture `tests/fixtures/giveaway-draw.json` devuelve `expectedWinners` (`[4,2,5]`); **Review Focus 3**: 2 participantes y 3 premios → dos `awarded`, uno `unawarded/not_enough_entries`; 0 participantes → `void` con semilla revelada; ronda distinta de `target_round` → `invalid_input`; repetir con la misma firma → `already`; `record_public_giveaway_payout` con un actor que no es el host → `forbidden`, sobre premio `custom` → `invalid_state`, con el mismo hash usado en otro premio → `tx_already_used`; `mark_public_prize_delivered` por no-host → `forbidden`. Unit `cron.test.ts`: con un sorteo público vencido y drand simulado, `runGiveawaySteps` llama a `draw_public_giveaway` y cuenta en `public.drawn`; si drand no responde en el ciclo del club, no se le vuelve a preguntar en el público. Integration: la paridad TS↔SQL también contra `giveaway_pick`.
- [ ] **Step 2: Run** `pnpm db:test` y `pnpm vitest run tests/unit/giveaways tests/integration/giveaway-draw-parity.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS (P1 intacto).
- [ ] **Step 5: Commit** — `feat(db): cierre, sorteo drand y pagos de sorteos públicos en el cron`

---

### Task 6: Lógica TS de sorteos públicos

**Files:**
- Create: `src/lib/public-giveaways/types.ts`, `src/lib/public-giveaways/actions.ts`, `src/lib/public-giveaways/queries.ts`, `src/lib/public-giveaways/draw-on-view.ts`, `src/lib/public-giveaways/tx-count.ts`, `src/app/(public)/[lang]/tools/giveaways/[id]/entries/route.ts`
- Test: `tests/unit/public-giveaways/actions.test.ts`, `tests/unit/public-giveaways/queries.test.ts`, `tests/unit/public-giveaways/draw-on-view.test.ts`, `tests/unit/public-giveaways/entries-route.test.ts`

**Interfaces:**
- Consumes: Task 3 `getPublicSession`; Task 4/5 RPCs; `verifyTransfer`, `chainClient`, `parseAmount`, `drawOne`, `targetRound`, `roundTime`, `hitRateLimit`.
- Produces:
  - Tipos `PublicGiveawayView`, `PublicPrize`, `PublicEntry`, `PublicGiveawayCard` (forma de `public_giveaway_view` / `my_public_giveaways`, importes como `string`).
  - `createPublicGiveawayAction(input: { title; description; closesAt: string; hostName; minTxCount: number; allowlist: string; prizes: Array<{ kind: "crypto"; chainId: ChainId; amount: string } | { kind: "custom"; label: string }> }): Promise<{ ok: true; id: string } | { ok: false; error: PublicGiveawayError }>` — el `allowlist` es texto pegado (separado por saltos de línea, comas o espacios); las direcciones inválidas devuelven `invalid_allowlist` con la primera que falla.
  - `enterPublicGiveawayAction(id: string)`: sin sesión → `{ ok:false, error:"not_authenticated" }`; si `minTxCount > 0`, `countTransactions(wallet)` (suma de `getTransactionCount` en las redes habilitadas del entorno vía `chainClient`) y `min_tx_not_met` si no llega; luego `createAdminClient().rpc("enter_public_giveaway", { p_id, p_user, p_wallet })`.
  - `leavePublicGiveawayAction(id)`, `cancelPublicGiveawayAction(id)`, `markPublicPrizeDeliveredAction(prizeId)` — envoltorios finos con el cliente del usuario.
  - `markPublicPrizePaidAction(prizeId: string, txHash: string)` — **Review Focus 4**: sesión del host, `hitRateLimit("chain_verify")`, lee premio y sorteo con admin, `verifyTransfer({ chain, token:"USDC", txHash, from: host_address, to: winner_address, amount, notBefore: drawn_at })`; cualquier fallo devuelve su código (`wrong_sender`, `wrong_amount`, `wrong_recipient`, `wrong_chain`, `too_early`, `pending`, `not_found`) sin tocar la BD; éxito → `record_public_giveaway_payout`.
  - `getPublicGiveaway(id: string, viewer: string | null): Promise<PublicGiveawayView | null>` (admin; null si el id no es UUID); `getMyPublicGiveaways(limit = 20)`.
  - `maybeDrawOnView(view: PublicGiveawayView, nowMs = Date.now()): Promise<boolean>` — P2-R11: si `status ∈ {open, closed}`, `closes_at` pasado y `roundTime(target_round) ≤ now`, ejecuta `close_due_public_giveaways` y `drawOne(…, "draw_public_giveaway")`; devuelve true si cambió algo (la página vuelve a leer). Nunca lanza.
  - `GET …/[id]/entries` → JSON `{ giveawayId, targetRound, entries: [{ position, address }] }` solo si `status ∈ {closed, drawn, void}`; si no, 404. `Cache-Control: public, max-age=60`.

- [ ] **Step 1: Write the failing tests** con Supabase y viem simulados: cada código de error de `markPublicPrizePaidAction` (uno por caso de Review Focus 4) deja la BD sin llamar; `enterPublicGiveawayAction` con `minTxCount=5` y 3 transacciones → `min_tx_not_met` sin llamar a la RPC; sin sesión → `not_authenticated`; `createPublicGiveawayAction` normaliza y deduplica la allowlist y rechaza `0x123`; `maybeDrawOnView` no hace nada antes de `roundTime`, y con drand caído devuelve false sin lanzar; la ruta de entradas da 404 con el sorteo abierto y la lista ordenada tras el cierre.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/public-giveaways` — Expected: FAIL.
- [ ] **Step 3: Implement.** Mensajes de error traducibles: las acciones devuelven códigos; el texto vive en los diccionarios (Task 7/8).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(public): acciones, consultas y sorteo al visitar de los sorteos públicos`

---

### Task 7: Crear sorteo público (UI)

**Files:**
- Create: `src/app/(public)/[lang]/tools/giveaways/new/page.tsx`, `src/components/public-giveaways/create-form.tsx`, `src/components/public-giveaways/prize-rows.tsx`
- Modify: diccionarios (`giveaways.create`, `giveaways.errors`)
- Test: `tests/unit/public-giveaways/create-form.test.tsx`

**Interfaces:**
- Consumes: Task 6 `createPublicGiveawayAction`; Task 3 `getPublicSession`, `PublicConnect`; `AssetLogo` (`src/components/economy/asset-logo.tsx`); redes habilitadas de `chainsForSet(networkSet())`.
- Produces: página que, sin sesión, muestra la explicación en 3 líneas y `PublicConnect` (con `next` = esta misma URL); con sesión, el formulario: título, descripción, cierre (fecha+hora local, convertida a ISO), nombre del organizador (opcional), premios (filas USDC con selector de red por logo, o texto libre; máx. 10), «Requisitos» plegado (mínimo de transacciones, lista de direcciones), aviso «El premio en USDC lo pagas tú directamente al ganador. ElClub. no custodia fondos.». Al crear → `router.push(localizedPath(lang, "giveaway", { id }))`.

- [ ] **Step 1: `ui-ux-pro-max`** (formularios, divulgación progresiva) y anotar las decisiones en el commit.
- [ ] **Step 2: Write the failing test**: en `lang="en"` todas las etiquetas salen en inglés; cierre en el pasado muestra el error junto al campo y no envía; 11.º premio no se puede añadir; un error `rate_limited` de la acción muestra el texto del diccionario; éxito navega a `/en/tools/giveaways/<id>`.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement.** **Step 5: Run** — PASS.
- [ ] **Step 6: Commit** — `feat(public): crear sorteo verificable`

---

### Task 8: Página del sorteo público (UI)

**Files:**
- Create: `src/app/(public)/[lang]/tools/giveaways/[id]/page.tsx`, `src/components/public-giveaways/{giveaway-header,join-panel,entries-list,prize-panel,host-panel,pay-prize-button,share-button}.tsx`
- Modify: `src/components/giveaways/giveaway-verifier.tsx` (acepta `labels` del diccionario; mismo comportamiento por defecto en el club), diccionarios (`giveaways.detail`)
- Test: `tests/unit/public-giveaways/detail-page.test.tsx`, `tests/unit/public-giveaways/pay-prize-button.test.tsx`, `tests/unit/giveaways/giveaway-verifier.test.tsx` (ampliar)

**Interfaces:**
- Consumes: Task 6 (`getPublicGiveaway`, `maybeDrawOnView`, acciones), `GiveawayVerifier`, `Countdown`, `useSendTransfer`, `useEnsureChain`, `shortAddress`.
- Produces: página (lee la sesión dentro de `Suspense` por `cacheComponents`; `generateMetadata` con `robots: noindex`, título del sorteo, `alternates` de Task 1) con:
  - cabecera: título, organizador (`host_name` o dirección abreviada), estado, cuenta atrás;
  - `JoinPanel` — **Review Focus 2**: sin sesión → `PublicConnect` con `next` = URL actual + `?join=1`; con sesión y `?join=1` muestra «Participar» enfocado; apuntado → «Estás dentro» + «Salir»; muestra requisitos y el error `min_tx_not_met`/`not_allowed` con su texto; aviso «Tu dirección aparecerá en la lista pública de participantes.»;
  - premios con su estado (pendiente, ganador posición N + dirección abreviada, pagado con enlace al explorador de su red, entregado);
  - verificación (cuando `drawn` o `void`): compromiso, ronda, firma y `GiveawayVerifier`, más enlace a la descarga JSON de participantes;
  - participantes (abreviados, numerados tras el cierre);
  - `HostPanel` (solo host): «Cancelar» (abierto), por cada premio cripto `awarded`: «Pagar ahora» (`PayPrizeButton`: `ensure(chainId)` → `send({ chain, token:"USDC", to: winnerAddress, amount })` → `markPublicPrizePaidAction(prizeId, hash)` con reintento si devuelve `pending`) o «Ya lo pagué» (pegar hash); premio `custom` `awarded`: «Marcar entregado»;
  - `ShareButton`: `navigator.share` si existe; si no, copiar la URL pública canónica del idioma.

- [ ] **Step 1: `ui-ux-pro-max`** (página de detalle, estados, móvil).
- [ ] **Step 2: Write the failing tests**: sin sesión el panel ofrece conectar con `next` que termina en `?join=1`; host ve «Pagar ahora» solo para premios cripto `awarded`; `PayPrizeButton` llama a `send` con el `to` y `amount` del premio y después a `markPublicPrizePaidAction` con el hash devuelto; un `wrong_amount` muestra su texto; el verificador del club sigue mostrando sus textos en español sin `labels`.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement.** **Step 5: Run** — PASS.
- [ ] **Step 6: Commit** — `feat(public): página del sorteo — apuntarse, verificar, pagar y compartir`

---

### Task 9: Tarjeta OG del sorteo

**Files:**
- Create: `src/app/(public)/[lang]/tools/giveaways/[id]/opengraph-image.tsx`, `…/twitter-image.tsx`, `src/lib/og/fonts.ts` (lectura de las TTF de `src/assets/fonts` extraída de `start/opengraph-image.tsx`)
- Modify: `src/app/(public)/[lang]/start/opengraph-image.tsx` (usa `src/lib/og/fonts.ts`)
- Test: `tests/unit/public-giveaways/og.test.ts`, `e2e/p2-giveaways.spec.ts` (paso OG en Task 13)

**Interfaces:**
- Produces: PNG 1200×630 con el estilo de la OG de `/start` (tokens de `@/styles/tokens`): título del sorteo, «N premios», fecha de cierre o «Ganadores anunciados», estado, dominio + ruta pública del idioma. Sorteo inexistente → tarjeta genérica de la herramienta (nunca 500). `alt` por idioma.

- [ ] **Step 1: Failing test**: la función de contenido (`ogContent(view | null, lang)`, exportada) devuelve los textos EN para `en`, genérico para `null`, y nunca incluye `hostAddress` completa.
- [ ] **Step 2–4:** Run FAIL → Implement → PASS.
- [ ] **Step 5: Commit** — `feat(public): tarjeta OG por sorteo e idioma`

---

### Task 10: Hub `/herramientas` y herramienta de sorteos

**Files:**
- Modify: `src/app/(public)/[lang]/tools/page.tsx`
- Create: `src/app/(public)/[lang]/tools/giveaways/page.tsx`, `src/components/public/tool-card.tsx`, `src/components/public-giveaways/my-giveaways.tsx`
- Modify: diccionarios (`tools`, `giveaways.home`)
- Test: `tests/unit/public/tools-hub.test.tsx`

**Interfaces:**
- Produces:
  - Hub: título corto + tarjetas `ToolCard` (icono Lucide, nombre, una línea, estado): Sorteos verificables (activo → `giveaways`), ElClub Pay, Comprobador de tokens y enlaces, Avales (los tres «Próximamente», no enlazan). Metadata indexable en producción con `alternates`.
  - Herramienta de sorteos: qué es en 3 pasos (crear → compartir → drand decide), CTA «Crear sorteo» (`giveawayNew`), y con sesión «Mis sorteos» (`getMyPublicGiveaways`) con estado y enlace; sin sesión, nada de listado.

- [ ] **Step 1: `ui-ux-pro-max`.** **Step 2: Failing test**: el hub en EN enlaza «Verifiable giveaways» a `/en/tools/giveaways` y las tarjetas «Coming soon» no son enlaces; «Mis sorteos» no se renderiza sin sesión.
- [ ] **Step 3–5:** FAIL → Implement → PASS. **Step 6: Commit** — `feat(public): hub de herramientas y página de sorteos`

---

### Task 11: Landing pública

**Files:**
- Modify: `src/app/(public)/[lang]/page.tsx`
- Create: `src/components/landing/{landing,hero,giveaway-demo,pay-demo,checker-demo,networks,club-teaser,final-cta}.tsx`
- Modify: diccionarios (`landing`)
- Test: `tests/unit/landing/landing.test.tsx`, `tests/unit/landing/landing-motion.test.tsx`, `e2e/p2-landing.spec.ts`

**Interfaces:**
- Consumes: `MotionRoot`, `useMotionOn`, `Stage`, variantes de `src/components/start/motion.tsx` (importar, no copiar); `AssetLogo`/logos de `public/brand/`.
- Produces: landing con los bloques del spec en este orden (todos con texto de diccionario):
  1. **Hero** — h1 «Herramientas cripto honestas, verificables y gratis.» / «Honest, verifiable, free crypto tools.»; CTA primario «Crear sorteo» → `giveawayNew`, secundario «Qué es ElClub.» → `start`.
  2. **Demo viva del sorteo** — animación por scroll: compromiso (hash) → ronda drand → ganador resaltado; estática y completa con reduced motion.
  3. **ElClub Pay** — un enlace que se convierte en tarjeta de pago; badge «Próximamente» (P2-R10).
  4. **Comprobador** — pega un contrato y aparecen alertas; «Próximamente».
  5. **Redes** — «Construido en Base · también en Arbitrum» con los logos.
  6. **El club** — «Lo mejor está dentro: un foro privado por invitación» → `start`.
  7. **CTA final** — «Crear sorteo» (primario), «Crear enlace de pago» (desactivado, «Próximamente»), «Qué es ElClub.».
  Metadata: título y descripción por idioma, `alternates` (Task 1), `openGraph.locale = OG_LOCALE[lang]`, robots según `isProductionSite()`; OG propia `src/app/(public)/[lang]/opengraph-image.tsx` (+ twitter) con el hero.

- [ ] **Step 1: `ui-ux-pro-max`** + `frontend-design` (estética de `/start`: negro, `--accent`, Archivo gigante, capas, maquetas en código; distinta de `/start`). Anota la dirección visual en el commit.
- [ ] **Step 2: Failing tests**: jerarquía de encabezados (un h1, h2 por bloque); en EN no aparece ninguna cadena del diccionario ES; los CTA «Próximamente» son `aria-disabled` y no navegan; sin estilos inline de opacidad/transform que oculten texto (mismo test que `start-landing.test.tsx`); con motion activado quedan revelados pendientes (patrón de `start-landing-motion.test.tsx`). e2e: 375/768/1440 sin scroll horizontal, reduced motion muestra todo el texto, sin violaciones de CSP, «Crear sorteo» lleva a la página de crear.
- [ ] **Step 3–5:** FAIL → Implement → PASS. **Step 6: Commit** — `feat(public): landing pública bilingüe`

---

### Task 12: Reforma de `/start` y enlaces cruzados

**Files:**
- Modify: `src/app/(public)/[lang]/start/{page,opengraph-image}.tsx`, `src/components/start/*` (texto a diccionario `start`; reciben `dict`), `src/app/(gate)/login/page.tsx` (sin cambio de destino: `/start`), `src/app/(forum)/page.tsx` (enlace a `/start` intacto)
- Test: `tests/unit/start/*` (ajustar a diccionario y añadir EN), `e2e/start-landing.spec.ts` (añadir `/en/start`)

**Interfaces:**
- Produces: `/start` y `/en/start` con el mismo diseño; contenido revisado contra P1 (Inicio con buscador, Mecenas, sorteos drand con premios de rol/objeto, encuestas 1p1v, alphas en Base/Arbitrum); bloque nuevo corto «¿Aún sin invitación? Prueba las herramientas abiertas» → `tools` (enlace cruzado landing ↔ club); `FinalCta` mantiene «Solicitar invitación» desactivado; el pie usa `PublicFooter` o sus mismos textos; `alternates` ES/EN y OG por idioma.

- [ ] **Step 1: Failing tests**: `/en/start` renderiza el h1 y los encabezados en inglés; existe un enlace a `localizedPath(lang,"tools")`; los tests actuales de copy siguen pasando con el texto ES desde el diccionario; la metadata EN usa `en_US`.
- [ ] **Step 2–4:** FAIL → Implement → PASS. **Step 5: Commit** — `feat(start): /start bilingüe y enlace a las herramientas`

---

### Task 13: E2E del flujo público, documentación y cierre

**Files:**
- Create: `e2e/p2-giveaways.spec.ts`, `e2e/p2-public-account.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-24-base-arbitrum-y-parte-publica-design.md` (P2 «Hecho» + rulings P2-R1…R17 + HACER A MANO), `src/app/(forum)/guia/*` si la guía menciona la parte pública (una línea con enlace a `/herramientas`)

- [ ] **Step 1: Write the e2e tests** (wallets de test de los helpers existentes, nunca las del usuario; drand con `e2e/mock/drand.mjs`):
  - `p2-giveaways`: wallet A (sin membresía) conecta desde `/herramientas/sorteos/nuevo`, crea un sorteo con premio de texto y premio USDC que cierra en ~1 min; wallet B abre el enlace sin sesión, pulsa Participar, conecta y queda apuntada (**Review Focus 2**); wallet C se apunta en EN; al vencer, abrir la página dispara el sorteo (P2-R11) con la ronda simulada; «Comprobar» da los tres pasos en verde; el host marca entregado el premio de texto; la OG del sorteo responde PNG 200; el selector ES/EN conserva la página (**Review Focus 5**).
  - `p2-public-account`: wallet sin invitación conecta en `/herramientas`, ve su dirección y «Desconectar»; navega a `/c/<id>` y a `/` → no ve nada del club (`/no-access` y landing) (**Review Focus 1**); un miembro conecta en `/` y ve el foro.
- [ ] **Step 2: Run** `pnpm test:e2e e2e/p2-*.spec.ts` — Expected: PASS (si un test exige reajustes de UI, corrígelos en el componente, no en el test).
- [ ] **Step 3: Verificación completa** — `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:test`, `pnpm test:e2e` y la suite contra build de producción (`E2E_PROD=1`, como en P1). Todo en verde o documentado.
- [ ] **Step 4: Docs** — marcar P2 como hecho en el spec con los rulings y añadir a HACER A MANO: «Probar en PRE: crear un sorteo público desde una wallet sin invitación, apuntarse con otra, comprobarlo y pagar un premio USDC de prueba en Base Sepolia».
- [ ] **Step 5: Commit** — `test(e2e): flujo público de sorteos y cuenta pública; docs P2`
