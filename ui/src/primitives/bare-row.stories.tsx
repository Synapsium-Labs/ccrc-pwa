import type { Meta, StoryObj } from '@storybook/react-vite';
import { BareRow } from './bare-row';

const meta = {
  title: 'Primitives/BareRow',
  component: BareRow,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof BareRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The fleet's footer, which is two of the five rules this replaced. CHECK
 *  that it reads as a line of text and NOT as a button: no fill, no border, no
 *  radius, no press. The only thing that says "pressable" is the pointer and
 *  the 44px it occupies, which is the whole design of a quiet door. */
export const AQuietFooter: Story = {
  args: {
    className: 'px-2 font-mono text-xs text-ink-tertiary',
    children: 'Archived on disk · 14 · 2.1 GB',
  },
};

/** A project card's disclosure — the same six declarations one font step down,
 *  with a chevron. CHECK the chevron does not move the text when it flips:
 *  both glyphs are one character in the same font. */
export const ADisclosure: Story = {
  args: {
    className: 'flex items-center gap-1 p-0 font-mono text-2xs text-ink-tertiary',
    'aria-expanded': false,
    children: (
      <>
        <span aria-hidden="true">▸</span>
        Archived (3)
      </>
    ),
  },
};

/** Disabled, which one of the five is: a card's Released fold refuses to
 *  collapse while the selected session is inside it. CHECK that only the
 *  cursor changes — none of the five dimmed its ink, because what is
 *  unavailable is the FOLD, not the text it is showing. */
export const Disabled: Story = {
  args: {
    disabled: true,
    className: 'flex items-center gap-1 p-0 font-mono text-2xs text-ink-tertiary',
    children: (
      <>
        <span aria-hidden="true">▾</span>
        Released (1)
      </>
    ),
  },
};

/** A strip head, which is where the sixth and seventh copies were hiding —
 *  `CollapsibleStrip` builds its head from this row now, so `.mail-strip-head`,
 *  `.task-head` and `.hotfiles-head` stopped spelling the same ten
 *  declarations in three stylesheets. CHECK it against the rows above: same
 *  six, plus a gap and a padding that make it a head rather than a line. */
export const AStripHead: Story = {
  args: {
    className: 'flex items-center gap-2 px-3 py-2 text-ink-primary',
    'aria-expanded': false,
    children: (
      <>
        <span className="flex-none font-mono text-sm leading-none text-ink-tertiary">✉</span>
        <span className="min-w-0 flex-1">Mail</span>
        <span className="flex-none font-mono text-2xs text-ink-tertiary">3</span>
        <span className="flex-none" aria-hidden="true">⌄</span>
      </>
    ),
  },
};
