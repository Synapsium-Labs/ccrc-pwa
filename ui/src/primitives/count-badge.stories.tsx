import type { Meta, StoryObj } from '@storybook/react-vite';
import { CountBadge } from './count-badge';

const meta = {
  title: 'Primitives/CountBadge',
  component: CountBadge,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CountBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One unread thing. CHECK the pill is as tall as its line box and no taller:
 *  there is no height and no flex here, which is what the `1.6` leading buys —
 *  and it is why this is a readout inside a control rather than a control, so
 *  it carries no tap floor. */
export const One: Story = { args: { children: 1 } };

/** The width does not move as the number grows. CHECK 9 against 10 against
 *  99: `tabular-nums` is what keeps a ticking count from nudging the header
 *  it sits in. */
export const Counting: Story = {
  args: { children: 9 },
  render: () => (
    <div className="flex items-center gap-2">
      <CountBadge>9</CountBadge>
      <CountBadge>10</CountBadge>
      <CountBadge>99</CountBadge>
      <CountBadge>100</CountBadge>
    </div>
  ),
};

/** Where it actually lands: inside a head, after the headline. CHECK that it
 *  reads as attention and not as decoration — amber on amber is the one tone
 *  this badge has, because a count nobody needs to see should not render. */
export const InAHead: Story = {
  args: { children: 3 },
  render: (args) => (
    <div className="flex items-center gap-2 px-3 py-2 text-ink-primary">
      <span className="flex-none font-mono text-sm leading-none text-ink-tertiary">✉</span>
      <span className="min-w-0 flex-1">Mail</span>
      <CountBadge {...args} />
    </div>
  ),
};
