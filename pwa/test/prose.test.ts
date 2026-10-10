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
// IT IS PRESERVED RATHER THAN FIXED because restoring the markers is a VISUAL
// CHANGE, and this wave has none: every migration in it was measured to move
// no pixel. Putting a disc back on every bullet in every assistant turn is a
// design decision, and this is where it gets made deliberately instead of
// slipping in under a refactor.
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

describe('markdown lists render without markers — preserved, not fixed', () => {
  it('the preflight takes the markers away', () => {
    const stripped = reset.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).toMatch(/\bol,[\s\S]{0,40}\bul\b[\s\S]{0,80}list-style:\s*none/);
  });

  it('and the prose rules never put them back', () => {
    const stripped = prose.replace(/\/\*[\s\S]*?\*\//g, '');
    // The ONE `list-style` in this file is the task list's, which wants none:
    // remark-gfm emits a checkbox and a disc beside it would be two markers.
    const uses = [...stripped.matchAll(/list-style[^;]*;/g)].map((m) => m[0].trim());
    expect(uses).toEqual(['list-style: none;']);
    expect(stripped).toMatch(/\.contains-task-list \{[^}]*list-style: none/);
  });

  it('while the stylesheet still tunes the colour of a marker nobody sees', () => {
    // THE OTHER DIRECTION. If someone restores the markers, this assertion is
    // what tells them the preserved defect is gone and this file should go
    // with it — and if someone deletes this rule instead, the evidence that
    // markers were intended goes with it, which is worse.
    expect(prose).toMatch(/\.msg-assist li::marker \{ color: var\(--ink-tertiary\); \}/);
  });

  it('the move did not cause it — chat.css did not set list-style either', () => {
    // Pinned against the shape of the old rule rather than against git: the
    // list rule travelled verbatim, so the four declarations it DID carry are
    // still exactly these, and `list-style` is still not among them.
    expect(prose).toMatch(
      /\.msg-assist ul, \.msg-assist ol \{\s*padding-left: var\(--sp-5\);\s*display: grid;\s*gap: var\(--sp-2\);\s*color: var\(--ink-primary\);\s*\}/,
    );
  });
});
