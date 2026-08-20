// The passphrase secret file (`~/.ccrc/auth.scrypt`) reads like the box token
// (`coord/token.ts`) with ONE polarity inverted: absent is `null` (a real state
// the GATE, Task 5, turns into fail-SHUT), but a present-but-unreadable or garbled
// file THROWS `AuthSecretUnusable` — boot refusal — and is never read as "no
// passphrase". These cases drive that split directly; the round-trip proves the
// writer (`hashLine`, the Task 9 node helper's engine) against the reader.
import { describe, it, expect } from 'vitest';
import { chmodSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import {
  readAuthSecret, verifyPassphrase, hashLine, needsRehash,
  AuthSecret, AuthSecretUnusable, DEFAULT_PARAMS, KEYLEN,
} from '../src/auth/secret.js';
import { mkTmp } from './tmpHelpers.js';

const IS_ROOT = (process.getuid?.() ?? 1) === 0;

// A small cost for tests whose SUBJECT is not the cost — a valid power-of-two N
// that scrypts in ~1 ms. The default (N=65536) is exercised on its own below.
const FAST: typeof DEFAULT_PARAMS = { n: 1024, r: 8, p: 1, keylen: KEYLEN };

/** Write `line` to a fresh secret file and return its path. */
function secretFile(line: string): string {
  const dir = mkTmp('ccrc-auth-secret-');
  const p = path.join(dir, 'auth.scrypt');
  writeFileSync(p, line);
  return p;
}

/** A syntactically valid line with arbitrary (not scrypt-derived) material — for
 *  PARSE tests, which never verify the hash, only its shape and length. */
function validishLine(over: Partial<{ prefix: string; params: string; salt: string; hash: string; gen: string }> = {}): string {
  const prefix = over.prefix ?? 'scrypt';
  const params = over.params ?? 'N=1024,r=8,p=1';
  const salt = over.salt ?? randomBytes(16).toString('base64');
  const hash = over.hash ?? randomBytes(KEYLEN).toString('base64');
  const gen = over.gen ?? 'gen=1';
  return `${prefix}$${params}$${salt}$${hash}$${gen}`;
}

describe('readAuthSecret — the inverted polarity', () => {
  it('returns null for an ABSENT file (ENOENT is the ONE null — never a throw)', () => {
    const dir = mkTmp('ccrc-auth-secret-');
    expect(readAuthSecret(path.join(dir, 'nope.scrypt'))).toBeNull();
  });

  // The core inversion + the "collapse EACCES→null" mutation guard: a PRESENT but
  // unreadable file must THROW, never return the same null as absent.
  it.skipIf(IS_ROOT)('THROWS on EACCES (present-but-unreadable) — does not collapse to null', () => {
    const p = secretFile(validishLine());
    chmodSync(p, 0o000);
    // It THROWS — the whole point. A mutation collapsing EACCES→null would make
    // this return null instead, and `.toThrow` would fail.
    expect(() => readAuthSecret(p)).toThrow(AuthSecretUnusable);
    chmodSync(p, 0o600);                        // let tmp cleanup remove it
  });

  it('THROWS on a non-ENOENT errno (EISDIR: path is a directory), root or not', () => {
    const dir = mkTmp('ccrc-auth-secret-');
    expect(() => readAuthSecret(dir)).toThrow(AuthSecretUnusable);
  });

  it('THROWS on a present-but-empty file (truncated mid-rotation ≠ absent)', () => {
    expect(() => readAuthSecret(secretFile(''))).toThrow(AuthSecretUnusable);
  });

  it('THROWS on a comment-only / whitespace-only file', () => {
    expect(() => readAuthSecret(secretFile('# just a note\n   \n'))).toThrow(AuthSecretUnusable);
  });
});

describe('readAuthSecret — a garbled line fails SHUT, never reads as "no passphrase"', () => {
  // Each case: the malformed line THROWS AuthSecretUnusable and — the mutation the
  // throw guards — is never silently accepted as null.
  const bad: Array<[string, string]> = [
    ['wrong prefix', validishLine({ prefix: 'bcrypt' })],
    ['too few fields (hash dropped)', 'scrypt$N=1024,r=8,p=1$' + randomBytes(16).toString('base64') + '$gen=1'],
    ['too many fields', validishLine() + '$extra'],
    ['params not N,r,p order', validishLine({ params: 'r=8,N=1024,p=1' })],
    ['params missing p', validishLine({ params: 'N=1024,r=8' })],
    ['non-integer N', validishLine({ params: 'N=abc,r=8,p=1' })],
    ['digit-prefixed junk N (65536x)', validishLine({ params: 'N=65536x,r=8,p=1' })],
    // FIX 1: `Number` would accept each of these as a finite value — a strict
    // parser must refuse a field that is not plain decimal digits, BEFORE Number.
    ['hex-radix N (0x10000)', validishLine({ params: 'N=0x10000,r=8,p=1' })],
    ['leading-whitespace N (" 65536")', validishLine({ params: 'N= 65536,r=8,p=1' })],
    ['plus-signed N (+65536)', validishLine({ params: 'N=+65536,r=8,p=1' })],
    // gen has no power-of-two backstop, so exponent notation here reds ONLY on the
    // strictness gate — `Number('1e2')` is 100, silently accepted by a lenient parse.
    ['exponent gen (1e2)', validishLine({ gen: 'gen=1e2' })],
    ['non-power-of-two N', validishLine({ params: 'N=1000,r=8,p=1' })],
    ['N past the working-set ceiling', validishLine({ params: 'N=8388608,r=8,p=1' })],
    ['r below 1', validishLine({ params: 'N=1024,r=0,p=1' })],
    ['salt not base64 (bad char)', validishLine({ salt: 'ab!d' })],
    ['hash not base64 (bad length)', validishLine({ hash: 'zzz' })],
    ['hash wrong length (16 bytes, want 32)', validishLine({ hash: randomBytes(16).toString('base64') })],
    ['non-integer gen', validishLine({ gen: 'gen=x' })],
    ['negative gen', validishLine({ gen: 'gen=-1' })],
    ['final field not gen=', validishLine({ gen: 'generation=1' })],
  ];
  for (const [name, line] of bad) {
    it(`THROWS on ${name}`, () => {
      const p = secretFile(line);
      expect(() => readAuthSecret(p)).toThrow(AuthSecretUnusable);
      // Belt-and-braces against the "accept a malformed line as no passphrase"
      // mutation: it must not merely avoid returning a WRONG secret, it must not
      // return null either.
      let threw = false;
      try { readAuthSecret(p); } catch { threw = true; }
      expect(threw).toBe(true);
    });
  }

  it('parses a well-formed line into the exact AuthSecret shape', () => {
    const salt = randomBytes(16).toString('base64');
    const hash = randomBytes(KEYLEN).toString('base64');
    const s = readAuthSecret(secretFile(`scrypt$N=1024,r=8,p=1$${salt}$${hash}$gen=7`));
    expect(s).toEqual({ n: 1024, r: 8, p: 1, saltB64: salt, hashB64: hash, generation: 7 });
  });

  it('skips a #-comment preamble and reads the value line below it', () => {
    const salt = randomBytes(16).toString('base64');
    const hash = randomBytes(KEYLEN).toString('base64');
    const s = readAuthSecret(secretFile(`# minted by ccrc passwd\nscrypt$N=1024,r=8,p=1$${salt}$${hash}$gen=1`));
    expect(s?.generation).toBe(1);
  });
});

describe('verifyPassphrase', () => {
  it('true for the correct passphrase, false for a wrong one (round-trips hashLine)', async () => {
    const line = await hashLine('correct horse battery staple', FAST, 3);
    const s = readAuthSecret(secretFile(line))!;
    expect(s.generation).toBe(3);
    expect(await verifyPassphrase(s, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassphrase(s, 'wrong passphrase')).toBe(false);
    expect(await verifyPassphrase(s, '')).toBe(false);
  });

  it('verifies under the REAL default params, and does not flag needsRehash', async () => {
    const s = readAuthSecret(secretFile(await hashLine('s3cret', DEFAULT_PARAMS, 1)))!;
    expect(await verifyPassphrase(s, 's3cret')).toBe(true);
    expect(needsRehash(s)).toBe(false);
  });

  // The "drop the length-check-first in verify" mutation guard: a secret whose
  // hash is not KEYLEN bytes (constructed out of band — a future writer, this
  // test) must fail SHUT to `false`. With the guard removed, timingSafeEqual sees
  // unequal-length buffers and throws a RangeError, so this await would reject.
  it('fails shut (false), never throws, on a secret whose hash is the wrong length', async () => {
    const bad: AuthSecret = {
      n: 1024, r: 8, p: 1,
      saltB64: randomBytes(16).toString('base64'),
      hashB64: randomBytes(16).toString('base64'),   // 16 ≠ KEYLEN(32)
      generation: 1,
    };
    expect(await verifyPassphrase(bad, 'anything')).toBe(false);
  });
});

describe('needsRehash — an old, weaker secret still verifies AND is flagged for upgrade', () => {
  it('flags a below-default cost, but still verifies the passphrase against it', async () => {
    // A line minted under the OLD cost N=16384 (< the current default 65536): a
    // future login must be able to verify it (no forced logout) and know to
    // re-hash it, not silently accept-and-forget.
    const oldParams = { n: 16384, r: 8, p: 1, keylen: KEYLEN };
    expect(oldParams.n).toBeLessThan(DEFAULT_PARAMS.n);
    const s = readAuthSecret(secretFile(await hashLine('legacy pass', oldParams, 2)))!;
    expect(s.n).toBe(16384);
    expect(await verifyPassphrase(s, 'legacy pass')).toBe(true);
    expect(needsRehash(s)).toBe(true);
  });
});
