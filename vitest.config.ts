import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    name: 'unit',
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**'],
    globals: true,
    environment: 'node',
    coverage: {
      reporter: ['text', 'json-summary', 'json', 'html', 'lcovonly'],
      thresholds: {
        lines: 60,
        branches: 60,
        functions: 63,
        statements: 60,
      },
    },
  },
});
