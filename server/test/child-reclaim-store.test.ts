// child-reclamation wave 2, Task 3 — `CoordStore.clearSession`, the ONE
// unbind of `runs.sessionId` (spec §5.4). Dispatch's resume arm calls it after
// the fleet act has released a spent child's claim; the run stays `planned`,
// so the next dispatch takes the fresh-spawn arm and mints a new child.
//
// This file is wave 2's alone: wave 3's store cases live in
// `child-reclaim-mail-store.test.ts`, never here.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-child-store-'), '.ccrc', 'coord.db')));
const open = (s: CoordStore): number => {
  const r = s.openRun({ program: 'build4', title: 't', project: 'demo', wave: 2, waveOf: 3,
    claimedBy: 'ccrc-pwa-coordinator' });
  if (!('id' in r)) throw new Error(`fixture openRun refused: ${JSON.stringify(r)}`);
  return r.id;
};
const details = (s: CoordStore, id: number): (string | null)[] => s.runEvents(id).map((e) => e.detail);

describe('CoordStore.clearSession — the one unbind', () => {
  it('unbinds a planned run — sessionId, workspace, branch NULL — and the trail names who and why', () => {
    const s = store(); const id = open(s);
    s.setSession(id, 'demo-child');
    expect(s.clearSession(id, 42)).toEqual({ ok: true, cleared: true });
    const row = okRun(s.run(id))!;
    expect(row.state).toBe('planned');
    expect(row.sessionId).toBeNull();
    expect(row.workspace).toBeNull();
    expect(row.branch).toBeNull();
    expect(details(s, id)).toContain('session-unbound: demo-child (workspace-spent #42)');
  });

  it('refuses a run that has left planned — cleared:false, binding and trail untouched', () => {
    const s = store(); const id = open(s);
    s.markDispatched(id, 'demo-child', 'demo-child', 'ws/demo-child', true);
    expect(s.advance(id, 'dispatched', 'coordinator').ok).toBe(true);
    const before = s.runEvents(id).length;
    expect(s.clearSession(id, 42)).toEqual({ ok: true, cleared: false });
    const row = okRun(s.run(id))!;
    expect(row.sessionId).toBe('demo-child');
    expect(row.workspace).toBe('demo-child');
    expect(row.branch).toBe('ws/demo-child');
    expect(s.runEvents(id)).toHaveLength(before);
  });

  it('a planned run with no binding answers cleared:false and writes no event', () => {
    const s = store(); const id = open(s);
    const before = s.runEvents(id).length;
    expect(s.clearSession(id, 42)).toEqual({ ok: true, cleared: false });
    expect(s.runEvents(id)).toHaveLength(before);
  });

  it('an unknown run id answers cleared:false', () => {
    expect(store().clearSession(999, 42)).toEqual({ ok: true, cleared: false });
  });
});
