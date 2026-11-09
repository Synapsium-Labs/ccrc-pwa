// One pending swap dispatch per session (D-8123, limit-swap-autofix Task 8).
//
// The fleet watchdog (Task 9) and a supervisor tick can decide for the same session in the same second. Two transient
// units running `cmd_swap` for one session is a double move: the second unit would stop the pane the first just
// started. `_dispatch_swap` therefore claims `$REG/<id>.dispatching` with a no-clobber write of the epoch before it
// starts the unit. A claim younger than SWAP_JITTER + 60 s refuses the dispatch (`dispatch-dup`, `lastswap` put back
// to the caller's `prev`, rc 1); an older claim is replaced; `cmd_swap` removes the claim on every exit after its
// act-time gates. Nothing here sends a key: the rescue ends the session and resumes it on another account.
//
// FIXTURE HOME ONLY (`makeCcdHarness`). `_svc_run_detached` records the unit's `bash -c` string, the clock is ccd's own
// seam (`FAKE_NOW`), and neutral ids only (public repository): the session `lane-a-project-a`, the fixture roster.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, boxed, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-dispatch-claim-'); });
afterEach(() => { h.cleanup(); });

const ID = 'lane-a-project-a';
const OTHER = 'lane-a-project-b';
const UUID = 'a0000000-0000-4000-8000-0000000000c8';
const PID = '4242';
const T0 = 1_900_000_000;
const reg = (): string => path.join(h.home, '.cc-sessions');
const claimPath = (id = ID): string => path.join(reg(), `${id}.dispatching`);
const lastswapPath = (id = ID): string => path.join(reg(), `${id}.lastswap`);

const STUBS = `
  date() { if [[ "\${1:-}" == +%s && -n "\${FAKE_NOW:-}" ]]; then echo "$FAKE_NOW"; else command date "$@"; fi; }
  _svc_run_detached() { printf '%s\\n' "$3" >> "$HOME/detached"; return \${DETACH_RC:-0}; }
  _jitter_draw() { echo 0; }`;

const detached = (): string[] => {
  const p = path.join(h.home, 'detached');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
const swapLog = (): string => {
  const p = path.join(reg(), 'swap.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
const dupLines = (): string[] => swapLog().split('\n').filter((l) => / dispatch-dup /.test(l));

/** Run `body` in the fixture shell at fixture second `now`. */
const at = (now: number, body: string, env: NodeJS.ProcessEnv = {}): string =>
  h.sh(`${STUBS}\n${body}\ntrue`, { FAKE_NOW: String(now), ...env });

describe('a second dispatch for one session is refused (D-8123)', () => {
  it('two dispatches in one second: one unit, one dispatch-dup line', () => {
    at(T0, `_dispatch_swap ${ID} claude-a rescue; _dispatch_swap ${ID} claude-a rescue`);
    expect(detached()).toHaveLength(1);
    expect(dupLines()).toHaveLength(1);
    expect(fs.readFileSync(claimPath(), 'utf8').trim()).toBe(String(T0));
  });

  it('the line names the target and the pending dispatch\'s epoch', () => {
    at(T0, `_dispatch_swap ${ID} claude-a rescue; _dispatch_swap ${ID} claude-b watchdog`);
    expect(dupLines()).toEqual([expect.stringMatching(
      new RegExp(`dispatch-dup ${ID} -> claude-b \\(a dispatch at ${T0} is still pending\\)$`))]);
    expect(swapLog()).not.toMatch(/dispatch lane-a-project-a -> claude-b /);   // the refused one never logged a dispatch
  });

  it('the refusal returns 1 and puts lastswap back to the caller\'s prev', () => {
    const out = at(T0, `
      _dispatch_swap ${ID} claude-a rescue 500 ${T0}
      _reg_set ${ID} lastswap ${T0}
      _dispatch_swap ${ID} claude-a rescue 777 ${T0}; echo "rc=$?"`);
    expect(out).toMatch(/rc=1/);
    expect(fs.readFileSync(lastswapPath(), 'utf8').trim()).toBe('777');
  });

  it('with no prev (the caller had none) the refusal removes the lastswap it stamped', () => {
    at(T0, `
      _dispatch_swap ${ID} claude-a rescue
      _reg_set ${ID} lastswap ${T0}
      _dispatch_swap ${ID} claude-a rescue`);
    expect(fs.existsSync(lastswapPath())).toBe(false);
  });

  it('a non-numeric prev removes the lastswap rather than writing it back', () => {
    at(T0, `
      _dispatch_swap ${ID} claude-a rescue
      _reg_set ${ID} lastswap ${T0}
      _dispatch_swap ${ID} claude-a rescue 'REG[x]'`);
    expect(fs.existsSync(lastswapPath())).toBe(false);
  });

  it('the first dispatch is untouched by the refused second', () => {
    at(T0, `_dispatch_swap ${ID} claude-a rescue; _dispatch_swap ${ID} claude-b rescue`);
    expect(detached()).toEqual([expect.stringContaining(`swap '${ID}' 'claude-a'`)]);
  });

  it('a claim of a different session does not block this one', () => {
    at(T0, `_dispatch_swap ${OTHER} claude-a rescue; _dispatch_swap ${ID} claude-a rescue`);
    expect(detached()).toHaveLength(2);
    expect(dupLines()).toEqual([]);
  });
});

describe('the claim ages out at SWAP_JITTER + 60 s (D-8123)', () => {
  it('a claim one second inside the window still refuses', () => {
    at(T0, `_dispatch_swap ${ID} claude-a rescue; _dispatch_swap ${ID} claude-a rescue`);
    at(T0 + 179, `_dispatch_swap ${ID} claude-a rescue`);
    expect(detached()).toHaveLength(1);
    expect(dupLines()).toHaveLength(2);
  });

  it('a claim with its epoch moved back SWAP_JITTER + 61 s is replaced and dispatches', () => {
    at(T0, `_dispatch_swap ${ID} claude-a rescue; _dispatch_swap ${ID} claude-a rescue`);
    expect(detached()).toHaveLength(1);
    at(T0 + 181, `_dispatch_swap ${ID} claude-a rescue`);
    expect(detached()).toHaveLength(2);
    expect(fs.readFileSync(claimPath(), 'utf8').trim()).toBe(String(T0 + 181));
  });

  it('the window follows SWAP_JITTER', () => {
    at(T0, `SWAP_JITTER=10; _dispatch_swap ${ID} claude-a rescue`);
    at(T0 + 69, `SWAP_JITTER=10; _dispatch_swap ${ID} claude-a rescue`);
    expect(detached()).toHaveLength(1);
    at(T0 + 71, `SWAP_JITTER=10; _dispatch_swap ${ID} claude-a rescue`);
    expect(detached()).toHaveLength(2);
  });

  it('a torn or hostile claim is replaced, never evaluated', () => {
    fs.mkdirSync(reg(), { recursive: true });
    fs.writeFileSync(claimPath(), 'REG[$(touch "$HOME/PWNED-claim")]');
    at(T0, `_dispatch_swap ${ID} claude-a rescue`);
    expect(detached()).toHaveLength(1);
    expect(fs.existsSync(path.join(h.home, 'PWNED-claim'))).toBe(false);
    expect(fs.readFileSync(claimPath(), 'utf8').trim()).toBe(String(T0));
  });

  it('a claim dated in the future (clock skew) is replaced rather than held', () => {
    fs.mkdirSync(reg(), { recursive: true });
    fs.writeFileSync(claimPath(), String(T0 + 100_000));
    at(T0, `_dispatch_swap ${ID} claude-a rescue`);
    expect(detached()).toHaveLength(1);
  });

  it('a failed unit start frees the claim', () => {
    at(T0, `_dispatch_swap ${ID} claude-a rescue`, { DETACH_RC: '1' });
    expect(swapLog()).toMatch(/dispatch FAILED for lane-a-project-a -> claude-a/);
    expect(fs.existsSync(claimPath())).toBe(false);
    at(T0, `_dispatch_swap ${ID} claude-a rescue`);
    expect(detached()).toHaveLength(2);
  });
});

describe('cmd_swap frees the claim on its way out (D-8123)', () => {
  const cfgOf: Record<string, string> = { claude: '.claude', 'claude-a': '.claude-a', 'claude-d': '.claude-d' };
  const SW = `
    tmux() { echo "tmux $*" >> "$HOME/ccd-calls"
      case "$*" in *pane_active*) echo "1 200"; return 0 ;; esac
      case "\${1:-}" in capture-pane) cat "$HOME/pane" 2>/dev/null ;; list-panes) echo ${PID} ;; esac; return 0; }
    systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; }
    launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; return 0; }
    sleep() { :; }
    cmd_ensure() { echo "cmd_ensure $*" >> "$HOME/ccd-calls"; return 0; }
    _swap_target() { echo claude-d; }; _avail() { return 0; }`;
  const seed = (): void => {
    const wd = path.join(h.home, 'projects', 'project-a');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set ${ID} uuid ${UUID}; _reg_set ${ID} wrapper claude; _reg_set ${ID} home claude
      _reg_set ${ID} project project-a; _reg_set ${ID} workdir ${wd}; _reg_set ${ID} class fable`);
    const dir = path.join(h.home, cfgOf.claude!, 'projects', fs.realpathSync(wd).replace(/[/._]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${UUID}.jsonl`), '{"type":"user","message":{"role":"user","content":"go on"}}\n');
    fs.writeFileSync(path.join(h.home, 'pane'), `${boxed()}\n`);
    const sdir = path.join(h.home, cfgOf.claude!, 'sessions');
    fs.mkdirSync(sdir, { recursive: true });
    fs.writeFileSync(path.join(sdir, `${PID}.json`), JSON.stringify({ pid: Number(PID), status: 'idle', statusUpdatedAt: 1 }));
  };
  const setStatus = (status: string): void => {
    fs.writeFileSync(path.join(h.home, cfgOf.claude!, 'sessions', `${PID}.json`),
      JSON.stringify({ pid: Number(PID), status, statusUpdatedAt: 1 }));
  };
  /** Dispatch an affinity move, then run the recorded unit string inline (the re-exec of the binary becomes `cmd_swap`). */
  const dispatchAndAct = (): void => {
    h.sh(`${STUBS}\n${SW}\n_svc_run_detached() { printf '%s\\n' "$3" >> "$HOME/detached"; return 0; }
      _dispatch_swap ${ID} claude-d affinity`, { TMUX: '' });
    expect(fs.existsSync(claimPath()), 'the control: the dispatch claimed').toBe(true);
  };
  const act = (): void => {
    h.sh(`${STUBS}\n${SW}
      s=$(tail -n1 "$HOME/detached"); re="exec '[^']*' swap"
      [[ $s =~ $re ]] && s="\${s/"\${BASH_REMATCH[0]}"/cmd_swap}"
      ( eval "$s" )`, { TMUX: '' });
  };

  it('a swap that proceeds removes the claim', () => {
    seed();
    dispatchAndAct(); act();
    expect(swapLog()).toContain(`swap ${ID}: claude -> claude-d`);
    expect(fs.existsSync(claimPath())).toBe(false);
  });

  it('an act-time refusal (busy after the jitter) removes the claim too, so the next decision can dispatch', () => {
    seed();
    dispatchAndAct();
    setStatus('busy');
    act();
    expect(swapLog()).toContain(`requeue ${ID}: busy after jitter`);
    expect(fs.existsSync(claimPath())).toBe(false);
  });

  it('a manual swap (no CCD_SWAP_AUTO) never touches a pending claim', () => {
    seed();
    fs.mkdirSync(reg(), { recursive: true });
    fs.writeFileSync(claimPath(), `${Math.floor(Date.now() / 1000)}\n`);
    h.sh(`${STUBS}\n${SW}\n( cmd_swap ${ID} claude-d ) >/dev/null 2>&1 || true`, { TMUX: '' });
    expect(fs.existsSync(claimPath())).toBe(true);
  });
});

describe('no key is ever sent (D-8123)', () => {
  it('a refused and an accepted dispatch send no key to any pane', () => {
    at(T0, `_dispatch_swap ${ID} claude-a rescue; _dispatch_swap ${ID} claude-a rescue`);
    expect(h.calls().filter((l) => /send-keys/.test(l))).toEqual([]);
  });
});
