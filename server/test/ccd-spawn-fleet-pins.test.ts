// server/test/ccd-spawn-fleet-pins.test.ts
//
// D-8173: the operator's rulings of 2026-11-10 (session host research §6.1) ride every spawn's ONE `--settings`:
// `autoContinueAtUsageLimit` false (Q4, ccd always swaps), `crossSessionInbound` "refuse" (Q5), `idleCompaction` true
// (Q6). Fixed values, no knob. Every launch kind is read: a top-level row (the account file's path becomes an inline
// merge), a routed row (the workflow keys), a `.child` row, and a codex-lane wrapper (it execs Claude Code too).
// The substrate is `ccd-spawn-account-settings.test.ts`'s: both spawn lines (`--resume` and the `--session-id` retry).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { makeCcdHarness, ghContainedEnv, ccdSource, CCD, type CcdHarness } from './ccdWsHelpers.js';

const INSTALLER = path.resolve(__dirname, '../../ccd/install-session-hooks.sh');
const PINS = { autoContinueAtUsageLimit: false, crossSessionInbound: 'refuse', idleCompaction: true };
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-fleet-pins-'); });
afterEach(() => { h.cleanup(); });

const install = (): void => {
  execFileSync('bash', [INSTALLER, '--homes'], { env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
};
const seed = (id: string, opts: { child?: boolean; wrapper?: string; route?: string } = {}): void => {
  h.sh(`_reg_set ${id} wrapper ${opts.wrapper ?? 'claude'}
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid ${UUID}${opts.child ? `\n        _reg_set ${id} child 17` : ''}${opts.route ?? ''}`);
};
const spawnBoth = (id: string): string[] => {
  h.sh(`rm -f "$HOME/ccd-calls" "$HOME/pane-up"`);
  spawnSync('bash', ['-c', 'a_src=$A_SRC a_snip=$A_SNIP; unset A_SRC A_SNIP; source "$a_src"; eval "$a_snip"'], {
    env: ghContainedEnv(h.home, { ...h.env(), A_SRC: CCD, A_SNIP: `${RESUME_DIES} _spawn_start ${id} resume` }, { systemd: true, tmux: true, net: true }),
    cwd: h.home, encoding: 'utf8',
  });
  return h.calls().filter((c) => c.startsWith('tmux new-session'));
};
/** The one `--settings` value of a spawn line, parsed (it must be inline JSON, exactly one flag). */
const settingsOf = (l: string): Record<string, unknown> => {
  const all = [...l.matchAll(/--settings '([^']*)'/g)].map((m) => m[1] as string);
  expect(all, l).toHaveLength(1);
  return JSON.parse(all[0]!) as Record<string, unknown>;
};
const expectPins = (lines: string[]): void => {
  expect(lines).toHaveLength(2);
  for (const l of lines) expect(settingsOf(l)).toMatchObject(PINS);
};

describe('the fleet pins ride every launch kind (D-8173)', () => {
  it('names the three keys with the ruled values in ccd, once', () => {
    const src = ccdSource();
    expect(src).toContain(`FLEET_SPAWN_PINS='{"autoContinueAtUsageLimit":false,"crossSessionInbound":"refuse","idleCompaction":true}'`);
    expect(src.match(/^_fleet_spawn_compose\(\)/gm)).toHaveLength(1);
  });
  it('a top-level row carries them next to the account deny rules', () => {
    install(); seed('project-a-calm-mesa');
    const lines = spawnBoth('project-a-calm-mesa');
    expectPins(lines);
    const s = settingsOf(lines[0]!) as { permissions?: { deny?: string[] } };
    expect(s.permissions?.deny?.length ?? 0).toBeGreaterThan(0);
  });
  it('a top-level row carries them when there is no account file at all', () => {
    seed('project-a-calm-mesa');
    expectPins(spawnBoth('project-a-calm-mesa'));
  });
  it('a routed row keeps its workflow keys and gains them', () => {
    install(); seed('project-a-calm-mesa', { route: '\n        _reg_set project-a-calm-mesa effort high\n        _reg_set project-a-calm-mesa workflow on' });
    const lines = spawnBoth('project-a-calm-mesa');
    expectPins(lines);
    expect(settingsOf(lines[0]!)).toMatchObject({ enableWorkflows: true });
  });
  it('a child row carries them', () => {
    install(); seed('project-a-quiet-basin', { child: true });
    expectPins(spawnBoth('project-a-quiet-basin'));
  });
  it('a codex-lane wrapper (it execs Claude Code) carries them', () => {
    install(); seed('project-a-calm-mesa', { wrapper: 'ccrc-codex' });
    expectPins(spawnBoth('project-a-calm-mesa'));
  });
  it('the pin literal is the one spelling a binary read backed (a respelling needs a new read)', () => {
    const m = /^FLEET_SPAWN_PINS='([^']*)'$/m.exec(ccdSource());
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1]!)).toStrictEqual(PINS);
  });
});
