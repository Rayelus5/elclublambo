import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Proyectos (plan M1): unit (node), web (jsdom + React) e integration (node, contra la BD local).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts', 'apps/server/test/unit/**/*.test.ts'],
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
    ],
  },
});
