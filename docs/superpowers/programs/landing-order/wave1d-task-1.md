# Wave 1d, Task 1: the server shard's deadline (D-9014)

Run 3739, plan `docs/superpowers/plans/2026-11-25-landing-order-wave1d-queue-ci.md`.

- `server-shard`'s `timeout-minutes` is 45, and its comment now says what was measured: a full merge-queue shard took
  from 15m47 to 29m24 on 2026-11-24 by runner, one green shard was cancelled at 30m00, and 45 is about half as much
  again over the slow case and still under the queue's hour. The sentence that said every shard is packed to about
  four minutes now says that is a fast pull request's packing only.
- No other job's deadline changed. Wave 1e's `browser-pwa` deadline (30) is that wave's own.
- **The pin.** `oss-metadata.test.ts` holds every job's deadline between 1 and 60, and `ci-pipeline.test.ts` the same;
  neither names `server-shard`'s number. So no suite pins 45 (mutation 1D-01, measured green in both suites with 30),
  and, as the plan's table allows, none was added.
- The edit to `.github/workflows/ci.yml` went by packet: wave 1e's session held the file (claim 7030), approved the
  exact diff (packet sha256 `de2d62962a773b3628c5ae766cba6ffa1934b007fc28655794d871b5b8f3d257`, 14 hunks, against
  `main` at `1c625acc39`) and said it may be applied before its own pull request merges.
