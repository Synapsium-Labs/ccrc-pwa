// D-7278 (the deps-shed arm of the run-done row; design note 2026-10-28 §4): the pure rule. Every conjunct, both
// classes, and every doubt keeping. The pass (`deps-shed-pass.test.ts`) pins what is done with an answer.
import { describe, expect, it } from 'vitest';
import {
  DEPS_SHED_HOLDS, depsShedHoldText, depsShedVerdict, type DepsShedInput, type DepsShedStoreRead,
} from '../src/depsShed.js';
import { STOP_DONE_PARKED_STATES } from '../src/stopDone.js';
import type { FleetSession } from '../../shared/api.js';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const AFTER = 24 * HOUR;
const TTL = 60_000;
const ASLEEP_AT = NOW - 30 * HOUR;

const row = (o: Partial<FleetSession> = {}): DepsShedInput['row'] => ({
  id: 'project-a-quiet-basin', workspace: 'quiet-basin', archivedAt: null,
  stoppedBy: { at: ASLEEP_AT, surface: 'agent' }, child: { kind: 'child', runId: 7 }, unmeasured: [],
  statusUnmeasured: false, held: null, ...o,
}) as DepsShedInput['row'];

const store = (o: Partial<Extract<DepsShedStoreRead, { ok: true }>> = {}): DepsShedStoreRead => ({
  ok: true, last: { runId: 7, state: 'done', closedAt: NOW - 25 * HOUR }, openWorker: false, claim: false,
  chair: { kind: 'never' }, ...o,
});

/** A sleeping worker whose run closed 25 hours ago: it sheds. */
const input = (o: Partial<DepsShedInput> = {}): DepsShedInput => ({
  row: row(), heldKind: 'none', store: store(), stamp: { kind: 'absent' }, optedOut: false, viewer: false,
  sinceStartMs: TTL + 1, viewerOpenTtlMs: TTL, verb: true, now: NOW, afterMs: AFTER, parkedAfterMs: null, ...o,
});

const word = (i: DepsShedInput): string => {
  const v = depsShedVerdict(i);
  return v.act === 'hold' ? v.reason : `shed:${v.class}`;
};

describe('depsShedVerdict (D-7278)', () => {
  it('CONTROL: a sleeping worker whose done run closed past the age sheds, as a child, on the run\'s close', () => {
    expect(depsShedVerdict(input())).toEqual({ act: 'shed', class: 'child', runId: 7, clockAt: NOW - 25 * HOUR, ageMs: 25 * HOUR });
  });
  it('a failed run counts as finished', () => {
    expect(word(input({ store: store({ last: { runId: 7, state: 'failed', closedAt: NOW - 25 * HOUR } }) }))).toBe('shed:child');
  });
  it('every hold word has its sentence', () => {
    for (const h of DEPS_SHED_HOLDS) expect(depsShedHoldText(h).length, h).toBeGreaterThan(10);
  });

  describe('the row', () => {
    it('a main checkout holds `not-a-workspace`', () => expect(word(input({ row: row({ workspace: null }) }))).toBe('not-a-workspace'));
    it('an archived row holds `archived`', () => expect(word(input({ row: row({ archivedAt: 1 }) }))).toBe('archived'));
    it('a row with no stop stamp is awake: `awake`', () => expect(word(input({ row: row({ stoppedBy: null }) }))).toBe('awake'));
    it('an unmeasured identity holds `unmeasured`', () => {
      expect(word(input({ row: row({ unmeasured: ['uuid'] as never }) }))).toBe('unmeasured');
      expect(word(input({ row: row({ statusUnmeasured: true }) }))).toBe('unmeasured');
    });
    it('an unreadable child marker holds `child-unreadable`', () => {
      expect(word(input({ row: row({ child: { kind: 'unreadable' } }) }))).toBe('child-unreadable');
    });
  });

  describe('the box and the operator', () => {
    it('a box whose ccd lacks the verb holds `no-verb`', () => expect(word(input({ verb: false }))).toBe('no-verb'));
    it('the opt-out marker holds `opted-out`', () => expect(word(input({ optedOut: true }))).toBe('opted-out'));
    it.each(['operator', 'run-live', 'unreadable'] as const)('a %s hold keeps the row (`held`)', (k) => {
      expect(word(input({ heldKind: k }))).toBe('held');
    });
    it.each(['none', 'programme', 'run-terminal'] as const)('a %s hold passes', (k) => {
      expect(word(input({ heldKind: k }))).toBe('shed:child');
    });
    it('an open screen holds `viewer`, and so does a server younger than the presence TTL', () => {
      expect(word(input({ viewer: true }))).toBe('viewer');
      expect(word(input({ sinceStartMs: TTL - 1 }))).toBe('viewer');
    });
  });

  describe('once a sleep', () => {
    it('a stamp at or after the stop stamp holds `shed`', () => {
      expect(word(input({ stamp: { kind: 'at', atMs: ASLEEP_AT } }))).toBe('shed');
      expect(word(input({ stamp: { kind: 'at', atMs: ASLEEP_AT + 1 } }))).toBe('shed');
    });
    it('a stamp from an earlier sleep passes', () => {
      expect(word(input({ stamp: { kind: 'at', atMs: ASLEEP_AT - 1 } }))).toBe('shed:child');
    });
    it('an unreadable stamp holds `stamp-unreadable`', () => {
      expect(word(input({ stamp: { kind: 'unreadable' } }))).toBe('stamp-unreadable');
    });
  });

  describe('the store', () => {
    it('an unreadable store holds `runs-unreadable`', () => {
      expect(word(input({ store: { ok: false, detail: 'locked' } }))).toBe('runs-unreadable');
    });
    it('a chair on an open run holds `claims-open-run`; one with no readable instant holds `claim-unplaced`', () => {
      expect(word(input({ store: store({ chair: { kind: 'open' } }) }))).toBe('claims-open-run');
      expect(word(input({ store: store({ chair: { kind: 'unplaced' } }) }))).toBe('claim-unplaced');
    });
    it('an active run naming it as worker holds `run-worker`; a live claim holds `claim`', () => {
      expect(word(input({ store: store({ openWorker: true }) }))).toBe('run-worker');
      expect(word(input({ store: store({ claim: true }) }))).toBe('claim');
    });
  });

  describe('a worker (a child that never coordinated in its own generation)', () => {
    it('no placed run holds `no-run`', () => expect(word(input({ store: store({ last: null }) }))).toBe('no-run'));
    it('an active newest run holds `not-done`', () => {
      expect(word(input({ store: store({ last: { runId: 7, state: 'working', closedAt: null } }) }))).toBe('not-done');
    });
    it('a finished run with no close time holds `close-unplaced`', () => {
      expect(word(input({ store: store({ last: { runId: 7, state: 'done', closedAt: null } }) }))).toBe('close-unplaced');
    });
    it('a close younger than the age holds `too-recent`; exactly the age sheds', () => {
      expect(word(input({ store: store({ last: { runId: 7, state: 'done', closedAt: NOW - AFTER + 1 } }) }))).toBe('too-recent');
      expect(word(input({ store: store({ last: { runId: 7, state: 'done', closedAt: NOW - AFTER } }) }))).toBe('shed:child');
    });
    it('the age is the configured one', () => {
      expect(word(input({ afterMs: 26 * HOUR }))).toBe('too-recent');
      expect(word(input({ afterMs: 1 }))).toBe('shed:child');
    });
    it('a chair from an EARLIER generation of the slug leaves it a worker', () => {
      expect(depsShedVerdict(input({ store: store({ chair: { kind: 'ended', at: NOW - 100 * HOUR, ownGeneration: false } }) })))
        .toMatchObject({ act: 'shed', class: 'child', runId: 7 });
    });
    describe('a run parked at review, merge or close', () => {
      it.each(STOP_DONE_PARKED_STATES)('%s holds `not-done` while the parked age is unset (A4)', (st) => {
        expect(word(input({ store: store({ last: { runId: 7, state: st, closedAt: null } }) }))).toBe('not-done');
      });
      it.each(STOP_DONE_PARKED_STATES)('%s sheds once set, on the sleep\'s own instant', (st) => {
        const i = input({ parkedAfterMs: 29 * HOUR, store: store({ last: { runId: 7, state: st, closedAt: null } }) });
        expect(depsShedVerdict(i)).toEqual({ act: 'shed', class: 'child', runId: 7, clockAt: ASLEEP_AT, ageMs: 30 * HOUR });
        expect(word({ ...i, parkedAfterMs: 31 * HOUR })).toBe('too-recent');
      });
    });
  });

  describe('a coordinator (D-7278: A3 taken)', () => {
    const coordRow = row({ id: 'lane-a-project-a', child: { kind: 'none' } } as Partial<FleetSession>);
    const ended = (atMs: number) => store({ last: null, chair: { kind: 'ended', at: atMs, ownGeneration: true } });
    it('a sleeping non-child whose last chair ended past the age sheds, as a coordinator, on the chair\'s end', () => {
      expect(depsShedVerdict(input({ row: coordRow, store: ended(NOW - 25 * HOUR) })))
        .toEqual({ act: 'shed', class: 'coordinator', runId: null, clockAt: NOW - 25 * HOUR, ageMs: 25 * HOUR });
    });
    it('a chair that ended within the age holds `too-recent`', () => {
      expect(word(input({ row: coordRow, store: ended(NOW - AFTER + 1) }))).toBe('too-recent');
    });
    it('a child that coordinated in its own generation is a coordinator, never a worker', () => {
      expect(depsShedVerdict(input({ store: store({ chair: { kind: 'ended', at: NOW - 26 * HOUR, ownGeneration: true } }) })))
        .toMatchObject({ act: 'shed', class: 'coordinator', runId: null, clockAt: NOW - 26 * HOUR });
      expect(word(input({ store: store({ chair: { kind: 'ended', at: NOW - 1, ownGeneration: true } }) }))).toBe('too-recent');
    });
    it('it still needs to be asleep, with no open chair, no active worker run and no live claim', () => {
      expect(word(input({ row: { ...coordRow, stoppedBy: null }, store: ended(NOW - 25 * HOUR) }))).toBe('awake');
      expect(word(input({ row: coordRow, store: store({ last: null, chair: { kind: 'open' } }) }))).toBe('claims-open-run');
      expect(word(input({ row: coordRow, store: { ...ended(NOW - 25 * HOUR), openWorker: true } as DepsShedStoreRead }))).toBe('run-worker');
      expect(word(input({ row: coordRow, store: { ...ended(NOW - 25 * HOUR), claim: true } as DepsShedStoreRead }))).toBe('claim');
      expect(word(input({ row: coordRow, viewer: true, store: ended(NOW - 25 * HOUR) }))).toBe('viewer');
    });
    it('a non-child that never held a chair is the operator\'s own workspace: `not-coordinated`', () => {
      expect(word(input({ row: coordRow, store: store({ last: null }) }))).toBe('not-coordinated');
    });
  });
});
