// `ccrc doctor`, part: codex (D-6767). The doctor suite was one 17,000-line file that held a worker for 661 s; its describe blocks moved
// here unchanged, and the fixtures they share are in `ccrc-doctorFixture.ts`.
import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync, chmodSync, existsSync, utimesSync, appendFileSync, readdirSync, lstatSync, readlinkSync, statSync, renameSync, truncateSync } from 'node:fs';
import path, { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { describeLinux, itLinux, itDarwin, IS_DARWIN } from './platformFixtures.js';
import { authDirOf, codexRoster, fakeUnit, freeLanes, GPT_LANE_BINS, killLaneProcesses, laneUnits, plantFakeRuntime, plantCodexUsage, plantForeignUsage, plantLaneAuth, plantSystemd, portAccepts, spawnListener, systemdRunCalls, ccrcFunction, ccrcLine, lockStub, isolationManagerStubs, assertIsolationWallFirst, strayManagerCalls, codexAuthDir, type Listener, type ListenerAnswer } from './codexLaneFixture.js';
import { pythonOrSkip } from './ccgptHarness.js';
import { AUTH_ROUTES, CLOSED_AUTH_BASE, driverLines, fakeAuthServer, plantBackendCredential, runAuthDriver, type AuthAnswer } from './codexAuthFixture.js';
import { generateWrapperBody } from '../../shared/wrapper.mjs';
import { markGenerated } from '../../shared/mark.mjs';
import { createServer, type Socket } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../../ccd/history/store.mjs';
import { HEALTH_COUNTERS, HEALTH_META, HEALTH_WORDS, RECOVERY_STALL_TICKS, SCHEMA_VERSION, deriveHealth, historyPaths, formatOpMarker, procStartOf, bootIdOf } from '../../ccd/history/lib.mjs';
import { PRELOADS, preloadOptions } from './historyHelpers.js';
import { SW_DENYLIST_DEFAULT, swJs } from './swFixtures.js';
import { SERVER_CAPS_LEASE_S } from '../../shared/api.js';
import { installDoctorHooks, here, REPO, CCRC_SRC, CHECKS_SRC, BASH, realPath, Result, writeChecks, stubBin, stub, unstub, linkReal, stubNode, RosterEntry, UPSTREAM, writeRoster, writeRawRoster, entry, binDir, shq, writeCcrcEnv, stubLaunchctl, unitDirOf, unitFileOf, writeUnitFile, removeUnitFile, containedPath, doctorEnv, OOM_DROPIN, plantOomPolicy, DOCTOR_DEADLINE_BIN, runDoctorBounded, runDoctor, DH_INSTALLER, installerEvents, installerHook, plantHookRegistration, plantSpoolDir, BT_PY_ARM, healthy, PY, describeCodex, itCodex, writeLaneModels, renderLane, startedJson, lanePorts, editRosterRow, healthyCodexBox, broken, tableNames, lineFor, anyVerdictFor, HEALTHY_SKIPS, noRunnerBugLine, plantSession, checksDecl, FixCodexCase, AGED, laneFileText, SHARED_PORT_REFUSAL, FIX_TRIPWIRES, plantHistoryShim, historyBox, plantDirectLane, plantRunningBridge, spawnBridgeListener } from './ccrc-doctorFixture.js';

// Each case's homes go when the case ends, not in a file-wide end sweep (R100, review 518's S1): that sweep overran vitest's 20 s
// hook timeout on the one file this family was split from. Registered before `installDoctorHooks()`'s root `afterEach` (the codex
// lanes' process kill) because vitest runs after-hooks in reverse order of registration: that kill still sees its home.
removeTmpFixturesEachTest();
installDoctorHooks();

// ── Plan 3a Task 4: `_check_codex`, part 1 (spec §12) ─────────────────────
// Every case runs the FULL `ccrc doctor` and reads the codex lines, and every
// case asserts no runner-bug line: a check whose return code disagrees with
// the worst line it printed is reported by `cmd_doctor` as an EXTRA FAIL,
// which a regex for the intended verdict alone would never see.
const codexVerdicts = (out: string): string[] =>
  out.split('\n').filter((l) => /^(PASS|WARN|FAIL|SKIP) codex: /.test(l));
/** The line after the first line `re` matches — its remedy, by `_dr_line`'s contract. */
const remedyAfter = (out: string, re: RegExp): string => {
  const ls = out.split('\n');
  const i = ls.findIndex((l) => re.test(l));
  return i === -1 ? '' : (ls[i + 1] ?? '');
};
/** Every file under `roots`, by bytes AND mtime, and every directory by mtime:
 *  a rewrite of identical bytes still moves an mtime, and a tmp created and
 *  removed still moves its directory's. */
function treeState(...roots: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    out[`${d}/`] = String(lstatSync(d).mtimeMs);
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else out[p] = `${st.mtimeMs}:${st.isFile() ? readFileSync(p, 'utf8') : 'not-a-file'}`;
    }
  };
  for (const r of roots) walk(r);
  return out;
}
const currentGen = (home: string): string => readlinkSync(join(home, '.ccrc', 'runtime', 'codex', 'current'));

// ── codex-bridge Stage 1, Task 9: the credential rows' fixtures ─────────
/** `s` as a RegExp source that matches it literally (a fixture path carries `.` and `-`). */
const reEsc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The credential rows are FAIL lines inside the existing `codex` check: never a WARN (a soak gate allow-lists WARNs
 *  by name), so a case's run carries no `WARN codex:` line at all. */
const expectNoCodexWarn = (out: string): void => {
  expect(out.split('\n').filter((l) => /^WARN codex: /.test(l)), out).toEqual([]);
};

/** A real status file, written by the library's own refresher against a fake token endpoint (ccrc-codex.test.ts's
 *  `refusedRefresh`): the lane's credential is planted expired, one `ensure_fresh` runs, and `word` is the state it
 *  recorded. The only spawn here that names a live fake; the doctor itself runs under CLOSED_AUTH_BASE. */
async function refreshRefusedAs(home: string, id: string, answer: AuthAnswer, word: string): Promise<void> {
  const dir = authDirOf(home, id);
  plantBackendCredential(dir, { expiresIn: -120 });
  const srv = await fakeAuthServer({ token: [answer] });
  try {
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'ensure_fresh', lane: id }] },
      { CCRC_CODEX_AUTH_BASE: srv.base });
    expect(r.timedOut, r.stderr).toBe(false);
    expect(driverLines(r.stdout)[0]?.['error'], r.stdout + r.stderr).toBe(word);
    expect(srv.requests.map((q) => q.path)).toEqual([AUTH_ROUTES.token]);
  } finally {
    await srv.close();
  }
  expect(JSON.parse(readFileSync(join(dir, 'auth.status.json'), 'utf8'))['state']).toBe(word);
}

/** A stand-in at the placed library's path (`~/.local/bin/ccgpt-auth.py`), for the two answers a real library on a
 *  non-root test box cannot give: `status` prints `report` over a present, current-looking default (or NOTHING, rc 0,
 *  when `report` is null), and `paths` answers as the library does. It is Python, run by the real interpreter through
 *  BT_PY_ARM's second arm. It differs from the shipped tree's copy, so the executables row FAILs it too. */
function plantAuthLibStandIn(home: string, report: Record<string, unknown> | null): void {
  const full = report === null ? null : {
    source: 'file', family: 'chatgpt-backend', state: 'ok', expiresAt: null, lastRefreshAt: null, lastErrorCode: null,
    lastRequestId: null, unsaved: false, updatedAt: null, credential: 'present', mode: '0600', modeOk: true,
    ownerOk: true, authBase: 'override', ...report,
  };
  writeFileSync(join(binDir(home), 'ccgpt-auth.py'), [
    'import json, sys',
    `REPORT = json.loads(${JSON.stringify(JSON.stringify(full))})`,
    'argv = sys.argv[1:]',
    'if argv[:1] == ["status"] and REPORT is not None:',
    '    print(json.dumps(REPORT))',
    'elif argv[:1] == ["paths"]:',
    '    d = argv[argv.index("--auth-dir") + 1]',
    '    print(json.dumps({"credential": d + "/auth.json", "pending": d + "/auth.pending.json",',
    '                      "lock": d + "/auth.json.lock", "status": d + "/auth.status.json", "lockWaitS": 60.0}))',
    '',
  ].join('\n'), { mode: 0o755 });
  chmodSync(join(binDir(home), 'ccgpt-auth.py'), 0o755);
}

// ── Plan 3a Task 6: `_check_codex`'s usage rows, measured in isolation ────
/** ccd/ccrc and this check file SOURCED into one shell. ccrc's dispatch is
 *  guarded by `BASH_SOURCE[0] == $0`, so sourcing runs nothing. The shell
 *  runs under this file's contained PATH, in a fixture HOME. `darwin` sets
 *  OSTYPE, from which ccrc recomputes CCD_OS at source time. A recording
 *  `systemctl` stub is planted, so a row that asked the manager anything is
 *  caught: these rows read the manager's own links and must never ask it. */
function usageRows(home: string, darwin = false, script?: string): Result & { asked: string[] } {
  stub(home, 'systemctl', 'printf \'%s\\n\' "$*" >> "$HOME/usage-rows-systemctl"; exit 97');
  // The rows RECORD through `_check_codex`'s `_dr_cx_warn` (Task 4). A bare
  // shell gives them the three arrays, and `_dr_cx_report` prints what they recorded.
  const body = script ?? [
    'DRX_CLASS=(); DRX_WHAT=(); DRX_FIX=()',
    '_dr_codex_usage_box; b=$?',
    '_dr_codex_usage codex-a; l=$?',
    'printf "rc=%s,%s\\npair=%s\\nbox-note=%s\\nnote=%s\\n" "$b" "$l" "${DR_CODEX_USAGE_PAIR:-}" "$DR_CODEX_USAGE_BOX_NOTE" "$DR_CODEX_USAGE_NOTE"',
    '_dr_cx_report "usage rows measured"; :',
  ].join('\n');
  // BOUNDED BY THE PROCESS GROUP (Plan 3a ruling F8), as `runDoctorBounded`
  // above is: `spawnSync`'s own `timeout` signals only `bash`, and a `jq`
  // blocked on a FIFO inside a `$(…)` (Step 8's W6 mutation) would outlive the
  // run. GNU `timeout -k` signals the whole group, so no reader survives the
  // census. With no usable deadline binary only the FIFO case can block, and
  // that case is skipped.
  const src = `set -uo pipefail\n. ${shq(CCRC_SRC)}\n. ${shq(CHECKS_SRC)}\n${body}`;
  const env = { ...doctorEnv(home), ...(darwin ? { OSTYPE: 'darwin23' } : {}) };
  const r = DOCTOR_DEADLINE_BIN === null
    ? spawnSync(BASH, ['-c', src], { env, encoding: 'utf8', timeout: 20_000 })
    : spawnSync(DOCTOR_DEADLINE_BIN, ['-k', '1', '20', BASH, '-c', src], { env, encoding: 'utf8' });
  const f = join(home, 'usage-rows-systemctl');
  return {
    code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '',
    asked: existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [],
  };
}

/** A fixture HOME in the shape these rows read:
 *  - the codex lane rostered, with pure-parse ports (nothing here opens a socket);
 *  - the usage pair as `ccrc install` leaves it.
 *  Each case breaks exactly one thing. */
function usageBox(prefix: string, o: Parameters<typeof plantCodexUsage>[2] = {}): string {
  const home = mkTmp(prefix);
  containedPath(home);
  stubNode(home, 'v22.20.0');
  for (const b of ['jq', 'date', 'stat']) linkReal(home, b);
  codexRoster(home, [{ id: 'codex-a', proxyPort: 45010, litellmPort: 45011 }]);
  plantCodexUsage(home, 'codex-a', o);
  return home;
}

/** Plan 3b Task A2 (D-4048): the surplus row,
 *  measured, recorded and printed alone, for `usageRows`' `script`. */
const SURPLUS_ROWS = [
  'DRX_CLASS=(); DRX_WHAT=(); DRX_FIX=()',
  's=0; _dr_codex_usage_surplus codex-a || s=$?',
  'printf "rc=%s\\nsurplus=%s\\n" "$s" "${DR_CODEX_USAGE_SURPLUS[*]-}"',
  '_dr_codex_usage_surplus_rows "$s"',
  '_dr_cx_report "surplus measured"; :',
].join('\n');
const SURPLUS_WARN = (id: string): string => `WARN codex: ccrc-codex-usage@${id}.timer is still enabled, and '${id}' is not a Codex lane in $HOME/.ccrc/accounts.json, so ccrc's usage publisher for '${id}' runs whenever the manager starts that timer: the writer of $HOME/.cc-limits/${id}.json, and of a token refresh in the authDir its lane.json names, for a lane ccrc no longer runs`;
const SURPLUS_FIX = (id: string): string => `  remedy: systemctl --user disable --now ccrc-codex-usage@${id}.timer (ccrc's own unit; no ccrc fixer withdraws it), or leave it to the next update, whose converge withdraws a ccrc usage timer whose id is no longer a Codex lane and re-measures the link`;
const UNLISTABLE_WARN = "WARN codex: ccrc's own enabled usage timers could not be listed (the wrapper shape contract could not be read), so a ccrc-codex-usage@<id>.timer left enabled for an id that is no longer a Codex lane cannot be seen — unmeasured, never none";
const UNLISTABLE_FIX = '  remedy: ccrc install — the wrapper shape contract ships with ccrc, and the install places it again';

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

/** One function out of ccd/ccrc-doctor-checks, column-0 signature to column-0 `}`. */
function checksFunction(name: string): string {
  const m = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?\\n\\}`, 'm').exec(readFileSync(CHECKS_SRC, 'utf8'));
  if (m === null) throw new Error(`ccd/ccrc-doctor-checks has no ${name}() { … } at column 0`);
  return m[0];
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

describeCodex('ccrc doctor: codex, part 1 — population, executables, runtime, authDir, ports and lane state (Plan 3a Task 4, spec §12)', () => {
  it('is in the table directly after models', () => {
    const names = tableNames();
    expect(names).toContain('codex');
    expect(names.indexOf('codex')).toBe(names.indexOf('models') + 1);
  });

  it("compares exactly GPT_LANE_BINS — the list ccrc-install.test.ts pins to _inst_bins' gate", () => {
    const m = /^CODEX_LANE_BINS=\(([^)]*)\)$/m.exec(readFileSync(CHECKS_SRC, 'utf8'));
    expect(m, 'ccrc-doctor-checks no longer declares CODEX_LANE_BINS on one line').toBeTruthy();
    expect(m![1]!.split(' ')).toEqual([...GPT_LANE_BINS]);
  });

  // ── the population ──────────────────────────────────────────────────────
  it('PASSes a healthy lane and names its ports, its state and the runtime — never the bare word ok', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-pass-');
    const { proxyPort, litellmPort } = lanePorts(home, 'codex-a');
    const r = runDoctor(home);
    // Plan 3a Task 5 widened each lane's words with its tiers (a lane is
    // lazy: none running is healthy).
    // Plan 3a Task 6: each lane's words end with its usage rows. On Linux they
    // are the timer enabled and the row's age, which moves, so this is a
    // pattern; on macOS they are the two stated not-applicables.
    const rx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const usage = IS_DARWIN ? rx('; usage timer not applicable on macOS') : '; ccrc-codex-usage@codex-a\\.timer enabled; usage row \\d+s old';
    const box = IS_DARWIN ? rx('; usage publishing not applicable on macOS — ccrc places no launchd job for it (decision 17)') : '';
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([expect.stringMatching(new RegExp(
      `^${rx(`PASS codex: 1 Codex lane(s): codex-a (ports ${proxyPort}/${litellmPort}, signed in, lane.json current, LiteLLM config current; tiers: none running (a lane is lazy)`)}`
      + `${usage}${rx(`); runtime ${currentGen(home)} litellm=1.101.0; the five GPT-lane executables match the shipped tree`)}${box}$`))]);
    noRunnerBugLine(r.stdout, 'codex');
    expect(r.code, r.stdout).toBe(0);
  });

  it('names EVERY lane in the PASS — two lanes, two entries', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-pass-two-', ['codex-a', 'codex-b']);
    const line = lineFor(runDoctor(home).stdout, 'codex');
    expect(line).toMatch(/^PASS codex: 2 Codex lane\(s\): codex-a \(ports \d+\/\d+, .*\), codex-b \(ports \d+\/\d+, .*\); runtime /);
  });

  it('CCRC_ROLE unset is NOT server: the lane is measured, not skipped', async () => {
    // healthy()'s ccrc.env records no CCRC_ROLE — the reading `cmd_update` has.
    const home = await healthyCodexBox('ccrc-doctor-codex-role-unset-');
    expect(readFileSync(join(home, '.ccrc', 'ccrc.env'), 'utf8')).not.toMatch(/CCRC_ROLE/);
    expect(lineFor(runDoctor(home).stdout, 'codex')).toMatch(/^PASS codex: 1 Codex lane/);
  });

  it('SKIPs on a box that records CCRC_ROLE=server — exactly one SKIP line, no verdict, no runner-bug line', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-role-server-');
    appendFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([
      'SKIP codex: this box records CCRC_ROLE=server, so it runs no Codex lane — a server box converges nothing per account',
    ]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('SKIPs a roster with no Codex lane — never a PASS naming no lane', () => {
    const home = healthy('ccrc-doctor-codex-none-');
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout)).toEqual([expect.stringMatching(
      /^SKIP codex: no account in \$HOME\/\.ccrc\/accounts\.json is exec\.kind "codex", and no lane state is left under /)]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('SKIPs a box with no roster file at all — absent is an answer; the wrappers check owns it', () => {
    const home = healthy('ccrc-doctor-codex-noroster-');
    rmSync(join(home, '.ccrc', 'accounts.json'), { force: true });
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout)).toEqual([expect.stringMatching(
      /^SKIP codex: no account roster at \$HOME\/\.ccrc\/accounts\.json and no lane state under .* the 'wrappers' check above owns a missing roster$/)]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('FAILs — never SKIPs — a roster that cannot be read, naming ccrc wrappers (ruling R-C6)', () => {
    const home = healthy('ccrc-doctor-codex-badroster-');
    writeRawRoster(home, '{"version":1,"accounts":');
    const r = runDoctor(home);
    const re = /^FAIL codex: \$HOME\/\.ccrc\/accounts\.json could not be read as a roster, so its Codex lanes are unknown — an unreadable roster is not an empty one$/m;
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([expect.stringMatching(re)]);
    expect(remedyAfter(r.stdout, re)).toMatch(/^ {2}remedy: run: ccrc wrappers — /);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('FAILs — never SKIPs — a box with no jq, naming jq (ruling R-C6)', () => {
    const home = healthy('ccrc-doctor-codex-nojq-');
    unstub(home, 'jq');
    const r = runDoctor(home);
    const re = /^FAIL codex: jq is not on PATH, so which roster accounts are Codex lanes cannot be told/m;
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([expect.stringMatching(re)]);
    expect(remedyAfter(r.stdout, re)).toMatch(/^ {2}remedy: install jq /);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // ── the executables and the runtime ─────────────────────────────────────
  it('FAILs a GPT-lane executable missing from ~/.local/bin, and one that drifted from the shipped tree', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-bins-');
    rmSync(join(binDir(home), 'ccrc-codex'));
    appendFileSync(join(binDir(home), 'ccgpt-usage.py'), '\n# edited on the box\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL codex: ccrc-codex missing from \$HOME\/\.local\/bin, or not executable — every Codex lane needs all five$/m);
    expect(r.stdout).toMatch(/^FAIL codex: ccgpt-usage\.py in \$HOME\/\.local\/bin differ from the shipped tree's copies in /m);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // Codex bridge Stage 1, Task 5: the auth library is the fifth GPT-lane file,
  // and the check names it on its own, never satisfied by a longer sibling.
  it('a missing ccgpt-auth.py FAILs by name', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-auth-lib-missing-');
    rmSync(join(binDir(home), 'ccgpt-auth.py'));
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(/^FAIL codex: ccgpt-auth\.py missing from \$HOME\/\.local\/bin, or not executable — every Codex lane needs all five$/m);
    expect(codexVerdicts(r.stdout).filter((l) => l.startsWith('PASS ')), 'a PASS beside the FAIL').toEqual([]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('FAILs a shipped tree that lacks one of them — the compare has no source', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-notree-');
    rmSync(join(home, 'ccrc', 'ccd', 'ccgpt-runtime'));
    expect(runDoctor(home).stdout).toMatch(/^FAIL codex: the shipped tree \(.*\/ccrc\/ccd\) has no ccgpt-runtime, /m);
  });

  // ── Plan 3b Task A5 (a): no cmp costs the byte compare, and nothing else ──
  // A file missing from ~/.local/bin, not executable, or absent from the
  // shipped tree is a fact cmp plays no part in. `_dr_cx_bins` used to return
  // on the cmp-absent WARN before its loop ever ran, so those FAILs were
  // swallowed and `_fix_codex`, which runs only on a FAIL, was unreachable.
  it('with no cmp on PATH, a GPT-lane executable missing from ~/.local/bin still FAILs by name, and only the compare is unmeasured (Plan 3b A-5)', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-nocmp-missing-');
    unstub(home, 'cmp');
    rmSync(join(binDir(home), 'ccrc-codex'));
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(/^FAIL codex: ccrc-codex missing from \$HOME\/\.local\/bin, or not executable — every Codex lane needs all five$/m);
    const re = /^WARN codex: cmp is not on PATH, so ccgpt-auth\.py, ccgpt-proxy\.py, ccgpt-usage\.py, ccgpt-runtime in \$HOME\/\.local\/bin could not be compared with the shipped tree — unmeasured, not current$/m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: install diffutils (it ships cmp), then re-run doctor');
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('with no cmp on PATH, a shipped tree that lacks one still FAILs by name (Plan 3b A-5)', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-nocmp-notree-');
    unstub(home, 'cmp');
    rmSync(join(home, 'ccrc', 'ccd', 'ccgpt-runtime'));
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(/^FAIL codex: the shipped tree \(.*\/ccrc\/ccd\) has no ccgpt-runtime, /m);
    // The tree-absent file is FAILed, not counted as uncompared: the WARN names
    // the other four only.
    expect(r.stdout, r.stdout).toMatch(/^WARN codex: cmp is not on PATH, so ccgpt-auth\.py, ccgpt-proxy\.py, ccgpt-usage\.py, ccrc-codex in \$HOME\/\.local\/bin could not be compared with the shipped tree — unmeasured, not current$/m);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('with no cmp on PATH and all five placed, the one codex verdict is the WARN naming all five — never a PASS claiming they match (Plan 3b A-5)', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-nocmp-all-');
    unstub(home, 'cmp');
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([
      'WARN codex: cmp is not on PATH, so ccgpt-auth.py, ccgpt-proxy.py, ccgpt-usage.py, ccgpt-runtime, ccrc-codex in $HOME/.local/bin could not be compared with the shipped tree — unmeasured, not current',
    ]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  const restamp = (home: string, patch: Record<string, string>): void => {
    const rt = plantFakeRuntime(home);
    writeFileSync(rt.stamp, `${JSON.stringify({ ...JSON.parse(readFileSync(rt.stamp, 'utf8')), ...patch })}\n`);
  };
  it.each([
    ['absent', (h: string) => rmSync(join(h, '.ccrc', 'runtime'), { recursive: true, force: true }),
      /no isolated LiteLLM runtime is current on this box \(ccgpt-runtime check: absent\)/, /ccgpt-runtime build/],
    ['requirement-moved', (h: string) => restamp(h, { requirement: 'litellm[proxy]>=0.0.1,<0.0.2' }),
      /built for another LiteLLM requirement than this ccrc declares \(ccgpt-runtime check: requirement-moved\)/, /ccgpt-runtime build/],
    // The probe's bytes and the patch's are one hash, so the sentence names both causes.
    ['probe-moved', (h: string) => restamp(h, { probeSha256: '0'.repeat(64) }),
      /passed an older behaviour probe, or carries an older ccrc LiteLLM patch, than the one this ccrc ships \(ccgpt-runtime check: probe-moved\)/,
      /^ {2}remedy: rebuild it: ccgpt-runtime build — it re-runs the shipped probe against a fresh, freshly patched generation$/],
    ['mutated', (h: string) => { plantFakeRuntime(h, { stamp: false }); },
      /is no longer what its build made \(ccgpt-runtime check: mutated\): its interpreter, its stamp, its installed LiteLLM or its ccrc LiteLLM patch changed after the build/,
      /ccgpt-runtime build/],
  ] as const)('FAILs a runtime that `ccgpt-runtime check` answers %s, in its own sentence, with a rebuild remedy', async (word, plant, said, remedy) => {
    const home = await healthyCodexBox(`ccrc-doctor-codex-rt-${word}-`);
    plant(home);
    const r = runDoctor(home);
    const re = new RegExp(`^FAIL codex: .*${said.source}`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toMatch(remedy);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('FAILs a runtime whose installed ccrc LiteLLM patch was deleted after the build as mutated, though its stamp still matches', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-rt-patch-gone-');
    const rt = plantFakeRuntime(home);
    rmSync(join(rt.site, 'ccrc_litellm_patch.py'));
    const r = runDoctor(home);
    const re = /^FAIL codex: the current runtime generation is no longer what its build made \(ccgpt-runtime check: mutated\)/m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toMatch(/ccgpt-runtime build/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // ── authDir and its credential: the auth library's status and the file's mode (codex-bridge Stage 1, Task 9) ──
  it('FAILs an authDir that does not exist, and one that is not a directory', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-auth-absent-');
    const dir = authDirOf(home, 'codex-a');
    rmSync(dir, { recursive: true, force: true });
    const gone = runDoctor(home);
    const re = /^FAIL codex: codex-a's authDir ~\/\.local\/share\/ccrc\/codex\/codex-a does not exist/m;
    expect(gone.stdout).toMatch(re);
    expect(remedyAfter(gone.stdout, re)).toMatch(/ccrc codex login codex-a/);
    writeFileSync(dir, 'not a directory\n');
    expect(runDoctor(home).stdout).toMatch(/^FAIL codex: codex-a's authDir ~\/\S+ is not a directory this user can list and search/m);
  });

  it('FAILs an authDir with no auth.json in the words `ccrc codex start` refuses with', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-auth-nologin-');
    const cred = join(authDirOf(home, 'codex-a'), 'auth.json');
    rmSync(cred);
    const r = runDoctor(home);
    // start's own words (`_codex_cmd_start`'s not-logged-in): the library reads the credential, so the sentence says
    // which word it read, and no longer that existence is all ccrc checks.
    const re = /^FAIL codex: codex-a is not signed in: the auth library reads its credential in ~\/\S+ as absent, so 'ccrc codex start codex-a' refuses$/m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: sign the lane in: ccrc codex login codex-a');
    expect(r.stdout).not.toContain('existence is all ccrc checks');
    // The marker an abandoned LiteLLM device flow leaves reads `incomplete`: not signed in, the same remedy.
    writeFileSync(cred, JSON.stringify({ device_code_requested_at: 1 }), { mode: 0o600 });
    const m = runDoctor(home);
    const rm = /^FAIL codex: codex-a is not signed in: the auth library reads its credential in ~\/\S+ as incomplete, so 'ccrc codex start codex-a' refuses$/m;
    expect(m.stdout, m.stdout).toMatch(rm);
    expect(remedyAfter(m.stdout, rm)).toBe('  remedy: sign the lane in: ccrc codex login codex-a');
    expectNoCodexWarn(m.stdout);
  });

  // Root reads a 0000 file anyway, so the discriminator proves nothing there — a
  // visible skip, not a false green.
  it.skipIf(PY === null || (typeof process.getuid === 'function' && process.getuid() === 0))(
    'FAILs a 0000-mode and a 0644-mode auth.json, naming chmod 600 and the credential\'s path', async () => {
      const home = await healthyCodexBox('ccrc-doctor-codex-auth-mode-');
      const cred = join(authDirOf(home, 'codex-a'), 'auth.json');
      for (const [mode, word] of [[0o000, '0000'], [0o644, '0644']] as const) {
        chmodSync(cred, mode);
        const r = runDoctor(home);
        const re = new RegExp(`^FAIL codex: codex-a's credential ${reEsc(cred)} has mode ${word}, `, 'm');
        expect(r.stdout, `${word}: ${r.stdout}`).toMatch(re);
        expect(remedyAfter(r.stdout, re), word).toBe(`  remedy: chmod 600 ${cred}`);
        // THE ONLY CREDENTIAL LINE: a 0000 file also reads `unreadable` (the library's open is refused), and the
        // move-it-aside remedy would discard a credential the chmod cures.
        expect(r.stdout, `${word}: a move-it-aside line beside the mode line`).not.toContain('move it aside');
        expect(r.stdout, word).not.toMatch(/^FAIL codex: codex-a is not signed in/m);
        expectNoCodexWarn(r.stdout);
      }
      chmodSync(cred, 0o600);
    });

  it('FAILs needs-signin', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-auth-needs-signin-');
    await refreshRefusedAs(home, 'codex-a', { status: 400, body: { error: 'invalid_grant' } }, 'needs-signin');
    const r = runDoctor(home);
    const re = /^FAIL codex: the token endpoint refused codex-a's refresh token \(the auth library's status reads needs-signin\), so 'ccrc codex start codex-a' refuses and its tier can serve no request$/m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: sign the lane in again: ccrc codex login codex-a');
    expect(lineFor(r.stdout, 'codex')).toMatch(/^FAIL codex: /);
    expectNoCodexWarn(r.stdout);
  });

  it('FAILs a foreign-family credential', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-auth-foreign-');
    const cred = join(authDirOf(home, 'codex-a'), 'auth.json');
    // The Codex CLI's own file at the backend path: another program's, never written over.
    const bytes = JSON.stringify({ OPENAI_API_KEY: null, tokens: { id_token: 'x', access_token: 'y', refresh_token: 'z' } });
    writeFileSync(cred, bytes, { mode: 0o600 });
    const before = statSync(cred, { bigint: true });
    const r = runDoctor(home);
    const re = new RegExp(`^FAIL codex: the auth library reads codex-a's credential ${reEsc(cred)} as foreign-family, so 'ccrc codex start codex-a' refuses it and ccrc never writes over it$`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: move it aside, then ccrc codex login codex-a');
    expect(readFileSync(cred, 'utf8')).toBe(bytes);
    const after = statSync(cred, { bigint: true });
    expect([after.ino, after.mtimeNs, after.mode]).toEqual([before.ino, before.mtimeNs, before.mode]);
    expect(r.stdout).not.toContain('chmod 600');
    // A torn file is `unreadable`: the same arm, the same remedy.
    writeFileSync(cred, '{"access_token": ', { mode: 0o600 });
    const t = runDoctor(home);
    const rt = new RegExp(`^FAIL codex: the auth library reads codex-a's credential ${reEsc(cred)} as unreadable, `, 'm');
    expect(t.stdout, t.stdout).toMatch(rt);
    expect(remedyAfter(t.stdout, rt)).toBe('  remedy: move it aside, then ccrc codex login codex-a');
    expectNoCodexWarn(t.stdout);
  });

  it('FAILs config-error naming ccrc update then ccrc codex login', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-auth-config-error-');
    await refreshRefusedAs(home, 'codex-a', { status: 401, body: { error: 'invalid_client' } }, 'config-error');
    const r = runDoctor(home);
    const re = /^FAIL codex: the token endpoint refused the client this ccrc signs codex-a in with \(the auth library's status reads config-error\), so 'ccrc codex start codex-a' refuses$/m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: run \'ccrc update\' first, then \'ccrc codex login codex-a\' if the lane is still refused');
    expectNoCodexWarn(r.stdout);
  });

  it('FAILs auth-library-absent', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-auth-lib-absent-');
    rmSync(join(binDir(home), 'ccgpt-auth.py'));
    const r = runDoctor(home);
    const re = /^FAIL codex: the auth library or python3 is missing \(auth-library-absent\), so whether codex-a is signed in cannot be told$/m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: run \'ccrc update\', which places the library, then re-run doctor');
    expect(r.stdout).not.toMatch(/^FAIL codex: codex-a is not signed in/m);
    expectNoCodexWarn(r.stdout);
  });

  it('FAILs a credential this user does not own', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-auth-owner-');
    const cred = join(authDirOf(home, 'codex-a'), 'auth.json');
    // A non-root test cannot chown a file, so a stand-in at the placed library's path answers `status` with a canned
    // report (`ownerOk: false`) and `paths` as the library does; the python3 stub hands it to the real interpreter.
    plantAuthLibStandIn(home, { credential: 'present', state: 'ok', mode: '0600', modeOk: true, ownerOk: false });
    const r = runDoctor(home);
    const re = new RegExp(`^FAIL codex: codex-a's credential ${reEsc(cred)} is not owned by this user, `, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe(`  remedy: make this user its owner (chown, as root), then chmod 600 ${cred}`);
    expect(r.stdout).not.toMatch(/^FAIL codex: .*has mode /m);
    expectNoCodexWarn(r.stdout);
  });

  it('FAILs a credential neither owned by this user nor at mode 0600 on the owner line, with no bare chmod line', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-auth-owner-mode-');
    const cred = join(authDirOf(home, 'codex-a'), 'auth.json');
    // A non-owner cannot chmod the file (EPERM), so the owner line, whose remedy ends in the chmod, is the one line.
    plantAuthLibStandIn(home, { credential: 'present', state: 'ok', mode: '0644', modeOk: false, ownerOk: false });
    const r = runDoctor(home);
    const re = new RegExp(`^FAIL codex: codex-a's credential ${reEsc(cred)} is not owned by this user, `, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe(`  remedy: make this user its owner (chown, as root), then chmod 600 ${cred}`);
    expect(r.stdout).not.toMatch(/^FAIL codex: .*has mode /m);
    expect(r.stdout).not.toMatch(/^ {2}remedy: chmod 600 /m);
    expectNoCodexWarn(r.stdout);
  });

  it('FAILs an empty status answer: auth-status-unreadable', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-auth-status-empty-');
    plantAuthLibStandIn(home, null);
    const r = runDoctor(home);
    const re = /^FAIL codex: the auth library answered no status ccrc can read for codex-a \(auth-status-unreadable\), so whether it is signed in cannot be told$/m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: run \'ccrc update\', which places the library again, then re-run doctor');
    expect(r.stdout).not.toMatch(/^FAIL codex: codex-a is not signed in/m);
    expectNoCodexWarn(r.stdout);
  });

  it('PASS still reads signed in, for a present credential whether or not its token expired', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-auth-pass-');
    const pass = /^PASS codex: 1 Codex lane\(s\): codex-a \(ports \d+\/\d+, signed in, /;
    expect(lineFor(runDoctor(home).stdout, 'codex')).toMatch(pass);
    // Expired, with no status file: the computed status reads `ok`, and only the tier refreshes (litellm mode).
    plantBackendCredential(authDirOf(home, 'codex-a'), { expiresIn: -120 });
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'codex'), r.stdout).toMatch(pass);
    expect(existsSync(join(authDirOf(home, 'codex-a'), 'auth.status.json')), 'the doctor wrote a status').toBe(false);
  });

  it('no new WARN line and no new check name', async () => {
    // Three lanes, three credential arms at once: absent, foreign-family and a 0644 mode.
    const home = await healthyCodexBox('ccrc-doctor-codex-auth-census-', ['codex-a', 'codex-b', 'codex-c']);
    rmSync(join(authDirOf(home, 'codex-a'), 'auth.json'));
    writeFileSync(join(authDirOf(home, 'codex-b'), 'auth.json'), JSON.stringify({ family: 'siwc' }), { mode: 0o600 });
    chmodSync(join(authDirOf(home, 'codex-c'), 'auth.json'), 0o644);
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(/^FAIL codex: codex-a is not signed in/m);
    expect(r.stdout, r.stdout).toMatch(/^FAIL codex: the auth library reads codex-b's credential \S+ as foreign-family/m);
    expect(r.stdout, r.stdout).toMatch(/^FAIL codex: codex-c's credential \S+ has mode 0644/m);
    expectNoCodexWarn(r.stdout);
    const names = new Set(tableNames());
    const seen = r.stdout.split('\n').map((l) => /^(PASS|WARN|FAIL|SKIP) (\S+): /.exec(l)?.[2]).filter((n): n is string => n !== undefined);
    expect(seen.filter((n) => !names.has(n)), 'a verdict line names a check the table does not').toEqual([]);
  });

  it('a check table sourced without ccrc names the missing _codex_auth_status', () => {
    const r = usageRows(usageBox('ccrc-doctor-codex-auth-guard-'), false, 'unset -f _codex_auth_status\n_check_codex; echo "rc=$?"');
    expect(r.stdout.split('\n').filter((l) => /^(PASS|WARN|FAIL|SKIP) codex: /.test(l)), r.stdout).toEqual([
      'FAIL codex: ccrc\'s own Codex lane library is not loaded (_codex_auth_status, BOX_TREE_DIR or CODEX_TIERS is missing), so no lane on this box was measured']);
    expect(r.stdout).toMatch(/^rc=1$/m);
  });

  // D-6559: `modeOk`/`ownerOk` null (nothing there, or not a regular file) is not false. A symlink's lstat reads 0777,
  // and a `chmod 600` through it would change its TARGET.
  it('a symlink at auth.json FAILs move it aside, prints no chmod line, and leaves its target untouched', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-auth-symlink-');
    const cred = join(authDirOf(home, 'codex-a'), 'auth.json');
    const target = join(home, 'elsewhere', 'target.json');
    mkdirSync(path.dirname(target), { recursive: true });
    plantBackendCredential(path.dirname(target), { mode: 0o644 });
    renameSync(join(path.dirname(target), 'auth.json'), target);
    const bytes = readFileSync(target, 'utf8');
    const before = statSync(target, { bigint: true });
    rmSync(cred);
    symlinkSync(target, cred);
    const r = runDoctor(home);
    const re = new RegExp(`^FAIL codex: the auth library reads codex-a's credential ${reEsc(cred)} as unreadable, `, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: move it aside, then ccrc codex login codex-a');
    expect(r.stdout, 'a chmod remedy for a symlink').not.toContain('chmod 600');
    expect(r.stdout).not.toMatch(/has mode /);
    expect(lstatSync(cred).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(bytes);
    const after = statSync(target, { bigint: true });
    expect([after.ino, after.mtimeNs, after.mode]).toEqual([before.ino, before.mtimeNs, before.mode]);
    expectNoCodexWarn(r.stdout);
  });

  it.skipIf(PY === null || (typeof process.getuid === 'function' && process.getuid() === 0))(
    'FAILs an authDir this user cannot search', async () => {
      const home = await healthyCodexBox('ccrc-doctor-codex-auth-000dir-');
      const dir = authDirOf(home, 'codex-a');
      chmodSync(dir, 0o000);
      try {
        expect(runDoctor(home).stdout).toMatch(/^FAIL codex: codex-a's authDir ~\/\S+ is not a directory this user can list and search/m);
      } finally {
        chmodSync(dir, 0o700);
      }
    });

  // ── the roster row: ports ───────────────────────────────────────────────
  it('FAILs a hand-edited row whose port is not a port, in the row reader\'s own words', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-port-bad-');
    editRosterRow(home, 'codex-a', (row) => { row['exec'].proxyPort = 70000; });
    const r = runDoctor(home);
    const re = /^FAIL codex: codex-a's codex row cannot be used \(roster-invalid: .*exec\.proxyPort\/exec\.litellmPort.*\), and until it is fixed no Codex lane's model state can be read/m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toMatch(/ccrc never chooses a lane's ports or paths for you$/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('FAILs two lanes that share a port — belt and braces behind the roster refusal', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-port-collide-', ['codex-a', 'codex-b']);
    const shared = lanePorts(home, 'codex-a').proxyPort;
    editRosterRow(home, 'codex-b', (row) => { row['exec'].litellmPort = shared; });
    const r = runDoctor(home);
    const re = new RegExp(`^FAIL codex: codex-a and codex-b both use port ${shared}, `, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toMatch(/ccrc never chooses a port$/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // ── lane.json ───────────────────────────────────────────────────────────
  it('FAILs an absent lane.json, and one the roster row has moved away from', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-lanejson-');
    const lane = join(home, '.ccrc', 'codex', 'codex-a', 'lane.json');
    const text = readFileSync(lane, 'utf8');
    rmSync(lane);
    expect(runDoctor(home).stdout).toMatch(/^FAIL codex: codex-a has no lane\.json \(/m);
    writeFileSync(lane, text);
    // The roster moves the lane's authDir; lane.json still names the old one.
    editRosterRow(home, 'codex-a', (row) => { row['exec'].authDir = '.local/share/ccrc/codex/codex-a-moved'; });
    plantLaneAuth(home, 'codex-a');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL codex: codex-a's lane\.json disagrees with its roster row /m);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('FAILs a lane.json gone stale against the REGISTRY (ruling R7) — and measuring it wrote nothing', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-lanejson-registry-');
    // The operator's haiku moves by hand; nothing re-rendered lane.json.
    writeLaneModels(home, 'codex-a', { classes: { haiku: 'gpt-x-mini', sonnet: 'gpt-x', opus: null, fable: null } });
    const roots = [join(home, '.ccrc', 'codex'), join(home, '.ccrc', 'models'), join(home, '.claude-codex-a')];
    const before = treeState(...roots);
    const r = runDoctor(home);
    const re = /^FAIL codex: codex-a's lane\.json is stale against its class registry: /m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toMatch(/re-render it: ccrc models codex-a set-subagent sonnet /);
    expect(treeState(...roots)).toEqual(before);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // ── the class registry, through models-op ───────────────────────────────
  it('FAILs a Codex lane with no class registry, and one whose registry is another probe\'s', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-registry-');
    rmSync(join(home, '.ccrc', 'models', 'codex-a.classes.json'));
    const none = runDoctor(home);
    const re = /^FAIL codex: codex-a is a Codex lane with no class registry, /m;
    expect(none.stdout).toMatch(re);
    expect(remedyAfter(none.stdout, re)).toBe('  remedy: create it: ccrc models codex-a init codex, then ccrc models refresh codex-a');
    writeLaneModels(home, 'codex-a', {
      probe: 'openrouter', classes: { haiku: null, sonnet: null, opus: null, fable: null }, discovery: [],
    });
    expect(runDoctor(home).stdout).toMatch(/^FAIL codex: codex-a is a Codex lane whose class registry declares probe "openrouter": /m);
  });

  // Plan 3a final fix wave, MF-2 (F2, D-2380's class): `_dr_cx_lane` reads the
  // lane's model state through models-op's `show`, which opened the catalogue
  // BY NAME. A FIFO there blocked inside that read, and `cmd_doctor` wraps no
  // deadline, so the whole doctor hung. Models-op now type-tests every lane
  // file first, so the FIFO is the read's own `catalogue-unreadable` refusal.
  // Bounded by the process group (`runDoctorBounded`, ruling F8), so a
  // regression is a readable red and no blocked `node` outlives the run.
  it.skipIf(DOCTOR_DEADLINE_BIN === null)(
    'a FIFO at the lane\'s catalogue is a prompt FAIL naming catalogue-unreadable — never a hang', async () => {
      const home = await healthyCodexBox('ccrc-doctor-codex-catalogue-fifo-');
      const cat = join(home, '.ccrc', 'models', 'codex-a.json');
      rmSync(cat);
      execFileSync('mkfifo', [cat]);
      const r = runDoctorBounded(home, 60_000);
      expect(r.stdout, r.stdout).toMatch(/^FAIL codex: codex-a: 'ccrc models' refused to read the lane's model state — catalogue-unreadable: .*not a regular file/m);
      noRunnerBugLine(r.stdout, 'codex');
    }, 90_000);   // above runDoctorBounded's own 60 s deadline, so that deadline is what reds

  it('WARNs a lane that routes haiku to nothing, and one whose probe model left the catalogue', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-haiku-', ['codex-a', 'codex-b']);
    writeLaneModels(home, 'codex-a', { classes: { haiku: null, sonnet: 'gpt-x', opus: null, fable: null } });
    renderLane(home, 'codex-a');
    writeLaneModels(home, 'codex-b', { models: ['gpt-x', 'gpt-x-mini'] });
    renderLane(home, 'codex-b');
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([
      expect.stringMatching(/^WARN codex: codex-a routes haiku to nothing, so its lane\.json carries no probe model /),
      expect.stringMatching(/^WARN codex: codex-b's usage probe model, probe-model \(its haiku class\), is absent from the lane's current catalogue/),
    ]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // ── the rendered LiteLLM config ─────────────────────────────────────────
  it('FAILs a stale LiteLLM config, an absent one, and a lane never probed — and measuring wrote nothing', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-litellm-');
    const yaml = join(home, '.ccrc', 'codex', 'codex-a', 'litellm.yaml');
    appendFileSync(yaml, '# edited on the box\n');
    const edited = readFileSync(yaml, 'utf8');
    const stale = runDoctor(home);
    const re = /^FAIL codex: codex-a's LiteLLM config \(.*litellm\.yaml\) is stale against the lane's catalogue: /m;
    expect(stale.stdout, stale.stdout).toMatch(re);
    expect(remedyAfter(stale.stdout, re)).toMatch(/re-render it: ccrc models litellm codex-a /);
    expect(readFileSync(yaml, 'utf8')).toBe(edited);
    rmSync(yaml);
    expect(runDoctor(home).stdout).toMatch(/^FAIL codex: codex-a has no rendered LiteLLM config \(/m);
    expect(existsSync(yaml)).toBe(false);
    rmSync(join(home, '.ccrc', 'models', 'codex-a.json'));
    const never = runDoctor(home);
    expect(never.stdout).toMatch(/^FAIL codex: codex-a has never been probed, /m);
    expect(remedyAfter(never.stdout, /^FAIL codex: codex-a has never been probed/m)).toBe('  remedy: probe it: ccrc models refresh codex-a');
  });

  // ── lane state left behind ──────────────────────────────────────────────
  it('WARNs lane state left for an id that is no longer a Codex lane — a flip back keeps it — and never deletes it', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-flipback-', ['codex-a', 'codex-b']);
    const keep = lanePorts(home, 'codex-a');
    codexRoster(home, [{ id: 'codex-a', ...keep }], [{
      id: 'codex-b', label: 'codex-b', configDirSuffix: '.claude-codex-b',
      exec: { kind: 'external' }, homeAble: false, telemetry: 'codex',
    }], { accountsSh: false });
    // Plan 3b Task A2: this is the state AFTER the converge a flip back runs, which
    // withdraws codex-b's usage timer, so its link goes as a manager's disable
    // removes it. The timer left enabled is the next case's subject.
    rmSync(join(home, '.config', 'systemd', 'user', 'timers.target.wants', 'ccrc-codex-usage@codex-b.timer'));
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([expect.stringMatching(
      /^WARN codex: lane state is left under \S+\/\.ccrc\/codex\/codex-b, and 'codex-b' is not a Codex lane in /)]);
    expect(existsSync(join(home, '.ccrc', 'codex', 'codex-b', 'lane.json'))).toBe(true);
    noRunnerBugLine(r.stdout, 'codex');
  });

  itLinux('a flip back whose usage timer is still enabled: the left-state WARN no longer says nothing of ccrc\'s reads it, and the timer is its own WARN (Plan 3b Task A2)', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-flipback-timer-', ['codex-a', 'codex-b']);
    const keep = lanePorts(home, 'codex-a');
    codexRoster(home, [{ id: 'codex-a', ...keep }], [{
      id: 'codex-b', label: 'codex-b', configDirSuffix: '.claude-codex-b',
      exec: { kind: 'external' }, homeAble: false, telemetry: 'codex',
    }], { accountsSh: false });
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([
      expect.stringMatching(/^WARN codex: lane state is left under \S+\/\.ccrc\/codex\/codex-b, and 'codex-b' is not a Codex lane in \$HOME\/\.ccrc\/accounts\.json — a flip back to another launcher keeps it on purpose, and ccrc's own ccrc-codex-usage@codex-b\.timer still reads it \(the WARN naming that timer says how to withdraw it\)$/),
      SURPLUS_WARN('codex-b'),
    ]);
    expect(remedyAfter(r.stdout, /^WARN codex: ccrc-codex-usage@codex-b\.timer is still enabled/)).toBe(SURPLUS_FIX('codex-b'));
    noRunnerBugLine(r.stdout, 'codex');
  });

  itLinux('lane state left behind while the usage-timer set cannot be listed: the left-state WARN says whether ccrc\'s timer reads it is unmeasured — never "nothing of ccrc\'s reads it" (Plan 3b Task A2, fix round 1)', () => {
    const home = healthy('ccrc-doctor-codex-leftstate-unlistable-');
    mkdirSync(join(home, '.ccrc', 'codex', 'ext-a'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'codex', 'ext-a', 'lane.json'), '{}\n');
    rmSync(join(home, 'ccrc', 'ccd', 'ccrc-wrapper-shape'), { force: true });
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([
      expect.stringMatching(/^WARN codex: lane state is left under \S+\/ext-a, and 'ext-a' is not a Codex lane in \$HOME\/\.ccrc\/accounts\.json — a flip back to another launcher keeps it on purpose, and whether ccrc's own usage timer still reads it is unmeasured \(the WARN on ccrc's enabled usage timers says why\)$/),
      UNLISTABLE_WARN,
    ]);
    expect(r.stdout, 'an unmeasured set was read as none').not.toMatch(/nothing of ccrc's reads it/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  itLinux('a ccrc usage timer left enabled with no Codex lane and no lane state at all is a WARN — never the empty-population SKIP (Plan 3b Task A2)', () => {
    const home = healthy('ccrc-doctor-codex-surplus-only-');
    plantCodexUsage(home, 'ext-a', { pair: false, row: false });   // a dangling link still reads enabled (D-3726)
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([SURPLUS_WARN('ext-a')]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  itLinux('a box whose usage-timer set cannot be listed is a WARN, unmeasured — never the empty-population SKIP (Plan 3b Task A2)', () => {
    const home = healthy('ccrc-doctor-codex-surplus-unlistable-');
    rmSync(join(home, 'ccrc', 'ccd', 'ccrc-wrapper-shape'), { force: true });
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([UNLISTABLE_WARN]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('left lane state is a subject even with no Codex lane at all — a WARN, never the empty-population SKIP', () => {
    const home = healthy('ccrc-doctor-codex-leftonly-');
    mkdirSync(join(home, '.ccrc', 'codex', 'ext-a'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'codex', 'ext-a', 'lane.json'), '{}\n');
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: lane state is left under \S+\/ext-a, /)]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // ── Plan 3b Task A5 (b): a lane-state root that cannot be listed ─────────
  // `for d in "$root"/*/` matches nothing on a mode-000 directory, a regular
  // file or a dangling link (measured), so each of them used to fold into the
  // empty-population SKIP. `_check_pools`' `pools-unlistable` class, worded as
  // a WARN by ruling A-5. An ABSENT root still SKIPs: the two SKIP cases above
  // are this pair's control.
  it.skipIf(process.getuid?.() === 0)(
    'an unlistable ~/.ccrc/codex is unmeasured — a WARN, never the empty-population SKIP (Plan 3b A-5)', () => {
      // Skipped as root: root lists any directory, so the fixture cannot be built.
      const home = healthy('ccrc-doctor-codex-root-unlistable-');
      const root = join(home, '.ccrc', 'codex');
      mkdirSync(join(root, 'ext-a'), { recursive: true });
      writeFileSync(join(root, 'ext-a', 'lane.json'), '{}\n');
      chmodSync(root, 0o000);
      try {
        const r = runDoctor(home);
        const re = /^WARN codex: \S+\/\.ccrc\/codex exists and cannot be listed \(it is not a directory this user can read and search\), so whether any Codex lane state is left under it was not measured — unmeasured, never read as no lane state$/m;
        expect(codexVerdicts(r.stdout), r.stdout).toEqual([expect.stringMatching(re)]);
        expect(remedyAfter(r.stdout, re)).toMatch(/^ {2}remedy: make it a directory this user can list again \(ccrc creates it with mode 0700: chmod 700 \S+\/\.ccrc\/codex\), /);
        noRunnerBugLine(r.stdout, 'codex');
      } finally {
        chmodSync(root, 0o700);   // mkTmp's cleanup cannot empty a mode-000 directory
      }
    });

  it('a regular file where ~/.ccrc/codex belongs is unmeasured too — a WARN, never the SKIP, at any uid (Plan 3b A-5)', () => {
    const home = healthy('ccrc-doctor-codex-root-file-');
    writeFileSync(join(home, '.ccrc', 'codex'), 'not a directory\n');
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([expect.stringMatching(
      /^WARN codex: \S+\/\.ccrc\/codex exists and cannot be listed \(it is not a directory this user can read and search\), /)]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // One case per conjunct of `_check_codex`'s unlistable-root predicate
  // (`-e || -L`, `! -d`, `! -r`, `! -x`): each fixture fails exactly ONE of
  // them, so deleting that conjunct alone turns the WARN into the SKIP. The
  // two cases above cannot bind them: a mode-000 directory fails `-r` AND `-x`,
  // and a 0644 file fails `-d` AND `-x`.
  const UNLISTABLE_ROOT_WARN = /^WARN codex: \S+\/\.ccrc\/codex exists and cannot be listed \(it is not a directory this user can read and search\), /;
  it('a dangling symlink where ~/.ccrc/codex belongs is unmeasured — a WARN, never read as an absent root (Plan 3b A-5)', () => {
    // `-e` follows the link and says no; only `-L` says it is there.
    const home = healthy('ccrc-doctor-codex-root-dangling-');
    symlinkSync(join(home, 'nowhere'), join(home, '.ccrc', 'codex'));
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([expect.stringMatching(UNLISTABLE_ROOT_WARN)]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('a regular file with every mode bit a directory needs is still unmeasured — it fails `-d` alone (Plan 3b A-5)', () => {
    const home = healthy('ccrc-doctor-codex-root-file755-');
    const root = join(home, '.ccrc', 'codex');
    writeFileSync(root, 'not a directory\n');
    chmodSync(root, 0o755);
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([expect.stringMatching(UNLISTABLE_ROOT_WARN)]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // Skipped as root, who reads and searches any directory: the fixture cannot be built.
  const unlistableDirOfMode = (prefix: string, mode: number): void => {
    const home = healthy(prefix);
    const root = join(home, '.ccrc', 'codex');
    mkdirSync(join(root, 'ext-a'), { recursive: true });
    writeFileSync(join(root, 'ext-a', 'lane.json'), '{}\n');
    chmodSync(root, mode);
    try {
      const r = runDoctor(home);
      expect(codexVerdicts(r.stdout), r.stdout).toEqual([expect.stringMatching(UNLISTABLE_ROOT_WARN)]);
      noRunnerBugLine(r.stdout, 'codex');
    } finally {
      chmodSync(root, 0o700);   // mkTmp's cleanup cannot empty a directory it cannot search
    }
  };
  it.skipIf(process.getuid?.() === 0)(
    'a ~/.ccrc/codex directory this user can search but not read (mode 0300) is unmeasured — it fails `-r` alone (Plan 3b A-5)',
    () => unlistableDirOfMode('ccrc-doctor-codex-root-mode0300-', 0o300));
  it.skipIf(process.getuid?.() === 0)(
    'a ~/.ccrc/codex directory this user can read but not search (mode 0600) is unmeasured — it fails `-x` alone (Plan 3b A-5)',
    () => unlistableDirOfMode('ccrc-doctor-codex-root-mode0600-', 0o600));

  // ── the worst class ─────────────────────────────────────────────────────
  it('one lane FAILing and another WARNing: FAIL lines, then WARN lines, each with its own remedy, and the check returns the worst', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-worst-', ['codex-a', 'codex-b']);
    rmSync(join(authDirOf(home, 'codex-a'), 'auth.json'));
    writeLaneModels(home, 'codex-b', { classes: { haiku: null, sonnet: 'gpt-x', opus: null, fable: null } });
    renderLane(home, 'codex-b');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const at = (re: RegExp): number => lines.findIndex((l) => re.test(l));
    const f = at(/^FAIL codex: codex-a is not signed in: /);
    const w = at(/^WARN codex: codex-b routes haiku to nothing/);
    expect(f, r.stdout).toBeGreaterThan(-1);
    expect(w).toBeGreaterThan(f);
    expect(lines[f + 1]).toMatch(/^ {2}remedy: \S/);
    expect(lines[w + 1]).toMatch(/^ {2}remedy: \S/);
    noRunnerBugLine(r.stdout, 'codex');
    expect(r.code).toBe(1);
  });
});


// ── Plan 3a Task 5: `_check_codex`, part 2 — the tier rows (spec §12) ─────
// Listeners are PYTHON children (`spawnListener`), because `runDoctor` blocks
// this process's event loop: an in-process server can never ANSWER — which is
// exactly what the bounded-probe case below wants, and nothing else does.
describeCodex('ccrc doctor: codex, part 2 — tier identity, half-up lanes, stale code and a down gateway (Plan 3a Task 5, spec §12)', () => {
  const at = (home: string, tier: 'shim' | 'litellm', answer: ListenerAnswer, lane = 'codex-a', argv: readonly string[] = []): Promise<Listener> => {
    const { proxyPort, litellmPort } = lanePorts(home, 'codex-a');
    return spawnListener(home, { answer, lane, port: tier === 'shim' ? proxyPort : litellmPort, argv });
  };
  it('a listener on the shim port answering as ANOTHER lane FAILs in _codex_foreign_what\'s words, and is left running', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-other-lane-');
    const port = lanePorts(home, 'codex-a').proxyPort;
    await at(home, 'shim', 'json', 'codex-b');
    const r = runDoctor(home);
    const re = new RegExp(`^FAIL codex: codex-a: port ${port} \\(codex-a's shim tier\\) is held by a listener that is not this lane's: it answers as another lane — ccrc neither adopts nor stops what it cannot identify$`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe(`  remedy: Stop whatever holds port ${port}, or give codex-a other ports in ~/.ccrc/accounts.json.`);
    noRunnerBugLine(r.stdout, 'codex');
    // Named, and left running: nothing in doctor signals anything. The PORT is
    // the pin, never `alive()`: a killed child of this process stays a zombie
    // that `kill -0` reads as alive, while its port refuses once it dies.
    expect(await portAccepts(port)).toBe(true);
  });

  it('a listener answering with NO id — the other repository\'s shim shape, or anything on the LiteLLM port — FAILs as unidentified', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-no-id-');
    const { proxyPort, litellmPort } = lanePorts(home, 'codex-a');
    await at(home, 'shim', 'text');
    await at(home, 'litellm', '404');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(new RegExp(`^FAIL codex: codex-a: port ${proxyPort} \\(codex-a's shim tier\\) is held by a listener that is not this lane's: its identity check failed`, 'm'));
    expect(r.stdout).toMatch(new RegExp(`^FAIL codex: codex-a: port ${litellmPort} \\(codex-a's litellm tier\\) is held by a listener that is not this lane's: its identity check failed`, 'm'));
    noRunnerBugLine(r.stdout, 'codex');
  });

  // `listener-other-process` is the one foreign 2 that IS this lane's own
  // process (`_codex_tier_is_our_handle`): its sentence names the pid it
  // proved, so it never carries the "cannot identify" tail. LiteLLM's
  // identity is /proc on Linux, as in the half-up case below.
  itLinux('this lane\'s own LiteLLM while another process holds its port FAILs in _codex_foreign_what\'s words alone — never "cannot identify"', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-other-proc-');
    const port = lanePorts(home, 'codex-a').litellmPort;
    const yaml = join(home, '.ccrc', 'codex', 'codex-a', 'litellm.yaml');
    // This lane's LiteLLM by its command line, on a kernel-chosen port…
    const mine = await spawnListener(home, { answer: '404', argv: ['--config', yaml] });
    writeFileSync(join(home, '.ccrc', 'codex', 'codex-a', 'litellm.pid'), `${mine.pid}\n`);
    // …while another process holds litellmPort.
    await at(home, 'litellm', '404');
    const r = runDoctor(home);
    const re = new RegExp(`^FAIL codex: codex-a: port ${port} \\(codex-a's litellm tier\\) is held by a process that is not this lane's LiteLLM: pid ${mine.pid} is this lane's by its command line, and another process holds the port's listening socket$`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(r.stdout).not.toMatch(/cannot identify/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('one tier running and the other not is FAIL — the shim up, LiteLLM down', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-half-shim-');
    await at(home, 'shim', 'json');
    const r = runDoctor(home);
    const re = /^FAIL codex: codex-a is half up: its shim is running and its LiteLLM tier is not, /m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: start the tier that is down: ccrc codex start codex-a (idempotent: it starts only what is not running)');
    // No start record was ever written here: an ABSENT record is one of the
    // causes the stale sentence names, never "it started from other bytes".
    expect(r.stdout).toMatch(/^WARN codex: codex-a's shim tier is running, and is not proven to run the installed bytes: its start record \(.*\/shim\.started\) is absent, unreadable or unparseable, /m);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // LiteLLM's identity is a PID that ITSELF holds the port (`_codex_pid_listens`):
  // /proc on Linux. The Darwin arm (lsof) is ccrc-codex.test.ts' to measure.
  itLinux('one tier running and the other not is FAIL — LiteLLM up (its nohup pidfile proves it), the shim down', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-half-litellm-');
    const yaml = join(home, '.ccrc', 'codex', 'codex-a', 'litellm.yaml');
    const l = await at(home, 'litellm', '404', 'codex-a', ['--config', yaml]);
    writeFileSync(join(home, '.ccrc', 'codex', 'codex-a', 'litellm.pid'), `${l.pid}\n`);
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(/^FAIL codex: codex-a is half up: its LiteLLM tier is running and its shim is not, /m);
    expect(lineFor(r.stdout, 'codex')).not.toMatch(/^PASS/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // A 3 (cannot ask) is its own WARN, never read as running or as stopped
  // (D-3715). The half-up case's LiteLLM, proven by its pidfile and command
  // line and listening on its port, while `readlink` reads none of
  // /proc/<pid>/fd: `_codex_pid_listens` cannot tell whether that pid holds
  // the port. Read as running it would be half up; read as stopped, idle.
  itLinux('a tier whose identity cannot be measured WARNs "unmeasured" — never half up, never read as running or as stopped', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-unmeasured-');
    const yaml = join(home, '.ccrc', 'codex', 'codex-a', 'litellm.yaml');
    const l = await at(home, 'litellm', '404', 'codex-a', ['--config', yaml]);
    writeFileSync(join(home, '.ccrc', 'codex', 'codex-a', 'litellm.pid'), `${l.pid}\n`);
    // `readlink` refuses every /proc/<pid>/fd/<n> and is the real one otherwise.
    // The link is REMOVED first: writing through it would rewrite the real binary.
    rmSync(join(stubBin(home), 'readlink'), { force: true });
    stub(home, 'readlink', `case "$1" in /proc/*/fd/*) exit 1 ;; esac\nexec ${shq(realPath('readlink'))} "$@"`);
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).not.toMatch(/^FAIL codex: codex-a is half up/m);
    const re = new RegExp(`^WARN codex: codex-a's litellm tier could not be measured \\(readlink read none of /proc/${l.pid}/fd's entries\\) — unmeasured, never read as running or as stopped$`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: run: ccrc codex status codex-a — it asks the same question and says what it could see');
    noRunnerBugLine(r.stdout, 'codex');
  });

  itLinux('a live unit of the shim\'s name whose MainPID is 0 — a restart window — WARNs with the retry wording, never as foreign, and doctor starts nothing', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-unproven-');
    plantSystemd(home, { userManager: true });
    const unit = laneUnits(home, 'codex-a').shim;
    fakeUnit(home, unit, { state: 'active', pid: 0 });
    const r = runDoctor(home);
    const re = new RegExp(`^WARN codex: codex-a: the unit ${unit.replace(/[.@]/g, '\\$&')} is active, but its identity as codex-a's shim tier is unproven: `, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toMatch(/^ {2}remedy: Re-run in a few seconds: this lane's own tier reads this way between two of its restarts/);
    expect(codexVerdicts(r.stdout).filter((l) => l.startsWith('FAIL codex: '))).toEqual([]);
    expect(systemdRunCalls(home)).toEqual([]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('a running shim whose start record is not current WARNs "not proven to run the installed bytes", naming the record; the current record does not', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-stale-');
    await at(home, 'shim', 'json');
    const rec = join(home, '.ccrc', 'codex', 'codex-a', 'shim.started');
    const now = startedJson(home, 'shim');
    writeFileSync(rec, `${now}\n`);
    expect(runDoctor(home).stdout).not.toMatch(/^WARN codex: codex-a's shim tier is running, and is not proven to run the installed bytes/m);
    writeFileSync(rec, `${JSON.stringify({ ...JSON.parse(now) as Record<string, string>, code: '0'.repeat(64) })}\n`);
    const r = runDoctor(home);
    const recRe = rec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^WARN codex: codex-a's shim tier is running, and is not proven to run the installed bytes: its start record \\(${recRe}\\) is absent, unreadable or unparseable, or it names another runtime generation, or another placed shim, than a start would use now$`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toMatch(/'ccrc update' restarts a running, proven, stale ccrc tier/);
    noRunnerBugLine(r.stdout, 'codex');
  }, 90_000);   // two doctor runs: a bounded but load-slow box is not a red

  it('a running shim whose bytes cannot be told right now WARNs "unmeasured, not current" — never current, never stale', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-stale-unknown-');
    await at(home, 'shim', 'json');
    rmSync(join(home, '.ccrc', 'runtime'), { recursive: true, force: true });
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(/^WARN codex: codex-a's shim tier is running, and whether it runs the installed bytes cannot be told .* — unmeasured, not current$/m);
    expect(r.stdout).not.toMatch(/^WARN codex: codex-a's shim tier is running, and is not proven to run the installed bytes/m);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('a LiteLLM tier down under a LIVE session on the lane WARNs; a session on another lane, or a stopped one, does not', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-live-');
    const reg = join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    writeFileSync(join(reg, 'proj-a.wrapper'), 'claude\n');
    writeFileSync(join(home, 'fixture-unit-claude-session@proj-a.service'), 'active\n');
    writeFileSync(join(reg, 'proj-b.wrapper'), 'codex-a\n');
    expect(runDoctor(home).stdout).not.toMatch(/live session/);
    writeFileSync(join(home, 'fixture-unit-claude-session@proj-b.service'), 'active\n');
    const r = runDoctor(home);
    const re = /^WARN codex: codex-a's LiteLLM tier is not running while 1 live session\(s\) run on this lane, /m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: start it: ccrc codex start codex-a (every session launch runs the same start)');
    noRunnerBugLine(r.stdout, 'codex');
  }, 90_000);   // two doctor runs: a bounded but load-slow box is not a red

  // The THIRD answer, kept apart (`_check_routing`'s census): a manager that
  // prints no word for a lane session's unit was NOT ASKED, which is never
  // read as stopped (idle) nor as live. The doctor's systemctl stub echoes
  // the fixture file's first line, so a lone newline is exactly that answer.
  itLinux('a LiteLLM tier down while the manager gives no word for a lane session WARNs "unmeasured, not idle" — never idle, never live', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-unasked-');
    const reg = join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    writeFileSync(join(reg, 'proj-b.wrapper'), 'codex-a\n');
    writeFileSync(join(home, 'fixture-unit-claude-session@proj-b.service'), '\n');
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).not.toMatch(/live session\(s\) run on this lane/);
    const re = /^WARN codex: codex-a's LiteLLM tier is not running, and whether any of this lane's registered sessions is live could not be asked \(1 unanswered\) — unmeasured, not idle$/m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: ask by hand (systemctl --user status claude-session@proj-b.service); if one is live, start the lane: ccrc codex start codex-a');
    noRunnerBugLine(r.stdout, 'codex');
  });

  // ── Plan 3b Task A5 (c): an unreadable .wrapper is not "another lane's" ──
  // ccd writes every registry field with `printf '%s'` (`_reg_set`): no
  // trailing newline, so `read`'s own status is 1 on EVERY real wrapper.
  // Only a failed REDIRECTION says "could not be read". The second case is
  // the control that pins ccd's own shape, so a fix keyed on read's status reds.
  it.skipIf(IS_DARWIN || process.getuid?.() === 0)(
    'a lane session whose .wrapper cannot be read is unanswered — never another lane\'s, never idle (Plan 3b A-5)', async () => {
      // Skipped as root, who reads a 0000-mode file; and on macOS, for the
      // remedy's systemctl spelling, as the "no word" case above is.
      const home = await healthyCodexBox('ccrc-doctor-codex-wrapper-unreadable-');
      const reg = join(home, '.cc-sessions');
      mkdirSync(reg, { recursive: true });
      writeFileSync(join(reg, 'proj-b.wrapper'), 'codex-a');
      chmodSync(join(reg, 'proj-b.wrapper'), 0o000);
      // Live, to show a live unit does not make an unreadable wrapper "this lane's".
      writeFileSync(join(home, 'fixture-unit-claude-session@proj-b.service'), 'active\n');
      const r = runDoctor(home);
      expect(r.stdout, r.stdout).not.toMatch(/live session\(s\) run on this lane/);
      // Final-review fix wave (MF5, D-4052): still counted unanswered (the verdict is the same WARN), but named apart.
      // The manager was never the cause, so its status hint is not the remedy; the file's mode is.
      const re = /^WARN codex: codex-a's LiteLLM tier is not running, and whether any of this lane's registered sessions is live could not be asked \(1 unanswered\) — unmeasured, not idle; 1 of them: \$HOME\/\.cc-sessions\/proj-b\.wrapper cannot be read by this user, so which lane that session runs on is unknown$/m;
      expect(r.stdout, r.stdout).toMatch(re);
      expect(r.stdout).toContain('proj-b.wrapper cannot be read');
      expect(remedyAfter(r.stdout, re)).toBe('  remedy: read or fix that file\'s mode (ccd writes it), and ask by hand; if one is live, start the lane: ccrc codex start codex-a');
      expect(r.stdout, 'an unreadable .wrapper sent the operator to the manager').not.toContain('claude-session@proj-b');
      // STDERR, not stdout: `cmd_doctor` captures only a check's stdout, so bash's
      // own open-failure line (printed when `2>/dev/null` comes AFTER the `<`,
      // measured) reaches the real stderr, which `runDoctor` returns apart.
      expect(r.stderr).not.toMatch(/Permission denied/);
      noRunnerBugLine(r.stdout, 'codex');
    });

  it("a .wrapper in ccd's own shape — no trailing newline — still reads as this lane's: one live session (Plan 3b A-5)", async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-wrapper-nonl-');
    const reg = join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    writeFileSync(join(reg, 'proj-b.wrapper'), 'codex-a');
    writeFileSync(join(home, 'fixture-unit-claude-session@proj-b.service'), 'active\n');
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(/^WARN codex: codex-a's LiteLLM tier is not running while 1 live session\(s\) run on this lane, /m);
    expect(r.stdout).not.toMatch(/could not be asked/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('a listener that accepts and never answers costs the check its probe bound — never a hang', async () => {
    // IN-PROCESS, on purpose (the header above): while doctor runs, this
    // process's event loop is blocked, so the kernel completes the connect
    // and nothing ever reads or answers it — a wedged listener, exactly.
    const home = await healthyCodexBox('ccrc-doctor-codex-hung-');
    const port = lanePorts(home, 'codex-a').proxyPort;
    const socks = new Set<Socket>();
    const srv = createServer((s) => { socks.add(s); });
    await new Promise<void>((res, rej) => { srv.once('error', rej); srv.listen(port, '127.0.0.1', () => res()); });
    try {
      const r = runDoctorBounded(home, 60_000, { CCRC_CODEX_PROBE_S: '1' });
      expect(r.stdout, r.stdout).toMatch(new RegExp(`^FAIL codex: codex-a: port ${port} \\(codex-a's shim tier\\) is held by a listener that is not this lane's: its identity check failed`, 'm'));
      noRunnerBugLine(r.stdout, 'codex');
    } finally {
      for (const s of socks) s.destroy();
      await new Promise<void>((res) => { srv.close(() => res()); });
    }
  }, 90_000);   // above runDoctorBounded's own 60 s deadline, so that deadline is what reds
});


// LINUX ONLY: on a macOS host bash's own OSTYPE is darwin*, so ccrc computes
// CCD_OS=darwin at source time and every row below would answer
// not-applicable. The forced-Darwin, unloaded and threshold cases need no
// host, and sit in the describe after this one.
describeLinux('ccrc doctor: codex — the usage rows, measured in isolation (Plan 3a Task 6)', () => {
  const T = 'ccrc-codex-usage@codex-a.timer';
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const warns = (out: string): string[] => out.split('\n').filter((l) => l.startsWith('WARN codex: '));

  it('placed, enabled and fresh: no WARN, a note naming what was measured, and the manager never asked', () => {
    const r = usageRows(usageBox('ccrc-doctor-usage-healthy-'));
    expect(r.code, r.stderr).toBe(0);
    expect(warns(r.stdout), r.stdout).toEqual([]);
    expect(r.stdout).toMatch(/^rc=0,0$/m);
    expect(r.stdout).toMatch(new RegExp(`^note=${esc(T)} enabled; usage row \\d+s old$`, 'm'));
    expect(r.asked, 'a usage row asked the user manager').toEqual([]);
  });

  it('the pair not installed: ONE box-level WARN naming ccrc install, and no per-lane "not enabled" echo of it', () => {
    const r = usageRows(usageBox('ccrc-doctor-usage-nopair-', { pair: false, enabled: false }));
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: ccrc's usage unit pair is not installed \(ccrc-codex-usage@\.service ccrc-codex-usage@\.timer absent from .*\), so no codex lane on this box publishes its ~\/\.cc-limits row$/)]);
    expect(r.stdout).toMatch(/^ {2}remedy: ccrc install — it places the pair and enables one usage timer per codex lane$/m);
    expect(r.stdout).toMatch(/^rc=2,0$/m);
    expect(r.stdout).toMatch(/^pair=missing$/m);
  });

  it('the lane\'s timer not enabled: WARN, remedy ccrc install (D-3721)', () => {
    const r = usageRows(usageBox('ccrc-doctor-usage-disabled-', { enabled: false }));
    expect(warns(r.stdout)).toEqual([`WARN codex: codex-a: ${T} is not enabled, so this lane's ~/.cc-limits usage row is never refreshed`]);
    expect(r.stdout).toMatch(/^ {2}remedy: ccrc install — its converge enables one usage timer per codex lane$/m);
    expect(r.stdout).toMatch(/^rc=0,2$/m);
  });

  it('ANOTHER repository\'s timer enabled for the same lane: one WARN naming it, remedy the operator\'s own disable, and a stale row is not judged — ccrc is not its writer (R6)', () => {
    const home = usageBox('ccrc-doctor-usage-second-writer-', { ageS: 99_999 });
    plantForeignUsage(home, 'codex-a');
    const r = usageRows(home);
    // Plan 3b Task A2: this fixture is BOTH armed (`usageBox` enables ccrc's own
    // timer), so the WARN says so and names ccrc's withdrawal first. The title is
    // §20.10's row of record, kept verbatim; the withheld-only case is the next one.
    expect(warns(r.stdout)).toEqual([`WARN codex: codex-a: another repository's ccgpt-usage@codex-a.timer is enabled, and ccrc's own ${T} is enabled too, so two publishers race this lane's ~/.cc-limits row, and ccgpt-usage@codex-a.timer refreshes the credential outside the auth library's lock, so it can race the tier's refresh (ccrc's own poll only reads it)`]);
    expect(r.stdout).toMatch(new RegExp(`^ {2}remedy: systemctl --user disable --now ${esc(T)} \\(ccrc's own unit; no ccrc fixer withdraws it\\), or leave it to the next update, whose converge withdraws ${esc(T)} while ccgpt-usage@codex-a\\.timer stands and re-measures the link\\. Once this lane's cutover no longer needs ccgpt-usage@codex-a\\.timer, disable it yourself: systemctl --user disable --now ccgpt-usage@codex-a\\.timer — ccrc never disables another tool's unit$`, 'm'));
    expect(r.asked).toEqual([]);
  });

  it('ANOTHER repository\'s timer enabled and ccrc\'s own withheld, as the converge leaves it: the WARN says ccrc withholds its own — true only now (Plan 3b Task A2)', () => {
    const home = usageBox('ccrc-doctor-usage-second-writer-withheld-', { enabled: false });
    plantForeignUsage(home, 'codex-a');
    const r = usageRows(home);
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: codex-a: another repository's ccgpt-usage@codex-a\.timer is enabled, so two publishers would race this lane's ~\/\.cc-limits row, and ccgpt-usage@codex-a\.timer refreshes the credential outside the auth library's lock, so it can race the tier's refresh — ccrc withholds its own ccrc-codex-usage@codex-a\.timer while it stands$/)]);
    expect(r.stdout).toMatch(/^ {2}remedy: once this lane's cutover no longer needs it, disable it yourself: systemctl --user disable --now ccgpt-usage@codex-a\.timer, then run: ccrc install — ccrc never disables another tool's unit$/m);
    expect(r.asked).toEqual([]);
  });

  it('another repository\'s FLAT timer: a box-level WARN that it cannot be attributed, never a lane\'s', () => {
    const home = usageBox('ccrc-doctor-usage-flat-');
    plantForeignUsage(home, null);
    const r = usageRows(home);
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: another repository's ccgpt-usage\.timer is enabled on this box; it names no lane, so ccrc cannot tell whether it is a second publisher of a codex lane's ~\/\.cc-limits row$/)]);
    expect(r.stdout).toMatch(/^rc=2,0$/m);
  });

  it('a row older than three polls: WARN naming its age and the publisher\'s log', () => {
    const r = usageRows(usageBox('ccrc-doctor-usage-stale-', { ageS: 2701 }));
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: codex-a: its usage row was last written 45 min ago — more than three of ccrc-codex-usage@codex-a\.timer's polls$/)]);
    expect(r.stdout).toMatch(/^ {2}remedy: read what the publisher says: journalctl --user -u ccrc-codex-usage@codex-a\.service -n 50$/m);
  });

  it('no row yet, the timer enabled moments ago: no WARN, and the note says why', () => {
    const r = usageRows(usageBox('ccrc-doctor-usage-norow-fresh-', { row: false }));
    expect(warns(r.stdout)).toEqual([]);
    expect(r.stdout).toMatch(/^note=.*no usage row yet \(enabled \d+s ago; the first poll runs five minutes after enable\)/m);
  });

  it('no row, and the timer enabled longer than three polls ago: WARN — this lane has never published', () => {
    const r = usageRows(usageBox('ccrc-doctor-usage-norow-old-', { row: false, linkAgeS: 2701 }));
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: codex-a: ccrc-codex-usage@codex-a\.timer has been enabled for longer than 45 min and this lane has never published a usage row \(.*\/\.cc-limits\/codex-a\.json\)$/)]);
  });

  // Under W6's mutation the row's `jq` blocks on this FIFO, and `usageRows`'
  // process-group bound ends it, exit 124, with no reader left behind (F8).
  it.skipIf(DOCTOR_DEADLINE_BIN === null)('a FIFO at the row\'s path is a WARN, never a hang', () => {
    const home = usageBox('ccrc-doctor-usage-fifo-', { row: false });
    mkdirSync(join(home, '.cc-limits'), { recursive: true });
    expect(spawnSync('mkfifo', [join(home, '.cc-limits', 'codex-a.json')]).status).toBe(0);
    const r = usageRows(home);
    expect(r.code, 'the rows blocked on a FIFO (exit 124: ended at the 20 s process-group bound)').toBe(0);
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: codex-a: .*\/\.cc-limits\/codex-a\.json is not a regular file, so this lane's usage row cannot be read$/)]);
  }, 40_000);

  it('a `date` that cannot answer +%s: WARN, the row\'s age unmeasured — never read as fresh (fix round 1)', () => {
    const home = usageBox('ccrc-doctor-usage-nodate-');
    // `usageBox` linked the REAL date into stub-bin: remove that link first,
    // so the stub below is a new file and never a write through the link.
    unstub(home, 'date');
    stub(home, 'date', 'exit 1');
    const r = usageRows(home);
    expect(warns(r.stdout), r.stdout).toEqual(["WARN codex: codex-a: this box's `date` cannot answer +%s, so the age of this lane's usage row cannot be measured"]);
    expect(r.stdout).toMatch(/^ {2}remedy: install a working GNU\/BSD date — every age-based check in this file needs it$/m);
    expect(r.stdout).toMatch(/^rc=0,2$/m);
  });

  it('a row with no numeric ts: WARN, its age unmeasured', () => {
    const home = usageBox('ccrc-doctor-usage-nots-', { row: false });
    mkdirSync(join(home, '.cc-limits'), { recursive: true });
    writeFileSync(join(home, '.cc-limits', 'codex-a.json'), '{"five":null,"seven":12}');
    const r = usageRows(home);
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: codex-a: .*codex-a\.json carries no numeric ts, so its age cannot be measured$/)]);
  });

  it('every enabled ccrc usage timer belongs to a Codex lane: no surplus, nothing recorded, the manager never asked (Plan 3b Task A2)', () => {
    const r = usageRows(usageBox('ccrc-doctor-usage-surplus-none-'), false, SURPLUS_ROWS);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^rc=0$/m);
    expect(r.stdout).toMatch(/^surplus=$/m);
    expect(warns(r.stdout), r.stdout).toEqual([]);
    expect(r.asked).toEqual([]);
  });

  it('a ccrc usage timer enabled for an id that is no longer a Codex lane WARNs by name — read off the manager\'s links, never the roster — remedy the exact disable, with the next update\'s converge as its automatic cure (Plan 3b Task A2)', () => {
    const home = usageBox('ccrc-doctor-usage-surplus-');
    plantCodexUsage(home, 'ext-a', { row: false });
    const r = usageRows(home, false, SURPLUS_ROWS);
    expect(r.stdout).toMatch(/^rc=0$/m);
    expect(r.stdout).toMatch(/^surplus=ext-a$/m);
    expect(warns(r.stdout), r.stdout).toEqual([SURPLUS_WARN('ext-a')]);
    expect(remedyAfter(r.stdout, /^WARN codex: ccrc-codex-usage@ext-a\.timer is still enabled/)).toBe(SURPLUS_FIX('ext-a'));
    expect(r.asked, 'the surplus row asked the user manager').toEqual([]);
  });

  it('ccrc\'s enabled usage timers that cannot be listed are their own WARN, unmeasured — never "no surplus" (Plan 3b Task A2)', () => {
    const r = usageRows(usageBox('ccrc-doctor-usage-surplus-unlistable-'), false,
      `unset WRAPPER_ID_RE WRAPPER_SUFFIX_SAFE_RE; CCRC_HERE="$HOME/no-shape-contract-here"\n${SURPLUS_ROWS}`);
    expect(r.stdout).toMatch(/^rc=1$/m);
    expect(warns(r.stdout), r.stdout).toEqual([UNLISTABLE_WARN]);
    expect(remedyAfter(r.stdout, /^WARN codex: ccrc's own enabled usage timers could not be listed/)).toBe(UNLISTABLE_FIX);
  });

  itCodex('wired into _check_codex on a doctor-clean codex box: a second writer turns its PASS into a WARN on the check\'s own name', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-usage-e2e-');   // Task 4's fixture, extended by Step 3b
    expect(lineFor(runDoctor(home).stdout, 'codex'), 'the doctor-clean codex box no longer PASSes codex')
      .toMatch(/^PASS codex: .*ccrc-codex-usage@codex-a\.timer enabled/);
    plantForeignUsage(home, 'codex-a');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN codex: codex-a: another repository's ccgpt-usage@codex-a\.timer is enabled/m);
    expect(r.stdout).not.toMatch(/^PASS codex: /m);
  });
});


// The rows that need no host: forced Darwin (OSTYPE is set, so ccrc computes
// CCD_OS=darwin on any host), the unloaded reader, and the threshold pin.
describe('ccrc doctor: codex — the usage rows, on any host (Plan 3a Task 6)', () => {
  const warns = (out: string): string[] => out.split('\n').filter((l) => l.startsWith('WARN codex: '));

  it('forced Darwin: every row not applicable — no WARN with nothing planted, and the notes say why (R2)', () => {
    const r = usageRows(usageBox('ccrc-doctor-usage-darwin-', { pair: false, enabled: false, row: false }), true);
    expect(warns(r.stdout), r.stdout).toEqual([]);
    expect(r.stdout).toMatch(/^rc=0,0$/m);
    expect(r.stdout).toMatch(/^box-note=usage publishing not applicable on macOS — ccrc places no launchd job for it \(decision 17\)$/m);
    expect(r.stdout).toMatch(/^note=usage timer not applicable on macOS$/m);
  });

  it('forced Darwin: the surplus row is not applicable — rc 3 and nothing recorded, even over a ccrc link for a non-codex id (Plan 3b Task A2)', () => {
    const home = usageBox('ccrc-doctor-usage-surplus-darwin-');
    plantCodexUsage(home, 'ext-a', { row: false });
    const r = usageRows(home, true, SURPLUS_ROWS);
    expect(r.stdout).toMatch(/^rc=3$/m);
    expect(r.stdout).toMatch(/^surplus=$/m);
    expect(warns(r.stdout), r.stdout).toEqual([]);
  });

  it('sourced without ccrc, the rows FAIL naming the bug, rather than reading a function that does not exist', () => {
    const home = usageBox('ccrc-doctor-usage-unloaded-');
    const r = spawnSync(BASH, ['-c', `set -uo pipefail\n. ${shq(CHECKS_SRC)}\n_dr_codex_usage_box; echo "rc=$?"`],
      { env: doctorEnv(home), encoding: 'utf8' });
    expect(r.stdout).toMatch(/^FAIL codex: ccrc's own usage-timer reader is not loaded/m);
    expect(r.stdout).toMatch(/^rc=1$/m);
  });

  // Fix round 1: every usage reader `_check_codex` calls is in its loaded
  // guard, which runs BEFORE `_dr_cx_bins` and `_dr_cx_runtime` record
  // anything. Before, a missing reader reached `_dr_codex_usage_box`'s own
  // guard after those had recorded, and its `return 1` threw their findings
  // away. This box has no lane executables and no runtime, so a check that got
  // past the guard would record FAILs: one FAIL line, the guard's, is the
  // proof that nothing recorded was lost.
  it.each(['_codex_usage_enabled', '_codex_usage_enabled_ids', '_codex_usage_timer', '_codex_usage_foreign', '_codex_usage_wants',
    '_codex_usage_flat_foreign', '_plat_mtime'])('%s not loaded: _check_codex FAILs in its loaded guard, before any finding is recorded (fix round 1)', (fn) => {
    const r = usageRows(usageBox('ccrc-doctor-usage-guard-'), false, `unset -f ${fn}\n_check_codex; echo "rc=$?"`);
    expect(r.stdout.split('\n').filter((l) => /^(PASS|WARN|FAIL|SKIP) codex: /.test(l)), r.stdout).toEqual([
      `FAIL codex: ccrc's own Codex lane library is not loaded (${fn}, BOX_TREE_DIR or CODEX_TIERS is missing), so no lane on this box was measured`]);
    expect(r.stdout).toMatch(/^rc=1$/m);
  });

  it('the staleness threshold covers three of the shipped timer\'s cycles', () => {
    const r = spawnSync(BASH, ['-c', `. ${shq(CHECKS_SRC)}; printf '%s' "$_DR_CODEX_USAGE_STALE_S"`], { encoding: 'utf8' });
    const m = /^OnUnitActiveSec=(\d+)min$/m.exec(readFileSync(join(REPO, 'deploy', 'systemd', 'ccrc-codex-usage@.timer'), 'utf8'));
    expect(m, 'the usage timer\'s cadence is not spelled in minutes — this pin has gone stale').not.toBeNull();
    expect(Number(r.stdout), 'a row one missed poll old would read as stale').toBeGreaterThanOrEqual(3 * Number(m![1]) * 60);
  });
});


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
    expect(lineFor(runDoctor(home).stdout, 'scope-sweep')).toMatch(/^PASS scope-sweep: no dead pane scope the sweep could measure, and no process older than a day in a live one \(the sweep's record, \d+s old, mode shadow\)$/);
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
  /** The own-hook FAIL's remedy (R55): true of what the installer's sweep does, which drops a WHOLE entry that carries ccrc's hook. */
  const OWN_REMEDY_TEXT = "  remedy: run 'ccrc doctor --fix' (it removes ccrc's own entry from every event; an entry of its own that names another command is kept, but an entry shared with ccrc's hook is not, so --fix refuses a home that has one: move the other command into an entry of its own first)";
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
    const REFUSAL = (ev: string): RegExp => new RegExp(
      `^FIX delegation-hooks: refused — claude: ${ev} holds an entry that mixes ccrc's session hook with another command, and the sweep that --fix, ccrc install and ccrc update run removes the whole entry that carries ccrc's hook, other commands included; move the other command into an entry of its own under ${ev}, then re-run ccrc doctor --fix$`, 'm');

    it('REFUSES a home whose Worktree entry mixes ccrc\'s hook with another command: the file is byte-identical, the remedy names the event and the manual step, and the check still shows FAIL then WARN', () => {
      const { home, f } = mixedHome('ccrc-doctor-dh-fix-mixed-worktree-', 'WorktreeCreate');
      const before = readFileSync(f);
      const r = runDoctor(home, ['doctor', '--fix']);
      expect(r.stdout).toMatch(REFUSAL('WorktreeCreate'));
      expect(Buffer.compare(readFileSync(f), before), 'the settings file changed').toBe(0);
      const ls = r.stdout.split('\n');
      // as measured, then as re-measured after the refused fix: FAIL then WARN both times
      expect(ls.filter((l) => /^(FAIL|WARN) delegation-hooks: /.test(l)).map((l) => l.split(':')[0])).toEqual(
        ['FAIL delegation-hooks', 'WARN delegation-hooks', 'FAIL delegation-hooks', 'WARN delegation-hooks']);
      expect(r.stdout).toMatch(/^WARN delegation-hooks: WorktreeCreate is registered/m);
      expect(r.code).toBe(1);
      // …and the other command is still there, in the entry it was planted in.
      expect(JSON.stringify(JSON.parse(readFileSync(f, 'utf8')).hooks.WorktreeCreate)).toContain('their-shared-hook');
    });

    it('REFUSES a home whose NON-Worktree entry mixes ccrc\'s hook with another command too (5180): byte-identical, and the remedy names that event', () => {
      const { home, f } = mixedHome('ccrc-doctor-dh-fix-mixed-stop-', 'Stop', { omit: ['SessionEnd'] });
      const before = readFileSync(f);
      const r = runDoctor(home, ['doctor', '--fix']);
      expect(r.stdout).toMatch(REFUSAL('Stop'));
      expect(Buffer.compare(readFileSync(f), before), 'the settings file changed').toBe(0);
      // the check is unchanged for an approved event: it names the missing registration, and nothing about the mixed entry
      expect(r.stdout).toMatch(/^FAIL delegation-hooks: the shipped hook registration is missing from 1 rostered home: claude: SessionEnd$/m);
      expect(r.stdout).not.toMatch(/^(FAIL|WARN) delegation-hooks: [^\n]*their-shared-hook/m);
    });

    // Task 14 re-review 2: N4 (shapes the installer's sweep walks although they are not valid settings), N5 (an event key is never
    // word-split or globbed), N6 (several events: "A and B hold ... under each of A and B").
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
    ])('N4: REFUSES %s that mixes ccrc\'s hook with another command (the sweep would walk it): byte-identical', (_name, ev, shape) => {
      const { home, f } = reshaped(`ccrc-doctor-dh-fix-shape-${ev}-`, shape);
      const before = readFileSync(f);
      const r = runDoctor(home, ['doctor', '--fix']);
      expect(r.stdout).toMatch(REFUSAL(ev));
      expect(Buffer.compare(readFileSync(f), before), 'the settings file changed').toBe(0);
    });

    it('N5: an event key `*` is named as itself, never glob-expanded or word-split', () => {
      const { home, f } = reshaped('ccrc-doctor-dh-fix-star-', (j) => {
        j.hooks['*'] = [{ hooks: [{ type: 'command', command: installerHook().command }, THEIRS('their-star-hook')] }];
        delete j.hooks.SessionEnd;                                               // a defect, so the check FAILs and --fix runs
      });
      writeFileSync(join(home, 'aa.txt'), 'a file a glob would name');
      const before = readFileSync(f);
      const r = runDoctor(home, ['doctor', '--fix']);
      expect(r.stdout).toMatch(/^FIX delegation-hooks: refused — claude: \* holds an entry that mixes ccrc's session hook with another command, .*an entry of its own under \*, then re-run ccrc doctor --fix$/m);
      expect(Buffer.compare(readFileSync(f), before)).toBe(0);
    });

    it('N6: several mixed events are named together, with the plural verb: "A and B hold ... under each of A and B"', () => {
      const { home, f } = reshaped('ccrc-doctor-dh-fix-two-', (j) => {
        j.hooks.Stop = [{ hooks: [{ type: 'command', command: installerHook().command }, THEIRS('their-stop-hook')] }];
        j.hooks.WorktreeCreate = [{ hooks: [{ type: 'command', command: installerHook().command }, THEIRS('their-wt-hook')] }];
      });
      const order = Object.keys(JSON.parse(readFileSync(f, 'utf8')).hooks).filter((k) => k === 'Stop' || k === 'WorktreeCreate');
      const named = `${order[0]} and ${order[1]}`;
      const r = runDoctor(home, ['doctor', '--fix']);
      expect(r.stdout).toContain(`FIX delegation-hooks: refused — claude: ${named} hold an entry that mixes ccrc's session hook with another command`);
      expect(r.stdout).toContain(`move the other command into an entry of its own under each of ${named}, then re-run ccrc doctor --fix`);
    });

    it('refuses only the mixed home: another home is fixed as before', () => {
      const { home, f } = mixedHome('ccrc-doctor-dh-fix-mixed-one-home-', 'PostToolUse', { omit: ['SessionEnd'] });
      writeRoster(home, [UPSTREAM, { id: 'lane-a', exec: { kind: 'generated' }, telemetry: 'anthropic' } as RosterEntry]);
      mkdirSync(join(home, '.lane-a'), { recursive: true });
      const before = readFileSync(f);
      const r = runDoctor(home, ['doctor', '--fix']);
      expect(r.stdout).toMatch(REFUSAL('PostToolUse'));
      expect(r.stdout).toMatch(/^FIX delegation-hooks: re-ran the shipped tree's install-session-hooks\.sh into 1 home\(s\): lane-a$/m);
      expect(Buffer.compare(readFileSync(f), before)).toBe(0);
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
// workbox-shaped text, the same text `healthy()`, `TREE_STUBS` and `ccrc-update.test.ts`'s tree plant, so a verdict
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

  // A FRESH INSTALL ENDS GREEN (D-4168, D-139; `ccrc-install.test.ts` pins it): within one lease of the writer's unit
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


// ── codex bridge Stage 2, Task 13: the doctor, mode by mode ──────────────────────────────────────────────────────
// Every row inside the existing `codex` check, each case with a lane in each mode where the row means something in
// both (`codex-a` litellm, `codex-b` direct). A `direct` lane runs the bridge tier alone, on the shim's port and
// unit; its LiteLLM and shim tiers are a RETIRED REFRESHER when either reads this lane's (Review Focus 5).
describeCodex('ccrc doctor: codex, a direct lane\'s rows (codex bridge Stage 2, Task 13)', () => {
  const laneDir = (home: string, id: string): string => join(home, '.ccrc', 'codex', id);
  const RETIRED = (id: string, tier: string): string =>
    `FAIL codex: ${id} runs a retired refresher: its ${tier} tier is running in direct mode, so two processes refresh one credential`;
  const RETIRED_FIX = (id: string): string =>
    `  remedy: stop every tier of the lane, in either mode: ccrc codex stop ${id}, then ccrc codex start ${id} (a direct lane starts its bridge alone); to run the lane through LiteLLM again instead: ccrc codex switch ${id} litellm`;
  /** `lane.json`'s `bridgeFiles`, read back: the names are `laneManifest`'s, never spelled here. */
  const bridgeFile = (home: string, id: string, k: 'stats' | 'store'): string =>
    join(laneDir(home, id), (JSON.parse(readFileSync(join(laneDir(home, id), 'lane.json'), 'utf8')) as
      { bridgeFiles: Record<string, string> }).bridgeFiles[k]);
  const liveSession = (home: string, sid: string, id: string): void => {
    const reg = join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    writeFileSync(join(reg, `${sid}.wrapper`), `${id}\n`);
    writeFileSync(join(home, `fixture-unit-claude-session@${sid}.service`), 'active\n');
  };

  itLinux('a healthy direct lane has no retired-refresher FAIL (a running bridge alone), and a litellm lane beside it reads as before', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-healthy-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-b');
    const b = await plantRunningBridge(home, 'codex-b');
    const r = runDoctor(home);
    expect(r.stdout).not.toMatch(/retired refresher/);
    const line = lineFor(r.stdout, 'codex') ?? '';
    expect(line, r.stdout).toMatch(/^PASS codex: /);
    expect(line).toMatch(/codex-b \(ports \d+\/\d+, direct mode, /);
    expect(line).toContain(`tiers: bridge running (nohup, pid ${b.pid})`);
    expect(line).toMatch(/codex-a \(ports \d+\/\d+, [^;]*LiteLLM config current; tiers: none running \(a lane is lazy\)/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  itLinux('a direct lane whose LiteLLM tier runs FAILs as a retired refresher and is never half up; on a litellm lane the same tier is half up', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-retired-litellm-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-b');
    for (const id of ['codex-a', 'codex-b']) {
      const l = await spawnListener(home, { answer: '404', port: lanePorts(home, id).litellmPort, argv: ['--config', join(laneDir(home, id), 'litellm.yaml')] });
      writeFileSync(join(laneDir(home, id), 'litellm.pid'), `${l.pid}\n`);
    }
    const r = runDoctor(home);
    const re = new RegExp(`^${reEsc(RETIRED('codex-b', 'litellm'))}$`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe(RETIRED_FIX('codex-b'));
    expect(r.stdout).not.toMatch(/^FAIL codex: codex-b is half up/m);
    expect(r.stdout).toMatch(/^FAIL codex: codex-a is half up: its LiteLLM tier is running and its shim is not, /m);
    expect(r.stdout).not.toMatch(/codex-a runs a retired refresher/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('a direct lane whose shim answers on the shared port FAILs as a retired refresher, once, and its bridge tier is not named foreign', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-retired-shim-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-b');
    for (const id of ['codex-a', 'codex-b']) await spawnListener(home, { answer: 'json', lane: id, port: lanePorts(home, id).proxyPort });
    const r = runDoctor(home);
    expect(r.stdout.split('\n').filter((l) => l === RETIRED('codex-b', 'shim')), r.stdout).toHaveLength(1);
    expect(r.stdout).not.toMatch(/\(codex-b's bridge tier\)/);
    expect(r.stdout).not.toMatch(/codex-a runs a retired refresher/);
    expect(r.stdout).toMatch(/^FAIL codex: codex-a is half up: its shim is running and its LiteLLM tier is not, /m);
    noRunnerBugLine(r.stdout, 'codex');
  });

  itLinux('a running bridge whose start record is not current WARNs "not proven to run the installed bytes", the shim-stale WARN\'s twin; the current record does not', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-stale-');
    plantDirectLane(home, 'codex-a');
    await plantRunningBridge(home, 'codex-a', { record: 'current' });
    expect(runDoctor(home).stdout).not.toMatch(/^WARN codex: codex-a's bridge tier is running/m);
    const rec = join(laneDir(home, 'codex-a'), 'bridge.started');
    writeFileSync(rec, `${JSON.stringify({ ...JSON.parse(readFileSync(rec, 'utf8')) as Record<string, string>, bridge: '0'.repeat(64) })}\n`);
    const r = runDoctor(home);
    const re = new RegExp(`^WARN codex: codex-a's bridge tier is running, and is not proven to run the installed bytes: its start record \\(${reEsc(rec)}\\) is absent, unreadable or unparseable, or it names another interpreter, another placed shim or another bridge package than a start would use now$`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toMatch(/'ccrc update' restarts a running, proven, stale ccrc tier/);
    noRunnerBugLine(r.stdout, 'codex');
  }, 90_000);   // two doctor runs, as the shim twin's

  itLinux('a running bridge whose bytes cannot be told right now WARNs "unmeasured, not current" — never current, never stale', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-stale-unknown-');
    plantDirectLane(home, 'codex-a');
    await plantRunningBridge(home, 'codex-a');
    rmSync(join(home, 'ccrc', 'ccd', 'codexbridge'), { recursive: true, force: true });
    const r = runDoctor(home);
    const re = /^WARN codex: codex-a's bridge tier is running, and whether it runs the installed bytes cannot be told \(no python3 3\.9 or later on PATH, or the placed shim or the bridge package cannot be hashed\) — unmeasured, not current$/m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toMatch(/^ {2}remedy: \S/);
    expect(r.stdout).not.toMatch(/codex-a's bridge tier is running, and is not proven/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('a bridge-shaped answer with no proven bridge pid FAILs as unidentified on a direct lane; on a litellm lane its shim tier names the other mode', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-foreign-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-a');
    const pa = lanePorts(home, 'codex-a').proxyPort;
    const pb = lanePorts(home, 'codex-b').proxyPort;
    await spawnBridgeListener(home, { lane: 'codex-a', port: pa });
    await spawnBridgeListener(home, { lane: 'codex-b', port: pb });
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(new RegExp(`^FAIL codex: codex-a: port ${pa} \\(codex-a's bridge tier\\) is held by a listener that is not this lane's: its identity check failed — ccrc neither adopts nor stops what it cannot identify$`, 'm'));
    expect(r.stdout).toMatch(new RegExp(`^FAIL codex: codex-b: port ${pb} \\(codex-b's shim tier\\) answers as codex-b's bridge, the tier of the lane's other mode`, 'm'));
    expect(r.stdout).not.toMatch(/retired refresher/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  itLinux('a bridge whose identity cannot be measured WARNs "unmeasured" — never read as running or as stopped', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-unmeasured-');
    plantDirectLane(home, 'codex-a');
    const b = await plantRunningBridge(home, 'codex-a');
    rmSync(join(stubBin(home), 'readlink'), { force: true });
    stub(home, 'readlink', `case "$1" in /proc/*/fd/*) exit 1 ;; esac\nexec ${shq(realPath('readlink'))} "$@"`);
    const r = runDoctor(home);
    const re = new RegExp(`^WARN codex: codex-a's bridge tier could not be measured \\(readlink read none of /proc/${b.pid}/fd's entries\\) — unmeasured, never read as running or as stopped$`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(r.stdout).not.toMatch(/retired refresher/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('the LiteLLM-down WARN is a litellm lane\'s only: a live session on an idle direct lane raises none', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-live-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-b');
    liveSession(home, 'proj-a', 'codex-a');
    liveSession(home, 'proj-b', 'codex-b');
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(/^WARN codex: codex-a's LiteLLM tier is not running while 1 live session\(s\) run on this lane/m);
    expect(r.stdout).not.toMatch(/codex-b's LiteLLM tier is not running/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('the litellm.yaml row is skipped on a direct lane: a missing LiteLLM config FAILs the litellm lane only', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-yaml-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-b');
    for (const id of ['codex-a', 'codex-b']) rmSync(join(laneDir(home, id), 'litellm.yaml'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(/^FAIL codex: codex-a has no rendered LiteLLM config \(/m);
    expect(r.stdout).not.toMatch(/codex-b has no rendered LiteLLM config|codex-b's LiteLLM config/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('a bridge stats file or reasoning store that is not 0600, or not a regular file, FAILs, in either mode; an owner-only one does not', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-files-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-b');
    const aStats = bridgeFile(home, 'codex-a', 'stats');
    const aStore = bridgeFile(home, 'codex-a', 'store');
    const bStats = bridgeFile(home, 'codex-b', 'stats');
    const bStore = bridgeFile(home, 'codex-b', 'store');
    writeFileSync(aStats, '{}\n', { mode: 0o644 });
    chmodSync(aStats, 0o644);
    writeFileSync(aStore, 'fixture\n', { mode: 0o640 });
    chmodSync(aStore, 0o640);
    writeFileSync(bStats, '{}\n', { mode: 0o600 });
    writeFileSync(join(home, 'elsewhere.sqlite'), 'fixture\n', { mode: 0o600 });
    symlinkSync(join(home, 'elsewhere.sqlite'), bStore);
    const r = runDoctor(home);
    const statsRe = new RegExp(`^FAIL codex: codex-a's bridge stats file ${reEsc(aStats)} has mode 644, and the bridge keeps it owner-only \\(0600\\): it names the lane's upstream request ids and its usage$`, 'm');
    expect(r.stdout, r.stdout).toMatch(statsRe);
    expect(remedyAfter(r.stdout, statsRe)).toBe(`  remedy: chmod 600 ${aStats}`);
    expect(r.stdout).toMatch(new RegExp(`^FAIL codex: codex-a's bridge reasoning store ${reEsc(aStore)} has mode 640, and the bridge keeps it owner-only \\(0600\\): it holds the lane's encrypted reasoning$`, 'm'));
    const linkRe = new RegExp(`^FAIL codex: codex-b's bridge reasoning store ${reEsc(bStore)} is not a regular file \\(a symlink, a directory or another kind of file\\), and the bridge keeps it owner-only \\(0600\\) only as a regular file it creates itself$`, 'm');
    expect(r.stdout).toMatch(linkRe);
    expect(remedyAfter(r.stdout, linkRe)).toBe(`  remedy: stop the lane (ccrc codex stop codex-b), move ${bStore} aside by hand, then start it again: the bridge creates a new one, mode 0600 — ccrc never removes it for you`);
    expect(r.stdout).not.toMatch(/codex-b's bridge stats file/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('a direct lane on the siwc upstream FAILs upstream-unsupported; a litellm lane naming siwc does not', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-siwc-', ['codex-a', 'codex-b']);
    editRosterRow(home, 'codex-a', (row) => { row['exec'].upstream = 'siwc'; });
    renderLane(home, 'codex-a');
    plantDirectLane(home, 'codex-b', { upstream: 'siwc' });
    const r = runDoctor(home);
    const re = /^FAIL codex: codex-b is a direct lane whose upstream is "siwc", and the siwc route arrives in Stage 3: 'ccrc codex start codex-b' refuses it \(upstream-unsupported\), so the lane cannot serve$/m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: set the lane\'s upstream to "backend" (or remove it) in $HOME/.ccrc/accounts.json by hand, then: ccrc codex start codex-b — ccrc never edits a roster row for you');
    expect(r.stdout).not.toMatch(/codex-a is a direct lane whose upstream/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // `--fix` runs only behind a FAIL and restarts tiers only through the install step (`_inst_codex_tiers`), the one
  // that restarts a running, proven, stale tier and never starts a stopped one. Composed here with that REAL step on
  // two direct lanes: a placed shim whose bytes drifted (a FAIL, and code a bridge runs) is restored, and then
  // codex-a's running stale bridge is stopped and started, and codex-b's stopped bridge is left stopped.
  it('--fix restoring a drifted shim restarts a direct lane\'s stale running bridge through _inst_codex_tiers, and never starts a stopped one', () => {
    const home = mkTmp('ccrc-doctor-fix-codex-direct-');
    const tree = join(home, 'ccrc', 'ccd');
    const bin = join(home, '.local', 'bin');
    mkdirSync(tree, { recursive: true });
    mkdirSync(bin, { recursive: true });
    const RT = '#!/bin/sh\ncase "$1" in check) exit 0 ;; python) echo "$HOME/.ccrc/runtime/codex/gen-x/bin/python"; exit 0 ;; esac\nexit 64\n';
    for (const n of GPT_LANE_BINS) {
      const text = n === 'ccgpt-runtime' ? RT : `#!/bin/sh\n# fixture shipped ${n}\n`;
      writeFileSync(join(tree, n), text, { mode: 0o755 });
      writeFileSync(join(bin, n), n === 'ccgpt-proxy.py' ? '#!/bin/sh\n# drifted\n' : text, { mode: 0o755 });
    }
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const harness = [
      'set -uo pipefail',
      ccrcLine(/^PROG=.*$/m, 'PROG='),
      ccrcLine(/^_ccrc_die\(\) \{.*\}$/m, '_ccrc_die'),
      ccrcFunction('_inst_atomic'),
      ccrcFunction('_box_env_value'),
      'BOX_TREE_DIR="$HOME/ccrc"',
      'BOX_ENV_FILE="$HOME/.ccrc/ccrc.env"',
      'CCRC_CODEX_READY_S=1',
      'CX_LITELLM=45010', 'CX_PROXY=45011',
      checksFunction('_dr_join'),
      checksDecl('CODEX_LANE_BINS'),
      ccrcLine(/^CODEX_TIERS=.*$/m, 'CODEX_TIERS='),
      ccrcLine(/^_codex_shim_file\(\) .*$/m, '_codex_shim_file'),
      ccrcLine(/^_codex_auth_lib\(\) .*$/m, '_codex_auth_lib'),
      ccrcLine(/^_codex_runtime_cli\(\) \{.*\}$/m, '_codex_runtime_cli'),
      ccrcFunction('_codex_mode_tiers'),
      ccrcFunction('_codex_tier_is_other_mode'),
      ccrcFunction('_codex_ready_secs'),
      '_codex_lanes() { printf \'codex-a\\ncodex-b\\n\'; }',
      '_codex_row() { CX_ID="$1"; return 0; }',
      '_codex_lane_json_state() { echo current; }',
      '_codex_lane_mode() { printf \'direct\\n\'; }',
      '_codex_bus_defaults() { :; }',
      '_models_roster_path() { printf \'%s\' "$HOME/.ccrc/accounts.json"; }',
      '_models_node() { echo \'{"ok":true,"op":"materialise","check":true,"changed":{"lane":false,"classes":false,"effort":false}}\'; }',
      '_models_node_locked() { shift; _models_node "$@"; }',
      '_models_litellm_lane_held() { echo \'{"ok":true,"op":"litellm","changed":false}\'; }',
      lockStub(),
      // codex-a's bridge: running, stale, gone after its stop, back after its start; codex-b's: not running.
      '_codex_tier_ours() {',
      '  local k="$1-$2" n; n=$(( $(cat "$HOME/n-$k" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$HOME/n-$k"',
      '  printf \'_codex_tier_ours %s %s\\n\' "$1" "$2" >> "$HOME/calls"',
      '  CX_TIER_WHY=\'\'; CX_TIER_VIA=\'\'; CX_TIER_PID=\'\'',
      '  case "$1 $2 $n" in "codex-a bridge 1"|"codex-a bridge 3") return 0 ;; esac',
      '  return 1',
      '}',
      '_codex_tier_stale() { printf \'_codex_tier_stale %s %s\\n\' "$1" "$2" >> "$HOME/calls"; [ "$1 $2" = "codex-a bridge" ] && return 0; return 1; }',
      '_codex_stop_tier() { printf \'_codex_stop_tier %s %s\\n\' "$1" "$2" >> "$HOME/calls"; echo stopped; }',
      '_codex_start_tier() { printf \'_codex_start_tier %s %s\\n\' "$1" "$2" >> "$HOME/calls"; return 0; }',
      ccrcFunction('_inst_codex_tiers'),
      checksFunction('_fix_codex'),
      '_fix_codex; exit $?',
    ].join('\n');
    const wall = isolationManagerStubs(home);
    const env = { PATH: `${wall}:${process.env['PATH'] ?? ''}`, HOME: home, LC_ALL: 'C' };
    assertIsolationWallFirst(env, home);
    const p = spawnSync(BASH, ['-c', harness], { env, encoding: 'utf8' });
    expect(strayManagerCalls(home)).toEqual([]);
    expect(p.status, `${p.stdout}${p.stderr}`).toBe(0);
    const calls = readFileSync(join(home, 'calls'), 'utf8').split('\n').filter(Boolean);
    expect(calls.filter((l) => /^_codex_(stop|start)_tier /.test(l))).toEqual(['_codex_stop_tier codex-a bridge', '_codex_start_tier codex-a bridge']);
    expect(calls.filter((l) => l.startsWith('_codex_tier_ours ') && !l.endsWith(' bridge'))).toEqual([]);
    expect(p.stdout).toContain('FIX codex: restored $HOME/.local/bin/ccgpt-proxy.py from the shipped tree');
    expect(p.stdout).toContain('install: codex tiers: codex-a bridge: restarted — it was running code this install replaced');
    expect(p.stdout).toContain('install: codex tiers: 2 codex lane(s) — 1 restarted, 0 left as they were, 0 not restarted');
  });
});


// ── accounts plan Task A11b: the backups checks (D-5513's backups row; G33) ──────────────────────────────────────
// `secrets-backup-excluded` and `filevault` measure a darwin box, `snapshot-posture` states a Linux box's answer, and
// each SKIPs on the other platform. Driven sourced, with `CCD_OS` set AFTER sourcing (ccrc recomputes it, so the
// whole-run cases measure the host's own arm), and with `tmutil` and `fdesetup` as stubs on a PATH of stubs only, so
// both platforms' arms run on any host. `HEALTHY_SKIPS` counts the other platform's two SKIPs; `healthy()` states
// `none` in `~/.ccrc/snapshot-posture`, so a healthy Linux box PASSes `snapshot-posture`.
describe('A11b: the backups doctor checks (D-5513 backups row, G33)', () => {
  const BACKUP_CHECKS = ['secrets-backup-excluded', 'filevault', 'snapshot-posture'] as const;
  type BackupCheck = typeof BACKUP_CHECKS[number];

  /** A home with the given secret directories, and a stub bin holding only the named tools. */
  const box = (o: { secrets?: Array<'.cc-secrets' | '.ccrc/auth-scratch'>; stubs?: Record<string, string>; posture?: string | 'dir'; postureLinkTo?: string } = {}): string => {
    const home = mkTmp('ccrc-doctor-a11b-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    for (const d of o.secrets ?? []) mkdirSync(join(home, d), { recursive: true, mode: 0o700 });
    const bin = join(home, 'stub-bin');
    mkdirSync(bin, { recursive: true });
    for (const [name, body] of Object.entries(o.stubs ?? {})) {
      writeFileSync(join(bin, name), `#!${BASH}\n${body}\n`, { mode: 0o755 });
    }
    if (o.posture === 'dir') mkdirSync(join(home, '.ccrc', 'snapshot-posture'));
    else if (o.posture !== undefined) writeFileSync(join(home, '.ccrc', 'snapshot-posture'), o.posture);
    if (o.postureLinkTo !== undefined) symlinkSync(join(home, o.postureLinkTo), join(home, '.ccrc', 'snapshot-posture'));
    return home;
  };
  const run = (home: string, check: BackupCheck, os: 'linux' | 'darwin'): Result => {
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; CCD_OS=${os}; _check_${check}`],
      { env: { HOME: home, PATH: join(home, 'stub-bin'), LC_ALL: 'C' }, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  /** `tmutil isexcluded <path>` in the real tool's shape: `[Excluded]` or `[Included]`, padding, then the path. */
  const tmutil = (answer: (p: string) => string): string =>
    `[ "$1" = isexcluded ] || exit 64\ncase "$2" in\n${['.cc-secrets', '.ccrc/auth-scratch']
      .map((d) => `  */${d}) printf '%s    %s\\n' '${answer(d)}' "$2" ;;`).join('\n')}\n  *) exit 65 ;;\nesac`;
  const fdesetup = (out: string): string => `[ "$1" = status ] || exit 64\nprintf '%s\\n' ${shq(out)}`;
  const lines = (s: string): string[] => s.split('\n').filter(Boolean);

  it('the three are in the check table once each, before the pinned delegation-hooks, and each is declared', () => {
    const names = tableNames();
    for (const n of BACKUP_CHECKS) expect(names.filter((x) => x === n), n).toHaveLength(1);
    expect(names.slice(names.indexOf('secrets-backup-excluded'), names.indexOf('secrets-backup-excluded') + 4))
      .toEqual([...BACKUP_CHECKS, 'delegation-hooks']);
  });

  describe('each SKIPs where its platform does not apply', () => {
    it('filevault SKIPs on Linux, even with an fdesetup on PATH that would answer Off', () => {
      const home = box({ secrets: ['.cc-secrets'], stubs: { fdesetup: fdesetup('FileVault is Off.') } });
      const r = run(home, 'filevault', 'linux');
      expect(lines(r.stdout)).toEqual(['SKIP filevault: FileVault is macOS\'s disk encryption; this box is linux']);
      expect(r.code).toBe(3);
    });

    it('secrets-backup-excluded SKIPs on Linux, even with a tmutil on PATH that would answer [Included]', () => {
      const home = box({ secrets: ['.cc-secrets'], stubs: { tmutil: tmutil(() => '[Included]') } });
      const r = run(home, 'secrets-backup-excluded', 'linux');
      expect(lines(r.stdout)).toEqual([
        'SKIP secrets-backup-excluded: Time Machine is macOS\'s; this box is linux, whose provider-level backups snapshot-posture states']);
      expect(r.code).toBe(3);
    });

    it('snapshot-posture SKIPs on darwin, even with secrets and no stated answer', () => {
      const home = box({ secrets: ['.cc-secrets'] });
      const r = run(home, 'snapshot-posture', 'darwin');
      expect(lines(r.stdout)).toEqual([
        'SKIP snapshot-posture: provider-level snapshots are a Linux box\'s question; this box is darwin, whose backups secrets-backup-excluded measures']);
      expect(r.code).toBe(3);
    });
  });

  describe('secrets-backup-excluded (darwin)', () => {
    it('fails when tmutil isexcluded (stubbed) says no: FAIL naming the included directory, its remedy next, rc 1', () => {
      const home = box({ secrets: ['.cc-secrets', '.ccrc/auth-scratch'],
        stubs: { tmutil: tmutil((d) => (d === '.cc-secrets' ? '[Included]' : '[Excluded]')) } });
      const r = run(home, 'secrets-backup-excluded', 'darwin');
      expect(lines(r.stdout)).toEqual([
        'FAIL secrets-backup-excluded: ~/.cc-secrets included in Time Machine backups, so every backup taken holds the lane secrets in them',
        '  remedy: run \'tmutil addexclusion ~/.cc-secrets\' (an account verb that writes a secret does the same); a backup already taken still holds them, and the compromise steps apply to it',
      ]);
      expect(r.code).toBe(1);
      expect(r.stdout.includes(home), 'the verdict names ~/ paths, never the home').toBe(false);
    });

    it('both directories included: the remedy is one runnable addexclusion naming both, space-separated', () => {
      const home = box({ secrets: ['.cc-secrets', '.ccrc/auth-scratch'], stubs: { tmutil: tmutil(() => '[Included]') } });
      const r = run(home, 'secrets-backup-excluded', 'darwin');
      expect(lines(r.stdout)).toEqual([
        'FAIL secrets-backup-excluded: ~/.cc-secrets; ~/.ccrc/auth-scratch included in Time Machine backups, so every backup taken holds the lane secrets in them',
        '  remedy: run \'tmutil addexclusion ~/.cc-secrets ~/.ccrc/auth-scratch\' (an account verb that writes a secret does the same); a backup already taken still holds them, and the compromise steps apply to it',
      ]);
      expect(r.code).toBe(1);
    });

    it('PASSes when tmutil says every secret directory is excluded, naming each', () => {
      const home = box({ secrets: ['.cc-secrets', '.ccrc/auth-scratch'], stubs: { tmutil: tmutil(() => '[Excluded]') } });
      const r = run(home, 'secrets-backup-excluded', 'darwin');
      expect(lines(r.stdout)).toEqual([
        'PASS secrets-backup-excluded: ~/.cc-secrets; ~/.ccrc/auth-scratch excluded from Time Machine (tmutil isexcluded)']);
      expect(r.code).toBe(0);
    });

    it('measures only the directories that exist: ~/.cc-secrets alone, excluded, PASSes naming it alone', () => {
      const home = box({ secrets: ['.cc-secrets'], stubs: { tmutil: tmutil(() => '[Excluded]') } });
      const r = run(home, 'secrets-backup-excluded', 'darwin');
      expect(lines(r.stdout)).toEqual(['PASS secrets-backup-excluded: ~/.cc-secrets excluded from Time Machine (tmutil isexcluded)']);
    });

    it('SKIPs a darwin box with neither secret directory', () => {
      const home = box({ stubs: { tmutil: tmutil(() => '[Included]') } });
      const r = run(home, 'secrets-backup-excluded', 'darwin');
      expect(lines(r.stdout)).toEqual([
        'SKIP secrets-backup-excluded: neither ~/.cc-secrets nor ~/.ccrc/auth-scratch exists on this box, so no lane secret is here to keep out of Time Machine']);
      expect(r.code).toBe(3);
    });

    it('WARNs not measured, never PASSes, when tmutil is not on PATH', () => {
      const home = box({ secrets: ['.cc-secrets'] });
      const r = run(home, 'secrets-backup-excluded', 'darwin');
      expect(lines(r.stdout)).toEqual([
        'WARN secrets-backup-excluded: tmutil is not on PATH, so whether ~/.cc-secrets are excluded from Time Machine was not measured',
        '  remedy: run \'tmutil isexcluded\' on each of them with /usr/bin on PATH',
      ]);
      expect(r.code).toBe(2);
    });

    it('WARNs not measured, never PASSes, when tmutil answers neither word', () => {
      const home = box({ secrets: ['.cc-secrets'], stubs: { tmutil: 'echo "tmutil: isexcluded requires Full Disk Access" >&2; exit 80' } });
      const r = run(home, 'secrets-backup-excluded', 'darwin');
      expect(r.stdout).toMatch(/^WARN secrets-backup-excluded: tmutil isexcluded gave no \[Excluded\] or \[Included\] answer for ~\/\.cc-secrets, so its backup posture was not measured$/m);
      expect(r.stdout).toMatch(/^ {2}remedy: /m);
      expect(r.code).toBe(2);
    });
  });

  describe('filevault (darwin)', () => {
    it('SKIPs a Mac with no lane secret, even with an fdesetup that would answer Off: a fresh install stays green', () => {
      const r = run(box({ stubs: { fdesetup: fdesetup('FileVault is Off.') } }), 'filevault', 'darwin');
      expect(lines(r.stdout)).toEqual([
        'SKIP filevault: neither ~/.cc-secrets nor ~/.ccrc/auth-scratch exists on this box, so no lane secret sits on its disk']);
      expect(r.code).toBe(3);
    });

    it('PASSes FileVault is On.', () => {
      const r = run(box({ secrets: ['.cc-secrets'], stubs: { fdesetup: fdesetup('FileVault is On.') } }), 'filevault', 'darwin');
      expect(lines(r.stdout)).toEqual(['PASS filevault: FileVault is On (fdesetup status)']);
      expect(r.code).toBe(0);
    });

    it('WARNs FileVault is Off. with its remedy: the machine\'s policy, never a FAIL that fails an install', () => {
      const r = run(box({ secrets: ['.cc-secrets'], stubs: { fdesetup: fdesetup('FileVault is Off.') } }), 'filevault', 'darwin');
      expect(lines(r.stdout)).toEqual([
        'WARN filevault: FileVault is Off, so lane secrets on this disk sit unencrypted and any copy of it holds them',
        '  remedy: turn FileVault on in System Settings, Privacy & Security, FileVault (or \'sudo fdesetup enable\')',
      ]);
      expect(r.code).toBe(2);
    });

    it('WARNs a disk that is turning off, though its first line still says On', () => {
      const r = run(box({ secrets: ['.cc-secrets'], stubs: { fdesetup: fdesetup('FileVault is On.\nDecryption in progress: Percent completed = 12') } }), 'filevault', 'darwin');
      expect(r.stdout).toMatch(/^WARN filevault: FileVault is turning off \(fdesetup status: Decryption in progress\)/m);
      expect(r.code).toBe(2);
    });

    it('WARNs not measured when fdesetup is not on PATH, and when it answers neither On nor Off', () => {
      const absent = run(box({ secrets: ['.cc-secrets'] }), 'filevault', 'darwin');
      expect(absent.stdout).toMatch(/^WARN filevault: fdesetup is not on PATH, so whether FileVault is on was not measured$/m);
      expect(absent.code).toBe(2);
      const odd = run(box({ secrets: ['.cc-secrets'], stubs: { fdesetup: fdesetup('Error: unexpected answer') } }), 'filevault', 'darwin');
      expect(odd.stdout).toMatch(/^WARN filevault: fdesetup status answered 'Error: unexpected answer', so whether FileVault is on was not measured$/m);
      expect(odd.code).toBe(2);
    });
  });

  describe('snapshot-posture (Linux): the operator\'s answer, stated, never guessed', () => {
    it('SKIPs a box with no lane secret (a server-role box holds none)', () => {
      const r = run(box(), 'snapshot-posture', 'linux');
      expect(lines(r.stdout)).toEqual([
        'SKIP snapshot-posture: neither ~/.cc-secrets nor ~/.ccrc/auth-scratch exists on this box, so no lane secret is here for a provider image to hold']);
      expect(r.code).toBe(3);
    });

    it('WARNs "not stated" when a box holding secrets has no answer, and says how to state it', () => {
      const r = run(box({ secrets: ['.cc-secrets'] }), 'snapshot-posture', 'linux');
      expect(lines(r.stdout)).toEqual([
        'WARN snapshot-posture: not stated: whether the provider keeps backups or snapshots of this box, which would hold ~/.cc-secrets, is the operator\'s answer, and doctor does not guess it',
        '  remedy: write one line to ~/.ccrc/snapshot-posture: none, or the ones that apply of server-backups server-snapshots volume-snapshots',
      ]);
      expect(r.code).toBe(2);
    });

    it('PASSes a stated none', () => {
      const r = run(box({ secrets: ['.cc-secrets'], posture: '# asked at install\n\nnone\n' }), 'snapshot-posture', 'linux');
      expect(lines(r.stdout)).toEqual(['PASS snapshot-posture: stated: the provider keeps no backups or snapshots of this box']);
      expect(r.code).toBe(0);
    });

    it('PASSes a stated provider image, naming it once each and that the image holds the secrets', () => {
      const r = run(box({ secrets: ['.ccrc/auth-scratch'], posture: 'volume-snapshots server-backups volume-snapshots' }), 'snapshot-posture', 'linux');
      expect(lines(r.stdout)).toEqual([
        'PASS snapshot-posture: stated: volume-snapshots, server-backups; every such image taken while a lane secret existed holds it, and the compromise steps apply to a leaked or restored one']);
      expect(r.code).toBe(0);
    });

    for (const [why, posture] of [['an unknown word', 'nightly'], ['none beside a provider image', 'none server-backups'], ['only comments', '# not answered yet\n']] as const) {
      it(`FAILs ${why}: a mistyped answer never reads as stated`, () => {
        const r = run(box({ secrets: ['.cc-secrets'], posture }), 'snapshot-posture', 'linux');
        expect(r.stdout).toMatch(/^FAIL snapshot-posture: ~\/\.ccrc\/snapshot-posture states (nothing|\d+ words? doctor does not know), which is not none or a list of server-backups server-snapshots volume-snapshots; the line is never quoted$/m);
        expect(r.stdout).toMatch(/^ {2}remedy: write one line to ~\/\.ccrc\/snapshot-posture: /m);
        expect(r.code).toBe(1);
      });
    }

    it('never prints the stated line: a token-shaped or escape-laden line FAILs counting its words, and none of it reaches stdout', () => {
      const token = 'LANE_TOKEN=fixture-secret-value-0123456789';
      const r = run(box({ secrets: ['.cc-secrets'], posture: `${token} \u001b[2Jcleared\n` }), 'snapshot-posture', 'linux');
      expect(lines(r.stdout)[0]).toBe('FAIL snapshot-posture: ~/.ccrc/snapshot-posture states 2 words doctor does not know, which is not none or a list of server-backups server-snapshots volume-snapshots; the line is never quoted');
      expect(r.stdout.includes('fixture-secret-value'), 'the line is never echoed').toBe(false);
      expect(r.stdout.includes('\u001b'), 'no escape byte is echoed').toBe(false);
      expect(r.code).toBe(1);
    });

    it('refuses a symlinked answer file, even one pointing at a readable secret: FAIL, nothing of the target printed', () => {
      const home = box({ secrets: ['.cc-secrets'] });
      writeFileSync(join(home, '.cc-secrets', 'lane-a.env'), 'none\n');
      const linked = box({ secrets: ['.cc-secrets'], postureLinkTo: '.cc-secrets/lane-a.env' });
      writeFileSync(join(linked, '.cc-secrets', 'lane-a.env'), 'LANE_TOKEN=fixture-secret-value-0123456789\n');
      const r = run(linked, 'snapshot-posture', 'linux');
      expect(lines(r.stdout)[0]).toBe('FAIL snapshot-posture: ~/.ccrc/snapshot-posture is a symlink, not a plain file, so doctor does not read it');
      expect(r.stdout.includes('fixture-secret-value')).toBe(false);
      expect(r.code).toBe(1);
      // a symlink to a file that would PASS is refused all the same: the answer lives in the file itself
      symlinkSync(join(home, '.cc-secrets', 'lane-a.env'), join(home, '.ccrc', 'snapshot-posture'));
      expect(lines(run(home, 'snapshot-posture', 'linux').stdout)[0]).toMatch(/^FAIL snapshot-posture: ~\/\.ccrc\/snapshot-posture is a symlink/);
    });

    it('FAILs an answer path that is not a readable file', () => {
      const r = run(box({ secrets: ['.cc-secrets'], posture: 'dir' }), 'snapshot-posture', 'linux');
      expect(r.stdout).toMatch(/^FAIL snapshot-posture: ~\/\.ccrc\/snapshot-posture is not a readable file, so the stated answer cannot be read$/m);
      expect(r.code).toBe(1);
    });
  });

  itLinux('a healthy Linux box, through the whole run: the two darwin checks SKIP and the stated none PASSes', () => {
    const r = runDoctor(healthy('ccrc-doctor-a11b-whole-'));
    expect(anyVerdictFor(r.stdout, 'filevault')).toMatch(/^SKIP filevault: /);
    expect(anyVerdictFor(r.stdout, 'secrets-backup-excluded')).toMatch(/^SKIP secrets-backup-excluded: /);
    expect(anyVerdictFor(r.stdout, 'snapshot-posture')).toBe('PASS snapshot-posture: stated: the provider keeps no backups or snapshots of this box');
    expect(r.code, r.stdout).toBe(0);
  });

  itDarwin('a healthy macOS box, through the whole run: snapshot-posture SKIPs, and the two darwin checks PASS', () => {
    const r = runDoctor(healthy('ccrc-doctor-a11b-whole-mac-'));
    expect(anyVerdictFor(r.stdout, 'snapshot-posture')).toMatch(/^SKIP snapshot-posture: /);
    expect(lineFor(r.stdout, 'filevault')).toBe('PASS filevault: FileVault is On (fdesetup status)');
    expect(lineFor(r.stdout, 'secrets-backup-excluded')).toBe('PASS secrets-backup-excluded: ~/.cc-secrets excluded from Time Machine (tmutil isexcluded)');
    expect(r.code, r.stdout).toBe(0);
  });
});