// Overlord wave 163: more known-token rows in the shared redactor (`shared/redact.mjs#KNOWN_TOKEN_PREFIX`), their
// shapes taken from Gitleaks v8.30.0 (MIT licence; the comment beside the rows says how each was read), and the PEM
// private-key block rule, whose one home moves from `ccd/history/lib.mjs` into the shared table
// (`PEM_PRIVATE_KEY_SOURCE`) so the egress and Linear egress profiles read it too. One case per row, and a near miss
// beside each that stays readable.
//
// Every synthetic token is built by concatenation, so no literal in this file reads as a live credential to a push
// scanner.
import { describe, it, expect } from 'vitest';
import { credentialMaskSource } from '../../shared/api.js';
import { PEM_PRIVATE_KEY_SOURCE, redact, redactCount } from '../../shared/redact.js';
import { SECRET_SHAPE_RES } from '../../ccd/history/lib.mjs';

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

describe('the PEM private-key block: one rule, read by history and both egress profiles', () => {
  const body = cat('MIIEowIBAAKCAQEAx1y2', '+abc/def', 'Zm9vYmFy', '\n', 'QUJDREVGR0g', '+/aa==');
  const block = cat('-----BEGIN ', 'RSA PRIVATE KEY-----\n', body, '\n-----END RSA PRIVATE KEY-----');

  for (const profile of PROFILES) {
    it(`${profile}: a whole block is masked, and the text around it is kept`, () => {
      expect(redact(profile, `cat k.pem:\n${block}\ndone`, SHAPES)).toBe(`cat k.pem:\n${R}\ndone`);
    });
    it(`${profile}: an unclosed block is masked to the end of the text`, () => {
      expect(redact(profile, cat('x ', block.slice(0, 60)), SHAPES)).toBe(`x ${R}`);
    });
    it(`${profile}: a public key block and the bare words stay readable`, () => {
      const pub = cat('-----BEGIN ', 'PUBLIC KEY-----\nMFkwEwYHKoZIzj0C\n-----END PUBLIC KEY-----');
      expect(redact(profile, pub, SHAPES)).not.toContain(R);
      expect(redact(profile, 'the PRIVATE KEY header', SHAPES)).toBe('the PRIVATE KEY header');
    });
  }

  it('ccrc history reads the same source: its PEM shape is built from the shared table, byte for byte', () => {
    expect(SECRET_SHAPE_RES[0]!.source).toBe(PEM_PRIVATE_KEY_SOURCE);
    expect(SECRET_SHAPE_RES[0]!.flags).toBe('g');
  });
});
