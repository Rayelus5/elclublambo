import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

// React as the web app has it: from the workspace root, `react/jsx-dev-runtime` would otherwise resolve up into the
// parent repository's node_modules and load a second React.
const fromWeb = createRequire(new URL('./apps/web/package.json', import.meta.url));
const webReact = {
  react: dirname(fromWeb.resolve('react/package.json')),
  'react-dom': dirname(fromWeb.resolve('react-dom/package.json')),
};

// Proyectos: unit (node), web (jsdom + React), integration (node, contra la BD local) y browser (Chromium real con
// WebGL2, para el posprocesado del motor).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts', 'apps/server/test/unit/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'packages/*/test/browser/**'],
          // The engine's golden tests render whole galaxies (a 192-column merger takes ~1 s here, 3–4× more on CI).
          testTimeout: 30_000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/test/**/*.test.{ts,tsx}'],
          exclude: [...configDefaults.exclude, 'apps/web/test/browser/**'],
          setupFiles: ['apps/web/test/setup.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['apps/server/test/integration/**/*.test.ts'],
          fileParallelism: false,
        },
      },
      {
        // The app's own plugins, so components render with their real styles (cards, tokens).
        plugins: [react(), tailwindcss()],
        resolve: { alias: webReact },
        test: {
          name: 'browser',
          include: ['packages/*/test/browser/**/*.browser.test.ts', 'apps/web/test/browser/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            // Software WebGL (SwiftShader) everywhere: CI runners have no GPU, and the same renderer locally keeps
            // the image comparison with the Python PNGs reproducible.
            provider: playwright({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } }),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
