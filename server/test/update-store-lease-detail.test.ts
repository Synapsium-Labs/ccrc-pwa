// D-3413 (fix round 1, item 2) — `noteLeaseDetail`, the lease group's writer for what a node said about a lease it now
// HOLDS (the spawn bound's arms B and D). `updateDetail` ONLY, ONLY on a live busy row, ONLY while the row's
// `updateStartedAt` is the lease the caller acquired. "Writes nothing" is measured with SQLite's own `total_changes()`.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type NoteLeaseDetailResult } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_790_000_000_000;
const UUID_A = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const UUID_B = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';

const meas = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: UUID_A, role: 'fleet', label: 'fleet',
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main', currentBuiltAt: '2026-09-20T00:00:00Z',
  currentDirty: false, stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor', 'detach', 'rollback'], agentOps: ['update'], highestVersion: 'v0.0.9',
  previousVersion: 'v0.0.8', floorRead: 'measured', previousRead: 'measured', os: 'linux', measuredAt: T0, report: null, ...over,
});
const leased = (): CoordStore => {
  const s = new CoordStore(openCoordDb(path.join(mkTmp('update-store-lease-detail-'), 'coord.db')));
  expect(s.upsertNodeMeasurement(meas()).ok).toBe(true);
  expect(s.requestNode(UUID_A, 'v0.0.10', 'update', T0).ok).toBe(true);
  expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0 + 5, 'requested update from v0.0.9 to v0.0.10')).toEqual({ ok: true });
  return s;
};
const writes = (s: CoordStore): number => (s.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
const neverVoid: [ReturnType<CoordStore['noteLeaseDetail']>] extends [void] ? never : true = true;
void neverVoid;

describe('noteLeaseDetail (D-3413)', () => {
  it('writes updateDetail on the lease it names, and nothing else: state, target, start and request are untouched', () => {
    const s = leased();
    const before = s.node(UUID_A)!;
    expect(s.noteLeaseDetail(UUID_A, 'stopped at the bound after it queued v0.0.10 (pid 7)', T0 + 5)).toEqual({ ok: true });
    expect(s.node(UUID_A)).toEqual({ ...before, updateDetail: 'stopped at the bound after it queued v0.0.10 (pid 7)' });
  });

  it('refuses a SETTLED row and writes nothing — a report or the deadline got there first, and a verdict is not the dispatcher\'s to overwrite', () => {
    for (const settle of [
      (s: CoordStore) => s.settleNode(UUID_A, 'met: v0.0.10', null),
      (s: CoordStore) => s.releaseLease(UUID_A, 'failed', 'deadline', null),
      (s: CoordStore) => s.releaseLease(UUID_A, 'idle', 'busy — x', null),
    ]) {
      const s = leased();
      expect(settle(s).ok).toBe(true);
      const before = s.node(UUID_A)!;
      const w = writes(s);
      const res: NoteLeaseDetailResult = s.noteLeaseDetail(UUID_A, 'late words', T0 + 5);
      expect(res).toMatchObject({ ok: false, why: 'not-busy' });
      expect(writes(s)).toBe(w);
      expect(s.node(UUID_A)).toEqual(before);
    }
  });

  it('refuses a NEWER lease (the identity clause): the caller acquired T0+5, the row now holds T0+9', () => {
    const s = leased();
    expect(s.releaseLease(UUID_A, 'idle', 'released', null).ok).toBe(true);
    expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0 + 9, 'requested update from v0.0.9 to v0.0.10')).toEqual({ ok: true });
    const w = writes(s);
    expect(s.noteLeaseDetail(UUID_A, 'words for the OLD lease', T0 + 5)).toEqual({ ok: false, why: 'stale-report', updateStartedAt: T0 + 9 });
    expect(writes(s)).toBe(w);
    expect(s.node(UUID_A)!.updateDetail).toBe('requested update from v0.0.9 to v0.0.10');
  });

  it('names an unknown node and a superseded row, writing nothing', () => {
    const s = leased();
    const w = writes(s);
    expect(s.noteLeaseDetail(UUID_B, 'x', T0 + 5)).toEqual({ ok: false, why: 'unknown-node' });
    expect(writes(s)).toBe(w);
    s.upsertNodeMeasurement(meas({ nodeId: UUID_B, label: 'fleet' }));
    expect(s.rekeyNode('fleet', UUID_B).ok).toBe(true);
    const w2 = writes(s);
    expect(s.noteLeaseDetail(UUID_A, 'x', T0 + 5)).toEqual({ ok: false, why: 'superseded', supersededBy: UUID_B });
    expect(writes(s)).toBe(w2);
  });
});
