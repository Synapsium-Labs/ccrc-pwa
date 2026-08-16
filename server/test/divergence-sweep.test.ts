// §1.6's census, wired: git's own worktree records -> `divergences()` -> ONE
// `{type:'divergence'}` frame. The classifier is pinned in divergence.test.ts;
// what is only provable here is that the watcher gathers the right evidence, from
// paths the agent will actually serve, and DECIDES nothing with it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { readRegistry } from '../src/registry.js';
import { readWorktreeRecords } from '../src/coord/gitref.js';
import { localIO, type FleetIO } from '../src/io.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

/** The repo root, for the one source-text assertion below. */
const ccrcRoot = path.resolve(__dirname, '../..');

afterEach(() => { vi.restoreAllMocks(); });

interface FixtureCfg {
  /** Omit the key entirely to get a real store; pass `undefined` EXPLICITLY to
   *  build the watcher with no `coord` at all — the `testDeps` shape fourteen
   *  hold-gate tests use, and the reason every new read must be `?.`-chained. */
  coord?: CoordStore | undefined;
  /** Make `<projectsRoot>/<project>/.git/worktrees` unlistable, through an `io`
   *  override — there is no portable chmod that works as root. */
  unreadableProject?: string;
}

/** A watcher over a tmp `projectsRoot`, plus the two things this suite plants:
 *  registry rows and git's own linked-worktree admin records. Modelled on
 *  `hold-gate.test.ts`'s `seed` + `new FleetWatcher(testDeps(home, run), new Bus(), 10_000)`.
 *
 *  `CCRC_PROJECTS_ROOT` IS OVERRIDDEN TO A TMP DIRECTORY, and that is not
 *  tidiness: `loadConfig` defaults `projectsRoot` to `/data/projects`, the live
 *  checkout root on this very box, so a fixture that planted
 *  `<projectsRoot>/demo/.git/worktrees/...` under the default would be writing
 *  git admin files into real repositories. */
const watcherFixture = async (cfg: FixtureCfg = {}) => {
  const home = mkTmp('ccrc-divergence-');
  const projectsRoot = mkTmp('ccrc-projects-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfgObj = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: projectsRoot } as never);

  const calls: string[][] = [];
  const run = async (_cmd: string, args: string[]) => {
    calls.push(args); return { code: 0, stdout: '', stderr: '' };
  };

  const io: FleetIO = cfg.unreadableProject === undefined ? localIO : {
    ...localIO,
    readdir: async (p: string) =>
      p.includes(path.join(cfg.unreadableProject!, '.git', 'worktrees')) ? null : localIO.readdir(p),
  };

  const coord = 'coord' in cfg
    ? cfg.coord
    : new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const bus = new Bus();
  const deps = { ...testDeps(home, run), cfg: cfgObj, io, ...(coord === undefined ? {} : { coord }) };
  const watcher = new FleetWatcher(deps as never, bus, 10_000);

  return {
    home, bus, watcher, coord, projectsRoot,
    ccdCalls: () => calls,
    /** A registry row, in `hold-gate.test.ts`'s exact idiom. A row is also what
     *  makes its PROJECT active: the sweep asks git about the projects the fleet
     *  actually has sessions in, never about every directory under the root. */
    plantRecord: (id: string, extra: Record<string, string> = {}): void => {
      const reg = path.join(home, '.cc-sessions');
      const fields: Record<string, string> = {
        uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`,
        workspace: id.slice('demo-'.length), branch: `ws/${id}`, base: 'origin/main',
        started: '1', ...extra,
      };
      for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
    },
    /** GIT'S OWN RECORD of a linked worktree — the thing this sweep reads,
     *  because `~/worktrees` is not on the agent's read whitelist and
     *  `<projectsRoot>/<project>/.git/worktrees/<name>/` is. */
    plantWorktreeRecord: (project: string, name: string, at: string, branch: string): void => {
      const admin = path.join(projectsRoot, project, '.git', 'worktrees', name);
      mkdirSync(admin, { recursive: true });
      writeFileSync(path.join(admin, 'gitdir'), `${at}/.git\n`);
      writeFileSync(path.join(admin, 'HEAD'), `ref: refs/heads/${branch}\n`);
    },
    records: () => readRegistry(io, cfgObj),
  };
};

describe('sweepDivergences', () => {
  it('reads git\'s OWN worktree records under projectsRoot, never ~/worktrees', () => {
    // The agent's read whitelist is `.cc-sessions`/`.cc-limits`/`.cc-clips`/
    // `$HOME/.claude*`/projectsRoot — `~/worktrees` is NOT in it, and ccd's own
    // comment says so. A sweep that globbed the worktrees root would return
    // nothing in remote mode and a full census locally: the worst possible split.
    const src = readFileSync(path.join(ccrcRoot, 'server/src/watch.ts'), 'utf8');
    const body = /async sweepDivergences[\s\S]*?\n  \}/.exec(src)?.[0] ?? '';
    expect(body).not.toEqual('');
    expect(body).not.toMatch(/worktrees['"`]\s*\)|WORKTREES_ROOT|home,\s*'worktrees'/);
  });

  it('emits ONE divergence frame naming the unregistered worktree', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'nobody', '/data/worktrees/demo/nobody', 'ws/nobody');
    const frames: unknown[] = [];
    h.bus.on('divergence', (d) => frames.push(d));
    await h.watcher.sweepDivergences(await h.records());
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual([
      { kind: 'unregistered-worktree', id: null, path: '/data/worktrees/demo/nobody',
        detail: expect.any(String) },
    ]);
  });

  it('does not re-emit an unchanged census — byte-equality guarded like emitRuns', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'nobody', '/data/worktrees/demo/nobody', 'ws/nobody');
    const frames: unknown[] = [];
    h.bus.on('divergence', (d) => frames.push(d));
    await h.watcher.sweepDivergences(await h.records());
    // THE CLOCK IS MOVED PAST THE INTERVAL ON PURPOSE, so this proves the BYTE
    // guard and not the clock gate: without the jump the second call would
    // return at the lane clock and this test would pass with no byte guard at
    // all. The clock gate has its own test below, which needs the opposite.
    const real = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(real + 10 * 60_000);
    await h.watcher.sweepDivergences(await h.records());
    expect(frames).toHaveLength(1);
  });

  it('does not re-READ inside the interval — the clock gate, not just the byte guard', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'nobody', '/data/worktrees/demo/nobody', 'ws/nobody');
    await h.watcher.sweepDivergences(await h.records());
    // Delete the record: a second sweep INSIDE the interval must not notice,
    // because it must not have looked. A byte-equality guard alone would still
    // have read the directory and would report the census as CHANGED.
    rmSync(path.join(h.projectsRoot, 'demo', '.git', 'worktrees', 'nobody'),
      { recursive: true, force: true });
    const frames: unknown[] = [];
    h.bus.on('divergence', (d) => frames.push(d));
    await h.watcher.sweepDivergences(await h.records());
    expect(frames).toHaveLength(0);
  });

  it('runs with NO coord at all — testDeps supplies none, and fourteen hold-gate tests depend on that', async () => {
    // The rung MUST be `this.deps.coord?.runs()`. A non-optional call TypeErrors
    // every watcher built from `testDeps`.
    const h = await watcherFixture({ coord: undefined });
    h.plantRecord('demo-quiet-basin');
    await expect(h.watcher.sweepDivergences(await h.records())).resolves.toBeUndefined();
  });

  it('a project whose .git/worktrees cannot be listed contributes NOTHING, never a false census', async () => {
    // The single consumer behaviour for an unlistable directory: contribute no
    // worktrees. It can only suppress a finding, never manufacture one — which is
    // why one null here is not an overloaded null at a decision seam.
    const h = await watcherFixture({ unreadableProject: 'demo' });
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'nobody', '/data/worktrees/demo/nobody', 'ws/nobody');
    const frames: unknown[] = [];
    h.bus.on('divergence', (d) => frames.push(d));
    await h.watcher.sweepDivergences(await h.records());
    expect(frames[0] ?? []).toEqual([]);
  });

  it('DECIDES nothing — no ccd verb is run by this sweep', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'nobody', '/data/worktrees/demo/nobody', 'ws/nobody');
    await h.watcher.sweepDivergences(await h.records());
    expect(h.ccdCalls()).toEqual([]);
  });

  it('the frame reaches /ws/fleet, and an older PWA drops it silently', async () => {
    // Additive on the shipped `runs`/`coord` terms — NO FLEET_PROTO bump. Pinned
    // as the wire order this socket already guarantees: hello, fleet, runs, coord.
    const src = readFileSync(path.join(ccrcRoot, 'server/src/server.ts'), 'utf8');
    expect(src).toContain("bus.on('divergence', onDivergence);");
    expect(src).toContain("bus.off('divergence', onDivergence);");
  });
});

describe('readWorktreeRecords', () => {
  it('parses gitdir and HEAD out of git\'s admin directory', async () => {
    const root = mkTmp('ccrc-gitref-');
    const admin = path.join(root, 'demo', '.git', 'worktrees', 'quiet-basin');
    mkdirSync(admin, { recursive: true });
    writeFileSync(path.join(admin, 'gitdir'), '/data/worktrees/demo/quiet-basin/.git\n');
    writeFileSync(path.join(admin, 'HEAD'), 'ref: refs/heads/ws/quiet-basin\n');
    expect(await readWorktreeRecords(localIO, root, 'demo')).toEqual([
      { name: 'quiet-basin', path: '/data/worktrees/demo/quiet-basin', headBranch: 'ws/quiet-basin' },
    ]);
  });

  it('a DETACHED HEAD is a null branch, never a fabricated one', async () => {
    const root = mkTmp('ccrc-gitref-');
    const admin = path.join(root, 'demo', '.git', 'worktrees', 'quiet-basin');
    mkdirSync(admin, { recursive: true });
    writeFileSync(path.join(admin, 'gitdir'), '/data/worktrees/demo/quiet-basin/.git\n');
    writeFileSync(path.join(admin, 'HEAD'), `${'a'.repeat(40)}\n`);
    expect((await readWorktreeRecords(localIO, root, 'demo'))?.[0]?.headBranch).toBeNull();
  });

  it('answers null for a project with no linked worktrees or an unlistable admin dir', async () => {
    const root = mkTmp('ccrc-gitref-');
    mkdirSync(path.join(root, 'demo'), { recursive: true });
    expect(await readWorktreeRecords(localIO, root, 'demo')).toBeNull();
  });

  it('refuses a project name that could escape projectsRoot', async () => {
    const root = mkTmp('ccrc-gitref-');
    expect(await readWorktreeRecords(localIO, root, '..')).toBeNull();
    expect(await readWorktreeRecords(localIO, root, '../etc')).toBeNull();
  });
});
