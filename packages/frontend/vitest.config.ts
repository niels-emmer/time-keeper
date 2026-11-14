import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    // jsdom defaults to an opaque origin ("about:blank"), where localStorage
    // and sessionStorage throw a SecurityError. Give the tests a real origin so
    // the storage-backed suites (weeklyExport, WeeklySummary) can run.
    environmentOptions: {
      jsdom: {
        url: 'http://localhost:3000/',
      },
    },
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
});
