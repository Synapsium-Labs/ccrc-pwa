/**
 * The automatic coordinator roll's ONE ccd act (D-7458): `ccd hibernate --roll <id>`.
 *
 * The roll was two server calls, `ccd hibernate` then `ccd ensure`. It is one verb now, so the server's executor
 * still runs ccd once and the journal carries one deliberate act. `--roll` keeps every hibernate refusal (busy, a
 * draft, an attached terminal, the turn marker, a hold, a fresh swap), refuses `.no-roll` as `opted-out` and NOT
 * `.no-hibernate`, and then wakes the session in the same verb (`cmd_ensure`). A failed wake exits 4 with
 * `ccd: roll-wake-failed` after putting the row back to sleep (the marker the wake cleared stamped again, the unit
 * stopped, the `.woke` stamp the wake wrote put back), leaving the hibernated row that mail or an open screen wakes.
 * When the marker cannot be written again it exits 5 with `ccd: roll-wake-unrestored` instead: not that row.
 *
 * THE FIXTURE is `ccd-hibernate.test.ts`'s: a fixture HOME, a stubbed `tmux` answering from files in HOME, logged
 * `systemctl`, and the pane's live file; the pane is gone once a `kill-session` has been called (a roll checks it).
 * The wake is `cmd_ensure` stubbed to log its call (or fail), so these rows pin the composition; `ccd-hibernate.test.ts`'s wake rows pin what `cmd_ensure` does to a hibernated row.
 * Neutral ids throughout (public repository).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-hibernate-roll-'); });
afterEach(() => { h.cleanup(); });

const ID = 'lane-a-project-a';
const UUID = 'a0000000-0000-4000-8000-000000000001';
const PID = '4242';
const reg = (): string => path.join(h.home, '.cc-sessions');
const regPath = (field: string, id = ID): string => path.join(reg(), `${id}.${field}`);
const has = (field: string, id = ID): boolean => fs.existsSync(regPath(field, id));

const STUBS = `
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"
    case "$*" in *pane_active*) echo "1 200"; return 0 ;; esac
    case "$*" in *session_attached*) [[ -e "$HOME/attached" ]] || return 1; cat "$HOME/attached"; return 0 ;; esac
    case "\${1:-}" in
      has-session)     grep -q kill-session "$HOME/ccd-calls" 2>/dev/null && { echo "can't find session"; return 1; } ;;
      capture-pane)    cat "$HOME/pane" 2>/dev/null ;;
      list-panes)      echo ${PID} ;;
    esac; return 0; };
  systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };
  launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; return 0; };
  sleep() { :; };
  cmd_ensure() { echo "ensure $*" >> "$HOME/ccd-calls"; [[ -e "$HOME/wake-fails" ]] && { echo "ccd: spawn failed" >&2; return 5; }; echo "ensured $1"; };
`;

const calls = (): string[] => h.calls();
const killAt = (): number => calls().findIndex((l) => /kill-session/.test(l));
const ensureAt = (): number => calls().findIndex((l) => l === `ensure ${ID}`);
const pane = (text: string): void => { fs.writeFileSync(path.join(h.home, 'pane'), `${text}\n`); };
const attached = (n: string): void => { fs.writeFileSync(path.join(h.home, 'attached'), `${n}\n`); };

const seed = (): void => {
  const wd = path.join(h.home, 'projects', 'project-a');
  fs.mkdirSync(wd, { recursive: true });
  h.sh(`_reg_set ${ID} uuid ${UUID}; _reg_set ${ID} wrapper claude; _reg_set ${ID} home claude
    _reg_set ${ID} project project-a; _reg_set ${ID} workdir ${wd}`);
};
const live = (status: string): void => {
  const dir = path.join(h.home, '.claude', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${PID}.json`), JSON.stringify({ pid: Number(PID), status, statusUpdatedAt: 1 }));
};
const marker = (): void => {
  const stopAt = Date.now() - 2 * 3_600_000;
  fs.writeFileSync(regPath('turn.json'), JSON.stringify({ v: 1, sessionId: UUID, state: 'done', event: 'Stop', at: stopAt,
    turnAt: stopAt - 60_000, stopAt, bg: 0, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0,
    lostKinds: '', lostIds: '', crons: 0 }) + '\n');
};
const idle = (): void => { seed(); pane('❯ '); live('idle'); marker(); attached('0'); };

const run = (args: string, extra = '', stubs = STUBS): { rc: number; err: string; out: string } => {
  const out = h.sh(`${stubs} ${extra} ( cmd_hibernate ${args} ) 2>"$HOME/err"; echo "rc=$?"`, { TMUX: '' });
  const rc = Number(/rc=(\d+)\s*$/.exec(out)?.[1] ?? 'NaN');
  return { rc, out, err: fs.readFileSync(path.join(h.home, 'err'), 'utf8') };
};
const roll = (flags = '', extra = ''): { rc: number; err: string; out: string } =>
  run(`--roll --surface agent --actor 'sweep:roll' ${flags} ${ID}`, extra);

describe('ccd hibernate --roll: one verb sleeps and wakes (D-7458)', () => {
  it('an idle session is hibernated, then woken in the same verb, after the pane is killed', () => {
    idle();
    const r = roll();
    expect(r.rc, r.err).toBe(0);
    expect(r.out).toContain(`hibernated ${ID}`);
    expect(r.out).toContain(`rolled ${ID}`);
    expect(killAt(), 'the pane is killed').toBeGreaterThanOrEqual(0);
    expect(ensureAt(), 'the wake ran after the kill').toBeGreaterThan(killAt());
  });

  it('the deliberate act is ONE hibernate row, carrying the declared actor and the reason roll', () => {
    idle();
    roll();
    const rows = eventsOf(h.home, 'hibernate');
    expect(rows).toHaveLength(1);
    expect(rows[0]!['dec']).toMatchObject({ surface: 'agent', actor: 'sweep:roll', reason: 'roll' });
  });

  it('a declared reason is kept, not replaced by roll', () => {
    idle();
    roll(`--reason 'release behind'`);
    expect(eventsOf(h.home, 'hibernate')[0]!['dec']).toMatchObject({ reason: 'release behind' });
  });

  it('.no-hibernate does NOT refuse a roll (the opt-out of sleep is not an opt-out of the roll)', () => {
    idle();
    fs.writeFileSync(regPath('no-hibernate'), '');
    const r = roll();
    expect(r.rc, r.err).toBe(0);
    expect(r.out).toContain(`rolled ${ID}`);
  });

  it('.no-roll refuses opted-out at exit 3 and touches nothing', () => {
    idle();
    fs.writeFileSync(regPath('no-roll'), '');
    const r = roll();
    expect(r.rc).toBe(3);
    expect(r.err).toMatch(/^ccd: session-busy: opted-out — .*no-roll/);
    expect(has('hibernated')).toBe(false);
    expect(eventsOf(h.home, 'hibernate')).toEqual([]);
    expect(killAt()).toBe(-1);
    expect(ensureAt()).toBe(-1);
  });

  it('control: without --roll, .no-roll does not refuse and .no-hibernate still does', () => {
    idle();
    fs.writeFileSync(regPath('no-roll'), '');
    fs.writeFileSync(regPath('no-hibernate'), '');
    const r = run(ID);
    expect(r.rc).toBe(3);
    expect(r.err).toMatch(/opted-out — .*no-hibernate/);
    fs.rmSync(regPath('no-hibernate'));
    const r2 = run(ID);
    expect(r2.rc, r2.err).toBe(0);
    expect(r2.out).not.toContain('rolled');
    expect(ensureAt(), 'a plain hibernate never wakes').toBe(-1);
  });

  it.each([
    ['busy', 'busy', () => { live('busy'); }, ''],
    ['esc to interrupt', 'busy', () => { pane('✻ Working… (esc to interrupt)\n❯ '); }, ''],
    ['a draft in the input box', 'draft', () => {}, '_pane_box_draft() { echo "> half a thought"; };'],
    ['an attached terminal', 'attached', () => { attached('1'); }, ''],
    ['a hold', 'held', () => { fs.writeFileSync(regPath('hold'), 'keep'); }, ''],
    ['no turn marker', 'marker', () => { fs.rmSync(regPath('turn.json')); }, ''],
  ])('%s still refuses %s at exit 3, and no wake follows', (_name, reason, set, extra) => {
    idle();
    set();
    const r = roll('', extra);
    expect(r.rc, r.err).toBe(3);
    expect(r.err).toContain(`ccd: session-busy: ${reason}`);
    expect(has('hibernated')).toBe(false);
    expect(eventsOf(h.home, 'hibernate')).toEqual([]);
    expect(ensureAt()).toBe(-1);
  });

  it('a failed wake exits 4 with roll-wake-failed and leaves the row hibernated', () => {
    idle();
    fs.writeFileSync(path.join(h.home, 'wake-fails'), '');
    const r = roll();
    expect(r.rc).toBe(4);
    expect(r.err).toMatch(/ccd: roll-wake-failed — .* exited 5/);
    expect(r.out).not.toContain('rolled');
    expect(has('hibernated'), 'the sanctioned hibernated row stands').toBe(true);
    expect(eventsOf(h.home, 'hibernate')).toHaveLength(1);
  });

  it('a failed wake through the REAL cmd_ensure puts the row back to sleep: .hibernated stands and the unit is stopped', () => {
    idle();
    // The real `cmd_ensure` clears `.hibernated` and `.stopped` before its spawn; the spawn is what fails here.
    const real = STUBS.replace(/^\s*cmd_ensure\(\).*$/m, '');
    expect(real).not.toContain('cmd_ensure');
    const failing = '_alive() { ! grep -q kill-session "$HOME/ccd-calls" 2>/dev/null; }; '
      + '_supervised_start() { echo "supervised-start $1" >> "$HOME/ccd-calls"; echo "ccd: $1: unit started but no pane appeared" >&2; return 1; };';
    const r = run(`--roll --surface agent --actor 'sweep:roll' ${ID}`, failing, real);
    expect(r.rc, r.err).toBe(4);
    const at = calls().indexOf(`supervised-start ${ID}`);
    expect(at, 'the real cmd_ensure reached its spawn').toBeGreaterThanOrEqual(0);
    expect(r.err).toMatch(/ccd: roll-wake-failed — .* exited 1; it was put back to sleep/);
    expect(r.out).not.toContain('rolled');
    expect(has('hibernated'), 'the marker the wake cleared is stamped again').toBe(true);
    expect(has('stopped'), 'the stop stamp the wake cleared is stamped again').toBe(true);
    // The platform's own stop of THIS unit: systemd's `disable --now` on Linux, launchd's `disable` of the session's
    // label on macOS (`_svc_disable_now`, after its `bootout`). The stubs log both managers, so the row runs on either.
    const stopped = new RegExp(`^(?:systemctl --user disable --now claude-session@${ID}|launchctl disable gui/\\d+/app\\.ccrc\\.session\\.${ID})$`);
    expect(calls().slice(at).some((l) => stopped.test(l)), 'the unit the wake enabled is stopped').toBe(true);
    expect(eventsOf(h.home, 'hibernate'), 'still ONE deliberate act').toHaveLength(1);
  });

  it('a failed wake through the REAL cmd_ensure takes back the .woke stamp it wrote when none stood: nothing woke', () => {
    idle();
    const real = STUBS.replace(/^\s*cmd_ensure\(\).*$/m, '');
    const failing = '_alive() { ! grep -q kill-session "$HOME/ccd-calls" 2>/dev/null; }; '
      + '_supervised_start() { echo "supervised-start $1" >> "$HOME/ccd-calls"; echo "ccd: $1: unit started but no pane appeared" >&2; return 1; };';
    const r = run(`--roll --surface agent --actor 'sweep:roll' ${ID}`, failing, real);
    expect(r.rc, r.err).toBe(4);
    expect(calls()).toContain(`supervised-start ${ID}`);
    expect(has('woke'), 'a wake that failed leaves no wake stamp').toBe(false);
  });

  it('a failed wake through the REAL cmd_ensure puts an earlier wake\'s .woke stamp back, unchanged', () => {
    idle();
    const real = STUBS.replace(/^\s*cmd_ensure\(\).*$/m, '');
    const failing = '_alive() { ! grep -q kill-session "$HOME/ccd-calls" 2>/dev/null; }; '
      + '_supervised_start() { echo "supervised-start $1" >> "$HOME/ccd-calls"; echo "ccd: $1: unit started but no pane appeared" >&2; return 1; };';
    fs.writeFileSync(regPath('woke'), '1700000000');
    const r2 = run(`--roll --surface agent --actor 'sweep:roll' ${ID}`, failing, real);
    expect(r2.rc, r2.err).toBe(4);
    expect(fs.readFileSync(regPath('woke'), 'utf8').trim(), 'the stamp that stood before the wake').toBe('1700000000');
  });

  it('control: a wake that succeeds through the REAL cmd_ensure keeps the .woke stamp it wrote', () => {
    idle();
    const real = STUBS.replace(/^\s*cmd_ensure\(\).*$/m, '');
    const starting = '_alive() { ! grep -q kill-session "$HOME/ccd-calls" 2>/dev/null; }; '
      + '_supervised_start() { echo "supervised-start $1" >> "$HOME/ccd-calls"; return 0; };';
    const r = run(`--roll --surface agent --actor 'sweep:roll' ${ID}`, starting, real);
    expect(r.rc, r.err).toBe(0);
    expect(r.out).toContain(`rolled ${ID}`);
    expect(calls(), 'the real cmd_ensure reached its spawn').toContain(`supervised-start ${ID}`);
    expect(has('woke'), 'the wake stamped .woke').toBe(true);
  });

  it('a failed wake whose .hibernated cannot be written again exits 5 with roll-wake-unrestored, never roll-wake-failed', () => {
    idle();
    // The wake clears the marker, then the registry refuses it: a directory stands where the file would go.
    const unwritable = 'cmd_ensure() { echo "ensure $*" >> "$HOME/ccd-calls"; rm -f -- "$REG/$1.hibernated"; '
      + 'mkdir -p -- "$REG/$1.hibernated"; echo "ccd: spawn failed" >&2; return 5; };';
    const r = roll('', unwritable);
    expect(r.rc, r.err).toBe(5);
    expect(r.err).toMatch(/ccd: roll-wake-unrestored — .* exited 5, and .*hibernated could not be written again: .* may be neither running nor hibernated/);
    expect(r.err).not.toContain('roll-wake-failed');
    expect(r.out).not.toContain('rolled');
    expect(fs.statSync(regPath('hibernated')).isFile(), 'no hibernated marker file stands').toBe(false);
    expect(eventsOf(h.home, 'hibernate'), 'still ONE deliberate act').toHaveLength(1);
  });

  it('a failed wake whose pane is still live after the put-back\'s kill exits 5 with roll-wake-unrestored, never "put back to sleep"', () => {
    idle();
    fs.writeFileSync(path.join(h.home, 'wake-fails'), '');
    // The act's kill lands (the pane is gone for the act's own check); the failed wake raised a pane that survives the
    // put-back's kill, so `has-session` is live again from the second `kill-session` on.
    const survives = 'eval "$(declare -f tmux | sed \'1s/^tmux/_tmux_stub/\')"; '
      + 'tmux() { if [[ "${1:-}" == has-session ]]; then echo "tmux $*" >> "$HOME/ccd-calls"; '
      + 'local k; k=$(grep -c kill-session "$HOME/ccd-calls" 2>/dev/null); '
      + '[[ "${k:-0}" == 1 ]] && { echo "can\'t find session"; return 1; }; return 0; fi; _tmux_stub "$@"; };';
    const r = roll('', survives);
    expect(calls().filter((l) => /kill-session/.test(l)), 'the act\'s kill and the put-back\'s kill').toHaveLength(2);
    expect(r.rc, r.err).toBe(5);
    expect(r.err).toMatch(new RegExp(`ccd: roll-wake-unrestored — ${ID} was hibernated and its wake exited 5, and a pane is still live after the put-back: ${ID} may be neither running nor hibernated`));
    expect(r.err).not.toContain('roll-wake-failed');
    expect(r.err).not.toContain('put back to sleep');
    expect(r.out).not.toContain('rolled');
  });

  it('a pane kill that fails on a live session exits 6 with roll-kill-failed: never rolled, and no wake is tried', () => {
    idle();
    // tmux refuses the kill and the pane is still there afterwards.
    const stuck = 'eval "$(declare -f tmux | sed \'1s/^tmux/_tmux_stub/\')"; '
      + 'tmux() { [[ "${1:-}" == kill-session ]] && { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; }; _tmux_stub "$@"; }; '
      + '_alive() { return 0; };';
    const r = roll('', stuck);
    expect(r.rc, r.err).toBe(6);
    expect(r.err).toMatch(new RegExp(`ccd: roll-kill-failed — ${ID}'s pane could not be killed`));
    expect(r.err).toMatch(/it was not rolled/);
    expect(r.out).not.toContain('rolled');
    expect(killAt(), 'the kill was tried').toBeGreaterThanOrEqual(0);
    expect(ensureAt(), 'no wake follows a kill that did not land').toBe(-1);
  });

  it('control: a pane kill that fails on a session already gone is not a kill failure, and the wake follows', () => {
    idle();
    const gone = 'eval "$(declare -f tmux | sed \'1s/^tmux/_tmux_stub/\')"; '
      + 'tmux() { [[ "${1:-}" == kill-session ]] && { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; }; _tmux_stub "$@"; }; '
      + '_alive() { ! grep -q kill-session "$HOME/ccd-calls" 2>/dev/null; };';
    const r = roll('', gone);
    expect(r.rc, r.err).toBe(0);
    expect(r.out).toContain(`rolled ${ID}`);
  });

  it('a failed wake whose unit cannot be stopped again exits 5 with roll-wake-unrestored, never "put back to sleep"', () => {
    idle();
    fs.writeFileSync(path.join(h.home, 'wake-fails'), '');
    const r = roll('', '_svc_disable_now() { echo "disable $*" >> "$HOME/ccd-calls"; return 1; };');
    expect(r.rc, r.err).toBe(5);
    expect(r.err).toMatch(new RegExp(`ccd: roll-wake-unrestored — ${ID} was hibernated and its wake exited 5, and its unit claude-session@${ID} could not be stopped again: ${ID} may be neither running nor hibernated`));
    expect(r.err).not.toContain('roll-wake-failed');
    expect(r.err).not.toContain('put back to sleep');
    expect(r.out).not.toContain('rolled');
  });

  it('a roll does not take a standing .hibernated as done: the re-measure runs and the act lands', () => {
    idle();
    fs.writeFileSync(regPath('hibernated'), '1 7\n');
    const r = roll();
    expect(r.rc, r.err).toBe(0);
    expect(r.out).not.toContain('already hibernated');
    expect(r.out).toContain(`rolled ${ID}`);
  });

  it('a roll on a row already asleep is not answered already-hibernated: the re-measure finds no pane and refuses', () => {
    idle();
    fs.writeFileSync(regPath('hibernated'), '1 7\n');
    const gone = '_session_verdict() { echo gone; }; _pane_for_keystroke() { KS_WHY=no-pane; KS_DETAIL=; return 1; };';
    const plain = run(ID, gone);
    expect(plain.rc, 'control: a plain hibernate is idempotent here').toBe(0);
    expect(plain.out).toContain(`already hibernated ${ID}`);
    const r = roll('', gone);
    expect(r.rc).toBe(3);
    expect(r.err).toContain('ccd: session-busy: busy');
    expect(r.out).not.toContain('already hibernated');
    expect(ensureAt(), 'a sleeping row is woken by mail or a screen, not by a roll').toBe(-1);
  });

  it('--roll takes no value', () => {
    idle();
    const r = run(`--roll=1 ${ID}`);
    expect(r.rc).toBe(1);
    expect(r.err).toContain('usage: ccd hibernate');
    expect(has('hibernated')).toBe(false);
  });

  it('caps advertises hibernate-roll', () => {
    expect(h.sh('cmd_caps').split('\n')).toContain('hibernate-roll');
  });
});
