// server/test/ccd-route-settle.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { makeCcdHarness, type CcdHarness, WIDE_PANE } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-settle-'); });
afterEach(() => { h.cleanup(); });

/** tmux, RECORDING: `capture-pane` answers `$PANE_TEXT` (the `ccd-redrive.test.ts` stub). */
const STUBS = `sleep() { :; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE}
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
  it('an effort file `_reg_get` cannot CAT still counts as present — presence is the filesystem\'s answer, not a read\'s exit code', () => {
    // THE DUTY `ccd-crosspool.test.ts` HANDS THE FIRST rc-CONSUMING CALLER.
    // This branch used to read `if _reg_get "$id" effort` and take the exit
    // code for presence. `_reg_get` guards with `-f`, so a field that is a
    // symlink to `/dev/null` — the one input whose rc that suite measures as
    // having MOVED — answered rc 1 with the file plainly there, and the settle
    // typed `SPAWN_EFFORT` over a session whose operator had chosen an effort.
    // `[[ -e ]]` is the same question `_route_any` asks, so the two presence
    // readers now differ only in WHICH files they look at, which is all
    // S1-R11 ever said.
    seed();
    h.sh('_reg_set myid effort high; ln -sf /dev/null "$HOME/.cc-sessions/myid.effort"');
    settle();
    expect(typed()).toEqual([]);
  });
  it('...and it SAYS SO: an unreadable effort file suppresses the box default with a journal line, not in silence', () => {
    // THE HALF `[[ -e ]]` LEFT UNCHANNELLED (Task 10 review, fix round 2,
    // Finding 2). Presence now comes from the filesystem, so this session gets
    // no `SPAWN_EFFORT` — but the journaling call that follows reads the field
    // through `_reg_get`, whose rc folds ABSENT and UNREADABLE together, so it
    // wrote nothing and the session came up with no effort applied and no
    // record anywhere of why. The note is its own condition: it names the
    // FIELD and that it is PRESENT, and — unlike a reject note — no byte count,
    // because nobody read the bytes.
    seed();
    h.sh('_reg_set myid effort high; ln -sf /dev/null "$HOME/.cc-sessions/myid.effort"');
    settle();
    const log = h.sh('cat "$HOME/.cc-sessions/swap.log"');
    expect(log).toMatch(/route-unmeasured myid: field effort is present but could not be read — treated as absent/);
    expect(log, 'no byte count: nothing was read').not.toMatch(/bytes/);
    expect(typed(), 'and still not typed — fail-closed is unchanged').toEqual([]);
  });
  it('a field that is genuinely ABSENT stays silent — the other half of `_reg_get`\'s folded rc', () => {
    // THE CONTROL for the case above, and it is not decoration: the same `||`
    // arm fires for an absent field, which is every field of every pre-slice-1
    // session. Without the `[[ -e ]]` test inside `_route_unread_note` this
    // line would land on every read of every one of them. Read directly, since
    // the settle's own no-record path deliberately reads nothing.
    seed();
    h.sh('_reg_set myid class opus; _route_get myid class >/dev/null; _route_get myid effort >/dev/null');
    expect(h.sh('cat "$HOME/.cc-sessions/swap.log" 2>/dev/null; true'), 'a good value and an absent one are both silent')
      .not.toMatch(/route-unmeasured|route-reject/);
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

// The spawn's `/effort` injection answers Opus 5's switch confirmation — but
// only the DIALOG, which hides the prompt box and the statusline row (real
// 2.1.280 captures). It used to grep the whole pane for "Yes, switch", so a
// reply quoting the dialog above an idle box got an Enter of its own.
describe('_inject_spawn_effort confirms ONLY a real switch dialog', () => {
  const RULE = '─'.repeat(40);
  const IDLE = [RULE, '❯ ', RULE, '  👤 acct-a │ 🤖 Opus 5 · high │ ⎇ main', '  ⏸ manual mode on'].join('\n');
  const DIALOG = ['❯ /effort ultracode', RULE, '  Change effort level?', '  Your next response will be slower and use more tokens',
    '  ❯ 1. Yes, switch to xhigh', '    2. No, go back'].join('\n');
  const QUOTED = ['⏺ The capture shows:', '  Change effort level?', '  ❯ 1. Yes, switch to xhigh', '    2. No, go back', IDLE].join('\n');
  /** tmux whose pane is a FILE, and whose first Enter swaps in `after` — the
   *  screen Claude Code shows once `/effort ultracode` is submitted. */
  const run = (after: string): number => {
    seed();
    fs.writeFileSync(`${h.home}/pane.txt`, IDLE);
    fs.writeFileSync(`${h.home}/after.txt`, after);
    h.sh(`sleep() { :; };
      tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE}
        case "\${1:-}" in
          capture-pane) cat "$HOME/pane.txt" ;;
          send-keys) [[ "\${*: -1}" == Enter && -f "$HOME/after.txt" ]] && mv "$HOME/after.txt" "$HOME/pane.txt" ;;
        esac; return 0; };
      _inject_spawn_effort cc-myid`);
    return h.calls().filter((l) => /send-keys -t cc-myid Enter$/.test(l)).length;
  };
  it('a quoted dialog above the idle box gets no confirming Enter', () => {
    expect(run(QUOTED)).toBe(1);
  });
  it('control: the real dialog gets one', () => {
    expect(run(DIALOG)).toBe(2);
  });
});
