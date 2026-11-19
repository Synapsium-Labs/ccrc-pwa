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
import { describe, it, expect } from 'vitest';
import { credentialMaskSource, SECRET_MASK } from '../../shared/api.js';
import { redact } from '../../shared/redact.js';
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

describe('the response masks: a PEM private-key block', () => {
  const answer = (text: string): string => SHAPE_MASK.maskDeep({ text }).text;

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
