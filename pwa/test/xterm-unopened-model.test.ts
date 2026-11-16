/**
 * W9, pinned (spec 2026-10-14 §9; D-5006): an `@xterm/xterm` 6.0.0 `Terminal`
 * that is NEVER `open()`ed still parses the alternate screen, keeps per-cell
 * 24-bit colour, gives a wide character two cells, tracks the cursor and fires
 * `onWriteParsed`.
 *
 * The wrapped view rests on every one of those: on a coarse pointer the
 * drawer's terminal is never opened, and its buffer is the model the view
 * re-wraps (`drawerModel.ts`). This file holds the package's behaviour to
 * that, so an xterm upgrade that changes it reds here, not on a phone.
 *
 * MEASURED ORDER, and it is not the one the plan's Task 7 wrote down: 6.0.0
 * runs a write's callback INSIDE its parse loop and fires `onWriteParsed` once,
 * at the end of that same synchronous pass, so the event has NOT fired yet when
 * the callback runs. What the model needs is weaker and is what is held here:
 * the event fires in that pass (before a microtask queued by the callback), and
 * a handler reading the buffer from it sees the write.
 */
import { describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { PINNED_WINDOW_COLS, PINNED_WINDOW_ROWS, TMUX_STATUS_ROWS } from '../../shared/api';

describe('an un-opened xterm 6.0.0 terminal is a model (W9)', () => {
  it('parses the alternate screen, 24-bit colour, a wide cell, the cursor and onWriteParsed', async () => {
    const term = new Terminal({ cols: PINNED_WINDOW_COLS, rows: PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS });
    try {
      let parsed = false;
      let seenInHandler = '';
      const sub = term.onWriteParsed(() => {
        parsed = true;
        seenInHandler = term.buffer.active.getLine(0)?.translateToString(true) ?? '';
      });
      const data =
        '\x1b[?1049h' +                       // the alternate screen, as every tmux attach begins
        '\x1b[38;2;215;119;87mRGB\x1b[0m' +   // a 24-bit run at columns 0–2
        '漢' +                                // a wide character at columns 3–4
        '\x1b[10;20H' +                       // row 10, column 20 (1-based)
        '\x1b[7m \x1b[27m';                   // a reverse-video cell there: the caret's shape
      let parsedByMicrotask: boolean | null = null;
      await new Promise<void>((resolve) => term.write(data, () => {
        queueMicrotask(() => { parsedByMicrotask = parsed; resolve(); });
      }));
      sub.dispose();

      const b = term.buffer.active;
      expect(b.type).toBe('alternate');

      const line0 = b.getLine(0);
      expect(line0).toBeDefined();
      const r = line0!.getCell(0);
      expect(r!.getChars()).toBe('R');
      expect(r!.isFgRGB()).toBe(true);
      expect(r!.getFgColor()).toBe(0xd77757);

      const wide = line0!.getCell(3);
      expect(wide!.getChars()).toBe('漢');
      expect(wide!.getWidth()).toBe(2);
      expect(line0!.getCell(4)!.getWidth()).toBe(0);

      const caret = b.getLine(9)!.getCell(19);
      expect(caret!.isInverse()).not.toBe(0);
      // The cursor moved to (row 9, col 19) and on past the cell it wrote.
      expect(b.cursorY).toBe(9);
      expect(b.cursorX).toBe(20);

      expect(parsedByMicrotask, 'onWriteParsed did not fire in the pass that parsed the write').toBe(true);
      expect(seenInHandler, 'a reader in onWriteParsed did not see the write').toBe('RGB漢');
    } finally {
      term.dispose();
    }
  });
});
