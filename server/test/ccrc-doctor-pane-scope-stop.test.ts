// Doctor's `pane-scope-stop` check (D-7902): the mode of a deliberate stop's pane-scope stop, read from the switch
// `$REG/pane-scope-stop-live` and never written. PASS in both modes, naming the mode (shadow is how it ships); SKIP on
// Darwin, on a server-role box and with no session registry. Fixture HOMEs only (`healthy()`); the check runs alone,
// sourced, as the carry-copies suite runs its own.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PANE_SCOPE_STOP_LIVE_MARKER } from '../../shared/switches.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { BASH, CCRC_SRC, CHECKS_SRC, anyVerdictFor, doctorEnv, healthy, installDoctorHooks, runDoctor, shq } from './ccrc-doctorFixture.js';

removeTmpFixturesEachTest();
installDoctorHooks();

function box(prefix: string, o: { registry?: boolean; env?: string[] } = {}): { home: string; reg: string } {
  const home = healthy(prefix);
  const reg = join(home, '.cc-sessions');
  if (o.registry ?? true) mkdirSync(reg, { recursive: true });
  if (o.env) appendFileSync(join(home, '.ccrc', 'ccrc.env'), o.env.map((l) => `${l}\n`).join(''));
  return { home, reg };
}
function check(home: string, os = 'linux'): { line: string; code: number } {
  const r = spawnSync(BASH, ['-c', `set -uo pipefail\n. ${shq(CCRC_SRC)}\n. ${shq(CHECKS_SRC)}\nCCD_OS=${os}; _check_pane-scope-stop`],
    { env: doctorEnv(home), encoding: 'utf8', timeout: 30_000 });
  const lines = (r.stdout ?? '').split('\n');
  const i = lines.findIndex((l) => /^(PASS|WARN|FAIL|SKIP) pane-scope-stop: /.test(l));
  expect(i, `a pane-scope-stop line: ${r.stdout}${r.stderr}`).toBeGreaterThanOrEqual(0);
  return { line: lines[i]!, code: r.status ?? -1 };
}

describe('pane-scope-stop: the mode, read and never written (D-7902)', () => {
  it('PASS shadow when the switch is absent, and the check writes nothing', () => {
    const b = box('ccrc-doctor-pss-shadow-');
    expect(check(b.home)).toEqual({
      line: 'PASS pane-scope-stop: shadow: a deliberate stop only logs the pane scope it would stop (pane-scope lines in '
        + `${b.reg}/swap.log); arm it in Settings › Automation`,
      code: 0,
    });
    expect(existsSync(join(b.reg, PANE_SCOPE_STOP_LIVE_MARKER))).toBe(false);
  });

  it('PASS live when the switch stands, a dangling link included', () => {
    const b = box('ccrc-doctor-pss-live-');
    writeFileSync(join(b.reg, PANE_SCOPE_STOP_LIVE_MARKER), '');
    expect(check(b.home).line).toMatch(/^PASS pane-scope-stop: live: a deliberate stop \(ccd stop, hibernation, a finished worker\) also stops the session's pane scope/);
    const c = box('ccrc-doctor-pss-link-');
    symlinkSync(join(c.home, 'nowhere'), join(c.reg, PANE_SCOPE_STOP_LIVE_MARKER));
    expect(check(c.home).line).toMatch(/^PASS pane-scope-stop: live: /);
  });

  it('SKIP on Darwin, on a server-role box and with no registry', () => {
    expect(check(box('ccrc-doctor-pss-darwin-').home, 'darwin')).toEqual({
      line: 'SKIP pane-scope-stop: pane scopes are a Linux mechanism — a stop on this box has none to take down', code: 3,
    });
    expect(check(box('ccrc-doctor-pss-server-', { env: ['CCRC_ROLE=server'] }).home).line)
      .toBe('SKIP pane-scope-stop: this box records CCRC_ROLE=server, so it runs no session and no stop');
    expect(check(box('ccrc-doctor-pss-noreg-', { registry: false }).home).line)
      .toBe('SKIP pane-scope-stop: no session registry at ~/.cc-sessions, so no session has been started here to stop');
  });

  it('a full doctor run on the healthy fixture (no registry) SKIPs it', () => {
    const home = healthy('ccrc-doctor-pss-full-');
    expect(anyVerdictFor(runDoctor(home).stdout, 'pane-scope-stop')).toMatch(/^SKIP pane-scope-stop: /);
  });
});
