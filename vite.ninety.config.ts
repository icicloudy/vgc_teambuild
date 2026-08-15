import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Ninety is its own app: its own root, its own dataset, its own build. */
export default defineConfig({
  root: 'ninety',
  plugins: [react()],
  json: { stringify: true },
  base: process.env.BASE_PATH || '/',
  build: { outDir: '../dist-ninety', emptyOutDir: true },
  server: { port: 5273, host: process.env.HOST_ALL ? true : 'localhost' },
  preview: { port: 5274, host: process.env.HOST_ALL ? true : 'localhost' },
});
