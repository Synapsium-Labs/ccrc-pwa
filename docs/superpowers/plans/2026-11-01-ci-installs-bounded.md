# CI installs: every install command under a deadline, with one retry

**Goal:** no install step in CI can hold a job to its job limit. Building on D-7686 (apt), the same bound now covers npm ci, brew, the playwright browser download and the Actions cache restores.

**Why:** one night, 28 Linux jobs sat 20 to 30 minutes in an apt call until their job limit cancelled them, while the jobs beside them finished it in seconds. apt was the call that stalled that night, but npm ci (the npm registry), brew (its CDN), the playwright download and a cache restore (the cache service) all wait on the network with no deadline of their own. Measured over 30 recent successful runs: `npm ci` takes 7 s on average (13 s at most), a server-deps step 10 s (47 s at most on Linux, 54 s on macOS), and setup-node, cache restore included, 10 s at most.

**Change:**
- `.github/ci/bounded.sh <seconds> <command…>` runs a command under `timeout -k 10 <seconds>`, at most twice, with a warning after a failed attempt. On macOS it uses `gtimeout` when coreutils is installed, and otherwise perl's `alarm`, so no runner runs an install with no deadline.
- Every `npm ci` in ci.yml, macos.yml and server-deps runs as `bounded.sh 180 npm ci`. Both `brew install` lines run under `bounded.sh 300`. storybook-a11y's `playwright install chromium` runs under `bounded.sh 240` (it had a deadline but no retry).
- ci.yml and macos.yml set `SEGMENT_DOWNLOAD_TIMEOUT_MINS: '3'` at the workflow level. `@actions/cache` (server-deps' `actions/cache/restore` and setup-node's `cache: npm`) gives up on a download past it and reports a miss, so a stalled restore falls to the bounded npm ci. The default was 10 minutes.
- `server/test/ci-pipeline.test.ts` runs bounded.sh against fakes (one attempt on success, one retry, never a third, gtimeout, and perl's deadline cutting a real hang) and checks that every npm ci, brew install and playwright download in the workflows and actions goes through it with a deadline of 5 minutes at most, and that both workflows set the cache download timeout.

**Not changed:** the cache keys, what is installed, and when. A retry costs a real failure (a lockfile mismatch) about 10 more seconds.

## Decisions

- **D-7689 (2026-11-01)** — CI installs: every install command under a deadline with one retry. npm ci, brew and the playwright browser download run through `.github/ci/bounded.sh` (a per-attempt deadline, at most two attempts), apt stays on apt-bounded.sh (D-7686), and a cache download past 3 minutes is a miss.
