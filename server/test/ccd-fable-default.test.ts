// server/test/ccd-fable-default.test.ts
// D-6791 (a Claude Code session's shell may not select class fable) and D-6793 (a spawn that names no class on a lane
// whose settings.json defaults to Fable runs Opus).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-fable-default-'); });
afterEach(() => { h.cleanup(); });

const UUID = 'deadbeef-0000-4000-8000-000000000000';
const ID = 'demo-a';
const shStatus = (snippet: string, env: NodeJS.ProcessEnv = {}): { status: number; out: string } => {
  try {
    const out = execFileSync('bash', ['-c', `source "${CCD}"; exec 2>&1; ${snippet}`],
      { encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, { ...process.env, HOME: h.home, ...env }, { systemd: true, tmux: true }) });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};
const seed = (): void => { h.sh(`_reg_set ${ID} wrapper claude; _reg_set ${ID} uuid ${UUID}; _reg_set ${ID} workdir '${h.home}'`); };
const shell = { CCRC_TEST_CLAUDECODE: '1' };

describe('D-6791: class=fable from a Claude Code session shell', () => {
  it('ccd route --set class=fable is refused with fable-operator-only and writes nothing', () => {
    seed();
    const r = shStatus(`cmd_route --session ${ID} --set class=fable`, shell);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('fable-operator-only');
    expect(h.reg(ID, 'class')).toBeNull();
  });
  it('the same call without CLAUDECODE passes (the server for the PWA, the operator\'s own shell)', () => {
    seed();
    expect(shStatus(`cmd_route --session ${ID} --set class=fable`).status).toBe(0);
    expect(h.reg(ID, 'class')).toBe('fable');
  });
  it('another class from a session shell still passes', () => {
    seed();
    expect(shStatus(`cmd_route --session ${ID} --set class=opus`, shell).status).toBe(0);
  });
  it('a --route parse refuses class=fable from a session shell, nothing touched', () => {
    const r = shStatus('_route_argv_check class=fable', shell);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('fable-operator-only');
    expect(shStatus('_route_argv_check class=fable').status).toBe(0);
  });
  it('a stored fable class stays readable from a session shell (the check guards writes, not reads)', () => {
    seed(); h.sh(`_reg_set ${ID} class fable`);
    expect(shStatus(`_route_get ${ID} class`, shell).out).toBe('fable');
  });
});

describe('D-6793: a lane whose settings.json defaults to Fable spawns Opus', () => {
  const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;
  const settings = (j: unknown): void => {
    const d = h.sh('_cfg_dir claude').trim();
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'settings.json'), typeof j === 'string' ? j : JSON.stringify(j));
  };
  const spawnLine = (): string => {
    h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>"$HOME/err" || { cat "$HOME/err" >&2; exit 9; }`);
    return h.calls().filter((c) => c.startsWith('tmux new-session'))[0]!;
  };

  it('no record + model fable: --model opus', () => {
    seed(); settings({ model: 'fable' });
    expect(spawnLine()).toContain(' --model opus ');
  });
  it('class default + the [1m] alias via ANTHROPIC_DEFAULT_<ALIAS>_MODEL: --model opus', () => {
    seed(); h.sh(`_reg_set ${ID} class default`);
    settings({ model: 'best[1m]' });
    expect(spawnLine()).toContain(' --model opus ');
  });
  it('a record naming a class is never overridden', () => {
    seed(); h.sh(`_reg_set ${ID} class sonnet`); settings({ model: 'fable' });
    const line = spawnLine();
    expect(line).toContain(' --model sonnet ');
    expect(line).not.toContain('--model opus');
  });
  it('a non-Fable default, no settings, or unparseable settings: no flag', () => {
    seed();
    settings({ model: 'opus' });
    expect(spawnLine()).not.toContain('--model');
    h.sh('rm -f "$HOME/ccd-calls"');
    settings('{ not json');
    expect(spawnLine()).not.toContain('--model');
  });
  it('the resolver lines are the doctor check\'s (one ladder, two scripts)', () => {
    const lines = (f: string, anchor: string): string[] => fs.readFileSync(path.join(__dirname, '..', '..', 'ccd', f), 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l.startsWith(anchor));
    for (const a of ['if (set(env.ANTHROPIC_MODEL))', 'else if (set(j.model))', 'else if (set(env.ANTHROPIC_DEFAULT_MODEL))', 'const alias = v.trim()', 'const rk = "ANTHROPIC_DEFAULT_"']) {
      expect(lines('ccd', a).length, a).toBeGreaterThan(0);
      expect(lines('ccrc-doctor-checks', a).length, a).toBeGreaterThan(0);
    }
  });
});
