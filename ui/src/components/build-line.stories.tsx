import type { Meta, StoryObj } from '@storybook/react-vite';
import type { FleetHealth, NodeWire } from '../../../shared/api';
import type { BuildInfo } from '../../../shared/buildinfo';
import { BuildLine } from './build-line';

const SHA = 'bd2bf57a' + '0'.repeat(32);

const stamp = (version?: string, dirty = false): BuildInfo => ({
  sha: SHA,
  ref: 'release',
  builtAt: '2026-09-18T00:00:00Z',
  dirty,
  ...(version ? { version } : {}),
});

/** A measured, reachable, stable-channel Linux node. Everything a story wants
 *  to show is an override on this one row — which is also the point: each
 *  state below is ONE field away from a line that says nothing at all. */
const node = (role: 'fleet' | 'server', current: BuildInfo | null, over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: role === 'fleet' ? '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10' : '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93',
  role,
  label: role,
  os: 'linux',
  current,
  stampRead: current === null ? 'absent' : 'ok',
  installState: 'complete',
  provenance: 'verified',
  caps: [],
  agentOps: role === 'fleet' ? [] : null,
  highestVersion: current?.version ?? null,
  previousVersion: null,
  measuredAt: 1_000,
  reachable: true,
  unreachableSince: null,
  channel: 'stable',
  desiredTag: current?.version ?? null,
  resolveDetail: null,
  request: null,
  report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});

const remote: FleetHealth = { mode: 'remote', connected: true, downSince: null, build: 'agreed' } as FleetHealth;

const meta = {
  title: 'Components/BuildLine',
  component: BuildLine,
  parameters: { layout: 'padded' },
  args: {
    health: remote,
    nodes: [node('fleet', stamp('v0.0.7')), node('server', stamp('v0.0.7'))],
  },
} satisfies Meta<typeof BuildLine>;
export default meta;

type Story = StoryObj<typeof meta>;

/** The resting state, and the one a healthy fleet is in: both boxes on the
 *  same tagged release, the whole line in the quietest ink the palette has.
 *  Check that nothing here draws the eye — this line sits at the foot of every
 *  fleet screen, so anything louder than this would be shouting all day. */
export const Agreed: Story = {};

/** The three ways a side goes amber, side by side with a calm one for scale.
 *
 *  Check that every amber side is legible as PROSE first and coloured second:
 *  "unversioned (bd2bf57a)" and "dirty" each say what is wrong without the
 *  colour, which is the two-signal rule. The colour is only the reason your eye
 *  lands there — a `deploy.sh` box should LOOK second-class without a banner
 *  firing when nothing is actually broken. */
export const AmberSides: Story = {
  render: () => (
    <dl className="grid grid-cols-[14rem_1fr] items-baseline gap-x-6 gap-y-3 font-mono text-sm">
      <dt className="text-ink-tertiary">untagged build</dt>
      <dd>
        <BuildLine health={remote} nodes={[node('fleet', stamp()), node('server', stamp('v0.0.7'))]} />
      </dd>
      <dt className="text-ink-tertiary">working tree, dirty</dt>
      <dd>
        <BuildLine
          health={remote}
          nodes={[node('fleet', stamp('v0.0.7')), node('server', stamp('v0.0.9', true))]}
        />
      </dd>
      <dt className="text-ink-tertiary">stamp did not read</dt>
      <dd>
        <BuildLine health={remote} nodes={[node('fleet', null), node('server', stamp('v0.0.7'))]} />
      </dd>
    </dl>
  ),
};

/** No version to state at all — the shape before `GET /api/updates` has ever
 *  answered, and for as long as it cannot be read.
 *
 *  Check that the line still STANDS. Hiding it would take "what each box runs"
 *  off the phone at exactly the moment the update plane is unreadable; a dash
 *  claims no version, which is a different statement from a stale one. */
export const Unmeasured: Story = { args: { nodes: null } };

/** An unreachable node, whose cached stamp is still on the row.
 *
 *  Check that the fleet side reads `—` and NOT `v0.0.7`, even though the row
 *  carries that version: `markUnreachable` keeps the last measurement, and
 *  rendering it here would state a stale reading as present-tense fact. The
 *  reachable server side beside it is the control. */
export const UnreachableStatesNothing: Story = {
  args: {
    nodes: [
      node('fleet', stamp('v0.0.7'), { reachable: false, unreachableSince: 1_000, desiredTag: 'v0.0.9' }),
      node('server', stamp('v0.0.7'), { desiredTag: 'v0.0.9' }),
    ],
  },
};

/** The `→ vX` affix: a side whose node the inventory says should move up.
 *
 *  Check three things. It is PER SIDE, never per line — here only the fleet box
 *  is behind. It is amber for "something to do", not red for "something is
 *  broken". And the comparison is semver, not string order, which is why
 *  `v0.0.9 → v0.0.10` below points forwards rather than backwards. */
export const UpgradeAffix: Story = {
  render: () => (
    <dl className="grid grid-cols-[14rem_1fr] items-baseline gap-x-6 gap-y-3 font-mono text-sm">
      <dt className="text-ink-tertiary">one side behind</dt>
      <dd>
        <BuildLine
          health={remote}
          nodes={[
            node('fleet', stamp('v0.0.7'), { desiredTag: 'v0.0.9' }),
            node('server', stamp('v0.0.9')),
          ]}
        />
      </dd>
      <dt className="text-ink-tertiary">both behind</dt>
      <dd>
        <BuildLine
          health={remote}
          nodes={[
            node('fleet', stamp('v0.0.7'), { desiredTag: 'v0.0.9' }),
            node('server', stamp('v0.0.7'), { desiredTag: 'v0.0.9' }),
          ]}
        />
      </dd>
      <dt className="text-ink-tertiary">semver, not strings</dt>
      <dd>
        <BuildLine
          health={remote}
          nodes={[
            node('fleet', stamp('v0.0.9'), { desiredTag: 'v0.0.10' }),
            node('server', stamp('v0.0.9'), { desiredTag: 'v0.0.10' }),
          ]}
        />
      </dd>
    </dl>
  ),
};

/** Nothing at all. A local-mode fleet has one box, so there are no two sides to
 *  compare and the line does not exist.
 *
 *  Check that the canvas below is EMPTY — the frame is drawn only so that
 *  "renders nothing" is visibly a state rather than a broken story. */
export const LocalModeRendersNothing: Story = {
  render: () => (
    <div className="rounded-md border border-dashed border-edge-subtle p-4">
      <BuildLine
        health={{ mode: 'local', connected: true, downSince: null, build: 'agreed' } as FleetHealth}
        nodes={[node('fleet', stamp('v0.0.7')), node('server', stamp('v0.0.9'))]}
      />
    </div>
  ),
};
