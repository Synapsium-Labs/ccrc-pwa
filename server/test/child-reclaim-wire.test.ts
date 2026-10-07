// Child-reclamation wave 5, Task 1: the chip's wire vocabulary (spec §5.9).
//
// `ChildReclaimWord` is spelled ONCE, as the keys of a total table in
// shared/api.ts, and the runtime list is DERIVED from it. `RunSummary.childReclaim`
// leaves the STORE as null for every row: the answer needs the registry's marker
// and the sweep's in-memory defer, and the store sees neither. GET /api/runs is
// the one composer (Task 5). The five kept words follow the same shape: one total
// table, one derived list, one guard.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, toRunSummary } from '../src/coord/store.js';
import {
  CHILD_RECLAIM_WORDS, isChildReclaimWord,
  CHILD_RECLAIM_KEPT_WORDS, isChildReclaimKeptWord,
} from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { okRuns } from './coordReadHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-cr-wire-'), '.ccrc', 'coord.db')));

describe('the child-reclaim word vocabulary (wave 5, spec §5.9)', () => {
  it('is exactly the five words the spec names, derived from one table', () => {
    expect([...CHILD_RECLAIM_WORDS].sort()).toEqual(['deferred', 'paused', 'pending', 'reclaimed', 'refused']);
  });

  it('guards membership through the derived list — a newer word is not one of ours', () => {
    for (const w of CHILD_RECLAIM_WORDS) expect(isChildReclaimWord(w)).toBe(true);
    expect(isChildReclaimWord('evicted')).toBe(false);
    expect(isChildReclaimWord(undefined)).toBe(false);
    expect(isChildReclaimWord(3)).toBe(false);
  });
});

describe('the kept words (wave 5, spec §5.9)', () => {
  // An unplaced birth is not among them: it is a doubt word, which the sweep reads again on its own.
  it('are the five the sweep keeps for a person, derived from one table', () => {
    expect([...CHILD_RECLAIM_KEPT_WORDS].sort()).toEqual([
      'coordinating', 'minting-run-absent', 'minting-run-postdates-child', 'not-a-workspace', 'reviewed-run-absent',
    ]);
    expect(isChildReclaimKeptWord('coordinating')).toBe(true);
    expect(isChildReclaimKeptWord('held')).toBe(false);
    expect(isChildReclaimKeptWord('child-birth-unplaced')).toBe(false);
  });
});

describe('RunSummary.childReclaim leaves the store as null (the store cannot compose it)', () => {
  it('hydrates every row, open and closed, with the key present and null', () => {
    const s = store();
    const a = s.openRun({ program: 'w5-wire', title: 'W5', project: 'ccrc-pwa', wave: 1, waveOf: 2,
                          claimedBy: 'ccrc-pwa-coordinator' }) as { id: number };
    s.openRun({ program: 'w5-wire', title: 'W5', project: 'ccrc-pwa', wave: 2, waveOf: 2,
                claimedBy: 'ccrc-pwa-coordinator' });
    s.dispatchRun({ runId: a.id, sessionId: 'ccrc-pwa-quiet-mesa', workspace: 'quiet-mesa',
                    branch: 'ws/quiet-mesa', resumed: false, clearedAt: null, items: [] });
    expect(s.closeRun({ runId: a.id, finalState: 'done', causedBy: 'coordinator', handoffCommit: null,
                        program: 'w5-wire', viaClosing: true }).ok).toBe(true);
    const wire = okRuns(s.runs({ includeClosed: true })).map((r) => toRunSummary(r));
    expect(wire).toHaveLength(2);
    for (const r of wire) {
      expect(Object.keys(r)).toContain('childReclaim');
      expect(r.childReclaim).toBeNull();
    }
  });
});
