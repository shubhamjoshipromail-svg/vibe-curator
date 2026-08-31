import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  root: sourceRoot,
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  build: {
    target: 'chrome116',
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: fileURLToPath(new URL('./src/popup.html', import.meta.url)),
        newtab: fileURLToPath(new URL('./src/newtab.html', import.meta.url)),
        offscreen: fileURLToPath(new URL('./src/offscreen.html', import.meta.url)),
        service_worker: fileURLToPath(new URL('./src/service-worker.ts', import.meta.url)),
        search_overlay: fileURLToPath(new URL('./src/search-overlay.ts', import.meta.url)),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
