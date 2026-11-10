// D-8077 (spec 2026-11-04 §7, §12; the ruled plan's W1, rules R1 to R7): the run-close lane's decider, pure. Rows E1 and E1r,
// the clocks `rowAnchor` and `closesOf`, the grace anchor, the activity list, the fleet act and the branch facts.
import { describe, it, expect } from 'vitest';
import {
  RUN_CLOSE_FACT_MAX_AGE_MS, RUN_CLOSE_GRACE_MS, RUN_CLOSE_PROGRAMMES_PER_PASS, RUN_CLOSE_QUIET_ARM_MS, RUN_CLOSE_ROW_SWITCH,
  RUN_CLOSE_WARN_LEAD_MS, branchFactsFor, closesOf, fleetActFor, graceAnchorNext, neverStartedVerdict, programmeLastActivity,
  reviewOrphanedVerdict, rowAnchor, runCloseBudget, runCloseRowArmed, type NeverStartedInput, type ProgrammeActivityFacts,
} from '../src/coord/runClose.js';
import { RUN_QUIET_MS } from '../src/coord/drift.js';
import { DEAD_COORDINATOR_GAP_MS } from '../src/deadCoordinator.js';
import { RUNS_EXPIRE_NEVER_STARTED_MARKER, DEAD_COORDINATOR_LANE_LIVE_MARKER } from '../../shared/switches.js';

const H = 3_600_000;
const T0 = 1_800_000_000_000;

const e1 = (over: Partial<NeverStartedInput> = {}): NeverStartedInput =>
  ({ anchor: T0, lastActivityAt: null, warning: null, armed: true, claimantReachable: true, ...over });

describe('the clocks', () => {
  it('at comes from the anchor, never the run\'s age', () => {
    expect(closesOf('never-started', T0, null, false, T0 + 1)?.at).toBe(T0 + RUN_QUIET_MS);
    expect(closesOf('review-orphaned', T0, null, false, T0 + 1)?.at).toBe(T0 + H);
  });

  it('a 50-day-old run in its first pass reads the full grace', () => {
    const anchor = rowAnchor('never-started', { firstPassAt: T0, programmeLastActivityAt: T0 - 50 * 24 * H });
    expect(anchor).toBe(T0);
    expect(closesOf('never-started', anchor, null, false, T0)).toEqual({ at: T0 + 72 * H, armed: false });
  });

  it('E1r is anchor plus 1 h', () => {
    expect(closesOf('review-orphaned', T0, null, true, T0)).toEqual({ at: T0 + H, armed: true });
  });

  it('shadow E1 is anchor plus 72 h', () => {
    expect(closesOf('never-started', T0, null, false, T0 + 60 * H)).toEqual({ at: T0 + 72 * H, armed: false });
  });

  it('armed E1 is no earlier than deliveredAt plus 24 h', () => {
    const w = { queuedAt: T0 + 60 * H, deliveredAt: T0 + 70 * H };
    expect(closesOf('never-started', T0, w, true, T0 + 71 * H)).toEqual({ at: T0 + 94 * H, armed: true });
  });

  it('armed E1 before the warning is due reads the same at as shadow', () => {
    const armed = closesOf('never-started', T0, null, true, T0 + 10 * H);
    const shadow = closesOf('never-started', T0, null, false, T0 + 10 * H);
    expect(armed?.at).toBe(shadow?.at);
  });

  it('armed E1 with a warning on its way reads the later of anchor plus 72 h and 24 h from now', () => {
    const now = T0 + 60 * H;
    expect(closesOf('never-started', T0, { queuedAt: now - H, deliveredAt: null }, true, now)?.at).toBe(now + 24 * H);
    expect(closesOf('never-started', T0, null, true, T0 + 50 * H)?.at).toBe(T0 + 74 * H);
  });

  it('armed E1 with a warning 24 h undelivered has closes null', () => {
    const now = T0 + 80 * H;
    expect(closesOf('never-started', T0, { queuedAt: now - RUN_CLOSE_WARN_LEAD_MS, deliveredAt: null }, true, now)).toBeNull();
  });

  it('no anchor, no time', () => {
    expect(closesOf('never-started', null, null, false, T0)).toBeNull();
    expect(rowAnchor('review-orphaned', { firstPassAt: null, programmeLastActivityAt: T0 })).toBeNull();
  });

  it('activity on the programme moves E1\'s at later', () => {
    const quiet = rowAnchor('never-started', { firstPassAt: T0, programmeLastActivityAt: null });
    const busy = rowAnchor('never-started', { firstPassAt: T0, programmeLastActivityAt: T0 + 30 * H });
    expect(closesOf('never-started', busy, null, false, T0 + 31 * H)!.at).toBeGreaterThan(closesOf('never-started', quiet, null, false, T0 + 31 * H)!.at);
  });

  it('a mail or a dispatch attempt leaves E1r\'s at where it was', () => {
    const a = rowAnchor('review-orphaned', { firstPassAt: T0, programmeLastActivityAt: null });
    const b = rowAnchor('review-orphaned', { firstPassAt: T0, programmeLastActivityAt: T0 + 30 * H });
    expect(b).toBe(a);
  });

  it('closes.at never reads later than the moment the lane closes', () => {
    // Shadow: at is the first moment the verdict says would-close.
    const at = closesOf('never-started', T0, null, false, T0)!.at;
    expect(neverStartedVerdict(e1({ armed: false }), at - 1).kind).toBe('would-warn');
    expect(neverStartedVerdict(e1({ armed: false }), at).kind).toBe('would-close');
    // Armed with a delivered warning: at is the first moment the verdict says close.
    const w = { queuedAt: T0 + 48 * H, deliveredAt: T0 + 49 * H };
    const armedAt = closesOf('never-started', T0, w, true, T0 + 50 * H)!.at;
    expect(armedAt).toBe(T0 + 73 * H);
    expect(neverStartedVerdict(e1({ warning: w }), armedAt - 1).kind).toBe('wait');
    expect(neverStartedVerdict(e1({ warning: w }), armedAt).kind).toBe('close');
    // E1r.
    const r = closesOf('review-orphaned', T0, null, true, T0)!.at;
    const rin = { targetClosed: true, laterReviewMoved: false, anchor: T0, armed: true };
    expect(reviewOrphanedVerdict(rin, r - 1).kind).toBe('wait');
    expect(reviewOrphanedVerdict(rin, r).kind).toBe('close');
  });
});

describe('E1: a quiet programme of planned waves', () => {
  it('a programme quiet 71 h is not a candidate', () => {
    expect(neverStartedVerdict(e1({ anchor: T0 }), T0 + 47 * H).kind).toBe('wait');
    expect(neverStartedVerdict(e1({ anchor: T0 }), T0 + RUN_CLOSE_QUIET_ARM_MS - 1).kind).toBe('wait');
  });

  it('quiet 72 h with a warning delivered 24 h ago closes', () => {
    const w = { queuedAt: T0 + 40 * H, deliveredAt: T0 + 48 * H };
    expect(neverStartedVerdict(e1({ warning: w }), T0 + 72 * H).kind).toBe('close');
  });

  it('quiet 72 h with a warning delivered 23 h ago holds', () => {
    const w = { queuedAt: T0 + 40 * H, deliveredAt: T0 + 49 * H };
    expect(neverStartedVerdict(e1({ warning: w }), T0 + 72 * H).kind).toBe('wait');
  });

  it('an undelivered warning blocks E1 and lists the programme as coordinator not reached', () => {
    const queued = { queuedAt: T0 + 48 * H, deliveredAt: null };
    expect(neverStartedVerdict(e1({ warning: queued }), T0 + 80 * H)).toEqual({ kind: 'hold', word: 'warning-undelivered' });
    expect(neverStartedVerdict(e1({ claimantReachable: false }), T0 + 80 * H)).toEqual({ kind: 'list', word: 'coordinator-not-reached' });
  });

  it('an unmeasured claimant or anchor answers not this pass', () => {
    expect(neverStartedVerdict(e1({ claimantReachable: null }), T0 + 80 * H)).toEqual({ kind: 'hold', word: 'unmeasured' });
    expect(neverStartedVerdict(e1({ anchor: null }), T0 + 80 * H)).toEqual({ kind: 'hold', word: 'unmeasured' });
  });

  it('armed at 48 h, the first verdict is warn; a delivered warning is not warned again', () => {
    expect(neverStartedVerdict(e1(), T0 + 48 * H).kind).toBe('warn');
    const w = { queuedAt: T0 + 48 * H, deliveredAt: T0 + 48 * H + 1000 };
    expect(neverStartedVerdict(e1({ warning: w }), T0 + 49 * H).kind).toBe('wait');
  });

  it('activity after a delivered warning invalidates it; the next close needs a new warning delivered 24 h earlier', () => {
    const w = { queuedAt: T0 + 48 * H, deliveredAt: T0 + 49 * H };
    // The programme moved at +60 h: the lane deletes the row, and the anchor moves with the activity.
    expect(neverStartedVerdict(e1({ warning: w, lastActivityAt: T0 + 60 * H, anchor: T0 + 60 * H }), T0 + 75 * H).kind).toBe('wait');
    expect(neverStartedVerdict(e1({ warning: null, lastActivityAt: T0 + 60 * H, anchor: T0 + 60 * H }), T0 + 109 * H).kind).toBe('warn');
    // A stale warning row that predates the activity is not valid even if the lane has not deleted it yet.
    expect(neverStartedVerdict(e1({ warning: w, lastActivityAt: T0 + 60 * H, anchor: T0 }), T0 + 100 * H).kind).not.toBe('close');
  });

  it('shadow lists would-warn and would-close separately', () => {
    expect(neverStartedVerdict(e1({ armed: false }), T0 + 50 * H).kind).toBe('would-warn');
    expect(neverStartedVerdict(e1({ armed: false }), T0 + 72 * H).kind).toBe('would-close');
  });
});

describe('E1r: a review of finished work', () => {
  const rv = (over: Partial<Parameters<typeof reviewOrphanedVerdict>[0]> = {}) =>
    ({ targetClosed: true, laterReviewMoved: false, anchor: T0, armed: true, ...over });

  it('a review run of an open work run is never E1r', () => {
    expect(reviewOrphanedVerdict(rv({ targetClosed: false }), T0 + 100 * H).kind).toBe('wait');
  });

  it('a review run whose target closed is E1r after 1 h', () => {
    expect(reviewOrphanedVerdict(rv(), T0 + H - 1).kind).toBe('wait');
    expect(reviewOrphanedVerdict(rv(), T0 + H).kind).toBe('close');
    expect(reviewOrphanedVerdict(rv({ armed: false }), T0 + H).kind).toBe('would-close');
  });

  it('a review run whose target has a later review at working or done is E1r after 1 h', () => {
    expect(reviewOrphanedVerdict(rv({ targetClosed: false, laterReviewMoved: true }), T0 + H).kind).toBe('close');
  });

  it('no anchor is not this pass', () => {
    expect(reviewOrphanedVerdict(rv({ anchor: null }), T0 + H)).toEqual({ kind: 'hold', word: 'unmeasured' });
  });
});

describe('R5: the grace anchor', () => {
  it('a series keeps its first stamp and moves the last', () => {
    const a = graceAnchorNext(null, T0, false);
    const b = graceAnchorNext(a, T0 + 60_000, false);
    expect(b).toEqual({ firstAt: T0, lastAt: T0 + 60_000 });
  });

  it('a gap above DEAD_COORDINATOR_GAP_MS restarts the grace', () => {
    const a = graceAnchorNext(null, T0, false);
    expect(graceAnchorNext(a, T0 + DEAD_COORDINATOR_GAP_MS + 1, false)).toEqual({ firstAt: T0 + DEAD_COORDINATOR_GAP_MS + 1, lastAt: T0 + DEAD_COORDINATOR_GAP_MS + 1 });
    expect(graceAnchorNext(a, T0 + DEAD_COORDINATOR_GAP_MS, false).firstAt).toBe(T0);
  });

  it('a pause restarts the grace', () => {
    const a = graceAnchorNext(null, T0, false);
    expect(graceAnchorNext(a, T0 + 60_000, true).firstAt).toBe(T0 + 60_000);
  });

  it('a backward clock step restarts the grace', () => {
    const a = graceAnchorNext(null, T0, false);
    expect(graceAnchorNext(a, T0 - 1, false).firstAt).toBe(T0 - 1);
  });
});

describe('R4: the programme\'s activity', () => {
  const none: ProgrammeActivityFacts = {
    lastActAt: null, lastOpenedAt: null, lastDispatchAttemptAt: null, lastClaimantMailAt: null, claimantBusyAt: null, warningDeliveredAt: null,
  };

  it('a refused dispatch, an openedAt, a mail about a run and a busy coordinator turn each reset the clock', () => {
    expect(programmeLastActivity({ ...none, lastDispatchAttemptAt: T0 })).toBe(T0);
    expect(programmeLastActivity({ ...none, lastOpenedAt: T0 + 1 })).toBe(T0 + 1);
    expect(programmeLastActivity({ ...none, lastClaimantMailAt: T0 + 2 })).toBe(T0 + 2);
    expect(programmeLastActivity({ ...none, claimantBusyAt: T0 + 3 })).toBe(T0 + 3);
    expect(programmeLastActivity({ ...none, lastActAt: T0 + 4 })).toBe(T0 + 4);
  });

  it('the coordinator\'s turn that reads the warning does not reset the clock', () => {
    expect(programmeLastActivity({ ...none, claimantBusyAt: T0 + 50 * H, warningDeliveredAt: T0 + 49 * H, lastOpenedAt: T0 })).toBe(T0);
  });

  it('a mail from the claimant naming a run after the warning keeps the programme', () => {
    expect(programmeLastActivity({ ...none, lastClaimantMailAt: T0 + 55 * H, warningDeliveredAt: T0 + 49 * H })).toBe(T0 + 55 * H);
  });

  it('a busy turn on another programme of the same claimant does not keep this one once warned', () => {
    expect(programmeLastActivity({ ...none, claimantBusyAt: T0 + 60 * H, warningDeliveredAt: T0 + 49 * H })).toBeNull();
  });

  it('an unread busy turn answers not this pass, but only while no warning is delivered', () => {
    expect(programmeLastActivity({ ...none, claimantBusyAt: 'unread' })).toBe('unread');
    expect(programmeLastActivity({ ...none, claimantBusyAt: 'unread', warningDeliveredAt: T0 })).toBeNull();
  });
});

describe('R1 and R6: what may be touched', () => {
  it('fleetAct is none for a null sessionId, and for a marker naming a later run', () => {
    expect(fleetActFor({ id: 7, sessionId: null }, { kind: 'child', runId: 7 })).toBe('none');
    expect(fleetActFor({ id: 7, sessionId: 's-aaaa' }, { kind: 'child', runId: 9 })).toBe('none');
    expect(fleetActFor({ id: 7, sessionId: 's-aaaa' }, { kind: 'child', runId: 7 })).toBe('release');
  });

  it('a none marker closes with no ccd call', () => {
    expect(fleetActFor({ id: 7, sessionId: 's-aaaa' }, { kind: 'none' })).toBe('none');
  });

  it('an unreadable child marker lists the run and never closes it', () => {
    expect(fleetActFor({ id: 7, sessionId: 's-aaaa' }, { kind: 'unreadable' })).toBe('list');
    expect(fleetActFor({ id: 7, sessionId: 's-aaaa' }, { kind: 'unrecognised' })).toBe('list');
  });

  it('a branch fact older than 5 min refuses', () => {
    const f = { readAt: T0, openPr: false, unpushed: false };
    expect(branchFactsFor(f, T0 + RUN_CLOSE_FACT_MAX_AGE_MS)).toEqual({ kind: 'clear' });
    expect(branchFactsFor(f, T0 + RUN_CLOSE_FACT_MAX_AGE_MS + 1)).toEqual({ kind: 'list', reason: 'unmeasured' });
    expect(branchFactsFor(null, T0)).toEqual({ kind: 'list', reason: 'unmeasured' });
  });

  it('an open PR or unpushed commits refuse, and an unmeasured fact refuses', () => {
    expect(branchFactsFor({ readAt: T0, openPr: true, unpushed: false }, T0)).toEqual({ kind: 'list', reason: 'open-pr' });
    expect(branchFactsFor({ readAt: T0, openPr: false, unpushed: true }, T0)).toEqual({ kind: 'list', reason: 'unpushed-commits' });
    expect(branchFactsFor({ readAt: T0, openPr: null, unpushed: false }, T0)).toEqual({ kind: 'list', reason: 'unmeasured' });
  });
});

describe('R7 and the switches', () => {
  it('the budget acts on at most 3 programmes, oldest activity first, and leaves the rest eligible', () => {
    const cs = ['a', 'b', 'c', 'd', 'e'].map((p, i) => ({ program: p, activityAt: 100 - i }));
    const { act, left } = runCloseBudget(cs);
    expect(act.map((c) => c.program)).toEqual(['e', 'd', 'c']);
    expect(left.map((c) => c.program)).toEqual(['b', 'a']);
    expect(RUN_CLOSE_PROGRAMMES_PER_PASS).toBe(3);
  });

  it('two runs of one programme count once', () => {
    const cs = [{ program: 'a', activityAt: 1 }, { program: 'a', activityAt: 1 }, { program: 'b', activityAt: 2 }, { program: 'c', activityAt: 3 }, { program: 'd', activityAt: 4 }];
    expect(runCloseBudget(cs).act.map((c) => c.program)).toEqual(['a', 'a', 'b', 'c']);
  });

  it('each row reads only its own group\'s marker', () => {
    expect(RUN_CLOSE_ROW_SWITCH['never-started']).toBe(RUNS_EXPIRE_NEVER_STARTED_MARKER);
    expect(RUN_CLOSE_ROW_SWITCH['review-orphaned']).toBe(RUNS_EXPIRE_NEVER_STARTED_MARKER);
    expect(RUN_CLOSE_ROW_SWITCH['claimant-crashed']).toBe(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    expect(runCloseRowArmed('never-started', [DEAD_COORDINATOR_LANE_LIVE_MARKER], 'shadow')).toBe(false);
    expect(runCloseRowArmed('claimant-crashed', [RUNS_EXPIRE_NEVER_STARTED_MARKER], 'shadow')).toBe(false);
    expect(runCloseRowArmed('never-started', [RUNS_EXPIRE_NEVER_STARTED_MARKER], 'shadow')).toBe(true);
  });

  it('the grace table reads RUN_QUIET_MS by reference', () => {
    expect(RUN_CLOSE_GRACE_MS['never-started']).toBe(RUN_QUIET_MS);
  });
});
