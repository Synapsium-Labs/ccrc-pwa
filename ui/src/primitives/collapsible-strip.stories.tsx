// The chrome on its own, which is the thing nothing pinned before: it was only
// ever visible through whichever domain strip happened to render it, so a
// change to the head reached the gate as a mail story or a task story and never
// as itself.
//
// Every story wears a REAL SKIN (`mail-strip`, imported below) rather than a
// made-up prefix. The component ships no CSS by design — it owns the shape and
// the consumer owns the look — so a story with an invented `part` would render
// unstyled boxes and prove nothing about how the shape actually reads.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CollapsibleStrip } from './collapsible-strip';
import '../components/mail-strip.css';

const meta = {
  title: 'Primitives/CollapsibleStrip',
  component: CollapsibleStrip,
  parameters: {
    docs: {
      description: {
        component:
          'A head that toggles, a count, an optional summary, and rows that exist only '
          + 'while open. Three strips are built from it — MailStrip, TaskStrip and the app’s '
          + 'HotFilesStrip. Class names arrive as props so each consumer keeps its own '
          + 'stylesheet; `root` is the section’s class and gains `--open`, `part` prefixes '
          + 'every inner class, because the two existing vocabularies disagree '
          + '(`mail-strip-head` vs `task-head`).',
      },
    },
  },
  args: { root: 'mail-strip', part: 'mail-strip', label: 'Mail' },
} satisfies Meta<typeof CollapsibleStrip>;
export default meta;

type Story = StoryObj<typeof meta>;

const rows = (
  <>
    <li className="mail-strip-row" data-state="queued">
      <span className="mail-strip-from">coordinator</span>
      <span className="mail-strip-kind">question</span>
      <span className="mail-strip-subject">Which wave owns the reviewer dispatch?</span>
    </li>
    <li className="mail-strip-row" data-state="delivered">
      <span className="mail-strip-from">acct-b-worker</span>
      <span className="mail-strip-kind">finding</span>
      <span className="mail-strip-subject">The done-fingerprint reads a stale tip</span>
    </li>
  </>
);

/** Shut, which is how all three strips open — the state the operator is
 *  actually in, and the reason a signal that matters has to live in the head. */
export const Collapsed: Story = {
  args: {
    mark: '✉',
    headline: 'Which wave owns the reviewer dispatch?',
    count: 2,
    summary: '1 question · 1 finding',
    children: rows,
  },
};

/** The rows are absent from the DOM while shut, not hidden with CSS, so they
 *  are off the accessibility tree and out of the tab order. Tap the head. */
export const WithRows: Story = { args: { ...Collapsed.args } };

/** A long headline ellipses rather than pushing the count and chevron out of
 *  the head — `${part}-headline` carries `flex: 1; min-width: 0`, and without
 *  the `min-width` a flex child refuses to shrink below its content. */
export const LongHeadline: Story = {
  args: {
    ...Collapsed.args,
    headline:
      'A subject long enough to need the ellipsis, because a head that grows instead '
      + 'pushes the count and the chevron off the right-hand edge',
  },
};

/** `marks` — the head slot for a signal that must be legible COLLAPSED.
 *  MailStrip puts `blocked` and `held n` here for exactly that reason. */
export const HeadMarks: Story = {
  args: {
    ...Collapsed.args,
    marks: (
      <>
        <span className="mail-strip-blocked-mark">blocked</span>
        <span className="mail-strip-held-mark">held 2</span>
      </>
    ),
  },
};

/** No count and no summary — HotFilesStrip's shape. Its headline already
 *  counts ("3 hot-file claims"), so a count beside it would say the same
 *  number twice, and it has no summary line at all. */
export const NoCountNoSummary: Story = {
  args: { mark: '✋', headline: '3 hot-file claims', children: rows },
};
