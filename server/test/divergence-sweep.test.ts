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
  /** Make the REGISTRY directory unlistable, the same way and for the same
   *  reason. Its own failure mode is the opposite of the one above: a registry
   *  that will not list is not "nothing claims anything". */
  unreadableRegistry?: boolean;
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

  /** Every `readdir` this sweep takes, in order — the evidence for the ordering
   *  test below, which is about WHICH READ IS STALER and so can only be checked
   *  by watching the reads themselves. */
  const readdirs: string[] = [];
  /** Fired the moment git's admin directory is read, so a test can land a
   *  registry write in the exact window between the census's two evidence
   *  reads — `_ws_add`'s first `_reg_set` arriving mid-sweep. */
  const hooks: { onAdminReaddir: null | (() => void) } = { onAdminReaddir: null };
  const adminOf = (project: string) => path.join(project, '.git', 'worktrees');
  const io: FleetIO = {
    ...localIO,
    readdir: async (p: string) => {
      readdirs.push(p);
      if (p.includes(adminOf('')) && hooks.onAdminReaddir !== null) {
        const fire = hooks.onAdminReaddir;
        hooks.onAdminReaddir = null;
        fire();
      }
      if (cfg.unreadableProject !== undefined && p.includes(adminOf(cfg.unreadableProject))) return null;
      if (cfg.unreadableRegistry === true && p === cfgObj.registryDir) return null;
      return localIO.readdir(p);
    },
  };

  const coord = 'coord' in cfg
    ? cfg.coord
    : new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const bus = new Bus();
  const deps = { ...testDeps(home, run), cfg: cfgObj, io, ...(coord === undefined ? {} : { coord }) };
  const watcher = new FleetWatcher(deps as never, bus, 10_000);

  return {
    home, bus, watcher, coord, projectsRoot, hooks, cfgObj,
    ccdCalls: () => calls,
    /** The `readdir` paths this sweep took, in order. */
    reads: () => [...readdirs],
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

/** One sweep. `records` is the sweep's only argument: the registry LISTING —
 *  its other piece of evidence — is read by the sweep itself, after git's
 *  worktree records, and handing it in from out here would reintroduce the
 *  staleness the ordering test below exists to pin. */
const sweep = async (h: Awaited<ReturnType<typeof watcherFixture>>): Promise<void> =>
  h.watcher.sweepDivergences(await h.records());

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

  it('the CLAIM evidence is never staler than the WORKTREE evidence — the same race, through ordering', async () => {
    // 502e35a closed the mid-`ws-add` false positive in the PREDICATE and left
    // it open in the READ ORDER. The registry listing was snapshotted at the top
    // of `tick()`; git's admin records were read a lane later, inside this
    // sweep. A `_reg_set` landing between the two is a worktree record with no
    // registry name — the exact state that fix exists to stop reporting —
    // reassembled out of two reads taken at different times, neither of which
    // ever saw it.
    //
    // The debounce does not cover this. It asks for the same observation twice,
    // and this skew reproduces on every sweep for as long as the write keeps
    // landing in the window: a `git worktree add` whose checkout outlives the
    // 60s interval (the case `divergences` names, on a large repo) finishes
    // right here, and BOTH sightings read unclaimed.
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'newborn', '/data/worktrees/demo/newborn', 'ws/newborn');
    const frames: unknown[] = [];
    h.bus.on('divergence', (d) => frames.push(d));
    await sweep(h);
    // Sighting one is honest: nothing on the box claimed it yet.
    expect(frames, 'the first sighting is not a finding').toEqual([[]]);

    // `_reg_set` lands DURING the worktree read — after any listing taken
    // earlier in the tick, before the census is assembled. By the time git's
    // records were gathered, the registry held the claim.
    h.hooks.onAdminReaddir = () => {
      writeFileSync(path.join(h.home, '.cc-sessions', 'demo-newborn.wrapper'), 'claude');
    };
    jump(10);
    await sweep(h);
    expect(frames, 'a workspace whose registry write landed mid-sweep was named a leak')
      .toEqual([[]]);

    // And the mechanism, stated directly rather than inferred from the frame:
    // the listing that decides "claimed" is read no EARLIER than the git
    // records it is weighed against. Reversing the two is what the assertion
    // above catches; this is what it catches it BY.
    const reads = h.reads();
    const lastAdmin = reads.map((p) => p.includes(path.join('.git', 'worktrees'))).lastIndexOf(true);
    const lastReg = reads.lastIndexOf(h.cfgObj.registryDir);
    expect(lastAdmin, 'the sweep never read git\'s admin directory').toBeGreaterThanOrEqual(0);
    expect(lastReg, 'the sweep never read the registry listing itself').toBeGreaterThanOrEqual(0);
    expect(lastReg).toBeGreaterThan(lastAdmin);
  });

  it('a registry that will not LIST skips the census — a failed read is not "nobody claims anything"', async () => {
    // The failure this lane's own evidence has, and the direction matters more
    // here than anywhere else in the sweep: an unlistable `<project>/.git/
    // worktrees` can only ever SUPPRESS a finding, but an unlistable REGISTRY
    // read as an empty listing makes every worktree on the box unclaimed at
    // once — a fleet-wide false census aimed at the repair that deletes
    // worktrees. Fail shut: no census, no frame, and the debounce memory is
    // left standing exactly as `coord.runs()`'s own failure arm leaves it.
    const h = await watcherFixture({ unreadableRegistry: true });
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'quiet-basin', '/data/worktrees/demo/quiet-basin', 'ws/quiet-basin');
    const frames: unknown[] = [];
    h.bus.on('divergence', (d) => frames.push(d));
    await sweep(h);
    jump(10);
    await sweep(h);
    expect(frames).toEqual([]);
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

  it('/ws/fleet SUBSCRIBES to the census and unsubscribes on close — the listener, not the frame', async () => {
    // NAMED FOR WHAT IT MEASURES. This used to be called "the frame reaches
    // /ws/fleet", which is a wire fact, and it is a source-text grep: it proves
    // a listener is registered and symmetrically removed, and could not have
    // told you whether a single byte ever left the socket. The frame ARRIVING
    // is now pinned where a socket actually exists — `fleetws.test.ts`, "the
    // `divergence` frame" — and this keeps the half that is genuinely a
    // source property: `off` matching `on`, so a closed socket does not leak a
    // listener onto the bus for the life of the process.
    //
    // Additive on the shipped `runs`/`coord` terms — NO FLEET_PROTO bump.
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
    // `.git` IS PLANTED, and that is the fixture catching up with reality
    // rather than a concession to the implementation: a project the census asks
    // about is a checkout, and the zero is only a measurement once something on
    // that path has answered. `readdir(.git/worktrees)` -> null and
    // `stat(.git/worktrees)` -> null are both compatible with a dropped agent
    // socket; `stat(.git)` answering is what rules that out.
    mkdirSync(path.join(root, 'demo', '.git'), { recursive: true });
    expect(await readWorktreeRecords(localIO, root, 'demo')).toEqual({ ok: true, records: [] });
  });

  it('BOTH READS FAILING is silence, not zero — the remote link, which answers null for everything', async () => {
    // The shape that made the measured zero a fabrication: in remote mode —
    // `CCRC_FLEET=remote`, the live standing config — `remote/io.ts` catches a
    // dropped socket, a request timeout and an agent-side `checkPath` refusal
    // all to `null`, indistinguishable from a path that is not there. An io
    // double that answers null for EVERYTHING is exactly that box, and the old
    // code turned it into "this project has no linked worktrees" — the
    // strongest positive claim this function can make, minted from two failed
    // reads, for every project on the fleet at once.
    const dropped: FleetIO = { ...localIO, readdir: async () => null, stat: async () => null };
    expect(await readWorktreeRecords(dropped, mkTmp('ccrc-gitref-'), 'demo'))
      .toEqual({ ok: false, reason: 'unreachable' });
  });

  it('a project directory that is not a checkout at all is NOT-A-CHECKOUT — standing, and a different word from silence', async () => {
    // Four non-git project directories exist on the fleet, and this is the arm
    // they take every sweep, forever. It is not the arm a dropped socket takes,
    // and until this split both wore the same word — a STANDING condition and a
    // TRANSIENT one answering the same value at the same seam, which is the
    // overloaded-null defect the whole `WorktreeRead` union exists to undo.
    //
    // The evidence is the same positive-answer technique the measured zero
    // already runs on, one level up: `<projectsRoot>/<project>` ANSWERED, so the
    // link was up, and `<project>/.git` still did not — that is a measurement,
    // not a failure to measure.
    const root = mkTmp('ccrc-gitref-');
    mkdirSync(path.join(root, 'demo'), { recursive: true });
    expect(await readWorktreeRecords(localIO, root, 'demo'))
      .toEqual({ ok: false, reason: 'not-a-checkout' });
  });

  it('a project the registry names that has NO directory at all is not-a-checkout too — projectsRoot answered', async () => {
    // The third rung, and the reason `unreachable` is now ONE fact rather than
    // two. Without it, "the registry names a project whose directory is gone"
    // (standing — it will read the same way every sweep until a human fixes the
    // registry) would land back on `unreachable` beside the dropped socket, and
    // the split would have moved the overload rather than removed it.
    const root = mkTmp('ccrc-gitref-');
    expect(await readWorktreeRecords(localIO, root, 'demo'))
      .toEqual({ ok: false, reason: 'not-a-checkout' });
  });

  it('`unreachable` now means exactly one thing: NOTHING on the path answered', async () => {
    // The complement of the two tests above, and the assertion that keeps the
    // split honest. `projectsRoot` itself is unstatable here, so there is no
    // positive answer anywhere on the chain and no standing condition can be
    // claimed — the honest word is silence. A future edit that makes the last
    // rung answer `not-a-checkout` on a failed `projectsRoot` stat turns this
    // red, which is the only thing stopping the standing word from creeping
    // back over the transient one.
    const root = mkTmp('ccrc-gitref-');
    mkdirSync(path.join(root, 'demo'), { recursive: true });
    const blind: FleetIO = { ...localIO, readdir: async () => null, stat: async () => null };
    expect(await readWorktreeRecords(blind, root, 'demo'))
      .toEqual({ ok: false, reason: 'unreachable' });
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
