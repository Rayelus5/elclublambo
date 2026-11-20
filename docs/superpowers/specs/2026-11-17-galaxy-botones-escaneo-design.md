# Galaxy Survivor: botones de escaneo «Sobres»

**Fecha:** 2026-11-17. **Tamaño:** cambio pequeño.

## Por qué

El propietario quiere los botones de escanear 1, 5 y 10 grandes y llamativos, con sentido y sin información repetida, en los dos pagos: señales y monedas. Hoy cada botón dice «Escanear», cada precio repite «señales» o «monedas», y encima van las etiquetas «Con señales» y «Con monedas».

## Lo que eligió (comparado en maquetas)

Eligió la opción **B, «Sobres»**, con dos cambios suyos:
- el precio va en una **pastilla oscura y redondeada**, como en la opción A;
- los botones de **monedas** llevan la **sombra (labio) en azul oscuro**, no naranja.

## Diseño

- **Encabezado:** «Escanear» sale **una sola vez**, como título del bloque, con tus señales y monedas al lado (icono y número). Desaparecen «Con señales» y «Con monedas».
- **Cada botón:**
  - el dibujo de lo que abre: una carta, cinco en abanico o un mazo de diez;
  - el número «×1», «×5» o «×10» en la letra de título;
  - el precio en su pastilla oscura con el icono de la moneda, sin escribir su nombre.
  - Al pasar el ratón, el abanico se abre, el mazo se separa y la carta sola se ladea.
- **Colores:**
  - señales: Solar, con su labio naranja;
  - señales de evento: UV, con labio violeta;
  - monedas: azul (Panel 2 → azul profundo), con labio **azul oscuro**.
  - Un brillo pasa de vez en cuando; con movimiento reducido, nada se mueve.
- **«Mejor precio»:** la cinta Nova va solo en el tamaño que de verdad ahorra (`bestValue`).
- **Sin saldo:** si no te llega, el botón se apaga y debajo de la fila aparece «Te faltan N señales» o «Te faltan N monedas».
- **Accesibilidad:** cada botón conserva su nombre «Escanear 10, 10 señales» con `aria-label` (las pruebas y el tutorial `pull10` lo usan).
- **Corrección del propietario:** en el núcleo de la garantía, el brillo no se corta en los bordes del cuadrado. El SVG va con `overflow: visible`.

## Fuera de esto

Nada de precios, lógica ni servidor: solo cómo se ven los botones y el encabezado, en `ScannerScreen.tsx` y `app.css`.

## Para el constructor

- El dibujo de cartas en CSS puro, con las mismas formas de la maqueta (`.superpowers/brainstorm/.../botones-escaneo-v2.html`).
- Los iconos de señal y moneda salen de `Icon`, como en la cartera.
- Capturas a 1280, 1600, 1920 y 2560, sin desbordes.
