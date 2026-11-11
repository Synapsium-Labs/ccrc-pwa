// `ccrc doctor`, part: codex-host (D-6767): history, box-token, delegation-hooks, docs-sw, server-caps, oom-policy and update-sweep.
// They moved here unchanged from `ccrc-doctor-codex.test.ts`, itself a part of what was one 17,000-line file, which ran about 405 s
// on a CI runner and past the trace job's 1560 s budget under `strace -f`. The fixtures the doctor parts share are in
// `ccrc-doctorFixture.ts`, and those the codex parts share in `ccrc-doctor-codexFixture.ts`.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync, chmodSync, existsSync, utimesSync, appendFileSync, readdirSync, statSync, renameSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { describeLinux, itLinux, itDarwin } from './platformFixtures.js';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../../ccd/history/store.mjs';
import { HEALTH_COUNTERS, HEALTH_META, HEALTH_WORDS, RECOVERY_STALL_TICKS, SCHEMA_VERSION, deriveHealth, historyPaths, formatOpMarker, procStartOf, bootIdOf } from '../../ccd/history/lib.mjs';
import { PRELOADS, preloadOptions } from './historyHelpers.js';
import { SW_DENYLIST_DEFAULT, swJs } from './swFixtures.js';
import { SERVER_CAPS_LEASE_S } from '../../shared/api.js';
import { installDoctorHooks, REPO, CHECKS_SRC, BASH, Result, writeChecks, stub, unstub, linkReal, RosterEntry, UPSTREAM, writeRoster, writeRawRoster, shq, writeCcrcEnv, unitDirOf, unitFileOf, writeUnitFile, removeUnitFile, doctorEnv, OOM_DROPIN, plantOomPolicy, runDoctor, DH_INSTALLER, installerEvents, installerHook, plantHookRegistration, plantSpoolDir, healthy, tableNames, lineFor, anyVerdictFor, HEALTHY_SKIPS, plantSession, plantHistoryShim, historyBox } from './ccrc-doctorFixture.js';
import { treeState } from './ccrc-doctor-codexFixture.js';

// Each case's homes go when the case ends, not in a file-wide end sweep (R100, review 518's S1): that sweep overran vitest's 20 s
// hook timeout on the one file this family was split from. Registered before `installDoctorHooks()`'s root `afterEach` (the codex
// lanes' process kill) because vitest runs after-hooks in reverse order of registration: that kill still sees its home.
removeTmpFixturesEachTest();
installDoctorHooks();
const historyRoot = (home: string): string => join(home, '.ccrc', 'history');
const historyDbDir = (home: string): string => join(historyRoot(home), 'db');
const historyDb = (home: string): string => join(historyDbDir(home), 'history.db');

/** What every history case adds to the env: the statfs preload answering "plenty" (a box's real free space never
 *  decides a test, spec §10.1; since task 26 it also hides `/etc/claude-code`, so a host's managed settings never
 *  decide one either), passed as a file URL through `preloadOptions`, and a 20 s bound for the CLI, which a loaded
 *  box can need where `doctorEnv` gives tmux and gh 5 s. */
function historyEnv(over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { NODE_OPTIONS: preloadOptions([PRELOADS.statfs]), HISTORY_TEST_STATFS: 'plenty', CCRC_DOCTOR_GH_TIMEOUT: '20', ...over };
}

/** `_check_history` alone, as `cmd_doctor` runs it: `ccrc` sourced first (its `CCRC_HERE`, `BOX_ENV_FILE`,
 *  `_box_env_value`, `_plat_timeout`), then the check table, both through the fixture's
 *  `<home>/ccrc/ccd` links, so `$CCRC_HERE/history/cli.mjs` is the fixture tree's. One check is one node run where
 *  `runDoctor` runs forty checks; the cases about counting go through `runDoctor`. */
function runHistoryCheck(home: string, extraEnv: NodeJS.ProcessEnv = {}): Result {
  const ccd = join(home, 'ccrc', 'ccd');
  const r = spawnSync(BASH, ['-c',
    `set -uo pipefail; . ${shq(join(ccd, 'ccrc'))}; . ${shq(join(ccd, 'ccrc-doctor-checks'))}; _check_history`],
  { env: { ...doctorEnv(home), ...historyEnv(), ...extraEnv }, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function withStore(home: string, fn: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(historyDb(home));
  try { fn(db); } finally { db.close(); }
}

const setHistoryMeta = (db: DatabaseSync, k: string, v: string): void => {
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);
};

/** One `ticks` row (§6.2's columns; the row the sweep's `recordTick` writes), `agoS` seconds old. Rows go in
 *  oldest first, as ticks happen. */
const addTick = (db: DatabaseSync, t: { agoS: number; lagMs: number | null; filesBehind: number; bytesBehind: number }): void => {
  db.prepare('INSERT INTO ticks (ts_ms, lag_ms, bytes, files_behind, bytes_behind) VALUES (?, ?, 0, ?, ?)')
    .run(Date.now() - t.agoS * 1000, t.lagMs, t.filesBehind, t.bytesBehind);
};

/** The store ticked 30 s ago, is caught up and capture is unpaused: the baseline every store-state case below
 *  breaks one thing of. */
const freshTick = (db: DatabaseSync): void => {
  addTick(db, { agoS: 30, lagMs: 0, filesBehind: 0, bytesBehind: 0 });
  setHistoryMeta(db, 'last_zero_behind_ms', String(Date.now() - 30_000));
  setHistoryMeta(db, 'capture_pause', '');
};

/** The census's three numbers, as the sweep's periodic scan leaves them (task 26's meta keys). */
const setExport = (db: DatabaseSync, due: number, overdue: number): void => {
  setHistoryMeta(db, 'export_due', String(due));
  setHistoryMeta(db, 'export_overdue', String(overdue));
  setHistoryMeta(db, 'export_census_ms', String(Date.now() - 60_000));
};

/** `db/` moved onto a "volume" and linked back: the operator's §9.3 steps, with the target at `mode`. */
function linkDbTo(home: string, mode: number): string {
  const target = join(home, 'vol', 'history-db');
  mkdirSync(join(home, 'vol'), { recursive: true });
  renameSync(historyDbDir(home), target);
  chmodSync(target, mode);
  symlinkSync(target, historyDbDir(home));
  return target;
}

/** The dead-volume seam for the store's DB: Task 27's word on Task 14's statfs preload. With
 *  `HISTORY_TEST_STAT_HANG=/history.db`, `fs.promises.stat` of the DB never settles, which is a dead volume as
 *  the CLI's 2 s reachability probe meets it. One seam for the CLI's tests and doctor's, never a second preload. */
const statHangEnv = (): NodeJS.ProcessEnv => ({ NODE_OPTIONS: preloadOptions([PRELOADS.statfs]), HISTORY_TEST_STAT_HANG: '/history.db' });

const historyLines = (out: string): string[] => out.split('\n').filter((l) => /^(PASS|WARN|FAIL|SKIP) history: /.test(l));
/** The line after the first line starting with `prefix`: a non-PASS verdict's remedy. */
const lineAfter = (out: string, prefix: string): string => {
  const lines = out.split('\n');
  const i = lines.findIndex((l) => l.startsWith(prefix));
  return i < 0 ? '' : (lines[i + 1] ?? '');
};


// ── services: the history sweep's timer (spec 2026-10-05 §9.6) ─────────────
describe('ccrc doctor: services knows about the history sweep timer', () => {
  // `ccd-history-sweep.timer` joins `known`, the DIRECT design (the timer's own state), while `_check_history`
  // below measures the EFFECT: the store's last tick, whatever carries the sweep.
  itLinux('warns — with its OWN consequence — when the history timer is installed and stopped', () => {
    const home = healthy('ccrc-doctor-services-history-timer-');
    writeUnitFile(home, 'ccd-history-sweep.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-history-sweep.timer'), 'inactive\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN services: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccd-history-sweep.timer is installed but inactive');
    expect(lines[i]).toContain('session text is not being captured into the history store');
    expect(lines[i]).not.toContain('the job it fires is not running');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: systemctl --user enable --now ccd-history-sweep\.timer$/);
    expect(r.code).toBe(0);
  });

  itLinux('names it in the PASS line when it is installed and running', () => {
    const home = healthy('ccrc-doctor-services-history-timer-ok-');
    writeUnitFile(home, 'ccd-history-sweep.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-history-sweep.timer'), 'active\n');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).toContain('ccd-history-sweep.timer is active');
  });

  it('a box without the unit is never asked about it — no count moves', () => {
    const home = healthy('ccrc-doctor-services-history-timer-absent-');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).not.toContain('ccd-history-sweep');
  });
});


describe('ccrc doctor: history — the gates (O15)', () => {
  it('a box that records CCRC_ROLE=server SKIPs on its role even with a shim a re-role left, and the CLI there answers exit 9', () => {
    const home = healthy('ccrc-doctor-history-server-');
    plantHistoryShim(home, 3600);
    writeCcrcEnv(home, ['CCRC_ROLE=server', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    const r = runDoctor(home, ['doctor'], historyEnv());
    expect(historyLines(r.stdout)).toEqual([
      'SKIP history: this box records CCRC_ROLE=server, so it hosts no sessions and keeps no history store',
    ]);
    const cli = spawnSync(process.execPath, ['--no-warnings', join(home, 'ccrc', 'ccd', 'history', 'cli.mjs'), 'status', '--json'],
      { env: { ...doctorEnv(home), ...historyEnv() }, encoding: 'utf8' });
    expect(cli.status, cli.stderr).toBe(9);
    expect(existsSync(historyRoot(home)), 'status on a server box made a history directory').toBe(false);
  });

  it('a box with no shim SKIPs: the shim is the gate', () => {
    const home = healthy('ccrc-doctor-history-no-shim-');
    const r = runHistoryCheck(home);
    expect(historyLines(r.stdout)).toHaveLength(1);
    expect(historyLines(r.stdout)[0]).toMatch(/^SKIP history: no ccd-history-sweep at .*\/\.local\/bin\/ccd-history-sweep — /);
    // A SKIP names no remedy, so it never names the installer's command: the env-less fleet-role case asserts a
    // shim-less fleet box's whole doctor output never says `ccrc install`, and this line prints there.
    expect(historyLines(r.stdout)[0]).not.toMatch(/ccrc install/);
    expect(r.code).toBe(3);
  });

  itLinux('a fleet box with the shim and NO timer unit file is measured, never skipped: a container carrier has no unit file', () => {
    const home = healthy('ccrc-doctor-history-no-timer-');
    writeCcrcEnv(home, ['CCRC_ROLE=fleet', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    plantHistoryShim(home, 0);
    expect(existsSync(join(unitDirOf(home), unitFileOf('ccd-history-sweep.timer')))).toBe(false);
    const r = runHistoryCheck(home);
    expect(historyLines(r.stdout), r.stderr).toHaveLength(1);
    expect(historyLines(r.stdout)[0]).toMatch(/^PASS history: first-tick-pending: store none yet: /);
    expect(r.code).toBe(0);
  });

  itLinux('within the shim\'s grace, with no store and no tick, a whole doctor run PASSes first-tick-pending and FAILs nothing (D-4168)', () => {
    const home = healthy('ccrc-doctor-history-grace-');
    plantHistoryShim(home, 0);
    const r = runDoctor(home, ['doctor'], historyEnv());
    expect(lineFor(r.stdout, 'history'), r.stdout).toMatch(/^PASS history: first-tick-pending: /);
    // the check is a VERDICT now, so this healthy box skips one check fewer than `healthy()` alone
    expect(r.stdout).toMatch(new RegExp(
      `^summary: \\d+ checks \\(${HEALTHY_SKIPS - 1} skipped\\), \\d+ verdicts — \\d+ passed, 0 warned, 0 failed$`, 'm'));
    expect(r.code).toBe(0);
  });

  itLinux('past the grace with no store at all, it FAILs tick-stale: a sweep that never ran is not a fresh install', () => {
    const home = healthy('ccrc-doctor-history-never-ticked-');
    plantHistoryShim(home, 600);
    const r = runHistoryCheck(home);
    expect(historyLines(r.stdout)[0], r.stdout).toMatch(/^FAIL history: tick-stale: store /);
    expect(lineAfter(r.stdout, 'FAIL history: tick-stale: ')).toMatch(/^ {2}remedy: \S/);
    expect(r.code).toBe(1);
  });

  itLinux('a store with no tick yet: PASS first-tick-pending inside the grace, FAIL tick-stale past it', () => {
    const fresh = healthy('ccrc-doctor-history-store-no-tick-fresh-');
    plantHistoryShim(fresh, 0);
    const id = createStore(fresh).storeId;
    const a = runHistoryCheck(fresh);
    expect(historyLines(a.stdout)[0], a.stdout).toMatch(new RegExp(`^PASS history: first-tick-pending: store ${id}: `));
    const old = historyBox('ccrc-doctor-history-store-no-tick-old-');
    const b = runHistoryCheck(old.home);
    expect(historyLines(b.stdout)[0], b.stdout).toMatch(new RegExp(`^FAIL history: tick-stale: store ${old.storeId}`));
  });

  it('sourced without ccrc, it says so rather than guessing', () => {
    const nowhere = join(REPO, 'no-such-home-for-check-history');
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; _check_history`],
      { encoding: 'utf8', env: { HOME: nowhere, PATH: nowhere, LC_ALL: 'C' } });
    expect(r.stdout).toMatch(/^FAIL history: ccrc's own config reader is not loaded/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.status).toBe(1);
  });
});


describeLinux('ccrc doctor: history — a real store, state by state (O15, O28, O37, O41, O55, DM43)', () => {
  it('a caught-up store PASSes ok, naming its id, its last tick, its lag and whether it shares the root filesystem', () => {
    const { home, storeId } = historyBox('ccrc-doctor-history-ok-');
    withStore(home, freshTick);
    const r = runHistoryCheck(home);
    expect(historyLines(r.stdout), `${r.stdout}\n${r.stderr}`).toHaveLength(1);
    const line = historyLines(r.stdout)[0]!;
    // `ok` is task 28's pass word for a store with nothing to report; status's human form prints `health: PASS ok`
    expect(line).toMatch(new RegExp(`^PASS history: ok: store ${storeId}: last tick \\d+s ago, lag `));
    expect(line).toMatch(/; the store is on (the root filesystem|a filesystem of its own, not the root's)$/);
    expect(r.code).toBe(0);
  });

  /** One planted state: what to break, the word and class the check must print, and what the line or its remedy
   *  must also name. `plant` may return extra env for the CLI. */
  interface StateCase {
    name?: string;
    word: string;
    cls: 'FAIL' | 'WARN';
    plant: (home: string) => NodeJS.ProcessEnv | void;
    names?: (home: string, storeId: string) => string[];
    remedyNames?: (home: string) => string[];
    absent?: string[];
  }
  const tickAgo = (agoS: number): ((db: DatabaseSync) => void) => (db) => {
    addTick(db, { agoS, lagMs: 0, filesBehind: 0, bytesBehind: 0 });
    setHistoryMeta(db, 'last_zero_behind_ms', String(Date.now() - agoS * 1000));
    setHistoryMeta(db, 'capture_pause', '');
  };
  /** An unfinished recovery step on a fresh tick, as B2's producer will leave it and task 28's `readStoreExtras`
   *  reads it: a `derivation_state` row for step `recover` with no `completed_ms`, and the meta count of ticks its
   *  cursor has sat still. */
  const recoverStep = (unmoved: number): ((db: DatabaseSync) => void) => (db) => {
    freshTick(db);
    db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', 1, 'journal:120', NULL)").run();
    setHistoryMeta(db, HEALTH_META.recoverUnmovedTicks, String(unmoved));
  };
  /** One meta key on a fresh tick: the record a producer keeps for status to read. */
  const metaOnFreshTick = (k: string, v: string): ((db: DatabaseSync) => void) => (db) => {
    freshTick(db);
    setHistoryMeta(db, k, v);
  };
  /** D-5748: this test process's identity, read from /proc as D-5016 reads it, for an op marker that names its process. */
  const ownIdentity = (): { procStart: string; bootId: string } => {
    const procStart = procStartOf(readFileSync(`/proc/${process.pid}/stat`, 'utf8'));
    const bootId = bootIdOf(readFileSync('/proc/sys/kernel/random/boot_id', 'utf8'));
    if (procStart === null || bootId === null) throw new Error('this box has no /proc identity');
    return { procStart, bootId };
  };
  const STATES: StateCase[] = [
    // §8.3's store-open refusals, each from the files that make it
    { word: 'store-unbound', cls: 'FAIL', plant: (home) => { rmSync(join(historyRoot(home), 'store.id')); },
      names: (_h, id) => [id], remedyNames: () => ['--adopt'] },
    { word: 'store-missing', cls: 'FAIL',
      plant: (home) => { for (const s of ['', '-wal', '-shm']) rmSync(`${historyDb(home)}${s}`, { force: true }); },
      remedyNames: () => ['--rebuild'] },
    { word: 'store-mismatch', cls: 'FAIL',
      plant: (home) => { writeFileSync(join(historyRoot(home), 'store.id'), '00000000-0000-4000-8000-000000000000\n', { mode: 0o600 }); } },
    { word: 'store-zero-byte', cls: 'FAIL', plant: (home) => { truncateSync(historyDb(home), 0); } },
    { word: 'store-recoverable', cls: 'FAIL', plant: (home) => {
      rmSync(historyDbDir(home), { recursive: true });
      rmSync(join(historyRoot(home), 'store.id'));
      mkdirSync(join(historyRoot(home), 'journal', '00000000-0000-4000-8000-0000000000aa'), { recursive: true, mode: 0o700 });
    } },
    { word: 'store-wal-orphaned', cls: 'FAIL', plant: (home) => {
      rmSync(historyDb(home));
      rmSync(join(historyRoot(home), 'store.id'));
      writeFileSync(`${historyDb(home)}-wal`, '', { mode: 0o600 });
    } },
    { word: 'store-root-dangling', cls: 'FAIL', plant: (home) => {
      rmSync(historyDbDir(home), { recursive: true });
      symlinkSync(join(home, 'vol-gone', 'history-db'), historyDbDir(home));
    } },
    // O28: a store on a dead volume answers within the CLI's own deadline, and doctor names it
    { word: 'store-unreachable', cls: 'FAIL',
      plant: () => statHangEnv() },
    // the two refusals task 27's own cases plant: a store.writer that is not a writer token is a binding read that
    // failed (§5.3 "Binding reads"; content, not a mode, so a root-run suite meets it too), and a bound store out
    // of WAL mode is store-not-wal (§6.2). Both answer exit 5 with the store's id.
    { word: 'store-unmeasured', cls: 'FAIL',
      plant: (home) => { writeFileSync(join(historyRoot(home), 'store.writer'), 'not a writer token\n'); },
      names: (_h, id) => [id], remedyNames: () => ['store.writer', 'readable by this user'] },
    { word: 'store-not-wal', cls: 'FAIL',
      plant: (home) => withStore(home, (db) => { db.exec('PRAGMA journal_mode = DELETE'); }),
      names: (_h, id) => [id], remedyNames: () => ['WAL mode'] },
    // fts-unavailable: the CLI's own FTS5 probe answers "absent" through task 23's HISTORY_TEST_FTS_PROBE knob of
    // the faults preload (O9's seam), the same kind of plant as store-unreachable's dead volume above
    { word: 'fts-unavailable', cls: 'WARN',
      plant: (home) => {
        withStore(home, freshTick);
        return { NODE_OPTIONS: preloadOptions([PRELOADS.statfs, PRELOADS.faults]), HISTORY_TEST_FTS_PROBE: 'absent' };
      },
      names: () => ['fts5-absent'], remedyNames: () => ['Node >= 22.16.0'], absent: ['FAIL history: '] },
    // the states in which no fresh tick is expected (D-4251), each beside its pair
    { name: 'off: history-off with no tick for an hour is a WARN, never the stale-tick FAIL', word: 'off', cls: 'WARN',
      plant: (home) => { withStore(home, tickAgo(3600)); writeFileSync(join(home, '.ccrc', 'history-off'), ''); },
      absent: ['FAIL history: tick-stale'] },
    { name: 'op-running: a live op marker with no tick for 40 min is a WARN', word: 'op-running', cls: 'WARN',
      plant: (home) => {
        withStore(home, tickAgo(2400));
        writeFileSync(join(historyRoot(home), 'op'), `prune ${process.pid} ${Date.now() - 2_400_000}\n`, { mode: 0o600 });
      },
      absent: ['FAIL history: tick-stale'] },
    { name: 'tick-stale: a dead pid\'s op marker holds nothing back', word: 'tick-stale', cls: 'FAIL',
      plant: (home) => {
        const dead = spawnSync(process.execPath, ['-e', '0']).pid;
        withStore(home, tickAgo(2400));
        writeFileSync(join(historyRoot(home), 'op'), `prune ${dead} ${Date.now() - 2_400_000}\n`, { mode: 0o600 });
      } },
    // W5h-2 Task 4 (D-5748): the op marker names its process; the two rows above plant the legacy three-field form an older build writes.
    { name: 'D-5748: an op marker whose identity measures equal is a live operator pass, a WARN and never the stale-tick FAIL', word: 'op-running', cls: 'WARN',
      plant: (home) => {
        withStore(home, tickAgo(2400));
        writeFileSync(join(historyRoot(home), 'op'), formatOpMarker({ verb: 'prune', pid: process.pid, startMs: Date.now() - 2_400_000, ...ownIdentity() }), { mode: 0o600 });
      },
      absent: ['FAIL history: tick-stale'] },
    { name: 'D-5748: an op marker naming a live pid with another start time (a reused pid) holds nothing back', word: 'tick-stale', cls: 'FAIL',
      plant: (home) => {
        const me = ownIdentity();
        withStore(home, tickAgo(2400));
        writeFileSync(join(historyRoot(home), 'op'),
          formatOpMarker({ verb: 'prune', pid: process.pid, startMs: Date.now() - 2_400_000, procStart: String(Number(me.procStart) + 1), bootId: me.bootId }), { mode: 0o600 });
      },
      absent: ['WARN history: op-running'] },
    { name: 'catching-up: bytes behind falling across three ticks is a WARN, never the lag FAIL', word: 'catching-up', cls: 'WARN',
      plant: (home) => withStore(home, (db) => {
        for (const [agoS, b] of [[90, 3000], [60, 2000], [30, 1000]] as const) {
          addTick(db, { agoS, lagMs: 7_200_000, filesBehind: 2, bytesBehind: b });
        }
        setHistoryMeta(db, 'last_zero_behind_ms', String(Date.now() - 7_200_000));
        setHistoryMeta(db, 'capture_pause', '');
      }),
      absent: ['FAIL history: lag-high'] },
    { name: 'lag-high: the same lag with bytes behind flat is the FAIL', word: 'lag-high', cls: 'FAIL',
      plant: (home) => withStore(home, (db) => {
        for (const agoS of [90, 60, 30]) addTick(db, { agoS, lagMs: 7_200_000, filesBehind: 2, bytesBehind: 1000 });
        setHistoryMeta(db, 'last_zero_behind_ms', String(Date.now() - 7_200_000));
        setHistoryMeta(db, 'capture_pause', '');
      }) },
    { name: 'lag-unmeasured: a fresh tick with no measured lag is a WARN and nothing FAILs', word: 'lag-unmeasured', cls: 'WARN',
      plant: (home) => withStore(home, (db) => {
        addTick(db, { agoS: 30, lagMs: null, filesBehind: 1, bytesBehind: 500 });
        setHistoryMeta(db, 'capture_pause', '');
      }),
      absent: ['FAIL history: '] },
    { name: 'tick-stale: the last tick 20 minutes ago', word: 'tick-stale', cls: 'FAIL', plant: (home) => withStore(home, tickAgo(1200)) },
    // O10's and O19's doctor clauses: the pauses the sweep recorded
    { word: 'at-cap', cls: 'FAIL', plant: (home) => withStore(home, (db) => { freshTick(db); setHistoryMeta(db, 'capture_pause', 'at-cap'); }) },
    { word: 'capture-paused-low-disk', cls: 'FAIL',
      plant: (home) => withStore(home, (db) => { freshTick(db); setHistoryMeta(db, 'capture_pause', 'low-disk'); }) },
    // modes (§9.3), and O55: a linked db/ is measured at its target, never at the link
    { word: 'mode-wrong', cls: 'FAIL', plant: (home) => { withStore(home, freshTick); chmodSync(historyDb(home), 0o644); },
      names: (home) => [historyDb(home)] },
    { name: 'O55: a linked db/ whose TARGET is 0755 FAILs, naming the target and the chmod', word: 'mode-wrong', cls: 'FAIL',
      plant: (home) => { withStore(home, freshTick); linkDbTo(home, 0o755); },
      names: (home) => [join(home, 'vol', 'history-db')],
      remedyNames: (home) => ['chmod', join(home, 'vol', 'history-db')] },
    { word: 'root-is-symlink', cls: 'WARN', plant: (home) => {
      withStore(home, freshTick);
      const t = join(home, 'vol', 'history-root');
      mkdirSync(join(home, 'vol'), { recursive: true });
      renameSync(historyRoot(home), t);
      symlinkSync(t, historyRoot(home));
    } },
    { word: 'cap-malformed', cls: 'WARN',
      plant: (home) => { withStore(home, freshTick); writeFileSync(join(home, '.ccrc', 'history-max-gb'), 'lots\n'); },
      names: (home) => [join(home, '.ccrc', 'history-max-gb')] },
    { word: 'schema-newer', cls: 'FAIL', plant: (home) => withStore(home, (db) => { freshTick(db); db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`); }) },
    // O41, the doctor half: the gap guard fires on the census's counts, never on a date
    // O41's B4 cases: this build has the export writer, so a due count alone is the pass's cadence; the WARN needs
    // a gap — the last pass over two intervals old, or the oldest due blob waiting longer than that.
    { name: 'O41 (B4): a due blob with the last export pass over 2 h old WARNs export-due, naming the count, and FAILs nothing while none is overdue', word: 'export-due', cls: 'WARN',
      plant: (home) => withStore(home, (db) => { freshTick(db); setExport(db, 3, 0); setHistoryMeta(db, HEALTH_META.exportPassMs, String(Date.now() - 3 * 3_600_000)); }),
      names: () => ['3'], absent: ['FAIL history: export-overdue'] },
    // The writer is live in this build, so the remedy is the writer's (W1-B4 review 614), not B1's wait for a writer to ship.
    { name: 'O41: an overdue blob FAILs export-overdue', word: 'export-overdue', cls: 'FAIL',
      plant: (home) => withStore(home, (db) => { freshTick(db); setExport(db, 3, 2); }),
      remedyNames: () => ['never --purge-history', 'one segment an hour'] },
    { name: 'O41 (B4): a due blob that has waited over two pass intervals WARNs export-due, though the last pass is fresh', word: 'export-due', cls: 'WARN',
      plant: (home) => withStore(home, (db) => {
        freshTick(db);
        setExport(db, 3, 0);
        setHistoryMeta(db, HEALTH_META.exportPassMs, String(Date.now() - 10 * 60_000));
        setHistoryMeta(db, HEALTH_META.exportDueOldestMs, String(Date.now() - 3 * 3_600_000));
      }),
      names: () => ['3'], absent: ['FAIL history: '] },
    { name: 'O40 (B4): an export paused for room on the home filesystem WARNs export-paused-low-disk, and FAILs nothing', word: 'export-paused-low-disk', cls: 'WARN',
      plant: (home) => withStore(home, metaOnFreshTick(HEALTH_META.exportPaused, 'low-disk')),   // Task 6 writes planExportRoom's word
      absent: ['FAIL history: '] },
    { word: 'retention-lowered', cls: 'WARN',
      plant: (home) => withStore(home, (db) => {
        freshTick(db);
        setHistoryMeta(db, 'retention_lowered', JSON.stringify({ home: join(home, '.acct-b'), days: 30, othersMin: 180 }));
      }),
      names: (home) => [join(home, '.acct-b'), '30', '180'] },
    { word: 'journal-growth', cls: 'WARN',
      plant: (home) => withStore(home, (db) => { freshTick(db); setHistoryMeta(db, 'journal_growth_30d', String(50 * 1024 * 1024)); }) },
    // O15: the rules whose producer ships later, or that this fixture never runs, planted as the rows, meta and
    // files that producer leaves, so the CLI's reading of them is measured too — never fed to the relay by hand
    { name: 'recovering: an unfinished recovery step whose cursor moved lately is a WARN, and nothing FAILs', word: 'recovering', cls: 'WARN',
      plant: (home) => withStore(home, recoverStep(2)),
      names: () => ['journal:120'], absent: ['FAIL history: '] },
    { name: 'recovery-stalled: the same step, its cursor still for RECOVERY_STALL_TICKS ticks, FAILs', word: 'recovery-stalled', cls: 'FAIL',
      plant: (home) => withStore(home, recoverStep(RECOVERY_STALL_TICKS)),
      names: () => [String(RECOVERY_STALL_TICKS), 'journal:120'], absent: ['WARN history: recovering: '] },
    { word: 'breaker-open', cls: 'WARN',
      plant: (home) => withStore(home, (db) => {
        freshTick(db);
        db.prepare('INSERT INTO breaker (key, consecutive_fail, open_until_ms) VALUES (?, ?, ?)').run('fixture-file', 3, Date.now() + 600_000);
      }),
      absent: ['FAIL history: '] },
    { name: 'DM43: a migration too long for a scheduled pass FAILs migration-needs-op, its remedy the --migrate verb', word: 'migration-needs-op', cls: 'FAIL',
      plant: (home) => withStore(home, metaOnFreshTick('migration', 'snapshot-needs-op')),
      remedyNames: () => ['ccrc history doctor --migrate'], absent: ['interrupted'] },
    // FIN item 4: the verdict also comes from planMigration's interrupted-attempts arm, whatever the size; status carries the count
    // (the marker `.pre-v<code>.attempt`, read with readAttempts) so the line names that reason and never calls the estimate too long.
    { name: 'DM43: a small store whose migration was interrupted twice FAILs migration-needs-op naming the attempts, not an estimate too long for a scheduled pass', word: 'migration-needs-op', cls: 'FAIL',
      plant: (home) => {
        withStore(home, metaOnFreshTick('migration', 'snapshot-needs-op'));
        const backups = historyPaths(home).backups;
        mkdirSync(backups, { recursive: true, mode: 0o700 });
        writeFileSync(join(backups, `.pre-v${SCHEMA_VERSION}.attempt`), '2\n', { mode: 0o600 });
      },
      names: () => ['interrupted 2 times'], remedyNames: () => ['ccrc history doctor --migrate'], absent: ['too long for a scheduled pass'] },
    // FIN2 item 2: a marker that cannot be measured counts as the cap for the verdict, and the line says so instead of printing a count.
    ...([['a garbled', 'garbled\n'], ['an empty', '']] as const).map(([what, body]): StateCase => ({
      name: `DM43: ${what} attempt marker FAILs migration-needs-op naming the marker as unreadable, not an interrupted count`, word: 'migration-needs-op', cls: 'FAIL',
      plant: (home) => {
        withStore(home, metaOnFreshTick('migration', 'snapshot-needs-op'));
        const backups = historyPaths(home).backups;
        mkdirSync(backups, { recursive: true, mode: 0o700 });
        writeFileSync(join(backups, `.pre-v${SCHEMA_VERSION}.attempt`), body, { mode: 0o600 });
      },
      names: () => ['the attempt marker', 'could not be read, so a scheduled pass treats the migration as interrupted'], remedyNames: () => ['ccrc history doctor --migrate'],
      absent: ['started and interrupted', 'too long for a scheduled pass'],
    })),
    { name: 'migration-refused: a migration refused for room FAILs, its remedy a measured byte count', word: 'migration-refused', cls: 'FAIL',
      plant: (home) => withStore(home, metaOnFreshTick('migration', 'refuse-low-disk')),
      remedyNames: () => ['free space'], absent: ['undefined', 'NaN bytes'] },
    { name: 'O37: a journal append the sweep recorded as failed FAILs journal-unwritable', word: 'journal-unwritable', cls: 'FAIL',
      plant: (home) => withStore(home, metaOnFreshTick('journal_unwritable', String(Date.now() - 30_000))) },
    { word: 'redact-source-unreadable', cls: 'WARN',
      plant: (home) => withStore(home, metaOnFreshTick('redact_unreadable', JSON.stringify([join(home, '.cc-secrets', 'fixture.env')]))),
      names: (home) => [join(home, '.cc-secrets', 'fixture.env')], remedyNames: (home) => [join(home, '.cc-secrets', 'fixture.env')] },
    { word: 'retention-unmeasured', cls: 'WARN',
      plant: (home) => withStore(home, metaOnFreshTick(`retention_state:${join(home, '.acct-b')}`, 'unmeasured')),
      names: (home) => [join(home, '.acct-b')] },
    { word: 'journal-record-skipped', cls: 'WARN',
      plant: (home) => withStore(home, metaOnFreshTick('journal_skipped', '4')),
      names: () => ['4'] },
    { word: 'blob-undecodable', cls: 'WARN', plant: (home) => withStore(home, (db) => { freshTick(db); db.prepare('INSERT INTO counters (name, n) VALUES (?, ?)').run(HEALTH_COUNTERS.blobUndecodable, 2); }), names: () => ['2'] },
    { word: 'drain-rejected', cls: 'WARN', plant: (home) => withStore(home, (db) => { freshTick(db); db.prepare('INSERT INTO counters (name, n) VALUES (?, ?)').run(HEALTH_COUNTERS.drainRejected, 3); }), names: () => ['3'] },
    { word: 'spool-planted', cls: 'WARN', plant: (home) => withStore(home, (db) => { freshTick(db); const ins = db.prepare('INSERT INTO counters (name, n) VALUES (?, ?)'); ins.run(HEALTH_COUNTERS.spoolDisplaced, 2); ins.run(HEALTH_COUNTERS.spoolBlocked, 1); }), names: () => ['2 spool file(s)', '1 skipped drain(s)'] },
    { word: 'export-segment-newer', cls: 'FAIL',
      plant: (home) => withStore(home, metaOnFreshTick(HEALTH_META.exportSegmentNewer, JSON.stringify(['7.0a1b2c3d.db']))),
      names: () => ['7.0a1b2c3d.db'] },
    { word: 'export-segment-missing', cls: 'WARN',
      plant: (home) => withStore(home, metaOnFreshTick(HEALTH_META.exportSegmentMissing, '2')),
      names: () => ['2'] },
    { word: 'export-segment-damaged', cls: 'WARN',
      plant: (home) => withStore(home, metaOnFreshTick(HEALTH_META.exportSegmentDamaged, JSON.stringify(['2.0a1b2c3d.db']))),
      names: () => ['2.0a1b2c3d.db'], remedyNames: () => ['for good, but not while a recovery is open', 'move each named file out of'] },
    // W5h-1 Task 2 (D-5633): the check after a bind's stop record, as Task 1's check writes it ('<word> <sinceMs> <cleared>').
    { name: 'D-5633: a check after a bind that stopped WARNs export-marks-unchecked, naming its word and the marks it cleared', word: 'export-marks-unchecked', cls: 'WARN',
      plant: (home) => withStore(home, metaOnFreshTick(HEALTH_META.exportMarksCheck, `budget ${Date.now() - 30 * 60_000} 4`)),
      names: () => ['budget', '4 mark(s)'], remedyNames: () => ['none needed while ingest leaves the check room'], absent: ['FAIL history: '] },
    { name: 'D-5633: a check stopped on an escalating word for over a day FAILs export-marks-stalled, so doctor goes red', word: 'export-marks-stalled', cls: 'FAIL',
      plant: (home) => withStore(home, metaOnFreshTick(HEALTH_META.exportMarksCheck, `unlistable ${Date.now() - 25 * 3_600_000} 0`)),
      names: () => ['unlistable'], remedyNames: () => ['a directory this user can read'], absent: ['WARN history: export-marks-unchecked'] },
    { name: 'roster-unreadable: a box whose accounts.sh is gone WARNs — the sweep\'s shim sources it', word: 'roster-unreadable', cls: 'WARN',
      plant: (home) => { withStore(home, freshTick); rmSync(join(home, '.ccrc', 'accounts.sh')); },
      absent: ['FAIL history: '] },
  ];

  it.each(STATES.map((c) => [c.name ?? c.word, c] as [string, StateCase]))('%s', (_name, c) => {
    const { home, storeId } = historyBox(`ccrc-doctor-history-${c.word}-`);
    const env = c.plant(home) ?? {};
    const r = runHistoryCheck(home, env);
    const prefix = `${c.cls} history: ${c.word}: store `;
    const line = historyLines(r.stdout).find((l) => l.startsWith(prefix));
    expect(line, `no "${prefix}" line\n${r.stdout}\n${r.stderr}`).toBeDefined();
    expect(lineAfter(r.stdout, prefix)).toMatch(/^ {2}remedy: \S/);
    // a number is looked for with the store id and the HOME taken out, so a digit inside either never satisfies it
    const bare = line!.replaceAll(storeId, '').replaceAll(home, '');
    for (const n of c.names?.(home, storeId) ?? []) {
      if (/^\d+$/.test(n)) expect(bare).toMatch(new RegExp(`\\b${n}\\b`));
      else expect(line).toContain(n);
    }
    for (const n of c.remedyNames?.(home) ?? []) expect(lineAfter(r.stdout, prefix)).toContain(n);
    for (const a of c.absent ?? []) expect(r.stdout, `${a} printed beside ${c.word}`).not.toContain(a);
    expect(r.code).toBe(historyLines(r.stdout).some((l) => l.startsWith('FAIL ')) ? 1 : 2);
  });

  it('O55: a linked db/ whose target is 0700 PASSes — the link\'s own mode (a symlink always reads 777) is never read', () => {
    const { home, storeId } = historyBox('ccrc-doctor-history-link-0700-');
    withStore(home, freshTick);
    linkDbTo(home, 0o700);
    const r = runHistoryCheck(home);
    expect(historyLines(r.stdout), r.stdout).toHaveLength(1);
    expect(historyLines(r.stdout)[0]).toMatch(new RegExp(`^PASS history: ok: store ${storeId}: `));
  });

  it('O41: nothing due and nothing overdue: neither export word', () => {
    const { home } = historyBox('ccrc-doctor-history-export-none-');
    withStore(home, (db) => { freshTick(db); setExport(db, 0, 0); });
    const r = runHistoryCheck(home);
    expect(r.stdout).not.toMatch(/^(WARN|FAIL) history: export-(due|overdue): /m);
    expect(r.code).toBe(0);
  });

  it('O41 (B4): steady state — three blobs due, an hourly pass 10 min ago, the oldest due 90 min ago — PASSes ok', () => {
    const { home, storeId } = historyBox('ccrc-doctor-history-export-steady-');
    withStore(home, (db) => {
      freshTick(db);
      setExport(db, 3, 0);
      setHistoryMeta(db, HEALTH_META.exportPassMs, String(Date.now() - 10 * 60_000));
      setHistoryMeta(db, HEALTH_META.exportDueOldestMs, String(Date.now() - 90 * 60_000));
    });
    const r = runHistoryCheck(home);
    expect(historyLines(r.stdout), r.stdout).toHaveLength(1);
    expect(historyLines(r.stdout)[0]).toMatch(new RegExp(`^PASS history: ok: store ${storeId}: `));
    expect(r.code).toBe(0);
  });
});


describe('ccrc doctor: history — the relay (O15: every word, and the one rule no fixture can plant)', () => {
  const SID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

  /** `node` that answers `ccrc history status --json` from `<home>/fixture-history-status` with exit `rc`, and,
   *  while `<home>/fixture-history-hang` is a FIFO, never answers at all. Every other call goes to the real
   *  interpreter, as `stubNode` does. Shell builtins only: this fixture's PATH holds no system directory. */
  function stubHistoryStatus(home: string, body: string, rc = 0): void {
    writeFileSync(join(home, 'fixture-history-status'), body);
    stub(home, 'node', [
      `if [ "$1" = "--version" ]; then echo 'v22.20.0'; exit 0; fi`,
      'case "$*" in',
      '  *history/cli.mjs*)',
      '    if [ -p "$HOME/fixture-history-hang" ]; then exec 3<>"$HOME/fixture-history-hang"; read -r x <&3; fi',
      '    while IFS= read -r l || [ -n "$l" ]; do printf \'%s\\n\' "$l"; done < "$HOME/fixture-history-status"',
      `    exit ${rc} ;;`,
      'esac',
      `exec '${process.execPath}' "$@"`,
    ].join('\n'));
  }
  const envelope = (health: unknown, over: Record<string, unknown> = {}): string =>
    `${JSON.stringify({ v: 1, exit: 0, store_id: SID, coverage: 'this-box', last_tick_ms: Date.now() - 30_000, lag: 12, health, ...over })}\n`;
  const item = (word: string): { word: string; detail: string; remedy: string } =>
    ({ word, detail: `store ${SID}: fixture finding for ${word}`, remedy: `fixture remedy for ${word}` });
  const relayBox = (prefix: string): string => {
    const home = healthy(prefix);
    plantHistoryShim(home, 3600);
    return home;
  };

  const NON_PASS = Object.entries(HEALTH_WORDS).filter(([, c]) => c !== 'pass') as Array<[string, 'warn' | 'fail']>;

  it('CONTROL: HEALTH_WORDS declares the words this relay is asked about', () => {
    expect(NON_PASS.length).toBeGreaterThan(30);
    expect(Object.entries(HEALTH_WORDS).filter(([, c]) => c === 'pass').map(([w]) => w)).toContain('first-tick-pending');
  });

  it.each(NON_PASS)('%s (%s) is printed in its own class, with its remedy on the next line', (word, cls) => {
    const home = relayBox(`ccrc-doctor-history-relay-${word}-`);
    stubHistoryStatus(home, envelope(cls === 'fail'
      ? { pass: null, warn: [], fail: [item(word)] }
      : { pass: null, warn: [item(word)], fail: [] }));
    const r = runHistoryCheck(home);
    const C = cls.toUpperCase();
    expect(historyLines(r.stdout), r.stderr).toEqual([`${C} history: ${word}: store ${SID}: fixture finding for ${word}`]);
    expect(lineAfter(r.stdout, `${C} history: `)).toBe(`  remedy: fixture remedy for ${word}`);
    expect(r.code).toBe(cls === 'fail' ? 1 : 2);
  });

  it('a FAIL and a WARN in one report: both lines, the FAIL first, each with its remedy, and the check returns the FAIL', () => {
    const home = relayBox('ccrc-doctor-history-relay-two-');
    stubHistoryStatus(home, envelope({ pass: null, warn: [item('cap-near')], fail: [item('tick-stale')] }));
    const r = runHistoryCheck(home);
    expect(r.stdout.split('\n').filter(Boolean)).toEqual([
      `FAIL history: tick-stale: store ${SID}: fixture finding for tick-stale`, '  remedy: fixture remedy for tick-stale',
      `WARN history: cap-near: store ${SID}: fixture finding for cap-near`, '  remedy: fixture remedy for cap-near',
    ]);
    expect(r.code).toBe(1);
  });

  it('the grace word PASSes, naming the store and its facts', () => {
    const home = relayBox('ccrc-doctor-history-relay-grace-');
    stubHistoryStatus(home, envelope({ pass: 'first-tick-pending', warn: [], fail: [] }));
    const r = runHistoryCheck(home);
    expect(historyLines(r.stdout)).toHaveLength(1);
    expect(historyLines(r.stdout)[0]).toMatch(new RegExp(`^PASS history: first-tick-pending: store ${SID}: last tick \\d+s ago, lag 12s; `));
    expect(r.code).toBe(0);
  });

  it('an empty report PASSes with no word, and a store with no db/ yet says its filesystem was not measured', () => {
    const home = relayBox('ccrc-doctor-history-relay-clean-');
    stubHistoryStatus(home, envelope({ pass: null, warn: [], fail: [] }));
    const r = runHistoryCheck(home);
    expect(historyLines(r.stdout)).toEqual([expect.stringMatching(
      new RegExp(`^PASS history: store ${SID}: last tick \\d+s ago, lag 12s; its filesystem was not measured$`))]);
  });

  it('status that prints nothing readable FAILs status-unreadable, naming its exit code', () => {
    const home = relayBox('ccrc-doctor-history-relay-garbage-');
    stubHistoryStatus(home, 'not json at all\n', 1);
    const r = runHistoryCheck(home);
    expect(historyLines(r.stdout)).toEqual([
      'FAIL history: status-unreadable: ccrc history status --json exited 1 and printed nothing this check can read as a health report',
    ]);
    expect(lineAfter(r.stdout, 'FAIL history: status-unreadable: ')).toMatch(/^ {2}remedy: run it by hand to see why: node --no-warnings \S+\/history\/cli\.mjs status; /);
    expect(r.code).toBe(1);
  });

  it('a report without a health block, or carrying a word the check cannot vouch for, is unreadable too — no word is relayed', () => {
    const home = relayBox('ccrc-doctor-history-relay-shape-');
    for (const body of [
      envelope(undefined),
      envelope({ pass: null, warn: [], fail: [{ word: 'Not A Word', detail: 'x', remedy: 'y' }] }),
      envelope({ pass: null, warn: [{ word: 'cap-near', detail: 7, remedy: 'y' }], fail: [] }),
    ]) {
      stubHistoryStatus(home, body);
      const r = runHistoryCheck(home);
      expect(historyLines(r.stdout), body).toHaveLength(1);
      expect(historyLines(r.stdout)[0]).toMatch(/^FAIL history: status-unreadable: /);
    }
  });

  it('a status that never answers FAILs within the bound, naming it — never a hung doctor', () => {
    const home = relayBox('ccrc-doctor-history-relay-hang-');
    stubHistoryStatus(home, envelope({ pass: null, warn: [], fail: [] }));
    const made = spawnSync('mkfifo', [join(home, 'fixture-history-hang')], { encoding: 'utf8' });
    expect(made.status, made.stderr).toBe(0);
    const t0 = Date.now();
    const r = runHistoryCheck(home, { CCRC_DOCTOR_GH_TIMEOUT: '2' });
    expect(Date.now() - t0, 'the check waited out more than its bound').toBeLessThan(15_000);
    expect(historyLines(r.stdout)).toEqual([
      'FAIL history: status-unreadable: ccrc history status --json did not answer within 2s — a store on a hung filesystem blocks every stat on it',
    ]);
    expect(r.code).toBe(1);
  });

  it('exit 9 with nothing to report SKIPs; any other non-zero exit with nothing to report FAILs status-unreadable', () => {
    const home = relayBox('ccrc-doctor-history-relay-exit-');
    stubHistoryStatus(home, envelope({ pass: null, warn: [], fail: [] }, { exit: 9, store_id: null }), 9);
    const a = runHistoryCheck(home);
    expect(historyLines(a.stdout)).toEqual(['SKIP history: ccrc history status answers exit 9: this box keeps no history store']);
    expect(a.code).toBe(3);
    stubHistoryStatus(home, envelope({ pass: null, warn: [], fail: [] }, { exit: 5, reason: 'store-mismatch' }), 5);
    const b = runHistoryCheck(home);
    expect(historyLines(b.stdout)).toEqual([
      'FAIL history: status-unreadable: ccrc history status --json exited 5 (store-mismatch) and reported no health verdict',
    ]);
  });

  it('with no jq on PATH it WARNs and points at the jq check', () => {
    const home = relayBox('ccrc-doctor-history-relay-nojq-');
    stubHistoryStatus(home, envelope({ pass: null, warn: [], fail: [] }));
    unstub(home, 'jq');
    const r = runHistoryCheck(home);
    expect(historyLines(r.stdout)).toEqual([
      "WARN history: jq is not on PATH, so ccrc history status --json could not be read — see the 'jq' check above",
    ]);
    expect(r.code).toBe(2);
  });

  // The one rule whose input no fixture can make (D-4259, its ledger text corrected by D-4302): cap-near needs a store whose
  // measured size (page_count × page_size, plus its -wal) is within CAP_WARN_PCT of a cap of at least 1 GB, so
  // hundreds of MB of real pages. It is answered by the REAL `deriveHealth` and relayed: the word, the class and
  // the remedy text it computes all reach the doctor line. Every other rule, store-not-wal, store-unmeasured and
  // fts-unavailable included, is planted above and read through the real CLI.
  // `cleanInputs` is task 28's whole `HealthInputs`, its seven added fields and Task 28F's `extrasUnmeasured` included, so tsc holds it to
  // `lib.d.mts` and no remedy reads an absent field.
  const cleanInputs = (now: number): Parameters<typeof deriveHealth>[0] => ({
    nowMs: now, storeId: SID, exit: 0, reason: null, shimMtimeMs: now - 3_600_000, lastTickMs: now - 30_000, lagS: 30,
    sizeBytes: 1_048_576, capGb: 50, capMalformed: false, capFile: '/home/u/.ccrc/history-max-gb', capturePause: '',
    migration: 'none', userVersion: 1, codeVersion: 1, historyOff: false, recovering: null, op: null, pass: null,
    bytesBehindLast3: [0, 0, 0], fts: 'ready', modesWrong: [], rootIsSymlink: false, redactUnreadable: [],
    breakerOpen: false, rosterUnreadable: false, exportDue: 0, exportOverdue: 0, exportWriterLive: false,
    exportPausedLowDisk: false, retentionLowered: null, retentionUnmeasured: [], journalGrowth30d: 0, journalSkipped: 0, blobUndecodable: 0, drainRejected: 0, spoolDisplaced: 0, spoolBlocked: 0, spoolUnreadable: 0, spoolNotDirectory: false, spoolNodesRefused: 0,
    exportSegmentNewer: [], exportSegmentMissing: 0, exportSegmentDamaged: [], journalUnwritable: false,
    dbPath: '/home/u/.ccrc/history/db', freeBytes: null, thresholdBytes: null, copyBps: null, backupsDb: [],
    journalStoreDirs: [], extrasUnmeasured: [], exportLastPassMs: null, exportDueOldestMs: null,
  });

  it('CONTROL: deriveHealth answers the clean inputs with PASS ok and nothing to report', () => {
    expect(deriveHealth(cleanInputs(Date.now()))).toEqual({ pass: 'ok', warn: [], fail: [] });
  });

  const DERIVED: Array<[string, 'WARN' | 'FAIL', Partial<Parameters<typeof deriveHealth>[0]>, string]> = [
    ['cap-near', 'WARN', { sizeBytes: 43 * 2 ** 30 }, '/home/u/.ccrc/history-max-gb'],
  ];

  it.each(DERIVED)('%s, as deriveHealth answers it, reaches the doctor as %s with its own remedy', (word, cls, over, remedy) => {
    const home = relayBox(`ccrc-doctor-history-derived-${word}-`);
    const report = deriveHealth({ ...cleanInputs(Date.now()), ...over });
    const own = [...report.fail, ...report.warn].find((i) => i.word === word);
    expect(own, JSON.stringify(report)).toBeDefined();
    expect(own!.remedy).toContain(remedy);   // the word's own remedy, never a fallback
    stubHistoryStatus(home, envelope(report));
    const r = runHistoryCheck(home);
    const prefix = `${cls} history: ${word}: store ${SID}: `;
    expect(historyLines(r.stdout).find((l) => l.startsWith(prefix)), r.stdout).toBeDefined();
    expect(lineAfter(r.stdout, prefix)).toBe(`  remedy: ${own!.remedy}`);
    expect(r.stdout).not.toMatch(/undefined|NaN/);
  });
});


// ── box-token, through `ccrc doctor` (box-token lifecycle Task B5; armed by row 2a) ────────
// The check's states are `doctor-box-token.test.ts`'s; these pin what only the real runner can: that the check is
// in the table, that a no-role box is counted as a skip (exactly one SKIP line, rc 3), that a `CCRC_ROLE=server` box
// runs the server arm rather than the D-3111 "hosts no sessions" skip, and that the armed classes reach the runner:
// a fresh server (no token, no state: 4553, D-139) is a PASS with its sentence, no remedy line and no change to doctor's
// exit code, and a server that lost its token (a state file beside it) is a FAIL, which does move it.
describe('ccrc doctor: box-token', () => {
  it('healthy() records no role and holds no token file: one SKIP no-role line, counted as a skip, rc 0', () => {
    const r = runDoctor(healthy('ccrc-doctor-bt-norole-'));
    const lines = r.stdout.split('\n').filter((l) => / box-token: /.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^SKIP box-token: no-role — /);
    expect(r.stdout).not.toMatch(/^FAIL box-token: /m);
    expect(r.code).toBe(0);
  });

  it('a CCRC_ROLE=server box with no mail.token and no state runs the server arm: a fresh box, PASS with its sentence and no remedy line, rc 0', () => {
    const home = healthy('ccrc-doctor-bt-server-');
    writeCcrcEnv(home, ['CCRC_ROLE=server', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    const r = runDoctor(home);
    const line = anyVerdictFor(r.stdout, 'box-token');
    expect(line).toMatch(/^PASS box-token: server: token-absent — .* no value has been minted here yet, and the server mints one at boot, or its log says why that mint failed$/);
    expect(line).not.toMatch(/hosts no sessions/);
    expect(line).not.toMatch(/switched off/);
    expect(r.stdout).not.toMatch(/^(WARN|FAIL) box-token: /m);
    expect(r.stdout).not.toMatch(/remedy:[^\n]*mints a value at boot/);
    expect(r.code).toBe(0);
  });

  it('a CCRC_ROLE=server box that lost its mail.token but keeps a state file is a FAIL with a remedy line, and doctor exits 1', () => {
    const home = healthy('ccrc-doctor-bt-lost-');
    writeCcrcEnv(home, ['CCRC_ROLE=server', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    // A VALID state (the shape `doctor-box-token.test.ts`'s `healthyState` plants), so the FAIL comes from token-absent
    // alone: under an unreadable one, "state-unreadable" would also hold the line at FAIL.
    const t = Date.now(), m = 60_000, id = '0123456789abcdef';
    writeFileSync(join(home, '.ccrc', 'box-token.json'), JSON.stringify({
      v: 1, origin: 'rotated', rotationOwed: false, owedWhy: null,
      current: { id, seq: 2, since: t - 60 * m, write: { dev: 1, ino: 2, writtenAtMs: t - 60 * m } },
      pending: [], previous: null, promoting: null, recovering: null,
      fleetConfirmed: id, nextSeq: 3, lastRotationAt: t - 60 * m,
      failures: 0, lastFailure: null, hold: null, holdNode: null,
      lastSync: { at: t - 60 * m, word: 'synced', transport: 'https' },
      counters: { previousPresented: 0, retiredPresented: 0 },
      retiredRefusedAt: t - 50 * m, mintFailedAt: null, lastBootRecovery: null,
    }), { mode: 0o600 });
    const r = runDoctor(home);
    expect(anyVerdictFor(r.stdout, 'box-token')).toMatch(/^FAIL box-token: server: token-absent — /);
    expect(anyVerdictFor(r.stdout, 'box-token')).not.toContain('state-');
    expect(lineAfter(r.stdout, 'FAIL box-token: ')).toMatch(/^ {2}remedy: \S/);
    expect(r.code).toBe(1);
  });
});


// ── Delegation broker wave 3, Task 14: `delegation-hooks` ─────────────────────────────────────────────────────────
// One check, four words. It measures, on every ROSTERED home, whether the hook registration the shipped installer
// writes is there for every approved event, and whether each LIVE session's owner spool directory (made by ccd at
// spawn, never by doctor) stands; a foreign `WorktreeCreate`/`WorktreeRemove` registration is a WARN. The approved
// event set is the installer's own `EVENTS_JSON` plus its separately written `PreToolUse`, read at run time from
// `$CCRC_HERE/install-session-hooks.sh`: this block types the list nowhere (`installerEvents()` reads the same line),
// and the end-to-end case below proves the two agree by running the REAL installer into a fixture home. Doctor reads
// the registration and never prints the file: the cases that plant a secret-looking key assert it never surfaces.
describe('ccrc doctor: delegation-hooks', () => {
  /** The own-hook FAIL's remedy (W4-D5, option B): true of what the installer's sweep does now, which removes only ccrc's own hook. */
  const OWN_REMEDY_TEXT = "  remedy: run 'ccrc doctor --fix' (it removes ccrc's own hook from every event it never registers, and keeps every other command, whether in an entry of its own or in an entry it shares with ccrc's hook)";
  const THEIRS = (name: string) => ({ type: 'command', command: `bash "$HOME/bin/${name}.sh"` });
  const SHAPE_REMEDY_TEXT = '  remedy: fix what is named (check with: ls -l $HOME/<home>/settings.json) — this is a mode or shape problem, not a missing registration, and doctor never prints the file';
  /** `_check_delegation-hooks` alone, as `cmd_doctor` runs it (`runHistoryCheck`'s shape). */
  function runDh(home: string, extraEnv: NodeJS.ProcessEnv = {}): Result {
    const ccd = join(home, 'ccrc', 'ccd');
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(join(ccd, 'ccrc'))}; . ${shq(join(ccd, 'ccrc-doctor-checks'))}; _check_delegation-hooks`],
    { env: { ...doctorEnv(home), ...extraEnv }, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }
  /** Every line of the check's answer, in order: verdict lines and their remedy lines. */
  const lines = (r: Result): string[] => r.stdout.split('\n').filter((l) => l !== '');
  const verdicts = (r: Result): string[] => lines(r).filter((l) => /^(PASS|WARN|FAIL|SKIP) delegation-hooks: /.test(l));
  const remedyOf = (r: Result, verdict: RegExp): string => {
    const ls = lines(r);
    const i = ls.findIndex((l) => verdict.test(l));
    expect(i, `no line matches ${verdict}\n${r.stdout}`).toBeGreaterThanOrEqual(0);
    return ls[i + 1] ?? '';
  };
  const asRole = (home: string, role: string): void => writeCcrcEnv(home, `CCRC_ROLE=${role}\n`);
  const dhBox = (prefix: string): string => healthy(prefix);
  const twoHomes = (prefix: string): string => {
    const home = dhBox(prefix);
    writeRoster(home, [UPSTREAM, { id: 'lane-a', exec: { kind: 'generated' }, telemetry: 'anthropic' } as RosterEntry]);
    plantHookRegistration(home, '.lane-a');
    return home;
  };
  const events = installerEvents();

  it('the approved set is the installer\'s own list: twelve events here, PreToolUse among them', () => {
    // The CONTROL for every loop below: a scan over an empty list passes everything.
    expect(events.length).toBeGreaterThanOrEqual(10);
    expect(events).toContain('PreToolUse');
    expect(events).toContain('SubagentStop');
    expect(events).not.toContain('WorktreeCreate');
    expect(events).not.toContain('WorktreeRemove');
  });

  it('PASSes on the healthy box, naming what it measured, with no remedy line and rc 0', () => {
    const r = runDh(dhBox('ccrc-doctor-dh-pass-'));
    expect(lines(r)).toEqual([
      `PASS delegation-hooks: 1/1 rostered homes register all ${events.length} hook events the shipped installer writes; no running session lacks its delegation spool directory (0 registry rows read, 0 with a directory)`]);
    expect(r.code).toBe(0);
  });

  it('PASSes on two homes, a live session whose owner directory stands and a parked one with none, counting both', () => {
    const home = twoHomes('ccrc-doctor-dh-two-');
    plantSession(home, 'lane-a-demo', { live: true, recorded: true });
    plantSpoolDir(home, 'lane-a-demo');
    plantSession(home, 'lane-a-parked', { live: false, recorded: true });   // measured NOT live, no directory: owes nothing
    const r = runDh(home);
    expect(lines(r)).toEqual([
      `PASS delegation-hooks: 2/2 rostered homes register all ${events.length} hook events the shipped installer writes; no running session lacks its delegation spool directory (2 registry rows read, 1 with a directory)`]);
    expect(r.code).toBe(0);
  });

  describe('role', () => {
    it('a server-only box SKIPs with no remedy line and exit 3, even over a missing registration', () => {
      const home = dhBox('ccrc-doctor-dh-server-');
      rmSync(join(home, '.claude', 'settings.json'));
      asRole(home, 'server');
      const r = runDh(home);
      expect(lines(r)).toEqual([
        'SKIP delegation-hooks: this box records CCRC_ROLE=server, so it hosts no sessions and no hook registration or spool directory on it is ccrc\'s concern']);
      expect(r.code).toBe(3);
    });

    it.each(['fleet', 'both', 'agent'])('a CCRC_ROLE=%s box measures, so a missing registration FAILs there', (role) => {
      const home = dhBox(`ccrc-doctor-dh-role-${role}-`);
      rmSync(join(home, '.claude', 'settings.json'));
      asRole(home, role);
      const r = runDh(home);
      expect(verdicts(r)).toEqual([expect.stringMatching(/^FAIL delegation-hooks: /)]);
      expect(r.code).toBe(1);
    });
  });

  describe('registration', () => {
    it.each(events)('a home missing the %s entry FAILs naming that event and the home, with the --fix remedy', (ev) => {
      const home = dhBox('ccrc-doctor-dh-missing-');
      plantHookRegistration(home, '.claude', { omit: [ev] });
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        `FAIL delegation-hooks: the shipped hook registration is missing from 1 rostered home: claude: ${ev}`]);
      expect(remedyOf(r, /^FAIL /)).toBe(
        '  remedy: run \'ccrc doctor --fix\' (it re-runs the shipped tree\'s install-session-hooks.sh into every rostered home), or \'ccrc update\' (which re-places the tree and re-runs it)');
      expect(r.code).toBe(1);
    });

    it('a PreToolUse entry that is not the managed matcher-"*" one does not count', () => {
      const home = dhBox('ccrc-doctor-dh-pretool-');
      const f = join(home, '.claude', 'settings.json');
      const j = JSON.parse(readFileSync(f, 'utf8'));
      j.hooks.PreToolUse[0].matcher = 'Bash';
      writeFileSync(f, JSON.stringify(j));
      expect(verdicts(runDh(home))).toEqual([expect.stringMatching(/^FAIL delegation-hooks: .*claude: PreToolUse$/)]);
    });

    it('an unrelated hook is not the shipped one: an entry that names another script leaves the event missing', () => {
      const home = dhBox('ccrc-doctor-dh-unrelated-');
      const f = join(home, '.claude', 'settings.json');
      const j = JSON.parse(readFileSync(f, 'utf8'));
      j.hooks.Stop = [{ hooks: [{ type: 'command', command: 'bash "$HOME/bin/their-stop-hook.sh"' }] }];
      writeFileSync(f, JSON.stringify(j));
      expect(verdicts(runDh(home))).toEqual([expect.stringMatching(/^FAIL delegation-hooks: .*claude: Stop$/)]);
    });

    it('a home with no settings.json FAILs, and is not skipped as though it were absent', () => {
      const home = dhBox('ccrc-doctor-dh-nosettings-');
      rmSync(join(home, '.claude', 'settings.json'));
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        'FAIL delegation-hooks: the shipped hook registration is missing from 1 rostered home: claude: no settings.json']);
      expect(r.code).toBe(1);
    });

    it('measures EVERY rostered home: the second one\'s defect is reported, the first one\'s health does not hide it', () => {
      const home = twoHomes('ccrc-doctor-dh-second-');
      plantHookRegistration(home, '.lane-a', { omit: ['SubagentStart', 'SessionEnd'] });
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        'FAIL delegation-hooks: the shipped hook registration is missing from 1 rostered home: lane-a: SubagentStart, SessionEnd']);
      expect(r.stdout).not.toMatch(/claude:/);
    });

    it('lists every defective home in roster order, and the order is the same on a re-run', () => {
      const home = twoHomes('ccrc-doctor-dh-order-');
      plantHookRegistration(home, '.claude', { omit: ['Stop'] });
      plantHookRegistration(home, '.lane-a', { omit: ['PostCompact'] });
      const a = runDh(home);
      expect(verdicts(a)).toEqual([
        'FAIL delegation-hooks: the shipped hook registration is missing from 2 rostered homes: claude: Stop; lane-a: PostCompact']);
      expect(runDh(home).stdout).toBe(a.stdout);
    });

    it('a rostered home that does not exist on this box is ordinary, not a defect, and is not counted as measured', () => {
      const home = twoHomes('ccrc-doctor-dh-absent-home-');
      rmSync(join(home, '.lane-a'), { recursive: true });
      expect(lines(runDh(home))).toEqual([
        `PASS delegation-hooks: 1/1 rostered homes register all ${events.length} hook events the shipped installer writes; no running session lacks its delegation spool directory (0 registry rows read, 0 with a directory)`]);
    });

    it('SKIPs when none of the roster\'s homes exist here, saying so, with no remedy', () => {
      const home = dhBox('ccrc-doctor-dh-no-homes-');
      rmSync(join(home, '.claude'), { recursive: true });
      const r = runDh(home);
      expect(lines(r)).toEqual(['SKIP delegation-hooks: none of the roster\'s config directories exist on this box, so there is no hook registration to measure']);
      expect(r.code).toBe(3);
    });

    it('never prints the settings file: a secret-looking key and a hook command stay out of every line', () => {
      const home = dhBox('ccrc-doctor-dh-secret-');
      plantHookRegistration(home, '.claude', {
        omit: ['Stop'], foreign: ['WorktreeCreate'],
        extra: { env: { CLAUDE_CODE_OAUTH_TOKEN: 'fixture-secret-0xDEADBEEF' } },
      });
      const r = runDh(home);
      expect(r.stdout + r.stderr).not.toContain('fixture-secret-0xDEADBEEF');
      expect(r.stdout + r.stderr).not.toContain('their-worktree-hook.sh');
      expect(r.stdout + r.stderr).not.toContain('session-hook.sh"');
      expect(r.code).toBe(1);
    });
  });

  describe('unreadable is not absent', () => {
    it.skipIf(process.getuid?.() === 0)('a settings.json that cannot be read FAILs as unreadable, never as missing', () => {
      const home = dhBox('ccrc-doctor-dh-unreadable-file-');
      chmodSync(join(home, '.claude', 'settings.json'), 0o000);
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        'FAIL delegation-hooks: hook registration could not be read, so it is not known to be absent: claude: settings.json is not readable']);
      expect(remedyOf(r, /^FAIL /)).toBe(
        '  remedy: fix what is named (check with: ls -l $HOME/<home>/settings.json) — this is a mode or shape problem, not a missing registration, and doctor never prints the file');
      expect(r.stdout).not.toMatch(/is missing from/);
      expect(r.code).toBe(1);
    });

    it('a settings.json that is not JSON FAILs as unreadable, never as missing', () => {
      const home = dhBox('ccrc-doctor-dh-badjson-');
      writeFileSync(join(home, '.claude', 'settings.json'), '{"hooks": ');
      expect(verdicts(runDh(home))).toEqual([
        'FAIL delegation-hooks: hook registration could not be read, so it is not known to be absent: claude: settings.json is not valid JSON']);
    });

    it('a settings.json whose hooks key is not an object FAILs as unreadable', () => {
      const home = dhBox('ccrc-doctor-dh-badshape-');
      writeFileSync(join(home, '.claude', 'settings.json'), '{"hooks": []}');
      expect(verdicts(runDh(home))).toEqual([
        'FAIL delegation-hooks: hook registration could not be read, so it is not known to be absent: claude: settings.json does not hold hooks as an object']);
    });

    it.each([
      ['an empty file', ''],
      ['a whitespace-only file', '  \n\t\n'],
      ['two JSON documents', '{"hooks":{}}\n{"hooks":{}}'],
      ['a string document followed by an object', '"x"{}'],
    ])('%s FAILs as unreadable with the shape remedy, never as a registration nobody read', (_what, body) => {
      const home = dhBox('ccrc-doctor-dh-docs-');
      writeFileSync(join(home, '.claude', 'settings.json'), body);
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        'FAIL delegation-hooks: hook registration could not be read, so it is not known to be absent: claude: settings.json is empty or holds more than one JSON document']);
      expect(remedyOf(r, /^FAIL /)).toBe(SHAPE_REMEDY_TEXT);
      expect(r.stdout).not.toMatch(/^PASS /m);
      expect(r.code).toBe(1);
    });

    it('a settings.json that is a directory FAILs as unreadable', () => {
      const home = dhBox('ccrc-doctor-dh-dirfile-');
      rmSync(join(home, '.claude', 'settings.json'));
      mkdirSync(join(home, '.claude', 'settings.json'));
      expect(verdicts(runDh(home))).toEqual([
        'FAIL delegation-hooks: hook registration could not be read, so it is not known to be absent: claude: settings.json is not a regular file']);
    });

    it.skipIf(process.getuid?.() === 0)('a home directory that cannot be searched FAILs as unreadable, never as an absent home', () => {
      const home = twoHomes('ccrc-doctor-dh-unreadable-home-');
      chmodSync(join(home, '.lane-a'), 0o000);
      try {
        const r = runDh(home);
        expect(verdicts(r)).toEqual([
          'FAIL delegation-hooks: hook registration could not be read, so it is not known to be absent: lane-a: config directory is not a readable directory']);
        expect(r.code).toBe(1);
      } finally { chmodSync(join(home, '.lane-a'), 0o700); }
    });

    it('a home that is a dangling link FAILs as unreadable, not as an absent home', () => {
      const home = twoHomes('ccrc-doctor-dh-dangling-home-');
      rmSync(join(home, '.lane-a'), { recursive: true });
      symlinkSync(join(home, 'nowhere'), join(home, '.lane-a'));
      expect(verdicts(runDh(home))).toEqual([
        'FAIL delegation-hooks: hook registration could not be read, so it is not known to be absent: lane-a: config directory is not a readable directory']);
    });

    it('an absent roster SKIPs (wrappers owns it); an unparsable one FAILs', () => {
      const home = dhBox('ccrc-doctor-dh-roster-');
      rmSync(join(home, '.ccrc', 'accounts.json'));
      expect(lines(runDh(home))).toEqual(['SKIP delegation-hooks: no account roster at $HOME/.ccrc/accounts.json — the \'wrappers\' check owns that']);
      writeRawRoster(home, '{"version":1,');
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        'FAIL delegation-hooks: $HOME/.ccrc/accounts.json could not be read as a roster, so no rostered home can be named and none was measured']);
      expect(remedyOf(r, /^FAIL /)).toMatch(/^ {2}remedy: restore it from a backup/);
      expect(r.code).toBe(1);
    });

    it.skipIf(process.getuid?.() === 0)('a roster that cannot be read FAILs', () => {
      const home = dhBox('ccrc-doctor-dh-roster-mode-');
      chmodSync(join(home, '.ccrc', 'accounts.json'), 0o000);
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        'FAIL delegation-hooks: $HOME/.ccrc/accounts.json exists but is not a readable regular file, so no rostered home can be named and none was measured']);
      expect(remedyOf(r, /^FAIL /)).toBe('  remedy: fix its mode/ownership — check with: ls -l $HOME/.ccrc/accounts.json');
      expect(r.code).toBe(1);
    });

    it('a box without node cannot read the roster: FAIL naming node, with its remedy, never a pass', () => {
      const home = dhBox('ccrc-doctor-dh-nonode-');
      unstub(home, 'node');
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        'FAIL delegation-hooks: node is not on PATH, so $HOME/.ccrc/accounts.json cannot be read and no rostered home was measured']);
      expect(remedyOf(r, /^FAIL /)).toBe("  remedy: install Node first — see the 'node' check above");
      expect(r.code).toBe(1);
    });

    it('a roster with no usable account SKIPs rather than passing over nothing', () => {
      const home = dhBox('ccrc-doctor-dh-roster-empty-');
      writeRawRoster(home, '{"version":1,"accounts":[]}');
      expect(lines(runDh(home))).toEqual(['SKIP delegation-hooks: no usable account in $HOME/.ccrc/accounts.json — the \'wrappers\' check owns that']);
    });

    it('a box without jq cannot read a registration: FAIL, naming the tool, never a pass', () => {
      const home = dhBox('ccrc-doctor-dh-nojq-');
      unstub(home, 'jq');
      const r = runDh(home);
      expect(verdicts(r)).toEqual([expect.stringMatching(/^FAIL delegation-hooks: jq is not on PATH, so no settings\.json could be read/)]);
      expect(remedyOf(r, /^FAIL /)).toMatch(/^ {2}remedy: install jq/);
      expect(r.code).toBe(1);
    });
  });

  describe('the owner spool directory', () => {
    const REMEDY_WAIT = (id: string, what = 'session'): string =>
      `  remedy: nothing is lost by waiting: ccd makes the directory at the next spawn. To observe the ${what} now, stop and start ${what === 'session' ? 'it' : 'each'} through ccd (${what === 'session' ? '' : 'for example '}'ccd stop ${id}', then 'ccd start ${id}') — this resumes its conversation but ends an in-flight turn`;

    it('a RUNNING session with no owner directory is a WARN (D-4651, R53), not a FAIL: it is observed at its next spawn, and the remedy says what makes it so now', () => {
      const home = dhBox('ccrc-doctor-dh-spool-missing-');
      plantSession(home, 'lane-a-demo', { live: true, recorded: true });
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        'WARN delegation-hooks: 1 running session has no delegation spool directory yet, so it is not observed until its next spawn (a swap or a respawn): lane-a-demo']);
      expect(remedyOf(r, /^WARN /)).toBe(REMEDY_WAIT('lane-a-demo'));
      // …and it names no raw unit restart and does not claim that the update sweep makes the directory.
      expect(r.stdout).not.toMatch(/systemctl --user restart|supervisor sweep/);
      expect(r.code).toBe(2);
    });

    // R98 (review 518's F5): `systemctl is-active` prints one word per unit, and four of them mean the unit is RUNNING in
    // the sense that matters here, a supervisor that is coming up, going down or being reloaded and so about to spawn or
    // respawn a session that records nothing: `activating`, `reloading`, `refreshing`, `deactivating`. They reach the same
    // WARN (no directory yet) and FAIL (an unusable one) as `active` does; `inactive` and `failed` owe nothing. launchd answers
    // active, inactive or failed only, so these rows are systemd's own.
    const RUNNING_WORDS = ['active', 'activating', 'reloading', 'refreshing', 'deactivating'] as const;
    /** A registry row whose unit the manager answers `word` for. */
    const plantAs = (home: string, id: string, word: string): void => {
      plantSession(home, id, { live: false, recorded: true });
      writeFileSync(join(home, `fixture-unit-claude-session@${id}.service`), `${word}\n`);
    };

    itLinux.each(RUNNING_WORDS)('a session whose unit is %s, with no owner directory, is the same WARN (R98)', (word) => {
      const home = dhBox(`ccrc-doctor-dh-spool-word-${word}-`);
      plantAs(home, 'lane-a-demo', word);
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        'WARN delegation-hooks: 1 running session has no delegation spool directory yet, so it is not observed until its next spawn (a swap or a respawn): lane-a-demo']);
      expect(remedyOf(r, /^WARN /)).toBe(REMEDY_WAIT('lane-a-demo'));
      expect(r.code).toBe(2);
    });

    itLinux.each(RUNNING_WORDS)('a session whose unit is %s, with an owner directory that is a symlink, is the same FAIL (R98)', (word) => {
      const home = dhBox(`ccrc-doctor-dh-spool-word-link-${word}-`);
      plantAs(home, 'lane-a-demo', word);
      const real = join(home, 'elsewhere');
      mkdirSync(real);
      mkdirSync(join(home, '.cc-sessions', 'delegation', 'spool'), { recursive: true });
      symlinkSync(real, join(home, '.cc-sessions', 'delegation', 'spool', 'lane-a-demo'));
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        'FAIL delegation-hooks: the delegation spool could not be used, so it is not known to be absent: lane-a-demo: owner directory is a symlink']);
      expect(r.code).toBe(1);
    });

    itLinux.each(['inactive', 'failed'] as const)('a session whose unit is %s owes nothing: no directory is no finding (R98: the words are a closed set, not a wildcard)', (word) => {
      const home = dhBox(`ccrc-doctor-dh-spool-word-idle-${word}-`);
      plantAs(home, 'lane-a-demo', word);
      const r = runDh(home);
      expect(verdicts(r)).toEqual([expect.stringMatching(/^PASS delegation-hooks: .*\(1 registry rows read, 0 with a directory\)$/)]);
      expect(r.code).toBe(0);
    });

    it('a FAIL is never hidden behind that WARN, and the WARN never hides the FAIL: an unreadable directory beside a missing one', () => {
      const home = dhBox('ccrc-doctor-dh-spool-both-');
      plantSession(home, 'lane-a-none', { live: true, recorded: true });
      plantSession(home, 'lane-a-link', { live: true, recorded: true });
      mkdirSync(join(home, '.cc-sessions', 'delegation', 'spool'), { recursive: true });
      symlinkSync(join(home, 'elsewhere'), join(home, '.cc-sessions', 'delegation', 'spool', 'lane-a-link'));
      const r = runDh(home);
      expect(verdicts(r).map((l) => l.split(':')[0])).toEqual(['FAIL delegation-hooks', 'WARN delegation-hooks']);
      expect(r.code).toBe(1);
    });

    // Linux only: launchd has no batched is-active, so the darwin arm asks `launchctl print` once per unit.
    it.skipIf(process.platform === 'darwin')('asks the service manager ONCE for all its pending units, in one is-active call', () => {
      const home = dhBox('ccrc-doctor-dh-spool-batch-');
      for (let i = 1; i <= 4; i++) plantSession(home, `lane-a-s${i}`, { live: true, recorded: true });
      plantSpoolDir(home, 'lane-a-s2');   // standing: not pending, so not asked about
      stub(home, 'systemctl', 'echo "$*" >> "$HOME/systemctl-calls"; shift 2; for u in "$@"; do echo active; done');
      const r = runDh(home);
      const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8').split('\n').filter(Boolean);
      expect(calls).toEqual(['--user is-active claude-session@lane-a-s1.service claude-session@lane-a-s3.service claude-session@lane-a-s4.service']);
      expect(verdicts(r)).toEqual([expect.stringMatching(/^WARN delegation-hooks: 3 running sessions have no delegation spool directory yet.*: lane-a-s1 lane-a-s3 lane-a-s4$/)]);
    });

    // Linux only: the word count is the batched is-active reply, which launchd never gives (one `launchctl print` per unit).
    it.skipIf(process.platform === 'darwin')('a short answer from the manager (fewer words than units) is never read as "not running"', () => {
      const home = dhBox('ccrc-doctor-dh-spool-short-');
      plantSession(home, 'lane-a-s1', { live: false, recorded: true });
      plantSession(home, 'lane-a-s2', { live: false, recorded: true });
      stub(home, 'systemctl', 'echo inactive');
      expect(verdicts(runDh(home))).toEqual([expect.stringMatching(/^WARN delegation-hooks: the service manager gave no answer for 2 sessions, /)]);
    });

    it('a spool root that is a symlink is a FAIL even when no session is running (ccd refuses it at the next spawn)', () => {
      const home = dhBox('ccrc-doctor-dh-spool-root-link-');
      mkdirSync(join(home, '.cc-sessions', 'delegation'), { recursive: true });
      mkdirSync(join(home, 'elsewhere'));
      symlinkSync(join(home, 'elsewhere'), join(home, '.cc-sessions', 'delegation', 'spool'));
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        'FAIL delegation-hooks: the delegation spool could not be used, so it is not known to be absent: $HOME/.cc-sessions/delegation/spool is a symlink']);
      expect(remedyOf(r, /^FAIL /)).toMatch(/^ {2}remedy: fix what is named \(check with: ls -ld \$HOME\/\.cc-sessions\/delegation\/spool\)/);
      expect(r.code).toBe(1);
    });

    it.skipIf(process.getuid?.() === 0)('a spool root that cannot be searched is a FAIL even when no session is running', () => {
      const home = dhBox('ccrc-doctor-dh-spool-root-mode-');
      const root = join(home, '.cc-sessions', 'delegation', 'spool');
      mkdirSync(root, { recursive: true });
      chmodSync(root, 0o000);
      try {
        expect(verdicts(runDh(home))).toEqual([
          'FAIL delegation-hooks: the delegation spool could not be used, so it is not known to be absent: $HOME/.cc-sessions/delegation/spool is not a readable, searchable directory']);
      } finally { chmodSync(root, 0o700); }
    });

    it('a standing directory is never a question for the manager: the service manager is not asked about it', () => {
      const home = dhBox('ccrc-doctor-dh-spool-lazy-');
      plantSession(home, 'lane-a-demo', { live: true, recorded: true });
      plantSpoolDir(home, 'lane-a-demo');
      stub(home, 'systemctl', 'echo "$*" >> "$HOME/systemctl-calls"; exit 1');
      expect(verdicts(runDh(home))).toEqual([expect.stringMatching(/^PASS delegation-hooks: .*\(1 registry rows read, 1 with a directory\)$/)]);
      expect(existsSync(join(home, 'systemctl-calls'))).toBe(false);
    });

    it('doctor mutates nothing: with a missing directory, a missing registration and a foreign hook, the registry and the homes are byte-identical after', () => {
      const home = twoHomes('ccrc-doctor-dh-spool-readonly-');
      plantSession(home, 'lane-a-demo', { live: true, recorded: true });
      plantHookRegistration(home, '.claude', { omit: ['Stop'], foreign: ['WorktreeCreate'] });
      const before = treeState(join(home, '.cc-sessions'), join(home, '.claude'), join(home, '.lane-a'));
      expect(Object.keys(before).length).toBeGreaterThan(2);
      expect(verdicts(runDh(home)).length).toBeGreaterThanOrEqual(3);
      expect(treeState(join(home, '.cc-sessions'), join(home, '.claude'), join(home, '.lane-a'))).toEqual(before);
      expect(existsSync(join(home, '.cc-sessions', 'delegation'))).toBe(false);
    });

    it('names at most five owners and counts the rest', () => {
      const home = dhBox('ccrc-doctor-dh-spool-many-');
      for (let i = 1; i <= 7; i++) plantSession(home, `lane-a-s${i}`, { live: true, recorded: true });
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        'WARN delegation-hooks: 7 running sessions have no delegation spool directory yet, so they are not observed until their next spawn (a swap or a respawn): lane-a-s1 lane-a-s2 lane-a-s3 lane-a-s4 lane-a-s5 (+2 more)']);
      expect(remedyOf(r, /^WARN /)).toBe(REMEDY_WAIT('lane-a-s1', 'sessions'));
    });

    it('an owner directory that is a symlink FAILs as unusable (ccd and the hook both refuse a link)', () => {
      const home = dhBox('ccrc-doctor-dh-spool-link-');
      plantSession(home, 'lane-a-demo', { live: true, recorded: true });
      const real = join(home, 'elsewhere');
      mkdirSync(real);
      mkdirSync(join(home, '.cc-sessions', 'delegation', 'spool'), { recursive: true });
      symlinkSync(real, join(home, '.cc-sessions', 'delegation', 'spool', 'lane-a-demo'));
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        'FAIL delegation-hooks: the delegation spool could not be used, so it is not known to be absent: lane-a-demo: owner directory is a symlink']);
      expect(remedyOf(r, /^FAIL /)).toBe(
        '  remedy: fix what is named (check with: ls -ld $HOME/.cc-sessions/delegation/spool) — a link is refused by ccd and by the hook, so look before moving it; doctor never creates or removes the directory');
      expect(r.code).toBe(1);
    });

    it.skipIf(process.getuid?.() === 0)('an owner directory that cannot be read FAILs as unusable, never as missing', () => {
      const home = dhBox('ccrc-doctor-dh-spool-mode-');
      plantSession(home, 'lane-a-demo', { live: true, recorded: true });
      const d = plantSpoolDir(home, 'lane-a-demo');
      chmodSync(d, 0o000);
      try {
        const r = runDh(home);
        expect(verdicts(r)).toEqual([
          'FAIL delegation-hooks: the delegation spool could not be used, so it is not known to be absent: lane-a-demo: owner directory is not a readable, searchable directory']);
        expect(r.stdout).not.toMatch(/has no delegation spool directory/);
      } finally { chmodSync(d, 0o700); }
    });

    it.skipIf(process.getuid?.() === 0)('a spool root that cannot be searched FAILs once, and does not read every owner as missing', () => {
      const home = dhBox('ccrc-doctor-dh-spool-root-');
      plantSession(home, 'lane-a-one', { live: true, recorded: true });
      plantSession(home, 'lane-a-two', { live: true, recorded: true });
      plantSpoolDir(home, 'lane-a-one');
      const root = join(home, '.cc-sessions', 'delegation', 'spool');
      chmodSync(root, 0o000);
      try {
        const r = runDh(home);
        expect(verdicts(r)).toEqual([
          'FAIL delegation-hooks: the delegation spool could not be used, so it is not known to be absent: $HOME/.cc-sessions/delegation/spool is not a readable, searchable directory']);
        expect(r.stdout).not.toMatch(/has no delegation spool directory/);
      } finally { chmodSync(root, 0o700); }
    });

    it.skipIf(process.getuid?.() === 0)('a registry that cannot be listed FAILs as unusable', () => {
      const home = dhBox('ccrc-doctor-dh-registry-');
      plantSession(home, 'lane-a-demo', { live: true, recorded: true });
      chmodSync(join(home, '.cc-sessions'), 0o000);
      try {
        expect(verdicts(runDh(home))).toEqual([
          'FAIL delegation-hooks: the delegation spool could not be used, so it is not known to be absent: $HOME/.cc-sessions is not a readable, searchable directory']);
      } finally { chmodSync(join(home, '.cc-sessions'), 0o700); }
    });

    it('a session the manager could not be asked about is a WARN, never a pass and never a missing directory', () => {
      const home = dhBox('ccrc-doctor-dh-unasked-');
      plantSession(home, 'lane-a-demo', { live: false, recorded: true });
      // The question goes unanswered per platform: systemctl printing no word, or launchctl failing for a reason other than 113 (an EMPTY fixture file).
      if (process.platform === 'darwin') writeFileSync(join(home, 'fixture-unit-claude-session@lane-a-demo.service'), '');
      else stub(home, 'systemctl', 'exit 0');   // prints no word: the question was not answered
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        'WARN delegation-hooks: the service manager gave no answer for 1 session, so whether it owes a delegation spool directory was not measured: lane-a-demo']);
      expect(remedyOf(r, /^WARN /)).toMatch(process.platform === 'darwin'
        ? /^ {2}remedy: ask the manager by hand \(launchctl print gui\/\d+\/app\.ccrc\.session\.lane-a-demo\)/
        : /^ {2}remedy: ask the manager by hand \(systemctl --user status claude-session@lane-a-demo\.service\)/);
      expect(r.code).toBe(2);
    });
  });

  describe('foreign Worktree hooks', () => {
    it.each(['WorktreeCreate', 'WorktreeRemove'])('a registered %s is a WARN naming the home, with a manual-inspection remedy, and the file is left alone', (ev) => {
      const home = dhBox('ccrc-doctor-dh-foreign-');
      plantHookRegistration(home, '.claude', { foreign: [ev] });
      const f = join(home, '.claude', 'settings.json');
      const before = readFileSync(f, 'utf8');
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        `WARN delegation-hooks: ${ev} is registered, and ccrc never registers it — a registered hook for either event replaces Claude Code's own worktree handling: claude: ${ev}`]);
      expect(remedyOf(r, /^WARN /)).toBe(
        '  remedy: inspect the entry by hand in that home\'s settings.json and remove it if it is not intended — doctor does not edit or delete it');
      expect(r.code).toBe(2);
      expect(readFileSync(f, 'utf8')).toBe(before);
    });

    it('both events, in two homes, are one WARN line in roster order', () => {
      const home = twoHomes('ccrc-doctor-dh-foreign-both-');
      plantHookRegistration(home, '.claude', { foreign: ['WorktreeRemove', 'WorktreeCreate'] });
      plantHookRegistration(home, '.lane-a', { foreign: ['WorktreeCreate'] });
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        'WARN delegation-hooks: WorktreeCreate, WorktreeRemove are registered, and ccrc never registers them — a registered hook for either event replaces Claude Code\'s own worktree handling: claude: WorktreeCreate WorktreeRemove; lane-a: WorktreeCreate']);
      expect(remedyOf(r, /^WARN /)).toBe(
        '  remedy: inspect the entries by hand in those homes\' settings.json and remove them if they are not intended — doctor does not edit or delete them');
      expect(r.code).toBe(2);
    });

    it.each(['WorktreeCreate', 'WorktreeRemove'])('ccrc\'s OWN hook registered under %s is a FAIL naming --fix (not a foreign WARN), because the installer\'s sweep removes it', (ev) => {
      const home = dhBox('ccrc-doctor-dh-own-worktree-');
      plantHookRegistration(home, '.claude', { ownWorktree: [ev] });
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        `FAIL delegation-hooks: ccrc's own session hook is registered under an event it never registers — a registered hook for WorktreeCreate or WorktreeRemove replaces Claude Code's own worktree handling: claude: ${ev}`]);
      expect(remedyOf(r, /^FAIL /)).toBe(OWN_REMEDY_TEXT);
      expect(r.code).toBe(1);
    });

    it.each(['WorktreeCreate', 'WorktreeRemove'])('ONE %s entry holding ccrc\'s hook AND another command is both: the FAIL for the first, then the WARN for the second (R55: per hook, not per entry)', (ev) => {
      const home = dhBox('ccrc-doctor-dh-own-and-foreign-');
      const f = join(home, '.claude', 'settings.json');
      const j = JSON.parse(readFileSync(f, 'utf8'));
      j.hooks[ev] = [{ hooks: [{ type: 'command', command: installerHook().command }, THEIRS('their-worktree-hook')] }];
      writeFileSync(f, JSON.stringify(j));
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        `FAIL delegation-hooks: ccrc's own session hook is registered under an event it never registers — a registered hook for WorktreeCreate or WorktreeRemove replaces Claude Code's own worktree handling: claude: ${ev}`,
        `WARN delegation-hooks: ${ev} is registered, and ccrc never registers it — a registered hook for either event replaces Claude Code's own worktree handling: claude: ${ev}`]);
      expect(remedyOf(r, /^FAIL /)).toBe(OWN_REMEDY_TEXT);
      expect(r.code).toBe(1);
    });

    it('SEPARATE entries (ccrc\'s, and another command\'s) are still both, as before', () => {
      const home = dhBox('ccrc-doctor-dh-own-and-foreign-sep-');
      plantHookRegistration(home, '.claude', { ownWorktree: ['WorktreeCreate'] });
      const f = join(home, '.claude', 'settings.json');
      const j = JSON.parse(readFileSync(f, 'utf8'));
      j.hooks.WorktreeCreate.push({ hooks: [THEIRS('their-worktree-hook')] });
      writeFileSync(f, JSON.stringify(j));
      const r = runDh(home);
      expect(verdicts(r).map((l) => l.split(':')[0])).toEqual(['FAIL delegation-hooks', 'WARN delegation-hooks']);
      expect(r.code).toBe(1);
    });

    it('an empty Worktree array is not a registration', () => {
      const home = dhBox('ccrc-doctor-dh-foreign-empty-');
      const f = join(home, '.claude', 'settings.json');
      const j = JSON.parse(readFileSync(f, 'utf8'));
      j.hooks.WorktreeCreate = [];
      writeFileSync(f, JSON.stringify(j));
      expect(verdicts(runDh(home))).toEqual([expect.stringMatching(/^PASS delegation-hooks: /)]);
    });
  });

  // Delegation broker wave 4, PR4 Task 4.5b: the delegation broker's rung-4 margin (twenty minutes) assumes Claude Code's
  // ten-minute Bash ceiling, so a home that raises the ceiling in its settings.json `env` is a WARN. The line names the home and
  // the KEY, never the value (an `env` block can hold a token). Fixture assertions on the text and the class; no timing.
  describe('the Bash ceiling (W4-D1..D4)', () => {
    const CEILING_REMEDY = "  remedy: remove the key from that home's env: the delegation broker's rung-4 margin (twenty minutes) assumes Claude Code's ten-minute Bash ceiling, so a changed ceiling breaks that assumption and can let rung 4 link a tree to the wrong session; changing the margin is a code change";
    const ceilingLine = (n: number, homes: string): string =>
      `WARN delegation-hooks: ${n} rostered ${n === 1 ? 'home sets' : 'homes set'} Claude Code's Bash timeout in settings.json env: ${homes}`;
    const withEnv = (prefix: string, env: unknown): string => {
      const home = dhBox(prefix);
      plantHookRegistration(home, '.claude', { extra: { env } });
      return home;
    };

    it('W4-D1: env.BASH_MAX_TIMEOUT_MS is a WARN naming the home and the key, with the remedy, rc 2 and no PASS line', () => {
      const r = runDh(withEnv('ccrc-doctor-dh-ceiling-max-', { BASH_MAX_TIMEOUT_MS: '1800000' }));
      expect(verdicts(r)).toEqual([ceilingLine(1, 'claude: BASH_MAX_TIMEOUT_MS')]);
      expect(remedyOf(r, /^WARN /)).toBe(CEILING_REMEDY);
      expect(lines(r).filter((l) => l.startsWith('PASS '))).toEqual([]);
      expect(r.code).toBe(2);
    });

    it('W4-D2: env.BASH_DEFAULT_TIMEOUT_MS is the same WARN, and both keys in one home are ONE line naming both', () => {
      const one = runDh(withEnv('ccrc-doctor-dh-ceiling-default-', { BASH_DEFAULT_TIMEOUT_MS: '900000' }));
      expect(verdicts(one)).toEqual([ceilingLine(1, 'claude: BASH_DEFAULT_TIMEOUT_MS')]);
      expect(one.code).toBe(2);
      const both = runDh(withEnv('ccrc-doctor-dh-ceiling-both-', { BASH_DEFAULT_TIMEOUT_MS: '900000', BASH_MAX_TIMEOUT_MS: '1800000' }));
      expect(verdicts(both)).toEqual([ceilingLine(1, 'claude: BASH_MAX_TIMEOUT_MS, BASH_DEFAULT_TIMEOUT_MS')]);
      expect(both.code).toBe(2);
    });

    it('W4-D2: two homes are one WARN in roster order, with the plural wording', () => {
      const home = twoHomes('ccrc-doctor-dh-ceiling-two-');
      plantHookRegistration(home, '.claude', { extra: { env: { BASH_MAX_TIMEOUT_MS: '1800000' } } });
      plantHookRegistration(home, '.lane-a', { extra: { env: { BASH_DEFAULT_TIMEOUT_MS: '900000' } } });
      const r = runDh(home);
      expect(verdicts(r)).toEqual([ceilingLine(2, 'claude: BASH_MAX_TIMEOUT_MS; lane-a: BASH_DEFAULT_TIMEOUT_MS')]);
      expect(r.code).toBe(2);
    });

    it('W4-D3: a value, numeric or token-shaped, is printed on no line, while the key it belongs to is', () => {
      const NUM = '1800000';
      const TOKEN = 'sk-ant-fixture-0xDEADBEEF';
      const r = runDh(withEnv('ccrc-doctor-dh-ceiling-secret-', { BASH_MAX_TIMEOUT_MS: NUM, BASH_DEFAULT_TIMEOUT_MS: TOKEN }));
      // the WARN is there (an empty answer would pass the absence checks below vacuously)
      expect(r.stdout).toMatch(/^WARN delegation-hooks: .*BASH_MAX_TIMEOUT_MS, BASH_DEFAULT_TIMEOUT_MS$/m);
      expect(r.stdout + r.stderr).not.toContain(NUM);
      expect(r.stdout + r.stderr).not.toContain(TOKEN);
      expect(r.stdout + r.stderr).not.toContain('0xDEADBEEF');
    });

    it.each<[string, unknown]>([
      ['an env that is a string', 'BASH_MAX_TIMEOUT_MS=1800000'],
      ['an env that is an array', ['BASH_MAX_TIMEOUT_MS']],
      ['an env that is null', null],
      ['a key set to ""', { BASH_MAX_TIMEOUT_MS: '' }],
      ['a key set to null', { BASH_DEFAULT_TIMEOUT_MS: null }],
      ['an env with neither key', { CLAUDE_CODE_MAX_OUTPUT_TOKENS: '64000' }],
    ])('W4-D4: %s gives no ceiling WARN, and the PASS line is unchanged', (_name, env) => {
      const r = runDh(withEnv('ccrc-doctor-dh-ceiling-none-', env));
      expect(lines(r)).toEqual([
        `PASS delegation-hooks: 1/1 rostered homes register all ${events.length} hook events the shipped installer writes; no running session lacks its delegation spool directory (0 registry rows read, 0 with a directory)`]);
      expect(r.code).toBe(0);
    });

    it('the ceiling WARN never hides a FAIL: a missing registration is FAIL first, then the WARN, rc 1', () => {
      const home = dhBox('ccrc-doctor-dh-ceiling-fail-');
      plantHookRegistration(home, '.claude', { omit: ['Stop'], extra: { env: { BASH_MAX_TIMEOUT_MS: '1800000' } } });
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        'FAIL delegation-hooks: the shipped hook registration is missing from 1 rostered home: claude: Stop',
        ceilingLine(1, 'claude: BASH_MAX_TIMEOUT_MS')]);
      expect(r.code).toBe(1);
    });
  });

  describe('several defects at once', () => {
    it('a FAIL is never hidden behind a WARN: FAIL lines first, then WARN lines, each followed by its own remedy, rc 1', () => {
      const home = twoHomes('ccrc-doctor-dh-mixed-');
      plantHookRegistration(home, '.claude', { omit: ['Stop'], foreign: ['WorktreeCreate'] });
      writeFileSync(join(home, '.lane-a', 'settings.json'), 'not json');
      plantSession(home, 'lane-a-demo', { live: true, recorded: true });
      const r = runDh(home);
      const ls = lines(r);
      expect(ls.map((l) => (/^ {2}remedy: /.test(l) ? 'remedy' : l.split(': ')[0]))).toEqual([
        'FAIL delegation-hooks', 'remedy',     // unreadable registration
        'FAIL delegation-hooks', 'remedy',     // missing registration
        'WARN delegation-hooks', 'remedy',     // foreign Worktree hook
        'WARN delegation-hooks', 'remedy',     // running session with no spool directory yet
      ]);
      expect(ls[0]).toMatch(/could not be read.*lane-a: settings\.json is not valid JSON/);
      expect(ls[2]).toMatch(/missing from 1 rostered home: claude: Stop/);
      expect(ls[4]).toMatch(/WorktreeCreate is registered/);
      expect(ls[6]).toMatch(/lane-a-demo$/);
      expect(r.code).toBe(1);
      expect(runDh(home).stdout).toBe(r.stdout);
    });

    it('a WARN alone returns 2 and a WARN with a FAIL returns the worse, 1', () => {
      const home = dhBox('ccrc-doctor-dh-rc-');
      plantHookRegistration(home, '.claude', { foreign: ['WorktreeCreate'] });
      expect(runDh(home).code).toBe(2);
      plantHookRegistration(home, '.claude', { foreign: ['WorktreeCreate'], omit: ['Stop'] });
      expect(runDh(home).code).toBe(1);
    });
  });

  describe('the approved event set is the installer\'s own', () => {
    it('reads EVENTS_JSON from the installer beside the doctor file: an event the installer adds is demanded', () => {
      const home = dhBox('ccrc-doctor-dh-extra-event-');
      const dst = join(home, 'ccrc', 'ccd', 'install-session-hooks.sh');
      rmSync(dst);
      writeFileSync(dst, readFileSync(DH_INSTALLER, 'utf8').replace(/^EVENTS_JSON='\[/m, 'EVENTS_JSON=\'["FixtureEvent",'));
      const r = runDh(home);
      expect(verdicts(r)).toEqual([
        'FAIL delegation-hooks: the shipped hook registration is missing from 1 rostered home: claude: FixtureEvent']);
    });

    it('an installer that is gone is a FAIL naming it, not a pass over an event set nobody knew', () => {
      const home = dhBox('ccrc-doctor-dh-no-installer-');
      rmSync(join(home, 'ccrc', 'ccd', 'install-session-hooks.sh'));
      const r = runDh(home);
      expect(verdicts(r)).toEqual([expect.stringMatching(/^FAIL delegation-hooks: the shipped tree has no install-session-hooks\.sh, so the approved event set could not be read: /)]);
      expect(remedyOf(r, /^FAIL /)).toMatch(/^ {2}remedy: run 'ccrc update'/);
      expect(r.code).toBe(1);
    });

    it('an installer whose EVENTS_JSON cannot be read is a FAIL', () => {
      const home = dhBox('ccrc-doctor-dh-bad-installer-');
      const dst = join(home, 'ccrc', 'ccd', 'install-session-hooks.sh');
      rmSync(dst);
      writeFileSync(dst, '#!/usr/bin/env bash\nEVENTS_JSON=$(compute)\n');
      const r = runDh(home);
      expect(verdicts(r)).toEqual([expect.stringMatching(/^FAIL delegation-hooks: .*holds no EVENTS_JSON list in the shape this check reads/)]);
      expect(remedyOf(r, /^FAIL /)).toBe("  remedy: run 'ccrc update' to place a shipped tree whose installer and doctor agree");
      expect(r.code).toBe(1);
    });

    it('PreToolUse is still written by the installer on its own line, with matcher "*" (the one name this check types)', () => {
      expect(readFileSync(DH_INSTALLER, 'utf8')).toMatch(/\.PreToolUse = \(\(\.PreToolUse \/\/ \[\]\) \+ \[\{matcher:"\*"/);
    });

    it('the REAL installer\'s output PASSes: a fresh home converged by the shipped script, then a home holding a stale-path managed entry swept clean', () => {
      const home = dhBox('ccrc-doctor-dh-real-installer-');
      rmSync(join(home, '.claude', 'settings.json'));
      const run = (): void => {
        const i = spawnSync(BASH, [DH_INSTALLER, '--homes', join(home, '.claude')],
          { env: { ...process.env, HOME: home }, encoding: 'utf8' });
        expect(i.status, `${i.stdout}${i.stderr}`).toBe(0);
      };
      run();
      expect(verdicts(runDh(home))).toEqual([expect.stringMatching(/^PASS delegation-hooks: 1\/1 rostered homes register all \d+ hook events/)]);
      // …and the events the installer wrote are exactly the ones the check demands.
      const f = join(home, '.claude', 'settings.json');
      const written = JSON.parse(readFileSync(f, 'utf8')) as { hooks: Record<string, unknown> };
      expect(Object.keys(written.hooks).sort()).toEqual([...installerEvents()].sort());
      // The sweep: a managed entry at an OLD path (the installer matches on the file name) plus a foreign entry that is not ccrc's.
      const stale = { hooks: [{ type: 'command', command: 'bash "$HOME/.old-location/session-hook.sh"' }] };
      const theirs = { hooks: [{ type: 'command', command: 'bash "$HOME/bin/their-stop-hook.sh"' }] };
      const j = JSON.parse(readFileSync(f, 'utf8')) as { hooks: Record<string, unknown[]> };
      j.hooks['Stop'] = [stale, theirs, ...j.hooks['Stop']!];
      writeFileSync(f, JSON.stringify(j));
      run();
      const after = JSON.parse(readFileSync(f, 'utf8')) as { hooks: Record<string, unknown[]> };
      expect(JSON.stringify(after)).not.toContain('.old-location');
      expect(after.hooks['Stop']).toContainEqual(theirs);
      expect(verdicts(runDh(home))).toEqual([expect.stringMatching(/^PASS delegation-hooks: /)]);
    });
  });

  describe('--fix', () => {
    /** A one-entry table over the SHIPPED check file, so the run's only fixer is this check's (the other checks'
     *  cures, wrappers' above all, are not this block's business and would write into the fixture home). */
    const onlyThisCheck = (home: string): void =>
      writeChecks(home, `. ${shq(CHECKS_SRC)}
CCRC_DOCTOR_CHECKS=(delegation-hooks)
`);
    it('re-runs the shipped installer into the rostered homes, and the re-measurement is the verdict', () => {
      const home = twoHomes('ccrc-doctor-dh-fix-');
      for (const t of ['cp', 'mv', 'mkdir', 'cat', 'date', 'rm', 'basename', 'cmp']) linkReal(home, t);
      rmSync(join(home, '.lane-a', 'settings.json'));
      plantHookRegistration(home, '.claude', { omit: ['Stop'] });
      onlyThisCheck(home);
      const r = runDoctor(home, ['doctor', '--fix']);
      expect(r.stdout).toMatch(/^FAIL delegation-hooks: the shipped hook registration is missing from 2 rostered homes: claude: Stop; lane-a: no settings\.json\n {2}remedy: run 'ccrc doctor --fix'/m);
      expect(r.stdout).toMatch(/^FIX delegation-hooks: re-ran the shipped tree's install-session-hooks\.sh into 2 home\(s\): claude, lane-a$/m);
      expect(r.stdout).toMatch(/^PASS delegation-hooks: 2\/2 rostered homes register all \d+ hook events/m);
    });

    it('does not touch a foreign Worktree entry, and leaves the WARN standing', () => {
      const home = dhBox('ccrc-doctor-dh-fix-foreign-');
      for (const t of ['cp', 'mv', 'mkdir', 'cat', 'date', 'rm', 'basename', 'cmp']) linkReal(home, t);
      plantHookRegistration(home, '.claude', { omit: ['Stop'], foreign: ['WorktreeRemove'] });
      onlyThisCheck(home);
      const foreignBefore = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).hooks.WorktreeRemove;
      const r = runDoctor(home, ['doctor', '--fix']);
      expect(r.stdout).toMatch(/^WARN delegation-hooks: WorktreeRemove is registered/m);
      // never removes OR REWRITES (coordinator 5151): the entry is deep-equal to what was planted, not merely still there.
      expect(JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).hooks.WorktreeRemove).toEqual(foreignBefore);
    });

    it('sweeps ccrc\'s own hook out of a Worktree event and leaves the other command there byte-identical', () => {
      const home = dhBox('ccrc-doctor-dh-fix-own-worktree-');
      for (const t of ['cp', 'mv', 'mkdir', 'cat', 'date', 'rm', 'basename', 'cmp']) linkReal(home, t);
      plantHookRegistration(home, '.claude', { ownWorktree: ['WorktreeCreate'], foreign: ['WorktreeRemove'] });
      const f = join(home, '.claude', 'settings.json');
      const j = JSON.parse(readFileSync(f, 'utf8'));
      const theirs = { hooks: [{ type: 'command', command: 'bash "$HOME/bin/their-worktree-hook.sh"' }] };
      j.hooks.WorktreeCreate.push(theirs);
      writeFileSync(f, JSON.stringify(j));
      const foreignBefore = j.hooks.WorktreeRemove;
      onlyThisCheck(home);
      const r = runDoctor(home, ['doctor', '--fix']);
      expect(r.stdout).toMatch(/^FAIL delegation-hooks: ccrc's own session hook is registered under an event it never registers/m);
      expect(r.stdout).toMatch(/^FIX delegation-hooks: re-ran the shipped tree's install-session-hooks\.sh into 1 home\(s\): claude$/m);
      const after = JSON.parse(readFileSync(f, 'utf8'));
      expect(after.hooks.WorktreeCreate).toEqual([theirs]);
      expect(after.hooks.WorktreeRemove).toEqual(foreignBefore);
      expect(r.stdout).toMatch(/^WARN delegation-hooks: WorktreeCreate, WorktreeRemove are registered/m);
    });

    /** A home whose `event` holds ONE entry that carries ccrc's hook and another command, plus a defect that makes the check FAIL. */
    const mixedHome = (prefix: string, event: string, also: { omit?: string[] } = {}): { home: string; f: string } => {
      const home = dhBox(prefix);
      for (const tool of ['cp', 'mv', 'mkdir', 'cat', 'date', 'rm', 'basename', 'cmp']) linkReal(home, tool);
      plantHookRegistration(home, '.claude', { omit: also.omit ?? [] });
      const f = join(home, '.claude', 'settings.json');
      const j = JSON.parse(readFileSync(f, 'utf8'));
      j.hooks[event] = [{ hooks: [{ type: 'command', command: installerHook().command }, THEIRS('their-shared-hook')] }];
      writeFileSync(f, JSON.stringify(j, null, 2));
      onlyThisCheck(home);
      return { home, f };
    };
    // W4-D5 (PR4 Task 4.5b): R55 is lifted. The installer's option-B sweep (Task 4.5a) removes only ccrc's own hook command from an
    // entry and keeps every other hook, so --fix hands a mixed home to the installer like any other. These rows keep the R55 rows'
    // inputs and their independent invariants; only the obsolete refusal is replaced by what the installer now does.
    /** The R55 refusal, in any of its forms (one event or several): it must not be printed any more. */
    const R55_REFUSAL = /^FIX delegation-hooks: refused — [^\n]*mixes ccrc's session hook with another command/m;
    const FIXED = (homes: string, n = 1): RegExp =>
      new RegExp(`^FIX delegation-hooks: re-ran the shipped tree's install-session-hooks\\.sh into ${n} home\\(s\\): ${homes}$`, 'm');
    /** The one backup the installer made of the default home's settings.json before it replaced it (`cp -a` into
     *  `$HOME/ccrc-backups/<YYYYmmdd-HHMMSS>/<home dir>.settings.json`), as bytes. */
    const backupOf = (home: string): Buffer => {
      const root = join(home, 'ccrc-backups');
      expect(existsSync(root), 'the installer made no backup directory').toBe(true);
      const stamps = readdirSync(root);
      expect(stamps, 'one backup run').toHaveLength(1);
      return readFileSync(join(root, stamps[0]!, '.claude.settings.json'));
    };
    const verdictClasses = (out: string): string[] =>
      out.split('\n').filter((l) => /^(PASS|FAIL|WARN) delegation-hooks: /.test(l)).map((l) => l.split(':')[0]!);

    it('W4-D5: a home whose Worktree entry mixes ccrc\'s hook with another command is handed to the installer: its own hook is swept, the other command kept, the original backed up byte for byte, and the foreign WARN still stands', () => {
      const { home, f } = mixedHome('ccrc-doctor-dh-fix-mixed-worktree-', 'WorktreeCreate');
      const before = readFileSync(f);
      const r = runDoctor(home, ['doctor', '--fix']);
      expect(r.stdout).not.toMatch(R55_REFUSAL);
      expect(r.stdout).toMatch(FIXED('claude'));
      expect(Buffer.compare(backupOf(home), before), 'the backup is not the original bytes').toBe(0);
      // measured: FAIL (ccrc's own hook under a Worktree event) then WARN (the other command); re-measured: the WARN alone
      expect(verdictClasses(r.stdout)).toEqual(['FAIL delegation-hooks', 'WARN delegation-hooks', 'WARN delegation-hooks']);
      expect(r.stdout).toMatch(/^WARN delegation-hooks: WorktreeCreate is registered/m);
      expect(JSON.parse(readFileSync(f, 'utf8')).hooks.WorktreeCreate).toEqual([{ hooks: [THEIRS('their-shared-hook')] }]);
    });

    it('W4-D5: a home whose NON-Worktree entry mixes ccrc\'s hook with another command (5180) is fixed too: the other command is kept, the original backed up, and no line names it', () => {
      const { home, f } = mixedHome('ccrc-doctor-dh-fix-mixed-stop-', 'Stop', { omit: ['SessionEnd'] });
      const before = readFileSync(f);
      const r = runDoctor(home, ['doctor', '--fix']);
      expect(r.stdout).not.toMatch(R55_REFUSAL);
      expect(r.stdout).toMatch(FIXED('claude'));
      expect(Buffer.compare(backupOf(home), before), 'the backup is not the original bytes').toBe(0);
      expect(r.stdout).toMatch(/^FAIL delegation-hooks: the shipped hook registration is missing from 1 rostered home: claude: SessionEnd$/m);
      expect(r.stdout).toMatch(/^PASS delegation-hooks: /m);   // the re-measurement
      expect(JSON.stringify(JSON.parse(readFileSync(f, 'utf8')).hooks.Stop)).toContain('their-shared-hook');
      // the check never prints a hook command, before or after the fix
      expect(r.stdout).not.toMatch(/^(FAIL|WARN|PASS) delegation-hooks: [^\n]*their-shared-hook/m);
    });

    // Task 14 re-review 2: N4 (shapes the installer's sweep walks although they are not valid settings), N5 (an event key is never
    // word-split or globbed), N6 (several events in one home). Their inputs are kept; what they assert is now the installer's keep.
    const reshaped = (prefix: string, shape: (j: { hooks: Record<string, unknown> }) => void): { home: string; f: string } => {
      const { home, f } = mixedHome(prefix, 'SessionEnd');
      const j = JSON.parse(readFileSync(f, 'utf8'));
      j.hooks.SessionEnd = [{ hooks: [{ type: 'command', command: installerHook().command }] }];
      shape(j);
      writeFileSync(f, JSON.stringify(j, null, 2));
      return { home, f };
    };
    it.each<[string, string, (j: { hooks: Record<string, unknown> }) => void]>([
      ['an object-shaped `hooks` list', 'Stop', (j) => { j.hooks.Stop = [{ hooks: { a: { type: 'command', command: installerHook().command }, b: THEIRS('their-object-hook') } }]; }],
      ['an object-shaped Worktree event value', 'WorktreeCreate', (j) => { j.hooks.WorktreeCreate = { x: { hooks: [{ type: 'command', command: installerHook().command }, THEIRS('their-object-hook')] } }; }],
    ])('W4-D5 N4: %s that mixes ccrc\'s hook with another command is not refused, and the other command is never dropped', (_name, ev, shape) => {
      const { home, f } = reshaped(`ccrc-doctor-dh-fix-shape-${ev}-`, shape);
      const before = readFileSync(f);
      const r = runDoctor(home, ['doctor', '--fix']);
      expect(r.stdout).not.toMatch(R55_REFUSAL);
      // the home is handed to the installer (review 1365, F3), which rewrites it: measured, it turns the object into an array,
      // keeping the other command and dropping the object's keys, and it backs the original up first, byte for byte
      expect(r.stdout).toMatch(FIXED('claude'));
      expect(readFileSync(f, 'utf8')).toContain('their-object-hook');
      expect(Buffer.compare(backupOf(home), before), 'the backup is not the original bytes').toBe(0);
    });

    it('W4-D5 N5: an event key `*` is never glob-expanded or word-split: no line names a file a glob would match, and the other command under `*` is kept', () => {
      const { home, f } = reshaped('ccrc-doctor-dh-fix-star-', (j) => {
        j.hooks['*'] = [{ hooks: [{ type: 'command', command: installerHook().command }, THEIRS('their-star-hook')] }];
        delete j.hooks.SessionEnd;                                               // a defect, so the check FAILs and --fix runs
      });
      writeFileSync(join(home, 'aa.txt'), 'a file a glob would name');
      const before = readFileSync(f);
      const r = runDoctor(home, ['doctor', '--fix']);
      expect(r.stdout).not.toMatch(R55_REFUSAL);
      expect(r.stdout).toMatch(FIXED('claude'));
      expect(r.stdout + r.stderr).not.toContain('aa.txt');
      expect(JSON.stringify(JSON.parse(readFileSync(f, 'utf8')).hooks['*'])).toContain('their-star-hook');
      expect(Buffer.compare(backupOf(home), before), 'the backup is not the original bytes').toBe(0);
    });

    it('W4-D5 N6: several mixed events in one home are all handled in ONE installer run: both other commands kept, one backup, and ccrc\'s own Worktree hook swept', () => {
      const { home, f } = reshaped('ccrc-doctor-dh-fix-two-', (j) => {
        j.hooks.Stop = [{ hooks: [{ type: 'command', command: installerHook().command }, THEIRS('their-stop-hook')] }];
        j.hooks.WorktreeCreate = [{ hooks: [{ type: 'command', command: installerHook().command }, THEIRS('their-wt-hook')] }];
      });
      const before = readFileSync(f);
      const r = runDoctor(home, ['doctor', '--fix']);
      expect(r.stdout).not.toMatch(R55_REFUSAL);
      expect(r.stdout.match(/^FIX delegation-hooks: /gm), 'one fix line').toHaveLength(1);
      expect(r.stdout).toMatch(FIXED('claude'));
      expect(Buffer.compare(backupOf(home), before), 'the backup is not the original bytes').toBe(0);
      const after = JSON.parse(readFileSync(f, 'utf8'));
      expect(JSON.stringify(after.hooks.Stop)).toContain('their-stop-hook');
      expect(after.hooks.WorktreeCreate).toEqual([{ hooks: [THEIRS('their-wt-hook')] }]);
      // the own-hook FAIL is measured once, before the fix; the re-measurement keeps only the foreign WARN
      expect(r.stdout.match(/^FAIL delegation-hooks: ccrc's own session hook/gm)).toHaveLength(1);
      expect(verdictClasses(r.stdout).slice(-1)).toEqual(['WARN delegation-hooks']);
    });

    it('W4-D5: a mixed home no longer holds another home back: both are handed to the installer in one run', () => {
      const { home, f } = mixedHome('ccrc-doctor-dh-fix-mixed-one-home-', 'PostToolUse', { omit: ['SessionEnd'] });
      writeRoster(home, [UPSTREAM, { id: 'lane-a', exec: { kind: 'generated' }, telemetry: 'anthropic' } as RosterEntry]);
      mkdirSync(join(home, '.lane-a'), { recursive: true });
      const before = readFileSync(f);
      const r = runDoctor(home, ['doctor', '--fix']);
      expect(r.stdout).not.toMatch(R55_REFUSAL);
      expect(r.stdout).toMatch(FIXED('claude, lane-a', 2));
      expect(Buffer.compare(backupOf(home), before), 'the backup is not the original bytes').toBe(0);
      expect(JSON.stringify(JSON.parse(readFileSync(f, 'utf8')).hooks.PostToolUse)).toContain('their-shared-hook');
      const fixed = JSON.parse(readFileSync(join(home, '.lane-a', 'settings.json'), 'utf8'));
      expect(Object.keys(fixed.hooks).sort()).toEqual([...installerEvents()].sort());
    });

    it('refuses, saying so, when the roster cannot be read (the check FAILed on it first)', () => {
      const home = dhBox('ccrc-doctor-dh-fix-refuse-roster-');
      writeRawRoster(home, '{"version":1,');
      onlyThisCheck(home);
      const r = runDoctor(home, ['doctor', '--fix']);
      expect(r.stdout).toMatch(/^FAIL delegation-hooks: \$HOME\/\.ccrc\/accounts\.json could not be read as a roster/m);
      expect(r.stdout).toMatch(/^FIX delegation-hooks: refused — \$HOME\/\.ccrc\/accounts\.json could not be read as a roster$/m);
      expect(r.stdout).toMatch(/^FAIL delegation-hooks: [^\n]*\n {2}remedy: [^\n]*\n(?:.*\n)*?summary:/m);
    });

    it('refuses, quoting the installer, when the installer refuses a home (a settings.json it will not rewrite), and the home stays a FAIL', () => {
      const home = dhBox('ccrc-doctor-dh-fix-refuse-installer-');
      for (const t of ['cp', 'mv', 'mkdir', 'cat', 'date', 'rm', 'basename', 'cmp']) linkReal(home, t);
      writeFileSync(join(home, '.claude', 'settings.json'), '{"hooks": ');
      onlyThisCheck(home);
      const r = runDoctor(home, ['doctor', '--fix']);
      expect(r.stdout).toMatch(/^FIX delegation-hooks: refused — .*install-session-hooks\.sh said: install-session-hooks: .*settings\.json is not valid JSON — refusing$/m);
      expect(r.stdout).toMatch(/summary: 1 checks \(0 skipped\), 1 verdicts — 0 passed, 0 warned, 1 failed/);
      expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).toBe('{"hooks": ');
    });
  });

  describe('in the whole table', () => {
    it('is in the check table, two before docs-sw (which stays the table\'s last name), and a healthy box answers PASS for it in a full run', () => {
      const names = tableNames();
      expect(names.filter((n) => n === 'delegation-hooks')).toHaveLength(1);
      expect(names[names.length - 3]).toBe('delegation-hooks');   // update-sweep (wave 17) sits between it and docs-sw
      const r = runDoctor(dhBox('ccrc-doctor-dh-table-'));
      expect(anyVerdictFor(r.stdout, 'delegation-hooks')).toMatch(/^PASS delegation-hooks: 1\/1 rostered homes/);
    });

    it('a server-role box counts it as a skip, not a verdict', () => {
      const home = dhBox('ccrc-doctor-dh-table-server-');
      asRole(home, 'server');
      expect(anyVerdictFor(runDoctor(home).stdout, 'delegation-hooks')).toMatch(/^SKIP delegation-hooks: this box records CCRC_ROLE=server/);
    });
  });
});


// ── Docs W4 Task 10: `docs-sw`, the installed service worker (spec 2026-10-01 §7.2, M7.5, M7.6) ──────────────
// The server half of the Docs pair: `$BOX_TREE_DIR/server/dist-pwa/sw.js`, the worker both lanes install, must not
// refuse the app shell to `/docs`. The build already refuses such a knob (`pwa/src/lib/sw-denylist.ts`, §7.3); this
// check is the one measurement of the bundle actually installed. Every body below is `swJs()`'s one-line,
// workbox-shaped text, the same text `healthy()`, `TREE_STUBS` and `ccrc-updateFixture.ts`'s tree plant, so a verdict
// here is a verdict on the shape a real build emits. Each knob entry is printed by `String(new RegExp(...))`, which
// is how a RegExp reaches `sw.js` (`/^\/wiki(\/|$)/`), built as `sw-denylist.ts` builds it.
// The check SKIPs on either fleet evidence `_check_update-exposure` uses, a recorded `CCRC_ROLE=fleet` or a unit
// directory holding `ccrc-agent.service` and no `ccrc.service` (refinement (d)), and counts `denylist:[`
// OCCURRENCES with bash builtins, never lines (refinement (c): workbox's whole worker is one line).
describe('ccrc doctor: docs-sw', () => {
  const knob = (p: string): string => String(new RegExp(`^${p}(/|$)`));
  const list = (...extra: string[]): string =>
    `denylist:[${['/^\\/api\\//', '/^\\/ws\\//', ...extra].join(',')}]`;
  const swPath = (home: string): string => join(home, 'ccrc', 'server', 'dist-pwa', 'sw.js');
  const plant = (home: string, body: string): void => { writeFileSync(swPath(home), body); };
  /** `_check_docs-sw` alone, as `cmd_doctor` runs it: `ccrc` sourced first (its `BOX_TREE_DIR`, `BOX_ENV_FILE`,
   *  `_box_env_value`), then the table, both through the fixture's `<home>/ccrc/ccd` links. */
  const runDocsSw = (home: string, timeout?: number): Result => {
    const ccd = join(home, 'ccrc', 'ccd');
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(join(ccd, 'ccrc'))}; . ${shq(join(ccd, 'ccrc-doctor-checks'))}; _check_docs-sw`],
    { env: doctorEnv(home), encoding: 'utf8', ...(timeout === undefined ? {} : { timeout }) });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const lines = (out: string): string[] => out.split('\n').filter((l) => l !== '');
  const REFUSES = 'the installed service worker refuses the app shell to /docs; Docs pages break on a hard load and offline';
  const REMEDY = "  remedy: remove /docs from CCRC_SW_DENYLIST in the deploying machine's ~/.ccrc/deploy.env and deploy again, or move to the release lane: ccrc update";
  const SHAPE = 'this check knows the shape workbox emits';
  const SHAPE_REMEDY = '  remedy: hard-reload /docs/ in a browser and check that the Docs screen renders';

  it('the shared fixture text is the one-line, one-denylist shape a build emits', () => {
    expect(SW_DENYLIST_DEFAULT).toBe(list());
    expect(swJs().split('\n')).toEqual([expect.stringContaining(`{${SW_DENYLIST_DEFAULT}}`), '']);
    expect(swJs().split('denylist:[')).toHaveLength(2);
    expect(knob('/docs')).toBe('/^\\/docs(\\/|$)/');
  });

  it('PASSes the default bundle healthy() plants, naming the worker it read and what its list holds', () => {
    const home = healthy('ccrc-doctor-docs-sw-default-');
    expect(readFileSync(swPath(home), 'utf8')).toBe(swJs());
    const r = runDocsSw(home);
    expect(lines(r.stdout), r.stderr).toEqual([
      `PASS docs-sw: ${swPath(home)} keeps /docs on the app shell: its one denylist holds 2 entries (/^\\/api\\//,/^\\/ws\\//), none of them /docs or under it`,
    ]);
    expect(r.code).toBe(0);
  });

  it('FAILs a /docs entry with the spec\'s sentence and remedy, naming the entry', () => {
    const home = healthy('ccrc-doctor-docs-sw-docs-');
    plant(home, swJs(list(knob('/wiki'), knob('/docs'))));
    const r = runDocsSw(home);
    expect(lines(r.stdout)).toEqual([
      `FAIL docs-sw: ${REFUSES} (${swPath(home)} denies ${knob('/docs')})`,
      REMEDY,
    ]);
    expect(r.code).toBe(1);
  });

  it('FAILs an entry under /docs, and a hand-built one with no end anchor; names every covering entry', () => {
    const home = healthy('ccrc-doctor-docs-sw-under-');
    plant(home, swJs(list(knob('/docs/x'))));
    expect(lines(runDocsSw(home).stdout)[0]).toBe(`FAIL docs-sw: ${REFUSES} (${swPath(home)} denies ${knob('/docs/x')})`);
    plant(home, swJs(list('/^\\/docs\\//', '/^\\/docs/')));
    const r = runDocsSw(home);
    expect(lines(r.stdout)).toEqual([
      `FAIL docs-sw: ${REFUSES} (${swPath(home)} denies /^\\/docs\\//, /^\\/docs/)`,
      REMEDY,
    ]);
    expect(r.code).toBe(1);
  });

  it('PASSes /docsy and /docs-archive: a sibling that merely starts the same way is not under /docs', () => {
    const home = healthy('ccrc-doctor-docs-sw-sibling-');
    for (const sibling of ['/docsy', '/docs-archive']) {
      plant(home, swJs(list(knob('/wiki'), knob(sibling))));
      const r = runDocsSw(home);
      expect(lines(r.stdout), sibling).toEqual([
        `PASS docs-sw: ${swPath(home)} keeps /docs on the app shell: its one denylist holds 4 entries (/^\\/api\\//,/^\\/ws\\//,${knob('/wiki')},${knob(sibling)}), none of them /docs or under it`,
      ]);
      expect(r.code, sibling).toBe(0);
    }
  });

  // Review 408's F5: the ERE's start anchor. An entry that ends in /docs, or holds it, is another co-tenant's (a
  // wiki's own docs section), which the build allows; only an entry that starts /docs covers ccrc's Docs pages.
  it('PASSes /wiki/docs and /a/docs/b: an entry that ends in or holds /docs is not under /docs', () => {
    const home = healthy('ccrc-doctor-docs-sw-elsewhere-');
    for (const elsewhere of ['/wiki/docs', '/a/docs/b']) {
      plant(home, swJs(list(knob(elsewhere))));
      const r = runDocsSw(home);
      expect(lines(r.stdout), elsewhere).toEqual([
        `PASS docs-sw: ${swPath(home)} keeps /docs on the app shell: its one denylist holds 3 entries (/^\\/api\\//,/^\\/ws\\//,${knob(elsewhere)}), none of them /docs or under it`,
      ]);
      expect(r.code, elsewhere).toBe(0);
    }
  });

  it('WARNs on two denylists on ONE line: occurrences are counted, not lines (refinement (c))', () => {
    const home = healthy('ccrc-doctor-docs-sw-two-');
    plant(home, swJs(`${list()}},{${list(knob('/docs'))}`));
    expect(readFileSync(swPath(home), 'utf8').split('\n')).toHaveLength(2);
    const r = runDocsSw(home);
    expect(lines(r.stdout)).toEqual([
      `WARN docs-sw: ${swPath(home)} carries 2 denylists, and ${SHAPE} (exactly one, closed by ]}), so whether it refuses /docs was not measured`,
      SHAPE_REMEDY,
    ]);
    expect(r.code).toBe(2);
  });

  it('WARNs on no denylist at all, and on one that never closes: neither is the shape it knows', () => {
    const home = healthy('ccrc-doctor-docs-sw-none-');
    plant(home, swJs('allowlist:[/./]'));
    expect(lines(runDocsSw(home).stdout)).toEqual([
      `WARN docs-sw: ${swPath(home)} carries 0 denylists, and ${SHAPE} (exactly one, closed by ]}), so whether it refuses /docs was not measured`,
      SHAPE_REMEDY,
    ]);
    plant(home, `self.x={denylist:[/^\\/api\\//,${knob('/docs')}\n`);
    const r = runDocsSw(home);
    expect(lines(r.stdout)).toEqual([
      `WARN docs-sw: ${swPath(home)} carries 1 denylist that never closes, and ${SHAPE} (exactly one, closed by ]}), so whether it refuses /docs was not measured`,
      SHAPE_REMEDY,
    ]);
    expect(r.code).toBe(2);
  });

  it('FAILs an absent worker with ccrc update --force', () => {
    const home = healthy('ccrc-doctor-docs-sw-absent-');
    rmSync(swPath(home));
    const r = runDocsSw(home);
    expect(lines(r.stdout)).toEqual([
      `FAIL docs-sw: no service worker at ${swPath(home)}, so this box serves its PWA bundle without the file every browser installs`,
      '  remedy: ccrc update --force',
    ]);
    expect(r.code).toBe(1);
  });

  it.skipIf(process.getuid?.() === 0)('FAILs a worker it cannot read with ccrc update --force, never a WARN', () => {
    const home = healthy('ccrc-doctor-docs-sw-unreadable-');
    chmodSync(swPath(home), 0o000);
    const r = runDocsSw(home);
    chmodSync(swPath(home), 0o644);
    expect(lines(r.stdout)).toEqual([
      `FAIL docs-sw: ${swPath(home)} is there but is not a file this check can read, so what it refuses was not measured`,
      '  remedy: ccrc update --force',
    ]);
    expect(r.code).toBe(1);
  });

  it('SKIPs a box that records CCRC_ROLE=fleet, with no remedy, even with no bundle at all', () => {
    const home = healthy('ccrc-doctor-docs-sw-fleet-role-');
    writeCcrcEnv(home, 'CCRC_ROLE=fleet\nCCRC_FLEET=local\n');
    rmSync(join(home, 'ccrc', 'server', 'dist-pwa'), { recursive: true, force: true });
    const r = runDocsSw(home);
    expect(lines(r.stdout)).toEqual([
      'SKIP docs-sw: this box records CCRC_ROLE=fleet, so it serves no PWA bundle and no service worker of its own',
    ]);
    expect(r.code).toBe(3);
  });

  it('SKIPs an env-less box whose units are the fleet role\'s, never FAILs it for a bundle it never had (refinement (d))', () => {
    const home = healthy('ccrc-doctor-docs-sw-fleet-units-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    removeUnitFile(home, 'ccrc.service');
    writeUnitFile(home, 'ccrc-agent.service');
    rmSync(join(home, 'ccrc', 'server', 'dist-pwa'), { recursive: true, force: true });
    const r = runDocsSw(home);
    expect(lines(r.stdout)).toEqual([
      'SKIP docs-sw: this box runs no ccrc server (its units are ccrc-agent.service and no ccrc.service), so it serves no PWA bundle and no service worker of its own',
    ]);
    expect(r.code).toBe(3);
  });

  it('runs on a server and on a both box: the role does not excuse either', () => {
    for (const role of ['server', 'both']) {
      const home = healthy(`ccrc-doctor-docs-sw-role-${role}-`);
      writeCcrcEnv(home, `CCRC_ROLE=${role}\nCCRC_FLEET=local\n`);
      expect(lines(runDocsSw(home).stdout)[0], role).toMatch(/^PASS docs-sw: /);
      plant(home, swJs(list(knob('/docs'))));
      expect(lines(runDocsSw(home).stdout)[0], role).toMatch(/^FAIL docs-sw: the installed service worker refuses/);
    }
  });

  it('names no path but the worker it reads, on every arm: a SKIP names none at all', () => {
    const home = healthy('ccrc-doctor-docs-sw-paths-');
    const measured: string[] = [runDocsSw(home).stdout];
    plant(home, swJs(list(knob('/docs'))));
    measured.push(runDocsSw(home).stdout);
    plant(home, swJs('allowlist:[/./]'));
    measured.push(runDocsSw(home).stdout);
    rmSync(swPath(home));
    measured.push(runDocsSw(home).stdout);
    for (const out of measured) {
      const at = out.split(home).slice(1);
      expect(at.length, out).toBe(1);
      expect(at[0]?.startsWith('/ccrc/server/dist-pwa/sw.js'), out).toBe(true);
    }
    writeCcrcEnv(home, 'CCRC_ROLE=fleet\n');
    const byRole = runDocsSw(home).stdout;
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    removeUnitFile(home, 'ccrc.service');
    writeUnitFile(home, 'ccrc-agent.service');
    const byUnits = runDocsSw(home).stdout;
    for (const out of [byRole, byUnits]) {
      expect(out, out).toMatch(/^SKIP docs-sw: /);
      expect(out.includes(home), out).toBe(false);
    }
  });

  // Linux only, like the whole-run `0 warned` case before it: a healthy macOS doctor run WARNs `linger` (review 408's
  // r-own; the plan's Task 10 wrote this case as it()).
  itLinux('a whole healthy doctor run PASSes docs-sw, and the healthy skip count does not move (M7.6)', () => {
    const home = healthy('ccrc-doctor-docs-sw-whole-');
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'docs-sw'), r.stdout).toMatch(/^PASS docs-sw: /);
    expect(r.stdout).toMatch(new RegExp(
      `^summary: \\d+ checks \\(${HEALTHY_SKIPS} skipped\\), \\d+ verdicts — \\d+ passed, 0 warned, 0 failed$`, 'm'));
    expect(r.code).toBe(0);
  });

  it('says so, rather than guessing, when ccrc\'s own tree path and config reader are not loaded', () => {
    const nowhere = join(REPO, 'no-such-home-for-check-docs-sw');
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; _check_docs-sw`],
      { encoding: 'utf8', env: { HOME: nowhere, PATH: nowhere, LC_ALL: 'C' } });
    expect(r.stdout).toMatch(/^FAIL docs-sw: ccrc's own tree path and config reader are not loaded/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.status).toBe(1);
  });

  it('reads a large worker in linear time: a ~300 KB precache manifest BEFORE the one denylist still PASSes within the bound', () => {
    // A real build prints `precacheAndRoute([...])` before the NavigationRoute, so `denylist:[` sits near the END of a
    // file that grows with the manifest. `${body#*"$open"}` is quadratic in that offset (measured on bash 5.2: 20 KB
    // 0.47 s, 80 KB 11.6 s, 320 KB over 120 s); the regex extraction is linear. The spawn is killed at 20 s so the
    // quadratic form fails fast with an empty verdict instead of holding the suite for minutes.
    const home = healthy('ccrc-doctor-docs-sw-large-');
    const entries: string[] = [];
    for (let i = 0; entries.join(',').length < 300_000; i++) {
      entries.push(`{url:"assets/chunk-${String(i).padStart(5, '0')}-aBcDeFgH.js",revision:null}`);
    }
    plant(home, `self.__WB_MANIFEST=[${entries.join(',')}];${swJs()}`);
    expect(statSync(swPath(home)).size).toBeGreaterThan(300_000);
    const t0 = Date.now();
    const r = runDocsSw(home, 20_000);
    const elapsed = Date.now() - t0;
    expect(lines(r.stdout), `after ${elapsed} ms: ${r.stderr}`).toEqual([
      `PASS docs-sw: ${swPath(home)} keeps /docs on the app shell: its one denylist holds 2 entries (/^\\/api\\//,/^\\/ws\\//), none of them /docs or under it`,
    ]);
    expect(r.code).toBe(0);
    expect(elapsed, 'the linear extraction takes well under a second; the bound is for a box at load 50+').toBeLessThan(10_000);
  }, 40_000);

  it('docs-sw is the table\'s last name and _check_docs-sw is declared (M7.6)', () => {
    const names = tableNames();
    expect(names[names.length - 1]).toBe('docs-sw');
    expect(names.filter((n) => n === 'docs-sw')).toHaveLength(1);
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; declare -F _check_docs-sw`],
      { encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('_check_docs-sw');
  });
});


// ── Docs W4 Task 11 review 5-1 and A-6: the two docs-sw pins the whole-branch review found missing ─────────────
describe('T11 review 5-1: docs-sw pins the bare-$ covered form', () => {
  const swPath = (home: string): string => join(home, 'ccrc', 'server', 'dist-pwa', 'sw.js');
  const runDocsSw = (home: string): Result => {
    const ccd = join(home, 'ccrc', 'ccd');
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(join(ccd, 'ccrc'))}; . ${shq(join(ccd, 'ccrc-doctor-checks'))}; _check_docs-sw`],
    { env: doctorEnv(home), encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };

  it('FAILs an installed worker whose denylist holds /^\\/docs$/, naming it', () => {
    // The header lists "a bare `$` anchor" as a covered form; `tail`'s `\$/` alternative is the only thing that reads it.
    // The fixtures above plant the knob form, `/^\/docs\//` and `/^\/docs/`, so deleting that alternative left them green.
    const home = healthy('ccrc-doctor-docs-sw-dollar-');
    writeFileSync(swPath(home), swJs(`${SW_DENYLIST_DEFAULT.slice(0, -1)},/^\\/docs$/]`));
    const r = runDocsSw(home);
    expect(r.stdout.split('\n')[0], r.stdout).toBe(
      `FAIL docs-sw: the installed service worker refuses the app shell to /docs; Docs pages break on a hard load and offline (${swPath(home)} denies /^\\/docs$/)`);
    expect(r.code).toBe(1);
  });
});


describe('T11 review A-6: docs-sw reads the worker byte-wise under a UTF-8 locale', () => {
  const swPath = (home: string): string => join(home, 'ccrc', 'server', 'dist-pwa', 'sw.js');
  /** A UTF-8 locale this box has, or null: `locale -a` spells them `C.utf8` / `en_US.utf8`. */
  const utf8 = ((): string | null => {
    const r = spawnSync('locale', ['-a'], { encoding: 'utf8' });
    const have = (r.stdout ?? '').split('\n').map((l) => l.trim());
    return ['C.UTF-8', 'C.utf8', 'en_US.UTF-8', 'en_US.utf8'].find((l) => have.includes(l)) ?? null;
  })();
  const runUnder = (home: string, locale: string): Result => {
    const ccd = join(home, 'ccrc', 'ccd');
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(join(ccd, 'ccrc'))}; . ${shq(join(ccd, 'ccrc-doctor-checks'))}; _check_docs-sw`],
    { env: { ...doctorEnv(home), LC_ALL: locale }, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  // The byte is planted as a Buffer (0xFF, never valid UTF-8) AFTER `denylist:[`, inside the span `(.*)$` must cross:
  // under a UTF-8 locale bash's `[[ =~ ]]` fails to match across it, and the check said "never closes" (a WARN)
  // instead of reading the list. The check pins `LC_ALL=C` for its own body.
  const plantWithBadByte = (home: string, list: string): void => {
    writeFileSync(swPath(home), Buffer.concat([Buffer.from(swJs(list).trimEnd()), Buffer.from([0xff]), Buffer.from('\n')]));
  };

  it.skipIf(utf8 === null)('still FAILs a /docs entry when an invalid UTF-8 byte follows the denylist', () => {
    const home = healthy('ccrc-doctor-docs-sw-badbyte-fail-');
    plantWithBadByte(home, `${SW_DENYLIST_DEFAULT.slice(0, -1)},/^\\/docs(\\/|$)/]`);
    const r = runUnder(home, utf8 as string);
    expect(r.stdout.split('\n')[0], r.stdout).toMatch(/^FAIL docs-sw: the installed service worker refuses the app shell to \/docs;/);
    expect(r.code).toBe(1);
  });

  it.skipIf(utf8 === null)('still PASSes the default list when an invalid UTF-8 byte follows the denylist', () => {
    const home = healthy('ccrc-doctor-docs-sw-badbyte-pass-');
    plantWithBadByte(home, SW_DENYLIST_DEFAULT);
    const r = runUnder(home, utf8 as string);
    expect(r.stdout.split('\n')[0], r.stdout).toMatch(/^PASS docs-sw: .* holds 2 entries \(\/\^\\\/api\\\/\/,\/\^\\\/ws\\\/\/\), none of them \/docs or under it$/);
    expect(r.code).toBe(0);
  });
});

describe('ccrc doctor: server-caps (D-5232\'s mechanism)', () => {
  const runCaps = (home: string): Result => {
    const ccd = join(home, 'ccrc', 'ccd');
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(join(ccd, 'ccrc'))}; . ${shq(join(ccd, 'ccrc-doctor-checks'))}; _check_server-caps`],
    { env: doctorEnv(home), encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const capsFile = (home: string): string => join(home, '.ccrc', 'server-caps');
  const now = (): number => Math.floor(Date.now() / 1000);
  // The writer's unit file, aged by `ageS`: the first-write grace (D-4168) runs from its mtime, so every case that is
  // not about the grace places it OLDER than one lease, and an absent file there is the real fault.
  const writerUnit = (home: string, unit: string, ageS: number): void => {
    writeUnitFile(home, unit);
    const t = now() - ageS;
    utimesSync(join(unitDirOf(home), unitFileOf(unit)), t, t);
  };
  const role = (home: string, r: string): void => {
    writeCcrcEnv(home, `CCRC_ROLE=${r}\n`);
    if (r === 'fleet') writerUnit(home, 'ccd-update-sync.timer', SERVER_CAPS_LEASE_S + 60);
    if (r === 'both') writerUnit(home, 'ccrc.service', SERVER_CAPS_LEASE_S + 60);
  };

  // macOS ships no ccd-update-sync (its timers are systemd-only), so a fleet node there SKIPs, as `update-sync` does:
  // the cases that read the file on a fleet node are Linux's, and the SKIP below is asserted on both platforms.
  itLinux('PASSes a current file on a fleet node, listing its words', () => {
    const home = healthy('ccrc-doctor-server-caps-pass-');
    role(home, 'fleet');
    writeFileSync(capsFile(home), `at ${now()}\ncaps dispatch-live-gate-v1\nend\n`);
    const r = runCaps(home);
    expect(r.stdout, r.stderr).toMatch(/^PASS server-caps: .*dispatch-live-gate-v1/);
    expect(r.code).toBe(0);
  });

  it('PASSes a file inside the lease (the bash copy of SERVER_CAPS_LEASE_S)', () => {
    const home = healthy('ccrc-doctor-server-caps-pass-lease-');
    role(home, 'both');
    writeFileSync(capsFile(home), `at ${now() - SERVER_CAPS_LEASE_S + 5}\ncaps dispatch-live-gate-v1\nend\n`);
    expect(runCaps(home).stdout).toMatch(/^PASS server-caps: /);
  });

  it('PASSes a current file with no words on a both node, saying it lists none', () => {
    const home = healthy('ccrc-doctor-server-caps-pass-empty-');
    role(home, 'both');
    writeFileSync(capsFile(home), `at ${now()}\ncaps\nend\n`);
    const r = runCaps(home);
    expect(r.stdout, r.stderr).toMatch(/^PASS server-caps: .*no words/);
  });

  const warns: Array<[string, string, (home: string) => void, RegExp]> = [
    ['absent', 'fleet', () => { /* no file */ }, /absent/],
    ['torn', 'fleet', (h) => writeFileSync(capsFile(h), `at ${now()}\ncaps dispatch-live-gate-v1\n`), /torn/],
    ['malformed', 'fleet', (h) => writeFileSync(capsFile(h), `at ${now()}\ncaps Bad_Word\nend\n`), /malformed/],
    ['stale', 'fleet', (h) => writeFileSync(capsFile(h), `at ${now() - SERVER_CAPS_LEASE_S - 1}\ncaps dispatch-live-gate-v1\nend\n`), /stale/],
    ['future', 'fleet', (h) => writeFileSync(capsFile(h), `at ${now() + 600}\ncaps dispatch-live-gate-v1\nend\n`), /future/],
    ['stale on a both node', 'both', (h) => writeFileSync(capsFile(h), `at ${now() - 4000}\ncaps\nend\n`), /stale/],
  ];
  for (const [name, r, arrange, why] of warns) {
    (r === 'fleet' ? itLinux : it)(`WARNs on ${name}, naming the writer`, () => {
      const home = healthy('ccrc-doctor-server-caps-warn-');
      role(home, r);
      arrange(home);
      const out = runCaps(home);
      const lines = out.stdout.split('\n');
      expect(lines[0], out.stdout + out.stderr).toMatch(/^WARN server-caps: /);
      expect(lines[0]).toMatch(why);
      expect(lines[1]).toMatch(/^ {2}remedy: /);
      expect(lines[0]).toMatch(r === 'fleet' ? /until ccd-update-sync / : /until this box's own ccrc server /);
      expect(out.code).toBe(2);
    });
  }

  // A FRESH INSTALL ENDS GREEN (D-4168, D-139; `ccrc-install-*.test.ts` pins it): within one lease of the writer's unit
  // file landing, an ABSENT file is a writer that has not had its first beat, and PASSes on its grace word.
  for (const [r, unit, writer] of [['fleet', 'ccd-update-sync.timer', /until ccd-update-sync /], ['both', 'ccrc.service', /until this box's own ccrc server /]] as const) {
    (r === 'fleet' ? itLinux : it)(`PASSes first-write-pending on a ${r} node whose ${unit} landed inside one lease, with no file yet`, () => {
      const home = healthy(`ccrc-doctor-server-caps-grace-${r}-`);
      role(home, r);
      writerUnit(home, unit, 5);
      const out = runCaps(home);
      expect(out.stdout, out.stderr).toMatch(new RegExp(`^PASS server-caps: first-write-pending: ${unit.replace('.', '\\.')} was installed \\d+s ago`));
      expect(out.stdout).toMatch(writer);
      expect(out.code).toBe(0);
    });
  }

  it('gives the grace to ABSENCE only: a torn file inside the lease of a fresh writer unit still WARNs', () => {
    const home = healthy('ccrc-doctor-server-caps-grace-torn-');
    role(home, 'both');
    writerUnit(home, 'ccrc.service', 5);
    writeFileSync(capsFile(home), `at ${now()}\ncaps dispatch-live-gate-v1\n`);
    const out = runCaps(home);
    expect(out.stdout, out.stderr).toMatch(/^WARN server-caps: .*torn/);
    expect(out.code).toBe(2);
  });

  it('SKIPs on a fleet node with no ccd-update-sync.timer installed: nothing here records the words', () => {
    const home = healthy('ccrc-doctor-server-caps-fleet-notimer-');
    role(home, 'fleet');
    removeUnitFile(home, 'ccd-update-sync.timer');
    const r = runCaps(home);
    expect(r.stdout).toMatch(/^SKIP server-caps: ccd-update-sync\.timer is not installed on this box/);
    expect(r.code).toBe(3);
  });

  it('SKIPs on a server node, which runs no hook', () => {
    const home = healthy('ccrc-doctor-server-caps-server-');
    role(home, 'server');
    const r = runCaps(home);
    expect(r.stdout).toMatch(/^SKIP server-caps: this box records CCRC_ROLE=server/);
    expect(r.code).toBe(3);
  });

  it('SKIPs on a box that records no role (healthy()) and has no file, saying the arms are off', () => {
    const home = healthy('ccrc-doctor-server-caps-norole-');
    const r = runCaps(home);
    expect(r.stdout).toMatch(/^SKIP server-caps: this box records no CCRC_ROLE and has no ~\/\.ccrc\/server-caps, so the session hook's gated arms are off/);
    expect(r.code).toBe(3);
  });

  it('reads the file on a box that records no role, naming its own server (role derived both) as the writer', () => {
    const home = healthy('ccrc-doctor-server-caps-norole-pass-');
    writeFileSync(capsFile(home), `at ${now()}\ncaps dispatch-live-gate-v1\nend\n`);
    const r = runCaps(home);
    expect(r.stdout, r.stderr).toMatch(/^PASS server-caps: .*by this box's own ccrc server \(role derived both\), if one runs here.*dispatch-live-gate-v1/);
    expect(r.code).toBe(0);
  });

  it('WARNs on a stale file on a box that records no role, naming its own server', () => {
    const home = healthy('ccrc-doctor-server-caps-norole-stale-');
    writeFileSync(capsFile(home), `at ${now() - SERVER_CAPS_LEASE_S - 1}\ncaps dispatch-live-gate-v1\nend\n`);
    const r = runCaps(home);
    const lines = r.stdout.split('\n');
    expect(lines[0], r.stdout + r.stderr).toMatch(/^WARN server-caps: .*stale.*until this box's own ccrc server \(role derived both\), if one runs here/);
    expect(lines[1]).toMatch(/^ {2}remedy: record CCRC_ROLE/);
    expect(r.code).toBe(2);
  });

  it('is read-only: a stale file is left byte for byte', () => {
    const home = healthy('ccrc-doctor-server-caps-ro-');
    role(home, 'both');
    const text = `at ${now() - 999}\ncaps dispatch-live-gate-v1\nend\n`;
    writeFileSync(capsFile(home), text);
    runCaps(home);
    expect(readFileSync(capsFile(home), 'utf8')).toBe(text);
  });
});



// ── oom-policy (D-5241, plan 2026-10-16 Task 14) ─────────────────────────────
describe('oom-policy: the victim policy\'s two scope drop-ins, on disk and applied', () => {
  const SRV = 'ccrc-tmux-server.scope';
  const PANE = 'tmux-spawn-fixture.scope';
  const listServer = (home: string): void => { appendFileSync(join(home, 'fixture-scopes'), `${SRV} loaded active running\n`); };
  const verdict = (home: string): { line: string; remedy: string } => {
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => / oom-policy: /.test(l));
    expect(i, 'an oom-policy line').toBeGreaterThanOrEqual(0);
    return { line: lines[i]!, remedy: lines[i + 1] ?? '' };
  };

  itLinux('PASS: both drop-ins in place and the live pane scope reads continue', () => {
    const home = healthy('ccrc-doctor-oom-pass-');
    expect(verdict(home).line).toBe(`PASS oom-policy: both OOMPolicy=continue drop-ins are in place and ${PANE} read continue`);
  });

  itLinux('PASS: the tmux server scope is read too, when it is listed', () => {
    const home = healthy('ccrc-doctor-oom-pass-srv-');
    listServer(home); plantOomPolicy(home, SRV, 'continue');
    expect(verdict(home).line).toBe(`PASS oom-policy: both OOMPolicy=continue drop-ins are in place and ${SRV} and ${PANE} read continue`);
  });

  itLinux('WARN: the pane-scope drop-in is missing — named, with its trailing-hyphen directory', () => {
    const home = healthy('ccrc-doctor-oom-nopane-');
    rmSync(join(home, '.config', 'systemd', 'user', OOM_DROPIN.pane));
    plantOomPolicy(home, PANE, 'stop');
    const v = verdict(home);
    expect(v.line).toMatch(/^WARN oom-policy: ~\/\.config\/systemd\/user\/tmux-spawn-\.scope\.d\/50-oom-continue\.conf is missing; tmux-spawn-fixture\.scope reads OOMPolicy=stop: /);
    expect(v.remedy).toMatch(/^ {2}remedy: ccrc update \(or ccrc install\) places both drop-ins; then systemctl --user daemon-reload/);
  });

  itLinux('WARN: the tmux-server drop-in is missing, even with no tmux server scope running', () => {
    const home = healthy('ccrc-doctor-oom-nosrv-');
    rmSync(join(home, '.config', 'systemd', 'user', OOM_DROPIN.server));
    expect(verdict(home).line).toMatch(/^WARN oom-policy: ~\/\.config\/systemd\/user\/ccrc-tmux-server\.scope\.d\/50-oom-continue\.conf is missing: /);
  });

  itLinux('WARN: a pane scope reading stop with its drop-in in place (not reloaded)', () => {
    const home = healthy('ccrc-doctor-oom-panestop-');
    listServer(home); plantOomPolicy(home, SRV, 'continue');
    plantOomPolicy(home, PANE, 'stop');
    expect(verdict(home).line).toMatch(/^WARN oom-policy: tmux-spawn-fixture\.scope reads OOMPolicy=stop although ~\/\.config\/systemd\/user\/tmux-spawn-\.scope\.d\/50-oom-continue\.conf is in place \(not reloaded\): /);
  });

  itLinux('WARN: the tmux server scope reading stop', () => {
    const home = healthy('ccrc-doctor-oom-srvstop-');
    listServer(home); plantOomPolicy(home, SRV, 'stop');
    expect(verdict(home).line).toMatch(/^WARN oom-policy: ccrc-tmux-server\.scope reads OOMPolicy=stop although .* is in place \(not reloaded\): /);
  });

  itLinux('PASS, saying so, when no tmux scope is running to read (an unlisted scope is never asked)', () => {
    const home = healthy('ccrc-doctor-oom-noscope-');
    rmSync(join(home, 'fixture-scopes'));
    plantOomPolicy(home, PANE, 'stop');   // would WARN if it were asked
    expect(verdict(home).line).toBe('PASS oom-policy: both OOMPolicy=continue drop-ins are in place; no tmux scope is running to read');
  });

  // PLATFORM-ONLY: OOMPolicy is a systemd unit property; the Linux arm is every itLinux case above, and launchd has no counterpart to assert.
  itDarwin('SKIP on macOS: launchd has no OOMPolicy', () => {
    const home = healthy('ccrc-doctor-oom-darwin-');
    expect(verdict(home).line).toBe('SKIP oom-policy: OOMPolicy is a systemd mechanism, and this box runs launchd');
  });
});


// ── Wave 17 Task 4: `update-sweep`, the last update's supervisor sweep read from its report (D-5316) ───────────────
// `ccrc update` and `ccrc rollback` record what their supervisor sweep did as update.json's `sweep` key (D-5314,
// D-5315). This check reads it and WARNs, never FAILs: Reading 9 was ruled "warn only" (2026-10-15), and a FAIL would
// turn a state the update already recorded into exit 1 for every bare doctor and install. An absent key is NOT
// MEASURED (SKIP), and the `down` arm keeps the service manager's three answers apart (active, EMPTY, any other word),
// and on Linux (coordinator ruling 12) reads NRestarts too, because one `active` read is what a crash-looping unit
// shows between its restarts. The rows plant `$HOME/.ccrc/update.json` and a per-unit `fixture-show-<unit>` file the
// fixture `systemctl` answers `show -p ActiveState -p NRestarts` from; the `down` rows are Linux-only (PLATFORM-ONLY:
// the Darwin arm is one `_svc_is_active` read, measured by the row script in the plan's Task 4 as-built note), EXCEPT the
// itDarwin D5/D6/D13 rows, which are green on macOS (full run 39096832066).
describe('update-sweep: the last update\'s sweep, read from its report, WARN never FAIL (wave 17, D-5316)', () => {
  const REPORT = { target: 'v1.2.3', startedAt: 1, updatedAt: 2, detail: null, from: 'cli' };
  const plantReport = (home: string, report: object | string): void => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'update.json'), typeof report === 'string' ? `${report}\n` : `${JSON.stringify(report)}\n`);
  };
  const plantSweep = (home: string, sweep: string | undefined, phase = 'done'): void =>
    plantReport(home, { ...REPORT, pid: 7, phase, ...(sweep === undefined ? {} : { sweep }) });
  /** What `systemctl --user show -p ActiveState -p NRestarts claude-session@<id>.service` prints: the two lines in the
   *  manager's own order (NRestarts before ActiveState, as systemd prints them), or nothing at all when `lines` is []. */
  const plantShow = (home: string, id: string, lines: string[]): void =>
    writeFileSync(join(home, `fixture-show-claude-session@${id}.service`), lines.length === 0 ? '' : `${lines.join('\n')}\n`);
  const up = (home: string, id: string, restarts = 0): void => plantShow(home, id, [`NRestarts=${restarts}`, 'ActiveState=active']);
  /** `_check_update-sweep` alone, as `cmd_doctor` runs it (`runDh`'s shape). */
  const runUs = (home: string, extraEnv: NodeJS.ProcessEnv = {}, cwd?: string): Result => {
    const ccd = join(home, 'ccrc', 'ccd');
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(join(ccd, 'ccrc'))}; . ${shq(join(ccd, 'ccrc-doctor-checks'))}; _check_update-sweep`],
    { env: { ...doctorEnv(home), ...extraEnv }, encoding: 'utf8', ...(cwd === undefined ? {} : { cwd }) });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const out = (r: Result): string[] => r.stdout.split('\n').filter((l) => l !== '');
  const verdict = (r: Result): string => out(r).find((l) => /^(PASS|WARN|FAIL|SKIP) update-sweep: /.test(l)) ?? '';
  const remedy = (r: Result): string => out(r).find((l) => l.startsWith('  remedy: ')) ?? '';
  const sweepBox = (prefix: string): string => healthy(prefix);

  it('D1: SKIPs when there is no update report, saying so, rc 3', () => {
    const r = runUs(sweepBox('ccrc-doctor-us-absent-'));
    expect(verdict(r)).toMatch(/^SKIP update-sweep: no update report on this box \(~\/\.ccrc\/update\.json is absent\)/);
    expect(r.code).toBe(3);
  });

  it('D2: SKIPs a report at a phase that is not a final one (an update\'s own install tail reads its in-flight report)', () => {
    const home = sweepBox('ccrc-doctor-us-inflight-');
    plantSweep(home, undefined, 'installing');
    const r = runUs(home);
    expect(verdict(r)).toMatch(/^SKIP update-sweep: .*phase 'installing', not a final one/);
    expect(r.code).toBe(3);
  });

  it('D2b: WARNs when the report stopped at `restarting` and its updater pid is gone (an updater killed mid-sweep leaves it for good)', () => {
    const home = sweepBox('ccrc-doctor-us-restarting-dead-');
    plantReport(home, { ...REPORT, pid: 999999999, phase: 'restarting' });
    const r = runUs(home);
    expect(verdict(r)).toMatch(/^WARN update-sweep: .*updater \(pid 999999999\) is gone/);
    expect(remedy(r)).toMatch(/clears at the next ccrc update or rollback/);
    expect(r.code).toBe(2);
  });

  it('D2c: SKIPs a `restarting` report whose updater is alive (a sweep in flight)', () => {
    const home = sweepBox('ccrc-doctor-us-restarting-live-');
    plantReport(home, { ...REPORT, pid: process.pid, phase: 'restarting' });
    const r = runUs(home);
    expect(verdict(r)).toMatch(/^SKIP update-sweep: .*restarting its supervisors now/);
    expect(r.code).toBe(3);
  });

  it('D3: SKIPs a final report with no `sweep` key as not measured, never as "nothing was down"', () => {
    const home = sweepBox('ccrc-doctor-us-nokey-');
    plantSweep(home, undefined);
    const r = runUs(home);
    expect(verdict(r)).toMatch(/^SKIP update-sweep: .*records no sweep.*not measured/);
    expect(r.code).toBe(3);
  });

  it('D4: PASSes on `ok`', () => {
    const home = sweepBox('ccrc-doctor-us-ok-');
    plantSweep(home, 'ok');
    const r = runUs(home);
    expect(verdict(r)).toMatch(/^PASS update-sweep: the last update's sweep found no supervisor already activating or failed before its restart$/);
    expect(r.code).toBe(0);
  });

  describe('the `down` word (Linux: ActiveState and NRestarts from `systemctl --user show`)', () => {
    itLinux('D5: WARNs on a unit that still reads failed, quoting the manager\'s word and naming the fix; a unit that is back is not named', () => {
      const home = sweepBox('ccrc-doctor-us-down-');
      plantSweep(home, 'down: 2: acct-a-demo acct-b-demo');
      up(home, 'acct-a-demo'); plantShow(home, 'acct-b-demo', ['NRestarts=0', 'ActiveState=failed']);
      const r = runUs(home);
      expect(verdict(r)).toBe('WARN update-sweep: 1 supervisor(s) were already down before the last update\'s restart and are still not active: acct-b-demo (failed) — the update did not verify them and did not fail for them');
      expect(remedy(r)).toMatch(/^ {2}remedy: systemctl --user reset-failed claude-session@<id>\.service, then ccd start <id>; read: systemctl --user status/);
      expect(r.code).toBe(2);
    });

    itLinux('D6: PASSes when every recorded unit reads active with no restart since, wording it as one read', () => {
      const home = sweepBox('ccrc-doctor-us-down-back-');
      plantSweep(home, 'down: 1: acct-a-demo');
      up(home, 'acct-a-demo');
      const r = runUs(home);
      expect(verdict(r)).toBe('PASS update-sweep: the 1 supervisor(s) the last update found already down before its restart each read active at this read, with no restart by their manager since');
      expect(r.code).toBe(0);
    });

    itLinux('D7: says so when the word names fewer units than its count (an older or hand-cut word)', () => {
      const home = sweepBox('ccrc-doctor-us-down-short-');
      plantSweep(home, 'down: 3: acct-a-demo acct-b-demo');
      plantShow(home, 'acct-a-demo', ['NRestarts=0', 'ActiveState=inactive']); up(home, 'acct-b-demo');
      expect(verdict(runUs(home))).toMatch(/^WARN update-sweep: .*still not active: acct-a-demo \(inactive\) \(the report names 2 of 3; the rest did not fit in it\)/);
    });

    itLinux('D13: SKIPs, never WARNs, when the manager does not answer for the one recorded unit (no show answer is not "down")', () => {
      const home = sweepBox('ccrc-doctor-us-down-unasked-');
      plantSweep(home, 'down: 1: acct-c-demo');   // no fixture-show file: `show` prints nothing
      const r = runUs(home);
      expect(verdict(r)).toMatch(/^SKIP update-sweep: the service manager did not answer for acct-c-demo, .*not measured$/);
      expect(r.code).toBe(3);
    });

    itLinux('D14: WARNs on the unit that is down and names the unit the manager did not answer for only as not measured', () => {
      const home = sweepBox('ccrc-doctor-us-down-mixed-');
      plantSweep(home, 'down: 2: acct-b-demo acct-c-demo');
      plantShow(home, 'acct-b-demo', ['NRestarts=0', 'ActiveState=failed']);
      const r = runUs(home);
      expect(verdict(r)).toMatch(/still not active: acct-b-demo \(failed\); not measured \(the service manager did not answer\): acct-c-demo — /);
      expect(verdict(r)).not.toContain('acct-c-demo (');
      expect(r.code).toBe(2);
    });

    itLinux('D15: quotes a word that is neither active nor failed back as the manager said it', () => {
      const home = sweepBox('ccrc-doctor-us-down-activating-');
      plantSweep(home, 'down: 1: acct-d-demo');
      plantShow(home, 'acct-d-demo', ['NRestarts=0', 'ActiveState=activating']);
      expect(verdict(runUs(home))).toMatch(/still not active: acct-d-demo \(activating\) — /);
    });

    itLinux('D17 (ruling 12): active with NRestarts above 0 WARNs as restarted by its manager since, and is never called "still not active"', () => {
      const home = sweepBox('ccrc-doctor-us-down-restarted-');
      plantSweep(home, 'down: 1: acct-e-demo');
      up(home, 'acct-e-demo', 3);
      const r = runUs(home);
      expect(verdict(r)).toMatch(/^WARN update-sweep: 1 supervisor\(s\) the last update found already down before its restart read active, but their manager has restarted them since .*: acct-e-demo \(active at this read, but restarted 3 times by its manager since\) — /);
      expect(verdict(r)).not.toContain('still not active');
      expect(r.code).toBe(2);
    });

    itLinux('D17: a restarted unit and a failed one are two named sets in one WARN', () => {
      const home = sweepBox('ccrc-doctor-us-down-restarted-and-failed-');
      plantSweep(home, 'down: 2: acct-e-demo acct-b-demo');
      up(home, 'acct-e-demo', 2); plantShow(home, 'acct-b-demo', ['NRestarts=0', 'ActiveState=failed']);
      const v = verdict(runUs(home));
      expect(v).toContain('still not active: acct-b-demo (failed)');
      expect(v).toContain('acct-e-demo (active at this read, but restarted 2 times by its manager since)');
    });

    itLinux('D17: `active` with no readable NRestarts is not measured, never back', () => {
      const home = sweepBox('ccrc-doctor-us-down-norestarts-');
      plantSweep(home, 'down: 2: acct-a-demo acct-d-demo');
      plantShow(home, 'acct-a-demo', ['ActiveState=active']); plantShow(home, 'acct-d-demo', ['NRestarts=x', 'ActiveState=active']);
      const r = runUs(home);
      expect(verdict(r)).toMatch(/^SKIP update-sweep: the service manager did not answer for acct-a-demo acct-d-demo, /);
      expect(r.code).toBe(3);
    });

    itLinux('reads ActiveState and NRestarts BY NAME, in whichever order the manager prints them', () => {
      const home = sweepBox('ccrc-doctor-us-down-order-');
      plantSweep(home, 'down: 2: acct-a-demo acct-e-demo');
      plantShow(home, 'acct-a-demo', ['ActiveState=active', 'NRestarts=0']); plantShow(home, 'acct-e-demo', ['ActiveState=active', 'NRestarts=1']);
      expect(verdict(runUs(home))).toMatch(/^WARN update-sweep: .*acct-e-demo \(active at this read, but restarted 1 times by its manager since\)/);
    });

    itLinux('sets the bus defaults a bare context lacks: a manager that answers only with XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS set is still asked', () => {
      const home = sweepBox('ccrc-doctor-us-down-bus-');
      writeFileSync(join(home, 'fixture-bus-required'), '');
      plantSweep(home, 'down: 1: acct-a-demo');
      up(home, 'acct-a-demo');
      const r = runUs(home);   // doctorEnv carries no XDG_RUNTIME_DIR, as a cron or a nested `$( )` does not
      expect(verdict(r)).toMatch(/^PASS update-sweep: the 1 supervisor\(s\)/);
      expect(r.code).toBe(0);
    });
  });

  it('D8: WARNs on a refused sweep, saying every supervisor still ran the old ccd and nothing re-sweeps', () => {
    const home = sweepBox('ccrc-doctor-us-refused-');
    plantSweep(home, 'refused: killmode');
    const r = runUs(home);
    expect(verdict(r)).toMatch(/^WARN update-sweep: the last update's supervisor sweep was REFUSED \(killmode\)/);
    expect(r.code).toBe(2);
  });

  it('D8b: a refusal\'s remedy ends by saying when it clears', () => {
    const home = sweepBox('ccrc-doctor-us-refused-listing-');
    plantSweep(home, 'refused: listing');
    expect(remedy(runUs(home))).toMatch(/; this WARN clears at the next ccrc update or rollback, which writes a new report$/);
  });

  it('D9: WARNs on an unverified relist as "no supervisor\'s state known", never as restarted', () => {
    const home = sweepBox('ccrc-doctor-us-unverified-');
    plantSweep(home, 'unverified: relist');
    const r = runUs(home);
    expect(verdict(r)).toMatch(/^WARN update-sweep: .*no supervisor's state after its restart is known/);
    expect(verdict(r)).not.toContain('restarted every');
    expect(r.code).toBe(2);
  });

  it('D10: SKIPs a sweep word this build does not know', () => {
    const home = sweepBox('ccrc-doctor-us-unknown-');
    plantSweep(home, 'later-word');
    const r = runUs(home);
    expect(verdict(r)).toMatch(/^SKIP update-sweep: .*not one this build knows/);
    expect(r.code).toBe(3);
  });

  it('D11: SKIPs a report that is not JSON', () => {
    const home = sweepBox('ccrc-doctor-us-garbage-');
    plantReport(home, 'not json');
    const r = runUs(home);
    expect(verdict(r)).toMatch(/^SKIP update-sweep: .*does not parse as one report/);
    expect(r.code).toBe(3);
  });

  it('D16: WARNs on a failed update whose sweep died partway', () => {
    const home = sweepBox('ccrc-doctor-us-died-');
    plantSweep(home, 'died: sweep', 'failed');
    const r = runUs(home);
    expect(verdict(r)).toMatch(/^WARN update-sweep: .*supervisor sweep died partway/);
    expect(r.code).toBe(2);
  });

  it('D16b: WARNs, never FAILs, on a failed update the watchdog closed as `died: abandoned`, with its own text, not the generic died-partway one (D-5329, review 589 F1)', () => {
    const home = sweepBox('ccrc-doctor-us-abandoned-');
    plantSweep(home, 'died: abandoned', 'failed');
    const r = runUs(home);
    expect(verdict(r)).toBe("WARN update-sweep: the watchdog closed the last update's report, abandoned during or right after its supervisor sweep, so its outcome was never recorded and some supervisors may run the previous ccd");
    expect(verdict(r)).not.toContain('died partway');
    expect(remedy(r)).toMatch(/^  remedy: ccrc status lists each session's state; restart any that is not running with ccd start <id>; this WARN clears at the next ccrc update or rollback, which writes a new report$/);
    expect(r.code).toBe(2);
  });

  it('D16c: a server-role box SKIPs the whole check, `died: abandoned` and the dead-pid `restarting` arm included; role both WARNs, and an absent role keeps the check (D-5330, D-3111)', () => {
    const roleBox = (prefix: string, role: string | null): string => {
      const home = sweepBox(prefix);
      if (role !== null) writeCcrcEnv(home, [`CCRC_ROLE=${role}`, 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
      return home;
    };
    const srv = roleBox('ccrc-doctor-us-role-server-', 'server');
    plantSweep(srv, 'died: abandoned', 'failed');
    let r = runUs(srv);
    expect(verdict(r)).toBe('SKIP update-sweep: this box records CCRC_ROLE=server, so it hosts no supervisors and no update\'s supervisor sweep is its concern');
    expect(r.code).toBe(3);
    // The dead-pid `restarting` arm is gated too: the gate sits above the whole check.
    plantReport(srv, { ...REPORT, pid: 999999999, phase: 'restarting' });
    r = runUs(srv);
    expect(verdict(r)).toMatch(/^SKIP update-sweep: this box records CCRC_ROLE=server/);
    expect(r.code).toBe(3);
    // Role both hosts supervisors: the same report WARNs.
    const both = roleBox('ccrc-doctor-us-role-both-', 'both');
    plantSweep(both, 'died: abandoned', 'failed');
    r = runUs(both);
    expect(verdict(r)).toMatch(/^WARN update-sweep: the watchdog closed the last update's report/);
    expect(r.code).toBe(2);
    // An absent role never folds into the skip.
    const none = roleBox('ccrc-doctor-us-role-none-', null);
    plantSweep(none, 'died: abandoned', 'failed');
    r = runUs(none);
    expect(verdict(r)).toMatch(/^WARN update-sweep: the watchdog closed the last update's report/);
    expect(r.code).toBe(2);
  });

  // The gate skips on exactly `server` (D-5330). Each case below plants `died: abandoned` and expects the WARN: a role
  // that hosts supervisors (`fleet`, the one the check exists for), a box with no ccrc.env at all, and a ccrc.env that
  // cannot be read are none of them the skip (review 594 F1: skip-on-fleet, an unreadable file read as server and an
  // absent one read as server each stayed green before these).
  const abandonedWarns = (r: Result): void => {
    expect(verdict(r)).toMatch(/^WARN update-sweep: the watchdog closed the last update's report/);
    expect(r.code).toBe(2);
  };

  it('D16d: a fleet-role box keeps the check: `died: abandoned` WARNs, never the server-role skip (D-5330)', () => {
    const home = sweepBox('ccrc-doctor-us-role-fleet-');
    writeCcrcEnv(home, ['CCRC_ROLE=fleet', 'CCRC_FLEET=remote', ''].join('\n'));
    plantSweep(home, 'died: abandoned', 'failed');
    abandonedWarns(runUs(home));
  });

  it('D16e: a box with no ccrc.env at all keeps the check: an absent file is no role, never read as server (D-5330)', () => {
    const home = sweepBox('ccrc-doctor-us-role-noenv-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    expect(existsSync(join(home, '.ccrc', 'ccrc.env')), 'the fixture still has a ccrc.env').toBe(false);
    plantSweep(home, 'died: abandoned', 'failed');
    abandonedWarns(runUs(home));
  });

  // Skipped as root: root reads a mode-000 file, so the file would be readable and the case would measure nothing.
  it.skipIf(process.getuid?.() === 0)('D16f: an unreadable ccrc.env (mode 000) that records CCRC_ROLE=server keeps the check: an unreadable role is no role, never folded into the skip (D-5330)', () => {
    const home = sweepBox('ccrc-doctor-us-role-unreadable-');
    writeCcrcEnv(home, ['CCRC_ROLE=server', 'CCRC_FLEET=local', ''].join('\n'));
    chmodSync(join(home, '.ccrc', 'ccrc.env'), 0o000);
    plantSweep(home, 'died: abandoned', 'failed');
    abandonedWarns(runUs(home));
  });

  // The Darwin arm is ONE `_svc_is_active` read (no NRestarts under launchd), through the file's own `stubLaunchctl`, which
  // answers from the same `fixture-unit-claude-session@<id>.service` file the systemctl stub reads: `active`, any other word
  // (a loaded job that is not running: `inactive`) and an EMPTY file (the manager could not be asked). `failed` has no
  // launchd source, so ccd's own `$HOME/.cc-sessions/<id>.svcfailed` stamp is what reads as `failed`. These skip on Linux
  // (their arm is the `down` describe above) and run on the macOS leg; the plan's Task 4 as-built note says so.
  describe('the `down` word on macOS (one `_svc_is_active` read through the launchctl fixture)', () => {
    const unitFile = (home: string, id: string, text: string): void =>
      writeFileSync(join(home, `fixture-unit-claude-session@${id}.service`), text);
    itDarwin('D5: WARNs on a unit launchd holds as failed (the start-limit stamp), quoting the word, and the fix is ccd start', () => {
      const home = sweepBox('ccrc-doctor-us-mac-down-');
      plantSweep(home, 'down: 2: acct-a-demo acct-b-demo');
      unitFile(home, 'acct-a-demo', 'active\n');
      mkdirSync(join(home, '.cc-sessions'), { recursive: true });
      writeFileSync(join(home, '.cc-sessions', 'acct-b-demo.svcfailed'), '');
      const r = runUs(home);
      expect(verdict(r)).toBe('WARN update-sweep: 1 supervisor(s) were already down before the last update\'s restart and are still not active: acct-b-demo (failed) — the update did not verify them and did not fail for them');
      expect(remedy(r)).toMatch(/^ {2}remedy: ccd start <id> for each /);
      expect(r.code).toBe(2);
    });

    itDarwin('D6: PASSes when the recorded unit reads active, and keeps the one-read parenthetical (a crash loop can read active between its restarts)', () => {
      const home = sweepBox('ccrc-doctor-us-mac-back-');
      plantSweep(home, 'down: 1: acct-a-demo');
      unitFile(home, 'acct-a-demo', 'active\n');
      const r = runUs(home);
      expect(verdict(r)).toBe('PASS update-sweep: the 1 supervisor(s) the last update found already down before its restart read active at this read (one read: a unit that crash-loops can read active between its restarts)');
      expect(r.code).toBe(0);
    });

    itDarwin('D13: SKIPs, never WARNs, when launchd could not be asked for the one recorded unit (an empty answer is not "down")', () => {
      const home = sweepBox('ccrc-doctor-us-mac-unasked-');
      plantSweep(home, 'down: 1: acct-c-demo');
      unitFile(home, 'acct-c-demo', '\n');
      const r = runUs(home);
      expect(verdict(r)).toMatch(/^SKIP update-sweep: the service manager did not answer for acct-c-demo, .*not measured$/);
      expect(r.code).toBe(3);
    });
  });

  it('a `*` in a hand-cut down word is never expanded against the cwd: a file named like an id is not read as one, and a word with no readable id SKIPs rather than PASSes', () => {
    const home = sweepBox('ccrc-doctor-us-glob-');
    const cwd = mkTmp('ccrc-doctor-us-glob-cwd-');
    writeFileSync(join(cwd, 'zz-decoy.txt'), '');
    plantSweep(home, 'down: 1: *');
    const r = runUs(home, {}, cwd);
    expect(r.stdout + r.stderr).not.toContain('zz-decoy');
    expect(verdict(r)).toMatch(/^SKIP update-sweep: .*names no supervisor id this build can read \('down: 1: \*'\)/);
    expect(r.code).toBe(3);
  });

  it('prints the sweep word cut and scrubbed: a control character in it never reaches the output, in any arm that echoes it', () => {
    const ESC = '\u001b';
    for (const word of [`refused: bad${ESC}[31mx`, `unverified: bad${ESC}[31mx`, `died: bad${ESC}[31mx`, `later${ESC}[31mx`, `down: 1x${ESC}[31m: a`]) {
      const home = sweepBox('ccrc-doctor-us-scrub-');
      plantSweep(home, word, word.startsWith('died') ? 'failed' : 'done');
      const r = runUs(home);
      expect(verdict(r), `no verdict for ${JSON.stringify(word)}\n${r.stdout}`).toMatch(/bad\?\[31mx|later\?\[31mx|1x\?\[31m/);
      expect(r.stdout, JSON.stringify(word)).not.toContain(ESC);
    }
  });

  it('D12: the function has no FAIL arm and no `return 1` (a structural pin: Reading 9 was ruled warn only)', () => {
    const src = readFileSync(CHECKS_SRC, 'utf8');
    const m = /^_check_update-sweep\(\) \{\n[\s\S]*?^\}$/m.exec(src);
    expect(m, 'the function was not found by its column-0 opening and closing lines').not.toBeNull();
    expect(m![0].length).toBeGreaterThan(1000);   // the CONTROL: a scan over a truncated body passes everything
    expect(m![0]).not.toMatch(/_dr_fail/);
    expect(m![0]).not.toMatch(/return 1(?![0-9])/);
  });

  describe('in the whole table, through cmd_doctor', () => {
    it('is in the check table once, just before docs-sw, and a healthy box (no update.json) SKIPs it in a full run', () => {
      const names = tableNames();
      expect(names.filter((n) => n === 'update-sweep')).toHaveLength(1);
      expect(names[names.length - 2]).toBe('update-sweep');
      expect(names[names.length - 1]).toBe('docs-sw');
      const r = runDoctor(sweepBox('ccrc-doctor-us-table-'));
      expect(anyVerdictFor(r.stdout, 'update-sweep')).toMatch(/^SKIP update-sweep: no update report on this box/);
    });

    itLinux('a WARN on a recorded down unit never changes doctor\'s exit: the run still exits 0 and the summary counts it as a warning', () => {
      const home = sweepBox('ccrc-doctor-us-table-warn-');
      plantSweep(home, 'down: 2: acct-a-demo acct-b-demo');
      up(home, 'acct-a-demo'); plantShow(home, 'acct-b-demo', ['NRestarts=0', 'ActiveState=failed']);
      const r = runDoctor(home);
      expect(r.stdout).toMatch(/^WARN update-sweep: 1 supervisor\(s\) were already down .* still not active: acct-b-demo \(failed\)/m);
      expect(r.stdout).toMatch(/^summary: \d+ checks \(\d+ skipped\), \d+ verdicts — \d+ passed, 1 warned, 0 failed$/m);
      expect(r.code, r.stdout).toBe(0);
    });

    it('a sweep REFUSED word WARNs through the whole run and the run exits 0', () => {
      const home = sweepBox('ccrc-doctor-us-table-refused-');
      plantSweep(home, 'refused: killmode');
      const r = runDoctor(home);
      expect(r.stdout).toMatch(/^WARN update-sweep: the last update's supervisor sweep was REFUSED \(killmode\)/m);
      expect(r.code, r.stdout).toBe(0);
    });
  });
});
