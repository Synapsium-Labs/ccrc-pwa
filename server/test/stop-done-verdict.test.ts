import { describe, expect, it } from 'vitest';
import {
  STOP_DONE_GRACE_MS, STOP_DONE_HOLDS, STOP_DONE_PARKED_IDLE_MS, mailOnly, stopDoneVerdict, type StopDoneHold, type StopDoneInput, type StopDoneRow,
} from '../src/stopDone.js';
import { PRESENCE_TTL_MS } from '../../shared/api.js';
import { HIBERNATE_HOLDS } from '../src/coord/hibernate.js';

// D-5370 (`stop-worker-at-run-done`): the pure verdict. Since Task 17b (stop-done-composes-hibernate (D-5427)) it
// answers `hibernate`, never `stop`, and holds what hibernation holds and it lacked: `recent` (since D-6091 the grace, not N, from the marker's
// clock), `opted-out` and `scheduled` (`attached` is ccd's, at the act); `no-verb` replaces `no-surface`. Every hold has a case that answers `hold` with its own word
// where the base input answers `stop`, so deleting a hold's line, or reordering it behind a later one that the case
// does not trip, reds that case.

const NOW = 1_800_000_000_000;

const row = (o: Partial<StopDoneRow> = {}): StopDoneRow => ({
  id: 'project-a-quiet-basin', child: { kind: 'child', runId: 7 }, archivedAt: null, held: null, stoppedBy: null,
  unmeasured: [], statusUnmeasured: false, dialogPending: false, background: null, subagents: null, stranded: null,
  swapBlocked: null, substrate: null, bucket: 'idle', ...o,
});

const HOUR = 60 * 60_000;
const MARK_DONE = { ok: true, state: 'done', bg: 0, crons: 0, turnAt: NOW - 7 * HOUR - 60_000, stopAt: NOW - 7 * HOUR, restartAt: null } as const;
const markAt = (o: Record<string, unknown>) => ({ ...MARK_DONE, ...o });
const readLive = (o: Record<string, unknown>): StopDoneInput['live'] =>
  ({ kind: 'read', word: { ok: true, word: 'idle' }, turn: 'idle', mark: MARK_DONE, ...o }) as StopDoneInput['live'];

const base = (o: Partial<StopDoneInput> = {}): StopDoneInput => ({
  row: row(), heldKind: 'none', holdOkVerb: true,
  store: {
    ok: true, last: { runId: 7, state: 'done', closedAt: NOW - STOP_DONE_GRACE_MS - 1 },
    openWorker: false, openClaimant: false, claim: false, mail: false,
  },
  viewer: false, sinceStartMs: PRESENCE_TTL_MS + 1, presenceTtlMs: PRESENCE_TTL_MS, verb: true, optedOut: false,
  live: { kind: 'read', word: { ok: true, word: 'idle' }, turn: 'idle', mark: MARK_DONE },
  now: NOW, graceMs: STOP_DONE_GRACE_MS, ...o,
});

const okStore = (o: Record<string, unknown>): StopDoneInput['store'] =>
  ({ ...(base().store as Extract<StopDoneInput['store'], { ok: true }>), ...o }) as StopDoneInput['store'];

describe('stopDoneVerdict (D-5370)', () => {
  it('a finished run\'s idle child, past the grace, with nothing holding it, is put to sleep — naming its run and its idle time', () => {
    expect(stopDoneVerdict(base())).toEqual({ act: 'hibernate', runId: 7, idleMs: 7 * HOUR });
  });

  it('with the live state unread and nothing else holding, it asks to measure — never a stop unmeasured', () => {
    expect(stopDoneVerdict(base({ live: { kind: 'unread' } }))).toEqual({ act: 'measure' });
  });

  const cases: [StopDoneHold, Partial<StopDoneInput>][] = [
    ['not-a-child', { row: row({ child: { kind: 'none' } }) }],
    ['child-unreadable', { row: row({ child: { kind: 'unreadable' } }) }],
    ['archived', { row: row({ archivedAt: 1_700_000_000 }) }],
    ['stopped', { row: row({ stoppedBy: { at: NOW - 1, surface: 'agent' } }) }],
    ['unmeasured', { row: row({ unmeasured: ['uuid'] as StopDoneRow['unmeasured'] }) }],
    ['held', { row: row({ held: 'wave 3' }) }],
    ['stranded', { row: row({ stranded: { at: NOW, reason: 'r' } }) }],
    ['swap-blocked', { row: row({ swapBlocked: { at: NOW, reason: 'r' } }) }],
    ['substrate', { row: row({ substrate: { at: NOW, text: 't' } }) }],
    ['runs-unreadable', { store: { ok: false, detail: 'locked' } }],
    ['no-run', { store: okStore({ last: null }) }],
    ['not-done', { store: okStore({ last: { runId: 7, state: 'working', closedAt: null } }) }],
    ['close-unplaced', { store: okStore({ last: { runId: 7, state: 'done', closedAt: null } }) }],
    ['grace', { store: okStore({ last: { runId: 7, state: 'done', closedAt: NOW - STOP_DONE_GRACE_MS + 1 } }) }],
    ['run-worker', { store: okStore({ openWorker: true }) }],
    ['run-claimant', { store: okStore({ openClaimant: true }) }],
    ['claim', { store: okStore({ claim: true }) }],
    ['mail', { store: okStore({ mail: true }) }],
    ['viewer', { viewer: true }],
    ['menu', { row: row({ dialogPending: true }) }],
    ['bucket', { row: row({ bucket: 'done' }) }],
    ['background', { row: row({ background: { count: 1, kinds: ['shell'] } }) }],
    ['roster', { row: row({ subagents: [{ name: 'a0000000000000001', startedAt: NOW }] }) }],
    ['no-verb', { verb: false }],
    ['opted-out', { optedOut: true }],
    ['pane', { live: readLive({ word: { ok: false, reason: 'no-pane' } }) }],
    ['live-word', { live: readLive({ word: { ok: true, word: 'shell' } }) }],
    ['turn', { live: readLive({ turn: 'busy' }) }],
    ['marker', { live: readLive({ mark: markAt({ state: 'working' }) }) }],
    ['marker-background', { live: readLive({ mark: markAt({ bg: 1 }) }) }],
    ['scheduled', { live: readLive({ mark: markAt({ crons: 1 }) }) }],
    ['recent', { live: readLive({ mark: markAt({ stopAt: NOW - 5 * 60_000, turnAt: NOW - 5 * 60_000 }) }) }],
  ];

  for (const [hold, o] of cases) {
    it(`holds ${hold}`, () => {
      expect(stopDoneVerdict(base(o))).toEqual({ act: 'hold', reason: hold });
    });
  }

  it('every hold in STOP_DONE_HOLDS has its case above', () => {
    expect(new Set(cases.map(([h]) => h))).toEqual(new Set(STOP_DONE_HOLDS));
  });

  it('a viewer is assumed for one presence TTL after the server starts (presence is never persisted)', () => {
    expect(stopDoneVerdict(base({ sinceStartMs: PRESENCE_TTL_MS - 1 }))).toEqual({ act: 'hold', reason: 'viewer' });
    expect(stopDoneVerdict(base({ sinceStartMs: PRESENCE_TTL_MS }))).toEqual({ act: 'hibernate', runId: 7, idleMs: 7 * HOUR });
  });

  it('every unmeasured live read holds as unmeasured — the live file, a missing config dir as pane, the turn verdict', () => {
    expect(stopDoneVerdict(base({ live: readLive({ word: { ok: false, reason: 'unmeasured' } }) })))
      .toEqual({ act: 'hold', reason: 'unmeasured' });
    expect(stopDoneVerdict(base({ live: readLive({ word: { ok: false, reason: 'no-config-dir' } }) })))
      .toEqual({ act: 'hold', reason: 'pane' });
    expect(stopDoneVerdict(base({ live: readLive({ turn: 'unmeasured' }) })))
      .toEqual({ act: 'hold', reason: 'unmeasured' });
    expect(stopDoneVerdict(base({ row: row({ statusUnmeasured: true }) }))).toEqual({ act: 'hold', reason: 'unmeasured' });
  });

  it('every live word but idle holds — busy and waiting as well as shell', () => {
    for (const word of ['busy', 'waiting', 'shell', 'something-newer']) {
      expect(stopDoneVerdict(base({ live: readLive({ word: { ok: true, word } }) })))
        .toEqual({ act: 'hold', reason: 'live-word' });
    }
  });

  it('every bucket but idle holds — done (badged) first, then working, attention and dead', () => {
    for (const bucket of ['done', 'working', 'attention', 'dead'] as const) {
      expect(stopDoneVerdict(base({ row: row({ bucket }) }))).toEqual({ act: 'hold', reason: 'bucket' });
    }
  });

  it('an empty roster does not hold; a run outside done, failed and the parked states is not a finished one (D-6092)', () => {
    expect(stopDoneVerdict(base({ row: row({ subagents: [] }) }))).toEqual({ act: 'hibernate', runId: 7, idleMs: 7 * HOUR });
    for (const state of ['abandoned', 'dispatched', 'working', 'unknown', 'planned', 'some-future-state']) {
      expect(stopDoneVerdict(base({ store: okStore({ last: { runId: 7, state, closedAt: NOW - STOP_DONE_GRACE_MS - 1 } }) })))
        .toEqual({ act: 'hold', reason: 'not-done' });
    }
  });

  it('the grace is measured from the run\'s close: exactly the grace past it stops', () => {
    expect(stopDoneVerdict(base({ store: okStore({ last: { runId: 7, state: 'done', closedAt: NOW - STOP_DONE_GRACE_MS } }) })))
      .toEqual({ act: 'hibernate', runId: 7, idleMs: 7 * HOUR });
  });

  // Hibernation's own marker holds (spec §5.11, plan Task 17a): a finished turn whose last Stop listed nothing in the
  // background. A shell or a Monitor left running dies with the pane, and a row's `background` is null whenever its
  // hookstate aged out, so the marker is the only read that still sees it.
  it('a marker bg of -1 (the Stop could not say) holds as marker-background, like a positive count', () => {
    expect(stopDoneVerdict(base({ live: readLive({ mark: markAt({ bg: -1 }) }) })))
      .toEqual({ act: 'hold', reason: 'marker-background' });
  });

  it('a marker that is not ok — absent, unmeasured, malformed, foreign or stale — holds as marker; so does failed', () => {
    for (const reason of ['absent', 'unmeasured', 'malformed', 'foreign', 'stale']) {
      expect(stopDoneVerdict(base({ live: readLive({ mark: { ok: false, reason } }) })))
        .toEqual({ act: 'hold', reason: 'marker' });
    }
    expect(stopDoneVerdict(base({ live: readLive({ mark: markAt({ state: 'failed' }) }) })))
      .toEqual({ act: 'hold', reason: 'marker' });
  });

  it('a stale hookstate (background null) with a marker that lists a background shell still holds', () => {
    expect(stopDoneVerdict(base({ row: row({ background: null }), live: readLive({ mark: markAt({ bg: 2 }) }) })))
      .toEqual({ act: 'hold', reason: 'marker-background' });
  });

  // TASK 17b's absorbed holds (D-5427): what hibernation holds and this lane lacked.
  it('a marker with no crons (an older hook) holds as scheduled; so does -1', () => {
    for (const crons of [null, -1]) {
      expect(stopDoneVerdict(base({ live: readLive({ mark: markAt({ crons }) }) }))).toEqual({ act: 'hold', reason: 'scheduled' });
    }
  });

  it('every hold this lane shares with hibernation is spelled in hibernation\'s words (the absorption)', () => {
    const own = new Set(['not-a-child', 'child-unreadable', 'stopped', 'no-run', 'not-done', 'close-unplaced', 'grace',
      'no-verb', 'turn']);
    const hib = new Set<string>(HIBERNATE_HOLDS);
    expect(STOP_DONE_HOLDS.filter((h) => !own.has(h) && !hib.has(h))).toEqual([]);
    expect(HIBERNATE_HOLDS.filter((h) => !(STOP_DONE_HOLDS as readonly string[]).includes(h)), 'every hibernation hold is the lane\'s too').toEqual([]);
  });
});

// D-6091 (fleet capacity W1-1), the characterization: today's answer for every row the behaviour commit flips ("today:"),
// and the rows it must not flip ("kept:"). Neutral fixtures: programme `programme-a`, run 7.
describe('stopDoneVerdict: run-close timing, before and after (D-6091)', () => {
  const MIN = 60_000;
  const closedAgo = (ms: number) => okStore({ last: { runId: 7, state: 'done', closedAt: NOW - ms } });
  const quietFor = (ms: number) => readLive({ mark: markAt({ turnAt: NOW - ms, stopAt: NOW - ms }) });

  // The "today:" rows, flipped by the behaviour commit (the operator's 2026-10-17 ruling; F5 (0), 2026-10-20).
  it('now: (a) a done child 11 minutes after close, its marker quiet 11 minutes, sleeps (was: recent)', () => {
    expect(stopDoneVerdict(base({ store: closedAgo(11 * MIN), live: quietFor(11 * MIN) })))
      .toEqual({ act: 'hibernate', runId: 7, idleMs: 11 * MIN });
  });

  it('now: (b) a programme hold passes, carrying its text (was: held)', () => {
    const held = 'program:programme-a wave:3';
    expect(stopDoneVerdict(base({ row: row({ held }), heldKind: 'programme' })))
      .toEqual({ act: 'hibernate', runId: 7, idleMs: 7 * HOUR, holdOk: held });
  });

  it('now: (c) a programme hold naming a done run passes (was: held)', () => {
    const held = 'program:programme-a wave:2 run:7';
    expect(stopDoneVerdict(base({ row: row({ held }), heldKind: 'run-terminal' })))
      .toEqual({ act: 'hibernate', runId: 7, idleMs: 7 * HOUR, holdOk: held });
  });

  it('now: (d) the reviewing hold is gone from the run-done policy (was: reviewing)', () => {
    expect(STOP_DONE_HOLDS).not.toContain('reviewing');
  });

  it('kept: an operator .hold holds', () => {
    expect(stopDoneVerdict(base({ row: row({ held: 'keep: debugging' }), heldKind: 'operator' }))).toEqual({ act: 'hold', reason: 'held' });
  });

  it('kept: outstanding mail holds', () => {
    expect(stopDoneVerdict(base({ store: okStore({ mail: true }) }))).toEqual({ act: 'hold', reason: 'mail' });
  });

  it('kept: a viewer holds', () => {
    expect(stopDoneVerdict(base({ viewer: true }))).toEqual({ act: 'hold', reason: 'viewer' });
  });

  it('kept: a session cron holds scheduled', () => {
    expect(stopDoneVerdict(base({ live: readLive({ mark: markAt({ crons: 1 }) }) }))).toEqual({ act: 'hold', reason: 'scheduled' });
  });

  it('kept: the operator\'s opt-out holds', () => {
    expect(stopDoneVerdict(base({ optedOut: true }))).toEqual({ act: 'hold', reason: 'opted-out' });
  });

  it('W1-1b flipped this row (D-6092): an awaiting-review newest run, its marker quiet 7 hours, sleeps (was: not-done)', () => {
    expect(stopDoneVerdict(base({ store: okStore({ last: { runId: 7, state: 'awaiting-review', closedAt: null } }) })))
      .toEqual({ act: 'hibernate', runId: 7, idleMs: 7 * HOUR });
  });

  it('kept: inside the grace after close holds grace', () => {
    expect(stopDoneVerdict(base({ store: closedAgo(9 * MIN) }))).toEqual({ act: 'hold', reason: 'grace' });
  });

  it('kept: no marker stamp holds recent', () => {
    expect(stopDoneVerdict(base({ live: readLive({ mark: markAt({ turnAt: null, stopAt: null, restartAt: null }) }) })))
      .toEqual({ act: 'hold', reason: 'recent' });
  });
});

// D-6091, the new rows: the run-done policy's clock is the run's close plus the grace of turn-marker quiet, and the
// holds that guard a WORKSPACE (a programme hold, a terminal run's hold, a review, a planned run) stop holding sleep.
describe('stopDoneVerdict: finished workers sleep at run close (D-6091)', () => {
  const MIN = 60_000;
  const PROG = 'program:programme-a wave:3';
  const closed11 = okStore({ last: { runId: 7, state: 'done', closedAt: NOW - 11 * MIN } });
  const quiet = (ms: number) => readLive({ mark: markAt({ turnAt: NOW - ms, stopAt: NOW - ms }) });

  it('a programme-held finished child sleeps at 10 min, carrying the exact hold text for ccd', () => {
    expect(stopDoneVerdict(base({
      row: row({ held: PROG }), heldKind: 'programme', store: closed11, live: quiet(11 * MIN),
    }))).toEqual({ act: 'hibernate', runId: 7, idleMs: 11 * MIN, holdOk: PROG });
  });

  it('a terminal run\'s hold does not hold sleep', () => {
    const held = 'program:programme-a wave:2 run:7';
    expect(stopDoneVerdict(base({ row: row({ held }), heldKind: 'run-terminal' })))
      .toEqual({ act: 'hibernate', runId: 7, idleMs: 7 * HOUR, holdOk: held });
  });

  it('a `run:` hold whose run is open holds', () => {
    expect(stopDoneVerdict(base({ row: row({ held: 'program:programme-a wave:4 run:9' }), heldKind: 'run-live' })))
      .toEqual({ act: 'hold', reason: 'held' });
  });

  it('a `run:` hold whose run state is unreadable holds', () => {
    expect(stopDoneVerdict(base({ row: row({ held: 'program:programme-a wave:4 run:9' }), heldKind: 'unreadable' })))
      .toEqual({ act: 'hold', reason: 'held' });
  });

  it('a hold the sweep did not classify (heldKind none beside a held row) holds: fail closed', () => {
    expect(stopDoneVerdict(base({ row: row({ held: PROG }), heldKind: 'none' }))).toEqual({ act: 'hold', reason: 'held' });
  });

  it('without the hibernate-hold-ok token on the box, a programme hold still holds', () => {
    expect(stopDoneVerdict(base({ row: row({ held: PROG }), heldKind: 'programme', holdOkVerb: false })))
      .toEqual({ act: 'hold', reason: 'held' });
  });

  it('a reviewer of an open run sleeps at 10 min', () => {
    // The store read carries no review at all now: the sweep no longer asks `expiryReviewing` (D-6091).
    expect(stopDoneVerdict(base({ store: closed11, live: quiet(11 * MIN) })))
      .toEqual({ act: 'hibernate', runId: 7, idleMs: 11 * MIN });
  });

  it('recent is the grace from the marker\'s newest stamp: exactly the grace sleeps, a millisecond less holds', () => {
    expect(stopDoneVerdict(base({ live: quiet(STOP_DONE_GRACE_MS) })))
      .toEqual({ act: 'hibernate', runId: 7, idleMs: STOP_DONE_GRACE_MS });
    expect(stopDoneVerdict(base({ live: quiet(STOP_DONE_GRACE_MS - 1) }))).toEqual({ act: 'hold', reason: 'recent' });
    expect(stopDoneVerdict(base({ live: readLive({ mark: markAt({ restartAt: NOW - 5 * MIN }) }) })), 'a restart moves the clock')
      .toEqual({ act: 'hold', reason: 'recent' });
  });

  it('a marker that moved 9 minutes ago holds `recent`', () => {
    expect(stopDoneVerdict(base({ store: closed11, live: quiet(9 * MIN) }))).toEqual({ act: 'hold', reason: 'recent' });
  });

  it('the run-done policy reads no N: its input carries none', () => {
    expect(Object.keys(base())).not.toContain('afterMs');
  });
});

// D-6091, the excluded row's count: a finished worker that NOTHING but unread mail keeps awake. One definition, the
// verdict asked twice (with and without the mail), so no second hold order exists.
describe('mailOnly (D-6091)', () => {
  const withMail = (o: Partial<StopDoneInput> = {}) => base({ store: okStore({ mail: true }), ...o });

  it('mailOnly is true only when mail is the sole hold', () => {
    expect(mailOnly(withMail()), 'mail alone').toBe(true);
    expect(mailOnly(base()), 'no mail').toBe(false);
    expect(mailOnly(withMail({ viewer: true })), 'mail and a viewer').toBe(false);
    expect(mailOnly(withMail({ row: row({ held: 'keep: debugging' }) })), 'mail and an operator hold (earlier)').toBe(false);
    expect(mailOnly(withMail({ live: readLive({ mark: markAt({ crons: 1 }) }) })), 'mail and a cron').toBe(false);
    expect(mailOnly(withMail({ store: okStore({ mail: true, claim: true }) })), 'mail and a claim').toBe(false);
  });

  it('with the live state unread, mail beside nothing else read so far counts (the live reads are not made for it)', () => {
    expect(mailOnly(withMail({ live: { kind: 'unread' } }))).toBe(true);
  });
});


// D-6092 (fleet capacity W1-1b), the characterization: "finished" per F5 (b) (2026-10-20). The "today:" rows are the
// answers the behaviour commit flips; the "kept:" rows must not flip. Neutral fixtures: run 7.
describe('stopDoneVerdict: "finished" per F5 (b), before and after (D-6092)', () => {
  const MIN = 60_000;
  const runAt = (state: string, closedAt: number | null) => okStore({ last: { runId: 7, state, closedAt } });
  const quiet = (ms: number) => readLive({ mark: markAt({ turnAt: NOW - ms, stopAt: NOW - ms }) });

  it('now: a failed newest run, closed 11 minutes ago, its marker quiet 11 minutes, sleeps (was: not-done)', () => {
    expect(stopDoneVerdict(base({ store: runAt('failed', NOW - 11 * MIN), live: quiet(11 * MIN) })))
      .toEqual({ act: 'hibernate', runId: 7, idleMs: 11 * MIN });
  });

  for (const state of ['awaiting-review', 'merging', 'closing']) {
    it(`now: a producer parked at ${state}, its marker quiet 31 minutes, sleeps (was: not-done)`, () => {
      expect(stopDoneVerdict(base({ store: runAt(state, null), live: quiet(31 * MIN) })))
        .toEqual({ act: 'hibernate', runId: 7, idleMs: 31 * MIN });
    });
  }

  it('kept: a producer parked at awaiting-review, its marker quiet 29 minutes, holds', () => {
    expect(stopDoneVerdict(base({ store: runAt('awaiting-review', null), live: quiet(29 * MIN) })).act).toBe('hold');
  });

  for (const state of ['working', 'dispatched', 'unknown']) {
    it(`kept: an ${state === 'unknown' ? 'unknown' : 'active'} run (${state}) holds not-done, however quiet`, () => {
      expect(stopDoneVerdict(base({ store: runAt(state, null), live: quiet(7 * 60 * MIN) })))
        .toEqual({ act: 'hold', reason: 'not-done' });
    });
  }
});

// D-6092 (fleet capacity W1-1b; F5 (b), 2026-10-20), the new rows: a run is finished for the run-done policy when it is
// `done` or `failed` and closed (the grace from its close, then the grace of marker quiet), or a producer's run parked at
// `awaiting-review`, `merging` or `closing` whose marker has been quiet `STOP_DONE_PARKED_IDLE_MS`.
describe('stopDoneVerdict: finished per F5 (b) (D-6092)', () => {
  const MIN = 60_000;
  const runAt = (state: string, closedAt: number | null) => okStore({ last: { runId: 7, state, closedAt } });
  const quiet = (ms: number) => readLive({ mark: markAt({ turnAt: NOW - ms, stopAt: NOW - ms }) });

  it('the parked idle is 30 minutes, and longer than the grace', () => {
    expect(STOP_DONE_PARKED_IDLE_MS).toBe(30 * MIN);
    expect(STOP_DONE_PARKED_IDLE_MS).toBeGreaterThan(STOP_DONE_GRACE_MS);
  });

  it('a failed run\'s worker sleeps 10 minutes after close', () => {
    expect(stopDoneVerdict(base({ store: runAt('failed', NOW - STOP_DONE_GRACE_MS), live: quiet(STOP_DONE_GRACE_MS) })))
      .toEqual({ act: 'hibernate', runId: 7, idleMs: STOP_DONE_GRACE_MS });
  });

  it('a failed run inside the grace after its close holds grace', () => {
    expect(stopDoneVerdict(base({ store: runAt('failed', NOW - STOP_DONE_GRACE_MS + 1) }))).toEqual({ act: 'hold', reason: 'grace' });
  });

  it('close-unplaced holds: a failed run with no close time', () => {
    expect(stopDoneVerdict(base({ store: runAt('failed', null) }))).toEqual({ act: 'hold', reason: 'close-unplaced' });
  });

  for (const state of ['awaiting-review', 'merging', 'closing']) {
    it(`a producer parked at ${state} sleeps after 30 minutes quiet`, () => {
      expect(stopDoneVerdict(base({ store: runAt(state, null), live: quiet(STOP_DONE_PARKED_IDLE_MS) })))
        .toEqual({ act: 'hibernate', runId: 7, idleMs: STOP_DONE_PARKED_IDLE_MS });
    });
  }

  it('a parked producer quiet 29 minutes holds', () => {
    for (const state of ['awaiting-review', 'merging', 'closing']) {
      expect(stopDoneVerdict(base({ store: runAt(state, null), live: quiet(29 * MIN) })), state).toEqual({ act: 'hold', reason: 'recent' });
      expect(stopDoneVerdict(base({ store: runAt(state, null), live: quiet(STOP_DONE_PARKED_IDLE_MS - 1) })), state)
        .toEqual({ act: 'hold', reason: 'recent' });
    }
  });

  it('a parked producer whose marker carries no stamp holds recent', () => {
    expect(stopDoneVerdict(base({
      store: runAt('awaiting-review', null), live: readLive({ mark: markAt({ turnAt: null, stopAt: null, restartAt: null }) }),
    }))).toEqual({ act: 'hold', reason: 'recent' });
  });

  it('a parked run\'s clock is its marker, not a close time: a stamped closedAt does not shorten it', () => {
    expect(stopDoneVerdict(base({ store: runAt('merging', NOW - 7 * HOUR), live: quiet(11 * MIN) })))
      .toEqual({ act: 'hold', reason: 'recent' });
  });

  it('an active run holds', () => {
    for (const state of ['dispatched', 'working', 'unknown']) {
      expect(stopDoneVerdict(base({ store: runAt(state, null), live: quiet(7 * HOUR) })), state).toEqual({ act: 'hold', reason: 'not-done' });
    }
  });

  it('a planned newest run is never parked: it holds not-done', () => {
    expect(stopDoneVerdict(base({ store: runAt('planned', null), live: quiet(7 * HOUR) }))).toEqual({ act: 'hold', reason: 'not-done' });
  });

  it('every use-hold still holds a parked producer: mail, a viewer, another active run', () => {
    const parked = runAt('awaiting-review', null);
    expect(stopDoneVerdict(base({ store: okStore({ ...(parked as object), mail: true }) }))).toEqual({ act: 'hold', reason: 'mail' });
    expect(stopDoneVerdict(base({ store: parked, viewer: true }))).toEqual({ act: 'hold', reason: 'viewer' });
    expect(stopDoneVerdict(base({ store: okStore({ ...(parked as object), openWorker: true }) }))).toEqual({ act: 'hold', reason: 'run-worker' });
  });
});
