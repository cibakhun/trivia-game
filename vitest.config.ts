import { defineConfig } from 'vitest/config';

// Zwei Testprojekte: "unit" (rein, ohne Datenbank) und "integration" (gegen PostgreSQL,
// benötigt TEST_DATABASE_URL). Siehe docs/TEST_PLAN.md §2.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'tools/*/test/**/*.test.ts'],
          exclude: ['**/*.int.test.ts', '**/node_modules/**'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/*/test/**/*.int.test.ts', 'tools/*/test/**/*.int.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // Jede Testdatei legt ihre eigene Datenbank an; Dateien laufen parallel.
          fileParallelism: true,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'tools/*/src/**'],
    },
  },
});
