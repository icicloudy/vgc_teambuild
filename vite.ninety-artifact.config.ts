import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** Ninety as one self-contained HTML file, for a strict-CSP embed. */
export default defineConfig({
  root: 'ninety',
  plugins: [react(), viteSingleFile()],
  json: { stringify: true },
  build: {
    outDir: '../dist-ninety-artifact',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 100_000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
