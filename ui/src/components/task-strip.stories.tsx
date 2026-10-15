import type { Meta, StoryObj } from '@storybook/react-vite';
import type { TaskItem } from '../../../shared/api';
import { TaskStrip } from './task-strip';

const task = (over: Partial<TaskItem> & { id: string }): TaskItem => ({
  subject: 'Wire the dispatch cap',
  activeForm: 'Wiring the dispatch cap',
  description: '',
  status: 'pending',
  ...over,
});

const PLAN: TaskItem[] = [
  task({ id: '1', subject: 'Read the plan', activeForm: 'Reading the plan', status: 'completed' }),
  task({ id: '2', subject: 'Move the stylesheet', activeForm: 'Moving the stylesheet', status: 'completed' }),
  task({
    id: '3',
    subject: 'Wire the dispatch cap',
    activeForm: 'Wiring the dispatch cap',
    status: 'in_progress',
    description: 'ACTIVE_RUN_STATES only — a run at awaiting-review holds no slot.',
  }),
  task({ id: '4', subject: 'Re-run the gate', activeForm: 'Re-running the gate' }),
  task({ id: '5', subject: 'Report back', activeForm: 'Reporting back' }),
];

const meta = {
  title: 'Components/TaskStrip',
  component: TaskStrip,
  args: { tasks: PLAN },
} satisfies Meta<typeof TaskStrip>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Collapsed, which is how it OPENS. CHECK that the headline is the running
 *  task's `activeForm` ("Wiring the…", the sentence the spinner wears) and not
 *  its subject, and that the counts read `2/5` beside it. The strip sits
 *  directly above the composer, so one live line is all it may spend until the
 *  reader asks for more. */
export const Default: Story = {};

/** Empty. CHECK that NOTHING renders. An ordinary conversation must not pay a
 *  row of chat height for a plan that does not exist, so the strip returns null
 *  rather than collapsing to a thin bar. */
export const Empty: Story = { args: { tasks: [] } };

/** Nothing running. CHECK that the headline falls back to "Tasks" and that the
 *  asterisk stops breathing — the mark only animates while something is
 *  actually in flight, which is what makes the motion mean anything. */
export const NothingRunning: Story = {
  args: { tasks: PLAN.filter((t) => t.status !== 'in_progress') },
};

/** Everything done. CHECK the summary line drops the zero-count clauses
 *  entirely ("5 ✓", never "0 running · 0 left · 5 ✓") — a zero is a clause the
 *  reader has to parse to discover it says nothing. */
export const AllComplete: Story = {
  args: { tasks: PLAN.map((t) => ({ ...t, status: 'completed' as const })) },
};

/** A plan with a long tail of finished work. CHECK that completed rows do NOT
 *  render by default: they fold behind "… +N completed", because what is left
 *  is the news and what is done is the receipt. Expand the strip to see it. */
export const ManyCompleted: Story = {
  args: {
    tasks: [
      ...Array.from({ length: 11 }, (_, i) =>
        task({ id: String(i + 1), subject: `Task ${i + 1}`, activeForm: `Doing task ${i + 1}`, status: 'completed' }),
      ),
      task({ id: '12', subject: 'The one still running', activeForm: 'Running the last one', status: 'in_progress' }),
    ],
  },
};

/** Rows with and without a description. CHECK that a row with no description is
 *  a DISABLED button, not a live one that does nothing on tap — the only reason
 *  a row is a button at all is to reveal detail, so a row with no detail must
 *  not invite the tap. */
export const MixedDetail: Story = {
  args: {
    tasks: [
      task({ id: '1', subject: 'Has detail', activeForm: 'Doing it', status: 'in_progress', description: 'The reasoning lives here.' }),
      task({ id: '2', subject: 'No detail at all', activeForm: 'Doing it' }),
    ],
  },
};

/** Overflow. CHECK that a long subject wraps inside the row rather than pushing
 *  the count and chevron off the head, and that a long OPEN plan scrolls inside
 *  the strip instead of pushing the chat off screen — the cap is the whole
 *  reason the strip may live above the composer. */
export const Overflow: Story = {
  args: {
    tasks: Array.from({ length: 14 }, (_, i) =>
      task({
        id: String(i + 1),
        subject: `Reconcile the deviation ledger against origin/main without merging, step ${i + 1}`,
        activeForm: `Reconciling the deviation ledger, step ${i + 1}`,
        status: i === 0 ? 'in_progress' : 'pending',
      }),
    ),
  },
};
