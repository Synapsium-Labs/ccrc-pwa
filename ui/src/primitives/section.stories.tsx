// Section (D-5102; its slots D-5666): a titled card on a scaffolded page.
// Switch the skin: Refined draws the scope as an eyebrow above the title;
// Instrument as a mono tag at the head's right, through one token,
// `--section-flow`.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Section } from './section';

const meta = {
  title: 'Primitives/Section',
  component: Section,
  parameters: {
    docs: {
      description: {
        component:
          'The head (scope, title, purpose) and a hairline card on `--bg-surface` at `--pad-card`, '
          + '`--r-lg` and `--elev-card`. The title reads the section type roles.',
      },
    },
  },
  args: {
    scope: 'This device',
    title: 'Appearance',
    purpose: 'How ccrc looks on this screen.',
    children: <p className="m-0 text-ink-primary">Layout, theme and the fonts line.</p>,
  },
} satisfies Meta<typeof Section>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** No scope: the title alone heads the card. */
export const TitleOnly: Story = { args: { scope: undefined, purpose: undefined } };

/** No head at all: an unnamed card on the page. */
export const CardOnly: Story = { args: { scope: undefined, title: undefined, purpose: undefined } };

/** A long title and scope wrap rather than clip, at every width. */
export const Long: Story = {
  args: {
    scope: 'Whole fleet, every node',
    title: 'Temp root collector and the cleanup pause it honours',
    purpose: 'A sentence long enough to wrap on a phone, so the purpose line is seen at two lines.',
  },
};
