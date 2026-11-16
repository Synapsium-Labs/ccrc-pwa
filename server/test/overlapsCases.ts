// Overlord W2, overlaps (plan w2-overlaps.md, Tasks 1 and 2): the cases over `overlapSightings`, `goalConflictSightings`,
// `pairMoves`, `pairBlocks`, `blockingPairs` and `relayConflictVerdict`, each over hand-built facts. The three
// `overlaps-*.test.ts` files run them against the real module and `sim/overlapsSets.ts` against each mutant, so one list of
// cases is both the suite and the mutation floor's judge. The properties are seeded loops (the tree has no property
// library): a fixed seed, a few hundred cases, and the failing case in the message. The time-budget case is slow and lives
// in `overlaps-sightings.test.ts` alone.
import { expect } from 'vitest';
import {
  GOAL_CONFLICT_CHOICES, PAIR_PATHS_MAX, parsePairKey,
  type GoalConflictChoice, type PairEvidence,
} from '../../shared/programmeFacts.js';
import type * as Overlaps from '../src/coord/overlaps.js';
import type {
  ClaimHistoryRow, Fact, MoveFacts, PairMoves, PairSighting, SideProgrammes, StandingPairRow,
} from '../src/coord/overlaps.js';
import { mulberry32 } from './fakeTime.js';

export type OverlapsModule = Pick<typeof Overlaps,
  'overlapSightings' | 'goalConflictSightings' | 'pairMoves' | 'pairBlocks' | 'blockingPairs' | 'relayConflictVerdict'>;
export interface OverlapsCase { name: string; run: (m: OverlapsModule) => void }

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const NOW = 1_790_000_000_000;

export const E = (o: Partial<PairEvidence> = {}): PairEvidence => ({
  sources: [], paths: [], pathsCut: false, claimIds: [], prs: [], triples: 0, hotPaths: [], ...o,
});
const progs = (...slugs: string[]): SideProgrammes => ({ kind: 'programmes', slugs });
const UNATTRIBUTED: SideProgrammes = { kind: 'unattributed' };
const UNREAD: SideProgrammes = { kind: 'unread' };

// ---------------------------------------------------------------------------------------------------------------------
// overlapSightings

const coll = (o: Partial<Parameters<OverlapsModule['overlapSightings']>[0][number]> = {}) => ({
  project: 'project-a', path: 'server/src/x.ts', claimedPath: 'server/src/x.ts', holderClaimId: 7,
  requester: progs('prog-a'), holder: progs('prog-b'), at: NOW - HOUR, ...o,
});
const rad = (o: Partial<Parameters<OverlapsModule['overlapSightings']>[1][number]> = {}) => ({
  project: 'project-a', prA: 12, prB: 11, paths: ['server/src/y.ts'], pathsCut: false,
  sideA: progs('prog-a'), sideB: progs('prog-b'), ...o,
});

export const OVERLAP_CASES: OverlapsCase[] = [
  { name: 'a collision between prog-a and prog-b sights overlap:prog-a:prog-b with both paths, the claim id and the source', run: (m) => {
    const r = m.overlapSightings([coll({ path: 'server/src/x.ts', claimedPath: 'server/src', holderClaimId: 7 })], [], NOW);
    expect(r.counts).toEqual({ unattributed: 0, unread: 0 });
    expect(r.sightings).toEqual([{
      key: 'overlap:prog-a:prog-b', kind: 'overlap', a: 'prog-a', b: 'prog-b', newestAt: NOW - HOUR,
      evidence: E({ sources: ['claim-collision'], paths: ['server/src', 'server/src/x.ts'], claimIds: [7] }),
    }]);
  } },
  { name: 'the key is the same whichever side asked', run: (m) => {
    const r = m.overlapSightings([coll({ requester: progs('prog-b'), holder: progs('prog-a') })], [], NOW);
    expect(r.sightings.map((s) => [s.key, s.a, s.b])).toEqual([['overlap:prog-a:prog-b', 'prog-a', 'prog-b']]);
  } },
  { name: 'sides {prog-a} and {prog-a, prog-b} sight nothing: one programme\'s own overlap', run: (m) => {
    const r = m.overlapSightings([coll({ requester: progs('prog-a'), holder: progs('prog-a', 'prog-b') })],
      [rad({ sideA: progs('prog-a', 'prog-b'), sideB: progs('prog-b') })], NOW);
    expect(r.sightings).toEqual([]);
    expect(r.counts).toEqual({ unattributed: 0, unread: 0 });
  } },
  { name: 'sides {prog-a, prog-c} and {prog-a, prog-b} share prog-a and sight nothing', run: (m) => {
    expect(m.overlapSightings([coll({ requester: progs('prog-a', 'prog-c'), holder: progs('prog-a', 'prog-b') })], [], NOW).sightings).toEqual([]);
  } },
  { name: 'sides {prog-a, prog-c} and {prog-b} sight two keys', run: (m) => {
    const r = m.overlapSightings([coll({ requester: progs('prog-a', 'prog-c'), holder: progs('prog-b') })], [], NOW);
    expect(r.sightings.map((s) => s.key)).toEqual(['overlap:prog-a:prog-b', 'overlap:prog-b:prog-c']);
  } },
  { name: 'an unattributed side sights nothing and counts once', run: (m) => {
    const a = m.overlapSightings([coll({ holder: UNATTRIBUTED })], [], NOW);
    expect([a.sightings, a.counts]).toEqual([[], { unattributed: 1, unread: 0 }]);
    const b = m.overlapSightings([], [rad({ sideB: UNATTRIBUTED })], NOW);
    expect([b.sightings, b.counts]).toEqual([[], { unattributed: 1, unread: 0 }]);
  } },
  { name: 'an unread side sights nothing and counts once; unread outranks unattributed on one fact', run: (m) => {
    const a = m.overlapSightings([coll({ requester: UNREAD })], [], NOW);
    expect([a.sightings, a.counts]).toEqual([[], { unattributed: 0, unread: 1 }]);
    const b = m.overlapSightings([coll({ requester: UNATTRIBUTED, holder: UNREAD })], [], NOW);
    expect([b.sightings, b.counts]).toEqual([[], { unattributed: 0, unread: 1 }]);
  } },
  { name: 'a side that names no programme is unattributed, never a pair', run: (m) => {
    const a = m.overlapSightings([coll({ requester: progs() })], [], NOW);
    expect([a.sightings, a.counts]).toEqual([[], { unattributed: 1, unread: 0 }]);
  } },
  { name: 'a bad fact does not stop the facts after it', run: (m) => {
    const a = m.overlapSightings([coll({ holder: UNREAD }), coll({ holderClaimId: 9 })], [], NOW);
    expect(a.counts).toEqual({ unattributed: 0, unread: 1 });
    expect(a.sightings.map((s) => s.evidence.claimIds)).toEqual([[9]]);
  } },
  { name: 'a radar fact sights its pair with both pull requests, sorted, and the radar source; newestAt is now', run: (m) => {
    const r = m.overlapSightings([], [rad({ prA: 12, prB: 11 })], NOW);
    expect(r.sightings).toEqual([{
      key: 'overlap:prog-a:prog-b', kind: 'overlap', a: 'prog-a', b: 'prog-b', newestAt: NOW,
      evidence: E({ sources: ['radar'], paths: ['server/src/y.ts'], prs: [11, 12] }),
    }]);
  } },
  { name: 'two radar facts of one pull request pair list each pull request once', run: (m) => {
    const r = m.overlapSightings([], [rad({ prA: 12, prB: 11 }), rad({ prA: 11, prB: 12, paths: ['other.ts'] })], NOW);
    expect(r.sightings[0]!.evidence.prs).toEqual([11, 12]);
    expect(r.sightings[0]!.evidence.paths).toEqual(['other.ts', 'server/src/y.ts']);
  } },
  { name: 'a cut radar path list sets pathsCut, an uncut one does not', run: (m) => {
    expect(m.overlapSightings([], [rad({ pathsCut: true })], NOW).sightings[0]!.evidence.pathsCut).toBe(true);
    expect(m.overlapSightings([], [rad({ pathsCut: false })], NOW).sightings[0]!.evidence.pathsCut).toBe(false);
  } },
  { name: '25 colliding paths keep 20, sorted, with pathsCut; exactly 20 are not cut', run: (m) => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => {
      const p = `server/src/f${String(24 - i).padStart(2, '0')}.ts`;       // descending, so sorting matters
      return coll({ path: p, claimedPath: p, holderClaimId: 100 + i });
    });
    const over = m.overlapSightings(mk(25), [], NOW).sightings[0]!.evidence;
    expect(over.paths).toHaveLength(PAIR_PATHS_MAX);
    expect(over.paths).toEqual([...over.paths].sort());
    expect(over.paths[0]).toBe('server/src/f00.ts');
    expect(over.pathsCut).toBe(true);
    expect(over.claimIds).toEqual(Array.from({ length: PAIR_PATHS_MAX }, (_, i) => 105 + i));
    const exact = m.overlapSightings(mk(20), [], NOW).sightings[0]!.evidence;
    expect([exact.paths.length, exact.pathsCut]).toEqual([20, false]);
  } },
  { name: 'sightings of one key merge: sources, paths, claim ids and pull requests; newestAt is the newest', run: (m) => {
    const r = m.overlapSightings(
      [coll({ path: 'b.ts', claimedPath: 'b.ts', holderClaimId: 9, at: NOW - 5 * HOUR }),
        coll({ path: 'a.ts', claimedPath: 'a.ts', holderClaimId: 3, at: NOW - 9 * HOUR })],
      [rad({ paths: ['c.ts'], prA: 5, prB: 4 })], NOW - 2 * HOUR);
    expect(r.sightings).toHaveLength(1);
    expect(r.sightings[0]).toEqual({
      key: 'overlap:prog-a:prog-b', kind: 'overlap', a: 'prog-a', b: 'prog-b', newestAt: NOW - 2 * HOUR,
      evidence: E({ sources: ['claim-collision', 'radar'], paths: ['a.ts', 'b.ts', 'c.ts'], claimIds: [3, 9], prs: [4, 5] }),
    });
  } },
  { name: 'a collision\'s newestAt is its own time, and the newest of several', run: (m) => {
    const r = m.overlapSightings([coll({ at: NOW - 3 * HOUR }), coll({ at: NOW - 1 * HOUR }), coll({ at: NOW - 8 * HOUR })], [], NOW);
    expect(r.sightings[0]!.newestAt).toBe(NOW - HOUR);
  } },
  { name: 'two pairs stay two sightings, in key order', run: (m) => {
    const r = m.overlapSightings(
      [coll({ requester: progs('prog-c'), holder: progs('prog-b') }), coll({ requester: progs('prog-a'), holder: progs('prog-b') })], [], NOW);
    expect(r.sightings.map((s) => s.key)).toEqual(['overlap:prog-a:prog-b', 'overlap:prog-b:prog-c']);
  } },
  { name: 'every overlap sighting key parses back to its programmes; triples and hot paths are empty', run: (m) => {
    const r = m.overlapSightings([coll({ requester: progs('prog-c', 'prog-a'), holder: progs('prog-b') })], [rad()], NOW);
    for (const s of r.sightings) {
      expect(parsePairKey(s.key)).toEqual({ kind: 'overlap', a: s.a, b: s.b });
      expect([s.evidence.triples, s.evidence.hotPaths]).toEqual([0, []]);
    }
  } },
];

// ---------------------------------------------------------------------------------------------------------------------
// goalConflictSightings

const row = (claimId: number, program: string | null, createdAt: number, paths: readonly string[], project = 'project-a'): ClaimHistoryRow =>
  ({ claimId, project, program, createdAt, paths });
/** One row per programme in `order`, `gap` apart, the last at `end`, ids 1.. in order. */
const chain = (order: readonly (string | null)[], gap: number, paths: readonly string[], end = NOW, project = 'project-a', idFrom = 1): ClaimHistoryRow[] =>
  order.map((p, i) => row(idFrom + i, p, end - (order.length - 1 - i) * gap, paths, project));
const X = 'server/src/x.ts';
const sightKeys = (m: OverlapsModule, h: readonly ClaimHistoryRow[], now = NOW): string[] =>
  m.goalConflictSightings(h, now).sightings.map((s) => s.key);
const A = 'prog-a', B = 'prog-b', C = 'prog-c';

const shuffled = <T>(xs: readonly T[], rnd: () => number): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
};
const POOL = ['server/src/x.ts', 'server/src/y.ts', 'server/src', 'pwa/src/z.ts', 'docs/a.md'];
const randomHistory = (rnd: () => number, programmes: readonly string[]): ClaimHistoryRow[] => {
  const n = 6 + Math.floor(rnd() * 9);
  return Array.from({ length: n }, (_, i) => row(
    i + 1, programmes[Math.floor(rnd() * programmes.length)]!, NOW - Math.floor(rnd() * 13 * DAY),
    Array.from({ length: 1 + Math.floor(rnd() * 2) }, () => POOL[Math.floor(rnd() * POOL.length)]!),
  ));
};
const jsonOf = (r: { sightings: readonly PairSighting[] }): string => JSON.stringify(r.sightings);

export const GOAL_CASES: OverlapsCase[] = [
  { name: 'one A, B, A on one path within 14 days sights nothing: one round trip is not a conflict', run: (m) => {
    expect(sightKeys(m, chain([A, B, A], DAY, [X]))).toEqual([]);
  } },
  { name: 'A, B, A, B, A sights goal-conflict:prog-a:prog-b with two triples, the five claim ids, newestAt the last row', run: (m) => {
    const r = m.goalConflictSightings(chain([A, B, A, B, A], DAY, [X]), NOW);
    expect(r.cut).toBe(false);
    expect(r.counts).toEqual({ unattributed: 0, unread: 0 });
    expect(r.sightings).toEqual([{
      key: 'goal-conflict:prog-a:prog-b', kind: 'goal-conflict', a: A, b: B, newestAt: NOW,
      evidence: E({ sources: ['claim-history'], paths: [X], claimIds: [1, 2, 3, 4, 5], triples: 2 }),
    }]);
  } },
  { name: 'A, B, A, then a week later A, B, A, sights it', run: (m) => {
    const h = [row(1, A, NOW - 11 * DAY, [X]), row(2, B, NOW - 10 * DAY, [X]), row(3, A, NOW - 9 * DAY, [X]),
      row(4, A, NOW - 2 * DAY, [X]), row(5, B, NOW - 1 * DAY, [X]), row(6, A, NOW, [X])];
    const r = m.goalConflictSightings(h, NOW);
    expect(r.sightings.map((s) => [s.key, s.evidence.claimIds, s.newestAt])).toEqual([["goal-conflict:prog-a:prog-b", [1, 2, 3, 5, 6], NOW]]);
  } },
  { name: 'A, B, B, A and A, B, A, A sight nothing: the second triple would start before the first one closes', run: (m) => {
    expect(sightKeys(m, chain([A, B, B, A], DAY, [X]))).toEqual([]);
    expect(sightKeys(m, chain([A, B, A, A], DAY, [X]))).toEqual([]);
  } },
  { name: 'rows at one instant are not ordered: A0, B1, A1, B2, A2 sights nothing', run: (m) => {
    const h = [row(1, A, NOW - 2 * DAY, [X]), row(2, B, NOW - DAY, [X]), row(3, A, NOW - DAY, [X]),
      row(4, B, NOW, [X]), row(5, A, NOW, [X])];
    expect(sightKeys(m, h)).toEqual([]);
  } },
  { name: 'a first row exactly 14 days before now still counts', run: (m) => {
    const h = [row(1, A, NOW - 14 * DAY, [X]), row(2, B, NOW - 11 * DAY, [X]), row(3, A, NOW - 8 * DAY, [X]),
      row(4, B, NOW - 4 * DAY, [X]), row(5, A, NOW, [X])];
    expect(sightKeys(m, h)).toEqual(['goal-conflict:prog-a:prog-b']);
  } },
  { name: 'a first row 14 days and one millisecond before now is out of the window, and the rest sights nothing', run: (m) => {
    const h = [row(1, A, NOW - 14 * DAY - 1, [X]), row(2, B, NOW - 11 * DAY, [X]), row(3, A, NOW - 8 * DAY, [X]),
      row(4, B, NOW - 4 * DAY, [X]), row(5, A, NOW, [X])];
    expect(sightKeys(m, h)).toEqual([]);
  } },
  { name: 'a row after now is not read', run: (m) => {
    const h = chain([A, B, A, B, A], DAY, [X], NOW + 1);
    expect(sightKeys(m, h)).toEqual([]);
    expect(sightKeys(m, chain([A, B, A, B, A], DAY, [X], NOW))).toEqual(['goal-conflict:prog-a:prog-b']);
  } },
  { name: 'A, A, B sights nothing; B, A, B, A, B sights the same key', run: (m) => {
    expect(sightKeys(m, chain([A, A, B], DAY, [X]))).toEqual([]);
    expect(sightKeys(m, chain([B, A, B, A, B], DAY, [X]))).toEqual(['goal-conflict:prog-a:prog-b']);
  } },
  { name: 'A, B, A, B, A, B, A folds both orientations into one sighting', run: (m) => {
    const r = m.goalConflictSightings(chain([A, B, A, B, A, B, A], DAY, [X]), NOW);
    expect(r.sightings).toHaveLength(1);
    expect(r.sightings[0]!.evidence.triples).toBe(2);
    expect(r.sightings[0]!.newestAt).toBe(NOW);
  } },
  { name: 'a path another programme also claimed in the window is hot: the same sequence on it alone sights nothing', run: (m) => {
    const h = [...chain([A, B, A, B, A], DAY, [X]), row(9, C, NOW - 3 * DAY, [X])];
    const r = m.goalConflictSightings(h, NOW);
    expect(r.sightings).toEqual([]);
  } },
  { name: 'a hot path set aside: claims that also name a shared non-hot path sight it, the hot path under hotPaths', run: (m) => {
    const h = [...chain([A, B, A, B, A], DAY, [X, 'pwa/src/z.ts']), row(9, C, NOW - 3 * DAY, [X])];
    const r = m.goalConflictSightings(h, NOW);
    expect(r.sightings.map((s) => [s.key, s.evidence.paths, s.evidence.hotPaths, s.evidence.claimIds]))
      .toEqual([['goal-conflict:prog-a:prog-b', ['pwa/src/z.ts'], [X], [1, 2, 3, 4, 5]]]);
  } },
  { name: 'a path two programmes claimed is not hot', run: (m) => {
    expect(sightKeys(m, chain([A, B, A, B, A], DAY, [X]))).toHaveLength(1);
  } },
  { name: 'a path named only by unattributed rows besides A and B stays non-hot', run: (m) => {
    const h = [...chain([A, B, A, B, A], DAY, [X]), row(9, null, NOW - 3 * DAY, [X]), row(10, null, NOW - 2 * DAY, [X])];
    const r = m.goalConflictSightings(h, NOW);
    expect(r.sightings.map((s) => s.key)).toEqual(['goal-conflict:prog-a:prog-b']);
    expect(r.counts.unattributed).toBe(2);
  } },
  { name: 'a claim left with no non-hot path drops out of the sequence', run: (m) => {
    const hot = 'docs/hot.md';
    const h = [...chain([A, B, A, B, A], DAY, [X]), row(8, A, NOW - 2 * HOUR, [hot]), row(9, B, NOW - HOUR, [hot]), row(10, C, NOW - 30 * 60_000, [hot])];
    expect(sightKeys(m, h)).toEqual(['goal-conflict:prog-a:prog-b']);
  } },
  { name: 'directory containment counts (server/src against server/src/x.ts), and server/src-old does not', run: (m) => {
    const dir = (order: string[], paths: string[][]): ClaimHistoryRow[] => order.map((p, i) => row(i + 1, p, NOW - (order.length - 1 - i) * DAY, paths[i]!));
    expect(sightKeys(m, dir([A, B, A, B, A], [['server/src'], [X], ['server/src'], [X], ['server/src']]))).toEqual(['goal-conflict:prog-a:prog-b']);
    expect(m.goalConflictSightings(dir([A, B, A, B, A], [['server/src'], [X], ['server/src'], [X], ['server/src']]), NOW).sightings[0]!.evidence.paths).toEqual(['server/src', X]);
    expect(sightKeys(m, dir([A, B, A, B, A], [[X], ['server/src'], [X], ['server/src'], [X]]))).toEqual(['goal-conflict:prog-a:prog-b']);
    expect(sightKeys(m, dir([A, B, A, B, A], [['server/src'], ['server/src-old'], ['server/src'], ['server/src-old'], ['server/src']]))).toEqual([]);
  } },
  { name: 'the evidence keeps the overlapping non-hot paths only, sorted, with the hot ones apart', run: (m) => {
    const order = [A, B, A, B, A];
    const paths = [[X], [X, 'other/z.ts'], [X], [X, 'other/z.ts'], [X]];
    const h = order.map((p, i) => row(i + 1, p, NOW - (4 - i) * DAY, paths[i]!));
    const r = m.goalConflictSightings(h, NOW);
    expect(r.sightings[0]!.evidence.paths).toEqual([X]);
  } },
  { name: 'every two rows of a triple must overlap: A rows on different paths make no triple', run: (m) => {
    const order = [A, B, A, B, A];
    const paths = [['p/x'], ['p/x', 'q/y'], ['q/y'], ['p/x', 'q/y'], ['p/x']];
    const h = order.map((p, i) => row(i + 1, p, NOW - (4 - i) * DAY, paths[i]!));
    expect(sightKeys(m, h)).toEqual([]);
  } },
  { name: 'the middle row must overlap both outer rows', run: (m) => {
    const order = [A, B, A, B, A];
    const paths = [['p/x'], ['q/y'], ['p/x'], ['q/y'], ['p/x']];
    const h = order.map((p, i) => row(i + 1, p, NOW - (4 - i) * DAY, paths[i]!));
    expect(sightKeys(m, h)).toEqual([]);
  } },
  { name: 'rows in two projects never combine', run: (m) => {
    const h = [...chain([A, B, A], DAY, [X], NOW - 5 * DAY, 'project-a', 1), ...chain([A, B, A], DAY, [X], NOW, 'project-b', 10)];
    expect(sightKeys(m, h)).toEqual([]);
    const both = [...chain([A, B, A, B, A], DAY, [X], NOW, 'project-a', 1), ...chain([A, B, A, B, A], DAY, [X], NOW, 'project-b', 10)];
    const r = m.goalConflictSightings(both, NOW);
    expect(r.sightings).toHaveLength(1);
    expect(r.sightings[0]!.evidence.claimIds).toEqual([1, 2, 3, 4, 5, 10, 11, 12, 13, 14]);
  } },
  { name: 'a hot path is counted inside its project only', run: (m) => {
    const h = [...chain([A, B, A, B, A], DAY, [X], NOW, 'project-a', 1), row(20, C, NOW - DAY, [X], 'project-b')];
    expect(sightKeys(m, h)).toEqual(['goal-conflict:prog-a:prog-b']);
  } },
  { name: 'a row with no programme counts unattributed and is left out', run: (m) => {
    const h = chain([A, B, null, B, A], DAY, [X]);
    const r = m.goalConflictSightings(h, NOW);
    expect(r.counts).toEqual({ unattributed: 1, unread: 0 });
    expect(r.sightings).toEqual([]);
    const outside = m.goalConflictSightings([row(1, null, NOW - 20 * DAY, [X])], NOW);
    expect(outside.counts.unattributed).toBe(0);
  } },
  { name: 'a row at the instant of its middle row is not before it: A0, B1, A2, B2, A3 sights nothing', run: (m) => {
    const h = [row(1, A, NOW - 3 * DAY, [X]), row(2, B, NOW - 2 * DAY, [X]), row(3, A, NOW - DAY, [X]),
      row(4, B, NOW - DAY, [X]), row(5, A, NOW, [X])];
    expect(sightKeys(m, h)).toEqual([]);
  } },
  { name: 'T2 is the latest-closing triple that starts at or after T1\'s close, so newestAt follows the newest evidence', run: (m) => {
    const P = 'p/x', Q = 'q/y';
    const at = (d: number): number => NOW - (7 - d) * DAY;
    const h = [row(1, A, at(0), [P]), row(2, B, at(1), [P]), row(3, A, at(2), [P]), row(4, B, at(3), [P]),
      row(5, A, at(4), [P, Q]), row(6, B, at(5), [Q]), row(7, A, at(6), [Q])];
    const r = m.goalConflictSightings(h, NOW);
    expect(r.sightings.map((s) => [s.evidence.claimIds, s.newestAt])).toEqual([[[1, 2, 3, 5, 6, 7], at(6)]]);
  } },
  { name: 'a pair of rows that both overlap the middle row but not each other is no triple, even when it would close first', run: (m) => {
    const at = (d: number): number => NOW - (7 - d) * DAY;
    const h = [row(1, A, at(0), ['p/x']), row(2, B, at(1), ['p/x', 'q/y']), row(3, A, at(2), ['q/y']), row(4, A, at(4), ['r/z']),
      row(5, B, at(4.5), ['r/z']), row(6, A, at(5), ['p/x']), row(7, A, at(7), ['r/z'])];
    expect(sightKeys(m, h)).toEqual([]);
  } },
  { name: 'the first row of the first triple is the earliest overlapping one, whatever order the index finds them in', run: (m) => {
    const h = [row(1, A, NOW - 5 * DAY, ['server/src']), row(2, A, NOW - 4 * DAY, [X]), row(3, B, NOW - 3 * DAY, [X]),
      row(4, A, NOW - 2 * DAY, [X]), row(5, B, NOW - DAY, [X]), row(6, A, NOW, [X])];
    const r = m.goalConflictSightings(h, NOW);
    expect(r.sightings.map((s) => s.evidence.claimIds)).toEqual([[1, 3, 4, 5, 6]]);
  } },
  { name: 'more than 20 overlapping paths keep 20, sorted, with pathsCut', run: (m) => {
    const many = Array.from({ length: 25 }, (_, i) => `docs/f${String(24 - i).padStart(2, '0')}.md`);
    const r = m.goalConflictSightings(chain([A, B, A, B, A], DAY, many), NOW);
    const ev = r.sightings[0]!.evidence;
    expect(ev.paths).toHaveLength(PAIR_PATHS_MAX);
    expect(ev.paths).toEqual([...ev.paths].sort());
    expect(ev.pathsCut).toBe(true);
    const few = m.goalConflictSightings(chain([A, B, A, B, A], DAY, many.slice(0, 20)), NOW).sightings[0]!.evidence;
    expect([few.paths.length, few.pathsCut]).toEqual([20, false]);
  } },
  { name: 'a long sequence keeps newestAt at the newest second-triple close and bounds its ids', run: (m) => {
    const r = m.goalConflictSightings(chain([A, B, A, B, A, B, A, B, A], DAY, [X]), NOW);
    expect(r.sightings[0]!.newestAt).toBe(NOW);
    expect(r.sightings[0]!.evidence.claimIds.length).toBeLessThanOrEqual(PAIR_PATHS_MAX);
  } },
  { name: 'a history that stays within the step budget is not cut; one past it answers cut with what was found', run: (m) => {
    const h = chain(Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? A : B)), HOUR, [X]);
    const whole = m.goalConflictSightings(h, NOW);
    expect(whole.cut).toBe(false);
    expect(whole.sightings).toHaveLength(1);
    const small = m.goalConflictSightings(h, NOW, 50);
    expect(small.cut).toBe(true);
    const never = m.goalConflictSightings(h, NOW, 0);
    expect([never.cut, never.sightings]).toEqual([true, []]);
    const easy = m.goalConflictSightings(chain([A, B, A, B, A], DAY, [X]), NOW, 100_000);
    expect([easy.cut, easy.sightings.length]).toEqual([false, 1]);
  } },
  { name: 'a cut answer never invents a sighting: whatever a small budget finds, the whole run finds too', run: (m) => {
    const rnd = mulberry32(0xc07);
    for (let i = 0; i < 120; i++) {
      const h = randomHistory(rnd, [A, B]);
      const whole = new Set(sightKeys(m, h));
      const part = m.goalConflictSightings(h, NOW, 5 + Math.floor(rnd() * 60));
      for (const s of part.sightings) expect(whole.has(s.key), `case ${i}: ${JSON.stringify(h)}`).toBe(true);
    }
  } },
  { name: 'PROPERTY adding a row of A or B, that makes no path hot, never removes a sighting', run: (m) => {
    const rnd = mulberry32(0x51de);
    for (let i = 0; i < 250; i++) {
      const h = randomHistory(rnd, [A, B]);
      const extra = row(100, rnd() < 0.5 ? A : B, NOW - Math.floor(rnd() * 13 * DAY), [POOL[Math.floor(rnd() * POOL.length)]!]);
      const before = new Set(sightKeys(m, h));
      const after = new Set(sightKeys(m, [...h, extra]));
      for (const k of before) expect(after.has(k), `case ${i}: ${JSON.stringify([h, extra])}`).toBe(true);
    }
  } },
  { name: 'PROPERTY adding a third programme\'s row can only remove sightings, never add one', run: (m) => {
    const rnd = mulberry32(0x7a11);
    for (let i = 0; i < 250; i++) {
      const h = randomHistory(rnd, [A, B]);
      const extra = row(100, C, NOW - Math.floor(rnd() * 13 * DAY), [POOL[Math.floor(rnd() * POOL.length)]!]);
      const before = new Set(sightKeys(m, h));
      for (const k of sightKeys(m, [...h, extra])) expect(before.has(k), `case ${i}: ${JSON.stringify([h, extra])}`).toBe(true);
    }
  } },
  { name: 'PROPERTY shuffling the input order changes no sighting', run: (m) => {
    const rnd = mulberry32(0x5f1e);
    for (let i = 0; i < 250; i++) {
      const h = randomHistory(rnd, [A, B, C]);
      const a = m.goalConflictSightings(h, NOW);
      const b = m.goalConflictSightings(shuffled(h, rnd), NOW);
      expect(jsonOf(b), `case ${i}: ${JSON.stringify(h)}`).toBe(jsonOf(a));
      expect([b.counts, b.cut]).toEqual([a.counts, a.cut]);
    }
  } },
  { name: 'PROPERTY every sighting\'s key parses and its a and b are its two programmes', run: (m) => {
    const rnd = mulberry32(0x9a17);
    let seen = 0;
    for (let i = 0; i < 250; i++) {
      for (const s of m.goalConflictSightings(randomHistory(rnd, [A, B, C]), NOW).sightings) {
        seen++;
        expect(parsePairKey(s.key), `case ${i}`).toEqual({ kind: 'goal-conflict', a: s.a, b: s.b });
        expect([A, B, C]).toContain(s.a);
        expect([A, B, C]).toContain(s.b);
        expect(s.a < s.b).toBe(true);
        expect(s.evidence.triples).toBe(2);
      }
    }
    expect(seen).toBeGreaterThan(0);
  } },
];

// ---------------------------------------------------------------------------------------------------------------------
// pairMoves

const GC = 'goal-conflict:prog-a:prog-b';
const OV = 'overlap:prog-a:prog-b';
let nextRowId = 1;
const prow = (o: Partial<StandingPairRow> & { key: string }): StandingPairRow => {
  const p = parsePairKey(o.key)!;
  return {
    id: nextRowId++, kind: p.kind, a: p.a, b: p.b, episode: 1, firstSeenAt: NOW - 2 * DAY, lastSeenAt: NOW - DAY,
    evidence: E({ sources: ['claim-history'], paths: [X], triples: p.kind === 'goal-conflict' ? 2 : 0 }),
    goalsA: p.kind === 'goal-conflict' ? 'S0' : null, goalsB: p.kind === 'goal-conflict' ? 'S0' : null, ruled: null, ...o,
  };
};
const sight = (key: string, newestAt: number, o: Partial<PairEvidence> = {}): PairSighting => {
  const p = parsePairKey(key)!;
  return { key, kind: p.kind, a: p.a, b: p.b, newestAt,
    evidence: E({ sources: ['claim-history'], paths: [X], triples: p.kind === 'goal-conflict' ? 2 : 0, ...o }) };
};
const mfacts = (o: Partial<MoveFacts> = {}): MoveFacts => ({
  now: NOW, live: () => true, openRun: () => false, goalsStamp: () => 'S0', overlapSourcesRead: true, goalHistoryRead: true, ...o,
});

interface Pass { sightings?: PairSighting[]; facts?: Partial<MoveFacts>; before?: (state: StandingPairRow[]) => void }
/** Runs `pairMoves` over several passes, applying each pass's moves to the rows the next pass reads (the store's job, in
 *  miniature: a close removes the row, a refresh sets what it names, an open adds an unruled row). */
function passes(m: OverlapsModule, initial: StandingPairRow[], newest: Record<string, number>, script: Pass[]): PairMoves[] {
  let state = [...initial];
  const episodes = new Map(Object.entries(newest));
  for (const r of state) episodes.set(r.key, Math.max(episodes.get(r.key) ?? 0, r.episode));
  const out: PairMoves[] = [];
  for (const p of script) {
    if (p.before) { p.before(state); state = [...state]; }
    const moves = m.pairMoves(state, p.sightings ?? [], episodes, mfacts(p.facts));
    out.push(moves);
    for (const c of moves.close) state = state.filter((r) => r.id !== c.id);
    for (const r of moves.refresh) {
      state = state.map((s) => (s.id !== r.id ? s : {
        ...s, lastSeenAt: r.lastSeenAt, evidence: r.evidence,
        ...(r.goalsA !== undefined ? { goalsA: r.goalsA } : {}), ...(r.goalsB !== undefined ? { goalsB: r.goalsB } : {}),
      }));
    }
    for (const o of moves.open) {
      episodes.set(o.sighting.key, o.episode);
      state.push(prow({ key: o.sighting.key, episode: o.episode, firstSeenAt: o.sighting.newestAt, lastSeenAt: o.sighting.newestAt,
        evidence: o.sighting.evidence, goalsA: o.goalsA, goalsB: o.goalsB }));
    }
  }
  return out;
}
const shape = (mv: PairMoves) => ({ open: mv.open.map((o) => [o.sighting.key, o.episode]), refresh: mv.refresh.map((r) => r.id), close: mv.close.map((c) => [c.id, c.why]) });
const NOTHING = { open: [], refresh: [], close: [] };
const rule = (choice: GoalConflictChoice, at: number, stamp?: string) => (state: StandingPairRow[]): void => {
  const i = state.findIndex((r) => r.key === GC);
  state[i] = { ...state[i]!, ruled: { choice, at, by: 'op-a' }, ...(stamp ? { goalsA: stamp, goalsB: stamp } : {}) };
};

export const MOVE_CASES: OverlapsCase[] = [
  { name: 'a first sighting opens episode 1, then refreshes on every later pass and opens nothing again', run: (m) => {
    const s = sight(OV, NOW - HOUR);
    const r = passes(m, [], {}, [{ sightings: [s] }, { sightings: [s] }, { sightings: [s] }, { sightings: [s] }]).map(shape);
    expect(r[0]).toEqual({ open: [[OV, 1]], refresh: [], close: [] });
    for (const x of r.slice(1)) expect([x.open, x.close]).toEqual([[], []]);
    expect(r[1]!.refresh).toHaveLength(1);
  } },
  { name: 'a sighting after a closed episode 2 opens episode 3', run: (m) => {
    const r = passes(m, [], { [OV]: 2 }, [{ sightings: [sight(OV, NOW)] }, { sightings: [sight(OV, NOW)] }, {}]).map(shape);
    expect(r[0]!.open).toEqual([[OV, 3]]);
    expect(r[1]!.open).toEqual([]);
  } },
  { name: 'an open for a goal conflict carries the stamps; for an overlap, null', run: (m) => {
    const [a] = passes(m, [], {}, [{ sightings: [sight(GC, NOW), sight(OV, NOW)], facts: { goalsStamp: (s) => `stamp-${s}` } }]);
    const byKey = Object.fromEntries(a!.open.map((o) => [o.sighting.key, [o.goalsA, o.goalsB]]));
    expect(byKey).toEqual({ [GC]: ['stamp-prog-a', 'stamp-prog-b'], [OV]: [null, null] });
  } },
  { name: 'an overlap seen again refreshes, keeps firstSeenAt, and lastSeenAt is the evidence\'s time, not now', run: (m) => {
    const row0 = prow({ key: OV, firstSeenAt: NOW - 3 * DAY, lastSeenAt: NOW - 3 * DAY });
    const later = NOW + 40 * DAY;
    const out = passes(m, [row0], {}, [
      { sightings: [sight(OV, NOW - HOUR)], facts: { now: later } },
      { sightings: [sight(OV, NOW - 2 * HOUR)], facts: { now: later } },
      { sightings: [sight(OV, NOW - 2 * HOUR)], facts: { now: later } },
    ]);
    expect(out[0]!.refresh.map((r) => r.lastSeenAt)).toEqual([NOW - HOUR]);
    expect(out[1]!.refresh.map((r) => r.lastSeenAt)).toEqual([NOW - HOUR]);
    expect(out.every((o) => o.open.length === 0 && o.close.length === 0)).toBe(true);
  } },
  { name: 'a refresh never moves lastSeenAt back: the larger of the row\'s and the sighting\'s', run: (m) => {
    const row0 = prow({ key: OV, lastSeenAt: NOW });
    const out = passes(m, [row0], {}, [{ sightings: [sight(OV, NOW - 5 * HOUR)] }, { sightings: [sight(OV, NOW - 5 * HOUR)] }, { sightings: [sight(OV, NOW + HOUR)] }]);
    expect(out.map((o) => o.refresh[0]!.lastSeenAt)).toEqual([NOW, NOW, NOW + HOUR]);
  } },
  { name: 'a refresh merges the evidence; an unreadable row\'s evidence is replaced by the sighting\'s', run: (m) => {
    const row0 = prow({ key: OV, evidence: E({ sources: ['radar'], paths: ['a.ts'], prs: [3] }), lastSeenAt: NOW - HOUR });
    const [a] = passes(m, [row0], {}, [{ sightings: [sight(OV, NOW, { sources: ['claim-collision'], paths: ['b.ts'], claimIds: [4] })] }]);
    expect(a!.refresh[0]!.evidence).toEqual(E({ sources: ['claim-collision', 'radar'], paths: ['a.ts', 'b.ts'], claimIds: [4], prs: [3] }));
    const bad = prow({ key: OV, evidence: 'unreadable' });
    const [b] = passes(m, [bad], {}, [{ sightings: [sight(OV, NOW, { paths: ['b.ts'] })] }]);
    expect(b!.refresh[0]!.evidence.paths).toEqual(['b.ts']);
  } },
  { name: 'an overlap whose newest evidence is 24 hours old closes lapsed, 23 hours 59 minutes does not, and none closes when a source was not read', run: (m) => {
    const row0 = prow({ key: OV, lastSeenAt: NOW });
    const out = passes(m, [row0], {}, [
      { facts: { now: NOW + 24 * HOUR - 60_000 } },
      { facts: { now: NOW + 24 * HOUR, overlapSourcesRead: false } },
      { facts: { now: NOW + 24 * HOUR } },
      { facts: { now: NOW + 25 * HOUR } },
    ]).map(shape);
    expect(out[0]).toEqual(NOTHING);
    expect(out[1]).toEqual(NOTHING);
    expect(out[2]).toEqual({ open: [], refresh: [], close: [[row0.id, 'lapsed']] });
    expect(out[3]).toEqual(NOTHING);
  } },
  { name: 'an overlap never reads a programme\'s liveness or goals', run: (m) => {
    const boom = (): never => { throw new Error('read'); };
    const row0 = prow({ key: OV, lastSeenAt: NOW });
    const mv = m.pairMoves([row0], [sight(OV, NOW)], new Map(), mfacts({ live: boom, openRun: boom, goalsStamp: boom }));
    expect(mv.refresh).toHaveLength(1);
  } },
  { name: 'F1: a goal-conflict sighting that stays while one programme reads not live closes the episode on pass 1 and opens nothing on passes 2 to 4', run: (m) => {
    const row0 = prow({ key: GC });
    const s = sight(GC, NOW);
    const dead = { live: (slug: string) => slug !== 'prog-b' };
    const out = passes(m, [row0], {}, [
      { sightings: [s], facts: dead }, { sightings: [s], facts: dead }, { sightings: [s], facts: dead }, { sightings: [s], facts: dead },
    ]).map(shape);
    expect(out[0]).toEqual({ open: [], refresh: [], close: [[row0.id, 'programme-ended']] });
    for (const x of out.slice(1)) expect(x).toEqual(NOTHING);
  } },
  { name: 'F1: with no row, a sighting of an ended programme opens nothing on any pass (rule 3)', run: (m) => {
    const s = sight(GC, NOW);
    const dead = { live: (slug: string) => slug !== 'prog-a' };
    const out = passes(m, [], {}, [{ sightings: [s], facts: dead }, { sightings: [s], facts: dead }, { sightings: [s], facts: dead }]).map(shape);
    for (const x of out) expect(x).toEqual(NOTHING);
  } },
  { name: 'F1: live unmeasured moves nothing for the key on any pass, with a row or without', run: (m) => {
    const s = sight(GC, NOW);
    const unk = { live: (slug: string): Fact<boolean> => (slug === 'prog-b' ? 'unmeasured' : true) };
    const none = passes(m, [], {}, [{ sightings: [s], facts: unk }, { sightings: [s], facts: unk }, { sightings: [s], facts: unk }]).map(shape);
    for (const x of none) expect(x).toEqual(NOTHING);
    const withRow = passes(m, [prow({ key: GC })], {}, [{ sightings: [s], facts: unk }, { facts: unk }, { sightings: [s], facts: unk }]).map(shape);
    for (const x of withRow) expect(x).toEqual(NOTHING);
  } },
  { name: 'an ended programme closes a RULED goal conflict too, and the sighting after it opens nothing', run: (m) => {
    const row0 = prow({ key: GC, ruled: { choice: 'a-first', at: NOW - DAY, by: 'op-a' } });
    const dead = { live: (slug: string) => slug !== 'prog-a' };
    const out = passes(m, [row0], {}, [{ sightings: [sight(GC, NOW)], facts: dead }, { sightings: [sight(GC, NOW)], facts: dead }, {}]).map(shape);
    expect(out[0]!.close).toEqual([[row0.id, 'programme-ended']]);
    expect(out[1]).toEqual(NOTHING);
  } },
  { name: 'F2 trace: open at S0, goals change to S1, rule 9 refreshes the stamps, the ruling stamps S1, the same sighting leaves it ruled, a newer one at S1 too, only a newer one at S2 reopens', run: (m) => {
    const t0 = NOW - 10 * HOUR;
    const out = passes(m, [], {}, [
      { sightings: [sight(GC, t0)], facts: { goalsStamp: () => 'S0' } },                                        // 0 open
      { sightings: [sight(GC, t0)], facts: { goalsStamp: () => 'S1' } },                                        // 1 rule 9
      { sightings: [sight(GC, t0)], facts: { goalsStamp: () => 'S1' }, before: rule('a-first', t0 + HOUR, 'S1') }, // 2 ruled, same sighting
      { sightings: [sight(GC, t0 + 2 * HOUR)], facts: { goalsStamp: () => 'S1' } },                              // 3 newer, S1
      { sightings: [sight(GC, t0 + 3 * HOUR)], facts: { goalsStamp: () => 'S2' } },                              // 4 newer, S2
      { sightings: [sight(GC, t0 + 3 * HOUR)], facts: { goalsStamp: () => 'S2' } },                              // 5 the new episode, unruled
    ]);
    expect(out[0]!.open.map((o) => [o.episode, o.goalsA])).toEqual([[1, 'S0']]);
    expect(out[1]!.refresh.map((r) => [r.goalsA, r.goalsB])).toEqual([['S1', 'S1']]);
    expect([shape(out[2]!).close, shape(out[2]!).open]).toEqual([[], []]);
    expect(out[2]!.refresh.map((r) => r.goalsA)).toEqual([undefined]);
    expect([shape(out[3]!).close, shape(out[3]!).open]).toEqual([[], []]);
    expect(shape(out[4]!).close.map((c) => c[1])).toEqual(['goals-changed']);
    expect(out[4]!.open.map((o) => [o.episode, o.goalsA, o.goalsB])).toEqual([[2, 'S2', 'S2']]);
    expect(out[5]!.open).toEqual([]);
    expect(out[5]!.close).toEqual([]);
    expect(out[5]!.refresh).toHaveLength(1);
  } },
  { name: 'a ruled goal conflict seen again with a changed stamp but no sighting newer than the ruling stays ruled', run: (m) => {
    const ruledAt = NOW - HOUR;
    const row0 = prow({ key: GC, ruled: { choice: 'both-stand', at: ruledAt, by: 'op-a' } });
    const same = { facts: { goalsStamp: () => 'S9' } };
    const out = passes(m, [row0], {}, [
      { sightings: [sight(GC, ruledAt - HOUR)], ...same }, { sightings: [sight(GC, ruledAt)], ...same }, { sightings: [sight(GC, ruledAt - 1)], ...same },
    ]).map(shape);
    for (const x of out) expect([x.open, x.close]).toEqual([[], []]);
    expect(out.every((x) => x.refresh.length === 1)).toBe(true);
  } },
  { name: 'a ruled goal conflict with a newer sighting and a stamp still unmeasured is left alone (rule 6)', run: (m) => {
    const row0 = prow({ key: GC, ruled: { choice: 'a-first', at: NOW - 2 * HOUR, by: 'op-a' } });
    const out = passes(m, [row0], {}, [
      { sightings: [sight(GC, NOW)], facts: { goalsStamp: (s) => (s === 'prog-a' ? 'S2' : 'unmeasured') } },
      { sightings: [sight(GC, NOW)], facts: { goalsStamp: () => 'unmeasured' } },
      { sightings: [sight(GC, NOW)], facts: { goalsStamp: () => 'unmeasured' } },
    ]).map(shape);
    for (const x of out) expect(x).toEqual(NOTHING);
  } },
  { name: 'a ruled goal conflict whose ruling is unreadable is never reopened by a newer sighting', run: (m) => {
    const row0 = prow({ key: GC, ruled: 'unreadable' });
    const out = passes(m, [row0], {}, [
      { sightings: [sight(GC, NOW)], facts: { goalsStamp: () => 'S9' } }, { sightings: [sight(GC, NOW)], facts: { goalsStamp: () => 'S9' } },
      { sightings: [sight(GC, NOW)], facts: { goalsStamp: () => 'S9' } },
    ]).map(shape);
    for (const x of out) expect([x.open, x.close]).toEqual([[], []]);
  } },
  { name: 'a ruled goal conflict whose stored stamps are null is left alone by a newer sighting', run: (m) => {
    const row0 = prow({ key: GC, goalsA: null, goalsB: null, ruled: { choice: 'a-first', at: NOW - HOUR, by: 'op-a' } });
    const out = passes(m, [row0], {}, [{ sightings: [sight(GC, NOW)] }, { sightings: [sight(GC, NOW)] }, { sightings: [sight(GC, NOW)] }]).map(shape);
    for (const x of out) expect(x).toEqual(NOTHING);
  } },
  { name: 'a ruled goal conflict closes goals-changed on a newer sighting whichever side\'s stamp differs, and opens the next episode unruled', run: (m) => {
    for (const odd of ['prog-a', 'prog-b']) {
      const row0 = prow({ key: GC, ruled: { choice: 'b-first', at: NOW - 2 * HOUR, by: 'op-a' } });
      const stamp = (s: string): string => (s === odd ? 'S2' : 'S0');
      const out = passes(m, [row0], {}, [
        { sightings: [sight(GC, NOW - HOUR)], facts: { goalsStamp: stamp } }, { sightings: [sight(GC, NOW - HOUR)], facts: { goalsStamp: stamp } },
        { sightings: [sight(GC, NOW - HOUR)], facts: { goalsStamp: stamp } },
      ]);
      expect(shape(out[0]!)).toEqual({ open: [[GC, 2]], refresh: [], close: [[row0.id, 'goals-changed']] });
      expect(out[0]!.open[0]).toMatchObject({ goalsA: stamp('prog-a'), goalsB: stamp('prog-b') });
      expect(shape(out[1]!).open).toEqual([]);
      expect(shape(out[2]!).close).toEqual([]);
    }
  } },
  { name: 'an unruled goal conflict seen with a changed stamp refreshes its stamps (rule 9), and with a stamp unmeasured refreshes and keeps them (rule 8)', run: (m) => {
    const row0 = prow({ key: GC });
    const out = passes(m, [row0], {}, [
      { sightings: [sight(GC, NOW)], facts: { goalsStamp: () => 'S5' } },
      { sightings: [sight(GC, NOW)], facts: { goalsStamp: (s) => (s === 'prog-b' ? 'unmeasured' : 'S6') } },
      { sightings: [sight(GC, NOW)], facts: { goalsStamp: () => 'unmeasured' } },
    ]);
    expect(out[0]!.refresh.map((r) => [r.goalsA, r.goalsB])).toEqual([['S5', 'S5']]);
    expect(out[1]!.refresh.map((r) => [r.goalsA, r.goalsB])).toEqual([[undefined, undefined]]);
    expect(out[2]!.refresh.map((r) => [r.goalsA, r.goalsB])).toEqual([[undefined, undefined]]);
    for (const o of out) expect([o.open, o.close]).toEqual([[], []]);
  } },
  { name: 'a goal conflict with no row and a stamp unmeasured opens nothing until the stamps read', run: (m) => {
    const s = sight(GC, NOW);
    const out = passes(m, [], {}, [
      { sightings: [s], facts: { goalsStamp: (x) => (x === 'prog-a' ? 'unmeasured' : 'S0') } },
      { sightings: [s], facts: { goalsStamp: (x) => (x === 'prog-b' ? 'unmeasured' : 'S0') } },
      { sightings: [s] }, { sightings: [s] },
    ]).map(shape);
    expect(out[0]).toEqual(NOTHING);
    expect(out[1]).toEqual(NOTHING);
    expect(out[2]!.open).toEqual([[GC, 1]]);
    expect(out[3]!.open).toEqual([]);
  } },
  { name: 'F6: an unruled goal conflict unseen for 14 days with no open run on either side closes lapsed', run: (m) => {
    const row0 = prow({ key: GC, lastSeenAt: NOW });
    const out = passes(m, [row0], {}, [
      { facts: { now: NOW + 14 * DAY - HOUR } }, { facts: { now: NOW + 14 * DAY } }, { facts: { now: NOW + 15 * DAY } },
    ]).map(shape);
    expect(out[0]).toEqual(NOTHING);
    expect(out[1]).toEqual({ open: [], refresh: [], close: [[row0.id, 'lapsed']] });
    expect(out[2]).toEqual(NOTHING);
  } },
  { name: 'F6: it stays with an open run on either side, an open-run read unmeasured, or a history that was not read', run: (m) => {
    const old = NOW + 20 * DAY;
    for (const f of [
      { openRun: (s: string): Fact<boolean> => s === 'prog-a' },
      { openRun: (s: string): Fact<boolean> => s === 'prog-b' },
      { openRun: (): Fact<boolean> => 'unmeasured' },
      { openRun: (s: string): Fact<boolean> => (s === 'prog-a' ? 'unmeasured' : false) },
      { goalHistoryRead: false },
    ]) {
      const row0 = prow({ key: GC, lastSeenAt: NOW });
      const out = passes(m, [row0], {}, [{ facts: { now: old, ...f } }, { facts: { now: old, ...f } }, { facts: { now: old, ...f } }]).map(shape);
      for (const x of out) expect(x).toEqual(NOTHING);
    }
  } },
  { name: 'F6: a ruled one unseen for 30 days with no open run stays', run: (m) => {
    const row0 = prow({ key: GC, lastSeenAt: NOW, ruled: { choice: 'a-first', at: NOW, by: 'op-a' } });
    const out = passes(m, [row0], {}, [{ facts: { now: NOW + 30 * DAY } }, { facts: { now: NOW + 40 * DAY } }, { facts: { now: NOW + 50 * DAY } }]).map(shape);
    for (const x of out) expect(x).toEqual(NOTHING);
    const bad = prow({ key: GC, lastSeenAt: NOW, ruled: 'unreadable' });
    expect(passes(m, [bad], {}, [{ facts: { now: NOW + 30 * DAY } }]).map(shape)[0]).toEqual(NOTHING);
  } },
  { name: 'an overlap is not lapsed by the goal-conflict rule, and a goal conflict is not lapsed by the overlap rule', run: (m) => {
    const o = prow({ key: OV, lastSeenAt: NOW });
    const g = prow({ key: GC, lastSeenAt: NOW });
    const out = passes(m, [o, g], {}, [{ facts: { now: NOW + 2 * DAY } }, { facts: { now: NOW + 2 * DAY } }, { facts: { now: NOW + 2 * DAY } }]).map(shape);
    expect(out[0]).toEqual({ open: [], refresh: [], close: [[o.id, 'lapsed']] });
    expect(out[1]).toEqual(NOTHING);
    const none = passes(m, [prow({ key: OV, lastSeenAt: NOW })], {}, [{ facts: { now: NOW + 2 * DAY, overlapSourcesRead: false, goalHistoryRead: true } }]).map(shape);
    expect(none[0]).toEqual(NOTHING);
    const none2 = passes(m, [prow({ key: GC, lastSeenAt: NOW })], {}, [{ facts: { now: NOW + 20 * DAY, overlapSourcesRead: false, goalHistoryRead: true } }]).map(shape);
    expect(none2[0]!.close).toHaveLength(1);
  } },
  { name: 'an unmeasured live or stamp read moves nothing for that key, and moves the other keys', run: (m) => {
    const OV2 = 'overlap:prog-a:prog-c';
    const GC2 = 'goal-conflict:prog-c:prog-d';
    const facts = { live: (s: string): Fact<boolean> => (s === 'prog-d' ? 'unmeasured' : true) };
    const out = passes(m, [], {}, [
      { sightings: [sight(OV2, NOW), sight(GC2, NOW), sight(GC, NOW)], facts },
      { sightings: [sight(OV2, NOW), sight(GC2, NOW), sight(GC, NOW)], facts },
      { sightings: [sight(OV2, NOW), sight(GC2, NOW), sight(GC, NOW)], facts },
    ]).map(shape);
    expect(out[0]!.open.map((o) => o[0])).toEqual([GC, OV2]);
    expect(out[1]!.open).toEqual([]);
    expect(out[2]!.open).toEqual([]);
    expect(out[1]!.refresh).toHaveLength(2);
  } },
  { name: 'a key with two standing rows moves on the newest episode alone', run: (m) => {
    const old = prow({ key: OV, episode: 1, lastSeenAt: NOW });
    const cur = prow({ key: OV, episode: 2, lastSeenAt: NOW });
    const mv = m.pairMoves([old, cur], [sight(OV, NOW)], new Map([[OV, 2]]), mfacts());
    expect(mv.refresh.map((r) => r.id)).toEqual([cur.id]);
  } },
  { name: 'a key outside the grammar moves nothing', run: (m) => {
    const bad = { ...sight(OV, NOW), key: 'overlap:prog-b:prog-a' };
    expect(m.pairMoves([], [bad], new Map(), mfacts())).toEqual({ open: [], refresh: [], close: [] });
  } },
  { name: 'PROPERTY adding a sighting never adds a lapsed or programme-ended close (a ruled episode\'s goals-changed close is its one new close)', run: (m) => {
    const rnd = mulberry32(0xface);
    const keys = [OV, GC, 'overlap:prog-a:prog-c', 'goal-conflict:prog-b:prog-c'];
    for (let i = 0; i < 300; i++) {
      const standing = keys.filter(() => rnd() < 0.7).map((k) => prow({
        key: k, lastSeenAt: NOW - Math.floor(rnd() * 20 * DAY),
        ruled: k.startsWith('goal') && rnd() < 0.4 ? { choice: 'a-first', at: NOW - Math.floor(rnd() * 5 * DAY), by: 'op-a' } : null,
      }));
      const dead = rnd() < 0.3 ? 'prog-c' : '';
      const f = mfacts({ now: NOW + Math.floor(rnd() * 3 * DAY), live: (s) => s !== dead, openRun: () => rnd() < 0.5 });
      const f2 = { ...f, openRun: () => false };
      const extra = sight(keys[Math.floor(rnd() * keys.length)]!, NOW - Math.floor(rnd() * 2 * DAY));
      const base = m.pairMoves(standing, [], new Map(), { ...f2 });
      const more = m.pairMoves(standing, [extra], new Map(), { ...f2 });
      const baseCloses = new Set(base.close.map((c) => `${c.id}:${c.why}`));
      for (const c of more.close) {
        if (c.why === 'goals-changed') continue;
        expect(baseCloses.has(`${c.id}:${c.why}`), `case ${i}`).toBe(true);
      }
    }
  } },
  { name: 'PROPERTY with no sighting nothing opens, at any time; with sightings the opens do not depend on the clock', run: (m) => {
    const rnd = mulberry32(0xbeef);
    const keys = [OV, GC, 'overlap:prog-a:prog-c', 'goal-conflict:prog-b:prog-c'];
    for (let i = 0; i < 300; i++) {
      const standing = keys.filter(() => rnd() < 0.5).map((k) => prow({ key: k, lastSeenAt: NOW - Math.floor(rnd() * 20 * DAY) }));
      const sights = keys.filter(() => rnd() < 0.5).map((k) => sight(k, NOW - Math.floor(rnd() * 2 * DAY)));
      const t1 = NOW + Math.floor(rnd() * 40 * DAY);
      const t2 = t1 + Math.floor(rnd() * 40 * DAY);
      expect(m.pairMoves(standing, [], new Map(), mfacts({ now: t2 })).open, `case ${i}`).toEqual([]);
      const o1 = m.pairMoves(standing, sights, new Map(), mfacts({ now: t1 })).open.map((o) => o.sighting.key);
      const o2 = m.pairMoves(standing, sights, new Map(), mfacts({ now: t2 })).open.map((o) => o.sighting.key);
      expect(o2, `case ${i}`).toEqual(o1);
    }
  } },
];

// ---------------------------------------------------------------------------------------------------------------------
// pairBlocks, blockingPairs and relayConflictVerdict

const gcEvidence = (o: Partial<PairEvidence> = {}): PairEvidence => E({ sources: ['claim-history'], paths: [X], triples: 2, ...o });
const brow = (o: Partial<StandingPairRow> & { key?: string } = {}): StandingPairRow => prow({ key: GC, evidence: gcEvidence(), ...o });
const ruledAs = (choice: GoalConflictChoice, at = NOW - DAY): StandingPairRow['ruled'] => ({ choice, at, by: 'op-a' });
const relay = (target: string, expectedPaths: readonly string[] = []) => ({ target, expectedPaths });
const NEVER = (): Fact<boolean> => { throw new Error('landedSince must not be asked'); };

export const BLOCK_CASES: OverlapsCase[] = [
  { name: 'an overlap never blocks', run: (m) => {
    expect(m.pairBlocks(prow({ key: OV, evidence: gcEvidence() }), relay(A))).toBe(false);
    expect(m.pairBlocks(prow({ key: OV, evidence: 'unreadable' }), relay(A))).toBe(false);
  } },
  { name: 'a target outside the pair never blocks; either member does', run: (m) => {
    expect(m.pairBlocks(brow(), relay(C))).toBe(false);
    expect(m.pairBlocks(brow(), relay(A))).toBe(true);
    expect(m.pairBlocks(brow(), relay(B))).toBe(true);
  } },
  { name: 'empty expected paths block (the relay cannot show it does not deepen)', run: (m) => {
    expect(m.pairBlocks(brow(), relay(A, []))).toBe(true);
  } },
  { name: 'a disjoint path list does not block; an equal, contained or containing path does', run: (m) => {
    expect(m.pairBlocks(brow(), relay(A, ['pwa/src/z.ts']))).toBe(false);
    expect(m.pairBlocks(brow(), relay(A, ['server/src-old']))).toBe(false);
    expect(m.pairBlocks(brow(), relay(A, [X]))).toBe(true);
    expect(m.pairBlocks(brow(), relay(A, ['server/src']))).toBe(true);
    expect(m.pairBlocks(brow(), relay(A, ['pwa/src/z.ts', 'server/src/x.ts/deeper']))).toBe(true);
  } },
  { name: 'cut evidence blocks whatever the paths; unreadable evidence blocks too', run: (m) => {
    expect(m.pairBlocks(brow({ evidence: gcEvidence({ pathsCut: true }) }), relay(A, ['pwa/src/z.ts']))).toBe(true);
    expect(m.pairBlocks(brow({ evidence: 'unreadable' }), relay(A, ['pwa/src/z.ts']))).toBe(true);
    expect(m.pairBlocks(brow({ evidence: 'unreadable' }), relay(A))).toBe(true);
    expect(m.pairBlocks(brow({ evidence: 'unreadable' }), relay(C))).toBe(false);
  } },
  { name: 'a goal conflict whose evidence shows one triple, or none, never blocks (question 5)', run: (m) => {
    for (const triples of [0, 1]) {
      expect(m.pairBlocks(brow({ evidence: gcEvidence({ triples }) }), relay(A)), `triples ${triples}`).toBe(false);
      expect(m.pairBlocks(brow({ evidence: gcEvidence({ triples, pathsCut: true }) }), relay(A, [X])), `triples ${triples}`).toBe(false);
    }
    expect(m.pairBlocks(brow({ evidence: gcEvidence({ triples: 3 }) }), relay(A))).toBe(true);
  } },
  { name: 'blockingPairs answers exactly the rows pairBlocks passes, in key order', run: (m) => {
    const k1 = 'goal-conflict:prog-a:prog-b', k2 = 'goal-conflict:prog-a:prog-c', k3 = 'goal-conflict:prog-b:prog-c', k4 = 'goal-conflict:prog-a:prog-d';
    const rows = [
      prow({ key: k3, evidence: gcEvidence() }), prow({ key: k1, evidence: gcEvidence() }), prow({ key: k4, evidence: gcEvidence({ triples: 1 }) }),
      prow({ key: OV }), prow({ key: k2, evidence: gcEvidence({ paths: ['pwa/src/z.ts'] }) }),
    ];
    const r = relay(A, [X]);
    const got = m.blockingPairs(rows, r);
    expect(got.map((p) => p.key)).toEqual([k1]);
    const r2 = relay(C);
    expect(m.blockingPairs(rows, r2).map((p) => p.key)).toEqual([k2, k3]);
    const all = [...rows].sort().filter((p) => m.pairBlocks(p, r2)).map((p) => p.key).sort();
    expect(m.blockingPairs(rows, r2).map((p) => p.key)).toEqual(all);
    expect(m.blockingPairs([], r2)).toEqual([]);
  } },
  { name: 'two episodes of one key come back in episode order', run: (m) => {
    const e2 = brow({ episode: 2 });
    const e1 = brow({ episode: 1 });
    expect(m.blockingPairs([e2, e1], relay(A)).map((p) => p.episode)).toEqual([1, 2]);
  } },
];

const choices = Object.keys(GOAL_CONFLICT_CHOICES) as GoalConflictChoice[];

export const VERDICT_CASES: OverlapsCase[] = [
  { name: 'no standing pair passes, and landedSince is never asked', run: (m) => {
    expect(m.relayConflictVerdict([], relay(A), NEVER)).toEqual({ ok: true });
  } },
  { name: 'a pair the relay does not deepen is never consulted: an unruled one outside the target or the paths passes', run: (m) => {
    expect(m.relayConflictVerdict([brow()], relay(C), NEVER)).toEqual({ ok: true });
    expect(m.relayConflictVerdict([brow()], relay(A, ['pwa/src/z.ts']), NEVER)).toEqual({ ok: true });
    expect(m.relayConflictVerdict([prow({ key: OV })], relay(A), NEVER)).toEqual({ ok: true });
    expect(m.relayConflictVerdict([brow({ evidence: gcEvidence({ triples: 1 }) })], relay(A), NEVER)).toEqual({ ok: true });
  } },
  { name: 'an unruled blocking pair refuses unruled, naming its key and episode', run: (m) => {
    expect(m.relayConflictVerdict([brow({ episode: 3 })], relay(A), NEVER))
      .toEqual({ ok: false, word: 'goal-conflict-open', key: GC, episode: 3, why: 'unruled' });
  } },
  { name: 'an unreadable ruling refuses ruling-unreadable (fail closed); so does a choice word this build does not know', run: (m) => {
    expect(m.relayConflictVerdict([brow({ ruled: 'unreadable' })], relay(B), NEVER))
      .toMatchObject({ ok: false, why: 'ruling-unreadable' });
    const odd = { choice: 'toString' as GoalConflictChoice, at: NOW, by: 'op-a' };
    expect(m.relayConflictVerdict([brow({ ruled: odd })], relay(B), NEVER)).toMatchObject({ ok: false, why: 'ruling-unreadable' });
  } },
  { name: 'both-stand passes either programme without asking about a landing', run: (m) => {
    for (const t of [A, B]) expect(m.relayConflictVerdict([brow({ ruled: ruledAs('both-stand') })], relay(t), NEVER)).toEqual({ ok: true });
  } },
  { name: 'a-first: a relay to b waits for a to land after the ruling; a relay to a passes', run: (m) => {
    const ruledAt = NOW - 5 * HOUR;
    const asked: [string, number][] = [];
    const row0 = brow({ ruled: ruledAs('a-first', ruledAt), episode: 2 });
    const landed = (v: Fact<boolean>) => (p: string, at: number): Fact<boolean> => { asked.push([p, at]); return v; };
    expect(m.relayConflictVerdict([row0], relay(A), NEVER)).toEqual({ ok: true });
    expect(m.relayConflictVerdict([row0], relay(B), landed(true))).toEqual({ ok: true });
    expect(asked).toEqual([[A, ruledAt]]);
    expect(m.relayConflictVerdict([row0], relay(B), landed(false))).toEqual({ ok: false, word: 'goal-conflict-open', key: GC, episode: 2, why: 'waits-for-landing' });
    expect(m.relayConflictVerdict([row0], relay(B), landed('unmeasured'))).toMatchObject({ ok: false, why: 'landing-unmeasured' });
  } },
  { name: 'b-first: a relay to a waits for b to land after the ruling; a relay to b passes', run: (m) => {
    const ruledAt = NOW - 5 * HOUR;
    const asked: [string, number][] = [];
    const row0 = brow({ ruled: ruledAs('b-first', ruledAt) });
    const landed = (v: Fact<boolean>) => (p: string, at: number): Fact<boolean> => { asked.push([p, at]); return v; };
    expect(m.relayConflictVerdict([row0], relay(B), NEVER)).toEqual({ ok: true });
    expect(m.relayConflictVerdict([row0], relay(A), landed(true))).toEqual({ ok: true });
    expect(asked).toEqual([[B, ruledAt]]);
    expect(m.relayConflictVerdict([row0], relay(A), landed(false))).toMatchObject({ ok: false, why: 'waits-for-landing' });
    expect(m.relayConflictVerdict([row0], relay(A), landed('unmeasured'))).toMatchObject({ ok: false, why: 'landing-unmeasured' });
  } },
  { name: 'every choice reads only its waits column: the verdict for each row matches the table', run: (m) => {
    for (const c of choices) {
      for (const t of [A, B]) {
        const row0 = brow({ ruled: ruledAs(c) });
        const w = GOAL_CONFLICT_CHOICES[c].waits;
        const waits = w !== 'none' && (w === 'a') === (t === A);
        expect(m.relayConflictVerdict([row0], relay(t), () => false).ok, `${c} to ${t}`).toBe(!waits);
        expect(m.relayConflictVerdict([row0], relay(t), () => true).ok, `${c} to ${t} landed`).toBe(true);
      }
    }
  } },
  { name: 'two blocking rows, the first passing and the second unruled, refuse with the second\'s key', run: (m) => {
    const k2 = 'goal-conflict:prog-a:prog-c';
    const first = brow({ ruled: ruledAs('both-stand') });
    const second = prow({ key: k2, evidence: gcEvidence(), episode: 4 });
    expect(m.relayConflictVerdict([second, first], relay(A), NEVER)).toEqual({ ok: false, word: 'goal-conflict-open', key: k2, episode: 4, why: 'unruled' });
  } },
  { name: 'rows are read in key order: the first refusal in key order wins', run: (m) => {
    const k2 = 'goal-conflict:prog-a:prog-c';
    const r1 = brow({ ruled: 'unreadable' });
    const r2 = prow({ key: k2, evidence: gcEvidence() });
    expect(m.relayConflictVerdict([r2, r1], relay(A), NEVER)).toMatchObject({ key: GC, why: 'ruling-unreadable' });
  } },
  { name: 'PROPERTY adding an unruled blocking row never turns a refusal into a pass', run: (m) => {
    const rnd = mulberry32(0x7e57);
    for (let i = 0; i < 300; i++) {
      const rows = randomRows(rnd);
      const r = relay([A, B, C][Math.floor(rnd() * 3)]!, rnd() < 0.5 ? [] : [X]);
      const landed = rnd() < 0.5;
      const before = m.relayConflictVerdict(rows, r, () => landed);
      const extra = prow({ key: `goal-conflict:${r.target < 'prog-z' ? r.target : A}:prog-z`, evidence: gcEvidence() });
      const after = m.relayConflictVerdict([...rows, extra], r, () => landed);
      if (!before.ok) expect(after.ok, `case ${i}`).toBe(false);
      expect(after.ok, `case ${i}: an unruled blocking row`).toBe(false);
    }
  } },
  { name: 'PROPERTY ruling a row both-stand never turns a pass into a refusal', run: (m) => {
    const rnd = mulberry32(0x7e58);
    for (let i = 0; i < 300; i++) {
      const rows = randomRows(rnd);
      const r = relay([A, B, C][Math.floor(rnd() * 3)]!, rnd() < 0.5 ? [] : [X]);
      const landed = rnd() < 0.5;
      const before = m.relayConflictVerdict(rows, r, () => landed);
      const k = Math.floor(rnd() * rows.length);
      const ruled = rows.map((p, j) => (j === k ? { ...p, ruled: ruledAs('both-stand') } : p));
      const after = m.relayConflictVerdict(ruled, r, () => landed);
      if (before.ok) expect(after.ok, `case ${i}`).toBe(true);
    }
  } },
  { name: 'PROPERTY narrowing expectedPaths from empty to disjoint never adds a refusal', run: (m) => {
    const rnd = mulberry32(0x7e59);
    for (let i = 0; i < 300; i++) {
      const rows = randomRows(rnd);
      const target = [A, B, C][Math.floor(rnd() * 3)]!;
      const landed = rnd() < 0.5;
      const wide = m.relayConflictVerdict(rows, relay(target, []), () => landed);
      const narrow = m.relayConflictVerdict(rows, relay(target, ['docs/elsewhere.md']), () => landed);
      if (wide.ok) expect(narrow.ok, `case ${i}`).toBe(true);
    }
  } },
];

function randomRows(rnd: () => number): StandingPairRow[] {
  const keys = ['goal-conflict:prog-a:prog-b', 'goal-conflict:prog-a:prog-c', 'goal-conflict:prog-b:prog-c', 'overlap:prog-a:prog-b'];
  return keys.filter(() => rnd() < 0.6).map((k) => {
    const pick = rnd();
    const ruled = pick < 0.25 ? null : pick < 0.3 ? 'unreadable' as const : ruledAs(choices[Math.floor(rnd() * choices.length)]!, NOW - Math.floor(rnd() * DAY));
    return prow({ key: k, ruled, evidence: rnd() < 0.1 ? 'unreadable' : gcEvidence({ triples: rnd() < 0.15 ? 1 : 2, pathsCut: rnd() < 0.1 }) });
  });
}
