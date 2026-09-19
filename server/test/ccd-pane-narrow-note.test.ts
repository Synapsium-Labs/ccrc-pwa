// `_pane_narrow_note` (`ccd/ccd`, drawer wave 2) — pins for the three properties its
// own 25-line header argues but no test measured (review findings S2/S8, both MAJOR,
// 0/3 refuters). The doctrine this repo states elsewhere: "A comment is a request; a
// red suite is a mechanism." This file is that mechanism, for three claims:
//   (a) both call sites exist — `_auto_swap_check` and `_auto_stale_check` each call
//       it on a narrow pane; deleting either call must RED.
//   (b) it is FLOORED by COMPACT_NOTE_FLOOR — at most once per window, and open again
//       once the window has passed.
//   (c) the anchor is PER-SITE (`${site}narrownote`), not one shared `narrownote` —
//       `_auto_stale_check` runs before `_auto_swap_check` on the same tick, so a
//       shared anchor would let the stale lane's line silence the swap lane's for the
//       whole window.
//
// `server/test/ccd-arith-containment.test.ts` already exercises `_pane_narrow_note`
// directly (a payload case planted in `swapnarrownote`, and a structural row on its
// `$((now - said))`/`COMPACT_NOTE_FLOOR` line), but neither test calls the two real
// guards or plants a SECOND site — S2's own evidence measured both wrong
// implementations below passing that file unchanged. This file is additive, not a
// replacement.
//
// ROUND 3 (S2/S5/S3): the round-2 mutation table below was honest as far as it went,
// but its own call-site tests match the swap.log STRING rather than the CALL — two
// wrong implementations were fully green against it: (i) moving the call OUT of the
// guard branch, so a WIDE pane gets a narrow note too; (ii) inlining an unfloored copy
// of the log line at the call site with the call itself deleted, so the tick path
// never goes through the floor at all. And its floor-VALUE tests derive their backdate
// FROM `COMPACT_NOTE_FLOOR` itself, which bounds a mutated comparison from above only
// — an 18-second floor passed both. Four more cases below close those three gaps.
//
// MEASURED 2026-09-16 (round 2) and re-measured 2026-09-16 (round 3, this file plus
// `ccd-arith-containment.test.ts`'s structural row) — every property has a mutant that
// reds IT, and the shipped tree is green throughout. A property with no mutant that
// reds is not pinned, it is merely green, which is the defect this file exists to end.
// A mutant that removes shared machinery (the floor guard itself, or the per-site
// split) legitimately reds more than one case — that is not noise, it is every case
// that actually depends on the thing removed — so this table names ALL of what reds,
// not just the row's own headline case:
//   mutant                                                | what reds
//   delete both `_pane_narrow_note` call sites            | the 2 call-site tests (a), AND "the floor holds on the tick path too" (throws: no line was ever written to read)
//   delete the `COMPACT_NOTE_FLOOR` guard line            | "does not speak again" (b), "the floor holds on the tick path too", "R2: still silent 5s BEFORE", AND the arith-containment structural row (the anchor line is gone)
//   `[[ -n "$said" ]] && return 0` (never re-opens)        | "speaks again once passed" (b), AND the arith-containment structural row (the line no longer carries `$((now - said))`/`COMPACT_NOTE_FLOOR`)
//   `${site}narrownote` -> shared `narrownote`            | the 2 per-site tests (c), AND "R2: still silent 5s BEFORE" (the backdate lands on a field the mutated code never reads, so `said` is empty and the guard cannot suppress)
//   move the call OUT of the guard branch (fires WIDE too)| ONLY R1 "a WIDE-pane tick writes no narrow note"
//   inline an unfloored copy, call deleted, at the swap site | ONLY "the floor holds on the tick path too" — the call-site tests stay green because the inlined TEXT is byte-identical
//   `-lt "$((COMPACT_NOTE_FLOOR / 100))"` (an 18s floor)  | ONLY R2 "still silent 5s BEFORE the floor expires" — the constant's token stays on the line, so the structural row still matches
//   `COMPACT_NOTE_FLOOR=18` (the constant's own literal shrunk) | ONLY "the floor constant itself is at least 1800s" — R2 derives its backdate from this same shrunk constant, so it cannot see this mutant; that is the reason the ratchet exists as a SEPARATE case
// The two round-2 floor mutants are the reason (b)'s EXISTENCE is proven rather than
// assumed; R2 and the literal ratchet are what proves the floor's VALUE rather than
// only its presence — R2 catches a mutated COMPARISON (the constant's own token stays
// on the line), the ratchet catches a mutated ASSIGNMENT.
//
// Fixture HOME only. `makeCcdHarness`'s `sh` runs every snippet through
// `ghContainedEnv(..., {tmux: true})`, which plants a poisoned `tmux` on PATH ahead of
// anything real and answers every verb with a bare refusal (exit 97) — so even WITHOUT
// a bash `tmux()` stub here, `list-panes` cannot reach the operator's live server; it
// would just make every case in this file exercise the unmeasurable stand-down instead
// of the property it means to test. The bash-function stub (bash resolves functions
// before PATH) is what lets a case answer a SPECIFIC width rather than a blanket
// refusal — that is what it is for, not containment, which the harness already owns.
import { describe, it, expect } from 'vitest';
import { makeCcdHarness, WIDE_PANE, type CcdHarness } from './ccdWsHelpers.js';
import { READER_MIN_COLS } from '../../shared/api.js';

/** The width query answered NARROW — one column under the calibration floor — for a
 *  stub that answers NOTHING to every other tmux verb. Note what that is and is not:
 *  a bash `case` with no matching arm exits 0 with empty stdout, so other verbs are
 *  silently SUCCESSFUL-but-empty, not refused. That is sufficient here — the guard
 *  reads this query's output and nothing past it is reached — but a test that needs a
 *  real refusal must say `return 1` in a default arm rather than rely on this. */
const NARROW_PANE = `tmux() { case "$1" in list-panes) printf '%s\\n' '1 ${READER_MIN_COLS - 1}' ;; esac; };`;

const swapLog = (h: CcdHarness): string => {
  const v = h.sh('cat "$REG/swap.log" 2>/dev/null; true');
  return v;
};

describe('_pane_narrow_note call sites (S2/S8a): deleting either must red', () => {
  it('_auto_swap_check calls it on a narrow pane', () => {
    const h = makeCcdHarness('narrownote-swapsite-');
    h.sh(`${NARROW_PANE} _auto_swap_check myid`);
    expect(swapLog(h), 'the guard stood the tick down silently — the call was dropped')
      .toMatch(new RegExp(`swap-skip myid: pane is under ${READER_MIN_COLS} columns`));
    h.cleanup();
  });

  it('_auto_stale_check calls it on a narrow pane', () => {
    const h = makeCcdHarness('narrownote-stalesite-');
    h.sh(`${NARROW_PANE} _auto_stale_check myid`);
    expect(swapLog(h), 'the guard stood the tick down silently — the call was dropped')
      .toMatch(new RegExp(`stale-skip myid: pane is under ${READER_MIN_COLS} columns`));
    h.cleanup();
  });
});

describe('_pane_narrow_note fires ONLY through the guard branch, never on a WIDE pane (S2/S5, round 3)', () => {
  it('R1: a WIDE-pane tick writes no narrow note', () => {
    // Closes the wrong implementation S2 measured green: moving the
    // `_pane_narrow_note` call OUT of the `_pane_measurable "$id" || { ... }`
    // branch so it fires unconditionally. Under that mutant every 5s supervise
    // tick on an ordinary WIDE pane would append a narrow-note line — this is
    // the case that catches it, driven through the real tick function rather
    // than a direct call.
    const h = makeCcdHarness('narrownote-wide-');
    h.sh(
      '_reg_set myid wrapper claude; _reg_set myid home claude;'
      + ' _home_for(){ echo claude; }; _swap_target(){ return 1; };'
      + ` _dispatch_swap(){ :; }; tmux(){ ${WIDE_PANE} :; };`
      + ' _auto_swap_check myid || :');
    expect(swapLog(h), 'a 200-column pane produced a narrow-note line — the call is not gated on the guard')
      .not.toMatch(/swap-skip myid: pane is under/);
    h.cleanup();
  });

  it('the floor holds on the tick path too — a second _auto_swap_check call inside the window still writes ONE line', () => {
    // Closes the OTHER wrong implementation S5 measured green: inlining an
    // UNFLOORED copy of the swap-skip log line at the call site with the
    // `_pane_narrow_note` call itself deleted. Both round-2 floor tests
    // (below) call `_pane_narrow_note` directly, so neither can tell a floored
    // call from an unfloored inline echo that happens to produce the same
    // text — this drives the SAME floor through the real tick entrypoint,
    // twice, inside one window.
    const h = makeCcdHarness('narrownote-tickfloor-');
    const log = h.sh(`${NARROW_PANE} _auto_swap_check myid; _auto_swap_check myid; cat "$REG/swap.log"`);
    const lines = log.trim().split('\n').filter((l) => l.includes('swap-skip'));
    expect(lines, 'two tick calls inside the floor window wrote two lines — the tick path is not floored')
      .toHaveLength(1);
    h.cleanup();
  });
});

describe('_pane_narrow_note is FLOORED by COMPACT_NOTE_FLOOR (S2/S8b)', () => {
  it('a second call in the same window does not speak again', () => {
    const h = makeCcdHarness('narrownote-floor-');
    const log = h.sh('_pane_narrow_note myid swap; _pane_narrow_note myid swap; cat "$REG/swap.log"');
    const lines = log.trim().split('\n').filter((l) => l.includes('swap-skip'));
    expect(lines, 'a second call inside the floor window wrote a second line — the floor is not enforced')
      .toHaveLength(1);
    h.cleanup();
  });

  it('speaks again once COMPACT_NOTE_FLOOR has passed — the floor is a window, not a permanent silence', () => {
    const h = makeCcdHarness('narrownote-floor-open-');
    // Backdate the anchor past the floor rather than hand-copying its value: the
    // window is read from ccd's own constant, so this stays true if the constant
    // is ever re-tuned.
    const log = h.sh(
      '_reg_set myid swapnarrownote $(( $(date +%s) - COMPACT_NOTE_FLOOR - 5 ));'
      + ' _pane_narrow_note myid swap; cat "$REG/swap.log"');
    expect(log, 'a stale anchor still suppressed the note — the floor never re-opens')
      .toMatch(/swap-skip myid: pane is under \d+ columns/);
    h.cleanup();
  });
});

describe('the floor PINS A VALUE, not just an existence (S3, round 3)', () => {
  // The two tests above bound a mutated comparison from ABOVE only: case 1
  // makes two calls in the same second, so any floor greater than zero
  // passes it, and case 2 backdates by `COMPACT_NOTE_FLOOR + 5`, so any floor
  // narrower than that passes it too. An 18-second floor sits inside that gap
  // and both stayed green under it (measured). The two cases below close it.
  it('R2: still silent 5s BEFORE the floor expires', () => {
    // Backdates by `COMPACT_NOTE_FLOOR - 5` — five seconds SHORT of the real
    // window — and asserts silence. A comparison mutated to a much narrower
    // effective floor (e.g. dividing the constant at the point of use) sees
    // this backdate as long past its own shrunk window and speaks anyway,
    // reddening this case, while the derivation keeps the case true if the
    // constant is ever re-tuned for a real reason.
    const h = makeCcdHarness('narrownote-floor-tight-');
    h.sh('_reg_set myid swapnarrownote $(( $(date +%s) - (COMPACT_NOTE_FLOOR - 5) )); _pane_narrow_note myid swap');
    expect(swapLog(h), 'a floor five seconds short of the real constant still spoke — the comparison is narrower than COMPACT_NOTE_FLOOR')
      .toBe('');
    h.cleanup();
  });

  it("the floor constant itself is at least 1800s — a literal ratchet, not derived from the comparison it guards", () => {
    // R2 above derives its backdate FROM `$COMPACT_NOTE_FLOOR` as read out of
    // the very shell whose constant a mutant could shrink, so it cannot tell
    // apart a shrunk ASSIGNMENT (`COMPACT_NOTE_FLOOR=18`) from the real one —
    // both would still pass R2, because R2's own backdate shrinks with it.
    // This pins the assignment directly, against a literal: D-2013's stated
    // budget (one line per session per window against a 5s tick) is the
    // reason the floor exists at all, and it is not honoured by a window
    // measured in tens of seconds.
    const h = makeCcdHarness('narrownote-floor-ratchet-');
    const floor = Number(h.sh('echo "$COMPACT_NOTE_FLOOR"'));
    expect(floor, "COMPACT_NOTE_FLOOR's own assignment shrank below D-2013's budget floor")
      .toBeGreaterThanOrEqual(1800);
    h.cleanup();
  });
});

describe('_pane_narrow_note anchors PER SITE, not on one shared field (S2/S8c)', () => {
  it('writes `swapnarrownote`, and touches no shared `narrownote` field', () => {
    const h = makeCcdHarness('narrownote-field-');
    h.sh('_pane_narrow_note myid swap');
    const perSite = h.reg('myid', 'swapnarrownote');
    expect(perSite, 'the per-site field was never written').not.toBeNull();
    expect(perSite).toMatch(/^[0-9]+$/);
    expect(h.reg('myid', 'narrownote'), 'a shared field exists — the anchor is not per-site').toBeNull();
    h.cleanup();
  });

  it("_auto_stale_check's line does not silence _auto_swap_check's for the whole window", () => {
    // The exact order a real supervise tick uses: stale runs BEFORE swap
    // (ccd/ccd's `_sync_uuid "$id"; _auto_stale_check "$id"; _auto_swap_check "$id"`).
    // A shared anchor lets the first call's write suppress the second inside the
    // same COMPACT_NOTE_FLOOR window — the exact silence the header argues against.
    const h = makeCcdHarness('narrownote-persite-');
    const log = h.sh('_pane_narrow_note myid stale; _pane_narrow_note myid swap; cat "$REG/swap.log"');
    expect(log, "the stale lane's note is missing").toMatch(/stale-skip myid: pane is under \d+ columns/);
    expect(log, "the swap lane's note was silenced by the stale lane's write — collapsed to a shared anchor")
      .toMatch(/swap-skip myid: pane is under \d+ columns/);
    h.cleanup();
  });
});
