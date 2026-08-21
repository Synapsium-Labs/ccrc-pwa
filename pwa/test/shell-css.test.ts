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
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { atBlock, declValue, ruleIn } from './cssRule';

const shellCss = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'styles', 'shell.css'), 'utf8');

/** The desktop half only. Both `.shell-detail` and `.shell-detail .chat` exist
 *  ONLY inside the breakpoint — asserting against the whole file would let a
 *  future mobile rule of the same name satisfy a desktop assertion. */
const desktop = atBlock(shellCss, '@media (min-width: 900px)');

describe('the desktop detail pane scrolls by default (D-161)', () => {
  it('gives .shell-detail a scroll region of its own', () => {
    const rule = ruleIn(desktop, '.shell-detail');
    expect(declValue(rule, 'overflow-y')).toBe('auto');
    // The regression, spelled out: `overflow: hidden` here is what clipped four
    // screens at the fold. The shorthand must not come back — it would set
    // BOTH axes and silently defeat the `overflow-y` above by source order.
    expect(declValue(rule, 'overflow')).toBeNull();
  });

  it('names the chat as the exception — it keeps owning its own scrolling', () => {
    // .chat is a column flex whose `.chat-body` is the `flex: 1; min-height: 0`
    // scroll region and whose `.composer` is `flex: none` (session/chat.css), so
    // `height: 100%` + this is what keeps the composer pinned to the pane's
    // bottom edge and stops the pane growing a SECOND scrollbar outside it.
    expect(declValue(ruleIn(desktop, '.shell-detail .chat'), 'overflow')).toBe('hidden');
    expect(declValue(ruleIn(desktop, '.shell-detail .chat'), 'height')).toBe('100%');
  });

  it('clips horizontally rather than gaining a sideways scrollbar', () => {
    // Not decoration: with `overflow-y: auto` and overflow-x left at its
    // initial `visible`, the cascade computes `visible` to `auto` (CSS Overflow
    // 3 — the two axes cannot disagree that way), so one wide child would give
    // the pane a horizontal scrollbar the old `overflow: hidden` used to clip.
    // `.shell-nav` above it already made this exact call.
    expect(declValue(ruleIn(desktop, '.shell-detail'), 'overflow-x')).toBe('clip');
  });

  it('keeps the two sizing floors the grid needs', () => {
    // Load-bearing, and unrelated to the scroll fix: a grid item's default
    // min-width/min-height is auto/min-content, which refuses to shrink below
    // its content — that is what put a 65px horizontal scroll in the sibling
    // pane (see .shell-nav's own comment).
    const rule = ruleIn(desktop, '.shell-detail');
    expect(declValue(rule, 'min-height')).toBe('0');
    expect(declValue(rule, 'min-width')).toBe('0');
  });
});
