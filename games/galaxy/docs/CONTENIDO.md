# Guía de contenido

Cómo se añade y se cambia el contenido de Galaxy Survivor sin romper nada:
- **Contenido de incursión** (parte A): armas, pasivas, reliquias, enemigos, Núcleos, sectores, sondas y anomalías.
- **Operación en vivo** (parte B): temporadas, eventos, escáneres, potenciadores, misiones y logros.
- **Entrega y publicación** (parte C).

Es la referencia común de las skills `.claude/skills/galaxy-*`. Las skills dicen los pasos de cada tipo de contenido; aquí están las reglas que valen para todos. Vale igual para cualquier IA o persona: si no usas skills, sigue esta guía y las tablas de `referencia.md` de cada skill.

Rutas relativas a `games/galaxy/`.

---

## A. Contenido de incursión

El contenido de las incursiones es la clave de configuración `content`. Su valor por defecto es `DEFAULT_CONTENT` (`packages/sim/src/content/default.ts`). Su forma la fija `contentSchema` (`packages/sim/src/content/schema.ts`), y sus tipos, `packages/sim/src/content/types.ts`.

### A1. Los comportamientos son código; los números, datos

- **Una entrada de un tipo que ya existe** se queda en datos: un arma de un `kind` existente, un enemigo con un `behavior` existente, un Núcleo con patrones existentes o un conjunto de reliquias `same`/`combo`. Solo toca `default.ts` y su arte.
- **Un comportamiento nuevo** es código: un `kind` de arma, un `behavior` de enemigo, un patrón de jefe, un `quirk` de sonda, un efecto de reacción o una mecánica de anomalía. Toca:
  - `types.ts` y `schema.ts`;
  - el sistema que lo ejecuta (`packages/sim/src/systems/*`);
  - el dibujo (`apps/web/src/arena/stage/*`);
  - y casi siempre `SIM_VERSION` (A3).

### A2. Tipos, esquema y datos se mueven juntos

- **Coherencia:** `_sameAsContent`, al final de `schema.ts`, hace fallar `typecheck` si el esquema y `Content` se separan.
- **Esquemas estrictos:** todos son `.strict()`, así que un campo desconocido es un error.
- **Referencias cruzadas:** `contentSchema.superRefine` comprueba ids y referencias (`content_ref`, `content_dup`, `content_evolution`, `content_variant`, `content_phases`, `content_reaction`, `content_set`).
- **Nombres:** el esquema solo comprueba que los ids no se repitan; los nombres, no. Antes de proponer uno, búscalo (nombre e id) en `default.ts`: «Lanza de plasma», por ejemplo, ya existe.
- **Simulación determinista:** en `packages/sim/src` no se usa `Math.random`, `Date`, `performance`, trigonometría nativa ni `**`. ESLint lo prohíbe; usa `packages/sim/src/math`.
- **Azar:** cada sistema saca números de su propio flujo (`sim.rng.{spawn,combat,loot,offer,ai,relic}`). No mezcles flujos.

### A3. `SIM_VERSION` y las partidas de referencia

**Cuándo subir `SIM_VERSION`** (`packages/sim/src/version.ts`, hoy `1.8.0`): cuando el **código** hace que el mismo contenido, con la misma semilla y las mismas entradas, juegue distinto. Si no se sube, se rompen las repeticiones y el modo en grupo, que va en paralelo entre navegadores.

| Cambio | `SIM_VERSION` | Partidas de referencia |
|---|---|---|
| Solo datos de `DEFAULT_CONTENT` (un arma de un tipo existente, un enemigo, un retoque) | No: cada partida guarda su `content_version` y la repetición carga esa versión | Se mueven si tocan lo que juegan: pega los hashes nuevos y dilo en el commit |
| Código que cambia cómo juega algo (un tipo de arma, un comportamiento, una fórmula) | Sí | Pega los hashes nuevos |
| Código nuevo que solo alcanzan datos nuevos (por ejemplo, un tipo de conjunto) | No, si el contenido viejo juega igual | Normalmente no se mueven |

**Las partidas de referencia:**
- `GOLDEN_RUNS` (`packages/sim/test/golden-runs.ts`) juegan `DEFAULT_CONTENT` con el bot. Las comprueban `packages/sim/test/golden.test.ts` (Node) y `packages/sim/test/browser/determinism.browser.test.ts`.
- Cuando se mueven, el test falla y muestra los hashes nuevos: cópialos en `golden-runs.ts`.

**Qué las mueve:**
- añadir un arma o una pasiva, porque cambian las ofertas de `offerFor`;
- cambiar las apariciones de los sectores 0 o 2;
- tocar las sondas 0 a 3;
- tocar el orden del bot (`WEAPON_ORDER`, `PASSIVE_ORDER` en `bot.ts`).

**Otros tests que dependen de semillas** también pueden moverse con los mismos cambios (por ejemplo `recording.test.ts` y la calibración corta): ejecuta siempre `packages/sim/test` entero.

**Al subir `SIM_VERSION`**, añade una entrada en `docs/DEPLOY_PRE.md`: los clientes con la versión anterior en caché tienen que recargar.

### A4. Lo publicado manda

En PRE `content` está publicado (también los cambios a mano del propietario desde el panel, como las probabilidades de botín). Por eso:
- **Lo nuevo no llega solo.** Una entrada nueva en una lista (`weapons`, `enemies`, `sectors`, `relics.sets`…) añadida a `DEFAULT_CONTENT` no llega a PRE hasta que se vuelve a publicar ese campo.
- **Los campos nuevos llevan `.default()`.** Un campo nuevo dentro de un objeto existente debe tener `.default(x)` en el esquema, con el mismo `x` en `DEFAULT_CONTENT`. Así el contenido publicado antes sigue valiendo y lo recibe al leerse.
  - Ejemplos: `magnet` y `eliteMagnet` en `drops`, `enemyHp`, `enemyDamage`, `relics.stacking`.
  - Si el contenido publicado deja de validar, el servidor sirve entero `DEFAULT_CONTENT` en silencio y se pierden los cambios del propietario.
  - **Trampa:** `caps` es un `z.record(z.enum(STAT_KEYS), …)` exhaustivo. Añadir una stat sin cuidarlo invalida todo lo publicado.
- **Primero se despliega, después se publica.** El esquema es estricto: publicar un campo que el servidor desplegado no conoce da `config_invalid`. El orden es merge, despliegue de PRE y publicación.
- **Se publican campos de primer nivel enteros, partiendo de lo vivo.** Publicar `{ "weapons": [...] }` sustituye toda la lista y deja igual el resto de `content`. Nunca se hace con `DEFAULT_CONTENT` a ciegas, que borraría lo que el propietario cambió en el panel. El borrador lo arma la CLI en PRE, ya desplegado el código:
  ```
  ssh <PRE> "docker exec elclub-pre-galaxy-1 node dist/cli.js draft-config content weapons,passives" > content.json
  ```
  `draft-config` toma cada campo tal como está publicado y le añade las entradas del código que le faltan (o, con `--ids a,b`, solo esas, añadidas o sustituyendo a las vivas). Un campo que no es una lista con ids (como `relics` o `drops`) lo toma entero del código: revisa con `check-config` qué cambia (B2).
- **Las entradas antiguas de `DEPLOY_PRE.md`** que dicen «vuelve a publicarla desde el valor por defecto» son de antes de que el propietario editara `content` en el panel. Hoy manda esta regla.
- **Se deja constancia** en el `LEEME.md` de la carpeta de `ops/launch/` (C).

### A5. Lo que la web lee de `DEFAULT_CONTENT` y no de lo publicado

Estas pantallas usan el contenido incluido en la web, no el vivo:
- el Hangar de reliquias (`hangar/lobby/RelicStrip.tsx`, `hangar/SetsPanel.tsx`): «Potencia ×», conjuntos y apilado;
- el Códice (`codex/entries.ts`);
- los sprites de sonda de la clasificación (`social/LeaderboardScreen.tsx`);
- algunas listas del admin.

Por eso **todo cambio de contenido se hace en `DEFAULT_CONTENT` y además se publica**. Si solo se publica, esas pantallas mienten.

### A6. Arte

- **El sprite va antes que el contenido.** La arena dibuja lo que manda el servidor: `atlas.frames[id]!` revienta si falta el sprite. El arte debe estar desplegado antes o a la vez que el contenido que lo usa; `apps/web/test/sprites.test.ts` lo comprueba para `DEFAULT_CONTENT`.
- **Sprites de la arena:** rejillas pintadas en código (`apps/web/src/arena/sprites/*`).
  - Paleta `P`, contorno de 1 px `#0b0c24`, luz desde arriba a la izquierda.
  - Reglas en `docs/DESIGN_SYSTEM.md` §8 quater.
  - Iconos de 12×12 en `icons.ts`; las evoluciones derivan su icono dorado `-evo`.
- **Arte más rico, con el MCP de Aseprite** (`art/<tema>/paint-*.lua`). Por ejemplo, las armas del Hangar:
  ```
  aseprite -b --script-param out=art/weapons --script-param web=apps/web/src/hangar/weapons --script art/weapons/paint-weapons.lua [--script-param only=<id>]
  ```
- **Revisa el resultado** con capturas: `VITE_ARENA_SHOTS=1` en `apps/web/test/browser/arena.browser.test.ts` guarda `__shots__/` (arsenal, biomas, sprites).

### A7. Textos

- **Estilo:** español, de tú, frases cortas, títulos sin punto final y sin `· : — → //`. Números con `fmt` (es-ES).
  - Fuente: `docs/DESIGN_SYSTEM.md` §9 y `apps/web/src/copy/es.ts`.
  - Los títulos importantes se le proponen al propietario como pregunta de opciones.
- **Nombres y descripciones** de armas, pasivas, enemigos y sectores viven en el propio contenido, en español.
- **Textos fijos que hay que tocar a mano:**
  - Códice: `BEAST_TEXT`, `CORE_TEXT` y `SECTOR_TEXT` en `codex/entries.ts`. Una especie sin `BEAST_TEXT` no sale en el bestiario.
  - Radio de PERKINS: `copy.arena.radio.sectors[id]` y `radio.bosses[id]` en `es.ts`.
  - Mapas `satisfies Record<…>` de `es.ts` (familias, elementos, fenómenos, rasgos de sonda): `typecheck` obliga a añadir el id nuevo.
- **Números escritos en textos:** si cambias el valor, cambia también el texto.
  - Ejemplos: `copy.hangar.stacking` («Desde la tercera… la mitad»), el GDD (§8.2, §8.4 bis) y `DESIGN_SYSTEM.md`.
- **Nunca escribas en un texto un valor que el admin puede cambiar:** lo manda el servidor.

### A8. Tests con recuentos fijos

Al añadir una entrada, actualiza estos números en el mismo commit:

| Test | Qué fija |
|---|---|
| `packages/sim/test/upgrades.test.ts` | 21 armas, cada una con su evolución (y las cinco de noviembre con su pasiva) |
| `packages/sim/test/content.test.ts` | 20 pasivas, 25 enemigos, listas de sondas, Núcleos, sectores y biomas |
| `packages/sim/test/variants.test.ts` | 16 variantes, en los niveles 4 y 8 de cada arma inicial |
| `apps/web/test/weapon-art.test.ts` | 24 tiras de arte del Hangar |
| `packages/sim/test/anomalies.test.ts`, `quirks.test.ts` | listas exactas de ids |
| `apps/web/test/sprites.test.ts` | listas de sprites: `engine`, `M3B3_CORES`, `M3B3_ROCKS` |
| `apps/server/test/integration/hangar.test.ts`, `probes.test.ts`, `sectors.test.ts` | 8 sondas, 5 sectores, fauna de la Nebulosa Exterior |
| `packages/sim/test/sector-difficulty.test.ts` | `enemyHp` crece por orden de sector; el de temporada es el más duro; como mucho ×1,35 |

### A9. Rasgos de galaxia y `ENGINE_VERSION`

**Dónde se definen los rasgos:**
- La fuente es `packages/engine/config/traits.yaml`: tipo, brazos, tamaño, núcleo, densidad, inclinación, paleta, fondo y fenómeno.
- Tras cambiarlo, `pnpm -C packages/engine gen:config` regenera `src/config/generated.ts`.
- `ENGINE_VERSION` (`1.0.0`) y los goldens de `packages/engine/test/golden/v1` congelan qué rasgos da cada semilla.

**Lo que no se valida contra el motor:** las claves de factores de reliquia (`size`, `core`, `density`), los fondos, las paletas, los conjuntos `combo` y la `featured` de un escáner son cadenas libres.
- Una errata no da error, simplemente no hace nada (o, en una destacada, hace fallar la tirada).
- Copia los valores de `traits.yaml` y respeta sus reglas `forbid`/`force`: por ejemplo, merger no puede tener satellite_galaxy, una enana no puede tener einstein_ring y antimatter fuerza deep_void.

**Para y pregunta al propietario:** un valor de rasgo nuevo (fenómeno, fondo, tipo, paleta) cambia las galaxias que los jugadores ya tienen.
- Necesita `ENGINE_VERSION` 2 y es una decisión [U] del GDD (§8.2).
- No se implementa desde una skill: se escribe una propuesta.

### A10. Equilibrio

- **Topes del GDD (§8.6)**, comprobados en CI:
  - `packages/sim/test/calibration.test.ts`: ninguna combinación al azar por encima de 8 veces la mediana, extremos de 40 veces como mucho y los topes respetados;
  - `builds.test.ts` (`BUILD_DPS_CEILING`).
- **Calibración larga:** `GALAXY_CALIBRATE=1`, para cambios grandes.
- **Partida de referencia:** el bot de `packages/sim/src/bot.ts` juega las de referencia y la calibración; los ids desconocidos van al final de su orden.

---

## B. Operación en vivo

### B1. Claves y cómo se publican

**El registro:**
- Está en `packages/shared/src/config/registry.ts`: `configSchemas`, `mergeDraft`, `configIssues`, `parseConfig`.
- Una versión publicada sustituye los valores por defecto. La versión 0 son los valores por defecto del esquema.

**Cómo se mezcla un borrador** (`mergeDraft`): `{ ...lo vivo, ...borrador }`, solo en el primer nivel.
- Un campo que mandas sustituye entero al vivo; uno que no mandas se queda como está.
- Por eso las listas se mandan completas: `events.list` y `gacha.banners` (que siempre lleva `deep-scan`).

**Dónde se publica:**
- **En el panel** (`/admin/configuracion/<clave>`): pide admin con TOTP, contraseña y motivo, y comprueba `baseVersion` (409 si alguien publicó antes).
  - Los eventos tienen su asistente: `/admin/eventos/nuevo`, y `?desde=<id>` para duplicar uno. Publica a la vez el evento y su escáner.
- **Con la CLI del contenedor:** se publica clave a clave, sin comprobar `baseVersion`.
  - `show-config <clave> [--data]`: lo vivo, solo lectura (con `--data`, solo los datos).
  - `draft-config <clave> <campo[,campo…]> [--ids id,id…]`: un borrador que parte de lo vivo (A4), solo lectura.
  - `check-config <lote.json | ->`: comprueba una carpeta entera sobre lo vivo, clave a clave y entre claves (B2), sin publicar.
  - `publish-config <clave> <archivo|-> --dry-run`: valida una clave sobre lo vivo y dice qué cambiaría; no publica.
  - `publish-config <clave> <archivo|-> --reason "<motivo>"`: publica y queda auditado como `cli`.
  - `notice "<texto>" --tone info|warning --days N --reason "<motivo>"`: aviso en la pantalla de título, **desde ahora** y durante N días (1–365). Para programar un aviso o terminarlo antes, el panel (Admin › Comunicación).
  - Comandos exactos para PRE en `docs/DEPLOY_PRE.md` (sección Operación). Están escritos para Git Bash: en PowerShell, `<` no existe y `>` guarda con BOM, que rompe el JSON.

### B2. Carpetas `ops/launch` y plantillas

**`ops/launch/<aaaa-mm-dd>[-slug]/`:**
- Una carpeta por publicación. La fecha es la del día en que se publica; el nombre, en minúsculas, con dígitos y guiones (el test falla si no).
- Un archivo por clave (`<clave>.json`), con solo los campos de primer nivel que sustituye.
- Un `LEEME.md` con el motivo, el orden, lo que debe estar desplegado antes y las versiones que quedan tras publicar.
- Una carpeta `antes/` con los datos vivos guardados justo antes de publicar (para volver atrás; el test no la lee).
- Las copias de lo vivo que leas para preparar el borrador (`*.vivo.json`) van **fuera del repositorio**, en una carpeta temporal: dentro de la carpeta de lanzamiento el test las rechaza.

**`ops/plantillas/evento/` y `ops/plantillas/temporada/`:** borradores de ejemplo para empezar.

**`packages/shared/test/launch-config.test.ts` comprueba todas las carpetas:**
- Las aplica en orden, como el servidor.
- Cada archivo debe ser una clave y valer sobre lo anterior.
- Los eventos en curso que pagan señales tienen su escáner, con sus mismas fechas, y todos caben en la temporada.
- Las fechas de la temporada y de los eventos que trae la carpeta caen a medianoche de Madrid.
- Las destacadas pueden salir legendarias.
- El escáner profundo sigue y los ids de misión no se repiten.
- La anomalía existe.

Ejecútalo con:
```
pnpm -C games/galaxy exec vitest run --project unit packages/shared/test/launch-config.test.ts
```

**Ojo:** el test reconstruye lo vivo a partir de las carpetas, pero los cambios hechos a mano desde el panel no están en ellas. Lo que manda antes de publicar es `check-config` contra lo vivo de verdad, que hace las mismas comprobaciones (`packages/shared/src/config/ops-checks.ts`, `opsProblems`):
```
node games/galaxy/scripts/ops-bundle.mjs games/galaxy/ops/launch/<carpeta> | ssh <PRE> "docker exec -i elclub-pre-galaxy-1 node dist/cli.js check-config -"
```
Dice, por clave, la versión viva y la que quedaría y qué cambia (en las listas, qué ids entran `+`, salen `-` o cambian `~`), y al final si todo se sostiene. **Un `-` inesperado es una parada:** el borrador no partía de lo vivo y borraría algo.

### B3. Orden de publicación

Es `PUBLISH_ORDER` en `packages/shared/src/config/drafts.ts`:

1. `content`
2. `sectors` / `probes` / `relics`, si cambian
3. `season`
4. `lab`, si cambia (el núcleo de temporada, `lab.season`, sale con su temporada)
5. `seasonRoute`
6. `missions`
7. `achievements`
8. `boosts`
9. `events`
10. `gacha`
11. el aviso

**Por qué este orden:**
- **`season` antes que `seasonRoute`:** un id de temporada nuevo archiva la anterior con los premios de la ruta que esté viva en ese momento.
- **`events` antes que `gacha`:** el escáner de evento se paga con las señales del evento. Con la CLI no es atómico; el panel publica las dos juntas. Si falla `gacha` después de publicar `events`, hay un evento que paga señales sin escáner: arréglalo y publica `gacha` enseguida, o vuelve a publicar `antes/events.json` (con el OK del propietario).
- **Con margen:** publica antes del `startsAt` de lo que lanzas, nunca justo encima.

### B4. Ids permanentes

Un id nunca se reutiliza ni cambia de significado:
- **Eventos:** su progreso es `e:<id>`; reutilizar un id reutiliza progreso y reclamaciones.
- **Logros:** progreso de por vida.
- **Conjuntos de reliquias y escáneres:** su id es su identidad.
- **Temporada:** `season.id` es la clave de su moneda, ruta, misiones y clasificación.
- **Misiones:** se pueden repetir entre temporadas (su periodo es `s:<id de temporada>`), pero nunca entre diaria, semanal y temporada.

### B5. Fechas

- **Temporadas y eventos:** empiezan y acaban a las 00:00 de Madrid, en UTC.
  - `23:00Z` del día anterior en horario de invierno; `22:00Z` en verano.
  - Formato ISO con milisegundos: `2026-12-10T23:00:00.000Z`.
  - El fin es exclusivo: «del viernes al lunes» con fin el lunes a las 00:00 deja el lunes fuera.
- **Escáner de evento:** las mismas fechas que su evento, exactamente la misma cadena (`…00.000Z` no es `…00Z`).
- **Potenciadores y avisos:** pueden empezar a cualquier hora.

### B6. Límites

| Cosa | Límite |
|---|---|
| Evento | ≤31 días, 1–12 metas, ≤10 eventos en la lista; nombre ≤40, descripción ≤200; meta con nombre ≤60 e id único en el evento |
| Potenciador | ≤14 días, factor 1–5, ≤10, nombre ≤40; los de la misma moneda que coinciden en el tiempo se multiplican hasta ×5 (un ×2 sobre un ×1,5 vivo da ×3) |
| Misiones | diarias y semanales: `count` 0–5 y `pool` ≤30; temporada: ≤30 |
| Logros | ≤60; marcos `bronze, silver, gold, nebula, abyss, crown`; títulos de ≤30 caracteres |
| Banner | ≤20; nombre ≤60; id y `pityGroup` ≤32 caracteres (con `event-<id>`, ids de evento de ≤26) |
| Aviso | 1–200 caracteres, 1–365 días |

**Qué multiplica un potenciador:** solo lo que paga una incursión, y antes de los topes por partida. No multiplica lo que dan metas, misiones ni la desintegración: «doble de polvo» es doble de polvo en las incursiones.

### B7. Eventos y escáneres

**Recompensas del evento:**
- Una meta paga `eventSignals`, que llegan como `signal:<idEvento>`.
- Un evento que paga señales necesita su escáner (uno que no paga, como «Escuadrón estelar», no). Las señales solo sirven en el escáner del evento, `kind: 'event'`, con:
  - `currency: 'signal:<id>'`;
  - `pityGroup: 'event-<id>'`;
  - `featured: { trait, value }`;
  - las fechas del evento.
- Tras el evento, las señales que sobran se convierten en polvo (`gacha.leftoverDust`, 50 por defecto).

**Metas:**
- Usan las stats de `MISSION_STATS`: `runs, minutes, kills, bossKills, extractions, depth, pulls, legendaries, fusions, disintegrations, components, coopRuns, revives`. Una stat nueva es código.
- Las de clan (`scope: 'clan'`) solo cuentan si el jugador está en un clan.

**Qué ve el jugador:**
- La pantalla de inicio enseña el primer evento **en curso** de `events.list`, por orden: pon delante el que quieres destacar.
- El asistente del panel añade el evento nuevo al final de la lista y no la reordena, ni crea potenciadores ni avisos. Para destacar un evento nuevo, o lanzar todo a la vez, usa los archivos.
- `deep-scan` tiene que seguir en `gacha.banners`: el esquema no lo exige, pero `check-config` y el test sí.
- Los avisos, la anomalía y los potenciadores van en el popup de Noticias, nunca sueltos por la pantalla.

### B8. Temporada

**Un `season.id` nuevo:**
- archiva la anterior (`closeDue`), con premios de la ruta viva;
- reinicia la moneda de temporada (`season:<id>`), la ruta, la tienda, las misiones de temporada y la clasificación;
- convierte en polvo la moneda sobrante, a `dustRate` de la ruta vigente.

**Otros campos:**
- `season.anomaly` debe existir en `content.anomalies`. Una anomalía nueva es contenido (parte A).
- `season.finish` solo admite `rift` (`SEASON_FINISHES`); un acabado nuevo es código y arte.

**El sector de temporada:** `sectors.season` (hoy `signal-rift`) es independiente de las fechas; `null` lo cierra.

**Textos fijos:** «Temporada 1 · La Señal» en `codex/entries.ts` y «Beta Abierta» en `es.ts`.

**El núcleo de temporada del laboratorio** (`lab.season`) es un segundo árbol, aparte del permanente (`lab.nodes`):
- Sus niveles se guardan por `season.id` (`galaxy.lab_season_nodes`). Con un id nuevo empieza vacío, y entre temporadas ni se ve ni da nada.
- Solo admite efectos de partida: `stat` y `payout` (`lab_season_kind`). La refinería, la antena, la desintegración y la fusión son del permanente.
- Los ids no se repiten entre los dos árboles, y cada `requires` apunta a su propio árbol.
- Los topes de cobro se suman entre los dos árboles. Cada estadística tiene un presupuesto con todo al máximo (`lab_stat_cap:<stat>`, `LAB_STAT_BUDGET`).
- `falloff` (de 0,5 a 1) hace que cada nivel dé un poco menos. `at` es la pista de colocación en la pizarra.
- El «Corrimiento al rojo» solo borra el permanente y solo cuenta sus niveles.

### B8 bis. Tienda de recursos

La clave `shop` (GDD §11.5) es el catálogo de la tienda con dinero real:
- `enabled` y `audience` (`staff` o `everyone`): nace cerrada y, al abrirla, primero para el staff.
- `products[]`:
  - `kind`: `pack` (un recurso), `bundle` o `welcome`;
  - `grants` y `bonus`: solo `coins`, `dust` y `components`;
  - `priceCents` y `stripePriceId`;
  - `offer`: `bonus` (+X %) o `price` (otro precio, con su propio precio de Stripe), con fechas;
  - `badge`, `featured`, `enabled`, `staffOnly`, `firstBonus` y `maxPerAccount`.
- `limits.dailyCents` y `limits.pendingMax`, `firstPurchase` y `legal` (vendedor, contacto y versión de las condiciones).

**Reglas:**
- Con la tienda abierta, cada producto activo necesita su precio de Stripe, y el de Stripe debe ser el mostrado. Si no lo es, la compra da 409 y salta un aviso.
- Ninguna oferta dura más de 31 días ni puede costar más que el límite diario.
- Cambiar `legal.termsVersion` obliga a volver a aceptar las condiciones.
- Los precios se comprueban, y los que faltan se crean, en Admin › Tienda › Precios. El panel crea el precio en Stripe, pero hay que ponerlo en el producto y publicar `shop`.
- Lo que da una compra se fija al abrir el pago: cambiar el catálogo no cambia los pagos ya abiertos.

### B9. Qué es configuración y qué es código

| Solo configuración | Necesita código |
|---|---|
| Temporada nueva (id, fechas, puntos, tramos, anomalía existente, `rift`) | Stat nueva de misión o meta (`MISSION_STATS` y dónde se cuenta) |
| Ruta y tienda con marcos existentes y títulos libres | Marco nuevo, acabado nuevo, moneda de potenciador nueva |
| Evento con stats existentes y escáner con destacada existente | Tipo de recompensa nuevo en metas |
| Potenciadores, misiones, logros, avisos | Bioma, comportamiento, patrón o sprite nuevos |
| Anomalía con los multiplicadores existentes | Mecánica de anomalía nueva |
| Sector que remezcla bioma, fauna y Núcleo existentes | Rasgo de galaxia nuevo (motor, [U]) |

---

## C. Entrega y publicación

1. **Rama** `feature/galaxy-<slug>` (o `fix/`, `docs/`) desde `develop`. Commits en español, del estilo `feat(galaxy): …`, con sus trailers.
2. **Tests y verificación:** los de la skill, `pnpm -C games/galaxy typecheck` y `lint`, más capturas si se ve en pantalla. CI es la puerta.
3. **PR a `develop`:** cuerpo con «Qué cambia» y «Pruebas». En verde, merge. El pipeline despliega PRE solo.
4. **Si hay que publicar:**
   - **Con código** (contenido nuevo): primero el PR del código y su despliegue; después, con el código ya en PRE, la carpeta de `ops/launch/` (hecha con `draft-config`) en un segundo PR pequeño.
   - **Solo configuración** (temporada, evento): la carpeta va en un único PR.
   - Después, la skill `galaxy-publicar-config`, que pide el OK explícito del propietario antes de escribir nada en PRE.
5. **Constancia:** lo publicado (fecha, versiones, motivo) y la carpeta `antes/` se apuntan en el `LEEME.md` de la carpeta, en un commit `docs(galaxy): …`. `docs/DEPLOY_PRE.md` solo recoge lo que hay que hacer **después de un merge** (subidas de `SIM_VERSION`, republicaciones obligatorias).

**En Windows**, los comandos de esta guía y de las skills son para Git Bash. En PowerShell, las variables van como `$env:VITE_ARENA_SHOTS=1;` delante del comando, `<` no existe y `>` guarda los JSON con BOM.

**Nunca:**
- tocar `main`;
- crear cuentas en PRE (es la beta abierta, con jugadores reales);
- imprimir secretos;
- publicar sin OK.
