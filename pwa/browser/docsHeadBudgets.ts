// The Docs head's pixel budgets, one copy for the browser files that assert them (native Docs reader, the phone-header and
// library 1.1 take-up plans, and the reader-mode plan's Task XR1.5, spec 2026-11-20 4.6): `docs-compact-head.browser.test.ts`
// measures the head under every state, and `reader-mode-head.browser.test.ts` measures it with Reader mode drawn. Both import
// these, so a budget changes in one place.

/** The option 2 mockup's trimmed figure: the one bar and its gap, 48, and the frame's root trimmed to 8 px (prediction 56);
 *  the title's top is at most this far below the page's top (the bar, the gap and the frame's own top margin). */
export const ONE_BAR_TITLE_MAX = 61;

/** The console's part above the frame on a phone: the one bar and the gap under it. */
export const CONSOLE_PART_MAX = 48;

/** The floor every control on the row reaches (`--tap-min`). */
export const TAP = 44;

/** The head itself, from the top of `.docs-head` to the bottom of the truth line, under a mouse at 1280: the row (one tap),
 *  the 4 px gap and the dense line (28 px) is 76. */
export const HEAD_MAX = 80;
