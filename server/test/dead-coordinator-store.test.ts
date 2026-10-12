// The dead-coordinator lane's STORE half (workspace lifecycle spec 2026-09-24 §5.4, wave 4): the durable first-dead
// anchor (`dead_claimants`, migration 18 — "the hour is the lane's own observation, made durable"), the journal
// clause's ONE read of the lifecycle mirror, and `closeRun`'s compare-and-set: the transaction commits only while
// `claimedBy` still names the crashed id.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { parseJournalLine, type JournalRow } from '../src/coord/journalparse.js';
import { parseStallDetail } from '../src/coord/stall.js';
import { mkTmp } from './tmpHelpers.js';

const dbPath = (): string => path.join(mkTmp('ccrc-dead-store-'), '.ccrc', 'coord.db');
const GEN = '1790000000000000000';
const T = 1_790_000_000_000;
let seq = 0;
const line = (id: string, act: string, outcome: string, over: Record<string, unknown> = {}): JournalRow =>
  parseJournalLine(JSON.stringify({ v: 1, uid: `w4dc.1.${++seq}`, at: T + seq, act, outcome, id, dec: { surface: 'none' }, ...over }));

describe('the durable first-dead anchor (migration 18)', () => {
  it('starts empty; a row is written, moved and deleted by the claimant id', () => {
    const s = new CoordStore(openCoordDb(dbPath()));
    expect(s.deadAnchors()).toEqual({ ok: true, anchors: new Map() });
    s.setDeadAnchor('demo-c-a', { firstDeadAt: 10, lastDeadAt: 10 });
    s.setDeadAnchor('demo-c-a', { firstDeadAt: 10, lastDeadAt: 70 });
    s.setDeadAnchor('demo-c-b', { firstDeadAt: 20, lastDeadAt: 20 });
    expect(s.deadAnchors()).toEqual({ ok: true, anchors: new Map([
      ['demo-c-a', { firstDeadAt: 10, lastDeadAt: 70 }], ['demo-c-b', { firstDeadAt: 20, lastDeadAt: 20 }]]) });
    s.deleteDeadAnchor('demo-c-a');
    s.deleteDeadAnchor('demo-never-there');
    expect(s.deadAnchors()).toEqual({ ok: true, anchors: new Map([['demo-c-b', { firstDeadAt: 20, lastDeadAt: 20 }]]) });
  });

  it('survives a reopen — the hour is durable across a restart', () => {
    const p = dbPath();
    const a = openCoordDb(p);
    new CoordStore(a).setDeadAnchor('demo-c-a', { firstDeadAt: 10, lastDeadAt: 70 });
    a.close();
    expect(new CoordStore(openCoordDb(p)).deadAnchors())
      .toEqual({ ok: true, anchors: new Map([['demo-c-a', { firstDeadAt: 10, lastDeadAt: 70 }]]) });
  });

  it('a row whose integers this process cannot represent fails the WHOLE read — never a partial map', () => {
    const db = openCoordDb(dbPath());
    const s = new CoordStore(db);
    s.setDeadAnchor('demo-c-a', { firstDeadAt: 10, lastDeadAt: 10 });
    db.exec("INSERT INTO dead_claimants (claimantId, firstDeadAt, lastDeadAt) VALUES ('demo-c-b', 'soon', 20)");
    expect(s.deadAnchors()).toMatchObject({ ok: false });
  });
});

describe('the journal clause’s ONE read of the mirror', () => {
  it('answers every asked id: the clause’s acts oldest first, and whether the mirror holds ANY row for it', () => {
    const s = new CoordStore(openCoordDb(dbPath()));
    s.ingestJournal({ gen: GEN, cursor: 900, size: 900, at: 9, rows: [
      line('demo-c-a', 'create', 'done'),
      line('demo-c-a', 'start', 'done'),
      line('demo-c-a', 'spawn', 'done', { meas: { rc: '0', wrapper: 'claude' } }),
      line('demo-c-a', 'hold', 'done'),
      line('demo-c-a', 'stop', 'done', { dec: { surface: 'pwa' } }),
      line('demo-c-a', 'swap', 'done'),
      line('demo-c-b', 'create', 'done'),
    ] });
    const r = s.deadCoordinatorJournalRows(['demo-c-a', 'demo-c-b', 'demo-c-c']);
    expect([...r.keys()].sort()).toEqual(['demo-c-a', 'demo-c-b', 'demo-c-c']);
    expect(r.get('demo-c-a')!.rows.map((x) => x.act)).toEqual(['spawn', 'stop']);
    expect(r.get('demo-c-a')!.rows[0]!.raw, 'the line verbatim — ccd wrote the rc as a string').toContain('"rc":"0"');
    expect(r.get('demo-c-a')!.rows[0]!.gen, 'the generation it was read from, which places a gap before or after it').toBe(GEN);
    expect(r.get('demo-c-a')!.rows[1]!.dec?.surface).toBe('pwa');
    expect(r.get('demo-c-a')!.hasHistory).toBe(true);
    expect(r.get('demo-c-b')).toEqual({ rows: [], hasHistory: true });
    expect(r.get('demo-c-c')).toEqual({ rows: [], hasHistory: false });
  });

  it('asks nothing of an empty list', () => {
    expect(new CoordStore(openCoordDb(dbPath())).deadCoordinatorJournalRows([])).toEqual(new Map());
  });

  it('names EVERY generation the mirror recorded lost bytes in, once each, unlimited — the journal trust’s read', () => {
    const s = new CoordStore(openCoordDb(dbPath()));
    expect(s.lifecycleGapGens()).toEqual([]);
    const gap = (gen: string, reason: 'shrank' | 'rotated-away' | 'unknown') => s.recordGap({ at: T, gen, reason,
      detail: 'd', lostFrom: reason === 'unknown' ? null : 0, lostTo: reason === 'unknown' ? null : 10 });
    for (let k = 0; k < 120; k += 1) gap(GEN, 'shrank');
    gap('1780000000000000000', 'rotated-away');
    gap('lifecycle.unplaceable.jsonl', 'unknown');
    expect(s.lifecycleGapGens().sort()).toEqual(['1780000000000000000', GEN, 'lifecycle.unplaceable.jsonl']);
  });
});

describe('closeRun’s compare-and-set — commits only while claimedBy names the crashed id', () => {
  const opened = () => {
    const s = new CoordStore(openCoordDb(dbPath()));
    const r = s.openRun({ program: 'p', title: 'p', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-c-a' });
    if (!('id' in r)) throw new Error('openRun refused');
    s.markDispatched(r.id, 'demo-w', 'demo-w', 'ws/w', false);
    if (!s.advance(r.id, 'dispatched', 'test').ok) throw new Error('advance refused');
    return { s, id: r.id };
  };

  it('the claimant still the crashed id: the close commits', () => {
    const { s, id } = opened();
    expect(s.closeRun({ runId: id, finalState: 'failed', causedBy: 'sweep', handoffCommit: null, program: 'p',
      viaClosing: true, expectClaimedBy: 'demo-c-a' })).toMatchObject({ ok: true, to: 'failed' });
  });

  it('a successor took the programme: claimant-changed, and NOTHING moved — no state, no event, no cancelled mail', () => {
    const { s, id } = opened();
    expect(s.reclaimProgram(id, 'demo-heir', T, null)).toMatchObject({ ok: true });
    const before = s.runEvents(id).length;
    expect(s.closeRun({ runId: id, finalState: 'failed', causedBy: 'sweep', handoffCommit: null, program: 'p',
      viaClosing: true, expectClaimedBy: 'demo-c-a' })).toEqual({ ok: false, error: 'claimant-changed', claimedBy: 'demo-heir' });
    const after = s.run(id);
    expect(after.ok && after.run?.state).toBe('dispatched');
    expect(s.runEvents(id).length).toBe(before);
  });

  it('without an expectation the close is what it always was', () => {
    const { s, id } = opened();
    expect(s.reclaimProgram(id, 'demo-heir', T, null)).toMatchObject({ ok: true });
    expect(s.closeRun({ runId: id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program: 'p',
      viaClosing: true })).toMatchObject({ ok: true, to: 'failed' });
  });
});

describe('the breaker’s held set — a run_events observation, no migration (review 381, F1)', () => {
  const store = () => {
    const db = openCoordDb(dbPath());
    const s = new CoordStore(db);
    const open = (claimedBy: string): number => {
      const r = s.openRun({ program: `p-${claimedBy}`, title: 'p', project: 'demo', wave: 1, waveOf: null, claimedBy });
      if (!('id' in r)) throw new Error('openRun refused');
      return r.id;
    };
    return { db, s, open };
  };
  const members = [{ id: 'demo-c-a', firstDeadAt: 10 }, { id: 'demo-c-b', firstDeadAt: 20 }];

  it('no row: an empty set and NO run — which is not an unreadable read', () => {
    expect(store().s.deadCoordinatorBreakerHeldLatest()).toEqual({ ok: true, held: [], runId: null });
  });

  it('round-trips the members with their first-dead instants, on the run that carries it', () => {
    const { s, open } = store();
    const run = open('demo-c-a');
    expect(s.recordDeadCoordinatorBreakerHeld(run, members, 100)).toMatchObject({ recorded: true });
    expect(s.deadCoordinatorBreakerHeldLatest()).toEqual({ ok: true, held: members, runId: run });
  });

  it('the LATEST row wins: a clear, then the same set again, then a clear — each a new row, no dedupe', () => {
    const { s, open } = store();
    const run = open('demo-c-a');
    expect(s.recordDeadCoordinatorBreakerHeld(run, members, 100)).toMatchObject({ recorded: true });
    expect(s.recordDeadCoordinatorBreakerHeld(run, [], 200)).toMatchObject({ recorded: true });
    expect(s.deadCoordinatorBreakerHeldLatest()).toEqual({ ok: true, held: [], runId: run });
    expect(s.recordDeadCoordinatorBreakerHeld(run, members, 300)).toMatchObject({ recorded: true });
    expect(s.deadCoordinatorBreakerHeldLatest()).toEqual({ ok: true, held: members, runId: run });
    expect(s.recordDeadCoordinatorBreakerHeld(run, [], 400)).toMatchObject({ recorded: true });
    expect(s.deadCoordinatorBreakerHeldLatest()).toEqual({ ok: true, held: [], runId: run });
  });

  it('is an OBSERVATION: fromState equals toState, so no push; and no stall parse reads it as a notice', () => {
    const { s, open } = store();
    const run = open('demo-c-a');
    const w = s.recordDeadCoordinatorBreakerHeld(run, members, 100);
    if (!w.recorded) throw new Error('not recorded');
    const pushable = s.runEventsSince(0).find((e) => e.eventId === w.eventId);
    const held = s.runEvents(run).filter((e) => (e.detail ?? '').startsWith('dead-coordinator-breaker-held:'));
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ fromState: 'planned', toState: 'planned', causedBy: 'operator' });
    expect(pushable, 'the pushNewRuns read sees it, and skips it: not a transition').toMatchObject({ runId: run });
    expect(pushable!.fromState).toBe(pushable!.toState);
    const seen = s.stallObservationsSince(0);
    expect(seen.ok && seen.rows.some((r) => (r.detail ?? '').startsWith('dead-coordinator-breaker-held:'))).toBe(true);
    for (const r of seen.ok ? seen.rows : []) {
      if ((r.detail ?? '').startsWith('dead-coordinator-breaker-held:')) expect(parseStallDetail(r.detail)).toBeNull();
    }
  });

  it('an absent run writes nothing; an instant or a string the encoding cannot carry exactly writes nothing — both said out loud', () => {
    const { s, open } = store();
    const run = open('demo-c-a');
    expect(s.recordDeadCoordinatorBreakerHeld(999, members, 100)).toEqual({ recorded: false, why: 'run-gone' });
    expect(s.recordDeadCoordinatorBreakerHeld(run, [{ id: 'demo-c-a', firstDeadAt: 0 }], 100)).toEqual({ recorded: false, why: 'unencodable' });
    expect(s.recordDeadCoordinatorBreakerHeld(run, [{ id: 'demo-\ud800', firstDeadAt: 10 }], 100), 'a lone surrogate has no UTF-8 spelling').toEqual({ recorded: false, why: 'unencodable' });
    expect(s.deadCoordinatorBreakerHeldLatest()).toEqual({ ok: true, held: [], runId: null });
  });

  it('EVERY id is carried: the separators, a space, a percent sign, a non-ASCII character and a leading byte-order mark round-trip exactly (percent-escaped on write, decoded on read)', () => {
    const { s, open } = store();
    const run = open('demo-c-a');
    const odd = [{ id: 'a b', firstDeadAt: 5 }, { id: 'a,b@1', firstDeadAt: 6 }, { id: 'caf\u00e9\u{1F600}', firstDeadAt: 7 },
      { id: 'p%41', firstDeadAt: 8 }, { id: 'x:y', firstDeadAt: 9 }, { id: '', firstDeadAt: 11 },
      // a LEADING byte-order mark: a default `TextDecoder` strips it, so it must be decoded with `ignoreBOM` (review 382, R1)
      { id: '\uFEFFx', firstDeadAt: 12 }];
    const w = s.recordDeadCoordinatorBreakerHeld(run, odd, 100);
    expect(w).toMatchObject({ recorded: true });
    const row = s.runEvents(run).filter((e) => (e.detail ?? '').startsWith('dead-coordinator-breaker-held:')).pop()!;
    expect(row.detail, 'safe characters stay as they are; every other byte is %XX').toContain('p%2541@8');
    expect(row.detail).toContain('caf%C3%A9%F0%9F%98%80@7');
    const got = s.deadCoordinatorBreakerHeldLatest();
    expect(got.ok && [...got.held].sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual([...odd].sort((a, b) => (a.id < b.id ? -1 : 1)));
    expect(got.ok && got.runId).toBe(run);
  });

  it('a FALLBACK member is carried with its flag — a `*` after the instant — and reads back flagged; an unflagged member reads back without the key (review 382, R2)', () => {
    const { s, open } = store();
    const run = open('demo-c-a');
    const set = [{ id: 'demo-c-a', firstDeadAt: 10, fallback: true as const }, { id: 'demo-c-b', firstDeadAt: 20 }];
    expect(s.recordDeadCoordinatorBreakerHeld(run, set, 100)).toMatchObject({ recorded: true });
    const row = s.runEvents(run).filter((e) => (e.detail ?? '').startsWith('dead-coordinator-breaker-held:')).pop()!;
    expect(row.detail).toBe('dead-coordinator-breaker-held:demo-c-a@10*,demo-c-b@20');
    const got = s.deadCoordinatorBreakerHeldLatest();
    expect(got).toEqual({ ok: true, runId: run, held: set });
    expect(got.ok && got.held[1], 'no flag key on an ordinary member').not.toHaveProperty('fallback');
  });

  it('a member carries SEVERAL instants — `id@t1+t2+t3`, ascending, the flag after the list — and reads back with its `instants`; a single-instant row still parses (review 384, F1-N1)', () => {
    const { s, open } = store();
    const run = open('demo-c-a');
    const set = [{ id: 'demo-c-a', firstDeadAt: 10, instants: [10, 15, 30], fallback: true as const }, { id: 'demo-c-b', firstDeadAt: 20, instants: [20, 25] }, { id: 'demo-c-c', firstDeadAt: 40 }];
    expect(s.recordDeadCoordinatorBreakerHeld(run, set, 100)).toMatchObject({ recorded: true });
    const row = s.runEvents(run).filter((e) => (e.detail ?? '').startsWith('dead-coordinator-breaker-held:')).pop()!;
    expect(row.detail).toBe('dead-coordinator-breaker-held:demo-c-a@10+15+30*,demo-c-b@20+25,demo-c-c@40');
    const got = s.deadCoordinatorBreakerHeldLatest();
    expect(got).toEqual({ ok: true, runId: run, held: set });
    expect(got.ok && got.held[2], 'a single instant carries no `instants`').not.toHaveProperty('instants');
    // An unsorted or repeating `instants` is written as the ascending set.
    expect(s.recordDeadCoordinatorBreakerHeld(run, [{ id: 'demo-c-a', firstDeadAt: 15, instants: [30, 10, 15, 10] }], 200)).toMatchObject({ recorded: true });
    expect(s.deadCoordinatorBreakerHeldLatest()).toEqual({ ok: true, runId: run, held: [{ id: 'demo-c-a', firstDeadAt: 10, instants: [10, 15, 30] }] });
    expect(s.recordDeadCoordinatorBreakerHeld(run, [{ id: 'demo-c-a', firstDeadAt: 10, instants: [10, 0] }], 300), 'an instant that is not a positive safe integer').toEqual({ recorded: false, why: 'unencodable' });
  });

  it('the latest record\'s WRITE time is readable: null with no row, the row\'s `at` after one, and an unprovable time is a failed read (D-4826)', () => {
    const { db, s, open } = store();
    expect(s.deadCoordinatorBreakerHeldWrittenAt()).toEqual({ ok: true, at: null });
    const run = open('demo-c-a');
    expect(s.recordDeadCoordinatorBreakerHeld(run, members, 1234)).toMatchObject({ recorded: true });
    expect(s.deadCoordinatorBreakerHeldWrittenAt()).toEqual({ ok: true, at: 1234 });
    expect(s.recordDeadCoordinatorBreakerHeld(run, [], 5678)).toMatchObject({ recorded: true });
    expect(s.deadCoordinatorBreakerHeldWrittenAt(), 'the LATEST row').toEqual({ ok: true, at: 5678 });
    db.exec(`INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (${run}, 0, 'planned', 'planned', 'operator', 'dead-coordinator-breaker-held:')`);
    expect(s.deadCoordinatorBreakerHeldWrittenAt()).toMatchObject({ ok: false });
  });

  it('a malformed LATEST row fails the WHOLE read — never a partial set, never an older row’s', () => {
    const { db, s, open } = store();
    const run = open('demo-c-a');
    s.recordDeadCoordinatorBreakerHeld(run, members, 100);
    for (const bad of ['demo-c-a@soon', 'demo-c-a@10,demo-c-b', 'demo-c-b@20,demo-c-a@10', 'demo-c-a@10,demo-c-a@10', 'demo c@5', 'demo-c-a@010', ',',
      'demo-c-a@10+10', 'demo-c-a@15+10', 'demo-c-a@10+', 'demo-c-a@+10', 'demo-c-a@10++15', 'demo-c-a@10+0', 'demo-c-a@10+15+*', 'demo-c-a@10*+15', 'demo-c-a@10+015', 'demo-c-a@10**', 'demo-c-a@*', 'demo-c-a@10*x', 'demo-c-a@0*', 'demo-c-a@10 *', 'demo%ZZ@5', 'demo%@5', 'demo%4@5', 'demo%41@5', 'demo%e9@5', '%C3@5', 'a@b@5', 'demo-c-a@10,@5']) {
      db.exec(`INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (${run}, 300, 'planned', 'planned', 'operator', 'dead-coordinator-breaker-held:${bad}')`);
      const got = s.deadCoordinatorBreakerHeldLatest();
      expect(got, bad).toMatchObject({ ok: false });
      // The unreadable answer names the row and the run it sits on (review 382, R2): the lane warns once per row, and an
      // empty fallback set is written on that run.
      const id = (db.prepare('SELECT MAX(id) AS id FROM run_events').get() as { id: number }).id;
      expect(got, bad).toMatchObject({ ok: false, eventId: id, runId: run });
      db.exec('DELETE FROM run_events WHERE id = (SELECT MAX(id) FROM run_events)');
    }
    expect(s.deadCoordinatorBreakerHeldLatest()).toEqual({ ok: true, held: members, runId: run });
  });
});
