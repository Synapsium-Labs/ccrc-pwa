// Path identity W1a, Task 3 (spec §2.3): a stored run row is re-checked where it enters an id-taking flow.
// `dispatchRun` and `closeRun` refuse a stored `sessionId` that is not a registry id before any read or argv. The
// abandon arm is the operator's door, the archive door's programme end and the dead-coordinator sweep. It closes such
// a run `failed`, with no fleet act and one run event.
//
// Every refused id has its registry row PLANTED, so registry membership cannot be what refuses: only the gate can.
// A 256-character id cannot name a file, so it alone has no row. Runs are stored through `CoordStore` (`storedRun`),
// never through `POST /api/runs`, because the rows these gates exist for predate any ingress check.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { Bus } from '../src/bus.js';
import { configDirFor } from '../src/config.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { abandonRefusal, closeRun, type CloseRunDeps } from '../src/coord/close.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { decideArchive, type ArchiveMeasure } from '../src/coord/archiveDoor.js';
import type { Runner } from '../src/exec.js';
import type { FleetIO } from '../src/io.js';
import { isRegistryId } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';
import { REFUSED_IDS } from './registryIdCases.js';
import { appFor, recorder, seedRow, storedRun } from './idGateFixture.js';

const CLAIMED_BY = 'demo-coordinator';
const TOKEN = 'f'.repeat(64);
const HEADERS = { 'x-ccrc-mail-token': TOKEN };
const BAD = '--actor';
const TIP = 'c'.repeat(40);
/** A done claim whose two facts agree, so `verifyDone`, were it reached, would go on to measure the branch. */
const DONE_CLOSE = { fingerprint: { branchTip: TIP, prNumber: null, prPhase: 'open', handoffCommit: TIP }, final: true };
/** An ordinary close shaped like an abandon (`state:'failed'` skips `verifyDone`); `archive:true` asks for the one
 *  archive the coordination lane composes. */
const ARCHIVE_CLOSE = { fingerprint: { branchTip: TIP, prNumber: null, prPhase: 'open', handoffCommit: TIP },
  final: false, state: 'failed', archive: true };
/** The coordinator's own main checkout, idle: the archive door's measure when it ends a programme. */
const IDLE_MAIN: ArchiveMeasure = { workspace: false, turn: 'idle', worktree: 'present', verbSupported: false };
/** R6's answer, as `closeRun` returns it and as `sendCloseOutcome` sends it. */
const OMITTED = { ok: true, state: 'failed', released: false, childReclaim: 'not-queued',
  childReclaimWhy: 'marker-unreadable' } as const;
const OMITTED_EVENT = 'fleet-act-omitted:bad-session';

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

/** Plants `id`'s registry row. `seedRow` writes one `<id>.<field>` file per field, and a 256-character id cannot name
 *  a file: a name is at most 255 bytes. So that one id is stored with no row. The gate is still the only thing that
 *  can refuse it, because no registry read comes before the gate. */
const plant = (home: string, id: string, fields?: Record<string, string>): void => {
  if (id.length <= 200) seedRow(home, id, fields);
};

/** `closeRun` and `dispatchRun` called directly, over a fixture HOME. The io counts every listing of the registry
 *  directory, which is what "before any read" is measured by. */
const direct = (home: string, run: Runner) => {
  const base = testDeps(home, run);
  mkdirSync(base.cfg.registryDir, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  let listings = 0;
  const io: FleetIO = {
    ...base.io,
    readdir: async (p: string, timeoutMs?: number, signal?: AbortSignal) => {
      if (p === base.cfg.registryDir) listings += 1;
      return base.io.readdir(p, timeoutMs, signal);
    },
  };
  const closeDeps: CloseRunDeps = { coord, io, cfg: base.cfg, runCcd: base.runCcd };
  const dispatchDeps: DispatchRunDeps = {
    coord, io, cfg: base.cfg, runCcd: base.runCcd, tmux: base.tmux, queue: base.queue,
    configDir: (w: string) => configDirFor(base.cfg, w),
  };
  return { base, coord, closeDeps, dispatchDeps, listings: (): number => listings };
};

/** A real loose ref for `ws/<sessionId>` under `<projectsRoot>/demo`. With it, `verifyDone`, were it reached, would
 *  measure the branch and go on to compose `pr-state`: the mutation rows need that call to be reachable. */
const gitRef = (projectsRoot: string, sessionId: string): void => {
  const heads = path.join(projectsRoot, 'demo', '.git', 'refs', 'heads', 'ws');
  mkdirSync(heads, { recursive: true });
  writeFileSync(path.join(heads, sessionId), `${TIP}\n`);
};

/** `recorder` answers every verb with nothing. The child case needs `pr-state` to answer a full line, so this runner
 *  records the same way (`args`, in order) and answers that one verb. */
const answeringPrState = (stdout: string): { run: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    return args[0] === 'pr-state' ? { code: 0, stdout, stderr: '' } : { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
};

const eventsOf = (coord: CoordStore, id: number): [string, string, string, string | null][] =>
  coord.runEvents(id).map((e): [string, string, string, string | null] => [e.causedBy, e.fromState, e.toState, e.detail]);

describe('dispatchRun re-checks a stored session id before any read (spec §2.3)', () => {
  it.each([...REFUSED_IDS])('a planned run whose stored sessionId is %s refuses bad-session and composes nothing', async (sid) => {
    expect(isRegistryId(sid), 'the premise: the id fails the predicate').toBe(false);
    const home = mkTmp('ccrc-stored-id-');
    // `ensure` fails on purpose. Were the gate deleted, the resume would compose `ensure` and stop there, quickly and
    // visibly, instead of running on into the pane.
    const { run, calls } = recorder({ fail: new Set(['ensure']) });
    const d = direct(home, run);
    plant(home, sid);
    const id = storedRun(d.coord, { state: 'planned', sessionId: sid, claimedBy: CLAIMED_BY });
    expect(await dispatchRun(d.dispatchDeps, id, 'go', undefined)).toEqual({ ok: false, kind: 'bad-session' });
    expect(calls).toEqual([]);
    expect(okRun(d.coord.run(id))!.state).toBe('planned');
    expect(d.listings(), 'the pause marker was never listed: the gate stands before every read').toBe(0);
  });

  it('POST /api/runs/:id/dispatch answers 409 bad-session', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder({ fail: new Set(['ensure']) });
    const w = await appFor(home, run, { mailToken: TOKEN }); app = w.app;
    plant(home, BAD);
    const id = storedRun(w.coord, { state: 'planned', sessionId: BAD, claimedBy: CLAIMED_BY });
    const res = await w.app.inject({ method: 'POST', url: `/api/runs/${id}/dispatch`, headers: HEADERS,
      payload: { brief: 'go' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
    expect(calls).toEqual([]);
    expect(okRun(w.coord.run(id))!.state).toBe('planned');
  });

  it('control: a planned run on a--actor resumes', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder({ fail: new Set(['ensure']) });
    const d = direct(home, run);
    plant(home, 'a--actor');
    const id = storedRun(d.coord, { state: 'planned', sessionId: 'a--actor', claimedBy: CLAIMED_BY });
    // An inner `--` is a registry id: the resume composes `ensure a--actor`, and the fixture's failing `ensure`
    // stops it there.
    expect(await dispatchRun(d.dispatchDeps, id, 'go', undefined)).toMatchObject({ ok: false, kind: 'fleetFailed' });
    expect(calls).toEqual([['ensure', 'a--actor']]);
  });
});

describe('closeRun refuses a stored bad id on every arm but abandon (spec §2.3)', () => {
  it('a coordinator close of a dispatched --actor run answers bad-session', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const d = direct(home, run);
    plant(home, BAD, { branch: `ws/${BAD}` });
    gitRef(d.base.cfg.projectsRoot, BAD);
    const id = storedRun(d.coord, { state: 'dispatched', sessionId: BAD, claimedBy: CLAIMED_BY });
    expect(await closeRun(d.closeDeps, id, DONE_CLOSE, 'coordinator')).toEqual({ ok: false, kind: 'bad-session' });
    expect(calls, 'no pr-state, no hold, no release').toEqual([]);
    expect(d.coord.rejections(), 'no rejection is recorded against the id').toEqual([]);
    expect(d.coord.mailForRecipient(BAD), 'no rejection mail is queued to the id').toEqual([]);
    expect(okRun(d.coord.run(id))!.state).toBe('dispatched');
  });

  it('a coordinator close of a --actor child run, its child row and minting row planted, composes no pr-state from child-spent', async () => {
    // Spec §7 item 23. Built so that, were the gate gone, child-spent's own `pr-state` would be reached:
    // - `verifyDone` passes, on a real ref and a full pr-state line;
    // - but the line names ANOTHER session, so the child gate cannot reuse it and fetches afresh;
    // - and a wave-2 run keeps the programme open, so this non-final close is not finished without a spent verdict.
    const foreign = JSON.stringify({ id: 'demo-other', rows: [{ number: 42, state: 'OPEN', headRefName: `ws/${BAD}`,
      baseRefName: 'main', isCrossRepository: false, ours: true, isDraft: false }], baseShort: 'main',
      branch: `ws/${BAD}`, ahead: 1, tip: TIP, checkedAt: 1 });
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = answeringPrState(`${foreign}\n`);
    const d = direct(home, run);
    gitRef(d.base.cfg.projectsRoot, BAD);
    const id = storedRun(d.coord, { state: 'dispatched', sessionId: BAD, claimedBy: CLAIMED_BY });
    // The minting row is this run: its marker names it.
    plant(home, BAD, { branch: `ws/${BAD}`, child: String(id) });
    const program = okRun(d.coord.run(id))!.program;
    const next = d.coord.openRun({ program, title: 'id gate', project: 'demo', wave: 2, waveOf: 2, claimedBy: CLAIMED_BY });
    if (!('id' in next)) throw new Error(`the wave-2 run was refused: ${JSON.stringify(next)}`);
    const out = await closeRun(d.closeDeps, id,
      { fingerprint: { branchTip: TIP, prNumber: null, prPhase: 'open', handoffCommit: TIP }, final: false }, 'coordinator');
    expect(out).toEqual({ ok: false, kind: 'bad-session' });
    expect(calls, 'neither verifyDone nor child-spent composed pr-state').toEqual([]);
    expect(d.coord.rejections()).toEqual([]);
    expect(okRun(d.coord.run(id))!.state).toBe('dispatched');
  });

  it('a failed close with archive:true composes no ws-archive', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const d = direct(home, run);
    plant(home, BAD);
    const id = storedRun(d.coord, { state: 'working', sessionId: BAD, claimedBy: CLAIMED_BY });
    expect(await closeRun(d.closeDeps, id, ARCHIVE_CLOSE, 'coordinator')).toEqual({ ok: false, kind: 'bad-session' });
    expect(calls).toEqual([]);
    expect(okRun(d.coord.run(id))!.state).toBe('working');
  });

  it('a review run whose stored sessionId is --actor answers bad-session with no ws-hold or ws-release', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const d = direct(home, run);
    plant(home, BAD);
    const work = storedRun(d.coord, { state: 'working', sessionId: 'demo-worker', claimedBy: CLAIMED_BY });
    const review = storedRun(d.coord,
      { state: 'working', sessionId: BAD, claimedBy: CLAIMED_BY, kind: 'review', reviews: work });
    // `state:'failed'` (the reviewer died): no claim to re-measure, so only the gate stands before the release.
    expect(await closeRun(d.closeDeps, review, { state: 'failed' }, 'coordinator')).toEqual({ ok: false, kind: 'bad-session' });
    expect(calls).toEqual([]);
    expect(okRun(d.coord.run(review))!.state).toBe('working');
  });

  it('POST /api/runs/:id/close answers 409 bad-session', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const w = await appFor(home, run, { mailToken: TOKEN }); app = w.app;
    plant(home, BAD);
    const id = storedRun(w.coord, { state: 'working', sessionId: BAD, claimedBy: CLAIMED_BY });
    const res = await w.app.inject({ method: 'POST', url: `/api/runs/${id}/close`, headers: HEADERS, payload: DONE_CLOSE });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
    expect(calls).toEqual([]);
    expect(okRun(w.coord.run(id))!.state).toBe('working');
  });
});

describe('the abandon arm closes a bad stored id failed with no fleet act (spec §2.3)', () => {
  it('the operator abandon of a working --actor run', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const w = await appFor(home, run); app = w.app;
    plant(home, BAD);
    const id = storedRun(w.coord, { state: 'working', sessionId: BAD, claimedBy: CLAIMED_BY });
    const res = await w.app.inject({ method: 'POST', url: `/api/runs/${id}/abandon` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...OMITTED, id });
    expect(calls, 'no release and no hold: nothing names the id').toEqual([]);
    expect(okRun(w.coord.run(id))!.state).toBe('failed');
    expect(eventsOf(w.coord, id).filter(([by]) => by === 'operator')).toEqual([
      ['operator', 'working', 'closing', null],
      ['operator', 'closing', 'failed', null],
      ['operator', 'failed', 'failed', OMITTED_EVENT],
    ]);
  });

  it('the dead-coordinator sweep\'s abandon re-measures its claimant, then closes failed with no fleet act', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const d = direct(home, run);
    plant(home, BAD);
    const id = storedRun(d.coord, { state: 'working', sessionId: BAD, claimedBy: CLAIMED_BY });
    let asked = 0;
    const out = await closeRun(d.closeDeps, id, { intent: 'abandon' }, 'sweep',
      { claimedBy: CLAIMED_BY, stillCrashed: async () => { asked += 1; return null; } });
    expect(out).toEqual({ ...OMITTED, id });
    expect(asked, 'the claimant is re-measured once, before the close').toBe(1);
    expect(calls).toEqual([]);
    expect(eventsOf(d.coord, id).filter(([, , , detail]) => detail === OMITTED_EVENT))
      .toEqual([['sweep', 'failed', 'failed', OMITTED_EVENT]]);
  });

  it('a sweep whose claimant revived answers sweep-stopped with no fleet act', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const d = direct(home, run);
    plant(home, BAD);
    const id = storedRun(d.coord, { state: 'working', sessionId: BAD, claimedBy: CLAIMED_BY });
    const stop = { kind: 'remeasured', why: 're-measured alive' } as const;
    const out = await closeRun(d.closeDeps, id, { intent: 'abandon' }, 'sweep',
      { claimedBy: CLAIMED_BY, stillCrashed: async () => stop });
    expect(out).toEqual({ ok: false, kind: 'sweep-stopped', stop, fleetAct: null });
    expect(calls).toEqual([]);
    expect(okRun(d.coord.run(id))!.state).toBe('working');
    expect(eventsOf(d.coord, id).filter(([, , , detail]) => detail === OMITTED_EVENT)).toEqual([]);
  });

  it('the archive door\'s programme end over a --actor run and a valid run ends both', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const d = direct(home, run);
    plant(home, BAD);
    plant(home, 'demo-valid');
    const bad = storedRun(d.coord, { state: 'working', sessionId: BAD, claimedBy: CLAIMED_BY });
    const good = storedRun(d.coord, { state: 'working', sessionId: 'demo-valid', claimedBy: CLAIMED_BY });
    expect(abandonRefusal(d.coord, bad), 'the pre-read refuses nothing new for a bad stored id').toBeNull();
    // The door as `server.ts` wires it: the coordination serialiser's own abandon and pre-read, inside its hold.
    const handle = registerCoordRoutes(Fastify({ logger: false }), { ...d.base, coord: d.coord }, new Bus(), undefined,
      { tmux: d.base.tmux, queue: d.base.queue, readAsk: async () => null });
    const plan = await handle.withAbandon(d.coord, (abandon, refusalOf) => decideArchive({
      openRunsForSession: (sid) => d.coord.openRunsForSession(sid),
      openRunsClaimedBy: (sid) => d.coord.openRunsClaimedBy(sid),
      abandonRefusal: refusalOf,
      abandon,
    }, CLAIMED_BY, { force: false, interrupt: false, programmeEnd: true }, IDLE_MAIN));
    if (!plan.ok) throw new Error(`the door refused: ${JSON.stringify(plan.reply)}`);
    expect(plan.ended.map((r) => r.id), 'no programme-partly-ended: both runs ended').toEqual([bad, good]);
    expect(okRun(d.coord.run(bad))!.state).toBe('failed');
    expect(okRun(d.coord.run(good))!.state).toBe('failed');
    expect(calls, 'only the valid run\'s workspace is released').toEqual([['ws-release', '--session', 'demo-valid']]);
    expect(eventsOf(d.coord, bad).filter(([, , , detail]) => detail === OMITTED_EVENT)).toHaveLength(1);
    expect(eventsOf(d.coord, good).filter(([, , , detail]) => detail === OMITTED_EVENT)).toEqual([]);
  });

  // The two rows that close straight to `failed`, never through `closing`: a `planned` run has no `closing` edge and a
  // review run has none at all, so the store would refuse that hop, and the door would refuse the very run that the
  // dispatch refusal sends to it. Each id is UNLISTED (no registry row is planted): the arm reads no registry, so the
  // row's absence cannot be what decides.
  it('the operator abandon of a planned run that dispatch refused, its --actor unlisted, fails it directly', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const w = await appFor(home, run); app = w.app;
    const id = storedRun(w.coord, { state: 'planned', sessionId: BAD, claimedBy: CLAIMED_BY });
    const refused = await w.app.inject({ method: 'POST', url: `/api/runs/${id}/dispatch`, headers: HEADERS,
      payload: { brief: 'go' } });
    expect(refused.json(), 'the premise: dispatch refused it and left it planned').toEqual({ ok: false, error: 'bad-session' });
    expect(okRun(w.coord.run(id))!.state).toBe('planned');
    const res = await w.app.inject({ method: 'POST', url: `/api/runs/${id}/abandon` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...OMITTED, id });
    expect(calls, 'no fleet act: nothing names the id').toEqual([]);
    expect(okRun(w.coord.run(id))!.state).toBe('failed');
    expect(eventsOf(w.coord, id).filter(([by]) => by === 'operator')).toEqual([
      ['operator', 'planned', 'failed', null],
      ['operator', 'failed', 'failed', OMITTED_EVENT],
    ]);
    expect(eventsOf(w.coord, id).filter(([, , , detail]) => detail === OMITTED_EVENT)).toHaveLength(1);
  });

  it('the operator abandon of a review run, its --actor unlisted, fails it directly', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const w = await appFor(home, run); app = w.app;
    const work = storedRun(w.coord, { state: 'working', sessionId: 'demo-worker', claimedBy: CLAIMED_BY });
    const id = storedRun(w.coord,
      { state: 'working', sessionId: BAD, claimedBy: CLAIMED_BY, kind: 'review', reviews: work });
    const res = await w.app.inject({ method: 'POST', url: `/api/runs/${id}/abandon` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...OMITTED, id });
    expect(calls, 'no fleet act: nothing names the id').toEqual([]);
    expect(okRun(w.coord.run(id))!.state).toBe('failed');
    expect(okRun(w.coord.run(work))!.state, 'the work run it reviews is untouched').toBe('working');
    expect(eventsOf(w.coord, id).filter(([by]) => by === 'operator')).toEqual([
      ['operator', 'working', 'failed', null],
      ['operator', 'failed', 'failed', OMITTED_EVENT],
    ]);
    expect(eventsOf(w.coord, id).filter(([, , , detail]) => detail === OMITTED_EVENT)).toHaveLength(1);
  });

  it('control: a valid id\'s abandon still releases', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const d = direct(home, run);
    plant(home, 'demo-valid');
    const id = storedRun(d.coord, { state: 'working', sessionId: 'demo-valid', claimedBy: CLAIMED_BY });
    expect(await closeRun(d.closeDeps, id, { intent: 'abandon' }, 'operator')).toEqual(
      { ok: true, id, state: 'failed', released: true, childReclaim: 'not-queued', childReclaimWhy: 'not-a-child' });
    expect(calls).toEqual([['ws-release', '--session', 'demo-valid']]);
    expect(eventsOf(d.coord, id).filter(([, , , detail]) => detail === OMITTED_EVENT)).toEqual([]);
  });
});
