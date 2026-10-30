// D-7410, D-7558 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB8; spec §2.4, §2.5). L5: the test box's
// CLIENT, the agent package's third entry point (compiled to `agent/dist/agent/src/testbox/client.js`). `ccd/ccrc-test`
// runs it with the fleet host's `node` once the switch marker is present and `CCRC_TESTBOX_URL` is set; `ccd/testbox-parity`
// runs it directly, so its remote leg runs with the switch off. Nothing the fleet agent's entry point loads imports it
// (`agent/test/testbox-imports.test.ts`), and it imports nothing of the fleet agent's.
//
//   node client.js run [--explicit] [--verdict <file>] -- <command> [<arg>...]
//
// WHAT IT DOES, in `shared/testbox.ts#TESTBOX_FALLBACK`'s order (the rows the wrapper has already checked, the switch,
// are not repeated): it reads the fleet host's test box settings through ccrc's one reader (`ccd/ccrc-test
// --testbox-knobs host`, a fixed argv, as `config.ts` reads the box's), opens the service's WebSocket and sends the
// `hello` with the token, which the service answers with its status (D-7501); then the repository's row, `down`, the
// version row (the fleet host's six tools, measured with the session's PATH, spec §2.10), the protocol and the queue;
// then the snapshot and its push (`ccd/testbox-snap`, TB3), the budget (`budget.ts`), the parity-reference line, and the
// submission on the same connection, whose `run.log` frames go to stdout and stderr as they come and whose
// `run.summary` ends the run. A submission the service will not run closes the connection with code 1008 and the
// reason (D-7501): `this repository is not set up there …` is that row, `… runs locally` and an unlisted package are
// the command row, anything else is `unreachable (refused: <reason>)`. A summary with `prepareFailed` is that row.
//
// THE VERDICT. Its exit status: the run's own for a run on the box, 3 for "fall back" with the reason (in TESTBOX_FALLBACK's
// words) on its last stderr line, and 75 for a refusal, nothing run (`TESTBOX_REFUSAL_EXIT`, spec §2.5). With
// `--verdict <file>` it also writes one tab-separated line there, `remote<TAB><exit>`, `fallback<TAB><id><TAB><line>` or
// `refused<TAB><id><TAB><line>`, so the wrapper never reads a run that exited 3 as a fallback.
//
// THE DROP (spec §2.4 "The box drops mid-run"). A connection that ends before the summary, other than a refusal, is a
// drop: the client tries to reconnect within `CCRC_TESTBOX_RECONNECT_DEADLINE`. TESTBOX_PROTO 1 has no frame that
// re-attaches a connection to a run (D-7558), so a reconnected link cannot resume the stream either: the run is lost
// either way. Then it prints `test box: lost the run`, sends one `run.cancel` within `CCRC_TESTBOX_STATUS_DEADLINE`, and
// takes `CCRC_TESTBOX_LOST_RUN`'s arm: `local` falls back; `fail` refuses with 75 when no output had come (nothing ran),
// and exits 1 when some had (the run started and its answer was lost).
//
// THE QUEUE WAIT (spec §2.8). A submission whose first frame has not come within `CCRC_TESTBOX_QUEUE_WAIT` is cancelled
// and falls back as `waited <n> min`: proto 1 carries no position or start frame (D-7501's (5)), so the prepare counts
// as waiting.
//
// SIGNALS. SIGINT, SIGTERM and SIGHUP send `run.cancel` for a submitted run (on its link, or one new link within the
// status deadline), and the client exits 128 plus the signal's number; before a submission nothing has started.
//
// Every process it starts goes through the service's one bounded spawner (`exec.ts#boundedExec`, D-7501), so the
// spawner audit gains no row. Every threshold is a setting; no number here is compared with a test box quantity.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readTestboxFrame, TESTBOX_FALLBACK, TESTBOX_PROTO, TESTBOX_REFUSAL_EXIT, TESTBOX_TOOLS, versionRowDiffers,
  type RunCancel, type RunSubmit, type RunSummary, type StatusAnswer, type TestboxFallbackId, type TestboxFrame,
  type TestboxRef, type TestboxToolVersions,
} from '../../../shared/testbox.js';
import { estimate, minutes, readDurations, workerCount, type DurationsRead } from './budget.js';
import { absPath, durationMs, knobEnv, parseKnobLines, sizeBytes, count, type KnobLine } from './config.js';
import { boundedExec, SHORT_BOUND_MS } from './exec.js';

/** The exit status that tells the wrapper "fall back"; the reason is the last stderr line. */
export const FALLBACK_EXIT = 3;
/** A `fail` arm whose run had started and was lost: a red run, never the refusal status. */
export const LOST_STARTED_EXIT = 1;
/** The shell's base for a signal's exit status. */
const SIGNAL_EXIT_BASE = 128;
/** The WebSocket close code of a submission the service refuses (`main.ts#POLICY_CLOSE_CODE`). */
const POLICY_CLOSE_CODE = 1008;
/** How long a reconnect attempt waits before the next, inside the reconnect deadline. */
const RECONNECT_RETRY_MS = 250;
/** Milliseconds in a minute, for the `waited <n> min` reason. */
const MINUTE_MS = 60_000;
const SECOND_MS = 1000;

// ---------------------------------------------------------------------------------------------------------------
// The fallback rows' words.
// ---------------------------------------------------------------------------------------------------------------

const rowOf = (id: TestboxFallbackId) => {
  const r = TESTBOX_FALLBACK.find((x) => x.id === id);
  if (r === undefined) throw new Error(`no fallback row ${id}`);
  return r;
};
// eslint-disable-next-line no-control-regex
const oneLine = (s: string): string => s.replace(/[\u0000-\u001f\u007f]/g, '?');
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A row's text with its `<…>` holes filled in order, on one line. */
export function fill(id: TestboxFallbackId, ...holes: readonly string[]): string {
  let i = 0;
  return oneLine(rowOf(id).text.replace(/<[^>]+>/g, (h) => holes[i++] ?? h));
}

/** The row a `test box: …` line is, by its text with the holes as wildcards; `null` for none. */
export function idOfLine(line: string): TestboxFallbackId | null {
  for (const r of TESTBOX_FALLBACK) {
    if (new RegExp(`^${r.text.split(/<[^>]+>/).map(escape).join('.+')}$`).test(line)) return r.id;
  }
  return null;
}

/** How the client ended. A fallback's or a refusal's `text` is its `test box: …` line, printed first; `after` holds the
 *  lines printed after it (the CI command of a set over the budget). */
export type Verdict =
  | { readonly t: 'remote'; readonly exit: number }
  | { readonly t: 'fallback'; readonly id: TestboxFallbackId; readonly text: string; readonly after?: readonly string[] }
  | { readonly t: 'refused'; readonly id: TestboxFallbackId; readonly text: string; readonly after?: readonly string[] };

/** A decision that ends the client early: thrown by the checks, caught once by `run`. */
class Decided extends Error {
  constructor(readonly verdict: Verdict) { super(verdict.t); }
}
const fall = (id: TestboxFallbackId, ...holes: string[]): never => { throw new Decided({ t: 'fallback', id, text: fill(id, ...holes) }); };

/** A submission the service refused, by its close reason, to its row. */
export function refusalRow(reason: string, argv0: string): Verdict {
  if (/^this repository is not set up there/.test(reason)) return { t: 'fallback', id: 'not-set-up', text: fill('not-set-up') };
  if (/ runs locally$/.test(reason) || /^package .* is not in .*'s table$/.test(reason)) {
    return { t: 'fallback', id: 'runs-locally', text: fill('runs-locally', argv0) };
  }
  return { t: 'fallback', id: 'unreachable', text: fill('unreachable', `refused: ${reason}`) };
}

// ---------------------------------------------------------------------------------------------------------------
// The parity reference (spec §2.4): a package's installed tree against its lockfile, two files, no npm.
// ---------------------------------------------------------------------------------------------------------------

type LockEntry = { name?: unknown; version?: unknown; integrity?: unknown; optional?: unknown };
const entries = (doc: unknown): Record<string, LockEntry> | null => {
  const p = (doc as { packages?: unknown } | null)?.packages;
  return typeof p === 'object' && p !== null && !Array.isArray(p) ? (p as Record<string, LockEntry>) : null;
};

/** The first entry, in key order, where `node_modules/.package-lock.json` differs from `package-lock.json` in name,
 *  version or integrity, or one is missing from the other; `null` when they agree or the lockfile has no `packages`.
 *  An optional entry the install left out (another platform's binary) is not a difference. */
export function depsDiffer(lock: unknown, hidden: unknown): string | null {
  const want = entries(lock);
  if (want === null) return null;
  const have = entries(hidden);
  if (have === null) return 'no node_modules';
  for (const k of Object.keys(want).sort()) {
    if (k === '') continue;
    const w = want[k]!;
    const h = have[k];
    if (h === undefined) { if (w.optional === true) continue; return k; }
    if (w.name !== h.name || w.version !== h.version || w.integrity !== h.integrity) return k;
  }
  for (const k of Object.keys(have).sort()) if (k !== '' && want[k] === undefined) return k;
  return null;
}

const readJson = (file: string): unknown => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

/** The parity-reference line, or `null`: the run's package always, and every other package with a lockfile and an
 *  installed tree, in name order. */
export function depsLine(top: string, pkg: string): string | null {
  let names: string[] = [];
  try { names = readdirSync(top).filter((n) => !n.startsWith('.') && existsSync(path.join(top, n, 'package-lock.json'))).sort(); } catch { /* none */ }
  for (const n of names) {
    const nm = path.join(top, n, 'node_modules');
    if (n !== pkg && !existsSync(nm)) continue;
    const d = depsDiffer(readJson(path.join(top, n, 'package-lock.json')), existsSync(nm) ? readJson(path.join(nm, '.package-lock.json')) : null);
    if (d !== null) return oneLine(`local deps differ from lockfile (${n}: ${d})`);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// The link: one WebSocket to the service, its hello answered with the status.
// ---------------------------------------------------------------------------------------------------------------

type Msg = { readonly t: 'frame'; readonly frame: TestboxFrame } | { readonly t: 'bad'; readonly reason: string } | { readonly t: 'close'; readonly code: number; readonly reason: string };

class Link {
  private readonly inbox: Msg[] = [];
  private waiter: (() => void) | null = null;
  closed = false;
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      const text = typeof e.data === 'string' ? e.data : Buffer.from(e.data as ArrayBuffer).toString('utf8');
      const r = readTestboxFrame(text);
      this.push(r.ok ? { t: 'frame', frame: r.value } : { t: 'bad', reason: r.reason });
    });
    ws.addEventListener('close', (e) => { this.closed = true; this.push({ t: 'close', code: e.code, reason: e.reason }); });
  }

  private push(m: Msg): void { this.inbox.push(m); const w = this.waiter; this.waiter = null; w?.(); }

  /** The next message, or `null` when `ms` passes first. */
  async next(ms: number | null): Promise<Msg | null> {
    while (this.inbox.length === 0) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timedOut = await new Promise<boolean>((resolve) => {
        this.waiter = () => resolve(false);
        if (ms !== null) timer = setTimeout(() => resolve(true), Math.max(0, ms));
      });
      if (timer !== null) clearTimeout(timer);
      this.waiter = null;
      if (timedOut && this.inbox.length === 0) return null;
    }
    return this.inbox.shift()!;
  }

  send(frame: RunSubmit | RunCancel): boolean {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return false;
    this.ws.send(JSON.stringify(frame));
    return true;
  }

  close(): void { try { this.ws.close(); } catch { /* closed */ } }

  /** Open, send the hello, and read the status answer, all within `ms`. */
  static async open(url: string, token: string, ms: number): Promise<{ link: Link; status: StatusAnswer }> {
    const t0 = Date.now();
    const left = (): number => ms - (Date.now() - t0);
    let ws: WebSocket;
    try { ws = new WebSocket(wsUrl(url)); } catch (e) { throw new Error(`bad URL: ${e instanceof Error ? e.message : String(e)}`); }
    const link = new Link(ws);
    const opened = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), Math.max(0, ms));
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(true); });
      ws.addEventListener('close', () => { clearTimeout(timer); resolve(false); });
    });
    if (!opened) {
      link.close();
      const m = link.inbox.find((x): x is Extract<Msg, { t: 'close' }> => x.t === 'close');
      throw new Error(m === undefined ? `no answer within ${seconds(ms)} s` : `the connection failed (code ${m.code})`);
    }
    ws.send(JSON.stringify({ t: 'hello', token }));
    const m = await link.next(left());
    if (m === null) { link.close(); throw new Error(`no status within ${seconds(ms)} s`); }
    if (m.t === 'close') throw new Error(m.reason === '' ? `the connection closed (code ${m.code})` : `closed: ${m.reason}`);
    if (m.t === 'bad') { link.close(); throw new Error(`a status the client cannot read (${m.reason})`); }
    if (m.frame.t !== 'status') { link.close(); throw new Error(`a ${m.frame.t} frame in place of the status`); }
    return { link, status: m.frame };
  }
}

const wsUrl = (u: string): string => u.replace(/^http(s?):\/\//, 'ws$1://');
const seconds = (ms: number): string => String(Math.round((ms / SECOND_MS) * 10) / 10);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// ---------------------------------------------------------------------------------------------------------------
// The settings, the tools, the git facts.
// ---------------------------------------------------------------------------------------------------------------

export interface HostSettings {
  readonly url: string;
  readonly tokenFile: string;
  readonly gitUrlBase: string;
  readonly gitKey: string;
  readonly untrackedFileMaxBytes: number;
  readonly snapshotMaxBytes: number;
  readonly statusDeadlineMs: number;
  readonly reconnectDeadlineMs: number;
  readonly lostRun: 'local' | 'fail';
  readonly queueLimit: number;
  readonly queueWaitMs: number;
  readonly budgetMs: number;
  readonly denyGlobs: string;
  readonly times: string;
}

/** The host table's lines to the settings this client uses (the printer has validated every value already). */
export function hostSettings(lines: ReadonlyMap<string, KnobLine>, home: string): HostSettings {
  const v = (k: string): string => {
    const l = lines.get(`CCRC_TESTBOX_${k}`);
    if (l === undefined) throw new Error(`the settings printer gave no CCRC_TESTBOX_${k}`);
    return l.value;
  };
  return {
    url: v('URL'), tokenFile: absPath('CCRC_TESTBOX_TOKEN_FILE', v('TOKEN_FILE'), home), gitUrlBase: v('GIT_URL_BASE'),
    gitKey: absPath('CCRC_TESTBOX_GIT_KEY', v('GIT_KEY'), home),
    untrackedFileMaxBytes: sizeBytes('CCRC_TESTBOX_UNTRACKED_FILE_MAX', v('UNTRACKED_FILE_MAX')),
    snapshotMaxBytes: sizeBytes('CCRC_TESTBOX_SNAPSHOT_MAX', v('SNAPSHOT_MAX')),
    statusDeadlineMs: durationMs('CCRC_TESTBOX_STATUS_DEADLINE', v('STATUS_DEADLINE')),
    reconnectDeadlineMs: durationMs('CCRC_TESTBOX_RECONNECT_DEADLINE', v('RECONNECT_DEADLINE')),
    lostRun: v('LOST_RUN') === 'fail' ? 'fail' : 'local', queueLimit: count('CCRC_TESTBOX_QUEUE_LIMIT', v('QUEUE_LIMIT')),
    queueWaitMs: durationMs('CCRC_TESTBOX_QUEUE_WAIT', v('QUEUE_WAIT')), budgetMs: durationMs('CCRC_TESTBOX_BUDGET', v('BUDGET')),
    denyGlobs: v('DENY_GLOBS'), times: absPath('CCRC_TESTBOX_TIMES', v('TIMES'), home),
  };
}

/** The process environment as strings only. */
const sessionEnv = (): Record<string, string> =>
  Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'));

/** The five git location variables dropped (a polluted GIT_DIR has written into the real repository before). */
const gitEnv = (): Record<string, string> => {
  const e = sessionEnv();
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete e[k];
  return e;
};

const VERSION_WORD = /\d+(?:\.\d+)*[a-z]?/g;
/** A version out of a tool's `--version` line: the first version-shaped word, Chrome's last. */
export function versionOf(tool: string, out: string): string {
  const words = (out.split('\n')[0] ?? '').match(VERSION_WORD) ?? [];
  const w = tool === 'chrome' ? words[words.length - 1] : words[0];
  return w ?? 'unknown';
}

/** The fleet host's six versions, as spec §2.10 measures them, with the session's PATH. */
async function measureTools(): Promise<TestboxToolVersions> {
  const run = boundedExec(sessionEnv(), SHORT_BOUND_MS);
  const probe = async (tool: string, file: string, args: string[]): Promise<string> => {
    const r = await run(file, args);
    return r.status === 0 ? versionOf(tool, `${r.stdout}\n${r.stderr}`.trim()) : 'unknown';
  };
  const chrome = process.env['CCRC_CHROME'] ?? '';
  const out: Record<string, string> = {
    node: process.versions.node,
    npm: await probe('npm', 'npm', ['--version']),
    tmux: await probe('tmux', 'tmux', ['-V']),
    git: await probe('git', 'git', ['--version']),
    python3: await probe('python3', 'python3', ['--version']),
    chrome: chrome === '' ? 'unknown' : await probe('chrome', chrome, ['--version']),
  };
  return Object.fromEntries(TESTBOX_TOOLS.map((t) => [t, out[t]!])) as unknown as TestboxToolVersions;
}

interface Where { readonly top: string; readonly pkg: string; readonly repository: string }

/** The repository root, the package (the first path segment of the cwd under it, D-7417) and the repository's name:
 *  `origin`'s last path segment without `.git`, lower-cased, else the root's own name. */
async function whereAmI(): Promise<Where> {
  const git = boundedExec(gitEnv(), SHORT_BOUND_MS);
  const r = await git('git', ['rev-parse', '--show-toplevel', '--show-prefix']);
  if (r.status !== 0) return fall('unreachable', 'not inside a git work tree');
  const [top = '', prefix = ''] = r.stdout.split('\n');
  const o = await git('git', ['remote', 'get-url', 'origin']);
  const url = o.status === 0 ? o.stdout.trim() : '';
  const seg = (url === '' ? top : url).replace(/\/+$/, '').split(/[/:]/).pop() ?? '';
  return { top, pkg: prefix.split('/')[0] ?? '', repository: seg.replace(/\.git$/, '').toLowerCase() };
}

/** The package's test files on disk, repo-relative, for a wide run with no durations. */
function packageTestFiles(top: string, pkg: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    let names: string[];
    try { names = readdirSync(path.join(top, rel)); } catch { return; }
    for (const n of names) {
      if (n.startsWith('.') || n === 'node_modules' || n.startsWith('dist')) continue;
      const r = `${rel}/${n}`;
      let st;
      try { st = statSync(path.join(top, r)); } catch { continue; }
      if (st.isDirectory()) walk(r);
      else if (/\.(test|spec)\.[^/]+$/.test(n)) out.push(r);
    }
  };
  walk(pkg);
  return out;
}

/** The count a local run of this command gets: its own flag, else `VITEST_MAX_WORKERS`, else vitest's default. */
function localWorkers(argv: readonly string[]): number {
  const n = workerCount(argv, process.env);
  const explicit = argv.some((w) => w.startsWith('--maxWorkers')) || /^[1-9][0-9]*$/.test(process.env['VITEST_MAX_WORKERS'] ?? '');
  return explicit ? n : Math.max(1, os.availableParallelism() - 1);
}

// ---------------------------------------------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------------------------------------------

interface Ctx {
  readonly s: HostSettings;
  readonly token: string;
  readonly explicit: boolean;
  readonly argv: readonly string[];
  link: Link | null;
  runId: string | null;
  started: boolean;
  done: boolean;
}

/** The release tree this file runs from: `<release>/agent/dist/agent/src/testbox/client.js`. */
export function releaseOf(file: string): string {
  return path.resolve(path.dirname(file), '..', '..', '..', '..', '..');
}

async function readSettings(release: string): Promise<HostSettings> {
  const home = os.homedir();
  const r = await boundedExec(knobEnv(home, process.env['PATH'] ?? ''), SHORT_BOUND_MS)(path.join(release, 'ccd', 'ccrc-test'), ['--testbox-knobs', 'host']);
  if (r.stderr !== '') process.stderr.write(r.stderr);
  if (r.status !== 0) return fall('unreachable', `settings: exit ${r.status}`);
  try { return hostSettings(parseKnobLines(r.stdout), home); } catch (e) { return fall('unreachable', `settings: ${e instanceof Error ? e.message : String(e)}`); }
}

/** The status checks (spec §2.4 rows 2 to 7), on the status answer. */
async function checkStatus(c: Ctx, st: StatusAnswer, w: Where): Promise<string> {
  const row = st.repositories.find((r) => r.name === w.repository);
  if (row === undefined) return fall('not-set-up');
  if (st.state === 'down') return fall('down', st.reason ?? 'no reason given');
  const diff = versionRowDiffers(await measureTools(), st.tools);
  if (diff !== null) return fall('version-differs', `${diff.tool} ${diff.local} vs ${diff.remote}`);
  if (st.proto !== TESTBOX_PROTO) return fall('protocol-differs', String(TESTBOX_PROTO), String(st.proto));
  if (st.queueDepth >= c.s.queueLimit) return fall('queue-full', String(st.queueDepth));
  return row.mirrorPath;
}

interface Snap { readonly runId: string; readonly branch: string | null; readonly refs: TestboxRef[]; readonly outputs: string[]; readonly forward: Record<string, string> }

/** The snapshot and its push (`ccd/testbox-snap`); its one `test box: …` line on a refusal is that row. */
async function snapshot(c: Ctx, release: string, mirrorPath: string): Promise<Snap> {
  if (c.s.gitUrlBase === '') return fall('unreachable', 'CCRC_TESTBOX_GIT_URL_BASE is not set');
  const args = [path.join(release, 'ccd', 'testbox-snap'), '--git-url-base', c.s.gitUrlBase, '--mirror-path', mirrorPath,
    '--untracked-file-max', String(c.s.untrackedFileMaxBytes), '--snapshot-max', String(c.s.snapshotMaxBytes), '--deny-globs', c.s.denyGlobs];
  if (existsSync(c.s.gitKey)) args.push('--ssh-key', c.s.gitKey);
  // The push is the run's first wait: it is bounded by the queue wait, not the short bound.
  const r = await boundedExec(gitEnv(), c.s.queueWaitMs)('bash', args);
  const last = r.stdout.split('\n').filter((l) => l !== '').pop() ?? '';
  if (r.status !== 0) {
    const id = idOfLine(last);
    if (id !== null) throw new Decided({ t: 'fallback', id, text: oneLine(last) });
    return fall('unreachable', `snapshot: exit ${r.status}${r.stderr.trim() === '' ? '' : `: ${r.stderr.trim().split('\n')[0]}`}`);
  }
  try { return JSON.parse(last) as Snap; } catch { return fall('unreachable', 'snapshot: no frame fields'); }
}

/** The CI command for a set over the budget (spec §2.5). */
const ciCommand = (branch: string | null): string => `gh workflow run ci.yml --ref ${branch ?? '<branch>'} -f mode=full`;

async function sendCancel(c: Ctx): Promise<void> {
  if (c.runId === null) return;
  const frame: RunCancel = { t: 'run.cancel', runId: c.runId };
  if (c.link !== null && c.link.send(frame)) return;
  try {
    const { link } = await Link.open(c.s.url, c.token, c.s.statusDeadlineMs);
    link.send(frame);
    link.close();
  } catch { /* one attempt (spec §2.4) */ }
}

/** The drop: reconnect within the deadline, then the run is lost (see the header). */
async function lost(c: Ctx): Promise<Verdict> {
  const until = Date.now() + c.s.reconnectDeadlineMs;
  c.link = null;
  while (Date.now() < until) {
    try { c.link = (await Link.open(c.s.url, c.token, Math.min(c.s.statusDeadlineMs, until - Date.now()))).link; break; } catch { await sleep(Math.min(RECONNECT_RETRY_MS, until - Date.now())); }
  }
  const text = fill('lost-run');
  await sendCancel(c);
  c.link?.close();
  if (c.s.lostRun === 'local') return { t: 'fallback', id: 'lost-run', text };
  if (!c.started) return { t: 'refused', id: 'lost-run', text };
  process.stderr.write(`${text}\n`);
  return { t: 'remote', exit: LOST_STARTED_EXIT };
}

const writeOut = (stream: NodeJS.WriteStream, bytes: Buffer): Promise<void> => new Promise((r) => { stream.write(bytes, () => r()); });

/** The summary lines (spec §2.5), the last `ran on: test box`. */
export function summaryLines(s: RunSummary, deps: string | null, note: string | null): string[] {
  const out = [`ccrc test: workers: ${s.workers}${s.localDefault === null ? '' : `, local default: ${s.localDefault}`}`];
  out.push(`ccrc test: wall ${seconds(s.wallMs)} s, prepare ${seconds(s.prepareMs)} s${s.builtOnBox.length > 0 ? `, built on the box: ${s.builtOnBox.join(' ')}` : ''}`);
  if (s.failed.files.length > 0) out.push(`ccrc test: failed files: ${s.failed.files.join(' ')}`);
  if (s.report !== 'ok') out.push(`ccrc test: no report (${s.report}), so the failed files are not known`);
  if (deps !== null) out.push(deps);
  if (note !== null) out.push(note);
  out.push('ran on: test box');
  return out.map(oneLine);
}

/** Submit, stream, summarise. */
async function stream(c: Ctx, submit: RunSubmit, deps: string | null, note: string | null): Promise<Verdict> {
  const link = c.link!;
  link.send(submit);
  c.runId = submit.runId;
  const waitUntil = Date.now() + c.s.queueWaitMs;
  for (;;) {
    const m = await link.next(c.started ? null : waitUntil - Date.now());
    if (m === null) {
      await sendCancel(c);
      link.close();
      return { t: 'fallback', id: 'waited', text: fill('waited', String(Math.ceil(c.s.queueWaitMs / MINUTE_MS))) };
    }
    if (m.t === 'bad') continue;
    if (m.t === 'close') {
      if (m.code === POLICY_CLOSE_CODE && !c.started) return refusalRow(m.reason, c.argv[0] ?? '');
      return lost(c);
    }
    const f = m.frame;
    if (f.t === 'run.log' && f.runId === submit.runId) {
      c.started = true;
      await writeOut(f.stream === 'stdout' ? process.stdout : process.stderr, Buffer.from(f.bytes, 'base64'));
    } else if (f.t === 'run.summary' && f.runId === submit.runId) {
      c.done = true;
      link.close();
      if (f.prepareFailed !== null) {
        const id = idOfLine(f.prepareFailed.text) ?? f.prepareFailed.id;
        return { t: 'fallback', id, text: oneLine(f.prepareFailed.text) };
      }
      process.stderr.write(`${summaryLines(f, deps, note).join('\n')}\n`);
      return { t: 'remote', exit: f.exit };
    }
  }
}

async function remote(c0: { explicit: boolean; argv: readonly string[] }, release: string, onCtx: (c: Ctx) => void): Promise<Verdict> {
  const s = await readSettings(release);
  if (s.url === '') return fall('unreachable', 'CCRC_TESTBOX_URL is not set');
  let token: string;
  try { token = readFileSync(s.tokenFile, 'utf8').trim(); } catch { return fall('unreachable', `no token file at ${s.tokenFile.replace(os.homedir(), '~')}`); }
  if (token === '') return fall('unreachable', 'the token file is empty');
  const c: Ctx = { s, token, explicit: c0.explicit, argv: c0.argv, link: null, runId: null, started: false, done: false };
  onCtx(c);
  let opened;
  try { opened = await Link.open(s.url, token, s.statusDeadlineMs); } catch (e) { return fall('unreachable', e instanceof Error ? e.message : String(e)); }
  c.link = opened.link;
  try {
    const w = await whereAmI();
    const mirrorPath = await checkStatus(c, opened.status, w);
    if (w.pkg === '') return fall('runs-locally', c.argv[0] ?? '');
    const snap = await snapshot(c, release, mirrorPath);
    const times = (() => { try { return readFileSync(s.times, 'utf8'); } catch { return null; } })();
    const durations: DurationsRead = readDurations(times, `no file at ${s.times.replace(os.homedir(), '~')}`, w.repository);
    const est = estimate({ argv: c.argv, pkg: w.pkg, durations, workers: workerCount(c.argv, process.env), packageTestFiles: () => packageTestFiles(w.top, w.pkg) });
    if (est.ms > s.budgetMs) {
      const text = fill('over-budget', `estimate ${minutes(est.ms)} over ${est.files} files, budget ${minutes(s.budgetMs)}`);
      const after = [`ccrc test: the full suite runs on CI: ${ciCommand(snap.branch)}`];
      return c.explicit ? { t: 'refused', id: 'over-budget', text, after } : { t: 'fallback', id: 'over-budget', text, after };
    }
    const deps = depsLine(w.top, w.pkg);
    if (deps !== null) process.stderr.write(`${deps}\n`);
    const session = process.env['CCRC_SESSION_GENERATION'] || (process.env['TMUX_PANE'] ? `pane-${process.env['TMUX_PANE'].replace(/[^0-9]/g, '')}` : `pid-${process.ppid}`);
    const submit: RunSubmit = {
      t: 'run.submit', runId: snap.runId, repository: w.repository, package: w.pkg, branch: snap.branch, refs: snap.refs, outputs: snap.outputs,
      argv: [...c.argv], forward: snap.forward, ci: (process.env['CI'] ?? '') !== '', workers: localWorkers(c.argv), session,
    };
    return await stream(c, submit, deps, est.note);
  } finally {
    if (!c.started && !c.done && c.runId === null) c.link?.close();
  }
}

function writeVerdict(file: string | null, v: Verdict): void {
  if (file === null) return;
  const line = v.t === 'remote' ? `remote\t${v.exit}\n` : `${v.t}\t${v.id}\t${v.text}\n`;
  try { writeFileSync(file, line); } catch { /* the exit status still says it */ }
}

const exitOf = (v: Verdict): number => (v.t === 'remote' ? v.exit : v.t === 'refused' ? TESTBOX_REFUSAL_EXIT : FALLBACK_EXIT);

export async function main(args: readonly string[]): Promise<number> {
  let explicit = false;
  let verdictFile: string | null = null;
  let i = 0;
  if (args[i] !== 'run') { process.stderr.write('usage: client.js run [--explicit] [--verdict <file>] -- <command> [<arg>...]\n'); return 2; }
  for (i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--') { i++; break; }
    if (a === '--explicit') explicit = true;
    else if (a === '--verdict' && args[i + 1] !== undefined) verdictFile = args[++i]!;
    else { process.stderr.write(`client.js: unknown argument ${a}\n`); return 2; }
  }
  const argv = args.slice(i);
  if (argv.length === 0) { process.stderr.write('client.js: missing command\n'); return 2; }
  const release = releaseOf(fileURLToPath(import.meta.url));
  let ctx: Ctx | null = null;
  let settled: number | null = null;
  /** The one verdict: the first decided (a signal's, or the run's) is the one written and exited with. */
  const end = (v: Verdict): number => {
    if (settled !== null) return settled;
    settled = exitOf(v);
    if (v.t !== 'remote') process.stderr.write([v.text, ...(v.after ?? [])].map((l) => `${l}\n`).join(''));
    writeVerdict(verdictFile, v);
    return settled;
  };
  const onSignal = (sig: NodeJS.Signals): void => {
    const code = SIGNAL_EXIT_BASE + (os.constants.signals[sig] ?? 0);
    if (settled !== null) return;
    void (async () => {
      if (ctx !== null && ctx.runId !== null && !ctx.done) await sendCancel(ctx);
      ctx?.link?.close();
      process.exitCode = end({ t: 'remote', exit: code });
      setTimeout(() => process.exit(process.exitCode ?? code), SECOND_MS).unref();
    })();
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, onSignal);
  let v: Verdict;
  try {
    v = await remote({ explicit, argv }, release, (c) => { ctx = c; });
  } catch (e) {
    v = e instanceof Decided ? e.verdict : { t: 'fallback', id: 'unreachable', text: fill('unreachable', `client: ${e instanceof Error ? e.message : String(e)}`) };
  }
  return end(v);
}

/** Run as a program (not imported): its argv path and this module are one file, compared by real path. */
const invoked = ((): boolean => {
  try { return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (invoked) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
    // An open handle (a link closing) must not hold the exit: the answer is written.
    setTimeout(() => process.exit(code), SECOND_MS).unref();
  }, (e: unknown) => {
    process.stderr.write(`client.js: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = FALLBACK_EXIT;
  });
}
