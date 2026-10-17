/**
 * `interrupt-and-restart-causes-recorded` (D-5237, second half): every process
 * end `ccd` sees is classified and recorded, and the resume prompt the next
 * spawn composes names a recent one.
 *
 * - `_spawn_start` records the pane's scope unit ONCE, after the pane exists
 *   (`$REG/<id>.panescope`, one `/proc` read per spawn and none per tick);
 * - `cmd_supervise`'s `gone` exit classifies the end (`oom` from that scope's
 *   journal, `tmux-server`, `exited`, `unknown`) into `$REG/<id>.lastend` and
 *   an `ended <id>: <cause>` line in `swap.log`;
 * - `cmd_swap` records its own cause before it stops the unit;
 * - `_resume_env <id>` and `_redrive_after_spawn` carry `_resume_prompt_for`'s
 *   composed prompt, which names a cause at most 10 minutes old;
 * - `_route_escape` logs each Escape before it sends it.
 *
 * Fixture HOME only (`makeCcdHarness`); tmux, systemctl and journalctl are
 * shell functions, and `/proc` is a planted tree behind `_panescope_proc_root`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { RESTART_CAUSES, RESUME_PROMPT_PREFIX } from '../../shared/api.js';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-restart-cause-'); });
afterEach(() => { h.cleanup(); });

const ID = 'lane-a-project-a';
const UUID = 'b7001948-2222-4bcc-b60b-0cfc0dc3d199';
const SCOPE = 'tmux-spawn-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.scope';
const PANE_PID = '4242';

const reg = (f: string): string => path.join(h.home, '.cc-sessions', `${ID}.${f}`);
const swapLog = (): string => {
  const p = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
const nowS = (): number => Math.floor(Date.now() / 1000);

/** A planted `/proc/<pane pid>/cgroup` naming the pane's scope, and the seam
 *  pointed at it; every read through the seam is logged (`procread`). */
const PROC = `_panescope_proc_root() { echo procread >> "$HOME/ccd-calls"; printf '%s' "$HOME/proc"; };`;
const plantProc = (): void => {
  const d = path.join(h.home, 'proc', PANE_PID);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'cgroup'),
    `0::/user.slice/user-1000.slice/user@1000.service/app.slice/${SCOPE}\n`);
};
const procReads = (): number => h.calls().filter((l) => l === 'procread').length;

/** `cmd_supervise` as a PROGRAM, bounded (the `ccd-substrate.test.ts` idiom). */
const run = (snippet: string): { code: number; stderr: string } => {
  const r = spawnSync('bash', ['-c', `source "${CCD}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home, timeout: 15000,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
  });
  return { code: r.status ?? 1, stderr: r.stderr ?? '' };
};
/** The probe answers from the list, then `gone` forever (the loop's one exit). */
const seq = (...v: string[]): string =>
  `_i=0; _seq=(${v.map((x) => `'${x}'`).join(' ')}); _session_probe() {
     local x="\${_seq[$_i]:-gone}"; _i=$((_i+1)); PROBE_VERDICT="$x"; PROBE_DETAIL=""; PROBE_SUBSTRATE=present; }`;
/** The loop's collaborators, quiet. `tmux list-sessions` answers `$LS_RC`;
 *  `journalctl` records its argv and prints `$JOURNAL_OUT`, exiting `$JOURNAL_RC`. */
const LOOP = (o: { lsRc?: number; journalOut?: string; journalRc?: number } = {}): string =>
  `systemctl() { :; }; launchctl() { :; }; sleep() { :; }
   cmd_ensure() { :; }; _sync_uuid() { :; }; _auto_stale_check() { :; }; _auto_swap_check() { :; }
   _auto_compact_check() { :; }; _route_apply_check() { :; }
   tmux() { case "$1" in -V) echo 'tmux 3.4' ;; list-sessions) return ${o.lsRc ?? 0} ;;
     list-panes) echo ${PANE_PID} ;; *) return 1 ;; esac; }
   journalctl() { echo "journalctl $*" >> "$HOME/ccd-calls"; printf '%s' ${JSON.stringify(o.journalOut ?? '')}; return ${o.journalRc ?? 0}; }
   ${PROC}`;
const OOM_LINE = `Oct 15 22:15:01 host systemd[1]: ${SCOPE}: A process of this unit has been killed by the OOM killer.`;
const supervise = (o: Parameters<typeof LOOP>[0] = {}, pre = ''): ReturnType<typeof run> => {
  fs.writeFileSync(reg('panescope'), SCOPE);
  return run(`${LOOP(o)} ${pre} ${seq('live', 'live', 'live', 'gone')}; cmd_supervise ${ID}`);
};
const lastEnd = (): string | null => (fs.existsSync(reg('lastend')) ? fs.readFileSync(reg('lastend'), 'utf8') : null);

describe('the supervise loop classifies the end it exits on (D-5237)', () => {
  it('an OOM line in the pane scope journal reads oom, in lastend and swap.log', () => {
    const r = supervise({ journalOut: OOM_LINE });
    expect(r.stderr).toContain('ended; exiting for systemd restart');
    expect(lastEnd()).toMatch(/^\d+ oom$/);
    expect(Math.abs(Number(lastEnd()!.split(' ')[0]) - nowS())).toBeLessThan(30);
    expect(swapLog()).toMatch(new RegExp(`ended ${ID}: oom\\n`));
    const j = h.calls().find((l) => l.startsWith('journalctl'))!;
    expect(j).toContain(`--user -u ${SCOPE}`);
    expect(j).toMatch(/--since @\d+ -q -g killed by the OOM killer -n 1 --no-pager/);
    const since = Number(/--since @(\d+)/.exec(j)![1]);
    expect(Math.abs(nowS() - 120 - since)).toBeLessThan(30);
  });
  it('tmux list-sessions failing, with no OOM line, reads tmux-server', () => {
    supervise({ lsRc: 1 });
    expect(lastEnd()).toMatch(/^\d+ tmux-server$/);
    expect(swapLog()).toContain(`ended ${ID}: tmux-server`);
  });
  it('neither reads exited', () => {
    supervise();
    expect(lastEnd()).toMatch(/^\d+ exited$/);
  });
  it('a journal read that times out (124) reads unknown', () => {
    supervise({ journalRc: 124 });
    expect(lastEnd()).toMatch(/^\d+ unknown$/);
  });
  it('no recorded scope reads unknown on Linux (no journal to read) and exited on macOS (none to have)', () => {
    const cause = (os: string): string =>
      h.sh(`${LOOP()} CCD_OS=${os}; _end_cause ${ID}`);
    expect(cause('linux')).toBe('unknown');
    expect(cause('darwin')).toBe('exited');
    expect(h.calls().some((l) => l.startsWith('journalctl'))).toBe(false);
  });
  it('a swap end recorded in the last minute is kept: the swap stopped this unit, not the process', () => {
    fs.writeFileSync(reg('lastend'), `${nowS() - 5} swap-manual`);
    supervise();
    expect(lastEnd()).toMatch(/^\d+ swap-manual$/);
    expect(swapLog()).not.toContain(`ended ${ID}:`);
  });
  it('an older swap end is not: the process died on its own since', () => {
    fs.writeFileSync(reg('lastend'), `${nowS() - 600} swap-manual`);
    supervise();
    expect(lastEnd()).toMatch(/^\d+ exited$/);
  });
  it('an oom end appends to oomends, pruned to the last 10 minutes', () => {
    const n = nowS();
    fs.writeFileSync(reg('oomends'), `${n - 900}\n${n - 300}`);
    supervise({ journalOut: OOM_LINE });
    const lines = fs.readFileSync(reg('oomends'), 'utf8').split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(String(n - 300));
    expect(Math.abs(Number(lines[1]) - nowS())).toBeLessThan(30);
  });
  it('the tick reads no /proc: the scope is read once per spawn, never per tick (#387)', () => {
    supervise();
    expect(procReads()).toBe(0);
  });
});

describe('_spawn_start records the pane scope once (D-5237)', () => {
  const SPAWN_TMUX = `sleep() { :; }; tmux() { echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in new-session) : > "$HOME/pane-up" ;; has-session) [[ -e "$HOME/pane-up" ]] ;;
        list-panes) echo ${PANE_PID} ;; capture-pane) printf '? for shortcuts' ;; esac; };`;
  const seed = (): void => {
    h.sh(`_reg_set ${ID} wrapper claude
          _reg_set ${ID} workdir '${h.home}'
          _reg_set ${ID} uuid ${UUID}`);
  };
  it('writes the scope unit from one /proc read', () => {
    seed(); plantProc();
    h.sh(`${SPAWN_TMUX} ${PROC} _spawn_start ${ID} resume`);
    expect(h.reg(ID, 'panescope')).toBe(SCOPE);
    expect(procReads()).toBe(1);
    const lp = h.calls().filter((l) => l.startsWith('tmux list-panes'));
    expect(lp).toEqual([`tmux list-panes -t =cc-${ID}: -F #{pane_pid}`]);
  });
  it('a cgroup that names no scope leaves no panescope (a stale one is removed)', () => {
    seed(); plantProc();
    fs.writeFileSync(path.join(h.home, 'proc', PANE_PID, 'cgroup'), '0::/user.slice\n');
    fs.writeFileSync(reg('panescope'), 'tmux-spawn-stale.scope');
    h.sh(`${SPAWN_TMUX} ${PROC} _spawn_start ${ID} resume`);
    expect(h.reg(ID, 'panescope')).toBeNull();
  });
  it('no /proc tree (macOS has none) leaves no panescope', () => {
    seed();
    h.sh(`${SPAWN_TMUX} ${PROC} _spawn_start ${ID} resume`);
    expect(procReads()).toBe(1);
    expect(h.reg(ID, 'panescope')).toBeNull();
  });
});

describe('cmd_swap records its cause before it stops the unit (D-5237)', () => {
  /** `systemctl stop` kills the shell outright: whatever is not on disk by
   *  then was written after the stop. */
  const SWAP = `systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; case "$*" in *stop*) kill -9 $$ ;; esac; };
    launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; case "$*" in *bootout*) kill -9 $$ ;; esac; };
    tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; }; sleep() { :; };`;
  const seed = (): void => {
    const wd = path.join(h.home, 'projects', 'project-a');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set ${ID} uuid ${UUID}
      _reg_set ${ID} wrapper claude
      _reg_set ${ID} project project-a
      _reg_set ${ID} workdir ${wd}`);
    const mdir = fs.realpathSync(wd).replace(/[/._]/g, '-');
    const dir = path.join(h.home, '.claude', 'projects', mdir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${UUID}.jsonl`), 'HISTORY\n');
  };
  const swap = (env: Record<string, string> = {}): void => {
    try { h.sh(`${SWAP} cmd_swap ${ID} claude-d`, { TMUX: '', ...env }); } catch { /* killed at the stop */ }
  };
  it('a manual swap writes swap-manual before the stop', () => {
    seed(); swap();
    expect(h.calls().some((l) => /stop|bootout/.test(l))).toBe(true);
    expect(lastEnd()).toMatch(/^\d+ swap-manual$/);
    expect(swapLog()).toContain(`ended ${ID}: swap-manual`);
  });
  it.each([
    ['home', 'swap-auto-home'], ['rescue', 'swap-auto-rescue'], ['', 'swap-auto'],
  ])('an automatic swap with arm %j writes %s', (arm, cause) => {
    seed(); swap({ CCD_SWAP_AUTO: '1', CCD_SWAP_ARM: arm });
    expect(lastEnd()).toBe(lastEnd()!.split(' ')[0] + ' ' + cause);
  });
  it('a refused swap records no end', () => {
    seed();
    fs.rmSync(path.join(h.home, '.claude', 'projects'), { recursive: true });   // no transcript: refused
    swap();
    expect(h.calls().some((l) => /stop|bootout/.test(l))).toBe(false);
    expect(lastEnd()).toBeNull();
  });
});

describe('the resume prompt names a recent cause (D-5237)', () => {
  const prompt = (le: string | null, oomends: string | null = null): string => {
    if (le !== null) fs.writeFileSync(reg('lastend'), le);
    if (oomends !== null) fs.writeFileSync(reg('oomends'), oomends);
    return h.sh(`_resume_prompt_for ${ID}`);
  };
  const generic = (): string => h.sh(`printf '%s' "$RESUME_PROMPT"`);

  it('an oom end 2 minutes old, with two more in the last 10 minutes, names out of memory and 3', () => {
    const n = nowS();
    const p = prompt(`${n - 120} oom`, `${n - 900}\n${n - 500}\n${n - 300}\n${n - 120}`);
    expect(p).toContain('out of memory');
    expect(p).toMatch(/\b3 out-of-memory restarts\b/);
    expect(p).toContain('do not re-run the step that was running at the same parallelism');
    expect(p).not.toContain('an account swap or a supervisor revival');
  });
  it('an oom end 11 minutes old reads the generic wording', () => {
    expect(prompt(`${nowS() - 660} oom`)).toBe(generic());
  });
  it('no lastend, or a malformed one, reads the generic wording', () => {
    expect(prompt(null)).toBe(generic());
    expect(prompt('garbage line')).toBe(generic());
  });
  it.each(RESTART_CAUSES)('cause %s: starts with Claude Code\'s first sentence, names the cause, no single quote', (cause) => {
    const p = prompt(`${nowS() - 30} ${cause}`, `${nowS() - 30}`);
    expect(p.startsWith(RESUME_PROMPT_PREFIX)).toBe(true);
    expect(p).not.toContain("'");
    expect(p).not.toBe(generic());
    expect(p).toContain('Any background task, Workflow or subagent of the previous process is gone');
  });
  it('an unknown cause word reads as unknown, never as the generic wording', () => {
    expect(prompt(`${nowS() - 30} cosmic-ray`)).toBe(prompt(`${nowS() - 30} unknown`));
  });
  it('_resume_env <id> carries the composed prompt; bare, the generic one', () => {
    fs.writeFileSync(reg('lastend'), `${nowS() - 60} oom`);
    expect(h.sh(`_resume_env ${ID}`)).toContain('out of memory');
    expect(h.sh('_resume_env')).toContain(`CLAUDE_CODE_RESUME_PROMPT='${generic()}'`);
  });
  it('a spawn after an oom end carries the composed prompt on its tmux line', () => {
    h.sh(`_reg_set ${ID} wrapper claude
          _reg_set ${ID} workdir '${h.home}'
          _reg_set ${ID} uuid ${UUID}`);
    fs.writeFileSync(reg('lastend'), `${nowS() - 60} oom`);
    h.sh(`sleep() { :; }; tmux() { echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in new-session) : > "$HOME/pane-up" ;; has-session) [[ -e "$HOME/pane-up" ]] ;; esac; };
      _spawn_start ${ID} resume`);
    const line = h.calls().find((l) => l.startsWith('tmux new-session'))!;
    expect(line).toContain("CLAUDE_CODE_RESUME_PROMPT='Continue from where you left off. Note: ccd restarted this session (its pane ran out of memory");
  });
});

describe('_route_escape logs each Escape before it sends it (D-5237)', () => {
  it('route-escape <id> is in swap.log when the Escape goes out', () => {
    h.sh(`sleep() { :; }; tmux() { echo "tmux $*" >> "$HOME/ccd-calls"
        [[ "$1" == send-keys ]] && grep -c "route-escape ${ID}" "$REG/swap.log" >> "$HOME/esc-seen" 2>/dev/null; return 0; }
      _route_escape ${ID}`);
    expect(h.calls()).toContain(`tmux send-keys -t =cc-${ID}: Escape`);
    expect(fs.readFileSync(path.join(h.home, 'esc-seen'), 'utf8').trim()).toBe('1');
  });
});
