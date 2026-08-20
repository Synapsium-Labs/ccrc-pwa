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

/**
 * A shell script in ONE pty, driven by a callback that sees the output so far.
 *
 * The `runPasswdTty` above spawns `ccrc` directly, which is right for the
 * prompts and WRONG for anything that asks what state the run left the
 * TERMINAL in: a question about the tty has to be asked on the same tty, by a
 * command that runs after the verb and before the pty is closed. A second,
 * fresh pty always answers "echo is on" no matter what the first one did — a
 * test that cannot fail (this file shipped one, and it is why the Ctrl-C
 * defect below survived a green suite).
 */
function drivePty(home: string, script: string,
  drive: (out: string, write: (s: string) => void) => void): Promise<Result> {
  return new Promise((resolve) => {
    const p = pty.spawn(BASH, ['-c', script], {
      name: 'xterm-color', cols: 200, rows: 40, cwd: home,
      env: env(home) as Record<string, string>,
    });
    let out = '';
    let done = false;
    const finish = (code: number): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout: out, stderr: '' });
    };
    const timer = setTimeout(() => { p.kill(); finish(-1); }, 20_000);
    // Writing to a pty whose child has already exited throws; a driver that
    // keeps typing after a clean abort is the normal case here, not an error.
    const write = (s: string): void => { try { p.write(s); } catch { /* gone */ } };
    p.onData((d) => { out += d; drive(out, write); });
    p.onExit(({ exitCode }) => finish(exitCode));
  });
}

/** The shell around a `ccrc passwd` run that asks the tty two questions after
 *  it: what the verb exited, and whether echo came back. `grep -c` exits 1 on
 *  zero matches, hence the `|| true`; `trap : INT` (a HANDLER, not `''`) keeps
 *  the outer shell alive through the Ctrl-C without making the signal ignored
 *  in the child — an IGNORED disposition is inherited and cannot be re-trapped,
 *  which would disarm the very trap under test. */
const passwdThenTty = (home: string): string =>
  `trap : INT; ${JSON.stringify(ccrcIn(home))} passwd; echo "PASSWD-EXIT:$?"; `
  + "stty -a | tr ' ' '\\n' | grep -c '^-echo$' || true; echo TTY-ASKED";

/** Everything the VERB produced, i.e. up to the marker the shell prints after
 *  it. Anything after that is the outer shell echoing keystrokes at a prompt
 *  that no longer exists, which is not this verb's output. */
function verbOutput(out: string): string {
  const i = out.indexOf('PASSWD-EXIT:');
  if (i === -1) throw new Error(`the run never reached the exit marker:\n${out}`);
  return out.slice(0, i);
}

const passwdExit = (out: string): number =>
  Number(/PASSWD-EXIT:(\d+)/.exec(out)?.[1] ?? NaN);

/** How many `-echo` flags `stty -a` reported IN THAT SAME PTY: 0 means echo is
 *  on. */
const echoOffCount = (out: string): number =>
  Number(/PASSWD-EXIT:\d+\r?\n(\d+)/.exec(out)?.[1] ?? NaN);

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
    // D-126's own pair, measured: `{n: 65536, r: 1}` does not reach the parser
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
    // The remedy names the SESSION FILE too, and that is not thoroughness: the
    // fresh file this produces restarts at INITIAL_GENERATION, which is exactly
    // what a session minted on the box's first passphrase is stamped with — so
    // the `mv` alone would leave those sessions verifying against the new
    // secret, re-creating the very thing the refusal above exists to prevent.
    expect(r.stderr).toMatch(/mv .*auth\.scrypt .*auth\.scrypt\.broken && rm -f ~\/\.ccrc\/sessions\.json && ccrc passwd/);
    expect(r.stderr).toMatch(new RegExp(`restarts at generation ${INITIAL_GENERATION}`));
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

  it('a Ctrl-C at the prompt ABORTS — it does not turn echo back on and keep reading', async () => {
    // ── THE DEFECT THIS PINS, MEASURED AGAINST THE SHIPPED VERB ──────────
    // Bash RESTARTS an interrupted `read` after running a trapped handler. A
    // handler that only re-enables echo therefore hands control back to the
    // still-running prompt with echo ON, and the operator — who has just been
    // told "Ctrl-C aborts" — types their passphrase in CLEARTEXT into the
    // terminal and the scrollback. Captured, before the fix:
    //
    //   New passphrase (at least 12 characters): VISIBLE-PASSPHRASE
    //   Repeat it:                                     <- accepted, exit 0
    //
    // …and the box was credentialed anyway. Without ANY trap the same Ctrl-C
    // kills the script cleanly, so the trap added to protect the terminal was
    // the thing that broke the abort. The fix is two traps: EXIT restores
    // echo, INT/TERM restore it and LEAVE (130 = 128+SIGINT).
    //
    // ONE PTY, and that is the whole reason this test can fail at all. The
    // three assertions below are made on the same terminal the verb ran on,
    // and the decisive ones are the passphrase and the exit code: `stty` alone
    // reports "echo on" in BOTH the fixed and the broken run (the broken one
    // re-enabled it — that IS the bug), which is exactly how the earlier,
    // separate-pty version of this test passed for the wrong reason.
    const home = box('ccrc-passwd-sigint-');
    const typed = 'VISIBLE-PASSPHRASE';
    let interrupted = false;
    const r = await drivePty(home, passwdThenTty(home), (out, write) => {
      if (!interrupted && /New passphrase/.test(out)) {
        interrupted = true;
        write('\x03');
        // Then keep typing, as an operator who believes the prompt is gone
        // would. With the fix these land after the verb has exited and are
        // sliced off by `verbOutput`; without it they are read and hashed.
        setTimeout(() => write(`${typed}\r`), 400);
        setTimeout(() => write(`${typed}\r`), 800);
      }
    });
    const verb = verbOutput(r.stdout);
    expect(verb, 'the passphrase was echoed into the terminal').not.toContain(typed);
    expect(passwdExit(r.stdout), verb).toBe(130);
    expect(echoOffCount(r.stdout), 'echo was left off on the operator\'s terminal').toBe(0);
    // …and an interrupted run is not a run: nothing was written.
    expect(bytesAt(secretPath(home))).toBeNull();
    expect(ccrcDirEntries(home)).toEqual([]);
  });

  it('leaves the terminal echoing after a NORMAL run, asked on that same terminal', async () => {
    // `read -s` restores echo itself on a normal return, so this is the weaker
    // half of the pair — but it is no longer vacuous: it asks the tty the verb
    // actually ran on, so a `read -s` whose restore stopped happening (or an
    // EXIT trap deleted) is red here.
    const home = box('ccrc-passwd-echo-');
    let sent = 0;
    const r = await drivePty(home, passwdThenTty(home), (out, write) => {
      const prompts = (out.match(/(New passphrase|Repeat it)/g) ?? []).length;
      while (sent < prompts && sent < 2) { sent++; write(`${PASS}\r`); }
    });
    expect(passwdExit(r.stdout), r.stdout).toBe(0);
    expect(echoOffCount(r.stdout)).toBe(0);
    expect(verbOutput(r.stdout)).not.toContain(PASS);
  });

  it('carries BOTH traps — the EXIT one restores echo, the INT one leaves', () => {
    // The behavioural test above is the mechanism; this is the shape, pinned
    // so the two-trap split cannot be "simplified" back into the one-liner
    // that caused the disclosure. An INT handler without an `exit` is the
    // defect, whatever else it does.
    const src = readFileSync(CCRC_SRC, 'utf8');
    expect(src).toMatch(/trap 'stty echo 2>\/dev\/null' EXIT\n/);
    expect(src).toMatch(/trap 'stty echo 2>\/dev\/null; printf "\\n" >&2; exit 130' INT TERM/);
    expect(src).not.toMatch(/trap 'stty echo 2>\/dev\/null' EXIT INT TERM/);
  });

  it('reads with IFS= — a passphrase with leading or trailing spaces is not silently trimmed', async () => {
    // MEASURED: `read -rs x` on "  spaced pass  " yields "spaced pass";
    // `IFS= read -rs x` preserves it. Both entries are trimmed identically, so
    // the confirmation still matches, the file written is perfectly valid and
    // doctor PASSes — while the browser sends the raw string, which no longer
    // verifies. A lockout with no red anywhere, which is why this is measured
    // through the FILE rather than through the transcript.
    const home = box('ccrc-passwd-ifs-');
    const spaced = '  spaced pass phrase  ';
    const r = await runPasswdTty(home, [spaced, spaced]);
    expect(r.code, r.stdout).toBe(0);
    const secret = readAuthSecret(secretPath(home))!;
    expect(await verifyPassphrase(secret, spaced)).toBe(true);
    expect(await verifyPassphrase(secret, spaced.trim())).toBe(false);
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

  it('WRITES the overridden path when ccrc.env redirects the secret, and says so', async () => {
    // ── THE SILENT SECURITY NO-OP THIS CLOSES ────────────────────────────
    // `config.ts:339` is `env.CCRC_AUTH_SECRET_PATH || <default>`. With the
    // override set and a valid file at it, a `passwd` that wrote the DEFAULT
    // would leave the server reading the old secret, report success, and let
    // doctor PASS on the file it had just written. An operator rotating after
    // a compromise would get a green transcript over a live, unchanged
    // credential. Both tools resolve through one function (`_box_auth_path`).
    const home = box('ccrc-passwd-override-');
    const elsewhere = join(home, 'secrets', 'gate.scrypt');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), `CCRC_AUTH_SECRET_PATH=${elsewhere}\n`);
    const r = await runPasswdTty(home, [PASS, PASS]);
    expect(r.code, r.stdout).toBe(0);
    const secret = readAuthSecret(elsewhere);
    expect(secret, r.stdout).not.toBeNull();
    expect(await verifyPassphrase(secret!, PASS)).toBe(true);
    // The default path was NOT written — nothing on this box should be able to
    // hold two secrets and disagree about which is live.
    expect(bytesAt(secretPath(home))).toBeNull();
    // …and the redirect is NAMED. A tool writing a credential somewhere other
    // than the documented path must never do it silently.
    expect(r.stdout).toContain('CCRC_AUTH_SECRET_PATH');
    expect(r.stdout).toContain(elsewhere);
  });

  it('REFUSES a relative override before prompting, rather than writing a file nobody can identify', async () => {
    const home = box('ccrc-passwd-override-rel-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_AUTH_SECRET_PATH=secrets/gate.scrypt\n');
    const r = await runPasswdTty(home, [PASS, PASS]);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/RELATIVE path \(secrets\/gate\.scrypt\)/);
    expect(r.stdout).not.toMatch(/New passphrase/);       // refused BEFORE the prompt
    expect(bytesAt(secretPath(home))).toBeNull();
  });

  it('an EMPTY override is absent — the bare `KEY=` rule, on the path this time', async () => {
    const home = box('ccrc-passwd-override-empty-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_AUTH_SECRET_PATH=\n');
    const r = await runPasswdTty(home, [PASS, PASS]);
    expect(r.code, r.stdout).toBe(0);
    expect(readAuthSecret(secretPath(home))).not.toBeNull();
    expect(r.stdout).not.toContain('CCRC_AUTH_SECRET_PATH');
  });

  it('refuses a box with NO SERVER BUILD before prompting, not after two entries', async () => {
    // This file's own rule, three probes deep: `node` and the hasher are both
    // checked BY NAME before any prompt, because a refusal that arrives after
    // an operator has typed a passphrase twice is a refusal about the wrong
    // thing at the wrong time. The hasher imports the server's compiled
    // reader, so "this box has no server build" — the FLEET HOST's case — is
    // the same class and gets the same treatment, through `--probe` so the
    // dist path keeps one home.
    const home = mkTmp('ccrc-passwd-nobuild-');
    const ccd = join(home, 'ccrc', 'ccd');
    mkdirSync(ccd, { recursive: true });
    symlinkSync(CCRC_SRC, join(ccd, 'ccrc'));
    plantAuthHelper(join(home, 'ccrc'));                 // …and no plantAuthModule
    const r = await runPasswdTty(home, [PASS, PASS]);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/no compiled reader at .*secret\.js/);
    expect(r.stdout).toMatch(/cannot load the server's own secret reader/);
    expect(r.stdout).not.toMatch(/New passphrase/);
    expect(ccrcDirEntries(home)).toEqual([]);
  });

  it('--probe answers 0 with a build and 5 without, reading nothing', () => {
    const built = box('ccrc-probe-ok-');
    expect(runHelper(built, ['--probe'], 'must not be consumed').code).toBe(0);
    const bare = mkTmp('ccrc-probe-nobuild-');
    plantAuthHelper(join(bare, 'ccrc'));
    const r = runHelper(bare, ['--probe']);
    expect(r.code).toBe(5);
    expect(r.stderr).toMatch(/no compiled reader at /);
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
    expect(src).toMatch(/printf '%s' "\$p1" \| node "\$helper" "\$target"/);
    expect(src).not.toMatch(/node "\$helper" "\$target" "\$p1"/);
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
    // Both consumers reach the path through ONE resolver, which is what makes
    // the CCRC_AUTH_SECRET_PATH override impossible to honour in one place and
    // ignore in the other.
    const body = /cmd_passwd\(\)[\s\S]*?\n\}/.exec(src);
    expect(body, 'ccd/ccrc has no cmd_passwd').toBeTruthy();
    expect(body![0]).toContain('_box_auth_path');
    // ONE RESOLVER, TWO CALLERS (D-148). The three-way rule (default / absolute
    // override / relative refusal) is written once in `_box_path_for`, and each
    // caller is a one-liner naming only its key and its default — so the
    // secret's path and the session store's cannot come to hold different
    // opinions about the same rule, which is what happened when the remedy
    // resolved one and hard-coded the other. Pinned by exact content, the way
    // the two lines above are.
    expect(src).toContain('_box_auth_path()     { _box_path_for CCRC_AUTH_SECRET_PATH "$BOX_AUTH_FILE"; }');
    expect(src).toContain('_box_sessions_path() { _box_path_for CCRC_SESSIONS_PATH "$BOX_SESSIONS_FILE"; }');
    const checks = readFileSync(join(REPO, 'ccd', 'ccrc-doctor-checks'), 'utf8');
    expect(/_check_auth\(\) \{[\s\S]*?\n\}/.exec(checks)?.[0]).toContain('_box_auth_path');
  });

  it('names ~/.ccrc/sessions.json exactly once too — the D-148 half', () => {
    // The same D-88 shape for the second path, and the reason it needs its own
    // guard: doctor's `auth` remedy NAMES the session file, and it named it as a
    // literal while resolving the secret beside it through `_box_auth_path`. A
    // literal anywhere but the declaration is how that comes back.
    const code = (f: string): string[] =>
      readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('#'));
    expect(code(CCRC_SRC).filter((l) => l.includes('.ccrc/sessions.json'))).toEqual([
      'BOX_SESSIONS_FILE="$HOME/.ccrc/sessions.json"',
    ]);
    expect(code(join(REPO, 'ccd', 'ccrc-doctor-checks')).filter((l) => l.includes('.ccrc/sessions.json')))
      .toEqual([]);
    const checks = readFileSync(join(REPO, 'ccd', 'ccrc-doctor-checks'), 'utf8');
    expect(/_check_auth\(\) \{[\s\S]*?\n\}/.exec(checks)?.[0]).toContain('_box_sessions_path');
  });

  it('the hasher ships in the tree both deploy lanes rsync', () => {
    // `deploy.sh` copies `deploy/` wholesale to `~/ccrc/`, and `_inst_tree`
    // rsyncs the same directory — so the helper is on a box iff it is in the
    // repository at that path. This is the assertion that it is.
    expect(existsSync(HELPER_SRC)).toBe(true);
  });
});
