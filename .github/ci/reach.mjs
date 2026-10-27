// The light pull-request rule for the suites that have no dependency map
// (operator ruling 2026-10-25). The server suite is selected from a traced
// map (select.mjs); the agent suite, the pwa shards and the browser leg are
// not, so a pull request asks THIS module whether its change can reach them,
// and runs their tests only when it can. The typechecks, the build and the
// required check names do not depend on the answer: only the test steps skip.
//
// Written as the INVERSE of a reach list on purpose. "Run when the change
// touches agent/ or shared/" would miss every file a test reads from another
// tree (the agent's vitest setup lives in server/test, the pwa suite renders
// docs/). So the rule names what a package provably does NOT read, and a
// package skips only when EVERY changed file is one of those. Anything
// unlisted, an empty change, an unknown package and a diff that cannot be
// taken all RUN the tests: the safe direction.
//
// Only a `pull_request` can skip. A merge-queue run, the daily run, a
// dispatch and a call all run every test, and so does a pull request that
// carries the `full-ci` label or changes `.github/` (the Select step decides
// both for the server suite; this module repeats the label and the `.github/`
// rule, which falls out of `.github/` being foreign to nobody).

import { appendFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Directory prefixes (with the trailing slash) that a package's tests never read. */
export const FOREIGN = {
  agent: ['pwa/', 'ui/'],
  pwa: ['agent/', 'server/', 'ccd/', 'deploy/'],
  browser: ['agent/', 'server/', 'ccd/', 'deploy/'],
};

/**
 * Paths under a foreign prefix that the package's tests DO read, so a change
 * to one still runs them. A path ending in `/` is a directory. The list is
 * pinned to the tests by the census in server/test/ci-reach-census.test.ts,
 * which scans every path literal that leaves a tree and goes red when one
 * resolves under a foreign prefix without an entry here.
 */
export const READS = {
  pwa: ['server/test/fixtures/', 'server/src/laneSchedule.ts'],
  browser: ['server/test/fixtures/', 'server/src/laneSchedule.ts'],
};

/**
 * Whether a package may skip its tests for this change: true only when the
 * change is non-empty and every file is under one of its foreign prefixes.
 * @param {string} pkg @param {string[]} changed
 */
export function skipsTests(pkg, changed) {
  const foreign = Object.hasOwn(FOREIGN, pkg) ? FOREIGN[pkg] : undefined;
  if (!foreign) return false;
  const files = changed.map((f) => f.trim()).filter(Boolean);
  if (files.length === 0) return false;
  const reads = Object.hasOwn(READS, pkg) ? READS[pkg] : [];
  const read = (/** @type {string} */ f) => reads.some((r) => (r.endsWith('/') ? `${f}/`.startsWith(r) : f === r));
  return files.every((f) => foreign.some((p) => f.startsWith(p)) && !read(f));
}

/**
 * Paths whose effect on the pwa tests vitest can follow through imports, so
 * `vitest --changed` selects them exactly: TypeScript (and the .mjs/.mts of
 * shared/) only. Anything else — a stylesheet, JSON, an asset or a font under
 * pwa/src or ui/src, docs/, a fixture read with fs, package files, vite and
 * vitest configs, the root — is reached some other way (many pwa suites read
 * the CSS and the source tree with node:fs) and runs every pwa test.
 */
const IMPORTABLE = [/^pwa\/src\/.+\.tsx?$/, /^ui\/src\/.+\.tsx?$/, /^shared\/.+\.(?:ts|tsx|mts|mjs)$/, /^pwa\/test\/[^/]+\.(?:ts|tsx|mts)$/];

/**
 * How much of a package's tests a pull request runs: `skip` (none), `changed`
 * (only the tests vitest relates to the change, plus `alwaysRunPwaTests`) or
 * `all`. Only the pwa shards have `changed`.
 * @param {string} pkg @param {string[]} changed @returns {'skip'|'changed'|'all'}
 */
export function scopeOf(pkg, changed) {
  if (skipsTests(pkg, changed)) return 'skip';
  if (pkg !== 'pwa') return 'all';
  const files = changed.map((f) => f.trim()).filter(Boolean);
  if (files.length === 0) return 'all';
  const foreign = FOREIGN.pwa;
  const reads = READS.pwa;
  const isForeign = (/** @type {string} */ f) => foreign.some((p) => f.startsWith(p)) && !reads.some((r) => (r.endsWith('/') ? `${f}/`.startsWith(r) : f === r));
  return files.every((f) => isForeign(f) || IMPORTABLE.some((re) => re.test(f))) ? 'changed' : 'all';
}

/** A string literal naming node:fs (`'fs'`, `'node:fs'`, `'node:fs/promises'`), in any import form. */
const FS_MODULE = /['"`](?:node:)?fs(?:\/promises)?['"`]/;
/** A relative module specifier in an import, a re-export, a dynamic import or a require. */
const RELATIVE_IMPORT = /(?:\bfrom|\bimport|\bimport\s*\(|\brequire\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g;
const RESOLVE_EXT = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '/index.ts', '/index.tsx'];

/**
 * The pwa test files a `changed` pull request runs whatever it changed: every
 * test that can read the tree from disk, because `vitest --changed` follows
 * imports and a suite that scans pwa/src or ui/src with node:fs (css-vars,
 * contrast, the boundary and census suites, ...) imports none of what it reads.
 * DERIVED, not listed: a test is in the set when it, or a pwa/test helper it
 * imports (transitively: sourceScan.ts, literalWalker.ts, ...), names node:fs.
 * That is a superset of "reads src/" on purpose — it costs a few suites that
 * only read fixtures, and it cannot miss one that reads the source through a
 * helper. Every census and guard suite rides along by name. Paths are
 * pwa-relative (`test/css-vars.test.ts`), sorted. A census in
 * server/test/ci-reach.test.ts pins it from the other side: a pwa test that
 * calls an fs read must be in this set.
 * @param {string} root the repository root
 * @returns {string[]}
 */
export function alwaysRunPwaTests(root) {
  const pwa = path.join(root, 'pwa');
  /** @type {Map<string, boolean>} */
  const memo = new Map();
  const usesFs = (/** @type {string} */ file) => {
    if (memo.has(file)) return /** @type {boolean} */ (memo.get(file));
    memo.set(file, false); // a cycle reads as "no" until proven otherwise
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch { return false; }
    let yes = FS_MODULE.test(text);
    if (!yes) {
      for (const m of text.matchAll(RELATIVE_IMPORT)) {
        const spec = m[1].replace(/\.js$/, '');
        const base = path.resolve(path.dirname(file), spec);
        // Only the pwa test tree's own helpers: a pwa/src or shared/ module that names fs does so for the server
        // side (shared/api.ts), and a change to it is an import vitest follows.
        if (!base.startsWith(path.join(pwa, 'test') + path.sep) || base.includes(`${path.sep}node_modules${path.sep}`)) continue;
        const hit = RESOLVE_EXT.map((e) => base + e).find((c) => existsSync(c) && statSync(c).isFile());
        if (hit && /\.(?:ts|tsx|mts|mjs|js)$/.test(hit) && usesFs(hit)) { yes = true; break; }
      }
    }
    memo.set(file, yes);
    return yes;
  };
  /** @param {string} dir @returns {string[]} */
  const walk = (dir) => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'dist' ? [] : walk(p);
      return /\.test\.tsx?$/.test(e.name) ? [p] : [];
    });
  };
  return [path.join(pwa, 'test'), path.join(pwa, 'src')].flatMap(walk)
    .filter((f) => /-(?:census|guard)\.test\.tsx?$/.test(f) || usesFs(f))
    .map((f) => path.relative(pwa, f).split(path.sep).join('/'))
    .sort();
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

function changedFiles(opt) {
  if (opt['changed-file']) return readFileSync(opt['changed-file'], 'utf8').split('\n');
  const mb = execFileSync('git', ['merge-base', opt.base, 'HEAD'], { encoding: 'utf8' }).trim();
  return execFileSync('git', ['diff', '--name-only', '--no-renames', mb, 'HEAD'], { encoding: 'utf8' }).split('\n');
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  let skip = false;
  let scope = 'all';
  let why = 'every test runs';
  if (opt.event === 'pull_request' && opt['full-label'] !== 'true') {
    try {
      scope = scopeOf(opt.pkg, changedFiles(opt));
      skip = scope === 'skip';
      why = skip ? `no changed file can reach the ${opt.pkg} tests` : `a changed file can reach the ${opt.pkg} tests`;
    } catch (e) {
      console.log(`::warning::could not diff this change (${e instanceof Error ? e.message : e}); running the ${opt.pkg} tests`);
    }
  } else if (opt['full-label'] === 'true') {
    why = 'the full-ci label asks for every test';
  }
  // A `changed` pwa run also runs the suites that read the tree from disk (alwaysRunPwaTests): they ride every
  // shard, sharded with the rest. Unreadable: fall back to everything, the safe direction.
  let always = '';
  if (scope === 'changed') {
    try {
      always = alwaysRunPwaTests(path.resolve(opt.repo ?? process.cwd())).join(' ');
      if (!always) throw new Error('no pwa test reads from disk');
      console.log(`${opt.pkg}: ${always.split(' ').length} test file(s) that read the tree from disk run whatever changed`);
    } catch (e) {
      console.log(`::warning::could not list the pwa tests that read from disk (${e instanceof Error ? e.message : e}); running every pwa test`);
      scope = 'all';
      always = '';
    }
  }
  console.log(`${opt.pkg}: ${skip ? 'tests skipped' : `tests run (${scope})`} — ${why}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `skip=${skip}\nscope=${scope}\nalways=${always}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
