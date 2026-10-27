// D-6926: a feature pull request does not edit the shared programme and plan ledgers.
//
// Shared ledger documents under docs/superpowers/programs/ and docs/superpowers/plans/ were the largest
// single cause of sync conflicts: every in-flight pull request of a wave edited the same rows, so each
// absorption of the base branch conflicted there. The README already says ledger documents belong on the
// coordinator's ledger pull request; this makes it a check.
//
// THE RULE: a pull request whose head branch is not a ledger branch (`ledger/<programme>`) may not MODIFY,
// DELETE or RENAME AWAY an existing file under either tree. It may ADD files: a per-task note at
// docs/superpowers/plans/<plan>/<task-or-pr>.md is the intended route, and the coordinator folds the notes
// into the ledger in one ledger pull request per wave. There is deliberately no `merge=union` driver: it
// silently corrupts a row edited in place.
//
// ESCAPE: a `Ledger-Edit: <reason>` trailer on the HEAD commit of the change passes the guard and is written to the
// step summary with the files it covers. Only the head commit's trailers count (read with git's own trailer
// parser, `git log -1 --format=%(trailers:key=Ledger-Edit,valueonly)`), so the trailer goes in the last
// paragraph of the newest commit's message and a later push without it re-arms the guard. Without an escape a
// guard that is required would block work.
//
// SKIPS (with a notice, never silently): a shallow checkout (no merge-base to measure), a merge-queue run (its
// head branch is the queue's, and the pull-request run already judged the change), no base ref.
//
// MODE: `--mode enforce` (default) exits 1 on a violation; `--mode warn` reports it and exits 0 (rollout).
//
// FAILS CLOSED like verdict.mjs: exit code is 1 from load, and only a path that reaches a decision sets it.

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

process.exitCode = 1;

const PROTECTED = [/^docs\/superpowers\/programs\//, /^docs\/superpowers\/plans\//];
const LEDGER_BRANCH = /^ledger\/[^/\s]/;

const isProtected = (p) => PROTECTED.some((re) => re.test(p));

/**
 * `git diff --name-status -M` lines in, the protected paths that were modified, deleted, typechanged or
 * renamed away out. An added or copied file is never a violation; a rename counts by its SOURCE path.
 * @param {string[]} lines
 * @returns {string[]}
 */
export function classifyChange(lines) {
  const out = [];
  for (const line of lines) {
    const [status, a] = line.split('\t');
    if (!status || a === undefined) continue;
    if (status[0] === 'A' || status[0] === 'C') continue;
    if (isProtected(a)) out.push(a);
  }
  return out;
}

/** The non-empty reasons in `git log -1 --format=%(trailers:key=Ledger-Edit,valueonly)` output. */
export function ledgerEditReasons(valueOnlyOutput) {
  return valueOnlyOutput.split('\n').map((l) => l.trim()).filter(Boolean);
}

export const isLedgerBranch = (branch) => LEDGER_BRANCH.test(branch);

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const summary = (text) => {
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`); } catch { /* the console line stands */ }
  }
};

function main() {
  const repo = arg('--repo', process.cwd());
  const baseRef = arg('--base', 'origin/main');
  const mode = arg('--mode', process.env.LEDGER_GUARD_MODE || 'enforce');
  if (mode !== 'enforce' && mode !== 'warn') { console.error(`ledger-guard: unknown --mode ${mode}`); return; }
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });

  const event = process.env.GITHUB_EVENT_NAME || '';
  if (event === 'merge_group') {
    summary('ledger-guard: skipped on merge_group (the pull-request run judged this change; the queue has no head branch name)');
    process.exitCode = 0; return;
  }
  const branch = process.env.GITHUB_HEAD_REF || '';
  if (isLedgerBranch(branch)) {
    summary(`ledger-guard: ${branch} is a ledger branch; ledger edits are its job`);
    process.exitCode = 0; return;
  }
  if (git('rev-parse', '--is-shallow-repository').trim() === 'true') {
    summary('ledger-guard: skipped, this is a shallow checkout (no merge-base to measure the change against)');
    process.exitCode = 0; return;
  }
  let base;
  try {
    git('rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`);
    base = git('merge-base', baseRef, 'HEAD').trim();
  } catch {
    summary(`ledger-guard: skipped, no ${baseRef} or merge-base in this checkout`);
    process.exitCode = 0; return;
  }
  const lines = git('diff', '--name-status', '-M', '--no-color', base, 'HEAD').split('\n').filter(Boolean);
  const violations = classifyChange(lines);
  if (violations.length === 0) {
    summary('ledger-guard: ok, no existing programme or plan file is edited');
    process.exitCode = 0; return;
  }
  const reasons = ledgerEditReasons(git('log', '-1', '--format=%(trailers:key=Ledger-Edit,valueonly)', 'HEAD'));
  const list = violations.map((v) => `  - ${v}`).join('\n');
  if (reasons.length > 0) {
    summary(`ledger-guard: PASSED BY Ledger-Edit trailer (${reasons.map((r) => `"${r}"`).join('; ')}). Files covered:\n${list}`);
    process.exitCode = 0; return;
  }
  summary(
    `ledger-guard: ${violations.length} shared ledger file(s) edited outside a ledger branch:\n${list}\n`
    + 'Put the change in a per-task note, docs/superpowers/plans/<plan>/<task-or-pr>.md (a new file), and let the '
    + 'coordinator fold it into the ledger on its ledger pull request. If this edit is genuinely this change\'s own, '
    + 'add a `Ledger-Edit: <D-TBD reason>` trailer to the head commit.');
  if (mode === 'warn') { console.log('ledger-guard: warn mode, not failing'); process.exitCode = 0; return; }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(e); process.exitCode = 1; }
}
