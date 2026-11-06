import { defineConfig } from 'vitest/config';

// Proyectos (plan M1, Tarea 1). El proyecto `web` (jsdom) se añade con la web en la Tarea 9.
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
