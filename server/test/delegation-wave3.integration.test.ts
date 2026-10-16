// Delegation broker wave 3, Task 16: the integrated gate. Wave 3 is OBSERVATION ONLY (spec 2026-10-04 stage 2): hooks write an owner
// spool, the server ingests it into a journal and a checkpoint, correlates the worktree census against that evidence, reports, and
// measures its own coverage for seven days. Every row below runs the ASSEMBLED wave (the real hook, the real watcher lane, the real
// durable applier, the real coordination store, the real health route) over fixture homes, and the closed census at the end proves
// that nothing of waves 4 to 7 came in with it. No production API is added by this file.
//
//   1. new fleet, old server       the hook fills and expires the spool on its own; no carrier, no cleanup, no server state
//   1b. end to end                 the real hook's lines become journal records, a checkpoint, SQLite rows and a health
//   2. new server, old fleet/peer  a missing capability or a byte response without `dataB64` is `unmeasured`, never empty or zero
//   3. a lost coord.db             the checkpoint and the journal give back the same IDs and the same interval health
//   4. a checkpoint that disagrees startup refuses the observation lane and prunes nothing
//   5. retained pre-checkpoint evidence opens a missing activity from its accepted journal ID
//   6. run-child agreement         stays owned by the run/child model and never becomes a lease
//   7. the seven-day gate          below 1% over a complete window is eligible, and eligibility enables nothing
//   8. the closed scope census     see its own header
//
// Every directory is a FIXTURE home: nothing reads or writes the live `~/.ccrc` or `~/.cc-sessions`, no ccd verb runs, and the hook is
// handed a stub tmux on a private PATH.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { createIo } from '../src/remote/io.js';
import type { FleetClient } from '../src/remote/client.js';
import { FleetWatcher, DELEGATION_SWEEP_MS } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { buildServer } from '../src/server.js';
import { type DelegationCensusPass, type ParentIncarnation, type WorktreeCensus } from '../src/coord/gitref.js';
import { DELEGATION_CHECKPOINT_FILE, decodeDelegationCheckpoint, encodeDelegationCheckpoint, validateDelegationCheckpoint } from '../src/coord/delegation-checkpoint.js';
import { DELEGATION_JOURNAL_FILE } from '../src/coord/delegation-journal.js';
import { parseDelegationSpoolLine } from '../src/coord/delegation-ingest.js';
import { correlateDelegation, DELEGATION_DROPPED_UNMEASURED } from '../src/coord/delegation-correlation.js';
import {
  DELEGATION_EVENTS_CAP,
  DELEGATION_HOUR_MS,
  DELEGATION_JOURNAL_ENTRY_KINDS,
  canonicalDelegationJson,
  delegationLeaseCodec,
  deriveDelegationActivityId,
  encodeDelegationNaturalKey,
  formatDelegationInstant,
  projectionViewOfDelegationCheckpoint,
  type DelegationAttemptRow,
  type DelegationCensusRecord,
  type DelegationCheckpointV1,
  type DelegationLeaseRow,
} from '../src/coord/delegation-model.js';
import { FLEET_PROTO, FLEET_PROTO_MIN, type DelegationObservationHealth } from '../../shared/api.js';
import { READ_FROM_MAX_BYTES } from '../../shared/agent-protocol.js';
import { makeCcdHarness } from './ccdWsHelpers.js';
import * as policy from '../src/coord/delegation-policy.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const REPO_ROOT = path.resolve(__dirname, '../..');
const HOOK = path.join(REPO_ROOT, 'ccd/session-hook.sh');
const INC = '0189abcd-1234-5678-9abc-0123456789ab';
const CLAUDE = '6350faa0-a1be-4e78-939c-57485268f6fc';
const OWNER = 'demo-a';
const NOW = Date.UTC(2026, 9, 15, 10, 30, 0);                       // 2026-10-15T10:30Z; the hour 10:00 is open
const STEP = DELEGATION_SWEEP_MS;
const HOUR = DELEGATION_HOUR_MS;
const iso = (ms: number): string => formatDelegationInstant(ms);
const bucketOf = (ms: number): string => iso(ms).slice(0, 13).replace(/[-T]/g, '');

// ── the lane's world: a fixture home, a watcher over it, and the spool the hook wrote ─────────────────────────────────────

interface Faults { range: Set<string> }
interface World {
  home: string;
  reg: string;
  ccrcDir: string;
  watcher: FleetWatcher;
  coord: CoordStore;
  faults: Faults;
  calls: { listings: string[]; ranges: string[] };
  /** Every write the lane asked its fleet io for (there must be none) and every exec it asked for (there must be none). */
  writes: string[];
  run: ReturnType<typeof vi.fn>;
  cfg: ReturnType<typeof loadConfig>;
  deps: Record<string, unknown>;
}
interface WorldOptions { home?: string; ccdVerbs?: string[] | null; bytes?: FleetIO['readFileFromBytesMeasured'] }

const worlds: World[] = [];
afterEach(async () => {
  // The lane's two standing promises hold in EVERY row of this file: it never writes through the fleet io, and it never execs.
  for (const w of worlds) {
    expect(w.writes, 'the lane wrote through its fleet io').toEqual([]);
    expect(w.run, 'the lane ran a command').not.toHaveBeenCalled();
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(worlds.splice(0).map((w) => w.watcher.closeDelegation().catch(() => undefined)));
});

function world(opts: WorldOptions = {}): World {
  const home = opts.home ?? mkTmp('ccrc-dlgint-');
  const projectsRoot = mkTmp('ccrc-dlgint-projects-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: projectsRoot } as never);
  const faults: Faults = { range: new Set() };
  const calls = { listings: [] as string[], ranges: [] as string[] };
  const writes: string[] = [];
  const run = vi.fn(async () => ({ code: 1, stdout: '', stderr: '' }));
  const spoolOwner = (p: string): string | null => (p.includes('/delegation/spool/') ? path.basename(p.endsWith('.spool') ? path.dirname(p) : p) : null);
  const bytes = opts.bytes ?? localIO.readFileFromBytesMeasured.bind(localIO);
  const io: FleetIO = {
    ...localIO,
    readdirMeasured: async (p, t, s) => {
      const owner = spoolOwner(p);
      if (owner !== null) calls.listings.push(owner);
      return localIO.readdirMeasured(p, t, s);
    },
    readFileFromBytesMeasured: async (p, o, m, t, s) => {
      const owner = spoolOwner(p);
      if (owner !== null) {
        calls.ranges.push(`${owner}/${path.basename(p)}`);
        if (faults.range.has(owner)) return { ok: false, reason: 'unreadable' };
      }
      return bytes(p, o, m, t, s);
    },
    writeFileB64: async (p) => { writes.push(p); throw new Error('the lane must not write through its fleet io'); },
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const ccdVerbs = opts.ccdVerbs === undefined ? ['caps', DELEGATION_EVENTS_CAP] : opts.ccdVerbs;
  const deps = { ...testDeps(home, run), cfg, io, coord, fleetState: { connected: true, downSince: null, ccdVerbs } };
  const made: World = { home, reg: cfg.registryDir, ccrcDir: cfg.ccrcDir, watcher: new FleetWatcher(deps as never, new Bus(), 10_000), coord, faults, calls, writes, run, cfg, deps };
  worlds.push(made);
  return made;
}

const sessionOf = (id: string, status: 'idle' | 'busy' | 'dead' = 'idle', project = 'demo') => ({ id, project, status });
const recordOf = (id: string, project = 'demo', child: { kind: 'none' | 'child' | 'unreadable' } = { kind: 'none' }) => ({ id, project, child });
type Sess = ReturnType<typeof sessionOf>;
type Rec = ReturnType<typeof recordOf>;

const spoolDir = (w: World, owner: string): string => path.join(w.reg, 'delegation', 'spool', owner);
const makeOwner = (w: World, owner: string): void => { mkdirSync(spoolDir(w, owner), { recursive: true }); };
const lineOf = (obj: unknown): string => `${JSON.stringify(obj)}\n`;
const common = (owner: string, extra: Record<string, unknown>, at: string, inc = INC) =>
  ({ v: 1, observedAt: at, sessionId: owner, parentIncarnation: inc, claudeSessionId: CLAUDE, ...extra });
const startLine = (owner: string, at = '2026-10-15T10:05:00.000Z'): string => lineOf(common(owner, { eventKind: 'SessionStart', source: 'startup' }, at));
const writeBucket = (w: World, owner: string, bucket: string, ...lines: string[]): void => {
  makeOwner(w, owner);
  writeFileSync(path.join(spoolDir(w, owner), `${bucket}.spool`), lines.join(''));
};
const appendBucket = (w: World, owner: string, bucket: string, ...lines: string[]): void => { appendFileSync(path.join(spoolDir(w, owner), `${bucket}.spool`), lines.join('')); };

const record = (project: string, adminRecord: string, over: Partial<DelegationCensusRecord> = {}): DelegationCensusRecord => ({
  project, adminRecord, canonicalPath: `/w/${project}/.claude/worktrees/${adminRecord}`, headBranch: null, headSha: 'a'.repeat(40),
  claudeBase: 'b'.repeat(40), locked: false, baseAgreesFirstLog: true, state: 'present', diagnostic: null, ...over,
});
type CensusView = DelegationCensusRecord[] | WorktreeCensus;
function setCensus(w: World, projects: Record<string, CensusView>, incarnations: Record<string, ParentIncarnation>, measuredAt: number): DelegationCensusPass {
  const view = (recs: CensusView): WorktreeCensus => (Array.isArray(recs) ? { read: { ok: true, records: [] }, delegation: recs } : recs);
  const pass: DelegationCensusPass = {
    measuredAt, projects: new Map(Object.entries(projects).map(([p, recs]) => [p, view(recs)] as const)),
    incarnations: new Map(Object.entries(incarnations)),
  };
  (w.watcher as unknown as { delegationCensus: DelegationCensusPass | null }).delegationCensus = pass;
  return pass;
}
const measured = (inc = INC): ParentIncarnation => ({ kind: 'measured', incarnation: inc });
const setNow = (ms: number): void => { vi.spyOn(Date, 'now').mockReturnValue(ms); };
/** One whole pass at `at`, with a census taken at `at` (the lane reconciles only a census it has not reconciled yet). */
const censusPass = async (
  w: World, at: number, projects: Record<string, CensusView>, sessions: readonly Sess[] = [sessionOf(OWNER)], records?: readonly Rec[],
): Promise<void> => {
  setNow(at);
  setCensus(w, projects, Object.fromEntries(sessions.map((s) => [s.id, measured()])), at);
  await w.watcher.sweepDelegation(sessions as never, (records ?? sessions.map((s) => recordOf(s.id, s.project))) as never);
};

const disk = (home: string): { checkpoint: DelegationCheckpointV1 | null; journal: string } => {
  const cp = path.join(home, '.ccrc', DELEGATION_CHECKPOINT_FILE);
  const jr = path.join(home, '.ccrc', DELEGATION_JOURNAL_FILE);
  return { checkpoint: existsSync(cp) ? decodeDelegationCheckpoint(new Uint8Array(readFileSync(cp))) : null, journal: existsSync(jr) ? readFileSync(jr, 'utf8') : '' };
};
const journalRecords = (home: string): Array<Record<string, unknown>> =>
  disk(home).journal.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>);
const intervalsOf = (home: string) => disk(home).checkpoint?.observationIntervals ?? [];
const intervalFor = (home: string, owner: string, hourMs: number, inc = INC) =>
  intervalsOf(home).find((r) => r.sessionId === owner && r.parentIncarnation === inc && r.utcHour === iso(hourMs));
const leasesOf = (home: string) => disk(home).checkpoint?.leases ?? [];

/** The health route, built the way the server builds it. */
async function healthBody(w: World): Promise<{ delegation?: DelegationObservationHealth } & Record<string, unknown>> {
  const app = await buildServer(w.deps as never, new Bus(), w.watcher);
  try {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/health' });
    expect(res.statusCode).toBe(200);
    return res.json() as { delegation?: DelegationObservationHealth } & Record<string, unknown>;
  } finally { await app.close(); }
}

// ── the hook's world: the real ccd/session-hook.sh over a fixture registry ───────────────────────────────────────────────

const REAL_JQ = ((): string => { try { return execFileSync('sh', ['-c', 'command -v jq'], { encoding: 'utf8' }).trim(); } catch { return ''; } })();

interface HookWorld {
  home: string;
  reg: string;
  repo: string;
  ownerDir: string;
  fire: (payload: Record<string, unknown>) => void;
  lines: () => Array<Record<string, any>>;
  rawLines: () => string[];
}
/** A fixture HOME with a registry row's generation (36 bytes, no LF), a stub tmux that names the session, the owner's spool directory
 *  as ccd makes it at spawn, and a main checkout the hook can list (`.git/worktrees/<name>`; no git binary is involved). */
function hookWorld(owner = OWNER): HookWorld {
  const home = mkTmp('ccrc-dlgint-hook-');
  const reg = path.join(home, '.cc-sessions');
  const repo = path.join(home, 'projects', 'demo');
  const ownerDir = path.join(reg, 'delegation', 'spool', owner);
  mkdirSync(ownerDir, { recursive: true, mode: 0o700 });
  mkdirSync(path.join(repo, '.git', 'worktrees', 'old-tree'), { recursive: true });
  mkdirSync(path.join(home, 'bin'), { recursive: true });
  writeFileSync(path.join(reg, `${owner}.generation`), INC);
  writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${owner}"\n`, { mode: 0o755 });
  const env: NodeJS.ProcessEnv = {
    ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
    TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: INC, CLAUDE_CODE_EXECPATH: '',
  };
  const rawLines = (): string[] => readdirSync(ownerDir).filter((f) => /^\d{10}\.spool$/.test(f)).sort()
    .flatMap((f) => readFileSync(path.join(ownerDir, f), 'utf8').split('\n').filter((l) => l !== ''));
  return {
    home, reg, repo, ownerDir, rawLines, lines: () => rawLines().map((l) => JSON.parse(l) as Record<string, any>),
    fire: (payload) => {
      const r = spawnSync('bash', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env, timeout: 120_000 });
      expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
    },
  };
}
const hookEvent = (hw: HookWorld, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ session_id: CLAUDE, transcript_path: path.join(hw.home, 'cfg', 'projects', '-demo', `${CLAUDE}.jsonl`), cwd: hw.repo, hook_event_name: name, ...extra });
const WORKTREE_CMD = 'git worktree add ../raw-tree';

/** Every file and directory under `dir`, relative, sorted. Symlinks are listed and not followed. */
function walk(dir: string): string[] {
  const out: string[] = [];
  const rec = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      out.push(path.relative(dir, p) + (e.isDirectory() ? '/' : ''));
      if (e.isDirectory()) rec(p);
    }
  };
  if (existsSync(dir)) rec(dir);
  return out.sort();
}
/** A digest of every regular file under `dir`: path, then content. Equal digests mean the tree was not written. */
function treeDigest(dir: string): string {
  const h = createHash('sha256');
  for (const rel of walk(dir)) {
    const p = path.join(dir, rel);
    h.update(rel).update('\0');
    if (!rel.endsWith('/') && lstatSync(p).isFile()) h.update(readFileSync(p)).update('\0');
  }
  return h.digest('hex');
}
/** A name that would be a carrier, a cleanup, an audit or an adoption on the fleet: none may appear under the registry. */
const LATER_WAVE_NAME = /(^|\/)leases(\/|$)|lease-?(mark|audit|clean)|carrier|delegation-adopt|cleanup|\.lease(\.|$)/i;

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 1. A NEW FLEET UNDER AN OLD SERVER: spools fill and expire; no carriers, no cleanup (spec §5.13)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe.skipIf(REAL_JQ === '')('1. new fleet, old server: the spool fills and expires by itself, and nothing else of the broker appears on the fleet', () => {
  it('the real hook writes only owner-scoped spool lines the server\'s own parser accepts; no carrier, no cleanup, no server state', () => {
    const hw = hookWorld();
    hw.fire(hookEvent(hw, 'SessionStart', { source: 'startup' }));
    hw.fire(hookEvent(hw, 'SubagentStart', { agent_id: 'a516cb53d83b231c7', agent_type: 'general-purpose' }));
    hw.fire(hookEvent(hw, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: WORKTREE_CMD }, tool_use_id: 'toolu_wt1' }));
    mkdirSync(path.join(hw.repo, '.git', 'worktrees', 'raw-tree'));
    hw.fire(hookEvent(hw, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: WORKTREE_CMD }, tool_response: { stdout: '', interrupted: false }, tool_use_id: 'toolu_wt1' }));
    const raws = hw.rawLines();
    expect(raws.map((l) => (JSON.parse(l) as { eventKind: string }).eventKind)).toEqual(['SessionStart', 'SubagentStart', 'PreToolUse', 'PostToolUse']);
    for (const raw of raws) {
      expect(Buffer.byteLength(raw) + 1, 'a line plus its LF is under 4096 bytes').toBeLessThan(4096);
      expect(parseDelegationSpoolLine(Buffer.from(raw, 'utf8'), { sessionId: OWNER, parentIncarnation: INC }).ok, raw.slice(0, 200)).toBe(true);
    }
    expect(hw.lines().map((l) => l['listing'] ?? null)).toEqual([null, null, ['old-tree'], ['old-tree', 'raw-tree']]);
    // the registry holds the spool and the session's own files, and nothing that is a carrier, a cleanup, an audit or an adoption
    const tree = walk(hw.reg);
    expect(tree.filter((p) => LATER_WAVE_NAME.test(p)), tree.join('\n')).toEqual([]);
    expect(readdirSync(path.join(hw.reg, 'delegation')), 'the delegation root holds the spool and nothing else').toEqual(['spool']);
    expect(readdirSync(path.join(hw.reg, 'delegation', 'spool'))).toEqual([OWNER]);
    expect(readdirSync(hw.ownerDir).every((f) => /^\d{10}\.spool$/.test(f)), 'the owner directory holds buckets only').toBe(true);
    // an old server is no server: the hook makes none of the server's files
    expect(existsSync(path.join(hw.home, '.ccrc')), 'the fleet side made server state').toBe(false);
  });

  it('spools expire by themselves: the first write of an hour prunes the OWNER\'s buckets older than 24 hours and nothing else', () => {
    const hw = hookWorld();
    const sibling = path.join(hw.reg, 'delegation', 'spool', 'demo-b');
    mkdirSync(sibling, { recursive: true });
    const plant = (dir: string, ageHours: number): string => {
      const p = path.join(dir, `${bucketOf(Date.now() - ageHours * HOUR)}.spool`);
      writeFileSync(p, '{"old":1}\n');
      return p;
    };
    const old1 = plant(hw.ownerDir, 25);
    const old2 = plant(hw.ownerDir, 30 * 24);
    const young = plant(hw.ownerDir, 23);
    const theirs = plant(sibling, 30);
    const stray = path.join(hw.reg, 'delegation', 'spool', '2026010100.spool');
    writeFileSync(stray, 'x\n');
    const before = bucketOf(Date.now());
    hw.fire(hookEvent(hw, 'SessionStart', { source: 'startup' }));
    if (bucketOf(Date.now()) !== before) return;                      // the hour turned mid-row: the cutoff it measured is another one
    expect(existsSync(old1), '25 hours old').toBe(false);
    expect(existsSync(old2), '30 days old').toBe(false);
    expect(existsSync(young), '23 hours old').toBe(true);
    expect(existsSync(theirs), 'another owner\'s old bucket is not this hook\'s to prune').toBe(true);
    expect(existsSync(stray), 'a file outside any owner directory').toBe(true);
    expect(existsSync(path.join(hw.home, '.ccrc'))).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 1b. END TO END: the real hook's spool, the real lane, the journal, the checkpoint, SQLite and the health
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const OLD = record('demo', 'old-tree');
const RAW = record('demo', 'raw-tree');
const AGENT_ID = 'a516cb53d83b231c7';

/** A session that started, ran a subagent, and ran a raw `git worktree add` through the REAL hook; then four lane passes over it. */
async function endToEnd(): Promise<{ w: World; hw: HookWorld; at: (n: number) => number }> {
  const hw = hookWorld();
  hw.fire(hookEvent(hw, 'SessionStart', { source: 'startup' }));
  hw.fire(hookEvent(hw, 'SubagentStart', { agent_id: AGENT_ID, agent_type: 'general-purpose' }));
  hw.fire(hookEvent(hw, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: WORKTREE_CMD }, tool_use_id: 'toolu_wt1' }));
  mkdirSync(path.join(hw.repo, '.git', 'worktrees', 'raw-tree'));
  hw.fire(hookEvent(hw, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: WORKTREE_CMD }, tool_response: { stdout: '', interrupted: false }, tool_use_id: 'toolu_wt1' }));
  const last = hw.lines().at(-1)!['observedAt'] as string;
  const t0 = Date.parse(last) + 1000;
  const w = world({ home: hw.home });
  expect(w.reg, 'the lane reads the registry the hook wrote').toBe(hw.reg);
  const at = (n: number): number => t0 + n * STEP;
  for (let i = 0; i < 4; i++) await censusPass(w, at(i), { demo: [OLD, RAW] });
  return { w, hw, at };
}

describe.skipIf(REAL_JQ === '')('1b. end to end: the real hook feeds the real lane, and the result is journaled, checkpointed, projected and reported', () => {
  it('one session, one subagent and one raw worktree become records, an activity, a lease IDENTITY, SQLite rows and a health; no carrier is written', async () => {
    const { w, hw } = await endToEnd();
    const regAfterPasses = treeDigest(hw.reg);
    const d = disk(w.home);
    const cp = d.checkpoint!;
    expect(journalRecords(w.home).map((r) => (r['entry'] as { kind: string; event?: { eventKind: string } }).kind)).toEqual([
      'evidence-accepted', 'evidence-accepted', 'evidence-accepted', 'evidence-accepted', 'lease-created',
    ]);
    expect(cp.sessions.map((s) => [s.sessionId, s.parentIncarnation])).toEqual([[OWNER, INC]]);
    expect(cp.activities.map((a) => `${a.sourceKind} ${a.upstreamId}`).sort(), 'rows are ordered by ID, which derives from the real clock').toEqual([`agent ${AGENT_ID}`, 'bash-worktree toolu_wt1']);
    const leases = leasesOf(w.home);
    expect(leases).toHaveLength(1);
    expect(leases[0]).toMatchObject({ adminRecord: 'raw-tree', sourceKind: 'raw', parentId: OWNER, parentageState: 'linked', generation: 0, disposition: 'ephemeral', cleanupState: 'not-due', releasedAt: null });
    expect(cp.attempts.map((a) => [a.adminRecord, a.verdict, a.rung])).toEqual([['raw-tree', 'linked', 4]]);
    // SQLite is a projection of exactly that checkpoint, and carries the journal's events
    expect(canonicalDelegationJson(w.coord.readDelegationProjection())).toBe(canonicalDelegationJson(projectionViewOfDelegationCheckpoint(cp)));
    expect(w.coord.delegationEventStats(), 'four evidence events; the lease entry is journal sequence 5 and is not an event').toEqual({ count: 4, maxSequence: 4 });
    // the health is the checkpoint's: report-only, one open hour is not a seven-day window, and the rate is unknown rather than zero
    const health = (await healthBody(w)).delegation!;
    expect(health).toMatchObject({ mode: 'report-only', stageGate: 'unmeasured', unmeasuredRate: null, lastJournalSequence: 5, lastCheckpointRevision: cp.revision });
    // observation wrote nothing to the fleet's registry (the lane only reads it), least of all a carrier
    expect(treeDigest(hw.reg), 'the lane only reads the registry').toBe(regAfterPasses);
    expect(walk(hw.reg).filter((p) => LATER_WAVE_NAME.test(p))).toEqual([]);
    expect(existsSync(path.join(hw.reg, 'delegation', 'leases'))).toBe(false);
  }, 120_000);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 2. A NEW SERVER OVER AN OLD FLEET, OR AN OLD PEER: evidence is `unmeasured`, never empty and never zero (spec §5.13)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('2. new server, old fleet or old peer: delegation evidence is unmeasured, and no health surface says empty or zero', () => {
  it('a fleet whose `ccd caps` lacks the token, or never answered: nothing is read, the hour is a gap, the gate is unmeasured with a null rate', async () => {
    for (const [verbs, word] of [[['caps', 'ws-rm'], 'capability-absent'], [null, 'capability-unmeasured']] as const) {
      const w = world({ ccdVerbs: verbs === null ? null : [...verbs] });
      writeBucket(w, OWNER, bucketOf(NOW), startLine(OWNER));
      await censusPass(w, NOW, { demo: [] });
      expect(w.calls.listings, `${word}: an old fleet is not read`).toEqual([]);
      expect(disk(w.home).journal).toBe('');
      expect(intervalFor(w.home, OWNER, Math.floor(NOW / HOUR) * HOUR), word).toMatchObject({ state: 'unmeasured', detail: expect.stringMatching(new RegExp(`^${word}`)) });
      const body = await healthBody(w);
      expect(body.delegation, word).toMatchObject({ mode: 'report-only', stageGate: 'unmeasured', unmeasuredRate: null, lastJournalSequence: null });
      expect(body.delegation!.unmeasuredRate, 'unknown is not zero').not.toBe(0);
      expect(w.coord.delegationEventStats()).toEqual({ count: 0, maxSequence: null });
    }
  });

  /** A peer standing where the agent stands. `modern` answers `dataB64`; an old one ignores `maxBytes` and answers decoded `data` alone. */
  function peer(modern: boolean): { client: FleetClient; requests: Array<Record<string, unknown>> } {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      request: async (req: Record<string, unknown>) => {
        requests.push(req);
        if (req['op'] !== 'readFrom') throw new Error(`the lane asked for ${String(req['op'])}, which is not the existing range read`);
        const file = readFileSync(String(req['path']));
        const from = Number(req['offset']);
        if (!modern) return { data: file.subarray(from).toString('utf8'), size: file.length };
        const slice = file.subarray(from, from + Number(req['maxBytes']));
        return { data: slice.toString('utf8'), dataB64: slice.toString('base64'), size: file.length };
      },
    } as unknown as FleetClient;
    return { client, requests };
  }

  it('an old peer without the byte response: the range is unreadable, nothing is journaled, the hour is a gap; the same bytes read once the peer can answer', async () => {
    const old = peer(false);
    const w = world({ bytes: createIo(old.client).readFileFromBytesMeasured.bind(createIo(old.client)) });
    writeBucket(w, OWNER, bucketOf(NOW), startLine(OWNER));
    await censusPass(w, NOW, { demo: [] });
    expect(old.requests.length).toBeGreaterThan(0);
    for (const r of old.requests) {
      // the existing op with one optional field: no new request member, and the bound is the shared one
      expect(r['op']).toBe('readFrom');
      expect(r['maxBytes']).toBeLessThanOrEqual(READ_FROM_MAX_BYTES);
      expect(Object.keys(r).sort()).toEqual(['maxBytes', 'offset', 'op', 'path', 't']);
    }
    expect(disk(w.home).journal, 'bytes are never rebuilt from decoded text').toBe('');
    const hour = Math.floor(NOW / HOUR) * HOUR;
    expect(intervalFor(w.home, OWNER, hour)).toMatchObject({ state: 'unmeasured', detail: expect.stringMatching(/^range-unreadable/) });
    expect((await healthBody(w)).delegation).toMatchObject({ stageGate: 'unmeasured', unmeasuredRate: null });
    // the peer is upgraded: the evidence flows, and the hour that was a gap stays a gap (an unmeasured hour is final)
    const modern = peer(true);
    const again = world({ home: w.home, bytes: createIo(modern.client).readFileFromBytesMeasured.bind(createIo(modern.client)) });
    await censusPass(again, NOW + STEP, { demo: [] });
    expect(journalRecords(w.home)).toHaveLength(1);
    expect(intervalFor(w.home, OWNER, hour)).toMatchObject({ state: 'unmeasured' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 3. A LOST coord.db: the checkpoint and the journal restore the exact IDs and the interval health (O3, O5)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const ids = (cp: DelegationCheckpointV1) => ({
  activities: cp.activities.map((a) => a.activityId).sort(), leases: cp.leases.map((l) => l.leaseId).sort(),
  lineage: cp.lineage.map((l) => l.lineageId).sort(), attempts: cp.attempts.map((a) => a.attemptId).sort(), naturalKeys: cp.activityIdsByNaturalKey,
});
const loseDb = (home: string): void => { for (const f of ['coord.db', 'coord.db-wal', 'coord.db-shm']) rmSync(path.join(home, '.ccrc', f), { force: true }); };

describe.skipIf(REAL_JQ === '')('3. a lost coord.db: the checkpoint and the journal give back the same IDs, the same rows and the same interval health', () => {
  it('SQLite is rebuilt from the durable pair: every activity, lease, lineage and attempt ID is the one it was, and so is the health', async () => {
    const { w, hw, at } = await endToEnd();
    const before = { cp: disk(w.home).checkpoint!, journal: disk(w.home).journal, health: w.watcher.currentDelegationHealth()!, projection: canonicalDelegationJson(w.coord.readDelegationProjection()) };
    expect(before.cp.leases).toHaveLength(1);
    loseDb(w.home);
    const again = world({ home: w.home });
    await censusPass(again, at(4), { demo: [OLD, RAW] });
    const after = disk(again.home);
    expect(ids(after.checkpoint!), 'the IDs live in the checkpoint and the journal, not in SQLite').toEqual(ids(before.cp));
    expect(after.journal, 'a restart appends nothing it already holds').toBe(before.journal);
    expect(canonicalDelegationJson(again.coord.readDelegationProjection()), 'SQLite is the same projection').toBe(before.projection);
    expect(again.coord.delegationEventStats()).toEqual({ count: 4, maxSequence: 4 });
    const health = again.watcher.currentDelegationHealth()!;
    for (const k of ['measuredSessionHours', 'unmeasuredSessionHours', 'lastJournalSequence', 'stageGate', 'unmeasuredRate', 'mode'] as const) expect(health[k], k).toEqual(before.health[k]);
    expect(after.checkpoint!.observationIntervals.map((r) => [r.sessionId, r.utcHour, r.state])).toEqual(before.cp.observationIntervals.map((r) => [r.sessionId, r.utcHour, r.state]));
    expect(walk(hw.reg).filter((p) => LATER_WAVE_NAME.test(p))).toEqual([]);
  }, 120_000);

  it('a lost checkpoint as well: the journal alone gives back the same activity, lease and lineage IDs, and the health says unmeasured rather than zero', async () => {
    const { w, at } = await endToEnd();
    const before = disk(w.home).checkpoint!;
    loseDb(w.home);
    rmSync(path.join(w.home, '.ccrc', DELEGATION_CHECKPOINT_FILE));
    const again = world({ home: w.home });
    await censusPass(again, at(4), { demo: [OLD, RAW] });
    const after = disk(again.home).checkpoint!;
    expect(after.activities.map((a) => a.activityId).sort()).toEqual(before.activities.map((a) => a.activityId).sort());
    expect(after.leases.map((l) => l.leaseId)).toEqual(before.leases.map((l) => l.leaseId));
    expect(after.lineage.map((l) => l.lineageId).sort()).toEqual(before.lineage.map((l) => l.lineageId).sort());
    expect(after.activityIdsByNaturalKey).toEqual(before.activityIdsByNaturalKey);
    // what only the checkpoint held is not invented: the earlier intervals are gone, and the gate says so
    expect(again.watcher.currentDelegationHealth()).toMatchObject({ stageGate: 'unmeasured', unmeasuredRate: null });
  }, 120_000);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 4. A CHECKPOINT THAT DISAGREES WITH ITS JOURNAL: startup refuses the observation lane; nothing is read, applied or pruned (O2)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('4. checkpoint mismatch: the observation lane is refused at startup, nothing is read or written, and pruning stays disabled', () => {
  const lines = (): string[] => [startLine(OWNER, '2026-10-15T10:01:00.000Z'), startLine(OWNER, '2026-10-15T10:02:00.000Z'), startLine(OWNER, '2026-10-15T10:03:00.000Z')];
  /** A home with a journal of three records and a checkpoint that covers them. */
  async function settled(spool: string[] = lines()): Promise<{ home: string; journal: string; checkpoint: Uint8Array }> {
    const w = world();
    writeBucket(w, OWNER, bucketOf(NOW), ...spool);
    await censusPass(w, NOW, { demo: [] });
    await w.watcher.closeDelegation();
    const j = path.join(w.home, '.ccrc', DELEGATION_JOURNAL_FILE);
    const c = path.join(w.home, '.ccrc', DELEGATION_CHECKPOINT_FILE);
    expect(readFileSync(j, 'utf8').split('\n').filter(Boolean)).toHaveLength(3);
    return { home: w.home, journal: readFileSync(j, 'utf8'), checkpoint: new Uint8Array(readFileSync(c)) };
  }
  const tampers: Array<[string, (s: { home: string; journal: string; checkpoint: Uint8Array }) => Promise<void> | void]> = [
    ['the journal lost its last record (the checkpoint is ahead of its journal)', (s) => {
      writeFileSync(path.join(s.home, '.ccrc', DELEGATION_JOURNAL_FILE), s.journal.split('\n').filter(Boolean).slice(0, 2).join('\n') + '\n');
    }],
    ['the checkpoint\'s anchor names a digest the journal does not hold', (s) => {
      const cp = decodeDelegationCheckpoint(s.checkpoint);
      writeFileSync(path.join(s.home, '.ccrc', DELEGATION_CHECKPOINT_FILE), encodeDelegationCheckpoint({ ...cp, appliedJournalDigest: 'f'.repeat(64) }));
    }],
    ['the journal is another history\'s (three records of its own, whose chain never reaches the checkpoint\'s anchor)', async (s) => {
      const other = await settled([startLine(OWNER, '2026-10-15T10:11:00.000Z'), startLine(OWNER, '2026-10-15T10:12:00.000Z'), startLine(OWNER, '2026-10-15T10:13:00.000Z')]);
      expect(other.journal).not.toBe(s.journal);
      writeFileSync(path.join(s.home, '.ccrc', DELEGATION_JOURNAL_FILE), other.journal);
    }],
  ];
  for (const [name, tamper] of tampers) {
    it(`${name}: the lane reads nothing, writes nothing, prunes nothing, and the health is unmeasured`, async () => {
      const s = await settled();
      await tamper(s);
      const files = (): string => treeDigest(path.join(s.home, '.ccrc'));
      const filesBefore = files();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const again = world({ home: s.home });
      appendBucket(again, OWNER, bucketOf(NOW), startLine(OWNER, '2026-10-15T10:04:00.000Z'));
      const sqlBefore = canonicalDelegationJson(again.coord.readDelegationProjection());
      await censusPass(again, NOW + STEP, { demo: [] });
      const applier = (await again.watcher.delegationApplier())!;
      expect(applier.state().phase).toBe('reconstructing');
      expect(applier.failure()?.phase, 'the recovery says why: the journal and the checkpoint do not agree').toBe('journal-validate');
      expect(applier.pruningEnabled(), 'O2: pruning is disabled until a recovery completes').toBe(false);
      expect((await applier.planPruning(NOW, 0)).enabled).toBe(false);
      expect(warn.mock.calls.map((c) => String(c[0])).some((m) => /delegation recovery failed/.test(m))).toBe(true);
      expect(again.calls.listings, 'no bucket was read').toEqual([]);
      expect(files(), 'neither the journal, the checkpoint nor anything else was touched').toBe(filesBefore);
      expect(canonicalDelegationJson(again.coord.readDelegationProjection()), 'SQLite was not touched').toBe(sqlBefore);
      expect(again.watcher.currentDelegationHealth()).toMatchObject({ stageGate: 'unmeasured', unmeasuredRate: null, lastJournalSequence: null, lastCheckpointRevision: null });
      expect((await healthBody(again)).delegation).toMatchObject({ stageGate: 'unmeasured' });
    });
  }

  it('the refusal is not a latch: once the files agree again the lane recovers on its next attempt and reads what it had to leave', async () => {
    const s = await settled();
    const jPath = path.join(s.home, '.ccrc', DELEGATION_JOURNAL_FILE);
    writeFileSync(jPath, s.journal.split('\n').filter(Boolean).slice(0, 2).join('\n') + '\n');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const again = world({ home: s.home });
    appendBucket(again, OWNER, bucketOf(NOW), startLine(OWNER, '2026-10-15T10:04:00.000Z'));
    await censusPass(again, NOW + STEP, { demo: [] });
    expect((await again.watcher.delegationApplier())!.state().phase).toBe('reconstructing');
    writeFileSync(jPath, s.journal);                                   // the operator put the right journal back
    await censusPass(again, NOW + 7 * 60_000, { demo: [] });
    const applier = (await again.watcher.delegationApplier())!;
    expect(applier.state().phase).toBe('ready');
    expect(applier.pruningEnabled()).toBe(true);
    expect(journalRecords(s.home)).toHaveLength(4);                    // the line appended while refused was read once the lane was ready
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 5. RETAINED PRE-CHECKPOINT EVIDENCE opens a missing activity from its accepted journal ID (O2, O4)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('5. retained pre-checkpoint evidence opens an activity the checkpoint lacks, from the journal ID that first named it', () => {
  const bare = (at: string): string => lineOf(common(OWNER, { eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 'toolu_b1', outcome: 'completed', agentId: AGENT_ID }, at));
  const join = (at: string): string => lineOf(common(OWNER, { eventKind: 'SubagentStart', agentId: AGENT_ID, agentType: null }, at));
  const key = { parentId: OWNER, parentIncarnation: INC, sourceKind: 'agent' as const, upstreamId: AGENT_ID };

  it('a tool event naming an agent is evidence before it is an activity; the join, after a restart, opens it with the ID derived from THAT record', async () => {
    const first = world();
    writeBucket(first, OWNER, bucketOf(NOW), startLine(OWNER, '2026-10-15T10:01:00.000Z'), bare('2026-10-15T10:02:00.000Z'));
    await censusPass(first, NOW, { demo: [] });
    const cp1 = disk(first.home).checkpoint!;
    expect(cp1.appliedJournalSequence).toBe(2);
    expect(cp1.activities, 'a bare agent_id is not a join').toEqual([]);
    expect(cp1.pruningHolds.filter((h) => h.reason === 'identity-candidate'), 'the identity record is held').toHaveLength(1);
    const identity = journalRecords(first.home)[1]!;
    await first.watcher.closeDelegation();

    const again = world({ home: first.home });                          // a restart: no memory, the same ~/.ccrc
    appendBucket(again, OWNER, bucketOf(NOW), join('2026-10-15T10:03:00.000Z'));
    await censusPass(again, NOW + STEP, { demo: [] });
    const cp2 = disk(again.home).checkpoint!;
    expect(cp2.activities).toHaveLength(1);
    const act = cp2.activities[0]!;
    expect(act.identityJournalId, 'the ACCEPTED journal id of the earliest naming record, not the join\'s').toBe(identity['journalId']);
    expect(act.activityId).toBe(deriveDelegationActivityId(key, String(identity['journalId'])));
    expect(act.activityId).not.toBe(deriveDelegationActivityId(key, String(journalRecords(again.home)[2]!['journalId'])));
    expect(act.openedAt, 'opened when the retained record observed it').toBe('2026-10-15T10:02:00.000Z');
    expect(cp2.activityIdsByNaturalKey[encodeDelegationNaturalKey(key)]).toBe(act.activityId);
    expect(cp2.pruningHolds.filter((h) => h.reason === 'identity-candidate'), 'the hold is released once the ID is durable').toEqual([]);
    expect(again.coord.readDelegationProjection().activities.map((a) => a.activityId)).toEqual([act.activityId]);
    // and the ID does not depend on SQLite either
    await again.watcher.closeDelegation();
    loseDb(again.home);
    const third = world({ home: again.home });
    await censusPass(third, NOW + 2 * STEP, { demo: [] });
    expect(disk(third.home).checkpoint!.activities.map((a) => a.activityId)).toEqual([act.activityId]);
    expect(third.coord.readDelegationProjection().activities.map((a) => a.activityId)).toEqual([act.activityId]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 6. RUN-CHILD AGREEMENT stays owned by the run/child model; it is never a lease (W3-M63)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('6. run-child agreement remains owned without a lease', () => {
  it('a tree the registry holds as a ccd workspace is never leased, whatever the session\'s listings show, and the registry is untouched', async () => {
    const w = world();
    const ws = record('demo', 'brisk-ridge', { canonicalPath: '/data/worktrees/demo/brisk-ridge' });
    writeBucket(w, OWNER, bucketOf(NOW),
      startLine(OWNER, '2026-10-15T10:01:00.000Z'),
      lineOf(common(OWNER, { eventKind: 'PreToolUse', toolName: 'Bash', toolUseId: 'toolu_ws1', listing: [], cwd: '/w/demo' }, '2026-10-15T10:05:00.000Z')),
      lineOf(common(OWNER, { eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 'toolu_ws1', outcome: 'completed', listing: ['brisk-ridge'], cwd: '/w/demo' }, '2026-10-15T10:05:03.000Z')));
    writeFileSync(path.join(w.reg, 'demo-brisk-ridge.child'), 'run-1\n');
    const regBefore = treeDigest(w.reg);
    const records = [recordOf(OWNER), recordOf('demo-brisk-ridge', 'demo', { kind: 'child' })];
    for (let i = 0; i < 5; i++) await censusPass(w, NOW + i * STEP, { demo: [ws] }, [sessionOf(OWNER)], records);
    expect(leasesOf(w.home), 'a run\'s child is not a lease').toEqual([]);
    expect(disk(w.home).journal).not.toContain('lease-created');
    expect(disk(w.home).checkpoint!.attempts, 'nothing is claimed about it, not even as unowned work').toEqual([]);
    expect(w.coord.readDelegationProjection().leases).toEqual([]);
    expect(w.watcher.delegationReport().verdicts).toEqual({ unresolved: 0, conflicting: 0, unmeasured: 0 });
    expect(treeDigest(w.reg), 'the registry (and its .child marker) is exactly as the run/child model left it').toBe(regBefore);
  });

  it('a run-child agreement flows correlation -> policy -> the durable applier as an attempt row ONLY: no lease request, no lease row, no lease entry', async () => {
    const w = world();
    const agentLine = lineOf(common(OWNER, { eventKind: 'SubagentStart', agentId: AGENT_ID, agentType: null }, '2026-10-15T10:02:00.000Z'));
    writeBucket(w, OWNER, bucketOf(NOW), startLine(OWNER, '2026-10-15T10:01:00.000Z'), agentLine);
    await censusPass(w, NOW, { demo: [] });
    const durable = (await w.watcher.delegationApplier())!;
    const activity = durable.state().checkpoint.activities[0]!;
    const journalBefore = disk(w.home).journal;
    const rec = record('demo', 'brisk-ridge');
    const verdict = correlateDelegation({
      record: rec, runChildAgreement: { activityId: activity.activityId, evidenceJournalIds: [activity.identityJournalId] }, activities: durable.state().checkpoint.activities,
      acceptedEvidence: [], pointMetas: [], listingWindows: [], birthPassesRemaining: 0, hasRegistryRow: true, hasChildMarker: true, evidenceHorizon: null,
      droppedEvidence: DELEGATION_DROPPED_UNMEASURED,
    });
    expect(verdict).toMatchObject({ kind: 'run-child-owned', activityId: activity.activityId });
    const effects = policy.planDelegationReconciliation({
      now: iso(NOW), recovery: structuredClone(durable.state()) as never, census: [rec], correlations: [{ record: rec, verdict }], registryReadable: true,
      firstDeadParents: [], previousSuccessfulCensus: null, censusedProjects: ['demo'], previousCensusedProjects: ['demo'],
    });
    expect(effects.map((e) => e.kind).filter((k) => k !== 'repair-report-projection')).toEqual(['record-run-child-owned']);
    const owned = effects.find((e) => e.kind === 'record-run-child-owned') as { attempt: DelegationAttemptRow };
    await durable.applyCheckpointChange((cp) => ({ ...cp, attempts: [...cp.attempts, owned.attempt] }));
    await durable.repairProjection();
    const cp = disk(w.home).checkpoint!;
    expect(cp.attempts.map((a) => [a.adminRecord, a.verdict, a.rung]), 'rung 1 is the run/child model\'s own claim, filed as an attempt').toEqual([['brisk-ridge', 'linked', 1]]);
    expect(cp.leases).toEqual([]);
    expect(cp.lineage.filter((l) => l.leaseId !== null)).toEqual([]);
    expect(w.coord.readDelegationProjection().leases).toEqual([]);
    expect(disk(w.home).journal, 'an attempt is checkpoint state: the journal gained nothing').toBe(journalBefore);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 7. THE SEVEN-DAY GATE: seven complete days below 1% is eligible, and eligibility enables nothing (rollout step 9)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('7. seven complete days below 1% unmeasured becomes eligible, without enabling any later wave', () => {
  const H0 = Date.UTC(2026, 9, 1, 0);                                   // hour 0 of the timeline
  const hourAt = (h: number): number => H0 + h * HOUR;
  /** The lane over `owners` for hours `from`..`to` inclusive: one pass at ten past each hour. `bad` hours make that owner's byte range unreadable. */
  async function timeline(w: World, owners: readonly string[], from: number, to: number, bad: ReadonlyMap<string, ReadonlySet<number>>): Promise<void> {
    const sessions = owners.map((o) => sessionOf(o));
    for (let h = from; h <= to; h++) {
      for (const o of owners) {
        if (h === 0) writeBucket(w, o, bucketOf(hourAt(0)), startLine(o, iso(hourAt(0) + 60_000)));
        else makeOwner(w, o);
        if (bad.get(o)?.has(h) === true) w.faults.range.add(o); else w.faults.range.delete(o);
        if (bad.get(o)?.has(h) === true) writeBucket(w, o, bucketOf(hourAt(h)), startLine(o, iso(hourAt(h) + 60_000)));
      }
      await censusPass(w, hourAt(h) + 10 * 60_000, { demo: [] }, sessions);
    }
    w.faults.range.clear();
  }
  const gate = (w: World, atMs: number): DelegationObservationHealth => {
    setNow(atMs);
    return w.watcher.currentDelegationHealth()!;
  };
  /** The row the eligibility leaves alone: the registry, the spool and the journal's kinds are what the lane read and made, nothing more. */
  const nothingLater = (w: World): void => {
    expect(readdirSync(path.join(w.reg, 'delegation')), 'no carrier directory, no marker').toEqual(['spool']);
    expect(walk(w.reg).filter((p) => LATER_WAVE_NAME.test(p))).toEqual([]);
    const kinds = new Set(journalRecords(w.home).map((r) => (r['entry'] as { kind: string }).kind));
    for (const k of kinds) expect(Object.keys(DELEGATION_JOURNAL_ENTRY_KINDS)).toContain(k);
    expect(disk(w.home).checkpoint!.leases, 'the lane made no lease').toEqual([]);
    expect(w.coord.readDelegationProjection().leases).toEqual([]);
  };

  it('168 complete hours of two sessions with three unmeasured session-hours (0.89%) are eligible; two more (1.49%) are not; both stay report-only', async () => {
    const w = world();
    const owners = ['demo-a', 'demo-b'];
    const bad = new Map([['demo-b', new Set([40, 41, 90])]]);
    await timeline(w, owners, 0, 168, bad);
    const eligible = gate(w, hourAt(168) + 11 * 60_000);
    expect(eligible).toMatchObject({
      mode: 'report-only', stageGate: 'eligible', measuredSessionHours: 333, unmeasuredSessionHours: 3,
      windowStartedAt: iso(hourAt(0)), windowEndedAt: iso(hourAt(168)),
    });
    expect(eligible.unmeasuredRate).toBeCloseTo(3 / 336, 10);
    expect(eligible.unmeasuredRate! * 100).toBeLessThan(1);
    nothingLater(w);
    // two more unmeasured session-hours in the hours that follow push the same window past 1%
    await timeline(w, owners, 169, 171, new Map([['demo-b', new Set([169, 170])]]));
    const over = gate(w, hourAt(172) + 11 * 60_000);
    expect(over.stageGate).toBe('ineligible');
    expect(over.unmeasuredSessionHours).toBe(5);
    expect(over.unmeasuredRate! * 100).toBeGreaterThan(1);
    expect(over.mode).toBe('report-only');
    nothingLater(w);
  }, 300_000);

  it('a window with an hour the lane never ran is unmeasured, whatever else it holds: an absent hour is not a quiet one', async () => {
    const w = world();
    await timeline(w, [OWNER], 0, 60, new Map());
    await timeline(w, [OWNER], 62, 168, new Map());                    // the lane did not run for hour 61
    expect(gate(w, hourAt(168) + 11 * 60_000)).toMatchObject({ stageGate: 'unmeasured', unmeasuredRate: null });
  }, 300_000);

  it('a fleet that lacks the capability or never answered, and a registry that cannot be listed, each make an otherwise complete window unmeasured', async () => {
    const w = world();
    await timeline(w, [OWNER], 0, 168, new Map());
    const t = hourAt(168) + 11 * 60_000;
    expect(gate(w, t).stageGate).toBe('eligible');
    w.watcher.noteDelegationRegistry(false);
    expect(gate(w, t)).toMatchObject({ stageGate: 'unmeasured', unmeasuredRate: null });
    w.watcher.noteDelegationRegistry(true);
    expect(gate(w, t).stageGate).toBe('eligible');
    (w.deps['fleetState'] as { ccdVerbs: string[] | null }).ccdVerbs = ['caps', 'ws-rm'];
    expect(gate(w, t)).toMatchObject({ stageGate: 'unmeasured', unmeasuredRate: null });
    (w.deps['fleetState'] as { ccdVerbs: string[] | null }).ccdVerbs = null;
    expect(gate(w, t)).toMatchObject({ stageGate: 'unmeasured', unmeasuredRate: null });
  }, 300_000);
});


// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 8. THE CLOSED SCOPE CENSUS: nothing of waves 4 to 7 came in with wave 3
//
// Wave 3 owns observation and report-only reconciliation. Wave 4 owns the fleet/PWA rows; wave 5 owns carriers, adoption, retain and
// resolve, promotion and `ws-add --base`; wave 6 owns cleanup shadow and audit tokens; wave 7 owns cleanup execution. Each clause
// below is a RULE about the tree as it is, read from the source files or measured on the assembled wave, and each lists the named
// exceptions the wave carries. A later wave that opens one of these doors changes the clause here on purpose, in its own review.
//
// THE NAMED EXCEPTIONS (and nothing else):
//   * the journal: the server's torn-tail heal (D-4655) is the ONE caller of the port's `truncate`;
//   * doctor: the `delegation-hooks` CHECK writes nothing, and its FIXER's only write path is the shipped `install-session-hooks.sh`
//     (D-4651, coordinator mails 5151 and 5180);
//   * routes: `POST /api/coordinators/:session/intent` is an identity DECLARATION, not adoption (D-4656): it writes only
//     `explicitIntentAt` (and what is derived from it) on the current incarnation's session row;
//   * the agent protocol: `readFrom` gained an optional `maxBytes` and an additive `dataB64` answer (D-4635), and `readdir` an additive
//     `absent` marker: no new op, no capability word, no `FLEET_PROTO` bump;
//   * the lane's in-memory dropped-evidence index, marks and remembered paths (D-4653) are NOT durable state.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
/** Every file under `rel` (relative to the repository), skipping dependency and build directories. */
function filesUnder(rel: string, ext: RegExp = /\.(ts|tsx|mjs|js|sh|md)$/): string[] {
  const out: string[] = [];
  const rec = (d: string): void => {
    for (const e of readdirSync(path.join(REPO_ROOT, d), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p); else if (ext.test(e.name)) out.push(p);
    }
  };
  if (existsSync(path.join(REPO_ROOT, rel))) rec(rel);
  return out.sort();
}
/** Drops comment-only lines (TypeScript and shell), so a sentence that NAMES a later wave's door is not mistaken for the door. */
const code = (src: string): string => src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*|#)/.test(l)).join('\n');
/** The delegation family: a name that would belong to this broker under any spelling. */
const FAMILY = /deleg|lease|spool|carrier|journal/i;

/** Every file a later wave would put its door in: the ccd tools and their skills, the agent, the server, shared, and deploy. */
const SHIPPED = [
  ...['ccd/ccd', 'ccd/ccrc', 'ccd/ccrc-api', 'ccd/ccrc-doctor-checks', 'ccd/session-hook.sh', 'ccd/install-session-hooks.sh'],
  ...filesUnder('ccd/coordinator-skill'), ...filesUnder('ccd/worker-skill'), ...filesUnder('ccd/reviewer-skill'),
  ...filesUnder('agent/src'), ...filesUnder('server/src'), ...filesUnder('shared'), ...filesUnder('deploy', /\.(mjs|js|sh|json)$/),
];
/** Wave 5 to 7 verbs, capability words, markers and paths, as exact tokens. The error code `lease-cleanup-state` is not one. */
const LATER_WAVE = /\bws-lease-(mark|audit|clean)\b|\blease-(mark|audit|clean)-v1\b|\bws-add-base(-v1)?\b|ws-add\s+--base|delegation\/leases|delegation-adopt|lease-clean-live|\b_?cmd_ws_lease|\bpromotesLease\b/;

describe('8. the closed scope census', () => {
  it('no new PWA source, state or frame: the PWA and the design system do not name the broker, and no WebSocket frame is delegation\'s', () => {
    const ui = [...filesUnder('pwa/src', /\.(ts|tsx|css|html|js)$/), ...filesUnder('ui/src', /\.(ts|tsx|css|html|js)$/)];
    expect(ui.length, 'the scan reached the PWA').toBeGreaterThan(50);
    expect(ui.filter((f) => /delegation/i.test(f) || /delegation/i.test(read(f)))).toEqual([]);
    const api = read('shared/api.ts');
    const at = api.indexOf('export type FleetMsg =');
    const union = api.slice(at, api.indexOf(';\n', at));
    const frames = [...union.matchAll(/\{\s*type:\s*'([a-z-]+)'/g)].map((m) => m[1]!);
    expect(frames, 'the union was parsed').toEqual(expect.arrayContaining(['hello', 'fleet', 'notice', 'runs', 'coord', 'divergence', 'pools']));
    expect(frames.filter((f) => FAMILY.test(f)), 'no delegation frame').toEqual([]);
    for (const f of filesUnder('server/src', /\.ts$/)) expect(code(read(f)), f).not.toMatch(/\b(type|t):\s*'delegation'/);
    // the one wire exposure is a member of the health route's answer, which the PWA does not read
    expect(read('shared/api.ts')).toMatch(/delegation\?: DelegationObservationHealth/);
  });

  it('no carrier, adoption, promotion or `ws-add --base` command, capability, marker or file anywhere that ships', () => {
    const offenders = SHIPPED.filter((f) => LATER_WAVE.test(read(f)));
    expect(offenders, 'a later wave\'s door is in a shipped file').toEqual([]);
    // the fleet advertises the one wave-3 capability and nothing else of the family
    const h = makeCcdHarness('ccrc-dlgint-ccd-');
    try {
      const caps = h.sh('cmd_caps').split('\n').filter((c) => c !== '');
      expect(caps.filter((c) => /(^|-)lease|delegation|adopt|carrier/i.test(c))).toEqual(['delegation-events-v1']);
    } finally { h.cleanup(); }
    expect(DELEGATION_EVENTS_CAP).toBe('delegation-events-v1');
  });

  it('the complete future-facing columns exist, and no wave-3 writer can transition or populate them beyond inert initialization', async () => {
    const dbPath = path.join(mkTmp('ccrc-dlgint-db-'), 'coord.db');
    const db = openCoordDb(dbPath);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name);
    expect(tables.filter((t) => /^(delegation|lease|cleanup|audit|carrier)/i.test(t)).sort(), 'exactly the spec\'s six tables, no queue, token or audit table').toEqual(
      ['delegation_activities', 'delegation_attempts', 'delegation_events', 'delegation_leases', 'delegation_lineage', 'delegation_sessions']);
    expect(tables.filter((t) => /token|queue|audit|cleanup|obligation/i.test(t) && !/^(mail|push)/i.test(t)), 'no cleanup or audit machinery in the schema').toEqual([]);
    const columns = (db.prepare('PRAGMA table_info(delegation_leases)').all() as Array<{ name: string }>).map((r) => r.name).sort();
    expect(columns, 'the lease table is the complete future shape, in step with the row type').toEqual([...delegationLeaseCodec.columns].sort());
    for (const future of ['generation', 'disposition', 'cleanupState', 'cleanupPopulation', 'terminalEvidenceAt', 'adoptedAt', 'retainedAt', 'promotedAt',
      'cleanupDueAt', 'cleanupStartedAt', 'cleanupFinishedAt', 'cleanupEvidenceJson', 'carrierGenerationSeen', 'releasedAt']) expect(columns).toContain(future);
    db.close();

    // the only writers: the projection's DELETE and the codec-built INSERT, both behind `assertWave3Leases`; never an UPDATE
    const sql = filesUnder('server/src', /\.ts$/).flatMap((f) => (code(read(f)).match(/(INSERT|UPDATE|DELETE)[^;'"`]*\bdelegation_leases\b/gi) ?? []).map((m) => `${f}: ${m}`));
    expect(sql.map((s) => s.replace(/\s+/g, ' ')), 'one DELETE (a projection replaces the table) and no UPDATE').toEqual(['server/src/coord/store.ts: DELETE FROM delegation_leases']);
    expect(filesUnder('server/src', /\.ts$/).filter((f) => /delegationLeaseCodec/.test(code(read(f)))).sort()).toEqual(['server/src/coord/delegation-model.ts', 'server/src/coord/store.ts']);
    expect(Object.keys(DELEGATION_JOURNAL_ENTRY_KINDS).sort(), 'the journal has no transition entry: only evidence and a lease\'s creation').toEqual(['evidence-accepted', 'lease-created']);

    // and every door a checkpoint passes through refuses a lease that has moved past its inert initialization
    const w = await leaseWorld();
    const cp = disk(w.home).checkpoint!;
    expect(cp.leases).toHaveLength(1);
    const lease = cp.leases[0]!;
    expect(lease).toMatchObject({
      generation: 0, disposition: 'ephemeral', cleanupState: 'not-due', cleanupPopulation: 'ephemeral-lease', terminalEvidenceAt: null, adoptedAt: null, retainedAt: null,
      promotedAt: null, cleanupDueAt: null, cleanupStartedAt: null, cleanupFinishedAt: null, cleanupEvidenceJson: null, carrierGenerationSeen: null, releasedAt: null,
    });
    const moves: Array<[string, Partial<DelegationLeaseRow>]> = [
      ['generation 1 (a carrier transition)', { generation: 1 }],
      ['disposition retained', { disposition: 'retained' as DelegationLeaseRow['disposition'] }],
      ['cleanup due', { cleanupState: 'due' as DelegationLeaseRow['cleanupState'] }],
      ['a cleanup clock', { cleanupDueAt: '2026-10-16T00:00:00.000Z', cleanupStartedAt: '2026-10-16T00:00:01.000Z' }],
      ['cleanup evidence', { cleanupEvidenceJson: '{"audited":true}' }],
      ['a carrier generation', { carrierGenerationSeen: 1 }],
      ['adopted', { adoptedAt: '2026-10-16T00:00:00.000Z' }],
      ['retained', { retainedAt: '2026-10-16T00:00:00.000Z' }],
      ['promoted', { promotedAt: '2026-10-16T00:00:00.000Z' }],
      ['released', { releasedAt: '2026-10-16T00:00:00.000Z' }],
      ['terminal evidence', { terminalEvidenceAt: '2026-10-16T00:00:00.000Z' }],
    ];
    const durable = (await w.watcher.delegationApplier())!;
    const sqlBefore = canonicalDelegationJson(w.coord.readDelegationProjection());
    const diskBefore = treeDigest(w.ccrcDir);
    for (const [name, patch] of moves) {
      const moved: DelegationCheckpointV1 = { ...cp, leases: [{ ...lease, ...patch }] };
      expect(() => validateDelegationCheckpoint(moved, null), `${name}: the checkpoint validator`).toThrow();
      expect(() => w.coord.projectDelegationCheckpoint(moved), `${name}: the SQLite projection`).toThrow();
      await expect(durable.applyCheckpointChange((c) => ({ ...c, leases: [{ ...lease, ...patch }] })), `${name}: the checkpoint-only door`).rejects.toThrow();
    }
    expect(canonicalDelegationJson(w.coord.readDelegationProjection()), 'a refusal wrote nothing to SQLite').toBe(sqlBefore);
    expect(treeDigest(w.ccrcDir).length).toBe(diskBefore.length);
    expect(disk(w.home).checkpoint!.leases).toEqual(cp.leases);
  });

  it('no adoption, promotion, retain or resolve route: the one route wave 3 adds is the coordinator-intent declaration', async () => {
    const w = world();
    const app = await buildServer(w.deps as never, new Bus(), w.watcher);
    try {
      const routes = app.printRoutes({ commonPrefix: false });
      expect(routes, 'the route table was printed').toContain('/api/runs');
      expect(routes.split('\n').filter((l) => /(^|[/:\-\s])leases?\b|adopt|promot|retain|resolve|carrier|cleanup/i.test(l)), 'no later wave\'s route').toEqual([]);
      expect(routes.split('\n').filter((l) => /coordinators/.test(l))).toEqual(['├── /api/coordinators/:session/intent (POST)']);
      expect(routes.split('\n').filter((l) => /delegation|journal|checkpoint|spool/i.test(l))).toEqual([]);
    } finally { await app.close(); }
    // `POST /api/runs` takes no lease to promote, and no source names the verb a promotion would call
    expect(filesUnder('server/src', /\.ts$/).filter((f) => /promotesLease|operator-retain|leases\/:id/.test(code(read(f))))).toEqual([]);
  });

  it('the intent declaration is identity, not adoption: it writes the current incarnation\'s `explicitIntentAt` and what derives from it, and nothing else', async () => {
    const TOKEN = 'f'.repeat(64);
    const uuid = 'a'.repeat(36);
    const w = world();
    const reg = w.reg;
    for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'demo', workdir: '/w/demo/demo-a', uuid, started: '1', generation: INC })) writeFileSync(path.join(reg, `${OWNER}.${k}`), v);
    writeBucket(w, OWNER, bucketOf(NOW), startLine(OWNER, '2026-10-15T10:01:00.000Z'));
    await censusPass(w, NOW, { demo: [] });
    const before = disk(w.home);
    const journalBefore = before.journal;
    const app = await buildServer({ ...w.deps, mailToken: TOKEN } as never, new Bus(), w.watcher);
    try {
      const res = await app.inject({ method: 'POST', url: `/api/coordinators/${OWNER}/intent`, headers: { 'x-ccrc-mail-token': TOKEN }, payload: { action: 'set', byId: OWNER, byUuid: uuid } });
      expect(res.statusCode, res.body).toBe(200);
    } finally { await app.close(); }
    const after = disk(w.home);
    const strip = (cp: DelegationCheckpointV1): Record<string, unknown> => {
      const { revision, coordinatorIntentByParent, sessions, ...rest } = cp;
      void revision; void coordinatorIntentByParent;
      return { ...rest, sessions: sessions.map(({ explicitIntentAt, effective, effectiveBasis, ...row }) => { void explicitIntentAt; void effective; void effectiveBasis; return row; }) };
    };
    expect(after.checkpoint!.sessions[0]!.explicitIntentAt, 'the declaration is on the row').not.toBeNull();
    expect(Object.keys(after.checkpoint!.coordinatorIntentByParent)).toHaveLength(1);
    expect(canonicalDelegationJson(strip(after.checkpoint!)), 'every other checkpoint member is as it was').toBe(canonicalDelegationJson(strip(before.checkpoint!)));
    expect(after.journal, 'a declaration is checkpoint state: the journal gained nothing').toBe(journalBefore);
    expect(after.checkpoint!.leases).toEqual([]);
    expect(canonicalDelegationJson(w.coord.readDelegationProjection())).toBe(canonicalDelegationJson(projectionViewOfDelegationCheckpoint(after.checkpoint!)));
  });

  it('no cleanup or audit token, queue or executor, and no run is dispatched, held or paused by observation', () => {
    const CLEANUP = /audit-?token|auditToken|AUDIT_TOKEN|cleanup-?(queue|executor|token|nominat)|nominateCleanup|mintAudit|executeCleanup|cleanupQueue/i;
    expect(SHIPPED.filter((f) => CLEANUP.test(code(read(f)))), 'cleanup or audit machinery in a shipped file').toEqual([]);
    // the observation lane and the policy name no dispatch, hold, mail, claim or pause door
    const watch = read('server/src/watch.ts');
    const lane = watch.slice(watch.indexOf('class DelegationLane {'));
    expect(code(lane)).not.toMatch(/dispatchRun|\bcoord\.(createRun|advanceRun|closeRun|abandonRun|takeClaim)|sendMail|\bsetHold\b|coordinator-paused|mail-disabled|ws-reap|ws-rm\b|ws-archive|ws-reclaim|ws-collect|ws-expire/);
    for (const f of ['delegation-policy.ts', 'delegation-correlation.ts', 'delegation-ingest.ts', 'delegation-model.ts']) {
      expect(code(read(`server/src/coord/${f}`)), f).not.toMatch(/dispatchRun|runCcd|\bspawn\w*\(|\bexecFile\w*\(|child_process|\bwriteFile\w*\(/);
    }
  });

  it('no physical journal compaction or truncation, except the torn-tail heal: ONE caller of the port\'s `truncate`, and no other source names the journal', () => {
    const named = filesUnder('server/src', /\.ts$/).filter((f) => /delegation-events\.log|DELEGATION_JOURNAL_FILE/.test(code(read(f))));
    expect(named, 'only the journal module and the applier name the file').toEqual(['server/src/coord/delegation-checkpoint.ts', 'server/src/coord/delegation-journal.ts']);
    const calls = filesUnder('server/src', /\.ts$/).flatMap((f) => (code(read(f)).match(/[\w.]+\.truncate\(/g) ?? []).map((m) => `${f}: ${m}`));
    expect(calls, 'every `.truncate(` call in the server: the heal\'s call on the port, and the node adapter\'s own call to the file system').toEqual([
      'server/src/coord/delegation-checkpoint.ts: this.port.truncate(', 'server/src/coord/delegation-journal.ts: fsp.truncate(',
    ]);
    expect(filesUnder('server/src', /\.ts$/).filter((f) => /\bport\.truncate\(/.test(code(read(f)))), 'the heal is the port\'s only caller').toEqual(['server/src/coord/delegation-checkpoint.ts']);
    const checkpoint = code(read('server/src/coord/delegation-checkpoint.ts'));
    expect(checkpoint.match(/await this\.port\.truncate\(this\.journalPath, plan\.offset\);/g), 'at the plan\'s offset only').toHaveLength(1);
    const heal = checkpoint.slice(checkpoint.indexOf('private async healTailLocked'), checkpoint.indexOf('private async remeasureTail'));
    expect(heal, 'the one caller is the heal').toContain('await this.port.truncate(this.journalPath, plan.offset);');
    expect(checkpoint.match(/healTailLocked\(/g), 'declared once and called once').toHaveLength(2);
    expect(checkpoint).toMatch(/if \(report\.tailHeal !== null\) \{\s*try \{\s*await this\.healTailLocked\(report\.tailHeal\);/);
    // the heal keeps the bytes first: the copy is durable before the cut, and the cut is the only change to the journal's length
    expect(heal.indexOf('this.port.rename(temp, kept)')).toBeLessThan(heal.indexOf('this.port.truncate('));
    expect(checkpoint).not.toMatch(/unlink|rmSync|\.writeFile\(/);
    // the deploy helper reads the live journal (capture) and replaces it whole from a validated snapshot (restore): neither cuts it
    expect(read('deploy/coordination-snapshot.mjs')).not.toMatch(/\btruncate|ftruncate/);
    // the update tool only looks at the backup copies' names
    expect((read('ccd/ccrc').match(/^[^#\n]*delegation-events\.log.*$/gm) ?? []).map((l) => l.trim())).toEqual(['for n in coordination-snapshot.json delegation-events.log delegation-checkpoint.json coord.db; do']);
    // pruning is a PLAN: the plan is data, nothing applies it, and asking for it leaves the journal byte for byte
    expect(code(read('server/src/watch.ts'))).not.toMatch(/planPruning|planDelegationPruning/);
  });

  it('a pruning plan changes no byte of the journal or the checkpoint', async () => {
    const w = await leaseWorld();
    const before = treeDigest(w.ccrcDir);
    const plan = await (await w.watcher.delegationApplier())!.planPruning(NOW + 90 * 24 * HOUR, 0);
    expect(plan.enabled).toBe(true);
    expect(treeDigest(w.ccrcDir)).toBe(before);
  });

  it('no `ws-*lease*` skill text: the coordinator, worker and reviewer skills name no lease verb', () => {
    const skills = ['ccd/coordinator-skill', 'ccd/worker-skill', 'ccd/reviewer-skill'].flatMap((d) => filesUnder(d, /\.md$/));
    expect(skills.length).toBeGreaterThan(3);
    expect(skills.filter((f) => /\bws-lease|\blease-(mark|audit|clean)\b|ws-add\s+--base/i.test(read(f)))).toEqual([]);
  });

  it('no new agent request operation, capability word or protocol bump: `readFrom` is the same op with one optional field', () => {
    expect([FLEET_PROTO, FLEET_PROTO_MIN]).toEqual([1, 1]);
    const proto = read('shared/agent-protocol.ts');
    const ops = [...proto.matchAll(/interface \w+Req\s*\{[^}]*\bop:\s*'([\w-]+)'/g)].map((m) => m[1]!);
    expect(ops, 'the request union was parsed').toEqual(expect.arrayContaining(['exec', 'read', 'readFrom', 'readB64', 'readdir', 'stat', 'caps']));
    expect(ops.filter((o) => FAMILY.test(o)), 'no delegation op').toEqual([]);
    expect(proto).toMatch(/export interface ReadFromReq \{ t: 'req'; id: number; op: 'readFrom'; path: string; offset: number; maxBytes\?: number \}/);
    expect(proto.match(/\bmaxBytes\b/g)!.length).toBeGreaterThan(0);
    // the ready frame, the advertised words and the agent's op switch carry nothing of the broker's
    const ready = proto.slice(proto.indexOf("t: 'ready'"), proto.indexOf("t: 'ready'") + 400);
    expect(ready).not.toMatch(FAMILY);
    expect(code(read('agent/src/server.ts'))).not.toMatch(/case\s+'[^']*(deleg|lease|spool|carrier)/i);
    expect(read('agent/src/server.ts')).not.toMatch(/ioCaps|delegation-events/);
    expect(READ_FROM_MAX_BYTES).toBe(262144);
  });

  it('pure policy imports no randomness and cannot produce a completed lease row: it only ever REQUESTS a lease identity', async () => {
    const policySrc = code(read('server/src/coord/delegation-policy.ts'));
    const imports = [...policySrc.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort(), 'L1 imports the model and correlation, nothing else').toEqual(['./delegation-correlation.js', './delegation-model.js']);
    const RANDOM = /\brandom(UUID|Bytes|Int|Fill)\b|getRandomValues|Math\.random|crypto\.subtle|\bwebcrypto\b/;
    for (const f of ['delegation-policy.ts', 'delegation-correlation.ts', 'delegation-ingest.ts', 'delegation-model.ts']) {
      expect(code(read(`server/src/coord/${f}`)), `${f} mints nothing`).not.toMatch(RANDOM);
      expect(code(read(`server/src/coord/${f}`)), `${f} reads no clock`).not.toMatch(/Date\.now\(\)|new Date\(\)/);
    }
    // measured on the assembled wave: every effect of every pass is a member of the closed six, and a lease request is identity only
    const plan = vi.spyOn(policy, 'planDelegationReconciliation');
    const w = await leaseWorld();
    void w;
    const effects = plan.mock.results.flatMap((r) => r.value as ReturnType<typeof policy.planDelegationReconciliation>);
    expect(effects.length).toBeGreaterThan(0);
    expect(new Set(effects.map((e) => e.kind))).toEqual(new Set(['request-linked-lease-identity', 'repair-report-projection']));
    const CLOSED = ['request-linked-lease-identity', 'record-run-child-owned', 'record-unowned-worktree', 'record-measured-absence', 'record-observation-interval', 'repair-report-projection'];
    const keysOf = (v: unknown): string[] => (v !== null && typeof v === 'object' ? Object.entries(v as object).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);
    for (const e of effects) {
      expect(CLOSED).toContain(e.kind);
      expect(keysOf(e).filter((k) => /^(leaseId|generation|disposition|cleanup\w*|carrier\w*|adoptedAt|retainedAt|promotedAt|releasedAt|terminalEvidenceAt|token\w*|action|argv|command)$/.test(k)), e.kind).toEqual([]);
    }
    const request = effects.find((e) => e.kind === 'request-linked-lease-identity') as { request: object };
    expect(Object.keys(request.request).sort()).toEqual(
      ['activityId', 'adminRecord', 'canonicalPath', 'correlationJournalIds', 'creationBase', 'firstObservedAt', 'parentId', 'parentIncarnation', 'project', 'sourceKind']);
  });

  it('doctor is read-only: the `delegation-hooks` check writes nothing, and its fixer\'s only write path is the shipped installer', () => {
    const checks = read('ccd/ccrc-doctor-checks');
    const body = (name: string): string => {
      const at = checks.indexOf(`\n${name}() {`);
      expect(at, `${name} exists`).toBeGreaterThan(-1);
      return checks.slice(at, checks.indexOf('\n}\n', at));
    };
    /** A shell body with comments, quoted text (jq programs and messages included) and the harmless redirections removed, so only a
     *  command or a write is left to match. */
    const bare = (b: string): string => b.split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/(^|\s)#(\s.*)?$/, '')).join('\n')
      .replace(/\\["']/g, '').replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'[^']*'/g, "''")
      .replace(/\d?>\s*\/dev\/null/g, '').replace(/\d?>&\d/g, '').replace(/<<<?/g, '');
    const WRITES = /(^|[^<>&|])\d?>>?\s*[^\s>&]|\|\s*tee\b|(^|[\s;&|(`])(rm|mv|cp|mkdir|touch|tee|chmod|chown|ln|truncate|dd|git|curl|systemctl\s+--user\s+(start|stop|restart|enable|disable))\s|sed\s+-i/;
    for (const name of ['_check_delegation-hooks', '_dh_mixed_events']) expect(bare(body(name)), `${name} writes nothing`).not.toMatch(WRITES);
    const fixer = bare(body('_fix_delegation-hooks'));
    expect(fixer, 'the fixer writes only through the installer').not.toMatch(WRITES);
    const raw = code(body('_fix_delegation-hooks'));
    expect(raw.match(/"\$\{BASH:-bash\}" "\$inst" --homes "\$\{dirs\[@\]\}"/g), 'one invocation of the shipped installer').toHaveLength(1);
    expect(raw.match(/"\$inst"/g), '`$inst` is used once, to run').toHaveLength(1);
    expect(raw).toContain('local inst="$CCRC_HERE/install-session-hooks.sh"');
    // it refuses a home with a mixed hook group before the installer could touch it (R55), and removes nothing itself
    expect(raw).toContain('_dh_mixed_events');
    expect(raw).not.toMatch(/\bjq\b[^\n]*(del\(|map\(|walk\(|\|=)/);
  });

  it('the lane\'s in-memory structures are not durable state: the lane class opens no file and no SQLite handle of its own', () => {
    const watch = read('server/src/watch.ts');
    const lane = code(watch.slice(watch.indexOf('class DelegationLane {')));
    expect(lane.length).toBeGreaterThan(10_000);
    expect(lane, 'every durable write goes through DelegationDurability').not.toMatch(/\b(writeFile|appendFile|mkdir|rename|unlink|rmSync|createWriteStream|truncate)\w*\(|\.prepare\(|\bdb\.exec\(|openCoordDb|new DatabaseSync/);
    expect(lane).toMatch(/private readonly dropped = new Map/);
    expect(lane).toMatch(/pathsByProject = new Map/);
    expect(lane).toMatch(/private readonly knownPaths = new Map/);
  });
});

/** Four passes of the raw-worktree case from hand-built lines: a lease IDENTITY is journaled on the third. */
async function leaseWorld(): Promise<World> {
  const w = world();
  const pre = lineOf(common(OWNER, { eventKind: 'PreToolUse', toolName: 'Bash', toolUseId: 'toolu_wt1', listing: ['old-tree'], cwd: '/w/demo' }, '2026-10-15T10:05:00.000Z'));
  const post = lineOf(common(OWNER, { eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 'toolu_wt1', outcome: 'completed', listing: ['old-tree', 'raw-tree'], cwd: '/w/demo' }, '2026-10-15T10:05:03.000Z'));
  writeBucket(w, OWNER, bucketOf(NOW), startLine(OWNER, '2026-10-15T10:01:00.000Z'), pre, post);
  for (let i = 0; i < 4; i++) await censusPass(w, NOW + i * STEP, { demo: [OLD, RAW] });
  expect(leasesOf(w.home), 'the fixture made its lease identity').toHaveLength(1);
  return w;
}
