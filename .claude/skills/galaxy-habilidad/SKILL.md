---
name: galaxy-habilidad
description: Crear o cambiar una habilidad de las incursiones de Galaxy Survivor. Cubre armas nuevas (de un tipo que ya existe o de un comportamiento nuevo), evoluciones, variantes de nivel 4 y 8 de un arma inicial, pasivas, stats nuevas y retoques de daño, enfriamiento o niveles. Úsala cuando pidan «nueva arma», «nueva habilidad», «nueva mejora», «nueva pasiva», «evolución», «variante», «equilibrar armas» o «retocar el daño de», o new weapon, passive, upgrade, ability.
---

# Habilidad nueva de incursión

Las armas y pasivas son datos de `content` (`packages/sim/src/content/default.ts`). Su comportamiento (`kind`) es código. Antes de empezar, lee `games/galaxy/AGENTS.md` y la parte A de `games/galaxy/docs/CONTENIDO.md`. La tabla de todos los sitios que hay que tocar está en `referencia.md`, junto a esta skill. Las rutas son relativas a `games/galaxy/`.

**Dos casos.** Decide pronto en cuál estás, porque cambia casi todo lo demás:
- **A, solo datos:** un arma de un `kind` existente, o una pasiva de una stat existente. No sube `SIM_VERSION` y no lleva código de la arena. **Ojo:** en la arena se ve igual que las demás armas de su tipo (el sprite del disparo va por tipo); solo la distinguen el icono y el elemento.
- **B, código:** un `kind` nuevo o una stat nueva. Sube `SIM_VERSION`.

## 1. Pregunta primero al propietario

Antes de preguntar, **busca el nombre y el id** que tengas en mente en `default.ts`: hay 58 armas (21 base, 21 evoluciones, 16 variantes; el tope es 64) y 25 pasivas (una por stat; las de noviembre, `evasion`, `bossDamage`, `execute`, `knockback` y `movingDamage`, tienen tope por defecto en `caps`), y el esquema no impide nombres repetidos («Lanza de plasma» ya existe). **Queda sitio para 6 armas más:** antes de añadir, mira si hace falta subir el tope de 64.

Después, con AskUserQuestion (o preguntando con opciones, si no eres Claude), en una sola tanda:
- **Nombre y fantasía:** qué hace y cómo se ve. Propón nombres como opciones; el texto va en español, sin punto final.
- **Tipo:**
  - Un arma o pasiva que encaja en un tipo existente se queda en datos. Tipos de arma: `WEAPON_KINDS` en `content/types.ts`. Stats de pasiva: `STAT_KEYS`.
  - Una mecánica nueva es código y sube `SIM_VERSION`. Recomienda reutilizar un tipo cuando se pueda.
- **Evolución:** cada arma lleva una. Hay que decidir qué la activa (una pasiva o un elemento) y qué efecto especial tiene (`SPECIALS`). Cada `special` solo lo lee el código de ciertos tipos (`grep -n "special ===" packages/sim/src/systems`): `vortex` actúa en `nova`, el cono y la honda (`sling`); `pierceAll`, en `lance` y el arpón (`harpoon`); `split`, en los disparos que vuelan; `chain` y `echo`, en cualquier arma. Los tipos de noviembre (`harpoon`, `sling`, `decoy`, `lighthouse` y `mortar`) viven en `systems/arsenal-nov.ts`. **Una stat nueva** va en `STAT_KEYS` y en `LATE_STATS` (`content/types.ts`), con su tope en `caps`: así el contenido ya publicado sigue validando. Un `special` en un tipo que no lo lee no hace nada, sin dar error.
- **Variantes:** solo si es el arma inicial de una sonda (variantes de nivel 4 y 8).
- **Números de partida:** propón valores parecidos a un arma de su mismo papel y deja que los calibren los tests (paso 4).

Si algo no está claro, pregunta. No inventes el diseño.

## 2. Datos

Todo en `packages/sim/src/content/default.ts`:
1. **Arma:** un `WeaponDef` en `weapons`, con `levels({...})`. Da 5 niveles por defecto; para otro número, `levels({...}, n)` (de 1 a 8). Los campos que no use, a 0.
2. **Evolución:** un nivel (`levels({...}, 1)`), el mismo `kind`, `special`, `evolution: { from, requires: { passive } | { element } }` e icono `'<icono base>-evo'`.
3. **Variantes:** si es un arma inicial, filas en la tabla `VARIANTS` al final (`variantOf`, `VariantSpec`, `unlockAt: 4 | 8`).
4. **Pasiva:** `{ id, name, icon, description, stat, levels }` en `passives`. `levels` es el valor total en cada nivel.
5. **Orden del bot:** si quieres que juegue con ella, `WEAPON_ORDER`/`PASSIVE_ORDER` en `packages/sim/src/bot.ts`. Mueve las partidas de referencia y la calibración.

## 3. Código, solo si es un `kind` o una stat nueva

**Kind de arma nuevo:**
- en `content/types.ts`: `WEAPON_KINDS` (y `SPECIALS` si hace falta);
- en `content/schema.ts`: su forma, con `.default()` en todo campo nuevo dentro de un objeto existente;
- el disparo, en `systems/weapons.ts` (constantes `SHOT`/`AREA`, `RADIUS`, `fireOnce`; ahí se declara `weaponHooks`) o en `systems/arsenal.ts` (que rellena `weaponHooks`);
- `world/pools.ts` si cada disparo necesita estado propio;
- en la web:
  - `SHOT_SPRITE` en `apps/web/src/arena/stage/stage.ts`, donde el índice debe ser el valor de `SHOT`;
  - `ROTATES`, `drawShots` o `drawAreas`;
  - partículas en `fx.ts`;
  - el sprite del disparo en `arena/sprites/items.ts`.

**Stat nueva:** está en `referencia.md`, incluida la trampa de `caps`.

Ambos casos suben `SIM_VERSION` (`CONTENIDO.md` A3).

## 4. Arte

- **Icono de 12×12:** `ICONS['icon-<id>']` en `apps/web/src/arena/sprites/icons.ts`.
  - El arma base va además en la lista `EVOLVING`, que genera el icono dorado `-evo`.
  - Las variantes van en la tabla `VARIANTS` del mismo archivo (marca `twin|wide|chain|rapid`, o elemento).
- **Arte del Hangar** (solo armas iniciales y sus variantes): un pintor en `art/weapons/paint-weapons.lua`, que se ejecuta con el MCP de Aseprite o con el comando de `CONTENIDO.md` A6. Genera la tira de 128×32 en `apps/web/src/hangar/weapons/<id>.png`.
- Reglas de estilo en `docs/DESIGN_SYSTEM.md` §8 ter y §8 quater.

## 5. Tests (TDD: primero el que falla)

1. **El primer test que falla:**
   - Caso A: el recuento de `packages/sim/test/upgrades.test.ts` («16 armas y una evolución para cada una»), subido a 17 y 17, más un test de lo que la hace distinta (su evolución y lo que la activa) en `upgrades.test.ts` o `content.test.ts`.
   - Caso B: un `describe` nuevo en `packages/sim/test/weapons.test.ts` con la mecánica.
   - Míralo fallar antes de tocar `default.ts`.
2. **Los demás recuentos, solo si los cambias** (`CONTENIDO.md` A8): `content.test.ts` (20 pasivas, si añades una), `variants.test.ts` (16) y `weapon-art.test.ts` (24), si es un arma inicial con variantes. `apps/web/test/sprites.test.ts` no tiene recuento: comprueba que cada icono de `DEFAULT_CONTENT` existe.
3. **Equilibrio:** `calibration.test.ts` y `builds.test.ts`. Si se pasa de los topes, ajusta los números, no los topes.
4. **Partidas de referencia y semillas:** ejecuta `packages/sim/test` entero. `golden.test.ts` fallará (un arma nueva cambia las ofertas): pega los hashes nuevos. Caso A: sin subir `SIM_VERSION`. Caso B: súbela (`CONTENIDO.md` A3). Otros tests con semillas, como `recording.test.ts`, pueden moverse también.
5. **Dibujo (solo caso B):** en «dibuja el arsenal» (`apps/web/test/browser/arena.browser.test.ts`), cambia una de las armas de las listas `p.weapons` por la tuya (tienen 6, el máximo de armas a la vez). En el caso A no aporta nada: su dibujo es el de su tipo.

Comandos:
```
pnpm -C games/galaxy exec vitest run --project unit packages/sim/test
pnpm -C games/galaxy exec vitest run --project web apps/web/test/sprites.test.ts apps/web/test/weapon-art.test.ts
VITE_ARENA_SHOTS=1 pnpm -C games/galaxy exec vitest run --project browser apps/web/test/browser/arena.browser.test.ts -t "arsenal"
pnpm -C games/galaxy typecheck && pnpm -C games/galaxy lint
```
(Git Bash. En PowerShell: `$env:VITE_ARENA_SHOTS=1; pnpm …`.)

## 6. Verificación

- **Mira las capturas** de `apps/web/test/browser/__shots__/arsenal-*.png` (caso B): el disparo se ve y contrasta con el fondo. En los dos casos, el icono se lee en `sprites.png`.
- **Comprueba la carta de mejora:** el nombre y la descripción (sin punto final). La carta de evolución dice «Evoluciona tu <arma>» y la descripción de la evolución; no muestra qué la activa, así que la descripción puede decirlo.
- **Si subiste `SIM_VERSION`**, añade la entrada en `docs/DEPLOY_PRE.md`.

## 7. Entrega y publicación

1. Rama `feature/galaxy-<arma>` desde `develop`, commits `feat(galaxy): …`, PR con «Qué cambia» y «Pruebas». CI en verde, merge y despliegue en PRE.
2. **En PRE, `content` está publicado:** el arma no aparece hasta que se vuelva a publicar (`CONTENIDO.md` A4). Con el código ya desplegado:
   1. En una rama nueva desde `develop`, crea `ops/launch/<aaaa-mm-dd>-<arma>/` (fecha de publicación, minúsculas y guiones).
   2. Arma el borrador desde lo vivo con la CLI de PRE (acceso en `docs/DEPLOY_PRE.md`; si no puedes llegar a PRE, para y pídele al propietario la salida):
      ```
      ssh <PRE> "docker exec elclub-pre-galaxy-1 node dist/cli.js draft-config content weapons" > ops/launch/<carpeta>/content.json
      ```
      Añade `,passives` si añadiste una pasiva, y `--ids <id>,<id-evo>` si solo quieres esas entradas. Nunca lo escribas a mano ni lo copies de `DEFAULT_CONTENT`.
   3. Añade el `LEEME.md` de la carpeta.
   4. Pasa `launch-config.test.ts` y sube la carpeta en un PR pequeño.
3. Usa la skill `galaxy-publicar-config`, que comprueba con `check-config` y pide el OK del propietario antes de publicar.
