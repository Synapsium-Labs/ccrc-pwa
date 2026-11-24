# Test box retention: refs timed across restarts, failures said, the registry cache pruned

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** what the test box keeps on disk stays bounded: a run's results, logs and mirror refs go on time even when the
service restarts in between, a failed retention pass is said instead of dropped, and the registry proxy's cache loses
what has not been served for a setting's time. Nothing a running, queued or handed-over run still needs is deleted.

**Architecture:** one owner of what the box keeps, the service's retention (`agent/src/testbox/service.ts#retention`,
L4), with its decisions in `agent/src/testbox/runs.ts` (L1: `retentionPlan`, and the new `registryPlan`). The registry
proxy (`agent/src/testbox/registry.ts`, L3) marks a cached file when it serves it and offers the cache's listing and
removal; it decides nothing. No second sweep, no second timer: both arms run on the service's existing tick.

**Tech stack:** TypeScript, vitest; `agent/` for the code, the settings tables in `ccd/`, `shared/`, `pwa/` and the
tests in `server/` and `pwa/` for the new key.

**Spec:** `docs/superpowers/specs/2026-10-28-test-box-design.md` §2.1 "Ref lifetime", §2.2 "Pristine installs", §2.3
"Results" and "Network", §8 (the settings table).

## Measured before the change (2026-11-24, the live box, read only)

- The box's root is on a 64 GB volume, 2.5 GB used. Run directories are deleted after each run; pristine installs go
  after `CCRC_TESTBOX_PRISTINE_KEEP`.
- `results/<run-id>/` and `logs/<run-id>/` already have a sweep: `retention()`, on every tick, deletes them past
  `CCRC_TESTBOX_RETENTION` (default 24 h). All of them were from that day, so it had deleted nothing yet. About 400
  runs a day at roughly 100 KB each.
- Mirror refs: 1203 run ids under `refs/ccrc-test`, 831 with no results directory (pushes the box then refused). A
  ref-only run id was timed by an in-memory first-seen map that every service restart clears, and the service restarts
  two or three times a day (each tool-sync takeover), so those refs never reached 24 h.
- The registry proxy cache had no eviction: 188 MB (packuments 122 MB, tarballs 66 MB, 365 files).
- `tick()` dropped a retention failure (`.catch(() => undefined)`).

## Tasks

- [x] **T1 (D-9004)**: a ref-only run id's first sight is a stamp on disk, `<root>/refs-seen/<run-id>` (an empty file
  whose mtime is the first sight), written by retention when it first lists the id's refs, deleted with the refs, and
  deleted when the refs are gone some other way, but only on a pass that listed every mirror. The in-memory map is
  gone. Red first: `testbox-service.test.ts`, "D-9004: a run id with refs only expires on time though the service
  restarted in between", and the stamp-removal case.
- [x] **T2 (D-9005)**: the tick says a failed retention pass on the service's note line
  (`ccrc-testbox: retention: <message>`), as the tool sync does, and a failed registry pass as
  `ccrc-testbox: registry retention: <message>`; one arm failing does not stop the other. Red first: "D-9005: the tick
  logs a retention failure, and the registry cache is still pruned".
- [x] **T3 (D-9006)**: a run handed over to disk (a drain or a takeover, `toolsync.ts#ToolSync.handedOver`) keeps its
  refs past the retention time: it is queued again later and checks them out then. Asked only of a run whose refs are
  otherwise due. Red first: "D-9006: the refs of a run handed over to disk are kept past the time".
- [x] **T4 (characterization pin)**: a run still in the service's queue or running keeps its log directory past the
  retention time (the listing skips every run the service holds). Already true on `main`; the new case pins it, and
  deleting the skip reds it.
- [x] **T5 (D-9007)**: the registry proxy's cache is pruned by its last-served time. A cached file's mtime is that time:
  a fetch writes it, and an answer from the cache (a cached tarball, or the kept packument while the upstream fails)
  marks it. `runs.ts#registryPlan` names every file not served for `CCRC_TESTBOX_REGISTRY_KEEP`; the service deletes
  them and any tarball directory left empty, synchronously, so the prune never falls between the proxy's own
  synchronous check, read and write in the same process. The new setting is registered in every list of the box's
  keys: `shared/api.ts`, `ccd/testbox-knobs` (shape and table), `ccd/ccrc` and `ccd/lib/ccrc-settings.sh`
  (`CCRC_SETTINGS` and the class table), `ccd/ccrc-testbox-admin`, `shared/testbox-admin.ts`,
  `pwa/src/fleet/testboxAdminWords.ts` (the Storage family, default `30d`), `deploy/testbox/ccrc.env.example` and the
  README. Red first: the pure `registryPlan` case, the service's tick case, and the proxy's "an answer from the cache
  marks the file served" case.

Each guard was mutated and its case went red: the queued-run skip, the hand-over check, the stamp read, the
stamp removal with the refs, the orphan removal and its every-mirror condition, the failure line, the registry arm in
the tick, `registryPlan`'s boundary and its age test, the emptied-directory removal, the in-cache path check, and both
served marks.

## Deviations found

- **D-9004** — `testbox-refs-first-seen-persisted`: the first sight of a ref-only run id is a stamp under
  `<CCRC_TESTBOX_ROOT>/refs-seen/`, not an in-memory map, so the spec's "refs go after the retention time" (§2.1) holds
  across service restarts. Stamped for every run id at its refs' first listing; used when the run has no results or
  logs left, as the map was. A pass that could not list every mirror removes no stamp.
- **D-9005** — `testbox-retention-failures-said`: the service's tick says a failed retention arm on the service's note
  line (`ServiceDeps.log`, stderr by default) instead of dropping it.
- **D-9006** — `testbox-handed-over-refs-kept`: the refs a checkout will need include a run handed over to disk, which
  the spec's "only once that run's directory is gone" (§2.1) did not name, since hand-over (D-8907) came later.
- **D-9007** — `testbox-registry-cache-keep`: the registry proxy's cache, which §2.3 left without an eviction, is pruned
  by last-served time past `CCRC_TESTBOX_REGISTRY_KEEP` (new box setting, a duration, default `30d`, after the spec's
  table as D-8290's three are: `server/test/testbox-knobs.test.ts`'s `BOX_ADDED`). The default is longer than
  `CCRC_TESTBOX_PRISTINE_KEEP` (7 d) on purpose: while a pristine install stands, its runs clone it and fetch nothing,
  so a lockfile unchanged for a week must still find its tarballs warm when its next key is built. Deleting is safe:
  a packument is asked of the upstream on every request, and a tarball is immutable and checked against its
  packument's integrity when fetched again. The one cost is a fetch from the upstream, or, while the upstream is down,
  a packument no longer kept.
- **D-9008** — `testbox-results-keep-not-added`: the brief asked for a new `CCRC_TESTBOX_RESULTS_KEEP` (default 14 d)
  for results and logs. Not added: `CCRC_TESTBOX_RETENTION` already owns that lifetime (§2.3: results and logs "kept
  for the retention time and deleted with the refs"), and a second setting for the same fact would be a second writer.
  Its default stays 24 h: nothing reads a run's results after its summary is sent (the summary travels on the
  connection; `results/` serves only `runIdUsed`), and a longer default would keep every run's mirror refs, and the
  objects they hold, as long. An operator who wants a longer record raises `CCRC_TESTBOX_RETENTION` on the box.

## Later (not this PR)

- `buildOutputs` for `pwa/dist`, the browser-config budget estimate and the tests typecheck's memory against the run
  unit's `MemoryMax`, from the same brief, belong to the repository-table widening.
