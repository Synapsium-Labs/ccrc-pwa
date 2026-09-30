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
import {
  CHILD_RECLAIM_DEFER_CEILING_MS, CHILD_RECLAIM_PRESENCE_DEFERS, childReclaimAttention, childReclaimBackoffMs,
  childReclaimDeferExpired, childReclaimDue, childReclaimFailingSentence, childReclaimFirstSighting,
  childReclaimHoldRead, childReclaimJournalRow, childReclaimNextEntry, childReclaimSweepVerdict,
  type ChildReclaimHoldCandidate, type ChildReclaimJournalRow, type ChildReclaimSweepEntry,
  type ChildReclaimSweepInput, type ChildReclaimSweepOutcome, type ChildReclaimTokenKind,
} from '../src/childReclaimSweep.js';
import {
  HOLD_NO_REASON, HOLD_UNREADABLE,
} from '../src/registry.js';
import {
  LC_REFUSAL_WORD, SPAWN_STALL_MS, TERMINAL_RUN_STATES, holdReason,
  type LifecycleAct, type LifecycleOutcome, type MirroredLifecycleEvent,
} from '../../shared/api.js';

const NOW = 1_790_000_000_000;
/** The lane's pass interval (`watch.ts`'s `CHILD_RECLAIM_SWEEP_MS`) — an
 *  ARGUMENT to the backoff, because this L1 file imports no L4 constant. */
const PASS = 60_000;
const C = CHILD_RECLAIM_DEFER_CEILING_MS;
/** The caller's `CHILD_BIRTH_SKEW_MS` — also an argument. */
const SKEW = 120_000;

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
  coordinating: false,
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

  it('a child that has ever coordinated a run is never reclaimed automatically', () => {
    expect(skip({ coordinating: true })).toEqual({ eligible: false, why: 'coordinating' });
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
      expect(skip({ held: { ...accounted, open: { ok: true, count: 0 } }, coordinating: true }))
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
  const entry: ChildReclaimSweepEntry = childReclaimFirstSighting(NOW - 60_000);

  it('a first sighting starts no clock, counts no failure, and was never asked', () => {
    expect(entry).toEqual({ firstEligibleAt: NOW - 60_000, firstDeferredAt: null, firstPresenceDeferredAt: null,
      consecutiveFailures: 0, lastFailedAt: null, refusedAt: null, lastAskedAt: null });
  });

  it('forgets a child whose reclaim ended outright — reclaimed, or already gone', () => {
    expect(childReclaimNextEntry(entry, { kind: 'reclaimed' }, NOW, false)).toBeNull();
    expect(childReclaimNextEntry(entry, { kind: 'gone' }, NOW, false)).toBeNull();
  });

  it('a TERMINAL refusal keeps its entry — the lifecycle mirror holds the refusal, this memory only paces the re-ask', () => {
    const refused = childReclaimNextEntry(entry, { kind: 'refused', token: 'tree-unreadable' }, NOW, false);
    expect(refused).toEqual({ ...entry, consecutiveFailures: 0, lastFailedAt: null,
      firstPresenceDeferredAt: null, refusedAt: NOW, lastAskedAt: NOW });
  });

  it('a refusal ends a run of failures and the presence episode alike', () => {
    const failing: ChildReclaimSweepEntry = { ...entry, consecutiveFailures: 3, lastFailedAt: NOW - 1,
      firstPresenceDeferredAt: NOW - 10 * C };
    expect(childReclaimNextEntry(failing, { kind: 'refused', token: 'tree-unreadable' }, NOW, false))
      .toMatchObject({ consecutiveFailures: 0, lastFailedAt: null, firstPresenceDeferredAt: null, refusedAt: NOW });
  });

  it('counts a failed attempt and stamps when it was asked — the any-kind clock untouched, the presence episode ended', () => {
    const withPresence: ChildReclaimSweepEntry = { ...entry, firstPresenceDeferredAt: NOW - 1000 };
    const once = childReclaimNextEntry(withPresence, { kind: 'failed' }, NOW, false);
    expect(once).toEqual({ ...withPresence, consecutiveFailures: 1, lastFailedAt: NOW,
      firstPresenceDeferredAt: null, refusedAt: null, lastAskedAt: NOW });
    expect(childReclaimNextEntry(once!, { kind: 'failed' }, NOW + 120_000, false))
      .toEqual({ ...withPresence, consecutiveFailures: 2, lastFailedAt: NOW + 120_000,
        firstPresenceDeferredAt: null, refusedAt: null, lastAskedAt: NOW + 120_000 });
  });

  it('any deferral ends a run of failures — a defer is not a failure', () => {
    const failing: ChildReclaimSweepEntry = { ...entry, consecutiveFailures: 3, lastFailedAt: NOW - 1 };
    expect(childReclaimNextEntry(failing, { kind: 'deferred', why: 'held' }, NOW, false))
      .toMatchObject({ consecutiveFailures: 0, lastFailedAt: null });
  });

  it('an UNLICENSED PRESENCE defer starts BOTH clocks, once, and never restarts either', () => {
    for (const why of CHILD_RECLAIM_PRESENCE_DEFERS) {
      const first = childReclaimNextEntry(entry, { kind: 'deferred', why }, NOW, false);
      expect(first, why).toEqual({ ...entry, firstDeferredAt: NOW, firstPresenceDeferredAt: NOW, lastAskedAt: NOW });
      expect(childReclaimNextEntry(first!, { kind: 'deferred', why }, NOW + 60_000, false), why).toEqual({
        ...first!, lastAskedAt: NOW + 60_000,
      });
    }
  });

  it('a LICENSED presence defer RESTARTS the episode even while one is already running', () => {
    const running: ChildReclaimSweepEntry = { ...entry, firstDeferredAt: NOW - 10 * C, firstPresenceDeferredAt: NOW - 10 * C };
    const restarted = childReclaimNextEntry(running, { kind: 'deferred', why: 'presence' }, NOW, true);
    expect(restarted).toEqual({ ...running, firstPresenceDeferredAt: NOW, lastAskedAt: NOW });
    expect(childReclaimDeferExpired(running, NOW)).toBe(true);
    expect(childReclaimDeferExpired(restarted!, NOW)).toBe(false);
  });

  it('`licensed` is read only on a presence-class defer — it changes nothing for failed, refused, or any other why', () => {
    const stale: ChildReclaimSweepEntry = { ...entry, firstPresenceDeferredAt: NOW - 10 * C };
    for (const outcome of [{ kind: 'failed' as const }, { kind: 'refused' as const, token: 'tree-unreadable' },
      { kind: 'deferred' as const, why: 'held' }]) {
      expect(childReclaimNextEntry(stale, outcome, NOW, true), outcome.kind)
        .toEqual(childReclaimNextEntry(stale, outcome, NOW, false));
    }
  });

  it('a defer that is not presence starts the ANY-kind clock, and clears the presence clock', () => {
    for (const why of ['state-changed', 'paused', 'held', 'in-progress', 'reap-in-progress', 'siblings-open',
      'unsupported', 'paused-at-server']) {
      const withPresence: ChildReclaimSweepEntry = { ...entry, firstPresenceDeferredAt: NOW - 1000 };
      expect(childReclaimNextEntry(withPresence, { kind: 'deferred', why }, NOW, false), why)
        .toEqual({ ...withPresence, firstDeferredAt: NOW, firstPresenceDeferredAt: null, refusedAt: null, lastAskedAt: NOW });
    }
  });

  it('a presence defer AFTER another kind keeps the earlier any-kind clock and starts its own', () => {
    const other = childReclaimNextEntry(entry, { kind: 'deferred', why: 'state-changed' }, NOW, false)!;
    expect(childReclaimNextEntry(other, { kind: 'deferred', why: 'attached' }, NOW + 60_000, false))
      .toEqual({ ...entry, firstDeferredAt: NOW, firstPresenceDeferredAt: NOW + 60_000, lastAskedAt: NOW + 60_000 });
  });

  it('names exactly the three presence defers — rungs 5 and 6 and the server\'s visibility claim', () => {
    expect([...CHILD_RECLAIM_PRESENCE_DEFERS]).toEqual(['presence', 'attached', 'tree-busy']);
  });

  it('the ceiling is fifteen minutes, reached at exactly fifteen — on the PRESENCE clock alone', () => {
    // A HARDCODED literal on purpose — the mutation control for the constant.
    expect(CHILD_RECLAIM_DEFER_CEILING_MS).toBe(900_000);
    const presence: ChildReclaimSweepEntry = { ...entry, firstDeferredAt: NOW - 10 * C, firstPresenceDeferredAt: NOW };
    expect(childReclaimDeferExpired(entry, NOW + 10 * C)).toBe(false);
    // An any-kind deferral ten ceilings old expires nothing: only presence is bounded.
    expect(childReclaimDeferExpired({ ...entry, firstDeferredAt: NOW - 10 * C }, NOW)).toBe(false);
    expect(childReclaimDeferExpired(presence, NOW + C - 1)).toBe(false);
    expect(childReclaimDeferExpired(presence, NOW + C)).toBe(true);
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
    expect(childReclaimNextEntry(stale, { kind: 'failed' }, NOW, false)).toMatchObject({ refusedAt: null });
    expect(childReclaimNextEntry(stale, { kind: 'deferred', why: 'held' }, NOW, false)).toMatchObject({ refusedAt: null });
  });

  it("starting past the ceiling, ENDING the episode makes childReclaimDeferExpired false — for failed, refused, and every non-presence why, asked of the function itself", () => {
    const stale: ChildReclaimSweepEntry = { ...entry, firstPresenceDeferredAt: NOW - 10 * C };
    const outcomes: ChildReclaimSweepOutcome[] = [
      { kind: 'failed' }, { kind: 'refused', token: 'tree-unreadable' }, { kind: 'deferred', why: 'held' },
    ];
    for (const outcome of outcomes) {
      const next = childReclaimNextEntry(stale, outcome, NOW, false)!;
      expect(childReclaimDeferExpired(next, NOW), outcome.kind).toBe(false);
    }
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
      const next = childReclaimNextEntry(refused, { kind: 'deferred', why: 'held' }, NOW, false)!;
      expect(next.refusedAt).toBeNull();
      expect(childReclaimDue(next, NOW, PASS)).toBe(true);
    });
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
      { sessionId: 'demo-a', runId: 7, token: 'tree-unreadable', sentence: 'sentence for tree-unreadable', at: NOW },
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
      { sessionId: 'demo-a', runId: null, token: 'tree-unreadable', sentence: 'sentence for tree-unreadable', at: NOW },
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
      [['demo-a', 7]]))).toEqual([{ sessionId: 'demo-a', runId: 7, token: 'purge-refused',
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
