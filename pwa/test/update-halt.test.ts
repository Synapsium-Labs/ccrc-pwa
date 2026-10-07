// updateHalt.ts (centralised-update programme wave 14, R15): who halts the fleet, what Update all says while a node
// does, and which remedy the skew banner names. Pure reads of one /api/updates answer.
import { describe, expect, it } from 'vitest';
import type { NodeWire, UpdateIntentWire } from '../../shared/api';
import { FLEET_SCOPE, UPDATE_STATES } from '../../shared/api';
import { isHaltingUpdate } from '../../shared/update-move';
import {
  autoWouldMove, consoleCanMove, haltLine, haltingNodes, skewHaltLead, skewRemedy, updateAllHaltedText,
} from '../src/fleet/updateHalt';

const FLEET_ID = '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10';
const SERVER_ID = '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93';
/** A measured, reachable Linux fleet node the console can move: `detach` in its caps, an agent that lists the op. */
const node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: FLEET_ID, role: 'fleet', label: 'fleet', os: 'linux',
  current: null, stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['detach', 'update-gate'], agentOps: ['update'], highestVersion: 'v0.0.7', previousVersion: null,
  measuredAt: 1, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const server = (over: Partial<NodeWire> = {}): NodeWire =>
  node({ nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null, ...over });
const lease = (state: string, detail: string | null = null, target: string | null = 'v0.0.9'): NodeWire['update'] =>
  ({ state, target, startedAt: null, detail } as NodeWire['update']);
const intent = (auto: string, scope = FLEET_SCOPE): UpdateIntentWire =>
  ({ scope, channel: 'stable', pinnedTag: null, auto, notify: 'off', setAt: 1, setBy: 'pwa' } as UpdateIntentWire);

describe('haltingNodes — the dispatcher\'s own rule, from L0', () => {
  it('agrees with isHaltingUpdate over every lease state and a spread of details', () => {
    const details: (string | null)[] = [null, '', 'gate: unit not up', 'provenance:', 'provenance: unsigned', 'Provenance: x',
      ' provenance: x', 'x provenance: y'];
    for (const state of [...UPDATE_STATES, 'a-word-this-build-cannot-name']) {
      for (const detail of details) {
        const n = node({ update: lease(state, detail) });
        expect(haltingNodes([n]).length === 1, `${state} / ${JSON.stringify(detail)}`).toBe(isHaltingUpdate(state, detail));
      }
    }
  });

  it('failed and reverted halt; a provenance verdict, idle and every busy state do not', () => {
    expect(haltingNodes([node({ update: lease('failed', 'gate: unit not up') })])).toHaveLength(1);
    expect(haltingNodes([node({ update: lease('reverted') })])).toHaveLength(1);
    expect(haltingNodes([node({ update: lease('failed', 'provenance: signature does not verify') })])).toEqual([]);
    for (const s of ['idle', 'pending', 'applying', 'unknown']) expect(haltingNodes([node({ update: lease(s) })]), s).toEqual([]);
  });

  it('keeps inventory order, and reads a malformed lease as not halting rather than throwing', () => {
    const a = server({ update: lease('reverted') });
    const b = node({ update: lease('failed', 'x') });
    expect(haltingNodes([a, b]).map((n) => n.label)).toEqual(['server', 'fleet']);
    const broken = [{ ...node(), update: undefined }, { ...node(), update: null }, { ...node(), update: { state: 7, detail: 1 } }];
    expect(haltingNodes(broken as unknown as NodeWire[])).toEqual([]);
    expect(haltingNodes(null)).toEqual([]);
    expect(haltingNodes(undefined)).toEqual([]);
  });

  it('a failed row whose detail is not a string still halts — the server\'s NULL detail', () => {
    expect(haltingNodes([{ ...node(), update: { state: 'failed', target: null, startedAt: null, detail: 3 } } as unknown as NodeWire]))
      .toHaveLength(1);
  });
});

describe('haltLine and the Update all reason', () => {
  it('names the node, its state, its target and its detail, and leaves out what the lease does not carry', () => {
    expect(haltLine(node({ update: lease('failed', 'gate: unit not up') }))).toBe('fleet: failed (last tried v0.0.9) — gate: unit not up');
    expect(haltLine(node({ update: lease('reverted') })), 'a settled lease is never said as moving').toBe('fleet: reverted (last tried v0.0.9)');
    expect(haltLine(node({ update: lease('reverted', null, null) }))).toBe('fleet: reverted');
    expect(haltLine(node({ update: lease('reverted', '', '') }))).toBe('fleet: reverted');
  });

  it('Update all\'s reason names who halts and the Ack that clears it, and promises no move after it', () => {
    expect(updateAllHaltedText([node()]))
      .toBe('Update all waits: nothing moves until fleet is acknowledged — tap Ack on it in the halt banner.');
    expect(updateAllHaltedText([node(), server()]))
      .toBe('Update all waits: nothing moves until fleet, server are acknowledged — tap Ack on each in the halt banner.');
    expect(skewHaltLead([node()])).toBe('Nothing moves until fleet is acknowledged — tap Ack on it in the halt banner');
  });
});

describe('consoleCanMove — moveRefusal\'s capability clauses, from L0', () => {
  it('a reachable Linux node with detach and an agent that lists the op, or the server\'s own agentless row', () => {
    expect(consoleCanMove(node())).toBe(true);
    expect(consoleCanMove(server())).toBe(true);
  });

  it.each([
    ['macOS (decision 17)', { os: 'darwin' }],
    ['unreachable', { reachable: false }],
    ['no detach in its caps (no-detach-cap)', { caps: ['update-gate'] }],
    ['an agent that does not list the op (agent-predates-update-op)', { agentOps: [] }],
  ] as const)('not when %s', (_what, over) => {
    expect(consoleCanMove(node(over as Partial<NodeWire>))).toBe(false);
  });

  it('a wire field that is not the type it should be reads as not movable, never as a throw', () => {
    expect(consoleCanMove({ ...node(), caps: undefined } as unknown as NodeWire)).toBe(false);
    expect(consoleCanMove({ ...node(), agentOps: undefined } as unknown as NodeWire)).toBe(false);
    expect(consoleCanMove({ ...node(), reachable: undefined } as unknown as NodeWire)).toBe(false);
  });
});

describe('autoWouldMove — the dispatcher\'s auto path, from L0', () => {
  it('a movable node with the health gate, a channel auto permits and a tag to move to', () => {
    expect(autoWouldMove(node(), 'stable')).toBe(true);
    expect(autoWouldMove(node(), 'channel')).toBe(true);
  });

  it.each([
    ['auto off', node(), 'off'],
    ['auto stable on a node resolved to dev (autoPermits)', node({ channel: 'dev' }), 'stable'],
    ['an unresolved channel', node({ channel: null }), 'channel'],
    ['no update-gate in its caps (no-update-gate)', node({ caps: ['detach'] }), 'channel'],
    ['no tag to move to (a converged row)', node({ desiredTag: null }), 'channel'],
    ['a node the console cannot move', node({ reachable: false }), 'channel'],
    ['a stamp that did not read (stamp-unread)', node({ stampRead: 'unreadable' }), 'channel'],
    ['a running version that is not a release tag (stamp-unread)',
      node({ current: { sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-10-05T12:00:00Z', dirty: false, version: 'main' } }), 'channel'],
  ] as const)('not with %s', (_what, n, auto) => {
    expect(autoWouldMove(n as NodeWire, auto)).toBe(false);
  });

  it('a channel word this build cannot name reads as unresolved, never as a throw', () => {
    expect(autoWouldMove({ ...node(), channel: 'nightly' } as unknown as NodeWire, 'channel')).toBe(false);
  });

  it('a stampRead that is not a string reads as unread, never as a throw (D-4270)', () => {
    expect(autoWouldMove({ ...node(), stampRead: undefined } as unknown as NodeWire, 'channel')).toBe(false);
  });

  it('a stamp that read a release tag, or read no version, is not unread (D-4270)', () => {
    const current = (version: string) => ({ sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-10-05T12:00:00Z', dirty: false, version });
    expect(autoWouldMove(node({ current: current('v0.0.8') }), 'channel')).toBe(true);
    expect(autoWouldMove(node({ current: null }), 'channel')).toBe(true);
  });
});

describe('skewRemedy — what the skew banner advises (R15(c))', () => {
  const movable = [node(), server()];
  const at = (version: string) => ({ sha: 'c'.repeat(40), ref: 'main', builtAt: '2026-10-05T12:00:00Z', dirty: false, version });
  it('a halt outranks everything, auto on or off, and says what happens after the ack', () => {
    const halted = [node({ update: lease('failed', 'x') }), server()];
    expect(skewRemedy(halted, [intent('channel')])).toEqual({ kind: 'halt', halting: [halted[0]], then: 'auto' });
    expect(skewRemedy(halted, [])).toEqual({ kind: 'halt', halting: [halted[0]], then: 'cli' });
    expect(skewRemedy(halted, [intent('off')])).toEqual({ kind: 'halt', halting: [halted[0]], then: 'cli' });
    const stuck = [node({ update: lease('failed', 'x'), caps: [] }), server({ caps: [] })];
    expect(skewRemedy(stuck, [intent('channel')]), 'the console cannot move them after the ack either')
      .toEqual({ kind: 'halt', halting: [stuck[0]], then: 'cli' });
    const unread = [node({ update: lease('failed', 'x') }), server({ stampRead: 'unreadable' })];
    expect(skewRemedy(unread, [intent('channel')]), 'a stamp that did not read is refused after the ack too (D-4270)')
      .toEqual({ kind: 'halt', halting: [unread[0]], then: 'cli' });
    const rolledBack = [node({ desiredTag: null, current: at('v0.0.7'), update: lease('reverted') }), server({ desiredTag: 'v0.0.10', current: at('v0.0.9') })];
    expect(skewRemedy(rolledBack, [intent('channel')]), 'auto would move the leader after the ack, not the lagging box (D-4271)')
      .toEqual({ kind: 'halt', halting: [rolledBack[0]], then: 'cli' });
  });

  it('auto on (stable or channel) and every node movable: the console\'s own move', () => {
    expect(skewRemedy(movable, [intent('stable')])).toEqual({ kind: 'auto' });
    expect(skewRemedy(movable, [intent('channel')])).toEqual({ kind: 'auto' });
  });

  it.each([
    ['auto off', movable, [intent('off')]],
    ['no fleet intent row', movable, []],
    ['only a per-node row (the PWA reads the fleet row, as Settings does)', movable, [intent('channel', FLEET_ID)]],
    ['an auto word this build cannot name', movable, [intent('nightly')]],
    ['one node the console cannot move', [node(), server({ caps: [] })], [intent('channel')]],
    ['a macOS node', [node(), server({ os: 'darwin' })], [intent('channel')]],
    ['no inventory answer', null, [intent('channel')]],
    ['an empty inventory', [], [intent('channel')]],
    ['auto stable and a node resolved to dev', [node({ channel: 'dev' }), server()], [intent('stable')]],
    ['a node with no update-gate', [node({ caps: ['detach'] }), server()], [intent('channel')]],
    ['no node with a tag to move to (one box hand-installed ahead)', [node({ desiredTag: null }), server({ desiredTag: null })], [intent('channel')]],
    ['a lease that could not be read', [{ ...node(), update: undefined } as unknown as NodeWire, server()], [intent('channel')]],
    ['a node whose stamp did not read', [node({ stampRead: 'unreadable' }), server()], [intent('channel')]],
    ['the lagging box has no tag to move to (rolled back) while the leader has one', [node({ desiredTag: null, current: at('v0.0.7') }), server({ desiredTag: 'v0.0.10', current: at('v0.0.9') })], [intent('channel')]],
    ['the lagging box is hand-placed off the release lane (no version, no tag)', [node({ desiredTag: null }), server({ desiredTag: 'v0.0.10', current: at('v0.0.9') })], [intent('channel')]],
    ['a pin below the leader: the lagging box moves, but not to where the leader is', [node({ desiredTag: 'v0.0.8', current: at('v0.0.7') }), server({ desiredTag: null, current: at('v0.0.9') })], [intent('channel')]],
    ['no node has a tag to move to, though every node runs the same release tag (a dirty or hand-built box on that tag)', [node({ desiredTag: null, current: at('v0.0.9') }), server({ desiredTag: null, current: at('v0.0.9') })], [intent('channel')]],
  ] as const)('the terminal verbs when %s', (_what, nodes, intents) => {
    expect(skewRemedy(nodes as readonly NodeWire[] | null, intents as readonly UpdateIntentWire[])).toEqual({ kind: 'cli' });
  });

  it('a converged node is not asked to be movable: only the nodes with a tag to move to are', () => {
    expect(skewRemedy([node(), server({ desiredTag: null, reachable: false, current: at('v0.0.9') })], [intent('channel')])).toEqual({ kind: 'auto' });
  });

  it('auto when the lagging box is tagged and the leader already runs that tag', () => {
    expect(skewRemedy([node({ desiredTag: 'v0.0.9', current: at('v0.0.7') }), server({ desiredTag: null, current: at('v0.0.9') })], [intent('channel')]))
      .toEqual({ kind: 'auto' });
  });

  it('no intent answer at all reads as auto off', () => {
    expect(skewRemedy(movable, null)).toEqual({ kind: 'cli' });
    expect(skewRemedy(movable, undefined)).toEqual({ kind: 'cli' });
  });
});
