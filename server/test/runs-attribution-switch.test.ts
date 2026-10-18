// Coordinator-first Task 11b (D-5298, spec 2026-10-17 §4 and §6.4): the
// parent binding is attributed, and only children are bound — the server half
// of what Task 11a's `ccrc-api` began sending.
//
// `POST /api/runs` is where a coordinator becomes a child's parent. From this
// task it refuses, through `openRunPreconditions`' gates:
//   - a claimant that does not prove it is the claimant (`claimedByUuid`
//     against its own `$REG/<id>.uuid`), once the fleet carries the client —
//     before that an unattributed open is accepted and journaled
//     `unattributed` (the mechanical switch-over, `fleetCarriesRunsAttribution`);
//   - a claimant whose own registry project is not the run's
//     (`409 project-mismatch`);
//   - a `sessionId` naming an existing registry row with no child marker
//     (`409 not-a-child`); a row-less id is still accepted, because a dispatch
//     opens its run before `ws-add --child <run>` makes the row.
// The reclaim door's heir meets the same project rule.
//
// Fixtures: the plan's neutral ids (Global constraints); the registry rows
// copy `run-routes.test.ts`'s own `seed` field set; the open body copies
// `child-reclaim-refusals.test.ts`'s OPEN_BODY shape.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import type { Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import type { BuildInfo } from '../../shared/buildinfo.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRuns } from './coordReadHelpers.js';

const TOKEN = 'f'.repeat(64);
const headers = { 'x-ccrc-mail-token': TOKEN };
const PARENT = 'project-a-calm-mesa';       // operator-created, no `.child`
const ROOT_TWO = 'project-a-open-dune';     // a second operator-created session, no `.child`
const CHILD = 'project-a-quiet-basin';      // a dispatched child
const FOREIGN = 'project-b-far-ridge';      // a session in another project
const UPGRADE_HINT = "upgrade the fleet box's ccrc-api (ccrc rollout)";

const OPEN = {
  program: 'program-a', title: 'Wave two', project: 'project-a',
  wave: 2, waveOf: 3, claimedBy: PARENT, homeProject: 'project-a',
} as const;

/** A full registry row — `run-routes.test.ts`'s own `seed` field set. */
const seed = (home: string, id: string, project: string, over: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'lane-a', project, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};
const seedFleet = (home: string): void => {
  seed(home, PARENT, 'project-a');
  seed(home, ROOT_TWO, 'project-a');
  seed(home, CHILD, 'project-a', { child: '5' });
  seed(home, FOREIGN, 'project-b');
};

/** `child-reclaim-refusals.test.ts`'s `noPrLine`: the child has had no PR, so
 *  rule 3's child gate admits it and only this task's gates are measured. */
const noPrLine = (id: string): string =>
  JSON.stringify({ id, rows: [], baseShort: 'main', branch: `ws/${id}`, ahead: 1, tip: 'f'.repeat(40), checkedAt: 1 });
const runner: Runner = async (_cmd, args) =>
  (args[0] === 'pr-state' ? { code: 0, stdout: `${noPrLine(CHILD)}\n`, stderr: '' } : { code: 0, stdout: '', stderr: '' });
const stamp = (sha: string, version?: string): BuildInfo => ({
  sha, ref: 'main', builtAt: '2026-10-18T00:00:00Z', dirty: false, ...(version !== undefined ? { version } : {}),
});

/** `over` replaces deps wholesale; `role` overrides the config's derived one. */
const openApp = async (home: string, opts: { role?: 'server' | 'both'; over?: Partial<Deps> } = {}) => {
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, runner);
  const cfg = opts.role !== undefined ? { ...base.cfg, role: opts.role } : base.cfg;
  const app = await buildServer({ ...base, cfg, mailToken: TOKEN, coord, ...opts.over });
  return { app, coord };
};
/** The fleet NOT upgraded: a server box whose fleet stamp is an older sha with
 *  no version (`stale`) or absent (`null`, an unreadable stamp). */
const notUpgraded = (fleet: BuildInfo | null): { role: 'server'; over: Partial<Deps> } => ({
  role: 'server',
  over: {
    build: stamp('b'.repeat(40)),
    fleetState: { connected: true, downSince: null, rosterFp: null, build: fleet, ccdVerbs: null },
  },
});
const post = (app: FastifyInstance, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/runs', headers, payload: body });
const attributed = (id: string) => ({ claimedBy: id, claimedByUuid: `u-${id}` });
const unattributedCount = (coord: CoordStore): number =>
  (coord.db.prepare('SELECT COUNT(*) AS n FROM runs WHERE unattributed = 1').get() as { n: number }).n;

describe('POST /api/runs — the fleet carries the client (D-5298)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('a claimant with the box token and no claimedByUuid is 409 attribution-required, with the upgrade hint', async () => {
    const home = mkTmp('ccrc-attr-');
    seedFleet(home);
    const w = await openApp(home); app = w.app;
    const res = await post(app, { ...OPEN });
    expect([res.statusCode, res.json()]).toEqual([409, { ok: false, refused: 'attribution-required', detail: UPGRADE_HINT }]);
    expect(okRuns(w.coord.runs()), 'a refused open left a planned orphan').toHaveLength(0);
  });

  it('a stale uuid is 403 stale-uuid', async () => {
    const home = mkTmp('ccrc-attr-');
    seedFleet(home);
    const w = await openApp(home); app = w.app;
    const res = await post(app, { ...OPEN, claimedByUuid: 'u-rotated' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'stale-uuid' });
  });

  it('a claimant with no registry row is 403 unknown-sender', async () => {
    const home = mkTmp('ccrc-attr-');
    seedFleet(home);
    const w = await openApp(home); app = w.app;
    const res = await post(app, { ...OPEN, claimedBy: 'project-a-no-such', claimedByUuid: 'u-x' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'unknown-sender' });
  });

  it('a well-attributed same-project open succeeds as today, and is not journaled unattributed', async () => {
    const home = mkTmp('ccrc-attr-');
    seedFleet(home);
    const w = await openApp(home); app = w.app;
    const res = await post(app, { ...OPEN, ...attributed(PARENT), sessionId: CHILD });
    expect(res.statusCode).toBe(200);
    expect(w.coord.parentOfSession(CHILD)).toBe(PARENT);
    expect(unattributedCount(w.coord)).toBe(0);
  });

  it('a listed `.uuid` whose row cannot be built (and no `.child`) is 502 registry-unmeasurable, never admitted as row-less', async () => {
    // A half-written entry: the `.uuid` is listed but `wrapper` and `workdir`
    // are not, so no row is built around it. It cannot be proven absent, so
    // the route answers `unbuilt`, not `absent` (the D-5298 route mapping).
    const home = mkTmp('ccrc-attr-');
    seedFleet(home);
    const half = 'project-a-half-written';
    writeFileSync(path.join(home, '.cc-sessions', `${half}.uuid`), `u-${half}`);
    const w = await openApp(home); app = w.app;
    const res = await post(app, { ...OPEN, ...attributed(PARENT), sessionId: half });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    expect(okRuns(w.coord.runs()), 'a refused open left a planned orphan').toHaveLength(0);
    expect(w.coord.parentOfSession(half)).toBeNull();
  });

  it('not a child: naming an existing row with no `.child` is 409 not-a-child, and that root stays unbound', async () => {
    const home = mkTmp('ccrc-attr-');
    seedFleet(home);
    const w = await openApp(home); app = w.app;
    const res = await post(app, { ...OPEN, ...attributed(PARENT), sessionId: ROOT_TWO });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'not-a-child' });
    expect(okRuns(w.coord.runs())).toHaveLength(0);
    // Its next question still reaches the operator: no run names it, so no
    // parent answers for it.
    expect(w.coord.parentOfSession(ROOT_TWO)).toBeNull();
  });

  it('a run naming a not-yet-registered id is accepted (a dispatch opens its run before ws-add makes the row)', async () => {
    const home = mkTmp('ccrc-attr-');
    seedFleet(home);
    const w = await openApp(home); app = w.app;
    const res = await post(app, { ...OPEN, ...attributed(PARENT), sessionId: 'project-a-new-leaf' });
    expect(res.statusCode).toBe(200);
  });

  it('a claimant in another project naming a child of project-a is 409 project-mismatch, and the child is not rebound', async () => {
    const home = mkTmp('ccrc-attr-');
    seedFleet(home);
    const w = await openApp(home); app = w.app;
    const first = await post(app, { ...OPEN, ...attributed(PARENT), sessionId: CHILD });
    expect(first.statusCode).toBe(200);
    const res = await post(app, { ...OPEN, program: 'program-b', wave: 1, waveOf: 1, ...attributed(FOREIGN), sessionId: CHILD });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'project-mismatch', by: 'project-b' });
    expect(w.coord.parentOfSession(CHILD)).toBe(PARENT);
  });
});

describe('POST /api/runs — the fleet does not carry the client yet (D-5298)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  for (const [name, fleet] of [['an older sha and no version', stamp('a'.repeat(40))], ['an unreadable stamp', null]] as const) {
    it(`${name}: an open with no claimedByUuid is accepted and journaled unattributed`, async () => {
      const home = mkTmp('ccrc-attr-');
      seedFleet(home);
      const w = await openApp(home, notUpgraded(fleet)); app = w.app;
      const res = await post(app, { ...OPEN, sessionId: CHILD });
      expect(res.statusCode).toBe(200);
      expect(unattributedCount(w.coord)).toBe(1);
    });

    it(`${name}: the project and not-a-child checks still refuse`, async () => {
      const home = mkTmp('ccrc-attr-');
      seedFleet(home);
      const w = await openApp(home, notUpgraded(fleet)); app = w.app;
      const root = await post(app, { ...OPEN, sessionId: ROOT_TWO });
      expect(root.statusCode).toBe(409);
      expect(root.json()).toMatchObject({ ok: false, refused: 'not-a-child' });
      const foreign = await post(app, { ...OPEN, claimedBy: FOREIGN, sessionId: CHILD });
      expect(foreign.statusCode).toBe(409);
      expect(foreign.json()).toMatchObject({ ok: false, refused: 'project-mismatch', by: 'project-b' });
      expect(okRuns(w.coord.runs())).toHaveLength(0);
    });
  }

  it('an unattributed claimedBy that is not a listed registry row is 403 unknown-sender, never path-joined into a field read', async () => {
    // `../outside` would read `<registryDir>/../outside.project`, a file
    // outside the registry: its content must neither admit the open nor come
    // back as `by`.
    const home = mkTmp('ccrc-attr-');
    seedFleet(home);
    writeFileSync(path.join(home, 'outside.project'), 'project-a');
    const w = await openApp(home, notUpgraded(null)); app = w.app;
    for (const claimedBy of ['../outside', 'project-a-not-listed']) {
      const res = await post(app, { ...OPEN, claimedBy });
      expect(res.statusCode, claimedBy).toBe(403);
      expect(res.json()).toMatchObject({ ok: false, error: 'unknown-sender' });
    }
    expect(okRuns(w.coord.runs())).toHaveLength(0);
  });

  it('a stale uuid is still refused before the switch-over (a sent uuid is always checked)', async () => {
    const home = mkTmp('ccrc-attr-');
    seedFleet(home);
    const w = await openApp(home, notUpgraded(null)); app = w.app;
    const res = await post(app, { ...OPEN, claimedByUuid: 'u-rotated' });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/runs/:id/reclaim — the heir meets the project rule (D-5298)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('an heir from another project is 409 project-mismatch; a same-project heir is admitted', async () => {
    const home = mkTmp('ccrc-attr-');
    seedFleet(home);
    const dead = 'project-a-gone-dusk';
    const w = await openApp(home); app = w.app;
    // A run whose claimant has no registry row: the reclaim door's own
    // "registry-absent" dead claimant (reclaim.ts's rung 4).
    const opened = w.coord.openRun({ program: 'program-a', title: 'Wave one', project: 'project-a',
      wave: 1, waveOf: 1, claimedBy: dead, kind: 'work', reviews: null });
    if (!('id' in opened)) throw new Error('fixture: the run must open');
    const foreign = await app.inject({ method: 'POST', url: `/api/runs/${opened.id}/reclaim`, payload: { claimedBy: FOREIGN } });
    expect(foreign.statusCode).toBe(409);
    expect(foreign.json()).toMatchObject({ ok: false, refused: 'project-mismatch', by: 'project-b' });
    const same = await app.inject({ method: 'POST', url: `/api/runs/${opened.id}/reclaim`, payload: { claimedBy: ROOT_TWO } });
    expect(same.statusCode).toBe(200);
  });
});

describe('fleetCarriesRunsAttribution — the switch-over, pure (D-5298)', () => {
  const own = stamp('c'.repeat(40));
  it('answers over agreement, the version floor and the role', async () => {
    const { fleetCarriesRunsAttribution } = await import('../src/fleetstate.js');
    const { RUNS_ATTRIBUTION_SINCE } = await import('../../shared/api.js');
    expect(RUNS_ATTRIBUTION_SINCE).toBe('v0.0.239');
    const rows: [string, Parameters<typeof fleetCarriesRunsAttribution>, boolean][] = [
      ['agreed', ['server', own, stamp('c'.repeat(40))], true],
      ['divergent, no version', ['server', own, stamp('d'.repeat(40))], false],
      ['unknown (no fleet stamp)', ['server', own, null], false],
      ['unknown (no own stamp)', ['server', null, stamp('d'.repeat(40))], false],
      ['a version below the floor', ['server', own, stamp('d'.repeat(40), 'v0.0.238')], false],
      ['a version at the floor', ['server', own, stamp('d'.repeat(40), 'v0.0.239')], true],
      ['a version past the floor', ['server', own, stamp('d'.repeat(40), 'v0.1.0')], true],
      ['a dirty fleet stamp at the same sha (skewed)', ['server', own, { ...stamp('c'.repeat(40)), dirty: true }], false],
      ['role both, a null fleet stamp and a tagless own build', ['both', stamp('e'.repeat(40)), null], true],
      ['role both, no stamps at all', ['both', null, null], true],
    ];
    for (const [name, args, want] of rows) expect(fleetCarriesRunsAttribution(...args), name).toBe(want);
  });
});
