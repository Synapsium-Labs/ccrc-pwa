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
 *  stay answer (empty stdout) reads as a bare `rc=N` rather than a leading space. */
const target = (cur: string, force = ''): string =>
  h.sh(`out=$(_swap_target ${ID} ${cur} claude '${force}' 0); echo "$out rc=$?"`);

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
const tick = (): string => h.sh(`${BLOCKED} _auto_swap_check ${ID}`);
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
});
