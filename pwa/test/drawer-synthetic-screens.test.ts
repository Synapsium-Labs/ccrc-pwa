/**
 * Self-check for the twelve synthetic Claude-Code-shaped screens (D-5006).
 *
 * Feeds each screen's byte stream to a real, never-opened @xterm/xterm 6.0.0
 * Terminal and compares xterm's own translateToString(true) against the stored
 * rows. xterm keeps explicitly written trailing spaces, so we strip trailing
 * U+0020 to match tmux capture-pane -p's shape.
 *
 * The builder word-wraps prose where Claude Code does, and the recorded pairs
 * say where that is (plan Refinement 2: where the two disagree, the recorded
 * pair wins and the builder follows it). The last case holds `CC_WRAP_COLS` to
 * every break Claude Code made in a reply paragraph on a recorded screen.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { PINNED_WINDOW_COLS, PINNED_WINDOW_ROWS, TMUX_STATUS_ROWS } from '../../shared/api';
import { CC_WRAP_COLS, SYNTHETIC_SCREENS, cellWidth } from './fixtures/drawer/synthetic';

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
          rows: PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS,
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
          rows: PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS,
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
          rows: PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS,
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

const RECORDED_ROOT = path.join(import.meta.dirname, 'fixtures', 'drawer', 'recorded');

/** Every break Claude Code made inside a `● ` reply paragraph on a recorded
 *  screen: the width of the row it ended, and of the word it carried on with. */
function recordedBreaks(): { at: string; row: number; next: number }[] {
  const out: { at: string; row: number; next: number }[] = [];
  for (const version of readdirSync(RECORDED_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const file of readdirSync(path.join(RECORDED_ROOT, version.name)).filter((f) => f.endsWith('.json'))) {
      const { scenario, capture } = JSON.parse(
        readFileSync(path.join(RECORDED_ROOT, version.name, file), 'utf8'),
      ) as { scenario: string; capture: readonly string[] };
      for (let y = 0; y + 1 < capture.length; y++) {
        if (!capture[y]!.startsWith('● ')) continue;
        // The paragraph carries on at its two-space hanging indent, word first.
        for (; y + 1 < capture.length && /^ {2}[A-Za-z0-9`'"(]/.test(capture[y + 1]!); y++) {
          const word = capture[y + 1]!.trim().split(' ')[0]!;
          out.push({ at: `${version.name}/${scenario} row ${y}`, row: cellWidth(capture[y]!), next: cellWidth(word) });
        }
      }
    }
  }
  return out;
}

describe('the builder wraps prose where the recorded Claude Code wraps it', () => {
  it('CC_WRAP_COLS holds every reply break on every recorded screen', () => {
    const breaks = recordedBreaks();
    // Liveness: the recorded corpus has reply paragraphs that Claude Code broke.
    expect(breaks.length, 'no recorded screen breaks a reply paragraph').toBeGreaterThanOrEqual(3);
    for (const b of breaks) {
      expect(b.row, `${b.at}: Claude Code's row is wider than the builder ever wraps`).toBeLessThanOrEqual(CC_WRAP_COLS);
      expect(b.row + 1 + b.next, `${b.at}: the builder would have kept the next word on this row`)
        .toBeGreaterThan(CC_WRAP_COLS);
    }
  });
});
