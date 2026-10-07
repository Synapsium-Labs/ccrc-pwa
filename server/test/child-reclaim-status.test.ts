// Child-reclamation wave 5, Task 3: THE ONE derivation of a closed run's
// reclaim chip, pinned table-driven over every mapping row. The ws-reclaim
// token rows are DERIVED from `CHILD_RECLAIM_TOKEN_KIND`, so a token wave 3
// adds is a new case here without anyone writing one. The literal rows below
// them pin the rules that no table could supply: the paused special case, the
// fleet-wide switch, the no-reason and unclassified refusals, the failure
// words, the sweep's last verdict and where it ranks, the intent fall-through,
// the review child, the hand-over and the recycled slug. The generation fence
// and the latest-event rule are wave 4's `childReclaimGeneration` and
// `childReclaimLatest` (spec §5.6: slugs recycle): this file pins the
// composer's CALLS to them, never their bodies.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CHILD_RECLAIM_STATUS_SENTENCE, CHILD_RECLAIM_TOKEN_KIND, childReclaimSessions,
  childReclaimStatus, childReclaimTokenKind, withChildReclaim, type ChildReclaimSources, type ChildReclaimStatusInput,
} from '../src/coord/childReclaim.js';
import {
  CHILD_RECLAIM_DEFER_CEILING_MS, CHILD_RECLAIM_SKIP, childReclaimAttention, childReclaimFailingSentence,
  childReclaimFirstSighting,
  type ChildReclaimSweepSkip, type ChildReclaimSweepVerdict,
} from '../src/childReclaimSweep.js';
import { refusalSentence } from '../src/wsaudit.js';
import {
  CHILD_RECLAIM_KEPT_WORDS, RUN_STATES, TERMINAL_RUN_STATES, lcRefusalWord, type ChildMark, type ChildReclaimStatus,
  type MirroredLifecycleEvent, type RunState, type RunSummary,
} from '../../shared/api.js';

const S = CHILD_RECLAIM_STATUS_SENTENCE;
const SID = 'ccrc-pwa-quiet-mesa';
const RUN = 41;
const AT = 1_758_500_000_000;
const EV_AT = AT + 5_000;

type Ev = NonNullable<ChildReclaimStatusInput['event']>;
const ev = (outcome: string, refusal: string | null = null, at: number | null = EV_AT): Ev =>
  ({ act: 'reclaim', outcome, refusal, at }) as Ev;

const marked: ChildReclaimStatusInput['row'] = { kind: 'row', child: { kind: 'child', runId: RUN } };
const base = (over: Partial<ChildReclaimStatusInput> = {}): ChildReclaimStatusInput => ({
  run: { id: RUN, state: 'done', sessionId: SID },
  event: null,
  row: marked,
  sessionHasOpenRun: false,
  reviewedRunNotTerminal: false,
  fleetPaused: false,
  deferredSince: null,
  verdict: { kind: 'eligible' },
  sweepFailing: false,
  journalFailingSince: null,
  ...over,
});
const skip = (why: ChildReclaimSweepSkip): ChildReclaimStatusInput['verdict'] => ({ kind: 'skip', why });
const pending: ChildReclaimStatus = { word: 'pending', sentence: S.pending, at: null };
const switchPaused: ChildReclaimStatus = { word: 'paused', sentence: S.fleetPaused, at: null };
const reviewKept: ChildReclaimStatus = { word: 'pending', sentence: S.reviewKept, at: null };
const unjudged: ChildReclaimStatus = { word: 'pending', sentence: S.unjudged, at: null };
const kept = (sentence: string): ChildReclaimStatus => ({ word: 'refused', sentence, at: null });
const deferredWith = (sentence: string, at: number | null = null): ChildReclaimStatus => ({ word: 'deferred', sentence, at });

const ROWS: readonly { readonly name: string; readonly input: ChildReclaimStatusInput; readonly want: ChildReclaimStatus | null }[] = [
  { name: 'done → reclaimed, at the event time', input: base({ event: ev('done') }),
    want: { word: 'reclaimed', sentence: S.reclaimed, at: EV_AT } },
  { name: 'done with no readable at → reclaimed, at null', input: base({ event: ev('done', null, null) }),
    want: { word: 'reclaimed', sentence: S.reclaimed, at: null } },
  { name: 'done, even with the row already gone → reclaimed (the mirror, not the registry)',
    input: base({ event: ev('done'), row: { kind: 'absent' } }),
    want: { word: 'reclaimed', sentence: S.reclaimed, at: EV_AT } },
  { name: 'refused with no token → refused, ccd recorded no reason (spec §5.9)',
    input: base({ event: ev('refused', null) }), want: { word: 'refused', sentence: S.refusedNoReason, at: EV_AT } },
  { name: 'refused with an empty token → refused, ccd recorded no reason (spec §5.9)',
    input: base({ event: ev('refused', '') }), want: { word: 'refused', sentence: S.refusedNoReason, at: EV_AT } },
  { name: 'refused with a token this build cannot classify → refused, refusalSentence’s fallback (spec §5.9)',
    input: base({ event: ev('refused', 'from-a-newer-ccd') }),
    want: { word: 'refused', sentence: 'ccrc declined: from-a-newer-ccd.', at: EV_AT } },
  { name: 'failed with an audit token → deferred, that token’s sentence', input: base({ event: ev('failed', 'state-changed') }),
    want: { word: 'deferred', sentence: refusalSentence('state-changed'), at: EV_AT } },
  // Wave 3's post-start failures are journal-only `LcRefusalToken`s: their words
  // live in `LC_REFUSAL_WORD`, and `refusalSentence` alone would answer the
  // generic `ccrc declined: pin-failed.` The non-null assertion below proves
  // these two rows cannot pass on a missing word.
  { name: 'failed pin-failed → deferred, wave 3’s journal word, not the audit fallback',
    input: base({ event: ev('failed', 'pin-failed') }),
    want: { word: 'deferred', sentence: lcRefusalWord('pin-failed'), at: EV_AT } },
  { name: 'failed unit-still-active → deferred, wave 3’s journal word, not the audit fallback',
    input: base({ event: ev('failed', 'unit-still-active') }),
    want: { word: 'deferred', sentence: lcRefusalWord('unit-still-active'), at: EV_AT } },
  { name: 'failed with no token → deferred, the failure sentence', input: base({ event: ev('failed', null) }),
    want: { word: 'deferred', sentence: S.failed, at: EV_AT } },
  { name: 'intent (an act with no recorded end), with the marked row → falls through to pending (spec §5.9)',
    input: base({ event: ev('intent') }), want: pending },
  { name: 'unknown outcome, with the marked row → falls through to pending (spec §5.9)',
    input: base({ event: ev('unknown') }), want: pending },
  { name: 'intent with no registry row → the row rule says nothing',
    input: base({ event: ev('intent'), row: { kind: 'absent' } }), want: null },
  { name: 'intent with the sweep deferring → the row rule’s deferred',
    input: base({ event: ev('intent'), deferredSince: AT + 9_000 }),
    want: { word: 'deferred', sentence: S.sweepDeferred, at: AT + 9_000 } },
  { name: 'no event, marked row → pending', input: base(), want: pending },
  { name: 'no event, marked row, the sweep deferring → deferred since the sweep began',
    input: base({ deferredSince: AT + 9_000 }), want: { word: 'deferred', sentence: S.sweepDeferred, at: AT + 9_000 } },
  // The fleet-wide switch (spec §5.8): every answer that promises the sweep will act on
  // its own reads `paused`; nothing settled, and no null, changes.
  { name: 'fleet paused, no event, marked row → paused, the switch’s sentence',
    input: base({ fleetPaused: true }), want: switchPaused },
  { name: 'fleet paused, the sweep deferring → paused (the switch, not the defer, is what holds it)',
    input: base({ fleetPaused: true, deferredSince: AT + 9_000 }), want: switchPaused },
  { name: 'fleet paused, a retry refusal → paused', input: base({ fleetPaused: true, event: ev('refused', 'held') }),
    want: switchPaused },
  { name: 'fleet paused, a failed attempt → paused', input: base({ fleetPaused: true, event: ev('failed', 'pin-failed') }),
    want: switchPaused },
  { name: 'fleet paused, an intent → the row rule, paused', input: base({ fleetPaused: true, event: ev('intent') }),
    want: switchPaused },
  { name: 'fleet paused, a done reclaim → still reclaimed', input: base({ fleetPaused: true, event: ev('done') }),
    want: { word: 'reclaimed', sentence: S.reclaimed, at: EV_AT } },
  { name: 'fleet paused, a terminal refusal → still refused',
    input: base({ fleetPaused: true, event: ev('refused', 'containment-unproven') }),
    want: { word: 'refused', sentence: refusalSentence('containment-unproven'), at: EV_AT } },
  { name: 'fleet paused, a refusal with no token → still refused, ccd recorded no reason (spec §5.8)',
    input: base({ fleetPaused: true, event: ev('refused', null) }),
    want: { word: 'refused', sentence: S.refusedNoReason, at: EV_AT } },
  { name: 'fleet paused, a token this build cannot classify → still refused, refusalSentence’s fallback (spec §5.8)',
    input: base({ fleetPaused: true, event: ev('refused', 'from-a-newer-ccd') }),
    want: { word: 'refused', sentence: 'ccrc declined: from-a-newer-ccd.', at: EV_AT } },
  { name: 'fleet paused, the on-box paused token → its own sentence and time',
    input: base({ fleetPaused: true, event: ev('refused', 'paused') }),
    want: { word: 'paused', sentence: refusalSentence('paused'), at: EV_AT } },
  { name: 'fleet paused, a hand-over → still nothing', input: base({ fleetPaused: true, sessionHasOpenRun: true }), want: null },
  // A review child (spec §5.7): kept while the run it reviewed is not known to
  // be terminal. Open and absent both arrive here as `reviewedRunNotTerminal`;
  // the composer case below is where the two are told apart.
  { name: 'a review child whose reviewed run is not terminal → pending, kept for the report (spec §5.7)',
    input: base({ reviewedRunNotTerminal: true }), want: reviewKept },
  { name: 'a review child under a fleet pause → still kept for the report, not paused',
    input: base({ reviewedRunNotTerminal: true, fleetPaused: true }), want: reviewKept },
  { name: 'a review child beside a stale sweep defer → still kept for the report',
    input: base({ reviewedRunNotTerminal: true, deferredSince: AT + 9_000 }), want: reviewKept },
  { name: 'a review child already reclaimed → reclaimed', input: base({ reviewedRunNotTerminal: true, event: ev('done') }),
    want: { word: 'reclaimed', sentence: S.reclaimed, at: EV_AT } },
  { name: 'a review child whose session has an open run → nothing',
    input: base({ reviewedRunNotTerminal: true, sessionHasOpenRun: true }), want: null },
  { name: 'no event, another run OPEN on the session (a hand-over) → nothing', input: base({ sessionHasOpenRun: true }), want: null },
  { name: 'no event, marker names ANOTHER run (a recycled slug) → nothing',
    input: base({ row: { kind: 'row', child: { kind: 'child', runId: RUN + 1 } } }), want: null },
  { name: 'no event, the row carries no marker → nothing (not a child)',
    input: base({ row: { kind: 'row', child: { kind: 'none' } } }), want: null },
  { name: 'no event, the marker is unreadable → nothing (whose child it is cannot be said)',
    input: base({ row: { kind: 'row', child: { kind: 'unreadable' } } }), want: null },
  { name: 'no event, no registry row → nothing', input: base({ row: { kind: 'absent' } }), want: null },
  { name: 'no event, the registry never listed → nothing', input: base({ row: { kind: 'unmeasured' } }), want: null },
  { name: 'a run with no session → nothing, even beside a done event',
    input: base({ run: { id: RUN, state: 'done', sessionId: null }, event: ev('done') }), want: null },
  { name: 'a FAILED run is terminal too → pending', input: base({ run: { id: RUN, state: 'failed', sessionId: SID } }), want: pending },

  // ── the sweep's last verdict (spec §5.9) ───────────────────────────────────
  // KEPT: refused, a standing answer, and the switch never replaces it.
  { name: 'kept (coordinating) → refused, the kept sentence, at null',
    input: base({ verdict: skip('coordinating') }), want: kept(CHILD_RECLAIM_SKIP.coordinating.sentence) },
  { name: 'kept (coordinating) under a fleet pause → still refused, never the switch’s paused',
    input: base({ verdict: skip('coordinating'), fleetPaused: true }), want: kept(CHILD_RECLAIM_SKIP.coordinating.sentence) },
  { name: 'kept beats the review rows: a review child whose reviewed run is absent reads refused',
    input: base({ verdict: skip('reviewed-run-absent'), reviewedRunNotTerminal: true }),
    want: kept(CHILD_RECLAIM_SKIP['reviewed-run-absent'].sentence) },
  { name: 'kept beats a retryable refusal',
    input: base({ verdict: skip('coordinating'), event: ev('refused', 'state-changed') }),
    want: kept(CHILD_RECLAIM_SKIP.coordinating.sentence) },
  { name: 'kept beats the on-box paused token',
    input: base({ verdict: skip('coordinating'), event: ev('refused', 'paused') }),
    want: kept(CHILD_RECLAIM_SKIP.coordinating.sentence) },
  { name: 'kept beats a refusal with no token',
    input: base({ verdict: skip('coordinating'), event: ev('refused', null) }),
    want: kept(CHILD_RECLAIM_SKIP.coordinating.sentence) },
  { name: 'kept beats a token this build cannot classify',
    input: base({ verdict: skip('coordinating'), event: ev('refused', 'from-a-newer-ccd') }),
    want: kept(CHILD_RECLAIM_SKIP.coordinating.sentence) },
  { name: 'kept beats a failure',
    input: base({ verdict: skip('coordinating'), event: ev('failed', 'pin-failed') }),
    want: kept(CHILD_RECLAIM_SKIP.coordinating.sentence) },
  { name: 'a terminal refusal beats a kept verdict: ccd’s own settled word and the banner’s terminal arm agree',
    input: base({ verdict: skip('not-a-workspace'), event: ev('refused', 'not-a-workspace') }),
    want: { word: 'refused', sentence: refusalSentence('not-a-workspace'), at: EV_AT } },
  { name: 'a done reclaim beats a kept verdict → reclaimed',
    input: base({ verdict: skip('coordinating'), event: ev('done') }),
    want: { word: 'reclaimed', sentence: S.reclaimed, at: EV_AT } },
  { name: 'a gone answer beats a kept verdict → nothing',
    input: base({ verdict: skip('coordinating'), event: ev('refused', 'no-such-session') }), want: null },
  // DOUBT and HELD: deferred, and the switch turns each to paused.
  { name: 'doubt (hold-unmeasured) → deferred, its sentence, at null',
    input: base({ verdict: skip('hold-unmeasured') }), want: deferredWith(CHILD_RECLAIM_SKIP['hold-unmeasured'].sentence) },
  { name: 'doubt (hold-unmeasured) under a fleet pause → paused',
    input: base({ verdict: skip('hold-unmeasured'), fleetPaused: true }), want: switchPaused },
  // An unplaced birth is doubt, never kept: the sweep places the birth again on its next pass.
  { name: 'doubt (child-birth-unplaced) → deferred, its sentence, at null, never refused',
    input: base({ verdict: skip('child-birth-unplaced') }),
    want: deferredWith(CHILD_RECLAIM_SKIP['child-birth-unplaced'].sentence) },
  { name: 'doubt (child-birth-unplaced) under a fleet pause → paused, never refused',
    input: base({ verdict: skip('child-birth-unplaced'), fleetPaused: true }), want: switchPaused },
  { name: 'held → deferred, the hold sentence, at null',
    input: base({ verdict: skip('held') }), want: deferredWith(CHILD_RECLAIM_SKIP.held.sentence) },
  { name: 'held under a fleet pause → paused',
    input: base({ verdict: skip('held'), fleetPaused: true }), want: switchPaused },
  { name: 'held on a review child → the hold sentence, ahead of the review rows',
    input: base({ verdict: skip('held'), reviewedRunNotTerminal: true }), want: deferredWith(CHILD_RECLAIM_SKIP.held.sentence) },
  { name: 'held beats a failure: no row promises a retry a hold prevents',
    input: base({ verdict: skip('held'), event: ev('failed', 'pin-failed') }), want: deferredWith(CHILD_RECLAIM_SKIP.held.sentence) },
  { name: 'held beats a retryable refusal',
    input: base({ verdict: skip('held'), event: ev('refused', 'attached') }), want: deferredWith(CHILD_RECLAIM_SKIP.held.sentence) },
  { name: 'held beats the sweep’s own defer and failure run',
    input: base({ verdict: skip('held'), deferredSince: AT + 9_000, sweepFailing: true }),
    want: deferredWith(CHILD_RECLAIM_SKIP.held.sentence) },
  // The gate, ORDINARY skips, and NO VERDICT.
  { name: 'a verdict on a hand-over says nothing',
    input: base({ verdict: skip('coordinating'), sessionHasOpenRun: true }), want: null },
  { name: 'a held verdict on a hand-over says nothing',
    input: base({ verdict: skip('held'), sessionHasOpenRun: true }), want: null },
  { name: 'a verdict with the marker naming another run says nothing',
    input: base({ verdict: skip('coordinating'), row: { kind: 'row', child: { kind: 'child', runId: RUN + 1 } } }), want: null },
  { name: 'an ordinary skip (hold-retired) → the ordinary pending',
    input: base({ verdict: skip('hold-retired') }), want: pending },
  { name: 'an ordinary skip (review-report-live) on a review child → kept for the report',
    input: base({ verdict: skip('review-report-live'), reviewedRunNotTerminal: true }), want: reviewKept },
  { name: 'no verdict yet → pending, with its own sentence, never the eligible one',
    input: base({ verdict: { kind: 'unjudged' } }), want: unjudged },
  { name: 'no verdict yet under a fleet pause → paused',
    input: base({ verdict: { kind: 'unjudged' }, fleetPaused: true }), want: switchPaused },
  { name: 'no verdict yet on a review child → kept for the report',
    input: base({ verdict: { kind: 'unjudged' }, reviewedRunNotTerminal: true }), want: reviewKept },

  // ── the sweep's run of failed attempts ─────────────────────────────────────
  { name: 'the sweep keeps failing, no event → deferred, the sweep-failing sentence',
    input: base({ sweepFailing: true }), want: deferredWith(S.sweepFailing) },
  { name: 'the sweep keeps failing beside a defer → still the sweep-failing sentence',
    input: base({ sweepFailing: true, deferredSince: AT + 9_000 }), want: deferredWith(S.sweepFailing) },
  { name: 'the sweep keeps failing under a fleet pause → paused',
    input: base({ sweepFailing: true, fleetPaused: true }), want: switchPaused },
  { name: 'the sweep keeps failing on a review child → kept for the report',
    input: base({ sweepFailing: true, reviewedRunNotTerminal: true }), want: reviewKept },

  // ── the two pre-lock lock refusals read as failures (spec §5.9) ────────────
  { name: 'refused flock-unavailable → deferred, wave 3’s journal word, never refused',
    input: base({ event: ev('refused', 'flock-unavailable') }),
    want: { word: 'deferred', sentence: lcRefusalWord('flock-unavailable'), at: EV_AT } },
  { name: 'refused lock-unopenable → deferred, wave 3’s journal word, never refused',
    input: base({ event: ev('refused', 'lock-unopenable') }),
    want: { word: 'deferred', sentence: lcRefusalWord('lock-unopenable'), at: EV_AT } },
  { name: 'refused flock-unavailable under a fleet pause → paused',
    input: base({ event: ev('refused', 'flock-unavailable'), fleetPaused: true }), want: switchPaused },
  { name: 'refused lock-unopenable under a fleet pause → paused',
    input: base({ event: ev('refused', 'lock-unopenable'), fleetPaused: true }), want: switchPaused },
  { name: 'refused bad-session-id (journal-only, not a pre-lock token) → refused, its journal word',
    input: base({ event: ev('refused', 'bad-session-id') }),
    want: { word: 'refused', sentence: lcRefusalWord('bad-session-id'), at: EV_AT } },
  { name: 'a failure run past the ceiling → deferred, the attention list’s own sentence, dated from the run’s start',
    input: base({ event: ev('failed', 'pin-failed'), journalFailingSince: AT }),
    want: { word: 'deferred', sentence: childReclaimFailingSentence(lcRefusalWord('pin-failed')), at: AT } },
  { name: 'a pre-lock refusal run past the ceiling → the same failing sentence, its word the journal’s',
    input: base({ event: ev('refused', 'flock-unavailable'), journalFailingSince: AT }),
    want: { word: 'deferred', sentence: childReclaimFailingSentence(lcRefusalWord('flock-unavailable')), at: AT } },
  { name: 'a failure with no token past the ceiling → the failing sentence naming no reason',
    input: base({ event: ev('failed', null), journalFailingSince: AT }),
    want: { word: 'deferred', sentence: childReclaimFailingSentence(null), at: AT } },
  { name: 'a failure run past the ceiling under a fleet pause → paused',
    input: base({ event: ev('failed', 'pin-failed'), journalFailingSince: AT, fleetPaused: true }), want: switchPaused },
];

describe('childReclaimStatus — every mapping row (wave 5, spec §5.7–§5.9)', () => {
  it.each(ROWS)('$name', ({ input, want }) => {
    expect(childReclaimStatus(input)).toEqual(want);
  });

  it('says nothing for any non-terminal run, whatever the mirror says', () => {
    const open = RUN_STATES.filter((s) => !(TERMINAL_RUN_STATES as readonly RunState[]).includes(s));
    expect(open.length).toBeGreaterThan(0);
    for (const state of open) {
      expect(childReclaimStatus(base({ run: { id: RUN, state, sessionId: SID }, event: ev('done') })), state).toBeNull();
    }
  });

  it('reads a failure token’s journal word ahead of the audit sentences, never the generic fallback', () => {
    for (const token of ['pin-failed', 'unit-still-active', 'flock-unavailable', 'lock-unopenable']) {
      const word = lcRefusalWord(token);
      expect(word, `${token} has no LC_REFUSAL_WORD entry: wave 3's journal words did not land`).not.toBeNull();
      expect(word).not.toBe(refusalSentence(token));
    }
  });

  it('the unclassified-token row really is refusalSentence’s fallback, not a sentence of this file', () => {
    expect(refusalSentence('from-a-newer-ccd')).toBe('ccrc declined: from-a-newer-ccd.');
    expect(Object.values(S)).not.toContain('ccrc declined: from-a-newer-ccd.');
  });

  it('gives every word it answers a sentence', () => {
    for (const { want } of ROWS) if (want !== null) expect(want.sentence, JSON.stringify(want)).not.toBeNull();
  });

  it('every sentence of the table is a distinct, non-empty string (no member answers for another)', () => {
    const all = Object.values(S);
    expect(all.every((s) => s.length > 0)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });
});

// Step 4's failure-line, `paused`-token and retry arms each promise that the sweep acts again, and
// the sweep's word is about "a child that still stands" (spec §5.9). So each answers only where the
// row rule's gate holds. A child with no registry row, a marker naming another run, or a session
// handed to an open run falls through to the row rule's silence. It never gets a promised retry,
// and never the unclassified-token `refused` that sits below these arms. Each arm is checked under
// the switch too, because the switch must not bring an answer back.
describe('childReclaimStatus — the retry-promising arms answer only for a child that still stands (spec §5.9)', () => {
  const ARMS: readonly { readonly arm: string; readonly over: Partial<ChildReclaimStatusInput>;
    readonly want: ChildReclaimStatus; readonly wantPaused: ChildReclaimStatus }[] = [
    { arm: 'the failure-line arm (failed pin-failed)', over: { event: ev('failed', 'pin-failed') },
      want: deferredWith(lcRefusalWord('pin-failed')!, EV_AT), wantPaused: switchPaused },
    // A pre-lock refusal is a failure line whose token no kind classifies: falling out of the
    // failure arm into the refused arm below would read it as the unclassified `refused`.
    { arm: 'the failure-line arm (a pre-lock refusal, flock-unavailable)', over: { event: ev('refused', 'flock-unavailable') },
      want: deferredWith(lcRefusalWord('flock-unavailable')!, EV_AT), wantPaused: switchPaused },
    { arm: 'the failure-line arm past the ceiling', over: { event: ev('failed', 'pin-failed'), journalFailingSince: AT },
      want: deferredWith(childReclaimFailingSentence(lcRefusalWord('pin-failed')), AT), wantPaused: switchPaused },
    { arm: 'the paused-token arm', over: { event: ev('refused', 'paused') },
      want: { word: 'paused', sentence: refusalSentence('paused'), at: EV_AT },
      wantPaused: { word: 'paused', sentence: refusalSentence('paused'), at: EV_AT } },
    { arm: 'the retry arm (held)', over: { event: ev('refused', 'held') },
      want: deferredWith(refusalSentence('held'), EV_AT), wantPaused: switchPaused },
  ];
  const NOT_STANDING: readonly { readonly shape: string; readonly over: Partial<ChildReclaimStatusInput> }[] = [
    { shape: 'no registry row', over: { row: { kind: 'absent' } } },
    { shape: 'the marker names another run (a recycled slug)', over: { row: { kind: 'row', child: { kind: 'child', runId: RUN + 1 } } } },
    { shape: 'another run is open on the session (a hand-over)', over: { sessionHasOpenRun: true } },
  ];
  const cases = ARMS.flatMap(({ arm, over }) => NOT_STANDING.flatMap(({ shape, over: not }) =>
    [false, true].map((fleetPaused) => ({
      name: `${arm}, ${shape}${fleetPaused ? ', under a fleet pause' : ''} → nothing`,
      input: base({ ...over, ...not, fleetPaused }),
    }))));

  it('covers every arm against every shape of a child that no longer stands, with and without the switch', () => {
    expect(cases).toHaveLength(ARMS.length * NOT_STANDING.length * 2);
  });

  for (const { name, input } of cases) {
    it(name, () => {
      expect(childReclaimStatus(input)).toBeNull();
    });
  }

  for (const { arm, over, want, wantPaused } of ARMS) {
    it(`${arm}, the marked child that still stands → its own answer (control)`, () => {
      expect(childReclaimStatus(base(over))).toEqual(want);
      expect(childReclaimStatus(base({ ...over, fleetPaused: true }))).toEqual(wantPaused);
    });
  }

  // The gate's boundary: the refused answers that promise nothing are NOT gated. A refusal with no
  // token, or with a token this build cannot classify, still reads refused for a child that no
  // longer stands, and so does a terminal refusal, which is settled and answers ahead of the gate.
  const UNGATED: readonly { readonly answer: string; readonly event: Ev; readonly want: ChildReclaimStatus }[] = [
    { answer: 'refused with no token', event: ev('refused', null),
      want: { word: 'refused', sentence: S.refusedNoReason, at: EV_AT } },
    { answer: 'refused with an empty token', event: ev('refused', ''),
      want: { word: 'refused', sentence: S.refusedNoReason, at: EV_AT } },
    { answer: 'refused with a token this build cannot classify', event: ev('refused', 'from-a-newer-ccd'),
      want: { word: 'refused', sentence: refusalSentence('from-a-newer-ccd'), at: EV_AT } },
    { answer: 'a terminal refusal (settled)', event: ev('refused', 'containment-unproven'),
      want: { word: 'refused', sentence: refusalSentence('containment-unproven'), at: EV_AT } },
  ];
  for (const { answer, event, want } of UNGATED) {
    for (const { shape, over: not } of NOT_STANDING) {
      for (const fleetPaused of [false, true]) {
        it(`${answer}, ${shape}${fleetPaused ? ', under a fleet pause' : ''} → still refused (not gated)`, () => {
          expect(childReclaimStatus(base({ event, ...not, fleetPaused }))).toEqual(want);
        });
      }
    }
  }
});

// Past the ceiling the chip says what the attention list's failing arm says of the same line (spec
// §5.9): the expectation is the LIST's own answer, so the two cannot drift apart by hand.
describe('childReclaimStatus — past the ceiling, the attention list’s own failing sentence (spec §5.9)', () => {
  const nowMs = AT + CHILD_RECLAIM_DEFER_CEILING_MS;
  const LINES: readonly (readonly [string, string | null])[] = [
    ['failed', ''], ['failed', null], ['failed', 'pin-failed'], ['failed', 'state-changed'],
    ['failed', 'from-a-newer-ccd'], ['refused', 'flock-unavailable'],
  ];
  it.each(LINES)('%s %j → the list’s sentence for the same row, dated from the run’s start', (outcome, refusal) => {
    const listed = childReclaimAttention({
      latest: [{ sessionId: SID, outcome, refusal, at: EV_AT, failingSince: AT }],
      live: new Map([[SID, RUN]]), kindOf: childReclaimTokenKind, sentenceFor: refusalSentence, nowMs,
    });
    expect(listed.map((a) => a.kind)).toEqual(['failing']);
    expect(childReclaimStatus(base({ event: ev(outcome, refusal), journalFailingSince: AT })))
      .toEqual({ word: 'deferred', sentence: listed[0]!.sentence, at: AT });
  });
});

describe('childReclaimStatus — every ws-reclaim token, by its classification', () => {
  const tokens = Object.entries(CHILD_RECLAIM_TOKEN_KIND) as [string, 'gone' | 'terminal' | 'retry'][];

  it('has all three kinds to classify, and paused is a retryable one', () => {
    const kinds = new Set(tokens.map(([, k]) => k));
    expect([...kinds].sort()).toEqual(['gone', 'retry', 'terminal']);
    expect(CHILD_RECLAIM_TOKEN_KIND['paused']).toBe('retry');
  });

  it.each(tokens)('refused %s (%s)', (token, kind) => {
    const got = childReclaimStatus(base({ event: ev('refused', token) }));
    if (kind === 'gone') { expect(got).toBeNull(); return; }
    const word = token === 'paused' ? 'paused' : kind === 'retry' ? 'deferred' : 'refused';
    expect(got).toEqual({ word, sentence: refusalSentence(token), at: EV_AT });
  });

  it('spot-checks the rows a reader would look for first, by literal', () => {
    expect(childReclaimStatus(base({ event: ev('refused', 'not-a-child') }))?.word).toBe('refused');
    expect(childReclaimStatus(base({ event: ev('refused', 'containment-unproven') }))?.word).toBe('refused');
    expect(childReclaimStatus(base({ event: ev('refused', 'held') }))?.word).toBe('deferred');
    expect(childReclaimStatus(base({ event: ev('refused', 'paused') }))?.word).toBe('paused');
    expect(childReclaimStatus(base({ event: ev('refused', 'no-such-session') }))).toBeNull();
  });

  it('reads a workdir git has no worktree record of as a terminal refusal, in the audit’s own sentence (spec §5.5)', () => {
    expect(CHILD_RECLAIM_TOKEN_KIND['no-worktree-record']).toBe('terminal');
    expect(childReclaimStatus(base({ event: ev('refused', 'no-worktree-record') }))).toEqual({
      word: 'refused', sentence: refusalSentence('no-worktree-record'), at: EV_AT,
    });
  });
});

describe('the generation fence and the latest pick are wave 4’s, called and never re-implemented (spec §5.6)', () => {
  const wave5 = (): string => {
    const file = readFileSync(path.join(import.meta.dirname, '..', 'src', 'coord', 'childReclaim.ts'), 'utf8');
    const at = file.indexOf('// ── Wave 5: the closed run');
    const end = file.indexOf('// ── end wave 5 chip ──');
    expect(at, 'the wave-5 banner is missing').toBeGreaterThan(-1);
    expect(end, 'the wave-5 end banner is missing').toBeGreaterThan(at);
    return file.slice(at, end);
  };

  it('the wave-5 section reads no create row itself, and calls childReclaimGeneration', () => {
    expect(wave5()).not.toMatch(/['"]create['"]/);
    expect(wave5()).toMatch(/\bchildReclaimGeneration\(/);
  });

  it('the wave-5 section picks no reclaim row itself, and calls childReclaimLatest', () => {
    // A second pick could skip an `intent` where wave 4's counts it, and the
    // chip and the attention list would disagree about the same child.
    expect(wave5()).not.toMatch(/['"]reclaim['"]/);
    expect(wave5()).toMatch(/\bchildReclaimLatest\(/);
  });
});

const run = (over: Partial<RunSummary>): RunSummary =>
  ({ id: RUN, state: 'done', sessionId: SID, closedAt: AT, childReclaim: null, program: 'w5',
     kind: 'work', reviews: null, ...over }) as RunSummary;
const src = (over: Partial<ChildReclaimSources> = {}): ChildReclaimSources => ({
  events: new Map(), marks: new Map<string, ChildMark>([[SID, { kind: 'child', runId: RUN }]]),
  // Typed: an untyped literal widens `eligible` to `boolean`.
  verdicts: new Map<string, ChildReclaimSweepVerdict>([[SID, { eligible: true, runId: RUN }]]),
  defers: new Map(), fleetPaused: false, nowMs: AT + 60_000, ...over,
});
const mirrored = (act: string, outcome: string, at: number, refusal: string | null = null): MirroredLifecycleEvent =>
  ({ act, outcome, at, refusal, id: SID }) as unknown as MirroredLifecycleEvent;
/** A sweep entry as the chip reads it: the decision clocks are the lane's monotonic ones (never an epoch), `bornAt`
 *  is the idle null, `markerRunId` is the marker's own run, and the two fields the chip reads are the caller's. */
const entry = (firstDeferredAt: number | null, firstPresenceDeferredAt: number | null = null, consecutiveFailures = 0) =>
  ({ ...childReclaimFirstSighting(5_000, null, RUN), firstDeferredAt, firstPresenceDeferredAt, consecutiveFailures });

describe('withChildReclaim — the composer GET /api/runs calls', () => {
  it('keeps every other field and sets childReclaim on each row', () => {
    const r = run({});
    expect(withChildReclaim([r], src())).toEqual([{ ...r, childReclaim: pending }]);
  });

  it('reads THIS run’s generation at its closedAt: a LATER workspace under the recycled id never repaints it', () => {
    const events = new Map([[SID, [
      mirrored('create', 'done', AT - 50_000), mirrored('reclaim', 'done', AT + 1_000),
      mirrored('create', 'done', AT + 60_000), mirrored('reclaim', 'refused', AT + 70_000, 'held'),
    ]]]);
    expect(withChildReclaim([run({})], src({ events }))[0]!.childReclaim)
      .toEqual({ word: 'reclaimed', sentence: S.reclaimed, at: AT + 1_000 });
  });

  it('an OLDER workspace’s reclaim under the recycled id never paints this run', () => {
    const events = new Map([[SID, [
      mirrored('create', 'done', AT - 100_000), mirrored('reclaim', 'done', AT - 90_000),
      mirrored('create', 'done', AT - 50_000),
    ]]]);
    expect(withChildReclaim([run({})], src({ events }))[0]!.childReclaim).toEqual(pending);
  });

  it('derives "another run is open on this session" from the SAME list it composes', () => {
    const closed = run({ id: RUN });
    const open = run({ id: RUN + 1, state: 'working', closedAt: null });
    const out = withChildReclaim([closed, open], src());
    expect(out.map((r) => r.childReclaim)).toEqual([null, null]);
  });

  it('keeps a review child until the run it reviewed is TERMINAL in the SAME list, absent included (spec §5.7)', () => {
    const review = run({ id: RUN, kind: 'review', reviews: 40 });
    const reviewed = (state: RunState): RunSummary =>
      run({ id: 40, state, sessionId: 'ccrc-pwa-work-reef', closedAt: state === 'working' ? null : AT });
    // Open in the list: kept.
    expect(withChildReclaim([reviewed('working'), review], src())[1]!.childReclaim).toEqual(reviewKept);
    // Terminal in the list: like any other child.
    expect(withChildReclaim([reviewed('done'), review], src())[1]!.childReclaim).toEqual(pending);
    // ABSENT from the list: not known to be terminal, so kept, never the plain
    // pending answer.
    expect(withChildReclaim([review], src())[0]!.childReclaim).toEqual(reviewKept);
  });

  it('lets an intent newer than an outcome decide: the row rule, not the older attempt’s answer (spec §5.9)', () => {
    const events = new Map([[SID, [
      mirrored('create', 'done', AT - 50_000),
      mirrored('reclaim', 'refused', AT + 1_000, 'containment-unproven'),
      mirrored('reclaim', 'intent', AT + 2_000),
    ]]]);
    expect(withChildReclaim([run({})], src({ events }))[0]!.childReclaim).toEqual(pending);
    // With no marked row left, the row rule says nothing: an attempt in flight
    // is not reported as the older refusal.
    expect(withChildReclaim([run({})], src({ events, marks: new Map() }))[0]!.childReclaim).toBeNull();
  });

  it('reads the fleet-wide switch off its source', () => {
    expect(withChildReclaim([run({})], src({ fleetPaused: true }))[0]!.childReclaim).toEqual(switchPaused);
  });

  it('looks no event up for a terminal run with no closedAt (a reconstructed row)', () => {
    const out = withChildReclaim([run({ closedAt: null })],
      src({ events: new Map([[SID, [mirrored('reclaim', 'done', AT + 1)]]]) }));
    expect(out[0]!.childReclaim).toEqual(pending);
  });

  it('reads the registry view as never-listed when the watcher has not listed it', () => {
    expect(withChildReclaim([run({})], src({ marks: null }))[0]!.childReclaim).toBeNull();
  });

  it('reads the sweep’s entry as a defer only once the sweep has started one', () => {
    const tracked = src({ defers: new Map([[SID, entry(null)]]) });
    expect(withChildReclaim([run({})], tracked)[0]!.childReclaim).toEqual(pending);
    const deferring = src({ defers: new Map([[SID, entry(AT + 9_000)]]) });
    expect(withChildReclaim([run({})], deferring)[0]!.childReclaim)
      .toEqual({ word: 'deferred', sentence: S.sweepDeferred, at: AT + 9_000 });
  });

  it('dates a defer from the first deferral of ANY kind, never the presence clock (spec §5.7)', () => {
    // A sibling-open defer first, a presence defer later: the chip's `at` is
    // the first. (The case above already holds that a non-presence defer
    // alone, `firstPresenceDeferredAt: null`, reads deferred.)
    const both = src({ defers: new Map([[SID, entry(AT + 9_000, AT + 20_000)]]) });
    expect(withChildReclaim([run({})], both)[0]!.childReclaim)
      .toEqual({ word: 'deferred', sentence: S.sweepDeferred, at: AT + 9_000 });
  });

  it('asks the store only for sessions of terminal rows that have a closedAt, each once', () => {
    expect(childReclaimSessions([
      run({ id: 1 }), run({ id: 2 }), run({ id: 3, sessionId: 'ccrc-pwa-open-one', state: 'working', closedAt: null }),
      run({ id: 4, sessionId: 'ccrc-pwa-rebuilt', closedAt: null }), run({ id: 5, sessionId: null }),
    ])).toEqual([SID]);
  });

  // ── the sweep's last verdict, as the watcher holds it (spec §5.9) ──────────
  it('reads "no judging pass since this process started" (null) as unjudged, never as eligible', () => {
    expect(withChildReclaim([run({})], src({ verdicts: null }))[0]!.childReclaim).toEqual(unjudged);
  });

  it('reads a session absent from the verdict map as unjudged, never as eligible', () => {
    expect(withChildReclaim([run({})], src({ verdicts: new Map() }))[0]!.childReclaim).toEqual(unjudged);
  });

  it('reads a coordinating verdict as refused, with the kept sentence', () => {
    const verdicts = new Map<string, ChildReclaimSweepVerdict>([[SID, { eligible: false, why: 'coordinating', runId: RUN }]]);
    expect(withChildReclaim([run({})], src({ verdicts }))[0]!.childReclaim)
      .toEqual(kept(CHILD_RECLAIM_SKIP.coordinating.sentence));
  });

  it('reads a kept verdict through a fleet pause: the switch never replaces it', () => {
    const verdicts = new Map<string, ChildReclaimSweepVerdict>([[SID, { eligible: false, why: 'coordinating', runId: RUN }]]);
    expect(withChildReclaim([run({})], src({ verdicts, fleetPaused: true }))[0]!.childReclaim)
      .toEqual(kept(CHILD_RECLAIM_SKIP.coordinating.sentence));
  });

  // Spec §5.6 (slugs recycle), §5.9: a kept verdict is the workspace's it was judged on, and it carries
  // the run that workspace's marker named. A pass that judged nothing keeps it while the registry moves
  // on, so a recycled slug's next workspace, marked by THIS run, can meet the old workspace's verdict.
  // It is no verdict for this run: the chip reads not-judged-yet (the switch's word under the switch),
  // never the old workspace's kept word.
  describe('a kept verdict judged under another run’s marker is no verdict for this run', () => {
    it.each(CHILD_RECLAIM_KEPT_WORDS)('%s, judged under the previous run: not judged yet; under this run: kept', (why) => {
      const under = (runId: number) => new Map<string, ChildReclaimSweepVerdict>([[SID, { eligible: false, why, runId }]]);
      expect(withChildReclaim([run({})], src({ verdicts: under(RUN - 1) }))[0]!.childReclaim).toEqual(unjudged);
      expect(withChildReclaim([run({})], src({ verdicts: under(RUN - 1), fleetPaused: true }))[0]!.childReclaim)
        .toEqual(switchPaused);
      expect(withChildReclaim([run({})], src({ verdicts: under(RUN) }))[0]!.childReclaim)
        .toEqual(kept(CHILD_RECLAIM_SKIP[why].sentence));
    });
  });

  it('reads a retired hold’s verdict (an ordinary skip carrying its release) as the ordinary pending', () => {
    const verdicts = new Map<string, ChildReclaimSweepVerdict>([[SID, {
      eligible: false, why: 'hold-retired', runId: RUN, release: { reason: 'program:w5 wave:1/2', program: 'w5', accountedRunId: RUN },
    }]]);
    expect(withChildReclaim([run({})], src({ verdicts }))[0]!.childReclaim).toEqual(pending);
  });

  it('reads the entry’s run of failed attempts as the sweep-failing sentence', () => {
    const defers = new Map([[SID, entry(null, null, 2)]]);
    expect(withChildReclaim([run({})], src({ defers }))[0]!.childReclaim).toEqual(deferredWith(S.sweepFailing));
  });

  it('reads no failing sentence off an entry with no failed attempt', () => {
    const defers = new Map([[SID, entry(null, null, 0)]]);
    expect(withChildReclaim([run({})], src({ defers }))[0]!.childReclaim).toEqual(pending);
  });

  describe('a failure run is dated from its start once it has lasted the ceiling, at the composer’s clock', () => {
    const events = new Map([[SID, [
      mirrored('create', 'done', AT - 50_000),
      mirrored('reclaim', 'failed', AT + 1_000, 'pin-failed'),
      mirrored('reclaim', 'failed', AT + 1_000 + CHILD_RECLAIM_DEFER_CEILING_MS, 'pin-failed'),
    ]]]);

    it('at exactly the ceiling → the attention list’s own sentence, at the run’s start', () => {
      expect(withChildReclaim([run({})], src({ events, nowMs: AT + 1_000 + CHILD_RECLAIM_DEFER_CEILING_MS }))[0]!.childReclaim)
        .toEqual({ word: 'deferred', sentence: childReclaimFailingSentence(lcRefusalWord('pin-failed')), at: AT + 1_000 });
    });

    it('inside the ceiling → the latest failure’s own word, at its own time', () => {
      expect(withChildReclaim([run({})], src({ events, nowMs: AT + 2_000 }))[0]!.childReclaim)
        .toEqual({ word: 'deferred', sentence: lcRefusalWord('pin-failed'), at: AT + 1_000 + CHILD_RECLAIM_DEFER_CEILING_MS });
    });

    it('reads the failure run inside THIS run’s generation: an older workspace’s failure under the recycled id does not date it (spec §5.6)', () => {
      // The older workspace's failure is a million milliseconds before the run closed; the run's own workspace
      // has failed once, a second ago. A run read across the fence would start at the older failure and read as
      // past the ceiling, in the failing sentence, dated by a workspace that no longer exists.
      const recycled = new Map([[SID, [
        mirrored('create', 'done', AT - 1_100_000), mirrored('reclaim', 'failed', AT - 1_000_000, 'pin-failed'),
        mirrored('create', 'done', AT - 50_000), mirrored('reclaim', 'failed', AT + 1_000, 'pin-failed'),
      ]]]);
      expect(withChildReclaim([run({})], src({ events: recycled, nowMs: AT + 60_000 }))[0]!.childReclaim)
        .toEqual({ word: 'deferred', sentence: lcRefusalWord('pin-failed'), at: AT + 1_000 });
    });

    it('a held verdict outranks the failure run, past the ceiling too', () => {
      const verdicts = new Map<string, ChildReclaimSweepVerdict>([[SID, { eligible: false, why: 'held' }]]);
      expect(withChildReclaim([run({})], src({ events, verdicts, nowMs: AT + 1_000 + CHILD_RECLAIM_DEFER_CEILING_MS }))[0]!.childReclaim)
        .toEqual(deferredWith(CHILD_RECLAIM_SKIP.held.sentence));
    });

    it('a run of pre-lock refusals is a failure run too: past the ceiling it reads the failing sentence', () => {
      const lockEvents = new Map([[SID, [
        mirrored('create', 'done', AT - 50_000),
        mirrored('reclaim', 'refused', AT + 1_000, 'flock-unavailable'),
        mirrored('reclaim', 'refused', AT + 1_000 + CHILD_RECLAIM_DEFER_CEILING_MS, 'lock-unopenable'),
      ]]]);
      expect(withChildReclaim([run({})], src({ events: lockEvents, nowMs: AT + 1_000 + CHILD_RECLAIM_DEFER_CEILING_MS }))[0]!.childReclaim)
        .toEqual({ word: 'deferred', sentence: childReclaimFailingSentence(lcRefusalWord('lock-unopenable')), at: AT + 1_000 });
    });
  });
});
