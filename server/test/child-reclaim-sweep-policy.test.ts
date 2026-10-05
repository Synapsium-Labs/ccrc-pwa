// The child-reclaim sweep's DECISIONS, table-driven (child-reclamation spec
// §5.7 "On the sweep", as amended; §5.9). Pure: every input is an argument,
// the clock included, so each fail direction is one row with one answer.
//
// The rule these rows exist for is the amendment: "A minting run absent from
// the database makes a child ineligible, not eligible … a lost or rebuilt
// coordination database makes every child's run absent at once, the live
// ones included." Orphans are reached the OTHER way — through a minting run
// that names a different session — and never through absence. A hold that
// this build cannot PROVE belongs to one of the child's own runs protects
// unconditionally (spec §5.7's "no hold"); only a proven one is ever
// re-examined, and never through the orphan branch.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHILD_RECLAIM_DEFER_CEILING_MS, CHILD_RECLAIM_KEPT_MANY_OVER, CHILD_RECLAIM_PRE_LOCK_TOKEN,
  CHILD_RECLAIM_PRESENCE_DEFERS, CHILD_RECLAIM_SKIP,
  childReclaimAskOrder, childReclaimAttention, childReclaimAttentionWithKept,
  childReclaimBackoffMs, childReclaimCoordinated, childReclaimDeferExpired, childReclaimDue,
  childReclaimFailingPastCeiling, childReclaimFailingSentence, childReclaimFailureLine, childReclaimFeedQuiet,
  childReclaimFirstSighting,
  childReclaimHoldRead, childReclaimJournalRow, childReclaimKeptItems, childReclaimKeptList,
  childReclaimKeptManySentence, childReclaimKeptVerdicts,
  childReclaimNextEntry, childReclaimSameGeneration, childReclaimSweepVerdict, childReclaimTerminalRefusal,
  isChildReclaimPreLockToken,
  type ChildReclaimAsk, type ChildReclaimCoordinatorClaim, type ChildReclaimFeedQuiet, type ChildReclaimHoldCandidate,
  type ChildReclaimJournalAttention, type ChildReclaimJournalRow, type ChildReclaimKeptAttention,
  type ChildReclaimLaneNow, type ChildReclaimSweepEntry, type ChildReclaimSweepInput, type ChildReclaimSweepOutcome,
  type ChildReclaimSweepSkip, type ChildReclaimSweepVerdict, type ChildReclaimTokenKind,
} from '../src/childReclaimSweep.js';
import {
  HOLD_NO_REASON, HOLD_UNREADABLE,
} from '../src/registry.js';
import { CHILD_BIRTH_SKEW_MS } from '../src/coord/childSpent.js';
import { childReclaimTokenKind } from '../src/coord/childReclaim.js';
import {
  CHILD_RECLAIM_KEPT_WORDS, LC_REFUSAL_WORD, SPAWN_STALL_MS, TERMINAL_RUN_STATES, holdReason, isLcRefusalToken,
  type ChildReclaimAttention, type ChildReclaimKeptWord, type LifecycleAct, type LifecycleOutcome,
  type MirroredLifecycleEvent,
} from '../../shared/api.js';

const NOW = 1_790_000_000_000;
/** The lane's pass interval (`watch.ts`'s `CHILD_RECLAIM_SWEEP_MS`) — an
 *  ARGUMENT to the backoff, because this L1 file imports no L4 constant. */
const PASS = 60_000;
const C = CHILD_RECLAIM_DEFER_CEILING_MS;
/** The caller's `CHILD_BIRTH_SKEW_MS` — also an argument. */
const SKEW = 120_000;
/** The same allowance, read from its one definition: the coordination fence's
 *  rows (`childReclaimCoordinated`) are pinned at the value the lane passes. */
const SKEW_MS = CHILD_BIRTH_SKEW_MS;
/** The wall clock's origin where a row gives the lane's two clocks DISTINCT
 *  origins: the monotonic clock reads small numbers from a process-relative
 *  origin, the wall clock reads epoch ms. */
const T0 = NOW;
/** The birth of the workspace generation an entry describes (ccd's clock). */
const BORN = NOW - 3_600_000;
/** One reading of the lane's two clocks; the wall defaults to the monotonic
 *  reading, so a row that is not about the clocks reads one number. */
const at = (mono: number, wall: number = mono): ChildReclaimLaneNow => ({ monoMs: mono, wallMs: wall });
/** What the lane knew when it sent one request. */
const ask = (mono: number, licensed: boolean, asHolder = false, wall: number = mono): ChildReclaimAsk =>
  ({ at: at(mono, wall), licensed, asHolder });
/** A small seeded PRNG (mulberry32), so a seeded row replays exactly. */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

/** A child that is eligible on every count: minted by run 7, which is
 *  terminal, with nothing open on it, born at the same instant its minting
 *  run opened. Each case below breaks ONE thing. */
const base = (over: Partial<ChildReclaimSweepInput> = {}): ChildReclaimSweepInput => ({
  sessionId: 'demo-a',
  child: { kind: 'child', runId: 7 },
  identityMeasured: true,
  workspace: 'demo-a',
  held: { kind: 'none' },
  terminal: false,
  mintingRun: { ok: true, run: { state: 'done', sessionId: 'demo-a', dispatchStartedAt: NOW - 3_600_000,
    openedAt: NOW - 3_600_000 } },
  // A WORK run's child: its minting run reviews nothing (spec §5.7).
  reviewedRun: { kind: 'not-a-review' },
  siblings: { ok: true, open: 0 },
  coordinatorClaim: undefined,
  childBornAt: NOW - 3_600_000,
  skewMs: SKEW,
  nowMs: NOW,
  ...over,
});

const skip = (over: Partial<ChildReclaimSweepInput>) => childReclaimSweepVerdict(base(over));

describe('childReclaimSweepVerdict', () => {
  it('a child of a finished run with nothing open on it is eligible, carrying the MARKER\'s run id', () => {
    expect(childReclaimSweepVerdict(base())).toEqual({ eligible: true, runId: 7 });
    expect(skip({ mintingRun: { ok: true, run: { state: 'failed', sessionId: 'demo-a', dispatchStartedAt: null,
      openedAt: NOW - 3_600_000 } } }))
      .toEqual({ eligible: true, runId: 7 });
  });

  it('a row with no marker is not a child — and nothing is inferred from anything else', () => {
    expect(skip({ child: { kind: 'none' } })).toEqual({ eligible: false, why: 'not-a-child' });
  });

  it('an unreadable marker DEFERS — it is never read as "a child" or as "not a child"', () => {
    expect(skip({ child: { kind: 'unreadable' } })).toEqual({ eligible: false, why: 'marker-unreadable' });
    // …and it wins over every other fact, because nothing else can be trusted
    // about a row whose child-ness is unknown.
    expect(skip({ child: { kind: 'unreadable' }, held: { kind: 'held', reason: 'x' } }))
      .toEqual({ eligible: false, why: 'marker-unreadable' });
  });

  it('a row whose identity this read did not measure is skipped', () => {
    expect(skip({ identityMeasured: false })).toEqual({ eligible: false, why: 'identity-unmeasured' });
  });

  it('a workspace-less row is not a workspace — defence in depth, ccd\'s own rung 1 refuses it too', () => {
    expect(skip({ workspace: null })).toEqual({ eligible: false, why: 'not-a-workspace' });
  });

  it('a held child (unaccounted for) is never eligible — a hold claims the workspace, whatever the reason reads', () => {
    expect(skip({ held: { kind: 'held', reason: 'program:demo wave:2/3 run:8' } }))
      .toEqual({ eligible: false, why: 'held' });
  });

  it('an unmeasured hold is doubt, and doubt protects too', () => {
    expect(skip({ held: { kind: 'unmeasured', reason: 'x', detail: 'run-unreadable' } }))
      .toEqual({ eligible: false, why: 'hold-unmeasured' });
  });

  it('a child under a terminal refusal is not retried — it is on the attention list instead', () => {
    expect(skip({ terminal: true })).toEqual({ eligible: false, why: 'terminal-refusal' });
  });

  it('an unreadable minting run is skipped, never read as absent or terminal', () => {
    expect(skip({ mintingRun: { ok: false, detail: 'run-unreadable' } }))
      .toEqual({ eligible: false, why: 'minting-run-unreadable' });
  });

  it('a minting run ABSENT from the database is NEVER eligible — the amended rule', () => {
    expect(skip({ mintingRun: { ok: true, run: null } })).toEqual({ eligible: false, why: 'minting-run-absent' });
  });

  it('an absent minting run wins over an accounted hold too', () => {
    expect(skip({ mintingRun: { ok: true, run: null },
      held: { kind: 'program', reason: 'program:demo wave:2/3 run:7', program: 'demo', accountedRunId: 7,
        open: { ok: true, count: 0 } } }))
      .toEqual({ eligible: false, why: 'minting-run-absent' });
  });

  it('a lost database makes EVERY child absent at once, and not one of them is eligible', () => {
    const verdicts = ['demo-a', 'demo-b', 'demo-c'].map((sessionId, i) =>
      childReclaimSweepVerdict(base({ sessionId, child: { kind: 'child', runId: 900 + i }, mintingRun: { ok: true, run: null } })));
    expect(verdicts.filter((v) => v.eligible)).toEqual([]);
  });

  it('a live minting run that names THIS child, or no session at all, keeps it', () => {
    for (const state of ['planned', 'dispatched', 'working', 'awaiting-review', 'merging', 'closing', 'unknown'] as const) {
      expect(skip({ mintingRun: { ok: true, run: { state, sessionId: 'demo-a', dispatchStartedAt: NOW - 3_600_000,
        openedAt: NOW - 3_600_000 } } }), state).toEqual({ eligible: false, why: 'minting-run-open' });
      expect(skip({ mintingRun: { ok: true, run: { state, sessionId: null, dispatchStartedAt: NOW - 3_600_000,
        openedAt: NOW - 3_600_000 } } }), `${state}, no session`).toEqual({ eligible: false, why: 'minting-run-open' });
    }
  });

  it('an ORPHAN — its live minting run names a DIFFERENT session — is eligible', () => {
    // Dispatch's two arms that mint a child and fail to bind it: the run was
    // re-dispatched and names the child that DID get bound.
    expect(skip({ mintingRun: { ok: true, run: { state: 'working', sessionId: 'demo-b',
      dispatchStartedAt: NOW - 3_600_000, openedAt: NOW - 3_600_000 } } }))
      .toEqual({ eligible: true, runId: 7 });
  });

  it('…except inside the spawn-stall window of a planned run, where the dispatch may still be binding', () => {
    const planned = (dispatchStartedAt: number | null) =>
      skip({ mintingRun: { ok: true, run: { state: 'planned', sessionId: 'demo-b', dispatchStartedAt,
        openedAt: NOW - 3_600_000 } } });
    expect(planned(NOW - 1_000)).toEqual({ eligible: false, why: 'dispatch-in-flight' });
    expect(planned(NOW - SPAWN_STALL_MS + 1)).toEqual({ eligible: false, why: 'dispatch-in-flight' });
    // The boundary is exclusive of the window: at exactly SPAWN_STALL_MS the
    // dispatch reads as stalled, which is what the field's own docstring names it.
    expect(planned(NOW - SPAWN_STALL_MS)).toEqual({ eligible: true, runId: 7 });
    // A planned run naming another session with NO dispatch stamp is not a
    // shape the fleet produces; if it appears, it is doubt, and doubt waits.
    expect(planned(null)).toEqual({ eligible: false, why: 'dispatch-in-flight' });
  });

  it('a child whose own birth this read could not place is doubt, and doubt waits', () => {
    expect(skip({ childBornAt: null })).toEqual({ eligible: false, why: 'child-birth-unplaced' });
  });

  it('a minting run opened after the child\'s birth (plus the skew) cannot be the run that minted it', () => {
    const opened = (openedAt: number) => skip({ childBornAt: NOW - 3_600_000,
      mintingRun: { ok: true, run: { state: 'done', sessionId: 'demo-a', dispatchStartedAt: null, openedAt } } });
    // Exactly at the skew: still placeable.
    expect(opened(NOW - 3_600_000 + SKEW)).toEqual({ eligible: true, runId: 7 });
    // One millisecond past it: doubt.
    expect(opened(NOW - 3_600_000 + SKEW + 1)).toEqual({ eligible: false, why: 'minting-run-postdates-child' });
  });

  it('an unreadable sibling list is INELIGIBLE, never "none"', () => {
    expect(skip({ siblings: { ok: false, detail: 'run-unreadable' } })).toEqual({ eligible: false, why: 'siblings-unreadable' });
  });

  it('an open run naming the child keeps it', () => {
    expect(skip({ siblings: { ok: true, open: 1 } })).toEqual({ eligible: false, why: 'siblings-open' });
  });

  it('a child that is coordinating a run (an open claim) is never reclaimed automatically', () => {
    expect(skip({ coordinatorClaim: 'open' })).toEqual({ eligible: false, why: 'coordinating' });
  });

  // K2 — the verdict reads the claim through the ONE fence (spec §1 rule 4;
  // spec §5.6: slugs recycle), fenced to `childBornAt` (BORN here) less the
  // skew the caller passes (`skewMs`, SKEW here).
  it('K2: the verdict fences a claim to this generation — open keeps, the skew boundary keeps, one ms before it is eligible', () => {
    expect(skip({ coordinatorClaim: 'open' })).toEqual({ eligible: false, why: 'coordinating' });
    expect(skip({ coordinatorClaim: BORN - SKEW })).toEqual({ eligible: false, why: 'coordinating' });
    expect(skip({ coordinatorClaim: BORN - SKEW - 1 })).toEqual({ eligible: true, runId: 7 });
  });

  // SPEC §5.7 — a REVIEW child lives until the run it reviewed is
  // terminal: the reviewer's report is still cited, and the coordinator
  // cites that path in fix-round mail for as long as the reviewed work is open.
  it('a REVIEW child is kept while the run it reviewed is not terminal — its report is still cited', () => {
    for (const state of ['planned', 'dispatched', 'working', 'awaiting-review', 'merging', 'closing', 'unknown'] as const) {
      expect(skip({ reviewedRun: { kind: 'run', state } }), state)
        .toEqual({ eligible: false, why: 'review-report-live' });
    }
  });

  it('…and is reclaimed like any other child once the reviewed run is terminal', () => {
    for (const state of TERMINAL_RUN_STATES) {
      expect(skip({ reviewedRun: { kind: 'run', state } }), state).toEqual({ eligible: true, runId: 7 });
    }
  });

  it('a reviewed run that is absent or unreadable keeps the review child — doubt waits', () => {
    expect(skip({ reviewedRun: { kind: 'absent' } })).toEqual({ eligible: false, why: 'reviewed-run-absent' });
    expect(skip({ reviewedRun: { kind: 'unreadable', detail: 'run-unreadable' } }))
      .toEqual({ eligible: false, why: 'reviewed-run-unreadable' });
  });

  it('an ORPHANED review child is kept too, while its reviewed run is open', () => {
    // The orphan branch (a live minting run naming a different session) is
    // not a way round the review rule.
    expect(skip({
      mintingRun: { ok: true, run: { state: 'working', sessionId: 'demo-b', dispatchStartedAt: NOW - 3_600_000,
        openedAt: NOW - 3_600_000 } },
      reviewedRun: { kind: 'run', state: 'awaiting-review' },
    })).toEqual({ eligible: false, why: 'review-report-live' });
  });

  describe('a hold this build PROVED belongs to one of this child\'s own runs', () => {
    const accounted = { kind: 'program' as const, reason: 'program:demo wave:2/3 run:7', program: 'demo',
      accountedRunId: 7 };

    it('never releases through the orphan branch — a non-terminal minting run is held, whatever the account says', () => {
      expect(skip({
        held: { ...accounted, open: { ok: true, count: 0 } },
        mintingRun: { ok: true, run: { state: 'working', sessionId: 'demo-b', dispatchStartedAt: NOW - 3_600_000,
          openedAt: NOW - 3_600_000 } },
      })).toEqual({ eligible: false, why: 'held' });
    });

    it('an unreadable open-run count is doubt', () => {
      expect(skip({ held: { ...accounted, open: { ok: false, detail: 'count-unreadable' } } }))
        .toEqual({ eligible: false, why: 'hold-unmeasured' });
    });

    it('an open programme still protects — plain held, not a release', () => {
      expect(skip({ held: { ...accounted, open: { ok: true, count: 1 } } })).toEqual({ eligible: false, why: 'held' });
    });

    it('a retired programme (no open run) answers hold-retired, carrying the accounting, where it would have been eligible', () => {
      expect(skip({ held: { ...accounted, open: { ok: true, count: 0 } } })).toEqual({
        eligible: false, why: 'hold-retired', runId: 7,
        release: { reason: accounted.reason, program: 'demo', accountedRunId: 7 },
      });
    });

    it('retired, but siblings open — the ordinary conjunct still rules', () => {
      expect(skip({ held: { ...accounted, open: { ok: true, count: 0 } }, siblings: { ok: true, open: 1 } }))
        .toEqual({ eligible: false, why: 'siblings-open' });
    });

    it('retired, but the run it reviewed is still open — the review conjunct still rules', () => {
      expect(skip({ held: { ...accounted, open: { ok: true, count: 0 } }, reviewedRun: { kind: 'run', state: 'working' } }))
        .toEqual({ eligible: false, why: 'review-report-live' });
    });

    it('retired, but this child has coordinated — the coordinating conjunct still rules', () => {
      expect(skip({ held: { ...accounted, open: { ok: true, count: 0 } }, coordinatorClaim: 'open' }))
        .toEqual({ eligible: false, why: 'coordinating' });
    });

    it('the birth fence rules BEFORE the hold is even considered — a postdating minting run under a still-open, accounted programme answers the fence\'s own word', () => {
      // The hold read is `program(open count 1)`: were the hold checked
      // first, this would answer `held`. The fence sits earlier, so it does.
      expect(skip({
        held: { ...accounted, open: { ok: true, count: 1 } },
        childBornAt: NOW - 3_600_000,
        mintingRun: { ok: true, run: { state: 'done', sessionId: 'demo-a', dispatchStartedAt: null,
          openedAt: NOW - 3_600_000 + SKEW + 1 } },
      })).toEqual({ eligible: false, why: 'minting-run-postdates-child' });
    });
  });
});

// K1 — THE coordination fence, pure (spec §1 rule 4: manual cleanup is
// reserved for a coordinator's own workspace; spec §5.6: slugs recycle, so
// "has coordinated" means THIS incarnation of the workspace). One function
// every consumer decides through: the sweep's verdict, the close, the
// executor's step 2a and the hold-release job's step 5. B is a measured
// current-generation birth on ccd's clock; every doubt keeps the child.
describe('childReclaimCoordinated — the coordination fence, fenced to the current generation', () => {
  const B = 1_790_413_776_948;
  const born = (v: number | null) => (): number | null => v;
  const ROWS: readonly (readonly [string, ChildReclaimCoordinatorClaim | undefined, number | null, boolean])[] = [
    ['K1.1 never claimed: not coordinated', undefined, B, false],
    ['K1.2 an open claim, birth placed: coordinated', 'open', B, true],
    ['K1.3 an open claim, birth unplaceable: coordinated', 'open', null, true],
    ['K1.4 an unplaced claim: coordinated', 'unplaced', B, true],
    ['K1.5 the recycled slug — a claim that closed three weeks before this generation was born: not coordinated',
      1_788_533_627_803, B, false],
    ['K1.6 one ms outside the skew: not coordinated', B - SKEW_MS - 1, B, false],
    ['K1.7 the boundary, inclusive: coordinated', B - SKEW_MS, B, true],
    ['K1.8 inside the skew: coordinated', B - 100_000, B, true],
    ['K1.9 this generation: coordinated', B + 1, B, true],
    ['K1.10 an unplaceable birth keeps the child, however old the claim', B - 10 * SKEW_MS, null, true],
  ];
  it.each(ROWS)('%s', (_name, claim, bornAt, want) => {
    expect(childReclaimCoordinated(claim, born(bornAt), SKEW_MS)).toBe(want);
  });

  it('K1.11 the birth is read lazily — never for no claim, an open claim or an unplaced one', () => {
    const unread = (): number | null => { throw new Error('the birth was read'); };
    expect(childReclaimCoordinated(undefined, unread, SKEW_MS)).toBe(false);
    expect(childReclaimCoordinated('open', unread, SKEW_MS)).toBe(true);
    expect(childReclaimCoordinated('unplaced', unread, SKEW_MS)).toBe(true);
  });

  it('K1.12 a non-number on either side of the comparison keeps the child', () => {
    expect(childReclaimCoordinated(Number.NaN, born(B), SKEW_MS)).toBe(true);
    expect(childReclaimCoordinated(B - 10 * SKEW_MS, born(Number.NaN), SKEW_MS)).toBe(true);
  });
});

describe('childReclaimHoldRead — accounting a hold\'s text against this child\'s own runs', () => {
  const candidate = (over: Partial<ChildReclaimHoldCandidate> = {}): ChildReclaimHoldCandidate => ({
    runId: 1, sessionId: 'demo-a', state: 'done', program: 'demo', wave: 1, waveOf: 3, ...over,
  });
  const read = (raw: string | null, candidates: readonly ChildReclaimHoldCandidate[], mintingRunId = 7,
    openOf: (p: string) => { ok: true; count: number } | { ok: false; detail: string } = () => ({ ok: true, count: 0 })) =>
    childReclaimHoldRead(raw, 'demo-a', mintingRunId, { ok: true, candidates }, openOf);

  it('no hold at all', () => {
    expect(childReclaimHoldRead(null, 'demo-a', 7, { ok: true, candidates: [] }, () => ({ ok: true, count: 0 })))
      .toEqual({ kind: 'none' });
  });

  it('a human hold in free text matches nothing and is unconditionally held', () => {
    expect(read('I need this workspace for debugging', [])).toEqual({ kind: 'held', reason: 'I need this workspace for debugging' });
  });

  it('the PWA\'s placeholder grammar, written on purpose, is not a real run\'s rendering — held', () => {
    // The child's only run is wave 2: its non-final-close rendering is
    // `wave:3/…`, never `wave:2/…`, so the placeholder text never matches.
    expect(read('program:demo wave:2/4', [candidate({ wave: 2, waveOf: 4 })])).toEqual({ kind: 'held', reason: 'program:demo wave:2/4' });
  });

  it('a run named in the text that this read did not list is not accounted — held', () => {
    const text = holdReason('demo', 2, 3, 99);
    expect(read(text, [candidate({ runId: 1, wave: 2, waveOf: 3 })])).toEqual({ kind: 'held', reason: text });
  });

  it('a rendering of a run naming a DIFFERENT session is not accounted, even byte-identical — held', () => {
    const text = holdReason('demo', 1, 3, 1);
    expect(read(text, [candidate({ sessionId: 'demo-other' })])).toEqual({ kind: 'held', reason: text });
  });

  it('a leading-zero or otherwise reformatted wave never matches a real rendering — held', () => {
    expect(read('program:demo wave:02/3 run:1', [candidate()])).toEqual({ kind: 'held', reason: 'program:demo wave:02/3 run:1' });
  });

  it('the registry\'s own unreadable-hold and empty-hold sentinels match nothing — held', () => {
    expect(read(HOLD_UNREADABLE, [candidate()])).toEqual({ kind: 'held', reason: HOLD_UNREADABLE });
    expect(read(HOLD_NO_REASON, [candidate()])).toEqual({ kind: 'held', reason: HOLD_NO_REASON });
  });

  it('a matching text from a NON-TERMINAL run is not accounted — held', () => {
    const text = holdReason('demo', 1, 3, 1);
    expect(read(text, [candidate({ state: 'working' })])).toEqual({ kind: 'held', reason: text });
  });

  it('the open/dispatch rendering of a terminal run naming the child is accounted', () => {
    const text = holdReason('demo', 1, 3, 1);
    expect(read(text, [candidate()], 7, () => ({ ok: true, count: 2 }))).toEqual({
      kind: 'program', reason: text, program: 'demo', accountedRunId: 1, open: { ok: true, count: 2 },
    });
  });

  it('the non-final-close rendering (wave+1, no run id) is accounted the same way', () => {
    const text = holdReason('demo', 2, 3, null);
    expect(read(text, [candidate({ wave: 1, waveOf: 3 })])).toEqual({
      kind: 'program', reason: text, program: 'demo', accountedRunId: 1, open: { ok: true, count: 0 },
    });
  });

  it('the child\'s own MINTING run accounts too, even when its sessionId is not this child\'s', () => {
    const text = holdReason('demo', 1, 3, 1);
    expect(read(text, [candidate({ runId: 1, sessionId: 'demo-other' })], 1)).toEqual({
      kind: 'program', reason: text, program: 'demo', accountedRunId: 1, open: { ok: true, count: 0 },
    });
  });

  it('a candidate read this process could not complete is unmeasured, never "no candidates"', () => {
    expect(childReclaimHoldRead('program:demo wave:1/3 run:1', 'demo-a', 7, { ok: false, detail: 'run-unreadable' },
      () => ({ ok: true, count: 0 }))).toEqual({ kind: 'unmeasured', reason: 'program:demo wave:1/3 run:1', detail: 'run-unreadable' });
  });

  it('the raw text is trimmed before matching or reporting', () => {
    const text = holdReason('demo', 1, 3, 1);
    expect(read(`  ${text}  `, [candidate()])).toEqual({
      kind: 'program', reason: text, program: 'demo', accountedRunId: 1, open: { ok: true, count: 0 },
    });
  });
});

describe('the twice-observed memory, its two clocks, the presence episode, and the failure backoff', () => {
  const entry: ChildReclaimSweepEntry = childReclaimFirstSighting(NOW - 60_000, BORN);

  it('a first sighting starts no clock, counts no failure, and was never asked', () => {
    expect(entry).toEqual({ firstEligibleAt: NOW - 60_000, firstDeferredAt: null, firstPresenceDeferredAt: null,
      lastPresenceDeferredAt: null, lastPresenceWallAt: null, presenceHeldSince: null, bornAt: BORN,
      lastDeferWhy: null, consecutiveFailures: 0, lastFailedAt: null, refusedAt: null, lastAskedAt: null });
  });

  it('forgets a child whose reclaim ended outright — reclaimed, or already gone', () => {
    expect(childReclaimNextEntry(entry, { kind: 'reclaimed' }, ask(NOW, false), at(NOW), PASS)).toBeNull();
    expect(childReclaimNextEntry(entry, { kind: 'gone' }, ask(NOW, false), at(NOW), PASS)).toBeNull();
  });

  it('a TERMINAL refusal keeps its entry — the lifecycle mirror holds the refusal, this memory only paces the re-ask', () => {
    const refused = childReclaimNextEntry(entry, { kind: 'refused', token: 'tree-unreadable' }, ask(NOW, false), at(NOW), PASS);
    expect(refused).toEqual({ ...entry, consecutiveFailures: 0, lastFailedAt: null,
      firstPresenceDeferredAt: null, refusedAt: NOW, lastAskedAt: NOW });
  });

  it('a refusal ends a run of failures and the presence episode alike', () => {
    const failing: ChildReclaimSweepEntry = { ...entry, consecutiveFailures: 3, lastFailedAt: NOW - 1,
      firstPresenceDeferredAt: NOW - 10 * C, lastPresenceDeferredAt: NOW - PASS, lastPresenceWallAt: NOW - PASS };
    expect(childReclaimNextEntry(failing, { kind: 'refused', token: 'tree-unreadable' }, ask(NOW, false), at(NOW), PASS))
      .toMatchObject({ consecutiveFailures: 0, lastFailedAt: null, firstPresenceDeferredAt: null,
        lastPresenceDeferredAt: null, refusedAt: NOW });
  });

  it('counts a failed attempt and stamps when it was asked — the any-kind clock untouched, the presence episode ended', () => {
    const withPresence: ChildReclaimSweepEntry = { ...entry, firstPresenceDeferredAt: NOW - 1000,
      lastPresenceDeferredAt: NOW - 1000, lastPresenceWallAt: NOW - 1000 };
    const once = childReclaimNextEntry(withPresence, { kind: 'failed' }, ask(NOW, false), at(NOW), PASS);
    expect(once).toEqual({ ...withPresence, consecutiveFailures: 1, lastFailedAt: NOW,
      firstPresenceDeferredAt: null, lastPresenceDeferredAt: null, lastPresenceWallAt: null, refusedAt: null,
      lastAskedAt: NOW });
    expect(childReclaimNextEntry(once!, { kind: 'failed' }, ask(NOW + 120_000, false), at(NOW + 120_000), PASS))
      .toEqual({ ...withPresence, consecutiveFailures: 2, lastFailedAt: NOW + 120_000,
        firstPresenceDeferredAt: null, lastPresenceDeferredAt: null, lastPresenceWallAt: null, refusedAt: null,
        lastAskedAt: NOW + 120_000 });
  });

  it('any deferral ends a run of failures — a defer is not a failure', () => {
    const failing: ChildReclaimSweepEntry = { ...entry, consecutiveFailures: 3, lastFailedAt: NOW - 1 };
    expect(childReclaimNextEntry(failing, { kind: 'deferred', why: 'held' }, ask(NOW, false), at(NOW), PASS))
      .toMatchObject({ consecutiveFailures: 0, lastFailedAt: null });
  });

  it('an UNLICENSED PRESENCE defer starts BOTH clocks, once; the next one a pass later restarts neither, and only moves the latest answer', () => {
    for (const why of CHILD_RECLAIM_PRESENCE_DEFERS) {
      const first = childReclaimNextEntry(entry, { kind: 'deferred', why }, ask(NOW, false), at(NOW), PASS);
      expect(first, why).toEqual({ ...entry, firstDeferredAt: NOW, firstPresenceDeferredAt: NOW,
        lastPresenceDeferredAt: NOW, lastPresenceWallAt: NOW, presenceHeldSince: NOW, lastDeferWhy: why, lastAskedAt: NOW });
      expect(childReclaimNextEntry(first!, { kind: 'deferred', why }, ask(NOW + 60_000, false), at(NOW + 60_000), PASS), why)
        .toEqual({
          ...first!, lastPresenceDeferredAt: NOW + 60_000, lastPresenceWallAt: NOW + 60_000, lastAskedAt: NOW + 60_000,
        });
    }
  });

  it('a LICENSED presence defer RESTARTS the episode even while one is already running', () => {
    const running: ChildReclaimSweepEntry = { ...entry, firstDeferredAt: NOW - 10 * C, firstPresenceDeferredAt: NOW - 10 * C,
      lastPresenceDeferredAt: NOW - PASS, lastPresenceWallAt: NOW - PASS };
    const restarted = childReclaimNextEntry(running, { kind: 'deferred', why: 'presence' }, ask(NOW, true), at(NOW), PASS);
    expect(restarted).toEqual({ ...running, firstPresenceDeferredAt: NOW, lastPresenceDeferredAt: NOW,
      lastPresenceWallAt: NOW, presenceHeldSince: null, lastDeferWhy: 'presence', lastAskedAt: NOW });
    expect(childReclaimDeferExpired(running, at(NOW), PASS)).toBe(true);
    expect(childReclaimDeferExpired(restarted!, at(NOW), PASS)).toBe(false);
  });

  it('`licensed` is read only on a presence-class defer — it changes nothing for failed, refused, or any other why', () => {
    const stale: ChildReclaimSweepEntry = { ...entry, firstPresenceDeferredAt: NOW - 10 * C, lastPresenceDeferredAt: NOW - PASS,
      lastPresenceWallAt: NOW - PASS };
    for (const outcome of [{ kind: 'failed' as const }, { kind: 'refused' as const, token: 'tree-unreadable' },
      { kind: 'deferred' as const, why: 'held' }]) {
      expect(childReclaimNextEntry(stale, outcome, ask(NOW, true), at(NOW), PASS), outcome.kind)
        .toEqual(childReclaimNextEntry(stale, outcome, ask(NOW, false), at(NOW), PASS));
    }
  });

  it('a defer that is not presence starts the ANY-kind clock, and clears the presence clock', () => {
    for (const why of ['state-changed', 'paused', 'held', 'in-progress', 'reap-in-progress', 'siblings-open',
      'unsupported', 'paused-at-server']) {
      const withPresence: ChildReclaimSweepEntry = { ...entry, firstPresenceDeferredAt: NOW - 1000,
        lastPresenceDeferredAt: NOW - 1000, lastPresenceWallAt: NOW - 1000 };
      expect(childReclaimNextEntry(withPresence, { kind: 'deferred', why }, ask(NOW, false), at(NOW), PASS), why)
        .toEqual({ ...withPresence, firstDeferredAt: NOW, firstPresenceDeferredAt: null, lastPresenceDeferredAt: null,
          lastPresenceWallAt: null, lastDeferWhy: why, refusedAt: null, lastAskedAt: NOW });
    }
  });

  it('a presence defer AFTER another kind keeps the earlier any-kind clock and starts its own', () => {
    const other = childReclaimNextEntry(entry, { kind: 'deferred', why: 'state-changed' }, ask(NOW, false), at(NOW), PASS)!;
    expect(childReclaimNextEntry(other, { kind: 'deferred', why: 'attached' }, ask(NOW + 60_000, false), at(NOW + 60_000), PASS))
      .toEqual({ ...entry, firstDeferredAt: NOW, firstPresenceDeferredAt: NOW + 60_000,
        lastPresenceDeferredAt: NOW + 60_000, lastPresenceWallAt: NOW + 60_000, presenceHeldSince: NOW + 60_000,
        lastDeferWhy: 'attached', lastAskedAt: NOW + 60_000 });
  });

  it('names exactly the three presence defers — rungs 5 and 6 and the server\'s visibility claim', () => {
    expect([...CHILD_RECLAIM_PRESENCE_DEFERS]).toEqual(['presence', 'attached', 'tree-busy']);
  });

  it('the ceiling is fifteen minutes, reached at exactly fifteen — on the PRESENCE clock alone', () => {
    // A HARDCODED literal on purpose — the mutation control for the constant.
    expect(CHILD_RECLAIM_DEFER_CEILING_MS).toBe(900_000);
    // Its latest presence answer one pass before the ceiling, so freshness
    // holds at both rows below and only the ceiling's own edge decides them.
    const presence: ChildReclaimSweepEntry = { ...entry, firstDeferredAt: NOW - 10 * C, firstPresenceDeferredAt: NOW,
      lastPresenceDeferredAt: NOW + C - PASS, lastPresenceWallAt: NOW + C - PASS };
    expect(childReclaimDeferExpired(entry, at(NOW + 10 * C), PASS)).toBe(false);
    // An any-kind deferral ten ceilings old expires nothing: only presence is bounded.
    expect(childReclaimDeferExpired({ ...entry, firstDeferredAt: NOW - 10 * C }, at(NOW), PASS)).toBe(false);
    expect(childReclaimDeferExpired(presence, at(NOW + C - 1), PASS)).toBe(false);
    expect(childReclaimDeferExpired(presence, at(NOW + C), PASS)).toBe(true);
  });

  it('backs off min(ceiling, pass interval × 2^k) after k failures in a row — and not at all with none', () => {
    expect([0, 1, 2, 3, 4, 40].map((k) => childReclaimBackoffMs(k, PASS)))
      .toEqual([0, 120_000, 240_000, 480_000, 900_000, 900_000]);
  });

  it('a backed-off child waits until exactly its backoff has passed; a child with no failure never waits', () => {
    const failed: ChildReclaimSweepEntry = { ...entry, consecutiveFailures: 1, lastFailedAt: NOW };
    expect(childReclaimDue(entry, NOW, PASS)).toBe(true);
    expect(childReclaimDue(failed, NOW + 119_999, PASS)).toBe(false);
    expect(childReclaimDue(failed, NOW + 120_000, PASS)).toBe(true);
  });

  it('every arm except `refused` clears `refusedAt` — a stale one from an earlier refusal does not survive a later failure or deferral', () => {
    const stale: ChildReclaimSweepEntry = { ...entry, refusedAt: NOW - 1 };
    expect(childReclaimNextEntry(stale, { kind: 'failed' }, ask(NOW, false), at(NOW), PASS)).toMatchObject({ refusedAt: null });
    expect(childReclaimNextEntry(stale, { kind: 'deferred', why: 'held' }, ask(NOW, false), at(NOW), PASS))
      .toMatchObject({ refusedAt: null });
  });

  it("starting past the ceiling, ENDING the episode makes childReclaimDeferExpired false — for failed, refused, and every non-presence why, asked of the function itself", () => {
    const stale: ChildReclaimSweepEntry = { ...entry, firstPresenceDeferredAt: NOW - 10 * C, lastPresenceDeferredAt: NOW - PASS,
      lastPresenceWallAt: NOW - PASS };
    expect(childReclaimDeferExpired(stale, at(NOW), PASS), 'the control: past the ceiling, its latest answer recent').toBe(true);
    const outcomes: ChildReclaimSweepOutcome[] = [
      { kind: 'failed' }, { kind: 'refused', token: 'tree-unreadable' }, { kind: 'deferred', why: 'held' },
    ];
    for (const outcome of outcomes) {
      const next = childReclaimNextEntry(stale, outcome, ask(NOW, false), at(NOW), PASS)!;
      expect(childReclaimDeferExpired(next, at(NOW), PASS), outcome.kind).toBe(false);
    }
  });

  describe('the episode is CONTINUOUS — two and a half pass intervals at most between its presence answers, and to the ask', () => {
    const presence: ChildReclaimSweepOutcome = { kind: 'deferred', why: 'presence' };
    /** The bound, as the policy derives it from the interval it is handed. */
    const GAP = 2.5 * PASS;

    it('a presence answer more than two and a half intervals after the last one starts a NEW episode — although the first answer is past the ceiling', () => {
      const first = childReclaimNextEntry(entry, presence, ask(NOW - C - 10 * PASS, false), at(NOW - C - 10 * PASS), PASS)!;
      expect(first).toMatchObject({ firstPresenceDeferredAt: NOW - C - 10 * PASS, lastPresenceDeferredAt: NOW - C - 10 * PASS });
      const second = childReclaimNextEntry(first, presence, ask(NOW - PASS, false), at(NOW - PASS), PASS)!;
      expect(second, 'the episode restarts at the second answer').toMatchObject({
        firstDeferredAt: NOW - C - 10 * PASS, firstPresenceDeferredAt: NOW - PASS, lastPresenceDeferredAt: NOW - PASS });
      expect(childReclaimDeferExpired(second, at(NOW), PASS), 'shortly after the second answer nothing is licensed').toBe(false);
    });

    it('…at EXACTLY two and a half intervals the episode continues, one ms more and it restarts — measured in the interval it is handed', () => {
      const first = childReclaimNextEntry(entry, presence, ask(NOW, false), at(NOW), PASS)!;
      expect(childReclaimNextEntry(first, presence, ask(NOW + GAP, false), at(NOW + GAP), PASS))
        .toMatchObject({ firstPresenceDeferredAt: NOW, lastPresenceDeferredAt: NOW + GAP });
      expect(childReclaimNextEntry(first, presence, ask(NOW + GAP + 1, false), at(NOW + GAP + 1), PASS))
        .toMatchObject({ firstPresenceDeferredAt: NOW + GAP + 1, lastPresenceDeferredAt: NOW + GAP + 1 });
      // The same gap under a longer interval is continuous: the bound is the
      // argument's, never a constant of its own.
      expect(childReclaimNextEntry(first, presence, ask(NOW + GAP + 1, false), at(NOW + GAP + 1), 10 * PASS))
        .toMatchObject({ firstPresenceDeferredAt: NOW, lastPresenceDeferredAt: NOW + GAP + 1 });
    });

    it('an episode past the ceiling licenses nothing once its latest presence answer is older than two and a half intervals — at exactly that it still does', () => {
      const ep: ChildReclaimSweepEntry = { ...entry, firstDeferredAt: NOW - 2 * C, firstPresenceDeferredAt: NOW - 2 * C,
        lastPresenceDeferredAt: NOW - GAP - 1, lastPresenceWallAt: NOW - GAP - 1 };
      expect(childReclaimDeferExpired(ep, at(NOW), PASS), 'one sample, then time nobody measured').toBe(false);
      expect(childReclaimDeferExpired({ ...ep, lastPresenceDeferredAt: NOW - GAP, lastPresenceWallAt: NOW - GAP }, at(NOW), PASS),
        'the inclusive boundary').toBe(true);
      expect(childReclaimDeferExpired({ ...ep, lastPresenceDeferredAt: null }, at(NOW), PASS), 'no presence answer on record')
        .toBe(false);
      expect(childReclaimDeferExpired(ep, at(NOW), 10 * PASS), 'measured in the interval it is handed').toBe(true);
    });

    it('an entry off the invariant — a recent latest answer but no episode running — STARTS an episode, never extends a null one', () => {
      // `lastPresenceDeferredAt` is null exactly when `firstPresenceDeferredAt`
      // is, on every entry the lane can reach. This literal breaks that on
      // purpose: a recent latest answer alone must not count as an episode.
      const offInvariant: ChildReclaimSweepEntry = { ...entry, firstPresenceDeferredAt: null, lastPresenceDeferredAt: NOW - PASS,
        lastPresenceWallAt: NOW - PASS };
      expect(childReclaimNextEntry(offInvariant, presence, ask(NOW, false), at(NOW), PASS))
        .toMatchObject({ firstPresenceDeferredAt: NOW, lastPresenceDeferredAt: NOW });
    });
  });

  describe('childReclaimDue — the lane\'s ONE "may I ask again" question, folding both pacings', () => {
    it('a never-asked entry is always due', () => {
      expect(childReclaimDue(entry, NOW, PASS)).toBe(true);
    });

    it('backs off after a failure exactly as childReclaimBackoffMs says — due at exactly the backoff, not one ms before', () => {
      for (const k of [1, 2, 3, 4]) {
        const failed: ChildReclaimSweepEntry = { ...entry, consecutiveFailures: k, lastFailedAt: NOW };
        const backoff = childReclaimBackoffMs(k, PASS);
        expect(childReclaimDue(failed, NOW + backoff - 1, PASS), `k=${k}`).toBe(false);
        expect(childReclaimDue(failed, NOW + backoff, PASS), `k=${k}`).toBe(true);
      }
    });

    it('a terminal refusal is not due before the ceiling, and IS due at exactly the ceiling after refusedAt', () => {
      const refused: ChildReclaimSweepEntry = { ...entry, refusedAt: NOW };
      expect(childReclaimDue(refused, NOW + C - 1, PASS)).toBe(false);
      expect(childReclaimDue(refused, NOW + C, PASS)).toBe(true);
    });

    it('a later non-refusal outcome clears refusedAt, so the child is due on the ordinary backoff alone again', () => {
      const refused: ChildReclaimSweepEntry = { ...entry, refusedAt: NOW - 1 };
      const next = childReclaimNextEntry(refused, { kind: 'deferred', why: 'held' }, ask(NOW, false), at(NOW), PASS)!;
      expect(next.refusedAt).toBeNull();
      expect(childReclaimDue(next, NOW, PASS)).toBe(true);
    });
  });
});

// SPEC §5.7 — the lane's two clocks, the bracketed answer and the presence
// lease. Every instant an entry keeps is the lane's MONOTONIC clock, except
// `firstDeferredAt` (wall-clock epoch ms, displayed), `lastPresenceWallAt`
// (the gap's wall operand) and `bornAt` (ccd's clock, compared for equality).
// The rows below read monotonic values from a small origin, as a process's
// monotonic clock does.
describe('the lane\'s two clocks, the bracketed answer, and the presence lease (spec §5.7)', () => {
  const presence: ChildReclaimSweepOutcome = { kind: 'deferred', why: 'presence' };
  /** The gap bound, as the policy derives it from the interval it is handed. */
  const G = 2.5 * PASS;
  /** A first sighting at monotonic 0. */
  const fresh: ChildReclaimSweepEntry = childReclaimFirstSighting(0, BORN);
  /** One due item, the shape `childReclaimAskOrder` takes. */
  const item = (id: string, over: Partial<ChildReclaimSweepEntry> = {}): { id: string; entry: ChildReclaimSweepEntry } =>
    ({ id, entry: { ...fresh, ...over } });
  const ids = (xs: readonly { id: string }[]): string[] => xs.map((x) => x.id);

  it('P0: childReclaimAskOrder returns a PERMUTATION of the due list — the same items by reference, and the same length', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const rnd = mulberry32(seed);
      const n = Math.floor(rnd() * 9);                        // 0–8 due items
      const due = Array.from({ length: n }, (_, k) => item(`demo-${k}`, {
        firstEligibleAt: Math.floor(rnd() * 3) * 1_000,
        lastAskedAt: rnd() < 0.3 ? null : Math.floor(rnd() * 4) * 1_000,
        presenceHeldSince: rnd() < 0.4 ? Math.floor(rnd() * 3) * 1_000 : null,
      }));
      const { order, holderId } = childReclaimAskOrder(due);
      expect(order, `seed ${seed}: the same length`).toHaveLength(due.length);
      for (const d of due) expect(order.filter((o) => o === d), `seed ${seed}: ${d.id} once, by reference`).toHaveLength(1);
      expect(holderId === null ? true : order[0]?.id === holderId, `seed ${seed}: the holder is asked first`).toBe(true);
    }
  });

  it('P1: one presence-held child among never-asked children goes FIRST, although it was asked most recently — and holderId names it', () => {
    const held = item('demo-z', { lastAskedAt: 500_000, presenceHeldSince: 400_000 });
    const { order, holderId } = childReclaimAskOrder([item('demo-a'), item('demo-b'), held, item('demo-c')]);
    expect(ids(order)).toEqual(['demo-z', 'demo-a', 'demo-b', 'demo-c']);
    expect(holderId).toBe('demo-z');
  });

  it('P2: seniority is presenceHeldSince, never the episode start', () => {
    const S = item('demo-s', { presenceHeldSince: 0, firstPresenceDeferredAt: 500_000, lastAskedAt: 600_000 });
    const J = item('demo-j', { presenceHeldSince: 100_000, firstPresenceDeferredAt: 100_000, lastAskedAt: 600_000 });
    const { order, holderId } = childReclaimAskOrder([J, S]);
    expect(holderId).toBe('demo-s');
    expect(ids(order)).toEqual(['demo-s', 'demo-j']);
  });

  it('P3: seniority is not the any-kind clock either', () => {
    const J = item('demo-j', { firstDeferredAt: T0, presenceHeldSince: 100_000, lastAskedAt: 600_000 });
    const S = item('demo-s', { firstDeferredAt: T0 + 500_000, presenceHeldSince: 0, lastAskedAt: 600_000 });
    expect(childReclaimAskOrder([J, S]).holderId).toBe('demo-s');
  });

  it('P4: a presenceHeldSince tie falls to firstEligibleAt, then id; with no holder, the order is the fairness order alone', () => {
    // The holder arm: B was sighted before A although A sorts first by id.
    const A = item('demo-a', { presenceHeldSince: 100, firstEligibleAt: 2_000, lastAskedAt: 50 });
    const B = item('demo-b', { presenceHeldSince: 100, firstEligibleAt: 1_000, lastAskedAt: 60 });
    const Cc = item('demo-c', { presenceHeldSince: 100, firstEligibleAt: 1_000, lastAskedAt: 70 });
    expect(childReclaimAskOrder([A, Cc, B]).holderId, 'firstEligibleAt, then id').toBe('demo-b');
    expect(ids(childReclaimAskOrder([A, Cc, B]).order)).toEqual(['demo-b', 'demo-a', 'demo-c']);
    // The fairness arm: never asked first; among those, sighted earlier first
    // (not id); then lastAskedAt ascending; a lastAskedAt tie falls to
    // firstEligibleAt, then id — the three shapes the lane rows pin.
    const due = [
      item('demo-p', { lastAskedAt: 2_000 }),
      item('demo-u', { lastAskedAt: 3_000, firstEligibleAt: 9_000 }),
      item('demo-x', { lastAskedAt: null, firstEligibleAt: 5_000 }),
      item('demo-r', { lastAskedAt: 1_000 }),
      item('demo-v', { lastAskedAt: 3_000, firstEligibleAt: 8_000 }),
      item('demo-y', { lastAskedAt: null, firstEligibleAt: 3_000 }),
      item('demo-q', { lastAskedAt: 1_000 }),
    ];
    const fair = childReclaimAskOrder(due);
    expect(fair.holderId).toBeNull();
    expect(ids(fair.order)).toEqual(['demo-y', 'demo-x', 'demo-q', 'demo-r', 'demo-p', 'demo-v', 'demo-u']);
  });

  it('P5: presenceHeldSince — joined at an unlicensed ARRIVAL, kept while the episode continues, forfeited by a holder that cannot continue it', () => {
    // A non-holder's first unlicensed presence answer: asked at 10 000, it ARRIVES at 14 000.
    const joined = childReclaimNextEntry(fresh, presence, ask(10_000, false), at(14_000), PASS)!;
    expect(joined.presenceHeldSince, 'a non-holder joins the line at its arrival').toBe(14_000);
    // The holder's unlicensed answer that continues keeps it.
    const kept = childReclaimNextEntry(joined, presence, ask(70_000, false, true), at(75_000), PASS)!;
    expect(kept).toMatchObject({ firstPresenceDeferredAt: 14_000, presenceHeldSince: 14_000 });
    // Arriving 160 001 after the previous request: a gap, so the episode restarts.
    const forfeit = childReclaimNextEntry(kept, presence, ask(200_000, false, true), at(230_001), PASS)!;
    expect(forfeit.firstPresenceDeferredAt).toBe(230_001);
    expect(forfeit.presenceHeldSince, 'the HOLDER forfeits the lease').toBeNull();
    const waited = childReclaimNextEntry(kept, presence, ask(200_000, false, false), at(230_001), PASS)!;
    expect(waited.firstPresenceDeferredAt).toBe(230_001);
    expect(waited.presenceHeldSince, 'a waiting member, asked as a non-holder, keeps its place').toBe(14_000);
    // A licensed presence answer clears it; the next unlicensed non-holder answer joins afresh, at the back.
    const licensed = childReclaimNextEntry(kept, presence, ask(130_000, true, true), at(131_000), PASS)!;
    expect(licensed.presenceHeldSince, 'a licensed presence answer leaves the line').toBeNull();
    const rejoined = childReclaimNextEntry(licensed, presence, ask(500_000, false), at(502_000), PASS)!;
    expect(rejoined.presenceHeldSince, 're-joins at its own arrival, at the back').toBe(502_000);
    // Every other outcome clears it — a holder's or not.
    const others: ChildReclaimSweepOutcome[] = [
      { kind: 'failed' }, { kind: 'refused', token: 'tree-unreadable' },
      ...['state-changed', 'paused', 'held', 'in-progress'].map((why): ChildReclaimSweepOutcome => ({ kind: 'deferred', why })),
    ];
    for (const outcome of others) {
      for (const asHolder of [true, false]) {
        expect(childReclaimNextEntry(kept, outcome, ask(130_000, false, asHolder), at(131_000), PASS)?.presenceHeldSince,
          `${JSON.stringify(outcome)}, asHolder ${asHolder}`).toBeNull();
      }
    }
  });

  it('P6: presenceHeldSince never reaches the licence — the lease decides who is asked, never what is licensed', () => {
    const now = 2_000_000;
    const e: ChildReclaimSweepEntry = { ...fresh, presenceHeldSince: now - 2 * C, firstPresenceDeferredAt: now,
      lastPresenceDeferredAt: now - 5_000, lastPresenceWallAt: now - 5_000 };
    expect(childReclaimDeferExpired(e, at(now), PASS)).toBe(false);
  });

  it('P7: continuity runs from the new answer\'s ARRIVAL back to the previous answer\'s REQUEST — inclusive at the gap', () => {
    const first = childReclaimNextEntry(fresh, presence, ask(0, false), at(10_000), PASS)!;   // its request at 0
    expect(childReclaimNextEntry(first, presence, ask(120_000, false), at(G), PASS), 'arriving at exactly the gap: continues')
      .toMatchObject({ firstPresenceDeferredAt: 10_000, lastPresenceDeferredAt: 120_000 });
    expect(childReclaimNextEntry(first, presence, ask(120_000, false), at(G + 1), PASS), 'one ms later: a NEW episode, at the arrival')
      .toMatchObject({ firstPresenceDeferredAt: G + 1, lastPresenceDeferredAt: 120_000 });
  });

  it('P8: the episode starts at its first answer\'s ARRIVAL, so the ceiling is never reached early by a slow first answer', () => {
    let e = childReclaimNextEntry(fresh, presence, ask(0, false), at(30_000), PASS)!;          // asked at 0, arrives 30 s later
    for (let q = PASS; q <= 840_000; q += PASS) e = childReclaimNextEntry(e, presence, ask(q, false, true), at(q), PASS)!;
    expect(childReclaimDeferExpired(e, at(900_000), PASS), 'a ceiling after the REQUEST').toBe(false);
    expect(childReclaimDeferExpired(e, at(929_999), PASS)).toBe(false);
    expect(childReclaimDeferExpired(e, at(930_000), PASS), 'a ceiling after the ARRIVAL').toBe(true);
    expect(e.firstPresenceDeferredAt).toBe(30_000);
  });

  it('P9: freshness at the ask reads the latest answer\'s REQUEST, never its arrival', () => {
    const X = 3 * C;
    const before: ChildReclaimSweepEntry = { ...fresh, firstPresenceDeferredAt: X - 2 * C, lastPresenceDeferredAt: X - PASS,
      lastPresenceWallAt: X - PASS, presenceHeldSince: X - 2 * C };
    const e = childReclaimNextEntry(before, presence, ask(X, false, true), at(X + 40_000), PASS)!;
    expect(e.firstPresenceDeferredAt, 'the episode continued: two ceilings old').toBe(X - 2 * C);
    expect(childReclaimDeferExpired(e, at(X + G + 1), PASS)).toBe(false);
    expect(childReclaimDeferExpired(e, at(X + G), PASS)).toBe(true);
  });

  it('P10: a backward wall step cannot hide a hole — the gap is the LARGER of the two clocks\' differences', () => {
    const m0 = 5 * C;
    const w0 = T0 + 5 * C;
    const running: ChildReclaimSweepEntry = { ...fresh, firstPresenceDeferredAt: m0 - 2 * C, lastPresenceDeferredAt: m0,
      lastPresenceWallAt: w0, presenceHeldSince: m0 - 2 * C };
    const reading = at(m0 + 200_000, w0 + 50_000);            // 200 s monotonic; the wall, stepped back, reads 50 s
    expect(childReclaimDeferExpired(running, reading, PASS), 'not fresh at the ask').toBe(false);
    const next = childReclaimNextEntry(running, presence, { at: reading, licensed: false, asHolder: true }, reading, PASS)!;
    expect(next.firstPresenceDeferredAt, 'the hole restarts the episode').toBe(m0 + 200_000);
    expect(childReclaimDeferExpired(next, reading, PASS)).toBe(false);
  });

  it('P11: a suspend cannot hide a hole — the monotonic clock stopped, the wall clock did not', () => {
    const m0 = 5 * C;
    const w0 = T0 + 5 * C;
    const running: ChildReclaimSweepEntry = { ...fresh, firstPresenceDeferredAt: m0 - 2 * C, lastPresenceDeferredAt: m0,
      lastPresenceWallAt: w0, presenceHeldSince: m0 - 2 * C };
    const reading = at(m0 + 60_000, w0 + 400_000);             // 60 s monotonic; 400 s on the wall
    expect(childReclaimDeferExpired(running, reading, PASS), 'not fresh at the ask').toBe(false);
    const next = childReclaimNextEntry(running, presence, { at: reading, licensed: false, asHolder: true }, reading, PASS)!;
    expect(next.firstPresenceDeferredAt, 'the hole restarts the episode').toBe(m0 + 60_000);
  });

  it('P12: the ceiling\'s span is the MONOTONIC clock alone — never a mix of the two clocks', () => {
    const start = 100_000;
    const wallOf = (m: number): ChildReclaimLaneNow => at(m, m + T0);    // distinct origins
    const e: ChildReclaimSweepEntry = { ...fresh, firstPresenceDeferredAt: start, lastPresenceDeferredAt: start + C - PASS,
      lastPresenceWallAt: start + C - PASS + T0 };
    expect(childReclaimDeferExpired(e, wallOf(start + C - 1), PASS)).toBe(false);
    expect(childReclaimDeferExpired(e, wallOf(start + C), PASS)).toBe(true);
    expect(childReclaimDeferExpired(e, at(start + C, start + C + T0 - 600_000), PASS), 'the wall stepped back 600 s')
      .toBe(true);
  });

  it('P13: firstDeferredAt is the WALL clock — the one entry field that is displayed — and every other stamp the monotonic one', () => {
    for (const why of [...CHILD_RECLAIM_PRESENCE_DEFERS, 'state-changed', 'held']) {
      const e = childReclaimNextEntry(fresh, { kind: 'deferred', why }, ask(5_000, false, false, T0 + 5_000),
        at(5_000, T0 + 5_000), PASS)!;
      expect(e, why).toMatchObject({ firstDeferredAt: T0 + 5_000, lastAskedAt: 5_000 });
    }
    expect(childReclaimNextEntry(fresh, presence, ask(5_000, false, false, T0 + 5_000), at(5_000, T0 + 5_000), PASS))
      .toMatchObject({ firstPresenceDeferredAt: 5_000, lastPresenceDeferredAt: 5_000, lastPresenceWallAt: T0 + 5_000,
        presenceHeldSince: 5_000 });
  });

  it('P14: one entry describes one workspace generation — a null birth never matches', () => {
    const e = childReclaimFirstSighting(5_000, BORN);
    expect(e.bornAt).toBe(BORN);
    expect(childReclaimSameGeneration(e, BORN)).toBe(true);
    expect(childReclaimSameGeneration(e, BORN + 1)).toBe(false);
    expect(childReclaimSameGeneration(e, null)).toBe(false);
    expect(childReclaimSameGeneration(childReclaimFirstSighting(5_000, null), null)).toBe(false);
  });
});

// S1 — the seeded policy harness (spec §5.7). The exported L1 functions,
// composed with a model of the lane: one slot, `watch.ts`'s
// `CHILD_RECLAIM_STALL_MS`, the in-flight rule, the entry-identity write-back
// guard and a rejection written as `failed` — over THREE clocks: true time,
// the monotonic clock (origin 5 000, frozen during a suspend) and the wall
// clock (origin T0). Every check below is in TRUE time. The model is a copy
// of the lane's loop, so it can drift from `watch.ts`; the lane suite's rows
// cross-check through the real watcher.
describe('S1: seeded interleavings of the lane model — every licence rests on presence observed continuously, and the lease bounds the wait', () => {
  const G = 2.5 * PASS;
  /** `watch.ts`'s `CHILD_RECLAIM_STALL_MS` and `CHILD_RECLAIM_MAX_IN_FLIGHT`, copied: this suite imports no L4 file. */
  const STALL = 480_000;
  const SLOTS = 1;
  const HOURS6 = 6 * 3_600_000;
  const MODES = ['none', 'back', 'back-hole', 'fwd-small', 'fwd-large', 'suspend', 'slow-tick', 'slow-answer',
    'breach', 'slow-persistent', 'reject'] as const;
  type Mode = typeof MODES[number];
  type Kind = 'presence' | 'state-changed' | 'reclaimed' | 'rejected';
  interface Req { readonly id: string; readonly pass: number; readonly q: number; readonly licensed: boolean }
  interface Ans { readonly id: string; readonly q: number; readonly a: number; readonly kind: Kind;
    readonly heldAfter: number | null | undefined }
  interface Run { readonly reqs: Req[]; readonly answers: Ans[]; readonly t2: number;
    readonly reclaimedAt: Map<string, number>; readonly ps: string[] }

  const simulate = (seed: number, n: number, mode: Mode): Run => {
    const rnd = mulberry32(seed * 7_919 + n * 131 + MODES.indexOf(mode));
    const uni = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
    const ps = Array.from({ length: n }, (_, k) => `p${k + 1}`);
    const listed = new Set<string>([...ps, 'r', 'x']);       // ids sort every p before r before x
    const k = uni(3, 3 + 16 * n);                            // the disturbance's pass
    let trueT = 0;
    let monoAdj = 0;
    let wallAdj = 0;
    const now = (): ChildReclaimLaneNow => ({ monoMs: 5_000 + trueT + monoAdj, wallMs: T0 + trueT + wallAdj });
    const entries = new Map<string, ChildReclaimSweepEntry>();
    const inFlight = new Map<string, number>();             // id → the request's monotonic instant
    const pending: { a: number; id: string; entry: ChildReclaimSweepEntry; ask: ChildReclaimAsk; q: number; kind: Kind }[] = [];
    const reqs: Req[] = [];
    const answers: Ans[] = [];
    const reclaimedAt = new Map<string, number>();
    let passN = 0;
    let t2 = 0;
    let p1Rejected = false;
    const settle = (upTo: number): void => {
      pending.sort((x, y) => x.a - y.a);
      while (pending.length > 0 && pending[0]!.a <= upTo) {
        const ev = pending.shift()!;
        trueT = ev.a;
        const answered = now();
        inFlight.delete(ev.id);
        if (ev.kind === 'reclaimed') { listed.delete(ev.id); reclaimedAt.set(ev.id, ev.a); }
        const outcome: ChildReclaimSweepOutcome = ev.kind === 'rejected' ? { kind: 'failed' }
          : ev.kind === 'reclaimed' ? { kind: 'reclaimed' } : { kind: 'deferred', why: ev.kind };
        // The lane's identity guard: write back only while the entry is the live one.
        if (entries.get(ev.id) === ev.entry) {
          const next = childReclaimNextEntry(ev.entry, outcome, ev.ask, answered, PASS);
          if (next === null) entries.delete(ev.id);
          else entries.set(ev.id, next);
        }
        answers.push({ id: ev.id, q: ev.q, a: ev.a, kind: ev.kind, heldAfter: entries.get(ev.id)?.presenceHeldSince });
      }
    };
    const pass = (): void => {
      passN += 1;
      if (passN === 2) t2 = trueT;
      const asked = now();
      for (const id of [...entries.keys()]) if (!listed.has(id)) entries.delete(id);
      const due: { id: string; entry: ChildReclaimSweepEntry }[] = [];
      for (const id of [...listed].sort()) {
        const entry = entries.get(id);
        if (entry === undefined || !childReclaimSameGeneration(entry, BORN)) {
          entries.set(id, childReclaimFirstSighting(asked.monoMs, BORN));
          continue;
        }
        if (inFlight.has(id)) continue;
        if (!childReclaimDue(entry, asked.monoMs, PASS)) continue;
        due.push({ id, entry });
      }
      let active = 0;
      for (const since of inFlight.values()) if (asked.monoMs - since < STALL) active += 1;
      const { order, holderId } = childReclaimAskOrder(due);
      for (const { id, entry } of order.slice(0, Math.max(0, SLOTS - active))) {
        const a: ChildReclaimAsk = { at: asked, licensed: childReclaimDeferExpired(entry, asked, PASS), asHolder: id === holderId };
        reqs.push({ id, pass: passN, q: trueT, licensed: a.licensed });
        inFlight.set(id, asked.monoMs);
        let kind: Kind;
        let latency: number;
        if (id === 'r') { kind = 'reclaimed'; latency = uni(5_000, 45_000); }
        else if (id === 'x') { kind = 'state-changed'; latency = uni(0, 10_000); }
        else if (!a.licensed || mode === 'breach') { kind = 'presence'; latency = uni(0, 10_000); }
        else if (mode === 'reject' && id === 'p1' && !p1Rejected) { p1Rejected = true; kind = 'rejected'; latency = uni(0, 10_000); }
        else { kind = 'reclaimed'; latency = uni(5_000, 45_000); }
        if (mode === 'slow-answer' && passN === k) latency += 120_000;
        pending.push({ a: trueT + latency, id, entry, ask: a, q: trueT, kind });
      }
    };
    const done = (): boolean => mode !== 'breach' && ps.every((p) => reclaimedAt.has(p)) && reclaimedAt.has('r');
    pass();                                                   // pass 1, at true time 0: every child sighted
    while (trueT < HOURS6) {
      const i = passN + 1;
      let spacing = mode === 'slow-persistent' ? 160_000 : uni(60_000, 80_000);
      if ((mode === 'back-hole' || mode === 'slow-tick') && i === k) spacing = 200_000;
      if (mode === 'suspend' && i === k) spacing += 300_000;  // true time runs on; the monotonic clock is frozen for 300 s
      const tNext = trueT + spacing;
      settle(tNext);
      if (done()) break;
      trueT = tNext;
      if (i === k) {
        if (mode === 'back' || mode === 'back-hole') wallAdj -= 600_000;
        if (mode === 'fwd-small') wallAdj += 60_000;
        if (mode === 'fwd-large') wallAdj += 600_000;
        if (mode === 'suspend') monoAdj -= 300_000;
      }
      pass();
    }
    return { reqs, answers, t2, reclaimedAt, ps };
  };

  /** (i): the licensed request at T rests on a suffix s_1…s_m of the child's
   *  consecutive presence answers ending at its latest answer before T, with
   *  T − a(s_1) ≥ C, a(s_{i+1}) − q(s_i) ≤ G and T − q(s_m) ≤ G. */
  const chainBroken = (run: Run, id: string, T: number): boolean => {
    const mine = run.answers.filter((x) => x.id === id && x.a <= T);
    const m = mine.length - 1;
    if (m < 0 || mine[m]!.kind !== 'presence' || T - mine[m]!.q > G) return true;
    let s = m;
    while (s > 0 && mine[s - 1]!.kind === 'presence' && mine[s]!.a - mine[s - 1]!.q <= G) s -= 1;
    return T - mine[s]!.a < C;
  };

  const check = (seed: number, n: number, mode: Mode): string[] => {
    const run = simulate(seed, n, mode);
    const out: string[] = [];
    const tag = `seed ${seed}, N ${n}, ${mode}`;
    const lic = run.reqs.filter((q) => q.licensed && q.id.startsWith('p'));
    // (i) every mode, the breaches included.
    for (const q of lic) if (chainBroken(run, q.id, q.q)) out.push(`${tag}: (i) ${q.id}'s licence at ${q.q} rests on a broken chain`);
    // (ii) every mode: two licences of one child at least a ceiling apart.
    for (const p of run.ps) {
      const ts = lic.filter((q) => q.id === p).map((q) => q.q);
      for (let j = 1; j < ts.length; j += 1) {
        if (ts[j]! - ts[j - 1]! < C) out.push(`${tag}: (ii) ${p} licensed twice ${ts[j]! - ts[j - 1]!} ms apart`);
      }
    }
    const firstLicence = (p: string): number | undefined => lic.find((q) => q.id === p)?.q;
    const lastLicence = (p: string): number | undefined => lic.filter((q) => q.id === p).at(-1)?.q;
    const rAt = run.reclaimedAt.get('r');
    if (mode === 'none' || mode === 'back') {
      // (iii) licences in id order, the k-th by t_2 + k × (C + L_p + 2S).
      const firsts = run.ps.map(firstLicence);
      run.ps.forEach((p, j) => {
        const t = firsts[j];
        if (t === undefined) { out.push(`${tag}: (iii) ${p} never licensed`); return; }
        if (t > run.t2 + (j + 1) * 1_070_000) out.push(`${tag}: (iii) ${p} licensed at t2+${t - run.t2}`);
        if (j > 0 && firsts[j - 1] !== undefined && t <= firsts[j - 1]!) out.push(`${tag}: (iii) ${p} licensed out of id order`);
      });
      if (rAt === undefined || rAt > run.t2 + n * 1_070_000 + 45_000) out.push(`${tag}: (iii) r reclaimed at ${String(rAt)}`);
    } else if (mode === 'breach') {
      // (v) the reclaimable child is reached within six hours.
      if (rAt === undefined || rAt > HOURS6) out.push(`${tag}: (v) r not reclaimed within 6 h`);
    } else if (mode === 'slow-persistent') {
      // (vi) no p licensed; r asked at pass 2N + 2 and reclaimed; each p joins at its first ask, forfeits at its second.
      if (lic.length > 0) out.push(`${tag}: (vi) a presence-held child was licensed`);
      const rFirst = run.reqs.find((q) => q.id === 'r');
      if (rFirst?.pass !== 2 * n + 2 || rAt === undefined) out.push(`${tag}: (vi) r first asked at pass ${String(rFirst?.pass)}`);
      for (const p of run.ps) {
        const mine = run.answers.filter((x) => x.id === p);
        if ((mine[0]?.heldAfter ?? null) === null) out.push(`${tag}: (vi) ${p} did not join at its first ask`);
        if (mine[1]?.heldAfter !== null) out.push(`${tag}: (vi) ${p} did not forfeit at its second ask`);
      }
    } else {
      // (iv) every p licensed and r reclaimed by t_2 + (N + 1) × (C + 2G + STALL) + 550 000.
      const bound = run.t2 + (n + 1) * 1_680_000 + 550_000;
      for (const p of run.ps) {
        const t = lastLicence(p);
        if (t === undefined || !run.reclaimedAt.has(p) || t > bound) out.push(`${tag}: (iv) ${p} licensed at ${String(t)}`);
      }
      if (rAt === undefined || rAt > bound) out.push(`${tag}: (iv) r reclaimed at ${String(rAt)}`);
    }
    return out;
  };

  it.each(MODES)('S1 %s: seeds 1–50 × N = 1–6', (mode) => {
    const violations: string[] = [];
    for (let n = 1; n <= 6; n += 1) for (let seed = 1; seed <= 50; seed += 1) violations.push(...check(seed, n, mode));
    expect(violations).toEqual([]);
  });
});

/** One mirrored journal row of session `demo-a` — every field
 *  `MirroredLifecycleEvent` carries, so the literal is the type's, not a cast. */
const ev = (act: LifecycleAct, outcome: LifecycleOutcome, over: Partial<MirroredLifecycleEvent> = {}):
  MirroredLifecycleEvent => ({
  uid: null, at: NOW, act, badact: null, outcome, badoutcome: null, id: 'demo-a', tx: null,
  verb: act === 'create' ? 'ws-add' : 'ws-reclaim', refusal: null, detail: null, truncated: false,
  obs: null, dec: null, meas: null, raw: '', gen: '1', ingestedAt: NOW + 5, ...over,
});

describe('childReclaimJournalRow — one generation\'s latest reclaim event, as the attention input row', () => {
  it('null when the generation has no latest reclaim event', () => {
    expect(childReclaimJournalRow([ev('create', 'done')], null)).toBeNull();
  });

  it('carries a refusal as it is, with no failure run', () => {
    const gen = [ev('create', 'done'), ev('reclaim', 'refused', { refusal: 'tree-unreadable' })];
    // `toEqual`, so the row's WHOLE shape is pinned: it carries no `ingestedAt`.
    expect(childReclaimJournalRow(gen, gen[1]!)).toEqual({ sessionId: 'demo-a', outcome: 'refused',
      refusal: 'tree-unreadable', at: NOW, failingSince: null });
  });

  it('carries an INTENT when the intent is the latest — the latest event decides, whatever its outcome', () => {
    const gen = [ev('reclaim', 'refused', { refusal: 'tree-unreadable' }), ev('reclaim', 'intent', { at: NOW + 1 })];
    expect(childReclaimJournalRow(gen, gen[1]!)).toMatchObject({ outcome: 'intent', refusal: null, failingSince: null });
  });

  it('a latest FAILURE carries when its unbroken run of failures began — intents and other acts do not break it', () => {
    const gen = [
      ev('reclaim', 'intent', { at: NOW }), ev('reclaim', 'failed', { at: NOW + 1, refusal: 'pin-failed' }),
      ev('reclaim', 'intent', { at: NOW + 2 }), ev('hold', 'done', { at: NOW + 3 }),
      ev('reclaim', 'failed', { at: NOW + 4, refusal: 'unit-still-active' }),
    ];
    expect(childReclaimJournalRow(gen, gen[4]!))
      .toMatchObject({ outcome: 'failed', refusal: 'unit-still-active', failingSince: NOW + 1 });
  });

  it('any other reclaim outcome ends the run: only the failures after it count', () => {
    const gen = [
      ev('reclaim', 'failed', { at: NOW, refusal: 'pin-failed' }), ev('reclaim', 'refused', { at: NOW + 1, refusal: 'attached' }),
      ev('reclaim', 'failed', { at: NOW + 2, refusal: 'pin-failed' }),
    ];
    expect(childReclaimJournalRow(gen, gen[2]!)).toMatchObject({ failingSince: NOW + 2 });
  });

  // `ingestedAt` is the server's clock and never an event time: a
  // failure line with no `at` cannot be placed, so it starts no failure clock
  // — it is read past, and the run's clock is its earliest PLACED failure.
  it('a failure with no ccd clock starts no failure clock — never placed by its ingest time', () => {
    const lone = [ev('reclaim', 'failed', { at: null, ingestedAt: NOW + 7, refusal: 'pin-failed' })];
    expect(childReclaimJournalRow(lone, lone[0]!)).toMatchObject({ at: null, failingSince: null });
    const run = [
      ev('reclaim', 'failed', { at: null, ingestedAt: NOW + 1, refusal: 'pin-failed' }),
      ev('reclaim', 'failed', { at: NOW + 4, refusal: 'pin-failed' }),
    ];
    expect(childReclaimJournalRow(run, run[1]!)).toMatchObject({ at: NOW + 4, failingSince: NOW + 4 });
  });
});

const KIND: Record<string, ChildReclaimTokenKind> = {
  'tree-unreadable': 'terminal', 'containment-unproven': 'terminal', attached: 'retry', 'no-such-session': 'gone',
};
const kindOf = (t: string): ChildReclaimTokenKind | null => KIND[t] ?? null;

describe('childReclaimAttention', () => {
  // The mirror rows and the live registry map are the WHOLE input (spec §5.9:
  // "derived from the lifecycle mirror so a restart does not lose it"): there
  // is no in-memory source to merge, so a restart loses nothing.
  const input = (latest: ChildReclaimJournalRow[], live: [string, number | null][], nowMs = NOW) => ({
    latest,
    live: new Map(live),
    kindOf,
    sentenceFor: (t: string): string => `sentence for ${t}`,
    nowMs,
  });
  const row = (over: Partial<ChildReclaimJournalRow> = {}): ChildReclaimJournalRow => ({
    sessionId: 'demo-a', outcome: 'refused', refusal: 'tree-unreadable', at: NOW, failingSince: null, ...over,
  });

  it('reports a terminal refusal of a child whose registry row still exists, with the SERVER\'s sentence', () => {
    expect(childReclaimAttention(input([row()], [['demo-a', 7]]))).toEqual([
      { kind: 'terminal', sessionId: 'demo-a', runId: 7, token: 'tree-unreadable', sentence: 'sentence for tree-unreadable', at: NOW },
    ]);
  });

  it('drops a child whose registry row is gone — reclaimed since, or reaped', () => {
    expect(childReclaimAttention(input([row()], [['demo-b', 9]]))).toEqual([]);
    expect(childReclaimAttention(input([row({ outcome: 'failed', failingSince: NOW - C })], [['demo-b', 9]])))
      .toEqual([]);
  });

  it('drops a retryable refusal, a gone token, and a token this build does not know', () => {
    expect(childReclaimAttention(input([
      row({ refusal: 'attached' }), row({ sessionId: 'demo-b', refusal: 'no-such-session' }),
      row({ sessionId: 'demo-c', refusal: 'from-a-newer-ccd' }),
    ], [['demo-a', 7], ['demo-b', 8], ['demo-c', 9]]))).toEqual([]);
  });

  it('drops an outcome that is neither a refusal nor a failure — an INTENT above all — and a refusal row with no token', () => {
    expect(childReclaimAttention(input([
      row({ outcome: 'done', refusal: null }), row({ sessionId: 'demo-b', outcome: 'intent', refusal: null }),
      row({ sessionId: 'demo-c', refusal: null }),
    ], [['demo-a', 7], ['demo-b', 8], ['demo-c', 9]]))).toEqual([]);
  });

  it('carries a null run id when the marker no longer reads as a child', () => {
    expect(childReclaimAttention(input([row()], [['demo-a', null]]))).toEqual([
      { kind: 'terminal', sessionId: 'demo-a', runId: null, token: 'tree-unreadable', sentence: 'sentence for tree-unreadable', at: NOW },
    ]);
  });

  // Only ccd's own `at` places a line in time; the mirror's ingest time is the
  // server's clock and never an event time. A latest line with no `at`
  // cannot say since when, so it is not listed — a terminal refusal, or a
  // failure whose run ccd DID place (`failingSince` is set) alike.
  it('never lists a child whose latest line carried no ccd clock — a terminal refusal or a failure past the ceiling', () => {
    expect(childReclaimAttention(input([
      row({ at: null }),
      row({ sessionId: 'demo-b', outcome: 'failed', refusal: 'purge-refused', at: null, failingSince: NOW - C }),
    ], [['demo-a', 7], ['demo-b', 8]]))).toEqual([]);
  });

  // Spec §5.9: "children whose reclaim has kept failing past the defer
  // ceiling (retries back off in between), with each one's sentence".
  it('lists a child whose reclaim has kept FAILING for the whole ceiling, with the failure\'s sentence and since when', () => {
    const since = NOW - C;
    expect(childReclaimAttention(input([row({ outcome: 'failed', refusal: 'purge-refused', failingSince: since })],
      [['demo-a', 7]]))).toEqual([{ kind: 'failing', sessionId: 'demo-a', runId: 7, token: 'purge-refused',
      sentence: childReclaimFailingSentence(LC_REFUSAL_WORD['purge-refused']), at: since }]);
  });

  it('…not one millisecond before the ceiling, and never a failure row that carries no run start', () => {
    expect(childReclaimAttention(input([
      row({ outcome: 'failed', refusal: 'purge-refused', failingSince: NOW - C + 1 }),
      row({ sessionId: 'demo-b', outcome: 'failed', refusal: 'purge-refused', failingSince: null }),
    ], [['demo-a', 7], ['demo-b', 8]]))).toEqual([]);
  });

  // The sentence's own words, pinned literally: the list is shown while
  // reclamation is paused or unsupported too, when nothing retries, so the
  // retry is stated as conditional — never "ccrc keeps retrying".
  it('the failing sentence states the retry as conditional on reclamation running', () => {
    expect(childReclaimFailingSentence('W.')).toBe(
      'Every attempt to reclaim this child has failed for at least 15 minutes. '
      + 'While automatic reclamation is running, ccrc retries it, backing off in between. '
      + 'The last failure: W.');
    expect(childReclaimFailingSentence(null)).toMatch(/The last failure: ccd recorded no reason\.$/);
  });

  it('a failure word outside the journal-only map takes the server\'s sentence; no word at all says so', () => {
    const since = NOW - C;
    expect(childReclaimAttention(input([
      row({ outcome: 'failed', refusal: 'branch-moved', failingSince: since }),
      row({ sessionId: 'demo-b', outcome: 'failed', refusal: null, failingSince: since }),
    ], [['demo-a', 7], ['demo-b', 8]])).map((a) => [a.token, a.sentence])).toEqual([
      ['branch-moved', childReclaimFailingSentence('sentence for branch-moved')],
      ['', childReclaimFailingSentence(null)],
    ]);
  });
});

// ONE table classes every word the sweep can skip a marked child with (spec §5.9: the chip
// and the banner read the CLASS — a kept word is a standing answer, a doubt word a read that
// failed, a held word a hold, and an ordinary word is one the chip's own planned rows say).
describe('CHILD_RECLAIM_SKIP — every skip word classed exactly once, with its sentence', () => {
  const classOf = (c: string): string[] =>
    Object.entries(CHILD_RECLAIM_SKIP).filter(([, r]) => r.class === c).map(([w]) => w).sort();
  const sentenceOf = (w: string): string => {
    const row = (CHILD_RECLAIM_SKIP as Readonly<Record<string, { readonly class: string; readonly sentence?: string }>>)[w];
    return row?.sentence ?? '';
  };
  const KEPT_ENDING = 'ccrc never reclaims it on its own; a person removes it once nothing still needs it.';
  const MARKER_ENDING = 'ccrc never reclaims it on its own; a person removes the marker, never the checkout.';
  const REBUILD = 'After a rebuild, workers may still be running in these.';
  const DOUBT = ['hold-unmeasured', 'identity-unmeasured', 'marker-unreadable', 'minting-run-unreadable',
    'reviewed-run-unreadable', 'siblings-unreadable'];
  const ORDINARY = ['dispatch-in-flight', 'hold-retired', 'minting-run-open', 'not-a-child', 'review-report-live',
    'siblings-open', 'terminal-refusal'];

  it('each class is exactly its words', () => {
    expect(classOf('kept')).toEqual([...CHILD_RECLAIM_KEPT_WORDS].sort());
    expect(classOf('doubt')).toEqual(DOUBT);
    expect(classOf('held')).toEqual(['held']);
    expect(classOf('ordinary')).toEqual(ORDINARY);
    // Guards the guard: a class no word has would equal an empty expectation.
    expect(CHILD_RECLAIM_KEPT_WORDS.length).toBeGreaterThan(0);
  });

  // `.sentence` compiling over the L0 word type IS a check: a kept word whose row is `ordinary` is TS2339.
  const keptSentenceOf = (w: ChildReclaimKeptWord): string => CHILD_RECLAIM_SKIP[w].sentence;

  it('the kept sentences end as the spec has them, and the two minting-run words alone say a rebuild may have left workers running', () => {
    for (const w of CHILD_RECLAIM_KEPT_WORDS) {
      const s = keptSentenceOf(w);
      expect(s, w).toBe(sentenceOf(w));
      expect(s.endsWith(w === 'not-a-workspace' ? MARKER_ENDING : KEPT_ENDING), w).toBe(true);
    }
    const rebuild = Object.keys(CHILD_RECLAIM_SKIP).filter((w) => sentenceOf(w).includes(REBUILD)).sort();
    expect(rebuild).toEqual(['minting-run-absent', 'minting-run-postdates-child']);
    // The rebuild sentence comes directly BEFORE the ending, not after it.
    for (const w of rebuild) expect(sentenceOf(w).endsWith(`${REBUILD} ${KEPT_ENDING}`), w).toBe(true);
  });

  it('every doubt sentence ends with the sweep reading again, and the held sentence is said', () => {
    for (const w of DOUBT) expect(sentenceOf(w).endsWith('on its next pass.'), w).toBe(true);
    expect(sentenceOf('held').length).toBeGreaterThan(0);
  });

  it('a classed word says its sentence, an ordinary word has none, and an apostrophe is the curly one', () => {
    for (const [w, row] of Object.entries(CHILD_RECLAIM_SKIP)) {
      if (row.class === 'ordinary') expect('sentence' in row, w).toBe(false);
      else {
        expect(sentenceOf(w).length, w).toBeGreaterThan(0);
        expect(sentenceOf(w), w).not.toContain("'");
      }
    }
  });

  // `coordinating` names an open claim, an unplaceable claim, or a claim that ended at or after
  // this generation's birth less the skew — never "has ever coordinated" — so its sentence must
  // not say "ever" as a word.
  it('the coordinating sentence does not say "ever" — the word is fenced to this workspace\'s generation', () => {
    expect(sentenceOf('coordinating')).not.toMatch(/\bever\b/);
  });

  // Structural, as `single-definition.test.ts` is: a second table keyed by the skip words is a
  // second place to class a word, and two tables disagree silently.
  it('is the ONLY table keyed by the skip words — one `Record<…>` over them in server/src', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = path.resolve(here, '..', 'src');
    // `__`-prefixed entries are transient mutants another suite writes (`single-definition.test.ts`).
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
      if (e.startsWith('__')) return [];
      const p = path.join(dir, e);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
    });
    const needle = 'Record<ChildReclaimSweepSkip';
    const holders = walk(src).filter((f) => readFileSync(f, 'utf8').includes(needle))
      .map((f) => path.relative(src, f).split(path.sep).join('/'));
    expect(holders).toEqual(['childReclaimSweep.ts']);
  });
});

// What a pass that judged nothing keeps of the sweep's last verdicts (spec §5.9): the KEPT words
// alone, because each ends only by a person's act or a restored coordination database, so a raised
// switch, a missing capability or a failed read does not make it untrue. Every other verdict is
// dropped, and after such a pass reads "no verdict yet", never eligible.
describe('childReclaimKeptVerdicts — what a pass that judged nothing keeps (spec §5.9)', () => {
  it('(p1) keeps exactly the kept words, with their verdicts', () => {
    const release = { reason: 'program:demo wave:2/3 run:7', program: 'demo', accountedRunId: 7 };
    const a: ChildReclaimSweepVerdict = { eligible: false, why: 'coordinating' };
    const e: ChildReclaimSweepVerdict = { eligible: false, why: 'minting-run-absent' };
    const verdicts = new Map<string, ChildReclaimSweepVerdict>([
      ['a', a],
      ['b', { eligible: true, runId: 7 }],
      ['c', { eligible: false, why: 'held' }],
      ['d', { eligible: false, why: 'hold-unmeasured' }],
      ['e', e],
      ['f', { eligible: false, why: 'hold-retired', runId: 7, release }],
    ]);
    expect(childReclaimKeptVerdicts(verdicts)).toEqual(new Map([['a', a], ['e', e]]));
    expect([...childReclaimKeptVerdicts(verdicts).keys()]).toEqual(['a', 'e']);
  });
});

describe('childReclaimFailureLine — the one reading of "a line of a run of failures" (spec §5.9)', () => {
  const line = (outcome: string, refusal: string | null) => ({ outcome, refusal });

  it.each([
    ['failed', null, true],
    ['failed', 'pin-failed', true],
    ['refused', 'flock-unavailable', true],
    ['refused', 'lock-unopenable', true],
    ['refused', 'held', false],
    ['refused', 'containment-unproven', false],
    // A journal-only token outside the two is NOT a failure line: a token ccd journals under
    // `reclaim` later is classified when it is added, never inherited.
    ['refused', 'bad-session-id', false],
    ['refused', 'from-a-newer-ccd', false],
    ['refused', null, false],
    ['done', null, false],
    ['intent', null, false],
  ] as const)('%s %s -> %s', (outcome, refusal, expected) => {
    expect(childReclaimFailureLine(line(outcome, refusal))).toBe(expected);
  });

  it('the pre-lock tokens are exactly the two lock dies, each a word ccd journals', () => {
    expect(Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN).sort()).toEqual(['flock-unavailable', 'lock-unopenable']);
    for (const t of Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN)) {
      expect(isLcRefusalToken(t), t).toBe(true);
      expect(isChildReclaimPreLockToken(t), t).toBe(true);
    }
  });

  it('isChildReclaimPreLockToken admits no other string and no non-string', () => {
    for (const v of ['held', 'bad-session-id', '', 'flock', 'constructor', null, undefined, 7, {}]) {
      expect(isChildReclaimPreLockToken(v), String(v)).toBe(false);
    }
  });
});

describe('a run of pre-lock refusals is a failure run, listed like any other (spec §5.9)', () => {
  const C = CHILD_RECLAIM_DEFER_CEILING_MS;
  const A = NOW;
  const live = new Map<string, number | null>([['demo-a', 7]]);
  const attentionOf = (gen: MirroredLifecycleEvent[], nowMs: number) => {
    const latest = gen[gen.length - 1]!;
    const row = childReclaimJournalRow(gen, latest);
    expect(row).not.toBeNull();
    return { row: row!, list: childReclaimAttention({
      latest: [row!], live, kindOf: childReclaimTokenKind, sentenceFor: (t) => `sentence for ${t}`, nowMs }) };
  };

  it('two refusals a ceiling apart: the run started at the first, and the child is listed with that line', () => {
    const gen = [
      ev('create', 'done', { at: A - 1 }),
      ev('reclaim', 'refused', { at: A, refusal: 'flock-unavailable' }),
      ev('reclaim', 'refused', { at: A + C, refusal: 'flock-unavailable' }),
    ];
    const { row, list } = attentionOf(gen, A + C);
    expect(row.failingSince).toBe(A);
    expect(childReclaimFailingPastCeiling(row, A + C)).toBe(true);
    expect(childReclaimFailingPastCeiling(row, A + C - 1)).toBe(false);
    expect(list).toEqual([{ kind: 'failing', sessionId: 'demo-a', runId: 7, token: 'flock-unavailable',
      sentence: childReclaimFailingSentence(LC_REFUSAL_WORD['flock-unavailable']), at: A }]);
  });

  it('a failure and a refusal of the lock die are ONE run: the walk reads past an `intent` and does not stop at the refusal', () => {
    const gen = [
      ev('create', 'done', { at: A - 1 }),
      ev('reclaim', 'failed', { at: A, refusal: 'pin-failed' }),
      ev('reclaim', 'intent', { at: A + 30_000 }),
      ev('reclaim', 'refused', { at: A + 60_000, refusal: 'lock-unopenable' }),
    ];
    expect(attentionOf(gen, A + 60_000).row.failingSince).toBe(A);
  });

  it('a latest `refused held` lists nothing, and starts no run', () => {
    const gen = [
      ev('create', 'done', { at: A - 1 }),
      ev('reclaim', 'refused', { at: A, refusal: 'flock-unavailable' }),
      ev('reclaim', 'refused', { at: A + C, refusal: 'held' }),
    ];
    const { row, list } = attentionOf(gen, A + C);
    expect(row.failingSince).toBeNull();
    expect(list).toEqual([]);
  });

  it('a settled refusal between two lock dies ends the run', () => {
    const gen = [
      ev('create', 'done', { at: A - 1 }),
      ev('reclaim', 'refused', { at: A, refusal: 'flock-unavailable' }),
      ev('reclaim', 'refused', { at: A + 1, refusal: 'held' }),
      ev('reclaim', 'refused', { at: A + C, refusal: 'flock-unavailable' }),
    ];
    const { row, list } = attentionOf(gen, A + C);
    expect(row.failingSince).toBe(A + C);
    expect(list).toEqual([]);
  });
});

describe('a pre-lock refusal is a failure line, never a terminal refusal (spec §5.9)', () => {
  const refusal = (token: string): ChildReclaimJournalRow =>
    ({ sessionId: 'demo-a', outcome: 'refused', refusal: token, at: NOW, failingSince: null });

  it('childReclaimTerminalRefusal is false for each lock token, under the real kind map and a test one', () => {
    for (const t of Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN)) {
      expect(childReclaimTerminalRefusal(refusal(t), childReclaimTokenKind), t).toBe(false);
      expect(childReclaimTerminalRefusal(refusal(t), kindOf), t).toBe(false);
    }
    // Guards the guard: the predicate still answers true for a terminal token.
    expect(childReclaimTerminalRefusal(refusal('tree-unreadable'), kindOf)).toBe(true);
  });
});

// The attention list's kept arm (spec §5.9): the children the sweep keeps on purpose, from the
// verdicts it recorded, filtered to the current listing; the collapse a lost database needs; and
// the one-item-per-child rule that lets a kept item replace a failing one and a held child go
// unlisted by the failing arm. Pure: every input is an argument.
describe('the attention list\'s kept arm (spec §5.9)', () => {
  const ELIGIBLE: ChildReclaimSweepVerdict = { eligible: true, runId: 7 };
  const skipped = (why: Exclude<ChildReclaimSweepSkip, 'hold-retired'>): ChildReclaimSweepVerdict =>
    ({ eligible: false, why });
  const verdictsOf = (rows: readonly (readonly [string, ChildReclaimSweepVerdict])[]) =>
    new Map<string, ChildReclaimSweepVerdict>(rows);
  /** Every id listed as a child of run 7 unless told otherwise. */
  const listed = (ids: readonly string[], runId: number | null = 7) =>
    new Map<string, number | null>(ids.map((id): [string, number | null] => [id, runId]));
  const terminalFor = (sessionId: string): ChildReclaimJournalAttention =>
    ({ kind: 'terminal', sessionId, runId: 7, token: 'tree-unreadable', sentence: 'sentence for tree-unreadable', at: NOW });
  const failingFor = (sessionId: string): ChildReclaimJournalAttention =>
    ({ kind: 'failing', sessionId, runId: 7, token: 'pin-failed', sentence: 'sentence for pin-failed', at: NOW });
  const keptFor = (sessionId: string, word: ChildReclaimKeptWord, runId = 7): ChildReclaimKeptAttention =>
    ({ kind: 'kept', sessionId, runId, word, sentence: CHILD_RECLAIM_SKIP[word].sentence });

  it('(i) lists exactly the verdicts that are not eligible AND answer a kept word', () => {
    const verdicts = verdictsOf([
      ['a', skipped('coordinating')], ['b', skipped('hold-unmeasured')], ['c', skipped('held')],
      ['d', skipped('review-report-live')], ['e', ELIGIBLE],
    ]);
    expect(childReclaimKeptItems({ verdicts, live: listed(['a', 'b', 'c', 'd', 'e']), mirrorArms: [] })).toEqual([
      { kind: 'kept', sessionId: 'a', runId: 7, word: 'coordinating', sentence: CHILD_RECLAIM_SKIP.coordinating.sentence },
    ]);
  });

  it('(i) every kept word is listed, and its sentence is the sweep table\'s own', () => {
    const verdicts = verdictsOf(CHILD_RECLAIM_KEPT_WORDS.map((w, n): [string, ChildReclaimSweepVerdict] =>
      [`k${n}`, skipped(w)]));
    const items = childReclaimKeptItems({ verdicts, live: listed([...verdicts.keys()]), mirrorArms: [] });
    expect(items.map((a) => a.word)).toEqual([...CHILD_RECLAIM_KEPT_WORDS]);
    for (const a of items) expect(a.sentence, a.word).toBe(CHILD_RECLAIM_SKIP[a.word].sentence);
  });

  it('(i) the items are ordered by session id, whatever order the verdicts were recorded in', () => {
    const verdicts = verdictsOf([['c', skipped('coordinating')], ['a', skipped('coordinating')], ['b', skipped('coordinating')]]);
    expect(childReclaimKeptItems({ verdicts, live: listed(['a', 'b', 'c']), mirrorArms: [] }).map((a) => a.sessionId))
      .toEqual(['a', 'b', 'c']);
  });

  it('(ii) a child with a TERMINAL item gets no kept item; a failing item does not suppress one', () => {
    const verdicts = verdictsOf([['a', skipped('coordinating')]]);
    const live = listed(['a']);
    expect(childReclaimKeptItems({ verdicts, live, mirrorArms: [terminalFor('a')] })).toEqual([]);
    expect(childReclaimKeptItems({ verdicts, live, mirrorArms: [failingFor('a')] })).toEqual([keptFor('a', 'coordinating')]);
    // A terminal item for ANOTHER child changes nothing for this one.
    expect(childReclaimKeptItems({ verdicts, live, mirrorArms: [terminalFor('b')] })).toEqual([keptFor('a', 'coordinating')]);
  });

  it('(iii) a verdict whose row is not listed, or no longer a child, lists nothing', () => {
    const verdicts = verdictsOf([['a', skipped('coordinating')], ['b', skipped('coordinating')]]);
    expect(childReclaimKeptItems({ verdicts, live: new Map(), mirrorArms: [] })).toEqual([]);
    expect(childReclaimKeptItems({ verdicts, live: new Map<string, number | null>([['a', null], ['b', 7]]), mirrorArms: [] }))
      .toEqual([keptFor('b', 'coordinating')]);
  });

  it('(iii) an item carries the run id the listing\'s own marker names, not any other', () => {
    const verdicts = verdictsOf([['a', skipped('minting-run-absent')]]);
    expect(childReclaimKeptItems({ verdicts, live: listed(['a'], 9999), mirrorArms: [] }))
      .toEqual([keptFor('a', 'minting-run-absent', 9999)]);
  });

  it('(iv) more than five children answering one kept word collapse into ONE line that names them', () => {
    expect(CHILD_RECLAIM_KEPT_MANY_OVER).toBe(5);
    const six = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
    const items = [
      ...six.map((id) => keptFor(id, 'minting-run-absent', 9999)),
      keptFor('c1', 'coordinating'),
    ];
    expect(childReclaimKeptList(items)).toEqual([
      keptFor('c1', 'coordinating'),
      { kind: 'kept-many', word: 'minting-run-absent',
        members: six.map((sessionId) => ({ sessionId, runId: 9999 })),
        sentence: childReclaimKeptManySentence('minting-run-absent', 6) },
    ]);
  });

  it('(iv) five children answering one kept word stay five single items', () => {
    const five = ['m1', 'm2', 'm3', 'm4', 'm5'];
    const items = five.map((id) => keptFor(id, 'minting-run-absent', 9999));
    expect(childReclaimKeptList(items)).toEqual(items);
  });

  it('(iv) the singles are ordered by session id across words, not grouped by word', () => {
    expect(childReclaimKeptList([keptFor('b', 'coordinating'), keptFor('a', 'not-a-workspace'), keptFor('c', 'coordinating')]))
      .toEqual([keptFor('a', 'not-a-workspace'), keptFor('b', 'coordinating'), keptFor('c', 'coordinating')]);
  });

  it('(iv) the count is per WORD: six children over two words stay single', () => {
    const items = [
      ...['a1', 'a2', 'a3'].map((id) => keptFor(id, 'coordinating')),
      ...['b1', 'b2', 'b3'].map((id) => keptFor(id, 'minting-run-absent', 9999)),
    ];
    expect(childReclaimKeptList(items)).toEqual(items);
  });

  it('(iv) two collapsed words follow the singles, in the order of the word list; members are ordered by session id', () => {
    const six = (word: ChildReclaimKeptWord, prefix: string) =>
      ['6', '5', '4', '3', '2', '1'].map((n) => keptFor(`${prefix}${n}`, word));
    const out = childReclaimKeptList([
      ...six('not-a-workspace', 'w'), keptFor('s1', 'child-birth-unplaced'), ...six('coordinating', 'c'),
    ]);
    expect(out.map((a) => (a.kind === 'kept-many' ? `many:${a.word}` : `${a.kind}:${'sessionId' in a ? a.sessionId : ''}`)))
      .toEqual(['kept:s1', 'many:coordinating', 'many:not-a-workspace']);
    const first = out[1]!;
    expect(first.kind === 'kept-many' ? first.members.map((m) => m.sessionId) : null)
      .toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
  });

  it('(iv) the collapsed sentence states the count, then each child\'s own sentence', () => {
    expect(childReclaimKeptManySentence('minting-run-absent', 6)).toBe(
      `6 child workspaces are kept for the same reason. For each one: ${CHILD_RECLAIM_SKIP['minting-run-absent'].sentence}`);
  });

  it('(v) one item per child: a kept item replaces that child\'s failing item, and a terminal item stands', () => {
    expect(childReclaimAttentionWithKept(
      [failingFor('a'), terminalFor('b')], [keptFor('a', 'coordinating')], new Map(),
    )).toEqual([terminalFor('b'), keptFor('a', 'coordinating')]);
  });

  it('(v) a kept item for one child withholds no other child\'s failing item, and a terminal item is never filtered', () => {
    expect(childReclaimAttentionWithKept(
      [failingFor('a'), failingFor('b'), terminalFor('a')], [keptFor('a', 'coordinating')], new Map(),
    )).toEqual([failingFor('b'), terminalFor('a'), keptFor('a', 'coordinating')]);
  });

  it('(xiii) a held child\'s failing item is withheld, and nothing else is', () => {
    const verdicts = verdictsOf([
      ['a', skipped('held')], ['b', skipped('held')], ['d', skipped('hold-unmeasured')],
    ]);
    expect(childReclaimAttentionWithKept(
      [failingFor('a'), terminalFor('b'), failingFor('c'), failingFor('d')], [], verdicts,
    )).toEqual([terminalFor('b'), failingFor('c'), failingFor('d')]);
  });

  it('(xiii) a child whose recorded verdict is eligible, ordinary or a doubt keeps its failing item', () => {
    const verdicts = verdictsOf([['a', ELIGIBLE], ['b', skipped('review-report-live')], ['c', skipped('marker-unreadable')]]);
    expect(childReclaimAttentionWithKept([failingFor('a'), failingFor('b'), failingFor('c')], [], verdicts))
      .toEqual([failingFor('a'), failingFor('b'), failingFor('c')]);
  });

  it('(xiii) with no verdicts at all the mirror arms stand exactly as wave 4 shipped them', () => {
    const arms = [failingFor('a'), terminalFor('b')];
    expect(childReclaimAttentionWithKept(arms, [], new Map())).toEqual(arms);
  });
});

// What the feed already says for a child (spec §5.9): the deferral EPISODE a feed row is written once
// for, and the failure word the attention list shows for it. The entry remembers the first; the list
// carries the second. Nothing here paces, decides or dispatches.
describe('feed rows de-duplicated (spec §5.9) — lastDeferWhy and childReclaimFeedQuiet', () => {
  const fresh: ChildReclaimSweepEntry = childReclaimFirstSighting(NOW - 60_000, BORN);

  it('(a) a deferral sets lastDeferWhy to its word, any later non-deferral clears it, and a first sighting reads null', () => {
    expect(fresh.lastDeferWhy).toBeNull();
    const deferred = childReclaimNextEntry(fresh, { kind: 'deferred', why: 'state-changed' }, ask(NOW, false), at(NOW), PASS)!;
    expect(deferred.lastDeferWhy).toBe('state-changed');
    // A different deferral replaces the word; the same word again keeps it.
    expect(childReclaimNextEntry(deferred, { kind: 'deferred', why: 'held' }, ask(NOW + PASS, false), at(NOW + PASS), PASS)!
      .lastDeferWhy).toBe('held');
    expect(childReclaimNextEntry(deferred, { kind: 'deferred', why: 'state-changed' }, ask(NOW + PASS, false), at(NOW + PASS), PASS)!
      .lastDeferWhy).toBe('state-changed');
    const failed = childReclaimNextEntry(deferred, { kind: 'failed' }, ask(NOW + PASS, false), at(NOW + PASS), PASS)!;
    expect(failed.lastDeferWhy, 'a failed attempt ends the episode — a rejection is written through this arm').toBeNull();
    expect(childReclaimNextEntry(deferred, { kind: 'refused', token: 'tree-unreadable' }, ask(NOW + PASS, false), at(NOW + PASS), PASS)!
      .lastDeferWhy, 'a refusal ends it too').toBeNull();
  });

  it('(a) lastDeferWhy changes no pacing: due, the ceiling and the order read the same entry without it', () => {
    const deferred = childReclaimNextEntry(fresh, { kind: 'deferred', why: 'state-changed' }, ask(NOW, false), at(NOW), PASS)!;
    const without: ChildReclaimSweepEntry = { ...deferred, lastDeferWhy: null };
    expect(childReclaimDue(deferred, NOW + 1, PASS)).toBe(childReclaimDue(without, NOW + 1, PASS));
    expect(childReclaimDeferExpired(deferred, at(NOW + C), PASS)).toBe(childReclaimDeferExpired(without, at(NOW + C), PASS));
  });

  const failing = (sessionId: string, token: string): ChildReclaimAttention =>
    ({ kind: 'failing', sessionId, runId: 7, token, sentence: `sentence for ${token}`, at: NOW });
  const terminal = (sessionId: string, token: string): ChildReclaimAttention =>
    ({ kind: 'terminal', sessionId, runId: 7, token, sentence: `sentence for ${token}`, at: NOW });
  const deferredWith = (why: string | null): ChildReclaimSweepEntry => ({ ...fresh, lastDeferWhy: why });

  it.each<readonly [string, string | null, readonly ChildReclaimAttention[], ChildReclaimFeedQuiet]>([
    ['a non-presence deferral is the episode', 'state-changed', [], { deferWhy: 'state-changed', failureToken: null }],
    ['presence keeps today\'s shape', 'presence', [], { deferWhy: null, failureToken: null }],
    ['attached keeps today\'s shape', 'attached', [], { deferWhy: null, failureToken: null }],
    ['tree-busy keeps today\'s shape', 'tree-busy', [], { deferWhy: null, failureToken: null }],
    ['no deferral at all', null, [], { deferWhy: null, failureToken: null }],
    ['a failing item for this session names its token', null, [failing('demo-a', 'pin-failed')],
      { deferWhy: null, failureToken: 'pin-failed' }],
    ['a failing item with no token says nothing', null, [failing('demo-a', '')], { deferWhy: null, failureToken: null }],
    ['a terminal item is not a failure the feed repeats', null, [terminal('demo-a', 'tree-unreadable')],
      { deferWhy: null, failureToken: null }],
    ['a failing item for another session is not this child\'s', null, [failing('demo-b', 'pin-failed')],
      { deferWhy: null, failureToken: null }],
    ['both at once', 'held', [failing('demo-a', 'unit-still-active')], { deferWhy: 'held', failureToken: 'unit-still-active' }],
    ['the failing item among others is found by kind and session', null,
      [terminal('demo-a', 'tree-unreadable'), failing('demo-b', 'pin-failed'), failing('demo-a', 'unit-still-active')],
      { deferWhy: null, failureToken: 'unit-still-active' }],
  ])('%s', (_name, why, listed, expected) => {
    expect(childReclaimFeedQuiet(deferredWith(why), listed, 'demo-a')).toEqual(expected);
  });

  it('every presence defer is excluded, whichever the table names', () => {
    for (const why of CHILD_RECLAIM_PRESENCE_DEFERS) {
      expect(childReclaimFeedQuiet(deferredWith(why), [], 'demo-a').deferWhy, why).toBeNull();
    }
  });
});
