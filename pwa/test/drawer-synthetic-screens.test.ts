/**
 * Self-check for the twelve synthetic Claude-Code-shaped screens (D-5006).
 *
 * Feeds each screen's byte stream to a real, never-opened @xterm/xterm 6.0.0
 * Terminal and compares xterm's own translateToString(true) against the stored
 * rows. xterm keeps explicitly written trailing spaces, so we strip trailing
 * U+0020 to match tmux capture-pane -p's shape.
 */
import { describe, it, expect } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { PINNED_WINDOW_COLS, PINNED_WINDOW_ROWS } from '../../shared/api';
import { SYNTHETIC_SCREENS } from './fixtures/drawer/synthetic';

const NAMES = [
  'permission-long-label',
  'single-select',
  'multiselect',
  'tool-output',
  'prose-long-lines',
  'markdown-table-code',
  'right-aligned',
  'cjk-wide',
  'exit-notice',
  'numbered-reply',
  'not-claude',
  'busy',
] as const;

describe('synthetic screens', () => {
  it('carries the twelve planned screens, in order', () => {
    expect(SYNTHETIC_SCREENS.map((s) => s.name)).toEqual([...NAMES]);
    for (const s of SYNTHETIC_SCREENS) {
      expect(s.covers.length).toBeGreaterThan(0);
      expect(s.rows.length).toBe(PINNED_WINDOW_ROWS);
      for (const row of s.rows) {
        if (row.length > 0) {
          expect(row.at(-1)).not.toBe(' ');
        }
      }
      if (s.caret !== null) {
        expect(s.caret.row).toBeGreaterThanOrEqual(0);
        expect(s.caret.row).toBeLessThan(PINNED_WINDOW_ROWS);
        expect(s.caret.col).toBeGreaterThanOrEqual(0);
        expect(s.caret.col).toBeLessThan(PINNED_WINDOW_COLS);
      }
    }
  });

  describe.each(SYNTHETIC_SCREENS.map((s) => [s.name, s] as const))(
    '%s',
    (_n, s) => {
      it('paints its rows on an un-opened 220x51 terminal', async () => {
        const term = new Terminal({
          cols: PINNED_WINDOW_COLS,
          rows: PINNED_WINDOW_ROWS + 1,
        });
        try {
          await new Promise<void>((resolve) => term.write(s.stream, resolve));
          expect(term.buffer.active.type).toBe('alternate');
          const got: string[] = [];
          for (let y = 0; y < PINNED_WINDOW_ROWS; y++) {
            const line = term.buffer.active.getLine(y);
            got.push(line?.translateToString(true).replace(/ +$/, '') ?? '');
          }
          expect(got).toEqual([...s.rows]);
        } finally {
          term.dispose();
        }
      });

      it('has a non-empty status row 50', async () => {
        const term = new Terminal({
          cols: PINNED_WINDOW_COLS,
          rows: PINNED_WINDOW_ROWS + 1,
        });
        try {
          await new Promise<void>((resolve) => term.write(s.stream, resolve));
          const line = term.buffer.active.getLine(PINNED_WINDOW_ROWS);
          const text = line!.translateToString(true).trim();
          expect(text.length).toBeGreaterThan(0);
          expect(text).toContain('[cc-demo]');
        } finally {
          term.dispose();
        }
      });

      it('has its caret, and only its caret, in reverse video', async () => {
        const term = new Terminal({
          cols: PINNED_WINDOW_COLS,
          rows: PINNED_WINDOW_ROWS + 1,
        });
        try {
          await new Promise<void>((resolve) => term.write(s.stream, resolve));
          const inverse: { row: number; col: number }[] = [];
          for (let y = 0; y < PINNED_WINDOW_ROWS; y++) {
            const line = term.buffer.active.getLine(y);
            if (!line) continue;
            for (let x = 0; x < PINNED_WINDOW_COLS; x++) {
              const cell = line.getCell(x);
              if (cell?.isInverse()) {
                inverse.push({ row: y, col: x });
              }
            }
          }
          if (s.caret === null) {
            expect(inverse).toEqual([]);
          } else {
            expect(inverse).toEqual([s.caret]);
          }
        } finally {
          term.dispose();
        }
      });
    }
  );
});
