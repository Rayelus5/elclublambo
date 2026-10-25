# P4 — Comprobador de tokens y enlaces + API x402 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Herramienta pública `/herramientas/comprobador` (EN `/en/tools/checker`): pegas un contrato de Base/Arbitrum o un enlace y obtienes un informe con alertas; más una API JSON (`/api/v1/check/token`, `/api/v1/check/link`) gratuita con límite por IP y, cuando se active, de pago por consulta con x402 (USDC en Base).

**Architecture:** Dos analizadores server-only. El de tokens combina RPC propio (código, metadatos ERC-20, proxy EIP-1967, `owner()`), Blockscout (verificación, creador, fecha), Sourcify como respaldo de verificación y DexScreener (liquidez); cualquier fuente caída se marca «desconocido», nunca «seguro». El de enlaces es puro (sin pedir la URL): dominio, punycode/homógrafos, lista permitida del club, parecidos, acortadores, http, IP literal, credenciales. Resultados de tokens cacheados con `"use cache"`. Límite por IP con el limitador de Postgres usando un sujeto HMAC de la IP. La API usa `@x402/next` (`withX402`) solo si `X402_ENABLED=true`.

**Tech Stack:** Next.js 16.4.1 (cacheComponents, route handlers), viem, `@x402/next` + `@x402/core` + `@x402/evm` 2.28.0 (y `@coinbase/x402` 2.1.0 solo para mainnet), Supabase, Vitest, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-base-arbitrum-y-parte-publica-design.md` (P4, D17, HACER A MANO 4 y 5). Base de P2/P3: rutas `(public)/[lang]`, `localizedPath`, `PublicHeader`, diccionarios, `src/lib/domains/validate.ts`, `needsHomographWarning` (`src/components/chat/out-view.tsx`), `allowed_domains`.

## Global Constraints
- **El comprobador informa, no certifica:** cada informe dice «No es asesoramiento financiero. Comprueba siempre por tu cuenta.». Una fuente que falla se muestra como «Desconocido» y nunca suma confianza.
- **Sin cobro real sin alta fiscal (D17, HACER A MANO 5):** x402 queda **desactivado por defecto** en todos los entornos (`X402_ENABLED` vacío). En PRE se activa en Base Sepolia (`eip155:84532`) con el facilitador público `https://x402.org/facilitator`. Producción mainnet exige además `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`; sin ellas, aunque `X402_ENABLED=true`, la API sigue gratis y lo registra.
- **El build no puede necesitar secretos** (lección del hotfix de P3): ninguna lectura con service role, RPC o API externa se ejecuta en el prerender; `SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build` debe pasar.
- **Nunca se pide la URL analizada** (sin SSRF): el análisis de enlaces es local.
- Llamadas externas server-side con `AbortSignal.timeout(5000)`, `User-Agent: ElClub-Checker/1 (+https://www.elclub.party)`; sin orígenes nuevos en la CSP (nada se pide desde el navegador).
- Límites por IP (Postgres, sujeto = HMAC-SHA256 de la IP con la clave de servicio, nunca la IP en claro): web `checker_web` 30/10 min; API gratis `api_free` 60/h.
- Rutas e i18n como P2/P3; páginas `instant = false`; la página con resultado (`?q=`) es `noindex`; la página vacía es indexable en producción.
- UI: `ui-ux-pro-max`; tokens; AA; 375–1920; ≥ 44 px; reduced motion.
- Tests: `pnpm test:unit` mientras el usuario prueba; `test`, `db:test`, e2e borran la BD local (autorizado). Ningún test llama a servicios externos reales: se simulan `fetch` y viem.

## Review Focus
1. **Una fuente externa caída o bloqueada (Cloudflare 403, timeout, 429).** El informe sale igual, con esa sección en «Desconocido» y sin alertas inventadas; la API devuelve `"status": "unknown"` en ese bloque. Test en Task 3.
2. **Un contrato que no es un token** (EOA, multisig, contrato sin `decimals`). El informe lo dice («No parece un token ERC-20» / «Es una dirección sin código») sin romper. Test en Task 3.
3. **Enlaces engañosos**: `https://xn--elclb-…` (punycode), `https://elclub.party.evil.io`, `https://e1club.party`, `http://`, `https://user:pass@host`, `https://1.2.3.4/`, acortadores. Cada caso tiene su alerta. Test en Task 4.
4. **Abuso de la API gratis y de la web**: la 31.ª consulta web en 10 min o la 61.ª de API en 1 h responde «Demasiadas consultas» / HTTP 429 con `Retry-After`; nunca un 500. Test en Task 2 y 6.
5. **x402 activado sin pago**: `GET /api/v1/check/token?...` sin cabecera de pago responde 402 con `PAYMENT-REQUIRED`; con la API desactivada responde 200 gratis. Un error del analizador no se cobra. Test en Task 6.

## Decisiones del constructor (rulings; coste si es incorrecta)
- **P4-R1 Fuentes:** RPC propio + Blockscout (`/api/v2/addresses`, `/api/v2/transactions`) + Sourcify (`https://sourcify.dev/server/v2/contract/{chainId}/{address}`) como respaldo de verificación + DexScreener `tokens/v1/{base|arbitrum}/{addr}`. Sin claves de pago. Etherscan descartado (requiere clave). (Medio: Blockscout mainnet devuelve desafío de Cloudflare desde algunas IPs; queda en «Desconocido» y Sourcify cubre la verificación.)
- **P4-R2 Alertas** (severidad alta/media/info): sin código (alta); no verificado (media); creado hace < 7 días (media); sin pares en DexScreener (media); liquidez < 10 000 USD (media); proxy actualizable (media); `owner()` no renunciado (info); marcado como scam por Blockscout (alta); ABI verificado con `mint`/`blacklist`/`setFee`-like (info). Testnets: DexScreener «no disponible en testnet». (Bajo: umbrales en constantes.)
- **P4-R3 Enlaces:** lista permitida del club como «Dominio conocido» (sin decir «seguro»); parecido = distancia de edición ≤ 2 o mismo esqueleto de confusables respecto a dominios conocidos y a una lista corta de marcas cripto (constante); acortadores en constante. (Bajo.)
- **P4-R4 Configuración x402 por variables de entorno** (`X402_ENABLED`, `X402_NETWORK`, `X402_PRICE`, `X402_PAY_TO`, `X402_FACILITATOR_URL`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`) en vez de `app_config`: cada entorno decide sin migración ni panel. `X402_PAY_TO` por defecto = Safe del club `0x380f2e12081995359e2Ab88E3c31c6b227904234`. Precio por defecto `$0.01`. (Bajo.)
- **P4-R5 `withX402` en el route handler** (no `paymentProxy`): solo se liquida si la respuesta es < 400, así un error no se cobra. (Bajo.)
- **P4-R6 IP de confianza:** `TRUSTED_IP_HEADER` (`cf-connecting-ip` en PRE, detrás del túnel); por defecto, la primera entrada de `x-forwarded-for` (Vercel la sobrescribe). Sin IP reconocible → sujeto `ip:unknown` compartido (más estricto). (Bajo.)
- **P4-R7 Caché:** informe de token cacheado 10 min por (red, dirección en minúsculas); la lista permitida 5 min. (Bajo: un token recién verificado tarda ≤ 10 min en reflejarse.)
- **P4-R8 Hub y landing:** el Comprobador pasa a activo; Avales sigue «Próximamente» hasta P5. (Bajo.)

## Mapa de rutas (amplía P2/P3)

| Ruta lógica | ES | EN | Interna |
|---|---|---|---|
| `checker` | `/herramientas/comprobador` | `/en/tools/checker` | `/{lang}/tools/checker` |
| `checkerApi` | `/herramientas/comprobador/api` | `/en/tools/checker/api` | `/{lang}/tools/checker/api` |

API (sin idioma, fuera del árbol público): `GET /api/v1/check/token?chain=<id>&address=<0x…>`, `GET /api/v1/check/link?url=<encoded>`. `PUBLIC_PREFIXES` gana `/api/v1`.

---

### Task 1: Rutas y prefijo público de la API

**Files:** Modify `src/lib/i18n/routes.ts`, `src/lib/auth/public-paths.ts`, `src/app/sitemap.ts`, `src/app/robots.ts`, diccionarios; Create marcadores `src/app/(public)/[lang]/tools/checker/page.tsx`, `tools/checker/api/page.tsx`; Test `tests/unit/i18n/routes.test.ts`, `tests/unit/start/start-proxy.test.ts` (o el test del gate), `e2e/p2-routing.spec.ts`.

- [ ] **Step 1: Failing tests** — filas del mapa en ambos sentidos; `isPublicPath("/api/v1/check/token")` true, `isPublicPath("/api/v1x")` false, `/api/cron` sigue público, cualquier otra `/api/*` no; sitemap incluye `checker` y `checkerApi`; robots permite `/herramientas/comprobador` y `/en/tools/checker`; e2e: anónimo en `/herramientas/comprobador` 200.
- [ ] **Step 2–4:** FAIL → Implement → PASS (`pnpm vitest run tests/unit/i18n tests/unit/start`, `pnpm test:e2e e2e/p2-routing.spec.ts`).
- [ ] **Step 5: Commit** — `feat(checker): rutas del comprobador y prefijo público de la API`

---

### Task 2: Límite de peticiones por IP

**Files:** Create `supabase/migrations/20261025300001_ip_rate_limits.sql`, `supabase/tests/p4_01_ip_rate_limits.test.sql`, `src/lib/rate-limit/ip.ts`; Test `tests/unit/rate-limit/ip.test.ts`.

**Interfaces:**
- SQL `public.ip_rate_limit_hit(p_subject text, p_bucket text) returns void` — **service_role**; `p_subject` debe empezar por `ip:` y medir ≤ 80; buckets permitidos `checker_web` (30, 10 min) y `api_free` (60, 1 h); otro → `invalid_input`; delega en `private.rate_limit` (que lanza `rate_limited`).
- TS: `clientIp(headers: Headers, env = process.env): string | null` (P4-R6); `ipSubject(ip: string | null, key = process.env.SUPABASE_SERVICE_ROLE_KEY): string` → `ip:<hex hmac 32>` o `ip:unknown`; `hitIpRateLimit(bucket: "checker_web" | "api_free", headers: Headers): Promise<"ok" | "rate_limited" | "error">` (admin client; un error de BD → `"error"`, el llamador decide fallar cerrado en la API y abierto en la web).

- [ ] **Step 1: Failing tests** — pgTAP: 30 golpes ok y el 31.º `rate_limited` en `checker_web`; bucket desconocido `invalid_input`; sujeto sin `ip:` `invalid_input`; `authenticated` y `anon` no pueden ejecutar. Unit: `x-forwarded-for: "1.2.3.4, 10.0.0.1"` → `1.2.3.4`; con `TRUSTED_IP_HEADER=cf-connecting-ip` usa esa cabecera; sin cabeceras → null → `ip:unknown`; el sujeto no contiene la IP y es estable para la misma clave.
- [ ] **Step 2–4:** FAIL → Implement → PASS (`pnpm db:test`, unit).
- [ ] **Step 5: Commit** — `feat(rate-limit): límite por IP con sujeto anónimo`

---

### Task 3: Analizador de tokens

**Files:** Create `src/lib/checker/token/{types,sources,alerts,analyze}.ts`; Test `tests/unit/checker/token-alerts.test.ts`, `tests/unit/checker/token-analyze.test.ts`.

**Interfaces:**
- `type Section<T> = { status: "ok"; data: T } | { status: "unknown"; reason: "timeout" | "blocked" | "rate_limited" | "error" | "unsupported" }`.
- `type TokenFacts = { chainId; address; code: Section<{ hasCode: boolean }>; erc20: Section<{ name; symbol; decimals; totalSupply: string } | null>; proxy: Section<{ isProxy: boolean; implementation: string | null }>; owner: Section<{ owner: string | null; renounced: boolean } | null>; verification: Section<{ verified: boolean; source: "blockscout" | "sourcify"; abiFlags: string[] }>; creation: Section<{ creator: string | null; createdAt: string | null; ageDays: number | null; isScam: boolean }>; market: Section<{ pairs: number; liquidityUsd: number | null; priceUsd: string | null; fdv: number | null; topPairUrl: string | null }> }`.
- `tokenAlerts(f: TokenFacts): Array<{ code; severity: "high" | "medium" | "info" }>` — pura, P4-R2; nunca alerta por una sección `unknown`.
- `analyzeToken(chain: ChainId, address: \`0x${string}\`): Promise<TokenReport>` (`{ facts, alerts, checkedAt }`) server-only, fuentes en paralelo con timeout; `getTokenReport(chain, address)` con `"use cache"` + `cacheLife` 10 min (solo se invoca en petición).
- Blockscout hosts: `base.blockscout.com`, `base-sepolia.blockscout.com`, `arbitrum.blockscout.com`, `arbitrum-sepolia.blockscout.com`; HTTP 403 con «Just a moment» → `blocked`. DexScreener solo mainnet; testnet → `unsupported`.

- [ ] **Step 1: Failing tests** (fetch y viem simulados) — **Review Focus 1**: Blockscout 403 → `verification`/`creation` `unknown/blocked`, Sourcify verificado → `verification ok (sourcify)`; DexScreener timeout → `market unknown/timeout` y sin alerta de liquidez; **Review Focus 2**: dirección sin código → alerta `no_code` alta y `erc20` `ok:null`; contrato sin `decimals` → `erc20 ok:null` («no es ERC-20»); proxy EIP-1967 con implementación → `proxy` true; `owner()` = 0x0 → `renounced`; edad 2 días → `new_contract`; liquidez 5 000 → `low_liquidity`; testnet → `market unsupported`.
- [ ] **Step 2–4:** FAIL → Implement → PASS.
- [ ] **Step 5: Commit** — `feat(checker): analizador de tokens con fuentes tolerantes a fallos`

---

### Task 4: Analizador de enlaces

**Files:** Create `src/lib/checker/link/{analyze,lists}.ts`, `src/lib/checker/link/allowed.ts` (lectura cacheada de `allowed_domains` con service role, 5 min); Test `tests/unit/checker/link-analyze.test.ts`.

**Interfaces:** `analyzeLink(input: string, known: readonly string[]): LinkReport` — pura: `{ ok: false; error: "invalid_url" } | { ok: true; url; host; hostUnicode; scheme; isKnown: boolean; alerts: Array<{ code: "punycode" | "lookalike" | "subdomain_trick" | "not_https" | "ip_host" | "credentials" | "shortener" | "unknown_domain"; severity; detail? }> }`. Reutiliza `normalizeDomain` y la lógica de homógrafos existente (`needsHomographWarning`). `getKnownDomains(): Promise<string[]>` (club + `CRYPTO_BRANDS` constante).

- [ ] **Step 1: Failing tests** — **Review Focus 3**: cada caso del Review Focus con su código; `https://github.com/x` conocido sin alertas salvo ninguna; entrada sin esquema `elclub.party` → se asume `https://`; `javascript:alert(1)` → `invalid_url`; longitud > 2048 → `invalid_url`.
- [ ] **Step 2–4:** FAIL → Implement → PASS.
- [ ] **Step 5: Commit** — `feat(checker): analizador de enlaces sin peticiones salientes`

---

### Task 5: Página del comprobador

**Files:** Modify `src/app/(public)/[lang]/tools/checker/page.tsx`, diccionarios (`checker`); Create `src/components/checker/{checker-form,token-report,link-report,alert-list}.tsx`; Test `tests/unit/checker/checker-page.test.tsx`.

**Interfaces:** página con formulario (`q` + red si es contrato; detecta dirección vs URL); con `?q=` el servidor (dentro de `<Suspense>`, tras `hitIpRateLimit("checker_web")` — si `rate_limited` muestra «Demasiadas consultas, espera unos minutos», si `error` continúa) muestra el informe: resumen con número de alertas por severidad, secciones con «Desconocido» explicado, enlaces a explorador y DexScreener, «Copiar enlace al informe», aviso de no-asesoramiento. Metadata: `noindex` si hay `q`.

- [ ] **Step 1: `ui-ux-pro-max`.** **Step 2: Failing tests** — un informe con secciones `unknown` muestra «Desconocido» y no muestra «Sin alertas» como garantía; `rate_limited` muestra el texto y no llama al analizador; EN sin cadenas ES; la dirección inválida muestra error junto al campo.
- [ ] **Step 3–5:** FAIL → Implement → PASS.
- [ ] **Step 6: Commit** — `feat(checker): página del comprobador de tokens y enlaces`

---

### Task 6: API JSON con x402 opcional

**Files:** Create `src/lib/checker/x402.ts`, `src/app/api/v1/check/token/route.ts`, `src/app/api/v1/check/link/route.ts`; Modify `package.json` (`@x402/next`, `@x402/core`, `@x402/evm` exactamente `2.28.0`; `@coinbase/x402` `2.1.0`), `.env.example`, `deploy/preprod/web.env.example`, `deploy/prod/vercel.env.example`, `docs/deploy/entornos.md`; Test `tests/unit/checker/api-token.test.ts`, `tests/unit/checker/api-link.test.ts`, `tests/unit/checker/x402-config.test.ts`.

**Interfaces:**
- `x402Config(env = process.env): { enabled: false; reason } | { enabled: true; network: "eip155:84532" | "eip155:8453"; price: string; payTo; facilitator: "public" | "cdp" }` — mainnet sin claves CDP → `{ enabled: false, reason: "missing_cdp_keys" }`; red no admitida → disabled.
- Route handlers `GET`: valida parámetros (400 `{ error }`); si x402 desactivado → `hitIpRateLimit("api_free")` (429 + `Retry-After: 3600` si limitado; si `error`, 503) y responde; si activado → handler envuelto con `withX402` (P4-R5). Respuesta: `{ version: 1, kind: "token" | "link", report, disclaimer }` con `Cache-Control: no-store`. Errores del analizador → 502 (no se cobra).
- Los clientes x402 se construyen perezosamente en la primera petición (nunca en el build).

- [ ] **Step 1: Failing tests** — **Review Focus 4**: con x402 desactivado, el limitador `rate_limited` → 429 con `Retry-After`; **Review Focus 5**: con `X402_ENABLED=true`, red `eip155:84532` y facilitador simulado, sin cabecera de pago → 402 con cabecera `PAYMENT-REQUIRED`; analizador que lanza → 502 y el facilitador no recibe `settle`; parámetros malos → 400; mainnet sin CDP → gratis.
- [ ] **Step 2–4:** FAIL → Implement → PASS; `SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build` pasa.
- [ ] **Step 5: Commit** — `feat(checker): API JSON con pago por consulta x402 opcional`

---

### Task 7: Página de la API, hub y landing

**Files:** Modify `src/app/(public)/[lang]/tools/checker/api/page.tsx`, `tools/page.tsx`, `src/components/landing/checker-demo.tsx`, `final-cta.tsx` si aplica, diccionarios; Test `tests/unit/checker/api-docs.test.tsx`, `tests/unit/public/tools-hub.test.tsx`, `tests/unit/landing/landing.test.tsx`.

- [ ] **Step 1: Failing tests** — la página de la API muestra los dos endpoints con ejemplos `curl`, el estado actual (gratis con límite / de pago con x402 en <red> y precio) leído de `x402Config()` en petición, y el aviso fiscal neutro («El cobro puede estar desactivado»); el hub enlaza el Comprobador a `checker` en ES/EN; la landing: el bloque del Comprobador ya no lleva «Próximamente» y su CTA va a `checker`; Avales sigue «Próximamente».
- [ ] **Step 2–4:** FAIL → Implement → PASS.
- [ ] **Step 5: Commit** — `feat(checker): página de la API y Comprobador activo en el hub y la landing`

---

### Task 8: E2E, verificación y documentación

**Files:** Create `e2e/p4-checker.spec.ts`; Modify spec (P4 «Hecho» + rulings + HACER A MANO), `playwright.config.ts` solo si hace falta un mock HTTP para Blockscout/Sourcify/DexScreener (patrón de `e2e/mock/drand.mjs` y `coingecko.mjs`).

- [ ] **Step 1: e2e** (fuentes externas simuladas con un mock local; nunca servicios reales) — anónimo comprueba un contrato del nodo local: informe con secciones, una sección «Desconocido» cuando el mock devuelve 403; un enlace punycode muestra su alerta; la API `GET /api/v1/check/link?url=…` devuelve 200 JSON; con el límite agotado (golpes sembrados en BD) devuelve 429; EN conserva la página.
- [ ] **Step 2: Verificación completa** — `pnpm lint`, `typecheck`, `test`, `db:test`, `test:e2e`, `E2E_PROD=1 pnpm test:e2e`, y **`SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build`**.
- [ ] **Step 3: Docs** — P4 «Hecho»; HACER A MANO: «Antes de activar x402 en producción: alta fiscal (punto 5) y claves CDP (`CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`) en Vercel con `X402_ENABLED=true` y `X402_NETWORK=eip155:8453`»; «Probar en PRE la API de pago con una wallet con USDC de Base Sepolia».
- [ ] **Step 4: Commit** — `test(e2e): comprobador y API; docs P4`
