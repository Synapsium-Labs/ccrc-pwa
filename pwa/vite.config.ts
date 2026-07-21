import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Dev proxy to a local ccrc-server (run with CCRC_HOME at a fixture tree).
    proxy: {
      '/api': { target: 'http://127.0.0.1:7788', changeOrigin: true },
      '/ws': { target: 'http://127.0.0.1:7788', changeOrigin: true, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
});
