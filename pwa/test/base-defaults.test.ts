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
// THE THUMB IS FITTED, NOT A HAIRLINE (D-5159). The plan named `--edge-strong`,
// and a hairline carries no contrast claim (tokens.css: "Decorative — no
// contrast claim"): measured as the thumb it read 1.03 in One Dark and 1.06 in
// Solarized Light, invisible where the browser's own grey had been plainly
// visible. The track is `transparent`, so the thumb's real ground is whatever
// the scroll container paints — and that includes a WELL, dark in every
// palette, which no ink-derived thumb clears in the light palettes. So the
// thumb is its own token, `--scrollbar-thumb`, held at 3:1 on every one of
// those grounds below, and by the contrast gate's token pairs.
//
// jsdom applies no stylesheet (vitest runs with `css: false`), so the rules
// are read as text, through the shared reader — `declaredValues` collects
// EVERY rule that targets `html`, so a second rule restating either property,
// even one written later in the file, is read too and cannot slip past.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { declaredValues, norm, stripComments } from './cssRule';
import { loadThemes, ratio } from '../design/audit.mjs';

const REPO = path.join(import.meta.dirname, '..', '..');
const BASE_CSS = readFileSync(path.join(REPO, 'pwa', 'src', 'styles', 'base.css'), 'utf8');
const TOKENS_CSS = readFileSync(path.join(REPO, 'ui', 'src', 'styles', 'tokens.css'), 'utf8');
const PREVIEW_CSS = readFileSync(path.join(REPO, 'ui', '.storybook', 'preview.css'), 'utf8');

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

/** Every declaration of one of `props` in a stylesheet, with the chain of
 *  preludes it sits under, outermost first — `['@media (x)', 'html']` for a
 *  rule inside a media block. The census below needs the CHAIN, and that is
 *  the hole it closes: `declaredValues` reads any rule whose subject merely
 *  CONTAINS `html`, so `html.never { … }` and `html[data-theme='x'] { … }` —
 *  rules no page ever matches whole — read as the root rule (measured: the
 *  first guard stayed green with the rule re-pointed to `html.never`). Strings
 *  are skipped, so `@source '…/*.{ts,tsx}'` does not open a block. */
function declarations(text: string, props: readonly string[]): { chain: string[]; prop: string }[] {
  const src = stripComments(text);
  const out: { chain: string[]; prop: string }[] = [];
  const stack: string[] = [];
  let from = 0;
  const take = (segment: string): void => {
    const m = /^\s*([a-z-]+)\s*:/.exec(segment);
    if (m !== null && props.includes(m[1]!)) out.push({ chain: [...stack], prop: m[1]! });
  };
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "'" || ch === '"') {
      const close = src.indexOf(ch, i + 1);
      i = close < 0 ? src.length : close;
    } else if (ch === '{') {
      stack.push(norm(src.slice(from, i)));
      from = i + 1;
    } else if (ch === '}') {
      take(src.slice(from, i));
      stack.pop();
      from = i + 1;
    } else if (ch === ';') {
      take(src.slice(from, i));
      from = i + 1;
    }
  }
  return out;
}

/** A custom property's value in tokens.css's `:root` block — the one block
 *  every palette inherits what it does not re-declare. */
function rootValue(token: string): string | null {
  const [, root] = palettes().find(([sel]) => sel === ':root') ?? [];
  const m = new RegExp(`^\\s*${token}\\s*:\\s*([^;]+);`, 'm').exec(stripComments(root ?? ''));
  return m === null ? null : norm(m[1]!);
}

/** The tokens a token finally resolves through: itself when `:root` gives it
 *  a value of its own, else every token its `:root` value names, followed. */
function leaves(token: string, seen = new Set<string>()): string[] {
  if (seen.has(token)) throw new Error(`var() cycle at ${token}`);
  seen.add(token);
  const named = [...(rootValue(token) ?? '').matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!);
  return named.length === 0 ? [token] : named.flatMap((t) => leaves(t, seen));
}

/** The grounds a scroll container paints, so the grounds the thumb sits on:
 *  the track is `transparent`. The page and the detail pane, the sidebar and
 *  every card (surface), a raised field, a sheet, and a well (`Well`, code
 *  blocks, tool output) — the last dark in every palette, light ones too. */
const THUMB_GROUNDS = ['--bg-page', '--bg-surface', '--bg-raised', '--bg-sheet', '--bg-well'];

describe("the browser's own controls take the palette", () => {
  it('html takes accent-color from --accent', () => {
    // A native checkbox, radio, range or progress bar draws in `accent-color`.
    // The phosphor accent is the hue every other control in this app commits
    // with, so the browser's own blue was a third hue in a two-hue UI.
    expect(declaredValues(BASE_CSS, 'html', 'accent-color')).toEqual(['var(--accent)']);
  });

  it('html takes scrollbar-color from palette tokens, with no colour literal but `transparent`', () => {
    // `scrollbar-color: <thumb> <track>`. The thumb is the fitted thumb token
    // (D-5159), and the track is `transparent`, so the scroll container's own
    // ground shows through and no new ground is minted for the contrast gate.
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
    expect(parts).toEqual(['var(--scrollbar-thumb)', 'transparent']);
  });

  it('sets them once, at the root — no other rule re-points either, and no qualified `html` stands in', () => {
    // Both inherit, which is the reason for one rule on `html`, and also its
    // hole: a `body { scrollbar-color: auto }` or a sheet's own thumb colour
    // would take the whole subtree back to the browser's, and nothing above
    // reads a rule that does not target `html`. So the census is every
    // stylesheet the app, the design system and its Storybook ship — and each
    // finding names its whole chain, so the rule must be the bare `html`, at
    // the top level: not `html.x`, not `html[data-theme=…]`, not inside an
    // `@media` or `@supports` that some page does not match.
    const roots = [
      path.join(REPO, 'pwa', 'src'),
      path.join(REPO, 'ui', 'src'),
      path.join(REPO, 'ui', '.storybook'),
    ];
    const sheets = roots.flatMap((root) =>
      readdirSync(root, { recursive: true, encoding: 'utf8' })
        .filter((f) => f.endsWith('.css'))
        .map((f) => path.join(root, f))
        .map((abs) => ({ rel: path.relative(REPO, abs).split(path.sep).join('/'), text: readFileSync(abs, 'utf8') })));
    expect(sheets.length, 'the walk stopped seeing the stylesheets').toBeGreaterThan(10);
    const found = sheets.flatMap(({ rel, text }) =>
      declarations(text, ['accent-color', 'scrollbar-color'])
        .map(({ chain, prop }) => `${rel}: ${[...chain, prop].join(' { ')}`));
    expect(found.sort()).toEqual([
      'pwa/src/styles/base.css: html { accent-color',
      'pwa/src/styles/base.css: html { scrollbar-color',
      'ui/.storybook/preview.css: html { accent-color',
      'ui/.storybook/preview.css: html { scrollbar-color',
    ]);
  });

  it("Storybook's preview states the app's root rule, declaration for declaration", () => {
    // preview.css mirrors base.css's load order already; it now carries the
    // same `html` rule, so a native radio in a story draws in the accent and a
    // story's scrollbar takes the thumb, as the app does. A second spelling of
    // one rule, so it is bound here: either side changing alone reds.
    for (const prop of ['accent-color', 'scrollbar-color']) {
      expect(declaredValues(PREVIEW_CSS, 'html', prop), prop).toEqual(declaredValues(BASE_CSS, 'html', prop));
    }
  });

  it('names only tokens every palette resolves for itself', () => {
    // A token one palette left undeclared would inherit `:root`'s dark value
    // into a light mode. Read off the rule, never re-listed here, so a token
    // swapped on `html` is the token checked. The thumb is DERIVED in `:root`
    // (below), so it is followed to the tokens it resolves through, and each
    // of THOSE must be declared by every palette.
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
      tokens.flatMap((token) => leaves(token))
        .filter((leaf) => !new RegExp(`^\\s*${leaf}\\s*:`, 'm').test(body))
        .map((leaf) => `${sel} has no ${leaf}`));
    expect(missing).toEqual([]);
  });
});

describe('the scrollbar thumb is fitted, never a hairline or a hand-tuned literal (D-5159)', () => {
  it('clears 3:1 against every ground a scroll container paints, in every palette', () => {
    // WCAG 2.1 SC 1.4.11: once an author sets `scrollbar-color`, the thumb is
    // a graphical object the page drew, owed 3:1. Measured on the token the
    // rule above names, through the contrast gate's own resolver. At
    // `--edge-strong` (the plan's value) this read 1.03 at worst.
    const thumb = declaredValues(BASE_CSS, 'html', 'scrollbar-color')[0]?.match(/^var\([^)]*\)/)?.[0];
    expect(thumb, 'the rule names no thumb token').toBeDefined();
    const { all } = loadThemes(path.join(import.meta.dirname, '..'));
    expect(all.length).toBeGreaterThanOrEqual(12);
    const thin = all.flatMap(([name, theme]) =>
      THUMB_GROUNDS
        .map((ground) => ({ ground, r: ratio(thumb!, [`var(${ground})`], theme) }))
        .filter(({ r }) => r < 3)
        .map(({ ground, r }) => `${name.trim()} thumb on ${ground} = ${r.toFixed(2)}`));
    expect(thin).toEqual([]);
  });

  it('is declared once, in :root, as a derivation from palette tokens — no palette re-declares it', () => {
    // NOT A HAND-TUNED LITERAL, by construction rather than by review. One
    // declaration in the whole file, in `:root`, naming tokens; every palette
    // resolves it through its own values (the `--status-dead-tint-solid`
    // pattern). A palette block re-declaring it — a hex tuned until the case
    // above passes — reds here.
    const decls = [...stripComments(TOKENS_CSS).matchAll(/^\s*--scrollbar-thumb\s*:/gm)];
    expect(decls, 'declared exactly once in tokens.css').toHaveLength(1);
    const value = rootValue('--scrollbar-thumb');
    expect(value, ':root declares no --scrollbar-thumb').not.toBeNull();
    expect(value, 'a colour literal — the thumb is derived, never tuned')
      .not.toMatch(/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i);
    expect(value, 'names no palette token').toMatch(/var\(--[a-z0-9-]+\)/);
  });
});
