import type { Meta, StoryObj } from '@storybook/react-vite';
import { Chip } from './chip';

const meta = {
  title: 'Primitives/Chip',
  component: Chip,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Text alone — the shape with no colour of its own. CHECK that it reads as a
 *  pill and not as a button: no border, no fill, no tap affordance. */
export const Default: Story = { args: { children: 'ccrc-pwa' } };

/** With the dot. CHECK that the dot takes the chip's OWN colour — it is
 *  `currentColor`, so a caller sets one colour and never two that can drift. */
export const WithDot: Story = {
  args: { dot: true, children: 'team·alt' },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <Chip {...args} />
      <Chip dot style={{ color: 'var(--acct-cyan)' }}>acct-a</Chip>
      <Chip dot style={{ color: 'var(--acct-magenta)' }}>acct-b</Chip>
      <Chip dot style={{ color: 'var(--acct-amber)' }}>acct-c</Chip>
    </div>
  ),
};

/** How the app actually paints one: an account hue arrives from OUTSIDE, as an
 *  inline style carrying token names from `lib/accounts.ts`. That is why this
 *  component has no `tone` variant — an account hue is ccrc routing
 *  vocabulary, and the design system owns the pill, not what it means. */
export const ColouredFromOutside: Story = {
  args: { dot: true, children: 'acct-a' },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <Chip {...args} style={{ color: 'var(--acct-cyan)', background: 'var(--acct-cyan-tint)' }} />
      <Chip style={{ color: 'var(--ink-tertiary)', background: 'var(--bg-raised)' }}>
        archived · merged #241
      </Chip>
      <Chip style={{ color: 'var(--ink-secondary)' }}>ccrc-pwa</Chip>
    </div>
  ),
};

/** CHECK that a long label does not break the pill — it is `inline-flex`, so
 *  it grows with its text rather than clipping. The app keeps labels short on
 *  purpose; this is what happens when one is not. */
export const LongLabel: Story = {
  args: { dot: true, children: 'a-rather-long-account-label-nobody-should-write' },
};
