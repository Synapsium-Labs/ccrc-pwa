import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)', '../src/**/*.mdx'],
  addons: [
    '@storybook/addon-docs',
    // axe, in the browser, on every story. It is not a replacement for
    // design/audit.mjs — it measures what a story happens to render, where the
    // gate measures every rule in the stylesheet — but it is the one check
    // that survives utility classes, because it reads COMPUTED colour off real
    // elements instead of trying to pair class names in source.
    '@storybook/addon-a11y',
  ],
  framework: { name: '@storybook/react-vite', options: {} },
};

export default config;
