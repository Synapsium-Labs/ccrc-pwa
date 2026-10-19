// The folded card's name has a floor: a long card meta never crushes it.
//
// WHAT WAS MEASURED (D-5574). A fold hides the selected row, so the folded
// card's name stands in for it with the row's tint and rail (D-5495). The
// header's other items (the session count, the pin, "2 stranded", the
// attention mark, "2 working") are all `flex: none` or nowrap, so the name was
// the only item that could give, and it gave all of it. With a five-session
// card carrying every one of those, the name drew at 10px at 1280 in both
// skins (its own padding, no letter of the name), and the meta still ran 34px
// (Refined) or 28px (Instrument) past the toggle, under the card's + button.
//
// THE FLOOR, AND WHY IT IS NOT A `min-width` LENGTH. The name keeps its own
// width (`flex-shrink: 0`) and is capped at the line less the chevron and the
// toggle's gap, so its floor is the smaller of the whole name and that. A fixed
// `min-width: 8ch` would also have held, but it pads a short name's tint past
// its last letter, since `min-width` wins over the content width; a CSS
// `min(<length>, max-content)` would avoid that and is not valid CSS.
//
// THE WRAP (D-5575). A floor alone moves the crush onto the meta, which ran
// under the + button already. So the folded card's toggle wraps, the idiom
// #647 set for the session cards (D-5545: a cell wraps rather than squeezes):
// what does not fit beside the name drops to a second line inside the toggle.
//
// EVERY CARD (D-5576). #667 floored only the folded card holding the
// selection. An unselected card with the same long meta still drew its name at
// 0px (folded, at 1280, both skins), 16.8px (Refined) or 22.8px (Instrument)
// at 360, and an open one at 48.7px in the desktop sidebar, with the meta 24px
// past the toggle. The coordinator ruled that every project card keeps its
// name: a card is a glance, and its name is never crushed. So the floor and
// the wrap now sit on the base `.proj-card-name` and `.proj-card-toggle`
// rules, folded or not, selected or not, and the selection rule keeps only its
// tint, rail and padding.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { atBlock, declaredValues, effectiveValue, stripComments } from './cssRule';

const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
// The floor and the wrap are the base rules' (D-5576), so every card has them.
const NAME = '.proj-card-name';
const TOGGLE = '.proj-card-toggle';
const SELECTED_NAME = '.proj-card[data-holds-selection] .proj-card-name';

// The rules that apply in ordinary rendering: the file with every @media
// block cut out. The helpers above ignore @media context, and the forced-colors
// block already holds a rule for NAME (D-5495's outline), so moving the floor
// into it would keep `effectiveValue(css, NAME, ...)` green while normal
// rendering lost the fix (the review's mutant M2).
function outsideMedia(text: string): string {
  let out = stripComments(text);
  for (let at = out.indexOf('@media'); at >= 0; at = out.indexOf('@media')) {
    const open = out.indexOf('{', at);
    let depth = 1;
    let i = open + 1;
    for (; i < out.length && depth > 0; i += 1) {
      if (out[i] === '{') depth += 1;
      else if (out[i] === '}') depth -= 1;
    }
    out = out.slice(0, at) + out.slice(i);
  }
  return out;
}
const plain = outsideMedia(css);
const forced = stripComments(atBlock(css, '@media (forced-colors: active)'));

describe("every card's name has a floor (D-5574, D-5576)", () => {
  it('never shrinks below its own width', () => {
    expect(effectiveValue(plain, NAME, 'flex-shrink')).toBe('0');
  });

  it('holds in ordinary rendering, not under forced colours alone', () => {
    // The forced-colors rule for the selected name carries the outline only.
    expect(forced).toMatch(/\.proj-card-name/);
    expect(forced).not.toMatch(/flex-shrink|max-width/);
    // No other @media block takes the floor back at some width or pointer.
    expect(declaredValues(css, NAME, 'flex-shrink')).toEqual(['0']);
    expect(declaredValues(css, NAME, 'max-width')).toEqual(['calc(100% - 1em - var(--sp-2))']);
  });

  it('is capped at the line less its chevron, so a long name ellipsises beside it', () => {
    // Capped at the full line, a name longer than the card wrapped onto a line
    // of its own and left the chevron alone above it (measured at 1280 and
    // 1920, both skins). The chevron draws 6.84px at the toggle's 1em.
    expect(effectiveValue(plain, NAME, 'max-width')).toBe('calc(100% - 1em - var(--sp-2))');
    // The ellipsis it falls back on is the base rule's, and still there: a
    // name longer than the line is the one case still cut (D-5577).
    expect(effectiveValue(plain, NAME, 'text-overflow')).toBe('ellipsis');
    expect(effectiveValue(plain, NAME, 'white-space')).toBe('nowrap');
  });

  it('is not a fixed min-width, which would pad a short name past its last letter', () => {
    for (const sel of [NAME, SELECTED_NAME]) {
      expect(declaredValues(css, sel, 'min-width')).toEqual([]);
      expect(declaredValues(css, sel, 'width')).toEqual([]);
    }
  });

  it('reaches every card, folded or not, selected or not (D-5576)', () => {
    // On the base rule itself, not a grouped or qualified selector.
    const base = stripComments(plain).match(/(^|\})\s*\.proj-card-name\s*\{([^}]*)\}/);
    expect(base?.[2] ?? '').toMatch(/flex-shrink:\s*0/);
    expect(base?.[2] ?? '').toMatch(/max-width:\s*calc\(100% - 1em - var\(--sp-2\)\)/);
    // The selection rule no longer carries a floor of its own: one floor, so
    // the two cards can never drift apart.
    expect(declaredValues(css, SELECTED_NAME, 'flex-shrink')).toEqual([]);
    expect(declaredValues(css, SELECTED_NAME, 'max-width')).toEqual([]);
    // And nothing scoped to a fold, a selection or a skin shrinks it again.
    expect(stripComments(css)).not.toMatch(/proj-card-name[^{]*\{[^}]*flex(-shrink)?:\s*(1|auto)/);
  });
});

describe("every card's toggle wraps rather than overflowing (D-5575, D-5576)", () => {
  it('wraps, with a small gap between its lines', () => {
    expect(effectiveValue(plain, TOGGLE, 'flex-wrap')).toBe('wrap');
    expect(effectiveValue(plain, TOGGLE, 'row-gap')).toBe('2px');
  });

  it('on every card, in ordinary rendering, not under forced colours alone (D-5576)', () => {
    const base = stripComments(plain).match(/(^|\})\s*\.proj-card-toggle\s*\{([^}]*)\}/);
    expect(base?.[2] ?? '').toMatch(/flex-wrap:\s*wrap/);
    expect(base?.[2] ?? '').toMatch(/row-gap:\s*2px/);
    expect(declaredValues(css, TOGGLE, 'flex-wrap')).toEqual(['wrap']);
    expect(stripComments(atBlock(css, '@media (forced-colors: active)'))).not.toMatch(/flex-wrap/);
    // The selection-only rule is gone; the base rule covers that card too.
    expect(stripComments(css)).not.toMatch(/data-holds-selection\]\s*\.proj-card-toggle/);
  });
});
