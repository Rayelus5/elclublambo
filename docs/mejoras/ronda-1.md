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
| 7 | 0 | 0 | 0 | 7 | 0 |

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
  - **Color:** el azul de la web es el token `--accent` (`#61DFFF`; sustituido por R2 (2026-10-25): Base Blue + Cerulean). Se usa la clase `text-accent`, no un
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
- **Estado:** ✅
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
  - **Animaciones.** Solo CSS: `@theme` en `globals.css` (`message-in`, `reaction-in`, `reaction-pop`, 180–220 ms,
    solo `transform` y `opacity`) y `tw-animate-css` para la pastilla. No he añadido ninguna librería. Con «reducir
    movimiento», la regla global las deja en 0,01 ms y el mensaje simplemente aparece.
  - **Solo lo nuevo se anima.** Cada fila decide si entra animada en el momento de montarse: entra si es más nueva que
    el último mensaje que había al abrir el canal. El historial, «Cargar anteriores», un salto `?m=` y los repintados
    (ediciones, reacciones) nunca se animan. Los mensajes que trae un resync tras una desconexión tampoco: el resync
    marca su mensaje más nuevo como nueva línea base. La clase se quita al terminar la animación.
  - **Al enviar (envío optimista).** El compositor del canal entrega el mensaje y se vacía al momento. La fila sale
    con «Enviando…» y el contenido atenuado, sin menú ni reacciones. Cuando el servidor confirma, el mensaje real
    ocupa la misma fila (misma clave de React), así que no hay salto ni segunda animación. Si falla, la fila lleva el
    borde rojo, un icono y «No se ha enviado. <motivo>», con «Reintentar» y «Descartar». El lector de pantalla lo
    anuncia. Sin slowmode se pueden enviar varios seguidos; con slowmode se envía de uno en uno, como antes.
  - **Reintento sin duplicados (R1-3, tras la revisión).** La primera versión reconocía el mensaje por su texto, y la
    revisión vio huecos: podía adoptar un mensaje igual escrito desde otra pestaña, o duplicar uno fuera de los 50
    últimos. Ahora la idempotencia es real y la da el servidor:
    - Migración `20261020100001_message_client_id.sql`: `messages.client_id` (uuid, opcional) con índice único
      `(author_id, client_id)` cuando no es nulo.
    - `post_message` recibe `p_client_id`. Si el autor ya tiene un mensaje con esa clave, devuelve su id antes del
      límite de frecuencia, del slowmode y de cualquier efecto (menciones, avisos, push). Los reintentos de una misma
      clave se serializan con un bloqueo, y el insert es `on conflict do nothing` como última red.
    - Queda una sola firma, con los mismos permisos. Las llamadas de 7 argumentos siguen valiendo, porque la clave
      tiene valor por defecto. `create_bounty`, las encuestas y `post_message_as` no cambian.
    - La clave es la de la fila pendiente. «Reintentar» siempre reenvía con la misma clave, sea cual sea el fallo.
    - El eco del mensaje (realtime, relectura o resync) se reconoce por `client_id`, nunca por el texto. Un mensaje
      que el servidor rechazó con un código conocido nunca se adopta.
    - pgTAP `994_message_client_id.test.sql`:
      - la misma clave dos veces da una fila, el mismo id, un aviso y un solo cargo de límite;
      - otro autor con la misma clave tiene su propio mensaje;
      - sin clave, todo funciona como antes;
      - un reintento dentro del slowmode devuelve el id en lugar de «slowmode».
  - **Avisos para lectores de pantalla.** Si el mensaje ya se adoptó, no se anuncia el fallo. Un fallo repetido se
    vuelve a leer: la región se vacía al reintentar y el texto alterna un espacio final.
  - **Revisión final de la ronda (M1–M5, M7).**
    - **Migración.** Lleva `set local lock_timeout = '5s'`: con la tabla ocupada, el push falla rápido y se reintenta,
      en vez de dejar el chat en cola tras el `alter`. Tiene además una nota de vuelta atrás.
    - **Vuelta atrás.** Basta con volver atrás la app (rollback instantáneo de Vercel): la versión anterior llama a
      `post_message` con 7 argumentos y no lee `client_id`, así que la columna y el índice pueden quedarse. Volver
      atrás la base de datos sería una migración nueva: recrear `post_message` y `_post_message_core` desde
      `20261017300002` y `20261019700101`, volver a dar los permisos y borrar el índice y la columna.
    - **pgTAP 994.** Reusar una clave en otro canal da `invalid_input`.
    - **Un envío confirmado no se queda en «Enviando…».** En cuanto el servidor devuelve el id, la fila se ve como
      enviada (sin estado ni `aria-busy`) y aún sin acciones. Si ni la relectura ni el eco traen el mensaje real, se
      vuelve a leer a los 4 s.
    - **Los mensajes fallidos sobreviven a un remontaje** (cambio de canal o `?m=`). Los envíos sin confirmar se
      guardan por canal en `sessionStorage` (`src/lib/chat/pending-store.ts`). Al volver, aparecen como fallidos con
      su texto. Los que seguían enviándose salen como «sin confirmar», y reintentar usa la misma clave, así que el
      servidor no los duplica. No vuelven si el historial ya trae su clave, y «Descartar» los olvida. Las vistas
      previas locales de las imágenes no sobreviven: esas imágenes salen como «Imagen no disponible» hasta reenviar.
    - **Sin marca de leído tras salir.** Un envío que termina con la vista ya desmontada no marca el canal como leído
      ni toca el estado; solo actualiza la copia guardada.
  - **Desplazamiento.** La lógica es pura (`decideScroll`, `countUnseen` en `src/lib/chat/scroll.ts`). Si estoy cerca
    del final (48 px), el chat sigue los mensajes nuevos, también cuando crece el último. Si estoy más arriba, no me
    mueve y aparece la pastilla «N mensajes nuevos ↓», que cuenta solo los mensajes de otros que no están borrados.
  - **Separadores de día.** Usan la zona horaria del lector (`useViewerDay` con `useSyncExternalStore`, el mismo patrón
    que `LocalClock`). El servidor no dibuja separadores, así que no hay desajuste de hidratación. Las etiquetas son
    «Hoy», «Ayer», «12 de octubre», y «12 de octubre de 2025» si el año no es el actual. Cambian a medianoche. Si
    hay un ancla `?m=`, se vuelve a centrar cuando aparecen los separadores.
  - **Agrupación.** Ya existía; ahora el grupo también se corta al cambiar de día y en «Nuevos». Un mensaje agrupado
    conserva «editado», «Mensaje eliminado» (el borrado nunca se agrupa) y el menú de moderación. Ahora también lleva
    el nombre del autor oculto a la vista, para lectores de pantalla.
  - **Reacciones.** Una reacción nueva entra escalando. Al cambiar el contador, sea mío o de otro y suba o baje, el
    emoji y el número «laten»: solo se vuelve a montar ese `span`, así que el botón y su foco se quedan. Las reacciones
    que el mensaje ya tenía no se animan. Al quitar la última reacción, el chip desaparece sin animación de salida.
  - **Resaltado de `?m=`** (notificaciones, menciones, buscador): sobre el borde de acento de siempre, ahora un velo
    de acento entra y sale con un fundido de 200 ms durante los 2 s. Funciona también en el panel del hilo.
  - **Esqueleto.** `ChatHistoryLoading` ahora dibuja la cabecera y cinco mensajes en gris, en un panel de la misma
    altura que el chat. Aparece tras 150 ms, como el loader de T-002, y con «reducir movimiento» no late. Para
    lectores de pantalla sigue siendo `role="status"` con «Cargando mensajes…».
  - **Pruebas.**
    - Unitarias (rojo → verde): `timeline.test.ts`, `pending.test.ts`, `message-list-live.test.tsx`,
      `reaction-bar.test.tsx`, `composer-optimistic.test.tsx`, `chat-view-send.test.tsx`, `client-id-hydrate.test.ts`
      y `shell/loading.test.tsx`.
    - e2e `e2e/t004-chat-live.spec.ts`, con dos navegadores en Europe/Madrid. Comprueba:
      - el historial no se anima y lo que llega sí (200 ms);
      - «Hoy» y «Ayer»;
      - la pastilla «2 mensajes nuevos» sin mover al lector;
      - el resaltado de `?m=`;
      - una respuesta perdida no duplica el mensaje;
      - un envío cortado sale en rojo y «Reintentar» lo publica una sola vez, en los dos navegadores;
      - el mismo texto enviado desde otra pestaña no se adopta: la fila fallida sigue fallida y al reintentar hay dos;
      - con reducir movimiento no hay animación;
      - a 375, 768, 1024 y 1440 px no hay scroll lateral y la pastilla mide ≥ 44 px dentro de la pantalla;
      - no hay errores de consola ni de hidratación.
    - Ha pasado 3 veces seguidas; las pruebas de ancho y de movimiento, 4 veces más tras la revisión.
    - `pnpm db:test` completo pasa (78 ficheros).
    - También pasan `f2b-chat`, `f2b-chat-view` y `f2c-notify`. En `navigation-loader.spec.ts` (solo producción),
      el cambio de canal ahora espera el esqueleto en lugar del diamante.
  - **Para revisar.**
    - El compositor del hilo y los diálogos de Alpha, bounty y encuesta siguen enviando como antes (esperan al
      servidor). Solo es optimista el compositor del canal, y no en una vista anclada `?m=`, que salta a lo más
      reciente.
    - Mientras el mensaje está pendiente, sus imágenes se ven con la vista previa local.
- **Hecho en:** 00f4ec3, 9626502, 003a7ce, e7dc390, d013344, 2b1e88e; revisión R1-3 en 80387e3, fcfdfc9, 99078d0;
  revisión final en a99c768, 51897ad, f49d12d, dc4243e

### T-007 · La barra superior se solapa con «MODO PRUEBA» cuando hay muchas secciones
- **Estado:** ✅
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
- **Notas de la IA:**
  - **Presupuesto de ancho fijo.** Las pestañas son solo las de miembro (Inicio, Tickets, Guía, DAO, Mercado,
    Invitaciones: máximo 6) más un menú **«Más»** con las del personal (Miembros, Reportes, Ajustes), que solo aparece
    si hay alguna. Así la barra no depende de cuántos permisos tenga el admin, no hay scroll horizontal y el menú es un
    patrón estándar (teclado, Escape, foco).
  - **Controles de la derecha que no se encogen** (`shrink-0`) y compactos por ancho: pestañas solo icono hasta 1280 px
    (texto desde `xl`), distintivo «PRUEBA» y buscador de icono hasta 1536 px (completos desde `2xl`), perfil y «Salir»
    solo icono bajo 1024 px (el texto queda para lectores de pantalla). El nombre completo del distintivo sigue en
    `aria-label`.
  - **Textos largos:** las pestañas sí se encogen y la etiqueta se trunca con puntos suspensivos antes de pisar nada; el
    `<nav>` recorta (`overflow-hidden`) como última red. El indicador de T-002 pasa a `top-1 right-0.5`: queda en la franja
    sobre la etiqueta y no la tapa.
  - **e2e** `e2e/topbar-overflow.spec.ts`: admin y miembro a 768/1024/1280/1440 px, con y sin etiquetas largas simuladas;
    comprueba que ninguna pestaña cruza los controles de la derecha ni el logo, que no se pisan entre sí, que ni la barra
    ni la página desbordan y que cada pestaña mide ≥ 44 px. Primero rojo (a 768 px «DAO» acababa 6 px debajo de los
    controles), luego verde.
  - Tests unitarios de `shell` y `channel-tree` actualizados: Miembros/Reportes/Ajustes ahora se buscan abriendo «Más».
  - Para revisar: el cajón móvil (< 768 px) no cambia y sigue listando todo.
- **Hecho en:** 713e0b2

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
- **Estado:** ✅
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
- **Notas de la IA:**
  - **Cómo se ha medido.**
    - **PRE** pide la firma de una cartera real, así que sin el humano solo se pudo medir sin sesión: `/` redirige a
      `/login`, con 48 peticiones, 973 KB, unos 0,5 s (3,4 s la primera vez, en frío) y 2 llamadas a Reown
      (`api.web3modal.org`). Los recorridos con sesión se midieron en local.
    - **Local:** build de producción (`next build && next start`, el mismo entorno que `E2E_PROD=1`), con la cadena y
      CoinGecko simulados del e2e, y la BD recién reiniciada con 40 mensajes en General y en Noticias. Entra el
      superadmin del e2e, a 1440×900.
    - «Antes» es `6783267` (develop + la ronda escrita), en un worktree temporal; «después» son estos commits. Cada
      recorrido se hizo 3 veces, tras una ronda de calentamiento, y la tabla da la mediana.
    - Las consultas del servidor se contaron envolviendo el `fetch` de los clientes Supabase del proxy, del render y
      de servicio. Esa instrumentación no está commiteada.
  - **Tabla.** «Tiempo» va del clic (o del `goto`) a ver el contenido: el h1 y el último mensaje en los canales, la
    tabla en Mercado. «Supabase» son las llamadas REST/RPC del navegador. «Consultas servidor» son las que hace el
    proxy más las del render y las acciones.

    | Recorrido | | Peticiones | KB | Tiempo | RSC nav / prefetch (KB) | Acciones de servidor | Supabase | Realtime join / leave | Terceros | Consultas servidor (proxy + render) |
    |---|---|---|---|---|---|---|---|---|---|---|
    | Inicio (primera carga) | antes | 79 | 1154 | 513 ms | 0 / 25 (75) | 0 | 3 | 2 / 0 | 2 | 55 + 21 |
    | | después | 73 | 1153 | 442 ms | 0 / 19 (62) | 0 | 3 | 2 / 0 | 2 | **23** + 21 |
    | Inicio → General | antes | 13 | 220 | 415 ms | 1 / 0 (7) | 1 | 7 | 3 / 1 | 1 | 5 + 16 |
    | | después | 13 | 215 | 419 ms | 1 / 0 (8) | **0** | 8 | 2 / **0** | 1 | **2** + 15 |
    | General → Noticias | antes | 9 | 12 | 425 ms | 1 / 0 (7) | 1 | 7 | 3 / 3 | 0 | 5 + 16 |
    | | después | 9 | 12 | 404 ms | 1 / 0 (8) | **0** | 8 | **1 / 1** | 0 | **2** + 15 |
    | Noticias → Mercado | antes | 12 | 191 | 441 ms | 1 / 5 (175) | 0 | 3 | 1 / 3 | 2 | 12 + 1 |
    | | después | **7** | **29** | **129 ms** | 1 / **0** (**10**) | 0 | 3 | 0 / 2 | 2 | **1** + 1 |
    | Mercado → DAO | antes | 7 | 26 | 184 ms | 1 / 2 (8) | 0 | 3 | 1 / 0 | 0 | 8 + 10 |
    | | después | 7 | 26 | 170 ms | 1 / 2 (8) | 0 | 3 | 1 / 0 | 0 | **5** + 9 |

    En la primera carga hay 6 prefetch menos (25 → 19) por T-007, no por esta tarea: Miembros, Reportes y Ajustes
    ahora están dentro del menú «Más» y no se precargan. El resto de la bajada del proxy en esa fila (39 → 23) es la
    cookie de bienvenida (arreglo 1). Los tiempos de Inicio y de los canales están dentro del ruido local; donde hay
    una mejora clara es en Mercado.
  - **Lo que dicen los datos sobre los sospechosos.**
    1. **Prefetch de la barra lateral:** sí, pero acotado. Con `partialPrefetching`, cada enlace visible cuesta una
       petición pequeña (≈3 KB, el árbol de la ruta) más una por ruta (el App Shell, compartido). No se repiten al
       volver a pintar. Lo caro estaba en el servidor: cada prefetch pasa por el proxy, que validaba la sesión, leía
       la bienvenida y, para `/c/<id>`, comprobaba el canal (55 consultas en la primera carga). Next quita las
       cabeceras del router antes de llamar al proxy, así que este no puede distinguir un prefetch de una navegación.
       Lo intenté (2e378ff) y lo revertí (deb44b4) al ver que la medición no cambiaba.
    2. **Consultas repetidas en el render:** no se confirma. Dentro de una misma petición no hay lecturas duplicadas
       (`getVisibleChannels`, `getLockState` y `getEconomyConfig` ya usan `cache()`). El segundo `current_member_id`
       de la primera carga es del `after()` de pagos, que ya tiene su límite. No he añadido `cache()` donde no aporta.
    3. **Realtime:** sí. Al cambiar de canal, el panel derecho se vuelve a montar y salía y volvía a entrar en
       `activity` y `presence` en cada cambio (3 joins y 3 leaves). Además, dos oyentes del mismo tema (la lista de
       miembros y una tarjeta de miembro abierta) se quitaban el canal el uno al otro como «zombi».
    4. **Trabajo de fondo del layout:** el latido de presencia solo se envía al cargar y cada `BEAT_MS`, y
       `after()` ya tiene su límite. Al navegar se repiten `my_unread_channels` (dos veces en un canal: al cambiar
       de ruta y después de marcar leído) y `my_unread_notification_count`. Son RPC pequeñas y mantienen frescos los
       puntos y el contador, así que se quedan. Lo que sí sobraba era la acción de servidor de «marcar leído».
    5. **Terceros:** Reown hace 2 peticiones (`config` y `project-limits`) en cada carga completa, no al navegar.
       Quitarlas pediría iniciar AppKit solo al abrir la cartera, lo que es un cambio de arquitectura del login y los
       pagos y queda fuera. DiceBear sale una vez y luego lo sirve la caché del navegador. Las imágenes de CoinGecko
       se cargan en diferido.
  - **Arreglos** (uno por commit, con TDD):
    1. **Cookie de bienvenida en el proxy** (3a5ef72). La bienvenida se marca una vez y nunca se deshace
       (`coalesce`). Así que, cuando el proxy la ve completada, guarda una cookie httpOnly `ecl_welcomed` con el id del
       usuario, y en las siguientes peticiones (también los prefetch) no vuelve a leer `members`. Si la cookie es de
       otro usuario, se ignora. Es una puerta de UX: el layout del foro vuelve a leer la fila en cada render completo.
    2. **«Marcar leído» con una RPC directa** (84e69a4). Antes era una acción de servidor que, en cada visita a un
       canal, costaba un POST a Next, con sesión, bienvenida y guarda del canal en el proxy, solo para llamar a
       `mark_channel_read`. Ahora es una RPC desde el navegador; la función está concedida a `authenticated` y toma
       al miembro de la sesión.
    3. **Un canal compartido por tema de Realtime** (c3203a4). `usePrivateTopic` reparte un único canal entre todos
       los oyentes de un tema, y lo mantiene 1,5 s tras el último. Un remontaje lo recoge sin leave ni join. Los
       eventos llegan a cada oyente por su nombre, y el aviso de resync sigue llegando a todos.
    4. **Mercado como datos planos** (e64f622). La carga RSC llevaba las 100 filas ya pintadas: clases, iconos y una
       sparkline de 168 puntos por fila (175 KB). Ahora el servidor manda un objeto pequeño por cripto
       (`MarketRowData`) con las cifras ya formateadas, así que no hay `Intl` en el cliente ni desajustes de
       hidratación. La sparkline se reduce a 48 puntos con un decimal, y el cliente dibuja solo las filas que enseña.
       «Ver más» sigue sin pedir nada. La navegación a Mercado pasa de 175 KB a 10 KB de RSC.
    5. **Prefetch de las criptos por intención** (8e86c9f). Los enlaces `/mercado/<id>` llevan `prefetch={false}`, y
       la fila los precarga una vez al pasar el puntero, al tocarla o al enfocar su enlace. Así, revelar filas ya no
       dispara un prefetch por fila.
    6. **Pruebas intermitentes** (a79579f). La causa no era la carga en sí:
       - los diálogos de pago escribían tecla a tecla un hash de 66 caracteres, lo que costaba ~1,1 s por prueba
         (cada tecla vuelve a pintar el diálogo) y pasaba de 5 s con la suite en paralelo. Ahora el hash se pega
         (0,15 s);
       - `appkit-config` cargaba `viem/chains` de cero tras `resetModules` (1,1 s). Las redes no están bajo prueba y
         ahora se simulan (18 ms). No he subido ningún timeout.
    7. **Resto de T-004** (3d1fc15): el comentario de la rama de conflicto de `_post_message_core` ahora dice que es la
       última red, que `post_message` sí notificaría sobre el id devuelto y que es inalcanzable por el bloqueo por
       clave.
  - **Frescura:** permisos, mensajes y saldos no se cachean en ningún sitio nuevo. Lo único que se recuerda es la
    bienvenida, que no se puede deshacer.
  - **Pruebas:**
    - unitarias: 2965;
    - `pnpm db:test`: 78 ficheros;
    - e2e completo con `E2E_PROD=1`: 135 pasan, 11 se saltan (solo desarrollo) y falló 1, `f3a-profiles` 4. El fallo
      era de T-007: la prueba buscaba el texto «MODO PRUEBA · Linea Sepolia», que a 1280 px ahora está oculto tras la
      etiqueta compacta. Ahora la busca por su nombre accesible (79a1094), y el fichero pasa entero (6/6).
  - **Tras la revisión** (e443405, 374b775, e7cbbf5, 24d0c91):
    - un tema de Realtime que agotó sus reintentos vuelve a unirse cuando llega un oyente, en vez de heredar el canal
      muerto;
    - se quita `needsWelcome`, que ya no se usaba;
    - `markChannelRead` valida el uuid antes de la RPC y devuelve códigos de error (`rpcErrorCode`), no el mensaje de
      la base de datos;
    - la cookie `ecl_welcomed`:
      - el proxy la borra en cuanto no hay sesión, porque es httpOnly y el cierre de sesión ocurre en el navegador;
      - es `Secure` si `NEXT_PUBLIC_SITE_URL` es https, la misma regla que HSTS, porque tras el túnel la petición
        llega por http;
      - tiene pruebas de `maxAge`, `secure`, `httpOnly` y del borrado.
  - **Puertas finales de la ronda:**
    - unitarias: 248 ficheros, 2971 pruebas;
    - typecheck y lint, limpios;
    - `pnpm db:test`: 78 ficheros, 3977 pruebas;
    - e2e completo con `E2E_PROD=1`: 138 pasan, 11 se saltan, 0 fallan;
    - e2e completo en desarrollo: 128 pasan, 15 se saltan y 1 falla, `f4e-polls` 3 (el contador «1 votante» no
      llegó en 30 s). Por ser un fichero en serie, sus 5 pruebas siguientes no se ejecutaron. El fichero completo pasa
      8/8 en desarrollo al repetirlo solo, y pasa en producción. Es intermitente bajo la compilación en caliente del
      modo desarrollo y no toca nada de esta ronda: las encuestas usan el canal del chat, no los temas compartidos.
  - **Para revisar:**
    - Cada enlace visible sigue costando en el servidor la validación de la sesión (`getUser`), y en `/c/<id>` la
      guarda del canal, porque el proxy no ve los prefetch.
    - Si un día los proyectos de Supabase firman con claves asimétricas, `getClaims()` en el proxy validaría el JWT
      sin ir al servidor de auth. Es un cambio de seguridad que conviene decidir aparte.
- **Hecho en:** 84e69a4, c3203a4, e64f622, 8e86c9f, a79579f, 3a5ef72, 3d1fc15, 79a1094 (2e378ff revertido en deb44b4)

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
| 2026-10-20 | T-007 | 713e0b2 | Barra superior sin solapes: pestañas de miembro + menú «Más» para el personal, controles compactos por ancho; e2e de geometría a 768-1440 px. |
| 2026-10-20 | T-004 | 00f4ec3…2b1e88e, 80387e3…99078d0 | Chat vivo: entrada animada solo de lo nuevo, envío optimista con reintento sin duplicados, pastilla «N mensajes nuevos», separadores de día, reacciones animadas, resaltado `?m=` con fundido y esqueleto del historial; e2e con dos navegadores. Revisión R1-3: idempotencia real con `messages.client_id` en `post_message` (migración + pgTAP), sin heurística de texto. Revisión final: `lock_timeout`, nota de vuelta atrás, fallidos guardados por canal, envío confirmado sin «Enviando…» y sin marca de leído tras salir. |
| 2026-10-20 | T-006 | 84e69a4…79a1094 | Auditoría de peticiones medida antes/después (build de producción local, 3 pasadas; PRE solo sin sesión): bienvenida recordada en cookie en el proxy (55 → 23 consultas en la primera carga, junto con T-007), «marcar leído» por RPC directa, un canal Realtime compartido por tema, Mercado como datos planos (175 → 10 KB de RSC) con prefetch por intención, causa de las pruebas intermitentes y comentario de R1-3. |
