import type { Meta, StoryObj } from '@storybook/react-vite';
import type { MailEnvelope } from '../../../shared/api';
import { MailCard } from './mail-card';

const envelope = (over: Partial<MailEnvelope> = {}): MailEnvelope => ({
  id: 1,
  fromId: 'coordinator',
  toId: 'acct-a-ccrc',
  kind: 'status',
  subject: 'wave-brief',
  runId: 5,
  program: 'build4',
  wave: 4,
  waveOf: 4,
  artifacts: [],
  body: '',
  ...over,
});

const meta = {
  title: 'Components/MailCard',
  component: MailCard,
  args: { envelope: envelope() },
} satisfies Meta<typeof MailCard>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Agent-to-agent mail, attributed. CHECK that BOTH ends are named — sender,
 *  arrow, recipient — because "who said this to whom" is exactly the fact the
 *  old rendering destroyed by filing the machine's words under the operator's
 *  name. CHECK too that the card GOES STILL: no glow, no animation, no
 *  box-shadow. A mail card is a record of something that was said, not a living
 *  pane, and a test scans every `.mail-card` rule to keep it that way. */
export const Default: Story = {};

/** Mail that belongs to no run. CHECK that NO run row renders — not "run —",
 *  not an empty span. A mail with no run is an ordinary message between two
 *  sessions, and saying "run —" about it would be inventing a fact. */
export const NoRun: Story = {
  args: { envelope: envelope({ runId: null, program: null, wave: null, waveOf: null }) },
};

/** Each clause of the run label is independently optional. CHECK that the row
 *  reads "run 12" alone here — the program and the wave are absent, and the
 *  label degrades clause by clause rather than all-or-nothing. */
export const RunWithoutProgram: Story = {
  args: { envelope: envelope({ runId: 12, program: null, wave: null, waveOf: null }) },
};

/** Artifacts. CHECK that every path renders as TEXT and that none of them is a
 *  link: nothing on this card fetches anything, and a tappable path would
 *  promise a fetch this surface does not have. Paths, never payloads. */
export const WithArtifacts: Story = {
  args: {
    envelope: envelope({
      kind: 'artifact',
      subject: 'wave-4 review report',
      artifacts: [
        'docs/superpowers/plans/2026-10-02-composite-migration.md',
        'docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md',
      ],
    }),
  },
};

/** A body. CHECK that line structure survives (it is a <pre>, so the machine's
 *  own wrapping is what you read) and that long lines WRAP rather than forcing
 *  the card sideways.
 *
 *  KNOWN GAP IN THIS STORY: the body's base `.well` surface is still defined in
 *  the app's chat.css — it is shared with two components that did not migrate —
 *  so here it renders without the well's dark ground. In the app it is welled. */
export const WithBody: Story = {
  args: {
    envelope: envelope({
      kind: 'finding',
      subject: 'stale-tip on close',
      body: 'handoffCommit a1b2c3d does not match branchTip e4f5a6b.\nThe worker committed on a feature branch, not the workspace branch.',
    }),
  },
};

/** The long end of every field at once. CHECK that the sender, recipient and
 *  subject all WRAP (`overflow-wrap: anywhere`) instead of clipping: an id this
 *  card cannot show in full is an attribution it has failed to make. */
export const Overflow: Story = {
  args: {
    envelope: envelope({
      fromId: 'acct-e-crossrepo-programmes-wave-1-server-coordinator',
      toId: 'acct-b-crossrepo-programmes-wave-1-server-worker-03',
      subject:
        'parkSupersededDeliveries extraction is its own departure from the brief and needs its own deviation number',
      artifacts: ['server/src/coord/store.ts'],
    }),
  },
};
