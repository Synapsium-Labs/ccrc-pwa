// `ccrc doctor`, part: codex-fix (D-6767): `doctor --fix` (its contract, the codex lane's fixer and the launchers) and scope-sweep.
// They moved here unchanged from `ccrc-doctor-codex.test.ts`, itself a part of what was one 17,000-line file, which ran about 405 s
// on a CI runner and past the trace job's 1560 s budget under `strace -f`. The fixtures the doctor parts share are in
// `ccrc-doctorFixture.ts`, and those the codex parts share in `ccrc-doctor-codexFixture.ts`.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync, chmodSync, existsSync, utimesSync, readdirSync, lstatSync, statSync } from 'node:fs';
import path, { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { describeLinux } from './platformFixtures.js';
import { authDirOf, freeLanes, GPT_LANE_BINS, killLaneProcesses, portAccepts, spawnListener, ccrcFunction, ccrcLine, lockStub, isolationManagerStubs, assertIsolationWallFirst, strayManagerCalls, codexAuthDir } from './codexLaneFixture.js';
import { pythonOrSkip } from './ccgptHarness.js';
import { generateWrapperBody } from '../../shared/wrapper.mjs';
import { markGenerated } from '../../shared/mark.mjs';
import { installDoctorHooks, REPO, CCRC_SRC, CHECKS_SRC, BASH, realPath, writeChecks, linkReal, writeRawRoster, shq, writeCcrcEnv, stubLaunchctl, writeUnitFile, doctorEnv, runDoctor, healthy, describeCodex, healthyCodexBox, tableNames, lineFor, anyVerdictFor, checksDecl, FixCodexCase, AGED, laneFileText, SHARED_PORT_REFUSAL, FIX_TRIPWIRES } from './ccrc-doctorFixture.js';
import { checksFunction } from './ccrc-doctor-codexFixture.js';

// Each case's homes go when the case ends, not in a file-wide end sweep (R100, review 518's S1): that sweep overran vitest's 20 s
// hook timeout on the one file this family was split from. Registered before `installDoctorHooks()`'s root `afterEach` (the codex
// lanes' process kill) because vitest runs after-hooks in reverse order of registration: that kill still sees its home.
removeTmpFixturesEachTest();
installDoctorHooks();

// ════════════════════════════════════════════════════════════════════════
// Plan 3a Task 8 — `doctor --fix` for a codex lane, and for its launcher.
// ════════════════════════════════════════════════════════════════════════

/** Every `_fix_<name>` the shipped check table defines, by name. */
function fixerNames(): string[] {
  const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}\ndeclare -F | sed -n "s/^declare -f _fix_//p"`],
    { encoding: 'utf8', env: { ...process.env, PATH: process.env['PATH'] ?? '' } });
  if (r.status !== 0) throw new Error(`could not list the fixers: ${r.stderr}`);
  return (r.stdout ?? '').split('\n').filter(Boolean);
}

/** `_fix_codex` alone. Its ccrc seams are stubbed by table; its one real
 *  primitive (`_inst_atomic`, with `_ccrc_die` and `PROG`) and `_box_env_value`
 *  come out of ccd/ccrc, and `_dr_join` and Task 4's `CODEX_LANE_BINS` out of
 *  ccd/ccrc-doctor-checks. The HOME holds a fixture SHIPPED TREE at
 *  `$HOME/ccrc/ccd` — its `ccgpt-runtime` a recording fake, so a restore keeps
 *  the fake — and the placed copies at `$HOME/.local/bin`. Every ccrc function
 *  this fixer must never call is a tripwire that records and refuses, and
 *  Task 10 of Plan 2b-2's isolation wall is FIRST on PATH, so a direct
 *  `systemctl` or `systemd-run` is a thrown, named red. */
function runFixCodex(c: FixCodexCase = {}): {
  code: number; stdout: string; stderr: string; calls: string[]; tripwire: string[]; fix: string[];
  home: string; after: string;
  /** codex-b's 0000 `auth.json`, by lstat only (size, mtime, inode), taken
   *  before the run: nothing here reads its bytes (Global Constraints, G8). */
  credBefore: { size: number; mtimeMs: number; ino: number };
} {
  const home = mkTmp('ccrc-doctor-fix-codex-iso-');
  const lanes = c.lanes ?? ['codex-a'];
  const tree = join(home, 'ccrc', 'ccd');
  const bin = join(home, '.local', 'bin');
  mkdirSync(tree, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const RUNTIME_FAKE = [
    '#!/bin/sh',
    'printf \'ccgpt-runtime %s\\n\' "$1" >> "$HOME/calls"',
    'case "$1" in',
    '  check) if [ -e "$HOME/rt-built" ]; then exit "$(cat "$HOME/rt-after-build")"; fi; exit "$(cat "$HOME/rt-check")" ;;',
    '  build) rc="$(cat "$HOME/rt-build")"; [ "$rc" -eq 0 ] && : > "$HOME/rt-built"; exit "$rc" ;;',
    'esac',
    'exit 64',
    '',
  ].join('\n');
  for (const n of GPT_LANE_BINS) {
    const text = n === 'ccgpt-runtime' ? RUNTIME_FAKE : `#!/bin/sh\n# fixture shipped ${n}\n`;
    if (!(c.treeLacks ?? []).includes(n)) writeFileSync(join(tree, n), text, { mode: 0o755 });
    const state = c.bins?.[n] ?? 'same';
    if (state === 'missing') continue;
    writeFileSync(join(bin, n), state === 'drift' ? `#!/bin/sh\n# drifted ${n}\n` : text,
      { mode: state === 'mode' ? 0o644 : 0o755 });
    if (c.ageBins === true) utimesSync(join(bin, n), AGED, AGED);
  }
  writeFileSync(join(home, 'rt-check'), `${c.runtime?.check ?? 0}\n`);
  writeFileSync(join(home, 'rt-build'), `${c.runtime?.build ?? 0}\n`);
  writeFileSync(join(home, 'rt-after-build'), `${c.runtime?.afterBuild ?? 0}\n`);
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'accounts.json'), '{"fixture":"a roster --fix must never write"}\n');
  if (c.role !== undefined) writeFileSync(join(home, '.ccrc', 'ccrc.env'), `CCRC_ROLE=${c.role}\n`);
  if (c.laneFiles === true) {
    for (const id of lanes) {
      for (const [rel, text] of Object.entries(laneFileText(id))) {
        mkdirSync(path.dirname(join(home, rel)), { recursive: true });
        writeFileSync(join(home, rel), text);
      }
    }
  }
  // A second lane's credential, 0000: nothing may open it, so a read would fail loudly.
  const cred = join(home, codexAuthDir('codex-b'));
  mkdirSync(cred, { recursive: true });
  writeFileSync(join(cred, 'auth.json'), '{"fixture":"test-token-not-a-secret"}\n', { mode: 0o000 });
  const credStat = lstatSync(join(cred, 'auth.json'));
  const credBefore = { size: credStat.size, mtimeMs: credStat.mtimeMs, ino: credStat.ino };

  const arms = (table: Record<string, string>, fmt: (id: string, v: string) => string): string[] =>
    Object.entries(table).map(([id, v]) => fmt(id, v));
  const MAT = (id: string, extra: string): string =>
    `echo '{"ok":true,"op":"materialise","id":"${id}"${extra}}'`;
  const defs: Record<string, string> = {
    _codex_lanes: (c.lanesRc ?? 0) === 0
      ? `_codex_lanes() { printf '%s\\n' _codex_lanes >> "$HOME/calls"; ${lanes.length === 0 ? ':' : `printf '%s\\n' ${lanes.join(' ')}`}; }`
      : `_codex_lanes() { printf '%s\\n' _codex_lanes >> "$HOME/calls"; echo "ccrc codex: roster-invalid: fixture: the roster could not be read" >&2; return ${c.lanesRc}; }`,
    _codex_row: [
      '_codex_row() {',
      `  case " ${(c.badRows ?? []).join(' ')} " in *" $1 "*) echo "ccrc codex: roster-invalid: account '$1''s codex row does not validate (exec.proxyPort/exec.litellmPort) — fixture" >&2; return 1 ;; esac`,
      '  CX_ID="$1"; return 0',
      '}',
    ].join('\n'),
    _codex_lane_json_state: [
      '_codex_lane_json_state() {',
      '  case "$1" in',
      ...arms(c.laneState ?? {}, (id, v) => `    ${id}) echo ${v}; return 0 ;;`),
      '  esac',
      '  echo current',
      '}',
    ].join('\n'),
    _codex_runtime_cli: '_codex_runtime_cli() { printf \'%s\' "$HOME/.local/bin/ccgpt-runtime"; }',
    _codex_runtime_wanted: c.wanted === undefined
      ? '_codex_runtime_wanted() { return 0; }'
      : `_codex_runtime_wanted() { printf '%s\\n' _codex_runtime_wanted >> "$HOME/calls"; return ${c.wanted}; }`,
    // The lane library's own one-liner: which placed file a shim tier runs.
    _codex_shim_file: ccrcLine(/^_codex_shim_file\(\) .*$/m, '_codex_shim_file'),
    // And the one the litellm tier loads its credential through (codex-bridge Stage 1, Task 6).
    _codex_auth_lib: ccrcLine(/^_codex_auth_lib\(\) .*$/m, '_codex_auth_lib'),
    _models_roster_path: '_models_roster_path() { printf \'%s\' "$HOME/.ccrc/accounts.json"; }',
    _models_node: [
      '_models_node() {',
      '  printf \'_models_node %s\\n\' "$*" >> "$HOME/calls"',
      '  local id="" check=0',
      '  while [ $# -gt 0 ]; do case "$1" in --id) id="$2"; shift ;; --check) check=1; shift ;; esac; shift; done',
      '  if [ "$check" -eq 1 ]; then',
      '    case "$id" in',
      ...arms(Object.fromEntries(Object.entries(c.registryChanged ?? {}).map(([k, v]) => [k, String(v)])),
        (id, v) => (v === 'refused'
          ? `      ${id}) echo '{"ok":false,"error":"no-answer","detail":"fixture"}'; return 1 ;;`
          : v === 'roster-invalid'
            ? `      ${id}) echo '${SHARED_PORT_REFUSAL}'; return 1 ;;`
            : `      ${id}) ${MAT(id, `,"check":true,"changed":{"lane":${v},"classes":false,"effort":false}`)}; return 0 ;;`)),
      '    esac',
      '    echo "{\\"ok\\":true,\\"op\\":\\"materialise\\",\\"id\\":\\"$id\\",\\"check\\":true,\\"changed\\":{\\"lane\\":false,\\"classes\\":false,\\"effort\\":false}}"; return 0',
      '  fi',
      '  case "$id" in',
      ...arms(c.commit ?? {}, (id, v) => (v === 'no-registry'
        ? `    ${id}) ${MAT(id, ',"wrote":null')}; return 0 ;;`
        : v === 'refused'
          ? `    ${id}) echo '{"ok":false,"error":"settings-unwritable","detail":"fixture: the env block cannot be rendered"}'; return 1 ;;`
          : v === 'roster-invalid'
            ? `    ${id}) echo '${SHARED_PORT_REFUSAL}'; return 1 ;;`
            : v === 'lock-busy' || v === 'lock-unwritable'
              ? `    ${id}) echo '{"ok":false,"error":"${v}","detail":"fixture: the lane-files lock of ${id} was not taken. Fix it, then re-run. Nothing was written."}'; return 1 ;;`
              : `    ${id}) ${MAT(id, `,"wrote":{"lane":"lane.json of ${id}"}`)}; return 0 ;;`)),
      '  esac',
      '  echo "{\\"ok\\":true,\\"op\\":\\"materialise\\",\\"id\\":\\"$id\\",\\"wrote\\":{\\"lane\\":\\"lane.json of $id\\"}}"',
      '}',
    ].join('\n'),
    // auto-advance D21: `_fix_codex` re-renders a lane through the lane-files lock, inside its tier lock.
    _models_node_locked: [
      '_models_node_locked() {',
      '  printf \'%s tier=%s\\n\' "$1" "${CX_LOCK_ID:-}" >> "$HOME/models-locks"',
      '  shift',
      '  _models_node "$@"',
      '}',
    ].join('\n'),
    _models_litellm_lane_held: [
      '_models_litellm_lane_held() {',
      '  printf \'%s %s lock=%s\\n\' _models_litellm_lane_held "$1" "${CX_LOCK_ID:-}" >> "$HOME/calls"',
      '  case "$1" in',
      ...arms(c.litellm ?? {}, (id, v) => {
        switch (v) {
          case 'rendered': return `    ${id}) echo '{"ok":true,"op":"litellm","id":"${id}","changed":true,"restarted":false}'; return 0 ;;`;
          case 'restarted': return `    ${id}) echo '{"ok":true,"op":"litellm","id":"${id}","changed":true,"restarted":true}'; return 0 ;;`;
          // `_models_refuse`'s own shape: one JSON object, then EXIT.
          case 'foreign': return `    ${id}) echo '{"ok":false,"error":"tier-foreign","detail":"lane ${id}\\u0027s LiteLLM tier is not provably this lane\\u0027s — fixture"}'; exit 1 ;;`;
          // The codex arm's phase 1 hands models-op's own refusal back, rc 1.
          case 'roster-invalid': return `    ${id}) echo '${SHARED_PORT_REFUSAL}'; return 1 ;;`;
          default: return '';
        }
      }),
      '  esac',
      '  echo "{\\"ok\\":true,\\"op\\":\\"litellm\\",\\"id\\":\\"$1\\",\\"changed\\":false}"',
      '}',
    ].join('\n'),
    _inst_codex_tiers: [
      '_inst_codex_tiers() {',
      '  printf \'_inst_codex_tiers role=%s\\n\' "${INST_ROLE:-unset}" >> "$HOME/calls"',
      '  echo "install: codex tiers: fixture — measured"',
      ...(c.tiersDegraded === true ? ['  INST_DEGRADED+=(codex-tiers)'] : []),
      '}',
    ].join('\n'),
  };
  if (c.unload !== undefined) delete defs[c.unload];
  const harness = [
    'set -uo pipefail',
    ccrcLine(/^PROG=.*$/m, 'PROG='),
    ccrcLine(/^_ccrc_die\(\) \{.*\}$/m, '_ccrc_die'),
    ccrcFunction('_inst_atomic'),
    ccrcFunction('_box_env_value'),
    'BOX_TREE_DIR="$HOME/ccrc"',
    'BOX_ENV_FILE="$HOME/.ccrc/ccrc.env"',
    checksFunction('_dr_join'),
    checksDecl('CODEX_LANE_BINS'),
    ...Object.values(defs),
    lockStub(c.lockRefuse ?? []),
    ...FIX_TRIPWIRES.map((f) => `${f}() { printf '%s %s\\n' ${f} "$*" >> "$HOME/tripwire"; return 97; }`),
    checksFunction('_fix_codex'),
    '_fix_codex; rc=$?',
    'printf \'after rc=%s lockfd=%s\\n\' "$rc" "${CX_LOCK_FD:-}"',
    'exit "$rc"',
  ].join('\n');
  if (c.binReadOnly === true) chmodSync(bin, 0o555);
  const wall = isolationManagerStubs(home);
  let rest = process.env['PATH'] ?? '';
  if (c.noCmp === true) {
    // No system directory at all, so `cmp` cannot resolve: only what the
    // harness and `_inst_atomic` run besides it.
    rest = join(home, 'nocmp-bin');
    mkdirSync(rest, { recursive: true });
    for (const t of ['cp', 'chmod', 'mv', 'rm', 'mkdir', 'jq', 'cat']) symlinkSync(realPath(t), join(rest, t));
  }
  const env = { PATH: `${wall}:${rest}`, HOME: home, LC_ALL: 'C' };
  assertIsolationWallFirst(env, home);
  const p = spawnSync(BASH, ['-c', harness], { env, encoding: 'utf8' });
  if (c.binReadOnly === true) chmodSync(bin, 0o755);
  const stray = strayManagerCalls(home);
  if (stray.length > 0) {
    throw new Error(`_fix_codex reached the user manager directly:\n${stray.join('\n')}\n${p.stderr ?? ''}`);
  }
  const lines = (f: string): string[] =>
    (existsSync(join(home, f)) ? readFileSync(join(home, f), 'utf8').split('\n').filter(Boolean) : []);
  const out = p.stdout ?? '';
  return {
    code: p.status ?? -1, stdout: out, stderr: p.stderr ?? '', calls: lines('calls'), tripwire: lines('tripwire'),
    fix: out.split('\n').filter((l) => l.startsWith('FIX codex:')), home,
    after: out.split('\n').filter((l) => l.startsWith('after rc=')).join('\n'), credBefore,
  };
}


// `stubLaunchctl` answers a SESSION unit from the same
// `fixture-unit-claude-session@<id>.service` file the systemctl stub reads, as
// its own contract says. Forced Darwin, so it is measured on any host: the stub
// once looked up `fixture-unit-claude-session@<id>` (no `.service`), and the
// LIVE-session case in codex part 2 went red on macOS alone (PR #239's
// test-macos 2/2) while every Linux run stayed green.
describe('stubLaunchctl: a session unit reads the fixture file systemctl reads (forced Darwin)', () => {
  it('_svc_is_active answers active, inactive and unasked for claude-session@<id> from fixture-unit-claude-session@<id>.service', () => {
    const home = mkTmp('ccrc-doctor-launchctl-session-');
    stubLaunchctl(home);
    const ask = (): string => spawnSync(BASH, ['-c', `. ${shq(CCRC_SRC)}; printf '[%s]' "$(_svc_is_active claude-session@proj-b.service)"`],
      { env: { ...doctorEnv(home), OSTYPE: 'darwin23' }, encoding: 'utf8' }).stdout;
    const f = join(home, 'fixture-unit-claude-session@proj-b.service');
    writeFileSync(f, 'active\n');
    expect(ask()).toBe('[active]');
    writeFileSync(f, 'inactive\n');
    expect(ask()).toBe('[inactive]');
    writeFileSync(f, '\n');
    expect(ask()).toBe('[]');
  });
});


describe('ccrc doctor --fix: the contract every fixer runs under (Plan 3a Task 8)', () => {
  it('a fixer runs on a FAIL only: a WARN keeps its verdict and its fixer never runs (R-C8)', () => {
    const home = healthy('ccrc-doctor-fix-fail-only-');
    writeChecks(home, [
      'CCRC_DOCTOR_CHECKS=(warned failed)',
      '_check_warned() { printf "WARN warned: a poller is missing\\n  remedy: run ccrc install\\n"; return 2; }',
      '_fix_warned()   { : > "$HOME/fixer-ran-warned"; echo "FIX warned: enabled it"; }',
      '_check_failed() {',
      '  if [ -e "$HOME/fixer-ran-failed" ]; then printf "PASS failed: cured\\n"; return 0; fi',
      '  printf "FAIL failed: broken\\n  remedy: run ccrc doctor --fix\\n"; return 1',
      '}',
      '_fix_failed()   { : > "$HOME/fixer-ran-failed"; echo "FIX failed: cured it"; }',
      '',
    ].join('\n'));
    const r = runDoctor(home, ['doctor', '--fix']);
    expect(existsSync(join(home, 'fixer-ran-warned')), 'a WARN reached its fixer').toBe(false);
    expect(r.stdout).not.toMatch(/^FIX warned:/m);
    expect(r.stdout).toMatch(/^WARN warned: a poller is missing$/m);
    // The FAIL is printed as measured, the fixer says what it did, and the
    // SECOND measurement is the one the summary counts.
    expect(r.stdout).toMatch(/^FAIL failed: broken\n {2}remedy: run ccrc doctor --fix\nFIX failed: cured it\nPASS failed: cured$/m);
    expect(r.stdout).toMatch(/^summary: 2 checks \(0 skipped\), 2 verdicts — 1 passed, 1 warned, 0 failed$/m);
    expect(r.code, r.stdout).toBe(0);
  });

  it('every _fix_<name> names a check in the table — a fixer with no entry is never run', () => {
    const names = tableNames();
    const fixers = fixerNames();
    // The CONTROL: the three this tree ships are seen, so an empty scan cannot pass.
    expect(fixers).toEqual(expect.arrayContaining(['codex', 'skills', 'wrappers']));
    for (const f of fixers) expect(names, `_fix_${f} is defined, and no table entry "${f}" will ever run it`).toContain(f);
  });

  it('a remedy that names `ccrc doctor --fix` is a FAIL of a check that has a fixer — never a WARN (R-C8)', () => {
    const src = readFileSync(CHECKS_SRC, 'utf8');
    const fixers = new Set(fixerNames());
    // Every `_dr_warn <name>` / `_dr_fail <name>` call, through its `\`-continued lines.
    const calls = [...src.matchAll(/_dr_(warn|fail) ([a-z][a-z0-9_-]*)((?:[^\n]*\\\n)*[^\n]*)/g)]
      .map((m) => ({ cls: m[1]!, name: m[2]!, text: m[3]! }));
    // `_check_codex` records its findings through `_dr_cx_warn` / `_dr_cx_fail`
    // (Tasks 4-6) and prints them under its own name: the same rule binds them.
    for (const m of src.matchAll(/_dr_cx_(warn|fail) ((?:[^\n]*\\\n)*[^\n]*)/g)) {
      calls.push({ cls: m[1]!, name: 'codex', text: m[2]! });
    }
    expect(calls.length, 'the call-site scan found almost nothing — re-anchor it').toBeGreaterThan(100);
    const naming = calls.filter((c) => /doctor --fix/.test(c.text));
    // The CONTROL: skills' FAIL remedy names it, so the scan can see one.
    expect(naming.some((c) => c.cls === 'fail' && c.name === 'skills')).toBe(true);
    expect(naming.filter((c) => c.cls === 'warn' || !fixers.has(c.name)).map((c) => `${c.cls} ${c.name}`)).toEqual([]);
  });
});


describe('ccrc doctor --fix: codex, measured in isolation (_fix_codex, Plan 3a Task 8)', () => {
  const DONE = (n: number): string =>
    `FIX codex: done for ${n} codex lane(s) — no port, roster row, OAuth, credential, unidentified listener or unit enablement was touched; the re-measurement below is the verdict`;
  const commit = (home: string, id: string): string => `_models_node materialise --file ${home}/.ccrc/accounts.json --id ${id}`;
  const check = (home: string, id: string): string => `${commit(home, id)} --check true`;
  const held = (id: string): string => `_models_litellm_lane_held ${id} lock=${id}`;
  const TIERS_LINE = "FIX codex: tiers: this fix replaced code a running tier runs (the shim, the runtime or the auth library), so it re-ran the install step 'ccrc update' runs, which restarts every running ccrc-owned tier that measures stale, on any lane (its lines above)";
  const tiersAsked = (r: { calls: string[] }): string[] => r.calls.filter((l) => l.startsWith('_inst_codex_tiers'));

  it('a converged lane: every measurement is asked, and nothing is placed, rebuilt, rendered or restarted', () => {
    const r = runFixCodex();
    expect(r.code, r.stderr).toBe(0);
    expect(r.calls).toEqual(['_codex_lanes', 'ccgpt-runtime check', '_codex_lock codex-a',
      check(r.home, 'codex-a'), held('codex-a'), '_codex_unlock codex-a']);
    expect(r.fix).toEqual([DONE(1)]);
    expect(r.tripwire).toEqual([]);
    expect(r.after).toBe('after rc=0 lockfd=');
  });

  it('a stale lane is re-rendered under BOTH locks, the tier lock first: the one sanctioned nesting (auto-advance D21)', () => {
    const r = runFixCodex({ laneState: { 'codex-a': 'stale' } });
    expect(r.code, r.stderr).toBe(0);
    expect(r.calls).toContain(commit(r.home, 'codex-a'));
    expect(readFileSync(join(r.home, 'models-locks'), 'utf8').split('\n').filter(Boolean)).toEqual(['codex-a tier=codex-a']);
  });

  it('refuses, asking nothing, when a ccrc function it calls is not loaded', () => {
    const r = runFixCodex({ unload: '_models_node' });
    expect(r.code).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.fix).toEqual(["FIX codex: refused — ccrc's own _models_node is not loaded, so nothing was cured; this is a bug in ccrc, not a fact about your box (the check table was sourced by something that is not ccrc)"]);
  });

  it('a server box is refused before the roster is read: it converges nothing per account', () => {
    const r = runFixCodex({ role: 'server', bins: { 'ccgpt-usage.py': 'drift' } });
    expect(r.code).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.fix).toEqual(['FIX codex: refused — this box records CCRC_ROLE=server, which converges nothing per account, so nothing was cured']);
    expect(readFileSync(join(r.home, '.local', 'bin', 'ccgpt-usage.py'), 'utf8')).toBe('#!/bin/sh\n# drifted ccgpt-usage.py\n');
  });

  it('an unreadable roster or a missing jq is refused, never read as "no codex lane"', () => {
    for (const lanesRc of [1, 2]) {
      const r = runFixCodex({ lanesRc, bins: { 'ccgpt-usage.py': 'drift' } });
      expect(r.code, `lanesRc ${lanesRc}`).toBe(1);
      expect(r.calls).toEqual(['_codex_lanes']);
      expect(r.fix).toEqual(['FIX codex: refused — which roster lanes are codex lanes could not be read (the ccrc codex: line above says why), so nothing was cured']);
    }
    // The CONTROL: an empty population says so in its own words.
    const none = runFixCodex({ lanes: [] });
    expect(none.code).toBe(0);
    expect(none.fix).toEqual(['FIX codex: nothing to cure — no codex lane in the roster']);
  });

  it('a drifted, a missing and a mode-only executable are placed again from the shipped tree at 0755, each said as what was done', () => {
    const r = runFixCodex({ role: 'fleet', bins: { 'ccgpt-proxy.py': 'mode', 'ccgpt-usage.py': 'drift', 'ccrc-codex': 'missing' } });
    expect(r.code, r.stderr).toBe(0);
    expect(r.fix).toEqual([
      "FIX codex: made $HOME/.local/bin/ccgpt-proxy.py executable (0755) — its bytes already were the shipped tree's",
      'FIX codex: restored $HOME/.local/bin/ccgpt-usage.py from the shipped tree',
      'FIX codex: restored $HOME/.local/bin/ccrc-codex from the shipped tree',
      DONE(1),
    ]);
    for (const n of GPT_LANE_BINS) {
      const placed = join(r.home, '.local', 'bin', n);
      expect(readFileSync(placed).equals(readFileSync(join(r.home, 'ccrc', 'ccd', n))), `${n} is not the shipped bytes`).toBe(true);
      expect(statSync(placed).mode & 0o777, n).toBe(0o755);
    }
    // None of these is a byte change to code a tier runs (fix round 1, D-3721).
    expect(tiersAsked(r)).toEqual([]);
  });

  it('a drifted ccgpt-usage.py is placed again, and no tier is asked: no tier runs it (D-3721)', () => {
    const r = runFixCodex({ bins: { 'ccgpt-usage.py': 'drift' } });
    expect(r.fix).toEqual(['FIX codex: restored $HOME/.local/bin/ccgpt-usage.py from the shipped tree', DONE(1)]);
    expect(tiersAsked(r)).toEqual([]);
  });

  it('a mode-only ccgpt-proxy.py is made executable, and no tier is asked: the bytes a shim tier runs did not change (D-3721)', () => {
    const r = runFixCodex({ bins: { 'ccgpt-proxy.py': 'mode' } });
    expect(r.fix).toEqual(["FIX codex: made $HOME/.local/bin/ccgpt-proxy.py executable (0755) — its bytes already were the shipped tree's", DONE(1)]);
    expect(statSync(join(r.home, '.local', 'bin', 'ccgpt-proxy.py')).mode & 0o777).toBe(0o755);
    expect(tiersAsked(r)).toEqual([]);
  });

  it('a byte-drifted shim or runtime CLI is placed again, and only then are the tiers asked: once, last, with the box\'s own role', () => {
    for (const n of ['ccgpt-proxy.py', 'ccgpt-runtime'] as const) {
      const r = runFixCodex({ role: 'fleet', bins: { [n]: 'drift' } });
      expect(r.fix, n).toEqual([`FIX codex: restored $HOME/.local/bin/${n} from the shipped tree`, TIERS_LINE, DONE(1)]);
      expect(r.calls[r.calls.length - 1], n).toBe('_inst_codex_tiers role=fleet');
      expect(tiersAsked(r), n).toHaveLength(1);
    }
  });

  it('--fix restoring a drifted ccgpt-auth.py asks _inst_codex_tiers, like the shim', () => {
    // The litellm tier loads the library, and its `.started` code hashes it (codex-bridge Stage 1, Task 6).
    const r = runFixCodex({ role: 'fleet', bins: { 'ccgpt-auth.py': 'drift' } });
    expect(r.code, r.stderr).toBe(0);
    expect(r.fix).toEqual(['FIX codex: restored $HOME/.local/bin/ccgpt-auth.py from the shipped tree', TIERS_LINE, DONE(1)]);
    expect(r.calls[r.calls.length - 1]).toBe('_inst_codex_tiers role=fleet');
    expect(tiersAsked(r)).toHaveLength(1);
  });

  it('with no cmp on PATH, only a missing or non-executable file is placed, every other is named "not compared", and no tier is asked', () => {
    const r = runFixCodex({ noCmp: true, bins: { 'ccgpt-proxy.py': 'missing', 'ccgpt-usage.py': 'drift', 'ccrc-codex': 'mode' } });
    expect(r.code, r.stderr).toBe(0);
    const notCompared = (n: string): string =>
      `FIX codex: ${n}: not compared — cmp is not on PATH, so $HOME/.local/bin/${n} was left as it is; install diffutils (it ships cmp), then re-run 'ccrc doctor --fix'`;
    const placed = (n: string): string =>
      `FIX codex: placed $HOME/.local/bin/${n} from the shipped tree — it was missing or not executable, and with no cmp on PATH whether its bytes changed was not measured, so no tier is restarted for it`;
    expect(r.fix).toEqual([notCompared('ccgpt-auth.py'), placed('ccgpt-proxy.py'), notCompared('ccgpt-usage.py'), notCompared('ccgpt-runtime'), placed('ccrc-codex'), DONE(1)]);
    // The drifted file is NOT claimed restored: it is still exactly its bytes.
    expect(readFileSync(join(r.home, '.local', 'bin', 'ccgpt-usage.py'), 'utf8')).toBe('#!/bin/sh\n# drifted ccgpt-usage.py\n');
    for (const n of ['ccgpt-proxy.py', 'ccrc-codex']) {
      expect(readFileSync(join(r.home, '.local', 'bin', n)).equals(readFileSync(join(r.home, 'ccrc', 'ccd', n))), n).toBe(true);
      expect(statSync(join(r.home, '.local', 'bin', n)).mode & 0o777, n).toBe(0o755);
    }
    // The shim was placed, but nothing measured a byte change: no restart.
    expect(tiersAsked(r)).toEqual([]);
  });

  it('a converged executable is never rewritten — measured on mtime, not on the message', () => {
    const r = runFixCodex({ ageBins: true, bins: { 'ccgpt-usage.py': 'drift' } });
    expect(r.fix.filter((l) => l.includes('restored'))).toEqual(['FIX codex: restored $HOME/.local/bin/ccgpt-usage.py from the shipped tree']);
    for (const n of GPT_LANE_BINS) {
      const t = statSync(join(r.home, '.local', 'bin', n)).mtimeMs;
      if (n === 'ccgpt-usage.py') expect(t, n).not.toBe(AGED.getTime());
      else expect(t, `${n} was rewritten though it was already the shipped bytes`).toBe(AGED.getTime());
    }
  });

  it('a shipped tree that lacks an executable names it and places nothing at that path', () => {
    const r = runFixCodex({ treeLacks: ['ccgpt-usage.py'], bins: { 'ccgpt-usage.py': 'missing' } });
    expect(r.fix).toContain('FIX codex: ccgpt-usage.py: not restored — the shipped tree has no $HOME/ccrc/ccd/ccgpt-usage.py; run \'ccrc update\' (or \'ccrc install\' from a checkout) to place it');
    expect(existsSync(join(r.home, '.local', 'bin', 'ccgpt-usage.py'))).toBe(false);
    // Nothing was replaced, so no tier is asked to restart.
    expect(r.calls.some((l) => l.startsWith('_inst_codex_tiers'))).toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)('an install step that dies is contained: the lanes and the caller still run', () => {
    const r = runFixCodex({ bins: { 'ccgpt-proxy.py': 'drift' }, binReadOnly: true });
    expect(r.fix).toContain('FIX codex: ccgpt-proxy.py: not restored — the install step refused (its line above says why)');
    expect(r.stderr).toMatch(/^ccrc: could not install .*ccgpt-proxy\.py — nothing at that path was replaced$/m);
    expect(r.calls).toContain('_codex_lock codex-a');
    expect(r.after).toBe('after rc=0 lockfd=');
  });

  it('a runtime its own check refuses is rebuilt, re-checked, and then the tiers are asked', () => {
    const r = runFixCodex({ runtime: { check: 1, build: 0, afterBuild: 0 } });
    expect(r.calls.slice(0, 4)).toEqual(['_codex_lanes', 'ccgpt-runtime check', 'ccgpt-runtime build', 'ccgpt-runtime check']);
    expect(r.fix).toEqual([
      "FIX codex: runtime: rebuilding with 'ccgpt-runtime build' — pip may take minutes",
      'FIX codex: runtime: rebuilt, probed and current',
      TIERS_LINE,
      DONE(1),
    ]);
    expect(r.calls[r.calls.length - 1]).toBe('_inst_codex_tiers role=both');
  });

  // Codex bridge Stage 4, Task 5: only a lane in litellm mode runs on the LiteLLM runtime, so step 2 asks first.
  it('with no lane in litellm mode, a runtime its check would refuse is neither checked nor rebuilt', () => {
    const r = runFixCodex({ runtime: { check: 1, build: 0, afterBuild: 0 }, wanted: 1 });
    expect(r.calls).toContain('_codex_runtime_wanted');
    expect(r.calls.filter((c) => c.startsWith('ccgpt-runtime ')), 'the runtime was asked or built for a box that needs none').toEqual([]);
    expect(r.fix.filter((l) => /runtime/.test(l))).toEqual([]);
    expect(r.calls, 'a fix that rebuilt nothing restarted the tiers').not.toContain('_inst_codex_tiers role=both');
  });

  it('when the modes cannot be told, a refused runtime is rebuilt as before: cannot tell is never "not needed"', () => {
    const r = runFixCodex({ runtime: { check: 1, build: 0, afterBuild: 0 }, wanted: 2 });
    expect(r.calls.slice(0, 5)).toEqual(['_codex_lanes', '_codex_runtime_wanted', 'ccgpt-runtime check', 'ccgpt-runtime build', 'ccgpt-runtime check']);
    expect(r.fix).toContain('FIX codex: runtime: rebuilt, probed and current');
  });

  it('the fix refuses when the question itself is not loaded, like any other seam', () => {
    const r = runFixCodex({ unload: '_codex_runtime_wanted' });
    expect(r.fix.join('\n')).toMatch(/^FIX codex: refused — ccrc's own _codex_runtime_wanted is not loaded/m);
  });

  it('a runtime that is not on this box is said, and no build is attempted', () => {
    const r = runFixCodex({ treeLacks: ['ccgpt-runtime'], bins: { 'ccgpt-runtime': 'missing' } });
    expect(r.fix).toEqual([
      "FIX codex: ccgpt-runtime: not restored — the shipped tree has no $HOME/ccrc/ccd/ccgpt-runtime; run 'ccrc update' (or 'ccrc install' from a checkout) to place it",
      'FIX codex: runtime: not rebuilt — $HOME/.local/bin/ccgpt-runtime is not on this box (the lines above say why)',
      DONE(1),
    ]);
    expect(r.fix.some((l) => /rebuilding/.test(l))).toBe(false);
    expect(r.calls.some((l) => l.startsWith('ccgpt-runtime '))).toBe(false);
    expect(tiersAsked(r)).toEqual([]);
  });

  it('a build that fails, or leaves no current runtime, is said — and no tier is restarted over it', () => {
    for (const runtime of [{ check: 1, build: 2 }, { check: 1, build: 0, afterBuild: 1 }]) {
      const r = runFixCodex({ runtime });
      expect(r.fix).toContain("FIX codex: runtime: NOT rebuilt — 'ccgpt-runtime build' did not leave a current runtime (its reason is the ccgpt-runtime line on stderr), so the previous one, if any, stays current");
      expect(r.calls.some((l) => l.startsWith('_inst_codex_tiers')), JSON.stringify(runtime)).toBe(false);
    }
  });

  it('lane.json stale against the roster, or absent, is re-rendered by its one writer under the lane lock', () => {
    for (const st of ['stale', 'absent'] as const) {
      const r = runFixCodex({ laneState: { 'codex-a': st } });
      expect(r.calls).toEqual(['_codex_lanes', 'ccgpt-runtime check', '_codex_lock codex-a',
        check(r.home, 'codex-a'), commit(r.home, 'codex-a'), held('codex-a'), '_codex_unlock codex-a']);
      expect(r.fix).toEqual(["FIX codex: codex-a: lane.json re-rendered from the roster and this lane's class registry", DONE(1)]);
    }
  });

  it('lane.json current against the roster but stale against the registry (R7) is re-rendered too — and an answer it cannot read is stale, never current', () => {
    for (const v of [true, 'refused'] as const) {
      const r = runFixCodex({ registryChanged: { 'codex-a': v } });
      expect(r.calls, String(v)).toContain(commit(r.home, 'codex-a'));
      expect(r.fix).toContain("FIX codex: codex-a: lane.json re-rendered from the roster and this lane's class registry");
    }
  });

  it('a lane with no class registry is named with the one act that renders it; a writer refusal with its own code', () => {
    const none = runFixCodex({ laneState: { 'codex-a': 'absent' }, commit: { 'codex-a': 'no-registry' } });
    expect(none.fix).toContain('FIX codex: codex-a: lane.json NOT rendered — this lane has no class registry, and lane.json is rendered from it; run: ccrc models codex-a init codex');
    const refused = runFixCodex({ laneState: { 'codex-a': 'stale' }, commit: { 'codex-a': 'refused' } });
    expect(refused.fix).toContain('FIX codex: codex-a: lane.json NOT rendered — deploy/models-op.mjs answered settings-unwritable: fixture: the env block cannot be rendered');
  });

  it("a lane-files lock that refuses is said as the lock's, never as models-op's answer: node never ran, and no lane file was written", () => {
    for (const [word, why] of [['lock-busy', 'another writer holds'], ['lock-unwritable', 'ccrc refuses the lock path of']] as const) {
      const r = runFixCodex({ laneState: { 'codex-a': 'stale' }, commit: { 'codex-a': word } });
      expect(r.fix, word).toContain(`FIX codex: codex-a: lane.json NOT rendered, and no lane file written — ${why} this lane's model files (${word}), so deploy/models-op.mjs never ran: fixture: the lane-files lock of codex-a was not taken. Fix it, then re-run.`);
      expect(r.fix.join('\n'), word).not.toMatch(/answered lock-|Nothing was written/);
    }
  });

  it('litellm.yaml goes through the codex arm\'s body, holding the lane lock, and what it did is said', () => {
    const r = runFixCodex({ lanes: ['codex-a', 'codex-b'], litellm: { 'codex-a': 'rendered', 'codex-b': 'restarted' } });
    expect(r.calls).toContain(held('codex-a'));
    expect(r.calls).toContain(held('codex-b'));
    expect(r.fix).toEqual([
      'FIX codex: codex-a: litellm.yaml re-rendered',
      "FIX codex: codex-b: litellm.yaml re-rendered, and this lane's own LiteLLM tier restarted onto it",
      DONE(2),
    ]);
    // A render restarts its own tier; nothing else here does.
    expect(r.calls.some((l) => l.startsWith('_inst_codex_tiers'))).toBe(false);
  });

  it('a render the codex arm refuses — a tier it cannot prove this lane\'s — is named and contained, and the next lane still runs', () => {
    const r = runFixCodex({ lanes: ['codex-a', 'codex-b'], litellm: { 'codex-a': 'foreign', 'codex-b': 'rendered' } });
    expect(r.fix).toEqual([
      "FIX codex: codex-a: litellm.yaml NOT rendered — tier-foreign: lane codex-a's LiteLLM tier is not provably this lane's — fixture",
      'FIX codex: codex-b: litellm.yaml re-rendered',
      DONE(2),
    ]);
    expect(r.tripwire).toEqual([]);
    expect(r.after).toBe('after rc=0 lockfd=');
  });

  it('a roster row that does not validate is left — no lock, no write, no render — and the roster is byte-identical', () => {
    const r = runFixCodex({ lanes: ['codex-a', 'codex-b'], badRows: ['codex-a'], laneState: { 'codex-a': 'stale', 'codex-b': 'stale' } });
    expect(r.fix).toEqual([
      'FIX codex: codex-a: nothing cured — its roster row does not validate (the ccrc codex: line above says why), and --fix never edits the roster or chooses a port',
      "FIX codex: codex-b: lane.json re-rendered from the roster and this lane's class registry",
      DONE(2),
    ]);
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: account 'codex-a''s codex row does not validate/m);
    expect(r.calls.filter((l) => l.includes('codex-a') && !l.startsWith('_codex_lanes'))).toEqual([]);
    expect(readFileSync(join(r.home, '.ccrc', 'accounts.json'), 'utf8')).toBe('{"fixture":"a roster --fix must never write"}\n');
  });

  it('a lane whose lock cannot be taken is left, and the next lane still runs; each lock is released before the next is taken', () => {
    const refused = runFixCodex({ lanes: ['codex-a', 'codex-b'], lockRefuse: ['codex-a'], laneState: { 'codex-a': 'stale' } });
    expect(refused.fix[0]).toBe("FIX codex: codex-a: nothing cured — its lane lock could not be taken (the line above says why); re-run 'ccrc doctor --fix' once it is free");
    expect(refused.calls).not.toContain(commit(refused.home, 'codex-a'));
    expect(refused.calls).toContain('_codex_lock codex-b');
    const both = runFixCodex({ lanes: ['codex-a', 'codex-b'] });
    expect(both.calls.filter((l) => /^(_codex_lock|_codex_unlock|LOCK-STILL-HELD) /.test(l)))
      .toEqual(['_codex_lock codex-a', '_codex_unlock codex-a', '_codex_lock codex-b', '_codex_unlock codex-b']);
    expect(both.after).toBe('after rc=0 lockfd=');
  });

  it('a tier restart that cannot finish is said', () => {
    const r = runFixCodex({ bins: { 'ccgpt-proxy.py': 'drift' }, tiersDegraded: true });
    expect(r.fix).toContain("FIX codex: tiers: this fix replaced code a running tier runs (the shim, the runtime or the auth library), so it re-ran the install step 'ccrc update' runs, and that step could not restart every stale tier (its lines above say which)");
  });

  it('a roster two lanes share a port in is refused by both writers: each lane is named NOT rendered with models-op\'s own code, and nothing is written', () => {
    const both = { 'codex-a': 'roster-invalid', 'codex-b': 'roster-invalid' } as const;
    const r = runFixCodex({ lanes: ['codex-a', 'codex-b'], laneFiles: true, registryChanged: both, commit: both, litellm: both });
    expect(r.code, r.stderr).toBe(0);
    const why = 'fixture: accounts "codex-a" and "codex-b" both use port 45011.';
    expect(r.fix).toEqual([
      `FIX codex: codex-a: lane.json NOT rendered — deploy/models-op.mjs answered roster-invalid: ${why}`,
      `FIX codex: codex-a: litellm.yaml NOT rendered — roster-invalid: ${why}`,
      `FIX codex: codex-b: lane.json NOT rendered — deploy/models-op.mjs answered roster-invalid: ${why}`,
      `FIX codex: codex-b: litellm.yaml NOT rendered — roster-invalid: ${why}`,
      DONE(2),
    ]);
    for (const id of ['codex-a', 'codex-b']) {
      for (const [rel, text] of Object.entries(laneFileText(id))) {
        expect(readFileSync(join(r.home, rel), 'utf8'), rel).toBe(text);
      }
      // …and nothing new beside them: no tmp, no .prev, no second render.
      expect(readdirSync(join(r.home, '.ccrc', 'codex', id)).sort(), id).toEqual(['lane.json', 'litellm.yaml']);
    }
    expect(readFileSync(join(r.home, '.ccrc', 'accounts.json'), 'utf8')).toBe('{"fixture":"a roster --fix must never write"}\n');
  });

  it('never OAuth, never a credential, never a unit: every arm at once touches none of them', () => {
    const r = runFixCodex({
      lanes: ['codex-a', 'codex-b'], bins: { 'ccgpt-usage.py': 'drift' }, runtime: { check: 1 },
      laneState: { 'codex-a': 'absent' }, litellm: { 'codex-b': 'restarted' },
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.tripwire).toEqual([]);
    // codex-a has NO authDir on disk: none is created. codex-b's is 0000: it
    // is still exactly what it was — compared by lstat (size, mtime, inode),
    // never by reading its bytes (G8) — because nothing opened it.
    expect(existsSync(join(r.home, codexAuthDir('codex-a')))).toBe(false);
    const auth = lstatSync(join(r.home, codexAuthDir('codex-b'), 'auth.json'));
    expect(auth.mode & 0o777).toBe(0o000);
    expect({ size: auth.size, mtimeMs: auth.mtimeMs, ino: auth.ino }).toEqual(r.credBefore);
    expect(readFileSync(join(r.home, '.ccrc', 'accounts.json'), 'utf8')).toBe('{"fixture":"a roster --fix must never write"}\n');
  });
});


describe('ccrc doctor --fix: wrappers — a launcher is regenerated only when ccrc\'s marker still verifies (Plan 3a Task 8)', () => {
  /** A FULL roster — label, homeAble and telemetry on every row, which `ccrc
   *  wrappers`' own validator requires and `writeRoster`'s convenience rows do
   *  not carry — with one GENERATED account and no codex row, so `_check_codex`
   *  SKIPs and `_fix_codex` never runs on these boxes (the Codex case below is
   *  the one exception, and says so). */
  const UP = { id: 'claude', label: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, telemetry: 'anthropic' };
  const GEN = { id: 'claude9', label: 'claude9', configDirSuffix: '.claude9', exec: { kind: 'generated' }, homeAble: true, telemetry: 'none' };
  const marked = (id: string, suffix: string, execKind: 'generated' | 'codex'): string =>
    markGenerated(generateWrapperBody({ id, configDirSuffix: suffix, execKind }, 'claude'));
  function launcherBox(prefix: string, accounts: object[] = [UP, GEN]): string {
    const home = healthy(prefix);
    writeRawRoster(home, `${JSON.stringify({ version: 1, accounts }, null, 2)}\n`);
    // `cmd_wrappers` resolves its generator one directory up from ITS OWN file:
    // `$HOME/ccrc/deploy/gen-wrappers.mjs` here. A symlink, because node
    // resolves the generator's own imports from its real path (this checkout's
    // `shared/`), which is the pair a box ships together.
    mkdirSync(join(home, 'ccrc', 'deploy'), { recursive: true });
    symlinkSync(join(REPO, 'deploy', 'gen-wrappers.mjs'), join(home, 'ccrc', 'deploy', 'gen-wrappers.mjs'));
    // The verb's own tools. The contained PATH carries none of them by design.
    for (const t of ['mkdir', 'mktemp', 'date', 'stat', 'cp', 'chmod', 'mv', 'rm']) linkReal(home, t);
    return home;
  }
  const bin = (home: string, id: string): string => join(home, '.local', 'bin', id);
  /** Everything doctor printed AFTER the fixer's closing line: the re-measurement. */
  const second = (out: string): string => {
    const i = out.lastIndexOf("FIX wrappers: ran the shipped tree's 'ccrc wrappers'");
    if (i < 0) throw new Error(`no _fix_wrappers closing line in:\n${out}`);
    return out.slice(i);
  };
  const backups = (home: string, id: string): string[] =>
    readdirSync(join(home, '.local', 'bin')).filter((n) => n.startsWith(`${id}.pre-ccrc-`));

  it('a shipped tree with no ccd/ccrc is refused by _fix_wrappers, which then runs nothing (measured in isolation)', () => {
    const home = mkTmp('ccrc-doctor-fix-wrappers-notree-');
    mkdirSync(join(home, 'ccrc', 'ccd'), { recursive: true });
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    const wall = isolationManagerStubs(home);
    const env = { PATH: `${wall}:${process.env['PATH'] ?? ''}`, HOME: home, LC_ALL: 'C' };
    assertIsolationWallFirst(env, home);
    const r = spawnSync(BASH, ['-c', ['set -uo pipefail', 'BOX_TREE_DIR="$HOME/ccrc"', checksFunction('_fix_wrappers'),
      '_fix_wrappers; echo "rc=$?"'].join('\n')], { env, encoding: 'utf8' });
    expect(strayManagerCalls(home)).toEqual([]);
    expect((r.stdout ?? '').split('\n').filter(Boolean)).toEqual([
      "FIX wrappers: refused — the shipped tree has no $HOME/ccrc/ccd/ccrc, so its 'ccrc wrappers' cannot be run; run 'ccrc update' (or 'ccrc install' from a checkout)",
      'rc=1',
    ]);
    expect(readdirSync(join(home, '.local', 'bin'))).toEqual([]);
  });

  it('an absent launcher is written by --fix, and the re-measurement is a PASS', () => {
    const home = launcherBox('ccrc-doctor-fix-wrappers-absent-');
    const r0 = runDoctor(home);
    expect(lineFor(r0.stdout, 'wrappers')).toMatch(/^FAIL wrappers: /);
    expect(existsSync(bin(home, 'claude9')), 'doctor without --fix wrote a launcher').toBe(false);
    const r = runDoctor(home, ['doctor', '--fix']);
    expect(r.stdout).toMatch(/^FIX wrappers: WRITE claude9: /m);
    expect(second(r.stdout)).toMatch(/^PASS wrappers: /m);
    expect(readFileSync(bin(home, 'claude9'), 'utf8')).toBe(marked('claude9', '.claude9', 'generated'));
    expect(statSync(bin(home, 'claude9')).mode & 0o777).toBe(0o755);
  });

  it('a launcher whose ccrc marker still verifies, written for an older roster, is regenerated, and the one it replaced is kept', () => {
    const home = launcherBox('ccrc-doctor-fix-wrappers-stale-');
    const old = marked('claude9', '.claude9-old', 'generated');
    writeFileSync(bin(home, 'claude9'), old, { mode: 0o755 });
    const r0 = runDoctor(home);
    expect(lineFor(r0.stdout, 'wrappers')).toMatch(/^FAIL wrappers: /);
    expect(readFileSync(bin(home, 'claude9'), 'utf8')).toBe(old);
    const r = runDoctor(home, ['doctor', '--fix']);
    expect(r.stdout).toMatch(/^FIX wrappers: REWRITE claude9: /m);
    expect(second(r.stdout)).toMatch(/^PASS wrappers: /m);
    expect(readFileSync(bin(home, 'claude9'), 'utf8')).toBe(marked('claude9', '.claude9', 'generated'));
    const b = backups(home, 'claude9');
    expect(b).toHaveLength(1);
    expect(readFileSync(bin(home, b[0]!), 'utf8')).toBe(old);
  });

  it('a launcher ccrc did not write is never overwritten: its FAIL stands, byte for byte, with no backup', () => {
    const home = launcherBox('ccrc-doctor-fix-wrappers-foreign-');
    const foreign = ['#!/usr/bin/env bash', '# hand-written, and pointing somewhere else on purpose',
      'export CLAUDE_CONFIG_DIR="$HOME/.claude9-elsewhere"', 'exec "$HOME/.local/bin/claude" "$@"', ''].join('\n');
    writeFileSync(bin(home, 'claude9'), foreign, { mode: 0o755 });
    const r = runDoctor(home, ['doctor', '--fix']);
    expect(r.stdout).toMatch(/^FIX wrappers: REFUSE claude9: /m);
    expect(second(r.stdout)).toMatch(/^FAIL wrappers: /m);
    expect(readFileSync(bin(home, 'claude9'), 'utf8')).toBe(foreign);
    expect(backups(home, 'claude9')).toEqual([]);
  });

  it('a launcher ccrc wrote and someone edited since is never overwritten either', () => {
    const home = launcherBox('ccrc-doctor-fix-wrappers-edited-');
    const edited = marked('claude9', '.claude9', 'generated').replace('/.claude9"', '/.claude9-hand"');
    expect(edited, 'the edit changed nothing — re-anchor it on the export line').not.toBe(marked('claude9', '.claude9', 'generated'));
    writeFileSync(bin(home, 'claude9'), edited, { mode: 0o755 });
    const r = runDoctor(home, ['doctor', '--fix']);
    expect(r.stdout).toMatch(/^FIX wrappers: REFUSE claude9: /m);
    expect(second(r.stdout)).toMatch(/^FAIL wrappers: /m);
    expect(readFileSync(bin(home, 'claude9'), 'utf8')).toBe(edited);
    expect(backups(home, 'claude9')).toEqual([]);
  });

  it('a Codex lane\'s marker-verified launcher is regenerated the same way, to exec ccrc-codex', async () => {
    // This box has a codex row, so `_check_codex` measures it and FAILs (none
    // of its lane state exists), and `_fix_codex` runs too. It is contained
    // here the way every doctor fixture is: a contained PATH, no user manager,
    // healthy()'s `python3` stub (a runtime build this reached would fail at
    // `venv` before any pip), and free ports (a tier question finds nothing).
    // Only the `wrappers` lines are this case's subject.
    const [lane] = await freeLanes(['codex-a']);
    const home = launcherBox('ccrc-doctor-fix-wrappers-codex-', [UP, {
      id: 'codex-a', label: 'codex-a', configDirSuffix: '.claude-codex-a', homeAble: true, telemetry: 'codex',
      exec: { kind: 'codex', provider: 'openai', proxyPort: lane!.proxyPort, litellmPort: lane!.litellmPort,
        authDir: codexAuthDir('codex-a') },
    }]);
    writeFileSync(bin(home, 'codex-a'), marked('codex-a', '.claude-codex-a-old', 'codex'), { mode: 0o755 });
    const r = runDoctor(home, ['doctor', '--fix']);
    expect(r.stdout).toMatch(/^FIX wrappers: REWRITE codex-a: /m);
    expect(second(r.stdout)).toMatch(/^PASS wrappers: /m);
    const text = readFileSync(bin(home, 'codex-a'), 'utf8');
    expect(text).toBe(marked('codex-a', '.claude-codex-a', 'codex'));
    expect(text).toContain('\nexec "$HOME/.local/bin/ccrc-codex" "$@"\n');
  });
});


// `describeCodex`, as every other `healthyCodexBox` case in this file: that
// fixture's runtime check hands its stamp read to a real python3, and without
// one its runtime reads `mutated`, so `_fix_codex` would reach a build and
// every case would red for the fixture's reason, not the fixer's.
describeCodex('ccrc doctor --fix: codex, on a real doctor run (Plan 3a Task 8)', () => {
  // Task 4's `healthyCodexBox`, as Tasks 4-6 leave it: `_check_codex` prints
  // no FAIL on it. Each case breaks exactly ONE thing. `await` takes the
  // fixture whether Tasks 4-5 left it synchronous or not.
  //
  // CONTAINED THE WAY EVERY DOCTOR FIXTURE IS: a PATH of fixture directories
  // only (no `systemd-run`, a stub `systemctl`), and healthy()'s `python3`
  // stub, so a runtime build reached by mistake fails at `venv` before any
  // pip. Every case also asserts that no `runtime: rebuilding` line appears,
  // so such a mistake is a red here, never a slow build. The runtime arm
  // itself is measured in isolation above: a real one is pip.
  const FIX_TOOLS = ['cmp', 'cp', 'chmod', 'mv', 'rm', 'mkdir'] as const;
  /** Everything after the fixer's closing line: doctor's SECOND measurement. */
  const afterFix = (out: string): string => {
    const i = out.lastIndexOf('FIX codex: done for ');
    if (i < 0) throw new Error(`_fix_codex never reached its closing line:\n${out}`);
    return out.slice(i);
  };
  const noBuild = (out: string): void => {
    expect(out, 'this case reached a runtime build').not.toMatch(/^FIX codex: runtime: rebuilding/m);
  };
  type Roster = { accounts: Array<{ id: string; exec: Record<string, unknown> }> };
  const rosterFile = (home: string): string => join(home, '.ccrc', 'accounts.json');
  const readRosterJson = (home: string): Roster => JSON.parse(readFileSync(rosterFile(home), 'utf8')) as Roster;
  const codexRowOf = (j: Roster): { id: string; exec: Record<string, unknown> } => {
    const row = j.accounts.find((a) => a.id === 'codex-a');
    if (row === undefined) throw new Error('healthyCodexBox rosters no codex-a');
    return row;
  };
  const laneJson = (home: string): string => join(home, '.ccrc', 'codex', 'codex-a', 'lane.json');

  it('a drifted GPT-lane executable is placed again from the shipped tree, and the re-measurement — not the FIX line — is the verdict', async () => {
    const home = await healthyCodexBox('ccrc-doctor-fix-codex-bin-');
    for (const t of FIX_TOOLS) linkReal(home, t);
    const shipped = join(home, 'ccrc', 'ccd', 'ccgpt-usage.py');
    const placed = join(home, '.local', 'bin', 'ccgpt-usage.py');
    expect(existsSync(shipped), 'healthyCodexBox ships no ccgpt-usage.py in its tree (Task 4 owes it)').toBe(true);
    const drifted = '#!/usr/bin/env python3\n# drifted by hand\n';
    // Unlink first: a write through a link the fixture planted would edit its target.
    rmSync(placed, { force: true });
    writeFileSync(placed, drifted, { mode: 0o755 });
    const r0 = runDoctor(home);
    expect(r0.stdout).toMatch(/^FAIL codex: /m);
    expect(r0.stdout, 'doctor without --fix ran a fixer').not.toMatch(/^FIX /m);
    expect(readFileSync(placed, 'utf8')).toBe(drifted);
    const r = runDoctor(home, ['doctor', '--fix']);
    noBuild(r.stdout);
    expect(r.stdout).toMatch(/^FIX codex: restored \$HOME\/\.local\/bin\/ccgpt-usage\.py from the shipped tree$/m);
    // The re-measurement RAN, and PASSes: "no FAIL" alone is vacuous over a
    // doctor run that ended inside the fixer (the whole-cure-subshell row).
    expect(afterFix(r.stdout)).toMatch(/^PASS codex: /m);
    expect(afterFix(r.stdout)).not.toMatch(/^FAIL codex: /m);
    expect(readFileSync(placed).equals(readFileSync(shipped))).toBe(true);
    expect(statSync(placed).mode & 0o777).toBe(0o755);
  });

  // Codex bridge Stage 1, Task 5: the auth library is compared and restored
  // exactly like the other four, by the same loop over CODEX_LANE_BINS.
  it('a drifted placed ccgpt-auth.py FAILs, and --fix restores it from the shipped tree', async () => {
    const home = await healthyCodexBox('ccrc-doctor-fix-codex-auth-lib-');
    for (const t of FIX_TOOLS) linkReal(home, t);
    const shipped = join(home, 'ccrc', 'ccd', 'ccgpt-auth.py');
    const placed = join(home, '.local', 'bin', 'ccgpt-auth.py');
    expect(existsSync(shipped), 'healthyCodexBox ships no ccgpt-auth.py in its tree').toBe(true);
    const drifted = '#!/usr/bin/env python3\n# drifted by hand\n';
    // Unlink first: a write through a link the fixture planted would edit its target.
    rmSync(placed, { force: true });
    writeFileSync(placed, drifted, { mode: 0o755 });
    const r0 = runDoctor(home);
    expect(r0.stdout, r0.stdout).toMatch(/^FAIL codex: ccgpt-auth\.py in \$HOME\/\.local\/bin differ from the shipped tree's copies in /m);
    expect(r0.stdout, 'doctor without --fix ran a fixer').not.toMatch(/^FIX /m);
    expect(readFileSync(placed, 'utf8')).toBe(drifted);
    const r = runDoctor(home, ['doctor', '--fix']);
    noBuild(r.stdout);
    expect(r.stdout).toMatch(/^FIX codex: restored \$HOME\/\.local\/bin\/ccgpt-auth\.py from the shipped tree$/m);
    expect(afterFix(r.stdout)).toMatch(/^PASS codex: /m);
    expect(afterFix(r.stdout)).not.toMatch(/^FAIL codex: /m);
    expect(readFileSync(placed).equals(readFileSync(shipped))).toBe(true);
    expect(statSync(placed).mode & 0o777).toBe(0o755);
  });

  it('an absent lane.json is rendered by --fix: the remedy the usage publisher names works on this tree', async () => {
    const home = await healthyCodexBox('ccrc-doctor-fix-codex-lanejson-');
    expect(existsSync(laneJson(home)), 'healthyCodexBox has no lane.json (Task 4 owes it)').toBe(true);
    const want = JSON.parse(readFileSync(laneJson(home), 'utf8')) as unknown;
    rmSync(laneJson(home));
    const r0 = runDoctor(home);
    expect(r0.stdout).toMatch(/^FAIL codex: /m);
    expect(existsSync(laneJson(home)), 'doctor without --fix wrote a lane.json').toBe(false);
    const r = runDoctor(home, ['doctor', '--fix']);
    noBuild(r.stdout);
    expect(r.stdout).toMatch(/^FIX codex: codex-a: lane\.json re-rendered from the roster and this lane's class registry$/m);
    expect(afterFix(r.stdout)).toMatch(/^PASS codex: /m);
    expect(afterFix(r.stdout)).not.toMatch(/^FAIL codex: /m);
    expect(JSON.parse(readFileSync(laneJson(home), 'utf8'))).toEqual(want);
  });

  it('a hand-edited litellm.yaml is re-rendered through the codex arm, and no tier was running to restart', async () => {
    const home = await healthyCodexBox('ccrc-doctor-fix-codex-litellm-');
    const yaml = join(home, '.ccrc', 'codex', 'codex-a', 'litellm.yaml');
    expect(existsSync(yaml), 'healthyCodexBox has no litellm.yaml (Task 4 owes it)').toBe(true);
    const want = readFileSync(yaml, 'utf8');
    writeFileSync(yaml, `${want}# edited by hand\n`);
    const r = runDoctor(home, ['doctor', '--fix']);
    noBuild(r.stdout);
    expect(r.stdout).toMatch(/^FIX codex: codex-a: litellm\.yaml re-rendered$/m);
    expect(afterFix(r.stdout)).toMatch(/^PASS codex: /m);
    expect(afterFix(r.stdout)).not.toMatch(/^FAIL codex: /m);
    expect(readFileSync(yaml, 'utf8')).toBe(want);
  });

  it.skipIf(pythonOrSkip() === null)('a foreign listener on a lane port survives --fix and its FAIL stands, while what --fix may cure is cured', async () => {
    const home = await healthyCodexBox('ccrc-doctor-fix-codex-foreign-');
    // Fresh ports — never a hard-coded one for a real listener — which also
    // leaves lane.json stale against the roster: a FAIL this fix may cure.
    const [ports] = await freeLanes(['codex-a']);
    const j = readRosterJson(home);
    const row = codexRowOf(j);
    row.exec['proxyPort'] = ports!.proxyPort;
    row.exec['litellmPort'] = ports!.litellmPort;
    writeFileSync(rosterFile(home), `${JSON.stringify(j, null, 2)}\n`);
    const foreign = await spawnListener(home, { answer: 'text', lane: 'codex-a', port: ports!.proxyPort });
    try {
      const r = runDoctor(home, ['doctor', '--fix']);
      noBuild(r.stdout);
      expect(r.stdout).toMatch(/^FIX codex: codex-a: lane\.json re-rendered from the roster and this lane's class registry$/m);
      // Task 5's own sentence for a listener on codex-a's shim port that
      // answers with no lane id: the FAIL that stands is THAT one.
      expect(afterFix(r.stdout)).toMatch(new RegExp(`^FAIL codex: codex-a: port ${ports!.proxyPort} \\(codex-a's shim tier\\) is held by a listener that is not this lane's: its identity check failed`, 'm'));
      // Its port still accepting is the survival pin, never `alive()`: a
      // killed child of this process stays a zombie, alive to `kill -0`,
      // until the event loop reaps it (Task 5's ruling, codexLaneFixture.ts).
      expect(await portAccepts(ports!.proxyPort), 'the foreign listener was signalled').toBe(true);
      expect((JSON.parse(readFileSync(laneJson(home), 'utf8')) as { proxyPort: number }).proxyPort).toBe(ports!.proxyPort);
    } finally {
      await killLaneProcesses(home);
    }
  }, 60_000);

  it('a roster row whose two ports collide stays FAIL: --fix chooses no port and writes no roster', async () => {
    const home = await healthyCodexBox('ccrc-doctor-fix-codex-ports-');
    const j = readRosterJson(home);
    const row = codexRowOf(j);
    row.exec['litellmPort'] = row.exec['proxyPort'];
    writeFileSync(rosterFile(home), `${JSON.stringify(j, null, 2)}\n`);
    const before = readFileSync(rosterFile(home));
    const r = runDoctor(home, ['doctor', '--fix']);
    noBuild(r.stdout);
    expect(r.stdout).toMatch(/^FIX codex: codex-a: nothing cured — its roster row does not validate \(the ccrc codex: line above says why\), and --fix never edits the roster or chooses a port$/m);
    expect(afterFix(r.stdout)).toMatch(/^FAIL codex: /m);
    expect(readFileSync(rosterFile(home)).equals(before), '--fix wrote the roster').toBe(true);
  });

  it('an absent authDir stays FAIL with the login remedy: --fix runs no OAuth and creates nothing there', async () => {
    const home = await healthyCodexBox('ccrc-doctor-fix-codex-auth-');
    const auth = authDirOf(home, 'codex-a');
    rmSync(auth, { recursive: true, force: true });
    const r = runDoctor(home, ['doctor', '--fix']);
    noBuild(r.stdout);
    const second = afterFix(r.stdout);
    expect(second).toMatch(/^FAIL codex: /m);
    expect(second).toMatch(/^ {2}remedy: .*ccrc codex login codex-a/m);
    expect(existsSync(auth), '--fix created the authDir').toBe(false);
  });
});


// ── scope-sweep (session-continuity wave 4) ─────────────────────────────────
// `_check_scope-sweep` READS the sweep's verdict record and never re-derives it:
// every unit below is absent from the fixture's own `systemctl list-units`, so a
// check that asked the box instead of the record would list none of them.
describeLinux('ccrc doctor: scope-sweep', () => {
  const now = (): number => Math.floor(Date.now() / 1000);
  const UP = 100 * 86400;   // the sweep's boot-relative clock at the record's tick: `first=` is read against it
  const record = (home: string, lines: string[], ago = 0, mode = 'shadow'): void => {
    writeFileSync(join(home, 'fixture-scope-sweep.state'), [`# ccd-scope-sweep v1 tick=${now() - ago} up=${UP} mode=${mode}`, ...lines].join('\n') + '\n');
  };
  const DEAD = 'tmux-spawn-00000001-0000-4000-8000-000000000000.scope';
  const LIVE = 'tmux-spawn-00000002-0000-4000-8000-000000000000.scope';

  it('PASSes on a fresh record with nothing in it, and says the mode it ran in', () => {
    const home = healthy('ccrc-doctor-scope-sweep-pass-');
    expect(lineFor(runDoctor(home).stdout, 'scope-sweep')).toMatch(/^PASS scope-sweep: no dead pane scope the sweep could measure, and no process older than a day in a live one \(the sweep's record, \d+s old, mode shadow; 0 busy orphan\(s\), busy mode shadow\)$/);
  });

  it('WARNS with every dead scope: how long dead, the scope\'s and its oldest process\'s age, pids, memory, sockets and verdict', () => {
    const home = healthy('ccrc-doctor-scope-sweep-dead-');
    record(home, [`dead ${DEAD} first=${UP - 7 * 3600} cpu0=7 verdict=would-stop why=none server=gone procs=3 mem=${20 * 2 ** 20} sockets=0 youngest=90000 oldest=${27 * 86400} age=${28 * 86400} pids=1,2,3`]);
    const out = runDoctor(home).stdout.split('\n');
    const i = out.findIndex((l) => l.startsWith('WARN scope-sweep: '));
    expect(i, out.join('\n')).toBeGreaterThan(-1);
    expect(out[i]).toContain(`${DEAD} dead 420 min, the scope 672 h old, its oldest process 648 h: 3 process(es) (pids 1,2,3), 20 MiB, 0 socket(s), its server gone, would-stop (none)`);
    expect(out[i]).toContain('(mode shadow)');
    expect(out[i + 1]).toMatch(/^ {2}remedy: read each before acting: /);
  });

  it('SKIPs while the operator has paused the sweep — never a stale record\'s WARN', () => {
    const home = healthy('ccrc-doctor-scope-sweep-paused-');
    record(home, [], 3600);                                        // the paused sweep rewrote nothing for an hour
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', 'scope-sweep-paused'), '');
    expect(anyVerdictFor(runDoctor(home).stdout, 'scope-sweep')).toMatch(/^SKIP scope-sweep: paused by the operator /);
  });

  it('SKIPs on a server-role box: it runs no pane scope and no sweep', () => {
    const home = healthy('ccrc-doctor-scope-sweep-server-');
    record(home, [`dead ${DEAD} first=${UP - 7 * 3600} cpu0=7 verdict=would-stop why=none server=gone procs=3 mem=1 sockets=0 youngest=90000 oldest=90000 age=90000 pids=1,2,3`]);
    writeCcrcEnv(home, ['CCRC_ROLE=server', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    expect(anyVerdictFor(runDoctor(home).stdout, 'scope-sweep')).toMatch(/^SKIP scope-sweep: this box records CCRC_ROLE=server/);
  });

  it('WARNS with every process older than a day in a live pane scope', () => {
    const home = healthy('ccrc-doctor-scope-sweep-old-');
    record(home, [`old ${LIVE} pid=4242 age=${3 * 86400} comm=bash`]);
    expect(lineFor(runDoctor(home).stdout, 'scope-sweep')).toContain(`${LIVE} live: pid 4242 (bash) running 72 h`);
  });

  it('WARNS when the record is stale: the sweep has stopped running', () => {
    const home = healthy('ccrc-doctor-scope-sweep-stale-');
    record(home, [], 600);
    expect(lineFor(runDoctor(home).stdout, 'scope-sweep')).toMatch(/^WARN scope-sweep: the verdict record is \d+s old/);
  });

  it('WARNS on a record that is not a v1 record', () => {
    const home = healthy('ccrc-doctor-scope-sweep-garbled-');
    writeFileSync(join(home, 'fixture-scope-sweep.state'), `# ccd-scope-sweep v2 tick=${now()} up=${UP} mode=shadow\ndead something\n`);   // a later format this doctor cannot read
    expect(lineFor(runDoctor(home).stdout, 'scope-sweep')).toMatch(/^WARN scope-sweep: the verdict record at .* is unreadable or not a v1 record/);
  });

  it('SKIPs with no record: not installed, or not yet run since its timer was armed or the box booted', () => {
    const home = healthy('ccrc-doctor-scope-sweep-absent-');
    rmSync(join(home, 'fixture-scope-sweep.state'));
    expect(anyVerdictFor(runDoctor(home).stdout, 'scope-sweep')).toMatch(/^SKIP scope-sweep: no verdict record at /);
  });

  // ── fix round 1 (Task 5 review): a garbled record is a WARN, never a FAIL ──────────────
  // A leading zero is an octal error in `$(( ))`, which aborts the check inside its `$( … )` and
  // makes doctor FAIL it ("printed no verdict line"); an unbounded digit run wraps the arithmetic.
  const DEADLINE = (o: Record<string, string> = {}): string => {
    const f = { first: String(UP - 7 * 3600), oldest: '90000', age: '90000', mem: '1', ...o };
    return `dead ${DEAD} first=${f.first} cpu0=7 verdict=would-stop why=none server=gone procs=3 mem=${f.mem} sockets=0 youngest=90000 oldest=${f.oldest} age=${f.age} pids=1,2,3`;
  };
  const noFail = (out: string): void => { expect(out).not.toMatch(/^FAIL scope-sweep/m); expect(out).not.toContain('printed no verdict line'); };

  it('a header with a leading-zero tick is not a v1 record: WARN, never an octal abort and FAIL', () => {
    const home = healthy('ccrc-doctor-scope-sweep-octal-tick-');
    writeFileSync(join(home, 'fixture-scope-sweep.state'), `# ccd-scope-sweep v1 tick=0${now()} up=${UP} mode=shadow\n`);
    const out = runDoctor(home).stdout;
    noFail(out);
    expect(lineFor(out, 'scope-sweep')).toMatch(/^WARN scope-sweep: the verdict record at .* is unreadable or not a v1 record/);
  });

  it('a 20-digit tick is not a v1 record: WARN — never a wrapped age that PASSes a stale record as fresh', () => {
    const home = healthy('ccrc-doctor-scope-sweep-wide-tick-');
    writeFileSync(join(home, 'fixture-scope-sweep.state'), `# ccd-scope-sweep v1 tick=${'9'.repeat(20)} up=${UP} mode=shadow\n`);
    const out = runDoctor(home).stdout;
    noFail(out);
    expect(lineFor(out, 'scope-sweep')).toMatch(/^WARN scope-sweep: the verdict record at .* is unreadable or not a v1 record/);
  });

  it('a dead line with a leading-zero number is named as a line it cannot read: WARN, never FAIL', () => {
    const home = healthy('ccrc-doctor-scope-sweep-octal-line-');
    record(home, [DEADLINE({ first: '08' }), `old ${LIVE} pid=4242 age=0${3 * 86400} comm=bash`]);
    const out = runDoctor(home).stdout;
    noFail(out);
    expect(lineFor(out, 'scope-sweep')).toMatch(/^WARN scope-sweep: .*2 line\(s\) it cannot read/);
  });

  it('a dead scope whose processes could not be measured (oldest=-1) is listed, not dropped', () => {
    const home = healthy('ccrc-doctor-scope-sweep-oldest-minus-');
    record(home, [DEADLINE({ oldest: '-1' })]);
    const out = runDoctor(home).stdout;
    noFail(out);
    expect(lineFor(out, 'scope-sweep')).toContain(`${DEAD} dead 420 min`);
    expect(lineFor(out, 'scope-sweep')).not.toContain('cannot read');
  });

  it('a garbage line under a good header is a WARN — an all-unparseable record never PASSes', () => {
    const home = healthy('ccrc-doctor-scope-sweep-garbage-');
    record(home, ['this is not a record line']);
    const out = runDoctor(home).stdout;
    expect(out).not.toMatch(/^PASS scope-sweep/m);
    expect(lineFor(out, 'scope-sweep')).toMatch(/^WARN scope-sweep: .*1 line\(s\) it cannot read/);
  });

  it('CCRC_SCOPE_SWEEP_STALE_S that is not a number falls back to 300 s: neither an abort nor a disabled check', () => {
    const home = healthy('ccrc-doctor-scope-sweep-stale-nan-');
    record(home, [], 600);
    const stale = runDoctor(home, ['doctor'], { CCRC_SCOPE_SWEEP_STALE_S: 'abc' }).stdout;
    noFail(stale);
    expect(lineFor(stale, 'scope-sweep')).toMatch(/^WARN scope-sweep: the verdict record is \d+s old/);
    record(home, [], 10);
    expect(lineFor(runDoctor(home, ['doctor'], { CCRC_SCOPE_SWEEP_STALE_S: 'abc' }).stdout, 'scope-sweep')).toMatch(/^PASS scope-sweep: /);
  });

  it.each([false, true])('an unreadable body uses only rewrite advice, with measured dead row present=%s', (mixed) => {
    const home = healthy('ccrc-doctor-scope-unreadable-body-');
    record(home, [...(mixed ? [DEADLINE()] : []), 'not a sweep row']);
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'scope-sweep')).toMatch(/^WARN scope-sweep: .*1 line\(s\) it cannot read/);
    expect(out).toContain('let the sweep rewrite it: systemctl --user start ccd-scope-sweep.service; then re-run doctor');
    expect(out).not.toContain('read each before acting');
    expect(out).not.toContain('systemctl --user stop <unit>');
    noFail(out);
  });

  it('a measured-live carry qualifies PASS instead of claiming every live process was read', () => {
    const home = healthy('ccrc-doctor-scope-live-carry-');
    record(home, [`carry ${LIVE} state=live first=123 cpu0=7 why=parent-hop-cap`]);
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'scope-sweep')).toMatch(/^PASS scope-sweep: /);
    expect(lineFor(out, 'scope-sweep')).toContain('excluding 1 live pane scope(s) carried unmeasured');
    expect(out).not.toContain('read each before acting');
  });

  it.each(['dead', 'unknown'])('a %s carry warns with measurement advice, never stop advice', (state) => {
    const home = healthy('ccrc-doctor-scope-unmeasured-carry-');
    const why = state === 'dead' ? 'socket-tables' : 'child-cgroup';
    record(home, [`carry ${DEAD} state=${state} first=none cpu0=none why=${why}`]);
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'scope-sweep')).toMatch(/^WARN scope-sweep: .*carried unmeasured/);
    expect(out).toContain('let the sweep rewrite the measurement');
    expect(out).not.toContain('read each before acting');
    expect(out).not.toContain('systemctl --user stop <unit>');
  });

  it.each([
    `carry ${DEAD} state=unknown first=none cpu0=7 why=child-cgroup`,
    `carry ${LIVE} state=live first=123 cpu0=7 why=child-cgroup`,
    `carry ${DEAD} state=unknown first=08 cpu0=7 why=child-cgroup`,
    `carry ${DEAD} state=dead first=123 cpu0=7 why=not-supported`,
    DEADLINE().replace('cpu0=7', 'cpu0=08'),
  ])('a malformed or contradictory carry/dead row gets rewrite advice: %s', (row) => {
    const home = healthy('ccrc-doctor-scope-bad-carry-');
    record(home, [row]);
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'scope-sweep')).toMatch(/^WARN scope-sweep: .*1 line\(s\) it cannot read/);
    expect(out).not.toContain('read each before acting');
    noFail(out);
  });

  it('a future record is neither fresh PASS nor destructive advice', () => {
    const home = healthy('ccrc-doctor-scope-future-');
    record(home, [], -3600);
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'scope-sweep')).toMatch(/^WARN scope-sweep: .*future/);
    expect(out).toContain('let the sweep rewrite it');
    expect(out).not.toContain('read each before acting');
    noFail(out);
  });

  it('mixed measured and carried rows keep measured advice explicitly scoped', () => {
    const home = healthy('ccrc-doctor-scope-mixed-carry-');
    record(home, [DEADLINE(), `carry ${LIVE} state=live first=none cpu0=none why=parent-hop-cap`]);
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'scope-sweep')).toContain('1 dead pane scope(s)');
    expect(lineFor(out, 'scope-sweep')).toContain('carried unmeasured');
    expect(out).toContain('stop advice applies only to the measured dead rows, never to a carry');
  });

  it('services: an installed, stopped ccd-scope-sweep.timer WARNS — a reboot empties the record, so only `known` sees it', () => {
    const home = healthy('ccrc-doctor-services-scope-sweep-timer-');
    writeUnitFile(home, 'ccd-scope-sweep.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-scope-sweep.timer'), 'inactive\n');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN services: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccd-scope-sweep.timer is installed but inactive');
    expect(lines[i]).toContain('no dead pane scope is recorded or collected');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: systemctl --user enable --now ccd-scope-sweep\.timer$/);
  });

  it('services: an active ccd-scope-sweep.timer is named among the PASSes', () => {
    const home = healthy('ccrc-doctor-services-scope-sweep-timer-ok-');
    writeUnitFile(home, 'ccd-scope-sweep.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-scope-sweep.timer'), 'active\n');
    expect(lineFor(runDoctor(home).stdout, 'services')).toContain('ccd-scope-sweep.timer is active');
  });
});
