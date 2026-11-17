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
import { SECRET_MASK } from '../../shared/api.js';
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
          const text = drawn(key, wrapAt(n, 220, s.indent), s);
          for (let cut = 1; cut < text.length; cut++) {
            const sent = throughDrawer(m, [{ text: text.slice(0, cut), quietMs: 0 }, { text: text.slice(cut), quietMs: 40 }]);
            expect(slicesIn(key, sent), `${n} characters, ${s.name}, cut at ${cut}`).toEqual([]);
          }
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
