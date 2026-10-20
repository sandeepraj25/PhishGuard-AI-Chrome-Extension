import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome116',
    lib: {
      entry: resolve(__dirname, 'src/content/guard.ts'),
      formats: ['iife'],
      name: 'PhishGuardContent',
      fileName: () => 'content.js',
    },
  },
});
