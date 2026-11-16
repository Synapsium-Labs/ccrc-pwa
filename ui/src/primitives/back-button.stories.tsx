// The chevron on its own. Nothing showed it before: five rules declared it and
// each was only visible through whichever screen happened to render it, so the
// two drifts between the copies were invisible from any one of them.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { BackButton } from './back-button';

const meta = {
  title: 'Primitives/BackButton',
  component: BackButton,
  parameters: {
    docs: {
      description: {
        component:
          'The way out of a detail screen. Five stylesheet rules declared this same '
          + 'object — `.chat-back`, `.accounts-back`, `.mail-back`, `.runs-back`, '
          + '`.settings-back` — and two of them said so in prose before declaring it '
          + 'again. The copies had drifted twice: only two were hidden on desktop, and '
          + 'only one honoured `prefers-reduced-motion`. The motion drift is fixed here; '
          + 'the desktop one is deliberately left to `shell.css`, which still keys on the '
          + 'per-screen hook class each call site passes through `className`.',
      },
    },
  },
  args: { children: '‹', 'aria-label': 'Back to fleet' },
} satisfies Meta<typeof BackButton>;
export default meta;

type Story = StoryObj<typeof meta>;

/** At rest: `--ink-secondary` on whatever the screen's header sits on, which
 *  in every one of the five cases is body's `--bg-page` through a chain that
 *  paints nothing. That pair is measured in all twelve palettes by
 *  `design/contrast-check.mjs` — worst 6.55 in solarized-light. */
export const Default: Story = {};

/** Pressed: `scale(0.88)` and the ink lifts to `--ink-primary`. Two cues, as
 *  the palette requires. Press and hold to see it — and under
 *  `prefers-reduced-motion` the transform still applies while the transition
 *  does not, which is the point of disabling the transition rather than the
 *  transform. */
export const Pressed: Story = {
  parameters: {
    pseudo: { active: true },
    docs: { description: { story: 'The `:active` state, forced.' } },
  },
};

/** 44px square, from `--tap-min` via `--spacing-tap`. The box is drawn here
 *  because the glyph is much smaller than the target and the gap between the
 *  two is the whole reason the floor is asserted rather than eyeballed. */
export const TapTarget: Story = {
  decorators: [
    (Story) => (
      <div style={{ outline: '1px dashed var(--accent)', display: 'inline-block' }}>
        <Story />
      </div>
    ),
  ],
};
