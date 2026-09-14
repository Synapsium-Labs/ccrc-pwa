import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-verb-'); });
afterEach(() => { h.cleanup(); });

/** `h.sh` throws on a non-zero exit, and `cmd_route` refuses through `die`
 *  (exit 1), so refusals are observed through this runner — the
 *  `ccd-spawn-split.test.ts` `shStatus` shape. `exec 2>&1` merges stderr into
 *  the captured text; no `$( )` or `( )` around the snippet, which would
 *  demote the fatal and make the assertion pass either way. */
const shStatus = (snippet: string, env: NodeJS.ProcessEnv = {}): { status: number; out: string } => {
  try {
    const out = execFileSync('bash', ['-c', `source "${CCD}"; exec 2>&1; ${snippet}`],
      { encoding: 'utf8', cwd: h.home,
        env: ghContainedEnv(h.home, { ...process.env, HOME: h.home, ...env }, { systemd: true, tmux: true }) });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

const ID = 'demo-a';
const seed = (): void => { h.sh(`_reg_set ${ID} wrapper claude; _reg_set ${ID} uuid deadbeef-0000-4000-8000-000000000000`); };
const route = (args: string): { status: number; out: string } => shStatus(`cmd_route ${args}`);
const swapLog = (): string => {
  const f = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};

describe('ccd route (routing spec 2026-09-14 §5.3)', () => {
  it('writes one field and says so', () => {
    seed();
    expect(route(`--session ${ID} --set effort=high`)).toEqual({ status: 0, out: `set ${ID} effort=high\n` });
    expect(h.reg(ID, 'effort')).toBe('high');
    expect(swapLog()).toMatch(/route demo-a: effort ∅ -> high/);
  });

  it('writes several fields in one call, recording from and to, actor and reason', () => {
    seed(); h.sh(`_reg_set ${ID} class opus`);
    const r = route(`--session ${ID} --set class=sonnet --set subagent=haiku --actor coordinator:demo-c --reason 'wave 2 is bulk'`);
    expect(r).toEqual({ status: 0, out: `set ${ID} class=sonnet\nset ${ID} subagent=haiku\n` });
    expect(h.reg(ID, 'class')).toBe('sonnet');
    expect(h.reg(ID, 'subagent')).toBe('haiku');
    expect(swapLog()).toMatch(/route demo-a: class opus -> sonnet \[actor=coordinator:demo-c\] \(wave 2 is bulk\)/);
  });

  it('an unrecognised PREVIOUS value is rendered as a byte count, never its bytes (the log is not a channel)', () => {
    seed(); h.sh(`printf '%s' 'gemini\nfake route-reject line' > "$HOME/.cc-sessions/${ID}.class"`);
    expect(route(`--session ${ID} --set class=opus`).status).toBe(0);
    const log = swapLog();
    expect(log).toMatch(/route demo-a: class <29 bytes, unrecognised> -> opus/);
    expect(log).not.toContain('gemini');
    expect(log).not.toContain('fake route-reject');
  });

  it.each([
    ['a value outside the vocabulary', `--session ${ID} --set class=gemini`, /bad value for class \(6 bytes\)/],
    ['an unknown field', `--session ${ID} --set colour=blue`, /unknown routing field 'colour'/],
    ['a ccd-only field', `--session ${ID} --set degraded=opus`, /'degraded' is written by ccd only/],
    ['a --set with no =', `--session ${ID} --set effort`, /bad --set 'effort'/],
    ['no --set at all', `--session ${ID}`, /usage: ccd route/],
    ['no such session', `--session nobody --set effort=high`, /no such session: nobody/],
    ['a bad session id', `--session 'a b' --set effort=high`, /bad session id/],
    ['--apply, which this slice does not have', `--session ${ID} --set effort=high --apply`, /usage: ccd route/],
  ])('%s: refuses with rc 1 and writes NOTHING', (_l, args, msg) => {
    seed();
    const r = route(args);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(msg);
    for (const f of ['class', 'effort', 'subagent', 'degraded', 'colour']) expect(h.reg(ID, f)).toBeNull();
  });

  it('a control character in --reason cannot forge a swap.log line: refused before any write (controller ruling S1-R4)', () => {
    seed();
    const r = shStatus(`cmd_route --session ${ID} --set effort=high --reason $'evil\\nfake route line'`);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/--actor\/--reason must not contain control characters/);
    expect(h.reg(ID, 'effort')).toBeNull();
    expect(swapLog()).toBe('');
  });

  it('refuses the haiku+effort PAIR whether it arrives in one call or across two, and the earlier field stays', () => {
    seed();
    let r = route(`--session ${ID} --set class=haiku --set effort=high`);
    expect(r.status).toBe(1); expect(r.out).toMatch(/class haiku takes no effort level/);
    expect(h.reg(ID, 'class')).toBeNull();
    expect(route(`--session ${ID} --set class=haiku`).status).toBe(0);
    r = route(`--session ${ID} --set effort=high`);
    expect(r.status).toBe(1); expect(r.out).toMatch(/class haiku takes no effort level/);
    expect(h.reg(ID, 'effort')).toBeNull();
    expect(h.reg(ID, 'class')).toBe('haiku');
  });

  it('haiku+auto is not the refused pair — auto is the absent-equivalent (controller ruling S1-R5)', () => {
    seed(); h.sh(`_reg_set ${ID} effort auto`);
    expect(route(`--session ${ID} --set class=haiku`).status).toBe(0);
    expect(h.reg(ID, 'class')).toBe('haiku');
  });

  it('--set effort=auto on a haiku session is accepted', () => {
    seed(); h.sh(`_reg_set ${ID} class haiku`);
    expect(route(`--session ${ID} --set effort=auto`)).toEqual({ status: 0, out: `set ${ID} effort=auto\n` });
    expect(h.reg(ID, 'effort')).toBe('auto');
  });

  it('haiku with a real effort LEVEL is still refused, with the auto-aware message', () => {
    seed(); h.sh(`_reg_set ${ID} class haiku`);
    const r = route(`--session ${ID} --set effort=high`);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/class haiku takes no effort level — set effort=auto or pick another class/);
    expect(h.reg(ID, 'effort')).toBeNull();
  });

  it('a multi-field call is all-or-nothing on validation: one bad value and no field is written', () => {
    seed();
    expect(route(`--session ${ID} --set class=opus --set effort=extreme`).status).toBe(1);
    expect(h.reg(ID, 'class')).toBeNull();
  });

  it('the dispatcher reaches it, and caps advertise the verb and the token', () => {
    seed();
    const r = shStatus(`bash "${CCD}" route --session ${ID} --set workflow=on`);
    expect(r).toEqual({ status: 0, out: `set ${ID} workflow=on\n` });
    expect(h.reg(ID, 'workflow')).toBe('on');
    const caps = h.sh('cmd_caps').split('\n');
    expect(caps).toContain('route');
    expect(caps).toContain('route-v1');
  });
});
