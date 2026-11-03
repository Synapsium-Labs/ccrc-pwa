# CI apt installs: skip when present, bounded with one retry

**Goal:** no `apt-get` in CI can hold a job to its job limit. A stalled mirror costs a few minutes and one retry, not 20 or 30.

**What was measured (2026-10-31 23:04 UTC to 2026-11-01 01:05 UTC):**
- 28 Linux jobs were cancelled at their job limit inside an apt call: 25 in `./.github/actions/server-deps` (`server N/12`, `pwa N/3`, `pwa typecheck and storybook`, both `install dependencies` legs) and 3 in storybook-a11y's `playwright install --with-deps chromium`. None of the earlier cancels in the 48 hours measured was in an apt call.
- Every one of them has the same log. The image's first mirror (from the runner's apt mirror list) answers nothing: 15 `Ign:` lines, about 15 s. apt then falls over to the next mirror, fetches the four `InRelease` files, and prints nothing more until the cancel. In the same runs, the jobs that reached the first mirror finished the same `apt-get update` in about 5 s (`Fetched 10.5 MB in 2s`). All the stalled jobs ran on the same `ubuntu-24.04` image version as the healthy ones, so the image migration is not the cause.
- The apt call was not needed. On today's image, the deps job's own log says all four packages are already installed (`tmux is already the newest version`, and the same for jq, strace and python3). Nothing is downloaded, so the packages cache entry was never written (`have` is never set), every restore missed, and every Linux job ran `apt-get update` against a mirror.

**Change:**
- `server-deps` (Linux) checks `command -v` for tmux, jq, strace and python3 first. When all four are present, no apt runs. The dpkg hit arm and the install are kept for an image that lacks one of them.
- `.github/ci/apt-bounded.sh <seconds> <command…>` runs an apt-using command as root (`sudo env PATH=… timeout -k 10 <seconds>`), at most twice. Between the two attempts it kills any apt-get the deadline left behind, so the retry does not fail on the lists lock. Both remaining apt callers use it: the server-deps miss arm (180 s per attempt) and storybook-a11y's `playwright install-deps chromium` (240 s per attempt).
- storybook-a11y's step is split. `install-deps` (apt) runs under apt-bounded.sh, and `install chromium` (the browser download) runs under its own 240 s deadline. The step has `timeout-minutes: 12` as a backstop.
- `server/test/ci-pipeline.test.ts` pins the following: the presence check, running the step with fakes (no apt when all four are present, one bounded attempt when one is missing, one retry, never a third attempt), no bare `sudo apt-get` and no `--with-deps` left in the workflows, and the storybook step's shape.

**Not changed:** the trace-shard (60 min) and test-macos (55 min) cancels in the same 48 hours are test-step hangs. They are a separate subject.

## Decisions

- **D-7686 (2026-11-01)** — CI apt installs: skip when present, bounded with one retry. A Linux job runs apt only for a package the image lacks. Every apt call goes through `.github/ci/apt-bounded.sh`, with a per-attempt deadline as root and one retry, so a stalled mirror costs minutes instead of the job limit.
