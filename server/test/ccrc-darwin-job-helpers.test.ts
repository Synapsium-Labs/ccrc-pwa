// The Darwin sweep's stay-up helpers, `_ccrc_job_pid` and `_ccrc_job_stayed_up` (centralised update management, wave
// 16: R18(b) and R10j; D-5139, D-5140, D-5141). They serve three callers on a Mac: `_upd_sweep`'s Darwin arm,
// `_inst_enable`'s stay-up check and the update's health gate. No macOS box is centrally managed (design decision 17),
// so the cases run the helpers SOURCED out of the tree's `ccd/ccrc` on Linux, with `_svc_launchctl`, `_svc_domain` and
// `_svc_label` shadowed by shell functions: what is under test is the helpers' own shell, not launchd.
//
// WHICH LEG RUNS WHAT (wave 17, R35(d); D-5327). A case needs only bash, `sleep`, `date +%s`, `grep`, `sed -n`,
// `tail -n 1`, `mv -f` and the shadowed `_svc_*` functions (the poison and stub tools are shell scripts), so it is a
// plain `it` and the macOS leg runs it: J1, J1b, J2 to J5 and the Darwin-arm rows D1 to D3. None of them reads `/proc`,
// a GNU-only option (`macos-platform.test.ts`' GNU-call corpus is the reference: no `stat -c`, `date -d`, `readlink -f`,
// `sed -i`, `timeout`) or `setsid`. J6 stays `itLinux`: it finds the orphaned `sleep` through `survivors` and
// `reapSurvivors`, which walk `/proc/<pid>/environ`, and macOS has no `/proc`. Until a dispatched full run says
// otherwise this is a reading, not a measurement: `sweepFixture.ts` had never run on the macOS leg before these cases.
//
// SAFETY. `sweepFixture.ts`'s fixture HOME and env, built from scratch, with every tool that is not a stub a recording
// POISON (`launchctl` among them), and `assertContained` on the spawn's final env before every spawn. The shadowed
// `_svc_launchctl` never execs a binary. J6, the INT case, leaves the helper's own orphaned background `sleep` behind
// by design: in a `finally`, so a failed assertion still does it, it kills the shell and REAPS any orphaned sleep, and it
// asserts that none survives before any assertion on the run's outcome. It does not show that an orphan existed, only
// that none is left behind.
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { itLinux } from './platformFixtures.js';
import { BASH, CCRC_SRC, assertContained, makeBox, poisonFiles, reapSurvivors, survivors, type Box } from './sweepFixture.js';

/** The shadows. `_svc_launchctl print <domain>/<label>` answers from `$HOME/lc/<label>`, one line per call (the last
 *  repeating): `<rc> <pid>`; rc 0 prints a launchd-shaped record carrying that pid, any other rc prints nothing. Every
 *  call touches `$HOME/lc/called`, so a case can tell when the first pid read has happened. */
const SHADOWS = [
  '_svc_domain() { printf %s gui/501; }',
  '_svc_label() { local x="${1#claude-session@}"; printf %s "app.ccrc.session.${x%.service}"; }',
  '_svc_launchctl() {',
  '  [ "$1" = print ] || return 90',
  '  local f="$HOME/lc/${2##*/}" n=0 line rc',
  '  [ -f "$f.n" ] && IFS= read -r n < "$f.n"',
  '  n=$((n + 1)); echo "$n" > "$f.n"; : > "$HOME/lc/called"',
  '  line=$(sed -n "${n}p" "$f"); [ -n "$line" ] || line=$(tail -n 1 "$f")',
  '  rc="${line%% *}"',
  '  [ "$rc" = 0 ] && printf \'%s\\n\\tpid = %s\\n\\tstate = running\\n\' "{" "${line#* }"',
  '  return "$rc"',
  '}',
].join('\n');

const OUT = 'printf "rc=%s\\nbad=%s\\nwhy=%s\\ndetail=%s\\n" "$rc" "${CCRC_STAYED_BAD[*]}" "${CCRC_STAYED_WHY[*]}" "$CCRC_STAYED_DETAIL"';

interface Plan { [label: string]: string[] }

function box(plan: Plan): Box {
  const b = makeBox({ units: [] });
  mkdirSync(join(b.home, 'lc'), { recursive: true });
  for (const [label, answers] of Object.entries(plan)) writeFileSync(join(b.home, 'lc', `app.ccrc.session.${label}`), answers.join('\n') + '\n');
  return b;
}

function script(body: string): string[] {
  return ['-c', ['. "$1"', SHADOWS, body].join('\n'), 'ccrc-under-test', CCRC_SRC];
}

function run(b: Box, body: string, env: Record<string, string> = {}): { code: number; out: Record<string, string>; stderr: string } {
  const e = { ...b.env, ...env };
  assertContained({ home: b.home, env: e });
  const r = spawnSync(BASH, script(body), { env: e, encoding: 'utf8', timeout: 45_000 });
  const out: Record<string, string> = {};
  for (const l of (r.stdout ?? '').split('\n')) { const k = l.indexOf('='); if (k > 0) out[l.slice(0, k)] = l.slice(k + 1); }
  return { code: r.status ?? -1, out, stderr: r.stderr ?? '' };
}

const U1 = 'claude-session@demo-a.service';
const U2 = 'claude-session@demo-b.service';

describe('_ccrc_job_stayed_up: no unit is a refusal, never a vacuous pass (wave 16, R18(b); D-5140)', () => {
  it('J1 called with no unit, it answers 1 at once, with the globals empty, and never sleeps the settle', () => {
    const b = box({});
    const r = run(b, `s=$SECONDS; _ccrc_job_stayed_up; rc=$?; el=$((SECONDS - s)); ${OUT}; echo "el=$el"`,
      { CCRC_VERIFY_SETTLE: '6', CCRC_VERIFY_WINDOW: '0' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toMatchObject({ rc: '1', bad: '', why: '', detail: '' });
    expect(Number(r.out['el']), 'the helper slept before refusing').toBeLessThanOrEqual(1);
    expect(poisonFiles(b)).toEqual([]);
  }, 60_000);

  it('J1b one unit keeps the contract the gate and _inst_enable read: rc 0 and the one detail', () => {
    const b = box({ 'demo-a': ['0 4242'] });
    const r = run(b, `_ccrc_job_stayed_up ${U1}; rc=$?; ${OUT}`, { CCRC_VERIFY_SETTLE: '0', CCRC_VERIFY_WINDOW: '0' });
    expect(r.out).toMatchObject({ rc: '0', bad: '', detail: 'pid 4242 -> 4242 across 0s+0s' });
  }, 60_000);
});

describe('_ccrc_job_pid: a failed launchctl print is not an unloaded job (wave 16, R10j; D-5141)', () => {
  const ENV = { CCRC_VERIFY_SETTLE: '0', CCRC_VERIFY_WINDOW: '0' };

  it('J2 a print that failed at both reads is UNMEASURED: the job did not stay up, and the detail says why', () => {
    const b = box({ 'demo-a': ['1 -'] });
    const r = run(b, `_ccrc_job_stayed_up ${U1}; rc=$?; ${OUT}`, ENV);
    expect(r.out['rc'], 'two equal failed reads must never read as one stable pid').toBe('1');
    expect(r.out['bad']).toBe(U1);
    expect(r.out['detail']).toBe('pid unmeasured (launchctl print exited 1) -> unmeasured (launchctl print exited 1) across 0s+0s');
  }, 60_000);

  it('J3 a job launchd does not hold (113) keeps its old detail: no pid at either read', () => {
    const b = box({ 'demo-a': ['113 -'] });
    const r = run(b, `_ccrc_job_stayed_up ${U1}; rc=$?; ${OUT}`, ENV);
    expect(r.out).toMatchObject({ rc: '1', bad: U1, detail: 'pid none -> none across 0s+0s' });
  }, 60_000);

  it('J4 a print that failed once, then answered, is still a job that did not stay up, named as unmeasured', () => {
    const b = box({ 'demo-a': ['1 -', '0 4242'] });
    const r = run(b, `_ccrc_job_stayed_up ${U1}; rc=$?; ${OUT}`, ENV);
    expect(r.out).toMatchObject({ rc: '1', bad: U1, detail: 'pid unmeasured (launchctl print exited 1) -> 4242 across 0s+0s' });
  }, 60_000);

  it('J5 in a shared window, only the unmeasured job is listed', () => {
    const b = box({ 'demo-a': ['1 -'], 'demo-b': ['0 5151'] });
    const r = run(b, `_ccrc_job_stayed_up ${U1} ${U2}; rc=$?; ${OUT}`, ENV);
    expect(r.out).toMatchObject({ rc: '1', bad: U1 });
    expect(r.out['why']).toBe('pid unmeasured (launchctl print exited 1) -> unmeasured (launchctl print exited 1) across 0s+0s');
  }, 60_000);
});

describe('_ccrc_job_stayed_up: an INT to the shell alone ends it at once (wave 16, R18(b); D-5139)', () => {
  // A foreground `sleep` makes bash hold an INT sent to the shell alone until the sleep exits (measured: 4.0 s for a
  // `sleep 4`, then the script went on); a `wait` on a background sleep returns at once. The orphaned `sleep` carries
  // the fixture HOME, so `survivors` finds it and `reapSurvivors` ends it.
  const pause = (ms: number): Promise<void> => new Promise((res) => { setTimeout(res, ms); });

  // `itLinux`: `survivors` and `reapSurvivors` walk `/proc/<pid>/environ`, which macOS does not have (the header).
  itLinux.each([
    ['the settle', 'start', { CCRC_VERIFY_SETTLE: '8', CCRC_VERIFY_WINDOW: '0' }],
    ['the window', 'called', { CCRC_VERIFY_SETTLE: '0', CCRC_VERIFY_WINDOW: '8' }],
  ] as const)('J6 an INT during %s ends the run by that signal, well inside the sleep', async (_label, marker, env) => {
    const b = box({ 'demo-a': ['0 4242'] });
    const e = { ...b.env, ...env };
    assertContained({ home: b.home, env: e });
    const child = spawn(BASH, script(`: > "$HOME/lc/start"; _ccrc_job_stayed_up ${U1}; rc=$?; ${OUT}`),
      { env: e, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => {
      child.on('exit', (code, signal) => { res({ code, signal }); });
    });
    let end: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    let elapsed = 0;
    try {
      const deadline = Date.now() + 20_000;
      while (!existsSync(join(b.home, 'lc', marker)) && Date.now() < deadline) await pause(25);
      expect(existsSync(join(b.home, 'lc', marker)), 'the helper never reached the sleep under test').toBe(true);
      await pause(300);
      const sent = Date.now();
      child.kill('SIGINT');
      end = await Promise.race([done, pause(15_000).then(() => null)]);
      elapsed = Date.now() - sent;
    } finally {
      // Always, so a failed assertion above still ends the shell and its sleep (review 512, F4).
      if (end === null) child.kill('SIGKILL');
      reapSurvivors(b);
    }
    expect(survivors(b)).toEqual([]);
    expect(end, 'the shell never exited').not.toBeNull();
    expect(end!.signal, `stdout: ${stdout}`).toBe('SIGINT');
    expect(elapsed, 'the INT waited out the sleep').toBeLessThan(4_000);
    expect(stdout).not.toContain('rc=');
  }, 60_000);
});

// The Darwin arm of `_upd_sweep` RECORDS what it did (wave 17, D-5314, D-5315). Forced on Linux the way the helpers
// above are: `CCD_OS=darwin` and the job lookups shadowed, so what is under test is the sweep's own shell and the
// update's own `_upd_phase`, never launchd. The report is read back after a `done` write, as the update makes it.
describe('_upd_sweep, Darwin arm: the sweep records what it did in update.json (wave 17, D-5314, D-5315)', () => {
  const D1 = 'claude-session@acct-a-demo.service';
  const D2 = 'claude-session@acct-b-demo.service';
  const DSHADOWS = [
    '_svc_domain() { printf %s gui/501; }',
    '_svc_label() { local x="${1#claude-session@}"; printf %s "app.ccrc.session.${x%.service}"; }',
    '_svc_list_sessions() { printf \'%s\\n\' ' + `${D1} ${D2}` + '; }',
    '_svc_plist() { printf \'%s/plists/%s\' "$HOME" "${1#claude-session@}"; }',
    '_svc_is_active() { [ -f "$HOME/failed.${1#claude-session@}" ] && echo failed || echo active; }',
    '_svc_is_loaded() { return 0; }',
    '_svc_try_restart() { return 0; }',
    '_ccrc_job_stayed_up() { return 0; }',
  ].join('\n');

  function sweepRecord(plists: Record<string, string>, failed: string[]): { code: number; stdout: string; j: Record<string, unknown> } {
    const b = makeBox({ units: [], report: { pid: 4242 } });
    mkdirSync(join(b.home, 'plists'), { recursive: true });
    for (const [u, body] of Object.entries(plists)) writeFileSync(join(b.home, 'plists', u.slice('claude-session@'.length)), body);
    for (const u of failed) writeFileSync(join(b.home, `failed.${u.slice('claude-session@'.length)}`), '');
    const e = { ...b.env };
    assertContained({ home: b.home, env: e });
    const body = ['CCD_OS=darwin', 'UPD_REPORTING=1; UPD_REPORT_PID=4242; UPD_REPORT_TARGET=v0.0.85; UPD_FROM=auto; UPD_REPORT_STARTED=1',
      '_upd_sweep; rc=$?', '_upd_phase done', 'exit $rc'].join('\n');
    const r = spawnSync(BASH, ['-c', ['. "$1"', DSHADOWS, body].join('\n'), 'ccrc-under-test', CCRC_SRC],
      { env: e, encoding: 'utf8', timeout: 45_000 });
    expect(poisonFiles(b)).toEqual([]);
    const j = JSON.parse(readFileSync(join(b.home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
    return { code: r.status ?? -1, stdout: r.stdout ?? '', j };
  }
  const KEYED = '<key>AbandonProcessGroup</key><true/>';

  it('D1 a job file with no AbandonProcessGroup records refused: job-file, and detail stays null', () => {
    const r = sweepRecord({ [D1]: KEYED, [D2]: '<plist/>' }, []);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('update: DEGRADED: the supervisor sweep did not run');
    expect(r.j['phase']).toBe('done');
    expect(r.j['detail']).toBeNull();
    expect(r.j['sweep']).toBe('refused: job-file');
  }, 60_000);

  it('D2 a start-limit-failed job is recorded as down, by id', () => {
    const r = sweepRecord({ [D1]: KEYED, [D2]: KEYED }, [D2]);
    expect(r.code).toBe(0);
    expect(r.j['sweep']).toBe('down: 1: acct-b-demo');
    expect(r.j['detail']).toBeNull();
  }, 60_000);

  it('D3 a clean Darwin sweep records ok', () => {
    const r = sweepRecord({ [D1]: KEYED, [D2]: KEYED }, []);
    expect(r.code).toBe(0);
    expect(r.j['sweep']).toBe('ok');
  }, 60_000);
});
