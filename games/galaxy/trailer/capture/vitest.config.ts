import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The trailer's capture runs (not part of the game's tests): the real game screens in Chromium at 1920×1080, driven
// frame by frame by a virtual clock (vt.ts) and saved as PNG frames for the edit. Run from games/galaxy:
//   pnpm exec vitest run --config trailer/capture/vitest.config.ts trailer/capture/<scene>.capture.tsx

const galaxy = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fromWeb = createRequire(resolve(galaxy, 'apps/web/package.json'));

// CAPTURE_SCALE=1.5 shoots the screens as a 1280×720 window on a high-density display: the same 1920×1080 picture,
// with the interface half as large again (menus read better in stills). The arena stays at 1 (whole art pixels).
const scale = Number(process.env['CAPTURE_SCALE'] ?? 1);

export default defineConfig({
  root: galaxy,
  // The app's own public files (fonts) at the path the app asks for them: /galaxy/fonts/…
  publicDir: resolve(galaxy, 'trailer/capture/public'),
  plugins: [react(), tailwindcss()],
  // The workspace packages, as the web app resolves them (this folder is outside apps/web).
  resolve: {
    alias: [
      { find: /^@galaxy\/engine\/gpu$/, replacement: resolve(galaxy, 'packages/engine/src/gpu/index.ts') },
      { find: /^@galaxy\/engine$/, replacement: resolve(galaxy, 'packages/engine/src/index.ts') },
      { find: /^@galaxy\/shared$/, replacement: resolve(galaxy, 'packages/shared/src/index.ts') },
      { find: /^@galaxy\/sim$/, replacement: resolve(galaxy, 'packages/sim/src/index.ts') },
      // The web app's own packages, from its node_modules (pnpm does not hoist them here); a plain name also takes
      // its subpaths (react-dom/client, react/jsx-runtime).
      ...['react', 'react-dom', '@tanstack/react-query', 'react-router'].map((id) => ({ find: id, replacement: dirname(fromWeb.resolve(`${id}/package.json`)) })),
    ],
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: { include: ['three', 'gsap', 'pixi.js', 'react', 'react-dom', 'react-dom/client', '@tanstack/react-query', 'react-router'] },
  test: {
    include: ['trailer/capture/**/*.capture.{ts,tsx}'],
    testTimeout: 0,
    hookTimeout: 0,
    fileParallelism: false,
    browser: {
      enabled: true,
      provider: playwright({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }, contextOptions: { deviceScaleFactor: scale } }),
      headless: true,
      viewport: { width: Math.round(1920 / scale), height: Math.round(1080 / scale) },
      instances: [{ browser: 'chromium' }],
      // A picture of the game's frame as it is now, without Playwright's wait for a still element (the live scanner
      // never holds still for it). The path is under trailer/capture/.
      commands: {
        shot: async (ctx, path: string) => {
          const frame = await (ctx as unknown as { frame(): Promise<{ frameElement(): Promise<{ boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> }> }> }).frame();
          const box = await (await frame.frameElement()).boundingBox();
          const page = (ctx as unknown as { page: { screenshot(o: object): Promise<unknown> } }).page;
          await page.screenshot({ path: resolve(galaxy, 'trailer/capture', path), clip: box ?? undefined });
        },
      },
    },
  },
});
