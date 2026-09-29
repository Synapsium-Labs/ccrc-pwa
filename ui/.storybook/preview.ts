import type { Preview, Decorator } from '@storybook/react-vite';
// The single style entry point. It pulls tokens.css in itself — see that
// file's header for why importing tokens separately breaks the build silently.
import '../src/styles/reset.css';
import '../src/styles/theme.css';

/** Stamp the theme on <html>, the way the app does, so [data-theme='light']
 *  re-resolves every token. Also paints the canvas: a story rendered on
 *  Storybook's own white while the tokens say dark is a lie about contrast,
 *  and the a11y addon would measure that lie. */
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme ?? 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  document.body.style.background = 'var(--bg-page)';
  document.body.style.color = 'var(--ink-primary)';
  return Story();
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: 'Phosphor (dark) or Paper (light)',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'dark', title: 'Phosphor · dark' },
          { value: 'light', title: 'Paper · light' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'dark' },
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
