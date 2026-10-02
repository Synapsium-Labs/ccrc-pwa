import type { Meta, StoryObj } from '@storybook/react-vite';
import type { MailSummary } from '../../../shared/api';
import { MAIL_GATE_HELD_COUNT, MAIL_GATE_HELD_MS } from '../../../shared/api';
import { MailStrip } from './mail-strip';

/** A fixed epoch, passed to every story as `now`. The strip takes `now` as a
 *  prop precisely so three threshold comparisons are reproducible, and a
 *  screenshot run needs that even more than a test does. */
const NOW = Date.parse('2026-10-02T14:00:00.000Z');

const mail = (over: Partial<MailSummary> & { id: number }): MailSummary => ({
  deliveryId: over.id,
  toId: 'acct-a-ccrc',
  runId: 5,
  // Every optional-looking field is spelled out: `MailSummary` declares the
  // absent cases as explicit `| null`, which is the wire's absence-permits rule
  // showing through — a fixture that left them off would be testing a shape the
  // server never sends.
  lastError: null,
  lastGate: null,
  gateSince: null,
  gateCount: 0,
  gateAt: null,
  fromId: 'coordinator',
  kind: 'question',
  subject: 'which branch holds wave 4?',
  artifacts: [],
  state: 'queued',
  attempts: 1,
  at: NOW - 60_000,
  ...over,
});

const meta = {
  title: 'Components/MailStrip',
  component: MailStrip,
  args: { now: NOW, mail: [mail({ id: 1 })] },
} satisfies Meta<typeof MailStrip>;
export default meta;

type Story = StoryObj<typeof meta>;

/** One outstanding message, collapsed — which is how the strip OPENS. CHECK
 *  that the headline is the NEWEST subject and that the count sits beside it;
 *  the rows are one tap away and cost chat height until asked for. */
export const Default: Story = {};

/** Empty. CHECK that NOTHING renders. An ordinary conversation must not pay a
 *  row for a feature it is not using. */
export const Empty: Story = { args: { mail: [] } };

/** Several kinds. CHECK the summary line pluralises per kind and DROPS
 *  zero-count clauses ("1 question · 2 findings", never "0 answers"). */
export const ManyKinds: Story = {
  args: {
    mail: [
      mail({ id: 1, kind: 'question' }),
      mail({ id: 2, kind: 'finding', subject: 'stale-tip on close' }),
      mail({ id: 3, kind: 'finding', subject: 'cap counts awaiting-review' }),
      mail({ id: 4, kind: 'status', subject: 'wave 4 dispatched' }),
    ],
  },
};

/** Blocked: the lane is still retrying, but the box already holds unsent text.
 *  CHECK that the COLLAPSED head carries a `blocked` mark — the strip opens
 *  closed, so a flag that only exists in the expanded rows is invisible in the
 *  state the operator is actually in. CHECK the row names the attempt AND the
 *  ceiling ("attempt 3 of 6"): without the ceiling you cannot tell a first
 *  hiccup from the last attempt. */
export const Blocked: Story = {
  args: {
    mail: [mail({ id: 1, state: 'queued', attempts: 3, lastError: 'draft-present' })],
  },
};

/** Held at a gate. CHECK the line is a DESCRIPTION with no word in it that
 *  calls the state a failure — three hours at `not-idle` on a session running a
 *  long suite is fine, three hours at `no-pane` is not, and the console cannot
 *  tell them apart. CHECK too that the head's mark is a COUNT, not a reason:
 *  there may be more than one gate, and promoting one would be the console
 *  choosing which of two true things to say. */
export const Held: Story = {
  args: {
    mail: [
      mail({
        id: 1,
        state: 'queued',
        lastGate: 'not-idle',
        gateSince: NOW - MAIL_GATE_HELD_MS - 60_000,
        gateCount: MAIL_GATE_HELD_COUNT,
        gateAt: NOW - 5_000,
      }),
    ],
  },
};

/** A gate this client has never heard of — an older console against a newer
 *  server, which is an ordinary state on this fleet. CHECK that the RAW token
 *  renders rather than a blank: the wire is additive and absence-permits, and a
 *  blank where a reason belongs is the silence this whole line was written
 *  against. */
export const UnknownGate: Story = {
  args: {
    mail: [
      mail({
        id: 1,
        state: 'queued',
        lastGate: 'some-gate-from-the-future' as MailSummary['lastGate'],
        gateSince: NOW - MAIL_GATE_HELD_MS - 60_000,
        gateCount: MAIL_GATE_HELD_COUNT,
        gateAt: NOW - 5_000,
      }),
    ],
  },
};

/** Abandoned. CHECK that a `rejected` delivery reads as TERMINAL ("undeliverable
 *  — act on it directly") and never as an ordinary pending message: a
 *  coordinator that mistakes one for the other waits for a reply the lane has
 *  already stopped attempting. */
export const Abandoned: Story = {
  args: { mail: [mail({ id: 1, state: 'rejected', attempts: 6, lastError: 'draft-present' })] },
};

/** All three status arms at once, plus a clean row. CHECK THE PRECEDENCE: one
 *  status line per row, `abandoned` over `held` over `blocked`. The row at the
 *  bottom carries BOTH a stale `draft-present` and a fresh gate — it must print
 *  the GATE, because `lastError` has no clock and a fresh gate proves no send
 *  was attempted this sweep. */
export const EveryArm: Story = {
  parameters: { layout: 'padded' },
  args: {
    mail: [
      mail({ id: 1, subject: 'clean row', state: 'queued' }),
      mail({ id: 2, subject: 'abandoned', state: 'rejected', attempts: 6 }),
      mail({ id: 3, subject: 'blocked', state: 'queued', attempts: 3, lastError: 'draft-present' }),
      mail({
        id: 4,
        subject: 'stale error, fresh gate',
        state: 'queued',
        attempts: 1,
        lastError: 'draft-present',
        lastGate: 'tmux-gone',
        gateSince: NOW - MAIL_GATE_HELD_MS - 600_000,
        gateCount: MAIL_GATE_HELD_COUNT + 2,
        gateAt: NOW - 2_000,
      }),
    ],
  },
};

/** Artifacts and overflow. CHECK that paths render as PATHS and nothing on the
 *  row is tappable to fetch one, and that a long subject wraps rather than
 *  pushing the count and chevron off the head. */
export const WithArtifacts: Story = {
  args: {
    mail: [
      mail({
        id: 1,
        kind: 'artifact',
        subject:
          'the whole-branch review report for wave 4, including the deviation ledger reconciliation against origin/main',
        artifacts: [
          'docs/superpowers/plans/2026-10-02-composite-migration.md',
          'ui/src/components/mail-strip.css',
        ],
      }),
    ],
  },
};
