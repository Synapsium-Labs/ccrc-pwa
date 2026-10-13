// The dead-coordinator lane's STORE half (workspace lifecycle spec 2026-09-24 §5.4, wave 4): the durable first-dead
// anchor (`dead_claimants`, migration 18 — "the hour is the lane's own observation, made durable"), the journal
// clause's ONE read of the lifecycle mirror, and `closeRun`'s compare-and-set: the transaction commits only while
// `claimedBy` still names the crashed id.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { parseJournalLine, type JournalRow } from '../src/coord/journalparse.js';
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
