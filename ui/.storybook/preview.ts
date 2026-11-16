import type { Preview, Decorator } from '@storybook/react-vite';
// The single style entry point, and it must stay a CSS file rather than two JS
// imports: preview.css imports the reset `layer(base)`, exactly as the app's
// own base.css does. Importing reset.css from here instead loads it unlayered,
// where preflight beats `@layer utilities` and every button loses its fill.
import './preview.css';
import { THEMES, PHOSPHOR, applyTheme } from '../src/styles/themes';
import { SKINS, applySkin, resolveSkin } from '../src/styles/skins';

/** Stamp the theme on <html>, THE WAY THE APP DOES — which is the whole point.
 *
 *  This decorator used to do `setAttribute('data-theme', theme)` with the
 *  global defaulting to `'dark'`. There is no `[data-theme='dark']` block in
 *  tokens.css: the app's dark palette is `:root`, reached by the ABSENCE of the
 *  attribute. So every story rendered against a selector that matched nothing,
 *  every token fell through to `:root`, and it looked correct by coincidence —
 *  a half-palette that happened to be the right half. The moment a real theme
 *  was applied the fiction showed: one story re-rendered, the decorator re-ran,
 *  and it stamped `dark` back over the palette under test.
 *
 *  Going through `applyTheme` means Storybook and the app cannot disagree about
 *  what selecting a theme MEANS, because they call the same function. */
const withTheme: Decorator = (Story, context) => {
  const theme = (context.globals['theme'] as string | undefined) ?? PHOSPHOR;
  applyTheme(theme, document.documentElement, false);
  // Paint the canvas: a story rendered on Storybook's own white while the
  // tokens say dark is a lie about contrast, and the a11y addon would go on to
  // measure that lie.
  document.body.style.background = 'var(--bg-page)';
  document.body.style.color = 'var(--ink-primary)';
  return Story();
};

/** Stamp the skin on <html>, through `applySkin` — the function the app's
 *  `setSkin` calls — for the theme decorator's reason: Storybook and the app
 *  cannot disagree about what selecting a skin means (D-5093). The global is
 *  resolved first, so a stale value in a bookmarked URL stamps the default
 *  rather than an attribute no block answers. */
const withSkin: Decorator = (Story, context) => {
  applySkin(resolveSkin(context.globals['skin'] as string | undefined), document.documentElement);
  return Story();
};

const preview: Preview = {
  decorators: [withTheme, withSkin],
  globalTypes: {
    theme: {
      description: 'Palette — every one the app can render',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        // DERIVED from the catalogue, never re-listed. A palette added to
        // tokens.css appears here with no edit, and the toolbar cannot come to
        // offer a theme the app does not have (or miss one it does) — which is
        // the same binding `theme-catalogue.test.ts` enforces on the picker.
        items: THEMES.map((t) => ({
          value: t.id,
          title: `${t.label} · ${t.mode}`,
        })),
        dynamicTitle: true,
      },
    },
    skin: {
      description: 'Skin — density, structure and chrome; never colour',
      toolbar: {
        title: 'Skin',
        icon: 'component',
        // DERIVED from the catalogue, never re-listed — the same binding as
        // the theme toolbar above, held by `skin-catalogue.test.ts`.
        items: SKINS.map((s) => ({
          value: s.id,
          title: s.preview ? `${s.label} (preview)` : s.label,
        })),
        dynamicTitle: true,
      },
    },
  },
  // The initial skin is the build's `STORYBOOK_SKIN`, through the catalogue's
  // own resolver (D-5093, its verification clause): `STORYBOOK_SKIN=instrument
  // npm run build-storybook` makes a build whose every story opens in
  // Instrument, so the a11y run over it is axe in that skin. Unset, empty or
  // not a catalogue id, it is Refined, exactly as a stored value is in the app
  // — never an attribute no block answers, which would measure Refined while
  // claiming the other skin. Storybook's vite builder exposes `STORYBOOK_*`
  // variables on `import.meta.env` and replaces them at build time.
  initialGlobals: { theme: PHOSPHOR, skin: resolveSkin(import.meta.env.STORYBOOK_SKIN) },
  parameters: {
    layout: 'centered',
    backgrounds: { disable: true }, // the decorator owns the ground
    // The verification widths (spec §9): every foundations PR is checked at
    // these, so the toolbar offers exactly these. Phone 360, 390 and 438;
    // laptop 1280 and 1470; wide 1920. Pinned by `skin-catalogue.test.ts`.
    viewport: {
      options: {
        'phone-sm': { name: 'Phone S · 360', styles: { width: '360px', height: '780px' } },
        phone: { name: 'Phone · 390', styles: { width: '390px', height: '844px' } },
        'phone-lg': { name: 'Phone L · 438', styles: { width: '438px', height: '926px' } },
        laptop: { name: 'Laptop · 1280', styles: { width: '1280px', height: '800px' } },
        'laptop-lg': { name: 'Laptop L · 1470', styles: { width: '1470px', height: '920px' } },
        wide: { name: 'Wide · 1920', styles: { width: '1920px', height: '1080px' } },
      },
    },
    a11y: { test: 'error' },
    controls: { matchers: { color: /(background|color)$/i } },
  },
};

export default preview;
