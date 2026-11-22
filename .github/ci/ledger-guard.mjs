// D-6926: a feature pull request does not edit the shared programme and plan ledgers.
//
// Shared ledger documents under docs/superpowers/programs/ and docs/superpowers/plans/ were the largest
// single cause of sync conflicts: every in-flight pull request of a wave edited the same rows, so each
// absorption of the base branch conflicted there. The README already says ledger documents belong on the
// coordinator's ledger pull request; this makes it a check.
//
// THE RULE: a pull request whose head branch is not a ledger branch (`ledger/<programme>`) may not MODIFY,
// DELETE or RENAME AWAY an existing file under either tree. It may ADD files: a per-task note at
// docs/superpowers/programs/<programme>/<task-or-pr>.md is the intended route (D-8719; notes added before it under
// docs/superpowers/plans/<plan>/ stay where they are), and the coordinator folds the notes into the ledger in one
// ledger pull request per wave. There is deliberately no `merge=union` driver: it silently corrupts a row edited in
// place.
//
// THE LAYOUT ARM (D-8719): the in-repo mirror of the repo's review judge's layout rule (its format F1), so CI names a
// misplaced file before the judge does. A file ADDED or COPIED, or the TARGET of a rename, under
// docs/superpowers/specs/ must be `YYYY-MM-DD-<slug>-design.md` or `YYYY-MM-DD-<slug>-design.promise-ids.json`, and
// under docs/superpowers/plans/ must be `YYYY-MM-DD-<slug>.md`, each directly in that directory (new specs are
// markdown: the judge's settings for this repo name that format). `<slug>` is `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, at
// most 40 characters. It holds on EVERY branch, ledger branches included, and no trailer escapes it, because the
// judge has no escape. An existing file, an edit to one and a deletion are never a layout violation. A path git
// quotes (a byte outside the slug set) can never take the layout, so it is reported as it is quoted.
// A spec's images, mockup pages and other non-spec files go under docs/design/<spec file name less its extension>/,
// which the judge classes as editorial and its layout rule does not read; the spec links to them by relative path.
//
// ESCAPE (the edit arm only): a `Ledger-Edit: <reason>` trailer on the HEAD commit of the change passes the edit arm and is written to the
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

// D-8719: the review judge's layout (format F1), for this repo's settings: specs.dir and plans.dir below, specs in
// markdown, no slice files. One copy of the rule, read by `layoutViolations` alone.
const SPECS_DIR = 'docs/superpowers/specs/';
const PLANS_DIR = 'docs/superpowers/plans/';
const SLUG = '[a-z][a-z0-9]*(?:-[a-z0-9]+)*';
const DATE = '[0-9]{4}-[0-9]{2}-[0-9]{2}';
const SLUG_MAX = 40;
const SPEC_NAME = new RegExp(`^${DATE}-(${SLUG})-design(?:\\.md|\\.promise-ids\\.json)$`);
const PLAN_NAME = new RegExp(`^${DATE}-(${SLUG})\\.md$`);
const NOTE_ROUTE = 'docs/superpowers/programs/<programme>/<task-or-pr>.md';
const SPEC_SHAPE = `${SPECS_DIR}YYYY-MM-DD-<slug>-design.md (or its -design.promise-ids.json), directly in ${SPECS_DIR}; `
  + 'a spec\'s images, mockup pages and other non-spec files go under docs/design/<spec file name without its extension>/';
const PLAN_SHAPE = `${PLANS_DIR}YYYY-MM-DD-<slug>.md, directly in ${PLANS_DIR}; a task note goes to ${NOTE_ROUTE}`;

/** True when a file name in one layout directory takes that directory's shape with a slug of at most SLUG_MAX characters. */
const layoutFits = (name, re) => {
  const m = re.exec(name);
  return m !== null && m[1].length <= SLUG_MAX;
};

/**
 * `git diff --name-status -M` lines in, the new paths under specs/ or plans/ that do not take the judge's layout
 * out, each with the shape it should take. A new path is an added or copied file or a rename's TARGET; a
 * modification, a deletion and a rename's source are never a layout violation.
 * @param {string[]} lines
 * @returns {{path: string, shape: string}[]}
 */
export function layoutViolations(lines) {
  const out = [];
  for (const line of lines) {
    const parts = line.split('\t');
    const status = parts[0];
    if (!status) continue;
    const kind = status[0];
    let target;
    if (kind === 'A') target = parts[1];
    else if (kind === 'C' || kind === 'R') target = parts[2];
    else continue;
    if (target === undefined) continue;
    // A quoted path opens with `"`; it holds a byte outside the slug set, so it never fits, but it is still placed.
    const bare = target.startsWith('"') ? target.slice(1) : target;
    // `name` keeps every directory below specs/ or plans/, and no slug or date holds a `/`, so a nested file never fits.
    if (bare.startsWith(SPECS_DIR)) {
      const name = bare.slice(SPECS_DIR.length);
      if (target !== bare || !layoutFits(name, SPEC_NAME)) out.push({ path: target, shape: SPEC_SHAPE });
    } else if (bare.startsWith(PLANS_DIR)) {
      const name = bare.slice(PLANS_DIR.length);
      if (target !== bare || !layoutFits(name, PLAN_NAME)) out.push({ path: target, shape: PLAN_SHAPE });
    }
  }
  return out;
}

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
  const layout = layoutViolations(lines);
  const editsOk = editArm(git, branch, lines);
  const layoutOk = layoutArm(layout);
  if (editsOk && layoutOk) { process.exitCode = 0; return; }
  if (mode === 'warn') { console.log('ledger-guard: warn mode, not failing'); process.exitCode = 0; return; }
  process.exitCode = 1;
}

/** D-6926's arm: true when no existing ledger file is edited, the branch is a ledger branch, or the trailer passes. */
function editArm(git, branch, lines) {
  if (isLedgerBranch(branch)) {
    summary(`ledger-guard: ${branch} is a ledger branch; ledger edits are its job`);
    return true;
  }
  const violations = classifyChange(lines);
  if (violations.length === 0) {
    summary('ledger-guard: ok, no existing programme or plan file is edited');
    return true;
  }
  const reasons = ledgerEditReasons(git('log', '-1', '--format=%(trailers:key=Ledger-Edit,valueonly)', 'HEAD'));
  const list = violations.map((v) => `  - ${v}`).join('\n');
  if (reasons.length > 0) {
    summary(`ledger-guard: PASSED BY Ledger-Edit trailer (${reasons.map((r) => `"${r}"`).join('; ')}). Files covered:\n${list}`);
    return true;
  }
  summary(
    `ledger-guard: ${violations.length} shared ledger file(s) edited outside a ledger branch:\n${list}\n`
    + `Put the change in a per-task note, ${NOTE_ROUTE} (a new file), and let the `
    + 'coordinator fold it into the ledger on its ledger pull request. If this edit is genuinely this change\'s own, '
    + 'add a `Ledger-Edit: <D-TBD reason>` trailer to the head commit.');
  return false;
}

/** D-8719's arm: true when every new file under specs/ and plans/ takes the judge's layout. No branch or trailer escapes. */
function layoutArm(layout) {
  if (layout.length === 0) {
    summary('ledger-guard: layout ok, every new spec and plan file takes the review judge\'s layout');
    return true;
  }
  const list = layout.map((v) => `  - ${v.path}\n      should be ${v.shape}`).join('\n');
  summary(
    `ledger-guard: layout: ${layout.length} new file(s) under docs/superpowers/specs/ or plans/ outside the review `
    + `judge's layout (it reports these as spec-misplaced):\n${list}\n`
    + `<slug> is lowercase letters and digits in words joined by single hyphens, at most ${SLUG_MAX} characters. `
    + `A per-task note goes to ${NOTE_ROUTE}. No branch and no Ledger-Edit trailer escapes this arm.`);
  return false;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(e); process.exitCode = 1; }
}
