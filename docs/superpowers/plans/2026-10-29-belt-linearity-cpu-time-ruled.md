# The belt linearity test measures CPU time, ruled

- **D-7368 (2026-10-29)** — the belt's linear-widening test times `beltMask` by CPU time, not wall time

**D-7368.** `server/test/history-lib.test.ts` pins that `beltMask` widens in linear time: a run 8x longer
(64 KiB to 512 KiB) must cost under 16x. It timed each pass with `performance.now()`, which is wall time.

**What failed.** The first full post-merge macOS run (after #1800 moved the macOS legs off the merge path) failed
on shard 1 of 4 with this test alone: `64 KiB 1.6 ms, 512 KiB 30.5 ms: expected 18.81 to be less than 16`. Every
other test in the shard passed (11978). The `$HOME must be set to run brew.` lines in the same log are stderr from
tests that clear `HOME` on purpose, and those tests passed. Neither the test nor `beltMask` has changed since #404.

**Why it is a flake, not a regression.** On an idle laptop the wall-clock ratio is 7 to 10. Under CPU load (more
busy processes than cores) the test failed 2 runs in 20 on the same laptop, with ratios of 17.8 and 31.8. The
512 KiB pass runs for about 8 ms and the 64 KiB pass for about 1 ms. A loaded scheduler takes the CPU away from
the longer pass far more often, and taking the minimum of 5 samples does not fix that. Running the two sizes
interleaved, or timing eight 64 KiB passes together, did not fix it either: both still went over 16 under load.

**The ruling.** The test times each pass with `process.cpuUsage()`, user plus system time. That counts only the
time this process actually ran, and the forks pool gives each test file its own process. Under the same load the
ratio stayed between 8 and 10 in 80 out of 80 probe trials, and the test passed 20 runs in 20. The threshold
stays at 16 and the 2 s bound stays. The quadratic shape this test guards against (one rescan per cover) still
measures near 64. `process.threadCpuUsage()` would be narrower, but it needs Node 23.9 and CI runs Node 22.
