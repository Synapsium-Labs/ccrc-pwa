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
import {
  atBlock, declValue, declaredValues, effectiveValue, longhandValues, norm, normSel, ruleIn,
  rulesFor, selectorsOf, stripComments,
} from './cssRule';

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

// ── the cascade-aware reader (D-161 fix round) ──────────────────────────────
//
// `ruleIn` reads ONE rule, and every one of these stylesheets is a cascade.
// Three mutants put `overflow: hidden` back on the detail pane — the exact
// D-161 regression — with the whole suite green, and a fourth spelling
// (`overflow: clip auto`, which is what the build's minifier emits) turned
// three of four assertions red while changing nothing. Both classes are pinned
// here, on synthetic sheets, for the reason at the top of this file.

describe('rulesFor collects every rule that styles the element', () => {
  const later = `
.pane { overflow-y: auto; overflow-x: hidden; }
.other { color: red; }
.pane { overflow: hidden; }
`;
  it('sees a LATER rule of the same name — the bypass ruleIn cannot see', () => {
    expect(ruleIn(later, '.pane')).toContain('overflow-y: auto');   // the old reader
    expect(declaredValues(later, '.pane', 'overflow-y')).toEqual(['auto', 'hidden']);
  });

  it('sees a HIGHER-SPECIFICITY restatement that names more ancestors', () => {
    const stronger = '\n.pane { overflow-y: auto; }\n.shell .pane { overflow-y: hidden; }\n';
    expect(declaredValues(stronger, '.pane', 'overflow-y')).toEqual(['auto', 'hidden']);
  });

  it('sees a narrower subject — a state variant is still this element', () => {
    const variant = `\n.pane { overflow-y: auto; }\n.pane[data-view='x']:hover { overflow-y: hidden; }\n`;
    expect(declaredValues(variant, '.pane', 'overflow-y')).toEqual(['auto', 'hidden']);
  });

  it('sees a GROUPED rule from any position in the list', () => {
    const grouped = '\n.nav,\n.pane { overflow: hidden; }\n';
    expect(declaredValues(grouped, '.pane', 'overflow-y')).toEqual(['hidden']);
  });

  it('does NOT see a different class whose name merely begins the same', () => {
    expect(() => rulesFor('\n.pane-wide { overflow: hidden; }\n', '.pane'))
      .toThrow(/no rule targeting \.pane/);
  });

  it('does NOT see a rule whose subject is a DESCENDANT of this element', () => {
    // `.pane .chat`'s declarations are the chat's, not the pane's — the
    // distinction the detail pane's own guard rests on (.shell-detail vs
    // .shell-detail .chat, which want OPPOSITE overflow).
    expect(() => rulesFor('\n.pane .chat { overflow: hidden; }\n', '.pane'))
      .toThrow(/no rule targeting/);
  });

  it('does NOT see a ::pseudo-element — that box is not the element', () => {
    expect(() => rulesFor('\n.pane::before { overflow: hidden; }\n', '.pane'))
      .toThrow(/no rule targeting/);
  });

  it('reads a DESCENDANT selector as its own subject, ancestors allowed to grow', () => {
    const sheet = `
.pane .chat { overflow: hidden; }
.shell .pane > .chat:focus { overflow: clip; }
.pane .chat-back { overflow: auto; }
.chat .pane-x { overflow: auto; }
`;
    expect(declaredValues(sheet, '.pane .chat', 'overflow-x')).toEqual(['hidden', 'clip']);
  });

  it('throws when nothing targets the selector, exactly as ruleIn does', () => {
    expect(() => declaredValues('\n.pane { color: red; }\n', '.gone', 'overflow-y'))
      .toThrow(/no rule targeting \.gone/);
  });

  it('reports a property nobody sets as an empty list, not as a throw', () => {
    // The two answers must stay apart: a renamed rule is a broken test, a
    // missing declaration is a finding about the stylesheet.
    expect(declaredValues('\n.pane { color: red; }\n', '.pane', 'overflow-y')).toEqual([]);
  });
});

describe('the overflow shorthand and its longhands are the same declaration', () => {
  it('splits the two-value form across the axes, x first', () => {
    // Exactly what lightningcss emits into the shipped bundle:
    // `.shell-detail{…overflow:clip auto}`.
    expect(longhandValues('overflow: clip auto;', 'overflow-x')).toEqual(['clip']);
    expect(longhandValues('overflow: clip auto;', 'overflow-y')).toEqual(['auto']);
  });

  it('feeds BOTH axes from the one-value form', () => {
    expect(longhandValues('overflow: hidden;', 'overflow-x')).toEqual(['hidden']);
    expect(longhandValues('overflow: hidden;', 'overflow-y')).toEqual(['hidden']);
  });

  it('keeps shorthand and longhand in SOURCE ORDER — the later one wins', () => {
    const rule = 'overflow: hidden; overflow-y: auto;';
    expect(longhandValues(rule, 'overflow-y')).toEqual(['hidden', 'auto']);
    expect(effectiveValue('\n.pane { overflow: hidden; overflow-y: auto; }\n', '.pane', 'overflow-y'))
      .toBe('auto');
  });

  it('leaves a property with no shorthand entry alone', () => {
    expect(longhandValues('min-height: var(--tap-min);', 'min-height')).toEqual(['var(--tap-min)']);
    expect(longhandValues('overflow: hidden;', 'min-height')).toEqual([]);
  });

  it('does not let a comment mentioning a value satisfy anything', () => {
    const commented = '\n.pane { /* overflow-y: auto; */ overflow: hidden; }\n';
    expect(declaredValues(commented, '.pane', 'overflow-y')).toEqual(['hidden']);
  });
});

describe('effectiveValue answers "which one shows"', () => {
  it('takes the last in source order across rules', () => {
    const sheet = '\n.pane { min-height: 0; }\n.shell .pane { min-height: 44px; }\n';
    expect(effectiveValue(sheet, '.pane', 'min-height')).toBe('44px');
  });

  it('is null when nothing sets it', () => {
    expect(effectiveValue('\n.pane { color: red; }\n', '.pane', 'min-height')).toBeNull();
  });
});
