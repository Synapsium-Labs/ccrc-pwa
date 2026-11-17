// D-8665 — THE DRAWER'S MASK NEVER MOVES WHAT THE TERMINAL DRAWS (desktop polish Task C36).
//
// The terminal drawer is a tmux CLIENT: tmux keeps its own picture of the client's screen and sends only what it
// thinks changed, with cursor moves that assume its picture is the one on the glass. The drawer's masker sits between
// the two (`server.ts`'s `/ws/pty/:id`, `DrawerMask`), so any byte it adds, drops or widens moves the glass away from
// tmux's picture, and every later redraw lands on the wrong cells.
//
// MEASURED (plan Task C36, `docs/superpowers/plans/2026-10-22-desktop-polish/c36.md`): with fingerprint rows held,
// tmux's status line ends a chunk with an open run, the date at the right edge of the last row. The hold expired, and
// the masker drew its 15-column provisional mask in place of the 9-column date. That ran past the right edge, the
// terminal wrapped and scrolled the whole screen up a row, the erase (CUB 15, ECH 15) landed on the new row, and tmux's
// next redraws wrote over a screen one row off: lines doubled, letters of two lines interleaved, stale text left in
// rows that should be blank. Through a real tmux at the drawer's 220x51, every one of the 51 rows differed from the
// raw stream's screen; with the shape-only masker (no fingerprint rows) none did.
//
// So this suite renders the drawer's stream on a REAL xterm (the headless build of the terminal the PWA draws with)
// and asserts the screen the reader sees is exactly the screen the raw stream draws.
import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Terminal } from '@xterm/headless';
import { SECRET_MASK, PINNED_WINDOW_COLS, PINNED_WINDOW_ROWS, TMUX_STATUS_ROWS } from '../../shared/api.js';
import {
  DRAWER_SECRET_MASK, SHAPE_ONLY_MASKER, SecretMasker, fingerprintGeneration, fingerprintRow,
} from '../src/accounts/mask.js';
import { SHAPE_MASK } from '../src/accounts/shapes.js';
import { openCoordDb } from '../src/coord/db.js';
import { mkTmp } from './tmpHelpers.js';
import { vi } from 'vitest';

const COLS = PINNED_WINDOW_COLS;
const ROWS = PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS;
const TOKEN = 'c3'.repeat(32);
const SECRET = 'cmp-7c19e0b4d2a65f38c1e9-b0d74a2e96f1c3587a2d';   // no repeated slice, so a later slice never matches the shown prefix

/** A masker holding one fingerprint row, as a box with a compatible lane has: the drawer then holds every open run.
 *  `more`: further keys, one lane each (D-8710's longer keys). */
const fingerprinted = (...more: string[]): SecretMasker => {
  const db = openCoordDb(path.join(mkTmp('ccrc-drawer-screen-'), 'coord.db'));
  const m = new SecretMasker({ db, token: () => TOKEN });
  m.ingest({ gen: fingerprintGeneration(TOKEN), rows: [SECRET, ...more].map((k, i) => fingerprintRow(TOKEN, `lane-${i}`, k)) });
  return m;
};

/** The chunks a node-pty `tmux attach` client hands the drawer, each with the quiet time that follows it. */
type Chunk = { text: string; quietMs: number };

/** What the drawer sends for `chunks`, on fake timers so every expired hold expires exactly where it would. */
const throughDrawer = (m: SecretMasker, chunks: readonly Chunk[]): string => {
  vi.useFakeTimers();
  const out: string[] = [];
  const d = m.drawer((t) => out.push(t));
  for (const c of chunks) {
    d.push(c.text);
    vi.advanceTimersByTime(c.quietMs);
  }
  d.dispose();
  vi.useRealTimers();
  return out.join('');
};

/** The screen a 220x51 xterm shows for `stream`: every row, trailing blanks cut. */
const screenOf = async (stream: string): Promise<string[]> => {
  const t = new Terminal({ cols: COLS, rows: ROWS, scrollback: 0, allowProposedApi: true });
  await new Promise<void>((r) => t.write(stream, r));
  const b = t.buffer.active;
  const rows: string[] = [];
  for (let y = 0; y < ROWS; y++) rows.push(b.getLine(b.viewportY + y)?.translateToString(true) ?? '');
  t.dispose();
  return rows;
};

const at = (row: number, col: number): string => `\x1b[${row};${col}H`;
const WORDS = ['round', 'found', 'more', 'classes', 'parser', 'closed', 'review', 'evidence', 'scan', 'keeps'];
/** A line of neutral words, `n` characters long or a little less. */
const prose = (seed: number, n: number): string => {
  let s = `${seed}.`;
  for (let k = seed; s.length + 12 < n; k += 3) s += ` ${WORDS[k % WORDS.length]}`;
  return s;
};

/** tmux's status row: the window list on the left and the default `status-right`, its date ending in the last column
 *  — which is where the chunk ends, so the date is the open run an expired hold acts on. */
const statusRow = (clock: string): string => {
  const left = '[cc-demo] 0:claude*';
  const right = `"demo-title" ${clock} 16-Nov-26`;
  return `${at(ROWS, 1)}\x1b[30m\x1b[42m${left}${' '.repeat(COLS - left.length - right.length)}${right}`;
};

/** tmux's first paint of the client: 50 rows of output and the status row, then the cursor parked on the input row. */
const firstPaint = (): string => {
  let s = '\x1b[?1049h\x1b[H\x1b[2J';
  for (let r = 1; r <= PINNED_WINDOW_ROWS; r++) s += `${at(r, 1)}\x1b[m${prose(r, 60 + ((r * 37) % 150))}`;
  return s + statusRow('13:57');
};

/** A redraw the way Claude Code's renderer does one, as tmux forwards it: from the input row, up over the live block,
 *  erase each line and write it again, and the status row's clock ticking at the end. */
const redraw = (tick: number): string => {
  let s = `\x1b[m${at(PINNED_WINDOW_ROWS, 1)}\r\x1b[3A`;
  for (let k = 0; k < 4; k++) s += `\x1b[2K${prose(100 * tick + k, 80 + 30 * k)}${k < 3 ? '\r\n' : ''}`;
  return s + statusRow(`14:0${tick}`);
};

/** The rows that are on the screen twice. A status row and blank rows are never doubled content. */
const doubled = (rows: readonly string[]): string[] => {
  const seen = new Set<string>();
  const twice: string[] = [];
  for (const r of rows.slice(0, PINNED_WINDOW_ROWS)) {
    if (r.trim() === '') continue;
    if (seen.has(r)) twice.push(r);
    seen.add(r);
  }
  return twice;
};

describe('D-8665 — the drawer\'s mask never moves what the terminal draws', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('an expired hold on the status row\'s date leaves the screen exactly as the raw stream draws it', async () => {
    // The first paint ends on the date and the output goes quiet for longer than two holds; then three redraws, each
    // ending on the date again, each followed by a quiet gap.
    const chunks: Chunk[] = [{ text: firstPaint(), quietMs: 40 }];
    for (let tick = 1; tick <= 3; tick++) chunks.push({ text: redraw(tick), quietMs: 40 });
    const raw = chunks.map((c) => c.text).join('');
    const m = fingerprinted();
    try {
      const shown = await screenOf(throughDrawer(m, chunks));
      const truth = await screenOf(raw);
      expect(doubled(shown), 'a row drawn twice').toEqual([]);
      expect(shown.join('\n')).not.toContain(SECRET_MASK);
      expect(shown.at(-1)!.endsWith('16-Nov-26'), `status row: ${shown.at(-1)}`).toBe(true);
      expect(shown).toEqual(truth);
    } finally {
      m.close();
    }
  });

  it('a stream with no secret in it reaches the terminal byte for byte, wherever a quiet gap cuts it', () => {
    // The same frames, cut at every 97th byte with a gap longer than two holds after each cut: whatever run a cut
    // leaves open is held, expires, and must come out as the bytes it was, never as a mark in its place. The stream
    // ends as tmux ends a frame, parking the cursor (measured off a real attach), so its last run is closed too.
    const raw = `${firstPaint()}${redraw(1)}${redraw(2)}\x1b(B\x1b[m\x1b[?12l\x1b[?25h${at(PINNED_WINDOW_ROWS, 3)}`;
    const m = fingerprinted();
    try {
      for (let cut = 1; cut < raw.length; cut += 97) {
        const sent = throughDrawer(m, [{ text: raw.slice(0, cut), quietMs: 40 }, { text: raw.slice(cut), quietMs: 40 }]);
        expect(sent, `cut at ${cut}`).toBe(raw);
      }
    } finally {
      m.close();
    }
  });

  it('a fingerprinted key typed one key at a time still never shows past its first 19 bytes, and the screen stays tmux\'s', async () => {
    // The fail-closed half of D-5995 is unchanged: a run that could still be the key is withheld from the moment its
    // hold expires until it ends, and the completed key is drawn masked.
    const prompt = `${at(PINNED_WINDOW_ROWS, 1)}\x1b[m> `;
    const chunks: Chunk[] = [{ text: firstPaint() + prompt, quietMs: 40 }];
    for (const ch of SECRET) chunks.push({ text: ch, quietMs: 30 });
    chunks.push({ text: ' ', quietMs: 40 }, { text: redraw(1), quietMs: 40 });
    const m = fingerprinted();
    try {
      // Every intermediate screen: no 20-byte prefix of the key, and no slice of it past that.
      for (let n = 1; n <= chunks.length; n++) {
        const rows = await screenOf(throughDrawer(m, chunks.slice(0, n)));
        const text = rows.join('\n');
        for (let i = 19; i + 8 <= SECRET.length; i++) expect(text, `after ${n} chunks`).not.toContain(SECRET.slice(i, i + 8));
      }
      const shown = await screenOf(throughDrawer(m, chunks));
      expect(doubled(shown), 'a row drawn twice').toEqual([]);
      expect(shown.at(-1)!.endsWith('16-Nov-26'), `status row: ${shown.at(-1)}`).toBe(true);
    } finally {
      m.close();
    }
  });

  it('no byte of a withheld run reaches the screen before it resolves, and none ever does when it never resolves', async () => {
    // Drawn as nothing must stay fail-closed: the run is withheld from its hold's expiry on, through every quiet gap,
    // and when the drawer is closed with the run still open (it never resolves) nothing of it was ever sent. Each case
    // writes its run on a row of its own, so the row's text is exactly what reached the screen.
    const ROW = 20;
    const QUIET = [1, 6, 12, 13, 50, 1_000, 60_000];
    const m = fingerprinted();
    try {
      // A burst of output that ends inside a run that could be the key: none of the run is shown, at any time.
      const burst = `${firstPaint()}${at(ROW, 1)}\x1b[m\x1b[2Kkey: ${SECRET.slice(0, 30)}`;
      for (const quietMs of QUIET) {
        const rows = await screenOf(throughDrawer(m, [{ text: burst, quietMs }]));
        expect(rows[ROW - 1], `a burst, ${quietMs} ms quiet`).toBe('key: ');
      }
      // Typed one key at a time: the first 19 bytes show (D-5995's accepted gap); not one byte after them, at any time.
      const typed: Chunk[] = [{ text: `${firstPaint()}${at(ROW, 1)}\x1b[m\x1b[2K> `, quietMs: 40 }];
      for (const ch of SECRET.slice(0, 30)) typed.push({ text: ch, quietMs: 30 });
      for (const quietMs of QUIET) {
        const last = typed.at(-1)!;
        const rows = await screenOf(throughDrawer(m, [...typed.slice(0, -1), { text: last.text, quietMs }]));
        expect(rows[ROW - 1], `typed, ${quietMs} ms quiet`).toBe(`> ${SECRET.slice(0, 19)}`);
      }
    } finally {
      m.close();
    }
  });
});

// D-8694 — A MASKED KEY IS ONE COLUMN PER ROW IT TOUCHES (desktop polish Task C39).
//
// MEASURED (`docs/superpowers/plans/2026-10-22-desktop-polish/c39.md`, review 2248 F1): the drawer's FINAL mark was
// `SECRET_MASK`, 15 columns, one per row segment of a key. A segment narrower than that, starting in its row's last 14
// columns (the head of a key the program broke across rows, or a whole short shape key), ran past the right edge; so did
// the text after a short tail, pushed right by the mark. The terminal wrapped, every later relative move landed a row
// off, and tmux's move down to the pane's last row wrote over the status row. A width-keeping mark would show the key's
// length, so the coordinator ruled the one-column mark (option C): never wider than any text it replaces, and the same
// width whatever the key is. Every other egress keeps `SECRET_MASK`.
describe('D-8694 — a masked key is one column per row it touches, so no other row moves', () => {
  afterEach(() => { vi.useRealTimers(); });

  const SK = 'sk-Q7m2Xv9LpT4cR8nW1zK6bY3hJ5dF0gA2sE7uN4';   // synthetic, shape-only
  /** The key's line, its first character at column `col`: on one row (`head` null) or broken after `head` characters
   *  by `ESC[K CR LF` and a two-column indent, as a program that hard-wraps a long token draws it. Then the frame goes on
   *  the way tmux forwards one: with no scroll region, the key at row 20, `CR LF` and a relative move down to the pane's
   *  last row, where it writes; with tmux's scroll region (`scroll`), the key on the pane's second-last row, `CR LF`
   *  (scrolling the pane when the key was broken) and a relative rewrite of the row three above. The cursor is parked
   *  last, so no run is left open. */
  const keyFrame = (key: string, col: number, head: number | null, after: string, scroll: boolean): string => {
    const row = scroll ? PINNED_WINDOW_ROWS - 1 : 20;
    const pre = `${'x'.repeat(col - 6)}key: `;
    const line = head === null ? `${at(row, 1)}\x1b[m\x1b[2K${pre}${key}${after}\x1b[K`
      : `${at(row, 1)}\x1b[m\x1b[2K${pre}${key.slice(0, head)}\x1b[K\r\n\x1b[2K  ${key.slice(head)}${after}\x1b[K`;
    const next = scroll
      ? `\r\nfinished\x1b[K\r\x1b[3A\x1b[2K${prose(300, 60)}`
      : `\r\n\x1b[${PINNED_WINDOW_ROWS - row - (head === null ? 1 : 2)}B\r\x1b[2K* Working... (11s)`;
    return `${firstPaint()}${scroll ? `\x1b[1;${PINNED_WINDOW_ROWS}r` : ''}${line}${next}\x1b[?25h${at(PINNED_WINDOW_ROWS, 3)}`;
  };
  /** The drawer's screen against the raw stream's: every row that does not hold the key is the raw row, the status row
   *  included; the key's rows are the raw rows with each segment of the key drawn as one `DRAWER_SECRET_MASK`; and no
   *  slice of the key is anywhere on the screen. */
  const expectOneColumnMarks = async (m: SecretMasker, key: string, col: number, head: number | null, after: string,
    scroll: boolean): Promise<void> => {
    const frame = keyFrame(key, col, head, after, scroll);
    const truth = await screenOf(frame);
    const shown = await screenOf(throughDrawer(m, [{ text: frame, quietMs: 40 }]));
    const where = `key at column ${col}, head ${head ?? 'whole'}, ${scroll ? 'scroll region' : 'relative move'}`;
    const pre = `${'x'.repeat(col - 6)}key: `;
    const headAt = truth.findIndex((r) => r.startsWith(pre));
    expect(headAt, `${where}: the key's row on the raw screen`).toBeGreaterThanOrEqual(0);
    const keyRows = head === null ? [headAt] : [headAt, headAt + 1];
    for (let y = 0; y < ROWS; y++) {
      if (keyRows.includes(y)) continue;
      expect(shown[y], `${where}: row ${y + 1}`).toBe(truth[y]);
    }
    if (head === null) {
      expect(shown[headAt], `${where}: the key's row`).toBe(`${pre}${DRAWER_SECRET_MASK}${after}`.trimEnd());
    } else {
      expect(shown[headAt], `${where}: the head's row`).toBe(`${pre}${DRAWER_SECRET_MASK}`);
      expect(shown[headAt + 1], `${where}: the tail's row`).toBe(`  ${DRAWER_SECRET_MASK}${after}`.trimEnd());
    }
    const text = shown.join('\n');
    for (let i = 0; i + 6 <= key.length; i++) expect(text, `${where}: a slice of the key`).not.toContain(key.slice(i, i + 6));
  };

  it('a key broken across rows with its head in the row\'s last 14 columns moves no other row, the status row included', async () => {
    const fp = fingerprinted();
    try {
      for (const scroll of [false, true]) {
        for (let col = COLS - 13; col <= COLS; col++) {
          await expectOneColumnMarks(fp, SECRET, col, COLS - col + 1, ' done.', scroll);   // broken at the right edge
          await expectOneColumnMarks(SHAPE_ONLY_MASKER, SK, col, COLS - col + 1, ' done.', scroll);
          if (col <= COLS - 7) {   // broken 7 columns before the edge, as a program wrapping at its own width does
            await expectOneColumnMarks(fp, SECRET, col, COLS - 7 - col + 1, ' done.', scroll);
            await expectOneColumnMarks(SHAPE_ONLY_MASKER, SK, col, COLS - 7 - col + 1, ' done.', scroll);
          }
        }
      }
    } finally {
      fp.close();
    }
  });

  it('a short tail followed by text that reaches the right edge moves no other row', async () => {
    const fp = fingerprinted();
    try {
      for (const scroll of [false, true]) {
        const after = ` ${'w'.repeat(COLS - 2 - 6 - 1 - 2)}`;   // the tail's row ends two columns short of the edge
        await expectOneColumnMarks(fp, SECRET, 100, SECRET.length - 6, after, scroll);
        await expectOneColumnMarks(SHAPE_ONLY_MASKER, SK, 100, SK.length - 6, after, scroll);
      }
    } finally {
      fp.close();
    }
  });

  it('a whole shape key shorter than the old mark, ending its row at columns 217 to 220, moves no other row', async () => {
    for (const scroll of [false, true]) {
      for (let col = COLS - 13; col <= COLS - 10; col++) await expectOneColumnMarks(SHAPE_ONLY_MASKER, 'sk-Ab3dE5gH', col, null, '', scroll);
    }
  });

  it('the status row is never written over by a row the mark pushed down', async () => {
    // Review 2248's shape: a key broken at row 20 with a 6-column head at column 215, then tmux's relative move down to
    // the pane's last row. On main the glass is a row lower there, and `* Working...` lands on the status row.
    const frame = keyFrame(SK, COLS - 5, 6, ' done.', false);
    const shown = await screenOf(throughDrawer(SHAPE_ONLY_MASKER, [{ text: frame, quietMs: 40 }]));
    const truth = await screenOf(frame);
    expect(shown.at(-1), 'the status row').toBe(truth.at(-1));
    expect(shown.at(-1)!.endsWith('16-Nov-26')).toBe(true);
    expect(shown[PINNED_WINDOW_ROWS - 1]).toBe('* Working... (11s)');
  });

  it('the mark is one column in xterm\'s own width table, and is no character Claude Code draws', async () => {
    // U+2327 X IN A RECTANGLE BOX, the ISO 9995-7 "clear" key: East Asian Width N (Neutral) in the UCD's
    // EastAsianWidth.txt, so a terminal that widens Ambiguous characters (U+2022 BULLET, U+2592, U+203B) still draws it
    // in one column; general category So, never a mark or a format character; not ASCII, not box drawing or a block
    // element, and not in the Claude Code build this task checked (c39.md), whose glyphs are listed here.
    expect(DRAWER_SECRET_MASK).toBe('⌧');
    expect([...DRAWER_SECRET_MASK]).toHaveLength(1);
    const cp = DRAWER_SECRET_MASK.codePointAt(0)!;
    expect(cp).toBeGreaterThan(0x7f);
    expect(cp >= 0x2500 && cp <= 0x259f, 'box drawing or a block element').toBe(false);
    expect(/^[\p{M}\p{Cf}]$/u.test(DRAWER_SECRET_MASK), 'a mark or a format character').toBe(false);
    const CLAUDE_CODE_GLYPHS = '⏺⎿●○◯·•✻✶✳✢✽✓✔✗✘☐☒❯›※▪▫↓↑→←⧉▐▛▜▌▝▘⏵⏸';
    expect(CLAUDE_CODE_GLYPHS).not.toContain(DRAWER_SECRET_MASK);
    // xterm's width table, the PWA's terminal: the mark advances the cursor one column, between two ASCII characters.
    // That table (Unicode 6, xterm 6.0.0's only one) cannot tell Neutral from Ambiguous: it gives U+2022, U+2592 and
    // U+26BF (East Asian Width A) one column too. So "never Ambiguous" is held by the literal pin above: U+2327's East
    // Asian Width class is N (Neutral) in the UCD's EastAsianWidth.txt, which no terminal widens.
    const t = new Terminal({ cols: 20, rows: 2, scrollback: 0, allowProposedApi: true });
    try {
      await new Promise<void>((r) => t.write(`a${DRAWER_SECRET_MASK}b`, r));
      expect(t.buffer.active.cursorX).toBe(3);
      expect(t.buffer.active.getLine(0)!.translateToString(true)).toBe(`a${DRAWER_SECRET_MASK}b`);
      expect(t.buffer.active.getLine(0)!.getCell(1)!.getWidth()).toBe(1);
    } finally {
      t.dispose();
    }
  });

  it('a masked key is one mark per row it touches whatever its length, and no SGR sits around a mark', () => {
    // The ruled property (option C): the mark reveals nothing about a key's length, so the number of marks follows the
    // rows a key touches and nothing else. Shape keys (any length the shape takes), swept, not sampled (review 2326 F1,
    // desktop polish Task C41): every whole key from 11 characters to 215 on one row; hard-wrapped by a program at 60,
    // 100, 120 and 200 columns onto two and three rows (every row as full as the first) with every length of the last
    // row, and at 120 columns on to the run ceiling, `RUN_MAX_BYTES`; and every key of 15 to 40 characters starting at
    // each column from 150 to 220 (past 220 the terminal wraps it, and it is still one run, one mark). Review 2307's o1c
    // (a second mark for a segment of 110 or more) and review 2326's m1 (over 200), m2 (a wrapped segment over 118), m4
    // (exactly 17) and m6c (15 or more from column 207) each red here.
    const alnum = 'Q7m2Xv9LpT4cR8nW1zK6bY3hJ5dF0gA2sE7uN4oPqZ8iVt';
    const keyOf = (n: number): string => {
      let k = 'sk-';
      for (let i = 0; k.length < n; i++) k += alnum[(i * 7 + Math.floor(i / alnum.length)) % alnum.length];
      return k;
    };
    const park = `\x1b[?25h${at(PINNED_WINDOW_ROWS, 3)}`;
    const cases: { name: string; key: string; frame: string; rows: number }[] = [];
    for (let n = 11; n <= 215; n++) {
      const key = keyOf(n);
      cases.push({ name: `a whole key of ${n} characters on one row`, key, rows: 1,
        frame: `${at(10, 1)}\x1b[m\x1b[2Kkey: ${key} done.\x1b[K${park}` });
    }
    const wrapped = (n: number, W: number): void => {
      const key = keyOf(n);
      const lines = [`key: ${key.slice(0, W - 5)}`];
      for (let at0 = W - 5; at0 < n; at0 += W - 2) lines.push(`  ${key.slice(at0, at0 + W - 2)}`);
      cases.push({ name: `a key of ${n} characters wrapped at ${W} columns onto ${lines.length} rows`, key, rows: lines.length,
        frame: `${at(2, 1)}\x1b[m\x1b[2K${lines.join('\x1b[K\r\n')} done.\x1b[K${park}` });
    };
    for (const W of [60, 100, 120, 200]) {
      for (let last = 1; last <= W - 2; last++) for (const rows of [2, 3]) wrapped(W - 5 + (rows - 2) * (W - 2) + last, W);
    }
    for (const n of [500, 1_000, 2_000, 8_192]) wrapped(n, 120);
    for (let col = 150; col <= COLS; col++) {
      for (let n = 15; n <= 40; n++) {
        const key = keyOf(n);
        cases.push({ name: `a key of ${n} characters from column ${col}`, key, rows: 1,
          frame: `${at(10, 1)}\x1b[m\x1b[2K${at(10, col)}${key}${park}` });
      }
    }
    const sgrBeside = new RegExp(`\x1b\\[[0-9;]*m${DRAWER_SECRET_MASK}|${DRAWER_SECRET_MASK}\x1b\\[[0-9;]*m`);
    for (const c of cases) {
      const drawn = throughDrawer(SHAPE_ONLY_MASKER, [{ text: c.frame, quietMs: 40 }]);
      expect(drawn.split(DRAWER_SECRET_MASK).length - 1, `${c.name}: marks`).toBe(c.rows);
      expect(sgrBeside.test(drawn), `${c.name}: SGR beside a mark`).toBe(false);
      const shown: string[] = [];
      for (let i = 0; i + 8 <= c.key.length; i += 4) if (drawn.includes(c.key.slice(i, i + 8))) shown.push(c.key.slice(i, i + 8));
      expect(shown, `${c.name}: a slice of the key`).toEqual([]);
    }
  });

  it('every other egress is byte for byte what it was: the mark is the drawer\'s alone', async () => {
    // The digests are of each egress's output for this input on main before C39 (b99bc6390), where every egress drew
    // `SECRET_MASK`; the drawer alone changed.
    const input = [
      `key: ${SECRET} done\r\n`,
      `${'x'.repeat(201)}key: ${SECRET.slice(0, 6)}\x1b[K\r\n  ${SECRET.slice(6)} done.\r\n`,
      `${'x'.repeat(201)}key: ${SK.slice(0, 6)}\x1b[K\r\n  ${SK.slice(6)} done.\r\n`,
      'token sk-Ab3dE5gH\r\n',
      '{"access_token":"abc.def"}\r\n',
      `\x1b[32m${SK.slice(0, 9)}\x1b[0m${SK.slice(9)} end\r\n`,
    ].join('');
    // Past `SLICE_UNITS` (64 Ki), so `maskTextSliced` takes its sliced arm, not its one-slice shortcut.
    const long = Array.from({ length: 100 }, () => input).join('');
    expect(long.length).toBeGreaterThan(64 * 1024);
    const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
    const m = fingerprinted();
    try {
      const out = {
        maskTextRows: m.maskText(input, { rows: true }),
        maskText: m.maskText(input),
        maskWithCarryRows: m.maskWithCarry(input, { rows: true }).text,
        maskTextSliced: await m.maskTextSliced(input, { rows: true }),
        maskTextSlicedLong: await m.maskTextSliced(long, { rows: true }),
        maskDeep: m.maskDeep({ s: input }).s,
        shapeMaskDeep: SHAPE_MASK.maskDeep({ s: input }).s,
        shapeOnlyRows: SHAPE_ONLY_MASKER.maskText(input, { rows: true }),
      };
      expect(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, sha(v)]))).toEqual({
        maskTextRows: 'b4fc57c6be4aa5874ebabb6af0c7aa7f020b04d67f654ec26f6b5bd16ac14972',
        maskText: '90ef9169ab27a90fa16dc2d17487f6d712cba1a358a85ae47a260ae95e477620',
        maskWithCarryRows: 'b4fc57c6be4aa5874ebabb6af0c7aa7f020b04d67f654ec26f6b5bd16ac14972',
        maskTextSliced: 'b4fc57c6be4aa5874ebabb6af0c7aa7f020b04d67f654ec26f6b5bd16ac14972',
        maskTextSlicedLong: '7ae2efd145733bd73d6eeabba1f9563578db76c019827e02e665a7db21555d36',
        maskDeep: '90ef9169ab27a90fa16dc2d17487f6d712cba1a358a85ae47a260ae95e477620',
        shapeMaskDeep: '3f7c28de895b93e277defc5daa3f1f1f14fa66725e431c705e3a199e5c3b102f',
        shapeOnlyRows: '3a538a9013bfca21072be39cff187a2c93d3987a574ee34de2c7c4dd82300f6c',
      });
      for (const v of Object.values(out)) expect(v).not.toContain(DRAWER_SECRET_MASK);
      expect(out.maskTextRows.split(SECRET_MASK)).toHaveLength(9);   // eight marks, as before
      // And the drawer, on the same input, draws the one-column mark where the others draw `SECRET_MASK`.
      const drawn = throughDrawer(m, [{ text: input, quietMs: 40 }]);
      expect(drawn).not.toContain(SECRET_MASK);
      expect(drawn.split(DRAWER_SECRET_MASK)).toHaveLength(9);
    } finally {
      m.close();
    }
  });
});

// D-8710 — A KEY A PROGRAM DRAWS ACROSS THREE OR MORE ROWS IS MASKED ON EVERY ROW (desktop polish Task C41).
//
// MEASURED (review 2326 F3; `docs/superpowers/programs/desktop-polish/c41.md`): the exact-bytes row join read a
// run that ends its row with the next row's leading run only, so a fingerprinted key a program drew on three or more
// rows reached the screen with every byte and no mark, under every row separator: the review's 45 characters at
// 17/20/8 and 12/15/15/3, and a 500-character key at 220 columns, which a real tmux 3.6 forwards with a cursor position
// and the indent before each row. The join now walks every row the key fills, and each row it touches shows one mark.
describe('D-8710 — a key drawn across three or more rows shows no byte and one mark per row', () => {
  afterEach(() => { vi.useRealTimers(); });

  /** The separators between a line's rows, each after the row's `ESC[K`: what a program writes (CR LF and an indent),
   *  what tmux forwards (a cursor position and the indent, or to the third column), a cursor move forward after CR LF,
   *  NEL, and a move down then CR (CUD or IND, review 2326 O2). */
  const SEPS: { name: string; sep: (row: number) => string }[] = [
    { name: 'CR LF and an indent', sep: () => '\r\n  ' },
    { name: 'a cursor position and the indent', sep: (r) => `${at(r, 1)}  ` },
    { name: 'a cursor position at the third column', sep: (r) => at(r, 3) },
    { name: 'CR LF and CUF 2', sep: () => '\r\n\x1b[2C' },
    { name: 'NEL', sep: () => '\x1bE' },
    { name: 'CUD, CR and CUF 2', sep: () => '\x1b[B\r\x1b[2C' },
    { name: 'IND, CR and an indent', sep: () => '\x1bD\r  ' },
  ];
  const ROW = 20;
  /** `key` drawn from row `ROW` after `key: `, in rows of `parts` characters joined by `sep`, then ` done.`, on the
   *  first paint with the key's rows erased first; the cursor parked last, so no run is left open. */
  const frameOf = (key: string, parts: readonly number[], sep: (row: number) => string): string => {
    let s = firstPaint();
    for (let r = ROW; r < ROW + parts.length; r++) s += `${at(r, 1)}\x1b[2K`;
    s += `${at(ROW, 1)}\x1b[mkey: `;
    let i = 0;
    parts.forEach((p, k) => { if (k > 0) s += `\x1b[K${sep(ROW + k)}`; s += key.slice(i, i + p); i += p; });
    return `${s} done.\x1b[K\x1b[?25h${at(PINNED_WINDOW_ROWS, 3)}`;
  };
  /** The drawer's screen for `chunks` against the raw stream's: every row the key does not touch is the raw row; each
   *  row it touches is the raw row with the key's segment drawn as one `DRAWER_SECRET_MASK`; no slice of 6 of the key
   *  is anywhere on the screen. */
  const expectMasked = async (m: SecretMasker, key: string, parts: readonly number[], frame: string, where: string,
    chunks: readonly Chunk[] = [{ text: frame, quietMs: 40 }]): Promise<void> => {
    const truth = await screenOf(frame);
    const shown = await screenOf(throughDrawer(m, chunks));
    let i = 0;
    const segs = parts.map((p) => { const s = key.slice(i, i + p); i += p; return s; });
    for (let y = 0; y < ROWS; y++) {
      const k = y - (ROW - 1);
      if (k < 0 || k >= parts.length) { expect(shown[y], `${where}: row ${y + 1}`).toBe(truth[y]); continue; }
      expect(truth[y], `${where}: the raw row ${y + 1} holds its segment`).toContain(segs[k]);
      expect(shown[y], `${where}: row ${y + 1}, the key's row ${k + 1}`).toBe(truth[y]!.replace(segs[k]!, DRAWER_SECRET_MASK));
    }
    const text = shown.join('\n');
    const leaked: string[] = [];
    for (let j = 0; j + 6 <= key.length; j++) if (text.includes(key.slice(j, j + 6))) leaked.push(key.slice(j, j + 6));
    expect(leaked, `${where}: a slice of the key on the screen`).toEqual([]);
  };

  it('a fingerprinted key on three and on four rows is one mark per row under every separator', async () => {
    // The review's splits of a 45-character key, and the same key with the rows in other lengths: a short head, and
    // middle rows of 12 characters, the fewest a key's row join runs through (`WRAP_ROW_MIN`).
    const m = fingerprinted();
    try {
      for (const s of SEPS) {
        for (const parts of [[17, 20, 8], [12, 15, 15, 3], [5, 20, 20], [20, 12, 12, 1]]) {
          await expectMasked(m, SECRET, parts, frameOf(SECRET, parts, s.sep), `${parts.join('/')}, ${s.name}`);
        }
      }
    } finally {
      m.close();
    }
  });

  it('a shapeless key of 500 characters at 220 columns, as tmux forwards it, is masked on its three rows, whole or cut', async () => {
    // 215, 218 and 67 characters, each row after the first reached by a cursor position and drawn after its indent:
    // the frame a real tmux 3.6 sent when a program drew the key with CR LF and an indent (measured, c41.md). Then the
    // same frame cut into two chunks at every 41st byte, with no gap and with a hold that expires in the gap.
    let x = 0x5eed;
    const KEY = Array.from({ length: 500 }, (_, i) => {
      x = (x * 1103515245 + 12345) >>> 0;
      return i % 9 === 8 ? '-' : 'abcdefghijklmnopqrstuvwxyz0123456789'[(x >>> 16) % 36]!;
    }).join('');
    for (let i = 0; i + 8 <= KEY.length; i++) expect(KEY.indexOf(KEY.slice(i, i + 8)), 'every slice of 8 is its own').toBe(i);
    const parts = [215, 218, 67];
    const m = fingerprinted(KEY);
    try {
      const frame = frameOf(KEY, parts, SEPS[1]!.sep);
      await expectMasked(m, KEY, parts, frame, 'whole');
      const keyAt = frame.indexOf(KEY.slice(0, 8));
      // Each row end: from the row's `ESC[K` to the next row's first key byte.
      const rowEnds: [number, number][] = [];
      let done = 0;
      for (const p of parts.slice(0, -1)) {
        const end = frame.indexOf(KEY.slice(done + p - 8, done + p)) + 8;
        done += p;
        rowEnds.push([end, frame.indexOf(KEY.slice(done, done + 8))]);
      }
      for (let cut = keyAt - 3; cut < frame.length; cut += 41) {
        for (const quietMs of [0, 40]) {
          // A quiet gap between a row's end and the next row's first byte is D-5995's accepted gap (a quiet row end is
          // the line's end): that cut is measured with no gap only.
          if (quietMs > 0 && rowEnds.some(([a, b]) => cut >= a && cut <= b)) continue;
          await expectMasked(m, KEY, parts, frame, `cut at ${cut}, ${quietMs} ms quiet`,
            [{ text: frame.slice(0, cut), quietMs }, { text: frame.slice(cut), quietMs: 40 }]);
        }
      }
    } finally {
      m.close();
    }
  });
});
