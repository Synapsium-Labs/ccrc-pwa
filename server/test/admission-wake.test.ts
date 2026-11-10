// D-6095 (fleet-capacity W1-4; spec §3.5 "The server wakes waiting coordinators", §5.1 W1-4; D-8126, amendment A8-3): a
// coordinator whose dispatch (or send-back) the concurrency cap refused is MAILED when the cap has room again, one
// mail per refusal, round-robin by programme, no faster than the wake budget's rate and in a window of the lane's own.
//
// The first block is the CHARACTERIZATION, green on the base: a refused dispatch writes nothing and the run stays
// `planned`; a refusal sends no mail. The blocks after it flip exactly those rows.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { dispatchRun, type DispatchOutcome, type DispatchRunDeps } from '../src/coord/dispatch.js';
import type { Runner } from '../src/exec.js';
import { configDirFor } from '../src/config.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';
const WORKER = 'demo-quiet-basin';

function fixture() {
  const home = mkTmp('ccrc-admission-wake-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const run: Runner = async (_cmd, args) => ({ ran: true, code: 0, stdout: args[0] === 'ensure' ? `alive: ${args[1] ?? ''}\n` : '', stderr: '' });
  const base = testDeps(home, run);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps: DispatchRunDeps = {
    coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
    sendClear: async () => ({ ok: true }),
    configDir: (w: string) => configDirFor(base.cfg, w),
    turnVerdict: async () => 'idle' as const,
    paneLive: async () => false,
  };
  const seed = (id: string): void => {
    const fields: Record<string, string> = {
      wrapper: 'claude-a', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
      workspace: id, branch: `ws/${id}`, base: 'origin/main',
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  };
  /** A dispatched run holding a slot for programme `program`. */
  const holder = (program: string): number => {
    const o = coord.openRun({ program, title: program, project: PROJECT, wave: 1, waveOf: 1, claimedBy: `c-${program}` }) as { id: number };
    coord.markDispatched(o.id, `${program}-worker`, `${program}-ws`, `ws/${program}`, false, Date.now());
    if (!coord.advance(o.id, 'dispatched', 'test').ok) throw new Error('fixture: holder did not dispatch');
    return o.id;
  };
  /** A planned run of `program` bound to WORKER (the resume arm), claimed by `claimedBy`. */
  const planned = (program: string, claimedBy: string): number => {
    seed(WORKER);
    const o = coord.openRun({ program, title: program, project: PROJECT, wave: 2, waveOf: 2, claimedBy });
    if (!('id' in o)) throw new Error(`fixture openRun refused: ${JSON.stringify(o)}`);
    coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(WORKER, o.id);
    return o.id;
  };
  return { coord, deps, holder, planned, home };
}

const capRefused = (out: DispatchOutcome): boolean => !out.ok && out.kind === 'refused' && out.code === 'cap-concurrency';
const mailCount = (coord: CoordStore): number => (coord.db.prepare('SELECT count(*) AS c FROM mail').get() as { c: number }).c;

describe('characterization: a cap-refused dispatch writes nothing (today)', () => {
  it('the run stays planned, its journal stays empty and no mail is sent', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('other');
    const id = f.planned('prog-a', 'coord-a');
    expect(capRefused(await dispatchRun(f.deps, id, 'go', undefined))).toBe(true);
    const run = f.coord.run(id);
    expect(run.ok && run.run !== null && run.run.state).toBe('planned');
    expect(f.coord.runEvents(id)).toEqual([]);
    expect(mailCount(f.coord)).toBe(0);
  });
});
