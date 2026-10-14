// The dead-coordinator lane's STORE half (workspace lifecycle spec 2026-09-24 §5.4, wave 4): the durable first-dead
// anchor (`dead_claimants`, migration 18 — "the hour is the lane's own observation, made durable"), the journal
// clause's ONE read of the lifecycle mirror, and `closeRun`'s compare-and-set: the transaction commits only while
// `claimedBy` still names the crashed id.
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { parseJournalLine, type JournalRow } from '../src/coord/journalparse.js';
import { parseStallDetail } from '../src/coord/stall.js';
import { mkTmp } from './tmpHelpers.js';

/** The slice of `DatabaseSync` a statement-failure spy wraps. */
interface DatabaseSyncLike { prepare(sql: string): unknown }

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

  it('an absent run writes nothing; a set no pass builds (an instant that is not a positive safe integer, two members with one id) writes nothing — both said out loud', () => {
    const { s, open } = store();
    const run = open('demo-c-a');
    expect(s.recordDeadCoordinatorBreakerHeld(999, members, 100)).toEqual({ recorded: false, why: 'run-gone' });
    expect(s.recordDeadCoordinatorBreakerHeld(run, [{ id: 'demo-c-a', firstDeadAt: 0 }], 100)).toEqual({ recorded: false, why: 'invalid' });
    expect(s.recordDeadCoordinatorBreakerHeld(run, [{ id: 'demo-c-a', firstDeadAt: 10 }, { id: 'demo-c-a', firstDeadAt: 20 }], 100)).toEqual({ recorded: false, why: 'invalid' });
    expect(s.deadCoordinatorBreakerHeldLatest()).toEqual({ ok: true, held: [], runId: null });
  });

  it('THE ENCODING IS TOTAL (D-4857): a LONE surrogate, high or low, leading, trailing or beside a pair, is written as `%u` and four uppercase hex digits and reads back as written', () => {
    const { s, open } = store();
    const run = open('demo-c-a');
    const lone = [{ id: 'demo-\ud800', firstDeadAt: 10 }, { id: '\udc00x', firstDeadAt: 11 }, { id: 'a\ud83d\ude00\ud83d', firstDeadAt: 12 },
      { id: '\udfff\ud800', firstDeadAt: 13 }, { id: '\ud800\ud800\udc00', firstDeadAt: 14 }];
    expect(s.recordDeadCoordinatorBreakerHeld(run, lone, 100)).toMatchObject({ recorded: true });
    const row = s.runEvents(run).filter((e) => (e.detail ?? '').startsWith('dead-coordinator-breaker-held:')).pop()!;
    expect(row.detail).toContain('demo-%uD800@10');
    expect(row.detail).toContain('a%F0%9F%98%80%uD83D@12');
    expect(row.detail, 'a pair beside a lone high surrogate: the lone one escaped, the pair as its UTF-8 bytes').toContain('%uD800%F0%90%80%80@14');
    const got = s.deadCoordinatorBreakerHeldLatest();
    expect(got.ok && [...got.held].sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual([...lone].sort((a, b) => (a.id < b.id ? -1 : 1)));
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
    expect(s.recordDeadCoordinatorBreakerHeld(run, [{ id: 'demo-c-a', firstDeadAt: 10, instants: [10, 0] }], 300), 'an instant that is not a positive safe integer').toEqual({ recorded: false, why: 'invalid' });
  });

  it('a malformed LATEST row fails the WHOLE read — never a partial set, never an older row’s', () => {
    const { db, s, open } = store();
    const run = open('demo-c-a');
    s.recordDeadCoordinatorBreakerHeld(run, members, 100);
    for (const bad of ['demo-c-a@soon', 'demo-c-a@10,demo-c-b', 'demo-c-b@20,demo-c-a@10', 'demo-c-a@10,demo-c-a@10', 'demo c@5', 'demo-c-a@010', ',',
      'demo-c-a@10+10', 'demo-c-a@15+10', 'demo-c-a@10+', 'demo-c-a@+10', 'demo-c-a@10++15', 'demo-c-a@10+0', 'demo-c-a@10+15+*', 'demo-c-a@10*+15', 'demo-c-a@10+015', 'demo-c-a@10**', 'demo-c-a@*', 'demo-c-a@10*x', 'demo-c-a@0*', 'demo-c-a@10 *', 'demo%ZZ@5', 'demo%@5', 'demo%4@5', 'demo%41@5', 'demo%e9@5', '%C3@5', 'a@b@5', 'demo-c-a@10,@5',
      // a `%u` escape that is not exactly what the writer spells (D-4857): lowercase, short, not a surrogate, a valid
      // pair split in two (the writer spells a pair as its UTF-8 bytes), a byte-escaped surrogate (not UTF-8)
      'demo%ud800@5', 'demo%uD80@5', 'demo%u0041@5', 'demo%uD83D%uDE00@5', 'demo%ED%A0%80@5', 'demo%u@5']) {
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

describe('the breaker\'s TYPED STATE — one row, dirty before any anchor change, clean only with the exact snapshot (D-4857)', () => {
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
  const held = [{ id: 'demo-c-a', firstDeadAt: 10, instants: [10, 15] }, { id: 'demo-c-b', firstDeadAt: 20, fallback: true as const }];
  const heldRows = (s: CoordStore, run: number) => s.runEvents(run).filter((e) => (e.detail ?? '').startsWith('dead-coordinator-breaker-held:'));
  /** Make one prepared statement throw, by its SQL — a statement failure inside the commit. */
  const failSql = (db: DatabaseSyncLike, re: RegExp) => {
    const real = db.prepare.bind(db);
    return vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (re.test(sql)) throw new Error(`injected: ${sql.slice(0, 40)}`);
      return real(sql);
    });
  };

  it('a fresh database has NO row: `absent`, which the lane reads as dirty — never an empty clean state', () => {
    expect(store().s.deadCoordinatorBreakerState()).toEqual({ kind: 'absent' });
  });

  it('the dirty mark is ONE statement: it creates the row (generation 1, no snapshot) and moves the generation on, keeping the snapshot it carries', () => {
    const { s } = store();
    expect(s.markDeadCoordinatorBreakerDirty(100)).toEqual({ ok: true, generation: 1 });
    expect(s.deadCoordinatorBreakerState()).toEqual({ kind: 'dirty', generation: 1, snapshot: { kind: 'none' } });
    expect(s.markDeadCoordinatorBreakerDirty(110)).toEqual({ ok: true, generation: 2 });
    expect(s.commitDeadCoordinatorBreakerState({ generation: 2, upserts: [], deletes: [], held, at: 120, record: null })).toEqual({ ok: true, generation: 3, recordedOn: null });
    expect(s.markDeadCoordinatorBreakerDirty(130)).toEqual({ ok: true, generation: 4 });
    expect(s.deadCoordinatorBreakerState(), 'dirty again, the landed snapshot still readable').toEqual({ kind: 'dirty', generation: 4, snapshot: { kind: 'members', members: held } });
  });

  it('the commit writes the exact snapshot, every anchor change and the state CLEAN in one transaction, and the run_events record on the first carrier that exists', () => {
    const { s, open } = store();
    const run = open('demo-c-a');
    s.setDeadAnchor('demo-c-gone', { firstDeadAt: 5, lastDeadAt: 6 });
    const g = s.markDeadCoordinatorBreakerDirty(100);
    if (!g.ok) throw new Error('mark failed');
    expect(s.commitDeadCoordinatorBreakerState({ generation: g.generation, at: 150, held, record: [999, run],
      upserts: [['demo-c-a', { firstDeadAt: 10, lastDeadAt: 15 }], ['demo-c-b', { firstDeadAt: 20, lastDeadAt: 20 }]], deletes: ['demo-c-gone'] }))
      .toEqual({ ok: true, generation: g.generation + 1, recordedOn: run });
    expect(s.deadCoordinatorBreakerState()).toEqual({ kind: 'clean', generation: g.generation + 1, held, writtenAt: 150 });
    expect(s.deadAnchors()).toEqual({ ok: true, anchors: new Map([['demo-c-a', { firstDeadAt: 10, lastDeadAt: 15 }], ['demo-c-b', { firstDeadAt: 20, lastDeadAt: 20 }]]) });
    expect(s.deadCoordinatorBreakerHeldLatest()).toEqual({ ok: true, held, runId: run });
    expect(heldRows(s, run).map((e) => e.at)).toEqual([150]);
  });

  it('NO CARRIER: with no run to carry the record, the table alone carries the snapshot and the commit lands', () => {
    const { s } = store();
    const g = s.markDeadCoordinatorBreakerDirty(100);
    if (!g.ok) throw new Error('mark failed');
    expect(s.commitDeadCoordinatorBreakerState({ generation: g.generation, at: 150, held, record: [999], upserts: [], deletes: [] }))
      .toEqual({ ok: true, generation: g.generation + 1, recordedOn: null });
    expect(s.deadCoordinatorBreakerState()).toMatchObject({ kind: 'clean', held });
  });

  it('a commit lands ONLY over the dirty mark it was handed: no mark, a clean row, or another writer\'s later mark refuses it, and nothing moves', () => {
    const { s } = store();
    const commit = (generation: number) => s.commitDeadCoordinatorBreakerState({ generation, at: 150, held, record: null,
      upserts: [['demo-c-a', { firstDeadAt: 10, lastDeadAt: 15 }]], deletes: [] });
    expect(commit(1), 'no row at all').toMatchObject({ ok: false });
    const g = s.markDeadCoordinatorBreakerDirty(100);
    if (!g.ok) throw new Error('mark failed');
    expect(s.markDeadCoordinatorBreakerDirty(101)).toEqual({ ok: true, generation: g.generation + 1 });
    expect(commit(g.generation), 'a later mark moved the generation').toMatchObject({ ok: false });
    expect(commit(g.generation + 1)).toMatchObject({ ok: true });
    expect(commit(g.generation + 2), 'the row is clean now').toMatchObject({ ok: false });
    expect(s.deadAnchors()).toEqual({ ok: true, anchors: new Map([['demo-c-a', { firstDeadAt: 10, lastDeadAt: 15 }]]) });
  });

  /** A crash, or a failure, at each statement of the commit leaves the OLD complete state behind it, still dirty: the
   *  snapshot as it was, no anchor moved — upserted or deleted — and no record row. */
  const boundaries: [string, RegExp | 'COMMIT'][] = [
    ['the generation check', /^SELECT CAST\(generation AS TEXT\) AS genText, CAST\(state AS TEXT\) AS state FROM dead_coordinator_breaker_state/],
    ['the snapshot and the state turning clean', /^UPDATE dead_coordinator_breaker_state/],
    ['an anchor upsert', /^INSERT INTO dead_claimants/],
    ['the run_events record', /^INSERT INTO run_events/],
    ['a staged anchor delete', /^DELETE FROM dead_claimants/],
    ['the COMMIT itself', 'COMMIT'],
  ];
  for (const [where, at] of boundaries) {
    it(`a failure at ${where} rolls the WHOLE commit back: still dirty, the old snapshot, no anchor moved, no record`, () => {
      const { db, s, open } = store();
      const run = open('demo-c-a');
      s.setDeadAnchor('demo-c-gone', { firstDeadAt: 5, lastDeadAt: 6 });
      const g0 = s.markDeadCoordinatorBreakerDirty(90);
      if (!g0.ok) throw new Error('mark failed');
      const old = [{ id: 'demo-c-a', firstDeadAt: 10 }];
      expect(s.commitDeadCoordinatorBreakerState({ generation: g0.generation, at: 95, held: old, record: null, upserts: [], deletes: [] })).toMatchObject({ ok: true });
      const anchorsBefore = s.deadAnchors();
      const g = s.markDeadCoordinatorBreakerDirty(100);
      if (!g.ok) throw new Error('mark failed');
      const spy = at === 'COMMIT'
        ? (() => { const real = db.exec.bind(db); return vi.spyOn(db, 'exec').mockImplementation((sql: string) => { if (sql === 'COMMIT') throw new Error('injected: disk I/O error'); return real(sql); }); })()
        : failSql(db as unknown as DatabaseSyncLike, at);
      const out = s.commitDeadCoordinatorBreakerState({ generation: g.generation, at: 150, held, record: [run],
        upserts: [['demo-c-a', { firstDeadAt: 10, lastDeadAt: 15 }], ['demo-c-b', { firstDeadAt: 20, lastDeadAt: 20 }]], deletes: ['demo-c-gone'] });
      spy.mockRestore();
      expect(out).toMatchObject({ ok: false });
      expect(s.deadCoordinatorBreakerState(), 'still dirty, the last landed snapshot').toEqual({ kind: 'dirty', generation: g.generation, snapshot: { kind: 'members', members: old } });
      expect(s.deadAnchors(), 'no anchor upserted or deleted').toEqual(anchorsBefore);
      expect(heldRows(s, run), 'no record row').toEqual([]);
    });
  }

  it('a lone-surrogate id is carried by the snapshot exactly — a valid clean snapshot always has a spelling', () => {
    const { s } = store();
    const odd = [{ id: 'demo-\ud800', firstDeadAt: 10 }, { id: '\udc00', firstDeadAt: 11, fallback: true as const }];
    const g = s.markDeadCoordinatorBreakerDirty(100);
    if (!g.ok) throw new Error('mark failed');
    expect(s.commitDeadCoordinatorBreakerState({ generation: g.generation, at: 150, held: odd, record: null, upserts: [], deletes: [] })).toMatchObject({ ok: true });
    const got = s.deadCoordinatorBreakerState();
    expect(got.kind === 'clean' && [...got.held].sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual([...odd].sort((a, b) => (a.id < b.id ? -1 : 1)));
  });

  it('a set no pass builds is refused before the transaction: nothing moves', () => {
    const { s } = store();
    const g = s.markDeadCoordinatorBreakerDirty(100);
    if (!g.ok) throw new Error('mark failed');
    expect(s.commitDeadCoordinatorBreakerState({ generation: g.generation, at: 150, held: [{ id: 'demo-c-a', firstDeadAt: 0 }], record: null,
      upserts: [['demo-c-a', { firstDeadAt: 10, lastDeadAt: 10 }]], deletes: [] })).toMatchObject({ ok: false });
    expect(s.deadCoordinatorBreakerState()).toEqual({ kind: 'dirty', generation: g.generation, snapshot: { kind: 'none' } });
    expect(s.deadAnchors()).toEqual({ ok: true, anchors: new Map() });
  });

  it('a row this build cannot read is `unreadable` — an unprovable generation or time, an unknown state word, a clean row with no readable snapshot, a read that throws — and a DIRTY row keeps what it can read', () => {
    const { db, s } = store();
    const put = (gen: string, state: string, heldText: string | null, at: string) => {
      db.exec('DELETE FROM dead_coordinator_breaker_state');
      db.exec('PRAGMA ignore_check_constraints = ON');
      db.prepare('INSERT INTO dead_coordinator_breaker_state (id, generation, state, held, writtenAt) VALUES (1, ?, ?, ?, ?)').run(gen, state, heldText, at);
      db.exec('PRAGMA ignore_check_constraints = OFF');
      return s.deadCoordinatorBreakerState();
    };
    const ok = 'dead-coordinator-breaker-held:demo-c-a@10';
    expect(put('soon', 'clean', ok, '5')).toMatchObject({ kind: 'unreadable' });
    expect(put('3', 'clean', ok, 'soon')).toMatchObject({ kind: 'unreadable' });
    expect(put('3', 'paused', ok, '5')).toMatchObject({ kind: 'unreadable' });
    expect(put('3', 'clean', null, '5')).toMatchObject({ kind: 'unreadable' });
    expect(put('3', 'clean', 'dead-coordinator-breaker-held:demo-c-a@soon', '5')).toMatchObject({ kind: 'unreadable' });
    expect(put('3', 'clean', ok, '5')).toEqual({ kind: 'clean', generation: 3, held: [{ id: 'demo-c-a', firstDeadAt: 10 }], writtenAt: 5 });
    expect(put('3', 'dirty', 'dead-coordinator-breaker-held:demo-c-a@soon', '5')).toMatchObject({ kind: 'dirty', generation: 3, snapshot: { kind: 'unreadable' } });
    expect(put('3', 'dirty', ok, '5')).toEqual({ kind: 'dirty', generation: 3, snapshot: { kind: 'members', members: [{ id: 'demo-c-a', firstDeadAt: 10 }] } });
    expect(put('3', 'dirty', null, '5')).toEqual({ kind: 'dirty', generation: 3, snapshot: { kind: 'none' } });
    const spy = vi.spyOn(db, 'prepare').mockImplementation(() => { throw new Error('database disk image is malformed'); });
    expect(s.deadCoordinatorBreakerState()).toEqual({ kind: 'unreadable', detail: 'database disk image is malformed' });
    spy.mockRestore();
    expect(put('soon', 'clean', ok, '5')).toMatchObject({ kind: 'unreadable' });
    expect(s.markDeadCoordinatorBreakerDirty(9), 'a malformed generation is overwritten by a dirty one, which fails shut').toMatchObject({ ok: true });
    expect(s.deadCoordinatorBreakerState()).toMatchObject({ kind: 'dirty' });
  });

  // THE SEAL (fix round 5, D-4916): `sealed` is `clean` with a witness. One generation-checked statement writes it over the
  // same snapshot; the first pass of a process that read it writes `clean` back.
  const clean = (s: CoordStore, at = 150) => {
    const g = s.markDeadCoordinatorBreakerDirty(100);
    if (!g.ok) throw new Error('mark failed');
    const c = s.commitDeadCoordinatorBreakerState({ generation: g.generation, at, held, record: null, upserts: [], deletes: [] });
    if (!c.ok) throw new Error('commit failed');
    return c.generation;
  };
  it('SEAL: a clean row at exactly the generation becomes `sealed` over the SAME snapshot and write time, the generation moved on; UNSEAL writes it back', () => {
    const { s } = store();
    const g = clean(s);
    expect(s.sealDeadCoordinatorBreakerState(g)).toEqual({ ok: true, generation: g + 1 });
    expect(s.deadCoordinatorBreakerState()).toEqual({ kind: 'sealed', generation: g + 1, held, writtenAt: 150 });
    expect(s.unsealDeadCoordinatorBreakerState(g + 1)).toEqual({ ok: true, generation: g + 2 });
    expect(s.deadCoordinatorBreakerState(), 'the same snapshot and write time').toEqual({ kind: 'clean', generation: g + 2, held, writtenAt: 150 });
  });
  it('SEAL writes NOTHING over a row that is not clean at exactly that generation: dirty, absent, already sealed, a moved generation; and UNSEAL only over sealed', () => {
    const { s } = store();
    expect(s.sealDeadCoordinatorBreakerState(1), 'absent').toMatchObject({ ok: false });
    expect(s.unsealDeadCoordinatorBreakerState(1), 'absent').toMatchObject({ ok: false });
    const g = clean(s);
    expect(s.sealDeadCoordinatorBreakerState(g - 1), 'a generation another writer moved').toMatchObject({ ok: false });
    expect(s.sealDeadCoordinatorBreakerState(g + 1), 'a generation not yet written').toMatchObject({ ok: false });
    expect(s.unsealDeadCoordinatorBreakerState(g), 'clean is not sealed').toMatchObject({ ok: false });
    expect(s.deadCoordinatorBreakerState()).toEqual({ kind: 'clean', generation: g, held, writtenAt: 150 });
    const m = s.markDeadCoordinatorBreakerDirty(200);
    if (!m.ok) throw new Error('mark failed');
    expect(s.sealDeadCoordinatorBreakerState(m.generation), 'dirty').toMatchObject({ ok: false });
    expect(s.deadCoordinatorBreakerState()).toMatchObject({ kind: 'dirty', generation: m.generation });
    const g2 = clean(s);
    expect(s.sealDeadCoordinatorBreakerState(g2)).toMatchObject({ ok: true });
    expect(s.sealDeadCoordinatorBreakerState(g2 + 1), 'already sealed').toMatchObject({ ok: false });
  });
  it('SEAL and UNSEAL are ONE statement each, and a failing statement says so and moves nothing', () => {
    const { db, s } = store();
    const g = clean(s);
    const spy = failSql(db as unknown as DatabaseSyncLike, /^UPDATE dead_coordinator_breaker_state SET state = 'sealed'/);
    expect(s.sealDeadCoordinatorBreakerState(g)).toMatchObject({ ok: false });
    spy.mockRestore();
    expect(s.deadCoordinatorBreakerState()).toMatchObject({ kind: 'clean', generation: g });
    expect(s.sealDeadCoordinatorBreakerState(g)).toMatchObject({ ok: true });
    const spy2 = failSql(db as unknown as DatabaseSyncLike, /^UPDATE dead_coordinator_breaker_state SET state = 'clean'/);
    expect(s.unsealDeadCoordinatorBreakerState(g + 1)).toMatchObject({ ok: false });
    spy2.mockRestore();
    expect(s.deadCoordinatorBreakerState()).toMatchObject({ kind: 'sealed', generation: g + 1 });
  });
  it('a `sealed` row reads like a clean one, and an unreadable one fails shut the same way: an unknown word is still `unreadable`', () => {
    const { db, s } = store();
    const put = (gen: string, state: string, heldText: string | null, at: string) => {
      db.exec('DELETE FROM dead_coordinator_breaker_state');
      db.exec('PRAGMA ignore_check_constraints = ON');
      db.prepare('INSERT INTO dead_coordinator_breaker_state (id, generation, state, held, writtenAt) VALUES (1, ?, ?, ?, ?)').run(gen, state, heldText, at);
      db.exec('PRAGMA ignore_check_constraints = OFF');
      return s.deadCoordinatorBreakerState();
    };
    const ok = 'dead-coordinator-breaker-held:demo-c-a@10';
    expect(put('3', 'sealed', ok, '5')).toEqual({ kind: 'sealed', generation: 3, held: [{ id: 'demo-c-a', firstDeadAt: 10 }], writtenAt: 5 });
    expect(put('3', 'sealed', null, '5')).toMatchObject({ kind: 'unreadable' });
    expect(put('3', 'sealed', 'dead-coordinator-breaker-held:demo-c-a@soon', '5')).toMatchObject({ kind: 'unreadable' });
    expect(put('soon', 'sealed', ok, '5')).toMatchObject({ kind: 'unreadable' });
    expect(put('3', 'Sealed', ok, '5'), 'a word this build does not know').toMatchObject({ kind: 'unreadable' });
    expect(put('3', 'sealed ', ok, '5')).toMatchObject({ kind: 'unreadable' });
  });

  it('a dirty mark that cannot be written says so, and moves nothing', () => {
    const { db, s } = store();
    const spy = failSql(db as unknown as DatabaseSyncLike, /^INSERT INTO dead_coordinator_breaker_state/);
    expect(s.markDeadCoordinatorBreakerDirty(100)).toMatchObject({ ok: false });
    spy.mockRestore();
    expect(s.deadCoordinatorBreakerState()).toEqual({ kind: 'absent' });
  });

  it('survives a reopen, clean or dirty', () => {
    const p = dbPath();
    const a = openCoordDb(p);
    const s = new CoordStore(a);
    const g = s.markDeadCoordinatorBreakerDirty(100);
    if (!g.ok) throw new Error('mark failed');
    s.commitDeadCoordinatorBreakerState({ generation: g.generation, at: 150, held, record: null, upserts: [], deletes: [] });
    s.markDeadCoordinatorBreakerDirty(160);
    a.close();
    expect(new CoordStore(openCoordDb(p)).deadCoordinatorBreakerState()).toEqual({ kind: 'dirty', generation: g.generation + 2, snapshot: { kind: 'members', members: held } });
  });
});
