// D-7406, D-7451, D-7501 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4). L3: the test service's ONE
// read of its settings, once, at start. It runs `<release>/ccd/ccrc-test --testbox-knobs box` (a fixed argv; TB1's
// flag, which prints `_testbox_knobs box`'s validated lines) and parses its `KEY<US>default<US>value<US>from` lines.
// It never reads `process.env` for a test box key and never opens a `ccrc.env` itself: the box's one config file is
// read by box mode alone (D-7451), and a change to it takes effect when the service restarts (the installer's re-run
// restarts it, TB7). Every value the service uses comes from these lines, so this file holds no default and no
// threshold; the units get theirs only through `specs/<k>` (`spec.ts`).
//
// D-7501: spec §4 names no box key for the service's own listen address and token file, or for the longest a unit
// may run; this reader takes them as three more box keys, `CCRC_TESTBOX_LISTEN` (`host:port`, the tailnet address),
// `CCRC_TESTBOX_SERVICE_TOKEN_FILE` and `CCRC_TESTBOX_UNIT_MAX`, which TB1's printer adds beside the rest.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseRepoRow, type TestboxRepoRow } from '../../../shared/testbox.js';
import { boundedExec, SERVICE_PATH, SHORT_BOUND_MS } from './exec.js';

/** The unit separator between a line's four fields (`ccd/ccrc-test#_tload`'s reading). */
export const KNOB_FIELD_SEP = '\x1f';

export interface KnobLine { readonly key: string; readonly def: string; readonly value: string; readonly from: string }

/** The keys this service reads, each once. A line for another key is kept (TB5 and TB6 read theirs) but not required. */
export const SERVICE_KNOBS = [
  'CCRC_TESTBOX_RUNS', 'CCRC_TESTBOX_SESSION_RUNS', 'CCRC_TESTBOX_WORKERS', 'CCRC_TESTBOX_RUN_TMPDIR',
  'CCRC_TESTBOX_ROOT', 'CCRC_TESTBOX_REPOS', 'CCRC_TESTBOX_FETCH_EVERY', 'CCRC_TESTBOX_RETENTION',
  'CCRC_TESTBOX_REPORT_MAX', 'CCRC_TESTBOX_TOOLS_DIR', 'CCRC_TESTBOX_ENV_FORWARD', 'CCRC_TESTBOX_RUN_USER_PREFIX',
  'CCRC_TESTBOX_LOG_TAIL', 'CCRC_TESTBOX_SERVICE_USER', 'CCRC_TESTBOX_LISTEN', 'CCRC_TESTBOX_SERVICE_TOKEN_FILE',
  'CCRC_TESTBOX_UNIT_MAX',
] as const;
export type ServiceKnob = (typeof SERVICE_KNOBS)[number];

export interface TestboxConfig {
  readonly runs: number;
  readonly sessionRuns: number;
  readonly workers: number;
  readonly runTmpdir: string;
  readonly root: string;
  readonly repos: string;
  readonly fetchEveryMs: number;
  readonly retentionMs: number;
  readonly reportMaxBytes: number;
  readonly toolsDir: string;
  readonly envForward: readonly string[];
  readonly runUserPrefix: string;
  readonly logTail: number;
  readonly serviceUser: string;
  readonly listen: { readonly host: string; readonly port: number };
  readonly tokenFile: string;
  /** The longest a unit may run (D-7501). */
  readonly unitMaxMs: number;
  /** Every line the printer gave, by key, for the readers TB5 and TB6 add. */
  readonly lines: ReadonlyMap<string, KnobLine>;
}

export class ConfigRefusal extends Error {}

const KEY = /^[A-Z][A-Z0-9_]*$/;

/** The printer's output to its lines. A line without exactly four fields, a bad key or a key printed twice refuses the
 *  whole read: the service does not start on half its settings. */
export function parseKnobLines(text: string): Map<string, KnobLine> {
  const out = new Map<string, KnobLine>();
  for (const raw of text.split('\n')) {
    if (raw === '') continue;
    const f = raw.split(KNOB_FIELD_SEP);
    if (f.length !== 4) throw new ConfigRefusal(`settings line without four fields: ${JSON.stringify(raw)}`);
    const [key, def, value, from] = f as [string, string, string, string];
    if (!KEY.test(key)) throw new ConfigRefusal(`settings line with a bad key: ${JSON.stringify(key)}`);
    if (out.has(key)) throw new ConfigRefusal(`settings key printed twice: ${key}`);
    out.set(key, { key, def, value, from });
  }
  return out;
}

// The shapes `ccd/testbox-knobs#_tb_shape` validates (TB1); the printer has already kept the default on a bad value,
// so a value that fails here means the printer and this reader disagree, and the service refuses to start.
const DURATION_UNIT_MS: Readonly<Record<string, number>> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const SIZE_UNIT_BYTES: Readonly<Record<string, number>> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 };

const refuse = (key: string, value: string, why: string): never => {
  throw new ConfigRefusal(`${key}=${JSON.stringify(value)}: ${why}`);
};

export function durationMs(key: string, value: string): number {
  const m = /^([0-9]+)([smhd])$/.exec(value);
  if (!m) return refuse(key, value, 'not a duration <n>s|m|h|d');
  const n = Number(m[1]) * DURATION_UNIT_MS[m[2]!]!;
  return n > 0 ? n : refuse(key, value, 'not a positive duration');
}

export function sizeBytes(key: string, value: string): number {
  const m = /^([0-9]+)([KMG])$/.exec(value);
  if (!m) return refuse(key, value, 'not a size <n>K|M|G');
  const n = Number(m[1]) * SIZE_UNIT_BYTES[m[2]!]!;
  return n > 0 ? n : refuse(key, value, 'not a positive size');
}

/** A count, 1 to 99 (TB1's count shape). */
export function count(key: string, value: string): number {
  return /^[1-9][0-9]?$/.test(value) ? Number(value) : refuse(key, value, 'not a count from 1 to 99');
}

/** An absolute path; a leading `~/` is the service user's home, as `_ccrc_knob`'s defaults spell it. */
export function absPath(key: string, value: string, home: string): string {
  const p = value.startsWith('~/') ? path.join(home, value.slice(2)) : value;
  if (!path.isAbsolute(p) || p.split('/').some((seg) => seg === '..')) return refuse(key, value, 'not an absolute path');
  return path.normalize(p);
}

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
export function envList(key: string, value: string): string[] {
  const names = value.split(/\s+/).filter((s) => s !== '');
  for (const n of names) if (!ENV_NAME.test(n)) refuse(key, value, `not an environment name: ${n}`);
  return names;
}

const USER_NAME = /^[a-z_][a-z0-9_-]*$/;
const userName = (key: string, value: string): string => (USER_NAME.test(value) ? value : refuse(key, value, 'not a user name'));

export function hostPort(key: string, value: string): { host: string; port: number } {
  const m = /^(\[[0-9a-fA-F:.]+\]|[^\s:[\]]+):([0-9]+)$/.exec(value);
  if (!m) return refuse(key, value, 'not host:port');
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) refuse(key, value, 'not a port');
  return { host: m[1]!.replace(/^\[(.*)\]$/, '$1'), port };
}

/** The lines to the service's settings. A missing key refuses with its name. */
export function configFromLines(lines: ReadonlyMap<string, KnobLine>, home: string): TestboxConfig {
  const v = (k: ServiceKnob): string => {
    const l = lines.get(k);
    if (l === undefined) throw new ConfigRefusal(`the settings printer gave no ${k}`);
    return l.value;
  };
  return {
    runs: count('CCRC_TESTBOX_RUNS', v('CCRC_TESTBOX_RUNS')),
    sessionRuns: count('CCRC_TESTBOX_SESSION_RUNS', v('CCRC_TESTBOX_SESSION_RUNS')),
    workers: count('CCRC_TESTBOX_WORKERS', v('CCRC_TESTBOX_WORKERS')),
    runTmpdir: absPath('CCRC_TESTBOX_RUN_TMPDIR', v('CCRC_TESTBOX_RUN_TMPDIR'), home),
    root: absPath('CCRC_TESTBOX_ROOT', v('CCRC_TESTBOX_ROOT'), home),
    repos: absPath('CCRC_TESTBOX_REPOS', v('CCRC_TESTBOX_REPOS'), home),
    fetchEveryMs: durationMs('CCRC_TESTBOX_FETCH_EVERY', v('CCRC_TESTBOX_FETCH_EVERY')),
    retentionMs: durationMs('CCRC_TESTBOX_RETENTION', v('CCRC_TESTBOX_RETENTION')),
    reportMaxBytes: sizeBytes('CCRC_TESTBOX_REPORT_MAX', v('CCRC_TESTBOX_REPORT_MAX')),
    toolsDir: absPath('CCRC_TESTBOX_TOOLS_DIR', v('CCRC_TESTBOX_TOOLS_DIR'), home),
    envForward: envList('CCRC_TESTBOX_ENV_FORWARD', v('CCRC_TESTBOX_ENV_FORWARD')),
    runUserPrefix: userName('CCRC_TESTBOX_RUN_USER_PREFIX', v('CCRC_TESTBOX_RUN_USER_PREFIX')),
    logTail: count('CCRC_TESTBOX_LOG_TAIL', v('CCRC_TESTBOX_LOG_TAIL')),
    serviceUser: userName('CCRC_TESTBOX_SERVICE_USER', v('CCRC_TESTBOX_SERVICE_USER')),
    listen: hostPort('CCRC_TESTBOX_LISTEN', v('CCRC_TESTBOX_LISTEN')),
    tokenFile: absPath('CCRC_TESTBOX_SERVICE_TOKEN_FILE', v('CCRC_TESTBOX_SERVICE_TOKEN_FILE'), home),
    unitMaxMs: durationMs('CCRC_TESTBOX_UNIT_MAX', v('CCRC_TESTBOX_UNIT_MAX')),
    lines,
  };
}

/** The printer's fixed argv: the release tree's own wrapper, box mode. */
export function knobArgv(release: string): { file: string; args: readonly string[] } {
  return { file: path.join(release, 'ccd', 'ccrc-test'), args: ['--testbox-knobs', 'box'] };
}

export interface KnobRun { readonly status: number | null; readonly stdout: string; readonly stderr: string }
/** The seam the printer runs through; tests pass a fixture printer. */
export type KnobRunner = (file: string, args: readonly string[], env: Readonly<Record<string, string>>) => Promise<KnobRun>;

/** The printer, through the service's bounded exec, under the short bound. */
export const realKnobRunner: KnobRunner = (file, args, env) => boundedExec(env, SHORT_BOUND_MS)(file, args);

/** The printer's environment: the service user's HOME, the system PATH and LANG, nothing else, so no other variable
 *  can reach it. Box mode reads no environment value anyway (D-7451); this keeps the read from depending on that. */
export function knobEnv(home: string, pathVar: string = SERVICE_PATH): Record<string, string> {
  return { HOME: home, PATH: pathVar, LANG: 'C' };
}

/** The service's one settings read. */
export async function readTestboxConfig(
  release: string, run: KnobRunner = realKnobRunner, home: string = os.homedir(), pathVar: string = SERVICE_PATH,
): Promise<TestboxConfig> {
  const { file, args } = knobArgv(release);
  const r = await run(file, args, knobEnv(home, pathVar));
  if (r.status !== 0) {
    const why = r.stderr.split('\n').find((l) => l.trim() !== '') ?? `exit ${String(r.status)}`;
    throw new ConfigRefusal(`the settings printer failed: ${why}`);
  }
  return configFromLines(parseKnobLines(r.stdout), home);
}

/** The repository table (spec §2.6): every `*.json` file of `CCRC_TESTBOX_REPOS`, in name order, each through
 *  `parseRepoRow`. A bad row or a name held twice refuses the start with its file named: a row is never half-read. */
export function readRepoRows(dir: string): TestboxRepoRow[] {
  if (!existsSync(dir)) return [];
  const rows: TestboxRepoRow[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const r = parseRepoRow(readFileSync(path.join(dir, f), 'utf8'));
    if (!r.ok) throw new ConfigRefusal(`repository row ${f}: ${r.reason}`);
    if (rows.some((x) => x.name === r.value.name)) throw new ConfigRefusal(`repository row ${f}: ${r.value.name} named twice`);
    rows.push(r.value);
  }
  return rows;
}
