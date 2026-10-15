import type { Meta, StoryObj } from '@storybook/react-vite';
import type { TaskNotification } from '../../../shared/api';
import { TaskCard } from './task-card';

const note = (over: Partial<TaskNotification> = {}): TaskNotification => ({
  summary: 'Reindexed the transcript store',
  status: 'completed',
  fields: [],
  ...over,
});

const meta = {
  title: 'Components/TaskCard',
  component: TaskCard,
  args: { notification: note() },
} satisfies Meta<typeof TaskCard>;
export default meta;

type Story = StoryObj<typeof meta>;

/** A finished task. CHECK the LEFT RULE: it is --accent, not --edge-strong,
 *  and that is the whole genus cue — phosphor means "the fleet did something",
 *  the mail card's quieter edge means "another session said something". A
 *  reader should know which kind of record this is before reading a word. */
export const Default: Story = {};

/** Failed. CHECK that the chip carries BOTH a word and a border colour: the
 *  status is never hue alone. */
export const Failed: Story = { args: { notification: note({ status: 'failed' }) } };

/** A status this code has never seen. CHECK that it renders AS WRITTEN, in the
 *  neutral tone — bucketing an unknown word into ok or bad would throw away the
 *  only fact the row carries, and guessing is exactly the wrong move on the
 *  status the card was not built for. */
export const UnknownStatus: Story = {
  args: { notification: note({ status: 'throttled' }) },
};

/** No status at all. CHECK that no chip renders — not an empty pill, not a
 *  dash. The card says only what the harness said. */
export const NoStatus: Story = { args: { notification: note({ status: null }) } };

/** No summary. CHECK that the card says "background task" rather than leaving
 *  an empty line: the head is the one row always on screen, and a blank there
 *  reads as a broken card rather than as a missing field. */
export const NoSummary: Story = { args: { notification: note({ summary: null }) } };

/** The machinery, folded. CHECK that the toggle reads "N more" while closed —
 *  a COUNT, so the reader knows what a tap costs — and that opening reveals a
 *  definition list where every value keeps its own name. CHECK too that
 *  `output-file` renders as a PATH and not as a link: nothing on this card
 *  fetches anything, and a tappable path would promise a fetch this surface
 *  does not have. */
export const WithFields: Story = {
  args: {
    notification: note({
      fields: [
        { name: 'task-id', value: 'bg_01HQ8X' },
        { name: 'output-file', value: '/home/you/.cc-clips/reindex-2026-10-02.log' },
        { name: 'duration', value: '4m 12s' },
      ],
    }),
  },
};

/** The long end of both axes. CHECK that the summary WRAPS while the status
 *  chip holds its place on the line (the chip is what must never be pushed
 *  out), and that a long field value scrolls inside its own 220px box rather
 *  than stretching the card down the screen. */
export const Overflow: Story = {
  args: {
    notification: note({
      summary:
        'Re-ran the whole-branch review lens over 41 commits and reconciled the deviation ledger against origin/main without merging, then rebuilt the dependency map',
      status: 'completed',
      fields: [
        { name: 'result', value: Array.from({ length: 24 }, (_, i) => `line ${i + 1}: ok`).join('\n') },
      ],
    }),
  },
};
