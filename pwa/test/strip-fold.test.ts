// The lanes strip's fold (desktop polish S5b, D-6530): `stripFold.ts` decides how many lanes a folded strip shows, whether
// it folds at all, and what its one line of words says. Pure L1, so the cases here run with no DOM: the shared 17-lane
// fixture for the operator's fleet, and small fixtures of their own for the edges (five lanes, six, all expired).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AccountUsage } from '../../shared/api';
import { lanesByFree } from '../src/fleet/laneOrder';
import { FOLD_SHOWN, LANE_CARD_MIN, foldLanes, foldShown, foldWords, rowFit } from '../src/fleet/stripFold';
import { declaredValues, norm, stripComments } from './cssRule';
import { seventeenLanes } from './seventeenLanes';

const NOW_S = 1_900_000_000;
const NOW_MS = NOW_S * 1000;
const SRC = path.join(import.meta.dirname, '..', 'src');
const sourceOf = (rel: string): string => readFileSync(path.join(SRC, rel), 'utf8');
/** `//` and block comments removed, so a scan reads code and not the prose beside it. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** A lane reading `five` and `seven`, with a reset ahead; `extra` overrides any field. */
function lane(id: string, five: number | null, seven: number | null, extra: Partial<AccountUsage> = {}): AccountUsage {
  return {
    wrapper: id, five, seven, ts: NOW_S - 60, fiveResetAt: NOW_S + 7200, sevenResetAt: NOW_S + 86_400,
    fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...extra,
  };
}
/** `n` lanes `l0`..`l<n-1>` reading 10, 20, 30... on both windows, freest first already. */
const ladder = (n: number): AccountUsage[] => Array.from({ length: n }, (_, i) => lane(`l${i}`, 10 + i * 10, 10 + i * 10));
const ids = (lanes: readonly AccountUsage[]): string[] => lanes.map((l) => l.wrapper);

const fixture = seventeenLanes(NOW_S);
const sorted17 = lanesByFree(fixture.accounts);

describe('foldLanes over the shared 17 lanes', () => {
  it("with 17 lanes the fold shows the freest four, in lanesByFree's order, and hides the fullest thirteen", () => {
    const fold = foldLanes(sorted17, false, FOLD_SHOWN);
    expect(ids(fold.shown)).toEqual(['w0', 'w5', 'w3', 'w4']);
    expect(ids(fold.hidden)).toEqual(['w6', 'w7', 'w8', 'w9', 'w10', 'w11', 'w12', 'w13', 'w14', 'w15', 'w16', 'w1', 'w2']);
    expect(fold.foldable).toBe(true);
    expect(fold.expanded).toBe(false);
  });

  it('expanded shows every lane, in the same order', () => {
    const fold = foldLanes(sorted17, true, FOLD_SHOWN);
    expect(ids(fold.shown)).toEqual(ids(sorted17));
    expect(fold.hidden).toEqual([]);
    expect(fold.foldable).toBe(true);
    expect(fold.expanded).toBe(true);
  });

  it('+n more counts the hidden lanes that need you: sign-in expired, then rate-limited, a kind at zero left out', () => {
    expect(foldWords(foldLanes(sorted17, false, FOLD_SHOWN), NOW_MS)).toBe('+13 more · 1 sign-in expired · 1 rate-limited');
    // A kind at zero is left out: with the rate-limited lane (w16) shown, only the expired one is hidden and counted.
    const noLimit = lanesByFree(fixture.accounts.map((a) => (a.wrapper === 'w16' ? { ...a, five: 30 } : a)));
    expect(foldWords(foldLanes(noLimit, false, FOLD_SHOWN), NOW_MS)).toBe('+13 more · 1 sign-in expired');
    // And with neither kind hidden the words are the count alone.
    expect(foldWords(foldLanes(ladder(6), false, FOLD_SHOWN), NOW_MS)).toBe('+2 more');
  });
});

describe('foldLanes never hides fewer than two lanes', () => {
  it('foldable is false at five lanes and true at six, folded or expanded', () => {
    for (const expanded of [false, true]) {
      expect(foldLanes(ladder(5), expanded, FOLD_SHOWN).foldable).toBe(false);
      expect(foldLanes(ladder(6), expanded, FOLD_SHOWN).foldable).toBe(true);
    }
  });

  it('it never folds to hide a single lane: five lanes show all five', () => {
    for (const expanded of [false, true]) {
      const fold = foldLanes(ladder(5), expanded, FOLD_SHOWN);
      expect(ids(fold.shown)).toEqual(['l0', 'l1', 'l2', 'l3', 'l4']);
      expect(fold.hidden).toEqual([]);
    }
  });

  it('six lanes fold to four and +2', () => {
    const fold = foldLanes(ladder(6), false, FOLD_SHOWN);
    expect(ids(fold.shown)).toEqual(['l0', 'l1', 'l2', 'l3']);
    expect(ids(fold.hidden)).toEqual(['l4', 'l5']);
    expect(foldWords(fold, NOW_MS)).toBe('+2 more');
  });

  it('one rule at every width: at a desk whose folded line holds 3 cards, 4 lanes show all four and no control, and 5 fold to 3 and +2', () => {
    const count = foldShown(true, 4);
    expect(count).toBe(3);
    const four = foldLanes(ladder(4), false, count);
    expect(four.foldable).toBe(false);
    expect(ids(four.shown)).toEqual(['l0', 'l1', 'l2', 'l3']);
    expect(foldWords(four, NOW_MS)).toBeNull();
    const five = foldLanes(ladder(5), false, count);
    expect(five.foldable).toBe(true);
    expect(ids(five.shown)).toEqual(['l0', 'l1', 'l2']);
    expect(foldWords(five, NOW_MS)).toBe('+2 more');
  });

  it('an unmeasured desk row folds nothing: every lane, no control', () => {
    for (const width of [null, 0, -40, Number.NaN]) expect(rowFit(width, LANE_CARD_MIN, 8)).toBeNull();
    expect(foldShown(true, null)).toBeNull();
    for (const expanded of [false, true]) {
      const fold = foldLanes(ladder(17), expanded, foldShown(true, rowFit(0, LANE_CARD_MIN, 8)));
      expect(fold.foldable).toBe(false);
      expect(ids(fold.shown)).toEqual(ids(ladder(17)));
      expect(fold.hidden).toEqual([]);
      expect(foldWords(fold, NOW_MS)).toBeNull();
    }
  });
});

describe('what the fold hides and what its words count', () => {
  it('the fold hides by position, never by state: six lanes, four of them sign-in expired, show the readable two and two expired ones, and +2 more · 2 sign-in expired', () => {
    const lanes = lanesByFree([
      lane('x0', 30, 30, { authDead: true }), lane('x1', 20, 20), lane('x2', 40, 40, { authDead: true }),
      lane('x3', 50, 50, { authDead: true }), lane('x4', 10, 10), lane('x5', 60, 60, { authDead: true }),
    ]);
    const fold = foldLanes(lanes, false, FOLD_SHOWN);
    expect(ids(fold.shown)).toEqual(['x4', 'x1', 'x0', 'x2']);
    expect(ids(fold.hidden)).toEqual(['x3', 'x5']);
    expect(foldWords(fold, NOW_MS)).toBe('+2 more · 2 sign-in expired');
  });

  it('a hidden lane that is only critical is not counted', () => {
    const lanes = [...ladder(4), lane('hot-a', 76, 76), lane('hot-b', 99, 40)];
    const fold = foldLanes(lanesByFree(lanes), false, FOLD_SHOWN);
    expect(ids(fold.hidden)).toEqual(['hot-a', 'hot-b']);
    expect(foldWords(fold, NOW_MS)).toBe('+2 more');
  });

  it('a lane counts once, sign-in expired first', () => {
    // Expired and at its limit: it sorts last (expired), is hidden, and counts as the lapsed sign-in only.
    const lanes = [...ladder(5), lane('both', 100, 100, { authDead: true })];
    const fold = foldLanes(lanesByFree(lanes), false, FOLD_SHOWN);
    expect(ids(fold.hidden)).toEqual(['l4', 'both']);
    expect(foldWords(fold, NOW_MS)).toBe('+2 more · 1 sign-in expired');
  });

  it('a never-read lane is hidden but not counted as needing you', () => {
    const lanes = [...ladder(4), lane('unread-a', null, null), lane('unread-b', null, null)];
    const fold = foldLanes(lanesByFree(lanes), false, FOLD_SHOWN);
    expect(ids(fold.hidden)).toEqual(['unread-a', 'unread-b']);
    expect(foldWords(fold, NOW_MS)).toBe('+2 more');
  });

  it('expanded, the words are Show fewer; not foldable, there are none', () => {
    expect(foldWords(foldLanes(sorted17, true, FOLD_SHOWN), NOW_MS)).toBe('Show fewer');
    for (const expanded of [false, true]) expect(foldWords(foldLanes(ladder(5), expanded, FOLD_SHOWN), NOW_MS)).toBeNull();
  });

  it('the words take SIGN_IN_EXPIRED and the state word', () => {
    const text = code(sourceOf('fleet/stripFold.ts'));
    expect(text).toMatch(/\bSIGN_IN_EXPIRED\b/);
    expect(text).toMatch(/\bstateWordFor\b/);
    // The phrase is imported, never retyped; the limit and the lapsed sign-in are read from the one decider.
    expect(text).not.toMatch(/sign-in expired/i);
    expect(text).not.toMatch(/WINDOW_LIMITED_PCT/);
    expect(text).not.toMatch(/\bauthDead\b/);
    expect(text).not.toMatch(/\b(?:five|seven)\b\s*[<>]=?/);
    expect(text).not.toMatch(/[<>]=?\s*\d{2,3}\b/);
  });
});

describe('how many lanes a folded strip shows', () => {
  it('a phone folds to four whatever its width', () => {
    for (const n of [null, 0, 1, 2, 3, 7, 40]) expect(foldShown(false, n)).toBe(FOLD_SHOWN);
    expect(FOLD_SHOWN).toBe(4);
  });

  it("a desk folds to one card fewer than rowFit's tracks, the last track the end cell's", () => {
    expect(foldShown(true, 4)).toBe(3);
    expect(foldShown(true, 1)).toBe(1);
    expect(foldShown(true, 7)).toBe(6);
  });

  it('rowFit counts the tracks one line holds: 868, 1248 and 1888 px hold 3, 4 and 7 with an 8 px gap, 1064 px holds 4 and 528 px holds 2 (where a count without the gap added back holds one fewer), and any positive width at least one', () => {
    expect(rowFit(868, LANE_CARD_MIN, 8)).toBe(3);
    expect(rowFit(1248, LANE_CARD_MIN, 8)).toBe(4);
    expect(rowFit(1888, LANE_CARD_MIN, 8)).toBe(7);
    expect(rowFit(1064, LANE_CARD_MIN, 8)).toBe(4);
    expect(rowFit(528, LANE_CARD_MIN, 8)).toBe(2);
    for (const width of [1, 100, 259, 0.5]) expect(rowFit(width, LANE_CARD_MIN, 8)).toBe(1);
  });
});

describe('the fold reads no layout and the card floor is written once', () => {
  it("the card's floor is LANE_CARD_MIN, once: every lanes-row rule in shell.css reads the token, and none writes the figure", () => {
    // Comments out: the rules' own prose names the token and may name the constant.
    const css = stripComments(readFileSync(path.join(SRC, 'styles', 'shell.css'), 'utf8'));
    // The strip's grid and the flyout's grid, each a minmax over the token and no px length.
    for (const sel of ['.shell-accounts .accounts-strip', '.shell-accounts .accounts-flyout']) {
      const grids = declaredValues(css, sel, 'grid-template-columns');
      expect(grids.length, sel).toBeGreaterThan(0);
      for (const grid of grids) {
        expect(grid, sel).not.toContain(`${LANE_CARD_MIN}px`);
        expect(grid, sel).not.toMatch(/minmax\(\s*[\d.]+px/);
        expect(grid, sel).toMatch(/minmax\(\s*var\(--lane-card-min\)\s*,/);
      }
    }
    // The token is declared (css-vars wants a definition) with no value of its own: the strip's inline style gives it
    // `LANE_CARD_MIN`, so a declaration anywhere that wrote a length would be a second copy of the figure.
    const declared = [...css.matchAll(/--lane-card-min\s*:\s*([^;}]*)/g)].map((m) => norm(m[1]!));
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.every((v) => v === 'initial'), `--lane-card-min declared as ${declared.join(', ')}`).toBe(true);
    // And the figure is in no rule of the file, whatever the property.
    expect(css).not.toContain(`${LANE_CARD_MIN}px`);
  });

  it('stripFold.ts reads no layout', () => {
    for (const file of ['fleet/stripFold.ts', 'fleet/stripExpanded.ts']) {
      expect(code(sourceOf(file)), file).not.toMatch(/matchMedia|useMediaQuery|useDesk|innerWidth|ResizeObserver/);
    }
  });
});
