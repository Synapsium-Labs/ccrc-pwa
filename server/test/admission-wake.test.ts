// D-6095 (fleet-capacity W1-4; spec §3.5 "The server wakes waiting coordinators", §5.1 W1-4; D-8126, amendment A8-3): a
// coordinator whose dispatch (or send-back) the concurrency cap refused is MAILED when the cap has room again, one
// mail per refusal, round-robin by programme, no faster than the wake budget's rate and in a window of the lane's own.
//
// The characterization commit pinned, green on the base, that a refused dispatch wrote nothing and the run stayed
// `planned`; the stamp's block below flips exactly the rows that changed (the stamp and the journal line). A refusal
// still sends no mail: the wake is the lane's, when the cap has room.
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

describe('a cap-refused dispatch is stamped and journalled (D-6095)', () => {
  it('the run stays planned and carries the stamp, its journal names the refusal, and no mail is sent', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('other');
    const id = f.planned('prog-a', 'coord-a');
    expect(capRefused(await dispatchRun(f.deps, id, 'go', undefined))).toBe(true);
    const run = f.coord.run(id);
    expect(run.ok && run.run !== null && run.run.state).toBe('planned');
    expect(f.coord.runEvents(id).map((e) => e.detail)).toEqual(['admission-refused:cap-concurrency limit=1 running=1']);
    expect(f.coord.admissionStampOf(id)).toMatchObject({ claimedBy: 'coord-a' });
    expect(f.coord.admissionStampOf(id)!.since).not.toBeNull();
    expect(mailCount(f.coord)).toBe(0);
  });

  it('a refusal by the pause or the mail-disabled marker is not a cap refusal and stamps nothing', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('other');
    const id = f.planned('prog-a', 'coord-a');
    writeFileSync(path.join(f.home, '.cc-sessions', 'coordinator-paused'), '');
    const out = await dispatchRun(f.deps, id, 'go', undefined);
    expect(!out.ok && out.kind === 'refused' && out.code === 'paused').toBe(true);
    expect(f.coord.admissionStampOf(id)!.since).toBeNull();
  });

  it('a dispatch that proceeds clears the stamp', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    const blocker = f.holder('other');
    const id = f.planned('prog-a', 'coord-a');
    expect(capRefused(await dispatchRun(f.deps, id, 'go', undefined))).toBe(true);
    expect(f.coord.admissionStampOf(id)!.since).not.toBeNull();
    expect(f.coord.advance(blocker, 'working', 'test').ok).toBe(true);
    expect(f.coord.advance(blocker, 'awaiting-review', 'test').ok).toBe(true);   // the slot is free
    expect(await dispatchRun(f.deps, id, 'go', undefined)).toMatchObject({ ok: true });
    expect(f.coord.admissionStampOf(id)).toMatchObject({ since: null, lastRefusedAt: null, wokenAt: null });
  });
});

describe('the stamp (store)', () => {
  const open = (f: ReturnType<typeof fixture>, program: string, claimedBy: string): number => {
    const o = f.coord.openRun({ program, title: program, project: PROJECT, wave: 1, waveOf: 1, claimedBy });
    if (!('id' in o)) throw new Error('fixture openRun refused');
    return o.id;
  };

  it('the migration is nullable: three columns, no NOT NULL and no CHECK, so a rollback stays bootable', () => {
    const f = fixture();
    const cols = f.coord.db.prepare('PRAGMA table_info(runs)').all() as { name: string; notnull: number; dflt_value: unknown }[];
    for (const name of ['admissionWaitSince', 'lastRefusedAt', 'admissionWokenAt']) {
      const c = cols.find((x) => x.name === name);
      expect(c, name).toBeDefined();
      expect(c!.notnull).toBe(0);
    }
    const ddl = (f.coord.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'runs'").get() as { sql: string }).sql;
    expect(ddl).not.toMatch(/admissionWaitSince[^,]*(NOT NULL|CHECK)/);
  });

  it('the stamp keeps the oldest refusal and moves the newest', () => {
    const f = fixture();
    const id = open(f, 'prog-a', 'coord-a');
    f.coord.stampAdmissionWait(id, 1_000);
    f.coord.stampAdmissionWait(id, 5_000);
    expect(f.coord.admissionStampOf(id)).toEqual({ since: 1_000, lastRefusedAt: 5_000, wokenAt: null, claimedBy: 'coord-a', program: 'prog-a' });
  });

  it('a woken waiter is skipped until it is refused again', () => {
    const f = fixture();
    const id = open(f, 'prog-a', 'coord-a');
    f.coord.stampAdmissionWait(id, 1_000);
    expect(f.coord.admissionWaiters().map((w) => w.runId)).toEqual([id]);
    f.coord.markAdmissionWoken(id, 2_000);
    expect(f.coord.admissionWaiters()).toEqual([]);
    f.coord.stampAdmissionWait(id, 3_000);
    expect(f.coord.admissionWaiters()).toEqual([{ runId: id, program: 'prog-a', claimedBy: 'coord-a', since: 1_000, lastRefusedAt: 3_000, sendBack: false }]);
  });

  it('a run that left planned (dispatched, abandoned) is not a waiter and its stamp is cleared', () => {
    const f = fixture();
    const a = open(f, 'prog-a', 'coord-a');
    const b = open(f, 'prog-b', 'coord-b');
    f.coord.stampAdmissionWait(a, 1_000);
    f.coord.stampAdmissionWait(b, 1_000);
    f.coord.markDispatched(a, 'a-worker', 'a-ws', 'ws/a', false);
    expect(f.coord.advance(a, 'dispatched', 'test').ok).toBe(true);
    expect(f.coord.advance(b, 'failed', 'operator', 'abandon:x').ok).toBe(true);
    expect(f.coord.admissionWaiters()).toEqual([]);
    expect(f.coord.admissionStampOf(a)).toMatchObject({ since: null, lastRefusedAt: null, wokenAt: null });
    expect(f.coord.admissionStampOf(b)).toMatchObject({ since: null, lastRefusedAt: null, wokenAt: null });
  });

  it('a send-back waiter is a run parked in an idle state; the cleared stamp of a send-back that proceeds is gone', () => {
    const f = fixture();
    const id = f.holder('prog-a');
    expect(f.coord.advance(id, 'working', 'test').ok).toBe(true);
    expect(f.coord.advance(id, 'awaiting-review', 'test').ok).toBe(true);
    f.coord.stampAdmissionWait(id, 1_000);
    expect(f.coord.admissionWaiters()).toMatchObject([{ runId: id, sendBack: true }]);
    expect(f.coord.advance(id, 'working', 'test').ok).toBe(true);
    expect(f.coord.admissionWaiters()).toEqual([]);
  });
});
