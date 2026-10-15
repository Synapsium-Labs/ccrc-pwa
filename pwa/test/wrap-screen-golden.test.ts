/**
 * The wrapped view's re-wrap, held to its properties and to golden files
 * (spec 2026-10-14 §5.3 and §9's `wrap-screen-golden.test.ts` bullet; D-5006).
 *
 * The corpus is every screen the drawer's model is measured on: the six
 * recorded Claude Code screens (`fixtures/drawer/recorded/<claude-version>/`,
 * each fed to an un-opened 220x51 terminal, as the drawer does), the twelve
 * synthetic screens (`fixtures/drawer/synthetic.ts`), and every
 * `server/test/fixtures/panes/*.txt` capture whose widest row is 220 cells
 * (read as unstyled rows). At each W of the spec's set:
 *   (a) the output's non-space characters, in order, are the source's, minus
 *       rule rows (blank rows have none to lose);
 *   (b) no visual row is wider than W unless it is a table row;
 *   (c) at W >= srcCols the output IS the source, row for row;
 *   (d) the caret (a reverse-video cell, W11) survives;
 *   (e) `src` is injective and covers every kept source cell;
 *   (f) prose wrapped at 220, re-joined and wrapped at W equals a direct wrap
 *       at W (paragraphs built here with the synthetic builder's own wrapper,
 *       and Claude Code's real wrap on the recorded `reply-done`);
 *   (g) no wide cell is split: every shown cell is its source cell, whole.
 * A count property rides with them: below srcCols the re-wrap never takes more
 * rows than a character wrap of the same screen (W10).
 *
 * Goldens: one file per recorded or synthetic screen and W, under
 * `fixtures/drawer-golden/` (outside `recorded/`, so the residue scanner's
 * layout holds). Each line is one visual row: a blank row is an empty line;
 * otherwise a kind prefix (` ` text, `─` rule, `⇆` table, `→` right) and the
 * row's text. `DRAWER_GOLDEN_WRITE=1` writes them (never under CI); without it,
 * a missing file fails and a changed one prints its line diff. A regenerated
 * golden is read by hand before it is committed.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Terminal } from '@xterm/xterm';
import { PINNED_WINDOW_COLS, PINNED_WINDOW_ROWS, TMUX_STATUS_ROWS } from '../../shared/api';
import { CC_WRAP_COLS, SYNTHETIC_SCREENS, cellWidth, wrapProse } from './fixtures/drawer/synthetic';
import { isCaret, readModel, rowText, type CellStyle, type ModelCell, type ModelRow } from '../src/session/drawerModel';
import { wrapScreen, type VisualRow } from '../src/session/wrapScreen';

const SRC = PINNED_WINDOW_COLS;
const WIDTHS = [34, 39, 45, 60, 87, 118, 149, 171, 220] as const;
const NARROW = WIDTHS.filter((W) => W < SRC);
const RECORDED_ROOT = path.join(import.meta.dirname, 'fixtures', 'drawer', 'recorded');
const PANES_ROOT = path.join(import.meta.dirname, '..', '..', 'server', 'test', 'fixtures', 'panes');
const GOLDEN_ROOT = path.join(import.meta.dirname, 'fixtures', 'drawer-golden');

interface Screen { name: string; model: ModelRow[]; capture?: readonly string[] }

const PLAIN: CellStyle = {
  fg: -1, fgMode: 'default', bg: -1, bgMode: 'default',
  bold: false, dim: false, italic: false, underline: false, inverse: false,
};

/** Text rows as unstyled model rows: one cell per code point, trailing spaces trimmed. */
function plainRows(lines: readonly string[]): ModelRow[] {
  return lines.map((line) => {
    const cells: ModelCell[] = [];
    let col = 0;
    for (const ch of line) {
      const width = cellWidth(ch) === 2 ? 2 : 1;
      cells.push({ ch, width, col, style: PLAIN });
      col += width;
    }
    while (cells.length > 0 && cells[cells.length - 1]!.ch === ' ') cells.pop();
    return cells;
  });
}

/** The drawer's own read: the stream into an un-opened 220x51 terminal, then its 50 window rows. */
async function modelOf(stream: string): Promise<ModelRow[]> {
  const term = new Terminal({ cols: SRC, rows: PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS });
  try {
    await new Promise<void>((resolve) => term.write(stream, resolve));
    return readModel(term.buffer.active, SRC, PINNED_WINDOW_ROWS);
  } finally {
    term.dispose();
  }
}

interface RecordedFixture { scenario: string; attach: string; capture: readonly string[] }

const recorded: Screen[] = [];
for (const version of readdirSync(RECORDED_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  for (const file of readdirSync(path.join(RECORDED_ROOT, version)).filter((f) => f.endsWith('.json')).sort()) {
    const fx = JSON.parse(readFileSync(path.join(RECORDED_ROOT, version, file), 'utf8')) as RecordedFixture;
    recorded.push({ name: `recorded/${version}/${fx.scenario}`, model: await modelOf(fx.attach), capture: fx.capture });
  }
}

const synthetic: Screen[] = [];
for (const s of SYNTHETIC_SCREENS) synthetic.push({ name: `synthetic/${s.name}`, model: await modelOf(s.stream) });

const panes: Screen[] = [];
for (const file of readdirSync(PANES_ROOT).filter((f) => f.endsWith('.txt')).sort()) {
  const raw = readFileSync(path.join(PANES_ROOT, file), 'utf8');
  const lines = raw.split('\n');
  if (raw.endsWith('\n')) lines.pop();
  if (Math.max(...lines.map((l) => cellWidth(l.replace(/ +$/, '')))) === SRC) {
    panes.push({ name: `panes/${file}`, model: plainRows(lines) });
  }
}

const byName = (name: string): Screen => {
  const s = [...recorded, ...synthetic].find((x) => x.name === name);
  if (!s) throw new Error(`no screen ${name}`);
  return s;
};

const cellsWidth = (cells: readonly ModelCell[]): number => cells.reduce((w, c) => w + c.width, 0);
const texts = (out: readonly VisualRow[]): string[] => out.map((r) => rowText(r.cells));
const nonSpace = (rows: readonly (readonly ModelCell[])[]): string =>
  rows.map((r) => r.filter((c) => c.ch !== ' ').map((c) => c.ch).join('')).join('');
const key = (row: number, col: number): string => `${row}:${col}`;

/** The source rows the output shows as a rule. */
const ruleRowsOf = (out: readonly VisualRow[]): Set<number> =>
  new Set(out.filter((r) => r.kind === 'rule').flatMap((r) => r.src.flatMap((s) => (s ? [s.row] : []))));

/** W10's comparison: a character wrap of the same screen, one row at least per source row. */
const charWrapCount = (model: readonly ModelRow[], W: number): number =>
  model.reduce((n, row) => n + Math.max(1, Math.ceil(cellsWidth(row) / W)), 0);

describe('the corpus', () => {
  // THE PANE CAPTURES ARE A FLOOR, NOT A COUNT: they are the server's corpus
  // (`server/test/fixtures/panes/`), which grows with the server's own work —
  // thirteen were 220 wide when this file was written, and main's #417/#418
  // added forty-three more. Every one of them is held to the properties below.
  it('holds the six recorded screens, the twelve synthetic ones and at least the thirteen 220-wide pane captures', () => {
    expect(recorded.length).toBeGreaterThanOrEqual(6);
    expect(synthetic).toHaveLength(12);
    expect(panes.length).toBeGreaterThanOrEqual(13);
    for (const s of [...recorded, ...synthetic]) expect(s.model, s.name).toHaveLength(PINNED_WINDOW_ROWS);
  });
});

describe('properties (a)–(e) and (g), on every screen at every W', () => {
  const cases = [...recorded, ...synthetic, ...panes].flatMap((s) => WIDTHS.map((W) => ({ s, W })));
  it.each(cases)('$s.name at W=$W', ({ s, W }) => {
    const model = s.model;
    const out = wrapScreen(model, W, SRC);
    const rules = ruleRowsOf(out);
    const at = (row: number, col: number): ModelCell | undefined => model[row]?.find((c) => c.col === col);

    for (const r of out) expect(r.src.length, 'src has one entry per cell').toBe(r.cells.length);

    // (a)
    expect(nonSpace(out.filter((r) => r.kind !== 'rule').map((r) => r.cells)), '(a)')
      .toBe(nonSpace(model.filter((_, i) => !rules.has(i))));

    // (b)
    for (const r of out) {
      if (r.kind !== 'table') expect(cellsWidth(r.cells), `(b) "${rowText(r.cells)}"`).toBeLessThanOrEqual(W);
    }

    // (c)
    if (W >= SRC) {
      expect(out, '(c) one visual row per source row').toHaveLength(model.length);
      model.forEach((row, i) => {
        expect(out[i]!.cells, `(c) row ${i}`).toEqual(row);
        expect(out[i]!.src, `(c) row ${i}`).toEqual(row.map((c) => ({ row: i, col: c.col })));
      });
    }

    // (d)
    model.forEach((row, i) => {
      for (const c of row.filter(isCaret)) {
        const shown = out.some((r) => r.cells.some((cell, k) => r.src[k]?.row === i && r.src[k]?.col === c.col && isCaret(cell)));
        expect(shown, `(d) the caret at ${key(i, c.col)}`).toBe(true);
      }
    });

    // (e)
    const seen = new Set<string>();
    for (const r of out) {
      for (const s2 of r.src) {
        if (!s2) continue;
        const k = key(s2.row, s2.col);
        expect(seen.has(k), `(e) ${k} shown twice`).toBe(false);
        seen.add(k);
        expect(at(s2.row, s2.col), `(e) ${k} is no source cell`).toBeDefined();
      }
    }
    model.forEach((row, i) => {
      if (rules.has(i)) return;
      for (const c of row) {
        if (c.ch !== ' ' || isCaret(c)) expect(seen.has(key(i, c.col)), `(e) ${key(i, c.col)} "${c.ch}" not shown`).toBe(true);
      }
    });

    // (g)
    for (const r of out) {
      r.cells.forEach((cell, k) => {
        expect([1, 2], '(g) a cell is 1 or 2 wide').toContain(cell.width);
        expect(cell.ch.length, '(g) a cell holds a character').toBeGreaterThan(0);
        const s2 = r.src[k];
        if (s2) expect(cell, `(g) ${key(s2.row, s2.col)} is its source cell, whole`).toEqual(at(s2.row, s2.col));
      });
    }
  });
});

describe('the row count (W10): never more rows than a character wrap below srcCols', () => {
  const cases = [...recorded, ...synthetic].flatMap((s) => NARROW.map((W) => ({ s, W })));
  it.each(cases)('$s.name at W=$W', ({ s, W }) => {
    expect(wrapScreen(s.model, W, SRC).length).toBeLessThanOrEqual(charWrapCount(s.model, W));
  });
});

// ---------------------------------------------------------------------------
// (f): Claude Code's wrap at 220, re-joined and wrapped at W, is a direct wrap at W.
// Words carry no digits and none is a marker, so no continuation row starts one.
// ---------------------------------------------------------------------------

const PARAGRAPHS: readonly { name: string; first: string; cont: string; text: string }[] = [
  {
    name: 'bullet', first: '● ', cont: '  ',
    text: 'The cache in project-a needs a clear eviction policy. If every entry lives forever, memory pressure grows until the process is stopped by the limits of its lane. A bounded cache keeps hot entries near the front while cold ones fall off the back, and it costs one map and one list per instance. The map answers a lookup at once, and the list remembers which entry was touched last, so an eviction never has to scan the whole cache to find its victim.',
  },
  {
    name: 'plain', first: '  ', cont: '  ',
    text: 'Start by measuring hit rates under the current workload. Add counters to src/lib/cache.ts and run test/app.test.ts to establish a baseline. Once the baseline is stable, introduce the capacity limit and assert that evictions happen when the threshold is crossed, and not before it. Keep the counters cheap: a plain increment on each lookup is enough, and the report can be computed only when someone asks for it.',
  },
  {
    name: 'numbered', first: '  1. ', cont: '     ',
    text: 'Add the bounded map to src/lib/cache.ts and expose get, set and delete methods that match the existing interface, so that no caller has to change; keep the capacity a constructor argument with a sensible default, and document why the default was chosen next to it, because the next reader will want to know whether the number was measured or simply guessed on a quiet afternoon.',
  },
  {
    name: 'dash', first: '  - ', cont: '    ',
    text: 'Avoid adding dependencies: the standard library already has everything the cache needs, and every new dependency is one more thing to audit, pin and upgrade across every lane that builds project-a, which is exactly the cost the cache was meant to save. When a helper seems missing, write the small version inline and give it a test of its own, so its behaviour is pinned where it is used.',
  },
  {
    name: 'nested-dash', first: '    - ', cont: '      ',
    text: 'Log eviction events at debug level so they can be traced without flooding the default output. Keep the log format stable so existing parsers do not break, name the evicted key and the reason it was chosen, and leave the value itself out of the line, because a cached value can be large and can hold data that does not belong in a log file that many people read.',
  },
  {
    name: 'code-gutter', first: '    6  ', cont: '       ',
    text: "const note = 'this constant is deliberately long, because a code line wider than the window is wrapped by the renderer under the code gutter, and the re-wrapper must keep that gutter as the hanging indent rather than re-join it as prose, which would pull the next line of code up into this one and make the listing impossible to read on a narrow glass';",
  },
];

/** `text` padded with ' a' until the last row of its 220 wrap is at least `min` cells wide. */
function padLastRow(text: string, first: string, cont: string, min: number): { text: string; rows: string[] } {
  let t = text;
  let rows = wrapProse(t, first, cont, CC_WRAP_COLS);
  while (cellWidth(rows[rows.length - 1]!) < min) {
    t += ' a';
    rows = wrapProse(t, first, cont, CC_WRAP_COLS);
  }
  return { text: t, rows };
}

const lastWidth = (rows: readonly string[]): number => cellWidth(rows[rows.length - 1]!);

describe('property (f)', () => {
  const cases = PARAGRAPHS.flatMap((p) => WIDTHS.map((W) => ({ p, W })));
  it.each(cases)('the $p.name paragraph at W=$W', ({ p, W }) => {
    const rows220 = wrapProse(p.text, p.first, p.cont, CC_WRAP_COLS);
    expect(rows220.length, 'the paragraph spans two rows at 220').toBeGreaterThanOrEqual(2);
    for (const word of p.text.split(' ')) {
      expect(cellWidth(word), word).toBeLessThanOrEqual(20);
      expect(word, 'no digits').not.toMatch(/\d/);
    }
    const expected = W >= SRC ? rows220 : wrapProse(p.text, p.first, p.cont, W);
    expect(texts(wrapScreen(plainRows(rows220), W, SRC))).toEqual(expected);
  });

  /** Two paragraphs with no blank row between: exactly one join condition keeps them apart. */
  function stacked(a: { text: string; first: string; cont: string }, b: { text: string; first: string; cont: string }): void {
    const rowsA = wrapProse(a.text, a.first, a.cont, CC_WRAP_COLS);
    const rowsB = wrapProse(b.text, b.first, b.cont, CC_WRAP_COLS);
    for (const W of WIDTHS) {
      const expected = W >= SRC
        ? [...rowsA, ...rowsB]
        : [...wrapProse(a.text, a.first, a.cont, W), ...wrapProse(b.text, b.first, b.cont, W)];
      expect(texts(wrapScreen(plainRows([...rowsA, ...rowsB]), W, SRC)), `W=${W}`).toEqual(expected);
    }
  }

  it('J4 alone: a long last row, then a deeper indent whose first word would not have fitted', () => {
    const a = padLastRow(PARAGRAPHS[0]!.text, '● ', '  ', 205);
    const b = { text: 'configuration of the cache stays in one file, and the defaults stay beside it.', first: '    ', cont: '    ' };
    expect(lastWidth(a.rows) + 1 + 'configuration'.length).toBeGreaterThan(SRC - 6);  // J2 and J3 hold
    stacked({ ...a, first: '● ', cont: '  ' }, b);
  });

  it('J3 alone: a long row whose next first word would have fitted on it', () => {
    const a = padLastRow('Then cover both functions with one small test file.', '  ', '  ', 120);
    expect(lastWidth(a.rows)).toBeGreaterThanOrEqual(120);  // J2 holds
    expect(lastWidth(a.rows)).toBeLessThanOrEqual(180);     // so J3 fails for a four-cell word
    stacked({ ...a, first: '  ', cont: '  ' },
      { text: 'Then the module keeps a single shape that any reader can take in at a glance.', first: '  ', cont: '  ' });
  });

  it('J5 alone: a long last row, then a list item at the same indent', () => {
    const a = padLastRow(PARAGRAPHS[0]!.text, '● ', '  ', 213);
    expect(lastWidth(a.rows) + 1 + 1).toBeGreaterThan(SRC - 6);  // J3 holds for the marker '-'
    stacked({ ...a, first: '● ', cont: '  ' },
      { text: 'document the eviction policy in a comment so future readers know why the limit exists.', first: '  - ', cont: '    ' });
  });

  it("Claude Code's own wrap: reply-done's three-row paragraph re-wraps as one", () => {
    const { model } = byName('recorded/2.1.299/reply-done');
    const [r8, r9, r10] = [rowText(model[8]!), rowText(model[9]!), rowText(model[10]!)];
    expect(r8.startsWith('● project-a is')).toBe(true);
    expect(r9.startsWith('  ') && r10.startsWith('  ')).toBe(true);
    const joined = `${r8.slice(2)} ${r9.slice(2)} ${r10.slice(2)}`;
    for (const W of NARROW) {
      const expected = wrapProse(joined, '● ', '  ', W).join('\n');
      const out = texts(wrapScreen(model, W, SRC));
      const n = expected.split('\n').length;
      const found = out.some((_, i) => out.slice(i, i + n).join('\n') === expected);
      expect(found, `W=${W}`).toBe(true);
    }
  });
});

describe('the mechanisms, one case each', () => {
  it('a rule is at least half of srcCols of rule characters; a shorter run is text', () => {
    const out = (line: string): VisualRow[] => wrapScreen(plainRows([line]), 45, SRC);
    expect(out('─'.repeat(110)).map((r) => r.kind)).toEqual(['rule']);
    expect(out('─'.repeat(109)).every((r) => r.kind === 'text')).toBe(true);
    expect(out('  ' + '─'.repeat(30)).map((r) => r.kind)).toEqual(['text']);
  });

  it('the hanging indent is capped at W/3, on the first row too', () => {
    const words = Array.from({ length: 26 }, (_, i) => `item${String.fromCharCode(97 + i)}`).join(' ');
    const deep = wrapScreen(plainRows([' '.repeat(40) + words]), 34, SRC);
    expect(deep.length).toBeGreaterThan(1);
    for (const r of deep) {
      expect(cellsWidth(r.cells)).toBeLessThanOrEqual(34);
      expect(rowText(r.cells)).toMatch(/^ {11}\S/);
    }
    const item = wrapScreen(plainRows(['  1. ' + words]), 34, SRC);
    expect(rowText(item[0]!.cells)).toMatch(/^ {2}1\. /);
    for (const r of item.slice(1)) expect(rowText(r.cells)).toMatch(/^ {5}\S/);
  });

  it('a right-aligned segment is its own row, after the text before it', () => {
    const out = wrapScreen(byName('synthetic/right-aligned').model, 45, SRC);
    const i = out.findIndex((r) => r.kind === 'right');
    expect(rowText(out[i]!.cells)).toBe('◐ medium · /effort');
    expect({ kind: out[i - 1]!.kind, text: rowText(out[i - 1]!.cells) }).toEqual({ kind: 'text', text: '  ? for shortcuts' });
  });

  it('a table never wraps: its seven rows come out whole, in order', () => {
    const { model, capture } = byName('recorded/2.1.299/markdown-table-code');
    const table = capture!.slice(11, 18);
    expect(table[0]!.trim().startsWith('┌')).toBe(true);
    expect(table[6]!.trim().startsWith('└')).toBe(true);
    const out = wrapScreen(model, 34, SRC);
    const i = out.findIndex((r) => r.kind === 'table');
    expect(out.slice(i, i + 7).map((r) => ({ kind: r.kind, text: rowText(r.cells) })))
      .toEqual(table.map((text) => ({ kind: 'table', text })));
  });

  it('a run of blank rows collapses to one', () => {
    expect(wrapScreen(plainRows(['  one', '', '', '', '  two']), 45, SRC).map((r) => r.kind)).toEqual(['text', 'blank', 'text']);
  });

  it('an unbreakable token is hard-broken at W', () => {
    const token = 'x'.repeat(200);
    const out = wrapScreen(plainRows([token]), 45, SRC);
    expect(out.map((r) => cellsWidth(r.cells))).toEqual([45, 45, 45, 45, 20]);
    expect(texts(out).join('')).toBe(token);
  });

  it('a token Claude Code hard-broke re-joins with no space, and is hard-broken again at W', () => {
    const out = wrapScreen(plainRows(['  ' + 'x'.repeat(214), '  ' + 'x'.repeat(10)]), 60, SRC);
    expect(texts(out)).toEqual(['  ' + 'x'.repeat(58), '  ' + 'x'.repeat(58), '  ' + 'x'.repeat(58), '  ' + 'x'.repeat(50)]);
  });

  it('a row padded to the edge with styled spaces is as long as its text, so it does not join', () => {
    const shade: CellStyle = { ...PLAIN, bg: 2, bgMode: 'palette' };
    const [text] = plainRows(['  ' + Array.from({ length: 20 }, () => 'item').join(' ')]);
    const padded: ModelRow = [...text!, ...Array.from({ length: 110 }, (_, k) => ({ ch: ' ', width: 1 as const, col: text!.length + k, style: shade }))];
    const [next] = plainRows(['  words that start a new paragraph']);
    expect(cellsWidth(padded)).toBeGreaterThanOrEqual(SRC / 2);  // J2 and J3 would hold on the cell count
    expect(texts(wrapScreen([padded, next!], 45, SRC)).map((t) => t.trim())).toContain('words that start a new paragraph');
  });

  it('a wide cell that meets one free column moves whole to the next row', () => {
    const token = '世'.repeat(30);
    const out = wrapScreen(plainRows([token]), 45, SRC);
    expect(out.map((r) => cellsWidth(r.cells))).toEqual([44, 16]);
    expect(texts(out).join('')).toBe(token);
  });

  it('a gutter row never joins the gutter row under it', () => {
    const { model } = byName('synthetic/permission-long-label');
    const gutter = (t: string): boolean => t.startsWith('   │ ');
    const source = model.map(rowText).filter(gutter).length;
    expect(source).toBeGreaterThanOrEqual(2);
    expect(texts(wrapScreen(model, 45, SRC)).filter(gutter)).toHaveLength(source);
  });
});

describe('goldens', () => {
  const WRITE = process.env['DRAWER_GOLDEN_WRITE'] === '1';
  if (WRITE && process.env['CI']) throw new Error('DRAWER_GOLDEN_WRITE is refused under CI: CI never writes a golden');
  const PREFIX: Readonly<Record<Exclude<VisualRow['kind'], 'blank'>, string>> = { text: ' ', rule: '─', table: '⇆', right: '→' };
  const render = (out: readonly VisualRow[]): string =>
    out.map((r) => (r.kind === 'blank' ? '' : PREFIX[r.kind] + rowText(r.cells))).join('\n') + '\n';

  const cases = [...recorded, ...synthetic].flatMap((s) => WIDTHS.map((W) => ({ s, W })));
  it.each(cases)('$s.name at W=$W', ({ s, W }) => {
    const file = path.join(GOLDEN_ROOT, ...s.name.split('/')) + `.W${W}.txt`;
    const actual = render(wrapScreen(s.model, W, SRC));
    if (WRITE) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, actual);
      return;
    }
    if (!existsSync(file)) throw new Error(`no golden ${path.relative(import.meta.dirname, file)}: generate it with DRAWER_GOLDEN_WRITE=1, then read it`);
    expect(actual).toBe(readFileSync(file, 'utf8'));
  });
});

// MUTATION TABLE (D-5006), RUN 2026-10-14: each mutant edits only wrapScreen.ts, this suite runs alone
// under CI=true (the goldens are read, never written), and the file is restored after. Rows 1–7 are the
// plan's; where the plan named a red line that stayed green, the row says so and names what did red.
//
// | Mutant | Observed |
// |---|---|
// | 1 drop J4 (the same continuation indent) | (f) "J4 alone" RED. No golden reds: no recorded or synthetic screen has a long row over a deeper, unmarked one |
// | 2 drop J3 (`srcCols − 6`) | (f) "J3 alone" RED; goldens RED: synthetic/tool-output at all eight narrow W |
// | 3 the hanging indent uncapped | (b) RED at W=34 on panes/ask-2col-chat-about and panes/ask-2col-partial-redraw (a 34-space indent), not on tool-output (its indents are 5); "the hanging indent is capped" RED |
// | 4 the rule threshold at 20 | "a rule is at least half of srcCols" RED. No golden reds: no screen has a short run of rule characters alone on a row |
// | 5 character wrap | goldens RED (95), (f) RED on every paragraph below 220 (52), "the hanging indent is capped" RED. The count property stays green: collapsing blank runs keeps even a character wrap under it |
// | 6 no identity arm | (c) RED on every screen at W=220, synthetic/right-aligned among them; (f) at 220 and the W=220 goldens RED |
// | 7 a hard break that cuts a wide cell | (g) RED on synthetic/cjk-wide at W=39, 45, 87, 149, 171; "a wide cell … moves whole" RED; those goldens RED |
// | 8 the prompt's no-break space not a marker | goldens RED: recorded/2.1.299/reply-done at W=34, 39, 45 (the draft's second line loses its indent) |
// | 9 a join space after a hard-broken token | "a token Claude Code hard-broke re-joins with no space" RED; goldens RED: synthetic/tool-output and synthetic/cjk-wide |
// | 10 no trim of styled trailing spaces before a join | goldens RED: recorded/2.1.299/permission at W=34–87 (`echo  the-build…`) |
// | 11 no hard break in place (a marker or gutter left alone on its row) | goldens RED: recorded/2.1.299/permission at W=34–87, synthetic/cjk-wide at W=34 |
// | 12 J2/J3 on the cell count, not the text's end | "a row padded to the edge with styled spaces … does not join" RED |
//
// Red first: against a stub returning [], 507 of 652 cases failed (the 145 that passed were the corpus count and
// the row-count bound, which an empty output meets).
