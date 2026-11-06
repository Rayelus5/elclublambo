import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig } from 'vitest/config';

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
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/test/**/*.test.{ts,tsx}'],
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
        test: {
          name: 'browser',
          include: ['packages/*/test/browser/**/*.browser.test.ts'],
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
