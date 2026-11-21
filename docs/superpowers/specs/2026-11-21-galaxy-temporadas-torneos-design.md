# Galaxy Survivor: temporadas como fichas, clasificación, tienda de temporada y torneos

## Contexto

**Fecha:** 21/11/2026. La Temporada 2 está preparada como ficheros de configuración en `ops/launch/2026-11-23-temporada-2` (PR #175) y debe empezar el lunes 23/11 a las 00:00 de Madrid, es decir, el domingo 22/11 a las 23:00Z.

**El problema.** Hoy el juego solo puede tener una temporada viva:
- **Es una clave de configuración.** «Activa» significa que hoy cae entre sus fechas.
- **Publicar la siguiente antes de tiempo cierra la actual en ese instante.** Por eso cada temporada se publica a mano a medianoche, y las partidas jugadas entre las 00:00 y la publicación no dan Esquirlas.
- **El cierre es perezoso.** Ocurre la primera vez que alguien lee la temporada.
- **El histórico es pobre.** Se guarda la clasificación General final con sus premios, y nada más.
- **No hay torneos en el código.** El «Primer torneo» fue la T1 más un evento, con un único premio de podio.

**Lo que quiere el propietario:**
- **Temporadas preparadas y programadas desde el admin,** de forma muy intuitiva para admins poco técnicos.
- **Histórico completo:** clasificaciones, estadísticas y premios de cada temporada pasada, visitables por los jugadores.
- **Clasificación con más información,** y el bloque «Temporada» pulsable para ir a `/temporada`.
- **Tienda de temporada con la barra de recursos de Misiones** y la animación y el sonido de los objetos subiendo a ella.
- **Vista previa** de la próxima temporada para admins, en la clasificación y en la tienda.
- **Un sistema completo de torneos.**

Todo debe seguir siendo seguro, escalable, intuitivo, con buen feedback visual y adictivo. El propietario prefiere lo más completo y no pone la fecha como barrera: si no llegamos al 23/11, amplía el plazo.

## Decisiones del propietario (21/11)

| Tema | Decisión |
|---|---|
| Enfoque de las temporadas | **Fichas en la base de datos.** Pasadas, actual y próximas conviven, con histórico completo |
| La T2 | Se estrena con el sistema nuevo, con plan B, o se amplía el plazo |
| Asistente de temporada | Cubre lo de la temporada: datos, fechas, tramos y puntos, ruta, tienda, premios de cierre, misiones y laboratorio de temporada, y anomalía. Eventos y escáneres siguen en «Eventos», programables dentro de una temporada futura. Los torneos tienen su propia pantalla |
| Medida del torneo | La elige el admin, con clasificación interna propia: puntos del torneo, enemigos, partidas, mejor partida, capa, Núcleos, extracciones o «temporada» (los puntos de partidas desde el inicio de la temporada hasta que acaba el torneo) |
| Qué partidas cuentan | **Desde la inscripción.** Se puede inscribir uno hasta el último día. Quien se sale pierde su puntuación en ese torneo y no puede volver a él |
| Entrada | **Opcional, en moneda del juego.** Nunca junto a premios en dinero |
| Pago de premios del torneo | **Tras una revisión** configurable: el servidor resimula las partidas con premio y un admin puede descalificar. El dinero lo confirma siempre un admin y se paga fuera del juego |
| Partidas que no se pueden comprobar | **Las decide un admin.** Quedan pendientes y los resultados no se publican hasta que las acepte o las descarte |
| Dónde se recogen los premios | **En su pantalla** (`/temporada` o la página del torneo), con la animación y el sonido. El buzón solo avisa con un botón que lleva allí. **No caducan** |
| Admins que juegan | **Pueden ganar.** Es un ajuste por cuenta: «puede ganar premios», activado por defecto, editable en la ficha de cada admin. Si está apagado, aparece en la clasificación con una marca y su premio pasa al siguiente |

## Diseño

### 1. Temporadas como fichas (núcleo)

**Tabla `galaxy.seasons`:**
- `id`: slug que cumple `^[a-z0-9-]{1,32}$`. También `name`, `starts_at` y `ends_at`.
- **`state`:** `draft`, `scheduled` o `closed`. «Activa» no se guarda: es `scheduled` con `starts_at ≤ now < ends_at`.
- **Datos:** `rules` (lo que hoy es la clave `season` menos id, nombre y fechas), `route` (ruta, tienda, moneda y premios de cierre), `missions` (misiones de temporada), `lab` (árbol de temporada) y `announced_at`.
- `version`, más quién y cuándo creó, cambió y programó.

**Comprobaciones de la tabla:**
- `ends_at > starts_at`.
- Fechas en medianoche de Madrid.
- **Sin solapes:** `exclude using gist (tstzrange(starts_at, ends_at) with &&) where (state <> 'draft') DEFERRABLE INITIALLY DEFERRED`. Basta el GiST nativo de los rangos. Que sea diferible permite, en una sola transacción, alargar una temporada y mover el inicio de la siguiente.
- **El error de solape** se traduce a `season_overlap`, que va en `API_ERROR_CODES` con su texto en `es.ts`.

**Historial:** `galaxy.season_revisions`, append-only con triggers como `game_config_versions`. Guarda la ficha completa en cada guardado, con su motivo.

**Reglas de edición:**

| Estado | Qué se puede cambiar |
|---|---|
| Borrador | Todo |
| Programada (futura) | Todo, con contraseña y motivo |
| Activa | Nombre; fecha de fin (nunca antes de ahora; el panel ofrece «mover también el inicio de la siguiente»); añadir pasos de ruta y artículos de tienda. Cambiar tramos o puntos pide confirmación reforzada y queda auditado |
| Cerrada | Nada |

**Cómo leen la temporada los sistemas (mínimo cambio):**
- El lector de configuración que crea `buildApp` (`apps/server/src/config/service.ts`) se envuelve:
  - `get('season')` y `get('seasonRoute')` devuelven la ficha actual, o la última pasada si hay un hueco entre temporadas;
  - `get('missions')` y `get('lab')` superponen el `.season` de la ficha;
  - si no existe ninguna ficha programada, se usan las claves antiguas.
- **La caché guarda la lista de fichas, no «la actual».** Así el cambio a las 00:00 es exacto.
- **Todos los lectores del servidor ya son asíncronos y siguen igual:**
  - gacha (acabado exclusivo y sello `galaxies.season`);
  - grupo (`coop/service.ts`, `coop/settle.ts`) y partidas (`runs/routes.ts` al empezar, en `/boosts` y al terminar);
  - `profiles.ts`, `clans/service.ts` y `leaderboard.ts`;
  - correo (`mail/service.ts`, `admin/communication.ts`) y `admin/progress.ts`;
  - CLI (copia de cosméticos), cierre y salón de la fama.
- **Los 21 ficheros de prueba que usan `fixedConfig` no cambian.**
- **Web:** `gifts/words.ts` (`giftCatalog`), `usePlayerGiftView.ts` y `admin/forms/labels.ts` pasan a leer la moneda de temporada del servidor, no de las filas de configuración.

**Se acaba publicar temporadas a la antigua:**
- **El propio servicio de publicación rechaza** `season`, `seasonRoute`, y los cambios de `missions.season` o `lab.season` respecto a lo vivo, con el mensaje «usa Temporadas». Afecta a la ruta de admin y a la CLI.
- **`check-config` también los rechaza.**
- **Se actualizan** `PUBLISH_ORDER`, `cli-config.test.ts` y `config-admin.test.ts`.
- **Las versiones viejas se siguen pudiendo leer.**

**Comprobaciones entre claves:**
- `opsProblems` deja de suponer una sola temporada: los eventos deben caber en alguna temporada programada o activa, y la anomalía y los ids de misión se comprueban por ficha.
- **El presupuesto del laboratorio** comprueba cada ficha contra el árbol permanente vivo, y cada publicación de `lab` contra todas las fichas programadas o activas.
- **Los títulos de la ruta pueden ser texto libre,** sin pasar por el catálogo. La T2 trae títulos como «Leyenda de la Temporada 2».

**Importación al arrancar:**
- Solo en el arranque de producción, nunca en las pruebas, y solo si hay una versión de `season` guardada.
- Con candado de base de datos. Si falla, lo apunta en el registro y lo reintenta el proceso por minuto, sin tumbar el arranque.
- **Crea la ficha de la temporada viva** desde la configuración publicada. Al desplegar será la T1, del 12/11 23:00Z al 22/11 23:00Z, que son sus fechas reales en PRE.
- **Crea fichas `closed` para lo que haya en `season_archive`.** Si una se cerró antes de tiempo, su fin se recorta a la fecha de cierre, para no chocar con la regla de solapes.

**Cierre:**
- **Desde el PR 1,** `closeDue` cierra de forma perezosa cualquier ficha cuyo fin ya pasó, con los premios de cierre de su propia ficha. Así la T1 se archiva aunque el proceso automático llegue tarde.
- **El PR 2 añade el proceso por minuto,** `startSeasonJobs`, como `mail/jobs.ts`. Cuando una ficha llega a su fin:
  1. Escribe `season_archive` y `season_results`.
  2. Guarda en la misma inserción la foto final en `season_archive.stats`:
     - jugadores, partidas, enemigos eliminados, Núcleos y extracciones;
     - capa máxima, y sector y sonda más jugados;
     - reparto por tramos;
     - podio con nombre, avatar y marco;
     - los N primeros de cada pestaña.

     Así no hace falta el permiso UPDATE en esa tabla.
  3. En la misma transacción, envía un **aviso al buzón sin premios**: «La Temporada X ha terminado. Quedaste N.º en el tramo T», con un botón a `/temporada`.
     - `sendSystemMail` acepta el tipo y el enlace.
     - Los tipos nuevos `season` y `tournament` necesitan migración.
     - Si el cierre se repite, no hace nada.
  4. Cuando empieza la siguiente:
     - se marca `announced_at`, así un reinicio ni repite ni pierde el aviso;
     - el hub en directo gana un método para enviar a todos (`live-hub.ts`) y un aviso nuevo de inicio de temporada (`live-notices.ts`);
     - el cliente refresca temporada, clasificación, misiones, boosts y laboratorio.

**Premios:**
- **Los premios de temporada y de torneo se recogen en su pantalla,** como hoy (`claimResult`), y no caducan.
- **Formatos por entrega:**
  - **PR 1:** la ficha guarda la ruta en el formato de hoy, copia exacta, pagada por el código de hoy.
  - **PR 2:** premios de cierre por tramo y por puestos o rangos (`[{from, to, gifts}]`).
  - **PR 4:** la ruta y la tienda pasan a `Gift[]`, con `seasonRewardToGifts()` para lo antiguo, y se pagan con `grantGifts`. Cada pago tiene su fila de guardia: `grantGifts` no es idempotente por sí solo.
- **Las galaxias de premio** salen de una semilla de servidor (`season:<id>:step:<at>:<cuenta>`), nunca de la clave del cliente.
- **Los premios de una temporada futura** se validan con la fecha de su inicio.
- **`bigGiftReasons`** se comprueba por artículo y por número de cuentas.
- **«Puede ganar premios»:** columna `accounts.prize_eligible`, activada por defecto. La cambia un admin desde la ficha del jugador, con auditoría.
  - Si está apagada, el jugador sale con una marca y no recibe premio por puesto: lo recibe el siguiente con derecho.
  - Los premios por tramo y la ruta no cambian.
  - `guardGift` deja de bloquear al staff en los premios de su pantalla.

**Histórico para jugadores:**
- `GET /galaxy/api/seasons/history`.
- `GET /galaxy/api/seasons/:id/results?tab=`, con caché larga. General sale de `season_results`; las demás pestañas, de la foto o recalculadas por ventana. Incluye tu fila y las estadísticas.
- El salón de la fama y el perfil enlazan a ellas.

**Durante un hueco entre temporadas,** el nombre de la moneda sale de la última ficha.

**Carpetas de operación, prueba de lanzamiento y CLI:**
- **Un fichero `temporada.json` por carpeta,** con la ficha completa. Lo aceptan `launch-config.test.ts` (que deja de tratarlo como extraño), `check-config` y `ops-bundle`.
- **Se convierten** la plantilla `ops/plantillas/temporada/` y la carpeta de la T2.
- **En la prueba,** una temporada antigua termina donde empieza la ficha siguiente.
- **CLI:** `season-list`, `season-show <id>`, `season-import` (lee por la entrada estándar con `ops-bundle`, porque la CLI del contenedor no ve carpetas), `season-schedule <id> --reason`, `season-extend <id> <fecha> --reason`.
- **Las skills `galaxy-temporada` y `galaxy-publicar-config` se actualizan en el PR 1.**

### 2. Admin: pantalla «Temporadas» (`/admin/temporadas`)

**Línea de tiempo** con pasadas, actual y próximas:
- **Cada tarjeta muestra** nombre, fechas en hora de Madrid, estado y, para la actual, días restantes y jugadores.
- **Avisos:** días sin temporada entre dos fichas, y temporadas con algo pendiente.
- **Acciones:**
  - nueva temporada, normalmente **duplicando la anterior**;
  - editar, programar, desprogramar y borrar un borrador;
  - ver el resultado de una cerrada.

**Asistente por pasos**, al estilo de `EventWizard`. Cada paso explica en lenguaje llano qué hace, avisa en vivo y se guarda solo como borrador:
1. **Datos.** Nombre, id, fechas con el inicio propuesto en el fin de la anterior, y aviso de huecos o solapes.
2. **Puntos y tramos.** Con un ejemplo vivo: «una partida típica de 20 min da ~X puntos; el tramo Oro pide ~N partidas».
3. **Ruta de recompensas.** Pasos con un selector visual de premios: el editor de regalos del buzón, con `GiftArt` y packs.
4. **Tienda.**
5. **Premios de cierre** por tramo y por puestos o rangos.
6. **Misiones de temporada.**
7. **Laboratorio de temporada.** Plantilla copiada de la anterior.
8. **Anomalía y acabado.**
9. **Revisión.** Lista de comprobación; botones «Ver la tienda como jugador» y «Ver la clasificación como jugador»; **Programar** con motivo y contraseña (`PublishFields`). Si los premios superan `mailLimits`, pide superadmin.

**El mínimo del PR 3:** la línea de tiempo y los pasos 1, 2 y 9 (datos, reglas, programar y vista previa). La ruta, la tienda, los premios, las misiones y el laboratorio se ven en solo lectura con «Importar desde una carpeta». Sus editores llegan con el PR 4, cuando el formato de premios nuevo ya se pueda pagar.

**Vista previa (admins con MFA):**
- En el servidor, `GET /season?preview=<id>` y `GET /leaderboard?season=<id>` calculan la vista con la ficha programada, en solo lectura y con tu progreso a cero.
- En el cliente, `/temporada?vista=<id>` y `/clasificacion?temporada=<id>` muestran la franja «Vista previa: Temporada 3, empieza el 31/12» y los botones desactivados.

### 3. Jugador: Temporada y Clasificación

**`/temporada`:**
- **Barra de recursos** con `WalletBar` arriba a la izquierda, como en Misiones, más un chip **Esquirlas** (`season:<id>`).
- **`ClaimFx` generalizado:**
  - el destino pasa a `[data-wallet] .res.<tipo>`;
  - tipos nuevos: Esquirlas, galaxia, cosmético y sonda. Los que no son moneda vuelan al icono de Colección o del Taller, o salen como carta;
  - `playClaim` suma sus sonidos.
- **Comprar, recoger la ruta y recoger los premios de cierre** reproducen sonido, chips volando y la cifra subiendo. Lo grande lanza `Celebration`.
- **«Recoger todo»** en la ruta.
- **Cuenta atrás en vivo:** `Countdown` se exporta a `ui/Countdown.tsx`.
- **Los premios se pintan con `GiftArt`.**
- **Tienda:** marca lo que puedes pagar y lo agotado, y pide confirmación en compras caras.

**`/clasificacion`:**
- **El bloque Temporada** es entero un enlace a `/temporada` («Ver ruta y tienda»). Muestra:
  - cuenta atrás;
  - tus puntos, tu puesto, tu tramo y lo que te falta para el siguiente;
  - premios de cierre por tramo y por puestos;
  - jugadores totales;
  - torneos en curso con tu puesto;
  - enlace al salón de la fama.
- **Selector de temporada:** la actual o las pasadas. Las pasadas muestran el resultado final, el podio, tu resultado y sus estadísticas.
- **General gana dos columnas, «Partidas» y «Mejor capa».** Salen del mismo agregado.

### 4. Imágenes (ya existe casi todo)

La tabla `galaxy.media_assets` y las rutas `POST /galaxy/api/admin/media` y `GET /galaxy/api/media/:id` (`apps/server/src/news/routes.ts`) ya existen: PNG, JPEG o WebP, 2 MB como máximo, sin duplicados por sha256. Falta:
- la cabecera `Content-Security-Policy: default-src 'none'` al servir;
- la regla de medidas del banner (recomendado 1600×600);
- que `usesOf` (`news/service.ts`) cuente los banners de torneos, para no borrar una imagen en uso.

### 5. Torneos

**Tablas:**

`galaxy.tournaments`:
- `id uuid`, `slug`, `season_id` (la temporada que lo contiene);
- `title`, `summary`, `rules` (texto), `banner_media`, `details_media`;
- `starts_at`, `ends_at`;
- **`state`:** `draft` | `scheduled` | `running` | `review` | `finished` | `cancelled`;
- **`exclusive`** (true por defecto);
- **`metric`:** `points` | `kills` | `runs` | `best_run` | `depth` | `cores` | `extractions` | `season_points`;
- **`filters`:** `{ sector?, probe?, mode: 'solo' | 'coop' | 'any', minLevel? }`;
- **`entry`:** `{ currency: coins | dust | signal, amount } | null`;
- **`prizes`:** `[{ from, to, gifts: Gift[], cash?: { amountEur, note } }]`;
- **`participation`:** `{ minRuns, gifts } | null`;
- `review_hours` (24 por defecto), `max_entrants?`, `version`, auditoría.

**Comprobaciones de la ficha:**
- rangos de puestos sin solapes y empezando en 1;
- entrada y `cash` no pueden ir juntos;
- 28 días como máximo;
- debe caber en su temporada.

**Inscripciones:** `galaxy.tournament_entries`:
- clave `(tournament_id, account_id)`;
- `joined_at`, `left_at`, `entry_key`, `refunded_at`, `disqualified` y su motivo;
- `final_rank`, `final_score`, `rewards` (congelado) y `claimed_at`.

**Revisión:** `galaxy.tournament_checks`, con `run_id`, estado `pending` | `ok` | `mismatch` | `error` | `unverifiable`, detalle, decisión del admin y fecha.

**Cómo se puntúa** (`computeTournamentRanking`, el mismo patrón que `computeRanking`):
- **Partidas que cuentan:** las de los inscritos con `finished_at` en `[max(joined_at, starts_at), min(left_at, ends_at))`.
- **Se excluyen** las sospechosas y las de menos de `minRunSeconds`. Se aplican los filtros de sector, sonda y modo.
- **Solo cuentan partidas,** nunca misiones ni ajustes.
- **Qué calcula cada medida:**

  | Medida | Cálculo |
  |---|---|
  | `points` | Suma de la fórmula de `seasonPoints` con las reglas de su temporada |
  | `best_run` | El máximo de lo mismo por partida |
  | `kills` / `cores` | Sumas |
  | `extractions` | Recuento de partidas extraídas |
  | `runs` | Recuento |
  | `depth` | Máximo |
  | `season_points` | Lo de `points`, pero desde el inicio de la temporada hasta el fin del torneo. Inscribirse solo da derecho a optar |

- **Desempate:** quien llegó antes, y después el nombre.
- **Caché** de 30 s, invalidada al terminar una partida solo si su jugador tiene una inscripción viva.
- **Índice:** `runs (account_id, finished_at) where not suspicious`.

**Inscribirse y salir** (`POST /galaxy/api/tournaments/:id/join` y `/leave`):
- Con clave de idempotencia, límite de peticiones y transacción con **candado por cuenta**. El bloqueo de la fila del torneo no basta: hay que impedir inscribirse en dos exclusivos a la vez.
- **Al inscribirse, el servidor comprueba** el nivel mínimo, el cupo y, en torneos exclusivos, que no tengas otra inscripción viva en un exclusivo que se solape en fechas.
- **Entrada:** se cobra con `debit`. Salirte no la devuelve, y el diálogo lo avisa antes. Cancelar el torneo la devuelve a todos (`refunded_at`).
- **Salirte borra tu puntuación,** y no se puede volver.
- **Las ediciones de admin** usan la `version` de la ficha y la contraseña.

**Ciclo de vida** (`startTournamentJobs`, cada minuto):
1. **`scheduled → running`** en `starts_at`, con aviso en directo a los inscritos.
2. **`running → review`** en `ends_at`: se congela la clasificación y entran en cola las partidas en solitario que cuentan para los puestos con premio. En `best_run` es solo la mejor; en las sumas, todas. Las de grupo ya las arbitra el servidor.
3. **Resimulación:**
   - `replayOptionsOf` y `checkReplay` pasan de `apps/web/src/admin/replay/playback.ts` a `packages/shared`.
   - Además del hash, las ticks, los enemigos, la capa y el nivel, se comparan los **Núcleos y el desenlace**.
   - En producción corre en un **worker thread**: tercera entrada de tsup (`replay-worker.js`), concurrencia 1. En las pruebas corre dentro del proceso.
   - **Si no coincide:** la partida pasa a sospechosa con la bandera `replay_mismatch` y se recalcula, y entran en cola las de quien sube.
   - **Si no se puede comprobar** (faltan entradas, otra versión de simulación, o contenido que ya no se lee): `unverifiable`, **y espera la decisión de un admin**.
4. **Panel de revisión:** estado de cada comprobación; aceptar o descartar las no comprobables; descalificar con motivo; todo auditado.
5. **`review → finished`** cuando acaba `review_hours` **y no queda nada pendiente**, o con «Publicar ya». Si el plazo pasa con cosas pendientes, el panel avisa y no se publica.
   - Se congelan `final_rank`, `final_score` y `rewards`, con «puede ganar premios» aplicado.
   - Cada ganador recibe un **aviso al buzón** con un botón a la página del torneo, donde **recoge** sus premios con animación y sonido.
   - El premio de participación funciona igual.
   - **Premios en dinero:** el ganador recibe un aviso; el admin ve «Premios en metálico pendientes», los marca como pagados (queda auditado) y contacta por el buzón. El juego no pide datos bancarios.
6. **Aviso al desplegar:** el panel avisa si hay torneos en curso y el despliegue sube `SIM_VERSION`.

**Retención:** `prune_retention` conserva las entradas de las partidas que cuentan en un torneo sin terminar. Hoy se borran a los 30 días.

**Pantallas del jugador:**
- **`/torneos`:** pestañas En curso, Próximos y Terminados. Cada tarjeta lleva banner, estado, cuenta atrás, resumen de premios, inscritos, tu estado y tu puesto, e «Inscribirme» o «Salir». Antes de inscribirte, un diálogo avisa de la entrada, la exclusividad y que salir borra tu puntuación.
- **Página del torneo:**
  - banner, resumen, imagen de premios y reglas en claro;
  - tabla de premios por puesto;
  - clasificación con podio y tu fila fija;
  - tus partidas que cuentan;
  - estados de revisión y resultado;
  - el botón de recoger.
- **Al terminar una partida,** una línea con lo que suma en el torneo y tu puesto, con flecha de subida. El texto exacto, sin «·» ni «:», lo propongo al propietario como opciones.
- **Accesos:** botón «Torneos» en el menú principal y en el raíl del lobby, con un punto pequeño si hay inscripción abierta. También el bloque en la clasificación y toasts al empezar, al terminar y al publicar resultados.
- **Los títulos nuevos de pantalla** se presentan al propietario como opciones, según su estilo.

**Admin `/admin/torneos`:**
- **Listado por estado.**
- **Asistente:**
  1. **Datos:** título, resumen, reglas, y banner e imagen subidos con vista previa.
  2. **Fechas.**
  3. **Cómo se gana:** medida con explicación y ejemplo; filtros.
  4. **Inscripción:** exclusivo, entrada, nivel mínimo, cupo.
  5. **Premios:** rangos con el selector de regalos y packs, dinero opcional y premio de participación.
  6. **Revisión:** la tarjeta y la página como las verá el jugador; programar con motivo y contraseña.
- **Permisos de los premios:** por encima de `mailLimits`, o con dinero, programar pide superadmin.
- **Acciones:** duplicar, cancelar (con devolución) y los paneles de revisión y de premios en metálico.

### Seguridad y escala (en todo)

**Seguridad:**
- **Las puntuaciones las calcula siempre el servidor** a partir de partidas.
- **Escrituras:** clave de idempotencia, límite de peticiones, transacción y fila de guardia en cada pago.
- **Acciones de admin:** MFA y contraseña al programar; superadmin para lo grande.
- **Auditoría y errores:** todo se audita en `audit.ts`, y los errores nuevos van en `API_ERROR_CODES` con su texto.

**Escala:** caché e índices en los cálculos pesados; resimulación en un worker, de una en una; procesos por minuto idempotentes.

## Fuera de alcance

- Torneos de clanes.
- Pagos en dinero desde el juego.
- Torneos sin inscripción.
- Borrar las claves de configuración antiguas.

## Entregas (un PR a develop cada una, con nota de versión, CI y despliegue vigilado)

| # | PR | Contenido | Objetivo |
|---|---|---|---|
| 1 | `feature/galaxy-temporadas-fichas` | Tablas e historial, lector envuelto, importación, cierre perezoso de fichas pasadas, publicación antigua rechazada, comprobaciones por ficha, `temporada.json` y prueba de lanzamiento, CLI `season-*`, skills al día, carpeta de la T2 convertida | **Ruta crítica de la T2** |
| — | **Operación T2** | En PRE: `season-list` (la T1 importada con fechas reales) → `season-import` de la T2 → `check-config` → **programar con el OK del propietario**. El mismo día, publicar con su OK los eventos en una lista de tres (`primer-torneo` hasta las 23:00Z, `rumbo-profundo`, `escuadron-estelar`), los escáneres y los logros | Domingo 22/11 |
| 2 | `feature/galaxy-temporadas-cierre` | Proceso por minuto, foto de estadísticas, avisos de cierre, aviso de inicio en directo, premios de cierre por puestos, «puede ganar premios» | 22–23/11 |
| 3 | `feature/galaxy-temporadas-admin` | Línea de tiempo, asistente (datos, reglas, revisión), programar y vista previa | 22–23/11 |
| 4 | `feature/galaxy-temporada-tienda` | `/temporada` con barra y Esquirlas, `ClaimFx` y sonidos generalizados, `GiftArt`, recoger todo, cuenta atrás; `Gift[]` en ruta y tienda; editores de ruta, tienda, premios, misiones y laboratorio en el asistente | Después |
| 5 | `feature/galaxy-clasificacion` | Bloque Temporada enlazado y completo, selector e histórico, columnas nuevas, páginas de resultados | Después |
| 6 | `feature/galaxy-torneos` | Tablas, puntuación, inscribirse y salir con entrada, ciclo, resimulación en worker, revisión, retención, CSP y `usesOf` de las imágenes | Después |
| 7 | `feature/galaxy-torneos-admin` | Asistente, paneles de revisión y de premios en metálico | Después |
| 8 | `feature/galaxy-torneos-jugador` | `/torneos`, página del torneo, línea tras la partida, accesos, toasts, bloque en la clasificación | Después |

**Plan B de la T2:**
- **Si el PR 1 no está en PRE y comprobado el domingo 22/11 a las 21:00,** no se despliega hasta después de medianoche. La T2 se publica a la antigua a las 00:00 con el OK del propietario; la importación posterior la recoge como ficha.
- **Si el PR 1 ya está desplegado,** la T2 solo sale con `season-schedule`.
- **La otra opción del propietario** es ampliar el plazo.

**Al acabar:** crear la skill `galaxy-torneo` y actualizar `docs/GDD.md` §13 y `docs/CONTENIDO.md`.

## Piezas que se reutilizan

| Pieza | Dónde |
|---|---|
| `closeDue`, `rewardsFor`, `claimResult`, `hallOfFame`, `seasonHistory` | `apps/server/src/season/close.ts` |
| `computeRanking`, `cachedRanking`, `invalidateLeaderboard` | `apps/server/src/social/leaderboard.ts` |
| Lector de configuración, `mergeDraft`, `configIssues` | `apps/server/src/config/service.ts` |
| `seasonOpen`, `seasonPoints`, `seasonTier` | `packages/shared/src/progress/season.ts` |
| `opsProblems` | `packages/shared/src/config/ops-checks.ts` |
| `grantGifts`, `giftSchema`, `bigGiftReasons`, `mailLimits` | `apps/server/src/gifts/grant.ts`, `packages/shared/src/gifts/*` |
| `sendSystemMail` | `apps/server/src/mail/system.ts` |
| Proceso por minuto | `apps/server/src/mail/jobs.ts` |
| Resimulación | `runReplay` (`apps/server/src/admin/runs.ts`), `replayOptionsOf` y `checkReplay` (`apps/web/src/admin/replay/playback.ts`) |
| Imágenes | `media_assets`, `apps/server/src/news/routes.ts` |
| Directo | `apps/server/src/realtime/live-hub.ts`, `packages/shared/src/api/live-notices.ts`, `pushToast` |
| `WalletBar`, `useClaimFx`, `playClaim`, `Celebration`, `GiftArt`, `Podium`, `TierEmblem` | `apps/web/src/hub`, `missions`, `ui`, `gifts`, `social/parts.tsx` |
| `EventWizard`, `PublishFields`, `humanDiff` | `apps/web/src/admin/**` |

## Verificación

**Pruebas:**
- **TDD en cada PR:**
  - fichas, solapes (también diferidos) y el lector envuelto, incluido el cambio exacto a las 00:00 y los huecos;
  - importación, con un archivo recortado;
  - rechazo de la publicación antigua;
  - medidas de torneo, exclusividad con concurrencia, entrada y devolución, rangos y «puede ganar premios».
- **Integración (en CI):**
  - cierre perezoso y por el proceso, con los premios de su ficha y sin pagar dos veces;
  - histórico;
  - revisión con una resimulación que no coincide y con una no comprobable;
  - `cli-config` y `config-admin` actualizados.
- **Navegador:** vuelo de chips en la tienda y vista previa.
- **`launch-config.test.ts`** con `temporada.json` en la carpeta de la T2 y en la plantilla.

**En PRE, sin crear cuentas:**
- **Tras el PR 1:**
  - `season-list` muestra la T1 con sus fechas reales;
  - la clasificación, la tienda y las Esquirlas dan lo mismo que antes;
  - publicar `season` a la antigua se rechaza.
- **Tras programar la T2:** `season-list` y `check-config` la aceptan.
- **El 23/11 a partir de las 00:00:**
  - la primera lectura cierra la T1, que queda en `season_archive` (o lo hace el proceso, si ya está el PR 2);
  - la T2 queda activa;
  - salud OK y sin errores en `docker logs`;
  - una partida da Esquirlas de la T2.

**Revisión final:** una revisión completa de cada rama antes de unirla.

## Decisiones mías (para que las revises)

1. **Lector envuelto:** el código sigue leyendo «la temporada» como antes, pero sale de las fichas. Es el cambio más pequeño y seguro.
2. **El mínimo del asistente en el PR 3:** datos, reglas, programar y vista previa. Los editores de premios llegan con el PR 4.
3. **Duración y revisión:** un torneo dura como máximo 28 días; la revisión por defecto es de 24 h; las entradas de partidas no se borran mientras cuentan.
4. **Salir de un torneo no devuelve la entrada;** cancelar el torneo, sí.
5. **Dinero:** el juego no pide datos bancarios. El admin contacta por el buzón y marca el premio como pagado.
6. **«Puede ganar premios»** lo cambia un admin desde la ficha del jugador, con auditoría. No afecta a los tramos ni a la ruta.
7. **Los logros de la T2,** que son de por vida, se publican el domingo junto con los eventos.
8. **La moneda sobrante** se convierte con el `dustRate` de su propia temporada. En la T1 y la T2 vale 2, así que no cambia nada.
