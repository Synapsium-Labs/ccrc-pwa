# The daily macOS leg fits its timeout again

- **D-8265 (2026-11-11)** — the daily full run's macOS shards fit macos.yml's 55-minute timeout: `PROFILES.macosFull` in `.github/ci/shards.mjs` plans up to 8 shards (was 4) at `scale: 1.2` (was 1.5), and `server/test/ccd-held-by.test.ts` asserts the collect document's Darwin outcome on macOS instead of the Linux one.

## Why

The scheduled daily `ci.yml` run had been red every day since 2026-10-28. On the runs of 2026-11-08, 11-09 and 11-10
the server suite stood at about 368 minutes of Linux file time; `macosFull` capped it at 4 shards, so each shard's
`Test` step ran 46-53 minutes against the job's 55-minute timeout and most shards were cancelled before they reported.

## Measured, not assumed

The scale was measured before it was set. For every file each macOS shard of those three runs reported (vitest's own
per-file time in the job log), against the same run's Linux `times-*` artifacts (the file-times reporter's `wallMs`):

| run | shard | files matched | macOS min | Linux min | ratio |
|---|---|---|---|---|---|
| 2026-11-10 | 1/4 | 324 | 94.5 | 82.5 | 1.15 |
| 2026-11-10 | 2/4 | 87 | 102.8 | 67.8 | 1.52 |
| 2026-11-10 | 3/4 | 37 | 81.5 | 52.4 | 1.56 |
| 2026-11-10 | 4/4 | 329 | 84.1 | 75.9 | 1.11 |
| 2026-11-08 | 2/4 | 162 | 105.5 | 86.4 | 1.22 |
| 2026-11-08 | 3/4 | 187 | 106.4 | 82.1 | 1.30 |
| 2026-11-08 | 4/4 | 346 | 94.6 | 86.7 | 1.09 |
| 2026-11-09 | 1/4 | 350 | 102.9 | 87.7 | 1.17 |
| 2026-11-09 | 2/4 | 67 | 105.0 | 76.9 | 1.37 |
| 2026-11-09 | 3/4 | 349 | 92.0 | 92.6 | 0.99 |
| 2026-11-09 | 4/4 | 349 | 90.0 | 89.7 | 1.00 |
| **all** | | | **1059.3** | **880.7** | **1.20** |

So `scale` is 1.2, not 1.5 and not 1.0: the many-small-file shards run at about Linux speed, the shards of the heaviest
files at about 1.5x. With the cap binding (the suite is far past `8 · 2 · 15` minutes) the scale moves no shard count
today; it is kept honest for when the suite shrinks below the cap.

## Deviations found

- The task asked for `scale: 1.0`; the measurement above gives 1.20 over all files, so 1.2 is used.
- 8 shards exceed the organisation's 5-job macOS cap, so the daily run's shards and `probe-macos` queue for slots. A
  job's timeout counts from its start, so the queue costs wall-clock only (the daily run starts at 03:17 UTC).
- `macosSelected` (a pull request's 2-shard plan) keeps `scale: 1.5`; it was not part of this change.
- `ccd/ccd` is unchanged: its Darwin answer (`unmeasured`, probe `platform`, before the rows rung) is the product's.
  The two held-by cases that pin the Linux collect document are `itLinux`, unchanged; each has an `itDarwin` twin
  that keeps the expiry half and asserts the Darwin collect outcome, `heldBy` null.
