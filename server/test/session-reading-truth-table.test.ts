// ARCH-47 — the liveness truth table. One row per input the fleet's "is it alive" ladders
// have to place, each with the answer every surface must give. Written green against the old
// ladder (`measureClaimant`, the destructive callers' fail-shut reading) BEFORE `readSession`
// existed; the pure function now answers the same rows, `measureClaimant` is its fail-shut
// policy, and `ccd-tmp-sweep`'s box-side predicate (it runs without the server, so it stays) is
// run on the same rows (it protects what the table does not call `dead`, except on the rows the test names).
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { claimantFacts, measureClaimant, type ReclaimDeps } from '../src/coord/reclaim.js';
import { deadCauseOf, DEAD_CAUSES, readSession, type Presence, type SessionFacts } from '../src/sessionReading.js';
import { DEAD_LIFECYCLES } from '../../shared/api.js';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fakeDf } from './tmpSweepHelpers.js';
import { localIO, type FleetIO } from '../src/io.js';
import type { SessionVerdict } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { degradedReadIO } from './ioDoubles.js';

const NOW = 1_000_000_000_000;
const SEC = Math.floor(NOW / 1000);
const ID = 'demo-quiet-mesa';
const OTHER = 'demo-brisk-fen';

const GONE: SessionVerdict = { verdict: 'gone' };
const LIVE: SessionVerdict = { verdict: 'live' };

const seedRow = (home: string, id: string, extra: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, uuid: `u-${id}`,
    started: '1', workspace: id, branch: `ws/${id}`, base: 'origin/main', ...extra,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** One row of the table: how to seed the registry, what tmux says, and the reading it must get. */
interface Row {
  name: string;
  seed: (home: string) => void;
  tmux: SessionVerdict;
  id?: string;
  io?: FleetIO;
  /** The destructive callers' state word. */
  state: 'dead' | 'alive' | 'unmeasurable';
  cause?: string;
  /** A word the door's `why` must name, where the row's state alone does not say which arm answered. */
  whyNames?: string;
  /** The same row as `readSession`'s facts, and the reading it must give. */
  facts: SessionFacts;
  presence: Presence;
}

const ROWS: Row[] = [
  { name: 'the registry directory will not list', seed: (h) => seedRow(h, ID), tmux: GONE,
    io: { ...localIO, readdir: async () => null }, state: 'unmeasurable' , facts: { row: 'unlistable', pane: null, lifecycle: null, hibernatedAt: null, turn: null }, presence: 'unknown' },
  { name: 'an id that is not a registry id', seed: (h) => seedRow(h, ID), tmux: GONE, id: '--flag', state: 'unmeasurable' , facts: { row: 'bad-id', pane: null, lifecycle: null, hibernatedAt: null, turn: null }, presence: 'unknown' },
  { name: 'no row in a directory that listed cleanly', seed: (h) => seedRow(h, OTHER), tmux: GONE, state: 'dead', cause: 'absent' , facts: { row: 'absent', pane: null, lifecycle: null, hibernatedAt: null, turn: null }, presence: 'dead' },
  { name: 'listed but unassembled (a coordinator mid-write, D-1144)', tmux: GONE, state: 'unmeasurable',
    seed: (h) => {
      const reg = path.join(h, '.cc-sessions');
      mkdirSync(reg, { recursive: true });
      writeFileSync(path.join(reg, `${ID}.uuid`), `u-${ID}`);
      writeFileSync(path.join(reg, `${ID}.started`), '1');
    } , facts: { row: 'unmeasurable', pane: null, lifecycle: null, hibernatedAt: null, turn: null }, presence: 'unknown' },
  { name: 'a live pane outranks a stop stamp', seed: (h) => seedRow(h, ID, { stopped: `${SEC} ccd` }), tmux: LIVE, state: 'alive' , facts: { row: 'present', pane: 'live', lifecycle: 'stopped', hibernatedAt: null, turn: null }, presence: 'alive' },
  { name: 'tmux did not answer', seed: (h) => seedRow(h, ID), tmux: { verdict: 'unknown', detail: 'no server running' }, state: 'unmeasurable' , facts: { row: 'present', pane: 'unknown', lifecycle: 'orphan', hibernatedAt: null, turn: null }, presence: 'unknown' },
  { name: 'gone + a stop stamp', seed: (h) => seedRow(h, ID, { stopped: `${SEC} ccd` }), tmux: GONE, state: 'dead', cause: 'stopped' , facts: { row: 'present', pane: 'gone', lifecycle: 'stopped', hibernatedAt: null, turn: null }, presence: 'dead' },
  { name: 'gone + a stop stamp + hibernated (asleep, not dead)', tmux: GONE, state: 'alive',
    seed: (h) => seedRow(h, ID, { stopped: `${SEC} ccd`, hibernated: `${SEC} 7` }) , facts: { row: 'present', pane: 'gone', lifecycle: 'stopped', hibernatedAt: NOW, turn: null }, presence: 'asleep' },
  // DEAD ON PURPOSE (pinned, not fixed, ARCH-47): a `.hibernated` marker that will not parse carries no time, so the
  // registry reads it as no marker (`parseHibernated` answers null) and a stop stamp beside it reads `stopped`. The old
  // ladder answered the same; the dead-coordinator lane never acts on `stopped` (a deliberate act, not a crash), and
  // carrying "listed but unreadable" as its own fact would move every reader of `hibernatedAt`, beyond this PR's intent.
  { name: 'gone + a stop stamp + a hibernated marker that will not parse (stopped, on purpose)', tmux: GONE, state: 'dead',
    cause: 'stopped', seed: (h) => seedRow(h, ID, { stopped: `${SEC} ccd`, hibernated: 'not-a-stamp' }),
    facts: { row: 'present', pane: 'gone', lifecycle: 'stopped', hibernatedAt: null, turn: null }, presence: 'dead' },
  { name: 'gone + a long-gone heartbeat, stale hibernated stamp', tmux: GONE, state: 'dead', cause: 'orphan',
    seed: (h) => seedRow(h, ID, { supervised: String(SEC - 3600), hibernated: `${SEC - 7200} 7` }) , facts: { row: 'present', pane: 'gone', lifecycle: 'orphan', hibernatedAt: NOW - 7_200_000, turn: null }, presence: 'dead' },
  { name: 'gone + a row that never started', tmux: GONE, state: 'dead', cause: 'never-started',
    seed: (h) => { seedRow(h, ID); rmSync(path.join(h, '.cc-sessions', `${ID}.started`)); } , facts: { row: 'present', pane: 'gone', lifecycle: 'never-started', hibernatedAt: null, turn: null }, presence: 'dead' },
  { name: 'gone + a fresh supervisor heartbeat (restarting)', seed: (h) => seedRow(h, ID, { supervised: String(SEC) }), tmux: GONE, state: 'alive' , facts: { row: 'present', pane: 'gone', lifecycle: 'restarting', hibernatedAt: null, turn: null }, presence: 'alive' },
  // D-1140: the one doubt the destructive door answers `alive`, driven through the real door (a dead answer here would
  // let a reclaim or an abandon proceed while the claimant's lifecycle could not be read).
  { name: 'gone + a lifecycle stamp that cannot be read (D-1140)', seed: (h) => seedRow(h, ID), tmux: GONE,
    io: degradedReadIO((p) => p.endsWith(`${ID}.started`)), state: 'alive', whyNames: 'unmeasurable',
    facts: { row: 'present', pane: 'gone', lifecycle: 'unmeasurable', hibernatedAt: null, turn: null }, presence: 'unknown' },
];

describe('the liveness truth table, through measureClaimant (today\'s fail-shut ladder)', () => {
  for (const row of ROWS) {
    it(row.name, async () => {
      const home = mkTmp('ccrc-truth-');
      row.seed(home);
      const deps: ReclaimDeps = {
        coord: new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))),
        io: row.io ?? localIO, cfg: testDeps(home).cfg,
        tmux: { sessionVerdict: async () => row.tmux },
      };
      // The row's facts are what the door's own adapter reads from this fixture, not a hand-typed guess.
      expect((await claimantFacts(deps, row.id ?? ID, NOW)).facts).toEqual(row.facts);
      const v = await measureClaimant(deps, row.id ?? ID, NOW);
      expect(v.state).toBe(row.state);
      if (row.cause !== undefined) expect(v).toMatchObject({ cause: row.cause });
      if (row.whyNames !== undefined) expect(v.why).toContain(row.whyNames);
    });
  }
});

describe('the same rows through readSession (the pure function over facts)', () => {
  for (const row of ROWS) {
    it(row.name, () => {
      const r = readSession(row.facts);
      expect(r.presence).toBe(row.presence);
      // The destructive callers' fail-shut policy over the reading: doubt is never dead, asleep is alive.
      // The one doubt it answers alive is a lifecycle it could not measure behind a gone pane (D-1140).
      const state = r.presence === 'dead' ? 'dead'
        : r.presence === 'unknown' && r.why !== 'lifecycleDoubt' ? 'unmeasurable' : 'alive';
      expect(state).toBe(row.state);
      if (row.cause !== undefined) expect(r.deadCause).toBe(row.cause);
      else expect(r.deadCause).toBeNull();
      // The parts the presence is derived from: a proven absence or a gone pane is `absent`, a live pane `present`, and
      // every doubt `unmeasurable`; a sleeper is `asleep since` its marker and nothing else is.
      const f = row.facts;
      expect(r.substrate).toBe(f.row === 'absent' || (f.row === 'present' && f.pane === 'gone') ? 'absent'
        : f.row === 'present' && f.pane === 'live' ? 'present' : 'unmeasurable');
      expect(r.sleep).toEqual(row.presence === 'asleep' ? { kind: 'asleep', since: NOW } : { kind: 'awake' });
      expect(r.lifecycle).toBe(f.row === 'present' && f.pane === 'gone' ? f.lifecycle : null);
      expect(r.viewer).toBe('not-fed');
    });
  }

  it('a dead lifecycle names itself as the cause, checked against the one DeadCause list rather than cast', () => {
    expect([...DEAD_CAUSES].sort()).toEqual(['absent', ...DEAD_LIFECYCLES].sort());
    for (const lc of DEAD_LIFECYCLES) expect(deadCauseOf(lc)).toBe(lc);
    // A lifecycle the list does not name is a drift between the two lists: it throws instead of carrying a cause.
    expect(() => deadCauseOf('running')).toThrow(/not a DeadCause/);
  });

  it('a listed-but-unassembled row never reads dead, whatever tmux says (D-1144)', () => {
    for (const pane of ['live', 'gone', 'unknown', null] as const) {
      const r = readSession({ row: 'unmeasurable', pane, lifecycle: 'orphan', hibernatedAt: null, turn: null });
      expect(r.presence).toBe('unknown');
    }
  });

  it('a gone pane over a lifecycle that could not be measured reads unknown, and the door treats it as alive (D-1140)', () => {
    for (const lifecycle of ['unmeasurable', null] as const) {
      const r = readSession({ row: 'present', pane: 'gone', lifecycle, hibernatedAt: null, turn: null });
      // The reading is a doubt, not an answer: display readers get `unknown`; the destructive door maps it to alive
      // (pinned through the real door by the table's 'gone + a lifecycle stamp that cannot be read' row).
      expect(r).toMatchObject({ presence: 'unknown', why: 'lifecycleDoubt', deadCause: null });
    }
  });

  it('the turn rides along only for a live pane, and an unmeasured status reads unknown, with its why', () => {
    const base = { row: 'present', pane: 'live', lifecycle: null, hibernatedAt: null } as const;
    expect(readSession({ ...base, turn: 'busy' }).turn).toEqual({ word: 'busy', why: 'measured' });
    expect(readSession({ ...base, turn: 'idle' }).turn).toEqual({ word: 'idle', why: 'measured' });
    expect(readSession({ ...base, turn: 'shell' }).turn).toEqual({ word: 'shell', why: 'measured' });
    expect(readSession({ ...base, turn: null }).turn).toEqual({ word: 'unknown', why: 'unmeasured' });
    expect(readSession({ ...base, pane: 'gone', lifecycle: 'running', turn: 'idle' }).turn).toEqual({ word: 'unknown', why: 'noPane' });
    expect(readSession({ ...base, pane: 'unknown', turn: 'idle' }).turn).toEqual({ word: 'unknown', why: 'paneUnknown' });
    expect(readSession({ ...base, row: 'absent', pane: null, turn: 'idle' }).turn).toEqual({ word: 'unknown', why: 'noRow' });
  });

  it('the viewer is a declared arm: not-fed unless a caller supplies it, and never invented as none', () => {
    const base = { row: 'present', pane: 'live', lifecycle: null, hibernatedAt: null, turn: null } as const;
    expect(readSession(base).viewer).toBe('not-fed');
    for (const viewer of ['none', 'open', 'visible'] as const) expect(readSession({ ...base, viewer }).viewer).toBe(viewer);
  });

  it('sleep names its marker\'s time, and a row with no readable marker stays awake', () => {
    const base = { row: 'present', pane: 'gone', lifecycle: 'stopped', turn: null } as const;
    expect(readSession({ ...base, hibernatedAt: 7 }).sleep).toEqual({ kind: 'asleep', since: 7 });
    expect(readSession({ ...base, hibernatedAt: null }).sleep).toEqual({ kind: 'awake' });
  });
});

// ccd-tmp-sweep runs on the box without the server, so it cannot import `readSession` and keeps its own predicate. The
// table makes a drift visible by RUNNING that predicate on the same rows: each row below is seeded into a fixture HOME,
// the real script sweeps a ten-day-old temp directory of that session's uuid, and the directory's survival is the
// sweep's answer. The sweep protects a session when a process publishes its uuid (alive) or when the registry row has a
// `.hibernated` file (asleep, or anything else with that file); it knows no other word. Where that differs from the
// row's presence the row says so in `differs`, and the test holds the difference to exactly those rows: a change to the
// sweep's predicate, or to a row's presence, must be re-recorded here.
describe.skipIf(process.platform !== 'linux')('ccd-tmp-sweep, driven on the table\'s rows (its box-side twin)', () => {
  const SWEEP = path.resolve(__dirname, '../../ccd/ccd-tmp-sweep');
  const TAG = `fakeclaude-${randomBytes(4).toString('hex')}`;
  const SID = '11111111-1111-4111-8111-111111111111';
  const PROJ = '-home-fixture-worktrees-demo';
  const OLD = new Date(Date.now() - 10 * 86_400_000);
  let procs: ChildProcess[] = [];
  afterEach(() => {
    for (const p of procs) { try { process.kill(-p.pid!, 'SIGKILL'); } catch { /* already gone */ } }
    procs = [];
  });

  /** What the sweep does per row: does it protect the session's temp directory, with a live process publishing the uuid
   *  or not. `differs` names the rows where that is not what the presence says. `null`: the sweep has no such input. */
  interface SweepRow { protectedDir: boolean; proc?: true; differs?: string }
  const SWEEP_ROWS: Record<string, SweepRow | null> = {
    'the registry directory will not list': null,
    'an id that is not a registry id': null,
    'no row in a directory that listed cleanly': { protectedDir: false },
    'listed but unassembled (a coordinator mid-write, D-1144)': { protectedDir: false, differs: 'doubt is unknown to the table, an unprotected dir to the sweep (no process, no hibernated file)' },
    'a live pane outranks a stop stamp': { protectedDir: true, proc: true },
    'tmux did not answer': { protectedDir: false, differs: 'the sweep asks processes, not tmux: no process publishing the uuid is an unprotected dir' },
    'gone + a stop stamp': { protectedDir: false },
    'gone + a stop stamp + hibernated (asleep, not dead)': { protectedDir: true },
    'gone + a stop stamp + a hibernated marker that will not parse (stopped, on purpose)': { protectedDir: true, differs: 'the sweep protects any row with a .hibernated file, parsed or not; the table reads this one as dead (stopped)' },
    'gone + a long-gone heartbeat, stale hibernated stamp': { protectedDir: true, differs: 'the sweep protects every row with a .hibernated file, whatever its lifecycle; the table reads this one as dead (orphan)' },
    'gone + a row that never started': { protectedDir: false },
    'gone + a fresh supervisor heartbeat (restarting)': { protectedDir: false, differs: 'a restarting session has no process yet; the sweep does not look at heartbeats' },
    'gone + a lifecycle stamp that cannot be read (D-1140)': null,
  };

  const age = (p: string): void => {
    const st = fs.lstatSync(p);
    if (st.isDirectory()) for (const e of fs.readdirSync(p)) age(path.join(p, e));
    fs.utimesSync(p, OLD, OLD);
  };
  const sweepsAndKeeps = (row: Row, o: SweepRow): boolean => {
    const base = mkTmp('ccrc-truth-sweep-');
    const home = path.join(base, 'home');
    const root = path.join(base, 'claude-9999');
    fs.mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    row.seed(home);
    // The seeded rows carry a placeholder uuid; the sweep reads a real one.
    const uuidFile = path.join(home, '.cc-sessions', `${ID}.uuid`);
    if (fs.existsSync(uuidFile)) fs.writeFileSync(uuidFile, `${SID}\n`);
    const dir = path.join(root, PROJ, SID, 'scratchpad');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'work.txt'), 'x\n');
    age(path.join(root, PROJ)); fs.utimesSync(root, OLD, OLD);
    const env: NodeJS.ProcessEnv = {
      ...process.env, HOME: home, CCD_TMP_SWEEP_ROOT: root, CCD_TMP_SWEEP_CLAUDE_RE: `/${TAG}$`,
      TMPDIR: fs.realpathSync(os.tmpdir()), CCD_TMP_SWEEP_DF: fakeDf(base),
    };
    delete env['FAKE_DF_PCT']; delete env['CCD_TMP_SWEEP_MAX_AGE_DAYS'];
    if (o.proc === true) {
      const p = spawn('bash', ['-c', `exec -a /opt/${TAG} bash -c 'sleep 60; :'`], { cwd: home, env, stdio: 'ignore', detached: true });
      procs.push(p);
      const cmdline = (): string => { try { return fs.readFileSync(`/proc/${p.pid}/cmdline`, 'utf8'); } catch { return ''; } };
      for (let i = 0; i < 200 && !cmdline().startsWith(`/opt/${TAG}`); i += 1) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      fs.writeFileSync(path.join(home, '.claude', 'sessions', `${p.pid}.json`),
        JSON.stringify({ pid: p.pid, sessionId: SID, cwd: '/home/fixture' }, null, 2));
    }
    const r = spawnSync('bash', [SWEEP], { encoding: 'utf8', env });
    expect(r.status, r.stderr).toBe(0);
    return fs.existsSync(dir);
  };

  for (const row of ROWS) {
    const o = SWEEP_ROWS[row.name];
    if (o === undefined) throw new Error(`the table has a row the sweep twin does not name: ${row.name}`);
    if (o === null) continue;
    it(`${row.name}: the sweep ${o.protectedDir ? 'protects' : 'removes'} the dir${o.differs ? ' (a known difference)' : ''}`, () => {
      const kept = sweepsAndKeeps(row, o);
      expect(kept).toBe(o.protectedDir);
      // Doubt is never dead, so a fail-shut reader protects everything the table does not call dead; the sweep does so
      // except on the rows that say otherwise.
      const tableProtects = row.presence !== 'dead';
      expect(kept === tableProtects, o.differs ?? 'agrees with the table').toBe(o.differs === undefined);
    });
  }
});
