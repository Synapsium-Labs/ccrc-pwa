import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// Only Storybook and the token/utility smoke build use this config — the app
// is built by pwa/vite.config.ts, which runs the same tailwind plugin.
export default defineConfig({
  resolve: {
    // `@/…` is this package's own source. `components.json` sits beside this
    // file, so shadcn's CLI writes `@/lib/cn`-style imports into `src/`, and
    // Storybook has to resolve them as well as the app's bundler does.
    //
    // ONE MEANING, THREE RESOLVERS: this, `pwa/vite.config.ts`'s alias and
    // `tsconfig.json`'s `paths`. `pwa/test/shadcn-alias.test.ts` pins that
    // the three agree, for the reason `shared/models`' twins taught this
    // branch: a name that resolves differently for `tsc` and for the bundle
    // type-checks clean and is `undefined` at runtime.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [react(), tailwindcss()],
});
