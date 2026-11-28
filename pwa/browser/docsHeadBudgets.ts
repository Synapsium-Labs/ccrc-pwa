// The Docs head's pixel budgets, one copy for the browser files that assert them (native Docs reader, the phone-header and
// library 1.1 take-up plans, and the reader-mode plan's Task XR1.5, spec 2026-11-20 4.6): `docs-compact-head.browser.test.ts`
// measures the head under every state, and `reader-mode-head.browser.test.ts` measures it with Reader mode drawn. Both import
// these, so a budget changes in one place.

import type { ReaderLayout } from '../../shared/docs';

/** The one bar's title budget, per layout, the one owner of the number (D-9177): the title's top is at most this far below the page's
 *  top (the bar, the gap and the frame's own top margin). The default's 61 sits 5 px above its measured 56 (the option 2 mockup's
 *  prediction, the one bar and its gap, 48, and the frame's root trimmed to 8 px, plus 5); `review` (measured 80.5) and `guided`
 *  (measured 65.8) take the same 5 px margin over their own measure, rounded up, so a later change that pushes either title lower still
 *  reds. The console's own part (`CONSOLE_PART_MAX`, the bar, `TAP`) is unchanged in every layout: only the frame's own title block
 *  differs. */
export const ONE_BAR_TITLE_MAX_BY_LAYOUT: Readonly<Record<ReaderLayout, number>> = Object.freeze({
  default: 61, classic: 61, editorial: 61, review: 86, guided: 71,
});

/** The default layout's entry of `ONE_BAR_TITLE_MAX_BY_LAYOUT`, for the browser files that measure the default layout alone. */
export const ONE_BAR_TITLE_MAX = ONE_BAR_TITLE_MAX_BY_LAYOUT.default;

/** The console's part above the frame on a phone: the one bar and the gap under it. */
export const CONSOLE_PART_MAX = 48;

/** The floor every control on the row reaches (`--tap-min`). */
export const TAP = 44;

/** The head itself, from the top of `.docs-head` to the bottom of the truth line, under a mouse at 1280: the row (one tap),
 *  the 4 px gap and the dense line (28 px) is 76. */
export const HEAD_MAX = 80;
