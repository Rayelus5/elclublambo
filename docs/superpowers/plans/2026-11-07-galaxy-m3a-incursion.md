# Galaxy Survivor · M3a: núcleo de la incursión · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (decidido: ejecución directa, `feedback-direct-execution`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La primera incursión jugable en PRE: desde el título entras al Hangar, equipas dos galaxias como reliquias y lanzas una partida en la Nebulosa Exterior. Te mueves, la sonda dispara sola, subes de nivel eligiendo 1 de 3 mejoras, vences al Núcleo de la Estática al final de cada capa y extraes en la baliza o caes. El servidor paga el botín (profundidad, muerte, rendimiento diario) y guarda la partida para poder repetirla.

**Architecture:**
- **Simulación** (`packages/sim`, nuevo, `@galaxy/sim`): determinista, paso fijo de 60 Hz, RNG con semilla, arrays tipados con rejilla espacial, N sondas alimentadas con comandos de entrada por tick, grabación compacta de entradas y repetición. El contenido (sector, fauna, jefe, armas, pasivas, elementos, ajustes de reliquias, sonda) son **datos** validados con Zod; los comportamientos son código.
- **Reglas** (`packages/shared/src/runs/*`): botín por capa con multiplicador de profundidad, reparto al morir, rendimiento diario prorrateado y controles de plausibilidad. Claves nuevas de configuración viva: `content`, `runs` y `features.runs`.
- **Servidor** (`apps/server/src/runs/*`): Hangar (ranuras y reliquias equipadas), inicio de partida (semilla del servidor y foto de las reliquias) y fin de partida (una sola vez, idempotente, con plausibilidad, pago en el libro y entradas guardadas).
- **Web** (`apps/web/src/{hangar,arena}`): Hangar, arena PixiJS v8 en su propio fragmento (solo dibuja; interpolación entre ticks, cámara con tope 21:9, sprites pixel art en código, *juice*), HUD React encima, mejoras, pausa, radio de PERKINS y resultados.

**Tech Stack:** TypeScript, Zod 4, PixiJS 8.21.0 (`pixi.js/unsafe-eval`), React 19 + TanStack Query 5, Fastify + Kysely + Postgres, WebAudio, Vitest (+ fast-check, proyecto browser con Chromium/SwiftShader), pgTAP, Playwright.

**Spec:**
- `games/galaxy/docs/GDD.md`: §5 (incursiones completas), §6 (sondas: sonda inicial), §8.2–8.4 bis y §8.6 (reliquias, poder por rareza, rasgos → pasiva, ranuras, nivel, frenos), §11.1–11.3 bis (recursos, servidor, rendimiento diario), §13.1 bis (contenido como datos desde M3a), §14.7 (plausibilidad), §15 (radio de PERKINS), §17.2–17.5 (pantallas anchas, *juice*, audio, arte), §18.4–18.5 (simulación, cliente, base de datos), §19 (M3a).
- `games/galaxy/docs/DESIGN_SYSTEM.md` (todo el frontend; se amplía antes de usar algo nuevo).
- Autoridad: autonomía total hasta la beta (2026-11-06, reafirmada el 2026-11-07): este plan lo apruebo yo; las dudas se resuelven con *rulings* en el registro.

## Decisiones de alcance (rulings del plan)

1. **M3a va en un PR** a `develop`.
2. **Contenido de M3a:** 1 sector («Nebulosa Exterior»), 6 especies (una es la cría de otra), 3 modificadores de élite, 1 jefe con 3 fases, 7 armas, 8 pasivas, los 11 elementos, las 8 familias de reliquia y los 8 fenómenos, 1 sonda («Lumen»). M3b completa el catálogo (4+1 sectores, ~24 enemigos, 16 armas, 20 pasivas, evoluciones, reacciones, conjuntos de reliquias, 8 sondas y el test).
3. **Sin reacciones ni conjuntos de reliquias** (M3b). Los elementos sí: cada reliquia aplica el suyo a sus golpes y da un 15 % de probabilidad de aplicarlo a los golpes de las armas.
4. **Terreno decorativo** (sin colisiones) en M3a. Los obstáculos llegan con los sectores de M3b.
5. **Botín de M3a:** monedas y polvo estelar (los suelta la simulación) y, rara vez, señales (las sortea el servidor por cada jefe vencido). El material en bruto llega con la refinería (M4).
6. **Ranuras y nivel de reliquia:** 2 ranuras; el nivel guardado (1) ya cuenta en la potencia. Subir el nivel con polvo y desbloquear ranuras llegan con la estación (M4).
7. **Verificación por repetición en el servidor:** M5 (antiabuso), junto con la retención de 30 días de `run_inputs`. M3a guarda las entradas y el hash final, y aplica plausibilidad.
8. **Cooperativo:** la simulación admite N sondas (probado con 2); la interfaz juega con 1.
9. **Audio:** efectos de combate sintetizados (golpe, baja, recogida, subida de nivel, aviso de jefe, extracción). La música adaptativa es M8.
10. **Sprites:** pixel art escrito como rejillas de paleta en código (GDD §17.5 admite «sprites generados por código»), rasterizados a un atlas al cargar. Aseprite queda para piezas hechas a mano (la estación, M4). Coste si hay que cambiar: los sprites son datos; solo cambia el atlas.
11. **Abandonar** desde la pausa es una retirada: cobra como morir (50 %).
12. **Rendimiento diario:** la duración de una partida es `min(ticks / 60, tiempo real)` y cuenta en el día de Madrid en que termina. El polvo también se recorta (no está en la lista [U] de lo que nunca se recorta).
13. **Contenido como datos:** la clave `content` de la configuración viva guarda sectores, fauna, élites, jefes, armas, pasivas, elementos, ajustes de reliquias y sondas, con esquema y valor por defecto en `@galaxy/sim`. La economía de las incursiones va en la clave `runs`.
14. **Paquetes:** `packages/sim` es nuevo (GDD §18.1). No se crea `packages/rules`: las reglas siguen en `@galaxy/shared`, como desde M2b.
15. **Reliquia equipada:** no se puede desintegrar ni fusionar (`409 galaxy_equipped`); hay que quitarla antes.
16. **PixiJS 8.21.0 exacta** (8.22 se publicó ayer).
17. **Partida pendiente:** si el envío del final falla, el cliente lo guarda en `localStorage` (`galaxy.run.pending`) y lo reenvía con la misma clave al volver al Hangar. Una partida sin terminar caduca a las 24 h.

## Global Constraints

- **Rama** `feature/galaxy-m3a` desde `develop` (145eecc). Commits en español, convencionales, con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR a `develop`; se fusiona con el CI en verde y se verifica PRE.
- **TDD estricto.** Reglas con fast-check (≥ 200 casos); la simulación con pruebas de comportamiento sobre un contenido de prueba (`packages/sim/test/fixtures.ts`), para que calibrar los números no rompa las pruebas de mecánica; BD con pgTAP (`supabase/tests/973_galaxy_runs.test.sql`); e2e con Playwright.
- **Determinismo (`packages/sim`):** nunca `Math.random`, `Date`, `performance` ni E/S. Solo `+ - * /`, `Math.sqrt`, `Math.floor/ceil/round/trunc/abs/min/max/sign`, `Math.imul` y operaciones de bits. Prohibidos `Math.sin/cos/tan/atan/atan2/pow/exp/log/hypot/cbrt` (difieren entre motores): trigonometría propia por tabla (`ANGLE_STEPS = 4096`). Orden de iteración fijo (índices ascendentes; nada de iterar `Set`/objetos con claves numéricas para decidir). Una regla de lint en `packages/sim` prohíbe esas funciones.
- **Paso fijo 60 Hz**, tiempos del contenido en segundos convertidos a ticks con `Math.round(s * 60)`. Unidades del mundo: 1 unidad = 1 píxel del sprite a zoom 1.
- **Contenido como datos:** todo número de partida está en `content` (`DEFAULT_CONTENT`) o en `runs`, con los valores de abajo como defecto. Cada partida guarda la versión de `content`, la de `runs` al pagar, y `SIM_VERSION`.
- **El servidor decide el pago** (§11.3): semilla de partida con `crypto.randomBytes(8)`; fin de partida una sola vez, con `Idempotency-Key`, libro de solo añadir y saldos ≥ 0. Repetir la clave devuelve lo mismo; otra clave sobre una partida terminada es `409 run_finished`.
- **Día del juego:** medianoche de `Europe/Madrid` (`madridDay`), en el servidor.
- **Frontend:** consultar ui-ux-pro-max antes del CSS; tokens y componentes de `DESIGN_SYSTEM.md` (nuevas §8 ter Hangar y §8 quater Arena antes de usarlos); copy con las reglas de §9 (títulos directos, sin símbolos ni punto final); `prefers-reduced-motion` (sin sacudida, sin destellos de glitch, menos partículas); solo escritorio (`DesktopGate`).
- **CSP intacta:** PixiJS se importa como `pixi.js/unsafe-eval` y solo en el fragmento perezoso de la arena; nada de estilos en línea por `<style>`.
- **BD local del usuario:** solo `pnpm exec supabase migration up` y `pnpm exec supabase test db`; nunca `db reset` ni `pnpm db:test`. Migración con la fecha de creación real.
- **Comandos:** unit `pnpm -C games/galaxy exec vitest run --project unit <ruta>`; web `--project web`; integración `--project integration` (con la BD local migrada); browser `--project browser`; e2e `pnpm -C games/galaxy/apps/web exec playwright test <spec>` (si no termina en Windows, parar por PID su CLI y su `node ../server/dist/main.js`).

### Valores de partida

**Sonda `lumen` «Lumen»:** vida 100, velocidad 90 u/s, recogida 40 u, blindaje 0, regeneración 0, arma inicial `pulse`, bonus `{ pickup: 0.3, xp: 0.1 }` (fuerte en recogida; los fragmentos dan un 10 % más).

**Armas** (5 niveles; cada fila da los niveles 1→5; vacío = 0):

| id | Nombre | Tipo | Daño | Enfriamiento s | Cantidad | Otros |
|---|---|---|---|---|---|---|
| `pulse` | Pulso láser | `bolt` (al más cercano) | 10,12,12,15,18 | 0.9,0.9,0.8,0.75,0.7 | 1,1,2,2,3 | velocidad 320, alcance 260 |
| `nova` | Onda de choque | `nova` (anillo alrededor) | 14,17,20,24,28 | 2.6,2.4,2.2,2.0,1.8 | 1 | área 60,66,72,78,85; empuje 30,30,35,35,40 |
| `lance` | Lanza de plasma | `lance` (perfora, hacia donde apuntas) | 18,21,24,27,30 | 1.6,1.5,1.4,1.3,1.2 | 1,1,2,2,3 | perforación 4,5,6,7,8; velocidad 520; alcance 400 |
| `orbit` | Satélites | `orbit` | 8,10,11,13,16 | — | 2,2,3,3,4 | radio 46,48,52,56,60; velocidad 180,190,200,210,230 °/s; intervalo por enemigo 0.5 |
| `trail` | Estela iónica | `trail` (charcos al moverse) | 6,7,8,9,11 | 0.25 (cada charco) | 1 | radio 14,15,16,18,20; duración 2,2.2,2.4,2.7,3; intervalo 0.3 |
| `arc` | Arco voltaico | `ricochet` | 12,14,16,18,20 | 1.4,1.3,1.2,1.1,1.0 | 1 | rebotes 3,4,5,6,7; alcance de rebote 120; velocidad 420 |
| `drone` | Dron centinela | `drone` | 7,8,9,10,12 | 0.8,0.75,0.7,0.65,0.6 (disparo) | 1,1,2,2,3 | alcance 220; velocidad de bala 300 |

**Pasivas** (valor TOTAL de la categoría en cada nivel): `armor` Blindaje (vida máx.) .15,.3,.45,.6,.75 · `thrusters` Propulsores (velocidad) .08,.16,.24,.32,.40 · `capacitor` Condensador (enfriamiento) .06,.12,.18,.24,.30 · `amplifier` Amplificador (daño) .1,.2,.3,.4,.5 · `lens` Lente gravitatoria (área) .1,.2,.3,.4,.5 · `magnet` Imán de datos (recogida) .25,.5,.75,1,1.25 · `splitter` Divisor de haz (proyectiles) 1,2 (2 niveles) · `regen` Nanorreparación (vida/s) .3,.6,.9,1.2,1.5.

**Topes por categoría (§8.6)**, con rendimiento decreciente `diminish(vs, cap) = cap · (1 − Π(1 − v/cap))`: enfriamiento .6 · daño 4 · área 1.5 · velocidad .8 · blindaje .7 · crítico .6 · daño crítico 2 · recogida 3 · robo de vida .15 · experiencia 1 · suerte 1 · vida máx. 3. Topes duros (suma recortada): proyectiles +6, regeneración 5/s. Crítico base 5 %, ×1,5.

**Fauna de la Nebulosa Exterior:**

| id | Nombre | Familia | Vida | Vel. | Daño | Radio | XP | Comportamiento |
|---|---|---|---|---|---|---|---|---|
| `mite` | Ácaro de estática | enjambre | 8 | 62 | 6 | 6 | 1 | `chase` |
| `cell` | Célula partida | se divide | 36 | 46 | 10 | 11 | 3 | `chase`; al morir, 2 `cellet` |
| `cellet` | Celulita | enjambre | 10 | 70 | 5 | 6 | 1 | `chase` |
| `ray` | Manta de vacío | embestida avisada | 30 | 40 | 14 | 10 | 3 | `charge`: alcance 160, aviso 0.7 s, 260 u/s durante 0.45 s, cada 3 s |
| `spitter` | Coral artillero | tirador | 22 | 34 | 8 | 9 | 3 | `shooter`: mantiene 150, cada 2.2 s abanico de 3 balas a 20°, 120 u/s, 9 de daño |
| `shell` | Caparazón | blindado | 70 | 32 | 16 | 13 | 6 | `armored`: frente de 120° que reduce un 75 %, gira 90 °/s |

**Élites:** vida ×4, radio ×1,25, XP ×5, siempre sueltan monedas (3) y polvo (1), con un modificador: `shielded` Blindada (escudo = 60 % de la vida), `swift` Veloz (velocidad ×1,45), `volatile` Inestable (al morir explota tras 0,6 s de aviso: radio 50, daño 18).

**Jefe `hive` «La Colmena Rota» (Núcleo de la Estática):** vida 1800, radio 30, velocidad 28, daño 20, XP 60; por capa vida ×(1 + 0,7·(capa−1)) y daño ×(1 + 0,25·(capa−1)). Fases (desde qué fracción de vida, intervalo, aviso, velocidad, patrones en ciclo):
- 1 (100 %): 2,6 s · 0,6 s · ×1 · radial 16 balas (110 u/s, 10) → invoca 6 `mite` → apuntado 5 balas en 40° (150 u/s, 12).
- 2 (60 %): 2,0 s · 0,6 s · ×1,1 · radial 20 (120, 11) → embestida (aviso 0,9, 300 u/s, 0,6 s, 24) → apuntado 7 en 50° (160, 12) → invoca 6 `mite`.
- 3 (25 %): 1,6 s · 0,5 s · ×1,3 · espiral 2,5 s (una bala cada 0,08 s, giro 23°, 130, 10) → radial 24 (130, 12) → invoca 8 `mite` → embestida (0,7, 340, 0,6, 26).

**Sector `outer-nebula` «Nebulosa Exterior»:** capa de 300 s; baliza: 60 s abierta, 8 s dentro, radio 70, a 520 u. Aparición (segundo de la capa 1 desde el que sale, peso, grupo): `mite` 0/10/4–8 · `cell` 60/4/1–2 · `ray` 120/3/1–2 · `spitter` 180/3/1–3 · `shell` 240/2/1. Desde la capa 2 salen todos desde el principio. Oleadas fijas en cada capa: anillo de 24 `mite` a los 150 s; ráfaga de 12 `cell` desde un lado a los 270 s. Densidad: 0,6 grupos/s + 0,12 por minuto, máximo 3,5/s, como mucho 320 vivos (el jefe no cuenta); durante el jefe, la mitad. Escalado: vida +8 %/min y +50 %/capa, daño +4 %/min y +20 %/capa, velocidad +5 %/capa; élites 0 % + 0,6 %/min, máximo 8 %. Botín: moneda 4 %, polvo 2 %, élite 3 + 1, cofre del jefe 10 monedas + 3 de polvo. Arena: vista máxima 860×400, margen 48, reubicación a 1100 u.

**Elementos** (de la paleta de cada reliquia, §8.3): `burn` Quemadura (Solar Gold): 25 % del golpe por segundo, 3 s, hasta 3 cargas · `slow` Ralentización (Andromeda Blue): −35 %, 2 s · `corrosion` Corrosión (Terminal Green): +20 % de daño recibido, 4 s, ignora el frente blindado · `shock` Descarga (Ultraviolet): 25 % de salto a 2 enemigos a 90 u con el 50 % · `hack` Hackeo (Amber CRT): 8 % de que un enemigo normal luche a tu favor 5 s · `leech` Robo de vida (Crimson Nebula): cura el 4 % del daño · `breach` Daño a escudos (Emerald Void): ×2,5 contra escudos de élite, +50 % contra blindados y jefes · `chain` Rebotes (Neon Synapse): +1 rebote a 100 u con el 70 % · `pure` Daño puro (Monochrome): +15 % de crítico y +0,5 de daño crítico · `prism` Prisma (Prismatic): cada golpe aplica el siguiente de quemadura → ralentización → corrosión → descarga · `invert` Inversión (Antimatter): una bala enemiga que entra a 50 u se invierte con un 40 % y vuelve con ×2 de daño. Probabilidad en golpes de arma: 15 % por golpe, rotando entre las reliquias equipadas.

**Reliquias (§8.2–8.4 bis):** magnitud = rareza (1 / 1,15 / 1,35 / 1,6 / 2) × tamaño (compact .85, medium 1, large 1.15, colossal 1.3) × núcleo (faint .85, bright 1, quasar 1.15, double_nucleus 1) × (1 + nivel), con nivel = `diminish(0,04 × (nivel − 1) veces, 0,5)`; frecuencia por densidad (sparse .85, normal 1, dense 1.15, saturated 1.3). Familia por tipo:
- `spiral` → **cuchillas orbitales** (`orbit`, 9 de daño, radio 40, cantidad = brazos);
- `barred_spiral` → **rayo perforante** (`lance`, 16, cada 1,8 s, cantidad = brazos, perfora 6, 480 u/s);
- `elliptical` → **escudo** (24 de escudo, se recarga 5 s después del último golpe);
- `lenticular` → **lente crítica** (+0,1 de crítico y +0,3 de daño crítico);
- `irregular` → **caos** (cada 4 s, uno al azar: nova 18 en 70 · 6 rayos de 9 · campo lento en 90 durante 2 s · +30 % de velocidad 3 s);
- `ring` → **aura** (5 cada 0,5 s en 52);
- `dwarf` → **explorador** (+0,3 de recogida y +0,08 de velocidad);
- `merger` → **eco** (copia la familia de la siguiente reliquia equipada al 80 %; sola, caos).

La inclinación da la forma a rayo y aura: `face_on` círculo (rayos en abanico de 360°), `tilted` cono (rayos en 50°, aura en cono de 120° y radio ×1,4), `edge_on` línea (rayos alineados, perforación ilimitada). Cuásar: un rayo extra cada 3 s (25, perfora 10). Doble núcleo: la familia dispara dos veces (la segunda 6 ticks después).

Fenómeno: `supernova` nova de 40 en 120 cada 8 s · `satellite_galaxy` dron de 8 cada 0,8 s · `globular_cluster` 4 orbes de 6 en radio 64 a 140 °/s · `comet` embestida cada 6 s si te mueves (90 u en 0,2 s, invulnerable, 30 a lo que toca) · `relativistic_jets` dos lanzas opuestas cada 2,5 s (20, perfora 8) · `pulsar` onda de 8 en 70 cada 1,2 s · `einstein_ring` +1 proyectil a todo · `anomaly` cada 5 s, al azar: salto de 70 u lejos del enemigo más cercano, congela 1,5 s lo que haya en 110 u, o golpe de 60 a 3 enemigos visibles.

Fondo: `deep_void` blindaje +0,08 · `starfield` visión +0,08 (solo la cámara) · `nebular_dust` recogida +0,25 · `cosmic_web` experiencia +0,1 · `cmb` suerte +0,15.

**Experiencia:** para pasar del nivel `l` al siguiente hacen falta `5 + 6l + ⌊l²/2⌋` (11, 19, 27…). Máximo 6 armas y 6 pasivas. Ofertas: 3 distintas entre armas nuevas (peso 1), subir arma (1,2), pasivas nuevas (1) y subir pasiva (1,2); sin opciones, «Reparación» (30 % de vida).

**Economía (`runs`):** profundidad ×1 / ×1,5 / ×2,2 / ×3 y +0,8 por capa siguiente; morir o abandonar 50 %; rendimiento diario 0–3 h ×1, 3–4 h ×0,75, 4–5 h ×0,5, más ×0,25; señal por jefe vencido 10 %; topes de plausibilidad: 600 bajas/min, 0,25 monedas y 0,12 de polvo por baja más 30 monedas y 10 de polvo por jefe, holgura de 20 s; caducidad 24 h; 30 inicios por hora.

## Review Focus

1. **Pestaña oculta o ventana sin foco a mitad de partida:** la partida se pausa y al volver no recupera de golpe miles de ticks (ni muere la sonda en un instante) → Tarea 14 (`loop.test.ts`).
2. **El final que no llega:** red caída, servidor reiniciado o recarga de la página al terminar: el resultado se reenvía con la misma clave y se paga una sola vez; nunca se pierde ni se cobra doble → Tareas 12 y 15.
3. **Finales manipulados o rotos:** entradas enormes o mal codificadas, botín por encima de los topes, más profundidad que tiempo, partida ajena, terminada o caducada: respuestas 400/404/409/410 o marca de sospecha con el botín recortado, nunca 500 → Tareas 11 y 12.
4. **Reliquias que cambian entre el Hangar y la partida:** una galaxia equipada desintegrada, fusionada o ajena no entra en la foto de la partida, y no se puede desintegrar ni fusionar mientras está equipada → Tarea 12.
5. **Determinismo en partidas largas y con N sondas:** la repetición de una grabación da el mismo hash, incluidas las pausas de mejora (elección en el tick congelado), los grupos llenos (tope de enemigos, balas y recogidas) y 2 sondas → Tareas 3 y 9.

---

## File structure

```
games/galaxy/
  packages/sim/                                   @galaxy/sim (nuevo)
    package.json, tsconfig.json
    src/index.ts                                  API pública
    src/version.ts                                SIM_VERSION, TICK_HZ               (T1)
    src/math/{rng.ts,trig.ts,stack.ts}            Rng, sinA/cosA/angleTo, diminish   (T1)
    src/content/{types.ts,schema.ts,default.ts}   Content, contentSchema, DEFAULT_CONTENT (T2)
    src/world/{pool.ts,grid.ts,pools.ts}          piscinas SoA y rejilla             (T3)
    src/sim.ts, src/types.ts, src/events.ts       createSim, step, eventos           (T3)
    src/systems/probes.ts                         movimiento, daño a sondas, muerte  (T3)
    src/systems/pickups.ts, xp.ts                 recogidas, experiencia             (T3)
    src/systems/combat.ts                         canal de daño (crítico, escudos, elementos) (T3, T6)
    src/systems/{enemies.ts,director.ts}          comportamientos, aparición, élites (T4)
    src/systems/{stats.ts,upgrades.ts}           estadísticas con topes, ofertas    (T3)
    src/systems/weapons.ts                        armas de la sonda                  (T5)
    src/systems/elements.ts                       estados y efectos de los elementos (T6)
    src/systems/relics.ts                         rasgos → habilidades de reliquia   (T7)
    src/systems/{layers.ts,boss.ts}               capas, jefe, baliza, final         (T8)
    src/summary.ts, src/snapshot.ts               RunSummary, stateHash, HudSnapshot (T3, T8)
    src/recording.ts, src/bot.ts                  grabación, repetición, bot         (T9)
    test/*.test.ts, test/fixtures.ts
  packages/shared/src/
    config/registry.ts                            content, runs, features.runs       (T2)
    runs/{rewards.ts,plausibility.ts}             pago y plausibilidad               (T11)
    api/runs.ts                                   HangarView, RunStart, RunResult…   (T11)
  apps/server/src/
    runs/{hangar.ts,service.ts,routes.ts}         Hangar, inicio y fin               (T12)
    collection/service.ts                         409 galaxy_equipped, `equipped`    (T12)
    db/schema.ts                                  tablas nuevas                      (T10)
  apps/web/src/
    api/runs.ts, api/pending-run.ts               consultas y partida pendiente      (T15)
    hangar/{HangarScreen,SectorPanel,ProbePanel,RelicSlots,RelicPicker,DailyYield,ResultsScreen}.tsx (T15)
    arena/ArenaScreen.tsx, loop.ts, input.ts, settings.ts, arena-sfx.ts           (T14)
    arena/stage/{stage.ts,atlas.ts,camera.ts,terrain.ts,fx.ts}                     (T13)
    arena/sprites/{types.ts,palette.ts,raster.ts,probe.ts,fauna.ts,boss.ts,items.ts,icons.ts} (T13)
    arena/hud/{Hud,LevelUp,PauseMenu,BossBar,BeaconMarker,Radio}.tsx               (T14)
supabase/migrations/<fecha>_galaxy_runs.sql       (T10)
supabase/tests/973_galaxy_runs.test.sql           (T10)
```

---

### Task 1: Paquete de simulación y matemáticas deterministas

**Files:** create `packages/sim/{package.json,tsconfig.json,src/index.ts,src/version.ts,src/math/rng.ts,src/math/trig.ts,src/math/stack.ts}`, `packages/sim/test/math.test.ts`; modify `games/galaxy/eslint.config.mjs` (regla `no-restricted-properties` para `Math.random/sin/cos/tan/atan/atan2/pow/exp/log/hypot/cbrt` y `no-restricted-globals` para `Date`/`performance` en `packages/sim/src/**`), `games/galaxy/Dockerfile` (`COPY packages/sim/package.json packages/sim/`), `apps/server/package.json` (devDependency `@galaxy/sim`), `packages/shared/package.json` y `apps/web/package.json` (dependency `@galaxy/sim`).

**Interfaces — Produces:**
- `SIM_VERSION = '1.0.0'`, `TICK_HZ = 60`, `ticks(seconds: number): number` (= `Math.round(seconds * 60)`).
- `class Rng` (sfc32 de 4 palabras de 32 bits): `static fromSeed(seed: string, stream: string): Rng` (semilla decimal de 64 bits + nombre del flujo, mezclados con splitmix32; descarta 12 salidas), `next(): number` (uint32), `float(): number` [0,1), `int(n: number): number` [0,n), `range(a: number, b: number): number`, `chance(p: number): boolean`, `pick<T>(xs: readonly T[]): T`, `state(): readonly number[]`.
- `ANGLE_STEPS = 4096`; `sinA(a: number): number`, `cosA(a: number): number` (índice entero, módulo); `angleTo(dx: number, dy: number): number` (entero en [0, 4096), polinomio de atan con solo operaciones básicas); `degToSteps(deg: number): number`.
- `diminish(values: readonly number[], cap: number): number`.

- [ ] **Step 1: Tests que fallan** (`math.test.ts`): «el Rng con la misma semilla y flujo repite la secuencia y otro flujo no»; «float está en [0,1) e int en [0,n) (fast-check)»; «la tabla de senos coincide con Math.sin a 1e-9 en las 4096 posiciones» (la prueba sí puede usar `Math.sin`); «angleTo se equivoca como mucho en 1 paso frente a Math.atan2 (fast-check)»; «diminish crece, nunca pasa del tope y rinde menos cada vez (fast-check)»; «los valores fijados del Rng no cambian» (5 salidas de `Rng.fromSeed('12345','spawn')` escritas en la prueba al implementarlo, para detectar cambios de algoritmo).
- [ ] **Step 2: Ver fallar** — `pnpm -C games/galaxy exec vitest run --project unit packages/sim/test/math.test.ts` → FAIL (módulo inexistente).
- [ ] **Step 3: Implementar**, `pnpm -C games/galaxy install`, y comprobar que `pnpm -C games/galaxy lint` rechaza un `Math.sin` puesto a propósito en `packages/sim/src` (y quitarlo).
- [ ] **Step 4: Ver pasar** la prueba, `typecheck` y `lint`.
- [ ] **Step 5: Commit** `feat(galaxy): paquete de simulación con matemáticas deterministas`.

### Task 2: Contenido como datos y configuración viva

**Files:** create `packages/sim/src/content/{types.ts,schema.ts,default.ts,index.ts}`, `packages/sim/test/content.test.ts`; modify `packages/shared/src/config/registry.ts`, `packages/shared/test/registry.test.ts`.

**Interfaces — Produces** (tipos exactos en `content/types.ts`):
- `ElementId = 'burn'|'slow'|'corrosion'|'shock'|'hack'|'leech'|'breach'|'chain'|'pure'|'prism'|'invert'`; `WeaponKind = 'bolt'|'nova'|'lance'|'orbit'|'trail'|'ricochet'|'drone'`; `StatKey = 'maxHp'|'speed'|'cooldown'|'damage'|'area'|'pickup'|'projectiles'|'regen'|'armor'|'crit'|'critDamage'|'xp'|'luck'|'lifesteal'`.
- `WeaponLevel { damage; cooldown; count; pierce; speed; area; duration; range; bounces; knockback; interval }` (números, 0 si no aplica); `WeaponDef { id; name; kind: WeaponKind; icon: string; description: string; levels: WeaponLevel[] }` (máx. nivel = `levels.length`, 1–8).
- `PassiveDef { id; name; icon; description; stat: StatKey; levels: number[] }` (valor total por nivel).
- `ProbeDef { id; name; sprite; description; hp; speed; pickup; armor; regen; weapon: string; bonus: Partial<Record<StatKey, number>> }`.
- `Behavior = { kind:'chase' } | { kind:'charge'; range; windup; dashSpeed; dashTime; cooldown } | { kind:'shooter'; range; cooldown; count; spread; bulletSpeed; bulletDamage } | { kind:'armored'; arc; reduction; turnRate } | { kind:'summoner'; cooldown; minion: string; count }`.
- `EnemyDef { id; name; family: 'swarm'|'charger'|'shooter'|'splitter'|'armored'|'healer'|'summoner'; sprite; hp; speed; damage; radius; xp; behavior: Behavior; split?: { into: string; count: number } }`; `EliteDef { id: 'shielded'|'swift'|'volatile'; name; shield: number; speed: number; explode: { radius; damage; delay } | null }`.
- `BossPattern = { kind:'radial'; count; speed; damage } | { kind:'aimed'; count; spread; speed; damage } | { kind:'spiral'; duration; every; step; speed; damage } | { kind:'summon'; enemy: string; count } | { kind:'charge'; windup; dashSpeed; dashTime; damage }`; `BossPhase { below; interval; telegraph; speed; patterns: BossPattern[] }`; `BossDef { id; name; title; sprite; hp; radius; speed; damage; xp; phases: BossPhase[]; scaling: { hpPerLayer; damagePerLayer } }`.
- `SectorDef { id; name; description; biome: 'nebula'; boss: string; layerSeconds; beacon: { seconds; hold; radius; distance }; spawns: { enemy; from; weight; group: [number, number] }[]; waves: { at; kind: 'ring'|'burst'; enemy; count }[]; density: { base; perMinute; max; cap; bossFactor }; scaling: { hpPerMinute; damagePerMinute; hpPerLayer; damagePerLayer; speedPerLayer; eliteBase; elitePerMinute; eliteMax }; elite: { hp; radius; xp; coins; dust }; drops: { coin; dust; bossCoins; bossDust } }`.
- `ElementTuning` (un objeto con una entrada por `ElementId` y sus números de la tabla) y `RelicTuning { tier: number[]; level: { step; cap }; size: Record<string, number>; core: Record<string, number>; density: Record<string, number>; weaponProc: number; families: Record<FamilyId, …>; phenomena: Record<PhenomenonId, …>; backgrounds: Record<string, { stat: StatKey | 'vision'; value: number }> }` con `FamilyId = 'blades'|'ray'|'shield'|'lens'|'chaos'|'aura'|'scout'|'echo'`.
- `Content { probes; weapons; passives; enemies; elites; bosses; sectors; elements: ElementTuning; relics: RelicTuning; xp: { base; linear; quad }; caps: Record<StatKey, number>; crit: { chance; damage }; arena: { viewW; viewH; margin; despawn }; limits: { weapons; passives; enemies; shots; foeShots; pickups; areas } }`.
- `contentSchema: z.ZodType<Content>` (estricto) con referencias comprobadas: arma inicial de cada sonda, `split.into`, `summoner.minion`, `summon.enemy`, jefe y enemigos de cada sector existen; ids únicos por catálogo; fases del jefe con `below` estrictamente decreciente empezando en 1; `levels` de 1 a 8. Mensajes `content_ref:<ruta>`, `content_dup:<catálogo>`.
- `DEFAULT_CONTENT: Content` con los **Valores de partida**; límites `{ weapons: 6, passives: 6, enemies: 400, shots: 1200, foeShots: 600, pickups: 1500, areas: 300 }`; `crit: { chance: 0.05, damage: 1.5 }`.
- En `registry.ts`: `features.runs` (true), `content` (= `contentSchema` con `DEFAULT_CONTENT` por defecto en cada catálogo) y `runs` (`depth { table: number[4..10]; step }`, `deathShare`, `daily { hours: [3,4,5]; multipliers: [1,.75,.5,.25] }` con horas crecientes y multiplicadores decrecientes, `signalChancePerBoss`, `caps { killsPerMinute; coinsPerKill; dustPerKill; bossCoins; bossDust; slackSeconds }`, `expireHours`, `startPerHour`).

- [ ] **Step 1: Tests que fallan:** `DEFAULT_CONTENT` pasa el esquema; una sonda con un arma que no existe, una especie que se divide en otra inexistente, un sector con un jefe inexistente, ids repetidos y fases del jefe desordenadas fallan con su mensaje; `parseConfig('content', {})` devuelve `DEFAULT_CONTENT`; `parseConfig('runs', {})` da los valores de partida; horas del rendimiento no crecientes → error; los ids de sprite del contenido son `^[a-z0-9-]+$`.
- [ ] **Step 2: Ver fallar** (`content.test.ts`, `registry.test.ts`).
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Ver pasar** con `typecheck`.
- [ ] **Step 5: Commit** `feat(galaxy): contenido de las incursiones como datos en la configuración viva`.

### Task 3: Núcleo de la simulación (mundo, sondas, recogidas, determinismo)

**Files:** create `packages/sim/src/{types.ts,events.ts,sim.ts,summary.ts}`, `src/world/{pool.ts,grid.ts,pools.ts}`, `src/systems/{probes.ts,pickups.ts,xp.ts,combat.ts,stats.ts,upgrades.ts}`, `packages/sim/test/{fixtures.ts,core.test.ts,stats.test.ts,upgrades.test.ts}`.

**Interfaces — Produces:**
- `ProbeInput { mx: number; my: number; aim: number; pick: number }` (`mx,my` enteros en [−127,127]; `aim` −1 = automático o [0,4096); `pick` −1 o índice de la oferta); `IDLE: ProbeInput`.
- `RelicInput { id: string; seed: string; tier: number; level: number; traits: Record<string, string> }`.
- `SimOptions { seed: string; content: Content; sector: string; probes: { probe: string; relics: RelicInput[] }[]; record?: boolean }`.
- `createSim(opts: SimOptions): Sim`; `step(sim: Sim, inputs: readonly ProbeInput[]): void` (una entrada por sonda; si `status === 'choosing'` solo se aplican las elecciones y el mundo no avanza; con `extracted`/`dead` no hace nada).
- `Sim` (campos que leen el render y el HUD): `tick`, `status: 'running'|'choosing'|'extracted'|'dead'`, `layer` (desde 1), `phase: 'waves'|'boss'|'beacon'`, `phaseTick`, `probes: ProbeState[]` (`x, y, px, py, hp, maxHp, alive, invulnT, facing, level, xp, xpNext, weapons: { id; level; t }[], passives: { id; level }[], offer: Offer[] | null, pendingLevels, stats: Stats, shield, kills`), piscinas `enemies`, `shots`, `foeShots`, `pickups`, `areas` (SoA con `alive: Uint8Array`, `gen: Uint16Array`, `x, y, px, py` y los campos de cada una, documentados en `world/pools.ts`), `boss`, `beacon`, `loot: { coins: number; dust: number }[]` (por capa), `kills`, `bossKills`, `events: SimEvent[]` (se vacían al empezar cada `step`), `log`.
- `Pool`: `spawn(): number` (−1 si está lleno; el índice libre más bajo), `kill(i)`, `count`, `cap`; los índices se reutilizan y `gen` sube en cada reutilización.
- `SpatialGrid(cell = 48)`: `clear()`, `insert(i, x, y)`, `query(x, y, r, out: number[]): number` (orden determinista: celdas en orden fijo, índices en orden de inserción).
- `SimEvent` (unión con `t`): `hit {x,y,amount,crit,element}`, `kill {x,y,enemy,elite}`, `hurt {probe,amount}`, `pickup {probe,kind,value}`, `levelUp {probe,level}`, `fire {weapon,x,y}`, `telegraph {kind,x,y,angle,ticks}`, `bossSpawn {boss,layer}`, `bossPhase {phase}`, `bossDown {x,y}`, `beaconOpen {x,y}`, `beaconClosed`, `layer {layer}`, `extracted`, `probeDown {probe}`, `element {x,y,element}`.
- `HitSource { probe: number; weapon: string | null; relic: number | null; element: ElementId | null }`; `dealDamage(sim, enemy: number, amount: number, src: HitSource): number` en `combat.ts` (crítico con `rng.combat`, escudo, frente blindado, ganchos de elemento vacíos que rellena la Tarea 6; devuelve el daño hecho; muerte → XP, botín, evento `kill`, hijos si se divide).
- `deriveStats(sim, probe): Stats` en `stats.ts` (`{ maxHp, speed, cooldown, damage, area, pickup, projectiles, regen, armor, crit, critDamage, xp, luck, lifesteal }` como multiplicadores o valores finales, con `diminish` y los topes de `content.caps`; fuentes: sonda, pasivas y `relicBonuses(sim, probe)`, que devuelve `[]` hasta la Tarea 7); se recalcula al aplicar una mejora.
- `Offer = { kind: 'weapon'|'passive'|'heal'; id: string; level: number }` (nivel que tendrá); `offerFor(sim, probe): Offer[]` (con `sim.rng.offer`) y `applyOffer(sim, probe, offer)` en `upgrades.ts`.
- `stateHash(sim): string` (16 hex, FNV-1a de dos carriles sobre los bytes de un estado canónico: tick, estado, capa, fase, estados de los Rng, sondas, enemigos vivos, balas, recogidas, botín).
- `runSummary(sim): RunSummary` = `{ ticks, outcome: 'running'|'extracted'|'dead', depth, kills, bossKills, level, loot, hash }`.
- `test/fixtures.ts`: `tinyContent(over?)` (contenido pequeño con números redondos: 1 arma `bolt`, 1 enemigo `chase`, capa de 20 s, jefe débil) y `run(sim, n, input?)`.

- [ ] **Step 1: Tests que fallan** (`core.test.ts`): «la sonda se mueve a su velocidad y en diagonal no va más rápido»; «misma semilla y mismas entradas → mismo hash tras 3 000 ticks; otra semilla → otro hash»; «con 2 sondas cada una sigue su entrada y la partida acaba cuando caen las dos»; «tocar a un enemigo quita vida y da 0,5 s de invulnerabilidad»; «la experiencia que cae atraída por la recogida sube de nivel y abre una oferta de 3; mientras se elige el mundo no avanza; elegir con `pick` la cierra; varios niveles seguidos se eligen uno tras otro»; «un `pick` fuera de rango se ignora»; «las ofertas no repiten, no ofrecen armas nuevas con 6 armas ni niveles por encima del máximo, y sin opciones dan «Reparación»; la misma semilla da las mismas ofertas» (`upgrades.test.ts`); «las pasivas suben su categoría, el enfriamiento nunca pasa del 60 %, los proyectiles se recortan en +6 y el crítico base es 5 % ×1,5» (`stats.test.ts`); «una piscina llena no rompe nada: `spawn` devuelve −1 y la experiencia sobrante se suma a la recogida más antigua»; «la rejilla devuelve los vecinos en el mismo orden siempre».
- [ ] **Step 2: Ver fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Ver pasar.**
- [ ] **Step 5: Commit** `feat(galaxy): núcleo determinista de la simulación de incursiones`.

### Task 4: Fauna y director de aparición

**Files:** create `packages/sim/src/systems/{enemies.ts,director.ts}`, `packages/sim/test/{enemies,director}.test.ts`.

**Interfaces — Consumes:** `Sim`, piscinas, `dealDamage`, `Rng` (`sim.rng.spawn`, `sim.rng.ai`). **Produces:** `spawnEnemy(sim, def: EnemyDef, x, y, opts?: { elite?: EliteDef; scale?: Scale }): number`; `updateEnemies(sim)`; `direct(sim)` (llamado en `step`); `scaleAt(sim): Scale` (`{ hp, damage, speed, elite }` según minuto total y capa); `spawnPoint(sim, rng): { x; y }` (en el perímetro del rectángulo `arena.viewW × viewH + margin` alrededor del centro de las sondas vivas).

- [ ] **Step 1: Tests que fallan:** `chase` se acerca y se separa de sus vecinos (dos enemigos no acaban en el mismo punto); `charge` avisa (`telegraph`) antes de embestir en línea recta y luego espera su enfriamiento; `shooter` se queda a su distancia y dispara el abanico con su separación; `armored` recibe un 75 % menos por delante y el daño completo por la espalda; `splitter` deja 2 crías al morir; las élites `shielded`, `swift` y `volatile` (la explosión avisa y daña a la sonda en su radio); el director no saca una especie antes de su segundo en la capa 1 y sí desde la capa 2; respeta el tope de vivos; aparece fuera de la vista máxima; un enemigo a más de 1 100 u se reubica; el anillo de los 150 s y la ráfaga de los 270 s salen a su hora; la vida escala con el minuto y la capa.
- [ ] **Step 2: Ver fallar.** **Step 3: Implementar.** **Step 4: Ver pasar** (con las pruebas de la Tarea 3).
- [ ] **Step 5: Commit** `feat(galaxy): fauna de la Estática y director de aparición`.

### Task 5: Armas de la sonda

**Files:** create `packages/sim/src/systems/weapons.ts`, `packages/sim/test/weapons.test.ts`.

**Interfaces — Consumes:** `deriveStats`, `dealDamage`, `Offer` (T3). **Produces:** `fireWeapons(sim, probe)` y `updateShots(sim)` (balas propias, áreas, órbitas y drones); las armas usan `stats.damage`, `stats.cooldown`, `stats.area` y `stats.projectiles`.

- [ ] **Step 1: Tests que fallan:** cada tipo de arma con su forma (`bolt` al más cercano dentro del alcance y nada si no hay nadie; `nova` daña y empuja en su radio; `lance` perfora N enemigos y no golpea dos veces al mismo; `orbit` gira y respeta el intervalo por enemigo; `trail` deja charcos solo al moverse; `ricochet` rebota hasta N veces sin repetir objetivo; `drone` sigue a la sonda y dispara); los niveles cambian los números de su fila; el `Condensador` acorta el enfriamiento real de las armas; el `Divisor de haz` añade proyectiles a `bolt`, `lance` y `drone`; el `Amplificador` y la `Lente` cambian daño y radio.
- [ ] **Step 2–4:** ver fallar, implementar, ver pasar.
- [ ] **Step 5: Commit** `feat(galaxy): armas de la sonda`.

### Task 6: Elementos

**Files:** create `packages/sim/src/systems/elements.ts`; modify `src/systems/combat.ts`; test `packages/sim/test/elements.test.ts`.

**Interfaces — Produces:** `applyElement(sim, enemy: number, element: ElementId, hit: number, src: HitSource)`; `tickStatuses(sim)` (quemadura, ralentización, corrosión, hackeo y congelación por enemigo); `invertNearby(sim, probe)` (consume `HitSource` de la Tarea 3).

- [ ] **Step 1: Tests que fallan (uno por elemento):** quemadura hace su daño por segundo y acumula hasta 3; ralentización frena un 35 % y caduca; corrosión sube el daño recibido y atraviesa el frente blindado; descarga salta a 2 vecinos con la mitad; un enemigo hackeado persigue y daña a los demás y no a la sonda, y los jefes y élites no se hackean; robo de vida cura dentro de su tope; daño a escudos multiplica contra escudos de élite; rebotes añade un salto; puro sube crítico; prisma rota en orden; inversión devuelve balas enemigas con ×2 y probabilidad fija por bala (cada bala se tira una vez); los golpes de arma aplican el elemento de las reliquias con un 15 % rotando entre ellas.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(galaxy): elementos de las reliquias`.

### Task 7: Reliquias en partida

**Files:** create `packages/sim/src/systems/relics.ts`; test `packages/sim/test/relics.test.ts`.

**Interfaces — Produces:** `relicSkill(relic: RelicInput, all: RelicInput[], content: Content): RelicSkill` (`{ family: FamilyId; element: ElementId | null; phenomenon: string | null; magnitude: number; frequency: number; count: number; shape: 'circle'|'cone'|'line'; quasar: boolean; double: boolean; background: { stat; value } | null }`); `describeRelic(relic, all, content)` (lo mismo, para el Hangar); `updateRelics(sim, probe)` (enfriamientos y ataques de familia y fenómeno); rellena `relicBonuses` (lente, explorador, fondos, anillo de Einstein) para `deriveStats`.

- [ ] **Step 1: Tests que fallan:** la tabla de familias por tipo de galaxia; los brazos dan la cantidad; tamaño, núcleo, densidad y rareza multiplican como en la tabla (Legendaria ×2 frente a Común en igualdad de rasgos); el nivel suma con rendimiento decreciente; la inclinación cambia la forma del rayo y del aura; cuásar añade su rayo y doble núcleo dispara dos veces; cada fenómeno hace lo suyo (una prueba por fenómeno, con su enfriamiento); el anillo de Einstein suma un proyectil a las armas; el escudo absorbe y se recarga a los 5 s; `merger` copia a la siguiente y sola es caos; el fondo da su bonus; rasgos desconocidos dan una reliquia neutra en vez de romper.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(galaxy): las galaxias equipadas como reliquias en la incursión`.

### Task 8: Capas, jefe, extracción y resumen

**Files:** create `packages/sim/src/systems/{layers.ts,boss.ts}`, `src/snapshot.ts`; modify `src/summary.ts`; tests `packages/sim/test/{layers,boss,snapshot}.test.ts`.

**Interfaces — Produces:** `updateLayer(sim)`; `BossState { index; def; phase; hp; maxHp; t; pattern }` (el jefe vive en la piscina de enemigos con `boss = 1`); `BeaconState { x; y; t; hold; holdNeeded; radius }`; `hudSnapshot(sim, probe): HudSnapshot` (`{ hp, maxHp, shield, level, xp, xpNext, tick, layer, phase, phaseLeft, kills, loot: { coins, dust }, weapons, passives, boss: { name, title, hp, maxHp, phase } | null, beacon: { x, y, dx, dy, hold, holdNeeded, left } | null, offer, status }`).

- [ ] **Step 1: Tests que fallan:** al cumplirse la capa aparece el jefe (evento) y la densidad baja a la mitad; las fases cambian al cruzar 60 % y 25 % y cada patrón avisa antes de disparar; al vencerlo cae el cofre y se abre la baliza a su distancia; quedarse dentro suma (fuera se detiene, no se reinicia) y al llegar a 8 s la partida acaba `extracted`; con 2 sondas cuentan todas las vivas dentro; si la baliza caduca empieza la capa siguiente con más vida y daño; el botín se apunta en la capa en que se recoge; `runSummary` y `hudSnapshot` reflejan todo esto.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(galaxy): capas, Núcleo de la Estática y extracción`.

### Task 9: Grabación, repetición, bot y calibración

**Files:** create `packages/sim/src/{recording.ts,bot.ts}`; tests `packages/sim/test/{recording,calibration}.test.ts`.

**Interfaces — Produces:** con `record: true`, `sim.log` guarda la entrada efectiva al avanzar (solo cuando cambia) y cada elección en su tick; `encodeLog(log): Uint8Array` (versión 1; enteros variables: delta de tick, sonda, tipo, carga) y `decodeLog(bytes): InputLog` (lanza `RangeError('bad_log')` si está mal); `replay(opts: SimOptions, log: InputLog, maxTicks?: number): Sim`; `toBase64(bytes)` / `fromBase64(s)` (sin `Buffer`, válidas en navegador y Node); `botInput(sim, probe): ProbeInput` (huye del centro de masas cercano, va a por experiencia si es seguro y a la baliza si está abierta) y `botPick(offer): number`.

- [ ] **Step 1: Tests que fallan:** codificar y decodificar es la identidad (fast-check); bytes basura → `bad_log`; una partida de bot de 6 000 ticks grabada y repetida da el mismo hash, también con 2 sondas y con elecciones de mejora; una grabación de una partida de 3 minutos ocupa menos de 20 KB; calibración corta (siempre, en el CI): con la sonda inicial y sin reliquias, el bot sobrevive 3 minutos de la capa 1 en 3 semillas, y 24 combinaciones de reliquias al azar más las extremas (6 Legendarias del mismo tipo y paleta; rasgos de `drawTraits` del motor en la prueba) no superan 8× el daño por segundo mediano en un campo de pruebas de 10 s ni rompen los topes; calibración larga (`GALAXY_CALIBRATE=1`): el bot llega a la capa 2–4 en 5–20 minutos de media en 5 semillas, y lo mismo con 200 combinaciones en 20 s.
- [ ] **Step 2–4.** Si la calibración larga falla, ajustar `DEFAULT_CONTENT` y apuntar cada cambio en el registro como *ruling*.
- [ ] **Step 5: Commit** `feat(galaxy): grabación y repetición de partidas, bot y calibración`.

### Task 10: Base de datos de las incursiones

**Files:** create `supabase/migrations/<fecha real>_galaxy_runs.sql`, `supabase/tests/973_galaxy_runs.test.sql`; modify `apps/server/src/db/schema.ts`.

**Tablas (esquema `galaxy`, RLS con política `galaxy_api_all`, permisos solo para `galaxy_api`, revocados para el resto):**
- `hangars (account_id pk → accounts on delete cascade, probe text default 'lumen' check '^[a-z0-9-]{1,32}$', relic_slots smallint default 2 check 2–6, updated_at)`.
- `loadouts (account_id, slot smallint check 0–5, galaxy_id uuid → galaxies, pk (account_id, slot), unique (galaxy_id))`.
- `runs (id uuid pk, account_id, seed numeric(20,0) con el rango de 64 bits, sector, probe, relics jsonb, content_version int, sim_version text, start_key text, started_at default now(), finished_at, outcome check in ('extracted','died','abandoned'), ticks int ≥ 0, depth smallint ≥ 1, kills int ≥ 0, boss_kills int ≥ 0, level smallint ≥ 1, seconds int ≥ 0, hash text, payout jsonb, runs_version int, flags text[] default '{}', suspicious boolean default false)`, índice `(account_id, started_at desc)`; disparador: una partida terminada no se modifica y ninguna se borra.
- `run_inputs (run_id pk → runs on delete cascade, inputs bytea check octet_length ≤ 2 000 000, created_at)`, de solo añadir.
- `run_days (account_id, day date, seconds int ≥ 0, pk (account_id, day))`.

- [ ] **Step 1: pgTAP que falla** (`973`): existen tablas, columnas, claves y restricciones; `galaxy_api` tiene solo los permisos necesarios y `anon`/`authenticated` ninguno; una misma galaxia no puede estar en dos ranuras; actualizar una partida terminada falla con `run_finished`; borrar `run_inputs` falla con `append_only`; ranuras fuera de 2–6 fallan.
- [ ] **Step 2:** ver fallar con `pnpm exec supabase test db` (desde la raíz). **Step 3:** escribir la migración y aplicarla con `pnpm exec supabase migration up`; tipos en `db/schema.ts`. **Step 4:** ver pasar todo `supabase test db`.
- [ ] **Step 5: Commit** `feat(galaxy): tablas del hangar y de las incursiones`.

### Task 11: Reglas de pago y contratos de la API

**Files:** create `packages/shared/src/runs/{rewards.ts,plausibility.ts}`, `packages/shared/src/api/runs.ts`; modify `src/index.ts`, `src/errors.ts`, `src/api/economy.ts` (`GalaxySummary.equipped: boolean`); tests `packages/shared/test/{runs-rewards,runs-plausibility,api-runs}.test.ts`.

**Interfaces — Produces:**
- `RunsConfig = ConfigValue<'runs'>`; `RunClaim = Omit<FinishRunRequest, 'inputs'>`.
- `depthMultiplier(layer: number, cfg: RunsConfig): number`.
- `dailySegments(playedBefore: number, seconds: number, cfg): { seconds: number; multiplier: number }[]` (prorrateo por tramos) y `dailyFactor(segments): number` (media ponderada).
- `runPayout(claim: RunClaim, cfg, factor: number): { coins: number; dust: number; layers: { layer; coins; dust; multiplier }[]; share: number }` (por capa: botín × profundidad; × reparto si no hay extracción; × factor diario; `Math.floor` al final).
- `checkRun(claim: RunClaim, ctx: { wallSeconds: number; layerSeconds: number; cfg: RunsConfig; logTicks: number | null }): { flags: string[]; claim: RunClaim }` con banderas `too_fast`, `depth_vs_time`, `kills_rate`, `boss_kills`, `loot_cap` (recorta el botín a su tope), `log_mismatch`.
- Esquemas y tipos: `loadoutRequestSchema { relics: (uuid | null)[] ≤ 6 }`, `startRunRequestSchema { sector; probe; simVersion }`, `finishRunRequestSchema { outcome: 'extracted'|'died'|'abandoned'; ticks ≤ 1 296 000; depth 1–999; kills; bossKills; level 1–999; loot: { coins; dust }[] (longitud = depth); hash /^[0-9a-f]{16}$/; inputs: base64 ≤ 2 800 000 caracteres }`; `HangarView { sectors: SectorCard[]; probes: ProbeCard[]; probe: string; slots: number; maxSlots: 6; loadout: (GalaxySummary | null)[]; daily: { playedSeconds; fullSecondsLeft; multiplier; resetsAt }; runsEnabled: boolean }`; `RunStart { id; seed; sector; probe; relics: RelicInput[]; content: Content; contentVersion; startedAt }`; `RunResult { id; outcome; ticks; depth; kills; level; payout: { coins; dust; signals }; breakdown: { layers; share; daily: { seconds; multiplier }[] }; wallet: Wallet }`.
- Errores nuevos: `galaxy_equipped`, `invalid_loadout`, `run_not_found`, `run_finished`, `run_expired`, `runs_disabled`, `bad_inputs`.

- [ ] **Step 1: Tests que fallan:** multiplicadores de profundidad ×1/1,5/2,2/3 y luego +0,8; morir paga el 50 %; una partida que cruza las 3 h cobra lo de antes a ×1 y lo de después a ×0,75 (y así con cada tramo; fast-check: la suma de segmentos = duración y el factor está entre 0,25 y 1); nunca se paga más con más tramos; plausibilidad: cada bandera con su caso y una partida normal sin banderas; el botín recortado nunca supera el tope; los esquemas rechazan `loot` de otra longitud, `hash` mal formado y `inputs` que no son base64.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(galaxy): reglas de pago de las incursiones y contratos de la API`.

### Task 12: Servidor del Hangar y de las partidas

**Files:** create `apps/server/src/runs/{hangar.ts,service.ts,routes.ts}`; modify `src/app.ts`, `src/collection/{service.ts,routes.ts}` (`equipped` en el resumen con `exists`; 409 `galaxy_equipped` al desintegrar o fusionar); tests `apps/server/test/integration/{hangar,runs}.test.ts`, `collection.test.ts`.

**Interfaces — Produces:**
- `GET /galaxy/api/hangar` → `HangarView` (crea la fila del hangar la primera vez; `daily` del día de Madrid con `runs`).
- `PUT /galaxy/api/hangar/loadout` `{ relics }` → `HangarView` (propias, no desintegradas, sin repetir, como mucho `slots`; si no → `409 invalid_loadout`; reemplaza todas las ranuras en una transacción).
- `POST /galaxy/api/runs` con `Idempotency-Key` → `RunStart` (`runOperation`, tipo `runs.start`; foto de las reliquias equipadas que siguen siendo propias y vivas; semilla `randomBytes(8)`; `content` y su versión leídos antes de la transacción; límite `startPerHour`; `features.runs` → `503 runs_disabled`).
- `POST /galaxy/api/runs/:id/finish` con `Idempotency-Key` y `bodyLimit` de 3 MB → `RunResult` (`runOperation`, tipo `runs.finish`; bloquea la partida con `FOR UPDATE`; ajena o inexistente → 404 `run_not_found`; terminada → 409 `run_finished`; más de `expireHours` → 410 `run_expired`; `inputs` que no decodifican → 400 `bad_inputs`; plausibilidad; segmentos diarios con los segundos ya jugados hoy (bloqueando `run_days`); pago en el libro con razón `run` y `ref { run }`; señales por jefe con `crypto.randomInt`; guarda entradas, resumen, banderas y versión de `runs`).

- [ ] **Step 1: Tests que fallan:** el hangar nuevo tiene 2 ranuras vacías y la sonda Lumen; equipar galaxias propias funciona y ajenas, desintegradas, repetidas o de más fallan sin cambios; desintegrar o fusionar una equipada → 409 y la colección marca `equipped`; empezar devuelve semilla, contenido y la foto de reliquias (sin la galaxia desintegrada después de equipar); terminar extrayendo paga botín × profundidad; morir paga la mitad; la misma clave dos veces → el mismo resultado y un solo pago; otra clave → 409; ajena → 404; caducada → 410; base64 roto → 400; botín imposible → pagado recortado y `suspicious`; con 2 h 50 min ya jugadas hoy, una partida de 20 min cobra 10 min a ×1 y 10 a ×0,75; `features.runs = false` → 503; ninguna petición rota da 500.
- [ ] **Step 2–4** (BD local migrada). **Step 5: Commit** `feat(galaxy): hangar y partidas en el servidor`.

### Task 13: Sprites, atlas y escenario PixiJS

**Files:** create `apps/web/src/arena/sprites/*`, `apps/web/src/arena/stage/{stage.ts,atlas.ts,camera.ts,terrain.ts,fx.ts}`; modify `apps/web/package.json` (`pixi.js` 8.21.0), `docs/DESIGN_SYSTEM.md` (§8 quater Arena: paleta de sprites, capas, cámara y *juice*); tests `apps/web/test/{sprites,camera,terrain,fx}.test.ts`, `apps/web/test/browser/arena.browser.test.ts`.

**Interfaces — Produces:**
- `SpriteDef { w; h; frames: string[][]; palette: Record<string, string>; fps: number; anchor: [number, number] }` (`.` transparente) y `SPRITES: Record<string, SpriteDef>`; `rasterize(def, frame, scale = 1): HTMLCanvasElement`; `spriteDataUrl(id, scale): string` (para iconos del HUD y del Hangar). Sprites: `probe-lumen` 16×16 (2 fotogramas de propulsor), `mite` 8×8, `cell` 12×12, `cellet` 7×7, `ray` 16×12, `spitter` 12×12, `shell` 16×16, `hive` 40×40, `xp-1/xp-5/xp-25`, `coin`, `dust`, `bolt`, `lance`, `orb`, `drone`, `foe-bullet`, `rock-1..3` y un icono 12×12 por arma y pasiva. Contorno oscuro de 1 px, luz desde arriba a la izquierda, colores de los tokens y de las paletas del motor; la fauna lleva el magenta y el cian de la Estática.
- `cameraFor(viewportW, viewportH, focus: {x,y}, vision: number): Camera` (`{ zoom (entero, round(alto/340), mínimo 1), worldW (≤ 21/9 del alto), worldH, x, y, bars: { left; right } }`).
- `terrainAt(chunkX, chunkY, sectorSeed): Decor[]` (decoración determinista por trozo de 256 u: nubes tramadas, rocas, polvo braille).
- `createFx(reduced: boolean)`: partículas, números de daño, sacudida proporcional que decae (`shake(amount)`, `update(dt)` → desplazamiento), destellos de golpe.
- `createStage(canvas: HTMLCanvasElement, content: Content, opts: { reduced: boolean; vision: number }): Promise<Stage>` con `Stage { render(sim: Sim, alpha: number): void; resize(w, h): void; destroy(): void }`: importa `pixi.js/unsafe-eval`; capas suelo → decoración → recogidas → áreas → enemigos → sondas → balas → efectos; interpola `px→x` con `alpha` y no interpola un índice cuyo `gen` cambió; destello blanco al golpear, glitch de Estática (copias desplazadas en rojo y cian) en élites y jefe, aviso visible de embestidas y patrones, anillo de la baliza, bandas laterales decoradas fuera del 21:9.

- [ ] **Step 1: ui-ux-pro-max** (HUD de juego, legibilidad sobre fondo animado, *juice*) y anotar §8 quater en `DESIGN_SYSTEM.md`.
- [ ] **Step 2: Tests que fallan:** todos los sprites tienen filas del mismo ancho y solo usan claves de su paleta; cada `sprite` e `icon` del contenido existe en `SPRITES`; la cámara da zoom entero y nunca más de 21:9 (3440×1440 deja bandas; 1280×720 no); el terreno de un trozo es siempre el mismo; la sacudida decae a 0 y con movimiento reducido no hay sacudida; **browser:** el escenario dibuja una partida de 600 ticks sin errores ni avisos de CSP, la imagen no es uniforme y, con `VITE_ARENA_SHOTS=1`, guarda capturas en `__shots__` a 1280×720 y 2560×1080.
- [ ] **Step 3: Implementar y revisar las capturas** (calidad PokéBonk: sprites legibles, contraste con el suelo, nada genérico); corregir hasta que se vean bien.
- [ ] **Step 4: Ver pasar.** **Step 5: Commit** `feat(galaxy): escenario de la arena con PixiJS y sprites pixel art`.

### Task 14: La partida en el navegador

**Files:** create `apps/web/src/arena/{ArenaScreen.tsx,loop.ts,input.ts,settings.ts,arena-sfx.ts}`, `apps/web/src/arena/hud/*`; modify `src/copy/es.ts` (`arena`), `src/styles/app.css`, `docs/DESIGN_SYSTEM.md` (§8 quater: HUD, mejoras, pausa, radio); tests `apps/web/test/{loop,input,arena}.test.ts(x)`.

**Interfaces — Consumes:** `createSim`, `step`, `hudSnapshot`, `runSummary`, `encodeLog`, `toBase64` (T3–T9); `createStage` (T13). **Produces:**
- `createLoop({ step: () => void; render: (alpha: number) => void; now: () => number }): Loop` con `start()`, `stop()`, `pause()`, `resume()`, `paused`: acumulador de 1/60 s, como mucho 5 pasos por fotograma (el resto se descarta), y en pausa ni pasos ni recuperación al reanudar.
- `readInput(state: InputState, settings: { manualAim: boolean }, aimFrom?: {x,y}): ProbeInput` (WASD y flechas, mando con zona muerta 0,2 cuantizado a 127, apuntado con ratón o stick derecho si `manualAim`); `settings.ts` con `galaxy.aim.manual` en `localStorage`.
- `ArenaScreen({ run: RunStart; onEnd: (end: RunEnd) => void })` con `RunEnd { outcome: 'extracted'|'died'|'abandoned'; summary: RunSummary; inputs: string }`: crea la simulación con `record: true`, el escenario y el bucle; HUD a 10 Hz con `hudSnapshot`; pausa con Escape, P o Start, y automática al ocultar la pestaña o perder el foco; diálogo de mejora (3 cartas, teclas 1–3, flechas y Enter, mando) que envía `pick`; pausa con Continuar, apuntado manual, sonido y «Abandonar incursión» (confirmación); barra del jefe; marcador de la baliza fuera de pantalla con cuenta atrás y progreso; radio de PERKINS (1–2 líneas, se salta, no bloquea, cada mensaje una vez por cuenta en `galaxy.radio.seen`); aviso `beforeunload` durante la partida; efectos de sonido de combate con el silencio de siempre.
- Copy fijado: «Elige una mejora», «Nueva», «Nivel {n}», «Pausa», «Continuar», «Abandonar incursión», «Se cobra la mitad del botín. No se puede deshacer», «Capa {n}», «Baliza de extracción abierta», «Llega a la baliza», «Extrayendo», «Núcleo de la Estática». Radio: «PERKINS: Sector a la vista. La Estática ya se ha comido medio cielo. Muévete, la sonda dispara sola» · «PERKINS: Núcleo de la Estática en el radar. Es grande. Tú también, más o menos» · «PERKINS: Baliza abierta. Tienes un minuto para llegar o bajamos una capa» · «PERKINS: Capa {n}. Aquí la Estática muerde más fuerte, y el botín también».

- [ ] **Step 1: ui-ux-pro-max** (HUD, diálogo de mejora, pausa) y anotar en `DESIGN_SYSTEM.md`.
- [ ] **Step 2: Tests que fallan:** el bucle da 60 pasos por segundo simulado, nunca más de 5 por fotograma, y tras 10 s oculto no recupera nada al volver; el teclado y el mando dan las entradas cuantizadas esperadas y las diagonales salen normalizadas; con apuntado manual el ángulo sigue al ratón; el diálogo de mejora aparece con la oferta, se elige con 2 y Enter, y el foco vuelve; Escape abre la pausa y la pestaña oculta también; «Abandonar incursión» pide confirmación y llama a `onEnd` con `abandoned`; la radio se muestra una vez; el HUD anuncia vida y nivel a lectores de pantalla sin inundar la región viva.
- [ ] **Step 3: Implementar** y revisar capturas del HUD sobre la arena (browser) a 1280×720 y 3440×1440.
- [ ] **Step 4: Ver pasar.** **Step 5: Commit** `feat(galaxy): la incursión jugable en el navegador`.

### Task 15: Hangar, resultados y entrada desde el título

**Files:** create `apps/web/src/api/{runs.ts,pending-run.ts}`, `apps/web/src/hangar/*`; modify `src/App.tsx` (ruta `/incursion` con `SignedIn`), `src/hub/MainMenu.tsx` (Jugar y Supervivencia llevan a `/incursion`; Hogar sigue bloqueado), `src/collection/{GalaxyDetailDialog.tsx,CollectionScreen.tsx}` (marca «Equipada», desintegrar y elegir para fusionar deshabilitados con su motivo), `src/copy/es.ts` (`hangar`, `results`), `src/styles/app.css`, `docs/DESIGN_SYSTEM.md` (§8 ter Hangar y resultados); tests `apps/web/test/{hangar,results,pending-run}.test.tsx`, `hub.test.tsx`, `collection.test.tsx`.

**Interfaces — Produces:** `useHangar()`, `useSetLoadout()`, `useStartRun()` y `useFinishRun()` (clave por intención como en M2b: se conserva tras un error de red o 5xx y termina con éxito o 4xx); `savePending(p)`, `loadPending()`, `clearPending()` (`galaxy.run.pending` = `{ runId, key, body }`); `HangarScreen` con fases `hangar → arena → results` (la arena con `lazy(() => import('../arena/ArenaScreen'))` y un indicador braille mientras carga); `ResultsScreen({ result: RunResult })`.

- Hangar: sector (nombre, descripción, fauna con sus sprites, jefe; más sectores bloqueados «En desarrollo»), sonda (sprite grande, vida, velocidad, arma inicial; más sondas bloqueadas), ranuras (2 abiertas con la carta o «Elegir reliquia», 4 bloqueadas), descripción de cada reliquia con `describeRelic` (familia, elemento, fenómeno, potencia), rendimiento diario («Premio completo: te quedan 2 h 10 min hoy» o el tramo actual) y «Lanzar incursión» (Solar).
- Resultados: «Extracción completada», «Sonda perdida» o «Incursión abandonada»; profundidad, tiempo, bajas y nivel; botín por capa con su multiplicador, la mitad si no hubo extracción, los tramos del rendimiento diario; lo cobrado con contadores que suben; «Otra incursión» y «Volver al inicio».

- [ ] **Step 1: ui-ux-pro-max** (pantalla de preparación y de resultados) y anotar §8 ter.
- [ ] **Step 2: Tests que fallan:** el Hangar muestra sector, sonda, 2 ranuras y el rendimiento; elegir una reliquia la equipa y se puede quitar; una partida pendiente se reenvía al entrar con la misma clave y se borra al recibir el resultado (y se conserva tras un 503); un fallo de red al terminar muestra «Reintentar» sin perder la partida; los resultados muestran cada capa, el reparto y los tramos; Jugar y Supervivencia llevan al Hangar; en la colección, una galaxia equipada no se puede desintegrar ni elegir para fusionar y dice por qué.
- [ ] **Step 3: Implementar y revisar capturas** a 1280×720, 1920×1080 y 3440×1440.
- [ ] **Step 4: Ver pasar.** **Step 5: Commit** `feat(galaxy): hangar, resultados y entrada a las incursiones`.

### Task 16: e2e, documentación, revisión final, PR y PRE

**Files:** create `apps/web/e2e/incursion.spec.ts`; modify `games/galaxy/docs/DEPLOY_PRE.md` (paso de M3a), el registro del plan.

- [ ] **Step 1: e2e que falla y pasa:** crear cuenta → escáner x10 con las señales de bienvenida → Hangar → equipar una reliquia → lanzar → la arena dibuja y el tiempo avanza al moverse con el teclado → Escape → «Abandonar incursión» → confirmar → resultados con la mitad del botín → «Otra incursión» → en la colección, la reliquia equipada no se puede desintegrar.
- [ ] **Step 2:** `typecheck`, `lint`, `test` (todos los proyectos), `supabase test db`, e2e completo, `TZ=UTC pnpm test:unit` en la raíz, `docker build` del juego + humo de `/galaxy/api/health` y de que el fragmento de la arena carga sin violaciones de CSP.
- [ ] **Step 3:** revisión final de toda la rama con un revisor nuevo (modelo más capaz); una pasada de arreglos con TDD; los menores al registro.
- [ ] **Step 4:** PR a `develop`, CI verde, fusión, despliegue de PRE verificado con una cuenta de prueba (Hangar, una partida real con extracción o caída, pago en el monedero, sin violaciones de CSP), tiempo de la build medido.
- [ ] **Step 5:** memoria, `DEPLOY_PRE.md` y cierre del registro junto al plan.
