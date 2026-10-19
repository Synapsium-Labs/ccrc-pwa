// The one Ack's rule, written once (D-5507, settings spec §6.3). `ackBranch` names WHICH Ack a node is offered, in
// today's first-match order: a busy or unnamed lease offers none; a failed or reverted move; then a standing
// request; then a refusal this node made. `canAck` is that answer `!== null`, so the button's gate and the
// confirm's copy can never disagree about one row. No suite held `canAck`'s cases alone before this one: the halt
// banner and the Settings row reach it through the UI.
import { createElement, createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { NodeWire, ReleaseWire } from '../../shared/api';
import { AckConfirm, ackBranch, ackConfirmCopy, canAck, refusedTags } from '../src/fleet/updateAck';

afterEach(() => { cleanup(); });

const NODE_A = '55555555-5555-4555-8555-555555555555';
const NODE_B = '66666666-6666-4666-8666-666666666666';
const node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: NODE_A, role: 'fleet', label: 'fleet', os: 'linux',
  current: null, stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: [], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  measuredAt: 1, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const release = (tag: string, refusedBy: string[] = []): ReleaseWire => ({
  tag, version: tag, channel: 'stable', publishedAt: 1, commitSha: 'd'.repeat(40),
  bundleListed: true, yanked: false, refused: refusedBy.map((by) => ({ by, at: 1 })), notes: null,
});
const state = (s: string, target: string | null = null): NodeWire['update'] =>
  ({ state: s, target, startedAt: 1, detail: null }) as NodeWire['update'];
const REQUEST = { tag: 'v0.0.10', kind: 'update', at: 1 } as const;
const REFUSED = [release('v0.0.10', [NODE_A]), release('v0.0.11', [NODE_A, NODE_B])];
const OTHERS = [release('v0.0.10', [NODE_B])];

/** Every fixture node the rule can meet, with the releases it is judged against and the branch it must answer. */
const CASES: ReadonlyArray<readonly [string, NodeWire, readonly ReleaseWire[], ReturnType<typeof ackBranch>]> = [
  ['idle with nothing', node(), [], null],
  ['idle, a refusal by another node only', node(), OTHERS, null],
  ['busy (pending) with a request and a refusal', node({ update: state('pending', 'v0.0.10'), request: REQUEST }), REFUSED, null],
  ['busy (applying)', node({ update: state('applying', 'v0.0.10') }), [], null],
  ['a state this build cannot name', node({ update: state('mystery') }), REFUSED, null],
  ['no update at all', node({ update: undefined as unknown as NodeWire['update'] }), REFUSED, null],
  ['failed', node({ update: state('failed', 'v0.0.10') }), [], 'failed'],
  ['reverted', node({ update: state('reverted', 'v0.0.10') }), [], 'failed'],
  ['failed with a request and refusals: failed comes first', node({ update: state('failed', 'v0.0.10'), request: REQUEST }), REFUSED, 'failed'],
  ['a standing request', node({ request: REQUEST }), [], 'request'],
  ['a request with refusals: the request comes before the refusal', node({ request: REQUEST }), REFUSED, 'request'],
  ['a refusal by this node', node(), REFUSED, 'refusal'],
];

describe('ackBranch — the first-match order', () => {
  it.each(CASES)('%s', (_name, n, releases, want) => {
    expect(ackBranch(n, releases)).toBe(want);
  });
});

describe('canAck is ackBranch, written once', () => {
  it('canAck equals ackBranch !== null over every fixture node', () => {
    for (const [name, n, releases] of CASES) {
      expect(canAck(n, releases), name).toBe(ackBranch(n, releases) !== null);
    }
  });
});

describe('refusedTags — what an Ack forgets', () => {
  it('names the tags this node refused, newest first, and none another node refused', () => {
    expect(refusedTags(node(), REFUSED)).toEqual(['v0.0.11', 'v0.0.10']);
    expect(refusedTags(node({ nodeId: NODE_B }), REFUSED)).toEqual(['v0.0.11']);
    expect(refusedTags(node(), OTHERS)).toEqual([]);
  });
});

describe("AckConfirm's copy comes from the branch (spec §6.3's three Ack rows)", () => {
  it('a failed move: "Ack", and the tag the server may try again', () => {
    const copy = ackConfirmCopy(node({ update: state('failed', 'v0.0.10') }), [])!;
    expect(copy.title).toBe("Ack fleet's failed move?");
    expect(copy.confirmLabel).toBe('Ack');
    expect(copy.lines).toEqual([
      'It returns to idle.',
      'With auto-install on, the server may try v0.0.10 again on its next check.',
    ]);
  });

  it('a standing request only: "Withdraw the request", nothing moves', () => {
    const copy = ackConfirmCopy(node({ request: REQUEST }), [])!;
    expect(copy.title).toBe('Withdraw the request on fleet?');
    expect(copy.confirmLabel).toBe('Withdraw the request');
    expect(copy.lines).toEqual(['The request to update to v0.0.10 is cleared, and nothing moves.']);
  });

  it("a standing rollback request reads the verb as two words: \"roll back\"", () => {
    const copy = ackConfirmCopy(node({ request: { tag: 'v0.0.8', kind: 'rollback', at: 1 } }), [])!;
    expect(copy.lines).toEqual(['The request to roll back to v0.0.8 is cleared, and nothing moves.']);
  });

  it('request plus refusals names the refusals: never "nothing moves" alone', () => {
    const copy = ackConfirmCopy(node({ request: REQUEST }), REFUSED)!;
    expect(copy.confirmLabel).toBe('Withdraw the request');
    expect(copy.lines).toContain(
      'It also forgets that it refused v0.0.11 and v0.0.10. With auto-install on, the server may try them again on its next check.',
    );
  });

  it('a refusal-only node names the refusals', () => {
    const copy = ackConfirmCopy(node(), [release('v0.0.10', [NODE_A])])!;
    expect(copy.title).toBe("Clear fleet's refusals?");
    expect(copy.confirmLabel).toBe('Ack');
    expect(copy.lines).toEqual([
      'It forgets that it refused v0.0.10. With auto-install on, the server may try it again on its next check.',
    ]);
  });

  it('a failed move with refusals names them too', () => {
    const copy = ackConfirmCopy(node({ update: state('reverted', 'v0.0.10') }), REFUSED)!;
    expect(copy.lines).toEqual([
      'It returns to idle.',
      'It also forgets that it refused v0.0.11 and v0.0.10. With auto-install on, the server may try them again on its next check.',
    ]);
  });

  it('a node with no Ack has no copy', () => {
    expect(ackConfirmCopy(node(), [])).toBeNull();
  });
});

describe('AckConfirm — a confirm for an Ack that is gone closes', () => {
  it("a poll that leaves the node with no Ack while the confirm is open calls onClose, so the caller's flag cannot linger", () => {
    const onClose = vi.fn();
    const rowRef = createRef<HTMLElement>();
    const el = (n: NodeWire) => createElement(AckConfirm, { node: n, releases: [], open: true, onClose, onConfirm: () => {}, rowRef });
    const { rerender } = render(el(node({ update: state('failed', 'v0.0.10') })));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    rerender(el(node({ update: state('pending', 'v0.0.10') })));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
