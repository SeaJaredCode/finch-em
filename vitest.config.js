import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    poolOptions: {
      forks: {
        isolate: false,
        maxForks: 2,
      },
    },
    testTimeout: 15000,
    hookTimeout: 60000,
  },
});
