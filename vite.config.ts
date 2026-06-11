/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import { patchCssModules } from 'vite-css-modules';

export default defineConfig({
  plugins: [
    solidPlugin(), 
    patchCssModules({
      generateSourceTypes: true,
      declarationMap: true,
    }),
  ],
  base: process.env.GITHUB_ACTIONS ? '/minicoder/' : '/',
  server: {
    port: 3000,
  },
  build: {
    target: 'esnext',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Use solid-js's browser build instead of server build in tests
    resolve: {
      conditions: ['browser'],
    },
  },
});
