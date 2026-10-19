// Delegation broker, rung 4's cost (D-5604): each listing window's delta is a property of the window, so a reconcile pass that correlates
// every census tree against the SAME window objects must read each window's listings a constant number of times, however many trees
// there are. Two rows hold that:
//
//   R1, the cost pin. The windows' `before` and `after` arrays are Proxies that count WHOLE-LISTING reads (the iterator and every
//      Array.prototype method: any string key that is neither an index nor `length`). A pass runs the ladder for N trees the way the
//      reconcile lane does (`correlateDelegation`, then `delegationMarkForced` / `delegationUnknownWindowForced`, then
//      `delegationLostEvidenceForced`), and the reads of one array must stay within a bound that does not grow with N. No clock.
//   R2, the equivalence digest. A seeded, deterministic stream of rung-4-shaped inputs is answered by the four public functions, and a
//      sha256 of every answer is held to a constant computed before the cost fix, together with a histogram of the verdict shapes the
//      stream reaches. A change that makes rung 4 cheaper must not move a single answer.
//
// Fixtures only: names are `lane-a-demo`, `lane-b-demo`, `project-a`, `/fixture/...`. No file is read or written.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
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
  type DelegationDroppedEvidence,
  type DelegationListingWindow,
} from '../src/coord/delegation-correlation.js';
import {
  delegationSha256Hex,
  formatDelegationInstant,
  type DelegationCensusRecord,
  type DelegationJournalRecordV1,
} from '../src/coord/delegation-model.js';

// ── fixtures (the style of delegation-correlation.test.ts, copied: a test file imports no other test file) ──────────────

const PARENT = 'lane-a-demo';
const OTHER = 'lane-b-demo';
const THIRD = 'lane-c-demo';
const INC = 'g1';
const AGENT = 'abc123def456';
const REPO = 'project-a';
const OTHER_REPO = 'project-b';
const CLAUDE = '11111111-2222-3333-4444-555555555555';
const WT = (name: string): string => `/fixture/${REPO}/.claude/worktrees/${name}`;
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

const rawRecord = (name: string): DelegationCensusRecord => ({
  project: REPO, adminRecord: name, canonicalPath: WT(name), headBranch: 'raw-branch', headSha: null,
  claudeBase: 'main', locked: false, baseAgreesFirstLog: true, state: 'present', diagnostic: null,
});
const input = (over: Partial<DelegationCorrelationInput> = {}): DelegationCorrelationInput => ({
  record: rawRecord('wt-raw'), runChildAgreement: null, activities: [], acceptedEvidence: [], pointMetas: [], listingWindows: [],
  birthPassesRemaining: 0, hasRegistryRow: false, hasChildMarker: false, evidenceHorizon: null, droppedEvidence: indexDelegationDropped([]),
  firstSighting: { after: T(1_000_000), at: T(1_000_060) }, ...over,
});
const win = (over: Partial<DelegationListingWindow> = {}): DelegationListingWindow => ({
  sessionId: PARENT, parentIncarnation: INC, toolUseId: 'toolu_b1', repository: REPO, startedAt: T(10), endedAt: T(12),
  before: ['main-wt'], after: ['main-wt', 'wt-raw'], ...over,
});

/** Marks that are not empty but name nothing any tree here asks about: a measured index whose marks make a forced-kind rerun run. */
const unrelatedMarks = (): DelegationDroppedEvidence => {
  const ids = emptyDelegationHashSet();
  delegationHashSetAdd(ids, 'unrelated-id', 100);
  return indexDelegationDropped([], { ...DELEGATION_NO_MARKS, ids });
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R1: the cost pin
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** The bound under test: one whole-listing read per array per pass (a window's delta is computed once, however many trees ask). */
const MAX_READS_PER_ARRAY = 1;

interface Counter { label: string; reads: number }

/** An array that counts every WHOLE-LISTING read: the iterator, and any string key that is not an index and not `length`
 *  (`includes`, `indexOf`, `filter`, `some`, `every`, `forEach`, `map`, `find`, `slice`, `entries`, `values`, ...). */
function counted(items: readonly string[], counter: Counter): readonly string[] {
  return new Proxy([...items], {
    get(target, key, receiver) {
      if (key === Symbol.iterator || (typeof key === 'string' && key !== 'length' && !/^\d+$/.test(key))) counter.reads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
}

type Shape = 'steady' | 'restart';

/**
 * One reconcile pass over `trees` census trees and ONE set of window objects, the way `watch.ts` runs it: the ladder per tree, then the
 * forced-kind reruns of every tree, then the lost-evidence reruns of every unmeasured one. The windows (all closed, on a fixed clock):
 *   0-3  session lane-a-demo, on project-a, each adds ONE record `wt-raw-<j>` (a candidate for tree j only), 1000 s apart;
 *   4-5  session lane-b-demo, on project-a, each adds TWO records (never a candidate);
 *   6    session lane-b-demo, on project-a, adds nothing;
 *   7    session lane-c-demo, adds nothing, with a repository the caller cannot name (null).
 * `steady` holds only window 7 with a null repository (one held window the caller lost the project of); `restart` has every window null.
 * Trees 0 and 1 reach rung 4 with no horizon (a link, in `steady`); trees 2 and 3 carry an evidence horizon after every window
 * (`unmeasured('evidence-horizon')`, so the mark and lost-evidence reruns really run); trees 4 and up have no candidate.
 */
function pass(trees: number, shape: Shape) {
  const counters: Counter[] = [];
  const listing = (label: string, items: readonly string[]): readonly string[] => {
    const counter = { label, reads: 0 };
    counters.push(counter);
    return counted(items, counter);
  };
  const common = ['main-wt', 'old-wt'];
  const windows: DelegationListingWindow[] = [];
  const add = (w: Omit<DelegationListingWindow, 'before' | 'after'> & { before: readonly string[]; after: readonly string[] }, label: string): void => {
    windows.push({ ...w, repository: shape === 'restart' ? null : w.repository, before: listing(`${label}.before`, w.before), after: listing(`${label}.after`, w.after) });
  };
  for (let j = 0; j < 4; j++) {
    add({ sessionId: PARENT, parentIncarnation: INC, toolUseId: `toolu_c${j}`, repository: REPO, startedAt: T(1000 * j + 100), endedAt: T(1000 * j + 110),
      before: common, after: [...common, `wt-raw-${j}`] }, `w${j}`);
  }
  for (let j = 4; j < 6; j++) {
    add({ sessionId: OTHER, parentIncarnation: INC, toolUseId: `toolu_c${j}`, repository: REPO, startedAt: T(1000 * j + 100), endedAt: T(1000 * j + 110),
      before: common, after: [...common, `wt-two-${j}-a`, `wt-two-${j}-b`] }, `w${j}`);
  }
  add({ sessionId: OTHER, parentIncarnation: INC, toolUseId: 'toolu_c6', repository: REPO, startedAt: T(6100), endedAt: T(6110), before: common, after: common }, 'w6');
  add({ sessionId: THIRD, parentIncarnation: INC, toolUseId: 'toolu_c7', repository: null, startedAt: T(9000), endedAt: T(9010), before: common, after: common }, 'w7');

  const events: DelegationEventEnvelopeV1[] = [];
  for (let j = 0; j < 4; j++) {
    events.push(bashPre(10 + 2 * j, `toolu_c${j}`, common), bashPost(11 + 2 * j, `toolu_c${j}`, [...common, `wt-raw-${j}`]));
  }
  const w = world(events);
  const droppedEvidence = unrelatedMarks();

  const inputs: DelegationCorrelationInput[] = [];
  for (let i = 0; i < trees; i++) {
    const name = `wt-raw-${i}`;
    inputs.push(input({
      record: rawRecord(name), activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: windows, droppedEvidence,
      evidenceHorizon: i % 4 >= 2 ? T(5000) : null, firstSighting: { after: T(0), at: T(5000) },
    }));
  }
  // The reconcile lane (watch.ts, "ONE expression" and the two loops after it): the ladder per tree, then each rerun per tree.
  const pairs = inputs.map((inp) => ({ inp, verdict: correlateDelegation(inp) }));
  const unknownWindows = windows.some((x) => x.repository === null && x.lost !== true);
  const forced: (string | null)[] = [];
  if (droppedEvidence.measured || unknownWindows) {
    for (const { inp, verdict } of pairs) {
      forced.push((droppedEvidence.measured ? delegationMarkForced(inp, verdict) : null) ?? (unknownWindows && delegationUnknownWindowForced(inp, verdict) ? 'window' : null));
    }
  }
  let lost = 0;
  for (const { inp, verdict } of pairs) {
    if (verdict.kind !== 'unmeasured') continue;
    if (delegationLostEvidenceForced(inp, verdict)) lost += 1;
  }
  const reads = counters.map((c) => c.reads);
  return { verdicts: pairs.map((p) => p.verdict), forced, lost, reads, maxReads: Math.max(...reads) };
}

describe('R1: rung 4 reads each listing window a constant number of times per pass, however many trees there are', () => {
  for (const shape of ['steady', 'restart'] as const) {
    describe(`${shape} (${shape === 'steady' ? 'windows on project-a plus one held window with no repository' : 'every window\'s repository is lost, as after a restart'})`, () => {
      it(`the scenario reaches rung 4's candidate filter, the overlap loop and the reruns`, () => {
        const { verdicts, forced } = pass(20, shape);
        expect(verdicts.length).toBe(20);
        expect(forced.length).toBe(20);
        // every tree is answered by the ladder, and the shapes a rung-4 pass produces appear
        if (shape === 'steady') {
          expect(verdicts.slice(0, 2).map((v) => v.kind)).toEqual(['linked', 'linked']);
          expect(verdicts.slice(2, 4).map((v) => (v.kind === 'unmeasured' ? v.reason : v.kind))).toEqual(['evidence-horizon', 'evidence-horizon']);
        }
        expect(verdicts.slice(4).every((v) => v.kind === 'unresolved')).toBe(true);
      });
      it(`each array's whole-listing reads are at most ${MAX_READS_PER_ARRAY} per pass, and the same at 20 and at 40 trees`, () => {
        const small = pass(20, shape);
        const large = pass(40, shape);
        const seen = `reads per array, 20 trees ${JSON.stringify(small.reads)}, 40 trees ${JSON.stringify(large.reads)}`;
        // The bound: one read per array per pass, independent of the number of trees (red while every tree rebuilds every window's delta).
        expect(Math.max(small.maxReads, large.maxReads), seen).toBeLessThanOrEqual(MAX_READS_PER_ARRAY);
        // And the growth itself: doubling the trees must not move the per-array maximum.
        expect(large.maxReads, `20 trees max ${small.maxReads}, 40 trees max ${large.maxReads}; ${seen}`).toBe(small.maxReads);
      });
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R2: the equivalence digest
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
const INPUTS = 2400;
const OWN = 'wt-raw';
const POOL = [OWN, 'n1', 'n2', 'n3', 'n4', 'n5'];
const PARENTS: readonly (readonly [string, string])[] = [[PARENT, INC], [OTHER, INC], [THIRD, INC], [PARENT, 'g2']];
const TOOLS = ['toolu_t0', 'toolu_t1', 'toolu_t2', 'toolu_t3'];

interface Generated {
  input: DelegationCorrelationInput;
  rung3: boolean;
}

function generate(): Generated[] {
  // One world holds a bash-worktree activity and a Pre and a Post for every (parent, tool) pair, and a subagent whose own cwd is the
  // tree's path (a rung-3 hit). A generated input takes a random subset of its rows. One toolUseId is reused by every session.
  const events: DelegationEventEnvelopeV1[] = [];
  let n = 1;
  for (const [sessionId, parentIncarnation] of PARENTS) {
    for (const tool of TOOLS) {
      events.push(bashPre(n, tool, ['main-wt'], { sessionId, parentIncarnation }));
      events.push(bashPost(n + 1, tool, ['main-wt', OWN], { sessionId, parentIncarnation }));
      n += 2;
    }
  }
  const agentEvents = [subagentStart(n, AGENT), toolIn(n + 1, AGENT, WT(OWN))];
  const full = world([...events, ...agentEvents]);
  const isAgentRow = (a: { sourceKind: string }): boolean => a.sourceKind === 'agent';
  const isAgentEvent = (e: DelegationEventEnvelopeV1): boolean => e.agentId === AGENT;
  const bashActivities = full.activities.filter((a) => !isAgentRow(a));
  const agentActivities = full.activities.filter(isAgentRow);
  const bashEvidence = full.acceptedEvidence.filter((e) => !isAgentEvent(e.event));
  const agentEvidence = full.acceptedEvidence.filter((e) => isAgentEvent(e.event));

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

  const windowOf = (): DelegationListingWindow => {
    const [sessionId, parentIncarnation] = pick(PARENTS);
    const startS = int(0, 3000);
    const open = chance(0.1);
    const startedAt = T(startS);
    const endedAt = open ? null : T(startS + int(0, 400));
    const repository = chance(0.7) ? REPO : chance(0.4) ? null : OTHER_REPO;
    const listed = int(0, 9);
    const listedRepository: string | null | undefined = listed < 5 ? undefined : listed < 7 ? REPO : listed < 8 ? null : OTHER_REPO;
    const common = { sessionId, parentIncarnation, repository, startedAt, endedAt, ...(listedRepository === undefined ? {} : { listedRepository }) };
    if (chance(0.1)) return { ...common, toolUseId: '', lost: true, endedAt: chance(0.5) ? endedAt : T(startS + int(0, 900)), before: [], after: null };
    const toolUseId = pick(TOOLS);
    const before = subset(POOL.filter((x) => x !== OWN), 0.5);
    const outsiders = POOL.filter((x) => x !== OWN && !before.includes(x));
    const dice = rnd();
    let after: string[] | null;
    if (dice < 0.38) after = [...before, OWN];                                                   // exactly the one record added
    else if (dice < 0.5) after = [...before, OWN, ...(outsiders.length > 0 ? [pick(outsiders)] : [])];     // the record and one more
    else if (dice < 0.6) after = [...before.slice(1), OWN];                                      // the record, and one name removed
    else if (dice < 0.7) after = [...before];                                                    // nothing changed
    else if (dice < 0.78) after = outsiders.length > 0 ? [...before, pick(outsiders)] : [...before];     // another record only
    else if (dice < 0.84) after = [...before, OWN];                                              // exactly the one record again
    else if (dice < 0.9) { const had = [...before, OWN]; return { ...common, toolUseId, before: noisy(had), after: noisy(had) }; }   // the record was already there
    else if (dice < 0.95) after = subset(POOL, 0.5);
    else after = null;                                                                           // no after-listing measured
    return { ...common, toolUseId, before: noisy(before), after: after === null ? null : noisy(after) };
  };

  const out: Generated[] = [];
  for (let i = 0; i < INPUTS; i++) {
    const listingWindows: DelegationListingWindow[] = [];
    for (let k = int(0, 6); k > 0; k--) listingWindows.push(windowOf());
    const rung3 = chance(0.25);
    // Which of the world's rows this input holds: most of them, so that candidates sometimes have no activity row or no evidence.
    const activities = [...bashActivities.filter(() => chance(0.85)), ...(rung3 ? agentActivities : [])];
    const acceptedEvidence = [...bashEvidence.filter(() => chance(0.85)), ...(rung3 ? agentEvidence : [])];
    const dropDice = rnd();
    const droppedEvidence: DelegationDroppedEvidence = dropDice < 0.5 ? indexDelegationDropped([])
      : dropDice < 0.65 ? unrelatedMarks()
      : dropDice < 0.75 ? indexDelegationDropped([], { ...DELEGATION_NO_MARKS, projects: new Set([REPO]) })
      : dropDice < 0.85 ? indexDelegationDropped([], { ...DELEGATION_NO_MARKS, projects: new Set([OTHER_REPO]) })
      : DELEGATION_DROPPED_UNMEASURED;
    const fs = rnd();
    const firstSighting = fs < 0.6 ? { after: T(1_000_000), at: T(1_000_060) }
      : fs < 0.9 ? (() => { const a = int(0, 3000); return { after: T(a), at: T(a + int(30, 600)) }; })()
      : { after: null, at: T(int(0, 3500)) };
    out.push({
      rung3,
      input: input({
        record: rawRecord(OWN), activities, acceptedEvidence, listingWindows, droppedEvidence, firstSighting,
        evidenceHorizon: chance(0.3) ? T(int(-300, 2500)) : null,
      }),
    });
  }
  return out;
}

/** The window's delta as the test computes it from its own data, independent of the module. */
function deltaOf(w: DelegationListingWindow): { added: string[]; removed: string[] } | null {
  if (w.after === null) return null;
  const before = new Set(w.before);
  const after = new Set(w.after);
  return { added: [...after].filter((x) => !before.has(x)), removed: [...before].filter((x) => !after.has(x)) };
}

describe('R2: the answers of the four public functions are the same before and after the cost fix', () => {
  it('a seeded stream of rung-4 inputs hashes to the constant computed at main, and reaches every shape named', () => {
    const generated = generate();
    expect(generated.length).toBe(INPUTS);
    const hist = {
      linkedRung4: 0, overlapping: 0, ambiguous: 0, lostCreator: 0, unknownWindowForced: 0, markForced: 0, lostEvidenceForced: 0,
      refusedRemoved: 0, refusedAddedTwo: 0, conflicting: 0, unmeasuredHorizon: 0, withRung3Link: 0,
    };
    const answers: unknown[] = [];
    for (const { input: inp, rung3 } of generated) {
      const verdict = correlateDelegation(inp);
      const unknown = delegationUnknownWindowForced(inp, verdict);
      const mark = delegationMarkForced(inp, verdict);
      const lostEvidence = delegationLostEvidenceForced(inp, verdict);
      answers.push({ verdict, unknown, mark, lostEvidence });

      if (verdict.kind === 'linked' && verdict.rung === 4) hist.linkedRung4 += 1;
      if (verdict.kind === 'unresolved' && verdict.reason === 'overlapping-listing-window') hist.overlapping += 1;
      if (verdict.kind === 'unresolved' && verdict.reason === 'ambiguous-listing-windows') hist.ambiguous += 1;
      if (verdict.kind === 'conflicting') hist.conflicting += 1;
      if (verdict.kind === 'unmeasured' && verdict.reason === 'evidence-horizon') hist.unmeasuredHorizon += 1;
      if (verdict.kind === 'linked' && verdict.rung === 3) hist.withRung3Link += 1;
      if (unknown) hist.unknownWindowForced += 1;
      if (mark !== null) hist.markForced += 1;
      if (lostEvidence) hist.lostEvidenceForced += 1;

      // A LOST CREATOR (X1) answered `unmeasured('evidence-horizon')` beside a rung-3 link. Detected from public answers alone: the input
      // carries a rung-3 hit; rung 4 had NO candidate (the test recomputes that from its windows: a held window on the record's project
      // whose delta is exactly the one record); the verdict is `unmeasured('evidence-horizon')`; and the same input with no listing
      // windows and no horizon IS a link (so rung 3 alone is not what held it back). What remains is rung 4's lost-creator answer.
      const held = inp.listingWindows.filter((w) => w.lost !== true);
      const candidate = held.some((w) => {
        const d = deltaOf(w);
        return w.repository === REPO && d !== null && d.added.length === 1 && d.added[0] === OWN && d.removed.length === 0;
      });
      if (rung3 && !candidate && verdict.kind === 'unmeasured' && verdict.reason === 'evidence-horizon'
          && correlateDelegation({ ...inp, listingWindows: [], evidenceHorizon: null }).kind === 'linked') hist.lostCreator += 1;

      // A candidate REFUSED for what its window did beyond adding the record (the test knows its own data): a same-repository window
      // that added the record and ALSO removed a name, or ALSO added a second one. Neither is a one-record creation delta.
      const refusedRemoved = held.some((w) => { const d = deltaOf(w); return w.repository === REPO && d !== null && d.added.includes(OWN) && d.removed.length > 0; });
      const refusedAddedTwo = held.some((w) => { const d = deltaOf(w); return w.repository === REPO && d !== null && d.added.includes(OWN) && d.added.length === 2; });
      if (refusedRemoved) hist.refusedRemoved += 1;
      if (refusedAddedTwo) hist.refusedAddedTwo += 1;
    }

    // Every shape the stream is meant to reach is reached (each count above zero), so a verdict drift shows in the histogram too.
    for (const [name, count] of Object.entries(hist)) expect(count, `histogram item ${name} is reached`).toBeGreaterThan(0);
    expect(hist, 'histogram').toEqual(EXPECTED_HISTOGRAM);

    // The digest: sha256 of the canonical JSON of every answer (plain data, keys in the order written above).
    const digest = createHash('sha256').update(JSON.stringify(answers)).digest('hex');
    expect(digest).toBe(EXPECTED_DIGEST);
  });
});

// Computed once at main, before the cost fix (seed 0x5eed627, 2400 inputs).
const EXPECTED_DIGEST = '577367c790c9513fe73016262f749996f47639fd703225a34aa65f9db1676221';
const EXPECTED_HISTOGRAM = {
  linkedRung4: 215, overlapping: 346, ambiguous: 239, lostCreator: 37, unknownWindowForced: 52, markForced: 61, lostEvidenceForced: 48,
  refusedRemoved: 460, refusedAddedTwo: 497, conflicting: 40, unmeasuredHorizon: 369, withRung3Link: 340,
};
