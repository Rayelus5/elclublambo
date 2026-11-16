# Galaxy Survivor: editor visual de «content» en el panel de admin

## Contexto

`/galaxy/admin/configuracion/content` reúne casi todo el contenido de las incursiones y hoy solo se edita como JSON. Es la única clave que no tiene formulario (`JSON_ONLY` en `admin/forms/labels.ts`). Sus 22 campos de primer nivel son:
- 8 sondas, 58 armas, 25 pasivas, 25 enemigos y 18 Núcleos con fases y patrones;
- 5 sectores con oleadas, elementos y reacciones, reliquias, eventos y reglas.

**El propietario (16/11/2026) pide** la interfaz más completa, modular, escalable e intuitiva posible. Los admins no conocen el código y tienen que poder hacer cambios reales de todo tipo. A medida que crezca el juego, lo nuevo debe aparecer en el editor.

**Lo que hoy lo impide:**
- **El servidor rechaza peticiones de más de 64 KB** (`bodyLimit` en `app.ts:86`) y `content` pesa unos 180 KB.
- **El historial se descarga entero:** `/admin/config/keys` y `/versions` traen todas las versiones completas (N × 180 KB).
- **El borrador vive en `sessionStorage`:** se pierde y no se comparte.
- **Faltan piezas en el motor de formularios:** no entiende tuplas (`spawns.group`, `reaction.pair`), uniones de literales (`unlockAt` 4|8) ni uniones de objetos (`evolution.requires`).
- **Los errores salen en crudo:** los códigos propios del contenido (`content_ref:…`) no se traducen.
- **Un sprite inexistente rompe la arena** (`atlas.frames[id]!`) y nadie lo valida.
- **Varias pantallas leen el contenido del código y no el publicado:** el Códice, los conjuntos del hangar, la clasificación y listas del admin (CONTENIDO A5).
- **Hay textos ligados a cada id en el código:** el Códice (`SECTOR_TEXT`, `CORE_TEXT`, `BEAST_TEXT`), PERKINS por sector y Núcleo, y los nombres de peligros por sector. Una entidad creada en el panel saldría incompleta.
- **Las pruebas de incursión con borrador no admiten sectores ni sondas nuevos**, porque `startRun` los comprueba contra lo publicado.

## Decisiones del propietario

| Tema | Decisión |
|---|---|
| Alcance | Editar todo y crear entradas nuevas de los tipos que ya existen (enemigos, Núcleos, sectores, armas, evoluciones, variantes, pasivas, sondas, reacciones, conjuntos, anomalías, ajustes de eventos), eligiendo el dibujo de una galería de sprites existentes. Sin subir arte. Un comportamiento nuevo sigue necesitando código. |
| Publicar | Borradores guardados en el servidor: no se pierden, se retoman y los ven los demás admins. El mismo admin los prueba en una incursión y los publica con motivo y contraseña, tras ver el resumen de cambios y avisos. Sin revisión de otro admin. |
| Enfoque | **A:** motor que genera el editor desde el esquema del contenido, más un registro de descripciones (nombres, explicaciones, secciones, unidades y controles ricos), más asistentes «Crear…». Lo nuevo del juego aparece solo, y un test obliga a describirlo en español. |

## Decisiones mías (dímelas si quieres otra cosa)

- **Las entidades ya publicadas no se borran desde el panel.** Su id es permanente, y la usan partidas antiguas y datos de jugadores. Se pueden retocar y desenganchar (quitar de oleadas, ciclos…). Lo creado en un borrador sin publicar sí se borra.
- **Publicar `content` lo puede hacer cualquier admin con TOTP**, como el resto de la configuración.
- **Reordenar sectores y armas está permitido con aviso**: el orden de sectores es el de dificultad, y el de armas, el de las ofertas.
- **Los textos ligados a cada id pasan a `content`** como campos opcionales. Si un campo está vacío, se usa el texto actual del código.
- **Toda la web lee el contenido publicado** (`useLiveContent`). La regla de «tocar también `DEFAULT_CONTENT`» desaparece de CONTENIDO A5.
- **La prueba con borrador es solo en solitario.** El árbitro de las partidas en grupo usa siempre lo publicado.

## Arquitectura

- **Borrador en el servidor.** Guarda solo los campos de primer nivel cambiados, de una o varias claves a la vez: `content`, y también `sectors` y `probes` para desbloqueos y paga de lo nuevo. Lleva las `baseVersions` de las que partió y una `revision`.
  - **Conflictos:** si lo publicado avanza, se rebasa por entidad (por id) contra la versión base, que siempre está en `game_config_versions`, que es de solo añadir.
  - **Publicar por id de borrador:** usa `publishMany` (todo o nada), así que el tamaño no importa.
- **Motor de formularios con proveedores.** `labels.ts` sigue siendo el proveedor del resto de claves. `content` tiene su registro en `admin/content/descriptors/`. Lo que no esté descrito se ve igualmente con controles genéricos, pero un test falla.
- **El editor tiene tres niveles:** zonas, lista de entidades y ficha.
  - Enlaces directos del tipo `/admin/configuracion/content/fauna/mite?borrador=<id>`.
  - Estado en Zustand con compartición estructural (`setIn`), para que las comprobaciones y el diff solo repasen lo que ha cambiado.
  - El JSON queda como pestaña «Avanzado».

## Entregas (PR a `develop`, cada uno desplegable en PRE)

**P1. API de configuración ligera y contenido publicado en toda la web** (1–2 días)
- **Servidor** (`config/routes.ts`, `service.ts`):
  - `/keys` devuelve resúmenes y deja `content` para pedirlo aparte;
  - nuevo `GET /admin/config/:key` y `GET /:key/versions/:v` bajo demanda;
  - `/versions` pasa a dar solo resúmenes;
  - `bodyLimit` de 1 MiB en publicar, validar y lote.
- **Web:**
  - `useConfigKey` y `useConfigVersion` en `api/config.ts`;
  - `contentOptions` pasa a usar `useLiveContent`;
  - el Códice (`codex/entries.ts` recibe el contenido), la clasificación, `ProbesPanel`, `SetsPanel`, `RunsScreen`, `LiveRooms` y `EconomySimulator` leen lo publicado;
  - tras publicar se invalida el contenido en caché.

**P2. Borradores en el servidor y «Probar en incursión» por id** (4–5 días)
- **Base de datos:**
  - migración `…_galaxy_config_drafts.sql` con id, título, `data`, `base_versions`, `revision`, `status` (abierto, publicado o descartado), autores y fechas, y un límite de 4 MB;
  - RLS como en `galaxy_config.sql`;
  - `prune_retention()` borra los cerrados a los 30 días;
  - el tipo de la tabla, en `db/schema.ts`.
- **Shared:** `api/config-drafts.ts` y `config/rebase.ts` (`rebaseDraft`, que fusiona por id y sigue el orden del borrador).
- **Servidor:** `config/drafts.ts` y `drafts-routes.ts`.
  - **Rutas:** listar, crear, leer, guardar un campo (`PUT …/field` con `revision`, 409), validar, rebasar, publicar y descartar.
  - **Publicar** pide motivo y contraseña y usa `publishMany`.
  - **Auditoría:** `config.draft.*`.
- **Incursión de prueba:**
  - `startRunRequest` admite `draft` junto a `test: true`;
  - `runs/routes.ts` fusiona el borrador sobre lo publicado, lo valida, y deja de exigir el sector desbloqueado y la sonda propia;
  - las salas rechazan los borradores.
- **Web:**
  - fuera `content-draft.ts`;
  - el hangar lee `?borrador=` y muestra una franja de prueba;
  - en el editor JSON actual: lista de borradores, guardado automático y diálogo de rebase («Tu versión» o «La publicada», por entidad).

**P3. Motor de esquema completo** (2–3 días)
- `form-schema.ts`: añade `prefixItems`.
- `admin/forms/schema.ts`: tipos nuevos `tuple`, `enum` (para uniones de constantes) y `choice` (uniones de objetos por clave requerida), más patrones que distinguen la variante (`enemies[].behavior<shooter>.range`).
- `ConfigForm.tsx`:
  - recibe el proveedor de descripciones, los controles alternativos y las secciones;
  - los registros toman sus claves de una fuente (rasgos de galaxia o sectores);
  - `liveIds` se memoriza y las comprobaciones van diferidas (`useDeferredValue`).
- El resto de claves no cambia.

**P4. Descripciones y armazón del editor** (5 días; antes, la skill ui-ux-pro-max)
- `admin/content/descriptors/`:
  - `types.ts` con `FieldDesc`, `KindDesc`, `CollectionDesc` (tarjeta resumen con sprite, filtros y agrupación) y `AreaDesc`;
  - un archivo por zona: arsenal, sondas, fauna, Núcleos, sectores, elementos, reliquias, reglas y técnico, más `kinds.ts` con la explicación de cada tipo de arma, comportamiento, patrón, rasgo y reacción.
- **Errores en español:** `packages/sim` exporta `CONTENT_ISSUE_CODES` e `issues.ts` los traduce con contexto («La Colmena invoca a "xyz", que no existe»).
- **Pantallas:** `ContentHome` (borradores y zonas), `ContentEditor` (lista, ficha y, al lado, avisos y cambios), `EntityList` (búsqueda sin tildes, filtros, miniaturas), `EntityDetail` y `store.ts`, con rutas perezosas en `App.tsx`.
- **Textos y estilo:** `copy.admin.content.*` y CSS con el prefijo `ce-`. Se quita `content` de `JSON_ONLY`.
- **Tests:** `admin-content-descriptors.test.ts` exige que cada hoja del esquema tenga nombre y explicación, que cada tipo y cada código de error estén traducidos y que cada campo esté en una zona. Además, `admin-content.test.tsx`.

**P5. Galería de arte, selectores y referencias** (3–4 días)
- **Catálogo de arte:**
  - `packages/shared/src/content/art.ts`, generado: grupo, tamaño y frames de cada sprite;
  - `art-catalog.test.ts` lo compara con `SPRITES` y lo regenera con `GALAXY_WRITE_ART=1`;
  - `contentArtIssues` entra en `configIssues('content')`, así que el panel, el servidor y la CLI rechazan sprites que no existen o con un tamaño equivocado.
- **Arena y arte:** `stage.ts` pinta un sustituto ante un id desconocido en vez de romper, e `icons.ts` genera el `-evo` de cualquier icono base.
- **Referencias:** `packages/sim/src/content/refs.ts` construye el índice de «dónde se usa».
- **Controles:**
  - `RefPicker`: buscador accesible con miniaturas y «Se usa en N sitios»;
  - `SpritePicker`: galería por grupo y tamaño, con animación;
  - el botón de quitar se bloquea, explicando dónde se usa la entidad.

**P6. Controles ricos** (5 días; ui-ux-pro-max)
- **`LevelTable`:** niveles × las 11 columnas, con minigráficos.
  - Las columnas que el tipo de arma no usa salen atenuadas, según el mapa `weapon-fields.ts`.
  - Un test de la simulación demuestra ese mapa: tocar un campo cambia la partida solo si el tipo lo usa.
- **`PhaseTimeline`:** la barra de vida del Núcleo con sus fases y patrones.
- **`SpawnTimeline`:** minutos × enemigos, con los marcadores de oleadas.
- **`WeightBars`:** el reparto de eventos en %, general y por sector.
- **`KindPicker`:** tarjetas con explicación y un ejemplo; la opción «Otro: necesita programación» sale desactivada.
- **Otros:** `RangePair`, `ElementPair` y la matriz de reacciones de 11 × 11.
- **Restricción de estilo:** los gráficos en SVG, sin `style=""`.

**P7. Salvaguardas, impacto y simulación rápida** (4 días)
- **Avisos del contenido.** `packages/sim/src/content/checks.ts` (`contentWarnings`) avisa de:
  - orden de dificultad de los sectores;
  - armas sin evolución;
  - menos de 5 familias por sector;
  - enemigos o Núcleos sin usar;
  - claves desconocidas en eventos o paletas.

  Los tests de la CI pasan a usar estas mismas funciones.
- **Avisos entre claves:** `content-companions.ts` avisa de desbloqueos o paga que faltan para un sector o una sonda.
- **Revisión antes de publicar:**
  - `Impact` muestra los cambios por entidad, qué pantallas tocan y que las incursiones en curso siguen con su versión;
  - `PublishReview` añade «He leído los avisos» y los campos de publicar.
- **Simulación rápida:**
  - `packages/sim/src/bot-run.ts` (`playBot`);
  - un worker y `QuickSim` comparan lo publicado con el borrador en varias semillas: duración, Núcleo y muerte.

**P8. Textos dentro del contenido** (2–3 días)
- **Campos nuevos opcionales** (≤ 400 caracteres): `sectors[].lore`, `sectors[].radio`, `sectors[].hazardNames`, `bosses[].lore`, `bosses[].radio` y `enemies[].lore`.
- **Respaldo:** los mapas del código se mudan a `codex/texts.ts`. El Códice, PERKINS y los nombres de peligros leen primero el contenido y, si está vacío, el código.
- **Compatibilidad:** un test comprueba que el contenido antiguo sigue validando. No hace falta subir `SIM_VERSION`.

**P9. Asistentes «Crear…»** (7–8 días, en dos PR)
- Siguen el patrón de `EventWizard`: pasos con su recuento de errores y «Basado en…», que copia una entidad parecida. El id sale del nombre.
- **9a:** enemigo (exige aparecer en alguna oleada, invocación o división, y tener su texto), pasiva, reacción, anomalía y conjunto.
- **9b, con piezas enlazadas:**
  - Núcleo: 1 a 3 formas, fases y su sector;
  - sector: bioma, Núcleo, dificultad con el gráfico del orden, oleadas, eventos, y desbloqueo y paga en el mismo borrador;
  - arma base: con su evolución obligatoria y una variante opcional;
  - sonda: con su desbloqueo.

**P10. Documentación** (1 día, y cada PR actualiza la suya)
- CONTENIDO: A4 (el panel también es fuente; los borradores en código parten de lo publicado), A5 (fuera), A6 (catálogo de arte), A7 (textos en el contenido) y B1 (borradores, prueba y publicación).
- DESIGN_SYSTEM §8 septendecies, con el editor de contenido.
- Las skills `galaxy-*`.

## Riesgos

- **Rendimiento con unos 180 KB por edición.** Se mitiga con comprobaciones diferidas, cortes por referencia en cada campo de primer nivel, guardado de un campo por petición y la ruta cargada bajo demanda.
- **El determinismo no se toca**, porque el contenido son datos. Las pruebas con borrador no guardan entradas y van solo en solitario.
- **Compatibilidad del esquema.** Todo campo nuevo es opcional o lleva valor por defecto. Una vez publicado algo que lo usa, nunca se revierte, porque el esquema es estricto. Se arregla hacia delante.
- **`DEFAULT_CONTENT` se desfasa de lo publicado.** Pasa a ser inofensivo cuando toda la web lea lo publicado (P1), pero los cambios en código parten de `draft-config`.

## Verificación

- **TDD en cada PR.** En local, solo los tests de los archivos tocados: `vitest --project unit|web`, `tsc` y `eslint`. La integración, el e2e y `config.test.ts` solo se pasan en la CI.
- **Capturas a 1280, 1600, 1920 y 2560**, sin desbordar la página: `apps/web/test/browser/admin-content.browser.test.ts` con `VITE_ADMIN_SHOTS=1`.
- **En PRE (lo pruebas tú):**
  1. Crear un borrador, retocar la vida de un enemigo y probarlo en una incursión.
  2. Publicarlo y ver que el Códice lo refleja.
  3. Crear un enemigo con el asistente y verlo en su sector.
  4. Comprobar que un conflicto con lo publicado se resuelve por entidad.
- **Al final de cada bloque grande** (P1–P3, P4–P6, P7–P9), una revisión independiente.
- **Forma de trabajo:** PR a `develop` y nunca a `main`. CI en verde, integrar y vigilar el despliegue `preproduction`.
