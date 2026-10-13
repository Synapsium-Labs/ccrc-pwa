// The move planner (centralised-update design 2026-09-20 §13 "W4 adds", §18
// "Install names the order and the direction"; programme wave 5 Task 8).
// Pure functions over a view — no render, no fetch. The order is the
// dispatcher's (compareDispatchOrder), the set is what the move takes
// somewhere, and tag order is semver across the v0.0.9/v0.0.10 boundary.
import { describe, expect, it } from 'vitest';
import type { NodeWire, ReleaseWire, UpdatesView } from '../../shared/api';
import type { BuildInfo } from '../../shared/buildinfo';
import {
  moveEmptyText, moveHeadline, moveLabel, moveLines, moveRequests, moveTarget, planMove, rollbackBlockers, rollbackHowText,
  type MoveIntent,
} from '../src/fleet/movePlan';

const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const FLEET_ID = '55555555-5555-4555-8555-555555555555';
const SERVER_ID = '66666666-6666-4666-8666-666666666666';
const ID_A = '77777777-7777-4777-8777-777777777777';
const ID_B = '88888888-8888-4888-8888-888888888888';
const ID_C = '99999999-9999-4999-8999-999999999999';
const ID_D = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_E = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
/** A stamp at `version`; `undefined` = an unversioned (deploy.sh) build — the key is ABSENT, as the parser leaves it. */
const stamp = (version: string | undefined): BuildInfo => ({
  sha: 'e'.repeat(40), ref: 'main', builtAt: '2026-09-23T12:00:00Z', dirty: false,
  ...(version === undefined ? {} : { version }),
});
/** A full NodeWire: a measured, reachable fleet node on v0.0.9 with a previous v0.0.8. */
const node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: FLEET_ID, role: 'fleet', label: 'fleet', os: 'linux',
  current: stamp('v0.0.9'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: ['update'], highestVersion: 'v0.0.9', previousVersion: 'v0.0.8',
  measuredAt: T0, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.10', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
/** The server's own row: no agent by construction (`agentOps: null`). */
const server = (over: Partial<NodeWire> = {}): NodeWire =>
  node({ nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null, ...over });
const view = (nodes: NodeWire[]): UpdatesView => ({
  catalogue: { lastOkAt: T0, lastError: null }, releases: [], nodes, intent: [],
});
const ids = (intent: MoveIntent, nodes: NodeWire[]): string[] =>
  planMove(view(nodes), intent).nodes.map((n) => n.nodeId);
const rel = (tag: string, o: Partial<ReleaseWire> = {}): ReleaseWire => ({
  tag, version: tag, channel: 'stable', publishedAt: 1_000, commitSha: null, bundleListed: true, yanked: false, refused: [], notes: null, ...o,
});

const UP: MoveIntent = { scope: 'fleet', direction: 'update', tag: 'v0.0.10' };
const DOWN: MoveIntent = { scope: 'fleet', direction: 'rollback', to: 'v0.0.8' };

describe('planMove — the nodes one tap moves, in dispatch order', () => {
  it('names the fleet-role node before the server-role node whatever the wire order (§18 "Install names the order")', () => {
    expect(ids(UP, [server(), node()])).toEqual([FLEET_ID, SERVER_ID]);
    expect(ids(UP, [node(), server()])).toEqual([FLEET_ID, SERVER_ID]);
    expect(ids(DOWN, [server(), node()])).toEqual([FLEET_ID, SERVER_ID]);
  });

  it('is compareDispatchOrder: rank, then label — a both-role node ranks with the server, an unnamed role last', () => {
    const b = node({ nodeId: ID_A, label: 'b-fleet' });
    const a = node({ nodeId: ID_B, label: 'a-fleet' });
    const both = server({ nodeId: ID_C, role: 'both', label: 'a-both' });
    const none = server({ nodeId: ID_D, role: null, label: 'a-none' });
    expect(ids(UP, [none, server(), both, b, a])).toEqual([ID_B, ID_A, ID_C, SERVER_ID, ID_D]);
  });

  it('a fleet update names only nodes the tag takes FORWARD — never one at or above it, a macOS node, or a stamp that was not read', () => {
    const at = node({ nodeId: ID_A, label: 'at', current: stamp('v0.0.10') });
    const above = node({ nodeId: ID_B, label: 'above', current: stamp('v0.0.11') });
    const mac = node({ nodeId: ID_C, label: 'mac', os: 'darwin' });
    const unread = node({ nodeId: ID_D, label: 'unread', stampRead: 'unreadable', current: null });
    const unversioned = server({ current: stamp(undefined) });   // read, no tag: any eligible release is newer
    expect(ids(UP, [at, above, mac, unread, unversioned, node()])).toEqual([FLEET_ID, SERVER_ID]);
  });

  it("a fleet update never names a node the tag leaves at or below its FLOOR — the route skips it not-newer (D-3403)", () => {
    // Rolled back to v0.0.8 under a v0.0.10 floor, and an unversioned box whose floor file reads v0.0.10.
    const back = node({ nodeId: ID_A, label: 'back', current: stamp('v0.0.8'), highestVersion: 'v0.0.10' });
    const floored = server({ nodeId: ID_B, label: 'floored', current: stamp(undefined), highestVersion: 'v0.0.10' });
    expect(ids(UP, [back, floored, node()])).toEqual([FLEET_ID]);
    expect(ids({ scope: 'fleet', direction: 'update', tag: 'v0.0.11' }, [floored, back])).toEqual([ID_A, ID_B]);
    // A NULL floor is "no floor" only when it was MEASURED absent: never measured is floor-unread (W2's D-3213; D-3492); undefined is an older wire's silence.
    const unfloored = server({ nodeId: ID_C, label: 'unfloored', current: stamp(undefined), highestVersion: null, floorRead: 'unmeasured' });
    const noFloor = node({ nodeId: ID_D, label: 'no-floor', current: stamp('v0.0.8'), highestVersion: null, floorRead: 'absent' });
    const older = node({ nodeId: ID_E, label: 'older', current: stamp('v0.0.8'), highestVersion: null });
    expect(ids(UP, [unfloored, noFloor, older])).toEqual([ID_D, ID_E]);
  });

  it('compares by semver, never string order: v0.0.10 takes v0.0.9 forward, and v0.0.9 rolls v0.0.10 back', () => {
    expect(ids({ scope: 'fleet', direction: 'update', tag: 'v0.0.10' }, [node({ current: stamp('v0.0.9') })])).toEqual([FLEET_ID]);
    expect(ids({ scope: 'fleet', direction: 'update', tag: 'v0.0.9' }, [node({ current: stamp('v0.0.10') })])).toEqual([]);
    expect(ids({ scope: 'fleet', direction: 'rollback', to: 'v0.0.9' }, [node({ current: stamp('v0.0.10') })])).toEqual([FLEET_ID]);
    expect(ids({ scope: 'fleet', direction: 'rollback', to: 'v0.0.10' }, [node({ current: stamp('v0.0.9') })])).toEqual([]);
  });

  it('a fleet rollback names every non-macOS node running a NEWER tag — an unversioned node has nothing to roll back from', () => {
    const mac = node({ nodeId: ID_A, label: 'mac', os: 'darwin' });
    const bare = server({ nodeId: ID_B, label: 'bare', current: stamp(undefined) });
    const there = node({ nodeId: ID_C, label: 'there', current: stamp('v0.0.8') });
    expect(ids(DOWN, [server(), mac, bare, there, node()])).toEqual([FLEET_ID, SERVER_ID]);
  });

  it('a node move names that node alone, and a nodeId the view does not carry names nothing', () => {
    expect(ids({ scope: 'node', direction: 'update', nodeId: SERVER_ID, tag: 'v0.0.10' }, [node(), server()])).toEqual([SERVER_ID]);
    expect(ids({ scope: 'node', direction: 'rollback', nodeId: ID_E, to: 'v0.0.8' }, [node(), server()])).toEqual([]);
  });

  it('a target that is not a release tag names nothing — the comparator, which throws, is never handed it', () => {
    expect(ids({ scope: 'fleet', direction: 'update', tag: 'vnext' }, [node()])).toEqual([]);
    expect(ids({ scope: 'fleet', direction: 'rollback', to: 'latest' }, [node()])).toEqual([]);
  });

  it('never reorders the view it was handed — the poll holds that array', () => {
    const wire = [server(), node()];
    planMove(view(wire), UP);
    expect(wire.map((n) => n.nodeId)).toEqual([SERVER_ID, FLEET_ID]);
  });
});

describe('moveRequests — what one confirm sends, by direction', () => {
  it('a node update is apply {nodeId, tag}; a node rollback is rollback {nodeId, to}', () => {
    const nodes = [node(), server()];
    expect(moveRequests(planMove(view(nodes), { scope: 'node', direction: 'update', nodeId: FLEET_ID, tag: 'v0.0.10' })))
      .toEqual([{ route: 'apply', body: { nodeId: FLEET_ID, tag: 'v0.0.10' } }]);
    expect(moveRequests(planMove(view(nodes), { scope: 'node', direction: 'rollback', nodeId: SERVER_ID, to: 'v0.0.8' })))
      .toEqual([{ route: 'rollback', body: { nodeId: SERVER_ID, to: 'v0.0.8' } }]);
  });

  it('a fleet update is ONE apply {all: true, tag} — the server writes the per-node requests', () => {
    expect(moveRequests(planMove(view([server(), node()]), UP))).toEqual([{ route: 'apply', body: { all: true, tag: 'v0.0.10' } }]);
  });

  it('a fleet rollback is one rollback {nodeId, to} per node, fleet first (D-3390)', () => {
    expect(moveRequests(planMove(view([server(), node()]), DOWN))).toEqual([
      { route: 'rollback', body: { nodeId: FLEET_ID, to: 'v0.0.8' } },
      { route: 'rollback', body: { nodeId: SERVER_ID, to: 'v0.0.8' } },
    ]);
  });

  it('an empty plan sends nothing', () => {
    expect(moveRequests(planMove(view([node({ current: stamp('v0.0.10') })]), UP))).toEqual([]);
    expect(moveRequests(planMove(view([node()]), { scope: 'node', direction: 'update', nodeId: ID_E, tag: 'v0.0.10' }))).toEqual([]);
  });
});

describe('moveHeadline / moveLines / moveTarget — what the sheet says', () => {
  it('headline: Update <tag> forward, Roll back to <to> back; the target is whichever the move points at', () => {
    expect(moveHeadline(UP)).toBe('Update v0.0.10');
    expect(moveHeadline({ scope: 'node', direction: 'rollback', nodeId: FLEET_ID, to: 'v0.0.8' })).toBe('Roll back to v0.0.8');
    expect(moveTarget(UP)).toBe('v0.0.10');
    expect(moveTarget(DOWN)).toBe('v0.0.8');
  });

  it('rollbackHowText: the flip-or-download sentence, makes no per-node claim (wave 8 item F3)', () => {
    const s = rollbackHowText('v0.0.8');
    expect(s).toContain('kept copy of v0.0.8');
    expect(s).toContain('downloads v0.0.8 and re-installs it');
    expect(s).toContain('it can be refused or can fail');
  });

  it('lines: numbered in plan order, current → target; an unknown role, an unversioned build and an unread stamp each say so', () => {
    expect(moveLines(planMove(view([server({ current: stamp(undefined) }), node()]), UP))).toEqual([
      '1. fleet (fleet) v0.0.9 → v0.0.10',
      '2. server (server) unversioned → v0.0.10',
    ]);
    expect(moveLines(planMove(
      view([node({ role: null, stampRead: 'unreadable', current: null })]),
      { scope: 'node', direction: 'rollback', nodeId: FLEET_ID, to: 'v0.0.8' },
    ))).toEqual(['1. fleet (unknown role) stamp not read → v0.0.8']);
  });
});

describe('moveEmptyText — an empty plan says only what was measured', () => {
  it('names the direction and the target — never "every node is already there", since a node can be AHEAD of it', () => {
    // The release-row case: v0.0.9 over a fleet on v0.0.10 and a server on v0.0.9 reads Install
    // (releaseDirection: not EVERY node is newer) and takes nobody forward — the fleet node is past it.
    const up9: MoveIntent = { scope: 'fleet', direction: 'update', tag: 'v0.0.9' };
    expect(planMove(view([node({ current: stamp('v0.0.10') }), server()]), up9).nodes).toEqual([]);
    expect(moveEmptyText(up9)).toBe('Nothing to move — v0.0.9 takes no managed node forward.');
    expect(moveEmptyText(DOWN)).toBe('Nothing to move — no managed node is measured on a release newer than v0.0.8.');
    expect(moveEmptyText({ scope: 'node', direction: 'rollback', nodeId: ID_E, to: 'v0.0.8' }))
      .toBe('Nothing to move — that node is no longer in the inventory.');
    expect(moveEmptyText({ scope: 'fleet', direction: 'update', tag: 'vnext' })).toBe('Nothing to move — vnext is not a release tag.');
  });
});

describe('rollbackBlockers — the fleet nodes a rollback would name that the server refuses (wave 8 item C)', () => {
  const v8NoBundle = rel('v0.0.8', { bundleListed: false });

  it('two managed nodes above v0.0.8, one verified and one unverified: one blocker, the verified node', () => {
    const verified = node({ nodeId: ID_A, label: 'verified-node', current: stamp('v0.0.10'), provenance: 'verified' });
    const unverified = node({ nodeId: ID_B, label: 'unverified-node', current: stamp('v0.0.10'), provenance: 'unverified' });
    expect(rollbackBlockers([verified, unverified], v8NoBundle, 'v0.0.8')).toEqual([{ label: 'verified-node', word: 'no-bundle' }]);
  });

  it('both unverified: no blockers', () => {
    const a = node({ nodeId: ID_A, label: 'a', current: stamp('v0.0.10'), provenance: 'unverified' });
    const b = node({ nodeId: ID_B, label: 'b', current: stamp('v0.0.10'), provenance: 'unverified' });
    expect(rollbackBlockers([a, b], v8NoBundle, 'v0.0.8')).toEqual([]);
  });

  it('a verified Mac above the tag is not named — not a managed node', () => {
    const mac = node({ nodeId: ID_C, label: 'mac', os: 'darwin', current: stamp('v0.0.10'), provenance: 'verified' });
    expect(rollbackBlockers([mac], v8NoBundle, 'v0.0.8')).toEqual([]);
  });

  it('a non-tag to names nothing', () => {
    const verified = node({ nodeId: ID_A, label: 'verified-node', current: stamp('v0.0.10'), provenance: 'verified' });
    expect(rollbackBlockers([verified], v8NoBundle, 'vnext')).toEqual([]);
  });
});

describe('moveLabel — a node by the label the inventory gives it', () => {
  it('reads the inventory the move was planned over, so a node the move does not name still has a label; an unknown id reads as itself', () => {
    const p = planMove(view([server(), node()]), { scope: 'node', direction: 'update', nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(p.nodes.map((n) => n.nodeId)).toEqual([FLEET_ID]);
    expect(moveLabel(p, SERVER_ID)).toBe('server');
    expect(moveLabel(p, ID_E)).toBe(ID_E);
  });
});
