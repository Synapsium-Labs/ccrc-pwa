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

import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Directory prefixes (with the trailing slash) that a package's tests never read. */
export const FOREIGN = {
  agent: ['pwa/', 'ui/'],
  pwa: ['agent/', 'server/', 'ccd/', 'deploy/'],
  browser: ['agent/', 'server/', 'ccd/', 'deploy/'],
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
  return files.every((f) => foreign.some((p) => f.startsWith(p)));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

function changedFiles(opt) {
  if (opt['changed-file']) return readFileSync(opt['changed-file'], 'utf8').split('\n');
  const mb = execFileSync('git', ['merge-base', opt.base, 'HEAD'], { encoding: 'utf8' }).trim();
  return execFileSync('git', ['diff', '--name-only', mb, 'HEAD'], { encoding: 'utf8' }).split('\n');
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  let skip = false;
  let why = 'every test runs';
  if (opt.event === 'pull_request' && opt['full-label'] !== 'true') {
    try {
      skip = skipsTests(opt.pkg, changedFiles(opt));
      why = skip ? `no changed file can reach the ${opt.pkg} tests` : `a changed file can reach the ${opt.pkg} tests`;
    } catch (e) {
      console.log(`::warning::could not diff this change (${e instanceof Error ? e.message : e}); running the ${opt.pkg} tests`);
    }
  } else if (opt['full-label'] === 'true') {
    why = 'the full-ci label asks for every test';
  }
  console.log(`${opt.pkg}: ${skip ? 'tests skipped' : 'tests run'} — ${why}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `skip=${skip}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
