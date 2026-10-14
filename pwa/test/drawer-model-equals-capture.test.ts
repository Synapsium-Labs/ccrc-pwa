/**
 * W6, measured on every fixture (spec 2026-10-14 §9; D-5006): the drawer's
 * 220-column model IS the screen the server reads.
 *
 * Each recorded fixture is a 220x51 `tmux attach` stream and the `capture-pane
 * -p` taken in the same rig run (`server/test/drawer-rig/`). Fed to an
 * un-opened terminal at the drawer's own grid, `readModel`'s rows equal the
 * capture on every row the recording did not itself measure as animated (at
 * most 2: a spinner), and row 50 is tmux's status line, which the model never
 * holds. The synthetic screens hold the same model to their rows and to their
 * one caret cell. Then the real `defaultMakeTerm`: its `model()` is the
 * window's 50 rows and never the status row, which a guard reading the last
 * rows would otherwise read as one of them. Last, `cellCss` and `GLASS_ANSI`.
 */
import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Terminal } from '@xterm/xterm';
import { PINNED_WINDOW_COLS, PINNED_WINDOW_ROWS, TMUX_STATUS_ROWS } from '../../shared/api';
import { SYNTHETIC_SCREENS } from './fixtures/drawer/synthetic';
import { defaultMakeTerm } from '../src/session/TerminalDrawer';
import { readModel, rowText, isCaret, GLASS_ANSI, cellCss, type ModelCell } from '../src/session/drawerModel';

const TERM_ROWS = PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS;
const RECORDED_ROOT = path.join(process.cwd(), 'test/fixtures/drawer/recorded');

interface RecordedFixture {
  scenario: string;
  covers: readonly string[];
  claudeCode: string;
  tmux: string;
  cols: number;
  rows: number;
  attach: string;
  capture: readonly string[];
  animatedRows: readonly number[];
}

function discoverFixtures(): RecordedFixture[] {
  const fixtures: RecordedFixture[] = [];
  for (const version of readdirSync(RECORDED_ROOT, { withFileTypes: true })) {
    if (!version.isDirectory()) continue;
    const dir = path.join(RECORDED_ROOT, version.name);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const raw = readFileSync(path.join(dir, entry.name), 'utf8');
      fixtures.push(JSON.parse(raw) as RecordedFixture);
    }
  }
  return fixtures;
}

const recorded = discoverFixtures();

function makeTerminal(): Terminal {
  return new Terminal({ cols: PINNED_WINDOW_COLS, rows: TERM_ROWS });
}

describe('recorded fixtures', () => {
  it('discovers at least six fixtures', () => {
    expect(recorded.length).toBeGreaterThanOrEqual(6);
  });

  it.each(recorded)('$scenario is a 220x51 attach with a 50-row capture', (fixture) => {
    expect(fixture.cols).toBe(PINNED_WINDOW_COLS);
    expect(fixture.rows).toBe(TERM_ROWS);
    expect(fixture.capture.length).toBe(PINNED_WINDOW_ROWS);
    expect(fixture.animatedRows.length).toBeLessThanOrEqual(2);
  });

  it.each(recorded)('$scenario readModel equals capture outside animated rows', async (fixture) => {
    const term = makeTerminal();
    try {
      await new Promise<void>((resolve) => term.write(fixture.attach, resolve));
      const model = readModel(term.buffer.active, PINNED_WINDOW_COLS, PINNED_WINDOW_ROWS);
      expect(model.length).toBe(PINNED_WINDOW_ROWS);
      const animated = new Set(fixture.animatedRows);
      for (let y = 0; y < PINNED_WINDOW_ROWS; y++) {
        if (animated.has(y)) continue;
        const text = rowText(model[y]!);
        expect(text, `row ${y}`).toBe(fixture.capture[y]);
      }
      const statusLine = term.buffer.active.getLine(term.buffer.active.viewportY + PINNED_WINDOW_ROWS);
      expect(statusLine).toBeDefined();
      expect(statusLine!.translateToString(true).trim().length).toBeGreaterThan(0);
    } finally {
      term.dispose();
    }
  });
});

describe('synthetic screens', () => {
  it.each(SYNTHETIC_SCREENS)('$name readModel rows match', async (screen) => {
    const term = makeTerminal();
    try {
      await new Promise<void>((resolve) => term.write(screen.stream, resolve));
      const model = readModel(term.buffer.active, PINNED_WINDOW_COLS, PINNED_WINDOW_ROWS);
      expect(model.length).toBe(PINNED_WINDOW_ROWS);
      expect(model.map(rowText)).toEqual(screen.rows);
    } finally {
      term.dispose();
    }
  });

  it.each(SYNTHETIC_SCREENS)('$name caret position', async (screen) => {
    const term = makeTerminal();
    try {
      await new Promise<void>((resolve) => term.write(screen.stream, resolve));
      const model = readModel(term.buffer.active, PINNED_WINDOW_COLS, PINNED_WINDOW_ROWS);
      const carets: { row: number; col: number }[] = [];
      for (let row = 0; row < model.length; row++) {
        for (const cell of model[row]!) {
          if (isCaret(cell)) carets.push({ row, col: cell.col });
        }
      }
      if (screen.caret === null) {
        expect(carets).toEqual([]);
      } else {
        expect(carets).toEqual([screen.caret]);
      }
    } finally {
      term.dispose();
    }
  });
});

describe('the real terminal (defaultMakeTerm, never opened)', () => {
  const screen = SYNTHETIC_SCREENS.find((x) => x.caret !== null)!;

  it('models the window rows only, and reads the status row apart', async () => {
    const term = defaultMakeTerm();
    try {
      term.write(screen.stream);
      await vi.waitFor(() => {
        expect(term.model().map(rowText)).toEqual(screen.rows);
      }, { timeout: 2000 });
      // The row count is the point: a model of all 51 rows would hand tmux's
      // status line to every reader of the screen's last rows.
      expect(term.model().length).toBe(PINNED_WINDOW_ROWS);
      expect(rowText(term.statusRow())).toContain('[cc-demo]');
      expect(term.isOpen()).toBe(false);
    } finally {
      term.dispose();
    }
  });

  it('onParsed fires after a write, and not after its unsubscribe', async () => {
    const term = defaultMakeTerm();
    try {
      let calls = 0;
      let seen = '';
      const off = term.onParsed(() => {
        calls += 1;
        seen = rowText(term.model()[0] ?? []);
      });
      term.write('\x1b[?1049h\x1b[Hhello');
      await vi.waitFor(() => { expect(calls).toBeGreaterThan(0); }, { timeout: 2000 });
      expect(seen, 'a reader in onParsed did not see the write').toBe('hello');
      off();
      const before = calls;
      term.write('\x1b[Hworld');
      await vi.waitFor(() => { expect(rowText(term.model()[0] ?? [])).toBe('world'); }, { timeout: 2000 });
      expect(calls).toBe(before);
    } finally {
      term.dispose();
    }
  });
});

describe('GLASS_ANSI and cellCss', () => {
  it('has sixteen colours', () => {
    expect(GLASS_ANSI.length).toBe(16);
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])('palette %i resolves through GLASS_ANSI', (n) => {
    const css = cellCss({
      fg: n, fgMode: 'palette',
      bg: 0, bgMode: 'default',
      bold: false, dim: false, italic: false, underline: false, inverse: false,
    });
    expect(css.color).toBe(GLASS_ANSI[n]);
  });

  it.each([
    [16, '#000000'],
    [21, '#0000ff'],
    [196, '#ff0000'],
    [232, '#080808'],
    [244, '#808080'],
    [255, '#eeeeee'],
  ])('palette %i resolves to %s', (n, want) => {
    const css = cellCss({
      fg: n as number, fgMode: 'palette',
      bg: 0, bgMode: 'default',
      bold: false, dim: false, italic: false, underline: false, inverse: false,
    });
    expect(css.color).toBe(want);
  });

  it('resolves RGB colours with zero-padding', () => {
    expect(cellCss({
      fg: 0xd77757, fgMode: 'rgb',
      bg: 0, bgMode: 'default',
      bold: false, dim: false, italic: false, underline: false, inverse: false,
    }).color).toBe('#d77757');
    expect(cellCss({
      fg: 0x00000a, fgMode: 'rgb',
      bg: 0, bgMode: 'default',
      bold: false, dim: false, italic: false, underline: false, inverse: false,
    }).color).toBe('#00000a');
  });

  it('default colours are undefined', () => {
    const css = cellCss({
      fg: -1, fgMode: 'default',
      bg: -1, bgMode: 'default',
      bold: false, dim: false, italic: false, underline: false, inverse: false,
    });
    expect(css.color).toBeUndefined();
    expect(css.backgroundColor).toBeUndefined();
  });

  it('inverse with default colours uses token fallbacks', () => {
    const css = cellCss({
      fg: -1, fgMode: 'default',
      bg: -1, bgMode: 'default',
      bold: false, dim: false, italic: false, underline: false, inverse: true,
    });
    expect(css.color).toBe('var(--bg-well)');
    expect(css.backgroundColor).toBe('var(--ink-on-well)');
  });

  it('without inverse, rgb fg and palette bg stay where they are', () => {
    const css = cellCss({
      fg: 0xd77757, fgMode: 'rgb',
      bg: 2, bgMode: 'palette',
      bold: false, dim: false, italic: false, underline: false, inverse: false,
    });
    expect(css.color).toBe('#d77757');
    expect(css.backgroundColor).toBe(GLASS_ANSI[2]);
  });

  it('inverse with rgb fg and palette bg swaps them', () => {
    const css = cellCss({
      fg: 0xd77757, fgMode: 'rgb',
      bg: 2, bgMode: 'palette',
      bold: false, dim: false, italic: false, underline: false, inverse: true,
    });
    expect(css.color).toBe(GLASS_ANSI[2]);
    expect(css.backgroundColor).toBe('#d77757');
  });

  it.each([
    ['bold', 'fontWeight', 'bold'],
    ['italic', 'fontStyle', 'italic'],
    ['underline', 'textDecoration', 'underline'],
    ['dim', 'opacity', '0.5'],
  ] as const)('%s maps to %s', (attr, key, value) => {
    const style: ModelCell['style'] = {
      fg: 0, fgMode: 'default',
      bg: 0, bgMode: 'default',
      bold: false, dim: false, italic: false, underline: false, inverse: false,
    };
    (style as Record<typeof attr, boolean>)[attr] = true;
    const css = cellCss(style);
    expect(css[key]).toBe(value);
  });

  it('always returns all six keys', () => {
    const css = cellCss({
      fg: 0, fgMode: 'default',
      bg: 0, bgMode: 'default',
      bold: false, dim: false, italic: false, underline: false, inverse: false,
    });
    expect(Object.keys(css).sort()).toEqual(['backgroundColor', 'color', 'fontStyle', 'fontWeight', 'opacity', 'textDecoration']);
  });
});
