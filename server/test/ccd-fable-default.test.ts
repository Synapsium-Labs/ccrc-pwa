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
  it('class default + the best alias: --model opus', () => {
    seed(); h.sh(`_reg_set ${ID} class default`);
    settings({ model: 'best[1m]' });
    expect(spawnLine()).toContain(' --model opus ');
  });
  it('the alias remap rung: model=custom with env.ANTHROPIC_DEFAULT_CUSTOM_MODEL naming a -fable- id: --model opus', () => {
    seed(); settings({ model: 'custom', env: { ANTHROPIC_DEFAULT_CUSTOM_MODEL: 'claude-fable-5-20260101' } });
    expect(spawnLine()).toContain(' --model opus ');
  });
  it('the remap names a non-Fable id: no flag', () => {
    seed(); settings({ model: 'custom', env: { ANTHROPIC_DEFAULT_CUSTOM_MODEL: 'claude-opus-5' } });
    expect(spawnLine()).not.toContain('--model');
  });
  it('the env.ANTHROPIC_MODEL rung wins over model: Fable there is Opus, an Opus there beats a Fable model', () => {
    seed(); settings({ model: 'opus', env: { ANTHROPIC_MODEL: 'fable' } });
    expect(spawnLine()).toContain(' --model opus ');
    h.sh('rm -f "$HOME/ccd-calls"');
    settings({ model: 'fable', env: { ANTHROPIC_MODEL: 'opus' } });
    expect(spawnLine()).not.toContain('--model');
  });
  it('the full-id rung: a -fable- model id: --model opus', () => {
    seed(); settings({ model: 'claude-fable-5-20260101' });
    expect(spawnLine()).toContain(' --model opus ');
  });
  it('a non-Anthropic lane whose settings default is fable composes no --model', () => {
    seed(); h.sh(`_reg_set ${ID} wrapper gpt`);
    const d = h.sh('_cfg_dir gpt').trim();
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ model: 'fable' }));
    expect(h.sh('_is_anthropic_backend gpt && echo yes || echo no').trim()).toBe('no');
    expect(spawnLine()).not.toContain('--model');
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
  it('the resolver is the doctor check\'s: the whole ladder, env check through the rk remap, line for line', () => {
    const body = (f: string): string[] => {
      const all = fs.readFileSync(path.join(__dirname, '..', '..', 'ccd', f), 'utf8').split('\n').map((l) => l.trim());
      const from = all.findIndex((l) => l.startsWith('const env = j.env'));
      const to = all.findIndex((l, i) => i > from && l.startsWith('const rk = "ANTHROPIC_DEFAULT_"'));
      expect(from, `${f} start`).toBeGreaterThanOrEqual(0);
      expect(to, `${f} end`).toBeGreaterThan(from);
      // The scripts differ only in what they DO with a match (the doctor names the key and writes a message, ccd
      // sets a flag): cut each branch line at that action, so every comparison, the alias line (its `[1m]` suffix
      // regex included) and the rk remap are compared whole.
      return all.slice(from, to + 3)
        .map((l) => l.replace(/\)\s*(\{ key = |v = |said = ).*$/, ')'))
        .filter((l) => /^(const env|const set|const alias|if \(|else if \(|const rk)/.test(l));
    };
    const ccd = body('ccd'); const doctor = body('ccrc-doctor-checks');
    expect(ccd.length).toBeGreaterThan(5);
    expect(ccd).toEqual(doctor);
  });
});
