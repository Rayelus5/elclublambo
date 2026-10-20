# Mejoras y arreglos — Ronda 1

> **Para la IA que trabaje con este archivo:** esta es la lista de tareas de la ronda 1. Es la fuente de verdad de
> lo que se pide. Lee el archivo entero antes de empezar.
>
> - Trabaja en la rama `feature/mejoras-ronda-1`, o en ramas `feature/…`/`fix/…`/`chore/…` creadas desde `develop`.
>   Al terminar, haz un PR a `develop`, que despliega PRE; después el humano hace el PR de `develop` a `main`.
> - No cambies el **texto** de una tarea escrita por el humano. Solo puedes cambiar su **estado**, rellenar
>   **Notas de la IA** y **Hecho en**, y añadir tareas nuevas al final de su sección si descubres algo (márcalas con
>   `Origen: IA`).
> - Si una tarea es ambigua, no la adivines: pon el estado `❓` y escribe la pregunta en **Notas de la IA**.
> - Una tarea solo pasa a `✅` cuando está hecha, probada (tests y, si es visual, revisada a 375/768/1024/1440 px) y
>   commiteada. Apunta el commit o el PR en **Hecho en**.
> - Respeta las reglas del proyecto: TDD, ui-ux-pro-max antes de tocar interfaz, nada de «AI slop», textos en español.

## Leyenda

| Estado | Significado |
|---|---|
| `⬜` | Pendiente |
| `🔄` | En curso |
| `❓` | Bloqueada: falta una respuesta del humano (ver notas) |
| `✅` | Hecha y probada |
| `⏭️` | Descartada o pospuesta (explica por qué en notas) |

| Prioridad | Significado |
|---|---|
| **P0** | Bloquea o rompe algo; va lo primero |
| **P1** | Importante para esta ronda |
| **P2** | Mejora deseable si da tiempo |
| **P3** | Idea para más adelante |

## Resumen

<!-- La IA actualiza estos números cada vez que cambia un estado. -->

| Total | ⬜ | 🔄 | ❓ | ✅ | ⏭️ |
|---|---|---|---|---|---|
| 7 | 3 | 0 | 0 | 4 | 0 |

---

## Cómo añadir una tarea

Copia este bloque en la sección que toque, cambia el número y rellena lo que sepas. Solo son obligatorios el
**título**, el **Dónde** y el **Qué pasa / qué quiero**; el resto ayuda.

```markdown
### T-000 · Título corto de la tarea
- **Estado:** ⬜
- **Prioridad:** P1
- **Tipo:** arreglo | mejora | nueva función | diseño | texto | rendimiento
- **Dónde:** página o URL (p. ej. `/c/general`, `/dao/tesoreria`), componente, y en qué dispositivo o tamaño de pantalla
- **Qué pasa ahora:** lo que ves hoy (si es un fallo: pasos para reproducirlo)
- **Qué quiero:** cómo debería quedar o comportarse
- **Cómo sabré que está bien:** lo que comprobarás tú para darla por buena
- **Capturas / referencias:** rutas a imágenes (p. ej. `docs/mejoras/img/T-000.png`) o enlaces de ejemplo
- **Notas de la IA:** —
- **Hecho en:** —
```

---

## 1. Fallos (cosas que no funcionan)

### T-001 · El menú de móvil no hace scroll
- **Estado:** ✅
- **Prioridad:** P0
- **Tipo:** arreglo
- **Dónde:** menú lateral en móvil (< 768 px), el que se abre con el botón ☰ de la barra superior. Código:
  `src/components/shell/topbar.tsx` (el `DialogContent` que hace de cajón) y `src/components/shell/sidebar.tsx`
  (el cuerpo del menú).
- **Qué pasa ahora:** en un móvil con varios canales, el menú es más alto que la pantalla y no se puede desplazar:
  los últimos canales y el bloque «Mi perfil» quedan fuera de la pantalla, sin forma de llegar a ellos.
- **Qué quiero:** que el cajón se pueda desplazar y llegue a todo: secciones, todos los canales y «Mi perfil».
  Causa probable: el cajón mide `h-dvh` y es un grid sin `overflow`, así que el contenido sobrante se recorta en vez de
  desplazarse. Que el desplazamiento no arrastre la página de detrás y que respete las zonas seguras del móvil
  (notch, barra de gestos).
- **Cómo sabré que está bien:**
  - en un móvil real (y a 375×667 y en horizontal) puedo bajar hasta el último canal y tocar «Mi perfil»;
  - al tocar un enlace el menú se cierra;
  - la página de detrás no se mueve mientras deslizo el menú.

  Un e2e a tamaño móvil lo fija.
- **Capturas / referencias:** —
- **Notas de la IA:** Causa: el cajón era un grid `h-dvh` sin overflow y el cuerpo `h-full` con el nav de canales `flex-1 overflow-y-auto`; en pantallas bajas ese nav se encogía a casi nada y «Mi perfil» quedaba fuera. Ahora el `DialogContent` es una columna flex con `overflow-y-auto overscroll-contain` y relleno `env(safe-area-inset-*)`; el cuerpo y el nav de canales ya no tienen altura propia, así que todo el cajón se desplaza como un bloque. El scroll-lock de Radix evita que la página de detrás se mueva. El botón de cerrar (X) queda fijo: es una fila sticky de altura cero (`top-[env(safe-area-inset-top)]`) dentro del cajón, que no ocupa espacio ni se pierde al desplazar. E2E: `e2e/mobile-drawer.spec.ts` (375×667 y 667×375).
- **Hecho en:** e61d65c

## 2. Diseño e interfaz

### T-002 · Indicador de carga al cambiar de página o de canal
- **Estado:** ✅
- **Prioridad:** P1
- **Tipo:** diseño
- **Dónde:** toda la web, al navegar entre secciones del menú (Inicio, Mercado, DAO, Guía…) y entre canales
  (`/c/[id]`).
- **Qué pasa ahora:** al pulsar un enlace no pasa nada visible durante un momento hasta que aparece la página nueva;
  parece que el clic no ha funcionado.
- **Qué quiero:** feedback inmediato con el loader **Diamond** de loading-ui
  (`pnpm dlx shadcn@latest add @loading-ui/diamond`, uso `<Diamond className="size-10" />`), en el **azul de la web**.
  Decisiones a respetar:
  - **Color:** el azul de la web es el token `--accent` (`#61DFFF`). Se usa la clase `text-accent`, no un
    `text-[#…]` suelto: el sistema de diseño prohíbe hex sueltos en componentes y así el loader sigue el tema si el
    acento cambia algún día.
  - **Dónde:**
    - en el área de contenido de cada sección, con `loading.tsx` o el `Suspense` de la ruta, para que la barra lateral
      y la superior sigan visibles;
    - en el chat mientras carga el historial del canal;
    - en el enlace pulsado de la barra lateral: indicador pequeño de «cargando» (Next 16 tiene `useLinkStatus`).
  - **Sin parpadeos:** que solo aparezca si la carga tarda más de ~150 ms, sin saltos de maquetación, y respetando
    `prefers-reduced-motion` (sin animación en ese caso, solo el indicador).
- **Cómo sabré que está bien:**
  - en PRE, al cambiar de canal o de sección veo el diamante azul enseguida si tarda, y nada si es instantáneo;
  - el menú no desaparece mientras carga;
  - lectores de pantalla anuncian «Cargando…».
- **Capturas / referencias:** loader Diamond de loading-ui (registro `@loading-ui`).
- **Notas de la IA:**
  - **Componente.** Instalado con `shadcn add @loading-ui/diamond` (añade el registro a `components.json`). Está en
    `src/components/loading-ui/diamond.tsx`, tal cual viene del registro y sin dependencias nuevas.
  - **Contenido.** `PageLoader` (`src/components/shell/page-loader.tsx`) sustituye los fallbacks vacíos de las páginas
    del foro y del layout de Ajustes, y se añade `(forum)/loading.tsx`. Va dentro de `<main>`, así que la barra lateral
    y la superior no se mueven. Ocupa el mismo `min-h-64` que el hueco vacío de antes, así que no hay salto. Lleva
    `role="status"` con «Cargando…» para lectores de pantalla, y el diamante, en `text-accent`, es decorativo.
  - **Sin parpadeo.** El diamante entra con `animate-loader-in`, que es opacidad por CSS con 150 ms de retraso y no usa
    temporizadores JS. Con «reducir movimiento», la regla global quita la animación pero conserva el retraso: el
    diamante aparece quieto.
  - **Chat.** Al cambiar de canal sale «Cargando mensajes…» (`ChatHistoryLoading`), que es el único sitio que T-004
    tendrá que cambiar por el esqueleto. El historial se carga en el servidor junto con la cabecera del canal.
  - **Enlace pulsado.** `LinkPending` (`useLinkStatus`) muestra un diamante pequeño en los enlaces de secciones y de
    canales mientras la navegación no termina. Su hueco es fijo y el diamante solo se monta mientras está pendiente.
    En la barra superior va en la esquina, fuera del flujo, así que las pestañas no cambian de ancho.
  - **Pruebas.**
    - `tests/unit/shell/loading.test.tsx`.
    - `e2e/navigation-loader.spec.ts`: simula un servidor lento reteniendo las peticiones RSC. Los casos del área de
      contenido necesitan `E2E_PROD=1`, porque el fallback llega con el shell prerenderizado.
    - En el build de producción, a 375/768/1024/1440, el loader no provoca desplazamientos de maquetación.
  - **A tener en cuenta.**
    - En local cada navegación tarda más de 150 ms, así que el diamante se ve casi siempre. En PRE debería verse menos.
    - Si un build local no muestra la animación, borra `.next/cache/turbopack`: tenía en caché un CSS anterior sin la
      clase nueva.
    - He visto un fallo que no es de esta tarea y lo apunto como T-007.
- **Hecho en:** 8dfd2d7

### T-003 · Mercado: interfaz para móvil y pantallas estrechas
- **Estado:** ✅
- **Prioridad:** P1
- **Tipo:** diseño
- **Dónde:** `/mercado` (lista) y `/mercado/[id]` (detalle de una cripto), a 320, 375, 414 y 768 px.
- **Qué pasa ahora:** en móvil la tabla se queda apretada y es poco cómoda de leer y de tocar.
- **Qué quiero:** (decisión del humano: **filas compactas**, no tarjetas)
  - **Lista en móvil:** filas compactas tipo app de exchange: logo, nombre y símbolo, precio y cambio 24 h (con su
    signo y color, más icono o texto, no solo color). Toda la fila es tocable (≥ 44 px) y lleva al detalle. Las
    columnas extra (7 d, capitalización, volumen, sparkline) aparecen solo cuando cabe, como ya hace la tabla por
    ancho de contenedor.
  - **Detalle en móvil:** la gráfica a todo el ancho, el selector de rango cómodo con el dedo y los datos clave en
    tarjetas legibles.
  - **Desplazamiento:** nunca scroll horizontal de la página.
- **Cómo sabré que está bien:** en mi móvil la lista se lee de un vistazo, toco una cripto y veo su detalle cómodo; a
  320 px no hay nada cortado ni scroll lateral.
- **Capturas / referencias:** —
- **Notas de la IA:**
  - **Filas compactas.** Cuando el panel de la tabla mide menos de 26rem (móvil, y también a 1024 px, donde la barra
    lateral y el raíl estrechan `<main>`), cada fila muestra el logo, el nombre con el puesto y el símbolo debajo, y el
    precio con el cambio 24 h debajo (flecha y signo, no solo color; los lectores oyen «Cambio 24 h: …»). Desde 26rem
    vuelven las columnas # y 24 h. Es un nivel más de la regla F4b-R4 (columnas por ancho del contenedor); los demás
    niveles no cambian.
  - **Fila tocable.** El enlace real sigue en la celda del nombre y es la única parada de tabulación (teclado y lector
    de pantalla); la fila no se convierte en enlace, porque un `<a>` no puede envolver un `<tr>` y un `role=link` en el
    `<tr>` rompe la semántica de la tabla. Para que toda la fila se pueda tocar, un componente cliente pequeño
    (`market-row.tsx`) escucha el clic en la fila y navega con `router.push`, salvo si el clic cae en el enlace u otro
    control, lleva Ctrl/Cmd/Mayús/Alt o botón central, o termina una selección de texto (copiar un precio). Cursor de
    mano, la fila se ilumina al pasar y al pulsar, y con el foco de teclado en el enlace la fila entera lleva un
    contorno (`outline`, que se ve también en modo de alto contraste). Filas de ≥ 56 px.
    - Primero lo hice con un `::after` estirado sobre la fila; la revisión vio que, en un navegador que no trate el
      `<tr>` como bloque contenedor, ese velo cubriría todo el panel (incluido «Ver más»), así que lo quité.
  - **Detalle.** El selector de rango es un control segmentado a todo el ancho en móvil (4 botones iguales de ≥ 44 px)
    y compacto desde `sm`. Los datos clave son tarjetas: 2 por fila en móvil, 3 y 4 según el ancho del panel; la web
    ocupa la fila entera en móvil. La variación 24 h de las tarjetas ahora lleva flecha. La gráfica ya ocupaba todo el
    ancho del contenido; no la saco al borde de la pantalla para no depender del margen del layout.
  - **Revisado** con capturas a 320, 375, 414, 768, 1024 y 1440 px (lista y detalle). El e2e
    (`e2e/f4b-market.spec.ts`, prueba 5) comprueba la lista a 320, 375, 414, 768, 1024, 1280 y 1440 px sin scroll
    lateral y con filas ≥ 44 px, que tocar el precio abre la cripto, y en el detalle a 320/375 px: sin scroll lateral,
    rangos en una fila de ≥ 44 px y tarjetas de dos en dos. Pasa en desarrollo y con `E2E_PROD=1`.
  - El título accesible de la tabla ya no dice «100» (al principio se ven 10): es «Criptos con mayor
    capitalización», y el número lo da el contador.
- **Hecho en:** 2769c21, revisión en e5b08d7

### T-004 · Chat: animaciones y sensación de «vivo»
- **Estado:** ⬜
- **Prioridad:** P1
- **Tipo:** diseño
- **Dónde:** los canales de texto (`/c/[id]`), componentes de `src/components/chat/`.
- **Qué pasa ahora:** los mensajes aparecen de golpe, tanto al enviar como al recibir; el chat se siente estático.
- **Qué quiero:**
  - **Al enviar:** el mensaje aparece al instante con una entrada suave (≈150–250 ms, desliza y aparece) y un estado
    «enviando» discreto hasta que el servidor lo confirma. Si falla, se marca en rojo con opción de reintentar.
  - **Al llegar mensajes de otros:** entrada suave solo para los **nuevos**, nunca para el historial al abrir el
    canal (todo eso animado marea).
  - **Desplazamiento:**
    - si estoy abajo del todo, el chat baja solo al llegar un mensaje;
    - si estoy leyendo más arriba, no me mueve y aparece una pastilla «N mensajes nuevos ↓» que me lleva abajo.
  - Todo respeta `prefers-reduced-motion`.
  - Animaciones con CSS (ya está `tw-animate-css`) y sin añadir librerías pesadas, salvo que la IA justifique lo
    contrario.
- **Cómo sabré que está bien:** con dos navegadores, envío y recibo mensajes y se ve fluido, sin saltos ni scroll
  inesperado; con «reducir movimiento» activado en el sistema no hay animaciones.
- **Capturas / referencias:** —
- **Notas de la IA:** el humano eligió (2026-10-20) que entren **los cinco** extras de la propuesta:
  1. Separadores de día («Hoy», «Ayer», «12 de octubre»).
  2. Agrupar mensajes seguidos del mismo autor (sin repetir avatar y nombre en cada uno).
  3. Esqueleto de carga del historial (líneas grises) en lugar de pantalla vacía.
  4. Animación sutil al añadir o quitar una reacción.
  5. Resaltado breve del mensaje al que lleva una notificación o una mención.
- **Hecho en:** —

### T-007 · La barra superior se solapa con «MODO PRUEBA» cuando hay muchas secciones
- **Estado:** ⬜
- **Prioridad:** P2
- **Tipo:** arreglo
- **Origen:** IA
- **Dónde:** barra superior de escritorio (`src/components/shell/sidebar.tsx`, `DesktopBar`), de 768 a 1440 px, con un
  admin que ve las 9 secciones.
- **Qué pasa ahora:** el `<nav>` es `min-w-0` y su lista no se recorta ni pasa a otra línea. Las pestañas siguen por
  debajo del distintivo «MODO PRUEBA · Linea Sepolia» y del buscador, y se pisan (visto en las capturas de T-002).
- **Qué quiero:** que las pestañas nunca queden debajo de los controles de la derecha. Por ejemplo, un menú «Más» para
  lo que no cabe, o el distintivo compacto en anchos medios.
- **Cómo sabré que está bien:** como admin, a 768, 1024 y 1440 px no hay nada solapado.
- **Capturas / referencias:** —
- **Notas de la IA:** —
- **Hecho en:** —

## 3. Funcionalidad nueva o cambios de comportamiento

### T-005 · Mercado: mostrar las criptos de 10 en 10 con «Ver más»
- **Estado:** ✅
- **Prioridad:** P1
- **Tipo:** mejora
- **Dónde:** `/mercado`.
- **Qué pasa ahora:** se muestran las 100 criptos de golpe: una lista larguísima, sobre todo en móvil.
- **Qué quiero:**
  - **Vista inicial:** las 10 primeras por capitalización, con el texto «Mostrando 10 de 100».
  - **«Ver más»:** un botón debajo que revela 10 más cada vez, sin recargar ni pedir datos otra vez (los 100 ya
    vienen en la misma respuesta, cacheada en el servidor).
  - **Accesibilidad:** al pulsar, el foco va a la primera fila nueva y el contador se actualiza.
  - **Final:** cuando se ven todas, el botón desaparece.
- **Cómo sabré que está bien:** entro en Mercado, veo 10; pulso «Ver más» tres veces y veo 40 con el contador
  correcto; no hay petición nueva al pulsar (pestaña Red del navegador).
- **Capturas / referencias:** —
- **Notas de la IA:** se hace junto con T-003, porque toca los mismos componentes.
  - El servidor sigue pintando las 100 filas en la misma respuesta cacheada; un componente cliente pequeño
    (`src/components/market/market-reveal.tsx`) solo decide cuántas se ven. «Ver más» suma 10, mueve el foco al enlace
    de la primera fila nueva y actualiza «Mostrando N de 100» (región `aria-live="polite"`). Con todas a la vista el
    botón desaparece; con 10 o menos no sale.
  - El e2e (prueba 1b) pulsa «Ver más» tres veces, comprueba 40 filas, el contador y el foco, y que no salga ninguna
    petición a `/mercado`, a CoinGecko ni ninguna acción de servidor.
  - **Ojo en la pestaña Red:** al revelar filas sí verás los logos nuevos (imágenes) y, en producción, quizá el prefetch
    de Next de los enlaces `/mercado/<id>` que entran en pantalla. No son recargas de la lista; si molestan, se puede
    quitar el prefetch de estas filas dentro de T-006.
  - **Peso:** el HTML trae solo las 10 primeras filas, pero la carga RSC lleva las 100 ya pintadas (con sus
    sparklines). Es lo que permite revelar sin pedir nada; si pesa, se mira en T-006.
- **Hecho en:** 2769c21, revisión en e5b08d7

## 4. Textos y contenido

<!-- Textos de la web, guía, avisos, errores -->

## 5. Rendimiento y técnica

### T-006 · Auditoría y optimización de las peticiones al navegar
- **Estado:** ⬜
- **Prioridad:** P1
- **Tipo:** rendimiento
- **Dónde:** toda la web, sobre todo al cambiar de página y de canal.
- **Qué pasa ahora:** al cambiar de página se hacen muchas peticiones y algunas parecen repetirse una y otra vez.
- **Qué quiero:** un análisis completo y luego las optimizaciones, medido **antes y después**.
  - **Medir en PRE (`pre.elclub.party`), no en local con `pnpm dev`:** el modo desarrollo multiplica peticiones a
    propósito (Strict Mode ejecuta los efectos dos veces, recarga en caliente, sin caché de prefetch), así que no es
    representativo.
  - **Tabla de medición** (número de peticiones, KB y tiempo hasta ver el contenido) para estos recorridos:
    - primera carga de Inicio;
    - Inicio → canal;
    - canal → otro canal;
    - canal → Mercado → DAO.
  - **Sospechosos a investigar** (hipótesis de la IA, a confirmar con datos):
    1. **Prefetch de Next** de todos los enlaces visibles de la barra lateral (un canal = una petición RSC), que se
       repite al volver a renderizar.
    2. **Consultas repetidas en el servidor** en cada navegación: sesión, miembro, permisos y canales leídos varias
       veces por render; deduplicar con `cache()` de React donde falte.
    3. **Suscripciones de Realtime** que se cierran y se vuelven a abrir al cambiar de página en vez de mantenerse.
    4. **Trabajo de fondo del layout:** el latido de presencia, las comprobaciones de pagos en `after()` (ya
       limitadas a una cada 30 s por miembro) y los `router.refresh()`.
    5. **Peticiones de terceros** en cada página (Reown/WalletConnect, imágenes de DiceBear sin caché).
  - **Arreglos:** los que se justifiquen con la medición, sin romper lo que tiene que ser fresco (permisos, mensajes,
    saldos).
- **Cómo sabré que está bien:**
  - la tabla de antes/después está en las notas de esta tarea, con menos peticiones y menos tiempo en los recorridos
    de arriba;
  - todo sigue funcionando (e2e en verde).
- **Capturas / referencias:** —
- **Notas de la IA:** —
- **Hecho en:** —

## 6. Otros / ideas sueltas

---

## Registro de la ronda

<!-- La IA añade una línea por sesión de trabajo: fecha, qué tareas tocó, PR. -->

| Fecha | Tareas | PR / commits | Notas |
|---|---|---|---|
| 2026-10-20 | T-001…T-006 | — | Tareas definidas a partir de lo que contó el humano; revisión del código para concretar causas. |
| 2026-10-20 | — | — | Decisiones del humano: todo en `feature/mejoras-ronda-1` con un único PR a `develop` al final; trabajo seguido; T-004 con los 5 extras; Mercado móvil en filas compactas. Orden: T-001 → T-002 → T-005+T-003 → T-004 → T-006. |
| 2026-10-20 | T-001 | ✅ | Cajón móvil con scroll propio, safe areas y overscroll contenido; e2e a 375×667 y horizontal. |
| 2026-10-20 | T-002, T-007 | 8dfd2d7 | Loader Diamond en el área de contenido, en el chat y en el enlace pulsado; e2e con servidor lento (prod). Nueva T-007 (solape en la barra superior). |
| 2026-10-20 | T-005, T-003 | 2769c21, e5b08d7 | Mercado de 10 en 10 con «Ver más» sin peticiones; filas compactas tocables en móvil; detalle con rango segmentado y datos en tarjetas. |
