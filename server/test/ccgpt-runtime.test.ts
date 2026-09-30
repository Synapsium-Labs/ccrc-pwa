// `ccd/ccgpt-runtime` — the isolated LiteLLM runtime a `codex` lane runs on,
// and the behaviour probe that decides whether a build may become current
// (spec §5.2; Plan 2b-2 Task 3: D-3480, D-3481, D-3487,
// D-3484).
//
// FOUR LAYERS, because no CI box has litellm and none may reach an index:
//  (a) THE BUILDER'S DECISIONS — the real script, over a scripted fake runtime
//      python planted by a fake `python3 -m venv`. pip, the probe's verdict and
//      the version re-measure are scripted; every `-I -c` call (hash, stamp,
//      swap, stamp read) is delegated to the box's REAL python3, so the stamp,
//      the hash and the atomic swap are the real ones. This suite hand-plants
//      its own gen-*/current layouts rather than Task 4's `plantFakeRuntime`,
//      because it tests the builder itself — the second named exception to
//      ruling R28, beside Task 10's venv template (ruling R37).
//  (b) THE PROBE, HERMETIC — the real `probe-source` under the harness's real
//      python3 (no `-I`, so PYTHONPATH counts), against deletion-only copies of
//      PYSTUB_DIR. The stub never grows behaviour: each variant REMOVES a file.
//  (c) THE PROBE, REAL LITELLM — opt-in (`CCRC_TEST_LITELLM_PY=<venv python>`),
//      the control PASS plus the measured mutations. Never auto-discovered:
//      local suites are not CI, and CI has no litellm.
//  (d) DERIVATION PINS — the probe's SHIM_OUT literal is what the SHIPPED shim
//      makes of its RAW literal, and its DEPLOYMENT literal is what
//      `shared/litellm.mjs` renders; stdlib python3 only.
//
// CONTAINMENT: every HOME is `mkTmp`; `ghContainedEnv` poisons `gh`; the fake
// `python3` answers ONLY `-m venv <path>` (the install suite's positional
// contract) and refuses every other argv at 90; nothing here reaches a network,
// a user manager or the real ~/.ccrc.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync,
  realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { pythonOrSkip, runPy, PYSTUB_DIR } from './ccgptHarness.js';
import { renderLitellmConfig } from '../../shared/litellm.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
// A plain path, not `ccgptFile()`: that throws at import, and an import-time
// crash reds every case for one reason — the first case below names it instead.
const RUNTIME = path.join(REPO, 'ccd', 'ccgpt-runtime');
const SHIM = path.join(REPO, 'ccd', 'ccgpt-proxy.py');
const TEMPLATE = path.join(REPO, 'deploy', 'litellm-config.template.yaml');
const PY = pythonOrSkip();
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const GEN = /^gen-\d{8}T\d{6}Z-\d+$/;

/** The ONE requirement, read out of the shipped file — never retyped here. */
function requirement(src = readFileSync(RUNTIME, 'utf8')): string {
  const m = src.match(/^LITELLM_REQUIREMENT='([^'\n]+)'$/m);
  if (!m) throw new Error('ccd/ccgpt-runtime no longer assigns LITELLM_REQUIREMENT on one line');
  return m[1]!;
}

/** `probe-source`'s stdout, as BYTES — the exact thing the stamp hashes. */
function probeSource(script = RUNTIME): Buffer {
  const r = spawnSync(BASH, [script, 'probe-source'], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
  if (r.status !== 0) throw new Error(`probe-source exited ${String(r.status)}: ${r.stderr.toString()}`);
  return r.stdout;
}
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** A copy of the shipped script with exactly ONE substitution. Refuses a
 *  substitution that does not apply exactly once — a mutation that silently
 *  changed nothing is a green that proves nothing. */
function variant(home: string, name: string, from: string, to: string, src = readFileSync(RUNTIME, 'utf8')): string {
  expect(src.split(from).length - 1, `the substitution anchor ${JSON.stringify(from)} must occur exactly once`).toBe(1);
  const p = path.join(home, name);
  writeFileSync(p, src.replace(from, to), { mode: 0o755 });
  return p;
}

// ── layer (a): the fixture box ──────────────────────────────────────────────

/** The system `python3` the builder may call — ONLY as `-m venv <path>`, the
 *  argv the install suite's own stub matches positionally. It copies the
 *  runtime-python template into the new venv, or, with a `venv-rc` knob,
 *  makes the directory and THEN fails, so a test can prove the builder
 *  deletes a half-made venv. */
const FAKE_PYTHON3 = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$*" >> "$HOME/python3-argv"',
  'if [ "$#" -eq 3 ] && [ "$1" = -m ] && [ "$2" = venv ]; then',
  '  mkdir -p "$3/bin" || exit 1',
  '  if [ -f "$HOME/fixture-runtime/venv-rc" ]; then exit "$(cat "$HOME/fixture-runtime/venv-rc")"; fi',
  // `venv-nopy`: a venv command that answers 0 and leaves no interpreter.
  '  if [ -f "$HOME/fixture-runtime/venv-nopy" ]; then exit 0; fi',
  '  cp "$HOME/fixture-runtime/python" "$3/bin/python" && chmod 755 "$3/bin/python" || exit 1',
  '  printf \'home = /fixture\\n\' > "$3/pyvenv.cfg"',
  '  exit 0',
  'fi',
  'echo "fixture python3: unexpected argv: $*" >&2',
  'exit 90',
].join('\n') + '\n';

/** Every new generation's `bin/python`. pip, the probe verdict and the version
 *  are SCRIPTED from knob files under `$HOME/fixture-runtime/`; every other
 *  `-I -c` call is handed to the box's REAL python3 (`__REALPY__`), because
 *  the hash, the stamp write, the stamp read and the swap are the behaviour
 *  under test, not fixture. Anything else is refused at 90.
 *
 *  pip answers three shapes — `--version`, the in-venv upgrade (`pip>=…`) and
 *  the install — and models the ONE fact about real pip the builder leans on:
 *  `--report` is new in pip 22.2, so an older pip refuses it the way pip's own
 *  option parser does (exit 2, "no such option"). `pip-version` is the venv's
 *  pip before any upgrade (default 24.0; EMPTY = a `--version` that prints
 *  nothing parseable); `pip-upgrade-rc` and `pip-upgrade-to` script the
 *  upgrade; `pip-hang` (`install` or `upgrade`) makes that call never exit.
 *  Every pip call's argv lands in `pip-calls`, and its cwd and the NAMES of
 *  the PYTHON* variables it saw in `pip-context`; `pip-argv` is the install's
 *  argv alone. A call that hangs records its pid in `hung-pid` first, so a
 *  case can prove the deadline reaped it. */
const FAKE_RUNTIME_PYTHON = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$*" >> "$HOME/runtime-python-calls"',
  'F="$HOME/fixture-runtime"',
  'if [ "$1" = -m ] && [ "$2" = pip ]; then',
  '  printf \'%s\\n\' "$*" >> "$F/pip-calls"',
  '  printf \'cwd=%s python-vars=%s\\n\' "$(pwd)" "$(env | cut -d= -f1 | grep \'^PYTHON\' | LC_ALL=C sort | tr \'\\n\' \' \')" >> "$F/pip-context"',
  '  pv=24.0; [ -f "$F/pip-version" ] && pv="$(cat "$F/pip-version")"',
  '  hang="$(cat "$F/pip-hang" 2>/dev/null)"',
  '  if [ "$3" = --version ]; then',
  '    [ -n "$pv" ] && echo "pip $pv from /fixture/site-packages/pip (python 3.9)"',
  '    exit 0',
  '  fi',
  '  case " $* " in',
  '    *" pip>="*)',
  '      if [ "$hang" = upgrade ]; then echo "$$" > "$F/hung-pid"; exec sleep 30; fi',
  '      rc="$(cat "$F/pip-upgrade-rc" 2>/dev/null || echo 0)"',
  '      if [ "$rc" = 0 ]; then',
  '        to=24.0; [ -f "$F/pip-upgrade-to" ] && to="$(cat "$F/pip-upgrade-to")"',
  '        printf \'%s\\n\' "$to" > "$F/pip-version"',
  '      else',
  '        echo "ERROR: fixture: the package index is unreachable" >&2',
  '      fi',
  '      exit "$rc" ;;',
  '  esac',
  '  printf \'%s\\n\' "$@" > "$F/pip-argv"',
  '  if [ "$hang" = install ]; then echo "$$" > "$F/hung-pid"; exec sleep 30; fi',
  '  maj="${pv%%.*}"; rest="${pv#*.}"; min="${rest%%.*}"',
  '  case " $* " in',
  '    *" --report "*)',
  '      if [ -n "$pv" ] && { [ "$maj" -lt 22 ] || { [ "$maj" -eq 22 ] && [ "$min" -lt 2 ]; }; }; then',
  '        printf \'\\nUsage:\\n  pip install [options] <requirement specifier> ...\\n\\nno such option: --report\\n\' >&2',
  '        exit 2',
  '      fi ;;',
  '  esac',
  '  prev=""',
  '  for a in "$@"; do',
  '    if [ "$prev" = --report ]; then printf \'{"version": "1", "install": []}\\n\' > "$a"; fi',
  '    prev="$a"',
  '  done',
  '  exit "$(cat "$F/pip-rc" 2>/dev/null || echo 0)"',
  'fi',
  // The probe: argv EXACTLY `-I -`, its bytes on stdin — kept for the test.
  'if [ "$#" -eq 2 ] && [ "$1" = -I ] && [ "$2" = - ]; then',
  '  cat > "$F/probe-stdin"',
  '  printf \'python-vars=%s\\n\' "$(env | cut -d= -f1 | grep \'^PYTHON\' | LC_ALL=C sort | tr \'\\n\' \' \')" > "$F/probe-context"',
  '  v="$(cat "$F/verdict" 2>/dev/null)"',
  '  ver="$(cat "$F/version" 2>/dev/null)"',
  // F1: `pass:canary=<word>` (or `pass:canary=` for NO canary field at all)
  // rewrites the base verdict to plain `pass` and sets `canary` from the
  // suffix — every other verdict spelling (pass-rc1, fail:*, ...) is
  // unaffected, since none of them contain the literal `:canary=`.
  '  canary=yes',
  '  case "$v" in',
  '    *:canary=*) canary="${v#*:canary=}"; v="${v%%:canary=*}" ;;',
  '  esac',
  '  line="behaviour_probe: PASS litellm=$ver${canary:+ raw-shape-leaks-system-role=$canary}"',
  '  case "$v" in',
  '    pass) echo "$line"; exit 0 ;;',
  '    pass-rc1) echo "$line"; exit 1 ;;',
  '    pass-stderr) echo "$line" >&2; exit 0 ;;',
  '    pass-indented) echo " $line"; exit 0 ;;',
  '    fail:*) echo "behaviour_probe: FAIL ${v#fail:}"; exit 1 ;;',
  // A probe that never exits — before any verdict, or after its PASS line.
  '    hang) echo "$$" > "$F/hung-pid"; exec sleep 30 ;;',
  '    pass-hang) echo "$line"; echo "$$" > "$F/hung-pid"; exec sleep 30 ;;',
  '    *) exit 0 ;;',   // `silent`, or no verdict at all: H5's vacuous shape, the negative control
  '  esac',
  'fi',
  'case "$*" in',
  '  *importlib.metadata*) [ -f "$F/version" ] && cat "$F/version"; exit 0 ;;',
  // `sha`: a hashlib that answers something other than a digest.
  '  *hashlib*) if [ -f "$F/sha" ]; then cat "$F/sha"; exit 0; fi ;;',
  'esac',
  'if [ "$1" = -I ] && [ "$2" = -c ]; then exec \'__REALPY__\' "$@"; fi',
  'echo "fixture runtime python: unexpected argv: $*" >&2',
  'exit 90',
].join('\n') + '\n';

/** The install suite's OWN venv python, byte for byte in behaviour: records
 *  its argv, prints nothing, exits 0 for anything (`ccrc-install.test.ts`,
 *  the `-m venv` arm of its `python3` stub). m-spine H5's vacuous pass. */
const STOCK_VENV_PYTHON = '#!/bin/sh\necho "$@" >> "$HOME/venv-python-calls"\nexit 0\n';

interface Knobs {
  verdict?: string; version?: string | null; pipRc?: number; venvRc?: number;
  /** The fake pip's own version before any upgrade; `''` = unreadable; `null` = the default (24.0). */
  pipVersion?: string | null;
  pipUpgradeRc?: number;
  pipUpgradeTo?: string;
  pipHang?: 'install' | 'upgrade';
  sha?: string;
  venvNoPy?: boolean;
}

function box(prefix: string, knobs: Knobs = {}, template = FAKE_RUNTIME_PYTHON): string {
  if (!PY) throw new Error('box() needs a real python3 — guard the describe with PY');
  expect(PY.includes("'"), 'the real python3 path cannot be single-quoted into the fake').toBe(false);
  const home = mkTmp(prefix);
  mkdirSync(path.join(home, 'stub-bin'), { recursive: true });
  writeFileSync(path.join(home, 'stub-bin', 'python3'), FAKE_PYTHON3, { mode: 0o755 });
  mkdirSync(path.join(home, 'fixture-runtime'), { recursive: true });
  writeFileSync(path.join(home, 'fixture-runtime', 'python'), template.replace('__REALPY__', PY), { mode: 0o755 });
  setKnobs(home, { verdict: 'pass', version: '1.101.0', ...knobs });
  return home;
}

function setKnobs(home: string, k: Knobs): void {
  const put = (name: string, v: string | number | null | undefined): void => {
    const p = path.join(home, 'fixture-runtime', name);
    if (v === undefined) return;
    if (v === null) rmSync(p, { force: true });
    else writeFileSync(p, `${v}\n`);
  };
  put('verdict', k.verdict);
  put('version', k.version);
  put('pip-rc', k.pipRc);
  put('venv-rc', k.venvRc);
  put('pip-version', k.pipVersion);
  put('pip-upgrade-rc', k.pipUpgradeRc);
  put('pip-upgrade-to', k.pipUpgradeTo);
  put('pip-hang', k.pipHang);
  put('sha', k.sha);
  if (k.venvNoPy) put('venv-nopy', 1);
}

interface Run { code: number; stdout: string; stderr: string }
interface RunOpts {
  script?: string;
  pathDirs?: string;
  /** Extra variables for the child, over PATH and HOME. */
  env?: Record<string, string>;
  /** HOME's value: the fixture home by default; `null` OMITS it — `ghContainedEnv`
   *  REPLACES the environment rather than merging with `process.env`, so leaving
   *  the key out is a real unset, not an empty string — and any other value,
   *  including a path to a plain file, is passed through verbatim. */
  homeValue?: string | null;
}
/** The ONE runner: every case's environment is built here and nowhere else. */
function runOpts(home: string, args: string[], o: RunOpts = {}): Run {
  const base: Record<string, string> = {
    PATH: o.pathDirs ?? `${path.join(home, 'stub-bin')}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    ...(o.env ?? {}),
  };
  const homeValue = o.homeValue === undefined ? home : o.homeValue;
  if (homeValue !== null) base['HOME'] = homeValue;
  const env = ghContainedEnv(home, base);
  const r = spawnSync(BASH, [o.script ?? RUNTIME, ...args], { env, cwd: home, encoding: 'utf8', timeout: 60_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
function run(home: string, args: string[], script = RUNTIME, pathDirs?: string): Run {
  return runOpts(home, args, { script, pathDirs });
}
/** `run` with HOME under the caller's control (F4): `undefined` unsets it. */
function runWithHome(home: string, args: string[], homeValue: string | undefined): Run {
  return runOpts(home, args, { homeValue: homeValue ?? null });
}

const rtDir = (home: string): string => path.join(home, '.ccrc', 'runtime', 'codex');
function current(home: string): string | null {
  const p = path.join(rtDir(home), 'current');
  try { return lstatSync(p).isSymbolicLink() ? readlinkSync(p) : `<not a link>`; } catch { return null; }
}
const gens = (home: string): string[] =>
  existsSync(rtDir(home)) ? readdirSync(rtDir(home)).filter((n) => n.startsWith('gen-')).sort() : [];
const lines = (home: string, f: string): string[] => {
  const p = path.join(home, f);
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
function built(r: Run): string {
  expect(r.code, r.stderr).toBe(0);
  const m = r.stdout.match(/^ccgpt-runtime: built (gen-\d{8}T\d{6}Z-\d+) /);
  expect(m, `not a "built" line: ${r.stdout}`).not.toBeNull();
  return m![1]!;
}
const STAMP_KEYS = ['builtAt', 'canary', 'litellm', 'probeSha256', 'python', 'requirement'];
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `_RT_PIP_FLOOR`, read out of the shipped file — never retyped here. */
function pipFloor(src = readFileSync(RUNTIME, 'utf8')): string {
  const m = src.match(/^_RT_PIP_FLOOR='(\d+\.\d+)'$/m);
  if (!m) throw new Error('ccd/ccgpt-runtime no longer assigns _RT_PIP_FLOOR on one line');
  return m[1]!;
}
/** One function of the shipped file, whole — to drive a guard that no fixture
 *  can reach without also reaching everything around it. */
function fnSource(name: string, src = readFileSync(RUNTIME, 'utf8')): string {
  const m = new RegExp(`^${name}\\(\\) \\{[^\\n]*\\n[\\s\\S]*?\\n\\}\\n`, 'm').exec(src);
  expect(m, `${name} not found in ccd/ccgpt-runtime`).not.toBeNull();
  return m![0];
}
const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};
const failLine = (stage: string, detail: RegExp): RegExp =>
  new RegExp(`^ccgpt-runtime: build failed at ${stage}: ${detail.source} — the previous runtime \\(if any\\) stays current\\n$`);

it('ships ccd/ccgpt-runtime, executable, and says so before anything below runs it', () => {
  expect(existsSync(RUNTIME), 'ccd/ccgpt-runtime is not in the tree').toBe(true);
  expect(lstatSync(RUNTIME).mode & 0o111, 'ccd/ccgpt-runtime is not executable').toBeGreaterThan(0);
  expect(readFileSync(RUNTIME, 'utf8').startsWith('#!/usr/bin/env bash\n')).toBe(true);
});

describe.skipIf(!PY)('ccgpt-runtime: the builder\'s decisions, over a scripted runtime python', () => {
  it('refuses a verb or flag it does not know at exit 1, and writes nothing', () => {
    const home = box('ccgpt-rt-usage-');
    for (const args of [[], ['bogus'], ['build', '--bogus'], ['build', '--force', 'x'], ['check', 'x']]) {
      const r = run(home, args);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.stderr, args.join(' ')).toMatch(/^usage: ccgpt-runtime build \[--force\] \| check \| python \| probe-source$/m);
    }
    expect(existsSync(path.join(home, '.ccrc'))).toBe(false);
  });

  it('refuses to build with no python3 on PATH, at exit 1, before it creates anything', () => {
    const home = box('ccgpt-rt-nopy-');
    const empty = path.join(home, 'empty-bin');
    mkdirSync(empty);
    const r = run(home, ['build'], RUNTIME, empty);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/^ccgpt-runtime: python3 is not on PATH/m);
    expect(existsSync(rtDir(home))).toBe(false);
  });

  // F4: `_rt_need_home` is the interfaces' "no HOME" refusal, called first
  // thing by build, check AND python — pinned here for the two verbs the
  // finding names; nothing is created, and the same one-line sentence
  // (`say`'s exact text) comes back for both "unset" and "set, not a
  // directory", because `_rt_need_home` tests both with the same `||`.
  it('refuses build and check with no HOME at all, at exit 1, before it creates anything', () => {
    const home = box('ccgpt-rt-nohome-');
    for (const args of [['build'], ['check']]) {
      const r = runWithHome(home, args, undefined);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.stdout, args.join(' ')).toBe('');
      expect(r.stderr, args.join(' ')).toBe('ccgpt-runtime: HOME is not set to a directory — nothing was read or built\n');
    }
    expect(existsSync(path.join(home, '.ccrc'))).toBe(false);
  });

  it('refuses build and check when HOME points at a non-directory, at exit 1', () => {
    const home = box('ccgpt-rt-home-notdir-');
    const notDir = path.join(home, 'not-a-directory');
    writeFileSync(notDir, 'x');
    for (const args of [['build'], ['check']]) {
      const r = runWithHome(home, args, notDir);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.stdout, args.join(' ')).toBe('');
      expect(r.stderr, args.join(' ')).toBe('ccgpt-runtime: HOME is not set to a directory — nothing was read or built\n');
    }
  });

  it('a passing build makes one generation current, by a relative symlink, and says so in one line', () => {
    const home = box('ccgpt-rt-pass-');
    const r = run(home, ['build']);
    const gen = built(r);
    expect(r.stdout).toBe(`ccgpt-runtime: built ${gen} litellm=1.101.0 raw-shape-leaks-system-role=yes (absent; previous: none)\n`);
    expect(r.stderr).toBe('');
    expect(gen).toMatch(GEN);
    expect(gens(home)).toEqual([gen]);
    // RELATIVE, one hop: the swap names the generation, never an absolute path.
    expect(current(home)).toBe(gen);
    // The system python3 was asked for ONE thing, in the positional shape.
    expect(lines(home, 'python3-argv')).toEqual([`-m venv ${path.join(rtDir(home), gen)}`]);
  });

  it('installs exactly the declared requirement, with a pip report, into the generation\'s own interpreter', () => {
    const home = box('ccgpt-rt-pip-');
    const gen = built(run(home, ['build']));
    const g = path.join(rtDir(home), gen);
    expect(lines(home, 'fixture-runtime/pip-argv')).toEqual([
      '-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '--no-input',
      '--report', path.join(g, '.ccrc-pip-report.json'), requirement(),
    ]);
  });

  it('runs the probe as `-I -` with EXACTLY probe-source\'s bytes, and stamps their hash', () => {
    const home = box('ccgpt-rt-probe-bytes-');
    const gen = built(run(home, ['build']));
    const src = probeSource();
    expect(readFileSync(path.join(home, 'fixture-runtime', 'probe-stdin')).equals(src),
      'the probe that ran is not the probe probe-source prints').toBe(true);
    expect(lines(home, 'runtime-python-calls')).toContain('-I -');
    const text = readFileSync(path.join(rtDir(home), gen, '.ccrc-runtime.json'), 'utf8');
    const stamp = JSON.parse(text) as Record<string, string>;
    expect(Object.keys(stamp).sort()).toEqual(STAMP_KEYS);
    expect(stamp['probeSha256']).toBe(sha256(src));
    expect(stamp['requirement']).toBe(requirement());
    expect(stamp['litellm']).toBe('1.101.0');
    expect(stamp['canary']).toBe('raw-shape-leaks-system-role=yes');
    expect(stamp['python']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(stamp['builtAt']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    // json.dump DEFAULTS, written by python — `", "` and `": "`, not a compact line.
    expect(text).toMatch(/^\{"requirement": "[^"]+", "probeSha256": "[0-9a-f]{64}", /);
  });

  // RESIDUAL (the re-review's R2-1): the probe's bound must not cost it its
  // stdin. `_rt_timeout`'s pure-bash arm — the one a box with neither
  // `timeout` nor `gtimeout` takes, which is stock macOS — runs `"$@" &`, and
  // bash hands an async command /dev/null unless it carries a stdin
  // redirection of its OWN. A `< probe.py` on the CALL is not its own, so the
  // probe read nothing and every build failed at `probe` (measured, 68beba7e).
  // The link farm is this case's PATH: every name the runner's PATH resolves,
  // first spelling wins, except the two deadline binaries.
  it('builds on a PATH with no timeout and no gtimeout, and the probe still reads EXACTLY probe-source\'s bytes', () => {
    const home = box('ccgpt-rt-no-timeout-');
    const farm = path.join(home, 'no-timeout-bin');
    mkdirSync(farm);
    const seen = new Set<string>(['timeout', 'gtimeout']);
    for (const dir of [path.join(home, 'stub-bin'), ...(process.env.PATH ?? '/usr/bin:/bin').split(':')]) {
      let names: string[] = [];
      try { names = readdirSync(dir); } catch { continue; }
      for (const n of names) {
        if (seen.has(n)) continue;
        seen.add(n);
        symlinkSync(path.join(dir, n), path.join(farm, n));
      }
    }
    // The control: under this PATH neither spelling of the bound resolves, so
    // the build below takes the pure-bash arm.
    const which = spawnSync(BASH, ['-c', 'command -v timeout; command -v gtimeout; exit 0'],
      { env: { PATH: farm }, encoding: 'utf8' });
    expect(which.stdout, 'the link farm still resolves a deadline binary').toBe('');
    const gen = built(runOpts(home, ['build'], { pathDirs: farm }));
    expect(readFileSync(path.join(home, 'fixture-runtime', 'probe-stdin')).equals(probeSource()),
      'the probe that ran under the pure-bash bound did not read probe-source\'s bytes').toBe(true);
    expect(lines(home, 'runtime-python-calls')).toContain('-I -');
    expect(current(home)).toBe(gen);
  });

  // F1: the canary has a THIRD value, `unknown` — and the builder normalises
  // anything it does not recognise (a stray word, or no field at all) to
  // `unknown` too, both in the built line and in the stamp. `no` and
  // `unknown` are valid canary words already, so they pass through
  // unchanged; `bogus` and a PASS line with no canary field at all do not.
  it.each([
    ['pass:canary=no', 'no'],
    ['pass:canary=unknown', 'unknown'],
    ['pass:canary=bogus', 'unknown'],
    ['pass:canary=', 'unknown'],
  ] as Array<[string, string]>)('canary %s normalises to raw-shape-leaks-system-role=%s, in the built line and the stamp', (verdict, want) => {
    const home = box('ccgpt-rt-canary-', { verdict });
    const r = run(home, ['build']);
    const gen = built(r);
    expect(r.stdout).toBe(`ccgpt-runtime: built ${gen} litellm=1.101.0 raw-shape-leaks-system-role=${want} (absent; previous: none)\n`);
    const stamp = JSON.parse(readFileSync(path.join(rtDir(home), gen, '.ccrc-runtime.json'), 'utf8')) as Record<string, string>;
    expect(stamp['canary']).toBe(`raw-shape-leaks-system-role=${want}`);
  });

  it('a second build rebuilds nothing, and names the current generation instead', () => {
    const home = box('ccgpt-rt-idem-');
    const gen = built(run(home, ['build']));
    const again = run(home, ['build']);
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout).toBe(`ccgpt-runtime: current ${gen} litellm=1.101.0\n`);
    expect(lines(home, 'python3-argv').filter((l) => l.startsWith('-m venv '))).toHaveLength(1);
    expect(gens(home)).toEqual([gen]);
  });

  it('check: absent before a build, current after — the word on stderr, the answer on stdout', () => {
    const home = box('ccgpt-rt-check-');
    const before = run(home, ['check']);
    expect(before).toEqual({ code: 1, stdout: '', stderr: 'ccgpt-runtime: absent\n' });
    const gen = built(run(home, ['build']));
    const after = run(home, ['check']);
    expect(after).toEqual({ code: 0, stdout: `ccgpt-runtime: current ${gen} litellm=1.101.0\n`, stderr: '' });
  });

  it('python prints the RESOLVED generation\'s interpreter, never a path through current', () => {
    const home = box('ccgpt-rt-python-');
    expect(run(home, ['python'])).toEqual({ code: 1, stdout: '', stderr: 'ccgpt-runtime: absent\n' });
    const gen = built(run(home, ['build']));
    const r = run(home, ['python']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(`${path.join(rtDir(home), gen, 'bin', 'python')}\n`);
    expect(r.stdout).not.toContain('/current/');
    expect(realpathSync(path.dirname(path.dirname(r.stdout.trim()))))
      .toBe(realpathSync(path.join(rtDir(home), 'current')));
  });

  it('a `current` this file did not make is absent, never followed — even onto a working venv', () => {
    const home = box('ccgpt-rt-foreign-current-');
    const gen = built(run(home, ['build']));
    const link = path.join(rtDir(home), 'current');
    // A relative link to a COMPLETE copy of the generation, under a name that
    // is not a generation's: everything a verdict reads is there and valid.
    cpSync(path.join(rtDir(home), gen), path.join(rtDir(home), 'hand-made'), { recursive: true });
    rmSync(link);
    symlinkSync('hand-made', link);
    expect(run(home, ['check'])).toEqual({ code: 1, stdout: '', stderr: 'ccgpt-runtime: absent\n' });
    expect(run(home, ['python'])).toEqual({ code: 1, stdout: '', stderr: 'ccgpt-runtime: absent\n' });
    // An absolute link to the very generation this file built: the right
    // target, the wrong shape.
    rmSync(link);
    symlinkSync(path.join(rtDir(home), gen), link);
    expect(run(home, ['check'])).toEqual({ code: 1, stdout: '', stderr: 'ccgpt-runtime: absent\n' });
  });

  it('rebuilds when the declared requirement moves, and stamps the new one', () => {
    const home = box('ccgpt-rt-req-moved-');
    const g1 = built(run(home, ['build']));
    const req = requirement();
    const moved = variant(home, 'ccgpt-runtime.req-moved',
      `LITELLM_REQUIREMENT='${req}'`, `LITELLM_REQUIREMENT='${req},!=0.0.1'`);
    expect(run(home, ['check'], moved)).toEqual({ code: 1, stdout: '', stderr: 'ccgpt-runtime: requirement-moved\n' });
    const r = run(home, ['build'], moved);
    const g2 = built(r);
    expect(r.stdout).toMatch(new RegExp(`\\(requirement-moved; previous: ${g1}\\)\\n$`));
    const stamp = JSON.parse(readFileSync(path.join(rtDir(home), g2, '.ccrc-runtime.json'), 'utf8'));
    expect(stamp.requirement).toBe(`${req},!=0.0.1`);
  });

  it('rebuilds when the probe\'s bytes move — one comment line is enough', () => {
    const home = box('ccgpt-rt-probe-moved-');
    const g1 = built(run(home, ['build']));
    const moved = variant(home, 'ccgpt-runtime.probe-moved',
      '\nMODEL, TOP, MID = ', '\n# a probe edit, nothing more\nMODEL, TOP, MID = ');
    expect(run(home, ['check'], moved)).toEqual({ code: 1, stdout: '', stderr: 'ccgpt-runtime: probe-moved\n' });
    const r = run(home, ['build'], moved);
    const g2 = built(r);
    expect(r.stdout).toMatch(new RegExp(`\\(probe-moved; previous: ${g1}\\)\\n$`));
    const stamp = JSON.parse(readFileSync(path.join(rtDir(home), g2, '.ccrc-runtime.json'), 'utf8'));
    expect(stamp.probeSha256).toBe(sha256(probeSource(moved)));
    expect(stamp.probeSha256).not.toBe(sha256(probeSource()));
  });

  it('rebuilds a generation that no longer matches its own stamp (mutated)', () => {
    const home = box('ccgpt-rt-mutated-');
    const g1 = built(run(home, ['build']));
    setKnobs(home, { version: '1.101.1' });   // the installed litellm changed under the stamp
    expect(run(home, ['check'])).toEqual({ code: 1, stdout: '', stderr: 'ccgpt-runtime: mutated\n' });
    const r = run(home, ['build']);
    const g2 = built(r);
    expect(r.stdout).toBe(`ccgpt-runtime: built ${g2} litellm=1.101.1 raw-shape-leaks-system-role=yes (mutated; previous: ${g1})\n`);
    // A stamp that is gone is the same word, for check AND python.
    rmSync(path.join(rtDir(home), g2, '.ccrc-runtime.json'));
    expect(run(home, ['check'])).toEqual({ code: 1, stdout: '', stderr: 'ccgpt-runtime: mutated\n' });
    expect(run(home, ['python'])).toEqual({ code: 1, stdout: '', stderr: 'ccgpt-runtime: mutated\n' });
  });

  // Every failure: exit 2, ONE stderr line naming the stage, nothing on stdout,
  // the half-built generation GONE and `current` exactly where it was.
  it.each([
    ['venv', { venvRc: 1 }, /python3 -m venv exited non-zero/],
    // B1: the sentence names pip's exit and its own last line, never a guess at the cause.
    ['pip', { pipRc: 1 }, /pip could not install \S+ \(exit 1\)/],
    ['probe', { verdict: 'fail:authenticator-import: ImportError: fixture' }, /authenticator-import: ImportError: fixture/],
    ['probe', { verdict: 'silent' }, /exit 0 and no 'behaviour_probe: PASS' line on stdout/],
    ['probe', { verdict: 'pass-rc1' }, /exit 1 despite a PASS line — both are required/],
    ['probe', { verdict: 'pass-stderr' }, /exit 0 and no 'behaviour_probe: PASS' line on stdout \(stderr: behaviour_probe: PASS .*\)/],
    ['probe', { verdict: 'pass-indented' }, /exit 0 and no 'behaviour_probe: PASS' line on stdout/],
    ['stamp', { version: null }, /the new generation passed its probe but cannot report its litellm version/],
  ] as Array<[string, Knobs, RegExp]>)('fails at %s (%o): deletes the new generation, keeps current', (stage, knobs, detail) => {
    const home = box('ccgpt-rt-fail-');
    const g1 = built(run(home, ['build']));
    setKnobs(home, knobs);
    const r = run(home, ['build', '--force']);
    expect(r.code, r.stderr).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(failLine(stage, detail));
    expect(current(home)).toBe(g1);
    expect(gens(home)).toEqual([g1]);
  });

  it('the install suite\'s own venv python — exit 0 for anything, no stdout — fails the probe (H5)', () => {
    const home = box('ccgpt-rt-stock-', {}, STOCK_VENV_PYTHON);
    const r = run(home, ['build']);
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toMatch(failLine('probe', /exit 0 and no 'behaviour_probe: PASS' line on stdout/));
    expect(current(home)).toBeNull();
    expect(gens(home)).toEqual([]);
  });

  // ── the pip stage measures pip first (final review B1) ────────────────────
  // `pip install --report` is new in pip 22.2, and a fresh venv's pip is
  // ensurepip's (22.0.2 on Ubuntu 22.04, 21.2.4 under Apple's python3). The
  // fake pip refuses `--report` below 22.2 exactly as pip's option parser does.
  const pipCalls = (home: string): string[] => lines(home, 'fixture-runtime/pip-calls');
  const upgradeCall = (): string => `-m pip install --quiet --disable-pip-version-check --no-input pip>=${pipFloor()}`;
  const installCall = (home: string, gen: string): string =>
    `-m pip install --quiet --disable-pip-version-check --no-input --report ${path.join(rtDir(home), gen, '.ccrc-pip-report.json')} ${requirement()}`;

  it.each(['21.2.4', '22.0.2', '22.1.2'])('pip %s: upgraded INSIDE the venv first, bounded and non-interactive, then the install runs on it', (old) => {
    const home = box('ccgpt-rt-oldpip-', { pipVersion: old });
    const gen = built(run(home, ['build']));
    expect(pipCalls(home)).toEqual(['-m pip --version', upgradeCall(), '-m pip --version', installCall(home, gen)]);
  });

  it('control: the same old pip with the upgrade removed fails at pip on `--report` — the fake models the hazard', () => {
    const home = box('ccgpt-rt-oldpip-control-', { pipVersion: '21.2.4' });
    const noUpgrade = variant(home, 'ccgpt-runtime.no-upgrade',
      'if [ -n "$pipv" ] && ! _rt_pip_ok "$pipv"; then', 'if false; then');
    const r = run(home, ['build'], noUpgrade);
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toMatch(failLine('pip', /pip could not install \S+ \(exit 2\): no such option: --report/));
  });

  it('a pip at or above the floor is left alone: one install, no upgrade', () => {
    for (const v of [pipFloor(), '24.0', '26.2.1']) {
      const home = box('ccgpt-rt-newpip-', { pipVersion: v });
      const gen = built(run(home, ['build']));
      expect(pipCalls(home), v).toEqual(['-m pip --version', installCall(home, gen)]);
    }
  });

  it('a pip whose version cannot be read is left alone, and the install is what answers', () => {
    const home = box('ccgpt-rt-pip-unread-', { pipVersion: '' });
    const gen = built(run(home, ['build']));
    expect(pipCalls(home)).toEqual(['-m pip --version', installCall(home, gen)]);
  });

  it.each([
    ['fails', { pipUpgradeRc: 1 }, 'exit 1: ERROR: fixture: the package index is unreachable'],
    ['exits 0 and leaves pip old', { pipUpgradeTo: '22.0.2' }, 'exit 0, and pip then reported 22\\.0\\.2'],
  ] as Array<[string, Knobs, string]>)('an upgrade that %s is pip-too-old: named, the remedy first, NOTHING installed, current kept', (_label, knobs, how) => {
    const home = box('ccgpt-rt-pip-too-old-');
    const g1 = built(run(home, ['build']));
    rmSync(path.join(home, 'fixture-runtime', 'pip-calls'));
    setKnobs(home, { pipVersion: '21.2.4', ...knobs });
    const r = run(home, ['build', '--force']);
    expect(r.code, r.stderr).toBe(2);
    expect(r.stdout).toBe('');
    const floor = esc(pipFloor());
    expect(r.stderr).toMatch(failLine('pip', new RegExp(
      `pip-too-old: the new venv's pip is 21\\.2\\.4, older than the ${floor} this build needs \\(install --report\\), `
      + `so nothing was installed; make the package index reachable, or use a python3 whose venv ships pip >= ${floor}\\. `
      + `The in-venv upgrade: ${how}`)));
    expect(pipCalls(home).filter((c) => c.includes('--report')), 'the install ran on a pip too old for it').toEqual([]);
    expect(current(home)).toBe(g1);
    expect(gens(home)).toEqual([g1]);
  });

  // ── pip sees no PYTHON* variable and runs from the generation (B2) ────────
  it('pip runs from the generation with every PYTHON* variable unset, so a PYTHONPATH litellm cannot satisfy it', () => {
    const home = box('ccgpt-rt-pip-isolated-', { pipVersion: '21.2.4' });
    const planted = path.join(home, 'planted-site');
    mkdirSync(path.join(planted, 'litellm-1.101.0.dist-info'), { recursive: true });
    writeFileSync(path.join(planted, 'litellm-1.101.0.dist-info', 'METADATA'),
      'Metadata-Version: 2.1\nName: litellm\nVersion: 1.101.0\n');
    const r = runOpts(home, ['build'], { env: {
      PYTHONPATH: planted, PYTHONHOME: path.join(home, 'no-such-prefix'), PYTHONUSERBASE: planted,
      PYTHONPLATLIBDIR: 'lib-elsewhere',
    } });
    const gen = built(r);
    const ctx = lines(home, 'fixture-runtime/pip-context');
    // Every pip call: the version reads, the upgrade and the install.
    expect(ctx).toHaveLength(4);
    for (const c of ctx) expect(c).toBe(`cwd=${path.join(rtDir(home), gen)} python-vars=`);
    // Control: the variables DID reach the builder — its probe, which runs
    // under `-I` and needs no scrub, was handed all four.
    expect(lines(home, 'fixture-runtime/probe-context'))
      .toEqual(['python-vars=PYTHONHOME PYTHONPATH PYTHONPLATLIBDIR PYTHONUSERBASE ']);
  });

  // ── every step that can wait on something else has a deadline (B4) ────────
  it.each([
    ['pip', { pipHang: 'install' }, { CCRC_RUNTIME_PIP_S: '1' },
      /timed-out: pip did not finish installing \S+ within 1s \(CCRC_RUNTIME_PIP_S sets the bound\)/],
    ['pip', { pipVersion: '21.2.4', pipHang: 'upgrade' }, { CCRC_RUNTIME_PIP_S: '1' },
      /pip-too-old: .* The in-venv upgrade: timed out after 1s/],
    ['probe', { verdict: 'hang' }, { CCRC_RUNTIME_PROBE_S: '1' },
      /timed-out: the probe did not exit within 1s \(CCRC_RUNTIME_PROBE_S sets the bound\)/],
    ['probe', { verdict: 'pass-hang' }, { CCRC_RUNTIME_PROBE_S: '1' },
      /timed-out: the probe did not exit within 1s, after its PASS line \(CCRC_RUNTIME_PROBE_S sets the bound\)/],
  ] as Array<[string, Knobs, Record<string, string>, RegExp]>)('a %s step that never exits (%o) hits its deadline: named, reaped, current kept', (stage, knobs, env, detail) => {
    const home = box('ccgpt-rt-deadline-');
    const g1 = built(run(home, ['build']));
    setKnobs(home, knobs);
    const t0 = Date.now();
    const r = runOpts(home, ['build', '--force'], { env });
    const ms = Date.now() - t0;
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toMatch(failLine(stage, detail));
    // The hung step sleeps 30 s: only a deadline returns well inside that.
    expect(ms, 'the build waited the hung step out').toBeLessThan(25_000);
    const pid = Number(readFileSync(path.join(home, 'fixture-runtime', 'hung-pid'), 'utf8').trim());
    expect(pid, 'the hung step never ran').toBeGreaterThan(0);
    expect(alive(pid), `the hung step (pid ${pid}) outlived its deadline`).toBe(false);
    expect(current(home)).toBe(g1);
    expect(gens(home)).toEqual([g1]);
  });

  it('_rt_secs: a deadline that is empty, not digits, too long or zero falls back to the default, never to unbounded', () => {
    const cases: Array<[string, string]> = [
      ['', '9'], ['x', '9'], ['-3', '9'], ['1.5', '9'], ['0', '9'], ['00', '9'], ['12345', '9'],
      ['07', '7'], ['5', '5'], ['9999', '9999'],
    ];
    const prog = `set -u\n${fnSource('_rt_secs')}for v in ${cases.map(([v]) => `'${v}'`).join(' ')}; do _rt_secs "$v" 9; echo; done\n`;
    const r = spawnSync(BASH, ['-c', prog], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.split('\n').slice(0, -1)).toEqual(cases.map(([, want]) => want));
  });

  it("_rt_timeout carries _plat_timeout's body byte for byte — the copy cannot drift", () => {
    // `ccd-account-auth`'s `_auth_timeout` precedent, pinned the same way in
    // `ccd-account-auth.test.ts`: this file sources nothing, so a local copy is
    // the only shape available, and BYTE equality — comments included — is
    // what makes it a copy somebody is watching.
    const body = (src: string, name: string): string => {
      const m = new RegExp(`${name}\\(\\) \\{[^\\n]*\\n([\\s\\S]*?)\\n\\}`).exec(src);
      expect(m, `${name} not found`).not.toBeNull();
      return m![1]!;
    };
    const ccrc = readFileSync(path.join(REPO, 'ccd', 'ccrc'), 'utf8');
    expect(body(readFileSync(RUNTIME, 'utf8'), '_rt_timeout')).toBe(body(ccrc, '_plat_timeout'));
  });

  // ── the builder's remaining guards (final-review residue, Task 3) ─────────
  it('refuses at exit 1, before any venv, when ~/.ccrc/runtime/codex cannot be created', () => {
    const home = box('ccgpt-rt-no-rt-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'runtime'), 'a regular file where a directory must go\n');
    const r = run(home, ['build']);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`^ccgpt-runtime: cannot create ${esc(rtDir(home))} — nothing was built$`, 'm'));
    expect(lines(home, 'python3-argv'), 'a venv was attempted').toEqual([]);
  });

  it('refuses at exit 1 to build over a generation directory that already exists, and leaves it untouched', () => {
    const home = box('ccgpt-rt-gen-taken-');
    // A `date` that answers the generation stamp with a fixed time and, first,
    // makes the directory that name points at. `$(date …)` execs date straight
    // from the builder's shell, so date's parent IS the builder's `$$`
    // (measured, bash 5.2); its grandparent is planted too, for a bash that forks twice.
    writeFileSync(path.join(home, 'stub-bin', 'date'), [
      '#!/bin/sh',
      'if [ "$*" = "-u +%Y%m%dT%H%M%SZ" ]; then',
      '  for p in "$PPID" "$(ps -o ppid= -p "$PPID" | tr -d " ")"; do',
      '    d="$HOME/.ccrc/runtime/codex/gen-20260101T000000Z-$p"; mkdir -p "$d" && : > "$d/keep"',
      '  done',
      '  echo 20260101T000000Z; exit 0',
      'fi',
      'exec /bin/date "$@"',
    ].join('\n') + '\n', { mode: 0o755 });
    const r = run(home, ['build']);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/^ccgpt-runtime: \S+\/gen-20260101T000000Z-\d+ already exists — refusing to build over it; nothing was changed$/m);
    expect(lines(home, 'python3-argv'), 'a venv was built over it').toEqual([]);
    for (const g of gens(home)) expect(readdirSync(path.join(rtDir(home), g)), g).toEqual(['keep']);
  });

  it('a venv that leaves no executable bin/python fails at venv, and is deleted', () => {
    const home = box('ccgpt-rt-venv-nopy-', { venvNoPy: true });
    const r = run(home, ['build']);
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toMatch(failLine('venv', /the new venv has no executable bin\/python/));
    expect(gens(home)).toEqual([]);
  });

  it('a probe hash that is not a sha256 hex digest fails the stamp stage — nothing unverifiable is stamped', () => {
    const home = box('ccgpt-rt-bad-sha-', { sha: 'not-a-digest' });
    const r = run(home, ['build']);
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toMatch(failLine('stamp', /could not hash the probe that ran/));
    expect(current(home)).toBeNull();
    expect(gens(home)).toEqual([]);
  });

  it.each([
    ['an empty requirement', (s: Record<string, unknown>) => ({ ...s, requirement: '' })],
    ['a newline inside the litellm version', (s: Record<string, unknown>) => ({ ...s, litellm: `${String(s['litellm'])}\nsmuggled` })],
    ['a non-string field', (s: Record<string, unknown>) => ({ ...s, probeSha256: 7 })],
  ] as Array<[string, (s: Record<string, unknown>) => Record<string, unknown>]>)('a stamp with %s reads as mutated: check trusts no field it cannot read whole', (_label, edit) => {
    const home = box('ccgpt-rt-read-py-');
    const gen = built(run(home, ['build']));
    const p = path.join(rtDir(home), gen, '.ccrc-runtime.json');
    writeFileSync(p, `${JSON.stringify(edit(JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>))}\n`);
    expect(run(home, ['check'])).toEqual({ code: 1, stdout: '', stderr: 'ccgpt-runtime: mutated\n' });
  });

  it('_rt_fail deletes only a gen-* under $RT: never a path outside it, never current\'s target', () => {
    const home = mkTmp('ccgpt-rt-fail-scope-');
    const rt = path.join(home, 'rt');
    const inside = path.join(rt, 'gen-20260101T000000Z-1');
    const outside = path.join(home, 'gen-20260101T000000Z-1');   // gen-shaped, outside $RT
    const other = path.join(rt, 'hand-made');                     // under $RT, not gen-shaped
    for (const d of [inside, outside, other]) mkdirSync(d, { recursive: true });
    const prog = [
      'set -u', "say() { printf '%s\\n' \"$1\" >&2; }", fnSource('_rt_fail'), `RT=${JSON.stringify(rt)}`,
      ...[outside, other, inside].map((d) => `_rt_fail pip ${JSON.stringify(d)} fixture`),
    ].join('\n');
    const r = spawnSync(BASH, ['-c', prog], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr.split('\n').filter(Boolean)).toHaveLength(3);
    expect(existsSync(outside), 'a gen-shaped path OUTSIDE $RT was deleted').toBe(true);
    expect(existsSync(other), 'a non-generation under $RT was deleted').toBe(true);
    expect(existsSync(inside), 'control: the half-built generation itself').toBe(false);
  });

  it('a swap that cannot happen deletes the new generation and leaves what was there untouched', () => {
    const home = box('ccgpt-rt-swap-');
    mkdirSync(path.join(rtDir(home), 'current', 'keep'), { recursive: true });
    const r = run(home, ['build']);
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toMatch(failLine('swap', /could not point \S+ at gen-\S+ \(is current a real directory\?\)/));
    expect(lstatSync(path.join(rtDir(home), 'current')).isDirectory()).toBe(true);
    expect(existsSync(path.join(rtDir(home), 'current', 'keep'))).toBe(true);
    expect(gens(home)).toEqual([]);
  });

  it('prune keeps the new current and the one it replaced, and removes the rest', () => {
    const home = box('ccgpt-rt-prune-');
    const g1 = built(run(home, ['build']));
    const g2 = built(run(home, ['build', '--force']));
    expect(gens(home)).toEqual([g1, g2].sort());
    const r3 = run(home, ['build', '--force']);
    const g3 = built(r3);
    expect(r3.stdout).toMatch(new RegExp(`\\(forced; previous: ${g2}\\)\\n$`));
    expect(gens(home)).toEqual([g2, g3].sort());
    expect(current(home)).toBe(g3);
  });

  it('prune never removes a generation a tier was started from, or one another build is still writing', () => {
    const home = box('ccgpt-rt-prune-keep-');
    const g1 = built(run(home, ['build']));
    const started = path.join(home, '.ccrc', 'codex', 'codex-a', 'litellm.started');
    mkdirSync(path.dirname(started), { recursive: true });
    writeFileSync(started, JSON.stringify({ generation: path.join(rtDir(home), g1), code: 'fixture' }));
    const live = `gen-20260101T000000Z-${process.pid}`;        // this test's own process: alive
    const dead = 'gen-20260101T000000Z-999999999';             // above any pid_max: never alive
    const foreign = 'gen-not-a-generation-name';
    for (const d of [live, dead, foreign]) mkdirSync(path.join(rtDir(home), d));
    built(run(home, ['build', '--force']));
    const g3 = built(run(home, ['build', '--force']));
    expect(gens(home)).toContain(g1);        // named by a tier's .started
    expect(gens(home)).toContain(live);      // another build's staging
    expect(gens(home)).toContain(foreign);   // not gen-shaped: never ours to judge
    expect(gens(home)).not.toContain(dead);  // a dead build's leftover
    rmSync(started);
    const g4 = built(run(home, ['build', '--force']));
    expect(gens(home)).not.toContain(g1);
    expect(gens(home)).toEqual([g3, g4, live, foreign].sort());
  });
});

// ── layer (b): the probe, hermetic ─────────────────────────────────────────

/** True when the harness python3, in a fixture HOME with no PYTHONPATH,
 *  cannot import ANY litellm — the precondition for the "no litellm at all"
 *  variant, which a box with a system-wide litellm cannot construct by
 *  deletion. `ccgpt-usage.test.ts`'s NO_AMBIENT_LITELLM, same reasoning. */
const NO_AMBIENT_LITELLM: boolean = (() => {
  if (!PY) return false;
  const home = mkTmp('ccgpt-rt-ambient-');
  const f = path.join(home, 'imp.py');
  writeFileSync(f, 'import litellm\n');
  return runPy(f, { home, env: { LITELLM_LOCAL_MODEL_COST_MAP: 'True' } }).status !== 0;
})();

it('this box hides litellm from a fixture HOME with no PYTHONPATH (layer (b) precondition)', () => {
  if (process.env.CI) expect(NO_AMBIENT_LITELLM).toBe(true);
});

/** Runs the REAL probe-source under the harness python3 — WITHOUT `-I`, so the
 *  PYTHONPATH below is honoured — with its temp dir redirected into the
 *  fixture so a leak is visible. */
function runProbe(home: string, pythonpath: string, extra: Record<string, string> = {}, python?: string) {
  const f = path.join(home, 'probe.py');
  writeFileSync(f, probeSource());
  const tmp = path.join(home, 'tmp');
  mkdirSync(tmp, { recursive: true });
  const r = runPy(f, {
    home, python, timeoutMs: 120_000,
    env: { PYTHONPATH: pythonpath, TMPDIR: tmp, LITELLM_LOCAL_MODEL_COST_MAP: 'True', ...extra },
  });
  return { ...r, leftInTmp: readdirSync(tmp) };
}

/** A copy of PYSTUB_DIR with the named paths REMOVED — deletion only; each
 *  must exist first, so a stale name cannot make a variant identical to the
 *  unmodified stub. */
function stubWithout(home: string, drop: string[]): string {
  const dest = path.join(home, 'pystub');
  cpSync(PYSTUB_DIR, dest, { recursive: true });
  for (const rel of drop) {
    expect(existsSync(path.join(dest, rel)), `${rel} is not in PYSTUB_DIR to delete`).toBe(true);
    rmSync(path.join(dest, rel), { recursive: true });
  }
  return dest;
}

describe.skipIf(!PY)('the behaviour probe over deletion-only copies of the litellm stub', () => {
  it('the unmodified stub FAILS transformation-import — it carries the authenticator and nothing else', () => {
    const home = mkTmp('ccgpt-rt-2a-full-');
    const r = runProbe(home, stubWithout(home, []));
    expect(r.status, r.stderr).toBe(1);
    expect(r.stdout).toMatch(/^behaviour_probe: FAIL transformation-import: ModuleNotFoundError: No module named 'litellm\.llms\.chatgpt\.chat'$/m);
    expect(r.stdout).not.toMatch(/behaviour_probe: PASS/);
    expect(r.leftInTmp, 'the probe left its temp dir behind').toEqual([]);
  });

  it('without the authenticator FAILS authenticator-import', () => {
    const home = mkTmp('ccgpt-rt-2a-noauth-');
    const r = runProbe(home, stubWithout(home, ['litellm/llms/chatgpt/authenticator.py']));
    expect(r.status, r.stderr).toBe(1);
    expect(r.stdout).toMatch(/^behaviour_probe: FAIL authenticator-import: ModuleNotFoundError: No module named 'litellm\.llms\.chatgpt\.authenticator'$/m);
    expect(r.leftInTmp).toEqual([]);
  });

  it.skipIf(!NO_AMBIENT_LITELLM)('with no litellm at all FAILS litellm-import — its own name, not the authenticator\'s', () => {
    const home = mkTmp('ccgpt-rt-2a-none-');
    const r = runProbe(home, stubWithout(home, ['litellm']));
    expect(r.status, r.stderr).toBe(1);
    expect(r.stdout).toMatch(/^behaviour_probe: FAIL litellm-import: ModuleNotFoundError: No module named 'litellm'$/m);
    expect(r.leftInTmp).toEqual([]);
  });

});

/** A full copy of PYSTUB_DIR with ONE file's CONTENT replaced — never the
 *  shared fixture on disk, only ever a fresh mkTmp copy (`stubWithout`'s own
 *  "deletion only" discipline stays intact: PYSTUB_DIR itself is untouched by
 *  every case in this file, this one included). F2 and F3 both need to
 *  observe something the deletion-only variants above cannot reach: what the
 *  probe does AFTER its own import point, where the credential scrub and the
 *  audit hook actually bite — the unmodified stub always FAILs
 *  transformation-import before either could matter. */
function stubWithOverride(home: string, name: string, rel: string, content: string): string {
  const dest = path.join(home, name);
  cpSync(PYSTUB_DIR, dest, { recursive: true });
  // `stubWithout`'s own rule: an override of a stub file that is not there
  // would CREATE a new file, and the variant would silently test nothing.
  expect(existsSync(path.join(dest, rel)), `${rel} is not in PYSTUB_DIR to override`).toBe(true);
  writeFileSync(path.join(dest, rel), content);
  return dest;
}

/** F2 fixture: NOT PYSTUB_DIR's own `authenticator.py` — a content override,
 *  written only into a fresh copy. By the time this module is reached the
 *  probe's own credential scrub has already run (it happens before `import
 *  litellm`, several lines above `authenticator-import`'s try-block), so any
 *  CHATGPT_-, LITELLM_- or OPENAI_-prefixed variable found here — other than the two the
 *  probe itself deliberately sets, CHATGPT_TOKEN_DIR and
 *  LITELLM_LOCAL_MODEL_COST_MAP — proves the scrub let it through. */
const F2_LEAK_CHECK_AUTHENTICATOR = [
  '# F2 override (fix round 1) — a content copy, never PYSTUB_DIR itself.',
  '# Raises if a CHATGPT_*/LITELLM_*/OPENAI_* variable OTHER than what the',
  '# probe itself sets (CHATGPT_TOKEN_DIR, LITELLM_LOCAL_MODEL_COST_MAP)',
  '# survived the credential scrub, which runs before this module is ever',
  '# reached — so a leak observed here is real, not a fixture artefact.',
  'import os',
  '',
  '_leaked = sorted(',
  '    k for k in os.environ',
  '    if k.startswith(("CHATGPT_", "LITELLM_", "OPENAI_"))',
  '    and k not in ("CHATGPT_TOKEN_DIR", "LITELLM_LOCAL_MODEL_COST_MAP")',
  ')',
  'if _leaked:',
  '    raise RuntimeError("credential-scrub-leak: " + ",".join(_leaked))',
  '',
  '',
  'class Authenticator:',
  '    """Same fixed non-secret token as PYSTUB_DIR\'s own stub."""',
  '    def get_access_token(self):',
  '        return "stub-token-not-a-secret"',
].join('\n') + '\n';

/** F3 fixture: NOT PYSTUB_DIR's own `litellm/__init__.py` — a content
 *  override attempting one loopback-only DNS resolution at import time
 *  (`"localhost"` resolves via the hosts file / NSS, no real network egress;
 *  measured ~3ms). The shipped probe's audit hook denies the underlying
 *  `socket.getaddrinfo` event before the call can run at all, so `import
 *  litellm` raises here whenever the hook is doing its job; deleting the
 *  hook lets the resolution through silently and the probe proceeds exactly
 *  as the unmodified-stub baseline does (FAILing transformation-import). */
const F3_NETWORK_PROBE_INIT = [
  '# F3 override (fix round 1) — a content copy, never PYSTUB_DIR itself.',
  '# A loopback-only DNS resolution at import time: no real network egress',
  '# ("localhost" resolves via the hosts file / NSS, measured instant). The',
  '# shipped probe\'s audit hook denies this BEFORE the syscall runs, so',
  '# `import litellm` raises here when the hook is doing its job; deleting',
  '# the hook lets the resolution through silently.',
  'import socket',
  'socket.getaddrinfo("localhost", 1)',
].join('\n') + '\n';

/** Residue fixture: an authenticator that refuses to import unless the probe
 *  has ALREADY pointed HOME at its own fresh temp dir and CHATGPT_TOKEN_DIR
 *  inside it — LiteLLM's Authenticator mkdirs its token dir and can rewrite
 *  auth.json, so neither may be a lane's (or the operator's) own. */
const HOME_CHECK_AUTHENTICATOR = [
  '# Residue override (final review) — a content copy, never PYSTUB_DIR itself.',
  'import os',
  '',
  '_home = os.environ.get("HOME", "")',
  'if not os.path.basename(_home).startswith("ccgpt-runtime-probe.") \\',
  '        or not os.environ.get("CHATGPT_TOKEN_DIR", "").startswith(_home + os.sep):',
  '    raise RuntimeError("home-not-redirected: " + _home)',
  '',
  '',
  'class Authenticator:',
  '    """Same fixed non-secret token as PYSTUB_DIR\'s own stub."""',
  '    def get_access_token(self):',
  '        return "stub-token-not-a-secret"',
].join('\n') + '\n';

describe.skipIf(!PY)('the behaviour probe over content-overridden copies of the litellm stub (F2, F3)', () => {
  it('HOME and CHATGPT_TOKEN_DIR point into the probe\'s own temp dir before the authenticator ever imports', () => {
    const home = mkTmp('ccgpt-rt-2a-home-');
    const stub = stubWithOverride(home, 'pystub', 'litellm/llms/chatgpt/authenticator.py', HOME_CHECK_AUTHENTICATOR);
    const r = runProbe(home, stub);
    expect(r.status, r.stderr).toBe(1);
    // The unmodified-stub baseline: the check passed, so control reached the
    // still-absent transformation import.
    expect(r.stdout).toMatch(/^behaviour_probe: FAIL transformation-import: ModuleNotFoundError: No module named 'litellm\.llms\.chatgpt\.chat'$/m);
    expect(r.stdout).not.toMatch(/home-not-redirected/);
    expect(r.leftInTmp).toEqual([]);
  });

  it('stubWithOverride refuses a stub path that is not there, rather than creating it', () => {
    const home = mkTmp('ccgpt-rt-2a-override-guard-');
    expect(() => stubWithOverride(home, 'pystub', 'litellm/llms/chatgpt/no-such-module.py', '# x\n'))
      .toThrow(/is not in PYSTUB_DIR to override/);
  });

  it('F2: the credential scrub removes a leaked CHATGPT_AUTH_FILE before the authenticator ever imports', () => {
    const home = mkTmp('ccgpt-rt-2a-scrub-');
    const stub = stubWithOverride(home, 'pystub', 'litellm/llms/chatgpt/authenticator.py', F2_LEAK_CHECK_AUTHENTICATOR);
    const r = runProbe(home, stub, {
      CHATGPT_AUTH_FILE: '/should-not-survive-the-scrub/auth.json',
      CHATGPT_API_BASE: 'https://should-not-survive.example',
      OPENAI_CHATGPT_API_BASE: 'https://should-not-survive.example',
    });
    expect(r.status, r.stderr).toBe(1);
    // The SAME failure as the unmodified-stub baseline (layer (b), case 1):
    // the leak check never fired, so control reached the still-absent
    // transformation import — proving the three variables above were gone
    // before `authenticator.py` was ever read.
    expect(r.stdout).toMatch(/^behaviour_probe: FAIL transformation-import: ModuleNotFoundError: No module named 'litellm\.llms\.chatgpt\.chat'$/m);
    expect(r.stdout).not.toMatch(/credential-scrub-leak/);
    expect(r.leftInTmp).toEqual([]);
  });

  it('F3: the audit hook denies a network attempt at `import litellm` before the probe can proceed', () => {
    const home = mkTmp('ccgpt-rt-2a-offline-');
    const stub = stubWithOverride(home, 'pystub', 'litellm/__init__.py', F3_NETWORK_PROBE_INIT);
    const r = runProbe(home, stub);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stdout).toMatch(/^behaviour_probe: FAIL litellm-import: OSError: behaviour_probe: network denied$/m);
    expect(r.leftInTmp).toEqual([]);
  });
});

// ── layer (c): the probe against a REAL litellm (opt-in) ────────────────────

const LITELLM_PY = process.env.CCRC_TEST_LITELLM_PY;
/** One exact substitution in the probe source — the one-line mutations the
 *  runtime-probe measurement ran (M3–M5). */
function mutatedProbe(from: string, to: string): Buffer {
  const src = probeSource().toString('utf8');
  expect(src.split(from).length - 1, `mutation anchor ${JSON.stringify(from)} must occur exactly once`).toBe(1);
  return Buffer.from(src.replace(from, to), 'utf8');
}
function runRealProbe(home: string, probe: Buffer, pythonpath = '') {
  const f = path.join(home, 'probe.py');
  writeFileSync(f, probe);
  const tmp = path.join(home, 'tmp');
  mkdirSync(tmp, { recursive: true });
  const r = runPy(f, {
    home, python: LITELLM_PY, timeoutMs: 150_000,
    env: {
      TMPDIR: tmp, LITELLM_LOCAL_MODEL_COST_MAP: 'True',
      CHATGPT_TOKEN_DIR: path.join(home, 'synthetic-token-dir'),
      ...(pythonpath ? { PYTHONPATH: pythonpath } : {}),
    },
  });
  return { ...r, leftInTmp: readdirSync(tmp) };
}
/** Appendix D's `mut-noextrabody`: the bridge stops lifting Responses keys out of `extra_body`. */
const NO_EXTRA_BODY_SITECUSTOMIZE = [
  'import sys, importlib.abc, importlib.machinery',
  'TARGET = "litellm.completion_extras.litellm_responses_transformation.transformation"',
  'class _Patch(importlib.abc.MetaPathFinder):',
  '    def find_spec(self, name, path, target=None):',
  '        if name != TARGET:',
  '            return None',
  '        sys.meta_path.remove(self)',
  '        spec = importlib.machinery.PathFinder.find_spec(name, path)',
  '        orig = spec.loader.exec_module',
  '        def exec_module(module):',
  '            orig(module)',
  '            module.LiteLLMResponsesTransformationHandler._extract_extra_body_params = (',
  '                lambda self, op: {k: v for k, v in op.items() if k != "extra_body"})',
  '        spec.loader.exec_module = exec_module',
  '        return spec',
  'sys.meta_path.insert(0, _Patch())',
].join('\n') + '\n';

describe.skipIf(!LITELLM_PY)('the behaviour probe against a real litellm (CCRC_TEST_LITELLM_PY)', () => {
  it('PASSes, offline, and leaves nothing behind (the control)', () => {
    const home = mkTmp('ccgpt-rt-2b-control-');
    const r = runRealProbe(home, probeSource());
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^behaviour_probe: PASS litellm=\S+ raw-shape-leaks-system-role=(yes|no|unknown)$/m);
    expect(r.leftInTmp).toEqual([]);
    expect(existsSync(path.join(home, 'synthetic-token-dir')), 'the probe used the caller\'s token dir').toBe(false);
  }, 180_000);

  it('M2: a bridge that stops lifting extra_body FAILS effort-reaches-reasoning', () => {
    const home = mkTmp('ccgpt-rt-2b-m2-');
    const site = path.join(home, 'mut-noextrabody');
    mkdirSync(site);
    writeFileSync(path.join(site, 'sitecustomize.py'), NO_EXTRA_BODY_SITECUSTOMIZE);
    const r = runRealProbe(home, probeSource(), site);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/^behaviour_probe: FAIL effort-reaches-reasoning: /m);
  }, 180_000);

  it('M3: the gate fed the unfolded body FAILS a system-door assertion', () => {
    const home = mkTmp('ccgpt-rt-2b-m3-');
    const r = runRealProbe(home, mutatedProbe(
      'return await _one(SHIM_OUT), await _one(RAW)', 'return await _one(RAW), await _one(RAW)'));
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/^behaviour_probe: FAIL (no-system-role|top-system-in-leading-turn): /m);
  }, 180_000);

  it('M4: a deployment without mode: responses FAILS responses-endpoint, named by its path', () => {
    const home = mkTmp('ccgpt-rt-2b-m4-');
    const r = runRealProbe(home, mutatedProbe(
      'DEPLOYMENT = {"model_name": MODEL, "model_info": {"mode": "responses"},',
      'DEPLOYMENT = {"model_name": MODEL, "model_info": {},'));
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/^behaviour_probe: FAIL responses-endpoint: \S*\/chat\/completions$/m);
  }, 180_000);

  it('M5: a probe that does not force the cost map local FAILS offline', () => {
    const home = mkTmp('ccgpt-rt-2b-m5-');
    const r = runRealProbe(home, mutatedProbe(', LITELLM_LOCAL_MODEL_COST_MAP="True")', ')'));
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/^behaviour_probe: FAIL offline: [1-9]\d* network attempt\(s\)$/m);
  }, 180_000);
});

// ── layer (d): the probe's literals are derived, not transcribed ────────────

/** Evaluates ONLY the probe's top-level literal assignments — never the probe
 *  itself, which installs an audit hook, scrubs its environment and imports
 *  litellm. Exits 3 naming any literal it cannot find, so a rename is a red
 *  that says so rather than a KeyError three steps later. */
const LITERALS_PY = [
  'import ast, json, sys',
  'WANT = ("MODEL", "TOP", "MID", "SHIM_OUT", "RAW", "DEPLOYMENT")',
  'tree = ast.parse(open(sys.argv[1], encoding="utf-8").read())',
  'picked, found = [], set()',
  'for node in tree.body:',
  '    if not isinstance(node, ast.Assign):',
  '        continue',
  '    names = set()',
  '    for t in node.targets:',
  '        if isinstance(t, ast.Name):',
  '            names.add(t.id)',
  '        elif isinstance(t, ast.Tuple):',
  '            names |= {e.id for e in t.elts if isinstance(e, ast.Name)}',
  '    if names & set(WANT):',
  '        picked.append(node)',
  '        found |= names',
  'missing = [w for w in WANT if w not in found]',
  'if missing:',
  '    print("probe literals not found: " + ", ".join(missing), file=sys.stderr)',
  '    sys.exit(3)',
  'scope = {"__builtins__": {"dict": dict}}',
  'exec(compile(ast.Module(body=picked, type_ignores=[]), "probe-literals", "exec"), scope)',
  'print(json.dumps({w: scope[w] for w in WANT}))',
].join('\n') + '\n';

/** The SHIPPED shim's own fold over RAW. The shim refuses to import without
 *  its three variables (`_required_env`) and binds nothing at import (its
 *  server starts only under `__main__`), so dummy values are enough; its
 *  effort file is read under the fixture HOME, where there is none. */
const SHIM_FOLD_PY = [
  'import importlib.util, json, os, sys',
  'os.environ.update(CCGPT_ACCOUNT_ID="codex-a", CCGPT_PROXY_PORT="1", CCGPT_LITELLM_PORT="2")',
  'spec = importlib.util.spec_from_file_location("ccgpt_proxy_under_test", sys.argv[1])',
  'mod = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(mod)',
  'raw = json.loads(sys.stdin.read())',
  'print(mod._rewrite_messages_body(json.dumps(raw).encode()).decode("utf-8"))',
].join('\n') + '\n';

type Json = Record<string, unknown>;
interface Literals { MODEL: string; TOP: string; MID: string; SHIM_OUT: Json; RAW: Json; DEPLOYMENT: Json }

function literals(home: string): Literals {
  const probe = path.join(home, 'probe.py');
  writeFileSync(probe, probeSource());
  const helper = path.join(home, 'literals.py');
  writeFileSync(helper, LITERALS_PY);
  const r = runPy(helper, { home, args: [probe] });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as Literals;
}

/** One `  - …` entry of a rendered model_list, as an object: `key: value`
 *  lines, with a `{k: v}` flow map parsed one level deep. Nothing else in the
 *  renderer's output needs more, and a shape it cannot parse throws. */
function renderedEntries(yaml: string): Json[] {
  const out: Json[] = [];
  let cur: Json | null = null;
  const value = (v: string): unknown => {
    const m = v.match(/^\{(.*)\}$/);
    if (!m) return v;
    return Object.fromEntries(m[1]!.split(',').map((kv) => {
      const i = kv.indexOf(':');
      if (i < 0) throw new Error(`not a flow-map pair: ${kv}`);
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }));
  };
  for (const line of yaml.split('\n')) {
    const first = line.match(/^ {2}- ([a-z_]+): (.+)$/);
    const cont = line.match(/^ {4}([a-z_]+): (.+)$/);
    if (first) { cur = { [first[1]!]: value(first[2]!) }; out.push(cur); }
    else if (cont && cur) cur[cont[1]!] = value(cont[2]!);
    else cur = null;
  }
  return out;
}

describe.skipIf(!PY)('the probe\'s literals are derived from what they stand for', () => {
  it('RAW is Claude Code\'s shape: a top-level system string, a block-list mid-turn system turn, effort and adaptive thinking', () => {
    const { RAW, TOP, MID } = literals(mkTmp('ccgpt-rt-raw-'));
    expect(RAW['system']).toBe(TOP);
    const msgs = RAW['messages'] as Array<{ role: string; content: unknown }>;
    const sys = msgs.filter((m) => m.role === 'system');
    expect(sys).toHaveLength(1);
    expect(sys[0]!.content).toEqual([{ type: 'text', text: MID }]);
    expect(msgs.indexOf(sys[0]!)).toBe(2);   // mid-conversation, not leading
    expect(RAW['output_config']).toEqual({ effort: 'high' });
    expect(RAW['thinking']).toEqual({ type: 'adaptive' });
    expect(RAW).not.toHaveProperty('reasoning');   // Claude Code never sends it; the shim sets it
  });

  it('SHIM_OUT is exactly what the shipped shim makes of RAW', () => {
    const home = mkTmp('ccgpt-rt-shimout-');
    const { RAW, SHIM_OUT } = literals(home);
    const helper = path.join(home, 'fold.py');
    writeFileSync(helper, SHIM_FOLD_PY);
    const r = runPy(helper, { home, args: [SHIM], stdin: JSON.stringify(RAW) });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(SHIM_OUT);
  });

  it('DEPLOYMENT is exactly the entry shared/litellm.mjs renders for the probe model', () => {
    const { MODEL, DEPLOYMENT } = literals(mkTmp('ccgpt-rt-deploy-'));
    const yaml = renderLitellmConfig(readFileSync(TEMPLATE, 'utf8'), {
      probe: 'codex', fetchedAt: 0, stale: false,
      models: [{ id: MODEL, label: MODEL, context: null, maxContext: null, efforts: [], hidden: false, priceIn: null, priceOut: null }],
    });
    expect(renderedEntries(yaml)).toEqual([DEPLOYMENT]);
  });

  it('the probe sets drop_params because the rendered config does', () => {
    expect(readFileSync(TEMPLATE, 'utf8')).toMatch(/^\s+drop_params: true$/m);
    expect(probeSource().toString('utf8')).toMatch(/^\s+litellm\.drop_params = True\b/m);
  });
});
