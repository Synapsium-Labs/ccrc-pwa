/**
 * A deliberate stop takes the session's own pane scope down with it (D-7902).
 *
 * `claude-session@.service` runs with `KillMode=process`, so stopping a session signals its main process only, and
 * whatever the agent started in the background keeps running in the pane's transient scope
 * (`app-claude\x2dsession.slice/tmux-spawn-<uuid>.scope`) until the scope sweep finds it, hours later. Now
 * `ccd stop` and `ccd hibernate` (which the stop-done lane composes, and the roll) read the pane's scope before the
 * kill, after the stop's stamp and the unit's disable and under a deadline, and hand the rest to a detached
 * `_pane_scope_reap`, so the verb never waits: it waits for the main process to exit and a grace (`PANE_SCOPE_STOP_GRACE_S`), and then, only when `$REG/pane-scope-stop-live` stands, runs
 * `systemctl --user stop --no-block <unit>`. Without the switch the same run
 * logs `would stop` and stops nothing. A scope that holds another live pane, a unit that is not a tmux pane scope, and
 * one outside the session slice are never stopped.
 *
 * FIXTURE ONLY: HOME is the harness's (`makeCcdHarness`); `tmux` and `systemctl` are PROGRAMS on PATH
 * (`stubContainedTool`), as `scope-sweep.test.ts` stubs them; `/proc` and `/sys/fs/cgroup` are planted trees behind
 * `_panescope_proc_root` and `_panescope_cgroup_root`; the grace is logged through `_pane_scope_sleep`, never waited;
 * and the detach (`_pane_scope_detach`) runs the reap inline, logged, except in the cases that measure the real detach
 * against the harness's recording `systemd-run`.
 * The one real process is a background `sleep` this file starts, and the stub `systemctl` kills only the pids this
 * file lists as its own (`killable`), never a planted one.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { makeCcdHarness, stubContainedTool, type CcdHarness } from './ccdWsHelpers.js';
import { asManagerCalls } from './platformFixtures.js';

let h: CcdHarness;
let kids: ChildProcess[] = [];

const ID = 'lane-a-project-a';
const OTHER = 'lane-a-project-b';
const UUID = 'b7001948-2222-4bcc-b60b-0cfc0dc3d199';
const SLICE = '/user.slice/user-1000.slice/user@1000.service/app.slice/app-claude\\x2dsession.slice';
const UNIT = 'tmux-spawn-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.scope';
const NEW_UNIT = 'tmux-spawn-9f8e7d6c-5b4a-4321-8fed-cba987654321.scope';
const MAIN = 3999901;      // a planted pid, above any box's default pid_max: never a real process
const OTHER_PANE = 3999902;
const NEW_MAIN = 3999903;

const fx = (...p: string[]): string => path.join(h.home, 'fx', ...p);
const reg = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string => (fs.existsSync(reg('swap.log')) ? fs.readFileSync(reg('swap.log'), 'utf8') : '');
const scopeLines = (): string[] => swapLog().split('\n').filter((l) => l.includes(' pane-scope '));
/** Each pane-scope line past its timestamp: an exact match, with no pattern to escape. */
const scopeTexts = (): string[] => scopeLines().map((l) => l.slice(l.indexOf('pane-scope ')));

/** A planted process: `/proc/<pid>/cgroup` names `cg`. */
const plantProc = (pid: number, cg: string): void => {
  fs.mkdirSync(fx('proc', String(pid)), { recursive: true });
  fs.writeFileSync(fx('proc', String(pid), 'cgroup'), `0::${cg}\n`);
};
/** A planted cgroup directory and its `cgroup.procs`. */
const plantCgroup = (cg: string, pids: number[]): void => {
  fs.mkdirSync(fx('cg', cg), { recursive: true });
  fs.writeFileSync(fx('cg', cg, 'cgroup.procs'), pids.map((p) => `${p}\n`).join(''));
};
/** A REAL background process, as an agent's `sleep 300 &` would be: its pid is the one the stub may kill. */
const realSleep = (): number => {
  const k = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
  k.unref();
  kids.push(k);
  fs.appendFileSync(fx('killable'), `${k.pid}\n`);
  return k.pid!;
};
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitDead = async (pid: number): Promise<boolean> => {
  for (let i = 0; i < 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 20));
  return !alive(pid);
};

// The stub tmux: the session's pane answers `main-pid` until `kill-session`, which also ends the main process (its
// planted /proc entry and its line in every planted cgroup.procs go). `list-panes -a` answers `panes-all`, or "no server
// running" under `no-server`, or fails with `list-rc`. `display-message` answers 0 terminals attached. A wedged server is
// a call that does not answer: `wedged` holds every call for that many seconds, `wedged-read` only the session's own
// `list-panes -t`. Each is an `exec`, so the deadline's TERM lands on the sleep itself and leaves nothing behind.
const TMUX = (base: string): string => `#!/usr/bin/env bash
F=${JSON.stringify(base)}
printf 'tmux %s\\n' "$*" >> "$HOME/ccd-calls"
[ -f "$F/wedged" ] && exec sleep "$(cat "$F/wedged")"
[ "$1 $2" = "list-panes -t" ] && [ -f "$F/wedged-read" ] && exec sleep "$(cat "$F/wedged-read")"
case "$1" in
  list-panes)
    if [ "$2" = -a ]; then
      [ -f "$F/no-server" ] && { echo "no server running on /tmp/tmux-1000/default" >&2; exit 1; }
      [ -f "$F/list-rc" ] && { echo "fixture tmux: refused" >&2; exit "$(cat "$F/list-rc")"; }
      cat "$F/panes-all" 2>/dev/null; exit 0
    fi
    [ -f "$F/killed" ] || cat "$F/main-pid"; exit 0 ;;
  kill-session)
    : > "$F/killed"
    if [ ! -f "$F/main-survives" ]; then
      m=$(cat "$F/main-pid"); rm -rf "$F/proc/$m"
      find "$F/cg" -name cgroup.procs | while read -r p; do grep -vx "$m" "$p" > "$p.n"; mv "$p.n" "$p"; done
    fi
    exit 0 ;;
  has-session) [ -f "$F/killed" ] && exit 1; exit 0 ;;
  display-message) echo 0; exit 0 ;;
  *) exit 0 ;;
esac
`;
// The stub systemctl: `--user stop --no-block <unit>` kills the listed pids of that unit's planted cgroup that this
// file started (and only those) and removes the cgroup, as systemd's stop of a scope does; rc from `stop-rc`. Every
// other argv answers 0 and does nothing.
const SYSTEMCTL = (base: string): string => `#!/usr/bin/env bash
F=${JSON.stringify(base)}
printf 'systemctl %s\\n' "$*" >> "$HOME/ccd-calls"
if [ "$1 $2 $3" = "--user stop --no-block" ]; then
  [ -f "$F/stop-rc" ] && exit "$(cat "$F/stop-rc")"
  d=$(find "$F/cg" -type d -name "$4" | head -1)
  if [ -n "$d" ]; then
    while read -r p; do grep -qx "$p" "$F/killable" 2>/dev/null && kill -9 "$p" 2>/dev/null; done < "$d/cgroup.procs"
    rm -rf "$d"
  fi
fi
exit 0
`;

/** The seams every snippet sets: the planted trees, a logged grace, and the detach run inline. */
const TREES = `_panescope_proc_root() { printf '%s' "$HOME/fx/proc"; }
  _panescope_cgroup_root() { printf '%s' "$HOME/fx/cg"; }
  _pane_scope_sleep() { echo "grace $1" >> "$HOME/ccd-calls"; }`;
const SEAMS = `${TREES}
  _pane_scope_detach() { echo "detach $*" >> "$HOME/ccd-calls"; "$@"; }`;

/** The session's live pane: main pid `MAIN` in `cg` (default: its own pane scope under the session slice). */
const pane = (cg: string = `${SLICE}/${UNIT}`): void => {
  fs.writeFileSync(fx('main-pid'), `${MAIN}\n`);
  plantProc(MAIN, cg);
  fs.writeFileSync(fx('panes-all'), `cc-${ID} ${MAIN}\n`);
};
const arm = (): void => { fs.writeFileSync(reg('pane-scope-stop-live'), ''); };
const stops = (): string[] => h.calls().filter((l) => l.startsWith('systemctl --user stop'));
const stop = (): string => h.sh(`${SEAMS}\n cmd_stop ${ID}`);

beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-stop-pane-scope-');
  kids = [];
  fs.mkdirSync(fx('proc'), { recursive: true });
  fs.mkdirSync(fx('cg'), { recursive: true });
  fs.writeFileSync(fx('killable'), '');
  stubContainedTool(h.home, 'tmux', TMUX(fx()));
  stubContainedTool(h.home, 'systemctl', SYSTEMCTL(fx()));
});
afterEach(() => {
  for (const k of kids) { try { process.kill(k.pid!, 'SIGKILL'); } catch { /* already gone */ } }
  h.cleanup();
});

describe('ccd stop, armed: the pane scope goes, and with it what the session left running', () => {
  it('a background sleep in the pane scope: after the grace, one stop --no-block of that unit, the sleep is dead and the scope gone', async () => {
    pane();
    const bg = realSleep();
    plantCgroup(`${SLICE}/${UNIT}`, [MAIN, bg]);
    arm();
    const out = stop();
    expect(out).toContain(`stopped ${ID}`);
    expect(stops()).toEqual([`systemctl --user stop --no-block ${UNIT}`]);
    expect(await waitDead(bg), 'the background sleep outlived the stop').toBe(true);
    expect(fs.existsSync(fx('cg', SLICE, UNIT)), 'the scope is gone').toBe(false);
    expect(scopeTexts()).toEqual([`pane-scope ${ID}: stopped ${UNIT} (1 processes)`]);
  });

  it('the order: the scope is read before the kill, the grace is waited after it, and the stop comes last', () => {
    pane(); plantCgroup(`${SLICE}/${UNIT}`, [MAIN, realSleep()]); arm();
    stop();
    const c = h.calls();
    const at = (re: RegExp): number => c.findIndex((l) => re.test(l));
    const read = at(new RegExp(`^tmux list-panes -t =cc-${ID}: -F #\\{pane_pid\\}$`));
    const kill = at(/^tmux kill-session /);
    const detach = at(new RegExp(`^detach _pane_scope_reap ${ID} ${MAIN} /`));
    const grace = at(/^grace 10$/);
    const stopAt = at(/^systemctl --user stop --no-block /);
    expect([read, kill, detach, grace, stopAt].every((i) => i >= 0), c.join('\n')).toBe(true);
    expect(read).toBeLessThan(kill);
    expect(kill).toBeLessThan(detach);
    expect(detach).toBeLessThan(grace);
    expect(grace).toBeLessThan(stopAt);
  });

  it('a stop systemd refuses is logged `stop failed`, and the verb still answers stopped', () => {
    pane(); plantCgroup(`${SLICE}/${UNIT}`, [MAIN, realSleep()]); arm();
    fs.writeFileSync(fx('stop-rc'), '1');
    expect(stop()).toContain(`stopped ${ID}`);
    expect(scopeLines()).toEqual([expect.stringContaining(`pane-scope ${ID}: stop failed ${UNIT} (1 processes, rc 1)`)]);
  });

  it('nothing left in the scope after the main process exits: no stop, and the line says so', () => {
    pane(); plantCgroup(`${SLICE}/${UNIT}`, [MAIN]); arm();
    stop();
    expect(stops()).toEqual([]);
    expect(scopeLines()).toEqual([expect.stringContaining(`pane-scope ${ID}: nothing left in ${UNIT}`)]);
  });

  it('no tmux server left after the kill (it was the last session): no other pane can hold the scope, so it is stopped', () => {
    pane(); plantCgroup(`${SLICE}/${UNIT}`, [MAIN, realSleep()]); arm();
    fs.writeFileSync(fx('no-server'), '');
    stop();
    expect(stops()).toEqual([`systemctl --user stop --no-block ${UNIT}`]);
  });
});

describe('ccd stop, shadow: the same run logs `would stop` and stops nothing', () => {
  it('no pane-scope-stop-live: one would-stop line naming the session, the unit and the count, no stop call, the sleep still runs', async () => {
    pane();
    const bg = realSleep();
    plantCgroup(`${SLICE}/${UNIT}`, [MAIN, bg]);
    stop();
    expect(stops()).toEqual([]);
    expect(scopeTexts()).toEqual([`pane-scope ${ID}: would stop ${UNIT} (1 processes)`]);
    expect(alive(bg)).toBe(true);
    expect(fs.existsSync(fx('cg', SLICE, UNIT))).toBe(true);
  });
});

describe('a scope that is not this session\'s alone is never stopped', () => {
  it('another live session\'s pane process is in the same scope: held, named, no stop', () => {
    pane(); plantCgroup(`${SLICE}/${UNIT}`, [MAIN, OTHER_PANE, realSleep()]); arm();
    plantProc(OTHER_PANE, `${SLICE}/${UNIT}`);
    fs.appendFileSync(fx('panes-all'), `cc-${OTHER} ${OTHER_PANE}\n`);
    stop();
    expect(stops()).toEqual([]);
    expect(scopeLines()).toEqual([expect.stringContaining(`pane-scope ${ID}: held ${UNIT}: it holds the live pane ${OTHER_PANE} of cc-${OTHER}`)]);
  });

  it('another live pane in a child cgroup of the scope is held too (a stop takes the whole subtree)', () => {
    pane(); plantCgroup(`${SLICE}/${UNIT}`, [MAIN, realSleep()]); arm();
    plantCgroup(`${SLICE}/${UNIT}/sub`, [OTHER_PANE]);
    plantProc(OTHER_PANE, `${SLICE}/${UNIT}/sub`);
    fs.appendFileSync(fx('panes-all'), `cc-${OTHER} ${OTHER_PANE}\n`);
    stop();
    expect(stops()).toEqual([]);
  });

  it('control: another live pane in ANOTHER scope does not hold this one', () => {
    pane(); plantCgroup(`${SLICE}/${UNIT}`, [MAIN, realSleep()]); arm();
    plantProc(OTHER_PANE, `${SLICE}/${NEW_UNIT}`);
    fs.appendFileSync(fx('panes-all'), `cc-${OTHER} ${OTHER_PANE}\n`);
    stop();
    expect(stops()).toEqual([`systemctl --user stop --no-block ${UNIT}`]);
  });

  it('tmux cannot list its panes after the kill: unmeasured, held, no stop', () => {
    pane(); plantCgroup(`${SLICE}/${UNIT}`, [MAIN, realSleep()]); arm();
    fs.writeFileSync(fx('list-rc'), '1');
    stop();
    expect(stops()).toEqual([]);
    expect(scopeLines()).toEqual([expect.stringContaining(`pane-scope ${ID}: held ${UNIT}: tmux did not list its panes`)]);
  });

  it('the main process does not exit within the wait: held, no grace, no stop', () => {
    pane(); plantCgroup(`${SLICE}/${UNIT}`, [MAIN, realSleep()]); arm();
    fs.writeFileSync(fx('main-survives'), '');
    stop();
    expect(stops()).toEqual([]);
    expect(h.calls()).not.toContain('grace 10');
    expect(scopeLines()).toEqual([expect.stringContaining(`pane-scope ${ID}: held ${UNIT}: its main process ${MAIN} did not exit within 10s`)]);
  });
});

describe('only a tmux pane scope under the session slice is ever stopped', () => {
  it('a unit that is not tmux-spawn-*.scope (the tmux server\'s own scope): never stopped', () => {
    const cg = `${SLICE}/ccrc-tmux-server.scope`;
    pane(cg); plantCgroup(cg, [MAIN, realSleep()]); arm();
    stop();
    expect(stops()).toEqual([]);
    expect(scopeLines()).toEqual([expect.stringContaining(`pane-scope ${ID}: held ccrc-tmux-server.scope: not a tmux pane scope`)]);
  });

  it('a tmux pane scope outside the session slice: never stopped, never waited on, and no line (it is no ccd pane scope)', () => {
    const cg = `/user.slice/user-1000.slice/user@1000.service/app.slice/${UNIT}`;
    pane(cg); plantCgroup(cg, [MAIN, realSleep()]); arm();
    stop();
    expect(stops()).toEqual([]);
    expect(h.calls()).not.toContain('grace 10');
    expect(h.calls().filter((l) => l.startsWith('tmux list-panes -a')).length, 'only the lifecycle probe lists every pane').toBeLessThanOrEqual(1);
    expect(scopeLines()).toEqual([]);
  });

  it('no cgroup to read (macOS, a tmux without systemd, a pid already gone): nothing captured, no grace, no line', () => {
    fs.writeFileSync(fx('main-pid'), `${MAIN}\n`);   // a pane, but no /proc entry for it
    arm();
    stop();
    expect(stops()).toEqual([]);
    expect(h.calls()).not.toContain('grace 10');
    expect(scopeLines()).toEqual([]);
  });

  it('no live pane at all (an already stopped session): nothing captured, no line', () => {
    fs.writeFileSync(fx('main-pid'), '');
    arm();
    stop();
    expect(stops()).toEqual([]);
    expect(scopeLines()).toEqual([]);
  });
});

describe('hibernation stops the pane scope too, and the wake gets a fresh one', () => {
  const seed = (): void => {
    h.sh(`_reg_set ${ID} wrapper claude
          _reg_set ${ID} workdir '${h.home}'
          _reg_set ${ID} uuid ${UUID}`);
    fs.writeFileSync(reg(`${ID}.turn.json`), `{"state":"done","bg":0,"crons":0,"stopAt":${Date.now() - 3 * 3600_000}}\n`);
  };
  const LIVE_PANE = `_pane_for_keystroke() { KS_PANE='%1'; return 0; }; _idle_for_keystroke() { return 0; }`;

  it('ccd hibernate, armed: the pane scope is stopped after the kill, and the row reads hibernated', () => {
    seed(); pane(); plantCgroup(`${SLICE}/${UNIT}`, [MAIN, realSleep()]); arm();
    const out = h.sh(`${SEAMS}\n ${LIVE_PANE}\n cmd_hibernate ${ID}`);
    expect(out).toContain(`hibernated ${ID}`);
    expect(fs.existsSync(reg(`${ID}.hibernated`))).toBe(true);
    expect(stops()).toEqual([`systemctl --user stop --no-block ${UNIT}`]);
  });

  it('a hibernate --roll round trip: the old scope is stopped BEFORE the wake, the wake records its new scope, and the new one is never stopped', () => {
    seed(); pane(); plantCgroup(`${SLICE}/${UNIT}`, [MAIN, realSleep()]); arm();
    // The wake's spawn, as `cmd_ensure` makes it: the hibernation ends, a new pane comes up in a NEW scope, and the
    // spawn records that scope (`_panescope_record`, the marker's one writer).
    const ENSURE = `cmd_ensure() {
        echo "ensure $1" >> "$HOME/ccd-calls"
        _hib_wake_clear "$1"
        rm -f "$HOME/fx/killed"; echo ${NEW_MAIN} > "$HOME/fx/main-pid"
        mkdir -p "$HOME/fx/proc/${NEW_MAIN}"; printf '0::%s\\n' '${SLICE}/${NEW_UNIT}' > "$HOME/fx/proc/${NEW_MAIN}/cgroup"
        _panescope_record "$1"; }`;
    const out = h.sh(`${SEAMS}\n ${LIVE_PANE}\n ${ENSURE}\n cmd_hibernate --roll ${ID}`);
    expect(out).toContain(`rolled ${ID}`);
    const c = h.calls();
    expect(c.indexOf(`systemctl --user stop --no-block ${UNIT}`)).toBeGreaterThanOrEqual(0);
    expect(c.indexOf(`systemctl --user stop --no-block ${UNIT}`)).toBeLessThan(c.indexOf(`ensure ${ID}`));
    expect(stops()).toEqual([`systemctl --user stop --no-block ${UNIT}`]);
    expect(h.reg(ID, 'panescope')).toBe(NEW_UNIT);
    expect(fs.existsSync(reg(`${ID}.hibernated`)), 'the wake ended the hibernation').toBe(false);
    expect(h.reg(ID, 'woke')).toMatch(/^\d+$/);
  });
});

describe('the verb never waits: the reap runs in its own transient unit', () => {
  /** The real `_pane_scope_detach`, on the Linux arm, against the harness's recording `systemd-run` (rc 0). */
  const real = (env: NodeJS.ProcessEnv = {}): string => h.sh(`${TREES}\n CCD_OS=linux; cmd_stop ${ID}`, { SYSTEMD_RUN_RC: '0', ...env });
  const runs = (): string[] => {
    const p = path.join(h.home, 'systemd-run-calls');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter((l) => l !== '') : [];
  };

  it('ccd stop answers at once: one systemd-run that sources ccd and calls the reap with the id, the pid and the cgroup, single-quoted', () => {
    pane(); plantCgroup(`${SLICE}/${UNIT}`, [MAIN]); arm();
    expect(real()).toContain(`stopped ${ID}`);
    expect(h.calls(), 'the verb waited the grace itself').not.toContain('grace 10');
    expect(stops(), 'the verb stopped the scope itself').toEqual([]);
    const r = runs();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/^--user --collect --quiet bash -c source '\/[^']+\/ccd\/ccd' && '_pane_scope_reap' /);
    expect(r[0]).toContain(` '${ID}' '${MAIN}' '${SLICE}/${UNIT}'`);
  });

  it('a dispatch the service manager refuses is held, named, and the verb still answers stopped', () => {
    pane(); plantCgroup(`${SLICE}/${UNIT}`, [MAIN]); arm();
    expect(real({ SYSTEMD_RUN_RC: '1' })).toContain(`stopped ${ID}`);
    expect(scopeLines()).toEqual([expect.stringContaining(`pane-scope ${ID}: held ${UNIT}: its delayed stop could not be started (rc 1)`)]);
  });

  it('a word outside the charset (a quote, a space, a dollar) is never placed in the string: nothing is dispatched', () => {
    expect(() => h.sh(`_pane_scope_detach _pane_scope_reap "a'b" 1 /x`)).toThrow();
    expect(() => h.sh('_pane_scope_detach _pane_scope_reap \'a$b\' 1 /x')).toThrow();
    expect(() => h.sh('_pane_scope_detach _pane_scope_reap \'a b\' 1 /x')).toThrow();
    expect(runs()).toEqual([]);
  });
});

describe('a wedged tmux never holds a stop', () => {
  const WEDGE_S = 5;   // what a wedged call sleeps, past the one-second deadlines below
  const DEADLINES = 'SUBSTRATE_PROBE_DEADLINE_S=1; _LC_OBS_TMUX_DEADLINE_S=1';
  const LAUNCHD = `launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; }`;   // macOS's disable, for asManagerCalls to read
  const HELD = `pane-scope ${ID}: held: tmux did not answer within 1s, so no scope was read`;
  const READ = `tmux list-panes -t =cc-${ID}: -F #{pane_pid}`;

  it('ccd stop with every tmux call hanging: the stop is stamped and the unit disabled before the read, which gives up and says so', () => {
    pane(); plantCgroup(`${SLICE}/${UNIT}`, [MAIN, realSleep()]); arm();
    fs.writeFileSync(fx('wedged'), `${WEDGE_S}\n`);
    const out = h.sh(`${SEAMS}\n ${DEADLINES}\n ${LAUNCHD}\n cmd_stop ${ID}`);
    expect(out).toContain(`stopped ${ID}`);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} cli$/);
    const c = asManagerCalls(h.calls());
    const disable = c.indexOf(`systemctl --user disable --now claude-session@${ID}`);
    expect(disable, c.join('\n')).toBeGreaterThanOrEqual(0);
    expect(disable, c.join('\n')).toBeLessThan(c.indexOf(READ));
    expect(scopeTexts()).toEqual([HELD]);
    expect(stops()).toEqual([]);
  }, 30_000);

  it('ccd hibernate with its read hanging: the marker stands, the unit is disabled before the read, and the verb answers', () => {
    h.sh(`_reg_set ${ID} wrapper claude
          _reg_set ${ID} workdir '${h.home}'
          _reg_set ${ID} uuid ${UUID}`);
    fs.writeFileSync(reg(`${ID}.turn.json`), `{"state":"done","bg":0,"crons":0,"stopAt":${Date.now() - 3 * 3600_000}}\n`);
    pane(); plantCgroup(`${SLICE}/${UNIT}`, [MAIN, realSleep()]); arm();
    fs.writeFileSync(fx('wedged-read'), `${WEDGE_S}\n`);
    const out = h.sh(`${SEAMS}\n ${DEADLINES}\n ${LAUNCHD}
      _pane_for_keystroke() { KS_PANE='%1'; return 0; }; _idle_for_keystroke() { return 0; }
      cmd_hibernate ${ID}`);
    expect(out).toContain(`hibernated ${ID}`);
    expect(fs.existsSync(reg(`${ID}.hibernated`))).toBe(true);
    const c = asManagerCalls(h.calls());
    const disable = c.indexOf(`systemctl --user disable --now claude-session@${ID}`);
    expect(disable, c.join('\n')).toBeGreaterThanOrEqual(0);
    expect(disable, c.join('\n')).toBeLessThan(c.indexOf(READ));
    expect(scopeTexts()).toEqual([HELD]);
    expect(stops()).toEqual([]);
  }, 30_000);

  it('a spawn whose read hangs is not held either: it gives up inside the deadline and leaves no marker', () => {
    const LONG_S = 20;   // a read this file would wait out whole if it were not bounded
    pane();
    fs.writeFileSync(reg(`${ID}.panescope`), `${UNIT}\n`);   // a stale one from an earlier spawn
    fs.writeFileSync(fx('wedged-read'), `${LONG_S}\n`);
    const t0 = Date.now();
    h.sh(`${DEADLINES}\n _panescope_record ${ID}`);
    expect(Date.now() - t0).toBeLessThan((LONG_S - 5) * 1000);
    expect(fs.existsSync(reg(`${ID}.panescope`))).toBe(false);
  }, 40_000);

  it('control: a tmux that answers says nothing about a wedge', () => {
    pane(); plantCgroup(`${SLICE}/${UNIT}`, [MAIN]); arm();
    h.sh(`${SEAMS}\n ${DEADLINES}\n cmd_stop ${ID}`);
    expect(scopeTexts()).toEqual([`pane-scope ${ID}: nothing left in ${UNIT}`]);
  });
});

describe('what this does not touch', () => {
  it('the swap is not a stop: it never reaches the pane-scope stop or its reap, and reads the pane only through the graceful stop', () => {
    const body = h.sh('type cmd_swap; type _dispatch_swap; type _graceful_stop_before; type _graceful_stop_after; type _graceful_stop_observe');
    expect(body).not.toContain('_pane_scope_stop');
    expect(body).not.toContain('_pane_scope_reap');
    // `_graceful_stop_before` reads the pane (`_pane_scope_of`) for the swap, so the wide body names it; the swap's own does not.
    expect(h.sh('type cmd_swap; type _dispatch_swap')).not.toContain('_pane_scope_of');
    expect(h.sh('type cmd_swap')).toContain('_graceful_stop_before "$id" swap');
  });

  it('the stop reads no panescope marker: the scope comes from the live pane, through the helper the marker\'s writer calls', () => {
    const body = h.sh('type _pane_scope_stop; type _pane_scope_reap; type _pane_scope_of; type _panescope_record');
    expect(body).toMatch(/_panescope_record[\s\S]*_pane_scope_of/);
    expect(body).not.toMatch(/_reg_get\w*\s+\S+\s+panescope/);
  });
});

describe('ccd pane-scope-stop: the switch\'s one writer', () => {
  it('--state live raises the marker, --state shadow lowers it, and anything else is refused', () => {
    expect(h.sh('cmd_pane_scope_stop --state live')).toBe('live');
    expect(fs.existsSync(reg('pane-scope-stop-live'))).toBe(true);
    expect(h.sh('cmd_pane_scope_stop --state shadow')).toBe('shadow');
    expect(fs.existsSync(reg('pane-scope-stop-live'))).toBe(false);
    expect(h.sh('cmd_pane_scope_stop --state shadow')).toBe('shadow');
    expect(() => h.sh('cmd_pane_scope_stop --state on')).toThrow(/bad state/);
    expect(() => h.sh('cmd_pane_scope_stop')).toThrow(/usage: ccd pane-scope-stop --state live\|shadow/);
  });

  it('a dangling link at the marker\'s name is lowered too', () => {
    fs.symlinkSync(path.join(h.home, 'nowhere'), reg('pane-scope-stop-live'));
    expect(h.sh('cmd_pane_scope_stop --state shadow')).toBe('shadow');
    expect(fs.lstatSync(reg('pane-scope-stop-live'), { throwIfNoEntry: false })).toBeUndefined();
  });

  it('ccd caps lists the verb', () => {
    expect(h.sh('cmd_caps').split('\n')).toContain('pane-scope-stop');
  });
});
