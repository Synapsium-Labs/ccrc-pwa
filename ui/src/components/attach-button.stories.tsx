import type { Meta, StoryObj } from '@storybook/react-vite';
import { AttachButton } from './attach-button';

const meta = {
  title: 'Components/AttachButton',
  component: AttachButton,
  args: { onPick: () => {} },
} satisfies Meta<typeof AttachButton>;
export default meta;

type Story = StoryObj<typeof meta>;

/** The resting trigger. CHECK that it is a 44px circle — it sits beside the
 *  send button in the composer and is the one control in that row a thumb
 *  reaches for without looking, so it owes the tap floor even though the glyph
 *  inside it is small. */
export const Default: Story = {};

/** Dead session: the whole composer is read-only. CHECK that the glyph drops to
 *  --ink-disabled and the press transform is gone — a disabled control must not
 *  answer a tap with motion, which reads as "it did something". */
export const Disabled: Story = { args: { disabled: true } };

/** The upload ring. CHECK two things: the ring is INDETERMINATE (it reports
 *  that work is happening, never how much — nothing here knows a percentage),
 *  and the glyph turns --accent so the button reads as live rather than merely
 *  decorated. The state is driven by `aria-busy` on the button, so a screen
 *  reader hears it too.
 *
 *  Rendered through a plain <button> rather than the component: `AttachButton`
 *  is stateless and never sets `aria-busy` itself — the upload pipeline moved
 *  to the composer's `useStagedImages` — but the rule is the component's and
 *  ships with it, so the story draws what the stylesheet still paints. */
export const Uploading: Story = {
  render: () => (
    <button type="button" className="attach-btn" aria-busy="true" aria-label="Attach an image">
      <span aria-hidden="true">+</span>
    </button>
  ),
};

/** All three at once, on the composer's own row rhythm. CHECK that resting and
 *  busy are separable with the hue removed: the ring is a SHAPE, not a colour,
 *  which is what keeps the state legible to a viewer who cannot see --accent. */
export const States: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="flex items-center gap-4">
      <AttachButton onPick={() => {}} />
      <AttachButton onPick={() => {}} disabled />
      <button type="button" className="attach-btn" aria-busy="true" aria-label="Attach an image">
        <span aria-hidden="true">+</span>
      </button>
    </div>
  ),
};
