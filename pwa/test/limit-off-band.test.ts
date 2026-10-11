// The condemned lane's gauge fill, measured — and preserved.
//
// WHAT THIS PINS. `LimitBar`'s fourth band, `off`, paints `--edge-subtle` on
// `--limit-track`. Across all twelve palettes that pair measures 1.02 to 1.10.
// A fill at 1.05 against its own track is not a quiet fill; it is an absent
// one. The row beside it still reads "91%", so a condemned lane shows a number
// with no bar under it — the exact contradiction `SwapSheet`'s own Gauge
// comment refuses elsewhere ("A confident bar and the word 'reset' would
// contradict each other in the same row").
//
// WHY IT IS STILL HERE. It is not new. `fleet.css` carried
// `.acct-list .acct-row[data-disabled='true'] .limit-fill { background:
// var(--edge-subtle) }` and has been shipping that colour; moving it onto the
// component as a band changed the owner, not a pixel. This branch's standing
// instruction is to cut custom lines WITHOUT changing the design, so the
// colour stays and the defect becomes visible instead of invisible.
//
// WHY NOT contrast-check.mjs. Stating it there as a token pair would red the
// gate for a pixel this branch may not change, and lowering the pair's floor
// to make it pass would be a lie about the contract. So it is pinned here, at
// its measured value, in both directions: the test reds if the ratio drifts,
// and it reds if someone silently FIXES it. A fix is welcome — it is simply
// not something that should happen without the number being restated.
//
// THE FIX, WHEN IT IS WANTED. `--ink-tertiary` on the same track measures 4.32
// at worst (ONE-DARK) and 13.58 at best — the cheapest token that clears 3:1
// everywhere. One line in `fillVariants`.
//
// NOT `--ink-disabled`, which is the token the name suggests and the one this
// file first proposed: it measures 2.11 in LIGHT and fails. That is why the
// remedy below is an ASSERTION and not a sentence — the sentence was wrong
// when written, and only the assertion said so.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadThemes, ratio } from '../design/audit.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const { DARK, byName } = loadThemes(ROOT);
const all: [string, Record<string, string>][] = [['DARK', DARK], ...Object.entries(byName)];

const UI_SRC = path.join(import.meta.dirname, '..', '..', 'ui', 'src');
const limitBar = readFileSync(path.join(UI_SRC, 'primitives', 'limit-bar.tsx'), 'utf8');

/** The band's own measured ceiling. Anything at or under this is "invisible",
 *  which is what the entry below records; 3:1 is where it would stop being. */
const MEASURED_CEILING = 1.2;

describe('the `off` band is a preserved defect, not a cleared floor', () => {
  it('is the colour the deleted fleet.css rule set, so no pixel moved', () => {
    // The whole justification for leaving it: this is a change of OWNER.
    expect(limitBar).toContain("off: 'limit-fill--off bg-edge-subtle'");
  });

  it('measures under 3:1 against its own track in every palette — the defect', () => {
    const rows = all.map(([name, theme]) =>
      [name, ratio('var(--edge-subtle)', ['var(--limit-track)'], theme)] as const);
    // Pinned in BOTH directions. Under the ceiling: still the shipped defect.
    // Over it: someone changed the colour, and this test is where they say so.
    const drifted = rows.filter(([, r]) => r > MEASURED_CEILING)
      .map(([n, r]) => `${n} = ${r.toFixed(2)} — the off band was fixed or re-tinted; restate it here`);
    expect(drifted).toEqual([]);
    const broken = rows.filter(([, r]) => r >= 3).map(([n]) => n);
    expect(broken, 'if this passes 3:1 the defect is gone — delete this file').toEqual([]);
  });

  it('holds the remedy to its own figure, so the decision needs no re-measuring', () => {
    // Asserted rather than commented, and the first draft of this file proves
    // why: it named `--ink-disabled`, which reads 2.11 in LIGHT. The assertion
    // caught the prose. If a palette change ever makes the real remedy stop
    // working, this reds instead of the header going quietly stale.
    const worst = Math.min(...all.map(([, t]) =>
      ratio('var(--ink-tertiary)', ['var(--limit-track)'], t)));
    expect(worst, '--ink-tertiary no longer clears 3:1 on the track').toBeGreaterThanOrEqual(3);
    // And the token the NAME suggests still does not, which is the trap.
    const naive = Math.min(...all.map(([, t]) =>
      ratio('var(--ink-disabled)', ['var(--limit-track)'], t)));
    expect(naive, 'if --ink-disabled now clears 3:1, say so and simplify the header')
      .toBeLessThan(3);
  });
});
