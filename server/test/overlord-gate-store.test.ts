// Overlord W1 gates B, Task 5: the gate's store (`coord/overlordGateStore.ts`) on a fixture coord.db. The guarded counter's
// four answers, the act key fact's arms, and the fence-refusal table's one writer and its read.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { actKeyOf, issueActKey } from '../src/continuity/actKeyStore.js';
import { genExpectOf, type MintInput } from '../src/continuity/continuityStore.js';
import {
  FENCE_REFUSAL_RETENTION_MS, actKeyFact, advanceCounterGuarded, fenceRefusalsSince, recordFenceRefusal,
} from '../src/coord/overlordGateStore.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const ID = 'overlord';
const SESSION = 'lane-a-overlord';
const KEY = 'a'.repeat(64);
const KEY_SHA = createHash('sha256').update(KEY, 'utf8').digest('hex');
const N1 = '1'.repeat(64);
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-gatestore-'), '.ccrc', 'coord.db')));
let reports = 0;
const startOf = (s: CoordStore): number => {
  reports += 1;
  const r = s.insertStart({ sessionId: SESSION, reportId: `r-${reports}`, uuid: '11111111-2222-3333-4444-555555555555', source: 'startup',
    model: 'claude-opus-5-5', rowIncarnation: null, reportedAt: NOW, receivedAt: NOW, doorNonceSha256: null });
  if (!r.ok) throw new Error('start not recorded');
  return r.id;
};
const mintIn = (startId: number): MintInput => ({
  identity: ID, sessionId: SESSION, role: 'coordinator', term: 1, rowIncarnation: null, startId, startReportedAt: NOW,
  resumed: false, model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'crashed', mono: 1_000, proc: 'p1', now: NOW,
});
/** A store holding one live generation with an issued act key; answers its id. */
const withGeneration = (): { s: CoordStore; g: number } => {
  const s = store();
  const live = s.liveGenerations();
  if (!live.ok) throw new Error(live.detail);
  const old = live.rows.find((x) => x.identity === ID);
  const r = s.mintGeneration(mintIn(startOf(s)), old === undefined ? null : genExpectOf(old), true);
  if (!r.ok) throw new Error('not minted');
  expect(issueActKey(s.db, { generationId: r.id, nonceSha256: N1, keySha256: KEY_SHA, issuedAt: NOW })).toEqual({ ok: true });
  return { s, g: r.id };
};
const counterOf = (s: CoordStore, g: number): number => {
  const r = actKeyOf(s.db, g);
  if (!r.ok || r.value === 'none') throw new Error('no row');
  return r.value.counter;
};

describe('advanceCounterGuarded', () => {
  it('answers advanced once, not-above for the same counter, and advanced for a higher one (a gap is accepted)', () => {
    const { s, g } = withGeneration();
    expect(advanceCounterGuarded(s.db, g, 1)).toBe('advanced');
    expect(advanceCounterGuarded(s.db, g, 1)).toBe('not-above');
    expect(advanceCounterGuarded(s.db, g, 0)).toBe('not-above');
    expect(advanceCounterGuarded(s.db, g, 5)).toBe('advanced');
    expect(counterOf(s, g)).toBe(5);
  });
  it('answers ended for an ended generation and leaves the counter unchanged', () => {
    const { s, g } = withGeneration();
    expect(advanceCounterGuarded(s.db, g, 2)).toBe('advanced');
    s.db.prepare("UPDATE continuity_generations SET state = 'ended' WHERE id = ?").run(g);
    expect(advanceCounterGuarded(s.db, g, 9)).toBe('ended');
    expect(counterOf(s, g)).toBe(2);
  });
  it('answers ended for a missing generation row and writes nothing', () => {
    const { s, g } = withGeneration();
    expect(advanceCounterGuarded(s.db, g + 100, 1)).toBe('ended');
    expect(counterOf(s, g)).toBe(0);
  });
  it('answers unmeasured when continuity_act_keys is missing', () => {
    const { s, g } = withGeneration();
    s.db.exec('DROP TABLE continuity_act_keys');
    expect(advanceCounterGuarded(s.db, g, 1)).toBe('unmeasured');
  });
  it('answers unmeasured when the database is closed', () => {
    const { s, g } = withGeneration();
    s.db.close();
    expect(advanceCounterGuarded(s.db, g, 1)).toBe('unmeasured');
  });
});

describe('actKeyFact', () => {
  it('is unissued with counter 0 when no row holds the generation', () => {
    const s = store();
    expect(actKeyFact(s.db, 77, KEY)).toEqual({ kind: 'read', key: 'unissued', counter: 0 });
  });
  it('is match for the right key and carries the stored counter', () => {
    const { s, g } = withGeneration();
    expect(actKeyFact(s.db, g, KEY)).toEqual({ kind: 'read', key: 'match', counter: 0 });
    advanceCounterGuarded(s.db, g, 4);
    expect(actKeyFact(s.db, g, KEY)).toEqual({ kind: 'read', key: 'match', counter: 4 });
  });
  it('is mismatch for a wrong key, a key of another length and a null key, and still carries the counter', () => {
    const { s, g } = withGeneration();
    advanceCounterGuarded(s.db, g, 3);
    expect(actKeyFact(s.db, g, 'b'.repeat(64))).toEqual({ kind: 'read', key: 'mismatch', counter: 3 });
    expect(actKeyFact(s.db, g, 'a'.repeat(63))).toEqual({ kind: 'read', key: 'mismatch', counter: 3 });
    expect(actKeyFact(s.db, g, '')).toEqual({ kind: 'read', key: 'mismatch', counter: 3 });
    expect(actKeyFact(s.db, g, null)).toEqual({ kind: 'read', key: 'mismatch', counter: 3 });
  });
  it('is unmeasured when the table is missing, never unissued', () => {
    const { s, g } = withGeneration();
    s.db.exec('DROP TABLE continuity_act_keys');
    const f = actKeyFact(s.db, g, KEY);
    expect(f.kind).toBe('unmeasured');
    if (f.kind === 'unmeasured') expect(f.why).toContain('continuity_act_keys');
  });
});

describe('recordFenceRefusal and fenceRefusalsSince', () => {
  const rowAt = (at: number, over: Partial<{ sessionId: string; generationId: number | null; door: string }> = {}) =>
    ({ sessionId: SESSION, generationId: 1, door: 'notes-write', why: 'fork' as const, at, ...over });
  const count = (s: CoordStore): number => Number((s.db.prepare('SELECT COUNT(*) AS n FROM overlord_fence_refusals').get() as { n: number }).n);

  it('inserts one row', () => {
    const s = store();
    expect(recordFenceRefusal(s.db, rowAt(NOW))).toEqual({ ok: true });
    expect(count(s)).toBe(1);
    expect(fenceRefusalsSince(s.db, SESSION, 0)).toEqual({ ok: true, rows: [rowAt(NOW)] });
  });
  it('keeps a null generation id', () => {
    const s = store();
    recordFenceRefusal(s.db, rowAt(NOW, { generationId: null }));
    expect(fenceRefusalsSince(s.db, SESSION, 0)).toMatchObject({ ok: true, rows: [{ generationId: null }] });
  });
  it('prunes rows older than 30 days in the same call: at - 30d - 1 is gone, at - 30d stays', () => {
    const s = store();
    // Plant both rows directly, so the next write is what prunes.
    for (const [door, at] of [['old', NOW - FENCE_REFUSAL_RETENTION_MS - 1], ['edge', NOW - FENCE_REFUSAL_RETENTION_MS]] as const) {
      s.db.prepare('INSERT INTO overlord_fence_refusals (sessionId, generationId, door, why, at) VALUES (?, 1, ?, ?, ?)').run(SESSION, door, 'fork', at);
    }
    expect(count(s)).toBe(2);
    expect(recordFenceRefusal(s.db, rowAt(NOW, { door: 'new' }))).toEqual({ ok: true });
    const doors = (s.db.prepare('SELECT door FROM overlord_fence_refusals ORDER BY at').all() as { door: string }[]).map((r) => r.door);
    expect(doors).toEqual(['edge', 'new']);
  });
  it('answers {ok:false} when the table is missing, never throws', () => {
    const s = store();
    s.db.exec('DROP TABLE overlord_fence_refusals');
    expect(recordFenceRefusal(s.db, rowAt(NOW))).toEqual({ ok: false });
  });
  it('fenceRefusalsSince answers the session\'s rows at or after since, oldest first', () => {
    const s = store();
    recordFenceRefusal(s.db, rowAt(NOW + 30, { door: 'c' }));
    recordFenceRefusal(s.db, rowAt(NOW + 10, { door: 'a' }));
    recordFenceRefusal(s.db, rowAt(NOW + 20, { door: 'b' }));
    recordFenceRefusal(s.db, rowAt(NOW + 15, { sessionId: 'lane-b-overlord', door: 'other' }));
    recordFenceRefusal(s.db, rowAt(NOW - 5, { door: 'before' }));
    const r = fenceRefusalsSince(s.db, SESSION, NOW + 10);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows.map((x) => x.door)).toEqual(['a', 'b', 'c']);
    const none = fenceRefusalsSince(s.db, SESSION, NOW + 31);
    expect(none).toEqual({ ok: true, rows: [] });
  });
  it('fenceRefusalsSince answers {ok:false} on a missing table', () => {
    const s = store();
    s.db.exec('DROP TABLE overlord_fence_refusals');
    expect(fenceRefusalsSince(s.db, SESSION, 0)).toEqual({ ok: false });
  });
});
