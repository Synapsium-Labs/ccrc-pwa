// child-reclamation wave 2 — rule 3 at both doors, end to end through the
// real routes (spec §5.4). A CHILD whose branch has had a PR may not take
// another run: `POST /api/runs` refuses before any row exists (Task 5), and
// dispatch's resume arm refuses before `ensure`, releasing the spent child's
// claim and unbinding the run so the next dispatch mints a fresh child
// (Task 6). The marker is written into the fixture registry directly — wave 1
// need not be deployed for any of this to be measured.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import type { Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { unreadableField } from './ioDoubles.js';
import { okRuns } from './coordReadHelpers.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROJECT = 'demo';
const CHILD = 'demo-child';
const TOKEN = 'f'.repeat(64);
const OPEN_BODY = { program: 'build4', title: 'Child reclamation', project: PROJECT,
  wave: 2, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator', homeProject: PROJECT };
/** `run-routes.test.ts`'s happy `/clear` pane sequence. */
const CLEAR_PANES = ['scrollback\n❯ \n', 'scrollback\n❯ /clear\n', 'scrollback\n❯ \n'];

/** A full registry row — `run-routes.test.ts`'s own `seed`. */
const seed = (home: string, id: string, over: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};
const spend = (home: string, id: string, pr: number): void =>
  writeFileSync(path.join(home, '.cc-sessions', `${id}.prnumber`), String(pr));
const noPrLine = (id: string): string =>
  JSON.stringify({ id, rows: [], baseShort: 'main', branch: `ws/${id}`, ahead: 1, checkedAt: 1 });
const openPrLine = (id: string): string => JSON.stringify({ id, rows: [{
  number: 7, state: 'OPEN', headRefName: `ws/${id}`, baseRefName: 'main', isCrossRepository: false, ours: true, isDraft: false,
}], baseShort: 'main', branch: `ws/${id}`, ahead: 1, checkedAt: 1 });

interface RunnerCfg { prStdout?: string; fail?: ReadonlySet<string>; wsAddCreates?: string[] }
/** One recording runner for both vocabularies — ccd verbs and the tmux calls
 *  `sendPrompt`'s `/clear` makes (`testDeps` wires both through it). */
function makeRunner(home: string, cfg: RunnerCfg = {}): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  let capIdx = 0;
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const verb = args[0] ?? '';
    if (cfg.fail?.has(verb)) return { code: 1, stdout: '', stderr: `${verb} failed` };
    if (verb === 'ws-add') {
      for (const id of cfg.wsAddCreates ?? [`${PROJECT}-fresh`]) seed(home, id);
      return { code: 0, stdout: '', stderr: '' };
    }
    if (verb === 'pr-state') return { code: 0, stdout: `${cfg.prStdout ?? noPrLine(CHILD)}\n`, stderr: '' };
    if (verb === 'capture-pane') {
      const p = CLEAR_PANES[Math.min(capIdx, CLEAR_PANES.length - 1)]!;
      capIdx++;
      return { code: 0, stdout: p, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };   // ensure, ws-hold, ws-release, send-keys, has-session…
  };
  return { run, calls };
}
const openApp = async (home: string, run: Runner, over: Partial<Deps> = {}) => {
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home, run), mailToken: TOKEN, coord, ...over });
  return { app, coord };
};
const headers = { 'x-ccrc-mail-token': TOKEN };
const postOpen = (app: FastifyInstance, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/runs', headers, payload: body });
const verbsOf = (calls: string[][]): string[] => calls.map((c) => c[0] ?? '');

describe('POST /api/runs — a spent child is refused before anything exists', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('refuses workspace-spent, naming the PR — no row, no hold, no live lookup', async () => {
    const home = mkTmp('ccrc-child-open-');
    seed(home, CHILD, { child: '5', prnumber: '42' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, sessionId: CHILD });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'workspace-spent', pr: 42 });
    expect(okRuns(w.coord.runs()), 'a refused open left a planned orphan').toHaveLength(0);
    expect(verbsOf(calls)).not.toContain('ws-hold');
    expect(verbsOf(calls)).not.toContain('pr-state');
  });

  it('refuses on a PR only the LIVE lookup can see (opened seconds ago)', async () => {
    const home = mkTmp('ccrc-child-open-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home, { prStdout: openPrLine(CHILD) });
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, sessionId: CHILD });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'workspace-spent', pr: 7 });
    expect(verbsOf(calls)).toContain('pr-state');
    expect(verbsOf(calls)).not.toContain('ws-hold');
  });

  it('refuses spent-unmeasured on an unreadable marker — no row, no hold', async () => {
    const home = mkTmp('ccrc-child-open-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run, { io: unreadableField(CHILD, 'child') }); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, sessionId: CHILD });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'spent-unmeasured', detail: 'the child marker could not be read' });
    expect(okRuns(w.coord.runs())).toHaveLength(0);
    expect(verbsOf(calls)).not.toContain('ws-hold');
  });

  it('an UNLISTABLE registry refuses spent-unmeasured for ANY sessionId — a NON-child too, because the gate cannot tell', async () => {
    // The one place this wave changes the non-child path (spec §5.4's fail-shut
    // exception): before the gate, the open never listed the registry and
    // answered 200 here. Pinned rather than left to a moved counter, so the
    // change is visible.
    const home = mkTmp('ccrc-child-open-');
    seed(home, 'demo-plain');   // no marker: a non-child
    const { run, calls } = makeRunner(home);
    const unlistable: FleetIO = { ...localIO, readdir: async () => null };
    const w = await openApp(home, run, { io: unlistable }); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, sessionId: 'demo-plain' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'spent-unmeasured', detail: 'the registry could not be listed' });
    expect(okRuns(w.coord.runs())).toHaveLength(0);
    expect(verbsOf(calls)).not.toContain('ws-hold');
  });

  it('an unspent child hands over as today (a research wave)', async () => {
    const home = mkTmp('ccrc-child-open-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, sessionId: CHILD });
    expect(res.statusCode).toBe(200);
    expect(calls.filter((c) => c[0] === 'ws-hold')).toHaveLength(1);
    expect(okRuns(w.coord.runs())[0]?.sessionId).toBe(CHILD);
  });

  it('a workspace with NO marker binds as today, even one that has had a PR', async () => {
    const home = mkTmp('ccrc-child-open-');
    seed(home, CHILD, { prnumber: '42' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, sessionId: CHILD });
    expect(res.statusCode).toBe(200);
    expect(verbsOf(calls)).not.toContain('pr-state');
  });
});

describe('the coordinator is told, where it decides', () => {
  const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8');
  /** Prose wraps; a phrase is the same phrase across a line break
   *  (`coordinator-skill.test.ts`'s own `flat`). */
  const flat = (s: string): string => s.replace(/\s+/g, ' ');

  it('§5 states one PR per child AHEAD of the same-project arm, and names both refusals', () => {
    const wl = read('ccd/coordinator-skill/references/wave-lifecycle.md');
    const start = wl.indexOf('## 5 — The boundary');
    expect(start, 'wave-lifecycle.md lost §5').toBeGreaterThanOrEqual(0);
    const beforeSame = flat(wl.slice(start, wl.indexOf('**Same project:**', start)));
    expect(beforeSame, '§5 no longer says a spent producer is succeeded without its sessionId')
      .toContain('WITHOUT its `sessionId`');
    for (const code of ['`workspace-spent`', '`spent-unmeasured`']) expect(beforeSame).toContain(code);
  });

  it('SKILL.md step 6 says it before the same-project arm', () => {
    const skill = read('ccd/coordinator-skill/SKILL.md');
    const start = skill.indexOf('6. **Rule on the report**');
    expect(start, 'SKILL.md lost step 6').toBeGreaterThanOrEqual(0);
    expect(skill.slice(start, skill.indexOf('**Same project:**', start))).toContain('`workspace-spent`');
  });
});
