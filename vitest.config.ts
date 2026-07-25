import { defineConfig } from 'vitest/config';

/**
 * Root vitest config.
 *
 * Two things it fixes, both of which produced failures that had nothing to do with the
 * code under test:
 *
 *  1. `exclude` must drop `**​/dist/**`. `npm run build` compiles the test files into
 *     `packages/backend/dist/__tests__/`, and vitest then collected BOTH copies. The
 *     compiled ones resolve `import.meta.dirname` to `dist/`, so every test that reads a
 *     source file for a grep-style assertion failed with ENOENT — 23 phantom failures
 *     whose only cause was having run a build first.
 *  2. `setupFiles` applies environment preconditions before the module graph loads. See
 *     the comment in src/__tests__/setup-env.ts: `config` captures env vars at module
 *     evaluation, so a `beforeAll` cannot set them in time.
 */
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.omc/**',
      '**/build/**',
    ],
    setupFiles: ['./packages/backend/src/__tests__/setup-env.ts'],
  },
});
