// Desktop polish C3 (D-6435): the pane capture of `FleetWatcher.tick()`, measured at the tick. `detectDialogs` captures one
// pane per registry row; today it does so one after another, and a later change bounds a CONCURRENT pass instead. This
// suite is written against the serial code so that change is pinned to leave every frame exactly as it is. It measures:
// - the frames of one 12-row fixture (more rows than the capture bound, so an unbounded fan-out shows), recorded as
//   LITERALS below: the `pane:<id>` emissions in order, the ask pushes, the fleet frame's rows, the statuslines and the
//   task progress. Nothing in an expectation is computed from the code under test;
// - how many captures are in flight at once, and whether a second is issued before the first resolves;
// - that a pane's `doneAt` is its own capture's return time, whichever order the captures return in;
// - the task lane's regression pins that the same tick holds: a due sweep adds no `.uuid` read (the registry hand-off,
//   #1240), task files are read once per TASK_SWEEP_MS, and an unlistable registry reads none and keeps the progress.
// Fakes and fixture HOMEs only: an in-memory FleetIO (`registryCountingIO.ts`) serves the registry and the task files, a
// fake runner answers `tmux capture-pane` from a pane table and holds each capture at a gate the case controls. No live
// fleet, no real tmux, no real ccd.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { TASK_SWEEP_MS } from '../src/laneSchedule.js';
import { ASK_SETTLE_TICKS } from '../src/askwindow.js';
import { tasksDir } from '../src/tasks/read.js';
import type { FleetIO } from '../src/io.js';
import type { PushPayload } from '../src/push.js';
import type { FleetSession } from '../../shared/api.js';
import { countingIO, fixtureConfig, type FakeRegistry } from './registryCountingIO.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

/** 2026-10-01T12:00:00Z: the fixed wall clock of every case but the one that moves it. */
const T0 = 1790856000000;
/** The capture bound. The later code commit replaces this with an import of `DIALOG_CAPTURE_CONCURRENCY` from watch.ts. */
const CAPTURE_BOUND = 8;
/** A macrotask-spin bound: a wait that outruns it fails by assertion or by a named error, never by a hang. */
const SPIN_LIMIT = 20_000;

const N = 12;
const pad = (i: number): string => String(i).padStart(2, '0');
const idOf = (i: number): string => `lane-a-demo-${pad(i)}`;
const uuidOf = (i: number): string => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const IDS: readonly string[] = Array.from({ length: N }, (_, i) => idOf(i));
/** Two non-adjacent rows hold a dialog (from the second tick), one after the eighth row. */
const DIALOG_ROWS: readonly number[] = [2, 9];
/** Two other rows have task lists. */
const TASK_ROWS: readonly number[] = [4, 6];

const macrotask = (): Promise<void> => new Promise<void>((go) => { setTimeout(go, 0); });

// ---- the fixture -----------------------------------------------------------------------------------------------------

/** One row's pane: its dialog (when it has one and `dialogs` is on), then the statusline row the parser reads
 *  (`pane/statusline.ts`: `👤` first, `│`-separated segments, the `▓ ctx` segment last). Model, branch and context
 *  differ per row so a frame that went to the wrong row shows. */
const paneOf = (i: number, dialogs: boolean): string => {
  const dialog = dialogs && DIALOG_ROWS.includes(i)
    ? (i === 2
      ? 'Switch model?\n\n❯ 1. Yes, switch to Fable 5\n  2. No, go back\n\n'
      : 'Proceed with the migration?\n\n❯ 1. Yes, apply it\n  2. No, keep the old schema\n\n')
    : 'working on row\n\n';
  return `${dialog}  👤 claude │ 🤖 Sonnet 5 row ${pad(i)} · high │ ⎇ ws/demo-${i} │ 🎯 demo │ ▓ ctx ████░░░░ ${10 + i}%\n`;
};

const taskFile = (n: number, status: string, subject: string): string =>
  JSON.stringify({ id: String(n), subject, activeForm: `${subject}...`, description: '', status });

/** The registry and every task file as one Map the fake serves. `listed` false models an unlistable registry. */
interface Fixture { reg: FakeRegistry; dir: string; addTask: (i: number, n: number, status: string, subject: string) => void }
const fixture = (): Fixture => {
  const cfg = fixtureConfig();
  const dir = cfg.registryDir;
  const files = new Map<string, string>();
  const taskPath = (i: number, n: number): string => path.join(tasksDir(path.join(cfg.home, '.claude'), uuidOf(i)), `${n}.json`);
  for (let i = 0; i < N; i += 1) {
    const fields: Record<string, string> = {
      uuid: uuidOf(i), wrapper: 'claude', workdir: `/work/demo-${i}`, started: '1', project: 'demo',
      workspace: `ws-${i}`, branch: `ws/demo-${i}`,
    };
    for (const [k, v] of Object.entries(fields)) files.set(path.join(dir, `${idOf(i)}.${k}`), v);
  }
  files.set(taskPath(4, 1), taskFile(1, 'completed', 'read the brief'));
  files.set(taskPath(4, 2), taskFile(2, 'in_progress', 'write the tests'));
  files.set(taskPath(6, 1), taskFile(1, 'pending', 'plan the sweep'));
  return { reg: { files }, dir, addTask: (i, n, status, subject) => { files.set(taskPath(i, n), taskFile(n, status, subject)); } };
};

// ---- the capture gate ------------------------------------------------------------------------------------------------

interface Held { id: string; go: () => void }

/** A fake runner that answers `tmux capture-pane` (the plain `-p` form `Tmux.capture` runs) from a pane table, and
 *  holds each such call until a case lets it go. It records the issue order, the wall clock at issue and at release, and
 *  the most captures outstanding at once. Every other argv answers at once with a nonzero code. */
class CaptureGate {
  panes = new Map<string, string | null>();
  issued: string[] = [];
  issuedAt = new Map<string, number>();
  releasedAt = new Map<string, number>();
  held: Held[] = [];
  inFlight = 0;
  maxInFlight = 0;
  releases = 0;
  /** Runs just before a capture is let go (case 8 moves the wall clock here). */
  beforeRelease: ((id: string, k: number) => void) | null = null;

  readonly run: Runner = async (_cmd, args) => {
    if (args[0] !== 'capture-pane' || args.length !== 4 || args[3] !== '-p') return { ran: true, code: 1, stdout: '', stderr: '' };
    const id = args[2]!.replace(/^=cc-/, '').replace(/:$/, '');
    this.issued.push(id);
    this.issuedAt.set(id, Date.now());
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise<void>((go) => { this.held.push({ id, go }); });
    const pane = this.panes.get(id) ?? null;
    return { ran: true, code: pane === null ? 1 : 0, stdout: pane ?? '', stderr: '' };
  };

  /** Lets one held capture go. */
  release(h: Held): void {
    this.releases += 1;
    this.beforeRelease?.(h.id, this.releases);
    this.releasedAt.set(h.id, Date.now());
    this.inFlight -= 1;
    h.go();
  }

  /** Runs `p` to completion, letting every held capture go on each macrotask: in issue order, or newest first. */
  async drive<T>(p: Promise<T>, order: 'issue' | 'reverse' = 'issue'): Promise<T> {
    let done = false;
    let failed: unknown = null;
    const settled = p.then(() => { done = true; }, (e: unknown) => { done = true; failed = e ?? new Error('rejected'); });
    for (let spin = 0; !done; spin += 1) {
      if (spin > SPIN_LIMIT) throw new Error(`drive: the tick never finished (issued ${this.issued.length}, held ${this.held.length})`);
      await macrotask();
      const batch = this.held.splice(0);
      if (order === 'reverse') batch.reverse();
      for (const h of batch) this.release(h);
    }
    await settled;
    if (failed !== null) throw failed;
    return p;
  }
}

// ---- the watcher rig -------------------------------------------------------------------------------------------------

interface Rig {
  w: FleetWatcher; bus: Bus; gate: CaptureGate; fx: Fixture; counting: ReturnType<typeof countingIO>;
  sent: PushPayload[]; setMono: (ms: number) => void; mono: () => number;
  /** Makes the registry directory answer `readdir` with null (the unlistable registry). */
  unlist: (on: boolean) => void;
  /** One tick, its captures let go as `order` says. */
  tick: (order?: 'issue' | 'reverse') => Promise<void>;
  /** The requests one tick issued (what `fn` ran, and nothing after it). */
  during: (fn: () => Promise<void>) => Promise<string[]>;
}

const rig = (): Rig => {
  const fx = fixture();
  const counting = countingIO(fx.reg);
  let unlisted = false;
  const io: FleetIO = { ...counting.io, readdir: async (d) => (unlisted && d === fx.dir ? null : counting.io.readdir(d)) };
  const gate = new CaptureGate();
  for (let i = 0; i < N; i += 1) gate.panes.set(idOf(i), paneOf(i, false));
  let mono = 1_000_000;
  const sent: PushPayload[] = [];
  const bus = new Bus();
  const w = new FleetWatcher({
    ...testDeps(mkTmp('ccrc-tick-conc-'), gate.run), cfg: fixtureConfig(), io, monotonicMs: () => mono,
    push: { notify: async (p: PushPayload) => { sent.push(p); } } as never,
  } as never, bus, 2000);
  const tick = (order: 'issue' | 'reverse' = 'issue'): Promise<void> => gate.drive(w.tick(), order);
  const during = async (fn: () => Promise<void>): Promise<string[]> => {
    const from = counting.requests.length;
    await fn();
    return counting.requests.slice(from).map((r) => r.path);
  };
  return { w, bus, gate, fx, counting, sent, setMono: (ms) => { mono = ms; }, mono: () => mono, unlist: (on) => { unlisted = on; }, tick, during };
};

/** The first tick, which primes (no push on it): no row shows a dialog, no task list is due again afterwards. */
const primed = async (r: Rig): Promise<void> => {
  await r.tick();
  expect(r.sent, 'the priming tick pushes nothing').toEqual([]);
};

/** What one recorded tick published. */
interface Seen {
  panes: { id: string; pane: string | null; at: number; doneAt: number }[];
  fleets: FleetSession[][];
}

/** The fixture's recorded tick, the FOURTH: the first primes, the dialogs appear on the second, and an ask is raised only
 *  after `ASK_SETTLE_TICKS` more ticks of its being on screen with no hookstate envelope to answer from (`detectDialogs`'
 *  settling), so the third and fourth are the ones that count towards its push. A task is added to row 4 and the mono
 *  clock moves past TASK_SWEEP_MS before it, so the task lane is due on it. The tick subscribes to every `pane:<id>` and
 *  to the `fleet` frame first, and its captures are let go as `order` says. The ticks before it release in issue order. */
const recordedTick = async (r: Rig, order: 'issue' | 'reverse'): Promise<Seen> => {
  await primed(r);
  for (let i = 0; i < N; i += 1) r.gate.panes.set(idOf(i), paneOf(i, true));
  for (let t = 0; t < ASK_SETTLE_TICKS; t += 1) {
    r.setMono(r.mono() + 2000);
    await r.tick();
  }
  expect(r.sent, 'no ask is pushed while the dialogs settle').toEqual([]);
  r.fx.addTask(4, 3, 'pending', 'review the diff');
  r.setMono(r.mono() + TASK_SWEEP_MS + 2000);
  const seen: Seen = { panes: [], fleets: [] };
  for (const id of IDS) r.bus.on(`pane:${id}`, (p: { at: number; doneAt: number; pane: string | null }) => { seen.panes.push({ id, pane: p.pane, at: p.at, doneAt: p.doneAt }); });
  r.bus.on('fleet', (s: FleetSession[]) => { seen.fleets.push(s); });
  await r.tick(order);
  return seen;
};

/** The fleet frame's rows, reduced to the stable subset the literals pin. */
const fleetSubset = (s: FleetSession[]) => s.map((x) => ({ id: x.id, dialogPending: x.dialogPending, model: x.model, branch: x.branch, ctxPct: x.ctxPct, tasks: x.tasks }));
const sortedEntries = <V>(m: Map<string, V>): [string, V][] => [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

// ---- the recorded frames (written on the serial code, 2026-10-27) ------------------------------------------------------

/** The `pane:<id>` emissions of the recorded tick, in order: the registry's order, each row's own look, the fixed clock
 *  at issue and at return. Written out, not derived from the fixture's `paneOf`. */
const RECORDED_PANES = [
  { id: 'lane-a-demo-00', pane: 'working on row\n\n  👤 claude │ 🤖 Sonnet 5 row 00 · high │ ⎇ ws/demo-0 │ 🎯 demo │ ▓ ctx ████░░░░ 10%\n', at: T0, doneAt: T0 },
  { id: 'lane-a-demo-01', pane: 'working on row\n\n  👤 claude │ 🤖 Sonnet 5 row 01 · high │ ⎇ ws/demo-1 │ 🎯 demo │ ▓ ctx ████░░░░ 11%\n', at: T0, doneAt: T0 },
  { id: 'lane-a-demo-02', pane: 'Switch model?\n\n❯ 1. Yes, switch to Fable 5\n  2. No, go back\n\n  👤 claude │ 🤖 Sonnet 5 row 02 · high │ ⎇ ws/demo-2 │ 🎯 demo │ ▓ ctx ████░░░░ 12%\n', at: T0, doneAt: T0 },
  { id: 'lane-a-demo-03', pane: 'working on row\n\n  👤 claude │ 🤖 Sonnet 5 row 03 · high │ ⎇ ws/demo-3 │ 🎯 demo │ ▓ ctx ████░░░░ 13%\n', at: T0, doneAt: T0 },
  { id: 'lane-a-demo-04', pane: 'working on row\n\n  👤 claude │ 🤖 Sonnet 5 row 04 · high │ ⎇ ws/demo-4 │ 🎯 demo │ ▓ ctx ████░░░░ 14%\n', at: T0, doneAt: T0 },
  { id: 'lane-a-demo-05', pane: 'working on row\n\n  👤 claude │ 🤖 Sonnet 5 row 05 · high │ ⎇ ws/demo-5 │ 🎯 demo │ ▓ ctx ████░░░░ 15%\n', at: T0, doneAt: T0 },
  { id: 'lane-a-demo-06', pane: 'working on row\n\n  👤 claude │ 🤖 Sonnet 5 row 06 · high │ ⎇ ws/demo-6 │ 🎯 demo │ ▓ ctx ████░░░░ 16%\n', at: T0, doneAt: T0 },
  { id: 'lane-a-demo-07', pane: 'working on row\n\n  👤 claude │ 🤖 Sonnet 5 row 07 · high │ ⎇ ws/demo-7 │ 🎯 demo │ ▓ ctx ████░░░░ 17%\n', at: T0, doneAt: T0 },
  { id: 'lane-a-demo-08', pane: 'working on row\n\n  👤 claude │ 🤖 Sonnet 5 row 08 · high │ ⎇ ws/demo-8 │ 🎯 demo │ ▓ ctx ████░░░░ 18%\n', at: T0, doneAt: T0 },
  { id: 'lane-a-demo-09', pane: 'Proceed with the migration?\n\n❯ 1. Yes, apply it\n  2. No, keep the old schema\n\n  👤 claude │ 🤖 Sonnet 5 row 09 · high │ ⎇ ws/demo-9 │ 🎯 demo │ ▓ ctx ████░░░░ 19%\n', at: T0, doneAt: T0 },
  { id: 'lane-a-demo-10', pane: 'working on row\n\n  👤 claude │ 🤖 Sonnet 5 row 10 · high │ ⎇ ws/demo-10 │ 🎯 demo │ ▓ ctx ████░░░░ 20%\n', at: T0, doneAt: T0 },
  { id: 'lane-a-demo-11', pane: 'working on row\n\n  👤 claude │ 🤖 Sonnet 5 row 11 · high │ ⎇ ws/demo-11 │ 🎯 demo │ ▓ ctx ████░░░░ 21%\n', at: T0, doneAt: T0 },
] as const;

/** The ask pushes of the recorded tick, in order: the two dialogs, raised once each, after they settled. */
const RECORDED_PUSHES = [
  { title: '❓ Question', body: 'Switch model?', sessionId: 'lane-a-demo-02', tag: 'ask-lane-a-demo-02' },
  { title: '❓ Question', body: 'Proceed with the migration?', sessionId: 'lane-a-demo-09', tag: 'ask-lane-a-demo-09' },
] as const;

/** The recorded tick's fleet frame, reduced to `{id, dialogPending, model, branch, ctxPct, tasks}`, in registry order. */
const RECORDED_FLEET = [
  { id: 'lane-a-demo-00', dialogPending: false, model: 'Sonnet 5 row 00', branch: 'ws/demo-0', ctxPct: 10, tasks: null },
  { id: 'lane-a-demo-01', dialogPending: false, model: 'Sonnet 5 row 01', branch: 'ws/demo-1', ctxPct: 11, tasks: null },
  { id: 'lane-a-demo-02', dialogPending: true, model: 'Sonnet 5 row 02', branch: 'ws/demo-2', ctxPct: 12, tasks: null },
  { id: 'lane-a-demo-03', dialogPending: false, model: 'Sonnet 5 row 03', branch: 'ws/demo-3', ctxPct: 13, tasks: null },
  { id: 'lane-a-demo-04', dialogPending: false, model: 'Sonnet 5 row 04', branch: 'ws/demo-4', ctxPct: 14, tasks: { total: 3, done: 1, running: 1, active: 'write the tests...' } },
  { id: 'lane-a-demo-05', dialogPending: false, model: 'Sonnet 5 row 05', branch: 'ws/demo-5', ctxPct: 15, tasks: null },
  { id: 'lane-a-demo-06', dialogPending: false, model: 'Sonnet 5 row 06', branch: 'ws/demo-6', ctxPct: 16, tasks: { total: 1, done: 0, running: 0, active: null } },
  { id: 'lane-a-demo-07', dialogPending: false, model: 'Sonnet 5 row 07', branch: 'ws/demo-7', ctxPct: 17, tasks: null },
  { id: 'lane-a-demo-08', dialogPending: false, model: 'Sonnet 5 row 08', branch: 'ws/demo-8', ctxPct: 18, tasks: null },
  { id: 'lane-a-demo-09', dialogPending: true, model: 'Sonnet 5 row 09', branch: 'ws/demo-9', ctxPct: 19, tasks: null },
  { id: 'lane-a-demo-10', dialogPending: false, model: 'Sonnet 5 row 10', branch: 'ws/demo-10', ctxPct: 20, tasks: null },
  { id: 'lane-a-demo-11', dialogPending: false, model: 'Sonnet 5 row 11', branch: 'ws/demo-11', ctxPct: 21, tasks: null },
] as const;

/** `currentStatuslines()` after the recorded tick, sorted by id. */
const RECORDED_STATUSLINES = [
  ['lane-a-demo-00', { model: 'Sonnet 5 row 00', effort: 'high', ultracode: false, branch: 'ws/demo-0', workflowActive: false, ctxPct: 10 }],
  ['lane-a-demo-01', { model: 'Sonnet 5 row 01', effort: 'high', ultracode: false, branch: 'ws/demo-1', workflowActive: false, ctxPct: 11 }],
  ['lane-a-demo-02', { model: 'Sonnet 5 row 02', effort: 'high', ultracode: false, branch: 'ws/demo-2', workflowActive: false, ctxPct: 12 }],
  ['lane-a-demo-03', { model: 'Sonnet 5 row 03', effort: 'high', ultracode: false, branch: 'ws/demo-3', workflowActive: false, ctxPct: 13 }],
  ['lane-a-demo-04', { model: 'Sonnet 5 row 04', effort: 'high', ultracode: false, branch: 'ws/demo-4', workflowActive: false, ctxPct: 14 }],
  ['lane-a-demo-05', { model: 'Sonnet 5 row 05', effort: 'high', ultracode: false, branch: 'ws/demo-5', workflowActive: false, ctxPct: 15 }],
  ['lane-a-demo-06', { model: 'Sonnet 5 row 06', effort: 'high', ultracode: false, branch: 'ws/demo-6', workflowActive: false, ctxPct: 16 }],
  ['lane-a-demo-07', { model: 'Sonnet 5 row 07', effort: 'high', ultracode: false, branch: 'ws/demo-7', workflowActive: false, ctxPct: 17 }],
  ['lane-a-demo-08', { model: 'Sonnet 5 row 08', effort: 'high', ultracode: false, branch: 'ws/demo-8', workflowActive: false, ctxPct: 18 }],
  ['lane-a-demo-09', { model: 'Sonnet 5 row 09', effort: 'high', ultracode: false, branch: 'ws/demo-9', workflowActive: false, ctxPct: 19 }],
  ['lane-a-demo-10', { model: 'Sonnet 5 row 10', effort: 'high', ultracode: false, branch: 'ws/demo-10', workflowActive: false, ctxPct: 20 }],
  ['lane-a-demo-11', { model: 'Sonnet 5 row 11', effort: 'high', ultracode: false, branch: 'ws/demo-11', workflowActive: false, ctxPct: 21 }],
] as const;

/** `currentTaskProgress()` after the recorded tick, sorted by id: row 4 gained a third task since the first tick. */
const RECORDED_TASKS = [
  ['lane-a-demo-04', { total: 3, done: 1, running: 1, active: 'write the tests...' }],
  ['lane-a-demo-06', { total: 1, done: 0, running: 0, active: null }],
] as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the frames of one fixture, recorded as literals', () => {
  it('the pane emissions and the ask pushes of the recorded tick equal the literals', async () => {
    const r = rig();
    const seen = await recordedTick(r, 'issue');
    expect(seen.panes).toEqual(RECORDED_PANES);
    expect(r.sent).toEqual(RECORDED_PUSHES);
  }, 60_000);

  it('the fleet frame, the statuslines and the task progress of the recorded tick equal the literals', async () => {
    const r = rig();
    const seen = await recordedTick(r, 'issue');
    expect(seen.fleets, 'one fleet frame on the recorded tick').toHaveLength(1);
    expect(fleetSubset(seen.fleets[0]!)).toEqual(RECORDED_FLEET);
    expect(sortedEntries(r.w.currentStatuslines())).toEqual(RECORDED_STATUSLINES);
    expect(sortedEntries(r.w.currentTaskProgress())).toEqual(RECORDED_TASKS);
  }, 60_000);
});

/** Task-file reads among a tick's requests (a path under a `tasks` directory), and `.uuid` reads. */
const taskReads = (paths: readonly string[]): string[] => paths.filter((p) => p.includes(`${path.sep}tasks${path.sep}`));
const uuidReads = (paths: readonly string[]): string[] => paths.filter((p) => p.endsWith('.uuid'));

describe('the capture pass of one tick (D-6435)', () => {
  // The registry hand-off to `sweepTasks` landed in #1240: a due sweep is handed the tick's listing, so it reads no
  // `.uuid` of its own. Green on the serial code; the case holds it through the bounded pass.
  it('a due task sweep adds no uuid read', async () => {
    const r = rig();
    await primed(r);
    r.setMono(r.mono() + 2000);
    r.w.kick('tasks');
    const kicked = await r.during(() => r.tick());
    r.setMono(r.mono() + 2000);
    const plain = await r.during(() => r.tick());
    expect(taskReads(kicked).length, 'the kicked tick ran the sweep: it read task files').toBeGreaterThan(0);
    expect(taskReads(plain), 'the plain tick did not: the lane was not due').toEqual([]);
    expect(uuidReads(plain).length, 'CONTROL: the tick\'s own registry read counts .uuid requests').toBeGreaterThan(0);
    expect(uuidReads(kicked).length - uuidReads(plain).length).toBe(0);
  }, 60_000);

  // RED on the serial code: the second capture waits for the first. The waits are bounded, so it fails by assertion, then
  // every held capture is let go so the tick finishes.
  it('a second capture is issued before the first resolves', async () => {
    const r = rig();
    const tick = r.w.tick();
    let spins = 0;
    while (r.gate.issued.length < 1 && spins < 5000) { await macrotask(); spins += 1; }
    for (let i = 0; i < 25; i += 1) await macrotask();
    const issuedBeforeAnyRelease = r.gate.issued.length;
    const releasedBeforeAnyRelease = r.gate.releases;
    await r.gate.drive(tick);
    expect(releasedBeforeAnyRelease, 'nothing was let go before the count').toBe(0);
    expect(issuedBeforeAnyRelease, 'captures issued while the first was still pending').toBeGreaterThanOrEqual(2);
  }, 60_000);

  // Green on the serial code (it never has more than one); its mutant is an unbounded `Promise.all` over the 12 rows.
  it('never more than the capture bound in flight', async () => {
    const r = rig();
    await r.tick();
    expect(new Set(r.gate.issued).size, 'every row was captured, and there are more rows than the bound').toBe(N);
    expect(N).toBeGreaterThan(CAPTURE_BOUND);
    expect(r.gate.maxInFlight).toBeLessThanOrEqual(CAPTURE_BOUND);
    expect(r.gate.maxInFlight).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('dialog frames equal the recorded ones, in registry order', async () => {
    const r = rig();
    const seen = await recordedTick(r, 'reverse');
    expect(seen.panes).toEqual(RECORDED_PANES);
    expect(r.sent).toEqual(RECORDED_PUSHES);
  }, 60_000);

  it('fleet, statuslines and task progress equal the recorded ones', async () => {
    const r = rig();
    const seen = await recordedTick(r, 'reverse');
    expect(seen.fleets, 'one fleet frame on the recorded tick').toHaveLength(1);
    expect(fleetSubset(seen.fleets[0]!)).toEqual(RECORDED_FLEET);
    expect(sortedEntries(r.w.currentStatuslines())).toEqual(RECORDED_STATUSLINES);
    expect(sortedEntries(r.w.currentTaskProgress())).toEqual(RECORDED_TASKS);
  }, 60_000);

  it('task files are read at most once per TASK_SWEEP_MS', async () => {
    const r = rig();
    await primed(r);
    r.setMono(r.mono() + TASK_SWEEP_MS + 2000);
    const first = await r.during(() => r.tick());
    r.setMono(r.mono() + 2000);
    const within = await r.during(() => r.tick());
    r.setMono(r.mono() + TASK_SWEEP_MS);
    const past = await r.during(() => r.tick());
    expect(taskReads(first).length, 'the first tick reads task files').toBeGreaterThan(0);
    expect(taskReads(within), 'a tick inside the cadence reads none').toEqual([]);
    expect(taskReads(past).length, 'past the cadence they are read again').toBeGreaterThan(0);
  }, 60_000);

  it('an unlistable tick reads no task file and keeps progress', async () => {
    const r = rig();
    await primed(r);
    r.setMono(r.mono() + TASK_SWEEP_MS + 2000);
    await r.tick();
    const before = sortedEntries(r.w.currentTaskProgress());
    expect(before.map(([id]) => id), 'a listed tick filled the progress of the two task rows').toEqual([idOf(4), idOf(6)]);
    r.unlist(true);
    r.w.kick('tasks');
    r.setMono(r.mono() + 2000);
    const unlisted = await r.during(() => r.tick());
    expect(unlisted.filter((p) => p.endsWith('.uuid')), 'CONTROL: the tick tried to read the registry and got nothing').toEqual([]);
    expect(taskReads(unlisted), 'no task file is read').toEqual([]);
    expect(sortedEntries(r.w.currentTaskProgress())).toEqual(before);
    // CONTROL: listed again and kicked, the same tick does read them, so the zero above was the listing's doing.
    r.unlist(false);
    r.w.kick('tasks');
    r.setMono(r.mono() + 2000);
    expect(taskReads(await r.during(() => r.tick())).length).toBeGreaterThan(0);
  }, 60_000);

  // The wall clock steps to a distinct value before each capture is let go, and the captures return newest first. A
  // pane's `doneAt` is when ITS capture returned, and `at` when it was issued, whatever happened to the others meanwhile.
  it("a pane's doneAt is its own capture's return time", async () => {
    const r = rig();
    await primed(r);
    for (let i = 0; i < N; i += 1) r.gate.panes.set(idOf(i), paneOf(i, true));
    r.gate.issued.length = 0;
    r.gate.issuedAt.clear();
    r.gate.releases = 0;
    r.gate.beforeRelease = (_id, k) => { vi.setSystemTime(T0 + 1000 * k); };
    const panes: { id: string; at: number; doneAt: number }[] = [];
    for (const id of IDS) r.bus.on(`pane:${id}`, (p: { at: number; doneAt: number }) => { panes.push({ id, at: p.at, doneAt: p.doneAt }); });
    r.setMono(r.mono() + 2000);
    await r.tick('reverse');
    expect(panes.map((p) => p.id), 'every row published once, in registry order').toEqual([...IDS]);
    expect(new Set(r.gate.releasedAt.values()).size, 'the release times are twelve distinct values').toBe(N);
    for (const p of panes) {
      expect(p.doneAt, `${p.id} doneAt is its own release time`).toBe(r.gate.releasedAt.get(p.id));
      expect(p.at, `${p.id} at is its own issue time`).toBe(r.gate.issuedAt.get(p.id));
    }
  }, 60_000);
});
