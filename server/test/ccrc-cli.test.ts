// ccd/ccrc — Task 1 of the stage-2b ccrc-cli-and-doctor plan: the dispatch
// skeleton, the `version` verb, and usage/argument handling for the new
// lifecycle CLI. `doctor`, `status` and `adopt` were reserved verb NAMES that
// task did not implement — dispatching to one of them was its own, deliberately
// distinct, refusal (exit 1, "not implemented yet") from an unrecognised verb
// (exit 2, a USAGE error). All three have since graduated: `doctor` in Task 4
// and `status` in Task 7 (both pinned by server/test/ccrc-doctor.test.ts), and
// `adopt` in Task 8, pinned by the `ccrc: adopt` block below. The
// "not implemented yet" register has no caller left and is gone from `ccrc`
// with the last verb that used it — a refusal nothing can reach is a comment.
//
// Harness: mkTmp + a hand-rolled runCcrcRaw/runCcrc pair, copied in shape
// from ccrc-adopt's own (server/test/adopt.test.ts:33-44) — NOT
// makeCcdHarness, for the same reason adopt's suite does not use it either:
// these tests only exercise the dispatch/usage/version surface, which needs
// nothing a populated fleet HOME (registry, roster, wrappers) would provide,
// so a throwaway HOME from mkTmp is the whole fixture.
//
// It takes ONE thing from that harness: `ghContainedEnv`'s poisoned `gh`. The
// original sentence here claimed this file needed no part of a fleet HOME
// "including the gh poison" — Task 4 measured that to be false, and the runner
// below carries the correction and the reason.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CCRC = path.resolve(here, '..', '..', 'ccd', 'ccrc');

interface Result { code: number; stdout: string; stderr: string }

/** Runs the CLI exactly as an operator does: `bash ccd/ccrc`, HOME pointed at
 *  a throwaway fixture. Never throws on a nonzero exit — several tests below
 *  exercise refusal paths (unknown verb, unreadable stamp) and need the exit
 *  code and stderr as data, not as a thrown Error.
 *
 *  `ghContainedEnv` (Task 4) plants a POISONED `gh` at `<home>/.local/bin` and
 *  PREPENDS that directory to PATH, so the real `gh` — which on the fleet box
 *  carries a repo-WRITE token — cannot be reached from this file no matter
 *  which verb a test dispatches. It is not decoration: this runner used to pass
 *  the real PATH straight through, and the moment Task 4 implemented `doctor`
 *  the (by then stale) "not implemented yet" case below started executing the
 *  real `gh auth status` on every suite run. It was harmless only because the
 *  fixture HOME left gh no credential to resolve — i.e. the OTHER boundary
 *  saved it, which is exactly the accident CLAUDE.md means when it says gh
 *  containment here is "per-test, not structural".
 *
 *  This is now applied at the RUNNER rather than per test, because `ccrc` grows
 *  verbs that shell out: `status` (Task 7) and `adopt` (Task 8) both arrive
 *  through this same function, and neither should have to remember. The rest of
 *  PATH is left intact deliberately — `ccrc version` genuinely needs `jq`, and
 *  a fixture-only PATH would test a box nobody runs. */
function runCcrcRaw(home: string, args: string[] = []): Result {
  const r = spawnSync('bash', [CCRC, ...args], { env: ccrcEnv(home), encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Named, and separated from the spawn above, for one reason: it is the thing
 *  the containment tests at the bottom of this file assert on. A guard nothing
 *  can go red for is a comment.
 *
 *  TWO poisons now, planted in the same directory and for the same reason.
 *  `ghContainedEnv` supplies `gh`; `curl` is planted here because Task 7's
 *  `status` verb ASKS A SERVER over HTTP (`GET /api/fleet/health`), and the
 *  server this box is configured to talk to is a live production one. Neither
 *  poison is per-test: `status` and `adopt` arrive through this one runner, and
 *  a containment that each test has to remember is the containment that was
 *  already missing for `gh` when `doctor` landed. */
function ccrcEnv(home: string): NodeJS.ProcessEnv {
  const env = ghContainedEnv(home, { ...process.env, HOME: home });
  const poison = (name: string, says: string): void =>
    writeFileSync(join(home, '.local', 'bin', name),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\n`
      + `echo "${says}" >&2\nexit 97\n`, { mode: 0o755 });
  poison('curl', 'ccrc tests must never reach a real server');
  // `systemctl` for the same reason and a sharper one: this runner keeps the
  // REAL PATH, so `status` was executing `systemctl --user is-active` against
  // THIS PRODUCTION BOX on every suite run (round-2 review, Minor 4). It is a
  // read-only query and nothing was asserted on its answer, which is exactly
  // why nobody noticed — and "harmless today" is not containment. The doctor
  // suite reaches no system directory at all; this one now cannot reach these
  // three binaries either.
  poison('systemctl', 'ccrc tests must never query this box\'s real systemd');
  // The verbs read their own environment, and this runner inherits the ambient
  // one wholesale. An operator (or a parent agent) with CCRC_ADDR exported
  // would hand `status` a real address and turn the "leaves the box alone" test
  // below red — a flake that depends on who ran the suite. Every CCRC_* input
  // this CLI reads is removed by name, so the fixture decides, never the shell.
  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_DOCTOR_GH_TIMEOUT']) delete env[k];
  return env;
}

/** Every argv a poisoned binary saw. Empty means nothing tried to leave the
 *  fixture — which is what every test in this file except two expects. */
const poisonLog = (home: string, name: string): string[] => {
  const p = join(home, `${name}-poison`);
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
const curlPoison = (home: string): string[] => poisonLog(home, 'curl');

/** The brief's own shape: returns stdout, throwing (with stderr attached) on
 *  a nonzero exit — for the tests that only care about the happy path. */
function runCcrc(home: string, args: string[] = []): string {
  const r = runCcrcRaw(home, args);
  if (r.code !== 0) throw new Error(`ccrc exited ${r.code}\n${r.stderr}`);
  return r.stdout;
}

describe('ccrc: dispatch and usage', () => {
  it('prints usage on stderr and exits 2 on an unknown verb', () => {
    // Exit 2 is the house code for a USAGE error, distinct from 1 = the tool
    // ran and the answer was bad. Both ccrc-adopt (:68-91) and
    // verify-service.sh (:50-54) use it; doctor needs 1 free to mean "checks
    // failed".
    const home = mkTmp('ccrc-cli-unknown-');
    const r = runCcrcRaw(home, ['wat']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: wat/m);
    expect(r.stderr).toMatch(/usage: ccrc/);
  });

  it('-h prints usage on STDOUT and exits 0 — asking for help is not an error', () => {
    const home = mkTmp('ccrc-cli-help-');
    const r = runCcrcRaw(home, ['-h']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/usage: ccrc/);
  });

  it('--help does the same as -h', () => {
    const home = mkTmp('ccrc-cli-help-long-');
    const r = runCcrcRaw(home, ['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/usage: ccrc/);
  });

  it('the usage line names every verb this CLI will have', () => {
    // `wrappers` joined the list in stage 2c Task 6 — the converger that writes
    // ~/.local/bin/<id> from the roster. A verb that dispatches but is not in
    // the usage line is a verb nobody can find; `server/test/ccrc-wrappers.test.ts`
    // owns its behaviour, this line owns its discoverability.
    //
    // `install` joined it in stage 2d Task 6 — the verb the whole CLI is named
    // for, and the one an operator reaches for FIRST, before there is anything
    // on the box for the other five to measure. Same split: this line owns its
    // discoverability, `server/test/ccrc-install.test.ts` owns what it does.
    //
    // `passwd` joined it in stage 3a Task 9 — the ONE writer of
    // `~/.ccrc/auth.scrypt`, and the only way to set the passphrase the PWA's
    // session gate checks a login against. A verb that dispatches and is not
    // in this line is a verb nobody can find, and this one is the operator's
    // only recovery path from a box they cannot log into:
    // `server/test/ccrc-passwd.test.ts` owns what it does.
    //
    // `update` joined it in stage 4 Task 6 — fetch + verify a published
    // release, back up, re-run the install spine from the verified staged
    // tree. Same split again: `server/test/ccrc-update.test.ts` owns what it
    // does, this line owns that an operator can find it.
    const home = mkTmp('ccrc-cli-usage-verbs-');
    const r = runCcrcRaw(home, ['-h']);
    expect(r.stdout).toMatch(/usage: ccrc \{doctor\|status\|adopt\|wrappers\|install\|update\|passwd\|version\}/);
    expect(r.stdout).toMatch(/^ {2}update {4}fetch a published release/m);
    // …and the body explains it, including the half an operator gets wrong:
    // rotating expires SESSIONS and leaves enrolled passkeys working.
    expect(r.stdout).toMatch(/^ {2}passwd {4}set \(or rotate\) this box's PWA passphrase/m);
    expect(r.stdout).toMatch(/CCRC_AUTH=on/);
    expect(r.stdout).toMatch(/enrolled passkeys keep working/);
  });

  // ── install's ARGUMENT surface ──────────────────────────────────────────
  // The two halves of the flag-ful-verb rule (`cmd_wrappers`' loop,
  // ccd/ccrc:1040-1048), pinned here beside the other dispatch tests rather
  // than in the install suite: neither of these reaches a step function, so
  // neither needs — or may have — a shipped tree to converge from. What they
  // are about is the DISPATCHER, which is this file's subject.
  it('install -h prints usage on STDOUT at exit 0 — a verb with flags explains them', () => {
    // `version` answers `--help` with a usage ERROR (exit 2) because it has no
    // flags to explain; `install` follows `wrappers` instead, and for the same
    // reason: it is the verb an operator asks about before running it, on a box
    // where running it is the thing they are unsure of.
    const home = mkTmp('ccrc-cli-install-help-');
    const r = runCcrcRaw(home, ['install', '-h']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/usage: ccrc \{/);
    // …and it exits BEFORE the first step: `-h` on a fresh HOME must not seed
    // that HOME. A help screen with a side effect is not a help screen.
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
  });

  it('install --bogus is a usage error, exit 2 — not a step that quietly ran', () => {
    const home = mkTmp('ccrc-cli-install-badarg-');
    const r = runCcrcRaw(home, ['install', '--bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --bogus/m);
    expect(r.stderr).toMatch(/usage: ccrc/);
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
  });

  it('an unknown top-level flag is a usage error too, before any verb is read', () => {
    const home = mkTmp('ccrc-cli-unknown-flag-');
    const r = runCcrcRaw(home, ['--nope']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --nope/m);
    expect(r.stderr).toMatch(/usage: ccrc/);
  });

  it('running with no verb at all is a usage error, not a silent no-op', () => {
    const home = mkTmp('ccrc-cli-no-verb-');
    const r = runCcrcRaw(home, []);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/usage: ccrc/);
  });
});

describe('ccrc: adopt', () => {
  // Task 8. `adopt` is the LAST verb to graduate out of "not implemented yet",
  // and it graduates by becoming what it always named: `ccd/ccrc-adopt`, the
  // tool that rediscovers a hand-built box's accounts from disk. `ccrc` does
  // not re-implement any of it — it execs the sibling that ships beside it, so
  // there is one adopt, reachable by one name, on a box and in a checkout.
  //
  // WHY EXEC RATHER THAN SOURCE: adopt runs `set -euo pipefail` and is a
  // straight-line "measure, or die" pipeline (its own header explains why that
  // is right for it and wrong for doctor). Sourcing it would put `-e` into the
  // shell doctor deliberately keeps it out of, and its `exit`s would become
  // ccrc's. Exec keeps the two exit-code tables — which already agree, 0/1/2
  // meaning the same three things in both files — as one process's.
  it('--help reaches ccrc-adopt\'s OWN usage at exit 0 — the verb passes argv through', () => {
    const home = mkTmp('ccrc-cli-adopt-help-');
    const r = runCcrcRaw(home, ['adopt', '--help']);
    expect(r.code).toBe(0);
    // ccrc-adopt's usage, not ccrc's: proof the flag reached the sibling
    // rather than being eaten by the dispatcher.
    expect(r.stdout).toMatch(/usage: ccrc-adopt \[--out PATH\] \[--force\]/);
    expect(r.stdout).not.toMatch(/usage: ccrc \{/);
  });

  it('an unknown argument is the SIBLING\'s usage error, exit 2 — the code is not flattened', () => {
    // The two files share one exit-code table (0 success, 1 the tool ran and
    // the answer was bad, 2 a usage error). A verb that ran the sibling in a
    // subshell and returned its own code would collapse that.
    const home = mkTmp('ccrc-cli-adopt-badarg-');
    const r = runCcrcRaw(home, ['adopt', '--nope']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc-adopt: unknown argument: --nope$/m);
  });

  it('really runs the sibling against THIS box, and answers in ccrc-adopt\'s own voice', () => {
    // The fixture HOME's `.local/bin` holds only this suite's poisons (gh,
    // curl, systemctl) — id-shaped executables that set no CLAUDE_CONFIG_DIR
    // — so adopt gets as far as its "nothing to adopt" refusal. That refusal
    // is the evidence: it can only come from ccrc-adopt having actually run.
    const home = mkTmp('ccrc-cli-adopt-run-');
    const r = runCcrcRaw(home, ['adopt']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc-adopt: no script under .*sets CLAUDE_CONFIG_DIR/m);
    expect(r.stdout).toBe('');
  });

  it('drives the WHOLE of adopt — discovery, cross-checks and self-validation', () => {
    // The verb is only as real as the last line of the tool it hands over to,
    // so this runs a synthetic box all the way to adopt's final gate: a
    // non-script upstream binary plus one wrapper in the generated shape, in a
    // copy of the ccd/ directory that has NO `../deploy/gen-accounts.mjs`
    // beside it. Adopt gets as far as self-validation and refuses there —
    // which is the deepest point reachable without a checkout, and proof that
    // every earlier pass ran under `ccrc adopt` exactly as it does under
    // `bash ccd/ccrc-adopt` (server/test/adopt.test.ts owns the happy path).
    //
    // It also pins the refusal's WORDING. `gen-accounts.mjs` resolves one
    // directory up from adopt itself, which is true both in a checkout and at
    // `~/ccrc/deploy` on a deployed box — so the message may no longer ask
    // whether this is "a full ccrc-pwa checkout": Task 8 made `ccrc adopt`
    // reachable on a box that never was one.
    const kit = mkTmp('ccrc-cli-adopt-kit-');
    for (const f of ['ccrc', 'ccrc-adopt', 'ccrc-wrapper-shape']) {
      writeFileSync(join(kit, f), readFileSync(join(path.dirname(CCRC), f), 'utf8'), { mode: 0o755 });
    }
    const home = mkTmp('ccrc-cli-adopt-deep-');
    const env = ccrcEnv(home);                       // plants the poisons in .local/bin
    const bin = join(home, '.local', 'bin');
    writeFileSync(join(bin, 'claude'), '\x7fELF not-a-script\n', { mode: 0o755 });
    writeFileSync(join(bin, 'ccx'),
      '#!/usr/bin/env bash\nexport CLAUDE_CONFIG_DIR="$HOME/.claude-x"\nexec "$HOME/.local/bin/claude" "$@"\n',
      { mode: 0o755 });

    const r = spawnSync('bash', [join(kit, 'ccrc'), 'adopt'], { env, encoding: 'utf8' });
    expect(r.stderr).toMatch(/^ccrc-adopt: upstream account "claude"/m);   // pass 3 ran
    expect(r.stderr).toMatch(/cross-check: adopt discovered "ccx"/);       // the cross-checks ran
    expect(r.stderr).toMatch(/^ccrc-adopt: cannot self-validate: .*gen-accounts\.mjs is missing/m);
    expect(r.stderr, 'the refusal must not ask a deployed box whether it is a checkout')
      .not.toMatch(/is this a full ccrc-pwa checkout/);
    expect(r.stderr).toContain('~/ccrc/deploy');
    expect(r.status).toBe(1);
    // Nothing was written: adopt's one write is behind the gate it just failed.
    expect(existsSync(join(home, '.ccrc', 'accounts.json'))).toBe(false);
  });

  it('refuses BY NAME when the sibling is not installed beside it', () => {
    // `ccrc` finds `ccrc-adopt` through `${BASH_SOURCE[0]}`, exactly as it
    // finds `ccrc-doctor-checks`, and for the same reason: bash does not
    // resolve that through a symlink, so an install that copies one file and
    // leaves the rest behind is a real state a box can be in. It must say
    // which file is missing, not "command not found" or a silent skip.
    const lone = join(mkTmp('ccrc-cli-adopt-lonely-'), 'ccrc');
    writeFileSync(lone, readFileSync(CCRC, 'utf8'), { mode: 0o755 });
    const home = mkTmp('ccrc-cli-adopt-lonely-home-');
    const r = spawnSync('bash', [lone, 'adopt'], { env: ccrcEnv(home), encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: adopt's script is missing/m);
    expect(r.stderr).toContain('ccrc-adopt');
  });

  it('resolves its own location via BASH_SOURCE, not $0+dirname — a lying dirname on PATH cannot derail a symlinked invocation', () => {
    // Task 1 of stage2d's brief predicted that invoking ccrc-adopt through a
    // bare symlink (`ln -s <checkout>/ccd/ccrc-adopt <home>/elsewhere/ccrc-adopt`)
    // would move GEN_ACCOUNTS from "beside the symlink" to "beside the real
    // file" once HERE stopped using `$0`. MEASURED, by hand, against both the
    // shipped script and a copy with the fix applied: it does not. Bash never
    // dereferences BASH_SOURCE[0] (or $0) through a symlink for a
    // directly-invoked, non-sourced script — `dirname "$0"` and
    // `${_ADOPT_SELF%/*}` compute the IDENTICAL string for a plain symlink
    // invocation, before AND after this fix, and both refuse self-validation
    // naming "<home>/elsewhere/../deploy/gen-accounts.mjs" (beside the
    // symlink) either way. That prediction does not hold, so this test pins
    // the property the fix ACTUALLY changes — the one its own comment names,
    // "dirname is a PATH lookup": HERE no longer depends on an external
    // `dirname` command being on PATH at all, only on bash's own
    // BASH_SOURCE/parameter-expansion machinery, which the wrapper-shape load
    // three lines above it already relies on.
    //
    // MEASURED RED (before the fix, by hand against the shipped script): with
    // a `dirname` on PATH that lies (prints a nonexistent path) shadowing the
    // real one, `HERE="$(cd "$(dirname "$0")" && pwd)"` sent `cd` into that
    // nonexistent directory and the script died with a raw bash error —
    // "ccrc-adopt: line 124: cd: /nonexistent-garbage-from-a-lying-dirname:
    // No such file or directory" — never reaching ccrc-adopt's own refusal
    // voice at all.
    const elsewhere = join(mkTmp('ccrc-cli-adopt-here-kit-'), 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    const ccdDir = path.dirname(CCRC);
    symlinkSync(join(ccdDir, 'ccrc-adopt'), join(elsewhere, 'ccrc-adopt'));
    symlinkSync(join(ccdDir, 'ccrc-wrapper-shape'), join(elsewhere, 'ccrc-wrapper-shape'));

    const home = mkTmp('ccrc-cli-adopt-here-home-');
    const env = ccrcEnv(home);                        // plants gh/curl/systemctl poisons in .local/bin
    const bin = join(home, '.local', 'bin');
    writeFileSync(join(bin, 'claude'), '\x7fELF not-a-script\n', { mode: 0o755 });
    writeFileSync(join(bin, 'ccx'),
      '#!/usr/bin/env bash\nexport CLAUDE_CONFIG_DIR="$HOME/.claude-x"\nexec "$HOME/.local/bin/claude" "$@"\n',
      { mode: 0o755 });

    // A `dirname` that lies, first on PATH — the property under test.
    const lyingBin = join(home, 'lying-bin');
    mkdirSync(lyingBin, { recursive: true });
    writeFileSync(join(lyingBin, 'dirname'),
      '#!/bin/sh\necho /nonexistent-garbage-from-a-lying-dirname\n', { mode: 0o755 });

    const r = spawnSync(join(elsewhere, 'ccrc-adopt'), ['--out', join(home, 'accounts.json')],
      { env: { ...env, PATH: `${lyingBin}:${env['PATH'] ?? ''}` }, encoding: 'utf8' });

    expect(r.stderr).not.toMatch(/No such file or directory/);
    expect(r.stderr).toMatch(/^ccrc-adopt: cannot self-validate: .*gen-accounts\.mjs is missing/m);
    expect(r.status).toBe(1);
  });
});

describe('ccrc: version', () => {
  it('version reports the build stamp, and says "unstamped" at exit 0 when there is none', () => {
    // NOTE: the brief's own snippet reads `runCcrc(home, ['version']).stdout`
    // — but the same brief also says to model runCcrcRaw/runCcrc exactly on
    // adopt.test.ts:33-44, where the non-raw `runAdopt` returns a plain
    // string (`r.stdout`), not an object; every other call site in
    // adopt.test.ts uses it that way (e.g. `parseRoster(JSON.parse(runAdopt(home)))`).
    // Followed that concrete, checked-in precedent over the snippet's stray
    // `.stdout`, so runCcrc below returns a string and is asserted on directly.
    const home = mkTmp('ccrc-cli-version-');
    expect(runCcrc(home, ['version'])).toMatch(/unstamped/);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'abc123', ref: 'main', builtAt: '2026-08-15T00:00:00Z', dirty: false }));
    expect(runCcrc(home, ['version'])).toContain('abc123');
  });

  it('reports "dirty" only when the stamp says so', () => {
    const home = mkTmp('ccrc-cli-version-dirty-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'deadbee', ref: 'feat/x', builtAt: '2026-08-15T01:00:00Z', dirty: true }));
    expect(runCcrc(home, ['version'])).toMatch(/dirty/);
  });

  it('a clean build (dirty: false) is not misreported as unreadable — jq -e would trip on this', () => {
    // Regression guard: `.dirty` is a real boolean that is legitimately
    // `false` on a clean build. A version of cmd_version built on `jq -e`
    // (which treats a `false`/`null` last output as failure) would refuse
    // every clean build stamp, not just garbage ones.
    const home = mkTmp('ccrc-cli-version-clean-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'c1ean00', ref: 'main', builtAt: '2026-08-15T02:00:00Z', dirty: false }));
    const r = runCcrcRaw(home, ['version']);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toMatch(/dirty/);
  });

  it('prints a "version vX.Y.Z" line iff the stamp carries one', () => {
    // Stage 4, Task 1: the release tag rides in build.json as an additive
    // fifth field. Present -> its own line; absent -> NO line, and the rest of
    // the output is unchanged (every stamp already on a box omits it).
    const home = mkTmp('ccrc-cli-version-tag-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'abc123', ref: 'main', builtAt: '2026-08-21T00:00:00Z', dirty: false, version: 'v1.2.3' }));
    const tagged = runCcrc(home, ['version']);
    expect(tagged).toMatch(/^version v1\.2\.3$/m);
    expect(tagged).toContain('abc123');
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'abc123', ref: 'main', builtAt: '2026-08-21T00:00:00Z', dirty: false }));
    const untagged = runCcrc(home, ['version']);
    expect(untagged).not.toMatch(/^version /m);
    expect(untagged).toContain('abc123');
  });

  it('a present-but-invalid version is an unreadable stamp — same whole-or-nothing rule as the TS parser', () => {
    // `shared/buildinfo.ts` rejects `version: ""` (no stamper writes one), and
    // the jq reader must agree with it — two validators that disagree about
    // what a well-formed stamp is would have `ccrc version` printing a stamp
    // the server refuses to serve.
    const home = mkTmp('ccrc-cli-version-emptytag-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'abc123', ref: 'main', builtAt: '2026-08-21T00:00:00Z', dirty: false, version: '' }));
    const r = runCcrcRaw(home, ['version']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: build stamp unreadable/m);
  });

  it('refuses a stamp that exists but does not parse, rather than printing a version nobody measured', () => {
    const home = mkTmp('ccrc-cli-version-garbage-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), 'not json');
    const r = runCcrcRaw(home, ['version']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: build stamp unreadable/m);
  });

  it('refuses a stamp that parses as JSON but is missing a required field', () => {
    const home = mkTmp('ccrc-cli-version-missing-field-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'abc123', ref: 'main' })); // no builtAt, no dirty
    const r = runCcrcRaw(home, ['version']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: build stamp unreadable/m);
  });

  it('refuses a stamp whose ref carries a NEWLINE rather than printing half a version', () => {
    // The reader hands its caller four fields as four lines plus an `END`
    // sentinel, so a newline inside a field silently shifts every field after
    // it — `ref` would arrive as the builtAt, and `dirty` as nothing at all.
    // The sentinel is what makes that loud instead of quietly wrong.
    const home = mkTmp('ccrc-cli-version-nl-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'abc123', ref: 'ma\nin', builtAt: '2026-08-15T00:00:00Z', dirty: false }));
    const r = runCcrcRaw(home, ['version']);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ccrc: build stamp unreadable/m);
  });

  it('refuses a stamp carrying any other control byte too — a printed sha must not be able to lie', () => {
    // `abc\b123` renders as `ab123` on a terminal that acts on the backspace,
    // so a stamp could print a sha that is not the one in the file. Same rule
    // `_check_wrappers` applies to roster ids, for the same reason.
    const home = mkTmp('ccrc-cli-version-cntrl-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'abc\b123', ref: 'main', builtAt: '2026-08-15T00:00:00Z', dirty: false }));
    const r = runCcrcRaw(home, ['version']);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stdout).not.toContain('\b');
    expect(r.stderr).toMatch(/^ccrc: build stamp unreadable/m);
  });

  it('extra arguments to version are a usage error (exit 2), not silently ignored', () => {
    // Round-1 review, Important 2: this used to assert exit 1 with a
    // "usage: ccrc version" message — which itself violated this file's own
    // exit-code table (1 = the tool ran and the answer was bad; 2 = a usage
    // error, an unknown verb or argument). `version` takes no arguments at
    // all, so an extra one is squarely a usage error.
    const home = mkTmp('ccrc-cli-version-extra-args-');
    const r = runCcrcRaw(home, ['version', 'extra']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: extra/m);
    expect(r.stderr).toMatch(/usage: ccrc/);
  });

  it('"ccrc version --help" is a usage error too — help is a top-level concern, not a per-verb flag', () => {
    // Decision (round-1 review, Important 2 asked that this be decided and
    // documented, not left implicit): -h/--help only short-circuits BEFORE a
    // verb is read (`ccrc -h`, `ccrc --help`). Once `version` has been
    // selected it accepts no flags of its own, `--help` included — so this
    // is the same "unknown argument" refusal as any other unexpected token,
    // exit 2, not exit 0 and not exit 1.
    const home = mkTmp('ccrc-cli-version-help-after-verb-');
    const r = runCcrcRaw(home, ['version', '--help']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --help/m);
    expect(r.stdout).toBe('');
  });

  it('a build.json that is a directory is a shape problem, not "unstamped"', () => {
    // Round-1 review, Minor 8: `[[ ! -f ]]` alone reads ANY non-regular-file
    // shape (a directory being the measured, most plausible case — e.g. a
    // half-finished rsync/mkdir race) as plain absence, collapsing "never
    // stamped" into "stamped with garbage": exactly the two-different-answers
    // split this verb exists to make (see the header's three-way discipline).
    const home = mkTmp('ccrc-cli-version-dirstamp-');
    mkdirSync(join(home, '.ccrc', 'build.json'), { recursive: true });
    const r = runCcrcRaw(home, ['version']);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ccrc: build stamp unreadable/m);
    expect(r.stderr).not.toMatch(/unstamped/);
  });

  it('a missing jq is refused by its own name, not folded into "build stamp unreadable"', () => {
    // Round-1 review, Important 3: cmd_version used to swallow jq's own
    // diagnosis (`2>/dev/null`) and report every jq failure alike — including
    // "jq isn't installed" — as "build stamp unreadable: <path>", which sends
    // an operator chasing a corrupt stamp when the real fix is `apt install
    // jq`. That is the overloaded-seam mistake this codebase's conventions
    // ban by name: two conditions an operator acts on completely differently
    // (missing dependency vs. corrupt data) must not share one signal.
    //
    // PATH is restricted for a NESTED bash invocation only: `command -v bash`
    // resolves bash's absolute path under the OUTER shell's real, working
    // PATH, then that absolute path is exec'd directly with a broken PATH —
    // an absolute-path exec needs no PATH lookup for itself, only for
    // whatever IT calls (jq). This leaves the outer spawnSync/vitest
    // process's own PATH completely untouched.
    const home = mkTmp('ccrc-cli-version-nojq-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'abc123', ref: 'main', builtAt: '2026-08-15T00:00:00Z', dirty: false }));
    const script = `real_bash="$(command -v bash)"; PATH=/nonexistent-ccrc-test-path "$real_bash" "${CCRC}" version`;
    const r = spawnSync('bash', ['-c', script], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/jq/);
    expect(r.stderr).not.toMatch(/unreadable/);
  });
});

describe('ccrc: the BASH_SOURCE guard actually guards', () => {
  it('sourcing the script (even with a verb-shaped argument) defines cmd_version but never dispatches', () => {
    // Round-1 review, Important 1: every test above spawns `bash ccd/ccrc
    // <args>` — always DIRECT execution, where `BASH_SOURCE[0] == $0` is true
    // whether or not the guard exists. None of those 15 original assertions
    // could ever notice the guard being deleted; this is the one test that
    // actually sources the file, the way it's meant to be used (see
    // ccd-clip.test.ts:32 / ccd-workspaces.test.ts:394 for the same pattern
    // against ccd itself).
    //
    // `source FILE version` passes "version" as $1 for the DURATION of the
    // sourcing (bash sets positional parameters from a source's own
    // arguments) — so if the guard were deleted, the case statement would
    // run unconditionally right there and dispatch to cmd_version, printing
    // its output during what must be a silent, side-effect-free `source`.
    // Proof this test actually catches that: see task-1-report.md's
    // "Important 1" section for the before/after mutation measurement this
    // finding demanded.
    const home = mkTmp('ccrc-cli-source-guard-');
    const r = spawnSync('bash', ['-c',
      `source "${CCRC}" version; declare -F cmd_version >/dev/null && echo CMD_VERSION_DEFINED`],
      { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('CMD_VERSION_DEFINED');
    // Nothing dispatched: cmd_version's own stdout ("ccrc unstamped (...)"
    // for this fresh, stampless HOME) must never appear from a plain source.
    expect(r.stdout).not.toMatch(/unstamped/);
  });
});

describe('ccrc: the runner cannot reach the real server', () => {
  it('resolves curl inside the fixture, not on the system PATH', () => {
    const home = mkTmp('ccrc-cli-curl-contained-');
    const r = spawnSync('bash', ['-c', 'command -v curl'], { env: ccrcEnv(home), encoding: 'utf8' });
    expect(r.stdout.trim()).toBe(join(home, '.local', 'bin', 'curl'));
  });

  it('status reaches the POISON, not the box\'s real server — measured, not asserted on env', () => {
    // The behavioural half, which the `gh` containment above cannot have: no
    // verb shells out to gh, but `status` really does shell out to curl. With
    // an address configured it asks exactly one URL, the poison answers 97, and
    // status reports a fleet it could not measure rather than one it agreed
    // with. If the poison were ever displaced, this box's LIVE server would be
    // the thing answering.
    const home = mkTmp('ccrc-cli-status-curl-');
    const r = spawnSync('bash', [CCRC, 'status'],
      { env: { ...ccrcEnv(home), CCRC_ADDR: 'ccrc-fixture.invalid:7788' }, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(curlPoison(home).join('\n')).toContain('http://ccrc-fixture.invalid:7788/api/fleet/health');
    expect(r.stdout).toMatch(/fleet: +not measured/);
    expect(r.stdout).toMatch(/97/);
  });

  it('every other verb leaves the box alone — the poison saw nothing', () => {
    const home = mkTmp('ccrc-cli-no-curl-');
    for (const argv of [['version'], ['-h'], ['adopt'], ['status']]) runCcrcRaw(home, argv);
    // `status` is in that list deliberately: with no CCRC_ADDR and no
    // ~/.ccrc/ccrc.env, there is no server to ask, and a status that invented
    // one would show up right here.
    expect(curlPoison(home)).toEqual([]);
  });

  it('an ambient CCRC_ADDR in the SUITE\'s own shell does not reach the verb', () => {
    // The runner spreads process.env, so whoever ran the suite could otherwise
    // hand `status` a live address and turn the test above red — a flake that
    // depends on the operator's shell rather than on the code.
    const before = process.env['CCRC_ADDR'];
    process.env['CCRC_ADDR'] = '203.0.113.7:7788';   // a REAL address, deliberately
    try {
      const home = mkTmp('ccrc-cli-ambient-addr-');
      expect(ccrcEnv(home)['CCRC_ADDR']).toBeUndefined();
      const r = runCcrcRaw(home, ['status']);
      expect(r.stdout).toMatch(/server: +none configured/);
      expect(curlPoison(home)).toEqual([]);
    } finally {
      if (before === undefined) delete process.env['CCRC_ADDR']; else process.env['CCRC_ADDR'] = before;
    }
  });

  it('status queries the POISONED systemctl, never this box\'s real one', () => {
    // This runner keeps the real PATH, and `status` asks systemd about two
    // units. On this machine that is a LIVE fleet host; the query is read-only,
    // but a suite that touches the box it is running on is one refactor away
    // from touching it differently.
    const home = mkTmp('ccrc-cli-systemctl-');
    const r = runCcrcRaw(home, ['status']);
    expect(poisonLog(home, 'systemctl').join('\n')).toContain('--user is-active ccrc.service');
    expect(poisonLog(home, 'systemctl').join('\n')).toContain('--user is-active ccrc-agent.service');
    // The poison exits 97 saying nothing on stdout, so both units read as
    // "unknown" — and status says unknown rather than inventing a role.
    expect(r.stdout).toMatch(/role: +unknown/);
    expect(r.code).toBe(0);
  });
});

describe('ccrc: the runner cannot reach the real gh', () => {
  it('resolves gh inside the fixture, not on the system PATH', () => {
    // The guard this pins is `runCcrcRaw` running under `ghContainedEnv`, and
    // the reason it is pinned HERE rather than left as a comment is measured
    // history: for the whole of Task 1-3 this runner passed the real PATH, and
    // the moment `doctor` existed the stale "not implemented yet: doctor" case
    // began executing the real `gh auth status` on every suite run. Nothing
    // went red, because no test in this file has ever asked what `gh` resolves
    // to. This one does.
    //
    // Deliberately asserted on the ENV rather than through a verb: no ccrc verb
    // shells out to gh today, so a behavioural assertion would be vacuous now
    // and would silently stay vacuous while `status` (Task 7) and `adopt`
    // (Task 8) land on top of this same runner.
    const home = mkTmp('ccrc-cli-gh-contained-');
    const r = spawnSync('bash', ['-c', 'command -v gh'], { env: ccrcEnv(home), encoding: 'utf8' });
    expect(r.stdout.trim()).toBe(join(home, '.local', 'bin', 'gh'));
  });
});
