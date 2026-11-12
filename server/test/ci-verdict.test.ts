// Task 8 (contract) — verdicts, `.github/ci/verdict.mjs` (spec §4.2's
// "the summary job is the whole safety of the required check").
//
// `serverVerdict`'s rule, in the contract's own order:
//   select ≠ success -> fail
//   tests = none -> ok
//   typecheck ≠ success -> fail
//   count = '0' -> shards must be skipped
//   count > 0 -> shards must be success
//   anything else -> fail
//
// The table below is EXHAUSTIVE over every GitHub job-result value crossed
// with every `tests`/`count` value the select job can emit, and the
// expected `ok` for each combination is computed by an ORACLE written
// independently of `serverVerdict`'s own source (transcribed straight from
// the six-line rule above, not by importing or calling the function under
// test) — a control derived from the same measurement it checks would be
// tautological.
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { serverVerdict, fullVerdict, DELIBERATE_SKIPS } from '../../.github/ci/verdict.mjs';
import type { JobResult, TestsMode } from '../../.github/ci/verdict.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const RESULTS: JobResult[] = ['success', 'failure', 'cancelled', 'skipped', ''];
const TESTS: TestsMode[] = ['selected', 'full', 'none', ''];
const COUNTS: Array<'0' | '3' | ''> = ['0', '3', ''];
// `merge_group` since landing-order wave 2: a merge-queue run runs what a pull
// request runs (operator ruling 2026-09-28), so it never answers tests none.
const EVENTS = ['pull_request', 'push', 'merge_group'];

/** Independent oracle, transcribed from the contract's own prose (not from
 *  verdict.mjs), plus the operator's rulings that a pull request always runs
 *  server tests (T2), that an unrecognised `tests` value is red, and that
 *  `count === '0'` reads as an empty selection only when `tests ===
 *  'selected'` — a `full` run always has tests (F8-1). Returns only the
 *  boolean the table asserts. */
function expectedOk({ select, typecheck, shards, tests, count, event }: {
  select: string; typecheck: string; shards: string; tests: string; count: string; event: string;
}): boolean {
  if (select !== 'success') return false;
  if (tests === 'none') return event !== 'pull_request' && event !== 'merge_group';
  if (tests !== 'selected' && tests !== 'full') return false;
  if (typecheck !== 'success') return false;
  if (count === '0') return tests === 'selected' && shards === 'skipped';
  if (count === '3') return shards === 'success'; // "count > 0"
  return false; // anything else (count === '') -> fail
}

describe('serverVerdict — exhaustive table', () => {
  const cases: Array<{ select: JobResult; typecheck: JobResult; shards: JobResult; tests: TestsMode; count: string; event: string }> = [];
  for (const select of RESULTS) {
    for (const typecheck of RESULTS) {
      for (const shards of RESULTS) {
        for (const tests of TESTS) {
          for (const count of COUNTS) {
            for (const event of EVENTS) cases.push({ select, typecheck, shards, tests, count, event });
          }
        }
      }
    }
  }

  it(`covers every combination (${RESULTS.length}^3 x ${TESTS.length} x ${COUNTS.length} x ${EVENTS.length} = ${cases.length})`, () => {
    expect(cases.length).toBe(RESULTS.length ** 3 * TESTS.length * COUNTS.length * EVENTS.length);
  });

  it.each(cases)(
    'select=$select typecheck=$typecheck shards=$shards tests=$tests count=$count event=$event',
    (c) => {
      const want = expectedOk(c);
      const got = serverVerdict(c);
      expect(got.ok, `reason: ${got.reason}`).toBe(want);
      expect(typeof got.reason).toBe('string');
      expect(got.reason.length).toBeGreaterThan(0);
    },
  );
});

describe('serverVerdict — the named scenarios from the plan brief', () => {
  it('select cancelled -> red, no matter what else is green', () => {
    const v = serverVerdict({
      select: 'cancelled', typecheck: 'success', shards: 'success', tests: 'selected', count: '3',
    });
    expect(v.ok).toBe(false);
  });

  it('shards skipped with count > 0 -> red (the silent-green trap)', () => {
    const v = serverVerdict({
      select: 'success', typecheck: 'success', shards: 'skipped', tests: 'selected', count: '3',
    });
    expect(v.ok).toBe(false);
  });

  it('tests none -> green, even if typecheck/shards never ran (a refresh, a skipped daily run)', () => {
    const v = serverVerdict({
      select: 'success', typecheck: '', shards: '', tests: 'none', count: '', event: 'push',
    });
    expect(v.ok).toBe(true);
  });

  it('tests none on a pull_request -> red: a pull request always runs server tests (ruling T2)', () => {
    const v = serverVerdict({
      select: 'success', typecheck: '', shards: '', tests: 'none', count: '', event: 'pull_request',
    });
    expect(v).toEqual({ ok: false, reason: expect.stringContaining('pull_request') });
  });

  it('tests none on a merge_group -> red too: a merge-queue run runs what a pull request runs (operator ruling 2026-09-28)', () => {
    const v = serverVerdict({
      select: 'success', typecheck: '', shards: '', tests: 'none', count: '', event: 'merge_group',
    });
    expect(v).toEqual({ ok: false, reason: expect.stringContaining('merge_group') });
  });

  it('the ordinary green path: count 3, shards success', () => {
    const v = serverVerdict({
      select: 'success', typecheck: 'success', shards: 'success', tests: 'selected', count: '3',
    });
    expect(v.ok).toBe(true);
  });

  it('the ordinary empty-selection green path: count 0, shards skipped', () => {
    const v = serverVerdict({
      select: 'success', typecheck: 'success', shards: 'skipped', tests: 'selected', count: '0',
    });
    expect(v.ok).toBe(true);
  });

  it('count 0 but shards actually ran (success) -> red, not a bonus green', () => {
    const v = serverVerdict({
      select: 'success', typecheck: 'success', shards: 'success', tests: 'selected', count: '0',
    });
    expect(v.ok).toBe(false);
  });

  it('tests: full with count 0 -> red: a full run always has tests (ruling F8-1)', () => {
    const v = serverVerdict({
      select: 'success', typecheck: 'success', shards: 'skipped', tests: 'full', count: '0',
    });
    expect(v).toEqual({ ok: false, reason: expect.stringContaining('full') });
  });

  it('unrecognised tests value with count 0 -> red (ruling F8-1)', () => {
    const v = serverVerdict({
      select: 'success', typecheck: 'success', shards: 'skipped', tests: '', count: '0',
    });
    expect(v).toEqual({ ok: false, reason: expect.stringContaining('unrecognised tests') });
  });
});

describe('fullVerdict', () => {
  it('every result success -> ok', () => {
    const v = fullVerdict({
      'server-shard-1': { result: 'success' },
      'server-typecheck': { result: 'success' },
      'test-agent': { result: 'success' },
      'test-pwa': { result: 'success' },
      'build-pwa': { result: 'success' },
      'test-macos-1': { result: 'success' },
    });
    expect(v.ok).toBe(true);
  });

  it('one skipped -> red', () => {
    const v = fullVerdict({
      a: { result: 'success' },
      b: { result: 'skipped' },
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('b');
  });

  it('one cancelled -> red', () => {
    const v = fullVerdict({
      a: { result: 'success' },
      b: { result: 'cancelled' },
    });
    expect(v.ok).toBe(false);
  });

  it('one failure among many successes -> red', () => {
    const v = fullVerdict({
      a: { result: 'success' }, b: { result: 'success' }, c: { result: 'failure' },
    });
    expect(v.ok).toBe(false);
  });

  it('no legs at all -> red: a verdict over nothing proves nothing', () => {
    const v = fullVerdict({});
    expect(v.ok).toBe(false);
  });
});

describe('serverVerdict — a docs-only follow-up push (D-8396)', () => {
  const ok = (over: Partial<Parameters<typeof serverVerdict>[0]>) => serverVerdict({
    select: 'success', typecheck: 'skipped', shards: 'skipped', tests: 'selected', count: '', event: 'pull_request', followup: 'true', ...over,
  });

  it('a pull request whose select answered the follow-up, with the typecheck and the shards skipped: green', () => {
    expect(ok({}).ok).toBe(true);
    expect(ok({}).reason).toContain('D-8396');
  });

  it('red off a pull request, on a select that did not succeed, and when a skipped job ran after all', () => {
    for (const event of ['merge_group', 'push', 'schedule', 'workflow_dispatch', '']) expect(ok({ event }).ok, event).toBe(false);
    for (const select of ['failure', 'cancelled', 'skipped', ''] as const) expect(ok({ select }).ok, select).toBe(false);
    for (const r of ['success', 'failure', 'cancelled', ''] as const) {
      expect(ok({ typecheck: r }).ok, `typecheck ${r}`).toBe(false);
      expect(ok({ shards: r }).ok, `shards ${r}`).toBe(false);
    }
  });

  it('any followup value but `true` is the ordinary rule, unchanged', () => {
    for (const followup of ['false', '', undefined]) {
      expect(serverVerdict({ select: 'success', typecheck: 'skipped', shards: 'skipped', tests: 'selected', count: '', event: 'pull_request', followup }).ok).toBe(false);
      expect(serverVerdict({ select: 'success', typecheck: 'success', shards: 'success', tests: 'selected', count: '3', event: 'pull_request', followup }).ok).toBe(true);
    }
  });
});

describe('fullVerdict — the macOS legs a dispatch skipped on purpose (D-8396)', () => {
  const legs = { select: { result: 'success' }, server: { result: 'success' }, pwa: { result: 'success' } };

  it('a deliberate skip of macos is green; the same skip undeclared is red', () => {
    const v = fullVerdict({ ...legs, macos: { result: 'skipped' } }, ['macos']);
    expect(v.ok, v.reason).toBe(true);
    expect(v.reason).toContain('macos');
    expect(fullVerdict({ ...legs, macos: { result: 'skipped' } }).ok).toBe(false);
    expect(fullVerdict({ ...legs, macos: { result: 'skipped' } }, []).ok).toBe(false);
  });

  it('a declared skip excuses a skip only: a macos failure or cancellation is still red, and success is green', () => {
    expect(fullVerdict({ ...legs, macos: { result: 'failure' } }, ['macos']).ok).toBe(false);
    expect(fullVerdict({ ...legs, macos: { result: 'cancelled' } }, ['macos']).ok).toBe(false);
    expect(fullVerdict({ ...legs, macos: { result: 'success' } }, ['macos']).ok).toBe(true);
  });

  it('only a leg on DELIBERATE_SKIPS may be declared: any other name is red, even when it succeeded', () => {
    expect(DELIBERATE_SKIPS).toEqual(['macos']);
    expect(fullVerdict({ ...legs, macos: { result: 'skipped' }, server: { result: 'skipped' } }, ['macos', 'server']).ok).toBe(false);
    expect(fullVerdict({ ...legs, macos: { result: 'success' } }, ['server']).ok).toBe(false);
  });

  it('a verdict over nothing but the deliberate skip proves nothing', () => {
    expect(fullVerdict({ macos: { result: 'skipped' } }, ['macos']).ok).toBe(false);
  });
});

describe('the CLI', () => {
  const cliPath = path.join(repoRoot, '.github', 'ci', 'verdict.mjs');

  function runServer(env: Record<string, string>) {
    try {
      const out = execFileSync(process.argv0, [cliPath, 'server'], {
        cwd: repoRoot,
        env: { ...process.env, ...env },
        encoding: 'utf8',
      });
      return { status: 0, out };
    } catch (e) {
      const err = e as { status: number; stdout: string };
      return { status: err.status, out: err.stdout };
    }
  }

  it('exits 0 and prints the reason on a green server verdict', () => {
    const { status, out } = runServer({
      SELECT_RESULT: 'success', TYPECHECK_RESULT: 'success', SHARDS_RESULT: 'success',
      TESTS: 'selected', COUNT: '3', EVENT: 'pull_request',
    });
    expect(status).toBe(0);
    expect(out.length).toBeGreaterThan(0);
  });

  it('reads EVENT: tests none on a pull_request exits non-zero', () => {
    const { status } = runServer({
      SELECT_RESULT: 'success', TYPECHECK_RESULT: '', SHARDS_RESULT: '', TESTS: 'none', COUNT: '', EVENT: 'pull_request',
    });
    expect(status).not.toBe(0);
    expect(runServer({
      SELECT_RESULT: 'success', TYPECHECK_RESULT: '', SHARDS_RESULT: '', TESTS: 'none', COUNT: '', EVENT: 'push',
    }).status).toBe(0);
  });

  it('fails CLOSED: loaded without its entry guard matching (main never runs), it exits 1, not 0', () => {
    // A slip in the entry guard would make `node verdict.mjs server` do nothing; the exit code must not then
    // be node's default 0, which every required check would read as green.
    const dir = mkTmp('ccrc-verdict-noop-');
    const wrapper = path.join(dir, 'wrapper.mjs');
    writeFileSync(wrapper, `import ${JSON.stringify(pathToFileURL(cliPath).href)};\n`);
    const r = spawnSync(process.execPath, [wrapper], { encoding: 'utf8' });
    expect(r.stdout).toBe('');
    expect(r.status).toBe(1);
  });

  it('exits non-zero on a red server verdict (select cancelled)', () => {
    const { status } = runServer({
      SELECT_RESULT: 'cancelled', TYPECHECK_RESULT: 'success', SHARDS_RESULT: 'success',
      TESTS: 'selected', COUNT: '3',
    });
    expect(status).not.toBe(0);
  });

  it('exits non-zero on the silent-green trap (shards skipped, count 3)', () => {
    const { status } = runServer({
      SELECT_RESULT: 'success', TYPECHECK_RESULT: 'success', SHARDS_RESULT: 'skipped',
      TESTS: 'selected', COUNT: '3',
    });
    expect(status).not.toBe(0);
  });

  // `full` reads RESULTS, `name=result` pairs — not toJSON(needs), which carries every select matrix and
  // outgrows an environment string's 128 KB as the suite grows (measured 110 KB with no durations).
  function runFull(results: string | undefined) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.RESULTS;
    if (results !== undefined) env.RESULTS = results;
    return spawnSync(process.argv0, [cliPath, 'full'], { cwd: repoRoot, env, encoding: 'utf8' });
  }

  it('full subcommand: exits 0 when every RESULTS pair is success', () => {
    const r = runFull('select=success server=success test-macos=success');
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(0);
  });

  it('full subcommand: SKIPPED_ON_PURPOSE=macos excuses a skipped macos and nothing else (D-8396)', () => {
    const run = (results: string, purpose: string) => spawnSync(process.argv0, [cliPath, 'full'], {
      cwd: repoRoot, env: { ...process.env, RESULTS: results, SKIPPED_ON_PURPOSE: purpose }, encoding: 'utf8',
    });
    expect(run('select=success server=success macos=skipped', 'macos').status).toBe(0);
    expect(run('select=success server=success macos=skipped', '').status).not.toBe(0);
    expect(run('select=success server=skipped macos=skipped', 'macos').status).not.toBe(0);
    expect(run('select=success server=success macos=failure', 'macos').status).not.toBe(0);
    expect(run('select=success server=success macos=skipped', 'macos server').status).not.toBe(0);
  });

  it('server subcommand: FOLLOWUP=true passes a pull request whose typecheck and shards were skipped (D-8396)', () => {
    const env = { SELECT_RESULT: 'success', TYPECHECK_RESULT: 'skipped', SHARDS_RESULT: 'skipped', TESTS: 'selected', COUNT: '' };
    expect(runServer({ ...env, EVENT: 'pull_request', FOLLOWUP: 'true' }).status).toBe(0);
    expect(runServer({ ...env, EVENT: 'merge_group', FOLLOWUP: 'true' }).status).not.toBe(0);
    expect(runServer({ ...env, EVENT: 'pull_request', FOLLOWUP: 'false' }).status).not.toBe(0);
  });

  it('full subcommand: exits non-zero when one result is not success, when RESULTS is empty or absent, or malformed', () => {
    expect(runFull('select=success test-macos=failure').status).not.toBe(0);
    expect(runFull('').status).not.toBe(0);
    expect(runFull(undefined).status).not.toBe(0);
    expect(runFull('select=success nonsense').status).not.toBe(0);
  });
});
