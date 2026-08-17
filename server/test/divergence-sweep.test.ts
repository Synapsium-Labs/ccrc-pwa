// §1.6's census, wired: git's own worktree records -> `divergences()` -> ONE
// `{type:'divergence'}` frame. The classifier is pinned in divergence.test.ts;
// what is only provable here is that the watcher gathers the right evidence, from
// paths the agent will actually serve, and DECIDES nothing with it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { chmodSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
    /** The registry's own DIRECTORY LISTING, which the sweep now takes as
     *  evidence a workspace is claimed before its row parses. `tick()` passes
     *  the listing `readRegistryMeasured` already took; here it is read the
     *  same way, from the same directory. */
    names: async (): Promise<string[]> => (await io.readdir(cfgObj.registryDir)) ?? [],
  };
};

/** One sweep, with both of its inputs — `records` and the listing they came
 *  from. A helper because every test below needs both and neither is
 *  interesting on its own. */
const sweep = async (h: Awaited<ReturnType<typeof watcherFixture>>): Promise<void> =>
  h.watcher.sweepDivergences(await h.records(), await h.names());

/** The clock, moved past the lane's own 60s interval. Every test that sweeps
 *  more than once needs this or the second call returns at the clock gate
 *  having looked at nothing. */
const jump = (minutes: number): void => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + minutes * 60_000);
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

  it('emits ONE divergence frame naming the unregistered worktree — on the SECOND sighting', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'nobody', '/data/worktrees/demo/nobody', 'ws/nobody');
    const frames: unknown[] = [];
    h.bus.on('divergence', (d) => frames.push(d));
    await sweep(h);
    // The debounce, from the wiring's side: the first sighting publishes the
    // healthy census, not the finding. The memory that carries it to the next
    // sweep lives on the watcher, so this pair also proves the field is
    // actually written — with it left unassigned, the second sweep would be a
    // first sighting again and this test would never see the frame below.
    expect(frames).toEqual([[]]);
    jump(10);
    await sweep(h);
    expect(frames).toHaveLength(2);
    expect(frames[1]).toEqual([
      { kind: 'unregistered-worktree', id: null, path: '/data/worktrees/demo/nobody',
        detail: expect.any(String) },
    ]);
  });

  it('a workspace mid-ws-add is not named — the registry LISTING claims it before the row does', async () => {
    // The false positive, seeded exactly as `cmd_ws_add` leaves the box between
    // `git worktree add` and the fourth `_reg_set`: git's admin record is
    // written, `.wrapper`/`.project`/`.workdir` exist, `.uuid` does not — so
    // `readRegistry` (which derives ids from `*.uuid`) hands the sweep no row
    // for it at all. Swept TWICE, past the debounce, so the claim rule is the
    // only thing that can be keeping this census empty.
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'newborn', '/data/worktrees/demo/newborn', 'ws/newborn');
    for (const [f, v] of [['wrapper', 'claude'], ['project', 'demo'],
                          ['workdir', '/data/worktrees/demo/newborn']]) {
      writeFileSync(path.join(h.home, '.cc-sessions', `demo-newborn.${f}`), v!);
    }
    expect((await h.records()).map((r) => r.id), 'the partial row is not the state under test')
      .toEqual(['demo-quiet-basin']);
    const frames: unknown[] = [];
    h.bus.on('divergence', (d) => frames.push(d));
    await sweep(h);
    jump(10);
    await sweep(h);
    expect(frames).toEqual([[]]);
  });

  it('does not re-emit an unchanged census — byte-equality guarded like emitRuns', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'nobody', '/data/worktrees/demo/nobody', 'ws/nobody');
    const frames: unknown[] = [];
    h.bus.on('divergence', (d) => frames.push(d));
    await sweep(h);
    // THE CLOCK IS MOVED PAST THE INTERVAL ON PURPOSE, so this proves the BYTE
    // guard and not the clock gate: without the jump the later calls would
    // return at the lane clock and this test would pass with no byte guard at
    // all. The clock gate has its own test below, which needs the opposite.
    jump(10);
    await sweep(h);
    // Two frames so far and they are DIFFERENT: the empty first sighting, then
    // the finding the debounce released. The third sweep re-measures the same
    // state and must publish nothing.
    expect(frames).toHaveLength(2);
    jump(20);
    await sweep(h);
    expect(frames).toHaveLength(2);
  });

  it('does not re-READ inside the interval — the clock gate, not just the byte guard', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'nobody', '/data/worktrees/demo/nobody', 'ws/nobody');
    await sweep(h);
    // Delete the record: a second sweep INSIDE the interval must not notice,
    // because it must not have looked. A byte-equality guard alone would still
    // have read the directory and would report the census as CHANGED.
    rmSync(path.join(h.projectsRoot, 'demo', '.git', 'worktrees', 'nobody'),
      { recursive: true, force: true });
    const frames: unknown[] = [];
    h.bus.on('divergence', (d) => frames.push(d));
    await sweep(h);
    expect(frames).toHaveLength(0);
  });

  it('runs with NO coord at all — testDeps supplies none, and fourteen hold-gate tests depend on that', async () => {
    // The rung MUST be `this.deps.coord?.runs()`. A non-optional call TypeErrors
    // every watcher built from `testDeps`.
    const h = await watcherFixture({ coord: undefined });
    h.plantRecord('demo-quiet-basin');
    await expect(sweep(h)).resolves.toBeUndefined();
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
    await sweep(h);
    jump(10);
    await sweep(h);
    expect(frames[0] ?? []).toEqual([]);
  });

  it('DECIDES nothing — no ccd verb is run by this sweep', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'nobody', '/data/worktrees/demo/nobody', 'ws/nobody');
    await sweep(h);
    jump(10);
    await sweep(h);
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
    expect(await readWorktreeRecords(localIO, root, 'demo')).toEqual({
      ok: true,
      records: [
        { name: 'quiet-basin', path: '/data/worktrees/demo/quiet-basin', headBranch: 'ws/quiet-basin' },
      ],
    });
  });

  it('a DETACHED HEAD is a null branch, never a fabricated one', async () => {
    const root = mkTmp('ccrc-gitref-');
    const admin = path.join(root, 'demo', '.git', 'worktrees', 'quiet-basin');
    mkdirSync(admin, { recursive: true });
    writeFileSync(path.join(admin, 'gitdir'), '/data/worktrees/demo/quiet-basin/.git\n');
    writeFileSync(path.join(admin, 'HEAD'), `${'a'.repeat(40)}\n`);
    const r = await readWorktreeRecords(localIO, root, 'demo');
    expect(r.ok && r.records[0]?.headBranch).toBeNull();
  });

  // §1.7. The three facts the old `null` carried at once, now told apart. Two of
  // them are opposites — "this server will never read a census for that project"
  // and "the answer is zero" — and the consumer suppressing all three is a
  // property of TODAY'S consumer, not a licence to throw the answer away before
  // it reaches tomorrow's.
  it('NO LINKED WORKTREES is a measured zero, not a failure — git creates the dir with the first one', async () => {
    const root = mkTmp('ccrc-gitref-');
    mkdirSync(path.join(root, 'demo'), { recursive: true });
    expect(await readWorktreeRecords(localIO, root, 'demo')).toEqual({ ok: true, records: [] });
  });

  it('an EXISTING admin dir that will not list is unlistable — the opposite fact, and it says so', async () => {
    // `stat` is what separates the two: it needs only search permission on the
    // parent chain, so a directory whose own listing is refused is still proved
    // PRESENT. Same technique `readBranchTip` uses on a loose ref.
    const root = mkTmp('ccrc-gitref-');
    const admin = path.join(root, 'demo', '.git', 'worktrees');
    mkdirSync(admin, { recursive: true });
    chmodSync(admin, 0o000);
    try {
      expect(await readWorktreeRecords(localIO, root, 'demo'))
        .toEqual({ ok: false, reason: 'unlistable' });
    } finally {
      chmodSync(admin, 0o755);   // or the tmp cleanup cannot remove it
    }
  });

  it('an EMPTY admin dir is also a measured zero — listable, and it lists nothing', async () => {
    const root = mkTmp('ccrc-gitref-');
    mkdirSync(path.join(root, 'demo', '.git', 'worktrees'), { recursive: true });
    expect(await readWorktreeRecords(localIO, root, 'demo')).toEqual({ ok: true, records: [] });
  });

  // THE ESCAPE TARGETS ARE PLANTED AND LISTABLE, and that is the whole test.
  // The previous form planted NOTHING, so `path.join(root, '..', '.git',
  // 'worktrees')` named a directory that does not exist, `io.readdir` answered
  // null, and the function returned null WITH OR WITHOUT the guard: measured
  // 2026-08-17 by deleting the guard line outright — 12/12 still green. A guard
  // whose test cannot fail is not pinned, it is decorated.
  //
  // So each escaping name below has a REAL admin directory waiting at the path
  // it would reach, and a POSITIVE CONTROL immediately proves that directory is
  // readable by this very function through a legitimate name. With the fixture
  // proven live, a `null` for the escaping name can only have come from the
  // guard. Deleting the guard turns all three assertions red.
  describe('refuses a project name that could escape projectsRoot', () => {
    /** Git's own admin record for one linked worktree, at `dir`. */
    const plantAdmin = (dir: string): void => {
      const admin = path.join(dir, '.git', 'worktrees', 'escaped');
      mkdirSync(admin, { recursive: true });
      writeFileSync(path.join(admin, 'gitdir'), '/data/worktrees/escaped/.git\n');
      writeFileSync(path.join(admin, 'HEAD'), 'ref: refs/heads/ws/escaped\n');
    };
    const escapedRecord = {
      ok: true,
      records: [{ name: 'escaped', path: '/data/worktrees/escaped', headBranch: 'ws/escaped' }],
    };
    // §1.7: a refused NAME is its own answer now, and — the point of the change —
    // it is no longer the same value as "this project has no linked worktrees".
    // These assertions would pass against a measured-zero too if both still read
    // `null`, which is exactly the collapse being undone.
    const REFUSED = { ok: false, reason: 'refused-project' };
    /** `<tmp>/<base>/projects` is the projects root, so `..` and `../<name>`
     *  both have somewhere real to land, one level above it. */
    const fixture = () => {
      const base = mkTmp('ccrc-gitref-');
      const root = path.join(base, 'projects');
      mkdirSync(root, { recursive: true });
      plantAdmin(root);                            // reached by `.`
      plantAdmin(base);                            // reached by `..`
      plantAdmin(path.join(base, 'outside'));      // reached by `../outside`
      return { base, root };
    };

    it('`..` — the parent of the projects root, whose admin dir IS readable', async () => {
      const { base, root } = fixture();
      // POSITIVE CONTROL: the same directory, through a legitimate name.
      expect(await readWorktreeRecords(localIO, path.dirname(base), path.basename(base)))
        .toEqual(escapedRecord);
      expect(await readWorktreeRecords(localIO, root, '..')).toEqual(REFUSED);
    });

    it('`../outside` — a sibling of the projects root, whose admin dir IS readable', async () => {
      const { base, root } = fixture();
      expect(await readWorktreeRecords(localIO, base, 'outside')).toEqual(escapedRecord);
      expect(await readWorktreeRecords(localIO, root, '../outside')).toEqual(REFUSED);
    });

    it('`.` — the projects root ITSELF, whose admin dir IS readable', async () => {
      const { base, root } = fixture();
      expect(await readWorktreeRecords(localIO, base, 'projects')).toEqual(escapedRecord);
      expect(await readWorktreeRecords(localIO, root, '.')).toEqual(REFUSED);
    });

    it('the shapes that are not escapes here but are refused anyway, and why', async () => {
      const { root } = fixture();
      // Same anti-vacuity move: each name below is planted where it would LAND,
      // so removing the guard turns this red too rather than leaving it as the
      // decoration the old test was.
      for (const landing of ['etc', 'y', 'a..b']) plantAdmin(path.join(root, landing));
      expect(await readWorktreeRecords(localIO, root, 'etc')).toEqual(escapedRecord);
      // `path.join` normalises both of these back INSIDE the root — an absolute
      // second argument is joined, not honoured, and `x/../y` collapses to `y`.
      // Neither is an escape; both are refused because the single-segment
      // character class has no `/` in it, which is the property that makes the
      // three escapes above impossible to spell in the first place. Pinned so a
      // future "the regex is stricter than it needs to be" edit has to argue
      // with a test.
      expect(await readWorktreeRecords(localIO, root, '/etc')).toEqual(REFUSED);
      expect(await readWorktreeRecords(localIO, root, 'x/../y')).toEqual(REFUSED);
      // `a..b` is a legal directory name, refused by the belt-and-braces
      // `includes('..')` clause. Recorded as deliberate over-refusal, not a bug.
      expect(await readWorktreeRecords(localIO, root, 'a..b')).toEqual(REFUSED);
      // POSITIVE CONTROL for the pair above: `y` is planted and LISTABLE and its
      // name passes the guard, so it answers a measured record. Under the old
      // `null` these three assertions were indistinguishable from each other —
      // guard, empty, and unreadable all read the same. They no longer are.
      expect(await readWorktreeRecords(localIO, root, 'y')).toEqual(escapedRecord);
    });
  });
});
