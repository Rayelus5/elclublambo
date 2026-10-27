# R1 — Todo el club bajo /foro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/` y `/en` son siempre la landing pública; el club entero (incluidas las páginas de entrada) vive bajo `/foro/...`; las URLs antiguas del club redirigen con 308 a su equivalente bajo `/foro`.

**Architecture:** Un módulo único de rutas del club (`src/lib/club/paths.ts`: `CLUB_BASE = "/foro"`, `clubPath(p)`) usado por todos los enlaces, redirecciones, guards y `revalidatePath`. Las carpetas `(forum)`, `(gate)` y `(onboarding)` pasan a colgar de una carpeta estática `src/app/foro/` (los grupos se conservan dentro). El proxy añade, antes del gate de sesión, una redirección 308 de los segmentos antiguos a `/foro/<resto>` conservando la query. `_push_build` (SQL) genera URLs con `/foro`.

**Tech Stack:** Next.js 16.4.1 (App Router, `proxy.ts`), Supabase (SQL), Vitest, pgTAP, Playwright.

**Spec:** decisión del usuario 2026-10-25 (memoria `multichain-public-decisions`): «`/` y `/en` siempre landing; el club entero bajo `/foro/...` incluidas las entradas (`/foro/login`, `/foro/invite/<código>`, `/foro/bienvenida`, `/foro/no-access`, `/foro/banned`); donaciones del club en `/foro/donar` y `/donar` pública; URLs antiguas 308 → `/foro/...`». Sustituye a D16 («miembro en `/` → foro»). Spec general: `docs/superpowers/specs/2026-10-24-base-arbitrum-y-parte-publica-design.md`.

## Global Constraints
- Ningún enlace ni redirección del club se escribe a mano: siempre `clubPath(...)` (o los builders que lo usan).
- Las URLs antiguas siguen funcionando: 308 a `/foro` + misma ruta + misma query (invitaciones ya compartidas, marcadores, notificaciones push ya entregadas).
- Sin cambios de comportamiento del club más allá del prefijo: mismos gates (sesión, membresía, bienvenida, baneo), mismos permisos, mismos 404.
- La parte pública (`/`, `/en/*`, `/herramientas`, `/pay`, `/donar`, `/start`, `/api/*`) no cambia de URL.
- El build no necesita secretos (`SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build` pasa).
- Ficheros CRLF: conservar finales de línea. Commits con los trailers de la sesión.

## Review Focus
1. **Un miembro con sesión abre `/`.** Ve la landing (no el foro) y en la cabecera tiene «Ir al foro» → `/foro`. Test en Task 1 y Task 4.
2. **Un enlace antiguo** (`/c/<id>?m=<msg>`, `/invite/<code>`, `/login?next=/c/x`, `/sorteos/<id>`): 308 a la misma ruta bajo `/foro` con la query intacta, y después el gate normal (login → vuelve a `/foro/...`). Test en Task 1.
3. **Tras iniciar sesión en el club** (login normal o invitación) se aterriza en `/foro` (o en `next` saneado), nunca en la landing. Test en Task 1.
4. **Notificación push** de una mención: su URL es `/foro/c/<canal>?m=…`. Test en Task 3.
5. **Ninguna ruta antigua queda enlazada** desde la UI: un test escanea `src` en busca de literales `"/c/`, `"/perfil"`, `"/settings"`… fuera de `src/lib/club/paths.ts` y de la tabla de redirecciones. Test en Task 2.

## Decisiones del constructor (rulings; coste si es incorrecta)
- **R1-R1** `/out` (aviso de enlace externo) se queda en la raíz: lo usan el club y potencialmente la parte pública. (Bajo.)
- **R1-R2** La frase SIWE firma `uri = origin + "/foro/login"` (club y conexión pública); GoTrue solo valida el dominio. (Bajo.)
- **R1-R3** `/donar` es siempre la página pública; el proxy deja de consultar la membresía para `/` y `/donar` (ya no hay doble sentido). Un miembro en `/donar` ve el enlace «Dona desde el club» → `/foro/donar`. (Bajo.)
- **R1-R4** Destino por defecto tras login del club y de `safeNextPath`/`onboarding/next-path` = `/foro` (antes `/`). La conexión pública sigue volviendo a su `next` (por defecto la landing). (Bajo.)
- **R1-R5** Segmentos antiguos con 308: `c, u, perfil, sorteos, dao, mercado, guia, invites, notifications, tickets, moderation, admin, settings, login, invite, no-access, banned, bienvenida` (y `/donar/...` con subruta, que era solo del club). `/donar` exacto NO se redirige (es la pública). (Medio: un segmento olvidado daría 404; cubierto por el test de APP_TOP_SEGMENTS y el de la tabla.)
- **R1-R6** `sw.js`: la URL por defecto de una notificación sin URL pasa a `/foro`. (Bajo.)
- **R1-R7** `/channel-not-found/404` (NOT_FOUND_PATH) se queda igual (es interna). (Bajo.)

---

### Task 1: Rutas del club bajo /foro, proxy y autenticación

**Files:**
- Create: `src/lib/club/paths.ts`
- Move: `src/app/(forum)` → `src/app/foro/(forum)`, `src/app/(gate)` → `src/app/foro/(gate)`, `src/app/(onboarding)` → `src/app/foro/(onboarding)` (con `git mv`)
- Modify: `src/proxy.ts`, `src/lib/i18n/public-routing.ts` (decidePublicRoute sin membresía, `LEGACY_CLUB_SEGMENTS`, `legacyClubRedirect`, `APP_TOP_SEGMENTS`), `src/lib/auth/public-paths.ts` (`PUBLIC_PREFIXES`: `/foro/login`, `/foro/invite`, `/foro/no-access`, `/foro/banned` en vez de los de raíz; `safeNextPath` por defecto `/foro` y rechaza `/foro/login*`), `src/lib/onboarding/{guard,next-path}.ts`, guards `src/lib/{channels,tickets,reports,market,treasury}/guard.ts`, `src/lib/permissions/settings-guard.ts`, `src/lib/auth/actions.ts` (redirectForStatus y redenciones), `src/app/foro/(gate)/login/complete/route.ts`, layouts de `(forum)` y `(onboarding)` (redirecciones), `src/components/auth/{login-panel,sign-out-button}.tsx`, `src/components/public/{public-connect,account-chip}.tsx` (uri `/foro/login`; «Ir al foro» → `/foro`), `src/components/public-donations/public-donate-panel.tsx` (miembro → `/foro/donar`), `src/lib/invites/actions.ts` (enlace `/foro/invite/<code>`), `src/lib/web3/siwe.ts` si fija la ruta
- Test: los tests unitarios existentes de proxy, gates, guards, public-paths, complete-login, login-complete-route, login-panel, app-top-segments, public-routing, onboarding (ajustar rutas) + nuevo `tests/unit/club/legacy-redirects.test.ts`

**Interfaces:**
- `CLUB_BASE = "/foro"`; `clubPath(path: string = "/"): string` (`"/"` → `"/foro"`, `"/c/x?m=1"` → `"/foro/c/x?m=1"`; idempotente si ya empieza por `/foro`).
- `legacyClubRedirect(pathname: string, search: string): string | null` — destino `/foro…` para un segmento de R1-R5 (y `/donar/<algo>`), `null` en otro caso (incluido `/donar` exacto y todo lo público).
- `decidePublicRoute(pathname)` sin estado de membresía: `/` → rewrite `/es`; `/donar` → rewrite `/es/donate`.

- [ ] **Step 1: Failing tests** — `legacyClubRedirect`: cada segmento de R1-R5 con y sin query → `/foro/...`; `/donar` → null; `/donar/x` → `/foro/donar/x`; `/herramientas`, `/en`, `/pay/x`, `/api/v1/x`, `/out` → null. Proxy: `/c/abc?m=1` → 308 `https://<origen público>/foro/c/abc?m=1` (usa `publicOrigin`), antes del gate; miembro en `/` → rewrite `/es` (Review Focus 1); anónimo en `/foro/c/x` → 302 `/foro/login?next=/foro/c/x`; bienvenida pendiente → `/foro/bienvenida?next=…`. Guards: reconocen `/foro/c/<id>`, `/foro/tickets/<id>`, etc., y ya no las rutas viejas. `completeLogin` activo → `/foro`; invitación con error → `/foro/invite/<code>?error=…`; `safeNextPath(null)` → `/foro`, `safeNextPath("/foro/login")` → `/foro`. **Review Focus 3**.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — `git mv` de las carpetas; ajustar todos los ficheros listados; `APP_TOP_SEGMENTS` = segmentos estáticos reales tras el movimiento (`foro`, `out`, `api`, …) — el test que escanea `src/app` debe seguir pasando; los segmentos antiguos ya no son rutas, los cubre `legacyClubRedirect` en el proxy antes de `isUnknownTopSegment`.
- [ ] **Step 4: Run** — unit + `SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build` — PASS.
- [ ] **Step 5: Commit** — `feat(club): el club vive bajo /foro y las URLs antiguas redirigen`

---

### Task 2: Enlaces, builders y revalidación

**Files:** Modify every club link in `src` listed by the inventory (sidebar, topbar, nav-link (activo `/foro`), channel-tree y right-rail (regex `^/foro/c/`), more-menu, settings-nav, home (quick-tiles, activity-list, continue-cards, home-sections, home-search), chat (message-item copiar enlace, chat-view, bounty-card, out-back-button → `/foro`), profile, reports, tickets, giveaways, members, treasury legacy, market, guide, onboarding, notifications bell/queries `hrefFor`, search (actions-list, search-results, command-palette), páginas del club con enlaces internos, `src/lib/home/queries.ts` messageHref, `src/lib/permissions/settings.ts`, `src/lib/market/row-data.ts`, `revalidatePath(...)` de todas las acciones (incl. `revalidatePath("/", "layout")` → `clubPath()` con `"layout"`), redirects de páginas legadas (`dao/*` → `/foro/donar`, `/foro/sorteos`), `public/sw.js` (fallback `/foro`). Los mocks de `/start` (`components/start/features.tsx`) muestran rutas: pasar a `/foro/...`.
- Test: ajustar tests unitarios afectados + nuevo `tests/unit/club/no-legacy-links.test.ts` (**Review Focus 5**): recorre `src/**/*.{ts,tsx}` y `public/sw.js` y falla si encuentra un literal que empiece por `"/c/`, `'/c/`, `` `/c/ `` o cualquiera de los segmentos de R1-R5 (`"/perfil"`, `"/settings`, `"/u/`, `"/sorteos`, `"/dao`, `"/mercado`, `"/guia`, `"/invites`, `"/notifications`, `"/tickets`, `"/moderation`, `"/admin`, `"/login`, `"/invite/`, `"/no-access`, `"/banned`, `"/bienvenida`, `"/donar/`) fuera de `src/lib/club/paths.ts` y `src/lib/i18n/public-routing.ts`.

- [ ] **Step 1: Failing test** `no-legacy-links` (lista los hallazgos actuales).
- [ ] **Step 2: Implement** — sustituir por `clubPath(...)`; `hrefFor` de notificaciones y el builder de búsqueda devuelven `/foro/...`.
- [ ] **Step 3: Run** — `pnpm lint`, `typecheck`, `test:unit` — PASS.
- [ ] **Step 4: Commit** — `refactor(club): todos los enlaces del club usan clubPath`

---

### Task 3: URLs de las notificaciones push (SQL)

**Files:** Create `supabase/migrations/20261025400001_push_urls_foro.sql` (`create or replace function public._push_build(p_id bigint)` copiada de su última definición en `20261024200006_giveaways.sql:819` con cada URL bajo `/foro`; `/dao/...` legados → `/foro/donar` y `/foro/sorteos/<id>`); `supabase/tests/r1_01_push_urls.test.sql`; Modify `src/lib/push/dispatch.ts` (comentario de rutas; `INTERNAL_URL_RE` ya admite `/foro/...`).

- [ ] **Step 1: Failing pgTAP** — para una mención, respuesta en hilo, propina, bounty, ticket, informe, miembro, sorteo ganado: `_push_build(id).url` empieza por `/foro/` y conserva `?m=`/`&thread=`/`&h=` (**Review Focus 4**); el resto de campos (title, body, tag) no cambia respecto a la definición anterior.
- [ ] **Step 2–3:** Implement → `pnpm db:test` PASS.
- [ ] **Step 4: Commit** — `feat(push): las notificaciones enlazan a /foro`

---

### Task 4: E2E, infraestructura, docs y verificación

**Files:** Modify `e2e/**/*.spec.ts` y `e2e/helpers/*.ts` (rutas `/foro/...`; `loginAs` firma `uri` `/foro/login`, entra por `/foro/login/complete` y espera `/foro`), `e2e/legacy/*` si siguen ejecutándose, `Dockerfile` (HEALTHCHECK `/foro/login`), `.github/workflows/preproduction.yml` (smoke `/foro/login`), `docs/deploy/{produccion,preproduccion-homelab}.md` (rutas de smoke), spec general (D16 sustituida por R1 + rulings), guía del club si cita URLs.
- Create: `e2e/r1-foro.spec.ts` — **Review Focus 1, 2, 3**: miembro en `/` ve la landing con «Ir al foro»; `/c/<id>?m=<msg>` → 308 → `/foro/c/<id>?m=<msg>`; `/invite/<code>` antiguo → `/foro/invite/<code>` y el canje funciona; login del club termina en `/foro`.

- [ ] **Step 1:** Ajustar e2e y helpers; escribir `r1-foro.spec.ts`.
- [ ] **Step 2: Verificación completa** — `pnpm lint`, `typecheck`, `test`, `db:test`, `test:e2e`, `E2E_PROD=1 pnpm test:e2e`, `SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build`.
- [ ] **Step 3: Commit** — `test(e2e): el club bajo /foro; infra y docs`
