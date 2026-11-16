// How large the console's type may be if the whole tmux window is to fit
// across the glass. This is the search alone: the terminal's own measurement
// comes in as a function, so the decision can be tested without xterm or a DOM.
//
// WHAT IT DECIDES (D-5005, spec 2026-10-14 §5.2). The drawer's terminal is a
// tmux client pinned at the window's own size, 220 columns by 50 rows plus
// tmux's status row, so whatever the glass, tmux has nothing to pan and
// nothing to fill. The glass changes only the type size and the view, and this
// search answers both: where the window's 220 columns fit at the floor or
// above, the drawer shows the GRID, the terminal itself, at the size found
// here; where they do not, it shows the WRAPPED view, the same screen
// re-wrapped to the glass as text (`wrapScreen`). `chooseView` reads the
// verdict, and the view chip can overrule it.
//
// The window cannot be narrowed to meet the glass: tmux reflows stored lines on
// a width change and the reflow is destructive at this fleet's `history-limit`
// (see `PINNED_WINDOW_COLS`' own docstring for the measurement). So the glass
// meets the window instead, by shrinking its type until the window's full width
// is on screen.
//
// AND WHERE IT CANNOT, IT DOES NOT SHRINK. A phone is far too narrow for 220
// columns at any size a person can read: 390 CSS px over 220 columns is 1.77 px
// per character. If even the floor cannot fit the window, the answer is the
// base size, `clipped`, and the drawer shows the wrapped view; the terminal
// stays at the base size off-screen, where it still takes the keyboard.
// Sideways scrolling is never the default answer: an earlier revision widened
// the host and let the reader scroll it, and was withdrawn because a terminal
// container does not follow a caret it cannot see, so typing past the visible
// edge wrote off-screen. Only a grid the reader forces with the chip on a glass
// it does not fit scrolls sideways, in the browser, and its chip says so
// (`grid · scrolls`).

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
   * show it. The size is then the base size, and the drawer shows the wrapped
   * view unless the view chip forced the grid (D-5005).
   *
   * The drawer reads its view from this flag, not from the terminal's grid:
   * the grid is pinned at the window's 220 columns whatever the glass shows,
   * so it says nothing about the fit. The flag is a measured verdict: the
   * search answers "fits" only for a size whose grid it measured at
   * `wantCols` or more.
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
 * no layout yet. That is NOT "it already fits". The caller must keep the type
 * size and the view it has rather than act on a guess (`chooseView`'s `null`
 * arm).
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
