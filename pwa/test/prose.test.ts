// Prose, and the defect the design system could not see until it owned it.
//
// WHAT THE FIRST LOOK FOUND. `@ccrc/ui`'s Storybook rendered the prose stories
// for the first time in this project's life, and markdown bullet lists have no
// bullets. Measured in the browser rather than reasoned about:
// `.msg-assist li` computes `display: list-item`, its `::marker` carries the
// `--ink-tertiary` the stylesheet asks for, and `list-style-type` is `none` —
// inherited from the vendored preflight's `ol, ul { list-style: none }`, which
// nothing in the prose rules ever puts back.
//
// So `.msg-assist li::marker { color: var(--ink-tertiary) }` colours a marker
// that never renders. The rule is strong evidence the markers were INTENDED:
// nobody tunes the hue of something they meant to delete.
//
// THIS IS NOT A REGRESSION OF THE MOVE, and the test below says so in both
// directions. The rules travelled from chat.css verbatim; neither the old copy
// nor the new one sets `list-style`, and the preflight sat above both (the old
// chat.css was unlayered and beat `layer(base)`; prose.css is
// `layer(components)` and also beats it) — so the computed value is `none`
// either way, and was before this wave started.
//
// IT WAS PRESERVED FOR ONE WAVE AND IS NOW FIXED. Restoring the markers is a
// visual change, and the wave that found it had none — every migration in it
// was measured to move no pixel — so the decision was left to the operator
// instead of slipping in under a refactor. The operator took it.
//
// WHAT WENT BACK: `list-style: disc outside` on `ul`, `decimal outside` on
// `ol`, and the `circle`/`square` depth variants a UA stylesheet would have
// supplied, so a nested list is distinguishable by its marker as well as by
// its indent. In SEPARATE rules, because the `ul, ol` rule above carries
// `color` and the contrast gate keys a rule by `<basename> <selector>`:
// splitting that one in two would rekey every entry it owns for a change
// that moves no colour. The gate stayed at 3456.
//
// ONE THEORY WAS WRONG AND THIS FILE IS WHY. The `ul, ol` rule is
// `display: grid`, and a grid item is blockified — so the obvious second
// cause was that the `li` had lost its marker BOX and `list-style` alone
// would not bring it back. The browser measurement recorded above says
// otherwise: `.msg-assist li` computes `display: list-item`, because
// blockification maps `list-item` to itself. Measured beats reasoned, which
// is the whole reason that measurement is in this header.
// MEASURED, four mutations (baseline 6 passed):
//
//   | `list-style: disc outside` removed again            | 1 red |
//   | the task list loses its `list-style: none`          | 1 red |
//   | the `::marker` hue deleted                          | 1 red |
//   | `list-style` added to the gate-keyed `ul, ol` rule  | 1 red |
//
// The fourth is the one that keeps the restoration where it belongs: putting
// those declarations on the rule that carries `color` would rekey its
// contrast-gate entries, so the guard refuses it even though the rendering
// would be identical.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (...seg: string[]): string =>
  readFileSync(path.join(import.meta.dirname, '..', '..', ...seg), 'utf8');

const prose = read('ui', 'src', 'components', 'prose.css');
const reset = read('ui', 'src', 'styles', 'reset.css');

describe('the reading measure is the rule that makes prose prose', () => {
  it('caps the text and exempts the data', () => {
    // `--measure-prose` is 72ch. It applies to DIRECT CHILDREN only, so it
    // shrinks a stretched grid item to the start edge rather than centring it,
    // and it names the prose elements one by one — `pre`, `table` and `img`
    // are absent ON PURPOSE, because a terminal transcript wrapped at
    // seventy-two characters is a transcript nobody can read.
    const stripped = prose.replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = /\.msg-assist > :is\(([^)]*)\) \{\s*max-width: var\(--measure-prose\);\s*\}/
      .exec(stripped);
    expect(rule, 'the measure is gone, and prose now runs the full pane').not.toBeNull();
    const capped = (rule?.[1] ?? '').split(',').map((t) => t.trim());
    for (const el of ['p', 'ul', 'ol', 'blockquote', 'h1', 'h2', 'h3', 'h4']) {
      expect(capped, el).toContain(el);
    }
    for (const el of ['pre', 'table', 'img']) expect(capped, el).not.toContain(el);
  });
});

describe('markdown lists render their markers', () => {
  it('the preflight still takes them away — that is the thing being answered', () => {
    const stripped = reset.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).toMatch(/\bol,[\s\S]{0,40}\bul\b[\s\S]{0,80}list-style:\s*none/);
  });

  it('and the prose rules put them back, outside, with the depth variants', () => {
    const stripped = prose.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).toMatch(
      /\.msg-assist ul \{ list-style-type: disc; list-style-position: outside; \}/);
    expect(stripped).toMatch(
      /\.msg-assist ol \{ list-style-type: decimal; list-style-position: outside; \}/);
    // LONGHANDS, not the shorthand: written `list-style: disc outside` the
    // minifier emitted `list-style: outside`, dropping `disc` as the initial
    // value — correct, because the shorthand resets it to that same initial,
    // but the declaration doing the work then cannot be found in the bundle.
    expect(stripped).not.toMatch(/list-style: disc/);
    expect(stripped).toMatch(/\.msg-assist ul ul \{ list-style-type: circle; \}/);
    expect(stripped).toMatch(/\.msg-assist ul ul ul \{ list-style-type: square; \}/);
  });

  it('leaves the GFM task list markerless, and still wins on specificity', () => {
    // remark-gfm emits a checkbox; a disc beside it would be two markers. The
    // task-list rule is two classes (0,2,0) against `.msg-assist ul`'s one
    // class and one element (0,1,1), so it wins wherever it applies — the
    // restoration above cannot reach it. Both halves pinned: the rule, and
    // the fact that it is the ONLY `list-style: none` left in the file.
    const stripped = prose.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).toMatch(/\.contains-task-list \{[^}]*list-style: none/);
    expect([...stripped.matchAll(/list-style:\s*none/g)]).toHaveLength(1);
  });

  it('keeps the marker hue the stylesheet always asked for', () => {
    // THE EVIDENCE THE MARKERS WERE INTENDED, and now the rule that actually
    // paints something. If it is ever deleted, the restoration above becomes
    // a disc in the body ink, which is not what this palette asked for.
    expect(prose).toMatch(/\.msg-assist li::marker \{ color: var\(--ink-tertiary\); \}/);
  });

  it('did not disturb the rule the gate keys on', () => {
    // The `ul, ol` rule is UNCHANGED, declaration for declaration — the
    // restoration went into rules of its own precisely so this one keeps its
    // selector, its `color`, and therefore its contrast-gate entries.
    expect(prose).toMatch(
      /\.msg-assist ul, \.msg-assist ol \{\s*padding-left: var\(--sp-5\);\s*display: grid;\s*gap: var\(--sp-2\);\s*color: var\(--ink-primary\);\s*\}/,
    );
  });
});
