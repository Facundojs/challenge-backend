import { defineConfig } from 'vitest/config';

// Requiere Postgres (DATABASE_URL_DIRECT o TEST_DATABASE_URL): cada archivo crea un schema temporal.
export default defineConfig({
  test: {
    include: ['apps/*/test/**/*.integration.test.ts', 'packages/*/test/**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
