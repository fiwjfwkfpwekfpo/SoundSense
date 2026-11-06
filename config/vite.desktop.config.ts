import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
/*
 * Bundles the desktop process (desktop/main.mjs and what it imports, music-metadata included)
 * into plain files, so the packaged app needs no node_modules. Electron and Node built-ins
 * stay external. The preload is copied as is by scripts/desktop.mjs.
 */
export default defineConfig({
  root: fileURLToPath(new URL('../', import.meta.url)),
  publicDir: false,
  ssr: { noExternal: true, external: ['electron'], target: 'node' },
  build: {
    ssr: 'desktop/main.mjs', target: 'node22', outDir: process.env.SS_DESKTOP_OUT ?? 'artifacts/desktop/app', emptyOutDir: false,
    minify: false, sourcemap: false, reportCompressedSize: false,
    rollupOptions: { output: { format: 'es', entryFileNames: 'main.mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' } },
  },
});
