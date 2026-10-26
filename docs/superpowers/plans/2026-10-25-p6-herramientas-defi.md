# P6 — Más herramientas DeFi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tres herramientas públicas nuevas en el hub: «Aprobaciones» (`/herramientas/aprobaciones`, EN `/en/tools/approvals`), donde ves los permisos ERC-20 vivos de cualquier dirección y los retiras firmando `approve(spender, 0)`; «Envío múltiple» (`/herramientas/envio-multiple`, EN `/en/tools/multisend`), para enviar USDC a un máximo de 20 direcciones, con la calculadora «Repartir gastos»; y «Gas» (`/herramientas/gas`, EN `/en/tools/gas`), con el coste por red de las acciones típicas y un conversor de unidades.

**Architecture:** Toda lectura externa ocurre en el servidor. Los permisos se descubren con el `getLogs` de Blockscout (el mismo host y los mismos overrides de testnet que el comprobador). Las asignaciones vigentes se leen con `multicall` en nuestro RPC, tras el límite por IP. El gas se lee con nuestro RPC, con caché de 15 s: tarifa base, propina, la parte de L1 por el `GasPriceOracle` de Base o el `NodeInterface` de Arbitrum, y el precio ETH/USD de Chainlink. La wallet del usuario firma cada transacción (`approve`, `transfer`, `wallet_sendCalls`), con el Builder Code en Base. No hay contrato propio, ni custodia, ni comisión, ni tablas nuevas: la BD solo gana un bucket de límite. «Repartir gastos» es puro cliente y guarda su estado en el fragmento de la URL. En el e2e, el mock de Blockscout responde `getLogs` con los logs reales del nodo local, y los nodos ganan oráculos de gas de prueba.

**Tech Stack:** Next.js 16.4.1 (cacheComponents, server actions, `"use cache"`), React 19, Tailwind v4, wagmi 3.7.7 (`useCapabilities`, `useSendCalls`, `useWaitForCallsStatus`) / viem 2.57.7, Supabase (pgTAP), Vitest, Playwright, Hardhat 2.29. Sin dependencias nuevas: la compresión usa `CompressionStream` del navegador.

**Spec:** `docs/superpowers/specs/2026-10-24-base-arbitrum-y-parte-publica-design.md` (P6, D14, D15, D16, Requisitos transversales, reparto de colores de R2). Se apoya en lo construido en P2–P5:
- rutas `(public)/[lang]`, `localizedPath` y `alternatesFor`;
- `getPublicSession` y `PublicConnectLazy`;
- `hitIpRateLimit` y `checkerSources` / `getJson` (`src/lib/checker/token/sources.ts`);
- `chainClient`, `chainForKey`, `networkSet`, `dataSuffixFor`, `useEnsureChain`, `readAssetBalance`, `parseAmount` / `formatAmount`;
- `readEthUsd` (`src/lib/economy/eth-price.ts`) y `buildPayUrl`;
- `useSessionWalletMatch` de P5;
- `e2e/chain/start-chain.mjs`, `e2e/mock/checker.mjs` y `e2e/helpers/wallet.ts`.

## Global Constraints
- **Rama:** `feature/p6-herramientas-defi` desde `develop` **con P5 fusionado**, porque Task 1 generaliza `useSessionWalletMatch`.
- **Redes:** Base y Arbitrum del juego del entorno (`chainForKey("base")`, `chainForKey("arbitrum")`: 8453/42161 en mainnet, 84532/421614 en testnet). Ninguna otra red recibe transacciones.
- **Builder Code (D14):** toda transacción en Base lleva `dataSuffix: dataSuffixFor(chain)`. En Arbitrum no se añade nada, y sin código tampoco.
- **ElClub. no toca fondos:** cada herramienta muestra `common.noCustody`. No hay contrato propio, aprobación a ElClub. ni comisión.
- **Firma solo el dueño:** «Retirar» y «Enviar» exigen que la wallet conectada sea la dirección afectada. Si hay sesión SIWE (`getPublicSession()`), también tiene que ser la wallet de la sesión.
- **Sin orígenes nuevos en la CSP:** Blockscout, el RPC y Chainlink se leen desde el servidor. El navegador solo habla con la wallet y con los transportes de wagmi que ya existen. Ethereum L1 no recibe RPC propio (P6-R5).
- **El build no necesita secretos:** `SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build` debe pasar. Hay que llamar a `await connection()` antes de cualquier lectura de RPC, Blockscout o BD en una página.
- **Páginas públicas:**
  - `instant = false`;
  - las lecturas de petición (`searchParams`, sesión, RPC) van dentro de `<Suspense>`;
  - metadata con `alternatesFor`;
  - las tres páginas vacías son indexables en producción; las aprobaciones con `?address=` son `noindex`.
- **Colores (R2):**
  - un único relleno `bg-accent-fill` (Base Blue) por pantalla, en el CTA principal;
  - enlaces, foco y chips seleccionados en Cerulean (`--accent`);
  - sin hex en componentes.
- **UI:** `ui-ux-pro-max` antes de cada pantalla; AA; 375–1920 px sin scroll horizontal (direcciones con `break-all`, tablas apiladas en móvil); objetivos ≥ 44 px; reduced motion.
- **Textos:** cortos en español; el diccionario inglés mantiene la paridad de claves (`tests/unit/i18n/dictionaries.test.ts`). Un importe es «aprox.» siempre que lo sea.
- **Tests:**
  - `pnpm test:unit` mientras el usuario prueba;
  - `pnpm test`, `db:test` y el e2e borran la BD local (autorizado);
  - ningún test llama a una red real: viem y `fetch` se simulan en unit;
  - solo wallets de prueba (Hardhat).

## Review Focus
1. **La lista de Blockscout no llega** (403 de Cloudflare, timeout, `status: "0"` con error, o 1 000 resultados: el tope de la API). La página dice «No se pudo obtener la lista completa; pega un token y un spender para comprobarlo», muestra el formulario manual, y con un tope alcanzado avisa de que la lista es parcial. Nunca dice «Sin permisos». Test en Task 2 y Task 3.
2. **La wallet conectada no es la dirección consultada,** o no coincide con la de la sesión SIWE. Se puede ver todo, pero «Retirar» y «Enviar» quedan desactivados con el motivo y nunca se pide firmar. Test en Task 1 (hook), Task 3 y Task 4.
3. **Una lista pegada con problemas:**
   - duplicados con distinta capitalización;
   - coma decimal (`0x…,12,5`);
   - más de 6 decimales;
   - 0 o un importe negativo;
   - la dirección cero o la del contrato de USDC;
   - 21 líneas;
   - un total mayor que el saldo.

   Cada caso tiene su error o aviso por línea, y «Enviar» no se habilita mientras haya errores. Test en Task 4.
4. **Envío secuencial interrumpido** (pestaña cerrada, firma rechazada o tx revertida en la 2.ª de 3). Al volver con la misma lista y la misma wallet, las filas ya enviadas aparecen con su hash y «Continuar» envía solo las que faltan. Nunca se paga dos veces la misma fila. Test en Task 4.
5. **Una fuente del gas caída** (oráculo de L1 que revierte, Chainlink obsoleto o RPC de una red caída). Esa red o esa columna muestra «—» con su motivo y el resto de la tabla sale igual. Sin precio, el conversor deja USD desactivado. Test en Task 1.

## Decisiones del constructor (rulings; coste si es incorrecta)
- **P6-R1 Alcance:**
  - tres herramientas bajo el hub: Aprobaciones, Envío múltiple (con «Repartir gastos» como segunda sección de la misma página, ancla `#repartir`) y Gas;
  - Base y Arbitrum del juego del entorno;
  - Builder Code solo en Base;
  - los permisos NFT (`ApprovalForAll`) quedan fuera de v1 y se anotan en el backlog del spec.

  (Bajo: Repartir gastos podría tener ruta propia después sin cambiar su lógica.)
- **P6-R2 Descubrimiento de permisos por la API RPC de Blockscout** (`/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&topic0=<Approval>&topic1=<owner con relleno a 32 bytes>&topic0_1_opr=and`):
  - **Por qué no la v2:** no hay endpoint v2 de aprobaciones. `/api/v2/addresses/{addr}/logs` lista los logs *emitidos por* un contrato, no los que tienen al dueño como tema, y el «Token Approval Tracker» de Blockscout es una app de la interfaz, no una API.
  - **Por qué `getLogs` sirve:** acepta temas sin `address`. El controlador exige `fromBlock`, `toBlock` y al menos uno de `address`/`topic0..3`, y exige `topicX_Y_opr` cuando hay dos temas.
  - **Tope:** como mucho 1 000 resultados.
  - **Fuentes:** docs.blockscout.com/devs/apis/rpc/logs y `apps/block_scout_web/lib/block_scout_web/controllers/api/rpc/logs_controller.ex` (rama `master`), consultadas el 2026-10-25.
  - **Host:** el de `checkerSources(chain).blockscout`, con los mismos overrides `CHECKER_BLOCKSCOUT_BASE_<chainId>` (solo en testnet).
  - **Resultado:** pares (token = `log.address`, spender = `topics[2]`) únicos.

  (Medio: en mainnet Blockscout puede responder con un desafío de Cloudflare o tardar más de 5 s con una dirección muy activa. Entonces se usa el respaldo manual. Si en PRE falla a menudo, la alternativa es un `eth_getLogs` por tramos en nuestro RPC, sin migración.)
- **P6-R2b Lectura vigente:**
  - `multicall` (Multicall3, `allowFailure: true`) de `allowance(owner, spender)`, `symbol()`, `decimals()` y `getCode(spender)`, solo de los pares descubiertos, hasta `MAX_PAIRS = 200` (con más, aviso de lista parcial);
  - solo se listan asignaciones > 0;
  - «Ilimitada» si es ≥ 2^255;
  - el spender se etiqueta con una lista corta de conocidos;
  - un spender desconocido sale como «Desconocido»;
  - un spender sin código sale como «Cuenta normal (no es un contrato)», con aviso medio, porque una aprobación a una cuenta normal es el patrón típico de una estafa;
  - un token cuyo `allowance` revierte se omite.

  (Bajo.)
- **P6-R2c Spenders conocidos** (constante por red, direcciones comprobadas en la fuente oficial al implementar, con la fecha en un comentario y fijadas por test): Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3` (las cuatro redes), Uniswap Universal Router y SwapRouter02 (Base, Arbitrum; docs.uniswap.org «Deployments»), 1inch Aggregation Router v6 `0x111111125421cA6dc452d289314280a0f8842A65` (portal de 1inch), 0x AllowanceHolder (docs de 0x) y el Router de Aerodrome (solo Base; repositorio de Aerodrome). Una dirección que no se pueda comprobar en la fuente oficial no entra en la lista. (Bajo: una etiqueta que falta solo deja «Desconocido».)
- **P6-R2d Quién ve y quién firma:**
  - ver no exige sesión: cualquiera consulta cualquier dirección, porque es dato público;
  - «Retirar» exige wallet conectada = dueño y, con sesión SIWE, sesión = dueño;
  - la firma es `approve(spender, 0n)` en el contrato del token, en la red de la consulta, con el Builder Code en Base (el decodificador ABI de Solidity ignora los bytes de más; lo prueba el e2e con el USDC de prueba);
  - tras el recibo, la fila se vuelve a comprobar con `checkAllowanceAction` y desaparece si la asignación es 0;
  - la lista entera se refresca con `router.refresh()`.

  (Bajo.)
- **P6-R2e Límite:** nuevo bucket IP `approvals_scan` de 30 por 10 min en `ip_rate_limit_hit`. Cada carga de la lista y cada comprobación manual cuenta un golpe. Un `"error"` del limitador deja pasar la consulta, como en la web del comprobador. Sin caché de la lista: tras retirar un permiso, la siguiente carga tiene que verlo a 0. (Bajo.)
- **P6-R3 Envío múltiple:**
  - **Qué y a cuántos:** solo USDC de Circle (`NETWORKS[chain].usdc`), Base por defecto y Arbitrum elegible, hasta 20 destinatarios.
  - **Formato de las líneas:**
    - una línea por destinatario: la dirección (42 caracteres), un separador (`,`, `;`, tabulador o espacios) y el importe;
    - el importe es el resto de la línea y admite coma decimal, así que `0x…,12,5` = 12,5;
    - se valida con `parseAmount(…, "USDC")`.
  - **Validación:**
    - errores que bloquean: importe > 0, dirección cero, dirección del contrato de USDC, más de 20;
    - duplicados: se suman con un aviso (la comparación es en minúsculas);
    - el total debe caber en el saldo de USDC (`readAssetBalance`), y además debe quedar ETH para el gas (`useBalancePreflight`).
  - **Envío atómico** cuando `useCapabilities({ chainId })` da `atomic.status` `supported` o `ready`: un solo `sendCalls({ calls, forceAtomic: true })`. El Builder Code va **en cada llamada** (`dataSuffix` por call; viem 2.57 lo concatena al calldata en el cliente, `actions/wallet/sendCalls.ts`), no como capacidad, porque una wallet podría ignorar la capacidad. El resultado se espera con `useWaitForCallsStatus`.
  - **Envío secuencial** en cualquier otro caso, incluido el error de `wallet_getCapabilities` (lo que pasa con la wallet del e2e):
    - `transfer` uno a uno con `useSendTransfer`, esperando cada recibo;
    - lista de progreso con el hash de cada fila;
    - el progreso se guarda en `localStorage` bajo la clave `elclub:multisend:<chainId>:<owner>:<hash de la lista normalizada>`;
    - «Continuar» salta las filas con recibo `success`.
  - Siempre hay una confirmación explícita antes de firmar.

  (Medio: si una wallet anuncia `atomic` y luego falla, el error se muestra y se ofrece «Enviar una a una»; no se reintenta en automático para no duplicar.)
- **P6-R4 Repartir gastos:**
  - **Estado:** en el **fragmento** de la URL (`#gastos=<v1.base64url(deflate-raw(JSON))>`, con `CompressionStream`). Sin compresión, `#gastos=<j1.base64url(JSON)>`. Se elige el fragmento frente a `localStorage` por tres motivos:
    - se comparte con un enlace, que es lo que pide un reparto;
    - no llega al servidor ni a sus registros ni al `Referer`;
    - no deja datos personales guardados en el dispositivo.
  - **Límites:** hasta 20 participantes, nombre ≤ 24 caracteres e importes en USDC de 6 decimales.
  - **Cálculo:**
    - cuota igual con el resto repartido por unidades mínimas a los primeros participantes en orden;
    - saldos pagado − cuota;
    - liquidación voraz: el mayor deudor paga al mayor acreedor, como mucho n − 1 transferencias (el mínimo exacto es NP-difícil; el voraz basta y es determinista).
  - **Salida por transferencia:**
    - si el acreedor tiene dirección o alias: enlace de ElClub Pay (`buildPayUrl` con `amount` y `asset: "USDC:<chain de Base>"`);
    - si el usuario marca «Soy yo» en un deudor: «Enviar con envío múltiple», que lleva sus transferencias a la sección de arriba (`#envio=<base64url de las líneas>`).

  (Bajo: los enlaces antiguos siguen abriéndose gracias al prefijo de versión.)
- **P6-R5 Gas:**
  - **Lectura** en el servidor por red: `getBlock()` → `baseFeePerGas` y `estimateMaxPriorityFeePerGas()`, que da 0 en Arbitrum. Precio efectivo = base + propina.
  - **Acciones con gas fijo** (constantes): transferencia de ETH 21 000, transferencia ERC-20 65 000, swap 180 000 y mint de NFT 120 000. Cada acción lleva además un tamaño de calldata representativo: 0, 68, 516 y 164 bytes.
  - **Parte de L1:**
    - **Base:** `GasPriceOracle` (`0x420000000000000000000000000000000000000F`) `getL1FeeUpperBound(calldataBytes + 110)`. La función existe desde Fjord y Base ya está en Fjord. Es una cota superior; el contrato suma 68 bytes de firma (`GasPriceOracle.sol` de `ethereum-optimism/optimism`, `packages/contracts-bedrock/src/L2/`).
    - **Arbitrum:** `NodeInterface` (`0x00000000000000000000000000000000000000C8`) `gasEstimateL1Component(to, false, data)` con datos de relleno deterministas del tamaño representativo. Su `gasEstimateForL1` se suma a las unidades de L2 (docs.arbitrum.io, «NodeInterface reference»).
    - Si la llamada falla, la celda muestra el coste de L2 con la marca «sin la parte de L1».
    - Todo se rotula «aprox.».
  - **Ethereum L1:** solo como referencia, **sin RPC nuevo**: `GasPriceOracle.l1BaseFee()` de Base × unidades de gas, rotulado «Ethereum (solo tarifa base, referencia)».
  - **USD:** `readEthUsd(chainForKey("base"))` de Chainlink. Sin precio, USD = «—».
  - **Caché:** `"use cache"` con `cacheLife({ stale: 15, revalidate: 15, expire: 60 })` por red. Sin límite por IP, porque la caché acota las llamadas.
  - **Conversor:** wei / gwei / ETH / USD, puro cliente, con el precio que pasa el servidor.

  (Medio:
  - la cota superior de Base puede doblar la parte de L1 real, que son fracciones de céntimo, así que no cambia una decisión;
  - si se usara `getL1Fee` exacto haría falta serializar una tx de muestra, que es más código y no aporta precisión, porque la tx es hipotética;
  - en Arbitrum, con calldata de relleno no comprimible se sobrestima un poco, que es el lado seguro.)
- **P6-R5b Oráculos de prueba en los nodos locales:**
  - el nodo 84532 recibe con `hardhat_setCode` en `0x…0F` un runtime escrito a mano que devuelve una palabra fija (`GAS_ORACLE_WORD = 2_000_000_000`) para cualquier selector;
  - el nodo 421614 recibe en `0x…C8` un runtime que devuelve tres palabras: `NODE_INTERFACE_L1_GAS = 1000`, 0 y 0;
  - es el mismo truco que el `0x00` de la Safe, sin Solidity ni artefactos.

  (Bajo: solo e2e.)
- **P6-R6 Hub y landing:**
  - el hub gana tres `ToolCard` activas: Aprobaciones (`ShieldOff`), Envío múltiple (`Send`) y Gas (`Fuel`);
  - la landing gana **un** bloque corto «Más herramientas» tras el teaser de Avales: título, una línea con las tres y enlace `outline` al hub;
  - sin relleno Base Blue nuevo: el CTA principal sigue siendo «Crear sorteo».

  (Bajo.)
- **P6-R7 Precio ETH:** Chainlink (`readEthUsd`) en vez de CoinGecko, aunque la orden decía «CoinGecko + su mock». El motivo:
  - el cliente de CoinGecko del repo (`src/lib/market/coingecko.ts`) no tiene precio simple de ETH;
  - la URL de `src/lib/treasury/valuation.ts` no se puede sustituir por entorno;
  - Chainlink ya es la fuente de ETH/USD de las donaciones (P1-R5), no añade origen y tiene mock en el e2e (2000 USD en `ETH_USD_FEED`).

  (Bajo: si el feed está obsoleto solo falta la columna USD.)
- **P6-R8 Avisos fijos:**
  - en cada herramienta, `common.noCustody`;
  - en Aprobaciones: «Retirar un permiso es una transacción: cuesta gas.»;
  - en Envío múltiple, la confirmación «Vas a enviar {total} USDC a {n} direcciones en {red}. Cada envío es definitivo.» con «Confirmar y firmar» y «Volver»;
  - en Gas: «Estimaciones aproximadas; el coste real depende de la transacción.».

  (Bajo.)

## Mapa de rutas (amplía P2–P5)

| Ruta lógica | ES | EN | Interna |
|---|---|---|---|
| `approvals` | `/herramientas/aprobaciones` | `/en/tools/approvals` | `/{lang}/tools/approvals` |
| `multisend` | `/herramientas/envio-multiple` | `/en/tools/multisend` | `/{lang}/tools/multisend` |
| `gas` | `/herramientas/gas` | `/en/tools/gas` | `/{lang}/tools/gas` |

`SEGMENTS` gana `approvals: { es: "aprobaciones", en: "approvals" }`, `multisend: { es: "envio-multiple", en: "multisend" }` y `gas: { es: "gas", en: "gas" }`. Aprobaciones admite la query opcional `?address=<0x…>&chain=base|arbitrum`. `robots.ts` ya permite `/herramientas` y `/en/`, así que no cambia, y `APP_TOP_SEGMENTS` tampoco: todo cuelga de `tools`.

---

### Task 1: Rutas, hook de wallet compartido y herramienta de Gas

**Files:**
- Modify:
  - `src/lib/i18n/routes.ts` (`RouteKey` gana `"approvals" | "multisend" | "gas"`; `SEGMENTS`, `ROUTES` e `isValidInternal` con `tools/<x>` de longitud 2);
  - `src/app/sitemap.ts` (las tres rutas);
  - diccionarios `es.ts` / `en.ts` (secciones `gas`, más `approvals.metaTitle`/`metaDescription` y `multisend.metaTitle`/`metaDescription` para los marcadores);
  - `src/lib/vouches/use-session-wallet.ts`, que pasa a re-exportar el hook nuevo y deja de definirlo;
  - `e2e/chain/start-chain.mjs` (paso 8, P6-R5b) y `e2e/chain/shared.mjs` (`GAS_PRICE_ORACLE`, `NODE_INTERFACE`, `GAS_ORACLE_WORD`, `NODE_INTERFACE_L1_GAS`).
- Create:
  - `src/lib/web3/use-wallet-match.ts` (`"use client"`) y `src/lib/web3/can-sign.ts` (puro);
  - `src/lib/gas/actions.ts` (constantes puras);
  - `src/lib/gas/units.ts` (conversor puro);
  - `src/lib/gas/oracles-abi.ts`;
  - `src/lib/gas/read.ts` (`server-only`);
  - `src/app/(public)/[lang]/tools/gas/page.tsx`;
  - `src/components/gas/gas-table.tsx`;
  - `src/components/gas/unit-converter.tsx` (`"use client"`);
  - marcadores `tools/approvals/page.tsx` y `tools/multisend/page.tsx` (cabecera y «Próximamente» dentro de la página, que se rellena en Task 3 y Task 4).
- Test: `tests/unit/i18n/routes.test.ts`, `tests/unit/web3/use-wallet-match.test.tsx`, `tests/unit/gas/units.test.ts`, `tests/unit/gas/read.test.ts`, `tests/unit/gas/gas-page.test.tsx`, `tests/unit/gas/chain-constants.test.ts`, `e2e/p2-routing.spec.ts` (ampliar).

**Interfaces:**
- Consumes: `chainClient`, `chainForKey`, `NETWORKS`, `readEthUsd`, `localizedPath`, `alternatesFor`.
- Produces:
  - `localizedPath(lang, "approvals" | "multisend" | "gas")` según el mapa; `toInternalPath("/en/herramientas/gas")` → null.
  - `useWalletMatch(expected: string | null): { address: \`0x${string}\` | undefined; matches: boolean; mismatch: boolean }`:
    - `matches` = conectada y, si `expected` no es null, igual a `expected` sin distinguir mayúsculas;
    - `mismatch` solo cuando wagmi no está `connecting`/`reconnecting`;
    - `useSessionWalletMatch(w)` = `useWalletMatch(w)` (re-export para P5).
  - `canSignFor(owner: string, connected: string | undefined, sessionWallet: string | null): { ok: true } | { ok: false; reason: "not_connected" | "wrong_wallet" | "session_mismatch" }`: pura, en `src/lib/web3/can-sign.ts` (sin `"use client"`); la usan Task 3 y Task 4.
  - `actions.ts`:
    - `GAS_ACTIONS = [{ key: "ethTransfer", gas: 21_000n, calldataBytes: 0 }, { key: "erc20Transfer", gas: 65_000n, calldataBytes: 68 }, { key: "swap", gas: 180_000n, calldataBytes: 516 }, { key: "nftMint", gas: 120_000n, calldataBytes: 164 }] as const`;
    - `OP_TX_ENVELOPE_BYTES = 110`;
    - `type GasActionKey`.
  - `oracles-abi.ts`:
    - `GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F"`, `gasPriceOracleAbi` (`getL1FeeUpperBound(uint256) → uint256`, `l1BaseFee() → uint256`);
    - `NODE_INTERFACE = "0x00000000000000000000000000000000000000C8"`, `nodeInterfaceAbi` (`gasEstimateL1Component(address,bool,bytes) → (uint64,uint256,uint256)`, `payable`).
  - `read.ts`:
    - `type GasRow = { action: GasActionKey; l2Wei: string; l1Wei: string | null; totalWei: string }` (cadenas decimales, serializables para la caché);
    - `type NetworkGas = { status: "ok"; chainId: ChainId; baseFeeWei: string; priorityWei: string; rows: GasRow[]; l1Status: "ok" | "unavailable" } | { status: "unavailable"; chainId: ChainId }`;
    - `type GasSnapshot = { networks: NetworkGas[]; ethereum: { l1BaseFeeWei: string; rows: Array<{ action; totalWei: string }> } | null; ethUsdE8: string | null; readAt: string }`;
    - `readNetworkGas(chain: ChainId, client = chainClient(chain)): Promise<NetworkGas>`: nunca lanza; las filas siguen P6-R5;
    - `readGasSnapshot(): Promise<GasSnapshot>`: Base y Arbitrum en paralelo, más la referencia de L1 del oráculo de Base y `readEthUsd`;
    - `getGasSnapshot()` con `"use cache"` y `cacheLife(GAS_CACHE)`, donde `GAS_CACHE = { stale: 15, revalidate: 15, expire: 60 }`.
  - `units.ts`:
    - `type Unit = "wei" | "gwei" | "eth" | "usd"`;
    - `convert(value: string, from: Unit, ethUsdE8: bigint | null): Record<Unit, string> | null`: aritmética entera con bigint, sin `Number` para wei; acepta coma decimal; null si la entrada no es válida o si la unidad es `usd` sin precio; USD con 2 decimales y ETH con un máximo de 18;
    - `formatWei(wei: bigint, unit: "gwei" | "eth", maxDecimals: number): string`;
    - `usdFromWei(wei: bigint, ethUsdE8: bigint): string`.
  - Página Gas:
    - cabecera y aviso aproximado;
    - en `<Suspense>`, tras `await connection()`, `GasTable` con `getGasSnapshot()`: una tabla por red con acciones × (gwei, ETH, USD), en móvil tarjetas apiladas, y debajo la referencia de Ethereum;
    - `UnitConverter` con `ethUsdE8`;
    - hora de lectura;
    - sin relleno de marca, porque no hay CTA.

- [ ] **Step 1: `ui-ux-pro-max`** para la tabla comparativa legible a 375 px (cifras tabulares) y el conversor de cuatro campos sincronizados.
- [ ] **Step 2: Failing tests**
  - Rutas: las tres filas del mapa en ambos sentidos; `switchLang("/herramientas/envio-multiple", "en")` → `/en/tools/multisend`; el sitemap las incluye; en el e2e, un anónimo recibe 200 en las seis URLs.
  - `use-wallet-match.test.tsx` (**Review Focus 2**):
    - `canSignFor(owner, owner, null)` → ok;
    - wallet distinta → `wrong_wallet`;
    - wallet = dueño pero sesión distinta → `session_mismatch`;
    - sin wallet → `not_connected`;
    - mayúsculas irrelevantes;
    - `useWalletMatch` con `status: "reconnecting"` → `mismatch: false`.
  - `units.test.ts`:
    - `convert("1", "gwei", null)` → `wei: "1000000000"`, `eth: "0.000000001"`, `usd: ""`;
    - `convert("0,5", "eth", 2000_00000000n).usd` === `"1000.00"`;
    - `convert("abc", …)` → null;
    - `convert("1", "usd", null)` → null;
    - `convert("1", "wei", …).eth` === `"0.000000000000000001"`.
  - `read.test.ts` (viem simulado; **Review Focus 5**):
    - Base con base 1 gwei, propina 0,1 gwei y oráculo 5e12 → `ethTransfer.l2Wei` = 21000 × 1.1e9 y `l1Wei` = `"5000000000000"`;
    - `getL1FeeUpperBound` recibe `calldataBytes + 110`;
    - el oráculo que revierte → `l1Wei: null` y `l1Status: "unavailable"`, con `totalWei` = L2;
    - Arbitrum con `gasEstimateForL1 = 1000` → `totalWei` = (65000 + 1000) × base;
    - `getBlock` que lanza → `{ status: "unavailable" }` y la otra red sigue `ok`;
    - `readEthUsd` null → `ethUsdE8: null`;
    - `l1BaseFee` que revierte → `ethereum: null`.
  - `gas-page.test.tsx`:
    - con instantánea simulada, muestra «aprox.», el aviso y `noCustody`;
    - red `unavailable` → «—» y el texto de motivo;
    - sin precio → el campo USD del conversor desactivado;
    - EN sin cadenas ES;
    - ningún elemento con `bg-accent-fill`.
  - `chain-constants.test.ts`: `GAS_PRICE_ORACLE` y `NODE_INTERFACE` de `e2e/chain/shared.mjs` = los de `oracles-abi.ts`.
- [ ] **Step 3: Run** `pnpm vitest run tests/unit/i18n tests/unit/web3 tests/unit/gas`: FAIL.
- [ ] **Step 4: Implement**:
  - rutas, hook y lib de gas;
  - en Arbitrum, el `data` de relleno es `keccak256` encadenado hasta el tamaño pedido;
  - `start-chain.mjs` paso 8: `hardhat_setCode` de los dos runtimes. Cada runtime es un `PUSH32 palabra / PUSH1 0 / MSTORE …` seguido de `RETURN` de 32 o 96 bytes; el script comprueba con `eth_call` que `l1BaseFee()` devuelve `GAS_ORACLE_WORD` y que `gasEstimateL1Component` decodifica 1000, y si no, aborta;
  - ampliar el comentario de cabecera.
- [ ] **Step 5: Run** los unit de Step 3, `pnpm lint`, `pnpm typecheck`, `pnpm test:e2e e2e/p2-routing.spec.ts` y `SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build`: PASS.
- [ ] **Step 6: Commit** `feat(gas): rutas de P6, hook de wallet compartido y calculadora de gas por red`

---

### Task 2: Librería de aprobaciones — descubrimiento, lectura vigente, etiquetas y límite

**Files:**
- Create:
  - `src/lib/approvals/spenders.ts` (constante P6-R2c);
  - `src/lib/approvals/discover.ts` (`server-only`);
  - `src/lib/approvals/read.ts` (`server-only`);
  - `src/lib/approvals/types.ts`;
  - `supabase/migrations/20261025600001_approvals_rate_limit.sql`;
  - `supabase/tests/p6_01_approvals_rate_limit.test.sql`.
- Modify: `src/lib/rate-limit/ip.ts` (`IpBucket` gana `"approvals_scan"`).
- Test: `tests/unit/approvals/spenders.test.ts`, `tests/unit/approvals/discover.test.ts`, `tests/unit/approvals/read.test.ts`.

**Interfaces:**
- Consumes: `checkerSources`, `getJson` (`src/lib/checker/token/sources.ts`), `chainClient`, `isChainId`, `appChainIds`.
- Produces:
  - `types.ts`:
    - `type SpenderKind = "known" | "unknown_contract" | "eoa"`;
    - `type ApprovalRow = { token: \`0x${string}\`; symbol: string | null; decimals: number | null; spender: \`0x${string}\`; spenderLabel: string | null; spenderKind: SpenderKind; allowance: string; unlimited: boolean }`;
    - `type ApprovalScan = { status: "ok"; rows: ApprovalRow[]; partial: boolean } | { status: "unavailable"; reason: "blocked" | "timeout" | "rate_limited" | "error" }`;
    - `UNLIMITED_THRESHOLD = 2n ** 255n`.
  - `spenders.ts`: `KNOWN_SPENDERS: Record<ChainId, ReadonlyArray<{ address: \`0x${string}\`; label: string }>>` y `spenderLabel(chain: ChainId, address: string): string | null`.
  - `discover.ts`:
    - `APPROVAL_TOPIC = keccak256(toBytes("Approval(address,address,uint256)"))` = `0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925`;
    - `BLOCKSCOUT_LOG_CAP = 1000`;
    - `discoverApprovalPairs(chain: ChainId, owner: \`0x${string}\`, env = process.env): Promise<{ status: "ok"; pairs: Array<{ token; spender }>; partial: boolean } | { status: "unavailable"; reason }>`, que nunca lanza:
      - URL de P6-R2;
      - `status: "0"` con `message: "No logs found"` → `ok` vacío;
      - `status: "0"` con otro mensaje → `unavailable/error`;
      - `result.length >= 1000` → `partial: true`;
      - descarta logs con `topics.length !== 3` (los `Approval` de ERC-721 tienen 4 temas);
      - ordena los pares por bloque descendente.
  - `read.ts`:
    - `readAllowances(chain, owner, pairs, client = chainClient(chain)): Promise<{ rows: ApprovalRow[]; partial: boolean }>`, según P6-R2b, con `MAX_PAIRS = 200`;
    - `scanApprovals(chain, owner): Promise<ApprovalScan>` (discover + read);
    - `checkAllowance(chain, owner, token, spender, client?): Promise<ApprovalRow | { allowance: "0" } | { error: "not_a_token" | "rpc_unavailable" }>`.
  - SQL: `public.ip_rate_limit_hit` se redefine con `create or replace`, copiando las ramas vigentes (`checker_web`, `api_free`, `api_paid_attempt`, `vouch_refresh` de `20261025500001_vouches.sql`) y añadiendo `approvals_scan` (30, 10 min). Los grants no cambian (`service_role`).

- [ ] **Step 1: Failing pgTAP** (plan explícito):
  - `approvals_scan`: 30 golpes pasan y el 31.º da `rate_limited`;
  - un bucket desconocido sigue dando `invalid_input`;
  - `vouch_refresh` y `checker_web` siguen funcionando;
  - `anon` y `authenticated` no pueden ejecutar la función.
- [ ] **Step 2: Failing unit**
  - `spenders.test.ts`:
    - toda dirección es EIP-55 válida y sin duplicados por red;
    - Permit2 figura en las cuatro redes;
    - `spenderLabel(8453, permit2.toLowerCase())` → «Permit2».
  - `discover.test.ts` (`fetch` simulado; **Review Focus 1**):
    - la URL lleva `topic0`, `topic1` = dueño con relleno en minúsculas, `topic0_1_opr=and`, `fromBlock=0` y `toBlock=latest`;
    - dos logs del mismo par → un solo par;
    - un log de 4 temas se ignora;
    - «No logs found» → `ok` vacío;
    - 403 con desafío → `unavailable/blocked`;
    - timeout → `unavailable/timeout`;
    - 1 000 resultados → `partial: true`;
    - con `NEXT_PUBLIC_NETWORK_SET=mainnet` se ignora `CHECKER_BLOCKSCOUT_BASE_8453`.
  - `read.test.ts` (viem simulado):
    - una asignación 0 no se lista;
    - `maxUint256` → `unlimited: true`;
    - `2n ** 255n - 1n` → `false`;
    - un spender sin código → `eoa`;
    - un spender conocido → `known` con etiqueta;
    - un `allowance` que revierte → fila omitida;
    - 201 pares → solo 200 leídos y `partial: true`;
    - `symbol` que revierte → `symbol: null`;
    - `checkAllowance` sobre una dirección sin código → `not_a_token`.
- [ ] **Step 3: Run** `pnpm db:test` y `pnpm vitest run tests/unit/approvals`: FAIL.
- [ ] **Step 4: Implement**:
  - migración con `security definer`, `set search_path = ''` y las ramas copiadas literalmente;
  - librería con `parseAbi` de `allowance/symbol/decimals` (o `erc20Abi`) y `client.multicall({ allowFailure: true })`;
  - `getCode` en paralelo, deduplicado por spender;
  - comprobar cada dirección de `KNOWN_SPENDERS` en su fuente oficial y anotar la fecha.
- [ ] **Step 5: Run** `pnpm db:test` (todos los ficheros), el unit de Step 3 y `pnpm typecheck`: PASS.
- [ ] **Step 6: Commit** `feat(approvals): descubrir permisos ERC-20 en Blockscout y leer los vigentes`

---

### Task 3: Página de Aprobaciones con revocación

**Files:**
- Modify:
  - `src/app/(public)/[lang]/tools/approvals/page.tsx`;
  - diccionarios (sección `approvals`);
  - `e2e/mock/checker.mjs` (`getLogs`, P6-R7).
- Create:
  - `src/lib/approvals/actions.ts` (`"use server"`);
  - `src/lib/approvals/use-revoke.ts` (`"use client"`);
  - `src/components/approvals/approvals-lookup.tsx` (formulario GET con dirección, chips de red y «Usar mi wallet»);
  - `src/components/approvals/approvals-list.tsx` (`"use client"`);
  - `src/components/approvals/manual-check.tsx` (`"use client"`);
  - `src/components/approvals/approvals-lazy.tsx` (`dynamic(..., { ssr: false })`, como `pay-widget-lazy.tsx`).
- Test: `tests/unit/approvals/actions.test.ts`, `tests/unit/approvals/use-revoke.test.tsx`, `tests/unit/approvals/approvals-list.test.tsx`, `tests/unit/approvals/approvals-page.test.tsx`, `tests/unit/approvals/mock-logs.test.ts`.

**Interfaces:**
- Consumes:
  - Task 1: `canSignFor`, `useWalletMatch`, `localizedPath(lang, "approvals")`;
  - Task 2: `scanApprovals`, `checkAllowance`, `ApprovalRow`, `ApprovalScan`;
  - `hitIpRateLimit`, `getPublicSession`, `useEnsureChain`, `dataSuffixFor`, `chainForKey`, `explorerAddress`, `explorerTx`.
- Produces:
  - `checkAllowanceAction(input: { chain: "base" | "arbitrum"; owner: string; token: string; spender: string }): Promise<{ ok: true; row: ApprovalRow | null } | { ok: false; error: "invalid_input" | "rate_limited" | "not_a_token" | "rpc_unavailable" }>`:
    - sin sesión;
    - valida con `isAddress`;
    - `hitIpRateLimit("approvals_scan", await headers())`, donde `"error"` deja pasar.
  - `useRevoke(): { revoke(input: { chainId: ChainId; token: \`0x${string}\`; spender: \`0x${string}\`; account: \`0x${string}\` }): Promise<\`0x${string}\`>; switching: boolean }`:
    - `ensure(chainId)` antes de firmar;
    - `writeContractAsync({ address: token, abi: erc20Abi, functionName: "approve", args: [spender, 0n], chainId, account, dataSuffix? })`;
    - después, `waitForTransactionReceipt` (wagmi/actions) antes de resolver.
  - Página (`instant = false`; `noindex` con `address`):
    - cabecera, aviso de gas (P6-R8), `noCustody` y `ApprovalsLookup`;
    - dentro de `<Suspense>`, tras `await connection()`, con `?address=` válido y red válida (por defecto `base`):
      1. `hitIpRateLimit`; `rate_limited` → «Demasiadas consultas, espera unos minutos» sin escanear;
      2. `scanApprovals`;
      3. `getPublicSession()` → `sessionWallet`;
      4. `ApprovalsLazy({ lang, chainId, owner, scan, sessionWallet })`.
  - `ApprovalsList`:
    - **cada fila:** token (símbolo o dirección corta, enlace al explorador), spender (etiqueta o dirección corta con insignia «Desconocido» o «Cuenta normal»), cantidad formateada con `decimals` o «Ilimitada», y botón «Retirar».
    - **Botón «Retirar»:** es el único relleno, solo en la fila en curso (las demás van en `outline`). Cuando `canSignFor` no es ok, aparece desactivado con el texto del motivo y, sin wallet, un enlace «Conectar wallet» que abre AppKit.
    - **Sin permisos:** con `ok` y vacía muestra «Esta dirección no tiene permisos activos en {red}.».
    - **`partial`:** aviso de lista parcial.
    - **`unavailable`:** el texto de Review Focus 1 y `ManualCheck`.
    - `ManualCheck` también aparece siempre plegado al final.
    - **Tras retirar:** `checkAllowanceAction` sobre el par y, si `row` es null, la fila desaparece con «Permiso retirado» y el enlace a la tx. Después, `router.refresh()`.
  - Mock: `GET /blockscout/{84532|421614}/api?module=logs&action=getLogs&…`:
    - el mock reenvía `eth_getLogs` (`fromBlock: "0x0"`, `toBlock: "latest"`, `topics: [topic0, topic1]`) al nodo de `CHAINS[chainId].rpcUrl`;
    - responde con el formato de Blockscout (`{ status: "1", message: "OK", result: [{ address, topics, data, blockNumber, transactionHash, logIndex }] }` o `{ status: "0", message: "No logs found", result: [] }`);
    - `POST /__logs/fail` y `POST /__logs/ok` alternan una respuesta 403 con desafío para `getLogs`;
    - el resto del mock no cambia.

- [ ] **Step 1: `ui-ux-pro-max`** para una lista de permisos con riesgo visible sin alarmismo (insignias de estado con texto, no solo color), un solo relleno y la fila apilada a 375 px.
- [ ] **Step 2: Failing tests**
  - `actions.test.ts`:
    - una dirección mal formada → `invalid_input` sin llamar al limitador;
    - `rate_limited` → no lee la cadena;
    - una asignación 0 → `row: null`;
    - un limitador en `"error"` → sigue.
  - `use-revoke.test.tsx` (wagmi simulado):
    - `ensure(84532)` antes de `writeContractAsync`;
    - `args: [spender, 0n]`;
    - `dataSuffix` con `NEXT_PUBLIC_BASE_BUILDER_CODE` en 84532 y sin él en 421614;
    - `ensure` → false no firma.
  - `approvals-list.test.tsx`:
    - **Review Focus 2**: con la wallet conectada ≠ dueño, «Retirar» desactivado con «Conecta la wallet {corta} para retirar permisos» y sin llamar a `revoke`;
    - con sesión distinta, el texto `session_mismatch`;
    - una fila `unlimited` muestra «Ilimitada»;
    - `eoa` muestra «Cuenta normal (no es un contrato)»;
    - **Review Focus 1**: `unavailable` muestra el texto y el formulario manual y nunca «no tiene permisos»;
    - `partial` muestra su aviso;
    - tras revocar con `checkAllowanceAction → row: null`, la fila desaparece;
    - como mucho un `bg-accent-fill`.
  - `approvals-page.test.tsx`:
    - sin `address`, solo el formulario, indexable;
    - con `address`, `noindex`;
    - `rate_limited` → texto y sin `scanApprovals`;
    - `?chain=polygon` → red por defecto;
    - el aviso de gas y `noCustody` presentes;
    - EN sin cadenas ES («Retirar», «Ilimitada»).
  - `mock-logs.test.ts` (importa `handle` del mock con un `fetch` del nodo simulado): reenvía los temas y responde con el formato de Blockscout; vacío → `No logs found`; tras `/__logs/fail` → 403 con `cf-mitigated`.
- [ ] **Step 3: Run** `pnpm vitest run tests/unit/approvals`: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** el unit, `pnpm lint`, `pnpm typecheck` y `SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build`: PASS.
- [ ] **Step 6: Commit** `feat(approvals): revisar y retirar permisos de tokens`

---

### Task 4: Envío múltiple de USDC

**Files:**
- Modify:
  - `src/app/(public)/[lang]/tools/multisend/page.tsx`;
  - diccionarios (sección `multisend`).
- Create:
  - `src/lib/multisend/parse.ts` (puro);
  - `src/lib/multisend/progress.ts` (registro en `localStorage`, con cada acceso envuelto en `try`);
  - `src/lib/multisend/use-multisend.ts` (`"use client"`);
  - `src/lib/multisend/fragment.ts` (puro: lectura y escritura de `#envio=`);
  - `src/components/multisend/multisend-form.tsx` (`"use client"`);
  - `src/components/multisend/confirm-dialog.tsx`;
  - `src/components/multisend/progress-list.tsx`;
  - `src/components/multisend/multisend-lazy.tsx`.
- Test: `tests/unit/multisend/parse.test.ts`, `tests/unit/multisend/progress.test.ts`, `tests/unit/multisend/use-multisend.test.tsx`, `tests/unit/multisend/multisend-form.test.tsx`.

**Interfaces:**
- Consumes:
  - Task 1: `canSignFor`, `useWalletMatch`;
  - `parseAmount`, `formatAmount`, `NETWORKS`, `chainForKey`, `readAssetBalance` / `useAssetBalances`, `useBalancePreflight`, `useSendTransfer`, `useEnsureChain`, `dataSuffixFor`, `explorerTx`.
- Produces:
  - `parse.ts`:
    - `MAX_RECIPIENTS = 20`;
    - `type ParsedLine = { line: number; to: \`0x${string}\`; amount: bigint }`;
    - `type LineIssue = { line: number; code: "bad_address" | "bad_amount" | "zero_amount" | "too_many_decimals" | "zero_address" | "token_contract" | "too_many" }`;
    - `parseRecipients(text: string, chain: ChainId): { recipients: ParsedLine[]; errors: LineIssue[]; merged: Array<{ to; lines: number[] }>; total: bigint }`:
      - ignora líneas vacías;
      - P6-R3;
      - `too_many` se marca en la línea 21 y siguientes;
      - los duplicados se suman y quedan en `merged`;
    - `listKey(chain, recipients): string`: hash estable de la lista normalizada, para el progreso.
  - `progress.ts`:
    - `type RowState = { to; amount: string; hash?: \`0x${string}\`; status: "todo" | "sent" | "confirmed" | "failed" }`;
    - `loadProgress(owner, chain, key): RowState[] | null`;
    - `saveProgress(owner, chain, key, rows)`;
    - `clearProgress(…)`.
    - El hash se escribe **en cuanto la wallet lo devuelve**, antes de esperar el recibo (el patrón de `pending-sends.ts`).
  - `useMultisend(chain: ChainId): { mode: "atomic" | "sequential" | "checking"; send(rows: ParsedLine[], owner: \`0x${string}\`, key: string): Promise<void>; rows: RowState[]; running: boolean; error: string | null }`:
    - **`mode`:** sale de `useCapabilities({ chainId })`. `atomic.status ∈ {supported, ready}` → `atomic`; un error o cualquier otro valor → `sequential`.
    - **Atómico:** `sendCallsAsync({ chainId, forceAtomic: true, calls: rows.map(r => ({ to: usdc, abi: erc20Abi, functionName: "transfer", args: [r.to, r.amount], dataSuffix? })) })`, después `waitForCallsStatus` y todas las filas a `confirmed`, o a `failed` si `status !== "success"`.
    - **Secuencial:**
      - por cada fila no `confirmed`, en este orden: `send` → guardar el hash → `waitForTransactionReceipt` → `confirmed`;
      - un rechazo o un revert deja la fila en `failed`, se detiene y se puede reanudar;
      - una fila `sent` sin recibo se vuelve a comprobar con su hash antes de reenviar, y si el recibo es `success` pasa a `confirmed` (**Review Focus 4**).
  - `fragment.ts`: `encodeLines(lines: string): string` y `decodeLines(hash: string): string | null` (`#envio=` en base64url UTF-8, con un máximo de 4 KB).
  - `MultisendForm`:
    - chips de red (Base o Arbitrum, en Cerulean al seleccionarse), `textarea` precargado desde `#envio=` y vista previa por línea con errores y avisos;
    - resumen con total, número de destinatarios y saldo;
    - error «Saldo insuficiente: tienes {saldo} USDC» cuando `total > saldo`;
    - «Enviar» (único relleno) solo con 1–20 válidas, sin errores, `canSignFor` ok y saldo suficiente;
    - «Enviar» abre `ConfirmDialog` con el texto de P6-R8 y, al confirmar, `send`;
    - `ProgressList` con estado y enlace al explorador por fila, y «Continuar» si quedan pendientes;
    - en modo atómico, la línea «Tu wallet lo enviará en una sola operación.».

- [ ] **Step 1: `ui-ux-pro-max`** para el área de pegado con validación por línea legible, la confirmación modal accesible (foco atrapado, Esc vuelve) y la lista de progreso.
- [ ] **Step 2: Failing tests**
  - `parse.test.ts` (**Review Focus 3**):
    - `0xAbC…,12,5` → 12 500 000 unidades;
    - separador tabulador o `;` → válido;
    - la misma dirección en mayúsculas y en minúsculas → una fila con la suma y `merged` con las dos líneas;
    - `1.1234567` → `too_many_decimals`;
    - `0` → `zero_amount`;
    - `-1` → `bad_amount`;
    - `0x000…000` → `zero_address`;
    - la dirección del USDC de la red → `token_contract`;
    - 21 líneas válidas → `too_many` en la 21;
    - `total` = suma;
    - `listKey` igual con otro orden de mayúsculas.
  - `progress.test.ts`: `localStorage` que lanza → no rompe y `load` devuelve null; guardar y cargar se ida y vuelta.
  - `use-multisend.test.tsx` (wagmi simulado):
    - capacidades con `atomic: { status: "supported" }` → un `sendCalls` con 3 llamadas, `forceAtomic: true` y cada `dataSuffix` en 84532, y ninguno en 421614;
    - `getCapabilities` que lanza → `sequential`;
    - secuencial con 3 filas donde la 2.ª se rechaza → la 1.ª queda `confirmed` con su hash guardado, la 2.ª `failed`, la 3.ª `todo` y solo 2 llamadas a `send`;
    - **Review Focus 4**: al reanudar con un progreso guardado de la 1.ª `sent` cuyo recibo es `success`, no se reenvía, y se envían la 2.ª y la 3.ª;
    - `send` lleva `account: owner`.
  - `multisend-form.test.tsx`:
    - **Review Focus 2**: con la wallet distinta del dueño, «Enviar» desactivado con su motivo;
    - un total mayor que el saldo → «Saldo insuficiente» y «Enviar» desactivado;
    - «Enviar» abre la confirmación con «Vas a enviar 30 USDC a 3 direcciones en Base Sepolia» y no firma hasta «Confirmar y firmar»;
    - `#envio=` precarga el `textarea`;
    - `noCustody` presente;
    - EN sin cadenas ES.
- [ ] **Step 3: Run** `pnpm vitest run tests/unit/multisend`: FAIL.
- [ ] **Step 4: Implement**, con `useCapabilities`, `useSendCalls` y `waitForCallsStatus` / `waitForTransactionReceipt` de `wagmi/actions`, confirmados en `node_modules/wagmi/dist/esm` (3.7.7).
- [ ] **Step 5: Run** el unit, `pnpm lint`, `pnpm typecheck` y `SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build`: PASS.
- [ ] **Step 6: Commit** `feat(multisend): envío múltiple de USDC, atómico o uno a uno y reanudable`

---

### Task 5: Repartir gastos

**Files:**
- Modify:
  - `src/app/(public)/[lang]/tools/multisend/page.tsx` (sección `#repartir` tras el envío);
  - diccionarios (`multisend.split`).
- Create:
  - `src/lib/split/settle.ts` (puro);
  - `src/lib/split/state.ts` (codificación del fragmento);
  - `src/components/split/split-calculator.tsx` (`"use client"`).
- Test: `tests/unit/split/settle.test.ts`, `tests/unit/split/state.test.ts`, `tests/unit/split/split-calculator.test.tsx`.

**Interfaces:**
- Consumes: Task 4 `encodeLines`; `buildPayUrl`, `parseAmount` / `formatAmount`, `chainForKey`, `assetId`, `ADDRESS_RE` / `ALIAS_RE` de `src/lib/pay`.
- Produces:
  - `settle.ts`:
    - `type Participant = { name: string; paid: bigint; target: string | null }` (target = dirección o alias de Pay);
    - `type Transfer = { from: number; to: number; amount: bigint }` (índices);
    - `shares(total: bigint, n: number): bigint[]`, donde el resto va a los primeros;
    - `settle(ps: Participant[]): Transfer[]`: voraz según P6-R4, determinista, empates por índice, sin transferencias de 0 y como mucho `n − 1`.
  - `state.ts`:
    - `type SplitState = { v: 1; people: Array<{ n: string; p: string; t?: string }> }`;
    - `encodeSplit(s: SplitState): Promise<string>` (`v1.` comprimido o `j1.` plano);
    - `decodeSplit(fragment: string): Promise<SplitState | null>`, que valida la forma, hasta 20 personas, nombres ≤ 24 caracteres e importes con `parseAmount`, y devuelve null si algo falla.
  - `SplitCalculator`:
    - filas de nombre, «Pagó (USDC)» y «Dirección o alias (opcional)», con «Añadir persona» y «Quitar» (botones de 44 px);
    - resultado «A paga X USDC a B»;
    - por cada transferencia, «Pedir con ElClub Pay» (enlace a `buildPayUrl(origin, lang, target, { amount, asset: assetId("USDC", chainForKey("base")) })`) cuando B tiene `target`;
    - selector «Soy…» y, si el elegido debe, «Enviar con envío múltiple», que escribe `#envio=` con sus líneas (solo de acreedores con dirección `0x…`; los alias se resuelven en Pay) y lleva arriba;
    - «Copiar enlace» con `#gastos=`;
    - todos los botones en `outline`, porque el único relleno de la página sigue siendo «Enviar».

- [ ] **Step 1: `ui-ux-pro-max`** para la tabla de participantes editable en móvil y el resultado como lista de frases.
- [ ] **Step 2: Failing tests**
  - `settle.test.ts`:
    - A pagó 30 y B y C 0 → `[C→A 10, B→A 10]` en orden determinista;
    - todos pagan igual → `[]`;
    - total 10 entre 3 → `shares` = `[3,333334, 3,333333, 3,333333]` en unidades, con la suma exacta;
    - 20 personas aleatorias (semilla fija) → como mucho 19 transferencias y saldos finales a 0;
    - nunca una transferencia de 0.
  - `state.test.ts`:
    - se ida y vuelta con `v1.` y con `j1.` (sin `CompressionStream`);
    - un fragmento manipulado (21 personas, nombre de 30 caracteres, importe `-1`, JSON roto) → null.
  - `split-calculator.test.tsx`:
    - el enlace de Pay del acreedor con alias lleva `amount=10` y `asset=USDC:84532`;
    - un acreedor sin `target` no tiene enlace;
    - «Soy B» + «Enviar con envío múltiple» escribe `#envio=` con `0x…,10`;
    - abrir con `#gastos=` restaura las filas;
    - sin `bg-accent-fill` en la sección.
- [ ] **Step 3–4:** FAIL → Implement → PASS (`pnpm vitest run tests/unit/split tests/unit/multisend`).
- [ ] **Step 5: Run** `pnpm lint` y `pnpm typecheck`: PASS.
- [ ] **Step 6: Commit** `feat(split): repartir gastos con enlace compartible y pago por ElClub Pay o envío múltiple`

---

### Task 6: Hub y landing activos, e2e y documentación

**Files:**
- Modify:
  - `src/app/(public)/[lang]/tools/page.tsx` (tres `ToolCard` con `t.available`);
  - `src/components/landing/landing.tsx`;
  - diccionarios (`tools.approvals|multisend|gas`, `tools.metaDescription`, `landing.moreTools`);
  - el spec (P6 «Hecho», los rulings, el backlog de `ApprovalForAll` y HACER A MANO).
- Create: `src/components/landing/more-tools-teaser.tsx`, `e2e/p6-defi-tools.spec.ts`.
- Test: `tests/unit/public/tools-hub.test.tsx`, `tests/unit/landing/landing.test.tsx`.

**Interfaces:**
- Consumes: las rutas de Task 1 y las páginas de Task 1, 3, 4 y 5.
- Produces: `MoreToolsTeaser({ lang, t })`, con título «Más herramientas», la línea «Revisa permisos, envía USDC a varios y calcula el gas.» y un enlace `outline` «Ver herramientas» a `tools`.

- [ ] **Step 1: `ui-ux-pro-max`** para que el teaser siga la estética de los bloques vecinos (VouchTeaser) sin competir con «Crear sorteo».
- [ ] **Step 2: Failing tests**
  - hub: Aprobaciones, Envío múltiple y Gas con «Disponible» y `href` a sus rutas en ES y EN;
  - landing: el teaser enlaza a `tools`, no lleva `bg-accent-fill` y hay un solo bloque nuevo (no tres tarjetas).
- [ ] **Step 3–4:** FAIL → Implement → PASS (`pnpm vitest run tests/unit/public tests/unit/landing`).
- [ ] **Step 5: e2e `p6-defi-tools`** (wallets de prueba y nodos locales):
  1. **Aprobaciones:**
     - la wallet A (Hardhat 1) aprueba desde el spec (`walletClient.writeContract` directo al nodo 84532) `approve(SPENDER, maxUint256)` sobre el USDC de prueba, con `SPENDER` = Hardhat 9, una cuenta sin código;
     - un anónimo abre `/herramientas/aprobaciones?address=<A>` y ve la fila con «Ilimitada» y «Cuenta normal (no es un contrato)»;
     - «Retirar» está desactivado y pide conectar.
  2. A conecta (`installTestWallet` + `connectInjected`, sin SIWE) → «Retirar» → la tx enviada acaba en el sufijo ERC-8021 de `bc_e2etest` (se lee del nodo) → «Permiso retirado» y la fila desaparece. Tras recargar sigue sin aparecer, y `allowance` en la cadena = 0.
  3. **Review Focus 1:** `POST /__logs/fail` al mock → al recargar, el texto de lista no disponible y el formulario manual. Una comprobación manual (USDC + SPENDER, tras otro `approve` de 5 USDC desde el spec) muestra «5 USDC». Al terminar, `POST /__logs/ok`.
  4. **Envío múltiple:**
     - A pega 3 líneas a Hardhat 5, 6 y 7 (10, 20 y 0,5 USDC) en Base Sepolia;
     - la confirmación dice «30,5 USDC a 3 direcciones»;
     - el envío es secuencial (la wallet del e2e no tiene 5792): 3 txs, cada una con el sufijo, y la lista de progreso con 3 hashes;
     - los saldos `balanceOf` en la cadena suben exactamente esas cantidades.
  5. **Review Focus 4:** con una lista nueva de 2 líneas, el spec rechaza la 2.ª firma (`__walletSent`, o la opción de rechazo del helper si existe; si no, recargar tras la 1.ª) → al volver, «Continuar» envía solo la 2.ª y el saldo del 1.er destinatario sube una sola vez.
  6. **Repartir gastos:** A 30, B 0 y C 0 (B con alias de Pay sembrado) → «C paga 10 USDC a A» y «B paga 10 USDC a A»; el enlace de Pay lleva `amount=10`; «Copiar enlace» y abrirlo en otra página restaura el reparto.
  7. **Gas:** `/herramientas/gas` muestra Base Sepolia y Arbitrum Sepolia con cifras en gwei, ETH y USD (precio de prueba 2000), la parte de L1 de los oráculos de prueba y la referencia de Ethereum; el conversor `1 gwei` → `0.000000001 ETH`.
  8. El cambio ES/EN conserva cada página (`/en/tools/approvals?address=<A>&chain=base`), sin errores de consola ni violaciones de CSP (`watchCsp`).
- [ ] **Step 6: Verificación completa:**
  - comandos: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:test`, `pnpm test:e2e`, `E2E_PROD=1 pnpm test:e2e` y **`SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build`**, todo en verde o documentado;
  - capturas a 375 y 1440 px de las tres herramientas (Aprobaciones con lista y sin ella; Envío múltiple con la confirmación abierta) para revisar el relleno único y el scroll horizontal.
- [ ] **Step 7: Docs:**
  - P6 «Hecho» en el spec, con los rulings P6-R1…P6-R8 y lo que salga al cerrar;
  - en «Fuera de alcance» o el backlog: «Permisos NFT (`ApprovalForAll`) en la herramienta de Aprobaciones»;
  - HACER A MANO, punto nuevo: «Probar en PRE: aprobar USDC de Base Sepolia a una dirección cualquiera, verlo en `/herramientas/aprobaciones` y retirarlo; enviar USDC de prueba a 3 direcciones con Envío múltiple (con una wallet con 5792, como Coinbase Smart Wallet, y con otra sin él)»;
  - y: «Si Blockscout de Base mainnet bloquea la lista a menudo en producción, avisar: hay alternativa por RPC (P6-R2)».
- [ ] **Step 8: Commit** `feat(tools): aprobaciones, envío múltiple y gas activos en el hub y la landing; e2e y docs P6`
