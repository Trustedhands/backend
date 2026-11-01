import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { TEST_ENV } from './test/test-env.js';

export default defineConfig({
  // SWC emits decorator metadata, which Nest's DI needs and esbuild doesn't produce.
  plugins: [tsconfigPaths(), swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // A local Docker Postgres, rebuilt from the migrations before each run
    globalSetup: ['./test/global-setup.ts'],
    env: TEST_ENV,
    // Suites share one database and the settlement job acts on all of it
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
