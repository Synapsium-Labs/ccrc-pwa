// The concurrency cap's count and refusals, pinned at `dispatchRun` (spec 2026-11-19 "waiting workers sleep and hold no
// slot", Part 3). The first block is the CHARACTERIZATION of today's count, green on `main` before the change: every
// dispatched run in an active state counts, whatever its worker is doing, and a resume is charged like a fresh spawn.
// Rows marked "today:" are the ones Part 3 changes; rows marked "kept:" stay.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { capsMeasured, dispatchRun, type DispatchOutcome, type DispatchRunDeps } from '../src/coord/dispatch.js';
import type { Runner } from '../src/exec.js';
import { configDirFor } from '../src/config.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';
const WORKER = 'demo-quiet-basin';
const HOUR = 60 * 60 * 1000;

function fixture() {
  const home = mkTmp('ccrc-caps-working-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const run: Runner = async (_cmd, args) =>
    ({ ran: true, code: 0, stdout: args[0] === 'ensure' ? `alive: ${args[1] ?? ''}\n` : '', stderr: '' });
  const base = testDeps(home, run);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps: DispatchRunDeps = {
    coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
    sendClear: async () => ({ ok: true }),
    configDir: (w: string) => configDirFor(base.cfg, w),
    turnVerdict: async () => 'idle' as const,
  };
  const mark = (name: string, body = ''): void => writeFileSync(path.join(reg, name), body);
  const seed = (id: string): void => {
    const fields: Record<string, string> = {
      wrapper: 'claude-a', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
      workspace: id, branch: `ws/${id}`, base: 'origin/main',
    };
    for (const [k, v] of Object.entries(fields)) mark(`${id}.${k}`, v);
  };
  /** A dispatched run holding a slot, its worker `session` (null: a row with no session), dispatched `ageMs` ago. */
  const holder = (program: string, session: string | null, ageMs = HOUR): number => {
    const o = coord.openRun({ program, title: program, project: PROJECT, wave: 1, waveOf: 1, claimedBy: `c-${program}` }) as { id: number };
    coord.markDispatched(o.id, session ?? 'demo-x', `${program}-ws`, `ws/${program}`, false, Date.now() - ageMs);
    if (!coord.advance(o.id, 'dispatched', 'test').ok) throw new Error('fixture: holder did not dispatch');
    if (session === null) coord.db.prepare('UPDATE runs SET sessionId = NULL WHERE id = ?').run(o.id);
    return o.id;
  };
  /** A planned wave-2 run bound to WORKER (the resume arm). */
  const resume = (): number => {
    seed(WORKER);
    const o = coord.openRun({ program: 'p', title: 't', project: PROJECT, wave: 2, waveOf: 2, claimedBy: 'c' });
    if (!('id' in o)) throw new Error(`fixture openRun refused: ${JSON.stringify(o)}`);
    coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(WORKER, o.id);
    return o.id;
  };
  /** A planned wave-1 run: a fresh spawn. */
  const fresh = (): number =>
    (coord.openRun({ program: 'fresh', title: 'f', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'c-fresh' }) as { id: number }).id;
  return { coord, deps, mark, seed, holder, resume, fresh, home };
}

const capRefused = (out: DispatchOutcome): boolean => !out.ok && out.kind === 'refused' && out.code === 'cap-concurrency';

describe('characterization: the cap counts every dispatched run in an active state (today)', () => {
  it('kept: a fresh spawn at a full cap refuses with the numbers', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('busy', 'demo-busy');
    expect(capsMeasured(f.coord).overConcurrency).toEqual({ limit: 1, running: 1 });
    expect(await dispatchRun(f.deps, f.fresh(), 'go', undefined))
      .toEqual({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 1, running: 1 });
  });

  it('kept: a row with no session counts', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('nosession', null, 6 * 24 * HOUR);
    expect(f.coord.capsUsage().running).toBe(1);
    expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
  });

  it('kept: a free slot dispatches', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 2 });
    f.holder('busy', 'demo-busy');
    expect(capsMeasured(f.coord).overConcurrency).toBeNull();
    expect(await dispatchRun(f.deps, f.resume(), 'go', undefined)).toMatchObject({ ok: true, resumed: true });
  });

  it('today: a run whose worker is asleep counts', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.seed('demo-asleep');
    f.mark('demo-asleep.hibernated', '1700000000');
    f.holder('asleep', 'demo-asleep', 3 * HOUR);
    expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
  });

  it('today: a run whose worker has no registry row counts', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('gone', 'demo-gone', 3 * HOUR);
    expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
  });

  it('today: a resume of a worker whose pane is live is charged like a fresh spawn', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('busy', 'demo-busy');
    expect(await dispatchRun(f.deps, f.resume(), 'go', undefined))
      .toEqual({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 1, running: 1 });
  });
});
