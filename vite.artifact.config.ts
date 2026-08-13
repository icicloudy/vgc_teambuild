import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Builds the whole app into one self-contained HTML file with no external
 * requests, for embedding somewhere with a strict content-security policy.
 * Remote sprites are disabled at compile time so the page never fires a request
 * it knows will be blocked.
 */
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  define: {
    'import.meta.env.VITE_OFFLINE_SPRITES': JSON.stringify('1'),
  },
  build: {
    outDir: 'dist-artifact',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 100_000,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
