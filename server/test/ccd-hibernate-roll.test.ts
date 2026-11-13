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
import { makeCcdHarness, type CcdHarness, boxed } from './ccdWsHelpers.js';
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
const idle = (): void => { seed(); pane(boxed()); live('idle'); marker(); attached('0'); };

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

  // D-8276 (the operator's ruling of 2026-11-10): every idle session rolls, not only coordinators. The act never read
  // the role (the 10-29 rule lived in the server's verdict), and these rows pin that it still does not: a dispatched
  // child (`$REG/<id>.child` naming its run) rolls by the same one act, and keeps every refusal.
  it('D-8276: an idle dispatched child (a .child marker) is rolled by the same one act', () => {
    idle();
    h.sh(`_reg_set ${ID} child 7`);
    const r = roll();
    expect(r.rc, r.err).toBe(0);
    expect(r.out).toContain(`rolled ${ID}`);
    expect(ensureAt(), 'the wake ran after the kill').toBeGreaterThan(killAt());
    expect(has('child'), 'the roll leaves the child marker as it was').toBe(true);
  });

  it('D-8276: a busy dispatched child is never rolled: busy at exit 3, nothing touched', () => {
    idle();
    h.sh(`_reg_set ${ID} child 7`);
    live('busy');
    const r = roll();
    expect(r.rc, r.err).toBe(3);
    expect(r.err).toContain('ccd: session-busy: busy');
    expect(has('hibernated')).toBe(false);
    expect(killAt()).toBe(-1);
    expect(ensureAt()).toBe(-1);
  });

  it('D-8276: a dispatched child carrying .no-roll is refused opted-out', () => {
    idle();
    h.sh(`_reg_set ${ID} child 7`);
    fs.writeFileSync(regPath('no-roll'), '');
    const r = roll();
    expect(r.rc).toBe(3);
    expect(r.err).toMatch(/^ccd: session-busy: opted-out — .*no-roll/);
    expect(killAt()).toBe(-1);
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

/**
 * The fresh start (overlord W1a; spec 2026-11-09 §3.3.11 H13): `ccd hibernate --roll --fresh <id>` is the roll whose wake
 * starts a NEW conversation under the same session id. After the sleep the roll mints a uuid, names it in the one-shot
 * marker `$REG/<id>.fresh` and writes it as the row's uuid; the spawn that marker chooses (`_spawn_mode`) is
 * `--session-id`, never `--resume`, and consumes it, leaving the receipt `used <uuid>` the roll reads as its proof. The
 * marker is the carrier because the roll's wake spawns in the unit's OWN process (plan review 1890 C2). It is a mode of
 * the roll, so it has every refusal and exit code `--roll` has. A failed wake put back to sleep (exit 4) removes the
 * marker and puts the old uuid back; on exit 5 the new uuid and its marker stand (plan review 1896 m-B6). A wake that
 * answered 0 without the receipt (a concurrent wake resumed the old conversation) exits 7, `roll-fresh-unproven`, with the
 * old uuid back (review 1904 F1).
 *
 * These rows run the REAL `cmd_ensure` and the REAL `_spawn_start` with the settle stubbed; tmux logs the composed
 * `new-session` line, which is the spawn's argv. The unsupervised rows take the no-systemd fallback (the mode computed in
 * this process); the supervised row starts the "unit" as a separate bash process that sources ccd afresh and runs
 * `cmd_ensure` with `CCD_IN_UNIT=1`, as `ccd supervise` does, so nothing but the registry crosses.
 */
describe('ccd hibernate --roll --fresh: the roll whose wake starts a fresh conversation (overlord W1a)', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const REAL = STUBS.replace(/^\s*cmd_ensure\(\).*$/m, '');
  const SPAWNS = '_have_systemctl() { return 1; }; _spawn_settle() { return 0; };';
  const news = (): string[] => calls().filter((l) => /^tmux new-session/.test(l));
  const uuidNow = (): string => fs.readFileSync(regPath('uuid'), 'utf8').trim();
  const claimed = (): void => { idle(); h.sh(`_reg_claim ${ID}`); };
  const fresh = (flags = '--roll --fresh', extra = ''): { rc: number; err: string; out: string } =>
    run(`${flags} --surface agent --actor 'sweep:renew' ${ID}`, `${SPAWNS} ${extra}`, REAL);

  it('control: the same fixture under a plain --roll resumes the old uuid', () => {
    claimed();
    const r = run(`--roll --surface agent --actor 'sweep:roll' ${ID}`, SPAWNS, REAL);
    expect(r.rc, r.err).toBe(0);
    expect(news()[0]).toContain(`--resume '${UUID}'`);
  });

  it('wakes with --session-id of a NEW uuid, never --resume; the registry names it, started stays 1, the marker is spent', () => {
    claimed();
    const r = fresh();
    expect(r.rc, r.err).toBe(0);
    expect(r.out).toContain(`rolled ${ID}`);
    const u2 = uuidNow();
    expect(u2).toMatch(UUID_RE);
    expect(u2).not.toBe(UUID);
    expect(news(), 'one spawn').toHaveLength(1);
    expect(news()[0]).toContain(`--session-id '${u2}'`);
    expect(news()[0]).not.toContain('--resume');
    expect(has('fresh'), 'the spawn consumed the marker, and the roll took its receipt').toBe(false);
    expect(fs.readFileSync(regPath('started'), 'utf8').trim()).toBe('1');
    expect(eventsOf(h.home, 'hibernate'), 'ONE deliberate act, and no failure row').toHaveLength(1);
    const log = fs.readFileSync(path.join(reg(), 'swap.log'), 'utf8');
    expect(log, 'swap.log names both uuids').toContain(`hibernate ${ID}: fresh start, uuid ${UUID} -> ${u2}\n`);
    expect(log).toContain(`hibernate ${ID}: fresh start writes rc 0\n`);
    expect(log.indexOf(`uuid ${UUID} -> ${u2}`), 'the uuids are logged before the writes\' rc').toBeLessThan(log.indexOf('writes rc 0'));
  });

  it('on the SUPERVISED path the marker crosses into the unit\'s own process, and that spawn is --session-id of the new uuid', () => {
    claimed();
    // The unit: a separate bash that sources ccd afresh, so no local, flag or variable of the roll reaches it.
    const unit = '_alive() { grep -q new-session "$HOME/ccd-calls" 2>/dev/null; }; _spawn_settle() { return 0; };';
    const waker = `${unit} _have_systemctl() { return 0; }; _svc_reset_failed() { :; };
      _svc_enable_now() { echo "enable $1" >> "$HOME/ccd-calls"
        UNIT_SRC="$ccd_h_src" bash -c 'source "$UNIT_SRC"; FLEET_SPAWN_PINS=; eval "$UNIT_STUBS"; CCD_IN_UNIT=1; cmd_ensure "$1"' _ "\${1#claude-session@}" >/dev/null 2>&1
        return 0; };`;
    const out = h.sh(`${REAL} ${waker} ( cmd_hibernate --roll --fresh --surface agent --actor 'sweep:renew' ${ID} ) 2>"$HOME/err"; echo "rc=$?"`,
      { TMUX: '', UNIT_STUBS: `${REAL} ${unit}` });
    expect(out, fs.readFileSync(path.join(h.home, 'err'), 'utf8')).toContain('rc=0');
    expect(out).toContain(`rolled ${ID}`);
    expect(calls()).toContain(`enable claude-session@${ID}`);
    const u2 = uuidNow();
    expect(u2).not.toBe(UUID);
    expect(news(), 'the unit spawned once').toHaveLength(1);
    expect(news()[0]).toContain(`--session-id '${u2}'`);
    expect(news()[0]).not.toContain('--resume');
    expect(has('fresh'), 'the unit\'s spawn consumed the marker').toBe(false);
  });

  it('the marker is one-shot: a later spawn (the unit\'s restart) resumes the new conversation, never a third uuid', () => {
    claimed();
    expect(fresh().rc).toBe(0);
    const u2 = uuidNow();
    h.sh(`${REAL} ${SPAWNS} ( cmd_ensure ${ID} ) >/dev/null 2>&1`, { TMUX: '' });
    expect(news()[1]).toContain(`--resume '${u2}'`);
    // The restart's resume of u2 finds no conversation (no pane comes up), so `_spawn_start`'s one retry is `--session-id u2`.
    expect(news()[2]).toContain(`--session-id '${u2}'`);
    expect(news()).toHaveLength(3);
    expect(news().every((l) => l.includes(`'${u2}'`)), 'every later spawn names the same new uuid').toBe(true);
    expect(uuidNow()).toBe(u2);
  });

  it('a STALE marker (a roll killed between its two writes: it names another uuid) is removed by the spawn, said on stderr, and the spawn resumes', () => {
    claimed();
    fs.writeFileSync(regPath('fresh'), 'b0000000-0000-4000-8000-000000000002\n');
    const err = h.sh(`${REAL} ${SPAWNS} _alive() { return 1; }; ( cmd_ensure ${ID} ) 2>&1 >/dev/null`, { TMUX: '' });
    expect(news()[0]).toContain(`--resume '${UUID}'`);
    expect(has('fresh'), 'no stale marker outlives the spawn').toBe(false);
    expect(err).toContain(`ccd: ${ID}: removing a stale fresh-start marker (it names b0000000-0000-4000-8000-000000000002; this spawn is resume of ${UUID})`);
  });

  it.each([
    ['garbage', 'not-a-uuid\n', 'it names not-a-uuid;'],
    ['empty', '', 'it names nothing readable;'],
  ])('a marker that does not parse (%s) is stale: removed, named on stderr, and the spawn resumes', (_n, body, said) => {
    claimed();
    fs.writeFileSync(regPath('fresh'), body);
    const err = h.sh(`${REAL} ${SPAWNS} _alive() { return 1; }; ( cmd_ensure ${ID} ) 2>&1 >/dev/null`, { TMUX: '' });
    expect(news()[0]).toContain(`--resume '${UUID}'`);
    expect(has('fresh')).toBe(false);
    expect(err).toContain(`removing a stale fresh-start marker (${said}`);
  });

  it('control: a marker that names the row\'s uuid is not stale: the spawn uses it and says nothing of staleness', () => {
    claimed();
    fs.writeFileSync(regPath('fresh'), `${UUID}\n`);
    const err = h.sh(`${REAL} ${SPAWNS} _alive() { return 1; }; ( cmd_ensure ${ID} ) 2>&1 >/dev/null`, { TMUX: '' });
    expect(news()[0]).toContain(`--session-id '${UUID}'`);
    expect(h.reg(ID, 'fresh'), 'the consuming spawn leaves its receipt').toBe(`used ${UUID}`);
    expect(err).not.toContain('stale fresh-start marker');
  });

  it('--fresh without --roll dies with the usage line (exit 1, die) and touches nothing', () => {
    claimed();
    const r = fresh(`--fresh`);
    expect(r.rc).toBe(1);
    expect(r.err).toContain('usage: ccd hibernate');
    expect(has('hibernated')).toBe(false);
    expect(has('fresh')).toBe(false);
    expect(killAt()).toBe(-1);
    expect(uuidNow()).toBe(UUID);
  });

  it('--fresh takes no value', () => {
    claimed();
    const r = fresh(`--roll --fresh=x`);
    expect(r.rc).toBe(1);
    expect(r.err).toContain('usage: ccd hibernate');
    expect(has('hibernated')).toBe(false);
    expect(uuidNow()).toBe(UUID);
  });

  it.each([
    ['.no-roll', 'opted-out', () => { fs.writeFileSync(regPath('no-roll'), ''); }],
    ['busy', 'busy', () => { live('busy'); }],
    ['a hold', 'held', () => { fs.writeFileSync(regPath('hold'), 'keep'); }],
  ])('%s refuses %s at exit 3, as --roll does, and the uuid is unchanged', (_name, reason, set) => {
    claimed();
    set();
    const r = fresh();
    expect(r.rc, r.err).toBe(3);
    expect(r.err).toContain(`ccd: session-busy: ${reason}`);
    expect(has('hibernated')).toBe(false);
    expect(has('fresh')).toBe(false);
    expect(news()).toEqual([]);
    expect(uuidNow()).toBe(UUID);
  });

  it('a failed wake exits 4 with roll-wake-failed, as --roll; the marker goes and the old uuid is back', () => {
    claimed();
    fs.writeFileSync(path.join(h.home, 'wake-fails'), '');
    const r = run(`--roll --fresh --surface agent --actor 'sweep:renew' ${ID}`);
    expect(r.rc).toBe(4);
    expect(r.err).toMatch(/ccd: roll-wake-failed — .* exited 5/);
    expect(r.out).not.toContain('rolled');
    expect(has('hibernated')).toBe(true);
    expect(has('fresh'), 'no marker outlives the failed wake').toBe(false);
    expect(uuidNow(), 'the old conversation is what mail wakes').toBe(UUID);
  });

  it('a failed wake that exits 5 (roll-wake-unrestored) keeps the NEW uuid: a pane may still run the new conversation', () => {
    claimed();
    const unwritable = 'cmd_ensure() { echo "ensure $*" >> "$HOME/ccd-calls"; rm -f -- "$REG/$1.hibernated"; '
      + 'mkdir -p -- "$REG/$1.hibernated"; echo "ccd: spawn failed" >&2; return 5; };';
    const r = run(`--roll --fresh --surface agent --actor 'sweep:renew' ${ID}`, unwritable);
    expect(r.rc, r.err).toBe(5);
    expect(r.err).toContain('roll-wake-unrestored');
    expect(uuidNow(), 'the registry keeps naming the conversation that may be running').not.toBe(UUID);
    expect(uuidNow()).toMatch(UUID_RE);
    expect(h.reg(ID, 'fresh'), 'no spawn consumed it, so the marker stands and names the new uuid').toBe(uuidNow());
  });

  it('a mint that fails takes the wake-failed arm: exit 4, no wake tried, no marker, the old uuid', () => {
    claimed();
    const r = fresh('--roll --fresh', '_plat_uuid() { return 1; };');
    expect(r.rc, r.err).toBe(4);
    expect(r.err).toContain('roll-wake-failed');
    expect(news(), 'no wake was tried').toEqual([]);
    expect(has('fresh')).toBe(false);
    expect(uuidNow()).toBe(UUID);
    expect(has('hibernated')).toBe(true);
  });

  it('a marker write that fails takes the same arm: exit 4, no wake tried, the old uuid', () => {
    claimed();
    const failing = 'eval "$(declare -f _reg_set | sed \'1s/^_reg_set/_reg_set_real/\')"; '
      + '_reg_set() { [[ "$2" == fresh ]] && return 1; _reg_set_real "$@"; };';
    const r = fresh('--roll --fresh', failing);
    expect(r.rc, r.err).toBe(4);
    expect(news()).toEqual([]);
    expect(uuidNow()).toBe(UUID);
    expect(fs.readFileSync(path.join(reg(), 'swap.log'), 'utf8')).toMatch(/fresh start writes rc 1\n/);
  });

  // REVIEW 1904 F1: a concurrent wake (the mail lane's `ensure`) can land in the window between the kill and the roll's
  // own wake. The roll's wake then answers `alive:` at exit 0, and only the consuming spawn's receipt says whether the
  // conversation is fresh. Both races are run with the REAL `cmd_ensure` as the concurrent wake.
  const CONCURRENT = `_alive() { grep -q new-session "$HOME/ccd-calls" 2>/dev/null; }; wake_now() { ( cmd_ensure ${ID} ) >/dev/null 2>&1; };`;
  const unproven = (r: { rc: number; err: string; out: string }): void => {
    expect(r.rc, r.err).toBe(7);
    expect(r.err).toMatch(new RegExp(`ccd: roll-fresh-unproven — ${ID} woke, but not into the fresh conversation [0-9a-f-]{36} .*its uuid is back to ${UUID}`));
    expect(r.out).not.toContain(`rolled ${ID}`);
    expect(news().some((l) => l.includes(`--resume '${UUID}'`)), 'the concurrent wake resumed the OLD conversation').toBe(true);
    expect(news().filter((l) => !l.includes(`'${UUID}'`)), 'no spawn of the new uuid ran').toEqual([]);
    expect(has('fresh'), 'no marker is left').toBe(false);
    expect(uuidNow(), 'the registry names the conversation that runs').toBe(UUID);
    expect(fs.readFileSync(path.join(reg(), 'swap.log'), 'utf8')).toContain(`hibernate ${ID}: fresh start unproven`);
    expect(eventsOf(h.home, 'hibernate').filter((e) => e['outcome'] === 'failed').map((e) => e['refusal']))
      .toEqual(['roll-fresh-unproven']);
  };

  it('F1, a wake BEFORE the writes: the pane resumed the old uuid, the roll answers alive, and it is exit 7, not success', () => {
    claimed();
    const before = 'eval "$(declare -f _plat_uuid | sed \'1s/^_plat_uuid/_plat_uuid_real/\')"; _plat_uuid() { wake_now; _plat_uuid_real; };';
    unproven(fresh('--roll --fresh', `${CONCURRENT} ${before}`));
  });

  it('F1, a wake BETWEEN the writes: the spawn removes the marker as stale and resumes, and it is exit 7, not success', () => {
    claimed();
    const between = 'eval "$(declare -f _reg_set | sed \'1s/^_reg_set/_reg_set_real/\')"; '
      + '_reg_set() { _reg_set_real "$@"; local rc=$?; if [[ "$2" == fresh && ! -e "$HOME/woke-once" ]]; then : > "$HOME/woke-once"; wake_now; fi; return $rc; };';
    unproven(fresh('--roll --fresh', `${CONCURRENT} ${between}`));
  });

  it('caps advertises hibernate-fresh', () => {
    expect(h.sh('cmd_caps').split('\n')).toContain('hibernate-fresh');
  });
});
