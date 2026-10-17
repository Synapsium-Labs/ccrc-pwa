import { describe, expect, it } from 'vitest';
import {
  STOP_DONE_GRACE_MS, STOP_DONE_HOLDS, stopDoneVerdict, type StopDoneHold, type StopDoneInput, type StopDoneRow,
} from '../src/stopDone.js';
import { PRESENCE_TTL_MS } from '../../shared/api.js';

// D-5370 (`stop-worker-at-run-done`): the pure verdict. Every hold has a case that answers `hold` with its own word
// where the base input answers `stop`, so deleting a hold's line, or reordering it behind a later one that the case
// does not trip, reds that case.

const NOW = 1_800_000_000_000;

const row = (o: Partial<StopDoneRow> = {}): StopDoneRow => ({
  id: 'project-a-quiet-basin', child: { kind: 'child', runId: 7 }, archivedAt: null, held: null, stoppedBy: null,
  unmeasured: [], statusUnmeasured: false, dialogPending: false, background: null, subagents: null, stranded: null,
  swapBlocked: null, substrate: null, bucket: 'idle', ...o,
});

const MARK_DONE = { ok: true, state: 'done', bg: 0 } as const;
const readLive = (o: Record<string, unknown>): StopDoneInput['live'] =>
  ({ kind: 'read', word: { ok: true, word: 'idle' }, turn: 'idle', mark: MARK_DONE, ...o }) as StopDoneInput['live'];

const base = (o: Partial<StopDoneInput> = {}): StopDoneInput => ({
  row: row(),
  store: {
    ok: true, last: { runId: 7, state: 'done', closedAt: NOW - STOP_DONE_GRACE_MS - 1 },
    openWorker: false, openClaimant: false, claim: false, mail: false, reviewing: false,
  },
  viewer: false, sinceStartMs: PRESENCE_TTL_MS + 1, presenceTtlMs: PRESENCE_TTL_MS, surface: true,
  live: { kind: 'read', word: { ok: true, word: 'idle' }, turn: 'idle', mark: MARK_DONE },
  now: NOW, graceMs: STOP_DONE_GRACE_MS, ...o,
});

const okStore = (o: Record<string, unknown>): StopDoneInput['store'] =>
  ({ ...(base().store as Extract<StopDoneInput['store'], { ok: true }>), ...o }) as StopDoneInput['store'];

describe('stopDoneVerdict (D-5370)', () => {
  it('a finished run\'s idle child, past the grace, with nothing holding it, is stopped — naming its run', () => {
    expect(stopDoneVerdict(base())).toEqual({ act: 'stop', runId: 7 });
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
    ['not-done', { store: okStore({ last: { runId: 7, state: 'failed', closedAt: NOW - STOP_DONE_GRACE_MS - 1 } }) }],
    ['close-unplaced', { store: okStore({ last: { runId: 7, state: 'done', closedAt: null } }) }],
    ['grace', { store: okStore({ last: { runId: 7, state: 'done', closedAt: NOW - STOP_DONE_GRACE_MS + 1 } }) }],
    ['run-worker', { store: okStore({ openWorker: true }) }],
    ['run-claimant', { store: okStore({ openClaimant: true }) }],
    ['claim', { store: okStore({ claim: true }) }],
    ['mail', { store: okStore({ mail: true }) }],
    ['reviewing', { store: okStore({ reviewing: true }) }],
    ['viewer', { viewer: true }],
    ['menu', { row: row({ dialogPending: true }) }],
    ['bucket', { row: row({ bucket: 'done' }) }],
    ['background', { row: row({ background: { count: 1, kinds: ['shell'] } }) }],
    ['roster', { row: row({ subagents: [{ name: 'a0000000000000001', startedAt: NOW }] }) }],
    ['no-surface', { surface: false }],
    ['pane', { live: readLive({ word: { ok: false, reason: 'no-pane' } }) }],
    ['live-word', { live: readLive({ word: { ok: true, word: 'shell' } }) }],
    ['turn', { live: readLive({ turn: 'busy' }) }],
    ['marker', { live: readLive({ mark: { ok: true, state: 'working', bg: 0 } }) }],
    ['marker-background', { live: readLive({ mark: { ok: true, state: 'done', bg: 1 } }) }],
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
    expect(stopDoneVerdict(base({ sinceStartMs: PRESENCE_TTL_MS }))).toEqual({ act: 'stop', runId: 7 });
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

  it('an empty roster does not hold; only a done run is a finished one (failed, abandoned and open states hold)', () => {
    expect(stopDoneVerdict(base({ row: row({ subagents: [] }) }))).toEqual({ act: 'stop', runId: 7 });
    for (const state of ['failed', 'abandoned', 'merging', 'awaiting-review', 'closing', 'working', 'planned']) {
      expect(stopDoneVerdict(base({ store: okStore({ last: { runId: 7, state, closedAt: NOW - STOP_DONE_GRACE_MS - 1 } }) })))
        .toEqual({ act: 'hold', reason: 'not-done' });
    }
  });

  it('the grace is measured from the run\'s close: exactly the grace past it stops', () => {
    expect(stopDoneVerdict(base({ store: okStore({ last: { runId: 7, state: 'done', closedAt: NOW - STOP_DONE_GRACE_MS } }) })))
      .toEqual({ act: 'stop', runId: 7 });
  });

  // Hibernation's own marker holds (spec §5.11, plan Task 17a): a finished turn whose last Stop listed nothing in the
  // background. A shell or a Monitor left running dies with the pane, and a row's `background` is null whenever its
  // hookstate aged out, so the marker is the only read that still sees it.
  it('a marker bg of -1 (the Stop could not say) holds as marker-background, like a positive count', () => {
    expect(stopDoneVerdict(base({ live: readLive({ mark: { ok: true, state: 'done', bg: -1 } }) })))
      .toEqual({ act: 'hold', reason: 'marker-background' });
  });

  it('a marker that is not ok — absent, unmeasured, malformed, foreign or stale — holds as marker; so does failed', () => {
    for (const reason of ['absent', 'unmeasured', 'malformed', 'foreign', 'stale']) {
      expect(stopDoneVerdict(base({ live: readLive({ mark: { ok: false, reason } }) })))
        .toEqual({ act: 'hold', reason: 'marker' });
    }
    expect(stopDoneVerdict(base({ live: readLive({ mark: { ok: true, state: 'failed', bg: 0 } }) })))
      .toEqual({ act: 'hold', reason: 'marker' });
  });

  it('a stale hookstate (background null) with a marker that lists a background shell still holds', () => {
    expect(stopDoneVerdict(base({ row: row({ background: null }), live: readLive({ mark: { ok: true, state: 'done', bg: 2 } }) })))
      .toEqual({ act: 'hold', reason: 'marker-background' });
  });
});
