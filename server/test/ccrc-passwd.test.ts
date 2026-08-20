// `ccrc passwd` and the hasher it shells to (`deploy/gen-auth-hash.mjs`) —
// Task 9 of the stage-3a auth plan. `ccrc-cli.test.ts` owns the verb's
// DISCOVERABILITY (the usage line), `ccrc-doctor.test.ts` owns the `auth`
// check that reports what this writes; this file owns what it DOES.
//
// ── THE ONE THING THIS SUITE IS REALLY ABOUT ──────────────────────────────
// A bad `auth.scrypt` line is not a refused login. `buildServer` calls
// `readAuthSecret` UNCAUGHT at boot with `CCRC_AUTH=on`, so an unparseable
// line is a server that DOES NOT START — and the operator's only remedy is the
// very command that wrote it. Every refusal below is measured with the same
// two assertions: a non-zero exit, and the destination file byte-for-byte as
// it was.
//
// ── HOW THE FIXTURE CONTAINS IT ───────────────────────────────────────────
//  1. HOME is a throwaway `mkTmp` directory — the isolation boundary the whole
//     ccd/ccrc suite relies on (CLAUDE.md), and the one that matters most in
//     this file: `ccrc passwd` WRITES `$HOME/.ccrc/auth.scrypt`, which on the
//     box this suite runs on is a live credential.
//  2. `ccrc` is invoked through a symlink at `<home>/ccrc/ccd/ccrc` — the shape
//     of a deployed box — while the HELPER beside it is a copy, because node
//     resolves a module's imports from its real path (see `plantAuthHelper`).
//  3. The compiled reader under `<home>/ccrc/server/dist/…` is built from this
//     checkout's own `server/src/auth/secret.ts` (`authFixtures.ts`).
//  4. `ghContainedEnv` plants the poisoned `gh`, as every other ccrc suite
//     does — not because this verb shells out to it, but because containment
//     that each file has to remember is containment that goes missing.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync, chmodSync, statSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { plantAuthHelper, plantAuthModule, type FixtureParams } from './authFixtures.js';
import { readAuthSecret, verifyPassphrase, DEFAULT_PARAMS, INITIAL_GENERATION } from '../src/auth/secret.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC_SRC = join(REPO, 'ccd', 'ccrc');
const HELPER_SRC = join(REPO, 'deploy', 'gen-auth-hash.mjs');

/** bash's absolute path, resolved once under this process's real PATH. */
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const NODE = process.execPath;

const PASS = 'correct-horse-battery-staple';
const OTHER = 'a-different-passphrase';

const ccrcIn = (home: string): string => join(home, 'ccrc', 'ccd', 'ccrc');
const secretPath = (home: string): string => join(home, '.ccrc', 'auth.scrypt');
const helperIn = (home: string): string => join(home, 'ccrc', 'deploy', 'gen-auth-hash.mjs');

/** A box with the tree `ccrc passwd` needs and nothing in `~/.ccrc` yet.
 *  `params` plants a MUTANT `DEFAULT_PARAMS` (see `authFixtures.ts`) — the only
 *  way to reach the round-trip refusal without shipping a broken default. */
function box(prefix: string, params?: FixtureParams): string {
  const home = mkTmp(prefix);
  const ccd = join(home, 'ccrc', 'ccd');
  mkdirSync(ccd, { recursive: true });
  symlinkSync(CCRC_SRC, join(ccd, 'ccrc'));
  plantAuthHelper(join(home, 'ccrc'));
  plantAuthModule(join(home, 'ccrc'), params);
  return home;
}

function env(home: string): NodeJS.ProcessEnv {
  // The real PATH is kept (node, bash and stty all have to resolve), with the
  // poisoned `gh` in front of it — `ccrc-cli.test.ts`'s runner, same reason.
  const e = ghContainedEnv(home, { ...process.env, HOME: home });
  // Every CCRC_* input this CLI reads is removed by name, so whoever ran the
  // suite cannot change what a verb measures (ccrc-cli.test.ts:88-94).
  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_DOCTOR_GH_TIMEOUT']) delete e[k];
  return e;
}

interface Result { code: number; stdout: string; stderr: string }

/** `ccrc <args>` with stdin NOT a terminal — a pipe carrying `stdin`. This is
 *  the shape the tty refusal exists for, and (with `''`) the shape every other
 *  non-interactive invocation has. */
function runPiped(home: string, args: string[], stdin = ''): Result {
  const r = spawnSync(BASH, [ccrcIn(home), ...args],
    { env: env(home), encoding: 'utf8', input: stdin });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** `node deploy/gen-auth-hash.mjs …` directly, out of the fixture tree. */
function runHelper(home: string, args: string[], stdin = ''): Result {
  const r = spawnSync(NODE, [helperIn(home), ...args],
    { env: env(home), encoding: 'utf8', input: stdin });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/**
 * `ccrc passwd` on a REAL terminal, typing `entries` at the prompts.
 *
 * A pty, and not an `expect` script or a `< /dev/tty` trick, because `[ -t 0 ]`
 * and `read -rs` are two of the three things this verb is: without a terminal
 * the only branch reachable is the refusal. node-pty is already a dependency of
 * this package (it is how the PWA's terminal drawer works), so this costs the
 * suite no new one.
 *
 * Each entry is sent when its prompt appears rather than after a sleep: the
 * hash is ~100ms of scrypt and the prompts are the only synchronisation that
 * cannot go stale.
 */
function runPasswdTty(home: string, entries: string[], args: string[] = []): Promise<Result> {
  return new Promise((resolve) => {
    const p = pty.spawn(BASH, [ccrcIn(home), 'passwd', ...args], {
      name: 'xterm-color', cols: 200, rows: 40, cwd: home,
      env: env(home) as Record<string, string>,
    });
    let out = '';
    let sent = 0;
    let done = false;
    const finish = (code: number): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout: out, stderr: '' });   // a pty merges the two streams
    };
    const timer = setTimeout(() => { p.kill(); finish(-1); }, 20_000);
    p.onData((d) => {
      out += d;
      // One entry per prompt. The prompts are the two `read -rsp` strings; the
      // count of prompts SEEN is what advances the state, so a run that only
      // ever prints one prompt (a refusal before the second) sends one entry
      // and no more.
      const prompts = (out.match(/(New passphrase|Repeat it)/g) ?? []).length;
      while (sent < prompts && sent < entries.length) p.write(`${entries[sent++]}\r`);
    });
    p.onExit(({ exitCode }) => finish(exitCode));
  });
}

/** The file's exact bytes, or `null` when there is none. */
const bytesAt = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf8') : null);

/** Everything in `~/.ccrc` — the assertion that a refusal left no temp file
 *  behind either. A `auth.scrypt.tmp.<hex>` at 0600 holding a live hash is not
 *  a leak of nothing. */
const ccrcDirEntries = (home: string): string[] => {
  const d = join(home, '.ccrc');
  return existsSync(d) ? readdirSync(d).sort() : [];
};

// ── the hasher, on its own ────────────────────────────────────────────────

describe('gen-auth-hash: writing the secret file', () => {
  it('writes a file the SERVER\'s own reader accepts, and that verifies the passphrase', async () => {
    const home = box('ccrc-passwd-write-');
    const r = runHelper(home, [secretPath(home)], PASS);
    expect(r.code, r.stderr).toBe(0);
    // Read back with the reader the server boots on — imported here, not
    // re-implemented — which is the whole contract of the file.
    const secret = readAuthSecret(secretPath(home));
    expect(secret).not.toBeNull();
    expect(await verifyPassphrase(secret!, PASS)).toBe(true);
    expect(await verifyPassphrase(secret!, OTHER)).toBe(false);
    expect(secret!.n).toBe(DEFAULT_PARAMS.n);
    expect(secret!.r).toBe(DEFAULT_PARAMS.r);
    expect(secret!.p).toBe(DEFAULT_PARAMS.p);
  });

  it('is 0600, and leaves no temp file beside it', () => {
    const home = box('ccrc-passwd-mode-');
    expect(runHelper(home, [secretPath(home)], PASS).code).toBe(0);
    expect(statSync(secretPath(home)).mode & 0o777).toBe(0o600);
    expect(ccrcDirEntries(home)).toEqual(['auth.scrypt']);
  });

  it('stamps INITIAL_GENERATION on a box that had none', () => {
    const home = box('ccrc-passwd-gen-first-');
    expect(runHelper(home, [secretPath(home)], PASS).code).toBe(0);
    expect(readAuthSecret(secretPath(home))!.generation).toBe(INITIAL_GENERATION);
  });

  it('BUMPS the generation on every rotation — the one lever that logs everyone out', () => {
    // `SessionStore.verify` answers `'expired'` for a session whose stamped
    // generation is not the current one, so a rotation that rewrote the SAME
    // number would leave every logged-in browser logged in — with a passphrase
    // its owner believes they have just replaced. Deleting the `+ 1` is a
    // one-character mutation and this is what goes red for it.
    const home = box('ccrc-passwd-gen-bump-');
    const seen: number[] = [];
    for (const p of [PASS, OTHER, `${PASS}-3`]) {
      expect(runHelper(home, [secretPath(home)], p).code).toBe(0);
      seen.push(readAuthSecret(secretPath(home))!.generation);
    }
    expect(seen).toEqual([INITIAL_GENERATION, INITIAL_GENERATION + 1, INITIAL_GENERATION + 2]);
  });

  it('mints a fresh salt every run — two boxes given one passphrase share no hash', () => {
    const a = box('ccrc-passwd-salt-a-');
    const b = box('ccrc-passwd-salt-b-');
    for (const h of [a, b]) expect(runHelper(h, [secretPath(h)], PASS).code).toBe(0);
    const [sa, sb] = [a, b].map((h) => readAuthSecret(secretPath(h))!);
    expect(sa.saltB64).not.toBe(sb.saltB64);
    expect(sa.hashB64).not.toBe(sb.hashB64);
  });

  it('refuses an empty passphrase rather than writing a file nothing can log into', () => {
    const home = box('ccrc-passwd-empty-');
    const r = runHelper(home, [secretPath(home)], '');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^gen-auth-hash: the passphrase on stdin is empty/m);
    expect(bytesAt(secretPath(home))).toBeNull();
  });

  it('strips exactly one trailing newline — an echo-piped passphrase is not a different one', () => {
    // The two callers have to agree byte for byte about what was typed. `ccrc
    // passwd` sends none (a bash builtin `printf '%s'`); a human piping `echo`
    // sends one, and a newline silently folded into the passphrase is a box
    // whose owner can never log into it while every check reports a healthy
    // file.
    const home = box('ccrc-passwd-newline-');
    expect(runHelper(home, [secretPath(home)], `${PASS}\n`).code).toBe(0);
    const secret = readAuthSecret(secretPath(home))!;
    return expect(verifyPassphrase(secret, PASS)).resolves.toBe(true);
  });

  it('is a usage error (exit 2) with no path, and writes nothing', () => {
    const home = box('ccrc-passwd-usage-');
    const r = runHelper(home, [], PASS);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^usage: node gen-auth-hash\.mjs/m);
    expect(ccrcDirEntries(home)).toEqual([]);
  });
});

// ── the round trip: the guard that stops a boot-brick ─────────────────────

describe('gen-auth-hash: the write is validated BEFORE it is installed', () => {
  /** A tree whose `DEFAULT_PARAMS` produce a line `hashLine` derives happily
   *  and `readAuthSecret` refuses: a 16-byte key, where the parser pins the
   *  hash to KEYLEN=32. Every function involved is the shipped one. */
  const SHORT_KEY: FixtureParams = { n: 65_536, r: 8, p: 1, keylen: 16 };

  it('refuses to install a line the server\'s own parser rejects', () => {
    const home = box('ccrc-passwd-roundtrip-', SHORT_KEY);
    const r = runHelper(home, [secretPath(home)], PASS);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/refusing to install a secret file this box cannot use/);
    // …and the reason names the reader's own words, so an operator is not left
    // guessing which half of the round trip failed.
    expect(r.stderr).toMatch(/hash is 16 bytes, want 32/);
    expect(bytesAt(secretPath(home))).toBeNull();
    expect(ccrcDirEntries(home)).toEqual([]);
  });

  it('leaves an EXISTING secret byte-for-byte untouched when the round trip fails', () => {
    // The dangerous half. A shell redirect (`node … > file`) truncates the
    // destination before the line exists, so a hash that turns out unreadable
    // has already destroyed the working secret it was replacing — on a box
    // where that file is the only way in.
    const home = box('ccrc-passwd-roundtrip-keeps-');
    expect(runHelper(home, [secretPath(home)], PASS).code).toBe(0);
    const before = bytesAt(secretPath(home));

    plantAuthModule(join(home, 'ccrc'), SHORT_KEY);
    const r = runHelper(home, [secretPath(home)], OTHER);
    expect(r.code).toBe(1);
    expect(bytesAt(secretPath(home))).toBe(before);
    expect(ccrcDirEntries(home)).toEqual(['auth.scrypt']);
  });

  it('refuses cleanly when scrypt itself will not derive under the build\'s params', () => {
    // D-113's own pair, measured: `{n: 65536, r: 1}` does not reach the parser
    // at all — `crypto.scrypt` throws `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`
    // synchronously (OpenSSL's `N < 2^(16*r)`), which rejects `hashLine`'s
    // promise. Uncaught that is a stack trace where the caller promises a
    // sentence; the file is untouched either way, and this pins which of the
    // two the operator gets.
    const home = box('ccrc-passwd-derive-refuses-', { n: 65_536, r: 1, p: 1, keylen: 32 });
    const r = runHelper(home, [secretPath(home)], PASS);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^gen-auth-hash: scrypt refused to derive a hash/m);
    expect(r.stderr).not.toMatch(/at async|node:internal/);   // a sentence, not a backtrace
    expect(bytesAt(secretPath(home))).toBeNull();
  });

  it('REFUSES to overwrite a file it cannot read, rather than inventing a generation', () => {
    // The generation cannot be read out of a garbled file, and writing
    // INITIAL_GENERATION over a box that WAS at generation 1 would revalidate
    // every session minted under it — the exact opposite of what the command
    // is for. Moving the file aside is a decision only the operator can make,
    // and the refusal prints the command that makes it.
    const home = box('ccrc-passwd-garbled-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(secretPath(home), 'this is not a secret line\n');
    const r = runHelper(home, [secretPath(home)], PASS);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/cannot read it as a secret line/);
    expect(r.stderr).toMatch(/mv .*auth\.scrypt .*auth\.scrypt\.broken && ccrc passwd/);
    expect(bytesAt(secretPath(home))).toBe('this is not a secret line\n');
  });

  it('never prints the passphrase, on any path', () => {
    const home = box('ccrc-passwd-quiet-', { n: 65_536, r: 8, p: 1, keylen: 16 });
    const bad = runHelper(home, [secretPath(home)], PASS);
    plantAuthModule(join(home, 'ccrc'));
    const good = runHelper(home, [secretPath(home)], PASS);
    for (const r of [bad, good]) {
      expect(r.stdout).not.toContain(PASS);
      expect(r.stderr).not.toContain(PASS);
    }
  });
});

// ── --check: the measurement doctor turns into a verdict ──────────────────

describe('gen-auth-hash --check: four states, four codes', () => {
  it('answers ABSENT (3) with no server build at all — the question is still answerable', () => {
    // Deliberate: "is a passphrase configured?" is the question doctor's WARN
    // hangs on, and a box that never built the server (a dev checkout) must
    // still get that answer rather than a shrug about a missing dist/.
    const home = mkTmp('ccrc-check-nobuild-');
    plantAuthHelper(join(home, 'ccrc'));
    const r = runHelper(home, ['--check', secretPath(home)]);
    expect(r.code).toBe(3);
    expect(r.stdout).toBe('');
  });

  it('answers PARSED (0) with the parameters and the generation, and nothing else', () => {
    const home = box('ccrc-check-parsed-');
    expect(runHelper(home, [secretPath(home)], PASS).code).toBe(0);
    const r = runHelper(home, ['--check', secretPath(home)]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(`N=${DEFAULT_PARAMS.n},r=${DEFAULT_PARAMS.r},p=${DEFAULT_PARAMS.p},gen=${INITIAL_GENERATION}`);
    // The salt and the hash never leave the process.
    const secret = readAuthSecret(secretPath(home))!;
    expect(r.stdout).not.toContain(secret.saltB64);
    expect(r.stdout).not.toContain(secret.hashB64);
  });

  it('answers UNUSABLE (4) for a garbled file — and quotes NOT ONE BYTE of it', () => {
    // `AuthSecretUnusable`'s message QUOTES THE FIELD IT CHOKED ON — measured:
    //   `unknown prefix "<field 1>" (want "scrypt")`
    //   `N is not a plain decimal integer ("<field>")`
    // — so the content of a file that is not a secret line really can end up
    // in the message, and from there in a doctor transcript that goes into a
    // ticket. The plausible way to get a file here that is not a secret line
    // is a misplaced copy of another one, and both fixtures below are that
    // shape: something secret sitting in a field the parser quotes back.
    // CLAUDE.md: never print secret file CONTENTS.
    const planted = 'PLANTED-SECRET-9f3a2b';
    const shapes = [
      `${planted}$b$c$d$e\n`,                                  // -> unknown prefix "<planted>"
      `scrypt$N=${planted},r=8,p=1$AAAA$BBBB$gen=1\n`,          // -> N is not a plain decimal integer
    ];
    for (const text of shapes) {
      const home = box('ccrc-check-unusable-');
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      writeFileSync(secretPath(home), text);
      const r = runHelper(home, ['--check', secretPath(home)]);
      expect(r.code, text).toBe(4);
      expect(r.stdout).toBe('');
      expect(r.stderr, text).not.toContain(planted);
    }
  });

  it('answers UNUSABLE (4) for a file it cannot READ — present is not absent', () => {
    const home = box('ccrc-check-unreadable-');
    expect(runHelper(home, [secretPath(home)], PASS).code).toBe(0);
    chmodSync(secretPath(home), 0o000);
    try {
      expect(runHelper(home, ['--check', secretPath(home)]).code).toBe(4);
    } finally {
      chmodSync(secretPath(home), 0o600);
    }
  });

  it('answers NO BUILD (5) when the file is there and the reader is not', () => {
    const home = mkTmp('ccrc-check-nomodule-');
    plantAuthHelper(join(home, 'ccrc'));
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(secretPath(home), 'anything at all\n');
    expect(runHelper(home, ['--check', secretPath(home)]).code).toBe(5);
  });

  it('reads nothing from stdin — the doctor calls it with the terminal attached', () => {
    // A `--check` that read stdin would hang doctor forever on an interactive
    // box, and eat a line of the installer on a piped one.
    const home = box('ccrc-check-stdin-');
    const r = runHelper(home, ['--check', secretPath(home)], 'this must not be consumed');
    expect(r.code).toBe(3);
  });
});

// ── the verb, on a real terminal ──────────────────────────────────────────

describe('ccrc passwd', () => {
  it('sets a passphrase typed twice, and says the gate still needs CCRC_AUTH=on', async () => {
    const home = box('ccrc-passwd-tty-ok-');
    const r = await runPasswdTty(home, [PASS, PASS]);
    expect(r.code, r.stdout).toBe(0);
    const secret = readAuthSecret(secretPath(home));
    expect(secret, r.stdout).not.toBeNull();
    expect(await verifyPassphrase(secret!, PASS)).toBe(true);
    expect(secret!.generation).toBe(INITIAL_GENERATION);

    // The three things the success block has to say, because each of them is a
    // way an operator ends up with a box that does not do what they think.
    expect(r.stdout).toMatch(/the gate is still OFF until CCRC_AUTH=on/);
    expect(r.stdout).toMatch(/CCRC_RP_ID and CCRC_ORIGIN in the SAME edit/);
    expect(r.stdout).toMatch(/ENROLLED PASSKEYS ARE NOT/);
    // …and the passphrase itself appears nowhere in the transcript. `read -rs`
    // does not echo, and nothing downstream prints it.
    expect(r.stdout).not.toContain(PASS);
  });

  it('REFUSES a piped passphrase — under `curl … | bash`, stdin is the installer', async () => {
    // The mutation this pins: delete the `[ -t 0 ]` guard and `ccrc passwd`
    // will happily hash whatever arrived on stdin. `install.sh` is documented
    // as `curl … | bash`, where that is the script's own next line.
    const home = box('ccrc-passwd-piped-');
    const r = runPiped(home, ['passwd'], `${PASS}\n${PASS}\n`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: stdin is not a terminal/m);
    expect(r.stderr).toMatch(/curl … \| bash/);
    expect(bytesAt(secretPath(home))).toBeNull();
    expect(ccrcDirEntries(home)).toEqual([]);
  });

  it('refuses when the two entries differ, and writes nothing', async () => {
    const home = box('ccrc-passwd-mismatch-');
    const r = await runPasswdTty(home, [PASS, OTHER]);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/the two entries do not match/);
    expect(bytesAt(secretPath(home))).toBeNull();
  });

  it('refuses a passphrase under the minimum length', async () => {
    const home = box('ccrc-passwd-short-');
    const r = await runPasswdTty(home, ['short', 'short']);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/shorter than 12 characters/);
    expect(bytesAt(secretPath(home))).toBeNull();
  });

  it('reports the MISMATCH first when a short passphrase was also mistyped', async () => {
    // Length before match would tell an operator who fat-fingered the second
    // entry that their FIRST one was too short — a diagnosis about the wrong
    // half of what they did.
    const home = box('ccrc-passwd-order-');
    const r = await runPasswdTty(home, ['short', 'shorter']);
    expect(r.stdout).toMatch(/the two entries do not match/);
    expect(r.stdout).not.toMatch(/shorter than/);
  });

  it('rotates: the second run bumps the generation and the old passphrase stops verifying', async () => {
    const home = box('ccrc-passwd-rotate-');
    expect((await runPasswdTty(home, [PASS, PASS])).code).toBe(0);
    const r = await runPasswdTty(home, [OTHER, OTHER]);
    expect(r.code, r.stdout).toBe(0);
    const secret = readAuthSecret(secretPath(home))!;
    expect(secret.generation).toBe(INITIAL_GENERATION + 1);
    expect(await verifyPassphrase(secret, OTHER)).toBe(true);
    expect(await verifyPassphrase(secret, PASS)).toBe(false);
    // The transcript names the transition, which is the operator's only proof
    // that every session really was expired.
    expect(r.stdout).toMatch(/generation 2 — was generation 1/);
  });

  it('leaves the terminal echoing after a run', async () => {
    // `read -s` restores echo itself on a normal return; the trap is for the
    // Ctrl-C that does not. This measures the state the operator's terminal is
    // left in, which is the thing the trap is about.
    const home = box('ccrc-passwd-echo-');
    await runPasswdTty(home, [PASS, PASS]);
    const r = await new Promise<string>((resolve) => {
      const p = pty.spawn(BASH, ['-c', 'stty -a | tr " " "\\n" | grep -c "^-echo$" || true'],
        { name: 'xterm-color', cols: 80, rows: 24, cwd: home, env: env(home) as Record<string, string> });
      let out = '';
      p.onData((d) => { out += d; });
      p.onExit(() => resolve(out));
    });
    expect(r).toMatch(/^0/);
  });

  it('carries the trap that restores echo — the Ctrl-C case, in the source', () => {
    // The signal path itself cannot be measured through node-pty without
    // racing the prompt, so the mechanism is pinned where it can be: the trap
    // must name all three of EXIT, INT and TERM. A trap on EXIT alone does not
    // fire for the SIGINT that leaves a terminal without echo.
    const src = readFileSync(CCRC_SRC, 'utf8');
    expect(src).toMatch(/trap 'stty echo 2>\/dev\/null' EXIT INT TERM/);
  });

  it('refuses BY NAME when the hasher did not ship beside it', async () => {
    // `ccrc` finds `deploy/gen-auth-hash.mjs` through `${BASH_SOURCE[0]}`, the
    // way it finds every sibling, and bash does not resolve that through a
    // symlink — so an install that copied one file and left the rest is a real
    // state a box can be in.
    const home = mkTmp('ccrc-passwd-nohelper-');
    const ccd = join(home, 'ccrc', 'ccd');
    mkdirSync(ccd, { recursive: true });
    symlinkSync(CCRC_SRC, join(ccd, 'ccrc'));
    const r = await runPasswdTty(home, []);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/ccrc: the passphrase hasher is missing/);
    // …and it refused BEFORE prompting for anything.
    expect(r.stdout).not.toMatch(/New passphrase/);
  });

  it('refuses when node is not on PATH, before any prompt', async () => {
    const home = box('ccrc-passwd-nonode-');
    const r = await new Promise<Result>((resolve) => {
      const p = pty.spawn(BASH, [ccrcIn(home), 'passwd'], {
        name: 'xterm-color', cols: 200, rows: 40, cwd: home,
        env: { ...env(home), PATH: '/nonexistent-ccrc-test-path' } as Record<string, string>,
      });
      let out = '';
      p.onData((d) => { out += d; });
      p.onExit(({ exitCode }) => resolve({ code: exitCode, stdout: out, stderr: '' }));
    });
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/node is required by 'ccrc passwd'/);
    expect(r.stdout).not.toMatch(/New passphrase/);
  });

  it('passwd --bogus is a usage error (exit 2); passwd -h prints usage at exit 0', () => {
    const home = box('ccrc-passwd-args-');
    const bad = runPiped(home, ['passwd', '--bogus']);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/^ccrc: unknown argument: --bogus/m);
    const help = runPiped(home, ['passwd', '-h']);
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/usage: ccrc \{/);
    // -h must not be the tty refusal: asking what a verb does is not running it.
    expect(help.stderr).toBe('');
    expect(ccrcDirEntries(home)).toEqual([]);
  });

  it('the passphrase never reaches argv — the hasher is piped, not called with it', () => {
    // /proc/<pid>/cmdline is world-readable, so a passphrase in argv is a
    // passphrase every user on the box can read for as long as scrypt runs.
    // Pinned in the source, because the alternative — sampling /proc during a
    // ~100ms window — is a race by construction.
    const src = readFileSync(CCRC_SRC, 'utf8');
    expect(src).toMatch(/printf '%s' "\$p1" \| node "\$helper" "\$BOX_AUTH_FILE"/);
    expect(src).not.toMatch(/node "\$helper" "\$BOX_AUTH_FILE" "\$p1"/);
    // …and a here-string is not the substitute: bash implements one with a
    // temp file on disk.
    expect(src).not.toMatch(/node "\$helper" .*<<</);
  });

  it('names ~/.ccrc/auth.scrypt exactly once, and both users go through it', () => {
    // D-88's shape, applied to the secret file: `ccrc` WRITES it (cmd_passwd)
    // and the check table READS it (_check_auth), which is exactly the
    // reader/writer pair that comment warns about — "three copies of a path is
    // how two of them end up reading a file the third does not write", with
    // the added cost here that the third file is a credential. Prose may
    // discuss the path anywhere; a LINE OF SHELL that names it may exist once.
    const code = (f: string): string[] =>
      readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('#'));
    //
    // TWO LINES, NOT ONE, and the second is enumerated rather than exempted:
    // the usage heredoc names the file to the operator, which is prose but is
    // not a `#` comment, so pinning it verbatim is what stops IT drifting away
    // from the declaration above it. A THIRD line naming the path is red.
    expect(code(CCRC_SRC).filter((l) => l.includes('.ccrc/auth.scrypt'))).toEqual([
      'BOX_AUTH_FILE="$HOME/.ccrc/auth.scrypt"',
      "  passwd    set (or rotate) this box's PWA passphrase in ~/.ccrc/auth.scrypt.",
    ]);
    expect(code(join(REPO, 'ccd', 'ccrc-doctor-checks')).filter((l) => l.includes('.ccrc/auth.scrypt')))
      .toEqual([]);
    // …and both really go through the variable, which deleting the path
    // altogether would also satisfy.
    const src = readFileSync(CCRC_SRC, 'utf8');
    const body = /cmd_passwd\(\)[\s\S]*?\n\}/.exec(src);
    expect(body, 'ccd/ccrc has no cmd_passwd').toBeTruthy();
    expect(body![0]).toContain('BOX_AUTH_FILE');
    expect(readFileSync(join(REPO, 'ccd', 'ccrc-doctor-checks'), 'utf8')).toContain('BOX_AUTH_FILE');
  });

  it('the hasher ships in the tree both deploy lanes rsync', () => {
    // `deploy.sh` copies `deploy/` wholesale to `~/ccrc/`, and `_inst_tree`
    // rsyncs the same directory — so the helper is on a box iff it is in the
    // repository at that path. This is the assertion that it is.
    expect(existsSync(HELPER_SRC)).toBe(true);
  });
});
