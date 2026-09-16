// The readers stand down below the calibration width (spec §6.3).
//
// READER_MIN_COLS is the width the CARRIERS need — the widest measures 69
// columns under wrap-ansi@9 — plus a margin, so below it a phrase cannot be
// relied on to sit on one line, and grep cannot match across a newline it is
// never presented (F11). (The brief's own wording for this comment said a pane
// under 120 columns "wraps `esc to interrupt` between words", which is false
// for every width from 70 to 119; the constant's derivation, not the phrase's
// own length, is what the floor rests on.) Every ccd
// reader that decides to TYPE on the strength of a phrase match therefore fails
// OPEN on a pane it cannot trust — a wrapped busy line reads as idle and ccd types
// /compact, a redrive, or a bare Enter into a running turn. That is the shape of
// the 2026-09-08 five-session incident, and `_pane_measurable` is the mechanism
// that closes it: measure first, and refuse to trust the phrase at all below the
// width the phrases were calibrated for.
//
// Fixture HOME only, with a bash `tmux()` function stub that shadows the
// harness's PATH poison — an uncontained `list-panes` reads the operator's LIVE
// server.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { READER_MIN_COLS } from '../../shared/api.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-standdown-'); });
afterEach(() => { h.cleanup(); });

/** A `list-panes -F '#{pane_active} #{pane_width}'` that answers one line per
 *  ROW given, and refuses every other tmux verb so nothing else is silently
 *  exercised. `printf` repeats its format once per argument, which is how the
 *  rows become real lines — a single string carrying a literal `\n` would NOT,
 *  since `%s` does not interpret escapes in its argument. */
const panes = (...rows: string[]): string =>
  `tmux() { case "$1" in list-panes) printf '%s\\n' ${rows.map((r) => JSON.stringify(r)).join(' ')} ;; *) return 1 ;; esac; };`;
/** A tmux that cannot answer at all. */
const TMUX_DEAD = 'tmux() { return 1; };';
/** The same `list-panes` answer, but EVERY verb is RECORDED to
 *  `$HOME/ccd-calls` — so a case can assert what was, or was not, typed into
 *  the pane, AND which pane was measured. `capture-pane` substitutions come
 *  back empty because the record goes to the file, not to stdout.
 *
 *  `list-panes` is recorded too, and that is not decoration: without it a guard
 *  that measured the WRONG pane — `_pane_measurable "$t"` rather than
 *  `"${t#cc-}"`, so `cc-cc-demo` — still stands down here, because these stubs
 *  answer the width query whatever target it names. The recorded target is what
 *  separates "it measured" from "it measured the right thing". */
const panesRecording = (...rows: string[]): string =>
  'tmux() { echo "tmux $*" >> "$HOME/ccd-calls";'
  + ` case "$1" in list-panes) printf '%s\\n' ${rows.map((r) => JSON.stringify(r)).join(' ')} ;; esac; };`;

/** The rc of a snippet, read off stdout rather than off a thrown status: `h.sh`
 *  throws on a non-zero LAST command, and the trailing `echo` makes the last
 *  command always succeed, so the rc survives as the final line. */
const rc = (snippet: string): number =>
  Number(h.sh(`${snippet}; echo $?`).trim().split('\n').at(-1));

const WIDE = String(READER_MIN_COLS);
const NARROW = String(READER_MIN_COLS - 1);

describe('_pane_measurable', () => {
  it('answers 0 at exactly READER_MIN_COLS and above — the boundary is inclusive', () => {
    expect(rc(`${panes(`1 ${WIDE}`)} _pane_measurable demo`)).toBe(0);
    expect(rc(`${panes('1 220')} _pane_measurable demo`)).toBe(0);
  });

  it('answers 1 one column below it', () => {
    expect(rc(`${panes(`1 ${NARROW}`)} _pane_measurable demo`)).toBe(1);
    expect(rc(`${panes('1 43')} _pane_measurable demo`)).toBe(1);
  });

  it('reads the ACTIVE row, not the first one (F7)', () => {
    // `list-panes -t <session>` lists EVERY pane of the current window, and
    // `capture-pane -t <session>` reads the ACTIVE one. PR #96 read row [0] and
    // mismatched on a split window; a guard that measures the wrong pane is
    // worse than no guard, because it says "measured".
    expect(rc(`${panes('0 43', `1 ${WIDE}`)} _pane_measurable demo`)).toBe(0);
    expect(rc(`${panes('0 220', `1 ${NARROW}`)} _pane_measurable demo`)).toBe(1);
  });

  it('answers 1 — stand down — on every UNMEASURABLE condition', () => {
    // Four conditions, ONE answer, and that is not an overloaded null: every
    // caller makes exactly one decision from it, and "narrow", "tmux would not
    // answer", "no active row" and "not a number" are the same answer to it.
    // An unmeasured pane is not idle (spec §11 ruling 4).
    expect(rc(`${TMUX_DEAD} _pane_measurable demo`), 'tmux refused').toBe(1);
    expect(rc(`${panes()} _pane_measurable demo`), 'no rows at all').toBe(1);
    expect(rc(`${panes('0 220')} _pane_measurable demo`), 'no active row').toBe(1);
    expect(rc(`${panes('1 wide')} _pane_measurable demo`), 'non-numeric width').toBe(1);
    expect(rc(`${panes('1')} _pane_measurable demo`), 'short row').toBe(1);
  });

  it('rejects a width the ARITHMETIC would accept — the regex has its own reason', () => {
    // THE OTHER FOUR UNMEASURABLE ROWS PIN THIS LINE FOR THE WRONG REASON.
    // Delete `[[ "$w" =~ ^[0-9]+$ ]] || return 1` and `w=wide` reaches
    // `(( w >= READER_MIN_COLS ))`, where bash reads a bare word as a VARIABLE
    // NAME: unset, and `set -u` makes that fatal — the case reds at rc 2, on an
    // exit, not on an answer. `+120` is the shape that separates the two: the
    // regex rejects it (`+` is outside the class) while arithmetic accepts it
    // as 120, so without the guard the function answers MEASURABLE on bytes it
    // never validated, and reds here with `expected 0 to be 1`.
    expect(rc(`${panes('1 +120')} _pane_measurable demo`), 'a signed width is not a width').toBe(1);
    expect(rc(`${panes('1 0x80')} _pane_measurable demo`), 'nor is a hex literal').toBe(1);
  });

  it('targets cc-<id>, through _tmux', () => {
    const out = h.sh(
      'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };'
      + ' _pane_measurable demo-quiet-basin; cat "$HOME/ccd-calls"');
    expect(out).toContain('-t cc-demo-quiet-basin');
    expect(out).toContain('#{pane_active}');
    expect(out).toContain('#{pane_width}');
  });
});

describe('_pane_auto_continue_armed holds when it cannot measure', () => {
  const ARMED = 'Usage limit reached · continuing automatically at 11:50am · esc or type to cancel';
  const IDLE = '? for shortcuts';

  it('with no id, it is the classifier it has always been', () => {
    // Callers that hold only pane text (and the pin in
    // `auto-continue-armed.test.ts`) must be unchanged by this wave.
    expect(rc(`${TMUX_DEAD} _pane_auto_continue_armed ${JSON.stringify(ARMED)}`)).toBe(0);
    expect(rc(`${TMUX_DEAD} _pane_auto_continue_armed ${JSON.stringify(IDLE)}`)).toBe(1);
  });

  it('with an id and a MEASURABLE pane, it still answers the pane', () => {
    expect(rc(`${panes(`1 ${WIDE}`)} _pane_auto_continue_armed ${JSON.stringify(ARMED)} demo`)).toBe(0);
    expect(rc(`${panes(`1 ${WIDE}`)} _pane_auto_continue_armed ${JSON.stringify(IDLE)} demo`)).toBe(1);
  });

  it('with an id and an UNMEASURABLE pane, it answers ARMED — the inverted direction', () => {
    // THE ONE GUARD THAT INVERTS. Everywhere else "unmeasurable" releases the
    // caller from acting; here it must HOLD, because the action this gate
    // protects is a keystroke that CANCELS Claude Code's own recovery timer,
    // and a cancelled continuation cannot be un-cancelled.
    expect(rc(`${panes(`1 ${NARROW}`)} _pane_auto_continue_armed ${JSON.stringify(IDLE)} demo`)).toBe(0);
    expect(rc(`${TMUX_DEAD} _pane_auto_continue_armed ${JSON.stringify(IDLE)} demo`)).toBe(0);
  });
});

// THE TWO SITES THE POPULATION SCAN CANNOT SEE.
//
// Task 5's scan finds a guard by looking for a phrase-carrying `grep` and
// walking back through the same function. Edits 4g and 4h sit in functions that
// carry NO phrase grep — `_spawn_settle` only renders the gate loop's rc, and
// `_inject_spawn_effort` decides on an empty input box — so neither is in
// `POPULATION` and neither would red when deleted. These two cases are their
// mechanism, and the Global Constraint that every guard ships with a test that
// reds on its deletion is what requires them.
describe('rc 6 is a LIVE pane too narrow to read \u2014 never a session that is not there', () => {
  /** `has-session` steered by $ALIVE, `list-panes` answering a NARROW active
   *  pane, `capture-pane` silent. The pair is the point: a real tmux cannot
   *  report a 200-column active pane for a session `has-session` denies, and
   *  the width query against a session that is not there EXITS 1 \u2014 which is
   *  indistinguishable, at `_pane_measurable`, from "too narrow". */
  const steered = (rows: string): string =>
    'sleep() { :; }; tmux() { case "$1" in'
    + ' has-session) return "${ALIVE:-0}" ;;'
    + ` list-panes) printf '%s\\n' ${JSON.stringify(rows)} ;;`
    + " capture-pane) printf '' ;; esac; };";

  it('a LIVE session whose pane is narrow earns 6', () => {
    expect(rc(`${steered(`1 ${NARROW}`)} _accept_first_run_prompts cc-demo 0`)).toBe(6);
  });

  it('a session that NEVER CAME UP still earns 3, not 6', () => {
    // THE ORDER IS THE GUARD. With the width measured ahead of the liveness
    // probe, `tmux list-panes -t cc-nope` exits 1, `_pane_measurable` answers
    // 1, and a dead session was told to "close the terminal drawer" while
    // rc 3's own recovery sentence ("clear $REG/<id>.started first") became
    // unreachable. Two conditions an operator handles differently must not
    // collapse onto one code.
    expect(rc(`${steered(`1 ${NARROW}`)} ALIVE=1 _accept_first_run_prompts cc-nope 0`)).toBe(3);
    // …and it is the LIVENESS that decides, not the width: a dead session with
    // a wide answer is rc 3 too, so this case cannot pass by measuring width.
    expect(rc(`${steered(`1 ${WIDE}`)} ALIVE=1 _accept_first_run_prompts cc-nope 0`)).toBe(3);
  });

  it('measures the width ONCE, not once per gate-loop pass', () => {
    // SPAWN_GATE_TRIES passes over a live, WIDE, markerless pane: the loop runs
    // to its cap and answers 4, and exactly ONE list-panes went out. Re-measuring
    // per pass would fork one per iteration for a decision that cannot change.
    const out = h.sh(
      'sleep() { :; }; tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in'
      + ` has-session) return 0 ;; list-panes) printf '%s\\n' "1 ${WIDE}" ;;`
      + " capture-pane) printf '' ;; esac; };"
      + ' SPAWN_GATE_TRIES=5; _accept_first_run_prompts cc-demo 0; echo "rc=$?"');
    expect(out).toContain('rc=4');
    expect(h.calls().filter((c) => c.includes('pane_active')), 'one width query for the whole loop')
      .toHaveLength(1);
  });
});

describe('the two stand-downs outside the phrase population', () => {
  it('_spawn_settle names rc 6 to the operator (edit 4g)', () => {
    // `_accept_first_run_prompts` answers 6 — "I stood down, I did not decide" —
    // and rc 6 must not be silence: without an arm of its own the `case` falls
    // through without a word. MEASURED with the arm deleted (Step 7 mutation
    // 4): stderr empty, return 6. The four callers that enumerate the rc still
    // REFUSE at 6, so this is not a silent success — but `spawn rc 6` is all an
    // operator would get, with no sentence naming the drawer. The stub is the
    // gate loop, because THIS case is about the sentence, not about how the 6
    // was reached.
    const out = h.sh(
      `${panesRecording(`1 ${NARROW}`)} _accept_first_run_prompts() { return 6; };`
      + ' _spawn_settle demo 0 2>"$HOME/ccd-err" >/dev/null; cat "$HOME/ccd-err"');
    expect(out).toContain(`demo: pane is under ${READER_MIN_COLS} columns`);
    expect(out, 'the sentence must name the remedy, not just the refusal')
      .toContain('close the terminal drawer');
  });

  it('_inject_spawn_effort types nothing into a narrow pane (edit 4h)', () => {
    // The /effort injection is a keystroke into a pane whose state it read with
    // a phrase match one line earlier. On a narrow pane that read is worthless,
    // so the whole function stands down before the first `capture-pane`.
    const out = h.sh(
      `${panesRecording(`1 ${NARROW}`)} sleep() { :; }; SPAWN_EFFORT=ultracode;`
      + ' _inject_spawn_effort cc-demo 2>"$HOME/ccd-err";'
      + ' cat "$HOME/ccd-err"; cat "$HOME/ccd-calls" 2>/dev/null || true');
    expect(out).toContain(`pane is under ${READER_MIN_COLS} columns, skipped /effort`);
    expect(out, 'a pane too narrow to read is a pane too narrow to type into')
      .not.toContain('send-keys');
    // THE TARGET, because the message alone does not pin it. Measured in Step
    // 7's mutation 5: with the guard deleted this case still reports no
    // `send-keys`, since the widened `_pane_auto_continue_armed` one line below
    // answers ARMED on the same unmeasurable pane and returns first. So the
    // message and THIS are what the guard has; and the id must be the tmux name
    // with `cc-` stripped, or `_pane_measurable` rebuilds it as `cc-cc-demo`
    // and measures a session that does not exist.
    expect(out, 'the guard measured a pane').toContain('-t cc-demo');
    expect(out, '`cc-` stripped once, not twice').not.toContain('cc-cc-demo');
  });
});
