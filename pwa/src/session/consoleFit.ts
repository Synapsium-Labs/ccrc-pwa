// How large the console's type may be if the whole tmux window is to fit
// across the glass. This is the search alone: the terminal's own measurement
// comes in as a function, so the decision can be tested without xterm or a DOM.
//
// THE PROBLEM IT ANSWERS. The drawer's terminal is a tmux CLIENT, and a client
// smaller than the window is not a smaller window: it is a viewport into one,
// which tmux pans to follow the cursor. So on any glass narrower than the
// pinned window a line's beginning scrolls off to the left while its owner is
// still typing, and the text appears to slide sideways under the cursor.
//
// The window cannot be narrowed to meet the glass: tmux reflows stored lines on
// a width change and the reflow is destructive at this fleet's `history-limit`
// (see `PINNED_WINDOW_COLS`' own docstring for the measurement). So the glass
// meets the window instead, by shrinking its type until the window's full width
// is on screen.
//
// AND WHERE IT CANNOT, IT DOES NOTHING. A phone is far too narrow for 220
// columns at any size a person can read: 390 CSS px over 220 columns is 1.77 px
// per character. If even the floor cannot fit the window, shrinking the type
// would make it harder to read and tmux would pan anyway, so the console stays
// at its base size, which is the console `main` shows. The caller reports the
// clip. The other answer, widening the host and letting the reader scroll it
// sideways, was tried and withdrawn: a terminal container does not follow a
// caret it cannot see, so typing past the visible edge writes off-screen.

/**
 * The smallest type this console will render, in CSS pixels.
 *
 * DERIVED FROM THE APP'S OWN SCALE, not chosen. `--text-2xs: 11px` is the
 * smallest size anything in this product renders TEXT at. The tokens below it
 * stop at a 9px count badge, which is a glyph, not a thing anyone reads. A
 * console that went under the floor of its own type scale would be asking to be
 * read at a size the rest of the app has already decided is not reading.
 *
 * It was 8px for one revision, and the person using it measured that as wrong:
 * on a window narrower than about three quarters of the screen the console
 * became a smear. The number now has a source instead of a feeling.
 */
export const MIN_CONSOLE_FONT_PX = 11;

/** The size the console renders at when nothing has to be given up for width:
 *  the ceiling of the fit as well as its starting point, so a glass with room
 *  to spare does not swell the type to fill it, and the size a glass that
 *  cannot fit the window at all keeps. */
export const BASE_CONSOLE_FONT_PX = 14;

/** What the glass should do to show `wantCols` columns. */
export interface ConsoleFit {
  /** The type size to render at, in CSS pixels. */
  fontSize: number;
  /**
   * Whether the window still does not fit, because even the floor could not
   * show it. The size is then the base size, and the pane is the viewport tmux
   * pans that it is on `main`.
   *
   * The caller should report the clip from the grid the terminal actually
   * settles on rather than from this flag. The two agree whenever the
   * measurement this search was given is the one the terminal fits by.
   */
  clipped: boolean;
}

/**
 * The columns the glass WOULD show at a type size, measured by the terminal
 * itself without resizing it (`FitAddon.proposeDimensions`), or null when it
 * cannot be measured.
 */
export type ColsAt = (px: number) => number | null;

const measured = (cols: number | null): number | null =>
  cols !== null && Number.isFinite(cols) && cols > 0 ? cols : null;

/**
 * The largest type size, in tenths of a pixel, at which the glass shows
 * `wantCols` columns: never above `base`, never below `floor`, and `base` with
 * `clipped` when even `floor` falls short.
 *
 * Returns **null** when the glass cannot be measured, for example a host with
 * no layout yet. That is NOT "it already fits". The caller must keep the grid it
 * has rather than resize to a guess.
 *
 * EVERY ANSWER IS ANCHORED ON THE BASE SIZE. The first measurement is always
 * the base size's column count, never the size the glass happens to be at, so
 * the answer depends on the box alone and asking twice gives the same answer.
 * Earlier revisions computed the next size from the current one, and the answer
 * depended on history: one ratcheted (once shrunk, it never grew back), and one
 * compounded down to the floor on the live console. Even with an exact
 * measurement, starting from the current size can land a tenth away from where
 * the base size lands, so a refit on an unchanged box would re-type the
 * console.
 *
 * THE STRAIGHT LINE ONLY GUESSES; THE MEASUREMENT DECIDES. Columns are close to
 * inversely proportional to the type size, so the first guess is
 * `base x colsAtBase / wantCols`, rounded DOWN to a tenth. That direction
 * matters because a size rounded up shows fewer columns, and then the guess
 * costs a second measurement to step back from. But xterm rounds its cell
 * width, so at some widths a size shows one column fewer than the line
 * predicts, and at others the floor fits a window the line put out of reach.
 * So each guess is measured, and the search steps down a tenth at a time while
 * the measured grid is short.
 */
export function consoleFit(
  colsAt: ColsAt,
  wantCols: number,
  base: number = BASE_CONSOLE_FONT_PX,
  floor: number = MIN_CONSOLE_FONT_PX,
): ConsoleFit | null {
  if (!Number.isFinite(wantCols) || wantCols <= 0) return null;
  const atBase = measured(colsAt(base));
  if (atBase === null) return null;
  // ROOM TO SPARE IS NOT A REASON TO SWELL, and this is also how a console
  // that shrank for one glass grows back on a wider one.
  if (atBase >= wantCols) return { fontSize: base, clipped: false };
  // NOT MEASURED WHERE IT CANNOT MATTER. `atBase` was rounded down, so the
  // glass holds fewer than `atBase + 1` columns at the base size, and a cell
  // scales with the type to within a pixel's rounding across the row. Allow a
  // whole column for each of those. If `atBase + 2` columns, scaled to the
  // floor, still fall short of the window, the floor cannot fit it, and there
  // is no need to measure it. Each measurement at another size re-renders the
  // live terminal, and a phone, which never fits, runs this fit on every
  // keyboard and zoom event.
  if ((atBase + 2) * base < wantCols * floor) return { fontSize: base, clipped: true };
  const floorTenths = Math.ceil(floor * 10);
  const guess = Math.floor((base * atBase * 10) / wantCols);
  for (let tenths = Math.max(guess, floorTenths); tenths >= floorTenths; tenths -= 1) {
    const px = tenths / 10;
    const cols = measured(colsAt(px));
    if (cols === null) return null;
    if (cols >= wantCols) return { fontSize: px, clipped: false };
  }
  return { fontSize: base, clipped: true };
}
