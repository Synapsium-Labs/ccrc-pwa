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
import { BaseSequencer } from 'vitest/node';
import type { TestSpecification } from 'vitest/node';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { orderLongestFirst } from '../.github/ci/shards.mjs';
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

/** Starts a shard's longest file first, so a 400 s file cannot start last and stretch the shard. Vitest runs
 *  files in an arbitrary order by default (its own cache of past durations, which a fresh CI runner lacks).
 *  The order is the recorded durations in `CCRC_TEST_TIMES` (the `testtimes.json` artifact; repo-relative keys)
 *  when that names a file, else the order of `CCRC_TEST_LIST`, which the shard planner emits longest first. A
 *  file in neither sorts at the median. `shard()` is vitest's own, so WHICH files run is unchanged. When the plan
 *  had no durations (the `--shard` fallback: every shard gets the whole list, in no meaningful order) and no
 *  `CCRC_TEST_TIMES` is set, the order is `BaseSequencer`'s default. The specifications are sorted with a
 *  comparator, so two that share a `moduleId` both stay. */
class LongestFirstSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const durations = loadDurations(this.ctx?.config?.shard != null);
    if (durations === null) return super.sort(files);
    const serverDir = path.dirname(fileURLToPath(import.meta.url));
    const key = (f: TestSpecification) => 'server/' + path.relative(serverDir, f.moduleId).split(path.sep).join('/');
    const rank = new Map(orderLongestFirst([...new Set(files.map(key))], durations).map((k, i) => [k, i]));
    return [...files].sort((a, b) => rank.get(key(a))! - rank.get(key(b))!);
  }
}

/** The durations to order by, or `null` for vitest's default order: recorded times when `CCRC_TEST_TIMES` is
 *  set, else the list's own order, except under `--shard`, where the list is not longest first. */
function loadDurations(sharded: boolean): Record<string, number> | null {
  const timesFile = process.env.CCRC_TEST_TIMES;
  if (timesFile) return JSON.parse(readFileSync(timesFile, 'utf8')) as Record<string, number>;
  const list = process.env.CCRC_TEST_LIST;
  if (!list || sharded) return null;
  const lines = readTestList(list);
  return Object.fromEntries(lines.map((line, i) => ['server/' + line, lines.length - i]));
}

const listFile = process.env.CCRC_TEST_LIST;

const merged: UserConfig = mergeConfig(base, defineConfig({}));

if (listFile) {
  merged.test = {
    ...merged.test,
    include: readTestList(listFile),
    sequence: { ...merged.test?.sequence, sequencer: LongestFirstSequencer },
  };
}

export default merged;
