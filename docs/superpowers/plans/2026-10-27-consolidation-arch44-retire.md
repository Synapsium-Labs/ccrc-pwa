# Consolidation wave, ARCH-44: one gate decider and one executor for when a workspace is retired (`decideRetire`, `retireAct`, `retireExecutor`) — Implementation Plan

> **For agentic workers:** one PR per task, in the order of §Landing order, each dispatched only when its row in §Gates is all green. To execute a task, REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Steps use checkbox (`- [ ]`) syntax. Workers do not edit §Deviations found. A departure is named by slug in the task's report; the coordinator enters it, never the worker.

**Spec:** `docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md` (rev 2, approved by the operator 2026-10-19). K1 (retire half), K2 (what ccd keeps), K6 (the funnel), K12 (switches), §2.2 C4 ("Policies, not lanes", "Bindings, read once"), §3.19, §5.1, §5.7 (W4) and §7 bind every task. Read them before Step 0. The 08-10 spec's `ring-context-map` table (`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`) binds every new file. The ARCH-43 plan (`docs/superpowers/plans/2026-10-26-consolidation-arch43-arch72-accounts.md`) is the pattern this plan follows, and its rules on census files, literal source pins and the shared `watch.ts` queue apply here unchanged.

**Status:** rev 0 (2026-10-27). Written as a new plan file because the ledger guard (D-6926) refuses an edit to an existing file under `docs/superpowers/plans/` from a feature branch. Two operator acts are open (OA-C14, OA-C15, §Operator acts); no task before C4o waits on either. Two rulings bind it besides the spec's:

- **Operator ruling, 2026-10-26: the architecture refactor goes first** (as in the ARCH-43 plan). Feature PRs already in review may land first; a series PR open when one lands rebases.
- **Operator ruling, this task's brief: the destructive verbs stay behaviour-identical.** `ws-reclaim`, `ws-expire`, `ws-collect` (and its loose arm) and `ws-reap` keep every argv byte, every audit argv byte, every envelope and every refusal. No task edits `ccd/`. W5's retire-verdict table (`server/test/ccd-retire-verdicts.test.ts`, D-7082, landed by C5d as #1677) is re-run, unedited, as the ccd half of every characterization run below.

**Scope.** ARCH-44 (GitHub #779; spec §4.2: "`decideRetire` + `retireExecutor` with the act-time re-measure; reasons migrate one PR each: `temp-orphan`, then `archive-expired`, then `child-spent`"). The three reasons are the three server-side automatic retire executors that exist today. `ws-reap` (`retire(merged)`), `ws-rm`, `ws-gc --prune` and `forget` are operator-driven routes with no server lane and no executor of this shape; they are not reasons here (§Out of scope). The dead-coordinator lane acts on runs and goes to C5's decider set (spec K1 Verdict); it is not touched.

**Base:** `origin/main` `c332aca73`. Every count in this plan was measured on it, with the query named beside it; Step 0 of each task measures again on the tree it starts from, and a count that differs is reported before any commit. Code is cited by file and symbol (`server/src/coord/childReclaim.ts#childReclaimOutcome`), never by line. The open-PR (rule 6) tables were measured the same day with `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,files`.

**Deploy class.** **Server lane only.** No task edits `ccd/`, `agent/`, `deploy/`, `shared/` (the switchboard included), the session hook or any `pwa/` file. No wire field changes; `FLEET_PROTO` is not bumped. No marker, switch, cadence or LANE_SCHEDULE row changes name, meaning or reader.

**Names.** Tasks are **C4h** to **C4o**, after ARCH-43's C4a to C4g (W4's sleep half). The operator acts are **OA-C14** and **OA-C15**: the ids were taken after measuring every operator-act id in `docs/superpowers/plans`, `docs/superpowers/specs` and the open PRs on 2026-10-27 (OA-C1 to OA-C13 are taken; OA-C10 to OA-C13 by the W5 ccd-helpers plan). The coordinator renames them on this PR if another plan claimed them first. This plan's D-numbers (D-7165 to D-7178) were issued by the allocator on 2026-10-27 and are defined once in §Deviations found. A departure found later is named by slug in a task's report and gets its number from the coordinator, never by guess.

## What the measurement found (on `c332aca73`)

These facts decide the plan's shape; each is re-measured at Step 0 of C4h.

1. **Three retire executors, three hand-written gate ladders.** Each executor runs, in its own order, the same kinds of step before and around its destructive verb: an id or record re-read, the capability (`ccdCan`), the switches from a registry listing, the store's binding read, presence (`viewers.isVisible`), the audit (`ws-audit --<reason>`) that mints the token, the switches again nearest the argv, then the verb. The ladders are `server/src/coord/collectTempRoot.ts#collectTempRoot` (temp-orphan, steps 1 to 6 of its header), `server/src/coord/expireArchived.ts#expireArchived` (archive-expired, steps 0 to 7) and `server/src/coord/childReclaim.ts#childReclaimOutcome` (child-spent, steps 1 to 7, behind `reclaimChild`). Query: top-level functions under `server/src` whose body calls `ccdCan(` with a retire act key (`wsReclaim`, `wsExpire`, `wsCollect`, `wsCollectLoose`) **and** calls `.isVisible(`: **3**, exactly those. (`server/src/coord/staleArchive.ts#act` also reads both, with the `wsArchive` key; it archives and is not a retire executor, so the key filter leaves it out, and the FIXTURE row proves it.)
2. **Their step orders differ, and the order is behaviour.** Measured:

   | Step | temp-orphan (`collectTempRoot`) | archive-expired (`expireArchived`) | child-spent (`childReclaimOutcome`) |
   |---|---|---|---|
   | first | capability (`wsCollect`, and `reclaim-pause-v1` by `capSupported`), then the id predicate | the id predicate (`isRegistryId`, `composition`), then capability (`wsExpire`) | the record re-read (the child marker must name the request's run; `gone`, `marker-unreadable`, `marker-mismatch`) |
   | store | after the audit: `collectOpenRunHold` on observation 2's document, and again in step 6 | before presence: `readExpiryStore` (worker and claimant open runs by `bindingsOf`, review, coordinated) | first after the record: `readChildSiblings` (`bindingsOf(id).worker()`), then "coordinating, any state" |
   | switches | one measured listing (`collectSwitches`): `reclaim-paused` raised or unlistable stops; `collect-lane-live` and `collect-loose-live` ride the same listing | one measured listing (`expirySwitches`): `reclaim-paused` raised or unlistable stops; `expire-lane-live`, `expire-child-live` ride it | two plain listings, one per marker: `reclaim-paused` (`childReclaimPauseRead`, a rejecting `readdir` propagates to the caller's try), then `child-reclaim-disabled` (`childReclaimDisabledDetail`) |
   | generation | none (two clear generations, captured per request, `collectFresh`) | none | `childReclaimGenerationRead` re-read against the request's key, then the audit's generation (5a) |
   | presence | no ceiling, at step 3 and again inside step 6 | no ceiling (spec §6 O6 (a), ruled 2026-10-19), at step 4 | with a ceiling: skipped when `req.deferExpired` |
   | capability again | inside step 6, synchronously | in the act's own scope (`expireAct`) | in the act's own scope (`childReclaimAct`), plus the stale arm's flags (`RECLAIM_STALE_CAP`, 4a) |
   | switches nearest the argv | **yes**: step 5 is one fresh listing, the job's LAST await; step 6 is synchronous to the argv (latch, caps, Settings row and journal, node, `collectLaneEffective`, licence stands, presence, hold) | **yes**: step 6 re-reads both switches; `expire-lane-live` decides shadow or live at the act | **only `child-reclaim-disabled`** (step 6). `reclaim-paused` is read once, at step 2b, before presence and the audit. ccd re-reads the file inside its lock (rung 3), so the box still refuses; the server-side difference is the word (`paused-at-server` deferral versus a ccd refusal). This is OA-C14 |
   | notice | none in the executor: the lane folds the report (`FleetWatcher#collectRecordFeed`, `#collectRecordCoordFeed`) | none in the executor: the lane writes `recordExpireFeed` after the queue answers | in the executor: `reclaimChild` calls `recordChildReclaimFeed` unless `gone` or `childReclaimFeedSkips` |
   | after the act | — | — | `childReclaimStaleTold` |
   | queue | `KeyedQueue` only, `void` (`FleetWatcher#collectAct`) | `KeyedQueue` only, awaited (`FleetWatcher#archivedExpiryPass`) | `KeyedQueue` only, awaited by the sweep (`FleetWatcher#execChildReclaim`, with its `childReclaimExec` test seam) and `void` from the close route (`coord/routes.ts#childReclaimPort`, wrapped in `childReclaimUnlessDisabled`) |

3. **No retire executor runs on the coordination serialiser today.** The spec's K1 says each executor "re-reads … inside the coord serialiser". Measured: none of the three references `CoordRoutesHandle.serial`; only the sleep executor does (`sleepLane.ts#sleepAct`). Adding it is a behaviour change (every retire act would hold every coordination route for an audit's duration). This plan keeps queue-only (D-7178) and asks OA-C15.
4. **The switch reads already go through the switchboard.** W1a's `readSwitches` is called by all four executor-side wrappers: `coord/childReclaim.ts#childReclaimPauseRead`, `coord/childReclaimDisabled.ts#childReclaimDisabledOf`, `coord/expireArchived.ts#expirySwitches`, `coord/collectTempRoot.ts#collectSwitches`. Private `reclaim-paused` parsers in the retire executors: **0** (spec §5.7's "1 → 0" was stop-done's, met by ARCH-43 C4c). What is duplicated is the wrapper: four functions that each take a listing and answer the reason's pause words. Query: functions in the retire executor files (`coord/childReclaim.ts`, `coord/childReclaimDisabled.ts`, `coord/expireArchived.ts`, `coord/collectTempRoot.ts`) whose body calls `readSwitches(`: **4**.
5. **The feed writes already go through the funnel.** `recordFeedEvent(` call lines outside the store: 1 (`server/src/notice.ts`). Every retire notice is a `notify(` call (`coord/childReclaim.ts` 4, `coord/expireArchived.ts#recordExpireFeed` 1, `coord/childReclaimDisabled.ts` 1, `FleetWatcher#collectRecordFeed` and `#collectRecordCoordFeed` 2). Spec §5.7's "feed writers in the executors: 0 (funnel only)" is **met**; this plan pins it and moves no notice.
6. **Bound-by readers go through `CoordStore.bindingsOf` (ARCH-42, #1623).** `server/test/census-w4/bindings.test.ts` pins `boundBySites()` at **1** (`server/src/coord/bindingReads.ts#bindingsOver`). The retire store reads ask it already: `readExpiryStore` calls `coord.bindingsOf(id)`; `readChildSiblings` reaches it through `coord/siblingRead.ts#siblingFacts` (`bindingsOf(sessionId).worker()`). `collectOpenRunHold` reads the witness run by `coord.run(n)`, which is evidence, not a binding read. **No task adds a binding read**; the ceiling stays 1.
7. **The schedule rows already exist.** `LANE_SCHEDULE` holds `childReclaim`, `collect` and `archivedExpiry`, each on the monotonic clock (W1b, ARCH-68). Spec K1's "three `retire` reasons on one schedule row each" is **met**. The passes (`FleetWatcher#childReclaimPass`, `#collectPass`, `#archivedExpiryPass`) differ in population, pacing, slot, memory and attention; they are each reason's evidence and stay (D-7176).
8. **ARCH-77 is on `main`.** `child-reclaim-disabled` has its reader (#1366, #1409), the executor reads it at decide (2b') and at the act (6), and the close route wraps the executor in `childReclaimUnlessDisabled`. Spec §5.7's "the `child-spent` PR's first commit is ARCH-77" is met; that commit becomes a re-run of the ARCH-77 rows (D-7175).
9. **The act sites are three, and stay three.** Functions composing a retire verb's argv (`CCD_ARGV.wsReclaim(`, `.wsExpire(`, `.wsCollect(`, `.wsCollectLoose(`): `coord/childReclaim.ts#childReclaimAct`, `coord/expireArchived.ts#expireAct`, `coord/collectTempRoot.ts#collectTempRoot` (both collect arms). Their audits: `#childReclaimAudit`, `#expireAudit`, `#collectAudit`. Each verb is a different ccd verb with its own token and flags, so unlike ARCH-43's one `ccd hibernate` there is nothing to merge; the composers stay in their files (D-7177), which also keeps `capabilityChoiceSites()`, `id-argv-census.test.ts` and `unattended-actor.test.ts` unedited.
10. **Each reason's lane verdict is evidence.** `childReclaimSweep.ts#childReclaimSweepVerdict` (24 `eligible: false` arms), `coord/childReclaim.ts#childReclaimDecision` (the close path's, wave 3), `archivedExpiry.ts#archivedExpiryVerdict` and its `archivedExpiryStoreSkip`, and the collector's `collectLane.ts#collectLicence`/`#collectOffers` over ccd's `COLLECT_VERDICT_TABLE` share no ladder: their words, order and facts differ throughout (a minting run and its birth fence; an archive epoch; witnesses and an observation pair). Spec K1 Verdict: "Legitimately different: each retire reason's evidence … These stay as per-reason policy rows and are not merged." So `decideRetire` is the **gate** the three executors share, and each reason's verdict is its row's evidence, named by the row and unchanged (D-7173).
11. **Literal source pins (exact ceilings, `single-definition/advance-switches.test.ts`).** W1a's map: `coord/childReclaim.ts` 6, `coord/expireArchived.ts` 0, `coord/collectTempRoot.ts` 0, `watch.ts` 79, `coord/routes.ts` 38; the every-other-file map: `childReclaimSweep.ts` 7, `collectLane.ts` 7, `coord/close.ts` 2. `server/src/retire.ts` and `server/src/retireLane.ts` have no row and gain none.

**Goal, PR by PR.**

| After | The operator sees | Underneath |
|---|---|---|
| `main` | three retire lanes, each under its own switches | three executor gate ladders in three orders; four switch wrappers; `reclaim-paused` read once by child-spent, twice by the other two |
| C4h | nothing | `server/test/retire-executors-pin.test.ts`: the three executors over one step matrix, every difference as a named row, green on the old code; `server/test/census-w4/retire.ts` |
| C4i | nothing | `server/src/retire.ts`: `decideRetire(facts, reason)` and the shared step judges; the three reason rows beside the old ladders; the decider suite equals the old executors row for row |
| C4j | nothing | `server/src/retireLane.ts`: `retireAct(deps, reason, req)`, the one executor loop (read the step the decider asks for, sync steps never awaited, the act, the after-hook), driven by fixture rows only |
| C4k | nothing | `collectTempRoot`'s body is `retireAct(…, TEMP_ORPHAN_RETIRE, job)`; gate ladders 3 → 2 |
| C4l | nothing | `expireArchived`'s body is `retireAct(…, ARCHIVE_EXPIRED_RETIRE, req)`; 2 → 1 |
| C4m | nothing | `childReclaimOutcome`'s body is `retireAct(…, CHILD_SPENT_RETIRE, req)`; 1 → 0 outside `retireLane.ts`; switch wrappers 4 → 1 |
| C4n | nothing | `retireExecutor(reason, deps, req)` owns the `KeyedQueue` call; the four call sites go through it (queue sites composing a retire executor 4 → 1) |
| C4o (if OA-C14 (a)) | a pause raised during a child's audit is obeyed by the server at the act | child-spent's row re-reads `reclaim-paused` nearest the argv, in the listing it already takes for `child-reclaim-disabled` |

---

## Gates: what each task waits for, stated honestly

Measured on 2026-10-27 at `c332aca73`. The open PRs holding this plan's files are **#1514** (`server/src/childReclaimSweep.ts`, `server/src/coord/childReclaim.ts`), **#1614** and **#1217** (`server/src/watch.ts`, `server/src/server.ts`). No open PR holds `server/src/coord/expireArchived.ts`, `server/src/coord/collectTempRoot.ts`, `server/src/collectLane.ts`, `server/src/archivedExpiry.ts`, `server/src/coord/routes.ts`, `server/src/coord/childReclaimDisabled.ts`, `server/test/census-w4/*` or `server/test/reclaim-pause-pin.test.ts`.

- **W4's prerequisites (spec §5.7) are on `main`.** W1a (switchboard, funnel), W1b (`LANE_SCHEDULE`, `LaneRunner`, `ccdCan`), W2 (`readSession`, `viewer`, presence on the wire). Within W4: ARCH-36 (#1242), ARCH-35 (#1297), ARCH-41 (#1563), ARCH-42 (#1623), ARCH-77 (#1366, #1409), and ARCH-43's C4a to C4f (#1596, #1633, #1632, #1662, #1670, #1682).
- **ARCH-43's C4g has not landed** (no PR open at the base). It edits `watch.ts`; so does C4n. C4n queues after it (§The shared `watch.ts` queue). C4h to C4m and C4o edit no `watch.ts` line and do not wait for it.
- **W5's retire-verdict table is on `main`** (#1677). Every task re-runs it unedited.
- **OA-C14** gates C4o only. **OA-C15** gates nothing in this plan: its recommended option keeps today's behaviour, and its other options are follow-up work.

| Task | Prerequisites on main | Rule 6 (open PRs holding the same files) | OA | Other |
|---|---|---|---|---|
| C4h pin + census | met | none (tests only) | — | — |
| C4i `decideRetire` | met | **#1514 holds `coord/childReclaim.ts`** (C4i adds the child row's gate table at the file's tail): line-disjoint, re-checked at Step 0 | — | C4h |
| C4j `retireAct` | met | none (two new files and tests) | — | C4i |
| C4k temp-orphan | met | none | — | C4j |
| C4l archive-expired | met | none | — | C4j (parallel with C4k; the second to land rebases `census-w4/retire.test.ts`) |
| C4m child-spent | met | **#1514 holds `coord/childReclaim.ts` and `childReclaimSweep.ts`**: wait for #1514 to land or close, or prove line-disjointness at Step 0 and rebase whichever lands second | — | C4k and C4l (the switch-wrapper ratchet reaches 1 only here) |
| C4n one queue owner | met | **#1614, #1217 hold `watch.ts`** | — | C4m; ARCH-43 C4g landed; its turn in the shared `watch.ts` queue |
| C4o child-spent act-time pause | met | re-check `coord/childReclaim.ts` at Step 0 | **OA-C14 (a)** | C4m |

## In flight, and what it fences off

| In flight | What it changes that this plan also touches | Tasks it gates |
|---|---|---|
| #1514 (child reclaim retries an unreadable tree with backoff) | `childReclaimSweep.ts` (tier and backoff), `coord/childReclaim.ts` (the failed tail and its words) | C4i (the child row at the tail of `coord/childReclaim.ts`), C4m (`childReclaimOutcome`'s body): line-disjointness at Step 0, or wait and rebase. If #1514 lands first, C4h's child rows are re-measured on its tree before C4m starts |
| #1614 (delegation frame, held), #1217 (registry read cost) | `watch.ts`, `server.ts` | C4n: line-disjointness at Step 0. Feature PRs may land first (operator ruling 2026-10-26); C4n rebases |
| ARCH-43 C4g (planned, not open) | `watch.ts#sweepSleep` and the sleep act | C4n queues after it |
| The W3 plan (#1589) and the W8 plan (#1588) | their own `watch.ts` series; their own census modules | C4n takes its turn in the shared queue; no census file is shared (§The census files) |

**The wave rebases; the programme PR never does** (spec §5.1 rule 6).

## Landing order

```
main (c332aca73)
  └── C4h (pin + census) ── C4i (decideRetire) ── C4j (retireAct) ──┬── C4k (temp-orphan; ladders 3 → 2) ──┐
                                                                    └── C4l (archive-expired; 2 → 1) ──────┴── C4m (child-spent; 1 → 0, wrappers 4 → 1) ──┬── C4n (retireExecutor; queue sites 4 → 1; shared watch.ts queue)
                                                                                                                                                         └── C4o (OA-C14 (a): child-spent re-reads reclaim-paused at the act)
```

The reasons migrate in the spec's order where it matters: temp-orphan's row is the hardest (its synchronous step 6), so if `retireAct` cannot carry it without an await before the argv, C4k fails first and C4l and C4m do not start on a wrong skeleton. C4k and C4l touch disjoint files and may be open together; C4m starts only after both, so its ratchet commits read the final counts. C4n and C4o are independent of each other.

### The shared `watch.ts` queue

Only C4n edits `watch.ts`. It joins the shared queue the ARCH-43 plan defines (§The shared `watch.ts` queue there) after ARCH-43's C4g and after any W3 `watch.ts` PR already queued at that moment; the coordinator may reorder and says so on both plan PRs. At most one `watch.ts` PR from any series sits in the merge queue at a time; the later rebases onto the earlier and re-runs its census rows before it is queued.

### The census files (who lands first)

This plan keeps its queries in its own module, as ARCH-43 (`census-w4/sleep.ts`) and ARCH-42 (`census-w4/bindings.ts`) do (D-7174):

- **`server/test/census-w4/retire.ts`**, with its FIXTURE and REAL rows in `server/test/census-w4/retire.test.ts`: `retireGateLadders()`, `retireSwitchWrappers()`, `retireActSites()`, `retireQueueSites()` and `retireNoticeSites()` (definitions in C4h). The module imports the census helpers `consolidationCensus.ts` exports (`CensusSite`, `REPO`, `sourceFiles`) and the parsed-symbol scanner (`scan/symbols.ts`, `scan/parse.ts`); it never copies one and is never re-exported from `consolidationCensus.ts`. Only this plan's tasks edit these two files.
- **No task edits `server/test/consolidationCensus.ts` or `server/test/consolidation-census.test.ts`.** The ratchets go in `server/test/single-definition/late-census.test.ts` (the area file ARCH-43 used), importing from `census-w4/retire.js`.

## Global constraints

- **Public repository.** No tracker ids, hostnames, account, lane or login names, session or project names, private product names or absolute home paths in code, fixtures, commits, branch names or PR text (CLAUDE.md). Fixtures use `lane-a`, `lane-b`, `project-a`, and the fixture ids the existing suites use. Cite D-numbers, ARCH-NN or GitHub `#n`.
- **SAFETY.** Fixture HOMEs and fake ports only; never run `ccd`, `ccrc` or a retire verb against a live `$HOME` or registry. No task touches tmux, `~/.cc-sessions`, `~/.cc-limits` or a `claude-session@*` unit on any box. The ccd-side table (`ccd-retire-verdicts.test.ts`) runs ccd in `makeCcdHarness` fixture homes only, as it does today.
- **Commands.** Prefix every git command with `env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR -u GIT_OBJECT_DIRECTORY`, and every test command too. Work in a fresh worktree from `origin/main` under `~/projects/wt.noindex/`. From `server/`: `./node_modules/.bin/vitest run test/<file> --maxWorkers=2`, one file at a time, in the foreground; `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit`. Never bare `npx vitest`.
- **Characterization first** (spec §5.1 rule 1). C4h lands the pin as a PR of its own. Each later PR's first commit re-runs it, `reclaim-pause-pin.test.ts` and `ccd-retire-verdicts.test.ts` on its base, plus the rows its Step 1 names, green on the old code. **Move commits** change those suites only in their imports. **The named exception:** a literal source pin over text a task rewrites cannot survive by import; each task lists those pins in its Files and re-points each in its own commit, keeping every other assertion of that block byte-identical. A pin that is not listed and goes red stops the task. **A blind guard is a red guard:** a scanner that stays green only because the shape it looks for moved out of its file is listed and re-pointed the same way.
- **Red-first for every behaviour change** (spec §5.1 rule 1b). This plan has exactly one behaviour commit: C4o's (OA-C14 (a)). It is its own commit, never squashed with a move, with its before and after rows in the PR body and the ruling cited. Any other output change found mid-task (a word, an order, an extra read, an extra listing, an await, a notice) stops the task and is reported.
- **Never weaken a test.** No assertion is loosened, deleted or skipped. A ceiling or ratchet only goes down, in the commit that reaches its count.
- **Counted exits, measured.** Each PR body prints the census at its base and at its tip, by name and site. The may-only-shrink pin lands in the commit that reaches the count (spec §5.1 rule 3).
- **No new literal source pins.** Every new or re-pointed source assertion over `server/src/retire.ts`, `server/src/retireLane.ts` or a reason row reads the source through `scan/symbols.ts` (`sourceOfSymbol`, `callsIn`) or a `scan/parse.ts` census, never `readFileSync` plus `match`/`toMatch`/`toContain`/`indexOf`. No task adds a `CEILING` row; a row is lowered exactly, in the commit that removes the pins it counts. Each task runs `single-definition/advance-switches.test.ts` in its Verify list.
- **No new kebab literal under `server/src/coord`.** `mail-routes.test.ts` declares every quoted kebab token in `server/src/coord` that looks like a code. The step names, reason names and step-answer words are exported `as const` constants of `server/src/retire.ts` (outside `coord/`), and the rows in `coord/` reference them by name, as `IDLE_HOURS_POLICY` does (ARCH-43 C4b). Each reason's hold and outcome words stay its own (`CHILD_RECLAIM_DEFER_WHY`, `ArchivedExpiryDeferWhy`, `CollectAnsweredWhy`), declared where they are.
- **Single-definition and growth.** Guards go in the area file of `server/test/single-definition/`, never a new top-level file. `growth-check.test.ts` must stay green; the moves shrink `coord/childReclaim.ts`, `coord/expireArchived.ts`, `coord/collectTempRoot.ts` and (C4n) `watch.ts`. A task that grows a file by more than 40 net code lines stops and asks the coordinator for an issued waiver number (never `D-TBD`).
- **Rings and totality.** `server/src/retire.ts` is **L1** (imports L0, `shared/switches.ts`'s types and `server/src/ccdargv.ts`'s types only) and `server/src/retireLane.ts` is **L4** (as `sleepLane.ts`); both get file rows in the C4 row of the 08-10 spec's `ring-context-map` table in the PR that creates them (`rings/totality.test.ts`). Step 0 reads `server/test/rings/ring.ts#serverRing` for every file a task edits; a row module (`coord/collectTempRoot.ts`, `coord/expireArchived.ts`, `coord/childReclaim.ts`) imports `retire.ts` (L1) and `retireLane.ts` (L4) only where its ring allows; no new `outward-edges.data.ts` exemption.
- **No `pwa/` file** (spec §5.1 rule 8; `consolidation-path-guard.test.ts`). **No new ccd verb, no new wire field, no new switch, no new cadence.**
- **Branch and commits.** One branch per task (names in each task). Commit identity: the no-reply identity the coordinator's brief names (never written into the tree); every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Before pushing: `git fetch origin main`, `git diff --stat origin/main...HEAD`, and `(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts --maxWorkers=2)`. Land through the merge queue (`gh pr merge --match-head-commit`), by the coordinator; no worker merges or arms auto-merge.

## Review focus (the failure modes most likely to bite)

1. **A step that moved.** Each reason's gate order is behaviour (§What the measurement found, item 2): which deferral wins when two stand, and which reads are made at all (an early deferral skips the audit; child-spent's record read comes before its store read; expiry's id predicate before its capability; the collector's capability before its id predicate). `decideRetire` asks for facts in the row's order and never reads a fact the old ladder did not reach. A row that now answers a later step's word, or makes a read the old ladder skipped, is a regression even when both words defer.
2. **An await before the argv.** temp-orphan's step 6 is synchronous from the last listing to `runCcd(CCD_ARGV.wsCollect(…))`: no microtask may run between them. `retireAct` calls a step declared `sync` without `await` (an `await` on a plain value still yields a tick). The collector's "no await between the last await and the argv" rows (C4h) must stay green through C4k.
3. **A merged listing or a split one.** Expiry and the collector read all their markers from ONE measured listing (`readdirMeasured`), so a pause and the live marker are one fact; child-spent reads TWO plain listings (`readdir`, a rejection propagating to the step's own sentence). Merging the child's two, or splitting the others' one, changes which sentences an unlistable registry produces and how many registry reads a pass costs.
4. **A ceiling that appeared or vanished.** Presence defers child-spent only until its ceiling (`req.deferExpired`); it defers the other two with no ceiling (O6 (a)). One presence judge with one rule moves one of them.
5. **A notice that moved.** child-spent's executor writes its feed row; the other two report, and their lanes write. A notice written by `retireAct` for a reason whose lane writes it would double the row; one dropped for child-spent would lose it. `notify` order and dedupe keys are pinned.
6. **An argv byte.** The six composers (three audits, three verbs, with the loose arm's two) stay in their files, under their `sweepDec` actors, with their flags (`--child-of`, `--defer-expired`, the stale flags, `--expect`). The ccd retire-verdict table and the inject suites prove the ccd side is untouched; the pin's argv rows prove the server sends the same bytes.
7. **A re-read at the act that went missing.** Expiry's and the collector's switches nearest the argv; child-spent's `child-reclaim-disabled` at step 6, its generation re-read (2c) and the audit's generation (5a); the capability asked again in each act's scope; the collector's licence, presence and hold re-read in step 6. Each is a row of C4h's "held at the act" table.
8. **A queue that changed.** C4n moves the `KeyedQueue` call into `retireExecutor`. Each caller keeps whether it awaits (`execChildReclaim` and `archivedExpiryPass` await; `collectAct` and the close route do not), its `.catch` sentence, the `childReclaimExec` seam, and the close route's `childReclaimUnlessDisabled` wrap; the literal handed to the job is still built inside the queue callback (the members are `deps`'s answer when the job runs, never a snapshot).
9. **A name compare in the decider.** `decideRetire` and `retireAct` never compare `reason.name`; every difference is a row field. A scan row pins it.

## Tasks

### Task C4h: the retire executors' characterization pin and census (`D-7165`; ARCH-44, first PR; spec K1, §5.1 rule 1) — GATED: none

**Routing:** band 2 (tests only; the orchestrator reviews the difference table against the code). **Lane:** server, tests only. **Branch:** `test/arch-44-retire-executors-pin`.

**Files:**
- Create `server/test/retire-executors-pin.test.ts`. It imports today's public faces only: `reclaimChild`, `childReclaimPauseRead`, `CHILD_RECLAIM_DEFER_WHYS` (`coord/childReclaim.ts`); `childReclaimDisabledRead`, `childReclaimUnlessDisabled` (`coord/childReclaimDisabled.ts`); `expireArchived`, `expireLaneLive` (`coord/expireArchived.ts`); `collectTempRoot`, `learnCollect`, `collectSwitches` (`coord/collectTempRoot.ts`), so every later move changes only its imports. It drives each executor through fake ports (a scripted `runCcd` that records every argv, a `readdir`/`readdirMeasured` scripted per call, a fake `viewers`, a `fleetState` built from `CCD_CAN` rows, a real `CoordStore` on `openCoordDb` in a temp dir), reusing `collectTempRootFixture.ts` and the child and expiry fakes the existing suites build (`child-reclaim.test.ts`, `expire-archived.test.ts`, `collect-temp-root.test.ts`); a helper it needs from them is moved into a fixture module, never copied.
- Create `server/test/census-w4/retire.ts` and `server/test/census-w4/retire.test.ts` (§The census files) with five queries, each by parsed symbol (`scan/parse.ts`), one site per function, and its FIXTURE row (the shapes it counts and the ones it must pass over) and REAL row (reports; never reds before its series starts, spec §5.1 rule 3):
  - `retireGateLadders()`: top-level functions under `server/src` whose body calls `ccdCan(` with a literal retire act key (`wsReclaim`, `wsExpire`, `wsCollect`, `wsCollectLoose`) **and** calls `.isVisible(`. **Expected at base: 3**, `coord/childReclaim.ts#childReclaimOutcome`, `coord/expireArchived.ts#expireArchived`, `coord/collectTempRoot.ts#collectTempRoot`. FIXTURE: a function reading `ccdCan(s, 'wsArchive')` and `isVisible` is not counted (the stale-archive shape).
  - `retireSwitchWrappers()`: functions in `coord/childReclaim.ts`, `coord/childReclaimDisabled.ts`, `coord/expireArchived.ts`, `coord/collectTempRoot.ts` and, once it exists, `server/src/retire.ts`, whose body calls `readSwitches(`. **Expected at base: 4**, `#childReclaimPauseRead`, `#childReclaimDisabledOf`, `#expirySwitches`, `#collectSwitches`.
  - `retireActSites()`: functions under `server/src` whose body composes `CCD_ARGV.wsReclaim(`, `.wsExpire(`, `.wsCollect(` or `.wsCollectLoose(` (inline in a `runCcd(` call or bound and then passed). **Expected at base: 3**, `#childReclaimAct`, `#expireAct`, `#collectTempRoot`. This census is pinned exact from C4h on (§What the measurement found, item 9): it may not shrink by merging composers, and may not grow.
  - `retireQueueSites()`: functions under `server/src` whose body calls `.queue.run(` with a callback that calls `reclaimChild(`, `expireArchived(` or `collectTempRoot(`. **Expected at base: 4**, `watch.ts#execChildReclaim`, `watch.ts#collectAct`, `watch.ts#archivedExpiryPass`, `coord/routes.ts#childReclaimPort`. (`watch.ts#collectLearn` queues `learnCollect`, an audit-only job that composes no destructive verb; the FIXTURE row proves it is not counted.)
  - `retireNoticeSites()`: functions under `server/src` whose body calls `notify(` with a title from a retire reason's feed constants (`CHILD_RECLAIM_*_FEED_TITLE`, the expiry titles `recordExpireFeed` takes, `COLLECT_FEED_TITLE`, `COLLECT_LOOSE_FEED_TITLE`, `COLLECT_SETTING_FEED_TITLE`, `CHILD_RECLAIM_DISABLED_FEED_TITLE`). Step 0 measures the list and writes it as a literal; it is pinned exact from C4h on (D-7176: no notice moves).

**What the pin holds** (each a named `it`, green on the old code):
- **The step matrix.** For each reason, one row per step of its ladder with that step's deferral alone standing (its outcome word and detail, byte for byte, and the argv recorder empty or holding exactly the audit), and one row per pair of adjacent steps standing together, answering the earlier (the order, measured). The words: child-spent's `ChildReclaimDeferWhy` set (`marker-unreadable`, `marker-mismatch`, `siblings-unreadable`, `siblings-open`, `paused-at-server`, `generation-changed`, `presence`, `unsupported`) and `gone`; archive-expired's `composition`, `unsupported`, `deferred` (`paused`, store words, `presence`), `audit-failed`, a moved archive; temp-orphan's `not-asked` (steps 1 to 4: `caps`, `id-refused`, `paused`, `presence`), `answered` (steps 4 to 6: every `CollectAnsweredWhy`), `held` (4, 6).
- **The difference table**, one row each, measured on `c332aca73` (Step 0 re-measures every row): exactly §What the measurement found, item 2, plus: the listing mode per reason (`readdirMeasured` once, or `readdir` per marker) and what an unlistable or rejecting registry answers in each; whether the capability's precondition (`reclaim-pause-v1`) is asked (temp-orphan only); the stale arm's capability (child-spent only); the shadow arm and where it is decided (`expire-lane-live` at step 6; the collector's `collectLaneEffective` at step 6; child-spent has none); the after-act hook (child-spent's `childReclaimStaleTold`).
- **The held-at-the-act rows** ("a raise between the decide read and the act holds"): a scripted listing clean at the first read and raised from the late read on, for expiry (`reclaim-paused`, and `expire-lane-live` removed: would-expire), the collector (`reclaim-paused` at step 5; the epoch moved; the Settings row flipped; presence opened in step 6; a run opened onto the witness in step 6) and child-spent (`child-reclaim-disabled` at step 6; the generation changed between 2c and 5a). **And today's gap, recorded as a row:** child-spent with `reclaim-paused` clean at 2b and raised from the next listing on reaches the `ws-reclaim` argv (the box then refuses inside its lock; the row records the server's composed argv and the folded refusal). C4o flips this row in its behaviour commit if OA-C14 is ruled (a).
- **The synchronous tail.** temp-orphan: between the step-5 listing's settle and the `ws-collect` argv no microtask runs (a `queueMicrotask` scheduled by the listing's fake on settle has not run when the recorder sees the argv).
- **The argv rows.** For each reason, the exact audit and act argv bytes for a plain row and for each flag arm (`--child-of`, `--defer-expired`, the stale flags, the loose arm), and the declared actor (`sweepDec`).
- **The notice rows.** child-spent: one `notify` per outcome except `gone` and `childReclaimFeedSkips`, kind, title and body; archive-expired and temp-orphan: the executor calls `notify` zero times (their lanes' rows are pinned by `archived-expiry-lane.test.ts` and `collect-feed-body.test.ts`, run unchanged).
- **The close route.** `childReclaimPort`'s job: `childReclaimUnlessDisabled` first, then the executor; a raised `child-reclaim-disabled` composes nothing; a throw answers the route's `.catch` sentence.

- [ ] **Step 0: Re-ground.** Read the three executors and their four switch wrappers on the tree; re-measure every row of item 2's table; run the five censuses (expected 3, 4, 3, 4, and the notice list written as measured). Check whether #1514 has landed; if it has, measure the child rows on its tree. A count or row that differs is reported before Step 1.
- [ ] **Step 1: Write the pin and the census module**, green on the old code.
- [ ] **Step 2: Mutation table, RUN** (each mutant on a scratch copy of the old code, reverted after):

  | Mutant | Expected red |
  |---|---|
  | `expireArchived`: the step-6 `expirySwitches` call removed | "a pause raised during the act holds: archive-expired" |
  | `collectTempRoot`: an `await Promise.resolve()` inserted before the `ws-collect` argv | "temp-orphan: no microtask runs between the last listing and the argv" |
  | `childReclaimOutcome`: presence moved above the generation re-read (2c) | "child-spent: every pair standing together answers the earlier step" |
  | `childReclaimOutcome`: the `req.deferExpired` guard dropped from presence | "child-spent: presence defers only until its ceiling" |
  | `expireArchived`: presence given a ceiling (`req.deferExpired`-style flag read as true) | "archive-expired: presence defers with no ceiling" |
  | `childReclaimPauseRead`: `readdir` swapped for `readdirMeasured` | "child-spent: a rejecting readdir keeps its own sentence" |
  | `reclaimChild`: `recordChildReclaimFeed` skipped | "child-spent: one notice per outcome" |
  | `expireAct`: `--child-of` dropped for a child row | "archive-expired argv: a child row carries --child-of" |

- [ ] **Step 3: Verify,** one file at a time: `retire-executors-pin.test.ts`, `census-w4/retire.test.ts`, `reclaim-pause-pin.test.ts`, `ccd-retire-verdicts.test.ts`, `child-reclaim.test.ts`, `expire-archived.test.ts`, `collect-temp-root.test.ts`, `collect-switch-executor.test.ts`, `child-reclaim-disabled.test.ts`, `census-w4/bindings.test.ts`, `single-definition/advance-switches.test.ts`; then both `tsc` runs.

**Exit (GATES):** the pin is green on `c332aca73`'s code and on the PR's tip; every mutant above reds its row; the five censuses report by name (`retireActSites` and `retireNoticeSites` pinned exact; the other three report). **Must not change:** any `server/src` byte. **Rollback:** `git revert`.

### Task C4i: `decideRetire` — one gate decider, three reason rows (`D-7166`; ARCH-44, second PR; spec K1, C4 "Policies, not lanes") — GATED: after C4h

**Routing:** **band 3, native** (the decider gates destructive verbs; two reviewers, one reading only Review focus 1, 3 and 4). **Lane:** server. **Branch:** `refactor/arch-44-decide-retire`.

**Files:**
- Create `server/src/retire.ts` (**L1**; **C4**: add `retire.ts` to the C4 row of the `ring-context-map` table). It holds:
  - **The vocabulary, spelled here and nowhere else**, each an exported `as const` constant: `RETIRE_REASON_NAMES` (`temp-orphan`, `archive-expired`, `child-spent`); `RETIRE_STEPS` (`record`, `id`, `capability`, `switches`, `off-switch`, `store`, `generation`, `presence`, `audit`, `audit-generation`, `near-argv`); `RETIRE_LISTING_MODES` (`measured-once`, `plain-per-marker`); `RETIRE_PRESENCE_RULES` (`no-ceiling`, `until-ceiling`); `RETIRE_NOTICE_HOMES` (`executor`, `lane`).
  - `RetireReason<Req, Facts, Out>`, the row type. **Every difference in C4h's difference table is a field of the row:** `name`; `decide` and `act`, the ordered step lists before and after the audit; per step, whether it is `sync`; the listing mode and the markers each listing step reads; the presence rule; the notice home; and `judge`, the row's map from a step to a pure function `(fact, facts, req) => Out | null` that answers the reason's own outcome word (the words stay the reason's: `ChildReclaimDeferWhy`, `ArchivedExpiryOutcome`, `CollectJobOutcome`) or passes. `evidence` names the reason's lane verdict (`childReclaimSweepVerdict` and `childReclaimDecision`; `archivedExpiryVerdict`; `collectLicence`), by reference only: `decideRetire` never calls it, and no lane call moves (D-7173).
  - **The shared judges**, defined once and referenced by the rows that use them: `pausedJudge` (a raised `reclaim-paused`, or a listing that cannot rule it out, in the listing mode's two sentences), `presenceJudge` (by the presence rule), `capabilityJudge` (a `false` capability answer; the `ccdCan(…)` call itself stays in the row's reader in the reason's file, so `capabilityChoiceSites()` keeps its literal keys, D-7177).
  - `decideRetire(facts, reason)`: walks `reason.decide` then `reason.act` in order; for the first step with no fact it answers `{ need: step }`; for a step with a fact, the row's judge either answers (the outcome, which ends the ladder) or passes; after the last `decide` step it answers `{ need: 'audit' }`; after the last `act` step `{ act: true }`. It never reads a fact out of order, and it **never compares `reason.name`** (a scan row in `single-definition/late-census.test.ts`, through `scan/symbols.ts#sourceOfSymbol` and a `scan/parse.ts` expression walk, reds a comparison against the name or a `switch` on it).
- Modify `server/src/coord/collectTempRoot.ts`: append `TEMP_ORPHAN_RETIRE: RetireReason<CollectJob, …, CollectJobOutcome>` at the file's tail, its judges written from the executor's current statements (the step numbers in its header map to its steps). No existing statement changes.
- Modify `server/src/coord/expireArchived.ts`: append `ARCHIVE_EXPIRED_RETIRE` likewise.
- Modify `server/src/coord/childReclaim.ts`: append `CHILD_SPENT_RETIRE` likewise (line-disjoint from #1514, checked at Step 0).
- Modify `server/test/census-w4/retire.ts` and its test: add `retireDeciders()`, functions under `server/src` returning a `{ need:` object literal (expected after this PR: 1, `retire.ts#decideRetire`), FIXTURE and REAL rows; ratchet in `single-definition/late-census.test.ts`: exactly 1, may only shrink.

No caller changes: the three executors keep their bodies.

- [ ] **Step 0: Re-ground;** rule 6 check for the three row files; read `serverRing` for each (the rows import only types and constants from `retire.ts`, L1, which every ring may import).
- [ ] **Step 1: Characterization commit.** C4h's suite, `reclaim-pause-pin.test.ts` and `ccd-retire-verdicts.test.ts` re-run on the base; `mail-routes.test.ts` re-run on the base (the coord kebab census must stay green on every later commit: the rows spell no new kebab literal, they use `RETIRE_STEPS` and the reasons' own declared words).
- [ ] **Step 2: Red.** A `decideRetire` suite inside `retire-executors-pin.test.ts`: C4h's whole step matrix, as fact sets, run through `decideRetire(facts, ROW)` for each row, must equal the old executors' answers row for row (the outcome word and detail, and the `need` sequence equal to the old ladder's read order). Red (no module).
- [ ] **Step 3: Green.** Write `retire.ts` and the three rows beside the old ladders; Step 2 green.
- [ ] **Step 4: Ratchet commit** (`retireDeciders()` = 1; the no-name-compare scan).
- [ ] **Step 5: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | `CHILD_SPENT_RETIRE.decide`: `presence` before `generation` | the decider suite: "child-spent: every pair standing together answers the earlier step" |
  | `presenceJudge` ignores the presence rule (always no ceiling) | "child-spent: presence defers only until its ceiling" (decider suite) |
  | `ARCHIVE_EXPIRED_RETIRE`'s listing mode set to `plain-per-marker` | "archive-expired: one listing reads both switches" (decider suite) |
  | an `if (reason.name === 'child-spent')` added to `decideRetire` | the no-name-compare scan |
  | `TEMP_ORPHAN_RETIRE` spells the step `'near-argv'` as a literal in `coord/collectTempRoot.ts` | `mail-routes.test.ts`: "every quoted kebab token in server/src/coord … is declared" |
  | a second function returning `{ need:` added under `server/src` | the `retireDeciders` ratchet |

- [ ] **Step 6: Verify,** one at a time: `retire-executors-pin.test.ts`, `census-w4/retire.test.ts`, `reclaim-pause-pin.test.ts`, `ccd-retire-verdicts.test.ts`, `mail-routes.test.ts`, `single-definition/late-census.test.ts`, `single-definition/advance-switches.test.ts`, `rings/totality.test.ts`, `capability-census` rows in `consolidation-census.test.ts` (unedited, still green); both `tsc` runs.

**Exit (GATES):** one gate decider (`retireDeciders()` = 1, pinned); the decider equals the three executors on C4h's whole matrix; C4h green, unedited. **Must not change:** any executor statement; any outcome word or detail; the exported names and signatures of the three executors and four switch wrappers. **Rollback:** `git revert`.

### Task C4j: `retireAct` — the one executor loop (`D-7167`; ARCH-44, third PR; spec K1) — GATED: after C4i

**Routing:** **band 3, native.** **Lane:** server. **Branch:** `refactor/arch-44-retire-act`.

**Files:**
- Create `server/src/retireLane.ts` (**L4**, as `sleepLane.ts`; **C4**: add its row to the `ring-context-map` table). It holds `RetireActPort<Req, Facts, Out>` (the row's readers, one per step, each returning a fact or a promise of one; the audit; the act; the after-act hook; the notice writer when the notice home is `executor`) and `retireAct(port, reason, req)`: loop on `decideRetire`; on `{ need: step }` call the step's reader, **awaiting only a returned promise and never a plain value**, and **never awaiting after the last async step of `act`** when the remaining steps are `sync`; on `{ need: 'audit' }` run the audit and record its fact; on an outcome, return it (after the notice when the row's home is `executor`); on `{ act: true }` run the act, then the after-act hook, then the notice. It never throws past the act's own answer (each reader's rejection is mapped by the row's judge to its own sentence, as today). It never compares `reason.name` (the C4i scan row extends to it).
- Tests: a `retireAct` suite inside `retire-executors-pin.test.ts` over **fixture rows only** (`lane-a`-style rows declared in the test, never the three real rows): the read order equals the `need` order; a sync step after an async one runs in the same microtask as the act (the `queueMicrotask` probe of C4h); a rejecting reader answers its judge's sentence; the notice is written once for home `executor` and never for home `lane`; the after-act hook runs only after an act that composed.
- Modify `server/test/census-w4/retire.ts`: `retireGateLadders()` learns its post-move shape: a function in `retireLane.ts` that calls a port's capability reader and presence reader is the one executor body, named by the REAL row (`retireLane.ts#retireAct`) and asserted separately; the three legacy ladders are still counted.

No consumer: the three executors still run their own bodies.

- [ ] **Step 0: Re-ground;** read `serverRing` for `sleepLane.ts` (L4) and confirm `retireLane.ts`'s imports keep it L4.
- [ ] **Step 1: Characterization commit:** C4h and C4i suites re-run on the base.
- [ ] **Step 2: Red:** the fixture-row `retireAct` suite (no module).
- [ ] **Step 3: Green.**
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | `retireAct` awaits every reader (`await port.read[step](…)`) | "a sync step after the last async one runs in the act's microtask" |
  | `retireAct` writes the notice for home `lane` | "the notice is never written for home lane" |
  | `retireAct` runs the after-act hook after a deferral | "the after-act hook runs only after an act that composed" |
  | `retireAct` reads the next step before judging the current one | "the read order equals the need order" |

- [ ] **Step 5: Verify:** `retire-executors-pin.test.ts`, `census-w4/retire.test.ts`, `single-definition/late-census.test.ts`, `single-definition/advance-switches.test.ts`, `rings/totality.test.ts`, `rings/outward-edges.test.ts`; both `tsc` runs.

**Exit (GATES):** `retireAct` exists, one definition, driven by fixture rows; C4h and C4i green, unedited. **Must not change:** any `server/src` file but the new one. **Rollback:** `git revert`.

### Task C4k: temp-orphan through `retireAct` (`D-7168`; ARCH-44, fourth PR; spec §5.7 "reasons migrate one PR each") — GATED: after C4j

**Routing:** **band 3, native** (the collector's synchronous step 6 is the riskiest move in the plan; two reviewers, one reading only Review focus 2). **Lane:** server. **Branch:** `refactor/arch-44-retire-temp-orphan`.

**Files:**
- Modify `server/src/coord/collectTempRoot.ts`: the readers of `TEMP_ORPHAN_RETIRE`'s steps are the statements `collectTempRoot` runs today, moved into `collectRetirePort(deps, job)` in the same file (the `ccdCan` literals, `collectSwitches`, `collectAudit`, the epoch read, step 6's synchronous block with `collectRetireLatch`, `collectControlNow`, `collectLaneEffective`, `collectLicenceStands` and `collectOpenRunHold`, and the act's `CCD_ARGV.wsCollect(`/`.wsCollectLoose(` composition under its `sweepDec`). `collectTempRoot(deps, job)` keeps its name and signature, and its body becomes `return retireAct(collectRetirePort(deps, job), TEMP_ORPHAN_RETIRE, job)`. `learnCollect` is untouched (its audit-only job is not a retire act; D-7176). `collectSwitches` keeps its name, signature and answer; its body becomes a call to `retire.ts`'s listing reader in mode `measured-once` (the wrapper census counts it out).
- Re-pointed literal and structural pins, each in its own commit, keeping every other assertion byte-identical: Step 0 lists every suite that reads `collectTempRoot`'s body by symbol (`scan/symbols.ts#sourceOfSymbol(…, 'collectTempRoot')` and `callsIn`) or by parsed statement order — measured candidates `collect-switch-executor.test.ts`, `collect-switch-scans.test.ts`, `collect-temp-root-reads.test.ts`, `collect-lane-scans.test.ts`, `collect-readers.test.ts`, `ccdargv-collect-loose.test.ts`, `id-argv-census.test.ts` — and re-points each to `collectRetirePort` (the statements it asserts now live there). `coord/collectTempRoot.ts`'s literal-pin ceiling is 0 and stays 0.
- `server/test/census-w4/retire.test.ts`: REAL rows for `retireGateLadders()` (3 → 2) and `retireSwitchWrappers()` (4 → 3).

- [ ] **Step 0: Re-ground;** list the pins above by running each suite against a scratch copy of `collectTempRoot.ts` with the body moved (the ones that red are the list); a red outside the measured candidates is reported before Step 1.
- [ ] **Step 1: Characterization commit:** C4h's temp-orphan rows, `collect-*` suites and `ccd-retire-verdicts.test.ts` re-run on the base.
- [ ] **Step 2: Move commit:** `collectRetirePort` and the one-line body. C4h unchanged and green.
- [ ] **Step 3: Re-point commits,** one per suite listed at Step 0.
- [ ] **Step 4: Ratchet commit:** in `single-definition/late-census.test.ts`, `retireGateLadders()` outside `retireLane.ts` ≤ 2, `retireSwitchWrappers()` ≤ 3, may only shrink.
- [ ] **Step 5: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | `collectRetirePort`'s step-6 reader made `async` | C4h: "temp-orphan: no microtask runs between the last listing and the argv" |
  | `TEMP_ORPHAN_RETIRE.act` drops the presence re-read in step 6 | C4h: "presence opened in step 6 holds the act" |
  | the `reclaim-pause-v1` precondition dropped from the capability reader | C4h: "temp-orphan: a box without reclaim-pause-v1 is not asked" |
  | `collectSwitches` reads `readdir` | `collect-switch-executor.test.ts` (unlistable words) |

- [ ] **Step 6: Verify,** one at a time: `retire-executors-pin.test.ts`, `census-w4/retire.test.ts`, every `collect-*.test.ts` under `server/test` (each file alone), `ws-collect-act.test.ts`, `ws-collect-wiring.test.ts`, `reclaim-pause-pin.test.ts`, `lane-reclaim-characterization.test.ts`, `ccd-retire-verdicts.test.ts`, `mail-routes.test.ts`, `single-definition/late-census.test.ts`, `single-definition/advance-switches.test.ts`; both `tsc` runs.

**Exit (GATES):** retire gate ladders **3 → 2**; switch wrappers **4 → 3**; act sites 3 (exact); notice sites unchanged; C4h green, unedited. **Must not change:** any argv byte; any `CollectJobOutcome` arm, step number, word or detail; the latch's write and its row; the slot; `learnCollect`. **Rollback:** `git revert` (the collector's own `collect-lane-live` and Settings row stay the operator's off switch without a deploy).

### Task C4l: archive-expired through `retireAct` (`D-7169`; ARCH-44, fifth PR) — GATED: after C4j

**Routing:** **band 3, native.** **Lane:** server. **Branch:** `refactor/arch-44-retire-archive-expired`.

**Files:**
- Modify `server/src/coord/expireArchived.ts`: `expireRetirePort(deps, req)` holds `ARCHIVE_EXPIRED_RETIRE`'s readers (the id predicate, the `ccdCan(…, 'wsExpire')` literal, `expirySwitches` at step 2 and again at step 6, `readExpiryStore`, `viewers.isVisible`, `expireAudit` and the archive-match check before a refusal is classified, the child arm's capability and `expire-child-live`, `expireAct`). `expireArchived(deps, req)` keeps its name and signature; its body becomes `return retireAct(expireRetirePort(deps, req), ARCHIVE_EXPIRED_RETIRE, req)` with its `answer` envelope (session id, archive instants, `child`) applied by the row's judges exactly as today. `expirySwitches` keeps its name and answer; its body calls the listing reader in mode `measured-once`. `recordExpireFeed` is untouched (the lane writes it; notice home `lane`).
- Re-pointed pins, each in its own commit: Step 0 lists them as C4k does; measured candidates `expire-archived.test.ts`, `expire-id-boundary.test.ts`, `archived-expiry-child.test.ts`, `archived-expiry-policy.test.ts`, `workspace-refusal-census.test.ts` (the `EXPIRE` harvest), `id-argv-census.test.ts`.
- `census-w4/retire.test.ts`: REAL rows 2 → 1 and 3 → 2 (or, if C4k has not landed, 3 → 2 and 4 → 3; the second of C4k and C4l to land rebases and writes the lower pair).

- [ ] **Step 0: Re-ground;** list the pins; check whether C4k has landed (the counts it starts from).
- [ ] **Step 1: Characterization commit:** C4h's archive-expired rows, the `archived-expiry-*` and `expire-*` suites and `ccd-retire-verdicts.test.ts` re-run on the base.
- [ ] **Step 2: Move commit.**
- [ ] **Step 3: Re-point commits.**
- [ ] **Step 4: Ratchet commit** (the measured pair; may only shrink).
- [ ] **Step 5: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | `ARCHIVE_EXPIRED_RETIRE.act` without the step-6 `switches` | C4h and `reclaim-pause-pin.test.ts`: "a pause raised during the act holds: expiry" |
  | the archive-match check moved after the refusal classification | C4h: "another archive's refusal is never folded onto the queued one" |
  | `store` judged after `presence` | C4h: "archive-expired: every pair standing together answers the earlier step" |
  | `expire-child-live` read from a second listing | C4h: "archive-expired: one listing reads both switches" |

- [ ] **Step 6: Verify,** one at a time: `retire-executors-pin.test.ts`, `census-w4/retire.test.ts`, `expire-archived.test.ts`, `expire-id-boundary.test.ts`, `archived-expiry-child.test.ts`, `archived-expiry-lane.test.ts`, `archived-expiry-policy.test.ts`, `expiry-lane-prose.test.ts`, `reclaim-pause-pin.test.ts`, `lane-reclaim-characterization.test.ts`, `workspace-refusal-census.test.ts`, `ccd-retire-verdicts.test.ts`, `census-w4/bindings.test.ts` (still 1), `mail-routes.test.ts`, `single-definition/late-census.test.ts`, `single-definition/advance-switches.test.ts`; both `tsc` runs.

**Exit (GATES):** gate ladders **→ 1** and wrappers **→ 2** (with C4k landed); act sites 3; notice sites unchanged; `boundBySites()` 1. **Must not change:** any argv byte; any `ArchivedExpiryOutcome` arm or word; the shadow journal's rows (`journalShadowVerdict`); expiry's "No ceiling". **Rollback:** `git revert` (`expire-lane-live` disarms the reason without a deploy).

### Task C4m: child-spent through `retireAct` (`D-7170`; ARCH-44, sixth PR; spec §5.7 "the `child-spent` PR's first commit is ARCH-77") — GATED: after C4k and C4l, and #1514 landed or proven line-disjoint

**Routing:** **band 3, native** (the reason with the most steps and the close route; two reviewers, one reading only Review focus 1, 3 and 7). **Lane:** server. **Branch:** `refactor/arch-44-retire-child-spent`.

**Files:**
- **First commit (ARCH-77, met on `main`, D-7175):** no source change. It re-runs `child-reclaim-disabled.test.ts`, `reclaim-pause-pin.test.ts`'s `child-reclaim-disabled` blocks and C4h's ARCH-77 rows on the base, and the PR body records that ARCH-77 landed as #1366 and #1409.
- Modify `server/src/coord/childReclaim.ts`: `childReclaimRetirePort(deps, req)` holds `CHILD_SPENT_RETIRE`'s readers (the record re-read with `childReclaimRowListing`, `readChildSiblings`, the coordinating read, `childReclaimPauseRead`, `childReclaimDisabledDetail` at decide and at the act, `childReclaimGenerationRead`, `viewers.isVisible` under the ceiling, the `ccdCan(…, 'wsReclaim')` and stale-cap literals, `childReclaimAudit` and the audit's generation, `childReclaimAct`, `childReclaimStaleTold` as the after-act hook, `recordChildReclaimFeed` with `childReclaimFeedSkips` as the executor notice). `childReclaimOutcome` is deleted; `reclaimChild(deps, req)` keeps its name and signature and calls `retireAct(childReclaimRetirePort(deps, req), CHILD_SPENT_RETIRE, req)`. `childReclaimPauseRead` and `childReclaimDisabledRead` keep their names, signatures and answers (`releaseRetiredChildHold`, `coord/rundefs.ts` and the close route still call them); their bodies call the listing reader in mode `plain-per-marker`, so a rejecting `readdir` still propagates to each caller's try. `releaseRetiredChildHold` is untouched (it composes `ws-release`, not a retire verb).
- Modify `server/src/coord/childReclaimDisabled.ts`: `childReclaimDisabledOf`'s body calls `retire.ts`'s pure listing judge for its marker (its answer unchanged).
- `coord/childReclaim.ts`'s literal-pin ceiling (6): Step 0 lists the six pins (a scratch print of `advance-switches.test.ts`'s scan, not committed); any that reads `childReclaimOutcome`'s text is re-pointed to `childReclaimRetirePort` through `scan/symbols.ts`, in its own commit, and the row lowered exactly by the pins that left literal reading. Measured candidates for structural re-points: `child-reclaim.test.ts`, `child-reclaim-paused-at-server.test.ts`, `child-reclaim-generation.test.ts`, `child-reclaim-licence-executor.test.ts`, `workspace-refusal-census.test.ts` (the `RECLAIM` harvest), `unattended-actor.test.ts`, `id-argv-census.test.ts`, `reclaim-pause-pin.test.ts` (its census of `childReclaimPauseRead` callers).
- `census-w4/retire.test.ts`: REAL rows, gate ladders outside `retireLane.ts` **1 → 0**, wrappers **2 → 1** (`retire.ts`'s listing reader).

- [ ] **Step 0: Re-ground;** #1514's state; list the six literal pins and the structural ones; re-measure C4h's child rows on the tree.
- [ ] **Step 1: The ARCH-77 commit** (above).
- [ ] **Step 2: Characterization commit:** C4h's child rows, every `child-reclaim-*.test.ts`, `coord-reclaim.test.ts` and `ccd-retire-verdicts.test.ts` re-run on the base.
- [ ] **Step 3: Move commit.**
- [ ] **Step 4: Re-point commits,** one per suite listed at Step 0; the `CEILING` row lowered in the commit that moves the last pin it counted.
- [ ] **Step 5: Ratchet commit:** gate ladders outside `retireLane.ts` = 0, switch wrappers = 1, exact.
- [ ] **Step 6: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | `CHILD_SPENT_RETIRE`'s two listings merged into one `measured-once` listing | C4h: "child-spent: a rejecting readdir keeps its own sentence" and "two listings, one per marker" |
  | `off-switch` dropped from `act` | `reclaim-pause-pin.test.ts` and C4h: "child-reclaim-disabled raised at step 6 holds the act" |
  | `audit-generation` judged before the audit's refusal | C4h: "a refusal is classified before the audit's generation" |
  | the notice home set to `lane` | C4h: "child-spent: one notice per outcome" |
  | `childReclaimStaleTold` run after a deferral | C4h: "the stale told runs only after a reclaim" |

- [ ] **Step 7: Verify,** one at a time: `retire-executors-pin.test.ts`, `census-w4/retire.test.ts`, every `child-reclaim-*.test.ts` (each file alone), `coord-reclaim.test.ts`, `reclaim-route.test.ts`, `reclaim-pause-pin.test.ts`, `lane-reclaim-characterization.test.ts`, `workspace-refusal-census.test.ts`, `unattended-actor.test.ts`, `id-argv-census.test.ts`, `ccd-retire-verdicts.test.ts`, `census-w4/bindings.test.ts`, `mail-routes.test.ts`, `single-definition/late-census.test.ts`, `single-definition/advance-switches.test.ts`, `rings/totality.test.ts`; both `tsc` runs.

**Exit (GATES, spec §5.7 for the retire half):** retire gate ladders outside `retireLane.ts`: **3 → 0**, one executor body (`retireLane.ts#retireAct`) and one gate decider (`retire.ts#decideRetire`); switch wrappers **4 → 1**; act sites **3** (exact, unchanged); notice sites unchanged (feed writers in the executors other than through the funnel: 0); `boundBySites()` **1**; every executor re-measures at the act (C4h's held-at-the-act rows green; child-spent's `reclaim-paused` gap row still recording today's behaviour until C4o). **Must not change:** any argv byte; any `ChildReclaimOutcome` arm, word or detail; the generation key; the close route; `releaseRetiredChildHold`. **Rollback:** `git revert` (`child-reclaim-disabled` disarms the reason without a deploy).

### Task C4n: one queue owner — `retireExecutor` (`D-7171`; ARCH-44, seventh PR; spec K1 "Consumers move") — GATED: after C4m and ARCH-43 C4g; its turn in the shared `watch.ts` queue

**Routing:** **band 2** (literal one-consumer moves; the orchestrator reviews every hunk against Review focus 8). **Lane:** server. **Branch:** `refactor/arch-44-retire-executor`.

**Files:**
- Modify `server/src/retireLane.ts`: add `retireExecutor(queue, id, run)` = `queue.run(id, run)`, typed so `run` is one of the three executor entries; the literal of deps is still built inside the callback.
- Modify `server/src/watch.ts`: `FleetWatcher#execChildReclaim` (the `childReclaimExec` seam first, unchanged), `#collectAct` (still `void`, its `.catch` unchanged) and `#archivedExpiryPass` (still awaited) call `retireExecutor`. Nothing else in `watch.ts` moves.
- Modify `server/src/coord/routes.ts`: `childReclaimPort` calls `retireExecutor` with `childReclaimUnlessDisabled` still wrapping `reclaimChild`, still `void`, its `.catch` sentence unchanged.
- `census-w4/retire.test.ts`: `retireQueueSites()` REAL row **4 → 1** (`retireLane.ts#retireExecutor`); the ratchet in `late-census.test.ts`, exact.
- Literal pins: `watch.ts` 79 and `coord/routes.ts` 38 — Step 0 lists any that read the four call sites' text; each is re-pointed in its own commit and the rows lowered exactly. Expected: none (the call sites' text is not pinned literally on the base), re-measured.

- [ ] **Step 0: Re-ground;** rule 6 for `watch.ts` and `routes.ts`; C4g on `main`; the queue's order.
- [ ] **Step 1: Characterization commit:** C4h's close-route and queue rows, `lane-reclaim-characterization.test.ts`, `child-reclaim-close.test.ts`, `collect-lane-slot.test.ts`, `archived-expiry-lane.test.ts` re-run on the base.
- [ ] **Step 2: Move commits,** one per call site (four).
- [ ] **Step 3: Ratchet commit.**
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | `#collectAct` awaits `retireExecutor` | `collect-lane-slot.test.ts`, `lane-reclaim-characterization.test.ts`: "a fire-and-forget lane whose body never settles delays neither the next tick …" |
  | `childReclaimPort` drops `childReclaimUnlessDisabled` | C4h: "the close route: a raised child-reclaim-disabled composes nothing" |
  | the deps literal hoisted out of the callback | C4h: "the job reads deps when it runs, never a snapshot" |

- [ ] **Step 5: Verify:** the Step 1 suites, `retire-executors-pin.test.ts`, `census-w4/retire.test.ts`, `reclaim-route.test.ts`, `growth-check.test.ts`, `single-definition/late-census.test.ts`, `single-definition/advance-switches.test.ts`; both `tsc` runs.

**Exit (GATES):** queue sites composing a retire executor **4 → 1**; spec K1 "`close.ts`'s fire-and-forget reclaim calls `retireExecutor`" met (through `childReclaimPort`, the route `closeRun` hands its reclaim to). **Must not change:** which callers await; any `.catch` sentence; the `childReclaimExec` seam; `collectLearn`. **Rollback:** `git revert`.

### Task C4o: child-spent re-reads `reclaim-paused` nearest the argv (`D-7172`; ARCH-44, eighth PR; spec K1 "re-measures at the act") — GATED: after C4m; OA-C14 ruled (a)

**Routing:** **band 3, native** (the plan's one behaviour commit). **Lane:** server. **Branch:** `fix/arch-44-child-spent-act-pause`.

**Files:**
- Modify `server/src/coord/childReclaim.ts`: `CHILD_SPENT_RETIRE.act`'s `off-switch` step reads `reclaim-paused` and `child-reclaim-disabled` from the one plain listing it already takes at step 6 (no new registry read), and a raised `reclaim-paused` there answers `deferred('paused-at-server', …)` with the 2b sentence and the suffix ` at the act` (the wording rule `childReclaimDisabledDetail` already uses). A rejecting `readdir` at step 6 keeps its current sentence.
- Modify `server/test/retire-executors-pin.test.ts`: C4h's gap row flips (the only row this task changes), and `reclaim-pause-pin.test.ts` gains the row "a pause raised during the act holds: child reclaim — clean at 2b, raised before step 6, no ws-reclaim" beside the expiry and collector rows. Its `includes(RECLAIM_PAUSE_MARKER)` census sees no new site (the read goes through the listing judge).

- [ ] **Step 0: Re-ground;** the ruling cited (OA-C14 (a), its D-number from the coordinator).
- [ ] **Step 1: Red commit:** the flipped row and the new `reclaim-pause-pin.test.ts` row, red on C4m's code.
- [ ] **Step 2: Green commit.** Only the step-6 judge changes. The PR body carries the before and after rows: before, the server composes `ws-reclaim` and folds ccd's refusal; after, the server composes nothing and answers `paused-at-server … at the act`.
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | the step-6 read takes a second listing | C4h: "child-spent: two listings, one per marker" (the count of `readdir` calls) |
  | the suffix ` at the act` dropped | the new `reclaim-pause-pin.test.ts` row (the sentence) |

- [ ] **Step 4: Verify:** `retire-executors-pin.test.ts`, `reclaim-pause-pin.test.ts`, `child-reclaim-paused-at-server.test.ts`, `child-reclaim.test.ts`, `child-reclaim-prose.test.ts`, `ccd-retire-verdicts.test.ts`; both `tsc` runs.

**Exit (GATES):** spec §5.7's "every executor re-measures at the act (the pin's 'pause raised between pass and act holds' row stays green)" holds for all three reasons. **Must not change:** the number of registry listings per child act; any argv byte; any other row. **Rollback:** `git revert` (restores ccd's in-lock refusal as the only act-time stop, as on `main`).

## Operator acts in this wave

**OA-C14 — should child-spent's server-side gate re-read `reclaim-paused` nearest the argv, as expiry and the collector do?** Today child reclamation reads the fleet's cleanup switch once, before presence and the audit; if the operator raises it during the audit, the server still sends `ws-reclaim`, and ccd refuses inside its lock (so nothing is deleted), and the feed shows ccd's refusal instead of the server's "paused" word.
- **(a) Yes, in C4o, as its own red-first behaviour commit** (recommended). It matches the ruled OA-C9 (a) for the sleep lanes, spec K1 ("reads the switches again nearest the argv"), and what the other two retire reasons already do; it adds no registry read (the act already lists the registry for `child-reclaim-disabled`); and it makes the operator's emergency stop answer in the server's own words.
- **(b) No; keep today's single read,** and C4h's gap row stays a named, pinned difference.

**OA-C15 — should the retire executors run inside the coordination serialiser, as spec K1's wording says?** Measured: none does today; each runs on the session's `KeyedQueue` only.
- **(a) Yes,** wrap each act in the serialiser. Every retire act would hold every coordination route (dispatch, close, mail) for an audit's duration (seconds per act, up to one act per lane per pass).
- **(b) Not in ARCH-44** (recommended): keep queue-only, behaviour-identical (D-7178), and correct the spec's K1 wording on this PR's review.
- **(c) A follow-up ticket** that closes the one real gap the serialiser would close, cheaper: the store's binding read moved nearest the argv for child-spent and archive-expired (the collector already re-reads its hold synchronously in step 6), as a red-first behaviour PR after C4m. Recommended together with (b).

## Acceptance

All eight PRs merged (C4o only if OA-C14 is ruled (a)); `retire-executors-pin.test.ts`, `reclaim-pause-pin.test.ts` and `ccd-retire-verdicts.test.ts` green and, apart from C4o's flipped row and its one new row, unedited since C4h; the census-w4 ratchets at their exits (gate deciders 1, gate ladders outside `retireLane.ts` 0, switch wrappers 1, act sites 3, queue sites 1, notice sites as measured, bound-by sites 1); `growth-check.test.ts` green; no `ccd/`, `shared/` or `pwa/` byte changed.

## Rollback

Every task is a `git revert`. The operator can disarm any one reason without a deploy, unchanged in meaning: `reclaim-paused` (all three), `child-reclaim-disabled` (child-spent), `expire-lane-live` and `expire-child-live` (archive-expired), `collect-lane-live`, its Settings row and `collect-loose-live` (temp-orphan). The old executor bodies stay until their own reason's PR, so a revert of C4m leaves C4k and C4l standing.

## Deviations found

- **D-7165** — Task C4h: the retire executors' characterization pin and the `census-w4/retire.ts` module (five queries).
- **D-7166** — Task C4i: `decideRetire` and the three reason rows.
- **D-7167** — Task C4j: `retireAct`, the one executor loop.
- **D-7168** — Task C4k: temp-orphan through `retireAct`.
- **D-7169** — Task C4l: archive-expired through `retireAct`.
- **D-7170** — Task C4m: child-spent through `retireAct`.
- **D-7171** — Task C4n: `retireExecutor` owns the `KeyedQueue` call.
- **D-7172** — Task C4o: child-spent re-reads `reclaim-paused` at the act (if OA-C14 is ruled (a)).
- **D-7173** — `decideRetire` is the gate the three executors share, not a merge of the three lane verdicts. Measured: the lane verdicts share no ladder (§What the measurement found, item 10), and spec K1's Verdict keeps each reason's evidence as its row. So spec §5.7's "6 → 2 deciders" is counted, for the retire half, as executor gate ladders 3 → 1 with each lane verdict named as its row's `evidence` and its call sites unchanged. The row fields that carry the measured differences: step order (decide and act), sync steps, listing mode (child-spent's two plain listings, the others' one measured listing), presence rule, notice home, after-act hook.
- **D-7174** — The census queries live in `server/test/census-w4/retire.ts`, never at the tail of `consolidationCensus.ts` (the ARCH-43 rule, D-7043).
- **D-7175** — ARCH-77 is on `main` (#1366, #1409); spec §5.7's "the `child-spent` PR's first commit is ARCH-77" becomes C4m's first commit re-running the ARCH-77 rows.
- **D-7176** — The passes, populations, pacing, slot, attention and notices stay per reason. Their schedule rows already exist (W1b); the lane-side notices (`recordExpireFeed`, the collector's two feed writers) are written by their lanes because they depend on lane memory (`expiryReportStands`, the collector's episode keys); `learnCollect` is an audit-only job and not a retire act. `retireNoticeSites()` pins the notice sites exact.
- **D-7177** — The capability checks (`ccdCan` with a literal key) and the six argv composers stay in the reason modules, inside each row's port. `retireActSites()` stays 3 by design; `capabilityChoiceSites()`, `id-argv-census.test.ts` and `unattended-actor.test.ts` stay unedited. The three executor entry names (`reclaimChild`, `expireArchived`, `collectTempRoot`) and the four switch-wrapper names are kept as one-line delegations, because about a hundred test files import them and their signatures are the reasons' public faces.
- **D-7178** — The retire executors stay queue-only; spec K1's "inside the coord serialiser" does not describe them (measured: only the sleep executor uses it). OA-C15 asks whether to change it; this plan does not.

### Operator acts, defined here

- **OA-C14** — child-spent's act-time `reclaim-paused` re-read (§Operator acts). Gates C4o.
- **OA-C15** — the coordination serialiser for retire acts (§Operator acts). Gates nothing in this plan.

### Issued numbers

D-7165 to D-7178, issued by the allocator on 2026-10-27 for this plan (count 14), each defined once above.

## Out of scope

- `ws-reap` (`retire(merged)`), `ws-rm`, `ws-gc --prune`, `forget`: operator routes with no lane and no executor of this shape.
- The dead-coordinator lane (`coord/endDeadCoordinator.ts`): C5's decider set (spec K1 Verdict).
- The stale-archive arm (`coord/staleArchive.ts`) and the orphan-tree lane (`coord/collectOrphanTree.ts`): they archive or rescue, they do not retire a workspace, and neither is a reason in spec K1.
- `releaseRetiredChildHold` (`ws-release` of a retired hold): it releases, it does not retire.
- The PWA's three attention parsers moving to one `AttentionRow[]` (spec K1 "Consumers move", last sentence): a `pwa/` change, W7.
- Any ccd-side helper (spec K2): the W5 ccd-helpers plan.
- OA-C15 (c)'s store re-read nearest the argv: a follow-up ticket if ruled.

## Review log

- rev 0 (2026-10-27): written from measurements on `origin/main` `c332aca73` (§What the measurement found). Not yet reviewed.
