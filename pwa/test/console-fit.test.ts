// The arithmetic behind "the glass meets the window".
//
// A tmux client narrower than its window is a VIEWPORT tmux pans to follow the
// cursor, so a line's beginning slides off to the left while its owner types.
// The window cannot be narrowed to meet the glass — a width change reflows
// stored lines and the reflow is destructive at this fleet's `history-limit` —
// so the type shrinks until the window fits, and stops at a floor, below which
// the surface widens and the reader scrolls it themselves.
//
// Everything here is the decision alone: no xterm, no DOM, no device.
import { describe, expect, it } from 'vitest';
import {
  BASE_CONSOLE_FONT_PX, consoleFit, MIN_CONSOLE_FONT_PX,
} from '../src/session/consoleFit';

describe('the type size that fits a whole window on the glass', () => {
  it('leaves a glass that is already wide enough at the base size', () => {
    // ROOM TO SPARE IS NOT A REASON TO SWELL. A desktop with room for 300
    // columns keeps the base size rather than growing type to fill the space.
    expect(consoleFit(300, 14, 220)).toEqual({ fontSize: BASE_CONSOLE_FONT_PX, clipped: false });
    expect(consoleFit(220, 14, 220), 'exactly wide enough was treated as too narrow')
      .toEqual({ fontSize: BASE_CONSOLE_FONT_PX, clipped: false });
  });

  it('GROWS BACK, so a shrink for one glass is not permanent', () => {
    // THE RATCHET THIS REPLACES WAS REAL. An earlier revision returned the
    // size it was given whenever the window already fitted, so a console once
    // shrunk to the floor for a phone stayed at the floor on a desktop — the
    // same session, opened on a wide screen, rendered at 8px forever.
    //
    // 420 columns at 8px is that phone's drawer reopened on a desktop.
    expect(consoleFit(420, MIN_CONSOLE_FONT_PX, 220))
      .toEqual({ fontSize: BASE_CONSOLE_FONT_PX, clipped: false });
  });

  it('shrinks in proportion, because columns and type size are inverse', () => {
    // A wide desktop shows ~185 columns at 14px; 220 need 14 x 185/220.
    expect(consoleFit(185, 14, 220)).toEqual({ fontSize: 11.7, clipped: false });
  });

  it('rounds DOWN, so the client never lands narrower than the window', () => {
    // THE DIRECTION IS THE GUARD. Rounding up fits FEWER columns than asked
    // for — which is the exact condition this module exists to remove. 11.772…
    // must become 11.7 and not 11.8: at 11.8 the 185-column box shows 219.4,
    // and tmux pans a window it is one column short of.
    const fit = consoleFit(185, 14, 220);
    expect(fit?.fontSize).toBe(11.7);
    expect((185 * 14) / (fit?.fontSize ?? 1), 'the rounded size fits fewer columns than the window')
      .toBeGreaterThanOrEqual(220);
    expect((185 * 14) / 11.8, 'the test no longer distinguishes the two directions')
      .toBeLessThan(220);
  });

  it('stops at the floor and reports the window as clipped', () => {
    // A phone: 390 CSS px over 220 columns is 1.77px per character, which is
    // not a size — it is a smear. Past the floor the fit gives up and says so,
    // and the pane goes back to being a viewport tmux pans.
    expect(consoleFit(48, 14, 220)).toEqual({ fontSize: MIN_CONSOLE_FONT_PX, clipped: true });
  });

  it('treats the floor itself as fitting — clipped is for BELOW it', () => {
    // 220 x 11 / 14 = 172.8, so 173 columns at 14px lands just on the floor.
    const fit = consoleFit(173, 14, 220);
    expect(fit?.clipped, 'a window that still fits was reported clipped').toBe(false);
    expect(fit?.fontSize).toBeGreaterThanOrEqual(MIN_CONSOLE_FONT_PX);
    expect(consoleFit(172, 14, 220)?.clipped, 'one column short was not reported').toBe(true);
  });

  it('answers null for a glass it cannot measure — which is not "it fits"', () => {
    // THE TWO MUST NOT COLLAPSE. A host with no layout yet reports zero
    // columns; read as "already wide enough" it would leave the grid at
    // whatever a fresh terminal guesses, and read as a ratio it would dial a
    // one-column terminal at the moment the sheet mounts.
    expect(consoleFit(0, 14, 220), 'an unmeasured glass was treated as a measurement').toBeNull();
    expect(consoleFit(-1, 14, 220)).toBeNull();
    expect(consoleFit(Number.NaN, 14, 220)).toBeNull();
    expect(consoleFit(166, 0, 220), 'a terminal with no type size answered a size').toBeNull();
    expect(consoleFit(166, 14, 0), 'a window of no width answered a size').toBeNull();
  });

  it('honours the base and floor a caller names, so the constants are not the rule', () => {
    expect(consoleFit(48, 14, 220, 14, 2)?.clipped, 'a caller-set floor was ignored').toBe(false);
    expect(consoleFit(300, 14, 220, 9)?.fontSize, 'a caller-set base was ignored').toBe(9);
  });
});
