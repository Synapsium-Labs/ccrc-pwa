import type { Meta, StoryObj } from '@storybook/react-vite';
import { AttachTray, type StagedImage } from './attach-tray';

/** A 1×1 PNG, inlined so a story never waits on the network and never shows a
 *  broken-image box in a screenshot run. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const chip = (over: Partial<StagedImage>): StagedImage => ({
  key: 'k1',
  file: new File([], 'screenshot.png', { type: 'image/png' }),
  previewUrl: PIXEL,
  state: 'staged',
  width: 1280,
  height: 720,
  ...over,
});

const meta = {
  title: 'Components/AttachTray',
  component: AttachTray,
  args: { onRemove: () => {}, onRetry: () => {}, images: [chip({})] },
} satisfies Meta<typeof AttachTray>;
export default meta;

type Story = StoryObj<typeof meta>;

/** One staged image. CHECK that the strip under the thumbnail reads the
 *  PIXEL DIMENSIONS and not the filename: the tray is the whole confirmation
 *  that an image is attached (the old success toast was removed for landing on
 *  top of the input it told you to type into), and the size is what tells the
 *  reader the right screenshot was picked. */
export const Default: Story = {};

/** Empty. CHECK that NOTHING renders — not an empty list, not a placeholder
 *  row. An ordinary message must not pay a row of chat height for a feature it
 *  is not using, so the tray returns null rather than collapsing by CSS. */
export const Empty: Story = { args: { images: [] } };

/** Uploading. CHECK three things at once: the thumbnail dims to 0.55, an
 *  indeterminate ring turns over it, and the strip says "uploading…" instead of
 *  a size — the dimensions are not known until the upload answers, and printing
 *  a guess would be the console inventing a fact. */
export const Uploading: Story = {
  args: { images: [chip({ state: 'uploading' })] },
};

/** Failed. CHECK that the chip's border turns --status-dead AND that the strip
 *  becomes a `retry` BUTTON — the state is carried by two cues, not by hue
 *  alone. CHECK also that the thumbnail itself is inert: whole-media retry used
 *  to overlap the remove button's hit area with no way to tell them apart, so
 *  retry is the strip and only the strip. The failure reason rides the chip's
 *  `title`, which is the only place it survives after the toast has gone. */
export const Failed: Story = {
  args: { images: [chip({ state: 'failed', error: 'upload rejected: image too large' })] },
};

/** The cap, every state side by side. CHECK that the three states are separable
 *  with the hue removed (ring / strip text / retry button), and that the row
 *  scrolls sideways rather than wrapping — the tray sits directly above the
 *  input bar and a second row would push the composer off a phone screen. */
export const AllStates: Story = {
  parameters: { layout: 'padded' },
  args: {
    images: [
      chip({ key: 'a', state: 'staged' }),
      chip({ key: 'b', state: 'uploading' }),
      chip({ key: 'c', state: 'failed', error: "couldn't reach the server" }),
      chip({ key: 'd', state: 'staged', width: 390, height: 844 }),
    ],
  },
};

/** A staged image whose dimensions never came back. CHECK that the strip is
 *  BLANK rather than reading "undefined×undefined" or "0×0" — absence of a
 *  measurement is not a measurement of zero. */
export const NoDimensions: Story = {
  args: { images: [chip({ width: undefined, height: undefined })] },
};
