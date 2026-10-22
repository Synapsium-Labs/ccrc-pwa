// deploy/release-scope.mjs: does a merge to main change anything a release ships? (centralised update W25;
// D-6390 to D-6393 and D-6402.)
//
// `NOT_SHIPPED` below is the ONE list of what the build never reads (D-6391). `release-main.sh#measure_change`
// consults it through this file's CLI and nothing else: the release lane skips a merge only when every path it
// changed since the highest release tag is on this list. The classifier is deny-by-default (D-6390): a path on no
// rule, known or new, ships. `server/test/release-scope.test.ts` holds the list against build-release.sh's own
// inputs (D-6396), so a rule cannot quietly name something the build reads.
//
//   node deploy/release-scope.mjs --repo <dir> --base <tag>
//     prints `unchanged <n>` or `changed <n> <first>` (first JSON-quoted) and a newline, exit 0 (D-6393);
//     any failure: message on stderr, nothing on stdout, exit 1; an unknown or missing argument: exit 2.
//
// The diff is `<base>^{commit}` against HEAD with --no-renames (D-6392): a rename out of a shipped tree must name
// the shipped side. A base tag's own copy of this file is run too (D-6402), by release-main.sh and by the runner's
// own node, so this file imports only node:child_process, node:path, node:url and node:process and uses no syntax
// newer than ES2022.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

/** @typedef {{ tree: string, why: string }} TreeRule        a directory at the repository root, by its bare path */
/** @typedef {{ rootExt: '.md', why: string }} RootExtRule   every file at the repository root with this extension */
/** @typedef {{ rootName: string, why: string }} RootNameRule one file at the repository root, by name */

/**
 * What the build never reads. Exactly these six rules (D-6391); a tree is bare, and matches only the path itself
 * and what lies under it.
 * @type {ReadonlyArray<TreeRule | RootExtRule | RootNameRule>}
 */
export const NOT_SHIPPED = Object.freeze([
  Object.freeze({ tree: 'docs', why: 'documentation: no package or script reads it' }),
  Object.freeze({ rootExt: /** @type {'.md'} */ ('.md'), why: 'root markdown (README, CLAUDE, SECURITY, CONTRIBUTING): outside every pathspec' }),
  Object.freeze({ rootName: 'LICENSE', why: 'the licence text: outside every pathspec' }),
  Object.freeze({ tree: 'server/test', why: 'tests: outside server/tsconfig.json include; tsc and vite never read it' }),
  Object.freeze({ tree: 'server/test-e2e', why: 'end-to-end tests: outside server/tsconfig.json include' }),
  Object.freeze({ tree: 'agent/test', why: 'tests: outside agent/tsconfig.json include' }),
]);

/**
 * True iff some rule matches a repo-relative POSIX path.
 * @param {string} path
 * @returns {boolean}
 */
export function notShipped(path) {
  const atRoot = !path.includes('/');
  for (const rule of NOT_SHIPPED) {
    if ('tree' in rule) {
      if (path === rule.tree || path.startsWith(`${rule.tree}/`)) return true;
    } else if ('rootExt' in rule) {
      if (atRoot && path.endsWith(rule.rootExt)) return true;
    } else if (atRoot && path === rule.rootName) {
      return true;
    }
  }
  return false;
}

/**
 * The paths that differ between `base` and HEAD, in git's order. Throws on a non-zero git exit, and before running
 * git when `base` is empty or starts with a dash (git would read it as an option).
 * @param {string} repo
 * @param {string} base
 * @returns {string[]}
 */
export function changedPaths(repo, base) {
  if (typeof base !== 'string' || base === '' || base.startsWith('-')) {
    throw new Error(`base must be a ref, not ${JSON.stringify(base)}`);
  }
  const out = execFileSync(
    'git',
    ['-C', repo, 'diff', '--no-renames', '--no-ext-diff', '--name-only', '-z', `${base}^{commit}`, 'HEAD', '--'],
    { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const paths = out.split('\0');
  if (paths[paths.length - 1] === '') paths.pop();
  return paths;
}

/**
 * `unchanged` counts every changed path (each not shipped, possibly none); `changed` counts the shipped ones and
 * names the first, in the order given.
 * @param {string[]} paths
 * @returns {{ word: 'unchanged', count: number } | { word: 'changed', count: number, first: string }}
 */
export function decide(paths) {
  const shipped = paths.filter((p) => !notShipped(p));
  if (shipped.length === 0) return { word: 'unchanged', count: paths.length };
  return { word: 'changed', count: shipped.length, first: shipped[0] };
}

const USAGE = 'usage: node deploy/release-scope.mjs --repo <dir> --base <tag>';

/**
 * @param {string[]} argv
 * @returns {number} the exit code
 */
export function main(argv) {
  /** @type {string | null} */
  let repo = null;
  /** @type {string | null} */
  let base = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--repo' && repo === null && i + 1 < argv.length) { i += 1; repo = resolve(argv[i]); continue; }
    if (a === '--base' && base === null && i + 1 < argv.length) { i += 1; base = argv[i]; continue; }
    process.stderr.write(`release-scope: unknown, repeated or incomplete argument: ${a}\n${USAGE}\n`);
    return 2;
  }
  if (repo === null || base === null) {
    process.stderr.write(`release-scope: --repo and --base are both required\n${USAGE}\n`);
    return 2;
  }
  let line;
  try {
    const d = decide(changedPaths(repo, base));
    line = d.word === 'unchanged' ? `unchanged ${d.count}\n` : `changed ${d.count} ${JSON.stringify(d.first)}\n`;
  } catch (err) {
    process.stderr.write(`release-scope: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  process.stdout.write(line);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
