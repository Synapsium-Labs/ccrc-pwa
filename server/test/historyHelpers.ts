// server/test/historyHelpers.ts — the fixture box every ccrc-history test that
// spawns the sweep, the shim or the CLI builds on (spec 2026-10-05 §10.1).
// No describe here: importing a .test.ts registers its suite twice, so shared
// fixtures live in a helper (the *Fixtures.ts / *Helpers.ts convention).
//
// ISOLATION, in three layers:
//  - HOME is a mkTmp fixture; the shim and the sweep read only $HOME paths.
//  - the env is SCRUBBED of the operator's own Claude Code and tmux state
//    (CLAUDECODE, CLAUDE_CONFIG_DIR, TMUX, TMUX_PANE, every CCRC_RECALL_*),
//    which a spawn would otherwise inherit from the session running the suite;
//  - it is ccrcContainedEnv's (wave 9): gh, tmux, ssh, scp, curl and the
//    service managers poisoned in <home>/.local/bin, first on PATH, the user
//    bus pointed under HOME — and assertNoRealTool proves it per box.
// Node children run on process.execPath, so the pinned-Node CI leg really runs
// ccd/history on that Node: the shim's own `node` resolves to its directory,
// which is put on PATH right behind the poisons.
import { beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { mkTmp } from './tmpHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { seedAccountsSh } from './ccdWsHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { assertNoRealTool } from './containedTools.js';
import { parseRoster } from '../../shared/roster.js';
import { historyPaths } from '../../ccd/history/lib.mjs';

export const REPO = path.resolve(__dirname, '..', '..');
export const SWEEP = path.join(REPO, 'ccd', 'history', 'sweep.mjs');
export const CLI = path.join(REPO, 'ccd', 'history', 'cli.mjs');
export const SHIM = path.join(REPO, 'ccd', 'ccd-history-sweep');
export const PRELOADS = {
  statfs: path.join(__dirname, 'fixtures', 'history', 'preload-statfs.mjs'),
  faults: path.join(__dirname, 'fixtures', 'history', 'preload-faults.mjs'),
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
    if (k === 'CLAUDECODE' || k === 'CLAUDE_CONFIG_DIR' || k === 'TMUX' || k === 'TMUX_PANE'
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
  extraMigrations?: string[]; heavy?: number[]; managedSettings?: string[];
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
