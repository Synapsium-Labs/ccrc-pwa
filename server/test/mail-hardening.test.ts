// WAVE 0 (Build 9b) — mail hardening before any second producer exists
// (spec 2026-08-21-build9, D10). The store half: the dedupe guard's null
// arm (hole 1) and the two terminality guards (holes 3/4). The route half
// — quotas and the dark-behavior pin — lives in mail-peer-quota.test.ts.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-mailhard-'), '.ccrc', 'coord.db')));

const openRun = (s: CoordStore) =>
  s.openRun({ program: 'build9b', title: 'Wave 0 fixture', project: 'demo',
              wave: 1, waveOf: 1, claimedBy: 'demo-coordinator' }) as { id: number };

describe('hasOutstandingMail: the runId IS ? arm (D10 hole 1)', () => {
  it('finds an outstanding PEER mail (runId null) — under `=` a bound NULL matches nothing, so the guard structurally could not fire', () => {
    const s = store();
    const m = s.insertMail({ fromId: 'demo-quiet-mesa', fromUuid: 'u1', toId: 'demo-calm-ridge',
                             runId: null, kind: 'question', subject: 'peer q', body: 'x',
                             artifacts: [] });
    s.queueDelivery(m.id, 'demo-calm-ridge', '<mail>x</mail>');
    expect(s.hasOutstandingMail(null, 'demo-calm-ridge', 'peer q')).toBe(true);
  });

  it('still finds a RUN mail by its number, and a run mail is NOT a peer mail — IS is null-safe on both arms', () => {
    const s = store();
    const r = openRun(s);
    const m = s.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator',
                             toId: 'demo-quiet-mesa', runId: r.id, kind: 'status',
                             subject: 'wave-brief', body: 'go', artifacts: [] });
    s.queueDelivery(m.id, 'demo-quiet-mesa', '<mail>go</mail>');
    expect(s.hasOutstandingMail(r.id, 'demo-quiet-mesa', 'wave-brief')).toBe(true);
    // The null arm must select ONLY runId-IS-NULL rows — a run mail found by
    // the peer probe would dedupe a peer send against the coordinator's own
    // traffic, silently.
    expect(s.hasOutstandingMail(null, 'demo-quiet-mesa', 'wave-brief')).toBe(false);
  });
});
