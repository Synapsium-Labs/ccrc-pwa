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

/** THE GROUND A ROW LIFTS TO AND SINKS TO (D-5101): `--bg-hover` under the
 *  mouse, `--bg-pressed` while held. `enabled:` on both, because a disabled
 *  row neither lifts nor sinks; `hover:` is gated on `(hover: hover)` by
 *  Tailwind v4, so a phone never sticks on it. One constant because
 *  `ListRow` and `BareRow` both carry it, and a sentence spelled in two files
 *  drifts (`literal-census.test.ts`). The ghost and quiet buttons spell the
 *  same two utilities inside their cva variants; the danger-ghost takes this
 *  constant on its default `card` ground (D-5688). */
export const PRESS_GROUND = 'enabled:hover:bg-hover enabled:active:bg-pressed';

/** THE MOTION BEHIND THAT GROUND (D-5101, Task 9 Step 4): `transform` at
 *  `--dur-press`, as every press moves, and `background-color` at `--dur-fast`,
 *  the one per-skin duration — 180ms in Refined, 120ms in Instrument
 *  (skins.css) — so a row lifting under the mouse fades rather than snaps.
 *  `PRESS_FEEDBACK`'s shape with `background-color` where it has `color`.
 *
 *  ONE CLASS, NEVER BESIDE ANOTHER TRANSITION UTILITY. The shorthand and a
 *  `transition-transform` / `duration-press` would race in the cascade, and
 *  `cn` cannot dedupe them (it does not know the custom `duration-press`), so
 *  every carrier wears this INSTEAD of `PRESS_TRANSFORM`: `ListRow`, `BareRow`
 *  and the `Button` base (`hover-states.test.ts` reds a rival). */
export const GROUND_MOTION =
  '[transition:transform_var(--dur-press)_var(--curve-swift),background-color_var(--dur-fast)_var(--curve-swift)]'
  + ' motion-reduce:transition-none';
