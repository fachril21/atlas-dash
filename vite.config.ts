import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { host: true },
  // three.js alone is ~550 kB minified; split it out if the app chunk grows.
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 700 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
