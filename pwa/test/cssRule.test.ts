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
import { describe, expect, it } from 'vitest';
import { declValue, norm, ruleIn, stripComments } from './cssRule';

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
