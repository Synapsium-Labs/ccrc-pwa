// The contract of the shared CSS scrape (test/cssRule.ts), pinned on
// synthetic stylesheets rather than on the real ones — the whole point of the
// helper is that it does not care how the real ones are formatted, and a test
// that read them would care.
//
// Fix round 3, verifier P5: three tap-target tests scrape .css files the
// ui-css lane owns and is editing in parallel, one of them on a
// whitespace-exact literal. Every reformat listed here was a red suite before
// this helper existed; each must be green, and the last two describe the
// failures that must SURVIVE, since a scrape that tolerates everything asserts
// nothing.
//
// Fix round 4, controller item 1: two more hand-rolled copies (and three more
// raw-text scrapes) were still standing after round 3. Closing them needed
// three things this helper did not have — quote-insensitive attribute
// selectors, the selector LIST of a rule, and the body of an at-rule — so
// their contracts are pinned here too.
import { describe, expect, it } from 'vitest';
import { atBlock, declValue, norm, normSel, ruleIn, selectorsOf, stripComments } from './cssRule';

const CANONICAL = `
.reap-go {
  min-height: var(--tap-min);
  background: var(--danger);
}
`;

describe('ruleIn survives the reformats a stylesheet owner may reasonably make', () => {
  it('finds the rule as written', () => {
    expect(declValue(ruleIn(CANONICAL, '.reap-go'), 'min-height')).toBe('var(--tap-min)');
  });

  it('finds it in a GROUPED selector list, in any position', () => {
    const grouped = `
.btn-primary,
.reap-go,
.pr-go {
  min-height: var(--tap-min);
}
`;
    expect(declValue(ruleIn(grouped, '.reap-go'), 'min-height')).toBe('var(--tap-min)');
  });

  it('finds it with a comment between the selector and the brace', () => {
    const commented = `
.reap-go /* the destructive confirm */
{
  min-height: var(--tap-min);
}
`;
    expect(declValue(ruleIn(commented, '.reap-go'), 'min-height')).toBe('var(--tap-min)');
  });

  it('finds it indented inside an @media block, and reads the nested rule', () => {
    const nested = `
@media (min-width: 900px) {
  .reap-go {
    min-height: var(--tap-min);
  }
}
`;
    expect(declValue(ruleIn(nested, '.reap-go'), 'min-height')).toBe('var(--tap-min)');
  });

  it('is not fooled by a brace inside a comment', () => {
    const tricky = `
/* .reap-go { min-height: 20px; } — the old rule, kept as a note */
.reap-go {
  min-height: var(--tap-min);
}
`;
    expect(declValue(ruleIn(tricky, '.reap-go'), 'min-height')).toBe('var(--tap-min)');
  });

  it('returns the rule WITH its comments — fleet-css.test.ts asserts on one', () => {
    const withNote = `
.shell-nav {
  /* backstop behind min-width: 0 */
  overflow-x: clip;
}
`;
    expect(ruleIn(withNote, '.shell-nav')).toMatch(/backstop/i);
    expect(stripComments(ruleIn(withNote, '.shell-nav'))).not.toMatch(/backstop/i);
  });

  it('reads a declaration however its whitespace is set, including inside var()', () => {
    const spaced = '\n.reap-go{min-height:var( --tap-min )}\n';
    expect(declValue(ruleIn(spaced, '.reap-go'), 'min-height')).toBe('var(--tap-min)');
    expect(norm('  a ,  b ( c )  ')).toBe('a,b(c)');
  });

  it('takes the LAST value of a repeated property, as the cascade does', () => {
    expect(declValue('min-height: 20px; min-height: var(--tap-min);', 'min-height'))
      .toBe('var(--tap-min)');
  });

  it('finds an attribute selector however its value is quoted', () => {
    // prettier rewrites `'` to `"` in CSS attribute selectors, which broke the
    // hand-rolled copy in attach-tray.test.tsx by regex alternation only.
    const dbl = `\n.chip[data-state="failed"] .x::after { inset: -5px; }\n`;
    for (const asked of [`.chip[data-state='failed'] .x::after`,
                         `.chip[data-state="failed"] .x::after`,
                         `.chip[data-state=failed] .x::after`]) {
      expect(declValue(ruleIn(dbl, asked), 'inset')).toBe('-5px');
    }
    expect(normSel(`.chip[data-state='failed']`)).toBe('.chip[data-state=failed]');
  });
});

describe('selectorsOf reads the GROUP, so a stranded member is a failure', () => {
  const grouped = `
.row .a,
.row .b ,
  .row .c::before {
  color: var(--edge-strong);
}
`;
  it('returns every member of the list, normalised, whatever the whitespace', () => {
    expect(selectorsOf(grouped, '.row .c::before'))
      .toEqual(['.row .a', '.row .b', '.row .c::before']);
  });

  it('does not report a member that lives in a DIFFERENT rule', () => {
    const split = '\n.row .a { color: red; }\n.row .b { color: red; }\n';
    expect(selectorsOf(split, '.row .a')).toEqual(['.row .a']);
  });

  it('throws when the rule is gone, exactly as ruleIn does', () => {
    expect(() => selectorsOf(grouped, '.row .d')).toThrow(/no rule for/);
  });
});

describe('atBlock scopes a rule to the at-rule it must live inside', () => {
  const sheet = `
.sess-line--active { outline-color: var(--bg-page); }
@media (forced-colors: active) {
  .sess-line--active { outline: 2px solid CanvasText; }
}
`;
  it('reads the rule inside the block, not the same-named one above it', () => {
    const forced = atBlock(sheet, '@media (forced-colors: active)');
    expect(declValue(ruleIn(forced, '.sess-line--active'), 'outline'))
      .toBe('2px solid CanvasText');
  });

  it('matches the prelude however its whitespace is set', () => {
    const tight = sheet.replace('(forced-colors: active)', '(forced-colors:active)');
    expect(atBlock(tight, '@media (forced-colors: active)')).toMatch(/CanvasText/);
  });

  it('does not reach a rule that sits AFTER the block', () => {
    const after = `${sheet}\n.sess-line--dead { outline: 2px solid CanvasText; }\n`;
    expect(() => ruleIn(atBlock(after, '@media (forced-colors: active)'), '.sess-line--dead'))
      .toThrow(/no rule for/);
  });

  it('throws when the at-rule is gone — a deleted forced-colours block is a failure', () => {
    expect(() => atBlock(sheet, '@media (prefers-contrast: more)'))
      .toThrow(/no at-rule for/);
  });
});

describe('and still fails on the things it exists to catch', () => {
  it('throws when the rule is gone — a renamed class is a failure, not a pass', () => {
    expect(() => ruleIn(CANONICAL, '.reap-going')).toThrow(/no rule for \.reap-going/);
  });

  it('does not match a rule that merely contains the selector as a prefix or a descendant', () => {
    const near = `
.reap-go:hover { min-height: 10px; }
.sheet .reap-go { min-height: 10px; }
.reap-go-wide { min-height: 10px; }
`;
    expect(() => ruleIn(near, '.reap-go')).toThrow(/no rule for/);
  });

  it('reports a dropped declaration as null, not as an empty pass', () => {
    expect(declValue(ruleIn('\n.reap-go { background: red; }\n', '.reap-go'), 'min-height'))
      .toBeNull();
  });

  it('reports a hardcoded literal as itself, so an untokened floor fails', () => {
    expect(declValue(ruleIn('\n.reap-go { min-height: 44px; }\n', '.reap-go'), 'min-height'))
      .toBe('44px');
  });

  it('does not let a comment satisfy a declaration assertion', () => {
    const fake = '\n.reap-go { /* min-height: var(--tap-min); */ background: red; }\n';
    expect(declValue(ruleIn(fake, '.reap-go'), 'min-height')).toBeNull();
  });
});
