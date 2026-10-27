import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [
      {
        find: /^#([^/]+)\/(.*)$/,
        replacement: fileURLToPath(new URL('./src/$1/$2', import.meta.url)),
      },
    ],
  },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
