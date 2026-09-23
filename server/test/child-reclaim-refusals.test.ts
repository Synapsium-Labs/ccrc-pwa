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
import { unreadableField, degradedReadIO } from './ioDoubles.js';
import { okRuns, okRun } from './coordReadHelpers.js';
import { holdReason } from '../src/coord/rundefs.js';

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

const postDispatch = (app: FastifyInstance, id: number) =>
  app.inject({ method: 'POST', url: `/api/runs/${id}/dispatch`, headers, payload: { brief: 'do the thing' } });

describe('POST /api/runs/:id/dispatch — a child spent since its open', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  /** Opens wave `wave` on the child while it is still UNSPENT, as a
   *  coordinator following the protocol would. */
  const openOn = async (a: FastifyInstance, wave: number): Promise<number> => {
    const res = await postOpen(a, { ...OPEN_BODY, wave, sessionId: CHILD });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { id: number }).id;
  };

  it('refuses before ensure, releases the claim, unbinds the run — and the next dispatch mints a fresh child', async () => {
    const home = mkTmp('ccrc-child-dispatch-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const id = await openOn(app, 2);
    spend(home, CHILD, 42);   // the previous wave's worker opened its PR after this open
    const before = calls.length;

    const res = await postDispatch(app, id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'workspace-spent', pr: 42, unbound: true });
    const after = calls.slice(before);
    expect(after).toContainEqual(['ws-release', '--session', CHILD]);
    expect(verbsOf(after), 'a spent child was resumed').not.toContain('ensure');
    expect(verbsOf(after), 'a /clear was typed into a spent child').not.toContain('send-keys');
    const row = okRun(w.coord.run(id))!;
    expect(row.state).toBe('planned');
    expect(row.sessionId).toBeNull();
    expect(row.dispatchedAt).toBeNull();
    expect(w.coord.runEvents(id).map((e) => e.detail)).toContain(`session-unbound: ${CHILD} (workspace-spent #42)`);

    // The automated exit: rule 4 forbids a refusal that needs a human.
    const again = await postDispatch(app, id);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toMatchObject({ ok: true, sessionId: `${PROJECT}-fresh`, resumed: false });
  });

  it('a failed release changes nothing — unbound:false, the binding kept, no unbind event', async () => {
    const home = mkTmp('ccrc-child-dispatch-');
    seed(home, CHILD, { child: '5' });
    const { run } = makeRunner(home, { fail: new Set(['ws-release']) });
    const w = await openApp(home, run); app = w.app;
    const id = await openOn(app, 2);
    spend(home, CHILD, 42);
    const res = await postDispatch(app, id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'workspace-spent', pr: 42, unbound: false });
    expect((res.json() as { detail: string }).detail).toContain('ws-release failed');
    expect(okRun(w.coord.run(id))!.sessionId).toBe(CHILD);
    expect(w.coord.runEvents(id).map((e) => e.detail).join('\n')).not.toContain('session-unbound');
  });

  it('a box whose ccd does not advertise ws-release changes nothing', async () => {
    const home = mkTmp('ccrc-child-dispatch-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run, { fleetState: {
      connected: true, downSince: null, ccdVerbs: ['ws-hold', 'pr-state', 'ensure', 'ws-add'], rosterFp: null, build: null,
    } }); app = w.app;
    const id = await openOn(app, 2);
    spend(home, CHILD, 42);
    const before = calls.length;
    const res = await postDispatch(app, id);
    expect(res.json()).toEqual({ ok: false, refused: 'workspace-spent', pr: 42,
      detail: 'this box\'s ccd does not support ws-release', unbound: false });
    expect(verbsOf(calls.slice(before))).not.toContain('ws-release');
    expect(okRun(w.coord.run(id))!.sessionId).toBe(CHILD);
  });

  it('spent-unmeasured at dispatch keeps the binding and sends nothing — unknown is not spent', async () => {
    const home = mkTmp('ccrc-child-dispatch-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home);
    let degrade = false;
    const io = degradedReadIO((p) => degrade && p.endsWith(`${CHILD}.child`));
    const w = await openApp(home, run, { io }); app = w.app;
    const id = await openOn(app, 2);
    degrade = true;
    const before = calls.length;
    const res = await postDispatch(app, id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'spent-unmeasured',
      detail: 'the child marker could not be read', unbound: false });
    expect(verbsOf(calls.slice(before))).not.toContain('ws-release');
    expect(verbsOf(calls.slice(before))).not.toContain('ensure');
    expect(okRun(w.coord.run(id))!.sessionId).toBe(CHILD);
  });

  it('a sibling still open on the child keeps its claim: the hold is HANDED OVER, never released', async () => {
    const home = mkTmp('ccrc-child-dispatch-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const a = await openOn(app, 2);   // still open — dispatched out of protocol order
    const b = await openOn(app, 3);
    spend(home, CHILD, 42);
    const before = calls.length;
    const res = await postDispatch(app, b);
    expect(res.json()).toEqual({ ok: false, refused: 'workspace-spent', pr: 42, unbound: true });
    const after = calls.slice(before);
    expect(after).toContainEqual(['ws-hold', '--session', CHILD, '--reason', holdReason('build4', 2, 3, a)]);
    expect(verbsOf(after), 'a release would drop the live sibling\'s claim').not.toContain('ws-release');
    expect(okRun(w.coord.run(b))!.sessionId).toBeNull();
    expect(okRun(w.coord.run(a))!.sessionId).toBe(CHILD);
  });

  it('an UNREADABLE sibling list refuses before any fleet act', async () => {
    const home = mkTmp('ccrc-child-dispatch-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const a = await openOn(app, 2);
    const b = await openOn(app, 3);
    // An integer this process cannot represent — `openRunsForSession` refuses
    // the whole list rather than assert "nothing else claims it" (D-2545).
    w.coord.db.prepare('UPDATE runs SET wave = ? WHERE id = ?').run(BigInt(Number.MAX_SAFE_INTEGER) + 1n, a);
    spend(home, CHILD, 42);
    const before = calls.length;
    const res = await postDispatch(app, b);
    expect(res.json()).toMatchObject({ ok: false, refused: 'workspace-spent', pr: 42, unbound: false });
    expect(verbsOf(calls.slice(before))).not.toContain('ws-release');
    expect(verbsOf(calls.slice(before))).not.toContain('ws-hold');
    expect(okRun(w.coord.run(b))!.sessionId).toBe(CHILD);
  });

  it('an INVALID survivor hold refuses before any fleet act — the claim is never handed to a hold the hook rejects', async () => {
    const home = mkTmp('ccrc-child-dispatch-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const b = await openOn(app, 3);
    // `coord-abandon.test.ts`'s invalid-survivor fixture: a reconstructed run,
    // still open on the child, whose programme slug the hold grammar rejects.
    const [survivor] = w.coord.reconstruct({
      ledger: { slug: 'bad program', title: 'Recovered', waves: [{ wave: 1, of: 1, handoffCommit: null }] },
      registry: { sessionId: CHILD, project: PROJECT, workspace: CHILD, branch: `ws/${CHILD}`, held: 'legacy hold' },
      prHistory: [],
    });
    if (!survivor) throw new Error('reconstruct did not return a survivor');
    spend(home, CHILD, 42);
    const before = calls.length;
    const res = await postDispatch(app, b);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'workspace-spent', pr: 42, unbound: false });
    expect((res.json() as { detail: string }).detail).toContain('the surviving run\'s claim cannot be written');
    expect(verbsOf(calls.slice(before))).not.toContain('ws-release');
    expect(verbsOf(calls.slice(before))).not.toContain('ws-hold');
    expect(okRun(w.coord.run(b))!.sessionId).toBe(CHILD);
  });

  it('an UNLISTABLE registry at dispatch refuses spent-unmeasured for a NON-child too — where the resume arm used to answer 502', async () => {
    // Spec §5.4's fail-shut exception, pinned at the second door: the gate's
    // listing fails, it cannot tell a child from any workspace, so it refuses
    // retryably before `ensure`. Readdir calls: 1 the open's gate, 2 the
    // dispatch pause check, 3 dispatch's gate — the one this fails.
    const home = mkTmp('ccrc-child-dispatch-');
    seed(home, 'demo-plain');   // no marker
    const { run, calls } = makeRunner(home);
    let n = 0;
    const io: FleetIO = { ...localIO, readdir: async (p) => { n += 1; return n === 3 ? null : localIO.readdir(p); } };
    const w = await openApp(home, run, { io }); app = w.app;
    const opened = await postOpen(app, { ...OPEN_BODY, wave: 2, sessionId: 'demo-plain' });
    expect(opened.statusCode, opened.body).toBe(200);
    const id = (opened.json() as { id: number }).id;
    const before = calls.length;
    const res = await postDispatch(app, id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'spent-unmeasured',
      detail: 'the registry could not be listed', unbound: false });
    expect(verbsOf(calls.slice(before))).not.toContain('ensure');
    expect(okRun(w.coord.run(id))!.sessionId).toBe('demo-plain');
  });
});

describe('the dispatch refusal is documented field for field', () => {
  it('names every field the 409 carries, in the §2 rows that explain it', () => {
    // HARVESTED from the route's own arm rather than typed, so a field added
    // there reds here until the coordinator is told what it means.
    const routes = readFileSync(path.join(repoRoot, 'server/src/coord/routes.ts'), 'utf8');
    const at = routes.indexOf("case 'childSpent':");
    expect(at, 'sendDispatchOutcome has no childSpent arm — this harvest is stale').toBeGreaterThan(-1);
    const arm = routes.slice(at, routes.indexOf('\n    case ', at + 1));
    const fields = [...new Set([...arm.matchAll(/(\w+):/g)].map((m) => m[1]!))]
      .filter((f) => f !== 'ok' && f !== 'refused').sort();
    expect(fields).toEqual(['detail', 'pr', 'unbound']);
    const wl = readFileSync(path.join(repoRoot, 'ccd/coordinator-skill/references/wave-lifecycle.md'), 'utf8');
    const s2 = wl.slice(wl.indexOf('## 2 — Dispatch a wave'), wl.indexOf('## 3 — Read mail'));
    const rows = s2.split('\n')
      .filter((l) => l.startsWith('| `workspace-spent`') || l.startsWith('| `spent-unmeasured`')).join('\n');
    expect(rows, '§2 carries no workspace-spent/spent-unmeasured rows').not.toBe('');
    for (const f of fields) expect(rows, `§2's rows never name \`${f}\``).toContain(`\`${f}\``);
  });

  it('§5 tells the coordinator what unbound:true asks of it', () => {
    const wl = readFileSync(path.join(repoRoot, 'ccd/coordinator-skill/references/wave-lifecycle.md'), 'utf8');
    const start = wl.indexOf('## 5 — The boundary');
    expect(wl.slice(start, wl.indexOf('**Same project:**', start)).replace(/\s+/g, ' ')).toContain('`unbound:true`');
  });
});
