// D-8710 — A KEY ACROSS ANY NUMBER OF ROWS IS MASKED, WHATEVER SEPARATES THEM (desktop polish Task C41).
//
// MEASURED (review 2326 F3, O1, O2; `docs/superpowers/programs/desktop-polish/c41.md`): the exact-bytes row join
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
    // 70 rows, 10,526 bytes with the command and the prompt. The drawer read only the last 9,280 bytes of a chunk, so
    // when the chain of rows ran past that window it was cut unannounced: the rows before the hold went out unjoined, and
    // at one cut every byte of the key was drawn with no mark (review 2352 F1; 155 of 10,511 cuts leaked on a69085c93).
    // The window holds 18,496 bytes now, so this row no longer cuts it: it pins the walk through coloured rows, and
    // review 2370's rows below cut the window.
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
    // 94 rows, 16,083 bytes: each row's indent is a hundred blanks, so the rows a key spans ran past the one run's window
    // (9,280 bytes) from far into the text (review 2352 F1: 269 of 16,073 cuts leaked, one the whole key). The window holds
    // 18,496 bytes now, the whole chain at every cut, so this row pins the walk through indented rows; review 2370's rows
    // below cut the window. The sweep runs from 9,000 bytes, past one run's hold, to the end.
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
          if (shows(out) || marks !== lines.length) bad.push(`${cols} columns, block at ${pre.length}: ${shows(out) ? 'key bytes shown' : 'no key bytes'}, ${marks} marks`);
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

describe('D-8710 — a key the drawer holds in part, or past its window, is never drawn (review 2370)', () => {
  afterEach(() => { vi.useRealTimers(); });

  const SGR = '\x1b[38;2;153;153;153m';
  /** `out` with its escapes read away (a key coloured per character is drawn with an escape between its bytes). */
  const plain = (out: string): string =>
    out.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[PX^_][^\x1b]*\x1b\\|[ -/]*[0-~])/g, '');
  /** Whether `out`, its escapes read away, holds a slice of 8 of `key`. */
  const leaks = (key: string): ((out: string) => boolean) => {
    const grams = new Set<string>();
    for (let i = 0; i + 8 <= key.length; i++) grams.add(key.slice(i, i + 8));
    return (raw) => { const out = plain(raw); for (let i = 0; i + 8 <= out.length; i++) if (grams.has(out.slice(i, i + 8))) return true; return false; };
  };
  /** The cuts `from`, `from + step`, ... below `to` whose two chunks draw a slice of `key`, or not `rows` marks (the
   *  first five), and the one-chunk text too. `rows` null: a key the stream ends inside is withheld, so only its bytes
   *  are counted. */
  const badCuts = (m: SecretMasker, key: string, text: string, rows: number | null, step: number, from = 1, to = text.length): string[] => {
    const shows = leaks(key);
    const bad: string[] = [];
    const check = (what: string, sent: string): void => {
      const marks = count(sent, DRAWER_SECRET_MASK);
      if (shows(sent) || (rows !== null && marks !== rows)) bad.push(`${what}: ${shows(sent) ? 'key bytes drawn' : 'no key bytes'}, ${marks} marks`);
    };
    check('one chunk', throughDrawer(m, [{ text, quietMs: 40 }]));
    for (let c = from; c < to && bad.length < 5; c += step) {
      check(`cut at ${c}`, throughDrawer(m, [{ text: text.slice(0, c), quietMs: 0 }, { text: text.slice(c), quietMs: 40 }]));
    }
    return bad;
  };
  /** `text` in chunks of `size` from `phase`, each `quietMs` apart. */
  const chunked = (text: string, size: number, phase: number, quietMs: number): { text: string; quietMs: number }[] => {
    const out = phase > 0 ? [{ text: text.slice(0, phase), quietMs }] : [];
    for (let c = phase; c < text.length; c += size) out.push({ text: text.slice(c, c + size), quietMs });
    out[out.length - 1]!.quietMs = 40;
    return out;
  };
  /** `s` broken into rows of `cols`, joined by `sep`. */
  const rowsOf = (s: string, cols: number, sep: string): string => {
    const r: string[] = [];
    for (let i = 0; i < s.length; i += cols) r.push(s.slice(i, i + cols));
    return r.join(sep);
  };

  it('a key whose last row is short, then a short row, is masked to its end wherever the cut (F1)', () => {
    // A 3,011-byte key at 100 columns (its last row 11 bytes), then `  Saved.` on the next row. The walk stops at the
    // short row (a row under 12 units only begins a key's rows), so the hold begins inside the key: the rows before it
    // went out masked with the held rows read after them, but the held rows went out later with only the 1 KiB of
    // context, which no longer held the key's head, and the last 11 bytes were drawn (review 2370 F1, on e37701c43).
    const key = keyOf(3_011, 2370);
    const m = fingerprinted(key);
    try {
      for (const sep of ['\r\n  ', '\r\n']) {
        const text = `${at(4, 1)}$ show\r\n  ${rowsOf(key, 100, sep)}\r\n  Saved.\r\n`;
        expect(badCuts(m, key, text, 31, 1), JSON.stringify(sep)).toEqual([]);
      }
    } finally {
      m.close();
    }
  }, 300_000);

  it('a key, then rows of another wrapped token that fill the walk\'s bound, is masked wherever the cut (F1)', () => {
    // A 6,000-byte key at 100 columns, then 4,000 units of another token wrapped the same way: the rows after the key
    // spend the walk's bound, so the hold begins inside the key, and its held rows were drawn later with 1 KiB of context
    // (review 2370 F1: 4,300 key bytes in one chunk, on e37701c43). Every 7th cut.
    const key = keyOf(6_000, 2371);
    const other = keyOf(4_004, 2372).slice(4).toUpperCase().replace(/-/g, 'Z');
    const m = fingerprinted(key);
    try {
      const text = `${at(4, 1)}$ show\r\n  ${rowsOf(key, 100, '\r\n  ')}\r\n  ${rowsOf(other, 100, '\r\n  ')}\r\n`;
      expect(badCuts(m, key, text, 60, 7)).toEqual([]);
    } finally {
      m.close();
    }
  }, 300_000);

  it('a fully written key whose rows run past the window, in 4 KiB chunks, is never drawn (F2)', () => {
    // An 8,192-byte key at 64 columns, each row after a cursor position and an indent of 90 or 130 blanks: 20,617 and
    // 25,737 bytes, past the 18 KiB window. The walk reached the window's first row and held from there, so the rows
    // before it went out with what the drawer had (a key not yet whole: drawn) and the held rows later with 1 KiB of
    // context (review 2370 F2: the whole key at 21 and 43 of 43 phases, on e37701c43). Such a chain is read again over
    // the whole text now, and held from where it starts. 43 phases of the 4 KiB grid, with no quiet between chunks and
    // with one hold's quiet (the expired hold's path).
    for (const indent of [90, 130]) {
      const key = keyOf(8_192, 2373 + indent);
      const m = fingerprinted(key);
      try {
        const shows = leaks(key);
        let text = `${at(4, 1)}$ show-key\r\n`;
        let r = 0;
        for (let i = 0; i < key.length; i += 64, r++) text += `${at(5 + (r % 40), 1)}${' '.repeat(indent)}${key.slice(i, i + 64)}`;
        text += `\r\n${at(46, 1)}$ `;
        const bad: string[] = [];
        for (const quietMs of [0, 7]) {
          for (let phase = 0; phase < 4_096 && bad.length < 5; phase += 96) {
            const sent = throughDrawer(m, chunked(text, 4_096, phase, quietMs));
            if (shows(sent) || count(sent, DRAWER_SECRET_MASK) !== 128) {
              bad.push(`indent ${indent}, ${quietMs} ms, phase ${phase}: ${shows(sent) ? 'key bytes drawn' : 'no key bytes'}, ${count(sent, DRAWER_SECRET_MASK)} marks`);
            }
          }
        }
        expect(bad).toEqual([]);
      } finally {
        m.close();
      }
    }
  }, 300_000);

  it('a key after a styled listing, with 90 styled rows after it, is never drawn wherever the cut (F2)', () => {
    // The listing form of review 2352's row (about 176 bytes a row for 64 columns), a 1,600-byte key on 25 rows, then 90
    // more listing rows, while an 8,192-byte key is held too: the chain from the end runs past the window, and the key's
    // rows the hold took were drawn later (review 2370 F2: 122 of 2,263 cuts, up to 1,216 bytes, on e37701c43). Every
    // 13th cut from the key's first row to the end.
    const key = keyOf(1_600, 2374);
    const m = fingerprinted(key, keyOf(8_192, 2375));
    try {
      const listing = keyOf(100 * 64 + 4, 2376).slice(4).replace(/-/g, 'x').toUpperCase();
      const after = keyOf(90 * 64 + 4, 2377).slice(4).replace(/-/g, 'y').toUpperCase();
      const pre = (r: number): string =>
        `${at(r % 50 + 1, 1)}${SGR}\x1b[48;2;20;20;20m\x1b]8;;https://example.com/a/fairly/long/path/to/row/${r}\x1b\\`;
      const post = '\x1b]8;;\x1b\\\x1b[39;49m';
      let text = `${at(1, 1)}$ list\r\n`;
      let r = 0;
      for (let i = 0; i < listing.length; i += 64, r++) text += pre(r) + listing.slice(i, i + 64) + post;
      const keyAt = text.length;
      for (let i = 0; i < key.length; i += 64, r++) text += pre(r) + key.slice(i, i + 64) + post;
      for (let i = 0; i < after.length; i += 64, r++) text += pre(r) + after.slice(i, i + 64) + post;
      text += `\r\n${at(50, 1)}$ `;
      expect(badCuts(m, key, text, 25, 13, keyAt)).toEqual([]);
    } finally {
      m.close();
    }
  }, 300_000);

  it('a key coloured per character whose bytes pass the window, ending a chunk, is never drawn (F3)', () => {
    // 1,200 and 2,000 characters, each after its own 24-bit colour: 22,460 and 37,425 bytes on one row. A window with
    // no row break is all one row that began before it: read as the whole text, its first byte proved where the run
    // joined across escapes started, the hold began there, and every byte before it was drawn (review 2370 F3: 70 of 402
    // sampled cuts, up to the whole key, on e37701c43). About 400 cuts each: the stream ending after the key (the key is
    // withheld: no mark yet), and a prompt after it (one mark).
    for (const n of [1_200, 2_000]) {
      const key = keyOf(n, 2378 + n);
      const m = fingerprinted(key, keyOf(8_192, 2379));
      try {
        let text = `${at(4, 1)}$ show\r\n`;
        for (let i = 0; i < n; i++) text += `\x1b[38;2;${(i * 7) % 256};${(i * 13) % 256};${(i * 29) % 256}m${key[i]}`;
        expect(badCuts(m, key, text, null, Math.floor(text.length / 400)), `${n} characters, the stream ending`).toEqual([]);
        const prompt = `${text}\x1b[39m\r\n${at(30, 1)}$ `;
        expect(badCuts(m, key, prompt, 1, Math.floor(text.length / 400)), `${n} characters, a prompt after`).toEqual([]);
        // A hold that expires with the key half written (a 7 ms gap at the cut): the flush reads the held run back over
        // the whole held text too, so nothing of it goes out before the rest arrives.
        const shows = leaks(key);
        const gapped: number[] = [];
        for (let c = 200; c < text.length && gapped.length < 5; c += Math.floor(text.length / 100)) {
          const sent = throughDrawer(m, [{ text: prompt.slice(0, c), quietMs: 7 }, { text: prompt.slice(c), quietMs: 40 }]);
          if (shows(sent) || count(sent, DRAWER_SECRET_MASK) !== 1) gapped.push(c);
        }
        expect(gapped, `${n} characters, a 7 ms gap at the cut`).toEqual([]);
      } finally {
        m.close();
      }
    }
    // 6,000 characters (112,270 bytes): past one run's hold (9,216 units) even in the view that reads each escape as one
    // unit, so a flush whose walk read back only that far sent the key's head unjoined (12 of 60 cuts, the whole key).
    const key = keyOf(6_000, 2392);
    const m = fingerprinted(key, keyOf(8_192, 2379));
    try {
      const shows = leaks(key);
      let text = `${at(4, 1)}$ show\r\n`;
      for (let i = 0; i < 6_000; i++) text += `\x1b[38;2;${(i * 7) % 256};${(i * 13) % 256};${(i * 29) % 256}m${key[i]}`;
      const prompt = `${text}\x1b[39m\r\n${at(30, 1)}$ `;
      const gapped: number[] = [];
      for (let c = 200; c < text.length && gapped.length < 5; c += Math.floor(text.length / 60)) {
        const sent = throughDrawer(m, [{ text: prompt.slice(0, c), quietMs: 7 }, { text: prompt.slice(c), quietMs: 40 }]);
        // Past the drawer's 64 KiB hold (C44, D-8728), the key goes out masked at the push that passes it, and the rows on
        // either side of a chain masked so can be masked too (`$ show`, the prompt): up to three marks, never a key byte.
        const marks = count(sent, DRAWER_SECRET_MASK);
        if (shows(sent) || marks < 1 || marks > 3) gapped.push(c);
      }
      expect(gapped, '6,000 characters, a 7 ms gap at the cut').toEqual([]);
    } finally {
      m.close();
    }
  }, 300_000);

  it('a chain just inside the window is held from its start wherever the cut (F4)', () => {
    // The block of the pane-history row (five escapes before each of 128 rows of 64 and five after), drawn with CR LF
    // between its rows: 17,930 bytes, a chain that the window (18,496 bytes) holds whole, at every 3rd cut across it
    // (review 2370 F4: no drawer row cut a chain between 17.5 and 18.4 KB).
    const pre = `  ${SGR}\x1b[48;2;20;20;20m\x1b[1m\x1b[3m\x1b[4m`;
    const post = '\x1b[24m\x1b[23m\x1b[22m\x1b[49m\x1b[39m';
    const key = keyOf(8_192, 2380);
    const m = fingerprinted(key);
    try {
      let text = `$ show\r\n`;
      for (let i = 0; i < key.length; i += 64) text += `${pre}${key.slice(i, i + 64)}${post}\r\n`;
      text += '$ ';
      expect(text.length).toBe(17_930);
      expect(badCuts(m, key, text, 128, 3)).toEqual([]);
    } finally {
      m.close();
    }
  }, 300_000);

  /** A block of `key` at 64 columns, `escapes` bytes of escapes (two blanks of indent among them) on each row. */
  const escapedBlock = (key: string, escapes: number): { block: string; rows: number } => {
    let pre = `  ${SGR}\x1b[48;2;20;20;20m`;
    while (pre.length < escapes - 25) pre += '\x1b[1m';
    const post = '\x1b[24m\x1b[23m\x1b[22m\x1b[49m\x1b[39m';
    const lines: string[] = [];
    for (let i = 0; i < key.length; i += 64) lines.push(`${pre}${key.slice(i, i + 64)}${post}`);
    return { block: `key:\n${lines.join('\n')}\ndone\n`, rows: lines.length };
  };
  /** Ordinary lines up to `n` units. */
  const ordinary = (n: number): string => {
    let t = '';
    for (let i = 0; t.length < n; i++) t += `line ${i} of ordinary output\n`;
    return t;
  };

  it('pane history: a key block of 21,898 or 38,282 bytes is masked across the slice boundary wherever it lies (F2)', async () => {
    // An 8,192-byte key at 64 columns with 104 or 232 bytes of escapes on every row: longer than the 18 KiB overlap, so
    // rows past the cut showed, up to the whole key from the larger block (review 2370 F2: 32 of 106 and 180 of 184
    // placements, on e37701c43). The slice before the cut now reads on while the drawer's walk back from its lookahead
    // still reaches the cut, and the match's spans past the cut carry into the next slice.
    const key = keyOf(8_192, 2385);
    const m = fingerprinted(key);
    try {
      const shows = leaks(key);
      for (const [escapes, size] of [[104, 21_898], [232, 38_282]] as const) {
        const { block, rows } = escapedBlock(key, escapes);
        expect(block.length).toBe(size);
        const bad: string[] = [];
        for (let filler = 64 * 1024 - block.length - 200; filler < 64 * 1024 + 200 && bad.length < 5; filler += 211) {
          const before = ordinary(filler);
          const out = await m.maskTextSliced(`${before}${block}${'tail line\n'.repeat(50)}`, { rows: true });
          const marks = count(out, SECRET_MASK);
          if (shows(out) || marks !== rows) bad.push(`${size} bytes at ${before.length}: ${shows(out) ? 'key bytes shown' : 'no key bytes'}, ${marks} marks`);
        }
        expect(bad).toEqual([]);
      }
    } finally {
      m.close();
    }
  }, 300_000);

  it('pane history: a key block past the lookahead\'s cap goes out masked on both sides of each cut (F2)', async () => {
    // About 2.1 KB of escapes on each of 128 rows: a 277,386-byte block, past what the lookahead reads (`WHOLE_HELD_MAX`,
    // 64 KiB since C44; 256 KiB when this row was written), so no slice reads the key whole. The rows of the chain on
    // either side of each cut go out masked, never raw (the coordinator's ruling on review 2370 F2); on e37701c43 the
    // whole key showed at every placement.
    const key = keyOf(8_192, 2386);
    const m = fingerprinted(key);
    try {
      const shows = leaks(key);
      // And 2,600 bytes a row (a 341,386-byte block): the rows on from a cut run past one read of them (a window of
      // `chainRowsOn`, `WHOLE_HELD_MAX`).
      for (const [escapes, size] of [[2_100, 277_386], [2_600, 341_386]] as const) {
        const { block, rows } = escapedBlock(key, escapes);
        expect(block.length).toBe(size);
        for (const filler of [1_000, 30_000, 60_000, 64 * 1024 - 5_000]) {
          const out = await m.maskTextSliced(`${ordinary(filler)}${block}${'tail line\n'.repeat(50)}`, { rows: true });
          expect(shows(out), `${size} bytes at ${filler}`).toBe(false);
          // Each of the key's rows one mark at least; the rows after a masked chain can be masked too (`done`, a word).
          expect(count(out, SECRET_MASK), `${size} bytes at ${filler}`).toBeGreaterThanOrEqual(rows);
        }
      }
    } finally {
      m.close();
    }
  }, 300_000);

  it('pane history: key-free text past 18 KiB keeps its bytes, wrapped or coloured', async () => {
    // Plain wrapped text never grows the lookahead (the walk stops within a key's own bytes, well inside 18 KiB), so its
    // bytes are main's. Upper case, so no slice of 8 of it can be a held key's.
    const m = fingerprinted(keyOf(8_192, 2387), keyOf(300, 2388));
    try {
      const blob = keyOf(300_004, 2389).slice(4).toUpperCase().replace(/-/g, '+');
      let wrapped = '';
      for (let i = 0; i < blob.length; i += 76) wrapped += `${blob.slice(i, i + 76)}\n`;
      let coloured = '';
      for (let i = 0; i < 40_000; i++) coloured += `${i % 700 === 699 ? '\n' : ''}\x1b[3${i % 8}m${'ABCDEFGH'[i % 8]}`;
      for (const [name, text] of [['prose', ordinary(300_000)], ['a wrapped blob', wrapped], ['colour on every character', coloured]] as const) {
        expect(await m.maskTextSliced(text, { rows: true }), name).toBe(text);
      }
    } finally {
      m.close();
    }
  }, 300_000);

  it('a key whose rows run past the drawer\'s hold goes out masked, at once, never raw (F2)', () => {
    // About 2.1 KB of escapes on each of 128 rows of 64: 277,514 bytes, past the most a drawer holds for a key's rows
    // (`WHOLE_HELD_MAX`). The text goes out in the push that brings it, the chain's rows masked, and the rows that go on
    // with it in later chunks too: failing closed as pane history's cap does (the coordinator's ruling on review 2370
    // F2). Held instead, past the cap, it was sent as one run past a hold, and the whole key showed at every phase.
    const key = keyOf(8_192, 2394);
    const m = fingerprinted(key);
    try {
      const shows = leaks(key);
      let pre = `  ${SGR}\x1b[48;2;20;20;20m`;
      while (pre.length < 2_075) pre += '\x1b[1m';
      const post = '\x1b[24m\x1b[23m\x1b[22m\x1b[49m\x1b[39m';
      const rows: string[] = [];
      for (let i = 0; i < key.length; i += 64) rows.push(`${pre}${key.slice(i, i + 64)}${post}`);
      const text = `$ show\r\n${rows.join('\r\n')}\r\n$ `;
      expect(text.length).toBe(277_514);
      // In one push, with the output not yet ended: it goes out at once, masked, rather than being held.
      vi.useFakeTimers();
      const now: string[] = [];
      const d = m.drawer((t) => now.push(t));
      d.push(text.slice(0, text.length - 5));
      // Key bytes first (review 2411 F8): at e37701c43 this row failed first on the marks count, which hid that every
      // chunk phase there drew key bytes.
      expect(shows(now.join('')), 'key bytes sent in the push itself').toBe(false);
      expect(count(now.join(''), DRAWER_SECRET_MASK), 'marks sent in the push itself').toBeGreaterThanOrEqual(127);
      d.dispose();
      vi.useRealTimers();
      const bad: string[] = [];
      for (const size of [4_096, 65_536]) {
        for (let phase = 0; phase < size; phase += size / 8) {
          const sent = throughDrawer(m, chunked(text, size, phase, 0));
          if (shows(sent) || count(sent, DRAWER_SECRET_MASK) < 128) bad.push(`${size}, phase ${phase}: ${shows(sent) ? 'key bytes drawn' : 'no key bytes'}, ${count(sent, DRAWER_SECRET_MASK)} marks`);
        }
      }
      expect(bad).toEqual([]);
    } finally {
      m.close();
    }
  }, 300_000);

  it('a run longer than one run\'s hold, or joined across escapes past any key, is sent at once, never held (F8)', () => {
    // An open run past what a drawer holds for one run is no key's (D-5995's bound on what a drawer holds): it goes out
    // in the push that brings it, failing closed on a begun shape, and the drawer holds nothing of it. So does a run of
    // one-character pieces between colour escapes longer than any key held (9,000 characters, an 8,192-byte key held):
    // read over the whole text, the walk finds it no key's and holds none of it.
    vi.useFakeTimers();
    const m = fingerprinted(keyOf(300, 2382), keyOf(8_192, 2383));
    try {
      const pieces = keyOf(9_004, 2384).slice(4).replace(/-/g, 'x');
      let glued = '$ rainbow\r\n';
      for (let i = 0; i < pieces.length; i++) glued += `\x1b[3${i % 8}m${pieces[i]}`;
      const out0: string[] = [];
      const d0 = m.drawer((t) => out0.push(t));
      d0.push(glued);
      expect(out0.join('')).toBe(glued);
      d0.dispose();
      const run = keyOf(12_004, 2381).slice(4).replace(/-/g, 'x');
      const out: string[] = [];
      const d = m.drawer((t) => out.push(t));
      d.push(`$ echo\r\n${run}`);
      expect(out.join('')).toBe(`$ echo\r\n${run}`);
      d.dispose();
      const out2: string[] = [];
      const d2 = m.drawer((t) => out2.push(t));
      d2.push(`$ echo\r\n${skOf(12_000)}`);
      expect(out2.join('')).toBe(`$ echo\r\n${DRAWER_SECRET_MASK}`);
      d2.dispose();
    } finally {
      m.close();
    }
  });
});

// D-8728 — THE FAIL-OPEN FORMS C41 LEFT (desktop polish Task C44, review 2411; `docs/superpowers/programs/desktop-polish/c44.md`).
// Each row is red at main (44b86c1f7) for key bytes drawn unless its comment names another reason, and green here.
describe('D-8728 — the forms C41 left open (review 2411)', () => {
  afterEach(() => { vi.useRealTimers(); });

  const SGR = '\x1b[38;2;153;153;153m';
  const POST = '\x1b[24m\x1b[23m\x1b[22m\x1b[49m\x1b[39m';
  /** `out` with its escapes read away. */
  const plain = (out: string): string =>
    out.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[PX^_][^\x1b]*\x1b\\|[ -/]*[0-~])/g, '');
  /** How many of `key`'s bytes `out` shows: the positions some slice of 8 of it covers, its escapes read away. */
  const shownOf = (key: string): ((out: string) => number) => {
    const grams = new Map<string, number[]>();
    for (let i = 0; i + 8 <= key.length; i++) {
      const g = key.slice(i, i + 8);
      const at0 = grams.get(g);
      if (at0 === undefined) grams.set(g, [i]); else at0.push(i);
    }
    return (raw) => {
      const out = plain(raw);
      const cov = new Uint8Array(key.length);
      for (let i = 0; i + 8 <= out.length; i++) for (const p of grams.get(out.slice(i, i + 8)) ?? []) cov.fill(1, p, p + 8);
      return cov.reduce((n, c) => n + c, 0);
    };
  };
  /** `text` in chunks of `size` from `phase`, each `quietMs` apart. */
  const chunked = (text: string, size: number, phase: number, quietMs: number): { text: string; quietMs: number }[] => {
    const out = phase > 0 ? [{ text: text.slice(0, phase), quietMs }] : [];
    for (let c = phase; c < text.length; c += size) out.push({ text: text.slice(c, c + size), quietMs });
    out[out.length - 1]!.quietMs = 40;
    return out;
  };
  const ordinary = (n: number): string => {
    let t = '';
    for (let i = 0; t.length < n; i++) t += `line ${i} of ordinary output\n`;
    return t;
  };
  /** Upper case, so no slice of 8 of it is a held key's (both come from one generator). */
  const blob = (n: number, seed: number): string => keyOf(n + 4, seed).slice(4).toUpperCase().replace(/-/g, 'Z');
  /** A listing in colour, each row after an OSC 8 hyperlink (`pre`, 89 bytes or more of escapes a row), then `key` at
   *  `cols`, then `after` more rows; `colon`: a row `the key:` before the key, so the key's rows begin a chain of their own. */
  const listingOf = (key: string, cols: number, before: number, after: number, seed: number, colon: boolean,
    pre: (r: number) => string, post: string): { text: string; keyAt: number; rowStarts: number[] } => {
    const head = blob(before * cols, seed);
    const tail = blob(after * cols, seed + 1);
    let text = `${at(1, 1)}$ list\r\n`;
    let r = 0;
    for (let i = 0; i < head.length; i += cols, r++) text += pre(r) + head.slice(i, i + cols) + post;
    if (colon) text += `${pre(r++)}the key:${post}`;
    const keyAt = text.length;
    const rowStarts: number[] = [];
    for (let i = 0; i < key.length; i += cols, r++) { text += pre(r); rowStarts.push(text.length); text += key.slice(i, i + cols) + post; }
    for (let i = 0; i < tail.length; i += cols, r++) text += pre(r) + tail.slice(i, i + cols) + post;
    return { text: `${text}\r\n${at(50, 1)}$ `, keyAt, rowStarts };
  };
  const osc8 = (r: number): string =>
    `${at(r % 50 + 1, 1)}${SGR}\x1b[48;2;20;20;20m\x1b]8;;https://example.com/a/fairly/long/path/to/row/${r}\x1b\\`;
  const OSC8_END = '\x1b]8;;\x1b\\\x1b[39;49m';
  /** The phases of `text` in chunks of each size (`step` apart) that draw a key byte or not `rows` marks (the first five). */
  const badPhases = (m: SecretMasker, key: string, text: string, rows: number, sizes: readonly (readonly [number, number])[]): string[] => {
    const shown = shownOf(key);
    const bad: string[] = [];
    for (const [size, step] of sizes) {
      for (let p = 0; p < size && bad.length < 5; p += step) {
        const sent = throughDrawer(m, chunked(text, size, p, 0));
        const marks = count(sent, DRAWER_SECRET_MASK);
        if (shown(sent) > 0 || marks !== rows) bad.push(`${size} B chunks, phase ${p}: ${shown(sent)} key bytes, ${marks} marks`);
      }
    }
    return bad;
  };

  it('F1: a key after rows whose escapes pass the drawer\'s 64-byte lead is never drawn, in chunks of 16 bytes to 4 KiB', () => {
    // When the escapes before a key row's first byte pass the 64 bytes of sent text the drawer reads with a push, that text
    // starts inside an escape, its tail reads as a run joined to the key's row, and the walk stopped a row late as if
    // proven: the held text's first row went out each push, unjoined. At main: the whole key in each form below.
    const A = keyOf(1_600, 2411);
    const mA = fingerprinted(A, keyOf(8_192, 2412));
    try {
      const { text } = listingOf(A, 64, 100, 90, 2413, false, osc8, OSC8_END);
      expect(badPhases(mA, A, text, 25, [[64, 4]]), 'the styled listing with 90 rows after it').toEqual([]);
    } finally {
      mA.close();
    }
    const B = keyOf(1_210, 2414);
    const mB = fingerprinted(B, keyOf(8_192, 2415));
    try {
      const { text } = listingOf(B, 110, 60, 20, 2416, false, osc8, OSC8_END);
      expect(badPhases(mB, B, text, 11, [[16, 1], [64, 4], [256, 16], [1_024, 16]]), 'the OSC 8 listing at 110 columns').toEqual([]);
      // A hyperlink ended by BEL, its URL past the 64 bytes: no escape lies between the lead's tail and the key's row.
      const bel = (r: number): string =>
        `${at(r % 50 + 1, 1)}\x1b]8;;https://example.com/a/very/long/path/to/some/resource/in/a/listing/of/rows/number/${r}\x07`;
      const t2 = listingOf(B, 110, 40, 0, 2417, true, bel, '\x1b]8;;\x07').text;
      expect(badPhases(mB, B, t2, 11, [[16, 1], [64, 4]]), 'a BEL-ended hyperlink before each row').toEqual([]);
    } finally {
      mB.close();
    }
    const C = keyOf(4_000, 2418);
    const mC = fingerprinted(C);
    try {
      let text = `${at(4, 1)}$ show-key\r\n`;
      let r = 0;
      for (let i = 0; i < C.length; i += 200, r++) {
        text += `${at(5 + (r % 40), 1)}${SGR}\x1b[48;2;20;20;20m\x1b[1m\x1b[3m\x1b[4m\x1b[53m\x1b[58;5;99m${C.slice(i, i + 200)}`;
      }
      text += `\x1b[0m\r\n${at(46, 1)}$ `;
      expect(badPhases(mC, C, text, 20, [[16, 1], [64, 4], [256, 16], [1_024, 64], [4_096, 256]]), 'a cursor position and SGRs before each row').toEqual([]);
    } finally {
      mC.close();
    }
  }, 300_000);

  it('F1: three chunks cut at a key row\'s first byte, or two chunks 7 or 13 ms apart, never draw a row', () => {
    // The OSC 8 listing at 110 columns, a row `the key:` before the key so its rows begin their own chain: the held key's
    // first row was sent at the next push or at the hold's expiry (main: 66 of 330 three-chunk cases and 702 of 839 cuts
    // at each gap, 110 bytes each).
    const key = keyOf(1_210, 2419);
    const m = fingerprinted(key, keyOf(8_192, 2420));
    try {
      const shown = shownOf(key);
      const { text, keyAt, rowStarts } = listingOf(key, 110, 60, 20, 2421, true, osc8, OSC8_END);
      const bad: string[] = [];
      for (const rs of rowStarts) {
        for (let k = 0; k < 30 && bad.length < 5; k++) {
          const x = keyAt - 3_000 + ((k * 7_919) % (text.length - keyAt + 3_000));
          const [a, b] = x < rs ? [x, rs] : [rs, x];
          if (a === b || a <= 0) continue;
          const sent = throughDrawer(m, [{ text: text.slice(0, a), quietMs: 0 }, { text: text.slice(a, b), quietMs: 0 }, { text: text.slice(b), quietMs: 40 }]);
          if (shown(sent) > 0 || count(sent, DRAWER_SECRET_MASK) !== 11) bad.push(`cuts at ${a} and ${b}: ${shown(sent)} key bytes`);
        }
      }
      expect(bad, 'three chunks').toEqual([]);
      for (const gap of [7, 13]) {
        for (let c = keyAt; c < rowStarts[rowStarts.length - 1]! + 200 && bad.length < 5; c += 3) {
          const sent = throughDrawer(m, [{ text: text.slice(0, c), quietMs: gap }, { text: text.slice(c), quietMs: 40 }]);
          if (shown(sent) > 0 || count(sent, DRAWER_SECRET_MASK) !== 11) bad.push(`${gap} ms at ${c}: ${shown(sent)} key bytes`);
        }
      }
      expect(bad, 'two chunks, a gap of one or two holds').toEqual([]);
    } finally {
      m.close();
    }
  }, 300_000);

  it('F2: pane history: a key whose rows carry an indent wider than the lookahead\'s reads is masked wherever the cut', async () => {
    // 2,600 blanks of indent a row: the lookahead grew to its cap and ended inside a row's indent, read no run there and
    // answered "no cut", so the key's rows went out raw on both sides (main: the whole key at 15 of 16 placements and 448
    // bytes at placement 11). And one row after 30,000 or 300,000 blanks: the first read was all indent, so it never grew
    // (main: 1,000 and 2,000 bytes).
    const key = keyOf(8_192, 2422);
    const m = fingerprinted(key);
    try {
      const shown = shownOf(key);
      const lines: string[] = [];
      for (let i = 0; i < key.length; i += 64) lines.push(`${' '.repeat(2_600)}${key.slice(i, i + 64)}${POST}`);
      const block = `key:\n${lines.join('\n')}\ndone\n`;
      expect(block.length).toBe(344_330);
      const bad: string[] = [];
      for (let k = 0; k < 16; k++) {
        const out = await m.maskTextSliced(`${ordinary(1_000 + k * 4_096)}${block}${'tail line\n'.repeat(50)}`, { rows: true });
        if (shown(out) > 0 || count(out, SECRET_MASK) < 128) bad.push(`placement ${k}: ${shown(out)} key bytes, ${count(out, SECRET_MASK)} marks`);
      }
      expect(bad).toEqual([]);
    } finally {
      m.close();
    }
    const key2 = keyOf(2_000, 2423);
    const m2 = fingerprinted(key2);
    try {
      const shown = shownOf(key2);
      for (const wide of [30_000, 300_000]) {
        const rows: string[] = [];
        for (let i = 0; i < key2.length; i += 100) rows.push(`${i === 1_000 ? ' '.repeat(wide) : '  '}${key2.slice(i, i + 100)}`);
        const block = `key:\n${rows.join('\n')}\ndone\n`;
        for (let k = 0; k < 8; k++) {
          const out = await m2.maskTextSliced(`${ordinary(60_000 + k * 600)}${block}`, { rows: true });
          expect(shown(out), `${wide} blanks, placement ${k}`).toBe(0);
        }
      }
    } finally {
      m2.close();
    }
  }, 300_000);

  it('F3: pane history: a key coloured per character on one joined row is masked through every slice', async () => {
    // No row break, so slices were cut inside an escape, and the chain's rows were carried for one 256 KiB window only:
    // the key's tail went out raw (main: 1,799, 6,026 and 7,538 of 8,192 characters with 40, 120 and 500-byte escapes, and
    // 1,477 of 2,000 with 500-byte escapes).
    for (const [n, esc] of [[8_192, 40], [8_192, 120], [8_192, 500], [2_000, 500]] as const) {
      const key = keyOf(n, 2424 + esc);
      const m = fingerprinted(key, keyOf(300, 2425));
      try {
        const shown = shownOf(key);
        let row = '';
        for (let i = 0; i < n; i++) {
          let e = `\x1b[38;2;${(i * 7) % 256};${(i * 13) % 256};${(i * 29) % 256};48;2;${(i * 3) % 256};${(i * 5) % 256};9`;
          while (e.length < esc - 1) e += ';1';
          row += `${e.slice(0, esc - 1)}m${key[i]}`;
        }
        for (const filler of [500, 20_000, 50_000]) {
          const out = await m.maskTextSliced(`${ordinary(filler)}$ show\n${row}\x1b[0m\n$ ${'\ntail line'.repeat(20)}\n`, { rows: true });
          expect(shown(out), `${n} characters, ${esc}-byte escapes, ${filler} bytes before`).toBe(0);
        }
      } finally {
        m.close();
      }
    }
    // The same key on 128 rows of 64, each character after a 20-byte escape (172,430 bytes): past the lookahead, so the
    // chain's rows go on from the cut by a key's own units. Counting the NUL each escape reads as spent them at half the
    // rows (that mutant: key bytes at 5 of 8 placements, up to 2,671 (1,967 at the first)); main reads this block whole
    // and shows nothing.
    const key = keyOf(8_192, 2431);
    const m = fingerprinted(key);
    try {
      const shown = shownOf(key);
      const rows: string[] = [];
      for (let r = 0; r < 128; r++) {
        let row = '  ';
        for (let c = 0; c < 64; c++) {
          const i = r * 64 + c;
          let e = `\x1b[38;2;${(i * 7) % 256};${(i * 13) % 256};${(i * 29) % 256}`;
          while (e.length < 19) e += ';1';
          row += `${e.slice(0, 19)}m${key[i]}`;
        }
        rows.push(row);
      }
      const block = `key:\n${rows.join('\n')}\n\x1b[0mdone\n`;
      for (let k = 0; k < 8; k++) {
        const out = await m.maskTextSliced(`${ordinary(1_000 + k * 8_000)}${block}${'tail line\n'.repeat(30)}`, { rows: true });
        expect(shown(out), `128 rows coloured per character, placement ${k}`).toBe(0);
      }
    } finally {
      m.close();
    }
  }, 300_000);

  it('F4: a slice of pane history or a drawer push reads at most 64 KiB past what it sends, on a hostile key-free pane', async () => {
    // The cost of a slice and of a push grows with what it reads past its own text: up to 256 KiB at main, which cost
    // pane-history slices of 26 to 37 ms and drawer pushes of about 25 ms on key-free chains of escaped rows (review 2411
    // F4). The bound is pinned on what each mask is handed, so the row does not hang on the box's load; c44.md has the
    // times. Past it a chain is masked, never sent raw (the F2 and F3 rows above).
    const m = fingerprinted(keyOf(8_192, 2426), keyOf(300, 2427));
    const reads: number[] = [];
    const texts: number[] = [];
    const inner = m.maskWithCarry.bind(m);
    (m as unknown as { maskWithCarry: typeof inner }).maskWithCarry = (t, o) => {
      reads.push((o?.lookahead ?? '').length);
      texts.push(t.length);
      return inner(t, o);
    };
    try {
      const rowsOf = (n: number, escapes: number, seed: number, sep: string): string => {
        let pre = `  ${SGR}\x1b[48;2;20;20;20m`;
        while (pre.length < escapes - 25) pre += '\x1b[1m';
        const b = blob(n * 64, seed);
        return Array.from({ length: n }, (_, i) => `${pre}${b.slice(i * 64, i * 64 + 64)}${POST}`).join(sep);
      };
      await m.maskTextSliced(rowsOf(400, 2_600, 2428, '\n'), { rows: true });
      expect(reads.length, 'slices').toBeGreaterThan(10);
      expect(Math.max(...reads), 'a slice\'s lookahead').toBeLessThanOrEqual(64 * 1_024);
      // A slice that ends at a LF ends at the end of its row break as `ROW_BREAK` reads it (LF then CR is one), but only
      // within 64 bytes of the LF: 300,000 blanks between a LF and a CR stretched a slice to 360 KB (review 2430 fix round).
      texts.length = 0;
      await m.maskTextSliced(`${ordinary(60_000)}\n${' '.repeat(300_000)}\r${ordinary(10_000)}`, { rows: true });
      expect(Math.max(...texts), 'a slice\'s own text').toBeLessThanOrEqual(64 * 1_024 + 64);
      reads.length = 0;
      const text = `$ show\r\n${rowsOf(140, 1_800, 2429, '\r\n')}\r\n$ `;
      throughDrawer(m, chunked(text, 256, 0, 0));
      expect(reads.length, 'pushes sent').toBeGreaterThan(10);
      expect(Math.max(...reads), 'the held text a push reads').toBeLessThanOrEqual(64 * 1_024);
    } finally {
      m.close();
    }
  }, 300_000);

  it('F7: an open tail at the window\'s first byte is masked in the push itself; a row\'s run there is held, never sent', () => {
    // r19's arm (`hold === 0 && base > 0`) sends a text whose open tail starts at the window's first byte, the tail
    // masked (review 2411 F7: deleted, the begun shape was held instead). It sent a begun shape that ENDS ITS ROW there
    // too, before more than 9 KB of blanks, which the fail-closed tail does not reach: the key's next row came later and
    // was matched by nothing (main: 98 bytes of a 108-byte shape key whose row ended after `sk-ant-api`).
    vi.useFakeTimers();
    const m = new SecretMasker();
    try {
      let body = '';
      for (let i = 0; body.length < 95; i++) body += `Q7x${'abcdefghijkmnopqrstuvwxyz'[i % 25]}Z${i % 10}`;
      const key = ['sk', 'ant', 'api03', body.slice(0, 95)].join('-');
      const shown = shownOf(key);
      const WINDOW = 2 * (8_192 + 1_024) + 64;
      const before = `${'ordinary words of output '.repeat(1_000)}\r\n`;
      // The open tail: the begun shape runs on into an OSC that has not ended and has no delimiter.
      const osc = `\x1b]${'X'.repeat(9_400)}`;
      const out: string[] = [];
      const d = m.drawer((t) => out.push(t));
      d.push(`${before}${key.slice(0, 10)}${'y'.repeat(WINDOW - 10 - osc.length)}${osc}`);
      expect(out.join('').endsWith(DRAWER_SECRET_MASK), 'masked in the push itself').toBe(true);
      expect(shown(out.join(''))).toBe(0);
      d.dispose();
      // A run that ends its row at the window's first byte, then blanks and an OSC that has not ended: held from there.
      const title = '\x1b]0;title of a pane';
      const out2: string[] = [];
      const d2 = m.drawer((t) => out2.push(t));
      d2.push(`${before}${key.slice(0, 10)}\r\n${' '.repeat(WINDOW - 12 - title.length)}${title}`);
      d2.push(`\x07${key.slice(10)}\r\n$ `);
      vi.advanceTimersByTime(40);
      expect(shown(out2.join('')), 'the key across the row end').toBe(0);
      d2.dispose();
    } finally {
      m.close();
    }
  });

  it('a key whose rows pass the drawer\'s hold is masked to its end when a push ends inside one of its rows', () => {
    // 600 bytes of escapes on each of 128 rows of 64 (85,514 bytes): past the 64 KiB hold, so the text goes out at the push
    // that passes it, the chain's rows masked, and the rows that go on with it in later pushes too. A push that ended
    // inside a row left the rest of that row (its escapes and its row end) to begin the next text, read as an empty row
    // that ended the chain: 23 later rows were drawn (found in this task at the 64 KiB hold; at main the text is read
    // whole and shows nothing, so this row reds its mutant, not main).
    const key = keyOf(8_192, 2430);
    const m = fingerprinted(key);
    try {
      let pre = `  ${SGR}\x1b[48;2;20;20;20m`;
      while (pre.length < 575) pre += '\x1b[1m';
      const rows: string[] = [];
      for (let i = 0; i < key.length; i += 64) rows.push(`${pre}${key.slice(i, i + 64)}${POST}`);
      const text = `$ show\r\n${rows.join('\r\n')}\r\n$ `;
      expect(text.length).toBe(85_514);
      const shown = shownOf(key);
      for (let p = 0; p < 4_096; p += 512) expect(shown(throughDrawer(m, chunked(text, 4_096, p, 0))), `phase ${p}`).toBe(0);
    } finally {
      m.close();
    }
  }, 300_000);

  // Review 2430 F1: past the 64 KiB hold (`WHOLE_HELD_MAX`) a key's rows are read by the carried-chain arms, which read a
  // move down then a CR (CUD+CR, IND+CR; viewed LF, NUL, CR) as two breaks with an empty row between, and a push cut inside
  // a break as an empty row: the chain ended there and the key's later rows went out raw. Main read these texts whole and
  // masked them; past its own 256 KiB hold main has the same reader (the last form below).
  const MOVE_DOWN: readonly (readonly [string, string])[] = [['CUD+CR', '\x1b[B\r'], ['IND+CR', '\x1bD\r']];
  /** `key` at `cols` a row, each row after `preLen` bytes or more of escapes, rows joined by `sep`, after `before` rows
   *  of other text; and where each row break begins. */
  const rowsOf = (key: string, cols: number, preLen: number, sep: string, before = 0): { text: string; breaks: number[] } => {
    let pre = `  ${SGR}\x1b[48;2;20;20;20m`;
    while (pre.length < preLen) pre += '\x1b[1m';
    const head = blob(before * cols, 2440);
    const rows: string[] = [];
    for (let i = 0; i < head.length; i += cols) rows.push(`${pre}${head.slice(i, i + cols)}${POST}`);
    for (let i = 0; i < key.length; i += cols) rows.push(`${pre}${key.slice(i, i + cols)}${POST}`);
    let text = '$ show\r\n';
    const breaks: number[] = [];
    rows.forEach((r, k) => { if (k > 0) { breaks.push(text.length); text += sep; } text += r; });
    return { text: `${text}\r\n$ `, breaks };
  };
  /** `key` at `cols` a row, each character after an escape of `esc` bytes, rows joined by `sep`. */
  const perCharOf = (key: string, cols: number, esc: number, sep: string): string => {
    const rows: string[] = [];
    for (let i = 0; i < key.length; i += cols) {
      let row = '  ';
      for (let c = i; c < Math.min(key.length, i + cols); c++) {
        let e = `\x1b[38;2;${(c * 7) % 256};${(c * 13) % 256};${(c * 29) % 256}`;
        while (e.length < esc - 1) e += ';1';
        row += `${e.slice(0, esc - 1)}m${key[c]}`;
      }
      rows.push(row);
    }
    return `$ show\r\n${rows.join(sep)}\r\n$ `;
  };
  /** The phases of `text` in chunks of 4 and 16 KiB (eight each) that draw a key byte, or no mark: a drawer that sent
   *  nothing would show no key byte either (C45, review 2445 F6). */
  const shownPhases = (m: SecretMasker, key: string, text: string): string[] => {
    const shown = shownOf(key);
    const bad: string[] = [];
    for (const size of [4_096, 16_384]) {
      for (let p = 0; p < size; p += size / 8) {
        const sent = throughDrawer(m, chunked(text, size, p, 0));
        const n = shown(sent);
        if (n > 0 || !sent.includes(DRAWER_SECRET_MASK)) bad.push(`${size} B chunks, phase ${p}: ${n} key bytes, ${count(sent, DRAWER_SECRET_MASK)} marks`);
      }
    }
    return bad;
  };

  it('a key whose rows a move down then a CR breaks, past the drawer\'s hold, is never drawn (review 2430 F1)', () => {
    // Main masks every form; before the fix (77afd3c59, measured by C45 with this row's phases): up to 1,984 bytes at 31 of
    // its 32 runs, CUD+CR and IND+CR (8,192 bytes at 64 columns, 600 bytes of escapes a row, 88,840 and 88,713 bytes), and
    // 350 and 600 bytes at 30 and 32 of 32 (2,000 and 4,000 bytes coloured per character).
    for (const [name, sep] of MOVE_DOWN) {
      const key = keyOf(8_192, 2441);
      const m = fingerprinted(key);
      try {
        const { text } = rowsOf(key, 64, 600, sep);
        expect(text.length).toBeGreaterThan(64 * 1_024);
        expect(shownPhases(m, key, text), `${name}, 600 bytes of escapes a row`).toEqual([]);
      } finally {
        m.close();
      }
      for (const [n, cols] of [[2_000, 110], [4_000, 200]] as const) {
        const k2 = keyOf(n, 2442 + cols);
        const m2 = fingerprinted(k2);
        try {
          expect(shownPhases(m2, k2, perCharOf(k2, cols, 40, sep)), `${name}, ${n} characters coloured per character`).toEqual([]);
        } finally {
          m2.close();
        }
      }
    }
  }, 300_000);

  it('pane history: a key whose rows a move down then a CR breaks is masked past the lookahead (review 2430 F1)', async () => {
    // Main masks every form; before the fix (77afd3c59, measured by C45): 400 of 2,000 bytes at 8 of 8 placements (1,800
    // bytes of escapes a row after 200 rows of other text), 8,064 of 8,128 at 6 of 6 with CUD+CR (700 and 1,500 bytes a
    // row) and 5,632 at 6 of 6 with IND+CR at 1,500 (0 at 700).
    for (const [name, sep] of MOVE_DOWN) {
      const key = keyOf(2_000, 2443);
      const m = fingerprinted(key);
      try {
        const shown = shownOf(key);
        const { text } = rowsOf(key, 40, 1_800, sep, 200);
        for (let k = 0; k < 8; k++) {
          const out = await m.maskTextSliced(`${ordinary(1_000 + k * 7_000)}${text}\n${'tail line\n'.repeat(30)}`, { rows: true });
          expect(shown(out), `${name}, 200 rows before, placement ${k}`).toBe(0);
          expect(count(out, SECRET_MASK), `${name}, 200 rows before, placement ${k}: marks`).toBeGreaterThan(0);
        }
      } finally {
        m.close();
      }
      const key2 = keyOf(8_128, 2444);
      const m2 = fingerprinted(key2);
      try {
        const shown = shownOf(key2);
        for (const preLen of [700, 1_500]) {
          const { text } = rowsOf(key2, 64, preLen, sep);
          for (let k = 0; k < 6; k++) {
            const out = await m2.maskTextSliced(`${ordinary(1_000 + k * 9_000)}${text}\n${'tail line\n'.repeat(30)}`, { rows: true });
            expect(shown(out), `${name}, ${preLen} bytes of escapes a row, placement ${k}`).toBe(0);
            expect(count(out, SECRET_MASK), `${name}, ${preLen} bytes of escapes a row, placement ${k}: marks`).toBeGreaterThan(0);
          }
        }
      } finally {
        m2.close();
      }
    }
  }, 300_000);

  it('two pushes cut inside a row break past the drawer\'s hold, between CR and LF or a move down and its CR, draw nothing (review 2430 F1)', () => {
    // At every row break past 60,000 bytes. Main masks every cut; before the fix (77afd3c59, measured by C45): 33 of 41 cuts
    // a form drew up to 2,112 bytes, CR LF, CUD+CR and IND+CR alike.
    const key = keyOf(8_192, 2445);
    const m = fingerprinted(key);
    try {
      const shown = shownOf(key);
      for (const [name, sep, inside] of [['CR LF', '\r\n', [1]], ['CUD+CR', '\x1b[B\r', [3]], ['IND+CR', '\x1bD\r', [2]]] as const) {
        const { text, breaks } = rowsOf(key, 64, 600, sep);
        const bad: string[] = [];
        for (const b of breaks) {
          if (b < 60_000) continue;
          for (const c of inside.map((d) => b + d)) {
            const sent = throughDrawer(m, [{ text: text.slice(0, c), quietMs: 0 }, { text: text.slice(c), quietMs: 40 }]);
            const n = shown(sent);
            if ((n > 0 || !sent.includes(DRAWER_SECRET_MASK)) && bad.length < 5) bad.push(`cut at ${c}: ${n} key bytes, ${count(sent, DRAWER_SECRET_MASK)} marks`);
          }
        }
        expect(bad, name).toEqual([]);
      }
    } finally {
      m.close();
    }
  }, 300_000);

  it('a key whose rows a move down then a CR breaks, past 256 KiB, is never drawn (review 2430 F1; red at main too)', () => {
    // 4,600 bytes of escapes a row (295,698 bytes): past main's 256 KiB hold too, where main's carried rows read the break
    // the same way (measured by C45 with this row's 16 phases: main 352 bytes at 16 of 16; before the fix 736 at 15 of 16).
    const key = keyOf(4_000, 2446);
    const m = fingerprinted(key);
    try {
      const { text } = rowsOf(key, 64, 4_600, '\x1b[B\r');
      expect(text.length).toBeGreaterThan(256 * 1_024);
      expect(shownPhases(m, key, text)).toEqual([]);
    } finally {
      m.close();
    }
  }, 300_000);

  it('pane history: a key whose rows end in CR LF, or LF then CR, is masked across a slice or a grown read (review 2430 F3)', async () => {
    // A grown read ended at the LF of a CR LF, read the CR as an empty last row and answered "no cut", so the key's rows went
    // out raw on both sides (main and before the fix alike, measured by C45: 80 to 2,000 bytes at 7 of 8 placements, the
    // whole key at 4; 4,000 and 8,192 bytes coloured per character, the whole key at 8 of 8). And a slice ended after the LF
    // of a LF then CR (or a LF, blanks, then CR), one row down, and began the next with the CR, an empty row (main and before
    // the fix alike: the whole 2,000 bytes at 7 of 8, 360 at the other). Both read the row break as `ROW_BREAK` does.
    const key = keyOf(2_000, 2447);
    const m = fingerprinted(key);
    try {
      const shown = shownOf(key);
      for (const [name, sep] of [['CR LF', '\r\n'], ['LF CR', '\n\r'], ['LF, blanks, CR', '\n  \r']] as const) {
        const { text } = rowsOf(key, 40, 1_800, sep, 200);
        for (let k = 0; k < 8; k++) {
          const out = await m.maskTextSliced(`${ordinary(1_000 + k * 7_000)}${text}\n${'tail line\n'.repeat(30)}`, { rows: true });
          expect(shown(out), `${name}, 1,800 bytes of escapes a row, placement ${k}`).toBe(0);
          expect(count(out, SECRET_MASK), `${name}, 1,800 bytes of escapes a row, placement ${k}: marks`).toBeGreaterThan(0);
        }
      }
    } finally {
      m.close();
    }
    for (const [n, cols, esc] of [[4_000, 80, 40], [8_192, 64, 20]] as const) {
      const k2 = keyOf(n, 2448 + esc);
      const m2 = fingerprinted(k2);
      try {
        const shown = shownOf(k2);
        for (let k = 0; k < 8; k++) {
          const out = await m2.maskTextSliced(`${ordinary(1_000 + k * 8_000)}key:\n${perCharOf(k2, cols, esc, '\r\n')}\n${'tail line\n'.repeat(30)}`, { rows: true });
          expect(shown(out), `${n} characters coloured per character, placement ${k}`).toBe(0);
          expect(count(out, SECRET_MASK), `${n} characters coloured per character, placement ${k}: marks`).toBeGreaterThan(0);
        }
      } finally {
        m2.close();
      }
    }
  }, 300_000);

  it('a push that ends in more than 4 KiB of escapes after a key\'s row goes on with the chain (review 2430 F2)', () => {
    // `endsInRow` reads a text's last 4 KiB; all escapes, it cannot see where the row ends and answers "inside a row", so the
    // rest of the row (more escapes, then its break) never reads as an empty row that ends the chain. Two pushes, the first
    // past the hold and ending 4,200 bytes into the escapes after a key's row; answering "not inside a row" there drew the
    // key's later rows.
    const key = keyOf(2_000, 2449);
    const m = fingerprinted(key);
    try {
      const shown = shownOf(key);
      let post = POST;
      while (post.length < 4_600) post += '\x1b[1m';
      let text = '$ show\r\n';
      const cuts: number[] = [];
      for (let i = 0; i < key.length; i += 64) {
        if (i > 0) text += '\r\n';
        text += `  ${key.slice(i, i + 64)}`;
        if (text.length > 64 * 1_024) cuts.push(text.length + 4_200);
        text += post;
      }
      text += '\r\n$ ';
      const bad: string[] = [];
      for (const c of cuts) {
        const sent = throughDrawer(m, [{ text: text.slice(0, c), quietMs: 0 }, { text: text.slice(c), quietMs: 40 }]);
        const n = shown(sent);
        if (n > 0 || !sent.includes(DRAWER_SECRET_MASK)) bad.push(`cut at ${c}: ${n} key bytes, ${count(sent, DRAWER_SECRET_MASK)} marks`);
      }
      expect(cuts.length).toBeGreaterThan(10);
      expect(bad).toEqual([]);
    } finally {
      m.close();
    }
  }, 300_000);

  it('a later push past the hold that ends inside a row break hands the break on to the next (review 2430 F1)', () => {
    // Three pushes: the first passes the hold, the second ends between CR and LF, LF and CR, or a move down and its CR,
    // the third brings the rest at once or after a pause past the hold, when the held tail goes out unheld, ending in the
    // break. The chain the first push carries is read on by each later push, which hands on a break it ends inside as the
    // first push's text does (C44). Before the fix (77afd3c59, measured by C45): 26, 26, 54 and 52 cuts drew up to 1,664 to
    // 2,048 bytes; main draws the key's later rows, up to the whole key, at 26 or 27 cuts a form, those with the pause (it
    // holds a key's rows no longer than a pause), so this row reds at main too.
    const key = keyOf(8_192, 2450);
    const m = fingerprinted(key);
    try {
      const shown = shownOf(key);
      for (const [name, sep, d] of [['CR LF', '\r\n', 1], ['LF CR', '\n\r', 1], ['CUD+CR', '\x1b[B\r', 3], ['IND+CR', '\x1bD\r', 2]] as const) {
        const { text, breaks } = rowsOf(key, 64, 600, sep);
        const bad: string[] = [];
        for (const b of breaks) {
          if (b < 70_000) continue;
          for (const gap of [0, 100]) {
            const sent = throughDrawer(m, [
              { text: text.slice(0, 66_000), quietMs: 0 }, { text: text.slice(66_000, b + d), quietMs: gap }, { text: text.slice(b + d), quietMs: 40 },
            ]);
            const n = shown(sent);
            if ((n > 0 || !sent.includes(DRAWER_SECRET_MASK)) && bad.length < 5) bad.push(`cut at ${b + d}, ${gap} ms after it: ${n} key bytes, ${count(sent, DRAWER_SECRET_MASK)} marks`);
          }
        }
        expect(bad, name).toEqual([]);
      }
    } finally {
      m.close();
    }
  }, 300_000);

  // D-8749 (desktop polish Task C45, review 2445): the forms C44 left, on the same helpers. `c45.md` has the sizes.
  describe('D-8749 — the masker follow-up to C44 (review 2445)', () => {
    it('pane history: a key whose rows a LF, 64 blanks or more or an escape, then a CR breaks is masked across a slice cut (F1)', async () => {
      // Review 2445 F1 (`pane-cut-long-break`): a slice cut after the LF of such a break (past `BREAK_CUT_MAX`, or an
      // escape the cut read as text) began the next slice's lookahead with the blanks and the CR, read as an empty row that
      // ended the key's rows, and the key went out raw: at `main`, the whole 2,000 bytes at 3 of 4 placements and 360 at
      // the other for 64 and 65 blanks, 64 NULs, LF SGR CR and LF CUF CR, and at 4 of 4 for 200 blanks (rows of 468,006 to
      // 516,810 bytes a form, 469,323 to 560,139 bytes masked). 62 and 63 blanks stay masked, as at `main`.
      const key = keyOf(2_000, 2461);
      const m = fingerprinted(key);
      try {
        const shown = shownOf(key);
        const forms: [string, string][] = [62, 63, 64, 65, 200].map((n) => [`LF, ${n} blanks, CR`, `\n${' '.repeat(n)}\r`]);
        forms.push(['LF, 64 NULs, CR', `\n${'\0'.repeat(64)}\r`], ['LF, SGR, CR', '\n\x1b[0m\r'], ['LF, CUF, CR', '\n\x1b[2C\r']);
        for (const [name, sep] of forms) {
          const { text } = rowsOf(key, 40, 1_800, sep, 200);
          for (let k = 0; k < 4; k++) {
            const out = await m.maskTextSliced(`${ordinary(1_000 + k * 14_000)}${text}\n${'tail line\n'.repeat(30)}`, { rows: true });
            expect(shown(out), `${name}, placement ${k}`).toBe(0);
            expect(count(out, SECRET_MASK), `${name}, placement ${k}: marks`).toBeGreaterThan(0);
          }
        }
      } finally {
        m.close();
      }
    }, 300_000);

    it('a slice of pane history ends after a LF, 63 blanks and a CR, and after the LF of 64 blanks or more (F3: BREAK_CUT_MAX)', async () => {
      // `BREAK_CUT_MAX` (64) decides where a slice ends, not what is masked (the F1 row): within it the slice ends after
      // the break's CR, past it after the LF. Pinned on the first slice's own text, so 63 and 65 each red a row (review 2445
      // F3: both passed C44's describe). An escape between the LF and the CR is read through the escape view, as part of
      // the break.
      const m = fingerprinted(keyOf(300, 2462));
      const texts: string[] = [];
      const inner = m.maskWithCarry.bind(m);
      (m as unknown as { maskWithCarry: typeof inner }).maskWithCarry = (t, o) => { texts.push(t); return inner(t, o); };
      try {
        const LF_AT = 65_000;
        let pre = '';
        for (let i = 0; pre.length < LF_AT - 100; i++) pre += `line ${i} of ordinary output\n`;
        pre += 'w'.repeat(LF_AT - pre.length);
        const forms: [string, string, number][] = [
          ['63 blanks', `\n${' '.repeat(63)}\r`, 65], ['64 blanks', `\n${' '.repeat(64)}\r`, 1], ['65 blanks', `\n${' '.repeat(65)}\r`, 1],
          ['62 NULs', `\n${'\0'.repeat(62)}\r`, 64], ['an SGR', '\n\x1b[0m\r', 6], ['a CUF', '\n\x1b[2C\r', 6], ['a LF alone', '\n  more', 1],
        ];
        for (const [name, brk, cut] of forms) {
          texts.length = 0;
          await m.maskTextSliced(`${pre}${brk}${'more words '.repeat(60)}\n${ordinary(10_000)}`, { rows: true });
          expect(texts[0]!.length, `LF, ${name}`).toBe(LF_AT + cut);
        }
      } finally {
        m.close();
      }
    }, 300_000);

    it('a key whose rows a CR CR LF breaks (a CR LF doubled) is masked, through the drawer and in pane history (F4)', async () => {
      // Review 2445 F4 (`drawer-consecutive-breaks`): `ROW_BREAK` read CR CR LF as a CR, then a CR LF, an empty row between
      // that ended the key's rows, so the whole key showed at `main`: in one drawer push, at every phase in chunks, and at
      // every placement in pane history, plain rows or 600 bytes of escapes a row past the hold. It is one row down now.
      // The other consecutive-break forms review 2445 measured stay as at `main` (`c45.md`).
      const key = keyOf(2_000, 2463);
      const m = fingerprinted(key);
      try {
        const shown = shownOf(key);
        const { text } = rowsOf(key, 64, 0, '\r\r\n');
        const one = throughDrawer(m, [{ text, quietMs: 40 }]);
        expect(shown(one), 'one push').toBe(0);
        expect(count(one, DRAWER_SECRET_MASK), 'one push: marks').toBeGreaterThan(0);
        expect(shownPhases(m, key, text)).toEqual([]);
        for (let k = 0; k < 4; k++) {
          const out = await m.maskTextSliced(`${ordinary(60_000 + k * 1_500)}${text}\n${'tail line\n'.repeat(30)}`, { rows: true });
          expect(shown(out), `pane history, placement ${k}`).toBe(0);
          expect(count(out, SECRET_MASK), `pane history, placement ${k}: marks`).toBeGreaterThan(0);
        }
      } finally {
        m.close();
      }
      const key2 = keyOf(8_192, 2464);
      const m2 = fingerprinted(key2);
      try {
        expect(shownPhases(m2, key2, rowsOf(key2, 64, 600, '\r\r\n').text), '8,192 bytes, 600 bytes of escapes a row').toEqual([]);
      } finally {
        m2.close();
      }
    }, 300_000);

    /** A LF or a move down, then a blank, a tab or an SGR, then a CR CR LF: two row breaks with no row between them. */
    const BREAK_THEN_CRCRLF: readonly (readonly [string, string])[] = [
      ['LF, blank', '\n \r\r\n'], ['LF, tab', '\n\t\r\r\n'], ['LF, SGR', '\n\x1b[0m\r\r\n'], ['CUD', '\x1b[B\r\r\n'], ['IND', '\x1bD\r\r\n'],
    ];
    it('past the hold, one break of a LF or a move down, a blank or an SGR, then CR CR LF does not end the chain (review 2514 F1)', () => {
      // Review 2514 F1, on this task's first fix (20775879e): `ROW_BREAK`'s LF, blanks, CR arm refused a CR that a CR LF
      // followed, so this break read as a LF, a blank row, then a CR CR LF; the chain walk ended at the blank row and the
      // 18 rows after the break (1,152 bytes) went out raw at each run below, where `main` shows 0. `main`, and this fix,
      // read the LF, blank, CR and the CR LF after it as two breaks with no row between, which the walk steps through. In
      // one push, and in 16 KiB chunks at phases 0 and 12,288, the whole key shows at `main` and here alike: on screen the
      // break is a blank row, which ends the matcher's row join (`drawer-consecutive-breaks`, `c45.md` §13).
      const key = keyOf(8_192, 2471);
      const m = fingerprinted(key);
      try {
        const shown = shownOf(key);
        const { text: t0, breaks } = rowsOf(key, 64, 600, '\r\n');
        const b = breaks[109]!;
        for (const [name, sep] of BREAK_THEN_CRCRLF) {
          const text = t0.slice(0, b) + sep + t0.slice(b + 2);
          expect(text.length, name).toBeGreaterThan(64 * 1_024);
          for (const [size, phases] of [[4_096, [0, 1_024, 2_048, 3_072]], [16_384, [4_096, 8_192]]] as const) {
            for (const p of phases) {
              const sent = throughDrawer(m, chunked(text, size, p, 0));
              expect(shown(sent), `${name}, ${size} B chunks, phase ${p}`).toBe(0);
              expect(count(sent, DRAWER_SECRET_MASK), `${name}, ${size} B chunks, phase ${p}: marks`).toBeGreaterThan(0);
            }
          }
        }
      } finally {
        m.close();
      }
    }, 300_000);

    it('pane history: one break of a LF or a move down, a blank or an SGR, then CR CR LF is masked where main masks it (review 2514 F1)', async () => {
      // The same break in pane history, a 2,000-byte key at 40 columns, 1,800 bytes of escapes a row, after 200 rows, the
      // break before the key's 40th row: at 20775879e 400 key bytes at this placement for each form, where `main` shows 0.
      // At other placements `main` shows up to the whole key for these forms, and so does this fix, cell for cell
      // (`drawer-consecutive-breaks`, `c45.md` §13).
      const key = keyOf(2_000, 2472);
      const m = fingerprinted(key);
      try {
        const shown = shownOf(key);
        const { text: t0, breaks } = rowsOf(key, 40, 1_800, '\r\n', 200);
        const b = breaks[239]!;
        for (const [name, sep] of BREAK_THEN_CRCRLF) {
          const text = t0.slice(0, b) + sep + t0.slice(b + 2);
          const out = await m.maskTextSliced(`${ordinary(15_000)}${text}\n${'tail line\n'.repeat(30)}`, { rows: true });
          expect(shown(out), name).toBe(0);
          expect(count(out, SECRET_MASK), `${name}: marks`).toBeGreaterThan(0);
        }
      } finally {
        m.close();
      }
    }, 300_000);

    it('pane history past the cap: a CR LF, 64 blanks or an SGR, then CR CR LF breaks the key no worse than main (review 2585 F1)', async () => {
      // Review 2585 F1: a 2,000-byte key at 40 columns, 1,800 bytes of escapes a row, CR LF rows, the break before the key's
      // row 41 (counting from 0) written CR LF, 64 blanks (or an SGR), then CR CR LF, past the 64 KiB cap with the cap in
      // the indent of the row after it. At da2c4569d `breakStartAt` read that CR CR LF back to its first CR, the cap's step back stopped at
      // the blank row before it, and the whole key showed; `main` reads the CR CR LF back from its second CR, through the
      // kept CR LF, blanks, CR family, crosses the blank row and masks the rows before the cut: 360 key bytes show, at
      // every placement from 54,000 to 54,600 bytes of other lines before (**measured**, `c45.md` §14). Pinned at `main`'s
      // figure, not at 0: the bytes that show at `main` are the carried `drawer-consecutive-breaks`.
      const key = keyOf(2_000, 2585);
      const m = fingerprinted(key);
      try {
        const shown = shownOf(key);
        const { text: t0, breaks } = rowsOf(key, 40, 1_800, '\r\n');
        const b = breaks[40]!;
        for (const [name, sep] of [['64 blanks', `\r\n${' '.repeat(64)}\r\r\n`], ['an SGR', '\r\n\x1b[0m\r\r\n']] as const) {
          const text = t0.slice(0, b) + sep + t0.slice(b + 2);
          for (const n0 of [54_000, 54_296]) {
            const out = await m.maskTextSliced(`${ordinary(n0).slice(0, n0)}\n${text}\n${'tail line\n'.repeat(30)}`, { rows: true });
            expect(shown(out), `${name}, ${n0} bytes before`).toBeLessThanOrEqual(360);
            expect(count(out, SECRET_MASK), `${name}, ${n0} bytes before: marks`).toBeGreaterThan(0);
          }
        }
      } finally {
        m.close();
      }
    }, 300_000);

    it('two pushes cut inside a CR CR LF, after its first CR or after both, draw nothing, plain rows or past the hold (review 2514 F2)', () => {
      // Review 2514 F2: a push that ended in both CRs read them as two breaks with an empty row between, so the drawer held
      // nothing and the key's rows before the cut went out alone: at this task's first fix, the whole key at 23 of the 31
      // cuts after both CRs of the 2,000-byte form and the rows before the cut at the rest, the whole key at all 41 of the
      // 8,192-byte form's (review 2585 F5); at `main`, the whole key at every cut. Two CRs at a text's end are now one break the next byte may complete. A cut after the first
      // CR was masked before and is pinned beside it.
      for (const [n, pre] of [[2_000, 0], [8_192, 600]] as const) {
        const key = keyOf(n, 2473);
        const m = fingerprinted(key);
        try {
          const shown = shownOf(key);
          const { text, breaks } = rowsOf(key, 64, pre, '\r\r\n');
          const bad: string[] = [];
          for (const b of breaks) {
            if (pre > 0 && b < 60_000) continue;
            for (const c of [b + 1, b + 2]) {
              const sent = throughDrawer(m, [{ text: text.slice(0, c), quietMs: 0 }, { text: text.slice(c), quietMs: 40 }]);
              const k = shown(sent);
              if ((k > 0 || !sent.includes(DRAWER_SECRET_MASK)) && bad.length < 5) bad.push(`cut at ${c}: ${k} key bytes, ${count(sent, DRAWER_SECRET_MASK)} marks`);
            }
          }
          expect(bad, `${n} bytes, ${pre} bytes of escapes a row`).toEqual([]);
        } finally {
          m.close();
        }
      }
    }, 300_000);
  });
});
