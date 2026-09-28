// CI test selection (spec `docs/superpowers/specs/2026-09-23-ci-test-selection-design.md` §7.2): vitest's own
// positional file arguments are SUBSTRING filters — `a.test.ts` also runs `xa.test.ts` (measured) — so a shard
// cannot hand vitest a file list on the command line and trust it to run exactly that list. This config is the
// fix: when `CCRC_TEST_LIST` names a file, `test.include` becomes EXACTLY the paths in it (vitest's `include`
// glob patterns match a literal path exactly when the pattern contains no glob metacharacters, which a plain
// repo-relative test path never does).
//
// Every other CI mechanism that runs server tests routes through this file: a sharded PR/full-mode run (§7.2),
// and every per-file traced run in `.github/ci/trace-run.mjs` (§5.1) — one file per `vitest run` invocation, via
// the same `CCRC_TEST_LIST` mechanism (a one-line list file).
//
// Unset `CCRC_TEST_LIST` (a developer running `npm test`, or any job that intentionally runs the full glob):
// this file resolves to something behaviourally IDENTICAL to `vitest.config.ts` — same `include`, same timeouts,
// same `maxWorkers`. `mergeConfig(base, {})` is used to reach that state (rather than re-exporting `base`
// directly) so this file and `vitest.config.ts` are provably the same merge machinery in both branches, not two
// different code paths that happen to agree today.
//
// `mergeConfig` (vite's, re-exported by `vitest/config`) DEEP-MERGES and, for array-valued fields, CONCATENATES
// them — `mergeConfig({test:{include:['a']}}, {test:{include:['b']}})` answers `include:['a','b']`, not `['b']`.
// Passing the exact-list straight into `mergeConfig`'s second argument would therefore APPEND it onto the base
// glob instead of replacing it, silently re-including every test the glob already matched. `test.include` is
// reassigned explicitly, after the merge, to avoid exactly that.
import { defineConfig, mergeConfig } from 'vitest/config';
import type { ViteUserConfig as UserConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import base from './vitest.config.js';

/** Reads `CCRC_TEST_LIST`: one server-relative test path per line, blank lines ignored. Throws a clear error
 *  (never returns an empty list, never falls back to the full glob) when the file is missing or carries no
 *  non-blank line — an empty selection silently running everything is exactly the failure mode §6.3 forbids. */
export function readTestList(file: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `vitest.select.config.ts: CCRC_TEST_LIST=${file} could not be read: ${msg}`,
    );
  }
  const lines = raw.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new Error(`vitest.select.config.ts: CCRC_TEST_LIST=${file} is empty`);
  }
  return lines;
}

const listFile = process.env.CCRC_TEST_LIST;

const merged: UserConfig = mergeConfig(base, defineConfig({}));

if (listFile) {
  merged.test = { ...merged.test, include: readTestList(listFile) };
}

export default merged;
