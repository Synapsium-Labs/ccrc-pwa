# Consolidation wave, W1a: one switchboard and one notice funnel — `SWITCHES` and `readSwitches`, the `reclaim-paused` readers, the `notify` funnel and its fifteen hand-written pairs (stop-done's excepted), and `dedupeKey` — Implementation Plan

> **For agentic workers:** one PR per task, in the order of §Landing order, each dispatched only when its row in §Gates is all green. To execute a task, REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Steps use checkbox (`- [ ]`) syntax. Workers do not edit §Deviations and decisions. A departure is named by slug in the task's report; the coordinator enters it from this programme's issued block, never the worker.

**Spec:** `docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md` (rev 2, approved by the operator 2026-10-19). §5.1, §5.3 (W1a), K6 (the funnel), K12 (switches), §2.3's switchboard row, §3.19 and §7 bind every task. Read them before Step 0.

**Status:** rev 0 (2026-10-19). **The spec was approved by the operator 2026-10-19**, in their words: "answers locked". Its O1 (d), clicked explicitly, is this wave: "a sliced W0 (only the pins W1a needs), then W1a: `SWITCHES` and the `notify` funnel, without stop-done, after #397 merges". O3 (a) (nothing in flight pauses), O9 (a) (a series lands standalone when its first commit is a characterization pin and its exit is counted) and O11 (a) (the ring stays the catch-up authority, `feed_events` its archive) also bind it. Written in the same docs PR as the spec's rev 2 and the W0 plan (`2026-10-19-consolidation-w0-pins.md`).

**Inputs.** The W0 plan's pins: C0b's census queries, C0c and C0d's feed-writer pin (`server/test/feed-writers-pin.test.ts`), C0e's pause pin (`server/test/reclaim-pause-pin.test.ts`), C0g's symbol slices. `watch.ts` `pushOne` (≈:3106) and its docstring; `coord/rundefs.ts`'s markers (≈:50–72); D-5242's presence contract (`presence.ts` ≈:28); the child-reclaim ruling "every reclaim lands in the feed; no push per reap" (`coord/childReclaim.ts` ≈:1679); expiry's step 6, "NEAREST THE ARGV" (`coord/expireArchived.ts`).

**Base:** `origin/main` `f64c27b65`. Code is cited by file and by function, constant or `describe` title, with `≈` line hints measured at that sha. **#397 will move them**: Step 0 of each task re-grounds every hint by content on the tree it starts from, which is after #397.

**Deploy class.** **Server lane only.** No task edits `ccd/`, `agent/`, `deploy/`, the session hook or any `pwa/` file, so the agent lane of the standing AGENT-FIRST rule has nothing to deploy, and no session restarts. No task bumps `FLEET_PROTO`; the catch-up wire is byte-compatible. C1f adds one additive coord.db column.

**Names.** Tasks are **C1a** to **C1f**. The W0 plan's tasks are **C0a** to **C0g**. Operator acts are **OA-C1** to **OA-C3** (C3 is this plan's).

**Goal, PR by PR.**

| After | The operator sees | Underneath |
|---|---|---|
| `main` | nothing | ~15 markers declared across five files; `reclaim-paused` parsed at 10 sites; `mail-disabled` defined twice; 16 `recordFeedEvent` call lines |
| C1a | nothing | `shared/switches.ts`: `SWITCHES` (every marker and settings switch as a row) and `readSwitches(listing)`; the old constants re-export their row; `mail-disabled` defined once |
| C1b | nothing | every `reclaim-paused` reader, at the pass and at the act, goes through `readSwitches`; 10 → 1 parse site (stop-done's, which W4 moves) |
| C1c | nothing | `server/src/notice.ts`: `notify(event, mode)`; `pushOne` routes through it; the four writers outside `coord/` move; 16 → 12 call lines |
| C1d | nothing | `coord/routes.ts`'s five writers move; 12 → 7 |
| C1e | nothing | the child-reclaim, expiry and dead-coordinator writers move; 7 → 2; the feed's writer set is pinned |
| C1f | identical feed rows (a re-sent row no longer repeats a nudge only when its key says so; see OA-C3) | `feed_events.dedupe_key`; the nudge and stall lanes stop using `hasFeedEvent` as an idempotency store |

---

## Gates: what each task waits for, stated honestly

Measured on 2026-10-19 at `f64c27b65` with `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,files` (26 open PRs).

- **#397** (path identity W1a, 70 files) holds every production file this wave edits except `shared/switches.ts` (new), `server/src/notice.ts` (new) and `interruptlog.ts`: `watch.ts`, `server.ts`, `coord/routes.ts`, `coord/childReclaim.ts`, `coord/expireArchived.ts`, `coord/reclaim.ts`, `ccdargv.ts` and `single-definition.test.ts`. **Every task waits for #397 to merge** (spec §5.3). The wave rebases; #397 never does.
- **#737** (history 5h-1) holds `single-definition.test.ts` at ≈:5237 only. C1a and C1b edit that file's switch-literal blocks (≈:2280–2356) and the ARCH-40 tail block; C1e edits the tail block. All are line-disjoint from #737's hunk; each task re-checks at Step 0.
- **The W0 pins.** C1a and C1b need C0b, C0e and C0g; C1c, C1d and C1e need C0b, C0c, C0d and C0g. C0g needs OA-C1 (the parser choice).
- **The Settings redesign's server tasks, coordinator-first's remaining server tasks and CB W1 observe's server half** (spec §5.3) have **no open PR** on `f64c27b65`. Spec §5.1 rule 6 still binds: before every commit the series lists the open PRs holding each file it edits and keeps its hunks line-disjoint from theirs, or waits.
- **Hibernation Task 19** gates nothing here. `stopDoneSweep.ts` and `hibernateSweep.ts` are never edited (spec §5.3).
- **OA-C3** (the operator's ruling on C1f's before/after rows) gates C1f's behaviour commit.

| Task | #397 | W0 pins | Rule 6 (Settings, coordinator-first, CB server tasks) | OA | Other |
|---|---|---|---|---|---|
| C1a switchboard | **merged** | C0b, C0e, C0g | re-check at Step 0 | — | — |
| C1b pause readers | **merged** | C0e, C0g | re-check at Step 0 | — | C1a |
| C1c funnel, outside `coord/` | **merged** | C0b, C0c, C0g | re-check at Step 0 | — | — |
| C1d funnel, `coord/routes.ts` | **merged** | C0d | re-check at Step 0 (Settings' server tasks edit `coord/routes.ts`) | — | C1c |
| C1e funnel, executors | **merged** | C0d | re-check at Step 0 | — | C1c, C1b (one file per series at a time, rule 6) |
| C1f `dedupeKey` | **merged** | C0c | re-check at Step 0 (any coord.db `MIGRATIONS` entry in flight) | **OA-C3** | C1e |

## In flight, and what it fences off

| In flight | Files it changes that this plan would otherwise touch | Tasks it gates |
|---|---|---|
| #397 | `server/src/watch.ts`, `server/src/server.ts`, `server/src/coord/routes.ts`, `server/src/coord/childReclaim.ts`, `server/src/coord/expireArchived.ts`, `server/src/ccdargv.ts`, `server/test/single-definition.test.ts` | all |
| #737 | `server/test/single-definition.test.ts` (≈:5237) | none (line-disjoint) |

No open PR holds `server/src/interruptlog.ts`, `server/src/coord/rundefs.ts`, `server/src/coord/collectTempRoot.ts`, `server/src/coord/endDeadCoordinator.ts`, `server/src/coord/dispatch.ts`, `server/src/coord/store.ts`, `server/src/coord/schema.ts`, `shared/switches.ts` or `server/src/notice.ts`. Each task re-reads every list at Step 0.

## Landing order

```
#397 merged + W0 (C0b, C0c, C0d, C0e, C0g)
  ├── C1a (switchboard) ── C1b (pause readers; 10 → 1)
  └── C1c (funnel; 16 → 12) ── C1d (routes; 12 → 7) ── C1e (executors; 7 → 2) ── C1f (dedupeKey; OA-C3)
```

The two chains are independent, but only one series edits `watch.ts` at a time (spec §5.1 rule 6): C1b's `watch.ts` commit and C1c's `pushOne` commit never sit in the queue together. C1e follows C1b because both edit the same three executors.

## Global constraints

The W0 plan's §Global constraints bind this plan (public repository, SAFETY, no root runner, characterization discipline, counts measured, band routing, branch discipline), except "zero production bytes", which W1a replaces with the rules below.

- **Each PR's first commit is a characterization pin** (spec §5.1 rule 1, O9 (a)): the W0 rows for the sites the PR moves, re-run on the PR's base (after #397) and extended with the rows named in its Step 1. It is green against the old code. **Move commits** change those suites only in their imports; a move commit that edits a characterization assertion is refused in review. One consumer per commit.
- **Behaviour commits** (spec §5.1 rule 1b) are their own commits, never squashed with a move, with their before/after rows in the PR body and the operator's ruling cited. W1a has exactly one: C1f's. Any other output change found mid-task stops the task and is reported, never folded in.
- **The act-time re-read stays** (spec K1, K12, §3.19). The tick's switch snapshot feeds the decision; every executor calls `readSwitches` **again, over a fresh listing, nearest the argv**. C0e's "a pause raised between the pass and the act holds" rows stay green, unchanged, through every commit.
- **No `pwa/` file** (spec §5.1 rule 8). C1a lands the path guard; every W1a branch is named `consolidation/<task>` so the guard can find it.
- **No `ccd` byte, no agent byte.** `ccd` keeps reading its markers itself (they are what it can read with the server down, spec K12); `SWITCHES` describes them and changes none.
- **Wire discipline.** No frame changes in W1a. The catch-up response (`{ epoch, seq }` cursor, ring authority, O11 (a)) is byte-identical, held by C1c's catch-up row.
- **coord.db.** C1f's one `MIGRATIONS` entry is an `ALTER TABLE … ADD COLUMN` with no `NOT NULL` and no `CHECK`, so a rollback stays bootable (`db.ts` rule 3).
- **Counted exits.** Each PR body prints the census lists (C0b's queries) at its base and at its tip. The may-only-shrink pin for a count lands in the commit that reaches that count's wave target (spec §5.1 rule 3, rev 2), never earlier.
- **Deviation ledger.** This plan defines D-5855 to D-5860 and never allocates.

## Review focus (the failure modes most likely to bite)

1. **A deleted act-time read.** Moving an executor's switch read onto `readSwitches` must keep two calls, one on the tick's listing and one on a fresh listing at the act. One call over the tick's snapshot is the defect rev 1 of the spec was reviewed for (R1-3).
2. **A failed listing read as "clear".** `readSwitches` answers `unlistable` for a listing that could not be taken, and every reader that treats it as paused today still does (`childReclaim.ts` ≈:1123, `collectTempRoot.ts` ≈:252, `endDeadCoordinator.ts` ≈:161, `expireArchived.ts` ≈:137).
3. **A word that changed.** Each verdict sentence ("… is raised: cleanup is paused fleet-wide", "the registry did not list, so a raised … cannot be ruled out") is pinned byte for byte by C0e. A move that rephrases one is a behaviour change.
4. **A push where there was none.** The three child-reclaim rows stay "recorded and NEVER pushed", whatever the presence. The funnel's mode for them is the one C0d measured, and the PR names it.
5. **A reordered sink.** The funnel writes the ring, flushes, archives and pushes in `pushOne`'s order; an archive failure never stops the ring or the push. C0c's call log is the check.
6. **A no-coord.db box.** With no `coord`, the funnel still records the ring and serves catch-up (`watch.ts` ≈:3103's rule). With no `notifyLog`, it archives nothing ("a feed row that mirrors nothing is not an archive").
7. **An approval ruling that fails on a feed write.** `coord/routes.ts` ≈:4545's route stores the ruling even when the archive throws (C0d's row). C1d moves it natively.
8. **A switch that changes meaning.** `SWITCHES` is data that describes today's markers; it adds none and removes none. `collect-lane-live` stays a row (spec K12). ARCH-77's child-reclaim off switch is **not** in W1a (it lands with W4's `child-spent` PR).

## Tasks

### Task C1a: the switchboard — `SWITCHES` and `readSwitches`, and `mail-disabled` defined once (D-5855; ARCH-70, first PR; spec K12, §2.3) — GATED: after #397, C0b, C0e, C0g

**Routing:** band 2 (data and a pure reader; no reader moves except the two duplicate definitions). **Lane:** server. **Needs:** #397, C0b, C0e, C0g.

**Files:**
- Create `shared/switches.ts` (L0, no imports beyond `shared/`): `SWITCHES`, a `const` record keyed by switch name. Each row: `storage` (`{ marker: '<name>' }` under `$REG`, or `{ setting: '<table>.<column>' }`), `default` (what absence means), `owner` (the spec's context, C1 to C9), `meaning` (one operator sentence), `writer` (the route or ccd verb that writes it, or `'hand-only'`). Rows: every marker exported today (`mail-disabled`, `coordinator-paused`, `reclaim-paused`, `asks-disabled`, `stop-done-disabled`, `hibernate-disabled`, `hibernate-live`, `expire-lane-live`, `collect-lane-live`, `dead-coordinator-lane-live`, `idle-compact-nudge-disabled`, `mail-gate-strict`, `mail-gate-busy`, `mail-gate-busy-shadow`, and any C0b's `markerLiteralFiles()` finds that this list misses) and the settings-table switches Step 0 finds (the spec's "3 tables"). `readSwitches(listing: string[] | null)` answers, per row, `'raised' | 'clear' | 'unlistable'` (a `null` listing is `unlistable` for every marker row, never `clear`).
- Modify `server/src/coord/rundefs.ts`: `MAIL_DISABLED_MARKER`, `COORDINATOR_PAUSE_MARKER`, `RECLAIM_PAUSE_MARKER` become re-exports of their rows' marker names (callers unchanged).
- Modify `server/src/watch.ts`: the private `MAIL_DISABLED_MARKER` (≈:678) and `ASKS_DISABLED_MARKER` (≈:687) become imports. Nothing else in `watch.ts`.
- Modify the other exporters (`stopDone.ts` ≈:94, `coord/hibernate.ts` ≈:98–99, `archivedExpiry.ts` ≈:24, `collectLane.ts` ≈:37, `deadCoordinator.ts` ≈:23, `idlenudge.ts` ≈:47, `turnidle.ts` ≈:67–74): each constant re-exports its row. **`stopDone.ts` and `hibernate.ts` change only the right-hand side of one `export const` each**; if a reviewer reads that as touching the stop-done or hibernation lane, those two rows stay as they are and the PR says so (spec §5.3 never touches the sweeps; the decider files are not sweeps).
- Modify `server/test/single-definition.test.ts`: the "one coordinator-paused literal" (≈:2280) and "one 'reclaim-paused' literal" (≈:2337) blocks re-point at `shared/switches.ts`, **each in its own commit** (they are switch censuses, C0g's risk rule). The ARCH-40 tail block gains "every marker literal under `server/src` is a `SWITCHES` row".
- Create `server/test/switches.test.ts` and `server/test/consolidation-path-guard.test.ts` (rule 8: on a branch named `consolidation/*`, `git diff --name-only $(git merge-base origin/main HEAD) HEAD -- pwa/` must be empty; elsewhere it skips, so the skins, Settings and Accounts PRs are never touched by it).

- [ ] **Step 0: Re-ground** on the post-#397 tree: every marker constant and its value, every settings-table switch and its writer route, C0b's `markerDefinitions('mail-disabled')` (2) and `markerLiteralFiles()`. Rule 6 check for every file above.
- [ ] **Step 1: Characterization commit.** Re-run C0e on the base; add `switches.test.ts`'s first rows against the **old** code: every marker constant's value today, listed as the table the PR is about to add must equal (green on `main`, red if any value drifts).
- [ ] **Step 2: Red.** `readSwitches` rows: a listing with `reclaim-paused` is `raised` for it and `clear` for the rest; `null` is `unlistable` for every marker row; a settings row ignores the listing; every row has a non-empty `meaning` and a `writer`. Red (no module).
- [ ] **Step 3: Green**, then the move commits, one file per commit: `rundefs.ts`, `watch.ts`, then the other exporters, then the two `single-definition.test.ts` blocks, then the tail row, then the path guard.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `readSwitches(null)` answers `clear` | switches | "an unlistable registry is never clear" |
  | a row's marker misspelt (`reclaim-pause`) | switches | "every marker value equals today's" |
  | a new `const X_MARKER = 'x'` in `server/src` with no row | single-definition | "every marker literal is a SWITCHES row" |
  | `watch.ts` keeps its private `mail-disabled` | consolidation-census (C0b, `markerDefinitions`) and single-definition | "mail-disabled is defined once" |
  | a `pwa/` file touched on a `consolidation/` branch | consolidation-path-guard | "no pwa/ file before W7" |

- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/tsc --noEmit
      cd server && ./node_modules/.bin/vitest run test/switches.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/reclaim-pause-pin.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/consolidation-path-guard.test.ts --maxWorkers=2

**Exit (GATES):** `mail-disabled` definitions 2 → 1 (pinned, may only shrink); every marker literal under `server/src` is a `SWITCHES` row (pinned); C0e unchanged and green. **OBSERVATION:** `markerLiteralFiles()` at base and tip. **Rollback:** `git revert`; the re-exports make it a pure revert.

### Task C1b: every `reclaim-paused` reader through `readSwitches`, at the pass and at the act (D-5856; ARCH-70, second PR; spec K12, K1's act-time re-measure) — GATED: after C1a

**Routing:** **band 3, native** (the four executors are on the destructive path; the fleet's emergency stop). Two reviewers, one reading only Review focus 1 to 3. **Lane:** server. **Needs:** C1a.

**Files (one per commit, executors last):**
- `server/src/watch.ts`: the four sites (≈:2858, the switch summary's `reclaim` field; ≈:4065; ≈:5261, beside the expire capability; ≈:5471) read `readSwitches(names)['reclaim-paused']`.
- `server/src/coord/collectTempRoot.ts` ≈:357–365: the pass's switch read and its two causes (`raised`, `unlistable`).
- `server/src/coord/expireArchived.ts` ≈:130–140: both reads, the pass's and step 6's "NEAREST THE ARGV".
- `server/src/coord/endDeadCoordinator.ts` ≈:161–162 (act) and ≈:193–196 (pass).
- `server/src/coord/childReclaim.ts` ≈:1013 and the deferral ≈:1123–1129.
- `server/test/single-definition.test.ts` ARCH-40 tail block: the ratchet `reclaimPauseParseSites().length <= 1` (the one left is `stopDoneSweep.ts` ≈:172, which W4 moves), in the last commit.

- [ ] **Step 0: Re-ground** the 10 sites with `reclaimPauseParseSites()` on the post-#397 tree; rule 6 check for each file.
- [ ] **Step 1: Characterization commit.** C0e's rows for these nine sites re-run on the base, plus one row per executor that runs **two passes** with the marker raised between them, so a cached snapshot shows as a stale act (green on `main`).
- [ ] **Step 2: Move commits**, one file per commit, each keeping its verdict words and both reads. Each commit runs C0e and the file's own suites.
- [ ] **Step 3: Ratchet commit.**
- [ ] **Step 4: Mutation table, RUN** (on the moved code).

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `expireArchived.ts`: the act reuses the pass's `readSwitches` result | reclaim-pause-pin | "a pause raised between the pass and the act holds: expiry" |
  | `endDeadCoordinator.ts`: `unlistable` treated as `clear` at the act | reclaim-pause-pin | "an unlistable registry cannot rule the pause out" |
  | `childReclaim.ts`: the deferral's sentence reworded | reclaim-pause-pin | the byte pin on ≈:1128's words |
  | a new `names.includes(RECLAIM_PAUSE_MARKER)` in `watch.ts` | single-definition | "reclaim-paused is parsed at ≤ 1 site outside readSwitches" |

- [ ] **Step 5: Verify** C0e, `switches.test.ts`, `single-definition.test.ts`, and each moved file's existing suites (`child-reclaim*.test.ts`, `collect-switch-*.test.ts`, `dead-coordinator-lane.test.ts`, `expire-*.test.ts`), one at a time.

**Exit (GATES):** private `reclaim-paused` parse sites 10 → 1 (`stopDoneSweep.ts`), pinned; 4 of 4 act-time re-reads green (C0e unchanged). **Rollback:** `git revert` per commit; the switch's meaning is unchanged, so the operator's pause works on either side of a revert.

### Task C1c: the `notify` funnel, and the writers outside `coord/` (D-5857; ARCH-54, first PR; spec K6) — GATED: after #397, C0b, C0c, C0g

**Routing:** band 2 for the funnel and the four moves (feed and push, not destructive); the orchestrator reviews the mode table. **Lane:** server. **Needs:** #397, C0b, C0c, C0g.

**Files:**
- Create `server/src/notice.ts`: `notify(deps, event, mode, opts?)`, where `deps = { notifyLog?, coord?, push?, presence? }`, and the `NoticeSink` port type (`(event, mode, opts?) => void`) that writers outside `watch.ts` receive. `mode` is the record gate and the push: `'push'` (record unless visible, push unless visible), `'record-always'` (record always, push unless visible), `'record-only'` (record always, never push), plus `'record-unless-visible'` (record unless visible, never push) **only if** C0c and C0d measured a writer that uses it. It owns, in this order: the presence gate, the ring record, the flush, the guarded archive, the push. `opts` carries `tag`, `actions`, `url` and `runId` as `pushOne` does.
- Modify `server/src/watch.ts`: `pushOne` keeps its title decoration and calls `notify` with the mode its two flags name; the two collector pairs (≈:4984, ≈:5003) call `notify(…, 'record-only')`.
- Modify `server/src/interruptlog.ts` `recordInterrupt` and `server/src/server.ts`'s pair (≈:2485): each takes a `NoticeSink` from its deps and calls it. `server.ts`'s composition root builds the one sink and passes it.
- Create `server/test/notice.test.ts`.

- [ ] **Step 0: Re-ground** on the post-#397 tree. Read C0c's and C0d's PR bodies for the measured mode of all 15 hand pairs. Decide whether a writer's **ring-failure** behaviour differs observably from `pushOne`'s: if `NotifyLog.record` cannot throw, the difference is unobservable and the funnel's one shape serves all; if it can, a writer whose handling differs is listed, left out of the move, and reported (a behaviour change needs a ruling; none is expected).
- [ ] **Step 1: Characterization commit.** C0c's rows re-run on the base, plus: the catch-up response's bytes for a fixed ring (the `{ epoch, seq }` catch-up route) captured; a box with no `coord` still records and serves catch-up; a box with no `notifyLog` archives nothing.
- [ ] **Step 2: Red.** `notice.test.ts`: each mode's call log over `visible ∈ {true, false}` equals the matching `pushOne` combination's row in C0c; an archive throw leaves the ring and the push; the order is ring, flush, archive, push. Red (no module).
- [ ] **Step 3: Green**, then the move commits: `pushOne` → `notify`; then `watch.ts` ≈:4984; ≈:5003; `interruptlog.ts`; `server.ts`. Each runs C0c unchanged.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `notify`: archive before the ring | feed-writers-pin, notice | "ring, flush, archive, push" |
  | `notify`: `record-only` pushes when not visible | feed-writers-pin | "the collector's rows are never pushed" |
  | `notify`: the archive's `try` removed | notice | "a failed archive leaves the ring and the push" |
  | `notify`: archives with no `notifyLog` | notice | "no ring, no archive row" |
  | catch-up: the response gains a field | notice | the catch-up byte row |

- [ ] **Step 5: Verify** `notice.test.ts`, `feed-writers-pin.test.ts`, `notifylog.test.ts`, `consolidation-census.test.ts`, one at a time, then `tsc --noEmit`.

**Exit (GATES):** `feedRecordCallSites()` 16 → 12 (the funnel's own, 10 in `coord/` and `stopDoneSweep.ts`'s), measured, not yet pinned; each moved writer's C0c row unchanged; catch-up bytes unchanged. **Rollback:** `git revert`; no stored data changes.

### Task C1d: the funnel takes `coord/routes.ts`'s five writers (D-5858; ARCH-54, second PR; spec K6) — GATED: after C1c

**Routing:** **band 3, native**: the ≈:4545 writer is the approval ruling's feed row (coordinator-first, live), and the route around it is a security boundary's caller. Two reviewers. **Lane:** server. **Needs:** C1c; C0d.

**Files:** `server/src/coord/routes.ts`: the five pairs (≈:2485, ≈:2703, ≈:2859, ≈:3985, ≈:4545) call the `NoticeSink` the route's deps carry, in the mode C0d measured for each; `server/src/server.ts` passes the sink into the coord routes' deps (one line). The routes stay in `coord/routes.ts`, behind its one auth gate (08-10 Rejected; spec §2.5).

- [ ] **Step 0: Re-ground**; rule 6 check on `coord/routes.ts` (the Settings redesign's server tasks edit it: their hunks must be line-disjoint or merged first).
- [ ] **Step 1: Characterization commit.** C0d's five route rows re-run on the base, plus one row per route asserting its HTTP status and body bytes with the archive throwing (the route never fails on a feed write).
- [ ] **Step 2: Move commits**, one route per commit, ≈:4545 last.
- [ ] **Step 3: Mutation table, RUN.** ≈:4545: let the sink's archive failure escape → red "ruling stored, feed archive degraded"; any route: mode `push` in place of the measured one → red on that route's C0d row.
- [ ] **Step 4: Verify** `feed-writers-pin.test.ts`, then each route's existing inject suite alone, then `tsc --noEmit`.

**Exit (GATES):** `feedRecordCallSites()` 12 → 7; the five C0d rows unchanged; the approval signing path untouched (`approvalsign.ts`, `approval-verify.mjs` not in the diff). **Rollback:** `git revert`.

### Task C1e: the funnel takes the executors' writers, and the feed's writer set is pinned (D-5859; ARCH-54, third PR; spec K6, §2.1 rule (f)) — GATED: after C1d and C1b

**Routing:** **band 3, native** (child reclaim, expiry and dead-coordinator executors are the destructive path). Two reviewers. **Lane:** server. **Needs:** C1d; C1b (both edit these three files; one series at a time).

**Files:**
- `server/src/coord/childReclaim.ts` (≈:1692, ≈:1719, ≈:1758), `server/src/coord/expireArchived.ts` (≈:287), `server/src/coord/endDeadCoordinator.ts` (≈:280): each pair calls its `NoticeSink` with the measured mode (`record-only` for the three reclaim rows: "every reclaim lands in the feed; no push per reap"). Their deps' `notifyLog` and `coord.recordFeedEvent` members leave the `Pick<…>` types they no longer use.
- `server/test/single-definition.test.ts` ARCH-40 tail block, last commit: the feed archive's writer set is `{ notice.ts notify, stopDoneSweep.ts }` and `feedRecordCallSites().length <= 2`, may only shrink.

- [ ] **Step 0: Re-ground**; rule 6 check.
- [ ] **Step 1: Characterization commit.** C0d's five executor rows re-run on the base, plus: a reclaim with the operator visible is still recorded and still not pushed; a failed archive leaves the executor's act result and its journal row unchanged.
- [ ] **Step 2: Move commits**, one file per commit, `childReclaim.ts` last.
- [ ] **Step 3: Ratchet commit.**
- [ ] **Step 4: Mutation table, RUN.** `childReclaim.ts`: mode `record-always` (pushes when no one looks) → red "no push per reap"; a new hand pair in `coord/close.ts` → red "the feed archive has two writers"; the act-time pause rows (C0e) stay green across every commit.
- [ ] **Step 5: Verify** `feed-writers-pin.test.ts`, `reclaim-pause-pin.test.ts`, `single-definition.test.ts`, `consolidation-census.test.ts`, then the three executors' suites, one at a time.

**Exit (GATES):** `recordFeedEvent` call lines outside the store 16 → 2 (the funnel and `stopDoneSweep.ts`'s, which W4 moves), pinned; the feed's writer set pinned at two; every writer's mode unchanged (C0c and C0d green, unedited). **Rollback:** `git revert`; the ratchet goes with it.

### Task C1f: `dedupeKey` on notices; the nudge and stall lanes stop using `hasFeedEvent` as an idempotency store (D-5860; ARCH-55; spec K6, §5.1 rule 1b) — GATED: after C1e and OA-C3

**Routing:** band 2, with the behaviour commit reviewed by the orchestrator against the operator's ruling. **Lane:** server (one additive coord.db column). **Needs:** C1e; OA-C3 for the behaviour commit.

**Files:**
- `server/src/coord/schema.ts` / `db.ts` `MIGRATIONS`: `ALTER TABLE feed_events ADD COLUMN dedupe_key TEXT` (nullable, no `CHECK`), and an index on `(kind, session_id, dedupe_key)`.
- `server/src/coord/store.ts`: `recordFeedEvent` takes an optional `dedupeKey` and refuses a second row with the same `(kind, sessionId, dedupeKey)` by returning `{ changed: false }`; `hasFeedEvent` stays for readers that are not idempotency checks, if any remain (Step 0 lists them).
- `server/src/notice.ts`: `opts.dedupeKey`, passed to the archive; a refused archive row also suppresses the ring record and the push for that notice (so the three sinks agree).
- `server/src/watch.ts`: the idle-compact nudge (≈:6627, ≈:6635) and the stall lane's `queue` check (≈:8130) pass a `dedupeKey` instead of asking `hasFeedEvent` first.

- [ ] **Step 0: Re-ground** every `hasFeedEvent(` and `hasMailWithSubject(` call. `hasMailWithSubject` at `coord/rundefs.ts` ≈:386 and `watch.ts` ≈:8127 dedupes **mail**, not a notice, so it stays (see D-5860). Rule 6 check for `schema.ts`, `store.ts` and any `MIGRATIONS` entry in flight (the CB programme's).
- [ ] **Step 1: Characterization commit.** For each of the three sites: the feed rows and pushes produced by (a) a first nudge, (b) the same nudge again, (c) the same nudge after the first row's body changed, (d) a ring restart (new epoch) between them. Green on the old code.
- [ ] **Step 2: Additive commits** (the column, the store argument, the funnel option), each with no behaviour change: no caller passes a key yet, and Step 1 stays green.
- [ ] **Step 3: The behaviour commit** (after OA-C3): the three sites pass keys; Step 1's rows change **only** where the operator ruled, and the PR body lists every before/after row and cites the ruling.
- [ ] **Step 4: Mutation table, RUN.** The store ignores `dedupeKey` → red on row (b); the funnel pushes after a refused archive → red "the three sinks agree"; the migration adds `NOT NULL` → red on the rollback-bootable row (`db.ts` rule 3's test).
- [ ] **Step 5: Verify** `coord-store.test.ts` (or the migration suite Step 0 names), `notice.test.ts`, `feed-writers-pin.test.ts`, the idle-nudge and stall suites, one at a time.

**Exit (GATES):** `hasFeedEvent` idempotency call sites 3 → 0; every notice that needs once-only carries a key. **Rollback:** `git revert` of the behaviour commit restores the `hasFeedEvent` checks; the column stays, unused and harmless (spec §5.1 rule 4).

## Operator acts in this wave

- **OA-C3 (before C1f's behaviour commit): the `dedupeKey` rows.** The ask shows Step 1's before/after table for the idle-compact nudge and the stall lane's `queue` row, and names the one case where a key and a body match can disagree (a re-sent notice whose body changed). The operator rules which rows change. Nothing on a box is touched.
- **Arming nothing.** W1a changes no lane's arming. Every switch keeps its meaning, so the operator's `reclaim-paused`, `mail-disabled` and the lane-live markers act exactly as before, on either side of any commit.
- **The wave's deploys** follow the standing rule: from a fresh `origin/main` worktree as a detached unit, verified from its log. Server lane only; no session restarts.

## Acceptance

Every PR body carries: the census lists at base and tip (C0b's queries), the mutation table's red lines, the rule 6 disjointness check (each edited file, each open PR holding it, line ranges), and the first commit's name as the characterization pin. C1b, C1d and C1e carry both reviewers' verdicts. C1f carries the operator's ruling.

## Rollback

Each task is a revert of its PR, newest first. No stored data changes before C1f, and C1f's column is additive. Because every switch keeps its meaning and every writer keeps its measured mode, any revert leaves the fleet's emergency stop and the feed working. The ratchet pins revert with the commits that landed them.

## Deviations and decisions

### Issued for this work and defined here

The allocator issued the consolidation wave a block of 30 numbers, 5848 to 5877. The W0 plan defines D-5848 to D-5854; this plan defines D-5855 to D-5860.

- **D-5855** — `switchboard-table` (Task C1a; ARCH-70): every operator switch is one row of L0 `SWITCHES` (storage, default, owner, meaning, writer), read by one `readSwitches(listing)` that answers `raised | clear | unlistable`; the old marker constants re-export their row, `mail-disabled` is defined once, and every marker literal under `server/src` is a row. Markers stay the storage ccd and the hook read with the server down (spec K12).
  - **As planned:** ARCH-77's child-reclaim off switch is not added here; it lands as the first commit of W4's `child-spent` PR (spec §5.7).
- **D-5856** — `pause-read-at-pass-and-act` (Task C1b; ARCH-70): every `reclaim-paused` reader goes through `readSwitches`, twice for an executor (the tick's listing for the decision, a fresh listing nearest the argv for the act); 10 parse sites → 1 (stop-done's, moved in W4).
- **D-5857** — `notify-funnel` (Task C1c; ARCH-54): one `notify(event, mode)` in `server/src/notice.ts` owns the presence gate, ring, flush, guarded archive and push in that order, and `pushOne` routes through it; its modes are named from the W0 pin's measured combinations (spec K6, rev 2), and the ring stays the catch-up authority (O11 (a)).
- **D-5858** — `funnel-coord-routes` (Task C1d; ARCH-54): `coord/routes.ts`'s five feed writers call the funnel through a `NoticeSink` in their measured modes, inside `coord/routes.ts` and behind its auth gate; the approval ruling is stored whatever the archive does.
- **D-5859** — `funnel-executors-and-feed-writers-pinned` (Task C1e; ARCH-54): the child-reclaim, expiry and dead-coordinator writers call the funnel ("no push per reap" kept), and the feed archive's writer set is pinned at the funnel plus stop-done's until W4.
- **D-5860** — `notice-dedupe-key` (Task C1f; ARCH-55): a notice that must happen once carries a `dedupeKey`, stored in an additive `feed_events.dedupe_key` column; the archive refuses a duplicate and the funnel then skips the ring and the push, so the three sinks agree; the behaviour commit changes only the rows the operator ruled (OA-C3).
  - **Departs from the spec's K6:** `hasMailWithSubject` keeps its two callers. They dedupe mail to the operator, not a notice, so a notice key cannot replace them; the spec's line named both functions.

Issued and unused: 5861, 5862, 5863, 5864, 5865, 5866, 5867, 5868, 5869, 5870, 5871, 5872, 5873, 5874, 5875, 5876, 5877. They are held for the wave's later plans (W1b onward) and are never defined outside this programme's plans.

## Out of scope

W1b (the schedule table and `runLane`, the change latch, one registry listing per tick, `ccdCan`, the TS redactor); stop-done's feed pair and switch read (W4); any `pwa/` file (W7); any `ccd` byte (W5); ARCH-77 (W4); a server swap suggestion (O12 (a)).

## Review log

**rev 0 (2026-10-19).** Written from the spec's rev 2 and measured on `origin/main` `f64c27b65`. Not yet reviewed.
