# Wave 1e, Task 1: the browser shards' file times, refreshed

Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave1e-browser-shards.md`, Task 1. Base: `main` at
4e17ac96ee0d7e8f99f9dc24515b71f91d2e7190.

## Source

Merge-queue run 45527962041 (2026-11-25), jobs 138915898214 (shard 1/3), 138915898216 (shard 2/3) and 138915898257
(shard 3/3), read with `gh run view --job <id> --log`. The plain `gh api …/jobs/<id>/logs` refuses to print without
`--allow-escape-sequences`; `gh run view` prints the colour codes as the literal text `^[[…m`, so they are stripped
(both the escape byte and its caret spelling) before a line is matched.

A file's line is `✓ browser/<name> (<n> tests) <ms>ms` at the reporter's top level; a test's line is the same mark,
indented under its `describe`, ending in `<ms>ms`.

| measure | the run's logs | the brief |
|---|---|---|
| files | 118 | 118 |
| tests | 4,333 | 4,333 |
| file time | 7,887,041 ms | 7,887,041 ms |
| `project-linking-card.browser.test.ts` | 22 tests, 869,850 ms | 22 tests, 869,850 ms |

The plan's run is kept as the source. Two later queue runs of the night read `success`: 45535140754 skipped the
browser tests (its three shards took about 23 s each), and 45532069453 ran them green, its shards 15.2, 13.8 and
16.1 minutes (jobs 138929574018, 138929574043 and 138929574062). Read the same way, that run reports the same 118 files
and 4,333 tests and 7,400,708 ms, its median file at 1.10 times this table's figure. One file stands out:
`project-linking-card.browser.test.ts` took **425,156 ms** there against 869,850 ms here, every one of its 22 tests
about half as long, in the same proportions. So that file's time varies about twofold from run to run; this table
keeps the higher figure, which places it most cautiously. Reported as `D-TBD-linking-card-time-varies`.

## What changed

- `FILE_MS` named 82 files (run 42805910829, 2026-11-10). It now names all 118 the run reported, each with the run's
  own figure; 36 are new and the 82 others are replaced. The table's order rule is kept: longest first.
- The doc comment names the run, its three jobs, the file count, the test count and the file time; the earlier source
  sentence stays as history.
- Files on the branch's base that are not in the run's logs, so cost the table's median: **0**. The base's
  `pwa/browser/*.browser.test.*` files and the run's files are the same 118 names.

## Check

`ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/browser-leg.test.ts` from `pwa/`: 1 file, 22 tests,
green. Its case that every name in `FILE_MS` is a browser file holds for all 118.
