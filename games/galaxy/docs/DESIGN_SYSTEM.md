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
- **`prefers-reduced-motion`:** sin desplazamientos ni rebotes; la galaxia queda fija; la entrada es instantánea; el spinner pasa a tres puntos que cambian de opacidad.

## 6. Composición y pantallas anchas

- **Mínimo** 1280×720 con puntero fino; por debajo se muestra la pantalla «Galaxy Survivor se juega en ordenador».
- **Anclajes:** la columna principal se ancla al borde izquierdo (56 px de margen) y los paneles laterales al derecho (40 px). El centro es de la escena: allí viven la estación y la galaxia.
- **Anchas (21:9, 32:9):** los paneles no se estiran; crece el cielo. A partir de 2560 px de ancho la interfaz escala con `clamp()` hasta un 125 %.
- **En la arena de combate** la zona jugable tiene un tope de 21:9 y lo que sobra es decoración (GDD §17.2).
- Texto alineado a la izquierda; números a la derecha en tablas.

## 7. Componentes

Todos los controles: área mínima 44×44, `cursor: pointer`, foco visible con anillo `--ice` de 3 px separado 3–4 px, y estado deshabilitado (opacidad 50 %, sin labio, `cursor: not-allowed`).

| Componente | Variantes | Notas |
|---|---|---|
| **Button** | `primary` (Solar, héroe), `mode` (Nova, Terminal), `event` (UV), `nav` (Sky), `pill` (oscura o Solar), `icon` (redondo oscuro 48 px) | Estados: reposo, hover, pulsado, foco, deshabilitado, cargando (spinner braille + `aria-busy`). `icon` siempre con `aria-label` |
| **Panel** | normal, cabecera de color (Solar en la temporada) | Opaco 94 %, borde blanco al 6 %, labio `--panel-lip` |
| **Field** | texto, contraseña (con mostrar/ocultar), código de 6 dígitos | Etiqueta visible encima (nunca solo placeholder); 48 px de alto; fondo `--panel-2` con sombra interior; error debajo en `--static` enlazado con `aria-describedby`; `autocomplete` correcto (`username`, `current-password`, `new-password`, `one-time-code`); se puede pegar siempre |
| **Badge** | contador (Nova), novedad (tinta Solar), en línea (punto Terminal) | Contadores con `aria-label` que diga el número |
| **Tabs** | segmentadas en píldora | `role="tablist"`, flechas del teclado |
| **Toast** | info, éxito, error | Región `aria-live="polite"`; errores críticos con `role="alert"` |
| **Error de formulario** | resumen arriba + errores en línea | Tras enviar con errores, el foco va al resumen; cada error enlaza a su campo |

| **Bloqueado** (en desarrollo) | `mini` (candado en la esquina), `tag` (candado y texto), `text` (solo texto) | Lo que llega en otro hito se ve pero no se pulsa: su color con `saturate(.6) brightness(.84)`, sin labio ni hover, `disabled` y el texto «En desarrollo» siempre presente (en `mini`, solo para lectores de pantalla y en el `title`) |
| **Barra superior** | accesos (izquierda), operador y saldo (derecha) | Escáner en píldora Solar con la insignia «Tirada gratis» cuando toca. Saldo: polvo (`--ice`), monedas (`--solar`) y señales (`--nova`), cada uno con `role="img"` y un `aria-label` que dice la frase entera («1250 monedas»). Por debajo de 1600 px los accesos bloqueados se quedan en icono |
| **Menú principal** | Jugar (héroe Solar), modos (Nova, Terminal), evento (UV), misiones (panel), seis losas y pie | Las losas llevan un icono del color de su sección y una línea debajo (dato o «En desarrollo») |
| **Carta de galaxia** | anverso, reverso; acabados Normal, Holo, Prismático, Relieve braille, Corrupto | 5:7, todo en `cqw` (igual a cualquier ancho). Marco del color de su rareza (`data-tier`) con el relieve de siempre; Épica y Legendaria brillan. Ventana cuadrada con la imagen del motor, nivel («Nv 3», «Nivel 3» para lectores) y acabado arriba; placa oscura con nombre, designación y rareza. Interactiva: se inclina hasta 11° hacia el puntero y el brillo lo sigue; con movimiento reducido no se mueve. El acabado vive entre el marco y la placa, que siempre queda limpia: Holo, bandas de arcoíris finas que se deslizan; Prismático, espectro que gira y puntos de luz; Relieve braille, el marco y la placa con puntos en relieve; Corrupto, líneas de escaneo, sangrado rojo y cian y un fallo solo mientras el puntero está encima. La imagen se carga solo cerca de la pantalla (máximo 12 peticiones al Worker) y se suelta al salir. Reverso: el braille de 48 columnas de su semilla en relieve y los nueve rasgos |
| **Inspector 3D** | WebGL2, plano | Se abre desde el detalle («Inspeccionar en 3D», Solar). three.js llega solo entonces (su propio fragmento) y al cerrar devuelve el contexto WebGL. La carta son capas en profundidad: campo de estrellas lejos, la galaxia en mezcla aditiva (las estrellas se ven a través de su negro), el marco con su ventana y la luz del acabado encima; se inclina hasta unos 19° con el puntero (5° con movimiento reducido, sin balanceo) y «Ver el reverso» la gira. Luz por acabado en un shader: brillo que sigue al puntero; Holo, bandas de arcoíris; Prismático, espectro y destellos que titilan; Relieve braille, los puntos captan la luz; Corrupto, líneas y filas que fallan. Sin WebGL2, la carta plana por las dos caras con un aviso |
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
