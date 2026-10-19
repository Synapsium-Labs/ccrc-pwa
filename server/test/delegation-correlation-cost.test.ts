// Delegation broker, rung 4's cost (D-5604): each listing window's delta and parsed span are properties of the WINDOW, so a reconcile pass that
// correlates every census tree against the SAME window objects must read each window a constant number of times, however many trees there are.
// Two rows hold that:
//
//   D-5604 R1, the cost pin. The windows' `before` and `after` arrays are Proxies that count WHOLE-LISTING reads (the iterator and every
//      Array.prototype method: any string key that is neither an index nor `length`), and `parseDelegationInstant` is wrapped to count the
//      parses of every instant. A pass runs the ladder the way the reconcile lane does (`correlateDelegation` for every tree around a
//      FRESH input object per call over ONE windows array, then `delegationMarkForced` / `delegationUnknownWindowForced`, then
//      `delegationLostEvidenceForced`), the lane's two lost windows included, and each array's reads and each window instant's parses at 20
//      trees must equal those at 40 trees and stay within one. No clock.
//   D-5604 R2, the equivalence digest. A seeded, deterministic stream of passes (one windows array shared by several census records, each
//      correlated and re-run as the lane does) is answered by the four public functions, and a sha256 of every answer is held to a constant
//      computed before the cost fix, together with a histogram of the verdict shapes the stream reaches. A change that makes rung 4
//      cheaper must not move a single answer.
//
// Fixtures only: names are `lane-a-demo`, `lane-b-demo`, `project-a`, `/fixture/...`. No file is read or written.
import { describe, it, expect, vi } from 'vitest';
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
  type DelegationHashSet,
  type DelegationListingWindow,
  type DelegationMarkKind,
} from '../src/coord/delegation-correlation.js';
import {
  DELEGATION_INTERVAL_RETENTION_HOURS,
  canonicalDelegationJson,
  delegationSha256Hex,
  formatDelegationInstant,
  parseDelegationInstant,
  type DelegationCensusRecord,
  type DelegationJournalRecordV1,
} from '../src/coord/delegation-model.js';
import { delegationLostWindowsOf, delegationNotReadyWindowOf } from '../src/watch.js';

// The parse log: R1 counts how many times each instant string is parsed while the lane's calls run. The correlation module imports the
// parser from this very module id, so wrapping it here is what the ladder calls. Off outside R1's measured stretch.
const parseLog = vi.hoisted(() => ({ on: false, counts: new Map<string, number>() }));
vi.mock('../src/coord/delegation-model.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/coord/delegation-model.js')>();
  return {
    ...real,
    parseDelegationInstant: (iso: string): number => {
      if (parseLog.on) parseLog.counts.set(iso, (parseLog.counts.get(iso) ?? 0) + 1);
      return real.parseDelegationInstant(iso);
    },
  };
});

// ── fixtures (the style of delegation-correlation.test.ts, copied: a test file imports no other test file) ──────────────

const PARENT = 'lane-a-demo';
const OTHER = 'lane-b-demo';
const THIRD = 'lane-c-demo';
const INC = 'g1';
const AGENT = 'abc123def456';
const REPO = 'project-a';
const OTHER_REPO = 'project-b';
const CLAUDE = '11111111-2222-3333-4444-555555555555';
const WTP = (project: string, name: string): string => `/fixture/${project}/.claude/worktrees/${name}`;
const T = (s: number): string => formatDelegationInstant(Date.UTC(2026, 9, 14) + s * 1000);

interface Over { sessionId?: string; parentIncarnation?: string; cwd?: string }
const mkBase = (n: number, over: Over = {}) => ({
  v: 1 as const, observedAt: T(n), sessionId: over.sessionId ?? PARENT, parentIncarnation: over.parentIncarnation ?? INC,
  claudeSessionId: CLAUDE, ...(over.cwd === undefined ? {} : { cwd: over.cwd }),
  eventId: delegationSha256Hex(`fixture-cost-event-${n}`), bucket: '2026101400', startOffset: n * 100, endOffset: n * 100 + 99,
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
/** A tool event of the PARENT itself, with a working directory: it vetoes a rung-3 hit at that path (ruling R42). */
const parentAt = (n: number, cwd: string): DelegationEventEnvelopeV1 =>
  ({ ...mkBase(n, { cwd }), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_pr_${n}`, outcome: 'completed' });

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

// ── the lane, replayed ────────────────────────────────────────────────────────────────────────────────────────────────

/** One census tree of a pass: the record, when it was first sighted, and the horizon its input carries. */
interface Tree {
  record: DelegationCensusRecord;
  firstSighting: { after: string | null; at: string };
  evidenceHorizon: string | null;
}
/** One reconcile pass: ONE windows array shared by every tree's input, as `watch.ts` builds it. */
interface Pass {
  trees: Tree[];
  windows: DelegationListingWindow[];
  activities: DelegationCorrelationInput['activities'];
  acceptedEvidence: DelegationCorrelationInput['acceptedEvidence'];
  droppedEvidence: DelegationDroppedEvidence;
}
/** A tree's input: a FRESH object around the pass's shared windows, as `inputFor` builds one at every call (`watch.ts`). */
const inputFor = (p: Pass, t: Tree): DelegationCorrelationInput => input({
  record: t.record, activities: p.activities, acceptedEvidence: p.acceptedEvidence, listingWindows: p.windows, droppedEvidence: p.droppedEvidence,
  evidenceHorizon: t.evidenceHorizon, firstSighting: t.firstSighting,
});

interface LaneAnswer {
  verdict: DelegationCorrelationVerdict;
  /** `delegationMarkForced`, asked only under a measured index (else null). */
  mark: DelegationMarkKind | null;
  /** `delegationUnknownWindowForced`, asked only when a held window has no repository (else false). */
  unknown: boolean;
  /** `delegationLostEvidenceForced`, asked only of an `unmeasured` verdict (else null). */
  lost: boolean | null;
}

/**
 * The calls `watch.ts` makes after the windows are built, in its order and under its conditions: the ladder for every tree; then, when the
 * index is measured or a held window has no repository, for every tree `mark ?? (unknown ? 'window' : null)`; then, for every `unmeasured`
 * verdict, the lost-evidence rerun (no lease filter: a test holds no lease). `exhaustive` asks BOTH forced kinds of every tree (the lane's
 * `??` stops at a mark), so an answer the lane would not have read is still compared.
 */
function runLane(p: Pass, exhaustive: boolean): LaneAnswer[] {
  const pairs = p.trees.map((t) => ({ t, verdict: correlateDelegation(inputFor(p, t)) }));
  const answers: LaneAnswer[] = pairs.map(({ verdict }) => ({ verdict, mark: null, unknown: false, lost: null }));
  const unknownWindows = p.windows.some((w) => w.repository === null && w.lost !== true);
  if (p.droppedEvidence.measured || unknownWindows) {
    pairs.forEach(({ t, verdict }, i) => {
      const inp = inputFor(p, t);
      const a = answers[i]!;
      if (p.droppedEvidence.measured) a.mark = delegationMarkForced(inp, verdict);
      if (unknownWindows && (exhaustive || a.mark === null)) a.unknown = delegationUnknownWindowForced(inp, verdict);
    });
  }
  pairs.forEach(({ t, verdict }, i) => {
    if (verdict.kind !== 'unmeasured') return;
    answers[i]!.lost = delegationLostEvidenceForced(inputFor(p, t), verdict);
  });
  return answers;
}
/** What the lane counts a tree's forced rerun as. */
const forcedKindOf = (a: LaneAnswer): DelegationMarkKind | null => a.mark ?? (a.unknown ? 'window' : null);
const summary = (v: DelegationCorrelationVerdict): string => (v.kind === 'linked' ? `linked:${v.rung}` : 'reason' in v ? `${v.kind}:${v.reason}` : v.kind);

/** A measured index whose marks name an id nothing here uses and the canonical paths of the trees given. */
const marksFor = (markedPaths: readonly string[]): DelegationDroppedEvidence => {
  const ids = emptyDelegationHashSet();
  delegationHashSetAdd(ids, 'unrelated-id', 100);
  const paths: DelegationHashSet = emptyDelegationHashSet();
  for (const path of markedPaths) delegationHashSetAdd(paths, path, 100);
  return indexDelegationDropped([], { ...DELEGATION_NO_MARKS, ids, paths: markedPaths.length === 0 ? [] : [paths] });
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// D-5604 R1: the cost pin
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** The bound under test: one whole-listing read per array, and one parse per window instant, per pass (a window's delta and its span are
 *  computed once, however many trees ask and however many times the lane reruns the ladder). */
const MAX_PER_PASS = 1;

/** An array that counts every WHOLE-LISTING read: the iterator, and any string key that is not an index and not `length`
 *  (`includes`, `indexOf`, `filter`, `some`, `every`, `forEach`, `map`, `find`, `slice`, `entries`, `values`, ...). */
function counted(items: readonly string[], label: string, reads: Map<string, number>): readonly string[] {
  reads.set(label, 0);
  return new Proxy([...items], {
    get(target, key, receiver) {
      if (key === Symbol.iterator || (typeof key === 'string' && key !== 'length' && !/^\d+$/.test(key))) reads.set(label, (reads.get(label) ?? 0) + 1);
      return Reflect.get(target, key, receiver);
    },
  });
}

type Shape = 'unresolved' | 'horizon' | 'restart' | 'candidates';
const SHAPES: readonly Shape[] = ['unresolved', 'horizon', 'restart', 'candidates'];
const SHAPE_NOTE: Record<Shape, string> = {
  unresolved: '(i) no window adds a tree\'s record: unresolved',
  horizon: '(ii) the same windows, every tree under an evidence horizon: unmeasured(evidence-horizon)',
  restart: '(iii) every window\'s repository is lost, as after a restart',
  candidates: '(iv) trees 0-3 each have a candidate window, the rest none',
};
const READY_AT = Date.UTC(2026, 9, 14) - 3600_000;        // the lane's latest ready instant: before every fixture window
const LANE_NOW = Date.UTC(2026, 9, 4);                       // the retention floor ends days before the fixture clock

/**
 * One reconcile pass over `trees` census trees and ONE set of window objects. The lane's own two lost windows (the retention floor and the
 * not-ready window, the lane's own functions) sit on every repository after the held ones. The held windows, all closed, each with its own
 * distinct pair of instants:
 *   creators  four windows of lane-a-demo, each adding ONE record `wt-raw-<j>` (a candidate for tree j alone, in `candidates`; in `restart`
 *             with a lost repository, so the creator of tree j may be among the held windows with no repository);
 *   seeds     four windows adding a name that is nobody's record (`unresolved`, `horizon`, `restart` only);
 *   twos      two windows of lane-b-demo adding TWO names;
 *   none      one window of lane-b-demo that adds nothing;
 *   unknown   one closed window of lane-c-demo whose repository is null (the caller lost it), adding nothing.
 * Trees: `unresolved` has no rung-3 evidence and no horizon; `horizon` gives every tree a rung-3 hit at its path and a horizon after every
 * window, odd trees also path-marked (so the mark rerun really runs); `restart` mixes four kinds by tree number (plain, horizon only, rung-3
 * hit and horizon, and that with a path mark); `candidates` is trees 0 and 1 linking at rung 4, trees 2 and 3 under a horizon after every
 * window, the rest without a candidate.
 */
function r1Pass(shape: Shape, trees: number) {
  const reads = new Map<string, number>();
  const common = ['main-wt', 'old-wt'];
  const defs: { label: string; sessionId: string; repository: string | null; add: readonly string[] }[] = [];
  const repo = shape === 'restart' ? null : REPO;
  for (let j = 0; j < 4; j++) {
    if (shape === 'unresolved' || shape === 'horizon') defs.push({ label: `seed${j}`, sessionId: PARENT, repository: repo, add: [`seed-${j}`] });
    else defs.push({ label: `creator${j}`, sessionId: PARENT, repository: repo, add: [`wt-raw-${j}`] });
  }
  if (shape === 'restart') for (let j = 0; j < 4; j++) defs.push({ label: `seed${j}`, sessionId: PARENT, repository: repo, add: [`seed-${j}`] });
  for (let j = 0; j < 2; j++) defs.push({ label: `two${j}`, sessionId: OTHER, repository: repo, add: [`two-${j}-a`, `two-${j}-b`] });
  defs.push({ label: 'none', sessionId: OTHER, repository: repo, add: [] });
  defs.push({ label: 'unknown', sessionId: THIRD, repository: null, add: [] });
  // Every window has its own pair of instants (so a parse is attributable to one window): 1000 s apart, an odd offset and a distinct length.
  const held: DelegationListingWindow[] = defs.map((d, k) => ({
    sessionId: d.sessionId, parentIncarnation: INC, toolUseId: `toolu_${d.label}`, repository: d.repository,
    startedAt: T(1000 * k + 101), endedAt: T(1000 * k + 101 + 7 + k),
    before: counted(common, `${d.label}.before`, reads), after: counted([...common, ...d.add], `${d.label}.after`, reads),
  }));
  const windows = [...held, ...delegationLostWindowsOf([], [], LANE_NOW), delegationNotReadyWindowOf(READY_AT)];

  const names = Array.from({ length: trees }, (_, i) => `wt-raw-${i}`);
  // `kind` of tree i: 0 plain, 1 horizon only, 2 rung-3 hit and horizon, 3 rung-3 hit, horizon and a path mark
  const kindOf = (i: number): number => (shape === 'unresolved' ? 0 : shape === 'horizon' ? 2 + (i % 2) : shape === 'restart' ? i % 4 : 0);
  const horizon = T(60_001);                                   // after every window
  const events: DelegationEventEnvelopeV1[] = [subagentStart(1, AGENT)];
  names.forEach((name, i) => { if (kindOf(i) >= 2) events.push(toolIn(2 + i, AGENT, WTP(REPO, name))); });
  names.forEach((_, i) => { if (i < 4 && shape !== 'unresolved' && shape !== 'horizon') events.push(bashPre(100 + 2 * i, `toolu_creator${i}`, common), bashPost(101 + 2 * i, `toolu_creator${i}`, [...common, `wt-raw-${i}`])); });
  const w = world(events);
  const treeList: Tree[] = names.map((name, i) => ({
    record: rawRecord(name),
    firstSighting: { after: T(0), at: T(5003) },
    evidenceHorizon: shape === 'candidates' ? (i === 2 || i === 3 ? horizon : null) : kindOf(i) >= 1 ? horizon : null,
  }));
  const droppedEvidence = shape === 'unresolved' || shape === 'candidates' ? marksFor([]) : marksFor(names.filter((_, i) => kindOf(i) === 3).map((n) => WTP(REPO, n)));
  const pass: Pass = { trees: treeList, windows, activities: w.activities, acceptedEvidence: w.acceptedEvidence, droppedEvidence };

  const slots = new Map<string, number>();
  for (const x of windows) for (const instant of [x.startedAt, x.endedAt]) if (instant !== null) slots.set(instant, (slots.get(instant) ?? 0) + 1);
  for (const t of treeList) for (const instant of [t.evidenceHorizon, t.firstSighting.after, t.firstSighting.at]) {
    if (instant !== null && slots.has(instant)) throw new Error(`fixture error: ${instant} is both a window instant and a per-call instant`);
  }
  parseLog.counts.clear();
  parseLog.on = true;
  let answers: LaneAnswer[];
  try { answers = runLane(pass, false); } finally { parseLog.on = false; }
  const parses = new Map([...slots.keys()].map((k) => [k, parseLog.counts.get(k) ?? 0]));
  return { answers, reads, parses, slots };
}

/** The verdict of each tree, the lane's forced kind, and the lost-evidence rerun, as the sanity rows pin them. */
const laneSummary = (answers: readonly LaneAnswer[]) => answers.map((a) => [summary(a.verdict), forcedKindOf(a), a.lost] as const);

describe('D-5604 R1: rung 4 reads each listing window, and parses each of its instants, a constant number of times per pass however many trees there are', () => {
  for (const shape of SHAPES) {
    describe(SHAPE_NOTE[shape], () => {
      it('the scenario reaches rung 4 and the lane\'s reruns (a verdict list that stops reaching rung 4 reds here, not in the cost row)', () => {
        const { answers } = r1Pass(shape, 20);
        const rows = laneSummary(answers);
        expect(rows.length).toBe(20);
        const plain = ['unresolved:no-correlating-evidence', null, null] as const;
        const lostCreatorLinkedAtRung3 = ['unmeasured:evidence-horizon', null, true] as const;
        const markedByPath = ['unmeasured:evidence-horizon', 'path', false] as const;
        if (shape === 'unresolved') expect(rows).toEqual(Array.from({ length: 20 }, () => plain));
        if (shape === 'horizon') expect(rows).toEqual(Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? lostCreatorLinkedAtRung3 : markedByPath)));
        if (shape === 'restart') {
          // 0 plain (tree 0..3 have a creator among the held windows with no repository: a lost creator, which decides nothing alone),
          // 1 horizon only (a lost creator alone decides nothing), 2 a link beside a lost creator, 3 that, path-marked
          expect(rows).toEqual(Array.from({ length: 20 }, (_, i) => [plain, plain, lostCreatorLinkedAtRung3, markedByPath][i % 4]!));
        }
        if (shape === 'candidates') {
          expect(rows.slice(0, 4)).toEqual([['linked:4', null, null], ['linked:4', null, null],
            ['unmeasured:evidence-horizon', null, false], ['unmeasured:evidence-horizon', null, false]]);
          expect(rows.slice(4)).toEqual(Array.from({ length: 16 }, () => plain));
        }
      });
      it(`each array's whole-listing reads and each window instant's parses are at most ${MAX_PER_PASS} per pass, and the same at 20 and at 40 trees`, () => {
        const small = r1Pass(shape, 20);
        const large = r1Pass(shape, 40);
        // Not vacuous: the pass reads listings and parses window instants at all.
        expect([...small.reads.values()].reduce((a, b) => a + b, 0), 'listings read at 20 trees').toBeGreaterThan(0);
        // (Under a horizon `creatorMayBeLost` answers before it reads any lost window, and no tree has a candidate: nothing to parse.)
        if (shape !== 'horizon') expect([...small.parses.values()].reduce((a, b) => a + b, 0), 'window instants parsed at 20 trees').toBeGreaterThan(0);
        const growth = (what: string, a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): string[] =>
          [...a].filter(([k, n]) => b.get(k) !== n).map(([k, n]) => `${what} ${k}: ${n} at 20 trees, ${String(b.get(k))} at 40`);
        expect(growth('listing', small.reads, large.reads), 'listing reads grow with the number of trees').toEqual([]);
        expect(growth('instant', small.parses, large.parses), 'instant parses grow with the number of trees').toEqual([]);
        // A window instant's allowance is one parse per window that carries it (the lane's two lost windows both begin at the epoch).
        const over = [
          ...[...large.reads].filter(([, n]) => n > MAX_PER_PASS).map(([k, n]) => `listing ${k}: ${n} reads`),
          ...[...large.parses].filter(([k, n]) => n > MAX_PER_PASS * large.slots.get(k)!).map(([k, n]) => `instant ${k}: ${n} parses (windows carrying it: ${large.slots.get(k)})`),
        ];
        expect(over, `reads and parses past the bound of ${MAX_PER_PASS} per pass at 40 trees`).toEqual([]);
      });
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// D-5604 R2: the equivalence digest
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

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

const SEED = 0x5eed627;
const RANDOM_PASSES = 560;
const RECORD_NAMES = ['wt-raw-0', 'wt-raw-1', 'wt-raw-2', 'wt-raw-3', 'wt-raw-4', 'wt-raw-5'];
const OUTSIDERS = ['n1', 'n2', 'n3', 'n4'];
const ALL_NAMES = [...RECORD_NAMES, ...OUTSIDERS];
const PARENTS: readonly (readonly [string, string])[] = [[PARENT, INC], [OTHER, INC], [THIRD, INC], [PARENT, 'g2']];
const TOOLS = ['toolu_t0', 'toolu_t1', 'toolu_t2', 'toolu_t3'];
/** Instants the model refuses: no milliseconds, an offset, a date that rolls over, a space for the T. */
const BAD_INSTANTS = ['2026-10-14T00:00:00Z', '2026-10-14T00:00:00.000+00:00', '2026-02-30T00:00:00.000Z', '2026-10-14 00:00:00.000Z'];

/** One world holds a bash-worktree activity and a Pre and a Post for every (parent, tool) pair, a subagent, and for every record path a
 *  tool event from inside the subagent and a tool event of the parent itself. A pass takes a random subset of its rows. */
function buildWorld() {
  const events: DelegationEventEnvelopeV1[] = [];
  let n = 1;
  for (const [sessionId, parentIncarnation] of PARENTS) {
    for (const tool of TOOLS) {
      events.push(bashPre(n, tool, ['main-wt'], { sessionId, parentIncarnation }));
      events.push(bashPost(n + 1, tool, ['main-wt', 'wt-raw-0'], { sessionId, parentIncarnation }));
      n += 2;
    }
  }
  events.push(subagentStart(n, AGENT));
  n += 1;
  for (const project of [REPO, OTHER_REPO]) {
    for (const name of RECORD_NAMES) {
      events.push(toolIn(n, AGENT, WTP(project, name)));
      events.push(parentAt(n + 1, WTP(project, name)));
      n += 2;
    }
  }
  const full = world(events);
  const kindOf = (e: DelegationEventEnvelopeV1): 'start' | 'inside' | 'parent' | 'bash' =>
    e.eventKind === 'SubagentStart' ? 'start' : e.agentId === AGENT ? 'inside' : e.cwd !== undefined ? 'parent' : 'bash';
  return {
    bashActivities: full.activities.filter((a) => a.sourceKind !== 'agent'),
    agentActivities: full.activities.filter((a) => a.sourceKind === 'agent'),
    evidence: full.acceptedEvidence.map((e) => ({ ...e, kind: kindOf(e.event) })),
  };
}

/** The window's delta as the test computes it from its own data, independent of the module. */
function deltaOf(w: DelegationListingWindow): { added: string[]; removed: string[] } | null {
  if (w.after === null) return null;
  const before = new Set(w.before);
  const after = new Set(w.after);
  return { added: [...after].filter((x) => !before.has(x)), removed: [...before].filter((x) => !after.has(x)) };
}
/** A window that added exactly this record and removed nothing. */
const soleOf = (w: DelegationListingWindow, name: string): boolean => {
  const d = deltaOf(w);
  return d !== null && d.added.length === 1 && d.added[0] === name && d.removed.length === 0;
};
/** The same rule as the module's, spelled again: a window with no repository, or this one, or a listing attributed to no repository or this one. */
const mayBeOnHere = (w: DelegationListingWindow, project: string): boolean =>
  w.repository === null || w.repository === project || (w.listedRepository !== undefined && (w.listedRepository === null || w.listedRepository === project));

/**
 * The stream: first two hand-built passes (a lost creator that is only a held, closed window with no repository, and its twin), then
 * RANDOM_PASSES generated ones. A pass holds three to six census records (different admin records, some on another project), one windows
 * array shared by all of them, and the evidence, index and horizon the lane would hand them.
 */
function generate(): Pass[] {
  const w = buildWorld();
  const rnd = mulberry32(SEED);
  const chance = (p: number): boolean => rnd() < p;
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <X>(xs: readonly X[]): X => xs[int(0, xs.length - 1)]!;
  const subset = (xs: readonly string[], p: number): string[] => xs.filter(() => chance(p));
  /** Duplicate names inside one listing, and a shuffled order: a listing is a list, the delta is a set difference. */
  const noisy = (xs: readonly string[]): string[] => {
    const out = [...xs];
    if (out.length > 0 && chance(0.15)) out.push(pick(out));
    if (chance(0.3)) out.reverse();
    return out;
  };
  const instant = (s: number): string => (chance(0.05) ? pick(BAD_INSTANTS) : T(s));

  /** The evidence rows of a pass: most of the bash rows, and (when the pass has an agent) its start and, per record path, its tool event
   *  and sometimes the parent's own event at the same path. */
  const evidenceOf = (records: readonly Tree[], agent: boolean, hit: (t: Tree) => boolean, parentVeto: (t: Tree) => boolean, keep: number) => {
    const paths = new Set(records.filter(hit).map((t) => t.record.canonicalPath));
    const vetoed = new Set(records.filter(parentVeto).map((t) => t.record.canonicalPath));
    const acceptedEvidence = w.evidence.filter((e) => {
      if (e.kind === 'bash') return chance(keep);
      if (!agent) return false;
      if (e.kind === 'start') return true;
      return e.kind === 'inside' ? paths.has(e.event.cwd ?? null) : vetoed.has(e.event.cwd ?? null);
    });
    return {
      acceptedEvidence: acceptedEvidence.map(({ journalId, event }) => ({ journalId, event })),
      activities: [...w.bashActivities.filter(() => chance(keep)), ...(agent ? w.agentActivities : [])],
    };
  };

  const windowOf = (records: readonly string[], dense: boolean): DelegationListingWindow => {
    const [sessionId, parentIncarnation] = dense && chance(0.5) ? PARENTS[0]! : pick(PARENTS);
    const startS = int(0, 300) * 10;
    const open = chance(dense ? 0.03 : 0.08);
    const startedAt = instant(startS);
    const endedAt = open ? null : instant(startS + int(0, 40) * 10);
    const r = rnd();
    const repository = dense ? (r < 0.75 ? REPO : r < 0.85 ? null : OTHER_REPO) : (r < 0.6 ? REPO : r < 0.75 ? null : OTHER_REPO);
    const listed = int(0, 9);
    const listedRepository: string | null | undefined = listed < 5 ? undefined : listed < 7 ? REPO : listed < 8 ? null : OTHER_REPO;
    const common = { sessionId, parentIncarnation, repository, startedAt, endedAt, ...(listedRepository === undefined ? {} : { listedRepository }) };
    if (chance(0.1)) return { ...common, toolUseId: '', lost: true, before: [], after: null };
    const toolUseId = pick(TOOLS);
    const tgt = chance(0.85) ? pick(records) : pick(OUTSIDERS);
    const before = subset(ALL_NAMES.filter((x) => x !== tgt), 0.35);
    const outsiders = ALL_NAMES.filter((x) => x !== tgt && !before.includes(x));
    const dice = rnd();
    let after: string[] | null;
    if (dice < 0.30) after = [...before, tgt];                                                        // exactly the one record added
    else if (dice < 0.40) after = [...before, tgt, ...(outsiders.length > 0 ? [pick(outsiders)] : [])];      // the record and one more name
    else if (dice < 0.50) after = [...before.slice(1), tgt];                                          // the record, and one name removed
    else if (dice < 0.56) after = [...before];                                                        // nothing changed
    else if (dice < 0.62) after = outsiders.length > 0 ? [...before, pick(outsiders)] : [...before];  // another name only
    else if (dice < 0.68) after = [...before, tgt];                                                   // exactly the one record again
    else if (dice < 0.76) { const had = [...before, tgt]; return { ...common, toolUseId, before: noisy(had), after: noisy(had) }; }     // already there
    else if (dice < 0.84) after = subset(ALL_NAMES, 0.5);
    else if (dice < 0.90) after = null;                                                               // no after-listing measured
    else after = [...before, tgt, ...(outsiders.length > 1 ? [outsiders[0]!, outsiders[1]!] : [])];  // the record and two more
    return { ...common, toolUseId, before: noisy(before), after: after === null ? null : noisy(after) };
  };

  /** Windows built around one tree, in the shapes rung 4's hard cases need: each is a few windows in a narrow band of time. */
  const sceneOf = (t: Tree): DelegationListingWindow[] => {
    const r = t.record.adminRecord;
    const project = t.record.project;
    const s0 = int(0, 250) * 10;
    const base = subset(ALL_NAMES.filter((x) => x !== r), 0.3);
    const [sess, inc] = pick(PARENTS);
    const [sess2, inc2] = pick(PARENTS.filter(([x, y]) => x !== sess || y !== inc));
    const [tool, tool2] = [pick(TOOLS), pick(TOOLS)];
    const mk = (sessionId: string, parentIncarnation: string, toolUseId: string, repository: string | null, start: number, end: number | null, add: readonly string[], drop = 0): DelegationListingWindow =>
      ({ sessionId, parentIncarnation, toolUseId, repository, startedAt: T(start), endedAt: end === null ? null : T(end), before: noisy(base), after: noisy([...base.slice(drop), ...add]) });
    const kind = int(0, 5);
    if (kind === 0) {           // a candidate, and a closed window of its own session that overlaps it and adds the record with another name
      return [mk(sess, inc, tool, project, s0, s0 + int(2, 6) * 10, [r]), mk(sess, inc, tool2, chance(0.7) ? project : null, s0 + int(0, 1) * 10, s0 + int(1, 8) * 10, [r, 'n2'])];
    }
    if (kind === 1) {           // two candidates; one has an instant the model refuses, a window of another session overlaps the other; in either order
      const c1 = mk(sess, inc, tool, project, s0, s0 + 40, [r]);
      const c2 = mk(sess2, inc2, tool2, project, s0 + 200, s0 + 240, [r]);
      const bad = chance(0.5) ? { ...c2, endedAt: pick(BAD_INSTANTS) } : { ...c2, startedAt: pick(BAD_INSTANTS) };
      const o = mk(sess2, inc2, 'toolu_t3', chance(0.7) ? project : null, s0 + 10, s0 + 20, ['n3']);
      const ws = [c1, bad, o];
      return chance(0.5) ? ws : ws.reverse();
    }
    if (kind === 2) {           // a creator whose repository the caller lost (a restart), adding the record with another name; the tree is born around it
      t.firstSighting = { after: T(s0 - 10), at: T(s0 + 100) };
      return [mk(sess, inc, tool, null, s0, s0 + 30, [r, 'n1'])];
    }
    if (kind === 3) {           // a candidate, and a window with no repository over it (a veto the caller cannot name)
      return [mk(sess, inc, tool, project, s0, s0 + 40, [r]), mk(chance(0.5) ? sess : sess2, chance(0.5) ? inc : inc2, tool2, null, s0 + 20, s0 + 60, ['n4'])];
    }
    if (kind === 4) {           // a candidate, harmless windows after it, and a window of another session that overlaps it at the END of the list
      const quiet = [0, 1, 2].map((k) => mk(sess, inc, pick(TOOLS), project, s0 + 400 + 50 * k, s0 + 410 + 50 * k, ['n1']));
      return [mk(sess, inc, tool, project, s0, s0 + 40, [r]), ...quiet, mk(sess2, inc2, tool2, project, s0 + 30, s0 + 80, ['n2'])];
    }
    // a lone candidate, or the record removed by the window that added it, or added with two more
    return [chance(0.5) ? mk(sess, inc, tool, project, s0, s0 + int(0, 5) * 10, [r]) : mk(sess, inc, tool, project, s0, s0 + 30, [r], 1)];
  };

  const droppedOf = (records: readonly Tree[]): DelegationDroppedEvidence => {
    const d = rnd();
    const withMarks = (m: Partial<typeof DELEGATION_NO_MARKS>): DelegationDroppedEvidence => indexDelegationDropped([], { ...DELEGATION_NO_MARKS, ...m });
    if (d < 0.30) return indexDelegationDropped([]);
    if (d < 0.38) return marksFor([]);
    if (d < 0.46) return withMarks({ lossy: true });
    if (d < 0.54) return withMarks({ projects: new Set([REPO]) });
    if (d < 0.58) return withMarks({ projects: new Set([OTHER_REPO]) });
    if (d < 0.64) return withMarks({ prefixes: new Set([`/fixture/${REPO}/.claude/worktrees`]) });
    if (d < 0.72) return marksFor(records.filter(() => chance(0.5)).map((t) => t.record.canonicalPath!));
    if (d < 0.78) { const ids = emptyDelegationHashSet(); delegationHashSetAdd(ids, AGENT, 100); return withMarks({ ids }); }
    if (d < 0.84) return indexDelegationDropped([{ parentId: OTHER, parentIncarnation: INC, agentId: AGENT, launchAgentId: null, runId: null, cwd: null, startStop: false }]);
    if (d < 0.90) return indexDelegationDropped([{ parentId: PARENT, parentIncarnation: INC, agentId: null, launchAgentId: null, runId: null, cwd: pick(records).record.canonicalPath, startStop: false }]);
    return DELEGATION_DROPPED_UNMEASURED;
  };

  const passes: Pass[] = [];
  // Hand-built: a creator that is only a held, closed window with no repository, adding the record together with another name, beside a
  // rung-3 hit; and its twin, whose window does not add the record (a link at rung 3).
  for (const twin of [false, true]) {
    const name = RECORD_NAMES[0]!;
    const tree: Tree = { record: rawRecord(name), firstSighting: { after: T(900), at: T(1100) }, evidenceHorizon: null };
    const ev = evidenceOf([tree], true, () => true, () => false, 1);
    passes.push({
      trees: [tree], activities: ev.activities, acceptedEvidence: ev.acceptedEvidence, droppedEvidence: indexDelegationDropped([]),
      windows: [
        { sessionId: OTHER, parentIncarnation: INC, toolUseId: 'toolu_t1', repository: REPO, startedAt: T(5000), endedAt: T(5010), before: ['main-wt'], after: ['main-wt'] },
        { sessionId: PARENT, parentIncarnation: INC, toolUseId: 'toolu_t0', repository: null, startedAt: T(1000), endedAt: T(1010), before: ['main-wt'],
          after: twin ? ['main-wt'] : ['main-wt', name, 'n1'] },
      ],
    });
  }

  for (let i = 0; i < RANDOM_PASSES; i++) {
    const names = RECORD_NAMES.map((n) => [rnd(), n] as const).sort((a, b) => a[0] - b[0]).map(([, n]) => n).slice(0, int(3, 6));
    const trees: Tree[] = names.map((name) => {
      const fs = rnd();
      const firstSighting = fs < 0.55 ? { after: T(1_000_000), at: T(1_000_060) }
        : fs < 0.9 ? (() => { const a = int(0, 300) * 10; return { after: T(a), at: T(a + int(3, 60) * 10) }; })()
        : { after: null, at: T(int(0, 350) * 10) };
      return { record: rawRecord(name, chance(0.85) ? REPO : OTHER_REPO), firstSighting, evidenceHorizon: null };
    });
    // A dense pass is the quiet one: few lost windows, rarely a horizon, windows of the same few sessions, and scenes built around its trees.
    const dense = chance(0.6);
    const horizon = chance(dense ? 0.12 : 0.3) ? (chance(0.05) ? pick(BAD_INSTANTS) : T(int(-30, 250) * 10)) : null;
    for (const t of trees) t.evidenceHorizon = horizon;
    const windows: DelegationListingWindow[] = [];
    for (let k = dense ? int(0, 4) : int(1, 8); k > 0; k--) windows.push(windowOf(names, dense));
    if (dense) for (let k = int(1, 3); k > 0; k--) windows.push(...sceneOf(pick(trees)));
    // The lane's own lost windows, on every repository: the retention floor (ending near the fixture clock, or days before it) and the
    // not-ready window (up to a ready instant, or open-ended).
    if (chance(dense ? 0.2 : 0.7)) {
      const floorNear = chance(0.5);
      const now = floorNear ? Date.UTC(2026, 9, 14) + DELEGATION_INTERVAL_RETENTION_HOURS * 3600_000 + int(-3600, 7200) * 1000 : Date.UTC(2026, 9, 1);
      windows.push(...delegationLostWindowsOf([], [], now));
    }
    if (chance(dense ? 0.2 : 0.7)) windows.push(delegationNotReadyWindowOf(chance(0.1) ? null : Date.UTC(2026, 9, 14) + int(-200, 300) * 10_000));
    const hit = new Map(trees.map((t) => [t.record.adminRecord, chance(0.7)]));
    const veto = new Map(trees.map((t) => [t.record.adminRecord, chance(0.08)]));
    const ev = evidenceOf(trees, chance(0.7), (t) => hit.get(t.record.adminRecord)!, (t) => veto.get(t.record.adminRecord)!, 0.85);
    passes.push({ trees, windows, activities: ev.activities, acceptedEvidence: ev.acceptedEvidence, droppedEvidence: dense && chance(0.5) ? indexDelegationDropped([]) : droppedOf(trees) });
  }
  return passes;
}

describe('D-5604 R2: the answers of the four public functions are the same before and after the cost fix', () => {
  it('a seeded stream of lane passes hashes to the constant computed at main, and reaches every shape named', () => {
    const passes = generate();
    const hist = {
      passes: passes.length, inputs: 0,
      linkedRung4: 0, overlapping: 0, ambiguous: 0, ambiguousFromSameSessionAddingMore: 0, unreadable: 0,
      lostCreatorBesideRung3: 0, lostCreatorOnlyFromNullWindow: 0, twinLinksAtRung3: 0,
      markLossy: 0, markProject: 0, markPrefix: 0, markPath: 0, markId: 0, unknownWindowForced: 0, lostEvidenceForced: 0,
      refusedRemoved: 0, refusedAddedTwo: 0, linkedRung3: 0, conflicting: 0, unmeasuredHorizon: 0,
    };
    const answers: unknown[] = [];
    for (const pass of passes) {
      const lane = runLane(pass, true);
      lane.forEach((a, i) => {
        const tree = pass.trees[i]!;
        const { verdict } = a;
        const project = tree.record.project;
        const name = tree.record.adminRecord;
        hist.inputs += 1;
        // Plain JSON throughout (`canonicalDelegationJson` refuses anything else): the verdict, then the three reruns.
        answers.push({ verdict, mark: a.mark, unknown: a.unknown, lost: a.lost });

        if (verdict.kind === 'linked' && verdict.rung === 4) hist.linkedRung4 += 1;
        if (verdict.kind === 'linked' && verdict.rung === 3) hist.linkedRung3 += 1;
        if (verdict.kind === 'unresolved' && verdict.reason === 'overlapping-listing-window') hist.overlapping += 1;
        if (verdict.kind === 'unresolved' && verdict.reason === 'ambiguous-listing-windows') hist.ambiguous += 1;
        if (verdict.kind === 'unmeasured' && verdict.reason === 'listing-window-instant-unreadable') hist.unreadable += 1;
        if (verdict.kind === 'unmeasured' && verdict.reason === 'evidence-horizon') hist.unmeasuredHorizon += 1;
        if (verdict.kind === 'conflicting') hist.conflicting += 1;
        const kind = forcedKindOf(a);
        if (kind === 'lossy') hist.markLossy += 1;
        if (kind === 'project') hist.markProject += 1;
        if (kind === 'prefix') hist.markPrefix += 1;
        if (kind === 'path') hist.markPath += 1;
        if (kind === 'id') hist.markId += 1;
        if (a.unknown) hist.unknownWindowForced += 1;
        if (a.lost === true) hist.lostEvidenceForced += 1;

        // What the test knows of its own data. The candidates rung 4 would take, and the held and lost windows.
        const held = pass.windows.filter((x) => x.lost !== true);
        const lostHere = pass.windows.filter((x) => x.lost === true && mayBeOnHere(x, project));
        const candidates = held.filter((x) => x.repository !== null && x.repository === project && soleOf(x, name));

        // A candidate REFUSED for what its window did beyond adding the record: the window would have been the SOLE candidate (same
        // project, the input has no other) but for one removal, or but for a second added name.
        if (candidates.length === 0 && held.some((x) => { const d = deltaOf(x); return x.repository === project && d !== null && d.added.length === 1 && d.added[0] === name && d.removed.length > 0; })) hist.refusedRemoved += 1;
        if (candidates.length === 0 && held.some((x) => { const d = deltaOf(x); return x.repository === project && d !== null && d.removed.length === 0 && d.added.length === 2 && d.added.includes(name); })) hist.refusedAddedTwo += 1;

        // `ambiguous-listing-windows` from ONE candidate and a closed window of the SAME session that overlaps it and adds the record
        // together with another name (:1102): nothing else made it ambiguous.
        if (verdict.kind === 'unresolved' && verdict.reason === 'ambiguous-listing-windows' && candidates.length === 1) {
          const mine = candidates[0]!;
          const span = (x: DelegationListingWindow): [number, number] | null => {
            try { return [parseDelegationInstant(x.startedAt), x.endedAt === null ? Infinity : parseDelegationInstant(x.endedAt)]; } catch { return null; }
          };
          const m = span(mine);
          if (m !== null && held.some((x) => {
            const s = span(x);
            const d = deltaOf(x);
            return x !== mine && x.endedAt !== null && mayBeOnHere(x, project) && x.sessionId === mine.sessionId && x.parentIncarnation === mine.parentIncarnation
              && s !== null && m[0] <= s[1] && s[0] <= m[1] && d !== null && d.added.includes(name) && d.added.length >= 2;
          })) hist.ambiguousFromSameSessionAddingMore += 1;
        }

        // A LOST CREATOR (X1) beside a rung-3 link: no candidate, a verdict `unmeasured('evidence-horizon')` that lost evidence alone holds
        // (`delegationLostEvidenceForced`), and the same input with no windows and no horizon IS a rung-3 link. A rung-3 link is also
        // what `combine` needs to turn a lost creator into a verdict (a lost creator alone is dropped).
        const rung3Alone = correlateDelegation({ ...inputFor(pass, tree), listingWindows: [], evidenceHorizon: null });
        if (candidates.length === 0 && verdict.kind === 'unmeasured' && verdict.reason === 'evidence-horizon' && a.lost === true
            && rung3Alone.kind === 'linked' && rung3Alone.rung === 3) {
          hist.lostCreatorBesideRung3 += 1;
          // ...and the ONLY lost-creator evidence is a held, closed window with no repository that adds the record with another name:
          // no horizon, no lost window on the project, no open-ended held window that may be on it.
          const nullWindows = held.filter((x) => x.repository === null && x.endedAt !== null && deltaOf(x)?.added.includes(name) === true);
          if (tree.evidenceHorizon === null && lostHere.length === 0 && !held.some((x) => mayBeOnHere(x, project) && x.endedAt === null)
              && nullWindows.some((x) => deltaOf(x)!.added.length >= 2)) {
            hist.lostCreatorOnlyFromNullWindow += 1;
            // Its twin: the same input whose null-repository windows do NOT add the record links at rung 3.
            const twin = correlateDelegation({ ...inputFor(pass, tree), listingWindows: pass.windows.map((x) => (nullWindows.includes(x) ? { ...x, after: [...x.before] } : x)) });
            if (twin.kind === 'linked' && twin.rung === 3) hist.twinLinksAtRung3 += 1;
          }
        }
      });
    }

    // Every shape the stream is meant to reach is reached (each count above zero), so a verdict drift shows in the histogram too.
    for (const [name, count] of Object.entries(hist)) expect(count, `histogram item ${name} is reached`).toBeGreaterThan(0);
    expect(hist.inputs, 'inputs generated').toBeGreaterThanOrEqual(2000);
    expect(hist, 'histogram').toEqual(EXPECTED_HISTOGRAM);

    // The digest: sha256 of the canonical JSON of every answer, in generation order.
    expect(delegationSha256Hex(canonicalDelegationJson(answers))).toBe(EXPECTED_DIGEST);
  });
});

// Computed once at main, before the cost fix (seed 0x5eed627).
// (The same digest and histogram come out at the delta-memo commit that followed.)
const EXPECTED_DIGEST = 'f3048fef6dd780fb6ca4293da685e698e4d47c22ef50cd33153f31934c88c051';
const EXPECTED_HISTOGRAM = {
  passes: 562, inputs: 2537,
  linkedRung4: 44, overlapping: 99, ambiguous: 35, ambiguousFromSameSessionAddingMore: 16, unreadable: 122,
  lostCreatorBesideRung3: 171, lostCreatorOnlyFromNullWindow: 8, twinLinksAtRung3: 8,
  markLossy: 67, markProject: 61, markPrefix: 43, markPath: 34, markId: 28, unknownWindowForced: 40, lostEvidenceForced: 190,
  refusedRemoved: 86, refusedAddedTwo: 88, linkedRung3: 601, conflicting: 17, unmeasuredHorizon: 590,
};
