# Galaxy: portada de galaxysurvivor.es, plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** la portada «Viaje de la sonda» y las páginas legales, servidas por el servidor del juego en la raíz de galaxysurvivor.es, con el SEO completo.

**Arquitectura:**
- Un paquete nuevo, `apps/landing`, genera el HTML al compilar:
  - plantillas TS a partir de un diccionario `es`;
  - Vite procesa ese HTML y hashea todo;
  - el resultado va a `dist/` junto con un `routes.json`.
- El servidor lo sirve con `registerLanding`.
- El juego en `/galaxy` no cambia.

**Tecnología:** TypeScript, Vite 8 (SSR para las plantillas, multipágina para el cliente), Fastify 5, `@fastify/static` 10, Vitest y Playwright. Pillow y ffmpeg, solo para preparar los recursos.

**Spec:** `docs/superpowers/specs/2026-11-17-galaxy-portada-design.md`
**Maqueta aprobada:** `.superpowers/brainstorm/1497-1794939928/content/portada-b2-completa.html` (no versionada; es la referencia visual).

## Restricciones globales

- **Copia** en `src/i18n/es.ts`:
  - títulos sin punto final y sin `· : — →`;
  - «tú»;
  - ninguna cifra que el admin pueda cambiar.
- **Textos fijos:**
  - H1: «Sobrevive a la Estática»;
  - `<title>`: «Galaxy Survivor | Roguelite de hordas gratis en el navegador».
- **CSP del servidor:** el HTML no lleva `style=` ni `on*=`, ni `<script>` salvo `application/ld+json`.
- **Movimiento:** con `prefers-reduced-motion: reduce`, nada se mueve, no se reproduce ningún clip y todo es visible.
- **Desbordes:** ninguno a 390×844, 1280×720, 1600×900, 1920×1080 ni 2560×1440. La sonda y la ruta no cruzan textos.
- **Pruebas en local:** solo unitarias y Playwright contra `vite preview`. La integración y el e2e corren en la CI.
- **Secretos:** ningún dato del titular en el repo. NIF, domicilio y nombre legal vienen de `galaxy.env`.

## Foco de la revisión

1. **El 404 HTML no se come lo que no debe:**
   - `/galaxy/lo-que-sea` sigue dando el shell;
   - `/galaxy/api/nada` sigue dando JSON 404;
   - un `POST /nada` da JSON 404.
   - Prueba: Tarea 4, `landing.test.ts`.
2. **Datos legales con caracteres especiales:** un `<`, `&` o una comilla en `GALAXY_LEGAL_ADDRESS` sale escapado. Prueba: Tarea 4, `legal-identity.test.ts`.
3. **Sin `LANDING_DIST`** (local, pruebas viejas): el servidor arranca y `/` da el JSON 404 de siempre. Prueba: Tarea 4.
4. **JS apagado o bloqueado:** todo el contenido visible y los enlaces funcionan.
   - Las revelaciones solo ocultan si el JS marcó `html.js`.
   - Prueba: Tarea 3, Playwright con `javaScriptEnabled: false`.
5. **Clips:** sin descarga antes de llegar (`preload="none"`) y en pausa al salir de pantalla. Prueba: Tarea 3, Playwright, que no pide ningún `.mp4` al cargar arriba.

---

### Tarea 1: recursos de marca y de la portada

**Archivos:**
- Crear:
  - `games/galaxy/art/brand/brand.py` (Pillow: el logo de seis puntos);
  - `games/galaxy/apps/landing/scripts/assets.py` (Pillow y ffmpeg: banners WebP, carátulas WebP y clips MP4 sin audio);
  - `games/galaxy/apps/landing/scripts/faces.mjs` (Playwright: las caras de las 5 galaxias desde el motor, en WebP 400×400).
- Salidas, comprometidas:
  - `apps/landing/src/assets/brand/`: `favicon.ico` (16, 32, 48), `icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon.png` (180) y `logo.svg`;
  - `apps/web/public/icons/`: los mismos PNG, para el PR 3;
  - `apps/landing/src/assets/`:
    - `banners/{clanes,mercado,temporada,torneo,evento}.webp` (640 de ancho);
    - `clips/{lobby,horde,boss,extract,collection,coop}.mp4` (960 de ancho, 30 fps, crf 30, faststart, sin audio);
    - `posters/*.webp`;
    - `galaxies/{rare,epic,legendary,uncommon,mythic}.webp`.

- [ ] **Paso 1:** `brand.py` dibuja los seis puntos del `favicon.svg` (fondo `#070a1c`, oro `#ffc94a`, hielo `#bfe3ff`) a 8× y reduce.
  - La versión maskable lleva fondo a sangre y el logo al 60 %.
  - Ejecutar `python games/galaxy/art/brand/brand.py` y mirar los PNG.
- [ ] **Paso 2:** `assets.py` lee:
  - los banners de `apps/web/src/news/art`;
  - el metraje de `elclublambo/games/galaxy/trailer/public/footage` (ruta por argumento, porque no está en el repo).

  Recortes de cada clip, inicio y duración en segundos:

  | Clip | Inicio | Duración |
  |---|---|---|
  | `horde` | 1 | 8 |
  | `boss` | 0 | 8 |
  | `coop` | 0 | 8 |
  | `extract` | 2 | 8 |
  | `lobby` | 0 | 7 |
  | `collection` | 0 | 6 |

- [ ] **Paso 3:** `faces.mjs` usa `renderFromSeed` (con esbuild, como la maqueta) y el mismo dibujo de puntos con brillo.
  - Semillas: rara `7xxx` (la del Rovein de la maqueta), épica (Veinthra), legendaria Draylvi (`17453394667225957625`), poco común (Osemtha) y mítica Lacor (`98765432109876`).
  - Exporta además `galaxies.json` con nombre, designación y rareza.
- [ ] **Paso 4:** commit «Galaxy: recursos de marca y de la portada».

### Tarea 2: plantillas, diccionario y SEO (`renderSite`)

**Archivos:**
- Crear `games/galaxy/apps/landing/`:
  - `package.json` (`@galaxy/landing`, dependencias `@galaxy/shared: workspace:*` y `vite`);
  - `tsconfig.json`;
  - `src/site.ts`;
  - `src/i18n/{types,es,locales}.ts` y `src/i18n/legal/es.ts`;
  - `src/render/{escape,layout,home,legal,notfound,seo,robots,sitemap,entry}.ts`.
- Modificar:
  - `games/galaxy/vitest.config.ts`: el proyecto `unit` incluye `apps/landing/test/**/*.test.ts`;
  - `games/galaxy/Dockerfile`: `COPY apps/landing/package.json apps/landing/`.
- Prueba: `apps/landing/test/render.test.ts`.

**Interfaces que produce:**
- `renderSite(opts: { assets: AssetRefs }): SiteFile[]`
  - `SiteFile = { route: string | null; file: string; kind: 'page' | 'text'; html: string; indexable: boolean }`;
  - `AssetRefs` son las rutas de origen que Vite reescribe (`../src/assets/...`).
- `LEGAL_TOKENS = ['holder', 'nif', 'address'] as const`.
  - Cada línea legal va como `<li data-legal-line="nif">…<!--legal:nif--></li>`.
- `PAGES`:
  - `/` → `index.html`;
  - `/aviso-legal` → `aviso-legal.html`;
  - `/privacidad` → `privacidad.html`;
  - `/cookies` → `cookies.html`;
  - `/condiciones` → `condiciones.html`;
  - `null` → `404.html`.

- [ ] **Paso 1: pruebas que fallan** en `render.test.ts`, que recorren cada página:
  - **Cabecera y SEO:**
    - un solo `<h1>`;
    - `<html lang="es">`;
    - `<title>` de 60 caracteres o menos;
    - `meta description` de 70 a 160;
    - canonical absoluta `https://galaxysurvivor.es…`;
    - `hreflang` `es` y `x-default`;
    - `og:title`, `og:description`, `og:image` (absoluta), `og:url` y `og:locale es_ES`;
    - `twitter:card` `summary_large_image`.
  - **HTML seguro para la CSP:**
    - cada `application/ld+json` pasa `JSON.parse` y tiene `@context` y `@type` o `@graph`;
    - ninguna coincidencia de `/\sstyle=/`, de `/\son[a-z]+=/` ni de `<script>` sin `type="module"` o `ld+json`.
  - **Imágenes:** toda `<img>` con `width`, `height` y `alt`.
  - **Enlaces:** los internos existen en `PAGES`, o empiezan por `/galaxy/` o `#`.
  - **Títulos de sección:** sin `·`, `—`, `→` ni punto final.
  - **Portada:**
    - el H1 es exactamente «Sobrevive a la Estática»;
    - el título exacto;
    - las 3 notas de `RELEASE_NOTES` con su `summary`;
    - el `@graph` tiene `VideoGame`, `WebSite`, `Organization` y `FAQPage`;
    - cada clip con `preload="none"` y `poster`.
  - **Legales:**
    - `BreadcrumbList`;
    - las tres líneas `data-legal-line`;
    - «GALAXY SURVIVOR» y «contacto@rayelus.com».
  - **404:** `<meta name="robots" content="noindex">` y no está en el sitemap.
  - **Robots y sitemap:**
    - `robots.txt` con `Disallow: /galaxy/api/` y `Sitemap: https://galaxysurvivor.es/sitemap.xml`;
    - el `sitemap.xml` válido, con exactamente las 5 URL indexables.
- [ ] **Paso 2:** `pnpm -C games/galaxy exec vitest run --project unit apps/landing/test` → FALLAN.
- [ ] **Paso 3: implementar.** Las secciones y textos salen de la maqueta B completa.
  - **Clases en lugar de `style=`:** `k-terminal`, `spr-probe-spark`, `biome` con `data-biome`.
  - **`data-*` de la ruta:** `data-anchor` y `data-dock`.
  - **Clips:** `<video muted loop playsinline preload="none" poster>` con `<source type="video/mp4">`.
  - **Aviso de móvil:** un `<dialog id="desktop-only">` con «Se juega en ordenador», «Compartir el enlace» y «Copiar el enlace».
- [ ] **Paso 4:** las pruebas PASAN, y pasan también `typecheck` y `lint`.
- [ ] **Paso 5:** commit.

### Tarea 3: cliente, estilos y compilación

**Archivos:**
- Crear en `apps/landing/`:
  - `src/client/main.ts`;
  - `src/styles/landing.css`;
  - `vite.config.ts`;
  - `scripts/prerender.mjs` y `scripts/finish.mjs`;
  - `.gitignore` (`gen/`, `dist/`, `dist-ssr/`).
- Prueba: `apps/landing/scripts/check.mjs` (Playwright contra `vite preview` de `dist`, solo en local).

**Interfaces:**
- `build` = `vite build --ssr src/render/entry.ts --outDir dist-ssr && node scripts/prerender.mjs && vite build && node scripts/finish.mjs`.
- `dist/routes.json`: `{ files: { route: string | null; file: string; type: string }[] }`.
- `dist/static/*` lleva todo lo que tiene hash.

- [ ] **Paso 1: `landing.css`**, con los tokens copiados de `apps/web/src/styles/app.css`.
  - Una prueba en `render.test.ts` compara `--void`, `--solar`, `--panel` y `--lip` con los del juego.
  - Las fuentes van con `url('../../../web/public/fonts/…')`.
  - Los sprites, por clases.
  - Las revelaciones solo se aplican bajo `html.js`.
- [ ] **Paso 2: `main.ts`.**
  - Marca `html.js`.
  - Ruta, sonda y bioma, como la maqueta. Se apagan por debajo de 900 px y con movimiento reducido.
  - IntersectionObserver para las revelaciones y los clips.
  - La cabecera opaca al bajar.
  - En móvil o con `(pointer: coarse)`, los enlaces `[data-play]` abren el `<dialog>` en lugar de navegar.
- [ ] **Paso 3: `check.mjs`.**
  - Por tamaño: desborde 0, ningún error de consola ni de CSP, el H1 visible y captura en `__shots__/`.
  - Con `reducedMotion: 'reduce'`: ningún `video` reproduciéndose.
  - Con `javaScriptEnabled: false`: los títulos de todas las secciones visibles.
  - Al cargar arriba, ninguna petición `.mp4`.
  - En móvil, el clic en «Jugar gratis» abre el diálogo.
- [ ] **Paso 4:** `pnpm -C games/galaxy/apps/landing build && node scripts/check.mjs` → todo verde. Mirar las capturas a 1280 y 1920.
- [ ] **Paso 5:** commit.

### Tarea 4: el servidor sirve la portada

**Archivos:**
- Crear `apps/server/src/landing.ts`.
- Modificar:
  - `apps/server/src/app.ts`: registro y not-found;
  - `apps/server/src/env.ts`: `LANDING_DIST` y `GALAXY_LEGAL_*` opcionales;
  - `games/galaxy/Dockerfile`;
  - `apps/web/playwright.config.ts`: `LANDING_DIST`;
  - `.github/workflows/preproduction.yml`: el humo `curl -fsS -H 'Host: galaxysurvivor.es' http://127.0.0.1:8080/ | grep -q '<h1'`;
  - `deploy/preprod/galaxy.env.example` y `games/galaxy/docs/DEPLOY_PRE.md`: las claves legales opcionales.
- Pruebas:
  - `apps/server/test/unit/legal-identity.test.ts`;
  - `apps/server/test/integration/landing.test.ts` (CI).

**Interfaces:**
- `registerLanding(app: FastifyInstance, dist: string, legal: LegalIdentity): Promise<boolean>`.
- `fillLegal(html: string, legal: LegalIdentity): string`, con `LegalIdentity = { holder?: string; nif?: string; address?: string }`.
- `sendLanding404(reply): FastifyReply`.

- [ ] **Paso 1: `legal-identity.test.ts`.**
  - Rellena y escapa `<&"'`.
  - Quita la línea entera si falta su dato.
  - No deja ningún `<!--legal:` sin tocar.
- [ ] **Paso 2: `landing.test.ts`**, con un dist temporal hecho a mano:
  - `/` da 200, HTML, `no-cache` y la CSP;
  - `/static/a-1.js` da la caché inmutable;
  - `/privacidad/` da un 301 a `/privacidad`;
  - `/nada` da 404 HTML con noindex;
  - `/galaxy/nada` da el shell 200;
  - `/galaxy/api/nada` y `POST /nada` dan JSON 404;
  - `/robots.txt` da `text/plain` y `/sitemap.xml` da XML;
  - `HEAD /` da 200;
  - sin `LANDING_DIST`, `/` da JSON 404.
- [ ] **Paso 3: implementar.**
  - La caché de las páginas se lee al arrancar.
  - Los datos legales se aplican una vez.
  - Si falta uno, el aviso `legal_identity_missing` sale una vez.
- [ ] **Paso 4:** unitarias en local; integración en la CI.
- [ ] **Paso 5:** commit.

### Tarea 5: e2e, documentación y PR

**Archivos:**
- Crear `apps/web/e2e/landing.spec.ts`:
  - `/` tiene el H1 y el título;
  - «Jugar gratis» lleva a `/galaxy/crear-cuenta`;
  - ningún error de CSP;
  - `/aviso-legal` da 200;
  - `/nada` da 404.
- Modificar:
  - `games/galaxy/AGENTS.md` y el `AGENTS.md` raíz: el mapa con `apps/landing`;
  - `games/galaxy/docs/DEPLOY_PRE.md` («Dominio propio», la portada);
  - `games/galaxy/docs/DESIGN_SYSTEM.md` (la portada).

- [ ] **Paso 1:** escribir el e2e. Corre solo en la CI.
- [ ] **Paso 2:** documentación.
- [ ] **Paso 3:** pasan typecheck, lint y las unitarias de todo el workspace.
- [ ] **Paso 4:** push y PR «Galaxy: portada y páginas legales de galaxysurvivor.es». Después, vigilar la CI y el despliegue a PRE.
