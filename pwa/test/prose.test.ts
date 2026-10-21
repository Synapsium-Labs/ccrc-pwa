// Prose, and the defect the design system could not see until it owned it.
//
// WHAT THE FIRST LOOK FOUND. `@ccrc/ui`'s Storybook rendered the prose stories
// for the first time in this project's life, and markdown bullet lists had no
// bullets: the vendored preflight's `ol, ul { list-style: none }` reached every
// prose list and nothing in the prose rules put the markers back, so
// `.msg-assist li::marker { color: var(--ink-tertiary) }` coloured a marker
// that never rendered. This file carried that as "preserved, not fixed" while
// restoring the markers waited for its own ruling (the operator ruling of
// 2026-10-15 held the fix back for that decision). It has had it — operator
// ruling 2026-10-20: restore the markers. They are back, and
// `prose-lists.test.ts` pins them — disc and decimal, the nesting steps, the
// task list that stays markerless, and the layer order that lets a prose rule
// undo the reset at all.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (...seg: string[]): string =>
  readFileSync(path.join(import.meta.dirname, '..', '..', ...seg), 'utf8');

const prose = read('ui', 'src', 'components', 'prose.css');

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
