/**
 * The graceful stop, in shadow, at the three stop-then-resume sites (session-continuity 6a).
 *
 * `cmd_swap`, `_watchdog_resume_run` and `cmd_hibernate` read the pane's process before the kill and time its exit
 * from a detached observer after it (SHADOW). `$REG/graceful-stop-live`, which nothing in the tree writes, makes the
 * stop send SIGTERM first and wait up to `GRACEFUL_STOP_TERM_WAIT_S` (LIVE). Each outcome is one `graceful-stop` line
 * in swap.log: `(exited|alive)=<ms>`, `no-pid`, `gone-before-signal`, or `unmeasured=<why>`.
 *
 * FIXTURE ONLY: HOME is the harness's (`makeCcdHarness`). The pane process is a real `bash -c` job started INSIDE each
 * case's snippet (`h.sh` is `execFileSync`: while the verb runs, Node's event loop is blocked, so a Node child would
 * stay a zombie after it exits and `kill -0` would keep answering for it). `tmux` is a shell function of the snippet
 * that answers that one pid and hangs it up on `kill-session`, as the terminal's hang-up does. Only that process is
 * ever signalled.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ccdSource, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
const ID = 'lane-a-project-a';
const UUID = 'b7001948-2222-4bcc-b60b-0cfc0dc3d199';

const fx = (...p: string[]): string => path.join(h.home, 'fx', ...p);
const reg = (f: string): string => path.join(h.home, '.cc-sessions', f);
const arm = (): void => { fs.writeFileSync(reg('graceful-stop-live'), ''); };
const signals = (): string[] => (fs.existsSync(fx('signals')) ? fs.readFileSync(fx('signals'), 'utf8').split('\n').filter(Boolean) : []);
const gs = (): string[] => (fs.existsSync(reg('swap.log')) ? fs.readFileSync(reg('swap.log'), 'utf8') : '')
  .split('\n').filter((l) => l.includes(' graceful-stop ')).map((l) => l.slice(l.indexOf('graceful-stop ')));
const panePid = (): number => Number(fs.readFileSync(fx('pane-pid'), 'utf8').trim());
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

type Handler = 'exit' | 'ignore' | 'slow' | 'silent';
interface Pane { term?: Handler; hup?: Handler }
/** The handlers set a flag the loop reads, rather than exit: two signals pending together (a TERM, then the kill's HUP)
 *  are both recorded, since bash runs HUP's trap before TERM's and an `exit` there would hide the second. */
/** The snippet that starts the pane process (a job of the snippet's own bash) and waits until its traps stand. */
const PANE = (p: Pane = {}): string => {
  const body = (name: string, hd: Handler | undefined): string => {
    const rec = `echo ${name} >> $HOME/fx/signals`;
    switch (hd ?? 'exit') {
      case 'ignore': return `${rec}`;
      case 'slow': return `${rec}; sleep 0.3; d=1`;
      case 'silent': return 'd=1';
      default: return `${rec}; d=1`;
    }
  };
  return `mkdir -p "$HOME/fx"
  bash -c 'trap "${body('TERM', p.term)}" TERM; trap "${body('HUP', p.hup)}" HUP; : > "$HOME/fx/ready"; while [ -z \"\$d\" ]; do sleep 0.05; done' >/dev/null 2>&1 </dev/null &
  echo $! > "$HOME/fx/pane-pid"
  until [ -f "$HOME/fx/ready" ]; do sleep 0.02; done`;
};
/** tmux as a function of the snippet: logs, answers the pane's pid (unless there is none), hangs it up on kill-session. */
const TMUX = `tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "$1" in
      list-panes) [ -f "$HOME/fx/no-pane" ] || cat "$HOME/fx/pane-pid"; return 0 ;;
      display-message) echo 0; return 0 ;;
      kill-session) kill -HUP "$(cat "$HOME/fx/pane-pid")" 2>/dev/null; return 0 ;;
    esac
    return 0
  }`;
const STUBS = `_svc_stop() { echo "svc-stop $*" >> "$HOME/ccd-calls"; }
  cmd_ensure() { echo "ensure $*" >> "$HOME/ccd-calls"; }
  _operator_choice_keep() { echo "choice-keep $*" >> "$HOME/ccd-calls"; }
  ${TMUX}`;
const INLINE = '_pane_scope_detach() { "$@"; }';
/** `_ci_proc_start` wrapped: `body` decides per call (counter `_CIN`, 1-based) and may call `_ci_proc_start_real`. */
const WRAP_PSTART = (body: string): string => `eval "$(declare -f _ci_proc_start | sed '1s/_ci_proc_start/_ci_proc_start_real/')"
  _CIN=0
  _ci_proc_start() { _CIN=$((_CIN + 1)); ${body}; }`;

interface Run { realDetach?: boolean; pane?: Pane; env?: string; pre?: string; verb?: string }
/** One case: start the pane, plant the stubs, run the verb (default: `_watchdog_resume_run`). */
const run = (r: Run = {}): string => h.sh(`${PANE(r.pane)}
  ${STUBS}
  ${r.realDetach ? '' : INLINE}
  GRACEFUL_STOP_OBSERVE_S=2 GRACEFUL_STOP_TERM_WAIT_S=2
  ${r.env ?? ''}
  ${r.pre ?? ''}
  ${r.verb ?? `_watchdog_resume_run ${ID}`}`);
const order = (names: RegExp[]): number[] => {
  const c = h.calls();
  return names.map((re) => c.findIndex((l) => re.test(l)));
};

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-graceful-stop-'); });
afterEach(() => {
  if (fs.existsSync(fx('pane-pid'))) { try { process.kill(panePid(), 'SIGKILL'); } catch { /* already gone */ } }
  h.cleanup();
});

describe.skipIf(process.platform !== 'linux')('the graceful stop (session-continuity 6a)', () => {
  it('shadow: no marker sends no signal; the pane process sees only the kill\'s hang-up', () => {
    run();
    expect(signals()).toEqual(['HUP']);
    const [svc, read, kill, ensure] = order([/^svc-stop /, /^tmux list-panes -t /, /^tmux kill-session /, /^ensure /]);
    expect([svc, read, kill, ensure].every((i) => i >= 0), h.calls().join('\n')).toBe(true);
    expect(svc).toBeLessThan(read!); expect(read).toBeLessThan(kill!); expect(kill).toBeLessThan(ensure!);
    expect(gs()).toEqual([expect.stringMatching(/^graceful-stop lane-a-project-a: site=limit-resume mode=shadow exited=\d+$/)]);
  });

  it('shadow: a pane process that outlives the window is alive=<window>', () => {
    run({ pane: { hup: 'ignore' }, env: 'GRACEFUL_STOP_OBSERVE_S=1' });
    expect(gs()).toEqual([`graceful-stop ${ID}: site=limit-resume mode=shadow alive=1000`]);
  });

  describe('through cmd_hibernate', () => {
    const seed = (): void => {
      h.sh(`_reg_set ${ID} wrapper claude
            _reg_set ${ID} workdir '${h.home}'
            _reg_set ${ID} uuid ${UUID}`);
      fs.writeFileSync(reg(`${ID}.turn.json`), `{"state":"done","bg":0,"crons":0,"stopAt":${Date.now() - 3 * 3600_000}}\n`);
    };
    const HIB = `_pane_for_keystroke() { KS_PANE='%1'; return 0; }; _idle_for_keystroke() { return 0; }
  cmd_hibernate ${ID}`;
    const pstartOf = (pid: number): string => {
      const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      return s.slice(s.lastIndexOf(') ') + 2).split(' ')[19]!;
    };

    it('shadow: the observer is detached; the stop does not wait for it', () => {
      seed();
      const out = run({
        pane: { hup: 'ignore' }, realDetach: true,
        // the REAL `_pane_scope_detach`, against a recording `_svc_run_detached`; `_graceful_stop_after` is timed
        pre: `_svc_run_detached() { echo "detached $*" >> "$HOME/ccd-calls"; }
  eval "$(declare -f _graceful_stop_after | sed '1s/_graceful_stop_after/_graceful_stop_after_real/')"
  _graceful_stop_after() { local a; a=$(_plat_epoch_ms); _graceful_stop_after_real "$@"; echo "after-ms $(( $(_plat_epoch_ms) - a ))" >> "$HOME/ccd-calls"; }`,
        verb: HIB,
      });
      expect(out).toContain(`hibernated ${ID}`);
      const pid = panePid();
      const cmd = h.calls().find((l) => l.startsWith('detached bash -c')) ?? '';
      expect(cmd).toMatch(new RegExp(`'_graceful_stop_observe' '${ID}' 'hibernate' '${pid}' '[0-9]+' '[0-9]{13}'`));
      expect(cmd).toContain(`'${pid}' '${pstartOf(pid)}' `);
      const ms = Number((h.calls().find((l) => l.startsWith('after-ms ')) ?? '').slice(9));
      expect(ms).toBeLessThan(1000);
      expect(alive(pid), 'the pane process (hang-up ignored) still runs').toBe(true);
      expect(gs()).toEqual([]);   // the observer was only recorded, not run
    });

    it('hibernate: the graceful stop reuses D-7902\'s read, and the scope stop is unchanged', () => {
      seed();
      const STUB = (n: string): string => `_POS_N=0
  _pane_scope_of() {
    _POS_N=$((_POS_N + 1)); echo "scope-of $_POS_N" >> "$HOME/ccd-calls"
    if (( _POS_N == 1 )); then PANE_SCOPE_PID="$(cat "$HOME/fx/pane-pid")"; PANE_SCOPE_CG="/u/$PANE_SCOPE_SLICE/tmux-spawn-a.scope"; PANE_SCOPE_UNIT=tmux-spawn-a.scope; PANE_SCOPE_WEDGED=""
    else PANE_SCOPE_PID=''; PANE_SCOPE_CG=''; PANE_SCOPE_UNIT=''; PANE_SCOPE_WEDGED=1; fi
  }
  _pane_scope_reap() { echo "reap $*" >> "$HOME/ccd-calls"; }
  _pane_scope_note() { echo "note $*" >> "$HOME/ccd-calls"; }${n}`;
      run({ pre: STUB(''), verb: HIB });
      const c = h.calls();
      expect(c.filter((l) => l.startsWith('scope-of '))).toEqual(['scope-of 1']);
      expect(c).toContain(`reap ${ID} ${panePid()} /u/app-claude\\x2dsession.slice/tmux-spawn-a.scope`);
      expect(c.filter((l) => l.startsWith('note ') && l.includes('held: tmux did not answer'))).toEqual([]);
      expect(gs()).toEqual([expect.stringMatching(/^graceful-stop lane-a-project-a: site=hibernate mode=shadow exited=\d+$/)]);
      // CONTROL: the same stubs with a second read by hand before `_pane_scope_stop` give the `held:` note, so the wedge is real.
      h.sh(`${STUB('')}
  _pane_scope_of ${ID}; _pane_scope_of ${ID}; _pane_scope_stop ${ID}`);
      expect(h.calls().some((l) => l.startsWith('note ') && l.includes('held: tmux did not answer'))).toBe(true);
    });
  });

  it('shadow: a failed detach is unmeasured=detach-failed', () => {
    run({ pre: '_pane_scope_detach() { return 1; }' });
    expect(gs()).toEqual([`graceful-stop ${ID}: site=limit-resume mode=shadow unmeasured=detach-failed`]);
  });

  it('live: graceful-stop-live sends SIGTERM before the kill and times the exit', () => {
    arm();
    run({ pane: { term: 'slow' } });
    expect(signals()).toEqual(['TERM']);
    expect(gs()).toEqual([expect.stringMatching(/^graceful-stop lane-a-project-a: site=limit-resume mode=live exited=\d+$/)]);
    const n = Number(/exited=(\d+)$/.exec(gs()[0]!)![1]);
    expect(n).toBeGreaterThanOrEqual(300);
    expect(n).toBeLessThan(10000);
  });

  it('live: a process that ignores SIGTERM is waited GRACEFUL_STOP_TERM_WAIT_S, then killed as today', () => {
    arm();
    run({ pane: { term: 'ignore' }, env: 'GRACEFUL_STOP_TERM_WAIT_S=1 GRACEFUL_STOP_OBSERVE_S=3' });
    expect(gs()).toEqual([`graceful-stop ${ID}: site=limit-resume mode=live alive=1000`]);
    expect(signals()).toEqual(['TERM', 'HUP']);
  });

  it('live: a recycled or vanished pid is never signalled', () => {
    arm();
    run({
      pane: { hup: 'silent' },
      // the first call (step 3) answers the real start time, the second (step 5) a different one, as a recycled pid does
      pre: WRAP_PSTART('_ci_proc_start_real "$@" || return $?; (( _CIN == 1 )) || _CI_PSTART=1; return 0'),
    });
    expect(signals()).toEqual([]);
    expect(gs()).toEqual([`graceful-stop ${ID}: site=limit-resume mode=live gone-before-signal`]);
    expect(h.calls().some((l) => l.startsWith('tmux kill-session'))).toBe(true);
  });

  it('live: a start time unreadable at the signal sends nothing', () => {
    arm();
    run({
      pane: { hup: 'silent' },
      pre: WRAP_PSTART('if (( _CIN == 1 )); then _ci_proc_start_real "$@"; return; fi; _CI_PSTART=""; return 1'),
    });
    expect(signals()).toEqual([]);
    expect(gs()).toEqual([`graceful-stop ${ID}: site=limit-resume mode=live unmeasured=stat-unreadable`]);
    expect(gs().join()).not.toMatch(/gone-before-signal|no-pid/);
    expect(h.calls().some((l) => l.startsWith('tmux kill-session'))).toBe(true);
  });

  it('shadow: a start time that becomes unreadable mid-watch is unmeasured, never an exit time', () => {
    run({
      pane: { hup: 'ignore' },
      pre: WRAP_PSTART('if (( _CIN == 1 )); then _ci_proc_start_real "$@"; return; fi; _CI_PSTART=""; return 1'),
    });
    expect(gs()).toEqual([`graceful-stop ${ID}: site=limit-resume mode=shadow unmeasured=stat-unreadable`]);
    expect(gs().join()).not.toContain('exited=');
  });

  it('no start time: unmeasured=no-start-time, and live sends nothing', () => {
    arm();
    fs.mkdirSync(fx('emptyproc'), { recursive: true });
    run({ pane: { hup: 'silent' }, pre: `_CI_PROC="$HOME/fx/emptyproc"` });
    expect(signals()).toEqual([]);
    expect(gs()).toEqual([`graceful-stop ${ID}: site=limit-resume mode=live unmeasured=no-start-time`]);
  });

  it('no pane: no-pid, and the stop goes on', () => {
    fs.mkdirSync(fx(), { recursive: true });
    fs.writeFileSync(fx('no-pane'), '');
    run();
    expect(gs()).toEqual([`graceful-stop ${ID}: site=limit-resume mode=shadow no-pid`]);
    expect(h.calls().some((l) => l.startsWith('tmux kill-session'))).toBe(true);
    expect(h.calls().some((l) => l.startsWith('ensure '))).toBe(true);
  });

  it('a wedged pane read: unmeasured=wedged', () => {
    run({ pre: `_pane_scope_of() { PANE_SCOPE_PID=''; PANE_SCOPE_WEDGED=1; }` });
    expect(gs()).toEqual([`graceful-stop ${ID}: site=limit-resume mode=shadow unmeasured=wedged`]);
  });

  it('graceful-stop-live is a regular file or nothing: a directory there reads as shadow', () => {
    fs.mkdirSync(reg('graceful-stop-live'), { recursive: true });
    run();
    expect(signals()).toEqual(['HUP']);
    expect(gs()).toEqual([expect.stringMatching(/mode=shadow exited=\d+$/)]);
  });
});

describe('the sites of the graceful stop', () => {
  const src = ccdSource().split('\n');
  const owner = (i: number): string => {
    for (let j = i; j >= 0; j--) { const m = /^([A-Za-z_][A-Za-z0-9_]*)\(\) \{/.exec(src[j]!); if (m) return m[1]!; }
    return '';
  };
  const live = (l: string): boolean => !/^\s*#/.test(l);
  const SITES = { cmd_swap: 'swap', _watchdog_resume_run: 'limit-resume', cmd_hibernate: 'hibernate read' };
  const callIdx = src.flatMap((l, i) => (live(l) && /^ {2}_graceful_stop_before "\$id" /.test(l) ? [i] : []));

  it('the graceful stop sits at the three stop-then-resume sites, around the kill', () => {
    const found: Record<string, string> = {};
    for (const i of callIdx) found[owner(i)] = src[i]!.replace(/^ {2}_graceful_stop_before "\$id" /, '');
    expect(found).toEqual(SITES);
    const UNMARK = /^ {2}_tmx kill-session -t "\$\(_tmux_t "\$id"\)" 2>\/dev\/null \|\| _operator_choice_unmark "\$id"/;
    for (const i of callIdx) {
      const rest = src.slice(i + 1).filter(live);
      expect(rest[0], owner(i)).toMatch(UNMARK);
      expect(rest[1], owner(i)).toBe('  _graceful_stop_after "$id"');
      if (owner(i) === 'cmd_hibernate') {
        const before = src.slice(0, i).filter(live);
        expect(before[before.length - 1]).toMatch(/^ {2}_pane_scope_of "\$id"/);
      }
    }
  });

  it('every stop a spawn follows is graceful or named', () => {
    const NAMED: Record<string, string> = {
      cmd_stop: 'a stopped row: only the operator respawns it (ccd start or enable), and mail never wakes it',
      cmd_ws_archive: 'an archive: only the operator\'s ws-restore respawns it',
    };
    const keeps = new Set(src.flatMap((l, i) => (live(l) && l.includes('_operator_choice_keep "$id"') ? [owner(i)] : []))
      .filter((f) => f !== '_spawn_start'));
    expect([...keeps].sort()).toEqual([...Object.keys(SITES), ...Object.keys(NAMED)].sort());
    expect(Object.keys(NAMED).every((k) => keeps.has(k))).toBe(true);
  });
});
