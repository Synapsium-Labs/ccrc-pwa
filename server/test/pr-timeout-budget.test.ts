/**
 * The `pr-state` time budget, pinned ACROSS THE TWO LANGUAGES that own its
 * halves — because a comment tried to hold this relationship and got it exactly
 * backwards.
 *
 * `ccd pr-state --project` now makes TWO network calls: the row window
 * (`PR_GH_TIMEOUT`) and the open-PR check rollup (`PR_GH_CHECKS_TIMEOUT`),
 * both in bash. What KILLS the whole verb is in TypeScript, one process and one
 * box away: `CCD_VERB_TIMEOUT_MS['pr-state']` in `server/src/remote/runner.ts`,
 * applied by `timeoutMsFor` to every `runCcd` in remote mode — this fleet's
 * standing config.
 *
 * Neither file can import the other's constant, so the relationship lived in a
 * comment, and the comment asserted that the map had NO `pr-state` key and the
 * live bound was the flat 90 s default. It ships `'pr-state': 20_000` as the
 * FIRST key in that map, and has since 27946f31. Under the number the comment
 * believed, `12 + 6` was comfortable; under the number that actually ships it
 * left TWO SECONDS for `_pr_state_one` to loop every workspace of the project,
 * each costing a dozen-odd `git` spawns plus a python3 interpreter start.
 *
 * So this reads all three numbers from their real sources and asserts the
 * arithmetic. It is deliberately a BUDGET assertion rather than three literal
 * pins: the numbers may move, and what must not move is that the two calls
 * cannot eat the bound.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// `CCD` is the ONE spelling of the ccd script's path in this tree.
// `single-definition.test.ts` fails the build on a second one — and it caught
// this file twice: first for joining the path itself, then for quoting that
// join in this very comment, because the scan is textual and does not care
// whether a spelling is code.
import { CCD } from './ccdWsHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');

/** A bare `NAME=<seconds>` assignment in ccd, in seconds. */
function ccdSeconds(name: string): number {
  const src = readFileSync(CCD, 'utf8');
  const m = new RegExp(`^${name}=(\\d+)`, 'm').exec(src);
  expect(m, `ccd no longer defines ${name} as a bare integer assignment — this gate went blind`).not.toBeNull();
  return Number(m![1]);
}

/** `CCD_VERB_TIMEOUT_MS['<verb>']`, in milliseconds, read from the TS source. */
function verbTimeoutMs(verb: string): number {
  const src = readFileSync(path.join(ROOT, 'server', 'src', 'remote', 'runner.ts'), 'utf8');
  const m = new RegExp(`'${verb}':\\s*([\\d_]+)`).exec(src);
  expect(m, `CCD_VERB_TIMEOUT_MS no longer carries a '${verb}' key — if that is deliberate, the flat `
    + `CCD_TIMEOUT_MS default now applies and this budget must be re-derived against it`).not.toBeNull();
  return Number(m![1].replace(/_/g, ''));
}

describe('pr-state fits inside the bound that kills it', () => {
  // 30% is not a round number for its own sake: `_pr_state_one` runs AFTER both
  // network calls, once per workspace of the project, and each pass shells out
  // roughly a dozen times (`_reg_get` x4, two `rev-parse`s, `rev-list --count`,
  // `_ws_wt_branch`, `_ws_common_dir`) plus one python3 start. On a project
  // with eight workspaces that is seconds, not milliseconds.
  const LOCAL_LOOP_RESERVE = 0.3;

  it('the two gh calls together leave real room for the per-workspace loop', () => {
    const rows = ccdSeconds('PR_GH_TIMEOUT');
    const checks = ccdSeconds('PR_GH_CHECKS_TIMEOUT');
    const outerMs = verbTimeoutMs('pr-state');

    // Guard the guard: a regex that silently stopped matching would make every
    // assertion below vacuous, which is the failure mode this whole file exists
    // to retire one level up.
    expect(rows, 'PR_GH_TIMEOUT read as zero').toBeGreaterThan(0);
    expect(checks, 'PR_GH_CHECKS_TIMEOUT read as zero').toBeGreaterThan(0);
    expect(outerMs, 'the outer bound read as zero').toBeGreaterThan(0);

    const budgetS = outerMs / 1000;
    expect(rows + checks,
      `the two gh calls (${rows}s + ${checks}s) leave only ${budgetS - rows - checks}s of the `
      + `${budgetS}s pr-state bound for _pr_state_one to loop every workspace — raise the bound in `
      + `server/src/remote/runner.ts or lower a timeout in ccd, but do not leave them in this ratio`)
      .toBeLessThanOrEqual(budgetS * (1 - LOCAL_LOOP_RESERVE));
  });

  it('each single call also fits the bound on its own — a trivially true check that stops a silly one', () => {
    // If either call alone could outlive the verb, the sum assertion above
    // would still be satisfiable by making the OTHER one tiny.
    const outerS = verbTimeoutMs('pr-state') / 1000;
    expect(ccdSeconds('PR_GH_TIMEOUT')).toBeLessThan(outerS);
    expect(ccdSeconds('PR_GH_CHECKS_TIMEOUT')).toBeLessThan(outerS);
  });
});
