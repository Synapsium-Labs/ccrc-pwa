// `ccrc doctor`, part: codex (D-6767). The doctor suite was one 17,000-line file that held a worker for 661 s; its describe blocks moved
// here unchanged, and the fixtures they share are in `ccrc-doctorFixture.ts`. This part is the codex lane's rows and its usage rows;
// `ccrc-doctor-codex-fix`, `-codex-host` and `-codex-direct.test.ts` hold the rest of what was this one file, which ran about
// 405 s on a CI runner and past the trace job's 1560 s budget under `strace -f`. The helpers those parts share with this one are
// in `ccrc-doctor-codexFixture.ts`.
import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync, chmodSync, existsSync, appendFileSync, lstatSync, readlinkSync, statSync, renameSync, lutimesSync } from 'node:fs';
import { fixClock, fixedNow } from './fixedClock.js';
import { plantShippedTimers, writeShippedTimer } from './shippedTimers.js';
import path, { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { describeLinux, itLinux, IS_DARWIN } from './platformFixtures.js';
import { authDirOf, codexRoster, fakeUnit, GPT_LANE_BINS, laneUnits, plantFakeRuntime, plantCodexUsage, plantForeignUsage, plantLaneAuth, plantSystemd, portAccepts, spawnListener, systemdRunCalls, type Listener, type ListenerAnswer } from './codexLaneFixture.js';
import { AUTH_ROUTES, driverLines, fakeAuthServer, plantBackendCredential, runAuthDriver, type AuthAnswer } from './codexAuthFixture.js';
import { createServer, type Socket } from 'node:net';
import { installDoctorHooks, REPO, CCRC_SRC, CHECKS_SRC, BASH, realPath, Result, stubBin, stub, unstub, linkReal, stubNode, writeRawRoster, binDir, shq, containedPath, doctorEnv, DOCTOR_DEADLINE_BIN, runDoctorBounded, runDoctor, healthy, PY, describeCodex, itCodex, writeLaneModels, renderLane, startedJson, lanePorts, editRosterRow, healthyCodexBox, tableNames, lineFor, noRunnerBugLine } from './ccrc-doctorFixture.js';
import { reEsc, remedyAfter, treeState } from './ccrc-doctor-codexFixture.js';

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
const currentGen = (home: string): string => readlinkSync(join(home, '.ccrc', 'runtime', 'codex', 'current'));

// ── codex-bridge Stage 1, Task 9: the credential rows' fixtures ─────────
/** The credential rows are FAIL lines inside the existing `codex` check: never a WARN (a soak gate allow-lists WARNs
 *  by name), so a case's run carries no `WARN codex:` line at all. */
const expectNoCodexWarn = (out: string): void => {
  expect(out.split('\n').filter((l) => /^WARN codex: /.test(l)), out).toEqual([]);
};

/** A real status file, written by the library's own refresher against a fake token endpoint (ccrcCodexFixture.ts's
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
  // The shipped tree's timers: the rows read the usage timer's cadence from there (W8 Task C8b, D-7054).
  plantShippedTimers(join(home, 'ccrc'));
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

// ── codex bridge Stage 4, Task 5: the runtime row asks whether any lane runs in litellm mode ──────────────────────────
// Only such a lane runs on the LiteLLM runtime. `_dr_cx_runtime` is measured alone, in `usageRows`' bare shell, with
// the question (`_codex_runtime_wanted`, measured against the real roster op in ccrc-codex-bridge.test.ts) answered by
// table and a `ccgpt-runtime` whose `check` answers `absent`, the verdict every case would FAIL on.
describe('doctor: the codex runtime row asks whether a lane needs the runtime (codex bridge Stage 4, Task 5)', () => {
  const runtimeRow = (wanted: 0 | 1 | 2): Result => {
    const home = usageBox('ccrc-doctor-codex-runtime-row-');
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    writeFileSync(join(home, '.local', 'bin', 'ccgpt-runtime'),
      '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$HOME/rt-calls"\necho "ccgpt-runtime: absent"\nexit 1\n', { mode: 0o755 });
    const r = usageRows(home, false, [
      'DRX_CLASS=(); DRX_WHAT=(); DRX_FIX=(); DRX_RUNTIME=""',
      `_codex_runtime_wanted() { return ${wanted}; }`,
      '_dr_cx_runtime; rc=$?; asked=""; [ -f "$HOME/rt-calls" ] && asked="$(< "$HOME/rt-calls")"',
      'printf "rc=%s\\nruntime=%s\\nasked=%s\\n" "$rc" "$DRX_RUNTIME" "$asked"',
      '_dr_cx_report "runtime row measured"; :',
    ].join('\n'));
    return r;
  };

  it('no lane in litellm mode: no finding, the runtime is not asked, and the row says none is needed', () => {
    const r = runtimeRow(1);
    expect(r.stdout).toContain('rc=0\nruntime=not needed (no codex lane runs in litellm mode)\nasked=\n');
    expect(r.stdout).not.toMatch(/^FAIL codex: /m);
  });

  it.each([[0, 'a lane runs in litellm mode'], [2, 'the modes cannot be told']] as const)(
    'wanted %s (%s): an absent runtime is the FAIL it always was', (wanted, _why) => {
      const r = runtimeRow(wanted);
      expect(r.stdout).toContain('asked=check\n');
      expect(r.stdout).toMatch(/^FAIL codex: no isolated LiteLLM runtime is current on this box \(ccgpt-runtime check: absent\)/m);
    });
});

describeCodex('ccrc doctor: codex, part 1 — population, executables, runtime, authDir, ports and lane state (Plan 3a Task 4, spec §12)', () => {
  it('is in the table directly after models', () => {
    const names = tableNames();
    expect(names).toContain('codex');
    expect(names.indexOf('codex')).toBe(names.indexOf('models') + 1);
  });

  it("compares exactly GPT_LANE_BINS — the list ccrc-install-*.test.ts pins to _inst_bins' gate", () => {
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
    const re = /^FAIL codex: codex-a's lane\.json disagrees with what its roster row and class registry render: /m;
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

  // THE BOUND BY MODE (the whole-wave fix round, FR3-1/FR3-2). A lane whose mode cannot be read (`usageBox` plants no
  // lane.json) and a `litellm` lane keep three polls, 2700 s, and the WARNs they had before the bridge, byte for byte;
  // a `direct` lane's row carries the bridge's own stamp, up to BRIDGE_FRESH_S older than its poll, so its bound is
  // 3600 s.
  /** `home`'s lane.json naming `mode`, the one key `_codex_lane_mode` reads; `home` back. */
  const laneMode = (home: string, mode: 'litellm' | 'direct'): string => {
    mkdirSync(join(home, '.ccrc', 'codex', 'codex-a'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'codex', 'codex-a', 'lane.json'), `${JSON.stringify({ bridge: mode, upstream: 'backend' })}\n`);
    return home;
  };
  const MODES = [['whose mode cannot be read', null], ['in litellm mode', 'litellm']] as const;
  it.each(MODES)('a row older than three polls on a lane %s: WARN naming its age and the publisher\'s log', (_what, mode) => {
    const home = usageBox(`ccrc-doctor-usage-stale-${mode ?? 'unread'}-`, { ageS: 2701 });
    const r = usageRows(mode === null ? home : laneMode(home, mode));
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: codex-a: its usage row was last written 45 min ago — more than three of ccrc-codex-usage@codex-a\.timer's polls$/)]);
    expect(r.stdout).toMatch(/^ {2}remedy: read what the publisher says: journalctl --user -u ccrc-codex-usage@codex-a\.service -n 50$/m);
  });

  // Fix round 2 (FR1-M1, D-6898): a direct lane's row ts is when it was measured (the bridge's
  // own stamp), so its WARN says "measured" and counts no polls. Fix round 3 (FR2-4): one second past the bound, the
  // age is rounded UP, so the line never reads "60 min ago — more than 60 min".
  it('a direct lane\'s row measured more than an hour ago: WARN naming its age and the publisher\'s log; under the hour, none', () => {
    const fresh = usageRows(laneMode(usageBox('ccrc-doctor-usage-stale-direct-fresh-', { ageS: 2701 }), 'direct'));
    expect(warns(fresh.stdout), fresh.stdout).toEqual([]);
    expect(fresh.stdout).toMatch(/^note=.*usage row 27\d\ds old$/m);
    const r = usageRows(laneMode(usageBox('ccrc-doctor-usage-stale-direct-', { ageS: 3601 }), 'direct'));
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: codex-a: its usage row was last measured 61 min ago — more than 60 min, so ccrc-codex-usage@codex-a\.timer's recent polls have published nothing$/)]);
    expect(r.stdout).toMatch(/^ {2}remedy: read what the publisher says: journalctl --user -u ccrc-codex-usage@codex-a\.service -n 50$/m);
  });

  // W8 Task C8b's characterization pin (D-7054; ARCH-69 (#804)): each bound one second inside and one second past, on a
  // fixed clock, the whole of what the rows print, byte for byte (the fixture HOME written as `<home>`): three of
  // ccrc-codex-usage@.timer's 15-minute periods (2700 s) on a lane whose mode cannot be read and on a litellm lane, that
  // plus the bridge's BRIDGE_FRESH_S (3600 s) on a direct lane, for a row's age and for a never-published row's link,
  // and the first-poll note that restates the timer's OnActiveSec=5min (kept by name, D-7054). These run unchanged at
  // every commit of the series.
  const clocked = (prefix: string, o: { ageS?: number; linkAgeS: number }, mode: 'litellm' | 'direct' | null): string => {
    const home = usageBox(prefix, o.ageS === undefined ? { row: false } : {});
    const now = fixedNow();
    fixClock(home, stubBin(home), now);
    if (o.ageS !== undefined) {
      writeFileSync(join(home, '.cc-limits', 'codex-a.json'),
        JSON.stringify({ five: null, seven: 12, ts: now - o.ageS, fiveResetAt: null, sevenResetAt: null }));
    }
    lutimesSync(join(home, '.config', 'systemd', 'user', 'timers.target.wants', 'ccrc-codex-usage@codex-a.timer'),
      now - o.linkAgeS, now - o.linkAgeS);
    return mode === null ? home : laneMode(home, mode);
  };
  const rowsOf = (home: string): string[] => usageRows(home).stdout.split(home).join('<home>').split('\n');
  const NOTE_ROWS = (note: string): string[] => [
    'rc=0,0', 'pair=present', 'box-note=', `note=${note}`, `PASS codex: usage rows measured`, '',
  ];
  const WARN_ROWS = (what: string, fix: string): string[] => [
    'rc=0,2', 'pair=present', 'box-note=', 'note=ccrc-codex-usage@codex-a.timer enabled', `WARN codex: ${what}`, `  remedy: ${fix}`, '',
  ];
  const LOG = 'read what the publisher says: journalctl --user -u ccrc-codex-usage@codex-a.service -n 50';
  it.each(MODES)('C8b: a row 2700 s old on a lane %s is fresh, and 2701 s old WARNs, byte for byte', (_what, mode) => {
    expect(rowsOf(clocked('c8b-usage-2700-', { ageS: 2700, linkAgeS: 9000 }, mode)))
      .toEqual(NOTE_ROWS('ccrc-codex-usage@codex-a.timer enabled; usage row 2700s old'));
    expect(rowsOf(clocked('c8b-usage-2701-', { ageS: 2701, linkAgeS: 9000 }, mode)))
      .toEqual(WARN_ROWS('codex-a: its usage row was last written 45 min ago — more than three of ccrc-codex-usage@codex-a.timer\'s polls', LOG));
  });
  it('C8b: a direct lane\'s row 3600 s old is fresh, and 3601 s old WARNs, byte for byte', () => {
    expect(rowsOf(clocked('c8b-usage-direct-3600-', { ageS: 3600, linkAgeS: 9000 }, 'direct')))
      .toEqual(NOTE_ROWS('ccrc-codex-usage@codex-a.timer enabled; usage row 3600s old'));
    expect(rowsOf(clocked('c8b-usage-direct-3601-', { ageS: 3601, linkAgeS: 9000 }, 'direct')))
      .toEqual(WARN_ROWS('codex-a: its usage row was last measured 61 min ago — more than 60 min, so ccrc-codex-usage@codex-a.timer\'s recent polls have published nothing', LOG));
  });
  it.each([...MODES, ['in direct mode', 'direct'] as const])('C8b: no row on a lane %s — the first-poll note inside the bound, byte for byte, and the never-published WARN one second past it', (_what, mode) => {
    const bound = mode === 'direct' ? 3600 : 2700;
    expect(rowsOf(clocked('c8b-usage-norow-young-', { linkAgeS: 120 }, mode)))
      .toEqual(NOTE_ROWS('ccrc-codex-usage@codex-a.timer enabled; no usage row yet (enabled 120s ago; the first poll runs five minutes after enable)'));
    expect(rowsOf(clocked('c8b-usage-norow-bound-', { linkAgeS: bound }, mode)))
      .toEqual(NOTE_ROWS(`ccrc-codex-usage@codex-a.timer enabled; no usage row yet (enabled ${bound}s ago; the first poll runs five minutes after enable)`));
    expect(rowsOf(clocked('c8b-usage-norow-past-', { linkAgeS: bound + 1 }, mode)))
      .toEqual(WARN_ROWS(`codex-a: ccrc-codex-usage@codex-a.timer has been enabled for longer than ${bound / 60} min and this lane has never published a usage row (<home>/.cc-limits/codex-a.json)`, LOG));
  });

  // C8b step 4 (OA-C8c (a), D-7062): an unreadable ccrc-codex-usage@.timer leaves the row's staleness unmeasured — a
  // WARN naming the unit, never a comparison against a literal; ccrc's reader not loaded records a FAIL naming the bug.
  const UNREAD_USAGE = (what: string): string[] => [
    'rc=0,2', 'pair=present', 'box-note=', 'note=ccrc-codex-usage@codex-a.timer enabled',
    `WARN codex: codex-a: ccrc-codex-usage@.timer's cadence could not be read from the shipped unit file (<home>/ccrc/deploy/systemd/ccrc-codex-usage@.timer), so ${what} is unmeasured`,
    '  remedy: the shipped tree at <home>/ccrc is incomplete or damaged — both deploy lanes place the whole tree there, so the next ccrc update (or deploy) restores it; then re-run ccrc doctor',
    '',
  ];
  const noUsageTimer = (home: string): string => { writeShippedTimer(join(home, 'ccrc'), 'ccrc-codex-usage@.timer', null); return home; };
  it.each([[60, null], [2701, null], [2701, 'litellm'], [3601, 'direct']] as const)('C8b: an unreadable ccrc-codex-usage@.timer leaves a row %i s old on a %s lane unmeasured, never compared against a literal', (age, mode) => {
    const home = noUsageTimer(clocked(`c8b-usage-unread-${age}-`, { ageS: age, linkAgeS: 9000 }, mode));
    expect(rowsOf(home)).toEqual(UNREAD_USAGE(`whether this lane's usage row, ${age}s old, is stale`));
  });
  it('C8b: an unreadable ccrc-codex-usage@.timer leaves a missing row unmeasured, young or old', () => {
    for (const link of [120, 9000]) {
      const home = noUsageTimer(clocked(`c8b-usage-unread-norow-${link}-`, { linkAgeS: link }, null));
      expect(rowsOf(home)).toEqual(UNREAD_USAGE('whether this lane\'s first usage row is overdue (none at <home>/.cc-limits/codex-a.json yet)'));
    }
  });
  it('C8b: ccrc\'s timer reader not loaded: the row records a FAIL naming the bug', () => {
    const home = clocked('c8b-usage-unloaded-', { ageS: 2701, linkAgeS: 9000 }, null);
    const r = usageRows(home, false, [
      'DRX_CLASS=(); DRX_WHAT=(); DRX_FIX=()',
      'BOX_TREE_DIR=',
      '_dr_codex_usage_box; b=$?',
      '_dr_codex_usage codex-a; l=$?',
      'printf "rc=%s,%s\\n" "$b" "$l"',
      '_dr_cx_report "usage rows measured"; :',
    ].join('\n'));
    expect(r.stdout.split(home).join('<home>').split('\n')).toEqual([
      'rc=0,1',
      'FAIL codex: codex-a: ccrc\'s own timer reader is not loaded, so whether this lane\'s usage row, 2701s old, is stale was never measured',
      '  remedy: this is a bug in ccrc, not a fact about your box — _check_codex reads ccrc-codex-usage@.timer\'s cadence through _timer_period_s and BOX_TREE_DIR, both declared once in ccrc itself, and this check table was sourced by something that is not ccrc',
      '',
    ]);
  });

  // The doctor's cadence pin went away (ARCH-69 (#804), W8 Task C8b, D-7054): the bounds are no longer constants held
  // against the timer's text, they are read from the shipped timer, so this row MOVES the timer and watches both bounds
  // move. At OnUnitActiveSec=20min a litellm lane's bound is three cycles, 3600 s, and a direct lane's that plus the
  // bridge's freshness window, 4500 s: a direct row one missed poll old must not read stale.
  it('the staleness bounds follow the shipped timer: at 20 min, 3600 s on a litellm lane and 4500 s on a direct one', () => {
    const at20 = (prefix: string, ageS: number, mode: 'litellm' | 'direct'): string => {
      const home = clocked(prefix, { ageS, linkAgeS: 9000 }, mode);
      writeShippedTimer(join(home, 'ccrc'), 'ccrc-codex-usage@.timer',
        readFileSync(join(REPO, 'deploy', 'systemd', 'ccrc-codex-usage@.timer'), 'utf8').replace(/^OnUnitActiveSec=15min$/m, 'OnUnitActiveSec=20min'));
      return home;
    };
    expect(rowsOf(at20('c8b-usage-20m-litellm-3600-', 3600, 'litellm')))
      .toEqual(NOTE_ROWS('ccrc-codex-usage@codex-a.timer enabled; usage row 3600s old'));
    expect(rowsOf(at20('c8b-usage-20m-litellm-3601-', 3601, 'litellm')))
      .toEqual(WARN_ROWS('codex-a: its usage row was last written 60 min ago — more than three of ccrc-codex-usage@codex-a.timer\'s polls', LOG));
    expect(rowsOf(at20('c8b-usage-20m-direct-4500-', 4500, 'direct')), 'a direct row one missed poll old reads stale')
      .toEqual(NOTE_ROWS('ccrc-codex-usage@codex-a.timer enabled; usage row 4500s old'));
    expect(rowsOf(at20('c8b-usage-20m-direct-4501-', 4501, 'direct')))
      .toEqual(WARN_ROWS('codex-a: its usage row was last measured 76 min ago — more than 75 min, so ccrc-codex-usage@codex-a.timer\'s recent polls have published nothing', LOG));
  });

  it('no row yet, the timer enabled moments ago: no WARN, and the note says why', () => {
    const r = usageRows(usageBox('ccrc-doctor-usage-norow-fresh-', { row: false }));
    expect(warns(r.stdout)).toEqual([]);
    expect(r.stdout).toMatch(/^note=.*no usage row yet \(enabled \d+s ago; the first poll runs five minutes after enable\)/m);
  });

  it.each(MODES)('no row, and the timer enabled longer than three polls ago, on a lane %s: WARN — this lane has never published', (_what, mode) => {
    const home = usageBox(`ccrc-doctor-usage-norow-old-${mode ?? 'unread'}-`, { row: false, linkAgeS: 2701 });
    const r = usageRows(mode === null ? home : laneMode(home, mode));
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: codex-a: ccrc-codex-usage@codex-a\.timer has been enabled for longer than 45 min and this lane has never published a usage row \(.*\/\.cc-limits\/codex-a\.json\)$/)]);
  });

  it('a direct lane with no row and its timer enabled more than an hour ago: WARN — never published; under the hour, the note says why', () => {
    const young = usageRows(laneMode(usageBox('ccrc-doctor-usage-norow-direct-young-', { row: false, linkAgeS: 2701 }), 'direct'));
    expect(warns(young.stdout), young.stdout).toEqual([]);
    expect(young.stdout).toMatch(/^note=.*no usage row yet \(enabled 27\d\ds ago; the first poll runs five minutes after enable\)/m);
    const r = usageRows(laneMode(usageBox('ccrc-doctor-usage-norow-direct-old-', { row: false, linkAgeS: 3601 }), 'direct'));
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: codex-a: ccrc-codex-usage@codex-a\.timer has been enabled for longer than 60 min and this lane has never published a usage row \(.*\/\.cc-limits\/codex-a\.json\)$/)]);
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

  // Fix round 3 (FR2-2): a direct lane's row carries the bridge's stamp, up to BRIDGE_FRESH_S older than its poll, so
  // three cycles alone would read a direct lane's row stale after ONE missed poll. The whole-wave fix round (FR3-1):
  // that bound is a direct lane's alone, and a litellm lane (and one whose mode cannot be read) keeps three cycles.
  it('the direct bound\'s bridge window is ccgpt-usage.py\'s BRIDGE_FRESH_S, and the two bounds are defined nowhere at file level', () => {
    const fresh = /^BRIDGE_FRESH_S = (\d+)$/m.exec(readFileSync(join(REPO, 'ccd', 'ccgpt-usage.py'), 'utf8'));
    expect(fresh, 'ccgpt-usage.py no longer spells BRIDGE_FRESH_S as a bare integer — this pin has gone stale').not.toBeNull();
    const src = readFileSync(CHECKS_SRC, 'utf8');
    expect(/^_DR_CODEX_BRIDGE_FRESH_S=(\d+)$/m.exec(src)?.[1]).toBe(fresh![1]);
    expect(src).not.toMatch(/^_DR_CODEX_USAGE_STALE(?:_DIRECT)?_S=/m);
  });
});
