import type { Preview, Decorator } from '@storybook/react-vite';
// The single style entry point, and it must stay a CSS file rather than two JS
// imports: preview.css imports the reset `layer(base)`, exactly as the app's
// own base.css does. Importing reset.css from here instead loads it unlayered,
// where preflight beats `@layer utilities` and every button loses its fill.
import './preview.css';
import { THEMES, PHOSPHOR, applyTheme } from '../src/styles/themes';
import { SKINS, REFINED, applySkin, resolveSkin } from '../src/styles/skins';

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
  initialGlobals: { theme: PHOSPHOR, skin: REFINED },
  parameters: {
    layout: 'centered',
    backgrounds: { disable: true }, // the decorator owns the ground
    viewport: {
      options: {
        phone: { name: 'Phone', styles: { width: '390px', height: '844px' } },
        tablet: { name: 'Tablet', styles: { width: '834px', height: '1112px' } },
        desktop: { name: 'Desktop', styles: { width: '1440px', height: '900px' } },
      },
    },
    a11y: { test: 'error' },
    controls: { matchers: { color: /(background|color)$/i } },
  },
};

export default preview;
