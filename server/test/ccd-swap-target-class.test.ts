// `_swap_target` with a class in the routing record (routing spec §5.4). The
// no-class rows pin byte-identity with today; the class rows pin the three
// answers, rc 5's own word, and rc 6's one-rung degrade — decided on stdout and
// rc only, because a command substitution loses variables (the caller stamps).
//
// THE ROSTER HAS FOUR HOME-ABLE LANES, NOT THREE (`DEFAULT_TEST_ROSTER`:
// `claude`, `claude-a`, `claude-b`, `claude-d`, plus the non-home-able `gpt`
// `_account_ok` drops). Every case whose NAME quantifies over "every
// candidate" therefore has to measure `claude-d` too — an unmeasured lane is
// rc 5 by design, so a fixture that forgot the fourth lane would answer 5
// wherever it meant 6 and would be measuring the omission rather than the
// rule. The cases that quantify over nothing leave it unmeasured deliberately.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, decOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-swap-class-'); seedAccountsSh(h.home); });
afterEach(() => { h.cleanup(); });

const ID = 'claude-demo';
const PANE_PID = '4242';
const now = (): number => Math.floor(Date.now() / 1000);
const limits = (w: string, five: number, seven: number): void => {
  fs.mkdirSync(path.join(h.home, '.cc-limits'), { recursive: true });
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: now(), fiveResetAt: now() + 10_000, sevenResetAt: now() + 400_000 }));
};
const sweep = (estimates: Record<string, number | null>, ageS = 1): void => {
  const dir = path.join(h.home, '.cc-sessions', 'usage', 'sweep'); fs.mkdirSync(dir, { recursive: true });
  const finishedAt = new Date((now() - ageS) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ finishedAt,
    perAccount: Object.fromEntries(Object.entries(estimates).map(([a, e]) => [a, { fableShare: { estimate: e } }])) }));
};
const seedRow = (wrapper = 'claude', cls?: string): void => {
  h.sh(`_reg_set ${ID} wrapper ${wrapper}; _reg_set ${ID} home claude; _reg_set ${ID} project demo; _reg_set ${ID} uuid u${cls ? `; _reg_set ${ID} class ${cls}` : ''}`);
};
/** `_swap_target id cur home force hrc` → "stdout rc=N" — `h.sh` trims, so the
 *  stay answer (empty stdout) reads as a bare `rc=N` rather than a leading space.
 *
 *  `home` IS A PARAMETER BECAUSE TWO OF THE THREE STAY GATES LIVE IN THE `else`
 *  BRANCH (fix round 1, finding 2). Every case here used to pass `cur = 'claude'
 *  = home`, which takes the `if` branch and runs exactly ONE of the three gates
 *  — so the home-recovered gate and the cur-still-works gate were both
 *  deletable with the suite still green, which is how the S3-R4 defect below
 *  reached review. Driving `cur != home` is the only way to reach them. */
const target = (cur: string, force = '', home = 'claude'): string =>
  h.sh(`out=$(_swap_target ${ID} ${cur} ${home} '${force}' 0); echo "$out rc=$?"`);

// ── The tick, on `ccd-crosspool.test.ts`'s stubs: a stubbed tmux whose pane
// text is a rate-limit banner (so `_session_hard_blocked` is true on the PANE
// arm and never reaches a transcript), `list-panes` answering a fixed pid, its
// `notify.sh` verbatim, and `_dispatch_swap` logging instead of moving
// anything.
//
// ITS `BLOCKED` PANE, NOT ITS `QUIET` ONE, and the difference is load-bearing
// rather than a copy slip: that file's own undecidable-word cases drive
// `tick(QUIET, …)` and assert the swap.log line alone, because the `.stranded`
// marker `_strand_mark` writes — the one carrying `_undecidable_cause`'s
// sentence, which is what pins rc 5's WORDS here — is only written on the
// hard-blocked arm. The dispatch sink is swap.log rather than that file's
// `ccd-calls` so one read answers both "did it move?" and "what did it say?".
const BLOCKED = `
  tmux() { case "\${1:-}" in
             capture-pane) echo "API Error: 429 Too Many Requests" ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$REG/swap.log"; };
`;
const plantNotify = (): void => {
  fs.writeFileSync(path.join(h.home, '.cc-sessions', 'notify.sh'),
    '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$HOME/notify-log"\n', { mode: 0o755 });
};
/** `stderrTo` is for the one case that plants a REAL write failure: `mv`'s
 *  refusal is a genuine diagnostic on stderr, and letting it reach the runner
 *  would make a passing suite print an error. It is kept on disk in the fixture
 *  home (readable while debugging) rather than asserted, because the wording is
 *  the platform's — `_plat_mv_notdir`'s darwin arm refuses before `mv` runs and
 *  prints nothing at all. */
const tick = (stderrTo = ''): string =>
  h.sh(stderrTo ? `${BLOCKED} { _auto_swap_check ${ID}; } 2>"$HOME/${stderrTo}"`
                : `${BLOCKED} _auto_swap_check ${ID}`);
const swapLog = (): string => fs.readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8');

describe('no class: byte-identical to today', () => {
  it('a home under the ceiling stays; a blocked home moves to the least-loaded candidate', () => {
    limits('claude', 10, 10); limits('claude-a', 20, 20); limits('claude-b', 30, 30);
    seedRow('claude');
    expect(target('claude')).toBe('rc=0');
    limits('claude', 99, 99);
    expect(target('claude')).toBe('claude-a rc=0');
    // the identical calls with class=default answer the same bytes
    h.sh(`_reg_set ${ID} class default`);
    limits('claude', 10, 10); expect(target('claude')).toBe('rc=0');
    limits('claude', 99, 99); expect(target('claude')).toBe('claude-a rc=0');
  });
});

describe('class fable — the three answers on the swap path', () => {
  it('home servable at the class: stay (rc 0, no destination)', () => {
    limits('claude', 10, 10); limits('claude-a', 20, 20); seedRow('claude', 'fable'); sweep({ claude: 0.1, 'claude-a': 0.1 });
    expect(target('claude')).toBe('rc=0');
  });

  it('home at the Fable ceiling: MUST LEAVE — the least-loaded servable candidate, rc 0', () => {
    limits('claude', 10, 10); limits('claude-a', 20, 20); limits('claude-b', 30, 30); seedRow('claude', 'fable');
    sweep({ claude: 0.45, 'claude-a': 0.5, 'claude-b': 0.2 });
    expect(target('claude')).toBe('claude-b rc=0');
  });

  it('home unmeasured for the class: rc 5, nothing on stdout, never a move and never a degrade', () => {
    limits('claude', 10, 10); limits('claude-a', 20, 20); seedRow('claude', 'fable'); sweep({ 'claude-a': 0.1 });   // no row for home
    expect(target('claude')).toBe('rc=5');
  });

  it('every candidate MEASURED at the ceiling: rc 6 with the destination chosen one rung down (opus = the seven-day figure)', () => {
    limits('claude', 99, 99); limits('claude-a', 20, 20); limits('claude-b', 30, 30); seedRow('claude', 'fable');
    sweep({ claude: 0.5, 'claude-a': 0.5, 'claude-b': 0.6, 'claude-d': 0.7 });
    expect(target('claude')).toBe('claude-a rc=6');
  });

  it('no servable candidate and at least one UNMEASURED: rc 5 — nobody degrades on a fabricated fact', () => {
    limits('claude', 99, 99); limits('claude-a', 20, 20); limits('claude-b', 30, 30); seedRow('claude', 'fable');
    sweep({ claude: 0.5, 'claude-a': 0.5 });   // claude-b has no row
    expect(target('claude')).toBe('rc=5');
  });

  it('on the degrade pass an unmeasured seven-day figure ranks LAST but stays eligible — the degrade was decided on measured refusals', () => {
    // claude-a has no limits file at all: _avail admits it (unknown is available), pass 1 refuses it at the Fable
    // ceiling (measured), pass 2 asks opus and reads no figure — eligible, ranked 100, so the measured claude-b wins.
    limits('claude', 99, 99); limits('claude-b', 30, 30); seedRow('claude', 'fable');
    sweep({ claude: 0.5, 'claude-a': 0.5, 'claude-b': 0.6, 'claude-d': 0.7 });
    expect(target('claude')).toBe('claude-b rc=6');
    // and when claude-b is the only MEASURED lane left at the rung below (it is now refused by _avail before any
    // class question), the two scoreless lanes tie at 100 and roster order takes claude-a rather than stranding
    limits('claude-b', 99, 99);
    expect(target('claude')).toBe('claude-a rc=6');
  });

  it('a candidate at the seven-day ceiling is refused by _avail before the class is even asked (rc unchanged from today)', () => {
    limits('claude', 99, 99); limits('claude-a', 99, 99); limits('claude-b', 30, 30); seedRow('claude', 'fable');
    sweep({ claude: 0.5, 'claude-a': 0.1, 'claude-b': 0.1 });
    expect(target('claude')).toBe('claude-b rc=0');
  });
});

// ── The `else` branch: cur != home, so the OTHER two stay gates run. The row's
// `home` stays `claude` (that is what `seedRow` writes) and the session is
// sitting on `claude-a`, which is the shape every rescue and every affinity
// return has. `claude-b`/`claude-d` carry limits in most rows below so the
// candidate loop has a DETERMINISTIC winner rather than a roster-order tie.
describe('away from home: the home-recovered gate and the cur-still-works gate', () => {
  const away = (): void => { seedRow('claude-a', 'fable'); };
  const fourLanes = (homeFive: number): void => {
    limits('claude', homeFive, homeFive); limits('claude-a', 20, 20);
    limits('claude-b', 30, 30); limits('claude-d', 40, 40);
  };

  it('home recovered and servable at the class: go home (rc 0, the name on stdout)', () => {
    fourLanes(10); away(); sweep({ claude: 0.1, 'claude-a': 0.1, 'claude-b': 0.1, 'claude-d': 0.1 });
    expect(target('claude-a')).toBe('claude rc=0');
  });

  it('home recovered but at the Fable ceiling: fall through — the least-loaded servable candidate, rc 0', () => {
    // cur is at the ceiling too, so the cur-still-works gate cannot answer either: both
    // gates measure UNSERVABLE and the must-leave loop is what decides.
    fourLanes(10); away(); sweep({ claude: 0.5, 'claude-a': 0.5, 'claude-b': 0.1, 'claude-d': 0.1 });
    expect(target('claude-a')).toBe('claude-b rc=0');
    // and with no servable candidate anywhere, the same fall-through reaches the rung below
    sweep({ claude: 0.5, 'claude-a': 0.5, 'claude-b': 0.5, 'claude-d': 0.5 });
    expect(target('claude-a')).toBe('claude rc=6');
  });

  it('home recovered but UNMEASURED at the class, unforced: rc 5 — nobody decides', () => {
    fourLanes(10); away(); sweep({ 'claude-a': 0.1, 'claude-b': 0.1, 'claude-d': 0.1 });   // no row for home
    expect(target('claude-a')).toBe('rc=5');
  });

  it('the SAME unmeasured home under `force`: NOT rc 5 — the loop runs and names a lane (S3-R4)', () => {
    // The ruling: a forced call is a hard block, and this arm carries no `[[ -z "$force" ]]`
    // condition precisely so one reaches a destination. An unmeasured figure for HOME must not
    // abort the decision — that would strand a session with the classwindow sentence, a durable
    // positive claim, over a fleet that still had `claude-b` able to serve the class.
    fourLanes(10); away(); sweep({ 'claude-a': 0.1, 'claude-b': 0.1, 'claude-d': 0.1 });
    expect(target('claude-a', '1')).toBe('claude-b rc=0');
  });

  it('home down, cur still works and can serve the class: stay put (rc 0, nothing on stdout)', () => {
    fourLanes(99); away(); sweep({ 'claude-a': 0.1, 'claude-b': 0.1, 'claude-d': 0.1 });
    expect(target('claude-a')).toBe('rc=0');
  });

  it('home down, cur still works but UNMEASURED at the class, unforced: rc 5', () => {
    fourLanes(99); away(); sweep({ claude: 0.1, 'claude-b': 0.1, 'claude-d': 0.1 });   // no row for cur
    expect(target('claude-a')).toBe('rc=5');
  });
});

describe('the tick spends rc 5 and rc 6', () => {
  it('rc 5 stands still with its OWN word: classwindow, never crosspool/project/pool', () => {
    limits('claude', 99, 99); limits('claude-a', 20, 20); seedRow('claude', 'fable'); sweep({ 'claude-a': 0.5 });
    plantNotify();
    tick();
    const log = swapLog();
    expect(log).toContain(`tick-undecidable ${ID}: classwindow`);
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', `${ID}.stranded`), 'utf8'))
      .toContain('the per-class window for the session\'s class could not be measured');
    expect(log).not.toMatch(/auto-rescue|dispatch /);
    expect(h.reg(ID, 'degraded'), 'and nobody degrades on a fabricated fact').toBeNull();
  });

  it('rc 6 stamps `degraded`, journals a route row with actor ccd, and dispatches to the destination', () => {
    limits('claude', 99, 99); limits('claude-a', 20, 20); seedRow('claude', 'fable');
    sweep({ claude: 0.5, 'claude-a': 0.5, 'claude-b': 0.6, 'claude-d': 0.7 });
    plantNotify();
    tick();
    expect(h.reg(ID, 'degraded')).toBe('opus');
    const rows = eventsOf(h.home, 'route');
    expect(rows.length).toBe(1);
    expect(decOf(rows[0]!)).toMatchObject({ actor: 'ccd' });
    expect(String(rows[0]!['detail'])).toBe('degraded: ∅ -> opus');
    expect(swapLog()).toMatch(/degrade claude-demo: fable -> opus/);
    expect(swapLog()).toContain('dispatch claude-demo -> claude-a');
  });

  it('a `degraded` stamp that cannot be WRITTEN stands still: no dispatch, no row, one line saying so', () => {
    // Ruling S3-R5. `_route_degrade` returns 1 when `_reg_set` fails, and the arm used to
    // discard that rc: the session was then dispatched to a lane chosen for the rung BELOW
    // while the record still said `fable`, so `_spawn_start` would compose `--model fable` on
    // a lane just measured unable to serve it. The failure is planted the way `_reg_set` can
    // actually fail — its `_plat_mv_notdir` refuses to overwrite a DIRECTORY with a file, and
    // `_reg_get`'s `-f` guard makes the standing read answer "absent" over the same inode.
    limits('claude', 99, 99); limits('claude-a', 20, 20); seedRow('claude', 'fable');
    sweep({ claude: 0.5, 'claude-a': 0.5, 'claude-b': 0.6, 'claude-d': 0.7 });
    const stamp = path.join(h.home, '.cc-sessions', `${ID}.degraded`);
    fs.mkdirSync(stamp);
    plantNotify();
    tick('tick-stderr');
    expect(swapLog()).toContain(`degrade-unwritable ${ID}: fable -> opus (stamp not written; standing still)`);
    expect(fs.statSync(stamp).isDirectory(), 'nothing was written over the unwritable field').toBe(true);
    expect(eventsOf(h.home, 'route').length, 'no journal row for a stamp that did not land').toBe(0);
    expect(swapLog(), 'and the move itself never happened').not.toMatch(/dispatch |auto-rescue| degrade claude-demo:/);
    // standing still is not stranding: the next tick re-measures and retries
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.stranded`))).toBe(false);
  });
});

// `_route_restore` is the OTHER writer of `degraded`, and Task 6's settle path
// is what calls it — which would have shipped it unpinned. Its two behaviours
// are the ones a settle path leans on every five seconds: the steady state of a
// session that never degraded writes NOTHING (the `-e` test first, for
// `_strand_clear`'s reason), and a standing stamp is cleared exactly once with
// the same two channels the degrade uses.
describe('_route_restore — the other writer of `degraded`', () => {
  it('a session that never degraded is left alone: no registry write, no journal row, no log line', () => {
    seedRow('claude', 'fable');
    h.sh(`_route_restore ${ID} opus fable 'the class is servable again'`);
    expect(h.reg(ID, 'degraded')).toBeNull();
    expect(eventsOf(h.home, 'route').length).toBe(0);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'swap.log'))).toBe(false);
  });

  it('a standing stamp is cleared, journalled with actor ccd, and logged — and saying it twice writes nothing the second time', () => {
    seedRow('claude', 'fable');
    h.sh(`_reg_set ${ID} degraded opus`);
    h.sh(`_route_restore ${ID} opus fable 'servable: fable is back under the ceiling'`);
    expect(h.reg(ID, 'degraded')).toBeNull();
    const rows = eventsOf(h.home, 'route');
    expect(rows.length).toBe(1);
    expect(decOf(rows[0]!)).toMatchObject({ actor: 'ccd' });
    expect(String(rows[0]!['detail'])).toBe('degraded: opus -> ∅');
    expect(swapLog()).toMatch(/restore claude-demo: opus -> fable/);
    h.sh(`_route_restore ${ID} opus fable 'servable: fable is back under the ceiling'`);
    expect(eventsOf(h.home, 'route').length).toBe(1);
  });

  it('the journal row carries the MEASURED standing value, not the caller\'s word (S3-R5)', () => {
    // The row is an audit record. Journalling `$from` let a caller that named the wrong
    // standing class write a false one that nothing in the tree could red — while the sibling
    // writer read the field. Here the caller says `haiku` and the stamp says `opus`: the row
    // must say `opus`, and the caller's words survive only on the swap.log line, which is
    // where "what the caller meant to do" belongs.
    seedRow('claude', 'fable');
    h.sh(`_reg_set ${ID} degraded opus`);
    h.sh(`_route_restore ${ID} haiku fable 'a caller that named the wrong standing class'`);
    const rows = eventsOf(h.home, 'route');
    expect(rows.length).toBe(1);
    expect(String(rows[0]!['detail'])).toBe('degraded: opus -> ∅');
    expect(swapLog()).toMatch(/restore claude-demo: haiku -> fable/);
  });
});
