import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    // Node by default. Component tests opt into a DOM with a
    // `// @vitest-environment jsdom` docblock, which keeps the fast majority
    // of the suite out of jsdom.
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}', 'evals/**/*.eval.ts'],
    // Evals spend real API credit, so they stay out of the default suite.
    exclude: [...configDefaults.exclude, ...(process.env.ROOTWISE_EVAL === '1' ? [] : ['evals/**'])],
    setupFiles: ['./test/setup.ts'],
    env: {
      // The MCP server's cache must not touch a real home directory in tests.
      PLANT_INTEL_CACHE_DISABLED: '1',
    },
  },
});
