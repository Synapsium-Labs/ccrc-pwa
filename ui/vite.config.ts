import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Only Storybook and the token/utility smoke build use this config — the app
// is built by pwa/vite.config.ts, which runs the same tailwind plugin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
