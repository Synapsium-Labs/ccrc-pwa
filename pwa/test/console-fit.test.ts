// The search behind "the glass meets the window".
//
// A tmux client narrower than its window is a VIEWPORT that tmux pans to follow
// the cursor, so a line's beginning slides off to the left while its owner
// types. The window cannot be narrowed to meet the glass (a width change
// reflows stored lines, and the reflow is destructive at this fleet's
// `history-limit`), so the type shrinks until the window fits. It stops at a
// floor, and where even the floor cannot fit the window the console stays at
// its base size, as it is on `main`, and is reported clipped.
//
// Everything here is the decision alone. `colsAt` stands in for the terminal's
// own measurement (`FitAddon.proposeDimensions` at a type size), so no xterm
// and no DOM are involved.
import { describe, expect, it } from 'vitest';
import {
  BASE_CONSOLE_FONT_PX, consoleFit, MIN_CONSOLE_FONT_PX,
} from '../src/session/consoleFit';

/** A glass `box` type-size units wide: it shows `floor(box / px)` columns at
 *  `px`, as a monospace face does. Records every size it is asked about. */
const glass = (box: number, quirk?: (px: number, cols: number) => number) => {
  const asked: number[] = [];
  const colsAt = (px: number): number => {
    asked.push(px);
    const cols = Math.floor(box / px);
    return quirk ? quirk(px, cols) : cols;
  };
  return { colsAt, asked };
};

describe('the type size that fits a whole window on the glass', () => {
  it('keeps the base size on a glass that already shows the window, and measures nothing else', () => {
    // ROOM TO SPARE IS NOT A REASON TO SWELL. A glass with room for 300
    // columns keeps the base size rather than growing type to fill it.
    const wide = glass(300 * 14);
    expect(consoleFit(wide.colsAt, 220)).toEqual({ fontSize: BASE_CONSOLE_FONT_PX, clipped: false });
    expect(wide.asked).toEqual([BASE_CONSOLE_FONT_PX]);
    const exact = glass(220 * 14);
    expect(consoleFit(exact.colsAt, 220), 'exactly wide enough was treated as too narrow')
      .toEqual({ fontSize: BASE_CONSOLE_FONT_PX, clipped: false });
  });

  it('shrinks in proportion, and finds it with one measurement in the ordinary case', () => {
    // 185 columns at 14px; 220 need 14 x 185/220 = 11.77, which rounds DOWN to
    // 11.7. Rounded up, 11.8 shows 219 here and would cost a second
    // measurement to step back from. Every measurement re-renders the live
    // terminal, so the guess is made to land first time.
    const g = glass(185 * 14);
    expect(consoleFit(g.colsAt, 220)).toEqual({ fontSize: 11.7, clipped: false });
    expect(g.asked, 'the ordinary case took more than one guess').toEqual([14, 11.7]);
    expect(Math.floor((185 * 14) / 11.8), 'the case no longer tells the two roundings apart')
      .toBeLessThan(220);
  });

  it('steps down when the measured grid is short of the guess', () => {
    // xterm rounds its cell width, so at some widths a size shows a column
    // fewer than the straight line predicts. A client one column narrower
    // than the window is panned by one column, with nothing on screen to say
    // so. The measurement decides, not the line.
    const g = glass(2930, (px, cols) => (px === 13.3 ? cols - 1 : cols));
    expect(consoleFit(g.colsAt, 220)).toEqual({ fontSize: 13.2, clipped: false });
    expect(g.asked).toEqual([14, 13.3, 13.2]);
  });

  it('tries the floor when the line puts it just out of reach, and takes it if it fits', () => {
    // 172 columns at 14px: the straight line says 10.9, under the floor. But
    // the line starts from a column count that was rounded down, and at 11px
    // this glass shows exactly 220. That is a fit, not a clip.
    const g = glass(2420.5);
    expect(consoleFit(g.colsAt, 220)).toEqual({ fontSize: MIN_CONSOLE_FONT_PX, clipped: false });
    expect(g.asked).toEqual([14, MIN_CONSOLE_FONT_PX]);
  });

  it('stays at the BASE size, reported clipped, when even the floor cannot show the window', () => {
    // Just short: 171 columns at 14px is close enough that the floor is worth
    // measuring, and it shows 218. Shrinking would buy smaller type and tmux
    // would pan anyway, so the console stays at the base size, which is the
    // console `main` has always shown.
    const near = glass(171 * 14 + 5);
    expect(consoleFit(near.colsAt, 220)).toEqual({ fontSize: BASE_CONSOLE_FONT_PX, clipped: true });
    expect(near.asked).toEqual([14, MIN_CONSOLE_FONT_PX]);
  });

  it('does not measure the floor on a glass nowhere near the window, like a phone', () => {
    // 48 columns at 14px would be about 61 at the floor, against 220. No
    // rounding closes that, so the floor is not measured: each measurement
    // re-renders the live terminal, and on a phone the fit runs on every
    // keyboard and zoom event.
    const phone = glass(48 * 14 + 5);
    expect(consoleFit(phone.colsAt, 220)).toEqual({ fontSize: BASE_CONSOLE_FONT_PX, clipped: true });
    expect(phone.asked).toEqual([BASE_CONSOLE_FONT_PX]);
  });

  it('never measures below the floor', () => {
    // Every size short of the window, so the search walks all the way down.
    const g = glass(180 * 14, (_px, cols) => Math.min(cols, 219));
    expect(consoleFit(g.colsAt, 220)).toEqual({ fontSize: BASE_CONSOLE_FONT_PX, clipped: true });
    expect(Math.min(...g.asked), 'the search measured a size under the floor')
      .toBe(MIN_CONSOLE_FONT_PX);
  });

  it('answers null for a glass it cannot measure, which is not "it fits"', () => {
    // A host with no layout yet cannot be measured. Read as "already wide
    // enough" it would leave the grid at whatever a fresh terminal guesses,
    // and read as a ratio it would dial a one-column terminal as the sheet
    // mounts. The caller keeps the grid it has.
    expect(consoleFit(() => null, 220), 'an unmeasured glass was treated as a measurement')
      .toBeNull();
    expect(consoleFit(() => 0, 220)).toBeNull();
    expect(consoleFit(() => Number.NaN, 220)).toBeNull();
    const lostMidway = (px: number): number | null => (px === 14 ? 185 : null);
    expect(consoleFit(lostMidway, 220), 'a measurement lost mid-search answered a size')
      .toBeNull();
    expect(consoleFit(glass(300 * 14).colsAt, 0), 'a window of no width answered a size')
      .toBeNull();
  });

  it('honours the base and floor a caller names, so the constants are not the rule', () => {
    expect(consoleFit(glass(48 * 14).colsAt, 220, 14, 2)?.clipped, 'a caller-set floor was ignored')
      .toBe(false);
    expect(consoleFit(glass(300 * 14).colsAt, 220, 9)?.fontSize, 'a caller-set base was ignored')
      .toBe(9);
  });
});
