import { readFileSync } from 'node:fs';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * The passphrase secret file (`~/.ccrc/auth.scrypt`), read with `coord/token.ts`'s
 * discipline and ONE polarity inverted.
 *
 * `coord/token.ts` tolerates an ABSENT box token (`readMailToken` returns `null`;
 * `checkMailToken` answers `'unconfigured'`, which `/api/notify` still rides open
 * for a rollout window). AUTH DOES THE OPPOSITE: an absent hash file is still a
 * real, typed state — `readAuthSecret` returns `null`, the gate maps it to the
 * `'unconfigured'` verdict — but that `null` is a GATE decision (Task 5: absent +
 * `CCRC_AUTH=on` ⇒ fail SHUT), never a licence this reader grants. This reader's
 * only job is to report the file's state faithfully: `null` iff the file is
 * ENOENT, a parsed `AuthSecret` iff the line is well-formed, and a THROW for
 * everything in between — a present-but-unreadable file, or a present-but-garbled
 * line. A garbled secret must fail shut (boot refusal), never read as "no
 * passphrase configured".
 *
 * NO `auth.scrypt.example` SHIPS, deliberately. `coord/token.ts` carries a
 * `PLACEHOLDER_TOKEN` constant and a `MailTokenPlaceholderUnedited` refusal
 * because `deploy/ccrc-mail.token.example` ships a placeholder that `extractToken`
 * resolves cleanly — a published secret an operator can copy without editing. This
 * file has no such class ON PURPOSE: shipping no example means there is no
 * placeholder value committed to this public repo for anyone to copy, so there is
 * nothing here to refuse. `ccrc passwd` (Task 9) is the sole writer and always
 * mints a fresh random salt, so the "unedited copy" failure mode cannot exist.
 * This comment stands where token.ts's placeholder check would have gone, so the
 * next reader knows the absence is a decision, not an omission.
 */

/**
 * Thrown when the secret file EXISTS but this box cannot turn it into a usable
 * `AuthSecret`: any non-ENOENT read error (`EACCES`, `EISDIR`, `ELOOP`, `EIO`), an
 * empty/comment-only file, or a line that does not parse (wrong prefix, missing
 * field, non-integer or out-of-range N/r/p/gen, malformed base64, a hash of the
 * wrong length).
 *
 * Deliberately NOT caught anywhere — the same stance `coord/token.ts`'s
 * `MailTokenFileUnusable`/`MailTokenPlaceholderUnedited` and `coord/db.ts`'s
 * `CoordDbUnmigratable` take: `index.ts` lets it kill the process. A present but
 * unreadable or garbled secret is strictly MORE dangerous than an absent one —
 * collapsing it to `null` would let a chmod, a bad `chown` after a box rebuild, or
 * one corrupt byte read as "no passphrase configured", which is exactly the
 * fail-OPEN the whole flag exists to prevent. It refuses loudly instead.
 */
export class AuthSecretUnusable extends Error {}

/** The parsed secret line. Exactly the fields the PHC-ish format carries — no
 *  `keylen` (fixed at {@link KEYLEN} by the scheme, implied by the hash length)
 *  and no `needsRehash` (a derived signal, see {@link needsRehash}). */
export interface AuthSecret {
  /** scrypt cost (CPU/memory) factor — a power of two. */
  n: number;
  /** scrypt block size. */
  r: number;
  /** scrypt parallelization. */
  p: number;
  /** Salt, standard base64. Read as-is so a secret salted differently still
   *  verifies — the file is self-describing. */
  saltB64: string;
  /** Derived key, standard base64. Decodes to exactly {@link KEYLEN} bytes. */
  hashB64: string;
  /** Bumped by every `ccrc passwd`; a session stamped with an older generation is
   *  `'expired'` (Task 3). A non-negative integer. */
  generation: number;
}

/** The scheme's fixed key length, in bytes. `keylen` is NOT recorded in the line
 *  (the format varies only N/r/p, so N can be raised without a forced logout);
 *  the hash length IS the keylen, and the parser pins it to this. */
export const KEYLEN = 32;

/** The tunable scrypt parameters `hashLine` derives under. */
export interface ScryptParams {
  n: number;
  r: number;
  p: number;
  keylen: number;
}

/**
 * The current defaults — the single source of these values (the Task 9 node
 * helper `gen-auth-hash.mjs` imports them from here rather than re-typing). A
 * parsed secret whose cost is below this default is flagged by {@link needsRehash}
 * so a future login can upgrade it in place.
 */
export const DEFAULT_PARAMS: ScryptParams = { n: 65536, r: 8, p: 1, keylen: KEYLEN };

/** Salt length `hashLine` mints, in bytes (NIST SP 800-132 floor). The parser
 *  imposes no salt length — a self-describing file may carry any. */
const SALT_BYTES = 16;

/** scrypt's working set is `128 * N * r` bytes; the default maxmem (32 MiB) is
 *  below the default N/r's 64 MiB, so scrypt would throw without an explicit
 *  `maxmem`. We size it to the line's OWN N/r plus headroom (default → 96 MiB). */
const MAXMEM_HEADROOM = 32 * 1024 * 1024;

/** A `128 * N * r` working set beyond this is a garbled or hostile line, not a
 *  policy an operator chose — refuse it at parse rather than let `verify` ask
 *  scrypt to allocate it. Bounds N and r together, which is the pair that drives
 *  the allocation. The default's 64 MiB is well under. */
const MAXMEM_CEILING = 512 * 1024 * 1024;

function maxmemFor(n: number, r: number): number {
  return 128 * n * r + MAXMEM_HEADROOM;
}

function scryptDerive(passphrase: string, salt: Buffer, keylen: number,
  opts: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase, salt, keylen, opts, (err, dk) => (err ? reject(err) : resolve(dk)));
  });
}

const STANDARD_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decode a field the format claims is standard base64, refusing anything Node's
 *  lenient `Buffer.from` would silently accept — a bad char, missing padding — so
 *  a mangled field fails shut instead of decoding to some shorter buffer. */
function decodeB64(field: string, what: string, path: string): Buffer {
  if (!STANDARD_BASE64.test(field) || field.length % 4 !== 0) {
    throw new AuthSecretUnusable(`${path}: ${what} is not valid base64`);
  }
  return Buffer.from(field, 'base64');
}

function parseIntStrict(s: string, what: string, path: string): number {
  // A well-formed field is decimal digits and NOTHING else. `^\d+$` first, BEFORE
  // `Number`, because `Number` is lenient in exactly the ways a secret file must
  // not be: `Number(' 65536')`, `Number('0x10000')`, `Number('6e4')`, `Number('+9')`
  // all yield a finite value, so a field carrying leading whitespace, a hex/octal
  // radix, a sign, or an exponent would parse to a NUMBER rather than being refused
  // as malformed. The fail-shut posture wants "the field was well-formed", not
  // merely "it parsed to some integer" — a garbled cost factor must lock out, and
  // it can only do that if it is rejected here.
  if (!/^\d+$/.test(s)) {
    throw new AuthSecretUnusable(`${path}: ${what} is not a plain decimal integer (${JSON.stringify(s)})`);
  }
  const n = Number(s);
  // `^\d+$` admits arbitrarily long digit strings; guard the ones past exact
  // integer range so a downstream comparison never sees a rounded value.
  if (!Number.isSafeInteger(n)) {
    throw new AuthSecretUnusable(`${path}: ${what} is out of safe integer range (${JSON.stringify(s)})`);
  }
  return n;
}

function isPowerOfTwo(n: number): boolean {
  return n >= 2 && (n & (n - 1)) === 0;
}

/** The first line that is neither blank nor a `#`-comment, edges trimmed — the
 *  same shape `coord/token.ts`'s `extractToken` skips to, so a future operator
 *  note above the value line does not break the read. Interior whitespace is NOT
 *  stripped: the format has none, and a stray space belongs in a base64 or
 *  integer field where it fails parsing loudly, not silently removed. */
function firstMeaningfulLine(raw: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    return t;
  }
  return null;
}

function parseAuthSecretLine(line: string, path: string): AuthSecret {
  // scrypt$N=65536,r=8,p=1$<salt-b64>$<hash-b64>$gen=<n>
  // base64 (standard or url) never contains '$', so it is an unambiguous field
  // separator. Exactly five fields; anything else is missing or extra.
  const fields = line.split('$');
  if (fields.length !== 5) {
    throw new AuthSecretUnusable(
      `${path}: expected 5 '$'-separated fields, got ${fields.length}`);
  }
  const [prefix, paramsField, saltB64, hashB64, genField] = fields;

  if (prefix !== 'scrypt') {
    throw new AuthSecretUnusable(`${path}: unknown prefix ${JSON.stringify(prefix)} (want "scrypt")`);
  }

  // Params: exactly N, r, p, in that order — three `key=value` pairs.
  const parts = paramsField.split(',');
  if (parts.length !== 3) {
    throw new AuthSecretUnusable(`${path}: params must be "N=..,r=..,p=..", got ${JSON.stringify(paramsField)}`);
  }
  const want = ['N', 'r', 'p'];
  const vals: Record<string, string> = {};
  for (let i = 0; i < 3; i++) {
    const [k, v] = parts[i].split('=');
    if (k !== want[i] || v === undefined) {
      throw new AuthSecretUnusable(
        `${path}: params field ${i} must be "${want[i]}=..", got ${JSON.stringify(parts[i])}`);
    }
    vals[k] = v;
  }
  const n = parseIntStrict(vals.N, 'N', path);
  const r = parseIntStrict(vals.r, 'r', path);
  const p = parseIntStrict(vals.p, 'p', path);

  if (!isPowerOfTwo(n)) {
    throw new AuthSecretUnusable(`${path}: N=${n} is not a power of two ≥ 2 (scrypt requires it)`);
  }
  if (r < 1 || p < 1) {
    throw new AuthSecretUnusable(`${path}: r and p must be ≥ 1 (got r=${r}, p=${p})`);
  }
  if (128 * n * r > MAXMEM_CEILING) {
    throw new AuthSecretUnusable(
      `${path}: N=${n},r=${r} demands a ${128 * n * r} byte working set, past the ${MAXMEM_CEILING} ceiling`);
  }

  // Base64 fields: validate strictly, then pin the hash to KEYLEN. The salt has
  // no length constraint (self-describing), only that it decodes.
  decodeB64(saltB64, 'salt', path);
  const hash = decodeB64(hashB64, 'hash', path);
  if (hash.length !== KEYLEN) {
    throw new AuthSecretUnusable(`${path}: hash is ${hash.length} bytes, want ${KEYLEN}`);
  }

  // gen=<n>
  const genMatch = /^gen=(.+)$/.exec(genField);
  if (genMatch === null) {
    throw new AuthSecretUnusable(`${path}: final field must be "gen=..", got ${JSON.stringify(genField)}`);
  }
  const generation = parseIntStrict(genMatch[1], 'gen', path);
  if (generation < 0) {
    throw new AuthSecretUnusable(`${path}: gen=${generation} must be ≥ 0`);
  }

  return { n, r, p, saltB64, hashB64, generation };
}

/**
 * The passphrase secret off this box's own disk, at `path`.
 *
 * `null` iff the file is ABSENT (`ENOENT`) — the honest "this box was never given
 * a passphrase" state, which the gate (Task 5) turns into a fail-SHUT 401 when the
 * flag is on. EVERY OTHER outcome throws `AuthSecretUnusable`, uncaught, so
 * `index.ts` refuses to boot rather than starting on a secret it cannot trust:
 *
 *  - any non-ENOENT read error (`EACCES`, `EISDIR`, `ELOOP`, `EIO`) — the file is
 *    PRESENT and this box cannot prove its contents. This MUST NOT collapse into
 *    the same `null` as absent (the "no overloaded null at a seam" rule,
 *    `CLAUDE.md`): a chmod or a bad post-rebuild `chown` would otherwise read as
 *    "unconfigured" and, with the flag on, either fail shut on a box that IS
 *    configured (a lockout with no red anywhere) or — the mirror of D-39 — worse.
 *  - a present-but-empty or comment-only file — the value line was truncated
 *    mid-rotation; refuse, don't read as absent.
 *  - a line that does not parse — one corrupt byte is a garbled secret, not "no
 *    passphrase".
 */
export function readAuthSecret(path: string): AuthSecret | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new AuthSecretUnusable(
      `${path} exists but could not be read (${(err as NodeJS.ErrnoException).code}). This is PRESENT ` +
      'but unusable, not "never configured": refusing to boot rather than treat an unreadable secret as ' +
      'an absent one. See server/src/coord/token.ts for the box-token mirror of this errno discipline.',
      { cause: err });
  }
  const line = firstMeaningfulLine(raw);
  if (line === null) {
    throw new AuthSecretUnusable(
      `${path} exists but carries no secret line (0 bytes, whitespace only, or every line a #-comment). ` +
      'PRESENT but unusable — refusing to boot rather than read a truncated secret file as "no passphrase".');
  }
  return parseAuthSecretLine(line, path);
}

/**
 * Does this secret verify `presented`? Async `crypto.scrypt` — the server runs
 * pty and websocket lanes on this same event loop, and scrypt at these parameters
 * is ~100 ms of pure CPU; `scryptSync` would stall every one of them per login.
 *
 * NEVER logs `presented`: putting the presented value (or a caller's guess at it)
 * in a log would leak the secret to anyone who can read the log — the same rule
 * `server.ts:443-446` states for the box token.
 *
 * keylen is the scheme's fixed {@link KEYLEN}, which — for every secret
 * `readAuthSecret` produces — IS the stored hash's own byte length (the parser
 * pins it). Using the constant rather than reading the field back keeps the
 * length-check-first guard LIVE against a secret built out of band (a future
 * writer, a test) whose hash is a different length: without a fixed derivation
 * length there is no length for the two buffers to disagree on, and the guard
 * could never fire. See D-108.
 */
export async function verifyPassphrase(secret: AuthSecret, presented: string): Promise<boolean> {
  const stored = Buffer.from(secret.hashB64, 'base64');
  // length-check-first (mirrors checkMailToken, token.ts:217-226): a hash that is
  // not KEYLEN bytes cannot have come from this scheme — fail SHUT before spending
  // scrypt, and, the reason it comes FIRST, before `timingSafeEqual`, which throws
  // a RangeError on unequal-length inputs rather than returning false. Dropping
  // this turns that RangeError into an unhandled rejection at the gate instead of
  // a clean "wrong".
  if (stored.length !== KEYLEN) return false;
  const salt = Buffer.from(secret.saltB64, 'base64');
  const derived = await scryptDerive(presented, salt, KEYLEN, {
    N: secret.n, r: secret.r, p: secret.p, maxmem: maxmemFor(secret.n, secret.r),
  });
  return timingSafeEqual(derived, stored);
}

/**
 * Is this secret weaker than the current default and worth re-hashing? The scheme
 * is self-describing precisely so a login can upgrade an old secret in place: a
 * future login that verifies TRUE against a secret this flags can re-`hashLine`
 * the just-proven passphrase under {@link DEFAULT_PARAMS} and rewrite the file,
 * rather than silently accept-and-forget a below-strength cost. Only N (the cost
 * factor that gets raised over time) is compared; r/p are structural.
 */
export function needsRehash(secret: AuthSecret): boolean {
  return secret.n < DEFAULT_PARAMS.n;
}

/**
 * Produce the exact `~/.ccrc/auth.scrypt` line for `passphrase` under `params`,
 * stamped `generation`. The Task 9 node helper (`gen-auth-hash.mjs`) is the real
 * caller — `ccrc passwd` pipes the passphrase to it on stdin and redirects this
 * line into the file — and this same function round-trips through `readAuthSecret`
 * + `verifyPassphrase` in the unit tests, so the writer and the reader are proven
 * against each other here rather than only in production.
 *
 * A FRESH random salt every call: two boxes given the same passphrase, or one box
 * re-run of `ccrc passwd`, never share a hash.
 */
export async function hashLine(passphrase: string, params: ScryptParams, generation: number): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptDerive(passphrase, salt, params.keylen, {
    N: params.n, r: params.r, p: params.p, maxmem: maxmemFor(params.n, params.r),
  });
  return `scrypt$N=${params.n},r=${params.r},p=${params.p}$` +
    `${salt.toString('base64')}$${derived.toString('base64')}$gen=${generation}`;
}
