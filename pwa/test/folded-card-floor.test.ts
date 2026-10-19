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
// Only the card holding the selection changes. An unselected card's name still
// shrinks as before; that is a wider question than this follow-up.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { atBlock, declaredValues, effectiveValue, stripComments } from './cssRule';

const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
const NAME = '.proj-card[data-holds-selection] .proj-card-name';
const TOGGLE = '.proj-card[data-holds-selection] .proj-card-toggle';

describe("the folded card's name has a floor (D-5574)", () => {
  it('never shrinks below its own width', () => {
    expect(effectiveValue(css, NAME, 'flex-shrink')).toBe('0');
  });

  it('is capped at the line less its chevron, so a long name ellipsises beside it', () => {
    // Capped at the full line, a name longer than the card wrapped onto a line
    // of its own and left the chevron alone above it (measured at 1280 and
    // 1920, both skins). The chevron draws 6.84px at the toggle's 1em.
    expect(effectiveValue(css, NAME, 'max-width')).toBe('calc(100% - 1em - var(--sp-2))');
    // The ellipsis it falls back on is the base rule's, and still there.
    expect(effectiveValue(css, '.proj-card-name', 'text-overflow')).toBe('ellipsis');
    expect(effectiveValue(css, '.proj-card-name', 'white-space')).toBe('nowrap');
  });

  it('is not a fixed min-width, which would pad a short name past its last letter', () => {
    expect(declaredValues(css, NAME, 'min-width')).toEqual([]);
    expect(declaredValues(css, NAME, 'width')).toEqual([]);
  });

  it('does not reach an unselected card, whose name still shrinks', () => {
    expect(declaredValues(css, '.proj-card-name', 'flex-shrink')
      .filter((v) => v !== '0')).toEqual([]);
    // The base rule itself carries no flex-shrink; only the folded selector does.
    const base = stripComments(css).match(/(^|\})\s*\.proj-card-name\s*\{([^}]*)\}/);
    expect(base?.[2] ?? '').not.toMatch(/flex-shrink/);
  });
});

describe("the folded card's toggle wraps rather than overflowing (D-5575)", () => {
  it('wraps, with a small gap between its lines', () => {
    expect(effectiveValue(css, TOGGLE, 'flex-wrap')).toBe('wrap');
    expect(effectiveValue(css, TOGGLE, 'row-gap')).toBe('2px');
  });

  it('only on the card holding the selection, and not under forced colours alone', () => {
    expect(effectiveValue(css, '.proj-card-toggle', 'flex-wrap')).toBe('wrap');
    const base = stripComments(css).match(/(^|\})\s*\.proj-card-toggle\s*\{([^}]*)\}/);
    expect(base?.[2] ?? '').not.toMatch(/flex-wrap/);
    expect(stripComments(atBlock(css, '@media (forced-colors: active)'))).not.toMatch(/flex-wrap/);
  });
});
