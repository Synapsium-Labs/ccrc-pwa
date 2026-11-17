// D-8710 — A KEY ACROSS ANY NUMBER OF ROWS IS MASKED, WHATEVER SEPARATES THEM (desktop polish Task C41).
//
// MEASURED (review 2326 F3, O1, O2; `docs/superpowers/plans/2026-10-22-desktop-polish/c41.md`): the exact-bytes row join
// took a run that ends its row together with the NEXT row's leading run only, so a fingerprinted key that no shape
// matches, drawn by a program onto three or more rows, reached the drawer and pane history with every byte and no mark,
// under every row separator. Through a real tmux 3.6 at 220 columns, a 500-character key drawn on three rows arrived
// whole. And the drawer, holding back only the last row's run of a text, sent the rows before it unjoined, so even a
// two-row key whose last row ended a chunk drew its first row in full (a real tmux paint ends that way). A shape key
// longer than a drawer holds was masked for one chunk, then drawn (O1); and a move down then a carriage return (CUD+CR,
// IND+CR) between rows split a key the join never saw (O2).
//
// Synthetic keys only. Each key is drawn so that no slice of 8 of it can appear by chance in what surrounds it.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { SECRET_MASK, SECRET_MASK_TOO_LARGE } from '../../shared/api.js';
import {
  DRAWER_SECRET_MASK, SHAPE_ONLY_MASKER, SecretMasker, fingerprintGeneration, fingerprintRow,
} from '../src/accounts/mask.js';
import { openCoordDb } from '../src/coord/db.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'c3'.repeat(32);
/** A masker holding fingerprint rows for `keys`, as a box with compatible lanes has. */
const fingerprinted = (...keys: string[]): SecretMasker => {
  const db = openCoordDb(path.join(mkTmp('ccrc-drawer-rows-'), 'coord.db'));
  const m = new SecretMasker({ db, token: () => TOKEN, log: () => {} });
  m.ingest({ gen: fingerprintGeneration(TOKEN), rows: keys.map((k, i) => fingerprintRow(TOKEN, `lane-${i}`, k)) });
  return m;
};
/** A shapeless key of `n` characters: lowercase and digits with a dash every ninth, from a fixed generator, so every
 *  slice of 8 is its own. */
const keyOf = (n: number, seed: number): string => {
  let x = (seed * 2654435761) >>> 0;
  const A = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = 'cmp-';
  while (s.length < n) { x = (x * 1103515245 + 12345) >>> 0; s += s.length % 9 === 8 ? '-' : A[(x >>> 16) % A.length]; }
  return s.slice(0, n);
};
/** A shape key of `n` characters (`sk-` and letters and digits). */
const skOf = (n: number): string => `sk-${keyOf(n + 1, 5).slice(4).replace(/-/g, 'Q')}`.slice(0, n);
const at = (r: number, c: number): string => `\x1b[${r};${c}H`;
/** Every slice of 8 of `key` that `out` holds. */
const slicesIn = (key: string, out: string): string[] => {
  const hit: string[] = [];
  for (let i = 0; i + 8 <= key.length; i++) if (out.includes(key.slice(i, i + 8))) hit.push(key.slice(i, i + 8));
  return hit;
};
const count = (s: string, mark: string): number => s.split(mark).length - 1;

/** The row separators a program, a TUI or tmux draws between the rows of one line, and the columns of indent each
 *  leaves: CR LF and LF with an indent, CR LF alone, tmux's cursor position at the first or third column, CR LF and a
 *  cursor move forward, NEL, CNL, and a move down (CUD or IND) then CR, with or without an indent after it. */
const SEPS: { name: string; indent: number; sep: (row: number) => string }[] = [
  { name: 'CR LF and an indent', indent: 2, sep: () => '\r\n  ' },
  { name: 'CR LF', indent: 0, sep: () => '\r\n' },
  { name: 'LF and an indent', indent: 2, sep: () => '\n  ' },
  { name: 'CUP to the first column and an indent', indent: 2, sep: (r) => `${at(r, 1)}  ` },
  { name: 'CUP to the first column', indent: 0, sep: (r) => at(r, 1) },
  { name: 'CUP to the third column', indent: 2, sep: (r) => at(r, 3) },
  { name: 'CR LF and CUF 2', indent: 2, sep: () => '\r\n\x1b[2C' },
  { name: 'NEL', indent: 0, sep: () => '\x1bE' },
  { name: 'CNL', indent: 0, sep: () => '\x1b[E' },
  { name: 'CUD and CR', indent: 0, sep: () => '\x1b[B\r' },
  { name: 'CUD, CR and CUF 2', indent: 2, sep: () => '\x1b[B\r\x1b[2C' },
  { name: 'IND, CR and an indent', indent: 2, sep: () => '\x1bD\r  ' },
  { name: 'CR, CUD and CUF 2', indent: 2, sep: () => '\r\x1b[B\x1b[2C' },
];
type Sep = (typeof SEPS)[number];
/** `key` drawn from row 10 after `key: `, broken into rows of `parts` characters by `sep`, then `tail` and CR LF. */
const drawn = (key: string, parts: readonly number[], s: Sep, tail = ''): string => {
  let out = `${at(10, 1)}key: `;
  let i = 0;
  parts.forEach((p, k) => { if (k > 0) out += s.sep(10 + k); out += key.slice(i, i + p); i += p; });
  return `${out}${tail}\r\n`;
};
/** The row lengths of a key of `n` characters wrapped at `cols` columns after `key: ` with `indent` columns of indent. */
const wrapAt = (n: number, cols: number, indent: number): number[] => {
  const parts = [Math.min(n, cols - 5)];
  for (let left = n - parts[0]!; left > 0; left -= cols - indent) parts.push(Math.min(left, cols - indent));
  return parts;
};

/** What the drawer sends for `chunks`, each followed by its quiet time, on fake timers. */
const throughDrawer = (m: SecretMasker, chunks: readonly { text: string; quietMs: number }[]): string => {
  vi.useFakeTimers();
  const out: string[] = [];
  const d = m.drawer((t) => out.push(t));
  for (const c of chunks) { d.push(c.text); vi.advanceTimersByTime(c.quietMs); }
  d.dispose();
  vi.useRealTimers();
  return out.join('');
};

describe('D-8710 — the exact-bytes row join walks every row a key spans', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('a key on two to five rows is masked under every separator, one mark per row, in rows mode and through the drawer', () => {
    // The review's splits (17/20/8 and 12/15/15/3 for 45 characters) and keys wrapped at 120 and 220 columns onto two to
    // five rows. Rows mode is the drawer's and pane history's; one whole chunk through the drawer, its run closed by the
    // text after it.
    const cases: { key: string; parts: (s: Sep) => number[] }[] = [
      { key: keyOf(45, 1), parts: () => [20, 25] },
      { key: keyOf(45, 2), parts: () => [17, 20, 8] },
      { key: keyOf(45, 3), parts: () => [12, 15, 15, 3] },
      ...[300, 500, 1_000].flatMap((n) => [120, 220].map((cols) => ({ key: keyOf(n, n + cols), parts: (s: Sep) => wrapAt(n, cols, s.indent) }))),
    ];
    const m = fingerprinted(...cases.map((c) => c.key));
    try {
      for (const c of cases) {
        for (const s of SEPS) {
          const parts = c.parts(s);
          const text = drawn(c.key, parts, s, ' done.');
          const where = `${c.key.length} characters on ${parts.length} rows (${parts.join('/')}), ${s.name}`;
          const rows = m.maskText(text, { rows: true });
          expect(slicesIn(c.key, rows), `${where}: rows mode`).toEqual([]);
          expect(count(rows, SECRET_MASK), `${where}: rows mode, marks`).toBe(parts.length);
          const sent = throughDrawer(m, [{ text, quietMs: 40 }]);
          expect(slicesIn(c.key, sent), `${where}: the drawer`).toEqual([]);
          expect(count(sent, DRAWER_SECRET_MASK), `${where}: the drawer, marks`).toBe(parts.length);
        }
      }
    } finally {
      m.close();
    }
  });

  it('a key at the run ceiling, wrapped onto 38 or 70 rows, is masked on every row', () => {
    const key = keyOf(8_192, 9);
    const m = fingerprinted(key);
    try {
      for (const cols of [220, 120]) {
        for (const s of [SEPS[0]!, SEPS[3]!, SEPS[10]!]) {
          const parts = wrapAt(key.length, cols, s.indent);
          const out = m.maskText(drawn(key, parts, s), { rows: true });
          expect(slicesIn(key, out), `${cols} columns, ${s.name}`).toEqual([]);
          expect(count(out, SECRET_MASK), `${cols} columns, ${s.name}: marks`).toBe(parts.length);
        }
      }
    } finally {
      m.close();
    }
  });

  it('pane history: a key a program wrapped onto three or more rows is masked, in one slice and across a slice boundary', async () => {
    // `capture-pane -p -e -J` text: each row a line, the wrapped rows indented. Past 64 Ki units the history is masked in
    // slices, and a key a slice boundary splits is read whole through the overlap on each side.
    const key = keyOf(700, 21);
    const m = fingerprinted(key);
    try {
      const rows = wrapAt(key.length, 220, 2);
      let i = 0;
      const lines = rows.map((p, k) => { const s = `${k === 0 ? 'key: ' : '  '}${key.slice(i, i + p)}`; i += p; return s; });
      const block = `${lines.join('\n')}\n`;
      const one = await m.maskTextSliced(`before\n${block}after\n`, { rows: true });
      expect(slicesIn(key, one), 'one slice').toEqual([]);
      expect(count(one, SECRET_MASK)).toBe(rows.length);
      // Filler so the key's second row starts at the first slice's last line.
      const filler = 'filler line of ordinary words\n';
      let pre = '';
      while (pre.length + filler.length < 64 * 1024 - lines[0]!.length - 2) pre += filler;
      const long = await m.maskTextSliced(`${pre}${block}after\n${pre}`, { rows: true });
      expect(slicesIn(key, long), 'across a slice boundary').toEqual([]);
    } finally {
      m.close();
    }
  });

  it('through the drawer, a two- or three-row key cut into two chunks anywhere is never drawn', () => {
    // At every byte of tmux's form (a cursor position and the indent) and of CR LF: the run a chunk ends inside, or ends
    // its row with, is held with every row it continues, and what is sent before the hold is matched with it.
    const m = fingerprinted(keyOf(300, 300), keyOf(500, 500));
    try {
      for (const n of [300, 500]) {
        const key = keyOf(n, n);
        for (const s of [SEPS[3]!, SEPS[0]!]) {
          const parts = wrapAt(n, 220, s.indent);
          const text = drawn(key, parts, s);
          for (let cut = 1; cut < text.length; cut++) {
            const sent = throughDrawer(m, [{ text: text.slice(0, cut), quietMs: 0 }, { text: text.slice(cut), quietMs: 40 }]);
            expect(slicesIn(key, sent), `${n} characters, ${s.name}, cut at ${cut}`).toEqual([]);
            // One mark per row the key touches, at every cut (review 2352 L2-1): a leak under 8 characters, or a row drawn
            // with no mark, would pass the slice test alone.
            expect(count(sent, DRAWER_SECRET_MASK), `${n} characters, ${s.name}, cut at ${cut}: marks`).toBe(parts.length);
          }
        }
      }
    } finally {
      m.close();
    }
  });

  it('the rows the drawer sends before a hold are read with the rows it holds', () => {
    // The chunk ends after a 50-character row. The drawer holds it with the rows a key could still run on from: back to
    // the 10-character row before it, which is narrower than any row a key runs through, so the walk stops there. The
    // key's head, 35 characters ending the row before that, is sent ahead of the hold, and is masked only because it is
    // read with the held rows after it (the lookahead).
    const key = keyOf(45, 61);
    const m = fingerprinted(key);
    try {
      const filler = keyOf(50, 62).replace(/-/g, 'z');
      for (const s of [SEPS[3]!, SEPS[0]!]) {
        const text = `${at(10, 1)}key: ${key.slice(0, 35)}${s.sep(11)}${key.slice(35)}${s.sep(12)}${filler}${s.sep(13)}`;
        for (const quietMs of [0, 40]) {
          const sent = throughDrawer(m, [{ text, quietMs }, { text: `more words\r\n`, quietMs: 40 }]);
          expect(slicesIn(key, sent), `${s.name}, ${quietMs} ms quiet`).toEqual([]);
          expect(count(sent, DRAWER_SECRET_MASK), `${s.name}, ${quietMs} ms quiet: marks`).toBe(2);
        }
      }
    } finally {
      m.close();
    }
  });

  it('through the drawer, an expired hold anywhere but at a row break never draws a key', () => {
    // A quiet gap after the cut: the hold expires and the run is withheld until it ends. A gap exactly at a row break
    // (the cut lands between a row's last byte and the next row's first run byte) is D-5995's accepted gap: a quiet row
    // end longer than two holds is the line's end, and the rows before it are drawn.
    const m = fingerprinted(keyOf(300, 300), keyOf(500, 500));
    try {
      for (const n of [300, 500]) {
        const key = keyOf(n, n);
        for (const s of [SEPS[3]!, SEPS[0]!]) {
          const parts = wrapAt(n, 220, s.indent);
          const text = drawn(key, parts, s);
          const breaks: [number, number][] = [];
          let p = text.indexOf('key: ') + 5;
          let done = 0;
          for (const len of parts.slice(0, -1)) {
            p += len;
            done += len;
            const next = text.indexOf(key.slice(done, done + 8), p);
            breaks.push([p, next]);
            p = next;
          }
          for (let cut = 1; cut < text.length; cut++) {
            if (breaks.some(([a, b]) => cut >= a && cut <= b)) continue;
            const sent = throughDrawer(m, [{ text: text.slice(0, cut), quietMs: 40 }, { text: text.slice(cut), quietMs: 40 }]);
            expect(slicesIn(key, sent), `${n} characters, ${s.name}, quiet at ${cut}`).toEqual([]);
          }
        }
      }
    } finally {
      m.close();
    }
  });
});

describe('D-8710 — a shape key over many rows is masked on every row when a chunk splits it', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('a 1,600-character shape key on eight rows, cut into two chunks anywhere, is never drawn', () => {
    // The text after the cut once masked only its first row as the shape's continuation; its later rows were masked
    // only while the context (1 KiB) still held the shape's start, so a long key's rows showed after most cuts (measured
    // on main: a full row at about a third of all cuts, with or without fingerprints). The rows a masked run goes on
    // into are now walked as the shape's own are, a text that ends after a row break and the next row's indent carries
    // into the next, and the drawer reads that carry at the end of what it sends, not of what it holds.
    const key = skOf(1_600);
    const fp = fingerprinted(keyOf(40, 78));
    try {
      for (const m of [SHAPE_ONLY_MASKER, fp]) {
        for (const s of [SEPS[3]!, SEPS[0]!]) {
          const text = drawn(key, wrapAt(key.length, 220, s.indent), s, ' done.');
          for (let cut = 1; cut < text.length; cut += 2) {
            const sent = throughDrawer(m, [{ text: text.slice(0, cut), quietMs: 0 }, { text: text.slice(cut), quietMs: 40 }]);
            expect(slicesIn(key.slice(2), sent), `${m === fp ? 'fingerprints held' : 'shape-only'}, ${s.name}, cut at ${cut}`).toEqual([]);
          }
        }
      }
    } finally {
      fp.close();
    }
  });
});

describe('D-8710 — a run longer than a drawer holds stays masked to its end (review 2326 O1)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('a shape key of 9,300 to 20,000 characters in many chunks shows no byte and one mark, with or without fingerprints', () => {
    const fp = fingerprinted(keyOf(40, 77));
    try {
      for (const m of [SHAPE_ONLY_MASKER, fp]) {
        for (const [n, size] of [[9_300, 7], [12_000, 7], [20_000, 7], [20_000, 4_096]] as const) {
          const key = skOf(n);
          const text = `> ${key} done.\r\n`;
          for (const quietMs of [0, 1]) {
            const chunks: { text: string; quietMs: number }[] = [];
            for (let i = 0; i < text.length; i += size) chunks.push({ text: text.slice(i, i + size), quietMs });
            chunks[chunks.length - 1] = { ...chunks.at(-1)!, quietMs: 40 };
            const sent = throughDrawer(m, chunks);
            const where = `${n} characters in chunks of ${size}, ${quietMs} ms apart, ${m === fp ? 'fingerprints held' : 'shape-only'}`;
            expect(slicesIn(key.slice(2), sent), where).toEqual([]);
            expect(count(sent, DRAWER_SECRET_MASK), `${where}: marks`).toBe(1);
            expect(sent.endsWith(' done.\r\n'), `${where}: the text after it`).toBe(true);
          }
        }
      }
    } finally {
      fp.close();
    }
  });
});

describe('D-8710 — a move down then a carriage return is one row break (review 2326 O2)', () => {
  it('a key on two or three rows split by CUD+CR or IND+CR is masked, shape or fingerprint', () => {
    const fpKey = keyOf(300, 31);
    const shape = skOf(300);
    const m = fingerprinted(fpKey);
    try {
      for (const s of SEPS.filter((x) => /CUD|IND/.test(x.name))) {
        for (const parts of [[215, 85], [17, 20, 263]]) {
          const where = `${parts.join('/')}, ${s.name}`;
          const fpOut = m.maskText(drawn(fpKey, parts, s, ' done.'), { rows: true });
          expect(slicesIn(fpKey, fpOut), `${where}: a fingerprinted key`).toEqual([]);
          if (s.indent === 0) continue;   // a shape's next row is a wrap only when indented (D-5995)
          const shOut = SHAPE_ONLY_MASKER.maskText(drawn(shape, parts, s, ' done.'), { rows: true });
          expect(slicesIn(shape.slice(2), shOut), `${where}: a shape key`).toEqual([]);
        }
      }
    } finally {
      m.close();
    }
  });
});

describe('D-8710 — a key whose rows are longer than what a drawer holds for one run (review 2352)', () => {
  afterEach(() => { vi.useRealTimers(); });

  const SGR = '\x1b[38;2;153;153;153m';
  const SGR0 = '\x1b[39m';
  /** `key` as a program draws it from row 5 in rows of `cols`, each row's text after `pre(row)` and before `post`, as
   *  tmux sends it, then a prompt. `rows`: how many rows the key takes. */
  const tmuxRows = (key: string, cols: number, pre: (row: number) => string, post = ''): { text: string; rows: number } => {
    let t = `${at(4, 1)}$ show-key\r\n`;
    let r = 0;
    for (let i = 0; i < key.length; i += cols, r++) t += pre(5 + r) + key.slice(i, i + cols) + post;
    return { text: `${t}\r\n${at(6 + r, 1)}$ `, rows: r };
  };
  /** Whether `out` holds a slice of 8 of `key`: one pass over `out`, so a sweep over a long key stays linear. */
  const leaks = (key: string): ((out: string) => boolean) => {
    const grams = new Set<string>();
    for (let i = 0; i + 8 <= key.length; i++) grams.add(key.slice(i, i + 8));
    return (out) => { for (let i = 0; i + 8 <= out.length; i++) if (grams.has(out.slice(i, i + 8))) return true; return false; };
  };
  /** Every cut of `text` in [from, to) whose two chunks, `quietMs` apart, draw a slice of `key` or not one mark per row
   *  (the first five). */
  const badCuts = (m: SecretMasker, key: string, text: string, rows: number, quietMs: number, from = 1, to = text.length): string[] => {
    const shows = leaks(key);
    const bad: string[] = [];
    for (let c = from; c < to && bad.length < 5; c++) {
      const sent = throughDrawer(m, [{ text: text.slice(0, c), quietMs }, { text: text.slice(c), quietMs: 40 }]);
      const marks = count(sent, DRAWER_SECRET_MASK);
      if (shows(sent) || marks !== rows) bad.push(`cut at ${c}: ${shows(sent) ? 'key bytes drawn' : 'no key bytes'}, ${marks} marks`);
    }
    return bad;
  };

  it('a key at the run ceiling at 118 columns with a colour escape on every row, cut anywhere, is never drawn (F1)', () => {
    // tmux's form: a cursor position, a two-column indent and the program's colour before each row, the reset after it:
    // 70 rows, 10,512 bytes. The drawer read only the last 9,280 bytes of a chunk, so when the chain of rows ran past
    // that window it was cut unannounced: the rows before the hold went out unjoined, and at one cut every byte of the
    // key was drawn with no mark (review 2352 F1; 155 of 10,511 cuts leaked on a69085c93).
    const key = keyOf(8_192, 2352);
    const m = fingerprinted(key);
    try {
      const { text, rows } = tmuxRows(key, 118, (r) => `${at(r, 1)}  ${SGR}`, SGR0);
      expect(rows).toBe(70);
      expect(badCuts(m, key, text, rows, 0)).toEqual([]);
    } finally {
      m.close();
    }
  }, 300_000);

  it('a 6,000-byte key at 64 columns after a 100-column indent, cut anywhere past one run\'s hold, is never drawn (F1)', () => {
    // 94 rows, 16,553 bytes: each row's indent is a hundred blanks, so the rows a key spans run past the window from far
    // into the text (review 2352 F1: 269 of 16,073 cuts leaked, one the whole key). A cut before 9,000 bytes leaves the
    // window the whole chain; the sweep runs from there to the end.
    const key = keyOf(6_000, 2353);
    const m = fingerprinted(key);
    try {
      const { text, rows } = tmuxRows(key, 64, (r) => `${at(r, 1)}${' '.repeat(100)}`);
      expect(badCuts(m, key, text, rows, 0, 9_000)).toEqual([]);
    } finally {
      m.close();
    }
  }, 300_000);

  it('a cut inside the escape that moves to a key\'s next row, then a quiet gap of one hold, draws nothing (found in the fix round)', () => {
    // The hold expired with the chunk ending in the first byte of the next row's cursor position: the flush read that
    // unfinished escape as no row end and drew the row before it, a whole row of the key, on a69085c93. Gaps of one and
    // two holds (7 and 11 ms; the drawer holds 6). A longer gap at a row break is D-5995's accepted gap.
    const key = keyOf(8_192, 2354);
    const m = fingerprinted(key);
    try {
      const { text, rows } = tmuxRows(key, 118, (r) => `${at(r, 1)}  ${SGR}`, SGR0);
      for (const quietMs of [7, 11]) expect(badCuts(m, key, text, rows, quietMs, 1, 1_600), `${quietMs} ms`).toEqual([]);
    } finally {
      m.close();
    }
  }, 300_000);

  it('a colour tmux re-sends in the middle of a key\'s row does not end the run the drawer holds (found in the fix round)', () => {
    // Through a real tmux, a 7,000-byte key at 140 columns after a 60-column indent had its colour re-sent in the middle
    // of a row (`ESC(B`, `ESC[m` and the colour again: tmux's own output buffer ended there). The view with escapes as
    // NULs read the rest of the row as a run of its own, so the hold stopped at it and sent every row before it
    // unjoined: the whole key was drawn at the recorded chunking, and at 3,283 of 12,946 cuts (on a69085c93).
    const key = keyOf(7_000, 2355);
    const m = fingerprinted(key);
    try {
      const { text: plain, rows } = tmuxRows(key, 140, (r) => `${at(r, 1)}${' '.repeat(60)}${SGR}`, SGR0);
      // The re-sent colour 91 characters into the key's 31st row.
      const row31 = plain.indexOf(key.slice(30 * 140, 30 * 140 + 8));
      const split = row31 + 91;
      const text = `${plain.slice(0, split)}\x1b(B\x1b[m${SGR}${plain.slice(split)}`;
      expect(badCuts(m, key, text, rows, 0, split, text.length)).toEqual([]);
    } finally {
      m.close();
    }
  }, 300_000);

  it('a key after a styled listing longer than the window is held from the window\'s first whole row, wherever the cut', () => {
    // Every row of a listing in colour with an OSC 8 hyperlink (about 176 bytes a row for 64 columns of text), then a
    // 1,600-byte key on 25 more rows, while an 8,192-byte key is held too: the rows a key could span run past the
    // window, so the walk reaches its first row, which began before it. What that row seems to hold proves nothing (an
    // escape the window cut reads as text, a run it cut as a row's first), so the walk stops at the window's first whole
    // row and holds from there: stopping where the cut row seemed to end drew the key at 2,457 of 4,427 cuts. And a
    // chunk that ends between the two bytes of a hyperlink's terminator (ESC then `\`) holds the whole escape: read as
    // a lone ESC after text, the hyperlink's opening was text, nothing was held, and the key was drawn at 48 cuts.
    const key = keyOf(1_600, 2360);
    const m = fingerprinted(key, keyOf(8_192, 2361));
    try {
      // Upper case, so no slice of 8 of the listing can be one of the key's (both come from one generator).
      const listing = keyOf(100 * 64 + 4, 2362).slice(4).replace(/-/g, 'x').toUpperCase();
      const pre = (r: number): string =>
        `${at(r % 50 + 1, 1)}${SGR}\x1b[48;2;20;20;20m\x1b]8;;https://example.com/a/fairly/long/path/to/row/${r}\x1b\\`;
      const post = '\x1b]8;;\x1b\\\x1b[39;49m';
      let text = `${at(1, 1)}$ list\r\n`;
      let r = 0;
      for (let i = 0; i < listing.length; i += 64, r++) text += pre(r) + listing.slice(i, i + 64) + post;
      const keyAt = text.length;
      for (let i = 0; i < key.length; i += 64, r++) text += pre(r) + key.slice(i, i + 64) + post;
      text += `\r\n${at(50, 1)}$ `;
      expect(text.length).toBeGreaterThan(20_000);
      expect(badCuts(m, key, text, 25, 0, keyAt)).toEqual([]);
    } finally {
      m.close();
    }
  }, 300_000);

  it('a key drawn at column 200 holds like one drawn at column 1 (F9)', () => {
    // 2,000 bytes on 100 rows of 20, each after a cursor position to column 200: the hold counted the 199 columns of
    // each move as the key's own units, so it stopped short of the key's first rows (review 2352 F9: 431 of 2,925 cuts
    // leaked on a69085c93). It counts the rows' own units now; the window bounds the bytes.
    const key = keyOf(2_000, 2356);
    const m = fingerprinted(key);
    try {
      for (const col of [200, 1]) {
        const { text, rows } = tmuxRows(key, 20, (r) => at(r, col));
        expect(badCuts(m, key, text, rows, 0), `column ${col}`).toEqual([]);
      }
    } finally {
      m.close();
    }
  }, 300_000);

  it('pane history: a key in `capture-pane -e -J` form across the slice boundary is masked wherever it lies (F2)', async () => {
    // Each row a line: a two-column indent, the program's colour, the key's row, the reset. Placed so the 64 Ki slice
    // boundary falls before, inside and after the key's block; the overlap each slice reads on either side was 9 KiB,
    // less than the block, so rows on the far side of the cut showed (review 2352 F2: up to 640 key bytes at 118
    // columns, 1,664 at 64, both ways across the cut, on a69085c93).
    for (const cols of [118, 64, 65]) {
      const key = keyOf(8_192, 2357 + cols);
      const m = fingerprinted(key);
      try {
        const shows = leaks(key);
        const lines: string[] = [];
        for (let i = 0; i < key.length; i += cols) lines.push(`  ${SGR}${key.slice(i, i + cols)}${SGR0}`);
        const block = `key:\n${lines.join('\n')}\ndone\n`;
        const bad: string[] = [];
        for (let filler = 64 * 1024 - block.length - 200; filler < 64 * 1024 + 200 && bad.length < 5; filler += 211) {
          let pre = '';
          for (let i = 0; pre.length < filler; i++) pre += `line ${i} of ordinary output\n`;
          const out = await m.maskTextSliced(`${pre}${block}${'tail line\n'.repeat(50)}`, { rows: true });
          const marks = count(out, SECRET_MASK);
          if (shows(out) || marks !== lines.length) bad.push(`${cols} columns, block at ${pre.length}: ${marks} marks`);
        }
        expect(bad).toEqual([]);
      } finally {
        m.close();
      }
    }
  }, 300_000);

  it('pane history: a key block of 17,802 bytes, five escapes on every row, is masked across the slice boundary (F2)', async () => {
    // A two-column indent and five escapes before each row and five after, at 64 columns: 128 rows of 8,192 key bytes in
    // a 17,802-byte block, longer than the 16 KiB overlap 29219c442 read on each side of a slice, so rows past it showed
    // (up to 576 key bytes at 12 of 87 placements). The overlap is the chain hold now, which holds the block.
    const pre = `  ${SGR}\x1b[48;2;20;20;20m\x1b[1m\x1b[3m\x1b[4m`;
    const post = '\x1b[24m\x1b[23m\x1b[22m\x1b[49m\x1b[39m';
    const key = keyOf(8_192, 2361);
    const m = fingerprinted(key);
    try {
      const shows = leaks(key);
      const lines: string[] = [];
      for (let i = 0; i < key.length; i += 64) lines.push(`${pre}${key.slice(i, i + 64)}${post}`);
      const block = `key:\n${lines.join('\n')}\ndone\n`;
      expect(block.length).toBe(17_802);
      const bad: string[] = [];
      for (let filler = 64 * 1024 - block.length - 200; filler < 64 * 1024 + 200 && bad.length < 5; filler += 211) {
        let before = '';
        for (let i = 0; before.length < filler; i++) before += `line ${i} of ordinary output\n`;
        const out = await m.maskTextSliced(`${before}${block}${'tail line\n'.repeat(50)}`, { rows: true });
        const marks = count(out, SECRET_MASK);
        if (shows(out) || marks !== lines.length) bad.push(`block at ${before.length}: ${shows(out) ? 'key bytes shown' : 'no key bytes'}, ${marks} marks`);
      }
      expect(bad).toEqual([]);
    } finally {
      m.close();
    }
  }, 300_000);

  it('a frame whose row-join candidates pass the byte budget is cut with the notice, never drawn (F4)', async () => {
    // 64 Ki of lines that each hold one 12-unit run chain every row into candidates of every held length; with 21 keys
    // held the 2 MiB the row join may hash in a frame runs out before the key after them. That frame must end in the
    // too-large notice: dropping the budget's fail-closed arm drew all 300 bytes (review 2352 F4).
    const key = keyOf(300, 2358);
    const m = fingerprinted(key, ...Array.from({ length: 20 }, (_, i) => keyOf(40 + i * 37, 2400 + i)));
    try {
      const run12 = keyOf(16, 2359).slice(4).replace(/-/g, 'x');
      let lines = '';
      while (lines.length < 64 * 1024) lines += `  ${run12}\r\n`;
      const keyRows = `\r\n  ${key.slice(0, 100)}\r\n  ${key.slice(100, 200)}\r\n  ${key.slice(200)} end\r\n`;
      const shows = leaks(key);
      const one = m.maskText(lines + keyRows, { rows: true });
      expect(shows(one), 'one text').toBe(false);
      expect(one.endsWith(SECRET_MASK_TOO_LARGE), 'one text: the notice').toBe(true);
      const sliced = await m.maskTextSliced(lines.repeat(8) + keyRows, { rows: true });
      expect(shows(sliced), 'pane history, 8 x 64 Ki').toBe(false);
      expect(sliced.endsWith(SECRET_MASK_TOO_LARGE), 'pane history: the notice').toBe(true);
    } finally {
      m.close();
    }
  }, 300_000);
});
