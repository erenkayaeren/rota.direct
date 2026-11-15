import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests create (and drop) their own database, so test files can run in parallel.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
