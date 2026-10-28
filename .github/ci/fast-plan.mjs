// The server tests a FAST pull request runs (operator ruling 2026-10-28). An ordinary pull request
// (reach.mjs `fastRun`) runs only the fast checks; for the server suite that is:
//   1. the tests vitest relates to the change: `vitest list --filesOnly --changed <merge base> --json`, run by the
//      `fast-plan` job in server/ and handed here as a file. vitest follows imports from the merge base, and reruns
//      every test when one of its own rerun triggers (a manifest, a vitest config) changed;
//   2. the guard suites, whatever changed: they scan the whole tree rather than import what they check, so vitest
//      can never relate them to a change (GUARD_TESTS below: the censuses, single-definition, deviation-refs,
//      growth-check, ownership, the rings, ccd-contexts, dtbd, and the tests-inclusive typecheck);
//   3. the session-hook suites when ccd/ccd, ccd/session-hook.sh or shared/api.ts changed (SESSION_HOOK_TRIGGERS):
//      the hook is bash, so no import reaches it.
// What this leaves out — a test that reaches a change only through a spawned script, a read file or a trace — the
// merge queue's full run catches before anything lands; the builder ran the scoped tests before pushing.
//
// The plan is packed by measured duration (shards.mjs planShards, PROFILES.linuxFast) from the durations the daily
// run publishes. Every failure — an unreadable vitest list, a path no list can carry — answers the FALLBACK the
// caller passes (select's own matrix and count): never "nothing", and never a green over tests that did not run.
// Like select.mjs, this is a CLI that writes $GITHUB_OUTPUT and $GITHUB_STEP_SUMMARY; the rules are pure exports.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { liveTestFiles, unsafeTestPaths } from './select-tests.mjs';
import { planShards, toMatrix, PROFILES } from './shards.mjs';

/** Repo-relative patterns of the server suites that read the whole tree, so they run on every fast pull request. */
export const GUARD_TESTS = [
  /^server\/test\/census-w[^/]*\/.+\.test\.ts$/,
  /^server\/test\/[^/]*census[^/]*\.test\.ts$/,
  /^server\/test\/single-definition\/.+\.test\.ts$/,
  /^server\/test\/single-definition-pin\.test\.ts$/,
  /^server\/test\/deviation-refs\.test\.ts$/,
  /^server\/test\/growth-check\.test\.ts$/,
  /^server\/test\/ownership\.test\.ts$/,
  /^server\/test\/rings\/.+\.test\.ts$/,
  /^server\/test\/[^/]*-rings\.test\.ts$/,
  /^server\/test\/ccd-contexts\.test\.ts$/,
  /^server\/test\/dtbd\.test\.ts$/,
  /^server\/test\/typecheck-tests\.test\.ts$/,
];

/** A change to one of these runs every session-hook suite. */
export const SESSION_HOOK_TRIGGERS = ['ccd/ccd', 'ccd/session-hook.sh', 'shared/api.ts'];
const SESSION_HOOK_TEST = /^server\/test\/session-hook[^/]*\.test\.ts$/;

/**
 * The fast selection: the related tests that are live, every guard suite, and the session-hook suites when a
 * trigger changed. Sorted, without duplicates. Paths are repo-relative (`server/test/x.test.ts`).
 * @param {{ live: string[], related: string[], changed: string[] }} args
 * @returns {{ files: string[], related: number, guards: number, hook: boolean }}
 */
export function fastSelection({ live, related, changed }) {
  const liveSet = new Set(live);
  const chosen = new Set(related.filter((f) => liveSet.has(f)));
  const relatedCount = chosen.size;
  const guards = live.filter((f) => GUARD_TESTS.some((re) => re.test(f)));
  for (const f of guards) chosen.add(f);
  const files = changed.map((f) => f.trim()).filter(Boolean);
  const hook = files.some((f) => SESSION_HOOK_TRIGGERS.includes(f));
  if (hook) for (const f of live) if (SESSION_HOOK_TEST.test(f)) chosen.add(f);
  return { files: [...chosen].sort(), related: relatedCount, guards: guards.length, hook };
}

/**
 * The repo-relative test files in a `vitest list --filesOnly --json` report: an array of `{ file }` with absolute
 * paths. A report that is not that shape throws (the caller falls back).
 * @param {unknown} report @param {string} repoDir @returns {string[]}
 */
export function relatedFromVitestList(report, repoDir) {
  if (!Array.isArray(report)) throw new Error('the vitest list report is not an array');
  const root = path.resolve(repoDir);
  return report.map((entry) => {
    const file = entry && typeof entry === 'object' ? /** @type {{ file?: unknown }} */ (entry).file : undefined;
    if (typeof file !== 'string') throw new Error('a vitest list entry carries no file');
    const rel = path.relative(root, path.resolve(root, 'server', file)).split(path.sep).join('/');
    if (rel.startsWith('..')) throw new Error(`a vitest list entry is outside the repository: ${file}`);
    return rel;
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (key && key.startsWith('--')) out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

/** @param {Record<string, string>} outputs */
function writeOutputs(outputs) {
  const text = Object.entries(outputs).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text);
  else process.stdout.write(text);
}

/** @param {string} md */
function writeSummary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  const repoDir = opt.repo ?? process.cwd();
  const fallbackMatrix = opt['fallback-matrix'] ?? '';
  const fallbackCount = opt['fallback-count'] ?? '';
  try {
    const live = liveTestFiles(repoDir);
    if (live.length === 0) throw new Error('no live server test files under server/test');
    const report = readFileSync(opt.related, 'utf8');
    // vitest prints `[]` when no test relates to the change; an empty report reads the same.
    const related = report.trim() === '' ? [] : relatedFromVitestList(JSON.parse(report), repoDir);
    const changed = execFileSync('git', ['diff', '--name-only', '--no-renames', opt.base, 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).split('\n');
    const sel = fastSelection({ live, related, changed });
    // Never an empty matrix: the guard suites always run, so an empty selection means the lists went blind.
    if (sel.files.length === 0) throw new Error('the fast selection is empty — no guard suite matched');
    const unsafe = unsafeTestPaths(sel.files);
    if (unsafe.length > 0) throw new Error(`a selected test path no shard list can carry: ${unsafe.map((f) => JSON.stringify(f)).join(', ')}`);
    let durations = null;
    if (opt.times) {
      try { durations = JSON.parse(readFileSync(opt.times, 'utf8')); } catch { durations = null; }
    }
    const plan = planShards(sel.files, durations, PROFILES.linuxFast);
    writeOutputs({ server_matrix: JSON.stringify(toMatrix(plan)), count: String(sel.files.length), fallback: '' });
    const lines = [
      '## Fast server tests (an ordinary pull request)',
      '',
      `${sel.files.length} test file(s) in ${plan.length} shard(s): ${sel.related} related to the change by vitest, ${sel.guards} guard suite(s)${sel.hook ? ', and the session-hook suites (a hook trigger changed)' : ''}. The merge queue runs the full suite.`,
      '',
      ...sel.files.map((f) => `- \`${f}\``),
      '',
    ];
    writeSummary(lines.join('\n'));
    console.log(`fast plan: ${sel.files.length} file(s), ${plan.length} shard(s) (${sel.related} related, ${sel.guards} guards, session-hook ${sel.hook})`);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (!fallbackMatrix || !fallbackCount) {
      console.error(`fast-plan.mjs: ${reason}, and no fallback was handed in`);
      process.exitCode = 1;
      return;
    }
    console.log(`::warning::the fast plan failed (${reason}); running select's selection instead`);
    writeOutputs({ server_matrix: fallbackMatrix, count: fallbackCount, fallback: reason.replace(/\n/g, ' ') });
    writeSummary(`## Fast server tests\n\nThe fast plan failed (${reason}); this run runs select's selection instead.\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
