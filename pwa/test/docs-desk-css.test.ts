// The desk Docs head, its stylesheet half (desk-nav plan 2026-11-07, Task B, Step 3; D-8101). vitest evaluates no
// stylesheet and jsdom lays nothing out, so this file holds docs.css's own declarations for the full head: the row is a
// `docs-head` container that wraps the actions onto a second line only once the crumbs are at their floor (the crumbs
// drawn, a tap each), the crumbs take the room the actions leave and their middle crumbs give way first, the action
// words hide when the row asks (`HeadRow`'s `data-words`) and under the `docs-head` container query, the truth line is
// one line at `--docs-line-h` when its facts fit and wraps rather than clip when they do not, with only the via
// sentence giving way, and no rule keys on a viewport width. Every rule here is scoped to `.docs-full`, the full head's
// own class, so the compact head's panel (which draws the same truth line and link actions) does not change. The pixels
// are browser/docs-compact-head.browser.test.ts's.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { atBlock, declValue, declaredValues, effectiveValue, ruleIn, stripComments } from './cssRule';

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

  it('the row is a docs-head container, and wraps the actions onto a second line rather than clip the crumbs (fix round 1, F1)', () => {
    const row = ruleIn(docsCss, ROW);
    expect(declValue(row, 'container')).toBe('docs-head / inline-size');
    expect(declValue(row, 'flex-wrap')).toBe('wrap');
  });

  it('the row\'s controls draw the focus ring inside their boxes: the row clips its crumbs', () => {
    expect(declValue(ruleIn(docsCss, `${ROW} :focus-visible`), 'outline-offset')).toBe('-2px');
  });

  it('the crumbs have a real floor: the crumbs drawn at a tap each is their basis, so the row breaks before they go under it (F1; fix round 2, item 2)', () => {
    const crumbs = ruleIn(docsCss, '.docs-full .docs-crumbs');
    // `--docs-crumbs-n` is the number of crumbs drawn, the `…` button counted (`Crumbs`), each a tap beside its separator,
    // with the gaps between them and the page's own one more character.
    const floor = 'calc(var(--docs-crumbs-n,3)*(var(--tap-min)+1ch+2*var(--sp-1))+1ch-var(--sp-1))';
    // They grow first: a grow a hundred thousand times the only other grower's (GitHub's refusal, review 1704 F2).
    const [grow, shrink, ...basis] = (declValue(crumbs, 'flex') ?? '').trim().split(/\s+/);
    expect([grow, shrink], 'grow first from the floor, never shrink under it on a shared line').toEqual(['100000', '1']);
    expect(basis.join(''), 'the floor is the basis').toBe(floor);
    // The floor is the basis, not a minimum: a short path takes no more room than its words (max-content).
    expect(declValue(crumbs, 'max-width')).toBe('max-content');
    expect(declValue(crumbs, 'min-width')).toBe('0');
    expect(declValue(crumbs, 'overflow')).toBe('hidden');
  });

  it('the crumbs are one line; the middle ones give way before the page\'s own, and what is left is clipped at the start, never the page\'s name (F1)', () => {
    const ol = ruleIn(docsCss, '.docs-full .docs-crumbs ol');
    expect(declValue(ol, 'flex-wrap')).toBe('nowrap');
    expect(declValue(ol, 'justify-content')).toBe('flex-end');
    const middle = ruleIn(docsCss, '.docs-full .docs-crumbs li');
    const last = ruleIn(docsCss, '.docs-full .docs-crumbs li:last-child');
    expect(declValue(middle, 'min-width')?.replace(/\s+/g, ''), 'a crumb keeps a tap beside its separator').toBe('calc(var(--tap-min)+1ch+var(--sp-1))');
    expect(declValue(last, 'min-width')?.replace(/\s+/g, ''), 'the page\'s own name keeps a tap and one more character').toBe('calc(var(--tap-min)+2ch+var(--sp-1))');
    expect(shrinkOf(last)).toBe(1);
    expect(shrinkOf(middle), 'the middle crumbs shrink first').toBeGreaterThan(shrinkOf(last));
    // A crumb link is a tap wide even when its words are shorter ("Docs"), and gives way no further (fix round 2, item 2).
    expect(declValue(ruleIn(docsCss, '.docs-full .docs-crumb'), 'min-width')).toBe('var(--tap-min)');
    for (const sel of ['.docs-full .docs-crumb', '.docs-full .docs-crumb-here']) {
      const r = ruleIn(docsCss, sel);
      expect(declValue(r, 'overflow'), sel).toBe('hidden');
      expect(declValue(r, 'text-overflow'), sel).toBe('ellipsis');
      expect(declValue(r, 'white-space'), sel).toBe('nowrap');
    }
  });

  it('the actions sit at the row\'s end, each an icon beside its words; wider than a line of their own, they wrap among themselves, never past the head (F1)', () => {
    const actions = ruleIn(docsCss, '.docs-full .docs-actions');
    expect(declValue(actions, 'flex-wrap')).toBe('wrap');
    expect(declValue(actions, 'margin-inline-start')).toBe('auto');
    expect(declValue(actions, 'flex')).toBe('0 1 auto');
    expect(declValue(actions, 'min-width')).toBe('0');
    // Each action keeps its whole face: none of them shrinks inside the group (F6, mutant X2).
    expect(declValue(ruleIn(docsCss, '.docs-full .docs-actions > *'), 'flex')).toBe('none');
    expect(declValue(ruleIn(docsCss, '.docs-full .docs-action'), 'white-space')).toBe('nowrap');
    expect(declValue(ruleIn(docsCss, '.docs-full .docs-action'), 'gap')).toBe('var(--sp-1)');
  });

  it('a disabled Share or Export in the row is dimmed as the compact bar dims it, never recoloured (F3)', () => {
    const off = ruleIn(docsCss, '.docs-full .docs-action:disabled');
    expect(declValue(off, 'opacity')).toBe('0.35');
    expect(declValue(off, 'color')).toBeNull();
  });

  it('only an action drawn as an icon beside its words drops the underline; one drawn as text alone keeps it (F3)', () => {
    expect(declValue(ruleIn(docsCss, '.docs-full .docs-action'), 'text-decoration'), 'the row\'s actions keep the shared underline').toBeNull();
    expect(declValue(ruleIn(docsCss, '.docs-full .docs-action:has(> .docs-action-words)'), 'text-decoration')).toBe('none');
    const undecorated = (stripComments(docsCss).match(/[^{}]*\{[^{}]*text-decoration:\s*none[^{}]*\}/g) ?? [])
      .map((r) => r.slice(0, r.indexOf('{')).trim()).filter((sel) => sel.includes('.docs-full'));
    expect(undecorated).toEqual(['.docs-full .docs-action:has(> .docs-action-words)']);
  });

  it('GitHub\'s refusal in the row shortens with an ellipsis before the page\'s name does, so it never runs past the row (F5; review 1704 F2)', () => {
    const off = ruleIn(docsCss, '.docs-full .docs-actions > .docs-action-off');
    // A floor of 12ch, its words kept out of the actions' own width, and it grows into what the crumbs leave.
    expect(declValue(off, 'flex')).toBe('1 1 12ch');
    expect(declValue(off, 'min-width')).toBe('12ch');
    expect(declValue(off, 'contain')).toBe('inline-size');
    expect(declValue(ruleIn(docsCss, '.docs-full .docs-actions:has(> .docs-action-off)'), 'flex-grow')).toBe('1');
    expect(declValue(off, 'overflow')).toBe('hidden');
    expect(declValue(off, 'text-overflow')).toBe('ellipsis');
    expect(declValue(off, 'white-space')).toBe('nowrap');
  });

  it('GitHub\'s may-differ note in the row is a marker: it never shrinks, and its words are not drawn (F1)', () => {
    const mark = ruleIn(docsCss, '.docs-full .docs-actions > .docs-action-note');
    expect(declValue(mark, 'flex')).toBe('none');
  });

  it('the action words hide when the row asks (`HeadRow`, fix round 2, item 1) and under the docs-head container query, nowhere else', () => {
    const preludes = containerPreludes();
    expect(preludes).toHaveLength(1);
    expect(preludes[0]).toMatch(/^@container docs-head \(width < \d+px\)$/);
    expect(declValue(ruleIn(atBlock(docsCss, preludes[0]!), '.docs-action-words'), 'display')).toBe('none');
    const asked = `${ROW}[data-words='off'] .docs-action-words`;
    expect(declValue(ruleIn(docsCss, asked), 'display')).toBe('none');
    // Nowhere else is a word hidden: outside the query, the one `.docs-action-words` rule is the row's ask.
    const outside = stripComments(docsCss).replace(atBlock(docsCss, preludes[0]!), '');
    const hiding = [...outside.matchAll(/([^{}]*\.docs-action-words)\s*\{/g)].map((m) => m[1]!.trim());
    expect(hiding).toEqual([asked]);
  });

  it('the truth line is one line at --docs-line-h when its facts fit, and wraps onto a second line when they do not; it clips nothing (F2)', () => {
    const truth = ruleIn(docsCss, TRUTH);
    expect(declValue(truth, 'display')).toBe('flex');
    expect(declValue(truth, 'flex-wrap')).toBe('wrap');
    expect(declValue(truth, 'white-space')).toBe('pre');
    expect(declValue(truth, 'min-height')).toBe('var(--docs-line-h)');
    expect(declaredValues(docsCss, TRUTH, 'overflow'), 'the line clips nothing').toEqual([]);
    for (const sel of [`${TRUTH} .docs-fresh`, `${TRUTH} .docs-copy`]) {
      expect(declValue(ruleIn(docsCss, sel), 'min-height'), sel).toBe('var(--docs-line-h)');
    }
    // The commit and copy commit keep a space between them: a whitespace-only text run is not rendered in a flex line.
    expect(effectiveValue(docsCss, `${TRUTH} .docs-copy`, 'margin-inline-start')).toBe('1ch');
  });

  it('every fact keeps its place: none shrinks, none is wider than the line, and a long one wraps inside itself (F2)', () => {
    const each = ruleIn(docsCss, `${TRUTH} > *`);
    expect(declValue(each, 'flex')).toBe('none');
    expect(declValue(each, 'max-width')).toBe('100%');
    for (const sel of ['.docs-truth-ref', '.docs-truth-relation', '.docs-truth-source', '.docs-truth-dangling', '.docs-fresh']) {
      expect(effectiveValue(docsCss, `${TRUTH} > ${sel}`, 'white-space'), sel).toBe('normal');
      expect(declaredValues(docsCss, `${TRUTH} > ${sel}`, 'text-overflow'), `${sel} is never cut`).toEqual([]);
    }
  });

  it('only the via sentence gives way, to an ellipsis, from a small basis up to its whole words (F2)', () => {
    const via = ruleIn(docsCss, `${TRUTH} > .docs-truth-via`);
    expect(shrinkOf(via)).toBeGreaterThan(0);
    expect(declValue(via, 'max-width')).toBe('max-content');
    expect(declValue(via, 'overflow')).toBe('hidden');
    expect(declValue(via, 'text-overflow')).toBe('ellipsis');
    // No other part of the line sits in a rule that lets it shrink: only the via sentence gives way.
    const shrinking = (stripComments(docsCss).match(/[^{}]*\{[^{}]*flex:\s*\d+\s+[1-9]/g) ?? []).filter((r) => r.includes('.docs-truth'));
    expect(shrinking.map((r) => r.slice(0, r.indexOf('{')).trim())).toEqual([`${TRUTH} > .docs-truth-via`]);
  });

  it('no rule keys on a viewport width: the one max-width block is the reader layout\'s, and there is no min-width block', () => {
    const text = stripComments(docsCss);
    const blocks = [...text.matchAll(/@media[^{]*(?:min|max)-width[^{]*\{/g)].map((m) => m[0]);
    expect(blocks).toEqual(['@media (max-width: 899.98px) {']);
    expect(text).not.toMatch(/@media[^{]*width\s*[<>]/);
  });
});
