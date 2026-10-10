// ControlRow — a mono status line with its own control, and it wraps.
//
// THREE RULES, BYTE-IDENTICAL except for one `position`. `.coord-banner`
// (the fleet's pause switch), `.child-reclaim-banner` (the reclaim switch) and
// `.caps-control` (the dispatch dial) each declared the same twelve: a wrapping
// flex row, a tap floor, `--sp-1`/`--sp-3` padding, an `--edge-subtle`
// hairline at `--r-md`, and `--fs-xs` mono at normal leading. Three features,
// one shape, and each copy written out in full.
//
// IT OWNS THE SHAPE, NOT THE SKIN — CollapsibleStrip's rule, applied for a
// reason sharper than consistency. Each of these three rows is SELF-GROUNDED
// on purpose: it declares its own `background` AND `color` so that
// `design/audit.mjs` can recover a ground for its descendants. Nine rules
// depend on that — `.coord-banner .coord-glyph`, `.child-reclaim-who`,
// `.caps-usage` and six more are measured pairs ONLY because their ancestor
// paints. Move the ground into this component as a utility and all nine fall
// into `hosts.size === 0` and out of the measured set — 108 checks across the
// twelve palettes, gone, with every gate still printing ALL PASS. That is the
// exact failure `.pr-body-preview` taught this repo at 2.44 in light.
//
// So the ground stays in the consumer's stylesheet, as two declarations with
// nothing else beside them, and everything that is NOT the ground lives here.
// Ten of the twelve declarations deduplicate; the two that carry a measurement
// do not move. `fleet-css.test.ts` already pins all three as self-grounded in
// both directions, so the split is held by a test that predates it.
//
// NOT A `Banner`. banner.tsx says it in its own words — its tones are
// `dead` and `attention`, it is `--fs-sm` UI type on a tinted ground, and it
// carries a trailing action in a sentence. This is the quiet instrument panel
// underneath: mono, `--fs-xs`, no tone axis at all, and its "action" is an
// inline control the row wraps around rather than a button pinned to the end.
// A tone axis with one quiet value would be a variant that never varies.
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** The shape, token for token as all three rules declared it — minus the two
 *  that ground the audit.
 *
 *  `not-italic normal-nums` because the rules used the `font:` SHORTHAND,
 *  which resets `font-style` and `font-variant-numeric` on its way past.
 *  Separate utilities do not, so dropping them would be a silent change to
 *  every row that renders a number — and two of the three do. */
export const CONTROL_ROW =
  'flex flex-wrap items-center gap-2 min-h-tap px-3 py-1'
  + ' rounded-md border border-edge-subtle'
  + ' font-mono text-xs font-regular leading-normal not-italic normal-nums';

/** The line a control row WRAPS ONTO — an error, or a note about a write
 *  whose answer could not be read.
 *
 *  `.coord-banner .coord-error` and `.caps-control .caps-note` declared these
 *  three identically, and `.child-reclaim-banner .child-reclaim-error` two of
 *  the three. All three live inside a `<ControlRow>`, which is why this sits
 *  here rather than in a file of its own: `basis-full` is meaningless outside
 *  a wrapping flex row, and the row is the only thing that supplies one.
 *
 *  The INK is not here, deliberately. Two of the three are `--status-dead-text`
 *  and the third is `--ink-secondary` — a refusal is louder than a note — and
 *  each is what `design/audit.mjs` measures that rule through. */
export const CONTROL_ROW_NOTE = 'basis-full m-0 text-2xs';

export interface ControlRowProps extends HTMLAttributes<HTMLDivElement> {
  /** The hook class, always. Every consumer keeps the class its own
   *  stylesheet grounds it through and its tests select on — passing none
   *  would render an ungrounded row, which is the one thing this component
   *  cannot supply for itself. */
  className: string;
  children: ReactNode;
}

export function ControlRow({ className, children, ...props }: ControlRowProps): ReactNode {
  return <div className={cn(CONTROL_ROW, className)} {...props}>{children}</div>;
}
