// The Darwin sweep's stay-up helpers, `_ccrc_job_pid` and `_ccrc_job_stayed_up` (centralised update management, wave
// 16: R18(b) and R10j; D-5139, D-5140, D-5141). They serve three callers on a Mac: `_upd_sweep`'s Darwin arm,
// `_inst_enable`'s stay-up check and the update's health gate. No macOS box is centrally managed (design decision 17),
// so the cases run the helpers SOURCED out of the tree's `ccd/ccrc` on Linux, with `_svc_launchctl`, `_svc_domain` and
// `_svc_label` shadowed by shell functions: what is under test is the helpers' own shell, not launchd. Every case is
// `itLinux`: J6 reads `/proc` through `survivors`, and `sweepFixture.ts` has never run on the macOS leg, so this file
// gives that leg no evidence (the plan's Reading 9).
//
// SAFETY. `sweepFixture.ts`'s fixture HOME and env, built from scratch, with every tool that is not a stub a recording
// POISON (`launchctl` among them), and `assertContained` on the spawn's final env before every spawn. The shadowed
// `_svc_launchctl` never execs a binary. J6, the INT case, leaves the helper's own orphaned background `sleep` behind
// by design: it REAPS any orphaned sleep and then asserts that none survives, before any other assertion. It does not
// show that an orphan existed, only that none is left behind.
import { describe, expect } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
  itLinux('J1 called with no unit, it answers 1 at once, with the globals empty, and never sleeps the settle', () => {
    const b = box({});
    const r = run(b, `s=$SECONDS; _ccrc_job_stayed_up; rc=$?; el=$((SECONDS - s)); ${OUT}; echo "el=$el"`,
      { CCRC_VERIFY_SETTLE: '6', CCRC_VERIFY_WINDOW: '0' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toMatchObject({ rc: '1', bad: '', why: '', detail: '' });
    expect(Number(r.out['el']), 'the helper slept before refusing').toBeLessThanOrEqual(1);
    expect(poisonFiles(b)).toEqual([]);
  }, 60_000);

  itLinux('J1b one unit keeps the contract the gate and _inst_enable read: rc 0 and the one detail', () => {
    const b = box({ 'demo-a': ['0 4242'] });
    const r = run(b, `_ccrc_job_stayed_up ${U1}; rc=$?; ${OUT}`, { CCRC_VERIFY_SETTLE: '0', CCRC_VERIFY_WINDOW: '0' });
    expect(r.out).toMatchObject({ rc: '0', bad: '', detail: 'pid 4242 -> 4242 across 0s+0s' });
  }, 60_000);
});

describe('_ccrc_job_pid: a failed launchctl print is not an unloaded job (wave 16, R10j; D-5141)', () => {
  const ENV = { CCRC_VERIFY_SETTLE: '0', CCRC_VERIFY_WINDOW: '0' };

  itLinux('J2 a print that failed at both reads is UNMEASURED: the job did not stay up, and the detail says why', () => {
    const b = box({ 'demo-a': ['1 -'] });
    const r = run(b, `_ccrc_job_stayed_up ${U1}; rc=$?; ${OUT}`, ENV);
    expect(r.out['rc'], 'two equal failed reads must never read as one stable pid').toBe('1');
    expect(r.out['bad']).toBe(U1);
    expect(r.out['detail']).toBe('pid unmeasured (launchctl print exited 1) -> unmeasured (launchctl print exited 1) across 0s+0s');
  }, 60_000);

  itLinux('J3 a job launchd does not hold (113) keeps its old detail: no pid at either read', () => {
    const b = box({ 'demo-a': ['113 -'] });
    const r = run(b, `_ccrc_job_stayed_up ${U1}; rc=$?; ${OUT}`, ENV);
    expect(r.out).toMatchObject({ rc: '1', bad: U1, detail: 'pid none -> none across 0s+0s' });
  }, 60_000);

  itLinux('J4 a print that failed once, then answered, is still a job that did not stay up, named as unmeasured', () => {
    const b = box({ 'demo-a': ['1 -', '0 4242'] });
    const r = run(b, `_ccrc_job_stayed_up ${U1}; rc=$?; ${OUT}`, ENV);
    expect(r.out).toMatchObject({ rc: '1', bad: U1, detail: 'pid unmeasured (launchctl print exited 1) -> 4242 across 0s+0s' });
  }, 60_000);

  itLinux('J5 in a shared window, only the unmeasured job is listed', () => {
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
    const deadline = Date.now() + 20_000;
    while (!existsSync(join(b.home, 'lc', marker)) && Date.now() < deadline) await pause(25);
    expect(existsSync(join(b.home, 'lc', marker)), 'the helper never reached the sleep under test').toBe(true);
    await pause(300);
    const sent = Date.now();
    child.kill('SIGINT');
    const end = await Promise.race([done, pause(15_000).then(() => null)]);
    const elapsed = Date.now() - sent;
    if (end === null) child.kill('SIGKILL');
    reapSurvivors(b);
    expect(survivors(b)).toEqual([]);
    expect(end, 'the shell never exited').not.toBeNull();
    expect(end!.signal, `stdout: ${stdout}`).toBe('SIGINT');
    expect(elapsed, 'the INT waited out the sleep').toBeLessThan(4_000);
    expect(stdout).not.toContain('rc=');
  }, 60_000);
});
