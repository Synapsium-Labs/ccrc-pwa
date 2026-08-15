// ccd/ccrc — Task 1 of the stage-2b ccrc-cli-and-doctor plan: the dispatch
// skeleton, the `version` verb, and usage/argument handling for the new
// lifecycle CLI. `doctor`, `status` and `adopt` are reserved verb names this
// task does not implement — dispatching to one of them is its own,
// deliberately distinct, refusal (exit 1, "not implemented yet") from an
// unrecognised verb (exit 2, a USAGE error).
//
// Harness: mkTmp + a hand-rolled runCcrcRaw/runCcrc pair, copied in shape
// from ccrc-adopt's own (server/test/adopt.test.ts:33-44) — NOT
// makeCcdHarness, for the same reason adopt's suite does not use it either:
// these tests only ever exercise the dispatch/usage/version surface, which
// needs nothing a populated fleet HOME (registry, roster, gh poison) would
// provide, so a plain throwaway HOME from mkTmp is the whole fixture.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CCRC = path.resolve(here, '..', '..', 'ccd', 'ccrc');

interface Result { code: number; stdout: string; stderr: string }

/** Runs the CLI exactly as an operator does: `bash ccd/ccrc`, HOME pointed at
 *  a throwaway fixture. Never throws on a nonzero exit — several tests below
 *  exercise refusal paths (unknown verb, unreadable stamp) and need the exit
 *  code and stderr as data, not as a thrown Error. */
function runCcrcRaw(home: string, args: string[] = []): Result {
  const r = spawnSync('bash', [CCRC, ...args], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

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
  // doctor, status and adopt are dispatchable names as of this task, but
  // deliberately non-functional — Task 3+ fills these in. This is NOT the
  // same refusal as an unrecognised verb: exit 1 here (the verb is real,
  // just not built yet), never 2 (that would claim the operator mistyped
  // something).
  it.each(['doctor', 'status', 'adopt'] as const)('%s prints "not implemented yet" on stderr and exits 1', (verb) => {
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

  it('extra arguments to version are a refusal, not silently ignored', () => {
    const home = mkTmp('ccrc-cli-version-extra-args-');
    const r = runCcrcRaw(home, ['version', 'extra']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: usage: ccrc version/m);
  });
});
