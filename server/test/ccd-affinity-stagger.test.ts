// THE AFFINITY GUARDS — D-6181 (spec §3.1, D4's herd guard).
//
// A non-forced move while `cur` still serves (the return home, and later the
// sideways move) is the one automatic move that can bring many sessions back at
// once: a deploy that frees every frozen session, legacy pins expiring together,
// a home that recovers under four sessions on one tick. It lands on idle panes,
// where a half-typed message is most likely. So such a move is taken only when
// no other such move onto its target was granted in the last
// `HOME_RETURN_SPACING` seconds and none fleet-wide in the last
// `AFFINITY_FLEET_SPACING`, and never over a draft in the input box.
//
// NEVER A RESCUE, NEVER A CEILING-LEAVE: a session whose `cur` cannot serve pays
// overage on every turn while it waits, so those moves never read the slots
// (switching is never blocked, Q8).
//
// FIXTURE HOME ONLY (`makeCcdHarness`) — nothing here reaches the live
// registry, tmux or systemd. `_dispatch_swap` is stubbed to RECORD.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness, WIDE_PANE } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-affinity-stagger-'); });
afterEach(() => { h.cleanup(); });

const PROMPT = '? for shortcuts\n❯ ';
const DRAFT = '? for shortcuts\n❯ half a message';

const reg = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string =>
  fs.existsSync(reg('swap.log')) ? fs.readFileSync(reg('swap.log'), 'utf8') : '';
const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));
const epoch = (): number => Math.floor(Date.now() / 1000);

/** A live row on `claude-a` whose home is `home`. */
const seed = (id: string, home = 'claude', wrapper = 'claude-a'): void => {
  h.sh(`_reg_set ${id} uuid 11111111-1111-4111-8111-111111111111
        _reg_set ${id} project demo
        _reg_set ${id} workdir "$HOME/projects/demo"
        _reg_set ${id} wrapper ${wrapper}
        _reg_set ${id} home ${home}
        _reg_set ${id} started 1`);
};

/** Every gate the affinity arm reads satisfied: a wide, idle, quiet pane at a
 *  prompt, `cur` and the target with room, and the target the row's home.
 *  `_dispatch_swap` records the id, the target and the arm. */
const STUBS = (pane = PROMPT): string => `
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE} case "\${1:-}" in
    capture-pane) printf '%b\\n' ${JSON.stringify(pane)} ;; list-panes) echo 4242 ;; esac; return 0; };
  _session_hard_blocked() { HARD_BLOCK_VIA=""; return 1; };
  _swap_target() { _reg_get "$1" home; }; _avail() { return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2 $3" >> "$HOME/ccd-calls"; };`;

/** `<config>/sessions/<pane pid>.json`, the file the idle and quiet gates read. */
const sessionJson = (quietSeconds = 600): void => {
  const d = path.join(h.home, '.claude-a', 'sessions');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, '4242.json'), JSON.stringify({
    status: 'idle', statusUpdatedAt: (Math.floor(Date.now() / 1000) - quietSeconds) * 1000,
  }));
};

const ticks = (ids: string[], stubs = STUBS()): string =>
  h.sh(`${stubs} ${ids.map((id) => `_auto_swap_check ${id}`).join('; ')}`);

// ── the characterization (green on D-6180's tip) ────────────────────────────

describe('D-6181 characterization: the undelayed return home', () => {
  it('today: four sessions with one home, home recovered on one tick → four affinity dispatches', () => {
    const ids = ['s-aaaa', 's-bbbb', 's-cccc', 's-dddd'];
    for (const id of ids) seed(id);
    sessionJson();
    ticks(ids);
    expect(dispatches()).toEqual(ids.map((id) => `dispatch ${id} -> claude affinity`));
  });

  it('today: an idle pane with a draft takes an affinity move', () => {
    seed('s-aaaa'); sessionJson();
    ticks(['s-aaaa'], STUBS(DRAFT));
    expect(dispatches()).toEqual(['dispatch s-aaaa -> claude affinity']);
    expect(swapLog()).toMatch(/auto-home s-aaaa: claude-a -> claude/);
  });
});

// ── D-6181: the slots ───────────────────────────────────────────────────────

/** `_affinity_slot_take <target> <now>`'s rc, from a fresh shell each call:
 *  every supervisor is its own process, so nothing may be kept in memory. */
const take = (target: string, now: number): number =>
  Number(h.sh(`_affinity_slot_take ${target} ${now}; echo $?`));

describe('D-6181: the per-account slot and the fleet-wide slot', () => {
  it('of four sessions returning to one home on one tick, exactly one dispatches', () => {
    const ids = ['s-aaaa', 's-bbbb', 's-cccc', 's-dddd'];
    for (const id of ids) seed(id);
    sessionJson();
    ticks(ids);
    expect(dispatches()).toEqual(['dispatch s-aaaa -> claude affinity']);
  });

  it('a lost slot logs stand-down stagger', () => {
    for (const id of ['s-aaaa', 's-bbbb']) seed(id);
    sessionJson();
    ticks(['s-aaaa', 's-bbbb']);
    expect(swapLog()).toMatch(/stand-down s-bbbb: stagger/);
    expect(swapLog()).not.toMatch(/stand-down s-aaaa: stagger/);
  });

  it('dispatches at t=179 and t=180 onto one home: the second waits until t=359', () => {
    expect(take('claude', 179)).toBe(0);
    expect(take('claude', 180)).toBe(1);
    expect(take('claude', 358)).toBe(1);
    expect(take('claude', 359)).toBe(0);
  });

  it('releases onto 5 different homes on one tick: dispatches at least AFFINITY_FLEET_SPACING apart', () => {
    // Each home retried every second from the previous grant, at most 60
    // tries, in ONE shell (bounded, so a missing helper is red, not a hang).
    const out = h.sh(`t=1000000; for home in home-a home-b home-c home-d home-e; do
        n=0; until _affinity_slot_take "$home" "$t"; do t=$((t + 1)); n=$((n + 1)); (( n > 60 )) && break; done
        echo "$t"; done`);
    const granted = out.split('\n').map(Number);
    expect(granted).toHaveLength(5);
    for (let i = 1; i < granted.length; i++) expect(granted[i]! - granted[i - 1]!).toBe(30);
  });

  it('two sessions with two homes on one tick: one dispatches (the fleet-wide slot)', () => {
    seed('s-aaaa', 'claude'); seed('s-bbbb', 'claude-b');
    sessionJson();
    ticks(['s-aaaa', 's-bbbb']);
    expect(dispatches()).toEqual(['dispatch s-aaaa -> claude affinity']);
    expect(swapLog()).toMatch(/stand-down s-bbbb: stagger/);
  });

  it('two ticks racing for one slot: exactly one wins', () => {
    // The race is forced open: every slot read sleeps after reading, so two
    // takers that do not hold the lock both read the old grant and both win.
    const out = h.sh(`
      eval "$(declare -f _file_read_to | sed '1s/^_file_read_to/_frt_orig/')"
      _file_read_to() { _frt_orig "$@"; local r=$?; sleep 0.3; return $r; }
      for t in claude claude-b; do
        ( _affinity_slot_take $t 5000 && echo "won $t" ) &
        ( _affinity_slot_take $t 5000 && echo "won $t" ) &
        wait
      done`);
    expect(out.split('\n').filter((l) => l === 'won claude')).toHaveLength(1);
    expect(out.split('\n').filter((l) => l === 'won claude-b')).toHaveLength(1);
  });

  it('an unwritable slot file: the move dispatches and one stagger-unwritable line is written', () => {
    seed('s-aaaa'); sessionJson();
    fs.writeFileSync(reg('.affslot'), 'not a directory');
    ticks(['s-aaaa']);
    expect(dispatches()).toEqual(['dispatch s-aaaa -> claude affinity']);
    expect(swapLog().match(/stand-down s-aaaa: stagger-unwritable/g)).toHaveLength(1);
  });

  it('a lock held past HOME_RETURN_SPACING is broken: the move fails open', () => {
    const dir = reg('.affslot');
    fs.mkdirSync(dir, { recursive: true });
    const out = h.sh(`
      printf '%s\\n' 1000 > "$REG/.affslot/.lock"
      flock "$REG/.affslot/.lock" sleep 4 & sleep 0.3
      _affinity_slot_take claude 1181; echo "rc=$?"; kill %1 2>/dev/null; wait 2>/dev/null; true`);
    expect(out).toMatch(/^rc=2$/m);
  });

  it('a lock held by a live, recent taker is "held": the slot is lost', () => {
    const dir = reg('.affslot');
    fs.mkdirSync(dir, { recursive: true });
    const out = h.sh(`
      printf '%s\\n' 1000 > "$REG/.affslot/.lock"
      flock "$REG/.affslot/.lock" sleep 4 & sleep 0.3
      _affinity_slot_take claude 1010; echo "rc=$?"; kill %1 2>/dev/null; wait 2>/dev/null; true`);
    expect(out).toMatch(/^rc=1$/m);
  });
});

describe('D-6181: what the guards never touch', () => {
  /** A slot helper that only records, and always says "lost". */
  const SPY = '_affinity_slot_take() { echo "slot $*" >> "$HOME/ccd-calls"; return 1; };';

  it('a rescue never reads the slots', () => {
    seed('s-aaaa'); sessionJson();
    ticks(['s-aaaa'], `${STUBS('API Error: 429 Too Many Requests\n❯ ')}
      _session_hard_blocked() { HARD_BLOCK_VIA=pane; return 0; }; ${SPY}`);
    expect(dispatches()).toEqual(['dispatch s-aaaa -> claude rescue']);
    expect(h.calls().filter((l) => l.startsWith('slot '))).toEqual([]);
  });

  it('a ceiling-leave never reads the slots', () => {
    seed('s-aaaa'); sessionJson();
    ticks(['s-aaaa'], `${STUBS()} _avail() { [[ "$1" != claude-a ]]; }; ${SPY}`);
    expect(dispatches()).toEqual(['dispatch s-aaaa -> claude affinity']);
    expect(h.calls().filter((l) => l.startsWith('slot '))).toEqual([]);
  });

  it('a pool leave (auto-pool) never reads the slots', () => {
    seed('s-aaaa'); sessionJson();
    ticks(['s-aaaa'], `${STUBS()} _pool_ok() { return 1; }; ${SPY}`);
    expect(h.calls().filter((l) => l.startsWith('slot '))).toEqual([]);
  });

  it('a return home onto a cur that cannot serve the class is a leave, never guarded', () => {
    seed('s-aaaa'); sessionJson();
    ticks(['s-aaaa'], `${STUBS()} _class_gate() { [[ "$1" == claude-a ]] && return 1; return 0; }; ${SPY}`);
    expect(dispatches()).toEqual(['dispatch s-aaaa -> claude affinity']);
    expect(h.calls().filter((l) => l.startsWith('slot '))).toEqual([]);
  });
});

describe('D-6181: the draft', () => {
  it('an idle pane with a draft takes no return home and logs stand-down draft', () => {
    seed('s-aaaa'); sessionJson();
    ticks(['s-aaaa'], STUBS(DRAFT));
    expect(dispatches()).toEqual([]);
    expect(swapLog()).toMatch(/stand-down s-aaaa: draft/);
    // The draft stand-down takes no slot: the next return onto that home is not delayed by it.
    expect(fs.existsSync(path.join(reg('.affslot'), 'claude'))).toBe(false);
  });

  it('a ceiling-leave over a draft still dispatches (the draft guards a non-forced move only)', () => {
    seed('s-aaaa'); sessionJson();
    ticks(['s-aaaa'], `${STUBS(DRAFT)} _avail() { [[ "$1" != claude-a ]]; };`);
    expect(dispatches()).toEqual(['dispatch s-aaaa -> claude affinity']);
  });
});

describe('D-6181: the off marker', () => {
  it('swap-stagger-off restores the undelayed dispatch', () => {
    fs.writeFileSync(reg('swap-stagger-off'), '');
    const ids = ['s-aaaa', 's-bbbb', 's-cccc', 's-dddd'];
    for (const id of ids) seed(id);
    sessionJson();
    ticks(ids, STUBS(DRAFT));
    expect(dispatches()).toEqual(ids.map((id) => `dispatch ${id} -> claude affinity`));
    expect(swapLog()).not.toMatch(/stand-down \S+: (stagger|draft)/);
  });
});

describe('D-6181: the constants', () => {
  it('HOME_RETURN_SPACING is above SWAP_JITTER, and the fleet slot is 30 s', () => {
    const [home, jitter, fleet, ttl] = h.sh('echo "$HOME_RETURN_SPACING $SWAP_JITTER $AFFINITY_FLEET_SPACING $SWAP_PIN_TTL"')
      .split(' ').map(Number);
    expect(home).toBe(180);
    expect(home!).toBeGreaterThan(jitter!);
    expect(fleet).toBe(30);
    expect(ttl).toBe(86400);
  });
});
