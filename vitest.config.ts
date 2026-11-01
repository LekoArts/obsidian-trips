import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Tests run outside Obsidian: `obsidian` resolves to the plain libraries its API wraps.
  resolve: {
    alias: { obsidian: '/src/__tests__/obsidian.ts' },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
