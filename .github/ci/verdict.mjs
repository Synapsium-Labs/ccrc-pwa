// Verdicts (spec §4.2, contract Task 8).
//
// GitHub reports a job SKIPPED BY A CONDITIONAL as Success, and a job whose
// `needs:` failed is itself skipped — so a required "summary" job written
// the obvious way (just checking its own steps) turns a crashed selector or
// a silently-skipped shard run into a green required check. `serverVerdict`
// is the one place `test (server)` (spec §4.2) computes whether that
// actually happened; `fullVerdict` is `full-suite` (spec §8)'s equivalent
// for the daily/stable-gate run, where every leg must have actually
// succeeded.
//
// FAILS CLOSED: the exit code is 1 from the moment this module loads, and
// only a `main()` that reaches an ok verdict sets 0 — so a slip that stops
// `main()` running at all (the entry guard, say) is red, not node's default
// 0, which every required check would have read as green. ci.yml also puts
// a script-free guard step in front of both verdicts that can only add red.

import { pathToFileURL } from 'node:url';

process.exitCode = 1;

/**
 * @typedef {'success'|'failure'|'cancelled'|'skipped'|''} JobResult
 * @typedef {'selected'|'full'|'none'|''} TestsMode
 */

/**
 * `test (server)`'s verdict (spec §4.2). Order matters — it is the order
 * the contract states the rule in, and `tests === 'none'` deliberately
 * short-circuits BEFORE the typecheck check: a `none` selection (the daily
 * schedule's "already green" short-circuit, spec §3) skips typecheck too,
 * so checking it there would read a `skipped` as a failure. A pull request
 * can never answer `none` (it always runs server tests — ruling T2), and nor
 * can a merge-queue run, which runs what a pull request runs (operator ruling
 * 2026-09-28, landing-order wave 2), so `none` with `event === 'pull_request'`
 * or `'merge_group'` is red; the event comes from the workflow's own context,
 * not from select's outputs.
 *
 * Rules:
 *   1. `select` did not succeed -> fail.
 *   2. `tests === 'none'` -> ok (nothing was supposed to run) — except on a
 *      `pull_request` or a `merge_group`, which fails.
 *   3. `tests` is anything other than `selected` or `full` -> fail, reason
 *      `unrecognised tests: <JSON of the value>` (an unrecognised selection
 *      mode never earned a verdict — ruling F8-1).
 *   4. `typecheck` did not succeed -> fail.
 *   5. `count === '0'` -> ok iff `tests === 'selected'` AND `shards` is
 *      `skipped` (nothing was supposed to run there either). A `full` run
 *      always has tests, so `tests: 'full'` with `count: '0'` is itself a
 *      discrepancy, not an empty selection, and fails with reason
 *      `tests: full but count: 0 — a full run always has tests` (ruling
 *      F8-1); any other `tests === 'selected'` mismatch (shards not
 *      `skipped`) fails with the generic count/shards reason below.
 *   6. any other `count` (an actual file count, e.g. `'3'`) -> ok iff
 *      `shards` is `success`. This is the "silent-green trap" spec §4.2
 *      names: a `skipped` shard run with a non-zero count must NOT read
 *      as ok, or a crashed/never-scheduled `server-shard` job would pass
 *      silently.
 *   7. anything else (an unrecognised `count`, e.g. `''`) -> fail.
 *
 *
 * One more rule sits between 1 and 2 (D-8396): `followup === 'true'` (select's `docs_followup`, a pull-request push
 * whose every file changed since the PR's newest passing head is documentation, .github/ci/docs-followup.mjs) is ok
 * iff the event is `pull_request` and the typecheck and the shards were BOTH skipped, which is what that answer does
 * to them. Off a pull request, or with either job run after all, it is red. Any other value is the rules above.
 *
 * @param {{ select: JobResult, typecheck: JobResult, shards: JobResult, tests: TestsMode, count: string, event?: string, followup?: string }} inputs
 * @returns {{ ok: boolean, reason: string }}
 */
export function serverVerdict({ select, typecheck, shards, tests, count, event, followup }) {
  if (select !== 'success') {
    return { ok: false, reason: `select: ${select || '(did not run)'}` };
  }
  if (followup === 'true') {
    if (event !== 'pull_request') return { ok: false, reason: `a docs-only follow-up on a ${event || '(no event)'}: only a pull request may skip (D-8396)` };
    return typecheck === 'skipped' && shards === 'skipped'
      ? { ok: true, reason: 'a docs-only follow-up to a head whose pull-request run passed: the server jobs skipped on purpose (D-8396)' }
      : { ok: false, reason: `a docs-only follow-up, but typecheck: ${typecheck || '(did not run)'}, shards: ${shards || '(did not run)'} (expected both skipped)` };
  }
  if (tests === 'none') {
    return event === 'pull_request' || event === 'merge_group'
      ? { ok: false, reason: `tests: none on a ${event} — a pull request or a merge-queue run always runs server tests` }
      : { ok: true, reason: 'tests: none — nothing was selected to run' };
  }
  if (tests !== 'selected' && tests !== 'full') {
    return { ok: false, reason: `unrecognised tests: ${JSON.stringify(tests)}` };
  }
  if (typecheck !== 'success') {
    return { ok: false, reason: `typecheck: ${typecheck || '(did not run)'}` };
  }
  if (count === '0') {
    if (tests === 'selected' && shards === 'skipped') {
      return { ok: true, reason: 'count: 0, shards: skipped — nothing selected' };
    }
    if (tests !== 'selected') {
      return { ok: false, reason: 'tests: full but count: 0 — a full run always has tests' };
    }
    return { ok: false, reason: `count: 0 but shards: ${shards || '(did not run)'} (expected skipped)` };
  }
  const n = Number(count);
  if (count !== '' && Number.isInteger(n) && n > 0) {
    return shards === 'success'
      ? { ok: true, reason: `count: ${count}, shards: success` }
      : { ok: false, reason: `count: ${count} but shards: ${shards || '(did not run)'} (expected success)` };
  }
  return { ok: false, reason: `unrecognised count: ${JSON.stringify(count)}` };
}

/** The legs a run may skip ON PURPOSE and still be green (D-8396): the macOS call, which a dispatched full run leaves
 *  out unless it is dispatched with `macos=true`. Nothing else: a skipped Linux leg is always red. */
export const DELIBERATE_SKIPS = Object.freeze(['macos']);

/**
 * `full-suite`'s verdict (spec §8): green iff every leg is green. `skippedOnPurpose` names the legs this run skipped
 * deliberately (D-8396); each must be on DELIBERATE_SKIPS, and excuses a `skipped` result only (its failure or
 * cancellation is red). A name off that list is red whatever the results, and so is a run whose every leg was a
 * deliberate skip.
 *
 * @param {Record<string, { result: string }>} needs
 * @param {readonly string[]} [skippedOnPurpose]
 * @returns {{ ok: boolean, reason: string }}
 */
export function fullVerdict(needs, skippedOnPurpose = []) {
  if (Object.keys(needs).length === 0) return { ok: false, reason: 'no legs to judge — a verdict over nothing proves nothing' };
  const foreign = skippedOnPurpose.filter((n) => !DELIBERATE_SKIPS.includes(n));
  if (foreign.length > 0) return { ok: false, reason: `only ${DELIBERATE_SKIPS.join(', ')} may be skipped on purpose, not ${foreign.join(', ')}` };
  const excused = (name, result) => result === 'skipped' && skippedOnPurpose.includes(name);
  if (Object.entries(needs).every(([n, v]) => excused(n, v.result))) return { ok: false, reason: 'every leg was skipped on purpose — a verdict over nothing proves nothing' };
  const notOk = Object.entries(needs).filter(([n, v]) => v.result !== 'success' && !excused(n, v.result));
  const skipped = Object.entries(needs).filter(([n, v]) => excused(n, v.result)).map(([n]) => n);
  if (notOk.length === 0) {
    return { ok: true, reason: skipped.length ? `every leg succeeded but ${skipped.join(', ')}, skipped on purpose (D-8396)` : 'every leg succeeded' };
  }
  return {
    ok: false,
    reason: `not green: ${notOk.map(([name, v]) => `${name}=${v.result}`).join(', ')}`,
  };
}

function main() {
  const [sub] = process.argv.slice(2);
  let verdict;
  if (sub === 'server') {
    verdict = serverVerdict({
      select: /** @type {JobResult} */ (process.env.SELECT_RESULT ?? ''),
      typecheck: /** @type {JobResult} */ (process.env.TYPECHECK_RESULT ?? ''),
      shards: /** @type {JobResult} */ (process.env.SHARDS_RESULT ?? ''),
      tests: /** @type {TestsMode} */ (process.env.TESTS ?? ''),
      count: process.env.COUNT ?? '',
      event: process.env.EVENT ?? '',
      followup: process.env.FOLLOWUP ?? '',
    });
  } else if (sub === 'full') {
    // RESULTS: `name=result` pairs, one per job full-suite needs — only the
    // results, never toJSON(needs), which carries every select matrix.
    /** @type {Record<string, { result: string }>} */
    const needs = {};
    let malformed = '';
    for (const pair of (process.env.RESULTS ?? '').split(/\s+/).filter(Boolean)) {
      const m = /^([\w-]+)=(\w*)$/.exec(pair);
      if (m) needs[m[1]] = { result: m[2] };
      else malformed = pair;
    }
    // SKIPPED_ON_PURPOSE: the legs this run left out deliberately, space-separated (D-8396: `macos` on a dispatch
    // without macos=true); empty for every other run.
    const purpose = (process.env.SKIPPED_ON_PURPOSE ?? '').split(/\s+/).filter(Boolean);
    verdict = malformed ? { ok: false, reason: `RESULTS has a malformed pair: ${malformed}` } : fullVerdict(needs, purpose);
  } else {
    process.stderr.write('usage: node verdict.mjs server|full\n');
    process.exitCode = 2;
    return;
  }
  process.stdout.write(verdict.reason + '\n');
  process.exitCode = verdict.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
