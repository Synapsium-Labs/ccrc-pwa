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

/** A masker holding one fingerprint row, as a box with a compatible lane has: the drawer then holds every open run. */
const fingerprinted = (): SecretMasker => {
  const db = openCoordDb(path.join(mkTmp('ccrc-drawer-screen-'), 'coord.db'));
  const m = new SecretMasker({ db, token: () => TOKEN });
  m.ingest({ gen: fingerprintGeneration(TOKEN), rows: [fingerprintRow(TOKEN, 'lane-a', SECRET)] });
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
    const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
    const m = fingerprinted();
    try {
      const out = {
        maskTextRows: m.maskText(input, { rows: true }),
        maskText: m.maskText(input),
        maskWithCarryRows: m.maskWithCarry(input, { rows: true }).text,
        maskTextSliced: await m.maskTextSliced(input, { rows: true }),
        maskDeep: m.maskDeep({ s: input }).s,
        shapeMaskDeep: SHAPE_MASK.maskDeep({ s: input }).s,
        shapeOnlyRows: SHAPE_ONLY_MASKER.maskText(input, { rows: true }),
      };
      expect(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, sha(v)]))).toEqual({
        maskTextRows: 'b4fc57c6be4aa5874ebabb6af0c7aa7f020b04d67f654ec26f6b5bd16ac14972',
        maskText: '90ef9169ab27a90fa16dc2d17487f6d712cba1a358a85ae47a260ae95e477620',
        maskWithCarryRows: 'b4fc57c6be4aa5874ebabb6af0c7aa7f020b04d67f654ec26f6b5bd16ac14972',
        maskTextSliced: 'b4fc57c6be4aa5874ebabb6af0c7aa7f020b04d67f654ec26f6b5bd16ac14972',
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
