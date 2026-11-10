// D-6093 (fleet-capacity W1-2; spec §3.4 "What is free and what is charged", §5.1 W1-2; D-8126): a resume of a session
// that reads LIVE starts no process, so `dispatchRun` does not charge it the concurrency check. Every dispatch that
// starts or wakes a process (a fresh spawn, a hibernated, stopped, archived or dead session's resume) and every
// liveness that cannot be measured is charged as before, and the operator's pause and `mail-disabled` marker still
// refuse FIRST, with zero liveness reads.
//
// The route half (a send-back of a live worker) is pinned in `run-routes.test.ts` beside the advance cap it loosens;
// the pure gate's row is in `advance-gate.test.ts`.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { dispatchRun, sessionReadsLive, type DispatchOutcome, type DispatchRunDeps } from '../src/coord/dispatch.js';
import { COORDINATOR_PAUSE_MARKER, MAIL_DISABLED_MARKER } from '../src/coord/rundefs.js';
import type { Runner } from '../src/exec.js';
import { configDirFor } from '../src/config.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';
const WORKER = 'demo-quiet-basin';

function fixture(over: { paneLive?: DispatchRunDeps['paneLive'] | 'absent' } = {}) {
  const home = mkTmp('ccrc-caps-live-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    return { ran: true, code: 0, stdout: args[0] === 'ensure' ? `alive: ${args[1] ?? ''}\n` : '', stderr: '' };
  };
  const base = testDeps(home, run);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const probes = { paneLive: 0, verdict: 0 };
  const deps: DispatchRunDeps = {
    coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
    sendClear: async () => ({ ok: true }),
    configDir: (w: string) => configDirFor(base.cfg, w),
    turnVerdict: async () => { probes.verdict++; return 'idle' as const; },
    ...(over.paneLive === 'absent' ? {} : {
      paneLive: over.paneLive ?? (async () => { probes.paneLive++; return true; }) }),
  };
  const mark = (name: string, body = ''): void => writeFileSync(path.join(reg, name), body);
  const seed = (id: string): void => {
    const fields: Record<string, string> = {
      wrapper: 'claude-a', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
      workspace: id, branch: `ws/${id}`, base: 'origin/main',
    };
    for (const [k, v] of Object.entries(fields)) mark(`${id}.${k}`, v);
  };
  /** A planned wave-2 run bound to the session (the resume arm), at a cap of one slot that another run holds. */
  const resumeAtFullCap = (): number => {
    seed(WORKER);
    coord.setCaps({ maxConcurrentWorkers: 1 });
    const blocker = coord.openRun({ program: 'other', title: 'Other', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'c2' }) as { id: number };
    coord.markDispatched(blocker.id, 'demo-blocker', 'blocker', 'ws/blocker', false);
    if (!coord.advance(blocker.id, 'dispatched', 'test').ok) throw new Error('fixture: blocker did not dispatch');
    const o = coord.openRun({ program: 'p', title: 't', project: PROJECT, wave: 2, waveOf: 2, claimedBy: 'c' });
    if (!('id' in o)) throw new Error(`fixture openRun refused: ${JSON.stringify(o)}`);
    coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(WORKER, o.id);
    expect(coord.capsUsage().running).toBe(1);
    return o.id;
  };
  return { coord, deps, calls, mark, seed, probes, resumeAtFullCap, home };
}

const capRefused = (out: DispatchOutcome): boolean =>
  !out.ok && out.kind === 'refused' && out.code === 'cap-concurrency';

describe('a live resume skips the concurrency check (D-6093)', () => {
  it('a live resume at a full concurrency cap dispatches', async () => {
    const f = fixture();
    const id = f.resumeAtFullCap();
    const out = await dispatchRun(f.deps, id, 'go', undefined);
    expect(capRefused(out)).toBe(false);
    expect(out).toMatchObject({ ok: true, resumed: true, sessionId: WORKER });
    expect(f.probes.paneLive).toBe(1);
  });

  it('the liveness is read only when the cap would refuse', async () => {
    const f = fixture();
    const id = f.resumeAtFullCap();
    f.coord.setCaps({ maxConcurrentWorkers: 5 });
    expect(await dispatchRun(f.deps, id, 'go', undefined)).toMatchObject({ ok: true, resumed: true });
    expect(f.probes.paneLive).toBe(0);
  });

  it('kept: a fresh spawn at a full cap refuses cap-concurrency', async () => {
    const f = fixture();
    f.resumeAtFullCap();
    const fresh = f.coord.openRun({ program: 'p2', title: 't', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'c3' }) as { id: number };
    const out = await dispatchRun(f.deps, fresh.id, 'go', undefined);
    expect(out).toMatchObject({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 1, running: 1 });
    expect(f.probes.paneLive).toBe(0);
  });

  it('kept: a hibernated resume at a full cap refuses', async () => {
    const f = fixture();
    const id = f.resumeAtFullCap();
    f.mark(`${WORKER}.hibernated`, '1700000000');
    expect(capRefused(await dispatchRun(f.deps, id, 'go', undefined))).toBe(true);
  });

  it('kept: a stopped resume at a full cap refuses', async () => {
    const f = fixture();
    const id = f.resumeAtFullCap();
    f.mark(`${WORKER}.stopped`, '1700000000 pane');
    expect(capRefused(await dispatchRun(f.deps, id, 'go', undefined))).toBe(true);
  });

  it('kept: an archived resume at a full cap refuses', async () => {
    const f = fixture();
    const id = f.resumeAtFullCap();
    f.mark(`${WORKER}.archived`, '1700000000');
    expect(capRefused(await dispatchRun(f.deps, id, 'go', undefined))).toBe(true);
  });

  it('kept: a resume whose pane is gone refuses', async () => {
    const f = fixture({ paneLive: async () => false });
    const id = f.resumeAtFullCap();
    expect(capRefused(await dispatchRun(f.deps, id, 'go', undefined))).toBe(true);
  });

  it('an unmeasurable liveness is charged', async () => {
    for (const paneLive of [async () => { throw new Error('tmux unreachable'); }, 'absent' as const]) {
      const f = fixture({ paneLive });
      const id = f.resumeAtFullCap();
      expect(capRefused(await dispatchRun(f.deps, id, 'go', undefined))).toBe(true);
    }
  });

  it('an unlistable session row is charged', async () => {
    const f = fixture();
    const id = f.resumeAtFullCap();
    f.coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run('demo-not-in-registry', id);
    expect(capRefused(await dispatchRun(f.deps, id, 'go', undefined))).toBe(true);
  });

  it('kept: paused and mail-disabled refuse first, with zero liveness reads', async () => {
    for (const [marker, code] of [[COORDINATOR_PAUSE_MARKER, 'paused'], [MAIL_DISABLED_MARKER, 'mail-disabled']] as const) {
      const f = fixture();
      const id = f.resumeAtFullCap();
      f.mark(marker);
      f.calls.length = 0;
      expect(await dispatchRun(f.deps, id, 'go', undefined)).toEqual({ ok: false, kind: 'refused', code });
      expect(f.probes).toEqual({ paneLive: 0, verdict: 0 });
      expect(f.calls).toEqual([]);
    }
  });
});

describe('sessionReadsLive, the one definition of live (D-6093)', () => {
  it('reads live only for a listed, measured, running, awake, unarchived session whose pane is alive', async () => {
    const f = fixture();
    f.seed(WORKER);
    expect(await sessionReadsLive(f.deps, WORKER)).toBe(true);
    expect(await sessionReadsLive(f.deps, 'demo-other')).toBe(false);
    expect(await sessionReadsLive(f.deps, '--actor')).toBe(false);
  });
});
