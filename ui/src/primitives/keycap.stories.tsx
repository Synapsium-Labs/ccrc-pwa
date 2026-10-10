import type { Meta, StoryObj } from '@storybook/react-vite';
import { Keycap } from './keycap';

const meta = {
  title: 'Primitives/Keycap',
  component: Keycap,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Keycap>;

export default meta;
type Story = StoryObj<typeof meta>;

/** THE GROUND ARRIVES FROM OUTSIDE, by a descendant selector in the app's own
 *  stylesheet — `.chat-head .keycap` and `.term-keys .keycap`. Both are
 *  supplied here as utilities so the shape has something to sit on.
 *
 *  CHECK the bottom border against the other three: it is 2px where the rest
 *  are 1px, and that asymmetry is the entire reason this is a keycap and not
 *  an icon button. */
export const OnChrome: Story = {
  args: {
    className: 'flex-none bg-raised text-ink-primary border-edge-strong',
    children: <span aria-hidden="true">&gt;_</span>,
  },
};

/** The terminal's key row. CHECK that the wash reads against the well behind
 *  it — every colour on this one is a `color-mix` over `--ink-on-well`, which
 *  is why this ground stayed in a stylesheet where the contrast gate can
 *  measure it rather than moving into a variant where neither half could. */
export const OnTheWell: Story = {
  args: {
    className: 'flex-none px-2 text-ink-on-well'
      + ' bg-[color-mix(in_srgb,var(--ink-on-well)_9%,transparent)]'
      + ' border-[color-mix(in_srgb,var(--ink-on-well)_22%,transparent)]',
    children: <span aria-hidden="true">esc</span>,
  },
  render: (args) => (
    <div className="flex gap-2 rounded-md bg-well p-3">
      <Keycap {...args} />
      <Keycap className={args.className}><span aria-hidden="true">tab</span></Keycap>
      <Keycap className={args.className}><span aria-hidden="true">^C</span></Keycap>
      <Keycap className={args.className}><span aria-hidden="true">hist</span></Keycap>
    </div>
  ),
};

/** Disabled — the header's `esc`, while nothing is running. CHECK that it
 *  stands DOWN rather than disappearing: the fill drops to surface and the ink
 *  to disabled, and the key keeps its full tap square, because a key that
 *  moves when it is unavailable is a key you mis-hit when it comes back. */
export const Disabled: Story = {
  args: {
    disabled: true,
    className: 'flex-none bg-surface text-ink-disabled border-edge-subtle cursor-default',
    children: 'esc',
  },
};
