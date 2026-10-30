import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['apps/*/test/**/*.unit.test.ts', 'packages/*/test/**/*.unit.test.ts'] },
});
