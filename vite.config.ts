import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // A big inlined JSON payload parses faster via JSON.parse than as an object literal.
  json: { stringify: true },
  // Served from the domain root by default. Set BASE_PATH when deploying under a
  // sub-path (GitHub Pages project sites live at /<repo>/).
  base: process.env.BASE_PATH || '/',
  server: {
    // `npm run dev:lan` binds every interface so a phone on the same Wi-Fi can reach it.
    host: process.env.HOST_ALL ? true : 'localhost',
  },
  preview: {
    host: process.env.HOST_ALL ? true : 'localhost',
  },
});
