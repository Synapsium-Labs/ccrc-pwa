// How large the console's type may be if the whole tmux window is to fit
// across the glass — the arithmetic alone, with no xterm and no DOM in it, so
// the decision can be measured rather than eyeballed against a device.
//
// THE PROBLEM IT ANSWERS. The drawer's terminal is a tmux CLIENT, and a client
// smaller than the window is not a smaller window: it is a viewport into one,
// which tmux pans to follow the cursor. So on any glass narrower than the
// pinned window a line's beginning scrolls off to the left while its owner is
// still typing — the text appears to slide sideways under the cursor.
//
// The window cannot be narrowed to meet the glass: tmux reflows stored lines on
// a width change and the reflow is destructive at this fleet's `history-limit`
// (see `PINNED_WINDOW_COLS`' own docstring for the measurement). So the glass
// meets the window instead, by shrinking its type until the window's full width
// is on screen.
//
// AND IT STOPS SHRINKING. A phone is far too narrow for 220 columns at any size
// a person can read: 390 CSS px over 220 columns is 1.77 px per character. Past
// the floor this module gives up and says so, and the pane goes back to being
// what it is on `main` — a viewport tmux pans. That is deliberately the OLD
// behaviour rather than a third one: widening the host and letting the reader
// scroll it sideways was tried, and it costs the cursor. A terminal container
// does not follow a caret it cannot see, so typing past the visible edge writes
// off-screen — better for reading a line, worse for entering one, and the
// drawer is used for both. Shrinking type helps everywhere it can and gets out
// of the way where it cannot.

/**
 * The smallest type this console will render, in CSS pixels.
 *
 * DERIVED FROM THE APP'S OWN SCALE, not chosen. `--text-2xs: 11px` is the
 * smallest size anything in this product renders TEXT at — the tokens below it
 * stop at a 9px count badge, which is a glyph, not a thing anyone reads. A
 * console that went under the floor of its own type scale would be asking to be
 * read at a size the rest of the app has already decided is not reading.
 *
 * It was 8px for one revision and that was measured wrong by the person using
 * it: on a window narrower than about three quarters of the screen the console
 * became a smear. The number now has a source instead of a feeling.
 */
export const MIN_CONSOLE_FONT_PX = 11;

/** The size the console renders at when nothing has to be given up for width —
 *  the ceiling of the fit as well as its starting point, so a glass with room
 *  to spare does not swell the type to fill it. */
export const BASE_CONSOLE_FONT_PX = 14;

/** What the glass should do to show `wantCols` columns. */
export interface ConsoleFit {
  /** The type size to render at, in CSS pixels. */
  fontSize: number;
  /**
   * Whether the window STILL does not fit, even at the floor.
   *
   * A separate fact from the size, and not derivable from it by the caller
   * without repeating this rule: it is true exactly when the floor stopped the
   * shrink before the window fitted. Then the pane is a viewport tmux pans, as
   * it is on `main`, and the only thing left to do about it is SAY so — a
   * reader who can see why their lines begin off-screen is in a different
   * position from one watching text slide sideways for no stated reason.
   */
  clipped: boolean;
}

/**
 * Round DOWN, to a tenth of a pixel.
 *
 * The direction is load-bearing and the reason is that columns and type size
 * are inversely proportional: a size rounded UP fits FEWER columns than asked
 * for, which is the exact condition — client narrower than window — this whole
 * module exists to remove. Rounding down overshoots by a fraction of a column
 * instead, and a client a little WIDER than the window costs nothing: tmux
 * leaves the margin blank and pans nothing.
 */
const downTo = (px: number): number => Math.floor(px * 10) / 10;

/**
 * The type size at which `wantCols` columns fit the glass that currently shows
 * `measuredCols` at `atFontSize`.
 *
 * Returns **null** when the glass cannot be measured — a host with no layout
 * yet, or a terminal that has not opened. That is NOT "it already fits": the
 * caller must keep the grid it has rather than resize to a guess, and folding
 * the two into one answer is how a drawer ends up dialling a one-column
 * terminal at the moment a sheet mounts.
 */
export function consoleFit(
  measuredCols: number,
  atFontSize: number,
  wantCols: number,
  base: number = BASE_CONSOLE_FONT_PX,
  floor: number = MIN_CONSOLE_FONT_PX,
): ConsoleFit | null {
  if (!Number.isFinite(measuredCols) || measuredCols <= 0) return null;
  if (!Number.isFinite(atFontSize) || atFontSize <= 0) return null;
  if (!Number.isFinite(wantCols) || wantCols <= 0) return null;
  const ideal = downTo((atFontSize * measuredCols) / wantCols);
  // CLAMPED AT BOTH ENDS, AND THE TOP ONE IS NOT DECORATION. Without it a
  // glass with room to spare would swell the console to fill it — 30px type on
  // a wide desktop. With it, `ideal` above the base simply means "there is
  // room", and the answer is the base: which is also how a drawer that shrank
  // for a phone GROWS BACK when the same session is opened on a desktop. An
  // earlier revision returned `atFontSize` untouched whenever the window
  // already fitted, and that was a ratchet — measured: once shrunk to the
  // floor it stayed there however wide the glass became.
  if (ideal >= base) return { fontSize: base, clipped: false };
  return ideal >= floor
    ? { fontSize: ideal, clipped: false }
    : { fontSize: floor, clipped: true };
}
