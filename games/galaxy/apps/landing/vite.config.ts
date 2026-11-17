import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The landing of galaxysurvivor.es (plan «galaxysurvivor.es», PR 4), built in two passes (package.json «build»):
//   1. `vite build --ssr src/render/entry.ts --outDir dist-ssr`: the templates as a Node module;
//   2. scripts/prerender.mjs writes the pages into gen/, then this config builds them as a multi-page site: every
//      image, clip, font, sprite, the CSS and the client are hashed into dist/static/ (served immutable).
// public/ (icons, the social card, the fixed-name screenshots) is copied as is. scripts/finish.mjs moves the pages to
// dist/ and writes dist/routes.json for the server.
const root = fileURLToPath(new URL('.', import.meta.url));
const gen = fileURLToPath(new URL('./gen/', import.meta.url));
const pages = existsSync(gen) ? Object.fromEntries(readdirSync(gen).filter((f) => f.endsWith('.html')).map((f) => [f.replace(/\.html$/, ''), gen + f])) : {};

export default defineConfig(({ isSsrBuild }) => ({
  root,
  base: '/',
  publicDir: 'public',
  // The shared package is TypeScript: bundle it into the SSR module.
  ssr: { noExternal: ['@galaxy/shared'] },
  build: isSsrBuild
    ? { outDir: 'dist-ssr', emptyOutDir: true, sourcemap: false }
    : {
        outDir: 'dist',
        assetsDir: 'static',
        emptyOutDir: true,
        sourcemap: false,
        // Nothing inlined: the server's CSP allows no data: fonts, and sprites inlined into the CSS would make the one
        // render-blocking file several times heavier (they are cached separately instead).
        assetsInlineLimit: 0,
        rollupOptions: { input: pages },
      },
}));
