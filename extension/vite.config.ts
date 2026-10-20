import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Main build: service worker (ES module), popup, block page, offscreen document.
 * The content script is built separately as a classic IIFE (content scripts cannot be modules);
 * see scripts/build.mjs. Nothing is loaded from the network at runtime (MV3: no remote code).
 */
export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome116',
    modulePreload: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        sw: resolve(__dirname, 'src/background/sw.ts'),
        popup: resolve(__dirname, 'src/popup/popup.html'),
        block: resolve(__dirname, 'src/block/block.html'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
