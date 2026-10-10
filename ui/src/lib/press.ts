// The PRESS FEEDBACK a quiet control gives a thumb, owned by the design
// system rather than by each control that wants it.
//
// THREE LINES, TWICE — `BACK_BUTTON` and `DOOR` carried the identical
// arbitrary transition, the identical `motion-reduce` escape and the identical
// active pair, byte for byte. No census on this branch could see it: it is not
// a stylesheet rule, not an element, not a class literal of two words, and not
// a leaf's attribute set. It was found by scanning both packages for repeated
// four-line windows of normalised code.
//
// TWO DURATIONS, ONE CURVE, and that asymmetry is the shape: `transform` moves
// at `--dur-press` because a press must feel immediate, `color` at `--dur-fast`
// because ink catching up a frame later reads as deliberate rather than laggy.
// An arbitrary `[transition:…]` because Tailwind has no utility that sets two
// properties to two durations at once; the alternative is two utilities whose
// second silently replaces the first.
//
// `motion-reduce:transition-none` RIDES WITH IT. A press that respects the
// setting on one control and not another is worse than neither doing it, and
// keeping the two in one string is what makes that impossible to get wrong.
//
// NO FOCUS RING: that is `FOCUS_RING`'s, and a control composes both.
export const PRESS_FEEDBACK =
  '[transition:transform_var(--dur-press)_var(--curve-swift),color_var(--dur-fast)_var(--curve-swift)]'
  + ' motion-reduce:transition-none'
  + ' active:scale-[0.88] active:text-ink-primary';

/** The SINGLE-property press: a transform transition at the press duration,
 *  with the reduced-motion escape beside it.
 *
 *  TWO CONSTANTS, TWO LINES EACH — `KEYCAP` and `LIST_ROW` carried these
 *  verbatim while pressing to two different places (a keycap sinks a pixel, a
 *  row scales to 0.97), so the TRANSITION is shared and the active transform
 *  stays each control's. Distinct from `PRESS_FEEDBACK` above, which also
 *  moves `color` and therefore needs the arbitrary two-duration property.
 *
 *  Found by the literal census: a class string living in a CONSTANT is
 *  invisible to a census that reads `className=` attributes. */
export const PRESS_TRANSFORM =
  'cursor-pointer transition-transform duration-press ease-swift'
  + ' motion-reduce:transition-none';
