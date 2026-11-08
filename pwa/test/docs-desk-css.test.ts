// The desk Docs head, its stylesheet half (desk-nav plan 2026-11-07, Task B, Step 3; D-8101). vitest evaluates no
// stylesheet and jsdom lays nothing out, so this file holds docs.css's own declarations for the full head: the row is a
// `docs-head` container that never wraps, the crumbs take the room the actions leave and their middle crumbs give way
// first, the action words hide only under the `docs-head` container query, the truth line is one line at
// `--docs-line-h` with its chip and its commit never giving way, and no rule keys on a viewport width. Every rule here
// is scoped to `.docs-full`, the full head's own class, so the compact head's panel (which draws the same truth line
// and link actions) does not change. The pixels are browser/docs-compact-head.browser.test.ts's.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { atBlock, declValue, effectiveValue, ruleIn, stripComments } from './cssRule';

const docsCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'docs', 'docs.css'), 'utf8');
const ROW = '.docs-full > .docs-head-bar';
const TRUTH = '.docs-full > .docs-truth';

/** The `@container docs-head (…)` preludes in docs.css. */
const containerPreludes = (): string[] =>
  [...stripComments(docsCss).matchAll(/@container[^{]*\{/g)].map((m) => m[0].replace(/\s*\{$/, '').replace(/\s+/g, ' ').trim());

/** A `flex` shorthand's shrink factor (`<grow> <shrink> <basis>`), NaN when the value is not that shape. */
const shrinkOf = (rule: string): number => Number(/^\d+\s+(\d+)\s+\S+$/.exec(declValue(rule, 'flex') ?? '')?.[1] ?? Number.NaN);

describe('the desk head in docs.css (desk-nav Part B)', () => {
  it('the head\'s rows sit a 4 px step apart', () => {
    expect(declValue(ruleIn(docsCss, '.docs-full'), 'gap')).toBe('var(--sp-1)');
  });

  it('the row is a docs-head container and does not wrap', () => {
    const row = ruleIn(docsCss, ROW);
    expect(declValue(row, 'container')).toBe('docs-head / inline-size');
    expect(declValue(row, 'flex-wrap')).toBe('nowrap');
  });

  it('the row\'s controls draw the focus ring inside their boxes: the row clips its crumbs', () => {
    expect(declValue(ruleIn(docsCss, `${ROW} :focus-visible`), 'outline-offset')).toBe('-2px');
  });

  it('the crumbs take the room the actions leave, on one line, the middle crumbs giving way before the page\'s own', () => {
    const crumbs = ruleIn(docsCss, '.docs-full .docs-crumbs');
    expect(declValue(crumbs, 'flex')).toBe('1 1 0');
    expect(declValue(crumbs, 'min-width')).toBe('0');
    expect(declValue(ruleIn(docsCss, '.docs-full .docs-crumbs ol'), 'flex-wrap')).toBe('nowrap');
    const middle = ruleIn(docsCss, '.docs-full .docs-crumbs li');
    const last = ruleIn(docsCss, '.docs-full .docs-crumbs li:last-child');
    expect(declValue(middle, 'min-width')?.replace(/\s+/g, ''), 'a middle crumb keeps a tap beside its separator').toBe('calc(var(--tap-min)+1ch+var(--sp-1))');
    expect(shrinkOf(last)).toBe(1);
    expect(shrinkOf(middle), 'the middle crumbs shrink first').toBeGreaterThan(shrinkOf(last));
    for (const sel of ['.docs-full .docs-crumb', '.docs-full .docs-crumb-here']) {
      const r = ruleIn(docsCss, sel);
      expect(declValue(r, 'overflow'), sel).toBe('hidden');
      expect(declValue(r, 'text-overflow'), sel).toBe('ellipsis');
      expect(declValue(r, 'white-space'), sel).toBe('nowrap');
    }
  });

  it('the actions sit on the row\'s one line, each an icon beside its words', () => {
    const actions = ruleIn(docsCss, '.docs-full .docs-actions');
    expect(declValue(actions, 'flex-wrap')).toBe('nowrap');
    expect(declValue(ruleIn(docsCss, '.docs-full .docs-action'), 'white-space')).toBe('nowrap');
    expect(declValue(ruleIn(docsCss, '.docs-full .docs-action'), 'gap')).toBe('var(--sp-1)');
  });

  it('the action words hide only under the docs-head container query', () => {
    const preludes = containerPreludes();
    expect(preludes).toHaveLength(1);
    expect(preludes[0]).toMatch(/^@container docs-head \(width < \d+px\)$/);
    expect(declValue(ruleIn(atBlock(docsCss, preludes[0]!), '.docs-action-words'), 'display')).toBe('none');
    // Nowhere else is a word hidden: the one `.docs-action-words` rule is the one inside the query.
    const outside = stripComments(docsCss).replace(atBlock(docsCss, preludes[0]!), '');
    expect(outside).not.toMatch(/\.docs-action-words\s*[,{]/);
  });

  it('the truth line is one line at --docs-line-h, and so are its chip and its copy button', () => {
    const truth = ruleIn(docsCss, TRUTH);
    expect(declValue(truth, 'display')).toBe('flex');
    expect(declValue(truth, 'white-space')).toBe('pre');
    expect(declValue(truth, 'overflow')).toBe('hidden');
    expect(declValue(truth, 'min-height')).toBe('var(--docs-line-h)');
    for (const sel of [`${TRUTH} .docs-fresh`, `${TRUTH} .docs-copy`]) {
      expect(declValue(ruleIn(docsCss, sel), 'min-height'), sel).toBe('var(--docs-line-h)');
    }
    // The commit and copy commit keep a space between them: a whitespace-only text run is not rendered in a flex line.
    expect(effectiveValue(docsCss, `${TRUTH} .docs-copy`, 'margin-inline-start')).toBe('1ch');
    // The line clips at its edges, so its two controls draw the ring inside their boxes.
    expect(declValue(ruleIn(docsCss, `${TRUTH} :focus-visible`), 'outline-offset')).toBe('-2px');
  });

  it('the via sentence gives way first; the freshness chip and the commit never give way', () => {
    expect(declValue(ruleIn(docsCss, `${TRUTH} > *`), 'flex')).toBe('none');
    const via = ruleIn(docsCss, `${TRUTH} > .docs-truth-via`);
    expect(declValue(via, 'min-width')).toBe('0');
    expect(declValue(via, 'text-overflow')).toBe('ellipsis');
    for (const sel of ['.docs-truth-ref', '.docs-truth-relation', '.docs-truth-source']) {
      expect(shrinkOf(via), `via before ${sel}`).toBeGreaterThan(shrinkOf(ruleIn(docsCss, `${TRUTH} > ${sel}`)));
    }
    // The chip and the commit sit in no rule that lets them shrink: they take the `> *` rule's `flex: none` alone.
    const shrinking = stripComments(docsCss).match(/[^{}]*\{[^{}]*flex:\s*0\s+[1-9]/g) ?? [];
    for (const sel of ['.docs-fresh', '.docs-truth-commit', '.docs-copy']) {
      expect(shrinking.filter((r) => r.includes(sel)), sel).toEqual([]);
    }
  });

  it('no rule keys on a viewport width: the one max-width block is the reader layout\'s, and there is no min-width block', () => {
    const text = stripComments(docsCss);
    const blocks = [...text.matchAll(/@media[^{]*(?:min|max)-width[^{]*\{/g)].map((m) => m[0]);
    expect(blocks).toEqual(['@media (max-width: 899.98px) {']);
    expect(text).not.toMatch(/@media[^{]*width\s*[<>]/);
  });
});
