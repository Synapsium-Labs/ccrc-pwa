# CI: the queue's browser leg in shards, the map refresh every three hours, the daily rebuild in more trace shards

**Why.** The CI share target (CI at most 10% of delivery time; operator ruling 2026-10-28) measured over 3.67 days of
runs (2026-10-30 to 2026-11-02). Three changes to `.github/workflows/ci.yml` and its helpers, one commit each. Numbers
issued by the ledger on 2026-11-02.

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
