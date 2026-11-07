# Galaxy Survivor · M3b-1: arsenal · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (decidido: ejecución directa, `feedback-direct-execution`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar el arsenal de las incursiones: 16 armas con un papel distinto cada una, 20 pasivas, una evolución por arma, reacciones entre elementos y conjuntos de reliquias. Todo se ve en la arena, se elige en las mejoras, se explica en el Hangar y queda calibrado con la simulación de combinaciones de §8.6.

**Architecture:**
- **Simulación** (`packages/sim`):
  - 9 tipos de arma nuevos en `systems/weapons.ts` (o en módulos hermanos si el archivo pasa de ~700 líneas), y 6 estadísticas nuevas en `systems/stats.ts`.
  - Evoluciones como armas de un solo nivel con `evolution` en `content.weapons`, ofrecidas por `systems/upgrades.ts`.
  - Marcas de elemento y tabla de reacciones en `systems/reactions.ts` (nuevo), con aturdimiento y vulnerabilidad en la piscina de enemigos.
  - Conjuntos de reliquias en `systems/sets.ts` (nuevo).
  - Todos los números siguen siendo datos (`content`).
- **Web** (`apps/web`): sprites e iconos nuevos, el escenario dibuja los tipos nuevos, las reacciones y los estados, la carta de evolución en las mejoras, y el panel de conjuntos en el Hangar.
- **Calibración:** simulación de combinaciones (aleatorias y extremas) con techo absoluto de daño por segundo además del de la mediana.

**Tech Stack:** el de M3a (TypeScript, Zod 4, PixiJS 8.21.0, React 19, Vitest + fast-check, Playwright). Sin servidor ni base de datos nuevos.

**Spec:**
- `games/galaxy/docs/GDD.md`:
  - §5.3 armas, pasivas y evoluciones;
  - §5.4 elementos y reacciones;
  - §8.3 rasgos → pasiva (fila «Conjunto»);
  - §8.6 frenos y simulación de combinaciones;
  - §17.3 *juice*;
  - §19 (M3b).
- `games/galaxy/docs/DESIGN_SYSTEM.md` §8 ter–quinquies (Hangar, arena y HUD), que se amplían antes del CSS.
- Registro de M3a: `docs/superpowers/plans/2026-11-07-galaxy-m3a-incursion.ledger.md`, con *rulings* que siguen vigentes, por ejemplo el techo de 40× la mediana y el techo absoluto aplazado a este hito.
- Autoridad: autonomía total hasta la beta (2026-11-06, reafirmada el 2026-11-07). Este plan lo apruebo yo y las dudas se resuelven con *rulings* en el registro.

## Decisiones de alcance (rulings del plan)

1. **M3b se divide en tres PR** a `develop`, cada uno con su plan:
   - M3b-1, arsenal (este);
   - M3b-2, sondas (8 sondas, test de personalidad y desbloqueos);
   - M3b-3, sectores (4+1 sectores, unos 24 enemigos, 5+1 jefes, biomas y desbloqueo de sectores).

   Motivo: un PR por hito completo sería inmanejable para revisar. Coste si no hacía falta: dos ciclos más de PR.
2. **Evoluciones:**
   - Son armas de un nivel con un bloque `evolution { from, requires }`. Exigen el arma base al nivel máximo y además una pasiva concreta (a cualquier nivel) o un elemento entre las reliquias equipadas.
   - Se ofrecen como **primera carta** de la siguiente mejora, con el estilo «Evolución»; no hay cofre.
   - La evolución ocupa el hueco del arma base.
   - Nunca se ofrece como arma nueva.
3. **Rasgos especiales** de las evoluciones: 5 genéricos, para no escribir 16 mecánicas sueltas:
   - `split`: al primer golpe, 3 fragmentos en abanico al 50 %;
   - `echo`: repite el disparo a los 0,15 s;
   - `vortex`: sus áreas atraen;
   - `pierceAll`: perforación sin límite;
   - `chain`: cada golpe salta a 2 vecinos al 50 %.

   Además, cada evolución puede llevar un elemento propio, que aplica en cada golpe.
4. **Reacciones por marcas:**
   - Un golpe con elemento deja su **marca** en el enemigo (3 s). Un golpe de otro elemento sobre un enemigo marcado dispara la reacción de esa pareja, si existe, y consume la marca.
   - Cada enemigo tiene 1 s de espera entre reacciones (freno de §8.6).
   - El daño de una reacción no lleva elemento, así que no hay cadenas infinitas.
   - Los jefes sufren el aturdimiento a ×0,25.
   - `pure`, `prism` (que se resuelve antes al elemento de turno) e `invert` no reaccionan.
5. **Conjuntos de reliquias:**
   - De **mismo rasgo**, con umbrales de 2 y 3 reliquias: paleta, tipo, fondo y núcleo.
   - De **combinación** tipo + fenómeno, en reliquias distintas o en la misma.
   - Con 2 ranuras ya se activan los de 2 y las combinaciones; los de 3 se ven en el Hangar como «con 3 reliquias», a la espera de las ranuras de M4.
6. **Estadísticas nuevas:**
   - `velocity`: velocidad y alcance de los proyectiles.
   - `duration`: duración de áreas, minas, torretas y rayos.
   - `pierce`: perforación extra, entera.
   - `elemental`: probabilidad de aplicar el elemento, duración de los estados y daño de las reacciones.
   - `barrier`: escudo que se recarga, en fracción de la vida máxima, en la misma reserva que el escudo de las reliquias elípticas.
   - `curse`: más enemigos y más botín. En partidas de N sondas cuenta la mayor de las sondas vivas.
7. **Iconos de evolución:** se generan en código a partir del icono del arma base (marco dorado y brillo), sin dibujar 16 iconos más. Coste si no gustan: dibujarlos luego, porque son datos.
8. **`SIM_VERSION` pasa a `1.1.0`.** Las partidas de M3a siguen guardadas con su versión, y la repetición en el servidor (M5) tendrá que usar la de cada partida.
9. **El contenido guardado en la configuración viva** con el esquema de M3a deja de validar, porque faltan campos nuevos. En PRE no hay ninguno guardado (no hay panel de admin hasta M6), así que no hay migración de datos: el defecto es `DEFAULT_CONTENT`.
10. **Sin servidor ni migraciones.** El servidor ya sirve el `content` vivo.

## Global Constraints

- **Rama `feature/galaxy-m3b1`** desde `develop` después de fusionar M3a.
  - Commits en español, convencionales, con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - PR a `develop`, que se fusiona con el CI en verde; después se verifica PRE.
- **TDD estricto:**
  - las mecánicas, con pruebas sobre `packages/sim/test/fixtures.ts` (`tinyContent`), para que calibrar no las rompa;
  - las reglas puras, con fast-check (≥ 200 casos);
  - la web, con pruebas de componentes, del navegador (capturas en `__shots__`, ignorado por git) y e2e.
- **Determinismo** (como en M3a):
  - la regla de lint de `packages/sim` sigue vigente;
  - orden de iteración por índice;
  - nada de `Set` u objetos con claves numéricas para decidir;
  - `stateHash` incluye los campos nuevos de la piscina de enemigos.
- **Paso fijo de 60 Hz:** `ticks(s) = round(s·60)`.
- **Contenido como datos:** todo número nuevo vive en `DEFAULT_CONTENT` y lo valida `contentSchema` (estricto, con referencias cruzadas).
- **Frontend:**
  - consultar ui-ux-pro-max antes del CSS;
  - ampliar `DESIGN_SYSTEM.md` antes de usar algo nuevo;
  - copy en español (títulos directos, sin símbolos ni punto final);
  - `prefers-reduced-motion`;
  - el listón visual es PokéBonk (`feedback-visual-demos`).
- **CSP:** sin cambios; PixiJS solo en el fragmento de la arena.
- **BD local del usuario:** este hito no la toca. La integración del servidor solo se vuelve a ejecutar con `pnpm -C games/galaxy test`.
- **Comandos:** los de M3a:
  - unit: `pnpm -C games/galaxy exec vitest run --project unit <ruta>`;
  - `--project web`, `--project browser` e `--project integration`;
  - e2e: `pnpm -C games/galaxy/apps/web exec playwright test <spec>`, con `timeout` y comprobando después el puerto 8090.

### Valores de partida

**Estadísticas nuevas.** Todas tienen rendimiento decreciente `diminish(vs, cap)`, salvo `pierce`, que es una suma entera con tope duro.

| Clave | Efecto | Tope |
|---|---|---|
| `velocity` | velocidad y alcance de los proyectiles ×(1 + v) | 1 |
| `duration` | duración de áreas, minas, torretas, rayos y charcos ×(1 + v) | 1 |
| `pierce` | +N de perforación a `bolt`, `lance`, `shards` y a los fragmentos de `split` | 5 |
| `elemental` | probabilidad de aplicar el elemento de las reliquias ×(1 + v); duración de quemadura, ralentización, corrosión y hackeo ×(1 + v); daño de las reacciones ×(1 + v) | 1 |
| `barrier` | escudo = v × vida máxima; se recarga un 10 % de su capacidad por segundo tras 3 s sin recibir daño | 0,3 |
| `curse` | grupos por segundo y tope de vivos ×(1 + v), sin pasar de `limits.enemies`; probabilidad de moneda, polvo y kit ×(1 + v) | 0,5 |

**Pasivas nuevas.** El valor es el TOTAL de la categoría en cada nivel; 5 niveles salvo `drill`, que tiene 3.

| id | Nombre | Stat | Niveles | Descripción |
|---|---|---|---|---|
| `plating` | Placas reactivas | `armor` | .03,.06,.09,.12,.15 | Ignoras parte del daño que recibes |
| `scope` | Mira de precisión | `crit` | .03,.06,.09,.12,.15 | Más golpes críticos |
| `overcharge` | Núcleo sobrecargado | `critDamage` | .15,.3,.45,.6,.75 | Los críticos hacen más daño |
| `memory` | Banco de memoria | `xp` | .08,.16,.24,.32,.4 | Aprendes más de cada fragmento |
| `clover` | Trébol cuántico | `luck` | .1,.2,.3,.4,.5 | Caen más monedas, polvo y kits |
| `siphon` | Sifón | `lifesteal` | .01,.02,.03,.04,.05 | Recuperas vida con el daño que haces |
| `accelerator` | Acelerador de partículas | `velocity` | .1,.2,.3,.4,.5 | Proyectiles más rápidos y de más alcance |
| `stabilizer` | Estabilizador | `duration` | .1,.2,.3,.4,.5 | Áreas, minas y torretas duran más |
| `catalyst` | Catalizador | `elemental` | .1,.2,.3,.4,.5 | Los elementos prenden más y las reacciones pegan más fuerte |
| `deflector` | Deflector | `barrier` | .06,.12,.18,.24,.3 | Un escudo que se recarga si no te golpean |
| `static_signal` | Señal de la Estática | `curse` | .1,.2,.3,.4,.5 | Llegan más enemigos y sueltan más botín |
| `drill` | Punta de taladro | `pierce` | 1,2,3 | Los proyectiles atraviesan un enemigo más |

**Armas nuevas.** Hay 5 niveles por arma; una celda con una sola cifra vale para todos los niveles.

| id | Nombre | Tipo | Daño | Enfr. s | Cant. | Otros |
|---|---|---|---|---|---|---|
| `beam` | Rayo continuo | `beam` (se fija en el más cercano y quema la línea) | 5,6,7,8,10 por golpe | 3,2.8,2.6,2.4,2.2 | 1,1,1,2,2 | alcance 180, ancho (`area`) 6, duración 1.2,1.4,1.6,1.8,2, intervalo 0.15 |
| `cone` | Lanzallamas | `cone` (abanico hacia donde apuntas, pegado a la sonda) | 6,7,8,9,11 | 2.2,2.1,2,1.9,1.7 | 1 | radio (`range`) 70,75,80,85,95, arco (`area`, en grados) 50,55,60,65,70, duración 1,1.1,1.2,1.3,1.5, intervalo 0.2 |
| `shards` | Esquirlas | `radial` (a todas las direcciones) | 8,9,10,12,14 | 1.8,1.7,1.6,1.5,1.4 | 6,7,8,10,12 | perforación 0,0,1,1,2, velocidad 240, alcance 160 |
| `homing` | Misiles buscadores | `homing` (giran 240 °/s hacia el más cercano, estallan) | 14,16,18,21,24 | 2,1.9,1.8,1.7,1.6 | 1,2,2,3,3 | velocidad 200, alcance 300, radio de estallido (`area`) 24,26,28,30,34 |
| `mine` | Minas de proximidad | `mine` (se arman en 0,5 s, estallan al acercarse alguien) | 30,35,40,46,54 | 2.5,2.4,2.2,2,1.8 | 1,1,2,2,3 | radio de estallido (`area`) 36,38,40,44,48, disparo (`range`) 18, vida (`duration`) 8,8,9,9,10 |
| `boomerang` | Disco de retorno | `boomerang` (va y vuelve, atraviesa todo) | 12,14,16,18,21 | 1.6,1.5,1.4,1.3,1.2 | 1,1,2,2,3 | velocidad 280, alcance 130,140,150,160,180, intervalo por enemigo 0.3 |
| `field` | Pozo gravitatorio | `field` (en el enemigo más cercano, atrae y daña) | 5,6,7,8,10 | 4,3.8,3.6,3.4,3 | 1 | radio (`area`) 50,54,58,62,70, duración 2.5,2.7,3,3.3,3.6, intervalo 0.25, alcance 220, atracción (`knockback`, u/s) 40,45,50,55,60 |
| `strike` | Bombardeo orbital | `strike` (marca enemigos visibles, estalla tras el aviso) | 26,30,34,39,45 | 2.8,2.6,2.4,2.2,2 | 2,2,3,3,4 | radio (`area`) 28,30,32,34,38, aviso (`interval`) 0.6, alcance 260 |
| `turret` | Torreta | `turret` (fija, dispara al más cercano) | 7,8,9,10,12 | 5,4.8,4.5,4.2,4 | 1,1,2,2,3 (torretas a la vez; la más vieja se va) | duración 8,9,10,11,12, cadencia (`interval`) 0.5,0.45,0.4,0.35,0.3, alcance 200, velocidad de bala 320 |

**Evoluciones.** Todas tienen un solo nivel y el mismo tipo que el arma base. «Requiere» es la pasiva que hay que tener (a cualquier nivel) o el elemento de una reliquia equipada.

| id | Nombre | De | Requiere | Especial | Elemento | Números |
|---|---|---|---|---|---|---|
| `pulse_storm` | Tormenta de pulsos | `pulse` | `capacitor` | `split` | — | daño 26, enfr. 0.32, cant. 4, vel. 380, alcance 300 |
| `stellar_collapse` | Colapso estelar | `nova` | `lens` | `vortex` | `slow` | daño 40, enfr. 1.5, área 110, empuje 0 |
| `neutron_lance` | Lanza de neutrones | `lance` | `drill` | `pierceAll` | `breach` | daño 44, enfr. 0.95, cant. 3, vel. 620, alcance 500 |
| `asteroid_belt` | Cinturón de asteroides | `orbit` | `armor` | `chain` | — | daño 22, cant. 6, área 72, vel. 260, intervalo 0.4 |
| `plasma_wake` | Estela de plasma | `trail` | elemento `burn` | — | `burn` | daño 16, enfr. 0.2, área 26, duración 4, intervalo 0.25 |
| `ion_storm` | Tormenta iónica | `arc` | elemento `shock` | `chain` | `shock` | daño 30, enfr. 0.8, rebotes 10, alcance 150, vel. 480 |
| `sentinel_swarm` | Enjambre centinela | `drone` | `splitter` | `echo` | — | daño 16, enfr. 0.45, cant. 4, alcance 260, vel. 340 |
| `ion_ray` | Rayo de iones | `beam` | `amplifier` | `chain` | `shock` | daño 15, enfr. 1.8, cant. 3, alcance 220, ancho 9, duración 2.6, intervalo 0.12 |
| `solar_breath` | Aliento solar | `cone` | `catalyst` | `vortex` | `burn` | daño 17, enfr. 1.4, radio 115, arco 85, duración 1.8, intervalo 0.18 |
| `crystal_crown` | Corona de cristal | `shards` | `overcharge` | `echo` | `pure` | daño 20, enfr. 1.2, cant. 16, perfor. 3, vel. 280, alcance 200 |
| `missile_swarm` | Enjambre de misiles | `homing` | `accelerator` | `split` | — | daño 34, enfr. 1.3, cant. 5, vel. 240, alcance 360, estallido 42 |
| `minefield` | Campo minado | `mine` | `plating` | — | `slow` | daño 80, enfr. 1.4, cant. 4, estallido 60, disparo 24, vida 12 |
| `reaper_disc` | Disco segador | `boomerang` | `siphon` | `pierceAll` | `leech` | daño 30, enfr. 0.9, cant. 4, vel. 320, alcance 210, intervalo 0.25 |
| `event_horizon` | Horizonte de sucesos | `field` | `magnet` | — | `corrosion` | daño 15, enfr. 2.4, área 95, duración 4.5, intervalo 0.2, alcance 260, atracción 85 |
| `orbital_lance` | Lanza orbital | `strike` | `scope` | — | `pure` | daño 70, enfr. 1.6, cant. 6, área 46, aviso 0.5, alcance 300 |
| `defense_battery` | Batería defensiva | `turret` | `stabilizer` | `split` | `chain` | daño 16, enfr. 3.5, cant. 4, duración 15, cadencia 0.22, alcance 240, vel. 360 |

**Reacciones.** Se dispara la de la pareja (marca, golpe nuevo) en cualquier orden. «Golpe» es el daño del golpe que dispara la reacción; todo se multiplica por `1 + elemental`.

| id | Nombre | Pareja | Efecto |
|---|---|---|---|
| `short_circuit` | Cortocircuito | corrosión + descarga | `chain`: 5 objetivos a 120 u, 80 % del golpe |
| `storm` | Tormenta | rebotes + descarga | `chain`: 8 objetivos a 140 u, 50 % |
| `overload` | Sobrecarga | quemadura + descarga | `explode`: radio 56, 100 % |
| `implosion` | Implosión | daño a escudos + quemadura | `explode`: radio 40, 160 % |
| `thermal_shock` | Choque térmico | quemadura + ralentización | `shatter`: +40 % de daño recibido 4 s y sin frente blindado, más un golpe del 50 % |
| `fracture` | Fractura | daño a escudos + ralentización | `shatter`: +50 % 3 s, más un golpe del 30 % |
| `superconductor` | Superconductor | descarga + ralentización | `stun`: 1,2 s |
| `logic_loop` | Bucle lógico | hackeo + ralentización | `stun`: 2 s |
| `boiling_acid` | Ácido hirviente | quemadura + corrosión | `spread`: copia quemadura y corrosión a 5 vecinos a 70 u |
| `virus` | Virus | hackeo + corrosión | `spread`: hackeo de 2 s a 3 vecinos a 80 u (sin jefes ni élites) |
| `bloodletting` | Sangría | robo de vida + quemadura | `drain`: golpe del 100 % y cura el 25 % de ese daño |

Marcas: duran 3 s, con 1 s de espera por enemigo entre reacciones. Aturdimiento sobre jefes ×0,25. La vulnerabilidad no se acumula: se queda la mayor y la más larga.

**Conjuntos de reliquias.** Cada fila se activa al llegar a su número de reliquias, y la de 3 sustituye a la de 2.

| id | Nombre | Condición | Con 2 | Con 3 |
|---|---|---|---|---|
| `resonance` | Resonancia cromática | misma paleta | `elemental` +.25 | `elemental` +.5 |
| `lineage` | Linaje | mismo tipo de galaxia | magnitud de esas reliquias ×1,15 | ×1,3 |
| `same_sky` | Mismo cielo | mismo fondo | el bonus de fondo de esas reliquias ×1,5 | ×2 |
| `twin_cores` | Núcleos gemelos | mismo núcleo | `crit` +.04 | `crit` +.08 |
| `satellite_arm` | Brazo satélite | `spiral` + `satellite_galaxy` | `projectiles` +1 | — |
| `lighthouse` | Faro | `barred_spiral` + `pulsar` | `cooldown` +.08 | — |
| `einstein_lens` | Lente de Einstein | `lenticular` + `einstein_ring` | `critDamage` +.3 | — |
| `stellar_heart` | Corazón estelar | `elliptical` + `supernova` | `maxHp` +.2 | — |
| `chaos_engine` | Motor del caos | `irregular` + `anomaly` | `luck` +.25 | — |

## Review Focus

1. **Piscinas llenas con `split`, `echo`, esquirlas, misiles y torretas:**
   - Los disparos que no caben se pierden sin romper nada ni regenerarse cada tick (el menor 2 de M3a).
   - La partida sigue siendo determinista.
   - → Tareas 2, 3 y 5 (`weapons.test.ts`, `recording.test.ts` con piscinas pequeñas).
2. **Evolucionar un arma con disparos persistentes vivos** (órbita, dron, torreta, rayo):
   - el hueco se sustituye sin disparos huérfanos ni disparo doble;
   - la repetición da el mismo hash.
   - → Tarea 5.
3. **Reacciones que se disparan unas a otras:**
   - el daño de una reacción no lleva elemento y nunca reacciona de nuevo;
   - el aturdimiento de jefes va reducido;
   - la vulnerabilidad no se acumula sin tope;
   - con 1 s de espera por enemigo.
   - → Tarea 6.
4. **Maldición y densidad:** con `curse` alto y 2 sondas, el director nunca pasa de `limits.enemies` ni del tope de vivos escalado, y cuenta la sonda viva con más maldición → Tarea 4.
5. **Contenido vivo con referencias rotas:**
   - una evolución de un arma que no existe, una pasiva requerida que no existe, una pareja de reacción repetida o con un elemento inexistente, o un conjunto con un rasgo desconocido: el esquema lo rechaza con una ruta clara;
   - nunca hay un fallo a mitad de partida;
   - el `xp` a cero que congelaba el navegador (menor 6 de M3a) también se rechaza.
   - → Tarea 1.

---

## File structure

```
games/galaxy/
  packages/sim/src/
    version.ts                        SIM_VERSION 1.1.0                                   (T1)
    content/types.ts                  STAT_KEYS +6, WeaponKind +9, Special, evolution,     (T1)
                                      ReactionDef, RelicSetDef
    content/schema.ts                 validación y referencias cruzadas                   (T1)
    content/default.ts                16 armas, 20 pasivas, 16 evoluciones,               (T1–T7)
                                      11 reacciones, 9 conjuntos, topes nuevos
    types.ts                          Stats +6, Offer 'evolve', HitSource sin cambios     (T1, T5)
    events.ts                         'reaction', 'evolve', 'mark'                         (T5, T6)
    world/pools.ts                    enemigos: mark, markT, reactT, stunT, vulnT, vulnBonus (T6)
    systems/stats.ts                  6 estadísticas nuevas                                (T1)
    systems/weapons.ts                9 tipos nuevos, especiales, velocity/duration/pierce (T2, T3, T5)
    systems/probes.ts                 barrera (reserva única con el escudo de reliquias)   (T4)
    systems/director.ts, pickups.ts   maldición                                            (T4)
    systems/elements.ts               elemental, marcas                                    (T4, T6)
    systems/reactions.ts (nuevo)      tabla y efectos de las reacciones                    (T6)
    systems/enemies.ts, boss.ts       aturdimiento y vulnerabilidad                         (T6)
    systems/upgrades.ts               ofertas de evolución                                  (T5)
    systems/sets.ts (nuevo)           conjuntos de reliquias                                (T7)
    systems/relics.ts                 magnitud y fondo por conjunto; recarga en probes.ts  (T4, T7)
    snapshot.ts                       kit con evoluciones, marcas para el HUD              (T5)
    summary.ts                        stateHash con los campos nuevos                       (T6)
  packages/sim/test/
    fixtures.ts                       tinyContent ampliado                                  (T1)
    content.test.ts, stats.test.ts, weapons.test.ts, upgrades.test.ts,
    reactions.test.ts (nuevo), sets.test.ts (nuevo), builds.test.ts (nuevo), recording.test.ts
  apps/web/src/
    arena/sprites/{items,icons,index}.ts   proyectiles, iconos nuevos, iconos de evolución (T9)
    arena/stage/{stage,fx}.ts              tipos nuevos, reacciones, marcas y aturdimiento  (T10)
    arena/hud/{LevelUp,Hud}.tsx            carta de evolución, kit evolucionado            (T11)
    hangar/{HangarScreen,SetsPanel}.tsx     conjuntos activos y posibles                    (T12)
    copy/es.ts, styles/app.css
  apps/web/test/…, apps/web/test/browser/…, apps/web/e2e/incursion.spec.ts
  docs/DESIGN_SYSTEM.md, docs/DEPLOY_PRE.md
```

---

### Task 1: Contenido nuevo, estadísticas y esquema

**Files:**
- Modify:
  - `packages/sim/src/{version.ts,content/types.ts,content/schema.ts,content/default.ts,types.ts,systems/stats.ts}`;
  - `packages/sim/test/fixtures.ts`.
- Test: `packages/sim/test/{content,stats}.test.ts`.

**Interfaces:**
- **Produces:**
  - Constantes: `SIM_VERSION = '1.1.0'`.
  - Tipos de contenido:
    - `STAT_KEYS` con `velocity`, `duration`, `pierce`, `elemental`, `barrier` y `curse`;
    - `WEAPON_KINDS` con `beam`, `cone`, `radial`, `homing`, `mine`, `boomerang`, `field`, `strike` y `turret`;
    - `SPECIALS = ['split','echo','vortex','pierceAll','chain'] as const`, con `type Special`;
    - `WeaponDef` gana `element?: ElementId | null`, `special?: Special | null` y `evolution?: { from: string; requires: { passive: string } | { element: ElementId } }`.
  - Tipos de reacciones:
    - `ReactionEffect`, la unión de `{ kind: 'chain'; targets; range; share }`, `{ kind: 'explode'; radius; share }`, `{ kind: 'shatter'; bonus; seconds; share }`, `{ kind: 'stun'; seconds }`, `{ kind: 'spread'; range; targets; statuses: ('burn'|'corrosion'|'hack')[] }` y `{ kind: 'drain'; share; heal }`;
    - `ReactionDef { id; name; pair: [ElementId, ElementId]; effect: ReactionEffect }`;
    - `ElementTuning` gana `marks: { seconds; cooldown; bossStun }` y `reactions: ReactionDef[]`.
  - Tipos de conjuntos:
    - `RelicSetDef`, la unión de `{ id; name; description; kind: 'same'; trait: 'palette'|'galaxy_type'|'background'|'core'; tiers: { count: 2|3; bonus: SetBonus }[] }` y `{ id; name; description; kind: 'combo'; type: string; phenomenon: string; bonus: SetBonus }`;
    - `SetBonus { stats?: { stat: StatKey; value: number }[]; magnitude?: number; background?: number }`;
    - `RelicTuning` gana `sets: RelicSetDef[]`.
  - En `Stats` (`types.ts`): `velocity`, `duration`, `elemental` y `curse` (multiplicador o fracción), `pierce` (entero) y `barrier` (fracción de la vida máxima).
  - En `DEFAULT_CONTENT`:
    - las 12 pasivas nuevas;
    - los topes nuevos;
    - `limits.weapons` y `limits.passives` siguen en 6.
  - Las armas, evoluciones, reacciones y conjuntos se rellenan en sus tareas. Esta tarea deja los tipos y el esquema listos, con listas vacías válidas.

- [ ] **Step 1: Tests que fallan.**
  - `stats.test.ts`:
    - cada pasiva nueva mueve su estadística;
    - `pierce` suma entero con tope 5;
    - `barrier` y `curse` respetan sus topes con rendimiento decreciente.
  - `content.test.ts`: el esquema rechaza, con ruta, cada uno de estos casos:
    - una evolución cuyo `from` no existe, es otra evolución o es de otro tipo;
    - dos evoluciones del mismo arma;
    - una evolución con más de un nivel;
    - una pasiva requerida inexistente;
    - una reacción con un elemento inexistente, con los dos elementos iguales o con una pareja repetida en cualquier orden;
    - un conjunto con un rasgo desconocido o con umbrales que no crecen;
    - `xp` con `base ≤ 0`.
  - `content.test.ts`: `DEFAULT_CONTENT` valida y tiene 20 pasivas.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project unit packages/sim/test/content.test.ts packages/sim/test/stats.test.ts`. Expected: FAIL por las claves y validaciones que faltan.
- [ ] **Step 3:** implementar los tipos, el esquema (con `superRefine` para las referencias), las pasivas, los topes y `deriveStats`, y ampliar `tinyContent` con una pasiva de cada estadística nueva.
- [ ] **Step 4:** ejecutar las mismas pruebas y todo `packages/sim`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(galaxy): estadísticas y pasivas nuevas, y esquema del arsenal`.

### Task 2: Armas nuevas I (`beam`, `cone`, `radial`, `homing`)

**Files:**
- Modify: `packages/sim/src/systems/weapons.ts` (o `systems/weapons-*.ts` si crece) y `content/default.ts`.
- Test: `packages/sim/test/weapons.test.ts`.

**Interfaces:**
- **Consumes:** T1.
- **Produces:**
  - `SHOT` gana `beam: 12`, `missile: 13`, `shard: 14`, `split: 18`.
  - `AREA` gana `cone: 7`.
  - Las 4 armas, en la tabla de valores de partida.
  - `velocity` multiplica la velocidad y el alcance de los proyectiles (`bolt`, `lance`, `radial`, `homing`, `ricochet`, `drone`, `boomerang` y los fragmentos).
  - `pierce` suma a `bolt`, `lance` y `radial`.
  - `duration` multiplica `beam`, `cone` y `trail`.

- [ ] **Step 1: Tests que fallan.**
  - `beam`:
    - se fija en el más cercano dentro del alcance y daña todo lo que cruza su línea cada intervalo, sin repetir enemigo en el mismo intervalo;
    - si el objetivo muere, salta al siguiente;
    - dura `duration`.
  - `cone`: daña dentro del arco y del radio hacia `aim`, no detrás, y sigue a la sonda.
  - `radial`: `count` proyectiles repartidos en 360°, con perforación.
  - `homing`:
    - gira como mucho 240 °/s hacia el más cercano;
    - estalla en su radio al tocar;
    - caduca al agotar el alcance.
  - Los modificadores: `velocity` alarga el recorrido y `pierce` suma a las tres armas perforantes.
  - Con la piscina de disparos llena, disparar no lanza nada y no rompe.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project unit packages/sim/test/weapons.test.ts`. Expected: FAIL.
- [ ] **Step 3:** implementar.
  - La prueba de golpe del rayo es la distancia del punto al segmento, menor o igual que el ancho más el radio del enemigo.
  - Los misiles guardan su objetivo en `s.target` y lo cambian si muere.
- [ ] **Step 4:** PASS, también todo `packages/sim`.
- [ ] **Step 5: Commit** `feat(galaxy): rayo continuo, lanzallamas, esquirlas y misiles`.

### Task 3: Armas nuevas II (`mine`, `boomerang`, `field`, `strike`, `turret`)

**Files:** las mismas de la Tarea 2.

**Interfaces:**
- **Produces:**
  - `SHOT` gana `mine: 15`, `disc: 16`, `turret: 17`.
  - `AREA` gana `field: 8`, `strike: 9`.
  - Las áreas pueden tener efecto al caducar: el `strike` estalla al acabar su aviso.
  - `persistentFor(sim, probe, weaponIndex)` devuelve los disparos persistentes de un hueco, y lo usa la Tarea 5.

- [ ] **Step 1: Tests que fallan.**
  - `mine`:
    - no estalla antes de 0,5 s;
    - estalla cuando un enemigo entra en su radio de disparo y daña en el de estallido;
    - caduca sin nadie.
  - `boomerang`:
    - va hasta el alcance y vuelve a la sonda;
    - atraviesa todo;
    - no golpea al mismo enemigo dentro de su intervalo.
  - `field`:
    - aparece en el enemigo más cercano dentro del alcance;
    - atrae a los no jefes hacia el centro;
    - daña cada intervalo y dura `duration`.
  - `strike`: marca hasta `count` enemigos distintos visibles, no daña durante el aviso y daña en su radio al acabar.
  - `turret`:
    - se queda donde la sonda la deja;
    - dispara al más cercano con su cadencia;
    - con `count` torretas, la nueva sustituye a la más vieja;
    - dura `duration`.
  - Persistentes: si no caben todos, solo se reponen los que faltan (no se reinician cada tick), lo que corrige el menor 2 de M3a para `orbit`, `drone` y las cuchillas.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(galaxy): minas, disco, pozo gravitatorio, bombardeo y torreta`.

### Task 4: Barrera, maldición y potencia elemental

**Files:**
- Modify: `packages/sim/src/systems/{probes.ts,relics.ts,director.ts,pickups.ts,combat.ts,elements.ts}`.
- Test: `packages/sim/test/{stats,director,elements,relics}.test.ts`.

**Interfaces:**
- **Produces:**
  - `shieldCapacity(sim, probe): number`, que suma los escudos de reliquia y `barrier × maxHp`.
  - La recarga vive solo en `probes.ts`: tras `relics.families.shield.recharge` s sin daño para las reliquias, y tras 3 s para la barrera, a la velocidad de cada una.
  - `curseOf(sim): number`, la mayor de las sondas vivas.

- [ ] **Step 1: Tests que fallan.**
  - **Barrera:**
    - absorbe antes que la vida;
    - se recarga al 10 %/s tras 3 s sin daño;
    - se suma al escudo elíptico en la misma reserva, sin que la recarga de uno recorte al otro.
  - **Maldición:**
    - más grupos por segundo y más vivos, sin pasar nunca de `limits.enemies`;
    - con 2 sondas cuenta la mayor viva, y al morir esa, la siguiente;
    - las probabilidades de botín suben.
  - **Elemental:** sube la probabilidad de aplicar el elemento de las reliquias y alarga los cuatro estados.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(galaxy): barrera, señal de la Estática y potencia elemental`.

### Task 5: Evoluciones y especiales

**Files:**
- Modify: `packages/sim/src/{systems/upgrades.ts,systems/weapons.ts,types.ts,events.ts,snapshot.ts,content/default.ts}`.
- Test: `packages/sim/test/{upgrades,weapons,recording}.test.ts`.

**Interfaces:**
- **Consumes:** T1–T4.
- **Produces:**
  - `Offer.kind` gana `'evolve'` (`id` = la evolución, `level` 1).
  - `evolutionsFor(sim, probe): WeaponDef[]` devuelve las evoluciones disponibles en orden del contenido.
  - `applyOffer` sustituye el arma base en su hueco (`{ id: evo, level: 1, t: 0 }`).
  - Evento `{ t: 'evolve'; probe; from; to }`.
  - `HudSnapshot.weapons[i]` gana `evolved: boolean`.
  - Las 16 evoluciones van en `DEFAULT_CONTENT`.
  - Los especiales se aplican por arma: `split`, `echo` (cuenta atrás en `OwnedWeapon.echo`), `vortex`, `pierceAll` y `chain`.
  - `WeaponDef.element` va en todos los golpes del arma.

- [ ] **Step 1: Tests que fallan.**
  - La evolución se ofrece cuando toca:
    - solo con el arma al nivel máximo y el requisito cumplido (la pasiva a nivel 1 basta; el elemento cuenta si viene de una reliquia equipada);
    - siempre como primera carta, y nunca dos veces;
    - las evoluciones nunca salen como arma nueva.
  - Elegirla:
    - sustituye el arma en el mismo hueco;
    - los disparos persistentes del hueco (órbita, dron, torreta, rayo) se rehacen una vez, sin huérfanos;
    - emite `evolve`.
  - Cada especial:
    - `split` lanza 3 fragmentos al primer golpe, y solo una vez por disparo;
    - `echo` repite el disparo a los 9 ticks;
    - `vortex` atrae dentro de sus áreas;
    - `pierceAll` no se detiene;
    - `chain` salta a 2 vecinos al 50 %, y los saltos no vuelven a saltar.
  - El elemento propio de la evolución se aplica en cada golpe.
  - Repetición: una partida de bot con una evolución elegida a mitad, grabada y repetida, da el mismo hash, también con piscinas pequeñas (enemigos 25, disparos 12, áreas 4).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(galaxy): evoluciones de las armas`.

### Task 6: Reacciones entre elementos

**Files:**
- Create: `packages/sim/src/systems/reactions.ts`.
- Modify: `src/{world/pools.ts,systems/combat.ts,systems/elements.ts,systems/enemies.ts,systems/boss.ts,events.ts,summary.ts,content/default.ts}`.
- Test: `packages/sim/test/reactions.test.ts`.

**Interfaces:**
- **Produces:**
  - Campos de la piscina de enemigos: `mark` (código de elemento), `markT`, `reactT`, `stunT`, `vulnT` y `vulnBonus`.
  - `react(sim, e, element, dealt, x, y, src)`. Lo llama `dealDamage` después de `applyElement`. Dispara o marca.
  - Evento `{ t: 'reaction'; id; x; y }`. `{ t: 'element' }` sigue igual.
  - El aturdimiento detiene el movimiento, los ataques y las cuentas atrás del comportamiento. En el jefe congela sus patrones.
  - La vulnerabilidad entra en `damageFactor` y anula el frente blindado.
  - `stateHash` incluye los campos nuevos.
  - Las 11 reacciones van en `DEFAULT_CONTENT`.

- [ ] **Step 1: Tests que fallan.**
  - Un golpe con elemento marca 3 s.
  - Un segundo elemento con pareja reacciona y consume la marca. Sin pareja, sustituye la marca.
  - El mismo elemento renueva la marca.
  - Cada efecto, con una reacción de la tabla:
    - `chain` daña a N vecinos con su parte;
    - `explode` daña en su radio;
    - `shatter`:
      - sube el daño recibido y atraviesa el frente blindado;
      - una segunda no apila: queda la mayor y la más larga.
    - `stun`:
      - detiene a un enemigo normal;
      - al jefe lo detiene ×0,25 y congela sus patrones.
    - `spread` copia los estados a vecinos, nunca a jefes ni élites cuando es hackeo.
    - `drain` cura a la sonda.
  - El daño de una reacción no lleva elemento, así que nunca reacciona de nuevo; con 1 s de espera por enemigo.
  - `elemental` sube el daño de la reacción.
  - `prism` reacciona como el elemento al que se resuelve; `pure` e `invert` no reaccionan.
  - La repetición con reacciones da el mismo hash.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(galaxy): reacciones entre elementos`.

### Task 7: Conjuntos de reliquias

**Files:**
- Create: `packages/sim/src/systems/sets.ts`.
- Modify: `src/systems/relics.ts`, `src/index.ts`, `content/default.ts`.
- Test: `packages/sim/test/sets.test.ts`.

**Interfaces:**
- **Produces:**
  - `activeSets(relics: RelicInput[], content): ActiveSet[]`, con `ActiveSet { id; name; description; count: number; bonus: SetBonus; members: string[] }`. Es pura y la usan la simulación y el Hangar.
  - `possibleSets(relics, content): { id; name; needs: number }[]`, los conjuntos a los que les falta una reliquia, para el Hangar.
  - Los bonos entran por `relicBonuses` (estadísticas) y por `relicSkill`: magnitud ×`magnitude` para los miembros y bonus de fondo ×`background`.
  - Los 9 conjuntos van en `DEFAULT_CONTENT`.

- [ ] **Step 1: Tests que fallan.**
  - Cada clase de conjunto se activa con 2 reliquias, y con 3 sustituye a la de 2.
  - La combinación vale en la misma reliquia y entre dos distintas.
  - Rasgos desconocidos no activan nada.
  - El bonus de estadística llega a `deriveStats`; la magnitud del linaje sube solo en los miembros; el de mismo cielo multiplica el fondo.
  - Con 1 reliquia no hay conjuntos.
  - `possibleSets` dice qué falta.
  - Propiedad (fast-check): `activeSets` no depende del orden de las reliquias.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(galaxy): conjuntos de reliquias`.

### Task 8: Simulación de combinaciones (§8.6) y calibración

**Files:**
- Create: `packages/sim/test/builds.test.ts`.
- Modify: `packages/sim/test/calibration.test.ts`, `packages/sim/src/bot.ts` (el bot elige evoluciones con prioridad) y `content/default.ts` (ajustes).

**Interfaces:**
- **Produces:**
  - `botPick(offer)` prefiere `'evolve'`.
  - Un campo de pruebas (`proving(content, build, seconds)`) que mide el daño por segundo y la vida perdida de una combinación contra oleadas fijas.
  - La constante `BUILD_DPS_CEILING` de la prueba, fijada midiendo.

- [ ] **Step 1: Tests que fallan.**
  - **Corta, en el CI:**
    - 40 combinaciones al azar (armas, pasivas, evoluciones y 2 reliquias) más 6 extremas (las 6 evoluciones de más daño con `amplifier`, `overcharge` y `scope` al máximo y 2 Legendarias del mismo tipo y paleta);
    - 60 s cada una en el campo de pruebas;
    - ninguna supera `BUILD_DPS_CEILING` ni 40× la mediana;
    - ninguna rompe un tope.
  - **Larga** (`GALAXY_CALIBRATE=1`): 500 combinaciones en 3 min, más la calibración de M3a (el bot llega a la capa 2–4 en 5–20 min de media en 5 semillas) con evoluciones y reacciones disponibles.
- [ ] **Step 2:** medir primero las 46 combinaciones y fijar `BUILD_DPS_CEILING` en 1,5× la mayor de las extremas medidas tras el ajuste. Apuntarlo como *ruling* con la cifra.
- [ ] **Step 3:** si la calibración larga se sale del rango, ajustar `DEFAULT_CONTENT`. Cada cambio va al registro como *ruling*.
- [ ] **Step 4:** PASS en las dos.
- [ ] **Step 5: Commit** `test(galaxy): simulación de combinaciones del arsenal y calibración`.

### Task 9: Sprites e iconos

**Files:**
- Modify: `apps/web/src/arena/sprites/{items,icons,index}.ts`.
- Test: `apps/web/test/sprites.test.ts` y la hoja de sprites del navegador.

**Interfaces:**
- **Produces:**
  - Sprites:
    - `missile`, con 2 fotogramas y estela;
    - `shard`;
    - `split-shard`;
    - `mine`, que parpadea armada;
    - `disc`, que gira con 4 fotogramas;
    - `turret`, con 2 fotogramas y cañón;
    - `strike-mark`, una retícula de 2 fotogramas;
    - `stun-star`;
    - `mark-pip`, una gota blanca que se tiñe por elemento.
  - Iconos de 16 px: `icon-beam`, `icon-cone`, `icon-shards`, `icon-homing`, `icon-mine`, `icon-boomerang`, `icon-field`, `icon-strike` e `icon-turret`, más las 12 pasivas nuevas (`icon-plating`, …).
  - `evolvedIcon(id)`, que crea `icon-<arma>-evo` a partir del base con marco dorado y brillo, registrado para las 16.
  - Cada `WeaponDef` y `PassiveDef` de `DEFAULT_CONTENT` tiene su sprite registrado.

- [ ] **Step 1: Tests que fallan.**
  - Todo `icon` y todo sprite referido por `DEFAULT_CONTENT` existe en `SPRITES`.
  - Los iconos de evolución existen y difieren del base.
  - Ningún id nuevo pisa uno existente (la lección de `relic-ray`).
  - Paletas válidas y fotogramas del mismo tamaño.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** dibujar las rejillas, con luz arriba a la izquierda, contorno de 1 px y un tono propio por arma. Revisar la hoja en una captura (`VITE_ARENA_SHOTS=1`) contra el listón PokéBonk antes de seguir.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(galaxy): sprites e iconos del arsenal`.

### Task 10: El escenario dibuja el arsenal

**Files:**
- Modify: `apps/web/src/arena/stage/{stage,fx}.ts`.
- Test: `apps/web/test/fx.test.ts` y `apps/web/test/browser/arena.browser.test.ts` (capturas).

**Interfaces:**
- **Consumes:** `SHOT`, `AREA` y los eventos `reaction` y `evolve` (T2–T6).
- **Produces:**
  - El rayo es un `Graphics` de línea con núcleo blanco y halo del color del arma.
  - El cono es una cuña translúcida con lenguas.
  - El pozo es un remolino.
  - El bombardeo muestra la retícula durante el aviso y luego el estallido.
  - Las minas, el disco, los misiles y la torreta son sprites, con la rotación que toque.
  - **Reacciones:** etiqueta flotante con el nombre (BitmapText con letras y acentos) del color de la pareja y un destello. Con movimiento reducido, solo la etiqueta.
  - **Estados:** la marca es un punto del color del elemento sobre el enemigo; el aturdimiento son estrellas que giran; la vulnerabilidad es un contorno agrietado.
  - **Evolución:** anillo dorado en la sonda.
  - `fx` (puro) gana `reactionLabel(id) → { text, color }` y los colores por elemento.
  - Corrige el menor 4 de M3a: `BitmapFont.uninstall` en `destroy()`.

- [ ] **Step 1: Tests que fallan.**
  - `fx`: color y texto de cada reacción, y las etiquetas no se amontonan (como mucho 6 vivas, la más vieja se va).
  - Navegador: con una simulación de prueba que tiene las 9 armas nuevas y una reacción provocada, el escenario dibuja sin errores y hace capturas.
  - Crear y destruir el escenario dos veces no avisa de `gs-dmg`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. Revisar las capturas.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(galaxy): el escenario dibuja armas nuevas, reacciones y estados`.

### Task 11: Mejoras y HUD

**Files:**
- Modify: `apps/web/src/arena/hud/{LevelUp,Hud}.tsx`, `apps/web/src/arena/ArenaScreen.tsx`, `copy/es.ts` y `styles/app.css`.
- Test: `apps/web/test/arena.test.tsx`.

**Interfaces:**
- **Produces:**
  - La carta `'evolve'`:
    - borde y brillo dorados;
    - la etiqueta «Evolución»;
    - «Pulso láser → Tormenta de pulsos»;
    - la descripción y lo que requería.
  - En el kit del HUD, las armas evolucionadas llevan su icono dorado.
  - La región viva anuncia la evolución y la primera vez de cada reacción en la partida («Reacción: Cortocircuito»), sin inundar.
  - Corrige el menor 8 de M3a: la elección lee la oferta viva de la simulación, no la instantánea de 10 Hz.

- [ ] **Step 1: Tests que fallan.**
  - La carta de evolución aparece primera, con su estilo y su texto, y elegirla deja el arma evolucionada en el kit.
  - Un Enter rápido en dos subidas seguidas elige de la oferta que está en pantalla.
  - El anuncio de reacción sale una vez por reacción.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (ui-ux-pro-max antes del CSS; DESIGN_SYSTEM §8 quinquies ampliado). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(galaxy): carta de evolución y HUD del arsenal`.

### Task 12: Conjuntos en el Hangar

**Files:**
- Create: `apps/web/src/hangar/SetsPanel.tsx`.
- Modify: `HangarScreen.tsx`, `copy/es.ts` y `styles/app.css`.
- Test: `apps/web/test/hangar.test.tsx` y `apps/web/test/browser/hangar.browser.test.ts`.

**Interfaces:**
- **Consumes:** `activeSets` y `possibleSets` (T7) con `DEFAULT_CONTENT`, como el resto del Hangar (*ruling* de T15 de M3a).
- **Produces:**
  - Panel «Conjuntos» bajo las reliquias, con:
    - los activos, con su nombre, qué los activa y su bonus en palabras;
    - los posibles, en apagado con «con 3 reliquias» o «falta una galaxia …».
  - Si no hay ninguno, una línea que explica cómo se consiguen.
  - Corrige el menor 7 de M3a: un cambio de equipo rechazado (409) se dice junto a las ranuras.

- [ ] **Step 1: Tests que fallan.**
  - Con dos galaxias de la misma paleta sale «Resonancia cromática» con su bonus.
  - Con `spiral` + `satellite_galaxy` sale «Brazo satélite».
  - Sin coincidencias sale la explicación.
  - Un 409 al equipar se muestra.
  - Captura a 1280×720 y a 2560×1080.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(galaxy): conjuntos de reliquias en el Hangar`.

### Task 13: e2e, documentación, verificación final, PR y PRE

**Files:**
- Modify:
  - `apps/web/e2e/incursion.spec.ts` (el Hangar enseña el panel de conjuntos);
  - `docs/DESIGN_SYSTEM.md` (armas, evoluciones, reacciones, estados y conjuntos);
  - `docs/DEPLOY_PRE.md` (paso 6, qué comprobar de M3b-1).

- [ ] **Step 1:** actualizar el e2e y los documentos.
- [ ] **Step 2: Verificación completa:**
  - `pnpm -C games/galaxy typecheck`, `lint` y `test`;
  - `TZ=UTC pnpm test:unit` en la raíz;
  - todos los e2e de Galaxy;
  - build de la imagen Docker del juego.
- [ ] **Step 3:** revisión final de la rama completa por un revisor nuevo (opus) con este Review Focus; una pasada de correcciones con TDD.
- [ ] **Step 4:** PR a `develop`, CI en verde, fusionar y verificar en PRE:
  - una partida con una evolución forzada no es posible sin trucos, así que se comprueban la carta y las reacciones con una cuenta de prueba jugando unos minutos;
  - no hay violaciones de CSP.
- [ ] **Step 5:** registro copiado como `docs/superpowers/plans/2026-11-07-galaxy-m3b1-arsenal.ledger.md` y espacio de trabajo borrado.
