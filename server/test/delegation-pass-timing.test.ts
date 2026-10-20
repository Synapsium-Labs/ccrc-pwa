// D-5692: the delegation lane's SLOW-PASS TIMING LINE (rows R1 to R7). The lane (`DelegationLane` in `watch.ts`) writes ONE diagnostics line,
// `ccrc-server: delegation pass slow: key=value ...`, when the BLOCKING phases of a pass sum to more than `DELEGATION_PASS_SLOW_MS`
// (strictly more: exactly that writes nothing). The line is numbers only: no path, session id, project or record name ever enters it, and
// it never changes a verdict, an effect, a journal write, a checkpoint or the timing of any act.
//
// WHAT THIS FILE PINS
//   R1  a full pass: one line; its phases, derived keys and sizes are exactly what ran, each size equal to a count measured INDEPENDENTLY
//       of the lane's new code (spies on correlation and policy, the applier's own return values, the report, the checkpoint on disk);
//       the same for the six repair sizes (a real repair of a drifted `coord.db`, a null report, a throw), for an unknown-repository
//       window (after a restart) and for the mark, dropped-key, lost-project and flag sizes (the lane's forgetting seams)
//   R2  strictly more than 1,000 ms of BLOCKING time writes a line; exactly 1,000 does not; no read phase (`open recover root load owners
//       readMetas`) is blocking
//   R3  every phase and part adds to itself and to every phase that encloses it, and to no other (the table, plus the port's `rewrite`)
//   R4  three phases each under the threshold whose BLOCKING sum is over it write the line
//   R5  the line holds none of a census's strings and matches the fixed grammar; the formatter bounds its output, drops whole pairs and
//       still tries the next key, and rounds and clamps each value
//   R6  a pass with no reconcile (a census not newer) writes a line with no reconcile key at all
//   R7  a pass cut by its budget writes its line at its late settle, once, with `cut=1` (nothing at the cut itself)
//
// THE VIRTUAL CLOCK. `world()` hands the watcher `monotonicMs: () => clock.t`, the one clock the lane reads for timing. The lane reads
// it at the start and end of each timed phase and calls `onPassPhase(key)` (a lane seam) right after the start read, so a row advances
// `clock.t` inside that hook for one chosen key and ALL the time lands in exactly that phase; everything else is 0 ms. The seam, the
// new exports and the new report keys are reached through casts and a namespace import, so that this file is type-clean against code
// that has none of them yet, and each row then fails on its own assertion (no line written, formatter not a function), never as a
// whole file on an import error.
//
// D-5832..D-5836 (run 645) extend the file: the line also carries CPU, the event-loop stall, the repair's own rewrite time, the turns' time
// and two sizes (D-5832); the attempts write is skipped when nothing is new (D-5834); the lane yields to the loop between its phases
// (D-5835); and the per-pass repair skips its rewrite when the projection is known current (D-5836). Their rows follow R7, each titled by
// its id. The harness grows two virtual seams, installed by `world()` and kept by `rig()`: `cpuMicros` (a CPU clock, `w.cpu`) and
// `loopDelay` (the stall sampler, `w.stall`), both reading 0 until a row sets them. The lane's production turns are real unless a row
// passes `loopTurn`; a row selects a production seam by passing its key as `undefined`.
//
// Every directory here is a FIXTURE home: nothing reads or writes the live `~/.ccrc` or `~/.cc-sessions`, and no ccd verb runs.
// `world()`, `setCensus`, `censusPass`, `primed` and `disk` below MIRROR the fixture of `delegation-watch.test.ts` (trimmed to what these
// rows need: the owner listing hold is kept for R7, the other fault knobs are not).
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { FleetSession } from '../../shared/api.js';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { FleetWatcher, DELEGATION_PASS_BUDGET_MS, DELEGATION_SWEEP_MS } from '../src/watch.js';
import * as watchMod from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import * as policy from '../src/coord/delegation-policy.js';
import * as correlation from '../src/coord/delegation-correlation.js';
import * as model from '../src/coord/delegation-model.js';
import * as checkpointMod from '../src/coord/delegation-checkpoint.js';
import type { DelegationCensusPass, ParentIncarnation, WorktreeCensus } from '../src/coord/gitref.js';
import { DELEGATION_CHECKPOINT_FILE, DelegationDurability, decodeDelegationCheckpoint, type DelegationProjectionRepairReport } from '../src/coord/delegation-checkpoint.js';
import { DELEGATION_JOURNAL_FILE } from '../src/coord/delegation-journal.js';
import { DELEGATION_EVENTS_CAP, canonicalDelegationJson, type DelegationAttemptRow, type DelegationCensusRecord, type DelegationCheckpointV1 } from '../src/coord/delegation-model.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = Date.UTC(2026, 9, 15, 10, 30, 0);                       // 2026-10-15T10:30Z; the hour 10:00 is open
const INC = '0189abcd-1234-5678-9abc-0123456789ab';
const CLAUDE = '6350faa0-a1be-4e78-939c-57485268f6fc';
const BUCKET09 = '2026101509';
const BUCKET10 = '2026101510';
const PREFIX = 'ccrc-server: delegation pass slow:';

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(worlds.splice(0).map((w) => w.watcher.closeDelegation().catch(() => undefined)));
});

// ── the world: a fixture home, a watcher over it, a virtual clock, and the spool the hook would have written ──────────

interface World {
  home: string;
  cfg: ReturnType<typeof loadConfig>;
  watcher: FleetWatcher;
  coord: CoordStore;
  /** owner -> a gate its directory listing waits on (R7 holds a read open past the pass budget) */
  hold: Map<string, Promise<void>>;
  calls: { listings: string[] };
  /** The virtual monotonic clock the lane times itself by (`Deps.monotonicMs`). Only a row's hook advances it. */
  clock: { t: number };
  /** D-5832: the virtual CPU clock (`cpuMicros`): cumulative microseconds, and whether it is a thread's. */
  cpu: { us: number; thread: boolean };
  /** D-5832: the virtual stall sampler (`loopDelay`): `stretch` is read and zeroed by the next stretch read; `max`/`p99` are the pass-wide values. */
  stall: { stretch: number; max: number; p99: number };
  /** The lane seams every world starts with (the virtual CPU clock and sampler); `rig()` merges them back under its own. */
  defaultSeams: Record<string, unknown>;
}
const worlds: Array<{ watcher: FleetWatcher }> = [];

const sessionOf = (id: string, status: 'idle' | 'busy' | 'dead' = 'idle', project = 'demo') =>
  ({ id, project, status, stoppedBy: null as FleetSession['stoppedBy'], archivedAt: null as FleetSession['archivedAt'] });
const recordOf = (id: string, project = 'demo') => ({ id, project, child: { kind: 'none' as const } });
type Sess = ReturnType<typeof sessionOf>;
type Rec = ReturnType<typeof recordOf>;

/** `home`: a RESTART over the same fixture home (the journal, the checkpoint and `coord.db` are the first lane's). */
function world(opts: { home?: string } = {}): World {
  const home = opts.home ?? mkTmp('ccrc-dtiming-');
  const projectsRoot = mkTmp('ccrc-dtiming-projects-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: projectsRoot } as never);
  const hold = new Map<string, Promise<void>>();
  const calls = { listings: [] as string[] };
  const spoolOwner = (p: string): string | null => (p.includes('/delegation/spool/') ? path.basename(p.endsWith('.spool') ? path.dirname(p) : p) : null);
  const io: FleetIO = {
    ...localIO,
    readdirMeasured: async (p, t, s) => {
      const owner = spoolOwner(p);
      if (owner !== null) {
        calls.listings.push(owner);
        const gate = hold.get(owner);
        if (gate !== undefined) await gate;
      }
      return localIO.readdirMeasured(p, t, s);
    },
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const clock = { t: 0 };
  const fleet = { connected: true, downSince: null, ccdVerbs: ['caps', DELEGATION_EVENTS_CAP] as string[] | null };
  const deps = { ...testDeps(home), cfg, io, coord, fleetState: fleet, monotonicMs: () => clock.t };
  const cpu = { us: 0, thread: false };
  const stall = { stretch: 0, max: 0, p99: 0 };
  const defaultSeams: Record<string, unknown> = {
    cpuMicros: () => ({ micros: cpu.us, thread: cpu.thread }),
    loopDelay: {
      startPass: (): void => {},
      stretch: (): number => { const v = stall.stretch; stall.stretch = 0; return v; },
      pass: (): { max: number; p99: number } => ({ max: stall.max, p99: stall.p99 }),
      stop: (): void => {},
    },
  };
  const made: World = { home, cfg, watcher: new FleetWatcher(deps as never, new Bus(), 10_000), coord, hold, calls, clock, cpu, stall, defaultSeams };
  made.watcher.setDelegationSeams(defaultSeams as never);
  worlds.push(made);
  return made;
}

const spoolDir = (w: World, owner: string): string => path.join(w.cfg.registryDir, 'delegation', 'spool', owner);
const bucketFile = (w: World, owner: string, bucket: string): string => path.join(spoolDir(w, owner), `${bucket}.spool`);
const lineOf = (obj: unknown): string => `${JSON.stringify(obj)}\n`;
const common = (owner: string, extra: Record<string, unknown>, at = '2026-10-15T10:05:00.000Z') =>
  ({ v: 1, observedAt: at, sessionId: owner, parentIncarnation: INC, claudeSessionId: CLAUDE, ...extra });
const startLine = (owner: string, at?: string, cwd?: string): string =>
  lineOf(common(owner, { eventKind: 'SessionStart', source: 'startup', ...(cwd === undefined ? {} : { cwd }) }, at));
const writeBucket = (w: World, owner: string, bucket: string, ...lines: string[]): void => {
  mkdirSync(spoolDir(w, owner), { recursive: true });
  writeFileSync(bucketFile(w, owner, bucket), lines.join(''));
};
const appendBucket = (w: World, owner: string, bucket: string, ...lines: string[]): void => { appendFileSync(bucketFile(w, owner, bucket), lines.join('')); };
const bashPre = (owner: string, toolUseId: string, listing: string[], at: string, cwd = '/w/demo'): string =>
  lineOf(common(owner, { eventKind: 'PreToolUse', toolName: 'Bash', toolUseId, listing, cwd }, at));
const bashPost = (owner: string, toolUseId: string, listing: string[], at: string, cwd = '/w/demo'): string =>
  lineOf(common(owner, { eventKind: 'PostToolUse', toolName: 'Bash', toolUseId, outcome: 'completed', listing, cwd }, at));

const record = (project: string, adminRecord: string, over: Partial<DelegationCensusRecord> = {}): DelegationCensusRecord => ({
  project, adminRecord, canonicalPath: `/w/${project}/.claude/worktrees/${adminRecord}`, headBranch: null, headSha: 'a'.repeat(40),
  claudeBase: 'b'.repeat(40), locked: false, baseAgreesFirstLog: true, state: 'present', diagnostic: null, ...over,
});
/** A project's census view: its records, or `null` for one whose worktree listing failed (no delegation census at all). */
type CensusView = DelegationCensusRecord[] | null;
function setCensus(w: World, projects: Record<string, CensusView>, incarnations: Record<string, ParentIncarnation>, measuredAt: number): DelegationCensusPass {
  const view = (recs: CensusView): WorktreeCensus =>
    recs === null ? { read: { ok: false, reason: 'unlistable' }, delegation: null } : { read: { ok: true, records: [] }, delegation: recs };
  const pass: DelegationCensusPass = {
    measuredAt, projects: new Map(Object.entries(projects).map(([p, recs]) => [p, view(recs)] as const)),
    incarnations: new Map(Object.entries(incarnations)),
  };
  (w.watcher as unknown as { delegationCensus: DelegationCensusPass | null }).delegationCensus = pass;
  return pass;
}
const measured = (inc = INC): ParentIncarnation => ({ kind: 'measured', incarnation: inc });
const setNow = (ms: number): void => { vi.spyOn(Date, 'now').mockReturnValue(ms); };
const pass = async (w: World, sessions: readonly Sess[], records: readonly Rec[] = sessions.map((s) => recordOf(s.id, s.project))): Promise<void> => {
  await w.watcher.sweepDelegation(sessions as never, records as never);
};
const DEMO_A = [sessionOf('demo-a')];
/** One whole pass at `now`, with a census for `projects` measured `age` ms before it (the lane reconciles only a census it has not reconciled yet). */
const censusPass = async (
  w: World, now: number, projects: Record<string, CensusView>, sessions: readonly Sess[] = DEMO_A, age = 0,
): Promise<void> => {
  setNow(now);
  setCensus(w, projects, Object.fromEntries(sessions.map((s) => [s.id, measured()])), now - age);
  await pass(w, sessions);
};
/** R88: the lane's FIRST READY PASS at `PRIMED_AT`, before every call a fixture's spool holds (the earliest is 10:01). */
const PRIMED_AT = Date.UTC(2026, 9, 15, 10, 0, 30);
const primed = async (w: World): Promise<World> => {
  setNow(PRIMED_AT);
  setCensus(w, {}, {}, PRIMED_AT);
  await pass(w, []);
  return w;
};
const STEP = DELEGATION_SWEEP_MS;
const at = (n: number): number => NOW + n * STEP;
const checkpointOf = (home: string): DelegationCheckpointV1 => {
  const file = path.join(home, '.ccrc', DELEGATION_CHECKPOINT_FILE);
  expect(existsSync(file), 'the checkpoint file exists').toBe(true);
  return decodeDelegationCheckpoint(new Uint8Array(readFileSync(file)));
};

// ── the line, parsed; the virtual clock's hook ──────────────────────────────────────────────────────────────────────────

const slowLines = (warn: { mock: { calls: unknown[][] } }): string[] => warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith(PREFIX));
const parse = (line: string): Map<string, number> => new Map(line.slice(PREFIX.length).trim().split(' ').filter((p) => p !== '').map((pair) => {
  const i = pair.indexOf('=');
  return [pair.slice(0, i), Number(pair.slice(i + 1))] as const;
}));
const quietWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

interface Rig {
  /** every key the lane announced, in order (empty against code that has no `onPassPhase`) */
  fired: string[];
  /** Arms the NEXT pass: the first time each key in `adds` fires, the clock advances by its ms (a list: the n-th firing takes the n-th ms).
   *  `rewriteAfter` makes the first `project` call of the coordination store made while the last phase announced was that one advance the
   *  clock by 1,500. Clears whatever `also` and `onProject` registered for the pass before. */
  arm(adds: Record<string, number | number[]>, rewriteAfter?: 'flush' | 'repair'): void;
  /** For the armed pass: runs each `fn` at the next firings of `key` (the n-th firing runs the n-th `fn`), after that firing's clock advance. */
  also(key: string, ...fns: Array<() => void>): void;
  /** For the armed pass: runs `fn` once, inside the first `project` call of the coordination store made while `last` is the last phase. */
  onProject(last: string, fn: () => void): void;
  /** The last timed phase announced (`rewrite` and `yields` are not phases that enclose a store call, so they never count). */
  last(): string | null;
}
/** Installs the hook. The "last phase" ignores `rewrite` (the lane may announce it from inside the port's closures) and `yields` (a turn
 *  between phases: no store call is made in it, and a row that asks what phase a store call was made in means the phase). The world's
 *  default seams (virtual CPU clock and sampler) are merged under `seams` and `onPassPhase`. */
function rig(w: World, seams: Record<string, unknown> = {}): Rig {
  /** `left`: per key, one list of actions per firing still to come (the clock advance of `arm`, then whatever `also` adds to that firing). */
  const st = { last: null as string | null, left: new Map<string, Array<Array<() => void>>>(), projects: new Map<string, () => void>() };
  const fired: string[] = [];
  w.watcher.setDelegationSeams({
    ...w.defaultSeams,
    ...seams,
    onPassPhase: (k: string): void => {
      fired.push(k);
      if (k !== 'rewrite' && k !== 'yields') st.last = k;
      for (const fn of st.left.get(k)?.shift() ?? []) fn();
    },
  } as never);
  const project = w.coord.projectDelegationCheckpoint.bind(w.coord);
  w.coord.projectDelegationCheckpoint = ((cp: Parameters<CoordStore['projectDelegationCheckpoint']>[0]) => {
    const fn = st.last === null ? undefined : st.projects.get(st.last);
    if (fn !== undefined) { st.projects.delete(st.last!); fn(); }
    return project(cp);
  }) as CoordStore['projectDelegationCheckpoint'];
  const also = (key: string, ...fns: Array<() => void>): void => {
    const firings = st.left.get(key) ?? [];
    fns.forEach((fn, i) => { (firings[i] ??= []).push(fn); });
    st.left.set(key, firings);
  };
  return {
    fired,
    arm: (adds, rewriteAfter) => {
      st.left = new Map(Object.entries(adds).map(([k, v]) => [k, (Array.isArray(v) ? v : [v]).map((ms) => [() => { w.clock.t += ms; }])] as const));
      st.projects = new Map();
      if (rewriteAfter !== undefined) st.projects.set(rewriteAfter, () => { w.clock.t += 1500; });
      st.last = null;
    },
    also,
    onProject: (last, fn) => { st.projects.set(last, fn); },
    last: () => st.last,
  };
}

// ── the timing vocabulary (design: the phases, their enclosers, what `block` sums) ─────────────────────────────────────

const TOP = ['noteSessions', 'open', 'recover', 'root', 'load', 'expire', 'owners', 'flush', 'upkeep', 'prune', 'reconcile'];
const INNER = ['pre', 'readMetas', 'prep', 'build', 'pairs', 'forced', 'lostForced', 'policy', 'effects'];
const PARTS = ['attempts', 'leases', 'intervals', 'absence', 'repair'];
const TIME_KEYS = [...TOP, ...INNER, ...PARTS, 'rewrite'];
/** What `block` sums: the BLOCKING phases. Never the reads (`open recover root load owners readMetas`), `rewrite` (it overlaps its
 *  callers), `reconcile` (its parts are) or the effect parts (inside `effects`). */
const BLOCK = ['noteSessions', 'expire', 'flush', 'upkeep', 'prune', 'pre', 'prep', 'build', 'pairs', 'forced', 'lostForced', 'policy', 'effects'];
const ENCLOSERS: Record<string, string[]> = {
  ...Object.fromEntries(INNER.map((k) => [k, ['reconcile']])),
  ...Object.fromEntries(PARTS.map((k) => [k, ['effects', 'reconcile']])),
};

/** The expected state of one line: `ms` maps a phase to its elapsed time; every other phase present on the line must read 0. */
function expectTimings(lineText: string, ms: Record<string, number>): Map<string, number> {
  const m = parse(lineText);
  for (const k of Object.keys(ms)) expect(m.has(k), `${k} is on the line`).toBe(true);
  for (const k of TIME_KEYS) if (m.has(k)) expect(m.get(k), `${k} (ms)`).toBe(ms[k] ?? 0);
  const sum = (keys: string[]): number => keys.filter((k) => m.has(k)).reduce((s, k) => s + (ms[k] ?? 0), 0);
  expect(m.get('total'), 'total is the top-level phases').toBe(sum(TOP));
  expect(m.get('other'), 'nothing is unaccounted for').toBe(0);
  expect(m.get('block'), 'block sums the blocking phases only').toBe(sum(BLOCK));
  expect(m.get('cut'), 'the pass was not cut').toBe(0);
  return m;
}

// ── scenarios ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const RAW = record('demo', 'raw-tree');
const OLD = record('demo', 'old-tree');
type Shape = 'std' | 'recover' | 'absence' | 'intervals';
/** D-5836: the forced full repair's interval, reached through a namespace so the file is type-clean at main (the fallback is the ruling's hour). */
const FULL_MS = ((checkpointMod as unknown as Record<string, unknown>)['DELEGATION_REPAIR_FULL_MS'] as number | undefined) ?? 3_600_000;
type PlanFn = typeof policy.planDelegationReconciliation;
interface PlanSpy { mockImplementation(fn: (input: Parameters<PlanFn>[0]) => ReturnType<PlanFn>): unknown }
/** What a row may ask of `scenario` beyond its shape and the clock it arms. */
interface ScenarioX {
  /** Advance the virtual clock past `FULL_MS` before the armed pass (outside every phase, so no time key moves): the lane's per-pass repair
   *  then takes the FULL path, with the event counts equal (nothing is deleted, so no replay follows). */
  full?: boolean;
  /** Lane seams of the rig (over the world's defaults). */
  seams?: Record<string, unknown>;
  /** Lines appended to the owner's first bucket, before every pass. */
  spool?: string[];
  /** Further unarmed census passes before the armed one (the fixture's raw tree files its attempt in the pass that ARMS by default). */
  extra?: number;
  /** Runs before each unarmed census pass (`i` of `count`): a fault planted in an earlier pass. */
  prelude?: (i: number, count: number) => void;
  /** Runs after the pass is armed and before it runs: registers `also`/`onProject` hooks, spies, lane fields. */
  setup?: (ctx: { w: World; r: Rig; plan: PlanSpy; realPlan: typeof policy.planDelegationReconciliation }) => void;
}

/** The standard fixture: a session ran a raw `git worktree add` (the incident's case), so the third census pass requests a lease and files
 *  an attempt. `last` passes run unarmed; the next one runs armed with `adds`. Every shape appends one line to the spool before the armed
 *  pass, so its flush has a result to apply. Fixture-sanity facts are read from spies on the real code, never from the new hook. */
async function scenario(shape: Shape, adds: Record<string, number | number[]>, rewriteAfter?: 'flush' | 'repair', x: ScenarioX = {}) {
  vi.restoreAllMocks();                                               // a row may run several scenarios: none inherits a spy of the last
  const warn = quietWarn();
  const w = world();
  writeBucket(w, 'demo-a', BUCKET10,
    startLine('demo-a', '2026-10-15T10:01:00.000Z'),
    bashPre('demo-a', 'toolu_wt1', ['old-tree'], '2026-10-15T10:05:00.000Z'),
    bashPost('demo-a', 'toolu_wt1', ['old-tree', 'raw-tree'], '2026-10-15T10:05:03.000Z'), ...(x.spool ?? []));
  await primed(w);
  const r = rig(w, x.seams);
  const realPlan = policy.planDelegationReconciliation;
  const plan = vi.spyOn(policy, 'planDelegationReconciliation');
  // The policy plans no `record-observation-interval` in wave 3 (it is "a member of the union"), so that case appends one.
  if (shape === 'intervals') {
    plan.mockImplementation((input) => [...realPlan(input), {
      kind: 'record-observation-interval' as const,
      interval: { sessionId: 'demo-a', parentIncarnation: INC, utcHour: '2026-10-15T08:00:00.000Z', state: 'measured' as const, detail: null, recordedAt: '2026-10-15T09:30:00.000Z' },
    }]);
  }
  const proto = DelegationDurability.prototype;
  const spies = {
    recover: vi.spyOn(proto, 'recover'), createLease: vi.spyOn(proto, 'createLease'), repair: vi.spyOn(proto, 'repairProjection'),
    applyAccepted: vi.spyOn(proto, 'applyAccepted'), applyChange: vi.spyOn(proto, 'applyCheckpointChange'),
  };
  const lastUnarmed = (shape === 'absence' ? 4 : 2) + (x.extra ?? 0);
  for (let i = 0; i < lastUnarmed; i++) {
    x.prelude?.(i, lastUnarmed);
    await censusPass(w, at(i), shape === 'absence' && i >= 3 ? { demo: [OLD] } : { demo: [OLD, RAW] });
  }
  appendBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:06:00.000Z'));
  if (shape === 'recover') {
    // the applier is found failed at the pass's first check (once), so the lane's not-ready branch runs `recover()` (it is past the retry interval)
    vi.spyOn(proto, 'failure').mockReturnValueOnce({ code: 'journal-unreadable', detail: 'a fixture failure' } as never);
  }
  const before = {
    plan: plan.mock.calls.length, recover: spies.recover.mock.calls.length, createLease: spies.createLease.mock.calls.length,
    repair: spies.repair.mock.calls.length, applyAccepted: spies.applyAccepted.mock.calls.length, applyChange: spies.applyChange.mock.calls.length,
  };
  if (x.full === true) w.clock.t += FULL_MS + 1;
  r.arm(adds, rewriteAfter);
  x.setup?.({ w, r, plan: plan as never, realPlan });
  const armedFrom = r.fired.length;
  await censusPass(w, at(lastUnarmed), shape === 'absence' ? { demo: [OLD] } : { demo: [OLD, RAW] });
  const kinds = (plan.mock.results.at(-1)!.value as ReturnType<typeof policy.planDelegationReconciliation>).map((e) => e.kind);
  return {
    w, warn, kinds, r, spies, plan, realPlan, before, proto,
    /** the phases and turns the armed pass announced (a cut pass may announce more after the call returns) */
    armed: (): string[] => r.fired.slice(armedFrom),
    reconciles: plan.mock.calls.length - before.plan,
    recovered: spies.recover.mock.calls.length - before.recover,
    leasesCreated: spies.createLease.mock.calls.length - before.createLease,
    repairs: spies.repair.mock.calls.length - before.repair,
    intervalCalls: spies.applyAccepted.mock.calls.slice(before.applyAccepted).filter(([b]) => b.interval !== undefined && b.accepted.length === 0),
    lines: slowLines(warn),
  };
}

/** The sanity every R3 row reads BEFORE its red assertion: the pass really reached the code the phase wraps. */
function expectReached(key: string, sc: Awaited<ReturnType<typeof scenario>>): void {
  expect(sc.reconciles, 'the armed pass reconciled once').toBe(1);
  if (key === 'recover') expect(sc.recovered, 'the not-ready branch ran recover()').toBe(1);
  else expect(sc.recovered).toBe(0);
  if (key === 'attempts') expect(sc.kinds, 'a lease request files an attempt').toContain('request-linked-lease-identity');
  if (key === 'leases') expect(sc.leasesCreated, 'a lease was journaled').toBeGreaterThanOrEqual(1);
  if (key === 'absence') expect(sc.kinds, 'a measured absence was planned').toContain('record-measured-absence');
  if (key === 'intervals') {
    expect(sc.kinds).toContain('record-observation-interval');
    expect(sc.intervalCalls, 'the interval effect reached the applier').toHaveLength(1);
  }
  if (key === 'repair') {
    expect(sc.kinds).toContain('repair-report-projection');
    expect(sc.repairs, 'the projection was repaired').toBe(1);
  }
}

// ── R1 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('D-5692 R1: a full pass writes one line whose keys are what ran and whose sizes are what the pass held', () => {
  /** A 16-character agent ID, `n` apart. */
  const agentId = (n: number): string => `a1b2c3d4e5f6${(0x1000 + n).toString(16)}`;
  const tdir = (w: World): string => path.join(w.home, '.claude-fix', 'projects', '-demo');
  const wtOf = (name: string): string => `/w/demo/.claude/worktrees/${name}`;
  const agentStart = (w: World, agent: string, at: string): string =>
    lineOf(common('demo-a', { eventKind: 'SubagentStart', agentId: agent, agentType: null, cwd: '/w/demo', transcriptPath: path.join(tdir(w), `${CLAUDE}.jsonl`) }, at));
  const treeOfAgent = (agent: string): DelegationCensusRecord => record('demo', `agent-${agent}`, { canonicalPath: wtOf(`agent-${agent}`) });
  const WITH_META = [1, 2, 3].map(agentId);                                // linked at rung 2: their metas are on disk
  const NO_META = [4, 5].map(agentId);                         // no meta: unmeasured
  const SCRATCHES = [1, 2, 3, 4].map((i) => record('demo', `scratch-tree-${i}`));   // each: a parent whose own cwd is in it, and a subagent working there
  const LATE = [1, 2, 3, 4, 5].map((i) => record('demo', `late-${i}`));    // first listed by the armed pass: inside the birth wait
  const OTHER = [record('other', 'x-one'), record('other', 'x-two')];
  /** A parent whose own cwd is in scratch tree `n`, a subagent of it, and that subagent's bash call working there (an unowned-worktree attempt). */
  const scratchLines = (owner: string, n: number): string[] => [
    lineOf(common(owner, { eventKind: 'SessionStart', source: 'startup', cwd: SCRATCHES[n - 1]!.canonicalPath }, '2026-10-15T10:01:30.000Z')),
    lineOf(common(owner, { eventKind: 'SubagentStart', agentId: `ag${n}`, agentType: null, cwd: '/w/demo' }, '2026-10-15T10:02:50.000Z')),
    lineOf(common(owner, { eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_s${n}`, outcome: 'completed', agentId: `ag${n}`, cwd: SCRATCHES[n - 1]!.canonicalPath }, '2026-10-15T10:03:00.000Z')),
  ];
  const OWNERS = ['demo-a', 'demo-b', 'demo-c', 'demo-d', 'demo-e', 'demo-f', 'demo-g'];       // with a spool directory
  const SESSIONS = [...OWNERS, 'demo-h', 'demo-i', 'demo-j', 'demo-k', 'demo-l', 'demo-p'].map((id) => sessionOf(id));    // the last six have none

  it('D-5692 R1: one line; pairs=1500 and reconcile=1500; the key set is the phases that ran; every size equals its independent count', async () => {
    const warn = quietWarn();
    const w = world();
    for (const owner of OWNERS) writeBucket(w, owner, BUCKET10, startLine(owner, '2026-10-15T10:01:00.000Z'));
    // demo-b and demo-c also have a bucket of the hour before: a second cursor (and a second observed hour) for each
    for (const o of ['demo-b', 'demo-c']) writeBucket(w, o, BUCKET09, startLine(o, '2026-10-15T09:50:00.000Z'));
    for (const id of WITH_META) {
      mkdirSync(path.join(tdir(w), CLAUDE, 'subagents'), { recursive: true });
      writeFileSync(path.join(tdir(w), CLAUDE, 'subagents', `agent-${id}.meta.json`), JSON.stringify({ worktreePath: wtOf(`agent-${id}`) }));
    }
    await primed(w);
    const r = rig(w);

    // The independent sources: spies that call through. The policy spy drops the repair effect the policy plans in every reconcile that
    // reaches it, so this pass plans no repair and its upkeep changes nothing (asserted below).
    const realPlan = policy.planDelegationReconciliation;
    const plan = vi.spyOn(policy, 'planDelegationReconciliation').mockImplementation((input) => realPlan(input).filter((e) => e.kind !== 'repair-report-projection'));
    const corr = vi.spyOn(correlation, 'correlateDelegation');
    const markForced = vi.spyOn(correlation, 'delegationMarkForced');
    const windowForced = vi.spyOn(correlation, 'delegationUnknownWindowForced');
    const lostForced = vi.spyOn(correlation, 'delegationLostEvidenceForced');
    const upkeep = vi.spyOn(model, 'upkeepDelegationIntervals');
    const batch = vi.spyOn(DelegationDurability.prototype, 'applyAcceptedBatch');
    const repair = vi.spyOn(DelegationDurability.prototype, 'repairProjection');
    const change = vi.spyOn(DelegationDurability.prototype, 'applyCheckpointChange');
    const projected = vi.spyOn(w.coord, 'projectDelegationCheckpoint');
    const inserted = vi.spyOn(w.coord, 'insertDelegationEvents');

    const demo = [OLD, RAW, ...SCRATCHES, ...[...WITH_META, ...NO_META].map(treeOfAgent)];
    const view = { demo, other: OTHER };
    await censusPass(w, at(0), view, SESSIONS);
    await censusPass(w, at(1), view, SESSIONS);

    // What arrives before the armed pass: a creator's bash pair (rung 4); every agent's start (the first two have a meta on disk, the rest
    // none); a parent working inside a scratch tree (an unowned-worktree attempt); and unrelated bash pairs of two more owners.
    const second = (i: number): string => String(10 + i).padStart(2, '0');   // 10 + i seconds
    appendBucket(w, 'demo-a', BUCKET10,
      ...[...WITH_META, ...NO_META].map((id, i) => agentStart(w, id, `2026-10-15T10:02:${second(i)}.000Z`)),
      bashPre('demo-a', 'toolu_wt1', ['old-tree'], '2026-10-15T10:05:00.000Z'), bashPost('demo-a', 'toolu_wt1', ['old-tree', 'raw-tree'], '2026-10-15T10:05:03.000Z'),
      ...scratchLines(OWNERS[0]!, 1));
    for (const [i, owner] of OWNERS.slice(1, SCRATCHES.length).entries()) appendBucket(w, owner, BUCKET10, ...scratchLines(owner, i + 2));
    // demo-b gets one more start; demo-c and demo-d each run a series of unrelated bash calls (five and six), long after the creator's
    appendBucket(w, 'demo-b', BUCKET10, startLine('demo-b', '2026-10-15T10:08:00.000Z'));
    for (const [owner, minute, count] of [['demo-c', 12, 5], ['demo-d', 14, 6]] as const) {
      for (let i = 0; i < count; i++) {
        appendBucket(w, owner, BUCKET10,
          bashPre(owner, `toolu_${owner}_${i}`, ['old-tree'], `2026-10-15T10:${minute}:${second(i * 5)}.000Z`),
          bashPost(owner, `toolu_${owner}_${i}`, ['old-tree'], `2026-10-15T10:${minute}:${second(i * 5 + 2)}.000Z`));
      }
    }

    const base = {
      plan: plan.mock.calls.length, corr: corr.mock.calls.length, mark: markForced.mock.calls.length, win: windowForced.mock.calls.length,
      lost: lostForced.mock.calls.length, upkeep: upkeep.mock.results.length, batch: batch.mock.calls.length, repair: repair.mock.calls.length,
      projected: projected.mock.calls.length, inserted: inserted.mock.calls.length, change: change.mock.calls.length,
    };
    r.arm({ pairs: 1500 });
    // the armed pass lists `other` as unlistable (its view is null) and five late trees; its census was measured 7 s before it
    const AGE = 7000;
    await censusPass(w, at(2), { demo: [...demo, ...LATE], other: null }, SESSIONS, AGE);

    // ── fixture sanity, read from the real code: the pass reconciled once, planned what the row says it plans, and changed nothing in upkeep
    expect(plan.mock.calls.length - base.plan, 'one reconcile').toBe(1);
    const effects = plan.mock.results.at(-1)!.value as ReturnType<typeof policy.planDelegationReconciliation>;
    const kinds = effects.map((e) => e.kind);
    expect(kinds, 'no repair effect is planned').not.toContain('repair-report-projection');
    expect(kinds, 'a lease request and an unowned attempt are planned').toEqual(expect.arrayContaining(['request-linked-lease-identity', 'record-unowned-worktree']));
    expect(repair.mock.calls.length - base.repair, 'no projection repair ran').toBe(0);
    expect(upkeep.mock.results.slice(base.upkeep).every((x) => (x.value as { changed: boolean }).changed === false), 'the upkeep changes nothing').toBe(true);
    const corrInputs = corr.mock.calls.slice(base.corr).map(([i]) => i);
    const verdicts = corr.mock.results.slice(base.corr).map((x) => (x.value as { kind: string }).kind);
    expect(corrInputs.length, 'correlation ran for every tree').toBeGreaterThan(0);
    const lastInput = corrInputs.at(-1)!;

    // the independent counts
    const batches = batch.mock.calls.slice(base.batch);
    const outs = await Promise.all(batch.mock.results.slice(base.batch).map((x) => x.value as Promise<{ appended: unknown[] }>));
    const byKind = (kind: string): number => verdicts.filter((v) => v === kind).length;
    const effectsOf = (kind: string): number => kinds.filter((k) => k === kind).length;
    const cp = checkpointOf(w.home);
    const report = w.watcher.delegationReport();
    const windows = lastInput.listingWindows;
    const expected: Record<string, number> = {
      // from the fixture's construction: thirteen sessions have a census incarnation, none is dead, none is pending
      ownerCount: SESSIONS.length,
      // the applier's own calls: the buckets that had something new, and the records those calls appended
      staged: batches.reduce((s, [b]) => s + b.length, 0),
      appended: outs.reduce((s, o) => s + o.appended.length, 0),
      // the policy's input: the census trees; those past the two-pass birth wait are the ones listed from the first census on
      trees: (plan.mock.calls.at(-1)![0].census as unknown[]).length,
      treesPastWait: demo.length,
      // from the fixture: every agent names a transcript (claimants), no Workflow launch was journaled
      claimants: WITH_META.length + NO_META.length,
      launches: 0,
      droppedKeys: 0,                                                   // nothing was evicted (the evidence cap is untouched)
      // correlation's own inputs
      evidence: lastInput.acceptedEvidence.length,
      activities: lastInput.activities.length,
      pointMetas: lastInput.pointMetas.length,
      // the attribution map: every census path and the two remembered paths of the project whose view is null
      pathMap: demo.length + LATE.length + OTHER.length,
      win: windows.length,
      winLost: windows.filter((x) => x.lost === true).length,
      winHeld: windows.filter((x) => x.lost !== true).length,
      winHeldNull: windows.filter((x) => x.lost !== true && x.repository === null).length,
      // the number of calls each function really received
      ladder: corrInputs.length,
      markCalls: markForced.mock.calls.length - base.mark,
      windowCalls: windowForced.mock.calls.length - base.win,
      lostCalls: lostForced.mock.calls.length - base.lost,
      // the verdicts by kind, and the effects by kind, as correlation and policy returned them
      vLinked: byKind('linked'), vRunChild: byKind('run-child-owned'), vUnresolved: byKind('unresolved'), vConflicting: byKind('conflicting'), vUnmeasured: byKind('unmeasured'),
      eLease: effectsOf('request-linked-lease-identity'), eRunChild: effectsOf('record-run-child-owned'), eUnowned: effectsOf('record-unowned-worktree'),
      eAbsence: effectsOf('record-measured-absence'), eRepair: effectsOf('repair-report-projection'), eInterval: effectsOf('record-observation-interval'),
      // the coordination store's own calls
      rewrites: projected.mock.calls.length - base.projected,
      rewriteEvents: inserted.mock.calls.slice(base.inserted).reduce((s, [rows]) => s + rows.length, 0),
      // the checkpoint on disk after the pass
      cpSessions: cp.sessions.length, cpAttempts: cp.attempts.length, cpLeases: cp.leases.length, openLeases: cp.leases.filter((l) => l.releasedAt === null).length,
      cpLineage: cp.lineage.length, cpIntervals: cp.observationIntervals.length, cpCursors: cp.bucketCursors.length,
      // D-5832 (run 645): the virtual CPU clock and sampler read 0 in this pass (nothing sets them), so every CPU and stall key is present
      // and 0; the flush, upkeep, effects, reconcile and owners phases ran, the repair did not (the policy spy filters it), so there is no
      // `repairCpu`, no `stallRepair`, no `repairRewrite` and no `repairSkipped`; the stretch opened after turn 1 (`stallMid`; the flush's own was
      // closed by turn 1's read) is the one open at the line, so `stallMid` is the line's read; the pass took its turns (0 ms on the virtual clock), so `yields` is present and 0.
      blockCpu: 0, flushCpu: 0, upkeepCpu: 0, effectsCpu: 0, reconcileCpu: 0, ownersCpu: 0, cpuThread: 0,
      stallMax: 0, stallP99: 0, stallFlush: 0, stallMid: 0, yields: 0,
      // the checkpoint's own counts; `attemptsSkipped` is 1 when the pass made no checkpoint change at all (upkeep changed nothing, asserted
      // above, so every change this pass made came from the attempts part) and 0 when it made one
      cpActivities: cp.activities.length, cpMapping: Object.keys(cp.activityIdsByNaturalKey).length,
      attemptsSkipped: change.mock.calls.length - base.change === 0 ? 1 : 0,
      // the lane's own report
      markPaths: report.marks.paths, markIds: report.marks.ids, lostProjects: report.marks.lostProjects.length, lostPrefixes: report.marks.lostPrefixes,
      lossy: report.marks.lossy ? 1 : 0, droppedMeasured: report.droppedEvidence.measured ? 1 : 0,
      // nothing was left unread; the census was measured 7 s before the pass
      pendingOwners: 0,
      censusAge: AGE,
    };

    // ── the red assertions: one line, and its contents
    const lines = slowLines(warn);
    expect(lines, 'one slow line is written').toHaveLength(1);
    const m = parse(lines[0]!);
    for (const [key, value] of Object.entries(expected)) expect(m.get(key), `${key}`).toBe(value);

    // the key set is exactly what ran: the derived keys, the phases (no `recover`, `intervals`, `absence` or `repair`: they did not run),
    // and every size (the five `repair*` sizes are absent: no repair report came back)
    const phases = ['noteSessions', 'open', 'root', 'load', 'expire', 'owners', 'flush', 'upkeep', 'prune', 'reconcile',
      'pre', 'readMetas', 'prep', 'build', 'pairs', 'forced', 'lostForced', 'policy', 'effects', 'attempts', 'leases', 'rewrite'];
    expect([...m.keys()].sort()).toEqual(['block', 'cut', 'total', 'other', ...phases, ...Object.keys(expected)].sort());

    // the times: 1,500 in pairs, enclosed by reconcile; everything else ran in 0 ms
    expectTimings(lines[0]!, { pairs: 1500, reconcile: 1500 });
    expect(m.get('rewrite'), 'the port\'s rewrite ran in 0 ms and is present').toBe(0);
    expect(r.fired, 'the lane announced its phases').toContain('pairs');

    // The sizes this fixture can tell apart are pairwise different and not zero, so a swap of any two of them shows. The values: ownerCount
    // 13, evidence 41, appended 42, trees 16, treesPastWait 11, claimants 5, activities 21, pointMetas 3, pathMap 18, win 14, winHeld 12,
    // vUnresolved 10, cpSessions 7, cpAttempts 8, cpIntervals 15, cpCursors 9, rewrites 6, censusAge 7000, and the two representatives of
    // the tied groups below, vLinked 4 and vUnmeasured 2, and droppedMeasured, a flag, 1. The fixture untied what a modest change could
    // (more agents, a fourth scratch tree, a second hour of spool for two owners, three more sessions): every size in this list is
    // different from every other.
    const distinct = ['ownerCount', 'evidence', 'appended', 'trees', 'treesPastWait', 'claimants', 'activities', 'pointMetas', 'pathMap', 'win',
      'winHeld', 'vUnresolved', 'cpSessions', 'cpAttempts', 'cpIntervals', 'cpCursors', 'rewrites', 'censusAge', 'vLinked', 'vUnmeasured', 'droppedMeasured'];
    for (const key of distinct) expect(expected[key], `${key} is not zero`).toBeGreaterThan(0);
    expect(new Set(distinct.map((k) => expected[k])).size, `the sizes ${distinct.join(' ')} are pairwise different`).toBe(distinct.length);
    // Equal BY CONSTRUCTION, so each group is represented once above: `trees = ladder = markCalls` (one correlation call and one mark
    // question per census tree); `vLinked = eLease = cpLeases = openLeases = cpLineage` (every link requests a lease, each with its lineage
    // row); `vUnmeasured = lostCalls` (asked once per unmeasured tree no lease holds); `appended = rewriteEvents` (the records the pass
    // journaled are the rows it projected).
    // Equal by COINCIDENCE, which a modest change of the fixture did not remove (any change that moved one of them put another on a
    // neighbour; measured over several hundred fixture shapes, none was free of ties), so a swap inside the group is NOT shown by this
    // row: `winLost` (always the two floor windows: the retention floor and the not-ready stretch) with `vUnmeasured` (2), and `staged`
    // (the four owners with something new) with `vLinked` and `eUnowned` (4). Each still equals its own independent count above.
    // Sizes this fixture leaves 0, and where each is not zero instead: `launches` (no Workflow launch), `winHeldNull` and `windowCalls`
    // (every Bash window names a registered session; the next row makes one unknown), `droppedKeys`, `markPaths`, `markIds`, `lostProjects`,
    // `lostPrefixes`, `lossy` (nothing was evicted or marked; the marks row after it makes the lane forget), `eRepair` (the policy spy
    // filters it; the repair row has it run), `vRunChild` and `eRunChild` (the lane has no datum that names a run's child: always 0),
    // `vConflicting`, `eAbsence`, `eInterval` (R3 runs the shapes that plan them), `pendingOwners` (nothing stayed unread; the lane's own
    // report does not expose it).
  });
});

describe('D-5692 R1 (an unknown-repository window): the window sizes and the window question are counted', () => {
  it('D-5692 R1: a held window of a session no registry row names counts in winHeldNull, and the lane asks the unknown-window question of each tree', async () => {
    const warn = quietWarn();
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10,
      startLine('demo-a', '2026-10-15T10:01:00.000Z'),
      bashPre('demo-a', 'toolu_wt1', ['old-tree'], '2026-10-15T10:05:00.000Z'),
      bashPost('demo-a', 'toolu_wt1', ['old-tree', 'raw-tree'], '2026-10-15T10:05:03.000Z'));
    // demo-b ran an unrelated call a quarter of an hour later; it is in the evidence, and then its registry row goes (a reclaimed child):
    // the lane keeps its window with an UNKNOWN repository
    writeBucket(w, 'demo-b', BUCKET10, startLine('demo-b', '2026-10-15T10:19:00.000Z'),
      bashPre('demo-b', 'toolu_b1', ['old-tree'], '2026-10-15T10:20:00.000Z'), bashPost('demo-b', 'toolu_b1', ['old-tree'], '2026-10-15T10:20:02.000Z'));
    await primed(w);
    const corr = vi.spyOn(correlation, 'correlateDelegation');
    const windowForced = vi.spyOn(correlation, 'delegationUnknownWindowForced');
    const both = [sessionOf('demo-a'), sessionOf('demo-b')];
    await censusPass(w, at(0), { demo: [OLD, RAW] }, both);
    await censusPass(w, at(1), { demo: [OLD, RAW] }, both);
    // A RESTART over the same home: the new lane knows a session only by what it has been handed since, and it is handed demo-a alone, so
    // demo-b's window (read back from the journal) has an UNKNOWN repository. An unarmed pass first sets its ready instant.
    await w.watcher.closeDelegation();
    const again = world({ home: w.home });
    const r = rig(again);
    await censusPass(again, at(2), { demo: [OLD, RAW] }, DEMO_A);
    const base = { corr: corr.mock.calls.length, win: windowForced.mock.calls.length };
    r.arm({ noteSessions: 1001 });
    await censusPass(again, at(3), { demo: [OLD, RAW] }, DEMO_A, 0);
    const input = corr.mock.calls.slice(base.corr).at(-1)![0];
    const unknown = input.listingWindows.filter((x) => x.lost !== true && x.repository === null);
    expect(unknown, 'the fixture holds one window of unknown repository').toHaveLength(1);
    const asked = windowForced.mock.calls.length - base.win;
    expect(asked, 'the unknown-window question was asked of the trees').toBeGreaterThan(0);

    const lines = slowLines(warn);
    expect(lines, 'one slow line is written').toHaveLength(1);
    const m = parse(lines[0]!);
    expect(m.get('winHeldNull')).toBe(unknown.length);
    expect(m.get('windowCalls')).toBe(asked);
    expect(m.get('winHeld')).toBe(input.listingWindows.filter((x) => x.lost !== true).length);
    expect(m.get('win')).toBe(input.listingWindows.length);
  });
});

describe('D-5692 R1 (a repair report): the six repair sizes are the repair\'s own report, and absent when no report came back', () => {
  const OWNERS_R = ['demo-a', 'demo-b', 'demo-c', 'demo-d', 'demo-e'];
  /** Five owners with a spool, two unarmed census passes (each repairs a healthy projection: a report of zeros), then the rig. */
  async function repairWorld() {
    const warn = quietWarn();
    const w = world();
    for (const owner of OWNERS_R) writeBucket(w, owner, BUCKET10, startLine(owner, '2026-10-15T10:01:00.000Z'));
    await primed(w);
    const r = rig(w);
    const repair = vi.spyOn(DelegationDurability.prototype, 'repairProjection');
    const sessions = OWNERS_R.map((id) => sessionOf(id));
    const view = { demo: [OLD, RAW] };
    await censusPass(w, at(0), view, sessions);
    await censusPass(w, at(1), view, sessions);
    return { warn, w, r, repair, sessions, view, base: repair.mock.calls.length };
  }
  // D-5832: `repairSkipped` is a sixth size of the same report: absent with no report, 1 only when the report says the short path ran
  const sizeKeys = ['repairPasses', 'repairInserted', 'repairFull', 'repairWiped', 'repairHealed', 'repairSkipped'];

  it('D-5692 R1: after SQLite drifts (an event missing, three sessions\' events altered) the repair\'s report is on the line: passes 2, healed 3, inserted 4, a full replay and no wipe', async () => {
    const { warn, w, r, repair, sessions, view, base } = await repairWorld();
    // The drift, made in the coordination store's own tables: one event deleted from the middle (SQLite's count then disagrees with the
    // journal's below its resume point: every event is replayed, one pass), and the events of three other sessions altered (the replay
    // meets a different row under the same id: a conflict, so those sessions are deleted and replayed from the journal: a second pass).
    const db = w.coord.db;
    const eventOf = (owner: string): number => (db.prepare('SELECT MIN(journalSequence) AS m FROM delegation_events WHERE sessionId = ?').get(owner) as { m: number }).m;
    db.prepare('DELETE FROM delegation_events WHERE journalSequence = ?').run(eventOf('demo-d'));
    for (const owner of ['demo-a', 'demo-b', 'demo-c']) {
      expect(db.prepare("UPDATE delegation_events SET payloadJson = payloadJson || ' ' WHERE journalSequence = ?").run(eventOf(owner)).changes, `${owner}'s event altered`).toBe(1);
    }
    r.arm({ noteSessions: 1001 });
    await censusPass(w, at(2), view, sessions);
    expect(repair.mock.calls.length - base, 'the pass repaired once').toBe(1);
    const report = (await repair.mock.results.at(-1)!.value) as DelegationProjectionRepairReport;
    // the report this fixture draws: what the repair did, read from the real code, before the line is looked at
    expect(report.fullReplay, 'a full replay (the count below the resume point disagreed)').toBe(true);
    expect(report.wipedAll, 'no wipe (every conflict was healed)').toBe(false);
    expect([report.journalPasses, report.healedSessions, report.inserted], 'passes, healed and inserted are three different numbers').toEqual([2, 3, 4]);

    const lines = slowLines(warn);
    expect(lines, 'one slow line is written').toHaveLength(1);
    const m = parse(lines[0]!);
    expect(m.get('repairPasses')).toBe(report.journalPasses);
    expect(m.get('repairInserted')).toBe(report.inserted);
    expect(m.get('repairFull')).toBe(report.fullReplay ? 1 : 0);
    expect(m.get('repairWiped')).toBe(report.wipedAll ? 1 : 0);
    expect(m.get('repairHealed')).toBe(report.healedSessions);
    // the deleted event makes the counts disagree, so the lane's per-pass repair takes the full path: it was not skipped
    expect(m.get('repairSkipped'), 'a repair that replayed the journal was not skipped').toBe(0);
    // `repairRewrite` mirrors `rewrite`: present iff a port call was charged while the repair part was open. The full path made several.
    expect(m.has('repairRewrite'), 'the repair made port calls, so repairRewrite is on the line').toBe(true);
    expect(m.get('repairRewrite')!, 'and it is a share of the pass\'s rewrite').toBeLessThanOrEqual(m.get('rewrite')!);
    expect(m.has('repair'), 'the repair phase ran').toBe(true);
  });

  it.each([
    { title: 'a null report', arrange: (repair: { mockResolvedValueOnce(v: null): unknown }) => { repair.mockResolvedValueOnce(null); } },
    { title: 'a repair that throws', arrange: (repair: { mockRejectedValueOnce(v: Error): unknown }) => { repair.mockRejectedValueOnce(new Error('a fixture failure')); } },
  ])('D-5692 R1: $title leaves all six repair sizes off the line, while the repair phase is on it', async ({ arrange }) => {
    const { warn, w, r, repair, sessions, view, base } = await repairWorld();
    (arrange as (r: unknown) => void)(repair);
    r.arm({ noteSessions: 1001 });
    await censusPass(w, at(2), view, sessions);
    expect(repair.mock.calls.length - base, 'the pass called repairProjection once').toBe(1);
    const lines = slowLines(warn);
    expect(lines, 'one slow line is written').toHaveLength(1);
    const m = parse(lines[0]!);
    expect(m.has('repair'), 'the repair phase ran').toBe(true);
    expect(sizeKeys.filter((k) => m.has(k)), 'no repair size is on the line').toEqual([]);
    // `repairRewrite` mirrors `rewrite`'s rule (present iff a port call was charged while the part was open): the repair part ran here but made
    // no port call (the report is null, or the call threw before any), so it is absent although `repair` is present
    expect(m.has('repairRewrite'), 'no port call was charged to the repair part').toBe(false);
  });
});

describe('D-5692 R1 (marks and dropped evidence): the lane\'s own mark counts are on the line as the lane reports them', () => {
  const toolAt = (owner: string, n: number, cwd: string, when: string, agentId?: string): string =>
    lineOf(common(owner, { eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_${n}`, outcome: 'completed', cwd, ...(agentId === undefined ? {} : { agentId }) }, when));
  const AGENTS = [1, 2, 3].map((i) => `a1b2c3d4e5f6000${i}`);
  /** The seams that drive the lane's forgetting, as `delegation-watch.test.ts` drives them: the evidence slice holds 3 events (the oldest are
   *  dropped), the dropped keys are pruned into marks once 6 have been collected (so the last pass's four stay as keys), and `markCap` is
   *  the mark set's bound. `rig` merges them with its own `onPassPhase` hook (the seams object is replaced whole). */
  const SEAMS = { evidenceCap: 3, droppedPruneEvery: 6 };
  /** Three passes. Pass 0: demo's three directories, three agents' bare events (an id names no project) and other's two: five events are
   *  dropped, not yet pruned. Pass 1: three more of other's evict three more: the eight keys are pruned into marks. Pass 2 (the armed one):
   *  four more evict four, which stay keys. */
  async function marked(markCap: number) {
    const warn = quietWarn();
    const w = world();
    const root = w.cfg.projectsRoot;
    const sessions = [sessionOf('demo-a'), sessionOf('other-s', 'idle', 'other'), sessionOf('demo-b')];
    writeBucket(w, 'demo-a', BUCKET10, ...Array.from({ length: 3 }, (_, i) => toolAt('demo-a', 400 + i, `${root}/demo/far-${i}`, `2026-10-15T10:00:0${i + 1}.000Z`)));
    writeBucket(w, 'demo-b', BUCKET10, ...AGENTS.map((id, i) => toolAt('demo-b', 600 + i, `${root}/demo/b-dir-${i}`, `2026-10-15T10:00:00.${i}00Z`, id)));
    writeBucket(w, 'other-s', BUCKET10, toolAt('other-s', 500, `${root}/other/o-0`, '2026-10-15T10:00:30.000Z'), toolAt('other-s', 501, `${root}/other/o-1`, '2026-10-15T10:00:31.000Z'));
    const r = rig(w, { ...SEAMS, markCap });
    const view = { demo: [OLD, RAW], other: [] };
    await censusPass(w, at(0), view, sessions);
    appendBucket(w, 'other-s', BUCKET10, ...[2, 3, 4].map((i) => toolAt('other-s', 500 + i, `${root}/other/o-${i}`, `2026-10-15T10:00:3${i}.000Z`)));
    await censusPass(w, at(1), view, sessions);
    expect(slowLines(warn), 'nothing was slow before the armed pass').toEqual([]);
    appendBucket(w, 'other-s', BUCKET10, ...[0, 1, 2, 3].map((i) => toolAt('other-s', 510 + i, `${root}/other/o-9${i}`, `2026-10-15T10:00:5${i}.000Z`)));
    r.arm({ noteSessions: 1001 });
    await censusPass(w, at(2), view, sessions);
    const report = w.watcher.delegationReport();
    const lines = slowLines(warn);
    expect(lines, 'one slow line is written').toHaveLength(1);
    return { m: parse(lines[0]!), report };
  }
  const cases = [
    // markCap, then what the lane holds: paths, ids, keys, lost projects, lost prefixes, lossy
    { cap: 6, held: { markPaths: 2, markIds: 3, droppedKeys: 4, lostProjects: 1, lostPrefixes: 1, lossy: 0 }, why: 'demo is the biggest project at the cap and is lost; its prefix covers its marks' },
    { cap: 100, held: { markPaths: 8, markIds: 3, droppedKeys: 4, lostProjects: 0, lostPrefixes: 0, lossy: 0 }, why: 'a cap nothing reaches: every path is kept as a mark and no project is lost' },
    { cap: 2, held: { markPaths: 2, markIds: 2, droppedKeys: 4, lostProjects: 1, lostPrefixes: 1, lossy: 1 }, why: 'a cap the id marks overflow: the one global flag rises' },
  ];
  it.each(cases)('D-5692 R1: at markCap $cap ($why) the mark, id, lost-project, lost-prefix, flag and dropped-key sizes are the lane\'s report', async ({ cap, held }) => {
    const { m, report } = await marked(cap);
    // the lane's own report, read independently of the line (the fixture's constants are asserted too, so a drifting fixture is seen at once)
    const fromReport = {
      markPaths: report.marks.paths, markIds: report.marks.ids, droppedKeys: report.droppedEvidence.keys,
      lostProjects: report.marks.lostProjects.length, lostPrefixes: report.marks.lostPrefixes, lossy: report.marks.lossy ? 1 : 0,
    };
    expect(fromReport, 'what the fixture draws').toEqual(held);
    for (const [key, value] of Object.entries(fromReport)) expect(m.get(key), key).toBe(value);
    expect(m.get('droppedMeasured'), 'the dropped evidence is measured').toBe(report.droppedEvidence.measured ? 1 : 0);
    expect(m.get('pendingOwners')).toBe(0);
  });

  it('D-5692 R1: where the fixture can tell them apart the sizes are pairwise different, so a swap of any two shows (markCap 6: paths 2, ids 3, keys 4, one lost project)', async () => {
    const { m } = await marked(6);
    // `lostPrefixes` is left out: it is one per lost project here (one attributing prefix), so it equals `lostProjects` by construction
    const keys = ['markPaths', 'markIds', 'droppedKeys', 'lostProjects'];
    expect(keys.map((k) => m.get(k))).toEqual([2, 3, 4, 1]);
    expect(new Set(keys.map((k) => m.get(k))).size, 'pairwise different').toBe(keys.length);
  });
});

// ── R2 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('D-5692 R2: strictly more than 1,000 ms of BLOCKING time writes the line; the read phases do not count', () => {
  it('D-5692 R2 (i): a block of exactly 1,000 ms writes no line, and one millisecond more writes one', async () => {
    const exact = await scenario('std', { noteSessions: 600, pairs: 400 });          // 1,000 ms over two blocking phases
    expect(exact.reconciles, 'the pass reconciled').toBe(1);
    expect(exact.lines, 'exactly 1,000 ms is not slow').toEqual([]);
    const over = await scenario('std', { noteSessions: 601, pairs: 400 });
    expect(over.reconciles).toBe(1);
    expect(over.lines, 'one more millisecond is').toHaveLength(1);
    const m = expectTimings(over.lines[0]!, { noteSessions: 601, pairs: 400, reconcile: 400 });
    expect(m.get('block')).toBe(1001);
  });

  // Every READ phase, each with the fixture R3 uses for it. A read waits on the fleet, not on the lane: it is not blocking.
  const READS: Array<{ key: string; shape: Shape }> = ['open', 'recover', 'root', 'load', 'owners', 'readMetas'].map((key) => ({ key, shape: key === 'recover' ? 'recover' : 'std' }));
  it.each(READS)('D-5692 R2 (ii): $key alone takes 1,500 ms (a read wait) and writes no line; with 1,001 ms of blocking beside it, the line reads the wait but blocks only on the 1,001', async ({ key, shape }) => {
    const reads = await scenario(shape, { [key]: 1500 });
    expectReached(key, reads);
    expect(reads.lines, `${key}: a read wait is not blocking`).toEqual([]);
    const both = await scenario(shape, { [key]: 1500, noteSessions: 1001 });
    expectReached(key, both);
    expect(both.lines, 'the blocking time alone decides').toHaveLength(1);
    const ms: Record<string, number> = { [key]: 1500, noteSessions: 1001 };
    for (const k of ENCLOSERS[key] ?? []) ms[k] = 1500;
    const m = expectTimings(both.lines[0]!, ms);
    expect(m.get('block'), `${key} is not summed into block`).toBe(1001);
    expect(m.get('total')).toBe(2501);
  });
});

// ── R3 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('D-5692 R3: 1,500 ms inside a phase or part is that phase\'s, its enclosers\', and no other\'s', () => {
  interface Case { key: string; shape: Shape; rewriteAfter?: 'flush' | 'repair'; title: string }
  const cases: Case[] = [
    ...[...TOP.filter((k) => k !== 'recover'), 'recover', ...INNER, 'attempts', 'leases', 'intervals', 'absence', 'repair'].map((key): Case => ({
      key, title: key, shape: key === 'recover' ? 'recover' : key === 'intervals' ? 'intervals' : key === 'absence' ? 'absence' : 'std',
    })),
    { key: 'rewrite', title: 'rewrite from the flush', shape: 'std', rewriteAfter: 'flush' },
    { key: 'rewrite', title: 'rewrite from the repair', shape: 'std', rewriteAfter: 'repair' },
  ];
  it.each(cases)('D-5692 R3: $title', async ({ key, shape, rewriteAfter }) => {
    // The read phases are not blocking: every case but noteSessions' own puts 1,001 ms in noteSessions (a top-level blocking phase that
    // encloses nothing) so that the line is written at all. A rewrite is timed from inside the port's `project`: no hook advances it.
    const tested = key === 'noteSessions';
    const adds: Record<string, number> = tested ? { noteSessions: 1500 } : rewriteAfter === undefined ? { [key]: 1500, noteSessions: 1001 } : { noteSessions: 1001 };
    // The repair's rewrite is the FULL repair's (D-5836: the lane's per-pass repair skips its rewrite when the projection is known current,
    // so it makes no `project` call then): the forced-full clock is advanced past `DELEGATION_REPAIR_FULL_MS` before the armed pass, outside
    // every phase, so no time key moves and the event counts stay equal (no row is deleted, so no replay follows).
    const sc = await scenario(shape, adds, rewriteAfter, { full: rewriteAfter === 'repair' });
    expectReached(key, sc);
    if (rewriteAfter === 'repair') {
      // the rewrite is the repair's: the plan asked for it and the repair ran once, before the red assertion below reads its time
      expect(sc.kinds, 'the repair was planned').toContain('repair-report-projection');
      expect(sc.repairs, 'repairProjection ran once').toBe(1);
    }
    expect(sc.lines, 'one slow line is written').toHaveLength(1);
    const callers = rewriteAfter === undefined ? [] : rewriteAfter === 'flush' ? ['flush'] : ['repair', 'effects', 'reconcile'];
    const ms: Record<string, number> = { [key]: 1500 };
    for (const k of rewriteAfter === undefined ? ENCLOSERS[key] ?? [] : callers) ms[k] = 1500;
    if (!tested) ms['noteSessions'] = 1001;
    expectTimings(sc.lines[0]!, ms);
  });
});

// ── R4 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('D-5692 R4: three phases each under the threshold whose blocking sum is over it write the line', () => {
  it('D-5692 R4: pre 400 + pairs 400 + repair 400 is a block of 1,200', async () => {
    const sc = await scenario('std', { pre: 400, pairs: 400, repair: 400 });
    expectReached('repair', sc);
    expect(sc.lines, 'a block of 1,200 ms is slow').toHaveLength(1);
    // repair is inside effects, which is what block sums
    const m = expectTimings(sc.lines[0]!, { pre: 400, pairs: 400, repair: 400, effects: 400, reconcile: 1200 });
    expect(m.get('block')).toBe(1200);
  });
});

// ── R5 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The module's new surface, read through a namespace so that a missing export fails a row, not the file. */
const surface = watchMod as unknown as Record<string, unknown>;
type SlowLine = (fields: Readonly<Record<string, number>>, bound?: number) => string;
/** Design: the one list of keys the line may carry, in the one order it is written. */
const SLOW_KEYS = [
  'block', 'cut', 'total', 'other',
  'blockCpu', 'stallMax', 'stallP99', 'cpuThread',                  // D-5832: right after `other`, so the bound drops them last
  'noteSessions', 'open', 'recover', 'root', 'load', 'expire', 'owners', 'flush', 'upkeep', 'prune', 'reconcile',
  'pre', 'readMetas', 'prep', 'build', 'pairs', 'forced', 'lostForced', 'policy', 'effects',
  'attempts', 'leases', 'intervals', 'absence', 'repair',
  'rewrite', 'rewrites', 'rewriteEvents',
  'trees', 'treesPastWait', 'win', 'winLost', 'winHeld', 'winHeldNull', 'evidence', 'activities', 'pointMetas',
  'cpSessions', 'cpAttempts', 'cpLeases', 'openLeases', 'cpLineage', 'cpIntervals', 'cpCursors',
  'ownerCount', 'pendingOwners', 'staged', 'appended',
  'claimants', 'launches', 'pathMap', 'droppedKeys',
  'markPaths', 'markIds', 'lostProjects', 'lostPrefixes', 'lossy', 'droppedMeasured',
  'ladder', 'markCalls', 'windowCalls', 'lostCalls',
  'vLinked', 'vRunChild', 'vUnresolved', 'vConflicting', 'vUnmeasured',
  'eLease', 'eRunChild', 'eUnowned', 'eAbsence', 'eRepair', 'eInterval',
  'repairPasses', 'repairInserted', 'repairFull', 'repairWiped', 'repairHealed',
  'censusAge',
  // D-5832: after `censusAge`, so the formatter's list-order fill drops these first
  'flushCpu', 'upkeepCpu', 'effectsCpu', 'repairCpu', 'reconcileCpu', 'ownersCpu',
  'stallFlush', 'stallMid', 'stallRepair', 'repairRewrite', 'yields', 'cpActivities', 'cpMapping', 'repairSkipped', 'attemptsSkipped',
  'dropped',
];

describe('D-5692 R5: the line is numbers only, in a fixed grammar, and bounded', () => {
  it('D-5692 R5 (i): through the lane, a census\' strings (a project, a record, a path, a session) never reach the line, which matches the grammar over the fixed keys', async () => {
    const warn = quietWarn();
    const w = world();
    writeBucket(w, 'zq-proj-a', BUCKET10, startLine('zq-proj-a', '2026-10-15T10:01:00.000Z'));
    await primed(w);
    const r = rig(w);
    r.arm({ noteSessions: 1001 });
    const rec = record('zq-proj', 'agent-zqrec', { canonicalPath: '/zqpath/x' });
    const plan = vi.spyOn(policy, 'planDelegationReconciliation');
    await censusPass(w, at(0), { 'zq-proj': [rec] }, [sessionOf('zq-proj-a', 'idle', 'zq-proj')]);
    expect(plan.mock.calls.at(-1)![0].census.map((x) => x.adminRecord), 'the census string reached the reconcile').toEqual(['agent-zqrec']);
    const lines = slowLines(warn);
    expect(lines, 'one slow line is written').toHaveLength(1);
    const text = lines[0]!;
    for (const secret of ['zq-proj', 'agent-zqrec', 'zqrec', '/zqpath/x', 'zqpath', 'zq-']) expect(text, `the line holds ${secret}`).not.toContain(secret);
    // D-5832: a key may now hold a digit (`stallP99`), so the grammar's key class takes digits after its first letter; the values stay numbers only
    expect(text).toMatch(/^ccrc-server: delegation pass slow:( [a-z][a-zA-Z0-9]*=\d+)+$/);
    const keys = surface['DELEGATION_PASS_SLOW_KEYS'] as readonly string[] | undefined;
    expect(Array.isArray(keys), 'DELEGATION_PASS_SLOW_KEYS is exported').toBe(true);
    for (const k of parse(text).keys()) expect(keys, `${k} is a key of the fixed list`).toContain(k);
  });

  it('D-5692 R5 (ii): the formatter keeps to 2,048 bytes whatever the values, and under a small bound drops whole pairs, counts them, and keeps every value it writes whole', () => {
    const format = surface['delegationPassSlowLine'] as SlowLine | undefined;
    expect(typeof format, 'delegationPassSlowLine is exported').toBe('function');
    expect(surface['DELEGATION_PASS_SLOW_KEYS'], 'the fixed list of keys, in order').toEqual(SLOW_KEYS);
    expect(surface['DELEGATION_PASS_SLOW_MS']).toBe(1000);
    expect(surface['DELEGATION_PASS_SLOW_LINE_BYTES']).toBe(2048);
    expect(surface['DELEGATION_PASS_SLOW_PREFIX']).toBe(PREFIX);
    const inputKeys = SLOW_KEYS.filter((k) => k !== 'dropped');

    // every field at the largest safe integer: the line is at most 2,048 bytes (some pairs drop), and it says how many
    const huge = Object.fromEntries(inputKeys.map((k) => [k, Number.MAX_SAFE_INTEGER]));
    const big = format!(huge);
    expect(Buffer.byteLength(big)).toBeLessThanOrEqual(2048);
    expect(big.startsWith(PREFIX)).toBe(true);
    const bigPairs = parse(big);
    const missing = inputKeys.filter((k) => !bigPairs.has(k));
    expect(missing.length, 'at the largest values not every key fits in 2,048 bytes').toBeGreaterThan(0);
    expect(bigPairs.get('dropped'), 'dropped counts the dropped keys').toBe(missing.length);

    // a small bound, with distinct values: whole pairs only, in list order, each value exactly its input
    const values = Object.fromEntries(inputKeys.map((k, i) => [k, 1000 + i * 37]));
    const BOUND = 200;
    const small = format!(values, BOUND);
    expect(Buffer.byteLength(small)).toBeLessThanOrEqual(BOUND);
    const smallPairs = parse(small);
    const present = inputKeys.filter((k) => smallPairs.has(k));
    expect(present.length, 'some pairs fit').toBeGreaterThan(0);
    for (const k of present) expect(smallPairs.get(k), `${k} is whole`).toBe(values[k]);
    expect([...smallPairs.keys()].filter((k) => k !== 'dropped'), 'in list order').toEqual(present);
    expect(smallPairs.get('dropped'), 'dropped counts the dropped keys').toBe(inputKeys.length - present.length);
    expect([...smallPairs.keys()].at(-1), 'dropped is last').toBe('dropped');
    // a pair is dropped whole and the next key is still tried: the greedy fill, with ` dropped=<n>` reserved first (n has the digits of the key count)
    const reserve = ` dropped=${inputKeys.length + 1}`.length;
    let line = PREFIX;
    const kept: string[] = [];
    for (const k of inputKeys) {
      const pair = ` ${k}=${values[k]}`;
      if (line.length + pair.length <= BOUND - reserve) { line += pair; kept.push(k); }
    }
    expect(present, 'the greedy fill under the bound').toEqual(kept);

    // a caller's own `dropped` is ignored, and with nothing dropped the line has none
    const none = format!({ block: 1200, total: 1200, dropped: 99 });
    expect(none).toBe(`${PREFIX} block=1200 total=1200`);
  });

  it('D-5692 R5 (ii): a LONG pair that does not fit is dropped whole and a LATER SHORT pair is still tried and kept (no break on the first overflow); a pair that fits exactly is kept', () => {
    const format = surface['delegationPassSlowLine'] as SlowLine | undefined;
    expect(typeof format, 'delegationPassSlowLine is exported').toBe('function');
    const reserve = ` dropped=${SLOW_KEYS.length}`.length;
    // list order: block, cut, total, other. `total` is the long pair (16 digits), `other` the short one that follows it.
    const fields = { block: 1200, total: Number.MAX_SAFE_INTEGER, other: 7 };
    const fits = PREFIX.length + reserve + ' block=1200'.length + ' other=7'.length;
    const exact = format!(fields, fits);
    expect(exact, 'total is dropped whole, other (listed after it) is kept, and the one drop is counted').toBe(`${PREFIX} block=1200 other=7 dropped=1`);
    expect(Buffer.byteLength(exact)).toBeLessThanOrEqual(fits);
    // one byte less and the short pair no longer fits either: both are dropped, whole
    expect(format!(fields, fits - 1)).toBe(`${PREFIX} block=1200 dropped=2`);
    // room for every pair: nothing is dropped
    expect(format!(fields, PREFIX.length + reserve + ' block=1200'.length + ` total=${Number.MAX_SAFE_INTEGER}`.length + ' other=7'.length))
      .toBe(`${PREFIX} block=1200 total=${Number.MAX_SAFE_INTEGER} other=7`);
    // the same through the full key list: the values alternate long (16 digits) and short (1 digit), so once the line is nearly full a long
    // pair is dropped and a later short one still fits
    const order = SLOW_KEYS.filter((k) => k !== 'dropped');
    const mixed = Object.fromEntries(order.map((k, i) => [k, i % 2 === 0 ? Number.MAX_SAFE_INTEGER : 1]));
    const BOUND = 600;
    const pairs = parse(format!(mixed, BOUND));
    const firstGap = order.findIndex((k) => !pairs.has(k));
    expect(firstGap, 'a pair was dropped').toBeGreaterThan(-1);
    const laterKept = order.slice(firstGap + 1).filter((k) => pairs.has(k));
    expect(laterKept.length, 'and keys listed after the first drop are still on the line').toBeGreaterThan(0);
    for (const k of laterKept) expect(pairs.get(k), `${k} is whole`).toBe(mixed[k]);
    expect(pairs.get('dropped'), 'dropped counts them').toBe(order.filter((k) => !pairs.has(k)).length);
  });

  it('D-5692 R5 (ii): a value is rounded to the nearest whole number, clamped to 0 below and to the largest safe integer above, +Infinity is the largest and any other non-finite value is 0', () => {
    const format = surface['delegationPassSlowLine'] as SlowLine | undefined;
    expect(typeof format, 'delegationPassSlowLine is exported').toBe('function');
    const MAX = Number.MAX_SAFE_INTEGER;
    const rule = (v: number): string => format!({ block: v });
    expect(rule(1.4), 'Math.round: 1.4 is 1').toBe(`${PREFIX} block=1`);
    expect(rule(1.5), 'Math.round: 1.5 is 2').toBe(`${PREFIX} block=2`);
    expect(rule(2.5), 'Math.round: 2.5 is 3').toBe(`${PREFIX} block=3`);
    expect(rule(-5), 'a negative value is 0').toBe(`${PREFIX} block=0`);
    expect(rule(-0.4), 'a value that rounds to negative zero is 0').toBe(`${PREFIX} block=0`);
    expect(rule(Number.POSITIVE_INFINITY), '+Infinity is the largest safe integer').toBe(`${PREFIX} block=${MAX}`);
    expect(rule(Number.NEGATIVE_INFINITY), '-Infinity is 0').toBe(`${PREFIX} block=0`);
    expect(rule(Number.NaN), 'NaN is 0').toBe(`${PREFIX} block=0`);
    expect(rule(MAX + 1000), 'above the largest safe integer is the largest').toBe(`${PREFIX} block=${MAX}`);
    expect(rule(1e300), 'a value that prints in exponent form is the largest, written in full').toBe(`${PREFIX} block=${MAX}`);
    expect(rule(MAX), 'the largest itself is written whole').toBe(`${PREFIX} block=${MAX}`);
    expect(rule(0), 'zero is written, not left out').toBe(`${PREFIX} block=0`);
  });

  // M12's pass-site arm: no lane pass builds a line near the bound (its values are small), so the rows above, which hold the formatter
  // to it, cannot see the lane hand the formatter a bound of its own. Pinned at the source, as delegation-watch.test.ts pins the dispatch.
  it('D-5692 R5 (iii): the lane writes its line through the formatter ONCE, at the formatter\'s own bound (no bound of the call site)', () => {
    const src = readFileSync(path.resolve(__dirname, '../src/watch.ts'), 'utf8');
    const calls = src.split('\n').filter((l) => l.includes('delegationPassSlowLine(') && !/^\s*export function delegationPassSlowLine\(/.test(l));
    expect(calls, 'one call site').toHaveLength(1);
    expect(calls[0]!, 'the call passes the fields alone, so the default bound holds').toMatch(/console\.warn\(delegationPassSlowLine\(f\)\);/);
  });
});

// ── R6 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('D-5692 R6: a pass with no reconcile writes a line with no reconcile key', () => {
  it('D-5692 R6: a census that is not newer, with 1,500 ms in the flush, writes flush=1500 and no reconcile phase or size', async () => {
    const warn = quietWarn();
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'));
    await primed(w);
    const r = rig(w);
    const plan = vi.spyOn(policy, 'planDelegationReconciliation');
    await censusPass(w, at(0), { demo: [OLD, RAW] });
    expect(plan.mock.calls.length, 'the first pass reconciled its census').toBe(1);
    r.arm({ flush: 1500 });
    // the SAME census again (its measuredAt is the first pass's), one cadence later: the lane reconciles a census only once
    setNow(at(1));
    setCensus(w, { demo: [OLD, RAW] }, { 'demo-a': measured() }, at(0));
    await pass(w, DEMO_A);
    expect(plan.mock.calls.length, 'the second pass reconciled nothing').toBe(1);

    const lines = slowLines(warn);
    expect(lines, 'one slow line is written').toHaveLength(1);
    const m = expectTimings(lines[0]!, { flush: 1500 });
    expect(m.get('flush')).toBe(1500);
    const reconcileKeys = ['reconcile', ...INNER, ...PARTS, 'trees', 'treesPastWait', 'claimants', 'launches', 'droppedKeys', 'evidence', 'activities',
      'pointMetas', 'pathMap', 'win', 'winLost', 'winHeld', 'winHeldNull', 'ladder', 'markCalls', 'windowCalls', 'lostCalls',
      'vLinked', 'vRunChild', 'vUnresolved', 'vConflicting', 'vUnmeasured', 'eLease', 'eRunChild', 'eUnowned', 'eAbsence', 'eRepair', 'eInterval',
      'repairPasses', 'repairInserted', 'repairFull', 'repairWiped', 'repairHealed'];
    expect(reconcileKeys.filter((k) => m.has(k)), 'no reconcile key is on the line').toEqual([]);
    expect(m.get('ownerCount'), 'the owners were read').toBe(1);
    expect(m.get('censusAge'), 'the census is one cadence old').toBe(STEP);
  });
});

// ── R7 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('D-5692 R7: a pass cut by its budget writes its line at its late settle', () => {
  it('D-5692 R7: 1,500 ms in a phase that runs after the cut writes exactly one line, once the pass settles, carrying cut=1', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const warn = quietWarn();
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'));
    const r = rig(w);
    // The flush still runs after a cut (its results were read before it). `noteSessions` runs BEFORE the cut (the pass has not yet reached
    // the stuck read), and its 1,001 ms alone is over the threshold: a line written at the cut, in `sweep`, would show before the release.
    r.arm({ noteSessions: 1001, flush: 1500 });
    let release!: () => void;
    w.hold.set('demo-a', new Promise<void>((resolve) => { release = resolve; }));
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    const stuck = pass(w, DEMO_A);
    await vi.waitFor(() => expect(w.calls.listings).toEqual(['demo-a']), { timeout: 10_000 });
    await vi.advanceTimersByTimeAsync(DELEGATION_PASS_BUDGET_MS + 1);
    await stuck;                                                      // the pass ended although the read did not
    expect(slowLines(warn), 'a pass that has not settled has written nothing, though its block is already over the threshold').toEqual([]);
    release();                                                        // the late answer arrives: the cut pass runs its flush and settles
    await vi.waitFor(() => expect(slowLines(warn), 'one line, at the late settle').toHaveLength(1), { timeout: 10_000 });
    await vi.advanceTimersByTimeAsync(10);
    const lines = slowLines(warn);
    expect(lines, 'and exactly one').toHaveLength(1);
    const m = parse(lines[0]!);
    expect(m.get('cut')).toBe(1);
    expect(m.get('noteSessions')).toBe(1001);
    expect(m.get('flush')).toBe(1500);
    expect(m.get('block')).toBe(2501);
    expect(m.get('total')).toBe(2501);
    expect(m.has('reconcile'), 'a cut pass reconciles nothing').toBe(false);
  });
});

// ══ Run 645: D-5832 (CPU and stall on the line), D-5834 (no attempts write when nothing is new), D-5835 (the turns), D-5836 (the repair) ══
//
// Every row below is written RED FIRST, before any of the code: against `main` it fails on its own assertion (a missing key, a call
// count, a flag not yet run), except the rows marked "green by design" (parity guards and the trigger), which pass at `main` and are
// reddened by the mutants named on them.

/** The lane itself (private), for the fields a row sets or reads and the methods it spies. */
const laneOf = (w: World): Record<string, unknown> => (w.watcher as unknown as { delegationLane(): Record<string, unknown> }).delegationLane();
/** A synchronous stall of `ms` of REAL time: the event loop cannot turn while it runs. */
const stallFor = (ms: number): void => { const end = performance.now() + ms; while (performance.now() < end) { /* the loop is blocked */ } };
/** The one line of a scenario, parsed. */
const theLine = (lines: string[]): Map<string, number> => { expect(lines, 'one slow line is written').toHaveLength(1); return parse(lines[0]!); };
/** The turns are three: after the flush, before the reconcile, before the repair. */
const YIELDS_OF = (fired: string[]): number => fired.filter((k) => k === 'yields').length;

describe('D-5832 R1: the line carries the CPU per phase, the stall per stretch, the repair\'s rewrite, the turns and the checkpoint\'s sizes, each as the virtual clocks were set', () => {
  const agentId = (n: number): string => `a1b2c3d4e5f6${(0x2000 + n).toString(16)}`;
  /** Three agents start: the fold opens three activities, so `cpActivities` and `cpMapping` are not zero. */
  const AGENTS = [1, 2, 3].map((n) => lineOf(common('demo-a', {
    eventKind: 'SubagentStart', agentId: agentId(n), agentType: null, cwd: '/w/demo', transcriptPath: `/w/demo/${CLAUDE}.jsonl`,
  }, `2026-10-15T10:02:0${n}.000Z`)));
  /** CPU ms each phase's own hook adds to the virtual CPU clock (distinct primes). `effects` encloses the repair part, `reconcile` the stepped phases. */
  const CPU: Record<string, number> = {
    noteSessions: 11, expire: 13, owners: 59, flush: 101, upkeep: 7, prune: 3, reconcile: 53,
    pre: 5, prep: 17, build: 19, pairs: 23, forced: 29, lostForced: 31, policy: 37, effects: 41, repair: 43,
  };

  it('D-5832 R1: blockCpu is the sum over exactly block\'s phases; each *Cpu, stall*, repairRewrite, yields, cpActivities, cpMapping and cpuThread equals what the virtual clocks were set to', async () => {
    const sc = await scenario('std', { noteSessions: 1001 }, undefined, {
      full: true, spool: AGENTS,
      setup: ({ w, r }) => {
        w.cpu.thread = true;
        w.stall.max = 307; w.stall.p99 = 293;                         // the pass-wide histogram; stallMax is at least every stretch
        for (const [k, ms] of Object.entries(CPU)) r.also(k, () => { w.cpu.us += ms * 1000; });
        // the stretches: set in the hook of the phase that opens each (a stretch is read after the turn that closes it)
        r.also('flush', () => { w.stall.stretch = 211; });            // read after the turn after the flush
        r.also('upkeep', () => { w.stall.stretch = 223; });           // read after the turn before the repair
        r.also('repair', () => { w.stall.stretch = 227; });           // read at the line
        r.onProject('repair', () => { w.clock.t += 700; });           // the repair's own rewrite: the full path projects
      },
    });
    expectReached('repair', sc);
    expect(sc.armed().filter((k) => k === 'repair'), 'the repair part ran').toHaveLength(1);
    const cp = checkpointOf(sc.w.home);
    expect(cp.activities.length, 'the fold opened the three agents\' activities').toBeGreaterThanOrEqual(3);
    const m = theLine(sc.lines);

    const stepped = ['pre', 'readMetas', 'prep', 'build', 'pairs', 'forced', 'lostForced', 'policy'];
    const effectsCpu = CPU['effects']! + CPU['repair']!;               // the repair part runs inside effects
    const reconcileCpu = CPU['reconcile']! + stepped.reduce((n, k) => n + (CPU[k] ?? 0), 0) + effectsCpu;
    const blockCpu = BLOCK.reduce((n, k) => n + (k === 'effects' ? effectsCpu : CPU[k] ?? 0), 0);
    expect(blockCpu, 'the fixture: block\'s phases carry distinct CPU, owners (a read) is not among them').toBe(380);
    const expected: Record<string, number> = {
      blockCpu, cpuThread: 1,
      flushCpu: CPU['flush']!, upkeepCpu: CPU['upkeep']!, effectsCpu, repairCpu: CPU['repair']!, reconcileCpu, ownersCpu: CPU['owners']!,
      stallFlush: 211, stallMid: 223, stallRepair: 227, stallMax: 307, stallP99: 293,
      repairRewrite: 700, yields: 0,
      cpActivities: cp.activities.length, cpMapping: Object.keys(cp.activityIdsByNaturalKey).length,
    };
    for (const [key, value] of Object.entries(expected)) expect(m.get(key), key).toBe(value);
    // `cpActivities` and `cpMapping` are equal by the checkpoint's own invariant (one mapping entry per activity), so a swap of the two is
    // not shown; each still equals its own independent count above.
    expect(m.get('cpMapping')).toBe(m.get('cpActivities'));
  });
});

describe('D-5832 R2: the trigger is unchanged: a stall alone, with block at or under the threshold, writes no line', () => {
  it('D-5832 R2 (green by design at main; M2 reds it): block 1,000 with a virtual stall of 2,000 in every stretch and in the pass-wide histogram writes nothing; block 1,001 writes the line', async () => {
    const stalled = ({ w, r }: { w: World; r: Rig }): void => {
      w.stall.max = 2000; w.stall.p99 = 2000;
      for (const k of ['flush', 'upkeep', 'repair']) r.also(k, () => { w.stall.stretch = 2000; });
    };
    const quiet = await scenario('std', { noteSessions: 1000 }, undefined, { setup: stalled });
    expectReached('repair', quiet);
    expect(quiet.lines, 'a stall of 2,000 ms with a block of exactly 1,000 ms is not slow').toEqual([]);
    const loud = await scenario('std', { noteSessions: 1001 }, undefined, { setup: stalled });
    expectReached('repair', loud);
    expect(loud.lines, 'one more millisecond of block is').toHaveLength(1);
  });
});

describe('D-5832 R3: repairRewrite holds only the port time charged while the repair part is open', () => {
  it('D-5832 R3: 1,500 ms in the flush\'s own project and 700 ms in the repair\'s: rewrite 2,200, repairRewrite 700', async () => {
    const sc = await scenario('std', {}, undefined, {
      full: true,                                                     // the FULL repair projects; the short path (D-5836) would make no port call
      setup: ({ w, r }) => {
        r.onProject('flush', () => { w.clock.t += 1500; });
        r.onProject('repair', () => { w.clock.t += 700; });
      },
    });
    expectReached('repair', sc);
    theLine(sc.lines);
    const m = expectTimings(sc.lines[0]!, { flush: 1500, rewrite: 2200, repair: 700, effects: 700, reconcile: 700 });
    expect(m.get('repairRewrite'), 'the repair\'s share of the rewrite is 700 (flush\'s 1,500 is not in it)').toBe(700);
  });
});

describe('D-5832 R4 (owed from review 642 F6): a pass that throws out of run, and each not-ready return, still writes its one line', () => {
  const FAILURE = { code: 'journal-unreadable', detail: 'a fixture failure' };
  const cases: Array<{ title: string; arrange: (ctx: { w: World; proto: typeof DelegationDurability.prototype }) => void; failed?: boolean; recovers?: boolean }> = [
    { title: 'a throw out of run (the upkeep throws)', failed: true, arrange: () => { vi.spyOn(model, 'upkeepDelegationIntervals').mockImplementation(() => { throw new Error('a fixture throw'); }); } },
    { title: 'the not-ready return of a failed applier inside the retry interval', arrange: ({ w, proto }) => {
      laneOf(w)['lastRecoverAt'] = at(2);                              // the armed pass's own clock: the retry interval has not passed
      vi.spyOn(proto, 'failure').mockReturnValue(FAILURE as never);
    } },
    { title: 'the not-ready return while a recovery the lane started has not settled', arrange: ({ w }) => { laneOf(w)['recovering'] = true; } },
    { title: 'the not-ready return after a recover() that leaves the applier failed', recovers: true, arrange: ({ proto }) => {
      // `lastRecoverAt` is left old (the open was 32 minutes before the armed pass): the retry interval has passed, so recover() runs
      vi.spyOn(proto, 'failure').mockReturnValue(FAILURE as never);
    } },
    { title: 'the not-ready return of an applier that did not open', arrange: ({ w }) => {
      vi.spyOn(laneOf(w) as { applier(): Promise<unknown> }, 'applier').mockResolvedValue(null);
    } },
  ];
  it.each(cases)('D-5832 R4 (green by design at main; MX1/MX2 red it): $title, with 1,001 ms of block, writes one line', async ({ arrange, failed, recovers }) => {
    const sc = await scenario('std', { noteSessions: 1001 }, undefined, { setup: ({ w }) => arrange({ w, proto: DelegationDurability.prototype }) });
    expect(sc.reconciles, 'the pass did not reach the reconcile').toBe(0);
    if (recovers === true) expect(sc.recovered, 'the not-ready branch ran recover()').toBe(1);
    if (failed === true) expect(sc.warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes('a delegation pass failed')), 'the pass threw out of run').toBe(true);
    const m = theLine(sc.lines);
    expect(m.get('noteSessions')).toBe(1001);
    expect(m.get('cut')).toBe(0);
    expect(m.has('reconcile'), 'no reconcile ran').toBe(false);
  });
});

/**
 * Review 677 F6: `run` has two more not-ready returns than R4's cases above, R109's "cut before the owners" exits: the one after the `root`
 * phase and the one after the `load` phase. Each is reached the way the lane reaches it in production: the pass budget (a global timer)
 * fires while the phase's read is still open, `sweep` returns at the cut, and the cut pass's `run` takes the exit when the read answers
 * late. Under `noteSessions: 1001` its block is over the threshold before either exit, so the `finally` must write the one line (cut=1).
 * Green by design at main; MX2 (no line on a not-ready return) reds both rows on their line-count assertion.
 */
describe('D-5832 R4 (review 677 F6): the two R109 cut-before-owners exits each write their one line at the late settle', () => {
  const lineAtTheLateSettle = async (
    w: World, warn: ReturnType<typeof quietWarn>, r: Rig, started: () => boolean, release: () => void, stuck: Promise<void>, exit: string,
  ): Promise<Map<string, number>> => {
    await vi.waitFor(() => expect(started(), `the pass is inside ${exit}'s read`).toBe(true), { timeout: 10_000 });
    await vi.advanceTimersByTimeAsync(DELEGATION_PASS_BUDGET_MS + 1);
    await stuck;                                                      // the pass ended although the read did not
    expect(slowLines(warn), 'a pass that has not settled has written nothing, though its block is already over the threshold').toEqual([]);
    expect(r.fired, 'no owner was reached').not.toContain('owners');
    release();                                                        // the late answer arrives: the cut pass takes the R109 exit and settles
    await vi.waitFor(() => expect(slowLines(warn), 'one line, at the late settle').toHaveLength(1), { timeout: 10_000 });
    await vi.advanceTimersByTimeAsync(10);
    const lines = slowLines(warn);
    expect(lines, 'and exactly one').toHaveLength(1);
    const m = parse(lines[0]!);
    expect(m.get('cut')).toBe(1);
    expect(m.get('noteSessions')).toBe(1001);
    expect(m.get('block'), 'only noteSessions took block time').toBe(1001);
    expect(m.has('reconcile'), 'a cut pass reconciles nothing').toBe(false);
    expect(laneOf(w)['notReady'], 'the lane is not ready after the exit').toBe(true);
    expect(w.calls.listings, 'no owner was listed').toEqual([]);
    return m;
  };
  const setUp = (): { w: World; warn: ReturnType<typeof quietWarn>; r: Rig } => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const warn = quietWarn();
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'));
    const r = rig(w);
    r.arm({ noteSessions: 1001 });                                    // block is over the threshold before either exit
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    return { w, warn, r };
  };

  it('D-5832 R4 (review 677 F6; green by design at main; MX2 reds it): a pass cut while the projects root resolves takes the exit after the root phase and writes one line, cut=1', async () => {
    const { w, warn, r } = setUp();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started = false;
    // `resolveProjectsRoot` awaits this read; when it answers late its own `if (pass.signal.aborted) return;` returns into `run`, whose check
    // right after the `root` phase takes the exit (the load phase was never announced).
    const io = (laneOf(w)['deps'] as { io: FleetIO }).io;
    const real = io.realpath.bind(io);
    vi.spyOn(io, 'realpath').mockImplementation(async (p: string) => { started = true; await gate; return real(p); });
    const passesBefore = laneOf(w)['passes'];
    const stuck = pass(w, DEMO_A);
    const m = await lineAtTheLateSettle(w, warn, r, () => started, release, stuck, 'the root phase');
    expect(r.fired, 'the root phase was announced and the load phase was not').toEqual(expect.arrayContaining(['noteSessions', 'open', 'root']));
    expect(r.fired).not.toContain('load');
    expect(r.fired.filter((k) => ['expire', 'flush', 'reconcile'].includes(k)), 'nothing after the exit ran').toEqual([]);
    expect(laneOf(w)['passes'], 'the pass count (incremented after the exit) did not move').toBe(passesBefore);
    expect(m.has('load'), 'no load phase is on the line').toBe(false);
  });

  it('D-5832 R4 (review 677 F6; green by design at main; MX2 reds it): a pass cut while the evidence loads takes the exit after the load phase and writes one line, cut=1', async () => {
    const { w, warn, r } = setUp();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started = false;
    // `loadEvidence` awaits the journal visit; when it answers late the load completes and `run`'s check right after the `load` phase takes
    // the exit (`pass.reachedOwners` was never set; the owners phase was never announced).
    const visit = DelegationDurability.prototype.visitRetainedRecords;
    vi.spyOn(DelegationDurability.prototype, 'visitRetainedRecords').mockImplementation(async function (this: DelegationDurability, ...args: Parameters<typeof visit>) {
      started = true; await gate; return visit.apply(this, args);
    });
    const passesBefore = laneOf(w)['passes'] as number;
    const stuck = pass(w, DEMO_A);
    const m = await lineAtTheLateSettle(w, warn, r, () => started, release, stuck, 'the load phase');
    expect(r.fired, 'the root and load phases were announced').toEqual(expect.arrayContaining(['noteSessions', 'open', 'root', 'load']));
    expect(r.fired.filter((k) => ['expire', 'flush', 'reconcile'].includes(k)), 'nothing after the exit ran').toEqual([]);
    expect(laneOf(w)['passes'], 'the pass count (incremented before the load) moved by one').toBe(passesBefore + 1);
    expect(m.has('load'), 'the load phase is on the line').toBe(true);
  });
});

describe('D-5832 R5: the real loop: a 50 ms synchronous stall inside the store\'s projection reads in the stretch it was made in', () => {
  it.each([
    { arm: 'repair', key: 'stallRepair' },
    { arm: 'flush', key: 'stallFlush' },
  ])('D-5832 R5: with the production sampler and turns, 50 ms made inside the $arm\'s project reads $key >= 50 (M3, M19 red it)', async ({ arm, key }) => {
    const sc = await scenario('std', { noteSessions: 1001 }, undefined, {
      full: true,                                                     // the repair\'s FULL path projects; counts equal, so no replay (and no yield) follows
      seams: { loopDelay: undefined },                                // the production sampler; no `loopTurn` seam: the production turns
      setup: ({ r }) => { r.onProject(arm, () => stallFor(50)); },
    });
    expectReached('repair', sc);
    const report = (await sc.spies.repair.mock.results.at(-1)!.value) as DelegationProjectionRepairReport;
    expect([report.fullReplay, report.journalPasses], 'the repair projected and replayed nothing: its stall is the projection\'s alone').toEqual([false, 0]);
    const m = theLine(sc.lines);
    expect(m.has(key), `${key} is on the line`).toBe(true);
    expect(m.get(key), `${key} reads the 50 ms stall`).toBeGreaterThanOrEqual(50);
    expect(m.get('stallMax'), 'stallMax is at least every stretch').toBeGreaterThanOrEqual(m.get(key)!);
    expect(m.get('stallMax'), 'and the pass-wide max saw the 50 ms').toBeGreaterThanOrEqual(50);
    // not `stallP99 >= 50`: past 100 sampler fires the 99th percentile is not the max, so a busy box would flake it
    expect(m.get('stallP99'), 'the pass-wide percentile is measured').toBeGreaterThan(0);
    expect(m.get('stallP99'), 'and never above the max').toBeLessThanOrEqual(m.get('stallMax')!);
  });
});

describe('D-5832 R6 (review 677 F5): the production CPU clock: the runtime\'s thread clock where it has one, else the real process clock (green by design at bdc3baebb; red at main, where the CPU keys are absent)', () => {
  /** The production-clock pass: no CPU seam (the world's virtual one is taken off), a line written by the 1,001 ms in `noteSessions`. */
  const productionPass = (setup?: ScenarioX['setup']) =>
    scenario('std', { noteSessions: 1001 }, undefined, { seams: { cpuMicros: undefined }, setup });

  it('D-5832 R6 (i): with no CPU seam the line\'s cpuThread is 1 when the runtime has process.threadCpuUsage and 0 when it has not, and the production CPU keys are whole non-negative numbers', async () => {
    const hasThread = typeof (process as unknown as { threadCpuUsage?: unknown }).threadCpuUsage === 'function';
    const sc = await productionPass();
    const m = theLine(sc.lines);
    expect(m.get('cpuThread'), `cpuThread follows the runtime's feature (threadCpuUsage is ${hasThread ? 'present' : 'absent'})`).toBe(hasThread ? 1 : 0);
    for (const k of ['blockCpu', 'effectsCpu', 'reconcileCpu']) {
      expect(m.has(k), `${k} is on the line`).toBe(true);
      const v = m.get(k)!;
      expect(Number.isInteger(v) && v >= 0, `${k} is a whole non-negative number (read ${v})`).toBe(true);
    }
  });

  it('D-5832 R6 (ii) (MCPUthread, MCPUsrc red it): with process.threadCpuUsage absent the lane reads the real process.cpuUsage and the line says cpuThread=0; the property is restored exactly', async () => {
    const holder = process as unknown as { threadCpuUsage?: unknown };
    const had = Object.prototype.hasOwnProperty.call(process, 'threadCpuUsage');
    const desc = Object.getOwnPropertyDescriptor(process, 'threadCpuUsage');
    const typeBefore = typeof holder.threadCpuUsage;
    const usage: { spy: { mock: { calls: unknown[] }; mockRestore(): void } | null } = { spy: null };
    let calls = 0;
    let sc: Awaited<ReturnType<typeof scenario>>;
    try {
      sc = await productionPass(() => {
        delete holder.threadCpuUsage;
        if (typeof holder.threadCpuUsage === 'function') throw new Error('process.threadCpuUsage is still a function after the delete (a copy on the prototype?): the fallback cannot be reached, so this row cannot pin it');
        usage.spy = vi.spyOn(process, 'cpuUsage');                        // calls through; the scenario's own mock restore ran before this setup
        calls = usage.spy!.mock.calls.length;
      });
      calls = usage.spy!.mock.calls.length - calls;
    } finally {
      usage.spy?.mockRestore();
      if (had) Object.defineProperty(process, 'threadCpuUsage', desc!);
      else delete holder.threadCpuUsage;
    }
    expect(typeof holder.threadCpuUsage, 'process.threadCpuUsage is back as it was').toBe(typeBefore);
    expect(Object.prototype.hasOwnProperty.call(process, 'threadCpuUsage'), 'and is an own property exactly when it was').toBe(had);
    expect(Object.getOwnPropertyDescriptor(process, 'threadCpuUsage'), 'with the same descriptor').toEqual(desc);
    expect(calls, 'the pass read process.cpuUsage (the fallback ran): at least one read to open a phase and one to close it').toBeGreaterThanOrEqual(2);
    const m = theLine(sc.lines);
    expect(m.get('cpuThread'), 'the process clock is not a thread clock').toBe(0);
    expect(m.has('blockCpu'), 'blockCpu is on the line').toBe(true);
    expect(Number.isInteger(m.get('blockCpu')) && m.get('blockCpu')! >= 0, 'and is a whole non-negative number').toBe(true);
  });
});

describe('D-5832 (the bound): the new keys sit where the line\'s bound drops them last', () => {
  it('D-5832: at realistic values (7 digits each) the whole line is 1,817 bytes and drops nothing; at the largest values the keys that drop are a suffix of the list and the first four new keys stay', () => {
    const format = surface['delegationPassSlowLine'] as SlowLine | undefined;
    expect(typeof format, 'delegationPassSlowLine is exported').toBe('function');
    const keys = SLOW_KEYS.filter((k) => k !== 'dropped');
    expect(keys, 'the list holds the 83 old input keys and the 19 new ones').toHaveLength(102);
    const real = format!(Object.fromEntries(keys.map((k) => [k, 1234567])));
    const realPairs = parse(real);
    expect(realPairs.size, 'every key is on the line (an unknown key is ignored by the formatter at main)').toBe(keys.length);
    expect(realPairs.has('dropped'), 'nothing drops at realistic values').toBe(false);
    expect(Buffer.byteLength(real)).toBe(1817);

    const MAX = Number.MAX_SAFE_INTEGER;
    const big = format!(Object.fromEntries(keys.map((k) => [k, MAX])));
    expect(Buffer.byteLength(big)).toBeLessThanOrEqual(2048);
    const bp = parse(big);
    const present = keys.filter((k) => bp.has(k));
    expect(present, 'with equal-width values the greedy fill keeps a prefix: the end of the list drops').toEqual(keys.slice(0, present.length));
    for (const k of ['blockCpu', 'stallMax', 'stallP99', 'cpuThread']) expect(bp.has(k), `${k} (right after other) is never the first to go`).toBe(true);
    for (const k of ['attemptsSkipped', 'repairSkipped', 'cpMapping', 'cpActivities', 'yields', 'repairRewrite', 'stallRepair', 'stallMid', 'stallFlush', 'ownersCpu']) {
      expect(bp.has(k), `${k} (after censusAge) drops at the largest values`).toBe(false);
    }
    expect(bp.get('dropped'), 'and the line counts them').toBe(keys.length - present.length);
  });
});

describe('D-5834 R1: a pass whose attempts are all already filed makes no checkpoint change; one with a new attempt makes exactly one, and files it', () => {
  /** The crash-replay the policy really produces: the pass that files the raw tree's attempt fails to journal its lease (once), so the NEXT
   *  pass plans the same lease request again, with an attempt that is already on file. One extra unarmed pass makes the armed one that replay. */
  const replay = {
    extra: 1,
    prelude: (i: number, count: number): void => {
      if (i === count - 1) vi.spyOn(DelegationDurability.prototype, 'createLease').mockRejectedValueOnce(new Error('a fixture failure'));
    },
  };

  // The attempts part sits between two phase announcements: `attempts` (its start) and `leases` (the next, once it has ended). The lane's
  // in-memory checkpoint and the file are read at both, so what the part itself did to the revision and the bytes is pinned apart from the
  // flush's commit before it and the lease's after it.
  type Snap = { revision: number; canonical: string; file: Buffer; ids: string[] };
  const snap = (w: World): Snap => {
    const cp = (laneOf(w)['durable'] as DelegationDurability).state().checkpoint as DelegationCheckpointV1;
    return { revision: cp.revision, canonical: canonicalDelegationJson(cp), file: readFileSync(path.join(w.home, '.ccrc', DELEGATION_CHECKPOINT_FILE)), ids: cp.attempts.map((a) => a.attemptId).sort() };
  };
  const sha = (x: string | Buffer): string => createHash('sha256').update(x).digest('hex');
  /** What `fileAttempts` answers, taken from a spy on the lane that calls through (the method has this name and answer at the review base). */
  const answers = (w: World): { all: () => Promise<string[][]> } => {
    const spy = vi.spyOn(laneOf(w) as { fileAttempts(...a: unknown[]): Promise<Set<string>> }, 'fileAttempts');
    return { all: async () => Promise.all(spy.mock.results.map(async (r) => [...(await (r.value as Promise<Set<string>>))].sort())) };
  };

  // The boundary values both rows pin. Computed by this fixture with production at ee03056ab (the review base) and identical at this commit:
  // the state at the attempts boundary rests on the fixture's fixed clock (`NOW`/`setNow`), its fixed session and tree names, and ids that
  // are content hashes of those, so nothing in it depends on the random fixture home (measured equal over repeated runs at both). Each
  // `sha` is of the canonical JSON of the lane's in-memory checkpoint, or of the checkpoint file's bytes, read at the `attempts` announcement
  // (start) and the `leases` announcement (end).
  const FILED_ID = '6e45196d4b26808fa5e3facdca82c8e0d79facf14c0691c0a4d9de1a11f76e31';
  const AT_START = { revision: 3, canonical: '536b91c4b758575c220d5c37773e3b2fa6ccb50b51511f6c5b3c94fd23f827ed', file: 'cf44ab9aeaa8901be3e2629e59bad6dc8ba7060489fdce1fe2d1b6e2b62bbd0b' };
  const AT_END_B = { revision: 4, canonical: '2537dd6c9e4d330d5e49630ccc59fe1ea6eade21685979e6f827d0356f0782a0', file: 'a0d42d895275258e78148a70d5dcf6058358c12065e6f3e7389cbc02be35adfd' };
  const shaOf = (s: Snap | null): { revision: number; canonical: string; file: string } => ({ revision: s!.revision, canonical: sha(s!.canonical), file: sha(s!.file) });

  it('D-5834 R1 (a): every attempt already on file: no applyCheckpointChange call, the same attempts, the lease request still reaches createLease, attemptsSkipped=1', async () => {
    let attemptsBefore: readonly DelegationAttemptRow[] = [];
    let start: Snap | null = null;
    let end: Snap | null = null;
    let returned: { all: () => Promise<string[][]> } | null = null;
    const sc = await scenario('std', { noteSessions: 1001 }, undefined, {
      ...replay,
      setup: ({ w, r }) => {
        attemptsBefore = checkpointOf(w.home).attempts;
        returned = answers(w);
        r.also('attempts', () => { start = snap(w); });
        r.also('leases', () => { end = snap(w); });
      },
    });
    expectReached('attempts', sc);
    expect(attemptsBefore.length, 'the earlier pass filed the attempt and lost its lease').toBeGreaterThanOrEqual(1);
    expect(sc.armed(), 'the attempts part ran').toContain('attempts');
    expect(sc.leasesCreated, 'the filed attempt let its lease request through').toBeGreaterThanOrEqual(1);
    expect(sc.spies.applyChange.mock.calls.length - sc.before.applyChange, 'fileAttempts made no change call').toBe(0);
    expect(checkpointOf(sc.w.home).attempts, 'the attempts on file are what they were').toEqual(attemptsBefore);
    // Zero calls, so the part changed nothing: same revision, same canonical checkpoint, same file bytes (at main the no-op call wrote
    // nothing either, so these are parity pins), and the set `fileAttempts` answers (the attempt ids on file) is the one the lease part saw.
    expect(start, 'the attempts part started').not.toBeNull();
    expect(end, 'and the lease part began after it').not.toBeNull();
    expect(end!.revision, 'the attempts part left the revision alone').toBe(start!.revision);
    expect(end!.canonical, 'and the checkpoint\'s canonical bytes').toBe(start!.canonical);
    expect(end!.file.equals(start!.file), 'and the file on disk').toBe(true);
    expect([...end!.ids].sort(), 'the ids on file (the set the part answers) are the ones that were').toEqual(attemptsBefore.map((a) => a.attemptId).sort());
    expect(shaOf(start), 'the checkpoint at the start of the attempts part is the one the review base computes').toEqual(AT_START);
    expect(shaOf(end), 'and at its end: the revision, the canonical bytes and the file bytes are unchanged').toEqual(AT_START);
    expect(end!.ids, 'the ids on file are the one attempt').toEqual([FILED_ID]);
    expect(await returned!.all(), 'fileAttempts answered, once, the set the review base answers').toEqual([[FILED_ID]]);
    expect(theLine(sc.lines).get('attemptsSkipped'), 'the line says the call was skipped').toBe(1);
  });

  it('D-5834 R1 (b): one new attempt beside a filed one: exactly one call, and it is filed (green at main; M8 reds them); attemptsSkipped=0 (red at main: no such key)', async () => {
    const NEW_ID = 'attempt-new-5834';
    let attemptsBefore: readonly DelegationAttemptRow[] = [];
    let start: Snap | null = null;
    let end: Snap | null = null;
    let returned: { all: () => Promise<string[][]> } | null = null;
    const sc = await scenario('std', { noteSessions: 1001 }, undefined, {
      ...replay,
      setup: ({ w, r, plan, realPlan }) => {
        attemptsBefore = checkpointOf(w.home).attempts;
        const template = attemptsBefore[0]!;
        plan.mockImplementation((input) => [...realPlan(input), { kind: 'record-unowned-worktree' as const, attempt: { ...template, attemptId: NEW_ID } }]);
        returned = answers(w);
        r.also('attempts', () => { start = snap(w); });
        r.also('leases', () => { end = snap(w); });
      },
    });
    expectReached('attempts', sc);
    expect(attemptsBefore.length, 'the earlier pass filed the first attempt').toBeGreaterThanOrEqual(1);
    expect(sc.spies.applyChange.mock.calls.length - sc.before.applyChange, 'one change for the lot').toBe(1);
    const after = checkpointOf(sc.w.home).attempts;
    expect(after.map((a) => a.attemptId).sort(), 'the new attempt is on file beside the old ones').toEqual([...attemptsBefore.map((a) => a.attemptId), NEW_ID].sort());
    expect(start, 'the attempts part started').not.toBeNull();
    expect(end, 'and the lease part began after it').not.toBeNull();
    expect(shaOf(start), 'the checkpoint at the start of the attempts part is the one the review base computes (the same as (a)\'s)').toEqual(AT_START);
    expect(shaOf(end), 'and at its end the one change left the revision, canonical bytes and file bytes the review base computes').toEqual(AT_END_B);
    expect(end!.ids, 'the filed attempt and the new one').toEqual([FILED_ID, NEW_ID].sort());
    expect(await returned!.all(), 'fileAttempts answered, once, the set the review base answers').toEqual([[FILED_ID, NEW_ID].sort()]);
    expect(theLine(sc.lines).get('attemptsSkipped'), 'the line says a call was made').toBe(0);
  });
});

describe('D-5835 R1: each turn gives the loop a macrotask turn, pinned by a real setImmediate queued after the last real I/O before its boundary', () => {
  /** A fixture home whose owner has a spool; the lane's first ready pass has run and the rig is in. */
  async function turnWorld() {
    const warn = quietWarn();
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'));
    await primed(w);
    const r = rig(w);
    return { warn, w, r };
  }

  it('D-5835 R1 (i): an immediate queued inside the store\'s project, while flush is the last phase, has run by onPassPhase(upkeep)', async () => {
    const { w, r } = await turnWorld();
    appendBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:06:00.000Z'));   // the flush has a result to apply: it projects
    r.arm({});
    let queued = false;
    let ran = false;
    let ranByUpkeep: boolean | null = null;
    const project = w.coord.projectDelegationCheckpoint;               // the rig's wrapper
    w.coord.projectDelegationCheckpoint = ((cp: Parameters<CoordStore['projectDelegationCheckpoint']>[0]) => {
      if (!queued && r.last() === 'flush') { queued = true; setImmediate(() => { ran = true; }); }
      return project(cp);
    }) as CoordStore['projectDelegationCheckpoint'];
    r.also('upkeep', () => { ranByUpkeep = ran; });
    await censusPass(w, at(0), { demo: [] });
    expect(queued, 'the flush projected').toBe(true);
    expect(ranByUpkeep, 'the immediate ran before the upkeep began').toBe(true);
  });

  it('D-5835 R1 (ii): an immediate queued at the start of prune, in a pass whose prune and upkeep write nothing, has run by onPassPhase(reconcile)', async () => {
    const { w, r } = await turnWorld();
    const change = vi.spyOn(DelegationDurability.prototype, 'applyCheckpointChange');
    const pruned = vi.spyOn(DelegationDurability.prototype, 'pruneBucketCursors');
    r.arm({});
    let ran = false;
    let ranByReconcile: boolean | null = null;
    r.also('prune', () => { setImmediate(() => { ran = true; }); });
    r.also('reconcile', () => { ranByReconcile = ran; });
    await censusPass(w, at(0), { demo: [] });
    expect(r.fired, 'the pass reached its reconcile').toContain('reconcile');
    expect([change.mock.calls.length, pruned.mock.calls.length], 'upkeep and prune wrote nothing').toEqual([0, 0]);
    expect(ranByReconcile, 'the immediate ran before the reconcile began').toBe(true);
  });

  it('D-5835 R1 (iii): an immediate queued at onPassPhase(effects), in a pass whose only effect is repair-report-projection, has run when repairProjection is entered', async () => {
    const { w, r } = await turnWorld();
    const plan = vi.spyOn(policy, 'planDelegationReconciliation');
    const original = DelegationDurability.prototype.repairProjection;
    let ran = false;
    let ranAtRepair: boolean | null = null;
    vi.spyOn(DelegationDurability.prototype, 'repairProjection').mockImplementation(function (this: DelegationDurability, ...args: Parameters<DelegationDurability['repairProjection']>) {
      ranAtRepair = ran;
      return original.apply(this, args);
    });
    r.arm({});
    r.also('effects', () => { setImmediate(() => { ran = true; }); });
    await censusPass(w, at(0), { demo: [] });
    expect(plan.mock.results.length, 'the pass planned').toBeGreaterThan(0);
    expect((plan.mock.results.at(-1)!.value as Array<{ kind: string }>).map((e) => e.kind), 'the pass\'s only effect is the repair').toEqual(['repair-report-projection']);
    expect(ranAtRepair, 'the immediate ran before the repair was entered').toBe(true);
  });
});

describe('D-5835 R2: the turns change no result', () => {
  /** A parent working inside a scratch tree and a subagent of it: the policy plans an unowned-worktree attempt (no lease, so no random id
   *  enters the journal or the checkpoint, and two runs of the fixture are byte-for-byte comparable). */
  const SCRATCH = record('demo', 'scratch-tree-1');
  const scratchLines = [
    lineOf(common('demo-a', { eventKind: 'SessionStart', source: 'startup', cwd: SCRATCH.canonicalPath }, '2026-10-15T10:01:30.000Z')),
    lineOf(common('demo-a', { eventKind: 'SubagentStart', agentId: 'ag1', agentType: null, cwd: '/w/demo' }, '2026-10-15T10:02:50.000Z')),
    lineOf(common('demo-a', { eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 'toolu_s1', outcome: 'completed', agentId: 'ag1', cwd: SCRATCH.canonicalPath }, '2026-10-15T10:03:00.000Z')),
  ];
  async function outcome(seams: Record<string, unknown>) {
    vi.restoreAllMocks();
    quietWarn();
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, ...scratchLines);
    await primed(w);
    rig(w, seams);
    const plan = vi.spyOn(policy, 'planDelegationReconciliation');
    const view = { demo: [SCRATCH] };
    await censusPass(w, at(0), view);
    await censusPass(w, at(1), view);
    appendBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:06:00.000Z'));
    await censusPass(w, at(2), view);
    expect(plan.mock.results.length, 'the fixture planned at least once').toBeGreaterThan(0);
    const cp = checkpointOf(w.home);
    return {
      kinds: (plan.mock.results.at(-1)!.value as Array<{ kind: string }>).map((e) => e.kind),
      revision: cp.revision,
      checkpoint: canonicalDelegationJson(cp),
      journal: readFileSync(path.join(w.cfg.ccrcDir, DELEGATION_JOURNAL_FILE), 'utf8'),
      rows: canonicalDelegationJson(w.coord.readDelegationProjection()),
      effects: JSON.stringify(plan.mock.results.at(-1)!.value),
    };
  }
  it('D-5835 R2 (green by design at main; M22 reds it): one fixture pass with the production turns and with the turns seamed off leaves the same checkpoint, revision, journal, delegation rows and effects', async () => {
    const turned = await outcome({});
    const bare = await outcome({ loopTurn: async () => {} });
    expect(turned.kinds, 'the pass planned an unowned-worktree attempt and the repair').toEqual(expect.arrayContaining(['record-unowned-worktree', 'repair-report-projection']));
    expect(turned.revision, 'the pass wrote').toBeGreaterThan(1);
    expect(turned).toEqual(bare);
  });
});

describe('D-5835 R3: a cut fired during a turn runs nothing after it', () => {
  it.each([
    { turn: 1, boundary: 'after the flush' },
    { turn: 2, boundary: 'before the reconcile' },
    { turn: 3, boundary: 'before the repair' },
  ])('D-5835 R3: the cut fires during turn $turn ($boundary) (M15 reds it)', async ({ turn }) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let active = false;
    let calls = 0;
    // The n-th turn of the armed pass advances the faked clock past the pass budget: the budget timer aborts the pass during that turn.
    const loopTurn = async (): Promise<void> => {
      if (!active) return;
      calls += 1;
      if (calls === turn) vi.advanceTimersByTime(DELEGATION_PASS_BUDGET_MS + 1);
    };
    let reconciledBefore: unknown;
    const sc = await scenario('std', { noteSessions: 1001 }, undefined, {
      seams: { loopTurn },
      setup: ({ w }) => { active = true; reconciledBefore = laneOf(w)['reconciledAt']; },
    });
    // the cut pass keeps running after `sweep`'s race: its late settle writes the one line
    await vi.waitFor(() => expect(slowLines(sc.warn), 'one line, at the late settle').toHaveLength(1), { timeout: 10_000 });
    await vi.advanceTimersByTimeAsync(10);
    const ran = sc.armed();
    expect(YIELDS_OF(ran), `the pass took exactly ${turn} turn(s) of its own`).toBe(turn);
    expect(calls, 'and the cut was fired in the last of them').toBeGreaterThanOrEqual(turn);
    expect(parse(slowLines(sc.warn)[0]!).get('cut'), 'the pass was cut').toBe(1);
    if (turn === 1) for (const k of ['upkeep', 'prune', 'reconcile']) expect(ran, `${k} began after the cut`).not.toContain(k);
    if (turn === 2) {
      expect(ran, 'the upkeep and the prune ran before the cut').toEqual(expect.arrayContaining(['upkeep', 'prune']));
      expect(ran, 'reconcile began after the cut').not.toContain('reconcile');
      expect(laneOf(sc.w)['reconciledAt'], 'and reconciledAt did not move').toBe(reconciledBefore);
    }
    if (turn === 3) {
      expect(ran, 'the effects began before the cut').toContain('effects');
      expect(sc.spies.repair.mock.calls.length - sc.before.repair, 'repairProjection was not called after the cut').toBe(0);
      expect(ran, 'and no repair part began').not.toContain('repair');
    }
  });
});

describe('D-5835 R4: a turn\'s time is in yields and in total, and in no other time key', () => {
  it.each([
    { title: 'the turn after the flush', yields: [1500], total: 1500 },
    { title: 'the turn before the repair', yields: [0, 0, 1500], total: 1500 },
    { title: 'both', yields: [1500, 0, 1500], total: 3000 },
  ])('D-5835 R4: 1,500 ms in $title shows in yields and total; block, other, effects and reconcile exclude it (M20 reds it)', async ({ yields, total }) => {
    const sc = await scenario('std', { noteSessions: 1001, yields }, undefined, {});
    expectReached('repair', sc);
    expect(YIELDS_OF(sc.armed()), 'the pass took its three turns').toBe(3);
    const m = theLine(sc.lines);
    for (const k of TIME_KEYS) if (m.has(k)) expect(m.get(k), `${k} (ms)`).toBe(k === 'noteSessions' ? 1001 : 0);
    expect(m.get('yields'), 'the turns\' time').toBe(total);
    expect(m.get('total'), 'total is the pass\'s span: it keeps the turns').toBe(1001 + total);
    expect(m.get('block'), 'block excludes the turns').toBe(1001);
    expect(m.get('other'), 'nothing is unaccounted for').toBe(0);
  });
});

describe('D-5835 R5 (review 677 F3): the turn before the repair keeps its CPU in the phases that enclose it, and its elapsed time leaves them', () => {
  it('D-5835 R5: pins the approved "CPU while open" reading: 61 ms of CPU and 97 ms of elapsed time in turn 3 are in effectsCpu, reconcileCpu and blockCpu, and the 97 ms is in yields and total and not in effects, reconcile or block (green by design at bdc3baebb; red at main, where the turns and CPU keys are absent; MturnCpu reds it)', async () => {
    let active = false;
    let turns = 0;
    let w!: World;
    // Only the third turn of the armed pass (the one before the repair, inside `effects` and `reconcile`) spends CPU and time; the line's own turn is the fourth.
    const loopTurn = async (): Promise<void> => {
      if (!active) return;
      turns += 1;
      if (turns === 3) { w.cpu.us += 61_000; w.clock.t += 97; }
    };
    const sc = await scenario('std', { noteSessions: 1001 }, undefined, {
      full: true, seams: { loopTurn },
      setup: (ctx) => { w = ctx.w; active = true; },
    });
    expectReached('repair', sc);
    expect(YIELDS_OF(sc.armed()), 'the pass took its three turns').toBe(3);
    expect(turns, 'and the line took its own (the fourth), which spends nothing').toBe(4);
    const m = theLine(sc.lines);
    expect(m.get('effectsCpu'), 'effectsCpu holds the CPU spent in turn 3, which `effects` encloses').toBe(61);
    expect(m.get('reconcileCpu'), 'reconcileCpu holds it too').toBe(61);
    expect(m.get('blockCpu'), 'blockCpu sums effects\' CPU, so it holds it').toBe(61);
    expect(m.get('repairCpu'), 'the repair part opens after the turn: none of the 61 ms is its own').toBe(0);
    expect(m.get('flushCpu'), 'nor the flush\'s').toBe(0);
    expect(m.get('effects'), 'effects (elapsed) excludes the 97 ms').toBe(0);
    expect(m.get('reconcile'), 'reconcile (elapsed) excludes it').toBe(0);
    expect(m.get('block'), 'block excludes it: the 1,001 ms of noteSessions only').toBe(1001);
    expect(m.get('yields'), 'yields holds it').toBe(97);
    expect(m.get('total'), 'total keeps it').toBe(1001 + 97);
    expect(m.get('other'), 'nothing is unaccounted for').toBe(0);
  });
});

describe('D-5836 R1: after one ready pass, a pass that appends a spool line projects once, from the flush, and its repair is skipped', () => {
  it('D-5836 R1: three further passes each call projectDelegationCheckpoint once and report skipped:true; the armed one carries repairSkipped=1', async () => {
    const warn = quietWarn();
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'));
    await primed(w);                                                  // the lane's first ready pass: its repair is the full one
    const r = rig(w);
    const repair = vi.spyOn(DelegationDurability.prototype, 'repairProjection');
    const projected = vi.spyOn(w.coord, 'projectDelegationCheckpoint');
    const change = vi.spyOn(DelegationDurability.prototype, 'applyCheckpointChange');
    for (let i = 0; i < 3; i++) {
      appendBucket(w, 'demo-a', BUCKET10, startLine('demo-a', `2026-10-15T10:0${2 + i}:00.000Z`));
      if (i === 2) r.arm({ noteSessions: 1001 });
      const base = { projected: projected.mock.calls.length, repair: repair.mock.calls.length, change: change.mock.calls.length };
      await censusPass(w, at(i), { demo: [] });
      expect(repair.mock.calls.length - base.repair, `pass ${i}: the repair ran once`).toBe(1);
      expect(change.mock.calls.length - base.change, `pass ${i}: no attempt or interval was filed`).toBe(0);
      expect(projected.mock.calls.length - base.projected, `pass ${i}: projectDelegationCheckpoint is called once, from the flush`).toBe(1);
      const report = (await repair.mock.results.at(-1)!.value) as DelegationProjectionRepairReport & { skipped?: boolean };
      expect(report.skipped, `pass ${i}: the repair's report says it was skipped`).toBe(true);
    }
    expect(theLine(slowLines(warn)).get('repairSkipped'), 'the armed pass\'s line says the repair was skipped').toBe(1);
  });
});
