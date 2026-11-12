# Galaxy Survivor · Sistema de diseño

> Versión 1 · 2026-11-06 · Fuente: la demo de título aprobada por el usuario (`.superpowers/brainstorm/1011-1793971787/content/titulo-v2.html`), el GDD §17 y la consulta a ui-ux-pro-max. Todo el frontend del juego sale de aquí: si algo no está, se añade a este documento antes de usarlo.

## 1. Idea

**Una consola de juego con relieve sobre un cielo vivo.** La interfaz son piezas gruesas y táctiles que se hunden al pulsarlas, pintadas con los colores de las paletas del motor de galaxias. Debajo, un fondo pixel art que nunca se queda quieto: el cielo tramado, la estación y la galaxia braille calculada en tiempo real.

Tres reglas mandan sobre todo lo demás:
1. **La interfaz se separa del fondo.** Paneles opacos (94 %) con borde y labio; el fondo nunca compite con el texto.
2. **Pulsar se siente.** Cada control tiene relieve, se levanta al pasar el ratón y se hunde al pulsar.
3. **Un solo momento orquestado por pantalla.** La entrada (escaneo, logo, paneles en cascada) o un revelado. El resto del movimiento solo responde a acciones.

Es distinta de la web de ElClub a propósito: nada de Base Blue, Cerulean ni Archivo.

## 2. Color

### 2.1 Tokens

| Token | Valor | Uso |
|---|---|---|
| `--void` | `#070a1c` | Fondo base de la página |
| `--panel` | `#181a3d` | Paneles (al 94 %) |
| `--panel-2` | `#20234f` | Superficies dentro de paneles, píldoras oscuras, campos |
| `--panel-lip` | `#0b0c24` | Labio de los paneles y controles oscuros |
| `--ink` | `#f3f5ff` | Texto principal |
| `--ink-soft` | `#b9bfe6` | Texto secundario |
| `--ink-mute` | `#8890c4` | Texto terciario, ayudas, etiquetas de datos |
| `--solar` / `--solar-2` / `--solar-lip` | `#ffc94a` / `#ff9a3c` / `#c25f1c` | Acción principal (Jugar), escáner, temporada |
| `--on-solar` | `#3a1700` | Tinta sobre Solar |
| `--nova` / `--nova-2` / `--nova-lip` | `#ff6b7a` / `#e8435a` / `#9c2238` | Supervivencia, avisos, contadores |
| `--on-nova` | `#2b0712` | Tinta sobre Nova |
| `--terminal` / `--terminal-2` / `--terminal-lip` | `#45e3a6` / `#17b07e` / `#0b7352` | Hogar, éxito, en línea |
| `--on-terminal` | `#04281c` | Tinta sobre Terminal |
| `--uv` / `--uv-2` / `--uv-lip` | `#7259ee` / `#5a43d6` / `#3a2a9a` | Eventos |
| `--sky` / `--sky-2` / `--sky-lip` | `#4767f2` / `#3a58e0` / `#26389a` | Acciones secundarias de navegación («Ver clasificación completa») |
| `--ice` | `#bfe3ff` | Galaxia braille, foco, polvo estelar |
| `--static` | `#ff4d6d` | Errores, la Estática |
| `--uv-soft` | `#9b86ff` | Iconos UV sobre paneles oscuros (el UV de superficie es demasiado oscuro ahí) |
| `--tier-common` / `--tier-uncommon` / `--tier-rare` / `--tier-epic` / `--tier-legendary` | `#c9d0ea` / `#45e3a6` / `#6fb7ff` / `#b39dff` / `#ffc94a` | Rarezas de las galaxias. Cualquier elemento con `data-tier` recibe su color en `--tc` |

**Regla de tinta:** las superficies brillantes (Solar, Nova, Terminal) llevan **tinta oscura** (`--on-*`); las profundas (UV, Sky) llevan **blanco**. Ningún componente usa hex sueltos: solo tokens.

### 2.1 bis Visión del color

Plan «escáner pro», parte C. En Ajustes → Accesibilidad, «Visión del color» (Normal, Protanopía, Deuteranopía, Tritanopía) cambia solo los colores que significan algo. El arte de las galaxias y los sprites decorativos no cambian.
- **Qué cambia:** los tokens de rareza, Terminal (a favor), Nova (daño) y Estática (peligro); los cuatro colores de jugador y los elementos.
- **De dónde salen:** una sola fuente, `a11y/color-vision.ts`. La aplican:
  - el CSS, con las variables puestas en `<html>`;
  - la arena, con `stagePalette`, que cambia al momento;
  - el escáner pro;
  - los tonos de rareza en JS.
- **Con qué criterio:**
  - Rojo-verde (protanopía y deuteranopía) pasa el significado al eje azul–naranja, al estilo Okabe–Ito; tritanopía, al rojo–turquesa.
  - Cada grupo (rarezas, jugadores, bien y peligro), simulado (Machado 2009, severidad total), queda a una ΔE2000 de 12 o más entre pares, con contraste de 3:1 o más sobre el fondo. Lo comprueba `test/color-vision.test.ts`.
  - Hoy, sin este modo, rara y épica quedan a ΔE 0,6 con deuteranopía.
- **Forma además de color:**
  - cada elemento lleva su glifo de 3×3 en la marca del enemigo;
  - la rareza lleva rombos (1–5);
  - la cuenta atrás de un compañero caído es discontinua y su reanimación lleva un «+»;
  - la vida de un compañero tiene una muesca al 30 % y parpadea cuando baja de ahí.

### 2.2 Contraste medido (WCAG 2.2)

| Texto sobre fondo | Relación | Nivel |
|---|---|---|
| `--ink` / `--panel` | 15,40 | AA |
| `--ink-soft` / `--panel-2` | 8,24 | AA |
| `--ink-mute` / `--panel-2` (peor caso) | 4,83 | AA |
| `--on-solar` / `--solar-2` (peor caso) | 7,63 | AA |
| `--on-nova` / `--nova-2` (peor caso) | 4,71 | AA |
| `--on-terminal` / `--terminal-2` (peor caso) | 5,69 | AA |
| blanco / `--uv` (peor caso) | 4,80 | AA |
| blanco / `--sky` (peor caso) | 4,68 | AA |
| `--static` / `--panel-2` (errores) | 4,62 | AA |

Cambios frente a la demo aprobada, para cumplir 4,5:1 con texto pequeño: el texto sobre coral pasa de blanco a `--on-nova`; el violeta de eventos y el azul de navegación se oscurecen un tono. Los colores siguen siendo los mismos de la demo a la vista.

## 3. Tipografía

| Familia | Uso | Pesos |
|---|---|---|
| **Bungee** | Logo, la palabra «Jugar», cabeceras de temporada. Siempre en mayúsculas (es su diseño), nunca en párrafos | 400 |
| **Fredoka** | Todo lo demás | 400, 500, 600, 700 |
| Braille | Glifos del bloque Unicode U+2800 con la pila `'Segoe UI Symbol', 'Noto Sans Symbols 2', 'DejaVu Sans'` | — |

Ambas son OFL y se **autoalojan** en `apps/web/public/fonts/` (la CSP no permite fuentes externas). Cubren ñ, ¿ y ¡.

**Escala** (px; la interfaz escala en pantallas grandes, ver §6):

| Paso | Tamaño | Uso |
|---|---|---|
| `--fs-cap` | 12 | Etiquetas de datos mínimas (nunca texto de lectura) |
| `--fs-xs` | 13.5 | Ayudas bajo campos, metadatos |
| `--fs-sm` | 15 | Texto secundario |
| `--fs-md` | 16 | Texto base, campos |
| `--fs-lg` | 18 | Títulos de tarjeta |
| `--fs-xl` | 21 | Títulos de modo y de panel |
| `--fs-2xl` | 28 | Títulos de pantalla |
| `--fs-display` | 54 | «Jugar» y llamadas grandes (Bungee) |
| `--fs-logo` | 92 | Logo (Bungee) |

Interlineado 1,45 en texto, 1,1 en títulos, 0,9 en el logo. Números con `font-variant-numeric: tabular-nums`. Sin MAYÚSCULAS forzadas en etiquetas.

## 4. Forma y profundidad

**Radio según jerarquía** (nunca uno solo para todo):

| Nivel | Radio | Ejemplos |
|---|---|---|
| Héroe | 30 | Botón Jugar, panel de acceso |
| Tarjeta | 22 | Modos, evento, misiones, clasificación (26) |
| Ficha | 18 | Accesos de la rejilla, botón de navegación |
| Campo | 14 | Inputs, selectores |
| Píldora | 999 | Píldoras, iconos, chips |

**El labio** es la sombra sólida inferior que da relieve. Se acompaña de un brillo interior arriba y una sombra suave de caída:

```css
box-shadow:
  inset 0 2px 0 rgb(255 255 255 / .28),   /* brillo superior */
  inset 0 -3px 0 rgb(0 0 0 / .18),         /* peso inferior */
  0 var(--lip-h) 0 var(--lip-c),           /* labio sólido */
  0 14px 26px rgb(0 0 0 / .35);            /* caída */
```

| Nivel | `--lip-h` |
|---|---|
| Héroe | 8 |
| Modo / tarjeta pulsable | 6 |
| Ficha | 5 |
| Píldora, icono, campo | 4 |

**Textura braille:** las superficies de color llevan una rejilla de puntos (`radial-gradient` de 1,3 px cada 11 px, blanco al 20–28 %). Es la firma del juego; los paneles oscuros no la llevan.

**Espaciado** (escala de 4): 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 56. Huecos entre piezas hermanas: 12–16; entre bloques: 22–24.

## 5. Movimiento

| Token | Valor |
|---|---|
| `--bounce` | `cubic-bezier(.34, 1.56, .64, 1)` |
| `--t-hover` | 180 ms con `--bounce` |
| `--t-press` | 60 ms |
| `--t-enter` | opacidad 450 ms + desplazamiento 550 ms con `--bounce` |

- **Hover:** sube 3 px y el labio crece 3 px.
- **Pulsar:** baja hasta casi tapar el labio (60 ms). Es la sensación que el usuario aprobó: no se toca.
- **Entrada de pantalla:** una sola coreografía; el fondo primero, el logo cae, los paneles entran en cascada (40–60 ms entre piezas). Después la pantalla queda quieta salvo el fondo.
- **Fondo:** galaxia girando, estrellas titilando, sondas y cometas ocasionales; la Estática corrompe la galaxia unos 300 ms cada 7–12 s.
- **Carga:** el indicador es un **spinner braille** (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` a 80 ms por paso).
- **Movimiento reducido:** sin desplazamientos ni rebotes; la galaxia queda fija; la entrada es instantánea; el spinner pasa a tres puntos que cambian de opacidad.
  - Lo decide Ajustes → Accesibilidad → Movimiento (plan «escáner pro», parte A): «Sistema» sigue el `prefers-reduced-motion` del ordenador, «Reducido» y «Completo» mandan sobre él.
  - El CSS lo lee de `<html data-motion="reduced">` (bloques `:where(:root[data-motion='reduced'])`, nunca `@media (prefers-reduced-motion)`); React, de `useReducedMotion()`; el resto, de `prefersReduced()` (`settings/prefs.ts`). La arena lo cambia sin reiniciar la incursión.

## 6. Composición y pantallas anchas

- **Mínimo** 1280×720 con puntero fino; por debajo se muestra la pantalla «Galaxy Survivor se juega en ordenador».
- **Anclajes:** la columna principal se ancla al borde izquierdo (56 px de margen) y los paneles laterales al derecho (40 px). El centro es de la escena: allí viven la estación y la galaxia.
- **Anchas (21:9, 32:9):** los paneles no se estiran; crece el cielo. A partir de 2560 px de ancho la interfaz escala con `clamp()` hasta un 125 %.
- **En la arena de combate** la zona jugable tiene un tope de 21:9 y lo que sobra es decoración (GDD §17.2).
- Texto alineado a la izquierda; números a la derecha en tablas.

## 7. Componentes

Todos los controles: área mínima 44×44, `cursor: pointer`, foco visible con anillo `--ice` de 3 px separado 3–4 px, y estado deshabilitado (opacidad 50 %, sin labio, `cursor: not-allowed`).

**Sin barras de desplazamiento [U, 2026-11-11].** No hay barras en ningún sitio, aunque todo sigue desplazándose con la rueda, el dedo o el teclado. Lo que se desplaza de lado usa `ui/HScroll.tsx`:
- una flecha en el lado donde hay más contenido, y ese borde difuminado;
- en las tiras, la rueda del ratón lo mueve de lado hasta el final, y después la rueda vuelve a ser de la página;
- en las tablas (`variant="table"`), la rueda sigue siendo de la página y las flechas van arriba.

| Componente | Variantes | Notas |
|---|---|---|
| **Button** | `primary` (Solar, héroe), `mode` (Nova, Terminal), `event` (UV), `nav` (Sky), `pill` (oscura o Solar), `icon` (redondo oscuro 48 px) | Estados: reposo, hover, pulsado, foco, deshabilitado, cargando (spinner braille + `aria-busy`). `icon` siempre con `aria-label` |
| **Panel** | normal, cabecera de color (Solar en la temporada) | Opaco 94 %, borde blanco al 6 %, labio `--panel-lip` |
| **Field** | texto, contraseña (con mostrar/ocultar), código de 6 dígitos | Etiqueta visible encima (nunca solo placeholder); 48 px de alto; fondo `--panel-2` con sombra interior; error debajo en `--static` enlazado con `aria-describedby`; `autocomplete` correcto (`username`, `current-password`, `new-password`, `one-time-code`); se puede pegar siempre |
| **Deslizador** (`ui/Slider.tsx`) | con o sin valor | Un `range` nativo (teclas, táctil y lectores como siempre) dibujado por el juego: pista hundida de 12 px, relleno Solar hasta `--fill`, mando de 28 px con borde Solar y labio, que crece al pasar por encima; el valor en un pocillo a la derecha y en `aria-valuetext`. Deshabilitado al 45 % |
| **Interruptor** (`ui/Switch.tsx`) | encendido, apagado | `button role="switch"` de 62×36: pista hundida; encendido, verde Terminal con labio y el mando con una marca, que se desliza con rebote. Siempre con una etiqueta visible que lo nombra |
| **Elección segmentada** (`ui/Segmented.tsx`) | 2–4 opciones | `radiogroup` de WAI-ARIA con la apariencia de `.segmented`: una sola parada de Tab y las flechas, Inicio y Fin eligen (saltan las deshabilitadas) |
| **Select** (`ui/Select.tsx`) | `sm` 40 px (filtros, barras y tablas del admin), `md` 44 px (juego), `lg` 50 px (formularios junto a campos de 50 px); `block` a todo el ancho | Nunca el desplegable del sistema [U, 2026-11-12]. Combobox de solo selección de WAI-ARIA: el botón (Panel 2, labio de 4 px, chevrón que gira al abrir) se nombra por su `<label htmlFor>`, `aria-label` o `aria-labelledby` y es tan ancho como su opción más larga. La lista vive en `<body>` con posición fija (ningún panel ni diálogo la recorta), sale debajo o encima según el sitio, mide como mucho 320 px y se desplaza por dentro; sigue al botón al desplazarse y lleva el zoom de las pantallas grandes. Opción activa con fondo hielo y barra a la izquierda; elegida con la marca Solar; deshabilitadas al 55 %. Teclado: flechas, Inicio, Fin, páginas, buscar al escribir (sin acentos), Intro, Espacio, Tab elige y sigue, Escape cierra solo la lista. Entrada corta (150 ms) que desaparece con movimiento reducido. Con `name` lleva un `input` oculto para los formularios |
| **DateField** (`ui/DateField.tsx`) | fecha, fecha y hora (`time`) | Las fechas del admin sin el calendario del sistema. Campo de texto en español (`dd/mm/aaaa` y `hh:mm`; también acepta ISO pegado) con un botón de calendario dentro. El calendario (diálogo de WAI-ARIA, sobre `<body>`) empieza en lunes: mes con flechas a los lados, día elegido en Solar, hoy con borde hielo; flechas por día y semana, Inicio y Fin de la semana, páginas por mes (con Mayúsculas, por año), Intro elige, Escape cierra solo el calendario, Tab no sale de él. Con hora, hora y minutos con las flechas y «Listo». Se ve entero: si no cabe ni arriba ni abajo, tapa su campo. El valor conserva el formato del `input` nativo (`2026-11-12`, `2026-11-12T10:30`) |
| **Badge** | contador (Nova), novedad (tinta Solar), en línea (punto Terminal) | Contadores con `aria-label` que diga el número |
| **Tabs** | segmentadas en píldora | `role="tablist"`, flechas del teclado |
| **Toast** | info, éxito, error | Región `aria-live="polite"`; errores críticos con `role="alert"` |
| **Error de formulario** | resumen arriba + errores en línea | Tras enviar con errores, el foco va al resumen; cada error enlaza a su campo |

| **Bloqueado** (en desarrollo) | `mini` (candado en la esquina), `tag` (candado y texto), `text` (solo texto) | Lo que llega en otro hito se ve pero no se pulsa: su color con `saturate(.6) brightness(.84)`, sin labio ni hover, `disabled` y el texto «En desarrollo» siempre presente (en `mini`, solo para lectores de pantalla y en el `title`) |
| **Barra superior** | accesos (izquierda), operador y saldo (derecha) | Escáner en píldora Solar con la insignia «Tirada gratis» cuando toca. Saldo: polvo (`--ice`), monedas (`--solar`) y señales (`--nova`), cada uno con `role="img"` y un `aria-label` que dice la frase entera («1250 monedas»). Por debajo de 1600 px los accesos bloqueados se quedan en icono |
| **Menú principal** | Jugar (héroe Solar), modos (Nova, Terminal), evento (UV), misiones (panel), seis losas y pie | Las losas llevan un icono del color de su sección y una línea debajo (dato o «En desarrollo») |
| **Carta de galaxia** | anverso, reverso; acabados Normal, Holo, Prismático, Relieve braille, Corrupto | 5:7, todo en `cqw` (igual a cualquier ancho). Marco del color de su rareza (`data-tier`) con el relieve de siempre; Épica y Legendaria brillan. Ventana cuadrada con la imagen del motor, nivel («Nv 3», «Nivel 3» para lectores) y acabado arriba; placa oscura con nombre, designación y rareza. Interactiva: se inclina hasta 11° hacia el puntero y el brillo lo sigue; con movimiento reducido no se mueve. El acabado vive entre el marco y la placa, que siempre queda limpia: Holo, bandas de arcoíris finas que se deslizan; Prismático, espectro que gira y puntos de luz; Relieve braille, el marco y la placa con puntos en relieve; Corrupto, líneas de escaneo, sangrado rojo y cian y un fallo solo mientras el puntero está encima. La imagen se carga solo cerca de la pantalla (máximo 12 peticiones al Worker) y se suelta al salir. Reverso: el braille de 48 columnas de su semilla en relieve y los nueve rasgos |
| **Inspector 3D** | WebGL2, plano | Se abre desde el detalle («Inspeccionar en 3D», Solar). three.js llega solo entonces (su propio fragmento) y al cerrar devuelve el contexto WebGL. La carta son capas en profundidad: campo de estrellas lejos, la galaxia en mezcla aditiva (las estrellas se ven a través de su negro), el marco con su ventana y la luz del acabado encima; se inclina hasta unos 19° con el puntero (5° con movimiento reducido, sin balanceo) y «Ver el reverso» la gira. Luz por acabado en un shader: brillo que sigue al puntero; Holo, bandas de arcoíris; Prismático, espectro y destellos que titilan; Relieve braille, los puntos captan la luz; Corrupto, líneas y filas que fallan. Sin WebGL2, la carta plana por las dos caras con un aviso |
| **Ficha de reliquia** (`hangar/RelicSheet.tsx`) | equipar, ver | Plan «escáner pro», parte D. A la izquierda la carta en 3D (`InspectorView`); a la derecha la rareza, el acabado, la designación, el nivel y, al equipar, «Va a la ranura N» o «Sustituye a X». «Lo que hace» con cada poder y sus números de la configuración viva (`GET /content`): pasiva y su potencia, proyectiles, forma, frecuencia, elemento, fenómeno, núcleo cuásar o doble y fondo. Después los conjuntos (los que estrena, «Nuevo») y el aviso de apilado. La columna de poderes se desplaza por dentro, así «Equipar» y «Volver a la lista» quedan siempre a mano. Se abre al elegir una galaxia en el selector de reliquias (que filtra por fenómeno y rareza) y al pulsar la carta del detalle de la colección (solo ver) |
| **Filtros** | chips de rareza, selector, segmentado | Chips de 40 px con su rombo y su recuento; el pulsado lleva el borde de su rareza (`aria-pressed`). Selectores con etiqueta visible encima («Tipo», «Paleta», «Acabado») y «Cualquiera». Orden en segmentado («Más nuevas», «Más raras»). Todo vive en la URL (`?tier=rare&sort=rarity`) |
| **Rejilla de cartas** | normal, elegir | Cartas de 200 px, huecos de 24–30 px, anclada a la izquierda; páginas de 30 con «Cargar más». La acción cubre la carta dentro de su inclinación (enlace al detalle o botón de elegir con `aria-pressed`); elegida: anillo Solar y marca; no elegible: velada y `disabled` |
| **Bandeja de fusión** | — | Fija abajo y centrada: «3 de 5», de qué nivel a cuál, el coste en polvo (en `--static` y «No tienes bastante polvo estelar» si falta), Cancelar y «Fusionar ahora» (Solar), deshabilitado hasta que todo cuadra. Todo se ve antes de pedir nada |
| **Modal** | diálogo, confirmación (`alertdialog`) | Panel con labio sobre velo `rgb(2 3 10 / .84)`, sin desenfoque (se recalcula en cada fotograma detrás de lo animado); nombre por su título; el foco entra, no sale con Tab, vuelve al cerrar; Escape y el velo cierran. Lo que no se puede deshacer pide confirmación con lo que da («Se convierte en 113 de polvo estelar. No se puede deshacer») y el foco empieza en Cancelar |
| **Panel de colección** | con galaxias, vacío | Cabecera Sky. Recuento por rareza con rombos (`data-tier`; hueco si no hay ninguna), las más raras (6, o 4 por debajo de 820 px de alto y 3 por debajo de 680) con la primera resaltada, y botón Sky «Abrir colección» o, sin galaxias, «Escanear el cielo» |

Iconos: SVG de trazo redondeado (2,2 px), nunca emojis. Los decorativos con `aria-hidden`.

**Pantalla de título.** Barra superior arriba; debajo, el menú anclado a la izquierda (56 px, hasta 660 px de ancho) y el panel de colección a la derecha (40 px, 340–400 px). El bloque se coloca un poco por encima del centro del alto libre y escala con el alto de la ventana (`clamp()` en `vh`: logo 44–100 px, Jugar 128–230 px, losas 84–120 px); si no cabe, se desplaza. En el centro, el cielo muestra las galaxias del propio jugador (§8).

## 8. Fondo vivo

Desde M2a el fondo de acceso son **galaxias reales del motor** (`packages/engine`), sin estación ni planeta: una cada vez, que aparece, se queda y se funde con la siguiente. Lo dibuja `GalaxyBackdrop` con la secuencia pura de `backdrop-schedule.ts`.

- **Cielo:** negro profundo con un leve azul (`#0a0d22` → `#020309`) y un polvo tramado casi imperceptible (ruido de valor con umbral Bayer 4×4 y algo de azar, al 40 %).
- **Galaxias:** semilla nueva en cada una (`crypto.getRandomValues`), fondo `deep_void` o `starfield`. Se descartan Antimatter (papel claro) y Anomaly (parecería un fallo). 96 columnas, o 192 si `devicePixelRatio × ancho ≥ 2400`. Se calculan en el Worker del motor y se componen en un único lienzo WebGL2 fuera de la página, que se copia al lienzo 2D de cada capa (o en 2D sin brillo si no hay WebGL2). No se guardan en caché: cada semilla es nueva y no se volvería a usar.
- **Composición:** la galaxia a la derecha del panel (centro en 64 % × 50 %, lado `min(80vw, 124vh)`), con máscara radial y fusión `screen` para que el lienzo no tenga bordes. La viñeta oscurece el lado del panel y sus bordes toman un 24 % del color de la galaxia, que cambia en 5 s.
- **Secuencia:** escaneo 3,2 s → se ve 14 s → fundido 5 s con la siguiente, que entra con su propio escaneo. El escaneo es una línea braille del color de acento que resuelve los puntos de arriba abajo. Nunca hay más de dos galaxias montadas.
- **Movimiento:** solo transformaciones rígidas de la imagen compuesta, así que la forma no cambia: gira 7° y se acerca un 4,5 % a lo largo de toda su vida, y el brillo respira ±6 % cada 7 s. Con la pestaña oculta el reloj se para.
- **Movimiento reducido:** una sola galaxia, quieta, sin escaneo ni fundido.
- **En la pantalla de título** el cielo muestra las galaxias del jugador, de la más rara a la menos, tal como son (sin fijar el fondo), y se turnan; se descartan igual Antimatter y Anomaly. Sin galaxias, semillas al azar. La galaxia va más al centro (57 % × 46 %, lado `min(66vw, 110vh)`) y la viñeta oscurece los dos lados.

## 8 bis. Escáner profundo y revelado

El momento orquestado del juego (GDD §9). Antes de pagar se ve todo: probabilidades de cada rareza en la próxima tirada (suerte creciente incluida), cuánto falta para la Legendaria segura con su barra, la suerte de bienvenida y, en eventos, la destacada y su garantía. Se paga con el escaneo gratis del día (Terminal), señales (Solar) o monedas (oscuro); sin saldo, el botón se ve apagado antes de pulsar.

- **Terminal CRT:** bisel con relieve y pantalla curva oscura con líneas de escaneo y viñeta. En reposo, braille de hielo que respira y «Listo para escanear».
- **Secuencia** (`revealSequence`, pura y probada), por tirada:
  1. **Estática:** ruido tenue redibujado unas 12 veces por segundo (0,9 s la primera, 0,32 s las siguientes; nunca un destello).
  2. **Señal:** suben tantas barras como pasos de rareza (1 Común … 5 Legendaria), en su color; más barras, más espera (0,52 s + 0,17 s por paso) y suena el clac de la Perkins.
  3. **Escaneo:** la línea del color de la rareza resuelve la imagen real del motor de arriba abajo (1 s + 0,32 s por paso). Espera a que la imagen exista.
  4. **Fenómeno detectado** con su nombre, si lo tiene (1,3 s).
  5. **Fallo de pantalla** solo en Legendaria: dos sacudidas con separación RGB en 0,9 s, por debajo de 3 destellos por segundo (WCAG 2.3.1).
  6. **Carta:** sale de la pantalla girando, por encima del bisel, sobre un halo de su rareza, y suena su acorde (más brillante cuanto más rara; arpegio en Legendaria).
- **Ritmo:** una tirada espera al jugador en su carta; en una de diez las cartas siguen solas (1,9 s). Pulsar la pantalla o «Seguir» lleva a la carta de la tirada actual o a la siguiente; «Saltar» va al resumen. El resumen ordena de más a menos rara.
- **Accesibilidad:** cada carta revelada se anuncia («Legendaria: Kathra») en una región educada; el sonido se silencia con un botón y se recuerda; todo con teclado.
- **Movimiento reducido:** sin fallo de pantalla ni sacudidas, estática quieta, la imagen aparece con un fundido y cada carta espera al jugador.
- **Sonido:** sintetizado con WebAudio (sin archivos, la CSP no cambia), siempre después de un clic del jugador.
- **Fusión:** la galaxia nueva de una fusión usa este mismo revelado.


### Presentación pro (escáner y fusiones)

Plan «escáner pro», parte B. Activada por defecto [U, 2026-11-12]; se apaga en Ajustes → Pantalla.

**Cuándo sale la clásica:** sin WebGL2, mientras el tutorial guiado está en el escáner, o con el ajuste apagado. La fusión automática no tiene revelación.

**Fusión** (plan «fusión pro»): en vez del salto, las galaxias que entran aparecen en anillo alrededor de un núcleo (`ignicion`), giran cada vez más rápido y más cerca mientras el núcleo anticipa la rareza (`orbita`, con `ascenso` a veces), se hunden en él una a una (`colapso`) y la nueva nace de la explosión (`impacto`, `carta`). Con movimiento reducido, el anillo se funde en su sitio.

**Cómo está hecha:**
- **Línea de tiempo:** una sola de GSAP, en pausa, construida a partir de un guion de datos (`scanner/pro/script.ts`, `GUION`).
- **Rig:** la línea de tiempo no mueve elementos. Mueve un «rig» de números, que leen en cada fotograma la escena 3D (three.js, en su propio trozo) y las capas del DOM (variables CSS).
- **Reloj:** el reloj de audio lleva el tiempo, así imagen y sonido no se separan.

**Fases:**
1. **Cierre:** al pulsar, dos bandas negras cierran la pantalla, de arriba abajo y de abajo arriba, hasta el negro absoluto. Ocurre mientras la petición viaja.
2. **Ignición:** nace un punto de luz con un destello anamórfico y las bandas se abren a formato cine (12 % arriba y abajo).
3. **Salto:** viaje warp entre estrellas que se estiran. Desde rara, la estela toma el color de la rareza máxima.
4. **Ascenso:** a veces, una épica finge acabar y una legendaria rompe de violeta a dorado, con un solo destello.
5. **Caída:** una estrella fugaz, o diez en lluvia, la primera del color máximo.
6. **Impacto:** un parón, dos ondas expansivas, un resplandor y chispas.
7. **Las cartas:**
   - **Una tirada:** la carta sube boca abajo y gira. En la banda inferior, el nombre se escribe letra a letra y la rareza se estampa con sus rombos (1–5).
   - **Diez:** las cartas caen boca abajo en una rejilla de 5×2, de menor a mayor rareza. Giran en cascada, con el canto encendido en su color justo antes. Épicas y legendarias pasan a primer plano, la legendaria con rayos dorados.
   - **«¡Destacada!»** bajo la banda superior y **«Fenómeno detectado»** dentro de ella.
8. **Resumen:** el mismo de la clásica, sobre el cielo apagado.

**Durante la cinemática:**
- **Controles:**
  - «Seguir» (clic, Espacio) va a la siguiente parada y nunca se salta una revelación;
  - «Saltar» y Escape van al resumen;
  - los dos se ignoran 400 ms al empezar y 250 ms tras cada salto.
- **Una tirada** espera en su carta («Pulsa para seguir»).
- **Imagen que no llega:** la carta espera hasta 4 s antes de girar.

**Sonido:**
- cada momento tiene su sonido sintetizado;
- se puede cambiar por un archivo en `src/assets/audio/escaner/` (ver su `LEEME.md`);
- la música son cuatro capas de un mismo bucle, que entran según la rareza más alta vista;
- la música del juego espera mientras tanto.

**Movimiento reducido:**
- sin salto, ascenso, temblores, destellos ni parones;
- las cartas aparecen y se descubren con fundidos.

**Fotosensibilidad** (comprobada por test): como máximo 2 destellos por segundo, con opacidad de 0,6 o menos y ninguno rojo.

**Rendimiento:**
- un contexto WebGL que se devuelve al cerrar;
- resolución de 1,5 como mucho, que baja a la versión ligera si los primeros fotogramas pasan de 20 ms.

**Ensayo** (`/admin/escaner-ensayo`): la reproduce con tiradas inventadas, para dirigirla. Detalle en el plan.

## 8 ter. Hangar y resultados

Antes y después de cada incursión (GDD §5.1, §8.4, §11.3 bis). Consulta de ui-ux-pro-max: indicador de carga accesible en la acción principal, números con formato español, tablas estrechas y conteos que desaceleran al llegar.

- **Hangar:** la misma cabecera que la colección (volver, título y saldo) y tres paneles (en dos columnas por debajo de 1400 px, con las reliquias debajo):
  - **Sector** (M3b-3, GDD §5.5).
    - **Arriba, el elegido:** nombre, la insignia «Temporada» en Ultravioleta si lo es, la descripción, el Núcleo con su sprite en una caja roja suave, la fauna en losas de 56 px y «Capas de 5 min, con su Núcleo y su extracción».
    - **Debajo, las losas de los 5 sectores:** las mismas que las de las sondas, con el sprite de su Núcleo a 1× (40 px).
      - **Abiertos:** su línea es «Elegido» (Solar), «Temporada» (Ultravioleta suave) o «N especies».
      - **Cerrados:** lo que los abre, «Derrota a <Núcleo del sector anterior>», con su barra 0/1. Una temporada cerrada dice «Fuera de temporada», sin barra.
  - **Sonda** (M3b-2, GDD §6). Consulta de ui-ux-pro-max: el estado elegido no se marca solo con color, y el progreso se muestra con una barra.
    - **Arriba, la elegida:** su sprite a 7× a la izquierda y, a la derecha, el nombre, la descripción, vida, velocidad y su peculiaridad en una losa.
    - **Nivel** (M4b-1, GDD §6). Consulta de ui-ux-pro-max: el estado activo se marca con color y borde, el estado final no depende de una animación, y los botones desactivados dicen por qué.
      - Una losa con «Nivel 3 de 10» y diez pips: los conseguidos en Terminal con brillo y los que faltan en `--panel-lip`.
      - Debajo, lo que da el nivel en Terminal («+6 % de vida y +4 % de daño»).
      - El botón Solar «Subir a nivel 4», con su coste («60 componentes y 1000 monedas»). Sin fondos está desactivado y dice «Te faltan…»; al 10 dice «Nivel máximo».
    - **Arma inicial:** un grupo de tarjetas de radio (la base y sus dos variantes), con nombre y qué hace. Las tarjetas van en columnas de 260 px como mínimo: una por fila cuando el panel es estrecho.
      - Cada tarjeta lleva la escena del arma en acción, pintada en Aseprite: 32×32 a ×2, cuatro fotogramas con `steps(4)`, quieta con movimiento reducido. Las fuentes están en `art/weapons` y las genera `paint-weapons.lua`.
      - Las variantes de doble, amplia o cadena enseñan su diferencia. Las de elemento usan la rampa de su elemento y sus partículas (copos, llamas, chispas, gotas, burbujas, prisma, grietas o glifos).
      - En la incursión, el icono de 12×12 de una variante es el de su base:
        - teñido con las dos tintas de su elemento;
        - o con una marca de 4×4 en la esquina: dos barras para la doble, un anillo para la amplia, puntos para la cadena y un galón para la rápida.
      - La elegida lleva borde y brillo Solar y una marca.
      - Una cerrada lleva borde discontinuo, el icono en gris, un candado y «Se abre en el nivel 8».
      - El foco es un anillo hielo alrededor de la tarjeta.
      - Elegir otra se ve al instante, y si el servidor la rechaza vuelve la anterior con su error.
    - **Debajo, las ocho sondas** en losas horizontales: sprite a 3×, nombre y una línea. Van en columnas automáticas de 168 px como mínimo, para que haya dos también con tres paneles en portátiles de 1440–1600 px; el texto pasa a dos líneas si no cabe.
    - **Desbloqueadas:** son botones con relieve, cuya línea es el arma inicial. La elegida lleva borde y brillo Solar, «Elegida» en Solar y una marca. Al pulsar otra, su borde late en Solar mientras se guarda.
    - **Bloqueadas:** borde discontinuo, el sprite en gris oscuro con un candado y lo que la gana («Juega 3 incursiones», «Derrota 3 Núcleos», «Llega a la capa 4», «Extrae 5 veces», «Elimina 2000 enemigos»). Debajo, una barra Terminal con el conteo «1/3» al lado. Sin condición, «Llega pronto».
    - El panel de la sonda es algo más ancho que el del sector (1,15 fr frente a 1 fr) para que quepan dos columnas de losas.
  - **Reliquias:** seis ranuras en 3 × 2, con estos estados:
    - **Abiertas:** borde discontinuo y «Elegir reliquia».
    - **Cerradas:** candado y «Se abre más adelante».
    - **La siguiente** (M4c-1): borde discontinuo Solar, candado Solar, lo que la abre («Juega 5 incursiones»), una barra Solar y «2/5». Con el hito cumplido el borde pasa a continuo y late despacio (quieto con movimiento reducido), y aparece «Abrir ranura» con su polvo. Ver §8 nonies.
    - **Ocupadas:** la carta, el nombre, la familia (hielo), el elemento (chip de su color), el fenómeno y la potencia, con un botón para quitarla.
    - **La misma familia apilada** (M4c-1, §8.6): la potencia de cada carta ya cuenta la regla, y si una familia llega a tres se explica debajo de las ranuras, en tinta apagada: «Desde la tercera reliquia de la misma familia, cada una rinde la mitad que la anterior».
  - **Conjuntos** (M3b-1, GDD §8.3), bajo las ranuras, en columnas automáticas de 260 px como mínimo:
    - **Activos:** losa con borde Solar y un leve brillo, con el nombre, la condición («Dos o tres galaxias de la misma paleta») y el bonus en Solar («Potencia elemental +25 %»). Si hay un escalón mayor, una pista apagada dentro («Con una tercera galaxia de Oro solar»).
    - **A una galaxia:** losa con borde discontinuo y texto apagado (color, no opacidad, para no bajar el contraste): «Falta una galaxia con Galaxia satélite».
    - **Ninguno:** una línea que explica cómo se consiguen.
    - Un cambio de equipo rechazado (409) se dice debajo de las ranuras, en rojo y con `role="alert"`.
- **Elegir reliquia:** un diálogo con la colección por rareza. Las galaxias de otra ranura muestran «Equipada» y no se eligen.
- **Barra de lanzamiento:** fija abajo para que se vea siempre, también a 1280×720. A la izquierda va el rendimiento del día, en Terminal con «Premio completo: te quedan 2 h 40 min hoy» o en Solar con el tramo actual, y su explicación. A la derecha, «Lanzar incursión»: Solar, de 76 px, con relieve y `aria-busy` mientras se prepara.
- **Resultados:**
  - **Título:** «Extracción completada» en Terminal, «Sonda perdida» en rojo o «Incursión abandonada» en Solar.
  - **Datos de la partida:** cuatro datos (profundidad, tiempo, bajas y nivel).
  - **Botín:** una tabla con una fila por capa y su multiplicador, «Sin extracción se cobra la mitad» en rojo cuando toca, y los tramos del día como píldoras (las recortadas, en Solar).
  - **Cobrado:** grande, con contadores que suben (fijos con movimiento reducido).
  - **Acciones:** «Volver al inicio» y «Otra incursión», que tiene el foco.
- **Resultado sin enviar:** «Enviando el resultado». Si no llega, «No se pudo enviar el resultado. Se guarda hasta que llegue» con «Reintentar».
- **Colección:** una galaxia equipada lleva la chapa Terminal «Equipada». En su detalle, Desintegrar está deshabilitado y debajo se explica por qué. En la fusión no se puede elegir.

## 8 quater. Arena de las incursiones

La pantalla del juego en sí (GDD §5, §17.2–17.3). PixiJS v8 solo dibuja la simulación; el HUD es React encima (§8 quinquies). Consulta de ui-ux-pro-max: estilo *pixel art* (nitidez sin suavizado, paleta limitada, animación por fotogramas), contraste ≥ 4,5:1 en todo texto, poco movimiento a la vez y respeto de `prefers-reduced-motion`.

- **Escala:** zoom entero (`round(alto / 340)`, mínimo 1) con muestreo `nearest`; la cámara se redondea a píxeles de pantalla. Se ve una altura de mundo de ~340 u (300–400 según el monitor) y como mucho **21:9** de ancho; lo que sobra son **bandas laterales** con estática tramada oscura y un filete `--panel-lip`, sin ventaja de visión.
- **Zoom con la rueda [U, 2026-11-11]:** en solitario y en grupo, la rueda del ratón acerca la vista a pasos enteros, hasta el doble de cerca (a 1080 px, de ×3 a ×6), y la devuelve. La vista de siempre es la más lejana. Entre pasos se desliza unos fotogramas (al instante con movimiento reducido), y el nivel se recuerda en el navegador para la próxima incursión. Solo cambia el dibujo: la simulación y el lockstep no se enteran, y cada jugador del grupo tiene el suyo.
- **Suelo:** `--void` con nubes de nebulosa tramadas (Bayer 4×4) en violeta y azul muy apagados (contraste ≤ 1,6:1 con el fondo), motas braille muy tenues (32 %) y un leve paralaje de estrellas al 50 %. Las rocas, el hielo, el coral, la escoria y los cristales del bioma son **objetos rompibles** de la simulación (SIM 1.7.0): opacos, con un destello blanco de vez en cuando que dice «se puede romper», una barra de vida roja de 2 px encima en cuanto reciben daño y grietas al bajar del 66 % y del 33 %. Al romperse estallan en partículas del polvo del bioma y sueltan componentes y polvo. Todo es determinista por trozos de 256 u y sin colisión.
- **Sprites (pixel art en código, contorno de 1 px `#0b0c24`, luz arriba a la izquierda):**
  - **Sonda Lumen:** cuerpo hielo y blanco con visor cian y propulsor Solar que parpadea; mira hacia donde se mueve (volteo horizontal).
  - **Fauna de la Estática:** cada especie con su tono para reconocerla al vuelo, con acentos magenta y cian de la Estática. Ácaro: magenta. Célula: violeta. Manta: azul tinta con bordes magenta. Coral: coral y naranja. Caparazón: placas acero con núcleo magenta, y su frente blindado es un arco claro visible. Jefe: colmena de 40 px con celdas, grietas y núcleo que late.
  - **Proyectiles:** los propios son claros y fríos (hielo, Solar, violeta del arco); los enemigos son círculos `--static` con centro blanco y contorno, siempre distinguibles por forma y color de los propios.
  - **Botín:** fragmentos de datos como gemas braille en **verde Terminal** (1 y 5; el 25 en Solar), lo único verde del suelo. Monedas Solar, polvo hielo centelleante, kit de reparación rojo Nova con cruz blanca, **imán** de herradura roja con puntas blancas que parpadean (al recogerlo, onda verde y todos los datos del mapa vuelan hacia quien lo cogió) y **componente** como tuerca de acero con núcleo Terminal.
  - **Dash** (salto de Chispa, Embestida del cometa): la sonda se desliza 0,12 s con salida suave, deja 5 imágenes fantasma cian que se apagan en 0,28 s, chispas en el origen y el destino y un «whoosh» de ruido filtrado. La invulnerabilidad es un brillo suave con un aro cian, no un parpadeo. Con movimiento reducido no hay estela.
- **Capas:** suelo → decoración → recogidas → áreas (charcos, novas, auras, campo lento) → avisos → enemigos → sondas → disparos → efectos y números.
- ***Juice*:**
  - **Golpe:** destello blanco de 6 ticks y número de daño (Fredoka 700 blanco con contorno oscuro; crítico Solar y más grande) que sube 18 px y se apaga en 0,6 s. Como mucho 60 números a la vez; los demás se suman al último.
  - **Bajas:** explosión de 6–10 partículas del color de la especie.
  - **Elementos:** partículas de su color (quemadura naranja, ralentización azul, corrosión verde, descarga violeta, hackeo ámbar, robo de vida rojo, escudo esmeralda, rebote neón).
  - **Daño recibido:** sacudida de 3 a 6 px que decae al 85 % por fotograma, más un borde rojo en la pantalla (HUD).
  - **Élites y jefe:** cada 0,8 s, durante 80 ms, glitch de la Estática con copias desplazadas 1 px en rojo y cian.
- **Avisos (siempre antes del golpe):**
  - **Embestida:** banda roja translúcida que late, con flecha.
  - **Ráfaga del jefe:** anillo que se cierra.
  - **Explosión de Inestable:** círculo rojo que se llena.
  - **Lanza** (tiradores `lancer`, M3b-3): la misma banda que la embestida, del largo de su alcance, mientras apuntan.
  - **Salto** (`blink` de fauna y Núcleos): círculo rojo que se llena donde va a aparecer. Al saltar, chispas lila donde estaba y violeta donde llega. Un Núcleo que salta queda como un fantasma (20 % de opacidad) hasta aparecer.
  - **Minas** de los Núcleos: los círculos rojos que se llenan de la explosión de Inestable, uno por mina. Estallan con partículas rojas y una sacudida de 3 px.
- **Apoyo** (`support`, M3b-3): anillo verde Terminal si cura y lila si escuda. Cualquier enemigo con escudo lleva el círculo hielo, sea élite o no.
- **Biomas** (M3b-3, GDD §5.5). Cada sector cambia los tres tonos de la nebulosa, las estrellas, las motas y las rocas, siempre oscuros y de poco contraste; los avisos son del mismo rojo en todos. Consulta de ui-ux-pro-max: la legibilidad de los avisos no depende del fondo.
  - **Nebulosa Exterior:** la de M3a.
  - **Anillos de Escarcha:** bruma azul fría y cristales de hielo.
  - **Arrecife Hueco:** violeta y turquesa, con corales rosa y turquesa.
  - **Forja Rota:** humo pardo con estrellas de brasa y escoria con ascuas, lejos del rojo de los avisos.
  - **Fisura de la Señal:** estática violeta y esquirlas flotantes.
- **Fauna y Núcleos de M3b-3:** se dibujan por regla con la forma, tres tonos del bioma con luz arriba a la izquierda, rasgos a mano y un contorno de 1 px. Llevan dos fotogramas, y los Núcleos miden 40×40 como la Colmena. PERKINS presenta cada sector y cada Núcleo nuevos la primera vez, con una línea.
- **Baliza de extracción:** anillo Terminal con puntos braille que giran, haz vertical y arco de progreso mientras estás dentro.
- **Arsenal (M3b-1):**
  - **Luz aditiva:** rayos, llamas y estallidos van en una capa que suma luz, para que brillen sobre el fondo oscuro en vez de enturbiarlo.
  - **Rayo continuo:** línea con núcleo blanco de 2 px y halo del color de su elemento (violeta sin elemento), con un leve parpadeo.
  - **Lanzallamas:** abanico naranja muy tenue, cinco lenguas de fuego que se alargan y encogen desfasadas, y un núcleo Solar y crema junto a la boquilla.
  - **Pozo gravitatorio:** disco violeta oscuro con tres arcos lila que giran hacia el centro.
  - **Bombardeo orbital:** retícula roja que late durante el aviso y estallido Solar al acabar; minas y misiles estallan igual.
  - **Sprites:** misil con estela, esquirla de cristal, fragmento Solar, mina con luz roja que parpadea, disco cian que gira, torreta acero que apunta, y la evolución dorada de cada icono.
- **Reacciones y estados:**
  - **Reacción:** su nombre (Fredoka 700 de 15 px con contorno oscuro) sube sobre el enemigo y se apaga en 0,9 s, con un destello. El color va por efecto: cadena cian, explosión naranja, rotura hielo, aturdimiento Solar, contagio Terminal y drenaje rojo. Nunca solo color: siempre lleva el nombre. Como mucho 6 a la vez.
  - **Marca de elemento:** una gota de 3 px del color del elemento sobre la cabeza.
  - **Aturdido:** dos estrellas Solar que giran sobre la cabeza.
  - **Roto:** cuatro grietas hielo alrededor.
  - **Evolución:** un anillo dorado que crece desde la sonda y una lluvia de chispas Solar.
- **Movimiento reducido:** sin sacudida ni glitch (un tinte fijo marca élites y jefe), mitad de partículas, números y nombres de reacción sin desplazamiento (solo fundido), y lenguas, remolinos y discos quietos.

## 8 quinquies. HUD, mejoras, pausa y radio

React encima de la arena, sin capturar el ratón salvo en sus botones. Se lee de la simulación 10 veces por segundo, nunca a cada fotograma.

- **Experiencia:** barra de 10 px de lado a lado arriba, de Terminal a hielo.
- **Fila superior** (anclada a los bordes, también en ultrapanorámicas):
  - **Izquierda:** nivel («Nv 13» en Solar) y vida (barra Nova con «101/130»; el escudo, en hielo encima; late en rojo por debajo del 30 %).
  - **Centro:** tiempo (Bungee), capa (píldora UV) y fase («Núcleo en 0:59», «Núcleo de la Estática» en rojo, «Cierra en 42 s» en Terminal).
  - **Derecha:** botín (monedas, polvo) y bajas, cada uno con `role="img"` y la frase entera, y el botón de pausa de 44 px.
- **Equipo:** abajo a la izquierda, armas (44 px) y pasivas (36 px) con su icono pixel y su nivel en una chapa hielo. Un arma evolucionada lleva borde Solar con un leve brillo y su icono de contorno dorado.
- **Jefe:** debajo del centro, «Núcleo de la Estática» en rojo, el nombre en Bungee y una barra roja.
- **Baliza:** etiqueta Terminal sobre ella, o en el borde de la pantalla con una flecha si está fuera; «Llega a la baliza · Cierra en 42 s · 380 u» o «Extrayendo 60 %».
- **Radio de PERKINS:** abajo al centro, una o dos líneas, «PERKINS» en Terminal. Se cierra sola a los 7 s o con su botón, y cada mensaje sale una vez por jugador.
- **Mejora:** diálogo con tres cartas (número, icono pixel de 64 px, nombre en Bungee, «Nueva» en Solar o «Nivel 3», qué hace). Las cartas son un `radiogroup`: 1–3 eligen, las flechas mueven, Enter o un clic confirman; con mando, la cruceta o el stick mueven y A confirma. El mundo espera congelado y Escape no hace nada. Una elección solo vale para la oferta que estaba en pantalla.
- **Evolución:** cuando un arma puede evolucionar, su carta sale primera: borde Solar, un lavado cálido desde arriba y un brillo, la etiqueta «Evolución» y «Evoluciona tu Pulso láser» antes de lo que hace.
- **Pausa:** Escape, P o Start, y sola al ocultar la pestaña o perder el foco. Ofrece Continuar (Solar), apuntado manual, sonido y «Abandonar incursión» (Nova), que confirma en un `alertdialog` con «Se cobra la mitad del botín. No se puede deshacer» y el foco en «Seguir jugando».
- **Final:** «Extracción completada» (Terminal) o «Sonda perdida» (rojo) en grande sobre un velo durante 1,5 s, y después los resultados.
- **Accesibilidad:** vida y experiencia son `progressbar` con su valor. Una región educada anuncia solo lo importante (nivel, jefe, baliza, capa, vida baja, cada evolución y la primera vez de cada reacción en la partida), nunca cada golpe. Con movimiento reducido no hay latidos ni entradas animadas.

## 8 sexies. Test de la sonda

Justo después de crear la cuenta, y desde el Hangar si falta (GDD §6, §12.2). PERKINS pregunta; tú no eliges la sonda, la descubres. Consulta de ui-ux-pro-max: indicar el progreso en cada paso, dejar volver atrás y dejar saltar el test.

- **Fondo:** `--void` con un resplandor UV arriba, a pantalla completa y centrado, como un momento aparte del juego.
- **Entrada:** «Test de la sonda» en Bungee, el mensaje de PERKINS en una losa con borde Terminal, «Empezar» (botón Solar grande, con el foco) y «Saltar el test» como enlace discreto, que responde al azar y revela igualmente la sonda.
- **Pregunta:**
  - «Pregunta 2 de 5» y cinco barras de progreso: hechas en Terminal, la actual en Solar.
  - La pregunta en Bungee (24–34 px, como mucho 30 caracteres por línea).
  - Tres cartas de respuesta con relieve (texto de 20 px y su número 1–3 en una chapa). 1–3 o un clic eligen y pasan a la siguiente. Una tecla mantenida, una tecla con modificador o el segundo clic de un doble clic no responden.
  - El foco va al título de cada pregunta (sin anillo), nunca a una respuesta: así un Enter mantenido no recorre el test.
  - Abajo, «Atrás» y «Saltar el test».
- **Desempate:** solo si las cinco empatan. Encima, «Hay un empate», y la sexta pregunta igual que las demás.
- **Confirmar:** al terminar no se envía nada todavía. «Listo, ya sé con quién viajo» y el aviso de PERKINS de que no hay vuelta atrás, con «Descubrir mi sonda» (Solar grande) y «Atrás», que vuelve a la última pregunta. «Saltar el test» lleva a la misma pantalla con «¿Saltar el test?» y «Volver al test», que deja las respuestas como estaban.
- **Envío:** «Calibrando tu sonda». Si falla, «No se pudo enviar el test» y «Reintentar» con las mismas respuestas. Nada se guarda antes de enviar: recargar empieza de nuevo.
- **Revelado:** el fondo toma el color de la sonda (hielo, Solar o lila) y la sonda sube y crece desde el resplandor (0,9 s, quieta con movimiento reducido). Debajo van:
  - «Tu sonda»;
  - el nombre en Bungee;
  - el perfil («Eres de los que…»);
  - vida, velocidad y arma inicial;
  - la peculiaridad en una losa;
  - «Ir al hangar» (Solar).

## 8 septies. Estación

El Hogar de la portada lleva a la estación (GDD §10): la base es el menú. Consulta de ui-ux-pro-max: cada sala responde al pasar el ratón, el foco se ve siempre, un botón sin recursos está desactivado y dice cuánto falta, y los números de un campo no se confunden con el texto.

- **Corte lateral:** dos cubiertas de cinco salas dentro de un casco de acero remachado (degradado de `#1d2148` a `#12153a`, borde de `--panel-lip`, una fila de remaches arriba y abajo). Por debajo de 1100 px, tres salas por fila.
- **Sala:** su escena pixel art pintada en Aseprite y una placa con el nombre en negrita y una línea debajo.
  - **La escena:** 64×44, cuatro fotogramas a 0,18 s. Las reproduce el CSS con `steps(4)`, a ×3, ×4 o ×5 en píxeles enteros, y queda quieta en el primero con movimiento reducido.
  - **El pintor:** `art/station/paint-rooms.lua` deja cada sala en `art/station/<variante>.aseprite`, con las capas casco, maquina, efectos y averia, y exporta la tira a `apps/web/src/station/rooms/`.
  - **Lo que se ve:** cada sala es una celda del casco, con techo y tubería, una lámpara con su cono de luz tramado, paneles biselados con remaches, ventana al espacio con estrellas que titilan, suelo de rejilla y mamparos. La máquina tiñe la pared con su luz.
  - **Rota:** la luz apagada, la máquina quieta y más oscura, una luz de emergencia roja que parpadea, una grieta, un cable suelto que echa chispas y la Estática en ráfagas.
  - **Herramienta** (Escáner, Planetario, Hangar, Colisionador): enlace a su pantalla; la línea dice para qué sirve.
  - **Máquina** (Refinería, Antena): botón que abre su panel; la línea dice el nivel en Terminal. El Laboratorio (M4b-2) se repara así y, arreglado, es una herramienta que enlaza a `/laboratorio`.
  - **Rota** (la Antena al empezar): la escena oscurecida, cruzada por una grieta y el ruido de la Estática, que se mueve; borde rojo tenue y «Rota» en rojo.
  - **De más adelante** (Comunicaciones, Archivo, Trofeos): la escena rota al 62 % de opacidad, sin botón ni enlace, y «En reparación».
  - Al pasar el ratón la sala sube 3 px con un borde y un brillo Terminal; el foco es un anillo hielo de 3 px. Con movimiento reducido no sube.
- **Barra:** material en bruto (cubo naranja), componentes (llave Terminal), monedas y señales, leídos como frases.
- **Panel de la Refinería:** diálogo con qué hace, nivel, ritmo («20 por hora») y listos; la cola como barra Solar con «En cola · 30/100»; el campo «Cantidad» (por defecto todo lo que cabe, y nunca más de lo que cabe), «Cargar», «Recoger 20 componentes» (Solar) y la mejora.
- **Panel de la Antena:** rota, «La Estática la tiene muda» y «Reparar». Funcionando: nivel, ritmo («Una señal cada 8 h»), lo que espera y a qué hora se llena, y «Recoger».
- **Mejora:** botón Solar con la llave, «Reparar» o «Mejorar a nivel 2» y su coste («40 componentes y 500 monedas»); desactivado sin recursos, con «Te faltan 8 componentes» debajo, y «Al máximo» al final. Cada error de la API sale en el panel con su texto.

## 8 octies. Laboratorio

Se entra desde su sala en la estación (GDD §10.6, M4b-2). Rota, abre un panel con qué es y «Reparar» con su coste. Arreglada, enlaza a `/laboratorio`.

Consulta de ui-ux-pro-max: no hubo resultado para «árbol de mejoras». Se aplicó la guía de estados desactivados (menos opacidad, otro cursor, y nunca parecerse al estado normal) y cada nodo cerrado dice qué le falta.

- **El plano:** cuatro ramas en columnas (dos por debajo de 1300 px y una en el móvil).
  - Cada rama es un panel de vidrio oscuro con la retícula de un plano y un borde del color de su rama: Sonda hielo, Reliquias ultravioleta, Estación Solar y Extracción Terminal.
  - Encima va su nombre en la tipografía de títulos con su icono.
- **Nodos:** un árbol de verdad. Cada nodo lleva dentro la lista de los que abre, sangrada bajo él, con una línea vertical del color de la rama y un brazo corto hasta cada tarjeta.
- **Cada nodo:**
  - su icono de 48 px;
  - el nombre;
  - qué da por nivel («+2 % de vida por nivel», «La refinería va un 5 % más rápida por nivel»);
  - «Nivel 2 de 5» con sus pips, del color de la rama;
  - lo que da ahora («Ahora +4 %»).
- **El botón:** Solar a todo lo ancho, con «Mejorar a nivel 3» y debajo su coste («102 de polvo y 38 componentes») en la tinta del botón. Sin fondos está desactivado y dice «Te faltan…».
- **Estados:**
  - **Cerrado:** borde discontinuo, el icono en gris y «Necesita Blindaje reforzado», sin botón.
  - **Al máximo:** borde y brillo del color de la rama, y «Al máximo».
- **Cabecera:** «Volver a la estación», el título y el saldo de polvo y componentes.
- **Sin reparar:** «Repara el laboratorio en la estación para usarlo» y «Ir a la estación».

**La pizarra** (plan de tienda y laboratorio, F3; la maqueta aprobada en F0) es la vista de siempre; la de arriba queda como «Lista» (`?vista=lista`).
- **Un tablero que llena la pantalla bajo la cabecera**, con una retícula de puntos que se mueve con él.
- **El núcleo permanente** («Para siempre», solar) y, mientras hay una temporada abierta con su árbol, **el de temporada** a su derecha (ultravioleta, con su nombre y «Se reinicia el…»).
- **Colocación:** cada núcleo es un árbol radial. Las ramas salen en diagonal y su ancho va según sus hojas; cada profundidad es un anillo más afuera, y un árbol grande abre sus anillos hasta que ningún nodo se apiña. La pista `at` de un nodo manda.
- **Nodos:** su icono, un disco y un aro con un tramo por nivel (`pathLength` igual al máximo).
  - Bloqueado: borde discontinuo y el icono en gris.
  - Disponible: late.
  - Puedes pagarlo: borde del color de la rama.
  - Al máximo: dorado.
  - Debajo, su nombre y «N / máx». Con el zoom lejos, sin rótulos.
- **Aristas:** curvas suaves desde quien lo abre. Se iluminan con el color de la rama al abrirse.
- **Moverse:**
  - arrastrar, a partir de 5 px para que un clic siga siendo un clic;
  - la rueda o dos dedos acercan hacia el puntero, de ×0,3 a ×2,5;
  - teclado: +, − y 0; las flechas van de nodo a nodo, y [ y ] suben y bajan por la rama;
  - herramientas abajo a la izquierda: acercar, alejar, «Ver todo», ir a cada núcleo, «Leyenda» y «Corrimiento al rojo» (en un diálogo);
  - el minimapa, abajo a la derecha, lleva a donde se pulse.
- **Panel del nodo**, a la derecha:
  - núcleo y rama;
  - nombre y qué da por nivel;
  - las barras de nivel;
  - «Ahora» y «Siguiente nivel», calculados en el servidor;
  - coste, con lo que falta en Nova;
  - qué lo abre;
  - en los de temporada, «Se reinicia el…»;
  - «Mejorar a nivel N», o por qué no se puede.
- **Subir de nivel:**
  - el tramo se llena, el disco da un bote y saltan chispas;
  - la energía corre por las aristas de los nodos que se abren, cada uno con su campanilla;
  - suena un arpegio que sube con el nivel, y un acorde y «… al máximo» al llegar arriba.
  - Con movimiento reducido: sin movimiento, solo el sonido.

## 8 nonies. Niveles de las reliquias

Una galaxia sube de nivel con polvo estelar desde su detalle, y la siguiente ranura de reliquia se abre desde el Hangar (GDD §8.4 y §8.4 bis, M4c-1).

Consulta de ui-ux-pro-max: se aplicaron dos guías, «enseñar el progreso de lo que tiene varios pasos» (barra con su conteo) y «un estado desactivado nunca se parece al normal». Cada botón sin fondos dice además cuánto falta.

- **En el detalle de una galaxia:** un bloque bajo sus datos con:
  - «Nivel 3 de 10» y diez pips Terminal;
  - «Subir a nivel 4», Solar, con su coste debajo («55 de polvo»). Sin polvo está desactivado y dice «Te faltan 20 de polvo». En el 10, «Nivel máximo»;
  - si ya tiene niveles, lo que devuelve: «Al desintegrarla o fusionarla devuelve 27 de polvo de sus niveles».
- **En el Hangar:** la ranura que sigue a las abiertas enseña su hito y su barra (§8 ter). Las demás siguen con su candado.
- **Errores:** debajo del botón, en rojo y con `role="alert"`. Una vista vieja vuelve a leer y lo dice («Esa galaxia ya había cambiado de nivel. Mírala y vuelve a intentarlo»).
- **Lectores de pantalla:** «Te faltan…» es la descripción del botón desactivado (`aria-describedby`), y la barra de la ranura se nombra con su hito y dice «2 de 5» (`aria-valuetext`).

## 8 decies. Planetario

Cada jugador expone hasta seis galaxias en la cúpula de su estación, y cualquiera puede visitarla por su nombre o desde los destacados (GDD §10.5 y §14.2, M4c-2). La sala Planetario de la estación lleva a `/planetario`, y una visita a `/planetario/<nombre>`.

Consulta de ui-ux-pro-max: se aplicaron tres guías:
- «un estado vacío guía con un mensaje y una acción»: el planetario vacío invita a exponer y cada pedestal vacío es un botón;
- «una búsqueda sin resultados no es un callejón sin salida»: un nombre sin planetario lo dice y ofrece buscar otra vez;
- «navegación completa con el teclado y el foco visible».

El autocompletado de nombres no se hizo: listaría usuarios a cualquiera.

- **La cúpula:**
  - Es una escena de Aseprite de 192×96 en ocho fotogramas (`art/planetarium/paint-planetarium.lua`). Contiene la retícula de la cúpula, nebulosas y constelaciones que giran, el proyector de estrellas, las luces del borde y seis pedestales con su haz holográfico.
  - Se pinta a escala entera: ×5 hasta 1559 px de ancho, ×6 desde 1560 y ×7 desde 1880 con al menos 1000 de alto.
  - Con `steps(8)` se mueve y con movimiento reducido se queda quieta.
- **Los pedestales** son una lista («Pedestales»):
  - Cada carta flota sobre el suyo, centrada en su pedestal, con un brillo cian, y mide 24 píxeles de arte de ancho.
  - Un pedestal vacío es un hueco discontinuo cian con «Exponer galaxia». Su nombre accesible dice cuál es («Exponer galaxia en el pedestal 2»).
  - Uno lleno tiene su carta, que se pulsa para cambiarla, y «Retirar» sobre la cara del pedestal.
  - Elegir usa el mismo diálogo que las reliquias del Hangar: la colección por rareza, y las que ya están en otro pedestal llevan «Expuesta» y no se eligen dos veces.
- **Al lado:**
  - **El prestigio:** el número grande en Solar, el bonus en Terminal («+2,9 % de experiencia en las incursiones»), cómo se suma y su tope, y las visitas con el icono del ojo.
  - **El campo «Visitar un planetario»** (`role="search"`). Con la columna estrecha su botón baja debajo.
- **Debajo, los destacados:** cartas pequeñas con la portada (la galaxia de más prestigio), el dueño y su prestigio. Enlazan a su planetario.
- **La visita:**
  - «Planetario de vega», sus cartas sin acciones, su prestigio y sus visitas, y el campo para visitar otro.
  - Sin nada expuesto dice «Todavía no ha expuesto ninguna galaxia».
  - Un nombre sin planetario dice «No hay ningún planetario con ese nombre».
- **En la colección:** una galaxia expuesta lleva «Expuesta». No se desintegra (el botón está desactivado y su descripción dice por qué) ni se elige para fusionar.

## 8 undecies. Temporada, clasificación y perfiles

La temporada se ve desde el inicio y tiene su clasificación. Cada jugador tiene un perfil público con su colección (GDD §4, §12.1, §14.1 y §14.2; M5a).

Consulta de ui-ux-pro-max: se aplicaron tres guías:
- **Enlaces profundos:** la pestaña va en la dirección (`/clasificacion?pestana=profundidad`), así que una vista se puede compartir.
- **Estado activo visible:** la pestaña actual, tu fila y tu tramo se marcan.
- **Teclado completo con el foco visible.** Las pestañas son enlaces del patrón `.tabs` (`aria-current="page"`), no un `tablist`: no hay flechas que aprender.

**Los emblemas de los tramos:**
- Son cinco escenas de Aseprite de 32×32 en cuatro fotogramas (`art/seasons/paint-tiers.lua`), cada una más rica que la anterior:
  - **Bronce:** un escudo heráldico con su borde y un chevrón;
  - **Plata:** el escudo con alas y un chevrón doble;
  - **Oro:** una estrella biselada con una gema;
  - **Platino:** un cristal tallado que destella;
  - **Estelar:** un medallón coronado con una galaxia espiral que gira.
- Un brillo recorre cada uno. Se pintan siempre a escala entera, ×1 en la lista de tramos y ×2 en el inicio y el perfil, y se quedan quietos con movimiento reducido.
- Son decorativos: el nombre del tramo va siempre al lado.

**El inicio:** la columna derecha es la temporada (§7), con cabecera Nova y el nombre de la temporada y los días que quedan. Debajo:
- el podio con los tres primeros;
- «Tu puesto», con el emblema y el nombre de tu tramo y «Te faltan 1395 puntos para Plata»;
- los jugadores;
- «Ver clasificación completa».

Sin temporada abierta dice «No hay ninguna temporada abierta». El mosaico «Ranking» lleva a la clasificación, y el avatar de la barra superior lleva a tu perfil y dice tu nivel en Terminal.

**La clasificación:**
- **Pestañas:** General (puntos), Profundidad (la capa más honda de la temporada) y Purgas (los Núcleos). Clanes está desactivada con «Llega con los clanes».
- **El podio:** el primero en el medio y más alto, el segundo a la izquierda y el tercero a la derecha. Cada escalón va en su metal (oro, plata, bronce) y cada nombre lleva a su perfil. En el código el orden es 1, 2, 3, para los lectores de pantalla.
- **La tabla** sigue desde el cuarto, con puesto, jugador con su avatar, nivel y valor (las cifras alineadas a la derecha).
  - Tu fila va resaltada en Hielo con «Tú».
  - Fuera de la tabla, tu fila se fija debajo con el borde Hielo («Tu puesto»).
  - Los empates comparten puesto.
- **Al lado:** la temporada (nombre, «Quedan 36 días» en Nova y los jugadores) y los tramos con su emblema y desde cuántos puntos. El tuyo lleva «Tu tramo».

**El perfil** (`/perfil/<nombre>`):
- avatar grande, nombre, nivel y «Miembro desde noviembre de 2026»;
- cuatro paneles:
  - **Esta temporada:** el tramo con su emblema, puntos, puesto, capa, Núcleos y extracciones;
  - **Récords;**
  - **Colección:** el recuento por rareza y «Ver su colección»;
  - **Planetario:** la portada, el prestigio y «Visitar su planetario».
- Un nombre sin jugador dice «No hay ningún jugador con ese nombre».

**La colección pública** (`/perfil/<nombre>/coleccion`): las cartas sin acciones, con los filtros por rareza (con su recuento) y «Cargar más».

**Los resultados de una incursión:** una franja con:
- «+200 de experiencia» en Terminal;
- el nivel, con «Subes de nivel» en Solar si sube (con un pequeño salto que se queda quieto con movimiento reducido);
- «+95 puntos de temporada» en Nova, si los hay.

## 8 duodecies. Clanes

Los jugadores crean clanes, se unen a ellos (abiertos, o pidiéndolo si son cerrados) y los gestionan por roles. La clasificación estrena su pestaña de Clanes (GDD §14.3 y §14.1, M5b-1). El mosaico «Clan» del inicio lleva a `/clanes`.

Consulta de ui-ux-pro-max: se aplicaron tres guías:
- **Confirmar lo que no se deshace:** expulsar, pasar el liderazgo y salir (o disolver, si eres el último) piden confirmación en un diálogo de alerta;
- **Estado al pasar el ratón:** cada tarjeta y cada opción cambian;
- **Etiquetas en una línea:** los nombres largos se cortan con puntos suspensivos.

**Los emblemas:**
- Son ocho figuras de Aseprite a 32×32 (`art/clans/paint-emblems.lua`), cada una sobre una insignia biselada de su color:
  - escudo, cometa, nebulosa en espiral, estrella, planeta con anillos, corona, ojo y rayo;
- Cada emblema es una tira con sus seis colores: Solar, Nova, Terminal, Hielo, Ultravioleta y Coral. El color se elige con la posición del fondo.
- Se pintan a ×1 (listas, clasificación, perfil, selector), ×2 (tarjetas, tu clan) o ×3 (la cabecera del clan), siempre a escala entera.
- Son decorativos: el nombre del clan va siempre al lado.

**La lista** (`/clanes`):
- tu clan arriba, si tienes uno;
- la búsqueda por nombre o etiqueta, que espera a que dejes de escribir;
- «Crear clan» en Solar, con su coste. Sin nivel o sin monedas está desactivado y su descripción dice qué falta;
- las tarjetas, cada una con su emblema, nombre, etiqueta, «Abierto» (Terminal) o «Cerrado» (Solar), los miembros y los puntos, más «Unirse», «Solicitar» o «Lleno».

**El diálogo de crear:**
- nombre, etiqueta (en mayúsculas mientras escribes) y descripción con su contador;
- el emblema y el color en rejillas de radios con nombre. Cada opción enseña el emblema en el color elegido;
- la entrada: abierta o cerrada, explicada;
- el coste junto a «Crear clan».

**La página del clan** (`/clanes/<etiqueta>`):
- **La cabecera:** el emblema a ×3, el nombre, la etiqueta, abierto o cerrado, los miembros, la descripción, y los puntos con el puesto de la temporada;
- **Las acciones del visitante:** «Unirse» o «Solicitar», o «Solicitud enviada» con «Cancelar solicitud». Un miembro ve «Salir del clan», y el líder también «Editar»;
- **Las solicitudes**, para el líder y los oficiales, cada una con «Aceptar» y «Rechazar»;
- **Los miembros**, en una tabla con avatar, nombre y su enlace, el rol (Líder en Solar, Oficial en Hielo), el nivel y los puntos.
  - Cada fila lleva lo que tu rol puede hacerle: «Ascender», «Degradar», «Liderazgo» o «Expulsar» (en Nova). Cada botón dice en su nombre accesible a quién se lo hace.
  - Tu fila va marcada con «Tú».

**En la clasificación**, la pestaña Clanes lista los clanes por los puntos de sus miembros con su emblema, y el tuyo marcado (o fijado debajo).

**En el perfil**, el clan va bajo el nombre como una cápsula con su emblema y su etiqueta, enlazada al clan.

## 8 terdecies. Chat

El chat de la comunidad y el de cada clan (GDD §14.4, M5b-2). Lo abre «Comunidad» en la barra de arriba, o «Chat del clan» en la página de tu clan.

Consulta de ui-ux-pro-max: se aplicaron tres guías:
- **Un solo aviso en vivo:** la lista es un registro (`role="log"`) y el estado de la conexión, un `status`;
- **El foco siempre visible:** contorno Hielo en pestañas, enlaces, acciones y el campo;
- **Desactivado con su porqué:** si no puedes escribir, el campo se apaga y dice por qué.

**La hoja** se abre a la derecha y no bloquea la pantalla (es un diálogo no modal):
- **Medidas:** 420 px de ancho y fondo opaco, pegada al borde derecho con 16 px de margen y bajo la barra de arriba (que sigue a la vista). Queda por debajo de los diálogos modales.
- **«Comunidad»:** se tiñe de Hielo mientras la hoja está abierta, y vuelve a pulsarse para cerrarla.
- **Al abrir:** entra deslizándose 28 px en 0,24 s (sin animación con movimiento reducido). El foco va al campo, o a las pestañas si no puedes escribir.
- **Al cerrar:** con Escape o con la X; el foco vuelve a quien la abrió.
- **El socket:** solo escucha mientras la hoja está abierta, y cada vez que conecta vuelve a leer el canal sin perder lo que llegue entretanto. Si se cae, «Reconectando».
- **En una incursión** la hoja se cierra: el teclado es del juego.

**Las pestañas:** Comunidad y, si tienes clan, Clan. Las flechas cambian de una a otra.

**Cada mensaje:**
- el avatar a 28 px, el nombre enlazado a su perfil (en Solar si es tuyo), «Nivel N», la etiqueta del clan (solo en Comunidad) y la hora;
- el texto conserva sus saltos de línea;
- tus mensajes llevan un fondo Solar muy tenue;
- al pasar el ratón o con el foco aparece «Denunciar» y, para moderadores, «Ocultar» y «Silenciar 1 hora» (en Nova). Cada acción dice en su nombre accesible a quién se hace;
- «Denunciar» pide confirmación en un diálogo de alerta, que cita el mensaje. Después queda «Denunciado» en Terminal;
- «Silenciar 1 hora» pide el motivo;
- sin el nivel para escribir no aparece «Denunciar»: las denuncias solo cuentan desde ese nivel.

**Escribir:**
- **El campo:** dos líneas (52 px) que se estiran arrastrando hasta 140 px, con «Enviar» en Solar.
- **Debajo:** la ayuda «Enter envía y Mayúsculas con Enter salta de línea» y el contador «12 de 280», que se pone en Nova al pasarse.
- **Si no puedes escribir:** en su lugar, en Solar, «Necesitas nivel 5 para escribir» o «Te han silenciado hasta las 14:05».
- **Si vas muy deprisa:** «Vas muy deprisa. Espera un poco», sin borrar lo escrito.

## 8 quattuordecies. Mercado

El mercado de galaxias (GDD §14.6 y §14.7, M5c-1). El botón «Mercado» de la barra de arriba lleva a `/mercado`, y «Vender» en el detalle de una galaxia lleva a vender esa misma.

Consulta de ui-ux-pro-max: se aplicaron cuatro guías:
- **Confirmar lo que no se deshace:** comprar pide confirmación con el precio y el saldo que deja; retirar un anuncio, también;
- **Éxito visible:** «Es tuya» al comprar, y «… está en venta durante 7 días» al vender;
- **Validar al salir del campo:** el precio dice el mínimo de su rareza y, al salir, qué está mal;
- **Teclado numérico:** el precio usa `inputmode="numeric"`.

**El puesto orbital:**
- Es una tira de Aseprite de 256×48 en cuatro fotogramas (`art/market/paint-market.lua`, capas en `post.aseprite`).
- Se ve a ×3, o a ×4 en pantallas de al menos 1500×860.
- Muestra la pared de la estación, un ojo de buey con un planeta anillado, el cartel con una moneda y dos mostradores cuyos emisores proyectan cartas de galaxia. Las cartas flotan y giran, y las luces de la viga se persiguen.
- Es decorativo, y sin animación con movimiento reducido.

**Las pestañas:** Comprar, Vender y Mis anuncios, cada una con su URL (`?pestana=vender|mios`).

**Quién puede comerciar:** sin nivel 10 o sin 3 días de cuenta, un aviso con candado y borde Solar dice qué falta. Todo se ve, pero los botones de comprar y vender se desactivan y su descripción es ese aviso.

**Comprar:**
- **Filtros:** rareza, orden (Más recientes, Más baratas, Más caras) y búsqueda por nombre, que espera a que dejes de escribir.
- **Cada carta:** la galaxia con su nombre, la rareza (Solar si es legendaria), el precio en Solar con moneda y el vendedor enlazado.
- **El botón «Comprar»** dice en su nombre qué compra. Sin monedas, debajo dice cuántas faltan. En lo tuyo pone «Tuya».
- **El diálogo** confirma con el precio y el saldo que deja. Después dice «Es tuya», con «Verla en tu colección». Si alguien se adelantó, lo dice y el escaparate se vuelve a leer.

**Vender:**
- **«Elegir galaxia»** abre el selector de la colección. Las equipadas, expuestas o ya en venta salen marcadas como «No disponible».
- **El precio** empieza en el mínimo de su rareza. Debajo, «Recibirás N monedas después de la comisión» en Terminal y los anuncios que quedan hoy.

**Mis anuncios:**
- **En venta:** cada anuncio con hasta cuándo y «Retirar», que se confirma.
- **Vendidas:** cada venta con el comprador enlazado, el precio y «Cobraste N monedas».

**En la colección:**
- una galaxia en venta lleva la insignia «En venta»;
- no se desintegra, fusiona ni mejora, y su detalle dice por qué.

## 8 quindecies. Trueque

Galaxia por galaxia entre dos jugadores (GDD §14.5, M5c-2). Se propone desde el perfil de otro jugador («Proponer trueque») y se sigue en la pestaña «Trueques» del mercado (`/mercado?pestana=trueques`).

Consulta de ui-ux-pro-max: se aplicaron dos guías:
- **Confirmar lo que no se deshace:** cancelar un trueque pide confirmación;
- **El estado siempre a la vista:** cada trueque dice a quién le toca.

**Componer el trueque** (proponer o «Cambiar»):
- **Las casillas:** «Doy» y «Quiero», una junto a otra con ⇄ en Solar entre ambas. Cada una tiene su carta o un hueco punteado que dice «Nada todavía».
- **Doy:** el selector de tu colección marca lo equipado, expuesto, en venta o en otro trueque como «No disponible».
- **Quiero:** un selector con la colección pública del otro.
- **El aviso:** «Lo que das queda reservado hasta que el trato se cierre o caduque en 3 días».
- **Enviar:** «Proponer» o «Guardar cambios», desactivados mientras no des nada.

**Cada trueque abierto:**
- **La cabecera:** «Con» y el otro jugador enlazado a su perfil, y hasta cuándo sigue abierto.
- **Las cartas:** «Tú das» y «Recibes», lado a lado.
- **El estado:**
  - «… ha confirmado. Te toca», en Solar y con el borde de la tarjeta en Solar;
  - «Has confirmado. Esperando a …»;
  - «Falta una galaxia en algún lado».
- **Las acciones:**
  - «Confirmar trato» confirma la versión que ves. Si el trato cambió entretanto, lo dice y se vuelve a leer;
  - «Cambiar»;
  - «Cancelar», en Nova, que pide confirmación.

**Cerrados:** una lista con «Hecho» (en Terminal), «Cancelado» o «Caducado», el otro jugador y las dos galaxias.

**En la colección:**
- una galaxia ofrecida lleva la insignia «En trueque»;
- no se desintegra, fusiona, mejora ni vende, y su detalle dice por qué.

## 8 sedecies. Panel de administración

`/admin`, para el equipo que entró con TOTP (GDD §16, M6a). Admins y superadmins ven todo; los moderadores, solo Moderación (§8 octodecies, desde M6c-1). Se llega con el escudo de la barra de arriba. Quien no es del equipo vuelve al inicio.

Consulta de ui-ux-pro-max: se aplicaron tres guías:
- **Tablas densas pero legibles:** 14 px y su propio desplazamiento horizontal;
- **Contraste de 4,5:1;**
- **Éxito visible tras cada cambio:** «Hecho. Queda en la auditoría».

**Estilo:**
- sobrio, con los tokens del juego;
- fondo Void y paneles Panel;
- el título en Bungee;
- sin animaciones de entrada.

**La barra lateral:**
- Jugadores y Auditoría;
- Configuración (desde M6b);
- Comunicación (desde M6d-1);
- Moderación (desde M6c-1);
- Estadísticas (desde M6d-2). Ya no queda nada en «Próximamente»;
- la sección activa, con una barra Solar a la izquierda.

**Jugadores:**
- **La búsqueda:** por nombre, IP o etiqueta de clan, con una tabla de resultados que enlaza a la ficha.
- **La ficha:**
  - el nombre y las etiquetas de estado: Activo (Terminal), Baneado (Nova), Silenciado y Fuera de la clasificación (Solar), Equipo (Hielo);
  - las monedas en Solar;
  - la fila de acciones;
  - las pestañas Resumen, Galaxias, Movimientos, Tiradas, Partidas, Comercio, Chat y Sesiones e IPs. Cada historial es una tabla con sus páginas.
- **Cada acción abre un diálogo** con sus campos y siempre un motivo:
  - las que no se deshacen solas (quitar moneda, retirar una galaxia, experiencia, nombre, código de recuperación y baneo) piden además tu contraseña, y su botón «Aplicar» pasa a Nova;
  - el código de recuperación se enseña una sola vez, grande en Solar, con «Copiar».

**Auditoría:**
- filtros por quién, qué, objetivo y fechas;
- una tabla en la que cada cambio se despliega con su antes y su después;
- «Exportar CSV» con los mismos filtros.

## 8 septendecies. Configuración viva

`/admin/configuracion` y `/admin/configuracion/<clave>`, dentro del panel (GDD §16.3 y §16.6, M6b). Nada se publica sin motivo y sin tu contraseña, y cada versión queda en la auditoría.

Consulta de ui-ux-pro-max: se aplicaron tres guías:
- **El estado de un interruptor se dice en palabras** («Encendido», «Apagado»), no solo con el color;
- **Validación en vivo junto al campo:** el editor se marca en rojo y sus problemas salen al lado, cada uno con su ruta;
- **El botón dice lo que hace:** «Apagar Mercado», «Encender Chat», «Publicar».

**Interruptores:**
- uno por parte del juego: Registro, Mantenimiento, Gachapón, Incursiones, Mercado, Trueque y Chat;
- cada uno es un interruptor de 52 × 30 px: Terminal cuando está encendido y gris cuando no, con la bola desplazada;
- su estado va escrito debajo del nombre, en Terminal o en gris;
- pulsarlo abre un diálogo con el motivo y la contraseña; no cambia nada hasta confirmar.

**Claves:** cada clave con su versión («Valores por defecto» si nunca se publicó) y quién la cambió por última vez y cuándo; el nombre lleva a su editor.

**El editor de una clave:**
- a la izquierda, el borrador en JSON, en monoespaciada de 13,5 px. Lo que no se ponga se queda como está publicado;
- a la derecha, en un panel:
  - si el borrador está mal, «Problemas», con la ruta en una etiqueta Nova;
  - si está bien, «Qué cambia», con una línea Solar por valor: «maxLength pasa de 280 a 300»;
- debajo, el motivo, la contraseña y «Publicar» en Nova, que solo se activa si hay cambios válidos;
- con menos de 1100 px de ancho, el panel baja debajo del editor.

**El historial:** de la versión más nueva a la más vieja, con quién, cuándo y su nota. «Cargar la versión N en el editor» la carga para publicarla como una versión nueva.

**El simulador del gachapón:**
- solo en la clave `gacha`;
- tira el borrador en el navegador sin publicarlo, 1000, 10.000 o 100.000 veces, con el escáner que se elija;
- una tabla de 640 px como máximo, con la rareza en su color, lo que salió y lo que se esperaba (decimales con coma);
- debajo, cada cuántas tiradas sale una legendaria, la racha más larga sin ella y el reparto de acabados.

## 8 octodecies. Moderación

`/admin/moderacion`, dentro del panel (GDD §16.1 y §16.4, M6c-1). Es lo único que ve un moderador: el escudo le lleva aquí, su barra lateral solo tiene Moderación y cualquier otra sección le devuelve aquí. En la barra de arriba, su etiqueta dice «Moderador».

Consulta de ui-ux-pro-max: se aplicaron cuatro guías:
- **El estado no se dice solo con color:** un mensaje oculto se atenúa y lleva una barra Nova a la izquierda, pero sobre todo dice «Oculto por denuncias» u «Oculto por <nombre>»;
- **Lo que se actualiza solo se puede parar:** el chat en vivo dice «Se actualiza cada 5 segundos», con un punto Terminal que late, y «Pausar» lo detiene («En pausa»);
- **Cada acción se confirma y se ve hecha:** cada una abre un diálogo con motivo y termina con «Hecho. Queda en la auditoría»;
- **Un vacío orienta:** «No hay denuncias pendientes. Las nuevas aparecen aquí», «Nadie está silenciado ahora».

**Apartados:** una fila de pastillas bajo el título, con nombre de navegación «Apartados de moderación»: Denuncias, Chat en vivo, Silencios y, solo para admins, Clanes, Comercio y Alertas (§8 novodecies). La activa, en Panel 2 con su labio, como las pestañas de la ficha.

**Un mensaje** es una tarjeta Panel de 920 px como mucho:
- arriba, el autor en negrita, el canal en una etiqueta Hielo y la hora en gris;
- el texto tal cual se escribió, a 15 px, saltos de línea incluidos;
- sus etiquetas: oculto (Nova) y cuántas denuncias tiene (Solar);
- sus botones, que dicen lo que hacen: «Ocultar» (Nova) o «Restaurar», y «Silenciar a <nombre>».

**Denuncias:** arriba, cuántos mensajes esperan revisión; lo denunciado más recientemente va primero (una denuncia nueva lo sube) y la cola va de 50 en 50 con «Anterior» y «Siguiente». Cada tarjeta suma un recuadro con «N denuncias sin revisar» en Solar y lo que escribieron. Sus botones se nombran según el estado del mensaje: «Ocultar» y «Dejar visible» si está a la vista, «Dejar oculto» y «Restaurar» si las denuncias ya lo ocultaron.

**Chat en vivo:** una barra con el selector de canal (Comunidad y los clanes con mensajes en los últimos 30 días, como «[GX] Galácticos»), el estado en vivo, «Pausar» y, para admins, el enlace «Filtro de palabras» a la clave `chat`. Debajo, lo más nuevo primero y «Ver anteriores».

**Silencios:** «Silenciar una cuenta» (cuenta, duración de 10 minutos a 30 días y motivo) y la tabla de los que siguen en curso, cada uno con «Levantar».

**Clanes:**
- la búsqueda por etiqueta o nombre (sin texto, los más nuevos) en una tabla que lleva a cada clan;
- la página de un clan: «[GX] Galácticos» en Bungee, abierto o cerrado, su descripción y «Renombrar», «Borrar la descripción» y «Disolver» (Nova, con contraseña);
- la tabla de miembros con su rango y «Hacer líder» y «Expulsar» en cada fila.

## 8 novodecies. Comercio y alertas

Dos apartados más de Moderación, solo para admins (GDD §16.4, M6c-2): `/admin/moderacion/comercio` y `/admin/moderacion/alertas`.

Consulta de ui-ux-pro-max: se aplicaron tres guías:
- **Las tablas anchas se desplazan solas**, sin romper la página;
- **Los filtros viven en la dirección** (`tipo`, `cuenta`, `estado`, `pagina`), así que «atrás» los conserva y una alerta puede enlazar a Comercio ya filtrado;
- **Un botón apagado dice por qué:** «Revertir» se apaga cuando alguna galaxia no puede volver, y el diálogo lo explica en palabras.

Las acciones en bloque sobre alertas quedan fuera, porque en la beta habrá pocas.

**Comercio:**
- arriba, dos pastillas para elegir Anuncios o Trueques (la elegida, con borde Solar), el campo Cuenta y el selector Estado;
- **la tabla de anuncios:** fecha, galaxia (en el color de su rareza), quién vende, quién compra, precio, estado (con «Revertido» en Solar si lo está) y acciones;
- **la de trueques:** fecha, quién propone y qué da, quién recibe la propuesta y qué da, estado y acciones;
- **las acciones dicen lo que hacen:**
  - «Retirar» un anuncio activo;
  - «Anular» un trueque abierto («Cancelar» ya es cerrar el diálogo);
  - «Revertir» (Nova) una venta o un trueque cerrado.

**El diálogo de revertir:**
- un recuadro «Qué pasa con cada galaxia» con una línea por galaxia:
  - en Terminal, «Nebulosa Vega vuelve de nova a vega»;
  - si no puede, el porqué: «nova la pasó a orion el 8 nov», «se fusionó en …», «ya no existe»;
- si alguna no puede, «No se puede revertir. Corrígelo a mano desde la ficha de cada jugador» en Nova, y el botón apagado;
- debajo, el motivo y la contraseña;
- en una venta, una nota recuerda que el comprador recupera el precio y el vendedor devuelve lo cobrado hasta donde le lleguen las monedas.

**Alertas:**
- Pendientes o Revisadas, con dos pastillas;
- **la tabla:** fecha, tipo (IP compartida o Desequilibrado), las dos cuentas, el detalle en palabras (la IP, el precio frente al mínimo o la diferencia de rarezas), «Ver en Comercio» y «Marcar revisada». Las revisadas dicen quién y por qué.

## 8 vicies. Buzón y avisos

El buzón de la barra de arriba, los avisos de la pantalla de título y `/admin/comunicacion` (GDD §4 y §16.5, M6d-1).

Consulta de ui-ux-pro-max: se aplicaron tres guías:
- **Un contador se dice en una sola etiqueta:** el botón se llama «Buzón, 2 sin leer», y la insignia es solo visual, sin una región en vivo que compita;
- **Cada acción se ve hecha:** «Recoger» pasa a «Recogido» con su marca Terminal, y el monedero de arriba suma al momento;
- **Un aviso se puede cerrar,** con su propio botón «Cerrar aviso».

**El botón del buzón:**
- el icono de carta;
- con mensajes sin leer, una insignia Solar de 22 px en su esquina con el número (9+ desde 10).

**El buzón** es un diálogo de 880 px como mucho:
- **a la izquierda, la lista:** cada mensaje con su título, su fecha y, en palabras, «Nuevo» (Solar, con una barra Solar a su izquierda) y «Con regalo» (Terminal);
- **a la derecha, la carta abierta:** el título en Bungee, la fecha y cuándo caduca, y el texto tal cual se escribió;
- **un regalo es un recuadro con un brillo Solar:**
  - el paquete pintado en Aseprite: 32×32 a ×3, una caja Hielo con cinta y lazo Solar, un destello que baja por la cinta y una chispa que parpadea; quieto con movimiento reducido;
  - lo que da, en pastillas con el icono y el color de cada moneda (monedas en Solar, polvo en Hielo, señales en Nova);
  - «Recoger»;
  - una vez recogido, el paquete se apaga y dice «Recogido»;
- vacío: «Tu buzón está vacío. Aquí llegan las noticias y los regalos del equipo»;
- con menos de 760 px de ancho, la carta baja bajo la lista.

**Los avisos de la pantalla de título:** sobre el logo, una línea cada uno, como el aviso de mantenimiento:
- los importantes en Solar con el icono de alerta;
- los informativos en Hielo con un cometa;
- cada uno con su botón de cerrar.

**Comunicación (panel):**
- **«Enviar un mensaje»:** título, mensaje, Para (todas, una lista de cuentas, o por nivel y fecha de alta), «Llega a N cuentas» en Hielo, los regalos en su recuadro, la caducidad y el motivo;
  - con regalo, la contraseña y el botón en Nova;
  - el botón dice a cuántas cuentas envía: «Enviar a 2 cuentas»;
- **la tabla de enviados:** para quién, regalos, llega a, leído, recogido, estado y «Retirar»;
- **«Publicar un aviso»:** texto, tono, empieza y termina;
- **la tabla de avisos:** «En curso» (Terminal), «Programado» (Hielo) o «Terminado», y «Terminar».

## 8 unvicies. Estadísticas

`/admin/estadisticas`, solo para admins (GDD §16.6, M6d-2). Lee cada 30 segundos y dice a qué hora se actualizó.

**Método:**
- se siguió la guía de visualización de datos (`dataviz`): primero la forma, luego el color y una paleta validada con su script;
- y la consulta de ui-ux-pro-max: separadores de miles y abreviaturas («1,5 M»), fechas en formato local, y el número escrito junto a cada marca, nunca solo el color.

**El periodo:** tres pastillas (Últimas 24 horas, Últimos 7 días, Últimos 30 días); la elegida, con borde Solar.

**Las cifras de arriba** son recuadros Panel:
- la etiqueta en tinta suave y el número en 30 px seminegrita;
- a veces, un detalle debajo («5 conexiones al chat», «2 alertas y 3 denuncias»).

**Partidas:**
- **las barras:**
  - una sola serie en azul `#3b86d4`, desde una base, de 24 px como mucho, con la punta redondeada 4 px y una rejilla de líneas finas;
  - cada barra se puede enfocar y se llama con su número («13 h, 5 partidas»);
  - al pasar o enfocar, un globo con el número en grande y el tramo debajo;
- debajo, cómo terminaron;
- y, para lectores de pantalla, una tabla con lo mismo.

**Monedas que entran y salen:**
- una tabla por moneda: entra (barra azul), sale (barra ámbar `#c98314`) y neto, cada barra con su número;
- debajo, su desglose por motivo en letra más pequeña;
- la leyenda junto al título.

**Rarezas reales frente a las esperadas:**
- una fila por rareza, con su rombo de color y su nombre;
- lo real en una barra azul y lo esperado en una marca vertical del color de la tinta;
- los dos porcentajes, escritos;
- sin tiradas, lo esperado sigue a la vista y la fila lo dice.

**Mercado y trueques:** recuadros pequeños.

**«Exportar CSV»** a la derecha de cada título.

**La paleta:** azul y ámbar pasan las seis comprobaciones del validador sobre el Panel `#181a3d`, también con daltonismo. El verde y el rojo del juego fallaban la separación con deuteranopía y se descartaron.

## 8 duovicies. Partidas y reproductor

**La lista** (`/admin/partidas`): la tabla del panel con fecha, jugador, sector, sonda, final, duración, capa, bajas y si está marcada. Una fila sospechosa lleva un tinte Nova muy suave y la etiqueta «Sospechosa» en píldora. Filtros arriba (jugador exacto y «Solo sospechosas», con `aria-pressed`), guardados en la URL. «Ver» lleva a la repetición.

**El reproductor** (`/admin/partidas/:id`):
- **cabecera:** título con el jugador, los datos en píldoras (sector, sonda, final, duración, marca) y, a la derecha, «Marcar como sospechosa» (botón Nova, el peligroso) o «Quitar la marca»;
- **escenario:** la arena de la partida en un marco 16:9 con bordes redondeados y labio, el HUD de la partida encima (sin su botón de pausa) y la barra del jefe. «Fin de la repetición» y «Avanzando» aparecen en una píldora abajo, en el centro;
- **transporte**, debajo, en un panel con labio:
  - «Reproducir» y «Pausar», con ancho fijo para que no salte;
  - velocidades 1x, 2x, 4x y 8x, con `aria-pressed` y nombre completo para el lector;
  - la línea de tiempo, un `range` con la parte jugada en Solar, el pulgar Solar con labio y el foco hielo, y `aria-valuetext` («0:12 de 0:20»);
  - «Al principio» y «Al final»;
- **teclado:** espacio reproduce o pausa y las flechas mueven 5 s; la línea de tiempo conserva sus propias flechas cuando tiene el foco;
- **nunca empieza solo** (pauta de no reproducir automáticamente) y no suena.

**Al lado** (debajo por debajo de 1560 px, en dos columnas):
- **Comprobación:** «Comprobar» repite la partida aparte hasta su último tick, con el progreso escrito. El veredicto va en Terminal con su icono si coincide y en rosa `#ff8fa3` (7,7:1 sobre el Panel) si no. Debajo, la tabla dato, guardado, repetición y resultado, con la huella en dos grupos de 8 en monoespaciada y las filas distintas en rosa;
- **Datos de la partida:** lista de definiciones (empezó, duración, semilla, versión de la simulación y del contenido, reliquias, marcas con su nombre) y el enlace a la ficha del jugador.

**Sin entradas:** una partida sin terminar, o terminada sin entradas guardadas, dice por qué no se reproduce, en lugar del escenario.

## 8 tervicies. Pestaña Progreso

La pestaña «Progreso» de la ficha del jugador, la segunda tras «Resumen». Son tablas del panel con un título cada una:
- **Suerte del gachapón:** una fila por grupo.
- **Sondas:** cada sonda con su nivel «n de máx», su arma inicial y su estado en píldora:
  - «Desbloqueada», en Terminal;
  - «Desbloqueada por un admin», en Terminal;
  - «Bloqueada», en Solar.
- **Máquinas de la estación**, con la **Temporada** debajo, en la columna izquierda.
- **Laboratorio**, en la columna derecha.

Las dos columnas pasan a una sola cuando no caben (mínimo 380 px cada una).

**Cada fila tiene su cambio:**
- un botón «Cambiar», que el lector de pantalla oye con su nombre completo («Cambiar el nivel de Refinería»);
- en las sondas, además, «Desbloquear» o «Bloquear». «Bloquear» va en Nova, porque quita.

**El diálogo** es el `ActionDialog` de siempre:
- los campos llegan con el valor de ahora ya puesto;
- la ayuda dice el rango;
- la contraseña aparece en cuanto el valor baja: un nivel menor, puntos en negativo o bloquear una sonda.

**Los encabezados de fila** son `th scope="row"` sin el fondo de los de columna, y las celdas van centradas en vertical con sus botones.

## 8 quatervicies. Multiplicadores y simulador de economía

**Multiplicadores en marcha:** una píldora por multiplicador, con el icono de su moneda, en la pantalla de título bajo los avisos y en el hangar bajo el rendimiento diario. El texto es «Doble polvo, polvo x2 hasta el domingo 23:59». Va en Terminal suave y no sale nada si no hay ninguno.

**Simulador de la economía:** un panel bajo el editor de `runs` y `boosts`:
- arriba, sus selectores: sector, duración de cada partida y juego al día;
- «Simular» y «Parar», con el progreso escrito;
- debajo, una tabla con lo publicado, el borrador y la diferencia (con su porcentaje), por partida y al día. Es una tabla y no un gráfico porque la tarea es comparar cifras exactas.

**Inspector 3D:**
- el aviso «no puede generar la vista 3D pro» y el de la carta plana van en una nota Solar con su motivo, encima del lienzo;
- en un planetario visitado, toda la carta es el botón que la abre en 3D.

## 8 quinvicies. Misiones y logros

**`/misiones`:** pestañas Diarias, Semanales, Temporada y Logros. Cada misión es una tarjeta con labio:
- su nombre y lo que da;
- una barra de progreso Terminal con «n de m» escrito, que es un `progressbar` con nombre;
- «Recoger», que solo se activa al completarla.

Una tarjeta lista para recoger lleva un borde Solar, y una ya recogida se atenúa y dice «Recogida».

**Logros:** la píldora del rango (Bronce, Plata, Oro), la descripción y lo que dan en Terminal. Encima, «Tu título y tu marco» con dos selectores entre lo ganado.

**Barra de arriba:** un trofeo con el número de recompensas por recoger, como el del buzón.

**Perfil:** el título en Solar bajo el nombre, y el marco como un anillo alrededor del avatar (bronce, plata, oro, nebulosa o abismo; por ahora con CSS).

## 8 sexvicies. Catálogo ECN

**`/catalogo`**, desde la colección.
- Arriba, la barra del álbum completado y los premios de cada tramo («Al 10 %»), cada uno con «Recoger».
- Debajo, cuatro rejillas: tipos, paletas, fenómenos y acabados. Lo descubierto lleva su nombre con una marca Terminal; lo que falta es un «?» atenuado.

## 8 septvicies. Códice

**`/codice`**, desde la sala Archivo.
- A la izquierda, la lista por secciones: Crónica, Sectores, Núcleos, Bestiario y Fragmentos. Lo no descifrado sale atenuado y con candado.
- A la derecha, el registro con su texto (62 caracteres por línea como mucho). En el Bestiario, «Cómo combatirlo» va en Terminal.

## 8 octovicies. Primeros pasos y Guía

**Primeros pasos:** una tarjeta en el inicio, encima del logo.
- Cada paso lleva un compás o una marca. El siguiente va en Solar y enlaza a donde se hace; los hechos van tachados y atenuados.
- Se puede ocultar y desaparece al completarlo todo.

**`/guia`:** capítulos a la izquierda. A la derecha, el capítulo con un ejemplo animado en CSS (200 px de alto, con estrellas de fondo) y tres puntos cortos.
- Cada ejemplo enseña la idea en movimiento: enemigos que estallan en fragmentos, la carta elegida que se eleva, la baliza que se llena, la carta que gira con su brillo, las salas que se llenan, los mensajes del clan.
- Con movimiento reducido se quedan quietos.

## 8 novovicies. Temporada: ruta y tienda

**`/temporada`** es más ancha que las otras listas (hasta 1240 px), porque la ruta es una pista.
- **Arriba, dos tarjetas:**
  - la puntuación, grande, con el emblema de su tramo (o el del siguiente, atenuado), una barra Solar hasta el siguiente tramo y lo que falta para el siguiente escalón;
  - la moneda de temporada, con su esquirla violeta y un halo.
- **La ruta:** una pista horizontal que se desplaza dentro de su sección, nunca la página. Lleva botones de anterior y siguiente, sus bordes se difuminan donde queda más por ver, y abre en el siguiente escalón por recoger.
  - Cada escalón es un nodo numerado sobre una línea que se pinta Solar hasta donde llega la puntuación. Debajo van el icono de su premio en su color (monedas Solar, polvo hielo, señales Nova, esquirlas violeta, cosméticos Terminal), el premio y sus puntos.
  - El estado se lee: «Faltan N puntos», «Recoger» Solar con borde y halo si está listo, o «Recogido» Terminal, atenuado.
- **La tienda:** una fila de artículos con su icono, su premio, «n de m» comprados y el botón con el precio en esquirlas. El botón está apagado si no llega o está agotado. Al pie, el aviso de que lo que sobra pasa a polvo.

## 8 tricies. Cierre de temporada, Trofeos y salón de la fama

**Cierre:** una tarjeta en `/temporada` con un halo Solar. Lleva el emblema del tramo, «Temporada N ha terminado», el puesto y los puntos, los premios y «Recoger los premios». Si subiste al podio, lo dice y la tarjeta lleva un borde Solar.

**`/trofeos`**, desde la sala Trofeos:
- «Tus temporadas»: una fila por temporada, con un trofeo Oro, Plata o Bronce si subiste al podio, o el emblema del tramo si no.
- «Salón de la fama»: una tarjeta por temporada con su podio enlazado al perfil.

El perfil enseña el mismo historial. El marco **Corona** es un doble anillo Solar y violeta con brillo.

## 8 untricies. Eventos

**Pestaña «Evento»** en `/misiones`, solo con un evento en marcha.
- **Cabecera:** un cometa violeta, el nombre, la descripción y cuándo termina.
- **Metas:** tarjetas de misión. Las de clan llevan la etiqueta «De clan» y un filo violeta; sin clan dicen cómo sumarse.

**Inicio:** el botón de evento lleva el nombre y la descripción del evento en marcha. Sin evento queda quieto con «Ningún evento en marcha ahora».

**Anomalía de temporada:** una píldora violeta junto a los multiplicadores, con su nombre y lo que cambia.

## 8 duotricies. Corrimiento al rojo

Un panel al pie del Laboratorio, solo a partir del nivel en que se abre:
- un orbe que va del blanco al rojo, el rango y el bonus;
- los requisitos, con su marca o su candado;
- lo que da el siguiente rango;
- el botón rojo «Hacer el corrimiento».

La confirmación es un `alertdialog` que dice qué vuelve a cero y qué se queda. Con movimiento reducido, el orbe no late.

### Avatares en el podio y el perfil, y el cielo del menú

Plan «escáner pro», parte E.
- **Sin caja detrás:** `.podium-avatar` y `.profile-avatar` no tienen fondo, borde ni aro; el marco hace de borde.
- **Misma huella:** `Avatar` con `fit="outer"` toma `size` como huella exterior (96/72 en el podio, 144 en el perfil). Con marco, la imagen mide size·32/48 y el marco la rodea; sin marco, la imagen llena la huella. Así todos miden lo mismo por fuera.
- **El cielo del menú:**
  - en «Personalizar» → «Fondo» se eligen hasta 12 galaxias propias (`galaxy.backdrops`, `GET /profile/backdrop`);
  - salen barajadas en cada visita y en cada vuelta, sin repetir la misma dos veces seguidas;
  - sin elegir ninguna, salen las 6 más raras;
  - la paleta antimateria y la anomalía no se pueden elegir (se verían como una pantalla rota);
  - las que se venden o se cambian desaparecen solas.

## 8 tertricies. Ajustes

**`/ajustes`**, desde el pie del menú (rediseño del plan «escáner pro», parte A; el propietario: «un estilo y organización mucho más intuitiva»): un solo panel con una columna de pestañas con icono y, al lado, la pestaña elegida con su nombre, una línea de lo que contiene y sus filas. Cada fila dice qué es el ajuste y, debajo, qué hace; su control va a la derecha.
- **Pestañas** (`?seccion=`, que se sustituye, así «Volver» sigue llevando a donde estabas):
  - **Sonido:** Música y Efectos (deslizadores), sonidos de la interfaz y «Silenciar todo» (interruptores), la prueba de sonido y «Avisos» de la cuenta.
  - **Pantalla:** el cursor del juego, su tamaño y su color.
  - **Accesibilidad:** Movimiento (Sistema, Reducido, Completo), con lo que pide ahora el ordenador, y Visión del color con su vista previa (rarezas, jugadores, a favor y peligro, elementos con su glifo; en la pausa, sin la vista previa).
  - **Incursión:** apuntar con el ratón.
  - **Ayuda:** PERKINS, los primeros pasos y el tutorial, con su confirmación escrita.
- **La elegida:** fondo Panel 2 con labio, icono Solar y una barra Solar con brillo en el borde. Las pestañas siguen el patrón de WAI-ARIA (flechas, Inicio, Fin).
- **En la pausa:** el mismo panel, algo más apretado y sin la fila de «Avisos», cabe sin barra a 1280×720; la Ayuda espera al menú de inicio.
- **Pantallas estrechas:** las pestañas pasan arriba en fila y los controles bajan bajo su texto.

**Acabado Fisura:** estática violeta con dos vetas de cristal que cruzan la carta despacio. En el inspector, vetas que brillan donde está el puntero y destellos sueltos.

## 8 quattricies. Tienda de recursos

**`/tienda`** (GDD §11.5), según la maqueta aprobada en F0:
- **Cabecera:** «Volver», el título y el monedero con componentes (clase `shop-wallet`, adonde vuelan las fichas).
- **Arriba:** la oferta destacada, con rayos que giran, un brillo que la cruza, sus etiquetas («+X % de regalo», «Rebajado», «Primera ×2») y una cuenta atrás real hasta su fin. Al lado, el pack de bienvenida (mientras no se haya comprado) y la tarjeta del extra de primera compra.
- **Pestañas:** Monedas, Polvo, Componentes y Packs, en la dirección (`?pestana=monedas|polvo|componentes|packs`).
- **Rejilla de 3×2:** cada pack con su arte de píxel y centelleos, su nombre, lo que da, «N + M de regalo», el extra en solar, la cinta («Más popular», «Mejor valor») y el precio en el botón.
- **Arte de los packs [U, 2026-11-11]:** 22 sprites de 84×84, sobre el brillo de su recurso: a ×2 en las tarjetas, a ×3 en la oferta destacada (×2 en pantallas pequeñas) y a ×1 en el pack de bienvenida y en el resumen del pago. Siguen el nombre de cada producto:

  | Pack | Monedas | Polvo | Componentes |
  |---|---|---|---|
  | 1 | Puñado | Pizca | Caja de piezas |
  | 2 | Bolsa | Frasco | Kit |
  | 3 | Saco | Tarro | Cajón técnico |
  | 4 | Cofre | Ánfora | Palé |
  | 5 | Arca | Nebulosa embotellada | Contenedor de carga |
  | 6 | Bóveda estelar | Galaxia de polvo | Fábrica en una caja |

  - Estilo: contorno de tinta por fuera y del tono oscuro de cada material por dentro, sombreado por bandas con la luz arriba a la izquierda, brillo en el metal y el cristal, y destellos.
  - Detrás van el pack de bienvenida (una caja de regalo) y los kits: de arranque (caja de suministros), del explorador (mochila con brújula) y del comandante (cofre real con los tres recursos). Un combinado nuevo toma el kit de su tamaño.
  - Fuente: `art/shop/tienda-packs.aseprite`, un fotograma por pack. Se generan con `art/shop/gen/` (`build.py` escribe la tira `apps/web/src/shop/packs.png`; `preview.py` saca la hoja de aprobación).
- **El precio de antes** se tacha solo si lo manda el servidor (directiva Ómnibus). Lo que no se puede comprar dice por qué en su botón apagado.
- **Pie:** «IVA incluido», «Condiciones de compra» (diálogo con el vendedor y el límite) y el límite diario. Nada crece de lado.

**Diálogo de pago** (`Dialog`, 560 px):
1. Resumen con el arte, lo que da, el extra y el precio, y la casilla, desmarcada.
2. El formulario de Stripe con su tema `night` en nuestros colores: Apple Pay y Google Pay arriba, el correo para el recibo y la tarjeta. El velo no cierra el diálogo mientras se paga.
3. La espera, con una ruedecita y «Confirmando el pago con tu banco».

**Celebración:** velo, destello y chispas (`Celebration`), el cartel con lo que llegó y las fichas de cada recurso volando al monedero. Vuelan más cuanto más grande es el pack, de 4 a 18. Cada una suena con un tic que sube, y al final hay una fanfarria. El monedero sube contando. Con movimiento reducido: el cartel y un único sonido suave.

## 8 quinquatricies. Perfil: avatar, marco, título, banner y «Personalizar» (plan de noviembre C2–C4)

**Avatar**
- Pixel art de 32×32 a escala entera (×1 en listas y barra, ×2 en el perfil y en «Personalizar»).
- Un avatar animado es una tira de 4 fotogramas a 6 fps; con movimiento reducido se queda quieto.
- Sin avatar se ve «Tu firma»: la figura de 5×5 que sale del nombre.

**Marco**
- Pixel art de 48×48 con una ventana transparente de 32×32: el avatar va en (8, 8).
- Los épicos y legendarios son tiras de 6 fotogramas a 8 fps.
- Si a un marco le falta el arte, se ve un aro de su color.
- El componente es `hub/Avatar.tsx`, con `name`, `avatar`, `frame` y `size`.

**Título**
- Se escribe con el estilo del catálogo: `plain`, `shine` (un brillo que lo recorre), `aurora` (un degradado que fluye) o `flare` (un resplandor solar).
- Con movimiento reducido, sin animación.

**«Personalizar»**
- Se abre desde tu perfil. Es un diálogo con una vista previa arriba («Así te verán») y pestañas Avatar, Marco, Título y Banner.
- Cada pestaña es una rejilla de piezas con su rareza en su color de rareza.
- Lo que no tienes sale bloqueado (gris, con candado), con el texto de cómo conseguirlo y, si es de la tienda, un enlace a «Estilo».
- «Guardar» manda solo lo que cambió.

**Banner**
- Una galaxia del jugador arriba en su perfil: dibujada una vez en un canvas, difuminada y oscurecida, y fundida con la página.
- Un acabado especial la recorre (holo, prismático, braille, corrupto o fisura). Una copia más suave tiñe toda la página detrás de los paneles, que conservan su fondo para que todo se lea.
- Nunca se usa `backdrop-filter` encima de capas que se mueven.

## 9. Copy

- Tú, frases cortas, verbos claros. Botones que dicen lo que pasa («Entrar», «Crear cuenta», «Verificar código»).
- Títulos cortos y directos, **sin símbolos especiales** (·, :, —, →, //) y **sin punto final**. Los títulos importantes se le preguntan al usuario.
- Errores: qué ha pasado y qué hacer, sin disculpas ni vaguedades («Usuario o contraseña incorrectos», «Demasiados intentos. Prueba otra vez en unos minutos»).
- Cada código de error de la API tiene su texto en `apps/web/src/copy/es.ts`.

**Títulos elegidos por el usuario (2026-11-06):**

| Pantalla | Título |
|---|---|
| Entrar | Vuelve a tu estación |
| Crear cuenta | Únete al ECN |
| Verificar (TOTP de admins) | Confirma que eres tú |
| Recuperar contraseña | Recupera tu cuenta |

Referencia de las pantallas de acceso: la demo `.superpowers/brainstorm/1011-1793971787/content/acceso-v1.html`.

## 10. No

- Degradados morados por defecto, glassmorphism sin motivo, tarjetas idénticas con la misma sombra gris, Inter con azul.
- Hex sueltos en componentes; texto por debajo de 4,5:1; quitar el foco.
- Animar todo: un momento por pantalla y respuesta a acciones.
- Mayúsculas forzadas en etiquetas, etiquetas encima de cada título, flechas «→» en botones.
