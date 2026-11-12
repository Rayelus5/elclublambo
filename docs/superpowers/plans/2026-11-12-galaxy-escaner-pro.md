# Galaxy Survivor: escáner pro, ajustes nuevos, daltonismo, reliquias, perfil y admin

## Contexto

El propietario pide un plan grande con ocho mejoras:
1. un modo para daltónicos;
2. elegir las galaxias del fondo del menú, en orden aleatorio;
3. ver en directo las partidas individuales desde el admin;
4. una lista completa de jugadores en el admin, con paginador, filtros, búsqueda y la opción de eliminar;
5. avatares sin caja en el podio y el perfil (el marco hace de borde), con el mismo ancho con o sin marco;
6. rediseñar los ajustes (en partida y `/galaxy/ajustes`) con controles propios;
7. filtrar la colección por fenómeno, y una ficha de reliquia (poderes, 3D y «Equipar») antes de equipar y desde `/coleccion/:id`;
8. **la más importante:** una «Presentación pro del escáner» cinematográfica.

**Respuestas del propietario (hoy):**
- **Presentación pro:** activada por defecto; se puede apagar en Ajustes.
- **Estela:** anticipa la rareza máxima, con «ascensos» sorpresa a veces.
- **Eliminar jugador:** anonimizar y cerrar. El nombre queda libre salvo que el admin marque «Reservar el nombre».
- **Avatar sin marco:** crece y llena el hueco del marco.

**Lo que hay hoy** (exploración):
- **Escáner:** `scanner/RevealStage.tsx` (un `Dialog`, la secuencia pura `reveal-sequence.ts`, partículas 2D en `RevealFx.tsx`/`fx.ts`, sonidos sintetizados en `scanner/sfx.ts`).
  - `ScannerScreen` lo monta solo cuando llega la respuesta (`onSuccess`).
  - También lo usan la fusión (`CollectionScreen.tsx:216`) y el tutorial (`emitTour`).
- **Audio:** todo sintetizado (`audio/mixer.ts`, `music.ts`, `synth.ts`). No hay archivos.
  - El servidor devuelve el `index.html` con un 200 para cualquier ruta desconocida bajo `/galaxy/`, así que un archivo de `public/` que falte no da 404.
- **Ajustes:** cada uno en su propio `localStorage`, con controles nativos en `settings/SettingsSections.tsx` (los usan `hub/SettingsScreen.tsx` y `arena/hud/PauseMenu.tsx`).
  - El movimiento reducido solo sigue al sistema: 39 bloques `@media` en `app.css`, más `matchMedia` en `main.tsx`, `GalaxyBackdrop.tsx` y `PrimaryButton.tsx`.
- **Colores con significado:**
  - **CSS:** tokens de rareza en `app.css:39-43`, con copias en `scanner/fx.ts` y `RelicStrip.tsx`.
  - **Pixi** (`arena/stage/stage.ts`):
    - las constantes `KILL_COLOR`, `ELEMENT_COLOR` y `TEAM_TINT`;
    - la vida de un compañero, verde o roja;
    - los arcos de caído y reanimar, rojo y verde;
    - las marcas de elemento, donde `hack` y `prism` comparten color.
  - **Sprites** (`arena/sprites/items.ts`): se generan al crear el escenario.
  - No hay ninguna opción de daltonismo.
- **Reliquias:** pulsar una galaxia en `cards/GalaxyPicker.tsx` la equipa al momento.
  - `relicSkill` (`packages/sim/src/systems/relics.ts:50`) calcula todo.
  - `skillTags` (`hangar/SkillTags.tsx`) solo cuenta familia, elemento, fenómeno y potencia.
  - El hangar describe con `DEFAULT_CONTENT`, no con la configuración viva.
- **Colección:** filtros en la URL que se aplican en el servidor (`collection/service.ts` `listQuerySchema`).
  - El fenómeno es `traits->>'phenomenon'`: uno por galaxia, que puede ser `none`.
  - El detalle es `collection/GalaxyDetailDialog.tsx`, con una carta 280 y «Inspeccionar» (`inspector/Inspector.tsx`, three.js).
- **Fondo del menú:** `hub/TitleScreen.tsx` pide las 6 más raras y `backdropSeeds` las muestra en orden (quita la paleta antimateria y el fenómeno anomalía).
- **Jugadores en el admin:** `admin/PlayersScreen.tsx` no pide nada sin texto. `searchPlayers` busca por prefijo, con un máximo de 20 y sin páginas.
  - No existe ningún borrado.
  - Uno total es imposible: libros de movimientos de solo añadir, `shop_purchases` con `restrict`, y cascadas que borrarían historial de otros.
- **Directo:**
  - Las partidas en grupo se pueden ver: el servidor retransmite las entradas y el visor vuelve a simular (`coop/relay.ts`, `CoopArena.tsx`).
  - Las individuales no envían nada hasta acabar.
  - `CoopFeed` no sirve para solo: ignora la elección de mejora, y `createReplayer` se para para siempre.

## Stack de la cinemática (viabilidad)

| Propuesta | Decisión | Por qué |
|---|---|---|
| GSAP `timeline()` | **Sí:** `gsap@3.15.0` fijado, con licencia estándar gratuita, solo en el trozo pro | Una línea de tiempo mueve el DOM y la cámara y los uniformes de three.js. Fuera de las pruebas, la avanza el reloj de audio, así la imagen y el sonido no se separan. La 3.15.1 tiene una semana: esperamos. |
| Partículas / tsParticles / three.js | **three.js**, que ya es dependencia (trozo aparte, como el inspector) | Sin dependencias nuevas, con una escena 3D real. Si no hay WebGL2, se usa la versión clásica. |
| Howler.js | **No:** Web Audio con el mezclador propio | Howler duplicaría buses, volumen y silencio. |
| Context7 | No está disponible aquí | Las versiones se comprobaron con `npm view` y con el código. |

---

## Parte A. Ajustes nuevos (PR 1)

**Almacén** `apps/web/src/settings/prefs.ts`: zustand `persist`, clave `galaxy.prefs`, `version: 1` con `migrate`.
```ts
interface Prefs { scannerPro: boolean /* true */; motion: 'system' | 'reduced' | 'full'; colorVision: 'none' | 'protan' | 'deutan' | 'tritan' }
```
- **Cómo se usa:**
  - `usePrefs(selector)`, más `getPrefs()` para el código fuera de React;
  - `applyPrefs()` en `main.tsx` pone `data-motion` y `data-cvd` en `<html>`;
  - con la ventana privada, guarda en memoria.
- **Lo que no se toca:** `galaxy.audio`, el cursor y el apuntado se quedan en sus módulos, que ya están probados.
- **Movimiento:**
  - `useReducedMotion()` y el nuevo `prefersReduced()` (para las 3 llamadas a `matchMedia`) devuelven `motion==='reduced' || (motion==='system' && SO)`;
  - los 39 bloques `@media (prefers-reduced-motion)` pasan a `:root[data-motion='reduced']`, así «Completo» también puede contradecir al sistema;
  - el escenario gana `setOptions({ reduced, palette })`, de modo que un cambio en la pausa se aplica al momento.

**Componentes propios** en `apps/web/src/ui/`:
- **`Slider`:** un `range` nativo con estilo propio, relleno con `--fill` (CSSOM, que la CSP permite) y `<output>`.
- **`Switch`:** `button role="switch"`.
- **`Segmented`:** `radiogroup` que se mueve con las flechas.
- **`Select`:** el propio de siempre.
- **`SettingRow`:** etiqueta y pista a la izquierda, control a la derecha.

**`/ajustes`:**
- navegación lateral con iconos, que en móvil pasa a pestañas horizontales;
- la sección va en `?seccion=` (enlace directo y «Volver» correcto).

| Sección | Ajustes |
|---|---|
| Sonido | Música y efectos (`Slider`), sonidos de la interfaz y «Silenciar todo» (`Switch`), «Probar», y «Avisos» de la cuenta (`NoticeModeField`) |
| Imagen | Presentación pro del escáner (`Switch`), cursor propio, tamaño y color |
| Accesibilidad | Visión del color (`Select` con vista previa en vivo de rarezas, equipos, bien/mal y elementos), movimiento (Sistema / Reducido / Completo) |
| Partida | Apuntado manual |
| Ayuda | Lo de hoy |

**En partida** (`PauseMenu`): el mismo `SettingsPanel` con pestañas arriba. Sin la del escáner, y con la Ayuda limitada, como hoy.

**Tests:**
- `prefs`: persistencia y migración;
- la tabla de casos de `useReducedMotion`;
- los componentes con teclado y ARIA;
- `settings.test.tsx` adaptado;
- en el navegador, capturas a 1280, 1600 y 1920 y en móvil, sin desbordes.

## Parte B. Presentación pro del escáner (PR 2; la máxima prioridad)

### Estructura

**Archivos nuevos** (`apps/web/src/`):

| Archivo | Qué es |
|---|---|
| `scanner/ClassicStage.tsx` | El `RevealStage` de hoy, movido tal cual |
| `scanner/RevealSummary.tsx` | El resumen, compartido por las dos versiones |
| `scanner/useRevealMode.ts` | `'pro' \| 'classic'` |
| `ui/webgl.ts` | `hasWebGL2()` con la prueba guardada |
| `scanner/pro/ProShell.tsx` | En el trozo principal, ligero: el `Dialog`, **las bandas negras (CSS, cierran al instante)**, «Saltar», silencio, `aria-live`, la fase actual y el resumen |
| `scanner/pro/ProCinema.tsx` | En el trozo diferido, con GSAP y three.js: lienzo, escena, línea de tiempo, reloj y audio. Se precarga en reposo al entrar en `/escaner` |
| `scanner/pro/script.ts` | **El guion:** duraciones, curvas, colores e intensidades por fase y rareza, como datos. Su `buildScript(pulls, {motion, intro, overrides})` devuelve `{phases, cues, flashes, score, stops, order, duration}` |
| `scanner/pro/timeline.ts` | `buildTimeline(gsap, script, targets)`: la línea pausada, con una etiqueta por fase |
| `scanner/pro/clock.ts` | El reloj de audio |
| `scanner/pro/cues.ts` | El manifiesto de sonidos |
| `scanner/pro/scene/` | `warp`, `nebula`, `meteors`, `shockwave`, `rays` y `cards` |
| `scanner/pro/fabricate.ts` | Tiradas inventadas para el Ensayo |
| `audio/bank.ts`, `score.ts`, `stems-synth.ts` | Banco de sonidos, música por capas y sus versiones sintetizadas |
| `inspector/foil.ts` | El shader de brillo, sacado de `inspector-scene.ts` |
| `admin/RevealRehearsal.tsx` | El Ensayo |

**Cambios:**
- **`RevealStage.tsx`** pasa a ser el interruptor. Mantiene sus props y gana `pulls: … | null` (pendiente), `failed`, `onAbort` e `intro: 'scan' | 'fusion'`.
- **`ScannerScreen.tsx`:** en modo pro, al pulsar se abre la cinemática ya con `pulls: null`, y las bandas cierran mientras va la petición.
  - Si falla, las bandas se abren (0,35 s) y sale el error de hoy.
  - En «¡Escanear otra!», un fallo vuelve al resumen anterior con su aviso, como hace la clásica.
  - La cinemática sigue montada entre escaneos y reutiliza un solo contexto WebGL.
- **`scanner/sfx.ts`:** sus métodos ganan `at` y `out` para programarse a tiempo.
- **`music.ts`:** gana `holdMusic(on)`, que deja la música del juego a 0 por su propia ganancia (`duckMusic` solo baja a 0,35).
- **Otros:** `CollectionScreen` (`intro="fusion"`), `copy/es.ts`, `App.tsx`, `AdminLayout.tsx` y `vitest.config.ts` (`optimizeDeps` con `gsap`).

**Pro o clásica:**
- **Pro** si `prefs.scannerPro` está activo y hay WebGL2. Con movimiento reducido, sale su variante tranquila.
- **Clásica** en el resto de casos, en la fusión (por ahora) y en jsdom, así que los tests de hoy siguen igual.
- **Tutorial:** se comprueba que su burbuja queda por encima de las bandas.
- **E2E:** fija la clásica en `galaxy.prefs`, y una prueba aparte cubre la pro.

### Fases (valores iniciales del guion)
**Antes de la línea de tiempo (CSS):**
- `cierre`, 0,6 s: las bandas negras cierran de arriba abajo y de abajo arriba hasta el negro absoluto, la música del juego se apaga (`holdMusic`) y suena un barrido grave.
- `espera`: si falta la respuesta, o la escena aún está compilando (`compileAsync`), negro con una estrella que late y «Estableciendo enlace…».

**Una tirada** (segundos por rareza: común / poco común / rara / épica / legendaria):

| Etiqueta | C | PC | R | É | L | Qué pasa | Sonido y música |
|---|---|---|---|---|---|---|---|
| `ignicion` | 0,8 | 0,8 | 0,9 | 1,0 | 1,2 | Nace un aro de luz en el centro. Las bandas se abren a formato cine y la cámara avanza. | `latido` ×2; entra la base de la música |
| `salto` | 1,4 | 1,5 | 1,8 | 2,2 | 2,6 | Viaje warp: las estrellas se estiran en estelas. Las estelas empiezan en color hielo y, desde rara, toman el color de la rareza máxima al 60 % del trayecto. | `salto` (subida que crece) |
| `ascenso` | – | – | – | 0,6 | 0,9 | A veces (decisión con semilla, reproducible), una épica finge acabar y una legendaria rompe de violeta a dorado. Un solo destello. | `ascenso` |
| `caida` | 0,9 | 0,9 | 1,0 | 1,1 | 1,3 | El warp se cierra de golpe (`expo.out`) y cae una estrella fugaz del color de la estela. | `meteoro` |
| `impacto` | 0,35 | 0,4 | 0,45 | 0,5 | 0,7 | Onda expansiva y temblor. Parón de 0,04 / 0,05 / 0,06 / 0,08 / 0,2 s. | `impacto`; `impacto-grande` desde épica |
| `carta` | 0,9 | 0,9 | 1,0 | 1,3 | 1,8 | La carta sube boca abajo y gira (`back.out`). En legendaria, rayos dorados desde 0,3 s antes. El nombre se escribe letra a letra y la rareza se estampa. | `giro`, `revelar-<rareza>`, `sello`; `fanfarria` en legendaria; la música sube a su capa |
| `fenomeno` | +1,2 | | | | | Solo si la galaxia tiene fenómeno. El cartel «DESTACADA» sale a +0,25 s y el pase de brillo del acabado (holo, prismático, corrupto, fisura) va en la carta. | `fenomeno`, `destacada`, `acabado` |
| `espera-carta` | ∞ | | | | | Espera al jugador | La música sigue |
| `resumen` | 0,6 | | | | | La cámara se aleja, las bandas se abren y aparece el resumen de hoy | `resumen`; al cerrar, la música se funde en 1 s y vuelve la del juego |

Hasta que la carta espera: unos 5 s una común y unos 9 s una legendaria.

**Diez tiradas:**
- `ignicion`: 0,7 a 0,9 s.
- `salto`: 1,2 / 1,3 / 1,6 / 1,9 / 2,2 s.
- `ascenso`: 0,5 / 0,8 s.
- `caida`, 1,4 s: 10 estrellas fugaces escalonadas cada 0,06 s; la primera lleva el color máximo.
- `impacto`: 0,45 s más el parón.
- `reparto`, 0,9 s: las cartas caen boca abajo en una rejilla de 5×2, ordenadas **de menor a mayor rareza**.
- `giro-i`, en cadena:
  - entre giros, 0,18 / 0,24 / 0,32 s;
  - cada giro, 0,35 s;
  - el canto de la carta brilla con su rareza 0,12 s antes de girar.
- `solo-i`, para épicas y legendarias:
  - la carta vuela al centro (0,45 s) y gira (0,8 s);
  - se queda 1,4 s (épica) o 2,4 s (legendaria, con rayos);
  - vuelve (0,4 s).
- `final`, 1,2 s, y después `resumen`.
- **Total:** unos 8,5 s todas comunes; unos 17 s con 1 épica y 1 legendaria.

**Variante tranquila (movimiento reducido):**
- sin salto, ascenso, temblor, destellos ni parones;
- estrellas a la deriva, fundidos, y giros que son fundidos de 0,3 s;
- unos 2,5 s una tirada y 5 s diez.

**Fotosensibilidad** (comprobada por test):
- 2 destellos como máximo en cualquier segundo;
- opacidad de 0,6 o menos;
- ningún destello en rojo saturado.

**Daltonismo:** las pistas de color de las estelas, las estrellas fugaces y los cantos llevan de 1 a 5 marcas de rareza.

### Saltar sin romper nada
- **Las galaxias ya son del jugador** antes de que empiece la cinemática, porque responde el servidor. Saltar solo cambia lo que se ve.
- **Avanzar** (Espacio, clic, «Seguir»), según `script.stops`:
  - **Una tirada:** antes de `carta` salta a `carta`, así el giro se ve igual; durante el giro, a `espera-carta`; desde ahí, al resumen.
  - **Diez:** antes de `reparto` salta a `reparto`; en la cadena, al siguiente `solo-i` o a `final`; en un primer plano, a su vuelta.
- **«Saltar»** (arriba a la derecha) **y Escape:** van a `resumen`. Escape en el resumen cierra.
- **Protección contra saltos sin querer:** se ignora la entrada 400 ms al empezar y 250 ms tras cada salto (el clic de tirar, o una tecla repetida).
- **Audio al saltar:**
  - el bus de sonidos se funde en 30 ms y se sustituye, así mueren los ya programados;
  - el cursor de sonidos avanza al nuevo tiempo;
  - la música se pone en la capa de lo ya revelado;
  - los sonidos marcados como esenciales (impacto, acorde, fanfarria, destacada) de la etiqueta de llegada suenan igualmente.
- **El estado sale del tiempo, no de llamadas:** React lee `phaseAt(t)` para `aria-live` y los botones. Las animaciones son interpolaciones y `set`s, que se ven bien tras cualquier salto.
- **Pestaña oculta:** el reloj se pausa y la música se funde.

### Audio
- **El reloj de audio lo mueve todo:**
  - la línea está pausada, y un único bucle `rAF` hace `tl.time(clock.now())` y luego `render()`;
  - `clock.now()` usa `ctx.getOutputTimestamp()`; si no hay contexto, usa `performance.now()`;
  - un programador con 120 ms de margen (como `music.ts`) lanza cada sonido en `clock.toCtx(cue.at)`;
  - los parones son esperas dentro de la línea, no cambios de velocidad.
- **Música:** `createScore(bus, [base, rara, epica, legendaria])`.
  - Las capas arrancan en el mismo instante, en bucle y con sus puntos de bucle, así van sincronizadas a la muestra.
  - `level()` cruza sus ganancias.
  - Sin archivos, `stems-synth.ts` las genera una vez con `OfflineAudioContext`: ambiental y tranquila, unos 72 bpm, acordes Dmaj9 – Bm7 – Gmaj7 – A6, pulso grave y arpegio suave. Rara añade brillo, épica coro y timbales suaves, legendaria campanas y percusión.
- **Archivos opcionales:** en `apps/web/src/assets/audio/escaner/`, encontrados al compilar con `import.meta.glob(…, { query: '?url', eager: true })`.
  - Así salen con hash y caché larga, y uno que falta usa su versión sintetizada (en `public/`, un archivo que falta llegaría como `index.html`).
  - Cada uno en `.ogg` (Opus) y/o `.m4a` (AAC); se elige con `canPlayType`.
  - Para cambiar un sonido basta con dejar el archivo con su nombre y desplegar.
  - **Nombres:**
    - efectos: `cierre`, `latido`, `salto`, `ascenso`, `meteoro`, `impacto`, `impacto-grande`, `giro`, `revelar-{comun,poco-comun,rara,epica,legendaria}`, `sello`, `fanfarria`, `fenomeno`, `destacada`, `acabado`, `resumen`;
    - música: `musica-base`, `musica-rara`, `musica-epica` y `musica-legendaria`, con el mismo tempo y la misma duración.
  - **`LEEME.md`** en esa carpeta: nombres, duraciones, sonoridad (−16 LUFS en la música, picos a −1 dBTP), puntos de bucle y derechos (**el repo es público**).
  - Respeta los buses de música y efectos, el volumen y «Silenciar todo».

### Ensayo para dirigir (`/admin/escaner-ensayo`, solo admin)
- **Reproduce la cinemática sin gastar nada**, con tiradas inventadas (`generateGalaxy` de `packages/shared/src/gacha/generate.ts`, que es puro y corre en el cliente por tandas). No toca `usePull` ni el tutorial.
- **Controles:**
  - 1 o 10;
  - la rareza de cada hueco, o preajustes;
  - acabado, destacada, fenómeno y ascenso;
  - velocidad de 0,25× a 1×;
  - movimiento;
  - ir a una fase y reiniciar.
- **Ajustar el guion:** muestra la etiqueta y el tiempo actuales, y deja cambiar la duración de cada etiqueta (se guarda en el navegador).
- **«Copiar guion» (JSON):** el propietario me pasa los números exactos.
- **Llega pronto:** el Ensayo funciona con una escena provisional antes de la definitiva, así se puede dirigir desde el principio.

### Rendimiento
- **WebGL:** un contexto por montaje, reutilizado entre escaneos y liberado al cerrar (`forceContextLoss`). Si se pierde el contexto, salta al resumen.
- **Resolución:** máximo 1,5. Si los 30 primeros fotogramas pasan de 20 ms de media, baja a 1,0 con la mitad de partículas.
- **Presupuesto de partículas:**
  - warp: 3000 instancias;
  - estrellas fugaces: 10 cintas;
  - chispas: 2000 en GPU;
  - nebulosa: una textura sembrada, movida por el shader;
  - sin posprocesado.
- **Cartas:** las de la rejilla, en un atlas; la de primer plano se crea al momento y se libera después.
- **Asignaciones:** ninguna por fotograma.

### Tests
- **Web:**
  - `reveal-script`: orden de etiquetas por número, rareza, movimiento e intro; presupuestos de tiempo; variante tranquila; regla de destellos;
  - `reveal-timeline`: GSAP real en jsdom, con las etiquetas y el estado tras `seek`;
  - `reveal-stops`: destinos de avanzar y las protecciones;
  - `stage-clock`;
  - `audio-bank` y `score`: con el `FakeContext` ampliado, cubrir carpeta vacía → sintetizado, formato, capas en el mismo instante y cruces;
  - `scanner.test.tsx`: los de hoy siguen en clásica, y se añade la pro con módulo simulado (pendiente → bandas → error, y «Escanear otra» → resumen anterior);
  - `fabricate`.
- **Navegador:** `reveal-pro.browser.test.ts` va a cada etiqueta y comprueba que el lienzo no está vacío y no hay desbordes; capturas con `VITE_REVEAL_SHOTS=1`; pérdida de contexto → resumen.
- **E2E:** la prueba aparte de la pro, 10 tiradas → «Saltar» → 10 cartas.

## Parte C. Modo daltónico (PR 3)

**Viable y bien hecho:** paletas por tipo más señales que no dependen del color. No se usa un filtro de pantalla completa: estropea el arte y cuesta GPU en la arena. El arte de las galaxias no cambia.

**Modos:** Ninguno, Protanopía, Deuteranopía y Tritanopía (`prefs.colorVision`, `<html data-cvd>`).

**Paletas:**
- `apps/web/src/a11y/color-vision.ts` guarda las paletas por modo para las rarezas, bien/mal, los 4 equipos y los elementos.
- Siguen el estilo Okabe–Ito: azul/naranja en lugar de verde/rojo, y un juego aparte para la tritanopía.
- Incluye `simulate(hex, tipo)` (Machado 2009) y la distancia ΔE2000.

**Dónde se aplican:**
- **CSS:** `:root[data-cvd=…]` sustituye los tokens de rareza, `static`, `terminal` y `nova`. `TIER_COLORS` (`scanner/fx.ts`) y `TIER_COLOR` (`RelicStrip`) pasan a leer los tokens.
- **Pixi:** `arena/stage/palette.ts` `stagePalette(cvd)` cubre kill, element, team, reaction, hpOk/hpLow, downed/revive, photon, holo, gravity y dash.
  - El escenario la cambia en vivo (`setOptions`): todos sus usos se consultan en cada fotograma o evento.
  - Los sprites de objetos se generan al crear el escenario, así que cambian desde la siguiente partida. Ya tienen forma propia (rombo, cruz, bala redonda).
  - `CoopHud`, `Marks` y `TeamResults` usan `teamTint(i)`.

**Señales sin color:**
- la vida baja del compañero: muesca al 30 % y relleno hueco o parpadeante;
- la cuenta atrás del caído: arco discontinuo;
- reanimar: un «+» en la punta;
- las marcas de elemento: un glifo de 3×3 por elemento (también resuelve que `hack` y `prism` sean iguales).

**Vista previa** en Ajustes → Accesibilidad.

**Tests:**
- en cada modo, simulado, cada par de un mismo grupo debe quedar a una ΔE de 12 o más, y contra el fondo debe tener un contraste de 3:1 o más;
- `data-cvd` sustituye los tokens;
- `stagePalette`.

## Parte D. Reliquias y colección (PR 4)

- **Filtro por fenómeno:**
  - **Servidor:** `listQuerySchema.phenomenon` acepta un id, `any` (con fenómeno) o `none`, sobre `traits->>'phenomenon'`.
  - **Web:** `Filters.tsx` (`readFilters`/`writeFilters`, `collectionPath`, `filtered`).
  - **Selector:** `GalaxyPicker` gana una barra compacta con fenómeno y rareza.
- **Configuración viva para las descripciones:**
  - `GET /galaxy/api/content`, con `ETag` por versión y caché privada de 60 s;
  - `useLiveContent()`, con `DEFAULT_CONTENT` mientras carga;
  - la usan `RelicStrip`, `SetsPanel` y la ficha.
- **Ficha de reliquia:** `hangar/RelicSheet.tsx`.
  - **A la izquierda, el 3D:** `Inspector.tsx` se divide en `InspectorView` (para incrustar, con sus alternativas y «Girar») y el `Inspector` de diálogo.
  - **A la derecha:** nombre, rareza, acabado, nivel y **todos los poderes con números de la configuración viva**:
    - pasiva con su potencia;
    - número de proyectiles y forma;
    - frecuencia;
    - elemento y fenómeno;
    - cuásar y doble núcleo;
    - bono de fondo;
    - qué copia el eco;
    - conjuntos que activa o completa;
    - aviso de apilado.
    - `skillTags` y `copy.hangar.skillInfo` ganan los textos que faltan.
  - **Modo equipar:** el selector ya no equipa al pulsar; abre la ficha.
    - Calcula con el equipo hipotético y muestra «Sustituye a X».
    - «Equipar» hace el `PUT /hangar/loadout` de hoy.
    - «Volver» regresa al selector.
  - **Modo ver:** en `/coleccion/:id`, pulsar la carta grande abre la ficha (calculada sola, con la nota «con otras reliquias puede cambiar»). «Girar» e «Inspeccionar» se quedan.
- **Tests:**
  - integración: `phenomenon` (`any` y `none`); `GET /content`;
  - web: del selector a la ficha → «Equipar» guarda el arreglo correcto, «Volver» no guarda, Escape; la carta abre la ficha; los números siguen a la configuración viva;
  - navegador: captura de la ficha.

## Parte E. Perfil: avatares y fondo del menú (PR 5)

**Avatares:**
- `Avatar` gana `fit="outer"`: `size` es la huella exterior.
  - Con marco, la imagen mide size·32/48 y el marco la rodea.
  - Sin marco, o con un marco sin arte, la imagen llena toda la huella.
- `.podium-avatar` y `.profile-avatar` pasan a ser cajas invisibles: el marco hace de borde.
- Mismo ancho por puesto del podio.
- **Test de navegador:** con y sin marco miden igual (±1 px) y no se salen del contenedor.

**Fondo del menú:**
- **Migración:** `galaxy.backdrops(account_id → accounts on delete cascade, slot 0..11, galaxy_id → galaxies on delete cascade, pk(account_id, slot), unique(account_id, galaxy_id))`, con sus permisos.
- **API:**
  - `profileCosmeticsSchema.backdrop: uuid[]`, con un máximo de 12 y sin repetir;
  - `CosmeticsView.equipped.backdrop`;
  - `GET /galaxy/api/profile/backdrop` → `{galaxies: {id, seed, traits}[], chosen}`: las elegidas que sigan siendo suyas, o si no hay, las 6 más raras.
- **Elegibles:**
  - la paleta antimateria y la anomalía siguen fuera (se verían como una pantalla rota): salen desactivadas con su motivo;
  - las vendidas, cambiadas o desintegradas desaparecen solas.
- **«Personalizar»:** pestaña «Fondo» con selección múltiple paginada, el contador «3/12» y «Usar las más raras».
- **Orden aleatorio:** `TitleScreen` baraja al montar (Fisher–Yates) y vuelve a barajar en cada vuelta, sin repetir la última.
- **Tests:**
  - integración: guardar, ser suyas, máximo 12, y la vendida desaparece;
  - web: la pestaña;
  - unitario: el barajado.

## Parte F. Admin: lista de jugadores y eliminar (PR 6)

**Lista** (patrón de `RunsScreen` y `listRuns`):
- **Petición:** `GET /admin/players?q&estado&orden&dir&pagina` → `{players, total, page, pages}`, de 50 en 50.
- **Búsqueda:**
  - el nombre *contiene* el texto, con los que *empiezan* por él primero;
  - con forma de IP, busca la IP exacta;
  - una etiqueta de clan da sus miembros.
- **Estado:** Todos, Conectados ahora (`LiveHub`), Activos 7 días, Baneados, Silenciados, Staff y Eliminados.
- **Orden:** nombre, alta, última conexión o nivel, en ambos sentidos.
- **Web:**
  - filtros en la URL;
  - barra con buscador, `Select`s y dirección;
  - cabeceras ordenables (`aria-sort`) y total;
  - `DataTable` + `Pager`; la fila lleva a la ficha.

**Eliminar:**
- **Quién:** admin o superadmin, con `guardTarget`.
- **Confirmación:** `ActionDialog` con motivo y contraseña, y escribir el nombre.
- **Petición:** `POST /admin/players/:username/delete {reason, password, confirm, reserveName}`.
- **Qué hace**, en una sola transacción auditada (la auditoría guarda el nombre original):
  - **Cuenta:**
    - `deleted_at`;
    - el nombre pasa a `borrado_<8 hex>` y la contraseña se cambia por una aleatoria;
    - roles y TOTP fuera;
    - avatar, marco, título, banner y fondo restablecidos.
  - **Datos personales y sociales:** se borran sesiones, IPs, amistades, solicitudes, bloqueos, preferencias y mensajes de chat.
  - **Clan:** si era líder, el liderazgo pasa al siguiente por rango, o el clan se disuelve si estaba solo (`admin/clans.ts`).
  - **Comercio:** se cancelan anuncios y trueques, y se liberan las retenciones.
  - **Partida:** se vacían equipo, vitrinas y fondos.
  - **Clasificación:** sale de ella.
  - **Nombre:** se reserva si se pidió.
  - **Después de guardar:** `hub.dropAccount` y se invalida la clasificación.
- **Lo que queda:** libros de movimientos, partidas, compras y galaxias, a nombre de la cuenta anónima.
- **Migración:** `accounts.deleted_at`, los `delete` que falten y `insert` en `reserved_usernames`.
- **El acceso comprueba `deleted_at`** en el login, las sesiones y los perfiles (404).
- **Tests de integración:**
  - todo lo anterior;
  - no puede entrar;
  - nombre libre o reservado;
  - libro de movimientos y compras intactos;
  - herencia del clan;
  - `guardTarget` y contraseña errónea.

## Parte G. Directo de partidas individuales (PR 7)

**Siempre se envía,** y el «alguien mira» solo marca el ritmo.
- **Por qué:**
  - reconectar ya necesita «sigue desde lo que tiene el servidor»;
  - el visor abre al instante;
  - cuesta poco: entre 0,3 y 1 KB/s por jugador, y entre 100 y 400 KB de memoria por partida, con un máximo de 2 MB.
- **Solo para mirar:** la recompensa sigue saliendo del `finish`.

**Simulación** (`packages/sim/src/recording.ts`):
- `createLogWriter(probes)` (`encodeLog` pasa a usarlo, con los mismos bytes);
- `decodeEvents(chunk, prevTick, {probes, kinds:'solo'})`, que valida;
- `createLiveReplayer(opts)` → `{ push, next(to): 'stepped' | 'wait' | 'over' }`, que espera en la elección de mejora en vez de pararse.

**Protocolo** (`packages/shared/src/api/solo-watch.ts`):
- **Jugador:** `/galaxy/api/runs/stream/ws?run=`.
  - El servidor le manda `{t:'hello', have, tick, watched}` y `{t:'watch', on}`.
  - Él envía `{t:'f', n, b, to, s}`, con `b` en base64 de 3400 caracteres o menos (bajo el límite de 4096), y `s` = `run` | `pick` | `pause`; y al final `{t:'end'}`.
  - Si `n` no coincide, el servidor vuelve a mandar `hello` y el jugador sigue desde `have`.
- **Staff:** `/galaxy/api/admin/solo/watch/ws?run=`.
  - Recibe `{t:'hello', start, player, log, to, s}`; el estado inicial va dentro, porque `GET /admin/runs/:id` es solo para admin.
  - Después, `{t:'f', …}`, `{t:'st', s:'lost'}` y `{t:'end'}`.

**Servidor:**
- **Archivos:** `runs/solo-feeds.ts` (`SoloFeeds`, que copia `CoopRun.watch`/`tellWatchers`), `runs/stream-routes.ts` y `GET /galaxy/api/admin/solo/live`.
- **Al acabar:** `finish` cierra el feed después de guardar.
- **Quién puede:**
  - la partida es del jugador, individual, sigue abierta y no ha caducado;
  - un feed por cuenta, 2000 en total y 2 MB por feed;
  - tasa máxima con margen para reanudar;
  - un espectador que va muy retrasado se cierra.
- **Limpieza:** 5 minutos de gracia al desconectarse y un barrido cada 30 s. Tras un despliegue, el cliente vuelve a subir todo sin que se note.

**Cliente:** `arena/run-stream.ts`, que nunca rompe la partida.
- Envía cada 150 ms si alguien mira y cada 2 s si no.
- `ArenaScreen` marca `pause` y `run` en sus pausas (pestaña oculta o menú) y `end` al acabar.

**Visor:** `admin/SoloWatchScreen.tsx`, en `moderacion/directo/solo/:runId`.
- Al entrar se pone al día con «Sincronizando…».
- Usa `createStage` y el HUD de solo lectura, como `ReplayScreen`.
- Muestra «Eligiendo mejora…» con la oferta, «El jugador tiene el juego en pausa», «Conexión perdida…» o el resultado.
- `LiveRooms` gana la tabla «Incursiones en solitario», que se refresca cada 5 s.
- **Quién mira:** staff, moderadores incluidos, igual que las partidas en grupo.

**Tests:**
- **Simulación:**
  - el escritor troceado da los mismos bytes que `encodeLog`;
  - `decodeEvents` rechaza tipos ajenos y ticks que retroceden;
  - el visor en vivo coincide con `replay()` (`stateHash`) en cada trozo y espera en la elección.
- **Servidor:** unitarios con sockets falsos.
- **Integración:**
  - no es el dueño, partida acabada, partida en grupo, no staff;
  - `finish` avisa a los espectadores;
  - aparece en la lista.
- **Web:** `run-stream` con `test/fake-socket.ts`, el visor y `LiveRooms`.

---

## Decisiones mías (para revisar)
- **GSAP:** 3.15.0 y no la 3.15.1, que tiene una semana.
- **Librerías:** three.js en lugar de tsParticles, y Web Audio propio en lugar de Howler.
- **Audio:** en `src/assets` y no en `public/`.
- **Clásica, de momento,** en la fusión y en el E2E de siempre.
- **Directo:** siempre se envía, y lo pueden ver los moderadores.
- **Fenómeno:** el filtro también va en el selector de reliquias.
- **Configuración viva** para describir las reliquias.
- **Fondo:** 12 como máximo; antimateria y anomalía siguen fuera.
- **Eliminar:** admin o más; se borran también los mensajes de chat.
- **Daltonismo:** los sprites de objetos cambian de color desde la siguiente partida.

## Entrega
- **Siete PRs a `develop` con CI**, en el orden A → G. B depende de A por el ajuste.
- **Dentro de B, este orden:**
  1. extracciones;
  2. guion, línea de tiempo y reloj;
  3. audio;
  4. **Ensayo con la escena provisional** (desde aquí el propietario ya puede dirigir);
  5. la escena definitiva;
  6. el flujo de «pendiente».
- **Migraciones:** en E y F, con fecha que no sea futura y posterior a `20261112083000`.
- **Cada fusión:** con su despliegue `preproduction` vigilado y la salud comprobada.
- **Después:** rondas de pulido con el Ensayo según lo que diga el propietario.

**Fuera, apuntado:**
- la cinemática en las fusiones;
- ajustes guardados en la cuenta;
- comparar en el servidor el directo con el `finish`;
- más de un contenedor.

## Verificación
- **En cada PR:** `typecheck`, `lint` y los tests de su parte (unit, web y navegador en local; integración y E2E en CI).
  - Nunca en local: `supabase db reset`, `pnpm db:test`, el E2E de la raíz ni `config.test.ts`.
- **Navegador:** capturas de los ajustes, la ficha, el podio, el perfil y cada fase de la cinemática, a 1280, 1600 y 1920 y en móvil.
- **PRE:** despliegue y salud. El propietario lo prueba con su cuenta y con el Ensayo; no creo cuentas de prueba.
