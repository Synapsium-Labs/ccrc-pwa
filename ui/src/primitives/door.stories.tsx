// Both shipped doors, side by side — which is how they were never seen, since
// each lived behind its own identical stylesheet rule.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Door } from './door';

const meta = {
  title: 'Primitives/Door',
  component: Door,
  parameters: {
    docs: {
      description: {
        component:
          'A labelled way into another screen, from a header. `.accounts-door` and '
          + '`.settings-door` were byte-identical and their call sites sit adjacent, the '
          + 'second one’s comment pointing at the first. A glyph AND a short word, '
          + 'deliberately: an icon-only gear would be exactly as undiscoverable as the '
          + 'AccountsStrip tap target D-161 found was the only door to /accounts. '
          + '`aria-label` is required, because neither door’s own word says what is behind it.',
      },
    },
  },
} satisfies Meta<typeof Door>;
export default meta;

type Story = StoryObj<typeof meta>;

/** The door to /accounts. Its name says both halves of the screen — sign-in
 *  and accounts — because "Account" alone is what the strip already failed to
 *  communicate. */
export const Account: Story = {
  args: { glyph: '🔑', children: 'Account', 'aria-label': 'Your sign-in and accounts' },
};

/** The door to /settings. The name begins with the visible word, so a voice
 *  user saying what they see still reaches it. */
export const Settings: Story = {
  args: {
    glyph: '⚙',
    children: 'Settings',
    'aria-label': 'Settings — updates and notifications',
  },
};

/** Both, in the header group they actually live in. The ink is
 *  `--ink-secondary` over two possible grounds — the page on a phone,
 *  `.shell-nav`'s `--bg-surface` in the desktop sidebar — and the token
 *  contract measures all four pairs rather than picking one. */
export const InAHeaderGroup: Story = {
  args: { glyph: '🔑', children: 'Account', 'aria-label': 'Your sign-in and accounts' },
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
      <Door glyph="🔑" aria-label="Your sign-in and accounts">Account</Door>
      <Door glyph="⚙" aria-label="Settings — updates and notifications">Settings</Door>
    </div>
  ),
};
