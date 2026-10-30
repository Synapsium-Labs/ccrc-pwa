// D-7406, D-7501 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4; spec §2.2, §2.3 "A fixed environment",
// §2.5 "The worker count is always set"). L3: the run's spec file, `<CCRC_TESTBOX_ROOT>/specs/<k>`, the ONLY way a
// value reaches the prepare, run and clean units' scripts (`deploy/testbox/bin/{prestart,runner,clean}` read no config
// file and no test box variable). The service writes it before the prepare unit starts; the run user can read it and
// cannot write it.
//
// The format: NUL-terminated records, each a one-letter tag and its value, after the header record
// `ccrc-testbox-spec`. `R` run id, `K` run number, `U` run user, `D` run directory, `C` the command's directory, `O`
// the results directory, `M` the report cap in bytes, `S` the service user (the results' owner), `P` package, `G` the
// mirror, `F` the row's fetch URL, `B` the branch (absent when detached), `H` a pushed ref, `X` a build output, `E` one
// `NAME=value` of the run's environment, `A` one argv word. A NUL cannot be in an argv word or an environment value,
// so no value needs quoting.
//
// D-7407, D-7543 (TB5): a prepare's install steps follow, one per package in the row's install order: `N` the
// package, `W` the directory it runs in, then its argv as `J` words (`runs.ts#installStep`: a clone of the pristine
// install, or `npm ci --prefer-offline` in the run's copy). The install unit's spec, `specs/install`, is the same
// format: `Y` the install key, `D` `install/run`, `U` the install user, `O` and `M` and `S` for the clean script,
// `P` the package, `T` an install input's path relative to the repository root followed by `V` its bytes in base64,
// `Z` a doomed pristine key the privileged first step removes, and `C`, `E`, `A` for `runner` (`npm ci` from the
// lockfile alone, in `build/<package>`, HOME `install/run/home`).
//
// The environment is built from empty (spec §2.3): `PATH` with the box's tools first, `HOME` the run's empty home,
// `TMPDIR` = `CCRC_TESTBOX_RUN_TMPDIR`, `LANG`, `TERM`, the three worker names, `CCRC_CHROME` (resolved once, at
// service start), `CI` only when the local invocation had it, and the submission's forwarded names that
// `CCRC_TESTBOX_ENV_FORWARD` allows. The session's environment is never forwarded. A vitest head always gets
// `--maxWorkers=<n>` (the session's own is kept when lower, and then the worker names carry the same lower count,
// D-7501) and the service's JSON reporter beside the session's reporters.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunSubmit, TestboxRepoRow } from '../../../shared/testbox.js';
import type { InstallInput } from './pristine.js';
import type { InstallStep } from './runs.js';

export const SPEC_HEADER = 'ccrc-testbox-spec';

/** The worker-count names #389 sets (spec §2.5). */
export const WORKER_NAMES = ['VITEST_MAX_WORKERS', 'VITEST_MAX_THREADS', 'VITEST_MAX_FORKS'] as const;

/** The fixed part of the run's environment (spec §2.3), besides the values the settings give. */
export const FIXED_ENV = { LANG: 'C.UTF-8', TERM: 'dumb' } as const;
/** The system directories after the box's tools on `PATH`. */
export const SYSTEM_PATH = '/usr/local/bin:/usr/bin:/bin';

export interface SpecSettings {
  readonly root: string;
  readonly workers: number;
  readonly runTmpdir: string;
  readonly toolsDir: string;
  readonly envForward: readonly string[];
  readonly runUserPrefix: string;
  readonly reportMaxBytes: number;
  readonly serviceUser: string;
}

export interface RunPaths {
  readonly slot: string;
  readonly runDir: string;
  readonly out: string;
  readonly spec: string;
  readonly results: string;
  readonly logs: string;
}

/** Every path of run `k` of run `runId` under the root (spec §2.2). */
export function runPaths(root: string, k: number | 'install', runId: string): RunPaths {
  const slot = path.join(root, k === 'install' ? 'install' : path.join('runs', String(k)));
  return {
    slot, runDir: path.join(slot, 'run'), out: path.join(root, 'out', String(k)), spec: path.join(root, 'specs', String(k)),
    results: path.join(root, 'results', runId), logs: path.join(root, 'logs', runId),
  };
}

export interface RunSpec {
  readonly runId: string;
  readonly k: number;
  readonly runUser: string;
  readonly runDir: string;
  readonly cwd: string;
  readonly resultsDir: string;
  readonly reportMaxBytes: number;
  readonly serviceUser: string;
  readonly package: string;
  readonly mirror: string;
  readonly fetchUrl: string;
  readonly branch: string | null;
  readonly refs: readonly string[];
  readonly outputs: readonly string[];
  readonly env: readonly (readonly [string, string])[];
  readonly argv: readonly string[];
  /** The worker count the run gets. */
  readonly workers: number;
  /** The submission's local count when it differs from `workers`, else `null` (the summary's `local default`). */
  readonly localDefault: number | null;
  /** The prepare's install steps (TB5), in the row's install order; absent, the prepare installs nothing. */
  readonly installs?: readonly InstallStep[];
}

export type SpecBuild = { readonly ok: true; readonly spec: RunSpec } | { readonly ok: false; readonly reason: string };

/** The package's command heads (spec §2.5) the argv starts with, word by word; `null` when none does. */
export function commandHead(row: TestboxRepoRow, pkg: string, argv: readonly string[]): string | null {
  const p = row.packages.find((x) => x.name === pkg);
  if (p === undefined) return null;
  for (const head of p.commands) {
    const words = head.split(' ');
    if (words.length <= argv.length && words.every((w, i) => argv[i] === w)) return head;
  }
  return null;
}

const isVitest = (argv: readonly string[]): boolean => path.basename(argv[0] ?? '') === 'vitest';

/** Flags placed before a `--` that ends the options, else at the end. */
function withFlags(argv: readonly string[], flags: readonly string[]): string[] {
  const end = argv.indexOf('--');
  return end < 0 ? [...argv, ...flags] : [...argv.slice(0, end), ...flags, ...argv.slice(end)];
}
const MAX_WORKERS_EQ = /^--maxWorkers=(.*)$/;

/** The vitest argv with its worker flag decided: the session's numeric `--maxWorkers` kept when lower than `n`,
 *  otherwise replaced (a percentage included) or added. */
export function workerArgv(argv: readonly string[], n: number): { readonly argv: string[]; readonly workers: number } {
  const out: string[] = [];
  let session: number | null = null;
  let sawFlag = false;
  const end = argv.indexOf('--');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (end >= 0 && i >= end) { out.push(a); continue; }
    const eq = MAX_WORKERS_EQ.exec(a);
    if (eq !== null || a === '--maxWorkers') {
      const value = eq !== null ? eq[1]! : (argv[++i] ?? '');
      sawFlag = true;
      if (/^[1-9][0-9]*$/.test(value)) session = session === null ? Number(value) : Math.min(session, Number(value));
      continue;
    }
    out.push(a);
  }
  const workers = sawFlag && session !== null && session < n ? session : n;
  return { argv: withFlags(out, [`--maxWorkers=${workers}`]), workers };
}

/** The service's reporter beside the session's: when the session named none, vitest's default is kept too. */
export function reporterArgv(argv: readonly string[], reportPath: string): string[] {
  const named = argv.some((a) => a === '--reporter' || a.startsWith('--reporter='));
  return withFlags(argv, [...(named ? [] : ['--reporter=default']), '--reporter=json', `--outputFile.json=${reportPath}`]);
}

/** The run's spec from a checked submission, its row and the settings. A submission the settings do not allow is
 *  refused with the reason. */
export function buildRunSpec(submit: RunSubmit, row: TestboxRepoRow, k: number, s: SpecSettings, chrome: string): SpecBuild {
  if (submit.repository !== row.name) return { ok: false, reason: `repository ${submit.repository} is not row ${row.name}` };
  if (!row.packages.some((p) => p.name === submit.package)) return { ok: false, reason: `package ${submit.package} is not in ${row.name}'s table` };
  if (commandHead(row, submit.package, submit.argv) === null) return { ok: false, reason: `${submit.argv[0] ?? ''} runs locally` };
  for (const o of submit.outputs) if (!row.buildOutputs.some((b) => b.path === o)) return { ok: false, reason: `output ${o} is not declared` };
  for (const name of Object.keys(submit.forward)) {
    if (!s.envForward.includes(name)) return { ok: false, reason: `${name} is not a forwarded name` };
  }
  const p = runPaths(s.root, k, submit.runId);
  let argv = [...submit.argv];
  let workers = s.workers;
  if (isVitest(argv)) {
    const w = workerArgv(argv, s.workers);
    workers = w.workers;
    argv = reporterArgv(w.argv, path.join(p.runDir, 'report.json'));
  }
  const env: [string, string][] = [
    ['PATH', `${path.join(s.toolsDir, 'current', 'bin')}:${SYSTEM_PATH}`],
    ['HOME', path.join(p.runDir, 'home')],
    ['TMPDIR', s.runTmpdir],
    ['LANG', FIXED_ENV.LANG],
    ['TERM', FIXED_ENV.TERM],
    ...WORKER_NAMES.map((n) => [n, String(workers)] as [string, string]),
    ['CCRC_CHROME', chrome],
  ];
  if (submit.ci) env.push(['CI', 'true']);
  for (const name of s.envForward) {
    const v = submit.forward[name];
    if (v !== undefined) env.push([name, v]);
  }
  return {
    ok: true,
    spec: {
      runId: submit.runId, k, runUser: `${s.runUserPrefix}${k}`, runDir: p.runDir,
      cwd: path.join(p.runDir, 'checkout', submit.package), resultsDir: p.results, reportMaxBytes: s.reportMaxBytes,
      serviceUser: s.serviceUser, package: submit.package, mirror: row.mirrorPath, fetchUrl: row.fetchUrl,
      branch: submit.branch, refs: submit.refs, outputs: submit.outputs, env, argv, workers,
      localDefault: submit.workers === workers ? null : submit.workers,
    },
  };
}

/** The spec's records, NUL-terminated. A value holding a NUL is refused (none can, but the format depends on it). */
export function encodeSpec(spec: RunSpec): Buffer {
  const recs: string[] = [SPEC_HEADER, `R${spec.runId}`, `K${spec.k}`, `U${spec.runUser}`, `D${spec.runDir}`, `C${spec.cwd}`,
    `O${spec.resultsDir}`, `M${spec.reportMaxBytes}`, `S${spec.serviceUser}`, `P${spec.package}`, `G${spec.mirror}`, `F${spec.fetchUrl}`];
  if (spec.branch !== null) recs.push(`B${spec.branch}`);
  for (const r of spec.refs) recs.push(`H${r}`);
  for (const o of spec.outputs) recs.push(`X${o}`);
  for (const [n, v] of spec.env) recs.push(`E${n}=${v}`);
  for (const a of spec.argv) recs.push(`A${a}`);
  for (const st of spec.installs ?? []) recs.push(`N${st.package}`, `W${st.dir}`, ...st.argv.map((w) => `J${w}`));
  return records(recs);
}

function records(recs: readonly string[]): Buffer {
  for (const r of recs) if (r.includes('\0')) throw new Error('a spec value holds a NUL');
  return Buffer.from(recs.map((r) => `${r}\0`).join(''), 'utf8');
}

/** The install unit's spec (spec §2.2 "Pristine installs"). */
export interface InstallSpec {
  readonly key: string;
  readonly runDir: string;
  readonly installUser: string;
  readonly out: string;
  readonly reportMaxBytes: number;
  readonly serviceUser: string;
  readonly package: string;
  readonly inputs: readonly InstallInput[];
  readonly doomed: readonly string[];
  readonly env: readonly (readonly [string, string])[];
}

/** The install user is the run users' prefix and `install` (`ccrc-tb-install`). */
export const INSTALL_USER_SUFFIX = 'install';

/** `specs/install` for one key's build. */
export function buildInstallSpec(
  key: string, pkg: string, inputs: readonly InstallInput[], doomed: readonly string[], s: SpecSettings,
): InstallSpec {
  const p = runPaths(s.root, 'install', '-');
  return {
    key, runDir: p.runDir, installUser: `${s.runUserPrefix}${INSTALL_USER_SUFFIX}`, out: p.out, reportMaxBytes: s.reportMaxBytes,
    serviceUser: s.serviceUser, package: pkg, inputs, doomed,
    env: [
      ['PATH', `${path.join(s.toolsDir, 'current', 'bin')}:${SYSTEM_PATH}`],
      ['HOME', path.join(p.runDir, 'home')],
      ['TMPDIR', s.runTmpdir],
      ['LANG', FIXED_ENV.LANG],
      ['TERM', FIXED_ENV.TERM],
    ],
  };
}

export function encodeInstallSpec(spec: InstallSpec): Buffer {
  const recs: string[] = [SPEC_HEADER, `Y${spec.key}`, `D${spec.runDir}`, `U${spec.installUser}`, `O${spec.out}`,
    `M${spec.reportMaxBytes}`, `S${spec.serviceUser}`, `P${spec.package}`];
  for (const i of spec.inputs) recs.push(`T${i.path}`, `V${Buffer.from(i.bytes).toString('base64')}`);
  for (const k of spec.doomed) recs.push(`Z${k}`);
  recs.push(`C${path.join(spec.runDir, 'build', spec.package)}`);
  for (const [n, v] of spec.env) recs.push(`E${n}=${v}`);
  recs.push('Anpm', 'Aci');
  return records(recs);
}

/** Written whole, as `writeSpec` writes a run's. */
export function writeInstallSpec(root: string, spec: InstallSpec): string {
  const dir = path.join(root, 'specs');
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  const file = path.join(dir, INSTALL_USER_SUFFIX);
  const tmp = `${file}.${spec.key}.tmp`;
  writeFileSync(tmp, encodeInstallSpec(spec), { mode: 0o644 });
  renameSync(tmp, file);
  return file;
}

/** Written whole: a temporary file renamed over `specs/<k>`, readable by the run user, writable by the service only. */
export function writeSpec(root: string, spec: RunSpec): string {
  const dir = path.join(root, 'specs');
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  const file = path.join(dir, String(spec.k));
  const tmp = `${file}.${spec.runId}.tmp`;
  writeFileSync(tmp, encodeSpec(spec), { mode: 0o644 });
  renameSync(tmp, file);
  return file;
}
