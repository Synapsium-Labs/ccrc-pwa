// D-5692: the delegation lane's SLOW-PASS TIMING LINE (rows R1 to R7). The lane (`DelegationLane` in `watch.ts`) writes ONE diagnostics line,
// `ccrc-server: delegation pass slow: key=value ...`, when the BLOCKING phases of a pass sum to more than `DELEGATION_PASS_SLOW_MS`
// (strictly more: exactly that writes nothing). The line is numbers only: no path, session id, project or record name ever enters it, and
// it never changes a verdict, an effect, a journal write, a checkpoint or the timing of any act.
//
// WHAT THIS FILE PINS
//   R1  a full pass: one line; its phases, derived keys and sizes are exactly what ran, each size equal to a count measured INDEPENDENTLY
//       of the lane's new code (spies on correlation and policy, the applier's own return values, the report, the checkpoint on disk);
//       the same for the five repair sizes (a real repair of a drifted `coord.db`, a null report, a throw), for an unknown-repository
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
// Every directory here is a FIXTURE home: nothing reads or writes the live `~/.ccrc` or `~/.cc-sessions`, and no ccd verb runs.
// `world()`, `setCensus`, `censusPass`, `primed` and `disk` below MIRROR the fixture of `delegation-watch.test.ts` (trimmed to what these
// rows need: the owner listing hold is kept for R7, the other fault knobs are not).
import { afterEach, describe, it, expect, vi } from 'vitest';
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
import type { DelegationCensusPass, ParentIncarnation, WorktreeCensus } from '../src/coord/gitref.js';
import { DELEGATION_CHECKPOINT_FILE, DelegationDurability, decodeDelegationCheckpoint, type DelegationProjectionRepairReport } from '../src/coord/delegation-checkpoint.js';
import { DELEGATION_EVENTS_CAP, type DelegationCensusRecord, type DelegationCheckpointV1 } from '../src/coord/delegation-model.js';
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
  const made: World = { home, cfg, watcher: new FleetWatcher(deps as never, new Bus(), 10_000), coord, hold, calls, clock };
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
  /** Arms the NEXT pass: the first time each key in `adds` fires, the clock advances by its ms. `rewriteAfter` makes the first
   *  `project` call of the coordination store made while the last phase announced was that one advance the clock by 1,500. */
  arm(adds: Record<string, number>, rewriteAfter?: 'flush' | 'repair'): void;
}
/** Installs the hook. The "last phase" ignores `rewrite` (the lane may announce it from inside the port's closures). */
function rig(w: World, seams: Record<string, unknown> = {}): Rig {
  const st = { last: null as string | null, left: new Map<string, number>(), rewriteAfter: null as string | null };
  const fired: string[] = [];
  w.watcher.setDelegationSeams({
    ...seams,
    onPassPhase: (k: string): void => {
      fired.push(k);
      if (k !== 'rewrite') st.last = k;
      const ms = st.left.get(k);
      if (ms !== undefined) { st.left.delete(k); w.clock.t += ms; }
    },
  } as never);
  const project = w.coord.projectDelegationCheckpoint.bind(w.coord);
  w.coord.projectDelegationCheckpoint = ((cp: Parameters<CoordStore['projectDelegationCheckpoint']>[0]) => {
    if (st.rewriteAfter !== null && st.last === st.rewriteAfter) { st.rewriteAfter = null; w.clock.t += 1500; }
    return project(cp);
  }) as CoordStore['projectDelegationCheckpoint'];
  return {
    fired,
    arm: (adds, rewriteAfter) => { st.left = new Map(Object.entries(adds)); st.rewriteAfter = rewriteAfter ?? null; st.last = null; },
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

/** The standard fixture: a session ran a raw `git worktree add` (the incident's case), so the third census pass requests a lease and files
 *  an attempt. `last` passes run unarmed; the next one runs armed with `adds`. Every shape appends one line to the spool before the armed
 *  pass, so its flush has a result to apply. Fixture-sanity facts are read from spies on the real code, never from the new hook. */
async function scenario(shape: Shape, adds: Record<string, number>, rewriteAfter?: 'flush' | 'repair') {
  vi.restoreAllMocks();                                               // a row may run several scenarios: none inherits a spy of the last
  const warn = quietWarn();
  const w = world();
  writeBucket(w, 'demo-a', BUCKET10,
    startLine('demo-a', '2026-10-15T10:01:00.000Z'),
    bashPre('demo-a', 'toolu_wt1', ['old-tree'], '2026-10-15T10:05:00.000Z'),
    bashPost('demo-a', 'toolu_wt1', ['old-tree', 'raw-tree'], '2026-10-15T10:05:03.000Z'));
  await primed(w);
  const r = rig(w);
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
  const lastUnarmed = shape === 'absence' ? 4 : 2;
  for (let i = 0; i < lastUnarmed; i++) await censusPass(w, at(i), shape === 'absence' && i >= 3 ? { demo: [OLD] } : { demo: [OLD, RAW] });
  appendBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:06:00.000Z'));
  if (shape === 'recover') {
    // the applier is found failed at the pass's first check (once), so the lane's not-ready branch runs `recover()` (it is past the retry interval)
    vi.spyOn(proto, 'failure').mockReturnValueOnce({ code: 'journal-unreadable', detail: 'a fixture failure' } as never);
  }
  const before = {
    plan: plan.mock.calls.length, recover: spies.recover.mock.calls.length, createLease: spies.createLease.mock.calls.length,
    repair: spies.repair.mock.calls.length, applyAccepted: spies.applyAccepted.mock.calls.length,
  };
  r.arm(adds, rewriteAfter);
  await censusPass(w, at(lastUnarmed), shape === 'absence' ? { demo: [OLD] } : { demo: [OLD, RAW] });
  const kinds = (plan.mock.results.at(-1)!.value as ReturnType<typeof policy.planDelegationReconciliation>).map((e) => e.kind);
  return {
    w, warn, kinds,
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
      projected: projected.mock.calls.length, inserted: inserted.mock.calls.length,
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

describe('D-5692 R1 (a repair report): the five repair sizes are the repair\'s own report, and absent when no report came back', () => {
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
  const sizeKeys = ['repairPasses', 'repairInserted', 'repairFull', 'repairWiped', 'repairHealed'];

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
    expect(m.has('repair'), 'the repair phase ran').toBe(true);
  });

  it.each([
    { title: 'a null report', arrange: (repair: { mockResolvedValueOnce(v: null): unknown }) => { repair.mockResolvedValueOnce(null); } },
    { title: 'a repair that throws', arrange: (repair: { mockRejectedValueOnce(v: Error): unknown }) => { repair.mockRejectedValueOnce(new Error('a fixture failure')); } },
  ])('D-5692 R1: $title leaves all five repair sizes off the line, while the repair phase is on it', async ({ arrange }) => {
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
    const sc = await scenario(shape, adds, rewriteAfter);
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
    expect(text).toMatch(/^ccrc-server: delegation pass slow:( [a-z][a-zA-Z]*=\d+)+$/);
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
