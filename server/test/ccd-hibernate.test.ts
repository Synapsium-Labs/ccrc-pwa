/**
 * Hibernation, `ccd` half (`hibernate-long-idle-sessions` (D-5242); spec 2026-10-16 §5.11).
 *
 * `ccd hibernate <id>` is the act the server's verdict asks for. It re-measures,
 * at the act, every box-local fact the decision read, plus the one the server
 * cannot see (a terminal attached to the pane), and any doubt refuses
 * `session-busy: <reason>` at exit 3 touching NOTHING — no marker, no stop
 * stamp, no unit disabled, no pane killed, and no `hibernate` journal row. The
 * act journals `hibernate` FIRST (what makes it deliberate to the
 * dead-coordinator lane), then writes `.hibernated`, unsupervises and kills
 * the pane. `ensure` and `start` wake it (`.woke`); `stop` and `ws-archive` end
 * it; `forget` and `swap` refuse it; a woken row takes no cosmetic swap.
 *
 * THE FIXTURE. A fixture HOME (`makeCcdHarness`), a stubbed `tmux` whose
 * answers come from files in HOME (`pane` is what `capture-pane` prints,
 * `attached` what `#{session_attached}` prints, absent = tmux failed), logged
 * `systemctl`/`launchctl`, and Claude Code's live file for the pane's process.
 * Neutral ids throughout (public repository): the session `lane-a-project-a`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, readJournal } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-hibernate-'); });
afterEach(() => { h.cleanup(); });

const ID = 'lane-a-project-a';
const UUID = 'a0000000-0000-4000-8000-000000000001';
const PID = '4242';
const nowS = (): number => Math.floor(Date.now() / 1000);
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
      kill-session)    [[ -e "$HOME/kill-exits" ]] && exit 9 ;;
    esac; return 0; };
  systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };
  launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; return 0; };
  sleep() { :; };
`;

const calls = (): string[] => h.calls();
const killed = (): boolean => calls().some((l) => /kill-session/.test(l));
const disabled = (): boolean => calls().some((l) => /(systemctl|launchctl) .*(disable|bootout)/.test(l));
const swapLog = (): string => {
  const p = path.join(reg(), 'swap.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
const pane = (text: string): void => { fs.writeFileSync(path.join(h.home, 'pane'), `${text}\n`); };
const attached = (n: string | null): void => {
  const p = path.join(h.home, 'attached');
  if (n === null) fs.rmSync(p, { force: true }); else fs.writeFileSync(p, `${n}\n`);
};

/** The registry row and its workdir. */
const seed = (): void => {
  const wd = path.join(h.home, 'projects', 'project-a');
  fs.mkdirSync(wd, { recursive: true });
  h.sh(`_reg_set ${ID} uuid ${UUID}; _reg_set ${ID} wrapper claude; _reg_set ${ID} home claude
    _reg_set ${ID} project project-a; _reg_set ${ID} workdir ${wd}`);
};
/** Claude Code's live file for the pane's process. */
const live = (status: string, suaMs = 1): void => {
  const dir = path.join(h.home, '.claude', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${PID}.json`), JSON.stringify({ pid: Number(PID), status, statusUpdatedAt: suaMs }));
};
/** The hook's turn marker, the writer's own key order; `over` replaces keys, an `undefined` value drops one. */
const marker = (over: Record<string, unknown> = {}): void => {
  const stopAt = Date.now() - 7.5 * 3_600_000;
  const m: Record<string, unknown> = { v: 1, sessionId: UUID, state: 'done', event: 'Stop', at: stopAt,
    turnAt: stopAt - 60_000, stopAt, bg: 0, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0,
    lostKinds: '', lostIds: '', crons: 0, ...over };
  for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
  fs.writeFileSync(regPath('turn.json'), JSON.stringify(m) + '\n');
};
/** An idle session at a clean boundary, every hold clear. */
const idle = (): void => { seed(); pane('❯ '); live('idle'); marker(); attached('0'); };

const hibernate = (extra = '', args = ID): { rc: number; err: string; out: string } => {
  const out = h.sh(`${STUBS} ${extra} ( cmd_hibernate ${args} ) 2>"$HOME/err"; echo "rc=$?"`, { TMUX: '' });
  const rc = Number(/rc=(\d+)\s*$/.exec(out)?.[1] ?? 'NaN');
  return { rc, out, err: fs.readFileSync(path.join(h.home, 'err'), 'utf8') };
};

describe('ccd hibernate: an idle session is put to sleep, journalled as deliberate', () => {
  it('journals hibernate, writes the marker, stamps stopped, disables the unit, kills the pane, logs', () => {
    idle();
    const r = hibernate();
    expect(r.rc, r.err).toBe(0);
    expect(r.out).toContain(`hibernated ${ID}`);
    const rows = eventsOf(h.home, 'hibernate');
    expect(rows).toHaveLength(1);
    expect(rows[0]!['outcome']).toBe('done');
    // The hibernate row comes BEFORE the unsupervise row `_ws_unsupervise` writes.
    const acts = readJournal(h.home).map((e) => String(e['act']));
    expect(acts.indexOf('hibernate')).toBeGreaterThanOrEqual(0);
    expect(acts.indexOf('hibernate')).toBeLessThan(acts.indexOf('unsupervise'));
    expect(fs.readFileSync(regPath('hibernated'), 'utf8')).toMatch(/^\d+ 7$/);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d+ ccd$/);
    expect(disabled(), 'the unit is disabled').toBe(true);
    expect(killed(), 'the pane is killed').toBe(true);
    expect(swapLog()).toMatch(new RegExp(`hibernate ${ID}: idle 7h`));
  });

  it('a kill that ends the shell still leaves the journal row and the marker (both precede the kill)', () => {
    idle();
    fs.writeFileSync(path.join(h.home, 'kill-exits'), '');
    hibernate();
    expect(eventsOf(h.home, 'hibernate'), 'the deliberate row is down before the kill').toHaveLength(1);
    expect(has('hibernated'), 'the marker is down before the kill').toBe(true);
  });

  it('the dec flags are stripped before the arity rule and land on the journal row', () => {
    idle();
    const r = hibernate('', `--surface agent --actor 'sweep:hibernate' ${ID}`);
    expect(r.rc, r.err).toBe(0);
    const dec = eventsOf(h.home, 'hibernate')[0]!['dec'] as Record<string, unknown>;
    expect(dec).toMatchObject({ surface: 'agent', actor: 'sweep:hibernate' });
  });

  it('a second positional is refused before anything is read', () => {
    idle();
    const r = hibernate('', `${ID} extra`);
    expect(r.rc).toBe(1);
    expect(r.err).toContain('usage: ccd hibernate');
    expect(has('hibernated')).toBe(false);
  });
});

describe('ccd hibernate: every re-measure refuses session-busy at exit 3 and touches nothing', () => {
  const cases: Array<[string, string, () => void, string?]> = [
    ['the live word busy', 'busy', () => { live('busy'); }],
    ['esc to interrupt on the pane', 'busy', () => { pane('✻ Working… (esc to interrupt)\n❯ '); }],
    ['a draft in the box', 'draft', () => {}, '_pane_box_draft() { echo "> half a thought"; };'],
    ['the marker working', 'marker', () => { marker({ state: 'working', stopAt: null }); }],
    ['the marker failed', 'marker', () => { marker({ state: 'failed' }); }],
    ['no marker at all', 'marker', () => { fs.rmSync(regPath('turn.json')); }],
    ['bg 1 with kind shell', 'background', () => { marker({ bg: 1, bgKinds: 'shell', bgIds: 'b0000001' }); }],
    ['bg -1 (a Stop that listed nothing)', 'background', () => { marker({ bg: -1 }); }],
    ['crons 1', 'scheduled', () => { marker({ crons: 1 }); }],
    ['crons -1', 'scheduled', () => { marker({ crons: -1 }); }],
    ['a marker with no crons (an older hook)', 'scheduled', () => { marker({ crons: undefined }); }],
    ['a .hold', 'held', () => { fs.writeFileSync(regPath('hold'), 'wave 2'); }],
    ['a .no-hibernate', 'opted-out', () => { fs.writeFileSync(regPath('no-hibernate'), ''); }],
    ['a fresh lastswap', 'recent-swap', () => { fs.writeFileSync(regPath('lastswap'), String(nowS() - 30)); }],
    ['#{session_attached} reading 1', 'attached', () => { attached('1'); }],
    ['#{session_attached} unreadable', 'attached', () => { attached(null); }],
    ['#{session_attached} not a number', 'attached', () => { attached('yes'); }],
  ];
  it.each(cases)('%s → %s', (_name, reason, arrange, extra) => {
    idle(); arrange();
    const r = hibernate(extra ?? '');
    expect(r.rc, r.err).toBe(3);
    expect(r.err).toContain(`ccd: session-busy: ${reason}`);
    expect(has('hibernated'), 'no marker').toBe(false);
    expect(has('stopped'), 'no stop stamp').toBe(false);
    expect(killed(), 'the pane untouched').toBe(false);
    expect(disabled(), 'the unit untouched').toBe(false);
    expect(eventsOf(h.home, 'hibernate'), 'no hibernate journal row').toEqual([]);
    expect(eventsOf(h.home, 'unsupervise')).toEqual([]);
  });

  it('control: an old lastswap (past SWAP_JITTER + 60 s) does not hold', () => {
    idle();
    fs.writeFileSync(regPath('lastswap'), String(nowS() - 400));
    expect(hibernate().rc).toBe(0);
  });
});

describe('the wake, and the verbs that end or refuse a hibernation', () => {
  const asleep = (): void => {
    idle();
    expect(hibernate().rc).toBe(0);
    expect(has('hibernated')).toBe(true);
  };
  /** A dead pane, as `ccd-forget.test.ts` stubs one: tmux answers nothing and the verdict reads `gone`. */
  const DEAD = `${STUBS} tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; }; _session_verdict() { echo gone; };`;

  it('ccd ensure removes .stopped and .hibernated and writes .woke', () => {
    asleep();
    h.sh(`${DEAD} _supervised_start() { echo "supervised_start $*" >> "$HOME/ccd-calls"; return 0; }; cmd_ensure ${ID} >/dev/null 2>&1 || true`, { TMUX: '' });
    expect(has('stopped')).toBe(false);
    expect(has('hibernated')).toBe(false);
    expect(fs.readFileSync(regPath('woke'), 'utf8')).toMatch(/^\d+$/);
  });

  it('control: ensure on a row that was never hibernated writes no .woke', () => {
    idle();
    h.sh(`${DEAD} _reg_set ${ID} stopped "1 cli"; _supervised_start() { return 0; }; cmd_ensure ${ID} >/dev/null 2>&1 || true`, { TMUX: '' });
    expect(has('woke')).toBe(false);
  });

  it('ccd stop on a hibernated row removes .hibernated (an ordinary stop now)', () => {
    asleep();
    h.sh(`${DEAD} cmd_stop ${ID} >/dev/null 2>&1`, { TMUX: '' });
    expect(has('hibernated')).toBe(false);
    expect(has('stopped')).toBe(true);
  });

  it('ccd forget on a hibernated row refuses hibernated and removes nothing; after stop it forgets', () => {
    asleep();
    const out = h.sh(`${DEAD} ( cmd_forget ${ID} ) 2>"$HOME/err"; echo "rc=$?"`, { TMUX: '' });
    expect(out).toContain('rc=1');
    expect(fs.readFileSync(path.join(h.home, 'err'), 'utf8')).toContain('hibernated: wake it (ccd ensure) or stop it (ccd stop) first');
    expect(has('uuid'), 'the row stands').toBe(true);
    expect(eventsOf(h.home, 'forget').map((e) => e['refusal'])).toEqual(['hibernated']);
    h.sh(`${DEAD} cmd_stop ${ID} >/dev/null 2>&1`, { TMUX: '' });
    const out2 = h.sh(`${DEAD} ( cmd_forget ${ID} ) 2>"$HOME/err2"; echo "rc=$?"`, { TMUX: "" });
    expect(out2, fs.readFileSync(path.join(h.home, "err2"), "utf8")).toContain("rc=0");
    expect(has('uuid'), 'forgotten').toBe(false);
  });

  it('ccd swap on a hibernated row refuses hibernated and touches nothing', () => {
    asleep();
    const out = h.sh(`${DEAD} _swap_target() { echo claude-d; }; ( cmd_swap ${ID} claude-d ) 2>"$HOME/err"; echo "rc=$?"`, { TMUX: '' });
    expect(out).toContain('rc=1');
    expect(fs.readFileSync(path.join(h.home, 'err'), 'utf8')).toContain('ccd: hibernated:');
    expect(h.reg(ID, 'wrapper')).toBe('claude');
    expect(has('hibernated')).toBe(true);
  });

  it('a second hibernate on a row already asleep answers already hibernated at exit 0 and journals nothing more (D-5424)', () => {
    asleep();
    const out = h.sh(`${DEAD} ( cmd_hibernate ${ID} ) 2>/dev/null; echo "rc=$?"`, { TMUX: '' });
    expect(out).toContain(`already hibernated ${ID}`);
    expect(out).toContain('rc=0');
    expect(eventsOf(h.home, 'hibernate')).toHaveLength(1);
  });

  it('ccd caps lists hibernate', () => {
    expect(h.sh('cmd_caps').split('\n')).toContain('hibernate');
  });
});
