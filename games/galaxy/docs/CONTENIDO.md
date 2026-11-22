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

**Cuándo subir `SIM_VERSION`** (`packages/sim/src/version.ts`, hoy `1.20.0`): cuando el **código** hace que el mismo contenido, con la misma semilla y las mismas entradas, juegue distinto. Si no se sube, se rompen las repeticiones y el modo en grupo, que va en paralelo entre navegadores.

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

### A5. La web lee lo publicado

Desde el editor de contenido (2026-11-16, P1), la web lee el contenido publicado (`useLiveContent`) en todas sus pantallas: el Códice, el Hangar de reliquias, la clasificación, el perfil y las listas del admin (`api/content-names.ts`). `DEFAULT_CONTENT` solo se ve mientras carga lo publicado o si no se puede leer.

Por eso un cambio hecho en el panel se ve en todas partes sin desplegar. `DEFAULT_CONTENT` sigue siendo el punto de partida del código: un cambio en código parte de lo publicado (`draft-config`, A4) y se publica después.

### A6. Arte

- **El sprite va antes que el contenido.** El arte debe estar desplegado antes o a la vez que el contenido que lo usa; `apps/web/test/sprites.test.ts` lo comprueba para `DEFAULT_CONTENT`. Si aun así falta, la arena pinta uno conocido en vez de romper (`drawableId`).
- **El catálogo de arte** (`packages/shared/src/config/art-catalog.ts`, generado): el panel, el servidor y la CLI rechazan publicar un `sprite` o un `icon` que la arena no tiene, y la galería del editor lo lee. **Tras añadir o cambiar un dibujo, regenéralo:** `GALAXY_WRITE_ART=1 pnpm exec vitest run --project web apps/web/test/art-catalog.test.ts`; sin hacerlo, ese test falla.
- **Sprites de la arena:** rejillas pintadas en código (`apps/web/src/arena/sprites/*`).
  - Paleta `P`, contorno de 1 px `#0b0c24`, luz desde arriba a la izquierda.
  - Reglas en `docs/DESIGN_SYSTEM.md` §8 quater.
  - Iconos de 12×12 en `icons.ts`; las evoluciones derivan su icono dorado `-evo`.
- **Arte más rico, con el MCP de Aseprite** (`art/<tema>/paint-*.lua`). Por ejemplo, las armas del Hangar:
  ```
  aseprite -b --script-param out=art/weapons --script-param web=apps/web/src/hangar/weapons --script art/weapons/paint-weapons.lua [--script-param only=<id>]
  ```
- **Los eventos de la incursión** (la nave abandonada de cada sector, la cápsula y la mira del cazarrecompensas) salen de `art/events/paint-events.lua`, que escribe `apps/web/src/arena/sprites/event-art.ts`:
  ```
  aseprite -b --script-param out=art/events --script-param web=apps/web/src/arena/sprites --script art/events/paint-events.lua
  ```
  Un sector nuevo necesita su nave en `SECTORS` y su meteorito en `METEORS` del script; sin ellos, la arena pinta los de la Nebulosa.
- **Revisa el resultado** con capturas: `VITE_ARENA_SHOTS=1` en `apps/web/test/browser/arena.browser.test.ts` guarda `__shots__/` (arsenal, biomas, sprites, eventos).

### A7. Textos

- **Estilo:** español, de tú, frases cortas, títulos sin punto final y sin `· : — → //`. Números con `fmt` (es-ES).
  - Fuente: `docs/DESIGN_SYSTEM.md` §9 y `apps/web/src/copy/es.ts`.
  - Los títulos importantes se le proponen al propietario como pregunta de opciones.
- **Nombres y descripciones** de armas, pasivas, enemigos y sectores viven en el propio contenido, en español.
- **Textos ligados a una entrada (P8, 2026-11-16): van en el propio contenido.**
  - Campos: `lore` en sectores, Núcleos y enemigos; `radio` en sectores y Núcleos; `hazardNames` en sectores.
  - Son opcionales. Vacíos, la web usa los de siempre: `SECTOR_TEXT`, `CORE_TEXT` y `BEAST_TEXT` en `codex/texts.ts`, y `copy.arena.radio.*` y `copy.arena.events.bySector` en `es.ts`.
  - El panel enseña ese texto de respaldo en gris dentro de la caja, así que una entrada nueva puede tener sus textos sin código.
  - Una especie sin texto, ni propio ni de siempre, no sale en el bestiario.
  - Mapas `satisfies Record<…>` de `es.ts` (familias, elementos, fenómenos, rasgos de sonda): `typecheck` obliga a añadir el id nuevo.
- **Números escritos en textos:** si cambias el valor, cambia también el texto.
  - Ejemplos: `copy.hangar.stacking` («Desde la tercera… la mitad»), el GDD (§8.2, §8.4 bis) y `DESIGN_SYSTEM.md`.
- **Nunca escribas en un texto un valor que el admin puede cambiar:** lo manda el servidor.

### A8. Tests con recuentos fijos

Al añadir una entrada, actualiza estos números en el mismo commit:

| Test | Qué fija |
|---|---|
| `packages/sim/test/upgrades.test.ts` | 21 armas, cada una con su evolución (y las cinco de noviembre con su pasiva) |
| `packages/sim/test/content.test.ts` | 25 pasivas, 25 enemigos, listas de sondas, los 18 Núcleos (3 formas por cada uno de los 6), sectores y biomas |
| `packages/sim/test/passives-nov.test.ts` | las 5 pasivas de noviembre y que el contenido publicado antes sigue validando |
| `packages/sim/test/difficulty.test.ts` | la curva de dificultad (`GALAXY_CALIBRATE=1`, ver A8 bis): cuánto dura cada perfil en la Nebulosa, que quedarse quieto no compense, cuánto dura cada combate contra un Núcleo, que ninguno se atasque y que cada sector sea más corto que el anterior |
| `packages/sim/test/variants.test.ts` | 16 variantes, en los niveles 4 y 8 de cada arma inicial |
| `apps/web/test/weapon-art.test.ts` | 24 tiras de arte del Hangar |
| `packages/sim/test/anomalies.test.ts`, `quirks.test.ts` | listas exactas de ids |
| `apps/web/test/sprites.test.ts` | listas de sprites: `engine`, `M3B3_CORES`, `M3B3_ROCKS` |
| `apps/server/test/integration/hangar.test.ts`, `probes.test.ts`, `sectors.test.ts` | 8 sondas, 5 sectores, fauna de la Nebulosa Exterior |
| `packages/sim/test/sector-difficulty.test.ts` | `enemyHp` crece por orden de sector; el de temporada es el más duro; como mucho ×1,35; en una incursión cada Núcleo tiene más vida que el anterior |

### A8 bis. Cómo crece la dificultad en una incursión

Plan de vida de enemigos (2026-11-15). Todo vive en el contenido de cada sector y se publica con `content`:

| Campo | Qué hace |
|---|---|
| `scaling.hpPerMinute`, `hpPerLayer` | vida de la fauna por minuto de la incursión y por capa |
| `scaling.hpPerLevel`, `levelFrom` | vida de la fauna × (1 + `hpPerLevel`)^(nivel − `levelFrom`), con el nivel más alto del equipo; los niveles hasta `levelFrom` no cuentan, para que quien empieza no lo note |
| `scaling.coreHpPerLevel` | vida de los Núcleos × (1 + `coreHpPerLevel` × niveles por encima de `levelFrom`), en línea recta: un build completo deja de crecer y una subida compuesta hacía eternos los Núcleos profundos |
| `scaling.coreRise` | cada Núcleo de la incursión tiene al menos (1 + `coreRise`) × la vida del anterior, también el que viene tras un Núcleo profundo |
| `scaling.damagePerMinute`, `damagePerLayer` | el daño crece poco a poco |
| `density.perLayer` | más enemigos vivos y más aparición en cada capa a partir de la segunda, salvo mientras hay Núcleo |
| `hitCap` (en la raíz de `content`) | ningún golpe se lleva más de esta parte de la vida máxima de la sonda: se muere de varios golpes, nunca de uno |
| `scaling.hpLevelMax` | techo de la vida por nivel (1000: sin techo en la práctica) |
| `scaling.hpHoldFrom`, `hpHoldUntil`, `hpDoubleEvery`, `hpHoldMax` (2026-11-18) | la tregua de vida: desde el minuto `hpHoldFrom` el crecimiento de la vida de la fauna (minutos × capa × nivel) se congela en el valor de ese momento, como mucho `hpHoldMax` si es mayor que 0, hasta el minuto `hpHoldUntil`; después se dobla cada `hpDoubleEvery` minutos, hasta que toca extraer o caer. El sector, el grupo y la anomalía multiplican encima; los Núcleos no la siguen. `hpHoldUntil` ≤ `hpHoldFrom` la apaga. Por defecto 8, 30, 5 y 0 |
| `healing` (en la raíz, 2026-11-16) | la vida robada a los enemigos (Sifón, Sanguijuela, Sangría) cura como mucho vida máxima × (`base` + `perLifesteal` × robo de vida) por segundo, ahorrable hasta `burst` segundos; solo del daño real, nunca del sobrante al matar |
| `stillness` (en la raíz, 2026-11-16) | «La Estática te alcanza»: `warn` s dentro de un círculo de `radius` avisan; desde `hurt` s hace daño (`damage` + `growth` por segundo, hasta `max`, × vida máxima por segundo) y bloquea toda curación hasta salir. No cuenta en la baliza, saqueando una nave abandonada ni reanimando; en grupo sí cuenta con una carta abierta, porque se puede mover mientras elige. `hurt` 0 la apaga |

| `events` (en la raíz, 2026-11-16) | eventos de la incursión que da la semilla: cada capa tira cada `slot` una vez (probabilidad `chance`, un momento entre `from` y `to` s y un tipo según `weights`, con los de cada sector en `sectors`). Un evento empieza `gap` s después de que acabe el anterior (y lejos del satélite) y termina `endBy` s antes del Núcleo, o no sale. Tipos: `wreck` (nave abandonada: `hold` s dentro de `radius` la saquean), `capsule` (cápsula: aterriza en `warn` s y espera `life` s a que la toquen) y `bounty` (cazarrecompensas: un enemigo con `hp` × la vida que huye a `speed` durante `seconds`). Botín de cada uno: `coins`, `dust` y `components` × (1 + `perLayer` × (capa − 1)), sin suerte, para que el servidor lo acote desde la semilla (`eventLootUpTo`). Peligros, sin botín: `meteors` (lluvia: cada `every` s cae un meteorito a menos de `spread` de una sonda, avisado `warn` s antes, con `damage` × vida máxima), `storm` (tormenta: un círculo de `radius` que sigue a la sonda más cercana a `speed`, con `damage` × vida máxima por segundo dentro), `ambush` (emboscada: tras `warn` s, un anillo de `count` + `perLayer` por capa de la fauna del sector a `distance`) y `well` (pozo: atrae sondas y botín en `radius`, hasta `pull` por segundo en el centro, y en `core` hace `damage` × vida máxima por segundo). Los nombres de cada sector están en `copy.arena.events.bySector`. `slots: []` los apaga |

**Perfiles de calibración** (`difficulty.test.ts`): `novato`, `medio`, `veterano` y `avanzado` juegan; `quieto` se queda quieto el 80 % del tiempo; `plantado` no se mueve nunca y `campero` solo se mueve en el sitio (los dos deben durar como mucho el 25 % de `avanzado`), y `sifon` coge el Sifón primero (como mucho un 15 % más que `avanzado`).

**Para calibrar:** `GALAXY_CALIBRATE=1` con `GALAXY_SECTOR`, `GALAXY_PROFILE` y `GALAXY_CURVE_TRY=<json>`, que prueba valores sin tocar el código (sectores, Núcleos, enemigos, `enemyHpScale`, `bossHpScale`, `hitCap`, `healing` y `stillness`). Cada corrida es lenta: lánzalas de pocas en pocas y con prioridad baja, o el equipo se queda sin CPU.

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

**Borradores del contenido (editor de contenido, 2026-11-16):**
- En el panel, `content` se cambia con **borradores en el servidor** (`/admin/configuracion/content`): cada admin los ve, se guardan solos campo a campo y guardan solo los campos de primer nivel que cambian, por clave (`content`, y también `sectors` y `probes` para lo que un sector o una sonda nuevos necesitan).
- Si se publica otra versión mientras tanto, el borrador queda desfasado: «Juntar con lo publicado» lo fusiona entidad a entidad (por id) y, si los dos lados cambiaron lo mismo, el admin elige qué se queda.
- Se publica con motivo y contraseña (todas sus claves o ninguna, `publishMany`) o se descarta. Los cerrados se borran a los 30 días.
- Cualquier versión publicada puede volver como borrador nuevo («Crear un borrador con la versión N»).
- **El editor visual** (P4): zonas (Arsenal, Sondas, Fauna, Núcleos, Sectores, Elementos, Reliquias, Eventos, Reglas y Técnico), la lista de cada colección con búsqueda y dibujo, y la ficha de la entrada elegida, con cada campo nombrado y explicado. El JSON sigue a una pestaña. Lo publicado no se quita (su id es permanente); lo que añade el borrador, sí. La vista va en la dirección (`?borrador=<id>&zona=fauna&id=mite`), así que se comparte.
- **Los asistentes «Crear…»** (P9) crean por pasos, sobre el borrador, un enemigo, un Núcleo, un sector, un arma, una sonda, una pasiva, una reacción, una anomalía o un conjunto. Los pasos son:
  1. nombre y base;
  2. una sección por paso;
  3. lo que la entrada necesita para formar parte del juego: dónde sale un enemigo, en qué sectores es forma un Núcleo, la evolución de un arma, o el desbloqueo y la paga de un sector o una sonda, que se guardan en las claves `sectors` y `probes` del mismo borrador;
  4. una revisión.

  Se abren con `?crear=` y el tipo: `enemigo`, `nucleo`, `sector`, `arma`, `sonda`, `pasiva`, `reaccion`, `anomalia` o `conjunto`.
- **Un tipo de arma nuevo, o uno que empieza a leer otro número de su nivel, actualiza `WEAPON_FIELDS`** (`packages/sim/src/content/weapon-fields.ts`): la tabla de niveles apaga lo que no lee, y `weapon-fields.test.ts` lo prueba.
- **Cada campo nuevo de `content` necesita su descripción** en `apps/web/src/admin/content/descriptors/` (el archivo de su zona): nombre, explicación, y el vocabulario si elige entre valores. Un campo de primer nivel nuevo va además en una zona de `descriptors/index.ts`. `admin-content-descriptors.test.ts` falla diciendo qué falta; hasta entonces el editor lo enseña con su nombre de código, en «Otros» si no tiene zona.

**Probar antes de publicar (modo depuración, 2026-11-15; borradores, 2026-11-16):**
- Un borrador tiene «Probar en incursión»: abre el hangar con `?borrador=<id>`, donde se eligen su sector y su sonda (también los nuevos). El servidor juega el borrador sobre lo publicado en una incursión de prueba en solitario: nadie más lo ve y no da recompensas.
- Con F2 se abre el menú de depuración, que permite:
  - cambiar la velocidad (x0,25 a x8) y ver información y colisiones;
  - subir niveles, ser invulnerable y curar;
  - matar enemigos, hacer aparecer el Núcleo ya o pasar de capa;
  - dar cualquier arma, pasiva o evolución.
- El mismo menú sirve en cualquier incursión en solitario de un admin con TOTP. La primera acción que cambia la partida la convierte en incursión de prueba, con la auditoría `run.test`.
- Las bonificaciones de sonda y laboratorio siguen saliendo del servidor, y el arte nuevo tiene que estar ya desplegado.

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
- **Precios de las tiradas** (`gacha.costs`, para todos los escáneres): con señales, `signals` por escaneo (x1, x5, x10); con monedas, `coins` (x1, 100), `coinsFive` (x5, 475, desde 2026-11-17) y `coinsTen` (x10, 900). Una carpeta antigua sin `coinsFive` sigue valiendo: toma 475. «Mejor precio» sale solo en el tamaño que de verdad ahorra por escaneo.
- **Galaxia destacada en el escáner:** si nadie la ha encontrado aún, el escáner enseña un ejemplo con su rasgo (una legendaria generada con él), marcado «Ejemplo»; en cuanto alguien saca una, sale esa.

**Metas:**
- Usan las stats de `MISSION_STATS`: `runs, minutes, kills, bossKills, extractions, depth, pulls, legendaries, fusions, disintegrations, components, coopRuns, revives`. Una stat nueva es código.
- Las de clan (`scope: 'clan'`) solo cuentan si el jugador está en un clan.

**Qué ve el jugador:**
- La pantalla de inicio enseña el primer evento **en curso** de `events.list`, por orden: pon delante el que quieres destacar.
- El asistente del panel añade el evento nuevo al final de la lista y no la reordena, ni crea potenciadores ni avisos. Para destacar un evento nuevo, o lanzar todo a la vez, usa los archivos.
- `deep-scan` tiene que seguir en `gacha.banners`: el esquema no lo exige, pero `check-config` y el test sí.
- Los avisos, la anomalía y los potenciadores van en el popup de Noticias, nunca sueltos por la pantalla.
- **Notas de versión:** lo que se publica por configuración no pasa por un despliegue. Si el jugador lo nota (un evento, una temporada, armas o sectores nuevos), añade su cambio a la nota de versión en `packages/shared/src/notes/entries.ts` en el PR que prepara la carpeta, o pide al propietario que lo anuncie desde Administración, en Notas de versión, al publicar.

### B8. Temporada

**Temporadas como fichas (21/11/2026).** Una temporada es una fila de `galaxy.seasons`, no claves de configuración. La ficha (`temporada.json` en una carpeta de `ops/launch/`; `seasonRecordSchema` en `packages/shared/src/progress/season-record.ts`) lleva:
- `id`, `name`, `startsAt`, `endsAt`, a medianoche de Madrid;
- `rules`: lo que era la clave `season` sin id, nombre ni fechas;
- `route`: lo que era `seasonRoute` (moneda, pasos, tienda y premios de cierre);
- `missions` y `lab`: lo que eran `missions.season` y `lab.season`.

**Premios de cualquier tipo (PR 4, 22/11/2026).** Cada escalón (`route.steps[]`), cada artículo (`route.shop[]`) y cada premio de cierre lleva, junto a su `reward` de siempre (que sigue valiendo y pagándose), una lista `gifts` con los regalos del buzón (`giftSchema`: moneda, pieza, galaxia, sonda, experiencia). Por defecto `[]`, así que un `temporada.json` antiguo se lee igual:
- `steps[]: { at, reward?, gifts? }` y `shop[]: { id, name, price, limit, reward?, gifts? }`. Si solo da regalos, `reward` se puede omitir.
- `closing.tierGifts`: cinco listas, de Bronce a Estelar, que se suman a `closing.tiers`. `closing.podiumGifts` se suma a `closing.podium`.
- `closing.places: [{ from, to, gifts }]`: premios por puestos, en rangos que empiezan en el 1, van en orden y no se solapan (`prizes_start`, `prizes_order`, `prizes_overlap`, `prize_range`, `prize_empty`). Los puestos cuentan solo entre quienes pueden ganar premios (`accounts.prize_eligible`): quien no puede conserva su puesto y el premio pasa al siguiente, igual que el podio. Se suman al premio del tramo y al del podio.

```json
"route": {
  "steps": [{ "at": 2000, "reward": { "title": "Leyenda de la Temporada 3" }, "gifts": [{ "kind": "galaxy", "tier": "epic", "finish": "holo", "count": 1 }] }],
  "shop": [{ "id": "galaxia", "name": "Galaxia de temporada", "price": 600, "limit": 2, "gifts": [{ "kind": "galaxy", "tier": "rare", "finish": "normal" }] }],
  "closing": {
    "podiumGifts": [{ "kind": "probe", "probe": "bastion" }],
    "places": [
      { "from": 1, "to": 1, "gifts": [{ "kind": "galaxy", "tier": "mythic", "finish": "prismatic" }] },
      { "from": 2, "to": 10, "gifts": [{ "kind": "currency", "currency": "coins", "amount": 20000 }] }
    ]
  }
}
```

**Qué regalos caben:**
- La ruta y la tienda pueden dar la moneda de **su** temporada (`season:<id>`), nunca la de otra (`season_gift_other`; copiar o importar una temporada en el panel la cambia sola) ni puntos de temporada (`season_gift_points`).
- Los premios de cierre se recogen con la temporada cerrada: ni moneda ni puntos de temporada (`season_gift_closed`).
- Cada lista da como mucho 20 regalos y 10 galaxias (`season_gift_galaxies`). Un escalón o un artículo que no da nada es un error (`season_reward_empty`).
- Contra lo vivo, cada regalo se comprueba como en el buzón (`gift_<código>`: pieza o sonda que no existe, galaxia imposible, evento cerrado): la ruta y la tienda a la fecha de inicio; el cierre, a la de fin.
- **Regalos grandes:** cada escalón, artículo (por todas las veces que se puede comprar) y premio se pesa con `mailLimits` (`seasonBigGifts`): la ruta, la tienda y los tramos llegan a todos; el podio a sus puestos; un rango a tantos como tiene. Si alguno pasa los límites, solo un superadmin programa la temporada desde el panel (`season_needs_superadmin`). La CLI es del propietario y no lo pide.

**Cómo se pagan:** con `grantGifts`, dentro de la guarda de siempre (la fila del escalón recogido, el contador de compras, `season_results.claimed_at`), con claves que salen de la operación y galaxias con semilla del servidor: `season:<id>:step:<at>:<cuenta>`, `season:<id>:shop:<artículo>:<n.º de compra>:<cuenta>` y `season:<id>:close:<cuenta>`. Al cerrar, cada resultado guarda sus premios congelados en `season_results.rewards` (la recompensa de siempre más sus `gifts`, y `place` en los de un rango).

**En el panel** (Temporadas › paso «Ruta, tienda y misiones»): pestañas Ruta, Tienda (con su moneda), Premios de cierre (por tramo, podio y puestos), Misiones y Laboratorio (este último, de momento, solo se ve: se copia o se importa con lo demás). Cada premio se elige con el selector de regalos del buzón, packs incluidos (se copian dentro), y acepta un título propio de texto libre. Lo de antes se ve como regalos y cada parte se puede quitar.

**Estados:** borrador (no cuenta), programada (abierta entre sus fechas) y cerrada (histórico). Las programadas y cerradas nunca se solapan. El servidor sigue leyendo `season`, `seasonRoute`, `missions.season` y `lab.season`, pero salen de la temporada abierta (o, entre dos, de la última que acabó). Esas claves y campos ya no se publican: el servidor y la CLI lo rechazan. Se operan con `season-list`, `season-show`, `season-import`, `season-schedule`, `season-unschedule` y `season-extend` (skill `galaxy-temporada`), y pronto desde Administración › Temporadas. El primer arranque con este código convirtió en fichas la temporada viva y las archivadas.

**Al empezar una temporada nueva:**
- la anterior se archiva sola al acabar (`closeDue`), con los premios de cierre de **su propia ficha**;
- se reinician la moneda de temporada (`season:<id>`), la ruta, la tienda, las misiones de temporada y la clasificación;
- la moneda sobrante pasa a polvo con el `dustRate` de la ruta de la temporada que se ve.

**Otros campos:**
- `rules.anomaly` debe existir en `content.anomalies`. Una anomalía nueva es contenido (parte A).
- `rules.finish` solo admite `rift` (`SEASON_FINISHES`); un acabado nuevo es código y arte.
- Cada evento tiene que caber en alguna temporada programada (`opsProblems`).

**El sector de temporada:**
- `sectors.season` (hoy `signal-rift`) es independiente de las fechas; `null` lo cierra.
- Además pide `sectors.seasonUnlock` incursiones (por defecto 15) en cualquier sector, contadas como las de las sondas: terminadas, no sospechosas y de al menos `probes.minRunSeconds`. Quien ya terminó una incursión en él lo conserva. `null` lo abre a todos.

**La paga por sector (2026-11-16):**
- `sectors.pay` multiplica lo que paga una incursión en cada sector: monedas, polvo, material, componentes y puntos de temporada.
- Por defecto: Nebulosa ×0,8, Escarcha ×1, Arrecife ×1,25, Forja ×1,5 y Fisura ×1,8. Un sector que no esté en la lista paga ×1.
- La experiencia sigue el mismo factor, pero nunca por debajo de ×1.
- Los topes por incursión de `runs.caps` crecen con el factor.
- El factor se guarda al empezar la incursión (`runs.sector_factor`): cambiarlo no toca las que están en marcha.
- En la simulación, el botín en bruto por minuto sigue siendo el mismo en todos los sectores (±15 %, `calibration.test.ts`); la diferencia la pone el servidor al pagar.

**Textos fijos:** «Temporada 1 · La Señal» en `codex/entries.ts` y «Beta Abierta» en `es.ts`.

**El núcleo de temporada del laboratorio** (el `lab` de la ficha; antes `lab.season`) es un segundo árbol, aparte del permanente (`lab.nodes`). El árbol permanente nuevo tiene que caber con el de cada temporada que aún corre:
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
  - `kind`:
    - `pack`: un recurso;
    - `bundle`: varios recursos;
    - `welcome`: el pack de bienvenida;
    - `cosmetic`: una pieza en `cosmetic` (`{ kind: avatar|frame|title|skin, id }`);
    - `set`: un pack completo de piezas en `pieces`, de 2 a 12, como los packs de skins (2026-11-17);
  - `grants` y `bonus`: solo `coins`, `dust` y `components`, y nada en un `cosmetic` ni en un `set`;
  - `priceCents` y `stripePriceId`;
  - `offer`: `bonus` (+X %) o `price` (otro precio, con su propio precio de Stripe), con fechas;
  - `availableFrom` y `availableUntil`: las fechas de venta, en cualquier producto (incluye el inicio, no el final; `null` no limita);
  - `badge`, `featured`, `enabled`, `staffOnly`, `firstBonus` y `maxPerAccount`.
- `limits.dailyCents` y `limits.pendingMax`, `firstPurchase` y `legal` (vendedor, contacto y versión de las condiciones).

**Reglas:**
- Con la tienda abierta, cada producto activo necesita su precio de Stripe, y el de Stripe debe ser el mostrado. Si no lo es, la compra da 409 y salta un aviso.
- Ninguna oferta dura más de 31 días ni puede costar más que el límite diario.
- Cambiar `legal.termsVersion` obliga a volver a aceptar las condiciones.
- Los precios se comprueban, y los que faltan se crean, en Admin › Tienda › Precios. El panel crea el precio en Stripe, pero hay que ponerlo en el producto y publicar `shop`.
- Lo que da una compra se fija al abrir el pago: cambiar el catálogo no cambia los pagos ya abiertos.
- **Piezas y packs:**
  - Un `cosmetic` o un `set` se compra una vez por cuenta y sale en la pestaña Estilo.
  - Cada pieza debe tener arte. Una pieza repetida en un `set` no vale (`shop_set_pieces`).
  - Si el jugador ya tiene la pieza de un `cosmetic`, o todas las de un `set`, sale «Ya lo tienes» y no se vende.
  - Un `set` del que tiene solo algunas sí se vende: entrega las que faltan y apunta cuáles dio (`granted_pieces`).
  - Un reembolso o un contracargo quita solo esas, nunca una que ya tenía.
- **Fechas de venta:** fuera de ellas, el producto no se ve y su compra da `shop_unavailable`. Un final anterior al inicio no vale (`shop_window`). La tarjeta dice «A la venta hasta el …» con el último día en Madrid.
- **Una skin de la tienda** solo se puede llevar si está en el catálogo vivo `cosmetics`. Las líneas nuevas se publican primero en `cosmetics` y después sus productos en `shop`.
- **Los packs de skins** (2026-11-17) son las líneas `navidad`, `fuego`, `agua`, `galaxia`, `carbono` y `rubi`: legendarias, animadas y solo de la tienda (`SKIN_PACKS` en `cosmetics/catalog.ts`). Sus productos son `skins-<línea>`, apagados y sin precio en el valor por defecto. Navidad se vende desde su publicación (17/11/2026) hasta el 10 de enero incluido (`availableUntil` el 11 de enero a las 00:00 de Madrid).

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

### B10. El buzón: packs, plantillas y límites

**Dos claves** (buzón v2, 2026-11-16):
- **`mail`** (`packages/shared/src/gifts/library.ts`) guarda:
  - `packs`: la biblioteca de packs;
  - `templates`: las plantillas de mensaje;
  - `warnDays`: cuántos días antes de caducar un mensaje dice «Caduca pronto».
  - Se edita en `/admin/configuracion/mail` (la biblioteca) y desde Comunicación («Guardar como plantilla»), con versión, motivo y contraseña.
- **`mailLimits`** (`gifts/limits.ts`) dice qué regalo es tan grande que solo lo envía un superadmin:
  - una galaxia de cierta rareza o con un acabado especial;
  - una pieza de la tienda o una sonda;
  - más de una cantidad de cada moneda, experiencia o puntos de temporada **por jugador**;
  - más de cierto número de galaxias por mensaje (`galaxies`);
  - más de cierto número de destinatarios.
  - **Solo la publica un superadmin** (403 `superadmin_only` en el panel); la CLI del contenedor publica como `cli`.

**Un regalo** (`gifts/schema.ts`, `giftSchema`) es uno de estos:
- una moneda: `coins`, `dust`, `signal`, `material`, `components`, `signal:<evento>` o `season:<id>`;
- una pieza: `avatar`, `frame`, `title` o `skin`, con su id (el texto, en un título);
- una galaxia: rareza, acabado, un rasgo opcional (`{ key, value }`) y cuántas, de 1 a 5;
- una sonda, experiencia o puntos de temporada.

**Un pack** lleva `id` (minúsculas, dígitos y guiones; permanente, porque los mensajes y las plantillas lo nombran), `name`, `art` (`parcel`, `chest`, `capsule`, `star`, `crate` o `gift`), `items` (de 1 a 30) y `enabled`.
- Como mucho 10 galaxias por pack, igual que por mensaje.
- Una galaxia que no se puede regalar no se publica: un rasgo que esa rareza nunca lleva, o una combinación tan rara que tarda demasiado en hacerse (una mítica con rasgo; `GIFT_CANDIDATES`).
- Al enviarse, el pack se copia en el mensaje: cambiarlo o apagarlo después no toca lo enviado.

**Una plantilla** lleva `id`, `name`, `type` (anuncio, regalo, compensación, evento, recompensa o personal), `title`, `body`, `items`, `packs` (ids de la biblioteca) y `expiresInDays`.

**Al enviar un mensaje**, el servidor:
- rechaza un regalo que no existe o ya no se puede dar (`gift_invalid`, con cuál y por qué), más de 10 galaxias (`galaxy_too_many`) o un pack que no está o está apagado (`pack_unknown`);
- pide al superadmin un regalo grande (`gift_needs_superadmin`);
- adelanta la caducidad al cierre de la temporada o del evento si un regalo depende de ellos.

Las galaxias se hacen al recogerlas, cada jugador las suyas, y la misma recogida da siempre las mismas.

**Un ejemplo para empezar:** `ops/plantillas/buzon/`.

### B11. Torneos

**Qué es.** Un torneo es una fila de `galaxy.tournaments`, no una clave de configuración (GDD §13.3). La ficha es `tournamentRecordSchema` (`packages/shared/src/tournaments/record.ts`) y sus problemas, `tournamentIssues`, con el texto en `es.ts` (`tournamentIssues`). Cabe en una temporada programada, dura 28 días como mucho y nunca junta una entrada con dinero.

**La API** está descrita en `packages/shared/src/api/tournaments.ts`:
- **Jugadores** en `/galaxy/api/tournaments`: lista, página, `join`, `leave` y `claim`, con clave de idempotencia.
- **Admins** en `/galaxy/api/admin/tournaments`: validar, guardar borrador, programar, desprogramar (antes de empezar y sin inscritos), cancelar (devuelve las entradas), revisión, decidir una partida, descalificar, «Publicar ya» y marcar el dinero como pagado. Todo con motivo y auditado; lo que cambia el torneo o los premios pide la contraseña.

**Operarlo:**
- **Programar** con premios por encima de `mailLimits`, o con dinero, solo lo hace un superadmin (`tournament_needs_superadmin`).
- **Durante la revisión** mira el panel: las partidas `unverifiable` o `error` de los puestos con premio esperan tu decisión, y sin ella los resultados no salen. Las `unverifiable` se deciden en bloque por motivo (`inputs_missing`, `inputs_unreadable`, `sim_version`, `content_unreadable`) o por jugador; las `error`, una a una. Las tuyas y (si no eres superadmin) las del equipo las decide otro.
- **Un despliegue que sube `SIM_VERSION`** con torneos en curso deja sus partidas anteriores sin comprobar (`sim_version`): el listado lo avisa (`simChanged`) y se deciden en bloque.
- **Quien está fuera de la clasificación** (`leaderboard_excluded`) no puede inscribirse.
- **El dinero** se paga fuera del juego. Escribe al ganador por el buzón y márcalo como pagado.
- **Los premios** son regalos del buzón (B10), pero sin nada de temporada ni de evento: se recogen sin fecha.

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
