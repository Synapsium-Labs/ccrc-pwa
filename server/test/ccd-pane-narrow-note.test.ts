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
// MEASURED 2026-09-16 — every property has a mutant that reds IT, and the shipped
// tree is the control. A property with no mutant that reds is not pinned, it is
// merely green, which is the defect this file exists to end:
//   mutant                                      | what reds
//   delete both `_pane_narrow_note` call sites  | (a) 2/2 — the two call-site tests
//   delete the `COMPACT_NOTE_FLOOR` guard line  | (b) "does not speak again"
//   `[[ -n "$said" ]] && return 0` (never re-opens) | (b) "speaks again once passed"
//   `${site}narrownote` -> shared `narrownote`  | (c) 2/2 — the per-site tests
// Each mutant reds ONLY the property it breaks; the shipped tree is 6/6 green. The
// two floor mutants are the reason (b) is listed as proven rather than assumed: the
// first fix round pinned (b) and never mutated it, so its green said nothing.
//
// Fixture HOME only, with the `WIDE_PANE` idiom's narrow counterpart spread into a
// `tmux()` stub — an uncontained `list-panes` reads the operator's LIVE server.
import { describe, it, expect } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
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
