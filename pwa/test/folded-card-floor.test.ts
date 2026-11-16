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
//
// This file pins the rules; the geometry they produce (a whole name on its
// chevron's line, the meta wrapped inside the toggle, a long name cut only at
// its cap) is measured in a real Chrome by `browser/row-fit.browser.test.ts`.
// The leg cannot see one mutant this file kills: with the toggle wrapping, a
// shrinkable name is laid out on a line of its own and never shrinks, so
// `flex-shrink: 0` is held here alone.
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
    // And nothing scoped to a fold, a selection or a skin shrinks it again:
    // see the shorthand guard below.
  });
});

// THE SHORTHANDS (D-5576, the review's round). A later `flex: initial` on the
// name (0 1 auto: it may shrink again), a `flex-basis: 0` from a
// `.proj-card-head .proj-card-name` rule, a `.proj-card-toggle > *
// { flex-shrink: 1 }`, or a `flex-flow: row nowrap` on the toggle each undid
// the floor or the wrap while a literal regex stayed green. So every rule in
// the file (every @media block included, stricter than the browser) that can
// reach the name, or the toggle's items, or the toggle itself, is read through
// its shorthands before the assertion.
type Rule = { prelude: string; body: string };
function everyRule(text: string): Rule[] {
  const out: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const scan = stripComments(text);
  for (let m = re.exec(scan); m !== null; m = re.exec(scan)) {
    out.push({ prelude: (m[1] ?? '').trim(), body: m[2] ?? '' });
  }
  return out;
}
function decls(body: string): { prop: string; value: string }[] {
  return body.split(';').flatMap((d) => {
    const at = d.indexOf(':');
    if (at < 0) return [];
    return [{ prop: d.slice(0, at).trim().toLowerCase(), value: d.slice(at + 1).trim().replace(/\s+/g, ' ').replace(/\s*!important$/, '') }];
  });
}
const NUMBER = /^[+]?(\d+\.?\d*|\.\d+)$/;
/** `flex: <value>` as the [shrink, basis] it sets; anything it cannot place
 *  (a global keyword, a var()) answers 'unknown', which the guard fails. */
function flexShorthand(value: string): { shrink: string; basis: string } {
  const v = value.toLowerCase();
  if (v === 'none') return { shrink: '0', basis: 'auto' };
  if (v === 'auto') return { shrink: '1', basis: 'auto' };
  if (v === 'initial') return { shrink: '1', basis: 'auto' };
  const parts = v.split(' ');
  if (parts.some((x) => x.includes('var(') || ['inherit', 'unset', 'revert', 'revert-layer'].includes(x))) {
    return { shrink: 'unknown', basis: 'unknown' };
  }
  const nums = parts.filter((x) => NUMBER.test(x));
  const basis = parts.find((x) => !NUMBER.test(x)) ?? '0';
  // One or two numbers: grow, then shrink (1 when left out); the basis is 0
  // when only numbers are given, else the non-number.
  return { shrink: nums[1] ?? '1', basis };
}
const ZERO_BASIS = /^0(px|%|em|rem|ch)?$/;
/** Can this selector member style the name? Its subject names it, or is a
 *  universal child or descendant of the toggle. */
function reachesName(member: string): boolean {
  const m = member.trim();
  const subject = m.split(/[\s>+~]+/).filter(Boolean).pop() ?? '';
  if (subject.includes('.proj-card-name')) return true;
  return /\.proj-card-toggle\b[^,]*[\s>]\s*\*$/.test(m) || subject === '*' && m.includes('.proj-card-toggle');
}
function togglesItself(member: string): boolean {
  const subject = member.trim().split(/[\s>+~]+/).filter(Boolean).pop() ?? '';
  return /\.proj-card-toggle(?![\w-])/.test(subject);
}
function nameShrinkProblems(text: string): string[] {
  const bad: string[] = [];
  for (const { prelude, body } of everyRule(text)) {
    if (!prelude.split(',').some(reachesName)) continue;
    for (const { prop, value } of decls(body)) {
      if (prop === 'flex') {
        const f = flexShorthand(value);
        if (f.shrink !== '0') bad.push(`${prelude} { flex: ${value} } shrinks`);
        if (ZERO_BASIS.test(f.basis) || f.basis === 'unknown') bad.push(`${prelude} { flex: ${value} } zero basis`);
      } else if (prop === 'flex-shrink' && value !== '0') {
        bad.push(`${prelude} { flex-shrink: ${value} }`);
      } else if (prop === 'flex-basis' && (ZERO_BASIS.test(value) || value.includes('var('))) {
        bad.push(`${prelude} { flex-basis: ${value} }`);
      }
    }
  }
  return bad;
}
function toggleWrapProblems(text: string): string[] {
  const bad: string[] = [];
  for (const { prelude, body } of everyRule(text)) {
    if (!prelude.split(',').some(togglesItself)) continue;
    for (const { prop, value } of decls(body)) {
      if (prop === 'flex-wrap' && value !== 'wrap') bad.push(`${prelude} { flex-wrap: ${value} }`);
      if (prop === 'flex-flow') {
        // flex-flow resets flex-wrap to nowrap when it names no wrap value.
        const wrap = value.split(' ').find((x) => /^(no)?wrap(-reverse)?$/.test(x)) ?? 'nowrap';
        if (wrap !== 'wrap') bad.push(`${prelude} { flex-flow: ${value} }`);
      }
    }
  }
  return bad;
}

describe('no shorthand takes the floor or the wrap back (D-5576)', () => {
  it('reads the flex shorthand the way a browser does', () => {
    expect(flexShorthand('none')).toEqual({ shrink: '0', basis: 'auto' });
    expect(flexShorthand('initial').shrink).toBe('1');
    expect(flexShorthand('auto').shrink).toBe('1');
    expect(flexShorthand('1')).toEqual({ shrink: '1', basis: '0' });
    expect(flexShorthand('0 1 auto').shrink).toBe('1');
    expect(flexShorthand('0 0 auto')).toEqual({ shrink: '0', basis: 'auto' });
    expect(flexShorthand('1 0 0').basis).toBe('0');
  });

  it('nothing that reaches the name lets it shrink or zeroes its basis', () => {
    expect(nameShrinkProblems(css)).toEqual([]);
    // The guard itself catches each shape the review planted.
    for (const planted of [
      '.proj-card-name { flex: initial; }',
      '.proj-card-name { flex: 0 1 auto; }',
      '.proj-card-name { flex: 1; }',
      '.proj-card-name { flex: auto; }',
      '.proj-card-toggle > * { flex-shrink: 1; }',
      '.proj-card-head .proj-card-name { flex-basis: 0; }',
      '[data-skin="instrument"] .proj-card-name { flex-shrink: 1; }',
    ]) {
      expect(nameShrinkProblems(`${css}\n${planted}`), planted).not.toEqual([]);
    }
  });

  it("nothing turns the toggle's wrap off", () => {
    expect(toggleWrapProblems(css)).toEqual([]);
    for (const planted of [
      '.proj-card-toggle { flex-flow: row nowrap; }',
      '.proj-card-toggle { flex-flow: column; }',
      '.proj-card-toggle { flex-wrap: nowrap; }',
      '@media (min-width: 900px) { .proj-card-toggle { flex-wrap: nowrap; } }',
    ]) {
      expect(toggleWrapProblems(`${css}\n${planted}`), planted).not.toEqual([]);
    }
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
