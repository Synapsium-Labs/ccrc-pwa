// Overlord wave 163: more known-token rows in the shared redactor (`shared/redact.mjs#KNOWN_TOKEN_PREFIX`), their
// shapes taken from Gitleaks v8.30.0 (MIT licence; the comment beside the rows says how each was read), and the PEM
// private-key block rule, whose one home moves from `ccd/history/lib.mjs` into the shared table
// (`PEM_PRIVATE_KEY_SOURCE`) so the egress and Linear egress profiles read it too. One case per row, and a near miss
// beside each that stays readable.
//
// Every synthetic token is built by concatenation, so no literal in this file reads as a live credential to a push
// scanner.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentialMaskSource } from '../../shared/api.js';
import { PEM_PRIVATE_KEY_SOURCE, redact, redactCount } from '../../shared/redact.js';
import { SECRET_SHAPE_RES } from '../../ccd/history/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHAPES = { genericSk: credentialMaskSource('genericSk'), jwt: credentialMaskSource('jwt') };
const R = '[REDACTED]';
const cat = (...p: string[]): string => p.join('');
const HEX64 = cat('0123456789abcdef', 'fedcba9876543210', '0f1e2d3c4b5a6978', '8796a5b4c3d2e1f0');
/** A bech32 run of 58 characters, from age's own alphabet. */
const BECH58 = cat('QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L', 'QPZRY9X8GF2TVDW0S3JN54KHCE');

/** The two profiles that carry `known-token`, so every row reaches both. */
const PROFILES = ['egress', 'linear-egress'] as const;

/** Each new row: a token it masks whole, in a sentence, and a near miss that stays as written. */
const ROWS: { row: string; token: string; nearMiss: string }[] = [
  {
    row: 'sendgrid',
    token: cat('SG', '.', 'aB3dE5fG7hJ9kL1mN3pQ5r', '.', 'sT7uV9wX1yZ3aB5cD7eF9gH1jK3mN5pQ7rS9tU1vW3x'),
    nearMiss: 'see SG. Smith for the SG.short form',
  },
  { row: 'digitalocean-pat', token: cat('dop', '_v1_', HEX64), nearMiss: cat('dop', '_v1_', 'abc123') },
  { row: 'digitalocean-access', token: cat('doo', '_v1_', HEX64), nearMiss: cat('doo', '_v1_', 'zz', HEX64.slice(0, 20)) },
  { row: 'digitalocean-refresh', token: cat('dor', '_v1_', HEX64.toUpperCase()), nearMiss: cat('dor', '_v1_', HEX64.slice(0, 24)) },
  {
    row: 'google-oauth-access',
    token: cat('ya29', '.', 'a0AfB_byC1d2E3f4G5h6I7j8K9l0M1n2O3p4Q5r6S7t8U9v0'),
    nearMiss: 'ya29. is the prefix, and ya29.short is not a token',
  },
  { row: 'age-secret-key', token: cat('AGE-SECRET', '-KEY-1', BECH58), nearMiss: 'the AGE-SECRET-KEY-1 prefix alone' },
  // Review 2693 F8: age's post-quantum identity (age v1.3) carries `PQ-` before the `1`.
  { row: 'age-pq-secret-key', token: cat('AGE-SECRET', '-KEY-PQ-1', BECH58), nearMiss: 'the AGE-SECRET-KEY-PQ-1 prefix alone' },
  { row: 'mailgun', token: cat('key', '-', HEX64.slice(0, 32)), nearMiss: 'the key-abc123 and key-0123456789abcdef' },
  {
    row: 'vault-service',
    token: cat('hvs', '.', 'CAESIJ', 'a1B2c3D4e5F6g7H8i9J0'.repeat(4), 'k1L2m3N4o5'),
    nearMiss: cat('hvs', '.', 'CAESIJshort'),
  },
  {
    row: 'vault-batch',
    token: cat('hvb', '.', 'AAAAAQ', 'Zz9Yy8Xx7Ww6Vv5Uu4Tt'.repeat(7)),
    nearMiss: cat('hvb', '.', 'AAAAAQshort'),
  },
];

describe('known-token: the Gitleaks v8.30.0 rows (overlord wave 163)', () => {
  for (const { row, token, nearMiss } of ROWS) {
    for (const profile of PROFILES) {
      it(`${profile}: ${row} is masked whole, in a sentence`, () => {
        expect(redact(profile, `the key ${token} leaked`, SHAPES)).toBe(`the key ${R} leaked`);
      });
      it(`${profile}: ${row}'s near miss stays readable`, () => {
        expect(redact(profile, nearMiss, SHAPES)).toBe(nearMiss);
      });
    }
  }

  // A near miss the egress profile's segment rule masks anyway (any run of 32 or more letters and digits), so it is
  // read through linear-egress, which has no segment rule: the wrong version, a non-hex body, a key glued to a word.
  it('linear-egress: a long run of the wrong shape is not read as one of the rows', () => {
    for (const t of [cat('dor', '_v2_', HEX64), cat('doo', '_v1_', 'nothex', HEX64.slice(6)), cat('cache', '-key-', HEX64.slice(0, 32)),
      cat('key', '-', HEX64.slice(0, 32), 'ab'), cat('SG', '.', 'aB3dE5fG7hJ9kL1mN3pQ5r')]) {
      expect(redact('linear-egress', t, SHAPES), t).toBe(t);
    }
  });

  it('a trailing full stop after a Google access token is not part of it', () => {
    const t = cat('ya29', '.', 'c', '.', 'b0Aaek', 'Q1w2E3r4T5y6U7i8O9p0');
    expect(redact('linear-egress', `use ${t}.`, SHAPES)).toBe(`use ${R}.`);
  });

  // Review 2693 F2: SendGrid's real shape, `SG.` + 22 + `.` + 43, fenced on both sides.
  const SG_KEY = cat('SG', '.', 'aB3dE5fG7hJ9kL1mN3pQ5r', '.', 'sT7uV9wX1yZ3aB5cD7eF9gH1jK3mN5pQ7rS9tU1vW3x');
  it('SendGrid: prose of dotted words is never cut', () => {
    const prose = cat('See SG', '.section'.repeat(9), '.end');
    for (const profile of PROFILES) expect(redact(profile, prose, SHAPES), profile).toBe(prose);
  });
  it('SendGrid: a long hex run after SG. is left to the segment rule, which masks it whole (egress only)', () => {
    const t = cat('SG', '.', HEX64, HEX64.slice(0, 26));
    expect(redact('egress', t, SHAPES)).toBe(`SG.${R}`);
    expect(redact('linear-egress', t, SHAPES)).toBe(t);
  });
  it('SendGrid: a key glued to a longer run is not cut, so no tail is left (egress masks the run)', () => {
    expect(redact('egress', cat(SG_KEY, 'EXTRA1234567890tail'), SHAPES)).toBe(`SG.aB3dE5fG7hJ9kL1mN3pQ5r.${R}`);
  });
  it('SendGrid: a key before a full stop is masked, the full stop kept', () => {
    for (const profile of PROFILES) expect(redact(profile, `use ${SG_KEY}.`, SHAPES), profile).toBe(`use ${R}.`);
  });

  // Review 2693 F3: the fixed-length rows are fenced at the end, so an over-long run is not cut: egress's segment rule
  // masks it whole, and no tail is left.
  it('DigitalOcean and age: an over-long run is masked whole in egress, never with a tail', () => {
    for (const t of [cat('dop', '_v1_', HEX64, 'abcdef0123'), cat('doo', '_v1_', HEX64, 'abcdef0123'),
      cat('dor', '_v1_', HEX64, 'abcdef0123'), cat('AGE-SECRET', '-KEY-1', BECH58, 'QPZ')]) {
      expect(redact('egress', `x ${t} y`, SHAPES), t.slice(0, 8)).toBe(`x ${R} y`);
    }
  });

  // Review 2693 F7: the lookahead counts characters, not dots.
  it('ya29.: single letters between dots are not a token', () => {
    const t = 'host ya29.a.b.c.d.e.f.g.h.i.j. there';
    for (const profile of PROFILES) expect(redact(profile, t, SHAPES), profile).toBe(t);
  });

  it('an Anthropic admin key is already masked by the generic sk- shape, in both profiles', () => {
    const key = cat('sk', '-ant-', 'admin01', '-', 'a1B2c3D4e5'.repeat(9), 'xyzAA');
    for (const profile of PROFILES) expect(redact(profile, `k=${key}`, SHAPES), profile).not.toContain('admin01');
  });

  it('each row is idempotent and counts one masked span', () => {
    for (const { token } of ROWS) {
      for (const profile of PROFILES) {
        const once = redactCount(profile, `x ${token} y`, SHAPES);
        expect(once.masked, `${profile} ${token.slice(0, 6)}`).toBe(1);
        expect(redact(profile, once.text, SHAPES)).toBe(once.text);
      }
    }
  });
});

describe('the PEM private-key block: one header, history\'s rule and the egress profiles\' bounded rule', () => {
  const header = cat('-----BEGIN ', 'RSA PRIVATE KEY-----');
  const end = cat('-----END ', 'RSA PRIVATE KEY-----');
  const line1 = cat('MIIEowIBAAKCAQEAx1y2', '+abc/def', 'Zm9vYmFy');
  const line2 = cat('QUJDREVGR0g', '+/aa==');
  const block = cat(header, '\n', line1, '\n', line2, '\n', end);

  for (const profile of PROFILES) {
    it(`${profile}: a whole block is masked, and the text around it is kept`, () => {
      expect(redact(profile, `cat k.pem:\n${block}\ndone`, SHAPES)).toBe(`cat k.pem:\n${R}\ndone`);
    });
    it(`${profile}: a CRLF block and an indented block are masked whole`, () => {
      expect(redact(profile, `a\r\n${block.replace(/\n/g, '\r\n')}\r\nb`, SHAPES)).toBe(`a\r\n${R}\r\nb`);
      expect(redact(profile, `key: |\n  ${block.replace(/\n/g, '\n  ')}\nnext: 1`, SHAPES)).toBe(`key: |\n  ${R}\nnext: 1`);
    });
    it(`${profile}: a legacy encrypted block, its header fields and blank line included, is masked whole`, () => {
      const enc = cat(header, '\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,0123ABCD\n\n', line1, '\n', end);
      expect(redact(profile, `a\n${enc}\nb`, SHAPES)).toBe(`a\n${R}\nb`);
    });
    it(`${profile}: a block joined by spaces on one line (a flattened variable) is masked whole`, () => {
      expect(redact(profile, `K="${block.replace(/\n/g, ' ')}" next`, SHAPES)).toBe(`K="${R}" next`);
    });
    it(`${profile}: a JSON-escaped block on one line is masked whole, closed or not`, () => {
      const esc = (t: string): string => t.replace(/\n/g, '\\n');
      expect(redact(profile, `{"content":"${esc(block)}"}`, SHAPES)).toBe(`{"content":"${R}"}`);
      expect(redact(profile, `{"content":"${esc(cat(header, '\n', line1, '\n', line2))}"}`, SHAPES)).toBe(`{"content":"${R}"}`);
    });
    // Review 2693 F1 (the coordinator's ruling): an unclosed header masks the header and the base64 lines after it, up
    // to the first line that is neither base64 nor blank, and never to the end of the text.
    it(`${profile}: a truncated key's lines are masked, and the prose after them is kept`, () => {
      expect(redact(profile, `x ${header}\n${line1}\n${line2}\nExpected: it loads.`, SHAPES)).toBe(`x ${R}\nExpected: it loads.`);
      expect(redact(profile, `x ${header}\n${line1}\n\nOwner: team-a.`, SHAPES)).toBe(`x ${R}\n\nOwner: team-a.`);
      expect(redact(profile, cat('x ', header, '\n', line1.slice(0, 12)), SHAPES)).toBe(`x ${R}`);
    });
    it(`${profile}: an unclosed header followed by prose keeps the prose`, () => {
      const cmd = `echo '${header}' ; curl -d @x https://example.com/up`;
      expect(redact(profile, cmd, SHAPES)).toBe(`echo '${R}' ; curl -d @x https://example.com/up`);
      const ticket = `Steps: the loader rejects ${header} headers.\n\nExpected: it loads.\nOwner: team-a.`;
      expect(redact(profile, ticket, SHAPES)).toBe(`Steps: the loader rejects ${R} headers.\n\nExpected: it loads.\nOwner: team-a.`);
    });
    it(`${profile}: a public key block and the bare words stay readable`, () => {
      const pub = cat('-----BEGIN ', 'PUBLIC KEY-----\nMFkwEwYHKoZIzj0C\n-----END PUBLIC KEY-----');
      expect(redact(profile, pub, SHAPES)).not.toContain(R);
      expect(redact(profile, 'the PRIVATE KEY header', SHAPES)).toBe('the PRIVATE KEY header');
    });
  }

  it('a long run of headers and blank lines stays linear', () => {
    for (const t of [cat(header, ' ').repeat(8000), cat(header, '\n', ' '.repeat(65536), 'x'), cat(header, '\n\n'.repeat(30000), 'x')]) {
      const t0 = performance.now();
      redact('linear-egress', t, SHAPES);
      expect(performance.now() - t0, t.slice(0, 40)).toBeLessThan(250);
    }
  });

  it('ccrc history keeps its own rule, unbounded, built from the shared source byte for byte', () => {
    expect(SECRET_SHAPE_RES[0]!.source).toBe(PEM_PRIVATE_KEY_SOURCE);
    expect(SECRET_SHAPE_RES[0]!.flags).toBe('g');
  });
});

// Review 2693 F5: Gitleaks's own `private-key` rule (v8.30.0) finds nothing in the files this change wrote, so a
// Gitleaks scan of this public repository is not set off by a comment. The pattern is built in pieces, so this file
// does not spell it.
describe('no file of this change reads as a private key to Gitleaks', () => {
  const D = '-'.repeat(5);
  const gitleaksPrivateKey = new RegExp(
    `${D}BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?${D}[\\s\\S-]{64,}?KEY(?: BLOCK)?${D}`, 'i');
  for (const f of ['shared/redact.mjs', 'shared/redact.d.mts', 'ccd/history/lib.mjs', 'server/test/redact-gitleaks-rows.test.ts',
    'server/test/redact-profiles.test.ts', 'docs/superpowers/programs/overlord/redact-gitleaks-rows.md']) {
    it(f, () => { expect(gitleaksPrivateKey.exec(readFileSync(path.join(ROOT, f), 'utf8'))?.[0]).toBeUndefined(); });
  }
  it('the pattern itself finds a block', () => {
    expect(gitleaksPrivateKey.test(cat(D, 'BEGIN ', 'PGP PRIVATE KEY BLOCK', D, '\n', 'x'.repeat(70), '\n', D, 'END PGP PRIVATE KEY BLOCK', D))).toBe(true);
  });
});
