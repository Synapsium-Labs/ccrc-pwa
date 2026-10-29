/**
 * The automatic coordinator roll's ONE ccd act (D-7458): `ccd hibernate --roll <id>`.
 *
 * The roll was two server calls, `ccd hibernate` then `ccd ensure`. It is one verb now, so the server's executor
 * still runs ccd once and the journal carries one deliberate act. `--roll` keeps every hibernate refusal (busy, a
 * draft, an attached terminal, the turn marker, a hold, a fresh swap), refuses `.no-roll` as `opted-out` and NOT
 * `.no-hibernate`, and then wakes the session in the same verb (`cmd_ensure`). A failed wake exits 4 with
 * `ccd: roll-wake-failed`, leaving the hibernated row that mail or an open screen wakes.
 *
 * THE FIXTURE is `ccd-hibernate.test.ts`'s: a fixture HOME, a stubbed `tmux` answering from files in HOME, logged
 * `systemctl`, and the pane's live file. The wake is `cmd_ensure` stubbed to log its call (or fail), so these rows
 * pin the composition; `ccd-hibernate.test.ts`'s wake rows pin what `cmd_ensure` does to a hibernated row.
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

const run = (args: string, extra = ''): { rc: number; err: string; out: string } => {
  const out = h.sh(`${STUBS} ${extra} ( cmd_hibernate ${args} ) 2>"$HOME/err"; echo "rc=$?"`, { TMUX: '' });
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
