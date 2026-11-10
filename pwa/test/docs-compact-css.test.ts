// The Docs reader's compact head, its stylesheet half (the phone-header plan of 2026-11-03, Task 3). vitest evaluates no
// stylesheet and jsdom lays nothing out, so this file holds docs.css's own declarations for the compact head: the screen
// gives the row the top, the row's controls take a whole tap, a closed panel is not drawn, "Formatting…" lies over the
// frame's host, and no rule keys on a width (the head's component alone decides when the row is drawn). The pixels are
// browser/docs-compact-head.browser.test.ts's; the colours are contrast.test.ts's, through design/audit.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { declValue, effectiveValue, ruleIn, selectorsOf, stripComments } from './cssRule';

const docsCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'docs', 'docs.css'), 'utf8');
const SCREEN = '.docs-screen:has(> .docs-compact)';
const LEAF = `${SCREEN} > .docs-leaf:has(> .docs-reader)`;

describe('the compact head in docs.css (the phone-header plan, refinements (d), (e), (f), (i), (k))', () => {
  it('the screen gives the row the top: only the safe-area inset above it (0 outside an installed iOS app) and a 4 px gap under it; its sides and bottom as before', () => {
    const rule = ruleIn(docsCss, SCREEN);
    expect(declValue(rule, 'padding-top')).toBe('var(--safe-top)');
    expect(declValue(rule, 'gap')).toBe('var(--sp-1)');
    expect(declValue(rule, 'padding')).toBeNull();
    expect(declValue(ruleIn(docsCss, '.docs-screen'), 'padding')).toBe('var(--sp-2)');
  });

  it('the row is one tap tall with the mockup\'s 1 px divider inside that height; the label gives way to the controls', () => {
    const bar = ruleIn(docsCss, '.docs-compact-bar');
    expect(declValue(bar, 'block-size')).toBe('var(--tap-min)');
    expect(declValue(bar, 'border-block-end')).toBe('1px solid var(--edge-subtle)');
    expect(declValue(ruleIn(docsCss, '.docs-compact-label'), 'min-width')).toBe('0');
    expect(declValue(ruleIn(docsCss, '.docs-compact-crumbs'), 'display')).toBe('flex');
  });

  it('the row\'s controls draw the focus ring inside their boxes: the row is at the top of the page, so an outer ring would be off-screen (refinement (k))', () => {
    expect(declValue(ruleIn(docsCss, '.docs-compact-bar :focus-visible'), 'outline-offset')).toBe('-2px');
  });

  it('the crumbs state (the tree slot not ok) draws the same inset ring: it sits at the top of the page too, where the safe-area inset is 0', () => {
    expect(declValue(ruleIn(docsCss, '.docs-compact-crumbs :focus-visible'), 'outline-offset')).toBe('-2px');
    expect(selectorsOf(docsCss, '.docs-compact-crumbs :focus-visible'), 'one rule with the row\'s, not a second mechanism')
      .toContain('.docs-compact-bar :focus-visible');
  });

  it('the first line\'s text and the name end in an ellipsis; the draft badge beside the text never shrinks (refinement (g))', () => {
    for (const sel of ['.docs-compact-where-text', '.docs-compact-name']) {
      const lines = ruleIn(docsCss, sel);
      expect(declValue(lines, 'overflow'), sel).toBe('hidden');
      expect(declValue(lines, 'text-overflow'), sel).toBe('ellipsis');
      expect(declValue(lines, 'white-space'), sel).toBe('nowrap');
    }
    expect(declValue(ruleIn(docsCss, '.docs-compact-where'), 'display')).toBe('flex');
    expect(declValue(ruleIn(docsCss, '.docs-compact-where'), 'overflow')).toBeNull();
    expect(declValue(ruleIn(docsCss, '.docs-compact-where .docs-badge'), 'flex')).toBe('none');
  });

  it('the crumb and the ref are two spans, each cut at its own end, the crumb giving way first, so a long directory never hides the ref (refinement (g))', () => {
    // The first line's text also sits in the grouped ellipsis rule, so its flex line is read over every rule naming it.
    expect(effectiveValue(docsCss, '.docs-compact-where-text', 'display')).toBe('flex');
    expect(effectiveValue(docsCss, '.docs-compact-where-text', 'min-width')).toBe('0');
    const crumb = ruleIn(docsCss, '.docs-compact-where-crumb');
    const ref = ruleIn(docsCss, '.docs-compact-where-ref');
    for (const [sel, rule] of [['crumb', crumb], ['ref', ref]] as const) {
      expect(declValue(rule, 'min-width'), sel).toBe('0');
      expect(declValue(rule, 'overflow'), sel).toBe('hidden');
      expect(declValue(rule, 'text-overflow'), sel).toBe('ellipsis');
    }
    expect(declValue(crumb, 'white-space')).toBe('nowrap');
    // The ref's span opens with the separator's space, which a flex item drops under `nowrap`.
    expect(declValue(ref, 'white-space')).toBe('pre');
    const shrink = (rule: string): number => Number(/^0\s+(\d+)\s+auto$/.exec(declValue(rule, 'flex') ?? '')?.[1] ?? Number.NaN);
    expect(shrink(ref)).toBe(1);
    expect(shrink(crumb), 'the crumb shrinks first').toBeGreaterThan(shrink(ref));
  });

  it('Share and Export on the row are a whole tap wide with no underline, and a disabled one is dimmed, not recoloured', () => {
    const icon = ruleIn(docsCss, '.docs-compact-bar .docs-action');
    expect(declValue(icon, 'min-width')).toBe('var(--tap-min)');
    expect(declValue(icon, 'justify-content')).toBe('center');
    expect(declValue(icon, 'text-decoration')).toBe('none');
    const off = ruleIn(docsCss, '.docs-compact-bar .docs-action:disabled');
    expect(declValue(off, 'opacity')).toBe('0.35');
    expect(declValue(off, 'color')).toBeNull();
  });

  it('Page details is a tap square holding its dot (never fetched and failed in the mockup\'s one attention colour), and an open one paints its own pressed ground and ink', () => {
    const more = ruleIn(docsCss, '.docs-more');
    expect(declValue(more, 'min-width')).toBe('var(--tap-min)');
    expect(declValue(more, 'min-height')).toBe('var(--tap-min)');
    expect(declValue(more, 'position')).toBe('relative');
    const open = ruleIn(docsCss, ".docs-more[aria-expanded='true']");
    expect(declValue(open, 'background')).toBe('var(--bg-pressed)');
    expect(declValue(open, 'color')).toBe('var(--ink-primary)');
    expect(declValue(ruleIn(docsCss, '.docs-more-dot'), 'position')).toBe('absolute');
    expect(['ok', 'warn', 'failed'].map((tone) => declValue(ruleIn(docsCss, `.docs-more-dot[data-tone='${tone}']`), 'background')))
      .toEqual(['var(--status-done)', 'var(--status-attention)', 'var(--status-attention)']);
  });

  it('a closed panel is not drawn: its own display gives way to [hidden]', () => {
    expect(declValue(ruleIn(docsCss, '.docs-more-panel'), 'display')).toBe('grid');
    expect(declValue(ruleIn(docsCss, '.docs-more-panel[hidden]'), 'display')).toBe('none');
  });

  it('"Formatting…" lies over the frame host on the compact screen, on the page\'s own ground', () => {
    expect(declValue(ruleIn(docsCss, LEAF), 'position')).toBe('relative');
    const over = ruleIn(docsCss, `${LEAF} > .doc-formatting`);
    expect(declValue(over, 'position')).toBe('absolute');
    expect(declValue(over, 'inset-block-start')).toBe('0');
    expect(declValue(over, 'background')).toBe('var(--bg-page)');
  });

  it('no rule keys the compact head on a width: the one max-width block is the reader layout\'s, as before (refinement (b))', () => {
    const text = stripComments(docsCss);
    expect(text).not.toMatch(/599/);
    const blocks = [...text.matchAll(/@media[^{]*max-width[^{]*\{/g)].map((m) => m[0]);
    expect(blocks).toEqual(['@media (max-width: 899.98px) {']);
  });
});

/** The body of every `@media` block in `css` whose query names a width, its braces matched, so a rule is known to sit
 *  outside any width query. */
function widthMediaBodies(css: string): string[] {
  const text = stripComments(css);
  const out: string[] = [];
  for (const m of text.matchAll(/@media[^{]*width[^{]*\{/g)) {
    let depth = 1;
    let i = (m.index ?? 0) + m[0].length;
    const start = i;
    for (; i < text.length && depth > 0; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
    }
    out.push(text.slice(start, i - 1));
  }
  return out;
}

describe('the one bar in docs.css (the take-up plan, refinements (j), (k), (l))', () => {
  it('the bar positions the reading line; the title, a tool and the line carry their declarations; no selector of the block names a width', () => {
    expect(declValue(ruleIn(docsCss, '.docs-one-bar .docs-compact-bar'), 'position')).toBe('relative');
    // The bar is its own stacking context and the line sits under its controls, so a focused control's inset ring is
    // whole along the bottom edge (the browser file asserts the paint order).
    expect(declValue(ruleIn(docsCss, '.docs-one-bar .docs-compact-bar'), 'isolation')).toBe('isolate');
    const title = ruleIn(docsCss, '.docs-title');
    expect(declValue(title, 'flex')).toBe('1 1 auto');
    expect(declValue(title, 'min-width')).toBe('0');
    expect(declValue(title, 'min-height')).toBe('var(--tap-min)');
    expect(declValue(title, 'background')).toBe('none');
    expect(declValue(ruleIn(docsCss, ".docs-title[aria-expanded='true']"), 'background')).toBe('var(--bg-pressed)');
    const tool = ruleIn(docsCss, '.docs-tool');
    expect(declValue(tool, 'min-height')).toBe('var(--tap-min)');
    expect(declValue(tool, 'min-width')).toBe('var(--tap-min)');
    // The line: 2 px of the accent at the bar's bottom edge (the padding box ends above the divider, so -1px puts its
    // bottom at the bar's), inside the bar's height, with no motion and no fade.
    const line = ruleIn(docsCss, '.docs-read');
    expect(declValue(line, 'position')).toBe('absolute');
    expect(declValue(line, 'inset-block-end')).toBe('-1px');
    expect(declValue(line, 'block-size')).toBe('2px');
    expect(declValue(line, 'background')).toBe('var(--accent)');
    expect(declValue(line, 'z-index')).toBe('-1');
    for (const prop of ['transition', 'opacity', 'height', 'margin']) expect(declValue(line, prop), prop).toBeNull();
    for (const sel of [
      '.docs-one-bar .docs-compact-bar', '.docs-title', ".docs-title[aria-expanded='true']", '.docs-title-dot', '.docs-tool', '.docs-read',
    ]) {
      expect(selectorsOf(docsCss, sel).join(' '), sel).not.toMatch(/@media|\d\s*px|width/);
      const named = new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
      for (const body of widthMediaBodies(docsCss)) expect(named.test(body), `${sel} inside a width @media block`).toBe(false);
    }
  });
});
