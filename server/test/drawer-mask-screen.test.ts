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
import path from 'node:path';
import { Terminal } from '@xterm/headless';
import { SECRET_MASK, PINNED_WINDOW_COLS, PINNED_WINDOW_ROWS, TMUX_STATUS_ROWS } from '../../shared/api.js';
import { SecretMasker, fingerprintGeneration, fingerprintRow } from '../src/accounts/mask.js';
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
  return s + statusRow(`13:5${7 + tick}`);
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
    // leaves open is held, expires, and must come out as the bytes it was, never as a mark in its place.
    const raw = firstPaint() + redraw(1) + redraw(2);
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
});
