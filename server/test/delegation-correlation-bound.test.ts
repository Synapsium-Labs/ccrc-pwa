// Delegation broker, the correlation lane's per-tree work (D-5642): a reconcile pass hands the SAME four pass-wide arrays (the listing windows,
// the activity rows, the accepted-evidence rows and the point metas) to every census tree's input, and to every forced rerun after it. A
// pass that builds what it needs from those arrays ONCE (its indexes, its filtered lists) reads each array, and each of its elements, a
// constant number of times however many trees it correlates; one that rescans them per tree reads them in proportion to the trees, which is
// what kept the server's event loop busy for seconds a pass on a busy repository.
//
//   D-5642 R1, the pass pin. Each of the four arrays is a Proxy that counts every read of it (the iterator, every Array.prototype method,
//      every index), and each element (each window, each evidence row and its event, each activity row, each point meta) is a Proxy that
//      counts the reads of its own properties. A run builds ONE world of forty census records (the arrays always hold the evidence, the
//      windows and the metas of all forty) and runs the lane's calls over the first n of them, in the order and under the conditions
//      `watch.ts` makes them (`correlateDelegation` for every tree around a FRESH input object per call, then `delegationMarkForced` and
//      `delegationUnknownWindowForced`, then `delegationLostEvidenceForced`), the lane's two lost windows included. A pass over 20 trees
//      and one over 40 must read each array the same number of times, and the busiest element of each family the same number of times.
//      No clock. The floor keeps the row from passing for the wrong reason: the arrays a shape does traverse at main are still traversed.
//      The element count means a per-pass index answers from data copied ONCE per pass, never by re-reading a shared row per tree: every
//      rung-3 hit resolves to the same agent activity row, so a pass that asks that row a question per tree reads it in proportion to the
//      trees even if it builds no index over the array. The pin also sees the sole-added index being rebuilt per call (M15): the builder reads
//      each window's fields (`lost`, `after`, ...) on every build, so a rebuild per tree shows as window reads that grow with the trees.
//
// Fixtures only: names are `lane-a-demo`, `lane-b-demo`, `project-a`, `/fixture/...`. No file is read or written.
import { describe, it, expect } from 'vitest';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import { buildDelegationJournalRecord } from '../src/coord/delegation-journal.js';
import { recoverDelegation } from '../src/coord/delegation-checkpoint.js';
import {
  DELEGATION_DROPPED_UNMEASURED,
  DELEGATION_NO_MARKS,
  correlateDelegation,
  delegationHashSetAdd,
  delegationLostEvidenceForced,
  delegationMarkForced,
  delegationUnknownWindowForced,
  emptyDelegationHashSet,
  indexDelegationDropped,
  type DelegationCorrelationInput,
  type DelegationCorrelationVerdict,
  type DelegationDroppedEvidence,
  type DelegationDroppedKey,
  type DelegationHashSet,
  type DelegationListingWindow,
  type DelegationMarkKind,
} from '../src/coord/delegation-correlation.js';
import {
  canonicalDelegationJson,
  delegationSha256Hex,
  formatDelegationInstant,
  type DelegationActivityRow,
  type DelegationCensusRecord,
  type DelegationJournalRecordV1,
} from '../src/coord/delegation-model.js';
import { delegationLostWindowsOf, delegationNotReadyWindowOf } from '../src/watch.js';

// ── fixtures (the style of delegation-correlation-cost.test.ts, copied: a test file imports no other test file) ────────

const PARENT = 'lane-a-demo';
const OTHER = 'lane-b-demo';
const THIRD = 'lane-c-demo';
const INC = 'g1';
const AGENT = 'abc123def456';
const REPO = 'project-a';
const CLAUDE = '11111111-2222-3333-4444-555555555555';
const WTP = (project: string, name: string): string => `/fixture/${project}/.claude/worktrees/${name}`;
const T = (s: number): string => formatDelegationInstant(Date.UTC(2026, 9, 14) + s * 1000);

interface Over { sessionId?: string; parentIncarnation?: string; cwd?: string }
const mkBase = (n: number, over: Over = {}) => ({
  v: 1 as const, observedAt: T(n), sessionId: over.sessionId ?? PARENT, parentIncarnation: over.parentIncarnation ?? INC,
  claudeSessionId: CLAUDE, ...(over.cwd === undefined ? {} : { cwd: over.cwd }),
  eventId: delegationSha256Hex(`fixture-bound-event-${n}`), bucket: '2026101400', startOffset: n * 100, endOffset: n * 100 + 99,
});
const bashPre = (n: number, toolUseId: string, listing: readonly string[], over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...mkBase(n, over), eventKind: 'PreToolUse', toolName: 'Bash', toolUseId, listing });
const bashPost = (n: number, toolUseId: string, listing: readonly string[], over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...mkBase(n, over), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId, outcome: 'completed', listing });
const subagentStart = (n: number, agentId: string, over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...mkBase(n, over), eventKind: 'SubagentStart', agentId, agentType: null });
/** A tool event from INSIDE a subagent, with a working directory: the evidence rung 3 reads. */
const toolIn = (n: number, agentId: string, cwd: string, over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...mkBase(n, { ...over, cwd }), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_in_${n}`, outcome: 'completed', agentId });

function world(events: readonly DelegationEventEnvelopeV1[]) {
  const records: DelegationJournalRecordV1[] = [];
  let prev: string | null = null;
  events.forEach((event, i) => {
    const r = buildDelegationJournalRecord({ sequence: i + 1, acceptedAt: T(100000 + i + 1), previousDigest: prev, entry: { kind: 'evidence-accepted', event } });
    records.push(r);
    prev = r.digest;
  });
  const report = recoverDelegation(null, records);
  expect(report.failure).toBeNull();
  const acceptedEvidence = records.map((r) => {
    if (r.entry.kind !== 'evidence-accepted') throw new Error('fixture journals hold evidence only');
    return { journalId: r.journalId, event: r.entry.event };
  });
  return { activities: report.state.checkpoint.activities, acceptedEvidence };
}

const rawRecord = (name: string, project: string = REPO): DelegationCensusRecord => ({
  project, adminRecord: name, canonicalPath: WTP(project, name), headBranch: 'raw-branch', headSha: null,
  claudeBase: 'main', locked: false, baseAgreesFirstLog: true, state: 'present', diagnostic: null,
});
const input = (over: Partial<DelegationCorrelationInput> = {}): DelegationCorrelationInput => ({
  record: rawRecord('wt-raw'), runChildAgreement: null, activities: [], acceptedEvidence: [], pointMetas: [], listingWindows: [],
  birthPassesRemaining: 0, hasRegistryRow: false, hasChildMarker: false, evidenceHorizon: null, droppedEvidence: indexDelegationDropped([]),
  firstSighting: { after: T(1_000_000), at: T(1_000_060) }, ...over,
});

/** A measured index whose marks name an id nothing here uses and the canonical paths of the trees given. */
const marksFor = (markedPaths: readonly string[]): DelegationDroppedEvidence => {
  const ids = emptyDelegationHashSet();
  delegationHashSetAdd(ids, 'unrelated-id', 100);
  const paths: DelegationHashSet = emptyDelegationHashSet();
  for (const path of markedPaths) delegationHashSetAdd(paths, path, 100);
  return indexDelegationDropped([], { ...DELEGATION_NO_MARKS, ids, paths: markedPaths.length === 0 ? [] : [paths] });
};

// ── the lane, replayed ────────────────────────────────────────────────────────────────────────────────────────────────

interface Tree {
  record: DelegationCensusRecord;
  firstSighting: { after: string | null; at: string };
  evidenceHorizon: string | null;
}
type Activities = DelegationCorrelationInput['activities'];
type Evidence = DelegationCorrelationInput['acceptedEvidence'];
type Metas = DelegationCorrelationInput['pointMetas'];
interface Arrays {
  listingWindows: readonly DelegationListingWindow[];
  activities: Activities;
  acceptedEvidence: Evidence;
  pointMetas: Metas;
}

interface LaneAnswer {
  verdict: DelegationCorrelationVerdict;
  /** `delegationMarkForced`, asked only under a measured index (else null). */
  mark: DelegationMarkKind | null;
  /** `delegationUnknownWindowForced`, asked only when a held window has no repository and no mark answered (else false). */
  unknown: boolean;
  /** `delegationLostEvidenceForced`, asked only of an `unmeasured` verdict (else null). */
  lost: boolean | null;
}

/**
 * The calls `watch.ts` makes once the pass's arrays are built, in its order and under its conditions: the ladder for every tree around a
 * FRESH input object; then, when the index is measured or a held window has no repository (`unknownWindows`, which the lane computes once
 * per pass: so the caller hands it in, measured with the counting off), for every tree `mark ?? (unknown ? 'window' : null)`; then, for
 * every `unmeasured` verdict, the lost-evidence rerun.
 */
function runLane(trees: readonly Tree[], arrays: Arrays, dropped: DelegationDroppedEvidence, unknownWindows: boolean): LaneAnswer[] {
  const inputFor = (t: Tree): DelegationCorrelationInput => input({
    record: t.record, activities: arrays.activities, acceptedEvidence: arrays.acceptedEvidence, pointMetas: arrays.pointMetas,
    listingWindows: arrays.listingWindows, droppedEvidence: dropped, evidenceHorizon: t.evidenceHorizon, firstSighting: t.firstSighting,
  });
  const pairs = trees.map((t) => ({ t, verdict: correlateDelegation(inputFor(t)) }));
  const answers: LaneAnswer[] = pairs.map(({ verdict }) => ({ verdict, mark: null, unknown: false, lost: null }));
  if (dropped.measured || unknownWindows) {
    pairs.forEach(({ t, verdict }, i) => {
      const inp = inputFor(t);
      const a = answers[i]!;
      if (dropped.measured) a.mark = delegationMarkForced(inp, verdict);
      if (unknownWindows && a.mark === null) a.unknown = delegationUnknownWindowForced(inp, verdict);
    });
  }
  pairs.forEach(({ t, verdict }, i) => {
    if (verdict.kind !== 'unmeasured') return;
    answers[i]!.lost = delegationLostEvidenceForced(inputFor(t), verdict);
  });
  return answers;
}
const summary = (v: DelegationCorrelationVerdict): string => (v.kind === 'linked' ? `linked:${v.rung}` : 'reason' in v ? `${v.kind}:${v.reason}` : v.kind);
/** What the lane counts a tree's forced rerun as. */
const forcedKindOf = (a: LaneAnswer): DelegationMarkKind | null => a.mark ?? (a.unknown ? 'window' : null);
/** The verdict of each tree, the lane's forced kind, and the lost-evidence rerun, as the scenario rows pin them. */
const laneSummary = (answers: readonly LaneAnswer[]) => answers.map((a) => [summary(a.verdict), forcedKindOf(a), a.lost] as const);

// ── the counting ──────────────────────────────────────────────────────────────────────────────────────────────────────

const ARRAYS = ['listingWindows', 'activities', 'acceptedEvidence', 'pointMetas'] as const;
type ArrayName = (typeof ARRAYS)[number];
const FAMILIES = ['window', 'evidenceRow', 'event', 'activity', 'pointMeta'] as const;
type Family = (typeof FAMILIES)[number];

/** Counting is on only while the lane's calls run, never while the world is built. */
interface Gate { on: boolean }
interface Tally { n: number }

/** An array that counts every read of it that is not a read of its length: the iterator, every Array.prototype method (`filter`, `find`,
 *  `some`, `indexOf`, `slice`, `entries`, `constructor` for a species lookup, ...) and every index. One tally per array. */
function countedArray<X extends object>(items: readonly X[], gate: Gate, tally: Tally): readonly X[] {
  return new Proxy([...items], {
    get(target, key, receiver) {
      if (gate.on && (key === Symbol.iterator || (typeof key === 'string' && key !== 'length'))) tally.n += 1;
      return Reflect.get(target, key, receiver);
    },
  });
}
/** An element that counts every string-keyed read of its own properties; its tally joins its family's list. */
function countedElement<X extends object>(target: X, gate: Gate, family: Tally[]): X {
  const tally: Tally = { n: 0 };
  family.push(tally);
  return new Proxy(target, {
    get(t, key) {
      if (gate.on && typeof key === 'string') tally.n += 1;
      return Reflect.get(t, key);
    },
  });
}

// ── the worlds ────────────────────────────────────────────────────────────────────────────────────────────────────────

type Shape = 'unresolved' | 'horizon' | 'restart' | 'mix';
const SHAPES: readonly Shape[] = ['unresolved', 'horizon', 'restart', 'mix'];
const SHAPE_NOTE: Record<Shape, string> = {
  unresolved: '(i) no window adds a tree\'s record, no horizon: unresolved',
  horizon: '(ii) the same windows, a rung-3 hit at every tree and every tree under an evidence horizon, odd trees path-marked',
  restart: '(iii) every window\'s repository is lost, as after a restart',
  mix: '(iv) even trees are agent records that link at rung 2, odd trees link at rung 3',
};
const RECORDS = 40;
const READY_AT = Date.UTC(2026, 9, 14) - 3600_000;        // the lane's latest ready instant: before every fixture window
const LANE_NOW = Date.UTC(2026, 9, 4);                       // the retention floor ends days before the fixture clock
/** A distinct hex-ish agent id per tree. */
const agentIdOf = (i: number): string => `a1b2c3${i.toString(16).padStart(6, '0')}`;
const nameOf = (shape: Shape, i: number): string => (shape === 'mix' && i % 2 === 0 ? `agent-${agentIdOf(i)}` : `wt-raw-${i}`);

/**
 * One run: the four pass-wide arrays built fresh (fresh Proxies, the evidence, windows and metas of all forty records), then the lane's calls
 * over the first `trees` records, with counting on only for those calls. Every window has its own distinct pair of instants. The held windows,
 * all closed:
 *   creators  (`restart` only) four windows of lane-a-demo, each adding ONE record `wt-raw-<j>`; their repository is lost, so none is a candidate;
 *   seeds     four windows of lane-a-demo adding a name that is nobody's record;
 *   twos      two windows of lane-b-demo adding TWO names;
 *   none      one window of lane-b-demo that adds nothing;
 *   unknown   one closed window of lane-c-demo whose repository is null, adding nothing.
 * The lane's own two lost windows (the retention floor and the not-ready window, built by the lane's own functions) close the list. No shape
 * has a rung-4 candidate.
 */
function boundRun(shape: Shape, trees: number) {
  const common = ['main-wt', 'old-wt'];
  const defs: { label: string; sessionId: string; repository: string | null; add: readonly string[] }[] = [];
  const repo = shape === 'restart' ? null : REPO;
  if (shape === 'restart') for (let j = 0; j < 4; j++) defs.push({ label: `creator${j}`, sessionId: PARENT, repository: repo, add: [`wt-raw-${j}`] });
  for (let j = 0; j < 4; j++) defs.push({ label: `seed${j}`, sessionId: PARENT, repository: repo, add: [`seed-${j}`] });
  for (let j = 0; j < 2; j++) defs.push({ label: `two${j}`, sessionId: OTHER, repository: repo, add: [`two-${j}-a`, `two-${j}-b`] });
  defs.push({ label: 'none', sessionId: OTHER, repository: repo, add: [] });
  defs.push({ label: 'unknown', sessionId: THIRD, repository: null, add: [] });
  const held: DelegationListingWindow[] = defs.map((d, k) => ({
    sessionId: d.sessionId, parentIncarnation: INC, toolUseId: `toolu_${d.label}`, repository: d.repository,
    startedAt: T(1000 * k + 101), endedAt: T(1000 * k + 101 + 7 + k), before: [...common], after: [...common, ...d.add],
  }));
  const plainWindows = [...held, ...delegationLostWindowsOf([], [], LANE_NOW), delegationNotReadyWindowOf(READY_AT)];

  // `kind` of tree i: 0 plain, 1 horizon only, 2 rung-3 hit and horizon, 3 rung-3 hit, horizon and a path mark
  const kindOf = (i: number): number => (shape === 'horizon' ? 2 + (i % 2) : shape === 'restart' ? i % 4 : 0);
  const hitAtRung3 = (i: number): boolean => (shape === 'mix' ? i % 2 === 1 : kindOf(i) >= 2);
  const horizon = T(60_001);                                   // after every window
  const events: DelegationEventEnvelopeV1[] = [subagentStart(1, AGENT)];
  const startAt = new Map<number, number>();                   // tree -> index of its own SubagentStart (mix, even trees)
  for (let i = 0; i < RECORDS; i++) {
    if (hitAtRung3(i)) events.push(toolIn(2 + i, AGENT, WTP(REPO, nameOf(shape, i))));
    if (shape === 'mix' && i % 2 === 0) { startAt.set(i, events.length); events.push(subagentStart(200 + i, agentIdOf(i))); }
  }
  if (shape === 'restart') for (let i = 0; i < 4; i++) events.push(bashPre(100 + 2 * i, `toolu_creator${i}`, common), bashPost(101 + 2 * i, `toolu_creator${i}`, [...common, `wt-raw-${i}`]));
  const w = world(events);
  const plainMetas: Metas[number][] = [];
  for (const [i, idx] of startAt) {
    plainMetas.push({ parentId: PARENT, parentIncarnation: INC, sourceKind: 'agent', upstreamId: agentIdOf(i), worktreePath: WTP(REPO, nameOf(shape, i)), evidenceJournalId: w.acceptedEvidence[idx]!.journalId });
  }
  // (ii) and (iii) hold ONE meta nobody asks about (an agent no tree names, at a path no tree has), so the point metas are a non-empty array
  // there too, and the floor on them means something whatever an implementation does with an empty one.
  if (shape === 'horizon' || shape === 'restart') {
    plainMetas.push({ parentId: PARENT, parentIncarnation: INC, sourceKind: 'agent', upstreamId: 'unrelated-agent', worktreePath: WTP(REPO, 'unrelated-tree'), evidenceJournalId: w.acceptedEvidence[0]!.journalId });
  }

  const gate: Gate = { on: false };
  const arrayTally: Record<ArrayName, Tally> = { listingWindows: { n: 0 }, activities: { n: 0 }, acceptedEvidence: { n: 0 }, pointMetas: { n: 0 } };
  const elements: Record<Family, Tally[]> = { window: [], evidenceRow: [], event: [], activity: [], pointMeta: [] };
  // The windows' own `before` and `after` listings stay plain arrays (D-5604 R1 counts those).
  const listingWindows = countedArray(plainWindows.map((x) => countedElement(x, gate, elements.window)), gate, arrayTally.listingWindows);
  const activities = countedArray(w.activities.map((a) => countedElement(a, gate, elements.activity)), gate, arrayTally.activities);
  const acceptedEvidence = countedArray(w.acceptedEvidence.map(({ journalId, event }) =>
    countedElement({ journalId, event: countedElement(event, gate, elements.event) }, gate, elements.evidenceRow)), gate, arrayTally.acceptedEvidence);
  const pointMetas = countedArray(plainMetas.map((m) => countedElement(m, gate, elements.pointMeta)), gate, arrayTally.pointMetas);

  const treeList: Tree[] = Array.from({ length: trees }, (_, i) => ({
    record: rawRecord(nameOf(shape, i)),
    firstSighting: { after: T(0), at: T(5003) },
    evidenceHorizon: shape === 'mix' ? null : kindOf(i) >= 1 ? horizon : null,
  }));
  // The index covers all forty records, whatever number the lane correlates, so the 20- and the 40-tree worlds differ only in their trees.
  const dropped = shape === 'unresolved' ? marksFor([])
    : shape === 'mix' ? indexDelegationDropped([])
      : marksFor(Array.from({ length: RECORDS }, (_, i) => i).filter((i) => kindOf(i) === 3).map((i) => WTP(REPO, nameOf(shape, i))));
  // The lane computes this once per pass, over its own windows: counting is off.
  const unknownWindows = plainWindows.some((x) => x.repository === null && x.lost !== true);

  gate.on = true;
  let answers: LaneAnswer[];
  try { answers = runLane(treeList, { listingWindows, activities, acceptedEvidence, pointMetas }, dropped, unknownWindows); } finally { gate.on = false; }
  const arrays = Object.fromEntries(ARRAYS.map((a) => [a, arrayTally[a].n])) as Record<ArrayName, number>;
  const busiest = Object.fromEntries(FAMILIES.map((f) => [f, elements[f].reduce((m, t) => Math.max(m, t.n), 0)])) as Record<Family, number>;
  return { answers, arrays, busiest };
}

/** The arrays each shape traverses at main (measured), so a pass that stops reading one of them for a wrong reason (an early exit, a broken
 *  fixture) reds here rather than passing the equality below. An array a shape never reads is absent from its set. */
const FLOOR: Record<Shape, readonly ArrayName[]> = {
  // (i) no tree has a rung-3 hit or a rung-2 name, so no activity row is ever looked up and the point metas are never asked.
  unresolved: ['listingWindows', 'acceptedEvidence'],
  // (ii) every tree has a rung-3 hit (the activity rows are searched for its agent) and rung 3 checks who else claims the agent (the point
  //      metas, which here hold one unrelated meta, are still scanned).
  horizon: ['listingWindows', 'activities', 'acceptedEvidence', 'pointMetas'],
  // (iii) the same reads for the trees with a rung-3 hit, with the lost-creator windows beside them.
  restart: ['listingWindows', 'activities', 'acceptedEvidence', 'pointMetas'],
  // (iv) rung 2 reads the activity rows, the metas and the evidence of the even trees, rung 3 those of the odd ones.
  mix: ['listingWindows', 'activities', 'acceptedEvidence', 'pointMetas'],
};

describe('D-5642 R1: a pass reads each pass-wide array, and each of its elements, a constant number of times however many trees it correlates', () => {
  for (const shape of SHAPES) {
    describe(SHAPE_NOTE[shape], () => {
      it('the scenario answers as intended (a verdict list that drifts reds here, not in the pin)', () => {
        const rows = laneSummary(boundRun(shape, 20).answers);
        expect(rows.length).toBe(20);
        expect(rows).toEqual(EXPECTED_ROWS[shape]);
      });
      it('each array is read, and the busiest element of each family is read, as often at 20 trees as at 40', () => {
        const small = boundRun(shape, 20);
        const large = boundRun(shape, 40);
        const arrayGrowth = ARRAYS.filter((a) => small.arrays[a] !== large.arrays[a]).map((a) => `array ${a}: read ${small.arrays[a]} times at 20 trees, ${large.arrays[a]} at 40`);
        expect(arrayGrowth, 'array reads grow with the number of trees').toEqual([]);
        const elementGrowth = FAMILIES.filter((f) => small.busiest[f] !== large.busiest[f])
          .map((f) => `${f}: its busiest element is read ${small.busiest[f]} times at 20 trees, ${large.busiest[f]} at 40`);
        expect(elementGrowth, 'element reads grow with the number of trees').toEqual([]);
        const floor = FLOOR[shape].filter((a) => !(small.arrays[a] > 0)).map((a) => `array ${a} is not read at 20 trees`);
        expect(floor, 'the pass no longer traverses an array it traversed at main').toEqual([]);
      });
    });
  }
});

type Row = readonly [string, DelegationMarkKind | null, boolean | null];
const PLAIN: Row = ['unresolved:no-correlating-evidence', null, null];
/** A rung-3 link held back by a lost creator or by the horizon: lost evidence alone holds it. */
const HELD_BY_LOST_EVIDENCE: Row = ['unmeasured:evidence-horizon', null, true];
/** The same, path-marked: the mark rerun answers first, and lost evidence is not counted beside a mark. */
const HELD_BY_PATH_MARK: Row = ['unmeasured:evidence-horizon', 'path', false];
const EXPECTED_ROWS: Record<Shape, readonly Row[]> = {
  unresolved: Array.from({ length: 20 }, () => PLAIN),
  horizon: Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? HELD_BY_LOST_EVIDENCE : HELD_BY_PATH_MARK)),
  // by i % 4: plain, horizon only (a lost creator alone decides nothing, and tree 1 has no rung-3 hit), a rung-3 hit and horizon, that and a path mark
  restart: Array.from({ length: 20 }, (_, i) => [PLAIN, PLAIN, HELD_BY_LOST_EVIDENCE, HELD_BY_PATH_MARK][i % 4]!),
  mix: Array.from({ length: 20 }, (_, i): Row => [i % 2 === 0 ? 'linked:2' : 'linked:3', null, null]),
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// D-5642 R2: the equivalence digest of rungs 2 and 3
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//
//   D-5642 R2, the equivalence digest. D-5604 R2 (delegation-correlation-cost.test.ts) never reaches rung 2 (every record in it is `wt-raw-*`)
//      and holds no point meta. This row is the digest for rungs 2 and 3: a seeded stream of lane passes over `agent-<id>` trees, `wf_<run>-<n>`
//      trees and plain trees, answered by the lane's four calls exactly as D-5604 R2 answers its own (every tree's ladder, both forced reruns
//      asked of every tree, the lost-evidence rerun of every `unmeasured` verdict), hashed, and held to a constant computed at main, beside a
//      histogram of the shapes the stream reaches, each counted from the test's OWN rows and never from a function of the module. Whoever
//      replaces the per-tree scans of the activities, the point metas and the accepted evidence by indexes built once per pass must leave
//      both byte-identical.
//
// The passes are built from scenes (one scene is one claim shape: its events, its hand-built activity rows, its metas, its trees, the dropped
// keys and marks it needs); the first passes cycle the scenes so every one is met, the rest are random mixes, with the order of every array
// shuffled in some passes. Hand-built rows are what the checkpoint cannot make: a duplicate key under another `activityId`, a workflow worker
// row, a row under a second source kind for the same upstream id, an agent whose row was taken out of the pass (a claim by the event alone).
// No tree's creator bracket meets a lost window, so a rung-3 link is reachable. Fixtures only, as above.
//
// What the stream reaches beyond the single rungs (fix round 1): `combine` with TWO links on one tree (a rung-3 hit beside a rung-4 candidate
// of the same parent, which agree, and of another parent or incarnation, which is `rungs-disagree`), rung 2's choice among rows that share an
// `activityId` but not an `identityJournalId` (in front of and behind the original), a meta of another source kind held by the claimant parent
// itself (with another path and with the same one), a parent report at the path from a sibling incarnation of the hit's parent, and a parent
// that claims by a SubagentStart and by a launch response. Two forced reruns are reached only by a scene made for them, and here they are: the
// unknown-window rerun (a window with no repository over a rung-4 candidate) and the lost-evidence rerun (a lost window over one). Without a
// rung-4 candidate under such a window neither could be true, because no rung-2 or rung-3 verdict depends on a listing window at all.

/** mulberry32: a 32-bit seeded generator, so the stream (and its digest) is the same on every run and every box. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED_R2 = 0x5642b2;
const R2_PASSES = 580;
const OTHER_PROJECT = 'project-b';
type PK = readonly [string, string];
/** Four parents: three sessions, and the first session again under another incarnation (another parent). */
const R2_PARENTS: readonly PK[] = [[PARENT, INC], [OTHER, INC], [THIRD, INC], [PARENT, 'g2']];
const pkey = (p: PK): string => JSON.stringify([p[0], p[1]]);
type Ev = DelegationEventEnvelopeV1;
interface EvRow { journalId: string; event: Ev }
type Meta = DelegationCorrelationInput['pointMetas'][number];
type Kind = 'agent' | 'workflow' | 'bash-worktree';

interface R2Rand {
  chance(p: number): boolean;
  int(lo: number, hi: number): number;
  pick<X>(xs: readonly X[]): X;
  shuffle<X>(xs: readonly X[]): X[];
  /** Three distinct parents, in a random order. */
  parents(): [PK, PK, PK];
  project(): string;
}
function randOf(seed: number): R2Rand {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  const shuffle = <X>(xs: readonly X[]): X[] => xs.map((x) => [rnd(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
  return {
    chance: (p) => rnd() < p,
    int,
    pick: (xs) => xs[int(0, xs.length - 1)]!,
    shuffle,
    parents: () => { const [a, b, c] = shuffle(R2_PARENTS); return [a!, b!, c!]; },
    project: () => (rnd() < 0.8 ? REPO : OTHER_PROJECT),
  };
}

const r2Over = (p: PK, cwd?: string): Over => ({ sessionId: p[0], parentIncarnation: p[1], ...(cwd === undefined ? {} : { cwd }) });
const subagentStop = (n: number, agentId: string, over: Over = {}): Ev =>
  ({ ...mkBase(n, over), eventKind: 'SubagentStop', agentId, agentType: null, agentTranscriptPath: null });
/** An Agent or Task launch response that launched `agentId`: the PostToolUse arm of a claim. */
const launchResponse = (n: number, agentId: string, tool: 'Agent' | 'Task', over: Over = {}): Ev =>
  ({ ...mkBase(n, over), eventKind: 'PostToolUse', toolName: tool, toolUseId: `toolu_l${n}`, outcome: 'async-launched', launch: { status: 'async-launched', agentId, isAsync: true } });
/** A PostToolUse of ANOTHER tool carrying a `launch` object that names the agent: it is no claim. Never journaled (no hook writes it). */
const otherToolLaunch = (n: number, agentId: string, tool: string, over: Over = {}): Ev =>
  ({ ...mkBase(n, over), eventKind: 'PostToolUse', toolName: tool, toolUseId: `toolu_o${n}`, outcome: 'completed', launch: { status: 'async-launched', agentId, isAsync: true } }) as unknown as Ev;
/** A tool event of the parent itself (no `agentId`) with a working directory. */
const parentAtPath = (n: number, cwd: string, over: Over = {}): Ev =>
  ({ ...mkBase(n, { ...over, cwd }), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_pr_${n}`, outcome: 'completed' });

interface R2Pass {
  trees: Tree[];
  arrays: Arrays;
  dropped: DelegationDroppedEvidence;
  unknownWindows: boolean;
}

/** One pass under construction: the scenes call these to add their rows. */
class R2Build {
  n = 1;
  uid = 0;
  readonly events: Ev[] = [];
  readonly raw: EvRow[] = [];
  readonly front: DelegationActivityRow[] = [];
  readonly back: DelegationActivityRow[] = [];
  readonly metas: Meta[] = [];
  readonly trees: Tree[] = [];
  /** Checkpoint rows to take out of the pass (the claim stays in the events; the row does not): [kind, upstream id, parent]. */
  readonly removed = new Set<string>();
  readonly keys: DelegationDroppedKey[] = [];
  readonly markIds: string[] = [];
  readonly markPaths: string[] = [];
  /** Listing windows the scenes add (rung-4 candidates and the windows over them). */
  readonly windows: DelegationListingWindow[] = [];
  /** Rows to copy, once the checkpoint's activity ids are known: same `activityId`, another `identityJournalId`. */
  readonly clones: { sourceKind: Kind; upstreamId: string; p: PK; front: boolean }[] = [];
  cand = 0;
  constructor(readonly r: R2Rand) {}

  fresh(prefix: string): string { return `${prefix}${(this.uid++).toString(16).padStart(4, '0')}`; }
  tree(name: string, project: string): string {
    const record = rawRecord(name, project);
    this.trees.push({ record, firstSighting: { after: T(0), at: T(5003) }, evidenceHorizon: null });
    return record.canonicalPath!;
  }
  start(agent: string, p: PK, cwd?: string): void { this.events.push(subagentStart(this.n++, agent, r2Over(p, cwd))); }
  stop(agent: string, p: PK, cwd?: string): void { this.events.push(subagentStop(this.n++, agent, r2Over(p, cwd))); }
  launch(agent: string, p: PK, tool: 'Agent' | 'Task'): void { this.events.push(launchResponse(this.n++, agent, tool, r2Over(p))); }
  toolInBy(agent: string, p: PK, cwd: string): void { this.events.push(toolIn(this.n++, agent, cwd, r2Over(p))); }
  parentAt(p: PK, cwd: string): void { this.events.push(parentAtPath(this.n++, cwd, r2Over(p))); }
  decoy(agent: string, p: PK, tool: string): void {
    const n = this.n++;
    this.raw.push({ journalId: delegationSha256Hex(`fixture-bound-raw-${n}`), event: otherToolLaunch(n, agent, tool, r2Over(p)) });
  }
  meta(sourceKind: 'agent' | 'workflow', upstreamId: string, p: PK, worktreePath: string): void {
    this.metas.push({ parentId: p[0], parentIncarnation: p[1], sourceKind, upstreamId, worktreePath, evidenceJournalId: `jm-${this.uid++}` });
  }
  /** A hand-built activity row; `front` puts it before the checkpoint's rows in the pass's array, else after them. */
  row(sourceKind: Kind, upstreamId: string, p: PK, front = false): void {
    const id = this.uid++;
    (front ? this.front : this.back).push({
      activityId: `act-hand-${id}`, parentId: p[0], parentIncarnation: p[1], sourceKind, upstreamId, identityJournalId: `jh-${id}`,
      displayName: null, executionState: 'active', openedAt: T(1), endedAt: null, lastEventAt: T(1),
    });
  }
  /** A copy of the (first) row of this key: the same `activityId`, a different `identityJournalId`; in front of the pass's rows or behind them. */
  cloneRow(sourceKind: Kind, upstreamId: string, p: PK, front: boolean): void { this.clones.push({ sourceKind, upstreamId, p, front }); }
  /** A rung-4 candidate for tree `name` on `project`: a closed window of parent `p` that adds exactly the name and removes none, with its
   *  tool call's Pre and Post so the checkpoint opens the `bash-worktree` row (unless `withRow` is false). Returns the window's start (seconds). */
  candidate(name: string, project: string, p: PK, withRow = true): number {
    const common = ['main-wt', 'old-wt'];
    const tool = `toolu_c${this.uid++}`;
    const t0 = 20000 + 200 * this.cand++;
    this.windows.push({
      sessionId: p[0], parentIncarnation: p[1], toolUseId: tool, repository: project,
      startedAt: T(t0), endedAt: T(t0 + 50), before: [...common], after: [...common, name],
    });
    this.events.push(bashPre(this.n++, tool, common, r2Over(p)), bashPost(this.n++, tool, [...common, name], r2Over(p)));
    if (!withRow) this.remove('bash-worktree', tool, p);
    return t0;
  }
  remove(sourceKind: Kind, upstreamId: string, p: PK): void { this.removed.add(JSON.stringify([sourceKind, upstreamId, pkey(p)])); }
  rival(p: PK, ids: { agentId?: string; launchAgentId?: string; runId?: string }): void {
    this.keys.push({ parentId: p[0], parentIncarnation: p[1], agentId: ids.agentId ?? null, launchAgentId: ids.launchAgentId ?? null, runId: ids.runId ?? null, cwd: null, startStop: false });
  }
  droppedAt(p: PK, cwd: string, agentId: string | null, startStop: boolean): void {
    this.keys.push({ parentId: p[0], parentIncarnation: p[1], agentId, launchAgentId: null, runId: null, cwd, startStop });
  }

  /** The pass: the checkpoint's rows (minus the removed ones) and the hand-built ones, the evidence, the metas, the dropped index, the windows. */
  build(): R2Pass {
    const { r } = this;
    const w = world(this.events);
    const checkpoint = w.activities.filter((a) => !this.removed.has(JSON.stringify([a.sourceKind, a.upstreamId, pkey([a.parentId, a.parentIncarnation])])));
    const base = [...this.front, ...checkpoint, ...this.back];
    const copies = (front: boolean): DelegationActivityRow[] => this.clones.filter((c) => c.front === front).flatMap((c) => {
      const src = base.find((a) => a.sourceKind === c.sourceKind && a.upstreamId === c.upstreamId && pkey([a.parentId, a.parentIncarnation]) === pkey(c.p));
      return src === undefined ? [] : [{ ...src, identityJournalId: `jc-${this.uid++}` }];
    });
    let activities: DelegationActivityRow[] = [...copies(true), ...base, ...copies(false)];
    let acceptedEvidence: EvRow[] = [...w.acceptedEvidence, ...this.raw];
    let pointMetas: Meta[] = [...this.metas];
    if (r.chance(0.3)) activities = r.shuffle(activities);
    if (r.chance(0.3)) acceptedEvidence = r.shuffle(acceptedEvidence);
    if (r.chance(0.3)) pointMetas = r.shuffle(pointMetas);

    // The dropped index: mostly the scenes' own keys and marks (a rival, a path veto, an id or a path mark); sometimes the pass-wide kinds.
    const ids = emptyDelegationHashSet();
    for (const id of this.markIds) delegationHashSetAdd(ids, id, 100);
    const paths: DelegationHashSet = emptyDelegationHashSet();
    for (const path of this.markPaths) delegationHashSetAdd(paths, path, 100);
    const own = { ...DELEGATION_NO_MARKS, ids, paths: this.markPaths.length === 0 ? [] : [paths] };
    const d = r.int(0, 99);
    const dropped: DelegationDroppedEvidence = d < 72 ? indexDelegationDropped(this.keys, own)
      : d < 80 ? DELEGATION_DROPPED_UNMEASURED
        : d < 86 ? indexDelegationDropped(this.keys, { ...own, lossy: true })
          : d < 91 ? indexDelegationDropped(this.keys, { ...own, projects: new Set([r.project()]) })
            : d < 96 ? indexDelegationDropped(this.keys, { ...own, prefixes: new Set([`/fixture/${r.project()}/.claude/worktrees`]) })
              : indexDelegationDropped([]);

    // The windows: some held ones that add nobody's record, the lane's own two lost windows (placed so they do not meet any tree's creator
    // bracket), and in half the passes one held window whose repository the caller lost.
    const common = ['main-wt', 'old-wt'];
    const defs: { label: string; sessionId: string; repository: string | null; add: readonly string[] }[] = [];
    for (let j = 0; j < 2; j++) defs.push({ label: `seed${j}`, sessionId: PARENT, repository: REPO, add: [`seed-${j}`] });
    defs.push({ label: 'two', sessionId: OTHER, repository: REPO, add: ['two-a', 'two-b'] });
    if (r.chance(0.5)) defs.push({ label: 'unknown', sessionId: THIRD, repository: null, add: [] });
    const held: DelegationListingWindow[] = defs.map((x, k) => ({
      sessionId: x.sessionId, parentIncarnation: INC, toolUseId: `toolu_${x.label}`, repository: x.repository,
      startedAt: T(1000 * k + 101), endedAt: T(1000 * k + 101 + 7 + k), before: [...common], after: [...common, ...x.add],
    }));
    const listingWindows = [...held, ...this.windows, ...delegationLostWindowsOf([], [], LANE_NOW), delegationNotReadyWindowOf(READY_AT)];
    return {
      trees: this.trees, arrays: { listingWindows, activities, acceptedEvidence, pointMetas }, dropped,
      unknownWindows: listingWindows.some((x) => x.repository === null && x.lost !== true),
    };
  }
}

/** The lane's calls, as D-5604 R2's `runLane(p, true)` makes them: the ladder of every tree around a fresh input object; then both forced reruns
 *  of every tree (the lane's `??` stops at a mark; exhaustive asks both); then the lost-evidence rerun of every `unmeasured` verdict. */
function r2Lane(p: R2Pass): LaneAnswer[] {
  const inputFor = (t: Tree): DelegationCorrelationInput => input({
    record: t.record, activities: p.arrays.activities, acceptedEvidence: p.arrays.acceptedEvidence, pointMetas: p.arrays.pointMetas,
    listingWindows: p.arrays.listingWindows, droppedEvidence: p.dropped, evidenceHorizon: t.evidenceHorizon, firstSighting: t.firstSighting,
  });
  const pairs = p.trees.map((t) => ({ t, verdict: correlateDelegation(inputFor(t)) }));
  const answers: LaneAnswer[] = pairs.map(({ verdict }) => ({ verdict, mark: null, unknown: false, lost: null }));
  if (p.dropped.measured || p.unknownWindows) {
    pairs.forEach(({ t, verdict }, i) => {
      const inp = inputFor(t);
      const a = answers[i]!;
      if (p.dropped.measured) a.mark = delegationMarkForced(inp, verdict);
      if (p.unknownWindows) a.unknown = delegationUnknownWindowForced(inp, verdict);
    });
  }
  pairs.forEach(({ t, verdict }, i) => {
    if (verdict.kind !== 'unmeasured') return;
    answers[i]!.lost = delegationLostEvidenceForced(inputFor(t), verdict);
  });
  return answers;
}

type Scene = (b: R2Build) => void;
type Via = 'start' | 'launch';
const claimVia = (b: R2Build, x: string, p: PK, via: Via): void => { if (via === 'start') b.start(x, p); else b.launch(x, p, b.r.pick(['Agent', 'Task'] as const)); };
/** A second claim of agent `x` by parent `p`, in each of the ways a claim is made. */
const secondClaim = (b: R2Build, x: string, p: PK, path: string, how: string): void => {
  if (how === 'start') b.start(x, p);
  else if (how === 'start-only') { b.start(x, p); b.remove('agent', x, p); }
  else if (how === 'launch') b.launch(x, p, b.r.pick(['Agent', 'Task'] as const));
  else if (how === 'launch-only') { b.launch(x, p, b.r.pick(['Agent', 'Task'] as const)); b.remove('agent', x, p); }
  else if (how === 'meta') b.meta('agent', x, p, path);
  else b.row('agent', x, p);
};
const SECOND_CLAIMS = ['start', 'start-only', 'launch', 'launch-only', 'meta', 'row'] as const;
/** What a dropped key or mark does to a rung-3 link of agent `x` (parent `p1`, a rival `p2`) on `path`. */
function r3Dropped(b: R2Build, how: string, x: string, p1: PK, p2: PK, path: string): void {
  if (how === 'rival') b.rival(p2, { agentId: x });
  else if (how === 'rival-launch') b.rival(p2, { launchAgentId: x });
  else if (how === 'own') b.rival(p1, { agentId: x });
  else if (how === 'mark-id') b.markIds.push(x);
  else if (how === 'mark-path') b.markPaths.push(path);
  else if (how === 'veto-parent') b.droppedAt(p1, path, null, false);
  else if (how === 'veto-agent') b.droppedAt(p2, path, `${x}zz`, false);
  else if (how === 'no-veto-startstop') b.droppedAt(p2, path, `${x}zz`, true);
  else if (how === 'no-veto-other-parent') b.droppedAt(p2, path, null, false);
  else b.droppedAt(p1, path, x, false);                                         // its own agent's event: no veto
}
const R3_DROPPED = ['rival', 'rival-launch', 'own', 'mark-id', 'mark-path', 'veto-parent', 'veto-agent', 'no-veto-startstop', 'no-veto-other-parent', 'own-agent'] as const;
const R2_DROPPED = ['rival', 'rival-launch', 'own', 'mark-id', 'mark-path'] as const;

const SCENES: readonly (readonly [string, Scene])[] = [
  // ── rung 2, an `agent-<x>` tree ──
  ['r2-link', (b) => {
    const [p1, p2, p3] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`agent-${x}`, b.r.project());
    const via = b.r.pick(['start', 'launch'] as const);
    claimVia(b, x, p1, via);
    if (b.r.chance(0.3)) claimVia(b, x, p1, via === 'start' ? 'launch' : 'start');
    if (via === 'launch' || b.r.chance(0.4)) b.stop(x, p1);
    b.meta('agent', x, p1, path);
    if (b.r.chance(0.3)) b.stop(x, p2);                                           // a stop alone of another parent claims nothing
    if (b.r.chance(0.3)) b.decoy(x, p3, b.r.pick(['Bash', 'ToolSearch'] as const)); // nor does another tool's launch object
  }],
  ['r2-start-only', (b) => {                                                      // the claim is a SubagentStart alone: its row is not in the pass, there is no meta
    const [p1, p2] = b.r.parents(); const x = b.fresh('a'); b.tree(`agent-${x}`, b.r.project());
    b.start(x, p1); b.remove('agent', x, p1);
    if (b.r.chance(0.3)) b.stop(x, p2);
  }],
  ['r2-launch-only', (b) => {                                                     // the claim is an Agent/Task launch response alone
    const [p1, p2] = b.r.parents(); const x = b.fresh('a'); b.tree(`agent-${x}`, b.r.project());
    b.launch(x, p1, b.r.pick(['Agent', 'Task'] as const)); b.remove('agent', x, p1);
    if (b.r.chance(0.3)) b.decoy(x, p2, 'Bash');
  }],
  ['r2-launch-only-agent', (b) => {
    const [p1] = b.r.parents(); const x = b.fresh('a'); b.tree(`agent-${x}`, b.r.project());
    b.launch(x, p1, 'Agent'); b.remove('agent', x, p1);
  }],
  ['r2-launch-only-task', (b) => {
    const [p1] = b.r.parents(); const x = b.fresh('a'); b.tree(`agent-${x}`, b.r.project());
    b.launch(x, p1, 'Task'); b.remove('agent', x, p1);
  }],
  ['r2-meta-only', (b) => {                                                       // the claim is a point meta alone (no row, no claiming event)
    const [p1] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`agent-${x}`, b.r.project());
    b.meta('agent', x, p1, b.r.chance(0.7) ? path : `${path}-elsewhere`);
    if (b.r.chance(0.4)) b.stop(x, p1);
  }],
  ['r2-stop-alone', (b) => {                                                      // a parent whose only event about the id is a stop: no claim
    const [p1, p2, p3] = b.r.parents(); const x = b.fresh('a'); b.tree(`agent-${x}`, b.r.project());
    b.stop(x, p1);
    if (b.r.chance(0.5)) b.stop(x, p2);
    if (b.r.chance(0.5)) b.decoy(x, p3, b.r.pick(['Bash', 'ToolSearch'] as const));
  }],
  ['r2-other-tool-decoy', (b) => {                                                // another tool's launch object names the id: no claim; a real claim beside it is the only one
    const [p1, p2] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`agent-${x}`, b.r.project());
    b.decoy(x, p2, b.r.pick(['Bash', 'ToolSearch'] as const));
    if (b.r.chance(0.5)) { b.start(x, p1); b.stop(x, p1); b.meta('agent', x, p1, path); }
  }],
  ['r2-dup-rows', (b) => {
    const [p1] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`agent-${x}`, b.r.project());
    b.start(x, p1); b.row('agent', x, p1, b.r.chance(0.5));
    if (b.r.chance(0.7)) b.meta('agent', x, p1, path);
  }],
  ['r2-meta-disagree', (b) => {
    const [p1] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`agent-${x}`, b.r.project());
    b.start(x, p1);
    const metas = [path, `${path}-other`];
    for (const m of b.r.chance(0.5) ? metas : [...metas].reverse()) b.meta('agent', x, p1, m);
    if (b.r.chance(0.3)) b.meta('agent', x, p1, path);
  }],
  ['r2-metas-agree', (b) => {                                                     // two metas, one path: they agree and the link stands
    const [p1] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`agent-${x}`, b.r.project());
    b.start(x, p1); b.stop(x, p1); b.meta('agent', x, p1, path); b.meta('agent', x, p1, path);
  }],
  ['r2-path-mismatch', (b) => {
    const [p1] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`agent-${x}`, b.r.project());
    b.start(x, p1); b.stop(x, p1);
    b.meta('agent', x, p1, b.r.chance(0.5) ? WTP(path.includes(REPO) ? OTHER_PROJECT : REPO, `agent-${x}`) : `${path}/`);
  }],
  ['r2-event-absent', (b) => {
    const [p1, p2] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`agent-${x}`, b.r.project());
    b.launch(x, p1, b.r.pick(['Agent', 'Task'] as const)); b.meta('agent', x, p1, path);
    if (b.r.chance(0.5)) b.stop(x, p2);                                           // another parent's stop is not this parent's
  }],
  ['r2-not-open', (b) => {
    const [p1] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`agent-${x}`, b.r.project());
    b.start(x, p1); b.remove('agent', x, p1); b.meta('agent', x, p1, path);
    if (b.r.chance(0.5)) b.stop(x, p1);
  }],
  ['r2-horizon', (b) => {
    const [p1, p2] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`agent-${x}`, b.r.project());
    b.start(x, p1); b.stop(x, p1); b.meta('agent', x, p1, path);
    const how = b.r.pick(R2_DROPPED);
    if (how === 'rival') b.rival(p2, { agentId: x }); else if (how === 'rival-launch') b.rival(p2, { launchAgentId: x });
    else if (how === 'own') b.rival(p1, { agentId: x }); else if (how === 'mark-id') b.markIds.push(x); else b.markPaths.push(path);
  }],
  ['r2-two-parents', (b) => {
    const [p1, p2] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`agent-${x}`, b.r.project());
    claimVia(b, x, p1, b.r.pick(['start', 'launch'] as const)); b.stop(x, p1); b.meta('agent', x, p1, path);
    secondClaim(b, x, b.r.chance(0.3) ? [p1[0], 'g3'] : p2, path, b.r.pick(SECOND_CLAIMS));
  }],
  ['r2-two-incarnations', (b) => {                                                // one parentId under two incarnations: two parents
    const x = b.fresh('a'); const path = b.tree(`agent-${x}`, b.r.project());
    b.start(x, [PARENT, INC]); b.stop(x, [PARENT, INC]); b.meta('agent', x, [PARENT, INC], path);
    secondClaim(b, x, [PARENT, 'g2'], path, b.r.pick(SECOND_CLAIMS));
  }],
  ['r2-cross-kind', (b) => {                                                      // the same upstream id string under two source kinds
    const [p1, p2, p3] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`agent-${x}`, b.r.project());
    b.start(x, p1); b.stop(x, p1); b.meta('agent', x, p1, path);
    const decoys = [() => b.row('bash-worktree', x, p2), () => b.row('workflow', x, p3), () => b.meta('workflow', x, p3, path), () => b.meta('workflow', x, p2, path),
      () => b.row('bash-worktree', x, p1), () => b.row('workflow', x, p1, true)];
    const chosen = b.r.shuffle(decoys).slice(0, b.r.int(1, 4));
    for (const d of chosen) d();
  }],
  ['r2-cross-kind-unlinked', (b) => {                                             // ... and with the agent's own evidence short, so a decoy would be the claim
    const [p1, p2] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`agent-${x}`, b.r.project());
    b.start(x, p1);
    b.row('bash-worktree', x, p2); b.meta('workflow', x, p2, path);
    if (b.r.chance(0.5)) b.row('workflow', x, p2);
  }],
  // ── rung 2, a `wf_<run>-<n>` tree ──
  ['wf-link', (b) => {
    const [p1, p2] = b.r.parents(); const run = b.fresh('wf_r'); const name = `${run}-${b.r.int(0, 3)}`; const path = b.tree(name, b.r.project());
    b.row('workflow', name, p1); b.meta('workflow', name, p1, path);
    if (b.r.chance(0.3)) b.meta('workflow', name, p1, path);
    if (b.r.chance(0.3)) b.row('workflow', `${run}-9`, p2);                       // another worker of the run
  }],
  ['wf-meta-only', (b) => {                                                       // a meta and no activity row
    const [p1] = b.r.parents(); const name = `${b.fresh('wf_r')}-0`; const path = b.tree(name, b.r.project());
    b.meta('workflow', name, p1, path);
  }],
  ['wf-row-only', (b) => {
    const [p1] = b.r.parents(); const name = `${b.fresh('wf_r')}-1`; b.tree(name, b.r.project());
    b.row('workflow', name, p1);
  }],
  ['wf-absent', (b) => {
    const [p1] = b.r.parents(); const run = b.fresh('wf_r'); b.tree(`${run}-2`, b.r.project());
    if (b.r.chance(0.5)) b.row('workflow', `${run}-3`, p1);
  }],
  ['wf-two-parents', (b) => {
    const [p1, p2] = b.r.parents(); const name = `${b.fresh('wf_r')}-0`; const path = b.tree(name, b.r.project());
    b.row('workflow', name, p1); b.meta('workflow', name, p1, path);
    const second = b.r.chance(0.3) ? [p1[0], 'g3'] as const : p2;
    if (b.r.chance(0.5)) b.row('workflow', name, second); else b.meta('workflow', name, second, path);
  }],
  ['wf-defect', (b) => {
    const [p1] = b.r.parents(); const name = `${b.fresh('wf_r')}-0`; const path = b.tree(name, b.r.project());
    b.row('workflow', name, p1);
    const defect = b.r.pick(['dup', 'disagree', 'mismatch'] as const);
    if (defect === 'dup') { b.row('workflow', name, p1, b.r.chance(0.5)); b.meta('workflow', name, p1, path); }
    else if (defect === 'disagree') { b.meta('workflow', name, p1, path); b.meta('workflow', name, p1, `${path}-other`); }
    else b.meta('workflow', name, p1, `${path}-other`);
  }],
  ['wf-horizon', (b) => {
    const [p1, p2] = b.r.parents(); const run = b.fresh('wf_r'); const name = `${run}-0`; const path = b.tree(name, b.r.project());
    b.row('workflow', name, p1); b.meta('workflow', name, p1, path);
    const how = b.r.pick(['run-rival', 'name-rival', 'run-own', 'mark-run', 'mark-name', 'mark-path'] as const);
    if (how === 'run-rival') b.rival(p2, { runId: run }); else if (how === 'name-rival') b.rival(p2, { agentId: name });
    else if (how === 'run-own') b.rival(p1, { runId: run }); else if (how === 'mark-run') b.markIds.push(run);
    else if (how === 'mark-name') b.markIds.push(name); else b.markPaths.push(path);
  }],
  ['wf-cross-kind', (b) => {
    const [p1, p2, p3] = b.r.parents(); const name = `${b.fresh('wf_r')}-0`; const path = b.tree(name, b.r.project());
    b.row('workflow', name, p1); b.meta('workflow', name, p1, path);
    b.row('agent', name, p2);                                                     // an agent row whose upstream id is the worker's name
    if (b.r.chance(0.5)) b.meta('agent', name, p3, path);
    if (b.r.chance(0.5)) b.row('bash-worktree', name, p3);
  }],
  // ── rung 3, a plain tree ──
  ['r3-link', (b) => {
    const [p1] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`wt-raw-${b.fresh('t')}`, b.r.project());
    claimVia(b, x, p1, b.r.pick(['start', 'launch'] as const));
    for (let k = b.r.int(1, 3); k > 0; k--) b.toolInBy(x, p1, path);
  }],
  ['r3-start-stop-at-path', (b) => {                                              // the host's own SubagentStart and SubagentStop at the path: no hit
    const [p1] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`wt-raw-${b.fresh('t')}`, b.r.project());
    b.start(x, p1, path);
    if (b.r.chance(0.7)) b.stop(x, p1, path);
    if (b.r.chance(0.3)) b.stop(`${x}s`, p1, path);
  }],
  ['r3-parent-cwd', (b) => {
    const [p1, p2] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`wt-raw-${b.fresh('t')}`, b.r.project());
    claimVia(b, x, p1, b.r.pick(['start', 'launch'] as const)); b.toolInBy(x, p1, path);
    b.parentAt(b.r.chance(0.75) ? p1 : p2, path);                                 // its own parent's cwd vetoes; another parent's does not
  }],
  ['r3-ambiguous', (b) => {                                                       // two hits on one path from ONE parent
    const [p1] = b.r.parents(); const x = b.fresh('a'); const y = b.fresh('a'); const path = b.tree(`wt-raw-${b.fresh('t')}`, b.r.project());
    claimVia(b, x, p1, b.r.pick(['start', 'launch'] as const)); claimVia(b, y, p1, b.r.pick(['start', 'launch'] as const));
    b.toolInBy(x, p1, path); b.toolInBy(y, p1, path);
    if (b.r.chance(0.3)) b.parentAt(p1, path);                                    // the parent's cwd is asked before the ambiguity
  }],
  ['r3-two-parents', (b) => {                                                     // two hits on one path from TWO parents
    const [p1, p2] = b.r.parents(); const x = b.fresh('a'); const y = b.fresh('a'); const path = b.tree(`wt-raw-${b.fresh('t')}`, b.r.project());
    claimVia(b, x, p1, b.r.pick(['start', 'launch'] as const)); claimVia(b, y, p2, b.r.pick(['start', 'launch'] as const));
    b.toolInBy(x, p1, path); b.toolInBy(y, p2, path);
    if (b.r.chance(0.3)) b.parentAt(p1, path);                                    // a parent-cwd veto must not turn the conflict into a retry
  }],
  ['r3-agent-multi', (b) => {
    const [p1, p2] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`wt-raw-${b.fresh('t')}`, b.r.project());
    claimVia(b, x, p1, b.r.pick(['start', 'launch'] as const)); b.toolInBy(x, p1, path);
    secondClaim(b, x, b.r.chance(0.3) ? [p1[0], 'g3'] : p2, path, b.r.pick(SECOND_CLAIMS));
  }],
  ['r3-agent-multi-meta-only', (b) => {
    const [p1, p2] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`wt-raw-${b.fresh('t')}`, b.r.project());
    claimVia(b, x, p1, 'start'); b.toolInBy(x, p1, path); b.meta('agent', x, p2, path);
  }],
  ['r3-dup-rows', (b) => {
    const [p1] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`wt-raw-${b.fresh('t')}`, b.r.project());
    claimVia(b, x, p1, b.r.pick(['start', 'launch'] as const)); b.toolInBy(x, p1, path);
    b.row('agent', x, p1, b.r.chance(0.5));
    if (b.r.chance(0.3)) b.row('agent', x, p1, b.r.chance(0.5));
  }],
  ['r3-horizon', (b) => {
    const [p1, p2] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`wt-raw-${b.fresh('t')}`, b.r.project());
    claimVia(b, x, p1, b.r.pick(['start', 'launch'] as const)); b.toolInBy(x, p1, path);
    r3Dropped(b, b.r.pick(R3_DROPPED), x, p1, p2, path);
  }],
  ['r3-no-activity', (b) => {                                                     // an event from inside an agent no qualifying join opened: evidence, not placement
    const [p1] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`wt-raw-${b.fresh('t')}`, b.r.project());
    if (b.r.chance(0.5)) { claimVia(b, x, p1, b.r.pick(['start', 'launch'] as const)); b.remove('agent', x, p1); }
    b.toolInBy(x, p1, path);
  }],
  ['r3-wrong-incarnation', (b) => {
    const x = b.fresh('a'); const path = b.tree(`wt-raw-${b.fresh('t')}`, b.r.project());
    b.start(x, [PARENT, INC]); b.toolInBy(x, [PARENT, 'g2'], path);
  }],
  ['r3-kind-decoy', (b) => {                                                      // rows of other source kinds under the agent's id and parent: not a hit
    const [p1] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`wt-raw-${b.fresh('t')}`, b.r.project());
    b.row('bash-worktree', x, p1); b.row('workflow', x, p1, b.r.chance(0.5)); b.toolInBy(x, p1, path);
  }],
  ['r3-plain', (b) => { b.tree(`wt-raw-${b.fresh('t')}`, b.r.project()); }],
  ['r3-two-paths-one-agent', (b) => {                                             // one agent places two trees
    const [p1] = b.r.parents(); const x = b.fresh('a');
    const paths = [b.tree(`wt-raw-${b.fresh('t')}`, REPO), b.tree(`wt-raw-${b.fresh('t')}`, b.r.project())];
    claimVia(b, x, p1, b.r.pick(['start', 'launch'] as const));
    for (const path of paths) b.toolInBy(x, p1, path);
    if (b.r.chance(0.5)) b.parentAt(p1, paths[1]!);
  }],
  // ── fix round 1: row order, other-kind metas, incarnations, double claims, and two links on one tree ──
  ['r2-same-id-rows', (b) => {                                                    // rows of one key under ONE activityId: not a duplicate; the first one's journal id is the evidence
    const [p1] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`agent-${x}`, b.r.project());
    b.start(x, p1); b.stop(x, p1); b.meta('agent', x, p1, path);
    b.cloneRow('agent', x, p1, true);
    if (b.r.chance(0.5)) b.cloneRow('agent', x, p1, false);
    if (b.r.chance(0.3)) b.cloneRow('agent', x, p1, b.r.chance(0.5));
    if (b.r.chance(0.2)) b.row('agent', x, p1, b.r.chance(0.5));                  // ... and beside a row of another id: a duplicate again
  }],
  ['r2-same-id-rows-behind', (b) => {
    const [p1] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`agent-${x}`, b.r.project());
    b.launch(x, p1, b.r.pick(['Agent', 'Task'] as const)); b.stop(x, p1); b.meta('agent', x, p1, path);
    b.cloneRow('agent', x, p1, false);
  }],
  ['wf-same-id-rows', (b) => {
    const [p1] = b.r.parents(); const name = `${b.fresh('wf_r')}-0`; const path = b.tree(name, b.r.project());
    b.row('workflow', name, p1); b.meta('workflow', name, p1, path);
    b.cloneRow('workflow', name, p1, b.r.chance(0.5));
    if (b.r.chance(0.5)) b.cloneRow('workflow', name, p1, b.r.chance(0.5));
  }],
  ['r2-other-kind-meta-claimant', (b) => {                                        // a workflow meta for the id, held by the CLAIMANT parent itself
    const [p1] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`agent-${x}`, b.r.project());
    b.start(x, p1); b.stop(x, p1); b.meta('agent', x, p1, path);
    b.meta('workflow', x, p1, b.r.chance(0.5) ? path : `${path}-other`);
  }],
  ['wf-other-kind-meta-claimant', (b) => {
    const [p1] = b.r.parents(); const name = `${b.fresh('wf_r')}-0`; const path = b.tree(name, b.r.project());
    b.row('workflow', name, p1); b.meta('workflow', name, p1, path);
    b.meta('agent', name, p1, b.r.chance(0.5) ? path : `${path}-other`);
  }],
  ['r3-parent-cwd-sibling-incarnation', (b) => {                                  // the hit is by (s, g1); the only report at the path is from (s, g2)
    const x = b.fresh('a'); const path = b.tree(`wt-raw-${b.fresh('t')}`, b.r.project());
    const [mine, sibling]: [PK, PK] = b.r.chance(0.5) ? [[PARENT, INC], [PARENT, 'g2']] : [[PARENT, 'g2'], [PARENT, INC]];
    claimVia(b, x, mine, b.r.pick(['start', 'launch'] as const)); b.toolInBy(x, mine, path);
    b.parentAt(sibling, path);
  }],
  ['r2-double-claim', (b) => {                                                    // one parent claims by a SubagentStart AND by a launch response, and has no meta
    const [p1, p2] = b.r.parents(); const x = b.fresh('a'); b.tree(`agent-${x}`, b.r.project());
    b.start(x, p1); b.launch(x, p1, b.r.pick(['Agent', 'Task'] as const));
    if (b.r.chance(0.5)) b.remove('agent', x, p1);
    if (b.r.chance(0.5)) secondClaim(b, x, p2, '', b.r.pick(['start', 'launch', 'start-only', 'launch-only'] as const));
  }],
  ['r2-double-claim-two-parents', (b) => {
    const [p1, p2] = b.r.parents(); const x = b.fresh('a'); b.tree(`agent-${x}`, b.r.project());
    b.launch(x, p1, 'Agent'); b.start(x, p1); b.start(x, p2); b.launch(x, p2, 'Task');
  }],
  ['r3-double-claim', (b) => {                                                    // rung 3's claimants check, with a parent that claims twice
    const [p1, p2] = b.r.parents(); const x = b.fresh('a'); const path = b.tree(`wt-raw-${b.fresh('t')}`, b.r.project());
    b.start(x, p1); b.launch(x, p1, 'Agent'); b.toolInBy(x, p1, path);
    if (b.r.chance(0.5)) { b.start(x, p2); b.launch(x, p2, 'Task'); }
  }],
  ['r4-link', (b) => {                                                            // a rung-4 candidate alone
    const [p1] = b.r.parents(); const proj = b.r.project(); const name = `wt-raw-${b.fresh('t')}`; b.tree(name, proj);
    const t0 = b.candidate(name, proj, p1, b.r.chance(0.85));
    const over = b.r.int(0, 3);
    const common = ['main-wt', 'old-wt'];
    if (over === 1) b.windows.push({ sessionId: THIRD, parentIncarnation: INC, toolUseId: 'toolu_u', repository: null, startedAt: T(t0 + 10), endedAt: T(t0 + 20), before: common, after: common });    // a window the caller cannot name
    if (over === 2) b.windows.push({ sessionId: '', parentIncarnation: '', toolUseId: '', repository: proj, lost: true, startedAt: T(t0 + 10), endedAt: T(t0 + 20), before: [], after: null });      // a lost window on the repository
  }],
  ['r34-agree', (b) => {                                                          // a rung-3 hit and a rung-4 candidate of the SAME parent: two links that agree
    const [p1] = b.r.parents(); const proj = b.r.project(); const x = b.fresh('a'); const name = `wt-raw-${b.fresh('t')}`; const path = b.tree(name, proj);
    claimVia(b, x, p1, b.r.pick(['start', 'launch'] as const)); b.toolInBy(x, p1, path);
    b.candidate(name, proj, p1, b.r.chance(0.8));
    if (b.r.chance(0.2)) b.parentAt(p1, path);                                    // rung 3 vetoed beside a rung-4 link
  }],
  ['r34-disagree', (b) => {                                                       // a rung-3 hit of another parent (or another incarnation) beside the candidate: rungs-disagree
    const [p1, p2] = b.r.parents(); const proj = b.r.project(); const x = b.fresh('a'); const name = `wt-raw-${b.fresh('t')}`; const path = b.tree(name, proj);
    const other: PK = b.r.chance(0.35) ? [p1[0], p1[1] === 'g2' ? INC : 'g2'] : p2;
    claimVia(b, x, other, b.r.pick(['start', 'launch'] as const)); b.toolInBy(x, other, path);
    b.candidate(name, proj, p1, b.r.chance(0.9));
  }],
  ['noise', (b) => {                                                              // rows about nobody's tree
    const [p1, p2] = b.r.parents(); const x = b.fresh('a');
    b.start(x, p1); b.toolInBy(x, p1, WTP(REPO, 'nobody')); b.meta('agent', x, p2, WTP(REPO, 'nobody')); b.row('workflow', `${b.fresh('wf_r')}-0`, p2);
    b.tree(`wt-raw-${b.fresh('t')}`, b.r.project());
  }],
];

function generateR2(): R2Pass[] {
  const r = randOf(SEED_R2);
  const passes: R2Pass[] = [];
  for (let i = 0; i < R2_PASSES; i++) {
    const b = new R2Build(r);
    // The first passes cycle the scenes (one each, so every scene is met); the rest are mixes of two to six.
    const chosen: Scene[] = i < SCENES.length ? [SCENES[i]![1]] : [];
    for (let k = i < SCENES.length ? r.int(1, 3) : r.int(2, 6); k > 0; k--) chosen.push(r.pick(SCENES)[1]);
    for (const scene of chosen) scene(b);
    passes.push(b.build());
  }
  return passes;
}

// ── what the test knows of its own rows (never a function of the module) ──
interface Loose { eventKind: string; toolName?: string; agentId?: string; cwd?: string; sessionId: string; parentIncarnation: string; launch?: { agentId?: string } | null }
const loose = (e: Ev): Loose => e as unknown as Loose;
const parentOfEvent = (e: Loose): string => pkey([e.sessionId, e.parentIncarnation]);
const parentOfRow = (a: { parentId: string; parentIncarnation: string }): string => pkey([a.parentId, a.parentIncarnation]);
const sameParentId = (keys: ReadonlySet<string>): boolean => {
  const seen = new Set<string>();
  for (const k of keys) { const id = (JSON.parse(k) as string[])[0]!; if (seen.has(id)) return true; seen.add(id); }
  return false;
};

function factsOf(pass: R2Pass, tree: Tree) {
  const name = tree.record.adminRecord;
  const canonical = tree.record.canonicalPath;
  const { activities, acceptedEvidence, pointMetas } = pass.arrays;
  const events = acceptedEvidence.map((x) => loose(x.event));
  const kind: Kind | null = name.startsWith('agent-') ? 'agent' : name.startsWith('wf_') ? 'workflow' : null;
  const up = kind === 'agent' ? name.slice('agent-'.length) : name;
  const f = {
    kind,
    // the claim, by evidence kind (parents, as keys)
    byRow: new Set<string>(), byMeta: new Set<string>(), byStart: new Set<string>(), byLaunch: new Set<string>(), byStop: new Set<string>(), byDecoy: new Set<string>(),
    launchTools: [] as string[],
    otherKindRows: false, otherKindMetas: false, metasDisagree: false, dupRows: false,
    sameIdRows: false, otherKindMetaOfClaimant: false, doubleClaim: false,
    reportedBy: new Set<string>(),             // plain trees: the parents that reported the path as their own working directory
    candidateParents: [] as string[],          // plain trees: the parents of the held windows that add exactly this record and remove nothing, on its project
    parentCwdAtPath: false, startStopAtPath: false,
    hits: new Map<string, string>(),           // activityId -> parent, the way rung 3 resolves it (the FIRST row of the key)
    hitHasDupRows: false,
  };
  if (kind !== null) {
    for (const a of activities) if (a.sourceKind === kind && a.upstreamId === up) f.byRow.add(parentOfRow(a));
    for (const m of pointMetas) if (m.sourceKind === kind && m.upstreamId === up) f.byMeta.add(parentOfRow(m));
    if (kind === 'agent') {
      for (const e of events) {
        if (e.agentId === up && e.eventKind === 'SubagentStart') f.byStart.add(parentOfEvent(e));
        if (e.agentId === up && e.eventKind === 'SubagentStop') f.byStop.add(parentOfEvent(e));
        if (e.eventKind === 'PostToolUse' && e.launch?.agentId === up) {
          if (e.toolName === 'Agent' || e.toolName === 'Task') { f.byLaunch.add(parentOfEvent(e)); f.launchTools.push(e.toolName); } else f.byDecoy.add(parentOfEvent(e));
        }
      }
    }
    f.otherKindRows = activities.some((a) => a.sourceKind !== kind && a.upstreamId === up);
    f.otherKindMetas = pointMetas.some((m) => m.sourceKind !== kind && m.upstreamId === up);
    const metaPaths = new Map<string, Set<string>>();
    for (const m of pointMetas) if (m.sourceKind === kind && m.upstreamId === up) metaPaths.set(parentOfRow(m), (metaPaths.get(parentOfRow(m)) ?? new Set()).add(m.worktreePath));
    f.metasDisagree = [...metaPaths.values()].some((s) => s.size > 1);
    const rowIds = new Map<string, Set<string>>();
    for (const a of activities) if (a.sourceKind === kind && a.upstreamId === up) rowIds.set(parentOfRow(a), (rowIds.get(parentOfRow(a)) ?? new Set()).add(a.activityId));
    f.dupRows = [...rowIds.values()].some((s) => s.size > 1);
    const rowCounts = new Map<string, number>();
    for (const a of activities) if (a.sourceKind === kind && a.upstreamId === up) rowCounts.set(parentOfRow(a), (rowCounts.get(parentOfRow(a)) ?? 0) + 1);
    f.sameIdRows = [...rowIds].some(([k, ids]) => ids.size === 1 && (rowCounts.get(k) ?? 0) > 1);
    const claimantsHere = new Set([...f.byRow, ...f.byMeta, ...f.byStart, ...f.byLaunch]);
    f.otherKindMetaOfClaimant = pointMetas.some((m) => m.sourceKind !== kind && m.upstreamId === up && claimantsHere.has(parentOfRow(m)));
    f.doubleClaim = [...f.byStart].some((k) => f.byLaunch.has(k));
  } else if (canonical !== null) {
    for (const e of events) {
      if (e.cwd !== canonical) continue;
      if (e.agentId === undefined || e.agentId === '') { f.parentCwdAtPath = true; f.reportedBy.add(parentOfEvent(e)); continue; }
      if (e.eventKind === 'SubagentStart' || e.eventKind === 'SubagentStop') { f.startStopAtPath = true; continue; }
      const first = activities.find((a) => a.sourceKind === 'agent' && a.upstreamId === e.agentId && parentOfRow(a) === parentOfEvent(e));
      if (first === undefined) continue;
      f.hits.set(first.activityId, parentOfRow(first));
      const same = activities.filter((a) => a.sourceKind === 'agent' && a.upstreamId === first.upstreamId && parentOfRow(a) === parentOfRow(first));
      if (new Set(same.map((a) => a.activityId)).size > 1) f.hitHasDupRows = true;
    }
    for (const w of pass.arrays.listingWindows) {
      if (w.lost === true || w.repository !== tree.record.project || w.after === null) continue;
      const before = new Set(w.before);
      const after = new Set(w.after);
      const added = [...after].filter((x) => !before.has(x));
      const removed = [...before].filter((x) => !after.has(x));
      // A candidate links only when its tool call's bash-worktree row is in the pass (rung 4 answers `activity-not-durably-open` without it).
      const hasRow = activities.some((x) => x.sourceKind === 'bash-worktree' && x.upstreamId === w.toolUseId && x.parentId === w.sessionId && x.parentIncarnation === w.parentIncarnation);
      if (hasRow && added.length === 1 && added[0] === name && removed.length === 0) f.candidateParents.push(pkey([w.sessionId, w.parentIncarnation]));
    }
  }
  return f;
}

describe('D-5642 R2: the answers of rungs 2 and 3 are the same before and after the bound', () => {
  it('a seeded stream of lane passes over rung-2 and rung-3 evidence hashes to the constant computed at main, and reaches every shape named', () => {
    const passes = generateR2();
    const hist = {
      passes: passes.length, inputs: 0,
      // rung 2: the reasons, and the links
      r2EvidenceAbsent: 0, r2SameUpstreamIdInMultipleSessions: 0, r2DuplicateActivityRows: 0, r2MetaAbsent: 0, r2MetaPathsDisagree: 0, r2PathMismatch: 0,
      r2SubagentEventAbsent: 0, r2ActivityNotDurablyOpen: 0, r2EvidenceHorizon: 0, r2Linked: 0, r2LinkedAgent: 0, r2LinkedWorkflow: 0,
      // rung 3 (plain trees): the reasons, and the links
      r3AgentIdClaimedByMultipleSessions: 0, r3PathClaimedByMultipleParents: 0, r3ParentCwd: 0, r3AmbiguousSubagentPath: 0, r3EvidenceHorizon: 0,
      r3NoCorrelatingEvidence: 0, r3Linked: 0,
      // the claims, each counted from the rows of the pass the tree is answered in. "ONLY" means it is the whole claim evidence for the id: no
      // activity row, no meta and no other kind of claiming event names the id for any parent.
      claimByStartOnly: 0, claimByLaunchOnlyAgentTool: 0, claimByLaunchOnlyTaskTool: 0, claimByMetaOnly: 0,
      stopAloneParent: 0, otherToolLaunchObject: 0, workflowMetaWithoutRow: 0,
      idUnderTwoIncarnations: 0, agentTreeClaimedByTwoParents: 0, workflowTreeClaimedByTwoParents: 0,
      idUnderTwoSourceKindsAgentTree: 0, idUnderTwoSourceKindsWorkflowTree: 0,
      parentReportedCwdAtPath: 0, startStopCwdAtPath: 0, twoMetasDisagree: 0, duplicateRowsRung2: 0, duplicateRowsRung3: 0,
      twoHitsOneParent: 0, twoHitsTwoParents: 0,
      // fix round 1: two links on one tree, rows that share an activityId, an other-kind meta of the claimant itself, a sibling incarnation's report,
      // a parent that claims twice
      r4Linked: 0, r34Agree: 0, r34Disagree: 0, sameActivityIdRowsRung2: 0, otherKindMetaOfClaimant: 0, parentCwdFromSiblingIncarnation: 0, doubleClaimParent: 0,
      // the forced reruns of these trees
      markLossy: 0, markProject: 0, markPrefix: 0, markPath: 0, markId: 0, unknownWindowForced: 0, lostEvidenceForced: 0, lostEvidenceAsked: 0,
    };
    const answers: unknown[] = [];
    for (const pass of passes) {
      const lane = r2Lane(pass);
      lane.forEach((a, i) => {
        const tree = pass.trees[i]!;
        const { verdict } = a;
        const f = factsOf(pass, tree);
        hist.inputs += 1;
        // Plain JSON throughout (`canonicalDelegationJson` refuses anything else): the verdict, then the three reruns.
        answers.push({ verdict, mark: a.mark, unknown: a.unknown, lost: a.lost });
        const reason = 'reason' in verdict ? verdict.reason : null;
        const forced = forcedKindOf(a);
        if (forced === 'lossy') hist.markLossy += 1;
        if (forced === 'project') hist.markProject += 1;
        if (forced === 'prefix') hist.markPrefix += 1;
        if (forced === 'path') hist.markPath += 1;
        if (forced === 'id') hist.markId += 1;
        if (a.lost !== null) hist.lostEvidenceAsked += 1;
        if (a.lost === true) hist.lostEvidenceForced += 1;
        if (a.unknown) hist.unknownWindowForced += 1;

        if (f.kind !== null) {
          // ── rung 2 ──
          if (reason === 'rung-2-evidence-absent') hist.r2EvidenceAbsent += 1;
          if (reason === 'same-upstream-id-in-multiple-sessions') hist.r2SameUpstreamIdInMultipleSessions += 1;
          if (reason === 'duplicate-activity-rows') hist.r2DuplicateActivityRows += 1;
          if (reason === 'rung-2-meta-absent') hist.r2MetaAbsent += 1;
          if (reason === 'meta-paths-disagree') hist.r2MetaPathsDisagree += 1;
          if (reason === 'rung-2-path-mismatch') hist.r2PathMismatch += 1;
          if (reason === 'rung-2-subagent-event-absent') hist.r2SubagentEventAbsent += 1;
          if (reason === 'activity-not-durably-open') hist.r2ActivityNotDurablyOpen += 1;
          if (reason === 'evidence-horizon') hist.r2EvidenceHorizon += 1;
          if (verdict.kind === 'linked') { hist.r2Linked += 1; if (f.kind === 'agent') hist.r2LinkedAgent += 1; else hist.r2LinkedWorkflow += 1; }

          const claimants = new Set([...f.byRow, ...f.byMeta, ...f.byStart, ...f.byLaunch]);
          if (f.byStart.size > 0 && f.byRow.size === 0 && f.byMeta.size === 0 && f.byLaunch.size === 0) hist.claimByStartOnly += 1;
          if (f.byLaunch.size > 0 && f.byRow.size === 0 && f.byMeta.size === 0 && f.byStart.size === 0) {
            if (f.launchTools.every((t) => t === 'Agent')) hist.claimByLaunchOnlyAgentTool += 1;
            if (f.launchTools.every((t) => t === 'Task')) hist.claimByLaunchOnlyTaskTool += 1;
          }
          if (f.kind === 'agent' && f.byMeta.size > 0 && f.byRow.size === 0 && f.byStart.size === 0 && f.byLaunch.size === 0) hist.claimByMetaOnly += 1;
          if ([...f.byStop].some((p) => !claimants.has(p))) hist.stopAloneParent += 1;
          if ([...f.byDecoy].some((p) => !claimants.has(p))) hist.otherToolLaunchObject += 1;
          if (f.kind === 'workflow' && f.byMeta.size > 0 && f.byRow.size === 0) hist.workflowMetaWithoutRow += 1;
          if (sameParentId(claimants)) hist.idUnderTwoIncarnations += 1;
          if (claimants.size > 1) { if (f.kind === 'agent') hist.agentTreeClaimedByTwoParents += 1; else hist.workflowTreeClaimedByTwoParents += 1; }
          if (f.otherKindRows || f.otherKindMetas) { if (f.kind === 'agent') hist.idUnderTwoSourceKindsAgentTree += 1; else hist.idUnderTwoSourceKindsWorkflowTree += 1; }
          if (f.metasDisagree) hist.twoMetasDisagree += 1;
          if (f.dupRows) hist.duplicateRowsRung2 += 1;
          if (f.sameIdRows) hist.sameActivityIdRowsRung2 += 1;
          if (f.otherKindMetaOfClaimant) hist.otherKindMetaOfClaimant += 1;
          if (f.doubleClaim) hist.doubleClaimParent += 1;
        } else {
          // ── rung 3 (a plain tree) ──
          if (reason === 'agent-id-claimed-by-multiple-sessions') hist.r3AgentIdClaimedByMultipleSessions += 1;
          if (reason === 'path-claimed-by-multiple-parents') hist.r3PathClaimedByMultipleParents += 1;
          if (reason === 'parent-cwd') hist.r3ParentCwd += 1;
          if (reason === 'ambiguous-subagent-path') hist.r3AmbiguousSubagentPath += 1;
          if (reason === 'evidence-horizon') hist.r3EvidenceHorizon += 1;
          if (reason === 'no-correlating-evidence') hist.r3NoCorrelatingEvidence += 1;
          if (verdict.kind === 'linked' && verdict.rung === 3) hist.r3Linked += 1;
          if (f.parentCwdAtPath) hist.parentReportedCwdAtPath += 1;
          if (f.startStopAtPath) hist.startStopCwdAtPath += 1;
          if (f.hitHasDupRows) hist.duplicateRowsRung3 += 1;
          const hitParents = new Set(f.hits.values());
          if (f.hits.size > 1 && hitParents.size === 1) hist.twoHitsOneParent += 1;
          if (f.hits.size > 1 && hitParents.size > 1) hist.twoHitsTwoParents += 1;
          if (verdict.kind === 'linked' && verdict.rung === 4) hist.r4Linked += 1;
          if (verdict.kind === 'linked' && verdict.rung === 3 && f.candidateParents.length === 1 && hitParents.size === 1 && hitParents.has(f.candidateParents[0]!)) hist.r34Agree += 1;
          if (reason === 'rungs-disagree') hist.r34Disagree += 1;
          const idOf = (k: string): string => (JSON.parse(k) as string[])[0]!;
          if (hitParents.size > 0 && f.reportedBy.size > 0 && [...hitParents].every((hp) => !f.reportedBy.has(hp))
            && [...f.reportedBy].some((rp) => [...hitParents].some((hp) => idOf(rp) === idOf(hp)))) hist.parentCwdFromSiblingIncarnation += 1;
        }
      });
    }

    // Every shape the stream is meant to reach is reached (each count above zero), so a drift of the stream shows in the histogram too.
    for (const [name, count] of Object.entries(hist)) expect(count, `histogram item ${name} is reached`).toBeGreaterThan(0);
    expect(hist.inputs, 'inputs generated').toBeGreaterThanOrEqual(2000);
    expect(hist, 'histogram').toEqual(EXPECTED_HISTOGRAM_R2);

    // The digest: sha256 of the canonical JSON of every answer, in generation order.
    expect(delegationSha256Hex(canonicalDelegationJson(answers))).toBe(EXPECTED_DIGEST_R2);
  });
});

// Computed once at main, before the bound (seed 0x5642b2).
const EXPECTED_DIGEST_R2 = '726f5907838d385e514957818a619de9b375ec10d97f8a9e4b3b967ba8494029';
const EXPECTED_HISTOGRAM_R2 = {
  passes: 580, inputs: 2336,
  r2EvidenceAbsent: 94, r2SameUpstreamIdInMultipleSessions: 176, r2DuplicateActivityRows: 61, r2MetaAbsent: 286, r2MetaPathsDisagree: 63, r2PathMismatch: 63,
  r2SubagentEventAbsent: 58, r2ActivityNotDurablyOpen: 94, r2EvidenceHorizon: 141, r2Linked: 390, r2LinkedAgent: 236, r2LinkedWorkflow: 154,
  r3AgentIdClaimedByMultipleSessions: 97, r3PathClaimedByMultipleParents: 35, r3ParentCwd: 71, r3AmbiguousSubagentPath: 37, r3EvidenceHorizon: 103, r3NoCorrelatingEvidence: 266, r3Linked: 222,
  claimByStartOnly: 42, claimByLaunchOnlyAgentTool: 52, claimByLaunchOnlyTaskTool: 62, claimByMetaOnly: 29,
  stopAloneParent: 94, otherToolLaunchObject: 96, workflowMetaWithoutRow: 37,
  idUnderTwoIncarnations: 78, agentTreeClaimedByTwoParents: 140, workflowTreeClaimedByTwoParents: 36,
  idUnderTwoSourceKindsAgentTree: 133, idUnderTwoSourceKindsWorkflowTree: 84,
  parentReportedCwdAtPath: 137, startStopCwdAtPath: 48, twoMetasDisagree: 63, duplicateRowsRung2: 61, duplicateRowsRung3: 35,
  twoHitsOneParent: 46, twoHitsTwoParents: 35,
  r4Linked: 33, r34Agree: 23, r34Disagree: 37, sameActivityIdRowsRung2: 123, otherKindMetaOfClaimant: 83, parentCwdFromSiblingIncarnation: 43, doubleClaimParent: 105,
  markLossy: 47, markProject: 31, markPrefix: 31, markPath: 14, markId: 19, unknownWindowForced: 7, lostEvidenceForced: 13, lostEvidenceAsked: 841,
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// D-5642 R3: the order of a candidate's lost windows
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//
//   D-5642 R3, the order. Rung 4 meets a candidate's lost windows (those that may be on its project, in the list's order) and answers at the
//      FIRST one that has an instant the model refuses (`listing-window-instant-unreadable`) or overlaps the candidate (`evidence-horizon`).
//      A per-project view of the lost windows built once per pass must therefore keep the list's order, whichever of the windows are named for
//      the project and whichever are on every repository: nothing else in this file or in the cost file sees a view that regroups them.

describe('D-5642 R3: a candidate meets its project\'s lost windows in list order', () => {
  const NAME = 'wt-raw-0';
  const CALL = 'toolu_candidate';
  /** One plain tree with exactly ONE rung-4 candidate on project-a (a held, closed window of lane-a-demo that adds exactly that name and
   *  removes none, with its Pre and Post in the evidence so its activity opens), no horizon, a measured empty dropped index, and the given
   *  lost windows after it, in the given order. */
  function candidateAnswer(lost: readonly DelegationListingWindow[]): DelegationCorrelationVerdict {
    const common = ['main-wt', 'old-wt'];
    const candidate: DelegationListingWindow = {
      sessionId: PARENT, parentIncarnation: INC, toolUseId: CALL, repository: REPO,
      startedAt: T(100), endedAt: T(110), before: [...common], after: [...common, NAME],
    };
    const w = world([bashPre(100, CALL, common), bashPost(110, CALL, [...common, NAME])]);
    return correlateDelegation(input({
      record: rawRecord(NAME), activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [candidate, ...lost],
      droppedEvidence: indexDelegationDropped([]), firstSighting: { after: T(0), at: T(5003) },
    }));
  }
  /** On every repository, from an instant the model refuses (no milliseconds), over the candidate. */
  const unreadable: DelegationListingWindow = {
    sessionId: '', parentIncarnation: '', toolUseId: '', repository: null, lost: true,
    startedAt: '2026-10-14T00:00:00Z', endedAt: T(200), before: [], after: null,
  };
  /** Named for project-a, closed, readable, and overlapping the candidate. */
  const overlapping: DelegationListingWindow = {
    sessionId: OTHER, parentIncarnation: INC, toolUseId: '', repository: REPO, lost: true,
    startedAt: T(105), endedAt: T(120), before: [], after: null,
  };

  it('control: the candidate alone links at rung 4', () => {
    expect(summary(candidateAnswer([]))).toBe('linked:4');
  });
  it('the unreadable every-repository window first: unmeasured(listing-window-instant-unreadable)', () => {
    expect(summary(candidateAnswer([unreadable, overlapping]))).toBe('unmeasured:listing-window-instant-unreadable');
  });
  it('the named overlapping window first: unmeasured(evidence-horizon)', () => {
    expect(summary(candidateAnswer([overlapping, unreadable]))).toBe('unmeasured:evidence-horizon');
  });
});
