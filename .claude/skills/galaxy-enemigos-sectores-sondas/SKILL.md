---
name: galaxy-enemigos-sectores-sondas
description: Crear o cambiar la fauna y los escenarios de las incursiones de Galaxy Survivor. Cubre enemigos (con un comportamiento existente o nuevo), élites, Núcleos (jefes con fases y patrones), sectores (dificultad, oleadas, botín, desbloqueo), biomas, anomalías y sondas jugables (con sus variantes, rasgo y condición de desbloqueo). Úsala cuando pidan «nuevo enemigo», «nueva criatura», «nuevo jefe», «nuevo Núcleo», «nuevo sector», «nuevo bioma», «nueva sonda», «nueva nave», «oleadas», «dificultad de un sector» o «anomalía», o new enemy, boss, sector, biome, probe.
---

# Enemigos, Núcleos, sectores, biomas y sondas

Son datos de `content` (`packages/sim/src/content/default.ts`): `enemies`, `bosses`, `sectors`, `anomalies` y `probes`. Los comportamientos (`behavior`, patrones de jefe, `quirk`) son código.

Antes de empezar, lee:
- `games/galaxy/AGENTS.md`;
- la parte A de `games/galaxy/docs/CONTENIDO.md`;
- en el GDD, la sección del tipo que vayas a crear.

Cada sitio que hay que tocar, por tipo, está en `referencia.md`.

Las rutas son relativas a `games/galaxy/`.

## 1. Pregunta primero al propietario

Antes, **busca el nombre y el id** que tengas en mente en `default.ts` y en `docs/LORE.md`: el esquema no impide nombres repetidos.

Después, con AskUserQuestion (o preguntando con opciones, si no eres Claude):
- **Nombre y fantasía**, y si encaja en la lore (`docs/LORE.md`). Propón nombres como opciones.
- **Comportamiento:**
  - un `behavior`, patrón o `quirk` existente se queda en datos;
  - uno nuevo es código y sube `SIM_VERSION`.
  - Recomienda reutilizar cuando se pueda.
- **Dónde aparece:**
  - Enemigo: en qué sectores, desde qué minuto y con qué peso.
  - Núcleo: qué sector lo usa, como `boss` o `deepBoss`.
  - Sector: su lugar en la curva de dificultad y cómo se desbloquea (clave viva `sectors`).
  - Sonda: cómo se desbloquea (clave viva `probes`) y si debe ser una de las tres del test de personalidad.
- **Textos del Códice y de la radio de PERKINS:** propón una primera versión en español.

## 2. Pasos por tipo

**Enemigo:**
1. En `enemies`: `family` de `ENEMY_FAMILIES`, `behavior` y `split` opcional.
2. En los sectores: entradas en `spawns` (`from`, `weight`, `group`) y/o `waves`.
3. Sprite en `apps/web/src/arena/sprites/fauna2.ts` (`FAUNA2`, 2 fotogramas o más).
4. `BEAST_TEXT[id]` en `apps/web/src/codex/entries.ts`. Es obligatorio: sin él no sale en el bestiario.
5. **Si el comportamiento es nuevo:**
   - `Behavior` en `types.ts`, la unión en `schema.ts` y el `switch` de `systems/enemies.ts`;
   - si se avisa antes de atacar, un `telegraph` en `events.ts`, `stage/warnings.ts` y `drawWarnings`;
   - el consejo `FIGHT[kind]` en `entries.ts`;
   - sube `SIM_VERSION`.

**Élite:** sus ids son un enum fijo del esquema (`shielded | swift | volatile`). Uno nuevo es código: `EliteDef`, `ELITE_CODE` en `enemies.ts` y `combat.ts`. Sube `SIM_VERSION`.

**Núcleo:**
1. En `bosses`: fases con `below` que empiecen en 1 y bajen, patrones existentes y `scaling`. Hay 11 tipos de patrón: `radial`, `aimed`, `spiral`, `summon`, `charge`, `wall`, `mines`, `blink` y, desde noviembre, `laser` (un rayo avisado que barre), `closing` (un anillo que se cierra sobre la sonda, con un hueco de al menos 20°) y `barrage` (círculos en fila hacia la sonda que estallan uno tras otro).
   - **Formas por capa (noviembre):** un sector rota sus Núcleos con `bossCycle: [forma1, forma2, forma3]`. `bossCycle[0]` debe ser `boss`. Las capas del Núcleo profundo no cuentan. El Núcleo profundo rota con `deepBoss.cycle`, según las veces que ha salido. Sin estos campos, se usa siempre `boss`, como antes. La elección está en `bossIdAt()` (`systems/boss.ts`). Cada forma nueva lleva su sprite (`apps/web/src/arena/sprites/forms.ts`), su texto en el Códice y su frase de radio.
2. Sprite de 40×40 y 2 fotogramas en `arena/sprites/bosses.ts` (`core(fn, fps)`).
3. `CORE_TEXT` en `entries.ts` y la frase de PERKINS en `copy.arena.radio.bosses[id]` (`es.ts`).
4. **Patrón nuevo:** `BossPattern`, la unión en `schema.ts`, `systems/boss.ts` y los avisos. Sube `SIM_VERSION`.

**Sector:**
1. En `sectors`: `{ ...SECTOR_BASE, id, name, description, biome, boss, deepBoss, season, enemyHp, enemyDamage, coreDamage, spawns, waves, drops }`.
   - `enemyHp` tiene que crecer en el orden de la lista; el de temporada es el más duro, con ×1,35 como mucho.
   - `coreDamage` (el daño de sus Núcleos) también crece en el orden de la lista y el de temporada es el mayor. `enemyDamage` es solo de la fauna y se ajusta junto con su `scaling`.
   - Mide la curva con el bot: `GALAXY_CALIBRATE=1 GALAXY_SECTOR=<id> pnpm -C games/galaxy exec vitest run --project unit packages/sim/test/difficulty.test.ts`. Cada sector dura entre un 2 % y un 30 % menos que el anterior.
2. Clave viva `sectors` (`packages/shared/src/config/registry.ts`): condición en `unlocks` (o `season`, para el sector de temporada).
3. `SECTOR_TEXT` en `entries.ts` y la frase de PERKINS en `copy.arena.radio.sectors[id]`.

**Bioma** (solo aspecto, no toca la simulación):
- `BIOMES` en `types.ts`;
- `BIOME_LOOK` en `apps/web/src/arena/stage/biomes.ts`;
- rocas `<prefijo>-1..3` en `sprites/decor.ts`;
- objetos rompibles en `sprites/props.ts`;
- su prefijo en `apps/web/test/terrain.test.ts`.

**Anomalía:**
- Con los multiplicadores existentes, entrada en `anomalies` (≤20, multiplicadores 0,25–4, descripción ≤160). Se activa con `season.anomaly`: ver la skill `galaxy-temporada`.
- Una mecánica nueva es un campo con `.default()` y código en `systems/director.ts` o `combat.ts`. Sube `SIM_VERSION`.

**Sonda:**
1. En `probes`: `{ id, name, sprite: 'probe-<id>', description, hp, speed, pickup, armor, regen, weapon, bonus, quirk }`.
2. Sprite de 16×16 y 2 fotogramas en `arena/sprites/probes.ts`. Las 8 direcciones se generan solas (`turnedProbe`).
3. Su arma inicial necesita variantes 4 y 8 y arte del Hangar: ver `galaxy-habilidad`.
4. Clave viva `probes`: `unlocks[id] = { stat, value }`, con `stat` entre `runs, bossKills, maxDepth, extractions, kills`. Sin ella, la sonda no se puede conseguir.
5. **Rasgo propio nuevo:** `Quirk`, `schema.ts`, `systems/quirks.ts` y `copy.probeTest.quirks[kind]`. Sube `SIM_VERSION`.
6. **Solo si va en el test de personalidad:** `STARTERS`, `PROBE_TEST` y `scoreTest` (`packages/shared/src/probes/test.ts`), y los perfiles en `es.ts`.

## 3. Tests (TDD: primero el que falla)

1. **El test de la mecánica primero:** `behaviors.test.ts`, `enemies.test.ts`, `boss.test.ts`, `quirks.test.ts` o `anomalies.test.ts`.
2. **Recuentos fijos** (`CONTENIDO.md` A8):
   - 25 enemigos y listas de Núcleos, sectores, biomas y sondas en `content.test.ts`;
   - `sprites.test.ts`;
   - `sector-difficulty.test.ts`;
   - de integración: `hangar.test.ts`, `probes.test.ts` y `sectors.test.ts` (los pasa CI).
3. **Calibración** (`calibration.test.ts` juega todos los sectores: «paga lo mismo ±15 %», capas 2–4) y **partidas de referencia** (juegan los sectores 0 y 2 y las sondas 0 a 3, así que se mueven a menudo).

Comandos:
```
pnpm -C games/galaxy exec vitest run --project unit packages/sim/test
pnpm -C games/galaxy exec vitest run --project web apps/web/test/sprites.test.ts apps/web/test/terrain.test.ts apps/web/test/codex.test.ts
VITE_ARENA_SHOTS=1 pnpm -C games/galaxy exec vitest run --project browser apps/web/test/browser/arena.browser.test.ts
pnpm -C games/galaxy typecheck && pnpm -C games/galaxy lint
```

## 4. Verificación

- **Capturas** `__shots__/biome-<sector>.png` y `sprites.png`: el enemigo se distingue del fondo, el aviso de ataque se ve y el Núcleo impone.
- **Códice:** la especie, el Núcleo o el sector aparecen con su texto.
- **Si subiste `SIM_VERSION`**, añade la entrada en `docs/DEPLOY_PRE.md`.

## 5. Entrega y publicación

1. Rama `feature/galaxy-<slug>` desde `develop`, PR, CI en verde, merge y despliegue en PRE. El arte tiene que estar desplegado antes de publicar el contenido que lo usa.
2. Con el código desplegado, en una rama nueva, crea `ops/launch/<aaaa-mm-dd>-<slug>/` con lo que cambie:
   - `content.json`, armado desde lo vivo por la CLI de PRE: `ssh <PRE> "docker exec elclub-pre-galaxy-1 node dist/cli.js draft-config content enemies,bosses,sectors" > …/content.json` (los campos que toquen: `enemies`, `bosses`, `sectors`, `anomalies`, `probes`; cada entrada nueva queda en su sitio, tras la que la precede en el código, lo que importa en `sectors`);
   - `sectors.json` y/o `probes.json`, si hay desbloqueos (`show-config <clave> --data` más tu condición);
   - su `LEEME.md`.
   Si no puedes llegar a PRE, para y pide al propietario la salida de esos comandos.
3. Pasa `launch-config.test.ts`.
4. Usa la skill `galaxy-publicar-config`, que pide el OK del propietario.
