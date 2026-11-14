import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import { loadTestEnv } from './test/setup/load-test-env.js';

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
    globalSetup: './test/setup/global-setup.ts',
    env: loadTestEnv(),
    fileParallelism: false,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
