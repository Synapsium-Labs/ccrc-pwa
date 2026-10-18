// D-5238 (plan docs/superpowers/plans/2026-10-16-working-state-and-interruptions.md, Task 9; spec §5.7): the
// dispatch resume arm types `/clear` only when the fail-closed turn verdict archive already uses (`turnVerdictFor`,
// `src/turnverdict.ts`, over `stopVerdict`) reads `idle` — at the gate and again immediately before the act. A pane the
// dispatch's own `ensure` started is waited for by the ROUTE, outside `coordMutex`, and only a measured verdict re-runs
// the whole decision, once.
//
// The harness follows `archive-door.test.ts` (a pane whose pid and live file the fixture writes, the watcher's pending
// dialogs) and `run-routes.test.ts` (the token, the `/clear` capture script): one runner answers tmux and ccd, so the
// ORDER of every act is one `calls` log. The hookstate and turn-marker files copy the shapes those suites already
// write (`archive-door.test.ts`'s hookstate, `mail-sweep.test.ts`'s fifteen-key marker); no hook payload is built here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import type { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import { DISPATCH_SPAWN_POLL_MS, DISPATCH_SPAWN_WAIT_MS } from '../src/coord/routes.js';
import { COORDINATOR_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { configDirFor } from '../src/config.js';
import type { Runner } from '../src/exec.js';
import type { CcdResult } from '../src/lifecycle.js';
import { SERVER_CAPS, SERVER_CAPS_FILE, renderServerCaps } from '../../shared/api.js';
import { execFileSync } from 'node:child_process';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');

const PROJECT = 'project-a';
const ID = 'project-a-quiet-basin';
const UUID = `u-${ID}`;
const WRAPPER = 'claude-a';
const PANE = 4242;
const TOKEN = 'f'.repeat(64);
const CLEAR_PANES = ['scrollback\n❯ \n', 'scrollback\n❯ /clear\n', 'scrollback\n❯ \n'];

interface BoxCfg {
  /** `ensure`'s stdout, call by call; past the end (and by default) it answers `alive: <id>` — an already-live pane. */
  ensure?: string[];
  /** Called with every call's argv BEFORE it is answered. */
  onCall?: (args: string[], n: Record<string, number>) => void;
  /** The watcher's newest pane dialogs. */
  pending?: string[];
  /** Real wall time added before EVERY call of the box's `io` (the turn verdict's and the live file's reads among
   *  them): a loaded box, where the route's own I/O is still running when a fixed number of event-loop turns ends. */
  slowIoMs?: number;
  /** Real wall time an `onRequest` hook spends before the route runs (D-5378): event-loop turns in which the
   *  dispatch has begun but has nothing of the box in flight yet. */
  requestDelayMs?: number;
}

let open: FastifyInstance[] = [];
afterEach(async () => {
  vi.useRealTimers();
  parkProbe = null;
  for (const a of open) await a.close();
  open = [];
});

const seed = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: WRAPPER, project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** Claude Code's live file for the pane — the raw word the gate reads. */
const live = (home: string, status: string): void => {
  const dir = path.join(home, `.${WRAPPER}`, 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${PANE}.json`),
    JSON.stringify({ pid: PANE, sessionId: UUID, status, statusUpdatedAt: Date.now() - 60_000 }));
};
const dropLive = (home: string): void => rmSync(path.join(home, `.${WRAPPER}`, 'sessions', `${PANE}.json`), { force: true });
/** A live file this box cannot read (a directory where the file should be: `readFileMeasured` answers unreadable). */
const unreadableLive = (home: string): void => {
  dropLive(home);
  mkdirSync(path.join(home, `.${WRAPPER}`, 'sessions', `${PANE}.json`), { recursive: true });
};

/** The hook's `done` from a Stop — `archive-door.test.ts`'s hookstate shape. */
const hookDone = (home: string): void => {
  writeFileSync(path.join(home, '.cc-sessions', `${ID}.hookstate.json`), JSON.stringify({
    v: 1, state: 'done', sessionId: UUID, updatedAt: Date.now() - 30_000, event: 'Stop' }));
};

const box = async (cfg: BoxCfg = {}) => {
  const home = mkTmp('ccrc-dispatch-live-');
  seed(home, ID);
  const calls: string[][] = [];
  const n: Record<string, number> = {};
  let capIdx = 0;
  const probe: ParkProbe = { started: false, inflight: 0 };
  parkProbe = probe;
  const tracked = async <T>(work: () => Promise<T>): Promise<T> => {
    probe.started = true;
    probe.inflight++;
    try { return await work(); } finally { probe.inflight--; }
  };
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const verb = args[0] ?? '';
    n[verb] = (n[verb] ?? 0) + 1;
    cfg.onCall?.(args, n);
    if (verb === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (verb === 'list-panes') return { code: 0, stdout: `${PANE}\n`, stderr: '' };
    if (verb === 'ensure') {
      const said = cfg.ensure?.[n[verb]! - 1];
      return { code: 0, stdout: said ?? `alive: ${args[1] ?? ''}\n`, stderr: '' };
    }
    if (verb === 'capture-pane') {
      const p = CLEAR_PANES[Math.min(capIdx, CLEAR_PANES.length - 1)]!;
      capIdx++;
      return { code: 0, stdout: p, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base0 = testDeps(home, run);
  const slow = cfg.slowIoMs;
  const base = {
    ...base0,
    io: Object.fromEntries(Object.entries(base0.io).map(([k, f]) => [k, (...a: unknown[]) => tracked(async () => {
      if (slow !== undefined) await realDelay(slow);
      return (f as (...x: unknown[]) => unknown).apply(base0.io, a);
    })])) as unknown as typeof base0.io,
  };
  const watcher = { currentPending: () => new Set(cfg.pending ?? []), currentStatuslines: () => new Map(),
    stop: () => {} } as unknown as FleetWatcher;
  const app = await buildServer({ ...base, mailToken: TOKEN, coord }, new Bus(), watcher);
  open.push(app);
  const requestDelay = cfg.requestDelayMs;
  if (requestDelay !== undefined) app.addHook('onRequest', async () => { await realDelay(requestDelay); });
  const opened = coord.openRun({ program: 'p', title: 't', project: PROJECT, wave: 2, waveOf: 3, claimedBy: 'c' });
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
  coord.setSession(opened.id, ID);
  return {
    home, calls, n, app, coord, runId: opened.id,
    dispatch: (id: number = opened.id) => app.inject({ method: 'POST', url: `/api/runs/${id}/dispatch`,
      headers: { 'x-ccrc-mail-token': TOKEN }, payload: { brief: 'go' } }),
    acts: () => calls.filter((c) => c[0] === 'ws-hold' || c[0] === 'send-keys' || c[0] === 'route'),
    cleared: () => calls.some((c) => c[0] === 'send-keys' && c.includes('/clear')),
    state: () => { const r = coord.run(opened.id); return r.ok && r.run !== null ? r.run.state : null; },
  };
};

// The fake clock moves ONLY while the code under test is parked on a fake timer (D-5145). Only `setTimeout` is
// faked, so `setImmediate` still turns the real event loop, poll phase included, and `Date` still reads real time.
// Before every fake step the loop turns until the route is parked on its own poll (`untilParked`: a timer pending and
// nothing of the box in flight) or the awaited request has settled. A fixed number of turns let fake time run ahead of
// the route's real I/O on a loaded box: the route's read was still in flight, so the test stepped on, and the
// interleaving with its writes moved. A pending timer alone is no better a sign: any fake timer the route did not arm
// reads as parked, and a case's write lands inside the first decision (the pause case pins this with one).

/** Real wall time any one wait on the code under test may take before the case fails. Below `vitest.config.ts`'s Linux
 *  `testTimeout` (20 000 ms), so the named error below surfaces before vitest's own `Test timed out`. */
const REAL_BOUND_MS = 10_000;
const turn = (): Promise<void> => new Promise<void>((r) => { setImmediate(r); });
/** Wait `ms` of REAL time, through event-loop turns (the faked `setTimeout` cannot). */
const realDelay = async (ms: number): Promise<void> => {
  const until = Date.now() + ms;
  while (Date.now() < until) await turn();
};
/** Turn the real event loop until `ok()` holds, failing past `REAL_BOUND_MS` of real time. */
const untilReal = async (ok: () => boolean, what: string): Promise<void> => {
  const deadline = Date.now() + REAL_BOUND_MS;
  await turn();
  while (!ok()) {
    if (Date.now() > deadline) throw new Error(`${what} within ${REAL_BOUND_MS} ms of real time`);
    await turn();
  }
};
/** What the newest `box` has seen of its own io reads (D-5378): whether one has begun, and how many are in flight. */
interface ParkProbe { started: boolean; inflight: number }
let parkProbe: ParkProbe | null = null;
/** Turn the real event loop until the code under test is parked on ITS OWN fake timer, or `isDone()` (D-5378).
 *  A pending fake timer alone is not that: one the route did not arm (for example a case's own) is pending while the
 *  route is still deciding. Parked is a pending timer, once the box has begun a read, with none of the box's io reads
 *  in flight. Every real wait the route makes on its way to its wait is one of those reads (the box's runner answers
 *  within microtasks), so between its first read and its wait no event-loop turn ends with nothing in flight. */
const untilParked = (isDone: () => boolean = () => false): Promise<void> =>
  untilReal(() => isDone() || (vi.getTimerCount() > 0
    && (parkProbe === null || (parkProbe.started && parkProbe.inflight === 0))),
  'the code under test neither parked on a timer nor settled');
/** Advance fake time by `ms`, in 100 ms steps, each taken only once the code under test is parked; and park again. */
const advance = async (ms: number): Promise<void> => {
  for (let t = 0; t < ms; t += 100) {
    await untilParked();
    await vi.advanceTimersByTimeAsync(Math.min(100, ms - t));
  }
  await untilParked();
};
/** Advance fake time in small steps until `p` settles; answers the value and how much fake time it took — only the
 *  fake milliseconds really advanced, each step taken only once the code under test is parked on a fake timer. */
const settle = async <T>(p: Promise<T>, capMs = 60_000): Promise<{ value: T; elapsed: number }> => {
  let done = false; let value!: T;
  void p.then((v) => { done = true; value = v; });
  let elapsed = 0;
  await untilParked(() => done);
  while (!done && elapsed <= capMs) {
    await vi.advanceTimersByTimeAsync(100);
    elapsed += 100;
    await untilParked(() => done);
  }
  if (!done) throw new Error(`did not settle within ${capMs} ms of fake time`);
  return { value, elapsed };
};

describe('the dispatch /clear gate needs the live file measured idle (D-5238)', () => {
  it('hook `done`, live `busy` (delegated work after a Stop) → worker-busy: no hold, no /clear', async () => {
    const b = await box();
    hookDone(b.home);
    live(b.home, 'busy');
    const res = await b.dispatch();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'worker-busy' });
    expect(b.acts()).toEqual([]);
    expect(b.state()).toBe('planned');
  });

  it('live `shell` and live `waiting` are both worker-busy', async () => {
    for (const word of ['shell', 'waiting']) {
      const b = await box();
      hookDone(b.home);
      live(b.home, word);
      const res = await b.dispatch();
      expect(res.json(), word).toEqual({ ok: false, refused: 'worker-busy' });
      expect(b.cleared(), word).toBe(false);
    }
  });

  it('a pane dialog the watcher holds is worker-busy though the live file reads idle (the frame\'s row)', async () => {
    const b = await box({ pending: [ID] });
    hookDone(b.home);
    live(b.home, 'idle');
    expect((await b.dispatch()).json()).toEqual({ ok: false, refused: 'worker-busy' });
    expect(b.cleared()).toBe(false);
  });

  it('a live file this box cannot read → status-unmeasurable, nothing held or typed', async () => {
    const b = await box();
    hookDone(b.home);
    unreadableLive(b.home);
    const res = await b.dispatch();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'status-unmeasurable' });
    expect(b.acts()).toEqual([]);
  });

  it('an ALIVE pane with no live file is status-unmeasurable at once — never waited for', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const b = await box();
    hookDone(b.home);
    const { value: res, elapsed } = await settle(b.dispatch());
    expect(res.json()).toEqual({ ok: false, refused: 'status-unmeasurable' });
    expect(elapsed).toBeLessThan(DISPATCH_SPAWN_POLL_MS);
    expect(b.n['ensure']).toBe(1);
  });

  it('the teammate caveat: bg 21 teammates listed at the Stop, live `idle`, hook `done` → proceeds', async () => {
    const b = await box();
    hookDone(b.home);
    live(b.home, 'idle');
    const at = Date.now() - 30_000;
    writeFileSync(path.join(b.home, '.cc-sessions', `${ID}.turn.json`), JSON.stringify({
      v: 1, sessionId: UUID, state: 'done', event: 'Stop', at, turnAt: at - 600_000, stopAt: at,
      bg: 21, bgKinds: 'teammate', bgIds: 'w00000001', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '',
    }));
    const res = await b.dispatch();
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, resumed: true, briefQueued: true });
    expect(b.cleared()).toBe(true);
  });

  it('the live file turns `busy` between the gate and the /clear → refused at the act, no /clear typed', async () => {
    const b = await box({ onCall: (args) => { if (args[0] === 'ws-hold') live(b.home, 'busy'); } });
    hookDone(b.home);
    live(b.home, 'idle');
    const res = await b.dispatch();
    expect(res.json()).toEqual({ ok: false, refused: 'worker-busy' });
    expect(b.calls.some((c) => c[0] === 'ws-hold')).toBe(true);
    expect(b.cleared()).toBe(false);
    expect(b.state()).toBe('planned');
  });

  it('the live file turns unreadable between the gate and the /clear → status-unmeasurable at the act, no /clear typed', async () => {
    const b = await box({ onCall: (args) => { if (args[0] === 'ws-hold') unreadableLive(b.home); } });
    hookDone(b.home);
    live(b.home, 'idle');
    const res = await b.dispatch();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'status-unmeasurable' });
    expect(b.calls.some((c) => c[0] === 'ws-hold')).toBe(true);
    expect(b.cleared()).toBe(false);
    expect(b.state()).toBe('planned');
  });
});

describe('a pane this dispatch started is waited for outside coordMutex (D-5238)', () => {
  it('absent for two polls, then idle → ONE dispatch: ensure twice (the second alive:), the brief queued once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const b = await box({ ensure: [`ensured ${ID}\n`] });
    hookDone(b.home);
    const p = b.dispatch();
    await advance(2 * DISPATCH_SPAWN_POLL_MS + 500);
    expect(b.n['ensure']).toBe(1);
    live(b.home, 'idle');
    const { value: res } = await settle(p);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, resumed: true, briefQueued: true });
    expect(b.n['ensure']).toBe(2);
    expect(b.calls.filter((c) => c[0] === 'ws-hold')).toHaveLength(1);
    expect(b.calls.filter((c) => c[0] === 'send-keys' && c.includes('/clear'))).toHaveLength(1);
    expect(b.state()).toBe('dispatched');
  });

  it('absent past the bound → 409 worker-starting: ensure once, no re-run, nothing held, no transition, no /clear', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const b = await box({ ensure: [`ensured ${ID}\n`] });
    hookDone(b.home);
    const { value: res, elapsed } = await settle(b.dispatch());
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'worker-starting' });
    expect((res.json() as { detail: string }).detail).toMatch(/nothing was held, cleared or sent/);
    expect(elapsed).toBeGreaterThanOrEqual(DISPATCH_SPAWN_WAIT_MS);
    expect(elapsed).toBeLessThan(DISPATCH_SPAWN_WAIT_MS + DISPATCH_SPAWN_POLL_MS);
    expect(b.n['ensure']).toBe(1);
    expect(b.acts()).toEqual([]);
    expect(b.state()).toBe('planned');
  });

  it('absent past the bound with every io read 40 ms slow in REAL time → the same 409, ensure count and elapsed bounds (D-5145)', async () => {
    // The harness waits for the route's own timer: fake time never runs ahead of a read the route has not finished.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const b = await box({ ensure: [`ensured ${ID}\n`], slowIoMs: 40 });
    hookDone(b.home);
    const { value: res, elapsed } = await settle(b.dispatch());
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'worker-starting' });
    expect(elapsed).toBeGreaterThanOrEqual(DISPATCH_SPAWN_WAIT_MS);
    expect(elapsed).toBeLessThan(DISPATCH_SPAWN_WAIT_MS + DISPATCH_SPAWN_POLL_MS);
    expect(b.n['ensure']).toBe(1);
    expect(b.acts()).toEqual([]);
    expect(b.state()).toBe('planned');
  }, 60_000);

  it('an ensure that starts the pane AGAIN on the re-run → 409 worker-starting, with no second wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const b = await box({
      ensure: [`ensured ${ID}\n`, `ensured ${ID}\n`],
      // The pane died and was started again: its live file is gone the moment the second ensure runs.
      onCall: (args, n) => { if (args[0] === 'ensure' && n['ensure'] === 2) dropLive(b.home); },
    });
    hookDone(b.home);
    const p = b.dispatch();
    await advance(DISPATCH_SPAWN_POLL_MS / 2);
    live(b.home, 'idle');
    const { value: res, elapsed } = await settle(p);
    expect(res.json()).toMatchObject({ ok: false, refused: 'worker-starting' });
    expect(b.n['ensure']).toBe(2);
    // One poll's worth of fake time, not a second bound on top of it.
    expect(elapsed + DISPATCH_SPAWN_POLL_MS / 2).toBeLessThan(2 * DISPATCH_SPAWN_POLL_MS);
    expect(b.acts()).toEqual([]);
  });

  it('the wait holds no lock: a close of another run answers while the dispatch still waits', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const b = await box({ ensure: [`ensured ${ID}\n`] });
    hookDone(b.home);
    const other = b.coord.openRun({ program: 'p', title: 'u', project: PROJECT, wave: 1, waveOf: 3, claimedBy: 'c' });
    if (!('id' in other)) throw new Error('fixture openRun refused');
    let dispatched = false;
    const p = b.dispatch().then((r) => { dispatched = true; return r; });
    await advance(DISPATCH_SPAWN_POLL_MS + 500);
    const close = b.app.inject({ method: 'POST', url: `/api/runs/${other.id}/close`,
      headers: { 'x-ccrc-mail-token': TOKEN }, payload: { intent: 'abandon' } });
    let closed = false;
    void close.then(() => { closed = true; });
    await untilReal(() => closed, 'the close did not answer').catch(() => undefined);
    expect(closed, 'the close waited behind the dispatch\'s wait').toBe(true);
    expect(dispatched).toBe(false);
    expect((await close).statusCode).toBe(200);
    await settle(p);
  });

  it('the re-run re-decides: a pause raised during the wait refuses `paused`, and the first ensure is the only act', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const b = await box({ ensure: [`ensured ${ID}\n`], requestDelayMs: 50 });
    hookDone(b.home);
    // A fake timer that is not the route's, pending the whole case (D-5378): the pause must still land during the
    // WAIT. Were "parked" any pending timer, the harness would step on while the first decision is still reading, the pause and
    // the `idle` would land between its pause check and its verdict, and that first decision would clear (`ok: true`).
    setTimeout(() => {}, 10 * DISPATCH_SPAWN_WAIT_MS);
    // And real turns before the route's first read (`requestDelayMs`): a harness that took "nothing in flight" as
    // parked before any read had begun would step through them, and the pause would land before the first decision.
    const p = b.dispatch();
    await advance(DISPATCH_SPAWN_POLL_MS / 2);
    writeFileSync(path.join(b.home, '.cc-sessions', COORDINATOR_PAUSE_MARKER), '');
    live(b.home, 'idle');
    const { value: res } = await settle(p);
    expect(res.json()).toMatchObject({ ok: false, refused: 'paused' });
    expect(b.n['ensure']).toBe(1);
    expect(b.acts()).toEqual([]);
    expect(b.state()).toBe('planned');
  });
});

describe('dispatchRun alone never waits (D-5238)', () => {
  it('after a spawning ensure, an unmeasured verdict answers worker-starting at once, with no timer started', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const home = mkTmp('ccrc-dispatch-live-alone-');
    seed(home, ID);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'p', title: 't', project: PROJECT, wave: 2, waveOf: 3, claimedBy: 'c' });
    if (!('id' in opened)) throw new Error('fixture openRun refused');
    coord.setSession(opened.id, ID);
    const base = testDeps(home, async () => ({ code: 0, stdout: '', stderr: '' }));
    const ccd: string[][] = [];
    let asked = 0;
    const deps: DispatchRunDeps = {
      ...base, coord,
      runCcd: async (argv): Promise<CcdResult> => {
        ccd.push([...argv]);
        return { ok: true, stdout: argv[0] === 'ensure' ? `ensured ${ID}\n` : '', stderr: '', killed: false, signal: null };
      },
      configDir: (w: string) => configDirFor(base.cfg, w),
      turnVerdict: async () => { asked++; return 'unmeasured'; },
    };
    const out = await dispatchRun(deps, opened.id, 'go', undefined);
    expect(out).toMatchObject({ ok: false, kind: 'worker-starting', poll: { uuid: UUID } });
    expect(asked).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(ccd.map((c) => c[0])).toEqual(['ensure']);
  });

  it('the same unmeasured verdict after an ensure that found the pane ALIVE is status-unmeasurable', async () => {
    const home = mkTmp('ccrc-dispatch-live-alone-');
    seed(home, ID);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'p', title: 't', project: PROJECT, wave: 2, waveOf: 3, claimedBy: 'c' });
    if (!('id' in opened)) throw new Error('fixture openRun refused');
    coord.setSession(opened.id, ID);
    const base = testDeps(home, async () => ({ code: 0, stdout: '', stderr: '' }));
    const deps: DispatchRunDeps = {
      ...base, coord,
      runCcd: async (argv): Promise<CcdResult> =>
        ({ ok: true, stdout: argv[0] === 'ensure' ? `alive: ${ID}\n` : '', stderr: '', killed: false, signal: null }),
      configDir: (w: string) => configDirFor(base.cfg, w),
      turnVerdict: async () => 'unmeasured',
    };
    expect(await dispatchRun(deps, opened.id, 'go', undefined))
      .toEqual({ ok: false, kind: 'refused', code: 'status-unmeasurable' });
  });
});

describe('the bound has a basis in code (D-5238)', () => {
  it('2 × DISPATCH_SPAWN_WAIT_MS fits inside ccrc-api\'s own request cap (curl -m)', () => {
    const api = readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc-api'), 'utf8');
    const caps = [...api.matchAll(/(?:^|\s)-m (\d+)(?=\s)/g)].map((m) => Number(m[1]));
    expect(caps.length, 'no `-m <seconds>` found in ccd/ccrc-api').toBeGreaterThan(0);
    const cap = Math.min(...caps);
    expect(2 * DISPATCH_SPAWN_WAIT_MS).toBeLessThanOrEqual(cap * 1000);
    expect(DISPATCH_SPAWN_POLL_MS).toBeLessThan(DISPATCH_SPAWN_WAIT_MS);
  });
});

// D-5232's mechanism (plan 2026-10-16, Task 9b): a server carrying this gate advertises `dispatch-live-gate-v1`, and the
// fleet's hook engages D-5239's compaction skip only behind a server that does. The word is pinned HERE, beside the
// gate's own cases, so a change that removes the gate meets the word it would leave advertising a promise it broke.
describe('the gate\'s capability word (D-5238, advertised through D-5232\'s mechanism)', () => {
  it('SERVER_CAPS lists dispatch-live-gate-v1', () => {
    expect(SERVER_CAPS).toContain('dispatch-live-gate-v1');
  });
});

// `compactions-write-no-hookstate` (D-5239): behind this gate's word the fleet's hook leaves a Stop's `done` standing
// through an idle compaction, while the live file reads `busy` (it does during a compaction). The carry is safe only
// because this gate reads the live word: the real hook writes the file, and the dispatch still refuses.
describe('a hook done carried through an idle compaction, live busy, is worker-busy (D-5239 behind D-5238)', () => {
  it('Stop, then PreCompact and PostCompact manual behind dispatch-live-gate-v1 → hook still done/Stop, worker-busy, no /clear', async () => {
    const b = await box();
    const bin = path.join(b.home, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
    mkdirSync(path.join(b.home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(b.home, '.ccrc', SERVER_CAPS_FILE), renderServerCaps(SERVER_CAPS, Math.floor(Date.now() / 1000)));
    const stopPayload = { ...(JSON.parse(readFileSync(path.join(here, 'fixtures/hook/stop-bg-five-kinds.json'), 'utf8')) as object),
      session_id: UUID, background_tasks: [] };
    const compact = (ev: string): object => ({ session_id: UUID, transcript_path: '/rig/fixhome/cfg/projects/-rig-repo/x.jsonl',
      cwd: '/rig/repo', prompt_id: '00000000-0000-4000-8000-0000000000c1', hook_event_name: ev, trigger: 'manual',
      ...(ev === 'PreCompact' ? { custom_instructions: null } : { compact_summary: 'fixture summary' }) });
    for (const p of [stopPayload, compact('PreCompact'), compact('PostCompact')]) {
      execFileSync('bash', [path.join(ccrcRoot, 'ccd', 'session-hook.sh')], { input: JSON.stringify(p), encoding: 'utf8',
        env: { ...process.env, HOME: b.home, PATH: `${bin}:${process.env['PATH'] ?? ''}`, TMUX_PANE: '%1',
          CLAUDE_CODE_SESSION_ID: UUID, CLAUDE_PID: String(PANE) } });
    }
    const hs = JSON.parse(readFileSync(path.join(b.home, '.cc-sessions', `${ID}.hookstate.json`), 'utf8')) as Record<string, unknown>;
    expect(hs).toMatchObject({ state: 'done', event: 'Stop', sessionId: UUID });
    live(b.home, 'busy');
    const res = await b.dispatch();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'worker-busy' });
    expect(b.cleared()).toBe(false);
    expect(b.acts()).toEqual([]);
  });
});

// D-5232 (plan 2026-10-16, Task 2): behind `hook-main-state-v1` the fleet's hook keeps a Stop's `done` through the agent
// events of the delegated run it left (the carried shape: the Stop's own `updatedAt` and `event`, `aliveAt` moved by the
// agent events, the delegated pair). That carry is safe only behind this gate, which reads the live word and refuses a
// busy pane, so this case is why Task 9 is a structural prerequisite of Task 2. APPENDED.
describe('a done carried through delegated work never reaches /clear (D-5232, behind D-5238)', () => {
  it('hook done/Stop carried 40 minutes, aliveAt current, live `busy` → worker-busy: no hold, no /clear', async () => {
    const b = await box();
    writeFileSync(path.join(b.home, '.cc-sessions', `${ID}.hookstate.json`), JSON.stringify({
      v: 1, state: 'done', event: 'Stop', sessionId: UUID, pid: PANE, updatedAt: Date.now() - 40 * 60_000, ask: null,
      subagents: [{ name: 'general-purpose', startedAt: Date.now() - 41 * 60_000, id: 'a0000000000000001' }],
      graphQueries: 0, graphGateDenials: 0, ccrcPeerReads: 0, ccrcClaims: 0,
      aliveAt: Date.now() - 30_000, bgDelegated: 1, bgDelegatedKinds: 'subagent' }));
    live(b.home, 'busy');
    const res = await b.dispatch();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'worker-busy' });
    expect(b.acts()).toEqual([]);
    expect(b.cleared()).toBe(false);
    expect(b.state()).toBe('planned');
  });

  it('SERVER_CAPS lists hook-main-state-v1 beside the gate\'s own word', () => {
    expect(SERVER_CAPS).toContain('dispatch-live-gate-v1');
    expect(SERVER_CAPS).toContain('hook-main-state-v1');
  });
});
