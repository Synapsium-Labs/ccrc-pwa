import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Send it' },
  argTypes: { variant: { control: 'inline-radio', options: ['primary', 'ghost'] } },
} satisfies Meta<typeof Button>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary' } };
export const Ghost: Story = { args: { variant: 'ghost', children: 'Cancel' } };

/** Disabled is a VISIBLE stand-down, not just an inert listener. An
 *  accent-filled button that ignores taps reads as broken. */
export const Disabled: Story = {
  args: { disabled: true },
  render: (args) => (
    <div className="grid w-[320px] gap-2">
      <Button {...args} variant="primary">
        Send it
      </Button>
      <Button {...args} variant="ghost">
        Cancel
      </Button>
    </div>
  ),
};

/** The pairing as a sheet actually uses it: commit on top, way-out below. */
export const SheetActions: Story = {
  render: () => (
    <div className="grid w-[320px] gap-2">
      <Button>Stop the session</Button>
      <Button variant="ghost">Cancel</Button>
    </div>
  ),
};

/** `fit` — the shape every row that is NOT a sheet wanted. Six app rules in
 *  six stylesheets each said `width: auto; padding: 0 var(--sp-3)`; this is
 *  that, once. Check the two against each other: `full` spans its container,
 *  `fit` stops at its label, and both keep the 44px tap floor. */
export const FullVersusFit: Story = {
  render: () => (
    <div className="grid w-[320px] gap-3">
      <div className="grid gap-2 rounded-md border border-edge-subtle p-3">
        <span className="font-mono text-2xs text-ink-tertiary">size="full" — the default</span>
        <Button>Stop the session</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-edge-subtle p-3">
        <span className="font-mono text-2xs text-ink-tertiary">size="fit"</span>
        <Button size="fit" variant="ghost">Update all</Button>
        <Button size="fit">Ack</Button>
      </div>
    </div>
  ),
};

/** `fit` sets width and padding and NOTHING else — deliberately. Four of the
 *  six rules it replaces also set `flex: none` and two did not, so folding it
 *  in would have changed how those two shrink. A call site that needs it says
 *  so out loud, which is this banner row. */
export const FitInABannerRow: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-status-attention bg-status-attention-tint px-4 py-2">
      <span className="min-w-0 flex-1 font-ui text-sm text-status-attention-text">
        fleet: failed (last tried v0.0.84) — gate: unit not up
      </span>
      <Button size="fit" className="flex-none">Ack</Button>
    </div>
  ),
};
