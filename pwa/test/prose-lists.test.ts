// Prose lists have markers: a bullet on every `ul` item, a number on every
// `ol` item, and none on a GFM task list, which draws its own checkbox.
//
// THE DEFECT THIS PINS SHUT. The vendored preflight (ui/src/styles/reset.css)
// sets `ol, ul, menu { list-style: none }`, and for as long as prose has
// existed nothing in its rules put the markers back. So every markdown list in
// every assistant turn rendered as bare indented lines, in every theme, in the
// app and in Storybook, and `.msg-assist li::marker { color: var(--ink-tertiary) }`
// tuned the hue of a marker that never painted. prose.test.ts carried that as
// "preserved, not fixed" until the operator ruled the restoration in.
//
// Read as TEXT, like every stylesheet assertion in this suite (`test/cssRule.ts`
// says why: vitest runs with `css: false`, so jsdom computes nothing a rule
// set). What makes a text read sufficient here is the LAYER ORDER, and the
// first block pins it: the reset sits in `base`, prose in `components`, and a
// later layer wins whatever the specificity — so a prose rule that declares a
// marker type is the marker type, and the reset's `none` cannot reach past it.
// Inside prose.css the only contest left is the task list against the marker
// rules, and that one IS a specificity question, so it is measured below.
//
// The browser half — that a `li` inside a `display: grid` list still computes
// `display: list-item` (blockification maps list-item to itself) and paints its
// marker — is not something this runner can see. It was checked on 2026-10-20
// by rendering the design-system Prose preview, and a lists probe (nested ul
// and ol, `start`, two- and three-digit numbers, a nested task list, a quote
// holding a ul then an ol), in headless Chrome at 390 and 720 px, dark and
// light; nothing in this repository records that run, so this file pins the
// part that can regress silently: no rule giving a prose `li` a display that
// drops the marker box.
//
// The later blocks pin the layout fixes the blind visual checks asked for
// once the markers painted: an ordered list's indent wide enough for its
// number, the number's ink inside a callout, a nested task list's indent, the
// unchecked box's ground, the spacing of the lists in a quote (and of a list
// straight after a list, in a quote or a callout), and a task list that nests
// as a block and is done by its own box. TWO OF THEM ARE NOT MARKER WORK and
// the ruling quoted in prose.test.ts ("restore the markers") does not cover
// them, so the pull request names each as a deliberate visual change of its
// own: the unchecked box's ground (--bg-well to --bg-surface, every unchecked
// box), and the lists' spacing inside a quote (scoped to lists, so a quote's
// headings and paragraphs keep main's rhythm — review 2026-10-20, S2).
//
// MUTATION TABLE (RUN 2026-10-20) — each mutant applied to prose.css alone,
// this file run against it, the original restored; every row went red:
//   delete the disc rule                     -> red: disc; layer(components)
//   delete the circle and square rules       -> red: circle, then square
//   lower the task rule to (0,1,1)           -> red: task list outranks markers
//   move the marker rules into @layer base   -> red: layer(components); task
//                                               list follows them in source
//   give `.msg-assist li` display: block     -> red: li stays a list-item
//   `list-style: none` on the shared ul/ol   -> red: nothing takes markers away
//   top-level ol indent back to --sp-5       -> red: indented for 3 digits
//   delete the nested `li > ol` indent rule  -> red: indented for 3 digits
//   delete the callout marker ink            -> red: callout number ink
//   delete the nested task-list indent       -> red: nested task list steps in
//   unchecked box back to --bg-well          -> red: box ground
//   delete the quote's list rhythm           -> red: quote spaces the lists
// Second round (review 2026-10-20), same method:
//   task item back to `display: flex`        -> red: never a flex row
//   checkbox back in flow (position)         -> red: never a flex row
//   done back to a bare `:has(input:checked)`-> red: done by its OWN box
//   sublist loses `display: inline-grid`     -> red: strike stops at sublist
//   quote rhythm back to `> * + *`           -> red: quote spaces the lists,
//                                               no catch-all, heading keeps
//                                               its margin, list after list
//   rhythm's `:not(h1, h2, h3, h4)` dropped  -> red: heading keeps its margin
//   delete the quote's list-after-list rule  -> red: in a quote
//   move it before the rhythm                -> red: in a quote (source order)
//   delete the callout's list-after-list     -> red: in a callout
// Third round (review 2026-10-20), same method:
//   done keeps only `:has(> input:checked)`  -> red: done by its OWN box
//                                               (loose arm) — green before
//   loose arm loses `:first-child`           -> red: done by its OWN box
// Unmutated: 20 passed.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { atBlock, declValue, declaredValues, normSel, ruleIn, stripComments } from './cssRule';

const read = (...seg: string[]): string =>
  readFileSync(path.join(import.meta.dirname, '..', '..', ...seg), 'utf8');

const prose = read('ui', 'src', 'components', 'prose.css');
const reset = read('ui', 'src', 'styles', 'reset.css');
const theme = read('ui', 'src', 'styles', 'theme.css');

/** Specificity as (ids, classes, types) — only as much of the algorithm as
 *  prose.css's list selectors use: classes, attributes, pseudo-classes, types,
 *  pseudo-elements, and `:is()` (its most specific argument) / `:where()`
 *  (nothing). Anything else in a selector here is a reason to extend it. */
function specificity(sel: string): [number, number, number] {
  let s = sel;
  const add = (a: [number, number, number], b: [number, number, number]) =>
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as [number, number, number];
  let total: [number, number, number] = [0, 0, 0];
  for (let m = /:(is|where)\(([^()]*)\)/.exec(s); m !== null; m = /:(is|where)\(([^()]*)\)/.exec(s)) {
    if (m[1] === 'is') {
      const best = m[2]!.split(',').map((a) => specificity(a.trim()))
        .sort((x, y) => cmp(y, x))[0]!;
      total = add(total, best);
    }
    s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
  }
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/g) ?? []).length;
  const types = (s.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) ?? []).length
    + (s.match(/::[\w-]+/g) ?? []).length;
  return add(total, [ids, classes, types]);
}
function cmp(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** `declaredValues`, with "no rule targets this element" answered as no
 *  values — the right reading for a contract that says what nothing may
 *  declare (`rulesFor` throws there, for its callers' reason). */
function declaredOrNone(text: string, sel: string, prop: string): string[] {
  try { return declaredValues(text, sel, prop); } catch { return []; }
}

/** A selector list split at its top-level commas — `:is(ul, ol) ul` is one
 *  selector, not two. */
function splitList(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of prelude) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => normSel(x)).filter((x) => x !== '');
}

/** Every rule in `text` as (selector list, body, offset), source order. */
function allRules(text: string): { selectors: string[]; body: string; at: number }[] {
  const scan = stripComments(text);
  const out: { selectors: string[]; body: string; at: number }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(scan); m !== null; m = re.exec(scan)) {
    out.push({ selectors: splitList(m[1] ?? ''), body: m[2] ?? '', at: m.index });
  }
  return out;
}

/** The value of `prop` the rules NAMING `sel` exactly give it, last in source
 *  winning, or null. Exact naming, not targeting: `.msg-assist ul` is also the
 *  subject of the nesting rules, and those answer for deeper lists. */
function named(sel: string, prop: string): string | null {
  let found: string | null = null;
  for (const r of allRules(prose)) {
    if (!r.selectors.includes(normSel(sel))) continue;
    found = declValue(r.body, prop) ?? found;
  }
  return found;
}
const markerType = (sel: string): string | null => named(sel, 'list-style-type');

describe('the cause, and why a prose rule can undo it', () => {
  it('the preflight takes every list marker away', () => {
    expect(stripComments(reset)).toMatch(/\bol,\s*ul,\s*menu\s*\{\s*list-style:\s*none;?\s*\}/);
  });

  it('but the preflight is layer(base) and prose is layer(components), which wins', () => {
    expect(stripComments(theme)).toMatch(/@layer theme, base, components, utilities;/);
    expect(read('pwa', 'src', 'styles', 'base.css')).toMatch(/reset\.css' layer\(base\);/);
    expect(read('ui', '.storybook', 'preview.css')).toMatch(/reset\.css' layer\(base\);/);
    // The marker rules must be INSIDE the components layer: unlayered they
    // would still win, but a stray `@layer base { … }` wrapper would tie them
    // with the reset and hand the result to import order.
    const layered = atBlock(prose, '@layer components');
    expect(declaredValues(layered, '.msg-assist ul', 'list-style-type')).toContain('disc');
    expect(declaredValues(layered, '.msg-assist ol', 'list-style-type')).toContain('decimal');
  });
});

describe('prose lists show their markers', () => {
  it('an unordered list is bulleted with a disc', () => {
    expect(markerType('.msg-assist ul')).toBe('disc');
  });

  it('an ordered list is numbered, at every depth', () => {
    expect(markerType('.msg-assist ol')).toBe('decimal');
    // Nothing gives a nested `ol` anything else: the UA numbers them all.
    expect(declaredValues(prose, '.msg-assist ol', 'list-style-type')).toEqual(['decimal']);
  });

  it('a nested bulleted list steps to circle, then square, as the UA would', () => {
    expect(markerType('.msg-assist :is(ul, ol) ul')).toBe('circle');
    expect(markerType('.msg-assist :is(ul, ol) :is(ul, ol) ul')).toBe('square');
  });

  it('no rule on a prose list takes the markers away again', () => {
    // The shorthand is the spelling that would: `list-style: none` (or any
    // `list-style:` at all, which resets the type it omits). Only the task
    // list may say it, and that rule's subject is `.contains-task-list`, not a
    // `ul`, so it is not in these lists.
    for (const sel of ['.msg-assist ul', '.msg-assist ol', '.msg-assist li']) {
      expect(declaredOrNone(prose, sel, 'list-style'), sel).toEqual([]);
      expect(declaredOrNone(prose, sel, 'list-style-type'), sel).not.toContain('none');
    }
  });

  it('the ::marker hue has a marker to paint, because a prose li stays a list-item', () => {
    expect(declValue(ruleIn(prose, '.msg-assist li::marker'), 'color')).toBe('var(--ink-tertiary)');
    // `display: grid` on the list blockifies its items, and blockification maps
    // `list-item` to itself — measured in Chromium. What would lose the marker
    // box is a rule giving the li itself another display.
    for (const d of declaredOrNone(prose, '.msg-assist li', 'display')) expect(d).toBe('list-item');
  });
});

describe('a GFM task list stays markerless', () => {
  it('its rule says none, and outranks every rule that sets a marker type', () => {
    const taskSel = '.msg-assist .contains-task-list';
    expect(declValue(ruleIn(prose, taskSel), 'list-style')).toBe('none');

    const rules = allRules(prose);
    const task = rules.find((r) => r.selectors.includes(normSel(taskSel)))!;
    const markers = rules.filter((r) => /list-style-type\s*:/.test(r.body));
    expect(markers.length, 'no marker rule at all — the defect is back').toBeGreaterThan(0);
    for (const r of markers) {
      for (const sel of r.selectors) {
        // A remark-gfm task list is a `ul.contains-task-list`, so every marker
        // rule whose subject is a `ul` matches it too. Strictly higher
        // specificity is what makes the task list win from any position…
        expect(cmp(specificity(taskSel), specificity(sel)), `${taskSel} vs ${sel}`)
          .toBeGreaterThan(0);
      }
      // …and following them in source order means a tie would still go its way.
      expect(task.at, `${r.selectors.join(', ')} after the task list`).toBeGreaterThan(r.at);
    }
  });
});

describe('the lists the markers revealed are laid out for them', () => {
  // `10. ` measured 22.3px and `100. ` 32.4px in Geist at --fs-base: 2.16em.
  // An outside marker ends at the item's content edge, so an indent narrower
  // than its number hangs the number past the column (top level) or into the
  // parent item's text (nested). Em, so it scales with the number it holds.
  const NUMBER_EM = 2.16;
  const ems = (v: string | null): number => {
    const m = /^([\d.]+)em$/.exec(v ?? '');
    return m === null ? 0 : Number(m[1]);
  };

  it('an ordered list is indented for a three-digit number, at every depth', () => {
    expect(ems(named('.msg-assist ol', 'padding-left'))).toBeGreaterThanOrEqual(NUMBER_EM);
    // The nested `ol` shares `li > ul`'s --sp-4 rule; its own later rule, same
    // specificity, must take the indent back.
    expect(ems(named('.msg-assist li > ol', 'padding-left'))).toBeGreaterThanOrEqual(NUMBER_EM);
    const rules = allRules(prose);
    const last = (sel: string): number =>
      Math.max(...rules.filter((r) => r.selectors.includes(normSel(sel))
        && declValue(r.body, 'padding-left') !== null).map((r) => r.at));
    const own = rules.find((r) => r.selectors.length === 1
      && r.selectors[0] === normSel('.msg-assist li > ol'))!;
    expect(own, 'a rule of its own for the nested ol').toBeDefined();
    expect(own.at).toBe(last('.msg-assist li > ol'));
  });

  it("inside a callout the number takes the callout's body ink, not --ink-tertiary", () => {
    // --ink-tertiary measured 3.81 on the warning tint (dracula) and under 4.5
    // somewhere on four of the five tints; --ink-secondary's worst is 4.67.
    const sel = '.msg-assist .callout li::marker';
    expect(named(sel, 'color')).toBe('var(--ink-secondary)');
    expect(cmp(specificity(sel), specificity('.msg-assist li::marker'))).toBeGreaterThan(0);
  });

  it('a nested task list steps in like any nested list', () => {
    const sel = '.msg-assist li > .contains-task-list';
    expect(named(sel, 'padding-left')).toBe('var(--sp-4)');
    // It must beat the flush top-level task rule, which beats `li > ul`.
    expect(cmp(specificity(sel), specificity('.msg-assist .contains-task-list'))).toBeGreaterThan(0);
  });

  it('an unchecked task box takes a ground that follows the page, never the code well', () => {
    // --bg-well is dark in BOTH themes, so in light an empty box painted as a
    // solid near-black square — read as "on".
    const bg = named(".msg-assist .task-list-item input[type='checkbox']", 'background');
    expect(bg).not.toBeNull();
    expect(bg).not.toMatch(/--bg-well/);
  });

  it("a quote spaces the lists in it, since it is not the prose grid", () => {
    expect(named('.msg-assist blockquote > * + :is(ul, ol)', 'margin-top')).toBe('var(--sp-2)');
    expect(named('.msg-assist blockquote > :is(ul, ol) + :not(h1, h2, h3, h4)', 'margin-top'))
      .toBe('var(--sp-2)');
  });
});

/** The last compound of a selector — the element it styles. */
const subject = (sel: string): string => {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < sel.length; i += 1) {
    const ch = sel[i]!;
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (depth === 0 && /[\s>+~]/.test(ch)) cut = i + 1;
  }
  return sel.slice(cut).trim();
};

describe("a quote's rhythm reaches its lists and nothing else", () => {
  // Review 2026-10-20, S2: `blockquote > * + *` (0,1,1) tied the heading rule
  // and followed it, so a heading in a quote lost its --sp-3/--sp-4 top margin
  // and a quote's paragraphs gained a gap main never had — visual changes the
  // marker restoration had no ruling for.
  const quoteChild = /^\.msg-assist blockquote > /;
  const marginRules = allRules(prose).flatMap((r) =>
    r.selectors.filter((sel) => quoteChild.test(sel) && declValue(r.body, 'margin-top') !== null)
      .map((sel) => ({ sel, value: declValue(r.body, 'margin-top')! })));

  it('no catch-all child rule sets a margin in a quote', () => {
    expect(named('.msg-assist blockquote > * + *', 'margin-top')).toBeNull();
    expect(marginRules.length, 'the list rhythm is gone').toBeGreaterThan(0);
  });

  it('a heading inside a quote keeps its own top margin', () => {
    // Every quote-child rule that can match a heading either zeroes the first
    // child (main's own rule) or is not a heading's at all: its subject is a
    // list, or it says `:not(h1, h2, h3, h4)`.
    for (const { sel, value } of marginRules) {
      const subj = subject(sel).replace(/\s+/g, '');
      const spares = subj === ':is(ul,ol)' || subj.includes(':not(h1,h2,h3,h4)')
        || (subj === ':first-child' && value === '0');
      expect(spares, `${sel} { margin-top: ${value} }`).toBe(true);
    }
    expect(named('.msg-assist h1', 'margin-top')).toBe('var(--sp-4)');
    expect(named('.msg-assist h3', 'margin-top')).toBe('var(--sp-3)');
  });
});

describe('a list straight after a list reads as a second list', () => {
  // Review 2026-10-20, S2: in a quote and in every callout the step between a
  // `ul` and the `ol` after it was --sp-2, the item gap, so the two read as
  // one. The step between their boxes is now twice the item gap in both.
  const SP = { 'var(--sp-2)': 8, 'var(--sp-4)': 16 } as Record<string, number>;
  const itemGap = SP[named('.msg-assist ul', 'gap') ?? '']!;

  it('in a quote, by margin alone', () => {
    const v = named('.msg-assist blockquote > :is(ul, ol) + :is(ul, ol)', 'margin-top');
    expect(SP[v ?? '']).toBeGreaterThanOrEqual(2 * itemGap);
    // (0,1,3), level with the rhythm's `:not()` selector, which matches a list
    // too — so it must follow it in source.
    const rules = allRules(prose);
    const at = (sel: string): number => rules.find((r) => r.selectors.includes(normSel(sel)))!.at;
    expect(at('.msg-assist blockquote > :is(ul, ol) + :is(ul, ol)'))
      .toBeGreaterThan(at('.msg-assist blockquote > :is(ul, ol) + :not(h1, h2, h3, h4)'));
  });

  it("in a callout, by margin over the callout's own grid gap", () => {
    const v = named('.msg-assist .callout > :is(ul, ol) + :is(ul, ol)', 'margin-top');
    const gap = SP[declValue(ruleIn(prose, '.msg-assist .callout'), 'gap') ?? '']!;
    expect(gap + SP[v ?? '']!).toBeGreaterThanOrEqual(2 * itemGap);
  });
});

describe('a task list nests and finishes item by item', () => {
  const box = ".msg-assist .task-list-item input[type='checkbox']";

  it('an item is a block with its box hung in the padding, never a flex row', () => {
    // Review 2026-10-20, S1: as a flex row, a nested task list stood as a
    // column to the RIGHT of its parent's label, and at 390px squeezed it
    // until 'unchecked' broke mid-word.
    for (const d of declaredOrNone(prose, '.msg-assist .task-list-item', 'display')) {
      expect(d, '.task-list-item display').not.toMatch(/flex|grid/);
    }
    expect(named('.msg-assist .task-list-item', 'padding-left')).toBe('calc(15px + var(--sp-2))');
    expect(named('.msg-assist .task-list-item', 'position')).toBe('relative');
    expect(named(box, 'position')).toBe('absolute');
    expect(named(box, 'width')).toBe('15px');
  });

  it("an item is done by its OWN box, not by a checked descendant's", () => {
    // Review 2026-10-20, S1: `:has(input:checked)` matched a checked
    // grandchild and struck the unchecked parent through.
    const struck = allRules(prose).filter((r) => /line-through/.test(declValue(r.body, 'text-decoration') ?? ''));
    expect(struck.length).toBeGreaterThan(0);
    const args: string[] = [];
    for (const r of struck) {
      for (const sel of r.selectors) {
        const has = /:has\(([^()]*(?:\([^()]*\))?[^()]*)\)/.exec(sel);
        expect(has, sel).not.toBeNull();
        for (const arg of splitList(has![1]!)) {
          expect(arg, sel).toMatch(/^>/);
          args.push(arg);
        }
      }
    }
    // Review 2026-10-20, S2: and BOTH shapes the item's own box comes in. A
    // tight item holds it as a child; a loose one (blank lines between items)
    // holds it in its first paragraph, where mdast-util-to-hast puts it. With
    // only the first arm, every done item of a loose list stayed undimmed and
    // unstruck — and the `>` check above passed it.
    expect(args, 'tight: the box is the item\'s child').toContain(normSel('> input:checked'));
    expect(args, 'loose: the box opens the item\'s first paragraph')
      .toContain(normSel('> p:first-child > input:checked'));
  });

  it("a done item's strike stops at its sublist", () => {
    // A text decoration propagates into every in-flow descendant and cannot
    // be taken off by one — except an atomic inline, which it never enters.
    const sel = '.msg-assist .task-list-item > :is(ul, ol)';
    expect(named(sel, 'display')).toBe('inline-grid');
    expect(named(sel, 'width')).toBe('100%');
    // and it outranks the shared list rule's `display: grid`
    expect(cmp(specificity(sel), specificity('.msg-assist ul'))).toBeGreaterThan(0);
  });
});
