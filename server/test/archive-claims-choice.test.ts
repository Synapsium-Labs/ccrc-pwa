// D-8199: archiving or stopping a session that CLAIMS open runs asks what happens to them — release them (the programme
// stays, unclaimed) or hand them to a named live coordinator — and never ends the programme by itself. End to end through
// `buildServer` over a fixture HOME (the registry rows and the coordination store are real; every tmux and ccd call is a
// recorded double): with no claims the doors pass straight through; with claims and no choice they refuse
// `coordinator-has-open-runs`, naming the runs; `{runs:'release'}` and `{runs:'handover', heir}` move the claims through
// the reclaim writer, journaled as run events; a stop that is half of a restart (`restart: true`, the id is kept) and the
// swap route never ask.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const PANE = 4242;
const COORDINATOR = 'demo-coordinator';
const HEIR = 'demo-heir';
const CCD_VERBS = new Set(['ws-archive', 'stop', 'swap']);

let open: FastifyInstance[] = [];
afterEach(async () => { for (const a of open) await a.close(); open = []; });

/** tmux answers every pane live unless the id is in `gone`. */
const box = async (o: { gone?: string[] } = {}) => {
  const home = mkTmp('ccrc-archive-claims-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const verb = args[0] ?? '';
    if (verb === 'has-session') {
      const target = args[2] ?? '';
      return (o.gone ?? []).some((g) => target === `=cc-${g}:`)
        ? { ran: true, code: 1, stdout: '', stderr: `can't find session: ${target}` }
        : { ran: true, code: 0, stdout: '', stderr: '' };
    }
    if (verb === 'list-panes') return { ran: true, code: 0, stdout: `${PANE}\n`, stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home, run), coord }, new Bus());
  open.push(app);
  return { home, app, coord, ccd: () => calls.filter((c) => CCD_VERBS.has(c[0] ?? '')) };
};

/** A workspace registry row in project `demo`. */
const seed = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  const ws = id.replace(/^demo-/, '');
  const workdir = path.join(home, 'worktrees', 'demo', ws);
  mkdirSync(workdir, { recursive: true });
  const fields: Record<string, string> = { wrapper: 'claude-a', project: 'demo', workdir, uuid: `u-${id}`, started: '1',
    workspace: ws, branch: `ws/${ws}`, base: 'origin/main' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** Claude Code's live file for the pane, idle: the fail-closed turn read a claims move asks for. */
const idle = (home: string): void => {
  const dir = path.join(home, '.claude-a', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${PANE}.json`),
    JSON.stringify({ pid: PANE, sessionId: 'u', status: 'idle', statusUpdatedAt: Date.now() - 60_000 }));
};

const coordinates = (coord: CoordStore, n: number, program = 'lifecycle'): number[] =>
  Array.from({ length: n }, (_, i) => {
    const r = coord.openRun({ program, title: 'T', project: 'demo', wave: i + 1, waveOf: 3, claimedBy: COORDINATOR });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    return r.id;
  });

const archive = (app: FastifyInstance, id: string, payload?: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/sessions/${id}/archive`, ...(payload === undefined ? {} : { payload }) });
const stop = (app: FastifyInstance, id: string, payload?: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/sessions/${id}/stop`, ...(payload === undefined ? {} : { payload }) });

const claimantOf = (coord: CoordStore, id: number): string | null => okRun(coord.run(id))!.claimedBy;
const events = (coord: CoordStore, id: number): string[] =>
  (coord.db.prepare("SELECT detail FROM run_events WHERE runId = ? AND causedBy = 'operator' ORDER BY id").all(id) as
    { detail: string | null }[]).map((e) => e.detail ?? '');

describe('archive — a session that claims no open run passes straight through', () => {
  it('archives with ws-archive alone and no question', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    const res = await archive(b.app, COORDINATOR);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, archived: true, stopped: false, ended: [] });
    expect(b.ccd()).toEqual([['ws-archive', '--session', COORDINATOR]]);
  });

  it('a choice given with nothing to move is no refusal either', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    idle(b.home);
    expect((await archive(b.app, COORDINATOR, { runs: 'release' })).json())
      .toEqual({ ok: true, archived: true, stopped: false, ended: [] });
  });
});

describe('archive — a session that claims open runs is asked, and nothing moves without a choice', () => {
  it('refuses 409 coordinator-has-open-runs naming the runs; the claims, the runs and the pane are untouched', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    const [r1, r2] = coordinates(b.coord, 2);
    const res = await archive(b.app, COORDINATOR);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'coordinator-has-open-runs', runs: [
      { id: r1, program: 'lifecycle', wave: 1, waveOf: 3 }, { id: r2, program: 'lifecycle', wave: 2, waveOf: 3 }] });
    expect(claimantOf(b.coord, r1!)).toBe(COORDINATOR);
    expect(okRun(b.coord.run(r1!))!.state).toBe('planned');
    expect(b.ccd()).toEqual([]);
  });

  it.each([
    ['an unknown choice', { runs: 'keep' }],
    ['a hand-over with no heir', { runs: 'handover' }],
    ['a hand-over to an id that is not a registry id', { runs: 'handover', heir: '../x' }],
    ['an heir with no hand-over', { heir: HEIR }],
    ['a choice beside `programme:"end"`', { runs: 'release', programme: 'end' }],
  ])('%s is a malformed request: 400, nothing moved', async (_why, body) => {
    const b = await box();
    seed(b.home, COORDINATOR);
    const [r1] = coordinates(b.coord, 1);
    const res = await archive(b.app, COORDINATOR, body);
    expect(res.statusCode).toBe(400);
    expect(claimantOf(b.coord, r1!)).toBe(COORDINATOR);
    expect(b.ccd()).toEqual([]);
  });
});

describe('archive — release', () => {
  it('releases every run of the programme to unclaimed, journals it, then archives; no run is ended', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    idle(b.home);
    const [r1, r2] = coordinates(b.coord, 2);
    const res = await archive(b.app, COORDINATOR, { runs: 'release' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, archived: true, stopped: false, ended: [], moved: { to: null, runs: [
      { id: r1, program: 'lifecycle', wave: 1, waveOf: 3 }, { id: r2, program: 'lifecycle', wave: 2, waveOf: 3 }] } });
    for (const r of [r1!, r2!]) {
      expect(claimantOf(b.coord, r)).toBeNull();
      expect(okRun(b.coord.run(r))!.state).toBe('planned');
      expect(events(b.coord, r)).toEqual([`release:${COORDINATOR}`]);
    }
    expect(b.coord.bindingsOf(COORDINATOR).claimant()).toEqual({ ok: true, siblings: [] });
    expect(b.ccd()).toEqual([['ws-archive', '--session', COORDINATOR]]);
  });

  it('a released coordinator still reads as one that coordinated (the child-reclaim fence)', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    idle(b.home);
    coordinates(b.coord, 1);
    await archive(b.app, COORDINATOR, { runs: 'release' });
    expect(typeof b.coord.childReclaimCoordinatorClaims().get(COORDINATOR)).toBe('number');
  });

  it('a new coordinator can open the next wave of a released programme', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    idle(b.home);
    coordinates(b.coord, 1);
    await archive(b.app, COORDINATOR, { runs: 'release' });
    const next = b.coord.openRun({ program: 'lifecycle', title: 'T', project: 'demo', wave: 2, waveOf: 3, claimedBy: HEIR });
    expect('id' in next).toBe(true);
  });
});

describe('archive — hand over', () => {
  it('hands every run of the programme to the named live coordinator, journaled, then archives', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    seed(b.home, HEIR);
    idle(b.home);
    const [r1, r2] = coordinates(b.coord, 2);
    const res = await archive(b.app, COORDINATOR, { runs: 'handover', heir: HEIR });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, archived: true, stopped: false, ended: [], moved: { to: HEIR, runs: [
      { id: r1, program: 'lifecycle', wave: 1, waveOf: 3 }, { id: r2, program: 'lifecycle', wave: 2, waveOf: 3 }] } });
    for (const r of [r1!, r2!]) {
      expect(claimantOf(b.coord, r)).toBe(HEIR);
      expect(events(b.coord, r)).toEqual([`reclaim:${COORDINATOR} -> ${HEIR}`]);
    }
    expect(b.ccd()).toEqual([['ws-archive', '--session', COORDINATOR]]);
  });

  it('moves every programme the session claims, one hand-over each', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    seed(b.home, HEIR);
    idle(b.home);
    const [a] = coordinates(b.coord, 1, 'alpha');
    const [z] = coordinates(b.coord, 1, 'zeta');
    expect((await archive(b.app, COORDINATOR, { runs: 'handover', heir: HEIR })).statusCode).toBe(200);
    expect([claimantOf(b.coord, a!), claimantOf(b.coord, z!)]).toEqual([HEIR, HEIR]);
  });

  it.each([
    ['an heir the registry does not know', [] as string[], 'unknown-session'],
    ['an heir whose pane is gone', [HEIR], 'heir-not-live'],
  ])('%s: 409 claims-not-moved, nothing moved, nothing archived', async (_why, gone, kind) => {
    const b = await box({ gone });
    seed(b.home, COORDINATOR);
    if (kind !== 'unknown-session') seed(b.home, HEIR);
    idle(b.home);
    const [r1] = coordinates(b.coord, 1);
    const res = await archive(b.app, COORDINATOR, { runs: 'handover', heir: HEIR });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'claims-not-moved', moved: [],
      notMoved: [{ id: r1, program: 'lifecycle', wave: 1, waveOf: 3 }], refusal: { kind } });
    expect(claimantOf(b.coord, r1!)).toBe(COORDINATOR);
    expect(b.ccd()).toEqual([]);
  });

  it('the session itself is no heir: 409 claims-not-moved', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    idle(b.home);
    const [r1] = coordinates(b.coord, 1);
    const res = await archive(b.app, COORDINATOR, { runs: 'handover', heir: COORDINATOR });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'claims-not-moved', refusal: { kind: 'heir-is-this-session' } });
    expect(claimantOf(b.coord, r1!)).toBe(COORDINATOR);
    expect(b.ccd()).toEqual([]);
  });
});

describe('stop — the same question', () => {
  it('a session that claims no open run stops straight through', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    const res = await stop(b.app, COORDINATOR);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(b.ccd()).toEqual([['stop', COORDINATOR]]);
  });

  it('with claims and no choice: 409 coordinator-has-open-runs naming the runs, nothing stopped', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    const [r1] = coordinates(b.coord, 1);
    const res = await stop(b.app, COORDINATOR);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'coordinator-has-open-runs',
      runs: [{ id: r1, program: 'lifecycle', wave: 1, waveOf: 3 }] });
    expect(claimantOf(b.coord, r1!)).toBe(COORDINATOR);
    expect(b.ccd()).toEqual([]);
  });

  it('`{runs:"release"}` releases the claims, then stops', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    const [r1] = coordinates(b.coord, 1);
    const res = await stop(b.app, COORDINATOR, { runs: 'release' });
    expect(res.json()).toEqual({ ok: true, moved: { to: null, runs: [{ id: r1, program: 'lifecycle', wave: 1, waveOf: 3 }] } });
    expect(claimantOf(b.coord, r1!)).toBeNull();
    expect(events(b.coord, r1!)).toEqual([`release:${COORDINATOR}`]);
    expect(b.ccd()).toEqual([['stop', COORDINATOR]]);
  });

  it('`{runs:"handover", heir}` hands the claims over, then stops', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    seed(b.home, HEIR);
    const [r1] = coordinates(b.coord, 1);
    const res = await stop(b.app, COORDINATOR, { runs: 'handover', heir: HEIR });
    expect(res.json()).toEqual({ ok: true, moved: { to: HEIR, runs: [{ id: r1, program: 'lifecycle', wave: 1, waveOf: 3 }] } });
    expect(claimantOf(b.coord, r1!)).toBe(HEIR);
    expect(b.ccd()).toEqual([['stop', COORDINATOR]]);
  });

  it('a hand-over the heir cannot take stops nothing', async () => {
    const b = await box({ gone: [HEIR] });
    seed(b.home, COORDINATOR);
    seed(b.home, HEIR);
    const [r1] = coordinates(b.coord, 1);
    const res = await stop(b.app, COORDINATOR, { runs: 'handover', heir: HEIR });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'claims-not-moved', refusal: { kind: 'heir-not-live' } });
    expect(claimantOf(b.coord, r1!)).toBe(COORDINATOR);
    expect(b.ccd()).toEqual([]);
  });

  it('a stop that is half of a restart keeps the session id, so it asks nothing and moves nothing', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    const [r1] = coordinates(b.coord, 1);
    const res = await stop(b.app, COORDINATOR, { restart: true });
    expect(res.json()).toEqual({ ok: true });
    expect(claimantOf(b.coord, r1!)).toBe(COORDINATOR);
    expect(events(b.coord, r1!)).toEqual([]);
    expect(b.ccd()).toEqual([['stop', COORDINATOR]]);
  });

  it('a malformed choice is 400, nothing stopped', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    coordinates(b.coord, 1);
    expect((await stop(b.app, COORDINATOR, { runs: 'handover' })).statusCode).toBe(400);
    expect((await stop(b.app, COORDINATOR, { restart: true, runs: 'release' })).statusCode).toBe(400);
    expect(b.ccd()).toEqual([]);
  });
});

describe('the swap path is untouched', () => {
  it('a swap of a coordinator with open runs asks nothing and keeps its claims', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    idle(b.home);
    const [r1] = coordinates(b.coord, 1);
    const res = await b.app.inject({ method: 'POST', url: `/api/sessions/${COORDINATOR}/swap`, payload: { wrapper: 'claude-b' } });
    expect(res.json()).not.toMatchObject({ error: 'coordinator-has-open-runs' });
    expect(res.statusCode).toBe(200);
    expect(claimantOf(b.coord, r1!)).toBe(COORDINATOR);
    expect(events(b.coord, r1!)).toEqual([]);
    expect(b.ccd().map((c) => c[0])).toEqual(['swap']);
  });
});
