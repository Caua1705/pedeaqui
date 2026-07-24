import { defineConfig } from 'vitest/config';

// Unit tests only. The app files are browser IIFEs that publish onto `window`;
// tests/unit/setup.js aliases window -> globalThis so importing a file for its
// side effects exposes its API on globalThis. E2E lives in Playwright, excluded here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    setupFiles: ['tests/unit/setup.js']
  }
});
