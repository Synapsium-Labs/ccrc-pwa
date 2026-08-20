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

/**
 * The generation a box's FIRST `ccrc passwd` stamps. Every later rotation is
 * `existing + 1` (`deploy/gen-auth-hash.mjs` is the only writer), and
 * `SessionStore.verify` answers `'expired'` for any session not carrying the
 * CURRENT generation — so this is the number every session on a
 * freshly-configured box is stamped with, and the bump is the whole mechanism
 * by which `ccrc passwd` logs everyone out without a restart.
 *
 * 1 AND NOT 0, and that is not style. The parser admits `gen=0` (it requires
 * only `>= 0`), and 0 is the one integer that is falsy in JavaScript: any
 * future `generation || fallback` — the exact `||`-not-`??` shape this
 * codebase writes deliberately elsewhere (`config.ts`'s bare-`KEY=` rule) —
 * would silently replace a real generation 0 with something else, and a
 * generation nobody chose is a logout nobody asked for or, worse, a stale
 * cookie that revalidates. Starting at 1 keeps 0 as a value this project never
 * writes.
 */
export const INITIAL_GENERATION = 1;

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

/**
 * scrypt's WORK is proportional to `N * r * p`; its ALLOCATION is `128 * N * r`.
 * `p` multiplies the cost and NOT the memory, so {@link MAXMEM_CEILING} — a
 * ceiling on the allocation — says nothing whatever about it, and until this
 * existed `p` was bounded only by `>= 1`.
 *
 * WHY THAT MATTERED (Task 5 review, R5). A hand-edited or corrupted `p=32768` at
 * the shipped `N=65536,r=8` parses cleanly and RUNS — at roughly 32768x the
 * intended ~100 ms, i.e. about an hour of threadpool per login attempt, holding a
 * login rate-limiter slot for the whole of it (`server.ts`'s `reserve`/`finally`).
 * Eight of those exhaust the budget and starve libuv: precisely the denial of
 * service the login brake's reservation exists to prevent, arriving through the
 * PARSER instead of through the route. A cost factor nobody chose is not a policy.
 *
 * The number is {@link MAXMEM_CEILING}'s own, divided by the 128 that turns a
 * working set into bytes — so this is the SAME headroom already granted to N and
 * r (8x the shipped default's `N * r`), now applied to the whole product rather
 * than to two thirds of it. At the defaults it admits `p <= 8`, which bounds one
 * login to ~0.8 s.
 */
const WORK_CEILING = MAXMEM_CEILING / 128;

/**
 * The maxmem {@link verifyPassphrase} hands scrypt. Sized to `128 * N * r` plus
 * {@link MAXMEM_HEADROOM}, and NOT to `p` — which is safe only because
 * `parseAuthSecretLine` refuses any line whose `p` would not fit in that
 * headroom. OpenSSL's own accounting is `128 * r * (N + p + 2)`, so a `p` past
 * the headroom makes scrypt throw `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`
 * SYNCHRONOUSLY inside the promise executor — a rejected `verifyPassphrase`, an
 * uncaught throw in the login route, and a 500 where the only correct answer is a
 * 401. The parser closes that instead, so this stays a two-parameter function.
 */
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
  // scrypt's OTHER structural constraint on N, alongside power-of-two: RFC 7914
  // requires `N < 2^(128 * r / 8)`, i.e. `N < 2^(16 * r)`, and OpenSSL enforces
  // it. Nothing above models it — the working-set ceiling bounds `N * r` as a
  // PRODUCT, so it happily admits a large N against a small r (Task 5 review,
  // F1). Measured on node 24.14.1: `N=65536,r=1,p=1` passes every other check
  // here and then makes `crypto.scrypt` throw `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`
  // SYNCHRONOUSLY inside `scryptDerive`'s promise executor — a rejected
  // `verifyPassphrase`, an uncaught throw in the login route (which has a
  // `finally` and no `catch`), and a 500 where a broken secret must always answer
  // 401. The rate-limiter slot is still released, so this is the polarity
  // residual R5 set out to remove rather than a second denial of service; it is
  // closed here for the same reason, in the same place.
  //
  // `16 * r < 64` short-circuits the exponentiation: past r=3 the bound exceeds
  // 2^64, which the working-set ceiling already puts far out of reach (it caps
  // `n` at `MAXMEM_CEILING / (128 * r)`), so there is nothing left to check and
  // no reason to compute `2 ** 1398096` for a line claiming r=87381.
  if (16 * r < 64 && n >= 2 ** (16 * r)) {
    throw new AuthSecretUnusable(
      `${path}: N=${n} is not below scrypt's 2^(16*r) = ${2 ** (16 * r)} limit for r=${r} ` +
      '(RFC 7914; OpenSSL refuses the pair) — a working set this shape parses but cannot be derived');
  }
  if (128 * n * r > MAXMEM_CEILING) {
    throw new AuthSecretUnusable(
      `${path}: N=${n},r=${r} demands a ${128 * n * r} byte working set, past the ${MAXMEM_CEILING} ceiling`);
  }
  // p, bounded twice — for two different failures, neither of which the
  // allocation ceiling above can see (Task 5 review, R5).
  //
  // WORK: `p` multiplies scrypt's cost linearly at no memory cost, so a corrupt
  // `p` is an arbitrarily slow login — hours per attempt, each one holding a
  // rate-limiter slot. See {@link WORK_CEILING}.
  if (n * r * p > WORK_CEILING) {
    throw new AuthSecretUnusable(
      `${path}: N=${n},r=${r},p=${p} demands ${n * r * p} units of scrypt work, past the ` +
      `${WORK_CEILING} ceiling — p multiplies the cost and not the memory, so a p this large is a ` +
      'garbled or hostile line, not a policy anyone chose (each login would take minutes to hours)');
  }
  // ALLOCATION: `maxmemFor` sizes maxmem from N and r alone, while OpenSSL's own
  // accounting is `128 * r * (N + p + 2)` — so a `p` past the headroom makes
  // scrypt throw synchronously and the login route answer 500 instead of the
  // 401 a broken secret must always get. Refusing here turns it into
  // `'unusable'`, which the gate already maps to `'unconfigured'`.
  if (128 * r * (p + 2) > MAXMEM_HEADROOM) {
    throw new AuthSecretUnusable(
      `${path}: r=${r},p=${p} needs ${128 * r * (p + 2)} bytes of scrypt block memory, past the ` +
      `${MAXMEM_HEADROOM} byte headroom this scheme sizes maxmem with — scrypt itself would refuse it`);
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
 * could never fire. See D-121.
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
 * stamped `generation`. The node helper (`deploy/gen-auth-hash.mjs`) is the real
 * caller — `ccrc passwd` pipes the passphrase to it on stdin — and this same
 * function round-trips through `readAuthSecret` + `verifyPassphrase` in the unit
 * tests, so the writer and the reader are proven against each other here rather
 * than only in production.
 *
 * THE HELPER WRITES THE FILE ITSELF; this docstring used to say `ccrc passwd`
 * "redirects this line into the file", which Task 9 measured to be the wrong
 * shape and did not build. A shell redirect truncates the destination BEFORE
 * the line exists, so a hash that turned out unreadable would already have
 * destroyed the working secret it was replacing — and `readAuthSecret` is
 * called UNCAUGHT at boot (`server.ts`), which makes an unreadable line a
 * server that does not start, fixable only by the command that wrote it. The
 * helper therefore writes a temp file, reads it back through `readAuthSecret`
 * AND proves the passphrase against it with `verifyPassphrase` while the
 * passphrase is still in hand, and only then renames it into place. A line this
 * function is happy to emit is not automatically a line the parser accepts —
 * `{n: 65536, r: 1, p: 1}` is exactly such a pair (D-126's `N < 2^(16*r)`
 * bound) — so that round trip is a real gate, not a ritual.
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
