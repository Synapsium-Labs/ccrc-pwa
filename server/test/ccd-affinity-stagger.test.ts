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
