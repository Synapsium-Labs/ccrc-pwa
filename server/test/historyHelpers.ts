// server/test/historyHelpers.ts — the fixture box every ccrc-history test that
// spawns the sweep, the shim or the CLI builds on (spec 2026-10-05 §10.1).
// No describe here: importing a .test.ts registers its suite twice, so shared
// fixtures live in a helper (the *Fixtures.ts / *Helpers.ts convention).
//
// ISOLATION, in three layers:
//  - HOME is a mkTmp fixture; the shim and the sweep read only $HOME paths.
//  - the env is SCRUBBED of the operator's own Claude Code and tmux state
//    (CLAUDECODE, CLAUDE_CONFIG_DIR, TMUX, TMUX_PANE, CCRC_SESSION_GENERATION, every CCRC_RECALL_*),
//    which a spawn would otherwise inherit from the session running the suite;
//  - it is ccrcContainedEnv's (wave 9): gh, tmux, ssh, scp, curl and the
//    service managers poisoned in <home>/.local/bin, first on PATH, the user
//    bus pointed under HOME — and assertNoRealTool proves it per box.
// Node children run on process.execPath, so the pinned-Node CI leg really runs
// ccd/history on that Node: the shim's own `node` resolves to its directory,
// which is put on PATH right behind the poisons.
import { beforeEach } from 'vitest';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { mkTmp } from './tmpHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { seedAccountsSh } from './ccdWsHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { assertNoRealTool } from './containedTools.js';
import { parseRoster } from '../../shared/roster.js';
import { historyPaths } from '../../ccd/history/lib.mjs';
import { createStore, V2_INDEXES } from '../../ccd/history/store.mjs';

export const REPO = path.resolve(__dirname, '..', '..');
export const SWEEP = path.join(REPO, 'ccd', 'history', 'sweep.mjs');
export const CLI = path.join(REPO, 'ccd', 'history', 'cli.mjs');
export const SHIM = path.join(REPO, 'ccd', 'ccd-history-sweep');
export const PRELOADS = {
  statfs: path.join(__dirname, 'fixtures', 'history', 'preload-statfs.mjs'),
  faults: path.join(__dirname, 'fixtures', 'history', 'preload-faults.mjs'),
  readspy: path.join(__dirname, 'fixtures', 'history', 'preload-readspy.mjs'),
  throwwrite: path.join(__dirname, 'fixtures', 'history', 'preload-throwwrite.mjs'),
} as const;

/** Linux-only spawns skip on darwin (O24; the graph-sweep.test.ts:12
 *  precedent). Call once at the top of a sweep, shim or CLI test file. */
export function skipOnDarwin(): void {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
}

/** `base` without the ambient state of the session running the suite. */
export function scrubbedEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...base };
  for (const k of Object.keys(e)) {
    if (k === 'CLAUDECODE' || k === 'CLAUDE_CONFIG_DIR' || k === 'TMUX' || k === 'TMUX_PANE' || k === 'CCRC_SESSION_GENERATION'
      || k.startsWith('CCRC_RECALL_') || k.startsWith('HISTORY_TEST_') || k === 'NODE_OPTIONS') delete e[k];
  }
  return e;
}

export interface HistoryBox {
  home: string;
  /** `<home>/.cc-sessions` */
  reg: string;
  /** `<home>/.ccrc/history` */
  root: string;
  /** Every rostered account's config dir, in roster order: what the shim passes. */
  homes: string[];
  /** The same dirs by account id, for planting a transcript under one account. */
  accountHome: Record<string, string>;
  env: NodeJS.ProcessEnv;
}

export interface BoxOpts {
  /** CCRC_ROLE recorded in ~/.ccrc/ccrc.env; null writes no ccrc.env. Default 'fleet'. */
  role?: 'fleet' | 'both' | 'server' | null;
  /** Place the shim at ~/.local/bin/ccd-history-sweep. Default true. */
  shim?: boolean;
  /** Make ~/ccrc a link to this checkout, as `ccrc install` makes it to the placed tree. Default true. */
  treeLink?: boolean;
  /** The roster ~/.ccrc/accounts.sh is generated from. Default DEFAULT_TEST_ROSTER. */
  roster?: unknown;
}

export function makeHistoryBox(prefix: string, opts: BoxOpts = {}): HistoryBox {
  const home = mkTmp(prefix);
  const role = opts.role === undefined ? 'fleet' : opts.role;
  const roster = opts.roster ?? DEFAULT_TEST_ROSTER;
  if (opts.treeLink !== false) fs.symlinkSync(REPO, path.join(home, 'ccrc'));
  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  if (role !== null) fs.writeFileSync(path.join(home, '.ccrc', 'ccrc.env'), `CCRC_ROLE=${role}\n`);
  seedAccountsSh(home, roster);
  const accounts = parseRoster(roster).accounts;
  const homes = accounts.map((a) => path.join(home, a.configDirSuffix));
  const accountHome = Object.fromEntries(accounts.map((a) => [a.id, path.join(home, a.configDirSuffix)]));
  for (const h of homes) fs.mkdirSync(path.join(h, 'projects'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  // The poisons and the rest of PATH: this Node's directory right behind them,
  // so the shim's `node` is the interpreter running the suite.
  const env = ccrcContainedEnv(home, {
    ...scrubbedEnv(process.env), PATH: `${path.dirname(process.execPath)}:${process.env['PATH'] ?? ''}`,
  }, { managers: true, curl: 'poison' });
  assertNoRealTool(env, home);
  if (opts.shim !== false) {
    fs.copyFileSync(SHIM, path.join(home, '.local', 'bin', 'ccd-history-sweep'));
    fs.chmodSync(path.join(home, '.local', 'bin', 'ccd-history-sweep'), 0o755);
  }
  return { home, reg: path.join(home, '.cc-sessions'), root: path.join(home, '.ccrc', 'history'), homes, accountHome, env };
}

export interface SpawnOpts {
  /** Test-only preloads beyond the statfs one, each an absolute path. */
  preloads?: string[];
  /** Extra env: HISTORY_TEST_* for the preloads, or an override. */
  env?: Record<string, string>;
  /** runSweep only: the files after --secrets (default none). */
  secrets?: string[];
  /** runSweep only: the homes after -- (default the box's). */
  homes?: string[];
  /** The child's wall-clock cap (default SPAWN_TIMEOUT_MS). */
  timeoutMs?: number;
}
export interface SpawnResult { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number }

/** Every spawn's wall-clock cap. vitest's testTimeout cannot interrupt a
 *  spawnSync, which blocks the event loop its timer fires on, so a pass that
 *  regressed into a block would wedge the worker until the CI job died. Capped,
 *  it fails its one case. Above RUN_BUDGET_MS (90 s) plus a drain, so a real
 *  pass never meets it. SIGTERM, never the fault preloads' SIGKILL, so a hang
 *  is never read as a planned kill. */
const SPAWN_TIMEOUT_MS = 240_000;

/** NODE_OPTIONS for a child: the statfs preload always (HISTORY_TEST_STATFS
 *  defaults to 'plenty'), then any others, as file URLs so a space in a fixture
 *  path cannot split the option. */
function childEnv(box: HistoryBox, opts: SpawnOpts): NodeJS.ProcessEnv {
  const imports = [PRELOADS.statfs, ...(opts.preloads ?? [])].map((p) => `--import ${pathToFileURL(p).href}`);
  return { ...box.env, HISTORY_TEST_STATFS: 'plenty', NODE_OPTIONS: imports.join(' '), ...(opts.env ?? {}) };
}

const timed = (f: () => ReturnType<typeof spawnSync>): SpawnResult => {
  const t0 = Date.now();
  const r = f();
  return { code: r.status, signal: r.signal, stdout: String(r.stdout), stderr: String(r.stderr), ms: Date.now() - t0 };
};

/** sweep.mjs run directly, as the shim would run it after taking the lock:
 *  `node --no-warnings sweep.mjs <args> --secrets <secrets> -- <homes>`. */
export function runSweep(box: HistoryBox, args: string[] = [], opts: SpawnOpts = {}): SpawnResult {
  return timed(() => spawnSync(process.execPath,
    ['--no-warnings', SWEEP, ...args, '--secrets', ...(opts.secrets ?? []), '--', ...(opts.homes ?? box.homes)],
    { env: childEnv(box, opts), cwd: box.home, encoding: 'utf8', timeout: opts.timeoutMs ?? SPAWN_TIMEOUT_MS, killSignal: 'SIGTERM' }));
}

/** The placed shim, as the timer runs it: it takes the lock, reads the roster
 *  from ~/.ccrc/accounts.sh and execs ~/ccrc/ccd/history/sweep.mjs. */
export function runShim(box: HistoryBox, args: string[] = [], opts: SpawnOpts = {}): SpawnResult {
  return timed(() => spawnSync('bash', [path.join(box.home, '.local', 'bin', 'ccd-history-sweep'), ...args],
    { env: childEnv(box, opts), cwd: box.home, encoding: 'utf8', timeout: opts.timeoutMs ?? SPAWN_TIMEOUT_MS, killSignal: 'SIGTERM' }));
}

/** Registry fields for `id`, written the way ccd's `_reg_set` writes them
 *  (`printf '%s'`, no newline). `generation: 'unreadable'` puts a DIRECTORY at
 *  the path, which no read can open, as root or not; null writes none. */
export function plantSession(box: HistoryBox, id: string, f: {
  uuid?: string; generation?: string | null | 'unreadable'; project?: string; workdir?: string;
}): void {
  const put = (field: string, v: string): void => { fs.writeFileSync(path.join(box.reg, `${id}.${field}`), v); };
  if (f.uuid !== undefined) put('uuid', f.uuid);
  if (f.generation === 'unreadable') fs.mkdirSync(path.join(box.reg, `${id}.generation`));
  else if (typeof f.generation === 'string') put('generation', f.generation);
  if (f.project !== undefined) put('project', f.project);
  if (f.workdir !== undefined) put('workdir', f.workdir);
}

/** A transcript at `<account home>/projects/<slug>/<uuid>.jsonl`; rows as
 *  objects (one JSON line each) or as raw text. Returns its path. */
export function plantTranscript(box: HistoryBox, accountId: string, projectSlug: string, uuid: string,
  rows: object[] | string): string {
  const acctHome = box.accountHome[accountId];
  if (acctHome === undefined) throw new Error(`plantTranscript: ${accountId} is not in this box's roster`);
  const dir = path.join(acctHome, 'projects', projectSlug);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${uuid}.jsonl`);
  fs.writeFileSync(p, typeof rows === 'string' ? rows : rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
  return p;
}

/** Append one spool line to `spool/<id>.jsonl` as the hook writes it, fenced
 *  `\n<json>\n` by default (§5.1). The spool dir is made here — the hook never
 *  makes it, the sweep does. */
export function spoolLine(box: HistoryBox, id: string, line: object | string, opts: { fenced?: boolean } = {}): void {
  const dir = path.join(box.root, 'spool');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const json = typeof line === 'string' ? line : JSON.stringify(line);
  fs.appendFileSync(path.join(dir, `${id}.jsonl`), opts.fenced === false ? `${json}\n` : `\n${json}\n`);
}

/** The box's store, read-only. The caller closes it. */
export function openStoreRO(box: HistoryBox): DatabaseSync {
  return new DatabaseSync(historyPaths(box.home).dbFile, { readOnly: true });
}

/** Take a store the real code just made back to schema v1: drop every index schema v2 made (store.mjs's V2_INDEXES, derived from
 *  V2's own text, so a later index in V2 is rewound with no list to edit here) and stamp user_version 1. What is left is the store
 *  B1 shipped, so the writer's migration path (v1 -> this build's v2) runs on it for real. The caller holds no open connection to
 *  the file. fixtures/history/run-pass.mjs rewinds from the same list. */
export function rewindStoreToV1(dbFile: string): void {
  const db = new DatabaseSync(dbFile);
  try {
    for (const name of V2_INDEXES) db.exec(`DROP INDEX IF EXISTS ${name}`);   // tolerant: a mutant that never made one must fail at the migration's assertion, not here
    db.exec('PRAGMA user_version = 1');
  } finally { db.close(); }
}

/** Plant blobs rows straight into a store: `owed` are unindexed with bytes (what the FTS backfill still owes), `indexed` are
 *  fts_indexed = 1 with bytes, `pruned` are prune's tombstones (z NULL, fts_indexed = 0: they can never be owed). The shas are
 *  distinct and deterministic. Raw rows, no entries: the owed-row index and its predicate are measured over blobs alone. */
export function plantBlobs(dbFile: string, n: { owed?: number; indexed?: number; pruned?: number }): void {
  const db = new DatabaseSync(dbFile);
  try {
    const ins = db.prepare('INSERT INTO blobs (sha256, codec, z, raw_len, fts_indexed, pruned_ms) VALUES (?, ?, ?, ?, ?, ?)');
    let k = Number((db.prepare('SELECT count(*) AS n FROM blobs').get() as { n: number }).n);   // a later call continues the shas
    const sha = (): Buffer => { const b = Buffer.alloc(32); b.writeUInt32BE(k += 1, 0); return b; };
    db.exec('BEGIN');   // one commit, not one per row: the statistics pins plant thousands
    for (let i = 0; i < (n.owed ?? 0); i += 1) ins.run(sha(), 'br5', Buffer.from('z'), 1, 0, null);
    for (let i = 0; i < (n.indexed ?? 0); i += 1) ins.run(sha(), 'br5', Buffer.from('z'), 1, 1, null);
    for (let i = 0; i < (n.pruned ?? 0); i += 1) ins.run(sha(), 'br5', null, 1, 0, 1);
    db.exec('COMMIT');
  } finally { db.close(); }
}

/** The owed-row index (schema v2, D-5015) as a store holds it: its SQL from sqlite_master (null when the store has none) and how many
 *  entries it holds (null when it has none), read from ANALYZE's own count for that index (sqlite_stat1's first integer, absent for an
 *  empty index), so it is the index's population and not a filtered count over blobs. Writes sqlite_stat1 into the fixture store. */
export function owedIndexFacts(dbFile: string): { sql: string | null; entries: number | null } {
  const db = new DatabaseSync(dbFile);
  try {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'blobs_unindexed'").get() as { sql: string } | undefined;
    if (row === undefined) return { sql: null, entries: null };
    db.exec('ANALYZE blobs_unindexed');
    const st = db.prepare("SELECT stat FROM sqlite_stat1 WHERE idx = 'blobs_unindexed'").get() as { stat: string } | undefined;
    return { sql: row.sql, entries: st === undefined ? 0 : Number(st.stat.split(' ')[0]) };
  } finally { db.close(); }
}

/** Every counter row, as a record. */
export function counters(box: HistoryBox): Record<string, number> {
  const db = openStoreRO(box);
  try {
    const out: Record<string, number> = {};
    for (const r of db.prepare('SELECT name, n FROM counters ORDER BY name').all() as Array<{ name: string; n: number }>) {
      out[r.name] = Number(r.n);
    }
    return out;
  } finally {
    db.close();
  }
}

/** Every journal record of every store directory, files in name order, lines in
 *  file order; a line that does not parse is skipped (it is a torn tail). */
export function journalRecords(box: HistoryBox): Array<Record<string, unknown>> {
  const dir = path.join(box.root, 'journal');
  if (!fs.existsSync(dir)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const store of fs.readdirSync(dir).sort()) {
    for (const f of fs.readdirSync(path.join(dir, store)).filter((n) => n.endsWith('.jsonl')).sort()) {
      for (const line of fs.readFileSync(path.join(dir, store, f), 'utf8').split('\n')) {
        if (line === '') continue;
        try { out.push(JSON.parse(line) as Record<string, unknown>); } catch { /* a torn line */ }
      }
    }
  }
  return out;
}

// ── Task 24: the run-pass driver (injected deps; sweep.mjs reads no seam itself) ──────────────────
/** The test-only driver that runs sweep.mjs's runPass in a child with injected deps. */
export const PASS_DRIVER = path.join(REPO, 'server', 'test', 'fixtures', 'history', 'run-pass.mjs');
/** What the driver injects. offsetMs/stepMs: the pass clock (Date.now() + offset + k·step on the k-th read);
 *  sizeBytes: the store's measured size; extraMigrations: SQL appended to MIGRATIONS as v2, v3, …
 *  (heavy: the versions marked heavy); managedSettings: the managed-settings list the census reads. */
export interface DriverDeps {
  offsetMs?: number; stepMs?: number; sizeBytes?: number;
  /** The k-th measureSize call answers sizeBytesSeq[k]; the last value stands after that (RF5a F15). */
  sizeBytesSeq?: number[];
  /** Appended to `$HOME/<rel>` once the pass's first statfs call has answered (RF5a F19: a line landing mid-pass). */
  afterFirstStatfs?: Array<{ rel: string; text: string }>;
  /** When the first statfs call answers, `$HOME/<rel>` is copied to `$HOME/<to>` (the word `absent` when there is none): D-5016, the pass marker seen from inside the pass. */
  snapshotAtFirstStatfs?: Array<{ rel: string; to: string }>;
  /** The first statfs call never settles after it has appended afterFirstStatfs's lines (FU4 M27: a dead volume). */
  hangAfterAppend?: boolean;
  /** Once the first statfs call has answered, the first <times> (default 1) calls of fs.<fn> on a path holding <needle> throw <code> (FU4 M26). */
  throwTimesAfterFirstStatfs?: { fn: string; needle: string; code: string; times?: number };
  /** The same throw, armed before the pass starts (FU8: FR2-c's throw out of the journal half at lock take). */
  throwTimesAtStart?: { fn: string; needle: string; code: string; times?: number };
  /** The word an --op pass's store open answers instead of opening (FU4 M28), handed to sweep.mjs as deps.openStore. */
  openStoreWord?: string;
  extraMigrations?: string[]; heavy?: number[]; managedSettings?: string[];
  /** A path suffix: every fs.readSync on a descriptor that names such a file throws EIO (D-4340's read error on one admitted copy). */
  eioOnRead?: string;
  /** A text: a sha256 hash fed bytes that hold it throws, so the transcript parser crashes on the chunk that holds it (D-5061's crash arm). */
  parserCrashOn?: string;
  /** W1-B2 Task 25: the run budget's wall-clock limit in ms, handed to sweep.mjs as deps.budget.maxMs (default lib's RUN_BUDGET_MS). */
  budgetMs?: number;
  /** W1-B2 Task 25: the run budget's byte limit, handed to sweep.mjs as deps.budget.maxBytes (default lib's RUN_BUDGET_BYTES). */
  budgetBytes?: number;
  /** W1-B2 Task 25: the bytes one chunk reads before it stops at the next non-spool record, as deps.budget.chunkBytes (default lib's CHUNK_BYTES). */
  chunkBytes?: number;
}
export interface DriverResult { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }
/** NODE_OPTIONS for these preloads, each as a file URL (Task 14's childEnv rule): NODE_OPTIONS splits on
 *  whitespace, so a raw path with a space in it would split the option. */
export function preloadOptions(paths: readonly string[]): string {
  return paths.map((p) => `--import ${pathToFileURL(p).href}`).join(' ');
}
/** One pass through the driver, argv shaped as the shim shapes it (`<args> --secrets -- <homes>`), the
 *  statfs preload always first (free space is the preload's answer, never this box's disk). */
export function runDriver(box: HistoryBox, deps: DriverDeps, args: string[] = [],
  opts: { preloads?: string[]; env?: Record<string, string>; timeoutMs?: number } = {}): DriverResult {
  const preloads = opts.preloads ?? [PRELOADS.statfs];
  const r = spawnSync(process.execPath, ['--no-warnings', PASS_DRIVER, ...args, '--secrets', '--', ...box.homes], {
    cwd: box.home,
    encoding: 'utf8',
    // Task 14's cap (module-local SPAWN_TIMEOUT_MS): a hung pass fails its one case instead of wedging the
    // worker, and SIGTERM keeps a hang apart from a fault preload's planned SIGKILL.
    timeout: opts.timeoutMs ?? SPAWN_TIMEOUT_MS,
    killSignal: 'SIGTERM',
    env: {
      ...box.env, HISTORY_TEST_STATFS: 'plenty', ...opts.env,
      NODE_OPTIONS: preloadOptions(preloads),
      HISTORY_TEST_DEPS: JSON.stringify(deps),
    },
  });
  return { code: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** The transaction log the faults preload writes (HISTORY_TEST_TXLOG), read as events in order. */
export type TxEv = { kind: 'tx'; sync: number; writes: string[] } | { kind: 'journal'; bytes: number };
export function readTxlog(file: string): TxEv[] {
  const evs: TxEv[] = [];
  let cur: string[] | null = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line === 'BEGIN') cur = [];
    else if (line.startsWith('COMMIT ')) { evs.push({ kind: 'tx', sync: Number(line.slice(7)), writes: cur ?? [] }); cur = null; } else if (line.startsWith('W ')) { if (cur !== null) cur.push(line.slice(2)); } else if (line.startsWith('J ')) evs.push({ kind: 'journal', bytes: Number(line.slice(2)) });
  }
  return evs;
}
export const writes = (e: TxEv, re: RegExp): boolean => e.kind === 'tx' && e.writes.some((w) => re.test(w));

/** Every fs.openSync call `fn` makes in this process: the path as given and its flags (a string flag such as 'r' is
 *  recorded as -1). store.mjs and sweep.mjs import openSync from node:fs, so syncBuiltinESMExports reaches them. */
export function recordOpenFlags<T>(fn: () => T): { out: T; opens: Array<{ path: string; flags: number }> } {
  const realOpen = fs.openSync;
  const opens: Array<{ path: string; flags: number }> = [];
  fs.openSync = ((p: fs.PathLike, flags?: fs.OpenMode, ...rest: unknown[]) => {
    opens.push({ path: String(p), flags: typeof flags === 'number' ? flags : -1 });
    return (realOpen as (...a: unknown[]) => number)(p, flags, ...rest);
  }) as typeof fs.openSync;
  syncBuiltinESMExports();
  try {
    return { out: fn(), opens };
  } finally {
    fs.openSync = realOpen;
    syncBuiltinESMExports();
  }
}

/** Run `fn` in this process and answer the directories it fsynced, in order (review 316 F23). Wraps `fs.openSync`
 *  (fd -> path), `fs.closeSync` (forgets the fd) and `fs.fsyncSync` (records the fd's path when it is a directory), and
 *  makes the named ESM imports of the history modules see them; all three are restored in `finally`. */
export function recordDirFsyncs<T>(fn: () => T): { out: T; dirs: string[] } {
  const realOpen = fs.openSync; const realClose = fs.closeSync; const realFsync = fs.fsyncSync;
  const open = new Map<number, string>();
  const dirs: string[] = [];
  fs.openSync = ((p: fs.PathLike, ...rest: unknown[]) => {
    const fd = (realOpen as (...a: unknown[]) => number)(p, ...rest);
    open.set(fd, String(p));
    return fd;
  }) as typeof fs.openSync;
  fs.closeSync = ((fd: number) => { open.delete(fd); return realClose(fd); }) as typeof fs.closeSync;
  fs.fsyncSync = ((fd: number) => {
    const p = open.get(fd);
    if (p !== undefined && fs.fstatSync(fd).isDirectory()) dirs.push(p);
    return realFsync(fd);
  }) as typeof fs.fsyncSync;
  syncBuiltinESMExports();
  try {
    return { out: fn(), dirs };
  } finally {
    fs.openSync = realOpen; fs.closeSync = realClose; fs.fsyncSync = realFsync;
    syncBuiltinESMExports();
  }
}

// ── W1-B2 Task 10: the CLI runner, the pane fixtures, and a captured family ─────────────────────────────
/** The pane every read-verb case runs in. */
export const PANE = '%1';

/** A working tmux in <home>/.local/bin, over the poison: it records its argv in $HOME/tmux-calls and answers
 *  `cc-<id>` (or `opts.name` verbatim) as the pane's session name. Returns the env a CLI child needs. */
export function withPane(box: HistoryBox, id: string, opts: { name?: string } = {}): Record<string, string> {
  const name = opts.name ?? `cc-${id}`;
  const bin = path.join(box.home, '.local', 'bin', 'tmux');
  fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/tmux-calls"\nprintf '%s\\n' '${name}'\n`);
  fs.chmodSync(bin, 0o755);
  return { TMUX_PANE: PANE };
}

/** A tmux that never answers: `exec sleep` keeps one pid, so the CLI's SIGKILL at its deadline ends it (a child
 *  `sleep` would keep the pipe open past the kill). */
export function sleepyTmux(box: HistoryBox, seconds: number): Record<string, string> {
  const bin = path.join(box.home, '.local', 'bin', 'tmux');
  fs.writeFileSync(bin, `#!/bin/sh\nexec sleep ${String(seconds)}\n`);
  fs.chmodSync(bin, 0o755);
  return { TMUX_PANE: PANE };
}

/** `node --no-warnings cli.mjs <args>` in the box, on the statfs preload, capped like every spawn here. `json` is
 *  the last stdout line parsed, or null when it is not a JSON object. */
export function runCli(box: HistoryBox, args: string[], opts: SpawnOpts = {}): SpawnResult & { json: Record<string, unknown> | null } {
  const r = timed(() => spawnSync(process.execPath, ['--no-warnings', CLI, ...args],
    { env: childEnv(box, opts), cwd: box.home, encoding: 'utf8', timeout: opts.timeoutMs ?? SPAWN_TIMEOUT_MS, killSignal: 'SIGTERM' }));
  let json: Record<string, unknown> | null = null;
  try {
    const v: unknown = JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '');
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) json = v as Record<string, unknown>;
  } catch {
    // a human-format answer
  }
  return { ...r, json };
}

/** The project slug a seeded transcript sits under. */
export const SEED_SLUG = '-home-u-tree-demo';
export interface SeedSpec {
  id: string; project: string; uuid: string; rows: object[];
  workdir?: string; generation?: string | null; accountId?: string;
}

/** One family, captured as the box captures one:
 *  - one priming sweep first, which spends the first tick's registry scan so the epoch is the hook's 'startup' and
 *    not the scan's 'import' (B1's scanDue is true while meta scan_ms is null; registryBackfill books a planted .uuid);
 *  - its registry fields;
 *  - its transcript, under the roster's first account unless `accountId` names another;
 *  - a SessionStart(startup) line whose `reg` is the uuid; B1 drains it one tick after renaming it, so the epoch
 *    appears on the second sweep (§6.1);
 *  - sweep ticks until one leaves the transcript at end-of-file AND its epoch confirmed.
 *  A string `generation` is written to the registry and carried on the line; null writes none (a gen-less line).
 *  Throws when four ticks do not get there: a seed that stops short would make every case built on it vacuous. */
export function seedFamily(box: HistoryBox, f: SeedSpec): { uuid: string; transcript: string } {
  const prime = runSweep(box);
  if (prime.code !== 0) throw new Error(`seedFamily(${f.id}): the priming sweep exited ${String(prime.code)}: ${prime.stderr}${prime.stdout}`);
  plantSession(box, f.id, {
    uuid: f.uuid, project: f.project,
    ...(f.generation === undefined ? {} : { generation: f.generation }),
    ...(f.workdir === undefined ? {} : { workdir: f.workdir }),
  });
  const transcript = plantTranscript(box, f.accountId ?? Object.keys(box.accountHome)[0]!, SEED_SLUG, f.uuid, f.rows);
  spoolLine(box, f.id, {
    v: 1, ev: 'SessionStart', id: f.id, sid: f.uuid, src: 'startup', reg: f.uuid,
    ...(typeof f.generation === 'string' ? { gen: f.generation } : {}),
  });
  for (let i = 0; i < 4; i += 1) {
    const r = runSweep(box);
    if (r.code !== 0) throw new Error(`seedFamily(${f.id}): the sweep exited ${String(r.code)}: ${r.stderr}${r.stdout}`);
    if (atEndOfFile(box, f.uuid)) return { uuid: f.uuid, transcript };
  }
  throw new Error(`seedFamily(${f.id}): four ticks left ${f.uuid} short of end-of-file`);
}

function atEndOfFile(box: HistoryBox, uuid: string): boolean {
  const db = openStoreRO(box);
  try {
    const row = db.prepare("SELECT count(*) AS n FROM ingest_files f JOIN transcripts t ON t.transcript_pk = f.transcript_pk WHERE t.cc_session_uuid = ? AND f.source_key = '' AND f.eof_ms IS NOT NULL")
      .get(uuid) as { n: number };
    // B1 reaches the transcript's EOF through hintedUuids in the tick that RENAMES the line, but drains the line (and so
    // books the family and its epoch) only in the next: EOF alone would return before the family exists.
    const ep = db.prepare('SELECT count(*) AS n FROM epochs WHERE cc_session_uuid = ? AND confirmed_ms IS NOT NULL').get(uuid) as { n: number };
    return Number(row.n) > 0 && Number(ep.n) > 0;
  } finally {
    db.close();
  }
}

// ── W1-B2 Task 19: the operator door's stand-ins ──────────────────────────────────────────────────────
/** Replace the box's placed shim with a stand-in: it appends its argv, one line per run, to
 *  `<home>/stub-shim-argv`, prints `stderr` (when given) verbatim on stderr, then `stdout` verbatim, and exits `exit`.
 *  The CLI's relay is then measured against an answer the case chose; a case that must spawn nothing reads the argv
 *  file as absent. A box keeps its stand-in; a case that needs the real shim builds its own box. */
export function stubShim(box: HistoryBox, script: { stdout: string; exit: number; stderr?: string }): void {
  const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
  const p = path.join(box.home, '.local', 'bin', 'ccd-history-sweep');
  fs.writeFileSync(p, [
    '#!/usr/bin/env bash',
    'printf \'%s\\n\' "$*" >> "$HOME/stub-shim-argv"',
    ...(script.stderr === undefined ? [] : [`printf '%s' ${quote(script.stderr)} >&2`]),
    `printf '%s' ${quote(script.stdout)}`,
    `exit ${script.exit}`,
    '',
  ].join('\n'));
  fs.chmodSync(p, 0o755);
}

/** The placed shim replaced by a stand-in written line by line (bash), for a case a canned stdout and stderr cannot say: a shim
 *  that is killed by a signal, or that stays up until the CLI is signalled. The first line records its argv as stubShim's does. */
export function rawShim(box: HistoryBox, lines: string[]): void {
  const p = path.join(box.home, '.local', 'bin', 'ccd-history-sweep');
  fs.writeFileSync(p, ['#!/usr/bin/env bash', 'printf \'%s\\n\' "$*" >> "$HOME/stub-shim-argv"', ...lines, ''].join('\n'));
  fs.chmodSync(p, 0o755);
}

export interface LiveCli { pid: number; send: (sig: NodeJS.Signals) => void; /** What the child has written so far, before it ends. */ peek: () => { stdout: string; stderr: string }; done: Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> }
/** `node --no-warnings cli.mjs <args>` as a child the case can signal while it runs (runCli blocks until the child ends). It is
 *  capped like every spawn here, and `send` signals only this child, by the pid it was started with. */
export function startCli(box: HistoryBox, args: string[], opts: SpawnOpts = {}): LiveCli {
  const child = spawn(process.execPath, ['--no-warnings', CLI, ...args], { env: childEnv(box, opts), cwd: box.home, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d: string) => { stdout += d; });
  child.stderr.on('data', (d: string) => { stderr += d; });
  const cap = setTimeout(() => { child.kill('SIGTERM'); }, opts.timeoutMs ?? SPAWN_TIMEOUT_MS);
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve) => {
    child.on('close', (code, signal) => { clearTimeout(cap); resolve({ code, signal, stdout, stderr }); });
  });
  return { pid: child.pid ?? 0, send: (sig) => { child.kill(sig); }, peek: () => ({ stdout, stderr }), done };
}

/** Hold the shim's lock from outside, as a first concurrent pass holds it: a `flock` holder that sleeps, in its own
 *  process group, until the returned release kills it. Returns only once the lock is really taken. The holder sleeps 600 s,
 *  longer than any case budget (2.5 * HEAVY = 300 s), so the lock cannot lapse mid-case; and release signals nothing once the
 *  holder has exited or been signalled, so a process-group id the OS may have recycled for another session is never killed. */
export function holdLock(box: HistoryBox): () => void {
  const lock = historyPaths(box.home).lock;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const holder = spawn('flock', [lock, 'sleep', '600'], { stdio: 'ignore', detached: true });
  const release = (): void => {
    if (holder.exitCode !== null || holder.signalCode !== null) return;
    try { process.kill(-holder.pid!, 'SIGKILL'); } catch { /* already gone */ }
  };
  for (let i = 0; i < 200; i += 1) {
    if (spawnSync('flock', ['-n', lock, 'true']).status !== 0) return release;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  release();
  throw new Error('holdLock: the holder never took the lock');
}

// ── W1-B2 Task 25: recovery fixtures ──────────────────────────────────────────────────────────────────────────
/** The box's journal directory for its bound store: `~/.ccrc/history/journal/<store.id>`. */
export function journalDirOf(box: HistoryBox): string {
  return path.join(box.root, 'journal', fs.readFileSync(path.join(box.root, 'store.id'), 'utf8').trim());
}

/** The newest recovery step registered in the box's store (what status reads), or undefined. */
export function recoverRow(box: HistoryBox): { version: number; cursor: string | null; completed_ms: number | null } | undefined {
  const db = openStoreRO(box);
  try {
    const r = db.prepare("SELECT version, cursor, completed_ms FROM derivation_state WHERE step = 'recover' ORDER BY version DESC LIMIT 1")
      .get() as { version: number; cursor: string | null; completed_ms: number | null } | undefined;
    if (r === undefined) return undefined;
    return {
      version: Number(r.version),
      cursor: r.cursor === null ? null : String(r.cursor),
      completed_ms: r.completed_ms === null ? null : Number(r.completed_ms),
    };
  } finally {
    db.close();
  }
}

/** What `doctor --rebuild` leaves before its first recovery tick, made in-process: a fresh history.db with `storeId`
 *  and a new writer token, and inside it the ('recover', version) step, the `bind` outbox row and `bound:<version>`
 *  (store.mjs createStore with a rebuild bind, W1-B2 Task 24). The caller has already removed the lost DB. */
export function boundEmptyStore(box: HistoryBox, storeId: string, version = Date.now()): { storeId: string; writer: string; version: number } {
  const got = createStore(box.home, { storeId, bind: { kind: 'rebuild', nowMs: version } });
  return { ...got, version };
}

// ── W1-B4 Task 5: the export's segments, read back ───────────────────────────────────────────────────────────────
/** The bound store's export directory: `~/.ccrc/history/export/<store.id>` (spec §9.15 "Write"). */
export function exportDirOf(box: HistoryBox): string {
  return path.join(box.root, 'export', fs.readFileSync(path.join(box.root, 'store.id'), 'utf8').trim());
}

/** Every name in that directory, a writer's temp included, sorted; [] while the directory does not exist. */
export function segmentsOf(box: HistoryBox): string[] {
  const dir = exportDirOf(box);
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

/** One table of a segment file, opened read-only, in write order (rowid: the shared `ord` of a row table, insertion
 *  order for `blobs`). An integer comes back as a number when it is a safe integer and as a bigint otherwise (mtime_ns,
 *  struct_rank_ns); a BLOB comes back as lowercase hex, so a sha256 compares with the store's `lower(hex(…))`. */
export function segmentRows(file: string, table: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const st = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`);
    st.setReadBigInts(true);
    return (st.all() as Array<Record<string, unknown>>).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k,
      typeof v === 'bigint' && v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v)
        : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v])));
  } finally {
    db.close();
  }
}
