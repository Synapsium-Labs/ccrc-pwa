// Path identity W1a, Task 6 (spec §2.3): the seven direct callers of `readRegistryMeasured` PLACE a refused row —
// a `.uuid` whose basename is not a registry id, which that read lists in `refused` and never reads or builds.
// Fingerprint HOLDS it, dispatch REFUSES what subtraction cannot see and measures before it spawns, the watches
// OMIT it, and mail HOLDS a delivery to it. Every refused row here is a plain file under a fixture HOME's registry
// (`path.join(reg, '--actor.uuid')`): no live fleet, no real ccd.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { CcdArgv } from '../src/ccdargv.js';
import { configDirFor, loadConfig } from '../src/config.js';
import { closeRun, type CloseRunDeps } from '../src/coord/close.js';
import { openCoordDb } from '../src/coord/db.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import { verifyDone, type DoneClaim } from '../src/coord/fingerprint.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { loadSnapshot, saveSnapshot, type FleetState } from '../src/fleetstate.js';
import { localIO, type FleetIO } from '../src/io.js';
import type { CcdResult } from '../src/lifecycle.js';
import type { Deps } from '../src/server.js';
import { tasksDir } from '../src/tasks/read.js';
import { FleetWatcher } from '../src/watch.js';
import { MAIL_MAX_ATTEMPTS } from '../../shared/api.js';
import { okRun } from './coordReadHelpers.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';
/** A redirect id (spec §2.1): ccd's loops would read it as a flag. */
const BAD = '--actor';
const COORDINATOR = 'demo-coordinator';
const BRANCH = 'ws/quiet-mesa';
const TIP = 'c'.repeat(40);
const REFUSED_DETAIL = 'the run\'s session id is not a registry id: it is refused, never read';

/** One registry row as plain files, `coord-abandon.test.ts`'s `seed` shape. `over` replaces a field. */
const plant = (home: string, id: string, over: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** `<root>/demo/.git` holding one loose ref, `branch` at `tip`: exactly what `readBranchTip` reads. */
const gitRoot = (branch: string, tip: string): string => {
  const root = mkTmp('ccrc-refused-git-');
  const segs = branch.split('/');
  const leaf = segs.pop()!;
  const dir = path.join(root, PROJECT, '.git', 'refs', 'heads', ...segs);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, leaf), `${tip}\n`);
  return root;
};

/** A runner that records every argv and answers `code`. */
const recording = (calls: string[][], code = 0): Runner => async (_cmd, args) => {
  calls.push([...args]);
  return { code, stdout: '', stderr: '' };
};

const connected: FleetState = { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null };

describe('fingerprint holds a refused session id (spec §2.3)', () => {
  it('verifyDone for a run whose sessionId is --actor answers tip-unmeasurable, never the frozen run.branch', async () => {
    const home = mkTmp('ccrc-refused-fp-');
    plant(home, BAD);                                   // the row is planted: only the check can refuse
    const root = gitRoot(BRANCH, TIP);                  // a valid ref at run.branch, the fallback a refused row would take
    const calls: string[][] = [];
    const base = testDeps(home, recording(calls));
    const deps = { ...base, cfg: { ...base.cfg, projectsRoot: root } };
    const claim: DoneClaim = { branchTip: TIP, prNumber: null, prPhase: 'open', handoffCommit: TIP };

    const res = await verifyDone(deps, { sessionId: BAD, project: PROJECT, branch: BRANCH }, claim);

    expect(res).toEqual({ ok: false, code: 'tip-unmeasurable', detail: REFUSED_DETAIL });
    expect(calls, 'no pr-state is composed for a refused id').toEqual([]);
  });

  it('a review close whose WORK run\'s stored sessionId is --actor answers tip-unmeasurable', async () => {
    const home = mkTmp('ccrc-refused-review-');
    const REVIEWER = 'demo-r1';
    plant(home, BAD);
    plant(home, REVIEWER);
    const root = gitRoot(BRANCH, TIP);
    const report = path.join(root, 'report.md');
    writeFileSync(report, '# findings\n');
    const calls: string[][] = [];
    const base = testDeps(home, recording(calls));
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));

    const work = coord.openRun({ program: 'demo-prog', title: 'work', project: PROJECT, wave: 1, waveOf: 1,
      claimedBy: COORDINATOR });
    if (!('id' in work)) throw new Error(`fixture openRun refused: ${JSON.stringify(work)}`);
    // A legacy row: stored through the store, as a row from before any ingress gate would be.
    coord.markDispatched(work.id, BAD, BAD, BRANCH, false);
    for (const to of ['dispatched', 'working', 'awaiting-review'] as const) {
      expect(coord.advance(work.id, to, 'test').ok).toBe(true);
    }
    const review = coord.openRun({ program: 'demo-prog', title: 'review', project: PROJECT, wave: 1, waveOf: 1,
      claimedBy: COORDINATOR, kind: 'review', reviews: work.id });
    if (!('id' in review)) throw new Error(`fixture openRun (review) refused: ${JSON.stringify(review)}`);
    // The REVIEW run's own session is a valid id, so the close gate (Task 3) passes it: only fingerprint can refuse.
    coord.markDispatched(review.id, REVIEWER, 'r1', 'ws/r1', false);
    for (const to of ['dispatched', 'working'] as const) {
      expect(coord.advance(review.id, to, 'test').ok).toBe(true);
    }
    const deps: CloseRunDeps = { coord, io: base.io, cfg: { ...base.cfg, projectsRoot: root }, runCcd: base.runCcd };

    const out = await closeRun(deps, review.id, { fingerprint: { reviewedTip: TIP, report } }, 'coordinator');

    expect(out).toEqual({ ok: false, kind: 'doneVerdict', code: 'tip-unmeasurable', detail: REFUSED_DETAIL });
    expect(calls, 'no fleet act on a refusal').toEqual([]);
    expect(okRun(coord.run(review.id))!.state).toBe('working');
    expect(coord.rejections().filter((r) => r.runId === review.id).map((r) => r.code)).toEqual(['tip-unmeasurable']);
  });
});

describe('dispatch refuses what subtraction cannot see (spec §2.3)', () => {
  const NEW_ROW = 'demo-quiet-basin';

  /** A fresh-spawn dispatch. `before` rows exist before it; the `ws-add` double plants `after` rows, so the
   *  pre-spawn read cannot see them. `failBeforeListing` fails the SECOND registry listing only: the first is
   *  dispatch's pause-marker read, the second is the pre-spawn registry read. */
  const spawn = (cfg: { before?: readonly string[]; after?: readonly string[]; failBeforeListing?: boolean }) => {
    const home = mkTmp('ccrc-refused-dispatch-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    for (const id of cfg.before ?? []) plant(home, id);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'demo-prog', title: 'Refused rows', project: PROJECT, wave: 1, waveOf: 3,
      claimedBy: COORDINATOR });
    if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
    const calls: string[][] = [];
    const runCcd = async (argv: CcdArgv): Promise<CcdResult> => {
      calls.push([...argv]);
      if (argv[0] === 'ws-add') for (const id of cfg.after ?? []) plant(home, id);
      return { ok: true, stdout: '', stderr: '', killed: false, signal: null };
    };
    const base = testDeps(home);
    let listings = 0;
    const io: FleetIO = {
      ...localIO,
      readdir: async (p, timeoutMs, signal) => {
        if (p === base.cfg.registryDir) {
          listings += 1;
          if (cfg.failBeforeListing === true && listings === 2) return null;
        }
        return localIO.readdir(p, timeoutMs, signal);
      },
    };
    const deps = { ...base, io, coord, runCcd, configDir: (w: string) => configDirFor(base.cfg, w) } as DispatchRunDeps;
    return {
      coord, runId: opened.id, calls,
      listings: (): number => listings,
      dispatch: () => dispatchRun(deps, opened.id, 'go', undefined),
    };
  };

  it('an unlistable registry before the spawn refuses registry-unmeasurable and composes no ws-add', async () => {
    const h = spawn({ failBeforeListing: true, after: [NEW_ROW] });
    expect(await h.dispatch()).toEqual({ ok: false, kind: 'registry-unmeasurable' });
    expect(h.calls, 'nothing is spawned').toEqual([]);
    expect(h.listings(), 'the pause listing, then the failed pre-spawn read; nothing after').toBe(2);
    const row = okRun(h.coord.run(h.runId))!;
    expect(row.state).toBe('planned');
    expect(row.sessionId).toBeNull();
    expect(row.dispatchStartedAt, 'markDispatchStarted never ran').toBeNull();
    expect(h.coord.runEvents(h.runId), 'no route-omitted or child-omitted event').toEqual([]);
  });

  it('a refused name that appeared during the spawn refuses registry-unmeasurable and binds nothing', async () => {
    const h = spawn({ after: [NEW_ROW, BAD] });
    expect(await h.dispatch()).toEqual({ ok: false, kind: 'registry-unmeasurable' });
    expect(h.calls.map((c) => c[0]), 'the spawn ran; no hold followed it').toEqual(['ws-add']);
    const row = okRun(h.coord.run(h.runId))!;
    expect(row.sessionId).toBeNull();
    expect(row.state).toBe('planned');
  });

  it('control: a refused row present before the spawn does not refuse', async () => {
    const h = spawn({ before: [BAD], after: [NEW_ROW] });
    expect(await h.dispatch()).toMatchObject({ ok: true, sessionId: NEW_ROW, adopted: false });
    expect(okRun(h.coord.run(h.runId))!.sessionId).toBe(NEW_ROW);
  });
});

describe('the watches omit a refused id (spec §2.3)', () => {
  it('a prior snapshot holding --actor shrinks to the valid rows, and writes never freeze', async () => {
    const home = mkTmp('ccrc-refused-snap-');
    seedRoster(home);
    plant(home, 'demo-a');
    const cachePath = path.join(home, 'state-cache.json');
    const deps: Deps = {
      ...testDeps(home), cfg: loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' }),
      fleetState: connected, stateCachePath: cachePath,
    };
    const w = new FleetWatcher(deps, new Bus());
    await w.tick();                                                    // the first write: [demo-a]
    const first = await loadSnapshot(cachePath);
    expect(first?.sessions.map((s) => s.id)).toEqual(['demo-a']);
    // The cache an older build left: it assembled --actor, and that row's .uuid is still listed.
    const valid = first!.sessions[0]!;
    await saveSnapshot([{ ...valid, id: BAD }, valid], cachePath);
    plant(home, BAD);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await w.tick();
      expect((await loadSnapshot(cachePath))?.sessions.map((s) => s.id)).toEqual(['demo-a']);
      await w.tick();
      expect((await loadSnapshot(cachePath))?.sessions.map((s) => s.id)).toEqual(['demo-a']);
      expect(warn.mock.calls.filter(([m]) => typeof m === 'string' && m.includes('snapshot write skipped')))
        .toEqual([]);
    } finally {
      warn.mockRestore();
    }
  }, 30_000);

  it('one tick over a planted --actor row with a hook-state and a tasks file gives it no hookStates or taskProgress key, and no read', async () => {
    const home = mkTmp('ccrc-refused-watch-');
    const GOOD = 'demo-a';
    const UUID_GOOD = '1'.repeat(36);
    const UUID_BAD = '2'.repeat(36);
    plant(home, GOOD, { uuid: UUID_GOOD });
    plant(home, BAD, { uuid: UUID_BAD });
    const base = testDeps(home);
    const cfgDir = configDirFor(base.cfg, 'claude')!;
    for (const [id, uuid] of [[GOOD, UUID_GOOD], [BAD, UUID_BAD]] as const) {
      writeFileSync(path.join(base.cfg.registryDir, `${id}.hookstate.json`), JSON.stringify({
        v: 1, state: 'waiting', event: 'Notification', sessionId: uuid, pid: 40613,
        updatedAt: Date.now(), ask: null, subagents: [],
      }));
      const dir = tasksDir(cfgDir, uuid);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, '1.json'), JSON.stringify({
        id: '1', subject: 'one', description: 'do 1', activeForm: 'Doing one', status: 'in_progress',
        blocks: [], blockedBy: [],
      }));
    }
    const touched: string[] = [];
    const io: FleetIO = {
      ...localIO,
      readFileMeasured: async (p, t, s) => { touched.push(p); return localIO.readFileMeasured(p, t, s); },
      readFile: async (p) => { touched.push(p); return localIO.readFile(p); },
      readFileFromMeasured: async (p, o) => { touched.push(p); return localIO.readFileFromMeasured(p, o); },
      readFileFrom: async (p, o) => { touched.push(p); return localIO.readFileFrom(p, o); },
      readdir: async (p, t, s) => { touched.push(p); return localIO.readdir(p, t, s); },
      statMeasured: async (p) => { touched.push(p); return localIO.statMeasured(p); },
      stat: async (p) => { touched.push(p); return localIO.stat(p); },
      lstatMeasured: async (p) => { touched.push(p); return localIO.lstatMeasured(p); },
    };
    const w = new FleetWatcher({ ...base, io, stateCachePath: path.join(home, 'state-cache.json') }, new Bus());

    await w.tick();

    expect(touched.filter((p) => path.basename(p).startsWith(`${BAD}.`) || p.includes(UUID_BAD)),
      'a refused row is never read: no field, no hook state, no task file').toEqual([]);
    expect(w.currentHookStates().has(BAD)).toBe(false);
    expect(w.currentTaskProgress().has(BAD)).toBe(false);
    // CONTROL: the two lanes did run, over the valid row.
    expect(w.currentHookStates().get(GOOD)?.state).toBe('waiting');
    expect(w.currentTaskProgress().get(GOOD)?.total).toBe(1);
  }, 30_000);
});

describe('mail holds a delivery to a refused recipient (spec §2.3)', () => {
  const NOW = 1_800_000_000_000;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  interface DeliveryRow {
    state: string; attempts: number; nextAttemptAt: number; rejectCode: string | null; lastGate: string | null;
  }

  it('past MAIL_MAX_ATTEMPTS the delivery to --actor is still held registry-unmeasurable', async () => {
    const home = mkTmp('ccrc-refused-mail-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });   // empty but listable: the priming tick needs it
    const calls: string[][] = [];
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const deps: Deps = { ...testDeps(home, recording(calls, 1)), coord, stateCachePath: path.join(home, 'state-cache.json') };
    const w = new FleetWatcher(deps, new Bus(), 2000);
    await w.tick();                                                    // primes the watcher
    plant(home, BAD);                                                  // the recipient: listed, refused, never read
    const mail = coord.insertMail({ fromId: 'demo-quiet-mesa', fromUuid: 'b'.repeat(36), toId: BAD, runId: null,
      kind: 'finding', subject: 'hi', body: 'payload', artifacts: [] });
    const { id } = coord.queueDelivery(mail.id, BAD, 'payload');
    const row = (): DeliveryRow => coord.db.prepare(
      'SELECT state, attempts, nextAttemptAt, rejectCode, lastGate FROM mail_deliveries WHERE id = ?',
    ).get(id) as unknown as DeliveryRow;

    await w.sweepMail();
    expect(row().lastGate).toBe('registry-unmeasurable');
    expect(row().attempts).toBe(0);
    // Well past the point that parks a genuinely absent recipient.
    for (let i = 1; i < MAIL_MAX_ATTEMPTS + 4; i++) {
      vi.setSystemTime(row().nextAttemptAt + 1_000);
      await w.sweepMail();
    }
    expect(row()).toMatchObject({ state: 'queued', rejectCode: null, attempts: 0, lastGate: 'registry-unmeasurable' });
    expect(calls.filter((c) => c[0] === 'send-keys'), 'nothing is typed into any pane').toEqual([]);
  }, 30_000);
});
