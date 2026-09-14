// server/test/ccd-route-settle.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-settle-'); });
afterEach(() => { h.cleanup(); });

/** tmux, RECORDING: `capture-pane` answers `$PANE_TEXT` (the `ccd-redrive.test.ts` stub). */
const STUBS = `sleep() { :; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls";
    case "\${1:-}" in capture-pane) printf '%s\\n' "\${PANE_TEXT:-}" ;; esac; return 0; };
  _pane_box_draft() { printf '%s' "\${BOX_DRAFT:-}"; };`;
const READY = '? for shortcuts\n❯ ';
const typed = (): string[] => h.calls().filter((l) => l.includes('send-keys') && l.includes('-l '));
const settle = (): void => { h.sh(`${STUBS} _inject_spawn_effort cc-myid`, { PANE_TEXT: READY }); };
const seed = (): void => { h.sh('_reg_set myid wrapper claude; _reg_set myid uuid deadbeef-0000-4000-8000-000000000000'); };

describe('_inject_spawn_effort reads the routing record (routing spec 2026-09-14 §5.2)', () => {
  it('no record: SPAWN_EFFORT, as today', () => {
    seed(); settle();
    expect(typed()).toEqual(['tmux send-keys -t cc-myid -l /effort ultracode']);
  });
  it('a record with effort high: types nothing — the argv already carried it (controller ruling S1-R8, Lever B)', () => {
    seed(); h.sh('_reg_set myid class opus; _reg_set myid effort high'); settle();
    expect(typed()).toEqual([]);
  });
  it('a record with effort ultracode: types nothing too — --settings carried it at spawn', () => {
    seed(); h.sh('_reg_set myid class opus; _reg_set myid effort ultracode'); settle();
    expect(typed()).toEqual([]);
  });
  it('a record with effort auto: types nothing — the lane decides', () => {
    seed(); h.sh('_reg_set myid effort auto'); settle();
    expect(typed()).toEqual([]);
  });
  it('a record with no effort field at all (only class): SPAWN_EFFORT, as today (controller ruling S1-R11)', () => {
    // THE EFFORT FIELD IS THE TEST, not `_route_any`. A record that names a
    // class and no effort chose nothing about effort, so the box default is
    // still what applies — and a `class` field must not switch it off.
    seed(); h.sh('_reg_set myid class sonnet'); settle();
    expect(typed()).toEqual(['tmux send-keys -t cc-myid -l /effort ultracode']);
  });
  it('a ccd-WRITTEN field alone never switches off the default: `degraded` is not a record of anybody\'s effort', () => {
    // Slice 3 stamps `degraded` itself, on a session whose operator chose
    // nothing. Under `_route_any` that stamp silently cancelled `SPAWN_EFFORT`
    // — a behaviour change with no writer and no channel (S1-R11).
    seed(); h.sh('_reg_set myid degraded opus'); settle();
    expect(typed()).toEqual(['tmux send-keys -t cc-myid -l /effort ultracode']);
  });
  it('an EMPTY effort file still counts as present: a field somebody wrote is a field somebody meant', () => {
    seed(); h.sh('_reg_set myid effort ""'); settle();
    expect(typed()).toEqual([]);
  });
  it('class haiku with an effort on disk: types nothing and notes the PAIR', () => {
    seed(); h.sh('_reg_set myid class haiku; _reg_set myid effort high'); settle();
    expect(typed()).toEqual([]);
    expect(h.sh('cat "$HOME/.cc-sessions/swap.log"')).toMatch(/route-refuse myid: class haiku takes no effort level/);
  });
  it('an unrecognised effort: types nothing and notes it — nothing unrecognised reaches a keystroke', () => {
    seed(); h.sh("_reg_set myid effort 'extreme; rm -rf /'"); settle();
    expect(typed()).toEqual([]);
    expect(h.sh('cat "$HOME/.cc-sessions/swap.log"')).toMatch(/route-reject myid: field effort holds an unrecognised value \(17 bytes\)/);
    expect(h.sh('cat "$HOME/.cc-sessions/swap.log"')).not.toContain('rm -rf');
  });
  it('the existing guards still hold: an armed auto-continue and a drafted box type nothing (no-record path)', () => {
    seed();
    h.sh(`${STUBS} _inject_spawn_effort cc-myid`, { PANE_TEXT: 'Usage limit reached · continuing automatically at 11:50am · esc or type to cancel\n❯ ' });
    h.sh(`${STUBS} _inject_spawn_effort cc-myid`, { PANE_TEXT: READY, BOX_DRAFT: 'half a sentence' });
    expect(typed()).toEqual([]);
  });
});
