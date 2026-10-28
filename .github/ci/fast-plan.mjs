// The server tests a FAST pull request runs (operator ruling 2026-10-28). An ordinary pull request
// (reach.mjs `fastRun`) runs only the fast checks; for the server suite that is the union of:
//   1. the tests vitest relates to the change: `vitest list --filesOnly --changed <merge base> --json`, run by the
//      `fast-plan` job in server/ and handed here as a file. vitest follows imports from the merge base, and reruns
//      every test when one of its own rerun triggers (a manifest, a vitest config) changed;
//   2. the map's selection for every changed path vitest cannot follow (select-tests.mjs `vitestFollows`: a ccd
//      script, Python, a JSON or SQL fixture, another package's file a server test reads as text). select computes
//      it from the same map it selects from and hands it over as its `untraced` output; `full` there (no usable map,
//      or a path the map cannot bound) makes this plan fall back to select's own selection;
//   3. the guard suites, whatever changed: they scan the whole tree or the diff rather than import what they check,
//      so vitest can never relate them to a change. `guardTests` derives them: the GUARD_TESTS patterns (the
//      censuses, single-definition, deviation-refs, growth-check, ownership, the rings, ccd-contexts, dtbd, the
//      tests-inclusive typecheck, the oss metadata, the pin suites of TypeScript code) and every test whose source
//      lists the tracked tree or reads the diff itself (TREE_READER: a direct `git ls-files`, `git diff` or
//      `git merge-base`, the shape of topology-clean, gitignore-secrets and consolidation-path-guard);
//   4. the session-hook suites when ccd/ccd, ccd/session-hook.sh or shared/api.ts changed (SESSION_HOOK_TRIGGERS):
//      the hook is bash, so no import reaches it.
// What this leaves out — a test the map has no entry for or does not trust, a TypeScript file a test reads as text
// without importing it — the merge queue's full run catches before anything lands; the builder ran the scoped
// tests before pushing.
//
// The plan is packed by measured duration (shards.mjs planShards, PROFILES.linuxFast) from the durations the daily
// run publishes. Every failure — an unreadable vitest list, an `untraced` of `full`, a path no list can carry —
// answers the FALLBACK the caller passes (select's own matrix and count): never "nothing", and never a green over
// tests that did not run. Like select.mjs, this is a CLI that writes $GITHUB_OUTPUT and $GITHUB_STEP_SUMMARY; the
// rules are pure exports.
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
  /^server\/test\/deviation-refs\.test\.ts$/,
  /^server\/test\/growth-check\.test\.ts$/,
  /^server\/test\/ownership\.test\.ts$/,
  /^server\/test\/rings\/.+\.test\.ts$/,
  /^server\/test\/[^/]*-rings\.test\.ts$/,
  /^server\/test\/ccd-contexts\.test\.ts$/,
  /^server\/test\/dtbd\.test\.ts$/,
  /^server\/test\/typecheck-tests\.test\.ts$/,
  // Reads the workflows, the README and the package metadata by name (no import, no listing).
  /^server\/test\/oss-metadata\.test\.ts$/,
  // The pin suites: a pin reads its subject's source as text as often as it imports it. PIN_MAP_CARRIED leaves out
  // the ones whose subject is a script.
  /^server\/test\/[^/]*-pin\.test\.ts$/,
];

/** The pin suites whose subject is a ccd script (bash, spawned in a fixture): the map selects them for a change to
 *  that script (part 2 above), so they are not guards. Each is ~5-110 s; ccd-child-reclaim-pin alone is 108 s. */
export const PIN_MAP_CARRIED = [
  'server/test/account-markers-pin.test.ts',
  'server/test/ccd-child-reclaim-pin.test.ts',
  'server/test/ccd-helpers-pin.test.ts',
  'server/test/ccd-swap-pin.test.ts',
];

/** A test that lists the tracked tree or reads the diff ITSELF — a direct `git ls-files`, `git diff` or
 *  `git merge-base` call (execFileSync / spawnSync / execSync and friends), not one through a fixture helper such
 *  as `h.git(...)`. Such a test checks whatever the change touched, so vitest can never relate it. */
export const TREE_READER = /\b(?:execFileSync|spawnSync|execSync|execFile|spawn)\(\s*['"`]git(?:['"`]\s*,\s*\[[^\]]*?['"`]|\s+(?:-C\s+\S+\s+)?)(?:ls-files|merge-base|diff)\b/;

/**
 * The guard suites among the live tests: a GUARD_TESTS pattern (less PIN_MAP_CARRIED), or a TREE_READER source.
 * @param {string[]} live repo-relative test paths @param {(file: string) => string} readSource @returns {string[]}
 */
export function guardTests(live, readSource) {
  return live.filter((f) => {
    if (GUARD_TESTS.some((re) => re.test(f)) && !PIN_MAP_CARRIED.includes(f)) return true;
    let src = '';
    try { src = readSource(f); } catch { return true; } // unreadable: run it, the safe direction
    return TREE_READER.test(src);
  });
}

/** A change to one of these runs every session-hook suite. */
export const SESSION_HOOK_TRIGGERS = ['ccd/ccd', 'ccd/session-hook.sh', 'shared/api.ts'];
const SESSION_HOOK_TEST = /^server\/test\/session-hook[^/]*\.test\.ts$/;

/**
 * The fast selection: the related tests and the map's untraced selection that are live, every guard suite, and
 * the session-hook suites when a trigger changed. Sorted, without duplicates. Paths are repo-relative
 * (`server/test/x.test.ts`).
 * @param {{ live: string[], related: string[], untraced?: string[], guards: string[], changed: string[] }} args
 * @returns {{ files: string[], related: number, untraced: number, guards: number, hook: boolean }}
 */
export function fastSelection({ live, related, untraced = [], guards, changed }) {
  const liveSet = new Set(live);
  const relatedLive = related.filter((f) => liveSet.has(f));
  const untracedLive = untraced.filter((f) => liveSet.has(f));
  const chosen = new Set([...relatedLive, ...untracedLive]);
  const guardLive = guards.filter((f) => liveSet.has(f));
  for (const f of guardLive) chosen.add(f);
  const files = changed.map((f) => f.trim()).filter(Boolean);
  const hook = files.some((f) => SESSION_HOOK_TRIGGERS.includes(f));
  if (hook) for (const f of live) if (SESSION_HOOK_TEST.test(f)) chosen.add(f);
  return { files: [...chosen].sort(), related: new Set(relatedLive).size, untraced: new Set(untracedLive).size, guards: guardLive.length, hook };
}

/**
 * select's `untraced` output, as fast-plan reads it: a JSON array of repo-relative test paths. `full` (nothing
 * bounds what the change reaches), empty text or any other shape throws, and the caller falls back.
 * @param {string} text @returns {string[]}
 */
export function parseUntraced(text) {
  const t = text.trim();
  if (t === 'full') throw new Error('the map cannot bound a changed path vitest cannot follow (select answered untraced=full)');
  if (t === '') throw new Error('select handed no untraced selection');
  const v = JSON.parse(t);
  if (!Array.isArray(v) || v.some((f) => typeof f !== 'string')) throw new Error('the untraced selection is not an array of paths');
  return v;
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
    if (!opt.untraced) throw new Error('no --untraced file was handed in');
    const untraced = parseUntraced(readFileSync(opt.untraced, 'utf8'));
    const changed = execFileSync('git', ['diff', '--name-only', '--no-renames', opt.base, 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).split('\n');
    const guards = guardTests(live, (f) => readFileSync(path.join(repoDir, f), 'utf8'));
    const sel = fastSelection({ live, related, untraced, guards, changed });
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
      `${sel.files.length} test file(s) in ${plan.length} shard(s): ${sel.related} related to the change by vitest, ${sel.untraced} the map selects for paths vitest cannot follow, ${sel.guards} guard suite(s)${sel.hook ? ', and the session-hook suites (a hook trigger changed)' : ''}. The merge queue runs the full suite.`,
      '',
      ...sel.files.map((f) => `- \`${f}\``),
      '',
    ];
    writeSummary(lines.join('\n'));
    console.log(`fast plan: ${sel.files.length} file(s), ${plan.length} shard(s) (${sel.related} related, ${sel.untraced} untraced, ${sel.guards} guards, session-hook ${sel.hook})`);
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
