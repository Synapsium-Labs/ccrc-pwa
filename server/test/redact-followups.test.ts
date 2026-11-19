// Overlord wave 168: two redaction follow-ups left by wave 163 (#3052; task note
// `docs/superpowers/programs/overlord/redact-followups.md`).
//
// 1. The response masks (`CREDENTIAL_MASKS` through `server/src/accounts/shapes.ts`) passed a PEM private-key block
//    unchanged (`response-masks-miss-pem`). They now read the egress profiles' PEM scanner (`shared/redact.mjs`'s
//    `pemBlockSpans`, the one owner), split at every row break, so a block in the drawer is masked row by row and no
//    row is joined to the next.
// 2. Every known-token row missed a token right after a JSON-escaped line break or an ANSI colour code in
//    `linear-egress` (review 2693's F4): the lookbehinds read the `n` of `\n` and the `m` of `\x1b[31m` as a word
//    character. They now read both as a boundary.
//
// Every synthetic token and PEM line is built by concatenation, so no literal in this file reads as a live credential
// to a push scanner.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { credentialMaskSource, SECRET_MASK } from '../../shared/api.js';
import { pemStreamSpans, redact, type PemStreamCarry } from '../../shared/redact.js';
import { SHAPE_MASK } from '../src/accounts/shapes.js';
import { DRAWER_SECRET_MASK, SecretMasker } from '../src/accounts/mask.js';

const SHAPES = { genericSk: credentialMaskSource('genericSk'), jwt: credentialMaskSource('jwt') };
const R = '[REDACTED]';
const M = SECRET_MASK;
const cat = (...p: string[]): string => p.join('');
const HEX64 = cat('0123456789abcdef', 'fedcba9876543210', '0f1e2d3c4b5a6978', '8796a5b4c3d2e1f0');
const BECH58 = cat('QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L', 'QPZRY9X8GF2TVDW0S3JN54KHCE');
const B40 = cat('a1B2c3D4e5F6g7H8i9J0', 'k1L2m3N4o5P6q7R8s9T0');

// ── 2. the known-token rows after an escaped line break or an ANSI code ─────────────────────────────────────────────

/** One token per row family of `KNOWN_TOKEN_PREFIX`, and the generic `sk-` shape the row group closes with. */
const TOKENS: [row: string, token: string][] = [
  ['stripe-live', cat('sk', '_live_', B40)],
  ['stripe-restricted', cat('rk', '_test_', B40)],
  ['github-ghp', cat('gh', 'p_', B40)],
  ['github-gho', cat('gh', 'o_', B40)],
  ['github-fine-grained', cat('github', '_pat_', B40)],
  ['gitlab', cat('glp', 'at-', B40)],
  ['linear', cat('lin', '_api_', B40)],
  ['slack-bot', cat('xo', 'xb-', B40)],
  ['slack-app', cat('xa', 'pp-', B40)],
  ['npm', cat('np', 'm_', B40)],
  ['pypi', cat('py', 'pi-', B40)],
  ['aws-akia', cat('AK', 'IA', 'IOSFODNN7EXAMPLE')],
  ['aws-asia', cat('AS', 'IA', 'IOSFODNN7EXAMPLE')],
  ['huggingface', cat('h', 'f_', 'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3z')],
  ['google-api', cat('AI', 'za', 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q')],
  ['sendgrid', cat('SG', '.', 'aB3dE5fG7hJ9kL1mN3pQ5r', '.', 'sT7uV9wX1yZ3aB5cD7eF9gH1jK3mN5pQ7rS9tU1vW3x')],
  ['digitalocean-pat', cat('dop', '_v1_', HEX64)],
  ['digitalocean-refresh', cat('dor', '_v1_', HEX64)],
  ['age', cat('AGE-SECRET', '-KEY-1', BECH58)],
  ['vault-service', cat('hvs', '.', 'CAESIJ', B40, B40, 'k1L2m3N4o5')],
  ['vault-batch', cat('hvb', '.', 'AAAAAQ', B40, B40, B40, 'Zz9Yy8Xx7Ww6Vv5Uu4Tt')],
  ['mailgun', cat('key', '-', HEX64.slice(0, 32))],
  ['google-oauth-access', cat('ya29', '.', 'a0AfB_byC1d2E3f4G5h6I7j8K9l0M1n2O3p4Q5r6S7t8U9v0')],
  ['generic-sk', cat('s', 'k-', B40)],
];

/** What may sit right before a token and must read as a boundary. */
const LEADS: [what: string, lead: string][] = [
  ['a JSON-escaped line feed', 'line one\\n'],
  ['a JSON-escaped carriage return and line feed', 'line one\\r\\n'],
  ['a JSON-escaped tab', 'name\\t'],
  ['an ANSI colour code', 'token: \x1b[31m'],
  ['an ANSI code with parameters', 'token: \x1b[1;38;5;196m'],
  ['an ANSI code, JSON-escaped', 'token: \\u001b[32m'],
];

describe('known-token: a token right after an escaped line break or an ANSI code (review 2693 F4)', () => {
  for (const [row, token] of TOKENS) {
    for (const [what, lead] of LEADS) {
      it(`linear-egress: ${row} after ${what} is masked whole`, () => {
        expect(redact('linear-egress', `${lead}${token} after`, SHAPES)).toBe(`${lead}${R} after`);
      });
    }
    it(`egress: ${row} after a JSON-escaped line feed is masked whole`, () => {
      expect(redact('egress', `line one\\n${token} after`, SHAPES)).toBe(`line one\\n${R} after`);
    });
  }

  // The near misses the boundary must still refuse: a letter, digit, `_` or `-` that is not part of an escape.
  it('linear-egress: a token glued to a word, or to an `n` or `m` that ends no escape, stays as written', () => {
    for (const t of [cat('plainn', 'gh', 'p_', B40), cat('colorm', 'gh', 'p_', B40), cat('x', 'gh', 'p_', B40),
      cat('cache', '-key-', HEX64.slice(0, 32)), cat('[31m', 'gh', 'p_', B40), cat('words', 'AK', 'IA', 'IOSFODNN7EXAMPLE')]) {
      expect(redact('linear-egress', t, SHAPES), t).toBe(t);
    }
  });

  it('linear-egress: the escape itself and the text after the token are kept', () => {
    const t = cat('gh', 'p_', B40);
    expect(redact('linear-egress', `a\\n${t}\\nb \x1b[31m${t}\x1b[0m c`, SHAPES)).toBe(`a\\n${R}\\nb \x1b[31m${R}\x1b[0m c`);
  });
});

// ── 1. the response masks and a PEM private-key block ───────────────────────────────────────────────────────────────

const BEGIN = cat('-----BEGIN ', 'RSA PRIVATE', ' KEY-----');
const END = cat('-----END ', 'RSA PRIVATE', ' KEY-----');
const BODY1 = cat('MIIEowIBAAKCAQEA', 'q1W2e3R4t5Y6u7I8o9P0');
const BODY2 = cat('a1S2d3F4g5H6j7K8', 'l9Z0x1C2v3B4n5M6');

const answerOf = (text: string): string => SHAPE_MASK.maskDeep({ text }).text;

describe('the response masks: a PEM private-key block', () => {
  const answer = answerOf;

  it('a closed block is masked line by line, and the prose around it is kept', () => {
    expect(answer(`before\n${BEGIN}\n${BODY1}\n${BODY2}\n${END}\nprose after`))
      .toBe(`before\n${M}\n${M}\n${M}\n${M}\nprose after`);
  });

  it('prose before the BEGIN line on its line is kept', () => {
    expect(answer(`key: ${BEGIN}\n${BODY1}\n${END} done`)).toBe(`key: ${M}\n${M}\n${M} done`);
  });

  it('an unclosed block is masked to the first blank line, which and what follows it are kept', () => {
    expect(answer(`${BEGIN}\n${BODY1}\n${BODY2}\n\nprose after`)).toBe(`${M}\n${M}\n${M}\n\nprose after`);
  });

  it('a JSON-escaped block is one row, masked as one, and the prose after it is kept', () => {
    expect(answer(`{"key":"${BEGIN}\\n${BODY1}\\n${BODY2}\\n${END}\\n","note":"prose after"}`))
      .toBe(`{"key":"${M}\\n","note":"prose after"}`);
  });

  it('a JSON-escaped block with no END line is masked to its first blank line', () => {
    expect(answer(`"${BEGIN}\\n${BODY1}\\n${BODY2}\\n\\nprose after"`)).toBe(`"${M}\\n\\nprose after"`);
  });

  it('CR LF rows keep their line breaks', () => {
    expect(answer(`${BEGIN}\r\n${BODY1}\r\n${END}\r\nafter`)).toBe(`${M}\r\n${M}\r\n${M}\r\nafter`);
  });

  it('every string of a structured answer is masked, nested ones too', () => {
    const out = SHAPE_MASK.maskDeep({ rows: [{ out: `${BEGIN}\n${BODY1}\n${END}` }], n: 1 });
    expect(out).toEqual({ rows: [{ out: `${M}\n${M}\n${M}` }], n: 1 });
  });

  it('a text with no PEM block is unchanged', () => {
    const t = 'a PRIVATE KEY is mentioned here, and -----BEGIN CERTIFICATE----- too';
    expect(answer(t)).toBe(t);
  });

  it('the keyless masker answers the same, in rows mode too', () => {
    const m = new SecretMasker();
    const t = `before\n${BEGIN}\n${BODY1}\n${END}\nafter`;
    expect(m.maskText(t)).toBe(`before\n${M}\n${M}\n${M}\nafter`);
    expect(m.maskText(t, { rows: true })).toBe(`before\n${M}\n${M}\n${M}\nafter`);
  });
});

describe("the drawer: a PEM block's rows are masked one by one and never joined", () => {
  const drawer = (text: string): string =>
    new SecretMasker().maskWithCarry(text, { rows: true, mark: DRAWER_SECRET_MASK }).text;
  const D = DRAWER_SECRET_MASK;

  it('each row of a block holds its own one-column mark, so no row moves', () => {
    const out = drawer(`${BEGIN}\n${BODY1}\n${BODY2}\n${END}\n$ next`);
    expect(out).toBe(`${D}\n${D}\n${D}\n${D}\n$ next`);
    expect(out.split('\n')).toHaveLength(5);
  });

  it("a box's left and right rules and the indent stay where they were", () => {
    expect(drawer(`│ ${BEGIN} │\n│   ${BODY1} │\n│ ${END} │\n│ ok │`)).toBe(`│ ${D} │\n│   ${D} │\n│ ${D} │\n│ ok │`);
  });

  it('takes no run-on after the block: an indented row after its END line is kept', () => {
    expect(drawer(`${BEGIN}\n${BODY1}\n${END}\n  nextword and more`)).toBe(`${D}\n${D}\n${D}\n  nextword and more`);
  });

  it('a block drawn with colour codes is masked too, and its rows stay apart', () => {
    const out = drawer(`\x1b[2m${BEGIN}\x1b[0m\n\x1b[2m${BODY1}\x1b[0m\n\x1b[2m${END}\x1b[0m\nafter`);
    expect(out).not.toContain('PRIVATE');
    expect(out).not.toContain(BODY1);
    expect(out.split('\n')).toHaveLength(4);
    expect(out.endsWith('\nafter')).toBe(true);
  });
});

// ── review 2729: a PEM block streamed through the drawer in chunks (F1), and the row cursor's cost (F2) ─────────────

/** `n` rows of 64 base64 characters, each its own (no shape the masker knows, no `eyJ`, no `sk-`). */
const keyRows = (n: number): string[] => Array.from({ length: n }, (_, i) =>
  cat('MIIB', String(1000 + i), 'qW2e3R4t5Y6u7I8o9P0aS1d2F3g4H5j6K7l8Z9x0C1v2B3n4M5q6W7e8R9t'));
/** What the drawer draws for `chunks`, each followed by a quiet time past every hold, on fake timers. */
const throughDrawer = (chunks: readonly string[]): string => {
  vi.useFakeTimers();
  try {
    const out: string[] = [];
    const d = new SecretMasker().drawer((t) => out.push(t), 2);
    for (const c of chunks) { d.push(c); vi.advanceTimersByTime(50); }
    d.dispose();
    return out.join('');
  } finally {
    vi.useRealTimers();
  }
};
/** `text` cut into chunks of `size` characters. */
const chunked = (text: string, size: number): string[] =>
  Array.from({ length: Math.ceil(text.length / size) }, (_, i) => text.slice(i * size, (i + 1) * size));
/** The rows of `rows` the drawer's output still shows. */
const shown = (out: string, rows: readonly string[]): string[] => rows.filter((r) => out.includes(r));

describe('the drawer: a PEM block streamed in chunks stays masked after its BEGIN line leaves the context', () => {
  afterEach(() => { vi.useRealTimers(); });
  const D = DRAWER_SECRET_MASK;
  const rows50 = keyRows(50);
  const closed = cat('$ cat key.pem\n', BEGIN, '\n', ...rows50.map((r) => `${r}\n`), END, '\n', 'after the key\n');

  it("the review's 50-row key at one line per chunk shows no key row, and every row keeps its own mark", () => {
    const out = throughDrawer(closed.split(/(?<=\n)/));
    expect(shown(out, rows50)).toEqual([]);
    expect(out).not.toContain('PRIVATE');
    expect(out).toContain('$ cat key.pem\n');
    expect(out.endsWith('after the key\n')).toBe(true);
    expect(out.split('\n')).toHaveLength(closed.split('\n').length);
    expect(out.split('\n').slice(1, 53).every((r) => r === D)).toBe(true);
  });

  for (const size of [7, 256, 1000, 1024, 2048]) {
    it(`the same key in ${size}-character chunks shows no key row, and the prose after it shows`, () => {
      const out = throughDrawer(chunked(closed, size));
      expect(shown(out, rows50)).toEqual([]);
      // A BEGIN or END line cut into chunks may show its first characters before the line is whole: no key material.
      expect(out).toContain('after the key');
    });
  }

  it('an unclosed key at one line per chunk is masked to the blank line, and the prose after it shows', () => {
    const rows = keyRows(30);
    const out = throughDrawer([BEGIN + '\n', ...rows.map((r) => `${r}\n`), '\n', 'prose after the blank line\n']);
    expect(shown(out, rows)).toEqual([]);
    expect(out.endsWith('\nprose after the blank line\n')).toBe(true);
  });

  it('an END line split across two chunks closes the block: the text after it shows', () => {
    const rows = keyRows(30);
    const text = cat(BEGIN, '\n', ...rows.map((r) => `${r}\n`), END, '\nafter the split end\n');
    const at = text.indexOf(END) + 12;
    const out = throughDrawer([...chunked(text.slice(0, at), 512), text.slice(at)]);
    expect(shown(out, rows)).toEqual([]);
    expect(out).toContain('after the split end');
  });

  it('CR LF rows streamed one by one stay masked, and the CR LF blank line ends the block', () => {
    const rows = keyRows(30);
    const out = throughDrawer([BEGIN + '\r\n', ...rows.map((r) => `${r}\r\n`), '\r\n', 'shown\r\n']);
    expect(shown(out, rows)).toEqual([]);
    expect(out.endsWith('\r\nshown\r\n')).toBe(true);
  });

  it('the 64 KB window releases: a block with no END line and no blank line is masked through 64 KB only', () => {
    const rows = keyRows(1100);   // about 72 KB of rows after the BEGIN line
    const out = throughDrawer(chunked(cat(BEGIN, '\n', ...rows.map((r) => `${r}\n`), 'visible after the window\n'), 4096));
    expect(shown(out, rows.slice(0, 900))).toEqual([]);   // within the window: masked
    expect(out).toContain('visible after the window');
    expect(shown(out, rows.slice(1050)).length).toBeGreaterThan(0);   // past it: shown
  });

  it("a BEGIN line the stream's first chunk cuts still opens the carry", () => {
    const rows = keyRows(50);
    const at = BEGIN.indexOf('PRIV') + 4;
    const out = throughDrawer([BEGIN.slice(0, at), BEGIN.slice(at) + '\n', ...rows.map((r) => `${r}\n`), END + '\n', 'after\n']);
    expect(shown(out, rows)).toEqual([]);
    expect(out.endsWith('after\n')).toBe(true);
  });

  it('a block that ends inside one chunk carries nothing: the next chunk shows', () => {
    const out = throughDrawer([cat(BEGIN, '\n', keyRows(2).join('\n'), '\n', END, '\n'), 'next line\n']);
    expect(out.endsWith('next line\n')).toBe(true);
  });
});

describe("pemStreamSpans: the finder over a stream's texts, read with nothing before them", () => {
  /** Each text's masked parts, and the carry after the last. */
  const stream = (texts: readonly string[]): { parts: string[][]; carry: unknown } => {
    let carry: PemStreamCarry | null = null;
    const parts: string[][] = [];
    for (const t of texts) {
      const r = pemStreamSpans(t, carry);
      parts.push(r.spans.map(([a, b]) => t.slice(a, b)));
      carry = r.carry;
    }
    return { parts, carry };
  };

  it('a text that ended with a line break starts a line: a blank first line ends the block', () => {
    expect(stream([`${BEGIN}\n`, `${BODY1}\n`, '\n', 'prose\n'])).toEqual({ parts: [[BEGIN], [BODY1], [], []], carry: null });
  });

  it('a text that ended mid-row goes on with that row: its first segment is the row, never a blank line', () => {
    expect(stream([`${BEGIN}\n${BODY1.slice(0, 5)}`, '\n', `${BODY2}\n`]).parts).toEqual([[`${BEGIN}\n${BODY1.slice(0, 5)}`], [], [BODY2]]);
  });

  it('a JSON-escaped line break ends a line too', () => {
    expect(stream([`${BEGIN}\\n`, `${BODY1}\\n`, '\\n', 'prose']).parts).toEqual([[BEGIN], [BODY1], [], []]);
  });

  it('an END line closes the carry; one past the window does not', () => {
    expect(stream([`${BEGIN}\n`, `${BODY1}\n${END}\nafter`])).toEqual({ parts: [[BEGIN], [`${BODY1}\n${END}`]], carry: null });
    const far = stream([`${BEGIN}\n`, `${'A'.repeat(70 * 1024)}\n${END}\nafter`]);
    expect(far.parts[1]).toEqual(['A'.repeat(70 * 1024)]);
    expect(far.carry).toBeNull();
  });
});

describe('the response masks: many blocks in one JSON answer cost linear time (review 2729 F2)', () => {
  const blocks = (k: number): string => cat(BEGIN, '\\n\\n').repeat(k);
  const best = (text: string): number => {
    let min = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      SHAPE_MASK.maskDeep({ text });
      min = Math.min(min, performance.now() - t0);
    }
    return min;
  };

  it('each block of a JSON-escaped answer is masked on its own', () => {
    const one = cat(BEGIN, '\\n', BODY1, '\\n', END, '\\n');
    expect(answerOf(`"${one}${one}${one}"`)).toBe(`"${M}\\n${M}\\n${M}\\n"`);
    expect(answerOf(blocks(3))).toBe(`${M}\\n\\n${M}\\n\\n${M}\\n\\n`);
  });

  it('2 MB of JSON-escaped blocks costs about 4 times 512 KB, never the square', () => {
    const k = Math.ceil((512 * 1024) / blocks(1).length);
    best(blocks(k));   // warm
    const small = best(blocks(k));
    const large = best(blocks(4 * k));
    // Linear is about 4 times; the per-block search this replaced was about 16 (measured 125 ms and 1621 ms).
    expect(large / Math.max(small, 1)).toBeLessThan(9);
  });
});
