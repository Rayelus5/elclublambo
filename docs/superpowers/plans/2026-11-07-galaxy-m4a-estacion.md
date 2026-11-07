# Galaxy Survivor · M4a: la estación · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (decidido: ejecución directa, `feedback-direct-execution`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El Hogar (GDD §10) es una estación en corte lateral y pixel art, donde cada sala abre su herramienta. Empieza medio rota. De cada incursión traes material en bruto, que la refinería convierte en componentes con el tiempo real. Con los componentes se reparan y se mejoran salas. La antena da un goteo mínimo de señales.

**Architecture:**
- **Reglas** (`packages/shared`): `station/`, con el catálogo de salas, el estado perezoso de la refinería (avanza con la hora del servidor al leer o escribir) y la antena. El material de cada partida se calcula aparte. Clave viva nueva: `station`.
- **Monedas:** se añaden `material` y `components`, en el mismo monedero y libro de movimientos.
- **Base de datos:** `galaxy.station_rooms` (nivel por sala), `galaxy.refinery` (cola, listos y reloj) y `galaxy.antenna` (reloj). El CHECK de monedas se amplía.
- **Servidor:**
  - `GET /galaxy/api/station`;
  - cargar la refinería, recoger componentes, recoger la antena y reparar o mejorar una sala. Son operaciones con clave de idempotencia y libro de movimientos;
  - el final de partida acredita el material.
- **Web:**
  - la pantalla `/estacion`: el casco de la estación dibujado por regla, con diez salas que muestran su estado y su nivel;
  - paneles de refinería, antena y reparación;
  - el Hogar de la portada lleva a la estación;
  - los resultados enseñan el material traído.

**Tech Stack:** el de M3b más dos migraciones (Supabase/pgTAP).

**Spec:**
- `games/galaxy/docs/GDD.md`:
  - §10 (la estación: salas, empieza rota, las máquinas procesan, goteo, laboratorio);
  - §11.1–§11.4 (recursos, sumideros, reglas del servidor, calibración: el goteo pesa menos del 10 % de los ingresos);
  - §4 (portada: Hogar);
  - §19 (M4).
- `DESIGN_SYSTEM.md`.

## Decisiones de alcance (rulings del plan)

1. **M4 se parte en tres**, como M3b. Cada parte es un plan, un PR y algo jugable en PRE:
   - **M4a, la estación:** salas, reparación, material y refinería, y antena;
   - **M4b:** laboratorio, niveles de sonda y variantes de arma;
   - **M4c:** planetario visitable y lo que falte de reliquias.
2. **Salas y estado inicial.** La estación muestra las 10 salas de §10.
   - **Funcionan desde el principio:**
     - Hangar, Escáner, Planetario (la colección) y Colisionador (fusionar y desintegrar), porque el onboarding y M2–M3 ya las usan;
     - la Refinería, nivel 1: sin ella no hay componentes con los que reparar nada.
   - **Empiezan rotas:** Antena (se repara en M4a), Laboratorio (M4b), Comunicaciones (M5), Archivo y Trofeos (M7). Las de hitos futuros dicen «En reparación» y no se pueden reparar todavía.
3. **Solo la Refinería y la Antena tienen niveles en M4a** (1–5). Las salas que ya funcionan abren su pantalla sin niveles. YAGNI: sus mejoras llegan con el laboratorio (M4b).
4. **Un material, un componente.** La refinería convierte 1 de material en 1 componente a `rate` por hora, con una cola de `queue` como máximo. Los componentes refinados esperan dentro de la refinería hasta que los recoges.
   - **Estado perezoso:** se avanza con la hora del servidor en cada lectura o escritura y nunca hay procesos en segundo plano. El tiempo sobrante se conserva, así que no se pierden fracciones.
5. **La antena** acumula `rate` señales por hora, con un tope de **8 h** acumuladas. Al recoger se cobran las enteras y se conserva el tiempo de la fracción.
6. **Material de las partidas,** calculado en el servidor como el botín:
   - `(capa × perLayer + Núcleos × perBoss + bajas / 100 × perHundredKills) × parte × rendimiento diario`, redondeado hacia abajo;
   - con su propio tope por partida (`runs.caps.runMaterial`);
   - una partida tramposa cobra la parte de morir, igual que el botín.
7. **Mejoras con componentes y monedas** (§11.2: sumideros). La reparación de la antena cuesta solo componentes.

## Global Constraints

Las de M3b (rama `feature/galaxy-m4a` desde `develop`, TDD, determinismo donde aplique, contenido como datos, frontend con ui-ux-pro-max y DESIGN_SYSTEM, copy sin punto final, CSP, BD local solo con `migration up` y `test db`, migración con fecha UTC). Además:
- **§11.3:**
  - cada acción de economía es una transacción con clave de idempotencia;
  - el libro de movimientos es de solo añadir;
  - un saldo nunca baja de 0;
  - el servidor decide la hora (`deps.now()`), nunca el cliente.
- **Arte:** casco y salas en pixel art por regla (`sprites/`), escalado entero, contorno de 1 px y luz arriba a la izquierda. Una sala rota lleva el glitch de la Estática (quieto con movimiento reducido).

### Valores de partida (clave viva `station` y `runs`)

| Sala | id | Al empezar | Abre |
|---|---|---|---|
| Escáner profundo | `scanner` | funciona | `/escaner` |
| Planetario | `planetarium` | funciona | `/coleccion` |
| Laboratorio | `lab` | rota (M4b) | — |
| Hangar | `hangar` | funciona | `/incursion` |
| Colisionador | `collider` | funciona | `/coleccion` |
| Comunicaciones | `comms` | rota (M5) | — |
| Refinería | `refinery` | nivel 1 | panel |
| Antena | `antenna` | rota, se repara | panel |
| Archivo | `archive` | rota (M7) | — |
| Trofeos | `trophies` | rota (M7) | — |

| Nivel | Refinería: material/h · cola · coste | Antena: señales/h · coste |
|---|---|---|
| 1 | 20 · 100 · — | 0,125 (1 cada 8 h) · reparar: 30 componentes |
| 2 | 30 · 150 · 40 comp. + 500 monedas | 0,15 · 40 comp. + 400 monedas |
| 3 | 45 · 250 · 90 + 1 200 | 0,175 · 80 + 900 |
| 4 | 65 · 400 · 180 + 2 500 | 0,2 · 150 + 1 800 |
| 5 | 90 · 600 · 320 + 5 000 | 0,25 · 260 + 3 500 |

- Antena: tope de 8 h acumuladas.
- Material por partida (`runs.material`): `perLayer` 6, `perBoss` 10, `perHundredKills` 2. Tope por partida: `runs.caps.runMaterial` 500.

**Copy:**
- **Salas:** «Escáner profundo», «Planetario», «Laboratorio», «Hangar», «Colisionador», «Comunicaciones», «Refinería», «Antena», «Archivo», «Trofeos».
- **Estados:** «En reparación» (rota, de un hito futuro), «Rota» (se puede reparar), «Nivel N».
- **Recursos:** «Material en bruto» y «Componentes».

## Review Focus

1. **Dos cargas, recogidas o mejoras a la vez, o la misma repetida:**
   - una clave repetida devuelve el mismo resultado;
   - dos claves distintas nunca cobran ni pagan dos veces lo mismo;
   - ningún saldo baja de 0, ni la cola pasa de su capacidad.

   → Tareas 1, 2 y 4.
2. **El reloj:**
   - la refinería, días después, no da más de lo que tiene en cola;
   - la antena no pasa de 8 h aunque pase una semana;
   - recoger dos veces seguidas no da dos veces;
   - un reloj del servidor que retrocede no da nada negativo.

   → Tareas 1 y 4.
3. **Subir una sala al máximo o reparar una que no se puede** (de un hito futuro, o ya reparada): `409` claro y nada cobrado → Tarea 4.
4. **Material de partidas tramposas, abandonadas o fuera del rendimiento diario:** sigue las mismas reglas que el botín (parte de morir, rendimiento diario, tope) → Tarea 3.
5. **Una cuenta sin filas de estación:** la vista la crea con el estado inicial, igual en dos peticiones simultáneas → Tarea 4.

---

### Task 1: Reglas de la estación

**Files:**
- Create: `games/galaxy/packages/shared/src/station/{rooms,refinery,antenna}.ts`.
- Modify:
  - `games/galaxy/packages/shared/src/config/registry.ts`: clave `station` (rooms y antenna, con los valores de partida) y, en `runs`, `material` y `caps.runMaterial`;
  - `games/galaxy/packages/shared/src/runs/rewards.ts`: `runMaterial`;
  - `games/galaxy/packages/shared/src/gacha/types.ts`: `Currency` gana `'material' | 'components'`;
  - `games/galaxy/packages/shared/src/index.ts`.
- Test: `games/galaxy/packages/shared/test/station.test.ts`.

**Interfaces:**
- Produces:
  - `ROOM_IDS` (los 10) y `RoomId`;
  - `roomStatus(id, level, cfg) → { state: 'working' | 'broken' | 'future'; level; maxLevel; next: { cost: { components: number; coins: number }; } | null }`;
  - `advanceRefinery(row: { queue: number; ready: number; clock: Date }, level, cfg, now) → { queue; ready; clock }`: puro y monótono, que no fabrica de más;
  - `antennaAccrued(clock: Date, level, cfg, now) → { signals: number; clock: Date }`: `clock` es el reloj tras cobrar las enteras;
  - `runMaterial(claim, cfg, factor, penalized) → number`.

- [ ] **Step 1: Tests que fallan:**
  - **Refinería:**
    - 1 h a 20/h convierte 20;
    - con 5 en cola, un día después solo hay 5 listos;
    - 30 min y luego otros 30 min dan lo mismo que 1 h;
    - un `now` anterior al reloj no cambia nada.
  - **fast-check:** `queue + ready` nunca crece; `ready` nunca baja; `queue` nunca baja de 0.
  - **Antena:**
    - a 0,125/h, 8 h dan 1 y una semana también da 1 (tope);
    - 12 h dan 1, y el reloj guarda las 4 h sobrantes, de las que solo cuentan las del tope;
    - nivel 0 (rota) da 0.
  - **`roomStatus`:**
    - el Laboratorio es `future`;
    - la Antena nivel 0 es `broken` con el coste de reparar;
    - la Refinería 5 no tiene `next`.
  - **`runMaterial`:**
    - capa 3, 2 Núcleos y 600 bajas, extraída: 50;
    - muerta: 25;
    - con `factor` 0,5, la mitad;
    - tramposa: la parte de morir;
    - nunca pasa de `runMaterial`.
  - La clave rechaza costes negativos, niveles desordenados y campos de más.
- [ ] **Step 2:** Ejecutar `pnpm -C games/galaxy exec vitest run --project unit packages/shared/test/station.test.ts`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar, con fechas como `Date` y sin `Date.now()`: la hora llega como parámetro.
- [ ] **Step 4:** Ejecutar `pnpm -C games/galaxy exec vitest run --project unit packages/shared`. Esperado: PASA.
- [ ] **Step 5: Commit** `feat(galaxy): reglas de la estación, la refinería y la antena`.

### Task 2: Base de datos de la estación

**Files:**
- Create: `supabase/migrations/<UTC>_galaxy_station.sql`:
  - amplía el CHECK de moneda de `galaxy.balances` y `galaxy.ledger` con `material` y `components`;
  - crea `galaxy.station_rooms (account_id, room, level ≥ 0, updated_at, pk (account, room))`;
  - crea `galaxy.refinery (account_id pk, queue ≥ 0, ready ≥ 0, clock)`;
  - crea `galaxy.antenna (account_id pk, clock)`.

  RLS en las tres. `galaxy_api` puede `select`, `insert` y `update` (sin `delete`), y nadie más.
- Create: `supabase/tests/976_galaxy_station.test.sql`.
- Modify: `games/galaxy/apps/server/src/db/schema.ts`.

- [ ] **Step 1: Tests pgTAP que fallan:**
  - las tablas existen con RLS;
  - permisos de `galaxy_api` y nadie más;
  - un saldo de `components` se puede crear y uno de `foo` no;
  - `queue` o `ready` negativos y `level` negativo se rechazan.
- [ ] **Step 2:** Ejecutar `pnpm exec supabase test db`. Esperado: FALLAN.
- [ ] **Step 3:** Escribir la migración y aplicarla con `pnpm exec supabase migration up`.
- [ ] **Step 4:** Ejecutar `pnpm exec supabase test db`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(galaxy): tablas de la estación y monedas de material y componentes`.

### Task 3: Material de las incursiones

**Files:**
- Modify:
  - `games/galaxy/apps/server/src/runs/service.ts`: `finishRun` acredita `material` (razón `run`, la misma clave);
  - `games/galaxy/packages/shared/src/api/runs.ts`: `RunResult.payout.material`;
  - `games/galaxy/apps/web/src/hangar/ResultsScreen.tsx`: una línea «Material en bruto».
- Test:
  - `games/galaxy/apps/server/test/integration/runs.test.ts`;
  - `games/galaxy/apps/web/test/results.test.tsx`.

- [ ] **Step 1: Tests que fallan:**
  - una partida extraída de capa 2 con 1 Núcleo y 300 bajas acredita `floor((12 + 10 + 6) × 1) = 28` de material, con su fila en el libro de movimientos;
  - una abandonada, la mitad;
  - una marcada por trampa, la parte de morir;
  - reenviar el mismo final no acredita dos veces;
  - los resultados muestran «Material en bruto» con su cantidad.
- [ ] **Step 2:** Ejecutar `pnpm -C games/galaxy exec vitest run --project integration apps/server/test/integration/runs.test.ts` y `--project web apps/web/test/results.test.tsx`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Ejecutar los mismos comandos. Esperado: PASAN.
- [ ] **Step 5: Commit** `feat(galaxy): las incursiones traen material en bruto`.

### Task 4: La estación en el servidor

**Files:**
- Create: `games/galaxy/apps/server/src/station/{service,routes}.ts`, registrado junto a las rutas de runs.
- Modify: `games/galaxy/packages/shared/src/api/station.ts`, con `StationView`, los esquemas de petición y los errores nuevos `refinery_full`, `room_maxed`, `room_unavailable` y `nothing_to_collect`.
- Test: `games/galaxy/apps/server/test/integration/station.test.ts`, con un `now` inyectado en `testApp`.

**Interfaces:**
- Produces:
  - `GET /galaxy/api/station` → `StationView = { rooms: { id; state; level; maxLevel; next }[]; refinery: { level; rate; capacity; queue; ready; nextAt: string | null }; antenna: { level; rate; capHours; accrued: number; fullAt: string | null }; wallet: Wallet }`;
  - `POST /galaxy/api/station/refinery/load { amount }`;
  - `POST /galaxy/api/station/refinery/collect`;
  - `POST /galaxy/api/station/antenna/collect`;
  - `POST /galaxy/api/station/rooms/:id/upgrade`.

  Todas las `POST` llevan `Idempotency-Key` y devuelven `StationView`.

- [ ] **Step 1: Tests que fallan:**
  - **Vista inicial:** una cuenta nueva ve 5 salas que funcionan, la Antena rota y 4 en reparación, la refinería 1 vacía y la antena a 0. Dos `GET` simultáneos no fallan.
  - **Refinería:**
    - cargar 50 de material lo descuenta y lo pone en cola;
    - cargar más de la capacidad da 409 `refinery_full` y no cobra nada;
    - 1 h después hay 20 listos;
    - recoger acredita 20 componentes y una segunda recogida sin nada listo da 409 `nothing_to_collect`;
    - la misma clave repetida devuelve lo mismo sin cobrar ni acreditar dos veces.
  - **Reparar la antena:** sin componentes da 409 `insufficient_funds`; con 30, la repara y cobra 30.
  - **La antena tras la reparación:** 12 h después recoger da 1 señal, y una semana después, 1.
  - **Mejorar:**
    - la Refinería de 1 a 2 cobra 40 componentes y 500 monedas, y sube su ritmo;
    - la 5 da 409 `room_maxed`;
    - reparar el Laboratorio da 409 `room_unavailable`;
    - una sala inexistente da 400.
  - **Concurrencia:** dos cargas de 60 con claves distintas y 100 de material: una pasa y la otra da 409, y el saldo nunca es negativo.
- [ ] **Step 2:** Ejecutar `pnpm -C games/galaxy exec vitest run --project integration apps/server/test/integration/station.test.ts`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar. Cada operación va en `runOperation` (idempotencia) con un bloqueo de cuenta (`pg_advisory_xact_lock`, `station:<account>`). Al entrar se crea el estado inicial perezoso, y la refinería y la antena avanzan con `deps.now()` antes de cada cambio.
- [ ] **Step 4:** Ejecutar `pnpm -C games/galaxy exec vitest run --project integration`. Esperado: PASA.
- [ ] **Step 5: Commit** `feat(galaxy): la estación en el servidor`.

### Task 5: El arte de la estación

**Files:**
- Create: `games/galaxy/apps/web/src/station/art.ts`, con dibujos por regla:
  - el casco en corte lateral (ancho de 3 pisos por 4 módulos);
  - el interior de cada sala, dos fotogramas, en dos versiones: funcionando (luces de su color) y rota (oscura, con el glitch de la Estática);
  - la refinería y la antena con un detalle que crece con su nivel: tanques llenos o más antenas.
- Test: `games/galaxy/apps/web/test/station-art.test.ts` (rejillas bien formadas, las 10 salas en los dos estados) y la hoja a 4× en `test/browser`.

- [ ] **Step 1: Test que falla:** las 10 salas tienen sprite en ambos estados y el casco existe.
- [ ] **Step 2:** Ejecutar `pnpm -C games/galaxy exec vitest run --project web apps/web/test/station-art.test.ts`. Esperado: FALLA.
- [ ] **Step 3:** Dibujar y revisar la hoja: se reconoce qué hace cada sala y la rota se distingue al vuelo.
- [ ] **Step 4:** Ejecutar el test y la hoja. Esperado: PASAN, con la hoja revisada.
- [ ] **Step 5: Commit** `feat(galaxy): el arte de la estación`.

### Task 6: La pantalla de la estación

**Files:**
- Create: `games/galaxy/apps/web/src/station/StationScreen.tsx` y sus paneles `RefineryPanel` y `AntennaPanel`. La ruta `/estacion` va en `App.tsx`, como `SignedIn`.
- Modify:
  - `games/galaxy/apps/web/src/api/station.ts`: `useStation` y las mutaciones con claves de idempotencia, como `useStartRun`;
  - `hub/MainMenu.tsx`: el Hogar lleva a `/estacion`;
  - `copy/es.ts`, `styles/app.css` y `docs/DESIGN_SYSTEM.md` (§8 septies, la estación).
- Test:
  - `games/galaxy/apps/web/test/station.test.tsx`;
  - capturas a 1280, 1600 y 1920 en `test/browser`.

- [ ] **Step 1: Tests que fallan:**
  - la estación muestra las 10 salas con su nombre y estado;
  - las que funcionan son enlaces a su pantalla (el Hangar a `/incursion`, el Escáner a `/escaner`, el Planetario y el Colisionador a `/coleccion`);
  - las rotas de hitos futuros dicen «En reparación» y no son botones;
  - la Antena rota abre su panel con «Reparar», el coste y el botón desactivado si faltan componentes.
  - **Panel de la refinería:**
    - nivel, ritmo, cola y listos;
    - «Cargar» con la cantidad (por defecto, todo lo que cabe de lo que tienes) envía `load`;
    - «Recoger» envía `collect`;
    - «Mejorar» con su coste.
  - **Panel de la antena:** señales acumuladas, «Recoger» y cuándo se llena.
  - **Errores:** un 409 muestra su texto.
  - **Portada:** el Hogar de la portada es un enlace a `/estacion`.
- [ ] **Step 2:** Ejecutar `pnpm -C games/galaxy exec vitest run --project web apps/web/test/station.test.tsx`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar, consultando antes ui-ux-pro-max:
  - el corte lateral es la escena y los paneles van encima;
  - el foco va al panel al abrirse y vuelve a la sala al cerrarse;
  - Escape cierra el panel;
  - el progreso de la refinería es una barra.
- [ ] **Step 4:** Ejecutar la suite web y las capturas, y revisarlas. Esperado: PASAN.
- [ ] **Step 5: Commit** `feat(galaxy): la pantalla de la estación`.

### Task 7: e2e, documentación, verificación, revisión final, PR y PRE

- [ ] **e2e** (`station.spec.ts` nuevo):
  - una cuenta nueva entra en la estación desde el Hogar y ve la Antena rota;
  - con material concedido por el CLI (`grant <user> material 60`), carga la refinería;
  - con componentes concedidos, repara la antena;
  - sin violaciones de CSP.
- [ ] **CLI:** si `grant` no acepta `material` o `components`, se amplía con su test.
- [ ] **DEPLOY_PRE paso 9:**
  - la migración `galaxy_station`;
  - la clave `station` y `runs.material`;
  - qué comprobar.
- [ ] **Verificación completa:**
  - typecheck y lint;
  - `pnpm -C games/galaxy test`;
  - pgTAP;
  - `TZ=UTC pnpm test:unit` en la raíz;
  - todo el e2e;
  - build de Docker y smoke.
- [ ] **Cierre:** revisor nuevo (opus, `review-package`) y una pasada de correcciones con TDD. Después:
  - PR a `develop`, CI y fusión;
  - comprobación en PRE con una cuenta `e2e_pre_*`;
  - registro a docs y borrar el espacio de trabajo;
  - memoria e informe.
