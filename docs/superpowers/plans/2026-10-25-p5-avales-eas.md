# P5 — Avales EAS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Herramienta pública `/herramientas/avales` (EN `/en/tools/vouches`) donde cualquiera consulta los avales que ha recibido una dirección y, con sesión SIWE (miembro o cuenta pública), avala o retira su aval a otra dirección firmando él mismo una atestación EAS en Base; el perfil público `/pay/<x>` y el perfil del foro muestran los avales recibidos.

**Architecture:** Esquema EAS `uint8 kind` sin resolver y revocable, con UID calculado en código. El navegador firma `EAS.attest` / `EAS.revoke` con wagmi (Builder Code en Base). El servidor verifica el recibo con nuestro RPC (evento `Attested`/`Revoked` del contrato EAS con nuestro esquema, atestador = wallet de la sesión), relee `getAttestation(uid)` y guarda el resultado en una tabla propia `vouches` vía RPC de servicio; las lecturas públicas pasan por el servidor. Sin API GraphQL de EAS ni orígenes nuevos en la CSP. En el e2e, el nodo local 84532 recibe SchemaRegistry y EAS en sus direcciones de predeploy.

**Tech Stack:** Next.js 16.4.1 (cacheComponents, server actions), React 19, Tailwind v4, wagmi 3 / viem 2.57, Supabase (Postgres, pgTAP), Vitest, Playwright, Hardhat 2.29 (nodos locales), `@ethereum-attestation-service/eas-contracts` **1.9.0** (devDependency exacta; publicada 2026-05-18).

**Spec:** `docs/superpowers/specs/2026-10-24-base-arbitrum-y-parte-publica-design.md` (P5, D14, D15, D18, Requisitos transversales). Base de P2/P3/P4: rutas `(public)/[lang]`, `localizedPath`/`alternatesFor`, `getPublicSession`, `PublicConnectLazy`, `public_profiles` y `getPublicProfileView`, `hitRateLimit` / `hitIpRateLimit`, `chainClient`, `dataSuffixFor`, `useEnsureChain`, `e2e/chain/start-chain.mjs`.

## Global Constraints
- **Solo Base** (`chainForKey("base")`: 8453 en mainnet, 84532 en testnet). Arbitrum no tiene avales.
- **Direcciones EAS (predeploy OP Stack):** EAS `0x4200000000000000000000000000000000000021`, SchemaRegistry `0x4200000000000000000000000000000000000020`, iguales en Base y Base Sepolia. Fuente: `deployments/base/EAS.json`, `deployments/base/SchemaRegistry.json` y `deployments/base-sepolia/*.json` del paquete `@ethereum-attestation-service/eas-contracts@1.9.0` (comprobado 2026-10-25).
- **Esquema:** cadena exacta `uint8 kind`, resolver `0x0000000000000000000000000000000000000000`, `revocable = true`. UID = `keccak256(abi.encodePacked(schema, resolver, revocable))` = `0xb3d93d8e864b16464af09e79542423fc8c7b29f4aff58fc2dc39c48abf34279c` (calculado 2026-10-25 con viem; lo fija un test).
- **RGPD (D18):** on-chain solo `kind`; nada de texto libre ni handles. El vínculo dirección↔alias vive fuera de la cadena (`public_profiles`).
- **Firma el usuario, no ElClub.:** `attest({ schema: UID, data: { recipient, expirationTime: 0, revocable: true, refUID: 0x0…0, data: abi.encode(uint8 kind), value: 0 } })`; `revoke({ schema: UID, data: { uid, value: 0 } })`. En Base siempre `dataSuffix: dataSuffixFor(chain)` (D14).
- **Nada se toma del cliente salvo el hash:** `kind`, `recipient`, `attester`, `time`, `revocationTime` salen de `getAttestation(uid)`.
- **Sin avalarse a uno mismo:** bloqueado en la UI, en la acción y con un `check` en la tabla.
- **Nada del club en público (D15):** junto a un atestador no se muestra si es miembro; solo `@alias` de Pay o dirección corta.
- **El build no necesita secretos:** `SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build` debe pasar; `await connection()` antes de cualquier lectura con service role o RPC en una página.
- Páginas públicas `instant = false`; lecturas de petición (sesión, `searchParams`, BD, RPC) dentro de `<Suspense>`; metadata con `alternatesFor`; la página vacía de avales es indexable en producción, con `?address=` es `noindex`.
- Ninguna función nueva se concede a `anon` ni a `authenticated` salvo la lectura RLS de la tabla; escrituras solo por RPC `service_role` tras verificar.
- **Aviso en cada pantalla de avales:** «Un aval es público y permanente en la cadena. Puedes retirarlo, pero el historial queda. ElClub. no verifica identidades.»
- UI: `ui-ux-pro-max` antes de cada pantalla; tokens de `globals.css`, sin hex en componentes; un único relleno Base Blue (`--accent-fill`) por pantalla, en el CTA principal; enlaces en Cerulean (`--accent`); AA; 375–1920 sin scroll horizontal; objetivos ≥ 44 px; reduced motion.
- Textos cortos en español; diccionario inglés con paridad de claves (lo comprueba el test de diccionarios existente).
- El foro vive bajo `/foro`: todo enlace al club con `clubPath()`.
- Tests: `pnpm test:unit` mientras el usuario prueba; `pnpm test`, `db:test` y e2e borran la BD local (autorizado). Ningún test llama a una red real; viem se simula en unit.

## Review Focus
1. **El esquema no está registrado en la red** (antes del HACER A MANO, o en PRE con Base Sepolia sin registrar). La herramienta muestra «Los avales aún no están disponibles en esta red.» sin formulario ni transacción condenada; la consulta sigue funcionando. Test en Task 4 (y `isVouchSchemaRegistered` en Task 1).
2. **Un hash que no es un aval nuestro** (otro esquema, otro contrato, revertida, inexistente, de Arbitrum, firmada por otra wallet, pendiente). La acción responde un código propio y no escribe nada; pendiente → `pending` y el cliente reintenta. Test en Task 1 (verificador) y Task 3 (acción).
3. **Revocación hecha fuera de la app** (desde easscan u otra dApp). «Actualizar» relee la cadena y el aval desaparece de los recuentos; un uid que la cadena ya no conoce se borra. Test en Task 3 y e2e en Task 5.
4. **El mismo hash enviado dos veces o por dos pestañas.** Segunda vez `already: true`, una sola fila (uid único). Test en Task 2 (pgTAP) y Task 3.
5. **Varios avales del mismo atestador al mismo destinatario** (mismo `kind` dos veces, o un `kind` desconocido hecho fuera de la app). Los recuentos cuentan atestadores distintos por tipo; `kind` fuera de 1–3 se muestra como «Otro». Test en Task 2 (pgTAP) y Task 4 (componente).

## Decisiones del constructor (rulings; coste si es incorrecta)
- **P5-R1 Red:** solo Base y Base Sepolia, EAS y SchemaRegistry en las direcciones de predeploy (fuente arriba). La ABI usada (`attest`, `revoke`, `getAttestation`, `getSchema`, eventos `Attested`/`Revoked`) es idéntica en todas las versiones desplegadas (1.0–1.4). (Bajo: ampliar a Arbitrum sería otra tabla de direcciones y otro registro de esquema.)
- **P5-R2 Esquema y tipos:** `uint8 kind`, sin resolver, revocable; UID calculado y fijado por test. Tipos: `1` «Le conozco en persona» (`in_person`), `2` «Hemos trabajado juntos» (`worked_together`), `3` «Trato fiable (pagos o intercambios)» (`reliable_trade`). La app solo firma 1–3; cualquier otro valor leído de la cadena se guarda y se muestra como «Otro». (Bajo: añadir un tipo = una etiqueta i18n, sin migración.)
- **P5-R3 Registro del esquema a mano** (HACER A MANO) en base.easscan.org y base-sepolia.easscan.org. La app comprueba `SchemaRegistry.getSchema(UID).uid != 0`; si es cero, la herramienta muestra «no disponible en esta red». Resultado positivo cacheado 1 h (`"use cache"` + `cacheLife("hours")`), negativo sin caché. (Bajo.)
- **P5-R4 Firma:** la wallet del usuario firma `attest`/`revoke` con los valores de Global Constraints y el sufijo de Builder Code en Base. El calldata de más no rompe el decodificador ABI de Solidity (lo prueba el e2e con `bc_e2etest`). Revocar solo lo puede el atestador (lo exige EAS). (Bajo.)
- **P5-R5 Indexado propio:** tabla `vouches` rellenada tras verificar el recibo en el servidor (patrón de `verifyTransfer`). Basta con el recibo minado y `status = success`, sin esperar confirmaciones extra (Base reorganiza muy rara vez y «Actualizar» lo corrige). Lectura RLS pública de filas no revocadas (es dato público en cadena), sin escrituras de cliente; lectura de la app por RPC `service_role` (une el alias de `public_profiles`). (Bajo.)
- **P5-R5b «Actualizar» solo toca filas existentes:** relee `getAttestation(uid)`; revocada → `revoked_at`; inexistente (uid cero tras una reorganización) → se borra la fila; no indexa atestaciones hechas fuera de la app. (Bajo: un aval hecho fuera no aparece hasta que su atestador lo registre aquí; se puede ampliar sin migración.)
- **P5-R5c Límites:** escribir (registrar o revocar) `vouch_write` 30 / 10 min por sesión (`rate_limit_hit`, sujeto miembro o `u:`); «Actualizar» `vouch_refresh` 30 / 10 min por IP (`ip_rate_limit_hit`, no exige sesión). La consulta solo lee BD, sin límite. (Bajo.)
- **P5-R6 Quién avala:** cualquier sesión SIWE con `is_public_account()` (en el repo no existe `is_authenticated_wallet()`; la función equivalente de P2 es `is_public_account()`). Atestador mostrado como `@alias` (enlace a `/pay/<alias>`) o dirección corta (enlace a la herramienta con `?address=`). (Bajo.)
- **P5-R7 UI:** herramienta con consulta (sin sesión) + formulario de aval (con sesión) + «Tus avales» (dados, con «Retirar»); sección «Avales» en `/pay/<x>` con recuento de atestadores distintos por tipo, lista (máx. 50, más recientes primero) y enlace a easscan por uid (`https://base.easscan.org/attestation/view/<uid>`, `https://base-sepolia.easscan.org/attestation/view/<uid>`). En `/pay/<x>` el CTA de pago sigue siendo el único relleno; la sección de avales solo lleva enlaces (`outline` para «Avalar esta dirección»). La consulta acepta dirección o alias de Pay (resuelto con `getPublicProfileView`). (Bajo.)
- **P5-R8 Foro:** el perfil `/foro/u/<dirección|handle>` muestra un bloque pequeño de solo lectura «Avales recibidos» (recuento por tipo + enlace a la herramienta), porque la página ya tiene la dirección y la lectura es la misma RPC: coste ≈ un componente. (Bajo.)
- **P5-R9 E2E:** devDependency `@ethereum-attestation-service/eas-contracts` exactamente `1.9.0`; `start-chain.mjs` despliega SchemaRegistry y EAS desde `artifacts/contracts/*.sol/*.json`, copia su código de ejecución a `0x…20` / `0x…21` con `hardhat_setCode` y registra el esquema. Es correcto porque: SchemaRegistry no tiene inmutables salvo `Semver` (constantes) y su almacenamiento empieza vacío; EAS recibe `0x…20` en el constructor, así que su inmutable `_schemaRegistry` ya es la dirección del predeploy; el constructor de EAS no escribe almacenamiento; y el EIP712 de OpenZeppelin 5.3 recalcula el separador de dominio cuando `address(this) != _cachedThis`. El script lo comprueba (`getSchemaRegistry()` en `0x…21` = `0x…20`, `version()` = `1.4.0`, `getSchema(UID).uid` = UID). **Respaldo** solo si esto falla: `NEXT_PUBLIC_EAS_ADDRESS` / `NEXT_PUBLIC_EAS_REGISTRY_ADDRESS`, aceptadas únicamente con `networkSet() === "testnet"` y desplegando sin `setCode`. Riesgo conocido: el paquete declara `hardhat@2.23.0` como dependencia; pnpm lo aísla, pero el Step de instalación comprueba que `e2e/chain` sigue resolviendo `hardhat` 2.29.1. (Medio: si la dependencia anidada molesta, alternativa es copiar los dos JSON de artefactos a `e2e/chain/` como `mock-usdc.json`, con la versión de origen anotada.)
- **P5-R10 Landing:** la landing no tenía tarjeta de Avales; gana un bloque corto «Avales» tras el Comprobador (título, una línea, enlace `outline` «Ver avales» a `vouches`), sin relleno de marca (el CTA principal sigue siendo «Crear sorteo»). En el hub, Avales pasa a «Disponible» y enlaza. (Bajo.)

## Mapa de rutas (amplía P2–P4)

| Ruta lógica | ES | EN | Interna |
|---|---|---|---|
| `vouches` | `/herramientas/avales` | `/en/tools/vouches` | `/{lang}/tools/vouches` |

Query opcional `?address=<0x… | alias>`. `SEGMENTS` gana `vouches: { es: "avales", en: "vouches" }`.

---

### Task 1: Librería EAS — direcciones, esquema, codificación y verificación de recibos

**Files:**
- Create: `src/lib/vouches/eas.ts` (constantes y funciones puras, sin `server-only`: también las usa el cliente), `src/lib/vouches/eas-abi.ts` (ABI mínima escrita a mano), `src/lib/vouches/kinds.ts`, `src/lib/vouches/verify.ts` (`server-only`)
- Modify: `package.json` (devDependency `@ethereum-attestation-service/eas-contracts`: `1.9.0`), `pnpm-lock.yaml`
- Test: `tests/unit/vouches/eas.test.ts`, `tests/unit/vouches/eas-abi.test.ts`, `tests/unit/vouches/verify.test.ts`

**Interfaces:**
- Produces:
  - `type VouchChainId = 8453 | 84532`; `vouchChain(): VouchChainId` (= `chainForKey("base")`); `isVouchChain(n: unknown): n is VouchChainId`.
  - `EAS_ADDRESS`, `SCHEMA_REGISTRY_ADDRESS` (predeploy); `easAddresses(env = process.env): { eas: \`0x${string}\`; registry: \`0x${string}\` }` — respaldo P5-R9: las variables `NEXT_PUBLIC_EAS_ADDRESS` / `NEXT_PUBLIC_EAS_REGISTRY_ADDRESS` solo cuentan si `networkSet()` es `testnet` y son direcciones válidas.
  - `VOUCH_SCHEMA = "uint8 kind"`, `VOUCH_RESOLVER = zeroAddress`, `VOUCH_REVOCABLE = true`, `vouchSchemaUid(schema = VOUCH_SCHEMA, resolver = VOUCH_RESOLVER, revocable = VOUCH_REVOCABLE): \`0x${string}\``, `VOUCH_SCHEMA_UID`.
  - `encodeVouchData(kind: VouchKind): \`0x${string}\``; `decodeVouchData(data: \`0x${string}\`): number | null` (null si no decodifica como `uint8`).
  - `attestArgs(recipient: \`0x${string}\`, kind: VouchKind)` y `revokeArgs(uid: \`0x${string}\`)` → los `args` exactos de `writeContract` (Global Constraints).
  - `easscanUrl(chain: VouchChainId, uid: string): string`.
  - `kinds.ts`: `VOUCH_KINDS = [1, 2, 3] as const`, `type VouchKind`, `isVouchKind(n)`, `vouchKindKey(n: number): "in_person" | "worked_together" | "reliable_trade" | "other"`.
  - `eas-abi.ts`: `easAbi` (`attest`, `revoke`, `getAttestation`, `getSchemaRegistry`, eventos `Attested`, `Revoked`), `schemaRegistryAbi` (`getSchema`, `register`).
  - `verify.ts`:
    - `type OnchainAttestation = { uid; schema; attester; recipient; kind: number | null; time: Date; revokedAt: Date | null; revocable: boolean }`.
    - `readAttestation(chain: VouchChainId, uid, client = chainClient(chain)): Promise<OnchainAttestation | null>` (null si `uid` devuelto es cero).
    - `verifyVouchTx(input: { chain: VouchChainId; txHash; expect: "attest" | "revoke"; attester: string }, client = chainClient(chain)): Promise<{ status: "ok"; attestation: OnchainAttestation } | { status: "pending" } | { status: "error"; code: "tx_not_found" | "tx_failed" | "not_a_vouch" | "wrong_attester" | "rpc_unavailable" }>` — nunca lanza; comprueba `getChainId()`, recibo `success`, primer log `Attested`/`Revoked` emitido por `easAddresses().eas` con `schemaUID = VOUCH_SCHEMA_UID`, atestador del evento = `attester` (minúsculas), y relee `readAttestation`; para `revoke` exige además `revokedAt` no nulo. Sin recibo → `pending` (mismo `isNotFound` que `verify.ts` de pagos).
    - `isVouchSchemaRegistered(chain: VouchChainId, client = chainClient(chain)): Promise<boolean>` — lanza si la RPC falla (el llamador decide); variante cacheada `getVouchSchemaRegistered(chain)` con `"use cache"` que solo devuelve/cachea `true` (P5-R3).

- [ ] **Step 1: Instalar** `pnpm add -D -E @ethereum-attestation-service/eas-contracts@1.9.0`; comprobar `node -p "require(require.resolve('hardhat/package.json',{paths:['e2e/chain']})).version"` → `2.29.1` (P5-R9).
- [ ] **Step 2: Failing tests**
  - `eas.test.ts`: `vouchSchemaUid()` === `0xb3d93d8e864b16464af09e79542423fc8c7b29f4aff58fc2dc39c48abf34279c`; `EAS_ADDRESS`/`SCHEMA_REGISTRY_ADDRESS` iguales a `deployments/base/*.json` y `deployments/base-sepolia/*.json` del paquete; `decodeVouchData(encodeVouchData(2))` === 2; datos de 64 bytes o vacíos → null; `attestArgs` lleva `expirationTime: 0n`, `refUID` cero, `value: 0n`, `revocable: true`; `easscanUrl(84532, uid)` empieza por `https://base-sepolia.easscan.org/attestation/view/`; `easAddresses({ NEXT_PUBLIC_NETWORK_SET: "mainnet", NEXT_PUBLIC_EAS_ADDRESS: "0x…" })` ignora el override; `vouchKindKey(7)` === `"other"`.
  - `eas-abi.test.ts`: cada fragmento de `easAbi`/`schemaRegistryAbi` coincide (nombre, tipos de entrada/salida, `indexed`) con el de `artifacts/contracts/EAS.sol/EAS.json` y `SchemaRegistry.sol/SchemaRegistry.json` del paquete.
  - `verify.test.ts` (cliente viem simulado) — **Review Focus 2**: recibo ok con `Attested` de EAS y nuestro esquema → `ok` con `kind` de `getAttestation`, no del log; log de otro esquema → `not_a_vouch`; log de otra dirección que imita el evento → `not_a_vouch`; atestador distinto → `wrong_attester`; recibo `reverted` → `tx_failed`; `TransactionReceiptNotFoundError` → `pending`; `TransactionNotFoundError` sin recibo ni tx → `tx_not_found`; `getChainId` distinto → `rpc_unavailable`; `revoke` cuyo `getAttestation` aún no tiene `revocationTime` → `not_a_vouch`; `readAttestation` con uid cero → null; `isVouchSchemaRegistered` con `getSchema().uid` cero → false.
- [ ] **Step 3: Run** `pnpm vitest run tests/unit/vouches` — FAIL.
- [ ] **Step 4: Implement** con `keccak256(encodePacked(["string","address","bool"], …))`, `encodeAbiParameters([{ type: "uint8" }])` y `parseEventLogs({ abi: easAbi, logs, strict: true })` filtrando por `log.address`.
- [ ] **Step 5: Run** `pnpm vitest run tests/unit/vouches` y `pnpm typecheck` — PASS.
- [ ] **Step 6: Commit** — `feat(vouches): librería EAS con esquema fijado y verificación de recibos`

---

### Task 2: BD de avales — tabla, RPCs y límites

**Files:**
- Create: `supabase/migrations/20261025500001_vouches.sql`, `supabase/tests/p5_01_vouches.test.sql`

**Interfaces:**
- Produces:
  - `public.vouches(id uuid pk default gen_random_uuid(), chain_id int not null references public.chains check (chain_id in (8453, 84532)), uid text not null unique check (uid ~ '^0x[0-9a-f]{64}$'), attester text not null check (~ '^0x[0-9a-f]{40}$'), recipient text not null check (~ '^0x[0-9a-f]{40}$'), kind smallint not null check (kind between 0 and 255), tx_hash text not null check (~ '^0x[0-9a-f]{64}$'), attested_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now(), check (attester <> recipient))`; índices `(recipient) where revoked_at is null` y `(attester)`.
  - RLS on; `revoke all … from public, anon, authenticated`; `grant select … to anon, authenticated`; política `vouches_public_read for select to anon, authenticated using (revoked_at is null)`. Sin insert/update/delete para nadie salvo `service_role` vía RPC.
  - `record_vouch(p_chain_id int, p_uid text, p_attester text, p_recipient text, p_kind int, p_tx_hash text, p_attested_at timestamptz, p_revoked_at timestamptz) returns jsonb` — **service_role**; normaliza a minúsculas; `self_vouch` si atestador = destinatario; `invalid_input` en formatos; `on conflict (uid) do nothing` → `{ "already": true|false, "uid": … }`.
  - `apply_vouch_state(p_uid text, p_state text, p_revoked_at timestamptz) returns text` — **service_role**; `p_state` ∈ `active` (no cambia nada), `revoked` (`revoked_at = coalesce(revoked_at, p_revoked_at)`), `removed` (borra la fila); devuelve el estado aplicado o `not_found`.
  - `vouches_for(p_recipient text) returns jsonb` — **service_role**: `{ counts: [{ kind, attesters }], total: <atestadores distintos>, items: [{ uid, chainId, kind, attester, attesterAlias, attestedAt, txHash }] }` solo no revocadas; `attesters` = `count(distinct attester)` por `kind`; `items` máx. 50 por `attested_at desc`; `attesterAlias` de `public_profiles.wallet_address = attester` (null si no hay); dirección inválida → `invalid_input`.
  - `vouches_given_by(p_attester text) returns jsonb` — **service_role**: `[{ uid, chainId, kind, recipient, recipientAlias, attestedAt }]` no revocadas, máx. 50.
  - `vouch_attester(p_uid text) returns text` — **service_role** (la acción de revocar comprueba que el uid es del atestador de la sesión antes de escribir).
  - `public.rate_limit_hit` (redefinida con `create or replace`, copiando las ramas existentes `chain_verify` y `redeem_invite`) gana `vouch_write` 30 / 10 min.
  - `public.ip_rate_limit_hit` (redefinida igual, copiando `checker_web`, `api_free`, `api_paid_attempt`) gana `vouch_refresh` 30 / 10 min.

- [ ] **Step 1: Failing pgTAP** (plan explícito): `record_vouch` inserta y normaliza mayúsculas; **Review Focus 4**: mismo uid dos veces → `already: true` y una sola fila; atestador = destinatario → `self_vouch` (y el `check` lo impide también con insert directo como `service_role`); cadena 42161 → error; `vouches_for`: dos atestadores con kind 1 y uno repetido con kind 1 dos veces → `attesters = 2` para kind 1 (**Review Focus 5**); kind 9 aparece con `kind = 9`; una revocada no aparece ni cuenta; `attesterAlias` sale del perfil de Pay; `apply_vouch_state('revoked')` fija `revoked_at` y no lo cambia una segunda vez; `removed` borra; uid desconocido → `not_found`; `anon` lee por `select` solo filas no revocadas; `anon`/`authenticated` no pueden `insert`/`update`/`delete` ni ejecutar `record_vouch`, `apply_vouch_state`, `vouches_for`, `vouches_given_by`, `vouch_attester`; `rate_limit_hit('vouch_write')` 30 ok y el 31.º `rate_limited`; `ip_rate_limit_hit(…, 'vouch_refresh')` igual; las ramas antiguas de ambos limitadores siguen pasando (`990_rate_limits`, `p4_01_ip_rate_limits` intactos).
- [ ] **Step 2: Run** `pnpm db:test` — FAIL.
- [ ] **Step 3: Implement** la migración (todas las funciones `security definer`, `set search_path = ''`, grants explícitos como `20261025300001_ip_rate_limits.sql`).
- [ ] **Step 4: Run** `pnpm db:test` — PASS (todos los ficheros).
- [ ] **Step 5: Commit** — `feat(db): tabla de avales EAS con lectura pública y escrituras de servicio`

---

### Task 3: Acciones de servidor, hook de firma y EAS en la cadena local

**Files:**
- Create: `src/lib/vouches/types.ts`, `src/lib/vouches/actions.ts` (`"use server"`), `src/lib/vouches/queries.ts` (`server-only`), `src/lib/vouches/use-vouch-write.ts` (`"use client"`)
- Modify: `src/lib/rate-limit.ts` (`PreHitBucket` gana `"vouch_write"`), `src/lib/rate-limit/ip.ts` (`IpBucket` gana `"vouch_refresh"`), `e2e/chain/start-chain.mjs`, `e2e/chain/shared.mjs` (`VOUCH_SCHEMA`, `EAS_ADDRESS`, `SCHEMA_REGISTRY_ADDRESS`)
- Test: `tests/unit/vouches/actions.test.ts`, `tests/unit/vouches/queries.test.ts`, `tests/unit/vouches/use-vouch-write.test.tsx`, `tests/unit/vouches/chain-constants.test.ts`

**Interfaces:**
- Consumes: Task 1 (`verifyVouchTx`, `readAttestation`, `isVouchChain`, `vouchChain`, `getVouchSchemaRegistered`, `attestArgs`, `revokeArgs`, `easAddresses`, `easAbi`); Task 2 RPCs; `getPublicSession`, `hitRateLimit`, `hitIpRateLimit`, `createAdminClient`, `createServerClient`, `dataSuffixFor`, `useEnsureChain`.
- Produces:
  - `types.ts`: `VouchItem = { uid; chainId: VouchChainId; kind: number; attester: string; attesterAlias: string | null; attestedAt: string; txHash: string }`; `VouchesSummary = { total: number; counts: Array<{ kind: number; attesters: number }>; items: VouchItem[] }`; `GivenVouch = { uid; chainId; kind; recipient; recipientAlias: string | null; attestedAt }`; `VouchError = "not_authenticated" | "invalid_input" | "chain_unsupported" | "pending" | "tx_not_found" | "tx_failed" | "not_a_vouch" | "wrong_attester" | "self_vouch" | "not_found" | "rate_limited" | "rpc_unavailable" | "unknown"`.
  - `recordVouchAction(input: { chainId: number; txHash: string }): Promise<{ ok: true; uid: string; already: boolean } | { ok: false; error: VouchError }>` — sesión (`getPublicSession`) → `hitRateLimit(jwtClient, "vouch_write")` → `verifyVouchTx({ expect: "attest", attester: session.wallet })` → `record_vouch` con los datos leídos de la cadena → `revalidatePath` de la herramienta y de `/pay/*` en ES/EN (rutas internas).
  - `recordRevocationAction(input: { chainId: number; txHash: string })` → mismo tipo sin `already`; verifica `expect: "revoke"`, comprueba `vouch_attester(uid)` = sesión (si no existe la fila → `not_found`), `apply_vouch_state(uid, 'revoked', revokedAt)`.
  - `refreshVouchAction(uid: string): Promise<{ ok: true; state: "active" | "revoked" | "removed" } | { ok: false; error: "invalid_input" | "not_found" | "rate_limited" | "rpc_unavailable" | "unknown" }>` — sin sesión; `hitIpRateLimit("vouch_refresh", await headers())` (`error` → continúa, como la web del comprobador); la fila debe existir (P5-R5b); `readAttestation` → `apply_vouch_state`.
  - `queries.ts`: `getVouchesFor(recipient: string): Promise<VouchesSummary>` (lanza en error de lectura), `getVouchesGivenBy(attester: string): Promise<GivenVouch[]>`, `getVouchAvailability(): Promise<{ chainId: VouchChainId; registered: boolean | null }>` (`null` = RPC caída).
  - `useVouchWrite(): { attest(recipient: \`0x${string}\`, kind: VouchKind): Promise<\`0x${string}\`>; revoke(uid: \`0x${string}\`): Promise<\`0x${string}\`>; switching: boolean }` — `ensure(vouchChain())` antes de firmar; `useWriteContract` con `address: easAddresses().eas`, `abi: easAbi`, `chainId: vouchChain()`, `dataSuffix: dataSuffixFor(chain)` cuando exista.
  - `start-chain.mjs`: `prepareEas(rpcUrl)` solo para 84532, tras Multicall3.

- [ ] **Step 1: Failing tests**
  - `actions.test.ts` (Supabase, viem y sesión simulados): sin sesión → `not_authenticated`; `chainId` 42161 → `chain_unsupported`; hash mal formado → `invalid_input` sin llamar al limitador; `rate_limited` → no llama a la RPC de cadena; `pending` se propaga sin escribir; atestación con `recipient` = sesión → `self_vouch` sin escribir; ok → `record_vouch` recibe `kind`/`recipient`/`attested_at` de `getAttestation` aunque el cliente no los envíe; **Review Focus 4**: `already: true` se devuelve como `ok`; revocación de un uid ajeno → `wrong_attester`; revocación de uid sin fila → `not_found`; **Review Focus 3**: `refreshVouchAction` con `revocationTime` > 0 → `revoked`, con uid cero → `removed`, sin fila → `not_found`, IP limitada → `rate_limited`.
  - `queries.test.ts`: `getVouchesFor` mapea el JSON de la RPC; `getVouchAvailability` devuelve `registered: null` si la RPC lanza.
  - `use-vouch-write.test.tsx` (wagmi simulado): `attest` llama a `ensure(84532)` antes de `writeContractAsync`, con `functionName: "attest"`, args de `attestArgs` y `dataSuffix` con `NEXT_PUBLIC_BASE_BUILDER_CODE`; sin código, sin `dataSuffix`; `ensure` → false no firma.
  - `chain-constants.test.ts`: `VOUCH_SCHEMA`, `EAS_ADDRESS` y `SCHEMA_REGISTRY_ADDRESS` de `e2e/chain/shared.mjs` son iguales a los de `src/lib/vouches/eas.ts`.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/vouches` — FAIL.
- [ ] **Step 3: Implement** acciones, consultas y hook.
- [ ] **Step 4: Implement `prepareEas`** — artefactos con `require("@ethereum-attestation-service/eas-contracts/artifacts/contracts/SchemaRegistry.sol/SchemaRegistry.json")` (y `EAS.sol/EAS.json`); desplegar SchemaRegistry (`eth_sendTransaction` con `bytecode`) → `hardhat_setCode(SCHEMA_REGISTRY_ADDRESS, runtime)`; desplegar EAS con `encodeDeployData({ abi, bytecode, args: [SCHEMA_REGISTRY_ADDRESS] })` → `hardhat_setCode(EAS_ADDRESS, runtime)`; `register(VOUCH_SCHEMA, zeroAddress, true)` en `0x…20`; comprobaciones de P5-R9 (`getSchemaRegistry`, `version`, `getSchema(UID).uid`) que abortan el arranque si fallan. Ampliar el comentario de cabecera (paso 6).
- [ ] **Step 5: Run** `pnpm vitest run tests/unit/vouches`, `pnpm typecheck` — PASS; `node e2e/chain/start-chain.mjs` arranca y registra «EAS at 0x…21, schema 0xb3d9…» (cerrar con Ctrl+C).
- [ ] **Step 6: Commit** — `feat(vouches): registrar, revocar y actualizar avales verificados en el servidor; EAS en la cadena local`

---

### Task 4: Herramienta `/herramientas/avales` con rutas e i18n

**Files:**
- Modify: `src/lib/i18n/routes.ts` (`RouteKey` `"vouches"`, `SEGMENTS.vouches`, `ROUTES.vouches`, `isValidInternal`), `src/app/sitemap.ts`, `src/app/robots.ts`, `src/lib/i18n/dictionaries/es.ts` y `en.ts` (sección `vouches`)
- Create: `src/app/(public)/[lang]/tools/vouches/page.tsx`, `src/components/vouches/vouch-lookup.tsx` (formulario GET `?address=`), `src/components/vouches/vouch-summary.tsx` (recuento + lista, reutilizable, prop `compact`), `src/components/vouches/vouch-form.tsx` (`"use client"`), `src/components/vouches/given-vouches.tsx` (`"use client"`, «Retirar»), `src/components/vouches/refresh-button.tsx` (`"use client"`), `src/components/vouches/vouch-notice.tsx`
- Test: `tests/unit/i18n/routes.test.ts`, `tests/unit/vouches/vouch-summary.test.tsx`, `tests/unit/vouches/vouch-form.test.tsx`, `tests/unit/vouches/vouches-page.test.tsx`, `e2e/p2-routing.spec.ts` (ampliar)

**Interfaces:**
- Consumes: Task 1 (`VOUCH_KINDS`, `vouchKindKey`, `easscanUrl`); Task 3 (acciones, consultas, `useVouchWrite`); `getPublicSession`, `PublicConnectLazy`, `getPublicProfileView`, `ADDRESS_RE`/`ALIAS_RE` de `src/lib/pay`, `CopyButton`.
- Produces:
  - `localizedPath(lang, "vouches")` → `/herramientas/avales` | `/en/tools/vouches`; `toInternalPath("/en/herramientas/avales")` → null.
  - Diccionario `vouches`: `metaTitle`, `metaDescription`, `title` «Avales», `lead` «Respalda a quien conoces con una prueba pública en Base.», `lookup.{label, placeholder, submit, invalid, notFound}`, `kinds.{in_person, worked_together, reliable_trade, other}` (P5-R2), `summary.{title, empty «Esta dirección aún no tiene avales.», count, by, viewOnEasscan, refresh, refreshed}`, `form.{title, recipient, kind, submit «Avalar», self «No puedes avalarte a ti mismo.», already «Ya le avalas con este tipo.», signing, confirming, done, errors.<VouchError>}`, `given.{title, revoke «Retirar», revoking}`, `unavailable` «Los avales aún no están disponibles en esta red.», `notice` (Global Constraints), `connectLead`. `tools.metaDescription` sin «próximamente».
  - Página (`instant = false`; metadata con `alternatesFor("vouches", undefined, lang)`, `noindex` si hay `address`): cabecera + `VouchLookup` + aviso estático; dentro de `<Suspense>` (tras `await connection()`): con `?address=` válido (dirección o alias resuelto) → `VouchSummary` + `RefreshButton` por uid; sesión → si `getVouchAvailability().registered === false` el texto `unavailable` (y `null` → «No se pudo comprobar la red, prueba más tarde.»), si no `VouchForm` (destinatario precargado con la dirección consultada) y `GivenVouches`; sin sesión → `connectLead` + `PublicConnectLazy` en `outline`. El único relleno es «Avalar» (o, sin sesión, ninguno).
  - `VouchForm`: destinatario (0x…), tipo (radios de 44 px con las tres etiquetas), «Avalar» → `attest` → `recordVouchAction` con reintentos 1/2/4/8 s mientras `pending` (hash guardado en `localStorage` por destinatario, como el botón de premios de P2) → `router.refresh()`; destinatario = sesión → texto `self` y botón desactivado; error con su texto del diccionario.
  - `GivenVouches`: «Retirar» (`outline`) → `revoke(uid)` → `recordRevocationAction` con los mismos reintentos.

- [ ] **Step 1: `ui-ux-pro-max`** (herramienta de consulta + formulario; jerarquía con un solo relleno, recuentos por tipo legibles a 375 px, direcciones con `break-all`).
- [ ] **Step 2: Failing tests**
  - rutas: fila del mapa en ambos sentidos; sitemap incluye `vouches`; robots permite `/herramientas/avales` y `/en/tools/vouches`; e2e: anónimo en `/herramientas/avales` → 200 y `/en/tools/vouches` → 200.
  - `vouch-summary.test.tsx` — **Review Focus 5**: `counts` `[{kind:1,attesters:2},{kind:9,attesters:1}]` muestra «Le conozco en persona · 2» y «Otro · 1»; atestador con alias muestra `@alias` enlazado a `/pay/alias` y sin alias la dirección corta enlazada a `?address=`; cada fila enlaza a easscan; nunca aparece «Miembro»; vacío muestra el texto `empty`.
  - `vouch-form.test.tsx`: destinatario = wallet de la sesión → texto `self` y sin llamada a `attest`; dirección inválida → error junto al campo; ok → `attest(recipient, 2)` y luego `recordVouchAction({ chainId: 84532, txHash })`; `pending` reintenta y termina en `done`; `wrong_attester` muestra su texto.
  - `vouches-page.test.tsx` — **Review Focus 1**: `registered: false` → texto `unavailable` y sin formulario, y el resumen de la consulta sigue visible; sin sesión → `PublicConnect` y sin formulario; el aviso está en la página; EN sin cadenas ES (`Avalar`, `Retirar`).
- [ ] **Step 3: Run** `pnpm vitest run tests/unit/i18n tests/unit/vouches` — FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** unit + `pnpm lint` + `pnpm typecheck` + `pnpm test:e2e e2e/p2-routing.spec.ts` + `SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build` — PASS.
- [ ] **Step 6: Commit** — `feat(vouches): herramienta pública de avales`

---

### Task 5: Avales en los perfiles, hub y landing activos, e2e y documentación

**Files:**
- Modify: `src/components/pay/pay-page-content.tsx` (o `src/app/(public)/[lang]/pay/[target]/page.tsx`: sección en su propio `<Suspense>` tras el pago), `src/app/foro/(forum)/u/[address]/page.tsx`, `src/app/(public)/[lang]/tools/page.tsx`, `src/components/landing/landing.tsx`, diccionarios (`pay.page.vouches*`, `landing.vouches`, `tools.guarantees` → texto actualizado, bloque del foro en el diccionario/strings del club que use esa página)
- Create: `src/components/vouches/profile-vouches.tsx` (servidor: `await connection()`, `getVouchesFor`, `VouchSummary` + enlace `outline` «Avalar esta dirección» a `vouches?address=`), `src/components/profile/vouches-received.tsx` (bloque del foro: recuento por tipo + enlace a la herramienta), `src/components/landing/vouch-teaser.tsx`, `e2e/p5-vouches.spec.ts`
- Modify (docs): spec (P5 «Hecho» + rulings + HACER A MANO)
- Test: `tests/unit/vouches/profile-vouches.test.tsx`, `tests/unit/profile/vouches-received.test.tsx`, `tests/unit/public/tools-hub.test.tsx`, `tests/unit/landing/landing.test.tsx`

**Interfaces:**
- Consumes: Task 3 `getVouchesFor`; Task 4 `VouchSummary`, `localizedPath(lang, "vouches")`, diccionario `vouches`.
- Produces: `ProfileVouches({ lang, address })`; `VouchesReceived({ address, summary })` (foro, en español, sin acciones); `VouchTeaser({ lang, t })`. Un error de lectura en `ProfileVouches` muestra «No se pudieron cargar los avales» sin romper el pago.

- [ ] **Step 1: `ui-ux-pro-max`** (sección dentro de `/pay/<x>` sin competir con «Pagar»; bloque del foro con la densidad de `TipsReceived`; teaser de la landing con la estética de los bloques vecinos).
- [ ] **Step 2: Failing tests** — `/pay/<x>`: la sección «Avales» muestra los recuentos por tipo y la lista con enlaces a easscan; su enlace «Avalar esta dirección» es `outline` y «Pagar» sigue siendo el único `bg-accent-fill`; lectura que lanza → texto de error y el widget de pago sigue; foro: el bloque muestra «2 avales» y enlaza a `/herramientas/avales?address=<dirección>`, sin nada si `total = 0`; hub: Avales con estado «Disponible» y `href` a `vouches` en ES y EN; landing: el teaser enlaza a `vouches` y no lleva «Próximamente» ni `bg-accent-fill`.
- [ ] **Step 3–4:** FAIL → Implement → PASS (`pnpm vitest run tests/unit/vouches tests/unit/profile tests/unit/public tests/unit/landing`).
- [ ] **Step 5: e2e `p5-vouches`** (wallets de test, nodo 84532 con EAS de Task 3):
  1. Anónimo en `/herramientas/avales?address=<B>` ve «Esta dirección aún no tiene avales.» y el aviso.
  2. Wallet A conecta (`signInPublic`), consulta B, elige «Hemos trabajado juntos», «Avalar» → la lista de B muestra el aval con la dirección corta de A y un enlace a `base-sepolia.easscan.org`; «Tus avales» lo lista; la transacción enviada termina en el sufijo ERC-8021 de `bc_e2etest` (se lee la tx del nodo).
  3. A intenta avalarse a sí mismo → texto `self`, sin firma.
  4. A crea perfil de Pay con alias; `/pay/<B>` muestra la sección «Avales» con `@alias` de A como atestador.
  5. **Review Focus 3**: A revoca **fuera de la app** (`walletClient.writeContract` directo al nodo con `revoke`); `/pay/<B>` aún lo muestra; «Actualizar» en la herramienta → desaparece de los recuentos.
  6. A avala de nuevo y lo retira desde «Tus avales» → desaparece.
  7. El cambio ES/EN conserva `/en/tools/vouches?address=<B>`; sin errores de consola ni violaciones de CSP (`watchCsp`).
- [ ] **Step 6: Verificación completa** — `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:test`, `pnpm test:e2e`, `E2E_PROD=1 pnpm test:e2e`, y **`SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build`**: todo en verde o documentado. Capturas a 375 y 1440 px de `/herramientas/avales` (con y sin sesión) y `/pay/<dirección>` para revisar el relleno único y el scroll horizontal.
- [ ] **Step 7: Docs** — P5 «Hecho» en el spec con rulings P5-R1…P5-R10 y lo que salga al cerrar. HACER A MANO (nuevo punto): «⚠️ Registrar el esquema de avales en **base.easscan.org** y **base-sepolia.easscan.org** (Schemas → Create): cadena exacta `uint8 kind`, sin resolver (`0x0000000000000000000000000000000000000000`), revocable = sí. El UID resultante debe ser `0xb3d93d8e864b16464af09e79542423fc8c7b29f4aff58fc2dc39c48abf34279c`; si easscan dice que ya existe, no hay nada que hacer. Hasta entonces la herramienta muestra "no disponible en esta red".» y «Probar en PRE: avalar una dirección desde una wallet sin invitación, verla en `/pay/<dirección>` y retirarla.»
- [ ] **Step 8: Commit** — `feat(vouches): avales en los perfiles, hub y landing; e2e y docs P5`
