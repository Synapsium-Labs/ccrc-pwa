// The browser's own controls, painted from the palette (the audit's quick
// wins, items 1 and 2).
//
// WHAT WAS WRONG. Every palette sets `color-scheme`, and nothing else reached
// the two things a browser draws for itself: a native checkbox or radio drew
// in the browser's own blue, and a scrollbar in the browser's own grey for the
// mode. Neither was any palette's colour, in any of the twelve.
//
// THE FIX IS ONE RULE ON `html`, because both properties INHERIT: set once at
// the root, they reach every scroll container and every native control in the
// tree, so no component or app sheet has to repeat them.
//
// jsdom applies no stylesheet (vitest runs with `css: false`), so the rule is
// read as text, through the shared reader — `declaredValues` collects EVERY
// rule that targets `html`, so a second rule restating either property, even
// one written later in the file, is read too and cannot slip past.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { declaredValues, stripComments } from './cssRule';

const BASE_CSS = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'styles', 'base.css'), 'utf8');
const TOKENS_CSS = readFileSync(
  path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'styles', 'tokens.css'), 'utf8');

/** Every palette block in tokens.css: `:root` (Phosphor & Ink) and each
 *  `[data-theme='<id>']`, hand-tuned or generated. Each runs to the first `}`
 *  at the start of a line, which is how the file closes a block. */
function palettes(): [string, string][] {
  const out: [string, string][] = [];
  for (const m of TOKENS_CSS.matchAll(/^(:root|\[data-theme='[a-z-]+'\]) \{\n([\s\S]*?)^\}/gm)) {
    out.push([m[1]!, m[2]!]);
  }
  return out;
}

describe("the browser's own controls take the palette", () => {
  it('html takes accent-color from --accent', () => {
    // A native checkbox, radio, range or progress bar draws in `accent-color`.
    // The phosphor accent is the hue every other control in this app commits
    // with, so the browser's own blue was a third hue in a two-hue UI.
    expect(declaredValues(BASE_CSS, 'html', 'accent-color')).toEqual(['var(--accent)']);
  });

  it('html takes scrollbar-color from palette tokens, with no colour literal but `transparent`', () => {
    // `scrollbar-color: <thumb> <track>`. The thumb is the palette's strong
    // edge — the hairline that already outlines every ghost control — and the
    // track is `transparent`, so the scroll container's own ground shows
    // through and no new ground pair is minted for the contrast gate.
    const values = declaredValues(BASE_CSS, 'html', 'scrollbar-color');
    expect(values, 'exactly one scrollbar-color on html').toHaveLength(1);
    // Split by TERM, not by space: the shared reader's `norm` drops the space
    // next to a paren, so `var(--a) transparent` comes back as
    // `var(--a)transparent` — one string, two terms.
    const parts = values[0]!.match(/var\([^)]*\)|[^\s()]+(?:\([^)]*\))?/g) ?? [];
    expect(parts, 'a thumb and a track').toHaveLength(2);
    // The class of defect, said once: anything that is not a token or the
    // word `transparent` is a colour no palette owns, the shape `#f85149`
    // took in fleet.css (spec §2 item 2).
    const literal = parts.filter((p) => p !== 'transparent' && !/^var\(--[a-z0-9-]+\)$/.test(p));
    expect(literal, 'a colour literal on html — every colour here is a palette token').toEqual([]);
    expect(parts).toEqual(['var(--edge-strong)', 'transparent']);
  });

  it('sets them once, at the root — no other rule re-points either', () => {
    // Both inherit, which is the reason for one rule on `html`, and also its
    // hole: a `body { scrollbar-color: auto }` or a sheet's own thumb colour
    // would take the whole subtree back to the browser's, and nothing above
    // reads a rule that does not target `html`. So the census is every
    // stylesheet the app and the design system ship.
    const roots = [
      path.join(import.meta.dirname, '..', 'src'),
      path.join(import.meta.dirname, '..', '..', 'ui', 'src'),
    ];
    const repo = path.join(import.meta.dirname, '..', '..');
    const sheets = roots.flatMap((root) =>
      readdirSync(root, { recursive: true, encoding: 'utf8' })
        .filter((f) => f.endsWith('.css'))
        .map((f) => path.join(root, f))
        .map((abs) => ({ rel: path.relative(repo, abs), text: readFileSync(abs, 'utf8') })));
    expect(sheets.length, 'the walk stopped seeing the stylesheets').toBeGreaterThan(10);
    const found = sheets.flatMap(({ rel, text }) =>
      [...stripComments(text).matchAll(/(?:^|[;{\s])(accent-color|scrollbar-color)\s*:/g)]
        .map((m) => `${rel.split(path.sep).join('/')}: ${m[1]}`));
    expect(found.sort()).toEqual([
      'pwa/src/styles/base.css: accent-color',
      'pwa/src/styles/base.css: scrollbar-color',
    ]);
  });

  it('names only tokens that every palette declares', () => {
    // Each palette re-points these tokens, which is the whole point of naming
    // them here rather than a hex: a token one palette left undeclared would
    // inherit `:root`'s dark value into a light mode.
    // Read off the rule, never re-listed here, so a token swapped on `html`
    // is the token checked.
    const tokens = ['accent-color', 'scrollbar-color']
      .flatMap((prop) => declaredValues(BASE_CSS, 'html', prop))
      .flatMap((v) => [...v.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!));
    expect(tokens, 'html names no token at all — the two rules above went').toHaveLength(2);
    const all = palettes();
    // Twelve today: `:root`, Daylight and ten generated. Floored rather than
    // pinned, so a thirteenth palette does not red a test about two tokens —
    // and floored at all, so a walk that stopped matching cannot pass empty.
    expect(all.length, 'the palette walk stopped seeing tokens.css').toBeGreaterThanOrEqual(12);
    const missing = all.flatMap(([sel, body]) =>
      tokens
        .filter((token) => !new RegExp(`^\\s*${token}\\s*:`, 'm').test(body))
        .map((token) => `${sel} has no ${token}`));
    expect(missing).toEqual([]);
  });
});
