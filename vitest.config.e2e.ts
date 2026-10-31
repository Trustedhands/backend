import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // SWC emits decorator metadata, which Nest's DI needs and esbuild doesn't produce.
  plugins: [tsconfigPaths(), swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Hits the real database over the network. One file at a time keeps the
    // number of pooled connections to Supabase low.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
