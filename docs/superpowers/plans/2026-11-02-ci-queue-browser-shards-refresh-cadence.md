# CI: the queue's browser leg in shards, the map refresh every three hours, the daily rebuild in more trace shards

**Why.** The CI share target (CI at most 10% of delivery time; operator ruling 2026-10-28) measured over 3.67 days of
runs (2026-10-30 to 2026-11-02). Three changes to `.github/workflows/ci.yml` and its helpers, one commit each. Numbers
issued by the ledger on 2026-11-02.

- **D-7746 (2026-11-02)** — the merge-queue browser leg runs as balanced shards with a timeout of twice their expected time
- **D-7747 (2026-11-02)** — the test-map refresh runs every three hours and skips when main has not moved since the newest map

## D-7747: the refresh cadence

**Measured.** The hourly refresh ran 89 times, each about 200 runner-minutes (all 8 trace shards, about 25 minutes each),
and 35 of 87 found no merge since the refresh before it. That is up to about 4,000 runner-minutes a day.

**The change.** The refresh cron is `23 */3 * * *` (every three hours) in every predicate that tells a refresh apart.
The scheduled refresh passes `--skip-unmoved true` to `select.mjs`, which traces nothing when main's head is the newest
trusted map's own commit: no merge since that map. Its trace shards and `map-build` then skip on `trace_count` 0, as
for any refresh with nothing to trace. A dispatch (`gh workflow run ci.yml -f mode=refresh`) passes no flag and always
refreshes. The other jobs of a refresh run already skip by step, so a skipped refresh costs what their runners take to
start, about 14 runner-minutes.

**Why a three-hour map is safe.** A stale map makes selection run more, never less. A test whose record read a file
that main changed after the trace is `uncertain`, and a test with no entry is `unmapped`: a full-run pull request
selects them, and a fast pull request leaves them to the merge queue, which runs the whole suite before any merge. The
cadence changes how many tests fall into those two sets between refreshes, not whether they are covered. The fast plan
is not changed here.

**The stale-map warning.** It said "older than 3 h" because the refresh was hourly. It now warns past 5 hours (a
three-hour cadence plus a refresh's own run), and not at all when main has not moved past the map: a refresh that finds
main where the map is skips, so an old map of an unchanged main is current. Two pinned expectations move with it, in a
commit of their own.

## D-7746: the browser leg in two shards

**Measured.** In the merge queue `browser (pwa)` had a median of 17.6 minutes against its 20-minute timeout. 46 of
203 queue browser jobs (23%) were cancelled at 20.1 to 21.0 minutes, and 34 of the 36 cancelled queue runs were this
timeout: about 7,655 runner-minutes lost, and each ejection rebuilt up to four entries behind it.

**The change.** `browser-pwa` is a matrix of two shards, `browser (pwa) 1/2` and `2/2`, each running
`vitest run --config vitest.browser.config.ts --shard=i/2`. The leg's sequencer (`pwa/browser/slowFirst.ts`) replaces
vitest's hash split with a balanced one: longest file first onto the least-loaded shard, by `FILE_MS`, the per-file
times of run 41472953945's green queue job (47 files, 3,104 s of file time; its Test step took 1,067 s over three
workers). A file the table does not name costs its median, so a new file is placed and never dropped. Within a shard,
files start longest first, then `SLOW_FIRST` as before.

**Expected.** About 1,550 s of file time a shard, about 520 s over three workers (the longest file, ask-inline, is
491 s), so about nine minutes a shard with setup. The timeout stays at 20, about twice that. Three shards would be
bounded by ask-inline at about the same time, so two keep the cost of the step-skipped shards on a fast pull request
to one extra job.

**The check names.** `browser (pwa)` is not a required check. `test (pwa)` (in the merge queue) and `full-suite` read
`needs.browser-pwa.result`, which is red when any shard is, so no aggregate job is needed.

