# Landing: entrada interactiva, textos directos y footer completo

Fecha: 2026-10-26 · Estado: aprobado por el dueño · Rama prevista: `feature/landing-intro` desde `develop`

## Por qué

La web pública ya funciona; ahora toca la primera impresión. Hoy la landing abre con títulos recargados («Herramientas cripto honestas, verificables y gratis.», «Construido en Base · también en Arbitrum», «Lo mejor está dentro: un foro privado por invitación») y un footer de una línea. El dueño quiere tres cosas:

1. **Textos que vayan al grano.** Títulos cortos, sin símbolos «especiales» y sin acumular adjetivos.
2. **Una entrada que llame la atención.** Antes de ver la landing, la persona pulsa el logo y la web «se abre» con una animación propia, visual y sencilla.
3. **Un footer de verdad.** Accesos directos, descripción breve, idioma y redes (X, YouTube, Discord).

Éxito: alguien que llega por primera vez desde un enlace de X o Discord pulsa por curiosidad, ve una animación que recuerda, y aterriza en una landing que se lee en segundos.

## Objetivos

- Entrada interactiva en la portada (`/` y `/en`) en la **primera visita**.
- Limpieza de títulos en **toda la web pública, ES y EN**: landing, `/herramientas`, `/start`, páginas de herramientas, títulos de pestaña y textos de las imágenes de compartir (OG).
- Footer público completo en todas las páginas que hoy usan `PublicFooter`.

## No objetivos

- No se rediseñan las secciones de la landing ni su orden; solo cambia su texto.
- No se toca el foro privado (`/foro`), salvo que comparta algún texto del diccionario.
- No se añade analítica de la entrada.

## Anti-objetivos (fallaría aunque «funcione»)

- Que alguien que vuelve tenga que pulsar otra vez, o vea un parpadeo del logo antes de la landing.
- Que Google, la vista previa de X/Discord o un lector de pantalla no vean el contenido de la landing.
- Que la entrada atasque un móvil de gama media (tirones, batería).
- Que haya texto o pistas visibles junto al logo (decisión del dueño: solo el logo y la onda).
- Títulos con «·», «:», «—», «→» o «//» visibles, o que terminen en punto (el punto de la marca «ElClub.» sí se queda).

## 1. Entrada interactiva (decidida por el dueño en maquetas)

Maqueta de referencia: `.superpowers/brainstorm/56119-1793044407/content/intro-v2.html`, variante **C · Ola de giros**, con la onda **cuadrada** de `intro-v1.html`.

Secuencia:

1. **Espera.** Pantalla oscura (`--bg`), en el centro el logo `elclub-logo-1.png` (cuadrado azul con el símbolo blanco) con esquinas de **24 px**. Detrás salen contornos azules con la forma del logo que crecen y se desvanecen, en bucle, como un sonar (tres ondas desfasadas, ~2,4 s). **Sin texto ni pistas legibles.**
2. **Pulsar.** Vale pulsar **en cualquier parte de la pantalla**, no solo en el logo.
3. **Giro.** El logo gira como una carta (~0,5 s) y muestra `elclub-logo-2.png` (fondo blanco, símbolo azul).
4. **Zoom.** La cámara entra en el símbolo azul hasta que **toda la pantalla es azul** (~0,9 s).
5. **Ola de giros.** El azul se divide en una rejilla de bloques. Una ola nace **donde se pulsó**: cada bloque gira 180° en 3D como una ficha; a mitad de giro se ve Cerulean (`#3C8AFF`) y al final desaparece, dejando ver la landing.
6. **Entrada de la landing.** El contenido del hero entra escalonado (sube y aparece).

Total orientativo: 2,5–3 s desde el clic.

Reglas:

- **Solo la primera visita.** Se recuerda en el navegador. Quien vuelve entra directo, sin parpadeo del logo.
- **Recursos.** Los dos logos van a `public/brand/` (el dueño los tiene en Descargas). Como SVG si se puede vectorizar con fidelidad; si no, PNG optimizado.

Llamadas mías (el dueño puede cambiarlas):

- **Teclado y lectores de pantalla.** La capa es un botón de pantalla completa con nombre accesible «Entrar en ElClub.» / «Enter ElClub.», que no se ve. Enter y Espacio lanzan la animación. Un enlace «Saltar» invisible que aparece solo al tabular, para no romper «sin texto».
- **Menos movimiento.** Con `prefers-reduced-motion` no hay entrada: la landing se ve directamente y la visita cuenta como hecha.
- **Contenido para buscadores.** El HTML de la landing se sirve completo debajo de la capa. Así Google, las vistas previas y los lectores lo tienen siempre. La capa no cambia metadatos ni imágenes OG.
- **Sin parpadeo para quien vuelve.** Un script en línea mínimo, antes de pintar, oculta la capa si ya hubo visita. La CSP permite `'unsafe-inline'`.
- **Scroll bloqueado** mientras la capa está visible.
- **Solo en la portada.** Enlazar directamente a `/herramientas`, `/start` o una herramienta nunca muestra la entrada.
- **Rendimiento.** Solo `transform` y `opacity`. Rejilla de unas 12 columnas en escritorio y unas 6 en móvil. Si el navegador no tiene la Web Animations API, la capa se quita sin animación.

## 2. Textos: criterio y propuesta

Criterio para todos los **títulos** (encabezados, kickers, títulos de pestaña y textos OG), ES y EN:

- Sin «·», «:», «—», «→», «//».
- Sin punto final.
- Una idea por título, sin cadenas de adjetivos.
- El texto pequeño de debajo (lead) puede llevar puntuación normal.
- Los títulos de pestaña siguen la plantilla actual de la web.
- El contenido de ejemplo de las maquetas (hilos ficticios como «Tesis: liquidez en Base…») no se toca.

### Textos aprobados (los de la portada y /start los eligió el dueño el 2026-10-26)

| Dónde | Ahora (ES) | Propuesta ES | Propuesta EN |
|---|---|---|---|
| landing.hero.kicker | Herramientas abiertas · sin custodia | En Base y Arbitrum | On Base and Arbitrum |
| landing.hero.title | Herramientas cripto honestas, verificables y gratis. | Herramientas cripto gratis y seguras | Free and safe crypto tools |
| landing.hero.lead | Empieza por los sorteos: misma probabilidad para todos y un azar público que nadie puede manipular. | Sorteos con la misma probabilidad para todos y un azar público que nadie puede manipular. | Giveaways with equal odds for everyone and public randomness nobody can rig. |
| landing.demo.title | Un sorteo que puedes comprobar | Un sorteo en la blockchain | An on-chain giveaway |
| landing.demo.lead | (sin cambios) | Así sale el ganador. Nadie, ni siquiera quien organiza, puede cambiar el resultado. | This is how the winner comes out. Nobody, not even the host, can change the result. |
| landing.networks.title | Construido en Base · también en Arbitrum | Construido en Base y Arbitrum | Built on Base and Arbitrum |
| landing.networks.lead | Premios y pagos en USDC en cualquiera de las dos redes, con comisiones de céntimos. | Premios y pagos en USDC en las dos redes, con comisiones de céntimos. | Prizes and payments in USDC on both networks, with fees of cents. |
| landing.club.title | Lo mejor está dentro: un foro privado por invitación | Un foro privado por invitación | A private, invite-only forum |
| landing.final.title | Empieza con un sorteo. | Empieza gratis | Start for free |
| landing.metaTitle | ElClub. · Herramientas cripto honestas, verificables y gratis | ElClub. · Herramientas cripto gratis y seguras | ElClub. · Free and safe crypto tools |
| landing.ogKicker | HERRAMIENTAS ABIERTAS · BASE Y ARBITRUM | EN BASE Y ARBITRUM | ON BASE AND ARBITRUM |
| landing.ogFooter | Sorteos verificables. Gratis. | Gratis y sin custodia | Free and non-custodial |
| connect.builtOn | Construido en Base · también en Arbitrum | En Base y Arbitrum | On Base and Arbitrum |
| giveaways (OG) kicker | SORTEO VERIFICABLE · BASE Y ARBITRUM | SORTEO VERIFICABLE | VERIFIABLE GIVEAWAY |
| start.metaTitle | ElClub. · El foro privado para quien se toma cripto en serio | ElClub. · Foro cripto privado para todos los niveles | ElClub. · A private crypto forum for every level |
| start.hero.kicker | Foro privado · Base y Arbitrum | Foro privado por invitación | Private, invite-only forum |
| start.hero.tagline / ogTagline | El foro privado para quien se toma cripto en serio. | Foro cripto privado para todos los niveles | A private crypto forum for every level |
| start.hero.sub | Solo con invitación. Sin ruido. Construido en Base y Arbitrum. | Solo con invitación, en Base y Arbitrum. | Invitation only, on Base and Arbitrum. |
| start.ogKicker | FORO PRIVADO · BASE Y ARBITRUM | FORO PRIVADO | PRIVATE FORUM |
| start.ogFoot | Solo con invitación. Sin ruido. | Solo con invitación | Invitation only |
| start (función) | Bounties: pide ayuda y págala | Bounties con recompensa | Paid bounties |
| start (función) | Sorteos verificables y encuestas secretas | Sorteos y votaciones secretas | Giveaways and secret polls |
| start (herramientas) | ¿Aún sin invitación? Prueba las herramientas abiertas | Prueba las herramientas abiertas | Try the open tools |
| start (cierre) | La puerta, de momento, está entornada. | Pronto podrás pedir invitación | Invitation requests coming soon |
| pay.metaTitle | ElClub Pay · Cobra y paga en USDC | ElClub Pay | ElClub Pay |
| pay.ogKicker | ELCLUB PAY · SIN CUSTODIA | SIN CUSTODIA | NON-CUSTODIAL |

El resto de títulos de las herramientas ya cumplen el criterio («Comprobador de tokens y enlaces», «Envío múltiple», «Calculadora de gas»…) y no cambian. Quien construya revisa los diccionarios completos con el criterio. Cualquier título que encuentre fuera de esta tabla lo arregla con el mismo estilo y lo lista en el PR.

## 3. Footer

Para todas las páginas con `PublicFooter`, en móvil y escritorio, con el estilo actual (bordes de 1 px, sin sombras, `fg-muted` para el texto secundario, un único relleno azul por pantalla, que en el footer no se usa).

**Columna de marca**
- Logo + «ElClub.».
- Descripción breve, propuesta de dos líneas a partir de la idea del dueño («Build in BASE & Arbitrum // Crypto Tools and Private Forum»), adaptada al criterio de textos:
  - ES: «Herramientas cripto y foro privado» / «En Base y Arbitrum»
  - EN: «Crypto tools and a private forum» / «On Base and Arbitrum»
- Iconos de redes con nombre accesible, que se abren en otra pestaña con `rel="noopener noreferrer"`:
  - X: https://x.com/elclubparty
  - YouTube: https://www.youtube.com/@ElClubParty
  - Discord: https://discord.gg/2WdKQVkq4U

**Columna Herramientas**
- Las 7 del hub: Sorteos, ElClub Pay, Comprobador, Avales, Aprobaciones, Envío múltiple, Gas.
- Una herramienta apagada desde Administración se muestra igual que en el hub: atenuada y sin enlace.

**Columna ElClub.**
- «¿Qué es ElClub.?» (`/start`).
- Foro (login del foro).
- Donar. Sigue al interruptor «Donar público».

**Idioma**
- Cambio ES/EN que lleva a la misma página en el otro idioma.

**Barra inferior**
- El aviso legal actual: «sin custodia» + «no es asesoramiento».
- «© 2026 ElClub.».

Llamadas mías: los iconos de marca de X, YouTube y Discord van como SVG en línea (Lucide no los trae). Los colores son neutros (`fg-muted`, y `fg` al pasar el ratón), nunca los colores de cada marca.

## Restricciones

- Next.js 16 de este repo (leer `node_modules/next/dist/docs/` antes de tocar APIs), `motion` 14 ya instalado, Tailwind con los tokens existentes.
- Paleta R2: Base Blue `#0000FF` como único relleno por pantalla y Cerulean `#3C8AFF` como acento.
- Durante la entrada, la capa es la pantalla y su azul es ese único relleno.
- Accesibilidad AA: foco visible, objetivos de 44 px y contraste 4,5:1 en el footer.
- TDD: tests unitarios del criterio de textos, del footer y de la lógica de primera visita, y un e2e de la entrada (pulsar → la landing visible → recargar → sin entrada).
- Nada de secretos ni cambios en `main`. Merge a `develop` solo si el dueño lo autoriza, como en Administración.

## Decisiones de construcción (llamadas mías tras la revisión)

1. **Títulos de pestaña.** No hay plantilla de título: cada página fija el suyo.
   - La portada y `/start` mantienen la marca delante, «ElClub. · …», para que la marca no desaparezca de la pestaña. Es la única excepción al criterio de símbolos y el test la permite solo como prefijo exacto «ElClub. · ».
   - Pestañas: ES «ElClub. · Herramientas cripto gratis y seguras» y «ElClub. · Foro cripto privado para todos los niveles»; EN «ElClub. · Free and safe crypto tools» y «ElClub. · A private crypto forum for every level».
   - Las demás páginas usan su título sin prefijo, como ahora.
2. **Idioma en el footer.** Se reutiliza el `switchLang` de la cabecera (`src/lib/i18n/routes.ts`), con el mismo comportamiento que ya tienen las páginas dinámicas y las de herramientas. No se crean rutas nuevas.
3. **Marca de «ya visitada».** Va en `localStorage`, una clave compartida por `/` y `/en`: entrar por una portada cuenta para la otra.
   - El script en línea solo muestra la capa si hay JS, no hay marca y no se pide menos movimiento. Sin JS no hay capa.
   - Si `localStorage` falla (modo privado bloqueado), la capa se muestra y se puede pasar, pero no se recuerda.
4. **Logos.** El controlador copia `elclub-logo-1.png` y `elclub-logo-2.png` desde Descargas a `public/brand/logo/`. Se vectorizan a SVG (son formas planas: un rectángulo redondeado y un cuadrado); si no salen fieles, se usa PNG. El redondeo de 24 px lo pone el CSS, no la imagen. La rejilla de la ola usa el azul plano, sin la imagen.
5. **Footer.**
   - «Foro» enlaza a `/foro`, que ya lleva al login si no hay sesión.
   - «Donar» con el interruptor apagado se ve atenuado y sin enlace, igual que una herramienta apagada.
   - Los nombres de las herramientas reutilizan las claves del hub (`tools.*.name`).
   - Los textos nuevos del footer van en una sección `footer` del diccionario.
6. **Test del criterio de textos.** Se aplica a una lista explícita de claves: todos los `title`, `kicker`, `metaTitle`, `ogKicker`, `ogFooter`, `ogFoot`, `ogTagline`, `tagline` y `builtOn` de las secciones públicas (`connect`, `giveaways`, `landing`, `tools`, `start`, `checker`, `pay`, `donate`, `vouches`, `approvals`, `multisend`, `gas`), en ES y EN.
   - Excluye las maquetas de ejemplo (`start.noise.thread`, `start.noise.chatter`, `start.ticker`) y los nombres de alertas del comprobador.
   - Los `lead` y `sub` no se testean.

## Lo que queda a quien construya

- La estructura de componentes, la duración exacta de cada fase y el tamaño de la rejilla según el viewport.
- Dónde se guarda la marca de «ya visitada», con la condición de que no haya parpadeo.
- Cómo vectorizar los logos.
