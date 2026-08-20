#!/usr/bin/env node
// deploy/gen-auth-hash.mjs — the ONE node entry point for this box's passphrase
// secret file (`~/.ccrc/auth.scrypt`). Stage 3a, Task 9.
//
// Two modes, one program, and they are one program deliberately: both of them
// have to agree, byte for byte, about what a usable secret file IS, and the
// only way to guarantee that is for both to run the SAME reader.
//
//   node deploy/gen-auth-hash.mjs <path>            (passphrase on STDIN)
//     hash the passphrase and install it at <path>, 0600, bumping `generation`.
//     `ccrc passwd` is the caller.
//   node deploy/gen-auth-hash.mjs --check <path>
//     measure the file that is there and say which of four states it is in.
//     `ccrc doctor`'s `auth` check is the caller.
//
// ── THE READER IS IMPORTED, NEVER RE-TYPED ────────────────────────────────
// `server/src/auth/secret.ts` owns the format, the parameter bounds and the
// refusals; this file owns nothing about them. It imports the COMPILED module
// (`server/dist/server/src/auth/secret.js`) rather than re-implementing a
// parser in a second language, because a second copy of that parser is exactly
// how a writer comes to emit lines its own reader refuses — see the round trip
// below, which exists because that gap is REAL even with one parser:
// `hashLine` is happy to emit `{n: 65536, r: 1, p: 1}` and the parser rejects
// it (D-113, OpenSSL's `N < 2^(16*r)`).
//
// That import is why this needs a BUILT server, and why a box without one gets
// its own exit code rather than a crash: the secret file only means anything on
// a box that runs the server, and a box that runs the server has `dist/` (both
// deploy lanes build it; `ccrc install`'s `_inst_tree` refuses to place a tree
// without it).
//
// ── WHY THE WRITE IS VALIDATED BEFORE IT IS INSTALLED ─────────────────────
// `buildServer` calls `readAuthSecret` UNCAUGHT at boot with `CCRC_AUTH=on`
// (server.ts, and secret.ts's own header states the stance): a line that does
// not parse is not a refused login, it is a server that DOES NOT START. And the
// operator's only remedy is this very command. So a bad line must never reach
// the destination in the first place: the hash goes to a temp file, is read
// back through `readAuthSecret`, is proven against the passphrase with
// `verifyPassphrase` while that passphrase is still in hand, and only then is
// renamed into place. A failure at any of those steps unlinks the temp and
// exits non-zero with the existing file byte-for-byte untouched.
//
// ── THE PASSPHRASE ARRIVES ON STDIN, AND IS NEVER PRINTED ─────────────────
// argv is world-readable in /proc, so the passphrase can never be an argument;
// `ccrc passwd` pipes it from a bash BUILTIN `printf` (no second process, no
// temp file, no here-string). Nothing in this file writes it, logs it, or puts
// it in an error message, and the same rule covers the FILE's own bytes — see
// `--check`'s refusal, which reports a class and never a byte.
//
// ── EXIT CODES ────────────────────────────────────────────────────────────
// The house table (ccd/ccrc's header) plus the measurement codes `--check`
// answers with, which are DATA the doctor turns into a verdict:
//   0 = done   (write: the file is in place; --check: the file parsed)
//   1 = the tool ran and the answer was bad — a refusal; nothing was written
//   2 = usage error
//   3 = --check only: the file is ABSENT
//   4 = --check only: the file is PRESENT and UNUSABLE — `readAuthSecret`'s
//       one throw class, which covers both a line that does not parse and a
//       file this box cannot read (EACCES after a bad chown, EISDIR, EIO).
//       They are one code here because they are one class there, and because
//       the doctor's remedy for both is the same command
//   5 = --check only: the compiled reader could not be loaded (no server build)
import { readFileSync, writeFileSync, chmodSync, renameSync, unlinkSync, mkdirSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROG = 'gen-auth-hash';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The compiled reader, resolved from THIS FILE rather than from `$PWD` — the
 *  `ccrc-adopt:124-125` idiom every script in this tree uses, so the helper
 *  works from a checkout (`deploy/../server/dist/…`) and from a box
 *  (`~/ccrc/deploy/../server/dist/…`) without being told which it is on.
 *  The `server/src` inside `dist/` is not a typo: `server/tsconfig.json` sets
 *  `rootDir: ".."` so the build preserves the repository's own layout —
 *  `_inst_tree` preflights `server/dist/server/src/index.js` for the same
 *  reason. */
const SECRET_MODULE = path.resolve(HERE, '..', 'server', 'dist', 'server', 'src', 'auth', 'secret.js');

const die = (msg) => { process.stderr.write(`${PROG}: ${msg}\n`); return 1; };

function usage() {
  process.stderr.write(
    `usage: node ${PROG}.mjs <auth.scrypt path>      (the passphrase on stdin)\n`
    + `       node ${PROG}.mjs --check <auth.scrypt path>\n`);
  return 2;
}

/** The compiled `secret.js`, or `null` when this box has no server build.
 *  Dynamic and caught, rather than a top-level `import`, so "this box never
 *  built the server" is a state `--check` can REPORT (exit 5) instead of a
 *  stack trace the doctor would have to guess at. */
async function loadSecretModule() {
  try {
    return await import(pathToFileURL(SECRET_MODULE).href);
  } catch {
    return null;
  }
}

const noBuild = () => die(
  `no compiled reader at ${SECRET_MODULE} — this box has no server build, and the passphrase file is `
  + 'read by the server. Build it (npm run build in server/) or run this on the box that serves the PWA.');

/**
 * `--check <path>` — WHAT STATE IS THE FILE IN, in the reader's own words.
 *
 * NOT ONE BYTE OF THE FILE IS EVER PRINTED, and that is a decision with a
 * reason rather than caution: `AuthSecretUnusable`'s message quotes the field
 * it choked on, and the file that lands here is by definition NOT a secret line
 * — the plausible ways to get one are a hand edit and a misplaced copy of
 * another file. `~/.ccrc/mail.token` copied to this path would parse as an
 * "unknown prefix" and put the box token, verbatim, in a doctor transcript an
 * operator pastes into a ticket. CLAUDE.md's rule is absolute: never print
 * secret file CONTENTS. The remedy does not need the byte anyway — a hash
 * cannot be hand-repaired, so every unparseable file has exactly one fix.
 */
async function check(file) {
  // ABSENCE IS ANSWERED WITHOUT THE MODULE. Not a second reader of the format:
  // it is one `stat`, and whenever the module DOES load, `readAuthSecret` is
  // the only thing that decides (including deciding absence itself, below, if
  // the file vanishes between these two lines). The fast path exists because
  // "is a passphrase configured at all?" is the question the doctor's WARN
  // hangs on, and a box with no server build — a dev checkout — must still get
  // that answer rather than a shrug about a missing `dist/`.
  try {
    statSync(file);
  } catch (e) {
    if (e && e.code === 'ENOENT') return 3;
    // Anything else (EACCES on the DIRECTORY, ELOOP, EIO) is a present-but-
    // unreachable file, which is `readAuthSecret`'s throw class, not its null.
  }

  const mod = await loadSecretModule();
  if (mod === null) return 5;

  let secret;
  try {
    secret = mod.readAuthSecret(file);
  } catch {
    return 4;
  }
  if (secret === null) return 3;
  // The doctor's verdict line is built from this, and it is validated there
  // against a strict regex — so keep it exactly this shape. Params and
  // generation only: the salt and the hash never leave this process.
  process.stdout.write(`N=${secret.n},r=${secret.r},p=${secret.p},gen=${secret.generation}\n`);
  return 0;
}

/** Everything on stdin, with at most ONE trailing newline removed. `ccrc
 *  passwd` sends none (`printf '%s'`); the strip is for a human or a script
 *  that pipes `echo`, whose newline would otherwise become part of the
 *  passphrase and lock them out of a box that reports a perfectly good file. */
function readPassphrase() {
  let raw;
  try {
    raw = readFileSync(0, 'utf8');
  } catch (e) {
    return { err: `could not read the passphrase from stdin (${e && e.code ? e.code : 'unknown'})` };
  }
  const pass = raw.replace(/\r?\n$/, '');
  if (pass === '') return { err: 'the passphrase on stdin is empty — nothing was written' };
  return { pass };
}

/**
 * `<path>` — hash the passphrase on stdin and install it, bumping `generation`.
 *
 * THE GENERATION IS READ FROM THE FILE BEING REPLACED (D-125), and the three answers
 * are kept apart (secret.ts's own polarity, which this must not flatten):
 *   absent            -> INITIAL_GENERATION. The honest "never configured" box.
 *   parses            -> its generation + 1. Every live session is now stamped
 *                        with a superseded generation, which `SessionStore.verify`
 *                        answers `'expired'` for — the whole point of the field.
 *   present, unusable -> REFUSE. There is no generation to read, and inventing
 *                        one is not a neutral act: writing INITIAL_GENERATION
 *                        over a box that was at generation 1 would REVALIDATE
 *                        every session minted under it rather than log it out,
 *                        which is the opposite of what this command is for. The
 *                        operator moves the file aside — an act only they can
 *                        decide to take — and re-runs.
 */
async function write(file) {
  if (process.stdin.isTTY) {
    return die('the passphrase must arrive on STDIN, never as an argument — this is the helper `ccrc passwd` '
      + 'pipes to, not a prompt. Run `ccrc passwd`.');
  }
  const { pass, err } = readPassphrase();
  if (err !== undefined) return die(err);

  const mod = await loadSecretModule();
  if (mod === null) return noBuild();

  let existing;
  try {
    existing = mod.readAuthSecret(file);
  } catch {
    return die(
      `${file} exists and this box cannot read it as a secret line, so the generation it carries cannot be `
      + 'read either — and writing a fresh one under an INVENTED generation would revalidate sessions this '
      + 'command exists to expire. Nothing was written. Move it aside and re-run:\n'
      + `  mv ${file} ${file}.broken && ccrc passwd`);
  }
  const generation = existing === null ? mod.INITIAL_GENERATION : existing.generation + 1;

  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  } catch (e) {
    return die(`cannot create ${path.dirname(file)} (${e && e.code ? e.code : 'unknown'}) — nothing was written`);
  }

  // THE DERIVE CAN REFUSE BEFORE THERE IS A LINE TO VALIDATE (D-124), and it is caught
  // for the same reason the round trip below exists: `DEFAULT_PARAMS` is data,
  // and OpenSSL enforces structural rules of its own on it. Measured on node
  // 24.14.1: `{n: 65536, r: 1}` — the pair D-113 added a PARSER bound for —
  // never reaches the parser at all, because `crypto.scrypt` throws
  // `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` synchronously inside `scryptDerive`'s
  // promise executor, which rejects this `await`. Uncaught, that is a stack
  // trace where `ccrc passwd` promises a sentence — and the caller's own
  // refusal line then points an operator at a backtrace. The file is untouched
  // either way; this is about which of the two says so.
  let line;
  try {
    line = await mod.hashLine(pass, mod.DEFAULT_PARAMS, generation);
  } catch (e) {
    return die(`scrypt refused to derive a hash under this build's DEFAULT_PARAMS (${e && e.message ? e.message : 'unknown'}) `
      + `— ${file} is unchanged. This is a bug in ccrc, not a fact about your box.`);
  }

  // `wx` — EXCLUSIVE create, and the random suffix that makes it succeed. Two
  // things it buys: `writeFileSync`'s `mode` is only applied when the file is
  // CREATED, so writing over a leftover temp would leave whatever mode that
  // leftover had (0644 from some other tool is a world-readable hash); and a
  // concurrent run cannot be stomped on. The explicit `chmod` after it is
  // belt-and-braces against a umask that masked the create mode.
  const tmp = `${file}.tmp.${randomBytes(6).toString('hex')}`;
  try {
    writeFileSync(tmp, `${line}\n`, { mode: 0o600, flag: 'wx' });
    chmodSync(tmp, 0o600);
  } catch (e) {
    return die(`could not write ${tmp} (${e && e.code ? e.code : 'unknown'}) — ${file} was not touched`);
  }

  // ── THE ROUND TRIP. Everything above this point is a guess; this is the
  // measurement. It runs on the TEMP file, before the rename, so a line the
  // server could not boot on cannot reach the destination — and it proves two
  // separate things, because they can fail separately:
  //   1. `readAuthSecret` accepts the line. `hashLine` will happily emit
  //      params the parser refuses (`{n: 65536, r: 1, p: 1}`: legal to derive
  //      under, and rejected by D-113's `N < 2^(16*r)` bound), and an
  //      unparseable line here is a server that does not start.
  //   2. `verifyPassphrase` says TRUE for the passphrase just typed. That is
  //      the assertion that this file will actually let this operator in —
  //      the round trip's whole point is that it happens WHILE the passphrase
  //      is still in hand, which is a window that exists exactly once.
  // The generation is re-read too: the field the caller cares about most is
  // the one thing above that is not otherwise proven by either check.
  try {
    const back = mod.readAuthSecret(tmp);
    if (back === null) throw new Error('the file this run just wrote reads as absent');
    if (back.generation !== generation) {
      throw new Error(`it reads back at generation ${back.generation}, not the ${generation} it was stamped with`);
    }
    if (!await mod.verifyPassphrase(back, pass)) {
      throw new Error('the passphrase just entered does NOT verify against it');
    }
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* the temp is already gone; the destination is what matters */ }
    return die(
      `refusing to install a secret file this box cannot use: ${e && e.message ? e.message : 'unknown'}. `
      + `${file} is unchanged. This is the guard that stops a bad line from becoming a server that will not `
      + 'boot — report it rather than working around it.');
  }

  try {
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nothing to unwind at the destination */ }
    return die(`could not install ${file} (${e && e.code ? e.code : 'unknown'}) — it was not replaced`);
  }

  const was = existing === null ? 'first passphrase on this box' : `was generation ${existing.generation}`;
  process.stdout.write(
    `${PROG}: wrote ${file} (0600, scrypt N=${mod.DEFAULT_PARAMS.n},r=${mod.DEFAULT_PARAMS.r},`
    + `p=${mod.DEFAULT_PARAMS.p}, generation ${generation} — ${was}); read back and verified before installing\n`);
  return 0;
}

async function main(argv) {
  const args = argv.slice(2);
  if (args[0] === '--check') {
    if (args.length !== 2 || args[1] === '') return usage();
    return check(args[1]);
  }
  if (args.length !== 1 || args[0] === '' || args[0].startsWith('-')) return usage();
  return write(args[0]);
}

process.exitCode = await main(process.argv);
