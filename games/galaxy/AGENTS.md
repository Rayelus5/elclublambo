# Galaxy Survivor: guía para agentes

Léela entera antes de tocar nada en `games/galaxy`. Vale para cualquier IA (Claude, Codex, Cursor, Gemini…) y para personas nuevas. Rutas relativas a `games/galaxy/` salvo que digan otra cosa.

## Qué es

Galaxy Survivor es un juego web de pixel art espacial que vive dentro de elclub.party en `/galaxy`. Se juega en ordenador, con ratón y a 1280×720 o más. Mezcla:
- **una estación espacial** que produce mientras no juegas;
- **incursiones** de tipo survivors, con sondas que disparan solas y mejoras a elegir al subir de nivel, solo o en grupo de hasta 4;
- **un escáner** (gacha) que genera galaxias únicas por semilla, con un motor de arte braille. Las galaxias se coleccionan, se fusionan y se equipan como reliquias, que dan poderes en la incursión.

Encima hay temporadas, eventos, misiones, logros, clanes, mercado, chat y amigos.

Desde el 2026-11-10 es una **beta abierta en PRE** (`pre.elclub.party/galaxy`), con jugadores reales. Producción todavía no existe para el juego (`docs/PRODUCCION.md`).

## Mapa

| Carpeta | Qué es |
|---|---|
| `packages/engine` | Port en TypeScript del generador de galaxias (Python `galaxy-nft`): RNG PCG64, rasgos (`config/traits.yaml`), dibujo braille y posproceso WebGL. `ENGINE_VERSION` congelado |
| `packages/sim` | Simulación determinista de la incursión a 60 Hz: `createSim`/`step`, contenido (`src/content`), sistemas, bot, registro de entradas y repeticiones. Sin DOM ni relojes |
| `packages/shared` | Esquemas Zod y reglas puras que comparten servidor y web: tipos de la API, **registro de configuración viva** (`src/config/registry.ts`), gacha, economía, misiones, temporada |
| `apps/server` | Fastify 5 + Kysely (Postgres de Supabase, esquema `galaxy`). Una carpeta por dominio en `src/`. Sirve la API en `/galaxy/api/*` y la web compilada. CLI en `src/cli.ts` |
| `apps/web` | React 19, React Router 7, TanStack Query, Zustand y Tailwind v4. La arena se pinta con PixiJS 8 (`src/arena`) y el inspector 3D con three.js. Textos en `src/copy/es.ts` |
| `art/` | Fuentes de Aseprite y scripts `paint-*.lua` |
| `ops/` | Configuración publicada o por publicar (`launch/`), plantillas (`plantillas/`) y el borrado de la beta (`reset-beta.sql`, que solo usa el propietario) |
| `tools/` | Goldens del motor y prueba de carga |
| `docs/` | Ver la tabla de documentos |

**Fuera de esta carpeta:**
- Migraciones SQL en `../../supabase/migrations/*_galaxy_*.sql`, que se comparten con la web de la raíz.
- CI en `../../.github/workflows/galaxy-ci.yml`.
- Despliegue de PRE en `../../.github/workflows/preproduction.yml` y `../../deploy/preprod/`.

## Comandos

pnpm viene de corepack y se usa Node 22. Desde la raíz del repo, con `-C games/galaxy`, o desde esta carpeta. Los comandos están escritos para Git Bash; en PowerShell, las variables van como `$env:VITE_ARENA_SHOTS=1;` delante, y nunca guardes JSON con `>` ni `Set-Content` (añaden BOM).

| Para | Comando |
|---|---|
| Instalar | `pnpm -C games/galaxy install --frozen-lockfile` |
| Tipos | `pnpm -C games/galaxy typecheck` |
| Lint | `pnpm -C games/galaxy lint` |
| Unit + web (seguro) | `pnpm -C games/galaxy test:unit` |
| Un archivo | `pnpm -C games/galaxy exec vitest run --project <unit\|web\|browser\|integration> <ruta>` |
| Navegador real | `pnpm -C games/galaxy exec playwright install chromium` una vez; después `--project browser` |
| Capturas para revisar | `VITE_ARENA_SHOTS=1`, `VITE_CARD_SHOTS=1`, `VITE_REVEAL_SHOTS=1`; guardan en `apps/web/test/browser/__shots__/` |
| Build | `pnpm -C games/galaxy build` |

**Proyectos de Vitest** (`vitest.config.ts`):

| Proyecto | Entorno | Escribe en la base de datos local |
|---|---|---|
| `unit` | Node | no |
| `web` | jsdom | no |
| `browser` | Chromium real con WebGL por software | no |
| `integration` | Postgres local migrado | **sí** |

**Ojo con los tests de integración:**
- La base de datos local es del propietario. Los tests de integración déjalos a CI salvo los que van en una transacción que se deshace, como `cli-config.test.ts`.
- **Nunca ejecutes `apps/server/test/integration/config.test.ts` en local**: publica configuración viva.
- Por eso nunca lances `pnpm test` ni `vitest run` sin filtro; usa `test:unit` o rutas concretas.

## Reglas que no se rompen

- **Simulación determinista.**
  - Lo que cambie cómo juega la misma semilla sube `SIM_VERSION` (`packages/sim/src/version.ts`) y regenera las partidas de referencia (`packages/sim/test/golden-runs.ts`).
  - En `packages/sim/src` está prohibido `Math.random`, `Date` y la trigonometría nativa.
- **El motor de galaxias está congelado.** Un rasgo nuevo cambia galaxias que ya tienen los jugadores: decisión del propietario.
- **El contenido son datos.** `DEFAULT_CONTENT` es el valor por defecto de la clave viva `content`. En PRE manda lo publicado; lo nuevo hay que volver a publicarlo. Detalles en `docs/CONTENIDO.md`.
- **La configuración viva** se publica por clave y sustituye los campos de primer nivel enteros. Ids permanentes. Temporadas y eventos, a medianoche de Madrid.
- **CSP estricta:** nada de `<style>` ni `style=""` en línea (se usan variables CSS o el CSSOM). Sonidos sintetizados, fuentes propias. Pixi se importa como `pixi.js/unsafe-eval`.
- **Migraciones:**
  - nombre `YYYYMMDDHHMMSS_galaxy_<nombre>.sql`, nunca con fecha futura (hay un test que lo comprueba);
  - compatibles hacia atrás;
  - si añades tablas, actualiza `apps/server/src/db/schema.ts`;
  - nunca hagas UPDATE ni DELETE en tablas de solo añadir (`ledger`, `runs`, `gacha_pulls`, `operations`…).
- **Economía:**
  - toda acción que mueve moneda va con clave de idempotencia (`runOperation`);
  - los errores de la API son códigos (`{ error }`) y su texto vive en `es.ts`.

## Peligros

- **PRE es la beta abierta.**
  - Nunca crees cuentas de prueba allí y nunca ejecutes nada que escriba en PRE sin el OK explícito del propietario. Mirar (solo lectura) está bien.
  - Un merge a `develop` despliega PRE solo, migraciones incluidas, y no hay vuelta atrás.
- **`main` es producción** de la web de la raíz: nunca se toca sin el propietario.
- **El repo es público.** Nada secreto en commits: ni `.env`, ni contraseñas, ni datos de jugadores. No leas ni imprimas los `.env` de la raíz.
- **Secretos de admin:** `create-admin` y `reset-totp` imprimen secretos; solo los ejecuta el propietario en su sesión SSH.
- **`trailer/`** solo existe en la rama `feature/galaxy-trailer`: lleva música sin derechos confirmados y nunca se integra.
- **Raíz del repo:** `pnpm db:reset`, `pnpm db:test`, `pnpm test:e2e` y `supabase db reset` borran o ensucian la base de datos local. No los ejecutes. Las migraciones se aplican con `pnpm exec supabase migration up`.

## Convenciones

**Idioma:**
- Interfaz, textos, commits, PR, nombres de tests y documentos en español.
- Identificadores y comentarios del código en inglés.

**Textos:**
- De tú, frases cortas, títulos sin punto final y sin `· : — → //`. Números con `fmt` (es-ES).
- La información secundaria va en popups que el jugador abre (Noticias, Condiciones de hoy), no suelta por la pantalla.
- Los títulos importantes se le proponen al propietario como pregunta de opciones.
- Ningún texto lleva escrito un valor que el admin pueda cambiar.

**Pantallas:**
- Nunca crecen de lado: los módulos anchos hacen scroll por dentro.
- Antes de dar algo por bueno, captura a 1280, 1600, 1920 y 2560.
- «Volver» dice adónde vuelve.

**Código:**
- Cabecera `//` en inglés que explica el porqué y cita el GDD (`GDD §8.3`).
- JSDoc en lo exportado.

**Proceso:**
- TDD: primero el test que falla, después el código.
- Antes de diseñar interfaz, la skill ui-ux-pro-max. Nada de estilo genérico de IA.
- Ver `../../INSTRUCCIONES_PROYECTO.md`.

**Git:**
1. Rama `feature/galaxy-<slug>`, `fix/…`, `docs/…` o `chore/…` desde `develop`.
2. Commit `feat(galaxy): <frase en español sobre lo que nota el jugador>`.
3. PR a `develop` con «Qué cambia» y «Pruebas».
4. CI en verde y merge (despliega PRE).
- Sin force-push.
- `develop` → `main` solo con el propietario.

**Etiquetas del GDD:** [U] lo decidió el propietario (no se cambia sin preguntar), [D] decisión de diseño (ajustable con criterio), [C] libre.

## Documentos

| Documento | Para qué |
|---|---|
| `docs/GDD.md` | El diseño completo (§1–21): sistemas, economía, arquitectura (§18) e hitos (§19) |
| `docs/CONTENIDO.md` | **Cómo añadir o cambiar contenido** y operar la configuración viva |
| `docs/DESIGN_SYSTEM.md` | Sistema visual: color, tipografía, movimiento, sprites (§8 quater), textos (§9) |
| `docs/DEPLOY_PRE.md` | PRE: montaje, lista por hito, lanzamiento de la beta y tabla de operación (CLI) |
| `docs/LORE.md` | Lore del Códice |
| `docs/ENGINE_PORT.md` | Referencia del motor de galaxias (RNG, rasgos, dibujo) |
| `docs/BRIEF.md` | Encargo original; donde choque con el GDD, manda el GDD |
| `docs/PRODUCCION.md` | Lo pendiente para producción |
| `../../docs/superpowers/plans/` | Planes de cada hito, con su ledger |

## Skills para crear contenido

Viven en `../../.claude/skills/`. Claude Code las carga solas; para cualquier otra IA, su `SKILL.md` es un procedimiento que se puede seguir a mano (donde dicen AskUserQuestion, pregunta al propietario con opciones).

| Skill | Para |
|---|---|
| `galaxy-habilidad` | Arma nueva, evolución, variante de nivel 4/8, pasiva o stat nueva de la incursión |
| `galaxy-reliquias` | Poderes de las galaxias equipadas: retoques, conjuntos, fondos, fenómenos, niveles y ranuras |
| `galaxy-enemigos-sectores-sondas` | Enemigos, élites, Núcleos, sectores, biomas y sondas |
| `galaxy-temporada` | Temporada nueva: fechas, ruta y tienda, misiones y logros, anomalía, cierre |
| `galaxy-evento` | Evento temporal con metas, escáner de evento con destacada, potenciadores y aviso |
| `galaxy-publicar-config` | Publicar en PRE una carpeta de `ops/launch/`, solo con el OK del propietario |

## Dónde empezar

| Tarea | Mira primero |
|---|---|
| Algo de la incursión (armas, enemigos, reliquias) | `docs/CONTENIDO.md` parte A y la skill que toque |
| Temporada, evento, potenciador, misiones | `docs/CONTENIDO.md` parte B, `ops/plantillas/` y la skill |
| Una pantalla | `apps/web/src/App.tsx` (rutas), la carpeta de su dominio en `apps/web/src`, `docs/DESIGN_SYSTEM.md` |
| Un endpoint | `apps/server/src/<dominio>/routes.ts` y `apps/server/src/app.ts` |
| Un valor ajustable desde el panel | `packages/shared/src/config/registry.ts` y `apps/web/src/admin/forms/labels.ts` |
| La partida en grupo | `apps/server/src/coop/` (salas, relevo, árbitro) y `apps/web/src/coop/` |
| Base de datos | `../../supabase/migrations/*_galaxy_*` y `apps/server/src/db/schema.ts` |
| Operar PRE | `docs/DEPLOY_PRE.md` (Operación) |
