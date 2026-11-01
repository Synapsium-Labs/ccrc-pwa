// `ccrc doctor`'s `graphify` check (Task 11 of the 2026-08-28
// graphify-fleet-integration plan) — the engine/skills/excludes/census/
// worktrees-disk measurement that closes D-995 (WORKTREES_ROOT df arm) and
// D-997 (skill drift visible).
//
// ── WHY THIS IS A SEPARATE FILE, WITH ITS OWN FIXTURE ─────────────────────
// `server/test/ccrc-doctorFixture.ts` already has a `healthy()`/`runDoctor()`/
// `lineFor()` triad, but nothing in that file is `export`ed — every OTHER
// doctor-adjacent suite in this tree (`ccrc-installFixture.ts`'s own header,
// "This is ccrc-doctorFixture.ts's healthy(), adapted") builds its OWN fixture
// rather than importing one, and this file follows that precedent rather
// than exporting from a 5000-line suite to save a second file's worth of
// setup. What is copied below is copied FAITHFULLY where it is copied at
// all (`stub`, `linkReal`, `containedPath`, `doctorEnv`, `runDoctor`,
// `lineFor`) — the ONE deliberate difference is `healthy()` itself, which
// this file keeps DELIBERATELY MINIMAL: `ccrc doctor` runs every check in
// the table in its own subshell (`cmd_doctor`'s own header — a check that
// dies under `set -u` only takes itself down, never the run), so a check
// this file does not care about is free to FAIL loudly without touching the
// one line every test here reads (`lineFor(out, 'graphify')`). Concretely,
// this fixture skips the exposure quartet, the roster's wrapper-shape
// ceremony, the build stamp, and auth — none of it is graphify's subject —
// and ADDS one thing `ccrc-doctorFixture.ts`'s own roster never has: a SECOND
// rostered home (`claude-home` -> `.claude-home`), because the
// brief's own `graphifyHealthy()` fixture plants a skill stamp under
// `.claude-home` and the D-997 test needs that home to be ON THE
// ROSTER for condition (4) to ever look at it.
//
// ── THE TWO SAFETY BOUNDARIES, KEPT ────────────────────────────────────────
// HOME is a throwaway `mkTmp` directory in every test (never the live
// `$HOME`), and PATH comes from `ghContainedEnv` and holds NOTHING BUT
// FIXTURE DIRECTORIES — the real `gh`, which on this machine carries a
// repo-WRITE token, is unreachable by construction. `git`, `jq`, `date`,
// `df`, `realpath` are the only subject binaries the `graphify` check
// actually shells out to; `git`, `jq`, `date` and `realpath` are
// `linkReal`ed (their PARSING is not what this suite is testing) and `df`
// is a scripted stub, same convention `ccrc-doctorFixture.ts`'s own `stubDf`
// uses.
import { describe, it, expect } from 'vitest';
import { fixClock, fixedNow } from './fixedClock.js';
import { plantShippedTimers, writeShippedTimer } from './shippedTimers.js';
import { spawnSync, execFileSync } from 'node:child_process';
import {
  writeFileSync, mkdirSync, symlinkSync, rmSync, utimesSync, readFileSync, copyFileSync, chmodSync, realpathSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { FIXTURE_DF_INODES_LINES } from './fixtureDfInodes.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { parseRoster } from '../../shared/roster.js';
import { generateAccountsSh } from '../../shared/generate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC_SRC = join(REPO, 'ccd', 'ccrc');
const CHECKS_SRC = join(REPO, 'ccd', 'ccrc-doctor-checks');
const LIB_SRC = join(REPO, 'ccd', 'ccrc-wrapper-shape');
const DOCTOR_TEST_SRC = join(REPO, 'server', 'test', 'ccrc-doctorFixture.ts');

const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

const realPath = (name: string): string => {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (!p) throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
};

interface Result { code: number; stdout: string; stderr: string }

/** `<home>/ccrc/ccd/{ccrc,ccrc-doctor-checks,ccrc-wrapper-shape}` — symlinks,
 *  the shape a deployed box has (deploy.sh:276 rsyncs `ccd` whole), so a test
 *  always runs the CHECKED-IN scripts and `dirname $0` resolves inside the
 *  fixture. Same idiom as `ccrc-doctorFixture.ts`'s `installCcrc`, minus the
 *  `auth` check's two extra artifacts — this fixture never plants a passphrase
 *  and does not care what `auth` reports. */
function installCcrc(home: string): void {
  const ccd = join(home, 'ccrc', 'ccd');
  mkdirSync(ccd, { recursive: true });
  symlinkSync(CCRC_SRC, join(ccd, 'ccrc'));
  symlinkSync(CHECKS_SRC, join(ccd, 'ccrc-doctor-checks'));
  symlinkSync(LIB_SRC, join(ccd, 'ccrc-wrapper-shape'));
  // GR7 (D-7353): the resolver the check sources for the graph settings and the store, and the engine wrapper whose
  // `--probe` it runs, beside ccrc as in a shipped tree (`_inst_tree` rsyncs `ccd/` whole).
  symlinkSync(join(REPO, 'ccd', 'graph-resolve'), join(ccd, 'graph-resolve'));
  symlinkSync(join(REPO, 'ccd', 'graph-build'), join(ccd, 'graph-build'));
  // The shipped timers the doctor reads each cadence from (W8 Task C8b, D-7054), as `ccrc-doctorFixture.ts` plants them.
  plantShippedTimers(join(home, 'ccrc'));
  // …and the sweep's service template, which the rendered-unit drift arm renders beside the timer's (GR8, D-7354).
  copyFileSync(join(REPO, 'deploy', 'systemd', 'ccd-graph-sweep.service'),
    join(home, 'ccrc', 'deploy', 'systemd', 'ccd-graph-sweep.service'));
}

const ccrcIn = (home: string): string => join(home, 'ccrc', 'ccd', 'ccrc');

const stubBin = (home: string): string => {
  const d = join(home, 'stub-bin');
  mkdirSync(d, { recursive: true });
  return d;
};

function stub(home: string, name: string, body: string): void {
  writeFileSync(join(stubBin(home), name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

/** Idempotent, same as `ccrc-doctorFixture.ts`'s own — a re-link inside a
 *  specific test must not trip over the fixture already having one. */
const linkReal = (home: string, name: string): void => {
  rmSync(join(stubBin(home), name), { force: true });
  symlinkSync(realPath(name), join(stubBin(home), name));
};

/** `df -Pk <path>` answering a POSIX table whose Available column (field 4,
 *  KiB) is keyed off the LAST path component: `…/worktrees` reads
 *  `<home>/fixture-df-avail-worktrees`, `…/projects` reads
 *  `<home>/fixture-df-avail-projects`, anything else falls back to a large
 *  default (41 GiB) so a check that happens to probe `df` on some other path
 *  (the `disk` check, on `$HOME`) gets a plausible answer rather than an
 *  "unexpected argv" refusal that would print noise this suite does not read.
 *  Same fixture-file convention `ccrc-doctorFixture.ts`'s own `stubDf` uses,
 *  extended per the brief: "a second fixture file fixture-df-avail-worktrees
 *  answers df on ~/worktrees". */
function stubDf(home: string): void {
  stub(home, 'df', [
    ...FIXTURE_DF_INODES_LINES,
    'if [ "$1" = "-Pk" ] && [ -n "$2" ]; then',
    // The stale/dead-mount shape `_check_disk`'s own header names: df exits
    // non-zero printing NOTHING. `fixture-df-fail-<root>` triggers it for a
    // specific root, so a test can make ONLY the worktrees (or projects)
    // probe fail while $HOME's own `disk` check elsewhere stays unaffected.
    '  case "$2" in',
    '    */worktrees) [ -f "$HOME/fixture-df-fail-worktrees" ] && exit 1 ;;',
    '    */projects) [ -f "$HOME/fixture-df-fail-projects" ] && exit 1 ;;',
    '    */graphs) [ -f "$HOME/fixture-df-fail-graphs" ] && exit 1 ;;',
    '  esac',
    // A root with its own avail file is its own device (`/dev/fixture-<root>`), so the graph arm, which measures the
    // store's device once beside the worktrees root's (GR7, D-7353), can tell two filesystems from one.
    '  f="" dev=/dev/fixture0',
    '  case "$2" in',
    '    */worktrees) [ -f "$HOME/fixture-df-avail-worktrees" ] && f="$HOME/fixture-df-avail-worktrees" dev=/dev/fixture-worktrees ;;',
    '    */projects) [ -f "$HOME/fixture-df-avail-projects" ] && f="$HOME/fixture-df-avail-projects" dev=/dev/fixture-projects ;;',
    '    */graphs) [ -f "$HOME/fixture-df-avail-graphs" ] && f="$HOME/fixture-df-avail-graphs" dev=/dev/fixture-graphs ;;',
    '  esac',
    '  avail=42991616',
    '  [ -n "$f" ] && read -r avail < "$f"',
    '  echo "Filesystem     1024-blocks      Used Available Capacity Mounted on"',
    '  echo "$dev    104857600  20971520 $avail      21% /"',
    '  exit 0',
    'fi',
    'echo "fixture df: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
}

/** `ghContainedEnv` plants the poisoned `gh` once; remembered per home so a
 *  second call (from a second `runDoctor`) does not re-plant over a test's
 *  own overwrite — `ccrc-doctorFixture.ts`'s own `containedPath` states the
 *  measured bug this avoids. */
const containedPathFor = new Map<string, string>();
function containedPath(home: string): string {
  let p = containedPathFor.get(home);
  if (p === undefined) {
    p = ghContainedEnv(home, { PATH: stubBin(home) })['PATH'] ?? '';
    containedPathFor.set(home, p);
  }
  return p;
}

function doctorEnv(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    PATH: containedPath(home),
    LC_ALL: 'C',
    CCRC_DOCTOR_GH_TIMEOUT: '5',
    // `_check_scope-sweep` reads a verdict record from the runtime dir: pointed inside the fixture (absent), it SKIPs — a test never reads a real box's.
    CCRC_SCOPE_SWEEP_STATE: join(home, 'fixture-scope-sweep.state'),
  };
}

function runDoctor(home: string): Result {
  const r = spawnSync(BASH, [ccrcIn(home), 'doctor'],
    { env: doctorEnv(home), encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const lineFor = (out: string, name: string): string | undefined =>
  out.split('\n').find((l) => new RegExp(`^(PASS|WARN|FAIL|SKIP) ${name}: `).test(l));

/** Every `graphify` verdict line (the check prints one per bucket). */
const gfxVerdicts = (out: string): string[] => out.split('\n').filter((l) => /^(PASS|WARN|FAIL|SKIP) graphify: /.test(l));
/** The remedy printed under a verdict line. */
const remedyOf = (out: string, line: string | undefined): string | undefined => {
  const all = out.split('\n');
  const i = line === undefined ? -1 : all.indexOf(line);
  return i < 0 ? undefined : all[i + 1];
};

/** `_check_graphify` alone, sourced from the fixture's own ccrc and table: <os> forces ccrc's platform word after the
 *  sourcing (ccrc derives CCD_OS from $OSTYPE when sourced, so a Linux-only arm is measured on every platform the same
 *  way), and each `NAME=value` is set after the sourcing too. A fixed driver: the paths are its arguments. */
const DRIVER = [
  'set -uo pipefail',
  '. "$1"',
  '. "$2"',
  '[ -z "$3" ] || CCD_OS="$3"',
  'shift 3',
  'for kv in "$@"; do declare "$kv"; done',
  '_check_graphify',
  '',
].join('\n');
function runCheck(home: string, os: 'linux' | 'darwin' | null, assigns: string[] = []): Result {
  const driver = join(home, 'fixture-check-graphify.sh');
  writeFileSync(driver, DRIVER);
  const r = spawnSync(BASH, [driver, ccrcIn(home), join(home, 'ccrc', 'ccd', 'ccrc-doctor-checks'), os ?? '', ...assigns],
    { env: doctorEnv(home), encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** `systemctl --user show ccrctests.slice …` answering `fixture-show-ccrctests.slice` (builtins only); anything else
 *  is the manager not answering. */
function stubSliceSystemctl(home: string, show: string | null): void {
  stub(home, 'systemctl', [
    'if [ "$1" = --user ] && [ "$2" = show ] && [ "$3" = ccrctests.slice ]; then',
    '  f="$HOME/fixture-show-ccrctests.slice"',
    '  if [ -f "$f" ]; then while IFS= read -r l; do printf \'%s\\n\' "$l"; done < "$f"; fi',
    '  exit 0',
    'fi',
    'exit 1',
  ].join('\n'));
  if (show === null) rmSync(join(home, 'fixture-show-ccrctests.slice'), { force: true });
  else writeFileSync(join(home, 'fixture-show-ccrctests.slice'), show);
}
const SLICE_LOADED = 'LoadState=loaded\nMemoryMax=6442450944\n';

/** A git tree `<home>/projects/<name>` with one commit; `excluded` writes the exclude lines GR8 converges. */
function gitTree(home: string, name: string, excluded = false, root = 'projects'): string {
  const repo = join(home, root, name);
  mkdirSync(repo, { recursive: true });
  const git = (...a: string[]): string => execFileSync(realPath('git'),
    ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...a],
    { cwd: repo, encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
  git('init', '-q');
  writeFileSync(join(repo, 'a.txt'), `${name}\n`);
  git('add', '-A'); git('commit', '-q', '-m', 'one');
  if (excluded) writeFileSync(join(repo, '.git', 'info', 'exclude'), 'graphify-out/\ngraphify-out\n.graphifyignore\n');
  return repo;
}
const commitIn = (home: string, repo: string, msg: string): string => {
  const git = (...a: string[]): string => execFileSync(realPath('git'),
    ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...a],
    { cwd: repo, encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
  if (msg !== '') { writeFileSync(join(repo, 'a.txt'), `${msg}\n`); git('commit', '-q', '-am', msg); }
  return git('rev-parse', 'HEAD');
};

/** The roster this fixture's `healthy()` seeds: the upstream account plus
 *  ONE generated account whose `configDirSuffix` is `.claude-home` — a
 *  documented, production-shaped suffix (`shared/roster.ts`'s own
 *  `configDirSuffix` comment lists it alongside `.claude`, `.claude-acme`
 *  and `.claude-gpt`), and the one the brief's `graphifyHealthy()` fixture
 *  plants a skill stamp under. Without a roster entry naming it, condition
 *  (4) never looks at `.claude-home` at all and the D-997 test would be
 *  asserting on a home nothing measures. */
const GRAPHIFY_ROSTER = {
  version: 1,
  accounts: [
    {
      id: 'claude', label: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream' as const }, homeAble: true, telemetry: 'anthropic' as const,
    },
    {
      id: 'claude-home', label: 'claude-home', configDirSuffix: '.claude-home',
      exec: { kind: 'generated' as const }, homeAble: true, telemetry: 'anthropic' as const,
    },
  ],
};

/** `<home>/.ccrc/accounts.sh`, generated the same way a real `ccrc install`
 *  would (`parseRoster` -> `generateAccountsSh`), never hand-typed — the
 *  reason `server/test/ccdWsHelpers.ts`'s own `seedAccountsSh` gives applies
 *  here too: a hand-written accounts.sh would be a fourth copy of the roster
 *  shape, and it would be the copy every test in this file believed. */
function seedGraphifyAccountsSh(home: string): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'accounts.sh'), generateAccountsSh(parseRoster(GRAPHIFY_ROSTER)));
}

/** A box where the `graphify` check specifically passes: `ccrc`/checks/
 *  wrapper-shape symlinked in, PATH contained, `git`/`jq`/`date`/`realpath`
 *  real (the check's own subject-adjacent tools), `df` stubbed, and a two-account
 *  roster naming `.claude` and `.claude-home`. Every OTHER check in the
 *  table is free to FAIL here — `cmd_doctor` runs each in its own subshell,
 *  and this suite reads only the `graphify` verdict line. */
function healthy(prefix: string): string {
  const home = mkTmp(prefix);
  installCcrc(home);
  containedPath(home);
  linkReal(home, 'git');
  linkReal(home, 'jq');
  linkReal(home, 'realpath');
  linkReal(home, 'date');
  // `_plat_mtime` (the census-staleness probe) shells `stat` — real-linked for
  // `date`'s reason: its parsing is not this suite's subject.
  linkReal(home, 'stat');
  stubDf(home);
  seedGraphifyAccountsSh(home);
  return home;
}

/** The brief's own fixture, verbatim (task-11-brief.md, "Step 1: Failing
 *  tests"): plants a working venv engine answering `graphify 0.9.9`, the pin
 *  stamp, both `.claude` and `.claude-home` skill stamps, and a fresh
 *  `ok` census with an empty tree list. */
function graphifyHealthy(home: string): void {
  const venvBin = join(home, '.ccrc', 'graphify-venv', 'bin');
  mkdirSync(venvBin, { recursive: true });
  writeFileSync(join(venvBin, 'graphify'),
    '#!/bin/sh\n[ "$1" = --version ] && { echo "graphify 0.9.9"; exit 0; }\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(home, '.ccrc', 'graphify.pin'), '0.9.9\n');
  // R3: a converged box has `graphify` on PATH resolving into the pinned venv.
  // `<home>/.local/bin` is the head of every contained PATH in this fixture, so
  // this is what `command -v graphify` answers.
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  rmSync(join(home, '.local', 'bin', 'graphify'), { force: true });
  symlinkSync(join(venvBin, 'graphify'), join(home, '.local', 'bin', 'graphify'));
  for (const d of ['.claude', '.claude-home']) {
    const s = join(home, d, 'skills', 'graphify');
    mkdirSync(s, { recursive: true });
    writeFileSync(join(s, '.graphify_version'), '0.9.9');
  }
  // GR7 (D-7353): the venv's interpreter, which the check runs `graph-build --probe` under. It records its argv and
  // answers `fixture-probe-fail`'s text on stderr with exit 2 when that file exists (the wrapper's setup refusal).
  writeFileSync(join(venvBin, 'python'), PROBE_PYTHON, { mode: 0o755 });
  // …and the store `ccrc install` creates with its marker (D-7360), at the default CCRC_GRAPH_STORE.
  plantStore(home);
  writeCensus(home, [[]]);
}

/** The venv interpreter stub: builtins only, since this fixture's PATH holds no system directory. */
const PROBE_PYTHON = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$*" >> "$HOME/fixture-probe-argv"',
  'if [ -f "$HOME/fixture-probe-fail" ]; then',
  '  while IFS= read -r l; do printf \'%s\\n\' "$l" >&2; done < "$HOME/fixture-probe-fail"',
  '  exit 2',
  'fi',
  'exit 0',
  '',
].join('\n');

/** The store root at the default CCRC_GRAPH_STORE, with the marker `_gr_store_init` writes. */
const storeOf = (home: string): string => join(home, '.ccrc', 'graphs');
function plantStore(home: string): void {
  mkdirSync(storeOf(home), { recursive: true });
  writeFileSync(join(storeOf(home), '.ccrc-graph-store'), 'ccrc graph store (graph revision 2); removed only by ccrc\n');
}

/** One census row of `repos[]`, in the shape `ccd-graph-sweep#_gs_emit` writes (spec §7). The per-repository count of
 *  trees is the key `'trees'`, quoted as the sweep quotes it, since it is a count and not the retired per-tree array. */
type RepoRow = Record<string, unknown>;
const repoRow = (o: RepoRow = {}): RepoRow => ({
  repo_key: 'project-a-0123abcd', source: '/nonexistent/project-a/.git', ref: 'refs/remotes/origin/main',
  tip: 'a'.repeat(40), served: 'a'.repeat(40), outcome: 'fresh', kind: '', changed_files: 0, reason: '', fail: '',
  duration_ms: 0, peak_mem_kb: null, cpu_ms: null, full_failures: 0, full_failed_at: '', nodes: 1, edges: 1,
  'trees': 0, linked: 0, migrate: { done: 0, pending: 0, refused: [] }, ...o,
});

/** The census: one pass per array of rows, oldest first (the sweep keeps the newest LAST). */
function writeCensus(home: string, passes: RepoRow[][], status = 'ok', at = new Date().toISOString()): void {
  writeFileSync(join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({ passes: passes.map((repos) => ({
    started: at, finished: at, pin: '0.9.9', status, repos })) }));
}

/** A published build of one repository: `<store>/<key>/builds/<id>/meta.json` and `current` naming it (spec §2.1, §2.3). */
function plantBuild(home: string, key: string, meta: Record<string, unknown>): void {
  const kd = join(storeOf(home), key);
  mkdirSync(join(kd, 'builds', 'b1'), { recursive: true });
  writeFileSync(join(kd, 'builds', 'b1', 'meta.json'), JSON.stringify({
    schema: 1, build_id: 'b1', repo_key: key, engine: '0.9.9', kind: 'full', commit: 'a'.repeat(40),
    built_at: new Date().toISOString(), last_full_at: new Date().toISOString(), peak_mem_kb: null, ...meta }));
  rmSync(join(kd, 'current'), { force: true });
  symlinkSync(join('builds', 'b1'), join(kd, 'current'));
}

const isoAgo = (s: number): string => new Date(Date.now() - s * 1000).toISOString().replace(/\.\d+Z$/, 'Z');

describe('ccrc doctor: graphify', () => {
  it('passes on the healthy fixture', () => {
    const home = healthy('ccrc-doctor-gfx-'); graphifyHealthy(home);
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^PASS graphify:/);
  });

  it('SKIPs (rc 3 semantics) on a server-role box', () => {
    const home = healthy('ccrc-doctor-gfx-srv-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');   // mirror how healthy() writes it
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^SKIP graphify:/);
  });

  it('FAILs naming the home when a rostered skill stamp is missing (D-997)', () => {
    const home = healthy('ccrc-doctor-gfx-drift-'); graphifyHealthy(home);
    rmSync(join(home, '.claude-home', 'skills', 'graphify'), { recursive: true });
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^FAIL graphify:/);
    expect(line).toContain('.claude-home');
  });

  it('WARNs on version drift between engine and pin', () => {
    const home = healthy('ccrc-doctor-gfx-ver-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'graphify.pin'), '0.9.50\n');
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^FAIL graphify:/);
  });

  it('FAILs when the engine venv is missing entirely', () => {
    const home = healthy('ccrc-doctor-gfx-novenv-'); graphifyHealthy(home);
    rmSync(join(home, '.ccrc', 'graphify-venv'), { recursive: true });
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^FAIL graphify:/);
  });

  it('reds on a probed-zero last pass (the cap-scopes 13-day failure, made visible)', () => {
    const home = healthy('ccrc-doctor-gfx-zero-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({ passes: [{
      started: 's', finished: 'f', pin: '0.9.9', status: 'probed-zero', repos: [] }] }));
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^FAIL graphify:/);
  });

  // R-5 (controller ruling, carried from Task 6): the pass-status vocabulary
  // is SIX values (ok | probed-zero | no-trees-configured | pass-locked |
  // paused | failed), and `failed` — the no-pin path's own status — means the
  // sweep could not run AT ALL, a condition distinct from probed-zero but
  // just as broken. Doctor must red on both.
  it('reds on a failed last pass (R-5: the pass could not run at all, e.g. no pin)', () => {
    const home = healthy('ccrc-doctor-gfx-failed-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({ passes: [{
      started: 's', finished: 'f', pin: '0.9.9', status: 'failed', repos: [] }] }));
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^FAIL graphify:/);
  });

  // Finding 2 (whole-branch review): the documented rollout is deploy
  // agent-first -> timer enabled -> sweep fires PINLESS -> census
  // {status:"failed", pin:""} -> THEN `ccrc install` converges everything,
  // pin file included. A closing doctor reading that stale pinless-failed
  // pass right after install must not FAIL a box that just converged.
  it('WARNs (not FAILs) on a failed+pinless last pass once the engine pin now exists (finding 2)', () => {
    const home = healthy('ccrc-doctor-gfx-failed-preprov-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({ passes: [{
      started: 's', finished: 'f', pin: '', status: 'failed', repos: [] }] }));
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^WARN graphify:/);
  });

  it('still FAILs a failed+pinless last pass when the pin file itself is still absent', () => {
    const home = healthy('ccrc-doctor-gfx-failed-nopin-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({ passes: [{
      started: 's', finished: 'f', pin: '', status: 'failed', repos: [] }] }));
    rmSync(join(home, '.ccrc', 'graphify.pin'));
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^FAIL graphify:/);
  });

  it('still FAILs a failed pass that recorded a NON-empty pin, even though the pin file exists now', () => {
    const home = healthy('ccrc-doctor-gfx-failed-realpin-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({ passes: [{
      started: 's', finished: 'f', pin: '0.9.9', status: 'failed', repos: [] }] }));
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^FAIL graphify:/);
  });

  // D-1061 (deviation from the brief's plain-English "absent file -> WARN"):
  // an absent census must NOT warn, or every fresh install warns, always —
  // `OnBootSec=5min` means no box has a census for several minutes at
  // minimum, and D-139 (ccrc-install-*.test.ts, "ends with doctor, and a box
  // that passes every check exits 0") is an operator ruling that a fresh
  // install ends green. See the check's own comment at condition (6).
  it('does not WARN when the census has never been written — a fresh box, D-1061/D-139', () => {
    const home = healthy('ccrc-doctor-gfx-census-abs-'); graphifyHealthy(home);
    rmSync(join(home, '.ccrc', 'graph-sweep.json'));
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^PASS graphify:/);
  });

  it('WARNs when the last pass finished long enough ago that the timer looks stopped', () => {
    const home = healthy('ccrc-doctor-gfx-census-stale-'); graphifyHealthy(home);
    // 60 minutes ago — over 3x the sweep timer's 15-minute interval (45 min).
    // The check reads the census FILE's mtime (the sweep rewrites it atomically
    // at the end of every pass), not the JSON's ISO stamp — GNU `date -d` has
    // no Darwin arm, and the macos-platform guard forbids the bare call. So
    // the fixture ages the FILE, exactly what a stopped timer leaves behind.
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    const census = join(home, '.ccrc', 'graph-sweep.json');
    writeFileSync(census, JSON.stringify({ passes: [{
      started: old, finished: old, pin: '0.9.9', status: 'ok', repos: [] }] }));
    const oldSecs = Date.now() / 1000 - 3600;
    utimesSync(census, oldSecs, oldSecs);
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^WARN graphify:/);
  });

  // W8 Task C8b's characterization pin (D-7054; ARCH-69 (#804)): the census bound is three of ccd-graph-sweep.timer's
  // 15-minute periods, 2700 s, held one second inside and one second past, byte for byte, on a fixed clock (a real
  // one can tick between the fixture's write and the check's read). It runs unchanged at every commit of the series.
  const censusAged = (prefix: string, ageS: number): string => {
    const home = healthy(prefix); graphifyHealthy(home);
    const now = fixedNow();
    fixClock(home, stubBin(home), now);
    utimesSync(join(home, '.ccrc', 'graph-sweep.json'), now - ageS, now - ageS);
    return home;
  };
  it('a census 2700 s old is inside three of the timer\'s cycles: the PASS, byte for byte (C8b)', () => {
    const out = runDoctor(censusAged('ccrc-doctor-gfx-census-2700-', 2700)).stdout;
    expect(lineFor(out, 'graphify'), out).toBe('PASS graphify: engine 0.9.9, skills converged, census ok, gate on');
  });
  it('a census 2701 s old is past three of the timer\'s cycles: the WARN and its remedy, byte for byte (C8b)', () => {
    const out = runDoctor(censusAged('ccrc-doctor-gfx-census-2701-', 2701)).stdout;
    const lines = out.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN graphify: '));
    expect(lines.slice(i, i + 2), out).toEqual([
      'WARN graphify: the last graph-sweep pass finished 45 minutes ago — the timer may not be firing, gate on',
      '  remedy: check the timer: systemctl --user status ccd-graph-sweep.timer (and journalctl --user -u ccd-graph-sweep.service -n 20)',
    ]);
    expect(lines.filter((l) => /^(WARN|FAIL) graphify: /.test(l)), out).toHaveLength(1);
  });

  // C8b step 4 (OA-C8c (a), D-7062), RE-POINTED BY GR7 (D-7353; spec §7's consumer table): the bound is 3 x
  // CCRC_GRAPH_REFRESH_SECS, read through `_gr_knobs` in `file` mode, since the timer's period is now RENDERED from that
  // setting (GR8, D-7354). So a shipped timer the doctor cannot read, or a check table sourced with no BOX_TREE_DIR,
  // no longer leaves the census's staleness unmeasured: the same bound holds, measured from the setting, and the
  // comparison is still never against a literal (the 600 s row below moves it).
  const graphifyLines = (out: string, home: string): string[] =>
    out.split(home).join('<home>').split('\n').filter((l, i, all) => /^(PASS|WARN|FAIL) graphify: /.test(l)
      || (/^ {2}remedy: /.test(l) && /^(WARN|FAIL) graphify: /.test(all[i - 1] ?? '')));
  const STALE = (minutes: number): string[] => [
    `WARN graphify: the last graph-sweep pass finished ${minutes} minutes ago — the timer may not be firing, gate on`,
    '  remedy: check the timer: systemctl --user status ccd-graph-sweep.timer (and journalctl --user -u ccd-graph-sweep.service -n 20)',
  ];
  it.each([[2700, null], [2701, 45], [9000, 150]])('an unreadable ccd-graph-sweep.timer leaves graphify\'s bound at 3 x CCRC_GRAPH_REFRESH_SECS over a census %i s old (GR7)', (age, minutes) => {
    const home = censusAged(`ccrc-doctor-gfx-census-unread-${age}-`, age);
    writeShippedTimer(join(home, 'ccrc'), 'ccd-graph-sweep.timer', null);
    const r = runDoctor(home);
    expect(graphifyLines(r.stdout, home), r.stdout).toEqual(minutes === null
      ? ['PASS graphify: engine 0.9.9, skills converged, census ok, gate on'] : STALE(minutes));
    expect(r.stderr).not.toMatch(/integer (?:expression )?expected|syntax error|unbound variable/);
  });
  it('a check table sourced with no BOX_TREE_DIR still measures the census bound from the setting (GR7)', () => {
    const home = censusAged('ccrc-doctor-gfx-census-unloaded-', 2701);
    const r = runCheck(home, null, ['BOX_TREE_DIR=']);
    expect(graphifyLines(r.stdout, home), r.stdout).toEqual(STALE(45));
    expect(r.code).toBe(2);
  });
  it.each([[1800, null], [1801, 30]])('CCRC_GRAPH_REFRESH_SECS=600 moves the bound to 1800 s: a census %i s old (GR7)', (age, minutes) => {
    const home = censusAged(`ccrc-doctor-gfx-census-600-${age}-`, age);
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_GRAPH_REFRESH_SECS=600\n');
    const r = runDoctor(home);
    expect(graphifyLines(r.stdout, home), r.stdout).toEqual(minutes === null
      ? ['PASS graphify: engine 0.9.9, skills converged, census ok, gate on'] : STALE(minutes));
  });

  // D-1454 — A REFUSED BUILD IS A FINDING FOR AN OPERATOR, NOT A ROW NOBODY READS.
  // Measured on the reference fleet 2026-09-04: 11 of 51 per-tree rows `refused-by-guard`
  // and 2 `failed` on every pass, while doctor printed `PASS graphify: … census
  // ok` — the pass STATUS was `ok` (the pass ran; it is the rows that did not)
  // and nothing in the check ever looked at them. The census is the only place
  // those rows exist and no verb prints it, so this line is the only way an
  // operator learns a repository has had no graph for a fortnight. WARN, never
  // FAIL: a refused build is the corpus guard doing its job. Since GR7 (D-7353)
  // the rows are the repository rows, `.passes[-1].repos[]`, and the arm also
  // counts `timed-out`, `oom-killed` and `skipped-slots` (spec §8).
  it('WARNs, naming every count, when the last pass carries refused, failed, timed-out, OOM-killed and slot-starved rows (D-1454, GR7)', () => {
    const home = healthy('ccrc-doctor-gfx-rows-'); graphifyHealthy(home);
    // TWO passes, and the older one is dirty in a way that would CHANGE every
    // number on the line if the check read `.passes[]` instead of `.passes[-1]`.
    // The census keeps ten passes (`ccd-graph-sweep#_gs_finish` keeps `.[-10:]`),
    // so reading them all would name repositories fixed nine passes ago while
    // still saying "in the last graph-sweep pass".
    const r = (k: string, outcome: string, reason = ''): RepoRow => repoRow({ repo_key: `${k}-0123abcd`, outcome, reason, kind: 'incremental' });
    writeCensus(home, [
      ['p', 'q', 'r', 's'].map((k) => r(k, 'refused-by-guard', 'untracked paths entered the corpus')),
      [r('a', 'refused-by-guard', 'untracked paths entered the corpus: x.py'), r('b', 'refused-by-guard', 'y.py'),
        r('c', 'refused-by-guard', 'z.py'), r('d', 'failed', 'engine: _rebuild_code returned False'), r('e', 'failed', 'exit 1'),
        r('f', 'timed-out'), r('g', 'oom-killed'), r('h', 'skipped-slots'), r('i', 'fresh')],
    ]);
    const out = runDoctor(home).stdout;
    const lines = gfxVerdicts(out);
    expect(lines.filter((l) => l.startsWith('FAIL ')), 'a census row is the guard or the queue working — never a FAIL').toEqual([]);
    const line = lines.find((l) => l.includes('in the last graph-sweep pass'));
    expect(line, out).toMatch(/^WARN graphify:/);
    expect(line, 'the refused count is not the LAST pass\'s three').toContain('3 refused');
    expect(line, 'the failed count is not named').toContain('2 failed');
    expect(line).toContain('1 timed out');
    expect(line).toContain('1 OOM-killed');
    expect(line).toContain('1 skipped (no heavy test slot)');
    expect(line, 'the total counts repositories the last pass never saw').toContain('of 9 repositories');
    expect(line, 'the remedy an operator can act on is not on the line').toContain('graph-noise');
    const remedy = out.split('\n')[out.split('\n').indexOf(line!) + 1];
    expect(remedy, 'the remedy names the retired per-tree array').toContain('.passes[-1].repos[]');
    expect(remedy).toContain("a refused build keeps the repository's previous graph served");
  });

  // N17's doctor half (spec §11): one repository refused by the guard is counted, alone.
  it('N17: a refused-by-guard repository row is counted, and WARNs (GR7)', () => {
    const home = healthy('ccrc-doctor-gfx-n17-'); graphifyHealthy(home);
    writeCensus(home, [[repoRow({ outcome: 'refused-by-guard', kind: 'full', reason: 'untracked paths entered the corpus: a.py' })]]);
    const line = gfxVerdicts(runDoctor(home).stdout).find((l) => l.includes('in the last graph-sweep pass'));
    expect(line).toMatch(/^WARN graphify: 1 refused /);
    expect(line).toContain('of 1 repository');
  });

  // …and the other half: a pass whose rows are all clean leaves the PASS text
  // exactly as it was. A bucket that fires on a healthy census is a bucket an
  // operator learns to ignore (D-139's own reasoning, applied to rows).
  it('says nothing new when every row of the last pass is clean (D-1454)', () => {
    const home = healthy('ccrc-doctor-gfx-rows-clean-'); graphifyHealthy(home);
    // …and an EARLIER pass that was dirty, since the repair that clears a
    // refusal is a commit in the repository: the pass after it is clean while
    // the census still carries the old rows.
    writeCensus(home, [
      [repoRow({ repo_key: 'a-0123abcd', outcome: 'refused-by-guard', reason: 'a.py' }), repoRow({ repo_key: 'b-0123abcd', outcome: 'failed', reason: 'exit 1' })],
      [repoRow({ repo_key: 'a-0123abcd', outcome: 'fresh' }), repoRow({ repo_key: 'b-0123abcd', outcome: 'refreshed', kind: 'incremental' }),
        repoRow({ repo_key: 'c-0123abcd', outcome: 'skipped-budget', reason: 'pass budget CCRC_GRAPH_BUDGET=4 reached' })],
    ]);
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^PASS graphify:/);
  });

  // GR7 (D-7353; spec §6.1, §8): the exclude is checked WITHOUT the slash, since the slash-only line does not ignore
  // the link a tree now holds, and a common dir that fails it is a FAIL naming the repository (the sweep links no
  // tree there). The R-3 note this replaces asked for the slash; GR8 writes both lines.
  it('FAILs naming the repository when a tree does not ignore graphify-out (no slash) (GR7)', () => {
    const home = healthy('ccrc-doctor-gfx-excl-'); graphifyHealthy(home);
    const repo = join(home, 'projects', 'demo');
    mkdirSync(repo, { recursive: true });
    execFileSync(realPath('git'), ['init', '-q'], { cwd: repo });
    const line = gfxVerdicts(runDoctor(home).stdout).find((l) => l.includes('graphify-out'));
    expect(line).toMatch(/^FAIL graphify:/);
    expect(line).toContain('$HOME/projects/demo');
  });
  it('the slash-only exclude line is not enough: still a FAIL naming the repository (GR7)', () => {
    const home = healthy('ccrc-doctor-gfx-excl-slash-'); graphifyHealthy(home);
    const repo = gitTree(home, 'demo');
    writeFileSync(join(repo, '.git', 'info', 'exclude'), 'graphify-out/\n.graphifyignore\n');
    const line = gfxVerdicts(runDoctor(home).stdout).find((l) => l.includes('graphify-out'));
    expect(line).toMatch(/^FAIL graphify:/);
    expect(line).toContain('$HOME/projects/demo');
  });
  it('a tree whose exclude carries the no-slash line passes the excludes arm (GR7)', () => {
    const home = healthy('ccrc-doctor-gfx-excl-ok-'); graphifyHealthy(home);
    gitTree(home, 'demo', true);
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^PASS graphify:/);
  });

  it('D-995: WARNs when the worktrees device is tight even though $HOME is roomy', () => {
    const home = healthy('ccrc-doctor-gfx-disk-'); graphifyHealthy(home);
    // extend stubDf: a second fixture file fixture-df-avail-worktrees answers df on ~/worktrees
    mkdirSync(join(home, 'worktrees'), { recursive: true });
    writeFileSync(join(home, 'fixture-df-avail-worktrees'), String(3 * 1024 * 1024)); // 3 GiB
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain('worktrees');
  });

  it('D-995: FAILs when the worktrees device is under the 2 GiB floor', () => {
    const home = healthy('ccrc-doctor-gfx-disk-fail-'); graphifyHealthy(home);
    mkdirSync(join(home, 'worktrees'), { recursive: true });
    writeFileSync(join(home, 'fixture-df-avail-worktrees'), String(1 * 1024 * 1024)); // 1 GiB
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^FAIL graphify:/);
    expect(line).toContain('worktrees');
  });

  // Review finding (Important, condition 7 / D-995 fix round): a SELECTED
  // root that df cannot read (a stale or dead mount — df exits non-zero
  // printing nothing, exactly like the "avail" case's empty match) used to
  // fall through the `''|*[!0-9]*` arm and produce NO finding at all —
  // recreating the D-995 blind spot inside the arm meant to close it, and
  // collapsing "root absent, nothing to measure" (silent) into "root
  // present, measurement FAILED" (a real defect) — the overloaded-null shape
  // this codebase bans by name. `_check_disk` WARNs on the identical shape
  // for $HOME; this is that same measurement over $HOME/worktrees.
  // ── R5 (D-1613): THE SEARCH GATE'S STATE IS ON THE LINE, NOT ONLY IN THE SHELL ─
  // The gate denies a session's first `Grep`/`Glob`/head-search until it has
  // queried the tree's graph, and its kill-switch is a FILE the operator
  // touches by hand (`ccd/session-hook.sh`'s own `GRAPH_GATE_OFF`) — nothing
  // in this tree writes it and no verb reports it, so an operator who turned
  // the gate off in a hurry has nowhere to read that back except the shell.
  // `ccrc doctor` is the only surface that measures this box's graphify
  // condition at all, so the gate state rides EVERY verdict line this check
  // prints: it is a fact about the box, not a finding about it (an operator
  // switch deliberately set is REPORTED, never warned about — the same way
  // `$REG/coordinator-paused` reaches the wire rather than a doctor bucket),
  // and the class the rest of the measurement lands in must not decide
  // whether the fact is said.
  //
  // HARVESTED, not remembered (the D-1363 idiom, this file's first use of it):
  // the kill-switch path comes off the hook's own assignment rather than being
  // typed here a second time, so the day the hook moves the file this suite
  // plants the fixture where the hook now looks — and throws, naming the
  // rename, if the assignment is gone — instead of passing against a path
  // nothing reads.
  const GATE_OFF = ((): string => {
    const hook = readFileSync(join(REPO, 'ccd', 'session-hook.sh'), 'utf8');
    const m = hook.match(/^GRAPH_GATE_OFF="\$HOME\/(.+)"$/m);
    if (!m) throw new Error('ccd/session-hook.sh no longer assigns GRAPH_GATE_OFF under $HOME — ' +
      "the doctor line that names the operator file has to be re-derived against the hook's " +
      'new spelling, not left pointing at the old one');
    return m[1]!;
  })();

  it('says the search gate is armed, on the PASS line (R5, D-1613)', () => {
    const home = healthy('ccrc-doctor-gfx-gate-on-'); graphifyHealthy(home);
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^PASS graphify:/);
    expect(line, 'the graphify line says nothing at all about the search gate').toContain('gate on');
  });

  it('says the gate is off and NAMES the operator file to remove (R5, D-1613)', () => {
    const home = healthy('ccrc-doctor-gfx-gate-off-'); graphifyHealthy(home);
    writeFileSync(join(home, GATE_OFF), '');
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^PASS graphify:/);
    expect(line, 'the off state is invisible, or the line does not say which file to remove')
      .toContain(`gate off (operator file $HOME/${GATE_OFF})`);
  });

  it('carries the gate state on a WARN line too — the verdict class does not decide the fact', () => {
    // A WARN with the kill-switch on top of it: a box with something to fix is
    // exactly the box whose operator is reading this line, and it is the one
    // that used to lose the gate state entirely. The excludes finding this row
    // used is a FAIL since GR7 (D-7353), so the WARN is now a graph setting that
    // kept its default, and the FAIL line is held to the same fact below.
    const home = healthy('ccrc-doctor-gfx-gate-warn-'); graphifyHealthy(home);
    writeFileSync(join(home, GATE_OFF), '');
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_GRAPH_BUDGET=many\n');
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^WARN graphify:/);
    expect(line, 'a WARN drops the gate state the PASS line carries').toContain('gate off');
    expect(line, 'the WARN lost the finding it is actually about').toContain('CCRC_GRAPH_BUDGET');
  });

  it('carries the gate state on a FAIL line too (GR7)', () => {
    const home = healthy('ccrc-doctor-gfx-gate-fail-'); graphifyHealthy(home);
    writeFileSync(join(home, GATE_OFF), '');
    const repo = join(home, 'projects', 'demo');
    mkdirSync(repo, { recursive: true });
    execFileSync(realPath('git'), ['init', '-q'], { cwd: repo });
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^FAIL graphify:/);
    expect(line, 'a FAIL drops the gate state the PASS line carries').toContain('gate off');
    expect(line, 'the FAIL lost the finding it is actually about').toContain('graphify-out');
  });

  it('D-995: WARNs (not silent) when df cannot read the worktrees root — a stale/dead mount', () => {
    const home = healthy('ccrc-doctor-gfx-disk-unread-'); graphifyHealthy(home);
    mkdirSync(join(home, 'worktrees'), { recursive: true });
    writeFileSync(join(home, 'fixture-df-fail-worktrees'), '1');
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain('worktrees');
  });
});

// ── GR7 (D-7353; spec §8): the repository rows, the store, the backoff and the sizing ─────────────────────────────
// One row per line of spec §8's table. A Linux-only arm (the tests slice, the sizing against its MemoryMax, the
// rendered units) is driven through `runCheck` with ccrc's platform word forced, so every row runs on macOS as well,
// and its darwin row holds the arm silent there.
describe('ccrc doctor: graphify, revision 2 (GR7, D-7353)', () => {
  const KEY = 'project-a-0123abcd';

  // §8 row 1: a graph setting `_gr_knobs` kept its default WARNs naming the key, the value, its source and the
  // default; a store root that breaks spec §2.2 is a FAIL.
  it('a graph setting of the wrong shape WARNs naming the key, the value, the source and the default used', () => {
    const home = healthy('ccrc-doctor-gfx2-knob-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_GRAPH_BUDGET=many\n');
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain("CCRC_GRAPH_BUDGET: 'many' from ~/.ccrc/ccrc.env is not a whole number, 1 or more; using 4");
  });
  it('a store root inside the roots the sweep enumerates is a FAIL', () => {
    const home = healthy('ccrc-doctor-gfx2-store-rejected-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), `CCRC_GRAPH_STORE=${join(home, 'projects', 'graphs')}\n`);
    const line = gfxVerdicts(runDoctor(home).stdout).find((l) => l.includes('graph store'));
    expect(line).toMatch(/^FAIL graphify:/);
    expect(line).toContain('is inside ~/projects');
  });

  // §8 row 2: the installed units against what the current settings render (Linux; never written by the doctor).
  const linkRenderTools = (home: string): void => { for (const t of ['awk', 'cmp', 'cp', 'chmod', 'mv', 'rm', 'mktemp']) linkReal(home, t); };
  const installUnits = (home: string): { timer: string; service: string } => {
    const dir = join(home, '.config', 'systemd', 'user');
    mkdirSync(dir, { recursive: true });
    const timer = join(dir, 'ccd-graph-sweep.timer'); const service = join(dir, 'ccd-graph-sweep.service');
    copyFileSync(join(REPO, 'deploy', 'systemd', 'ccd-graph-sweep.timer'), timer);
    copyFileSync(join(REPO, 'deploy', 'systemd', 'ccd-graph-sweep.service'), service);
    return { timer, service };
  };
  it('installed units that differ from what the settings render WARN "run `ccrc update` to apply", and are never written', () => {
    const home = healthy('ccrc-doctor-gfx2-drift-'); graphifyHealthy(home); linkRenderTools(home);
    const { timer, service } = installUnits(home);
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_GRAPH_REFRESH_SECS=600\nCCRC_GRAPH_BUDGET=2\n');
    const before = [readFileSync(timer, 'utf8'), readFileSync(service, 'utf8')];
    const r = runCheck(home, 'linux');
    const line = gfxVerdicts(r.stdout).find((l) => l.includes('OnUnitActiveSec'));
    expect(line, r.stdout + r.stderr).toMatch(/^WARN graphify:/);
    expect(line).toContain('OnUnitActiveSec=15min');
    expect(line).toContain('OnUnitActiveSec=10min');
    expect(line).toContain('TimeoutStartSec=5400');
    expect(line).toContain('TimeoutStartSec=3000');
    expect(remedyOf(r.stdout, line)).toContain('run `ccrc update` to apply');
    expect([readFileSync(timer, 'utf8'), readFileSync(service, 'utf8')], 'the doctor wrote a unit').toEqual(before);
  });
  it('installed units that match the render say nothing; on darwin the arm is silent', () => {
    const home = healthy('ccrc-doctor-gfx2-drift-ok-'); graphifyHealthy(home); linkRenderTools(home);
    installUnits(home);
    expect(gfxVerdicts(runCheck(home, 'linux').stdout)).toEqual(['PASS graphify: engine 0.9.9, skills converged, census ok, gate on']);
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_GRAPH_REFRESH_SECS=600\n');
    expect(gfxVerdicts(runCheck(home, 'darwin').stdout)).toEqual(['PASS graphify: engine 0.9.9, skills converged, census ok, gate on']);
  });

  // §8 row 3: the store root missing, unwritable, or without its marker.
  it('a missing store root is a FAIL whose remedy is ccrc install', () => {
    const home = healthy('ccrc-doctor-gfx2-store-missing-'); graphifyHealthy(home);
    rmSync(storeOf(home), { recursive: true, force: true });
    const out = runDoctor(home).stdout;
    const line = gfxVerdicts(out).find((l) => l.includes('graph store'));
    expect(line).toMatch(/^FAIL graphify:/);
    expect(line).toContain('does not exist');
    expect(remedyOf(out, line)).toContain('ccrc install');
  });
  it('a store root without its marker is a FAIL', () => {
    const home = healthy('ccrc-doctor-gfx2-store-unmarked-'); graphifyHealthy(home);
    rmSync(join(storeOf(home), '.ccrc-graph-store'));
    const line = gfxVerdicts(runDoctor(home).stdout).find((l) => l.includes('graph store'));
    expect(line).toMatch(/^FAIL graphify:/);
    expect(line).toContain('no store marker');
  });
  it.skipIf(process.getuid?.() === 0)('an unwritable store root is a FAIL', () => {
    const home = healthy('ccrc-doctor-gfx2-store-ro-'); graphifyHealthy(home);
    chmodSync(storeOf(home), 0o555);
    try {
      const line = gfxVerdicts(runDoctor(home).stdout).find((l) => l.includes('graph store'));
      expect(line).toMatch(/^FAIL graphify:/);
      expect(line).toContain('not writable');
    } finally { chmodSync(storeOf(home), 0o755); }
  });

  // §8 row 4: the disk floor on the store's device (D-995's worktrees arm stays, above).
  it('the store\'s device under the 2 GiB floor is a FAIL, and tight is a WARN, naming the graph store', () => {
    const home = healthy('ccrc-doctor-gfx2-disk-'); graphifyHealthy(home);
    writeFileSync(join(home, 'fixture-df-avail-graphs'), String(1 * 1024 * 1024));
    let line = gfxVerdicts(runDoctor(home).stdout).find((l) => l.includes('free on'));
    expect(line).toMatch(/^FAIL graphify:/);
    expect(line).toContain('the graph store');
    writeFileSync(join(home, 'fixture-df-avail-graphs'), String(3 * 1024 * 1024));
    line = gfxVerdicts(runDoctor(home).stdout).find((l) => l.includes('free on'));
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain('the graph store');
  });
  it('the store and the worktrees root on two devices are both measured', () => {
    const home = healthy('ccrc-doctor-gfx2-disk-two-'); graphifyHealthy(home);
    mkdirSync(join(home, 'worktrees'), { recursive: true });
    writeFileSync(join(home, 'fixture-df-avail-worktrees'), String(3 * 1024 * 1024));
    writeFileSync(join(home, 'fixture-df-avail-graphs'), String(1 * 1024 * 1024));
    const lines = gfxVerdicts(runDoctor(home).stdout);
    expect(lines.find((l) => l.startsWith('FAIL ') && l.includes('the graph store'))).toBeDefined();
    expect(lines.find((l) => l.startsWith('WARN ') && l.includes('worktrees'))).toBeDefined();
  });

  // §8 row 5: a non-excluded repository with trees and no published build at the pin.
  it('a repository with trees and no published build WARNs naming it; one at another engine names the pin', () => {
    const home = healthy('ccrc-doctor-gfx2-unbuilt-'); graphifyHealthy(home);
    writeCensus(home, [[repoRow({ 'trees': 2, outcome: 'skipped-budget', reason: 'pass budget CCRC_GRAPH_BUDGET=4 reached' })]]);
    let line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain(`${KEY} has 2 tree(s) and no published graph`);
    plantBuild(home, KEY, { engine: '0.9.8' });
    line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain(`${KEY} has 2 tree(s) and no published graph at the pin 0.9.9 (current: 0.9.8)`);
    plantBuild(home, KEY, { engine: '0.9.9' });
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^PASS graphify:/);
  });
  it('an excluded repository, or one with no trees, is not asked for a build', () => {
    const home = healthy('ccrc-doctor-gfx2-excluded-'); graphifyHealthy(home);
    writeCensus(home, [[repoRow({ 'trees': 2, outcome: 'excluded' }), repoRow({ repo_key: 'b-0123abcd', 'trees': 0, outcome: 'fresh' })]]);
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^PASS graphify:/);
  });

  // §8 row 6: the served commit older than 3 x REFRESH_SECS while the source ref moved past it.
  const movedRepo = (home: string, builtAgoS: number, moved: boolean): string => {
    const repo = gitTree(home, 'project-a', false, 'src');
    const first = commitIn(home, repo, '');
    plantBuild(home, KEY, { commit: first, built_at: isoAgo(builtAgoS) });
    if (moved) commitIn(home, repo, 'two');
    writeCensus(home, [[repoRow({ source: realpathSync(join(repo, '.git')), served: first, 'trees': 1,
      outcome: 'failed', fail: 'setup', kind: 'incremental', reason: 'setup: ccrc test --status: the test slice is not loaded' })]]);
    return repo;
  };
  it('a refresh stuck behind its source ref WARNs with the last row\'s outcome and reason', () => {
    const home = healthy('ccrc-doctor-gfx2-stuck-'); graphifyHealthy(home);
    movedRepo(home, 3 * 3600, true);
    const line = gfxVerdicts(runDoctor(home).stdout).find((l) => l.includes('refresh stuck'));
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain(KEY);
    expect(line).toContain('failed: setup: ccrc test --status: the test slice is not loaded');
  });
  it('a recent build, or a source ref that has not moved, is not stuck', () => {
    const recent = healthy('ccrc-doctor-gfx2-stuck-recent-'); graphifyHealthy(recent);
    movedRepo(recent, 600, true);
    expect(gfxVerdicts(runDoctor(recent).stdout).find((l) => l.includes('refresh stuck'))).toBeUndefined();
    const still = healthy('ccrc-doctor-gfx2-stuck-still-'); graphifyHealthy(still);
    movedRepo(still, 3 * 3600, false);
    expect(gfxVerdicts(runDoctor(still).stdout).find((l) => l.includes('refresh stuck'))).toBeUndefined();
  });

  // §8 row 7: last_full_at older than 2 x FULL_REBUILD_SECS.
  it('a last full build older than 2 x CCRC_GRAPH_FULL_REBUILD_SECS WARNs that the safety net is not running', () => {
    const home = healthy('ccrc-doctor-gfx2-safety-'); graphifyHealthy(home);
    writeCensus(home, [[repoRow({ 'trees': 1, outcome: 'fresh' })]]);
    plantBuild(home, KEY, { last_full_at: isoAgo(2 * 86400 + 3600) });
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain(`${KEY}'s last full build was 49 hours ago`);
    expect(line).toContain('the safety net is not running');
    plantBuild(home, KEY, { last_full_at: isoAgo(86400) });
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^PASS graphify:/);
  });

  // §8 rows 8 and 9: real per-tree directories (migration pending), and dangling links.
  it('trees still holding a real graphify-out directory WARN with the count and each migrate.refused path and reason', () => {
    const home = healthy('ccrc-doctor-gfx2-realdir-'); graphifyHealthy(home);
    const a = gitTree(home, 'demo', true); const b = gitTree(home, 'other', true);
    mkdirSync(join(a, 'graphify-out'), { recursive: true }); mkdirSync(join(b, 'graphify-out'), { recursive: true });
    writeCensus(home, [[repoRow({ migrate: { done: 0, pending: 1, refused: [{ path: b, reason: 'not idle: a session is live in it' }] } })]]);
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain('2 tree(s) still hold a real graphify-out directory (migration pending)');
    expect(line).toContain(`${b} (not idle: a session is live in it)`);
  });
  it('a dangling graphify-out link is a FAIL naming the tree', () => {
    const home = healthy('ccrc-doctor-gfx2-dangling-'); graphifyHealthy(home);
    const a = gitTree(home, 'demo', true);
    symlinkSync(join(storeOf(home), KEY, 'current'), join(a, 'graphify-out'));
    const line = gfxVerdicts(runDoctor(home).stdout).find((l) => l.includes('dangling'));
    expect(line).toMatch(/^FAIL graphify:/);
    expect(line).toContain('$HOME/projects/demo/graphify-out');
  });

  // §8 row 11: the tests slice not loaded on a Linux host.
  it('ccrctests.slice not loaded on Linux WARNs that builds are refused until it is installed; darwin says nothing', () => {
    const home = healthy('ccrc-doctor-gfx2-slice-'); graphifyHealthy(home);
    stubSliceSystemctl(home, 'LoadState=not-found\nMemoryMax=infinity\n');
    const line = gfxVerdicts(runCheck(home, 'linux').stdout).find((l) => l.includes('ccrctests.slice'));
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain('ccrctests.slice is not loaded, so graph builds are refused until it is installed');
    expect(gfxVerdicts(runCheck(home, 'darwin').stdout).find((l) => l.includes('ccrctests.slice'))).toBeUndefined();
    stubSliceSystemctl(home, SLICE_LOADED);
    expect(gfxVerdicts(runCheck(home, 'linux').stdout)).toEqual(['PASS graphify: engine 0.9.9, skills converged, census ok, gate on']);
  });

  // §8 row 12: the sizing (decision G5), and N29's sizing half.
  const fullRow = (outcome: string, peak: number | null): RepoRow => repoRow({ outcome, kind: 'full', peak_mem_kb: peak });
  it('a last full build above 75% of the slice\'s MemoryMax WARNs with both numbers', () => {
    const home = healthy('ccrc-doctor-gfx2-size-'); graphifyHealthy(home);
    stubSliceSystemctl(home, SLICE_LOADED);
    writeCensus(home, [[fullRow('rebuilt', 5_000_000)], [repoRow({ outcome: 'fresh' })]]);
    const line = gfxVerdicts(runCheck(home, 'linux').stdout).find((l) => l.includes('MemoryMax'));
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain(`${KEY}'s last full build peaked at 5000000 KiB, above 75% of the tests slice's MemoryMax=6442450944 (6291456 KiB)`);
    writeCensus(home, [[fullRow('rebuilt', 4_000_000)]]);
    expect(gfxVerdicts(runCheck(home, 'linux').stdout)).toEqual(['PASS graphify: engine 0.9.9, skills converged, census ok, gate on']);
  });
  it('N29: an OOM-killed last full attempt never leaves the sizing arm green, even under a later fresh row', () => {
    const home = healthy('ccrc-doctor-gfx2-oom-'); graphifyHealthy(home);
    stubSliceSystemctl(home, SLICE_LOADED);
    writeCensus(home, [[fullRow('rebuilt', 1_000_000)], [fullRow('oom-killed', null)], [repoRow({ outcome: 'fresh' })]]);
    const line = gfxVerdicts(runCheck(home, 'linux').stdout).find((l) => l.includes('OOM-killed at'));
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain(`${KEY}'s last full attempt was OOM-killed at MemoryMax=6442450944`);
  });
  it('a full build on Linux with no measured peak WARNs "peak unmeasured"; darwin says nothing', () => {
    const home = healthy('ccrc-doctor-gfx2-nopeak-'); graphifyHealthy(home);
    stubSliceSystemctl(home, SLICE_LOADED);
    writeCensus(home, [[fullRow('rebuilt', null)]]);
    const line = gfxVerdicts(runCheck(home, 'linux').stdout).find((l) => l.includes('peak unmeasured'));
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain(KEY);
    expect(gfxVerdicts(runCheck(home, 'darwin').stdout)).toEqual(['PASS graphify: engine 0.9.9, skills converged, census ok, gate on']);
  });

  // §8 row 13 and plan finding 1: the backoff WARN, with the shrink remedy; N28's doctor half.
  it('N28: a repository in full-build backoff WARNs naming it, its outcome, reason and the next allowed time, with the shrink remedy', () => {
    const home = healthy('ccrc-doctor-gfx2-backoff-'); graphifyHealthy(home);
    const at = isoAgo(3600);
    const next = new Date(Date.parse(at) + 21600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
    writeCensus(home, [[repoRow({ outcome: 'refused-shrink', kind: 'full', full_failures: 2, full_failed_at: at,
      reason: 'publish: the graph shrank by 40%, above CCRC_GRAPH_MAX_SHRINK_PCT=20' })]]);
    const out = runDoctor(home).stdout;
    const line = gfxVerdicts(out).find((l) => l.includes('backoff'));
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain(`${KEY} is in full-build backoff after 2 failed full attempts`);
    expect(line).toContain('refused-shrink: publish: the graph shrank by 40%, above CCRC_GRAPH_MAX_SHRINK_PCT=20');
    expect(line).toContain(`the next full attempt is allowed after ${next}`);
    expect(remedyOf(out, line)).toContain('set CCRC_GRAPH_MAX_SHRINK_PCT=100 in ~/.ccrc/ccrc.env until the next rebuilt row, then remove the line');
  });
  it('one failed full attempt is not backoff; CCRC_GRAPH_FULL_FAIL_MAX=1 makes it one', () => {
    const home = healthy('ccrc-doctor-gfx2-backoff-one-'); graphifyHealthy(home);
    writeCensus(home, [[repoRow({ outcome: 'fresh', full_failures: 1, full_failed_at: isoAgo(60) })]]);
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^PASS graphify:/);
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_GRAPH_FULL_FAIL_MAX=1\n');
    expect(gfxVerdicts(runDoctor(home).stdout).find((l) => l.includes('backoff'))).toMatch(/^WARN graphify:/);
  });

  // §8 row 14: N passes of skipped-slots for one repository.
  it('three passes in a row of skipped-slots for one repository WARN that the heavy queue never had room', () => {
    const home = healthy('ccrc-doctor-gfx2-slots-'); graphifyHealthy(home);
    const slot = (): RepoRow => repoRow({ outcome: 'skipped-slots', kind: 'incremental' });
    writeCensus(home, [[slot()], [slot()]]);
    expect(gfxVerdicts(runDoctor(home).stdout).find((l) => l.includes('never had room'))).toBeUndefined();
    writeCensus(home, [[slot()], [slot()], [slot()]]);
    const lines = gfxVerdicts(runDoctor(home).stdout);
    const line = lines.find((l) => l.includes('never had room'));
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain(`${KEY}: the last 3 passes were all skipped-slots`);
    expect(lines.filter((l) => l.startsWith('FAIL '))).toEqual([]);
  });

  // §8 row 16: `graph-build --probe` against the pinned engine.
  it('runs graph-build --probe under the venv interpreter with the pin, and a refusal is a FAIL with its reason', () => {
    const home = healthy('ccrc-doctor-gfx2-probe-'); graphifyHealthy(home);
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^PASS graphify:/);
    const argv = readFileSync(join(home, 'fixture-probe-argv'), 'utf8').trim().split('\n');
    expect(argv).toEqual([`-s -P ${join(home, 'ccrc', 'ccd', 'graph-build')} --probe --pin 0.9.9`]);
    writeFileSync(join(home, 'fixture-probe-fail'), 'graph-build: setup: pin: the engine is graphifyy 0.9.8, not the pinned 0.9.9\n');
    const line = gfxVerdicts(runDoctor(home).stdout).find((l) => l.includes('--probe'));
    expect(line).toMatch(/^FAIL graphify:/);
    expect(line).toContain('graph-build: setup: pin: the engine is graphifyy 0.9.8, not the pinned 0.9.9');
  });
});

describe('ccrc doctor: graphify-path', () => {
  it('PASSes when bare graphify resolves into the pinned venv', () => {
    const home = healthy('ccrc-doctor-gfxpath-ok-'); graphifyHealthy(home);
    expect(lineFor(runDoctor(home).stdout, 'graphify-path')).toMatch(/^PASS graphify-path:/);
  });

  it('FAILs when PATH resolves graphify outside the venv — a WARN understates it', () => {
    // The session runs the wrong build silently, and every answer it gets from
    // it looks exactly like an answer from the right one.
    const home = healthy('ccrc-doctor-gfxpath-shadow-'); graphifyHealthy(home);
    rmSync(join(home, '.local', 'bin', 'graphify'), { force: true });
    stub(home, 'graphify', 'echo "shadow graphify"; exit 0');
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'graphify-path')).toMatch(/^FAIL graphify-path:/);
  });

  it('FAILs when there is no graphify on PATH at all', () => {
    const home = healthy('ccrc-doctor-gfxpath-none-'); graphifyHealthy(home);
    rmSync(join(home, '.local', 'bin', 'graphify'), { force: true });
    expect(lineFor(runDoctor(home).stdout, 'graphify-path')).toMatch(/^FAIL graphify-path:/);
  });

  // D-1350: the arm that used to be folded into the mismatch FAIL. Before the
  // fix both `realpath` calls fell back to their own UNRESOLVED paths when the
  // tool was missing, and a link path is never equal to an engine path — so a
  // fully CONVERGED box without coreutils' `realpath` was told `FAIL
  // graphify-path: … which is not the pinned engine …`, a mismatch verdict on
  // a comparison nobody made, with a remedy (`ccrc install`) that cannot put
  // `realpath` on the box. "I could not measure" is the fourth outcome this
  // file's header names, and SKIP is its spelling.
  it('SKIPs — never FAILs — when the box has no usable realpath, on a CONVERGED link (D-1350)', () => {
    const home = healthy('ccrc-doctor-gfxpath-noreal-'); graphifyHealthy(home);
    // The one difference from the PASSing fixture above: `realpath` is off the
    // contained PATH. The link, the engine and the pin are all exactly as the
    // converged box has them.
    rmSync(join(home, 'stub-bin', 'realpath'), { force: true });
    const line = lineFor(runDoctor(home).stdout, 'graphify-path');
    expect(line, 'an unmeasurable box was given the mismatch verdict').toMatch(/^SKIP graphify-path:/);
    expect(line, 'the skip does not name the tool it is missing').toContain('realpath');
  });

  // …and the condition that is NOT unmeasurable keeps its FAIL. A missing
  // engine is measured directly with `-e`, so it must never be folded into the
  // skip above just because `realpath` answers empty for a path that is not
  // there.
  it('FAILs when something answers graphify but there is NO pinned engine to compare against', () => {
    const home = healthy('ccrc-doctor-gfxpath-noengine-'); graphifyHealthy(home);
    rmSync(join(home, '.local', 'bin', 'graphify'), { force: true });
    rmSync(join(home, '.ccrc', 'graphify-venv'), { recursive: true, force: true });
    stub(home, 'graphify', 'echo "some other graphify"; exit 0');
    const line = lineFor(runDoctor(home).stdout, 'graphify-path');
    expect(line).toMatch(/^FAIL graphify-path:/);
    expect(line).toContain('no pinned engine');
  });

  it('SKIPs on a server-role box, like every other graphify condition', () => {
    const home = healthy('ccrc-doctor-gfxpath-srv-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');
    expect(lineFor(runDoctor(home).stdout, 'graphify-path')).toMatch(/^SKIP graphify-path:/);
  });

  it('the graphify check no longer answers the PATH question, and its wrong remedy is gone', () => {
    // Two checks answering one question is two vocabularies over one field, and
    // the old remedy was FACTUALLY WRONG: "only the operator can clear a
    // root-owned link outside $HOME" describes neither a user-owned file inside
    // $HOME (the measured case) nor anything a session can act on.
    const checks = readFileSync(CHECKS_SRC, 'utf8');
    expect(checks, 'the old, factually wrong remedy is still in the tree')
      .not.toContain('root-owned link outside');
    expect(checks).not.toContain('gfx_shadow_warn');
  });

  it('the table and the functions agree about graphify-path', () => {
    const names = execFileSync(BASH, ['-c',
      `set -uo pipefail; . ${JSON.stringify(CHECKS_SRC)}; printf '%s\\n' "\${CCRC_DOCTOR_CHECKS[@]}"`],
    { encoding: 'utf8' }).trim().split('\n');
    expect(names).toContain('graphify-path');
  });

  // D-1354: the sibling suite's recorded reason for its `realpath` link is
  // HISTORY, and history goes stale in silence. `server/test/ccrc-doctorFixture.ts`'s
  // `healthy()` links a real `realpath` in, and the paragraph above that line is
  // the whole written reason for it. D-1350 turned the unmeasurable box from a
  // mismatch verdict into a SKIP without touching that paragraph, so the fixture
  // that seeds the biggest doctor suite went on describing the GUESSING arm --
  // the exact defect D-1350 removed -- as if it were still shipped, and the next
  // reader of `healthy()` would have learned it from there. This binds the two
  // ends together so they cannot drift apart again: the shipped arm must skip
  // rather than guess, and the paragraph must describe THAT.
  it("the sibling fixture's reason for linking `realpath` describes the SHIPPED arm (D-1354)", () => {
    // End 1 - the arm itself: "unmeasurable" is a SKIP, and neither side falls
    // back to the path it could not resolve.
    const checks = readFileSync(CHECKS_SRC, 'utf8');
    expect(checks).toContain('_dr_skip graphify-path "this box has no usable realpath');
    expect(checks, 'the unresolved-path fallback D-1350 removed is back')
      .not.toMatch(/resolved="\$found"/);
    expect(checks, 'the unresolved-path fallback D-1350 removed is back')
      .not.toMatch(/want="\$engine"/);

    // End 2 - the paragraph, read between its opening claim and the line it
    // justifies.
    const src = readFileSync(DOCTOR_TEST_SRC, 'utf8');
    const from = src.indexOf("`linkReal(home, 'realpath')` IS LOAD-BEARING");
    expect(from, 'the justification paragraph is gone -- say why the link is there')
      .toBeGreaterThan(-1);
    const to = src.indexOf("linkReal(home, 'realpath');", from);
    expect(to).toBeGreaterThan(from);
    const why = src.slice(from, to);
    expect(why, 'it still describes the pre-D-1350 arm, which guessed from the unresolved paths')
      .not.toMatch(/falls back to the UNRESOLVED/i);
    expect(why, 'it still claims the missing tool ends the run with rc=1').not.toContain('rc=1');
    expect(why, 'it still claims the missing tool FAILs this check')
      .not.toContain('FAIL graphify-path');
    expect(why, 'it does not name the verdict the shipped arm actually gives').toContain('SKIP');
    expect(why, 'it does not name the count a stray skip actually moves')
      .toContain('HEALTHY_SKIPS');
  });
});
