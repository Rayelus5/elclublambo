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
const webReact = {
  react: dirname(fromWeb.resolve('react/package.json')),
  'react-dom': dirname(fromWeb.resolve('react-dom/package.json')),
};

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
      { find: /^react$/, replacement: webReact.react },
      { find: /^react-dom$/, replacement: webReact['react-dom'] },
    ],
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: { include: ['three', 'pixi.js', 'react', 'react-dom', 'react-dom/client', '@tanstack/react-query', 'react-router'] },
  test: {
    include: ['trailer/capture/**/*.capture.{ts,tsx}'],
    testTimeout: 0,
    hookTimeout: 0,
    fileParallelism: false,
    browser: {
      enabled: true,
      provider: playwright({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } }),
      headless: true,
      viewport: { width: 1920, height: 1080 },
      instances: [{ browser: 'chromium' }],
    },
  },
});
