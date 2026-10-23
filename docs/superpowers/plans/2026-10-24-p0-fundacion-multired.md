# P0 — Fundación multired (Base + Arbitrum) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ElClub. deja Linea y mueve dinero en Base y Arbitrum: propinas y bounties se pagan eligiendo el token (USDC o ETH de cada red), sin comisión, con una sola transacción, con Builder Code en Base, y solo en las redes que acepta quien recibe.

**Architecture:**
- **Dos registros de redes.** `src/lib/economy/networks.ts` pasa a ser el registro de las cuatro redes nuevas (PRO 8453/42161, PRE y local 84532/421614), elegidas por entorno con `NEXT_PUBLIC_NETWORK_SET`. Linea se aísla en `src/lib/legacy/linea.ts`, que solo usan las "islas legadas" (DAO, sorteos, encuestas) hasta P1.
- **En BD, `public.chains`** sustituye a los `check (chain_id in (59144, 59141))` de las tablas vivas (FK) y es la lista de redes habilitadas (D2/D21). Las RPC de propinas y bounties reciben `p_chain_id` y lo validan contra `chains.enabled`; ya no leen `active_chain_id`. Las funciones legadas siguen leyendo `active_chain_id` sin cambios.
- **Pago "token primero".** Un activo es `(token, red)`. Un selector común (`AssetPicker`) ordena por lo que el pagador puede pagar, filtra por las redes del destinatario y cambia la red de la wallet al elegir. Las transferencias firmadas en Base llevan el sufijo ERC-8021.

**Tech Stack:** Next.js 16.4 (App Router, cacheComponents), Supabase (definer RPCs, RLS, pgTAP), viem 2.57.7, wagmi 3, Reown AppKit 1.8, @tanstack/react-query 5, Vitest, Playwright con Hardhat 2.

**Spec:** `docs/superpowers/specs/2026-10-24-base-arbitrum-y-parte-publica-design.md`: §Prioridades P0, decisiones del usuario 1, 2 y 6, decisiones D1–D5, D13, D14, D21 y D22. También se usan:
- `docs/research/notas-2026-10-24/auditoria_codigo.md`: el acoplamiento a Linea, con `ruta:línea`;
- `docs/research/notas-2026-10-24/infraestructura_cadenas.md`: direcciones USDC, chain ids y finalidad.

## Decisiones del constructor (rulings P0-R*, huecos del spec resueltos al planificar)
- **P0-R1, conjunto de redes.** `NEXT_PUBLIC_NETWORK_SET = mainnet | testnet` sustituye a `NEXT_PUBLIC_CHAIN`. Sin valor vale `testnet`, y un valor desconocido lanza error.
  - La lista de D2 ("`enabled_chain_ids`") **es** `chains.enabled`: no hay una segunda lista en `app_config`.
  - Red usable = habilitada en BD **y** dentro del conjunto del build. El servidor también lo comprueba en las server actions, así que una BD de PRO con una testnet habilitada no abre nada.
- **P0-R2, islas legadas hasta P1.**
  - La DAO (fondo, donaciones, retiradas, NAV, escaneo de la Safe), los sorteos y las encuestas conservan su código TS y SQL. El TS cambia sus imports a `src/lib/legacy/linea.ts` (`LegacyChainId = 59144 | 59141`), y el SQL sigue leyendo `active_chain_id`.
  - Una nueva `app_config.legacy_dao_enabled = false` pausa la parte on-chain: el cron `/api/cron/dao` se salta los pasos por red, `/dao*` muestra un aviso y se ocultan sus enlaces.
  - Las encuestas siguen funcionando, porque solo usan la BD.
  - Los tests de estas islas (pgTAP 800–985 y unit `tests/unit/treasury/**`, `tests/unit/polls/**`) mantienen sus ids de Linea. Las e2e legadas (`f3d`, `f4a`, `f4c`, `f4d`, `f4e`) pasan a `e2e/legacy/` y se excluyen de la ejecución por defecto. P1 las reescribe o las borra.
  - Las **alphas** (D19) también son P1 y siguen comprobando contratos en Linea mainnet con la RPC pública.
- **P0-R3, tablas vivas con FK a `chains`:** `payment_intents`, `tips`, `onchain_transfers` y `bounties`.
  - `raffles`, `polls`, `alpha_details`, `chain_config` y `dao_*` no se tocan hasta P1.
  - Linea queda en `chains` con `enabled = false`, así las filas antiguas siguen siendo válidas. `set_chain_enabled` se niega a habilitar una red `linea`.
- **P0-R4, bounties.**
  - Al crear un bounty se elige un activo `(token, red)`: el token fija el importe y la red queda como "red anunciada".
  - Se paga con el **mismo token** en cualquier red habilitada que acepte quien lo resolvió. Por defecto se ofrece la anunciada.
  - Desaparecen el estado `other_chain` y el error `bounty_chain_inactive`.
- **P0-R5, sin comisión (D13).**
  - La UI y el TS dejan de saber de comisiones: se borran `FeeControl`, `FeeCard`, `set_min_fee_bps` del panel y las utilidades de bps.
  - En SQL las columnas `fee_*`/`platform_*` se quedan. `min_fee_bps` pasa a 0 y las RPC nuevas no reciben `p_fee_bps` e insertan siempre `fee_amount = 0`.
  - El JSON del intent conserva `feeAmount: "0"` y `platformAddress: null` por compatibilidad con el ledger local (`pending-sends`).
- **P0-R6, Builder Code (D14).**
  - El sufijo usa el esquema 0 de ERC-8021 y se añade en la red `base` (8453 **y** 84532, para poder probarlo en PRE y en e2e). En Arbitrum nunca.
  - USDC siempre lo lleva: `transfer` ignora los bytes que sobran.
  - ETH solo lo lleva si el destinatario no tiene código (`getBytecode` vacío). Con código, o si la lectura falla, se envía sin sufijo, porque un `fallback` de smart wallet podría revertir.
- **P0-R7, redes del destinatario (D22).** Se guardan como claves de red (`'base'`, `'arbitrum'`), no como chain ids, para que valgan igual en PRE y en PRO. El valor por defecto es ambas y nunca puede quedar vacío.
- **P0-R8, orden sin precios.**
  - El selector ordena por capacidad de pago (ver `rankAssets`), sin convertir ETH a USD. Así P0 no depende de Chainlink y los campos de feed salen del registro nuevo.
  - P1 (donaciones, D7) obtiene los feeds ETH/USD de Base y Arbitrum (también los de Sepolia) de data.chain.link. La nota de infraestructura no trae el de Arbitrum.
- **P0-R9, confirmaciones por red.**
  - `TIP_CONFIRMATIONS` sigue siendo un override global. Sin él valen las de la red: Base 3 (unos 6 s) y Arbitrum 20 (unos 5 s; el tiempo de bloque de Arbitrum no está verificado, ver la nota).
  - Los tamaños de escaneo (`scanChunkBlocks`, `maxScanChunks`) se fijan en el registro: Base 2000×10 y Arbitrum 2000×40. Los consume el escaneo de la Safe en P1.
- **P0-R10, exploradores.** Solo enlaces web: basescan.org, sepolia.basescan.org, arbiscan.io y sepolia.arbiscan.io. P0 no usa ninguna API de explorador; el "HACER A MANO 4" del spec queda para P1, si llega a hacer falta.
- **P0-R11, Base Account (D5).**
  - Se investiga si GoTrue verifica firmas ERC-1271/6492 y el resultado queda en un comentario de `appkit.ts` y en el PR.
  - En P0 solo se aceptan EOAs: `enableBaseAccount` y `enableCoinbase` siguen en `false`, porque el conector de Coinbase carga telemetría fuera de la CSP.
- **P0-R12, "MODO PRUEBA".** Pasa a ser una propiedad del entorno (`networkSet() === "testnet"`), no de una red. `NetworkBadge` se sustituye por `TestModeBadge`, y cada importe muestra el logo de su red.
- **P0-R14, las cuatro redes habilitadas en BD (ruling del controlador, 2026-10-24).** La migración deja habilitadas Base, Arbitrum y sus Sepolia en todas las BD; el conjunto del build decide cuáles se usan, así PRO no depende de un paso manual tras desplegar. Como una RPC de Postgres puede llamarse sin pasar por la server action, la **verificación on-chain** (propinas, bounties) rechaza con `chain_invalid` cualquier `chain_id` fuera de `appChainIds()` antes de pedir un cliente RPC; test unitario en la Tarea 4.
- **P0-R13, e2e.**
  - Dos nodos Hardhat: 84532 en `:8545` y 421614 en `:8546`. En cada uno se despliega un USDC simulado en la dirección de Circle de esa testnet. `:8547/ready` responde cuando ambos están listos.
  - La wallet inyectada cambia de red de verdad (`wallet_switchEthereumChain` + `chainChanged`).

## Global Constraints
- **Proceso:**
  - TDD: test que falla, implementación mínima, test en verde y commit.
  - SDD con subagentes: un implementador y un revisor por tarea.
  - `ui-ux-pro-max` antes de cualquier UI (Tareas 5, 8, 9, 10, 11 y 12).
- **Comandos de prueba:**
  - Unit: `pnpm test:unit` (o `pnpm vitest run <ruta>`). Tipos: `pnpm typecheck`. Lint: `pnpm lint`.
  - **pgTAP (`pnpm db:test`) y e2e (`pnpm test:e2e`) borran la BD local que usa el usuario: pedirle permiso antes de cada ejecución.** Si no lo da, se ejecutan en la Tarea 14.
  - Al terminar cada tarea, `pnpm typecheck` y `pnpm test:unit` quedan en verde.
- **Estilos:** solo tokens de `src/app/globals.css` (sin hex en TS/CSS; los SVG de marca de `public/brand/` son la excepción).
- **Accesibilidad:** AA, objetivos táctiles ≥ 44 px (`min-h-11`), sin scroll horizontal de 375 a 1920 px y `motion-reduce` en las animaciones.
- **CSP:** solo los orígenes imprescindibles. Se añaden las RPC públicas de Base y Arbitrum del conjunto del entorno y se quitan las de Linea. Los logos son SVG locales, así que no hay orígenes nuevos de imagen.
- **Secretos:** nunca se commitea `.env*` salvo los `*.example`, con valores vacíos. Las URL de RPC (Infura) solo se configuran a mano.
- **Wallets de test:** solo cuentas de Hardhat o claves generadas (`generatePrivateKey`), nunca wallets reales.
- **Linea en los tests:** los tests nuevos o migrados no usan 59144/59141. Excepciones: los de las islas legadas y las alphas (P0-R2).
- **Migraciones:** siempre ficheros nuevos `supabase/migrations/202610241000NN_*.sql`; las migraciones aplicadas no se editan. Si cambia la firma de una función: `drop function` de la vieja y `create function`, con `revoke`/`grant` como en el resto del repo (`authenticated` solamente).
- **Redes por entorno (D1):**

  | Entorno | `NEXT_PUBLIC_NETWORK_SET` | Redes |
  |---|---|---|
  | PRO | `mainnet` | 8453 Base, 42161 Arbitrum |
  | PRE, local y e2e | `testnet` | 84532 Base Sepolia, 421614 Arbitrum Sepolia |

- **Variables de entorno:**
  - Servidor: `BASE_RPC_URL`, `ARBITRUM_RPC_URL`, `BASE_SEPOLIA_RPC_URL` y `ARBITRUM_SEPOLIA_RPC_URL`.
  - Navegador, solo para tests y vacías en producción: `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` y `NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL`.
  - Builder Code: `NEXT_PUBLIC_BASE_BUILDER_CODE` (valor real `bc_ttxulybv`; se pone a mano, no en los `.example`).
- **USDC nativo (Circle),** copiado de `infraestructura_cadenas.md`. **El implementador vuelve a comprobar cada dirección en https://developers.circle.com/stablecoins/usdc-contract-addresses antes de commitear y lee `decimals() = 6` on-chain**:
  - 8453 `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`;
  - 42161 `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`;
  - 84532 `0x036CbD53842c5426634e7929541eC2318f3dCF7e`;
  - 421614 `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`.
  - Sin USDC.e (D3).
- **Safe del club:** `0x380f2e12081995359e2Ab88E3c31c6b227904234`, misma dirección en las cuatro redes. **Aún no está desplegada en ellas.** P0 solo la guarda en `chains.safe_address`; usarla requiere `getCode` ≠ `0x` (D6, en P1).
- **Commits:** cada mensaje termina con estas dos líneas:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019kUJkrZQ2bsDpskaaHVu4D
  ```
- **Next 16:** antes de tocar rutas, `proxy`, config o caché, leer la guía correspondiente en `node_modules/next/dist/docs/` (AGENTS.md).
- **Textos:** cortos y concretos. Las redes se llaman "Base", "Arbitrum", "Base Sepolia" y "Arbitrum Sepolia".

## Review Focus
1. **La wallet se queda en otra red** después de elegir un activo: la wallet rechaza el cambio o no conoce Base Sepolia. Se muestra "Cambiar a <red>", no se firma nada y `guardSigner` exige la red del intent. → test en la Tarea 11, paso 1.
2. **El destinatario acepta solo una red.** El selector solo ofrece activos de esa red. El servidor rechaza con `network_not_accepted` un intent hacia otra red aunque el cliente esté manipulado. → pgTAP en la Tarea 4 y test unit en la Tarea 11.
3. **ETH con sufijo hacia un contrato** (smart wallet, cuenta 7702): sin sufijo, para no revertir en su `fallback`. USDC siempre con sufijo. → test en la Tarea 6.
4. **Restos de Linea:** intents pendientes en 59141, entradas del ledger local con comisión o en una red deshabilitada. `confirmIntent` las marca `failed` con `chain_disabled` sin lanzar, y el diálogo las descarta en lugar de pedir otra firma. → tests en las Tareas 4 y 11.
5. **BD y build no coinciden** (por ejemplo, una BD de PRO con 84532 habilitada): esa red no se ofrece en el cliente y la server action devuelve `chain_invalid` sin llamar a la RPC. → tests en las Tareas 2 y 4.

---

### Task 1: BD — tabla `chains`, FKs, redes del destinatario y flags

**Files:**
- Create: `supabase/migrations/20261024100001_chains.sql`, `supabase/tests/995_chains.test.sql`
- Modify: `supabase/tests/510_economy_config.test.sql` (claves nuevas de `economy_config`), `supabase/tests/991_mainnet_defaults.test.sql` (añade aserciones; conserva la de `active_chain_id`)

**Interfaces:**
- Produces (SQL):
  - `public.chains(chain_id int primary key, network text not null check (network in ('base','arbitrum','linea')), name text not null, testnet boolean not null, enabled boolean not null default false, safe_address text check (safe_address ~ '^0x[0-9a-f]{40}$'))`. RLS activada; `select` para `is_active_member()`; sin escritura directa.
  - Semillas:

    | chain_id | network | name | testnet | enabled | safe_address |
    |---|---|---|---|---|---|
    | 8453 | base | Base | false | true | Safe en minúsculas |
    | 42161 | arbitrum | Arbitrum | false | true | Safe en minúsculas |
    | 84532 | base | Base Sepolia | true | true | Safe en minúsculas |
    | 421614 | arbitrum | Arbitrum Sepolia | true | true | Safe en minúsculas |
    | 59144 | linea | Linea | false | false | null |
    | 59141 | linea | Linea Sepolia | true | false | null |

  - `private.chain_enabled(p_chain int) returns boolean`: `stable`, `security definer`. Dice si existe la fila y está habilitada.
  - `public.set_chain_enabled(p_chain int, p_enabled boolean) returns void`:
    - solo SuperAdmin (`has_global_perm(512)`), como `set_active_chain`; si no, `forbidden`;
    - escribe en `audit_log` con `action = 'chain_enabled'` y payload `{chainId, enabled}`;
    - `chain_invalid` si la red no existe o si es `linea` y `p_enabled`.
  - `members.receive_networks text[] not null default '{base,arbitrum}'` con `check (cardinality(receive_networks) >= 1 and receive_networks <@ array['base','arbitrum'])`.
  - `public.set_receive_networks(p_networks text[]) returns void`:
    - solo un miembro activo; si no, `forbidden`;
    - deduplica y valida; si no cuadra, `invalid_input`;
    - `perform private.rate_limit(v_me::text, 'profile', 30, interval '1 hour')`, el mismo bucket que `update_profile`.
  - `public.receive_networks_of(p_member uuid) returns text[]`: para miembros activos; `not_found` si el miembro no está activo.
  - `app_config`: inserta `legacy_dao_enabled = false`; actualiza `min_fee_bps` a `0`.
  - `public.economy_config()` (última definición en `20261019400002_raffles.sql:677`) se redefine. Mantiene sus claves y añade:
    - `enabledChainIds`: array ordenado `base` antes que `arbitrum`;
    - `networks`: objeto `{"<chainId>": {"enabled": bool, "safe": text|null}}` de las redes no `linea`;
    - `legacyDaoEnabled`: bool.
  - FKs: en `payment_intents`, `tips`, `onchain_transfers` y `bounties` se borra todo `check` cuya definición contenga `59144` (bloque `DO` sobre `pg_constraint` con `pg_get_constraintdef`, porque los nombres los generó Postgres) y se añade `foreign key (chain_id) references public.chains(chain_id)`.

- [ ] **Step 1: Escribir `995_chains.test.sql` (falla)** con `plan(N)`:
  - `has_table('public','chains')`;
  - las 6 filas exactas de la tabla de arriba;
  - `private.chain_enabled(84532)`, `(421614)`, `(8453)` y `(42161)` son true; `(59141)`, `(59144)` y `(1)` son false;
  - insertar un `payment_intents` con `chain_id = 1` falla con `23503` (FK); con `chain_id = 59141` pasa la FK (filas legadas válidas); con `84532` pasa;
  - `set_chain_enabled(59144, true)` lanza `chain_invalid`; como miembro sin el bit 512 lanza `forbidden`; como SuperAdmin `set_chain_enabled(8453, true)` cambia la fila y deja una fila `chain_enabled` en `audit_log`;
  - un miembro nuevo tiene `receive_networks = '{base,arbitrum}'`; `set_receive_networks('{arbitrum}')` lo guarda; `'{}'` y `'{linea}'` lanzan `invalid_input`; `'{base,base}'` guarda `'{base}'`;
  - `receive_networks_of(<miembro baneado>)` lanza `not_found`;
  - `legacy_dao_enabled = false` y `min_fee_bps = 0`;
  - `economy_config()->'enabledChainIds' = '[84532, 421614]'`, `->'networks'->'84532'->>'safe'` = Safe en minúsculas, `->'legacyDaoEnabled' = 'false'`.
- [ ] **Step 2: Ejecutar** (con permiso) `pnpm db:test`. Esperado: FAIL en `995_chains`.
- [ ] **Step 3: Escribir la migración** `20261024100001_chains.sql` según Interfaces. Comentario de cabecera: D2/D21, P0-R1, P0-R3.
- [ ] **Step 4: Ajustar** `510_economy_config` (claves nuevas presentes, claves viejas intactas) y añadir a `991_mainnet_defaults` que 8453 y 42161 empiezan habilitadas y `legacy_dao_enabled = false`.
- [ ] **Step 5: Ejecutar** (con permiso) `pnpm db:test`. Esperado: PASS, también todos los pgTAP legados.
- [ ] **Step 6: Commit** `feat(db): tabla chains con FK en tablas vivas, redes del destinatario y flags de P0`.

### Task 2: Registro TS de redes y activos, módulo legado, clientes y verificación por red

**Files:**
- Modify: `src/lib/economy/networks.ts` (reescrito), `src/lib/economy/config.ts`, `src/lib/payments/chain-client.ts`, `src/lib/payments/verify.ts`
- Create: `src/lib/economy/assets.ts`, `src/lib/legacy/linea.ts`, `src/lib/legacy/linea-client.ts`
- Modify (cambio de import a `@/lib/legacy/linea`, sin cambio de lógica):
  - `src/lib/treasury/*` y `src/lib/channels/lock.ts`;
  - `src/components/treasury/**`;
  - `src/app/(forum)/dao/**` y `src/app/api/cron/dao/route.ts`;
  - `src/lib/treasury/raffle-verify-chain.ts`.
- Modify (solo para compilar; se rehacen después):
  - `src/components/payments/tip-dialog.tsx` y `src/components/chat/bounty-dialog.tsx`: `economy.enabledChainIds[0]` donde hoy usan `activeChainId`;
  - `src/components/economy/economy-form.tsx`: `config.legacy.*`;
  - `src/components/guide/guide-content.tsx`: se quita la interpolación de `minFeeBps`;
  - `src/app/(forum)/layout.tsx`, `src/app/(onboarding)/bienvenida/page.tsx` y `src/app/(forum)/u/[address]/page.tsx`.
- Test: `tests/unit/economy/networks.test.ts` (reescrito), `tests/unit/economy/assets.test.ts`, `tests/unit/economy/config.test.ts`, `tests/unit/payments/chain-client.test.ts`, `tests/unit/payments/verify.test.ts`, `tests/unit/legacy/linea.test.ts`

**Interfaces:**
- Produces `src/lib/economy/networks.ts`:
  ```ts
  export type ChainId = 8453 | 42161 | 84532 | 421614;
  export type NetworkKey = "base" | "arbitrum";
  export type NetworkSet = "mainnet" | "testnet";
  export type Network = {
    id: ChainId; key: NetworkKey; name: string; testnet: boolean;
    usdc: `0x${string}`; explorer: string; viemChain: Chain; // base | arbitrum | baseSepolia | arbitrumSepolia de viem/chains
    serverRpcEnv: "BASE_RPC_URL" | "ARBITRUM_RPC_URL" | "BASE_SEPOLIA_RPC_URL" | "ARBITRUM_SEPOLIA_RPC_URL";
    logo: string; // "/brand/networks/base.svg" | "/brand/networks/arbitrum.svg"
    finality: { tipConfirmations: number; scanChunkBlocks: number; maxScanChunks: number };
  };
  export const NETWORKS: Record<ChainId, Network>;
  export const CHAIN_IDS: readonly ChainId[];            // [8453, 42161, 84532, 421614]
  export function isChainId(n: unknown): n is ChainId;
  export function chainsForSet(set: NetworkSet): ChainId[]; // mainnet [8453, 42161]; testnet [84532, 421614]
  export function networkSet(value?: string | undefined): NetworkSet; // por defecto process.env.NEXT_PUBLIC_NETWORK_SET (referencia literal); undefined → "testnet"; otro → throw
  export function appChainIds(): ChainId[];             // chainsForSet(networkSet())
  export function explorerTx(chain: ChainId, hash: string): string; // también explorerBlock y explorerAddress con la firma de hoy
  ```
  `MAX_FEE_BPS`, `bpsToPercentText`, `percentTextToBps` y `feeOnTenUsdc` se quedan sin cambios hasta la Tarea 11. Los campos `weth`, `ethUsdFeed` y `ethUsdHeartbeatSec` no existen en el registro nuevo (P0-R8).
- Produces `src/lib/economy/assets.ts`:
  ```ts
  export type AssetId = `${Token}:${ChainId}`;
  export type Asset = { id: AssetId; token: Token; chainId: ChainId; decimals: number; contract: `0x${string}` | null }; // null = ETH nativo
  export type AssetBalances = Partial<Record<AssetId, bigint | null>>;
  export function assetId(token: Token, chainId: ChainId): AssetId;
  export function parseAssetId(s: string): Asset | null;
  export function assetsFor(chainIds: readonly ChainId[], accept?: readonly NetworkKey[]): Asset[]; // USDC de cada red en orden de chainIds, luego ETH
  export function rankAssets(assets: readonly Asset[], balances: AssetBalances, amount: bigint | null): Asset[];
  ```
  `rankAssets` es un orden estable por rango, de 0 a 3:
  - 0: puede pagar, es decir, saldo ≥ `amount` (o > 0 si `amount` es null) y, para USDC, ETH > 0 en esa red;
  - 1: saldo > 0 pero no le alcanza;
  - 2: saldo 0;
  - 3: saldo desconocido (`null` o ausente).
- Produces `src/lib/legacy/linea.ts` (sin `server-only`):
  - `type LegacyChainId = 59144 | 59141` y `LEGACY_NETWORKS`, que es el contenido actual de `NETWORKS`, con WETH, feed y heartbeat, sin cambios;
  - `LEGACY_CHAIN_IDS`, `isLegacyChainId` y `legacyExplorerTx/Block/Address`.
- Produces `src/lib/legacy/linea-client.ts` (`server-only`): `legacyChainClient(chain: LegacyChainId): PublicClient`, con `linea`/`lineaSepolia` y transporte `http(undefined, { timeout: 8000, retryCount: 1 })` (RPC pública; sin variables `LINEA_*`).
- Produces `chainClient(chain: ChainId, env: Record<string, string | undefined> = process.env): PublicClient`, con `NETWORKS[chain].viemChain` y `env[NETWORKS[chain].serverRpcEnv] || undefined`.
- Produces in `verify.ts`:
  - `VerifyInput.chain: ChainId | LegacyChainId`;
  - `defaultConfirmations(chain: ChainId | LegacyChainId): number`. `TIP_CONFIRMATIONS` válido gana; si no, `NETWORKS[chain].finality.tipConfirmations`, y 3 para las legadas;
  - cliente por defecto: `isChainId(c) ? chainClient(c) : legacyChainClient(c)`;
  - contrato USDC según la red de cualquiera de los dos registros; WETH solo en redes legadas, y en las nuevas un pago `WETH` es `tx_mismatch`.
- Produces `src/lib/economy/config.ts`:
  ```ts
  export type LegacyEconomyConfig = {
    activeChainId: LegacyChainId;
    withdrawalsEnabled: Record<LegacyChainId, boolean>;
    weightedRafflesEnabled: Record<LegacyChainId, boolean>;
    chains: Record<LegacyChainId, { safe: string | null; platform: string | null }>;
  };
  export type EconomyConfig = {
    enabledChainIds: ChainId[];              // BD habilitadas ∩ appChainIds(), en el orden de appChainIds()
    safes: Partial<Record<ChainId, string>>; // dirección de la Safe por red (aún sin comprobar getCode)
    legacyDaoEnabled: boolean;
    legacy: LegacyEconomyConfig;
  };
  export const getEconomyConfig: () => Promise<EconomyConfig>; // cache(), como hoy
  ```
  `minFeeBps` desaparece. Los consumidores legados leen `config.legacy.*`.

- [ ] **Step 1: Tests que fallan.**
  - `networks.test.ts`: los 4 ids; la tabla USDC de Global Constraints, exacta; `explorerTx(8453, "0xab")` es `"https://basescan.org/tx/0xab"` y `explorerTx(421614, …)` empieza por `"https://sepolia.arbiscan.io/tx/"`; `isChainId(59141) === false`; `chainsForSet` en los dos casos; `networkSet(undefined) === "testnet"`; `networkSet("linea")` lanza; finality Base `{3, 2000, 10}` y Arbitrum `{20, 2000, 40}`; cada `viemChain.id` coincide con su clave.
  - `assets.test.ts`:
    - `assetsFor([84532, 421614]).map(a => a.id)` es `["USDC:84532", "USDC:421614", "ETH:84532", "ETH:421614"]`, y con `accept ["arbitrum"]` solo quedan los de 421614;
    - `parseAssetId("USDC:1") === null`;
    - con saldos `USDC:84532 = 5_000_000n`, `ETH:84532 = 1n`, `USDC:421614 = 0n` y amount `1_000_000n`, `rankAssets` deja primero `USDC:84532` y al final los de saldo desconocido;
    - USDC con saldo pero ETH 0 en esa red queda en el rango 1.
  - `config.test.ts`: con `enabledChainIds [84532, 421614, 8453]` y build `testnet`, el resultado es `[84532, 421614]`. Con un `chainId` legado en `activeChainId`, `legacy.activeChainId` lo conserva.
  - `chain-client.test.ts`: `chainClient(84532, { BASE_SEPOLIA_RPC_URL: "http://x:1" })` usa esa URL y la cadena 84532.
  - `verify.test.ts`: los casos actuales migrados a 84532; `defaultConfirmations(421614) === 20` sin env y `=== 1` con `TIP_CONFIRMATIONS=1`; WETH en 84532 da `tx_mismatch`.
  - `legacy/linea.test.ts`: `LEGACY_NETWORKS[59141].usdc` es la dirección de hoy.
- [ ] **Step 2: Ejecutar** `pnpm vitest run tests/unit/economy tests/unit/payments/verify.test.ts tests/unit/payments/chain-client.test.ts tests/unit/legacy`. Esperado: FAIL.
- [ ] **Step 3: Implementar** los módulos de Interfaces y mover los imports de las islas legadas a `@/lib/legacy/linea` (`ChainId` → `LegacyChainId`, `NETWORKS` → `LEGACY_NETWORKS`, `CHAIN_IDS` → `LEGACY_CHAIN_IDS`, `chainClient` → `legacyChainClient`).
  - Los tests de `tests/unit/treasury/**` solo cambian de import.
  - En `valuation.ts` los overrides `*_59141` siguen como están (legado).
- [ ] **Step 4: Ajustes para compilar** en los consumidores de la lista "solo para compilar".
- [ ] **Step 5: Ejecutar** `pnpm typecheck && pnpm test:unit`. Esperado: PASS.
- [ ] **Step 6: Commit** `refactor(economy): registro de Base y Arbitrum, activos (token, red) y Linea aislada como legado`.

### Task 3: Entorno — variables, CSP, readiness y `check-rpc`

**Files:**
- Modify: `src/lib/security/headers.ts`, `src/lib/deploy/readiness.ts`, `scripts/check-rpc.mjs`, `.env.example`, `deploy/prod/vercel.env.example`, `deploy/preprod/web.env.example`, `deploy/preprod/docker-compose.yml`, `Dockerfile`, `docs/deploy/entornos.md`, `docs/deploy/produccion.md`, `docs/deploy/preproduccion-homelab.md`
- Test: `tests/unit/csp-headers.test.ts`, `tests/unit/deploy/readiness.test.ts`, `tests/unit/deploy/guides.test.ts`, `tests/unit/deploy/preprod-wiring.test.ts`, `tests/unit/deploy/production-wiring.test.ts`, `tests/unit/scripts/check-rpc.test.ts`

**Interfaces:**
- Consumes: `NETWORKS`, `chainsForSet` y `networkSet` (Tarea 2).
- Produces in `headers.ts`:
  - `HeaderEnv` gana `networkSet: NetworkSet`;
  - `PUBLIC_RPCS: Record<NetworkSet, readonly string[]>`, con mainnet `["https://mainnet.base.org", "https://arb1.arbitrum.io"]` y testnet `["https://sepolia.base.org", "https://sepolia-rollup.arbitrum.io"]`;
  - `headerEnvFromProcess` lee `NEXT_PUBLIC_NETWORK_SET`, `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` y `NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL`. `headers.ts` no importa `networks.ts`: un test asegura la paridad.
- Produces in `readiness.ts`, dentro de `productionEnvProblems(env)`:
  - `NEXT_PUBLIC_NETWORK_SET must be mainnet`;
  - `BASE_RPC_URL is required` y `ARBITRUM_RPC_URL is required` (en lugar de `LINEA_RPC_URL`);
  - `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL must be empty` y `NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL must be empty`;
  - `NEXT_PUBLIC_BASE_BUILDER_CODE must be a builder code`, con `/^[A-Za-z0-9_-]{1,32}$/`;
  - `MUST_BE_UNSET` añade `NEXT_PUBLIC_CHAIN`, `LINEA_RPC_URL`, `LINEA_SEPOLIA_RPC_URL`, `NEXT_PUBLIC_LINEA_RPC_URL` y `NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL` (configuración vieja olvidada en Vercel).
- Produces in `scripts/check-rpc.mjs`:
  - tabla `CHAINS` con las 4 redes `{ name, usdc, rpcEnv }`;
  - `--chain <id>`; sin argumento, todas las redes de `NEXT_PUBLIC_NETWORK_SET`;
  - mensaje de cadena inválida: `usa --chain 8453|42161|84532|421614`.

- [ ] **Step 1: Tests que fallan.**
  - `csp-headers.test.ts`:
    - `connect-src` con `networkSet: "testnet"` contiene `https://sepolia.base.org` y `https://sepolia-rollup.arbitrum.io` y no contiene `linea`;
    - con `mainnet` contiene los dos de mainnet y ninguno de testnet;
    - la paridad: cada origen de `PUBLIC_RPCS[set]` es el `origin` de `NETWORKS[c].viemChain.rpcUrls.default.http[0]` para `c` en `chainsForSet(set)`.
  - `readiness.test.ts`: cada regla de Interfaces con su mensaje exacto; un entorno válido con `NEXT_PUBLIC_BASE_BUILDER_CODE: "bc_ttxulybv"` da `[]`; ningún mensaje contiene valores.
  - `check-rpc.test.ts`: el USDC de cada red es igual a `NETWORKS`.
  - `deploy/*`: los `.example` y el `Dockerfile` declaran `NEXT_PUBLIC_NETWORK_SET`, `NEXT_PUBLIC_BASE_BUILDER_CODE` y las dos `NEXT_PUBLIC_*_SEPOLIA_RPC_URL`, y ya no contienen `LINEA`. PRE tiene `NEXT_PUBLIC_NETWORK_SET=testnet` y PRO `mainnet`. Ningún secreto es `NEXT_PUBLIC_`.
- [ ] **Step 2: Ejecutar** `pnpm vitest run tests/unit/csp-headers.test.ts tests/unit/deploy tests/unit/scripts`. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Actualizar los `.example`, compose y `Dockerfile` (ARG y ENV). Las guías `docs/deploy/*` cambian la tabla de variables y el paso "cambiar `active_chain_id` a mano" por "habilitar Base y Arbitrum en /settings/economia".
- [ ] **Step 4: Ejecutar** el comando del paso 2 y `pnpm typecheck`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(deploy): variables BASE_*/ARBITRUM_*, CSP por conjunto de redes y readiness de mainnet`.

### Task 4: BD y servidor — propinas y bounties por red, sin comisión

**Files:**
- Create: `supabase/migrations/20261024100002_multired_payments.sql`, `supabase/tests/996_multired_payments.test.sql`
- Modify:
  - pgTAP con 59141/59144 en propinas o bounties: `600_tips`, `610_tips_fixes`, `620_member_tips_totals`, `710_bounties`, `720_bounty_realtime`, `840_f3_final_fixes`, `850_bounty_delete_guard`, `870_home_rail`, `880_polish_review` y `990_rate_limits` (solo las llamadas de propinas y bounties). Pasan a 84532/8453 y a las firmas nuevas.
  - `src/lib/payments/tip-actions.ts`, `src/lib/bounties/actions.ts`, `src/lib/payments/queries.ts`, `src/lib/bounties/queries.ts`, `src/lib/payments/confirm.ts`, `src/lib/errors.ts`, `src/app/(forum)/u/[address]/page.tsx`.
  - `src/components/chat/bounty-card.tsx`: quitar la rama `other_chain`.
  - `src/components/payments/tip-dialog.tsx` y `src/components/chat/bounty-dialog.tsx`: ajuste mínimo para compilar con las firmas nuevas (`chainId: economy.enabledChainIds[0]`, sin `feeBps`); la UI se rehace en las Tareas 11 y 12.
- Test: `tests/unit/payments/tip-actions.test.ts`, `tests/unit/bounties/actions.test.ts`, `tests/unit/bounties/queries.test.ts`, `tests/unit/payments/tips-queries.test.ts`, `tests/unit/payments/confirm.test.ts`, `tests/unit/errors.test.ts`

**Interfaces:**
- Consumes:
  - SQL: `public.chains`, `private.chain_enabled` y `members.receive_networks` (Tarea 1);
  - TS: `ChainId`, `isChainId`, `appChainIds` y `NetworkKey` (Tarea 2).
- Produces (SQL; cada firma vieja se borra con `drop function`):
  - `create_tip_intent(p_target_type text, p_target_id uuid, p_chain_id int, p_token text, p_amount numeric, p_anonymous boolean) returns jsonb`. Parte del cuerpo de `20261019700101_rate_limits.sql:511` y cambia esto:
    - sin `p_fee_bps`;
    - `chain_invalid` si `not private.chain_enabled(p_chain_id)`;
    - `network_not_accepted` si la red de `p_chain_id` no está en `receive_networks` del destinatario;
    - inserta `fee_bps = 0`, `min_fee_bps = 0`, `fee_amount = 0` y `platform_address = null`;
    - el JSON de vuelta es igual que hoy, con `feeAmount: "0"` y `platformAddress: null`.
  - `create_bounty(p_channel uuid, p_body jsonb, p_chain_id int, p_token text, p_amount numeric) returns uuid`. Parte de `20261018700002_bounties.sql:219`; `chain_invalid` si la red no está habilitada; guarda `chain_id = p_chain_id`.
  - `create_bounty_payment_intent(p_bounty uuid, p_chain_id int, p_amount numeric) returns jsonb`. Parte de `20261019700101_rate_limits.sql:617`, con estos cambios:
    - sin comisión y sin `bounty_chain_inactive`;
    - `chain_invalid` si la red no está habilitada;
    - `network_not_accepted` si quien resolvió no acepta esa red;
    - el token es siempre el del bounty;
    - el intent idempotente (a) solo se devuelve si es de `p_chain_id`; si es de otra red, se marca `expired` y se crea uno nuevo.
  - `member_tips_totals(p_member uuid) returns table (token text, total_text text, tip_count int)`: suma por token en las redes habilitadas.
  - `bounty_status(b public.bounties)`: sin la rama `other_chain` (última definición en `20261018800020_f3_final_fixes.sql:44`).
  - Se redefinen cambiando el filtro de cadena activa por `private.chain_enabled(<tabla>.chain_id)`, solo en las partes de propinas y bounties:
    - `member_bounty_record` (f3_final_fixes:154) y `member_unpaid_bounties` (:178);
    - `home_open_bounties` y `club_activity` (`20261019000004_polish_review_fixes.sql:105` y `:174`);
    - `broadcast_activity_event` (`20261019000003_home_and_rail.sql`).
    Las partes de la DAO siguen con `_active_chain()`.
- Produces (TS):
  ```ts
  // tip-actions.ts
  export type TipInput = { targetType: "message" | "profile"; targetId: string; chainId: ChainId; token: Token; amount: string; anonymous: boolean };
  // bounties/actions.ts
  createBountyAction(input: { channelId: string; body: unknown; chainId: ChainId; token: Token; amount: string })
  createBountyPaymentIntentAction(input: { bountyId: string; chainId: ChainId; amount: string })
  // payments/queries.ts
  getMemberTipTotals(supabase: SupabaseClient, memberId: string): Promise<TipTotal[]>
  getReceiveNetworks(supabase: SupabaseClient, memberId: string): Promise<NetworkKey[]> // RPC receive_networks_of; ante error o valor raro → ["base", "arbitrum"] filtrado a claves válidas
  ```
  - Las tres actions devuelven `invalid_input` si `chainId` no es un `ChainId`, y `chain_invalid` si `!appChainIds().includes(chainId)`; en ambos casos antes de llamar a la RPC (Review Focus 5).
  - `BountyStatus` pierde `"other_chain"`.
  - `TipIntent` no cambia de forma.
- `confirm.ts`: si `!isChainId(i.chain_id)` → `permanent("chain_disabled")`, sin tocar ninguna RPC de cadena (Review Focus 4).
- `errors.ts`:
  - nuevos: `network_not_accepted: "Esta persona no recibe pagos en esa red."` y `chain_disabled: "Esa red ya no está disponible."`;
  - se borran: `bounty_chain_inactive`, `fee_below_minimum` y `platform_not_configured`.

- [ ] **Step 1: Escribir `996_multired_payments.test.sql` (falla):**
  - una propina en 84532 y otra en 421614 crean intents con su `chain_id` y `fee_amount = 0`;
  - en 8453 (deshabilitada) da `chain_invalid`;
  - si el destinatario tiene `receive_networks = '{base}'`, una propina en 421614 da `network_not_accepted`;
  - `create_bounty(..., 421614, 'USDC', 1000000)` guarda 421614;
  - el pago de ese bounty en 84532 crea un intent en 84532 con el token del bounty;
  - el pago en 59141 da `chain_invalid`;
  - si existe un intent sin hashes en 421614, pedirlo en 84532 lo deja `expired` y devuelve otro nuevo;
  - `bounty_status` nunca devuelve `other_chain`;
  - `member_tips_totals(m)` suma las propinas de 84532 y 421614 en una fila por token y no cuenta una fila de 59141;
  - `home_open_bounties` incluye bounties de 84532 y 421614 y excluye los de 59141.
- [ ] **Step 2: Migrar los pgTAP** de la lista de Files a 84532/8453 y a las firmas nuevas. Los de las islas legadas no se tocan.
- [ ] **Step 3: Ejecutar** (con permiso) `pnpm db:test`. Esperado: FAIL en 996 y en los migrados.
- [ ] **Step 4: Escribir la migración** según Interfaces. Para cada función se copia su **última** definición, que está en la ruta citada.
- [ ] **Step 5: Ejecutar** (con permiso) `pnpm db:test`. Esperado: PASS de toda la suite.
- [ ] **Step 6: Tests unit que fallan:**
  - `createTipIntentAction` con `chainId: 8453` y build `testnet` da `chain_invalid` y no llama a `rpc`;
  - con `84532` llama a `create_tip_intent` con `p_chain_id: 84532` y sin `p_fee_bps`;
  - lo mismo para las dos actions de bounties;
  - `getMemberTipTotals` llama a `member_tips_totals` solo con `p_member`;
  - `getReceiveNetworks` devuelve `["arbitrum"]` para `["arbitrum"]` y `["base", "arbitrum"]` ante un error;
  - `confirmIntent` con un intent en 59141 llama a `fail_intent` con `chain_disabled` y no crea ningún cliente de cadena;
  - `bounties/queries` descarta filas con estado desconocido y ya no lista `other_chain`.
- [ ] **Step 7: Ejecutar** `pnpm vitest run tests/unit/payments tests/unit/bounties tests/unit/errors.test.ts`. Esperado: FAIL. **Implementar** y volver a ejecutar, más `pnpm typecheck`. Esperado: PASS.
- [ ] **Step 8: Commit** `feat(payments): propinas y bounties por red habilitada, sin comisión y con redes del destinatario`.

### Task 5: Pausa del legado DAO y ajustes de redes del SuperAdmin

**Files:**
- Create: `src/components/treasury/dao-paused.tsx`, `src/components/economy/networks-form.tsx`
- Modify:
  - `src/app/api/cron/dao/route.ts`;
  - `src/app/(forum)/dao/page.tsx`, `src/app/(forum)/dao/tesoreria/page.tsx` y `src/app/(forum)/dao/sorteos/[id]/page.tsx`;
  - `src/components/shell/sidebar.tsx` y `src/app/(forum)/layout.tsx`;
  - `src/components/home/home-sections.tsx` y `src/lib/search/actions-list.ts`;
  - `src/app/(forum)/settings/economia/page.tsx` y `src/lib/economy/actions.ts`.
- Delete: `src/components/economy/economy-form.tsx` (lo sustituye `networks-form.tsx`)
- Test: `tests/unit/treasury/cron-route.test.ts`, `tests/unit/economy/networks-form.test.tsx` (en lugar de `economy-form.test.tsx`), `tests/unit/economy/actions.test.ts`, `tests/unit/shell.test.tsx`, `tests/unit/search/*` (el test de `actions-list`)

**Interfaces:**
- Consumes: `getEconomyConfig().legacyDaoEnabled` y `.safes` (Tarea 2), y la RPC `set_chain_enabled` (Tarea 1).
- Produces:
  - `DaoPaused(): JSX.Element`. Copy: título "La DAO se está rehaciendo", texto "Pronto podrás donar a ElClub. en Base y Arbitrum.".
  - `setChainEnabledAction(chainId: ChainId, enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }>`. Valida `isChainId` y `appChainIds().includes` y luego llama a la RPC `set_chain_enabled`. Sustituye a `setActiveChainAction`, `setMinFeeAction` y `setChainAddressesAction`, que se borran.
  - `NetworksForm({ chains }: { chains: { chainId: ChainId; enabled: boolean; safe: string | null }[] })`. Una fila por red del build con su nombre (la Tarea 8 le añade el `NetworkLogo`), un interruptor accesible "Habilitar <red>" y la Safe acortada con enlace a `explorerAddress`.
  - `Sidebar` gana la prop `daoEnabled: boolean`; con `false` no muestra la entrada "DAO".
  - `actionsList(..., { daoEnabled })` omite `dao` y `donate` cuando es false.
  - La ruta del cron lee `app_config.legacy_dao_enabled` con el cliente admin. Si es false, devuelve `{ polls, rateLimits, chains: "legacy_paused" }` sin leer `chain_config` ni llamar a ningún paso por red.

- [ ] **Step 0: `ui-ux-pro-max`** para `DaoPaused` y `NetworksForm`.
- [ ] **Step 1: Tests que fallan:**
  - con `legacy_dao_enabled=false`, el cron no llama a `scanSafeOperations`, `runRaffleSteps` ni `takeSnapshot`, sigue llamando a `finalizeDuePolls` y responde `chains: "legacy_paused"`; con `true`, se comporta como hoy;
  - `NetworksForm` con `[{84532, true, safe}, {421614, false, null}]` muestra dos interruptores; pulsar "Habilitar Arbitrum Sepolia" llama a `setChainEnabledAction(421614, true)`; un error muestra el texto con `role="alert"`; cada interruptor mide ≥ 44 px (clase `min-h-11`);
  - `setChainEnabledAction(59141, true)` da `invalid_input`;
  - el sidebar no muestra "DAO" con `daoEnabled=false`;
  - las acciones de búsqueda no incluyen `donate`.
- [ ] **Step 2: Ejecutar** `pnpm vitest run tests/unit/treasury/cron-route.test.ts tests/unit/economy tests/unit/shell.test.tsx tests/unit/search`. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Cada página `/dao*` hace `if (!config.legacyDaoEnabled) return <DaoPaused />` al principio de su componente de datos.
- [ ] **Step 4: Ejecutar** lo mismo, más `pnpm typecheck`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(economy): legado DAO en pausa y redes habilitables por el SuperAdmin`.

### Task 6: Builder Codes (ERC-8021) en las transferencias de Base

**Files:**
- Create: `src/lib/web3/builder-code.ts`
- Modify: `src/lib/payments/use-send-transfer.ts`
- Test: `tests/unit/web3/builder-code.test.ts`, `tests/unit/payments/use-send-transfer.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const ERC8021_MARKER = "0x80218021802180218021802180218021";
  export function builderCodeSuffix(codes: readonly string[]): `0x${string}`; // esquema 0: hex(codes.join(",")) ‖ uint8(longitud en bytes) ‖ 0x00 ‖ marcador; código fuera de /^[A-Za-z0-9_-]{1,32}$/ → throw
  export function dataSuffixFor(chain: ChainId, code?: string): `0x${string}` | undefined; // por defecto process.env.NEXT_PUBLIC_BASE_BUILDER_CODE (referencia literal); undefined si la red no es "base" o el código está vacío
  ```
- `useSendTransfer()` mantiene su firma (`send(input: TransferInput)`).
  - USDC: `writeContractAsync({ ..., dataSuffix })`.
  - ETH: calcula el sufijo; si existe, lee `getBytecode(config, { address: to, chainId: chain })` (`wagmi/actions`). Solo si el resultado es `undefined` o `"0x"` llama a `sendTransactionAsync({ to, value, chainId, data: suffix })`; con código o si la lectura falla, envía sin `data` (P0-R6).

- [ ] **Step 1: Tests que fallan:**
  - `builderCodeSuffix(["baseapp", "morpho"]) === "0x626173656170702c6d6f7270686f0e0080218021802180218021802180218021"`, el vector de `ox/erc8021` `Attribution.toDataSuffix`;
  - `builderCodeSuffix(["bc_ttxulybv"]) === "0x62635f747478756c7962760b0080218021802180218021802180218021"`;
  - `builderCodeSuffix(["a,b"])` lanza;
  - `dataSuffixFor(84532, "bc_ttxulybv")` y `dataSuffixFor(8453, …)` devuelven ese valor; `dataSuffixFor(42161, …)`, `(421614, …)` y `(84532, "")` devuelven `undefined`;
  - `useSendTransfer`:
    - USDC en 84532 pasa `dataSuffix`;
    - USDC en 421614 no lo pasa;
    - ETH en 84532 hacia una EOA (`getBytecode` → `undefined`) pasa `data: <sufijo>`;
    - hacia un contrato (`"0x6080…"`) no pasa `data`;
    - si `getBytecode` lanza, no pasa `data`.
- [ ] **Step 2: Ejecutar** `pnpm vitest run tests/unit/web3/builder-code.test.ts tests/unit/payments/use-send-transfer.test.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar** sin dependencias nuevas: `ox` no es dependencia directa y la codificación del esquema 0 cabe en unas líneas con `stringToHex`, `numberToHex` y `concat` de viem.
- [ ] **Step 4: Ejecutar** el mismo comando. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(web3): sufijo ERC-8021 del Builder Code en las transferencias de Base`.

### Task 7: AppKit y login en las dos redes (D5)

**Files:**
- Modify: `src/lib/web3/chains.ts`, `src/lib/web3/appkit.ts`, `src/lib/web3/siwe.ts`, `src/components/auth/login-panel.tsx`
- Test: `tests/unit/siwe.test.ts`, `tests/unit/login-panel.test.tsx`, `tests/unit/web3/appkit-config.test.ts`, `tests/integration/web3-auth.test.ts` (chainId 84532)

**Interfaces:**
- Consumes: `appChainIds` y `NETWORKS` (Tarea 2).
- Produces `src/lib/web3/chains.ts`: `appChains(): readonly [Chain, ...Chain[]]`, las `viemChain` de `appChainIds()` con Base primero. Desaparecen `APP_CHAINS` y `getAppChain`.
- `buildLoginMessage(p)`: `invalid_input` si `p.chainId` no está en `appChainIds()`.
- `appkit.ts`:
  - `networks = appChains()`;
  - `customRpcUrls` en `eip155:84532` y `eip155:421614` desde las dos `NEXT_PUBLIC_*_SEPOLIA_RPC_URL`, con referencias literales;
  - `defaultNetwork` es la primera red;
  - `metadata.name` pasa a "ElClub.";
  - `enableBaseAccount` y `enableCoinbase` siguen en `false`.
- `LoginPanel`:
  - si la wallet está en una red de `appChainIds()`, firma con **esa** `chainId`;
  - si no, muestra el botón "Cambiar a Base" (o "Cambiar a Base Sepolia"), que cambia a la primera red;
  - la pista pasa a ser "Usa tu wallet en Base o Arbitrum.".

- [ ] **Step 1: Tests que fallan:**
  - `buildLoginMessage` acepta 84532 y 421614 con el conjunto `testnet` y rechaza 59141 y 8453;
  - el panel conectado en 421614 firma un mensaje con `Chain ID: 421614` sin pedir cambio de red;
  - conectado en 1 muestra "Cambiar a Base Sepolia" y llama a `switchChain({ chainId: 84532 })`;
  - ningún texto contiene "Linea";
  - `appkit-config` comprueba que las `networks` son `[84532, 421614]` y que los conectores de Coinbase y Base Account siguen desactivados.
- [ ] **Step 2: Ejecutar** `pnpm vitest run tests/unit/siwe.test.ts tests/unit/login-panel.test.tsx tests/unit/web3`. Esperado: FAIL.
- [ ] **Step 3: Investigar D5.**
  - Leer el verificador SIWE de `supabase/auth` (https://github.com/supabase/auth, `internal/utilities/siwe/` y el handler de web3) y anotar si verifica ERC-1271/ERC-6492 o solo `ecrecover`.
  - Anotar el resultado y la fecha en un comentario junto a `enableBaseAccount` en `appkit.ts`, y en la descripción del PR (P0-R11).
- [ ] **Step 4: Implementar.**
- [ ] **Step 5: Ejecutar** `pnpm vitest run tests/unit/siwe.test.ts tests/unit/login-panel.test.tsx tests/unit/web3` y `pnpm typecheck`. Esperado: PASS. `tests/integration/web3-auth.test.ts` se ejecuta en la Tarea 14.
- [ ] **Step 6: Commit** `feat(auth): login SIWE en Base o Arbitrum según la red conectada`.

### Task 8: Iconografía — logos de red y de token, insignia "MODO PRUEBA"

**Files:**
- Create:
  - `public/brand/networks/base.svg`, `public/brand/networks/arbitrum.svg`, `public/brand/tokens/usdc.svg` y `public/brand/tokens/eth.svg`;
  - `src/components/economy/network-logo.tsx`, `src/components/economy/asset-logo.tsx` y `src/components/economy/test-mode-badge.tsx`.
- Delete: `src/components/economy/network-badge.tsx` (y su test)
- Modify: `src/components/shell/sidebar.tsx`, `src/app/(forum)/layout.tsx`, `src/components/onboarding/welcome-steps.tsx`, `src/app/(onboarding)/bienvenida/page.tsx`, `src/components/economy/networks-form.tsx`, `src/components/profile/tips-received.tsx`, `src/components/profile/bounty-record.tsx`, `src/components/chat/bounty-dialog.tsx`, `src/components/payments/tip-dialog.tsx` (cambio de `NetworkBadge` por `NetworkLogo`)
- Test: `tests/unit/economy/network-logo.test.tsx`, `tests/unit/economy/asset-logo.test.tsx`, `tests/unit/economy/test-mode-badge.test.tsx`

**Interfaces:**
- Produces:
  - `NetworkLogo({ chainId, size = 20, withName = false, className }: { chainId: ChainId; size?: number; withName?: boolean; className?: string })`. `<img src={NETWORKS[chainId].logo}>` redondo (`rounded-full`). Con `withName`, el nombre va al lado; sin él, el logo lleva `alt` con el nombre.
  - `AssetLogo({ token, chainId, size = 28 }: { token: Token; chainId: ChainId; size?: number })`:
    - logo redondo del token y, superpuesto abajo a la derecha, el logo de la red al 45 % del tamaño, con `ring-2 ring-bg` (decisión del usuario 2: USDC y ETH existen en las dos redes, así que la insignia siempre aparece);
    - el contenedor tiene `role="img"` y `aria-label="USDC en Base"`; las `<img>` internas, `alt=""`.
  - `TestModeBadge({ compact = false, responsive = false, className })`. Muestra "MODO PRUEBA" (o "PRUEBA" en compacto) con el token `warning` solo si `networkSet() === "testnet"`; en mainnet devuelve `null` (P0-R12).
- SVG: tomados de los kits de marca oficiales (Base: base.org/brand; Arbitrum: arbitrum.io brand kit; USDC: kit de marca de Circle; ETH: ethereum.org/assets). La primera línea de cada SVG es `<!-- fuente: <URL>, <fecha> -->`. Se respetan las guías de uso de cada marca. Sin hex fuera de estos ficheros.

- [ ] **Step 0: `ui-ux-pro-max`** para el sistema de logos (tamaños 16/20/28/40, contraste del aro sobre `bg`/`surface-2`).
- [ ] **Step 1: Tests que fallan:**
  - `AssetLogo` de `USDC` en 421614 se anuncia como "USDC en Arbitrum Sepolia" y contiene dos imágenes con `src` `/brand/tokens/usdc.svg` y `/brand/networks/arbitrum.svg`;
  - `NetworkLogo` con `withName` muestra "Base Sepolia";
  - `TestModeBadge` muestra "MODO PRUEBA" con `NEXT_PUBLIC_NETWORK_SET=testnet` y nada con `mainnet`.
- [ ] **Step 2: Ejecutar** `pnpm vitest run tests/unit/economy`. Esperado: FAIL.
- [ ] **Step 3: Implementar** y sustituir `NetworkBadge` en los ficheros de la lista. El layout y el sidebar muestran `TestModeBadge`; las filas de propinas y bounties del perfil muestran el `NetworkLogo` de su `chainId`.
- [ ] **Step 4: Ejecutar** `pnpm test:unit` y `pnpm typecheck`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(ui): logos redondos de red y token y aviso de modo prueba por entorno`.

### Task 9: Selector de token con saldos y cambio de red

**Files:**
- Create: `src/components/payments/asset-picker.tsx`, `src/lib/payments/balances.ts`, `src/lib/payments/use-ensure-chain.ts`
- Test: `tests/unit/payments/asset-picker.test.tsx`, `tests/unit/payments/balances.test.tsx`, `tests/unit/payments/use-ensure-chain.test.tsx`

**Interfaces:**
- Consumes: `Asset`, `AssetId`, `AssetBalances` y `rankAssets` (Tarea 2), y `AssetLogo` (Tarea 8).
- Produces:
  ```ts
  // balances.ts ("use client")
  export function useAssetBalances(assets: readonly Asset[], account: `0x${string}` | undefined): AssetBalances;
  // useQueries de @tanstack/react-query con getBalance / readContract(balanceOf) de wagmi/actions y su chainId;
  // incluye siempre ETH de cada red presente (lo necesita rankAssets); null cuando falla la lectura
  // use-ensure-chain.ts ("use client")
  export function useEnsureChain(): { ensure(chainId: ChainId): void; switching: boolean; failedFor: ChainId | null };
  // si la cuenta está conectada y en otra red, switchChain({ chainId }); un error deja failedFor = chainId
  // asset-picker.tsx
  export function AssetPicker(props: {
    assets: readonly Asset[]; balances: AssetBalances; amount: bigint | null;
    value: AssetId | null; onChange(id: AssetId): void; label?: string; // por defecto "Moneda"
  }): JSX.Element;
  ```
- `AssetPicker` es un `role="radiogroup"` con una fila `role="radio"` por activo, en el orden de `rankAssets`.
  - Cada fila: `AssetLogo`, "USDC" y el nombre de la red en `text-fg-muted`; a la derecha, "Saldo: 12,5" (o "—" si es desconocido). Mide `min-h-11`.
  - Se navega con flechas (patrón radiogroup) y el foco es visible.
  - Las filas de rango 2 (saldo 0) no se deshabilitan: se pueden elegir y el formulario explica por qué no se puede pagar.
  - Si hay algún USDC de Arbitrum, debajo aparece la nota "En Arbitrum solo vale USDC nativo (no USDC.e).".

- [ ] **Step 0: `ui-ux-pro-max`** para el selector: lista compacta en móvil (375 px) y en escritorio; estados elegido, foco y sin saldo.
- [ ] **Step 1: Tests que fallan:**
  - con 4 activos y saldos que solo cubren `ETH:421614`, ese es el primer radio;
  - pulsar el radio de `USDC:84532` llama a `onChange("USDC:84532")`;
  - ArrowDown mueve la selección;
  - aparece la nota de USDC.e solo si hay USDC de 421614 o 42161;
  - `useAssetBalances` devuelve `null` para un activo cuya lectura falla y el valor para los demás;
  - `useEnsureChain().ensure(421614)` con la cuenta en 84532 llama a `switchChain({ chainId: 421614 })`; con la cuenta ya en 421614 no la llama; si `switchChain` falla, `failedFor === 421614`.
- [ ] **Step 2: Ejecutar** `pnpm vitest run tests/unit/payments/asset-picker.test.tsx tests/unit/payments/balances.test.tsx tests/unit/payments/use-ensure-chain.test.tsx`. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Ejecutar** el mismo comando. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(payments): selector de token por saldo con cambio de red automático`.

### Task 10: Redes en las que recibes (perfil, D22)

**Files:**
- Create: `src/components/profile/receive-networks-form.tsx`
- Modify: `src/app/(forum)/perfil/page.tsx`, `src/lib/profile/actions.ts`
- Test: `tests/unit/profile/receive-networks-form.test.tsx`, `tests/unit/profile/actions.test.ts`

**Interfaces:**
- Consumes: la RPC `set_receive_networks` (Tarea 1) y `NetworkKey` y `NetworkLogo` (Tareas 2 y 8).
- Produces:
  - `setReceiveNetworksAction(networks: NetworkKey[]): Promise<ActionResult>`. `invalid_input` si la lista está vacía o trae claves desconocidas.
  - `ReceiveNetworksForm({ initial }: { initial: NetworkKey[] })`:
    - título "Redes en las que recibes";
    - una casilla por red con su `NetworkLogo`, sin poder desmarcar la última;
    - aviso: "Si tu dirección es de un exchange o una smart wallet, deja solo la red que admite.";
    - botón "Guardar".
  - `perfil/page.tsx` añade `receive_networks` al `select` de `members` y pinta el formulario después de `ProfileForm`.

- [ ] **Step 0: `ui-ux-pro-max`** para el formulario.
- [ ] **Step 1: Tests que fallan:**
  - con `initial ["base","arbitrum"]`, desmarcar Base y guardar llama a `setReceiveNetworksAction(["arbitrum"])`;
  - con una sola marcada, esa casilla queda `disabled` y tiene `aria-describedby` con el texto "Tiene que quedar al menos una red.";
  - `setReceiveNetworksAction([])` y `(["linea"])` dan `invalid_input` sin llamar a la RPC.
- [ ] **Step 2: Ejecutar** `pnpm vitest run tests/unit/profile`. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Ejecutar** el mismo comando y `pnpm typecheck`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(profile): elegir en qué redes recibes pagos`.

### Task 11: Propinas — primero el token, una transacción, sin comisión

**Files:**
- Modify: `src/components/payments/tip-dialog.tsx`, `src/lib/payments/preflight.ts`, `src/lib/payments/pending-sends.ts`, `src/components/payments/pending-sends-sync.tsx`, `src/lib/economy/networks.ts` (borra las utilidades de comisión)
- Delete:
  - `src/components/payments/fee-control.tsx` y `tests/unit/payments/fee-control.test.tsx`;
  - `src/components/treasury/donate-button.tsx` y `tests/unit/payments/tip-dialog-donation.test.tsx` (el modo donación vuelve en P1; `createDonationIntentAction` y la BD se conservan);
  - su uso en `src/app/(forum)/dao/page.tsx`.
- Test: `tests/unit/payments/tip-dialog.test.tsx`, `tests/unit/payments/preflight.test.ts`, `tests/unit/payments/pending-sends-sync.test.tsx`, `tests/unit/payments/pending-sends.test.ts` (nuevo si no existe)

**Interfaces:**
- Consumes:
  - `AssetPicker`, `useAssetBalances` y `useEnsureChain` (Tarea 9);
  - `getReceiveNetworks` (Tarea 4), leído en el cliente con `createBrowserClient()` al abrir;
  - `createTipIntentAction` con `chainId` (Tarea 4);
  - `useSendTransfer` con el sufijo (Tarea 6);
  - `AssetLogo` y `NetworkLogo` (Tarea 8);
  - `economy.enabledChainIds`.
- Produces:
  ```ts
  // preflight.ts
  export type PreflightInput = { chain: ChainId; token: Token; amount: bigint; mainLabel: string; eth: bigint; usdc: bigint };
  export function preflightShortfall(i: PreflightInput): string | null;
  export function formBalanceError(i: { chain: ChainId; token: Token; amount: bigint; balance: bigint; eth: bigint }): string | null;
  export function useBalancePreflight(): (a: Omit<PreflightInput, "eth" | "usdc"> & { account: `0x${string}` }) => Promise<string | null>;
  // pending-sends.ts
  export function pruneUnsupportedSends(memberId: string, enabled: readonly ChainId[]): number; // borra las entradas con feeRequired o con chainId fuera de enabled; devuelve cuántas
  ```
- `TipDialog` mantiene sus props sin `DonationMode`: `{ target, recipient }` o `{ mode: BountyMode, recipient }`.
  - **Los activos** son `assetsFor(economy.enabledChainIds, receiveNetworks)`. La selección inicial es el primero de `rankAssets` cuando llegan los saldos.
  - **Elegir un activo** llama a `ensure(asset.chainId)`.
  - **Wallet en otra red** (`wallet === "chain"`): "Tu wallet está en otra red." y el botón "Cambiar a <red>".
  - **Las firmas** son una sola transferencia (`progress` siempre 1/1). Desaparecen la rama de comisión, los pasos "Comisión" y `feeBpsFor`.
  - **El resumen** es "Para <nombre>: <importe> <token>" junto al `AssetLogo`. No hay fila de comisión ni de total.
  - **Copy de la descripción:** "Va directo a su wallet." (bounty: "Va directo a la wallet de quien dio la solución.").
  - **Al abrir** se llama a `pruneUnsupportedSends(memberId, economy.enabledChainIds)` antes de `evaluate` (Review Focus 4). `PendingSendsSync` hace lo mismo al montar.
  - **Destinatario sin redes en común** con `enabledChainIds`: "Esta persona no recibe pagos en las redes disponibles." y sin botón "Continuar".

- [ ] **Step 0: `ui-ux-pro-max`** para el nuevo diálogo: selector arriba, importe y resumen; 375 px sin scroll horizontal; `md:grid-cols-2` como hoy.
- [ ] **Step 1: Tests que fallan** (`tip-dialog.test.tsx`, con wagmi, AppKit y actions simulados como hoy):
  - con `receive_networks ["arbitrum"]` solo se ven radios de Arbitrum Sepolia (Review Focus 2);
  - elegir `USDC:421614` con la cuenta en 84532 llama a `switchChain({ chainId: 421614 })`;
  - si el cambio falla, se ve "Cambiar a Arbitrum Sepolia", "Continuar" está deshabilitado y no se llama a `send` (Review Focus 1);
  - al continuar se llama a `createTipIntentAction` con `{ chainId: 421614, token: "USDC", amount: "1", anonymous: false, … }` y sin `feeBps`;
  - después, `send` se llama una sola vez con `to = recipient.walletAddress`;
  - un intent devuelto con `chainId` distinto del elegido da "Los datos del envío no coinciden. Recarga la página." y no firma;
  - en ningún paso aparece el texto "Comisión";
  - con una entrada de ledger `feeRequired: true` en 59141, el diálogo abre en el formulario y la entrada desaparece de `localStorage` (Review Focus 4);
  - `preflightShortfall` con USDC suficiente y ETH 0 da "Necesitas algo de ETH en Base Sepolia para pagar el gas.".
- [ ] **Step 2: Ejecutar** `pnpm vitest run tests/unit/payments`. Esperado: FAIL.
- [ ] **Step 3: Implementar** y borrar los ficheros de la lista Delete. `grep -rn "FeeControl\|feeBps\|bpsToPercentText\|DonationMode" src` → sin resultados.
- [ ] **Step 4: Ejecutar** `pnpm test:unit` y `pnpm typecheck`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(payments): propinas eligiendo token, una sola transferencia y sin comisión`.

### Task 12: Bounties en las dos redes

**Files:**
- Modify: `src/components/chat/bounty-dialog.tsx`, `src/components/chat/bounty-card.tsx`, `src/components/payments/tip-dialog.tsx` (solo el modo bounty), `src/components/profile/bounty-record.tsx`, `src/components/profile/tips-received.tsx`, `src/app/(forum)/u/[address]/page.tsx`
- Test: `tests/unit/chat/bounty-dialog.test.tsx` (o el fichero que hoy cubre `BountyDialog`; búscalo con `grep -rl "BountyDialog" tests`), `tests/unit/payments/tip-dialog-bounty.test.tsx`, `tests/unit/profile/bounty-record.test.tsx`, `tests/unit/profile/tips-received.test.tsx`

**Interfaces:**
- Consumes:
  - `createBountyAction` y `createBountyPaymentIntentAction` con `chainId` (Tarea 4);
  - `AssetPicker`, `useAssetBalances` y `useEnsureChain` (Tarea 9);
  - `getReceiveNetworks` (Tarea 4).
- Produces:
  - `BountyMode = { kind: "bounty"; bountyId: string; token: Token; minAmount: bigint; chainId: ChainId /* red anunciada */; solverId: string }`.
  - **Creación:** `BountyDialog` cambia el radiogroup de token por un `AssetPicker` con `assetsFor(economy.enabledChainIds)` y los saldos del creador (solo como guía: crear un bounty no mueve fondos), y envía `{ chainId, token }` del activo. Copy bajo el selector: "La red es orientativa: podrás pagar con el mismo token en otra red que acepte quien lo resuelva.".
  - **Pago:**
    - activos = `assetsFor(enabledChainIds, receiveNetworks(solver)).filter(a => a.token === mode.token)`;
    - selección inicial: el de `mode.chainId` si está; si no, el primero de `rankAssets`;
    - desaparecen `bountyInactive` y su copy.
  - `TipsReceived({ entries, totals })` y `BountyRecordSection({ record, unpaid })` pierden `activeChainId`. Los totales son por token; cada fila de la lista muestra el `NetworkLogo` de su red.

- [ ] **Step 0: `ui-ux-pro-max`** para el selector dentro de `BountyDialog`.
- [ ] **Step 1: Tests que fallan:**
  - crear un bounty eligiendo `ETH:421614` llama a `createBountyAction` con `{ chainId: 421614, token: "ETH", … }`;
  - pagar un bounty anunciado en 84532 con quien lo resolvió aceptando `["base","arbitrum"]` muestra dos radios de USDC (84532 y 421614) y ninguno de ETH, con 84532 elegido;
  - si acepta solo `["arbitrum"]`, solo aparece 421614 y está elegido;
  - pagar llama a `createBountyPaymentIntentAction({ bountyId, chainId, amount })`;
  - no aparece la frase "vuelva a estar activa";
  - `TipsReceived` con propinas en 84532 y 421614 muestra un total por token y dos logos de red distintos.
- [ ] **Step 2: Ejecutar** `pnpm vitest run tests/unit/chat tests/unit/payments/tip-dialog-bounty.test.tsx tests/unit/profile`. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Ejecutar** `pnpm test:unit` y `pnpm typecheck`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(bounties): crear y pagar bounties en Base o Arbitrum con el mismo token`.

### Task 13: E2E multired — dos nodos Hardhat, wallet que cambia de red, specs

**Files:**
- Modify: `e2e/chain/shared.mjs`, `e2e/chain/start-chain.mjs`, `e2e/chain/hardhat.config.cjs`, `e2e/helpers/wallet.ts`, `e2e/helpers/auth.ts`, `playwright.config.ts`, `e2e/f3b-tips.spec.ts`, `e2e/f3c-bounties.spec.ts`, `e2e/f3a-profiles.spec.ts`, `e2e/f2b-chat.spec.ts`, `e2e/f2d-search.spec.ts`, `e2e/f5-headers.spec.ts`
- Move: `e2e/f3d-treasury.spec.ts`, `e2e/f4a-fund.spec.ts`, `e2e/f4c-withdrawals.spec.ts`, `e2e/f4d-raffles.spec.ts` y `e2e/f4e-polls.spec.ts` → `e2e/legacy/` (con `testIgnore: ["legacy/**"]` en `playwright.config.ts` y un comentario "P0-R2: se reescriben en P1")
- Test: los propios specs

**Interfaces:**
- Produces `e2e/chain/shared.mjs`:
  ```js
  export const CHAINS = {
    84532:  { rpcPort: 8545, rpcUrl: "http://127.0.0.1:8545", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
    421614: { rpcPort: 8546, rpcUrl: "http://127.0.0.1:8546", usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" },
  };
  export const DEFAULT_CHAIN_ID = 84532;
  // READY_PORT 8547, HARDHAT_MNEMONIC, MINT_PER_ACCOUNT, MINTED_ACCOUNTS, hardhatAccount(): sin cambios
  ```
  Desaparecen `CHAIN_ID`, `USDC_ADDRESS`, `ETH_USD_FEED_ADDRESS`, `WETH_ADDRESS` e `INITIAL_ETH_PRICE_E8`. Los JSON de los mocks de feed y WETH se quedan en el repo para P1.
- `hardhat.config.cjs`: el `chainId` se lee de `process.env.E2E_CHAIN_ID` (por defecto 84532).
- `start-chain.mjs` arranca dos `hardhat node`, uno con `E2E_CHAIN_ID` por red. En cada uno comprueba `eth_chainId`, pone el mock de USDC en la dirección de esa red y acuña. `READY_URL` responde 200 cuando ambos están listos.
- `wallet.ts`:
  - `injected({ address, rpcUrls, chainId })`, con `rpcUrls: Record<number, string>` y `chainId` inicial;
  - guarda la red actual;
  - `wallet_switchEthereumChain` hacia una red conocida la cambia y emite `chainChanged`; hacia otra lanza 4902;
  - `eth_chainId` y el reenvío al nodo usan la red actual;
  - se borra `linea_estimateGas`;
  - `installTestWallet(context, { address, onSent?, chainId? })`.
- `auth.ts`: `CHAIN_ID = 84532`.
- `playwright.config.ts`, en `env`:
  - `NEXT_PUBLIC_NETWORK_SET: "testnet"`;
  - `BASE_SEPOLIA_RPC_URL` y `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` = `CHAINS[84532].rpcUrl`;
  - `ARBITRUM_SEPOLIA_RPC_URL` y `NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL` = `CHAINS[421614].rpcUrl`;
  - `NEXT_PUBLIC_BASE_BUILDER_CODE: "bc_e2etest"`.
  
  Se quitan `NEXT_PUBLIC_CHAIN`, `LINEA_*`, `*_59141` y `COINGECKO_DISABLED`; esta última solo si ningún spec activo la usa, porque `f4b` usa `COINGECKO_API_BASE`.

- [ ] **Step 1: Specs (fallan hasta tener la infraestructura):**
  - `f3b-tips`:
    - el flujo actual sin el paso de comisión, en 84532, y la propina acreditada;
    - **nuevo:** propina en `USDC:421614`: la wallet cambia de red sola y la propina se acredita con `chain_id = 421614` en `tips`;
    - **nuevo (Builder Code):** el `input` de la transacción en 84532 (`eth_getTransactionByHash` en `:8545`) termina en `builderCodeSuffix(["bc_e2etest"]).slice(2)`, y el de la de 421614 no contiene `80218021802180218021802180218021`;
    - **nuevo:** con el destinatario en `receive_networks = '{base}'` (fijado con el cliente admin), el selector no ofrece Arbitrum Sepolia;
    - `watchCsp` devuelve `[]` al final.
  - `f3c-bounties`: crear en `USDC:84532` y pagar en `USDC:421614`; el bounty queda "Pagado" y el `onchain_transfers.chain_id` es 421614.
  - `f3a`, `f2b`, `f2d` y `f5`: cambiar 59141 por 84532 donde sea dato y quitar los textos con "Linea".
- [ ] **Step 2: Implementar** la infraestructura de Interfaces.
- [ ] **Step 3: Ejecutar** (con permiso del usuario) `pnpm test:e2e`. Esperado: PASS de todo lo no legado. Si hay una violación de CSP, falta un origen: se añade a `PUBLIC_RPCS` o `WALLET_CONNECT` con un comentario que nombre a quien lo llama, y al test unit.
- [ ] **Step 4: Ejecutar** (con permiso) `E2E_PROD=1 pnpm exec playwright test e2e/f3b-tips.spec.ts e2e/f3c-bounties.spec.ts e2e/f5-headers.spec.ts`. Esperado: PASS.
- [ ] **Step 5: Commit** `test(e2e): dos nodos Hardhat (Base Sepolia y Arbitrum Sepolia), wallet multired y specs de propinas y bounties`.

### Task 14: Textos, guía, documentación y verificación final

**Files:**
- Modify:
  - `src/components/guide/guide-content.tsx`: propinas, bounties, redes, sin comisión; las secciones de la DAO y los sorteos dicen "se está rehaciendo";
  - `src/app/start/page.tsx`, `src/app/start/opengraph-image.tsx`, `src/components/start/hero.tsx`, `features.tsx`, `final-cta.tsx`, `how-to-join.tsx`, `mocks.tsx` y `noise-to-signal.tsx`: solo cambian los textos de Linea a "Base y Arbitrum"; `/start` se reforma en P2;
  - `src/components/onboarding/welcome-steps.tsx`;
  - `README.md`, si menciona Linea;
  - `docs/superpowers/specs/2026-10-24-base-arbitrum-y-parte-publica-design.md`: marcar P0 como hecho y apuntar los rulings P0-R*.
- Create: `tests/unit/no-linea.test.ts`
- Test: `tests/unit/guide/*`, `tests/unit/start/*`, `tests/unit/onboarding/*`, `tests/unit/no-linea.test.ts`

- [ ] **Step 1: Tests que fallan:**
  - un test recorre `src/` (excepto `src/lib/legacy/**`, `src/lib/treasury/**`, `src/components/treasury/**`, `src/app/(forum)/dao/**`, `src/lib/polls/**`, `src/lib/chat/linea.ts` y `src/components/chat/alpha-*.tsx`) y no encuentra `/linea/i` en ningún `.ts` ni `.tsx`;
  - la guía contiene "Base" y "Arbitrum" y no contiene "comisión";
  - `/start` no contiene "Linea".
- [ ] **Step 2: Ejecutar** `pnpm vitest run tests/unit/guide tests/unit/start tests/unit/onboarding tests/unit/no-linea.test.ts`. Esperado: FAIL.
- [ ] **Step 3: `ui-ux-pro-max`** solo si el cambio de texto altera la maquetación de `/start`. Después, escribir los textos: cortos; cada pantalla de dinero recuerda "ElClub. no custodia fondos".
- [ ] **Step 4: Ejecutar** el comando del paso 2. Esperado: PASS.
- [ ] **Step 5: Verificación final** (con permiso del usuario, porque borra la BD local): `pnpm lint && pnpm typecheck && pnpm test && pnpm db:test && pnpm test:e2e`. Esperado: todo PASS (los e2e de `e2e/legacy/` excluidos).
- [ ] **Step 6: Commit** `docs: guía y textos de Base y Arbitrum; P0 cerrado en el spec`.

---

## ⚠️ HACER A MANO ⚠️ (el usuario)
1. **Activar la Safe** `0x380f2e12081995359e2Ab88E3c31c6b227904234` en Base, Arbitrum, Base Sepolia y Arbitrum Sepolia desde app.safe.global ("añadir red" → desplegar).
   - Después, comprobar **owners y umbral** en cada red. Una Safe añadida a otra red se despliega con la configuración **original**, no con los cambios posteriores; si no coinciden, corregirlos en esa red.
   - Confirmar que `eth_getCode` ya no devuelve `0x` (o ejecutar `pnpm check:rpc` cuando haya RPC).
   - P0 no acepta donaciones; P1 sí, y exige esto.
2. **Vercel (Production):**
   - definir `NEXT_PUBLIC_NETWORK_SET=mainnet`, `BASE_RPC_URL`, `ARBITRUM_RPC_URL` y `NEXT_PUBLIC_BASE_BUILDER_CODE=bc_ttxulybv`;
   - **borrar** `NEXT_PUBLIC_CHAIN`, `LINEA_RPC_URL`, `LINEA_SEPOLIA_RPC_URL`, `NEXT_PUBLIC_LINEA_RPC_URL` y `NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL`, porque la readiness hace fallar el build si quedan.
3. **PRE (`web.env` del homelab):** `NEXT_PUBLIC_NETWORK_SET=testnet`, `BASE_SEPOLIA_RPC_URL`, `ARBITRUM_SEPOLIA_RPC_URL` y `NEXT_PUBLIC_BASE_BUILDER_CODE=bc_ttxulybv`; quitar las `LINEA_*`. En local, lo mismo en `.env.local`.
4. **Reown:** en los dos proyectos ("elclub prod" y "elclub dev/pre"), comprobar que admiten Base y Arbitrum (y sus Sepolia en dev/pre). No hace falta tocar los dominios.
5. (Nada que hacer en PRO tras migrar: la migración habilita las cuatro redes no Linea en todas las BD y cada build solo usa su conjunto; ver P0-R14.)
6. **PRE, opcional:** reiniciar los datos de prueba de Linea desde el SuperAdmin o con `supabase db reset` en el homelab. Ya no se muestran, pero siguen en la BD.
7. **Wallets de prueba:** añadir Base Sepolia y Arbitrum Sepolia en MetaMask y pedir ETH de prueba en los faucets oficiales, y USDC de prueba en faucet.circle.com.
