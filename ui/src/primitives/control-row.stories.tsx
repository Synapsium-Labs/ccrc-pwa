import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';
import { ControlRow } from './control-row';

const meta = {
  title: 'Primitives/ControlRow',
  component: ControlRow,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ControlRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** THE GROUND ARRIVES FROM OUTSIDE, which is the one thing to know about this
 *  component. It paints no background and sets no ink: three fleet rules keep
 *  those two declarations so `design/audit.mjs` can recover a ground for the
 *  nine descendant rules measured against them.
 *
 *  So every story here supplies the ground the app's stylesheet would — and
 *  CHECK the first thing a story can show that a test cannot: that the row
 *  without one is invisible rather than merely unstyled. */
export const WithItsGround: Story = {
  args: {
    className: 'bg-surface text-ink-secondary',
    children: (
      <>
        <span className="flex-none text-ink-tertiary" aria-hidden="true">◆</span>
        <span className="min-w-0 flex-1">dispatch is paused</span>
        <Button variant="quiet" size="fit" className="flex-none">Resume</Button>
      </>
    ),
  },
};

/** The same row with no ground. CHECK that this reads as a mistake: it is what
 *  a consumer gets for forgetting the two declarations, and it is why the
 *  `className` prop is required rather than optional. */
export const WithoutOne: Story = {
  args: {
    className: '',
    children: (
      <>
        <span className="min-w-0 flex-1">dispatch is paused</span>
        <Button variant="quiet" size="fit" className="flex-none">Resume</Button>
      </>
    ),
  },
};

/** It WRAPS, and that is load-bearing. An error or a note joins the row as a
 *  `flex-basis: 100%` child and takes a line of its own rather than squeezing
 *  the control. CHECK that the toggle keeps its full width and its tap floor
 *  while the sentence below it wraps. */
export const Wrapping: Story = {
  args: {
    className: 'bg-surface text-ink-secondary',
    children: (
      <>
        <span className="flex-none text-ink-tertiary" aria-hidden="true">◆</span>
        <span className="min-w-0 flex-1">cleanup is paused</span>
        <Button variant="quiet" size="fit" className="flex-none">Resume cleanup</Button>
        <p className="m-0 basis-full text-2xs text-status-attention-text">
          unconfirmed — the answer could not be read; reload to see what was stored
        </p>
      </>
    ),
  },
};

/** The dial: several labelled readouts and one commit, all on one row. CHECK
 *  the tap floor survives a row whose tallest child is a 11px readout — the
 *  floor is the ROW's, not the control's. */
export const ADialOfReadouts: Story = {
  args: {
    className: 'bg-surface text-ink-secondary',
    children: (
      <>
        <span>workers <b className="text-ink-primary">3</b><span className="text-ink-tertiary"> / 4</span></span>
        <span>per day <b className="text-ink-primary">11</b><span className="text-ink-tertiary"> / 20</span></span>
        <Button variant="quiet" size="fit" className="flex-none">save</Button>
      </>
    ),
  },
};
