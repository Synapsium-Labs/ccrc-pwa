// ccd/ccrc — Task 1 of the stage-2b ccrc-cli-and-doctor plan: the dispatch
// skeleton, the `version` verb, and usage/argument handling for the new
// lifecycle CLI. `doctor`, `status` and `adopt` are reserved verb names that
// task did not implement — dispatching to one of them is its own, deliberately
// distinct, refusal (exit 1, "not implemented yet") from an unrecognised verb
// (exit 2, a USAGE error). `doctor` has since graduated out of that list in
// Task 4 and is pinned by server/test/ccrc-doctor.test.ts; `status` and
// `adopt` still refuse here.
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
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
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
  writeFileSync(join(home, '.local', 'bin', 'curl'),
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/curl-poison"\n'
    + 'echo "ccrc tests must never reach a real server" >&2\nexit 97\n', { mode: 0o755 });
  return env;
}

/** Every argv the poisoned `curl` saw. Empty means nothing tried to leave the
 *  box — which is what every test in this file except the one below expects. */
const curlPoison = (home: string): string[] => {
  const p = join(home, 'curl-poison');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

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
    const home = mkTmp('ccrc-cli-usage-verbs-');
    const r = runCcrcRaw(home, ['-h']);
    expect(r.stdout).toMatch(/usage: ccrc \{doctor\|status\|adopt\|version\}/);
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

describe('ccrc: reserved verbs not implemented yet', () => {
  // adopt is a dispatchable name, but deliberately non-functional — Task 8
  // fills it in. This is NOT the same refusal as an unrecognised verb: exit 1
  // here (the verb is real, just not built yet), never 2 (that would claim the
  // operator mistyped something).
  //
  // `doctor` LEFT this list in Task 4 and `status` in Task 7, each in the task
  // that implemented it — a verb graduates out of here exactly once, when it
  // starts doing its job. Their behaviour is pinned by
  // server/test/ccrc-doctor.test.ts from that point on; nothing in this file
  // asserts anything about either of them any more.
  it.each(['adopt'] as const)('%s prints "not implemented yet" on stderr and exits 1', (verb) => {
    const home = mkTmp(`ccrc-cli-notimpl-${verb}-`);
    const r = runCcrcRaw(home, [verb]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`^ccrc: not implemented yet: ${verb}$`, 'm'));
    expect(r.stdout).toBe('');
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
