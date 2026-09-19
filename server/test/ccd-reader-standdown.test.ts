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
import { readFileSync } from 'node:fs';
import { makeCcdHarness, CCD, type CcdHarness } from './ccdWsHelpers.js';
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
 *  that measured the WRONG pane — `_pane_measurable "$t"` rather than the
 *  stripped `"$id"`, so `cc-cc-demo` — still stands down here, because these stubs
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
    // THE ASSERTIONS ABOVE ARE STRONGER THAN THIS PLACE USED TO CLAIM. The
    // paragraph that stood here said that with the guard deleted the case
    // "still reports no `send-keys`", because the widened
    // `_pane_auto_continue_armed` one line below would answer ARMED on the same
    // unmeasurable pane and return first — so only the MESSAGE pinned the
    // guard. Both halves are false. The mechanism half was falsified by this
    // branch's own commit 73c27283, which removed that call's `id` argument and
    // did not sweep the justification: with no id it is the plain phrase
    // classifier over an EMPTY capture, and it answers NOT armed.
    //
    // RE-MEASURED 2026-09-16, on a COPY of `ccd/ccd` with the guard line
    // deleted and this exact stub: stderr empty, and the recorded calls are
    // `capture-pane -t cc-demo -p`, `capture-pane -t cc-demo -p -e`,
    // `send-keys -t cc-demo -l /effort ultracode`, `send-keys -t cc-demo Enter`,
    // and `capture-pane -t cc-demo -p` again — the `Yes, switch` check that
    // runs after Enter. The control (shipped tree) records the width query
    // alone. So deleting
    // this guard reds BOTH assertions above — the message and the `send-keys`
    // — not neither.
    //
    // WHAT THE TWO BELOW ADD is the thing neither of those can see: WHICH pane
    // was measured. The stubs answer the width query whatever target it names,
    // so a guard that measured `$t` rather than the stripped id stands down
    // here just the same — and `_pane_measurable` would rebuild it as
    // `cc-cc-demo`, a session that does not exist.
    expect(out, 'the guard measured a pane').toContain('-t cc-demo');
    expect(out, '`cc-` stripped once, not twice').not.toContain('cc-cc-demo');
  });
});

// --- THE POPULATION SCAN ---
//
// The behaviour cases above prove `_pane_measurable` works. This proves it is
// CALLED — at every site, by construction rather than by anyone remembering.
// It is this repo's whole-population mutation tripwire
// (`ccd-arith-containment.test.ts`'s shape): the population is fixed and
// enumerated, each entry names the function, how many phrase-carrying greps
// it holds, and the SHAPE its own guard must take, and dropping — or
// INVERTING — a guard turns that function's row red whether or not a payload
// test happens to walk that path.

/** The four phrases every stand-down exists for (spec §1, §6.3). */
const PHRASES = ['esc to interrupt', 'continuing automatically', 'continuing shortly', 'Enter to confirm'];

/** Strip a trailing bash `#` comment — but ONLY when the `#` starts a WORD
 *  (preceded by start-of-line or whitespace). `_pane_measurable "${1#cc-}"`
 *  is parameter expansion, not a comment — that `#` sits mid-word, right
 *  after `1` — so a naive `line.split('#')[0]` truncates that guard's own
 *  `return` and reds the UNMUTATED file (measured; fix round 1 finding 1).
 *  Verified against every live `_pane_measurable` guard line the POPULATION
 *  census below actually WALKS via `bodyBefore` — which is not every guard
 *  line in the tree: `_redrive_after_spawn` carries a second guard, argued in
 *  `ccd/ccd`'s own comment above it, that sits AFTER every phrase site in
 *  that function, so this scan never reaches it either (the same structural
 *  blindness S1/S14 name for the census itself). Of the ones this scan does
 *  walk, some carry a real trailing comment (space then `#`, stripped), the
 *  rest carry none, and this is the only one with a `#` that is not a
 *  comment start (mid-word, left alone). Re-run the split against the tree
 *  rather than trusting a count here — restating one is exactly what went
 *  stale four times in one wave (S7, review round 3). */
function stripComment(l: string): string {
  return l.replace(/(^|\s)#.*$/, '$1');
}

interface GuardSpec { count: number; guard: RegExp }

/** Function name -> { how many LIVE `grep` lines in it carry a phrase, the
 *  SHAPE its own `_pane_measurable` guard must take }. Measured against
 *  ccd/ccd at the wave-2 baseline. `guard` pins SENSE, not just presence —
 *  fix round 1 finding 1 measured that "does some earlier line MENTION
 *  _pane_measurable" is satisfied by a guard whose `return` was dropped, by
 *  the call hidden inside a comment, and by the sense INVERTED (`!` added
 *  while keeping `||`) — the exact 2026-09-08 incident shape, with nothing
 *  to catch it. Five functions use the `_pane_measurable "$id" || ... return`
 *  shape — unmeasurable -> stand down. A sixth, `_accept_first_run_prompts`,
 *  stands down the SAME way but is spelled `! _pane_measurable "${1#cc-}" &&
 *  ... return 6` — the `!`/`&&` is a consequence of the `[[ "$i" == 1 ]] &&`
 *  prefix it chains onto, not an inverted DECISION: rc 6 is still "I stood
 *  down, I did not decide." Only the seventh, `_pane_auto_continue_armed`,
 *  actually inverts the decision — unmeasurable -> HOLD (armed) — spec §6.3
 *  ruling R1, because a cancelled continuation cannot be un-cancelled. (This
 *  file's own header uses "fails OPEN" for the opposite thing — the PRE-fix
 *  defect of typing on a pane it cannot trust — so that phrase is dropped
 *  here rather than reused in the sense this paragraph needs.) A guard
 *  whose call, `return`, or SENSE moves reds that function's `it.each` row;
 *  a phrase grep that moves, appears or vanishes reds the census below. */
const POPULATION: Record<string, GuardSpec> = {
  _pane_auto_continue_armed: {
    count: 1,
    guard: /!\s*_pane_measurable\s+"\$2"\s*&&.*\breturn\b/,
  },
  _session_hard_blocked: {
    count: 1,
    guard: /(?<!!\s*)_pane_measurable\s+"\$id"\s*\|\|.*\breturn\b/,
  },
  _auto_stale_check: {
    count: 1,
    guard: /(?<!!\s*)_pane_measurable\s+"\$id"\s*\|\|.*\breturn\b/,
  },
  _auto_swap_check: {
    count: 1,
    guard: /(?<!!\s*)_pane_measurable\s+"\$id"\s*\|\|.*\breturn\b/,
  },
  // WAS `_auto_compact_check` UNTIL THE MERGE WITH routing slice 4, which extracted
  // `_idle_for_keystroke` and took the `esc to interrupt` grep with it. The census follows
  // the PHRASE, not the function name: the row moved because the read moved, and the guard
  // moved with it into the shared body so that slice 4's two new callers stand down too.
  // `_auto_compact_check` keeps a guard of its own — it stands down BEFORE the pane read
  // rather than after, which is the behaviour wave 2 shipped — but it no longer carries a
  // phrase, so it is no longer a member of this population.
  _idle_for_keystroke: {
    count: 1,
    guard: /(?<!!\s*)_pane_measurable\s+"\$id"\s*\|\|.*\breturn\b/,
  },
  _accept_first_run_prompts: {
    count: 3,
    guard: /!\s*_pane_measurable\s+"\$\{1#cc-\}"\s*&&.*\breturn\b/,
  },
  _redrive_after_spawn: {
    count: 2,
    guard: /(?<!!\s*)_pane_measurable\s+"\$id"\s*\|\|.*\breturn\b/,
  },
};

interface Site { fn: string; line: number; text: string }

/** Every line that MATCHES a phrase inside a grep, with the function it sits
 *  in. Whole-line comments are stripped first: `ccd/ccd` quotes
 *  `grep -q "esc to interrupt"` inside PROSE in exactly two places —
 *  `_auto_compact_check`'s window argument ("… then matches a stale banner
 *  further up (a false mid-turn…") and `_redrive_after_spawn`'s "PANE WINDOW
 *  IS `tail -8`" block — and a scan that counted those would demand guards for
 *  sentences.
 *
 *  ANCHORED BY CONTENT, NOT BY LINE NUMBER, and that is a correction rather
 *  than a preference: these two were cited here as 14702 and 15765, which were
 *  right on the pre-merge parent and wrong the moment this branch merged
 *  `origin/main`, and every subsequent edit to `ccd/ccd` moves them again —
 *  which is why this paragraph does not restate a current pair. The second
 *  was the dangerous one: 15765
 *  now lands on a real typing line, so the citation read as a live claim about
 *  the wrong kind of line. This wave's plan carries a deviation of its own
 *  about exactly this rot (the number is recorded there and not inline: the
 *  plan is not a file in this tree, so a D-ref here would name a number no plan
 *  HERE defines — `PaneHistoryReply`'s docstring in `shared/api.ts` argues that
 *  rule at length). A scan's own docstring should not add two more. */
function sites(): Site[] {
  const lines = readFileSync(CCD, 'utf8').split('\n');
  const out: Site[] = [];
  let fn = '';
  lines.forEach((raw, i) => {
    const def = /^([A-Za-z_][A-Za-z0-9_]*)\(\)\s*\{/.exec(raw);
    if (def) fn = def[1]!;
    if (/^\s*#/.test(raw)) return;
    if (!raw.includes('grep')) return;
    if (!PHRASES.some((p) => raw.includes(p))) return;
    out.push({ fn, line: i + 1, text: raw.trim() });
  });
  return out;
}

/** The lines between a function's `name() {` and `line`, exclusive — bounded
 *  at the far end by the function's OWN closing brace (column 0), so a
 *  phrase grep that lands past a mis-tracked function boundary cannot walk
 *  into a LATER function's guard and credit it to this one (fix round 1
 *  finding 4). */
function bodyBefore(fn: string, line: number): string[] {
  const lines = readFileSync(CCD, 'utf8').split('\n');
  const start = lines.findIndex((l) => new RegExp(`^${fn}\\(\\)\\s*\\{`).test(l));
  expect(start, `ccd/ccd no longer defines ${fn}() at column 0 — re-anchor this scan`)
    .toBeGreaterThanOrEqual(0);
  // `/^\}/`, NOT `l === '}'`: an exact compare skips a closing brace carrying a
  // trailing space or a `\r`, `close` falls through to the NEXT function's brace
  // (or to EOF), and the walk-into-a-later-function failure this bound exists to
  // close is silently back. Measured 2026-09-16 on `ccd/ccd`: `grep -c '^}'` and
  // `grep -c '^}$'` both answer 237, so this widening changes nothing today and
  // costs nothing.
  let close = lines.findIndex((l, i) => i > start && /^\}/.test(l));
  if (close === -1) close = lines.length;
  return lines.slice(start + 1, Math.min(line - 1, close));
}

describe('every phrase-matching reader stands down first (mutation tripwire)', () => {
  it('the census is exactly the enumerated population — anti-vacuity', () => {
    // Without this, deleting a guard AND its grep together would pass, and so
    // would a scan whose regex silently stopped matching anything.
    const found = sites();
    const counted: Record<string, number> = {};
    for (const s of found) counted[s.fn] = (counted[s.fn] ?? 0) + 1;
    const expected: Record<string, number> = {};
    for (const [fn, spec] of Object.entries(POPULATION)) expected[fn] = spec.count;
    expect(counted, 'a phrase grep moved, appeared or vanished — update POPULATION and its guard together')
      .toEqual(expected);
  });

  it.each(Object.entries(POPULATION))('%s calls _pane_measurable, in its pinned SHAPE, before it matches a phrase', (fn, spec) => {
    for (const s of sites().filter((x) => x.fn === fn)) {
      expect(
        bodyBefore(fn, s.line).some((l) => !/^\s*#/.test(l) && spec.guard.test(stripComment(l))),
        // THE EXPECTED SHAPE IS PART OF THE MESSAGE. Without it a legitimate
        // REWORD of a guard — which is what this row most often catches — reads
        // as "you deleted the guard", and the reader has to open two files to
        // find out which. `spec.guard` is the thing that actually decided.
        `${fn} (ccd/ccd:${s.line}) matches a calibration phrase with no _pane_measurable guard of the `
        + `pinned shape ahead of it in the same function.\n    phrase site:     ${s.text}`
        + `\n    shape required:  ${spec.guard}`,
      ).toBe(true);
    }
  });

  it('_pane_measurable is defined exactly once, and reads the width it claims to', () => {
    const src = readFileSync(CCD, 'utf8');
    expect(src.split('\n').filter((l) => /^_pane_measurable\(\)\s*\{/.test(l)))
      .toHaveLength(1);
    const body = src.slice(src.indexOf('_pane_measurable() {'));
    const end = body.indexOf('\n}\n');
    // FAILS OPEN otherwise: indexOf's -1 makes body.slice(0, -1) the WHOLE
    // REST OF THE FILE, and all three checks below then pass on unrelated
    // code (fix round 1 finding 3).
    expect(end, 'the function no longer closes at column 0').toBeGreaterThan(0);
    const fn = body.slice(0, end);
    expect(fn, 'the probe must select the ACTIVE pane (F7)').toContain('#{pane_active}');
    expect(fn, 'the probe must read the width, not the height').toContain('#{pane_width}');
    // A bare toContain('READER_MIN_COLS') is satisfied by this function's OWN
    // 30-line docstring, which names the constant three times in prose —
    // measured (fix round 1 finding 2): mutating the real comparison to a
    // bare `120`, even after ALSO scrubbing the def-line's inline mention,
    // leaves a bare toContain green. The arithmetic SHAPE itself never
    // appears in prose, so anchor on it directly instead.
    expect(fn, 'the comparison must be against the derived constant, not a copy')
      .toMatch(/\(\(\s*w\s*>=\s*READER_MIN_COLS\s*\)\)/);
  });
});

describe('the phrase literals themselves are NOT changed (F11)', () => {
  it('the four phrases exist verbatim SOMEWHERE in ccd/ccd (existence only — per-site correctness is the census above)', () => {
    // Spec §6.3 is explicit that the regexes stay as they are and the guard is
    // what changes. A "fix" that widened `esc\s+to\s+interrupt` would still not
    // match across the newline grep never presents, and it would silently break
    // `auto-continue-armed.test.ts`'s cross-copy pin. This is a WHOLE-FILE
    // toContain, so it proves each literal exists SOMEWHERE — counted:
    // `grep -q "esc to interrupt"` (that exact substring) occurs on 8 lines
    // total — re-measured 2026-09-16 — six of them the census's own real sites
    // and two the whole-line prose comments `sites()` above names by their
    // CONTENT (line numbers here rotted once already) — not that every site in
    // `sites()` still carries it verbatim; that job belongs to `sites()`'s
    // own `PHRASES.some((p) => raw.includes(p))` filter (fix round 1
    // finding 5: the title here now says only what this checks).
    const src = readFileSync(CCD, 'utf8');
    expect(src).toContain('grep -qiE "continuing automatically|continuing shortly"');
    expect(src).toContain('grep -q "esc to interrupt"');
    expect(src).toContain('grep -q "Enter to confirm"');
  });
});
