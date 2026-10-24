# P1 — Club simplificado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El club privado queda sin riesgo legal y multired. Las encuestas son de 1 miembro = 1 voto. Las alphas funcionan en Base y Arbitrum. Las donaciones van a la Safe del club en cualquier token y red y dan el rol Mecenas, la lista de donantes, canales con candado por lo donado y transparencia con gastos anotados. Los sorteos son gratis, de peso igual, con azar de drand y premios en USDC, en rol o de texto libre. La guía cuenta todo esto. «Inicio» se rehace como un dashboard visual con el buscador como protagonista.

**Architecture:**
- **Nada del legado se borra (D10).** Las tablas `dao_*`, `raffles` y `chain_config`, sus funciones y sus pgTAP se quedan congelados.
  - Las funciones nuevas viven en tablas nuevas: `donations`, `club_expenses`, `giveaways*`.
  - Las rutas `/dao*` redirigen a `/donar` y a `/sorteos`.
- **Donaciones = el patrón de propinas.** Se usan `payment_intents` (purpose `donation`, target `dao`), `attach_intent_tx`, `_record_payment_transfers`, `verifyTransfer`, `confirmIntent`, `AssetPicker` y `pending-sends`. El destinatario es `chains.safe_address` de la red elegida, y solo si `getCode` ≠ `0x`. El valor en USD se fija al verificar: USDC 1:1 y ETH con Chainlink de esa red, comprobando además el secuenciador en mainnet.
- **Sorteos («giveaways»).**
  - Commit `keccak(seed)` al crear, con la ronda objetivo de **drand quicknet** publicada.
  - El cron descarga la ronda, verifica la firma BLS en TS y llama a `draw_giveaway`. Esa función comprueba en SQL que `randomness = sha256(firma)` y elige a los ganadores con keccak.
  - El navegador lo puede recalcular todo.
- **«Inicio»:**
  - el motor de la paleta Ctrl+K se extrae a un hook y un renderizador compartidos;
  - un campo inline con cmdk los reutiliza;
  - dos RPC nuevas dan los datos del dashboard.

**Tech Stack:** Next.js 16.4 (App Router, cacheComponents), Supabase (definer RPCs, RLS, pgTAP), viem 2.57.7, wagmi 3, Reown AppKit, cmdk 1.1.1, motion 14, lucide-react, `@noble/curves` 1.9.7 (nueva dependencia directa, ya está en el store de pnpm), Vitest y Playwright con dos nodos Hardhat.

**Spec:** `docs/superpowers/specs/2026-10-24-base-arbitrum-y-parte-publica-design.md`.
- Apartados: §Prioridades P1; decisiones del usuario 3, 4, 5, 7, 11 y 13; y D6–D13, D19, D24 y D26.
- Mapas del código, con `ruta:línea`, generados al planificar (scratchpad de la sesión; resumidos aquí donde importa):
  - donaciones, gating, roles y Safe;
  - sorteos y encuestas;
  - alphas, guía, Inicio y buscador.

## Decisiones del constructor (rulings P1-R*, huecos del spec resueltos al planificar)
- **P1-R1, `/donar` dentro del club.**
  - En P1 solo donan miembros, y `/donar` es una ruta del foro.
  - La donación de no miembros («donante externo», decisión 11) y la versión pública llegan en P2 con las cuentas públicas (D15).
  - Aun así, `donations` guarda `donor_address` y `member_id` puede ser nulo, para que P2 no tenga que migrar.
- **P1-R2, lista de donantes con opción de salir (decisión 4).** Columna nueva `members.donor_visible boolean not null default true`.
  - `dao_ranking_visible` es del legado y por defecto vale `false`, así que no se reutiliza.
  - En P1 la lista solo la ven miembros. P2 mostrará alias públicos, nunca el handle del club (decisión 12).
- **P1-R3, Mecenas desde 1 USD.** El rol `Mecenas` se asigna cuando la suma de donaciones verificadas del miembro llega a `app_config.donor_role_min_usd6`, que por defecto es `1000000` (1 USD).
  - Es un rol con `system_key = 'donor'` e `is_system = false`, siguiendo el patrón de Verificado y Padrino.
  - No se quita nunca de forma automática.
- **P1-R4, candados por lo donado (D8).** El candado de canal pasa a ser una sola regla, `gate_min_donated_usd6`: el total donado por el miembro tiene que ser ≥ X.
  - Las columnas `gate_min_share_bps` y `gate_min_net_usdc` se quedan en la tabla pero se ignoran y se ponen a `null`.
  - Los pgTAP legados del gating se actualizan a la regla nueva.
- **P1-R5, precio de ETH solo con Chainlink.**
  - Las direcciones están verificadas on-chain el 2026-10-24 con `description() = "ETH / USD"`; ver Global Constraints.
  - En mainnet se comprueba además el feed del secuenciador: `answer = 0` y al menos 3600 s desde `startedAt`.
  - Si el precio está caducado o el secuenciador caído, la donación **queda pendiente** y se reintenta. Nunca se acredita con un precio dudoso.
  - En P1 no se usa CoinGecko.
- **P1-R6, la Safe tiene que existir (D6).** `verifyClubSafe(chain)` comprueba que `getCode` ≠ `0x` y no es un designador 7702, con caché de 10 min en memoria del servidor.
  - En las redes donde la Safe no existe no se ofrecen activos, y la server action responde `safe_not_deployed`.
  - **Hoy la Safe no existe en ninguna de las cuatro redes**, así que en PRE y PRO no se podrá donar hasta que el usuario la despliegue (HACER A MANO).
- **P1-R7, gastos anotados a mano (D9).**
  - Un tesorero (`MANAGE_TREASURY`) registra un gasto pegando el hash, el token, el importe y una nota.
  - El servidor lo verifica:
    - USDC: log `Transfer` desde la Safe por el importe exacto;
    - ETH: recibo con éxito y `tx.to` igual a la Safe (una `execTransaction`). El importe es el declarado y se enlaza al explorador para que cualquiera lo compruebe.
  - No hay escaneo multired de la Safe en P1, y el escaneo legado no se toca.
- **P1-R8, sorteos en tablas nuevas `giveaways*`.**
  - Se separan de `raffles` (legado) porque cuarenta funciones de la DAO leen `raffles`.
  - Llevan `scope text check (scope in ('club'))` para que P2 añada `'public'`.
- **P1-R9, quién crea sorteos y qué premios hay.**
  - Para crear un sorteo hace falta `MANAGE_TREASURY` (256).
  - Premio `role`:
    - el rol no puede ser `@everyone` ni tener `is_system` o `system_key`;
    - sus permisos tienen que estar dentro de la máscara de miembro `207895`;
    - y el creador debe estar por encima del rol en la jerarquía (o ser ADMINISTRATOR).
    - Todo eso se comprueba otra vez al sortear. Si ya no se cumple, el premio queda `unawarded` con el motivo `role_unavailable`.
  - Premio `crypto`: **solo USDC**, pagado por la Safe y verificable por el log `Transfer`. El ETH que sale de una Safe es una transferencia interna que `verifyTransfer` no ve.
  - Premio `custom`: solo texto (1–120). La imagen opcional de D12 queda para P2.
  - Como mucho 10 premios por sorteo.
- **P1-R10, algoritmo del sorteo.**
  - Ronda objetivo `R = floor((closes_at − 1692803367) / 3) + 2`, la primera ronda emitida estrictamente después del cierre. Se calcula y se guarda al crear.
  - Las entradas se ordenan por `(entered_at, member_id)` y reciben posiciones 1..n al cerrar.
  - `r₁ = keccak256(seed₃₂ ‖ randomness₃₂)`.
  - Para cada premio k = 1..m, por rango:
    - `i = uint256(r_k) mod restantes`, gana `restantes[i]` y sale de la lista;
    - `r_{k+1} = keccak256(r_k)`.
  - Si hay menos entradas que premios, los que sobran quedan `unawarded` (`not_enough_entries`). Con 0 entradas el sorteo pasa a `void`.
  - SQL y TS deben coincidir (fixture compartida).
- **P1-R11, drand en e2e.**
  - `DRAND_API_BASE`, `NEXT_PUBLIC_DRAND_API_BASE` y `NEXT_PUBLIC_DRAND_PUBLIC_KEY` solo se respetan con `networkSet() === "testnet"`.
  - e2e levanta un drand simulado que firma con su propia clave BLS, con la misma génesis y el mismo periodo.
  - PRE no define esas variables, así que usa el drand real.
- **P1-R12, cuándo se sortea.** El sorteo se hace en el cron horario (`/api/cron/dao`, antes de la rama legada).
  - Además, cualquier tesorero puede pulsar «Sortear ahora» cuando la ronda ya existe.
  - Si drand no responde, el sorteo sigue `closed` y se reintenta.
- **P1-R13, guía.**
  - Las secciones `dao` y `fondo` se sustituyen por `donaciones` («Donaciones y Mecenas»).
  - Se añade `sorteos`.
  - `candados` y `encuestas` se reescriben.
  - `/start` solo recibe correcciones de texto para no mentir: la tarjeta «Tesorería» pasa a «Donaciones» y los sorteos se explican con drand. La reforma completa de `/start` es de P2.
- **P1-R14, e2e legadas.** `e2e/legacy/f4d-raffles.spec.ts` y `f4e-polls.spec.ts` se borran, porque las sustituyen las specs nuevas. `f3d`, `f4a` y `f4c` se quedan como histórico.
- **P1-R15, pgTAP nuevos con prefijo `p1_NN_`.** `995`/`996` ya están cogidos y no caben más números de tres cifras. Los nombres en minúscula se ordenan después de los dígitos y `000_helpers` sigue ejecutándose primero.
- **P1-R16, encabezado de «Inicio».**
  - El `h1` sigue siendo «Inicio», como etiqueta visible pequeña, porque nueve tests e2e lo buscan.
  - El saludo («Buenas, <nombre>») es un párrafo grande en la fuente display.
  - Ctrl+K siempre abre la paleta, también con el foco en el campo de Inicio.
- **P1-R17, migraciones.** Ficheros nuevos `supabase/migrations/202610242000NN_*.sql`, por orden de tarea. Las migraciones ya aplicadas no se editan.

## Global Constraints
- **Proceso:**
  - TDD (test que falla, implementación mínima, test en verde, commit).
  - SDD con subagentes.
  - `ui-ux-pro-max` antes de cualquier UI (Tareas 1, 2, 5, 6, 7, 10, 12 y 13).
  - Sin texto de relleno ("AI slop").
- **Comandos de prueba:**
  - Unit: `pnpm test:unit` (o `pnpm vitest run <ruta>`). Tipos: `pnpm typecheck`. Lint: `pnpm lint`.
  - **pgTAP (`pnpm db:test`) y e2e (`pnpm test:e2e`) borran la BD local que usa el usuario.** Durante P1 solo los ejecuta el controlador, y solo si el usuario lo ha autorizado para P1. Si no, quedan para la Tarea 14.
  - Al cerrar cada tarea, `pnpm typecheck`, `pnpm lint` y `pnpm test:unit` en verde.
  - En Git Bash, añade System32 **al final** del PATH antes de e2e (`PATH="$PATH:/c/Windows/System32"`). Sin `taskkill`, Playwright se cuelga al cerrar.
- **Estilos y accesibilidad:**
  - Solo tokens de `src/app/globals.css`, sin hex en TS/CSS. Los colores de rol en BD son datos (`'#RRGGBB'`), no estilos.
  - AA, objetivos ≥ 44 px (`min-h-11`), sin scroll horizontal de 375 a 1920 px y `motion-reduce` en las animaciones.
  - Iconos Lucide, nunca emojis.
- **Textos:**
  - Cortos y concretos.
  - Toda pantalla de dinero recuerda «ElClub. no custodia fondos» y, en donaciones, «Donar no da derechos económicos».
  - En código nuevo nunca aparece la palabra «Linea» (lo vigila `tests/unit/no-linea.test.ts`) ni «comisión».
- **Sin comisión** en ningún flujo. Builder Code solo en la red `base`: lo aplica `use-send-transfer`, no hay que tocarlo.
- **CSP:** solo orígenes imprescindibles. P1 añade `https://api.drand.sh`, `https://api2.drand.sh`, `https://api3.drand.sh` y `https://drand.cloudflare.com` a `connect-src`. En testnet, además, el origen de `NEXT_PUBLIC_DRAND_API_BASE` si está definido.
- **Secretos y wallets:**
  - No se commitea ningún `.env*` salvo los `*.example`, con valores vacíos.
  - Solo cuentas Hardhat o claves generadas.
  - Nunca se escriben ficheros con PowerShell `Set-Content` u `Out-File` (BOM).
- **Migraciones:** si cambia la firma de una función, `drop function` de la vieja y `create function`, con el patrón de `revoke`/`grant` del repo. Cada función se parte de su **última** definición (listadas en cada tarea).
- **Next 16:** antes de tocar rutas, `redirect`, `proxy` o caché, leer la guía en `node_modules/next/dist/docs/` (AGENTS.md). Las lecturas dinámicas van dentro de `Suspense` (cacheComponents).
- **Commits:** cada mensaje termina con:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019kUJkrZQ2bsDpskaaHVu4D
  ```
- **Datos externos verificados (2026-10-24), copiar tal cual:**
  - **drand quicknet**, comprobado en `https://api.drand.sh/<hash>/info`:
    - chain hash `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`;
    - clave pública `83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a`;
    - periodo 3 s, génesis 1692803367, esquema `bls-unchained-g1-rfc9380`.
    - Ronda de fixture: 1000, `randomness = fe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd`, `signature = b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39`.
    - Verificación, probada con `@noble/curves` 1.9.7: `bls12_381.verifyShortSignature(sig, bls12_381.G1.hashToCurve(sha256(round como uint64 big-endian de 8 bytes), { DST: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_" }), publicKey)` y `randomness === sha256(signatureBytes)`.
  - **Chainlink ETH/USD**, comprobado con `description()` on-chain; los cuatro estaban frescos:

    | Red | Feed | Latido máx. aceptado |
    |---|---|---|
    | 8453 | `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` | 1200 s |
    | 42161 | `0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612` | 86400 s |
    | 84532 | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` | 86400 s |
    | 421614 | `0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165` | 86400 s |

    El precio está fresco si `edad × 10 ≤ latido × 11` y `answer > 0`.
  - **Secuenciador:** Base `0xBCF85224fc0756B9Fa45aA7892530B47e10b6433` y Arbitrum `0xFdB631F5EE196F0ed6FAa767959853A9F217697D` (docs.chain.link). No hay feed de secuenciador en las testnets, así que allí no se comprueba.
  - **Safe del club:** `0x380f2e12081995359e2Ab88E3c31c6b227904234`, ya guardada en `chains.safe_address` para las cuatro redes.

## Review Focus
1. **Donación en ETH con el precio caducado o el secuenciador caído.** La donación queda pendiente con `price_unavailable`: no se acredita, no falla de forma definitiva y la UI dice «Esperando precio». → test en la Tarea 4, paso 1.
2. **Red sin Safe desplegada.** Sus activos no aparecen en el diálogo y la server action responde `safe_not_deployed` aunque el cliente esté manipulado. → tests en las Tareas 4 y 5.
3. **Sorteo con menos entradas que premios, o sin ninguna.** Los premios sobrantes quedan `unawarded` y, con 0 entradas, el sorteo es `void` con la semilla revelada. → pgTAP en la Tarea 8.
4. **Premio de rol cuyo rol se borra o gana permisos antes del sorteo.** No se asigna nada y el premio queda `role_unavailable`. → pgTAP en la Tarea 8.
5. **drand caído al sortear o en el verificador.** El sorteo sigue `closed` y se reintenta. El verificador dice «No se pudo descargar la ronda», nunca «inválido». → tests en las Tareas 9 y 10.

---

### Task 1: Encuestas 1 miembro = 1 voto

**Files:**
- Create: `supabase/migrations/20261024200001_polls_1p1v.sql`, `supabase/tests/p1_01_polls_1p1v.test.sql`, `e2e/p1-polls.spec.ts`
- Modify: `src/lib/polls/{actions,polls}.ts`, `src/components/chat/{poll-dialog,poll-card}.tsx`, `src/lib/search/actions-list.ts` (palabras clave de encuestas), `src/lib/errors.ts`, los tests unit de encuestas y chat afectados, y `supabase/tests/{971,972,990,994}*.test.sql` donde llamen a `create_poll` con 5 argumentos.
- Delete: `e2e/legacy/f4e-polls.spec.ts`

**Interfaces:**
- Produces (SQL):
  - `public.create_poll(p_channel uuid, p_question text, p_options text[], p_closes_at timestamptz) returns uuid`.
    - Parte de la última definición, `20261019500003_poll_votes.sql:25`.
    - Ya no lee `active_chain_id`, no pide red y no crea `poll_weight_snapshots`.
    - Inserta `weight_mode = 'equal'` y `chain_id = null`.
    - Se borra la firma de 5 argumentos.
  - `polls.chain_id` pasa a admitir nulos: se borra su check de Linea, buscando el constraint con `pg_get_constraintdef(oid) like '%59144%'`, como en `20261024100001_chains.sql:34-46`.
  - La columna `weight_mode` se queda; las filas antiguas conservan su valor.
  - `cast_poll_vote`, `poll_details`, `_poll_tally` y `close_due_polls` no cambian.
- Produces (TS):
  - `createPollAction(input: { channelId: string; question: string; options: string[]; closesAt: string })`, sin `weightMode`.
  - `PollWeightMode` se queda para leer filas antiguas, pero la UI ya no ofrece modos.

- [ ] **Step 1: pgTAP que falla.** En `p1_01_polls_1p1v.test.sql`:
  - un miembro con `CREATE_POLLS` crea una encuesta con la firma de 4 argumentos en una BD con `active_chain_id = null` (`lives_ok`);
  - la fila tiene `weight_mode = 'equal'` y `chain_id is null`;
  - `private.poll_weight_snapshots` sigue vacía;
  - la firma de 5 argumentos ya no existe (`hasnt_function`);
  - dos votos de miembros distintos cuentan 1 cada uno en `_poll_tally`.
- [ ] **Step 2: migración** `20261024200001_polls_1p1v.sql` con lo descrito en Interfaces (cabecera con fase y rulings, `revoke`/`grant` como la original).
- [ ] **Step 3: actualizar los pgTAP legados** que llaman a `create_poll` con `p_weight_mode`: 971, 972, 990 y 994. Los casos de modos ponderados de 971 se borran, porque prueban una función que ya no existe.
- [ ] **Step 4: tests unit que fallan:**
  - `createPollAction` no envía `p_weight_mode`;
  - `poll-dialog` no muestra el fieldset «Peso del voto»;
  - `poll-card` nunca muestra «% del peso total», solo «% de los votos»;
  - las palabras clave de la paleta no contienen «participaciones» ni «peso».
- [ ] **Step 5: implementar.**
  - Antes, consultar `ui-ux-pro-max` para el diálogo simplificado (formulario más corto, sin opciones avanzadas).
  - Quitar `MODES`, el estado `mode`, las notas de peso y el texto ponderado de `poll-dialog.tsx` y `poll-card.tsx`.
  - Quitar `linear` y `quadratic` de `isMode` en `actions.ts`.
- [ ] **Step 6: e2e `e2e/p1-polls.spec.ts`.** Toma de `e2e/legacy/f4e-polls.spec.ts` los casos que siguen valiendo: permiso, crear, votar y cambiar el voto, cerrar con el cron y ver resultados, resultados insuficientes con menos de 3 votos, que no se pueda editar ni borrar, y sin errores en consola. No incluye el caso ponderado. Después se borra la spec legada.
- [ ] **Step 7: verificar.** `pnpm typecheck && pnpm lint && pnpm test:unit` en verde. Los pgTAP y la e2e los ejecuta el controlador según Global Constraints.
- [ ] **Step 8: commit** `feat(polls): 1 miembro = 1 voto, sin modos ponderados ni red`.

### Task 2: Alphas en Base y Arbitrum (D19)

**Files:**
- Create: `supabase/migrations/20261024200002_alpha_multired.sql`, `supabase/tests/p1_02_alpha_multired.test.sql`, `src/lib/chat/contract.ts`, `src/components/economy/network-picker.tsx`, `tests/unit/chat/contract.test.ts`, `tests/unit/economy/network-picker.test.tsx`
- Modify:
  - `src/lib/chat/{alpha,queries,model,pending}.ts`, `src/components/chat/{alpha-dialog,alpha-card,message-item}.tsx`, `src/lib/errors.ts:19`;
  - `tests/unit/no-linea.test.ts` (quitar las exenciones de alphas y `errors.ts`);
  - los tests de alphas (`alpha-dialog`, `alpha-card`, `alpha-action`, `composer-alpha`, `message-item`, `model`, `fixtures.ts`);
  - los pgTAP que llaman a `post_message_as`: 200, 210, 310 y 990;
  - `e2e/f2b-chat.spec.ts` (tests 7 y 7b), `e2e/f5-headers.spec.ts`.
- Delete: `src/lib/chat/linea.ts`, `tests/unit/chat/linea.test.ts`

**Interfaces:**
- Produces (SQL):
  - `alpha_details.chain_id`: se borra el check `= 59144` (buscado por definición) y el valor por defecto, y se añade `foreign key (chain_id) references public.chains(chain_id)`. Las filas antiguas, con 59144, siguen siendo válidas.
  - `public.post_message_as(..., p_alpha_address text, p_alpha_chain int)`:
    - parte de `20261020100001_message_client_id.sql`;
    - si `p_alpha_address` no es nulo, exige `private.chain_enabled(p_alpha_chain)`; si no, `chain_invalid`;
    - inserta `(message_id, contract_address, chain_id)`;
    - se borra la firma vieja; solo `service_role`.
- Produces (TS):
  - `verifyContract(chain: ChainId, address: \`0x${string}\`): Promise<boolean>` en `src/lib/chat/contract.ts` (server-only).
    - Usa `chainClient(chain).getCode`.
    - Devuelve `false` si el código está vacío o empieza por `0xef0100` (7702).
    - Lanza `Error("network")` si falla el RPC.
  - `postAlphaAction(input: { channelId: string; chainId: number; address: string; doc: unknown })`. Valida `isChainId(chainId) && appChainIds().includes(chainId)`; si no, `{ error: "chain_invalid" }`.
  - `ChatMessage.alpha: { address: string; chainId: number } | null` sustituye a `alphaAddress`.
  - `NetworkPicker({ value: ChainId; onChange(chain: ChainId): void; chains: readonly ChainId[]; label: string })`: radiogroup con flechas, que en cada opción muestra el `NetworkLogo` con su nombre (el patrón de `asset-picker.tsx`).
  - `AlphaCard({ address, chainId })`:
    - el enlace al explorador sale de `explorerAddress(chainId, address)` y su texto es «Ver en el explorador»;
    - iframe `https://dexscreener.com/${NETWORKS[chainId].key}/${address}?embed=1&theme=dark&trades=0&info=0`;
    - si la red no está en `NETWORKS` (filas antiguas), solo dirección y botón de copiar, sin iframe ni enlace.
  - `errors.ts`: `not_a_contract` pasa a «Esa dirección no es un contrato en esa red.»

- [ ] **Step 1: pgTAP que falla.** En `p1_02_alpha_multired.test.sql`:
  - un alpha con `p_alpha_chain = 84532` queda con `chain_id = 84532`;
  - con `59144`, `throws_ok` `chain_invalid` (Linea está deshabilitada);
  - con `999`, `throws_ok` `chain_invalid`;
  - una fila antigua con 59144, insertada antes de la migración, sigue legible.
- [ ] **Step 2: migración y pgTAP legados.** Escribir la migración y actualizar 200, 210, 310 y 990 al argumento nuevo.
- [ ] **Step 3: tests unit que fallan:**
  - `verifyContract`: código vacío → `false`, `0xef0100…` → `false`, bytecode → `true`, error del RPC → lanza `network`;
  - `postAlphaAction` con `chainId: 59144` → `chain_invalid` sin llamar al RPC, y con `84532` pasa `p_alpha_chain: 84532`;
  - `NetworkPicker`: las flechas cambian la selección y cada opción tiene nombre accesible;
  - `AlphaCard` con 42161: href de arbiscan y src de DexScreener con `/arbitrum/`; con 59144: sin iframe;
  - el diálogo muestra el selector de red con la primera de `appChainIds()` elegida y la etiqueta «Contrato».
- [ ] **Step 4: implementar.** Consultar `ui-ux-pro-max` antes del selector y del diálogo. Borrar `linea.ts` y su test, y quitar las exenciones de `no-linea.test.ts`, actualizando su comentario de cabecera.
- [ ] **Step 5: e2e.**
  - En `f2b-chat` test 7b («RPC de Linea real»), comprobar un contrato real del nodo Hardhat 84532: el USDC simulado en la dirección de Circle de Base Sepolia. Es decir, sin la red real. El test se renombra «7b. alpha con contrato verificado en Base Sepolia».
  - `f5-headers` pasa `p_alpha_chain`.
- [ ] **Step 6: verificar** `pnpm typecheck && pnpm lint && pnpm test:unit`.
- [ ] **Step 7: commit** `feat(alphas): contrato en Base o Arbitrum con su red, explorador y DexScreener por red`.

### Task 3: BD de donaciones — tabla, Mecenas, visibilidad y lecturas

**Files:**
- Create: `supabase/migrations/20261024200003_donations.sql`, `supabase/tests/p1_03_donations.test.sql`

**Interfaces:**
- Produces (SQL):
  - Tabla `public.donations`:
    - `id uuid pk default gen_random_uuid()`, `intent_id uuid unique not null references payment_intents`, `chain_id int not null references chains`;
    - `token text check (token in ('USDC','ETH'))`, `amount numeric(78,0) > 0`, `usd6 numeric(78,0) >= 0`;
    - `eth_price_e8 numeric(78,0) null` (solo ETH), `price_source text check (price_source in ('usdc','chainlink'))`;
    - `member_id uuid null references members`, `donor_address text not null check (~ '^0x[0-9a-f]{40}$')`;
    - `tx_hash text not null`, `log_index int not null`, `block_number bigint not null`;
    - `anonymous boolean not null default false`, `verified_at timestamptz not null default now()`;
    - `unique (chain_id, tx_hash, log_index)`.
    - RLS activada, sin acceso directo; las lecturas van por RPC.
  - `members.donor_visible boolean not null default true`.
  - `app_config.donor_role_min_usd6 = 1000000`, insertado con el patrón de `app_config` del repo.
  - Rol `Mecenas`:
    - `insert ... on conflict (name) do nothing` con `system_key = 'donor'`, `is_system = false`, `position = 15`, `permissions = 0` y color `'#C6F36B'`;
    - `update_role` y `delete_role` ya protegen los roles con `system_key`.
  - `public.create_donation_intent(p_chain_id int, p_token text, p_amount numeric, p_anonymous boolean) returns jsonb`:
    - solo un miembro activo;
    - `private.chain_enabled`; si no, `chain_invalid`;
    - `chains.safe_address` no nulo; si no, `safe_not_configured`;
    - rangos por token, iguales que en `create_tip_intent` (`20261024100002_multired_payments.sql:14`); si no, `amount_out_of_range`;
    - bucket `payment_intent`, máximo 20 pendientes y el mismo advisory lock;
    - inserta `purpose 'donation'`, `target_type 'dao'`, `target_id null`, `recipient_address = safe_address`, `fee_* = 0`;
    - devuelve la misma forma que `TipIntent`;
    - se borra la firma legada `(numeric, int, boolean)`.
  - `public.confirm_donation(p_intent uuid, p_main jsonb, p_usd6 numeric, p_eth_price_e8 numeric) returns jsonb` (solo `service_role`):
    - `_record_payment_transfers(i, p_main, null)`, intent a `confirmed`;
    - inserta la donación (`price_source` según el token; `donor_address` = `payment_intents → members.wallet_address`);
    - si el total del miembro llega a `donor_role_min_usd6`: `insert into member_roles (member_id, role_id) select ..., id from roles where system_key = 'donor' on conflict do nothing`, y si se insertó, `audit_log` con `action 'donor_role_granted'`;
    - devuelve `{status: 'confirmed'|'already', donationId}`;
    - errores: los de `_record_payment_transfers`, más `not_found` e `invalid_input`.
  - `public.set_donor_visible(p_visible boolean) returns void`: miembro activo, bucket `profile`.
  - `public.donation_overview() returns jsonb` (miembro activo): `{totalUsd6, donorCount, byChain: [{chainId, usd6}], recent: [{id, at, chainId, token, amount, usd6, donorLabel}]}`.
    - `recent` trae 20 filas, con `donorLabel` igual a `_member_label(member_id)`, salvo que sea anónima o `donor_visible = false`, en cuyo caso es `null`. Si la donación es de quien consulta, siempre su etiqueta.
  - `public.donor_ranking(p_limit int default 50) returns table(member_id uuid, label text, total_usd6 numeric, is_me boolean)`: solo donantes visibles, más la fila propia siempre, por total descendente.
  - `public.my_donor_status() returns jsonb`: `{totalUsd6, isMecenas, visible}`.
  - `public.club_activity(p_limit)` se redefine a partir de `20261024100002_multired_payments.sql:493`: la rama de donación lee `donations` (sin `_active_chain()`) con `kind 'donation'`.
  - `notifications_kind_check` no cambia.

- [ ] **Step 1: pgTAP que falla.** En `p1_03_donations.test.sql`, con fixtures de `tests.create_member` y transfers sintéticos como en `996`:
  - `create_donation_intent(84532,'USDC',5000000,false)` crea un intent con `recipient_address` igual a la Safe, en minúsculas;
  - con 59141 → `chain_invalid`;
  - con importe 0 → `amount_out_of_range`;
  - un no miembro → `forbidden`;
  - `confirm_donation` con usd6 `5000000` crea la donación y concede Mecenas (`member_roles` con el rol `donor`) más un `audit_log`;
  - una segunda donación no duplica el rol;
  - con un total < 1 USD (usd6 `500000`) no se concede;
  - reutilizar el mismo `(chain, tx, log)` → `tx_already_used`;
  - `donor_ranking` oculta a quien tiene `donor_visible = false`, pero se lo muestra a sí mismo con `is_me`;
  - una donación anónima sale en `recent` con `donorLabel` nulo;
  - `club_activity` devuelve la donación;
  - la firma legada no existe.
- [ ] **Step 2: migración** con lo descrito en Interfaces.
- [ ] **Step 3: verificar.** El controlador ejecuta `pnpm db:test`. `pnpm typecheck` debe seguir en verde: los tipos no cambian.
- [ ] **Step 4: commit** `feat(donations): tabla donations, rol Mecenas, visibilidad y lecturas (BD)`.

### Task 4: Servidor de donaciones — precio, Safe, intent y confirmación

**Files:**
- Create: `src/lib/economy/eth-price.ts`, `src/lib/economy/club-safe.ts`, `src/lib/donations/actions.ts`, `src/lib/donations/queries.ts`, tests en `tests/unit/donations/*` y `tests/unit/economy/{eth-price,club-safe}.test.ts`
- Modify:
  - `src/lib/payments/confirm.ts` (rama `isDonation`, que sustituye a la legada);
  - `src/lib/payments/pending-sends.ts` (`LedgerTargetType` añade `'donation'`);
  - `src/lib/payments/outcomes.ts`, `src/lib/errors.ts`;
  - `src/lib/treasury/actions.ts`: borrar `createDonationIntentAction` y `setRankingVisibleAction` (legado sin uso), con sus tests.

**Interfaces:**
- Produces:
  - `readEthUsd(chain: ChainId, opts?: { nowSec?: number; client?: PublicClient }): Promise<{ priceE8: bigint } | null>` en `eth-price.ts`:
    - registro `PRICE_FEEDS: Record<ChainId, { ethUsd: \`0x${string}\`; heartbeatSec: number; sequencer: \`0x${string}\` | null }>` con los valores de Global Constraints;
    - en testnet se respeta `ETH_USD_FEED_ADDRESS_<chainId>` (para e2e);
    - devuelve `null` si el precio está caducado, `answer ≤ 0`, el secuenciador está caído (`answer ≠ 0`), no han pasado 3600 s desde `startedAt` o falla el RPC;
    - reescala a 8 decimales.
  - `usd6For(token: "USDC" | "ETH", amount: bigint, priceE8: bigint | null): bigint | null`:
    - USDC → `amount`;
    - ETH → `amount * priceE8 / 10n ** 20n` (wei·e8 → usd6);
    - ETH sin precio → `null`.
  - `verifyClubSafe(chain: ChainId): Promise<"ok" | "not_deployed" | "not_configured" | "network">` en `club-safe.ts`. Lee `chains.safe_address` con el cliente admin; caché en memoria de 10 min solo para `ok`.
  - `donationChains(): Promise<ChainId[]>`: las de `appChainIds()` con Safe `ok`.
  - `createDonationIntentAction(input: { chainId: number; token: "USDC" | "ETH"; amount: string; anonymous: boolean }): Promise<{ ok: true; intent: TipIntent } | { ok: false; error: string }>`:
    - valida como `createTipIntentAction`;
    - llama a `verifyClubSafe`: `not_deployed` → `safe_not_deployed`, `network` → `rpc_unavailable`;
    - llama a la RPC.
  - `setDonorVisibleAction(visible: boolean)`.
  - `confirmIntent`, rama de donación:
    - `verifyTransfer({ chain, token, from: wallet, to: safe, amount, notBefore, confirmations: default })`;
    - si es ETH, `readEthUsd(chain)`; si devuelve `null`, `{ pending: true, reason: "price_unavailable" }`;
    - llama a `confirm_donation` y devuelve `{ confirmed: true, donationId }`.
    - El tipo `ConfirmResult` añade esa variante y `reason?` en `pending`.
  - `getDonationOverview`, `getDonorRanking` y `getMyDonorStatus` en `queries.ts`, con importes como `bigint` a partir de los `*_text` (patrón de `src/lib/home/queries.ts`).

- [ ] **Step 1: tests unit que fallan:**
  - `readEthUsd`:
    - un feed fresco devuelve el precio reescalado;
    - con edad > latido·1,1 → `null`;
    - con el secuenciador en `answer = 1` → `null`;
    - con `startedAt` hace 100 s → `null`;
    - en 84532 sin secuenciador, solo frescura;
    - el override de entorno solo vale en testnet.
  - `usd6For(ETH, 10n**18n, 236045646999n)` → `2360456469n`.
  - `verifyClubSafe`: `0x` → `not_deployed`, `0xef0100…` → `not_deployed`, bytecode → `ok` (y una segunda llamada no vuelve a llamar a `getCode`), error → `network`.
  - `createDonationIntentAction` con la Safe no desplegada → `safe_not_deployed` sin llamar a la RPC.
  - `confirmIntent` de donación en ETH sin precio → `{ pending: true, reason: "price_unavailable" }`, sin llamar a `confirm_donation` ni a `fail_intent`.
  - `confirmIntent` de donación en USDC → llama a `confirm_donation` con `p_usd6` igual al importe.
- [ ] **Step 2: implementar** según Interfaces.
- [ ] **Step 3: verificar** `pnpm typecheck && pnpm lint && pnpm test:unit`.
- [ ] **Step 4: commit** `feat(donations): precio ETH por Chainlink con secuenciador, Safe por getCode y confirmación`.

### Task 5: UI de donaciones — `/donar`, diálogo, Mecenas y lista

**Files:**
- Create: `src/app/(forum)/donar/page.tsx`, `src/components/donations/{donate-dialog,donate-button,donor-list,donation-summary,safe-balances,donor-visibility-toggle,mecenas-badge}.tsx`, `src/lib/donations/safe-balances.ts`, tests en `tests/unit/donations/*.test.tsx`, `e2e/p1-donations.spec.ts`
- Modify:
  - `src/app/(forum)/dao/page.tsx`, `dao/tesoreria/page.tsx` y `dao/sorteos/[id]/page.tsx`: `redirect` a `/donar`, `/donar` y `/sorteos`;
  - `src/components/shell/sidebar.tsx`: enlace «Donar» (`/donar`, icono `HandHeart`) en lugar de «DAO»;
  - `src/lib/search/actions-list.ts`: «Donar a ElClub.» → `/donar`, con las palabras clave «donar mecenas donación»; quitar las entradas de la DAO;
  - `src/components/home/activity-list.tsx`: «donó … a ElClub.», con href `/donar`;
  - `src/app/(forum)/perfil/page.tsx`: la sección «Privacidad en la DAO» pasa a «Lista de donantes» con `DonorVisibilityToggle`;
  - `src/components/channels/lock-page.tsx` y `src/components/chat/post-gate-notice.tsx`: vuelven a tener el botón de donar;
  - `e2e/chain/start-chain.mjs`:
    - pone código en la Safe en los dos nodos (`hardhat_setCode` con el runtime `0x00`, que acepta ETH);
    - despliega `MockAggregator` en `0x000000000000000000000000000000000000fEed`, con `setAnswer(2000_00000000)`;
  - `playwright.config.ts`: `ETH_USD_FEED_ADDRESS_84532` y `ETH_USD_FEED_ADDRESS_421614`.

**Interfaces:**
- Consumes: Tarea 4 (`createDonationIntentAction`, `donationChains`, queries), `AssetPicker`, `useSendTransfer`, `useEnsureChain`, `attachTxAction`, `verifyIntentAction` y `PendingSendsSync` (el target `donation` re-verifica igual que una propina).
- Produces:
  - `DonateDialog({ open, onOpenChange, chains: readonly ChainId[] })`:
    - lista los activos de `assetsFor(chains)` (sin filtrar por redes del destinatario, porque la Safe acepta las dos);
    - campo de importe y casilla «Donar de forma anónima»;
    - aviso fijo: «ElClub. no custodia fondos: va directo a la Safe del club. Donar no da derechos económicos.»;
    - mismo flujo de cambio de red, firma, adjuntar y verificar que `tip-dialog`;
    - estado `price_unavailable`: «Recibida. Esperando precio para registrarla.»
  - `DonateButton({ autoOpen?: boolean })`: si `donationChains()` está vacío, el botón aparece deshabilitado con «Donaciones aún no disponibles».
  - `getSafeBalances(): Promise<{ chainId: ChainId; usdc: bigint | null; eth: bigint | null }[]>` en `safe-balances.ts`: lecturas on-chain por red, con `null` si fallan.
  - `/donar`, dentro de `Suspense`, en este orden:
    1. cabecera con el `DonateButton` (`?donar=1` lo abre);
    2. resumen (total en USD, donantes y por red con `NetworkLogo`);
    3. saldos de la Safe por red;
    4. tu estado (Mecenas, total y el interruptor de visibilidad);
    5. lista de donantes;
    6. donaciones recientes;
    7. gastos (los añade la Tarea 6).
  - `MecenasBadge`: chip con el texto «Mecenas».

- [ ] **Step 1: `ui-ux-pro-max`.** Consultarlo para la página de transparencia y el diálogo: jerarquía, cifras con figuras tabulares y estados vacíos. Anotar las conclusiones en el informe.
- [ ] **Step 2: tests unit que fallan:**
  - `DonateDialog` no ofrece activos de una red que no está en `chains`;
  - muestra el aviso exacto;
  - con `price_unavailable` muestra el texto exacto de espera;
  - `DonorList` marca «Tú» en `is_me`;
  - `DonorVisibilityToggle` llama a `setDonorVisibleAction(false)`;
  - `/dao` redirige a `/donar`;
  - la paleta tiene «Donar a ElClub.» y no tiene «DAO»;
  - `ActivityList` dice «a ElClub.».
- [ ] **Step 3: implementar.**
- [ ] **Step 4: e2e `e2e/p1-donations.spec.ts`** (plantilla: `f3b-tips.spec.ts`):
  1. donación de 5 USDC en Base Sepolia: una firma, sale en recientes y en la lista, el donante tiene el chip Mecenas y el rol en BD;
  2. donación de ETH en Arbitrum Sepolia: la wallet cambia de red y `usd6` = importe × 2000;
  3. donación anónima: otro miembro ve «Anónimo»;
  4. con el interruptor apagado, el donante desaparece de la lista para los demás;
  5. replay del hash → `tx_already_used`;
  6. sin errores en consola.
- [ ] **Step 5: verificar** `pnpm typecheck && pnpm lint && pnpm test:unit`.
- [ ] **Step 6: commit** `feat(donations): /donar con Safe por red, diálogo por token, Mecenas y lista de donantes`.

### Task 6: Gastos con nota del tesorero (D9)

**Files:**
- Create: `supabase/migrations/20261024200004_club_expenses.sql`, `supabase/tests/p1_04_club_expenses.test.sql`, `src/lib/donations/expenses.ts`, `src/components/donations/{expense-list,add-expense-dialog}.tsx`, tests unit
- Modify: `src/app/(forum)/donar/page.tsx` (sección «Gastos»)

**Interfaces:**
- Produces (SQL):
  - Tabla `public.club_expenses`:
    - `id`, `chain_id references chains`, `token ('USDC','ETH')`, `amount numeric(78,0) > 0`;
    - `tx_hash text`, `log_index int` (`-1` para ETH);
    - `note text check (char_length between 1 and 280)`;
    - `recorded_by uuid references members`, `recorded_at`, `verified_kind text check (verified_kind in ('usdc_log','safe_tx'))`;
    - `unique (chain_id, tx_hash, log_index)`; RLS sin acceso directo.
  - `public.record_club_expense(p_chain int, p_token text, p_amount numeric, p_tx_hash text, p_log_index int, p_note text, p_verified_kind text, p_actor uuid) returns uuid` (solo `service_role`): `p_actor` tiene que tener `has_global_perm(256)`, comprobado con su `member_id`.
  - `public.club_expenses_list(p_limit int default 30)` (miembro activo): `id, chain_id, token, amount::text, tx_hash, note, recorded_at, recorder_label`.
  - `public.set_club_expense_note(p_id uuid, p_note text)` (256): `audit_log` `expense_noted`.
- Produces (TS):
  - `addExpenseAction(input: { chainId: number; token: "USDC" | "ETH"; amount: string; txHash: string; note: string })`:
    - exige `treasurerId()`;
    - hace `hitRateLimit(chain_verify)`.
    - USDC: `verifyTransfer({ token: "USDC", from: safe, to: <destino del log>, ... })`. Para no conocer el destino se usa un modo nuevo de `verifyTransfer`, `to: null`: cualquier `Transfer` del USDC de esa red con `from = safe` y `value = amount`.
    - ETH: recibo con `status = success` y `tx.to = safe`.
    - Al terminar llama a la RPC.
  - `verifyTransfer` acepta `to: \`0x${string}\` | null` solo para USDC, con un test nuevo en `tests/unit/payments/verify.test.ts`.

- [ ] **Step 1: pgTAP y tests unit que fallan:**
  - un no tesorero → `forbidden`;
  - repetir el hash → `tx_already_used` (unique);
  - la nota con más de 280 caracteres → `invalid_input`;
  - `verifyTransfer` con `to: null` acepta un log desde la Safe hacia cualquiera y rechaza uno desde otra dirección;
  - `addExpenseAction` en ETH con `tx.to` distinto de la Safe → `tx_mismatch`;
  - `ExpenseList` enlaza cada gasto a `explorerTx`.
- [ ] **Step 2: implementar.** Consultar `ui-ux-pro-max` antes de la lista y del diálogo.
- [ ] **Step 3: verificar y commit** `feat(donations): gastos de la Safe con nota del tesorero, verificados por hash`.

### Task 7: Candados por lo donado (D8)

**Files:**
- Create: `supabase/migrations/20261024200005_donor_gating.sql`, `supabase/tests/p1_05_donor_gating.test.sql`
- Modify:
  - `src/lib/channels/{lock,queries,actions,guard}.ts`, `src/components/settings/channel-gate-form.tsx`, `src/components/channels/lock-page.tsx`, `src/components/chat/post-gate-notice.tsx` y sus tests;
  - pgTAP 070, 080, 400, 810, 830, 890, 951, 970 y 972 donde usen las columnas antiguas.

**Interfaces:**
- Produces (SQL):
  - `channels.gate_min_donated_usd6 numeric(78,0) null check (>= 0)`.
  - `update channels set gate_min_share_bps = null, gate_min_net_usdc = null`.
  - `public._member_donated_usd6(p_member uuid) returns numeric`: suma de `donations.usd6` del miembro.
  - `public.gate_passes(...)` y `_channel_failing_gates(...)` se redefinen: una regla está activa si `gate_min_donated_usd6` no es nulo, y pasa si `_member_donated_usd6 >= gate_min_donated_usd6`. Las últimas definiciones están en `20261018800002_gating.sql:46` y `20261018800013_lock_state_all_gates.sql:11`.
  - `channel_lock_state(p_channel)` devuelve `{scope, minDonatedUsd6, myDonatedUsd6, requirements[]}`.
  - `set_channel_gate(p_channel uuid, p_min_donated_usd6 numeric, p_scope text)`: se borra la firma de 4 argumentos; `MANAGE_CHANNELS` y `audit_log` `channel_gate_set`.
  - El walk de permisos (`20261019500001`) no cambia, porque llama a `gate_passes`.
- Produces (TS):
  - `LockState { scope; minDonatedUsd6: bigint | null; myDonatedUsd6: bigint; requirements }`.
  - `setChannelGateAction({ id, minDonatedUsd: string | null, scope })`, con el importe convertido a usd6.
  - El formulario tiene un solo campo, «Donado mínimo (USD)».
  - Textos del candado: «Canal para quien ha donado al menos X USD. Llevas Y USD.», con el botón Donar.

- [ ] **Step 1: pgTAP que falla.** En `p1_05`:
  - un canal con `gate_min_donated_usd6 = 10000000` lo ve un miembro con 10 USD donados y no lo ve uno con 9,99;
  - con `scope 'post'`, ese miembro ve el canal pero no puede escribir;
  - `channel_lock_state` devuelve `myDonatedUsd6`;
  - las columnas antiguas ya no afectan al acceso aunque tengan valor.
- [ ] **Step 2: migración y pgTAP legados** actualizados a la regla nueva, con el mismo propósito en cada caso.
- [ ] **Step 3: tests unit que fallan y UI:**
  - `parseLockState` con la forma nueva;
  - el texto exacto del candado;
  - el formulario envía `minDonatedUsd`.
  - Consultar `ui-ux-pro-max` para el formulario y la pantalla de candado.
- [ ] **Step 4: verificar y commit** `feat(channels): candado por total donado en USD`.

### Task 8: BD de sorteos (giveaways) con drand y premios

**Files:**
- Create: `supabase/migrations/20261024200006_giveaways.sql`, `supabase/tests/p1_06_giveaways.test.sql`, `tests/fixtures/giveaway-draw.json`

**Interfaces:**
- Produces (SQL):
  - Tablas:
    - `public.giveaways`:
      - `id uuid pk`, `scope text not null default 'club' check (scope in ('club'))`;
      - `title text` (1–80, recortado), `description text null` (≤ 500);
      - `closes_at timestamptz`, `status text default 'open' check (status in ('open','closed','drawn','void','cancelled'))`;
      - `seed_commit text check (~ '^0x[0-9a-f]{64}$')`, `seed_reveal text null`, `target_round bigint not null`;
      - `drand_signature text null`, `drand_randomness text null`, `entry_count int null`;
      - `drawn_at`, `cancelled_at`, `cancel_reason`, `created_by references members`, `created_at`.
      - Los checks de coherencia siguen el modelo de `raffles_*_coherent`: `seed_reveal` si y solo si el estado es `drawn` o `void`.
    - `public.giveaway_prizes`:
      - `id uuid pk`, `giveaway_id references giveaways on delete cascade`, `rank int check (rank between 1 and 10)`, `unique (giveaway_id, rank)`;
      - `kind text check (kind in ('crypto','role','custom'))`;
      - `chain_id int references chains null`, `token text check (token = 'USDC') null`, `amount numeric(78,0) null`;
      - `role_id uuid references roles on delete set null null`, `label text check (char_length between 1 and 120)`;
      - `winner_member_id`, `winner_address`, `winner_position`;
      - `status text default 'pending' check (status in ('pending','awarded','unawarded','paid','delivered'))`, `unawarded_reason text null`;
      - `payout_tx_hash`, `payout_log_index`, `paid_at`, `delivered_at`;
      - `unique (chain_id, payout_tx_hash, payout_log_index)`;
      - checks por tipo: `crypto` exige red, token e importe; `role` exige `role_id` (al crear); `custom`, solo `label`.
    - `public.giveaway_entries(giveaway_id, member_id, entered_at, position int null, primary key (giveaway_id, member_id))`.
    - `private.giveaway_seeds(giveaway_id pk, seed bytea)`.
    - RLS en todas, sin acceso directo.
  - Notificaciones: `notifications_kind_check` añade `'giveaway_won'`, partiendo de la última lista del repo.
  - Funciones y RPC:
    - `public._giveaway_target_round(p_closes_at timestamptz) returns bigint` (`immutable`): `floor((extract(epoch from p_closes_at) − 1692803367) / 3)::bigint + 2`.
    - `public._giveaway_role_ok(p_role uuid, p_actor uuid) returns boolean`: aplica las reglas de P1-R9.
    - `public.create_giveaway(p_title text, p_description text, p_closes_at timestamptz, p_prizes jsonb) returns jsonb {id, commit, targetRound}`:
      - exige `has_global_perm(256)`;
      - cierre entre ahora + 10 min y + 30 días;
      - entre 1 y 10 premios: `[{kind, label?, chainId?, amount?, roleId?}]`;
      - para `crypto`, `private.chain_enabled`;
      - para `role`, `_giveaway_role_ok(role, actor)`; si no, `role_not_allowed`;
      - semilla `extensions.gen_random_bytes(32)` y commit `0x || keccak256(seed)` con `public._keccak256` (ya existe);
      - `audit_log` `giveaway_created`.
    - `cancel_giveaway(p_id uuid, p_reason text)` (256): solo si está `open` o `closed`; borra la semilla; `audit_log` `giveaway_cancelled`.
    - `enter_giveaway(p_id)` y `leave_giveaway(p_id)`: miembro activo, solo `open` y antes del cierre, bucket `raffle_entry` 30/10 min.
    - `close_due_giveaways() returns jsonb {closed, voided}` (solo `service_role`):
      - asigna posiciones por `(entered_at, member_id)` solo a miembros activos y fija `entry_count`;
      - con 0 entradas, `void`: revela la semilla y borra `private`.
    - `giveaways_awaiting_draw() returns table(id uuid, target_round bigint)` (solo `service_role`).
    - `draw_giveaway(p_id uuid, p_round bigint, p_signature text) returns jsonb {status: 'drawn'|'already'}` (solo `service_role`):
      - exige `p_round = target_round`;
      - `randomness = encode(extensions.digest(decode(p_signature,'hex'),'sha256'),'hex')`;
      - aplica el algoritmo de P1-R10 con `_keccak256` y `_uint256_be`;
      - premio `role`: vuelve a comprobar `_giveaway_role_ok(role, created_by)`; si pasa, `insert member_roles ... on conflict do nothing` y estado `delivered`; si no, `unawarded` con `role_unavailable`;
      - `crypto` → `awarded`; `custom` → `awarded`;
      - premios sin ganador → `unawarded` con `not_enough_entries`;
      - guarda `winner_address` desde `members.wallet_address`, revela y borra la semilla;
      - notifica `giveaway_won` a cada ganador (`data {giveawayId, title, prizeLabel}`);
      - `audit_log` `giveaway_drawn`.
    - `record_giveaway_payout(p_prize uuid, p_payout jsonb {txHash, logIndex, blockNumber}, p_actor uuid) returns jsonb` (solo `service_role`, después de verificar en TS):
      - el actor debe tener 256;
      - el premio, `crypto` y `awarded`;
      - el hash no puede estar usado en `onchain_transfers` ni en otros premios; si lo está, `tx_already_used`;
      - el premio pasa a `paid`; `audit_log` `giveaway_prize_paid`.
    - `mark_giveaway_prize_delivered(p_prize uuid)` (256): solo `custom` y `awarded` → `delivered`.
    - Lecturas (miembro activo):
      - `giveaways_list(p_limit int default 30) returns jsonb[]`: tarjetas con `id, title, closesAt, status, entryCount, iEntered, prizes[{rank, kind, label, chainId, amount}], winners[{rank, label, iWon}]`;
      - `giveaway_detail(p_id) returns jsonb`: lo anterior más `description, commit, seedReveal, targetRound, drandSignature, drandRandomness`, la lista de entradas `[{position, label}]` y el estado de cada premio (con `payoutTxHash`).
- Fixture `tests/fixtures/giveaway-draw.json`:
  - `seed` (32 bytes hex), la ronda 1000 real de Global Constraints, 7 entradas y 3 premios;
  - los ganadores esperados, calculados con la implementación TS de la Tarea 9.
  - Se escribe aquí con los ganadores en blanco. La Tarea 9 los rellena y añade el test de paridad SQL ↔ TS (patrón de `tests/integration/raffle-draw-parity.test.ts`).

- [ ] **Step 1: pgTAP que falla.** En `p1_06_giveaways.test.sql`:
  - un no tesorero → `forbidden`;
  - 11 premios → `invalid_input`;
  - un premio de rol con el rol `SuperAdmin` o `Mecenas` → `role_not_allowed`;
  - `_giveaway_target_round('2026-10-24 12:00:00+00')` coincide con el valor calculado a mano en el test;
  - entrar dos veces es idempotente;
  - entrar después del cierre → `giveaway_closed`;
  - `close_due_giveaways` asigna posiciones 1..n;
  - con 0 entradas, `void` y semilla revelada (Review Focus 3);
  - `draw_giveaway` con otra ronda → `invalid_input`;
  - con la firma de la ronda 1000 (con `target_round` forzado a 1000 en el fixture) da `drawn`, `drand_randomness` igual a la de Global Constraints y ganadores distintos;
  - 2 entradas para 3 premios → el 3.º `unawarded` con `not_enough_entries` (Review Focus 3);
  - un rol borrado antes de sortear → `role_unavailable` y sin `member_roles` (Review Focus 4);
  - un rol válido → el ganador lo tiene;
  - `record_giveaway_payout` con un hash ya usado → `tx_already_used`;
  - `giveaway_won` notificado.
- [ ] **Step 2: migración** con lo descrito en Interfaces.
- [ ] **Step 3: verificar** (el controlador ejecuta `pnpm db:test`) **y commit** `feat(giveaways): sorteos gratis de peso igual con drand y premios USDC, rol o texto (BD)`.

### Task 9: Núcleo TS de sorteos — drand, matemática, cron y acciones

**Files:**
- Create:
  - `src/lib/giveaways/{drand,draw,actions,queries,cron,types}.ts`;
  - `tests/unit/giveaways/*.test.ts`, `tests/integration/giveaway-draw-parity.test.ts`;
  - `e2e/mock/drand.mjs`.
- Modify:
  - `package.json`: dependencia `"@noble/curves": "1.9.7"`;
  - `src/app/api/cron/dao/route.ts`: `runGiveawaySteps()` justo después de `finalizeDuePolls`, antes de leer `legacy_dao_enabled`;
  - `src/lib/security/headers.ts`: los orígenes drand de Global Constraints;
  - `tests/unit/csp-headers.test.ts`, `tests/unit/treasury/cron-route.test.ts`;
  - `playwright.config.ts`: webServer del drand simulado y sus variables de entorno;
  - `src/lib/errors.ts`.

**Interfaces:**
- Produces:
  - En `drand.ts` (isomorfo):
    - `DRAND = { chainHash, publicKey, genesis: 1692803367, period: 3, dst: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_" }`;
    - `drandConfig(): { apiBases: string[]; publicKey: string }`: los overrides de P1-R11 solo en testnet;
    - `roundTime(round: bigint): number`;
    - `verifyBeacon(round: bigint, signatureHex: string, publicKey?: string): { ok: true; randomness: string } | { ok: false }`, con la llamada de Global Constraints;
    - `fetchBeacon(round: bigint, opts?: { fetchImpl?: typeof fetch }): Promise<{ status: "ok"; signature: string; randomness: string } | { status: "unavailable" } | { status: "invalid" }>`: prueba cada base hasta 5 s, verifica antes de devolver y contesta `unavailable` si ninguna responde.
  - En `draw.ts` (isomorfo):
    - `giveawayCommit(seedHex): Hex`;
    - `drawWinners(seedHex: Hex, randomnessHex: Hex, entryCount: number, prizeCount: number): number[]` (posiciones 1-based, sin repetir, como mucho `min(entryCount, prizeCount)`; algoritmo de P1-R10);
    - `verifyGiveaway(input): { commitOk: boolean; beaconOk: boolean; winnersOk: boolean; winners: number[] }`.
  - En `cron.ts`:
    - `runGiveawaySteps(): Promise<{ closed: number; voided: number; drawn: number; waiting: number; failed: number }>`;
    - pasos: `close_due_giveaways`, luego, por cada `giveaways_awaiting_draw` con `roundTime ≤ ahora`, `fetchBeacon` y `draw_giveaway`;
    - `unavailable` cuenta como `waiting` (Review Focus 5) e `invalid`, como `failed`, con log.
  - En `actions.ts`:
    - `createGiveawayAction`, `cancelGiveawayAction`, `enterGiveawayAction`, `leaveGiveawayAction`;
    - `drawGiveawayNowAction(id)`: tesorero, el mismo paso que el cron para un solo sorteo; si la ronda no existe todavía, `round_not_ready`;
    - `markPrizePaidAction(prizeId, txHash)`: tesorero, `hitRateLimit(chain_verify)`, `verifyTransfer({ chain, token: "USDC", from: safe, to: winner_address, amount: exacto, notBefore: drawn_at })` y luego `record_giveaway_payout`;
    - `markPrizeDeliveredAction(prizeId)`.
    - Todas revalidan `/sorteos` y `/sorteos/[id]`.
  - `queries.ts`: `getGiveaways(supabase, limit)`, `getGiveaway(supabase, id)`, que parsean a los tipos de `types.ts`.
  - `e2e/mock/drand.mjs`:
    - servidor HTTP en un puerto fijo que expone `GET /<chainHash>/public/<round>` y `/info`;
    - firma cada ronda con una clave BLS fija de test (`bls12_381.signShortSignature` sobre el mismo mensaje);
    - responde 425 si `roundTime(round) > ahora`.

- [ ] **Step 1: tests unit que fallan:**
  - `verifyBeacon(1000n, sig)` con la ronda real → `ok` y la `randomness` de Global Constraints; la misma firma con la ronda 1001 → `{ ok: false }`;
  - `fetchBeacon`: la primera base da 500 y la segunda OK → `ok`; todas caen → `unavailable`; una firma alterada → `invalid`;
  - `drawWinners`: determinista, sin repetidos; con 2 entradas y 3 premios devuelve 2; con 0 devuelve `[]`;
  - `runGiveawaySteps` con `fetchBeacon` en `unavailable` → `waiting: 1` sin llamar a `draw_giveaway`;
  - la ruta del cron ejecuta los sorteos también con `legacy_dao_enabled = false`;
  - la CSP incluye `https://api.drand.sh`;
  - `markPrizePaidAction` con `tx_mismatch` no llama a la RPC.
- [ ] **Step 2: paridad.** Rellenar `tests/fixtures/giveaway-draw.json` con la salida de `drawWinners` y escribir `tests/integration/giveaway-draw-parity.test.ts`, que compara `draw_giveaway` en SQL con TS. Lo ejecuta el controlador: necesita Supabase local.
- [ ] **Step 3: implementar** según Interfaces.
- [ ] **Step 4: verificar** `pnpm typecheck && pnpm lint && pnpm test:unit`.
- [ ] **Step 5: commit** `feat(giveaways): drand verificado (BLS), matemática del sorteo, cron y acciones`.

### Task 10: UI de sorteos — `/sorteos`, detalle, verificador y creación

**Files:**
- Create: `src/app/(forum)/sorteos/page.tsx`, `src/app/(forum)/sorteos/[id]/page.tsx`, `src/components/giveaways/{giveaway-card,giveaway-list,join-button,create-giveaway-dialog,prize-editor,giveaway-verifier,prize-status,mark-paid-dialog}.tsx`, tests unit, `e2e/p1-giveaways.spec.ts`
- Modify:
  - `src/components/shell/sidebar.tsx`: enlace «Sorteos» (`/sorteos`, `Dices`);
  - `src/lib/search/actions-list.ts`: «Sorteos» → `/sorteos`;
  - `src/lib/notifications/queries.ts` y `src/components/notifications/notification-item.tsx`: `giveaway_won` → `/sorteos/<id>`, «Has ganado «<premio>» en «<sorteo>»»;
  - `e2e/legacy/f4d-raffles.spec.ts`: se borra (P1-R14).

**Interfaces:**
- Consumes: Tarea 9.
- Produces:
  - `/sorteos`: «Abiertos», con tarjeta, cuenta atrás y botón «Participar» o «Salir», seguidos de «Terminados». Los tesoreros ven además «Crear sorteo».
  - `/sorteos/[id]`:
    - premios con su estado: «Pendiente de pago», «Pagado» con enlace al explorador, «Rol asignado», «Entregado» o «Sin ganador»;
    - entradas;
    - bloque «Cómo se comprueba» en tres pasos cortos:
      1. «Antes de empezar publicamos la huella de una semilla secreta.»
      2. «El azar sale de drand, una red pública: la ronda N, emitida justo después del cierre.»
      3. «Con la semilla y esa ronda cualquiera recalcula los ganadores.»
    - `GiveawayVerifier`: botón «Comprobar», que descarga la ronda con `fetchBeacon` desde el navegador, verifica el commit, la firma y los ganadores, y muestra un ✓ o ✗ por paso con iconos Lucide. Si `unavailable`, «No se pudo descargar la ronda. Inténtalo más tarde.»
    - acciones de tesorero: «Sortear ahora», «Marcar pagado» (pegar el hash), «Marcar entregado» y «Cancelar».
  - `CreateGiveawayDialog`:
    - título, descripción opcional y cierre;
    - `PrizeEditor` con hasta 10 filas;
    - el tipo de cada fila es un selector segmentado: «USDC» (`NetworkPicker` + importe), «Rol» (`select` con los roles permitidos que da `getRolesContext`, filtrados por las reglas de P1-R9) o «Otro» (texto).
    - Aviso: «Gratis: nunca se paga por participar. Todos tienen la misma probabilidad.»

- [ ] **Step 1: `ui-ux-pro-max`** para la lista, el detalle (estados y verificador) y el diálogo con filas dinámicas.
- [ ] **Step 2: tests unit que fallan:**
  - la tarjeta muestra la cuenta atrás y «Participar» o «Salir»;
  - el verificador con un beacon `unavailable` muestra el texto exacto y ningún ✗ (Review Focus 5);
  - con todo correcto muestra 3 ✓;
  - `PrizeEditor` no deja añadir un 11.º premio;
  - el diálogo envía `p_prizes` con `kind`;
  - la notificación `giveaway_won` enlaza a `/sorteos/<id>`;
  - `/dao/sorteos/<id>` redirige a `/sorteos`.
- [ ] **Step 3: implementar.**
- [ ] **Step 4: e2e `e2e/p1-giveaways.spec.ts`** (con el drand simulado y el cron llamado por HTTP con `CRON_SECRET`):
  1. el tesorero crea un sorteo con 3 premios (USDC en Base Sepolia, un rol y «Camiseta»), cerrando en 10 min;
  2. tres miembros participan y uno sale y vuelve a entrar;
  3. el cierre se adelanta en BD con el cliente service y se llama al cron: el sorteo queda `drawn`, el ganador del rol lo tiene y llega la notificación;
  4. en el detalle, «Comprobar» da 3 ✓;
  5. «Marcar pagado» con una transferencia real de USDC de la Safe (impersonada en Hardhat con `hardhat_impersonateAccount`) → «Pagado»;
  6. «Marcar entregado» en el premio «Otro»;
  7. un sorteo sin entradas → `void`;
  8. sin errores en consola.
- [ ] **Step 5: verificar y commit** `feat(giveaways): /sorteos con premios, verificador drand en el navegador y panel del tesorero`.

### Task 11: Guía, `/start` y textos

**Files:**
- Modify: `src/lib/guide/sections.ts`, `src/components/guide/guide-content.tsx`, `src/lib/search/actions-list.ts` (`GUIDE_KEYWORDS`), todos los usos de `HowItWorksLink section="dao"`, `src/components/start/{features,hero,mocks}.tsx`, `src/app/start/page.tsx` (metadata), `tests/unit/guide/guide-content.test.tsx`, `tests/unit/start/start-landing.test.tsx`, `tests/unit/start/start-metadata.test.ts` y los tests de la paleta que cuentan acciones de la guía.

**Interfaces:**
- Produces:
  - `GuideSlug` = `propinas | bounties | donaciones | sorteos | encuestas | candados | redes`. Se quitan `dao` y `fondo`.
  - Contenido, corto y con los subtítulos que pide el test:
    - **donaciones:** «Qué es», «Cómo donar», «Qué recibes» (rol Mecenas desde 1 USD, lista de donantes con la opción de ocultarte, canales para Mecenas) y «Transparencia» (saldos de la Safe por red y gastos con nota). Incluye las frases exactas «ElClub. no custodia fondos» y «Donar no da derechos económicos».
    - **sorteos:** «Qué es» (gratis, misma probabilidad para todos), «Premios» (USDC, un rol u otra cosa), «Cómo se elige al ganador» (semilla secreta + ronda de drand) y «Cómo comprobarlo».
    - **encuestas:** «Qué es», «Cómo se vota» (1 miembro = 1 voto), «Voto secreto» y «Resultados» (al menos 3 votos para publicar porcentajes).
    - **candados:** la regla de lo donado en USD y los canales con permiso del rol Mecenas.
  - `/start`:
    - la tarjeta «Tesorería» pasa a «Donaciones» («Dona en Base o Arbitrum a la Safe del club. Sin retorno, con transparencia.», etiquetas «Mecenas» y «Safe»);
    - en la tarjeta de sorteos, «commit-reveal» pasa a «drand»;
    - en el hero, el chip «Sorteo · commit-reveal» pasa a «Sorteo · drand»;
    - en la metadata, «tesorería común» pasa a «donaciones».

- [ ] **Step 1: tests que fallan.**
  - Reescribir `guide-content.test.tsx` con los encabezados y las frases de arriba. Comprobar que ningún slug contiene «participaciones», «retirada», «Lineal», «Cuadrática», «comisión» ni `\bLinea\b`.
  - En `start-landing.test.tsx`, los h3 esperados pasan a ser: Canales, Alphas, Bounties, Propinas, **Donaciones**, Sorteos, Mercado y Moderación. Además, sin «commit-reveal».
- [ ] **Step 2: implementar.**
- [ ] **Step 3: verificar y commit** `docs(guia): donaciones y Mecenas, sorteos con drand, encuestas 1p1v; /start sin DAO`.

### Task 12: Motor de búsqueda compartido y datos de «Inicio»

**Files:**
- Create: `supabase/migrations/20261024200007_home_dashboard.sql`, `supabase/tests/p1_07_home_dashboard.test.sql`, `src/components/search/use-search-engine.ts`, `src/components/search/search-results.tsx`, tests unit
- Modify: `src/components/search/{command-palette,search-provider}.tsx`, `src/lib/home/queries.ts`, `tests/unit/home/queries.test.ts`

**Interfaces:**
- Produces (SQL):
  - `public.home_unread_channels(p_limit int default 6) returns table(channel_id uuid, channel_name text, unread_count int, last_excerpt text, last_author text, last_at timestamptz)`:
    - miembro activo; usa los mismos criterios que `my_unread_channels` (`20261016200003_message_social.sql:119`);
    - `unread_count` con tope de 99, `last_excerpt` de 140 caracteres como mucho y `last_author = _member_label`;
    - ordenado por `last_at desc`.
  - `public.home_highlights() returns jsonb`:
    - devuelve `{openBounties: int, poll: {messageId, channelId, question, closesAt} | null, giveaway: {id, title, closesAt, iEntered} | null, donor: {isMecenas: boolean}}`;
    - `poll`: la encuesta abierta más reciente con `can(channel, 1)`;
    - `giveaway`: el `open` que cierra antes.
- Produces (TS):
  - `useSearchEngine({ query, channels, actions }): { q: string; shownActions: PaletteAction[]; shownChannels: ChannelRow[]; members: MemberHit[]; messages: MessageHit[]; loading: boolean; failed: boolean; remoteEnabled: boolean }`. Mueve tal cual la lógica de `PaletteBody`: debounce de 200 ms, mínimo 2 caracteres, descartar respuestas viejas, recientes y `matches`.
  - `SearchResults({ engine, onSelect(href: string, channelId?: string): void })`: los `CommandGroup` Acciones, Canales, Miembros y Mensajes, y las filas de estado, con el mismo marcado y los mismos `value`. Debe ir dentro de un `<Command>`.
  - `PaletteBody` pasa a ser `CommandInput` + `SearchResults` sobre `useSearchEngine`, sin cambiar su comportamiento.
  - `useSearch(): { open(): void; channels: readonly ChannelRow[]; actions: readonly PaletteAction[] }`.
  - El guard de Ctrl+K (`suggestionOpen`) ignora los combobox con `data-home-search` (P1-R16).
  - `getHomeUnreadChannels(supabase, limit)` y `getHomeHighlights(supabase)` en `src/lib/home/queries.ts`.

- [ ] **Step 1: pgTAP que falla.**
  - `home_unread_channels` no lista canales sin permiso de ver ni los ya leídos, y cuenta con un tope de 99.
  - `home_highlights.poll` es nulo si la única encuesta abierta está en un canal oculto.
- [ ] **Step 2: tests unit.**
  - Todo `tests/unit/search/command-palette.test.tsx` sigue en verde sin cambios: es la red de seguridad del refactor.
  - Tests nuevos:
    - `useSearchEngine` con 1 carácter no llama a la parte remota;
    - `useSearch()` expone `channels`;
    - Ctrl+K con el foco en un combobox `data-home-search` expandido abre la paleta.
- [ ] **Step 3: implementar y verificar.**
- [ ] **Step 4: commit** `refactor(search): motor de la paleta reutilizable; datos del nuevo Inicio`.

### Task 13: Nuevo «Inicio» — buscador protagonista y dashboard visual

**Files:**
- Create: `src/components/home/{home-search,quick-tiles,continue-cards,featured-pin,home-greeting}.tsx`, tests unit, `e2e/p1-home.spec.ts`
- Modify: `src/app/(forum)/page.tsx`, `src/components/home/home-sections.tsx` (borrar `DaoSummary` y `UnreadBanner`; los demás se quedan si se usan), `tests/unit/home/home-sections.test.tsx`
- Delete: los imports de `getDaoOverview` en Inicio

**Interfaces:**
- Consumes: Tarea 12, `useUnread()`, `getUnreadSummary`, `getHomePins`, `getActiveChannels`, `memberName`, `MEMBER_IDENTITY_COLUMNS`, los primitivos de `src/components/start/motion.tsx` (`useMotionOn`, `rise`, `Stage`).
- Produces:
  - `HomeGreeting({ name })`: `h1` «Inicio» como etiqueta pequeña en mayúsculas en `fg-muted`, y debajo «Buenas, <name>» en la fuente display, al tamaño `text-h1` o mayor.
  - `HomeSearch()` (client):
    - `<Command shouldFilter={false} loop label="Buscar en ElClub." data-home-search>` con un `CommandInput` grande, del ancho del contenido y con un máximo de 720 px, el icono `Search` y la pista ⌘K o Ctrl K (componente de `search-button.tsx`);
    - placeholder «Busca canales, miembros y mensajes…»;
    - al enfocar o escribir se despliega bajo el campo un panel con `SearchResults` sobre `useSearchEngine` (contexto de `useSearch()`);
    - Esc limpia y pliega; hacer clic fuera pliega; `Enter` navega igual que la paleta;
    - el panel se superpone sin mover el resto de la página.
  - `QuickTiles({ highlights, mentions })`, una rejilla de 2 columnas en móvil y 5 en escritorio. Cada ficha es un enlace de al menos 44 px con un icono Lucide, la cifra en la fuente display y una etiqueta:
    - «Sin leer»: cuenta de `useUnread`, enlaza al primer canal sin leer; si es 0, «Al día»;
    - «Menciones»: menciones + respuestas, enlaza a `/notifications`;
    - «Bounties»: `openBounties`, enlaza al primero o a la guía;
    - «Sorteo»: solo si hay uno; título y «Cierra en …»;
    - «Encuesta»: solo si hay una;
    - «Donar», o «Mecenas» si ya lo eres: enlaza a `/donar`.
  - `ContinueCards({ channels })`: «Continúa donde lo dejaste», como mucho 6 tarjetas con `#canal`, «N nuevos», extracto y autor. Sin canales pendientes: «Estás al día.»
  - `FeaturedPin({ pins })`: el fijado más reciente en grande; «Ver todos (N)» despliega los demás.
  - Actividad reciente: `ActiveChannelsList` compacto como mucho con 5 canales.
  - Animación: entrada `rise` escalonada en las fichas y tarjetas (30–50 ms) solo con `useMotionOn()`. El HTML del servidor ya es la página final.
  - Sin la tarjeta de la DAO ni textos de introducción largos.

- [ ] **Step 1: `ui-ux-pro-max`.** Consultarlo para un dashboard con el buscador como protagonista: jerarquía, densidad, fichas y escalado de 375 a 1920. Tomar `/start` como referencia de estética: negro, cian solo en foco y en lo activo, Archivo grande. Anotar las conclusiones en el informe.
- [ ] **Step 2: tests unit que fallan:**
  - el `h1` «Inicio» y el saludo con `memberName`;
  - `HomeSearch` con «ab» llama a la búsqueda remota después de 200 ms y pinta los grupos;
  - Esc vacía el campo;
  - sin sorteo, no hay ficha de sorteo;
  - «Mecenas» sustituye a «Donar» cuando `isMecenas`;
  - `ContinueCards` vacío muestra «Estás al día.»;
  - «Ver todos (N)» despliega la lista.
- [ ] **Step 3: implementar** la página: `Promise.allSettled` por bloque, como hoy, y cada bloque aislado ante errores.
- [ ] **Step 4: e2e `e2e/p1-home.spec.ts`:**
  1. el campo de Inicio encuentra un mensaje y con Enter salta a él;
  2. un mensaje de un canal oculto nunca aparece;
  3. Ctrl+K con el foco en el campo abre la paleta;
  4. las fichas reflejan una encuesta y un sorteo abiertos;
  5. «Continúa donde lo dejaste» muestra el canal con mensajes nuevos;
  6. sin scroll horizontal a 375 px;
  7. sin errores en consola.
  - Actualizar `e2e/screens.spec.ts` si captura Inicio.
- [ ] **Step 5: verificar y commit** `feat(home): Inicio con buscador protagonista, accesos rápidos y continuar donde lo dejaste`.

### Task 14: Verificación final y documentación

**Files:**
- Modify: `docs/superpowers/specs/2026-10-24-base-arbitrum-y-parte-publica-design.md` (P1 marcado como hecho con referencia a los rulings), `.env.example` y `deploy/preprod/web.env.example` (si cambian variables: ninguna nueva en producción; los overrides de drand y del feed son solo de test y no van en los ejemplos).

- [ ] **Step 1:** `pnpm lint && pnpm typecheck && pnpm test` (lo ejecuta el controlador).
- [ ] **Step 2:** `pnpm db:test` y `pnpm test:e2e` en dev y con `E2E_PROD=1` (lo ejecuta el controlador). Anotar los resultados exactos.
- [ ] **Step 3:** buscar «DAO» y «participaciones» en `src/` fuera de las islas legadas. Solo pueden quedar en el legado congelado.
- [ ] **Step 4: commit** `docs: P1 hecho`.

## ⚠️ HACER A MANO ⚠️ (el usuario)
- **Desplegar la Safe** `0x380f2e12081995359e2Ab88E3c31c6b227904234` en Base Sepolia y Arbitrum Sepolia (PRE) y, antes de PRO, en Base y Arbitrum, con los mismos owners y umbral. Sin ella, `/donar` muestra «Donaciones aún no disponibles» (P1-R6) y no se pueden pagar premios USDC de sorteos.
- **Asignar canales a Mecenas:** en Ajustes → canal → permisos, quita «Ver canal» a @everyone y dáselo al rol Mecenas.
