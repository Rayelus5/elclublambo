# Galaxy: portada de galaxysurvivor.es, diseño

**Fecha:** 17/11/2026
**Estado:** aprobado por el propietario (maqueta B completa)
**Plan general:** `~/.claude/plans/happy-crunching-toast.md`, PR 4

## Intención

galaxysurvivor.es necesita una portada pública en su raíz con dos trabajos:

1. Presentar el juego a quien no lo conoce y llevarle a «Jugar gratis».
2. Ser lo que indexan Google, Bing, Brave y DuckDuckGo.

Hoy un buscador no ve nada del juego: todo pide sesión y ordenador. El juego sigue en `/galaxy`.

## Decisiones del propietario

**Diseño**
- **Dirección B, «Viaje de la sonda».**
  - La sonda despega de la plataforma y baja por la página dejando una estela de puntos que se ilumina a su paso.
  - Cada sección es una parada con la luz de su sector.
  - Al final atraca en la estación.
- **Estilo:** el del juego (Bungee, Fredoka, botones y paneles con labio), con textos en español y la estructura preparada para más idiomas.

**Textos**
- **H1:** «Sobrevive a la Estática».
- **`<title>`:** «Galaxy Survivor | Roguelite de hordas gratis en el navegador».

**Contenido**
- **Clips del juego en bucle, sin sonido,** en las paradas. Se cargan al llegar y antes enseñan una imagen fija.
- **Paradas,** en este orden:
  1. inicio;
  2. hangar;
  3. incursión;
  4. subir de nivel;
  5. Núcleo;
  6. extracción;
  7. estación;
  8. escáner;
  9. reliquias y colección;
  10. grupo;
  11. comunidad;
  12. historia (PERKINS);
  13. novedades;
  14. preguntas;
  15. final.

**Legal**
- **Páginas legales:** a nombre de «GALAXY SURVIVOR», con contacto@rayelus.com.

**Instalar el juego** (es del PR 3, no de esta portada)
- En Ajustes.
- Una píldora discreta en el menú.

## Objetivos

- **Rendimiento:**
  - una página rápida, casi sin JS (por debajo de 10 KB gzip el propio);
  - CLS bajo: todas las imágenes con medidas;
  - el LCP es el H1, que no espera a nada.
- **SEO completo:**
  - título, descripción y canonical;
  - OG y Twitter;
  - JSON-LD;
  - robots, sitemap y 404 real.
- **Móvil:** se ve entera.
  - «Jugar gratis» avisa de que se juega en ordenador.
  - Deja compartir o copiar el enlace.
- **Movimiento reducido:** con `prefers-reduced-motion`, nada se mueve y todo se ve.
- **CSP del servidor:** sin `style=` ni `<script>` en línea, salvo `application/ld+json`.
  - La animación usa CSSOM, que la CSP permite.

## Lo que queda fuera

- **Contenido del juego abierto sin sesión:** la guía, el códice o la clasificación públicos.
- **Más idiomas:** queda preparado, pero solo se escribe el español.
- **Cifras que el admin puede cambiar:** precios, probabilidades y número de sondas o sectores.
  - «Hasta 4» y «seis rarezas» son constantes del código.
  - «18 trillones» es combinatoria del motor.

## Enfoques considerados

1. **Páginas generadas al compilar en un paquete propio (`apps/landing`). Elegido.**
   - Plantillas TS que producen HTML a partir de un diccionario.
   - Vite procesa ese HTML: hashea imágenes, clips, fuentes, CSS y JS.
   - El servidor sirve el resultado.
   - Es lo más rápido y lo que mejor se indexa, y no toca la SPA.
2. **Una ruta más de la SPA de React.** Descartado.
   - Arrastraría los ~840 KB de JS del juego.
   - Pasaría por el aviso de escritorio.
   - No se indexaría bien.
3. **SSR en vivo en Fastify.** Descartado.
   - Coste por petición para un contenido que solo cambia al desplegar.

## Diseño técnico

### Paquete `games/galaxy/apps/landing` (`@galaxy/landing`)

**Fuentes, en `src/`**
- **`i18n/`:**
  - `types.ts`, con el `Dict`;
  - `es.ts`;
  - `legal/es.ts`;
  - `locales.ts`: `es` con prefijo vacío. Un `en` futuro iría en `/en/`.
- **`site.ts`:**
  - el origen canónico `https://galaxysurvivor.es`;
  - las rutas del juego (`/galaxy/crear-cuenta` y `/galaxy/entrar`);
  - Discord y contacto.
- **`render/`:**
  - `layout`, `home`, `legal` y `notfound`;
  - `seo` (head y JSON-LD), `escape`, `robots` y `sitemap`;
  - `site.ts` (`renderSite()` → lista de `{path, file, html}`, más robots, sitemap y `routes.json`).
- **Cliente:**
  - `client/main.ts`: la ruta y la sonda, las revelaciones, los clips, la cabecera y el aviso en móvil;
  - `styles/landing.css`.

**Recursos en `src/assets/`** (WebP y MP4 comprometidos)
- banners de comunidad;
- carátulas de los clips;
- las caras de las cinco galaxias del abanico;
- los clips.

**Recursos que se referencian desde su sitio** (Vite los hashea)
- sprites (`apps/web/src/...` y `art/probes`);
- fuentes (`apps/web/public/fonts`).

**Compilación**
1. `vite build --ssr src/render/entry.ts` → `dist-ssr`.
2. `node scripts/prerender.mjs` escribe las páginas en `gen/` (ignorado), junto con `public/robots.txt`, `sitemap.xml` y `.well-known/security.txt`.
3. `vite build` multipágina sobre `gen/*.html`, con `assetsDir: 'static'`.
4. `node scripts/finish.mjs` mueve las páginas a la raíz de `dist/` y escribe `dist/routes.json`.

**Novedades**
- Las 3 primeras de `RELEASE_NOTES` (`@galaxy/shared`), con su `summary`.
- Una nota oculta en el panel sigue en la web hasta el siguiente despliegue.
- La fecha va con `Intl` en español.

### Servidor

- **Nuevo `landing.ts`:** `registerLanding(app, LANDING_DIST)`.
  - Si falta `routes.json`, la portada no se sirve.
- **Rutas:**
  - `/`, `/aviso-legal`, `/privacidad`, `/cookies` y `/condiciones`;
  - `/robots.txt`, `/sitemap.xml` y `/favicon.ico`;
  - los iconos y `/og/og-es-v1.png`;
  - `/.well-known/security.txt`.
- **Caché:**
  - HTML con `no-cache`;
  - `/static/*` inmutable (segunda instancia de `@fastify/static` con `decorateReply: false`).
- **Redirecciones:** `/index.html` y las rutas con barra final dan un 301 a la limpia.
- **Not-found:**
  - el shell en `/galaxy/*`, como hoy;
  - JSON 404 en `/galaxy/api/*` y en lo que no sea GET o HEAD;
  - en lo demás, un 404 HTML con noindex.
- **Datos legales** desde `galaxy.env`: `GALAXY_LEGAL_HOLDER`, `GALAXY_LEGAL_NIF` y `GALAXY_LEGAL_ADDRESS`.
  - Se rellenan escapados en las líneas `data-legal-line`.
  - Si falta un dato, su línea no sale y el servidor avisa con `legal_identity_missing` una vez al arrancar.
- **Dockerfile:**
  - `COPY` del `package.json` del paquete;
  - `COPY` de `dist` a `/app/landing-dist`;
  - `ENV LANDING_DIST`.
- **e2e:** `LANDING_DIST` en `E2E_ENV`.

### SEO

- **`<title>`** de 60 caracteres o menos y **descripción** de 70 a 160.
- **Canonical absoluta,** con `hreflang` `es` y `x-default`.
- **Social:** OG y Twitter con `summary_large_image`.
- **JSON-LD** en un `@graph`:
  - `VideoGame`: gratis, de 1 a 4 jugadores, capturas, género y plataforma;
  - `WebSite`;
  - `Organization`;
  - `FAQPage`;
  - `BreadcrumbList` en las legales.
- **`robots.txt`:** `Allow: /`, `Disallow: /galaxy/api/` y la línea `Sitemap:`.
- **`sitemap.xml`:** la portada y las legales, con `lastmod` fijo.
- **El shell de `/galaxy/*`** lleva noindex (PR 2).

### Legales

Son plantillas completas y conviene que las revise un abogado.

- **Aviso legal** (LSSI art. 10):
  - titular, NIF, domicilio y contacto;
  - objeto y condiciones de uso del sitio;
  - propiedad intelectual, con las fuentes OFL;
  - responsabilidad y enlaces;
  - ley y jurisdicción.
- **Privacidad** (RGPD y LOPDGDD):
  - **qué se trata:** cuenta sin email, datos de juego, chat, reportes, IP para límites y compras (email y tarjeta solo en Stripe);
  - fines, bases y plazos;
  - encargados (Stripe y Cloudflare) y transferencias;
  - derechos y AEPD;
  - edad mínima, 14 años.
- **Cookies:** solo técnicas (`gs_sid`, almacenamiento local, Stripe y Cloudflare), así que no hace falta banner.
- **Condiciones**, con dos anclas:
  - `#uso`: cuenta, conducta, objetos virtuales sin valor, moderación y apelaciones;
  - `#compras`: IVA, entrega, desistimiento (TRLGDCU 103.m), conformidad, menores, contracargos y versión de los términos.

## Lo que decide quien construye

- **Medidas finas de la animación:** que la ruta nunca cruce el texto a 1280, 1600, 1920 ni 2560.
- **Cara de las cinco galaxias:** se generan una vez desde el motor y se guardan como WebP.
- **Píldora de Discord en el pie:** sale de `packages/shared/src/links.ts`.
