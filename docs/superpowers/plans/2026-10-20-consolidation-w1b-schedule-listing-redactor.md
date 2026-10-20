# Consolidation wave, W1b: one schedule, one change latch, one registry listing per tick, one capability question and one redactor module — `LANE_SCHEDULE` and `runLane`, `changeLatch`, the mail ladders' single read, the tick's `FleetReadModel`, `ccdCan(row)`, and `shared/redact.mjs` with profiles — Implementation Plan

> **For agentic workers:** one PR per task (C1h is three PRs, C1l two), in the order of §Landing order, each dispatched only when its row in §Gates is all green. To execute a task, REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Steps use checkbox (`- [ ]`) syntax. Workers do not edit §Deviations and decisions. A departure is named by slug in the task's report, and the coordinator enters it, never the worker.

**Spec:** `docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md` (rev 2.2, approved by the operator 2026-10-19). §5.1 (the rules every wave follows), §5.4 (W1b), K7, K11, K12 (`ccdCan`), K13 (the listing), §2.3's clock, change-latch and redaction rows, §3.19 and §7 bind every task. Read them before Step 0.

**Status:** rev 0 (2026-10-20), written and not yet reviewed. It plans the wave the operator's O1 (d) put after W1a: "Scheduling, latches, the one listing, `ccdCan` and the TS redactor follow as W1b." O3 (a) (nothing in flight pauses), O4 (a) (lanes stay methods, one table and one helper), O9 (a) (a series lands standalone when its first commit is a characterization pin and its exit is counted) and O11 (a) also bind it. **No task here may start yet:** W1a is unbuilt (§Gates).

**Inputs.** The W0 plan (`2026-10-19-consolidation-w0-pins.md`) and the W1a plan (`2026-10-19-consolidation-w1a-switches-notify.md`), whose Global constraints, Review focus and characterization discipline this plan extends. The census module `server/test/consolidationCensus.ts` (C0b). The scan parser `server/test/scan/parse.ts` (C0f, D-5853; every new scanner here goes through it, never a parser import of its own). The tickets ARCH-68 (#803), ARCH-76 (#811), ARCH-09 (#538), ARCH-51 (#786), ARCH-71 (#806) and ARCH-66 (#801).

**Base:** `origin/main` `bece77281`. Code is cited by file and symbol (`watch.ts#sweepMail`, `ccdargv.ts#capSupported`, a `describe` title), never by line number: lines move and the citations ratchet (`citations.test.ts`, D-5893) refuses new numeric citations in code. Step 0 of each task re-grounds every symbol and every count on the tree it starts from.

**Deploy class.** **Server lane only.** No task edits `ccd/`, `agent/`, `deploy/`, the session hook or any `pwa/` file, so the agent lane of the standing AGENT-FIRST rule has nothing to deploy, and no session restarts. No task bumps `FLEET_PROTO` and no wire frame changes. No coord.db migration. C1l adds `shared/redact.mjs`, which only server code imports in this wave.

**Names.** Tasks are **C1g** to **C1l**, after the W1a plan's C1a to C1f. Operator acts are **OA-C4** and **OA-C5** (OA-C1 to OA-C3 belong to the W0 and W1a plans).

**Goal, PR by PR.**

| After | The operator sees | Underneath |
|---|---|---|
| `main` | nothing | 24 named cadence clocks in `FleetWatcher` (26 with W4's two), 22 of them on wall-clock; 12 single-flight guards; 6 hand-rolled change latches; 8 registry listings in a steady tick with every throttle elapsed (static reading); 3 mail ladders that list the registry twice; 63 call sites that choose between `verbSupported` and `capSupported`; 3 JS/TS redactor rule tables |
| C1g | nothing | `server/src/changeLatch.ts`; the 6 hand-rolled change latches → 0 |
| C1h (3 PRs) | nothing, except where OA-C4 rules | `LANE_SCHEDULE` and `runLane`; 24 → 0 named clocks; the throttle of expiry and dead-coordinator on the monotonic clock (a behaviour commit); the 3 declared derivations kept as references |
| C1i | nothing | `attributionVerdict`, `POST /api/mail` and `POST /api/mail/:id/ack` read the registry once (`readRegistryMeasured`) |
| C1j | nothing | the tick's `FleetReadModel`; selection listings per steady tick 8 → 1, counted by an instrumented fake `FleetIO`; the act-time reads stay, by name |
| C1k | nothing | `ccdCan(row)` and a `default` column in `CCD_ARGV`; every verb-shaped choice goes through it; flag tokens stay `capSupported` |
| C1l (2 PRs) | nothing | `shared/redact.mjs` with one rule table and explicit profiles; the egress and docs tables move (3 → 2); the history-index profile after history W2 and its coordinator's ack (2 → 1) |

---

## Gates: what each task waits for, stated honestly

Measured on 2026-10-20 at `bece77281` with `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,files` (26 open PRs; the dependency bumps edit only lockfiles, `package.json` files and `.github/workflows/*`).

- **W1a is not built.** No commit on `origin/main` cites D-5856 to D-5859, and no open PR carries C1a to C1f. Of W0, C0a to C0f have merged (#843, #845, #868, #844, #893, #871, #915) and so have the prerequisites C0h (#874) and C0i (#894, #919); **C0g (D-5854) is being built and has no PR yet**. Every task here waits for the W1a task named in its row, and through it for C0g. This is the spec's sequencing (O1 (d), §5.4 "Waits for: W1a"), not only a file overlap: C1k and C1l touch no W1a file, and this plan does not relax the gate for them.
- **ARCH-06's W1b slice** (a later W0 slice, spec §5.2) is **not yet planned**. Measured on `bece77281`: 36 suites read `watch.ts` as text, 25 read `coord/routes.ts`, 5 read `ccdargv.ts`, 4 read `registry.ts` and 1 reads `coord/redact.ts`. Those whose literal slices cover a region a task here rewrites move onto `server/test/scan/symbols.ts` (C0g) in that slice first, so W1b's move commits change tests only in their imports (spec §5.1 rule 1). It is appended to the W0 plan's later-slice tasks, with its own D-number, after #927 (which holds that plan's later-slice section) has landed. Each task's Step 0 lists the suites it needs moved; a task whose suites are not yet moved waits.
- **The history programme's W2** (#856 "W2-3", #826 "W2-4", both open) gates C1l's second PR only, the history-index profile, together with that programme coordinator's ack (spec K7, §7).
- **Rule 6** (spec §5.1): before every commit, each task lists the open PRs holding each file it edits and keeps its hunks line-disjoint from theirs, or waits. On `bece77281`:
  - **#911** holds `watch.ts` (imports, `FleetWatcher` fields, and `sweepArchivedExpiry`'s region), `server.ts` (`buildServer`), `archivedExpiry.ts` and `shared/api.ts`. C1h's expiry move waits for it or measures disjointness.
  - **#832** (draft) holds `watch.ts`'s `DelegationLane` and the delegation constants. No task here edits `DelegationLane` while #832 is open (see C1h).
  - **#927** holds `coord/collectTempRoot.ts` (`collectAudit`, `collectTempRoot`), `coord/expireArchived.ts` (imports, `expireAudit`, `expireAct`), `server/test/consolidationCensus.ts` (a tail append) and the W0 plan. C1k's commits in those two files, and every census query this plan appends, wait for it or follow its tail.
  - **#895** and **#737** hold `server/test/single-definition.test.ts`. Each task's ratchet commit appends to the file's ARCH-40 tail block and measures its hunk against both live diffs at Step 0.
- **Hibernation Task 19** gates nothing here. `stopDoneSweep.ts` and `hibernateSweep.ts` are never edited, and `lastStopDoneSweep`, `lastHibernateSweep`, `stopDoneSweeping` and `hibernateSweeping` stay where they are (spec §5.4: they move in W4).
- **OA-C4** gates C1h's second behaviour commit only. **OA-C5** gates nothing; it is a notice (see §Operator acts).

| Task | W1a | ARCH-06 W1b slice | Rule 6 today | History W2 | OA | Other |
|---|---|---|---|---|---|---|
| C1g change latch | C1e (last `watch.ts` series) | the latch methods' pins | #911 (`watch.ts` fields) | — | — | — |
| C1h schedule (3 PRs) | C1f (it edits `watch.ts` last) | the lane methods' and tick-order pins | #911 (expiry region), #832 (`DelegationLane`) | — | OA-C4 (second behaviour commit only) | C1g |
| C1i mail ladders | C1d (it edits `coord/routes.ts`) | `coord/routes.ts`'s three ladder pins | none | — | — | — |
| C1j one listing | C1a and C1b (`asks-disabled`, `mail-disabled` and `reclaim-paused` through `readSwitches`) | `tick`'s pins | #911 | — | — | C1h, C1i |
| C1k `ccdCan` | C1e (the executors) | `verb-gate.test.ts`'s literal gate scan | #927 (`expireArchived.ts`, `collectTempRoot.ts`), #911 (`watch.ts`, `server.ts`) | — | — | one `watch.ts` series at a time |
| C1l redactor, PR 1 | the wave gate (O1 (d)) | `single-definition`'s redactor blocks | none | — | — | — |
| C1l redactor, PR 2 | — | — | `ccd/history/lib.mjs`'s holders | **#856, #826 and the coordinator's ack** | — | C1l PR 1 |

## In flight, and what it fences off

| In flight | Files it changes that this plan would otherwise touch | Tasks it gates |
|---|---|---|
| W1a (C1a to C1f, unbuilt) and C0g (building) | `shared/switches.ts`, `watch.ts`, `coord/routes.ts`, the executors, `single-definition.test.ts` | all |
| #911 | `watch.ts` (`sweepArchivedExpiry` and fields), `server.ts`, `archivedExpiry.ts`, `shared/api.ts` | C1g, C1h, C1j, C1k if a hunk overlaps |
| #832 (draft) | `watch.ts` (`DelegationLane`, the delegation constants) | C1h's `DelegationLane` row |
| #927 | `coord/collectTempRoot.ts`, `coord/expireArchived.ts`, `consolidationCensus.ts` (tail), the W0 plan | C1k in those files; every census append |
| #895, #737 | `single-definition.test.ts` | each ratchet commit (Step 0 measures) |
| #856, #826 | the history programme's W2 | C1l PR 2 |

No open PR measured on 2026-10-20 holds `server/src/registry.ts`, `server/src/ccdargv.ts`, `server/src/coord/redact.ts`, `shared/docs.ts`, `server/src/fleet.ts`, `server/test/verb-gate.test.ts`, `server/test/redact.test.ts`, `server/test/docs-parity.test.ts`, `server/src/changeLatch.ts`, `server/src/laneSchedule.ts` or `shared/redact.mjs`. Each task re-reads every list at Step 0.

## Landing order

```
W1a (C1a … C1f) + C0g + ARCH-06's W1b slice
  ├── C1g (changeLatch; 6 → 0) ── C1h-1 ── C1h-2 ── C1h-3 (24 → 0; behaviour commit) ── C1j (one listing; 8 → 1)
  ├── C1i (mail ladders; after C1d) ───────────────────────────────────────────────────────┘
  ├── C1k (ccdCan; its watch.ts commit takes its turn in the watch.ts queue)
  └── C1l-1 (egress + docs profiles; 3 → 2) ── [history W2 + ack] ── C1l-2 (history-index; 2 → 1)
```

Only one series edits `watch.ts` at a time (spec §5.1 rule 6): C1g, C1h, C1j and C1k's `watch.ts` commit never sit in the queue together. C1j follows C1h because both restructure `tick`'s dispatch, and C1i because its route reads are the listing work's first step (ARCH-09 is absorbed into K13, spec §4.1).

## Global constraints

The W0 plan's §Global constraints (public repository, SAFETY, no root runner, characterization discipline, counts measured, band routing, branch discipline) and the W1a plan's (each PR's first commit is a characterization pin, behaviour commits are their own, the act-time re-read stays, no `pwa/` file, no `ccd` byte, wire discipline, counted exits) bind this plan, with these additions.

- **Lanes stay methods** (O4 (a)). `runLane` owns the throttle, single-flight, catch and warn-once around a lane; it decides nothing a lane decides. A lane's decider, its executor and its act-time reads do not move in W1b.
- **Verdicts keep wall-clock.** Only a throttle or a single-flight may move to the monotonic clock. Expiry's `expiresAt`, stop-done's grace from `closedAt`, hibernate's marker stamps and every `now` a decider reads stay on wall-clock (spec K11).
- **Cadence is not safety.** A safety interval (the twice-observed window, a backoff base, a recovery retry) is never a `LANE_SCHEDULE` cadence column. A derived interval stays a declared reference to its source, never a second literal.
- **The act-time reads stay** (spec K1, K3, K12). C1j counts **selection** listings. A listing an executor takes at the act, or a lane takes as its last fail-shut switch read before it acts, stays fresh, is named in the census's act-read list, and is counted there, never folded into the tick's snapshot.
- **The egress redactor is a security boundary** (spec K7, D-5299, D-5360). Its output over the 196-row corpus (`fixtures/approvals/redact-corpus.json`) is unchanged byte for byte through every commit. No rule is unified across profiles in W1b: profiles whose rule for one shape differs (the URL-userinfo rule masks to the last `@` in egress and stops at the first `@` in docs) keep two rows.
- **No ring-crossing import.** `shared/redact.mjs` and `server/src/laneSchedule.ts` are L0 data and pure functions; `runLane` is L4 in `watch.ts`; `changeLatch.ts` is pure. The ring rules (D-6000) and the inner-ring host-import pin (D-6003) stay green.
- **Every new scanner uses `server/test/scan/parse.ts`** (D-5853). No suite here imports a parser.
- **Deviation ledger.** This plan defines D-5861, D-5862, D-5863, D-5864, D-5866 and D-5867, one per task, and never allocates.

## Review focus (the failure modes most likely to bite)

1. **A throttle that moved clocks inside a move commit.** 22 of the 24 clocks throttle on `Date.now()` today, and 20 suites drive time with `vi.setSystemTime`. `runLane`'s `clock` column carries each lane's clock as it is today. Only the two behaviour commits change one (expiry and dead-coordinator first; the other 20 only after OA-C4), each with its before/after rows.
2. **A lost kick or a lost out-of-gate stamp.** `inventoryNow` and `serverCapsNow` stamp their clocks when they run on demand, and `childMarkLeftListing` resets `lastLifecycleSweep` to 0 so the next tick runs the lane. `runLane` keeps both as named operations (`stamp`, `kick`); a move that drops one changes when a lane runs.
3. **Skip versus join.** The boolean guards skip a pass while one runs; `inventoryRun`, `serverCapsRun`, `dispatchRun` and `deadCoordinatorPassRun` hand the caller the run in flight. `runLane` has both flight modes, and each lane keeps its own.
4. **A stamp moved after the await.** Child reclaim and collect stamp their throttle before the gather, so a tick that lands mid-gather is throttled. `runLane` stamps before it awaits the lane, for every lane.
5. **An act-time read folded into the snapshot** (C1j). `sweepMail`'s fail-shut `mail-disabled` read, `sweepAsks`'s `asks-disabled` read, and each executor's late read stay fresh at the act. The instrumented count separates selection listings from act-time reads, and a mutant that serves an act-time read from the tick's listing is red.
6. **A gate that changed polarity** (C1k). `verbSupported` permits on no evidence; `capSupported` refuses. Each `CCD_ARGV` row's `default` is today's polarity at every call site that gates that verb. A destructive verb (`ws-expire`, `ws-reclaim`, `ws-collect`) refuses on no evidence, as today.
7. **A redactor that over-masks or under-masks** (C1l). The egress corpus and the docs parity rows are byte pins; a rule moved into the wrong profile shows as a changed row, never as a passing suite.
8. **A gate that reads as ungated.** `verb-gate.test.ts` recognises a gate by the literal `verbSupported(`, and the docs adapter's functions by a literal `capSupported(` (`docs/ccdsource.ts`'s header). It learns `ccdCan(` in C1k's characterization commit, before any call site moves.

## Tasks

### Task C1g: one `changeLatch` — "warn once until it changes" (D-5861; ARCH-76 (#811); spec §2.3's change-latch row) — GATED: after W1a's C1e and the ARCH-06 W1b slice

**Routing:** band 2 (a pure helper and six literal moves; no lane decides differently). **Lane:** server. **Needs:** C1e (the last W1a series before C1f that edits `watch.ts`), the ARCH-06 slice for the six methods below.

**Measured on `bece77281`.** Six hand-rolled latches in `FleetWatcher`, each a `last*` field compared before a `console.warn` and re-assigned: `lastServerCapsWhy` (`serverCapsNow`), `lastInventoryRejectWarn` (`warnInventoryRejected`, with a clear arm), `lastProjectionWhy` (`sweepThenProject`), `lastReleasePushFailure` (`pushRelease`, with two clear arms), `lastStaleReport` and `lastOrphanReport` (keyed per project; both in `sweepLedgerReconcile`). The spec's "at least four" are the first four. Seven `*Warned` fields are a different shape, step 0 classifies them: `snapshotWriteSkippedWarned` and `snapshotWriteSkippedDegradedWarned` re-arm on success (a latch on a boolean key), `collectControlWarned`, `stallWarned` and `stallSettingsWarned` are sets pruned by their lanes, and `deadCoordinatorBreakerUnsealWarned` and `DelegationLane#warnedUnparseableCursors` never re-arm. `registry.ts`'s `warnOnce` is no longer a function: the mechanism is `warnState`, a per `id#field` cooldown (`WARN_COOLDOWN_MS`) with an escalation clock (`REGISTRY_UNMEASURED_STUCK_MS`) and a prune per listing, which is a rate limit, not a change latch (D-5861).

**Files:**
- Create `server/src/changeLatch.ts` (pure, L1): `changeLatch<K>()` → `{ changed(key: K): boolean; clear(): void }`, where `changed` answers `true` the first time and whenever the key differs from the last one it saw (compared with `===` on a string, or a caller-supplied `keyOf`), and `clear` re-arms it. A keyed form, `changeLatchMap<G, K>()`, holds one latch per group (`lastOrphanReport`'s per-project shape) and prunes a group on request.
- Modify `server/src/watch.ts`: the six latches use it, one per commit, with their warn sentences and their clear arms unchanged. The re-arming `*Warned` booleans move only if step 0 classifies them as latches; the never-re-arming ones stay.
- Create `server/test/change-latch.test.ts`.
- Modify `server/test/consolidationCensus.ts` (a tail append after #927): `changeLatchSites()`, the `last*` fields compared with `!==` or `===` before a `console.warn` and assigned after it, outside `changeLatch.ts`.
- Modify `server/test/single-definition.test.ts`'s ARCH-40 tail block, last commit: `changeLatchSites().length === 0`, may only shrink.

- [ ] **Step 0: Re-ground** the six latches and the seven `*Warned` fields by symbol on the post-W1a tree; classify each `*Warned` field (re-arms on change, re-arms on success, pruned set, never re-arms) and record the table in the PR body. Rule 6 check for `watch.ts` and `single-definition.test.ts`.
- [ ] **Step 1: Characterization commit.** One row per latch, driven through its method: the warn line printed once for a repeated key, again for a changed key, and again after the clear arm runs (for the three that have one), with each sentence byte for byte. Green on the old code.
- [ ] **Step 2: Red.** `change-latch.test.ts`: first key → `true`; same key → `false`; new key → `true`; after `clear` the same key → `true`; the map form keeps groups apart and prunes one. Red (no module).
- [ ] **Step 3: Green**, then the move commits, one latch per commit, `sweepLedgerReconcile`'s two last. Each runs Step 1's rows unchanged.
- [ ] **Step 4: Ratchet commit.**
- [ ] **Step 5: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `changed` answers `true` for a repeated key | change-latch, Step 1's row for `warnInventoryRejected` | "a repeated rejection warns once" |
  | `clear` does nothing | Step 1's row for `pushRelease` | "a release push that recovers re-arms the warning" |
  | the map form shares one latch across projects | Step 1's row for the orphan report | "a second project's orphans are reported" |
  | a new `if (x !== this.lastFooWhy) console.warn(…)` in `watch.ts` | single-definition | "no hand-rolled change latch remains" |

- [ ] **Step 6: Verify.**

      cd server && ./node_modules/.bin/tsc --noEmit
      cd server && ./node_modules/.bin/vitest run test/change-latch.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/consolidation-census.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

  then each moved method's existing suite, one at a time (step 0 names them).

**Exit (GATES):** `changeLatchSites()` 6 → 0, pinned; every latch's sentence and re-arm unchanged. **OBSERVATION:** the `*Warned` classification table. **Rollback:** `git revert`; no state outlives the process.

### Task C1h: one `LANE_SCHEDULE` and `runLane`; cadence apart from safety; the throttle on the monotonic clock (D-5862; ARCH-68 (#803); spec K11, §2.3's clock row, §5.1 rule 1b) — GATED: after W1a's C1f, C1g and the ARCH-06 W1b slice

**Routing:** PR 1 and PR 2 band 2. **PR 3 band 3, native**: it wraps the child-reclaim, collect, expiry and dead-coordinator lanes, which select destructive acts, and it carries the behaviour commit. Two reviewers on PR 3, one reading only Review focus 1 to 4. **Lane:** server. **Needs:** C1f, C1g, the ARCH-06 slice for the lane methods and the tick-order pins; #911 merged or line-disjoint for PR 3; OA-C4 for PR 3's second behaviour commit only.

**Measured on `bece77281`.** `watch.ts` is 11,835 lines and declares 54 `last*` fields (48 in `FleetWatcher`, 6 in `DelegationLane`); the spec's §1.1 counted 56. Every one of the spec's 25 named clocks is present. **One cadence clock is missing from the spec's list:** `lastIdleNudgeAt` throttles `sweepIdleCompactNudge` on `IDLE_NUDGE_SWEEP_MS`, so W1b's list is 24 and the overall list 26 (D-5862). Two clocks throttle on the monotonic clock today (`lastChildReclaimSweep` and `lastCollectSweep`, through `childReclaimLaneNow().monoMs`); the other 22 compare `Date.now()`. Expiry and dead-coordinator throttle on wall-clock against the same constant child reclaim throttles monotonically (`CHILD_RECLAIM_SWEEP_MS`). Two cadences are bare literals: `sweepApprovals`'s day (`86_400_000`) and `sweepDigest`'s beat (`60_000`). Twelve single-flight guards: eight booleans (`collectSweeping`, `stallSweepRunning`, `idleNudgeRunning`, `archivedExpirySweeping`, `stopDoneSweeping`, `hibernateSweeping`, `deadCoordinatorSweeping`, `ticking`) and four promise fields that hand the run in flight to a second caller (`inventoryRun`, `serverCapsRun`, `dispatchRun`, `deadCoordinatorPassRun`). The three declared derivations are references in code today: `COLLECT_OBSERVE_INTERVAL_MS = CHILD_RECLAIM_SWEEP_MS`, `STALL_SWEEP_MS = CLAIM_SWEEP_MS` and `DELEGATION_SWEEP_MS = DIVERGENCE_SWEEP_MS`.

**Files:**
- Create `server/src/laneSchedule.ts` (L0 data): `LANE_SCHEDULE`, one row per lane: `name`, `cadenceMs` (a number, or a declared reference to another row or to a named safety constant, with its reason), `clock` (`'mono' | 'wall'`, each lane's clock **as it is today**), `flight` (`'skip' | 'join' | 'none'`), `warnKey` (the lane's catch sentence, or `null`). Safety intervals (`CHILD_RECLAIM_STALL_MS`, `COLLECT_AUDIT_STALL_MS`, the mail and PR backoffs, `DELEGATION_RECOVERY_RETRY_MS`) are **not** rows. A `derivedFrom` field names each of the three derivations and `UPDATE_CATALOGUE_MS`'s reference to `CATALOGUE_POLL_INTERVAL_MS`.
- Modify `server/src/watch.ts`: `runLane(name, fn)` on `FleetWatcher` (L4), which owns the throttle (stamped **before** `fn` is awaited, on the row's clock), the single-flight in the row's mode, the catch with the row's warn (through C1g's `changeLatch` where the lane warns once), plus `stamp(name)` (an on-demand run, as `inventoryNow` and `serverCapsNow` do) and `kick(name)` (the next tick runs the lane, as `childMarkLeftListing` does for `lastLifecycleSweep`). Lanes move one per commit; each lane's `last*` field and its guard are deleted in the commit that moves it.
  - **PR 1 (band 2):** the table, `runLane`, and the lanes outside coordination: `sweepTasks`, `sweepUsage`, `sweepPr` (whose cadence varies with `PR_SWEEP_ACTIVE_MS`: the row carries both values and the lane's choice), the caps, catalogue, inventory and server-caps beats in `tick`, `sweepNames`, `sweepDivergences`, `sweepLifecycle`, `sweepReadiness`, `sweepLedgerReconcile`.
  - **PR 2 (band 2):** `renewClaims`, `lapseClaims`, `sweepStalls`, `sweepIdleCompactNudge`, `sweepMail`, `sweepAsks`, `sweepApprovals` and `sweepDigest` (their bare literals become named rows).
  - **PR 3 (band 3):** `sweepChildReclaim`, `sweepTempRootCollect`, `sweepArchivedExpiry`, `sweepDeadCoordinators`; then the behaviour commits.
  - `DelegationLane#lastSweepAt` is a cadence clock in its own class. While #832 holds `DelegationLane`, it stays and the census reports it under its own name; it becomes a row in the first PR that opens after #832 has merged or closed. `DelegationLane#lastRecoverAt` is a recovery backoff and stays.
- Create `server/test/lane-schedule.test.ts`.
- Modify `server/test/consolidationCensus.ts` (tail): `laneClockFields()` (the named list above, as the spec asks: "named clocks, by name"), `singleFlightGuards()`, `cadenceLiterals()` (a bare millisecond literal compared against a lane clock).
- Modify `server/test/single-definition.test.ts`'s ARCH-40 tail block, PR 3's ratchet commit: `laneClockFields()` lists only `lastStopDoneSweep`, `lastHibernateSweep` (and `DelegationLane#lastSweepAt` while #832 is open); `cadenceLiterals()` is empty; each derivation is a reference, 3 of 3. May only shrink.

- [ ] **Step 0: Re-ground** every clock, guard and derivation by symbol; confirm `lastIdleNudgeAt` is still a cadence; list each lane's clock, flight mode and out-of-gate stamps; measure whether `vi.useFakeTimers` in the 20 suites that call `setSystemTime` also fakes `performance.now` (it decides how the behaviour commits' rows are written). Rule 6 check per PR.
- [ ] **Step 1: Characterization commit** (each PR's first). Per moved lane, driven through `tick` with an injected `Deps.monotonicMs` and a fake wall clock: the lane runs on the first tick, skips inside its cadence, runs once the cadence elapses; a second call while one runs skips (or joins, for the join lanes); a throw is caught with the lane's sentence and the next tick still runs. Plus, per clock as it is today: **wall-clock steps back by one hour** and **wall-clock steps forward by one hour** between two ticks, recording what the lane does (the rows the behaviour commits change). Plus `inventoryNow`'s and `serverCapsNow`'s on-demand stamp and `childMarkLeftListing`'s kick. Green on `main`.
- [ ] **Step 2: Red.** `lane-schedule.test.ts`: every row's `cadenceMs` resolves to a positive number; every `derivedFrom` names an existing row or constant; no row's cadence is a safety constant; `runLane` stamps before it awaits (a second call during the first's await skips); `kick` makes the next call run; `join` hands back the same promise. Red (no module).
- [ ] **Step 3: Green**, then the move commits, one lane per commit; each runs Step 1's rows unchanged.
- [ ] **Step 4: Behaviour commit 1 (PR 3, spec §5.1 rule 1b):** `sweepArchivedExpiry`'s and `sweepDeadCoordinators`' rows switch `clock` to `'mono'`, as child reclaim's is. Step 1's two wall-step rows for those lanes change, and only those: before, a wall-clock step back holds the lane for up to the step; after, it runs at its cadence. The PR body lists the before/after rows and cites spec K11 and §5.1 rule 1b, which name this change.
- [ ] **Step 5: Behaviour commit 2 (PR 3, after OA-C4 only):** the other 20 wall-clock rows switch to `'mono'` if and as the operator rules; otherwise they stay `'wall'` and the PR says so.
- [ ] **Step 6: Ratchet commit.**
- [ ] **Step 7: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `runLane` stamps after `await fn()` | lane-schedule, child reclaim's Step 1 row | "a tick that lands mid-gather is throttled" |
  | `runLane` ignores `kick` | Step 1's lifecycle row | "a child mark leaving the listing runs the lifecycle lane next tick" |
  | `inventoryNow` no longer stamps | Step 1's inventory row | "an on-demand inventory pushes the beat back" |
  | `dispatchRun`'s row `flight: 'skip'` | Step 1's dispatch row | "a second caller joins the run in flight" |
  | expiry's row `clock: 'wall'` after behaviour commit 1 | Step 1's expiry wall-step row | the after-row |
  | `COLLECT_OBSERVE_INTERVAL_MS` given a literal `60_000` | single-definition | "each derivation is a reference" |
  | a new `private lastFooSweep = 0` compared in a lane | single-definition | "no named lane clock outside runLane" |
  | `sweepDigest`'s `60_000` restored inline | single-definition | "no bare cadence literal" |

- [ ] **Step 8: Verify** `lane-schedule.test.ts`, `consolidation-census.test.ts`, `single-definition.test.ts`, `reclaim-pause-pin.test.ts` (C0e, unchanged), `feed-writers-pin.test.ts` (C0c, C0d, unchanged), then each moved lane's suites, one at a time; `tsc --noEmit`.

**Exit (GATES):** named lane clocks 24 → 0 (W4's two, and `DelegationLane#lastSweepAt` while #832 is open, reported); single-flight guards moved into `runLane` except `ticking` (the tick's own guard) and W4's two; cadence literals 2 → 0; derivations declared as references, 3 of 3; the throttle of expiry and dead-coordinator on the monotonic clock. **OBSERVATION:** `watch.ts` lines at base and tip (spec §5.4). **Rollback:** `git revert` per PR, newest first; the behaviour commits revert alone and restore the wall-clock throttle.

### Task C1i: mail ingress reads the registry once (D-5863; ARCH-09 (#538), absorbed into K13 as its first step, spec §4.1) — GATED: after W1a's C1d and the ARCH-06 W1b slice

**Routing:** **band 3, native**: `attributionVerdict` decides who a mail is from, and the two routes are the mail ingress's auth-adjacent edge. Two reviewers. **Lane:** server. **Needs:** C1d (it moves `coord/routes.ts`'s feed writers), the ARCH-06 slice for any literal pin over the three ladders.

**Measured on `bece77281`.** Three ladders in `coord/routes.ts` list the registry (`io.readdir`) and then call `readRegistry`, which lists it again through `readRegistryMeasured`: `attributionVerdict` (inside `registerCoordRoutes`), `POST /api/mail` and `POST /api/mail/:id/ack`. `registry-refused-census.test.ts` tags all three `raw-name`, and its `sitesOf('coord/routes.ts', 'readRegistry')` row counts 5 (the three ladders and the two approval routes). On an unlistable registry, `attributionVerdict` refuses after its one `readdir`.

**Files:**
- Modify `server/src/coord/routes.ts`: each ladder takes one `readRegistryMeasured` and uses its `names` and `records`; `{ listed: false }` answers as the ladder's unlistable arm does today; a listed registry with an unreadable target row still answers `registry-unmeasurable`. One ladder per commit.
- Modify `server/test/registry-refused-census.test.ts`: the three rows move from `raw-name` to `refuses`, and the `readRegistry` count becomes 2, each in the commit that moves its ladder (a census edit the ticket names, not a characterization assertion).
- Create `server/test/mail-ingress-one-read.test.ts`.

- [ ] **Step 0: Re-ground** the three ladders; check whether `coord/dispatch.ts` still has a dropped-row path the ticket names, and if it does, record it in the PR body for a follow-up (it is not in this task's diff unless step 0 finds it is one of the three). Rule 6 check for `coord/routes.ts`.
- [ ] **Step 1: Characterization commit.** For each route, through Fastify `inject` with a fake `FleetIO`: a listable registry with the sender present, absent, refused, and with its row unreadable; an unlistable registry. Status and body bytes. Green on the old code.
- [ ] **Step 2: Red.** `mail-ingress-one-read.test.ts`: on a listable registry each route calls `readRegistryMeasured` once and `readRegistry` never (a spy, not a raw `readdir` counter, because `readRegistryMeasured` may re-list to settle a reap race). Red on `main`.
- [ ] **Step 3: Move commits**, one ladder per commit, `attributionVerdict` last.
- [ ] **Step 4: Mutation table, RUN.** A ladder that answers "absent" for a refused row → red on Step 1's refused row; the unreadable-row arm folded into "absent" → red "a listed registry with an unreadable target row answers registry-unmeasurable"; a second `readRegistry` call restored → red on the spy row.
- [ ] **Step 5: Verify** `mail-ingress-one-read.test.ts`, `registry-refused-census.test.ts`, `registry-retained-callers.test.ts`, then the mail route suites step 0 names, one at a time; `tsc --noEmit`.

**Exit (GATES):** the three ladders' double listing 3 → 0; their census rows `refuses`; Step 1 unchanged. **Rollback:** `git revert`.

### Task C1j: one registry listing per tick — the tick's `FleetReadModel` (D-5864; ARCH-51 (#786); spec K13's listing half) — GATED: after C1h, C1i, W1a's C1a and C1b, and the ARCH-06 W1b slice

**Routing:** **band 3, native**: the listing feeds child reclaim's, expiry's, collect's and dead-coordinator's selection, and the mail lane's fail-shut switch. Two reviewers, one reading only Review focus 5. **Lane:** server. **Needs:** C1h (both restructure `tick`'s dispatch), C1i (the route-side first step), C1a and C1b (`asks-disabled`, `mail-disabled` and `reclaim-paused` read through `readSwitches`), the ARCH-06 slice for `tick`'s pins.

**Measured on `bece77281` (static reading).** `tick` takes one `readRegistryMeasured` and hands its `records` and `names` to `sweepHookStates`, `sweepUsage`, `detectDialogs`, the coordination lanes, the stall, stop-done, hibernate and idle-nudge lanes and the ledger floor. Seven listings remain in a steady tick with every throttle elapsed: `sweepTasks` (`readRegistryMeasured`), `sweepNames` (`readRegistry`), `sweepDivergences` (`readdir`), `sweepMail` (a `readdir` for its fail-shut `mail-disabled` read and its turn mode, then `readRegistryMeasured`), `sweepPr` (`readRegistry`) and `sweepAsks` (`readdir`, for `asks-disabled`): 8 with the tick's own. Two more are conditional confirmations: the snapshot write's re-listing when the fleet shrank, and `readRegistryMeasured`'s own re-list to settle a reap race. The spec's "up to 7" was counted before `sweepAsks`' read was named. The instrumented count at Step 1 is the number of record. `assembleFleet` takes 14 positional arguments at the tick's call; it has six production callers, all pinned by `registry-refused-census.test.ts`.

**Files:**
- Create `server/src/fleetReadModel.ts` (L1, pure): `FleetReadModel`, built once per tick from the tick's `RegistryRead` and the watcher's per-session caches (statuslines, task progress, PR states, hook states, usage, head branches, pane pids, pending dialogs), with a `switches` field from `readSwitches(names)` (C1a). It holds no clock and no I/O.
- Modify `server/src/watch.ts`: `tick` builds the model once; each lane above takes it in place of its own listing, one lane per commit. `assembleFleet`'s call in `tick` takes the model's fields (its signature does not change in W1b; its five other callers are request-time reads and keep their own fresh read, W2's work under K13).
- **Kept fresh, by name** (the act-read list, Global constraints): `sweepMail`'s `mail-disabled` read, if step 0 confirms it is the last switch read before delivery (it then reads `readSwitches` over a fresh listing, as C1b does for the executors); every executor's late read (C1b); the snapshot's shrink re-confirmation; `readRegistryMeasured`'s reap-race re-list.
- Create `server/test/fleet-read-model.test.ts` with an instrumented fake `FleetIO` that counts `readdir(registryDir)` per tick, tagged by caller.
- Modify `server/test/consolidationCensus.ts` (tail): `registryListingSites()` (the `readdir(…registryDir…)`, `readRegistry(` and `readRegistryMeasured(` calls in `watch.ts`, each tagged `selection` or `act`).
- Modify `server/test/single-definition.test.ts`'s ARCH-40 tail block, last commit: no `selection` site outside `tick`.

- [ ] **Step 0: Re-ground** every listing site by symbol and classify it `selection` or `act`, with the reason; for `sweepMail` and `sweepAsks`, read whether a later fresh read guards the act; record the table in the PR body. Rule 6 check for `watch.ts` (#911).
- [ ] **Step 1: Characterization commit.** The instrumented fake, driven through `tick` with every throttle elapsed: the count per caller today (the base table); and per moved lane, its output over a registry that changes **between two ticks** (a row appears, a row is refused, a row's file becomes unreadable), so a lane reading a stale model shows as a changed row. Plus "a switch raised between the tick's listing and the act holds" for the mail lane and every executor (C0e's rows, unchanged). Green on `main`.
- [ ] **Step 2: Red.** `fleet-read-model.test.ts`: in a steady tick the fake counts one `selection` listing; an unlistable registry gives a model with `listed: false` and no lane acts on it (each lane's own unlistable sentence is printed as today); the model's `switches` equals `readSwitches(names)`. Red (no module).
- [ ] **Step 3: Move commits**, one lane per commit: `sweepTasks`, `sweepNames`, `sweepPr`, `sweepDivergences`, `sweepAsks`, `sweepMail` last.
- [ ] **Step 4: Ratchet commit.**
- [ ] **Step 5: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `sweepMail` reads `mail-disabled` from the model instead of a fresh listing (if step 0 kept it fresh) | reclaim-pause-pin style row for mail | "a mail switch raised after the tick's listing holds" |
  | an executor's late read served from the model | reclaim-pause-pin (C0e) | "a pause raised during the act holds" |
  | `tick` lists twice | fleet-read-model | "one selection listing per steady tick" |
  | `sweepNames` keeps its own `readRegistry` | single-definition | "no selection listing outside tick" |
  | the model built from the previous tick's read | Step 1's between-ticks rows | the appeared-row row |

- [ ] **Step 6: Verify** `fleet-read-model.test.ts`, `reclaim-pause-pin.test.ts`, `registry-refused-census.test.ts`, `consolidation-census.test.ts`, `single-definition.test.ts`, then each moved lane's suites, one at a time; `tsc --noEmit`.

**Exit (GATES):** selection listings per steady tick 8 → 1, counted by the instrumented fake; act-time reads unchanged, by name; C0e unchanged. **OBSERVATION:** the conditional re-lists' counts. **Not in this task:** `GET /api/fleet`, `/ws/fleet` and `SessionStream`'s polls reading the model (ARCH-52 and W2), and `assembleFleet`'s signature. **Rollback:** `git revert` per commit.

### Task C1k: `ccdCan(row)` — one question for "can this box's ccd do this" (D-5866; ARCH-71 (#806); spec K12's `ccdCan`) — GATED: after W1a's C1e and the ARCH-06 W1b slice

**Routing:** **band 3, native**: the gate sits in front of destructive verbs (`ws-expire`, `ws-reclaim`, `ws-collect`) and the swap and approval paths, and a polarity slip permits a verb on no evidence. Two reviewers, one reading only Review focus 6 and 8. **Lane:** server. **Needs:** C1e (the executors), #927 merged or line-disjoint for `coord/expireArchived.ts` and `coord/collectTempRoot.ts`, #911 for `watch.ts` and `server.ts`, the ARCH-06 slice for `verb-gate.test.ts`'s literal scan.

**Measured on `bece77281`.** Outside `ccdargv.ts`, 30 `verbSupported(` calls (permit on no evidence) and 33 `capSupported(` calls (refuse on no evidence) in 15 files; `server.ts` has 16 of the lines. `capSupported` is asked about two kinds of token: a token that says a **verb** exists or is safe to send (`EXPIRE_CAP`, `RECLAIM_CAP`, `COLLECT_CAP`, `DOCS_CAP`, `ROUTE_CAP`, `ROUTE_APPLY_CAP`, `'stop-surface'`), and a token that says an existing verb parses a **flag** (`ACTOR_FLAGS_CAP`, `POOLS_CAP`, `ROUTE_ARGV_CAP`, `CHILD_ARGV_CAP`, `SWAP_BUSY_CAP`, `RECLAIM_PAUSE_CAP`, and `accounts/gate.ts`'s `ask.cap`). `CCD_ARGV` has about 29 builder rows. `verb-gate.test.ts` finds a gate by the literal `verbSupported(` in the call site's enclosing function, and its `CAP_GATED_VERBS` names the verbs that must be gated by `capSupported`; `docs/ccdsource.ts` keeps a literal `capSupported(` in each of its two functions for that reason.

**Files:**
- Modify `server/src/ccdargv.ts`: each `CCD_ARGV` row gains `can: { token: string | null; default: 'permit' | 'refuse' }` (a `null` token means the verb's own name in `ccd caps`), and `ccdCan(state, argv)` answers from the row the argv was built by (its verb, `argv[0]`, names the row; step 0 confirms no two rows share a verb): `ccdVerbs === null` gives the row's `default`; otherwise the token's presence. `verbSupported` and `capSupported` stay exported (the flag gates use `capSupported`), and `stopSurfaceSupported` becomes the `stop` row's `can`.
- Modify each call site that asks a **verb** question, one file per commit: it calls `ccdCan(state, argv)`. A site that asks both (`collectTempRoot.ts`'s `collect` and `reclaimPause`) asks `ccdCan` for the verb and keeps `capSupported` for the flag token. Order: `close.ts`, `childSpent.ts`, `fingerprint.ts`, `coord/dispatch.ts`, `coord/routes.ts`, `docs/ccdsource.ts`, `server.ts`, `watch.ts`, then the destructive executors (`coord/expireArchived.ts`, `coord/childReclaim.ts`, `coord/collectTempRoot.ts`) last.
- Modify `server/test/verb-gate.test.ts` in the characterization commit: `ccdCan(` counts as a gate, and a new row asserts that every `CAP_GATED_VERBS` verb's `CCD_ARGV` row has `default: 'refuse'`.
- Modify `server/test/consolidationCensus.ts` (tail): `capabilityChoiceSites()`, the `verbSupported(` and `capSupported(` calls outside `ccdargv.ts`, each tagged `verb` or `flag` by its token.
- Modify `server/test/single-definition.test.ts`'s ARCH-40 tail block, last commit: no `verb`-tagged site remains; `flag` sites are reported.

- [ ] **Step 0: Re-ground** all 63 sites by symbol, tag each `verb` or `flag`, and write each verb row's `default` from the polarity its call sites use today. A verb gated with `verbSupported` at one site and `capSupported` at another is **stopped and reported** with both sites, never resolved by the worker (it is a polarity disagreement the operator rules on). Rule 6 check per file.
- [ ] **Step 1: Characterization commit.** Per verb row, through its call sites' existing seams (`inject` for routes, the lane harness for sweeps): the answer over `ccdVerbs` `null`, `[]`, the list with the token, and the list without it. Plus the `verb-gate.test.ts` extension. Green on `main`.
- [ ] **Step 2: Red.** `ccdCan` rows: `null` state gives the row's default; a `refuse` row with the token absent is false; a `permit` row with the list present and the verb absent is false; a flag token is not a row. Red (no function).
- [ ] **Step 3: Move commits**, one file per commit, the executors last.
- [ ] **Step 4: Ratchet commit.**
- [ ] **Step 5: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `ws-expire`'s row `default: 'permit'` | expire-archived (Step 1's null row), verb-gate | "a box with no caps list never expires" |
  | `ccdCan` ignores the row's token and reads the verb name | Step 1's `stop-surface` row | "stop needs the stop-surface token" |
  | `docs/ccdsource.ts`'s `readDocs` loses its gate | verb-gate | "every CCD_ARGV.docs call is gated" |
  | a new `verbSupported(state, CCD_ARGV.wsHold(…))` call | single-definition | "no verb question outside ccdCan" |
  | `collectTempRoot.ts` drops the `reclaim-pause` flag check | Step 1's collect row | "collect needs both tokens" |

- [ ] **Step 6: Verify** `verb-gate.test.ts`, `capsupported.test.ts`, `whitelist-subset.test.ts`, `ccdargv-brand.test.ts`, `consolidation-census.test.ts`, `single-definition.test.ts`, then each moved file's suites, one at a time; `tsc --noEmit`.

**Exit (GATES):** verb-shaped `verbSupported`/`capSupported` choices at call sites → 0, every one through `ccdCan(row)`; each verb's no-evidence answer unchanged (Step 1). **OBSERVATION:** the `flag` sites' count. **Rollback:** `git revert` per commit; the old functions stay exported throughout.

### Task C1l: `shared/redact.mjs` — one rule table, explicit profiles; the TS callers move (D-5867; ARCH-66 (#801); spec K7's TS half, §2.3's redaction row) — GATED: PR 1 after the wave gate (W1a) and the ARCH-06 W1b slice; PR 2 after the history programme's W2 and its coordinator's ack

**Routing:** **band 3, native** (spec K7, §5.1 rule 7): the egress profile is the command redactor for untrusted child input (D-5299, D-5360). Two reviewers. **Lane:** server. **Needs:** PR 1: the wave gate and the ARCH-06 slice for `single-definition`'s redactor blocks; PR 2: #856 and #826 merged and the history programme coordinator's ack in writing, cited in the PR body.

**Measured on `bece77281`.** Three JS/TS rule tables: `coord/redact.ts` (egress, `[REDACTED]`, `redactCommand`, `redactedStored`, `redactedPreview`; imported by `watch.ts`, `askbody.ts`, `fleet.ts`, `coord/approvalguard.ts`, `coord/routes.ts`, `coord/digest.ts` and `coord/store.ts`), `shared/docs.ts` (`DOCS_REDACT_RULES` and `redactDocsText`, `***`; called by `docs/ccdsource.ts`, and held equal to ccd's python `REDACT_RULES` by `docs-parity.test.ts`), and `ccd/history/lib.mjs` (`REDACTED_MARK` `[redacted]`, `redactField`, `redactForIndex`). `redact.test.ts`'s corpus has 196 rows and an idempotence row. `single-definition.test.ts` pins `redactCommand`'s one home ("the approval classifier, its class map and the redactor each have one home (D-5299)") and the docs redactor's ("docs failure vocabulary, redactor and ccd wire types are declared once, in shared/docs.ts (docs W1)"). The URL-userinfo rule differs: egress masks to the last `@` before the host, docs stops at the first. The session masker (`secret-mask.test.ts`, D-5513, D-5995) masks known keys by their exact bytes; it is not a rule table and is out of scope.

**Files (PR 1):**
- Create `shared/redact.mjs`, `shared/redact.d.mts` and `shared/redact.ts` (the `models.mjs` pattern: one implementation, a typed re-export). One rule table, each rule an id, a pattern and a replacement; profiles `egress` and `docs`, **each listing its rule ids explicitly** (no profile inherits); `redact(profile, text)`. The `history-index` and `log-line` profiles are not added in PR 1. `node shared/redact.mjs --profile <name>` reads stdin (for W5's ccd half; no caller in W1b).
- Modify `server/src/coord/redact.ts`: its rule regexes move into the table as the `egress` profile; `redactCommand`, `redactedStored`, `redactedPreview`, `capUtf8` and the constants stay its exports and call `redact('egress', …)`. Callers unchanged.
- Modify `shared/docs.ts`: `DOCS_REDACT_RULES` stays exported with its exact shape (the python parity reads it), derived from the `docs` profile's rows; `redactDocsText` re-exports `redact('docs', …)`.
- Modify `server/test/single-definition.test.ts`: the two redactor blocks re-pointed so the rule patterns' one home is `shared/redact.mjs`, each in its own commit, their other halves byte-identical (the W1a plan's named exception for rewritten text).
- Modify `server/test/consolidationCensus.ts` (tail): `redactRuleTables()`.
- Create `server/test/redact-profiles.test.ts`.

**Files (PR 2):** `shared/redact.mjs` gains the `history-index` profile; `ccd/history/lib.mjs`'s rule regexes come from it. Its pair index, belt, `redactField`'s call order and the W2-D54 order are not touched (spec K7). The ratchet: `redactRuleTables().length === 1`.

- [ ] **Step 0: Re-ground** every rule in both tables, their order and flags; list the callers; confirm the 196-row corpus and the docs parity rows are green. Rule 6 check.
- [ ] **Step 1: Characterization commit.** `redact.test.ts`'s corpus re-run unchanged; add a byte row per caller-facing function (`redactedStored`, `redactedPreview` over the same corpus); add a docs corpus (one row per `DOCS_REDACT_RULES` rule, plus prose that must survive: a URL with no userinfo, an email address, `PATH=`, a word ending in `-key`), byte for byte; add one cross-profile row per shape both profiles touch, recording each profile's output separately. Green on `main`.
- [ ] **Step 2: Red.** `redact-profiles.test.ts`: every profile lists its rule ids; no rule id is unlisted; `egress` and `docs` share no rule whose output differs between them (the URL-userinfo rule is two ids); `redact` is idempotent per profile; the CLI form over stdin equals the function. Red (no module).
- [ ] **Step 3: Green**, then the move commits: `coord/redact.ts`, then `shared/docs.ts`, each followed by its `single-definition` block's re-point.
- [ ] **Step 4: Ratchet commit** (PR 1: `redactRuleTables().length <= 2`; PR 2: `=== 1`).
- [ ] **Step 5: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the docs URL-userinfo rule listed in `egress` | redact (corpus), redact-profiles | the corpus row for a password holding an `@` |
  | the egress `SECRET_FLAG` rule listed in `docs` | Step 1's docs prose row | "`--api-key` in docs prose is kept" |
  | a rule reordered inside `egress` | redact (corpus) | the round-9 overlap row |
  | `DOCS_REDACT_RULES` re-derived in a different order | docs-parity | "REDACT_RULES equals DOCS_REDACT_RULES, row by row and in order" |
  | a second regex table in `coord/redact.ts` | single-definition | the redactor's one home |

- [ ] **Step 6: Verify** `redact.test.ts`, `redact-profiles.test.ts`, `docs-parity.test.ts`, `secret-mask.test.ts` (unchanged), `single-definition.test.ts`, `consolidation-census.test.ts`, one at a time; `tsc --noEmit` in `server/`.

**Exit (GATES):** TS rule tables 3 → 2 (PR 1) → 1 (PR 2); the egress corpus unchanged byte for byte; the docs parity rows unchanged. **Not in this task:** ccd's python `REDACT_RULES` and the bash `log-line` function (ARCH-67, W5); redaction at ingest; the session masker. **Rollback:** `git revert`; PR 2 reverts alone.

## Operator acts in this wave

- **OA-C4 (before C1h's behaviour commit 2): the throttle clock for the other 20 lanes.** Spec K11 and O4 (a) put the throttle on the monotonic clock, and §5.1 rule 1b names only expiry and dead-coordinator as the behaviour commit. The ask shows Step 1's wall-step rows for each of the 20 lanes (what each does today when the wall clock steps back or forward by an hour, and what it would do on the monotonic clock) and offers (a) all 20 to `'mono'`, (b) a named subset, (c) none (the `clock` column records each). Nothing on a box is touched; C1h lands with (c) until the operator rules.
- **OA-C5 (a notice, gates nothing): the spec's counts this plan re-measured.** `lastIdleNudgeAt` joins the named clock list (24 in W1b, 26 overall); `watch.ts` declares 54 `last*` fields, not 56; a steady tick takes 8 listings by static reading, not 7; `registry.ts`'s `warnOnce` is a cooldown with escalation and stays (D-5861). The operator may ask for any of these to be done differently.
- **Arming nothing.** W1b changes no lane's arming and no switch's meaning.
- **The wave's deploys** follow the standing rule: from a fresh `origin/main` worktree as a detached unit, verified from its log. Server lane only; no session restarts.

## Acceptance

Every PR body carries: the census lists at base and tip (this plan's queries and C0b's), the mutation table's red lines, the rule 6 disjointness check (each edited file, each open PR holding it, the hunks), the first commit's name as the characterization pin, and `git diff --name-only origin/main...HEAD -- pwa ccd agent deploy` printing nothing. C1h PR 3, C1i, C1j, C1k and C1l carry both reviewers' verdicts. C1h's behaviour commits list their before/after rows and cite spec §5.1 rule 1b (commit 1) or OA-C4 (commit 2). C1l PR 2 cites the history coordinator's ack.

## Rollback

Each task is a revert of its PR, newest first. No stored data changes and no wire frame changes, so any revert leaves the fleet as it was before that PR. The behaviour commits revert alone. The ratchet pins revert with the commits that landed them.

## Deviations and decisions

### Issued for this work and defined here

The allocator issued the consolidation wave a block of 30 numbers, 5848 to 5877. The W0 plan defines D-5848 to D-5854 and D-5865; the W1a plan defines D-5855 to D-5860; this plan defines D-5861 to D-5864, D-5866 and D-5867.

- **D-5861** — `change-latch-kernel` (Task C1g; ARCH-76): one pure `changeLatch` ("warn once until it changes", with a clear arm, and a keyed form per group) replaces the hand-rolled latches in `FleetWatcher` (6 → 0, by `changeLatchSites()`), each sentence and re-arm unchanged.
  - **Departs from ARCH-76:** `registry.ts`'s `warnOnce` is no longer a function. Its mechanism, `warnState`, is a per `id#field` cooldown with an escalation clock and a prune per listing, a rate limit with a stuck verdict, not a change latch, so it stays. The never-re-arming `*Warned` flags stay too.
- **D-5862** — `lane-schedule-and-runlane` (Task C1h; ARCH-68): one L0 `LANE_SCHEDULE` (cadence, clock, flight, warn) and one L4 `runLane` own every `FleetWatcher` lane's throttle, single-flight, catch and warn; `stamp` and `kick` keep the on-demand runs and the forced next pass; safety intervals are not rows, and each derivation is a declared reference. The throttle of expiry and dead-coordinator moves to the monotonic clock in a behaviour commit; the other wall-clock throttles move only as OA-C4 rules; verdicts keep wall-clock.
  - **Departs from the spec's §5.4 list:** `lastIdleNudgeAt` is a cadence clock the list missed, so W1b's named clocks are 24 (26 with W4's two). `DelegationLane#lastSweepAt` becomes a row only after #832 no longer holds `DelegationLane`.
- **D-5863** — `mail-ingress-one-read` (Task C1i; ARCH-09): `attributionVerdict`, `POST /api/mail` and `POST /api/mail/:id/ack` take one `readRegistryMeasured` each, and their census rows move from `raw-name` to `refuses`; a listed registry with an unreadable target row still answers `registry-unmeasurable`.
- **D-5864** — `one-listing-per-tick` (Task C1j; ARCH-51): the tick builds one pure `FleetReadModel` from its one registry read and its caches, and every lane's selection reads it (8 → 1 selection listings per steady tick, by an instrumented fake `FleetIO`). Act-time reads stay fresh and are listed by name: each executor's late read, the mail lane's fail-shut switch read if it guards delivery, the snapshot's shrink re-confirmation and the reap-race re-list.
  - **Departs from ARCH-51 as written:** `assembleFleet`'s five request-time callers and its signature are not changed here (W2, with ARCH-52), because moving `GET /api/fleet` onto the tick's model changes how fresh its answer is.
- **D-5866** — `ccd-can-row` (Task C1k; ARCH-71): each `CCD_ARGV` row carries its capability token and its no-evidence default, and `ccdCan(state, argv)` is the one verb question; every verb-shaped `verbSupported`/`capSupported` choice moves to it with today's polarity, and a verb gated both ways stops the task.
  - **Departs from ARCH-71's "choices → one `ccdCan`":** a token that says an existing verb parses a flag (`ACTOR_FLAGS_CAP`, `POOLS_CAP`, `ROUTE_ARGV_CAP`, `CHILD_ARGV_CAP`, `SWAP_BUSY_CAP`, `RECLAIM_PAUSE_CAP`, the accounts gate's token) is not a `CCD_ARGV` row, so those sites keep `capSupported` and are reported, not ratcheted.
- **D-5867** — `redact-kernel-profiles` (Task C1l; ARCH-66): `shared/redact.mjs` holds one rule table and named profiles, each listing its rule ids explicitly; the egress and docs tables move into it with their output unchanged byte for byte (the 196-row corpus and the docs parity rows), and a shape the two profiles mask differently keeps two rules. The history-index profile follows history W2 and its coordinator's ack.

Issued and unused: 5868, 5869, 5870, 5871, 5872, 5873, 5874, 5875, 5876, 5877. They are held for the wave's later plans (W2 onward) and are never defined outside this programme's plans.

## Out of scope

`GET /api/fleet`, `/ws/fleet` and `SessionStream` reading the model (ARCH-52, W2); the launchd plists and the doctor's cadences (ARCH-69, W8); ccd's python and bash redactors (ARCH-67, W5); `stopDoneSweep.ts`, `hibernateSweep.ts` and their clocks and guards (W4); any `pwa/` file (W7); any `ccd` byte (W5); redaction at ingest; the session masker (D-5513, D-5995).

## Review log

**rev 0 (2026-10-20).** Written from the spec's rev 2.2 and measured on `origin/main` `bece77281`. Not yet reviewed. Every count above is re-measured on that tree; where it differs from the spec, OA-C5 lists the difference and the task's D-number records the decision.
