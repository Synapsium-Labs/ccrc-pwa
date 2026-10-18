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
import {
  DELEGATION_CENSUS_DIAGNOSTICS, readParentGenerations, readWorktreeCensus, readWorktreeRecords, settleParentIncarnations,
} from '../src/coord/gitref.js';
import { childReclaimGenerationRead } from '../src/coord/childReclaim.js';
import { localIO, type FleetIO } from '../src/io.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { ACTOR_CLASSES, corroboration, LC_ACT_UNKNOWN, LIFECYCLE_ACTS } from '../../shared/api.js';
import type { Divergence } from '../../shared/api.js';
import { WebSocket } from 'ws';
import { buildServer, type Deps as ServerDeps } from '../src/server.js';
import { HEADS_BOOT_WAIT_MS } from '../src/watch.js';
import { okRuns } from './coordReadHelpers.js';

/** The repo root, for the one source-text assertion below. */
const ccrcRoot = path.resolve(__dirname, '../..');

afterEach(() => { vi.restoreAllMocks(); });

/** The census derives its legacy answers from the MEASURED reads, so a double that blanks the convenience reads must blank their
 *  measured siblings too. */
const UNREAD = { ok: false, reason: 'unreadable' } as const;
const blindIO = (): FleetIO => ({
  ...localIO, readdir: async () => null, stat: async () => null, readdirMeasured: async () => UNREAD, statMeasured: async () => UNREAD,
});

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
  /** Make every read of git's worktree admin directory NEVER answer — a
   *  dropped agent round trip that neither resolves nor rejects — so the
   *  first HEAD sweep never lands. */
  hangAdminReaddir?: boolean;
}

/** A watcher over a tmp `projectsRoot`, plus the two things this suite plants:
 *  registry rows and git's own linked-worktree admin records. Modelled on
 *  `hold-gate.test.ts`'s `seed` + `new FleetWatcher(testDeps(home, run), new Bus(), 10_000)`.
 *
 *  `CCRC_PROJECTS_ROOT` IS OVERRIDDEN TO A TMP DIRECTORY, and that is not
 *  tidiness: `loadConfig` defaults `projectsRoot` to `$HOME/projects` (spec
 *  §2's three-way reconciliation — server/src/config.ts:151, Stage 2d Task 4;
 *  it was `/data/projects`, the reference fleet's own volume-specific path,
 *  before that), so a fixture that planted
 *  `<projectsRoot>/demo/.git/worktrees/...` under the default would be writing
 *  git admin files into a real `projects` directory under whatever `$HOME`
 *  the fixture (or the box running this suite) happens to have. */
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
  const listing = async (p: string): Promise<string[] | null> => {
      readdirs.push(p);
      if (p.includes(adminOf('')) && hooks.onAdminReaddir !== null) {
        const fire = hooks.onAdminReaddir;
        hooks.onAdminReaddir = null;
        fire();
      }
      if (cfg.hangAdminReaddir === true && p.includes(adminOf(''))) return new Promise<never>(() => {});
      if (cfg.unreadableProject !== undefined && p.includes(adminOf(cfg.unreadableProject))) return null;
      if (cfg.unreadableRegistry === true && p === cfgObj.registryDir) return null;
      return localIO.readdir(p);
  };
  const io: FleetIO = {
    ...localIO,
    readdir: listing,
    // The census reads the admin directory through the MEASURED listing; a failure this fixture injects is `unreadable`, and a
    // real ENOENT stays the `absent` it is.
    readdirMeasured: async (p: string) => {
      const r = await listing(p);
      if (r !== null) return { ok: true, entries: r };
      const real = await localIO.readdirMeasured(p);
      return real.ok ? UNREAD : real;
    },
  };

  const coord = 'coord' in cfg
    ? cfg.coord
    : new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const bus = new Bus();
  const deps = { ...testDeps(home, run), cfg: cfgObj, io, ...(coord === undefined ? {} : { coord }) };
  const watcher = new FleetWatcher(deps as never, bus, 10_000);

  return {
    home, bus, watcher, coord, projectsRoot, hooks, cfgObj, deps: deps as never as ServerDeps,
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
      // GIT'S OWN INVARIANT, ASSERTED ON THE FIXTURE ITSELF: the admin
      // directory's name is the LAST SEGMENT OF THE CHECKOUT PATH — measured
      // 2026-08-17 on `project-d`, where the nested `~/worktrees/project-d/
      // brisk-ridge` is filed under `brisk-ridge` and the flat
      // `~/worktrees/project-d-alertpipe` under `project-d-alertpipe`.
      // A fixture free to disagree is how the id derivation stayed wrong for the
      // flat layout while a test called "finds a FLAT worktree" passed: it named
      // the record `alertpipe`, which git has never written for that path. This
      // planter refuses to write a record git could not have written.
      if (name !== path.basename(at)) {
        throw new Error(`fixture is not git: an admin record named ${name} cannot exist for a worktree at ${at} — git files it under ${path.basename(at)}`);
      }
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

  describe('THE FLAT LAYOUT, end to end — the id the claim rule looks up comes off git\'s gitdir', () => {
    /** `project-d` as the box actually holds it (measured 2026-08-17): one
     *  NESTED workspace ccd made, and one FLAT worktree filed under its whole
     *  directory name. The nested row is also what makes the project active —
     *  the sweep asks git only about projects the registry names. */
    const flatFixture = async (claim: boolean) => {
      const h = await watcherFixture();
      h.plantRecord('project-d-brisk-ridge',
        { project: 'project-d', workspace: 'brisk-ridge', branch: 'ws/brisk-ridge' });
      h.plantWorktreeRecord('project-d', 'brisk-ridge',
        '/data/worktrees/project-d/brisk-ridge', 'ws/brisk-ridge');
      h.plantWorktreeRecord('project-d', 'project-d-alertpipe',
        '/data/worktrees/project-d-alertpipe', 'ws/alertpipe');
      // ONE registry field and no `.uuid` — `_ws_slug_free`'s any-field rule, so
      // `readRegistry` derives no row for it and the LISTING is the only evidence
      // of the claim. Its id is `project-d-alertpipe`: the flat directory IS
      // the id. Composing `${project}-${name}` off git's admin name asks the
      // listing for `project-d-project-d-alertpipe` and never finds it.
      if (claim) {
        writeFileSync(path.join(h.home, '.cc-sessions', 'project-d-alertpipe.workdir'),
          '/data/worktrees/project-d-alertpipe');
      }
      const frames: unknown[][] = [];
      h.bus.on('divergence', (d) => frames.push(d as unknown[]));
      // Twice, past the debounce, so only the claim rule can be doing the work.
      await sweep(h);
      jump(10);
      await sweep(h);
      return frames;
    };

    it('claimed: the census stays empty', async () => {
      // ONE frame, not two: `sweepDivergences` publishes only when the census
      // CHANGES (`json === this.lastDivergenceJson` returns), so a second empty
      // census is silence. Both sweeps ran — the control below shares this
      // fixture and gets its finding on the second one.
      expect(await flatFixture(true)).toEqual([[]]);
    });

    it('unclaimed: it is named, at its real path — the control that proves the fixture reaches the census', async () => {
      const frames = await flatFixture(false);
      expect(frames[1]).toEqual([
        { kind: 'unregistered-worktree', id: null,
          path: '/data/worktrees/project-d-alertpipe', detail: expect.any(String) },
      ]);
    });
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

  it('an UNREADABLE run row skips the census too — the same direction, one door over (D-2545)', async () => {
    // `openRunSessionIds`/`openRunIds` are what make a worktree CLAIMED. A
    // refusal read as an empty run set is the identical fleet-wide false census
    // the unlistable-registry test above argues about, reached through the
    // coordination database instead of the registry — so it takes the same
    // answer: no census this pass, no frame, memory left standing.
    const h = await watcherFixture();
    const opened = h.coord!.openRun({ program: 'p', title: 'P', project: 'demo',
      wave: 1, waveOf: 1, claimedBy: 'demo-coordinator' }) as { id: number };
    h.coord!.setSession(opened.id, 'demo-quiet-basin');
    h.coord!.db.prepare('UPDATE runs SET wave = ? WHERE id = ?')
      .run(BigInt(Number.MAX_SAFE_INTEGER) + 1n, opened.id);
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
    const dropped: FleetIO = blindIO();
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
    const blind: FleetIO = blindIO();
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

// ── Delegation broker wave 3, Task 10: the SAME once-a-minute census, extended additively ────────────────────────────────────────
// `readWorktreeCensus` answers the old `WorktreeRead` UNCHANGED and, from the same admin-directory listing, one
// `DelegationCensusRecord` per admin record, with an unreadable record kept as a row of its own instead of skipped. Three folds are
// wave 1's D-4008 known limits (a failed lock stat reads `locked: false`, an unreadable first log reads `baseAgreesFirstLog: null`, an
// unreadable `gitdir` reads as no canonical path): each carries a diagnostic naming it, and none is positive evidence of anything.
describe('readWorktreeCensus: the delegation records off the one census', () => {
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  const ZERO = '0'.repeat(40);
  const firstLog = (sha: string): string => `${ZERO} ${sha} Someone <someone@example.invalid> 1760000000 +0000\tbranch: Created from HEAD\n`;
  /** One admin record, planted file by file so a row can omit exactly the one it is about. */
  const plant = (
    root: string, name: string,
    files: { gitdir?: string; HEAD?: string; CLAUDE_BASE?: string; log?: string; locked?: boolean },
  ): string => {
    const admin = path.join(root, 'demo', '.git', 'worktrees', name);
    mkdirSync(path.join(admin, 'logs'), { recursive: true });
    if (files.gitdir !== undefined) writeFileSync(path.join(admin, 'gitdir'), files.gitdir);
    if (files.HEAD !== undefined) writeFileSync(path.join(admin, 'HEAD'), files.HEAD);
    if (files.CLAUDE_BASE !== undefined) writeFileSync(path.join(admin, 'CLAUDE_BASE'), files.CLAUDE_BASE);
    if (files.log !== undefined) writeFileSync(path.join(admin, 'logs', 'HEAD'), files.log);
    if (files.locked === true) writeFileSync(path.join(admin, 'locked'), '');
    return admin;
  };
  const good = (extra: Parameters<typeof plant>[2] = {}) => ({
    gitdir: '/data/worktrees/demo/quiet-basin/.git\n', HEAD: 'ref: refs/heads/ws/quiet-basin\n', ...extra,
  });
  /** An io whose reads of one admin file FAIL as unreadable (the path IS there; this process cannot read it): no portable chmod
   *  works as root, so the failure is injected at the seam, as the suite's other unreadable rows do. */
  const failing = (suffixes: { read?: string[]; stat?: string[]; bytes?: string[] }): FleetIO => ({
    ...localIO,
    readFileMeasured: async (p, t, s) => suffixes.read?.some((x) => p.endsWith(x)) === true
      ? { ok: false, reason: 'unreadable' } : localIO.readFileMeasured(p, t, s),
    statMeasured: async (p) => suffixes.stat?.some((x) => p.endsWith(x)) === true
      ? { ok: false, reason: 'unreadable' } : localIO.statMeasured(p),
    readFileFromBytesMeasured: async (p, o, m, t, s) => suffixes.bytes?.some((x) => p.endsWith(x)) === true
      ? { ok: false, reason: 'unreadable' } : localIO.readFileFromBytesMeasured(p, o, m, t, s),
  });
  const only = async (io: FleetIO, root: string) => {
    const c = await readWorktreeCensus(io, root, 'demo');
    if (c.delegation === null) throw new Error('the census did not answer');
    expect(c.delegation).toHaveLength(1);
    return c.delegation[0]!;
  };

  it('an ATTACHED HEAD gives the branch and no sha; the record is present and carries nothing it was not asked for', async () => {
    const root = mkTmp('ccrc-census-');
    plant(root, 'quiet-basin', good());
    expect(await only(localIO, root)).toEqual({
      project: 'demo', adminRecord: 'quiet-basin', canonicalPath: '/data/worktrees/demo/quiet-basin',
      headBranch: 'ws/quiet-basin', headSha: null, claudeBase: null, locked: false, baseAgreesFirstLog: null,
      state: 'present', diagnostic: null,
    });
  });

  it('a DETACHED HEAD gives the sha and no branch', async () => {
    const root = mkTmp('ccrc-census-');
    plant(root, 'quiet-basin', good({ HEAD: `${A}\n` }));
    const r = await only(localIO, root);
    expect(r.headSha).toBe(A);
    expect(r.headBranch).toBeNull();
    expect(r.state).toBe('present');
  });

  it('CLAUDE_BASE and the first logs/HEAD line: agreement, disagreement, and the fallback when CLAUDE_BASE is absent', async () => {
    const root = mkTmp('ccrc-census-');
    plant(root, 'agree', good({ CLAUDE_BASE: `${A}\n`, log: firstLog(A) }));
    plant(root, 'differ', good({ CLAUDE_BASE: `${A}\n`, log: firstLog(B) }));
    plant(root, 'fallback', good({ log: firstLog(B) }));
    plant(root, 'nothing', good());
    const c = await readWorktreeCensus(localIO, root, 'demo');
    const by = new Map((c.delegation ?? []).map((r) => [r.adminRecord, r]));
    expect(by.get('agree')).toMatchObject({ claudeBase: A, baseAgreesFirstLog: true, diagnostic: null });
    expect(by.get('differ')).toMatchObject({ claudeBase: A, baseAgreesFirstLog: false, diagnostic: null });
    // The spec's "CLAUDE_BASE, else the first `logs/HEAD` line": the fallback is a base, but nothing to AGREE with.
    expect(by.get('fallback')).toMatchObject({ claudeBase: B, baseAgreesFirstLog: null, diagnostic: null });
    expect(by.get('nothing')).toMatchObject({ claudeBase: null, baseAgreesFirstLog: null, diagnostic: null });
  });

  it('a CLAUDE_BASE that is not a sha is no base, is named, and does not fall back to the log', async () => {
    const root = mkTmp('ccrc-census-');
    plant(root, 'quiet-basin', good({ CLAUDE_BASE: 'main\n', log: firstLog(B) }));
    expect(await only(localIO, root)).toMatchObject({
      claudeBase: null, baseAgreesFirstLog: null, state: 'present', diagnostic: 'claude-base-malformed',
    });
  });

  it('a CLAUDE_BASE that cannot be READ is no base and never falls back to the log: it may be a base this process cannot see', async () => {
    const root = mkTmp('ccrc-census-');
    plant(root, 'quiet-basin', good({ CLAUDE_BASE: `${A}\n`, log: firstLog(B) }));
    expect(await only(failing({ read: ['quiet-basin/CLAUDE_BASE'] }), root)).toMatchObject({
      claudeBase: null, baseAgreesFirstLog: null, state: 'present', diagnostic: 'claude-base-unreadable',
    });
  });

  it('the lock file reads as locked', async () => {
    const root = mkTmp('ccrc-census-');
    plant(root, 'quiet-basin', good({ locked: true }));
    expect((await only(localIO, root)).locked).toBe(true);
  });

  it('the canonical path is the gitdir\'s parent, EXACT: no resolution, and no relative guess', async () => {
    const root = mkTmp('ccrc-census-');
    plant(root, 'quiet-basin', good({ gitdir: '/data/worktrees/demo/quiet-basin/.git\n\n' }));
    expect((await only(localIO, root)).canonicalPath).toBe('/data/worktrees/demo/quiet-basin');
    const rel = mkTmp('ccrc-census-');
    plant(rel, 'quiet-basin', good({ gitdir: '../../quiet-basin/.git\n' }));
    expect(await only(localIO, rel)).toMatchObject({ canonicalPath: null, state: 'present', diagnostic: 'gitdir-relative' });
  });

  // RULING R46: `git worktree add` creates the admin directory and `locked` ("initializing") BEFORE it writes `gitdir`, and writes
  // HEAD as the null object id first. A listed directory is `absent` only in the removal race, when nothing is left in it.
  it('a record with NOTHING left in it is ABSENT (the removal race); the legacy view still omits it', async () => {
    const root = mkTmp('ccrc-census-');
    plant(root, 'gone', {});
    plant(root, 'other', good({ gitdir: '/data/worktrees/demo/other/.git\n' }));
    const c = await readWorktreeCensus(localIO, root, 'demo');
    expect(c.delegation?.find((x) => x.adminRecord === 'gone')).toMatchObject({
      state: 'absent', canonicalPath: null, diagnostic: 'gitdir-absent,head-absent',
    });
    expect(c.read).toEqual({ ok: true, records: [{ name: 'other', path: '/data/worktrees/demo/other', headBranch: 'ws/quiet-basin' }] });
  });

  it('a record BEING BORN (locked, no gitdir yet, a null-oid HEAD) is unreadable and says so, never absent', async () => {
    const root = mkTmp('ccrc-census-');
    plant(root, 'born', { HEAD: `${'0'.repeat(40)}\n`, locked: true });
    expect(await only(localIO, root)).toMatchObject({
      adminRecord: 'born', state: 'unreadable', canonicalPath: null, headSha: null, headBranch: null, locked: true,
      diagnostic: 'gitdir-absent,head-malformed,record-initializing',
    });
  });

  it('a gitdir ENOENT beside a HEAD that is there is not the removal race either: unreadable, not absent', async () => {
    const root = mkTmp('ccrc-census-');
    plant(root, 'quiet-basin', { HEAD: 'ref: refs/heads/ws/quiet-basin\n' });
    expect(await only(localIO, root)).toMatchObject({ state: 'unreadable', diagnostic: 'gitdir-absent' });
    // …and an unreadable lock stat cannot prove "no lock", so it cannot prove the removal race.
    const root2 = mkTmp('ccrc-census-');
    plant(root2, 'gone', {});
    expect(await only(failing({ stat: ['gone/locked'] }), root2)).toMatchObject({
      state: 'unreadable', diagnostic: 'gitdir-absent,head-absent,lock-unreadable',
    });
  });

  it('a HEAD of forty zeros is head-malformed, never a measured detached sha', async () => {
    const root = mkTmp('ccrc-census-');
    plant(root, 'quiet-basin', good({ HEAD: `${'0'.repeat(40)}\n` }));
    expect(await only(localIO, root)).toMatchObject({
      headSha: null, headBranch: null, state: 'present', diagnostic: 'head-malformed',
    });
  });

  it('a first log that READS but does not parse is first-log-malformed, with no base from it and nothing to agree with', async () => {
    for (const log of ['', 'not a reflog line\n', `${ZERO} ${A.slice(1)} short\n`]) {
      const root = mkTmp('ccrc-census-');
      plant(root, 'quiet-basin', good({ log }));
      expect(await only(localIO, root)).toMatchObject({
        claudeBase: null, baseAgreesFirstLog: null, state: 'present', diagnostic: 'first-log-malformed',
      });
    }
    const root = mkTmp('ccrc-census-');
    plant(root, 'quiet-basin', good({ CLAUDE_BASE: `${A}\n`, log: 'garbage\n' }));
    expect(await only(localIO, root)).toMatchObject({ claudeBase: A, baseAgreesFirstLog: null, diagnostic: 'first-log-malformed' });
  });

  it('every diagnostic the census emits is a member of the one declared tuple, and the tuple names nothing twice', async () => {
    expect(new Set(DELEGATION_CENSUS_DIAGNOSTICS).size).toBe(DELEGATION_CENSUS_DIAGNOSTICS.length);
    const root = mkTmp('ccrc-census-');
    plant(root, 'a-malformed', good({ gitdir: '/\n', CLAUDE_BASE: 'x\n', log: 'x\n', HEAD: 'junk\n' }));
    plant(root, 'b-relative', good({ gitdir: '../x/.git\n' }));
    plant(root, 'c-born', { HEAD: `${'0'.repeat(40)}\n`, locked: true });
    plant(root, 'd-gone', {});
    plant(root, 'e-bad', good({ CLAUDE_BASE: `${A}\n`, log: firstLog(A) }));
    const c = await readWorktreeCensus(failing({
      read: ['e-bad/gitdir', 'e-bad/HEAD', 'e-bad/CLAUDE_BASE'], stat: ['e-bad/locked'], bytes: ['e-bad/logs/HEAD'],
    }), root, 'demo');
    const named = (c.delegation ?? []).flatMap((r) => (r.diagnostic ?? '').split(',')).filter((w) => w !== '');
    expect(new Set(named).size).toBeGreaterThanOrEqual(9);
    for (const w of named) expect(DELEGATION_CENSUS_DIAGNOSTICS, w).toContain(w);
  });

  it('an UNREADABLE record is retained as a row of its own beside a good one, and is NEVER read as absent', async () => {
    const root = mkTmp('ccrc-census-');
    plant(root, 'quiet-basin', good());
    plant(root, 'broken', good({ gitdir: '/data/worktrees/demo/broken/.git\n' }));
    const c = await readWorktreeCensus(failing({ read: ['broken/gitdir'] }), root, 'demo');
    expect(c.delegation?.map((r) => [r.adminRecord, r.state]).sort()).toEqual([['broken', 'unreadable'], ['quiet-basin', 'present']]);
    expect(c.delegation?.find((r) => r.adminRecord === 'broken')).toMatchObject({
      canonicalPath: null, diagnostic: 'gitdir-unreadable',
    });
    // The legacy view is unchanged: the same record it always skipped.
    expect(c.read).toEqual({ ok: true, records: [{ name: 'quiet-basin', path: '/data/worktrees/demo/quiet-basin', headBranch: 'ws/quiet-basin' }] });
  });

  it('an UNREADABLE HEAD keeps the record, names the failure and makes the row unreadable; the legacy view keeps its null branch', async () => {
    const root = mkTmp('ccrc-census-');
    plant(root, 'quiet-basin', good());
    const c = await readWorktreeCensus(failing({ read: ['quiet-basin/HEAD'] }), root, 'demo');
    expect(c.delegation?.[0]).toMatchObject({
      canonicalPath: '/data/worktrees/demo/quiet-basin', headBranch: null, headSha: null, state: 'unreadable', diagnostic: 'head-unreadable',
    });
    expect(c.read).toEqual({ ok: true, records: [{ name: 'quiet-basin', path: '/data/worktrees/demo/quiet-basin', headBranch: null }] });
  });

  it('a name the path guard refuses is an unreadable row, not a silent skip, and is never joined into a path', async () => {
    const root = mkTmp('ccrc-census-');
    plant(root, 'quiet-basin', good());
    const adminRoot = path.join(root, 'demo', '.git', 'worktrees');
    const reads: string[] = [];
    const io: FleetIO = {
      ...localIO,
      readdirMeasured: async () => ({ ok: true, entries: ['quiet-basin', '-flag', 'a b'] }),
      readFileMeasured: async (p, t, s) => { reads.push(p); return localIO.readFileMeasured(p, t, s); },
    };
    const c = await readWorktreeCensus(io, root, 'demo');
    expect(c.delegation?.map((r) => [r.adminRecord, r.state, r.diagnostic])).toEqual([
      ['quiet-basin', 'present', null], ['-flag', 'unreadable', 'name-refused'], ['a b', 'unreadable', 'name-refused'],
    ]);
    expect(reads.filter((p) => p.startsWith(adminRoot) && !p.includes('quiet-basin'))).toEqual([]);
  });

  // THE D-4008 TABLE. Each fold keeps wave 1's value and now carries a diagnostic naming it; none of the three values is evidence.
  describe('D-4008: a failed read folds to a value that is no positive evidence, and says so', () => {
    const healthy = good({ CLAUDE_BASE: `${A}\n`, log: firstLog(A), locked: true });
    const rows: Array<{
      name: string; io: FleetIO; fold: Record<string, unknown>; control: Record<string, unknown>;
    }> = [
      { name: 'a failed lock stat reads locked:false', io: failing({ stat: ['quiet-basin/locked'] }),
        fold: { locked: false, diagnostic: 'lock-unreadable', state: 'present' }, control: { locked: true } },
      { name: 'an unreadable first log reads baseAgreesFirstLog:null', io: failing({ bytes: ['logs/HEAD'] }),
        fold: { baseAgreesFirstLog: null, diagnostic: 'first-log-unreadable', state: 'present' }, control: { baseAgreesFirstLog: true } },
      { name: 'an unreadable gitdir reads as no canonical path', io: failing({ read: ['quiet-basin/gitdir'] }),
        fold: { canonicalPath: null, diagnostic: 'gitdir-unreadable', state: 'unreadable' },
        control: { canonicalPath: '/data/worktrees/demo/quiet-basin' } },
    ];
    it.each(rows)('$name', async ({ io, fold, control }) => {
      const root = mkTmp('ccrc-census-');
      plant(root, 'quiet-basin', healthy);
      // The control proves the fold is a MEASUREMENT of a failure, not a constant.
      expect(await only(localIO, root)).toMatchObject(control);
      const r = await only(io, root);
      expect(r).toMatchObject(fold);
      // …and none of the three is a positive answer: no lock, no agreement, no path, and the row is never `absent`.
      expect(r.state).not.toBe('absent');
      if ('locked' in fold) expect(r.locked).toBe(false);
      if ('baseAgreesFirstLog' in fold) expect(r.baseAgreesFirstLog).not.toBe(true);
      if ('canonicalPath' in fold) expect(r.canonicalPath).toBeNull();
    });
  });

  describe('the answer is the old WorktreeRead, arm for arm', () => {
    it('answers the same read as readWorktreeRecords, and its refusals carry NO delegation records', async () => {
      const root = mkTmp('ccrc-census-');
      plant(root, 'quiet-basin', good());
      const c = await readWorktreeCensus(localIO, root, 'demo');
      expect(c.read).toEqual(await readWorktreeRecords(localIO, root, 'demo'));
      expect(c.delegation).toHaveLength(1);
      const admin = path.join(root, 'demo', '.git', 'worktrees');
      // A measured zero is a census of nothing; every refusal is NOT a census at all (`null`, never `[]`).
      rmSync(admin, { recursive: true });
      expect(await readWorktreeCensus(localIO, root, 'demo')).toEqual({ read: { ok: true, records: [] }, delegation: [] });
      expect(await readWorktreeCensus(localIO, root, '..')).toEqual({ read: { ok: false, reason: 'refused-project' }, delegation: null });
      expect(await readWorktreeCensus(localIO, mkTmp('ccrc-census-'), 'demo'))
        .toEqual({ read: { ok: false, reason: 'not-a-checkout' }, delegation: null });
      const blind: FleetIO = blindIO();
      expect(await readWorktreeCensus(blind, root, 'demo')).toEqual({ read: { ok: false, reason: 'unreachable' }, delegation: null });
      mkdirSync(admin, { recursive: true });
      const unlistable: FleetIO = { ...localIO, readdirMeasured: async () => UNREAD };
      expect(await readWorktreeCensus(unlistable, root, 'demo')).toEqual({ read: { ok: false, reason: 'unlistable' }, delegation: null });
    });

    it('an admin directory whose MEASURED reads are unreadable is no delegation census at all, though the legacy zero stands', async () => {
      // The legacy zero rests on convenience reads that fold a failed read to "nothing there" (it can only hide a record). The
      // delegation zero is a claim that no record is there, and it is minted from MEASURED reads only: an EACCES on the listing, or a
      // dropped round trip, with `.git` answering, is `null`, never `[]`.
      const root = mkTmp('ccrc-census-');
      mkdirSync(path.join(root, 'demo', '.git'), { recursive: true });
      const admin = path.join(root, 'demo', '.git', 'worktrees');
      const io: FleetIO = {
        ...localIO,
        readdirMeasured: async (p, t, s) => (p === admin ? UNREAD : localIO.readdirMeasured(p, t, s)),
        statMeasured: async (p) => (p === admin ? UNREAD : localIO.statMeasured(p)),
      };
      expect(await readWorktreeCensus(io, root, 'demo')).toEqual({ read: { ok: true, records: [] }, delegation: null });
      // The control: the same project, the listing proven ENOENT, is the measured zero.
      expect(await readWorktreeCensus(localIO, root, 'demo')).toEqual({ read: { ok: true, records: [] }, delegation: [] });
    });

    it('readWorktreeRecords takes none of the delegation reads, and the census lists the admin directory ONCE', async () => {
      const root = mkTmp('ccrc-census-');
      plant(root, 'quiet-basin', good({ CLAUDE_BASE: `${A}\n`, log: firstLog(A), locked: true }));
      const seen: string[] = [];
      const spy: FleetIO = {
        ...localIO,
        readdirMeasured: async (p, t, s) => { seen.push(`readdirMeasured ${path.basename(p)}`); return localIO.readdirMeasured(p, t, s); },
        readFileMeasured: async (p, t, s) => { seen.push(`read ${path.basename(p)}`); return localIO.readFileMeasured(p, t, s); },
        statMeasured: async (p) => { seen.push(`stat ${path.basename(p)}`); return localIO.statMeasured(p); },
        readFileFromBytesMeasured: async (p, o, m, t, s) => { seen.push(`bytes ${path.basename(p)}`); return localIO.readFileFromBytesMeasured(p, o, m, t, s); },
      };
      await readWorktreeRecords(spy, root, 'demo');
      expect(seen.sort()).toEqual(['read HEAD', 'read gitdir', 'readdirMeasured worktrees']);
      seen.length = 0;
      await readWorktreeCensus(spy, root, 'demo');
      expect(seen.sort()).toEqual(['bytes HEAD', 'read CLAUDE_BASE', 'read HEAD', 'read gitdir', 'readdirMeasured worktrees', 'stat locked']);
    });
  });
});

// THE PARENT'S INCARNATION (ruling R38): `$REG/<id>.generation`, through the ONE read, read before the pass's use of the id and again
// after it. A value is measured only when both reads are the same value.
describe('parent incarnation off $REG/<id>.generation', () => {
  const G1 = '11111111-1111-4111-8111-111111111111';
  const G2 = '22222222-2222-4222-8222-222222222222';
  const reg = (): string => mkTmp('ccrc-reg-');
  const readerOver = (dir: string, io: Pick<FleetIO, 'readFileMeasured'> = localIO) =>
    (id: string) => childReclaimGenerationRead(io, dir, id);
  const incarnationOf = async (read: ReturnType<typeof readerOver>, id: string, between: () => void = () => {}) => {
    const before = await readParentGenerations(read, [id]);
    between();
    return (await settleParentIncarnations(read, before)).get(id);
  };

  it('a valid generation, unchanged across the pass, is the incarnation', async () => {
    const dir = reg();
    writeFileSync(path.join(dir, 'demo-a.generation'), G1);
    expect(await incarnationOf(readerOver(dir), 'demo-a')).toEqual({ kind: 'measured', incarnation: G1 });
  });

  it('an ABSENT generation is unmeasured, not a default and not a zero', async () => {
    expect(await incarnationOf(readerOver(reg()), 'demo-a')).toEqual({ kind: 'unmeasured', reason: 'absent' });
  });

  it('a MALFORMED generation is unmeasured (the one read cannot tell it from an unreadable one, so they share a reason)', async () => {
    const dir = reg();
    writeFileSync(path.join(dir, 'demo-a.generation'), `${G1}\n`);   // byte-exact: a trailing newline is not a generation
    expect(await incarnationOf(readerOver(dir), 'demo-a')).toEqual({ kind: 'unmeasured', reason: 'unreadable' });
    writeFileSync(path.join(dir, 'demo-a.generation'), 'not-a-uuid');
    expect(await incarnationOf(readerOver(dir), 'demo-a')).toEqual({ kind: 'unmeasured', reason: 'unreadable' });
  });

  it('an UNREADABLE generation is unmeasured', async () => {
    const dir = reg();
    writeFileSync(path.join(dir, 'demo-a.generation'), G1);
    const io = { readFileMeasured: async () => ({ ok: false, reason: 'unreadable' }) as const };
    expect(await incarnationOf(readerOver(dir, io), 'demo-a')).toEqual({ kind: 'unmeasured', reason: 'unreadable' });
  });

  it('a CHANGING generation (another value, or gone, or unreadable on the second read) is unmeasured, whichever way it moved', async () => {
    const dir = reg();
    const file = path.join(dir, 'demo-a.generation');
    writeFileSync(file, G1);
    expect(await incarnationOf(readerOver(dir), 'demo-a', () => writeFileSync(file, G2))).toEqual({ kind: 'unmeasured', reason: 'changing' });
    writeFileSync(file, G1);
    expect(await incarnationOf(readerOver(dir), 'demo-a', () => rmSync(file))).toEqual({ kind: 'unmeasured', reason: 'changing' });
    writeFileSync(file, G1);
    let calls = 0;
    const flaky = { readFileMeasured: async (p: string) => (++calls === 1 ? localIO.readFileMeasured(p) : ({ ok: false, reason: 'unreadable' }) as const) };
    expect(await incarnationOf(readerOver(dir, flaky), 'demo-a')).toEqual({ kind: 'unmeasured', reason: 'unreadable' });
  });

  it('re-reads ONLY the ids that read as a value the first time, and a rejecting reader is unreadable rather than a crash', async () => {
    const dir = reg();
    writeFileSync(path.join(dir, 'demo-a.generation'), G1);
    const paths: string[] = [];
    const io = { readFileMeasured: async (p: string) => { paths.push(path.basename(p)); return localIO.readFileMeasured(p); } };
    const read = readerOver(dir, io);
    const before = await readParentGenerations(read, ['demo-a', 'demo-gone']);
    const out = await settleParentIncarnations(read, before);
    expect(paths.sort()).toEqual(['demo-a.generation', 'demo-a.generation', 'demo-gone.generation']);
    expect(out.get('demo-gone')).toEqual({ kind: 'unmeasured', reason: 'absent' });
    const boom = async (): Promise<never> => { throw new Error('port rejected'); };
    expect((await settleParentIncarnations(boom, await readParentGenerations(boom, ['demo-a']))).get('demo-a'))
      .toEqual({ kind: 'unmeasured', reason: 'unreadable' });
  });
});

describe('sweepDivergences prepares the delegation census from the one read it already takes', () => {
  const G1 = '11111111-1111-4111-8111-111111111111';
  const G2 = '22222222-2222-4222-8222-222222222222';

  it('keeps nothing before the first sweep, then the sweep\'s own census and incarnations', async () => {
    const h = await watcherFixture();
    expect(h.watcher.currentDelegationCensus()).toBeNull();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'quiet-basin', '/data/worktrees/demo/quiet-basin', 'ws/demo-quiet-basin');
    writeFileSync(path.join(h.home, '.cc-sessions', 'demo-quiet-basin.generation'), G1);
    await sweep(h);
    const pass = h.watcher.currentDelegationCensus();
    expect(pass?.projects.get('demo')).toMatchObject({
      read: { ok: true }, delegation: [expect.objectContaining({ adminRecord: 'quiet-basin', state: 'present', headBranch: 'ws/demo-quiet-basin' })],
    });
    expect(pass?.incarnations.get('demo-quiet-basin')).toEqual({ kind: 'measured', incarnation: G1 });
    // THE ONE CENSUS: git's admin directory is listed once for the project, not once for the legacy view and once for this one.
    expect(h.reads().filter((p) => p.endsWith(path.join('.git', 'worktrees')))).toHaveLength(1);
  });

  it('the console\'s HEAD labels never wait on the delegation lane\'s SECOND generation round: labels written and headsSettled resolved while it is held', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'quiet-basin', '/data/worktrees/demo/quiet-basin', 'ws/demo-quiet-basin');
    const file = path.join(h.home, '.cc-sessions', 'demo-quiet-basin.generation');
    writeFileSync(file, G1);
    const io = h.deps.io as FleetIO;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const real = io.readFileMeasured.bind(io);
    let reads = 0;
    io.readFileMeasured = async (p, t, s) => { if (p === file && ++reads === 2) await gate; return real(p, t, s); };
    const done = sweep(h);
    try {
      // The SECOND read is HELD OPEN, and the labels are already there, and so is the promise the boot assembly waits on (N1: a
      // settle placed after the label write but behind the held read would leave it pending).
      await vi.waitFor(() => expect(h.watcher.currentHeadBranches().get('demo-quiet-basin')).toBe('ws/demo-quiet-basin'), { timeout: 3000 });
      const settled = await Promise.race([
        (h.watcher as unknown as { headsSettled: Promise<void> }).headsSettled.then(() => 'settled' as const),
        new Promise<'pending'>((resolve) => { setTimeout(() => resolve('pending'), 500); }),
      ]);
      expect(settled).toBe('settled');
      expect(reads).toBe(2);
      expect(h.watcher.currentDelegationCensus()).toBeNull();
    } finally {
      release();
    }
    await done;
    expect(h.watcher.currentDelegationCensus()?.incarnations.get('demo-quiet-basin')).toEqual({ kind: 'measured', incarnation: G1 });
  });

  it('R47 (R38 exactly): the FIRST generation round completes before the census issues its first read', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'quiet-basin', '/data/worktrees/demo/quiet-basin', 'ws/demo-quiet-basin');
    const file = path.join(h.home, '.cc-sessions', 'demo-quiet-basin.generation');
    writeFileSync(file, G1);
    const io = h.deps.io as FleetIO;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const real = io.readFileMeasured.bind(io);
    let reads = 0;
    let firstDone = false;
    io.readFileMeasured = async (p, t, s) => {
      if (p === file && ++reads === 1) { await gate; const r = await real(p, t, s); firstDone = true; return r; }
      return real(p, t, s);
    };
    const censusRead = () => h.reads().some((p) => p.endsWith(path.join('.git', 'worktrees')));
    const done = sweep(h);
    try {
      await new Promise((resolve) => { setTimeout(resolve, 300); });
      expect(reads, 'the first round was issued').toBe(1);
      expect(censusRead(), 'no census read is issued while the first generation round is pending').toBe(false);
    } finally {
      release();
    }
    await done;
    expect(firstDone).toBe(true);
    expect(censusRead()).toBe(true);
    expect(h.watcher.currentDelegationCensus()?.incarnations.get('demo-quiet-basin')).toEqual({ kind: 'measured', incarnation: G1 });
  });

  it('a generation that changes while the pass runs is unmeasured, and an unlistable project is a project with NO delegation census', async () => {
    const cfg: FixtureCfg = { unreadableProject: 'demo' };
    const h = await watcherFixture(cfg);
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'quiet-basin', '/data/worktrees/demo/quiet-basin', 'ws/demo-quiet-basin');
    const file = path.join(h.home, '.cc-sessions', 'demo-quiet-basin.generation');
    writeFileSync(file, G1);
    const io = h.deps.io as FleetIO;
    let reads = 0;
    const real = io.readFileMeasured.bind(io);
    io.readFileMeasured = async (p, t, s) => {
      if (p === file && ++reads === 2) writeFileSync(file, G2);   // the registry re-mints between the pass's two reads
      return real(p, t, s);
    };
    await sweep(h);
    const pass = h.watcher.currentDelegationCensus();
    expect(pass?.projects.get('demo')).toEqual({ read: { ok: false, reason: 'unlistable' }, delegation: null });
    expect(pass?.incarnations.get('demo-quiet-basin')).toEqual({ kind: 'unmeasured', reason: 'changing' });
  });
});

describe('sweepDivergences feeds the build-9 arms from what it has already read', () => {
  const AN_ACT = LIFECYCLE_ACTS.find((a) => a !== LC_ACT_UNKNOWN)!;
  const SURFACES = ['cli', 'pwa', 'agent', 'ccd', 'unknown', 'none'] as const;
  const DISAGREES = ACTOR_CLASSES.flatMap((c) => SURFACES.map((s) => [c, s] as const))
    .find(([c, s]) => corroboration(c, s) === 'disagrees')!;

  it('takes the provenance pairs from the mirror, bounded to the recent window', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    const now = Date.now();
    h.coord!.ingestJournal({
      gen: '1755780000000000000', cursor: 200, size: 200, at: now,
      rows: [parseJournalLine(JSON.stringify({
        uid: 'a.1', at: now - 1000, act: AN_ACT, outcome: 'done', id: 'demo-quiet-basin',
        obs: { cg: DISAGREES[0] }, dec: { surface: DISAGREES[1] },
      }))],
    });
    const seen: Divergence[][] = [];
    h.bus.on('divergence', (d: Divergence[]) => seen.push(d));
    await sweep(h);
    expect(seen.at(-1)!.map((d) => d.kind)).toContain('provenance-mismatch');
  });

  it('leaves a pair OUTSIDE the window alone — the census is a list of things to look at now', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    const now = Date.now();
    h.coord!.ingestJournal({
      gen: '1755780000000000000', cursor: 200, size: 200, at: now,
      rows: [parseJournalLine(JSON.stringify({
        uid: 'a.1', at: now - 7_200_000, act: AN_ACT, outcome: 'done', id: 'demo-quiet-basin',
        obs: { cg: DISAGREES[0] }, dec: { surface: DISAGREES[1] },
      }))],
    });
    const seen: Divergence[][] = [];
    h.bus.on('divergence', (d: Divergence[]) => seen.push(d));
    await sweep(h);
    expect(seen.at(-1) ?? []).not.toContainEqual(
      expect.objectContaining({ kind: 'provenance-mismatch' }));
  });

  it('reads the heartbeat off the SAME records the tick already measured — no second registry read', () => {
    // The lane takes one registry listing per sweep interval and no more; a
    // `supervisedAt` re-read here would be a whole-fleet field read a minute.
    // The slice ends on the method's OWN two-space closing brace (`:1618`),
    // not on the next member, so it cannot silently widen.
    const src = readFileSync(path.join(ccrcRoot, 'server/src/watch.ts'), 'utf8');
    const from = src.indexOf('  async sweepDivergences(');
    expect(from, 'sweepDivergences was not found — this assertion would pass vacuously')
      .toBeGreaterThan(-1);
    const body = src.slice(from, src.indexOf('\n  }\n', from));
    expect(body.length, 'the slice collapsed — this assertion would pass vacuously')
      .toBeGreaterThan(2000);
    // D-1157 REWROTE THIS ASSERTION. It used to read
    // `expect(body).toContain('supervisedAt: r.supervisedAt')` — a SPELLING
    // guard wearing a mechanism guard's clothes. When the seam was corrected to
    // convert the registry's epoch SECONDS to the milliseconds this census
    // compares against — a change that adds no read of any kind — this went red,
    // so the fix for a real defect looked like a regression in the very test
    // meant to protect the property the fix preserved.
    //
    // It now pins what it always meant: the heartbeat is fed FROM the records
    // this sweep was handed, by whatever transformation, and nothing in the body
    // reads the registry a second time. `field(` joins `readRegistry(` because a
    // per-field re-read — the exact thing the docstring above warns about — goes
    // through it, and pinning only the whole-registry helper left that door open.
    expect(body).toMatch(/supervisedAtMs:[^\n]*\br\.supervisedAt\b/);
    // THE FORBIDDEN READERS ARE DERIVED FROM `registry.ts`'S OWN EXPORTS, never
    // hand-listed (D-1158's sibling lesson, caught in review before merge). The
    // first draft of this rewrite hand-listed `field(` and claimed it closed the
    // per-field-re-read door. It closed nothing: `field` is module-private to
    // `registry.ts` and can never appear in `watch.ts` under any edit — an
    // assertion that cannot fail, advertised as a mechanism. Worse, the two
    // readers `watch.ts` ACTUALLY imports and could re-read with —
    // `readRegistryMeasured(` and `readSessionRecord(` — were named by neither
    // the old guard nor that draft, and `/readRegistry\(/` does not match
    // `readRegistryMeasured(` (the `\(` demands the paren immediately).
    //
    // Deriving the list means a reader added to `registry.ts` tomorrow is
    // forbidden here automatically, and a reader RENAMED cannot silently fall
    // out of the set.
    const registrySrc = readFileSync(path.join(ccrcRoot, 'server/src/registry.ts'), 'utf8');
    const readers = [...registrySrc.matchAll(/^export\s+(?:async\s+)?function\s+(read\w+)/gm)]
      .map((m) => m[1]!);
    expect(readers, 'the reader scan went vacuous — this whole guard would pass on nothing')
      .toEqual(expect.arrayContaining(['readRegistry', 'readRegistryMeasured', 'readSessionRecord']));
    for (const r of readers) {
      expect(body.match(new RegExp(`\\b${r}\\(`, 'g')) ?? [],
        `sweepDivergences must not call ${r}() — it is handed its records`).toHaveLength(0);
    }
    // …and not a raw per-field read either. `io.readdir` stays legitimate: the
    // sweep takes ONE registry listing for `registryNames`. `io.readFile` is the
    // per-row door, and nothing in this method has any business opening it.
    expect(body).not.toMatch(/io\.readFile/);
  });

  it('supplies an EMPTY provenance list when the coordination database refuses, never a stale one', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.coord!.db.exec('DROP TABLE lifecycle_events');
    const seen: Divergence[][] = [];
    h.bus.on('divergence', (d: Divergence[]) => seen.push(d));
    await expect(sweep(h)).resolves.toBeUndefined();
    expect(seen.at(-1) ?? []).not.toContainEqual(
      expect.objectContaining({ kind: 'provenance-mismatch' }));
  });
});

// ── D-1157 — THE UNITS AT THE SEAM, MEASURED THROUGH THE SEAM ─────────────
// `divergence.ts` is pure and correct given milliseconds. `registry.ts` reads
// `.supervised` as epoch SECONDS (`ccd`'s own `date +%s`; the field's own
// docstring says "Epoch SECONDS, registry-native"). `sweepDivergences` handed
// the seconds straight to a census that compares them against `Date.now()`.
//
// No unit test over `divergences()` can catch that: the function is right, and
// `divergence.test.ts` supplies the millisecond fixtures production never
// produces. Only a test that drives the REAL producer with a REAL registry row
// can, which is what this one does.
describe('sweepDivergences: archived-but-live, driven through the registry (D-1157)', () => {
  it('fires for a row whose `.supervised` stamp is registry-native epoch SECONDS', async () => {
    const h = await watcherFixture();
    // A heartbeat written the way the supervisor writes it: `date +%s`.
    const nowSec = Math.floor(Date.now() / 1000);
    h.plantRecord('demo-archived-live', {
      archived: String(nowSec - 3_600),   // stamped archived an hour ago
      supervised: String(nowSec),         // …and a supervisor is beating RIGHT NOW
    });
    const seen: Divergence[][] = [];
    h.bus.on('divergence', (d: Divergence[]) => seen.push(d));
    await sweep(h);
    expect(seen.at(-1) ?? [], 'the supervisor heartbeat IS the evidence — build 9 D9')
      .toContainEqual(expect.objectContaining({
        kind: 'archived-but-live', id: 'demo-archived-live',
      }));
  });

  it('still does NOT fire for a stale heartbeat, in the same registry-native units', async () => {
    // The other half: converting the units must not turn the census into one
    // that flags every archived row it ever sees. An hour-old heartbeat is
    // stale by SUPERVISED_FRESH_MS and must stay silent.
    const h = await watcherFixture();
    const nowSec = Math.floor(Date.now() / 1000);
    h.plantRecord('demo-archived-cold', {
      archived: String(nowSec - 7_200),
      supervised: String(nowSec - 3_600),
    });
    const seen: Divergence[][] = [];
    h.bus.on('divergence', (d: Divergence[]) => seen.push(d));
    await sweep(h);
    expect(seen.at(-1) ?? []).not.toContainEqual(
      expect.objectContaining({ kind: 'archived-but-live' }));
  });
});

// The fleet's branch fallback (fleet.ts: `sl?.branch ?? head ?? r.branch`)
// reads the HEAD this sweep already measures for `branch-drift`. What only
// the watcher can prove: that the sweep KEEPS what it measured, that a failed
// read keeps the last answer for the LABEL without feeding the CENSUS, and
// that `tick()` hands the map to the assembly.
describe('sweepDivergences keeps each worktree\'s measured HEAD for the fleet', () => {
  it('remembers the branch git\'s own HEAD names, keyed by the ccd id its checkout path measures', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'quiet-basin', '/data/worktrees/demo/quiet-basin', 'docs/checked-out-by-hand');
    await sweep(h);
    expect(h.watcher.currentHeadBranches().get('demo-quiet-basin')).toBe('docs/checked-out-by-hand');
  });

  it('keeps a project\'s last HEADs through a failed read — and never lets them reach the census', async () => {
    const cfg: FixtureCfg = {};
    const h = await watcherFixture(cfg);
    // HEAD and registry agree at first, so the first census is clean.
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'quiet-basin', '/data/worktrees/demo/quiet-basin', 'ws/demo-quiet-basin');
    const frames: Divergence[][] = [];
    h.bus.on('divergence', (d) => frames.push(d as Divergence[]));
    await sweep(h);
    expect(frames.flat()).not.toContainEqual(expect.objectContaining({ kind: 'branch-drift' }));
    // The registry then moves, and the project's git read fails. A retained
    // HEAD that reached the census would now DISAGREE with the registry and
    // publish a fresh `branch-drift` — a finding manufactured from an old read.
    h.plantRecord('demo-quiet-basin', { branch: 'ws/renamed' });
    cfg.unreadableProject = 'demo';
    jump(2);
    await sweep(h);
    // The label keeps the last measured answer…
    expect(h.watcher.currentHeadBranches().get('demo-quiet-basin')).toBe('ws/demo-quiet-basin');
    // …and the census, which a failed read may only ever SUPPRESS, does not.
    const afterFailed = frames.length;
    expect(frames.flat()).not.toContainEqual(expect.objectContaining({ kind: 'branch-drift' }));
    // The control: the same disagreement, read FRESH, is published — so the
    // silence above is the census declining an old read, not a census that
    // could not have spoken.
    cfg.unreadableProject = undefined;
    jump(4);
    await sweep(h);
    expect(frames.slice(afterFailed).flat()).toContainEqual(expect.objectContaining({ kind: 'branch-drift' }));
  });

  it('writes the fleet\'s HEADs even when the census then refuses on an unlistable registry', async () => {
    // The HEAD reads are valid whatever the registry listing does; the census
    // returns early on a failed listing, and the label must not stop updating
    // with it.
    const cfg: FixtureCfg = { unreadableRegistry: true };
    const h = await watcherFixture(cfg);
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'quiet-basin', '/data/worktrees/demo/quiet-basin', 'docs/checked-out-by-hand');
    // The records are handed in; only the sweep's own late listing fails.
    const records = await readRegistry(localIO, h.cfgObj);
    await h.watcher.sweepDivergences(records);
    expect(h.watcher.currentHeadBranches().get('demo-quiet-basin')).toBe('docs/checked-out-by-hand');
  });

  it('keeps NOTHING through a standing refusal — a project that is no longer a checkout', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'quiet-basin', '/data/worktrees/demo/quiet-basin', 'docs/checked-out-by-hand');
    await sweep(h);
    expect(h.watcher.currentHeadBranches().get('demo-quiet-basin')).toBe('docs/checked-out-by-hand');
    rmSync(path.join(h.projectsRoot, 'demo', '.git'), { recursive: true, force: true });
    jump(2);
    await sweep(h);
    expect(h.watcher.currentHeadBranches().has('demo-quiet-basin')).toBe(false);
  });

  it('drops a worktree\'s HEAD once its project answers without it', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'quiet-basin', '/data/worktrees/demo/quiet-basin', 'docs/checked-out-by-hand');
    await sweep(h);
    rmSync(path.join(h.projectsRoot, 'demo', '.git', 'worktrees', 'quiet-basin'), { recursive: true, force: true });
    jump(2);
    await sweep(h);
    expect(h.watcher.currentHeadBranches().has('demo-quiet-basin')).toBe(false);
  });

  // THE FIRST FRAME AFTER A RESTART. `tick()` fires the sweep without awaiting
  // it and then assembles at once, so the first assembly always met an EMPTY
  // head map and shipped the registry's name — stale after a manual checkout —
  // until the sweep landed and the next tick ran.
  it('the FIRST tick after boot waits for the first HEAD sweep, so its frame already carries the HEAD', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'quiet-basin', '/data/worktrees/demo/quiet-basin', 'docs/checked-out-by-hand');
    const fleets: { id: string; branch: string | null }[][] = [];
    h.bus.on('fleet', (s) => fleets.push(s as { id: string; branch: string | null }[]));
    const t0 = Date.now();
    await h.watcher.tick(); // no sweep beforehand: this tick fires the first one
    expect(fleets.at(0)?.find((s) => s.id === 'demo-quiet-basin')?.branch).toBe('docs/checked-out-by-hand');
    // …and it was RELEASED by the sweep landing, not by the budget running out:
    // a lost `settleHeads()` still ships the right branch, 2.5 s late. The bound
    // times the whole tick (~100 ms here), so a badly loaded box can red it too.
    expect(Date.now() - t0, 'the first tick took the whole wait budget — settleHeads() never released it, or this box is badly loaded')
      .toBeLessThan(HEADS_BOOT_WAIT_MS);
  });

  it('a first HEAD sweep that never answers holds the first frame no longer than its budget', async () => {
    const h = await watcherFixture({ hangAdminReaddir: true });
    h.plantRecord('demo-quiet-basin');
    const fleets: { id: string; branch: string | null }[][] = [];
    h.bus.on('fleet', (s) => fleets.push(s as { id: string; branch: string | null }[]));
    const t0 = Date.now();
    await h.watcher.tick();
    const took = Date.now() - t0;
    // The frame still ships, on the registry's name — the fallback it has.
    expect(fleets.at(0)?.find((s) => s.id === 'demo-quiet-basin')?.branch).toBe('ws/demo-quiet-basin');
    expect(took).toBeGreaterThanOrEqual(HEADS_BOOT_WAIT_MS - 50);
    expect(took).toBeLessThan(HEADS_BOOT_WAIT_MS + 3000);
    // …and ONLY the first tick waits: a sweep that never lands does not tax
    // every tick after it.
    const t1 = Date.now();
    await h.watcher.tick();
    expect(Date.now() - t1).toBeLessThan(HEADS_BOOT_WAIT_MS);
  }, HEADS_BOOT_WAIT_MS * 3 + 5000);

  // The two server.ts call sites that hand the map to `assembleFleet` outside
  // the tick — the REST fleet and the /ws/fleet cold-start frame. Deleting the
  // argument from either left every suite green (pr-sweep.test.ts records the
  // same shape for currentPrStates); these make each one red.
  it('GET /api/fleet carries the measured HEAD, not the registry\'s branch', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'quiet-basin', '/data/worktrees/demo/quiet-basin', 'docs/checked-out-by-hand');
    await sweep(h);
    const app = await buildServer(h.deps, h.bus, h.watcher);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/fleet' });
      const body = res.json() as { sessions: { id: string; branch: string | null }[] };
      expect(body.sessions.find((s) => s.id === 'demo-quiet-basin')?.branch).toBe('docs/checked-out-by-hand');
    } finally {
      h.watcher.stop();
      await app.close();
    }
  });

  it('a NEW /ws/fleet client\'s cold-start frame carries the measured HEAD', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'quiet-basin', '/data/worktrees/demo/quiet-basin', 'docs/checked-out-by-hand');
    await sweep(h);
    const app = await buildServer(h.deps, h.bus, h.watcher);
    try {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
      type Frame = { type: string; sessions?: { id: string; branch: string | null }[] };
      // Found by TYPE, not index: the coord store adds cold-start frames of its own.
      const fleet = await new Promise<Frame>((resolve, reject) => {
        ws.on('message', (d) => {
          const f = JSON.parse(String(d)) as Frame;
          if (f.type === 'fleet') resolve(f);
        });
        ws.on('error', reject);
      });
      ws.close();
      expect(fleet.sessions?.find((s) => s.id === 'demo-quiet-basin')?.branch).toBe('docs/checked-out-by-hand');
    } finally {
      h.watcher.stop();
      await app.close();
    }
  });

  it('tick() publishes the measured HEAD as the branch of a row whose pane gave none', async () => {
    const h = await watcherFixture();
    h.plantRecord('demo-quiet-basin');
    h.plantWorktreeRecord('demo', 'quiet-basin', '/data/worktrees/demo/quiet-basin', 'docs/checked-out-by-hand');
    await sweep(h);
    const fleets: { id: string; branch: string | null }[][] = [];
    h.bus.on('fleet', (s) => fleets.push(s as { id: string; branch: string | null }[]));
    // The fixture's panes capture empty — no statusline, so no branch from it.
    await h.watcher.tick();
    const row = fleets.at(-1)?.find((s) => s.id === 'demo-quiet-basin');
    expect(row, 'tick() published no fleet row for the planted session').toBeDefined();
    expect(row!.branch).toBe('docs/checked-out-by-hand');
  });
});
