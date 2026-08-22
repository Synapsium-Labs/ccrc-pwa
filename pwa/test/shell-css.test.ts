// The app shell's stylesheet, read as TEXT — the only thing that can assert a
// rule in this suite (vitest runs with `css: false`, so jsdom evaluates no
// stylesheet at all and `getComputedStyle` reports nothing any rule set). The
// idiom, its limits and the shared reader live in `test/cssRule.ts`;
// `fleet-css.test.ts` and `pr-keycap-css.test.ts` are the siblings.
//
// D-161: EVERY DEFECT PINNED HERE WAS MEASURED ON A DESKTOP BROWSER, and the
// worst of them was total. `@media (min-width: 900px)` gave `.shell-detail`
// `overflow: hidden` so the chat could own its own internal scrolling, and
// then only `.chat` was ever given a scroll region — so `/accounts`,
// `/archive`, `/mail` and `/runs`, which render into the SAME detail pane,
// were clipped at the fold with no way to reach anything below it. The passkey
// enrolment button was literally unreachable on a laptop while working fine on
// a phone (the mobile layout has no containment). The fix inverts the default:
// the pane scrolls, and the chat's self-management is the NAMED exception.
//
// D-161 fix round: THESE ASSERT THE BEHAVIOUR, NOT THE SPELLING. The first
// version of this file read one rule and pinned literal tokens, and both
// halves were measured wrong:
//   - a second `.shell-detail { overflow: hidden }` later in the same block,
//     or a higher-specificity `.app-shell .shell-detail`, put the exact
//     regression back with all four tests green (three mutants, all green);
//   - `overflow: clip auto` — the same declaration, and what the build's own
//     minifier emits into the bundle — turned three of the four red.
// So every assertion below goes through `declaredValues`, which collects EVERY
// rule targeting the element and expands the shorthand, and asserts a
// CONTRACT ("this axis scrolls", "this axis never scrolls") that any correct
// spelling satisfies and no rule in this stylesheet may contradict.
//
// D-161 honesty pass: that fix was measured on three mutants and narrowed the
// hole rather than closing it — the re-review found two more shapes that put
// the regression back with all five tests green, and both are now red. A
// top-level `.shell-detail { overflow: hidden }` AFTER the @media block (the
// contract was read from the block, not the file — see `values` below), and
// `section.shell-detail { overflow: hidden }` INSIDE it (the reader compared
// compound selectors by string prefix, so an element-qualified restatement —
// which outranks the original on specificity from any position — read as a
// stranger; cssRule.ts's `simples` is the fix). What is still NOT covered is
// enumerated at `declaredValues` in cssRule.ts, and this file's claims are
// scoped to it: no rule shape outside that list, and no other stylesheet.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { atBlock, declaredValues } from './cssRule';

const shellCss = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'styles', 'shell.css'), 'utf8');

/** The desktop breakpoint, READ OUT OF THE STYLESHEET rather than spelled
 *  here. Keyed on a literal, a breakpoint edit failed every test below with
 *  `no at-rule for @media (min-width: 900px)` — a symptom, not a diagnosis.
 *  Now the block follows the stylesheet and the agreement between the three
 *  places the number lives is its own assertion (below). */
const BREAKPOINT = ((): number => {
  const m = /@media\s*\(min-width:\s*([\d.]+)px\)/.exec(shellCss);
  expect(m, 'shell.css has no min-width breakpoint at all').not.toBeNull();
  return Number(m![1]);
})();

/** The desktop half. Both `.shell-detail` and `.shell-detail .chat` get their
 *  scroll rules ONLY inside the breakpoint, so this is where the assertion
 *  "the pane really is declared scrollable on desktop" has to be made — a
 *  future mobile-only `overflow-y: auto` must not satisfy it. */
const desktop = atBlock(shellCss, `@media (min-width: ${BREAKPOINT}px)`);

/** An axis with a scrollbar of its own. */
const SCROLLS = new Set(['auto', 'scroll']);

/** An axis that neither scrolls nor spills. `clip` and `hidden` are the SAME
 *  computed value in these rules and the distinction is not available here:
 *  next to a scrolling axis the platform demotes `clip` to `hidden` (measured
 *  in Chromium against the shipped bundle — `getComputedStyle` reports
 *  `hidden`, and a child 2400px to the right still scrolls into view on
 *  focus). Both spellings satisfy the contract; `visible`, `auto` and `scroll`
 *  do not. */
const CONTAINS = new Set(['hidden', 'clip']);

/** Every value ANY rule in the whole stylesheet gives `sel` for `prop` — plus
 *  the assertion that the desktop block is one of the places that sets it.
 *
 *  Two different questions, and the first fix round only asked one of them.
 *  Scoped to `desktop`, an empty list makes every `for` below vacuously true,
 *  which is how a deleted declaration passes — hence the non-empty assertion.
 *  But scoping the CONTRACT there too was itself a bypass: a top-level
 *  `.shell-detail { overflow: hidden }` appended AFTER the `@media` block is
 *  the same specificity, later in source, and `@media` adds none, so it wins at
 *  exactly the widths this file is about. Measured on the fix that closed the
 *  three mutants above: that one appended rule left this file at 5 passed while
 *  Chromium (1440px, the shipped sheet) reported `overflow-y: hidden`,
 *  scrollHeight 3000 against clientHeight 300 — the D-161 regression, verbatim.
 *
 *  So: the FLOOR is read from the desktop block (it must be declared there),
 *  and the CONTRACT is read over the file (no rule anywhere may contradict it).
 *  Whole-file is safe for these three selectors because the only other rule
 *  that targets any of them is the mobile `display: none`, which declares no
 *  overflow and no sizing floor; cssRule.ts's {@link declaredValues} lists what
 *  even a whole-file read cannot see. */
const values = (sel: string, prop: string): string[] => {
  const onDesktop = declaredValues(desktop, sel, prop);
  expect(onDesktop, `nothing sets ${prop} on ${sel} inside the desktop block`).not.toEqual([]);
  return declaredValues(shellCss, sel, prop);
};

describe('the desktop detail pane scrolls by default (D-161)', () => {
  it('gives .shell-detail a scroll region of its own, and no rule takes it back', () => {
    // The regression, spelled as a contract: `overflow: hidden` here is what
    // clipped four screens at the fold. It fails this whether it arrives as
    // the shorthand, as `overflow-y`, in this rule or in a later one.
    for (const v of values('.shell-detail', 'overflow-y')) {
      expect(SCROLLS.has(v), `overflow-y: ${v} does not scroll`).toBe(true);
    }
  });

  it('never scrolls SIDEWAYS, however that is spelled', () => {
    // Not decoration: with `overflow-y: auto` and overflow-x left at its
    // initial `visible`, the cascade computes `visible` to `auto` (CSS Overflow
    // 3 — the two axes cannot disagree that way), so one wide child would give
    // the pane a horizontal scrollbar the old `overflow: hidden` used to
    // prevent. `.shell-nav` above it already made this exact call
    // (fleet-css.test.ts pins that one).
    for (const v of values('.shell-detail', 'overflow-x')) {
      expect(CONTAINS.has(v), `overflow-x: ${v} lets the pane scroll sideways`).toBe(true);
    }
  });

  it('names the chat as the exception — it keeps owning its own scrolling', () => {
    // .chat is a column flex whose `.chat-body` is the `flex: 1; min-height: 0`
    // scroll region and whose `.composer` is `flex: none` (session/chat.css), so
    // `height: 100%` + no scrolling of its own is what keeps the composer pinned
    // to the pane's bottom edge and stops the pane growing a SECOND scrollbar
    // outside the first.
    for (const axis of ['overflow-x', 'overflow-y'] as const) {
      for (const v of values('.shell-detail .chat', axis)) {
        expect(CONTAINS.has(v), `${axis}: ${v} would be a second scrollbar`).toBe(true);
      }
    }
    // Every declared value, not the winner: `effectiveValue` reads last-in-source,
    // which is not the cascade (cssRule.ts states why), so a rule that raised
    // this height from anywhere in the file would satisfy a winner-only read.
    for (const v of values('.shell-detail .chat', 'height')) expect(v, 'height').toBe('100%');
  });

  it('the breakpoint is the SAME number in all three places it is written', () => {
    // The number lives in three files and none of them can derive it from
    // another: the desktop block, the mobile block's complement, and app.tsx's
    // `useMediaQuery`, which decides whether the sidebar is rendered AT ALL.
    // Move one and you get a dead band — a 900 → 901 edit in the stylesheet
    // alone leaves nothing matching at exactly 900px while the JS still reports
    // desktop (seen for real in this worktree during the D-161 review). This is
    // the ledger that says they must move together.
    expect(shellCss).toContain(`@media (max-width: ${BREAKPOINT - 0.02}px)`);
    const appTsx = readFileSync(
      path.join(import.meta.dirname, '..', 'src', 'app.tsx'), 'utf8');
    expect(appTsx).toContain(`useMediaQuery('(min-width: ${BREAKPOINT}px)')`);
  });

  it('keeps the two sizing floors the grid needs', () => {
    // Load-bearing, and unrelated to the scroll fix: a grid item's default
    // min-width/min-height is auto/min-content, which refuses to shrink below
    // its content — that is what put a 65px horizontal scroll in the sibling
    // pane (see .shell-nav's own comment). Every value, not just the winner: a
    // later rule raising either floor re-breaks the pane it fixed.
    for (const prop of ['min-height', 'min-width'] as const) {
      for (const v of values('.shell-detail', prop)) expect(v, prop).toBe('0');
    }
  });
});
