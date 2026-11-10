<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Mapa del repositorio

- **Raíz:** la web de elclub.party (Next.js, Supabase, Vercel). Sus reglas de proceso están en `INSTRUCCIONES_PROYECTO.md`; sus entornos, en `docs/deploy/`.
- **`games/galaxy/`:** el juego Galaxy Survivor, que vive en `/galaxy`. Es un workspace pnpm aparte, con su propio lockfile: sus comandos se lanzan con `pnpm -C games/galaxy …`. **Antes de tocar el juego, lee `games/galaxy/AGENTS.md`.** Para crear contenido (habilidades, reliquias, enemigos, sectores, sondas, temporadas, eventos) están las skills `.claude/skills/galaxy-*` y la guía `games/galaxy/docs/CONTENIDO.md`.
- **`supabase/migrations/`:** compartido por la web y el juego (las del juego llevan `_galaxy_`).
- **Ramas:** `develop` despliega PRE (pre.elclub.party) y `main` despliega producción, que nunca se toca sin el propietario.
