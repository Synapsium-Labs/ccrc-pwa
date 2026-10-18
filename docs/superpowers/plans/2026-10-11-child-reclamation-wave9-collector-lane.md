# Child-reclamation wave 9: the temp-root collector's server lane — shadowed, licensed by two observations, paced, and visible Implementation Plan

> **For agentic workers:** this plan is dispatched as a wave to a `ccrc-worker` session; follow the `ccrc-worker` skill for the protocol (ack, claims, asks, wave-done). To execute the tasks, REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Programme:** child-reclamation (#166), **wave 9 of 9**, run 380. **Deploy class: server.** This wave is server and shared L0 only. It has no ccd, agent or PWA edit. Wave 7 (#344) shipped the verb `ws-collect`, its audit, its capability token and its agent grant, INERT; wave 8 (#349) shipped reclaim's server half. Both are deployed (v0.0.147).

**Goal:** Write the ONE server composer that spends wave 7's collect token, and ship it SHADOWED. After this wave:
- **The lane finds its population exactly.** It reads `$REG/tmproots` and `$REG/tmpquarantine` with measured reads, keeps only names the one L0 temp-root id predicate admits (never a dash-leading or over-long id), parses record names exactly, and never reads `~/.cc-tmp` (R83).
- **A token is spent only on two observations.** The executor's own audit is the second, at least one interval after the first, with nothing else answered between; the argv carries the second observation's token and the job's id (R85).
- **It never acts while it must not.** Both capabilities, the pause read three times, a presence defer, an open-run hold judged on the second observation and re-read after the job's last await, a fleet-wide slot of its own, and a start hold-off (R85, R86).
- **It is shadowed.** Without the hand-touched `$REG/collect-lane-live` it audits and records "would collect", and composes nothing (R82).
- **It is paced and never silent.** A deferral count and three runs per id, wave 8's formula imported; terminal words on the tier at once; `changed-recently` scheduled from ccd's `idleAt`; and every standing condition reaches the operator as attention, with no PWA edit (R87, R88).

**Architecture:** one new L1 policy file, one new L3 executor, and wiring.
1. **L0 (Task 1).** `isTmpRootId` and its cap, `CollectToken`, the collector attention arm, the box-wide labels; `CCD_ARGV.wsCollect` takes a `CollectToken`.
2. **L1, `server/src/collectLane.ts` (Tasks 2 to 5).** The readers, the population, the per-id licence and pacing state, and the attention and feed text. Wave 8's `childReclaimSweep.ts` gains one `export`, the clips clause on the leaf-kept yield, the merge's precedence, the widened `detailUnsafe` and two rewritten sentences.
3. **L3, `server/src/coord/collectTempRoot.ts` (Task 6).** The population read, the switches, the learning audit and the executor's six steps with the open-run hold.
4. **L4, `server/src/watch.ts` (Task 7).** The sibling pass, the slot, the start hold-off, the unsettled lines, the flock latch, the last-seen-live flag, the feed, and the merge inside `childReclaimPublishAttention`.

Then the guard pins (Task 8), the docs (Task 9) and the whole-branch pass (Task 10).

**Tech Stack:**
- TypeScript (server and shared), vitest 4, Fastify 5;
- `node:sqlite` (CoordStore: READS only, no migration);
- Node ≥ 22.16.0.

**Spec:** `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`: §5.10, §7 and §8. Task 9 writes this wave's text into each.

**Contract:** `docs/superpowers/programs/child-reclamation-contract.md`. **§16 (wave 9's pre-flight, R82 to R92) BINDS this plan** and amends §1 to §15. The coordinator's rulings on the task drafts are folded in below, and a ruling wins over any task text it names.

**Programme ledger:** `docs/superpowers/programs/child-reclamation.md`.

**HARD BOUNDARY.** This wave edits only these files:
- `server/src/**`, `server/test/**`;
- `shared/api.ts` (new declarations at the foot only; in-place rewrites above it line-neutral);
- `README.md` (Task 9's sentences; no `shared/api.ts:` anchor moves, because no insertion is made above the foot);
- the spec, and the contract's "§16 as built" note (Task 9);
- `CLAUDE.md` line 10's README size numeral, only if Task 9's re-measure moves it.

**It never edits:**
- anything under `ccd/`, `agent/`, `pwa/` or `deploy/`;
- `server/src/coord/schema.ts` (no migration);
- `server/src/archivedExpiry.ts`, `server/src/coord/expireArchived.ts`, `server/src/deadCoordinator.ts` and `server/src/coord/endDeadCoordinator.ts` (workspace-lifecycle's);
- the CLAUDE.md SAFETY bullet, `agent/CLAUDE.md`, or any skill text (`ws-collect-prose.test.ts`);
- README's cleanup-pause row (`:5310`) and the two workspace-lifecycle prose tests that pin it.

It adds no route, no capability token, no ccd verb and no agent grant. A step that seems to need anything else STOPS: name it by slug in the wave-done, and build nothing.

---

## Global Constraints

Each line binds every task.

- **Fakes and fixture HOMEs only.** No test reaches a live fleet. Never run `ccd` against the live `$HOME`, never run a destructive verb, and never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*.service`. Every case that runs ccd's collector runs it against a fixture HOME.
- **Rings:**
  - L0 `shared/*.ts` imports nothing;
  - L1 `collectLane.ts` and `childReclaimSweep.ts` import `shared/api.js` alone and are pure: clocks, intervals and constants arrive as ARGUMENTS (an L4 constant such as `CHILD_RECLAIM_SWEEP_MS` is never imported into L1);
  - L3 adapters never narrow a distinction they received;
  - L4 `watch.ts` wires and never decides;
  - no overloaded null at a seam.
- **Wire:** additive only, absence permits, ONE reader per field, no `FLEET_PROTO` bump.
- **Single definition:** each runtime list derives from its table, and every spelling is pinned once. The temp-root id predicate, the live marker and the pace formula each have one definer (Task 8).
- **Clocks (R39, R87):** every stored instant and every decision clock is monotonic. The wall clock is read once, at an answer's arrival, only to compare with ccd's `idleAt` (R87).
- **Mutation-table discipline:** every guard ships with a case that goes red when the guard is deleted or mutated, measured before and after.
- **Run vitest in the foreground, from `server/`:** `./node_modules/.bin/vitest run test/<file>`, with a timeout of at least 600000 ms. New cases go in NEW files (R56). Re-run a known load flake in isolation before calling it a break.
- **`shared/api.ts`:** declarations at the foot; any rewrite above it keeps every line number. Run session-hook's five citation cases after each such commit.
- **No `D-` token in a commit message, and no number range anywhere.** Name a departure by slug; the coordinator assigns its number at the fix round.
- **Branch discipline:** one commit per task, on this workspace's own branch. Absorb `main` only with `git merge`.
- **R23:** code comments and test titles cite the SPEC, never the contract.
- **Locate code by CONTENT.** Line numbers are hints at `d0c2b7803`, and workspace-lifecycle wave 6 (run 358) will move some of them when it lands.
- **R56 overlaps (R91):** workspace-lifecycle wave 6 shares `watch.ts` and `README.md`. The second lander merges main and re-points by content.
- **Commands are approval-free:** plain reads, git, grep, node and vitest. No `bash -c` with `eval`. A subagent's permission prompt blocks the whole pane and its mail. Subagents never send mail.

## Rulings that amend the task text (binding; the coordinator, 2026-10-11)

The six task drafts were written in parallel against a fixed interface list, and against contract §16 as it stood before its last check. These rulings fix every cross-task name, apply §16's final text, and rule on each drafter's open issue and named departure. A ruling wins over any task text it names.

- **H1 — §16's final text binds.** The drafts were written against an earlier §16. Its last check changed these, and every task applies them:
  - **The pass guard.** `collectSweeping` spans the gather and the synchronous decide-and-enqueue ONLY. The pass never awaits a learning audit, an executor job or an act it enqueued. Each is tracked by stamps in memory, and every pass derives the unsettled lines from them (R85).
  - **The offer.** The act job is offered FIRST, to the earliest ripe id (by ripening instant, then id) with no unsettled or already-enqueued collector call, skipping any id that has one. Learning audits are offered next, by next-ask instant and then id, again skipping pending ids. An id holding an observation is never offered a learning audit: its next ask is its ripening instant (R85). Pins: a single collectable orphan reaches its executor job within the interval plus two passes; a ripe X with a never-settling call does not stop Y's act.
  - **Unsettled jobs.** An executor JOB not settled `CHILD_RECLAIM_STALL_MS` after it took the slot raises the box-wide line, saying the act slot is held, even if it never composed a call (R85). Its bound counts from the enqueue (`unsettled-bound-counts-from-the-queue`, accepted). The job's STALL bound is checked FIRST: an act job past `CHILD_RECLAIM_STALL_MS` reads as holding the act slot whether its own audit, its act or nothing is out, so the box line treats `'act'` and `'job'` alike as slot-held (ruled at the plan attack). Only a learning audit, or an executor audit not yet past the job's bound, reads `'audit'` past `COLLECT_AUDIT_STALL_MS`.
  - **Pacing rows (R87):**
    - `unreadable` and an unknown verdict advance the FAILING run;
    - `not-witnessed` clears the three runs and ADVANCES the deferral count;
    - a verb refusal or failure whose word is terminal advances the TERMINAL run, ahead of the refusal and verb-failed rows;
    - an arm-1 die other than `flock-unavailable` takes the refusal floor, and its recurrence past the ceiling is attention;
    - the hold waits `CHILD_RECLAIM_DEFER_CEILING_MS` FLAT, with no count of its own (Task 4's `hold-count-never-binds` is resolved by deleting the count);
    - presence waits `childReclaimBackoffMs` over its own count.
  - **The restart residual** is stated as §16 now words it: about eight extra terminal audits or failing acts per terminal or verb-failed id after each restart.
  - **The box-wide list** includes the unsettled collector call OR JOB.
  - **The test citation** is `ws-collect-wiring.test.ts:25-26` and `:39`, with one cast at each file's token declaration.
- **H2 — the ring rule for `collectLane.ts`.** It imports `../../shared/api.js` and `./childReclaimSweep.js` ONLY: L1 to L1, one way, and `childReclaimSweep.ts` never imports `collectLane.ts`. Task 4's pacing suite pins exactly those two specifiers (`collector-l1-imports-the-formula-file`, accepted). Every task merges its additions into those two import statements.
- **H3 — canonical names.** The producer named here is canonical, and every other task renames to it.
  - **Task 1 (L0):**
    - `TMPROOT_ID_MAX_CHARS` and `isTmpRootId`;
    - `CollectToken`;
    - `ChildReclaimCollectAttention`;
    - `ChildReclaimCollectMany`, with the word prefix **`collect:`** (`` `collect:${string}` ``) and declared by Task 1 in the ONE union-line rewrite (`collect-many-arm-declared`, accepted);
    - `COLLECT_BOX_LABELS`, `CollectBoxLine` and `COLLECT_BOX_LINES`, with the KEY SET `tmproots`, `tmpquarantine`, `refused-names`, `box-probe`, `no-document`, `lock`, `flock`, `unsettled`, `unvouched` and `no-run`, using Task 1's label strings (Task 1 renames its `probe` key to `box-probe`).
  - **Task 2 (readers):**
    - `CollectProbe`, `COLLECT_PROBE_CLASS`, `COLLECT_PROBES` and `collectProbeClass`;
    - `CollectRefusalWord`, `COLLECT_REFUSAL_CLASS`, `COLLECT_REFUSAL_WORDS` and **`collectRefusalClass`** (Task 4's `collectRefusalKind` is renamed);
    - `CollectAudit`, `parseCollectAudit`, `CollectResult`, `parseCollectResult`, `CollectDieWord`, `COLLECT_DIE_TEXT` and `COLLECT_LOCK_DIE_PREFIX`.
    - **`CollectAudit`'s `verdict` and `unmeasured` arms ALSO carry `witnessRun: number | null` and `leaf: string | null`** (additive), because ccd prints `collect.witness` and `collect.leaf` on every document and R88's `runId` and leaf sentence read the latest document.
    - `exists` is not carried, since nothing gates on it (`exists-not-carried`). The witness's `run` and `at` are parsed from ccd's printed shape, which is decimal-digit JSON strings per `_ws_collect_audit_doc`. A witness whose `run` or `at` is not a canonical integer makes the document `unreadable`, and `witnessRun`/`witnessAt` are null iff `collect.witness` is null. Task 6's fixture is the consumer pin.
  - **Task 3 (population):** `COLLECT_POPULATION_MAX`, `CollectListing`, `CollectListingName`, `CollectListingDoubt`, `CollectPopulation`, `COLLECT_RECORD_NAME_RE`, `parseCollectRecordName`, `collectPopulation` and `collectForgets`.
    - The cap counts the RAW listing (`population-cap-counts-the-raw-listing`, accepted). Task 5's box lines read Task 3's `CollectListingDoubt`, and Task 5's `CollectListingLine` is deleted in favour of it.
    - The dot-leading drop and the refused-name count are Task 3's (L1). Task 6's `readCollectPopulation` drops non-string names only.
  - **Task 4 (state):** `CollectEntry` and every field and transition Task 4 declares, `CollectObservation`, **`collectLicence` and `collectLicenceStands`** (Task 6's `collectLicensed` is replaced by them), and `CollectStep`, `CollectCapture`, `collectCapture`, `collectFresh`, `collectClearPair`, `collectIdleSchedule`, `collectNextAskMono`, `collectDue`, `collectRipe`, `collectAttentionCauses`, `CollectFeedCue` and `collectFeedStep`.
    - **`CollectHoldWhy` = `run-open` | `run-absent` | `run-after-witness` | `id-in-open-run` | `no-witness-run` | `store-unreadable`** (Tasks 5 and 6 rename theirs).
    - Task 5's `CollectAttentionView` becomes a projection Task 5 writes, `collectAttentionViewOf(e: CollectEntry): CollectAttentionView`, over Task 4's fields. Task 4's entry is not reshaped for it. Task 4's evidence keeps the LATEST document's `witnessRun` and `leaf` (H3, Task 2).
  - **Task 6 (executor):** the port `CollectLanePort` (the consumer declares it), `CollectClock`, `CollectGenerations`, `CollectAnswer`, `CollectJob`, `CollectHeld`, `CollectHoldRead`, `CollectAnsweredWhy`, `CollectJobOutcome`, `CollectLearnAnswer`, `readCollectPopulation`, `collectSwitches`, `learnCollect`, `collectOpenRunHold` and `collectTempRoot`. Task 7 implements Task 6's port members exactly (`clock`, `generations`, `observation`, `cleared`, `flipped`) and folds Task 6's outcome arms; Task 7's assumed names (`observation1`, `noteLive`, `monoMs`) are renamed. The port's `holdOffUntilMono` is DELETED (H4).
  - **Task 7 (L4 and offers):** `COLLECT_OBSERVE_INTERVAL_MS`, `COLLECT_AUDIT_STALL_MS`, `CollectFlight`, `CollectSlot`, `sweepTempRootCollect`, and the L1 exports it appends to `collectLane.ts`: `CollectCandidate`, `collectCandidateOf`, `CollectOfferInput`, `CollectOffers`, `collectOffers`, `CollectJobSettled`, `CollectJobEffects` and `collectJobEffects` (`lane-bounds-decided-in-l1`, accepted). `collectOffers` implements H1's offer order.
  - **Task 5 (attention):** `ChildReclaimCollectInput`, `CHILD_RECLAIM_COLLECT_NONE`, `CHILD_RECLAIM_COLLECT_MANY_PREFIX` = `'collect:'`, `childReclaimIdsNamed`, `childReclaimClipsSecond`, `childReclaimCollectManySentence`, the three-argument `childReclaimAttentionWithLeaves`, `collectAttentionItems`, `CollectBoxFacts`, `collectPassClass`, `collectBoxProbesAfter`, the feed builders and `COLLECT_FEED_TITLE`.
- **H4 — the start hold-off is asked at the OFFER.** `collectOffers` offers no act job inside `CHILD_RECLAIM_STALL_MS` of the lane's start, shadow included, so a restarted lane's first would-collect waits 8 minutes (only slower; `start-hold-off-asked-at-the-offer`, accepted). Task 6 asks no hold-off, and its `hold-off-asked-at-step-6-live-only` departure and the port member are deleted.
- **H5 — no commit is red.** Each commit keeps every suite it touches green.
  - Task 6 rewrites `ws-collect-wiring.test.ts`'s INERT `it` in its own commit: the builder holders become `['ccdargv.ts','coord/collectTempRoot.ts']`, and the `COLLECT_CAP` holders `['ccdargv.ts','coord/collectTempRoot.ts']`. The `'ws-collect'` and `'--collect'` literal lists stay byte for byte.
  - Task 6 also adds `'ws-collect'` to `CAP_GATED_VERBS`, and rewrites `ccdargv.ts`'s two docstrings that become false (`Composed by NOTHING in this build`, `Nothing reads it in this build`), line-neutrally (`ccdargv-collect-docstrings-rewritten`, accepted, moved from Task 8 to Task 6).
  - Task 7 adds `'watch.ts'` to the `COLLECT_CAP` holders in its commit, because its pass gate asks `capSupported(…, COLLECT_CAP)` in `watch.ts`.
  - Task 8 starts from that state: `NEW_GENERATION`, the describe's title and comment rewrite, and its added scans.
- **H6 — the first-argument scan matches Task 6's shape.** At the one `CCD_ARGV.wsCollect(` site, the first argument is `<x>.token`, where `<x>` is bound in the SAME function from the executor's own observation-2 answer (`const obs2 = audit.value`, `audit` coming from the job's one audit call). Task 8's scan accepts exactly that, and reds on `obs1.token`, on a literal, and on a token read from the lane's memory. `collect-scan-shape-mismatch` is void.
- **H7 — reader choices (Task 2), confirmed:**
  - an exit-0 `unmeasured` is `unreadable`;
  - an exit-1 `unmeasured` with a null or empty probe is `unreadable`;
  - a `collectable` whose `witness` key is malformed, or absent where a fresh document needs it, is `unreadable`;
  - a present `resume` that is not a non-empty string is `unreadable`;
  - a `collected` or `refused` document at a non-zero exit is `failed` with token `''`, which advances the VERB-FAILED run;
  - a JSON value with none of `collected`, `refused` and `failed` is arm 3 (may have acted);
  - the four `--actor`/`--reason` dies are unrecognised (arm 3; unreachable);
  - the `lock-unopenable` matcher requires the path to end in `/.reap-<id>.lock` (stricter).
  - A verb `refused not-witnessed` is read as the audit's `not-witnessed` (the runs clear, the deferral count advances), plus the refusal floor.
- **H8 — attention wording and timing (Task 5).**
  - A terminal item stands while the terminal run stands. Its sentence is true in every state: it says what ccd answered at the run's last terminal answer, never that the id is refused now.
  - The (b)/(c) `unvouched` line waits the hold's ceiling (`unvouched-line-waits-the-ceiling`, accepted).
  - Run-less items over the limit share ONE `no-run` line with one clause per word (`no-run-lines-share-one-label`, accepted).
  - A box-wide probe line clears on any answer that passed every rung (`box-probe-line-clears-on-a-passing-answer`, accepted).
  - A reclaim `kept-many` member carrying a second clause leaves the line and stays single (`reclaim-kept-many-member-with-a-clause-stays-single`, accepted).
  - `childReclaimStuckEnd` gains the `export` keyword only (accepted).
  - Until Task 7, the publish call passes `CHILD_RECLAIM_COLLECT_NONE`, not an inline object (`watch-interim-empty-collector`, accepted, with that constant).
- **H9 — accepted departures, each named by slug in the wave-done:**
  - Task 1: `attention-doc-pair-counts-the-collector`.
  - Task 4:
    - `a-stale-answer-paces-but-never-observes`;
    - `observation-wait-in-the-next-ask` (now §16's ripening instant);
    - `changed-recently-without-idleat-is-a-deferral`;
    - `failing-run-stays-on-the-tier-once-entered`;
    - `unreadable-and-unknown-verdict-are-failures` (now §16's);
    - `verb-terminal-refusal-advances-the-terminal-run` (now §16's);
    - `continuity-measured-answer-to-answer`;
    - `hold-and-presence-continuity-survive-observations`;
    - `junk-quarantine-names-are-refused-names`;
    - `population-ids-and-candidates-split`.
  - Task 5: `clips-clause-wrapped-in-one-sentence`, `stuck-end-exported`.
  - Task 6:
    - `hold-reported-ahead-of-the-licence`;
    - `unplaced-witness-instant-holds`;
    - `audit-gate-refusal-clears-as-caps`;
    - `learn-collect-asks-no-id-predicate` (H13's name): `learnCollect` does not re-assert the id predicate (two checks, as R83 names).
  - Task 7:
    - `collect-sweeping-is-the-overtaken-guard` (now §16's);
    - `pass-reads-its-switches-in-its-gather`;
    - `a-thrown-job-reads-as-no-document`;
    - `an-answer-for-a-forgotten-id-is-dropped`;
    - `collector-records-unread`.
  - Task 8:
    - `ws-collect-cap-entry-is-a-classification` is VOID (H13): the wave-done does not name it;
    - `collect-act-cap-after-last-await-pinned`;
    - `cc-tmp-scan-display-only`;
    - `budget-test-pins-the-read-values`;
    - `census-title-control-pins-its-width`;
    - `collect-lane-prose-pins`.
  - Task 9:
    - `r92-section-7-lines-are-section-5-10s`;
    - `spec-stale-sentences-beyond-the-r92-list`;
    - `spec-5-8-pause-sentence-untouched`: run 358's suites pin it, and "reclamation" covers the collector, as README's row does.
- **H10 — single-definition appends in order.** Task 1's describe is appended at the file's foot, and Task 8's after it, never inserted above. The pace-formula scan lives ONLY in Task 4's `collect-pacing.test.ts`; Task 8 does not add a second copy.
- **H11 — the stale-answer case arms the lane through `f.touch(COLLECT_LANE_LIVE_MARKER)`**, imported from `collectLane.ts`. No obfuscated spelling of the marker appears in any test.
- **H12 — recorded only:** the flock die text is spelled in three server files (L1 cannot import L3's copy); no single-definition scan covers it.
- **H13 — the reconcile's residue, ruled.**
  - **Reader strictness (Task 2), confirmed:**
    - an absent `witness` key on ANY collectable, a resume included, is `unreadable`;
    - `WITNESS_AT_SHAPE` stays ccd's own `^[0-9]{13}$`;
    - the witness `run` reads through `CHILD_RUN_ID`.
  - **Loose labels and wordings, accepted:**
    - the `unsettled` label is `collector / calls still running` (every label holds a `/`, ruled at the plan attack: a registry id can hold a space, but no file name can hold a `/`), and the sentence carries "the act slot is held" for every act job past `CHILD_RECLAIM_STALL_MS`, its act out or not (`'act'` and `'job'` alike, H1);
    - the unsettled job's sentence names no minute count, because L1 cannot read `CHILD_RECLAIM_STALL_MS`.
  - **Task 4's die and terminal readings, accepted, each named by slug in the wave-done:**
    - `flock-unavailable-takes-no-floor`;
    - `would-collect-ends-the-die-streak`;
    - `terminal-refusal-keeps-the-refusal-floor`;
    - `terminal-failure-clears-the-deferral-count`.
  - **Task 5's own choices, accepted:** the feed-cue key spellings, the die item placed after verb-failed and before failing, the die and terminal sentence wording, "for at least" thresholds, and the runId prose pin staying in Task 5's suite.
  - **Task 6:** the `ccdargv.ts` docstring re-wrap is accepted. Mutation rows 29 to 31 are kept as one "Deleted (H4)" row, so that row 32 keeps its number.
  - **Slugs:**
    - `ws-collect-cap-entry-is-a-classification` is VOID: at Task 6's shape the entry is load-bearing, and T8.26 reds;
    - `learnCollect` not re-asserting the predicate is named `learn-collect-asks-no-id-predicate`.
  - **Task 1's re-derivation scan is widened to `[.-]`,** so a one-line private copy that tests only the dash is scanned too (the fix workflow edits Task 1).
  - **Task 7:**
    - The gather's try/catch around reads that never reject is DELETED, with T7.30 and T7.31, because a guard with no red breaks the mutation-table rule. The two rows stand as ONE `Deleted (H13)` row, so T7.32 onwards keep their numbers.
    - Lane cases are ADDED, each with a mutation row, for the pass-scoped box lines' publication (`collectPassAudits`), the `held` arm's fold (the pair cleared, and the flat `CHILD_RECLAIM_DEFER_CEILING_MS` wait before the next act), and `collectRunCcd`'s phase reset (the fix workflow adds them). The step-6 `answered presence` arm's fold is already red, through 'a presence that appears at step 6…'.
  - **The drafts' sidecar JSONs are stale and are not part of the plan.**

## Review Focus (the five failure modes most likely to bite)

1. **The lane composes `ws-collect` when it must not, or against another leaf.** Paused, shadowed, unlistable, a capability missing, an open or re-bound or absent run, a visible id, a stale answer after a reset, a dash-leading id, or a token not from the executor's own observation 2. Pinned by Task 6's step cases, Task 7's lane cases and Task 3's predicate pins.
2. **The lane wedges silently.** A slot never freed, an open tab starving every other id, an `in-progress`, `no-document` or `changed-recently` that never surfaces, or an unsettled call that holds an id with no line. Pinned by Task 7's slot and starvation cases and Task 4's continuity flags.
3. **The journal floods.** Terminal words re-audited every pass, verb refusals every few minutes, alternating probes restarting a run. Pinned by Task 4's 12-then-6 terminal count (with alternation) and the 96-a-day refusal count.
4. **An operator instruction disappears.** A leaf-kept clips clause or a kept record's sentence lost to precedence or collapse, or a box-wide line that does not render. Pinned by Task 5's precedence and rendering cases.
5. **Hostile same-uid input reaches a sentence or an argv.** A planted name, an uncut `detail` with format or tag characters, an over-long id, a flood of names. Pinned by Task 1's and Task 3's predicate and cap cases and Task 5's `detailUnsafe` class pins.

---

## File Structure

Every file this wave touches, taken from each task's own **Files** block, which stays the authority for what the task does there. Files a task merely runs are not listed.

| File | Task(s) |
|---|---|
| `shared/api.ts` | 1 (foot declarations; three line-neutral rewrites above it) |
| `server/src/ccdargv.ts` | 1 (the brand), 6 (two docstrings, line-neutral) |
| `server/src/childReclaimSweep.ts` | 1 (`leafIdOk` becomes an import), 4 (`export` on `childReclaimTierFrom`), 5 (`detailUnsafe`, the sentences, `clipsClause`, the merge) |
| `server/src/coord/store.ts` | 1 (the private cap becomes an import) |
| `server/src/collectLane.ts` (new, L1) | 2, 3, 4, 5, 7 |
| `server/src/coord/collectTempRoot.ts` (new, L3) | 6 |
| `server/src/watch.ts` | 5 (one call site), 7 (the pass) |
| `server/test/collect-l0.test.ts` (new) | 1 |
| `server/test/types/bypasses/b7-collect-token-plain-string.ts` (new) | 1 |
| `server/test/types/ok/legit-collect-token.ts` (new) | 1 |
| `server/test/ccdargv-brand.test.ts` | 1 |
| `server/test/ccdargv-dec-parity.test.ts` | 1 |
| `server/test/ws-collect-wiring.test.ts` | 1 (the cast), 6 (the INERT `it`'s two lists), 7 (`watch.ts` holder), 8 (the describe) |
| `server/test/single-definition.test.ts` | 1 (appended), 4 (`'run-open'` excused by name in the archive-door scan's `want`, in place), 6 (`coord/collectTempRoot.ts` joins that excuse, in place), 8 (appended after Task 1's) |
| `server/test/collect-readers.test.ts` (new) | 2 |
| `server/test/collect-population.test.ts` (new) | 3 |
| `server/test/collectAnswers.ts` (new) | 4 |
| `server/test/collect-licence.test.ts` (new) | 4 |
| `server/test/collect-pacing.test.ts` (new) | 4 |
| `server/test/collect-attention.test.ts` (new) | 5 |
| `server/test/collect-feed-body.test.ts` (new) | 5 |
| `server/test/child-reclaim-detail-unsafe-classes.test.ts` (new) | 5 |
| `server/test/child-reclaim-leaf-kept-prose.test.ts` (new) | 5 |
| `server/test/child-reclaim-leaf-kept.test.ts` | 5 |
| `server/test/child-reclaim-detail-text.test.ts` | 5 (one control code point) |
| `server/test/child-reclaim-verdict-readers.test.ts` | 5, 7 (census (c)) |
| `server/test/collectTempRootFixture.ts` (new) | 6 |
| `server/test/collect-temp-root.test.ts` (new) | 6 |
| `server/test/collect-temp-root-reads.test.ts` (new) | 6 |
| `server/test/collect-open-run-hold.test.ts` (new) | 6 |
| `server/test/verb-gate.test.ts` | 6 (`CAP_GATED_VERBS`), 8 (`NEW_GENERATION`, the scan) |
| `server/test/mail-routes.test.ts` | 6 (`isCollectExecutorKebab` joins the kebab scan's accept chain) |
| `server/test/collectLaneFixture.ts` (new) | 7 |
| `server/test/collect-lane-bounds.test.ts` (new) | 7 |
| `server/test/collect-lane-pass.test.ts` (new) | 7 |
| `server/test/collect-lane-slot.test.ts` (new) | 7 |
| `server/test/child-reclaim-sweep-policy.test.ts` | 8 (the defer-whys floor) |
| `server/test/child-reclaim-attention-arms.test.ts` | 8 (the census title) |
| `server/test/collect-lane-scans.test.ts` (new) | 8 |
| `server/test/collect-audit-budget.test.ts` (new) | 8 |
| `server/test/collect-lane-prose.test.ts` (new) | 9 |
| `README.md` | 9 |
| `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` | 9 |
| `docs/superpowers/programs/child-reclamation-contract.md` | 9 ("§16 as built" only) |
| `CLAUDE.md` | 9 (line 10's numeral, only if re-measured) |

## Execution order and dependencies

Task 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Each task is one commit on the workspace branch, and every commit leaves every suite it touches green (H5).

| Task | Needs | Model routing | Why this place |
|---|---|---|---|
| 0 Entry conditions | — | `sonnet`, medium | Proves waves 7 and 8 are in the tree, and the live facts §16 leans on |
| 1 L0 and the brand | 0 | `opus`, xhigh | The id predicate closes every flag redirect; every later task types against it |
| 2 The readers | 1 | `opus`, high | Total parsers over ccd's documents, pinned against ccd |
| 3 The population | 1, 2 | `opus`, xhigh | What the lane may ever name |
| 4 The licence and pacing state | 2, 3 | `opus`, xhigh | Two observations, generations, the runs and the next ask |
| 5 Attention and text | 1, 4 | `opus`, high | Never silent, no PWA edit, no instruction lost |
| 6 The executor | 2, 4 | `opus`, xhigh | The six steps and the open-run hold |
| 7 The pass | 3–6 | `opus`, xhigh | The slot, the offer, the hold-off and the unsettled lines |
| 8 Guard pins | 1–7 | `opus`, high | Single definition, verb-gate, scans and the budget |
| 9 Docs | 1–8 | `sonnet`, high | The spec, README and "§16 as built" |
| 10 Whole-branch verification and the PR | 0–9 | `sonnet`, high | The wave-done's `suite:` line |

---

### Task 0: Entry conditions

**Model routing:** `sonnet`, effort `medium`.

**Files:** none. Nothing is written by this task.

Measure from the workspace root, before Task 1. If any check does not print what it states, **STOP**: report it to the coordinator, and build nothing.

- [ ] **Step 1: Waves 7 and 8 are in the tree, and §16 binds**

```bash
git fetch origin main
git merge-base --is-ancestor origin/main HEAD; echo "a0 rc=$?"          # (a0) rc=0; if 1, run `git merge origin/main` once (never a rebase), then re-measure
grep -c '^## 16\. Rulings, 2026-10-11' docs/superpowers/programs/child-reclamation-contract.md   # (a1) 1
grep -c '^  wsCollectAudit: \|^  wsCollect: ' server/src/ccdargv.ts   # (a2) 2: wave 7's builders
grep -c "COLLECT_CAP = 'collect-v1'" server/src/ccdargv.ts            # (a3) 1
grep -c '^export function childReclaimTierPaceMs\|^function childReclaimTierFrom' server/src/childReclaimSweep.ts   # (a4) 2: wave 8's tier
grep -rn 'wsCollect' server/src --include=*.ts | grep -v ccdargv.ts | wc -l   # (a5) 0: no composer yet
```

- [ ] **Step 2: The live facts §16 leans on (read-only; counts and names, never contents)**

```bash
ls ~/.cc-sessions/tmproots 2>/dev/null | wc -l                         # (b1) the witness count (9 at the pre-flight)
ls -d ~/.cc-sessions/tmpquarantine 2>/dev/null || echo absent          # (b2) absent at the pre-flight
ls ~/.cc-sessions/tmproots 2>/dev/null | grep -c '^[-.]'               # (b3) 0: no dot- or dash-leading name
grep -n 'sessionId' pwa/src/fleet/ChildReclaimBanner.tsx | head        # (b4) how the banner renders sessionId (text, or a link): R88's box-wide labels must render as plain text
grep -n '^_ws_project_valid\|^_ws_tmproot_id_ok' ccd/ccd               # (b5) the two shape rules; record whether ws-add can mint a dash-leading id
```

Record (b1) to (b5) in the SDD ledger. (b4) decides nothing by itself: if the banner links `sessionId`, STOP and report, because a fixed label would render as a broken link.

- [ ] **Step 3: The open-run hold's day-one state (R86, read-only)**

For each witness name from (b1), read ONLY its `run=` and `at=` fields and look the run up through `~/.local/bin/ccrc-api runs list` (and `--closed`). Record, per id: the run's state, whether it is absent, and whether it opened after the witness's `at` plus 120 s. Never print anything else from the witness file. Ids that hold from day one are expected and safe; the record tells the coordinator what the shadow checklist will show.

- [ ] **Step 4: Overlaps (R91)**

```bash
~/.local/bin/ccrc-api claims list --project ccrc-pwa                                  # no live claim on a path this wave edits, or the coordinator's recorded agreement in the brief
git grep -q 'rereadDeadCoordinatorJournalTrust' origin/main -- server/src/watch.ts && echo "WL wave 6 landed" || echo "WL wave 6 not landed"   # if not landed, its watch.ts and README regions (R91) are off-limits. A CONTENT probe: main's own docs(plan) commit cc33c8d51 matches 'workspace lifecycle wave 6', so a log grep says landed too early
```

---

### Task 1: L0 for the collector's lane: the one temp-root id predicate, `CollectToken` and the `wsCollect` brand, the collector's attention arms, and the box-wide labels

**Model routing:** `opus`, effort `xhigh`. This is a SAFETY task. `isTmpRootId`'s leading-`-` clause is what closes every flag redirect into a destructive verb (R83). `CollectToken` is what keeps any string but observation 2's token out of `ws-collect`'s argv (R85). Every red, count and green below is a prediction made at planning on the read-only export of `d0c2b7803`, and none was measured. Measure each one. A different count is not a departure, but a different *kind* of failure is: report it by slug.

**Why:**
- **R83, the predicate.** ONE exported L0 predicate decides a temp-root id: `isSessionIdShape(id) && !id.startsWith('.') && !id.startsWith('-') && id.length <= 255`.
  - It is wave 8's private `leafIdOk` (`server/src/childReclaimSweep.ts:1643`), lifted and widened.
  - Its cap is the bound `store.ts`'s private `CHILD_RECLAIM_MAX_SESSION_ID_CHARS` (`:1493`) already names. Both become imports, which closes `line-bound-is-ccds-not-the-mirrors` (R90).
  - Wave 8's kept-leaf reader takes the same predicate. That is a display-only change: a dash-leading or over-long kept-leaf id is no longer listed.
  - single-definition holds the predicate's one definer.
  - The pins named in R83 are `--actor`, `--surface`, `--reason`, `--expect`, `--session`, `--`, `-h`, `-x` and a 256-character id, all refused, with `a--actor` and `a.--actor` accepted. THIS task pins the predicate's answers. The "compose no argv, audit or act" halves are pinned where the lane composes: Task 3 (the population) and Task 6 (the executor's step 1).
- **R85, the brand.** `CollectToken` is declared at `shared/api.ts`'s foot, so `ccdargv.ts` imports nothing from a lane file. `wsCollect` takes it, so tsc refuses a plain string, and a fixture pins `wsCollect(<string>)` as a compile error.
  - In the same commit, the existing plain-string calls get a test-only cast, ONCE at each file's token declaration (H1): `ws-collect-wiring.test.ts`'s `const TOKEN = 'a'.repeat(64) as CollectToken;` (`:15`), which leaves its three calls byte for byte, and `ccdargv-dec-parity.test.ts:161`'s literal, `'a'.repeat(64) as CollectToken`.
  - The final §16 cites those calls as `ws-collect-wiring.test.ts:25-26` and `:39`, and `ccdargv-dec-parity.test.ts:161`, which is where they stand at `d0c2b7803`: no drift (Step 1).
  - No fixture claims the other direction. A brand is assignable to `string` (R85, measured), so it does not keep a `CollectToken` out of `wsReclaim` or `wsExpire`.
- **R88, the attention arm.** The collector's attention arm is declared at the foot. The union's last-arm line is rewritten in place, line-neutral.
  - The arm carries `runId` (the audit's `collect.witness.run`, or null) and NO `at`.
  - `attention-runid-sentence-misses-leaf-arms` is fixed in the same commit, line-neutrally (`shared/api.ts:3832-3834`). Task 1's three lines are the canonical text (H3): Task 5 rewrites neither them nor the doc pair, and its prose pin reads Task 1's lines verbatim.
  - A box-wide line's `sessionId` is a fixed label holding a `/`, which no file name under `$REG` (so no registry id) and no session id's shape can carry. A space is not enough: a reclaim item's id is read from any `$REG/<x>.uuid` name with no shape filter (R90 defers that), so a same-uid session could plant a registry id equal to a label that holds only a space. The labels are spelled once, in a total table (`COLLECT_BOX_LABELS`).
  - A collapsed per-id collector line is a `kept-many` whose word no other line uses. Its arm, `ChildReclaimCollectMany`, is declared here too, so the union line is rewritten once (`collect-many-arm-declared`, accepted, H3). Its word begins `collect:` (`` `collect:${string}` ``, H3); Task 5 spells that prefix once in L1 as `CHILD_RECLAIM_COLLECT_MANY_PREFIX`.
- **R91.** `shared/api.ts` is edited only at its foot, plus line-neutral in-place rewrites above it. README cites the file by line at `:7878-7880`, `:7930`, `:7938` and `:7951`, all BELOW this task's three in-place edits (`:3797-3798`, `:3832-3834`, `:3856`). Step 6 proves the bytes README cites are unchanged.
- **The doc pair.** The pair at `:3797-3798` says "the three this file's foot declares". The collector makes that five, so it is rewritten line for line. R91 does not list this rewrite; it is named by slug `attention-doc-pair-counts-the-collector` (accepted, H9).
- **What the banner does with a label (R88's Task 0 read, done at planning).** `pwa/src/fleet/ChildReclaimBanner.tsx:148-150` keys a single line by `a.sessionId` (`<li key={a.sessionId}`) and renders the label as plain text in a `<span>`. So a label renders as plain text, and no two box-wide lines may share one.

**Files:**
- Modify: `shared/api.ts`:
  - three in-place, line-for-line edits inside `ChildReclaimAttention`'s docstring and union: the doc pair (`:3797-3798`), the `runId` sentence (`:3832-3834`) and the last arm's line (`:3856`);
  - one block appended after the file's last line (`}`, closing `leafKeptWord`, `:9673`).
- Modify: `server/src/ccdargv.ts`: the `../../shared/api.js` import (`:2`), and `wsCollect`'s docstring and first parameter (`:452-458`).
- Modify: `server/src/childReclaimSweep.ts`: the import (`:15`), `leafIdOk` deleted (`:1642-1643`), the docstring of `childReclaimLeafKept` (`:1656-1663`) and its one call (`:1677`).
- Modify: `server/src/coord/store.ts`: the import (`:79`), the private cap (`:1493`) and its five other mentions (`:1478`, `:1501`, `:1515`, `:1525`, `:3430`).
- Modify: `server/test/ws-collect-wiring.test.ts` (one import line, and the ONE cast at its `TOKEN` declaration, `:15`; the calls at `:25-26` and `:39` are untouched, H1).
- Modify: `server/test/ccdargv-dec-parity.test.ts` (the cast at `:161`, and one import line).
- Modify: `server/test/ccdargv-brand.test.ts` (one `EXPECTED` entry).
- Create: `server/test/types/bypasses/b7-collect-token-plain-string.ts` (MUST NOT compile).
- Create: `server/test/types/ok/legit-collect-token.ts` (MUST compile).
- Test (new): `server/test/collect-l0.test.ts`
- Modify: `server/test/single-definition.test.ts`, with ONE describe APPENDED after the file's last line. Task 8 appends its own blocks after this one.
- Nothing else. There is no README edit. There is no PWA or agent edit: Step 5 runs the PWA's `tsc` to prove none is owed.

**Interfaces:**
- Consumes (at `d0c2b7803`):
  - `isSessionIdShape(s: string): boolean`, `shared/api.ts:6229` (`grep -n "^export function isSessionIdShape" shared/api.ts`);
  - `ChildReclaimAttention`, `:3848` (`grep -n "^export type ChildReclaimAttention =" shared/api.ts`), and `ChildReclaimKeptMember`, `:3792`;
  - `CHILD_RECLAIM_KEPT_WORDS`, `:3785`;
  - `childReclaimLeafKept(i: { rows; ends; nowMs }): ChildReclaimLeafKept[]`, `server/src/childReclaimSweep.ts:1669` (`grep -n "^export function childReclaimLeafKept(" server/src/childReclaimSweep.ts`), and `ChildReclaimLeafSourceRow`, `:1542`;
  - `reviveMeas(v: unknown): LifecycleMeas | null`, `server/src/coord/journalparse.ts:192`;
  - `CCD_ARGV.wsCollect`, `server/src/ccdargv.ts:457` (`grep -n "wsCollect: (token: string" server/src/ccdargv.ts`);
  - on the test side: `stallCode`, `ALL`, `rel` and `ccrcRoot` (`server/test/single-definition.test.ts:4096`, `:63`, `:64`, `:32`), and the bypass harness (`server/test/ccdargv-brand.test.ts`'s `EXPECTED` and `codesFor`).
- Produces (exact, all in `shared/api.ts`'s foot, L0, importing nothing):
  ```ts
  export const TMPROOT_ID_MAX_CHARS = 255;
  export function isTmpRootId(id: unknown): id is string;
  //   typeof id === 'string' && id.length <= 255 && isSessionIdShape(id) && !id.startsWith('.') && !id.startsWith('-')
  declare const collectTokenBrand: unique symbol;
  export type CollectToken = string & { readonly [collectTokenBrand]: true };
  export interface ChildReclaimCollectAttention {
    readonly kind: 'collect'; readonly sessionId: string; readonly runId: number | null;
    readonly word: string; readonly sentence: string;
  }
  export interface ChildReclaimCollectMany {
    readonly kind: 'kept-many'; readonly word: `collect:${string}`;
    readonly members: readonly ChildReclaimKeptMember[]; readonly sentence: string;
  }
  // ChildReclaimAttention = …its seven arms… | ChildReclaimCollectAttention | ChildReclaimCollectMany
  export const COLLECT_BOX_LABELS: {
    readonly tmproots: '~/.cc-sessions/tmproots'; readonly tmpquarantine: '~/.cc-sessions/tmpquarantine';
    readonly 'refused-names': 'unusable names under ~/.cc-sessions'; readonly 'box-probe': 'collector / the fleet box';
    readonly 'no-document': 'collector / audits that printed nothing'; readonly lock: 'collector / temp-root reap locks';
    readonly flock: 'collector / flock on the fleet box'; readonly unsettled: 'collector / calls still running';
    readonly unvouched: 'collector / temp roots coord.db cannot vouch for'; readonly 'no-run': 'collector / temp roots with no run';
  };
  export type CollectBoxLine = keyof typeof COLLECT_BOX_LABELS;
  export const COLLECT_BOX_LINES: readonly CollectBoxLine[];
  ```
  In `server/src/ccdargv.ts`:
  ```ts
  wsCollect: (token: CollectToken, id: string, dec: ActorFlags | null) => CcdArgv
  ```
- **What each line label is for (Tasks 3, 5 and 7 use these keys; R88's list):**
  - `tmproots` and `tmpquarantine`: that listing is unmeasured or over the cap (Task 3's `CollectListingDoubt`).
  - `refused-names`: the count of refused names.
  - `box-probe`: a box-wide probe class. It clears on any answer that passed every rung (`box-probe-line-clears-on-a-passing-answer`, H8).
  - `no-document`: the audit's no-document line.
  - `lock`: the line for two or more ids answering `lock`.
  - `flock`: the `flock-unavailable` latch.
  - `unsettled`: ONE line for every learning audit, or executor audit, past `COLLECT_AUDIT_STALL_MS`, and every executor JOB not settled `CHILD_RECLAIM_STALL_MS` after it took the slot, whose clause says the act slot is held. The job's bound is checked first, so a job whose own audit or act never settles is listed as holding the slot, `'act'` and `'job'` alike (H1, R85).
  - `unvouched`: ids held by R86 (b) or (c), once held past the hold's ceiling (`unvouched-line-waits-the-ceiling`, H8).
  - `no-run`: the ONE count line for run-less items past `CHILD_RECLAIM_KEPT_MANY_OVER`, with one clause per word (`no-run-lines-share-one-label`, H8). There is no per-word label.

- [ ] **Step 1: Re-measure the anchors (read-only)**

```bash
grep -n "costs disk rather than correctness. The four arms below and the three this file's foot declares (stuck, and" shared/api.ts   # one line (3797)
grep -n '^ \*  switch. `runId` is the minting run the registry marker names, or null when$' shared/api.ts                           # one line (3832)
grep -n "readonly sentence: string } | ChildReclaimStuckAttention | ChildReclaimLeafKeptAttention | ChildReclaimLeafKeptMany;$" shared/api.ts   # one line (3856)
tail -n 1 shared/api.ts                                                       # }
grep -rn "isTmpRootId\|TMPROOT_ID_MAX_CHARS\|CollectToken\|COLLECT_BOX_LABELS\|ChildReclaimCollect" shared server/src pwa/src agent/src   # nothing
grep -n "^const leafIdOk = " server/src/childReclaimSweep.ts                 # one line (1643)
grep -n "isSessionIdShape" server/src/childReclaimSweep.ts                   # 15 (import), 1643, 1659 (docstring)
grep -n "^const CHILD_RECLAIM_MAX_SESSION_ID_CHARS = 255;$" server/src/coord/store.ts   # one line (1493)
grep -c "CHILD_RECLAIM_MAX_SESSION_ID_CHARS" server/src/coord/store.ts       # 6
grep -n "^  IDLE_RUN_STATES, transitionsFor, TERMINAL_DELIVERY_STATES, TERMINAL_RUN_STATES,$" server/src/coord/store.ts   # one line (79)
grep -n "wsCollect: (token: string, id: string, dec: ActorFlags | null) =>" server/src/ccdargv.ts   # one line (457)
grep -n "CCD_ARGV.wsCollect(" server/test/*.ts                               # ws-collect-wiring :25 :26 :39; ccdargv-dec-parity :161
grep -n "^const TOKEN = 'a'.repeat(64);$" server/test/ws-collect-wiring.test.ts   # one line (15): the file's one token declaration, cast once (H1)
grep -n "key={a.sessionId}" pwa/src/fleet/ChildReclaimBanner.tsx             # one line (148): a single line is keyed by sessionId
grep -n 'shared/api\.ts:[0-9]' README.md                                     # one line (4908), naming :7878-7880; then :7930 :7938 :7951
ls server/test/types/bypasses/                                               # b1..b6 only
```

STOP rules:
- **Any declaration already exists** (the fifth grep prints a line). Another wave declared it. Report `collect-l0-owned-elsewhere`, and build nothing on it.
- **The README anchors moved above `:3856`.** If any README `shared/api.ts` anchor now lies at or above `:3856`, an in-place edit here could touch cited bytes. STOP and report `readme-anchor-above-the-union`.
- **Any other count differs.** Report it by slug, and re-point by content, never by line.
- **The wiring test's calls are on `:25-26` and `:39`, and its `TOKEN` on `:15`.** The final §16 cites `:25-26` and `:39` (H1), so nothing drifted. If a line moved, the edit is by content: this is not a departure.

- [ ] **Step 2: Write the failing tests and the two type fixtures**

Create `server/test/collect-l0.test.ts`:

```ts
// Child reclamation wave 9 (spec §5.9, §5.10): the L0 the temp-root collector's server lane adds.
// - `isTmpRootId` is the ONE predicate of a temp-root id. It gates every argv the lane composes, and wave 8's
//   kept-leaf reader asks it before it names a leaf.
// - `CollectToken` is the only type `ws-collect`'s builder takes.
// - The collector's two attention arms join `ChildReclaimAttention`.
// - `COLLECT_BOX_LABELS` names each box-wide line with a label no session id can equal.
// Only declarations are here, plus the kept-leaf reader's display-only change. The lane's own pins live where it
// composes (Tasks 3 and 6). The type cases are compile-time facts, so `typecheck-tests.test.ts` is half of this file.
import { describe, it, expect } from 'vitest';
import {
  CHILD_RECLAIM_KEPT_WORDS, COLLECT_BOX_LABELS, COLLECT_BOX_LINES, TMPROOT_ID_MAX_CHARS, isSessionIdShape, isTmpRootId,
  type ChildReclaimAttention, type CollectToken, type LifecycleOutcome,
} from '../../shared/api.js';
import { reviveMeas } from '../src/coord/journalparse.js';
import { childReclaimLeafKept, type ChildReclaimLeafSourceRow } from '../src/childReclaimSweep.js';

const NOW = 1_790_000_000_000;
const DAY = 86_400_000;

describe('isTmpRootId — the one predicate of a temp-root id (spec §5.10)', () => {
  it('its cap is 255 characters, one file name component', () => {
    expect(TMPROOT_ID_MAX_CHARS).toBe(255);
  });

  // ccd's destructive verbs read their decision flags from any position, `--session`'s value included. Every such
  // flag begins `--`, so an id that begins `-` could be read as one.
  it.each(['--actor', '--surface', '--reason', '--expect', '--session', '--', '-h', '-x'])(
    'a dash-leading id %j is refused, so no argv can carry it as a flag', (id) => {
      expect(isTmpRootId(id)).toBe(false);
    });

  it.each<readonly [string, unknown, boolean]>([
    ['an ordinary child id', 'demo-quiet-mesa', true],
    ['a nested id with dots', 'demo.quiet.mesa', true],
    ['dashes inside', 'a--actor', true],
    ['a dot, then dashes', 'a.--actor', true],
    ['exactly 255 characters', 'a'.repeat(255), true],
    ['256 characters', 'a'.repeat(256), false],
    ['a flag with its value (the shape refuses =)', '--actor=x', false],
    ['.', '.', false],
    ['..', '..', false],
    ['a dot-leading name', '.hidden', false],
    ['the empty string', '', false],
    ['a space', 'demo gone', false],
    ['a slash', 'x/../y', false],
    ['a trailing newline', 'demo\n', false],
    ['null', null, false],
    ['a number', 3, false],
    ['undefined', undefined, false],
    ['an object', {}, false],
  ])('%s -> %s', (_what, id, ok) => {
    expect(isTmpRootId(id)).toBe(ok);
  });

  it('narrows an unknown to a string', () => {
    const v: unknown = 'demo-quiet-mesa';
    expect(isTmpRootId(v) ? v.length : -1).toBe(15);
  });
});

let mid = 1000;
/** A `reclaim` `done` row that kept the temp root, for `id`: the shape wave 8's kept-leaf reader lists. */
const keptRow = (sessionId: string): ChildReclaimLeafSourceRow => ({
  id: (mid += 1), sessionId, at: NOW - DAY, outcome: 'done' as LifecycleOutcome, refusal: null, truncated: false,
  meas: reviveMeas({ childOf: '41', tmpRootKept: 'in-use' }), detail: null,
});
const listed = (ids: readonly string[]): string[] =>
  childReclaimLeafKept({ rows: ids.map(keptRow), ends: new Map(), nowMs: NOW }).map((k) => k.item.sessionId).sort();

describe('wave 8’s kept-leaf reader asks the same predicate: a display-only change (spec §5.9)', () => {
  it('a dash-leading or over-long id is not listed, so no feed row is written for it', () => {
    expect(listed(['--actor', '-x', '--', 'a'.repeat(256)])).toEqual([]);
  });

  it('every id it listed before still lists: dashes inside, a dot then dashes, 255 characters', () => {
    const ids = ['a--actor', 'a.--actor', 'a'.repeat(255), 'demo-gone'];
    expect(listed(ids)).toEqual([...ids].sort());
  });
});

describe('CollectToken — the one type ws-collect’s builder takes (spec §5.10)', () => {
  it('is a string underneath, and a plain string is not one', () => {
    const minted = 'b'.repeat(64) as CollectToken; // a test-only cast: the shipped tree's one cast is parseCollectAudit's
    const plain: string = minted;
    // @ts-expect-error a plain string is not a CollectToken
    const forged: CollectToken = 'b'.repeat(64);
    expect([plain, forged]).toEqual(['b'.repeat(64), 'b'.repeat(64)]);
  });
});

describe('the collector’s ChildReclaimAttention arms (spec §5.9)', () => {
  it('a per-id item and a box-wide line are members of the union, and neither carries an at', () => {
    const one: ChildReclaimAttention = { kind: 'collect', sessionId: 'demo-quiet-mesa', runId: 41, word: 'in-use', sentence: 's' };
    const box: ChildReclaimAttention = { kind: 'collect', sessionId: COLLECT_BOX_LABELS['box-probe'], runId: null, word: 'box-probe', sentence: 's' };
    // @ts-expect-error the collector's item is built from the server's memory, so it carries no ccd clock
    const dated: ChildReclaimAttention = { kind: 'collect', sessionId: 'x', runId: null, word: 'w', sentence: 's', at: 1 };
    expect([one.kind, box.kind, dated.kind]).toEqual(['collect', 'collect', 'collect']);
  });

  it('a collapsed collector line is a kept-many whose word no other collapsed line uses', () => {
    const many: ChildReclaimAttention = {
      kind: 'kept-many', word: 'collect:in-use', members: [{ sessionId: 'demo-a', runId: 1 }], sentence: 's',
    };
    expect(many.kind).toBe('kept-many');
    // The banner keys a collapsed line by `kept-many <word>`: no kept word, and not the kept leaves' word, may share it.
    for (const w of [...CHILD_RECLAIM_KEPT_WORDS, 'leaf-kept']) expect(w.startsWith('collect:'), w).toBe(false);
  });
});

describe('COLLECT_BOX_LABELS — the box-wide lines’ fixed sessionIds (spec §5.9)', () => {
  it('the lines are the table’s keys, derived, ten of them', () => {
    expect([...COLLECT_BOX_LINES].sort()).toEqual(Object.keys(COLLECT_BOX_LABELS).sort());
    expect(COLLECT_BOX_LINES).toHaveLength(10);
  });

  it.each(Object.keys(COLLECT_BOX_LABELS))('%s: holds a slash, which no registry file name can carry, so no session id and no temp-root id equals it', (line) => {
    const label = COLLECT_BOX_LABELS[line as keyof typeof COLLECT_BOX_LABELS];
    expect(label).toMatch(/\//);
    expect(isSessionIdShape(label)).toBe(false);
    expect(isTmpRootId(label)).toBe(false);
  });

  it('no two lines share a label, because the banner keys a single line by its sessionId', () => {
    expect(new Set(Object.values(COLLECT_BOX_LABELS)).size).toBe(COLLECT_BOX_LINES.length);
  });

  it('each listing is named by its path, and the box-wide probe line by the box', () => {
    expect(COLLECT_BOX_LABELS.tmproots).toBe('~/.cc-sessions/tmproots');
    expect(COLLECT_BOX_LABELS.tmpquarantine).toBe('~/.cc-sessions/tmpquarantine');
    expect(COLLECT_BOX_LABELS['box-probe']).toBe('collector / the fleet box');
  });
});
```

Create `server/test/types/bypasses/b7-collect-token-plain-string.ts`:

```ts
// CHILD RECLAMATION WAVE 9 (spec 2026-09-22 §5.10): `ws-collect`'s confirmation token is a `CollectToken`, and the
// collect audit's reader is the shipped tree's one cast to it. A token from anywhere else is a plain string, and a
// plain string does not compile into `ws-collect`'s argv.
//
// This file MUST NOT compile. `ccdargv-brand.test.ts` asserts the exact error.
import { CCD_ARGV } from '../../../src/ccdargv.js';

declare const token: string;

void CCD_ARGV.wsCollect(token, 'demo-quiet-mesa', null);
```

Create `server/test/types/ok/legit-collect-token.ts`:

```ts
// CHILD RECLAMATION WAVE 9 (spec 2026-09-22 §5.10): the positive control for bypass b7. A `CollectToken` compiles
// into `ws-collect`'s argv, so b7's error is the brand's and not a broken builder. This file MUST compile clean.
import { CCD_ARGV } from '../../../src/ccdargv.js';
import type { CollectToken } from '../../../../shared/api.js';

declare const token: CollectToken;

void CCD_ARGV.wsCollect(token, 'demo-quiet-mesa', null);
```

In `server/test/ccdargv-brand.test.ts`, add one entry after `'b6-no-run-on-deps.ts'`'s line inside `EXPECTED`:

```ts
  'b7-collect-token-plain-string.ts': { what: "a plain string as ws-collect's token (spec §5.10)", codes: ['TS2345'] },
```

Append to `server/test/single-definition.test.ts`, after its last line, preceded by one empty line:

```ts
// CHILD RECLAMATION WAVE 9 (spec 2026-09-22 §5.10): the temp-root id predicate and its cap are ONE L0 function and ONE
// L0 constant. This block is APPENDED for the reason the blocks above state: `session-hook.test.ts`'s citation audit
// cites this file by line. Before this wave the kept-leaf reader held a private copy (`leafIdOk`) and the store a
// private cap (`CHILD_RECLAIM_MAX_SESSION_ID_CHARS`). A third copy is how the dash and length clauses would be lost
// again, so it reds here.
describe('child reclamation wave 9: the temp-root id predicate and its cap are defined once, in shared/api.ts', () => {
  const DEF_FN = (n: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?function\\s+${n}\\b`, 'm');
  const DEF_VAL = (n: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${n}\\b`, 'm');
  const definers = (re: RegExp): string[] => ALL.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel).sort();
  /** The session-id shape and a leading-dot or leading-dash test on one code line: a re-derived predicate under a new name. */
  const REDERIVED = /\bisSessionIdShape\s*\(.*startsWith\(\s*['"][.-]['"]\s*\)|startsWith\(\s*['"][.-]['"]\s*\).*\bisSessionIdShape\s*\(/;

  it('CONTROL: the patterns see a declaration, an un-exported copy and a re-derivation, and not an import or a call', () => {
    expect(DEF_FN('isTmpRootId').test('export function isTmpRootId(id: unknown): id is string {')).toBe(true);
    expect(DEF_VAL('leafIdOk').test('const leafIdOk = (id: string): boolean => isTmpRootId(id);')).toBe(true);
    expect(DEF_VAL('TMPROOT_ID_MAX_CHARS').test("import { TMPROOT_ID_MAX_CHARS } from '../../../shared/api.js';")).toBe(false);
    expect(DEF_FN('isTmpRootId').test('  if (!isTmpRootId(id)) return;')).toBe(false);
    expect(REDERIVED.test("const ok = (id: string): boolean => isSessionIdShape(id) && !id.startsWith('.');")).toBe(true);
    expect(REDERIVED.test("const ok = (id: string): boolean => isSessionIdShape(id) && !id.startsWith('-');")).toBe(true);
    expect(REDERIVED.test('if (!isSessionIdShape(sid)) {')).toBe(false);
  });

  it('isTmpRootId and TMPROOT_ID_MAX_CHARS are declared in shared/api.ts and nowhere else', () => {
    expect(definers(DEF_FN('isTmpRootId'))).toEqual(['shared/api.ts']);
    expect(definers(DEF_VAL('isTmpRootId'))).toEqual([]);
    expect(definers(DEF_VAL('TMPROOT_ID_MAX_CHARS'))).toEqual(['shared/api.ts']);
  });

  it('the two private copies are gone, and the two files that held them use the L0 names', () => {
    expect(definers(DEF_VAL('leafIdOk')), 'leafIdOk').toEqual([]);
    expect(definers(DEF_VAL('CHILD_RECLAIM_MAX_SESSION_ID_CHARS')), 'the store cap').toEqual([]);
    expect(stallCode(path.join(ccrcRoot, 'server/src/childReclaimSweep.ts'))).toMatch(/\bisTmpRootId\s*\(/);
    expect(stallCode(path.join(ccrcRoot, 'server/src/coord/store.ts'))).toMatch(/\bTMPROOT_ID_MAX_CHARS\b/);
  });

  it('no code line outside shared/api.ts re-derives it from the session-id shape and a leading-dot or leading-dash test', () => {
    expect(ALL.filter((f) => rel(f) !== 'shared/api.ts' && stallCode(f).split('\n').some((l) => REDERIVED.test(l)))
      .map(rel)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-l0.test.ts test/ccdargv-brand.test.ts
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'child reclamation wave 9'
cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json 2>&1 | grep 'collect-l0'
```

Expected: FAIL. vitest resolves a missing named export to `undefined`, so:
- `collect-l0.test.ts`:
  - the cap case fails `expected undefined to be 255`;
  - every predicate row fails `TypeError: isTmpRootId is not a function`;
  - the kept-leaf case "a dash-leading or over-long id is not listed" fails `expected [ '--', '--actor', '-x' ] to deeply equal []`. The 256-character id is already dropped by nothing, so expect it in the list too: re-measure;
  - the label cases fail `TypeError: Cannot convert undefined or null to object`, or `COLLECT_BOX_LINES` is undefined;
  - the two attention and CollectToken cases pass at run time, because they are compile-time facts.
- `ccdargv-brand.test.ts`:
  - `has an expectation for every fixture on disk` passes, since both sides gained b7;
  - `b7-collect-token-plain-string.ts` fails `expected [] to deeply equal [ 'TS2345' ]`, because `wsCollect` still takes `string`;
  - `the legitimate call site compiles clean` fails, because `legit-collect-token.ts` reports TS2305 (`no exported member 'CollectToken'`).
- single-definition:
  - the CONTROL case passes;
  - the declaration case fails `expected [] to deeply equal [ 'shared/api.ts' ]`;
  - the private-copies case fails `leafIdOk: expected [ 'server/src/childReclaimSweep.ts' ] to deeply equal []`;
  - the re-derivation case fails `expected [ 'server/src/childReclaimSweep.ts' ] to deeply equal []`.
- The test `tsc` reports `collect-l0.test.ts`:
  - TS2305 on `COLLECT_BOX_LABELS`, `COLLECT_BOX_LINES`, `TMPROOT_ID_MAX_CHARS`, `isTmpRootId` and `CollectToken`;
  - TS2322 on `kind: 'collect'` (not in the union);
  - TS2322 on the `'collect:in-use'` word;
  - TS2578 `Unused '@ts-expect-error' directive` on the dated item, since the arm does not exist yet. Count them; the exact number is not pinned.

- [ ] **Step 4: Write the declarations, the brand, and the two imports**

(a) In `shared/api.ts`, inside `ChildReclaimAttention`'s docstring, replace the doc pair (`:3797-3798`), two lines for two (slug `attention-doc-pair-counts-the-collector`):

```ts
 *  costs disk rather than correctness. The four arms below and the three this file's foot declares (stuck, and
 *  kept leaves) are told apart by `kind`, save the two that share `kept-many`, which only `word` tells apart:
```

with:

```ts
 *  costs disk rather than correctness. The four arms below and the five this file's foot declares (stuck, kept
 *  leaves, the collector's) are told apart by `kind`, save the three that share `kept-many`, which only `word` tells apart:
```

(b) Replace the `runId` sentence (`:3832-3834`), three lines for three (R88, `attention-runid-sentence-misses-leaf-arms`):

```ts
 *  switch. `runId` is the minting run the registry marker names, or null when
 *  the marker no longer reads as a child (a `kept` item's `runId` is never
 *  null).
```

with:

```ts
 *  switch. `runId` is the run the item's own evidence names, else null: the registry marker's minting run on
 *  `terminal`, `failing`, `stuck` and `kept` (never null on `kept`), the journal line's `meas.childOf` on
 *  `leaf-kept`, and the collect audit's `collect.witness.run` on `collect`; a box-wide `collect` line has none.
```

(c) Replace the union's last line (`:3856`), in place, one for one:

```ts
      readonly members: readonly ChildReclaimKeptMember[]; readonly sentence: string } | ChildReclaimStuckAttention | ChildReclaimLeafKeptAttention | ChildReclaimLeafKeptMany;
```

with:

```ts
      readonly members: readonly ChildReclaimKeptMember[]; readonly sentence: string } | ChildReclaimStuckAttention | ChildReclaimLeafKeptAttention | ChildReclaimLeafKeptMany | ChildReclaimCollectAttention | ChildReclaimCollectMany;
```

(d) Append after the file's last line (`}`, closing `leafKeptWord`), preceded by one empty line:

```ts
/* ── child-workspace reclamation: the temp-root collector's server lane (wave 9, spec §5.9, §5.10) ───────────────
 * APPENDED at the foot for wave 8's reason above: README and the frozen spec and plan corpus cite this file by line.
 * The three edits above (`ChildReclaimAttention`'s doc line pair, its `runId` sentence and its last arm's line) are
 * rewritten in place, line for line. */

/** The longest temp-root id (spec §5.10): 255 characters.
 *  - A session id is a FILE NAME component (`$REG/<id>.uuid`, `$REG/tmproots/<id>`), and no file system this runs on
 *    takes a component over 255 bytes. The session-id shape is ASCII, so a character is a byte.
 *  - ccd's own names run out sooner: `.reap-<id>.lock` past 244, and a slot's or a record's name sooner still (spec §7).
 *  - The coordination store's displacement parsers bound a candidate id by it too. */
export const TMPROOT_ID_MAX_CHARS = 255;

/** THE ONE PREDICATE of a temp-root id (spec §5.10): ccd's `_ws_tmproot_id_ok` (a session id's shape, no leading
 *  `.`), plus NO LEADING `-` and at most `TMPROOT_ID_MAX_CHARS` characters.
 *  - The leading `-` is a SAFETY rule, not defence in depth. ccd's destructive verbs read their decision flags from any
 *    position, `--session`'s value included, and every such flag begins `--`. The shape refuses `=`, so no
 *    `--flag=value` can be an id either.
 *  - The collector asks it of every listed name before any argv, and again of a job's id before its audit or its act.
 *  - The kept-leaf reader asks it before it names a leaf, so an id the collector never audits is not listed there
 *    either.
 *  - A non-string is not an id. The length is asked first, so a long string never reaches the shape's regex. */
export function isTmpRootId(id: unknown): id is string {
  return typeof id === 'string' && id.length <= TMPROOT_ID_MAX_CHARS && isSessionIdShape(id)
    && !id.startsWith('.') && !id.startsWith('-');
}

declare const collectTokenBrand: unique symbol;
/** The consent `ws-collect` spends (spec §5.10): a `ws-audit --collect` token, 64 lowercase hex characters.
 *  - The brand is PHANTOM, so it costs nothing at run time.
 *  - The shipped tree's one cast to it is the collect audit's reader (`parseCollectAudit`, `server/src/collectLane.ts`).
 *  - `CCD_ARGV.wsCollect` takes nothing else, so a token from anywhere else does not compile into that argv.
 *  - It is a `string` underneath, so it is assignable to one. It does not keep itself out of another builder's
 *    string parameter. */
export type CollectToken = string & { readonly [collectTokenBrand]: true };

/** One arm of `ChildReclaimAttention` (spec §5.9, §5.10): an item of the temp-root collector's.
 *  - `sessionId` is the temp-root id on a per-id item. On a box-wide line it is a `COLLECT_BOX_LABELS` label, which no
 *    session id can equal.
 *  - `word` is the collector's word for the line, beside the sentence, for a maintainer's grep and never for a
 *    renderer's switch.
 *  - `runId` is the latest collect audit's `collect.witness.run`, or null: a quarantine record's run is not on the wire,
 *    and a box-wide line has none.
 *  - It carries no `at`. The item is built from the server's memory, which holds no ccd clock. */
export interface ChildReclaimCollectAttention {
  readonly kind: 'collect'; readonly sessionId: string; readonly runId: number | null;
  readonly word: string; readonly sentence: string;
}

/** One arm of `ChildReclaimAttention` (spec §5.9): many per-id collector items collapsed into one line, whose
 *  sentence states the count.
 *  - It has `kept-many`'s shape and member type, so the PWA's one reader renders it unchanged.
 *  - Its word begins `collect:`, which no `ChildReclaimKeptWord` and not `'leaf-kept'` does. The PWA keys a collapsed
 *    line by its word.
 *  - A member needs a number `runId`. A collector item with no run never joins one. */
export interface ChildReclaimCollectMany {
  readonly kind: 'kept-many'; readonly word: `collect:${string}`;
  readonly members: readonly ChildReclaimKeptMember[]; readonly sentence: string;
}

/** The fixed `sessionId` of each BOX-WIDE collector line (spec §5.9, §5.10): one line per condition, never one per id.
 *  - Each label holds a `/`, which no file name under $REG (so no registry id) and no session id's shape can carry.
 *  - Each is distinct, because the banner keys a single line by its `sessionId`.
 *  - The labels are spelled once, in this total table, and the list of lines is derived. */
export const COLLECT_BOX_LABELS = {
  tmproots: '~/.cc-sessions/tmproots',
  tmpquarantine: '~/.cc-sessions/tmpquarantine',
  'refused-names': 'unusable names under ~/.cc-sessions',
  'box-probe': 'collector / the fleet box',
  'no-document': 'collector / audits that printed nothing',
  lock: 'collector / temp-root reap locks',
  flock: 'collector / flock on the fleet box',
  unsettled: 'collector / calls still running',
  unvouched: 'collector / temp roots coord.db cannot vouch for',
  'no-run': 'collector / temp roots with no run',
} as const;
export type CollectBoxLine = keyof typeof COLLECT_BOX_LABELS;
export const COLLECT_BOX_LINES: readonly CollectBoxLine[] = Object.keys(COLLECT_BOX_LABELS) as CollectBoxLine[];
```

The block is L0: it imports nothing. `isSessionIdShape` and `ChildReclaimKeptMember` are declared above it in the same file, and (c)'s forward references compile.

(e) In `server/src/ccdargv.ts`, line 2, add the type to the existing import:

```ts
import { ROUTE_WRITABLE_FIELDS, type CollectToken, type RouteFields, type StopSurface } from '../../shared/api.js';
```

Replace `wsCollect`'s docstring and signature (`:452-458`):

```ts
  /** `ws-collect` — the collector of a witnessed child temp root whose workspace is gone. `token` is
   *  `ws-audit --collect`'s, recomputed and compared by ccd inside the reap lock BEFORE anything moves. The confirmation
   *  token LEADS (`['ws-collect','--expect']` is the grant); the dec trails, and ccd strips it before it binds a
   *  positional. Composed by NOTHING in this build: the collector's lane is its one caller, behind `COLLECT_CAP`, and
   *  `ws-collect-wiring.test.ts` pins that no server source composes it until then. */
  wsCollect: (token: string, id: string, dec: ActorFlags | null) =>
```

with:

```ts
  /** `ws-collect` — the collector of a witnessed child temp root whose workspace is gone. `token` is
   *  `ws-audit --collect`'s, recomputed and compared by ccd inside the reap lock BEFORE anything moves. It is a
   *  `CollectToken` (`shared/api.ts`, spec §5.10), which only the collect audit's reader casts to, so a string from
   *  anywhere else does not compile here. The confirmation token LEADS (`['ws-collect','--expect']` is the grant); the
   *  dec trails, and ccd strips it before it binds a positional. Composed by NOTHING in this build: the collector's lane
   *  is its one caller, behind `COLLECT_CAP`, and `ws-collect-wiring.test.ts` pins that no server source composes it
   *  until then. */
  wsCollect: (token: CollectToken, id: string, dec: ActorFlags | null) =>
```

The "Composed by NOTHING" sentence stays true until Task 6 composes the builder. Task 6 rewrites it, and `COLLECT_CAP`'s "Nothing reads it in this build", line-neutrally, in the commit that composes it, together with the wiring test's INERT holder lists (`ccdargv-collect-docstrings-rewritten`, H5).

(f) The test casts. These are test-only: the shipped tree's one cast is Task 2's.
- `server/test/ws-collect-wiring.test.ts`, ONE cast at the file's token declaration (H1):
  - add `import type { CollectToken } from '../../shared/api.js';` directly after the `../src/ccdargv.js` import (`:12`);
  - at `:15`, replace `const TOKEN = 'a'.repeat(64);` with `const TOKEN = 'a'.repeat(64) as CollectToken;`;
  - nothing else. The three calls (`:25-26` and `:39` at the base, one line lower after the import) stay byte for byte, and so do the INERT `it` and its literal lists. Task 6 rewrites the INERT `it`'s holder lists in the commit that composes the builders (H5); the `'ws-collect'` and `'--collect'` lists stay byte for byte through every task.
- `server/test/ccdargv-dec-parity.test.ts`, whose one token is the literal at `:161`, so its one cast is there (H1):
  - add `import type { CollectToken } from '../../shared/api.js';` directly after `:55` (`import { CCD_ARGV, type ActorFlags } from '../src/ccdargv.js';`);
  - at `:161` (now `:162`), replace `CCD_ARGV.wsCollect('a'.repeat(64), ABSENT, d)` with `CCD_ARGV.wsCollect('a'.repeat(64) as CollectToken, ABSENT, d)`.

(g) In `server/src/childReclaimSweep.ts`:
- line 15: replace `CHILD_RUN_ID, LC_LINE_MAX, isSessionIdShape, leafKeptWord,` with `CHILD_RUN_ID, LC_LINE_MAX, isTmpRootId, leafKeptWord,`;
- delete the two lines `/** ccd's own id rule (`_ws_tmproot_id_ok`): a session id's shape, and no leading `.`. */` and `const leafIdOk = (id: string): boolean => isSessionIdShape(id) && !id.startsWith('.');`, and the empty line after them;
- in `childReclaimLeafKept`, replace `!leafIdOk(r.sessionId)` with `!isTmpRootId(r.sessionId)`;
- in `childReclaimLeafKept`'s docstring, replace the eight lines from ` *  A row whose id fails ccd's own id rule lists nothing,` through ` *  journal (a stated residual): it is still one plain line, with no separator and no dot-leading name.` with:

```ts
 *  A row whose id fails the temp-root id rule lists nothing, so no feed row is written for it. Any session can
 *  append a journal line, so the mirror's id is attribution, and this item puts it in a path a person is told
 *  to remove. The rule is L0's `isTmpRootId` (spec §5.10):
 *  - ccd's `_ws_tmproot_id_ok`, a session id's shape and no leading `.`. Without the dot clause, `.` would name
 *    `~/.cc-clips` (or `~/.cc-tmp`) itself as the thing a person removes, and `..` the directory above it;
 *  - no leading `-`, and at most 255 characters. These two clauses are the collector's, and here they change only
 *    what is listed: an id the collector never audits is not listed either.
```

(h) In `server/src/coord/store.ts`, kept line for line (several tests cite this file by line in prose):
- line 79: replace `  IDLE_RUN_STATES, transitionsFor, TERMINAL_DELIVERY_STATES, TERMINAL_RUN_STATES,` with `  IDLE_RUN_STATES, transitionsFor, TERMINAL_DELIVERY_STATES, TERMINAL_RUN_STATES, TMPROOT_ID_MAX_CHARS,`;
- line 1493: replace `const CHILD_RECLAIM_MAX_SESSION_ID_CHARS = 255;` with `/* The bound is L0's `TMPROOT_ID_MAX_CHARS` (spec §5.10), the one temp-root id cap, imported above. */`;
- then replace every remaining `CHILD_RECLAIM_MAX_SESSION_ID_CHARS` in the file with `TMPROOT_ID_MAX_CHARS`: five occurrences, at `:1478`, `:1501`, `:1515`, `:1525` and `:3430`. Two are code (`:1501`, `:1525`) and three are prose.

`grep -c "CHILD_RECLAIM_MAX_SESSION_ID_CHARS" server/src/coord/store.ts` then prints 0. `wc -l server/src/coord/store.ts` is unchanged.

- [ ] **Step 5: Run the tests, the type-checks, and the neighbours**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-l0.test.ts test/ccdargv-brand.test.ts test/ws-collect-wiring.test.ts \
  test/child-reclaim-leaf-kept.test.ts test/child-reclaim-attention-arms.test.ts test/child-reclaim-paused-at-server.test.ts
cd server && ./node_modules/.bin/vitest run test/ccdargv-dec-parity.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
cd pwa && npm ci && ./node_modules/.bin/tsc --noEmit -p .
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/typecheck-tests.test.ts
```

Expected:
- The first command: every file passes. `collect-l0.test.ts` holds about 40 cases; re-measure. `child-reclaim-paused-at-server.test.ts`'s 255-character round trip is the store's bound, unchanged.
- `ccdargv-dec-parity.test.ts` passes unchanged. It runs real ccd in a fixture HOME, and its `ws-collect` probe still answers `not-witnessed` for the absent id.
- Both server `tsc` runs and the PWA `tsc` print nothing and exit 0. The PWA reader's `RenderedAttention` is `Pick<Extract<ChildReclaimAttention, { readonly sessionId: string }>, …>`, which the collect arm satisfies. `pwa/test/child-reclaim-banner.test.tsx`'s `keptMany` builder (`:373`) still type-checks against a union of three `kept-many` arms.
- `single-definition` is exactly as green as at the base, plus this block's four cases. Run it on the base first if anything else is red.
- `typecheck-tests` is a known load flake: re-run it in isolation before calling it red.

- [ ] **Step 6: Prove README and the citation census owe nothing**

```bash
BASE=$(git merge-base HEAD origin/main)
U=$(grep -oE 'shared/api\.ts:[0-9]+-[0-9]+' README.md | sed 's/.*://; s/-/,/')
M=$(sed -n '/shared\/api\.ts:[0-9]/,+1p' README.md | grep -oE '`:[0-9]+`' | tr -d '`:' | paste -sd' ')
SEL="${U}p"; for n in $M; do SEL="$SEL;${n}p"; done; echo "$SEL"
diff <(git show "$BASE:shared/api.ts" | sed -n "$SEL") <(sed -n "$SEL" shared/api.ts) && echo SAME-BYTES
git diff "$BASE" --stat -- shared/api.ts      # insertions are the foot block plus 6 changed lines above it
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND'
git diff --stat -- README.md server/test/session-hook.test.ts   # prints nothing
```

Expected:
- `SEL` is `7878,7880p;7930p;7938p;7951p`, and `SAME-BYTES` follows.
- The citation cases print `5 passed`; re-measure the skipped count.
- The last line prints nothing.

If any differs, an edit above an anchor moved a line. STOP and report `in-place-edit-moved-a-line`.

- [ ] **Step 7: Mutation check**

Make each mutation alone, run its command, record the red, and revert before the next. None was measured at planning: measure each one.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| T1.1 | In `isTmpRootId`, delete `&& !id.startsWith('-')` | `cd server && ./node_modules/.bin/vitest run test/collect-l0.test.ts` | 9 failed: the eight `a dash-leading id … is refused` rows (`expected true to be false`), and `a dash-leading or over-long id is not listed` (`expected [ '--', '--actor', '-x' ] to deeply equal []`) |
| T1.2 | In `isTmpRootId`, `id.length <= TMPROOT_ID_MAX_CHARS` → `id.length <= TMPROOT_ID_MAX_CHARS + 1` | same | `256 characters -> false` (`expected true to be false`), and the kept-leaf exclusion case (the 256-character id listed) |
| T1.3 | `export const TMPROOT_ID_MAX_CHARS = 255;` → `= 256;` | same | `its cap is 255 characters` (`expected 256 to be 255`), plus T1.2's two |
| T1.4 | In `isTmpRootId`, delete `&& !id.startsWith('.')` | same, plus `test/child-reclaim-leaf-kept.test.ts` | `. -> false`, `.. -> false`, `a dot-leading name -> false`; and wave 8's `lists nothing for a row whose id fails ccd's id rule…` (`expected [ …(3) ] to deeply equal []`) |
| T1.5 | In `server/src/childReclaimSweep.ts`, add `const leafIdOk = (id: string): boolean => isSessionIdShape(id) && !id.startsWith('.');` above `leafRunOf`, import `isSessionIdShape`, and call `!leafIdOk(r.sessionId)` | `cd server && ./node_modules/.bin/vitest run test/collect-l0.test.ts && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'child reclamation wave 9'` | the kept-leaf exclusion case; then single-definition `leafIdOk: expected [ 'server/src/childReclaimSweep.ts' ] to deeply equal []`, and the re-derivation case |
| T1.6 | In `server/src/coord/store.ts`, restore `const CHILD_RECLAIM_MAX_SESSION_ID_CHARS = 255;` at `:1493`, and use it at `:1501` | `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'child reclamation wave 9'` | `the store cap: expected [ 'server/src/coord/store.ts' ] to deeply equal []` |
| T1.7 | In `server/src/ccdargv.ts`, `wsCollect: (token: CollectToken, …` → `wsCollect: (token: string, …` | `cd server && ./node_modules/.bin/vitest run test/ccdargv-brand.test.ts` | `b7-collect-token-plain-string.ts`: `a plain string as ws-collect's token (spec §5.10) — expected TS2345 …: expected [] to deeply equal [ 'TS2345' ]` |
| T1.8 | `export type CollectToken = string & { readonly [collectTokenBrand]: true };` → `export type CollectToken = string;` | `cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json` | `test/collect-l0.test.ts(…): error TS2578: Unused '@ts-expect-error' directive.` (on the forged token); `ccdargv-brand.test.ts`'s b7 case reds with it |
| T1.9 | Delete ` \| ChildReclaimCollectAttention` from the union's last line | same | `error TS2322: Type '"collect"' is not assignable to type …` at `collect-l0.test.ts`'s two items, and TS2578 on the dated item |
| T1.10 | In `ChildReclaimCollectAttention`, add `readonly at?: number \| null;` | same | `test/collect-l0.test.ts(…): error TS2578: Unused '@ts-expect-error' directive.` If this mutation stays green, tsc did not check excess properties on the union: STOP and report `collect-arm-excess-at-unflagged` |
| T1.11 | `ChildReclaimCollectMany`'s `` word: `collect:${string}` `` → `word: string` | `cd server && ./node_modules/.bin/vitest run test/collect-l0.test.ts` | Stays green: the disjointness is a type fact plus the run-time prefix loop. Record it as `collect-many-word-type-unpinned-by-a-red` and leave it (the loop reds when a kept word gains the prefix; T1.12) |
| T1.12 | Add `'collect:x'` to `ChildReclaimKeptWord`'s union and table (`:3778-3784`) | same | `a collapsed collector line is a kept-many whose word…` with message `collect:x: expected true to be false` |
| T1.13 | `COLLECT_BOX_LABELS['box-probe']`: `'box-probe': 'collector / the fleet box'` → `'box-probe': 'collector the fleet box'` (the space stays, the slash goes) | same | `box-probe: holds a slash, which no registry file name can carry…` (`expected 'collector the fleet box' to match /\//`), and `each listing is named by its path…` |
| T1.14 | `lock: 'collector / temp-root reap locks'` → `lock: 'collector / the fleet box'` | same | `no two lines share a label…` (`expected 9 to be 10`) |
| T1.15 | Delete the `'no-run'` row from `COLLECT_BOX_LABELS` | same | `the lines are the table’s keys, derived, ten of them` (`expected [ …(9) ] to have a length of 10 but got 9`) |
| T1.16 | Delete the cast at `ws-collect-wiring.test.ts`'s `TOKEN` declaration (`const TOKEN = 'a'.repeat(64) as CollectToken;` → `const TOKEN = 'a'.repeat(64);`) | `cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json` | `test/ws-collect-wiring.test.ts(26,…)`, `(27,…)` and `(40,…)`: `error TS2345: Argument of type 'string' is not assignable to parameter of type 'CollectToken'.`, once at each of the three calls (base `:25`, `:26`, `:39`, shifted one line by the import); typecheck-tests reds with it |

Revert each mutation, then re-run Step 5's first command green.

- [ ] **Step 8: Commit**

```bash
git add shared/api.ts server/src/ccdargv.ts server/src/childReclaimSweep.ts server/src/coord/store.ts \
  server/test/collect-l0.test.ts server/test/ws-collect-wiring.test.ts server/test/ccdargv-dec-parity.test.ts \
  server/test/ccdargv-brand.test.ts server/test/types/bypasses/b7-collect-token-plain-string.ts \
  server/test/types/ok/legit-collect-token.ts server/test/single-definition.test.ts
git commit -m "$(cat <<'MSG'
feat(reclaim): L0 for the collector's lane: one temp-root id predicate, the collect token brand, its attention arms

isTmpRootId is the one predicate of a temp-root id: ccd's own rule plus no
leading dash and at most 255 characters (spec §5.10). The dash clause is a
safety rule, because ccd's verbs read their flags from any position. Wave 8's
private kept-leaf copy and the store's private cap become imports of it, so the
kept-leaf reader no longer lists a dash-leading or over-long id (display only).
CollectToken is a phantom brand that ws-collect's builder alone takes, so a
plain string no longer compiles into its argv (a bypass fixture pins it); the
two test files cast once, at their token. ChildReclaimAttention gains the collector's item
and its collapsed line, and its runId sentence now names every arm's source.
COLLECT_BOX_LABELS names each box-wide line with a label no session id can
equal. Appended at the file's foot; the edits above it are line for line, so
README's anchors are unchanged (measured).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: The collector's two readers, and the probe and refusal tables they classify by, pinned both ways against ccd

**Model routing:** `opus`, effort `xhigh`. This is a SAFETY task. `parseCollectAudit`'s `collectable` arm is the ONLY source of a `CollectToken`, the one value the lane ever spends (R85). Its narrowing decides what is spendable, and `parseCollectResult`'s no-document arms decide whether an act MAY have happened (R85's slot). Every count below is a prediction made at planning: measure each one.

**Why:**
- **R84, the readers.** Each reader is total and L1, and never borrows reclaim's.
- **The audit reader.**
  - The document must be a JSON object with `session === id` and `mode === 'collect'`. Anything else is `unreadable`.
  - At exit 0, `collectable` is accepted only with a `token` matching `^[0-9a-f]{64}$`.
  - At exit 1, only `verdict === 'unmeasured'` is accepted, with its probe from `collect.unmeasured`. There is no token arm on exit 1.
  - No document at all is its own arm, `no-document`.
  - An unknown verdict is a retry, never spent. A `startsWith('collectable')` check is the pinned mutation.
  - An unknown probe word is kept verbatim.
  - `resume`, `collect.idleAt`, `collect.leaf` and `collect.witness` are carried, and `resume` is told apart by the key's PRESENCE (R86 (e)).
  - **Every document carries its witness run and leaf (H3).** The `verdict` and `unmeasured` arms carry `witnessRun` and `leaf` as `collectable` does, because ccd prints `collect.witness` and `collect.leaf` on every document and R88's `runId` and leaf sentence read the LATEST document. `witnessRun` (and `collectable`'s `witnessAt`) is null iff `collect.witness` is null; a witness whose `run` or `at` is not ccd's printed integer shape makes ANY document `unreadable`. On `verdict` and `unmeasured` an absent `witness` key reads as none.
  - **H7's reader choices, confirmed.** An exit-0 `unmeasured` is `unreadable`; an exit-1 `unmeasured` with a null or empty probe is `unreadable`; a `collectable` whose `witness` key is malformed or absent is `unreadable`; a present `resume` that is not a non-empty string is `unreadable`. On "absent where a fresh document needs it", this reader holds the stricter reading: an absent `witness` key is `unreadable` on EVERY `collectable`, a resume included (ccd prints the key on every document, so its absence is never ccd's, and an absent gating key never spends, R86). A row pins the resume case.
  - `exists` is not carried: nothing gates on it (`exists-not-carried`, accepted, H3).
- **The verb reader.**
  - DONE is accepted only when `collected === id`; any other `collected` is `failed`.
  - REFUSED words are classed by a total L1 table over L0's collect words AND the shared tokens. An unknown word is a retry, never terminal.
  - FAILED carries no `crumb` read.
  - No document has three arms, never folded: arm 1 is a RECOGNISED pre-lock die, matched exactly against ccd's whole stderr and pinned by reading each text off `ccd/ccd`; arms 2 and 3 are `no-document`.
  - A scan pins that the collect readers neither import nor call `parseChildReclaimResult` or `parseChildReclaimAuditFailed`.
- **R87, the probe table.** One total L1 table classes the `unmeasured` probe words: box-wide (`platform`, `mv`, `flock`, `witness`, `floor`, `clock`, `eval`, `quarantine`), per-leaf deterministic (`idle:cap`, `idle:unreadable`, `mode`, `device`), and load-sensitive (the rest, and any unknown word).
  - It is pinned in BOTH directions against ccd's `_ws_collect_unmeasured` call sites (20 words) and the four `idle:` words.
  - The idle words are pinned from `_ws_collect_eval`'s `case`, plus its `why=walk-failed` default, never from the literal `"idle:$why"`.
- **R85.** `CollectToken` is minted only by the collect audit reader. This task adds the shipped tree's one `as CollectToken`, and a scan pins it there.
- **R82, the live switch.** `COLLECT_LANE_LIVE_MARKER = 'collect-lane-live'` is defined ONCE, here, in the lane's L1 file, which has no `node:` import. Its code holders are this file and the executor (`coord/collectTempRoot.ts`) only, and every test imports it from `../src/collectLane.js` (H11). No draft declared it; the coordinator's reconciliation assigns it to this task, the file's creator.
- **R82/R86, the wiring boundary.** `ws-collect-wiring.test.ts`'s INERT case must stay green through this task. Task 6 rewrites its holder lists in the commit that composes the builders (H5). So `collectLane.ts` spells neither `'ws-collect'` nor `'--collect'` as a quoted literal, and names neither builder nor `COLLECT_CAP` in code.

**What the wire carries (read off `ccd/ccd` at `d0c2b7803`, by content):**
- **The audit document** (`_ws_collect_audit_doc`, `:33316`, `grep -n '^_ws_collect_audit_doc() {' ccd/ccd`):
  - `{"session":<id>,"mode":"collect","exists":<bool>,"collect":{"leaf","witness","records","newestCtimeNs","entries","floorS","idleAt","unmeasured"},["resume":<phase>,]"verdict":…,"detail":…[,"token":…]}`.
  - `witness` is `null` or `{"dev","ino","btime","run","at"}`, every field a JSON STRING (`_json_str`). `run` is in `_child_runid_valid`'s grammar (`CHILD_RUN_ID`), and `at` is 13 digits of epoch ms (`_ws_tmproot_witness_read`, `:21074`).
  - `idleAt` is a bare number or `null`, and `unmeasured` is the probe word or `null`.
  - It exits 1 on `unmeasured` only, and journals only the three terminal words (`:33353-33357`).
- **The verb's documents** (`cmd_ws_collect`, `:34017`; `_ws_collect_locked`, `:34118`):
  - `{"collected":<id>,"record":<name>|null,"resumed":<bool>,"witness":"dropped"|"kept"|"absent"}` (`:33679`, `:33709`; `_WS_CAD`, `:33595-33616`);
  - `{"refused":<word>,"detail":…,"paths":[]}` (`_ws_collect_refused`, `:33659`, and the inline `in-progress`, `:34109`);
  - `{"failed":<word>,"detail":…}` with no `crumb` (`_ws_reclaim_failed_json`, `:29347`, under `_WS_RCL_CRUMB=''`).
- **The verb's refusal words** (harvested at planning from the region `_ws_collect_enc() {` … `# COLLECT-V1.`): `changed-recently`, `containment-unproven`, `in-progress`, `in-use`, `not-witnessed`, `paused`, `quarantine-kept`, `registered`, `state-changed`, `witness-mismatch`.
  - These are exactly R84's L0 five plus its shared five.
  - The audit's `_ws_collect_refuse` words are the same set minus `state-changed`.
- **The verb's dies before the lock** (`cmd_ws_collect`):
  - the usage die (four sites), `bad token`, `bad session id`, `python3 unavailable — cannot quote the collection record safely`;
  - `_lc_refuse collect "$id" flock-unavailable "flock (util-linux) is unavailable — refusing to run the destructive verb unserialised"`;
  - `_lc_refuse collect "$id" lock-unopenable "cannot open the reap lock at $lock"`, which follows bash's own redirection diagnostic for `$lock`;
  - the four dec dies (`--actor must be non-blank`, `--actor is longer than $_LC_DEC_MAX bytes`, and the two `--reason` twins).
  - R84 does not list the dec dies, so they read as arm 3. They are unreachable, because the server's dec is `sweepDec`'s constant.

**Files:**
- Create: `server/src/collectLane.ts`. It is L1, and imports `../../shared/api.js` and `./childReclaimSweep.js` only, one statement each (H2: L1 to L1, one way; `childReclaimSweep.ts` never imports it). This task writes the first statement alone; Task 4 adds the second, and every task merges its names into those two. This task writes its header, the live marker, the two tables and the two readers; Tasks 3–5 and 7 append below them.
- Test (new): `server/test/collect-readers.test.ts`

**Interfaces:**
- Consumes (at `d0c2b7803`, plus Task 1):
  - `CHILD_RUN_ID` (`shared/api.ts:54`, `grep -n "^export const CHILD_RUN_ID" shared/api.ts`);
  - `CollectToken` (Task 1, `shared/api.ts`'s foot);
  - `isLcRefusalToken` (`grep -n "^export function isLcRefusalToken" shared/api.ts`);
  - on the test side:
    - `SENTENCES` (`server/src/wsaudit.ts:17`);
    - `CCD` (`server/test/ccdWsHelpers.ts:24`);
    - `codeOnly` (`server/test/sourceScan.ts:28`);
    - `makePrHarness` (`server/test/ccdPrHelpers.ts:43`);
    - `COL_ID` (`'demo-quiet-reef'`), `COL_RUN` (`7`), `WRONG_TOKEN`, `regOf`, `makeOrphan`, `collectAudit` and `collectVerb` (`server/test/wsCollectFixture.ts:19`, `:20`, `:22`, `:32`, `:54`, `:127` and `:140`). Their audit and verb lower the floor only through `IDLE_FLOOR_SEAM`, in a FIXTURE HOME.
- Produces (exact, in `server/src/collectLane.ts`):
  ```ts
  export type CollectProbeClass = 'box-wide' | 'per-leaf' | 'load-sensitive';
  export type CollectProbe = keyof typeof COLLECT_PROBE_CLASS_TABLE;          // the 24 words
  export const COLLECT_PROBE_CLASS: Readonly<Record<CollectProbe, CollectProbeClass>>;
  export const COLLECT_PROBES: readonly CollectProbe[];                       // derived
  export function collectProbeClass(probe: string): CollectProbeClass;        // unknown -> 'load-sensitive'
  export type CollectRefusalClass = 'terminal' | 'retry';
  export type CollectRefusalWord = keyof typeof COLLECT_REFUSAL_CLASS_TABLE;  // the 10 words
  export const COLLECT_REFUSAL_CLASS: Readonly<Record<CollectRefusalWord, CollectRefusalClass>>;
  export const COLLECT_REFUSAL_WORDS: readonly CollectRefusalWord[];          // derived
  export function collectRefusalClass(word: string): CollectRefusalClass;     // unknown -> 'retry'
  export type CollectAudit =
    | { readonly kind: 'collectable'; readonly token: CollectToken; readonly resume: string | null;
        readonly witnessRun: number | null; readonly witnessAt: number | null; readonly leaf: string | null;
        readonly detail: string }
    | { readonly kind: 'verdict'; readonly verdict: string; readonly idleAt: number | null;
        readonly witnessRun: number | null; readonly leaf: string | null; readonly detail: string }
    | { readonly kind: 'unmeasured'; readonly probe: string; readonly witnessRun: number | null;
        readonly leaf: string | null; readonly detail: string }
    | { readonly kind: 'unreadable'; readonly detail: string }
    | { readonly kind: 'no-document'; readonly stderr: string };
  export function parseCollectAudit(sessionId: string, ok: boolean, stdout: string, stderr: string): CollectAudit;
  export type CollectWitnessWord = 'dropped' | 'kept' | 'absent';            // derived from a table
  export type CollectDieWord = 'flock-unavailable' | 'lock-unopenable' | 'usage' | 'bad-token' | 'bad-session-id' | 'python3-unavailable';
  export const COLLECT_DIE_TEXT: Readonly<Record<Exclude<CollectDieWord, 'lock-unopenable'>, string>>;
  export const COLLECT_LOCK_DIE_PREFIX = 'cannot open the reap lock at ';
  export type CollectResult =
    | { readonly kind: 'collected'; readonly record: string | null; readonly resumed: boolean; readonly witness: CollectWitnessWord }
    | { readonly kind: 'refused'; readonly word: string; readonly detail: string; readonly paths: readonly string[] }
    | { readonly kind: 'failed'; readonly token: string; readonly detail: string }
    | { readonly kind: 'die'; readonly word: CollectDieWord }
    | { readonly kind: 'no-document'; readonly stderr: string };
  export function parseCollectResult(sessionId: string, ok: boolean, stdout: string, stderr: string): CollectResult;
  export const COLLECT_LANE_LIVE_MARKER = 'collect-lane-live';   // R82; code holders: this file and coord/collectTempRoot.ts (H11)
  ```
- **What each argument means.** `ok` is the runner's `ok` (exit 0). `stdout` and `stderr` are as the runner hands them. Neither reader reads a clock.
- **For Task 4 (pacing), as §16's final text and H1/H7 rule it:**
  - `collectRefusalClass`'s `terminal` set is exactly the audit's journaled set: `witness-mismatch`, `quarantine-kept` and `containment-unproven`. A verb `refused` or `failed` whose word it calls `terminal` advances the TERMINAL run, ahead of the refusal and verb-failed rows (H1).
  - `not-witnessed` is a `retry` in the table. Task 4 keys it by the word: the audit's `not-witnessed` clears the three runs and ADVANCES the deferral count (H1), and a verb `refused not-witnessed` is read the same way, plus the refusal floor (H7).
  - The audit's `unreadable`, and an unknown verdict, advance the FAILING run (H1). A reader-made `failed` (`token: ''`) advances the VERB-FAILED run (H7).
  - An arm-1 `die` other than `flock-unavailable` takes the refusal floor, and its recurrence past the ceiling is attention; `flock-unavailable` latches (H1).
  - Every document arm but `unreadable` and `no-document` carries the latest `witnessRun` and `leaf`, which Task 4 keeps as its evidence (H3).
- **For Task 6 (the executor):**
  - `parseCollectResult`'s `die` is arm 1: it acted nothing, and frees the slot.
  - `no-document` is arms 2 and 3: it MAY have acted, and keeps the id and the slot for `CHILD_RECLAIM_STALL_MS`.
  - The executor calls `parseCollectAudit(id, res.ok, res.stdout, res.stderr)` and `parseCollectResult(id, res.ok, res.stdout, res.stderr)`, and nothing of reclaim's.

- [ ] **Step 1: Re-measure the anchors (read-only)**

```bash
grep -n '^_ws_collect_enc() {\|^_ws_collect_eval() {\|^_ws_collect_resume_eval() {\|^_ws_collect_audit_doc() {\|^# ── end ws-audit --collect\|^cmd_ws_collect() {\|^_ws_collect_locked() {\|^# COLLECT-V1\.' ccd/ccd
#   8 lines, in this file order: 32228 33316(audit_doc)… — exactly: enc 32228, eval 32995, resume_eval 33108,
#   audit_doc 33316, end-audit 33360, cmd 34017, locked 34118, COLLECT-V1 34174
grep -c '_ws_collect_unmeasured "idle:\$why"' ccd/ccd                                     # 1
grep -nF 'case "${_WS_IDLE_WHY-}" in timeout|unreadable|cap) why=' ccd/ccd               # one line (33081)
grep -n 'local id="\$1" leaf="\$HOME/.cc-tmp/\$1" rc floor why=walk-failed' ccd/ccd     # one line (32997)
grep -v '^\s*#' ccd/ccd | grep -oE '_ws_collect_unmeasured [a-z][a-z-]*' | sort -u | wc -l   # 20
ls server/src/collectLane.ts server/src/coord/collectTempRoot.ts 2>&1 | grep -c 'No such file'   # 2
grep -rn "CollectToken" shared/api.ts | head -1                                          # Task 1's declaration
```

STOP rules:
- A count differs: report it by slug, and re-point by content.
- A region anchor is gone: report `collect-region-anchor-moved`. The scans in Step 2 slice by these anchors and assert both ends, so a lost anchor reds rather than widening a slice.

- [ ] **Step 2: Write the failing test**

Create `server/test/collect-readers.test.ts`:

```ts
// Child reclamation wave 9: the temp-root collector's two readers, and the two tables they classify by (spec §5.10).
// - `parseCollectAudit` reads `ws-audit --collect`. Only its exit-0 `collectable` arm carries a token, and that token
//   is the ONE value the collector ever spends.
// - `parseCollectResult` reads `ws-collect`. Its no-document answer has three arms, never folded: a recognised die
//   acted nothing, and anything else MAY have acted.
// - The probe and refusal tables, and the recognised die texts, are pinned BOTH WAYS against ccd's own text, read here
//   at test time.
// - The cases that run the real verbs do so in a FIXTURE HOME (`makePrHarness`), never against the live HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLcRefusalToken } from '../../shared/api.js';
import {
  COLLECT_DIE_TEXT, COLLECT_LANE_LIVE_MARKER, COLLECT_LOCK_DIE_PREFIX, COLLECT_PROBE_CLASS, COLLECT_PROBES, COLLECT_REFUSAL_CLASS,
  COLLECT_REFUSAL_WORDS, collectProbeClass, collectRefusalClass, parseCollectAudit, parseCollectResult,
  type CollectProbeClass,
} from '../src/collectLane.js';
import { SENTENCES } from '../src/wsaudit.js';
import { CCD } from './ccdWsHelpers.js';
import { codeOnly } from './sourceScan.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { COL_ID, COL_RUN, WRONG_TOKEN, collectAudit, collectVerb, makeOrphan, regOf } from './wsCollectFixture.js';

const ccrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (p: string): string => path.relative(ccrcRoot, p);
const LINUX = process.platform === 'linux';

// ── ccd's text, read at test time ───────────────────────────────────────────────────────────────────────────────
const ccdSrc = readFileSync(CCD, 'utf8');
/** Whole-line `#` comments dropped, so prose that names a word is never read as a call. */
const bashCode = (t: string): string => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
/** ccd's text from `from` to the first `to` after it. Both anchors are asserted, so a lost one reds rather than
 *  widening the slice to the rest of the file. */
const between = (from: string, to: string): string => {
  const a = ccdSrc.indexOf(from);
  expect(a, `ccd/ccd: ${JSON.stringify(from)} is gone`).toBeGreaterThan(-1);
  const b = ccdSrc.indexOf(to, a + from.length);
  expect(b, `ccd/ccd: ${JSON.stringify(to)} does not follow ${JSON.stringify(from)}`).toBeGreaterThan(a);
  return ccdSrc.slice(a, b);
};
const uniq = (xs: readonly string[]): string[] => [...new Set(xs)].sort();

/** Every probe word ccd's collector answers `unmeasured` with: the literal first argument of each
 *  `_ws_collect_unmeasured` call, and the walk words `_ws_collect_eval` admits (its `case`, and its default). */
const probesFromCcd = (): string[] => {
  const code = bashCode(ccdSrc);
  const literal = [...code.matchAll(/_ws_collect_unmeasured ([a-z][a-z-]*)\b/g)].map((m) => m[1]!);
  expect([...code.matchAll(/_ws_collect_unmeasured "idle:\$why"/g)], 'the walk probe is composed once').toHaveLength(1);
  const ev = between('\n_ws_collect_eval() {', '\n_ws_collect_resume_eval() {');
  const cased = /case "\$\{_WS_IDLE_WHY-\}" in ([a-z|-]+)\)/.exec(ev);
  const dflt = /\blocal [^\n]*\bwhy=([a-z-]+)/.exec(ev);
  expect(cased, 'the case that admits a walk word').not.toBeNull();
  expect(dflt, 'the walk word a failure that names no admitted word reads').not.toBeNull();
  return uniq([...literal, ...[...cased![1]!.split('|'), dflt![1]!].map((w) => `idle:${w}`)]);
};

/** The collector's whole region, from its first helper to the capability's marker. */
const collectRegion = (): string => bashCode(between('\n_ws_collect_enc() {', '\n# COLLECT-V1.'));
/** Every word `ws-collect` can print as `refused`, by the five routes a word reaches `_ws_collect_refused` or a
 *  literal refusal document. `collectable` and `unmeasured` are verdicts, not refusals. */
const verbRefusalsFromCcd = (): string[] => {
  const r = collectRegion();
  return uniq([
    ...[...r.matchAll(/_ws_collect_refused "\$id" "[^"]*" ([a-z][a-z-]*)/g)].map((m) => m[1]!),
    ...[...r.matchAll(/_WS_REPROVE_WORD=([a-z][a-z-]*)/g)].map((m) => m[1]!),
    ...[...r.matchAll(/_ws_collect_refuse ([a-z][a-z-]*)/g)].map((m) => m[1]!),
    ...[...r.matchAll(/REAP_VERDICT=([a-z][a-z-]*)/g)].map((m) => m[1]!),
    ...[...r.matchAll(/"refused":"([a-z-]+)"/g)].map((m) => m[1]!),
  ].filter((w) => w !== 'collectable' && w !== 'unmeasured'));
};
/** The audit's own refusal words: the ones `_ws_collect_eval`, its resume and the audit's own rungs set. */
const auditRefusalsFromCcd = (): string[] =>
  uniq([...collectRegion().matchAll(/_ws_collect_refuse ([a-z][a-z-]*)/g)].map((m) => m[1]!));
/** The words the audit JOURNALS, its terminal ones: `_ws_collect_audit_doc`'s case. */
const auditJournaledFromCcd = (): string[] => {
  const doc = between('\n_ws_collect_audit_doc() {', '\n# ── end ws-audit --collect');
  return uniq([...doc.matchAll(/^\s+([a-z-]+)\)\s+_lc_emit collect refused "\$id" "" verb ws-audit refusal ([a-z-]+) /gm)]
    .map((m) => { expect(m[2], 'the case arm journals its own word').toBe(m[1]); return m[1]!; }));
};
/** Every message `cmd_ws_collect` dies with before its lock: each `die "…"`, and each `_lc_refuse collect`'s message.
 *  A message ccd builds with a variable is read up to the `$`, its fixed prefix. */
const diesFromCcd = (): string[] => {
  const region = bashCode(between('\ncmd_ws_collect() {', '\n_ws_collect_locked() {'));
  const re = /\bdie "((?:[^"\\]|\\.)*)"|_lc_refuse\s+collect\s+"\$id"\s+\S+[\s\\]*"((?:[^"\\]|\\.)*)"/g;
  return uniq([...region.matchAll(re)].map((m) => {
    const t = (m[1] ?? m[2])!;
    const d = t.indexOf('$');
    return d === -1 ? t : t.slice(0, d);
  }));
};
/** The four dec dies. R84 does not list them, so they read as arm 3 (MAY have acted). The server's dec is a constant
 *  that never reaches them. */
const DEC_DIES = ['--actor is longer than ', '--actor must be non-blank', '--reason is longer than ', '--reason must be non-blank'];

// ── the audit reader ────────────────────────────────────────────────────────────────────────────────────────────
const ID = 'demo-quiet-mesa';
const TOK = 'b'.repeat(64);
const WIT = { dev: '2049', ino: '131077', btime: '1789990000', run: '41', at: '1789990000123' };
const LEAF = `/home/u/.cc-tmp/${ID}`;
/** An audit document in ccd's shape: a fresh `collectable` unless `over` says otherwise. A key set to `undefined` is
 *  dropped by `JSON.stringify`, so it is absent. */
const audit = (over: Record<string, unknown> = {}, collect: Record<string, unknown> = {}): string => `${JSON.stringify({
  session: ID, mode: 'collect', exists: true,
  collect: { leaf: LEAF, witness: WIT, records: [], newestCtimeNs: '1789990000000000000', entries: 3, floorS: 86400,
    idleAt: 1790076400, unmeasured: null, ...collect },
  verdict: 'collectable', detail: '', token: TOK, ...over,
})}\n`;
const A = (stdout: string, ok = true, stderr = '') => parseCollectAudit(ID, ok, stdout, stderr);

describe('parseCollectAudit — exit 0: only an exact collectable with a 64-hex token is spendable (spec §5.10)', () => {
  it('a fresh collectable document reads as collectable, with its witness run and instant, and no resume', () => {
    expect(A(audit())).toEqual({ kind: 'collectable', token: TOK, resume: null, witnessRun: 41,
      witnessAt: 1789990000123, leaf: LEAF, detail: '' });
  });

  it('a resume document carries its phase: the key’s presence is what tells a resume', () => {
    expect(A(audit({ resume: 'moved' }))).toMatchObject({ kind: 'collectable', resume: 'moved' });
  });

  it('a collectable document whose witness is null reads, with no run and no instant (the open-run hold decides)', () => {
    expect(A(audit({}, { witness: null }))).toMatchObject({ kind: 'collectable', witnessRun: null, witnessAt: null });
  });

  it('a leaf that is not a string is carried as null', () => {
    expect(A(audit({}, { leaf: 3 }))).toMatchObject({ kind: 'collectable', leaf: null });
  });

  it.each<readonly [string, string]>([
    ['no token', audit({ token: undefined })],
    ['a null token', audit({ token: null })],
    ['a 63-character token', audit({ token: TOK.slice(1) })],
    ['a 65-character token', audit({ token: `${TOK}b` })],
    ['an upper-case token', audit({ token: TOK.toUpperCase() })],
    ['a token with a trailing newline', audit({ token: `${TOK}\n` })],
    ['a number for a token', audit({ token: 7 })],
    ['an empty resume', audit({ resume: '' })],
    ['a null resume', audit({ resume: null })],
    ['no collect block', audit({ collect: undefined })],
    ['no witness key', audit({}, { witness: undefined })],
    ['a resume with no witness key (H7: the stricter reading)', audit({ resume: 'moved' }, { witness: undefined })],
    ['a witness that is an array', audit({}, { witness: [] })],
    ['a witness run of 0', audit({}, { witness: { ...WIT, run: '0' } })],
    ['a witness run that is a number', audit({}, { witness: { ...WIT, run: 41 } })],
    ['a witness run of eleven digits', audit({}, { witness: { ...WIT, run: '12345678901' } })],
    ['a witness at of twelve digits', audit({}, { witness: { ...WIT, at: '178999000012' } })],
    ['a witness with no dev', audit({}, { witness: { ...WIT, dev: undefined } })],
  ])('collectable with %s is unreadable, never spent', (_what, doc) => {
    expect(A(doc).kind).toBe('unreadable');
  });

  it('an unknown verdict that begins collectable, token and all, is a verdict, never collectable', () => {
    expect(A(audit({ verdict: 'collectable-later' })))
      .toEqual({ kind: 'verdict', verdict: 'collectable-later', idleAt: 1790076400, witnessRun: 41, leaf: LEAF, detail: '' });
  });

  it('a refusal reads as a verdict, with ccd’s detail and its idleAt', () => {
    expect(A(audit({ verdict: 'changed-recently', detail: 'young', token: undefined })))
      .toEqual({ kind: 'verdict', verdict: 'changed-recently', idleAt: 1790076400, witnessRun: 41, leaf: LEAF, detail: 'young' });
  });

  // H3: ccd prints `collect.witness` and `collect.leaf` on every document, and R88's runId and leaf sentence read the
  // LATEST document, so a verdict carries them too. A null witness carries no run; a malformed one is never read.
  it('a verdict whose witness is null or absent, or whose leaf is not a string, carries null for each', () => {
    expect(A(audit({ verdict: 'in-use', token: undefined }, { witness: null, leaf: 3 })))
      .toMatchObject({ kind: 'verdict', witnessRun: null, leaf: null });
    expect(A(audit({ verdict: 'in-use', token: undefined }, { witness: undefined })))
      .toMatchObject({ kind: 'verdict', witnessRun: null, leaf: LEAF });
  });

  it.each<readonly [string, unknown]>([
    ['a witness run of 0', { ...WIT, run: '0' }],
    ['a witness at of twelve digits', { ...WIT, at: '178999000012' }],
    ['a witness that is an array', []],
  ])('a verdict with %s is unreadable', (_what, witness) => {
    expect(A(audit({ verdict: 'in-use', token: undefined }, { witness })).kind).toBe('unreadable');
  });

  it.each<readonly [unknown, number | null]>([
    [0, 0], [1790076400, 1790076400], [1.5, null], [-1, null], ['1790076400', null], [null, null], [2 ** 60, null],
  ])('an idleAt of %j is carried as %j', (idleAt, want) => {
    expect(A(audit({ verdict: 'changed-recently', token: undefined }, { idleAt }))).toMatchObject({ idleAt: want });
  });

  it.each([['unmeasured'], [''], [3], [null]])('an exit-0 verdict of %j is unreadable', (verdict) => {
    expect(A(audit({ verdict })).kind).toBe('unreadable');
  });
});

describe('parseCollectAudit — identity: this id’s collect document, or unreadable (spec §5.10)', () => {
  it.each<readonly [string, string]>([
    ['another session', audit({ session: 'demo-other' })],
    ['no session key', audit({ session: undefined })],
    ['reclaim’s id key instead', audit({ session: undefined, id: ID })],
    ['mode reclaim', audit({ mode: 'reclaim' })],
    ['no mode', audit({ mode: undefined })],
    ['an array', '[1,2]'],
    ['a JSON string', '"collectable"'],
    ['text that is not JSON', 'ccd: something went wrong'],
  ])('%s is unreadable', (_what, doc) => {
    expect(A(doc).kind).toBe('unreadable');
  });
});

describe('parseCollectAudit — exit 1: only unmeasured, with its probe word (spec §5.10)', () => {
  const unmeasured = (probe: unknown, over: Record<string, unknown> = {}, collect: Record<string, unknown> = {}): string =>
    audit({ verdict: 'unmeasured', detail: 'why', token: undefined, ...over }, { unmeasured: probe, ...collect });

  it.each(['checkouts', 'idle:timeout', 'frobnicate'])('unmeasured %j reads as itself, verbatim', (probe) => {
    expect(A(unmeasured(probe), false, 'ccd: … — retry'))
      .toEqual({ kind: 'unmeasured', probe, witnessRun: 41, leaf: LEAF, detail: 'why' });
  });

  it('unmeasured with a null witness carries no run, and keeps its leaf (H3)', () => {
    expect(A(unmeasured('witness', {}, { witness: null }), false))
      .toMatchObject({ kind: 'unmeasured', probe: 'witness', witnessRun: null, leaf: LEAF });
  });

  it.each<readonly [string, string]>([
    ['collectable with a good token', audit()],
    ['a refusal', audit({ verdict: 'in-use', token: undefined })],
    ['unmeasured with a null probe', unmeasured(null)],
    ['unmeasured with an empty probe', unmeasured('')],
    ['unmeasured with no collect block', unmeasured('checkouts', { collect: undefined })],
    ['unmeasured with a witness run of 0', unmeasured('checkouts', {}, { witness: { ...WIT, run: '0' } })],
  ])('at exit 1, %s is unreadable: no exit-1 document is ever spent', (_what, doc) => {
    expect(A(doc, false).kind).toBe('unreadable');
  });
});

describe('parseCollectAudit — no document is its own arm (spec §5.10)', () => {
  it.each<readonly [string, boolean]>([['', false], ['  \n', false], ['', true]])('stdout %j at ok=%s is no-document', (out, ok) => {
    expect(A(out, ok, '  ccd: killed\n')).toEqual({ kind: 'no-document', stderr: 'ccd: killed' });
  });
});

// ── the verb reader ─────────────────────────────────────────────────────────────────────────────────────────────
const J = (o: Record<string, unknown>): string => `${JSON.stringify(o)}\n`;
const R = (stdout: string, ok: boolean, stderr = '') => parseCollectResult(ID, ok, stdout, stderr);
const REC = `${ID}.1790000000000000000.4242`;

describe('parseCollectResult — the three documents (spec §5.10)', () => {
  it.each<readonly [string, Record<string, unknown>]>([
    ['a fresh collection', { collected: ID, record: REC, resumed: false, witness: 'dropped' }],
    ['a resume', { collected: ID, record: REC, resumed: true, witness: 'dropped' }],
    ['a recycled spawn’s witness put back', { collected: ID, record: REC, resumed: false, witness: 'kept' }],
    ['a witness already gone', { collected: ID, record: REC, resumed: false, witness: 'absent' }],
    ['a witness-only drop', { collected: ID, record: null, resumed: false, witness: 'dropped' }],
  ])('%s reads as collected', (_what, doc) => {
    const { collected: _c, ...rest } = doc;
    expect(R(J(doc), true)).toEqual({ kind: 'collected', ...rest });
  });

  it('a collected document naming another id is failed', () => {
    expect(R(J({ collected: 'demo-other', record: REC, resumed: false, witness: 'dropped' }), true))
      .toEqual({ kind: 'failed', token: '', detail: `ws-collect reported collecting demo-other, not ${ID}` });
  });

  it.each<readonly [string, Record<string, unknown>]>([
    ['an unknown witness word', { collected: ID, record: REC, resumed: false, witness: 'gone' }],
    ['no witness', { collected: ID, record: REC, resumed: false }],
    ['a resumed that is a string', { collected: ID, record: REC, resumed: 'false', witness: 'dropped' }],
    ['a record that is a number', { collected: ID, record: 3, resumed: false, witness: 'dropped' }],
    ['an empty record', { collected: ID, record: '', resumed: false, witness: 'dropped' }],
  ])('a collected document with %s is failed, never read as collected', (_what, doc) => {
    expect(R(J(doc), true)).toMatchObject({ kind: 'failed', token: '' });
  });

  it('a collected or refused document at a non-zero exit is failed', () => {
    expect(R(J({ collected: ID, record: null, resumed: false, witness: 'dropped' }), false)).toMatchObject({ kind: 'failed', token: '' });
    expect(R(J({ refused: 'in-use', detail: 'd', paths: [] }), false)).toMatchObject({ kind: 'failed', token: '' });
  });

  it('a refusal reads with its word, ccd’s detail and its paths; an unknown word is kept verbatim', () => {
    expect(R(J({ refused: 'in-use', detail: 'd', paths: [] }), true)).toEqual({ kind: 'refused', word: 'in-use', detail: 'd', paths: [] });
    expect(R(J({ refused: 'in-use', detail: 'd', paths: ['/p'] }), true)).toMatchObject({ paths: ['/p'] });
    expect(R(J({ refused: 'frobnicate', detail: 'd', paths: [] }), true)).toMatchObject({ kind: 'refused', word: 'frobnicate' });
  });

  it.each<readonly [string, unknown]>([['a string', '/p'], ['a non-string member', ['/p', 1]], ['none', undefined]])(
    'paths that are %s read as none', (_what, paths) => {
      expect(R(J({ refused: 'in-use', detail: 'd', paths }), true)).toMatchObject({ paths: [] });
    });

  it('a failure reads its word and detail, and nothing of a crumb', () => {
    expect(R(J({ failed: 'probe-unmeasured', detail: 'd', crumb: true }), false))
      .toEqual({ kind: 'failed', token: 'probe-unmeasured', detail: 'd' });
    expect(R(J({ failed: 'quarantine-kept', detail: 'k' }), false)).toEqual({ kind: 'failed', token: 'quarantine-kept', detail: 'k' });
  });
});

describe('parseCollectResult — no document: three arms, never folded (spec §5.10)', () => {
  it('ccd’s die texts are exactly its recognised texts and its four dec dies, read off cmd_ws_collect', () => {
    expect(diesFromCcd()).toEqual(uniq([...Object.values(COLLECT_DIE_TEXT), COLLECT_LOCK_DIE_PREFIX, ...DEC_DIES]));
  });

  it.each(Object.keys(COLLECT_DIE_TEXT))('%s: ccd’s whole stderr, with nothing on stdout, is that die (arm 1)', (word) => {
    const msg = COLLECT_DIE_TEXT[word as keyof typeof COLLECT_DIE_TEXT];
    expect(R('', false, `ccd: ${msg}\n`)).toEqual({ kind: 'die', word });
  });

  it.each(Object.keys(COLLECT_DIE_TEXT))('%s, EXTENDED or after another line, is not recognised (arm 3)', (word) => {
    const msg = COLLECT_DIE_TEXT[word as keyof typeof COLLECT_DIE_TEXT];
    expect(R('', false, `ccd: ${msg} (more)`)).toEqual({ kind: 'no-document', stderr: `ccd: ${msg} (more)` });
    expect(R('', false, `ccd: warn\nccd: ${msg}`).kind).toBe('no-document');
  });

  it('a die text at exit 0, or beside a stdout, is not recognised', () => {
    const msg = COLLECT_DIE_TEXT['bad-token'];
    expect(R('', true, `ccd: ${msg}`).kind).toBe('no-document');
    expect(R('partial', false, `ccd: ${msg}`).kind).toBe('no-document');
  });

  it.each(DEC_DIES)('the dec die %j is not recognised: arm 3, which MAY have acted', (msg) => {
    expect(R('', false, `ccd: ${msg}`).kind).toBe('no-document');
  });

  const LOCK = `/home/u/.cc-sessions/.reap-${ID}.lock`;
  const bashLine = (p: string): string => `/home/u/ccrc/ccd/ccd: line 34099: ${p}: Is a directory`;
  const lockDie = (p: string = LOCK): string => `ccd: ${COLLECT_LOCK_DIE_PREFIX}${p}`;

  it.each<readonly [string, string]>([
    ['bash’s line, then ccd’s', `${bashLine(LOCK)}\n${lockDie()}`],
    ['ccd’s line alone', lockDie()],
    ['two bash lines for the same path', `${bashLine(LOCK)}\n/x: line 9: ${LOCK}: Permission denied\n${lockDie()}`],
  ])('lock-unopenable for this id’s lock: %s', (_what, err) => {
    expect(R('', false, err)).toEqual({ kind: 'die', word: 'lock-unopenable' });
  });

  it.each<readonly [string, string]>([
    ['another id’s lock', `${bashLine('/home/u/.cc-sessions/.reap-other.lock')}\n${lockDie('/home/u/.cc-sessions/.reap-other.lock')}`],
    ['a longer id that ends in this one', lockDie('/home/u/.cc-sessions/.reap-x-demo-quiet-mesa.lock')],
    ['a path past the lock name', lockDie(`${LOCK}.bak`)],
    ['a bash line naming another path', `${bashLine('/elsewhere')}\n${lockDie()}`],
    ['a line after ccd’s', `${lockDie()}\nccd: more`],
  ])('not this id’s lock die: %s (arm 3)', (_what, err) => {
    expect(R('', false, err).kind).toBe('no-document');
  });

  it('nothing at all, a JSON value with none of the three keys, and a cut line are no-document', () => {
    expect(R('', false, '')).toEqual({ kind: 'no-document', stderr: '' });
    expect(R(J({ other: 1 }), true).kind).toBe('no-document');
    expect(R('[1]', true).kind).toBe('no-document');
    expect(R('{"collected":"demo-qu', false, 'killed').kind).toBe('no-document');
  });
});

// ── the tables ──────────────────────────────────────────────────────────────────────────────────────────────────
describe('COLLECT_PROBE_CLASS — total over ccd’s probe words, pinned both ways (spec §5.10)', () => {
  it('its keys are the twenty words _ws_collect_unmeasured is called with, and the four walk words _ws_collect_eval admits', () => {
    const got = probesFromCcd();
    expect(got.filter((w) => !w.startsWith('idle:'))).toHaveLength(20);
    expect(got.filter((w) => w.startsWith('idle:'))).toEqual(['idle:cap', 'idle:timeout', 'idle:unreadable', 'idle:walk-failed']);
    expect([...COLLECT_PROBES].sort()).toEqual(got);
  });

  it('each class holds exactly its words', () => {
    const of = (c: CollectProbeClass): string[] => COLLECT_PROBES.filter((p) => COLLECT_PROBE_CLASS[p] === c).sort();
    expect(of('box-wide')).toEqual(['clock', 'eval', 'flock', 'floor', 'mv', 'platform', 'quarantine', 'witness']);
    expect(of('per-leaf')).toEqual(['device', 'idle:cap', 'idle:unreadable', 'mode']);
    expect(of('load-sensitive')).toEqual(['checkouts', 'identity', 'idle:timeout', 'idle:walk-failed', 'in-use', 'leaf',
      'lock', 'records', 'registry', 'rows', 'slot', 'token']);
  });

  it.each(COLLECT_PROBES.map((p) => [p, COLLECT_PROBE_CLASS[p]] as const))('%s is %s', (p, c) => {
    expect(collectProbeClass(p)).toBe(c);
  });

  it.each(['frobnicate', 'idle:other', '', 'constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'an unknown probe word %j is load-sensitive', (w) => {
      expect(collectProbeClass(w)).toBe('load-sensitive');
    });
});

describe('COLLECT_REFUSAL_CLASS — total over the words ws-collect refuses with, pinned both ways (spec §5.10)', () => {
  it('its keys are every word the verb prints as refused', () => {
    expect([...COLLECT_REFUSAL_WORDS].sort()).toEqual(verbRefusalsFromCcd());
  });

  it('the audit refuses with the same words, save state-changed, which only the verb’s token comparison answers', () => {
    expect(auditRefusalsFromCcd()).toEqual(COLLECT_REFUSAL_WORDS.filter((w) => w !== 'state-changed').sort());
  });

  it('the terminal words are exactly the ones the audit journals', () => {
    expect(COLLECT_REFUSAL_WORDS.filter((w) => COLLECT_REFUSAL_CLASS[w] === 'terminal').sort()).toEqual(auditJournaledFromCcd());
  });

  it('five are L0’s collect words, and five are the shared tokens wsaudit.ts words', () => {
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    const l0 = uniq([...api.matchAll(/^\s+\| '([a-z-]+)'\s*;?\s*\/\/ ws-audit --collect and ws-collect\b/gm)].map((m) => m[1]!));
    expect(l0).toEqual(['changed-recently', 'not-witnessed', 'quarantine-kept', 'registered', 'witness-mismatch']);
    expect(COLLECT_REFUSAL_WORDS.filter((w) => isLcRefusalToken(w)).sort()).toEqual(l0);
    const shared = COLLECT_REFUSAL_WORDS.filter((w) => !isLcRefusalToken(w)).sort();
    expect(shared).toEqual(['containment-unproven', 'in-progress', 'in-use', 'paused', 'state-changed']);
    for (const w of shared) expect(Object.prototype.hasOwnProperty.call(SENTENCES, w), w).toBe(true);
  });

  it.each(['frobnicate', '', 'constructor', '__proto__', 'refused'])('an unknown word %j is a retry, never terminal', (w) => {
    expect(collectRefusalClass(w)).toBe('retry');
  });
});

// ── the readers never borrow reclaim's, and the one cast ───────────────────────────────────────────────────────
describe('the collect readers are their own (spec §5.10)', () => {
  const SRC = path.join(ccrcRoot, 'server', 'src');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
    if (e.startsWith('__')) return [];
    const p = path.join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
  /** The lane's files: every `collect<Name>.ts` under server/src, so the executor joins when it lands. */
  const laneFiles = (): string[] => walk(SRC).filter((f) => /^collect[A-Z]\w*\.ts$/.test(path.basename(f)));
  const ROOTS = ['shared', 'server/src', 'pwa/src', 'agent/src'].map((r) => path.join(ccrcRoot, r));

  it('CONTROL: the lane’s files are found, collectLane.ts among them', () => {
    expect(laneFiles().map(rel)).toContain('server/src/collectLane.ts');
  });

  it('no lane file names a reclaim reader', () => {
    const BORROW = /\bparseChildReclaim(?:Result|Audit|AuditFailed)\b/;
    expect(BORROW.test('return parseChildReclaimResult(id, out, err);'), 'CONTROL').toBe(true);
    expect(laneFiles().filter((f) => BORROW.test(codeOnly(readFileSync(f, 'utf8')))).map(rel)).toEqual([]);
  });

  it('collectLane.ts is L1: it imports shared/api.js and childReclaimSweep.js only (H2), and no module at run time', () => {
    const code = codeOnly(readFileSync(path.join(SRC, 'collectLane.ts'), 'utf8'));
    const specs = uniq([...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!));
    // Task 4 adds `./childReclaimSweep.js` (L1 to L1, one way), and its pacing suite pins the exact pair. This case
    // refuses only a third specifier, so it stays green at Task 4's commit (H5: no commit is red).
    expect(specs).toContain('../../shared/api.js');
    expect(specs.filter((s) => s !== '../../shared/api.js' && s !== './childReclaimSweep.js'), 'a specifier outside H2’s pair')
      .toEqual([]);
    expect(code).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
  });

  it('the live switch’s marker is spelled here: collect-lane-live (R82, H11)', () => {
    expect(COLLECT_LANE_LIVE_MARKER).toBe('collect-lane-live');
  });

  it('the shipped tree casts to CollectToken once, inside parseCollectAudit', () => {
    const CAST = /\bas\s+CollectToken\b/g;
    const hits = ROOTS.flatMap(walk).flatMap((f) => [...codeOnly(readFileSync(f, 'utf8')).matchAll(CAST)].map(() => rel(f)));
    expect(hits).toEqual(['server/src/collectLane.ts']);
    const lane = codeOnly(readFileSync(path.join(SRC, 'collectLane.ts'), 'utf8'));
    const at = lane.indexOf('export function parseCollectAudit(');
    expect(at).toBeGreaterThan(-1);
    const end = lane.indexOf('\nexport ', at + 1);
    expect(lane.slice(at, end === -1 ? undefined : end)).toMatch(/\bas\s+CollectToken\b/);
  });
});

// ── the real verbs, in a fixture HOME ──────────────────────────────────────────────────────────────────────────
describe.skipIf(!LINUX)('the readers against the real ccd, in a fixture HOME (spec §5.10)', () => {
  let h: PrHarness;
  beforeEach(() => { h = makePrHarness('ccrc-collect-readers-'); });
  afterEach(() => { h.cleanup(); });

  it('a real collectable audit reads as collectable; its token, spent, reads as collected; and the id then reads not-witnessed', () => {
    makeOrphan(h);
    const a = collectAudit(h);
    expect(a.stdout.trim().split('\n'), 'ONE line, as the runner hands it over').toHaveLength(1);
    const read = parseCollectAudit(COL_ID, a.code === 0, a.stdout, a.stderr);
    expect(read).toMatchObject({ kind: 'collectable', resume: null, witnessRun: COL_RUN });
    if (read.kind !== 'collectable') throw new Error(`not collectable: ${a.stdout}${a.stderr}`);
    expect(Math.abs(read.witnessAt! - Date.now())).toBeLessThan(600_000);
    const v = collectVerb(h, read.token);
    expect(parseCollectResult(COL_ID, v.code === 0, v.stdout, v.stderr))
      .toMatchObject({ kind: 'collected', resumed: false, witness: 'dropped' });
    const again = collectAudit(h);
    expect(parseCollectAudit(COL_ID, again.code === 0, again.stdout, again.stderr))
      .toMatchObject({ kind: 'verdict', verdict: 'not-witnessed' });
  }, 120_000);

  it('a token that no longer matches reads as the refusal state-changed', () => {
    makeOrphan(h);
    const v = collectVerb(h, WRONG_TOKEN);
    expect(parseCollectResult(COL_ID, v.code === 0, v.stdout, v.stderr)).toMatchObject({ kind: 'refused', word: 'state-changed' });
  }, 60_000);

  it('a box whose mv has no --no-copy reads as unmeasured mv at exit 1', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: '_ws_collect_mv_ok() { return 1; };' });
    expect(a.code).toBe(1);
    expect(parseCollectAudit(COL_ID, false, a.stdout, a.stderr)).toMatchObject({ kind: 'unmeasured', probe: 'mv' });
  }, 60_000);

  it('a lock that is a directory dies lock-unopenable, read as arm 1', () => {
    makeOrphan(h);
    mkdirSync(path.join(regOf(h), `.reap-${COL_ID}.lock`));
    const v = collectVerb(h, WRONG_TOKEN);
    expect(v.stdout.trim(), 'nothing on stdout').toBe('');
    expect(parseCollectResult(COL_ID, v.code === 0, v.stdout, v.stderr), v.stderr).toEqual({ kind: 'die', word: 'lock-unopenable' });
  }, 60_000);

  it('the usage and bad-token dies read as arm 1', () => {
    const usage = collectVerb(h, WRONG_TOKEN, { extra: '--defer-expired' });
    expect(parseCollectResult(COL_ID, usage.code === 0, usage.stdout, usage.stderr), usage.stderr).toEqual({ kind: 'die', word: 'usage' });
    const bad = collectVerb(h, 'xyz');
    expect(parseCollectResult(COL_ID, bad.code === 0, bad.stdout, bad.stderr), bad.stderr).toEqual({ kind: 'die', word: 'bad-token' });
  }, 60_000);
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-readers.test.ts
```

Expected: FAIL. The file does not load: `Error: Failed to load url ../src/collectLane.js` (or `Cannot find module`), and no test runs.

- [ ] **Step 4: Create `server/src/collectLane.ts` with the tables and the readers**

```ts
// The temp-root collector's server lane: its PURE half (child reclamation spec 2026-09-22 §5.10; attention, §5.9).
//
// L1. This file imports `shared/api.js` and `./childReclaimSweep.js` only (L1 to L1, one way: `childReclaimSweep.ts`
// never imports this file), ONE import statement each, and every later block merges its names into those two (H2).
// The readers need the first alone. It reaches no file, process, timer or clock: every instant and interval
// a rule here decides with is an argument. The executor (`coord/collectTempRoot.ts`, L3) runs ccd and hands its answers
// here, and the watcher (`watch.ts`, L4) wires the pass and decides nothing.
//
// The two readers below are TOTAL and the collector's own. Neither borrows reclaim's:
// - a `ws-collect` document carries no `crumb`;
// - its refusal words are not reclaim's;
// - its audit is keyed `session`, not `id`.
import { CHILD_RUN_ID, type CollectToken } from '../../shared/api.js';

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
/** A JSON object: never an array, never null. */
const isObject = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// ── the live switch (spec §5.10, R82) ───────────────────────────────────────────────────────────────────────────

/** The lane's live switch: the marker FILE `$REG/collect-lane-live` (R82). The lane composes `ws-collect` only while it
 *  exists. Without it the lane audits under every rule, and records "would collect" where it would spend (shadow).
 *  - Nothing in the tree writes it. It is hand-touched, on the `expire-lane-live` precedent.
 *  - It is spelled ONCE, here, in an L1 file with no `node:` import. Its code holders are this file and the executor
 *    (`coord/collectTempRoot.ts`), which reads it nearest the argv; tests import it from here. */
export const COLLECT_LANE_LIVE_MARKER = 'collect-lane-live';

// ── the probe and refusal tables (spec §5.10) ───────────────────────────────────────────────────────────────────

/** How an `unmeasured` probe word of `ws-audit --collect` is paced and reported (spec §5.10):
 *  - `box-wide`: a fact about the fleet box, not the id. One line for the box, never one per id.
 *  - `per-leaf`: a fact about this temp root that will not change by itself. It is listed at once.
 *  - `load-sensitive`: a probe a busy or slow box can fail, so it is retried.
 *  A word this table does not know is `load-sensitive`. */
export type CollectProbeClass = 'box-wide' | 'per-leaf' | 'load-sensitive';

/** ccd's probe words, each spelled once as a key: the twenty first arguments of `_ws_collect_unmeasured`, and the
 *  four walk words `_ws_collect_eval` admits. `collect-readers.test.ts` holds the keys equal to ccd's text, both ways. */
const COLLECT_PROBE_CLASS_TABLE = {
  platform: 'box-wide', mv: 'box-wide', flock: 'box-wide', witness: 'box-wide', floor: 'box-wide', clock: 'box-wide',
  eval: 'box-wide', quarantine: 'box-wide',
  'idle:cap': 'per-leaf', 'idle:unreadable': 'per-leaf', mode: 'per-leaf', device: 'per-leaf',
  'idle:timeout': 'load-sensitive', 'idle:walk-failed': 'load-sensitive', 'in-use': 'load-sensitive',
  checkouts: 'load-sensitive', rows: 'load-sensitive', registry: 'load-sensitive', identity: 'load-sensitive',
  leaf: 'load-sensitive', slot: 'load-sensitive', records: 'load-sensitive', token: 'load-sensitive',
  lock: 'load-sensitive',
} as const satisfies Readonly<Record<string, CollectProbeClass>>;
export type CollectProbe = keyof typeof COLLECT_PROBE_CLASS_TABLE;
export const COLLECT_PROBE_CLASS: Readonly<Record<CollectProbe, CollectProbeClass>> = COLLECT_PROBE_CLASS_TABLE;
export const COLLECT_PROBES: readonly CollectProbe[] = Object.keys(COLLECT_PROBE_CLASS_TABLE) as CollectProbe[];

/** A probe word's class. An unknown word, a prototype member's name included, is `load-sensitive`. */
export function collectProbeClass(probe: string): CollectProbeClass {
  return hasOwn(COLLECT_PROBE_CLASS, probe) ? COLLECT_PROBE_CLASS[probe as CollectProbe] : 'load-sensitive';
}

/** How a `ws-collect` refusal word, or the same word as an audit verdict, is read (spec §5.10):
 *  - `terminal`: ccd journals it, and the operator owns what stands;
 *  - `retry`: nothing was removed, and a later look may differ.
 *  A word this table does not know is a `retry`, never `terminal`. */
export type CollectRefusalClass = 'terminal' | 'retry';

/** Every word `ws-collect` prints as `refused`: the collector's five journal words, declared in L0's `LcRefusalToken`,
 *  and the five shared tokens `wsaudit.ts` words. The audit's refusal verdicts are the same words, save `state-changed`.
 *  `collect-readers.test.ts` holds the keys equal to ccd's text, both ways. */
const COLLECT_REFUSAL_CLASS_TABLE = {
  'witness-mismatch': 'terminal', 'quarantine-kept': 'terminal', 'containment-unproven': 'terminal',
  'not-witnessed': 'retry', registered: 'retry', 'changed-recently': 'retry',
  'state-changed': 'retry', 'in-use': 'retry', 'in-progress': 'retry', paused: 'retry',
} as const satisfies Readonly<Record<string, CollectRefusalClass>>;
export type CollectRefusalWord = keyof typeof COLLECT_REFUSAL_CLASS_TABLE;
export const COLLECT_REFUSAL_CLASS: Readonly<Record<CollectRefusalWord, CollectRefusalClass>> = COLLECT_REFUSAL_CLASS_TABLE;
export const COLLECT_REFUSAL_WORDS: readonly CollectRefusalWord[] =
  Object.keys(COLLECT_REFUSAL_CLASS_TABLE) as CollectRefusalWord[];

/** A refusal word's class. An unknown word, a prototype member's name included, is a `retry`. */
export function collectRefusalClass(word: string): CollectRefusalClass {
  return hasOwn(COLLECT_REFUSAL_CLASS, word) ? COLLECT_REFUSAL_CLASS[word as CollectRefusalWord] : 'retry';
}

// ── the audit reader (spec §5.10) ───────────────────────────────────────────────────────────────────────────────

/** `ws-audit --collect`'s token grammar: exactly 64 lowercase hex characters, nothing trimmed, and no flag. */
const COLLECT_TOKEN_SHAPE = /^[0-9a-f]{64}$/;
/** A witness's `at`: epoch milliseconds, exactly thirteen digits, as ccd's witness reader requires. */
const WITNESS_AT_SHAPE = /^[0-9]{13}$/;

/** `ws-audit --session <id> --collect`'s answer (spec §5.10). Only `collectable` carries a token, and only at exit 0.
 *  - `collectable`:
 *    - `resume` is the quarantine PHASE, null when the key is absent: a fresh collection;
 *    - `witnessRun` and `witnessAt` are `collect.witness`'s `run` and `at` (epoch ms), null when the witness is null;
 *    - `leaf` is `collect.leaf`, for display only.
 *  - `verdict`: any other exit-0 verdict, a refusal word or one this build does not know, with `collect.idleAt`
 *    (epoch seconds) when it is a non-negative safe integer.
 *  - `unmeasured`: the exit-1 answer, with its probe word verbatim.
 *  - `verdict` and `unmeasured` carry the document's `witnessRun` and `leaf` too: ccd prints `collect.witness` and
 *    `collect.leaf` on every document, and the lane's evidence is the LATEST document's. There an absent `witness`
 *    key reads as none. A witness this reader cannot vouch for makes ANY document `unreadable`.
 *  - `exists` is not carried: nothing gates on it.
 *  - `unreadable`: a document that is not this id's collect audit, or not ccd's shape for its exit status. It is never
 *    spent.
 *  - `no-document`: nothing on stdout (a runner kill, a timeout, a die before the document). */
export type CollectAudit =
  | { readonly kind: 'collectable'; readonly token: CollectToken; readonly resume: string | null;
      readonly witnessRun: number | null; readonly witnessAt: number | null; readonly leaf: string | null;
      readonly detail: string }
  | { readonly kind: 'verdict'; readonly verdict: string; readonly idleAt: number | null;
      readonly witnessRun: number | null; readonly leaf: string | null; readonly detail: string }
  | { readonly kind: 'unmeasured'; readonly probe: string; readonly witnessRun: number | null;
      readonly leaf: string | null; readonly detail: string }
  | { readonly kind: 'unreadable'; readonly detail: string }
  | { readonly kind: 'no-document'; readonly stderr: string };

/** `collect.witness` as the document prints it: `null`, or ccd's five fields, each a string, with `run` in the one
 *  run-id grammar and `at` thirteen digits. Anything else, an absent key included, is `bad`. A `collectable` hands its
 *  key over as it stands, so an absent one is `bad` there (H7); a `verdict` or `unmeasured` hands an absent key over
 *  as `null`, so it reads as none. */
type WitnessRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'run'; readonly run: number; readonly at: number }
  | { readonly kind: 'bad' };
function readWitness(w: unknown): WitnessRead {
  if (w === null) return { kind: 'none' };
  if (!isObject(w)) return { kind: 'bad' };
  const { dev, ino, btime, run, at } = w;
  if (typeof dev !== 'string' || typeof ino !== 'string' || typeof btime !== 'string'
    || typeof run !== 'string' || !CHILD_RUN_ID.test(run) || typeof at !== 'string' || !WITNESS_AT_SHAPE.test(at)) {
    return { kind: 'bad' };
  }
  return { kind: 'run', run: Number(run), at: Number(at) };
}

/** The witness's run, or null when the document's witness is null. */
const witnessRunOf = (w: WitnessRead): number | null => (w.kind === 'run' ? w.run : null);

const idleAtOf = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);

/** THE ONE READER of `ws-audit --collect` (spec §5.10). `ok` is the runner's exit-0 answer.
 *  - At exit 0, only an EXACT `collectable` with a 64-hex token, a readable witness, and a `resume` that is absent or
 *    a non-empty string is spendable. Its `as CollectToken` is the shipped tree's one cast to the brand.
 *  - At exit 1, only `unmeasured` with a non-empty probe word reads; every other exit-1 shape is unreadable.
 *  - Every document's witness run and leaf are carried; a witness this reader cannot vouch for makes ANY document
 *    unreadable.
 *  - An empty stdout is `no-document`, and never a probe. */
export function parseCollectAudit(sessionId: string, ok: boolean, stdout: string, stderr: string): CollectAudit {
  const out = stdout.trim();
  const err = stderr.trim();
  if (out === '') return { kind: 'no-document', stderr: err };
  const said = err === '' ? '' : `: ${err}`;
  let v: unknown;
  try { v = JSON.parse(out); } catch {
    return { kind: 'unreadable', detail: `ws-audit --collect printed no JSON document${said}` };
  }
  if (!isObject(v) || v.session !== sessionId || v.mode !== 'collect') {
    return { kind: 'unreadable', detail: `ws-audit --collect printed a document that is not ${sessionId}'s collect audit${said}` };
  }
  const collect = isObject(v.collect) ? v.collect : null;
  const detail = typeof v.detail === 'string' ? v.detail : '';
  const leaf = collect !== null && typeof collect.leaf === 'string' ? collect.leaf : null;
  /** The witness as a `verdict` or `unmeasured` document carries it: an absent key reads as none (H3). A `collectable`
   *  reads its own, stricter (H7). */
  const seen = readWitness(collect?.witness ?? null);
  if (!ok) {
    const probe = collect === null ? undefined : collect.unmeasured;
    if (v.verdict !== 'unmeasured' || typeof probe !== 'string' || probe === '') {
      return { kind: 'unreadable', detail: `ws-audit --collect failed with a document that is not its unmeasured answer${said}` };
    }
    if (seen.kind === 'bad') return { kind: 'unreadable', detail: 'ws-audit --collect answered unmeasured with a witness it cannot vouch for' };
    return { kind: 'unmeasured', probe, witnessRun: witnessRunOf(seen), leaf, detail };
  }
  if (v.verdict === 'collectable') {
    if (typeof v.token !== 'string' || !COLLECT_TOKEN_SHAPE.test(v.token)) {
      return { kind: 'unreadable', detail: 'ws-audit --collect said collectable with no token of 64 lowercase hex characters' };
    }
    if (collect === null) return { kind: 'unreadable', detail: 'ws-audit --collect said collectable with no collect block' };
    const wit = readWitness(collect.witness);
    if (wit.kind === 'bad') return { kind: 'unreadable', detail: 'ws-audit --collect said collectable with a witness it cannot vouch for' };
    let resume: string | null = null;
    if (hasOwn(v, 'resume')) {
      if (typeof v.resume !== 'string' || v.resume === '') {
        return { kind: 'unreadable', detail: 'ws-audit --collect said collectable with a resume phase that is not a word' };
      }
      resume = v.resume;
    }
    return {
      kind: 'collectable', token: v.token as CollectToken, resume,
      witnessRun: wit.kind === 'run' ? wit.run : null, witnessAt: wit.kind === 'run' ? wit.at : null,
      leaf, detail,
    };
  }
  if (typeof v.verdict !== 'string' || v.verdict === '' || v.verdict === 'unmeasured') {
    return { kind: 'unreadable', detail: `ws-audit --collect answered a verdict that is not one at exit 0${said}` };
  }
  if (seen.kind === 'bad') {
    return { kind: 'unreadable', detail: `ws-audit --collect answered ${v.verdict} with a witness it cannot vouch for` };
  }
  return {
    kind: 'verdict', verdict: v.verdict, idleAt: idleAtOf(collect === null ? null : collect.idleAt),
    witnessRun: witnessRunOf(seen), leaf, detail,
  };
}

// ── the verb reader (spec §5.10) ────────────────────────────────────────────────────────────────────────────────

const COLLECT_WITNESS_WORD_TABLE = { dropped: true, kept: true, absent: true } as const;
/** What a collection did with the id's witness: dropped it, put a recycled spawn's back (`kept`), or found none. */
export type CollectWitnessWord = keyof typeof COLLECT_WITNESS_WORD_TABLE;

/** The pre-lock dies of `cmd_ws_collect` the reader RECOGNISES (spec §5.10). Each acted nothing. */
export type CollectDieWord =
  | 'flock-unavailable' | 'lock-unopenable' | 'usage' | 'bad-token' | 'bad-session-id' | 'python3-unavailable';

/** ccd's own message for each single-line recognised die, without its `ccd: ` prefix. Matched against the WHOLE trimmed
 *  stderr, never as a substring, so a die ccd extends no longer matches. `collect-readers.test.ts` holds these equal to
 *  `cmd_ws_collect`'s text, both ways. */
export const COLLECT_DIE_TEXT: Readonly<Record<Exclude<CollectDieWord, 'lock-unopenable'>, string>> = {
  usage: 'usage: ccd ws-collect --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]',
  'bad-token': 'bad token',
  'bad-session-id': 'bad session id',
  'python3-unavailable': 'python3 unavailable — cannot quote the collection record safely',
  'flock-unavailable': 'flock (util-linux) is unavailable — refusing to run the destructive verb unserialised',
};

/** The fixed prefix of `lock-unopenable`'s die. ccd appends the lock's path. */
export const COLLECT_LOCK_DIE_PREFIX = 'cannot open the reap lock at ';

/** `lock-unopenable`, recognised whole-output and for THIS id's lock only. The last line is exactly ccd's, naming a path
 *  that ends `/.reap-<id>.lock`. Every earlier line, zero or more, is bash's own redirection diagnostic for that same
 *  path. */
function collectLockDie(sessionId: string, err: string): boolean {
  const lines = err.split('\n');
  const last = lines[lines.length - 1] ?? '';
  const head = `ccd: ${COLLECT_LOCK_DIE_PREFIX}`;
  if (!last.startsWith(head)) return false;
  const lockPath = last.slice(head.length);
  if (!lockPath.endsWith(`/.reap-${sessionId}.lock`)) return false;
  const mid = `: ${lockPath}: `;
  return lines.slice(0, -1).every((l) => {
    const at = l.indexOf(mid);
    return at > 0 && /: line [0-9]+$/.test(l.slice(0, at)) && l.length > at + mid.length;
  });
}

function collectDie(sessionId: string, err: string): CollectDieWord | null {
  if (collectLockDie(sessionId, err)) return 'lock-unopenable';
  for (const word of Object.keys(COLLECT_DIE_TEXT) as Exclude<CollectDieWord, 'lock-unopenable'>[]) {
    if (err === `ccd: ${COLLECT_DIE_TEXT[word]}`) return word;
  }
  return null;
}

/** `ccd ws-collect --expect <token> --session <id> …`'s answer (spec §5.10).
 *  - `collected` (exit 0, `collected === id`). `record` is the quarantine record's name, or null for a witness-only drop.
 *  - `refused` (exit 0). ccd's word is kept verbatim and classed by `collectRefusalClass`.
 *  - `failed`. ccd's word, or `''` when this reader made the failure: a `collected` document for another id or one it
 *    cannot read, or a document at an exit status that contradicts it.
 *  - `die`: a RECOGNISED pre-lock die. It acted nothing.
 *  - `no-document`: anything else with no document, which MAY have acted (a runner kill, a timeout, a link failure). */
export type CollectResult =
  | { readonly kind: 'collected'; readonly record: string | null; readonly resumed: boolean; readonly witness: CollectWitnessWord }
  | { readonly kind: 'refused'; readonly word: string; readonly detail: string; readonly paths: readonly string[] }
  | { readonly kind: 'failed'; readonly token: string; readonly detail: string }
  | { readonly kind: 'die'; readonly word: CollectDieWord }
  | { readonly kind: 'no-document'; readonly stderr: string };

function collectedOf(sessionId: string, ok: boolean, v: Readonly<Record<string, unknown>>): CollectResult {
  if (v.collected !== sessionId) {
    return { kind: 'failed', token: '', detail: `ws-collect reported collecting ${String(v.collected)}, not ${sessionId}` };
  }
  if (!ok) return { kind: 'failed', token: '', detail: `ws-collect reported collecting ${sessionId} but exited non-zero` };
  const record = v.record === null ? null : typeof v.record === 'string' && v.record !== '' ? v.record : undefined;
  const witness = typeof v.witness === 'string' && hasOwn(COLLECT_WITNESS_WORD_TABLE, v.witness)
    ? v.witness as CollectWitnessWord : undefined;
  if (record === undefined || typeof v.resumed !== 'boolean' || witness === undefined) {
    return { kind: 'failed', token: '', detail: `ws-collect reported collecting ${sessionId} with a document this build cannot read` };
  }
  return { kind: 'collected', record, resumed: v.resumed, witness };
}

/** THE ONE READER of `ws-collect` (spec §5.10). `ok` is the runner's exit-0 answer. A recognised die needs an empty
 *  stdout and a non-zero exit, so a document, however cut, is never read as one. */
export function parseCollectResult(sessionId: string, ok: boolean, stdout: string, stderr: string): CollectResult {
  const out = stdout.trim();
  const err = stderr.trim();
  let v: unknown = null;
  if (out !== '') { try { v = JSON.parse(out); } catch { v = null; } }
  if (isObject(v)) {
    if (typeof v.collected === 'string') return collectedOf(sessionId, ok, v);
    if (typeof v.refused === 'string') {
      if (!ok) return { kind: 'failed', token: '', detail: `ws-collect refused ${v.refused} but exited non-zero` };
      const paths = Array.isArray(v.paths) && v.paths.every((p) => typeof p === 'string') ? v.paths as string[] : [];
      return { kind: 'refused', word: v.refused, detail: typeof v.detail === 'string' ? v.detail : '', paths };
    }
    if (typeof v.failed === 'string') {
      return { kind: 'failed', token: v.failed, detail: typeof v.detail === 'string' ? v.detail : '' };
    }
  }
  if (out === '' && !ok) {
    const word = collectDie(sessionId, err);
    if (word !== null) return { kind: 'die', word };
  }
  return { kind: 'no-document', stderr: err };
}
```

- [ ] **Step 5: Run the test, the neighbours and the type-checks**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-readers.test.ts
cd server && ./node_modules/.bin/vitest run test/ws-collect-wiring.test.ts test/verb-gate.test.ts test/lifecycle-refusal-word.test.ts \
  test/wsaudit.test.ts test/ccd-refusal-scan.test.ts test/child-reclaim-verdict-readers.test.ts test/collect-l0.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/typecheck-tests.test.ts
```

Expected:
- `collect-readers.test.ts` passes, with about 140 cases on Linux (re-measure). The five fixture cases are skipped off Linux.
- The real-run cases are the measurement of ccd's wire. If one reds, read its message before touching the reader:
  - `ONE line` red: the sourced harness put a second line on stdout. That is a fixture artefact, not the runner's shape. Report `fixture-stdout-not-one-line`, and do not loosen the reader.
  - `lock-unopenable` red, naming stderr: bash's diagnostic has a shape the matcher refuses. Report `lock-die-shape-measured-differs` with the stderr, and do not widen the matcher past "this id's lock path".
- The neighbours pass unchanged:
  - `ws-collect-wiring`'s INERT case stays green, because `collectLane.ts` names no builder, no `'ws-collect'` or `'--collect'` literal, and no `COLLECT_CAP` in code;
  - `verb-gate` stays green, because there is no `CCD_ARGV` site.
- Both `tsc` runs print nothing and exit 0.
- `single-definition` is as green as after Task 1. `typecheck-tests` is a known load flake: re-run it in isolation before calling it red.

- [ ] **Step 6: Mutation check**

Make each mutation alone in `server/src/collectLane.ts` (unless the row says otherwise), run `cd server && ./node_modules/.bin/vitest run test/collect-readers.test.ts`, record the red, and revert before the next. None was measured at planning: measure each one.

| # | Mutation (exact edit) | Expected red |
|---|---|---|
| T2.1 | `if (v.verdict === 'collectable') {` → `if (typeof v.verdict === 'string' && v.verdict.startsWith('collectable')) {` | `an unknown verdict that begins collectable, token and all, is a verdict, never collectable` (`expected { kind: 'collectable', … } to deeply equal { kind: 'verdict', … }`) |
| T2.2 | Delete `\|\| !COLLECT_TOKEN_SHAPE.test(v.token)` | the 63- and 65-character, upper-case and trailing-newline token rows: `expected 'collectable' to be 'unreadable'` |
| T2.3 | `/^[0-9a-f]{64}$/` → `/^[0-9a-f]{64}$/i` | `collectable with an upper-case token is unreadable, never spent` |
| T2.4 | `/^[0-9a-f]{64}$/` → `/^[0-9a-f]{64}$/m` | `collectable with a token with a trailing newline is unreadable, never spent` |
| T2.5 | In the `!ok` branch, add `if (v.verdict === 'collectable' && typeof v.token === 'string') return { kind: 'collectable', token: v.token as CollectToken, resume: null, witnessRun: null, witnessAt: null, leaf: null, detail };` as its first line | `at exit 1, collectable with a good token is unreadable…`; the cast scan (`expected [ …(2) ] to deeply equal [ 'server/src/collectLane.ts' ]`) |
| T2.6 | Delete `v.session !== sessionId \|\| ` | `another session is unreadable` and `reclaim’s id key instead is unreadable`, and `no session key is unreadable` |
| T2.7 | Delete ` \|\| v.mode !== 'collect'` | `mode reclaim is unreadable` and `no mode is unreadable` |
| T2.8 | `if (typeof v.resume !== 'string' \|\| v.resume === '')` → `if (typeof v.resume !== 'string')` | `collectable with an empty resume is unreadable, never spent` |
| T2.9 | In `readWitness`, delete `\|\| !CHILD_RUN_ID.test(run)` | the rows `a witness run of 0` and `a witness run of eleven digits` |
| T2.10 | In `readWitness`, `if (w === null) return { kind: 'none' };` → `if (w === null \|\| w === undefined) return { kind: 'none' };` | `collectable with no witness key is unreadable, never spent` |
| T2.11 | `if (out === '') return { kind: 'no-document', stderr: err };` → `if (out === '') return { kind: 'unreadable', detail: err };` | the three `stdout … is no-document` rows |
| T2.12 | In `idleAtOf`, delete `Number.isSafeInteger(v) && ` | `an idleAt of 1.5 is carried as null`, and `of 1152921504606846976` |
| T2.13 | In `collectedOf`, delete the `v.collected !== sessionId` branch | `a collected document naming another id is failed` |
| T2.14 | In `collectedOf`, delete the `if (!ok)` line | `a collected or refused document at a non-zero exit is failed` |
| T2.15 | `hasOwn(COLLECT_WITNESS_WORD_TABLE, v.witness)` → `v.witness !== ''` | `a collected document with an unknown witness word is failed…` |
| T2.16 | In `collectLockDie`, delete the `endsWith` line | `not this id’s lock die: another id’s lock` and `a longer id that ends in this one`… (`expected 'die' to be 'no-document'`). Expect `a longer id…` to stay green under this row alone, because the prefix test still reads the whole path: measure, and record which rows red |
| T2.17 | In `collectLockDie`, `lines.slice(0, -1).every(` → `lines.slice(0, -1).some(` | `two bash lines for the same path` stays green; `a bash line naming another path` reds (`expected 'die' to be 'no-document'`) |
| T2.18 | In `collectDie`, `err === \`ccd: ${COLLECT_DIE_TEXT[word]}\`` → `err.startsWith(\`ccd: ${COLLECT_DIE_TEXT[word]}\`)` | the five `… EXTENDED or after another line, is not recognised (arm 3)` rows |
| T2.19 | `if (out === '' && !ok) {` → `if (out === '') {` | `a die text at exit 0, or beside a stdout, is not recognised` |
| T2.20 | `COLLECT_DIE_TEXT['python3-unavailable']`: `collection record` → `reclaim record` | `ccd’s die texts are exactly its recognised texts and its four dec dies…` (both sides listed) |
| T2.21 | `Array.isArray(v.paths) && v.paths.every(…)` → `Array.isArray(v.paths)` | `paths that are a non-string member read as none` |
| T2.22 | In `COLLECT_PROBE_CLASS_TABLE`, delete `lock: 'load-sensitive',` | `its keys are the twenty words…` (`expected [ …(23) ] to deeply equal [ …(24) ]`) and `each class holds exactly its words` |
| T2.23 | Add `frob: 'box-wide',` to `COLLECT_PROBE_CLASS_TABLE` | `its keys are the twenty words…` and `each class holds exactly its words` |
| T2.24 | `device: 'per-leaf'` → `device: 'load-sensitive'` | `each class holds exactly its words` |
| T2.25 | In `collectProbeClass`, `hasOwn(COLLECT_PROBE_CLASS, probe)` → `probe in COLLECT_PROBE_CLASS` | `an unknown probe word "constructor" is load-sensitive`, and `"toString"`, `"__proto__"` and `"hasOwnProperty"` (`expected undefined …` or `expected [Function …]`) |
| T2.26 | `'containment-unproven': 'terminal'` → `'containment-unproven': 'retry'` | `the terminal words are exactly the ones the audit journals` |
| T2.27 | In `collectRefusalClass`, `: 'retry'` → `: 'terminal'` | the five `an unknown word … is a retry, never terminal` rows |
| T2.28 | Delete `paused: 'retry',` from `COLLECT_REFUSAL_CLASS_TABLE` | `its keys are every word the verb prints as refused`, the audit case, and the L0/shared case |
| T2.29 | Add `import { parseChildReclaimResult } from './coord/childReclaim.js'; void parseChildReclaimResult;` under the existing import | `no lane file names a reclaim reader` (`expected [ 'server/src/collectLane.ts' ] to deeply equal []`), and `collectLane.ts is L1…` |
| T2.30 | In `collectedOf`, return `{ kind: 'collected', record, resumed: v.resumed, witness: v.witness as CollectToken as unknown as CollectWitnessWord }` | `the shipped tree casts to CollectToken once, inside parseCollectAudit` (`expected [ …(2) ] to deeply equal [ 'server/src/collectLane.ts' ]`) |
| T2.31 | In `ccd/ccd`, NO edit. Instead, in the test's `probesFromCcd`, measure the control: temporarily replace `'idle:${w}'` with `w` | `its keys are the twenty words…` reds, which proves the idle words come from the `case`. Revert the test |
| T2.32 | In the verdict return, `witnessRun: witnessRunOf(seen)` → `witnessRun: null` | `an unknown verdict that begins collectable…` and `a refusal reads as a verdict…` (`expected { …, witnessRun: null, … } to deeply equal { …, witnessRun: 41, … }`) |
| T2.33 | Delete the verdict branch's `if (seen.kind === 'bad') { … }` | the three `a verdict with … is unreadable` rows (`expected 'verdict' to be 'unreadable'`) |
| T2.34 | Delete the `!ok` branch's `if (seen.kind === 'bad') return …` line | `at exit 1, unmeasured with a witness run of 0 is unreadable…` (`expected 'unmeasured' to be 'unreadable'`) |
| T2.35 | `const leaf = collect !== null && typeof collect.leaf === 'string' ? collect.leaf : null;` → `const leaf: string \| null = null;` | `a fresh collectable document reads…`, the three `unmeasured … reads as itself` rows, `unmeasured with a null witness…`, and the two verdict `toEqual` cases |
| T2.36 | `const seen = readWitness(collect?.witness ?? null);` → `const seen = readWitness(collect?.witness);` | `a verdict whose witness is null or absent…` (its absent-key half reads `unreadable`: `expected { kind: 'unreadable', … } to match object { kind: 'verdict', … }`) |
| T2.37 | `export const COLLECT_LANE_LIVE_MARKER = 'collect-lane-live';` → `'collect-live'` | `the live switch’s marker is spelled here…` (`expected 'collect-live' to be 'collect-lane-live'`) |

Revert each mutation, then re-run Step 5's first command green.

- [ ] **Step 7: Commit**

```bash
git add server/src/collectLane.ts server/test/collect-readers.test.ts
git commit -m "$(cat <<'MSG'
feat(reclaim): the collector's two readers, and the probe and refusal tables pinned both ways against ccd

parseCollectAudit reads ws-audit --collect (spec §5.10). Only an exact
collectable at exit 0, with a 64-hex token, a witness it can vouch for and a
resume key that is absent or a word, is spendable, and its cast is the shipped
tree's one cast to CollectToken. Exit 1 reads unmeasured alone, an unknown
verdict is a verdict, never spent, and no document is its own arm. Every
document's witness run and leaf are carried, and a witness the reader cannot
vouch for makes any document unreadable. The lane's live marker,
collect-lane-live, is spelled once here (R82).
parseCollectResult reads ws-collect. collected must name the id. A refusal
keeps ccd's word, which a total table classes; an unknown word is a retry. No
document has three arms, never folded: the recognised pre-lock dies, matched
whole against texts read off cmd_ws_collect (lock-unopenable for this id's
lock only), and everything else, which may have acted. The probe classes are
pinned both ways against _ws_collect_unmeasured's call sites and the walk
words _ws_collect_eval admits. Neither reader borrows reclaim's (a scan), and
the real verbs' documents are read in a fixture HOME.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

---

### Task 3: The population: two listings read exactly, one id predicate before any argv, a pre-filter that never hides a record, and forgetting only on two measured listings

**Model routing:** **`opus`, effort `xhigh`** (SAFETY). This task decides which names can ever reach an argv of `ws-audit --collect` or `ws-collect` (spec §5.10, the population). The SAFETY lens reads the diff against two sentences: a name that is not an id the lane may take is never audited and never composed, and a name's absence is never read from a listing that was not measured.

**Why (R83, with R66 and spec §5.10's population as R92 amends them):**
- **The reads are Task 6's; the decisions are this task's.** R83's steps 1 and 2 (`lstatMeasured`, then `readdir`, a null listing resolved by `statMeasured`) are the executor's `readCollectPopulation` (Task 6). Each listing reaches L1 as the `CollectListing` this task declares: `listed`, `absent` (a PROVEN absence: an empty listing that is MEASURED, the arm today's `$REG/tmpquarantine` takes, per the pre-flight) or `unmeasured`. The three are never folded.
- **R83's steps 3 and 4.** Names that are not strings, and dot-leading names (the witness writer's `.<id>.<pid>.<rand>.tmp`, review 369 C5's `.<id>.drop.<pid>`), are dropped uncounted. A listing of more than `COLLECT_POPULATION_MAX` = 1024 names is unmeasured, and only its count is said.
- **The id predicate gates the population BEFORE any argv.** It is ONE L0 predicate, Task 1's `isTmpRootId`: wave 8's private `leafIdOk` (server/src/childReclaimSweep.ts:1643 at `d0c2b7803`; `grep -n '^const leafIdOk' server/src/childReclaimSweep.ts`), lifted and widened. ccd's own `_ws_tmproot_id_ok` (ccd/ccd:21072; `grep -n '^_ws_tmproot_id_ok()' ccd/ccd`) admits a leading `-`, while every redirect pattern in ccd's three flag loops begins `--` and `isSessionIdShape` (shared/api.ts:6229; `grep -n '^export function isSessionIdShape' shared/api.ts`) refuses `=`. So `!id.startsWith('-')` closes every redirect (R83, measured). This task applies the predicate to every name; Task 6 asserts it again on `job.id` at its step 1, a separate check with its own mutation row. A name that fails it is COUNTED (`refusedNames`) and never carried, because it is untrusted same-uid input.
- **Record names are parsed exactly as ccd parses them**, by `_ws_collect_rec_id` (ccd/ccd:32252, its regex at :32256; `grep -n "local LC_ALL=C re='^(.+)" ccd/ccd`): greedy `^(.+)\.([0-9]+)\.([0-9]+)$`, and the id must pass the predicate. A record is never matched by an `<id>.*` prefix, because ids admit dots. A test holds `COLLECT_RECORD_NAME_RE.source` equal to ccd's text, on the pattern of `child-reclaim-generation-shape.test.ts`.
- **The population** is the witnessed ids together with the record ids. A record-only id is audited like any other.
- **Either listing unmeasured:** the measured listing's ids only. The unmeasured listing is named in `unmeasured`, for Task 5's ONE box-wide line, and no absence is read from it.
- **The pre-filter is economy, never permission, and never hides a record.** An id is not a candidate this pass while its EXACT `<id>.child` or `<id>.uuid` is among the tick's registry names, unless a record in the MEASURED `tmpquarantine` listing names it. The registry names are `RegistryRead.names`, the raw `$REG` listing every sweep already receives (server/src/registry.ts:1110; server/src/watch.ts:1943-1952; `grep -n 'registryRead.names)' server/src/watch.ts`). The record exception exists because ccd answers a retaken path `quarantine-kept` above its `registered` rung, so that a kept record is never silent (§14 as built, `crash-at-moved-residual-widened`). The lookup is exact: `a` is audited while a row `a.b` stands. A row's absence licenses nothing, because ccd's own `registered` rung decides.
- **Forgetting.** An id is forgotten, with its pacing and feed episodes and without a feed row, only when BOTH listings were measured and neither names it. A pre-filtered id is not forgotten.

**Readings this task takes (each named for the coordinator):**
- `population-cap-counts-the-raw-listing`. R83 lists the cap as step 4, after step 3's drop. This task counts the RAW listing, so a flood of dot-leading names reads unmeasured too. That is only stricter, and it is the flood step 4 exists for.
- `junk-quarantine-names-are-refused-names`. A non-dot name in `tmpquarantine` that is no record of an id the lane may take (junk, or a dash-leading id's record) is counted in `refusedNames`, exactly as a refused witness name is.
- `population-ids-and-candidates-split`. The population carries `ids` (what forgetting reads) and `candidates` (`ids` less the pre-filter) separately, so a pre-filtered id keeps its pacing and its episodes.

**Files:**
- Modify: `server/src/collectLane.ts` (Task 2 created it).
  - Its `'../../shared/api.js'` import gains `isTmpRootId`, if Task 2's block does not already import it.
  - The population block is appended below Task 2's readers.
- Test (new): `server/test/collect-population.test.ts`.
- NOT edited:
  - `shared/api.ts`: Task 1 declared `isTmpRootId` and `TMPROOT_ID_MAX_CHARS`, and re-pointed `leafIdOk` and `store.ts`'s `CHILD_RECLAIM_MAX_SESSION_ID_CHARS` to them;
  - `server/src/childReclaimSweep.ts`, `server/src/coord/store.ts`;
  - `server/src/coord/collectTempRoot.ts` (Task 6 makes the reads) and `server/src/watch.ts` (Task 7 calls this);
  - ccd, the agent and the PWA.

**Interfaces:**
- Produces (`server/src/collectLane.ts`, L1, pure):
  ```ts
  export const COLLECT_POPULATION_MAX = 1024;
  export type CollectListingName = 'tmproots' | 'tmpquarantine';
  export type CollectListing =
    | { readonly kind: 'listed'; readonly names: readonly string[] }
    | { readonly kind: 'absent' }
    | { readonly kind: 'unmeasured'; readonly why: string };
  export type CollectListingDoubt =
    | { readonly listing: CollectListingName; readonly kind: 'unmeasured'; readonly why: string }
    | { readonly listing: CollectListingName; readonly kind: 'over-cap'; readonly count: number };
  export interface CollectPopulation {
    readonly ids: readonly string[];            // every id a MEASURED listing names, sorted: what forgetting reads
    readonly candidates: readonly string[];     // `ids` less the pre-filter, sorted: what this pass may audit
    readonly recordIds: ReadonlySet<string>;    // ids a record in the MEASURED tmpquarantine names
    readonly refusedNames: number;              // the count only, never a name
    readonly unmeasured: readonly CollectListingDoubt[];
    readonly bothMeasured: boolean;
  }
  export const COLLECT_RECORD_NAME_RE: RegExp;  // /^(.+)\.([0-9]+)\.([0-9]+)$/, ccd's text, no flag
  export function parseCollectRecordName(name: string): string | null;   // null: no record of an id the lane may take
  export function collectPopulation(input: {
    readonly tmproots: CollectListing; readonly tmpquarantine: CollectListing; readonly registryNames: ReadonlySet<string>;
  }): CollectPopulation;
  export const collectForgets: (pop: CollectPopulation, id: string) => boolean;
  ```
- Consumes:
  - Task 1 (`shared/api.ts`'s foot): `TMPROOT_ID_MAX_CHARS = 255` and `isTmpRootId(id: unknown): id is string`.
  - Task 2: `server/src/collectLane.ts` as it created it, importing `'../../shared/api.js'` alone.
  - ccd's `_ws_collect_rec_id` text, read by the test as text only.
  - Existing: `CCD` (server/test/ccdWsHelpers.ts:24; `grep -n '^export const CCD' server/test/ccdWsHelpers.ts`).
- Consumed later by:
  - Task 6: `readCollectPopulation` returns `{ tmproots: CollectListing; tmpquarantine: CollectListing }`.
  - Task 5: the box-wide lines, from `unmeasured` and a non-zero `refusedNames`.
  - Task 7: the pass calls `collectPopulation({ ...listings, registryNames: new Set(names) })`, offers `candidates`, and forgets by `collectForgets`.

- [ ] **Step 0: Entry conditions**

Tasks 1 and 2 are committed on this branch. Measure:

```bash
grep -n '^export const TMPROOT_ID_MAX_CHARS = 255;' shared/api.ts                     # Task 1: one line
grep -n 'export.*isTmpRootId' shared/api.ts                                            # Task 1: (id: unknown): id is string
grep -n "from '" server/src/collectLane.ts                                             # Task 2: '../../shared/api.js' (and at most './childReclaimSweep.js')
grep -c 'collectPopulation\|parseCollectRecordName\|COLLECT_POPULATION_MAX\|CollectListing' server/src/collectLane.ts   # 0
grep -n "^_ws_collect_rec_id()\|local LC_ALL=C re='^(.+)" ccd/ccd                      # :32252 and :32256 at d0c2b7803
```

If `isTmpRootId` is missing, or is not typed `(id: unknown): id is string`, STOP and report: it is Task 1's, and this task never declares a second one. If `collectLane.ts` imports anything but `'../../shared/api.js'` (and, if Task 2 needed it, `'./childReclaimSweep.js'`), STOP and report: Task 4 pins the file's import set to those two.

- [ ] **Step 1: Write the failing test**

Create `server/test/collect-population.test.ts`:

```ts
// The temp-root collector's population (child-reclamation spec §5.10, "the population"). The lane lists
// `$REG/tmproots` and `$REG/tmpquarantine`, never `~/.cc-tmp`. These rows pin the PURE half (L1,
// `server/src/collectLane.ts`): which names become ids, which ids this pass may audit, and which are forgotten. The
// two reads are the executor's (`coord/collectTempRoot.ts`'s `readCollectPopulation`); here the listings are
// literals. No ccd runs and no HOME is touched: ccd/ccd is read as TEXT only, for the record grammar.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TMPROOT_ID_MAX_CHARS } from '../../shared/api.js';
import {
  COLLECT_POPULATION_MAX, COLLECT_RECORD_NAME_RE, collectForgets, collectPopulation, parseCollectRecordName,
  type CollectListing, type CollectPopulation,
} from '../src/collectLane.js';
import { CCD } from './ccdWsHelpers.js';

const listed = (...names: string[]): CollectListing => ({ kind: 'listed', names });
const ABSENT: CollectListing = { kind: 'absent' };
const unmeasured = (why: string): CollectListing => ({ kind: 'unmeasured', why });
const pop = (tmproots: CollectListing, tmpquarantine: CollectListing = ABSENT, registry: readonly string[] = []):
  CollectPopulation => collectPopulation({ tmproots, tmpquarantine, registryNames: new Set(registry) });
/** `n` distinct ids that each pass the predicate. */
const many = (n: number, prefix = 'id-'): string[] => Array.from({ length: n }, (_, k) => `${prefix}${k}`);

/** The ONE `re='…'` inside ccd's `_ws_collect_rec_id`, as written there. */
const ccdRecordGrammar = (): string => {
  const src = readFileSync(CCD, 'utf8');
  const at = src.indexOf('\n_ws_collect_rec_id() {');
  if (at < 0) throw new Error('_ws_collect_rec_id not found in ccd/ccd');
  const end = src.indexOf('\n}\n', at);
  if (end < 0) throw new Error('_ws_collect_rec_id has no closing brace');
  const found = [...src.slice(at, end).matchAll(/ re='([^']+)'/g)];
  if (found.length !== 1) throw new Error(`expected one re='…' in _ws_collect_rec_id, found ${found.length}`);
  return found[0]![1]!;
};

describe('a quarantine record\'s name (parseCollectRecordName)', () => {
  it('is ccd\'s `_ws_collect_rec_id` grammar, verbatim, and carries no flag', () => {
    expect(COLLECT_RECORD_NAME_RE.source).toBe(ccdRecordGrammar());
    expect(COLLECT_RECORD_NAME_RE.flags, 'a g flag makes .exec stateful').toBe('');
  });

  const A255 = 'a'.repeat(TMPROOT_ID_MAX_CHARS);
  it.each<readonly [string, string, string | null]>([
    ['a dotted id keeps its dots', 'a.b.17.42', 'a.b'],
    ['a plain id', 'demo-a.1790000000000000000.4242', 'demo-a'],
    ['greedy: only the two trailing fields go', 'a.1.2.3', 'a.1'],
    ['an all-digit id', '1.2.3', '1'],
    ['one trailing field is no record', 'a-b.17', null],
    ['a field that is not all digits', 'a-b.17.x', null],
    ['nothing after the last digits', 'a.1.2x', null],
    ['a dot-leading id', '.a.1.2', null],
    ['a dash-leading id', '-x.1.2', null],
    ['a redirect flag', '--actor.1.2', null],
    ['a space', 'a b.1.2', null],
    ['a newline', 'a\n.1.2', null],
    ['an id of the cap', `${A255}.1.2`, A255],
    ['an id one over the cap', `${A255}a.1.2`, null],
  ])('%s', (_label, name, id) => {
    expect(parseCollectRecordName(name)).toBe(id);
  });
});

describe('the two listings', () => {
  it('a proven-absent listing is empty and MEASURED', () => {
    expect(pop(ABSENT, ABSENT)).toEqual({
      ids: [], candidates: [], recordIds: new Set(), refusedNames: 0, unmeasured: [], bothMeasured: true,
    });
  });

  it('an unmeasured listing gives no id and names itself; the measured side is still read', () => {
    expect(pop(unmeasured('symlink'), listed('b.1.2'))).toEqual({
      ids: ['b'], candidates: ['b'], recordIds: new Set(['b']), refusedNames: 0,
      unmeasured: [{ listing: 'tmproots', kind: 'unmeasured', why: 'symlink' }], bothMeasured: false,
    });
    expect(pop(listed('a'), unmeasured('read-failed'))).toEqual({
      ids: ['a'], candidates: ['a'], recordIds: new Set(), refusedNames: 0,
      unmeasured: [{ listing: 'tmpquarantine', kind: 'unmeasured', why: 'read-failed' }], bothMeasured: false,
    });
  });

  it('a dot-leading name (a writer\'s temp file) and a name that is not a string are dropped, uncounted', () => {
    const odd = [42, null, undefined, { name: 'a' }] as unknown as string[];
    expect(pop(listed('.a.123.456.tmp', '.a.drop.9', 'a', ...odd), listed('.b.1.2', '.tmp'))).toMatchObject({
      ids: ['a'], refusedNames: 0, bothMeasured: true,
    });
  });

  it(`a listing of ${COLLECT_POPULATION_MAX} names is read, and one more makes it unmeasured, by its count alone`, () => {
    expect(COLLECT_POPULATION_MAX, 'HARDCODED on purpose: the mutation control for the cap').toBe(1024);
    const full = pop(listed(...many(COLLECT_POPULATION_MAX)));
    expect(full.ids).toHaveLength(COLLECT_POPULATION_MAX);
    expect(full.bothMeasured).toBe(true);
    const over = pop(listed(...many(COLLECT_POPULATION_MAX + 1)), listed(...many(COLLECT_POPULATION_MAX + 1, 'r').map((n) => `${n}.1.2`)));
    expect(over).toEqual({
      ids: [], candidates: [], recordIds: new Set(), refusedNames: 0, bothMeasured: false,
      unmeasured: [
        { listing: 'tmproots', kind: 'over-cap', count: COLLECT_POPULATION_MAX + 1 },
        { listing: 'tmpquarantine', kind: 'over-cap', count: COLLECT_POPULATION_MAX + 1 },
      ],
    });
  });

  it("the cap counts the RAW listing: dot-leading names cost the lane's memory as much as any other", () => {
    const names = [...many(COLLECT_POPULATION_MAX).map((n) => `.${n}.tmp`), 'a'];
    expect(pop(listed(...names)).unmeasured).toEqual([{ listing: 'tmproots', kind: 'over-cap', count: COLLECT_POPULATION_MAX + 1 }]);
  });
});

describe('the id predicate gates the population before any argv', () => {
  const REDIRECTS = ['--actor', '--surface', '--reason', '--expect', '--session', '--', '-h', '-x'];

  it('a dash-leading name is never an id, as a witness or as a record, and is counted', () => {
    const p = pop(listed(...REDIRECTS), listed(...REDIRECTS.map((r) => `${r}.1.2`)));
    expect(p).toEqual({
      ids: [], candidates: [], recordIds: new Set(), refusedNames: 2 * REDIRECTS.length, unmeasured: [], bothMeasured: true,
    });
  });

  it('a name that only CONTAINS a dash or a dot is audited as itself', () => {
    expect(pop(listed('a--actor', 'a.--actor'), listed('b--actor.1.2')).candidates).toEqual(['a--actor', 'a.--actor', 'b--actor']);
  });

  it(`an id of ${TMPROOT_ID_MAX_CHARS} characters is taken, and one of ${TMPROOT_ID_MAX_CHARS + 1} is refused`, () => {
    expect(TMPROOT_ID_MAX_CHARS, 'HARDCODED on purpose').toBe(255);
    const ok = 'a'.repeat(TMPROOT_ID_MAX_CHARS);
    const long = 'b'.repeat(TMPROOT_ID_MAX_CHARS + 1);
    expect(pop(listed(ok, long))).toMatchObject({ ids: [ok], refusedNames: 1 });
  });

  it('a name outside the session-id shape, or a junk name in the records\' directory, is counted and never an id', () => {
    expect(pop(listed('a b', 'a/b', 'a=b', 'ok'), listed('junk', 'b.1', 'c.1.2'))).toMatchObject({
      ids: ['c', 'ok'], refusedNames: 5,
    });
  });

  it('the population carries the COUNT of refused names, never a name', () => {
    expect(JSON.stringify([...Object.entries(pop(listed('--actor', 'a'), listed('--surface.1.2')))]))
      .not.toMatch(/actor|surface/);
  });
});

describe('the population: the witnessed ids together with the record ids', () => {
  it('is their union, each id once, a record-only id among them', () => {
    expect(pop(listed('a', 'b'), listed('b.1.2', 'b.3.4', 'c.5.6'))).toMatchObject({
      ids: ['a', 'b', 'c'], candidates: ['a', 'b', 'c'], recordIds: new Set(['b', 'c']),
    });
  });

  it('is ordered by id, never by listing order', () => {
    expect(pop(listed('z', 'a', 'm')).candidates).toEqual(['a', 'm', 'z']);
  });
});

describe('the pre-filter: economy, never permission, and never hiding a record', () => {
  it('an id whose EXACT `<id>.child` or `<id>.uuid` is in the registry is not audited, and not forgotten', () => {
    for (const row of ['a.child', 'a.uuid']) {
      const p = pop(listed('a', 'b'), ABSENT, [row]);
      expect(p.candidates, row).toEqual(['b']);
      expect(p.ids, row).toEqual(['a', 'b']);
      expect(collectForgets(p, 'a'), row).toBe(false);
    }
  });

  it('the lookup is exact, never a prefix: `a` is audited while a row of `a.b` stands', () => {
    expect(pop(listed('a'), ABSENT, ['a.b.uuid', 'a.b.child', 'a.uuidx', 'xa.uuid', 'a.hold', 'a.workdir']).candidates)
      .toEqual(['a']);
  });

  it('a record in the MEASURED records\' listing lifts it: a kept record is never silent', () => {
    expect(pop(listed('a'), listed('a.1.2'), ['a.uuid', 'a.child']).candidates).toEqual(['a']);
  });

  it('only a record of the id itself lifts it, and only from a measured listing', () => {
    expect(pop(listed('a'), listed('a.b.1.2'), ['a.uuid']).candidates).toEqual(['a.b']);
    expect(pop(listed('a'), unmeasured('symlink'), ['a.uuid']).candidates).toEqual([]);
  });
});

describe('forgetting', () => {
  it('only when BOTH listings were measured and neither names the id', () => {
    const p = pop(listed('a'), listed('b.1.2'));
    expect(['a', 'b', 'c'].map((id) => collectForgets(p, id))).toEqual([false, false, true]);
  });

  it('never while either listing is unmeasured, whatever the reason', () => {
    for (const p of [
      pop(unmeasured('symlink'), listed()), pop(listed(), unmeasured('read-failed')),
      pop(listed(...many(COLLECT_POPULATION_MAX + 1)), ABSENT),
    ]) {
      expect(collectForgets(p, 'gone'), JSON.stringify(p.unmeasured)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-population.test.ts
```

Expected: FAIL, 33 of 33 (re-measure). Vitest binds a missing named export to `undefined`; it raises no SyntaxError.
- Every population case fails at `TypeError: collectPopulation is not a function`.
- Every record-name row fails at `TypeError: parseCollectRecordName is not a function`.
- The grammar case fails at `TypeError: Cannot read properties of undefined (reading 'source')`.
- The cap case's title reads `a listing of undefined names …`, and it fails at `expected undefined to be 1024`.

- [ ] **Step 3: Implement (`server/src/collectLane.ts`)**

3a. If the file's `'../../shared/api.js'` import does not name `isTmpRootId`, add it there. Add no other import.

3b. Append, below the last line of Task 2's readers:

```ts
/* ── THE POPULATION (child-reclamation spec §5.10, "the population") ─────────────────────────────────────────────────
 * The lane finds the temp roots it may collect by listing `$REG/tmproots` (one witness per id) and
 * `$REG/tmpquarantine` (one record per collection begun and not finished), never `~/.cc-tmp`. This block decides,
 * purely, which names become ids, which ids are audited this pass and which are forgotten. The executor's
 * `readCollectPopulation` (`coord/collectTempRoot.ts`) makes the two reads; nothing here reads a file. */

/** The most names one listing may carry before the lane reads it as unmeasured (spec §5.10, the population). A
 *  session of this uid can write any number of names into either directory; past this many, the lane neither audits
 *  nor forgets from that listing, and says the count alone. Counted over the RAW listing, dot-leading names included,
 *  because they cost the lane's memory as much as any other name. STATED RESIDUAL: the cap bounds what the lane
 *  audits and remembers, not the listing itself: the agent's readdir returns every name in one frame, as the
 *  registry's own $REG listing already does every tick. */
export const COLLECT_POPULATION_MAX = 1024;

/** The two registry subdirectories the lane lists, by the name its box-wide line gives each. */
export type CollectListingName = 'tmproots' | 'tmpquarantine';

/** One listing as the executor measured it (spec §5.10): `listed` (a real directory, read), `absent` (a PROVEN
 *  absence, an empty listing that is MEASURED), or `unmeasured` (a link, a file, a FIFO, a read that failed: the
 *  listing says nothing about any id, and `why` says which). Never folded: an `unmeasured` listing is never empty. */
export type CollectListing =
  | { readonly kind: 'listed'; readonly names: readonly string[] }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unmeasured'; readonly why: string };

/** Why one listing gave the lane no ids this pass: the executor could not measure it, or it carried more than
 *  `COLLECT_POPULATION_MAX` names (`count`, the raw count, the only thing said of them). */
export type CollectListingDoubt =
  | { readonly listing: CollectListingName; readonly kind: 'unmeasured'; readonly why: string }
  | { readonly listing: CollectListingName; readonly kind: 'over-cap'; readonly count: number };

/** One pass's population (spec §5.10).
 *  - `ids`: every id a MEASURED listing names, as a witness or as a record's id, sorted. What forgetting reads.
 *  - `candidates`: the ids this pass may audit: `ids` less the pre-filter, sorted.
 *  - `recordIds`: the ids a record in the MEASURED `tmpquarantine` listing names.
 *  - `refusedNames`: how many names, dot-leading ones aside, are no id the lane may take. The names themselves are
 *    never carried: they are untrusted same-uid input, and a sentence says the count alone.
 *  - `unmeasured`: each listing that gave no ids, and why.
 *  - `bothMeasured`: neither listing is in `unmeasured`, so an id neither names is gone from both. */
export interface CollectPopulation {
  readonly ids: readonly string[];
  readonly candidates: readonly string[];
  readonly recordIds: ReadonlySet<string>;
  readonly refusedNames: number;
  readonly unmeasured: readonly CollectListingDoubt[];
  readonly bothMeasured: boolean;
}

/** A quarantine record's name, `<id>.<ns>.<pid>` (spec §5.10, the quarantine record): ccd's own `_ws_collect_rec_id`
 *  grammar, held equal to its text by a test. GREEDY: the id is what the two trailing all-digit dot-fields leave,
 *  never an `<id>.*` prefix, because ids admit dots. No flag: `g` would make `.exec` stateful. */
export const COLLECT_RECORD_NAME_RE = /^(.+)\.([0-9]+)\.([0-9]+)$/;

/** The id a quarantine record's name is for, or null when the name is no record's: it does not match the grammar,
 *  or what it names is not an id the lane may take (`isTmpRootId`, L0's ONE temp-root id predicate). */
export function parseCollectRecordName(name: string): string | null {
  const id = COLLECT_RECORD_NAME_RE.exec(name)?.[1];
  return id !== undefined && isTmpRootId(id) ? id : null;
}

/** The pass's population from its two listings and the tick's registry names (spec §5.10, the population). Pure.
 *  - A proven-absent listing is empty and MEASURED. An unmeasured listing, or one of more than
 *    `COLLECT_POPULATION_MAX` names, gives NO ids, and the other listing is still read: the lane audits the measured
 *    side only, and never reads a name's absence from an unmeasured listing.
 *  - A name that is not a string, or that leads with `.` (a writer's temp file), is dropped uncounted.
 *  - Every other name must be an id (`isTmpRootId`) in `tmproots`, or a record's name for one
 *    (`parseCollectRecordName`) in `tmpquarantine`, or it is counted in `refusedNames` and never becomes an id. This
 *    is the gate before any argv: a name that fails it is never audited and never composed.
 *  - THE PRE-FILTER is economy, never permission: an id is not a candidate while its EXACT `<id>.child` or `<id>.uuid`
 *    is among `registryNames`, unless a record in the measured `tmpquarantine` names it, because a kept record is
 *    never silent. Never a prefix: a row of `a.b` filters nothing of `a`. A row's absence licenses nothing: ccd's own
 *    `registered` rung decides. */
export function collectPopulation(input: {
  readonly tmproots: CollectListing;
  readonly tmpquarantine: CollectListing;
  readonly registryNames: ReadonlySet<string>;
}): CollectPopulation {
  const unmeasured: CollectListingDoubt[] = [];
  let refusedNames = 0;
  /** A listing's readable names, or null when it gives no ids this pass. */
  const namesOf = (listing: CollectListingName, l: CollectListing): readonly string[] | null => {
    switch (l.kind) {
      case 'absent': return [];
      case 'unmeasured': unmeasured.push({ listing, kind: 'unmeasured', why: l.why }); return null;
      case 'listed':
        if (l.names.length > COLLECT_POPULATION_MAX) {
          unmeasured.push({ listing, kind: 'over-cap', count: l.names.length });
          return null;
        }
        return l.names.filter((n) => typeof n === 'string' && !n.startsWith('.'));
    }
  };
  const witnessed = new Set<string>();
  for (const n of namesOf('tmproots', input.tmproots) ?? []) {
    if (isTmpRootId(n)) witnessed.add(n); else refusedNames += 1;
  }
  const recordIds = new Set<string>();
  for (const n of namesOf('tmpquarantine', input.tmpquarantine) ?? []) {
    const id = parseCollectRecordName(n);
    if (id !== null) recordIds.add(id); else refusedNames += 1;
  }
  const ids = [...new Set([...witnessed, ...recordIds])].sort();
  const rowStands = (id: string): boolean =>
    input.registryNames.has(`${id}.child`) || input.registryNames.has(`${id}.uuid`);
  const candidates = ids.filter((id) => recordIds.has(id) || !rowStands(id));
  return { ids, candidates, recordIds, refusedNames, unmeasured, bothMeasured: unmeasured.length === 0 };
}

/** Is `id` forgotten this pass, its pacing and feed episodes dropped without a feed row (spec §5.10)? Only when BOTH
 *  listings were measured and neither names it: an unmeasured listing never says an id is gone. */
export const collectForgets = (pop: CollectPopulation, id: string): boolean => pop.bothMeasured && !pop.ids.includes(id);
```

- [ ] **Step 4: Run to pass**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-population.test.ts
cd server && ./node_modules/.bin/vitest run $(ls test/collect-*.test.ts)
```

Expected: PASS, `collect-population` at 33/33 (re-measure), and every suite Task 2 added unchanged. Run in the FOREGROUND, under 600 s.

- [ ] **Step 5: Types**

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p .
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

`tsc` prints nothing. `typecheck-tests` is a known load flake: re-run it alone before reading a red as a break.

- [ ] **Step 6: Mutation check**

Make each mutation alone on the Step 4 tree, run `cd server && ./node_modules/.bin/vitest run test/collect-population.test.ts` in the FOREGROUND, see the stated red, then revert. Every row was measured on a scratch copy at `d0c2b7803` with Tasks 1 and 2 stubbed; re-measure, and a measured text replaces the one below. Rows 15 and 16 mutate Task 1's predicate: they show that the population reds through it, and Task 1 keeps its own rows.

| # | Mutation (exact edit) | Case | Expected red |
|---|---|---|---|
| 1 | `COLLECT_POPULATION_MAX = 1024` → `= 1025` | `one more makes it unmeasured` | `HARDCODED on purpose: the mutation control for the cap: expected 1025 to be 1024` |
| 2 | `l.names.length > COLLECT_POPULATION_MAX` → `>=` | `one more makes it unmeasured` | `expected [] to have a length of 1024 but got +0` |
| 3 | In `namesOf`'s filter, delete `&& !n.startsWith('.')` | `a dot-leading name` | `expected { ids: [ 'a' ], …(5) } to match object { … }`: the dot names are counted as refused |
| 4 | In `namesOf`'s filter, delete `typeof n === 'string' && ` | `a dot-leading name` | `TypeError: n.startsWith is not a function` |
| 5 | `if (isTmpRootId(n)) witnessed.add(n); else refusedNames += 1;` → `witnessed.add(n);` | `a dash-leading name is never an id`; `never a name`; `256 is refused`; `junk name` | `expected { Object (ids, candidates, ...) } to deeply equal { ids: [], candidates: [], …(4) }`; `expected '[["ids",["--actor","a"]],…' not to match /actor\|surface/` |
| 6 | In `parseCollectRecordName`, `id !== undefined && isTmpRootId(id) ? id : null` → `id !== undefined ? id : null` | `a dot-leading id`; `a dash-leading id`; `a redirect flag`; `a space`; `an id one over the cap` | `expected '.a' to be null`; `expected '-x' to be null`; `expected '--actor' to be null` |
| 7 | Drop the `$` from `COLLECT_RECORD_NAME_RE` | `grammar, verbatim`; `nothing after the last digits` | `expected '^(.+)\.([0-9]+)\.([0-9]+)' to be '^(.+)\.([0-9]+)\.([0-9]+)$'`; `expected 'a' to be null` |
| 8 | `ids.filter((id) => recordIds.has(id) \|\| !rowStands(id))` → `ids.filter((id) => !rowStands(id))` | `a kept record is never silent` | `expected [] to deeply equal [ 'a' ]` |
| 9 | `rowStands`'s body → ``[...input.registryNames].some((n) => n.startsWith(`${id}.`))`` | `exact, never a prefix` | `expected [] to deeply equal [ 'a' ]` |
| 10 | `rowStands`'s body → ``input.registryNames.has(`${id}.uuid`)`` | `is not audited, and not forgotten` | `a.child: expected [ 'a', 'b' ] to deeply equal [ 'b' ]` |
| 11 | `bothMeasured: unmeasured.length === 0` → `bothMeasured: true` | `never while either listing is unmeasured`; `an unmeasured listing gives no id` | `[{"listing":"tmproots","kind":"unmeasured","why":"symlink"}]: expected true to be false` |
| 12 | In `collectForgets`, delete `pop.bothMeasured && ` | `never while either listing is unmeasured` | `[{"listing":"tmproots","kind":"unmeasured","why":"symlink"}]: expected true to be false` |
| 13 | `case 'absent': return [];` → `case 'absent': unmeasured.push({ listing, kind: 'unmeasured', why: 'absent' }); return null;` | `a proven-absent listing is empty and MEASURED` | `expected { ids: [], candidates: [], …(4) } to deeply equal { ids: [], candidates: [], …(4) }` (an `unmeasured` entry, `bothMeasured: false`) |
| 14 | Delete `.sort()` from `ids` | `ordered by id`; `junk name` | `expected [ 'z', 'a', 'm' ] to deeply equal [ 'a', 'm', 'z' ]` |
| 15 | In Task 1's `isTmpRootId`, delete the `!id.startsWith('-')` clause | `a dash-leading id`; `a redirect flag`; `a dash-leading name is never an id` | `expected '-x' to be null`; `expected '--actor' to be null` |
| 16 | In Task 1's `isTmpRootId`, `<= TMPROOT_ID_MAX_CHARS` → `<= TMPROOT_ID_MAX_CHARS + 1` | `an id one over the cap`; `256 is refused` | `expected 'aaaa…' to be null`; `expected { ids: [ …(2) ], …(5) } to match object { …(2) }` |
| 17 | In the `tmpquarantine` loop, `if (id !== null) recordIds.add(id); else refusedNames += 1;` → `if (id !== null) recordIds.add(id);` | `a dash-leading name is never an id`; `junk name` | `expected { ids: [ 'c', 'ok' ], …(5) } to match object { ids: [ 'c', 'ok' ], refusedNames: 5 }` |

One edit stayed green on the scratch copy and is not a guard: returning `[]` instead of `null` from `namesOf`'s `unmeasured` arm. The doubt is pushed either way, so both give no ids.

- [ ] **Step 7: Commit**

```bash
git add server/src/collectLane.ts server/test/collect-population.test.ts
git commit -m "$(cat <<'MSG'
feat(collect): the collector's population, read from two listings

The temp-root collector finds its ids by listing $REG/tmproots and
$REG/tmpquarantine, never ~/.cc-tmp. A proven-absent listing is empty
and measured. An unmeasured listing, or one of more than 1024 names,
gives no ids, and the other listing is still read. Dot-leading names
are dropped. Every other name must pass the one temp-root id predicate,
as a witness or as a quarantine record's id parsed exactly as ccd
parses it, or it is counted and never audited, so no dash-leading name
can reach an argv. An id whose exact .child or .uuid stands in the
registry is not audited this pass, unless a measured record names it.
An id is forgotten only when both listings were measured and neither
names it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: The licence and the pacing: two observations under captured generations, a deferral count and three runs on wave 8's imported formula, and the latest-of next ask

**Model routing:** **`opus`, effort `xhigh`** (SAFETY). `collectLicence` is the ONE rule under which the lane may spend a `ws-collect` token (spec §5.10), and the pacing decides how often a destructive verb and a journaled audit are asked for. The SAFETY lens reads the diff against two sentences. Nothing is licensed but two fresh `collectable` answers of one token, the interval apart, with nothing between them and neither composed before a reset. And no wait is shorter than wave 8's formula gives.

**Why:**
- **R85, the licence, one L1 function** (`collectLicence`). The token is spent only when observation 1, an earlier audit, answered `collectable` with T; observation 2, the executor's own audit in the act's job, answers `collectable` with the same T; observation 2 ARRIVED at least the interval after observation 1 arrived, on the monotonic clock; and every answer between was `collectable` with T. Any other answer resets the pair. The interval is an ARGUMENT: `COLLECT_OBSERVE_INTERVAL_MS` lives in `watch.ts` (Task 7), and L1 imports no L4 constant, as `childReclaimNextEntry` takes `passIntervalMs`. All three token modes take the rule. The token is a comparand: the licence carries none, and the argv's token is observation 2's own (Task 6, pinned by Task 8's scan).
- **R85, stale answers.** A reset is anything that clears a pair: a verb outcome, any other answer for the id, the hold, the presence defer, a would-collect, and the lane-wide clears (a raised pause or an unlistable registry, a missing capability, a pass that failed shut, a marker flip). The lane keeps a lane-wide clear generation and a per-id one. Both are captured when a request is composed (`collectCapture`), and the answer is an observation only if both are unchanged when it arrives (`collectFresh`). Step 6's synchronous re-read of observation 1 is `collectLicenceStands`, which the executor calls through its port (H3): the generations captured when observation 2 was composed, the port's `generations(id)` now (a forgotten id's `id` is -1, a generation no entry carries) and its `observation(id)`.
- **R85, memory only.** Nothing is written to coord.db or any file, and a restart needs two fresh observations (`collectFirstSighting`). §16 states the residual (H1): every restart, a rollout included, re-enters each terminal and verb-failed id at j = 0, about eight extra journaled terminal audits or failing acts per such id in the 4.5 h after it; the 12-then-6 bound holds between restarts only.
- **R87, what a clear clears.** The OBSERVATION PAIRS only (`collectClearPair`). The next-ask instant, every run and its j, and the feed episodes survive.
- **R87, wave 8's formula, imported, never copied.**
  - `childReclaimTierFrom` (server/src/childReclaimSweep.ts:918 at `d0c2b7803`; `grep -n '^function childReclaimTierFrom' server/src/childReclaimSweep.ts`) gains the `export` keyword and nothing else.
  - `childReclaimTierPaceMs` (:932) and `childReclaimBackoffMs` (:867) are already exported.
  - Wave 8's `childReclaimTierAfterFailure` (:924) is NOT used: it restarts its run on any different countable word, and a collector id answers several classes in turn, so an alternating flood would never reach the tier (the pre-flight's attack). The collector keeps its own three runs, each with its class word as its tier token.
- **R87, the DEFERRAL count.**
  - Advanced by a deferral verdict (`registered`, `in-use`, `paused`, `in-progress`), a box-wide probe, `not-witnessed` (which also clears the three runs, H1), a verb refusal and a recognised pre-lock die.
  - Cleared by any answer that is none of these.
  - Its wait is `childReclaimBackoffMs` over the count, and it never enters a tier.
- **R87, the FAILING run.**
  - Advanced by every load-sensitive or per-leaf `unmeasured` (an unknown probe word is load-sensitive), `lock`, and `no-document`. A per-leaf deterministic probe enters the tier at once; the others enter at the fourth.
  - Cleared only by `collectable`, `changed-recently`, `collected`, `not-witnessed`, or the id leaving both measured listings (Task 3's `collectForgets`).
- **R87, the VERB-FAILED run.**
  - Advanced by the verb's `failed` whose word is not terminal (a reader-made `''` included) and by an act with no document (arms 2 and 3).
  - Cleared only by `collected` and `not-witnessed`. A `collectable` observation NEVER clears it, or a move that fails every time would spend about every second pass for ever (`source-parent-without-owner-write-loops`).
- **R87, the TERMINAL run** (`witness-mismatch`, `quarantine-kept`, `containment-unproven`).
  - Advanced only by a terminal answer, and on the tier at once: an audit's terminal verdict, and a verb refusal or FAILURE whose word is terminal (`refused containment-unproven`, `failed quarantine-kept`), ahead of the refusal and verb-failed rows (H1). A terminal refusal keeps the refusal row's deferral and floor beside it; neither moves the wait, because the tier pace is never under the ceiling.
  - Cleared only by `collected`, `not-witnessed` or leaving both listings. Any other answer between two terminal answers leaves it, its j and its last terminal arrival as they stand.
  - ccd journals a terminal word on EVERY audit that answers one (ccd/ccd:33354-33356; `grep -n '_lc_emit collect refused "\$id" "" verb ws-audit' ccd/ccd`). So the next ask is never sooner than `childReclaimTierPaceMs(j)` after the last terminal arrival: 12 in the first 24 h, then 6 a day.
- **R87, `changed-recently`.** ccd computes `collect.idleAt` (ccd/ccd:33089; `grep -n '_WS_COLLECT_IDLE_AT=\$((' ccd/ccd`) before its floor rung, and every fresh audit walks the whole leaf first.
  - The next ask is `arrivalMono + clamp(idleAt·1000 − arrivalWall, passIntervalMs, 24 h)`. The wall clock is compared once, at arrival, with ccd's stamp (R39's rule).
  - An `idleAt` that is not a finite non-negative integer takes the deferral wait, never NaN.
  - 24 h of `changed-recently` without a break is attention.
- **R87, a verb refusal of any word** resets the pair and is a deferral, and the next learning audit also waits a ceiling after it, as wave 8's `refusedAt` does. So there are at most 96 verb refusals a day per id. A verb `refused not-witnessed` reads as the audit's `not-witnessed` (H7): the three runs clear and the count advances, beside the floor.
- **R87, a recognised pre-lock die (R84 arm 1)** is a deferral, neutral to every run. Every die but `flock-unavailable` (which latches box-wide, Task 7) also takes the refusal floor (`dieAtMono`, a ceiling after it), because a `collectable` observation clears the deferral count and the cycle would otherwise repeat. The same die word recurring for the ceiling is attention (H1): its streak runs through the `collectable` observations, holds and presence defers between, and any other answer or act outcome ends it.
- **R87 and R82, shadow pacing.** A would-collect clears the pair, touches no run, and floors the next learning audit a ceiling after its arrival.
- **R86 and R87, the hold and the presence defer.** Each resets the pair and keeps a continuity clock for its ceiling's attention. The hold waits `CHILD_RECLAIM_DEFER_CEILING_MS` FLAT, never the next pass, and keeps no count of its own (H1 deletes it). Presence waits the ramp over a count of its own, so an open tab never starves other ids.
- **R87, the next ask is the LATEST of every wait that applies,** each counted from its own last arrival: the deferral ramp, each run's pace, the `changed-recently` schedule, the hold's flat ceiling, presence's ramp, the ripening instant of a held observation, and the refusal, die and shadow floors.
- **R88, the feed.** One row per (id, word) episode, quiet on repeats, and one would-collect row per (id, token) episode (R82). The episode memory is in the entry. Task 5's `collectFeedCueOfAudit` and `collectFeedCueOfAct` say which cue each answer carries, and Task 5 writes the bodies. `collectWouldCollectStands` answers whether a would-collect episode stands, for Task 5's projection, with no token carried or cast.
- **R88 and H3, the evidence.** An item's `runId` and leaf are the LATEST document's: a collectable, verdict or unmeasured answer brings its own `witnessRun` and `leaf`; no document and an unreadable one bring none, and the last stands.

**Readings this task takes (each named for the coordinator):**
- `a-stale-answer-paces-but-never-observes` (accepted, H9). R85 defines a stale answer as one that "is an observation only if both are unchanged". This task never lets a stale answer seed or continue an observation, and still applies its PACING, as any answer's. Discarding the pacing too would let each lane-wide clear landing between a terminal audit's compose and its answer buy one more journaled terminal audit: an unbounded count under a flaky registry listing, against R87's 12 a day. H9 accepts it: Task 7 calls `collectAfterAudit` for a stale answer too, with `observes` false.
- `observation-wait-in-the-next-ask` (accepted, H9; now §16's ripening instant, R85). While observation 1 stands, the id's next ask is no sooner than the observation interval after its arrival. So a holder becomes due exactly when it ripens, and the pass offers it the act job, never a learning audit that could only repeat observation 1. This is only slower.
- `failing-run-stays-on-the-tier-once-entered`. A run's `stuck` mark, set by a per-leaf deterministic answer, stands until the run clears. Without it, a load-sensitive answer after a per-leaf one would take the run off the tier, because `childReclaimTierFrom` derives membership from its `stuck` argument.
- `unreadable-and-unknown-verdict-are-failures` (accepted, H9; now §16's own row, H1). An `unreadable` document and an exit-0 verdict word this build does not know each advance the failing run (never spent, retried, and listed at the tier), as an unknown probe word does.
- `changed-recently-without-idleat-is-a-deferral`. "Takes the deferral wait" is read as advancing the deferral count. A `changed-recently` that clears the count and then waits the ramp over zero would re-walk the leaf every pass.
- `verb-terminal-refusal-advances-the-terminal-run` (accepted, H9; now §16's own row, H1). The verb's refusal OR FAILURE of a terminal word is a terminal answer, ahead of the refusal and verb-failed rows: `failed quarantine-kept` advances the terminal run, never the verb-failed run, and a terminal refusal keeps its deferral and floor beside it. It is classed by the verb's refusal table (Task 2's `collectRefusalClass`), and an agreement case holds the two tables to one reading of each word.
- `continuity-measured-answer-to-answer` (accepted, H9). "Continuously past" a span is measured from a streak's first answer to its LATEST, never to `now`, so a cause stands only on evidence. Each is inclusive at its span.
- `hold-and-presence-continuity-survive-observations` (accepted, H9). A `collectable` observation never ends the hold's or presence's continuity, since a held id is re-observed between holds. Every other answer, and every act outcome, ends both.
- `collector-l1-imports-the-formula-file` (accepted, H2). The brief says the lane's L1 file imports `shared/api.js` only, but R87 makes it import wave 8's formula. `collectLane.ts` imports `'./childReclaimSweep.js'`, an L1 file that itself imports L0 alone, and the pacing suite pins that its imports are exactly those two.
- H13's four die and terminal readings (accepted, H13), each named by slug in the wave-done: `flock-unavailable-takes-no-floor`, `would-collect-ends-the-die-streak`, `terminal-refusal-keeps-the-refusal-floor` and `terminal-failure-clears-the-deferral-count`.

**Files:**
- Modify: `server/src/childReclaimSweep.ts`. ONE edit: `function childReclaimTierFrom(` → `export function childReclaimTierFrom(` (:918). No parameter, no widened type, no docstring change, and no reclaim answer changes.
- Modify: `server/test/single-definition.test.ts`. ONE line, edited in place (line-neutral): the archive-door scan's `want` line (:4192 at `d0c2b7803`) excuses `'run-open'` in `server/src/collectLane.ts` by name, as `AUDIT_WORDS` excuses the audit's words (5c). No other line, and no new case. Task 6 adds its own file to that array in its own commit.
- Modify: `server/src/collectLane.ts`.
  - The import block gains the `'./childReclaimSweep.js'` import below, and `type CollectToken` in the `'../../shared/api.js'` import if it is not already there.
  - The licence-and-pacing block is appended below Task 3's population block.
- Create: `server/test/collectAnswers.ts`. The collector's answer builders, ONE helper for every collector suite: a later task adds only names that are not already exported.
- Test (new): `server/test/collect-licence.test.ts` (R85) and `server/test/collect-pacing.test.ts` (R86 to R88's pacing, the attention causes and the feed episode).
- NOT edited:
  - `shared/api.ts`, `server/src/watch.ts` (Task 7 holds the `Map<string, CollectEntry>`, the lane-wide generation and the one generation counter) and `server/src/coord/collectTempRoot.ts` (Task 6 calls `collectLicence` and `collectLicenceStands`; Task 7 folds Task 6's outcome arms through the transitions);
  - every wave 8 suite. Step 6 runs three of them as regressions.

**Interfaces:**
- Produces (`server/src/childReclaimSweep.ts`): `export function childReclaimTierFrom(token: string | null, run: number, stuck: boolean): ChildReclaimTierState` (unchanged body).
- Produces (`server/src/collectLane.ts`, L1, pure):
  ```ts
  export const COLLECT_CHANGED_RECENTLY_SPAN_MS = 24 * 3_600_000;
  export type CollectRunToken = 'failing' | 'verb-failed' | 'terminal';
  export type CollectRun =
    | { readonly kind: 'none' }
    | { readonly kind: 'run'; readonly run: number; readonly atMono: number; readonly stuck: boolean;
        readonly word: string; readonly detail: string };
  export const COLLECT_RUN_NONE: CollectRun;
  export const collectRunTier: (r: CollectRun, token: CollectRunToken) => ChildReclaimTierState;
  export const collectRunWaitMs: (r: CollectRun, token: CollectRunToken, passIntervalMs: number) => number;
  export interface CollectObservation { readonly token: CollectToken; readonly arrivedMono: number }
  export type CollectHoldWhy =
    'run-open' | 'run-absent' | 'run-after-witness' | 'id-in-open-run' | 'no-witness-run' | 'store-unreadable';
  export const COLLECT_HOLD_WHYS: readonly CollectHoldWhy[];
  export type CollectVerdictRow =
    | { readonly pace: 'defer'; readonly listedAfterMs: number | null }
    | { readonly pace: 'schedule'; readonly listedAfterMs: number }
    | { readonly pace: 'silent' } | { readonly pace: 'terminal' };
  export const COLLECT_VERDICT_TABLE: { /* the nine `_ws_collect_refuse` words */ };
  export type CollectVerdictWord = keyof typeof COLLECT_VERDICT_TABLE;
  export const COLLECT_VERDICT_WORDS: readonly CollectVerdictWord[];
  // every field of the six interfaces below is `readonly`
  export interface CollectStreak { word: CollectVerdictWord; sinceMono: number; lastMono: number; detail: string }
  export interface CollectHoldClock { why: CollectHoldWhy; sinceMono: number; atMono: number }   // no count (H1)
  export interface CollectDieStreak { word: CollectDieWord; sinceMono: number; lastMono: number }
  export interface CollectPresence { count: number; sinceMono: number; atMono: number }
  export interface CollectEvidence { runId: number | null; leaf: string | null }                 // the LATEST document's (H3)
  export interface CollectEntry {
    idGen: number; obs: CollectObservation | null; deferrals: number; deferredAtMono: number | null;
    failing: CollectRun; verbFailed: CollectRun; terminal: CollectRun; scheduleMono: number | null;
    refusedAtMono: number | null; wouldCollectAtMono: number | null; dieAtMono: number | null;
    streak: CollectStreak | null; die: CollectDieStreak | null; held: CollectHoldClock | null;
    presence: CollectPresence | null; evidence: CollectEvidence; feedEpisode: string | null;
  }
  export const collectFirstSighting: (gen: number) => CollectEntry;
  export interface CollectStep { readonly now: ChildReclaimLaneNow; readonly gen: number; readonly passIntervalMs: number }
  export interface CollectCapture { readonly lane: number; readonly id: number }
  export const collectCapture: (laneGen: number, e: CollectEntry) => CollectCapture;
  export const collectFresh: (cap: CollectCapture, laneGen: number, e: CollectEntry | undefined) => e is CollectEntry;
  export const collectClearPair: (e: CollectEntry) => CollectEntry;
  export type CollectIdleSchedule = { readonly kind: 'at'; readonly monoMs: number } | { readonly kind: 'no-idle-at' };
  export function collectIdleSchedule(idleAt: number | null, arrival: ChildReclaimLaneNow, passIntervalMs: number): CollectIdleSchedule;
  export function collectAfterAudit(e: CollectEntry, a: CollectAudit, s: CollectStep, observes: boolean): CollectEntry;
  export function collectAfterAct(e: CollectEntry, r: CollectResult, s: CollectStep): CollectEntry;
  export function collectAfterHold(e: CollectEntry, why: CollectHoldWhy, s: CollectStep): CollectEntry;
  export function collectAfterPresence(e: CollectEntry, s: CollectStep): CollectEntry;
  export function collectAfterWouldCollect(e: CollectEntry, s: CollectStep): CollectEntry;
  export function collectNextAskMono(e: CollectEntry, passIntervalMs: number, observeIntervalMs: number): number | null;
  export const collectDue: (e: CollectEntry, nowMono: number, passIntervalMs: number, observeIntervalMs: number) => boolean;
  export const collectRipe: (e: CollectEntry, nowMono: number, passIntervalMs: number, observeIntervalMs: number) => boolean;
  export type CollectLicence =
    | { readonly kind: 'licensed'; readonly first: CollectObservation }
    | { readonly kind: 'stale' | 'not-collectable' | 'no-first' | 'token-changed' | 'too-soon' };
  export function collectLicence(first: CollectObservation | null, second: CollectAudit, secondArrivedMono: number,
    observeIntervalMs: number, observes: boolean): CollectLicence;
  export const collectLicenceStands: (first: CollectObservation, composed: CollectCapture, now: CollectCapture,
    obs: CollectObservation | null) => boolean;
  export type CollectAttentionCause =
    | { readonly kind: 'terminal' | 'failing' | 'verb-failed'; readonly word: string; readonly detail: string }
    | { readonly kind: CollectVerdictWord; readonly detail: string; readonly sinceMono: number }
    | { readonly kind: 'held'; readonly why: CollectHoldWhy; readonly sinceMono: number }
    | { readonly kind: 'presence'; readonly sinceMono: number }
    | { readonly kind: 'die'; readonly word: CollectDieWord; readonly sinceMono: number };
  export function collectAttentionCauses(e: CollectEntry): CollectAttentionCause[];
  export type CollectFeedCue =
    | { readonly kind: 'row'; readonly key: string } | { readonly kind: 'observe'; readonly token: CollectToken }
    | { readonly kind: 'quiet' };
  export const collectWouldCollectKey: (token: CollectToken) => string;
  export const collectWouldCollectStands: (e: CollectEntry) => boolean;
  export function collectFeedStep(e: CollectEntry, cue: CollectFeedCue): { readonly entry: CollectEntry; readonly opened: string | null };
  ```
- Produces (`server/test/collectAnswers.ts`): `PASS`, `OBSERVE`, `MIN`, `DAY`, `WALL0`, `tok`, `T1`, `T2`, `collectable`, `verdict`, `unmeasured`, `NO_DOCUMENT`, `UNREADABLE`, `COLLECTED`, `refusedAct`, `failedAct`, `DIE`, `ACT_NO_DOCUMENT`, `step` (the code below).
- Consumes:
  - Task 1: `type CollectToken`.
  - Task 2, from `server/src/collectLane.ts`: `CollectAudit` in H3's shape (its `verdict` and `unmeasured` arms carry `witnessRun: number | null` and `leaf: string | null` beside the `collectable` arm's), `CollectResult`, `CollectDieWord`, `CollectProbeClass`, `COLLECT_PROBE_CLASS` (keyed by ccd's probe word), `collectProbeClass(probe: string): CollectProbeClass` (an unknown word is `load-sensitive`) and the verb's refusal table's classifier, `collectRefusalClass(word: string): CollectRefusalClass` (`'terminal' | 'retry'`; an unknown word is a `retry`).
  - Task 3: its block, appended to.
  - Wave 8, from `server/src/childReclaimSweep.ts`: `CHILD_RECLAIM_DEFER_CEILING_MS` (:31), `CHILD_RECLAIM_TIER_ENTRY_RUN` (:890, tests only), `childReclaimBackoffMs` (:867), `childReclaimTierPaceMs` (:932), `type ChildReclaimLaneNow` (:41) and `type ChildReclaimTierState` (:895).
  - Existing test helpers: `CCD` (server/test/ccdWsHelpers.ts:24) and `codeOnly` (server/test/sourceScan.ts:28).
- Consumed later by:
  - Task 5: its projection `collectAttentionViewOf(e: CollectEntry)` reads `CollectEntry` (`evidence`, the runs, `held.why`, `die`) and `collectAttentionCauses` (H3: the entry is not reshaped for it), `collectWouldCollectStands`, `collectRunTier`, and `CollectFeedCue` with `collectWouldCollectKey` for its cue mapping (`collectFeedCueOfAudit`, `collectFeedCueOfAct`).
  - Task 6: `CollectObservation`, `CollectCapture`, `CollectHoldWhy`, `collectLicence`, and `collectLicenceStands`, called with its port's `generations(id)` and `observation(id)`.
  - Task 7: `collectFirstSighting`, `collectCapture`, `collectFresh`, `collectClearPair`, every transition (it folds Task 6's outcome arms through them), `collectDue`, `collectRipe`, `collectNextAskMono` (the offer order), `collectFeedStep`, and every `CollectStep.gen` drawn from ONE counter. A lane-wide clear bumps the lane generation AND maps every entry through `collectClearPair`.

- [ ] **Step 0: Entry conditions**

Tasks 1 to 3 are committed on this branch. Measure:

```bash
grep -n 'export type CollectToken' shared/api.ts                                                   # Task 1
grep -n 'export type CollectAudit\|export type CollectResult\|export const COLLECT_PROBE_CLASS\|export type CollectProbeClass' server/src/collectLane.ts   # Task 2: four
grep -n '^export function collectRefusalClass(word: string): CollectRefusalClass\|^export function collectProbeClass(probe: string): CollectProbeClass\|^export type CollectDieWord' server/src/collectLane.ts   # Task 2: three (H3)
grep -n -A8 '^export type CollectAudit' server/src/collectLane.ts                                  # H3: verdict and unmeasured carry witnessRun and leaf
grep -n '^export function collectPopulation\|^export const collectForgets' server/src/collectLane.ts   # Task 3
grep -n '^function childReclaimTierFrom(' server/src/childReclaimSweep.ts                          # wave 8, private: :918 at d0c2b7803
grep -n "const want = AUDIT_WORDS.has(code) ?" server/test/single-definition.test.ts                # the archive-door scan's want line: :4192 at d0c2b7803 (5c edits it)
grep -o '_ws_collect_refuse [a-z-]* ' ccd/ccd | sort -u                                            # nine words at d0c2b7803
```

- If `collectRefusalClass`, `collectProbeClass` or `CollectDieWord` is missing, STOP and report: each is Task 2's (H3), and this task declares no second classifier.
- Check `CollectAudit` against H3's shape: its `verdict` and `unmeasured` arms carry `witnessRun: number | null` and `leaf: string | null`, as the `collectable` arm does. If either arm lacks them, STOP and report: Task 2 owes them (H3), and the evidence below reads them.

- [ ] **Step 1: The shared answer builders, and the failing licence test**

1a. Create `server/test/collectAnswers.ts`:

```ts
// Answer builders for the temp-root collector's L1 suites (child-reclamation spec §5.10). Each is a literal of what
// the readers (`parseCollectAudit`, `parseCollectResult`) hand the lane: no ccd runs, and no HOME is touched. ONE
// helper for every collector suite: a later suite adds only names that are not already exported here.
import type { CollectToken } from '../../shared/api.js';
import type { CollectAudit, CollectResult, CollectStep } from '../src/collectLane.js';

/** The lane's pass interval and its observation interval, ARGUMENTS to every L1 function (the L1 file imports no L4
 *  constant): `CHILD_RECLAIM_SWEEP_MS`'s 60 s, from which `COLLECT_OBSERVE_INTERVAL_MS` derives. */
export const PASS = 60_000;
export const OBSERVE = 60_000;
export const MIN = 60_000;
export const DAY = 24 * 3_600_000;
/** The wall clock's epoch at monotonic 0: the two clocks differ, as they do in the lane. */
export const WALL0 = 1_790_000_000_000;

/** A collect token of 64 copies of one hex digit. Only a test casts a string to `CollectToken`: the lane's own
 *  tokens come from the audit reader alone. */
export const tok = (c: string): CollectToken => c.repeat(64) as CollectToken;
export const T1 = tok('a');
export const T2 = tok('b');

type Collectable = Extract<CollectAudit, { kind: 'collectable' }>;
/** Every document's evidence (R88): its witness's run and its leaf, ccd's path. The verdict and unmeasured documents
 *  carry them too (H3). */
const LEAF = '/home/u/.cc-tmp/demo-a';
export const collectable = (token: CollectToken, over: Partial<Omit<Collectable, 'kind' | 'token'>> = {}): CollectAudit =>
  ({ kind: 'collectable', token, resume: null, witnessRun: 7, witnessAt: WALL0, leaf: LEAF, detail: '', ...over });
export const verdict = (word: string, idleAt: number | null = null): CollectAudit =>
  ({ kind: 'verdict', verdict: word, idleAt, witnessRun: 7, leaf: LEAF, detail: `${word}: d` });
export const unmeasured = (probe: string): CollectAudit =>
  ({ kind: 'unmeasured', probe, witnessRun: 7, leaf: LEAF, detail: `${probe}: d` });
export const NO_DOCUMENT: CollectAudit = { kind: 'no-document', stderr: 'killed' };
export const UNREADABLE: CollectAudit = { kind: 'unreadable', detail: 'not a collect document' };

export const COLLECTED: CollectResult = { kind: 'collected', record: 'demo-a.1.2', resumed: false, witness: 'dropped' };
export const refusedAct = (word: string): CollectResult => ({ kind: 'refused', word, detail: `${word}: d`, paths: [] });
export const failedAct = (word = 'probe-unmeasured'): CollectResult => ({ kind: 'failed', token: word, detail: `${word}: d` });
export const DIE: CollectResult = { kind: 'die', word: 'lock-unopenable' };
export const ACT_NO_DOCUMENT: CollectResult = { kind: 'no-document', stderr: '' };

/** A step at monotonic `mono` (the wall clock `WALL0` ahead unless given), stamping clear generation `gen`. */
export const step = (mono: number, gen: number, wall = WALL0 + mono): CollectStep =>
  ({ now: { monoMs: mono, wallMs: wall }, gen, passIntervalMs: PASS });
```

1b. Create `server/test/collect-licence.test.ts`:

```ts
// The temp-root collector's licence (child-reclamation spec §5.10, "two observations, one job, one act"). The lane
// spends a `ws-collect` token only on two `collectable` answers with ONE token: the second the executor's own audit,
// ARRIVING at least the observation interval after the first, with nothing else answered between, and neither
// composed before a reset. These rows pin the pure half (L1, `server/src/collectLane.ts`). The executor that applies
// it is `coord/collectTempRoot.ts`'s, and the lane's own suite pins that each L4 trigger makes its reset.
import { describe, it, expect } from 'vitest';
import {
  collectAfterAct, collectAfterAudit, collectAfterHold, collectAfterPresence, collectAfterWouldCollect, collectCapture,
  collectClearPair, collectFirstSighting, collectFresh, collectLicence, collectLicenceStands,
  type CollectAudit, type CollectCapture, type CollectEntry, type CollectLicence, type CollectObservation,
} from '../src/collectLane.js';
import {
  ACT_NO_DOCUMENT, COLLECTED, DIE, NO_DOCUMENT, OBSERVE, T1, T2, UNREADABLE, collectable, failedAct, refusedAct, step,
  unmeasured, verdict,
} from './collectAnswers.js';

/** ONE lane's memory of ONE id, driven as the lane drives it: every generation from one counter, a request
 *  CAPTURED when composed, its answer applied when it arrives, observation 1 read before the answer is applied. */
const lane = () => {
  let g = 0;
  let laneGen = ++g;
  let e: CollectEntry | undefined = collectFirstSighting(++g);
  const self = {
    entry: (): CollectEntry | undefined => e,
    laneGen: (): number => laneGen,
    /** The generations step 6 reads NOW, as the executor's port answers `generations(id)`: a forgotten id's is -1. */
    now: (): CollectCapture => (e === undefined ? { lane: laneGen, id: -1 } : collectCapture(laneGen, e)),
    /** Observation 1 as memory holds it now, as the port answers `observation(id)`. */
    obs: (): CollectObservation | null => e?.obs ?? null,
    /** A request composed now. */
    compose: (): CollectCapture => collectCapture(laneGen, e!),
    /** Its audit answer, arriving at `mono`: what the licence rule says of it as observation 2. */
    answer: (cap: CollectCapture, a: CollectAudit, mono: number): CollectLicence => {
      const fresh = collectFresh(cap, laneGen, e);
      const licence = collectLicence(e?.obs ?? null, a, mono, OBSERVE, fresh);
      if (e !== undefined) e = collectAfterAudit(e, a, step(mono, ++g), fresh);
      return licence;
    },
    /** A request composed and answered at `mono`, nothing between. */
    ask: (a: CollectAudit, mono: number): CollectLicence => self.answer(self.compose(), a, mono),
    act: (mono: number, r = COLLECTED) => { e = collectAfterAct(e!, r, step(mono, ++g)); },
    hold: (mono: number) => { e = collectAfterHold(e!, 'run-open', step(mono, ++g)); },
    presence: (mono: number) => { e = collectAfterPresence(e!, step(mono, ++g)); },
    wouldCollect: (mono: number) => { e = collectAfterWouldCollect(e!, step(mono, ++g)); },
    /** A lane-wide clear: one mechanism in L1, whatever raised it. */
    clearLane: () => { laneGen = ++g; if (e !== undefined) e = collectClearPair(e); },
    forget: () => { e = undefined; },
    sight: () => { e = collectFirstSighting(++g); },
  };
  return self;
};

const licensedAt = (l: CollectLicence): number => {
  if (l.kind !== 'licensed') throw new Error(`expected a licence, got ${l.kind}`);
  return l.first.arrivedMono;
};

/** Every answer and every step that is not an observation of the token held, each applied at `mono`. */
const RESETTING: readonly (readonly [string, (l: ReturnType<typeof lane>, mono: number) => void])[] = [
  ...['changed-recently', 'not-witnessed', 'registered', 'in-use', 'paused', 'in-progress', 'witness-mismatch',
    'quarantine-kept', 'containment-unproven', 'a-verdict-no-build-knows'].map((w) =>
    [`the verdict ${w}`, (l: ReturnType<typeof lane>, m: number) => { l.ask(verdict(w, 1), m); }] as const),
  ...['flock', 'mode', 'checkouts', 'a-probe-no-build-knows'].map((p) =>
    [`unmeasured ${p}`, (l: ReturnType<typeof lane>, m: number) => { l.ask(unmeasured(p), m); }] as const),
  ['no document', (l, m) => { l.ask(NO_DOCUMENT, m); }],
  ['an unreadable document', (l, m) => { l.ask(UNREADABLE, m); }],
  ['the act: collected', (l, m) => { l.act(m, COLLECTED); }],
  ['the act: refused', (l, m) => { l.act(m, refusedAct('state-changed')); }],
  ['the act: failed', (l, m) => { l.act(m, failedAct()); }],
  ['the act: a pre-lock die', (l, m) => { l.act(m, DIE); }],
  ['the act: no document', (l, m) => { l.act(m, ACT_NO_DOCUMENT); }],
  ['the open-run hold', (l, m) => { l.hold(m); }],
  ['the presence defer', (l, m) => { l.presence(m); }],
  ['a would-collect', (l, m) => { l.wouldCollect(m); }],
];

/** Every reset that makes an earlier request stale. The five lane-wide ones are one mechanism here. */
const RESETS: readonly (readonly [string, (l: ReturnType<typeof lane>, mono: number) => void])[] = [
  ...['a marker flip', 'a raised pause', 'a missing capability', 'a pass that failed shut', 'an unlistable registry']
    .map((k) => [k, (l: ReturnType<typeof lane>) => { l.clearLane(); }] as const),
  ['the open-run hold', (l, m) => { l.hold(m); }],
  ['the presence defer', (l, m) => { l.presence(m); }],
  ['a would-collect', (l, m) => { l.wouldCollect(m); }],
  ['a verb outcome', (l, m) => { l.act(m, refusedAct('state-changed')); }],
  ['another answer for the id', (l, m) => { l.ask(verdict('in-use'), m); }],
  ['forgetting the id, then sighting it again', (l) => { l.forget(); l.sight(); }],
];

describe('the rule: two observations of one token, the interval apart, nothing between', () => {
  it('one observation never licenses: a fresh memory, as after a restart, needs two', () => {
    const l = lane();
    expect(l.ask(collectable(T1), 0)).toEqual({ kind: 'no-first' });
    expect(licensedAt(l.ask(collectable(T1), OBSERVE))).toBe(0);
  });

  it('two observations under the interval compose nothing; at exactly the interval, yes', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    expect(l.ask(collectable(T1), OBSERVE - 1)).toEqual({ kind: 'too-soon' });
    expect(l.entry()?.obs, 'a continuing pair keeps observation 1\'s first arrival').toEqual({ token: T1, arrivedMono: 0 });
    expect(licensedAt(l.ask(collectable(T1), OBSERVE))).toBe(0);
  });

  it('T1 then T2: a different token is a new observation 1, never a partner', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    expect(l.ask(collectable(T2), OBSERVE)).toEqual({ kind: 'token-changed' });
    expect(l.entry()?.obs).toEqual({ token: T2, arrivedMono: OBSERVE });
    expect(l.ask(collectable(T2), 2 * OBSERVE - 1)).toEqual({ kind: 'too-soon' });
    expect(licensedAt(l.ask(collectable(T2), 2 * OBSERVE))).toBe(OBSERVE);
  });

  it('collectable, in-use, collectable: an answer between resets the pair, so the partner must be fresh', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    l.ask(verdict('in-use'), OBSERVE / 2);
    expect(l.ask(collectable(T1), OBSERVE)).toEqual({ kind: 'no-first' });
    expect(l.ask(collectable(T1), 2 * OBSERVE - 1)).toEqual({ kind: 'too-soon' });
    expect(licensedAt(l.ask(collectable(T1), 2 * OBSERVE))).toBe(OBSERVE);
  });

  it.each(RESETTING)('so does %s', (_label, between) => {
    const l = lane();
    l.ask(collectable(T1), 0);
    between(l, OBSERVE / 2);
    expect(l.entry()?.obs).toBeNull();
    expect(l.ask(collectable(T1), 10 * OBSERVE)).toEqual({ kind: 'no-first' });
  });

  it('observation 2 must itself be collectable', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    expect(l.ask(verdict('changed-recently', 1), OBSERVE)).toEqual({ kind: 'not-collectable' });
  });

  it('all three token modes take the one rule: a resume or a witness-only document licenses no sooner', () => {
    for (const over of [{ resume: 'moved' }, { resume: 'unmoved', witnessRun: null }, { leaf: null }]) {
      const l = lane();
      l.ask(collectable(T1, over), 0);
      expect(l.ask(collectable(T1, over), OBSERVE - 1), JSON.stringify(over)).toEqual({ kind: 'too-soon' });
      expect(licensedAt(l.ask(collectable(T1, over), OBSERVE)), JSON.stringify(over)).toBe(0);
    }
  });

  it('a clock that is no number never licenses, nor does an interval that is not positive', () => {
    const first: CollectObservation = { token: T1, arrivedMono: 0 };
    expect(collectLicence({ token: T1, arrivedMono: Number.NaN }, collectable(T1), OBSERVE, OBSERVE, true).kind).toBe('too-soon');
    expect(collectLicence(first, collectable(T1), Number.NaN, OBSERVE, true).kind).toBe('too-soon');
    expect(collectLicence(first, collectable(T1), Number.POSITIVE_INFINITY, OBSERVE, true).kind).toBe('too-soon');
    for (const interval of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(collectLicence(first, collectable(T1), 10 * OBSERVE, interval, true).kind, String(interval)).toBe('too-soon');
    }
  });

  it('the licence carries no token of its own: the argv\'s token is observation 2\'s', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    const licence = l.ask(collectable(T1), OBSERVE);
    expect(Object.keys(licence).sort()).toEqual(['first', 'kind']);
  });
});

describe('a stale answer is never an observation', () => {
  it.each(RESETS)('an answer composed before %s seeds nothing, and the first licence after needs two fresh observations', (_label, reset) => {
    const l = lane();
    const stale = l.compose();
    reset(l, OBSERVE / 4);
    expect(l.answer(stale, collectable(T1), OBSERVE / 2)).toEqual({ kind: 'stale' });
    expect(l.entry()?.obs ?? null, 'the stale answer seeded no observation 1').toBeNull();
    expect(l.ask(collectable(T1), OBSERVE), 'the first fresh answer is only observation 1').toEqual({ kind: 'no-first' });
    expect(licensedAt(l.ask(collectable(T1), 2 * OBSERVE))).toBe(OBSERVE);
  });

  it.each(RESETS)('a pair standing before %s is no partner for a stale observation 2', (_label, reset) => {
    const l = lane();
    l.ask(collectable(T1), 0);
    const stale = l.compose();
    reset(l, OBSERVE / 2);
    expect(l.answer(stale, collectable(T1), 2 * OBSERVE)).toEqual({ kind: 'stale' });
  });

  it('a lane-wide clear drops observation 1: the first licence after a flip follows two observations composed after it', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    l.clearLane();
    expect(l.ask(collectable(T1), OBSERVE)).toEqual({ kind: 'no-first' });
    expect(licensedAt(l.ask(collectable(T1), 2 * OBSERVE))).toBe(OBSERVE);
  });

  it('the job\'s own observation 2 does not stale its capture: a continuing pair keeps the id\'s generation', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    const cap = l.compose();
    const licence = l.answer(cap, collectable(T1), OBSERVE);
    if (licence.kind !== 'licensed') throw new Error(licence.kind);
    expect(collectLicenceStands(licence.first, cap, l.now(), l.obs())).toBe(true);
  });
});

describe('step 6: the licence stands only as it was found', () => {
  it.each(RESETS)('it falls after %s', (_label, reset) => {
    const l = lane();
    l.ask(collectable(T1), 0);
    const cap = l.compose();
    const licence = l.answer(cap, collectable(T1), OBSERVE);
    if (licence.kind !== 'licensed') throw new Error(licence.kind);
    reset(l, OBSERVE + 1);
    expect(collectLicenceStands(licence.first, cap, l.now(), l.obs())).toBe(false);
  });

  it('it re-reads observation 1 itself: a pair cleared, or another first arrival, stands for nothing whatever the generations say', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    const cap = l.compose();
    const licence = l.answer(cap, collectable(T1), OBSERVE);
    if (licence.kind !== 'licensed') throw new Error(licence.kind);
    expect(collectLicenceStands(licence.first, cap, l.now(), collectClearPair(l.entry()!).obs)).toBe(false);
    expect(collectLicenceStands(licence.first, cap, l.now(), { token: T1, arrivedMono: 1 })).toBe(false);
    expect(collectLicenceStands(licence.first, cap, l.now(), { token: T2, arrivedMono: 0 })).toBe(false);
  });

  it('the generations alone fell it too: memory\'s very observation 1, under a moved lane or id generation, stands for nothing', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    const cap = l.compose();
    const licence = l.answer(cap, collectable(T1), OBSERVE);
    if (licence.kind !== 'licensed') throw new Error(licence.kind);
    expect(collectLicenceStands(licence.first, cap, l.now(), l.obs()), 'as found').toBe(true);
    expect(collectLicenceStands(licence.first, cap, { ...l.now(), lane: l.now().lane + 1 }, l.obs()), 'the lane').toBe(false);
    expect(collectLicenceStands(licence.first, cap, { ...l.now(), id: -1 }, l.obs()), 'a forgotten id').toBe(false);
  });
});

describe('what a lane-wide clear clears', () => {
  it('the observation pair, and nothing else: every run, count, clock and episode stands', () => {
    const l = lane();
    l.ask(unmeasured('checkouts'), 0);
    l.ask(verdict('quarantine-kept'), OBSERVE);
    l.act(2 * OBSERVE, failedAct());
    l.ask(collectable(T1), 3 * OBSERVE);
    const e = l.entry()!;
    expect(e.obs).not.toBeNull();
    expect(collectClearPair(e)).toEqual({ ...e, obs: null });
  });
});
```

- [ ] **Step 2: Write the failing pacing test**

Create `server/test/collect-pacing.test.ts`:

```ts
// The temp-root collector's pacing and its attention causes (child-reclamation spec §5.10, pacing). Per id, in memory
// only: a DEFERRAL count that never enters a tier, and three runs (FAILING, VERB-FAILED, TERMINAL), each paced by wave
// 8's formula, IMPORTED: membership and j from `childReclaimTierFrom`, the wait from `childReclaimTierPaceMs` or
// `childReclaimBackoffMs`. The next ask is the LATEST of every wait. These rows pin the pure half (L1,
// `server/src/collectLane.ts`); the counts below are driven against the imported pace, never a copied sequence.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHILD_RECLAIM_DEFER_CEILING_MS, CHILD_RECLAIM_TIER_ENTRY_RUN, childReclaimBackoffMs, childReclaimTierFrom,
  childReclaimTierPaceMs,
} from '../src/childReclaimSweep.js';
import {
  COLLECT_CHANGED_RECENTLY_SPAN_MS, COLLECT_PROBE_CLASS, COLLECT_RUN_NONE, COLLECT_VERDICT_TABLE, COLLECT_VERDICT_WORDS,
  collectAfterAct, collectAfterAudit, collectAfterHold, collectAfterPresence, collectAfterWouldCollect,
  collectAttentionCauses, collectDue, collectFeedStep, collectFirstSighting, collectIdleSchedule, collectLicence,
  collectNextAskMono, collectRefusalClass, collectRipe, collectRunTier, collectWouldCollectKey, collectWouldCollectStands,
  type CollectAudit, type CollectEntry, type CollectResult,
} from '../src/collectLane.js';
import {
  ACT_NO_DOCUMENT, COLLECTED, DAY, DIE, MIN, NO_DOCUMENT, OBSERVE, PASS, T1, T2, UNREADABLE, WALL0, collectable,
  failedAct, refusedAct, step, unmeasured, verdict,
} from './collectAnswers.js';
import { CCD } from './ccdWsHelpers.js';
import { codeOnly } from './sourceScan.js';

const C = CHILD_RECLAIM_DEFER_CEILING_MS;
const K = CHILD_RECLAIM_TIER_ENTRY_RUN;
const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** One id's memory, every generation from one counter, every answer fresh unless said. */
const id = () => {
  let g = 0;
  let e: CollectEntry = collectFirstSighting(++g);
  const self = {
    e: (): CollectEntry => e,
    audit: (a: CollectAudit, mono: number, wall?: number) => { e = collectAfterAudit(e, a, step(mono, ++g, wall), true); return self; },
    act: (r: CollectResult, mono: number) => { e = collectAfterAct(e, r, step(mono, ++g)); return self; },
    hold: (mono: number) => { e = collectAfterHold(e, 'run-open', step(mono, ++g)); return self; },
    presence: (mono: number) => { e = collectAfterPresence(e, step(mono, ++g)); return self; },
    wouldCollect: (mono: number) => { e = collectAfterWouldCollect(e, step(mono, ++g)); return self; },
    next: (): number | null => collectNextAskMono(e, PASS, OBSERVE),
  };
  return self;
};
/** The imported pace for a run's k-th answer: the tier's once on the tier, else the ramp. */
const runWait = (token: 'failing' | 'verb-failed' | 'terminal', k: number, stuck: boolean): number => {
  const t = childReclaimTierFrom(token, k, stuck);
  return t.tier ? childReclaimTierPaceMs(t.tierJ) : childReclaimBackoffMs(k, PASS);
};
const BOX_WIDE = Object.entries(COLLECT_PROBE_CLASS).filter(([, c]) => c === 'box-wide').map(([p]) => p);
const PER_LEAF = Object.entries(COLLECT_PROBE_CLASS).filter(([, c]) => c === 'per-leaf').map(([p]) => p);
const LOAD = Object.entries(COLLECT_PROBE_CLASS).filter(([, c]) => c === 'load-sensitive').map(([p]) => p);
const DEFER_WORDS = COLLECT_VERDICT_WORDS.filter((w) => COLLECT_VERDICT_TABLE[w].pace === 'defer');
const TERMINAL_WORDS = COLLECT_VERDICT_WORDS.filter((w) => COLLECT_VERDICT_TABLE[w].pace === 'terminal');

describe('the verdict table is ccd\'s collector refusal words, and agrees with the refusal table', () => {
  it('holds exactly the words ccd\'s `_ws_collect_refuse` is called with, in both directions', () => {
    const src = readFileSync(CCD, 'utf8');
    const words = [...new Set([...src.matchAll(/\b_ws_collect_refuse ([a-z-]+) /g)].map((m) => m[1]!))].sort();
    expect(words.length, 'a floor: the scan reads something').toBeGreaterThanOrEqual(9);
    expect([...COLLECT_VERDICT_WORDS].sort()).toEqual(words);
  });

  it('a word is terminal here exactly when the verb\'s refusal table reads it terminal', () => {
    expect(TERMINAL_WORDS).toEqual(['witness-mismatch', 'quarantine-kept', 'containment-unproven']);
    for (const w of COLLECT_VERDICT_WORDS) {
      expect(collectRefusalClass(w), w).toBe(COLLECT_VERDICT_TABLE[w].pace === 'terminal' ? 'terminal' : 'retry');
    }
  });
});

describe('the DEFERRAL count', () => {
  const ADVANCING: readonly (readonly [string, (i: ReturnType<typeof id>, m: number) => void])[] = [
    ...DEFER_WORDS.map((w) => [`the verdict ${w}`, (i: ReturnType<typeof id>, m: number) => { i.audit(verdict(w), m); }] as const),
    ...BOX_WIDE.map((p) => [`unmeasured ${p}`, (i: ReturnType<typeof id>, m: number) => { i.audit(unmeasured(p), m); }] as const),
    ['a verb refusal', (i, m) => { i.act(refusedAct('state-changed'), m); }],
    ['a recognised pre-lock die', (i, m) => { i.act(DIE, m); }],
    ['changed-recently with no idleAt', (i, m) => { i.audit(verdict('changed-recently', null), m); }],
    ['not-witnessed', (i, m) => { i.audit(verdict('not-witnessed'), m); }],
  ];

  it.each(ADVANCING)('%s advances it, and waits the imported ramp over it from its own last arrival', (_l, adv) => {
    const i = id();
    for (let k = 1; k <= 6; k += 1) {
      adv(i, k * DAY);
      expect(i.e().deferrals, `k=${k}`).toBe(k);
      expect(i.next(), `k=${k}`).toBeGreaterThanOrEqual(k * DAY + childReclaimBackoffMs(k, PASS));
    }
    expect([i.e().failing, i.e().verbFailed, i.e().terminal].map((r) => r.kind), 'it never enters a run').toEqual(['none', 'none', 'none']);
  });

  it('a box-wide probe, repeated for ever, never reaches a tier: the ramp\'s cap is its longest wait', () => {
    const i = id();
    for (let k = 1; k <= 40; k += 1) i.audit(unmeasured('flock'), k * DAY);
    expect(i.next()).toBe(40 * DAY + C);
    expect(collectAttentionCauses(i.e())).toEqual([]);
  });

  const CLEARING: readonly (readonly [string, (i: ReturnType<typeof id>, m: number) => void])[] = [
    ['collectable', (i, m) => { i.audit(collectable(T1), m); }],
    ['changed-recently with an idleAt', (i, m) => { i.audit(verdict('changed-recently', 0), m); }],
    ['a terminal verdict', (i, m) => { i.audit(verdict('quarantine-kept'), m); }],
    ['a per-leaf probe', (i, m) => { i.audit(unmeasured('mode'), m); }],
    ['a load-sensitive probe', (i, m) => { i.audit(unmeasured('checkouts'), m); }],
    ['no document', (i, m) => { i.audit(NO_DOCUMENT, m); }],
    ['an unreadable document', (i, m) => { i.audit(UNREADABLE, m); }],
    ['the verb\'s failed', (i, m) => { i.act(failedAct(), m); }],
    ['an act with no document', (i, m) => { i.act(ACT_NO_DOCUMENT, m); }],
    ['collected', (i, m) => { i.act(COLLECTED, m); }],
  ];

  it.each(CLEARING)('%s clears it', (_l, clear) => {
    const i = id().audit(verdict('in-use'), 0).audit(verdict('in-use'), MIN);
    expect(i.e().deferrals).toBe(2);
    clear(i, 2 * MIN);
    expect([i.e().deferrals, i.e().deferredAtMono]).toEqual([0, null]);
  });

  it('not-witnessed clears the three runs as it advances the count, and a verb refusal of it reads the same, beside the floor', () => {
    const runs = (e: CollectEntry) => [e.failing, e.verbFailed, e.terminal];
    const audited = id().audit(unmeasured('checkouts'), 0).act(failedAct(), MIN).audit(verdict('quarantine-kept'), 2 * MIN)
      .audit(verdict('in-use'), 3 * MIN).audit(verdict('not-witnessed'), 4 * MIN);
    expect(runs(audited.e()), 'the audit').toEqual([COLLECT_RUN_NONE, COLLECT_RUN_NONE, COLLECT_RUN_NONE]);
    expect(audited.e().deferrals, 'the audit').toBe(2);
    const refused = id().audit(unmeasured('checkouts'), 0).act(failedAct(), MIN).audit(verdict('quarantine-kept'), 2 * MIN)
      .act(refusedAct('not-witnessed'), 3 * MIN);
    expect(runs(refused.e()), 'the verb').toEqual([COLLECT_RUN_NONE, COLLECT_RUN_NONE, COLLECT_RUN_NONE]);
    expect([refused.e().deferrals, refused.e().refusedAtMono, refused.next()], 'the verb').toEqual([1, 3 * MIN, 3 * MIN + C]);
  });
});

describe('the FAILING run', () => {
  it('every load-sensitive probe, an unknown one, no document, an unreadable document and an unknown verdict advance it', () => {
    const answers: CollectAudit[] = [...LOAD.map(unmeasured), unmeasured('a-probe-no-build-knows'),
      unmeasured('constructor'), NO_DOCUMENT, UNREADABLE, verdict('a-verdict-no-build-knows'), verdict('constructor'),
      verdict('toString')];
    const i = id();
    answers.forEach((a, k) => i.audit(a, k * DAY));
    expect(i.e().failing).toMatchObject({ kind: 'run', run: answers.length, stuck: false, word: 'toString' });
  });

  it('its token is its class, so alternating probes never restart it: on the tier at the fourth', () => {
    const i = id();
    const probes = ['idle:timeout', 'idle:walk-failed', 'checkouts', 'rows', 'lock'];
    probes.forEach((p, k) => {
      i.audit(unmeasured(p), k * DAY);
      expect(collectRunTier(i.e().failing, 'failing'), p).toEqual(childReclaimTierFrom('failing', k + 1, false));
      expect(i.next(), p).toBe(k * DAY + runWait('failing', k + 1, false));
    });
    expect(collectRunTier(i.e().failing, 'failing')).toMatchObject({ tier: true, tierJ: 1 });
  });

  it('a per-leaf deterministic probe enters the tier at once, and a later answer of another class keeps it there', () => {
    for (const p of PER_LEAF) {
      const i = id().audit(unmeasured(p), 0);
      expect(collectRunTier(i.e().failing, 'failing'), p).toMatchObject({ tier: true, tierJ: 0, tierRun: 1 });
      expect(i.next(), p).toBe(C);
      i.audit(unmeasured('checkouts'), C);
      expect(collectRunTier(i.e().failing, 'failing'), p).toMatchObject({ tier: true, tierRun: 2 });
      expect(i.next(), p).toBe(2 * C);
    }
  });

  it('one id with a lock that answers `lock` on every audit reaches the tier at the fourth', () => {
    const i = id();
    for (let k = 1; k <= K; k += 1) i.audit(unmeasured('lock'), k * DAY);
    expect(collectRunTier(i.e().failing, 'failing')).toMatchObject({ tier: true, tierJ: 0 });
    expect(collectAttentionCauses(i.e())).toEqual([{ kind: 'failing', word: 'lock', detail: 'lock: d' }]);
  });

  it('is cleared only by collectable, changed-recently, not-witnessed and collected', () => {
    const keeps: readonly CollectAudit[] = [verdict('in-use'), verdict('quarantine-kept'), unmeasured('flock')];
    for (const a of keeps) {
      const i = id().audit(unmeasured('checkouts'), 0).audit(a, MIN);
      expect(i.e().failing, JSON.stringify(a)).toMatchObject({ kind: 'run', run: 1 });
    }
    for (const r of [failedAct(), refusedAct('state-changed'), DIE, ACT_NO_DOCUMENT]) {
      const i = id().audit(unmeasured('checkouts'), 0).act(r, MIN);
      expect(i.e().failing, JSON.stringify(r)).toMatchObject({ kind: 'run', run: 1 });
    }
    for (const a of [collectable(T1), verdict('changed-recently', 0), verdict('not-witnessed')]) {
      expect(id().audit(unmeasured('checkouts'), 0).audit(a, MIN).e().failing, JSON.stringify(a)).toEqual(COLLECT_RUN_NONE);
    }
    expect(id().audit(unmeasured('checkouts'), 0).act(COLLECTED, MIN).e().failing).toEqual(COLLECT_RUN_NONE);
  });
});

describe('the VERB-FAILED run', () => {
  it('failed, then collectable twice, waits the ramp; the fourth failure waits the tier pace; an observation never clears it', () => {
    const i = id();
    let t = 0;
    for (let k = 1; k <= 6; k += 1) {
      i.act(failedAct(), t);
      expect(i.e().verbFailed, `failure ${k}`).toMatchObject({ kind: 'run', run: k });
      const wait = runWait('verb-failed', k, false);
      expect(wait, `failure ${k}`).toBe(k < K ? childReclaimBackoffMs(k, PASS) : childReclaimTierPaceMs(k - K));
      expect(i.next(), `failure ${k}`).toBe(t + wait);
      t += wait;
      i.audit(collectable(T1), t);                // the learning audit: observation 1
      t += OBSERVE;
      i.audit(collectable(T1), t);                // the job's audit: observation 2, and the act at once
    }
    expect(collectAttentionCauses(i.e())).toEqual([{ kind: 'verb-failed', word: 'probe-unmeasured', detail: 'probe-unmeasured: d' }]);
  });

  it('an act with no document advances it as `failed` does', () => {
    expect(id().act(ACT_NO_DOCUMENT, 0).act(failedAct(), MIN).e().verbFailed).toMatchObject({ kind: 'run', run: 2 });
  });

  it('is cleared only by collected and not-witnessed', () => {
    for (const a of [collectable(T1), verdict('changed-recently', 0), verdict('in-use'), unmeasured('checkouts'), verdict('quarantine-kept')]) {
      expect(id().act(failedAct(), 0).audit(a, MIN).e().verbFailed, JSON.stringify(a)).toMatchObject({ kind: 'run', run: 1 });
    }
    expect(id().act(failedAct(), 0).audit(verdict('not-witnessed'), MIN).e().verbFailed).toEqual(COLLECT_RUN_NONE);
    expect(id().act(failedAct(), 0).act(COLLECTED, MIN).e().verbFailed).toEqual(COLLECT_RUN_NONE);
  });
});

describe('the TERMINAL run', () => {
  /** Asks at EXACTLY each next ask, latency 0, for `span`; every other answer is `between` when given. Returns the
   *  arrivals of the terminal answers, and the memory at the end. */
  const drive = (span: number, between: CollectAudit | null) => {
    const i = id();
    const terminal: number[] = [];
    let t = 0;
    for (let k = 0; t < span; k += 1) {
      const a = between !== null && k % 2 === 1 ? between : verdict(k % 4 === 0 ? 'quarantine-kept' : 'witness-mismatch');
      i.audit(a, t);
      if (a.kind === 'verdict') terminal.push(t);
      const next = i.next();
      if (next === null || next <= t) throw new Error(`the lane would ask again at once, at ${t}`);
      t = next;
    }
    return { terminal, e: i.e() };
  };

  it('enters the tier at once, and ccd\'s word changing never restarts it', () => {
    const i = id().audit(verdict('witness-mismatch'), 0).audit(verdict('quarantine-kept'), C).audit(verdict('containment-unproven'), 2 * C);
    expect(collectRunTier(i.e().terminal, 'terminal')).toEqual(childReclaimTierFrom('terminal', 3, true));
    expect(collectAttentionCauses(i.e())).toEqual([{ kind: 'terminal', word: 'containment-unproven', detail: 'containment-unproven: d' }]);
  });

  it('is asked no sooner than the imported pace: 12 journaled terminal audits in the first 24 h, then 6 a day', () => {
    const { terminal } = drive(3 * DAY, null);
    terminal.slice(1).forEach((at, k) => {
      expect(at - terminal[k]!, `gap after the terminal answer ${k + 1}`).toBe(runWait('terminal', k + 1, true));
    });
    expect(terminal.filter((at) => at < DAY)).toHaveLength(12);
    expect(terminal.filter((at) => at >= DAY && at < 2 * DAY)).toHaveLength(6);
    expect(terminal.filter((at) => at >= 2 * DAY && at < 3 * DAY)).toHaveLength(6);
  });

  it('the same bound holds with a terminal answer alternating with `unmeasured checkouts`, and the run counts through them', () => {
    const { terminal, e } = drive(3 * DAY, unmeasured('checkouts'));
    terminal.slice(1).forEach((at, k) => {
      expect(at - terminal[k]!, `gap after the terminal answer ${k + 1}`).toBeGreaterThanOrEqual(runWait('terminal', k + 1, true));
    });
    expect(e.terminal).toMatchObject({ kind: 'run', run: terminal.length });
    expect(terminal.filter((at) => at < DAY).length).toBeLessThanOrEqual(12);
    expect(terminal.filter((at) => at >= DAY && at < 2 * DAY).length).toBeLessThanOrEqual(6);
  });

  it('any other answer between two terminal answers leaves the run, its j and its last terminal arrival as they stand', () => {
    const between: readonly CollectAudit[] = [unmeasured('checkouts'), unmeasured('flock'), verdict('in-use'), NO_DOCUMENT,
      verdict('changed-recently', 0), collectable(T1)];
    for (const a of between) {
      const i = id();
      for (let k = 0; k < 6; k += 1) i.audit(verdict('quarantine-kept'), k * DAY);
      const before = i.e().terminal;
      i.audit(a, 6 * DAY);
      expect(i.e().terminal, JSON.stringify(a)).toEqual(before);
    }
  });

  it('a verb refusal or failure of a terminal word advances it too, ahead of the verb-failed row, and a retryable one does not', () => {
    for (const w of TERMINAL_WORDS) {
      expect(id().act(refusedAct(w), 0).e().terminal, w).toMatchObject({ kind: 'run', run: 1, word: w });
    }
    expect(id().act(refusedAct('state-changed'), 0).e().terminal).toEqual(COLLECT_RUN_NONE);
    const kept = id().act(failedAct('quarantine-kept'), 0).e();
    expect([kept.terminal, kept.verbFailed], 'failed quarantine-kept')
      .toEqual([expect.objectContaining({ kind: 'run', run: 1, word: 'quarantine-kept' }), COLLECT_RUN_NONE]);
    expect(id().act(failedAct(), 0).e().terminal, 'failed probe-unmeasured').toEqual(COLLECT_RUN_NONE);
  });

  it('a refused containment-unproven, then two collectable audits, waits the terminal pace, and the item is listed at once', () => {
    const i = id().act(refusedAct('containment-unproven'), 0);
    expect(collectAttentionCauses(i.e()), 'listed at once')
      .toEqual([{ kind: 'terminal', word: 'containment-unproven', detail: 'containment-unproven: d' }]);
    let t = i.next()!;
    expect(t, 'the first ask waits the terminal pace').toBe(runWait('terminal', 1, true));
    i.audit(collectable(T1), t);
    t += OBSERVE;
    i.audit(collectable(T1), t);
    expect(i.e().terminal, 'the observations leave the run').toMatchObject({ kind: 'run', run: 1 });
    i.act(refusedAct('containment-unproven'), t);
    expect(i.e().terminal).toMatchObject({ kind: 'run', run: 2 });
    expect(i.next(), 'the next ask waits the terminal pace again').toBe(t + runWait('terminal', 2, true));
  });

  it('is cleared only by collected and not-witnessed', () => {
    expect(id().audit(verdict('quarantine-kept'), 0).act(COLLECTED, C).e().terminal).toEqual(COLLECT_RUN_NONE);
    expect(id().audit(verdict('quarantine-kept'), 0).audit(verdict('not-witnessed'), C).e().terminal).toEqual(COLLECT_RUN_NONE);
    expect(id().audit(verdict('quarantine-kept'), 0).act(failedAct(), C).e().terminal).toMatchObject({ kind: 'run', run: 1 });
  });
});

describe('a verb refusal: at most 96 a day per id', () => {
  it('a refusal floors the next learning audit a ceiling later, though the observation that follows clears the count', () => {
    expect(DAY / C, 'the bound is a day over the ceiling').toBe(96);
    const i = id();
    let t = 0;
    let refusals = 0;
    while (t < DAY) {
      const first = i.e().obs;
      i.audit(collectable(T1), t);
      if (collectLicence(first, collectable(T1), t, OBSERVE, true).kind === 'licensed') {
        i.act(refusedAct('in-use'), t);
        refusals += 1;
      }
      const next = i.next();
      if (next === null || next <= t) throw new Error(`the lane would ask again at once, at ${t}`);
      t = next;
    }
    expect(refusals).toBeGreaterThan(0);
    expect(refusals).toBeLessThanOrEqual(96);
  });
});

describe('a recognised pre-lock die', () => {
  const FLOCK_DIE: CollectResult = { kind: 'die', word: 'flock-unavailable' };
  const BAD_TOKEN_DIE: CollectResult = { kind: 'die', word: 'bad-token' };

  it('takes the refusal floor, save flock-unavailable, which latches box-wide and waits the ramp alone', () => {
    const lock = id().act(DIE, 0);
    expect([lock.e().dieAtMono, lock.next()], 'lock-unopenable: the floor').toEqual([0, C]);
    const flock = id().act(FLOCK_DIE, 0);
    expect([flock.e().dieAtMono, flock.next()], 'flock-unavailable: the ramp alone').toEqual([null, childReclaimBackoffMs(1, PASS)]);
    expect([lock.e().deferrals, flock.e().deferrals], 'each a deferral').toEqual([1, 1]);
    expect([lock.e().failing, lock.e().verbFailed, lock.e().terminal], 'neutral to every run')
      .toEqual([COLLECT_RUN_NONE, COLLECT_RUN_NONE, COLLECT_RUN_NONE]);
  });

  it('a die on every act is asked no oftener than the floor allows, though each observation clears the count', () => {
    const i = id();
    let t = 0;
    let dies = 0;
    while (t < DAY) {
      const first = i.e().obs;
      i.audit(collectable(T1), t);
      if (collectLicence(first, collectable(T1), t, OBSERVE, true).kind === 'licensed') {
        i.act(DIE, t);
        dies += 1;
      }
      const next = i.next();
      if (next === null || next <= t) throw new Error(`the lane would ask again at once, at ${t}`);
      t = next;
    }
    expect(dies).toBeGreaterThan(0);
    expect(dies).toBeLessThanOrEqual(96);
  });

  it('the same die word recurring for the ceiling, through the observations between, is attention', () => {
    const i = id().act(DIE, 0).audit(collectable(T1), C / 2).act(DIE, C - 1);
    expect(collectAttentionCauses(i.e())).toEqual([]);
    i.audit(collectable(T1), C - 1).act(DIE, C);
    expect(collectAttentionCauses(i.e())).toEqual([{ kind: 'die', word: 'lock-unopenable', sinceMono: 0 }]);
    i.hold(C + 1).presence(C + 2);
    expect(collectAttentionCauses(i.e()).map((c) => c.kind), 'a hold and a presence defer end nothing').toEqual(['die']);
    expect(collectAttentionCauses(id().act(DIE, 0).act(BAD_TOKEN_DIE, C).e()), 'another die word starts it again').toEqual([]);
    expect(collectAttentionCauses(id().act(DIE, 0).audit(unmeasured('checkouts'), C / 2).act(DIE, C).e()),
      'an answer that is not collectable ends it').toEqual([]);
    expect(collectAttentionCauses(id().act(DIE, 0).act(refusedAct('state-changed'), C / 2).act(DIE, C).e()),
      'another act outcome ends it').toEqual([]);
    expect(collectAttentionCauses(id().act(DIE, 0).wouldCollect(C / 2).act(DIE, C).e()), 'a would-collect ends it').toEqual([]);
    expect(collectAttentionCauses(id().act(FLOCK_DIE, 0).act(FLOCK_DIE, C).e()), 'flock-unavailable is the box-wide line\'s')
      .toEqual([]);
  });
});

describe('the next ask: the LATEST of every wait', () => {
  it('a fresh memory, as after a restart, is due at once and is no ripe pair', () => {
    const e = collectFirstSighting(1);
    expect(collectNextAskMono(e, PASS, OBSERVE)).toBeNull();
    expect(collectDue(e, 0, PASS, OBSERVE)).toBe(true);
    expect(collectRipe(e, 0, PASS, OBSERVE)).toBe(false);
    expect(collectDue(e, Number.NaN, PASS, OBSERVE), 'a clock that is no number is never due').toBe(false);
  });

  it('observation 1 holds the id back the observation interval, then it is RIPE', () => {
    const i = id().audit(collectable(T1), 0);
    expect(i.next()).toBe(OBSERVE);
    expect(collectRipe(i.e(), OBSERVE - 1, PASS, OBSERVE)).toBe(false);
    expect(collectRipe(i.e(), OBSERVE, PASS, OBSERVE)).toBe(true);
  });

  it('takes the latest of the waits, each from its own last arrival', () => {
    // a terminal answer at 0 (its wait: a ceiling), then a load-sensitive one at 1 min (its own ramp: 2 min)
    const i = id().audit(verdict('quarantine-kept'), 0).audit(unmeasured('checkouts'), MIN);
    expect(i.next()).toBe(Math.max(runWait('terminal', 1, true), MIN + runWait('failing', 1, false)));
    // a verb refusal at 2 min: its deferral ramp (2 min) and its floor (a ceiling)
    i.act(refusedAct('state-changed'), 2 * MIN);
    expect(i.next()).toBe(2 * MIN + C);
    // a would-collect at 20 min: the shadow floor
    i.wouldCollect(20 * MIN);
    expect(i.next()).toBe(20 * MIN + C);
    // a pre-lock die at 40 min: the die floor
    i.act(DIE, 40 * MIN);
    expect(i.next()).toBe(40 * MIN + C);
  });
});

describe('changed-recently: re-asked from ccd\'s idleAt', () => {
  const ARRIVE = 10 * DAY;
  const WALL = WALL0 + ARRIVE;
  const at = (idleAt: number | null, wall = WALL) => collectIdleSchedule(idleAt, { monoMs: ARRIVE, wallMs: wall }, PASS);

  it('arrival + clamp(idleAt·1000 − wall, the pass interval, 24 h)', () => {
    expect(at(Math.ceil(WALL / 1000) + 3600)).toEqual({ kind: 'at', monoMs: ARRIVE + (Math.ceil(WALL / 1000) + 3600) * 1000 - WALL });
    expect(at(Math.floor(WALL / 1000) - 10), 'the lower end').toEqual({ kind: 'at', monoMs: ARRIVE + PASS });
    expect(at(0), 'the lower end').toEqual({ kind: 'at', monoMs: ARRIVE + PASS });
    expect(at(Math.ceil(WALL / 1000) + 2 * 86_400), 'the upper end').toEqual({ kind: 'at', monoMs: ARRIVE + COLLECT_CHANGED_RECENTLY_SPAN_MS });
    expect(at(999_999_999_999_999), 'the upper end').toEqual({ kind: 'at', monoMs: ARRIVE + COLLECT_CHANGED_RECENTLY_SPAN_MS });
    expect(COLLECT_CHANGED_RECENTLY_SPAN_MS, 'HARDCODED on purpose').toBe(86_400_000);
  });

  it('an idleAt that is not a finite non-negative integer, or a wall clock that is no number, takes the deferral wait', () => {
    for (const bad of [null, Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
      expect(at(bad), String(bad)).toEqual({ kind: 'no-idle-at' });
      const i = id().audit(verdict('changed-recently', bad), ARRIVE);
      expect([i.e().deferrals, i.e().scheduleMono, i.next()], String(bad)).toEqual([1, null, ARRIVE + childReclaimBackoffMs(1, PASS)]);
    }
    expect(at(Math.ceil(WALL / 1000), Number.NaN)).toEqual({ kind: 'no-idle-at' });
  });

  it('it clears the deferral count and the failing run, and its schedule is the next ask', () => {
    const idle = Math.ceil(WALL / 1000) + 7200;
    const i = id().audit(unmeasured('checkouts'), ARRIVE - 2 * MIN).audit(verdict('in-use'), ARRIVE - MIN);
    expect([i.e().deferrals, i.e().failing.kind]).toEqual([1, 'run']);
    i.audit(verdict('changed-recently', idle), ARRIVE, WALL);
    expect([i.e().deferrals, i.e().failing]).toEqual([0, COLLECT_RUN_NONE]);
    expect(i.next()).toBe(ARRIVE + idle * 1000 - WALL);
  });

  it('answering without a break for 24 h is listed, and any other answer starts the clock again', () => {
    const i = id().audit(verdict('changed-recently', 0), 0).audit(verdict('changed-recently', 0), DAY - 1);
    expect(collectAttentionCauses(i.e())).toEqual([]);
    i.audit(verdict('changed-recently', 0), DAY);
    expect(collectAttentionCauses(i.e())).toEqual([{ kind: 'changed-recently', detail: 'changed-recently: d', sinceMono: 0 }]);
    i.audit(unmeasured('flock'), DAY + 1).audit(verdict('changed-recently', 0), 2 * DAY);
    expect(collectAttentionCauses(i.e())).toEqual([]);
  });
});

describe('the shadow floor', () => {
  it('a would-collect resets the pair, moves no run, and floors the next learning audit a ceiling later', () => {
    const i = id().act(failedAct(), 0).audit(collectable(T1), 10 * MIN);
    const before = i.e();
    i.wouldCollect(11 * MIN);
    expect(i.e()).toEqual({ ...before, obs: null, idGen: i.e().idGen, wouldCollectAtMono: 11 * MIN });
    expect(i.next()).toBe(11 * MIN + C);
    expect(collectDue(i.e(), 11 * MIN + C - 1, PASS, OBSERVE)).toBe(false);
  });
});

describe('the hold and the presence defer', () => {
  it('a hold resets the pair, counts nothing else, and waits a ceiling every time, never the next pass', () => {
    const i = id().act(failedAct(), 0).audit(verdict('quarantine-kept'), MIN).audit(collectable(T1), 2 * MIN);
    for (let k = 1; k <= 6; k += 1) {
      const before = i.e();
      i.hold(k * DAY);
      expect(i.e().obs, `hold ${k}`).toBeNull();
      expect([i.e().deferrals, i.e().failing, i.e().verbFailed, i.e().terminal], `hold ${k}`)
        .toEqual([before.deferrals, before.failing, before.verbFailed, before.terminal]);
      expect(i.next(), `hold ${k}`).toBe(k * DAY + C);
      i.audit(collectable(T1), k * DAY + C);
    }
  });

  it('a presence defer resets the pair and waits the imported ramp over a count of its own', () => {
    const i = id();
    let t = 0;
    for (let k = 1; k <= 6; k += 1) {
      i.audit(collectable(T1), t).presence(t + OBSERVE);
      expect(i.e().obs, `presence ${k}`).toBeNull();
      expect(i.next(), `presence ${k}`).toBe(t + OBSERVE + childReclaimBackoffMs(k, PASS));
      t = i.next()!;
    }
  });

  it('each is listed once it has stood without a break for a ceiling, through the observations between', () => {
    const held = id().hold(0).audit(collectable(T1), C - 2).hold(C - 1);
    expect(collectAttentionCauses(held.e())).toEqual([]);
    held.audit(collectable(T1), C).hold(C);
    expect(collectAttentionCauses(held.e())).toEqual([{ kind: 'held', why: 'run-open', sinceMono: 0 }]);
    held.audit(unmeasured('checkouts'), C + 1).hold(2 * C);
    expect(collectAttentionCauses(held.e()).map((c) => c.kind), 'another answer starts it again').toEqual([]);

    const seen = id().presence(0).audit(collectable(T1), C - 1).presence(C);
    expect(collectAttentionCauses(seen.e())).toEqual([{ kind: 'presence', sinceMono: 0 }]);
    seen.act(refusedAct('state-changed'), C + 1).presence(2 * C);
    expect(collectAttentionCauses(seen.e())).toEqual([]);
  });
});

describe('the deferral words\' own attention', () => {
  it('in-use at once; registered and in-progress past the ceiling; paused never', () => {
    expect(collectAttentionCauses(id().audit(verdict('in-use'), 0).e())).toEqual([{ kind: 'in-use', detail: 'in-use: d', sinceMono: 0 }]);
    for (const w of ['registered', 'in-progress']) {
      const i = id().audit(verdict(w), 0).audit(verdict(w), C - 1);
      expect(collectAttentionCauses(i.e()), w).toEqual([]);
      i.audit(verdict(w), C);
      expect(collectAttentionCauses(i.e()), w).toEqual([{ kind: w, detail: `${w}: d`, sinceMono: 0 }]);
    }
    expect(collectAttentionCauses(id().audit(verdict('paused'), 0).audit(verdict('paused'), DAY).e())).toEqual([]);
    const changed = id().audit(verdict('registered'), 0).audit(verdict('in-progress'), C - 1).audit(verdict('in-progress'), C);
    expect(collectAttentionCauses(changed.e()), 'a streak is of one word').toEqual([]);
  });

  it('not-witnessed raises nothing and ends nothing it did not clear', () => {
    expect(collectAttentionCauses(id().audit(verdict('not-witnessed'), 0).e())).toEqual([]);
  });
});

describe('the evidence: the latest document\'s', () => {
  it('a collectable, verdict or unmeasured document brings its own witness run and leaf; no document and an unreadable one keep the last', () => {
    const i = id().audit(collectable(T1, { witnessRun: 3, leaf: '/l/3' }), 0);
    expect(i.e().evidence, 'a collectable').toEqual({ runId: 3, leaf: '/l/3' });
    i.audit({ kind: 'verdict', verdict: 'quarantine-kept', idleAt: null, witnessRun: 5, leaf: '/l/5', detail: 'd' }, MIN);
    expect(i.e().evidence, 'a verdict').toEqual({ runId: 5, leaf: '/l/5' });
    i.audit({ kind: 'unmeasured', probe: 'checkouts', witnessRun: null, leaf: '/l/6', detail: 'd' }, 2 * MIN);
    expect(i.e().evidence, 'an unmeasured answer, a null run included').toEqual({ runId: null, leaf: '/l/6' });
    i.audit({ kind: 'verdict', verdict: 'a-verdict-no-build-knows', idleAt: null, witnessRun: 8, leaf: null, detail: 'd' }, 3 * MIN);
    expect(i.e().evidence, 'an unknown verdict').toEqual({ runId: 8, leaf: null });
    i.audit(NO_DOCUMENT, 4 * MIN).audit(UNREADABLE, 5 * MIN).act(failedAct(), 6 * MIN);
    expect(i.e().evidence, 'no document, an unreadable one and an act keep the last').toEqual({ runId: 8, leaf: null });
  });
});

describe('the feed episode', () => {
  it('one row per episode of a key; a repeat is quiet, and another key ends it', () => {
    const e0 = collectFirstSighting(1);
    const a = collectFeedStep(e0, { kind: 'row', key: 'in-use' });
    expect(a.opened).toBe('in-use');
    expect(collectFeedStep(a.entry, { kind: 'row', key: 'in-use' }).opened).toBeNull();
    const b = collectFeedStep(a.entry, { kind: 'row', key: 'registered' });
    expect(b.opened).toBe('registered');
    expect(collectFeedStep(b.entry, { kind: 'row', key: 'in-use' }).opened).toBe('in-use');
  });

  it('an observation of a token keeps that token\'s would-collect episode and ends any other; a quiet step ends nothing', () => {
    const wc = collectFeedStep(collectFirstSighting(1), { kind: 'row', key: collectWouldCollectKey(T1) }).entry;
    const kept = collectFeedStep(wc, { kind: 'observe', token: T1 });
    expect(kept.entry.feedEpisode).toBe(collectWouldCollectKey(T1));
    expect(collectFeedStep(kept.entry, { kind: 'row', key: collectWouldCollectKey(T1) }).opened, 'the same token: quiet').toBeNull();
    const other = collectFeedStep(wc, { kind: 'observe', token: T2 });
    expect(other.entry.feedEpisode).toBeNull();
    expect(collectFeedStep(other.entry, { kind: 'row', key: collectWouldCollectKey(T1) }).opened).toBe(collectWouldCollectKey(T1));
    const inUse = collectFeedStep(collectFirstSighting(1), { kind: 'row', key: 'in-use' }).entry;
    expect(collectFeedStep(inUse, { kind: 'observe', token: T1 }).entry.feedEpisode).toBeNull();
    expect(collectFeedStep(inUse, { kind: 'quiet' }).entry.feedEpisode).toBe('in-use');
  });

  it('a would-collect episode stands, for Task 5\'s projection, until another key or another token\'s observation ends it', () => {
    const e0 = collectFirstSighting(1);
    expect(collectWouldCollectStands(e0)).toBe(false);
    const wc = collectFeedStep(e0, { kind: 'row', key: collectWouldCollectKey(T1) }).entry;
    expect(collectWouldCollectStands(wc)).toBe(true);
    expect(collectWouldCollectStands(collectFeedStep(wc, { kind: 'observe', token: T1 }).entry), 'its own token keeps it').toBe(true);
    expect(collectWouldCollectStands(collectFeedStep(wc, { kind: 'observe', token: T2 }).entry), 'another token').toBe(false);
    expect(collectWouldCollectStands(collectFeedStep(e0, { kind: 'row', key: 'in-use' }).entry), 'another key').toBe(false);
  });
});

describe('wave 8\'s formula, imported: one definer', () => {
  it('childReclaimTierFrom is exported unchanged', () => {
    expect(childReclaimTierFrom('terminal', 1, true)).toEqual({ tier: true, tierToken: 'terminal', tierJ: 0, tierRun: 1 });
    expect(childReclaimTierFrom('failing', K + 2, false)).toEqual({ tier: true, tierToken: 'failing', tierJ: 2, tierRun: K + 2 });
    expect(childReclaimTierFrom('failing', K - 1, false)).toEqual({ tier: false, tierToken: 'failing', tierJ: 0, tierRun: K - 1 });
  });

  it('the collector imports the derivation and both waits, and spells no formula of its own', () => {
    const lane = codeOnly(readFileSync(path.join(srcRoot, 'collectLane.ts'), 'utf8'));
    const from = [...new Set([...lane.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]))].sort();
    expect(from, 'L1: L0 and the one L1 file whose formula it shares').toEqual(['../../shared/api.js', './childReclaimSweep.js']);
    const imported = /import\s*\{([^}]*)\}\s*from\s*'\.\/childReclaimSweep\.js'/.exec(lane)?.[1] ?? '';
    for (const name of ['childReclaimTierFrom', 'childReclaimTierPaceMs', 'childReclaimBackoffMs']) {
      expect(imported, name).toMatch(new RegExp(`\\b${name}\\b`));
    }
    expect(lane).not.toMatch(/\*\*|Math\.pow|CHILD_RECLAIM_TIER_CAP_MS|CHILD_RECLAIM_TIER_ENTRY_RUN/);
    const definers = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'))
      .filter((f) => /CHILD_RECLAIM_DEFER_CEILING_MS \* 2 \*\*/.test(codeOnly(readFileSync(path.join(srcRoot, f), 'utf8'))));
    expect(definers).toEqual(['childReclaimSweep.ts']);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-licence.test.ts test/collect-pacing.test.ts
```

Expected: FAIL. Re-measure both counts.
- `collect-licence`: 70 of 70. Each case fails at `TypeError: collectFirstSighting is not a function`, and the clock case at `TypeError: collectLicence is not a function`.
- `collect-pacing`: the FILE fails to collect, and no test runs. The module's top-level `COLLECT_VERDICT_WORDS.filter(…)` throws `TypeError: Cannot read properties of undefined (reading 'filter')`.

A red that names `collectPopulation`, `COLLECT_PROBE_CLASS`, `collectProbeClass` or `collectRefusalClass` means Step 0 was not satisfied. That is not this task's red.

- [ ] **Step 4: Export wave 8's one derivation (`server/src/childReclaimSweep.ts`)**

```bash
cd server && sed -i 's/^function childReclaimTierFrom(/export function childReclaimTierFrom(/' src/childReclaimSweep.ts
git diff --stat src/childReclaimSweep.ts      # 1 file changed, 1 insertion(+), 1 deletion(-)
```

- [ ] **Step 5: Implement L1 (`server/src/collectLane.ts`)**

5a. The import block. The `'../../shared/api.js'` import names `type CollectToken`; add it if it does not. Directly below that import, add the import below. If Task 2 already imports from `'./childReclaimSweep.js'`, merge these names into that ONE import instead: the pacing suite's scan reads the first import from that module.

```ts
import {
  CHILD_RECLAIM_DEFER_CEILING_MS, childReclaimBackoffMs, childReclaimTierFrom, childReclaimTierPaceMs,
  type ChildReclaimLaneNow, type ChildReclaimTierState,
} from './childReclaimSweep.js';
```

5b. Append below Task 3's block (its last line is `export const collectForgets = …`):

```ts
/* ── THE LICENCE AND THE PACING (child-reclamation spec §5.10, "the lane": two observations, one job, one act) ──────
 * The lane's per-id memory, and every rule it decides by. MEMORY ONLY: nothing here is written to coord.db or to any
 * file, so a restart starts every id afresh, and a fresh id needs two fresh observations before anything is spent.
 * Every instant is the lane's MONOTONIC clock (`ChildReclaimLaneNow.monoMs`), stamped when an answer ARRIVES; the wall
 * clock is read once, at a `changed-recently` answer's arrival, against ccd's own `idleAt`. Every interval is an
 * ARGUMENT, because this file imports no L4 constant. The pace is wave 8's, IMPORTED, never a second formula:
 * `childReclaimTierFrom`, `childReclaimTierPaceMs` and `childReclaimBackoffMs` (`childReclaimSweep.ts`, L1). */

/** How far a `changed-recently` answer may push the id's next ask at most, and how long `changed-recently` may answer
 *  without a break before the id is listed (spec §5.10, pacing): 24 hours. One span, both uses. */
export const COLLECT_CHANGED_RECENTLY_SPAN_MS = 24 * 3_600_000;

/** The class word each of the three runs carries as its tier token (spec §5.10, pacing). ccd's own word is never the
 *  token, so a change of probe or of terminal word never restarts a run. */
export type CollectRunToken = 'failing' | 'verb-failed' | 'terminal';

/** One of the id's three runs (spec §5.10, pacing): none, or `run` answers since it was last cleared, the last of
 *  them ARRIVING at `atMono`. `stuck` is set once an answer entered the run on the tier at once (a per-leaf
 *  deterministic probe, or any terminal answer) and stays set until the run clears, so a later answer of another
 *  class never takes the run off the tier. `word` and `detail` are the latest answer's, ccd's own strings: whatever
 *  reaches a sentence or a feed row goes through `childReclaimDetailText` first. */
export type CollectRun =
  | { readonly kind: 'none' }
  | { readonly kind: 'run'; readonly run: number; readonly atMono: number; readonly stuck: boolean;
      readonly word: string; readonly detail: string };

export const COLLECT_RUN_NONE: CollectRun = { kind: 'none' };

/** The run after one more answer of its class, arriving at `atMono`. */
const collectRunAdvance = (r: CollectRun, atMono: number, word: string, detail: string, stuck: boolean): CollectRun => ({
  kind: 'run', run: (r.kind === 'run' ? r.run : 0) + 1, atMono, stuck: stuck || (r.kind === 'run' && r.stuck), word, detail,
});

/** The run's place on wave 8's persistent tier, through that tier's ONE derivation of membership and j
 *  (`childReclaimTierFrom`), with the run's class word as its token. */
export const collectRunTier = (r: CollectRun, token: CollectRunToken): ChildReclaimTierState =>
  (r.kind === 'none' ? childReclaimTierFrom(null, 0, false) : childReclaimTierFrom(token, r.run, r.stuck));

/** The run's wait after its last answer: the tier's pace once on the tier, else the ordinary ramp over its count;
 *  `0` with no run. Both are wave 8's, imported. */
export const collectRunWaitMs = (r: CollectRun, token: CollectRunToken, passIntervalMs: number): number => {
  if (r.kind === 'none') return 0;
  const t = collectRunTier(r, token);
  return t.tier ? childReclaimTierPaceMs(t.tierJ) : childReclaimBackoffMs(r.run, passIntervalMs);
};

/** OBSERVATION 1 (spec §5.10, the licence): an audit of the id answered `collectable` with `token`, ARRIVING at
 *  `arrivedMono`. Keyed (id, token): the entry is the id's, and the token is held only to be COMPARED. */
export interface CollectObservation { readonly token: CollectToken; readonly arrivedMono: number }

/** Why the open-run hold stands (spec §5.10, the gates), as the executor judges it on observation 2's document: the
 *  witness's run is open, absent from coord.db, or opened after the witness; coord.db names the id in an open run;
 *  a fresh collectable document names no witness run; or a store read failed. Spelled once, as a total table's keys. */
const COLLECT_HOLD_WHY_TABLE = {
  'run-open': true, 'run-absent': true, 'run-after-witness': true, 'id-in-open-run': true, 'no-witness-run': true,
  'store-unreadable': true,
} as const satisfies Readonly<Record<string, true>>;
export type CollectHoldWhy = keyof typeof COLLECT_HOLD_WHY_TABLE;
export const COLLECT_HOLD_WHYS: readonly CollectHoldWhy[] = Object.keys(COLLECT_HOLD_WHY_TABLE) as CollectHoldWhy[];

/** The pacing row of each word the collector's audit answers with besides `collectable` and `unmeasured` (spec
 *  §5.10, pacing): ccd's `_ws_collect_refuse` words, held set-equal to them in both directions by a test.
 *  - `defer`: a deferral, neutral to every run; `listedAfterMs` is how long it must answer without a break before the
 *    id is listed (`0`: at once), or null for never by its own continuity.
 *  - `schedule`: `changed-recently`, re-asked from ccd's `idleAt`, and listed after `listedAfterMs` without a break.
 *  - `silent`: `not-witnessed`, which clears the three runs, advances the deferral count, and raises nothing (R87).
 *  - `terminal`: the terminal run.
 *  A verdict word NOT in this table is read as a failure (the failing run): never spent, and listed at the tier. */
export type CollectVerdictRow =
  | { readonly pace: 'defer'; readonly listedAfterMs: number | null }
  | { readonly pace: 'schedule'; readonly listedAfterMs: number }
  | { readonly pace: 'silent' }
  | { readonly pace: 'terminal' };
export const COLLECT_VERDICT_TABLE = {
  'changed-recently': { pace: 'schedule', listedAfterMs: COLLECT_CHANGED_RECENTLY_SPAN_MS },
  'not-witnessed': { pace: 'silent' },
  registered: { pace: 'defer', listedAfterMs: CHILD_RECLAIM_DEFER_CEILING_MS },
  'in-use': { pace: 'defer', listedAfterMs: 0 },
  paused: { pace: 'defer', listedAfterMs: null },
  'in-progress': { pace: 'defer', listedAfterMs: CHILD_RECLAIM_DEFER_CEILING_MS },
  'witness-mismatch': { pace: 'terminal' },
  'quarantine-kept': { pace: 'terminal' },
  'containment-unproven': { pace: 'terminal' },
} as const satisfies Readonly<Record<string, CollectVerdictRow>>;
export type CollectVerdictWord = keyof typeof COLLECT_VERDICT_TABLE;
export const COLLECT_VERDICT_WORDS: readonly CollectVerdictWord[] = Object.keys(COLLECT_VERDICT_TABLE) as CollectVerdictWord[];
const isCollectVerdictWord = (w: string): w is CollectVerdictWord => Object.hasOwn(COLLECT_VERDICT_TABLE, w);

/** A run of one deferral or schedule word, answered without a break (spec §5.10, attention): from the first such
 *  answer's arrival to the latest's, with the latest's detail (ccd's holder, for `in-use`). */
export interface CollectStreak {
  readonly word: CollectVerdictWord; readonly sinceMono: number; readonly lastMono: number; readonly detail: string;
}
/** The open-run hold's continuity: first at `sinceMono`, last at `atMono`, latest for `why`. It keeps NO count: the
 *  hold's next ask waits `CHILD_RECLAIM_DEFER_CEILING_MS` flat (R87). Task 6's `CollectHeld` is the hold's RESULT. */
export interface CollectHoldClock {
  readonly why: CollectHoldWhy; readonly sinceMono: number; readonly atMono: number;
}
/** A recognised pre-lock die other than `flock-unavailable`, recurring with ONE word (R87): from the first such die's
 *  arrival to the latest's. `collectable` observations, the hold and presence continue it; any other answer, act
 *  outcome or would-collect ends it. */
export interface CollectDieStreak {
  readonly word: CollectDieWord; readonly sinceMono: number; readonly lastMono: number;
}
/** The presence defer's continuity and count: deferred `count` times, first at `sinceMono`, last at `atMono`. */
export interface CollectPresence { readonly count: number; readonly sinceMono: number; readonly atMono: number }
/** The LATEST document's own evidence (R88, H3): its witness's run and its leaf (ccd's path, display only). A
 *  collectable, verdict or unmeasured document brings its own; no document and an unreadable one bring none. */
export interface CollectEvidence { readonly runId: number | null; readonly leaf: string | null }

/** THE LANE'S MEMORY OF ONE ID (spec §5.10). Memory only.
 *  - `idGen`: the id's clear generation. Every reset of the pair stamps a generation the lane never used before, so a
 *    request composed before it is stale when it answers (`collectFresh`).
 *  - `obs`: observation 1, or none.
 *  - `deferrals`, `deferredAtMono`: the DEFERRAL count and its last arrival; it never enters a tier.
 *  - `failing`, `verbFailed`, `terminal`: the three runs.
 *  - `scheduleMono`: a `changed-recently` answer's next ask, or none.
 *  - `refusedAtMono`, `wouldCollectAtMono`, `dieAtMono`: the last verb refusal's, the last would-collect's and the last
 *    pre-lock die's (`flock-unavailable` aside) arrival, each the origin of a floor of `CHILD_RECLAIM_DEFER_CEILING_MS`
 *    under the next ask.
 *  - `streak`, `die`, `held`, `presence`: the four continuity clocks attention reads.
 *  - `evidence`: the latest document's.
 *  - `feedEpisode`: the key of the feed episode whose row was written, or none (`collectFeedStep`). */
export interface CollectEntry {
  readonly idGen: number;
  readonly obs: CollectObservation | null;
  readonly deferrals: number;
  readonly deferredAtMono: number | null;
  readonly failing: CollectRun;
  readonly verbFailed: CollectRun;
  readonly terminal: CollectRun;
  readonly scheduleMono: number | null;
  readonly refusedAtMono: number | null;
  readonly wouldCollectAtMono: number | null;
  readonly dieAtMono: number | null;
  readonly streak: CollectStreak | null;
  readonly die: CollectDieStreak | null;
  readonly held: CollectHoldClock | null;
  readonly presence: CollectPresence | null;
  readonly evidence: CollectEvidence;
  readonly feedEpisode: string | null;
}

/** A first sighting, and every id after a restart: nothing observed, nothing counted, due at once. `gen` is a clear
 *  generation the lane never used before. */
export const collectFirstSighting = (gen: number): CollectEntry => ({
  idGen: gen, obs: null, deferrals: 0, deferredAtMono: null,
  failing: COLLECT_RUN_NONE, verbFailed: COLLECT_RUN_NONE, terminal: COLLECT_RUN_NONE,
  scheduleMono: null, refusedAtMono: null, wouldCollectAtMono: null, dieAtMono: null,
  streak: null, die: null, held: null, presence: null, evidence: { runId: null, leaf: null }, feedEpisode: null,
});

/** One step's context: `now` is the answer's ARRIVAL (or the executor's decision), read in its own callback; `gen`
 *  is a clear generation the lane never used before, drawn from the ONE counter both kinds of generation come from,
 *  stamped only by a transition that resets the pair; `passIntervalMs` is the lane's pass interval. */
export interface CollectStep {
  readonly now: ChildReclaimLaneNow;
  readonly gen: number;
  readonly passIntervalMs: number;
}

/** What a request was composed under (spec §5.10, stale answers): the lane-wide clear generation and the id's. */
export interface CollectCapture { readonly lane: number; readonly id: number }

export const collectCapture = (laneGen: number, e: CollectEntry): CollectCapture => ({ lane: laneGen, id: e.idGen });

/** Is an answer to a request composed under `cap` an OBSERVATION? Only when neither generation has moved since, and
 *  the id is still remembered: a lane-wide clear, any reset of the id's pair, and forgetting the id each make every
 *  earlier request stale. A stale answer paces the id like any other, and is never an observation. */
export const collectFresh = (cap: CollectCapture, laneGen: number, e: CollectEntry | undefined): e is CollectEntry =>
  e !== undefined && cap.lane === laneGen && cap.id === e.idGen;

/** A lane-wide clear (a raised pause, an unlistable registry, a missing capability, a pass that failed shut, a flip
 *  of the live marker): the OBSERVATION PAIR only. The pacing, every run, the continuity clocks and the feed episode
 *  stand (spec §5.10). The caller moves the lane-wide generation in the same act. */
export const collectClearPair = (e: CollectEntry): CollectEntry => (e.obs === null ? e : { ...e, obs: null });

/** A `changed-recently` answer's next ask (spec §5.10, pacing): `arrival.monoMs + clamp(idleAt·1000 − arrival.wallMs,
 *  passIntervalMs, 24 h)`. The wall clock is compared once, here, with ccd's own stamp; what is stored is monotonic.
 *  An `idleAt` that is not a finite non-negative integer, or a wall clock that makes the difference no number, has
 *  no schedule: the answer takes the deferral wait. idleAt never gates a spend; ccd decides the floor in its lock. */
export type CollectIdleSchedule = { readonly kind: 'at'; readonly monoMs: number } | { readonly kind: 'no-idle-at' };
export function collectIdleSchedule(idleAt: number | null, arrival: ChildReclaimLaneNow, passIntervalMs: number): CollectIdleSchedule {
  if (idleAt === null || !Number.isInteger(idleAt) || idleAt < 0) return { kind: 'no-idle-at' };
  const ahead = idleAt * 1000 - arrival.wallMs;
  if (Number.isNaN(ahead)) return { kind: 'no-idle-at' };
  return { kind: 'at', monoMs: arrival.monoMs + Math.min(Math.max(ahead, passIntervalMs), COLLECT_CHANGED_RECENTLY_SPAN_MS) };
}

/** The memory after one AUDIT answer (spec §5.10, pacing). `observes` is `collectFresh` of the request's capture:
 *  a stale answer paces the id as any answer does, and never seeds or continues an observation.
 *  - `collectable`: passed every rung, so the deferral count and the failing run clear; the verb-failed and terminal
 *    runs NEVER do. A fresh one with the token observation 1 holds continues the pair, observation 1 keeping its first
 *    arrival; with another token, or none held, it is observation 1 afresh.
 *  - Every other answer resets the pair.
 *  - A `defer` word, and an `unmeasured` box-wide probe: a deferral.
 *  - `changed-recently`: clears the deferral count and the failing run, and schedules from `idleAt`; without one it is
 *    a deferral.
 *  - `not-witnessed`: clears the three runs and ADVANCES the deferral count, so it is asked no sooner than the ramp (R87).
 *  - A terminal word: the terminal run, on the tier at once.
 *  - An `unmeasured` per-leaf or load-sensitive probe (an unknown probe word is load-sensitive), `no-document`,
 *    `unreadable` and a verdict word the table does not know: the failing run, a per-leaf probe on the tier at once.
 *  The hold's, presence's and the die's continuity end at every answer but a `collectable` one; a deferral or schedule
 *  word continues its own streak and every other answer ends it. Only `changed-recently` keeps a schedule. A
 *  collectable, verdict or unmeasured document brings its own evidence; no document and an unreadable one keep the last. */
export function collectAfterAudit(e: CollectEntry, a: CollectAudit, s: CollectStep, observes: boolean): CollectEntry {
  const t = s.now.monoMs;
  // the LATEST document's evidence (R88, H3): every document that carries one brings it; the rest keep the last
  const d: CollectEntry = a.kind === 'no-document' || a.kind === 'unreadable'
    ? e : { ...e, evidence: { runId: a.witnessRun, leaf: a.leaf } };
  // EVERY answer but a fresh observation of the token held resets the pair, under a new generation (spec §5.10)
  const reset = { obs: null, idGen: s.gen } as const;
  const ended = { held: null, presence: null, streak: null, scheduleMono: null, die: null } as const;
  const deferral = { deferrals: e.deferrals + 1, deferredAtMono: t } as const;
  const undeferred = { deferrals: 0, deferredAtMono: null } as const;
  const failure = (word: string, detail: string, stuck: boolean): CollectEntry =>
    ({ ...d, ...reset, ...ended, ...undeferred, failing: collectRunAdvance(e.failing, t, word, detail, stuck) });
  const streak = (word: CollectVerdictWord, detail: string): CollectStreak =>
    (e.streak !== null && e.streak.word === word
      ? { ...e.streak, lastMono: t, detail }
      : { word, sinceMono: t, lastMono: t, detail });
  switch (a.kind) {
    case 'collectable': {
      const passed: CollectEntry = { ...d, ...undeferred, failing: COLLECT_RUN_NONE, streak: null, scheduleMono: null };
      if (!observes) return { ...passed, ...reset };
      if (e.obs !== null && e.obs.token === a.token) return passed;
      return { ...passed, obs: { token: a.token, arrivedMono: t }, idGen: s.gen };
    }
    case 'verdict': {
      if (!isCollectVerdictWord(a.verdict)) return failure(a.verdict, a.detail, false);
      const word = a.verdict;
      const row: CollectVerdictRow = COLLECT_VERDICT_TABLE[word];
      if (row.pace === 'terminal') {
        return { ...d, ...reset, ...ended, ...undeferred, terminal: collectRunAdvance(e.terminal, t, word, a.detail, true) };
      }
      if (row.pace === 'silent') {
        return { ...d, ...reset, ...ended, ...deferral,
          failing: COLLECT_RUN_NONE, verbFailed: COLLECT_RUN_NONE, terminal: COLLECT_RUN_NONE };
      }
      if (row.pace === 'defer') return { ...d, ...reset, ...ended, ...deferral, streak: streak(word, a.detail) };
      const at = collectIdleSchedule(a.idleAt, s.now, s.passIntervalMs);
      const base: CollectEntry = { ...d, ...reset, ...ended, failing: COLLECT_RUN_NONE, streak: streak(word, a.detail) };
      return at.kind === 'at' ? { ...base, ...undeferred, scheduleMono: at.monoMs } : { ...base, ...deferral };
    }
    case 'unmeasured': {
      const cls = collectProbeClass(a.probe);
      if (cls === 'box-wide') return { ...d, ...reset, ...ended, ...deferral };
      return failure(a.probe, a.detail, cls === 'per-leaf');
    }
    case 'no-document': return failure('no-document', a.stderr, false);
    case 'unreadable': return failure('unreadable', a.detail, false);
  }
}

/** The memory after the ACT (spec §5.10, pacing). Every outcome resets the pair and ends every continuity clock but
 *  a recurring die's.
 *  - `collected`: every run, count and floor clears, as at a first sighting.
 *  - `refused`, of any word, retryable included: a deferral, and the refusal floor. A terminal word (the verb's
 *    refusal table, `collectRefusalClass`) also advances the terminal run, ahead of the refusal row (R87). A
 *    `not-witnessed` reads as the audit's (H7): the three runs clear, beside the deferral and the floor.
 *  - `failed` whose word is terminal (`failed quarantine-kept`): the terminal run, ahead of the verb-failed row (R87).
 *  - Any other `failed`, a reader-made `''` included, and `no-document` (an act that MAY have acted): the verb-failed run.
 *  - `die` (a recognised pre-lock die, which acted nothing): a deferral, neutral to every run. Every word but
 *    `flock-unavailable`, which latches box-wide instead (Task 7), also takes the refusal floor (`dieAtMono`) and
 *    continues a die streak of its own word, which attention reads past the ceiling (R87). */
export function collectAfterAct(e: CollectEntry, r: CollectResult, s: CollectStep): CollectEntry {
  const t = s.now.monoMs;
  const after: CollectEntry = {
    ...e, obs: null, idGen: s.gen, held: null, presence: null, streak: null, scheduleMono: null, die: null,
  };
  switch (r.kind) {
    case 'collected':
      return { ...collectFirstSighting(s.gen), evidence: e.evidence, feedEpisode: e.feedEpisode };
    case 'refused': {
      const silent = isCollectVerdictWord(r.word) && COLLECT_VERDICT_TABLE[r.word].pace === 'silent';
      const runs: Partial<CollectEntry> = silent
        ? { failing: COLLECT_RUN_NONE, verbFailed: COLLECT_RUN_NONE, terminal: COLLECT_RUN_NONE }
        : collectRefusalClass(r.word) === 'terminal'
          ? { terminal: collectRunAdvance(e.terminal, t, r.word, r.detail, true) } : {};
      return { ...after, ...runs, deferrals: e.deferrals + 1, deferredAtMono: t, refusedAtMono: t };
    }
    case 'failed':
      return collectRefusalClass(r.token) === 'terminal'
        ? { ...after, deferrals: 0, deferredAtMono: null, terminal: collectRunAdvance(e.terminal, t, r.token, r.detail, true) }
        : { ...after, deferrals: 0, deferredAtMono: null,
          verbFailed: collectRunAdvance(e.verbFailed, t, r.token, r.detail, false) };
    case 'no-document':
      return { ...after, deferrals: 0, deferredAtMono: null,
        verbFailed: collectRunAdvance(e.verbFailed, t, 'no-document', r.stderr, false) };
    case 'die': {
      if (r.word === 'flock-unavailable') return { ...after, deferrals: e.deferrals + 1, deferredAtMono: t };
      return { ...after, deferrals: e.deferrals + 1, deferredAtMono: t, dieAtMono: t,
        die: e.die !== null && e.die.word === r.word ? { ...e.die, lastMono: t } : { word: r.word, sinceMono: t, lastMono: t } };
    }
  }
}

/** The memory after the open-run hold stood (spec §5.10, the gates): the pair resets, and the hold's continuity runs
 *  on. It counts nothing: no run, not the deferral count, and no count of its own. Its next ask waits
 *  `CHILD_RECLAIM_DEFER_CEILING_MS` flat (R87). */
export function collectAfterHold(e: CollectEntry, why: CollectHoldWhy, s: CollectStep): CollectEntry {
  const t = s.now.monoMs;
  return { ...e, obs: null, idGen: s.gen, presence: null, held: { why, sinceMono: e.held?.sinceMono ?? t, atMono: t } };
}

/** The memory after the presence defer (spec §5.10, the gates): the pair resets, and presence's own count and
 *  continuity run on. No ceiling licenses past it: it is only ever listed. */
export function collectAfterPresence(e: CollectEntry, s: CollectStep): CollectEntry {
  const t = s.now.monoMs;
  return { ...e, obs: null, idGen: s.gen, held: null,
    presence: { count: (e.presence?.count ?? 0) + 1, sinceMono: e.presence?.sinceMono ?? t, atMono: t } };
}

/** The memory after a shadowed job recorded "would collect" (spec §5.10, shadow): the pair resets, no run moves, and
 *  the next learning audit waits the shadow floor, so shadow never audits a collectable id every pass. */
export function collectAfterWouldCollect(e: CollectEntry, s: CollectStep): CollectEntry {
  return { ...e, obs: null, idGen: s.gen, held: null, presence: null, die: null, wouldCollectAtMono: s.now.monoMs };
}

/** THE NEXT ASK (spec §5.10, pacing): the LATEST of every wait that applies, each counted from its own last arrival.
 *  - the deferral wait, `childReclaimBackoffMs` over the deferral count;
 *  - each run's wait (`collectRunWaitMs`);
 *  - the `changed-recently` schedule;
 *  - the hold's wait: the ceiling, flat (R87: no count of its own);
 *  - presence's wait: the ramp over its own count;
 *  - the refusal, die and shadow floors, the ceiling after each;
 *  - while observation 1 stands, the observation interval after its arrival, so a holder is not offered again
 *    before its partner may be composed.
 *  null when no wait applies: the id is due at once. */
export function collectNextAskMono(e: CollectEntry, passIntervalMs: number, observeIntervalMs: number): number | null {
  const waits: number[] = [];
  if (e.deferredAtMono !== null) waits.push(e.deferredAtMono + childReclaimBackoffMs(e.deferrals, passIntervalMs));
  for (const [r, token] of [[e.failing, 'failing'], [e.verbFailed, 'verb-failed'], [e.terminal, 'terminal']] as const) {
    if (r.kind === 'run') waits.push(r.atMono + collectRunWaitMs(r, token, passIntervalMs));
  }
  if (e.scheduleMono !== null) waits.push(e.scheduleMono);
  if (e.held !== null) waits.push(e.held.atMono + CHILD_RECLAIM_DEFER_CEILING_MS);
  if (e.presence !== null) waits.push(e.presence.atMono + childReclaimBackoffMs(e.presence.count, passIntervalMs));
  if (e.refusedAtMono !== null) waits.push(e.refusedAtMono + CHILD_RECLAIM_DEFER_CEILING_MS);
  if (e.dieAtMono !== null) waits.push(e.dieAtMono + CHILD_RECLAIM_DEFER_CEILING_MS);
  if (e.wouldCollectAtMono !== null) waits.push(e.wouldCollectAtMono + CHILD_RECLAIM_DEFER_CEILING_MS);
  if (e.obs !== null) waits.push(e.obs.arrivedMono + observeIntervalMs);
  return waits.length === 0 ? null : Math.max(...waits);
}

/** May the lane ask about this id now? At or after its next ask, or at once with none. A clock that is no number is
 *  never due. */
export const collectDue = (e: CollectEntry, nowMono: number, passIntervalMs: number, observeIntervalMs: number): boolean => {
  const next = collectNextAskMono(e, passIntervalMs, observeIntervalMs);
  return next === null ? Number.isFinite(nowMono) : nowMono >= next;
};

/** Is the id RIPE, offered the act job (spec §5.10)? Due, with observation 1 standing. A due id without one is
 *  offered a learning audit instead. */
export const collectRipe = (e: CollectEntry, nowMono: number, passIntervalMs: number, observeIntervalMs: number): boolean =>
  e.obs !== null && collectDue(e, nowMono, passIntervalMs, observeIntervalMs);

/** THE LICENCE, the ONE rule (spec §5.10, two observations, one job, one act). `ws-collect` may be spent only when:
 *  - observation 2, the executor's own audit in the act's job, is an observation (`observes`, its capture fresh);
 *  - it answered `collectable`;
 *  - observation 1, read from memory before observation 2 was applied, stands;
 *  - both carry ONE token;
 *  - observation 2 ARRIVED at least `observeIntervalMs` after observation 1 did, on the monotonic clock.
 *  Every answer between the two was `collectable` with that token, because any other answer resets the pair. All
 *  three token modes take this rule. A difference that is no finite number, or an interval that is not positive,
 *  never licenses. The licence carries NO token: the argv's token is observation 2's own, read off its parsed
 *  document where the argv is built. `first` is kept for step 6's re-read (`collectLicenceStands`). */
export type CollectLicence =
  | { readonly kind: 'licensed'; readonly first: CollectObservation }
  | { readonly kind: 'stale' | 'not-collectable' | 'no-first' | 'token-changed' | 'too-soon' };
export function collectLicence(
  first: CollectObservation | null, second: CollectAudit, secondArrivedMono: number, observeIntervalMs: number,
  observes: boolean,
): CollectLicence {
  if (!observes) return { kind: 'stale' };
  if (second.kind !== 'collectable') return { kind: 'not-collectable' };
  if (first === null) return { kind: 'no-first' };
  if (second.token !== first.token) return { kind: 'token-changed' };
  const span = secondArrivedMono - first.arrivedMono;
  if (!(Number.isFinite(span) && observeIntervalMs > 0 && span >= observeIntervalMs)) return { kind: 'too-soon' };
  return { kind: 'licensed', first };
}

/** Step 6's re-read (spec §5.10): after the job's last await, the licence still stands only while neither generation
 *  captured when observation 2 was composed (`composed`) has moved by `now`, and memory still holds the very
 *  observation 1 the licence was judged on (`obs`). The executor calls it through its port (H3): `now` is
 *  `lane.generations(id)`, whose `id` is -1 for a forgotten id (a generation no entry carries), and `obs` is
 *  `lane.observation(id)`. */
export const collectLicenceStands = (
  first: CollectObservation, composed: CollectCapture, now: CollectCapture, obs: CollectObservation | null,
): boolean =>
  composed.lane === now.lane && composed.id === now.id
  && obs !== null && obs.token === first.token && obs.arrivedMono === first.arrivedMono;

/** One reason the id stands on the attention list (spec §5.10, attention), in a fixed order, the most severe first.
 *  `collectAttentionItems` writes the item; this says only that it stands.
 *  - `terminal`: the terminal run stands, at once.
 *  - `failing`, `verb-failed`: that run is on the tier.
 *  - `in-use`: at once. `registered`, `in-progress`: answered without a break for the ceiling. `changed-recently`: for
 *    24 hours. Each measured from the streak's first answer to its latest.
 *  - `held`, `presence`: deferred so for the ceiling, first to latest.
 *  - `die`: one pre-lock die word recurring for the ceiling, first to latest (R87). */
export type CollectAttentionCause =
  | { readonly kind: 'terminal' | 'failing' | 'verb-failed'; readonly word: string; readonly detail: string }
  | { readonly kind: CollectVerdictWord; readonly detail: string; readonly sinceMono: number }
  | { readonly kind: 'held'; readonly why: CollectHoldWhy; readonly sinceMono: number }
  | { readonly kind: 'presence'; readonly sinceMono: number }
  | { readonly kind: 'die'; readonly word: CollectDieWord; readonly sinceMono: number };
export function collectAttentionCauses(e: CollectEntry): CollectAttentionCause[] {
  const out: CollectAttentionCause[] = [];
  const runs = [['terminal', e.terminal], ['failing', e.failing], ['verb-failed', e.verbFailed]] as const;
  for (const [token, r] of runs) {
    if (r.kind === 'run' && collectRunTier(r, token).tier) out.push({ kind: token, word: r.word, detail: r.detail });
  }
  const s = e.streak;
  if (s !== null) {
    const row: CollectVerdictRow = COLLECT_VERDICT_TABLE[s.word];
    const after = row.pace === 'defer' || row.pace === 'schedule' ? row.listedAfterMs : null;
    if (after !== null && s.lastMono - s.sinceMono >= after) out.push({ kind: s.word, detail: s.detail, sinceMono: s.sinceMono });
  }
  if (e.held !== null && e.held.atMono - e.held.sinceMono >= CHILD_RECLAIM_DEFER_CEILING_MS) {
    out.push({ kind: 'held', why: e.held.why, sinceMono: e.held.sinceMono });
  }
  if (e.presence !== null && e.presence.atMono - e.presence.sinceMono >= CHILD_RECLAIM_DEFER_CEILING_MS) {
    out.push({ kind: 'presence', sinceMono: e.presence.sinceMono });
  }
  if (e.die !== null && e.die.lastMono - e.die.sinceMono >= CHILD_RECLAIM_DEFER_CEILING_MS) {
    out.push({ kind: 'die', word: e.die.word, sinceMono: e.die.sinceMono });
  }
  return out;
}

/** What one step means for the feed (spec §5.9's quiet-on-repeat, as the collector reads it). Task 5's
 *  `collectFeedCueOfAudit` and `collectFeedCueOfAct` say which cue each answer carries.
 *  - `row`: one row per episode of `key`; a repeat is quiet, and any other key ends the episode.
 *  - `observe`: an observation of `token`: no row; a would-collect episode of that token stands, any other ends.
 *  - `quiet`: no row, and the standing episode stands. */
export type CollectFeedCue =
  | { readonly kind: 'row'; readonly key: string }
  | { readonly kind: 'observe'; readonly token: CollectToken }
  | { readonly kind: 'quiet' };

/** The would-collect episode's key: one per (id, token), so a later would-collect of the same token is quiet. In
 *  memory only, for comparison: never a sentence. */
const COLLECT_WOULD_COLLECT_PREFIX = 'would-collect ';
export const collectWouldCollectKey = (token: CollectToken): string => `${COLLECT_WOULD_COLLECT_PREFIX}${token}`;

/** Does a would-collect episode stand for this id? Task 5's projection reads it (R82's shadow item), so no token is
 *  carried or cast to answer it: true while the feed episode is a would-collect key. */
export const collectWouldCollectStands = (e: CollectEntry): boolean =>
  e.feedEpisode !== null && e.feedEpisode.startsWith(COLLECT_WOULD_COLLECT_PREFIX);

/** The feed episode after one step: the entry, and the key of the episode it opened (a row is due), or null. */
export function collectFeedStep(e: CollectEntry, cue: CollectFeedCue): { readonly entry: CollectEntry; readonly opened: string | null } {
  switch (cue.kind) {
    case 'quiet': return { entry: e, opened: null };
    case 'observe':
      return e.feedEpisode === null || e.feedEpisode === collectWouldCollectKey(cue.token)
        ? { entry: e, opened: null }
        : { entry: { ...e, feedEpisode: null }, opened: null };
    case 'row':
      return e.feedEpisode === cue.key
        ? { entry: e, opened: null }
        : { entry: { ...e, feedEpisode: cue.key }, opened: cue.key };
  }
}
```

5c. The archive-door scan's excuse (`server/test/single-definition.test.ts`, ONE line edited in place, line-neutral). The scan `it.each(CODES)("'%s' is a code-line literal in shared/api.ts alone")` (:4189-4193 at `d0c2b7803`) wants every quoted `'run-open'` on a code line to be in `shared/api.ts` alone. 5b's `COLLECT_HOLD_WHY_TABLE` spells it, and H3 fixes that name. So excuse the collector's hold vocabulary by name, as `AUDIT_WORDS` excuses the audit's words and `worktree-gone` is excused for the docs lane. No other `CODES` member is spelled by the collector (measured at planning). Task 6 adds `server/src/coord/collectTempRoot.ts` to this array in its own commit, for its `held('run-open', …)`.

```bash
cd server && sed -i "/const want = AUDIT_WORDS.has(code) ?/s|: code === 'worktree-gone'|: code === 'run-open' ? ['server/src/collectLane.ts', 'shared/api.ts'] : code === 'worktree-gone'|" test/single-definition.test.ts
grep -c "code === 'run-open' ? \['server/src/collectLane.ts', 'shared/api.ts'\]" test/single-definition.test.ts   # 1
git diff --stat test/single-definition.test.ts      # 1 file changed, 1 insertion(+), 1 deletion(-)
```

- [ ] **Step 6: Run to pass**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-licence.test.ts test/collect-pacing.test.ts test/collect-population.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim-persistent-tier.test.ts test/child-reclaim-tier-lane.test.ts test/child-reclaim-sweep-policy.test.ts test/single-definition.test.ts
```

Expected: PASS. `collect-licence` is at 70/70, `collect-pacing` at 68/68 and `collect-population` at 33/33 (re-measure). The three wave 8 suites are green at their own counts, unchanged: the export changed no reclaim answer. `single-definition` is green with 5c's line. Without it, it reds `a second 'run-open': expected [ 'server/src/collectLane.ts', 'shared/api.ts' ] to deeply equal [ 'shared/api.ts' ]` (re-measure). Run in the FOREGROUND, under 600 s.

Measured on the scratch copy, kept here for the reviewer, not asserted:
- with a terminal answer alternating with `unmeasured checkouts`, 9 terminal audits fall in the first 24 h and 3 in the second;
- the refusal loop meets 90 refusals in 24 h, and the die loop (a `lock-unopenable` die on every act) meets 90 dies.

- [ ] **Step 7: Types**

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p .
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

`tsc` prints nothing. `typecheck-tests` is a known load flake: re-run it alone before reading a red as a break.

- [ ] **Step 8: Mutation check**

Make each mutation alone on the Step 6 tree, run its file in the FOREGROUND (`cd server && ./node_modules/.bin/vitest run <file>`), see the stated red, then revert. L is `test/collect-licence.test.ts` and P is `test/collect-pacing.test.ts`. Every row was measured on a scratch copy at `d0c2b7803` with Tasks 1 and 2 stubbed; re-measure, and a measured text replaces the one below. After rulings H1 to H3, every row was re-run with Task 2 stubbed in H3's shape: rows 12, 24, 25, 29, 43, 44 and 52 are rewritten for the changed code, and rows 60 to 73 pin H1's and H3's new behaviour.

| # | Mutation (exact edit) | File, case | Expected red |
|---|---|---|---|
| 1 | In `collectLicence`, delete `if (second.token !== first.token) return { kind: 'token-changed' };` | L `T1 then T2` | `expected { kind: 'licensed', first: { …(2) } } to deeply equal { kind: 'token-changed' }` |
| 2 | `span >= observeIntervalMs)) return` → `span >= 0)) return` | L `under the interval`; `collectable, in-use, collectable`; `all three token modes` | `expected { kind: 'licensed', first: { …(2) } } to deeply equal { kind: 'too-soon' }` |
| 3 | The whole interval guard → `if (span < observeIntervalMs) return { kind: 'too-soon' };` | L `no number never licenses` | `expected 'licensed' to be 'too-soon'` (a NaN arrival) |
| 4 | Delete `observeIntervalMs > 0 && ` | L `no number never licenses` | `0: expected 'licensed' to be 'too-soon'` |
| 5 | In `collectLicence`, delete `if (!observes) return { kind: 'stale' };` | L every `seeds nothing` and `no partner` row (22 cases) | `expected { kind: 'no-first' } to deeply equal { kind: 'stale' }` |
| 6 | `if (e.obs !== null && e.obs.token === a.token) return passed;` → `if (e.obs !== null) return passed;` | L `T1 then T2` | `expected { …(2) } to deeply equal { …(2) }` (observation 1 stays T1) |
| 7 | Delete `if (e.obs !== null && e.obs.token === a.token) return passed;` | L `under the interval`; `job's own observation 2` | `a continuing pair keeps observation 1's first arrival: expected { …(2) } to deeply equal { …(2) }`; `Error: expected a licence, got too-soon` |
| 8 | `const reset = { obs: null, idGen: s.gen } as const;` → `{ obs: null } as const` | L `before another answer for the id` (both rows) | `expected { kind: 'no-first' } to deeply equal { kind: 'stale' }` |
| 9 | `const reset = { obs: null, idGen: s.gen } as const;` → `{ idGen: s.gen } as const` | L `collectable, in-use, collectable`, and 16 `so does` rows | `expected { kind: 'licensed', first: { …(2) } } to deeply equal { kind: 'no-first' }` |
| 10 | In `collectFresh`, delete `cap.lane === laneGen && ` | L the five lane-wide `seeds nothing` rows and their `no partner` rows | `expected { kind: 'no-first' } to deeply equal { kind: 'stale' }` |
| 11 | In `collectFresh`, delete ` && cap.id === e.idGen` | L the six per-id `seeds nothing` rows and their `no partner` rows | `expected { kind: 'no-first' } to deeply equal { kind: 'stale' }` |
| 12 | `collectLicenceStands`'s body → `composed.lane === now.lane && composed.id === now.id;` | L `re-reads observation 1 itself` | `expected true to be false` |
| 13 | `collectClearPair`'s body → `e` | L `a lane-wide clear drops observation 1`; `what a lane-wide clear clears` | `expected { kind: 'licensed', first: { …(2) } } to deeply equal { kind: 'no-first' }` |
| 14 | Delete `if (!observes) return { ...passed, ...reset };` | L the `seeds nothing` rows | `the stale answer seeded no observation 1: expected { …(2) } to be null` |
| 15 | Delete the row `paused: { pace: 'defer', listedAfterMs: null },` | P `exactly the words ccd's` | `expected [ 'changed-recently', …(7) ] to deeply equal [ 'changed-recently', …(8) ]` |
| 16 | Add `'state-changed': { pace: 'defer', listedAfterMs: null },` to `COLLECT_VERDICT_TABLE` | P `exactly the words ccd's` | `expected [ 'changed-recently', …(9) ] to deeply equal [ 'changed-recently', …(8) ]` |
| 17 | `Object.hasOwn(COLLECT_VERDICT_TABLE, w)` → `w in COLLECT_VERDICT_TABLE` | P `every load-sensitive probe` | `expected { kind: 'none' } to match object { kind: 'run', run: 19, …(2) }` |
| 18 | In `collectAfterAudit`'s `passed`, add `verbFailed: COLLECT_RUN_NONE,` | P `failed, then collectable twice`; `VERB-FAILED … cleared only by` | `failure 2: expected { kind: 'run', run: 1, …(4) } to match object { kind: 'run', run: 2 }` |
| 19 | In `passed`, add `terminal: COLLECT_RUN_NONE,` | P `any other answer between two terminal answers` | `{"kind":"collectable",…}: expected { kind: 'none' } to deeply equal { kind: 'run', run: 6, … }` |
| 20 | In `failure`, add `terminal: COLLECT_RUN_NONE,` | P the alternation case; `between two terminal answers`; `latest of the waits` | `expected { kind: 'none' } to match object { kind: 'run', run: 23 }`; `expected 180000 to be 900000` |
| 21 | In `collectRunAdvance`, `(r.kind === 'run' ? r.run : 0) + 1` → `(r.kind === 'run' && r.word === word ? r.run : 0) + 1` | P `alternating probes never restart it`; `every load-sensitive probe`; `ccd's word changing never restarts it` | `idle:walk-failed: expected { tier: false, …(3) } to deeply equal { tier: false, …(3) }` |
| 22 | In `collectRunAdvance`, `stuck: stuck \|\| (r.kind === 'run' && r.stuck)` → `stuck` | P `per-leaf deterministic probe enters the tier at once` | `idle:cap: expected { tier: false, …(3) } to match object { tier: true, tierRun: 2 }` |
| 23 | `return failure(a.probe, a.detail, cls === 'per-leaf');` → `…, false);` | P `per-leaf deterministic probe` | `idle:cap: expected { tier: false, …(3) } to match object { tier: true, tierJ: +0, tierRun: 1 }` |
| 24 | Delete `if (cls === 'box-wide') return { ...d, ...reset, ...ended, ...deferral };` | P the eight `unmeasured <box-wide> advances it` rows; `never reaches a tier`; `cleared only by collectable` | `k=1: expected +0 to be 1` |
| 25 | In Task 2's `collectProbeClass`, `: 'load-sensitive';` → `: 'box-wide';` (it shows this suite reds through the classifier it now calls; Task 2 keeps its own T2.25) | P `every load-sensitive probe` | `expected { kind: 'run', run: 17, …(4) } to match object { kind: 'run', run: 19, …(2) }` |
| 26 | `const undeferred = { deferrals: 0, deferredAtMono: null } as const;` → `{} as const` | P the seven audit `clears it` rows; `it clears the deferral count and the failing run` | `expected [ 2, 60000 ] to deeply equal [ +0, null ]` |
| 27 | Delete `if (e.refusedAtMono !== null) waits.push(…);` | P `at most 96 a day`; `latest of the waits` | `expected 480 to be less than or equal to 96` |
| 28 | Delete `if (e.wouldCollectAtMono !== null) waits.push(…);` | P `the shadow floor`; `latest of the waits` | `expected 120000 to be 1560000` |
| 29 | The hold's wait `e.held.atMono + CHILD_RECLAIM_DEFER_CEILING_MS` → `e.held.atMono + childReclaimBackoffMs(1, passIntervalMs)` | P `waits a ceiling every time` | `hold 1: expected 86520000 to be 87300000` |
| 30 | Presence's wait `childReclaimBackoffMs(e.presence.count, passIntervalMs)` → `childReclaimBackoffMs(1, passIntervalMs)` | P `over a count of its own` | `presence 2: expected 360000 to be 480000` |
| 31 | `Math.min(Math.max(ahead, passIntervalMs), COLLECT_CHANGED_RECENTLY_SPAN_MS)` → `Math.min(ahead, COLLECT_CHANGED_RECENTLY_SPAN_MS)` | P `arrival + clamp` | `the lower end: expected { kind: 'at', monoMs: 863990000 } to deeply equal { kind: 'at', monoMs: 864060000 }` |
| 32 | The same expression → `Math.max(ahead, passIntervalMs)` | P `arrival + clamp` | `the upper end: expected { kind: 'at', monoMs: 1036800000 } to deeply equal { kind: 'at', monoMs: 950400000 }` |
| 33 | `if (idleAt === null \|\| !Number.isInteger(idleAt) \|\| idleAt < 0)` → `if (idleAt === null \|\| idleAt < 0)` | P `not a finite non-negative integer` | `Infinity: expected { kind: 'at', monoMs: 950400000 } to deeply equal { kind: 'no-idle-at' }` |
| 34 | Delete `if (Number.isNaN(ahead)) return { kind: 'no-idle-at' };` | P `not a finite non-negative integer` | `expected { kind: 'at', monoMs: NaN } to deeply equal { kind: 'no-idle-at' }` |
| 35 | `: { ...base, ...deferral };` (the schedule arm) → `: base;` | P `changed-recently with no idleAt advances it`; `not a finite non-negative integer` | `k=1: expected +0 to be 1` |
| 36 | In `collectAttentionCauses`, `s.lastMono - s.sinceMono >= after` → `> after` | P `answering without a break for 24 h`; `in-use at once` | `expected [] to deeply equal [ { kind: 'changed-recently', …(2) } ]` |
| 37 | Delete `if (e.obs !== null) waits.push(e.obs.arrivedMono + observeIntervalMs);` | P `holds the id back`; `at most 96 a day` | `expected null to be 60000`; `Error: the lane would ask again at once, at 0` |
| 38 | `Math.max(...waits)` → `Math.min(...waits)` | P `latest of the waits`; `at most 96 a day`; the alternation case | `expected 180000 to be 900000`; `expected 480 to be less than or equal to 96` |
| 39 | `collectRunWaitMs`'s return → `return childReclaimBackoffMs(r.run, passIntervalMs);` | P `alternating probes`; `per-leaf deterministic probe`; `failed, then collectable twice`; the 12-a-day case | `idle:cap: expected 120000 to be 900000`; `failure 5: expected 2880000 to be 3780000` |
| 40 | The terminal arm's `collectRunAdvance(e.terminal, t, word, a.detail, true)` → `…, false)` | P `enters the tier at once`; the 12-a-day case; the alternation case | `expected { tier: false, …(3) } to deeply equal { tier: true, …(3) }`; `gap after the terminal answer 1: expected 120000 to be 900000` |
| 41 | In the `silent` arm, `failing: COLLECT_RUN_NONE, verbFailed: COLLECT_RUN_NONE, terminal: COLLECT_RUN_NONE };` → `failing: COLLECT_RUN_NONE };` | P the VERB-FAILED and TERMINAL `cleared only by collected and not-witnessed` | `expected { kind: 'run', run: 1, …(4) } to deeply equal { kind: 'none' }` |
| 42 | `collectAfterAct`'s `collected` arm → `return after;` | P `collected clears it`; the three `cleared only by` cases | `expected [ 2, 60000 ] to deeply equal [ +0, null ]` |
| 43 | In the `refused` arm, `: collectRefusalClass(r.word) === 'terminal'` → `: false` | P `a verb refusal or failure of a terminal word advances it too`; `a refused containment-unproven, then two collectable audits` | `witness-mismatch: expected { kind: 'none' } to match object { kind: 'run', run: 1, …(1) }`; `listed at once: expected [] to deeply equal [ { kind: 'terminal', …(2) } ]` |
| 44 | The `die` arm's whole block → `return { ...after, deferrals: 0, deferredAtMono: null, verbFailed: collectRunAdvance(e.verbFailed, t, r.word, '', false) };` | P `a recognised pre-lock die advances it`; `takes the refusal floor`; `recurring for the ceiling`; `latest of the waits` | `k=1: expected +0 to be 1`; `lock-unopenable: the floor: expected [ null, 120000 ] to deeply equal [ +0, 900000 ]`; `expected 2520000 to be 3300000` |
| 45 | The act `no-document` arm's `verbFailed: collectRunAdvance(…)` → `deferrals: e.deferrals + 1, deferredAtMono: t` | P `an act with no document advances it`; `an act with no document clears it` | `expected { kind: 'run', run: 1, …(4) } to match object { kind: 'run', run: 2 }` |
| 46 | `case 'unreadable': return failure(…);` → `case 'unreadable': return { ...e, ...reset, ...ended, ...deferral };` | P `every load-sensitive probe`; `an unreadable document clears it` | `expected { kind: 'run', run: 18, …(4) } to match object { kind: 'run', run: 19, …(2) }` |
| 47 | In `collectAfterHold`, delete `obs: null, idGen: s.gen, ` | L `so does the open-run hold`; the hold's `seeds nothing` and `no partner` rows | `expected { …(2) } to be null`; `expected { kind: 'licensed', first: { …(2) } } to deeply equal { kind: 'stale' }` |
| 48 | In `collectAfterWouldCollect`, delete `idGen: s.gen, ` | L the would-collect `seeds nothing` and `no partner` rows | `expected { kind: 'no-first' } to deeply equal { kind: 'stale' }` |
| 49 | In `collectRipe`, delete `e.obs !== null && ` | P `due at once and is no ripe pair` | `expected true to be false` |
| 50 | In `collectDue`, `Number.isFinite(nowMono)` → `true` | P `due at once and is no ripe pair` | `a clock that is no number is never due: expected true to be false` |
| 51 | The held cause's `>= CHILD_RECLAIM_DEFER_CEILING_MS` → `>` | P `listed once it has stood without a break` | `expected [] to deeply equal [ { kind: 'held', …(2) } ]` |
| 52 | `const ended = { held: null, presence: null, streak: null, scheduleMono: null, die: null } as const;` → `{ streak: null, scheduleMono: null, die: null } as const` | P `listed once it has stood without a break` | `another answer starts it again: expected [ 'held' ] to deeply equal []` |
| 53 | In `collectFeedStep`'s `observe` arm, the condition `e.feedEpisode === null \|\| e.feedEpisode === collectWouldCollectKey(cue.token)` → `true` | P `an observation of a token keeps that token's would-collect episode` | `expected 'would-collect aaaa…' to be null` |
| 54 | The `row` arm's `e.feedEpisode === cue.key` → `false` | P `one row per episode of a key`; the would-collect case | `expected 'in-use' to be null` |
| 55 | Remove `export` from `childReclaimTierFrom` | P every case that calls it (12) | `TypeError: childReclaimTierFrom is not a function` |
| 56 | `collectRunWaitMs`'s `childReclaimTierPaceMs(t.tierJ)` → `Math.min(4 * 3_600_000, CHILD_RECLAIM_DEFER_CEILING_MS * 2 ** t.tierJ)` | P `spells no formula of its own` | `expected '…' not to match /\*\*\|Math\.pow\|CHILD_RECLAIM_TIER_CAP…/` (behaviour unchanged: the scan is the only guard) |
| 57 | `registered: { pace: 'defer', listedAfterMs: CHILD_RECLAIM_DEFER_CEILING_MS }` → `listedAfterMs: 0` | P `registered and in-progress past the ceiling` | `registered: expected [ { kind: 'registered', …(2) } ] to deeply equal []` |
| 58 | In `streak`, delete ` && e.streak.word === word` | P `registered and in-progress past the ceiling` | `a streak is of one word: expected [ { kind: 'registered', …(2) } ] to deeply equal []` |
| 59 | In `collectAttentionCauses`, `r.kind === 'run' && collectRunTier(r, token).tier` → `r.kind === 'run'` | P `listed once it has stood without a break` | `another answer starts it again: expected [ 'failing' ] to deeply equal []` |
| 60 | In `collectAfterAudit`'s `silent` arm, `...deferral,` → `...undeferred,` | P `not-witnessed advances it`; `not-witnessed clears the three runs as it advances the count` | `k=1: expected +0 to be 1`; `the audit: expected +0 to be 2` |
| 61 | In `collectAfterAct`'s `refused` arm, `const runs: Partial<CollectEntry> = silent` → `= false` | P `not-witnessed clears the three runs …, and a verb refusal of it reads the same` | `the verb: expected [ { kind: 'run', run: 1, …(4) }, …(2) ] to deeply equal [ { kind: 'none' }, …(2) ]` |
| 62 | In the `failed` arm, `return collectRefusalClass(r.token) === 'terminal'` → `return false` | P `a verb refusal or failure of a terminal word advances it too` | `failed quarantine-kept: expected [ { kind: 'none' }, …(1) ] to deeply equal [ ObjectContaining{…}, …(1) ]` |
| 63 | Delete `if (e.dieAtMono !== null) waits.push(e.dieAtMono + CHILD_RECLAIM_DEFER_CEILING_MS);` | P `takes the refusal floor`; `a die on every act`; `latest of the waits` | `lock-unopenable: the floor: expected [ +0, 120000 ] to deeply equal [ +0, 900000 ]`; `expected 480 to be less than or equal to 96`; `expected 2640000 to be 3300000` |
| 64 | In the `die` arm, delete `if (r.word === 'flock-unavailable') return { ...after, deferrals: e.deferrals + 1, deferredAtMono: t };` | P `takes the refusal floor, save flock-unavailable`; `recurring for the ceiling` | `flock-unavailable: the ramp alone: expected [ +0, 900000 ] to deeply equal [ null, 120000 ]`; `flock-unavailable is the box-wide line's: expected [ { kind: 'die', …(2) } ] to deeply equal []` |
| 65 | The die cause's `e.die.lastMono - e.die.sinceMono >= CHILD_RECLAIM_DEFER_CEILING_MS` → `>` | P `recurring for the ceiling` | `expected [] to deeply equal [ { kind: 'die', …(2) } ]` |
| 66 | In `collectAfterAudit`'s `ended`, delete `, die: null` | P `recurring for the ceiling` | `an answer that is not collectable ends it: expected [ { kind: 'die', …(2) } ] to deeply equal []` |
| 67 | `die: e.die !== null && e.die.word === r.word ?` → `die: e.die !== null ?` | P `recurring for the ceiling` | `another die word starts it again: expected [ { kind: 'die', …(2) } ] to deeply equal []` |
| 68 | `const d: CollectEntry = a.kind === 'no-document' \|\| a.kind === 'unreadable' ? e : { … };` → `const d: CollectEntry = e;` | P `the evidence: the latest document's` | `a collectable: expected { runId: null, leaf: null } to deeply equal { runId: 3, leaf: '/l/3' }` |
| 69 | `collectWouldCollectStands`'s body → `e.feedEpisode !== null;` | P `a would-collect episode stands` | `another key: expected true to be false` |
| 70 | In `collectLicenceStands`, delete `composed.lane === now.lane && ` | L `the generations alone fell it too` | `the lane: expected true to be false` |
| 71 | In `collectLicenceStands`, delete ` && composed.id === now.id` | L `the generations alone fell it too` | `a forgotten id: expected true to be false` |
| 72 | In `collectAfterAct`'s `after`, delete ` die: null,` | P `recurring for the ceiling` | `another act outcome ends it: expected [ { kind: 'die', …(2) } ] to deeply equal []` |
| 73 | In `collectAfterWouldCollect`, delete `die: null, ` | P `recurring for the ceiling` | `a would-collect ends it: expected [ { kind: 'die', …(2) } ] to deeply equal []` |

- [ ] **Step 9: Commit**

```bash
git add server/src/childReclaimSweep.ts server/src/collectLane.ts server/test/collectAnswers.ts \
  server/test/collect-licence.test.ts server/test/collect-pacing.test.ts server/test/single-definition.test.ts
git commit -m "$(cat <<'MSG'
feat(collect): the collector's licence and pacing, in memory

ws-collect may be spent only on two collectable answers with one token:
the second is the executor's own audit, arriving at least the
observation interval after the first, with nothing else answered
between. Every reset of the pair stamps a generation the lane never
used, and a lane-wide clear moves the lane's own. So an answer to a
request composed before a reset paces the id but is never an
observation, and a restart starts every id afresh.

Per id the lane keeps a deferral count that never enters a tier, and
three runs, failing, verb-failed and terminal, each paced by wave 8's
tier formula, imported: childReclaimTierFrom is exported unchanged for
it. A collectable observation never clears the verb-failed or the
terminal run. The next ask is the latest of every wait: the ramp, each
run's pace, changed-recently's schedule from ccd's idleAt clamped to a
pass and a day, the hold's flat ceiling, presence's own ramp, and the
refusal, die and shadow floors. A verb refusal or failure whose word is
terminal advances the terminal run. not-witnessed clears the three runs
and advances the deferral count. A pre-lock die other than
flock-unavailable takes the refusal floor, and the same die recurring
past the ceiling is listed. Evidence is the latest document's.

The archive-door scan in single-definition excuses the hold-why
'run-open' in collectLane.ts by name, as it excuses the audit's words.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

---

### Task 5: Attention and text — the collector's items, the box-wide lines, one item per id with second clauses, `detailUnsafe` widened, the leaf-kept sentences made true, and the feed bodies

**Model routing:** `opus`, effort `high`. This is a report that gates nothing: no audit, act, slot, pair or pacing reads it. The design work is the one-item-per-id precedence, the clauses a winner carries, the collapse rules, and making every ccd-sourced string safe before it reaches a sentence.

**Why:**
- **R88.** Collector attention is an arm of `ChildReclaimAttention`, with no new `CoordStatus` field and no PWA edit.
  - Box-wide lines are SINGLE items under fixed labels that no session id can equal.
  - A collapsed per-id line is a `kept-many` under a word no other line uses. A run-less collector item never stays single past `CHILD_RECLAIM_KEPT_MANY_OVER` of one word.
  - Precedence is reclaim over collector over leaf-kept. The winner carries the loser's operator instruction as a second clause, and an item that carries one never collapses.
  - `detailUnsafe` widens to Cc/Cf/Zl/Zp/Cs, plus U+034F and the tag block, and every ccd-sourced string goes through `childReclaimDetailText`.
  - The two leaf-kept sentences that become false once the lane is armed are rewritten. The `runId` sentence is Task 1's (H3): Task 1 rewrote it in the arm's commit, and this task's prose suite pins Task 1's three lines verbatim.
  - The feed bodies: a witness-only collect never says a temp root was removed. A would-collect writes one row per (id, token). Each marker flip writes one row.
- **R86 and R87, the attention parts.** WHETHER a per-id cause stands is Task 4's `collectAttentionCauses`, measured from the first answer to the latest, inclusive (`continuity-measured-answer-to-answer`, H9). This task projects Task 4's entry through `collectAttentionViewOf` (H3) and writes the words; it decides no threshold of its own.
  - Listed at once: `in-use` (naming ccd's holder), a per-leaf deterministic `unmeasured`, and a terminal answer. A terminal item stands while the terminal run stands, and its sentence says what ccd answered at the run's last terminal answer, never that the id is refused now (H8).
  - Listed once it has stood `CHILD_RECLAIM_DEFER_CEILING_MS`, first answer to latest: `registered`, `in-progress` (naming `$REG/.reap-<id>.lock`), presence, a hold, and an arm-1 die other than `flock-unavailable` recurring (H1).
  - Listed at tier entry: the failing and verb-failed runs.
  - Listed once `changed-recently` has answered for 24 h, first answer to latest.
  - Shadow's would-collect is listed while its episode stands (`collectWouldCollectStands`).
  - Ids held by (b) or (c) collapse into ONE box-wide line, once held a ceiling (`unvouched-line-waits-the-ceiling`, H8).
  - The box-wide unsettled line covers an unsettled collector call OR executor JOB; a job's clause says the collector's act slot is held (H1, R85), whether or not its `ws-collect` is out: the line treats `'act'` and `'job'` alike as slot-held, and Task 7's `collectUnsettled` checks the job's `CHILD_RECLAIM_STALL_MS` bound before the audit bound.
  - `records` lists no per-id item while `tmpquarantine` is unmeasured.
  - The `no-document` and `lock` box lines stand only when at least two distinct ids answered them in a pass where no audit answered anything else. The per-id item at tier entry stands regardless.
- **R90, the pre-flight items this task closes:** `detail-unsafe-upper-bounds-unpinned` and wave 8's deferred `detailUnsafe` classes. (`attention-runid-sentence-misses-leaf-arms` is Task 1's; this task's prose suite pins Task 1's words.)
- **R83:** a sentence names the leaf only from the audit document's `collect.leaf`, through `childReclaimDetailText`. No collector sentence builds a `.cc-tmp` path.

**Files:**
- No edit to `shared/api.ts` (H3). Task 1 declared `ChildReclaimCollectMany` in its one union-line rewrite (`collect-many-arm-declared`), rewrote the doc pair (`attention-doc-pair-counts-the-collector`) and the `runId` sentence, and owns `COLLECT_BOX_LABELS` with its own label strings.
- Modify: `server/src/childReclaimSweep.ts`. It changes `detailUnsafe`, the two leaf-kept sentences, `ChildReclaimLeafKept.clipsClause` and the merge, and adds `export` to `childReclaimStuckEnd`.
- Modify: `server/src/collectLane.ts`. Tasks 2 to 4 created it; this task appends the attention and feed block.
- Modify: `server/src/watch.ts`. One call site inside `childReclaimPublishAttention` (`:3968-3969` at `d0c2b7803`), and `CHILD_RECLAIM_COLLECT_NONE` added in place to the existing `./childReclaimSweep.js` import's line `:107` (the statement spans `:94-108`), all away from run 358's regions (`:112`, `:121`, `:125`; R91).
- Modify: `server/test/child-reclaim-verdict-readers.test.ts`. Census (c)'s `WRITE` literal is re-pointed in the same commit (R88).
- Modify: `server/test/child-reclaim-leaf-kept.test.ts`. The sentence constants, the yield's `clipsClause`, the merge's new signature, and the collapsed sentence.
- Modify: `server/test/child-reclaim-detail-text.test.ts`. One control code point, `0x206a`, is now unsafe (Cf) and becomes `0x2070`.
- Create: `server/test/collect-attention.test.ts`.
- Create: `server/test/collect-feed-body.test.ts`.
- Create: `server/test/child-reclaim-detail-unsafe-classes.test.ts`.
- Create: `server/test/child-reclaim-leaf-kept-prose.test.ts`.

**Interfaces:**
- **Consumes, Task 1** (`shared/api.ts` foot, as Task 1 writes it; H3): `isTmpRootId(id: unknown): id is string`; `TMPROOT_ID_MAX_CHARS`; `type CollectToken`; `interface ChildReclaimCollectAttention { readonly kind: 'collect'; readonly sessionId: string; readonly runId: number | null; readonly word: string; readonly sentence: string }` and `interface ChildReclaimCollectMany { readonly kind: 'kept-many'; readonly word: `collect:${string}`; readonly members: readonly ChildReclaimKeptMember[]; readonly sentence: string }`, both already in the union through Task 1's ONE union-line rewrite (`collect-many-arm-declared`); `COLLECT_BOX_LABELS` (Task 1's `as const` table, keys `tmproots`, `tmpquarantine`, `refused-names`, `box-probe`, `no-document`, `lock`, `flock`, `unsettled`, `unvouched`, `no-run`, with Task 1's label strings), `type CollectBoxLine = keyof typeof COLLECT_BOX_LABELS` and `COLLECT_BOX_LINES`. `childReclaimSweep.ts` already imports `isTmpRootId` in place of wave 8's `leafIdOk`. Task 1 also rewrote `ChildReclaimAttention`'s doc pair and `runId` sentence; this task edits neither.
- **Consumes, Task 2** (`server/src/collectLane.ts`): `type CollectAudit` (its `verdict` and `unmeasured` arms carry `witnessRun` and `leaf`, H3), `type CollectResult`, `type CollectProbeClass`, `COLLECT_PROBE_CLASS`, `collectProbeClass(probe: string): CollectProbeClass` (an unknown word is load-sensitive; the ONE classifier, H3) and `type CollectDieWord`.
- **Consumes, Task 3:** `COLLECT_POPULATION_MAX` and `type CollectListingDoubt` (`{ listing; kind: 'unmeasured'; why } | { listing; kind: 'over-cap'; count }`, the count the RAW listing's, `population-cap-counts-the-raw-listing`). The box lines read the population's `unmeasured` doubts as Task 3 reports them; this task declares no listing type of its own.
- **Consumes, Task 4:**
  - `export function childReclaimTierFrom(token: string | null, run: number, stuck: boolean): ChildReclaimTierState` (the export keyword only).
  - `CollectEntry`, read only through this task's projection `collectAttentionViewOf` (H3); the entry is not reshaped for it. With it `CollectRun`, `CollectRunToken`, `COLLECT_RUN_NONE`, `collectRunTier` and `COLLECT_CHANGED_RECENTLY_SPAN_MS` (the one 24 h span).
  - `collectAttentionCauses(e: CollectEntry): CollectAttentionCause[]`, which decides every threshold, first answer to latest and inclusive (`continuity-measured-answer-to-answer`, H9), including H1's `{ kind: 'die'; word: CollectDieWord; sinceMono }` arm.
  - `collectWouldCollectStands(e: CollectEntry): boolean` (true while `feedEpisode` is a would-collect key), `collectWouldCollectKey`, `type CollectFeedCue` and `collectFeedStep`.
  - `type CollectHoldWhy` = `'run-open' | 'run-absent' | 'run-after-witness' | 'id-in-open-run' | 'no-witness-run' | 'store-unreadable'` (R86 (a) to (f), H3).
  - The ONE builder file for L1 suites, `server/test/collectAnswers.ts` (`collectable`, `verdict`, `unmeasured`, `NO_DOCUMENT`, `UNREADABLE`, `COLLECTED`, `refusedAct`, `failedAct`, `DIE`, `ACT_NO_DOCUMENT`, `T1`, `DAY`, `step`): this task's suites build answers through it, never with local literals.
- **Produces, L0 `shared/api.ts`:** nothing. Task 1 declares `ChildReclaimCollectMany` and the labels table (H3).
- **Produces, L1 `server/src/childReclaimSweep.ts`:**
  ```ts
  export const childReclaimStuckEnd: (t: string) => string;            // export keyword only
  export interface ChildReclaimLeafKept {
    readonly item: ChildReclaimLeafKeptAttention; readonly source: number; readonly detail: string | null;
    readonly clipsClause: string | null;
  }
  export interface ChildReclaimCollectInput {
    readonly perId: readonly ChildReclaimCollectAttention[];
    readonly manyLead: Readonly<Record<string, string>>;
    readonly box: readonly ChildReclaimCollectAttention[];
  }
  export const CHILD_RECLAIM_COLLECT_NONE: ChildReclaimCollectInput;
  export const CHILD_RECLAIM_COLLECT_MANY_PREFIX = 'collect:';
  export function childReclaimIdsNamed(ids: readonly string[]): string;
  export const childReclaimClipsSecond: (clipsClause: string) => string;
  export const childReclaimCollectManySentence: (n: number, lead: string) => string;
  export function childReclaimAttentionWithLeaves(
    list: readonly ChildReclaimAttention[], leaves: readonly ChildReclaimLeafKept[], collect: ChildReclaimCollectInput,
  ): ChildReclaimAttention[];
  ```
- **Produces, L1 `server/src/collectLane.ts`** (its names merged into the file's two H2 import statements):
  ```ts
  export type CollectItemWord = 'in-use' | 'registered' | 'in-progress' | 'presence' | 'held' | 'die' | 'per-leaf'
    | 'failing' | 'verb-failed' | 'changed-recently' | 'would-collect';
  export interface CollectRunView { readonly tier: ChildReclaimTierState; readonly word: string | null; readonly detail: string | null }
  export interface CollectAttentionView {
    readonly witnessRun: number | null; readonly leaf: string | null;
    readonly failing: CollectRunView; readonly verbFailed: CollectRunView; readonly terminal: CollectRunView;
    readonly deferral: { readonly word: string; readonly detail: string; readonly since: number } | null;
    readonly presenceSince: number | null;
    readonly hold: { readonly why: CollectHoldWhy; readonly since: number } | null;
    readonly changedRecentlySince: number | null;
    readonly die: { readonly word: CollectDieWord; readonly since: number } | null;
    readonly wouldCollect: boolean;
  }
  export function collectAttentionViewOf(e: CollectEntry): CollectAttentionView;   // H3: the projection
  export type CollectPassClass = 'no-document' | 'lock' | 'other';
  export type CollectUnsettledKind = 'audit' | 'act' | 'job';
  export interface CollectBoxFacts {
    readonly unmeasured: readonly CollectListingDoubt[];
    readonly refusedNames: number;
    readonly boxProbes: ReadonlyMap<string, string>;
    readonly passAudits: ReadonlyMap<string, CollectPassClass>;
    readonly flockLatched: boolean;
    readonly unsettled: ReadonlyMap<string, CollectUnsettledKind>;
  }
  export function collectPassClass(a: CollectAudit): CollectPassClass;
  export function collectBoxProbesAfter(prev: ReadonlyMap<string, string>, a: CollectAudit | CollectResult): ReadonlyMap<string, string>;
  export function collectAttentionItems(i: {
    readonly entries: ReadonlyMap<string, CollectAttentionView>; readonly box: CollectBoxFacts; readonly nowMono: number;
  }): ChildReclaimCollectInput;
  export function collectFeedCueOfAudit(a: CollectAudit): CollectFeedCue;
  export function collectFeedCueOfAct(r: CollectResult): CollectFeedCue;
  export type CollectFeedKind = 'collected' | 'would-collect' | 'answer' | 'switch';
  export const COLLECT_FEED_TITLE: Readonly<Record<CollectFeedKind, string>>;
  export function collectFeedCollectedBody(id: string, runId: number | null, leaf: string | null,
    r: Extract<CollectResult, { readonly kind: 'collected' }>): string;
  export function collectFeedWouldCollectBody(id: string, runId: number | null, leaf: string | null): string;
  export const collectFeedSwitchBody: (live: boolean) => string;
  export function collectFeedAnswerBody(id: string, runId: number | null, word: string, detail: string | null,
    paths: readonly string[]): string;
  ```
- **For Task 7** (`watch.ts`):
  - It keeps `boxProbes` (through `collectBoxProbesAfter`, over every audit and act answer), the pass's `passAudits` (through `collectPassClass`, over every learning and executor audit, keyed by composing pass; it publishes the latest pass whose audits all settled), `flockLatched`, the `unsettled` kinds (`'audit'`, `'act'` or `'job'`, from its flights' phases, each bound counted from the enqueue, an act job's `CHILD_RECLAIM_STALL_MS` bound checked FIRST so a job whose own audit or `ws-collect` hangs past it reads `'act'` or `'job'`, never `'audit'`) and the population's `unmeasured` doubts and `refusedNames` (Task 3's, as they stand).
  - It calls `collectAttentionItems({ entries: <the lane's entries, each mapped through collectAttentionViewOf>, box, nowMono })` and passes the result as `childReclaimAttentionWithLeaves`'s third argument, replacing this task's `CHILD_RECLAIM_COLLECT_NONE` (and dropping that name from `watch.ts`'s import once unused). It re-points census (c) again in its own commit.
  - It writes the feed rows. After each fold it calls `collectFeedStep(entry, collectFeedCueOfAudit(a))` or `collectFeedStep(entry, collectFeedCueOfAct(r))` (a would-collect: `{ kind: 'row', key: collectWouldCollectKey(token) }`), and writes a row only when `opened !== null`. The writer is a private `watch.ts` method in `recordExpireFeed`'s idiom (`kind: 'run'`, recorded and never pushed), outside `collectLane.ts` and `collectTempRoot.ts` (R82), titled from `COLLECT_FEED_TITLE` with this task's bodies.

**Departures (named by slug; the coordinator assigns numbers; each below was accepted in H8 or H9):**
- `no-run-lines-share-one-label`. Each box-wide line is keyed in the banner by its label (`ChildReclaimBanner.tsx:148`, `key={a.sessionId}`), so two lines under one label would be a duplicate React key. Run-less items of every word that passes `CHILD_RECLAIM_KEPT_MANY_OVER` share ONE count line under `COLLECT_BOX_LABELS['no-run']`. It has one clause per word: the count, at most five ids, then "For each one: <lead>".
- `box-probe-line-clears-on-a-passing-answer`. R87 says when a box-wide probe's line stands, not when it ends. `collectBoxProbesAfter` keeps each box-wide probe's latest detail until an answer passes every rung (`collectable`, `changed-recently`, or `collected`). A per-id answer leaves it standing.
- `unvouched-line-waits-the-ceiling`. Ids held by (b) or (c) join the one box line under the same rule as every per-id hold: once Task 4's hold cause stands, held `CHILD_RECLAIM_DEFER_CEILING_MS` from the first hold to the latest. Their next ask waits that ceiling flat (R86, H1), so the line appears at their second hold.
- `clips-clause-wrapped-in-one-sentence`. The leaf's clips clause, `its clips directory … (<word>: <phrase>)` or the cut-line `whether its clips directory … was kept is not known`, is carried verbatim inside ONE wrapper sentence that is true of both shapes: `Also, an earlier reclaim of this id may have left a clips directory on disk: <clause>. ccrc never removes the clips directory; a person removes it once nothing still uses it.`
- `reclaim-kept-many-member-with-a-clause-stays-single`. "An item that carries a second clause never joins a collapsed line" is applied to wave 8's reclaim `kept-many` too. Such a member leaves the line as a single `kept` item with `CHILD_RECLAIM_SKIP[word].sentence` plus its clause. The rest are relisted through `childReclaimKeptList`, so they collapse again only past the limit.
- `stuck-end-exported`. `childReclaimStuckEnd` gains the `export` keyword, so the collector's "What ccd said:" clause ends a detail exactly as the stuck sentence does. Nothing else about it changes.
- `watch-interim-empty-collector`. `childReclaimPublishAttention` passes `CHILD_RECLAIM_COLLECT_NONE` (H8), never an inline object, until Task 7 wires the lane's memory. The constant joins `watch.ts`'s existing `./childReclaimSweep.js` import in place, on its line `:107` (the statement spans `:94-108`), so the import block keeps its line count and stays clear of run 358's `:112`, `:121` and `:125`.

- [ ] **Step 0: Entry conditions.** Run from the worktree root:

```bash
grep -nE "export function isTmpRootId|export const TMPROOT_ID_MAX_CHARS|export interface ChildReclaimCollectAttention|export interface ChildReclaimCollectMany|export const COLLECT_BOX_LABELS|export type CollectBoxLine|export const COLLECT_BOX_LINES|export type CollectToken" shared/api.ts   # (a) Task 1: EIGHT lines
grep -n "| ChildReclaimCollectAttention | ChildReclaimCollectMany;$" shared/api.ts                   # (b) Task 1's union line: ONE
grep -n "The four arms below and the five this file's foot declares" shared/api.ts                  # (c) Task 1's doc pair: ONE
grep -nF "switch. \`runId\` is the run the item's own evidence names, else null: the registry marker's minting run on" shared/api.ts   # (d) Task 1's runId sentence: ONE
grep -nE "export function parseCollectAudit|export const COLLECT_PROBE_CLASS|export function collectProbeClass\b|export type CollectAudit\b|export type CollectResult\b|export type CollectProbeClass|export type CollectDieWord|export const COLLECT_POPULATION_MAX|export type CollectListingDoubt" server/src/collectLane.ts   # (e) Tasks 2-3: NINE lines
grep -nE "export interface CollectEntry\b|export type CollectHoldWhy|export type CollectRun\b|export type CollectRunToken|export const COLLECT_RUN_NONE|export const collectRunTier|export const COLLECT_CHANGED_RECENTLY_SPAN_MS|export type CollectAttentionCause|export function collectAttentionCauses|export const collectWouldCollectStands|export const collectWouldCollectKey|export type CollectFeedCue|export function collectFeedStep" server/src/collectLane.ts   # (f) Task 4: THIRTEEN lines
grep -n "'run-after-witness'\|'id-in-open-run'\|readonly kind: 'die'" server/src/collectLane.ts      # (f2) H3's hold whys and H1's die cause: each present
grep -n "collectProbeClassOf\|CollectListingLine\|'run-postdates-witness'\|'run-names-id'" server/src/collectLane.ts   # (f3) NOTHING
sed -n '/^export type CollectAudit =/,/;$/p' server/src/collectLane.ts                               # (f4) the verdict and unmeasured arms carry witnessRun and leaf (H3)
grep -nE "^export const (collectable|verdict|unmeasured|NO_DOCUMENT|UNREADABLE|COLLECTED|refusedAct|failedAct|DIE|ACT_NO_DOCUMENT|T1|DAY|step)\b" server/test/collectAnswers.ts   # (k) Task 4's builders: THIRTEEN
grep -c "^import" server/src/collectLane.ts                                                          # (l) TWO (H2)
grep -n "^export function childReclaimTierFrom" server/src/childReclaimSweep.ts                     # (g) Task 4: ONE
grep -n "const leafIdOk" server/src/childReclaimSweep.ts                                            # (h) Task 1: NOTHING
grep -n "^const childReclaimStuckEnd\|^export const CHILD_RECLAIM_SKIP\|^export function childReclaimKeptManySentence" server/src/childReclaimSweep.ts   # (i) THREE
grep -n "^  CHILD_RECLAIM_SWEEP_REJECTED, childReclaimTierSeed,$" server/src/watch.ts               # (m) ONE line (107 at d0c2b7803)
sed -n '/^export const COLLECT_BOX_LABELS/,/^} as const;/p' shared/api.ts                           # (j) Task 1's table, printed
```

- (a) to (f2), (g), (k), (l) or (m) printing short, or (f3) printing a line → STOP and report: an earlier task owes it, under H3's canonical name. Never declare a Task 1 to 4 export here.
- (f4): a `verdict` or `unmeasured` arm without `witnessRun` and `leaf` → STOP: Task 2 owes H3's shape.
- (h) printing a line → STOP: Task 1 lifts the predicate.
- (j): the keys are exactly `tmproots`, `tmpquarantine`, `refused-names`, `box-probe`, `no-document`, `lock`, `flock`, `unsettled`, `unvouched` and `no-run`. Any other key set → STOP: Task 1 owes it (H3). This task never rewrites the table, and its sentences use Task 1's label strings as they stand.

- [ ] **Step 1: Write the failing tests.**

Create `server/test/child-reclaim-detail-unsafe-classes.test.ts`:

```ts
// Child reclamation wave 9 (spec §5.9, §5.10): `detailUnsafe` widened from a hand list to every code point of general
// category Cc, Cf, Zl, Zp or Cs, plus U+034F and the whole tag block U+E0000 to U+E007F by range. One case per class,
// so deleting a class reds a named case; the upper bounds of wave 8's hand ranges are pinned, so a narrowed class reds
// too; and LC_LINE_MAX cuts at 2048 and 2049. Built from code points, never escapes: an agent's file write decodes a
// backslash-u escape.
import { describe, it, expect } from 'vitest';
import { LC_LINE_MAX } from '../../shared/api.js';
import { childReclaimDetailText } from '../src/childReclaimSweep.js';

const cp = (n: number): string => String.fromCodePoint(n);

describe('detailUnsafe: one case per class it names (spec §5.9)', () => {
  it.each<readonly [string, number]>([
    ['Cc: ESC', 0x1b],
    ['Cc: the C0 upper bound (US)', 0x1f],
    ['Cc: DEL', 0x7f],
    ['Cc: the C1 upper bound (APC)', 0x9f],
    ['Cf: LRM', 0x200e],
    ['Cf: RLM', 0x200f],
    ['Cf: ALM', 0x061c],
    ['Cf: ZWSP', 0x200b],
    ['Cf: ZWJ', 0x200d],
    ['Cf: the byte-order mark', 0xfeff],
    ['Cf: the soft hyphen', 0x00ad],
    ['Cf: the Mongolian vowel separator', 0x180e],
    ['Cf: the word joiner', 0x2060],
    ['Cf: invisible plus', 0x2064],
    ['Cf: inhibit symmetric swapping', 0x206a],
    ['Cf: nominal digit shapes', 0x206f],
    ['Cf: the interlinear annotation anchor', 0xfff9],
    ['Cf: the interlinear annotation terminator', 0xfffb],
    ['Cf: the bidi override upper bound (RLO)', 0x202e],
    ['Cf: the bidi isolate upper bound (PDI)', 0x2069],
    ['Cf: tag latin small a', 0xe0061],
    ['Zl: the line separator', 0x2028],
    ['Zp: the paragraph separator', 0x2029],
    ['Cs: a lone high surrogate', 0xd800],
    ['Cs: a lone low surrogate', 0xdfff],
    ['U+034F: the combining grapheme joiner (Mn)', 0x034f],
    ['the tag block by range: U+E0000 (Cn)', 0xe0000],
    ['the tag block by range: U+E0002 (Cn)', 0xe0002],
    ['the tag block by range: U+E001F (Cn)', 0xe001f],
  ])('%s becomes one space', (_name, n) => {
    expect(childReclaimDetailText(`left${cp(n)}right`)).toBe('left right');
  });

  it('the CONTROL: the code points just outside every class pass through unchanged', () => {
    for (const n of [0x41, 0x20, 0x7e, 0xa0, 0x034e, 0x0350, 0x2027, 0x202f, 0x2065, 0x2070, 0xfffc, 0xe0080, 0x1f600]) {
      expect(childReclaimDetailText(`left${cp(n)}right`), n.toString(16)).toBe(`left${cp(n)}right`);
    }
  });
});

describe('LC_LINE_MAX bounds the line (spec §5.9)', () => {
  it('is 2048 code points: 2048 are kept whole, 2049 are cut to 2048 and an ellipsis', () => {
    expect(LC_LINE_MAX).toBe(2048);
    expect(childReclaimDetailText('x'.repeat(2048))).toBe('x'.repeat(2048));
    expect(childReclaimDetailText('x'.repeat(2049))).toBe(`${'x'.repeat(2048)}…`);
  });
});
```

In `server/test/child-reclaim-detail-text.test.ts`, change the CONTROL row `for (const n of [0x20, 0x7e, 0xa0, 0x2027, 0x202f, 0x2065, 0x206a]) {` to `for (const n of [0x20, 0x7e, 0xa0, 0x2027, 0x202f, 0x2065, 0x2070]) {`. U+206A is Cf now, and the new file pins it as unsafe.

Create `server/test/child-reclaim-leaf-kept-prose.test.ts`:

```ts
// Child reclamation wave 9 (spec §5.9, §5.10): the kept-leaf sentences stay true whether the temp-root collector is
// shadowed, armed, paused, or absent on a box whose ccd cannot collect, each half written only when that half was
// kept; the yield carries the clips clause a winning item quotes; and L0's `runId` sentence, as Task 1 rewrote it
// (attention-runid-sentence-misses-leaf-arms), names the evidence of every arm: its three lines are pinned verbatim.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { reviveMeas } from '../src/coord/journalparse.js';
import {
  childReclaimLeafKept, childReclaimLeafKeptManySentence, childReclaimLeafKeptSentence,
  type ChildReclaimLeafSourceRow,
} from '../src/childReclaimSweep.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const NOW = 1_790_000_000_000;
const HORIZON = 'This line ends when the id is used for a new workspace, or 7 days after ccd recorded the reclaim; '
  + 'the feed keeps the record.';
const CLIPS_HALF = 'ccrc never removes the clips directory; a person removes it once nothing still uses it.';
const TMP_HALF = 'ccrc’s temp-root collector removes the temp root once it has stood idle, but only while the '
  + 'collector is switched on, the fleet box’s ccd can collect and cleanup is not paused, and only if ccrc recorded '
  + 'handing that directory out; until then, or if the collector lists it for you, a person removes it once nothing '
  + 'still uses it. The temp root leaves this line once it is collected.';
const NONE = { kind: 'none-or-unreported' } as const;

let mid = 5000;
const row = (sessionId: string, meas: Record<string, unknown> | null, truncated = false): ChildReclaimLeafSourceRow => ({
  id: (mid += 1), sessionId, at: NOW - 1000, outcome: 'done', refusal: null, truncated,
  meas: meas === null ? null : reviveMeas(meas), detail: null,
});

describe('the kept-leaf sentences (spec §5.9, §5.10)', () => {
  it('each half is written only when that half was kept', () => {
    expect(childReclaimLeafKeptSentence('demo-g', { kind: 'kept', word: 'refused' }, NONE, null)).toBe(
      'The reclaim of this child completed, but ccd kept its clips directory ~/.cc-clips/demo-g (refused: its removal '
      + `helper refused it). What was kept stays on disk. ${CLIPS_HALF} ${HORIZON}`);
    expect(childReclaimLeafKeptSentence('demo-g', NONE, { kind: 'kept', word: 'in-use' }, null)).toBe(
      'The reclaim of this child completed, but ccd kept its temp root ~/.cc-tmp/demo-g (in-use: a process still used '
      + `it after the bounded wait). What was kept stays on disk. ${TMP_HALF} ${HORIZON}`);
    expect(childReclaimLeafKeptSentence('demo-g', { kind: 'kept', word: 'unmeasured' }, { kind: 'kept', word: 'refused' }, null)).toBe(
      'The reclaim of this child completed, but ccd kept its clips directory ~/.cc-clips/demo-g (unmeasured: whether it '
      + 'could be removed could not be measured) and its temp root ~/.cc-tmp/demo-g (refused: its removal helper '
      + `refused it). What was kept stays on disk. ${CLIPS_HALF} ${TMP_HALF} ${HORIZON}`);
  });

  it('the collapsed line', () => {
    expect(childReclaimLeafKeptManySentence(6)).toBe('6 reclaimed child workspaces have a clips directory or a temp '
      + 'root that ccd kept on disk. Each clips directory stays until a person removes it; each temp root stays until '
      + 'ccrc’s temp-root collector removes it, while the collector is switched on and cleanup is not paused, or until '
      + 'a person does. The feed row of each names what was kept and why. Each one leaves this line when its id is '
      + 'used for a new workspace, or 7 days after ccd recorded its reclaim.');
  });

  it('"ccrc deletes nothing more of it" is gone from the source, and so is the old collapsed clause', () => {
    const src = read('server/src/childReclaimSweep.ts');
    expect(src).not.toContain('ccrc deletes nothing more of it');
    expect(src).not.toContain('Each stays until a person removes it, and');
  });

  it('childReclaimLeafKept yields the clips clause: the clips part when kept, the unknown clause on a cut line, else null', () => {
    const got = childReclaimLeafKept({ rows: [
      row('demo-k', { childOf: '41', clipsKept: 'refused' }),
      row('demo-t', { childOf: '41', tmpRootKept: 'in-use' }),
      row('demo-x', null, true),
    ], ends: new Map(), nowMs: NOW });
    expect(got.map((k) => [k.item.sessionId, k.clipsClause])).toEqual([
      ['demo-k', 'its clips directory ~/.cc-clips/demo-k (refused: its removal helper refused it)'],
      ['demo-t', null],
      ['demo-x', 'whether its clips directory ~/.cc-clips/demo-x was kept is not known'],
    ]);
    expect(got[0]!.item.sentence, 'the clause is the sentence’s own words').toContain(got[0]!.clipsClause);
  });
});

describe('L0’s runId sentence names every arm’s evidence (Task 1’s three lines, verbatim)', () => {
  it('the marker’s run, meas.childOf on leaf-kept, collect.witness.run on collect; a box-wide line has none', () => {
    const api = read('shared/api.ts');
    expect(api).toContain("switch. `runId` is the run the item's own evidence names, else null: the registry marker's minting run on");
    expect(api).toContain("`terminal`, `failing`, `stuck` and `kept` (never null on `kept`), the journal line's `meas.childOf` on");
    expect(api).toContain("`leaf-kept`, and the collect audit's `collect.witness.run` on `collect`; a box-wide `collect` line has none.");
    expect(api).not.toContain('switch. `runId` is the minting run the registry marker names, or null when');
  });
});
```

In `server/test/child-reclaim-leaf-kept.test.ts`:
- Replace the `KEPT_TAIL`, `TMP_IN_USE`, `CLIPS_REFUSED` and `BOTH` constants with the block below. Each sentence is the new one, and the prose file above pins the halves verbatim.

```ts
const CLIPS_HALF = 'ccrc never removes the clips directory; a person removes it once nothing still uses it.';
const TMP_HALF = 'ccrc’s temp-root collector removes the temp root once it has stood idle, but only while the '
  + 'collector is switched on, the fleet box’s ccd can collect and cleanup is not paused, and only if ccrc recorded '
  + 'handing that directory out; until then, or if the collector lists it for you, a person removes it once nothing '
  + 'still uses it. The temp root leaves this line once it is collected.';
const TMP_IN_USE = 'The reclaim of this child completed, but ccd kept its temp root ~/.cc-tmp/demo-gone (in-use: a '
  + `process still used it after the bounded wait). What was kept stays on disk. ${TMP_HALF} ${HORIZON}`;
const CLIPS_REFUSED = 'The reclaim of this child completed, but ccd kept its clips directory ~/.cc-clips/demo-gone '
  + `(refused: its removal helper refused it). What was kept stays on disk. ${CLIPS_HALF} ${HORIZON}`;
const BOTH = 'The reclaim of this child completed, but ccd kept its clips directory ~/.cc-clips/demo-gone '
  + '(unmeasured: whether it could be removed could not be measured) and its temp root ~/.cc-tmp/demo-gone '
  + `(refused: its removal helper refused it). What was kept stays on disk. ${CLIPS_HALF} ${TMP_HALF} ${HORIZON}`;
```

- In "lists a done row that kept the temp root…", the expected yield gains `clipsClause: null` after `detail: 'temp root kept (in-use): pid 7',`.
- In "lists a line cut to fit, with no run and its own sentence", the expected yield gains ``clipsClause: `whether its clips directory ~/.cc-clips/${ID} was kept is not known`,`` after `detail: 'clips kept (refused)',`. The row is `truncated: true, meas: null`, so its clips leaf is `truncated` and Step 4(e) yields that clause.
- In the `on the list` describe:
  - add `CHILD_RECLAIM_COLLECT_NONE, type ChildReclaimLeafKept` to the `../src/childReclaimSweep.js` import;
  - add this line under `const item = …`:
    `const y = (a: ChildReclaimLeafKeptAttention): ChildReclaimLeafKept => ({ item: a, source: 1, detail: null, clipsClause: null });`
  - rewrite each of the three `childReclaimAttentionWithLeaves(X, L)` calls as `childReclaimAttentionWithLeaves(X, L.map(y), CHILD_RECLAIM_COLLECT_NONE)`. Their expected values are unchanged.
- In "collapses more than …", the `childReclaimLeafKeptManySentence(6)` text becomes the prose file's collapsed sentence, verbatim.
- In the `childReclaimDetailText` describe, `leaf` gains `clipsClause: null` after `detail`.

Create `server/test/collect-attention.test.ts`:

```ts
// Child reclamation wave 9 (spec §5.10, §5.9): the temp-root collector's attention. The lane's memory says what stands
// for each id; `collectAttentionItems` (L1) turns it into ONE item per id plus the box-wide lines, and
// `childReclaimAttentionWithLeaves` merges them: a reclaim item over a collector item over a kept-leaf item, the winner
// carrying the loser's operator instruction as a second clause. Pure: no clock, file or row is read here, and the last
// case reads the result through the PWA's own reader, so every shape renders with no PWA edit.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  COLLECT_BOX_LABELS, isSessionIdShape, isTmpRootId, lcRefusalWord,
  type ChildReclaimAttention, type ChildReclaimCollectAttention,
} from '../../shared/api.js';
import {
  CHILD_RECLAIM_DEFER_CEILING_MS, CHILD_RECLAIM_KEPT_MANY_OVER, CHILD_RECLAIM_SKIP, CHILD_RECLAIM_TIER_NONE,
  childReclaimAttentionWithLeaves, childReclaimClipsSecond, childReclaimCollectManySentence,
  childReclaimKeptManySentence, childReclaimTierFrom, type ChildReclaimCollectInput, type ChildReclaimLeafKept,
} from '../src/childReclaimSweep.js';
import {
  COLLECT_RUN_NONE, collectAfterAct, collectAfterAudit, collectAfterHold, collectAfterPresence, collectAttentionItems,
  collectAttentionViewOf, collectBoxProbesAfter, collectFeedStep, collectFirstSighting, collectPassClass,
  collectRunTier, collectWouldCollectKey,
  type CollectAttentionView, type CollectAudit, type CollectBoxFacts, type CollectEntry, type CollectRunView,
} from '../src/collectLane.js';
import { COLLECTED, DAY, DIE, NO_DOCUMENT, T1, collectable, step, unmeasured, verdict } from './collectAnswers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = 90_000_000;                      // the lane's monotonic clock
const CEIL = CHILD_RECLAIM_DEFER_CEILING_MS;
const NL = String.fromCharCode(10);
const RLO = String.fromCharCode(0x202e);

const NO_RUN: CollectRunView = { tier: CHILD_RECLAIM_TIER_NONE, word: null, detail: null };
const runOf = (cls: string, word: string, n: number, stuck = false, detail: string | null = null): CollectRunView =>
  ({ tier: childReclaimTierFrom(cls, n, stuck), word, detail });
const view = (over: Partial<CollectAttentionView> = {}): CollectAttentionView => ({
  witnessRun: 41, leaf: '/h/tmp-root/demo-a', failing: NO_RUN, verbFailed: NO_RUN, terminal: NO_RUN, deferral: null,
  presenceSince: null, hold: null, changedRecentlySince: null, die: null, wouldCollect: false, ...over,
});
const BOX: CollectBoxFacts = {
  unmeasured: [], refusedNames: 0, boxProbes: new Map(), passAudits: new Map(), flockLatched: false, unsettled: new Map(),
};
const items = (entries: Readonly<Record<string, CollectAttentionView>>, box: Partial<CollectBoxFacts> = {},
  nowMono = NOW): ChildReclaimCollectInput =>
  collectAttentionItems({ entries: new Map(Object.entries(entries)), box: { ...BOX, ...box }, nowMono });
const one = (v: CollectAttentionView, nowMono = NOW): ChildReclaimCollectAttention | undefined =>
  items({ 'demo-a': v }, {}, nowMono).perId[0];

describe('collectAttentionItems — one item per id, each at its own threshold (spec §5.10)', () => {
  it('in-use is listed at once, naming the holder ccd named, through childReclaimDetailText', () => {
    const a = one(view({ deferral: { word: 'in-use', detail: `pid 7 (tmux: server) holds /proc/7/fd/3${NL}${RLO}x`, since: NOW } }));
    expect(a).toEqual({ kind: 'collect', sessionId: 'demo-a', runId: 41, word: 'in-use', sentence:
      'A process still uses its temp root /h/tmp-root/demo-a, so the temp-root collector leaves it alone. What ccd '
      + 'said: pid 7 (tmux: server) holds /proc/7/fd/3 x. ccrc never stops a process; it asks again later, and this '
      + 'line ends once nothing uses it.' });
  });

  it('a standing registered, in-progress, presence or per-id hold is listed under its own word (WHEN each stands is Task 4’s)', () => {
    const cases: readonly (readonly [string, CollectAttentionView])[] = [
      ['registered', view({ deferral: { word: 'registered', detail: '', since: 0 } })],
      ['in-progress', view({ deferral: { word: 'in-progress', detail: '', since: 0 } })],
      ['presence', view({ presenceSince: 0 })],
      ['held', view({ hold: { why: 'run-open', since: 0 } })],
    ];
    for (const [word, v] of cases) expect(one(v)?.word, word).toBe(word);
  });

  it('in-progress names the reap lock path, and no holder ccd did not name', () => {
    const s = one(view({ deferral: { word: 'in-progress', detail: '', since: NOW - CEIL - 1 } }))!.sentence;
    expect(s).toContain('~/.cc-sessions/.reap-demo-a.lock');
    expect(s).not.toMatch(/pid|holder/);
  });

  it('a per-leaf deterministic answer is listed at once; a load-sensitive one, no-document and lock only at tier entry', () => {
    expect(one(view({ failing: runOf('failing', 'device', 1, true, 'a mount') }))?.word, 'device at once').toBe('per-leaf');
    for (const probe of ['checkouts', 'no-document', 'lock', 'idle:timeout']) {
      expect(one(view({ failing: runOf('failing', probe, 3) })), `${probe} x3`).toBeUndefined();
      expect(one(view({ failing: runOf('failing', probe, 4) }))?.word, `${probe} x4`).toBe('failing');
    }
    expect(one(view({ failing: runOf('failing', 'no-document', 4) }))!.sentence).toContain('(ccd answered nothing)');
  });

  it('a verb failure is listed at tier entry, never before', () => {
    expect(one(view({ verbFailed: runOf('verb-failed', 'probe-unmeasured', 3) }))).toBeUndefined();
    expect(one(view({ verbFailed: runOf('verb-failed', 'probe-unmeasured', 4) }))?.word).toBe('verb-failed');
  });

  it('an unknown probe or failure word reaches its sentence only through childReclaimDetailText', () => {
    const bad = `fro${NL}${RLO}b`;
    for (const v of [view({ failing: runOf('failing', bad, 4) }), view({ verbFailed: runOf('verb-failed', bad, 4) })]) {
      const s = one(v)!.sentence;
      expect(s.includes(NL) || s.includes(RLO), s).toBe(false);
      expect(s).toContain('(fro b)');
    }
  });

  it('a terminal answer is listed at once with what ccd last answered, never that it refuses now (H8), and outranks a standing in-use', () => {
    const terminal = runOf('terminal', 'witness-mismatch', 1, true, 'witness unreadable');
    expect(one(view({ witnessRun: null, terminal }))).toEqual({ kind: 'collect', sessionId: 'demo-a', runId: null,
      word: 'witness-mismatch', sentence: 'Its temp root /h/tmp-root/demo-a: ccd’s last terminal answer for it was '
        + `witness-mismatch, which said: “${lcRefusalWord('witness-mismatch')}” What ccd said: witness unreadable. `
        + 'ccrc asks again on a long, capped schedule.' });
    expect(one(view({ terminal, deferral: { word: 'in-use', detail: 'pid 7', since: NOW } }))?.word).toBe('witness-mismatch');
    expect(one(view({ terminal: runOf('terminal', 'containment-unproven', 1, true) }))!.sentence)
      .toContain('ccd’s last terminal answer for it was containment-unproven, which means');
  });

  it('a standing changed-recently is listed', () => {
    expect(one(view({ changedRecentlySince: 0 }))?.word).toBe('changed-recently');
  });

  it('a standing would-collect episode is listed, in words true whether the lane is still shadowed or armed since', () => {
    const a = one(view({ wouldCollect: true }))!;
    expect(a.word).toBe('would-collect');
    expect(a.sentence).toContain('While the collector was shadowed');
    expect(a.sentence, 'a flip to live does not end the episode, so no present-tense shadow').not.toMatch(/is shadowed|arms it by hand/);
  });

  it('a pre-lock die recurring past the ceiling is listed, naming ccd’s word; nothing was removed (H1)', () => {
    const a = one(view({ die: { word: 'lock-unopenable', since: 0 } }))!;
    expect(a.word).toBe('die');
    expect(a.sentence).toContain('(lock-unopenable)');
    expect(a.sentence).toContain('nothing was removed');
  });

  it('records lists no per-id item while tmpquarantine is unmeasured', () => {
    const v = { 'demo-a': view({ failing: runOf('failing', 'records', 4) }) };
    expect(items(v).perId.map((a) => a.word)).toEqual(['failing']);
    const blind = items(v, { unmeasured: [{ listing: 'tmpquarantine', kind: 'unmeasured', why: 'x' }] });
    expect(blind.perId).toEqual([]);
    expect(blind.box.map((a) => a.word)).toEqual(['tmpquarantine']);
  });

  it('an id that fails isTmpRootId never lists, and nothing standing lists nothing', () => {
    const inUse = view({ deferral: { word: 'in-use', detail: 'pid 7', since: NOW } });
    expect(items({ '-x': inUse, '.y': inUse }).perId).toEqual([]);
    expect(items({ 'demo-a': view() })).toEqual({ perId: [], manyLead: {}, box: [] });
  });
});

describe('box-wide lines: single items under fixed labels (spec §5.10)', () => {
  it('every label is spelled once, holds a slash, which no registry file name can carry, and is no session id', () => {
    const labels = Object.values(COLLECT_BOX_LABELS);
    expect(Object.keys(COLLECT_BOX_LABELS).sort()).toEqual(['box-probe', 'flock', 'lock', 'no-document', 'no-run',
      'refused-names', 'tmpquarantine', 'tmproots', 'unsettled', 'unvouched']);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) {
      expect(/\//.test(l), l).toBe(true);
      expect(isSessionIdShape(l), l).toBe(false);
      expect(isTmpRootId(l), l).toBe(false);
    }
  });

  it('an unmeasured listing, an over-cap listing and refused names: one line each, in the label table’s order, counts only', () => {
    const got = items({}, { unmeasured: [{ listing: 'tmpquarantine', kind: 'unmeasured', why: `a symbolic link${NL}` },
      { listing: 'tmproots', kind: 'over-cap', count: 100_000 }], refusedNames: 3 }).box;
    expect(got.map((a) => [a.sessionId, a.word, a.runId])).toEqual([
      [COLLECT_BOX_LABELS.tmproots, 'tmproots', null], [COLLECT_BOX_LABELS.tmpquarantine, 'tmpquarantine', null],
      [COLLECT_BOX_LABELS['refused-names'], 'refused-names', null]]);
    expect(got[0]!.sentence).toContain(`${COLLECT_BOX_LABELS.tmproots} holds 100000 names`);
    expect(got[1]!.sentence.includes(NL)).toBe(false);
    expect(got[2]!.sentence.startsWith('3 names under')).toBe(true);
    expect(got[2]!.sentence, 'Task 3 counts more than dashes and length').toContain('is no quarantine record of one');
  });

  it('box-wide probes: ONE line naming each probe with ccd’s detail', () => {
    const got = items({}, { boxProbes: new Map([['mv', `no mv${NL}${RLO}`], ['floor', 'unset']]) }).box;
    expect(got).toHaveLength(1);
    expect(got[0]!.sessionId).toBe(COLLECT_BOX_LABELS['box-probe']);
    expect(got[0]!.sentence).toContain('floor (unset); mv (no mv)');
  });

  it('no-document and lock: a line only for two or more ids, with nothing else answered that pass', () => {
    const pa = (e: Readonly<Record<string, 'no-document' | 'lock' | 'other'>>): string[] =>
      items({}, { passAudits: new Map(Object.entries(e)) }).box.map((a) => a.word);
    expect(pa({ a: 'no-document' })).toEqual([]);
    expect(pa({ a: 'no-document', b: 'no-document' })).toEqual(['no-document']);
    expect(pa({ a: 'no-document', b: 'no-document', c: 'other' })).toEqual([]);
    expect(pa({ a: 'lock' }), 'one id with a planted lock directory raises no box-wide line').toEqual([]);
    expect(pa({ a: 'lock', b: 'lock' })).toEqual(['lock']);
    expect(pa({ a: 'lock', b: 'lock', c: 'no-document' })).toEqual([]);
  });

  it('the flock latch and unsettled calls or jobs each raise one line; unsettled names its ids, and a job says the act slot is held, its act out or not (H1, R85)', () => {
    expect(items({}, { flockLatched: true }).box.map((a) => a.word)).toEqual(['flock']);
    const two = items({}, { unsettled: new Map([['demo-b', 'audit'], ['demo-a', 'audit']]) }).box;
    expect(two.map((a) => a.word)).toEqual(['unsettled']);
    expect(two[0]!.sentence).toContain('demo-a, demo-b');
    expect(two[0]!.sentence, 'audits alone hold no slot').not.toContain('act slot');
    const u = items({}, { unsettled: new Map([['demo-b', 'audit'], ['demo-a', 'act']]) }).box;
    expect(u[0]!.sentence).toContain('within its bound for demo-b.');
    expect(u[0]!.sentence, 'a job whose act is out holds the slot too (R85)').toContain('act slot is held by the job for demo-a');
    const j = items({}, { unsettled: new Map([['demo-b', 'audit'], ['demo-c', 'job']]) }).box;
    expect(j.map((a) => a.word)).toEqual(['unsettled']);
    expect(j[0]!.sentence).toContain('within its bound for demo-b.');
    expect(j[0]!.sentence).toContain('act slot is held by the job for demo-c');
  });

  it('ids held by run-absent or run-after-witness share ONE line naming at most five ids (a hold short of the ceiling projects to null)', () => {
    const held = (why: 'run-absent' | 'run-after-witness' | 'run-open') => view({ hold: { why, since: 0 } });
    const entries = Object.fromEntries([
      ...['demo-1', 'demo-2', 'demo-3', 'demo-4'].map((id) => [id, held('run-absent')]),
      ...['demo-5', 'demo-6', 'demo-7'].map((id) => [id, held('run-after-witness')]),
      ['demo-8', held('run-open')], ['demo-9', view()],
    ]);
    const got = items(entries);
    expect(got.perId.map((a) => [a.sessionId, a.word])).toEqual([['demo-8', 'held']]);
    expect(got.box.map((a) => a.word)).toEqual(['unvouched']);
    expect(got.box[0]!.sentence).toContain('7 temp roots are held');
    expect(got.box[0]!.sentence).toContain('demo-1, demo-2, demo-3, demo-4, demo-5, and 2 more');
  });
});

describe('collectPassClass and collectBoxProbesAfter (spec §5.10)', () => {
  it('classes an audit for the two pass-scoped lines', () => {
    expect(collectPassClass(NO_DOCUMENT)).toBe('no-document');
    expect(collectPassClass(unmeasured('lock'))).toBe('lock');
    expect(collectPassClass(unmeasured('checkouts'))).toBe('other');
    expect(collectPassClass(verdict('in-use'))).toBe('other');
  });

  it('a box-wide probe stands until an answer passes every rung; a per-id answer leaves it standing', () => {
    const s1 = collectBoxProbesAfter(new Map(), unmeasured('mv'));
    expect([...s1]).toEqual([['mv', 'mv: d']]);
    for (const a of [unmeasured('checkouts'), verdict('registered'), NO_DOCUMENT]) {
      expect(collectBoxProbesAfter(s1, a), JSON.stringify(a)).toBe(s1);
    }
    for (const a of [collectable(T1), verdict('changed-recently'), COLLECTED]) {
      expect(collectBoxProbesAfter(s1, a).size, JSON.stringify(a)).toBe(0);
    }
  });
});

describe('collectAttentionViewOf — Task 4’s causes decide what stands, first answer to latest, inclusive (spec §5.10, H3, H9)', () => {
  const after = (answers: readonly (readonly [number, CollectAudit])[]): CollectEntry =>
    answers.reduce((e, [mono, a], k) => collectAfterAudit(e, a, step(mono, k + 2), true), collectFirstSighting(1));

  it('in-use stands at its first answer, with ccd’s latest detail', () => {
    expect(collectAttentionViewOf(after([[0, verdict('in-use')]])).deferral)
      .toEqual({ word: 'in-use', detail: 'in-use: d', since: 0 });
  });

  it('registered and in-progress stand once their first and latest answers are a ceiling apart, not a millisecond sooner', () => {
    for (const word of ['registered', 'in-progress']) {
      expect(collectAttentionViewOf(after([[0, verdict(word)], [CEIL - 1, verdict(word)]])).deferral, `${word} short`).toBeNull();
      expect(collectAttentionViewOf(after([[0, verdict(word)], [CEIL, verdict(word)]])).deferral, `${word} at the ceiling`)
        .toEqual({ word, detail: `${word}: d`, since: 0 });
    }
  });

  it('changed-recently stands once its streak spans a day, first answer to latest', () => {
    const cr = verdict('changed-recently');
    expect(collectAttentionViewOf(after([[0, cr], [DAY - 1, cr]])).changedRecentlySince).toBeNull();
    expect(collectAttentionViewOf(after([[0, cr], [DAY, cr]])).changedRecentlySince).toBe(0);
  });

  it('a hold and presence stand once they span a ceiling, first answer to latest', () => {
    const held = (gap: number): CollectEntry =>
      collectAfterHold(collectAfterHold(collectFirstSighting(1), 'run-open', step(0, 2)), 'run-open', step(gap, 3));
    expect(collectAttentionViewOf(held(CEIL - 1)).hold, 'held short').toBeNull();
    expect(collectAttentionViewOf(held(CEIL)).hold).toEqual({ why: 'run-open', since: 0 });
    const present = (gap: number): CollectEntry =>
      collectAfterPresence(collectAfterPresence(collectFirstSighting(1), step(0, 2)), step(gap, 3));
    expect(collectAttentionViewOf(present(CEIL - 1)).presenceSince, 'presence short').toBeNull();
    expect(collectAttentionViewOf(present(CEIL)).presenceSince).toBe(0);
  });

  it('a pre-lock die recurring for a ceiling, first answer to latest, stands; a shorter recurrence does not (H1)', () => {
    const died = (gap: number): CollectEntry =>
      collectAfterAct(collectAfterAct(collectFirstSighting(1), DIE, step(0, 2)), DIE, step(gap, 3));
    expect(collectAttentionViewOf(died(CEIL - 1)).die).toBeNull();
    expect(collectAttentionViewOf(died(CEIL)).die).toEqual({ word: 'lock-unopenable', since: 0 });
  });

  it('each run projects its tier, its latest word and detail; the evidence is the latest document’s', () => {
    const e = after([[0, unmeasured('device')]]);
    const v = collectAttentionViewOf(e);
    expect(v.failing).toEqual({ tier: collectRunTier(e.failing, 'failing'), word: 'device', detail: 'device: d' });
    expect(v.failing.tier.tier, 'a per-leaf probe enters the tier at once').toBe(true);
    expect(v.terminal).toEqual({ tier: collectRunTier(COLLECT_RUN_NONE, 'terminal'), word: null, detail: null });
    expect([v.witnessRun, v.leaf]).toEqual([7, '/home/u/.cc-tmp/demo-a']);
  });

  it('wouldCollect is true while the would-collect episode stands, and false once another row opens', () => {
    const w = collectFeedStep(collectFirstSighting(1), { kind: 'row', key: collectWouldCollectKey(T1) }).entry;
    expect(collectAttentionViewOf(w).wouldCollect).toBe(true);
    expect(collectAttentionViewOf(collectFeedStep(w, { kind: 'row', key: 'in-use' }).entry).wouldCollect).toBe(false);
  });
});

describe('the merge: reclaim over collector over leaf-kept, with second clauses (spec §5.9, §5.10)', () => {
  const CLAUSE = 'its clips directory ~/.cc-clips/demo-c (refused: its removal helper refused it)';
  const col = (sessionId: string, word: string, runId: number | null = 41): ChildReclaimCollectAttention =>
    ({ kind: 'collect', sessionId, runId, word, sentence: `c ${sessionId}.` });
  const leaf = (sessionId: string, clipsClause: string | null): ChildReclaimLeafKept => ({
    item: { kind: 'leaf-kept', sessionId, runId: 41, sentence: `s ${sessionId}`, at: 1 }, source: 1, detail: null, clipsClause });
  const input = (perId: readonly ChildReclaimCollectAttention[], box: readonly ChildReclaimCollectAttention[] = []): ChildReclaimCollectInput =>
    ({ perId, manyLead: Object.fromEntries(perId.map((c) => [c.word, `lead ${c.word}`])), box });
  const term: ChildReclaimAttention = { kind: 'terminal', sessionId: 'demo-c', runId: 1, token: 'tree-unreadable', sentence: 't.', at: 1 };
  const ids = (n: number): string[] => Array.from({ length: n }, (_, k) => `demo-${String.fromCharCode(97 + k)}`);

  it('the clips clause and the collapsed sentence, verbatim', () => {
    expect(childReclaimClipsSecond('X')).toBe('Also, an earlier reclaim of this id may have left a clips directory on '
      + 'disk: X. ccrc never removes the clips directory; a person removes it once nothing still uses it.');
    expect(childReclaimCollectManySentence(6, 'L')).toBe('6 temp roots are listed for the same reason. For each one: L');
  });

  it('a reclaim item wins over a collector item and carries a quarantine-kept sentence; any other collector word is dropped', () => {
    expect(childReclaimAttentionWithLeaves([term], [], input([{ ...col('demo-c', 'quarantine-kept'), sentence: 'Q.' }])))
      .toEqual([{ ...term, sentence: 't. Q.' }]);
    expect(childReclaimAttentionWithLeaves([term], [], input([col('demo-c', 'in-use')]))).toEqual([term]);
  });

  it('a second clause the winner already gives is not given twice', () => {
    const said: ChildReclaimAttention = { ...term, sentence: 't. Q.' };
    expect(childReclaimAttentionWithLeaves([said], [], input([{ ...col('demo-c', 'quarantine-kept'), sentence: 'Q.' }])))
      .toEqual([said]);
  });

  it('leaf-yield-carries-the-clips-clause: a reclaim item carries a leaf’s clips clause; a leaf with none adds nothing', () => {
    expect(childReclaimAttentionWithLeaves([term], [leaf('demo-c', CLAUSE)], input([])))
      .toEqual([{ ...term, sentence: `t. ${childReclaimClipsSecond(CLAUSE)}` }]);
    expect(childReclaimAttentionWithLeaves([term], [leaf('demo-c', null)], input([]))).toEqual([term]);
  });

  it('a collector item wins over a leaf item and carries its clips clause', () => {
    expect(childReclaimAttentionWithLeaves([], [leaf('demo-c', CLAUSE)], input([col('demo-c', 'in-use')])))
      .toEqual([{ ...col('demo-c', 'in-use'), sentence: `c demo-c. ${childReclaimClipsSecond(CLAUSE)}` }]);
  });

  it('an item carrying a second clause never collapses: an id with both, among six collector items with runs, keeps its clips sentence', () => {
    const seven = ids(7).map((id) => col(id, 'failing'));
    const six = seven.filter((c) => c.sessionId !== 'demo-c');
    expect(childReclaimAttentionWithLeaves([], [leaf('demo-c', CLAUSE)], input(seven))).toEqual([
      { ...col('demo-c', 'failing'), sentence: `c demo-c. ${childReclaimClipsSecond(CLAUSE)}` },
      { kind: 'kept-many', word: 'collect:failing', members: six.map((c) => ({ sessionId: c.sessionId, runId: 41 })),
        sentence: childReclaimCollectManySentence(6, 'lead failing') },
    ]);
  });

  it(`more than ${CHILD_RECLAIM_KEPT_MANY_OVER} with runs of one word collapse under a word no other line uses; five stay single`, () => {
    const six = ids(6).map((id) => col(id, 'in-use'));
    const out = childReclaimAttentionWithLeaves([], [], input(six));
    expect(out).toEqual([{ kind: 'kept-many', word: 'collect:in-use', members: six.map((c) => ({ sessionId: c.sessionId, runId: 41 })),
      sentence: childReclaimCollectManySentence(6, 'lead in-use') }]);
    const five = ids(5).map((id) => col(id, 'in-use'));
    const loose = ['demo-v', 'demo-w', 'demo-x', 'demo-y', 'demo-z'].map((id) => col(id, 'in-use', null));
    expect(childReclaimAttentionWithLeaves([], [], input([...loose, ...five]))).toEqual([...five, ...loose]);
  });

  it('six unreadable witnesses (no run) list as ONE box-wide count line naming at most five ids', () => {
    const six = ids(6).map((id) => col(id, 'witness-mismatch', null));
    expect(childReclaimAttentionWithLeaves([], [], input(six))).toEqual([{ kind: 'collect',
      sessionId: COLLECT_BOX_LABELS['no-run'], runId: null, word: 'no-run',
      sentence: 'Temp roots with no recorded run are listed together. 6 answer witness-mismatch: demo-a, demo-b, '
        + 'demo-c, demo-d, demo-e, and 1 more. For each one: lead witness-mismatch' }]);
  });

  it('a reclaim kept-many member carrying a second clause leaves the line and stays single', () => {
    const members = ids(7).map((sessionId, runId) => ({ sessionId, runId }));
    const many: ChildReclaimAttention = { kind: 'kept-many', word: 'minting-run-absent', members,
      sentence: childReclaimKeptManySentence('minting-run-absent', 7) };
    const out = childReclaimAttentionWithLeaves([many], [leaf('demo-c', CLAUSE)], input([]));
    expect(out).toEqual([
      { kind: 'kept', sessionId: 'demo-c', runId: 2, word: 'minting-run-absent',
        sentence: `${CHILD_RECLAIM_SKIP['minting-run-absent'].sentence} ${childReclaimClipsSecond(CLAUSE)}` },
      { kind: 'kept-many', word: 'minting-run-absent', members: members.filter((m) => m.sessionId !== 'demo-c'),
        sentence: childReclaimKeptManySentence('minting-run-absent', 6) },
    ]);
  });

  it('the order: reclaim, the collector’s per-id items, its box lines, then the kept leaves; box lines take no id', () => {
    const r: ChildReclaimAttention = { ...term, sessionId: 'demo-r' };
    const b: ChildReclaimCollectAttention = { kind: 'collect', sessionId: COLLECT_BOX_LABELS.flock, runId: null, word: 'flock', sentence: 'f.' };
    const z = leaf('demo-z', null);
    expect(childReclaimAttentionWithLeaves([r], [z], input([col('demo-a', 'in-use')], [b])))
      .toEqual([r, col('demo-a', 'in-use'), b, z.item]);
  });
});

describe('every collector shape renders through the PWA’s one reader, with no PWA edit', () => {
  it('a per-id item, a collapsed line and a box-wide line; an unmeasured listing with no measured id included', async () => {
    const words = await import(path.join(ROOT, 'pwa/src/fleet/childReclaimWords.ts')) as {
      childReclaimAttentionOf: (coord: unknown) => unknown[] };
    const seven = ['demo-a', 'demo-b', 'demo-c', 'demo-d', 'demo-e', 'demo-f', 'demo-g'];
    const crowd = items(Object.fromEntries(seven.map((id) => [id,
      view({ leaf: `/h/tmp-root/${id}`, deferral: { word: 'in-use', detail: 'pid 7', since: NOW } })])),
    { unmeasured: [{ listing: 'tmproots', kind: 'unmeasured', why: 'a symbolic link' }] });
    const lone = items({}, { unmeasured: [{ listing: 'tmproots', kind: 'unmeasured', why: 'a symbolic link' }] });
    for (const list of [childReclaimAttentionWithLeaves([], [], crowd), childReclaimAttentionWithLeaves([], [], lone)]) {
      expect(list.length).toBeGreaterThan(0);
      expect(words.childReclaimAttentionOf({ childReclaimAttention: list })).toEqual(list);
    }
  });
});
```

Create `server/test/collect-feed-body.test.ts`:

```ts
// Child reclamation wave 9 (spec §5.10): the temp-root collector's feed bodies. A witness-only collect says no leaf
// stood and never that a temp root was removed; shadow says "would collect <id>"; each switch flip says which way it
// went; and every ccd-sourced string reaches a body only through childReclaimDetailText.
import { describe, it, expect } from 'vitest';
import {
  COLLECT_FEED_TITLE, collectFeedAnswerBody, collectFeedCollectedBody, collectFeedCueOfAct, collectFeedCueOfAudit,
  collectFeedStep, collectFeedSwitchBody, collectFeedWouldCollectBody, collectFirstSighting, collectWouldCollectKey,
} from '../src/collectLane.js';
import {
  ACT_NO_DOCUMENT, COLLECTED, DIE, NO_DOCUMENT, T1, UNREADABLE, collectable, failedAct, refusedAct, unmeasured, verdict,
} from './collectAnswers.js';

const NL = String.fromCharCode(10);
const RLO = String.fromCharCode(0x202e);

describe('the collector feed bodies (spec §5.10)', () => {
  it('a witness-only collect says no leaf stood and the witness was dropped, and never that anything was removed', () => {
    const b = collectFeedCollectedBody('demo-a', 41, '/h/tmp-root/demo-a', { kind: 'collected', record: null, resumed: false, witness: 'dropped' });
    expect(b).toBe('demo-a, child of run #41: no leaf stood at /h/tmp-root/demo-a, so nothing was moved; its witness was dropped.');
    for (const witness of ['dropped', 'kept', 'absent'] as const) {
      expect(collectFeedCollectedBody('demo-a', null, null, { kind: 'collected', record: null, resumed: false, witness }), witness)
        .not.toMatch(/remov/);
    }
  });

  it('a collect with a record names the leaf and the record; a resume says it finished an earlier attempt', () => {
    expect(collectFeedCollectedBody('demo-a', 41, '/h/tmp-root/demo-a', { kind: 'collected', record: 'demo-a.17.42', resumed: true, witness: 'kept' }))
      .toBe('demo-a, child of run #41: the temp-root collector removed its temp root /h/tmp-root/demo-a (record '
        + 'demo-a.17.42), finishing a collection an earlier attempt began; its witness was kept: a newer spawn on this '
        + 'id had written it again.');
  });

  it('shadow writes "would collect <id>" and says nothing was removed', () => {
    expect(collectFeedWouldCollectBody('demo-a', 41, '/h/tmp-root/demo-a')).toBe('would collect demo-a, child of run '
      + '#41: its temp root /h/tmp-root/demo-a was found orphaned and idle by two audits at least a pass apart. The '
      + 'collector is shadowed, so nothing was removed.');
  });

  it('each switch flip writes one row naming the lane now live or now shadowed', () => {
    expect(collectFeedSwitchBody(true).startsWith('the collector lane is now live')).toBe(true);
    expect(collectFeedSwitchBody(false).startsWith('the collector lane is now shadowed')).toBe(true);
  });

  it('every ccd-sourced string reaches a body only through childReclaimDetailText: detail, paths, the leaf, a record name and an unknown word', () => {
    const bad = `x${NL}${RLO}y`;
    const bodies = [
      collectFeedAnswerBody('demo-a', null, bad, bad, [bad, bad]),
      collectFeedCollectedBody('demo-a', null, bad, { kind: 'collected', record: bad, resumed: false, witness: 'dropped' }),
      collectFeedCollectedBody('demo-a', null, bad, { kind: 'collected', record: null, resumed: false, witness: 'dropped' }),
      collectFeedWouldCollectBody('demo-a', null, bad),
    ];
    for (const b of bodies) {
      expect(b.includes(NL), b).toBe(false);
      expect(b.includes(RLO), b).toBe(false);
    }
    expect(collectFeedAnswerBody('demo-a', 41, 'in-use', 'pid 7', ['/p/a', '/p/b']))
      .toBe('demo-a, child of run #41: ccd answered in-use: pid 7 (paths: /p/a, /p/b).');
  });

  it('the titles are the lane’s own: distinct, and none is a child reclaim title', () => {
    const titles = Object.values(COLLECT_FEED_TITLE);
    expect(new Set(titles).size).toBe(titles.length);
    for (const t of titles) expect(t.startsWith('child reclaim'), t).toBe(false);
  });
});

describe('the feed cue of each answer (spec §5.10, R88): an observation writes no row; every other answer is a row keyed by its word', () => {
  it('audits', () => {
    expect(collectFeedCueOfAudit(collectable(T1))).toEqual({ kind: 'observe', token: T1 });
    expect(collectFeedCueOfAudit(verdict('in-use'))).toEqual({ kind: 'row', key: 'in-use' });
    expect(collectFeedCueOfAudit(unmeasured('mv'))).toEqual({ kind: 'row', key: 'unmeasured mv' });
    expect(collectFeedCueOfAudit(NO_DOCUMENT)).toEqual({ kind: 'row', key: 'no-document' });
    expect(collectFeedCueOfAudit(UNREADABLE)).toEqual({ kind: 'row', key: 'unreadable' });
  });

  it('acts', () => {
    expect(collectFeedCueOfAct(COLLECTED)).toEqual({ kind: 'row', key: 'collected' });
    expect(collectFeedCueOfAct(refusedAct('in-use'))).toEqual({ kind: 'row', key: 'refused in-use' });
    expect(collectFeedCueOfAct(failedAct('probe-unmeasured'))).toEqual({ kind: 'row', key: 'failed probe-unmeasured' });
    expect(collectFeedCueOfAct(DIE)).toEqual({ kind: 'row', key: 'die lock-unopenable' });
    expect(collectFeedCueOfAct(ACT_NO_DOCUMENT)).toEqual({ kind: 'row', key: 'act no-document' });
  });

  it('through Task 4’s episode memory: a repeat is quiet, and a would-collect episode survives an observation of its own token', () => {
    const first = collectFeedStep(collectFirstSighting(1), collectFeedCueOfAudit(verdict('in-use')));
    expect(first.opened).toBe('in-use');
    expect(collectFeedStep(first.entry, collectFeedCueOfAudit(verdict('in-use'))).opened).toBeNull();
    const w = collectFeedStep(collectFirstSighting(1), { kind: 'row', key: collectWouldCollectKey(T1) }).entry;
    expect(collectFeedStep(w, collectFeedCueOfAudit(collectable(T1))).entry.feedEpisode).toBe(collectWouldCollectKey(T1));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-attention.test.ts test/collect-feed-body.test.ts \
  test/child-reclaim-detail-unsafe-classes.test.ts test/child-reclaim-leaf-kept-prose.test.ts \
  test/child-reclaim-leaf-kept.test.ts test/child-reclaim-detail-text.test.ts
```

Expected: FAIL. None of these was measured at planning, so record the measured counts.
- `collect-attention`: every case fails on an export this task adds. For example, `TypeError: (0 , __vi_import_…__.collectAttentionItems) is not a function`, or `…childReclaimClipsSecond) is not a function`. The label case fails on `expected [ … ] to deeply equal [ 'box-probe', 'flock', … ]` if Task 1's keys differ.
- `collect-feed-body`: every case fails with `… is not a function` (the bodies and the two cue functions), or with `Cannot convert undefined or null to object` for `COLLECT_FEED_TITLE`.
- `child-reclaim-detail-unsafe-classes`: the new Cf rows (LRM, RLM, ALM, ZWSP, ZWJ, the byte-order mark, the soft hyphen, U+180E, U+2060, U+2064, U+206A, U+206F, U+FFF9, U+FFFB and the tag letter), both Cs rows, U+034F and the three tag-range rows fail with `expected 'left…right' to be 'left right'`. The rows wave 8 already covers (ESC, US, DEL, APC, RLO, PDI, U+2028, U+2029) and the CONTROL and `LC_LINE_MAX` cases pass.
- `child-reclaim-leaf-kept-prose`: every case fails but the `runId` case, which is GREEN at entry: Task 1 rewrote those three lines, and this file only pins them. The sentences red on `expected '…stays on disk and ccrc deletes nothing more of it…' to be '…'`, and the source scan reds on `not.toContain`. The yield case reds on `expected [ [ 'demo-k', undefined ], … ]`.
- `child-reclaim-leaf-kept`: the sentence cases red on the new constants. The two yield cases ("lists a done row that kept the temp root…" and "lists a line cut to fit, with no run and its own sentence") red on the `clipsClause` each now expects: `expected [ { item: …, …(2) } ] to deeply equal [ { item: …, …(3) } ]`. The three merge cases red on `CHILD_RECLAIM_COLLECT_NONE` being undefined: `TypeError: Cannot read properties of undefined (reading 'perId')`, or an older merge's output.
- `child-reclaim-detail-text`: green. Its CONTROL row now names U+2070, which is safe before and after.

- [ ] **Step 3: L0, `shared/api.ts` — NO edit (H3).** Task 1 declared `ChildReclaimCollectMany` in its ONE union-line rewrite (`collect-many-arm-declared`), rewrote the doc pair (`attention-doc-pair-counts-the-collector`) and the `runId` sentence (`attention-runid-sentence-misses-leaf-arms`), and its `COLLECT_BOX_LABELS` table stands with Task 1's label strings. Step 0 (a) to (d) and (j) measured all of it. This task's sentences read the labels through `COLLECT_BOX_LABELS[<key>]`, never a copy of a label string, and Step 10 proves `shared/api.ts` untouched.

- [ ] **Step 4: L1, `server/src/childReclaimSweep.ts`.**

(a) Extend the `../../shared/api.js` import (`grep -n "CHILD_RECLAIM_KEPT_WORDS, SPAWN_STALL_MS, TERMINAL_RUN_STATES" server/src/childReclaimSweep.ts`) with `COLLECT_BOX_LABELS, type ChildReclaimCollectAttention, type ChildReclaimCollectMany`.

(b) `const childReclaimStuckEnd = (t: string): string =>` becomes `export const childReclaimStuckEnd = (t: string): string =>`. Nothing else in it changes.

(c) Replace `detailUnsafe`, its doc comment included (`grep -n "^const detailUnsafe" server/src/childReclaimSweep.ts`), with:

```ts
/** What a ccd-sourced string may not carry onto a banner, a chip or a feed row (spec §5.9, §5.10): every code point of
 *  general category Cc (the C0 and C1 controls, DEL, a newline among them), Cf (format characters: the bidi marks,
 *  embeddings, overrides and isolates, the zero-width characters, the byte-order mark, the soft hyphen, the invisible
 *  operators, the deprecated format characters and the interlinear annotation characters), Zl and Zp (the line and
 *  paragraph separators) and Cs (a lone surrogate); plus U+034F, the combining grapheme joiner (category Mn), and the
 *  whole tag block U+E0000 to U+E007F by range, because its unassigned points are Cn. Named by property and by code
 *  point, so no escape sits here for a file write to decode. */
const DETAIL_UNSAFE_CATEGORY = /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]$/u;
const detailUnsafe = (c: number): boolean =>
  DETAIL_UNSAFE_CATEGORY.test(String.fromCodePoint(c)) || c === 0x034f || (c >= 0xe0000 && c <= 0xe007f);
```

In `childReclaimDetailText`'s doc comment, the words "control and bidi characters" stay true. Leave it as it is.

(d) In the kept-leaf block, directly after `const LEAF_HORIZON = …;`, add:

```ts
/** What a kept clips directory's half tells a person (spec §5.9): ccrc never removes one. */
const LEAF_CLIPS_STAYS = 'ccrc never removes the clips directory; a person removes it once nothing still uses it.';
/** What a kept temp root's half tells a person (spec §5.9, §5.10). True whether the temp-root collector is shadowed,
 *  armed, paused, or on a fleet box whose ccd cannot collect. */
const LEAF_TMP_COLLECTOR = 'ccrc’s temp-root collector removes the temp root once it has stood idle, but only while '
  + 'the collector is switched on, the fleet box’s ccd can collect and cleanup is not paused, and only if ccrc recorded '
  + 'handing that directory out; until then, or if the collector lists it for you, a person removes it once nothing '
  + 'still uses it. The temp root leaves this line once it is collected.';
/** The clips half's own clause: the sentence below quotes it, and so does a winning item's second clause. */
const leafClipsPart = (sessionId: string, word: LeafKeptWord): string =>
  `its clips directory ~/.cc-clips/${sessionId} (${word}: ${LEAF_PHRASE[word]})`;
```

In `childReclaimLeafKeptSentence`, replace everything from `const parts = [` to the function's closing `}` with:

```ts
  const parts = [
    ...(clips.kind === 'kept' ? [leafClipsPart(sessionId, clips.word)] : []),
    ...(tmpWord === null ? [] : [`its temp root ~/.cc-tmp/${sessionId} (${tmpWord}: ${LEAF_PHRASE[tmpWord]})`]),
  ];
  return `The reclaim of this child completed, but ccd kept ${parts.join(' and ')}. What was kept stays on disk.`
    + (clips.kind === 'kept' ? ` ${LEAF_CLIPS_STAYS}` : '')
    + (tmpWord === null ? '' : ` ${LEAF_TMP_COLLECTOR}`) + ` ${LEAF_HORIZON}`;
}
```

(e) In `interface ChildReclaimLeafKept`, add after `readonly detail: string | null;`:

```ts
  /** The clips half's clause, which a winning item carries as its second clause (spec §5.10): the kept clips part,
   *  the unknown clause for a line cut to fit, or null when clips was `none-or-unreported`. */
  readonly clipsClause: string | null;
```

In `childReclaimLeafKept`, replace the `out.push({ … source: r.id, detail: r.detail, });` statement with:

```ts
    const clipsClause = clips.kind === 'kept' ? leafClipsPart(r.sessionId, clips.word)
      : clips.kind === 'truncated' ? `whether its clips directory ~/.cc-clips/${r.sessionId} was kept is not known` : null;
    out.push({
      item: { kind: 'leaf-kept', sessionId: r.sessionId, runId: leafRunOf(r.meas?.childOf ?? null),
        sentence: childReclaimLeafKeptSentence(r.sessionId, clips, tmp, r.detail), at: r.at },
      source: r.id, detail: r.detail, clipsClause,
    });
```

(f) In `childReclaimLeafKeptManySentence`, the line `+ 'Each stays until a person removes it, and the feed row of each names what was kept and why. '` becomes:

```ts
    + 'Each clips directory stays until a person removes it; each temp root stays until ccrc’s temp-root collector '
    + 'removes it, while the collector is switched on and cleanup is not paused, or until a person does. '
    + 'The feed row of each names what was kept and why. '
```

(g) Replace `childReclaimAttentionWithLeaves`, its doc comment included, with:

```ts
/** What the merge takes from the temp-root collector (spec §5.10). It has three parts:
 *  - its per-id items, ONE per id and NOT yet collapsed, because only the merge knows which of them carry a second
 *    clause;
 *  - for each word a per-id item uses, the clause a collapsed line says of every member;
 *  - its box-wide lines, each a single `collect` item under a fixed label (`COLLECT_BOX_LABELS`) that no session id
 *    can equal.
 *  Declared HERE, by its consumer, in L0 terms: `collectLane.ts` builds it and imports this file, never the reverse. */
export interface ChildReclaimCollectInput {
  readonly perId: readonly ChildReclaimCollectAttention[];
  readonly manyLead: Readonly<Record<string, string>>;
  readonly box: readonly ChildReclaimCollectAttention[];
}

/** No collector input: the merge is wave 8's. */
export const CHILD_RECLAIM_COLLECT_NONE: ChildReclaimCollectInput = { perId: [], manyLead: {}, box: [] };

/** A collapsed collector line's word is `collect:<word>`: no kept word, and never `'leaf-kept'` (spec §5.10). */
export const CHILD_RECLAIM_COLLECT_MANY_PREFIX = 'collect:';

/** The collector word whose sentence a reclaim item carries (spec §5.10): a kept quarantine record is never silent. */
const COLLECT_RECORD_KEPT: LcRefusalToken = 'quarantine-kept';

/** Ids named in one line (spec §5.9, §5.10): at most `CHILD_RECLAIM_KEPT_MANY_OVER`, in order, then how many more. */
export function childReclaimIdsNamed(ids: readonly string[]): string {
  const shown = ids.slice(0, CHILD_RECLAIM_KEPT_MANY_OVER).join(', ');
  const more = ids.length - CHILD_RECLAIM_KEPT_MANY_OVER;
  return more > 0 ? `${shown}, and ${more} more` : shown;
}

/** The second clause a winner carries for a leaf's clips directory (spec §5.9, §5.10). The clips leaf is never the
 *  collector's, and a reclaim item is about the row that stands now, so neither would otherwise say it. The clause is
 *  the leaf's own, verbatim, in one sentence true of both shapes (kept, or not known on a cut line). */
export const childReclaimClipsSecond = (clipsClause: string): string =>
  `Also, an earlier reclaim of this id may have left a clips directory on disk: ${clipsClause}. ${LEAF_CLIPS_STAYS}`;

/** The sentence of a collapsed collector line (spec §5.10): the count, then what each member's word says. */
export const childReclaimCollectManySentence = (n: number, lead: string): string =>
  `${n} temp roots are listed for the same reason. For each one: ${lead}`;

/** A sentence with each second clause it does not already give, in order. */
const withSecond = (sentence: string, clauses: readonly string[]): string =>
  clauses.reduce((s, c) => (s.includes(c) ? s : `${s} ${c}`), sentence);

/** The whole list (spec §5.9, §5.10): ONE item per id across every arm.
 *  - A reclaim item (about the row that stands) wins. It carries a collector `quarantine-kept` item's sentence and a
 *    leaf's clips clause. A reclaim `kept-many` member that would carry one leaves the line as a single `kept` item,
 *    and the rest list as the kept arm lists them.
 *  - A collector item wins over a leaf item, and carries the leaf's clips clause.
 *  - An item that carries a second clause never collapses. The rest of the collector's items collapse by word: more
 *    than `CHILD_RECLAIM_KEPT_MANY_OVER` with a run into a `collect:<word>` line; more than that with no run into ONE
 *    box-wide count line naming at most that many ids.
 *  - The collector's box lines take no id.
 *  - The leaf items left list as `childReclaimLeafKeptList` lists them.
 *  The order is reclaim, the collector's per-id items, its collapsed lines, its count line, its box lines, then the
 *  kept leaves. Pure and deterministic, so the coord frame's byte-equality guard emits once per change. */
export function childReclaimAttentionWithLeaves(
  list: readonly ChildReclaimAttention[], leaves: readonly ChildReclaimLeafKept[], collect: ChildReclaimCollectInput,
): ChildReclaimAttention[] {
  const clips = new Map<string, string>();
  for (const l of leaves) if (l.clipsClause !== null) clips.set(l.item.sessionId, childReclaimClipsSecond(l.clipsClause));
  const records = new Map<string, string>();
  for (const c of collect.perId) if (c.word === COLLECT_RECORD_KEPT) records.set(c.sessionId, c.sentence);
  const reclaimSecond = (id: string): string[] =>
    [records.get(id), clips.get(id)].filter((s): s is string => s !== undefined);
  const taken = new Set<string>();
  const reclaim: ChildReclaimAttention[] = [];
  for (const a of list) {
    if (a.kind !== 'kept-many') {
      taken.add(a.sessionId);
      reclaim.push({ ...a, sentence: withSecond(a.sentence, reclaimSecond(a.sessionId)) });
      continue;
    }
    for (const m of a.members) taken.add(m.sessionId);
    const word = a.word;
    if (!isChildReclaimKeptWord(word) || !a.members.some((m) => reclaimSecond(m.sessionId).length > 0)) {
      reclaim.push(a);
      continue;
    }
    const kept: ChildReclaimKeptAttention[] = a.members.map((m) => ({ kind: 'kept', sessionId: m.sessionId,
      runId: m.runId, word, sentence: CHILD_RECLAIM_SKIP[word].sentence }));
    reclaim.push(
      ...kept.filter((k) => reclaimSecond(k.sessionId).length > 0)
        .map((k) => ({ ...k, sentence: withSecond(k.sentence, reclaimSecond(k.sessionId)) })),
      ...childReclaimKeptList(kept.filter((k) => reclaimSecond(k.sessionId).length === 0)));
  }
  const singles: ChildReclaimCollectAttention[] = [];
  const loose: ChildReclaimCollectAttention[] = [];
  for (const c of [...collect.perId].sort(childReclaimBySession)) {
    if (taken.has(c.sessionId)) continue;
    taken.add(c.sessionId);
    const second = clips.get(c.sessionId);
    if (second !== undefined) singles.push({ ...c, sentence: withSecond(c.sentence, [second]) });
    else loose.push(c);
  }
  const groups: ChildReclaimCollectMany[] = [];
  const counted: string[] = [];
  for (const word of [...new Set(loose.map((c) => c.word))].sort()) {
    const these = loose.filter((c) => c.word === word);
    const lead = Object.hasOwn(collect.manyLead, word) ? collect.manyLead[word] : undefined;
    const members = these.flatMap((c) => (c.runId === null ? [] : [{ sessionId: c.sessionId, runId: c.runId }]));
    const runless = these.filter((c) => c.runId === null);
    if (lead !== undefined && members.length > CHILD_RECLAIM_KEPT_MANY_OVER) {
      const many: ChildReclaimCollectMany['word'] = `${CHILD_RECLAIM_COLLECT_MANY_PREFIX}${word}`;
      groups.push({ kind: 'kept-many', word: many, members, sentence: childReclaimCollectManySentence(members.length, lead) });
    } else {
      singles.push(...these.filter((c) => c.runId !== null));
    }
    if (lead !== undefined && runless.length > CHILD_RECLAIM_KEPT_MANY_OVER) {
      counted.push(`${runless.length} answer ${word}: ${childReclaimIdsNamed(runless.map((c) => c.sessionId))}. `
        + `For each one: ${lead}`);
    } else {
      singles.push(...runless);
    }
  }
  const countLine: ChildReclaimCollectAttention[] = counted.length === 0 ? [] : [{ kind: 'collect',
    sessionId: COLLECT_BOX_LABELS['no-run'], runId: null, word: 'no-run',
    sentence: `Temp roots with no recorded run are listed together. ${counted.join(' ')}` }];
  const leftLeaves = leaves.map((l) => l.item).filter((l) => !taken.has(l.sessionId));
  return [
    ...reclaim, ...[...singles].sort(childReclaimBySession), ...groups, ...countLine, ...collect.box,
    ...childReclaimLeafKeptList(leftLeaves),
  ];
}
```

`CHILD_RECLAIM_SKIP`, `childReclaimKeptList`, `ChildReclaimKeptAttention`, `childReclaimBySession` and `isChildReclaimKeptWord` are already in this file or its import. `'no-run'` is a `CollectBoxLine`, typed by `ChildReclaimCollectAttention['word']` as a string, and spelled beside its label's key.

- [ ] **Step 5: L1, `server/src/collectLane.ts`.** Append at the end of the file. Merge its names into the file's TWO import statements (H2), adding no third statement and no other specifier:
- into the ONE `../../shared/api.js` statement: `COLLECT_BOX_LABELS, COLLECT_BOX_LINES, TMPROOT_ID_MAX_CHARS, isTmpRootId, lcRefusalWord, type ChildReclaimCollectAttention, type CollectBoxLine, type LcRefusalToken`, adding each that is not there yet;
- into Task 4's ONE `./childReclaimSweep.js` statement (`collector-l1-imports-the-formula-file`, H2): `childReclaimDetailText, childReclaimIdsNamed, childReclaimStuckEnd, type ChildReclaimCollectInput`, adding each that is not there yet (`CHILD_RECLAIM_DEFER_CEILING_MS` and `ChildReclaimTierState` are there already).

Everything else the block reads is declared earlier in this same file, under its H3 name: Task 2's `CollectAudit`, `CollectResult`, `CollectProbeClass`, `COLLECT_PROBE_CLASS`, `collectProbeClass` and `CollectDieWord`; Task 3's `COLLECT_POPULATION_MAX` and `CollectListingDoubt`; Task 4's `CollectEntry`, `CollectRun`, `CollectRunToken`, `collectRunTier`, `CollectHoldWhy`, `COLLECT_CHANGED_RECENTLY_SPAN_MS`, `collectAttentionCauses`, `collectWouldCollectStands` and `CollectFeedCue`. This task declares none of them.

Append:

```ts
// ── Attention and the feed (spec §5.10, §5.9) ───────────────────────────────────────────────────────────────────
//
// A REPORT, gating nothing: no audit, act, slot, pair or pace reads anything below. Every ccd-sourced string (a
// detail, a path, `collect.leaf`, a record name, an unknown word) reaches a sentence or a body only through
// `childReclaimDetailText`. No sentence builds a temp-root path: the leaf is the audit document's own.

/** The words a collector item uses for itself (spec §5.10). A TERMINAL item's word is ccd's own instead. */
export type CollectItemWord =
  | 'in-use' | 'registered' | 'in-progress' | 'presence' | 'held' | 'die' | 'per-leaf' | 'failing' | 'verb-failed'
  | 'changed-recently' | 'would-collect';

/** One paced run as attention reads it (spec §5.10): its tier state (wave 8's derivation), and the word and detail
 *  of the answer that last advanced it, both ccd's and untrusted. */
export interface CollectRunView {
  readonly tier: ChildReclaimTierState;
  readonly word: string | null;
  readonly detail: string | null;
}

/** What attention reads of one id's lane memory (spec §5.10), PROJECTED from Task 4's `CollectEntry` by
 *  `collectAttentionViewOf` (H3). Each clock field is non-null only while Task 4's `collectAttentionCauses` says that
 *  cause stands. All instants are on the monotonic clock. */
export interface CollectAttentionView {
  /** The latest document's `collect.witness.run`, or null. */
  readonly witnessRun: number | null;
  /** The latest document's `collect.leaf`, ccd's spelling, or null. */
  readonly leaf: string | null;
  readonly failing: CollectRunView;
  readonly verbFailed: CollectRunView;
  readonly terminal: CollectRunView;
  /** A STANDING deferral (`in-use`, `registered`, `in-progress`): its word, ccd's latest detail, and since when that
   *  word has answered with no break. Null when none stands. */
  readonly deferral: { readonly word: string; readonly detail: string; readonly since: number } | null;
  readonly presenceSince: number | null;
  readonly hold: { readonly why: CollectHoldWhy; readonly since: number } | null;
  readonly changedRecentlySince: number | null;
  /** A recognised arm-1 die other than `flock-unavailable`, recurring for the ceiling (H1), or null. */
  readonly die: { readonly word: CollectDieWord; readonly since: number } | null;
  /** A shadow would-collect episode stands (Task 4's `collectWouldCollectStands`). No token is carried: the shipped
   *  tree's one `as CollectToken` stays the audit reader's. */
  readonly wouldCollect: boolean;
}

/** One run as attention reads it: Task 4's tier derivation, and the run's latest word and detail. */
const collectRunView = (r: CollectRun, token: CollectRunToken): CollectRunView => ({
  tier: collectRunTier(r, token), word: r.kind === 'run' ? r.word : null, detail: r.kind === 'run' ? r.detail : null,
});

/** THE PROJECTION (H3): Task 4's entry as attention reads it. It decides NO threshold. Every clock field is copied from
 *  the cause Task 4's `collectAttentionCauses` says stands (first answer to latest, inclusive), and is null otherwise;
 *  the runs are projected whole; the evidence is the latest document's. */
export function collectAttentionViewOf(e: CollectEntry): CollectAttentionView {
  let deferral: CollectAttentionView['deferral'] = null;
  let presenceSince: number | null = null;
  let hold: CollectAttentionView['hold'] = null;
  let changedRecentlySince: number | null = null;
  let die: CollectAttentionView['die'] = null;
  for (const c of collectAttentionCauses(e)) {
    if (c.kind === 'held') hold = { why: c.why, since: c.sinceMono };
    else if (c.kind === 'presence') presenceSince = c.sinceMono;
    else if (c.kind === 'die') die = { word: c.word, since: c.sinceMono };
    else if (!('sinceMono' in c)) continue;   // the three runs, projected whole below
    else if (c.kind === COLLECT_CHANGED_RECENTLY) changedRecentlySince = c.sinceMono;
    else deferral = { word: c.kind, detail: c.detail, since: c.sinceMono };
  }
  return {
    witnessRun: e.evidence.runId, leaf: e.evidence.leaf,
    failing: collectRunView(e.failing, 'failing'), verbFailed: collectRunView(e.verbFailed, 'verb-failed'),
    terminal: collectRunView(e.terminal, 'terminal'),
    deferral, presenceSince, hold, changedRecentlySince, die, wouldCollect: collectWouldCollectStands(e),
  };
}

/** How one pass's audit counts for the two pass-scoped box lines (spec §5.10). */
export type CollectPassClass = 'no-document' | 'lock' | 'other';

/** Which collector work is unsettled past its bound (spec §5.10, H1, R85): `'audit'`, a learning audit past twice the
 *  90 s row, or an executor job's own audit past it and short of `CHILD_RECLAIM_STALL_MS`; or an executor JOB that took the act
 *  slot and has not settled in `CHILD_RECLAIM_STALL_MS`, whether or not it composed a call: `'act'` when its
 *  `ws-collect` is out, `'job'` otherwise. The job's bound is checked first, and the box line says the act slot is
 *  held for `'act'` and `'job'` alike. Each bound counts from the enqueue (`unsettled-bound-counts-from-the-queue`). */
export type CollectUnsettledKind = 'audit' | 'act' | 'job';

/** What the box-wide lines read (spec §5.10): the population's doubted listings (Task 3's `CollectListingDoubt`, the
 *  count the RAW listing's) and its refused-name count, the box-wide probes standing, this pass's audits by id, the
 *  flock latch, and the collector work unsettled past its bound. */
export interface CollectBoxFacts {
  readonly unmeasured: readonly CollectListingDoubt[];
  readonly refusedNames: number;
  readonly boxProbes: ReadonlyMap<string, string>;
  readonly passAudits: ReadonlyMap<string, CollectPassClass>;
  readonly flockLatched: boolean;
  readonly unsettled: ReadonlyMap<string, CollectUnsettledKind>;
}

const COLLECT_LOCK_PROBE = 'lock' satisfies keyof typeof COLLECT_PROBE_CLASS;
const COLLECT_RECORDS_PROBE = 'records' satisfies keyof typeof COLLECT_PROBE_CLASS;
const COLLECT_CHANGED_RECENTLY: LcRefusalToken = 'changed-recently';
const COLLECT_NO_DOCUMENT: Extract<CollectAudit['kind'], 'no-document'> = 'no-document';
const COLLECT_IN_USE = 'in-use';
const COLLECT_IN_PROGRESS = 'in-progress';
const COLLECT_REGISTERED: LcRefusalToken = 'registered';

/** One audit's class for the pass-scoped lines. */
export function collectPassClass(a: CollectAudit): CollectPassClass {
  if (a.kind === COLLECT_NO_DOCUMENT) return 'no-document';
  return a.kind === 'unmeasured' && a.probe === COLLECT_LOCK_PROBE ? 'lock' : 'other';
}

/** The box-wide probes standing after one answer (spec §5.10): a box-wide `unmeasured` sets its probe's latest
 *  detail; an answer that passed every rung (`collectable`, `changed-recently`, `collected`) clears them all; any
 *  other answer leaves them standing. */
export function collectBoxProbesAfter(prev: ReadonlyMap<string, string>, a: CollectAudit | CollectResult): ReadonlyMap<string, string> {
  if (a.kind === 'unmeasured') {
    return collectProbeClass(a.probe) === 'box-wide' ? new Map([...prev, [a.probe, a.detail]]) : prev;
  }
  const passed = a.kind === 'collectable' || a.kind === 'collected'
    || (a.kind === 'verdict' && a.verdict === COLLECT_CHANGED_RECENTLY);
  return passed ? new Map() : prev;
}

const CEILING_MIN = CHILD_RECLAIM_DEFER_CEILING_MS / 60_000;
const CHANGING_HOURS = COLLECT_CHANGED_RECENTLY_SPAN_MS / 3_600_000;
const COLLECT_ASKS_LONG = 'ccrc asks again on a long, capped schedule.';

const collectTmp = (leaf: string | null): string => {
  const t = leaf === null ? '' : childReclaimDetailText(leaf);
  return t === '' ? 'its temp root' : `its temp root ${t}`;
};
const collectCap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const collectSaid = (detail: string | null): string => {
  const t = detail === null ? '' : childReclaimDetailText(detail);
  return t === '' ? '' : ` What ccd said: ${childReclaimStuckEnd(t)}`;
};
const collectProbeText = (word: string | null): string =>
  (word === null ? 'no word' : word === COLLECT_NO_DOCUMENT ? 'ccd answered nothing' : childReclaimDetailText(word));

/** Why a hold stands, in a person's words (spec §5.10). Total over `CollectHoldWhy`. */
const COLLECT_HOLD_WHY: Readonly<Record<CollectHoldWhy, string>> = {
  'run-open': 'the run that minted it is not closed',
  'run-absent': 'the run that minted it is not in the coordination database',
  'run-after-witness': 'the run its witness names opened after ccrc handed the directory out, so it is not the minting run',
  'id-in-open-run': 'an open run names this id',
  'no-witness-run': 'ccd’s audit named no run for it',
  'store-unreadable': 'the coordination database could not be read',
};
/** The holds the coordination database cannot vouch for: one box-wide line, never per id (spec §5.10). */
const COLLECT_HOLD_UNVOUCHED: readonly CollectHoldWhy[] = ['run-absent', 'run-after-witness'];

/** What a collapsed line says of each member, by word (spec §5.10). Total over `CollectItemWord`. */
const COLLECT_ITEM_MANY: Readonly<Record<CollectItemWord, string>> = {
  'in-use': 'a process still uses its temp root, so the temp-root collector leaves it alone; the feed row of each names the process ccd found.',
  registered: 'a registry row of its id, or what one left behind, still stands, so the temp-root collector leaves its temp root alone.',
  'in-progress': 'another ccd process has held its reap lock for a long time, so the temp-root collector leaves its temp root alone.',
  presence: 'its id has been open on a screen for a long time, so the temp-root collector leaves its temp root alone.',
  held: 'the temp-root collector holds its temp root because of what the coordination database says of its run; each is asked again once its hold lifts.',
  die: `ccd refused to start the temp-root collector’s verb for it before its lock, each time, for at least ${CEILING_MIN} minutes; nothing was removed.`,
  'per-leaf': 'ccd cannot collect its temp root as it stands, and this does not heal by itself; the feed row of each names what ccd found.',
  failing: 'the temp-root collector has not been able to measure its temp root for some time; nothing was removed, and ccrc keeps asking.',
  'verb-failed': 'the temp-root collector’s attempts to collect its temp root keep failing; ccd kept what still stands each time.',
  'changed-recently': 'something under its temp root has kept changing for more than a day, though no process of this user uses it.',
  'would-collect': 'while the collector was shadowed, the temp-root collector found its temp root orphaned and idle and removed nothing.',
};
const COLLECT_TERMINAL_MANY = 'ccd’s last answer for its temp root was terminal; each is listed for you to look at, and '
  + 'the feed row of each names ccd’s word and what it found.';

interface CollectItemText { readonly word: string; readonly sentence: string; readonly many: string }

/** One id's item (spec §5.10), in this precedence: terminal, verb-failed, a recurring pre-lock die, failing (a
 *  per-leaf word or the tier; `records` subsumed while `tmpquarantine` is unmeasured), in-use, a hold (an unvouched
 *  one joins one box line instead), in-progress, registered, presence, changed-recently, then shadow's would-collect.
 *  WHETHER each stands is the view's: Task 4's causes decided it, first answer to latest and inclusive, and this
 *  function decides no threshold. */
function collectItemOf(id: string, v: CollectAttentionView, recordsSubsumed: boolean): CollectItemText | 'unvouched' | null {
  const tmp = collectTmp(v.leaf);
  if (v.terminal.tier.tier && v.terminal.word !== null) {
    // H8: true in every state. It says what ccd answered at the run's LAST terminal answer, never that the id is
    // refused now: in shadow, ccd may answer `collectable` again while the terminal run stands.
    const w = childReclaimDetailText(v.terminal.word);
    const lead = lcRefusalWord(v.terminal.word);
    const said = lead === null
      ? ', which means the temp-root collector found something it could not prove safe; nothing was removed, and it '
        + 'is listed for you to look at.'
      : `, which said: “${lead}”`;
    return { word: v.terminal.word, many: COLLECT_TERMINAL_MANY,
      sentence: `${collectCap(tmp)}: ccd’s last terminal answer for it was ${w}${said}${collectSaid(v.terminal.detail)} `
        + COLLECT_ASKS_LONG };
  }
  if (v.verbFailed.tier.tier) {
    return { word: 'verb-failed', many: COLLECT_ITEM_MANY['verb-failed'],
      sentence: `The temp-root collector’s attempts to collect ${tmp} keep failing (${collectProbeText(v.verbFailed.word)}).`
        + `${collectSaid(v.verbFailed.detail)} ccd kept what still stands each time; ${COLLECT_ASKS_LONG}` };
  }
  if (v.die !== null) {
    return { word: 'die', many: COLLECT_ITEM_MANY.die,
      sentence: `ccd refused to start the temp-root collector’s verb for this id before its lock `
        + `(${childReclaimDetailText(v.die.word)}) each time for at least ${CEILING_MIN} minutes; nothing was removed `
        + `from ${tmp}. ccrc asks again later, no sooner than the ceiling after each refusal.` };
  }
  if (v.failing.tier.tier && !(recordsSubsumed && v.failing.word === COLLECT_RECORDS_PROBE)) {
    const probe = collectProbeText(v.failing.word);
    const said = collectSaid(v.failing.detail);
    if (v.failing.word !== null && collectProbeClass(v.failing.word) === 'per-leaf') {
      return { word: 'per-leaf', many: COLLECT_ITEM_MANY['per-leaf'],
        sentence: `ccd cannot collect ${tmp} as it stands (${probe}).${said} This does not heal by itself: `
          + 'ccrc asks again on a long, capped schedule, and a person decides what to do with it.' };
    }
    return { word: 'failing', many: COLLECT_ITEM_MANY.failing,
      sentence: `The temp-root collector has not been able to measure ${tmp} for some time (${probe}).${said} `
        + 'Nothing was removed; ccrc keeps asking, backing off in between.' };
  }
  const d = v.deferral;
  if (d !== null && d.word === COLLECT_IN_USE) {
    return { word: 'in-use', many: COLLECT_ITEM_MANY['in-use'],
      sentence: `A process still uses ${tmp}, so the temp-root collector leaves it alone.${collectSaid(d.detail)} `
        + 'ccrc never stops a process; it asks again later, and this line ends once nothing uses it.' };
  }
  if (v.hold !== null) {
    if (COLLECT_HOLD_UNVOUCHED.includes(v.hold.why)) return 'unvouched';
    return { word: 'held', many: COLLECT_ITEM_MANY.held,
      sentence: `The temp-root collector has held ${tmp} for at least ${CEILING_MIN} minutes: `
        + `${COLLECT_HOLD_WHY[v.hold.why]}. It is never collected while the hold stands, and is asked again once it lifts.` };
  }
  if (d !== null && d.word === COLLECT_IN_PROGRESS) {
    return { word: 'in-progress', many: COLLECT_ITEM_MANY['in-progress'],
      sentence: `Another ccd process has held this id’s reap lock, ~/.cc-sessions/.reap-${id}.lock, for at least `
        + `${CEILING_MIN} minutes, so the temp-root collector leaves ${tmp} alone.${collectSaid(d.detail)} A reap, `
        + 'reclaim, expiry, restore or collection of it may still be running, or a killed one left a process holding '
        + 'the lock; ccrc asks again later.' };
  }
  if (d !== null && d.word === COLLECT_REGISTERED) {
    return { word: 'registered', many: COLLECT_ITEM_MANY.registered,
      sentence: `A registry row of this id, or what one left behind, has stood for at least ${CEILING_MIN} minutes, so `
        + `the temp-root collector treats ${tmp} as that workspace’s and leaves it alone. ccrc asks again later; this `
        + 'line ends once the id is free.' };
  }
  if (v.presenceSince !== null) {
    return { word: 'presence', many: COLLECT_ITEM_MANY.presence,
      sentence: `This id has been open on a screen for at least ${CEILING_MIN} minutes, so the temp-root collector `
        + `leaves ${tmp} alone. It never collects a temp root while its id is open, and asks again once it is not.` };
  }
  if (v.changedRecentlySince !== null) {
    return { word: 'changed-recently', many: COLLECT_ITEM_MANY['changed-recently'],
      sentence: `Something under ${tmp} has kept changing for at least ${CHANGING_HOURS} hours, though no process of `
        + 'this user is using it. The temp-root collector leaves it alone while it changes; a person decides what '
        + 'keeps changing it.' };
  }
  if (v.wouldCollect) {
    return { word: 'would-collect', many: COLLECT_ITEM_MANY['would-collect'],
      sentence: `While the collector was shadowed, two audits at least a pass apart found ${tmp} orphaned and idle, so it `
        + 'recorded that it would collect it and removed nothing. This line ends once ccd answers anything else for it.' };
  }
  return null;
}

/** The box-wide lines (spec §5.10): each a single item under its fixed label, in the label table's order. */
function collectBoxItems(b: CollectBoxFacts, unvouched: readonly string[]): ChildReclaimCollectAttention[] {
  const out: ChildReclaimCollectAttention[] = [];
  const line = (word: CollectBoxLine, sentence: string): void => {
    out.push({ kind: 'collect', sessionId: COLLECT_BOX_LABELS[word], runId: null, word, sentence });
  };
  // Task 3's doubts, in the label table's order; an over-cap count is the RAW listing's
  // (`population-cap-counts-the-raw-listing`).
  const doubts = [...b.unmeasured].sort((p, q) => COLLECT_BOX_LINES.indexOf(p.listing) - COLLECT_BOX_LINES.indexOf(q.listing));
  for (const l of doubts) {
    const also = l.listing === 'tmpquarantine' ? '; a quarantine record it cannot see is not listed' : '';
    if (l.kind === 'over-cap') {
      line(l.listing, `${COLLECT_BOX_LABELS[l.listing]} holds ${l.count} names, more than the ${COLLECT_POPULATION_MAX} `
        + `the temp-root collector reads, so it audits none of them${also}.`);
    } else {
      line(l.listing, `The temp-root collector could not list ${COLLECT_BOX_LABELS[l.listing]} `
        + `(${childReclaimDetailText(l.why)}), so it audits only the ids the other listing names, and never reads an `
        + `absence from this one${also}.`);
    }
  }
  if (b.refusedNames > 0) {
    line('refused-names', `${b.refusedNames} names under ${COLLECT_BOX_LABELS.tmproots} or `
      + `${COLLECT_BOX_LABELS.tmpquarantine} are not temp-root ids ccrc acts on (for example a name that begins with a `
      + `dash, is longer than ${TMPROOT_ID_MAX_CHARS} characters, is not a session id’s shape, or is no quarantine `
      + 'record of one), so the collector never audits them. A person looks at them by hand.');
  }
  if (b.boxProbes.size > 0) {
    const what = [...b.boxProbes].sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0)).map(([p, d]) => {
      const t = childReclaimDetailText(d);
      return t === '' ? childReclaimDetailText(p) : `${childReclaimDetailText(p)} (${t})`;
    }).join('; ');
    line('box-probe', `ccd on the fleet box cannot collect any temp root as things stand: ${what}. The collector `
      + 'removes nothing until this is fixed, and keeps asking.');
  }
  const answers = [...b.passAudits.values()];
  const only = (c: CollectPassClass): number => (answers.every((a) => a === c) ? answers.length : 0);
  if (only('no-document') >= 2) {
    line('no-document', `${answers.length} temp-root audits this pass got no answer from ccd at all, and none got one; `
      + 'the fleet box or the link to it may be struggling. ccrc keeps asking.');
  }
  if (only('lock') >= 2) {
    line('lock', `${answers.length} temp roots answered this pass that their reap lock could not be opened, and no `
      + 'audit answered anything else. ccrc keeps asking.');
  }
  if (b.flockLatched) {
    line('flock', 'ccd on the fleet box answered that flock (util-linux) is unavailable, so the temp-root collector '
      + 'composes nothing until flock is installed and this server restarts.');
  }
  const calls = [...b.unsettled].filter(([, k]) => k === 'audit').map(([id]) => id).sort();
  const jobs = [...b.unsettled].filter(([, k]) => k === 'job' || k === 'act').map(([id]) => id).sort();
  if (calls.length + jobs.length > 0) {
    // H1, R85: an unsettled audit call OR executor job; a job's clause, its act out or not, says the act slot is held.
    const said = [
      ...(calls.length === 0 ? [] : [`A temp-root collector call to ccd has not settled within its bound for `
        + `${childReclaimIdsNamed(calls)}.`]),
      ...(jobs.length === 0 ? [] : [`The collector’s act slot is held by the job for ${childReclaimIdsNamed(jobs)}, `
        + 'which has not settled within its bound, whether or not it has called ccd yet.']),
    ];
    line('unsettled', `${said.join(' ')} The collector asks nothing more of these ids until each settles.`);
  }
  if (unvouched.length > 0) {
    line('unvouched', `${unvouched.length} temp roots are held because the coordination database cannot vouch for the `
      + `run that minted each one: the run is missing, or opened after the temp root was handed out `
      + `(${childReclaimIdsNamed(unvouched)}). They stay held, armed or not; a person removes them once nothing still needs them.`);
  }
  return out;
}

/** The collector's attention (spec §5.10): ONE uncollapsed item per id, in id order; each word's collapsed clause;
 *  and the box-wide lines. An id that fails `isTmpRootId` never lists. Pure. Each entry is already
 *  `collectAttentionViewOf`'s projection, so WHETHER a per-id cause stands was Task 4's decision and no threshold is
 *  read here: `nowMono` is carried for the lane's call and read by none
 *  (`continuity-measured-answer-to-answer`). */
export function collectAttentionItems(i: {
  readonly entries: ReadonlyMap<string, CollectAttentionView>;
  readonly box: CollectBoxFacts;
  readonly nowMono: number;
}): ChildReclaimCollectInput {
  const recordsSubsumed = i.box.unmeasured.some((d) => d.listing === 'tmpquarantine');
  const perId: ChildReclaimCollectAttention[] = [];
  const manyLead: Record<string, string> = {};
  const unvouched: string[] = [];
  for (const [id, v] of [...i.entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!isTmpRootId(id)) continue;
    const t = collectItemOf(id, v, recordsSubsumed);
    if (t === null) continue;
    if (t === 'unvouched') { unvouched.push(id); continue; }
    perId.push({ kind: 'collect', sessionId: id, runId: v.witnessRun, word: t.word, sentence: t.sentence });
    manyLead[t.word] = t.many;
  }
  return { perId, manyLead, box: collectBoxItems(i.box, unvouched) };
}

/** The collector's feed titles (spec §5.10): its own, never a child reclaim title. */
export type CollectFeedKind = 'collected' | 'would-collect' | 'answer' | 'switch';
export const COLLECT_FEED_TITLE: Readonly<Record<CollectFeedKind, string>> = {
  collected: 'temp root collected',
  'would-collect': 'temp root would be collected',
  answer: 'temp root collector',
  switch: 'temp root collector switch',
};

const collectWho = (id: string, runId: number | null): string => (runId === null ? id : `${id}, child of run #${runId}`);
const COLLECT_WITNESS_SAID: Readonly<Record<Extract<CollectResult, { readonly kind: 'collected' }>['witness'], string>> = {
  dropped: 'its witness was dropped',
  kept: 'its witness was kept: a newer spawn on this id had written it again',
  absent: 'its witness was already gone',
};

/** A `collected` row (spec §5.10). A witness-only collect (`record: null`) says no leaf stood and what became of the
 *  witness, and NEVER that a temp root was removed: nothing was. */
export function collectFeedCollectedBody(id: string, runId: number | null, leaf: string | null,
  r: Extract<CollectResult, { readonly kind: 'collected' }>): string {
  const at = leaf === null ? '' : childReclaimDetailText(leaf);
  if (r.record === null) {
    return `${collectWho(id, runId)}: no leaf stood${at === '' ? '' : ` at ${at}`}, so nothing was moved; `
      + `${COLLECT_WITNESS_SAID[r.witness]}.`;
  }
  return `${collectWho(id, runId)}: the temp-root collector removed its temp root${at === '' ? '' : ` ${at}`} `
    + `(record ${childReclaimDetailText(r.record)})${r.resumed ? ', finishing a collection an earlier attempt began' : ''}; `
    + `${COLLECT_WITNESS_SAID[r.witness]}.`;
}

/** Shadow's row, once per (id, token) episode (spec §5.10). */
export function collectFeedWouldCollectBody(id: string, runId: number | null, leaf: string | null): string {
  return `would collect ${id}${runId === null ? '' : `, child of run #${runId}`}: ${collectTmp(leaf)} was found `
    + 'orphaned and idle by two audits at least a pass apart. The collector is shadowed, so nothing was removed.';
}

/** One row per switch flip (spec §5.10). Any same-uid session can touch the switch, so every change is said. */
export const collectFeedSwitchBody = (live: boolean): string => (live
  ? 'the collector lane is now live: the temp-root collector removes an orphaned temp root it has proved idle twice, '
    + 'with no person in the loop, while cleanup is not paused.'
  : 'the collector lane is now shadowed: the temp-root collector audits and reports what it would collect, and removes nothing.');

/** One row per (id, word) episode of any other answer (spec §5.10): ccd's word, detail and paths, each made one line. */
export function collectFeedAnswerBody(id: string, runId: number | null, word: string, detail: string | null,
  paths: readonly string[]): string {
  const w = childReclaimDetailText(word);
  const d = detail === null ? '' : childReclaimDetailText(detail);
  const p = paths.map((x) => childReclaimDetailText(x)).filter((x) => x !== '');
  const said = `${w === '' ? 'a word this build cannot show' : w}${d === '' ? '' : `: ${d}`}`
    + `${p.length === 0 ? '' : ` (paths: ${p.join(', ')})`}`;
  return `${collectWho(id, runId)}: ccd answered ${childReclaimStuckEnd(said)}`;
}

/** The feed cue of one AUDIT answer (spec §5.10; R88: one row per (id, word) episode, quiet on repeats), which the lane
 *  hands Task 4's `collectFeedStep` after each fold. A `collectable` answer is an observation: no row, and a
 *  would-collect episode of its own token stands. Every other answer is a row keyed by its word. A key is memory
 *  only, compared and never shown. A shadow would-collect is `{ kind: 'row', key: collectWouldCollectKey(token) }`. */
export function collectFeedCueOfAudit(a: CollectAudit): CollectFeedCue {
  switch (a.kind) {
    case 'collectable': return { kind: 'observe', token: a.token };
    case 'verdict': return { kind: 'row', key: a.verdict };
    case 'unmeasured': return { kind: 'row', key: `unmeasured ${a.probe}` };
    case 'no-document': case 'unreadable': return { kind: 'row', key: a.kind };
  }
}

/** The feed cue of one ACT outcome (spec §5.10): every outcome is a row keyed by its kind and word, an act's
 *  `no-document` apart from an audit's. */
export function collectFeedCueOfAct(r: CollectResult): CollectFeedCue {
  switch (r.kind) {
    case 'collected': return { kind: 'row', key: 'collected' };
    case 'refused': return { kind: 'row', key: `refused ${r.word}` };
    case 'failed': return { kind: 'row', key: `failed ${r.token}` };
    case 'die': return { kind: 'row', key: `die ${r.word}` };
    case 'no-document': return { kind: 'row', key: 'act no-document' };
  }
}
```

There is no private probe classifier here: Task 2's `collectProbeClass` is the one (H3).

- [ ] **Step 6: The one write, and census (c).** In `server/src/watch.ts`:

(a) Add `CHILD_RECLAIM_COLLECT_NONE` to the existing `./childReclaimSweep.js` import (the statement at `:94-108`), in place on its line `:107` (`grep -n "^  CHILD_RECLAIM_SWEEP_REJECTED, childReclaimTierSeed,$" server/src/watch.ts`, ONE line), so the import block keeps its line count and stays clear of run 358's `:112`, `:121` and `:125`:

```ts
  CHILD_RECLAIM_SWEEP_REJECTED, childReclaimTierSeed, CHILD_RECLAIM_COLLECT_NONE,
```

(b) In `childReclaimPublishAttention` (`grep -n "this.childReclaimAttentionList = childReclaimAttentionWithLeaves(" server/src/watch.ts`), replace the two lines

```ts
    this.childReclaimAttentionList = childReclaimAttentionWithLeaves(
      childReclaimAttentionWithKept(mirrorArms, kept, verdicts), this.childReclaimLeaves.map((k) => k.item));
```

with

```ts
    this.childReclaimAttentionList = childReclaimAttentionWithLeaves(
      childReclaimAttentionWithKept(mirrorArms, kept, verdicts), this.childReclaimLeaves, CHILD_RECLAIM_COLLECT_NONE);
```

Never an inline object (`watch-interim-empty-collector`, H8). Task 7 replaces `CHILD_RECLAIM_COLLECT_NONE` with the lane's attention, and drops it from the import once unused.

In `server/test/child-reclaim-verdict-readers.test.ts`, census (c)'s `WRITE` becomes:

```ts
    const WRITE = 'this.childReclaimAttentionList = childReclaimAttentionWithLeaves(\n'
      + '      childReclaimAttentionWithKept(mirrorArms, kept, verdicts), this.childReclaimLeaves, CHILD_RECLAIM_COLLECT_NONE)';
```

- [ ] **Step 7: Run the tests to verify they pass, and the neighbours stay green.**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-attention.test.ts test/collect-feed-body.test.ts \
  test/child-reclaim-detail-unsafe-classes.test.ts test/child-reclaim-leaf-kept-prose.test.ts \
  test/child-reclaim-leaf-kept.test.ts test/child-reclaim-detail-text.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim-leaf-kept-lane.test.ts test/child-reclaim-leaf-kept-store.test.ts \
  test/child-reclaim-stuck.test.ts test/child-reclaim-verdict-readers.test.ts test/child-reclaim-attention-arms.test.ts \
  test/child-reclaim-sweep.test.ts test/child-reclaim-sweep-policy.test.ts test/child-reclaim-chip-source.test.ts \
  test/single-definition.test.ts test/mail-routes.test.ts collect-
```

Expected:
- the first command: all green. Record each file's count (none was measured at planning).
- the second command: green, with the counts the earlier tasks left. The trailing `collect-` filter runs Tasks 2 to 4's collector files.
  - `child-reclaim-leaf-kept-lane` stays green: its sentence check is a `stringContaining` on the temp-root clause, which is unchanged.
  - `mail-routes`' kebab scanner reads `server/src/coord` only, and this task adds no quoted literal there.
  - `single-definition` stays green: `'run-open'`, the hold-why table's key in `collectLane.ts`, is excused by name on the archive-door scan's `want` line (`:4192` at `d0c2b7803`, Task 4's in-place edit); this task adds no other copy of a `CODES` literal to `shared`, `server/src`, `pwa/src` or `agent/src`, and the item-word table is total over its own type.

Run each command in the foreground with a timeout of at least 600000 ms. If `child-reclaim-sweep` reds on a known load flake, re-run it in isolation before calling it a break.

- [ ] **Step 8: The PWA renders every shape with NO PWA edit.**

```bash
( cd pwa && { test -d node_modules || npm ci; } && ./node_modules/.bin/tsc --noEmit ) ; echo "pwa tsc rc=$?"
git status --porcelain -- pwa/          # prints nothing
```

Expected: `pwa tsc rc=0`, and `git status` prints nothing. The new union arms compile through `RenderedAttention = Pick<Extract<ChildReclaimAttention, { readonly sessionId: string }>, 'sessionId' | 'runId' | 'sentence'>` (`pwa/src/fleet/childReclaimWords.ts:67`).

`collect-attention.test.ts`'s last case reads the real list through `childReclaimAttentionOf`, using a dynamic `import()` that vitest resolves; `typecheck-tests` sees it as `Promise<any>`. It covers a per-id item, a `collect:in-use` line and an unmeasured-listing box line with no measured id. How they render, read off `ChildReclaimBanner.tsx` at `d0c2b7803`:
- A `collect` item passes `isAttention` (`childReclaimWords.ts:78-83`: a string `sessionId`, a string `sentence`, and a null-or-number `runId`). The banner renders it at `:148-153` as `<li key={a.sessionId}>`, with `<span className="child-reclaim-who">` holding `a.runId === null ? a.sessionId : \`run #${a.runId} · ${a.sessionId}\``, then the sentence.
- A box-wide line's `sessionId` is its fixed label, rendered as PLAIN TEXT in that span: a React text node, not a link. The labels are distinct, so the `key` stays unique, and no session id or registry id can equal one: each holds a `/`, which no file name under `$REG` can carry (a reclaim item's id comes from a registry file name with no shape filter, so a space alone would not do).
- A `ChildReclaimCollectMany` passes `isKeptMany` (`:98-103`) and renders at `:141-146`, keyed `kept-many collect:<word>`, a key no other line uses. Each member renders as `run #N · <id>`.

Do NOT add a PWA test file.

- [ ] **Step 9: Mutation table.** Apply each mutation alone, run its command from `server/`, see the red, and revert. NONE of these was measured at planning: record the measured red text for each row (R-j). Commands:
- **A:** `./node_modules/.bin/vitest run test/child-reclaim-detail-unsafe-classes.test.ts`
- **B:** `./node_modules/.bin/vitest run test/child-reclaim-leaf-kept-prose.test.ts`
- **C:** `./node_modules/.bin/vitest run test/collect-attention.test.ts`
- **D:** `./node_modules/.bin/vitest run test/collect-feed-body.test.ts`

| # | Mutation (exact edit) | Cmd | Expected red |
|---|---|---|---|
| T5.1 | `DETAIL_UNSAFE_CATEGORY`: delete `\p{Cc}` | A | "Cc: ESC", "Cc: the C0 upper bound (US)", "Cc: DEL" and "Cc: the C1 upper bound (APC)": `expected 'left…right' to be 'left right'` |
| T5.2 | delete `\p{Cf}` | A | every "Cf: …" row the same way (U+E0061 included) |
| T5.3 | delete `\p{Zl}` | A | "Zl: the line separator" |
| T5.4 | delete `\p{Zp}` | A | "Zp: the paragraph separator" |
| T5.5 | delete `\p{Cs}` | A | the two "Cs: …" rows |
| T5.6 | delete ` \|\| c === 0x034f` | A | "U+034F: the combining grapheme joiner (Mn)" |
| T5.7 | delete ` \|\| (c >= 0xe0000 && c <= 0xe007f)` | A | the three "the tag block by range" rows; U+E0061 stays green (Cf) |
| T5.8 | narrow the tag range: `c <= 0xe007f` → `c <= 0xe001e` | A | "the tag block by range: U+E001F (Cn)" |
| T5.9 | wave 8's narrowed C0/C1: delete `\p{Cc}` and append ` \|\| c <= 0x1e \|\| (c >= 0x7f && c <= 0x9e)` | A | "Cc: the C0 upper bound (US)" and "Cc: the C1 upper bound (APC)" |
| T5.10 | wave 8's narrowed bidi: delete `\p{Cf}` and append ` \|\| (c >= 0x202a && c <= 0x202d) \|\| (c >= 0x2066 && c <= 0x2068)` | A | "Cf: the bidi override upper bound (RLO)", "Cf: the bidi isolate upper bound (PDI)", and every other Cf row |
| T5.11 | over-widen: add `\p{Zs}` to the class | A | the CONTROL case: `20: expected 'left right' to be 'left right'` (U+0020 now replaced and trimmed into one space) |
| T5.12 | `childReclaimDetailText`: `cps.length <= LC_LINE_MAX` → `cps.length < LC_LINE_MAX` | A | "is 2048 code points…": `expected 'xxx…x…' to be 'xxx…x'` |
| T5.13 | `childReclaimLeafKeptSentence`: restore `'What was kept stays on disk and ccrc deletes nothing more of it; a person removes it once nothing still uses it.'` in place of `What was kept stays on disk.` plus the halves | B | "each half is written only when that half was kept" and "\"ccrc deletes nothing more of it\" is gone…" |
| T5.14 | write the clips half unconditionally: `(clips.kind === 'kept' ? \` ${LEAF_CLIPS_STAYS}\` : '')` → `\` ${LEAF_CLIPS_STAYS}\`` | B | "each half…", on the temp-root-only sentence |
| T5.15 | `childReclaimLeafKeptManySentence`: restore `'Each stays until a person removes it, and the feed row of each names what was kept and why. '` | B | "the collapsed line" and the source scan |
| T5.16 | `clipsClause`: the truncated arm → `null` | B | the yield case: `expected [ …, [ 'demo-x', null ] ] to deeply equal [ …, [ 'demo-x', 'whether its clips directory ~/.cc-clips/demo-x was kept is not known' ] ]` |
| T5.17 | `clipsClause`: the kept arm → `null` | B | the same case, on `demo-k` |
| T5.18 | revert Task 1's three `runId` lines (`shared/api.ts`, by content: `grep -n "evidence names, else null" shared/api.ts`) to wave 8's three | B | "the marker’s run, meas.childOf on leaf-kept…": `toContain` fails |
| T5.19 | merge: `reclaimSecond` → `[clips.get(id)].filter(…)` (drop `records.get(id)`) | C | "a reclaim item wins … carries a quarantine-kept sentence…": `expected [ { … sentence: 't.' } ] to deeply equal [ { … sentence: 't. Q.' } ]` |
| T5.20 | merge: `reclaimSecond` → `[records.get(id)].filter(…)` (drop the clips clause) | C | "leaf-yield-carries-the-clips-clause…" and "a reclaim kept-many member carrying a second clause…" |
| T5.21 | `withSecond`: drop the `s.includes(c) ? s :` guard | C | "a second clause the winner already gives is not given twice": `'t. Q. Q.'` |
| T5.22 | merge, collector loop: `if (second !== undefined) singles.push(…)` → always `loose.push(c)` | C | "a collector item wins over a leaf item…" and "an item carrying a second clause never collapses…" |
| T5.23 | merge, collector loop: delete `if (taken.has(c.sessionId)) continue;` | C | "a reclaim item wins…": the collector item lists beside the reclaim item |
| T5.24 | merge, collector loop: delete `taken.add(c.sessionId);` | C | "the order…" passes, but "a collector item wins over a leaf item…" shows the leaf item listed too |
| T5.25 | collapse threshold: `members.length > CHILD_RECLAIM_KEPT_MANY_OVER` → `>=` | C | "more than 5 with runs … five stay single": a `kept-many` where five singles were expected |
| T5.26 | delete the run-less collapse: the `runless.length > CHILD_RECLAIM_KEPT_MANY_OVER` branch → always `singles.push(...runless)` | C | "six unreadable witnesses (no run) list as ONE box-wide count line…" |
| T5.27 | the collapsed word: `` `${CHILD_RECLAIM_COLLECT_MANY_PREFIX}${word}` `` → `word` (with a cast) | C | "more than 5 …": `'in-use'` where `'collect:in-use'` was expected |
| T5.28 | the reclaim kept-many expansion: replace the `isChildReclaimKeptWord(word) \|\| …` branch's body with `reclaim.push(a); continue;` unconditionally | C | "a reclaim kept-many member carrying a second clause leaves the line…" |
| T5.29 | `collectAttentionViewOf`: project the hold from memory whatever the causes say (append `hold = e.held === null ? null : { why: e.held.why, since: e.held.sinceMono };` after the loop) | C | "a hold and presence stand once they span a ceiling…": `held short: expected { why: 'run-open', since: 0 } to be null` |
| T5.30 | `collectAttentionViewOf`: project `changedRecentlySince` from the streak whatever the causes say (append `changedRecentlySince = e.streak?.word === 'changed-recently' ? e.streak.sinceMono : null;` after the loop) | C | "changed-recently stands once its streak spans a day…": `expected 0 to be null` |
| T5.31 | `collectAttentionViewOf`: `else deferral = …` → `else if (c.kind !== 'in-use') deferral = …` | C | "in-use stands at its first answer…": `expected null to deeply equal { word: 'in-use', detail: 'in-use: d', since: 0 }` |
| T5.32 | terminal: `v.terminal.tier.tier` → `v.terminal.tier.tierRun >= 4` | C | "a terminal answer is listed at once…" |
| T5.33 | failing: `v.failing.tier.tier` → `v.failing.tier.tierRun > 0` | C | "a per-leaf … only at tier entry": `checkouts x3: expected { … } to be undefined` |
| T5.34 | delete `!(recordsSubsumed && v.failing.word === COLLECT_RECORDS_PROBE)` | C | "records lists no per-id item while tmpquarantine is unmeasured": `expected [ { … } ] to deeply equal []` |
| T5.35 | the unvouched hold: delete `if (COLLECT_HOLD_UNVOUCHED.includes(v.hold.why)) return 'unvouched';` | C | "ids held by run-absent or run-after-witness…": seven `held` items where one was expected |
| T5.36 | `collectAttentionItems`: delete `if (!isTmpRootId(id)) continue;` | C | "an id that fails isTmpRootId never lists…": `expected [ { sessionId: '-x', … }, … ] to deeply equal []` |
| T5.37 | in-use: `collectSaid(d.detail)` → `` ` What ccd said: ${d.detail}.` `` | C | "in-use is listed at once…": the expected sentence differs at the newline and RLO |
| T5.38 | `collectTmp`: `childReclaimDetailText(leaf)` → `leaf` | D | "every ccd-sourced string reaches a body only through childReclaimDetailText…": `a newline: expected true to be false` |
| T5.39 | `collectBoxItems`: `only('no-document') >= 2` → `>= 1` | C | "no-document and lock…": `expected [ 'no-document' ] to deeply equal []` |
| T5.40 | `only`: `answers.every((a) => a === c) ? answers.length : 0` → `answers.filter((a) => a === c).length` | C | the same case, on `{ a, b, c: 'other' }` and on `{ a, b, c: 'no-document' }` for `lock` |
| T5.41 | `COLLECT_BOX_LABELS['no-run']` → `'temp-roots-no-run'` | C | "every label is spelled once, holds a slash…": `temp-roots-no-run: expected false to be true` |
| T5.42 | `collectBoxProbesAfter`: `return passed ? new Map() : prev;` → `return prev;` | C | "a box-wide probe stands until an answer passes every rung…": `expected 1 to be +0` |
| T5.43 | `collectFeedCollectedBody`'s witness-only arm → `` `${collectWho(id, runId)}: the temp root was removed; …` `` | D | "a witness-only collect says no leaf stood…": `expected '…removed…' not to match /remov/` |
| T5.44 | `collectFeedCollectedBody`: `childReclaimDetailText(r.record)` → `r.record` | D | "every ccd-sourced string…": `a newline: expected true to be false` |
| T5.45 | `collectFeedAnswerBody`: `paths.map((x) => childReclaimDetailText(x))` → `paths.map((x) => x)` | D | the same case |
| T5.46 | `COLLECT_FEED_TITLE.collected` → `'child reclaim collected'` | D | "the titles are the lane’s own…": `child reclaim collected: expected true to be false` |
| T5.47 | `collectItemOf`: delete the `if (v.die !== null) { … }` branch | C | "a pre-lock die recurring past the ceiling is listed…": `TypeError: Cannot read properties of undefined (reading 'word')` |
| T5.48 | `collectAttentionViewOf`: `else if (c.kind === 'die') die = { word: c.word, since: c.sinceMono };` → `else if (c.kind === 'die') continue;` | C | "a pre-lock die recurring for a ceiling…": `expected null to deeply equal { word: 'lock-unopenable', since: 0 }` |
| T5.49 | `collectAttentionViewOf`: `wouldCollect: collectWouldCollectStands(e)` → `wouldCollect: e.feedEpisode !== null` | C | "wouldCollect is true while the would-collect episode stands…": `expected true to be false` |
| T5.50 | the terminal sentence (H8): `` `${collectCap(tmp)}: ccd’s last terminal answer for it was ${w}${said}…` `` → `` `${collectCap(tmp)}: ${lead ?? w}…` `` (the present-tense lead H8 forbids) | C | "a terminal answer is listed at once with what ccd last answered…": `expected { … } to deeply equal { … }` |
| T5.51 | the unsettled line: `filter(([, k]) => k === 'job' \|\| k === 'act')` → `filter(() => false)` | C | "the flock latch and unsettled calls or jobs…": `a job whose act is out holds the slot too (R85): expected '…' to contain 'act slot is held by the job for demo-a'` |
| T5.52 | `collectAttentionItems`: `d.listing === 'tmpquarantine'` → `d.listing === 'tmproots'` | C | "records lists no per-id item while tmpquarantine is unmeasured": `expected [ { … } ] to deeply equal []` |
| T5.53 | `collectBoxItems`: drop the sort of `b.unmeasured` (`const doubts = [...b.unmeasured];`) | C | "an unmeasured listing, an over-cap listing and refused names…": the two listing lines in the doubts' order, not the table's |
| T5.54 | `collectFeedCueOfAudit`: `case 'collectable': return { kind: 'observe', token: a.token };` → `case 'collectable': return { kind: 'row', key: a.kind };` | D | "audits": `expected { kind: 'row', … } to deeply equal { kind: 'observe', … }`, and the episode case's `feedEpisode` |
| T5.55 | `collectFeedCueOfAct`: `` `refused ${r.word}` `` → `'refused'` | D | "acts": `expected { kind: 'row', key: 'refused' } to deeply equal { kind: 'row', key: 'refused in-use' }` |
| T5.56 | `collectProbeText`: `childReclaimDetailText(word)` → `word` | C | "an unknown probe or failure word reaches its sentence only through childReclaimDetailText": `expected true to be false` |
| T5.57 | the unsettled line, back to the pre-R85 split: `calls`' `k === 'audit'` → `k !== 'job'`, and `jobs`' `k === 'job' \|\| k === 'act'` → `k === 'job'` | C | "the flock latch and unsettled calls or jobs…": the act entry joins the call clause, `expected 'A temp-root collector call to ccd has not settled within its bound for demo-a, demo-b. …' to contain 'within its bound for demo-b.'` |
| T5.58 | the would-collect sentence: restore `` `The temp-root collector would collect ${tmp} now: two audits at least a pass apart found it orphaned ` `` + `'and idle. The collector is shadowed, so nothing was removed; a person arms it by hand.'` | C | "a standing would-collect episode is listed…": `expected '…' to contain 'While the collector was shadowed'` |

Revert each mutation, then re-run Step 7's first command: green.

- [ ] **Step 10: Type-check, and prove `shared/api.ts` untouched and `watch.ts`'s edit line-neutral.**

```bash
( cd server && ./node_modules/.bin/tsc --noEmit -p . )
( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )
( cd pwa && ./node_modules/.bin/tsc --noEmit )
git diff --stat HEAD -- shared/api.ts            # prints nothing: L0 is Task 1's (H3)
git diff --numstat HEAD -- server/src/watch.ts   # 2 added, 2 removed: the import line and the call's second line
grep -c "^import" server/src/collectLane.ts      # 2 (H2)
```

Expected:
- both `tsc` runs print nothing.
- `typecheck-tests` is green. A `CollectEntry` field, a cause arm or a Task 4 export named otherwise than H3 reds `collectAttentionViewOf` here: STOP and report it to the coordinator. Never reshape the entry.
- `git diff --stat` prints nothing for `shared/api.ts`; `watch.ts` shows 2 lines added and 2 removed; `collectLane.ts` still has exactly its two import statements.

- [ ] **Step 11: Commit.**

```bash
git add server/src/childReclaimSweep.ts server/src/collectLane.ts server/src/watch.ts \
  server/test/collect-attention.test.ts server/test/collect-feed-body.test.ts \
  server/test/child-reclaim-detail-unsafe-classes.test.ts server/test/child-reclaim-leaf-kept-prose.test.ts \
  server/test/child-reclaim-leaf-kept.test.ts server/test/child-reclaim-detail-text.test.ts \
  server/test/child-reclaim-verdict-readers.test.ts
git commit -m "$(cat <<'MSG'
feat(reclaim): the temp-root collector's attention, its feed bodies, and one item per id

The collector's lane memory now becomes attention: one collect item per
id, listed at its own threshold. A terminal word, in-use (naming ccd's
holder) and a per-leaf deterministic probe are listed at once. A hold,
registered, in-progress (naming the reap lock path), presence and a
recurring pre-lock die are listed once they stand the defer ceiling,
first answer to latest, the failing and verb-failed runs at tier entry,
changed-recently after a day, and shadow's would-collect while it
stands. Whether each stands is the lane's own cause, projected; a
terminal item says what ccd last answered, never that it refuses now.
Box-wide conditions are single lines under fixed labels that no
session id can equal: an unmeasured or over-cap listing, refused names
(count only), box-wide probes, no-document and lock seen across ids, the
flock latch, unsettled calls or jobs, and runs coord.db cannot vouch for.
Each answer also maps to its feed cue for the lane's episode memory.

One item per id: a reclaim item wins over a collector item, which wins
over a kept leaf, and the winner carries the loser's instruction (a kept
quarantine record's sentence, a kept clips directory's clause). An item
carrying such a clause never collapses. More than five collector items of
one word with runs collapse into a collect:<word> line, and run-less ones
into one count line naming at most five ids.

detailUnsafe now covers general categories Cc, Cf, Zl, Zp and Cs, plus
U+034F and the tag block, and every ccd string the collector shows passes
through childReclaimDetailText. The two kept-leaf sentences that arming
would make false now say when the collector removes a temp root.
shared/api.ts is untouched: Task 1 declared the arms and the labels.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

---

### Task 6: The collector's executor — `collectTempRoot` (R85 steps 1–6), its two reads, the learning audit and the open-run hold

**Model routing:** **`opus`, effort `xhigh`**. SAFETY: this task writes the ONE composer of wave 7's destructive verb `ws-collect`. It decides, at the instant of the argv, whether a collect token is spent, on which id and with which token. It is the subject of this wave's SAFETY lens.

**Why:**
- **R85 — the licence and the job.** The server spends a collect token only on two observations with the same token T, observation 2 (the executor's own audit) arriving at least `COLLECT_OBSERVE_INTERVAL_MS` after observation 1 on the monotonic clock, and only through ONE job on `queue.run(id, …)` in six steps:
  1. both capabilities, then the id predicate again on `job.id`;
  2. the switches from one listing;
  3. presence;
  4. the audit as observation 2 against observation 1 from the lane's memory, then the open-run hold on observation 2's document;
  5. the switches and the live marker, the job's LAST await;
  6. synchronously, with no await before the argv: observation 1 re-read, presence again, the hold's store reads again, and `capSupported(COLLECT_CAP)` again in the act's own scope.

  Then live, `CCD_ARGV.wsCollect(obs2.token, job.id, dec)`; shadow, "would collect". The token is a comparand, never carried: the argv takes observation 2's token and the job's id. Stale answers (a clear landed while the call was in flight) are no observation. Never `--defer-expired`. The executor never kills a holder.
- **R82 — shadowed, armed by hand.** The marker is read by the executor alone, nearest the argv, from the same listing as `reclaim-paused`. A flip either way (the lane's last-seen flag starts `shadowed`) clears every pair, and the job that sees it composes nothing.
- **R83 — the population's read.** `lstatMeasured` first (`regular | symlink | other` or a failure). A proven absence is an empty listing, with no `readdir`. A link, a file or any failure makes THAT listing unmeasured. Only `other` is listed, and a null listing is resolved by `statMeasured`. The id predicate is asserted at step 1, on its own pin.
- **R84 — the readers.** This task consumes Task 2's `parseCollectAudit` and `parseCollectResult`, and never reclaim's parsers.
- **R86 — the gates.** `capSupported(COLLECT_CAP) && capSupported(RECLAIM_PAUSE_CAP)`. Every `wsCollectAudit(` site calls `verbSupported` AND `capSupported(COLLECT_CAP)` in its own scope. A pause or an unlistable registry stops the job. The presence defer applies. The open-run hold (a)–(f), judged on observation 2's document.
- **R87.** A raised pause, a missing capability and a marker flip clear the observation PAIRS only. The executor paces nothing: it reports, and the lane (Task 7) folds the report through Task 4's L1 transitions and owns the slot.
- **H3 — Task 4's licence, spelled once.** Step 4 calls Task 4's `collectLicence`, and step 6's synchronous re-read is Task 4's `collectLicenceStands(first, composed, now, obs)`, fed through the port (`generations`, `observation`). `CollectGenerations` is L1's `CollectCapture`, aliased, never re-declared. The hold's words are Task 4's `CollectHoldWhy`: `run-open`, `run-absent`, `run-after-witness`, `id-in-open-run`, `no-witness-run`, `store-unreadable`.
- **H4 — the start hold-off is asked at the lane's OFFER** (Task 7's `collectOffers`, shadow included), never here. The executor asks no hold-off, its port carries no hold-off member, and `held-off` is no answer of this job. `start-hold-off-asked-at-the-offer` is Task 7's.
- **H5 — no commit is red.** This commit composes the verb, so in the same commit it rewrites the wiring census's two holder lists, classifies `ws-collect` in `CAP_GATED_VERBS`, and rewrites, line-neutrally, the two `ccdargv.ts` docstrings the composition makes false (`ccdargv-collect-docstrings-rewritten`, moved here from Task 8).
- **H6.** The one `CCD_ARGV.wsCollect(` site's first argument is `obs2.token`, with `const obs2 = audit.value;` bound in `collectTempRoot` from the job's one audit call (`const audit: CollectAnswer<CollectAudit> = asked;`, `asked` from `await collectAudit(deps, job.id)`). Task 8's scan accepts exactly that shape.
- **R89.** No ccd, agent or PWA edit.

**Entry (measured in Step 0):** Tasks 1–5 are committed on this branch:
- Task 1: `isTmpRootId`, `TMPROOT_ID_MAX_CHARS` and `CollectToken` at `shared/api.ts`'s foot, and `CCD_ARGV.wsCollect`'s first parameter typed `CollectToken`;
- Tasks 2–4: `server/src/collectLane.ts`.

`server/src/watch.ts` is NOT touched here. Task 7 wires this executor into the pass and implements the lane memory port this task declares.

**Files:**
- Create: `server/src/coord/collectTempRoot.ts`. It is L3, the executor, and its ports are declared by this consumer. It imports `node:path`, `../io.js` (types), `../ccdargv.js`, `./store.js` (type), `./rundefs.js`, `./childSpent.js`, `../collectLane.js` and `../../../shared/api.js`, and nothing from `watch.ts`. It spells neither the literal `'ws-collect'` nor `'--collect'` on a code line. Those two lists in `ws-collect-wiring.test.ts` stay byte for byte (R86).
- Create: `server/test/collectTempRootFixture.ts`. The shared rig of this task's three case files. Task 7 may import its `auditDoc`, `collectedDoc` and constants. It never builds a second executor rig.
- Create: `server/test/collect-temp-root.test.ts` (the executor, step by step).
- Create: `server/test/collect-temp-root-reads.test.ts` (`readCollectPopulation`, `collectSwitches`, `learnCollect`).
- Create: `server/test/collect-open-run-hold.test.ts` (`collectOpenRunHold`, (a)–(f)).
- Modify: `server/test/verb-gate.test.ts`, ONE word. `CAP_GATED_VERBS` (`:104-106` at `d0c2b7803`; `grep -n "^const CAP_GATED_VERBS" server/test/verb-gate.test.ts`) gains `'ws-collect'`. This commit creates the verb's only call site, and that site's scope gates it by `capSupported(` (steps 1 and 6), not by `verbSupported(`. Task 8 keeps the rest of R86's verb-gate edit: `NEW_GENERATION` and the comment.
- Modify: `server/test/ws-collect-wiring.test.ts`, two arrays only. The INERT `it` "the builders, the verb, its mode flag and its token stand only where they are declared" (`:61`) has two lists, and each gains `'coord/collectTempRoot.ts'`:
  - the builder list (`:62`; `grep -n "a reference to either builder" server/test/ws-collect-wiring.test.ts`);
  - the `COLLECT_CAP` list (`:65`; `grep -n "declared, read by nothing" …`).

  The `'ws-collect'` list (`:63`) and the `'--collect'` list (`:64`) stay byte for byte. The describe, its title and the deliberate rewrite are Task 8's (R86). Task 7 adds `'watch.ts'` to the `COLLECT_CAP` list in its own commit (H5).
- Modify (comment-only, line-neutral): `server/src/ccdargv.ts`, the two docstrings this commit makes false (H5, `ccdargv-collect-docstrings-rewritten`): `wsCollect`'s "Composed by NOTHING in this build…", the LAST THREE lines of the docstring as Task 1 Step 4 (e) left it (from the `dec trails, and ccd strips it before it binds a positional. Composed by NOTHING…` line through `until then. */`; Task 1 grew it from 5 lines to 7, so the `:455-456` of `d0c2b7803` no longer locate it), and `COLLECT_CAP`'s "…Nothing reads it in this build" (`:895-896` at `d0c2b7803`, two lines lower after Task 1). Step 4 (d).
- Modify: `server/test/mail-routes.test.ts`, one import and one arm of the kebab scanner's accept chain, with its comment and the assertion message's last words (P9). The scanner (`it('every quoted kebab token in server/src/coord that looks like a code is declared'`, `:574` at `d0c2b7803`) reads every `.ts` file in `server/src/coord`, and this executor spells thirteen kebab literals no guard admits: `id-in-open-run`, `id-refused`, `marker-flip`, `no-document`, `no-witness-run`, `not-asked`, `not-collectable`, `not-licensed`, `pair-cleared`, `run-absent`, `run-after-witness`, `run-open` and `would-collect`. They are admitted through the executor's own exported guard, `isCollectExecutorKebab`, derived from its tables, as `isArchivedExpiryKebab` (`server/src/archivedExpiry.ts:596`) admits the expiry lane's: never through `NOT_CODES`. Step 4 (e).
- Modify: `server/test/single-definition.test.ts`, ONE in-place word, line-neutral (P8). The archive-door scan (`it.each(CODES)("'%s' is a code-line literal in shared/api.ts alone"`, `:4191` at `d0c2b7803`) holds `'run-open'` to `shared/api.ts` and the files excused by name, and the hold's `held('run-open', …)` spells it here. Task 4 excused `server/src/collectLane.ts` in that `want` line; this commit adds `'server/src/coord/collectTempRoot.ts'` to the same array. Nothing else in the file changes, and no line is added (`session-hook.test.ts`'s citation audit cites it by line). Step 4 (f).
- No edit to `shared/api.ts`, `server/src/collectLane.ts`, `server/src/childReclaimSweep.ts`, `server/src/watch.ts` or `README.md`, and none to `single-definition.test.ts` beyond Step 4 (f)'s one array.

**Interfaces:**
- Consumes:
  ```ts
  // Task 1 — shared/api.ts foot (L0)
  export const TMPROOT_ID_MAX_CHARS = 255;
  export function isTmpRootId(id: unknown): id is string;          // isSessionIdShape && no leading '.' or '-' && length <= 255
  export type CollectToken = string & { readonly [collectTokenBrand]: true };
  // Task 1 — server/src/ccdargv.ts (wsCollect is :457 at d0c2b7803; grep -n "  wsCollect: (" server/src/ccdargv.ts)
  CCD_ARGV.wsCollect: (token: CollectToken, id: string, dec: ActorFlags | null) => CcdArgv;
  // Tasks 2–4 — server/src/collectLane.ts (L1; imports '../../shared/api.js' and './childReclaimSweep.js' only, H2):
  export const COLLECT_LANE_LIVE_MARKER = 'collect-lane-live';   // Task 2's (H3, H11)
  export type CollectAudit =                                       // Task 2's, H3's shape (every field readonly)
    | { kind: 'collectable'; token: CollectToken; resume: string | null; witnessRun: number | null;
        witnessAt: number | null; leaf: string | null; detail: string }
    | { kind: 'verdict'; verdict: string; idleAt: number | null; witnessRun: number | null; leaf: string | null;
        detail: string }
    | { kind: 'unmeasured'; probe: string; witnessRun: number | null; leaf: string | null; detail: string }
    | { kind: 'unreadable'; detail: string }
    | { kind: 'no-document'; stderr: string };
  export function parseCollectAudit(sessionId: string, ok: boolean, stdout: string, stderr: string): CollectAudit;
  export type CollectResult = …;   // the fixed union; this task reads only its 'no-document' arm's shape { kind; stderr }
  export function parseCollectResult(sessionId: string, ok: boolean, stdout: string, stderr: string): CollectResult;
  export type CollectListing = { kind: 'listed'; names: readonly string[] } | { kind: 'absent' } | { kind: 'unmeasured'; why: string };
  // Task 4 — canonical (H3):
  export interface CollectObservation { readonly token: CollectToken; readonly arrivedMono: number }   // observation 1
  export interface CollectCapture { readonly lane: number; readonly id: number }   // CollectGenerations aliases it
  export type CollectLicence =
    | { readonly kind: 'licensed'; readonly first: CollectObservation }
    | { readonly kind: 'stale' | 'not-collectable' | 'no-first' | 'token-changed' | 'too-soon' };
  /** R85's ONE L1 licence rule: observes, second collectable, first stands, one token, and
   *  secondArrivedMono - first.arrivedMono >= observeIntervalMs (a non-positive interval licenses nothing). */
  export function collectLicence(first: CollectObservation | null, second: CollectAudit, secondArrivedMono: number,
    observeIntervalMs: number, observes: boolean): CollectLicence;
  /** Step 6's re-read: composed.lane === now.lane && composed.id === now.id && obs !== null
   *  && obs.token === first.token && obs.arrivedMono === first.arrivedMono. */
  export const collectLicenceStands: (first: CollectObservation, composed: CollectCapture, now: CollectCapture,
    obs: CollectObservation | null) => boolean;
  export type CollectHoldWhy =
    | 'run-open' | 'run-absent' | 'run-after-witness' | 'id-in-open-run' | 'no-witness-run' | 'store-unreadable';
  export const COLLECT_HOLD_WHYS: readonly CollectHoldWhy[];   // Task 4's, the table's keys; isCollectExecutorKebab reads it
  // Task 2's parse contract the hold keys on (H3, H7; pinned by this task's consumer case):
  //   resume === null  iff the document carries NO `resume` key (a present non-string `resume` is `unreadable`);
  //   witnessRun === null && witnessAt === null  iff `collect.witness` is null; a witness whose `run` or `at` is not a
  //   canonical decimal integer makes the document `unreadable`.

  // Existing at d0c2b7803 (each located by its grep):
  COLLECT_CAP           // server/src/ccdargv.ts:897   grep -n "export const COLLECT_CAP" server/src/ccdargv.ts
  RECLAIM_PAUSE_CAP     // server/src/ccdargv.ts:864   grep -n "export const RECLAIM_PAUSE_CAP"
  capSupported          // server/src/ccdargv.ts:920   grep -n "^export function capSupported"   (no evidence -> false)
  verbSupported         // server/src/ccdargv.ts:678   grep -n "^export function verbSupported"
  sweepDec              // server/src/ccdargv.ts:234   grep -n "^export function sweepDec"       (actor 'collect sweep')
  CCD_ARGV.wsCollectAudit // server/src/ccdargv.ts:451 grep -n "  wsCollectAudit: ("
  RECLAIM_PAUSE_MARKER  // server/src/coord/rundefs.ts:72   grep -n "^export const RECLAIM_PAUSE_MARKER"
  CHILD_BIRTH_SKEW_MS   // server/src/coord/childSpent.ts:58  grep -n "^export const CHILD_BIRTH_SKEW_MS"  (120 000 ms)
  CoordStore.run(id): RunReadResult                      // store.ts:3007  grep -n "^  run(id: number)"
  CoordStore.openRunsClaimedBy(id): OpenSiblingsResult   // store.ts:3141  grep -n "^  openRunsClaimedBy("
  CoordStore.openRunsForSession(id): OpenSiblingsResult  // store.ts:3184  grep -n "^  openRunsForSession("
  TERMINAL_RUN_STATES   // shared/api.ts:4434  grep -n "^export const TERMINAL_RUN_STATES"   (['done','failed'])
  FleetIO.readdir / statMeasured / lstatMeasured  // server/src/io.ts:123 / :127 / :135; MeasuredPathKind :71, MeasuredStat :56
  CcdResult             // server/src/lifecycle.ts:21  grep -n "^export interface CcdResult"
  // Precedents this file follows: expireArchived.ts's expirySwitches (:131), expireAudit (:194) and expireAct (:203);
  // childReclaim.ts's childReclaimAudit (:1302, verbSupported at :1306); archivedExpiry.ts's isArchivedExpiryKebab (:596),
  // the mail-routes scanner's guard derived from Records (P9).
  // Task 4's single-definition excusal (P8): `code === 'run-open' ? ['server/src/collectLane.ts', 'shared/api.ts']`
  //   in the archive-door scan's `want` line (single-definition.test.ts:4192); Step 4 (f) widens it.
  ```
- Produces:
  ```ts
  // server/src/coord/collectTempRoot.ts (L3)
  export interface CollectClock { readonly mono: number; readonly wall: number }
  export type CollectGenerations = CollectCapture;   // spelled once, in L1 (H3)
  export interface CollectAnswer<T> { readonly value: T; readonly composed: CollectGenerations; readonly arrived: CollectClock }
  export type CollectAuditCollectable = Extract<CollectAudit, { kind: 'collectable' }>;
  export interface CollectLanePort {            // watch.ts (Task 7) implements it; every member synchronous
    clock(): CollectClock;
    generations(id: string): CollectGenerations;
    observation(id: string): CollectObservation | null;
    cleared(why: 'paused' | 'caps'): void;      // a lane-wide clear the job saw: every pair clears now
    flipped(live: boolean): boolean;            // true = a flip: flag set, every pair cleared, the one feed row written
  }                                             // no start hold-off: Task 7 asks it at the offer (H4)
  export interface CollectTempRootDeps {
    coord: Pick<CoordStore, 'run' | 'openRunsForSession' | 'openRunsClaimedBy'>;
    io: Pick<FleetIO, 'readdir'>; cfg: Pick<CcrcConfig, 'registryDir'>; runCcd: Deps['runCcd'];
    fleetState?: FleetState; presence?: Pick<Presence, 'isVisible'>;
    lane: CollectLanePort; observeIntervalMs: number;     // COLLECT_OBSERVE_INTERVAL_MS, watch.ts's
  }
  export interface CollectJob { readonly id: string }
  export interface CollectHeld { readonly kind: 'held'; readonly why: CollectHoldWhy; readonly detail: string }
  export type CollectHoldRead = { readonly kind: 'clear' } | CollectHeld;
  export type CollectAnsweredWhy =
    | 'stale' | 'not-collectable' | 'not-licensed' | 'paused' | 'marker-flip' | 'pair-cleared' | 'presence' | 'caps';
  export type CollectJobOutcome =
    | { readonly kind: 'not-asked'; readonly step: 1 | 2 | 3 | 4; readonly why: 'caps' | 'id-refused' | 'paused' | 'presence'; readonly detail: string }
    | { readonly kind: 'answered'; readonly step: 4 | 5 | 6; readonly why: CollectAnsweredWhy; readonly detail: string; readonly audit: CollectAnswer<CollectAudit> }
    | { readonly kind: 'held'; readonly step: 4 | 6; readonly hold: CollectHeld; readonly audit: CollectAnswer<CollectAuditCollectable> }
    | { readonly kind: 'would-collect'; readonly audit: CollectAnswer<CollectAuditCollectable> }
    | { readonly kind: 'acted'; readonly audit: CollectAnswer<CollectAuditCollectable>; readonly composedMono: number;
        readonly result: CollectResult; readonly arrived: CollectClock };
  export type CollectLearnAnswer =
    | { readonly kind: 'not-asked'; readonly why: 'caps' }
    | { readonly kind: 'answered'; readonly audit: CollectAnswer<CollectAudit> };
  export function readCollectPopulation(io: Pick<FleetIO, 'lstatMeasured' | 'readdir' | 'statMeasured'>, registryDir: string):
    Promise<{ tmproots: CollectListing; tmpquarantine: CollectListing }>;
  export function collectSwitches(io: Pick<FleetIO, 'readdir'>, registryDir: string): Promise<{ paused: boolean; live: boolean }>;
  export function learnCollect(deps: Pick<CollectTempRootDeps, 'runCcd' | 'fleetState' | 'lane'>, id: string): Promise<CollectLearnAnswer>;
  export function collectOpenRunHold(coord: CollectTempRootDeps['coord'], id: string,
    doc: Pick<CollectAuditCollectable, 'resume' | 'witnessRun' | 'witnessAt'>): CollectHoldRead;
  export function collectTempRoot(deps: CollectTempRootDeps, job: CollectJob): Promise<CollectJobOutcome>;
  /** mail-routes.test.ts's SIXTEENTH union (P9): every kebab word this file spells, derived from its tables and
   *  L1's COLLECT_HOLD_WHYS, never a list. */
  export function isCollectExecutorKebab(v: string): boolean;

  // server/test/collectTempRootFixture.ts
  export const ID: string; export const TOK: CollectToken; export const TOK2: CollectToken;
  export const INTERVAL: number; export const T0: number; export const WALL0: number;
  export const FULL_CAPS: readonly string[]; export const RIPE: CollectObservation;
  export interface Witness { readonly run: string; readonly at: string }
  export const auditDoc: (o?: { id?; verdict?; token?; witness?: Witness | null; resume?; unmeasured?; idleAt? }) => string;
  export const collectedDoc: (id?: string) => string;
  export const openedAtOf: (coord: CoordStore, id: number) => number;
  export interface FakeLane { port; clears; flips; advance(ms); clearAll(); resetId(id); seed(obs) }
  export const fakeLane: (o: { obs1; lastSeenLive }) => FakeLane;
  export interface RigOpts { caps?; live?; lastSeenLive?; paused?; obs1?; witness?; resume?; coord? }
  export const rig: (o?: RigOpts) => { reg; coord; deps; state; lane; hooks; attempts; witness; minting; openRun; closeRun;
    see; raise; lower; answerAudit; answerAct };
  export type Rig = ReturnType<typeof rig>;
  ```

**What each outcome tells the lane.** Task 7 folds the outcome; this executor decides none of it. Only `acted` composed the verb.

| Outcome | Slot (R85) | What the lane folds (R87, through Task 4's transitions) |
|---|---|---|
| `not-asked` `caps`, any step | freed | nothing more: the port's `cleared('caps')` already cleared the pairs |
| `not-asked` `id-refused` | freed | nothing (the population never offers such an id) |
| `not-asked` `paused` | freed | nothing more: `cleared('paused')` already ran |
| `not-asked` `presence` | freed | the presence defer: resets the pair, presence count, continuity clock; the next ask waits `childReclaimBackoffMs` over presence's own count (R87) |
| `answered` `stale` / `pair-cleared` / `paused` / `marker-flip` / `caps` | freed | the answer's `composed` no longer matches, so it paces the id but is never an observation (Task 4's `a-stale-answer-paces-but-never-observes`) |
| `answered` `not-collectable` | freed | the answer, through `collectAfterAudit`: `not-witnessed` clears the three runs and advances the deferral count; `unreadable` and an unknown verdict advance the FAILING run (R87) |
| `answered` `not-licensed` | freed | the answer, an observation (the pair starts or continues) |
| `answered` `presence` (step 6) | freed | the answer, then the presence defer |
| `held` | freed | the hold (`collectAfterHold`): the pair cleared and the hold's continuity clock; the next ask waits `CHILD_RECLAIM_DEFER_CEILING_MS` flat, with no count (R87, H1) |
| `would-collect` | freed | shadow pacing: the pair cleared, the ceiling floor, one feed row per (id, token) episode |
| `acted`, result is a document or `die` | freed | `collectAfterAct`: a refusal or failure whose word is terminal advances the TERMINAL run ahead of the refusal and verb-failed rows; a `refused not-witnessed` clears the three runs and advances the deferral count, plus the refusal floor (H7); an arm-1 die other than `flock-unavailable` takes the refusal floor, and its recurrence past the ceiling is attention; a `die` of `flock-unavailable` latches (R87, H1) |
| `acted`, result `no-document` | KEPT until `composedMono + CHILD_RECLAIM_STALL_MS` | `collectAfterAct` (the VERB-FAILED run); the next act on the id is a fresh audit |

- [ ] **Step 0: Measure the entry conditions (nothing is written)**

```bash
grep -n "export const TMPROOT_ID_MAX_CHARS\|export function isTmpRootId\|export type CollectToken\|collectTokenBrand" shared/api.ts
grep -n "  wsCollect: (token: CollectToken" server/src/ccdargv.ts
grep -n "export const COLLECT_LANE_LIVE_MARKER\|export function parseCollectAudit\|export function parseCollectResult\|export type CollectAudit\b\|export type CollectResult\b\|export type CollectListing\b" server/src/collectLane.ts
grep -n "CollectObservation\b\|export interface CollectCapture\|export function collectLicence\b\|collectLicenceStands\|export type CollectHoldWhy" server/src/collectLane.ts
grep -n "'run-after-witness'\|'id-in-open-run'\|'no-witness-run'" server/src/collectLane.ts   # Task 4's hold words
grep -n "from '" server/src/collectLane.ts          # exactly '../../shared/api.js' and './childReclaimSweep.js' (H2)
grep -n "Composed by NOTHING in this build\|Nothing reads it in" server/src/ccdargv.ts   # 2 lines; Step 4 (d) rewrites them
ls server/src/coord/collectTempRoot.ts 2>/dev/null || echo "absent, as expected"
grep -n "^const CAP_GATED_VERBS" -A 2 server/test/verb-gate.test.ts         # no 'ws-collect' yet
grep -n "a reference to either builder\|declared, read by nothing" server/test/ws-collect-wiring.test.ts   # both still ['ccdargv.ts']
grep -n "code === 'run-open' ?" server/test/single-definition.test.ts   # Task 4's excusal: ['server/src/collectLane.ts', 'shared/api.ts'] (P8)
grep -n "|| isDeadCoordinatorKebab(tok),\|isCollectExecutorKebab" server/test/mail-routes.test.ts   # one line: the chain's last arm (P9)
grep -n "export const COLLECT_HOLD_WHYS" server/src/collectLane.ts   # Task 4's, read by the guard (P9)
```

Expected: each fixed name is found once at its home, and `collectTempRoot.ts` is absent.

STOP rules:
- If `collectLicence`, `collectLicenceStands`, `CollectCapture`, `CollectObservation` or `CollectHoldWhy` is absent, or `collectLicenceStands` still takes Task 4's draft shape `(first, cap, laneGen, e)` rather than `(first, composed, now, obs)`, STOP: Task 4 did not land H3's names. The code here calls the licence, the re-read and the hold vocabulary in exactly one place each.
- If `collectLane.ts` imports any specifier but `'../../shared/api.js'` and `'./childReclaimSweep.js'`, STOP: L1 is broken upstream (H2).
- If `wsCollect`'s first parameter is still `string`, STOP: Task 1 is not on the branch.
- If `single-definition.test.ts` has no `code === 'run-open' ?` excusal naming `server/src/collectLane.ts`, STOP: Task 4 did not land P8's in-place edit, and its commit is already red. If `mail-routes.test.ts`'s chain does not end at `|| isDeadCoordinatorKebab(tok),`, re-read it before Step 4 (e) and append the new arm after whatever arm is last.

- [ ] **Step 1: Write the shared fixture**

Create `server/test/collectTempRootFixture.ts`:

```ts
// Child reclamation wave 9 (spec §5.10): what the collector executor's three case files share:
// `collect-temp-root.test.ts`, `collect-temp-root-reads.test.ts` and `collect-open-run-hold.test.ts`. A ccd SCRIPT
// behind the agent's REAL exec whitelist (`testDeps`), a registry and a coordination store under a fixture HOME, and a
// FAKE of the lane's memory port, which `watch.ts` implements for real. Every argv the executor composes is recorded at
// `runCcd`, BEFORE the whitelist, so an argv the whitelist would refuse is still seen. FIXTURE HOME ONLY: every path
// derives from `mkTmp`, and nothing here reaches a box.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { ACTOR_FLAGS_CAP, COLLECT_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { COLLECT_LANE_LIVE_MARKER, type CollectObservation } from '../src/collectLane.js';
import type { CollectLanePort, CollectTempRootDeps } from '../src/coord/collectTempRoot.js';
import type { FleetIO } from '../src/io.js';
import type { FleetState } from '../src/fleetstate.js';
import type { ExecResult, Runner } from '../src/exec.js';
import type { CollectToken } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

export const ID = 'demo-quiet-tarn';
/** Test-only casts: in `server/src`, the collect audit reader alone mints a `CollectToken`. */
export const TOK = 'c'.repeat(64) as CollectToken;
export const TOK2 = 'd'.repeat(64) as CollectToken;
/** The lane's `COLLECT_OBSERVE_INTERVAL_MS` as the executor receives it: an argument, never imported from `watch.ts`. */
export const INTERVAL = 60_000;
/** The fake lane's monotonic clock when a case starts, and the wall clock it pairs with. */
export const T0 = 5_000_000;
export const WALL0 = 1_790_000_000_000;
/** Every verb and capability the executor asks for, as `ccd caps` lists them. */
export const FULL_CAPS: readonly string[] = ['ws-audit', 'ws-collect', COLLECT_CAP, RECLAIM_PAUSE_CAP, ACTOR_FLAGS_CAP];
/** Observation 1, ripe: the token, exactly one interval before the clock. */
export const RIPE: CollectObservation = { token: TOK, arrivedMono: T0 - INTERVAL };

/** The two witness fields the server reads, as ccd prints them: JSON strings. */
export interface Witness { readonly run: string; readonly at: string }

/** `ws-audit --collect`'s document as ccd's audit printer writes it: `resume` only on a resume, `token` only when
 *  collectable, the witness's fields as strings. */
export const auditDoc = (o: {
  readonly id?: string; readonly verdict?: string; readonly token?: string; readonly witness?: Witness | null;
  readonly resume?: string; readonly unmeasured?: string | null; readonly idleAt?: number | null;
} = {}): string => {
  const id = o.id ?? ID;
  const verdict = o.verdict ?? 'collectable';
  const witness = o.witness === undefined || o.witness === null ? null
    : { dev: '64769', ino: '4242', btime: '1789000000', run: o.witness.run, at: o.witness.at };
  return JSON.stringify({
    session: id, mode: 'collect', exists: true,
    collect: { leaf: `/fixture-home/.cc-tmp/${id}`, witness, records: [], newestCtimeNs: '1789000000000000000',
      entries: 3, floorS: 86400, idleAt: o.idleAt ?? null, unmeasured: o.unmeasured ?? null },
    ...(o.resume === undefined ? {} : { resume: o.resume }),
    verdict, detail: verdict === 'collectable' ? '' : `ccd's detail for ${verdict}`,
    ...(verdict === 'collectable' ? { token: o.token ?? TOK } : {}),
  });
};

/** The verb's DONE document for a fresh collection of a present leaf. */
export const collectedDoc = (id: string = ID): string =>
  JSON.stringify({ collected: id, record: `${id}.1790000000000000000.4242`, resumed: false, witness: 'dropped' });

export const openedAtOf = (coord: CoordStore, id: number): number => {
  const read = coord.run(id);
  if (!read.ok || read.run === null) throw new Error(`run ${id} could not be read`);
  return read.run.openedAt;
};

/** The lane's memory port, faked: observation 1, both clear generations, the last-seen-live flag and the two clocks.
 *  `watch.ts` implements the real one over the lane's L1 state. These cases pin the executor against it. */
export interface FakeLane {
  readonly port: CollectLanePort;
  /** Every lane-wide clear the executor reported, in order. */
  readonly clears: string[];
  /** Every flip the executor saw: the marker as it read it. */
  readonly flips: boolean[];
  advance(ms: number): void;
  /** What a pass does on a lane-wide clear (a pause it saw, a pass that failed shut): every pair goes. */
  clearAll(): void;
  /** What any reset of one id's pair does: the pair goes, and the id's generation moves. */
  resetId(id: string): void;
  /** Put observation 1 in place, with no generation moving. */
  seed(obs: CollectObservation | null): void;
}

export const fakeLane = (o: { readonly obs1: CollectObservation | null; readonly lastSeenLive: boolean }): FakeLane => {
  let mono = T0;
  let laneGen = 0;
  const idGen = new Map<string, number>();
  let obs = o.obs1;
  let lastSeenLive = o.lastSeenLive;
  const clears: string[] = [];
  const flips: boolean[] = [];
  const clearAll = (): void => { laneGen += 1; obs = null; };
  return {
    port: {
      clock: () => ({ mono, wall: WALL0 + mono }),
      generations: (id: string) => ({ lane: laneGen, id: idGen.get(id) ?? 0 }),
      observation: () => obs,
      cleared: (why: 'paused' | 'caps') => { clears.push(why); clearAll(); },
      flipped: (live: boolean) => {
        if (live === lastSeenLive) return false;
        lastSeenLive = live;
        flips.push(live);
        clearAll();
        return true;
      },
    },
    clears, flips,
    advance: (ms: number) => { mono += ms; },
    clearAll,
    resetId: (id: string) => { idGen.set(id, (idGen.get(id) ?? 0) + 1); obs = null; },
    seed: (next: CollectObservation | null) => { obs = next; },
  };
};

export interface RigOpts {
  /** `ccd caps` as the agent advertised it; `null` is no list at all. Default `FULL_CAPS`. */
  readonly caps?: readonly string[] | null;
  /** `collect-lane-live` stands in the registry. Default true. */
  readonly live?: boolean;
  /** The lane's last-seen-live flag. Default: what `live` says, so no flip unless a case asks for one. */
  readonly lastSeenLive?: boolean;
  /** `reclaim-paused` stands. */
  readonly paused?: boolean;
  /** Observation 1 in the lane's memory. Default `RIPE`. */
  readonly obs1?: CollectObservation | null;
  /** The witness the audit prints, given the minting run; `null` prints none. Default: the minting run, 1 s after it
   *  opened. */
  readonly witness?: ((minting: { readonly id: number; readonly openedAt: number }) => Witness) | null;
  /** A resume document: the quarantine phase the audit prints. */
  readonly resume?: string;
  /** Wraps the store the executor reads, for a read that fails. */
  readonly coord?: (real: CoordStore) => CollectTempRootDeps['coord'];
}

export const rig = (o: RigOpts = {}) => {
  const home = mkTmp('ccrc-collect-temp-root-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  let programs = 0;
  const openRun = (over: { readonly sessionId?: string; readonly claimedBy?: string } = {}): { id: number; program: string } => {
    const program = `w9-collect-${++programs}`;
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null,
      claimedBy: over.claimedBy ?? 'demo-coord' });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    if (over.sessionId !== undefined) coord.bindSession(r.id, over.sessionId);
    return { id: r.id, program };
  };
  const closeRun = (r: { id: number; program: string }): void => {
    const res = coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'test', handoffCommit: null,
      program: r.program, viaClosing: false });
    if (!res.ok) throw new Error(`closeRun refused: ${JSON.stringify(res)}`);
  };
  // THE MINTING RUN: finished, and opened before its witness was written.
  const minting = openRun();
  closeRun(minting);
  const witnessOf = o.witness === undefined
    ? (m: { readonly id: number; readonly openedAt: number }): Witness => ({ run: String(m.id), at: String(m.openedAt + 1_000) })
    : o.witness;
  const witness = witnessOf === null ? null : witnessOf({ id: minting.id, openedAt: openedAtOf(coord, minting.id) });
  if (o.live !== false) writeFileSync(path.join(reg, COLLECT_LANE_LIVE_MARKER), '');
  if (o.paused === true) writeFileSync(path.join(reg, RECLAIM_PAUSE_MARKER), '');
  const state: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
    ccdVerbs: o.caps === undefined ? [...FULL_CAPS] : o.caps === null ? null : [...o.caps] };
  /** Moments inside the executor's awaits where a case changes the world: inside the audit, inside the act, and
   *  inside the Nth registry listing (1 is step 2's, 2 is step 5's), which may also answer `null` or reject. */
  const hooks: { audit?: () => void; act?: () => void; listing?: (n: number) => 'null' | 'reject' | void } = {};
  let auditAnswer = (): ExecResult => ({ code: 0, stdout: auditDoc({ witness, resume: o.resume }), stderr: '' });
  let actAnswer = (): ExecResult => ({ code: 0, stdout: collectedDoc(), stderr: '' });
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'ws-audit') { hooks.audit?.(); return auditAnswer(); }
    if (args[0] === 'ws-collect') { hooks.act?.(); return actAnswer(); }
    return { code: 1, stdout: '', stderr: `unscripted ${args[0] ?? ''}` };
  };
  const base = testDeps(home, run);
  let listings = 0;
  const io: FleetIO = {
    ...base.io,
    readdir: async (p: string, timeoutMs?: number, signal?: AbortSignal) => {
      if (p !== reg) return base.io.readdir(p, timeoutMs, signal);
      listings += 1;
      const what = hooks.listing?.(listings);
      if (what === 'reject') throw new Error('EIO: the registry listing failed');
      if (what === 'null') return null;
      return base.io.readdir(p, timeoutMs, signal);
    },
  };
  const lane = fakeLane({ obs1: o.obs1 === undefined ? RIPE : o.obs1, lastSeenLive: o.lastSeenLive ?? (o.live !== false) });
  let visible = false;
  const attempts: string[][] = [];
  const deps: CollectTempRootDeps = {
    coord: o.coord?.(coord) ?? coord, io, cfg: base.cfg, fleetState: state,
    runCcd: async (argv) => { attempts.push([...argv]); return base.runCcd(argv); },
    presence: { isVisible: (id: string) => visible && id === ID },
    lane: lane.port, observeIntervalMs: INTERVAL,
  };
  return {
    reg, coord, deps, state, lane, hooks, attempts, witness, minting, openRun, closeRun,
    see: (v: boolean): void => { visible = v; },
    raise: (name: string): void => { writeFileSync(path.join(reg, name), ''); },
    lower: (name: string): void => { rmSync(path.join(reg, name), { force: true }); },
    answerAudit: (f: () => ExecResult): void => { auditAnswer = f; },
    answerAct: (f: () => ExecResult): void => { actAnswer = f; },
  };
};
export type Rig = ReturnType<typeof rig>;
```

- [ ] **Step 2: Write the failing tests**

Create `server/test/collect-temp-root.test.ts`:

```ts
// Child reclamation wave 9 (spec §5.10): the temp-root collector's ONE executor, `collectTempRoot`, case by case at each
// of its six steps. A scripted ccd answers behind the agent's real exec whitelist, and the lane's memory is a fake of
// its port. Every case is a SAFETY case. The collector's verb is composed only when all of these hold:
//   - the box advertises both capabilities, and the id passes the predicate;
//   - nothing is paused and nobody is looking;
//   - two observations carry observation 2's own token, at least an interval apart;
//   - no open run holds the id;
//   - each of those is re-read with no await between the re-read and the argv;
//   - the lane is live.
// The lane's start hold-off is asked at its offer (Task 7's collectOffers), never by this job (H4).
// FIXTURE HOME ONLY.
import { describe, it, expect } from 'vitest';
import { COLLECT_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { COLLECT_LANE_LIVE_MARKER, type CollectObservation } from '../src/collectLane.js';
import { CHILD_BIRTH_SKEW_MS } from '../src/coord/childSpent.js';
import { collectTempRoot } from '../src/coord/collectTempRoot.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import type { OpenSiblingsResult } from '../src/coord/store.js';
import type { CollectToken } from '../../shared/api.js';
import { FULL_CAPS, ID, INTERVAL, RIPE, T0, TOK, TOK2, auditDoc, rig } from './collectTempRootFixture.js';

const job = { id: ID };
const AUDIT = ['ws-audit', '--session', ID, '--collect'];
const actOf = (token: string): string[] =>
  ['ws-collect', '--expect', token, '--session', ID, '--surface', 'agent', '--actor', 'collect sweep'];
const without = (cap: string): string[] => FULL_CAPS.filter((c) => c !== cap);

describe('the live act, end to end: the control every stop below is measured against', () => {
  it('two observations an interval apart, nobody looking, no open run: audits, then spends observation 2’s token on the job’s id', async () => {
    const r = rig();
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'acted', composedMono: T0, result: { kind: 'collected' } });
    expect(r.attempts).toEqual([AUDIT, actOf(TOK)]);
    expect(r.attempts[1], 'never --defer-expired').not.toContain('--defer-expired');
    expect(r.lane.clears, 'no lane-wide clear').toEqual([]);
  });

  it('the token on the argv is the one observation 2’s document carries', async () => {
    const T = 'e'.repeat(64) as CollectToken;
    const r = rig({ obs1: { token: T, arrivedMono: T0 - INTERVAL } });
    r.answerAudit(() => ({ code: 0, stdout: auditDoc({ witness: r.witness, token: T }), stderr: '' }));
    await collectTempRoot(r.deps, job);
    expect(r.attempts[1]).toEqual(actOf(T));
  });

  it('observation 2 arrives when its answer arrives: an audit that took 5 ms licenses an observation 1 that was 5 ms short when the audit was composed', async () => {
    const r = rig({ obs1: { token: TOK, arrivedMono: T0 - INTERVAL + 5 } });
    r.hooks.audit = () => { r.lane.advance(5); };
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'acted', composedMono: T0 + 5 });
  });

  it.each(['empty', 'reject'] as const)('an act answering no document (%s) is reported with the instant it was composed', async (how) => {
    const r = rig();
    r.hooks.act = () => { r.lane.advance(9); };
    r.answerAct(() => {
      if (how === 'reject') throw new Error('the agent link closed');
      return { code: 1, stdout: '', stderr: '' };
    });
    expect(await collectTempRoot(r.deps, job))
      .toMatchObject({ kind: 'acted', composedMono: T0, result: { kind: 'no-document' }, arrived: { mono: T0 + 9 } });
  });
});

describe('step 1 — both capabilities, then the id predicate on the job’s own id', () => {
  it.each<[string, readonly string[] | null]>([
    ['no collect-v1', without(COLLECT_CAP)],
    ['no reclaim-pause-v1, a box the phone cannot pause', without(RECLAIM_PAUSE_CAP)],
    ['no caps list at all, no evidence', null],
  ])('%s: nothing is asked of the box, and the lane clears every pair', async (_what, caps) => {
    const r = rig({ caps });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'not-asked', step: 1, why: 'caps' });
    expect(r.attempts).toEqual([]);
    expect(r.lane.clears).toEqual(['caps']);
  });

  it.each(['--actor', '--surface', '--reason', '--expect', '--session', '--', '-h', '-x', '.hidden', 'x'.repeat(256)])(
    'the id %s is refused before any argv: no audit, no act', async (id) => {
      const r = rig();
      expect(await collectTempRoot(r.deps, { id })).toMatchObject({ kind: 'not-asked', step: 1, why: 'id-refused' });
      expect(r.attempts).toEqual([]);
    });

  it.each(['a--actor', 'a.--actor', 'x'.repeat(255)])('the id %s passes the predicate and is audited as itself', async (id) => {
    const r = rig();
    await collectTempRoot(r.deps, { id });
    expect(r.attempts[0]).toEqual(['ws-audit', '--session', id, '--collect']);
  });
});

describe('step 2 — the switch, from one listing, at the job’s start', () => {
  it('reclaim-paused stops it before ccd is asked anything, shadow included, and the lane clears every pair', async () => {
    for (const live of [true, false]) {
      const r = rig({ paused: true, live });
      expect(await collectTempRoot(r.deps, job), `live: ${String(live)}`).toMatchObject({ kind: 'not-asked', step: 2, why: 'paused' });
      expect(r.attempts).toEqual([]);
      expect(r.lane.clears).toEqual(['paused']);
    }
  });

  it.each(['null', 'reject'] as const)('a registry listing that answers %s cannot rule a pause out: paused, nothing asked', async (how) => {
    const r = rig();
    r.hooks.listing = (n) => (n === 1 ? how : undefined);
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'not-asked', step: 2, why: 'paused' });
    expect(r.attempts).toEqual([]);
  });
});

describe('step 3 — a person at the session', () => {
  it('defers it before any argv, with no ceiling and no licence past it', async () => {
    const r = rig();
    r.see(true);
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'not-asked', step: 3, why: 'presence' });
    expect(r.attempts).toEqual([]);
  });
});

describe('step 4 — observation 2 against observation 1', () => {
  it('a box that cannot answer ws-audit asks nothing, and the lane clears every pair', async () => {
    const r = rig({ caps: without('ws-audit') });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'not-asked', step: 4, why: 'caps' });
    expect(r.attempts).toEqual([]);
    expect(r.lane.clears).toEqual(['caps']);
  });

  it.each([
    ['changed-recently', 'verdict', 0, { verdict: 'changed-recently', idleAt: 1_790_000_100 }],
    ['an unmeasured probe', 'unmeasured', 1, { verdict: 'unmeasured', unmeasured: 'checkouts' }],
  ] as const)('%s is reported for the lane to fold, and nothing is composed', async (_what, kind, code, over) => {
    const r = rig();
    r.answerAudit(() => ({ code, stdout: auditDoc({ witness: r.witness, ...over }), stderr: '' }));
    expect(await collectTempRoot(r.deps, job))
      .toMatchObject({ kind: 'answered', step: 4, why: 'not-collectable', audit: { value: { kind } } });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it.each(['empty', 'reject'] as const)('an audit with no document (%s) is reported as such, never a throw: the runner rejects or answers nothing', async (how) => {
    const r = rig();
    r.answerAudit(() => {
      if (how === 'reject') throw new Error('the runner was killed');
      return { code: 1, stdout: '', stderr: '' };
    });
    expect(await collectTempRoot(r.deps, job))
      .toMatchObject({ kind: 'answered', step: 4, why: 'not-collectable', audit: { value: { kind: 'no-document' } } });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it.each<[string, CollectObservation | null]>([
    ['no observation 1 stands (a restart, a clear)', null],
    ['observation 1 carries another token', { token: TOK2, arrivedMono: T0 - INTERVAL }],
    ['observation 1 arrived less than the interval before observation 2', { token: TOK, arrivedMono: T0 - INTERVAL + 1 }],
  ])('%s: not licensed, and the collector’s verb is never composed', async (_what, obs1) => {
    const r = rig({ obs1 });
    expect(await collectTempRoot(r.deps, job))
      .toMatchObject({ kind: 'answered', step: 4, why: 'not-licensed', audit: { value: { kind: 'collectable', token: TOK } } });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('exactly the interval is licensed (the boundary)', async () => {
    const r = rig({ obs1: { token: TOK, arrivedMono: T0 - INTERVAL } });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'acted' });
  });

  it('a clear that lands while observation 2 is in flight makes it stale: no observation, nothing composed, even if a pair stands again when it arrives', async () => {
    for (const clear of ['lane', 'id'] as const) {
      const r = rig();
      r.hooks.audit = () => {
        if (clear === 'lane') r.lane.clearAll(); else r.lane.resetId(ID);
        r.lane.seed(RIPE);
      };
      expect(await collectTempRoot(r.deps, job), clear).toMatchObject({ kind: 'answered', step: 4, why: 'stale' });
      expect(r.attempts, clear).toEqual([AUDIT]);
    }
  });
});

describe('step 4 — the open-run hold, judged on observation 2’s document', () => {
  it('a run bound to the id DURING the audit holds it at step 4, and nothing is composed', async () => {
    const r = rig();
    r.hooks.audit = () => { r.openRun({ sessionId: ID }); };
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'held', step: 4, hold: { why: 'id-in-open-run' } });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('the hold is judged on every collectable observation 2, licensed or not, so a held id never seeds a pair', async () => {
    const r = rig({ obs1: null });
    r.openRun({ sessionId: ID });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'held', step: 4, hold: { why: 'id-in-open-run' } });
  });

  it('an absent run holds it: a lost or rebuilt database makes every run absent at once', async () => {
    const r = rig({ witness: () => ({ run: '987654', at: String(Date.now()) }) });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'held', step: 4, hold: { why: 'run-absent' } });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('a re-bound child: an open run naming the id, which is not the witness’s run, holds it', async () => {
    const r = rig();
    r.openRun({ sessionId: ID });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'held', step: 4, hold: { why: 'id-in-open-run' } });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('a reused run id: a witness run opened after the witness’s instant plus the skew holds it (the birth fence)', async () => {
    const r = rig({ witness: (m) => ({ run: String(m.id), at: String(m.openedAt - CHILD_BIRTH_SKEW_MS - 1) }) });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'held', step: 4, hold: { why: 'run-after-witness' } });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('a FRESH collectable document with no witness holds it', async () => {
    const r = rig({ witness: null });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'held', step: 4, hold: { why: 'no-witness-run' } });
  });

  it('a resume document with no witness is held by an open run naming the id, and by nothing else', async () => {
    const held = rig({ witness: null, resume: 'moved' });
    held.openRun({ sessionId: ID });
    expect(await collectTempRoot(held.deps, job)).toMatchObject({ kind: 'held', step: 4, hold: { why: 'id-in-open-run' } });
    const free = rig({ witness: null, resume: 'moved' });
    expect(await collectTempRoot(free.deps, job), 'it finishes an act begun under these gates').toMatchObject({ kind: 'acted' });
  });

  it('an unreadable store holds it', async () => {
    const r = rig({ coord: (real) => ({
      run: (id: number) => real.run(id),
      openRunsClaimedBy: (id: string) => real.openRunsClaimedBy(id),
      openRunsForSession: (): OpenSiblingsResult => ({ ok: false, kind: 'run-unreadable', detail: 'the runs table could not be read' }),
    }) });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'held', step: 4, hold: { why: 'store-unreadable' } });
    expect(r.attempts).toEqual([AUDIT]);
  });
});

describe('step 5 — the switches once more, with the live marker: the job’s last await', () => {
  it('a pause raised during the audit stops it, and the lane clears every pair', async () => {
    const r = rig();
    r.hooks.audit = () => { r.raise(RECLAIM_PAUSE_MARKER); };
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'answered', step: 5, why: 'paused' });
    expect(r.attempts).toEqual([AUDIT]);
    expect(r.lane.clears).toEqual(['paused']);
  });

  it('a registry that does not list at the last await stops it as a pause, and is never read as a flip to shadowed', async () => {
    const r = rig();
    r.hooks.listing = (n) => (n === 2 ? 'null' : undefined);
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'answered', step: 5, why: 'paused' });
    expect(r.lane.flips).toEqual([]);
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('the marker removed during the audit: the lane flips to shadowed, and nothing is composed', async () => {
    const r = rig();
    r.hooks.audit = () => { r.lower(COLLECT_LANE_LIVE_MARKER); };
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'answered', step: 5, why: 'marker-flip' });
    expect(r.lane.flips).toEqual([false]);
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('the marker touched during the audit: the lane flips to live, and THIS job composes nothing', async () => {
    const r = rig({ live: false });
    r.hooks.audit = () => { r.raise(COLLECT_LANE_LIVE_MARKER); };
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'answered', step: 5, why: 'marker-flip' });
    expect(r.lane.flips).toEqual([true]);
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('a lane constructed with the marker standing sees a flip on its first job and composes nothing; its first act rests on observations seeded after the flip', async () => {
    const r = rig({ live: true, lastSeenLive: false });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'answered', step: 5, why: 'marker-flip' });
    expect(r.lane.flips).toEqual([true]);
    expect(r.attempts).toEqual([AUDIT]);
    expect(r.deps.lane.observation(ID), 'the flip cleared every pair').toBeNull();
    r.lane.seed(RIPE);
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'acted' });
    expect(r.attempts).toEqual([AUDIT, AUDIT, actOf(TOK)]);
  });
});

describe('step 6 — synchronous from the last await to the argv', () => {
  it('a pair cleared during the last await (a pass that saw a pause, or failed shut) composes nothing, even re-seeded', async () => {
    for (const [clear, reseed] of [['lane', false], ['lane', true], ['id', false], ['id', true]] as const) {
      const r = rig();
      r.hooks.listing = (n) => {
        if (n !== 2) return;
        if (clear === 'lane') r.lane.clearAll(); else r.lane.resetId(ID);
        if (reseed) r.lane.seed(RIPE);
      };
      expect(await collectTempRoot(r.deps, job), `${clear} ${String(reseed)}`)
        .toMatchObject({ kind: 'answered', step: 6, why: 'pair-cleared' });
      expect(r.attempts).toEqual([AUDIT]);
    }
  });

  it('observation 1 replaced during the last await, by another token or another arrival, composes nothing', async () => {
    for (const next of [{ token: TOK2, arrivedMono: T0 - INTERVAL }, { token: TOK, arrivedMono: T0 - INTERVAL - 1 }]) {
      const r = rig();
      r.hooks.listing = (n) => { if (n === 2) r.lane.seed(next); };
      expect(await collectTempRoot(r.deps, job), JSON.stringify(next)).toMatchObject({ kind: 'answered', step: 6, why: 'pair-cleared' });
    }
  });

  it('presence that appears during the last await composes nothing', async () => {
    const r = rig();
    r.hooks.listing = (n) => { if (n === 2) r.see(true); };
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'answered', step: 6, why: 'presence' });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('a run bound during the last await holds it: the hold’s store reads are made again at the act', async () => {
    for (const over of [{ sessionId: ID }, { claimedBy: ID }]) {
      const r = rig();
      r.hooks.listing = (n) => { if (n === 2) r.openRun(over); };
      expect(await collectTempRoot(r.deps, job), JSON.stringify(over))
        .toMatchObject({ kind: 'held', step: 6, hold: { why: 'id-in-open-run' } });
      expect(r.attempts).toEqual([AUDIT]);
    }
  });

  it('collect-v1 withdrawn during the last await: the capability asked again in the act’s own scope composes nothing', async () => {
    const r = rig();
    r.hooks.listing = (n) => { if (n === 2) r.state.ccdVerbs = without(COLLECT_CAP); };
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'answered', step: 6, why: 'caps' });
    expect(r.attempts).toEqual([AUDIT]);
    expect(r.lane.clears).toEqual(['caps']);
  });

  it('SHADOW: no marker, and the lane has seen none: every gate passes, it would collect, and the collector’s verb is never composed', async () => {
    const r = rig({ live: false });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'would-collect', audit: { value: { kind: 'collectable', token: TOK } } });
    expect(r.attempts).toEqual([AUDIT]);
    expect(r.lane.flips).toEqual([]);
  });

  it('SHADOW re-reads at step 6 too: presence that appears during the last await stops a would-collect', async () => {
    const r = rig({ live: false });
    r.hooks.listing = (n) => { if (n === 2) r.see(true); };
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'answered', step: 6, why: 'presence' });
  });
});
```

Create `server/test/collect-temp-root-reads.test.ts`:

```ts
// Child reclamation wave 9 (spec §5.10): the collector's reads.
//   - `readCollectPopulation` lists `tmproots/` and `tmpquarantine/` exactly. It asks the path's own kind first. A
//     proven absence is an empty listing, with nothing listed. A link, a file or any failure makes THAT listing
//     unmeasured. A listing that comes back null is resolved by a stat.
//   - `collectSwitches` reads the pause and the live marker from one listing.
//   - `learnCollect` is the learning audit, through the one audit site.
// Fixture HOMEs on the real local io, and fakes where a fault cannot be built on disk. FIXTURE HOME ONLY.
import { describe, it, expect } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { ACTOR_FLAGS_CAP, COLLECT_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { COLLECT_LANE_LIVE_MARKER } from '../src/collectLane.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { collectSwitches, learnCollect, readCollectPopulation } from '../src/coord/collectTempRoot.js';
import { ID, T0, rig } from './collectTempRootFixture.js';
import { mkTmp } from './tmpHelpers.js';

const registry = (): string => {
  const reg = path.join(mkTmp('ccrc-collect-reads-'), '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  return reg;
};

type ListingIO = Pick<FleetIO, 'lstatMeasured' | 'readdir' | 'statMeasured'>;
/** The local io, each member replaceable, recording what was asked of which leaf. */
const counted = (over: Partial<ListingIO> = {}) => {
  const asked: string[] = [];
  const io: ListingIO = {
    lstatMeasured: async (p) => { asked.push(`lstat ${path.basename(p)}`); return (over.lstatMeasured ?? localIO.lstatMeasured)(p); },
    readdir: async (p, t, s) => { asked.push(`readdir ${path.basename(p)}`); return (over.readdir ?? localIO.readdir)(p, t, s); },
    statMeasured: async (p) => { asked.push(`stat ${path.basename(p)}`); return (over.statMeasured ?? localIO.statMeasured)(p); },
  };
  return { io, of: (verb: string): string[] => asked.filter((a) => a.startsWith(`${verb} `)) };
};

describe('readCollectPopulation — the two listings, read exactly', () => {
  it('both absent: two empty listings, and nothing is listed or stat-ed', async () => {
    const reg = registry();
    const c = counted();
    expect(await readCollectPopulation(c.io, reg)).toEqual({ tmproots: { kind: 'absent' }, tmpquarantine: { kind: 'absent' } });
    expect(c.of('readdir')).toEqual([]);
    expect(c.of('stat')).toEqual([]);
  });

  it('a directory lists every name as it stands, dot-leading ones included: the L1 population drops those', async () => {
    const reg = registry();
    mkdirSync(path.join(reg, 'tmproots'));
    for (const n of ['demo-a', '.demo-a.123.456.tmp', 'demo-b']) writeFileSync(path.join(reg, 'tmproots', n), '');
    mkdirSync(path.join(reg, 'tmpquarantine'));
    writeFileSync(path.join(reg, 'tmpquarantine', 'demo-c.1790000000000000000.4242'), '');
    const got = await readCollectPopulation(counted().io, reg);
    expect(got.tmproots.kind === 'listed' ? [...got.tmproots.names].sort() : got.tmproots)
      .toEqual(['.demo-a.123.456.tmp', 'demo-a', 'demo-b']);
    expect(got.tmpquarantine).toEqual({ kind: 'listed', names: ['demo-c.1790000000000000000.4242'] });
  });

  it('a symbolic link is never followed: that listing is unmeasured, nothing is listed through it, and the other listing stands', async () => {
    const reg = registry();
    mkdirSync(path.join(reg, 'elsewhere'));
    writeFileSync(path.join(reg, 'elsewhere', 'demo-a'), '');
    symlinkSync(path.join(reg, 'elsewhere'), path.join(reg, 'tmproots'));
    const c = counted();
    const got = await readCollectPopulation(c.io, reg);
    expect(got.tmproots.kind === 'unmeasured' ? got.tmproots.why : got.tmproots).toContain('symbolic link');
    expect(got.tmpquarantine).toEqual({ kind: 'absent' });
    expect(c.of('readdir')).toEqual([]);
  });

  it('a plain file is unmeasured, and says so', async () => {
    const reg = registry();
    writeFileSync(path.join(reg, 'tmproots'), '');
    const got = await readCollectPopulation(counted().io, reg);
    expect(got.tmproots.kind === 'unmeasured' ? got.tmproots.why : got.tmproots).toContain('plain file');
  });

  it.each<[string, ListingIO['lstatMeasured']]>([
    ['unreadable', async () => ({ ok: false, reason: 'unreadable' })],
    ['unmeasured, an agent too old to answer', async () => ({ ok: false, reason: 'unmeasured' })],
    ['a rejection', async () => { throw new Error('the agent link closed'); }],
  ])('an lstat that answers %s makes the listing unmeasured, never absent, and nothing is listed', async (_what, lstatMeasured) => {
    const c = counted({ lstatMeasured });
    const got = await readCollectPopulation(c.io, registry());
    expect(got.tmproots).toMatchObject({ kind: 'unmeasured' });
    expect(got.tmpquarantine).toMatchObject({ kind: 'unmeasured' });
    expect(c.of('readdir')).toEqual([]);
  });

  it('a directory whose listing comes back null and whose stat proves it absent (it went between the two reads) is empty', async () => {
    const reg = registry();
    mkdirSync(path.join(reg, 'tmproots'));
    const c = counted({ readdir: async () => null, statMeasured: async () => ({ ok: false, reason: 'absent' }) });
    expect((await readCollectPopulation(c.io, reg)).tmproots).toEqual({ kind: 'absent' });
  });

  it.each<[string, Partial<ListingIO>]>([
    ['a stat that answers, the shape of a FIFO, a socket or a device', { readdir: async () => null }],
    ['a stat that answers unreadable', { readdir: async () => null, statMeasured: async () => ({ ok: false, reason: 'unreadable' }) }],
    ['a listing that rejects', { readdir: async () => { throw new Error('EIO'); } }],
    ['a stat that rejects', { readdir: async () => null, statMeasured: async () => { throw new Error('EIO'); } }],
  ])('a null listing resolved by %s is unmeasured, never folded into absent', async (_what, over) => {
    const reg = registry();
    mkdirSync(path.join(reg, 'tmproots'));
    expect((await readCollectPopulation(counted(over).io, reg)).tmproots).toMatchObject({ kind: 'unmeasured' });
  });

  it('names that are not strings are dropped at the adapter, the only place that can see them', async () => {
    const reg = registry();
    mkdirSync(path.join(reg, 'tmproots'));
    const c = counted({ readdir: async () => ['demo-a', 7, null, 'demo-b'] as unknown as string[] });
    expect((await readCollectPopulation(c.io, reg)).tmproots).toEqual({ kind: 'listed', names: ['demo-a', 'demo-b'] });
  });
});

describe('collectSwitches — the pause and the live marker, from ONE listing', () => {
  it('reads each from the one listing', async () => {
    const reg = registry();
    expect(await collectSwitches(localIO, reg)).toEqual({ paused: false, live: false });
    writeFileSync(path.join(reg, COLLECT_LANE_LIVE_MARKER), '');
    expect(await collectSwitches(localIO, reg)).toEqual({ paused: false, live: true });
    writeFileSync(path.join(reg, RECLAIM_PAUSE_MARKER), '');
    expect(await collectSwitches(localIO, reg)).toEqual({ paused: true, live: true });
  });

  it.each<[string, FleetIO['readdir']]>([
    ['a listing that comes back null', async () => null],
    ['a listing that rejects', async () => { throw new Error('EIO'); }],
  ])('%s cannot rule a raised pause out: paused', async (_what, readdir) => {
    expect(await collectSwitches({ readdir }, registry())).toEqual({ paused: true, live: false });
  });
});

describe('learnCollect — the learning audit, through the one audit site', () => {
  it('asks the audit for the id, captures both generations as it composes, and stamps the answer as it arrives', async () => {
    const r = rig();
    r.hooks.audit = () => { r.lane.advance(7); r.lane.clearAll(); };
    const got = await learnCollect(r.deps, ID);
    expect(r.attempts).toEqual([['ws-audit', '--session', ID, '--collect']]);
    expect(got).toMatchObject({ kind: 'answered',
      audit: { value: { kind: 'collectable' }, composed: { lane: 0, id: 0 }, arrived: { mono: T0 + 7 } } });
    expect(r.deps.lane.generations(ID), 'the clear moved the lane generation after the audit was composed').toEqual({ lane: 1, id: 0 });
  });

  it.each<[string, readonly string[] | null]>([
    ['no collect-v1', ['ws-audit', 'ws-collect', RECLAIM_PAUSE_CAP, ACTOR_FLAGS_CAP]],
    ['no caps list at all', null],
    ['collect-v1 but no ws-audit', ['ws-collect', COLLECT_CAP, RECLAIM_PAUSE_CAP, ACTOR_FLAGS_CAP]],
  ])('%s: not asked, and nothing is composed', async (_what, caps) => {
    const r = rig({ caps });
    expect(await learnCollect(r.deps, ID)).toEqual({ kind: 'not-asked', why: 'caps' });
    expect(r.attempts).toEqual([]);
  });

  it('a runner that rejects is an answer with no document, never a throw', async () => {
    const r = rig();
    r.answerAudit(() => { throw new Error('the runner was killed'); });
    expect(await learnCollect(r.deps, ID)).toMatchObject({ kind: 'answered', audit: { value: { kind: 'no-document' } } });
  });
});
```

Create `server/test/collect-open-run-hold.test.ts`:

```ts
// Child reclamation wave 9 (spec §5.10): the open-run hold, `collectOpenRunHold`, judged on observation 2's document.
// The collector composes nothing for an id while any run could still need its temp root. The hold stands when:
//   - the witness's run is not finished;
//   - the witness's run is absent;
//   - the witness's run opened after the witness was written (run ids restart after a database loss);
//   - an open run names the id as its session or as its coordinator;
//   - a fresh collection carries no witness run;
//   - a read fails.
// A real CoordStore under a fixture HOME, and fakes for the failing reads.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type OpenSiblingsResult, type RunReadResult } from '../src/coord/store.js';
import { CHILD_BIRTH_SKEW_MS } from '../src/coord/childSpent.js';
import { collectOpenRunHold } from '../src/coord/collectTempRoot.js';
import { parseCollectAudit } from '../src/collectLane.js';
import { ID, auditDoc } from './collectTempRootFixture.js';
import { mkTmp } from './tmpHelpers.js';

const AT = 1_789_000_000_000;
type Doc = Parameters<typeof collectOpenRunHold>[2];
type HoldCoord = Parameters<typeof collectOpenRunHold>[0];
const fresh = (witnessRun: number | null, witnessAt: number | null): Doc => ({ resume: null, witnessRun, witnessAt });
const resumed = (witnessRun: number | null, witnessAt: number | null): Doc => ({ resume: 'moved', witnessRun, witnessAt });

const store = () => {
  const coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-collect-hold-'), '.ccrc', 'coord.db')));
  const programs = new Map<number, string>();
  const open = (o: { readonly sessionId?: string; readonly claimedBy?: string } = {}): number => {
    const program = `w9-hold-${programs.size + 1}`;
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy: o.claimedBy ?? 'demo-coord' });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    programs.set(r.id, program);
    if (o.sessionId !== undefined) coord.bindSession(r.id, o.sessionId);
    return r.id;
  };
  const close = (id: number): void => {
    const res = coord.closeRun({ runId: id, finalState: 'failed', causedBy: 'test', handoffCommit: null,
      program: programs.get(id)!, viaClosing: false });
    if (!res.ok) throw new Error(`closeRun refused: ${JSON.stringify(res)}`);
  };
  const setState = (id: number, state: string): void => { coord.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run(state, id); };
  const setOpenedAt = (id: number, ms: number): void => { coord.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(ms, id); };
  /** A finished minting run, opened at `openedAt`. */
  const minting = (openedAt = AT - 1_000): number => { const id = open(); close(id); setOpenedAt(id, openedAt); return id; };
  return { coord, open, close, setState, setOpenedAt, minting };
};

describe('what the hold keys on, as the collect audit reader hands it over', () => {
  it('no resume key reads null, a resume key reads its phase, a null witness reads no run and no instant, a witness reads both as numbers, and a witness whose run is no integer is unreadable', () => {
    const w = { run: '7', at: '1789000000000' };
    expect(parseCollectAudit(ID, true, auditDoc({ witness: w }), ''))
      .toMatchObject({ kind: 'collectable', resume: null, witnessRun: 7, witnessAt: 1_789_000_000_000 });
    expect(parseCollectAudit(ID, true, auditDoc({ witness: w, resume: 'moved' }), '')).toMatchObject({ kind: 'collectable', resume: 'moved' });
    expect(parseCollectAudit(ID, true, auditDoc({ witness: null }), '')).toMatchObject({ kind: 'collectable', witnessRun: null, witnessAt: null });
    expect(parseCollectAudit(ID, true, auditDoc({ witness: { run: 'x7', at: '1789000000000' } }), '').kind,
      'a witness run that is no canonical integer (H3)').toBe('unreadable');
  });
});

describe('collectOpenRunHold — clear only when no run could still need the temp root', () => {
  it('CONTROL: the witness’s run is finished, opened before its witness, and no open run names the id', () => {
    const s = store();
    const run = s.minting();
    expect(collectOpenRunHold(s.coord, ID, fresh(run, AT))).toEqual({ kind: 'clear' });
    expect(collectOpenRunHold(s.coord, ID, resumed(run, AT)), 'a resume whose witness still stands').toEqual({ kind: 'clear' });
  });

  it.each(['done', 'failed'])('a witness run in %s is finished', (state) => {
    const s = store();
    const run = s.minting();
    s.setState(run, state);
    expect(collectOpenRunHold(s.coord, ID, fresh(run, AT))).toEqual({ kind: 'clear' });
  });

  it.each(['planned', 'dispatched', 'working', 'awaiting-review', 'merging', 'closing', 'unknown', 'x-from-a-newer-build'])(
    '(a) a witness run in %s is not finished, and holds', (state) => {
      const s = store();
      const run = s.open();
      s.setOpenedAt(run, AT - 1_000);
      if (state !== 'planned') s.setState(run, state);
      expect(collectOpenRunHold(s.coord, ID, fresh(run, AT))).toMatchObject({ kind: 'held', why: 'run-open' });
    });

  it('(b) a witness run the database does not hold holds: a lost or rebuilt database makes every run absent at once', () => {
    const s = store();
    expect(collectOpenRunHold(s.coord, ID, fresh(4242, AT))).toMatchObject({ kind: 'held', why: 'run-absent' });
    expect(collectOpenRunHold(s.coord, ID, resumed(4242, AT))).toMatchObject({ kind: 'held', why: 'run-absent' });
  });

  it('(c) a witness run opened past the witness plus the skew is not its minting run, and holds; at exactly the skew it is', () => {
    const s = store();
    const run = s.minting();
    s.setOpenedAt(run, AT + CHILD_BIRTH_SKEW_MS + 1);
    expect(collectOpenRunHold(s.coord, ID, fresh(run, AT))).toMatchObject({ kind: 'held', why: 'run-after-witness' });
    s.setOpenedAt(run, AT + CHILD_BIRTH_SKEW_MS);
    expect(collectOpenRunHold(s.coord, ID, fresh(run, AT)), 'the boundary').toEqual({ kind: 'clear' });
  });

  it('(c) a witness that names a run but carries no instant holds: whether that run handed the temp root out cannot be said', () => {
    const s = store();
    expect(collectOpenRunHold(s.coord, ID, fresh(s.minting(), null))).toMatchObject({ kind: 'held', why: 'run-after-witness' });
  });

  it('(d) an open run naming the id as its session holds, whichever run the witness names, and names that run', () => {
    const s = store();
    const run = s.minting();
    const other = s.open({ sessionId: ID });
    const h = collectOpenRunHold(s.coord, ID, fresh(run, AT));
    expect(h).toMatchObject({ kind: 'held', why: 'id-in-open-run' });
    expect(h.kind === 'held' ? h.detail : '').toContain(`#${other}`);
  });

  it('(d) an open run naming the id as its coordinator holds', () => {
    const s = store();
    const run = s.minting();
    s.open({ claimedBy: ID });
    expect(collectOpenRunHold(s.coord, ID, fresh(run, AT))).toMatchObject({ kind: 'held', why: 'id-in-open-run' });
  });

  it('(d) a finished run naming the id does not hold', () => {
    const s = store();
    const run = s.minting();
    s.close(s.open({ sessionId: ID }));
    expect(collectOpenRunHold(s.coord, ID, fresh(run, AT))).toEqual({ kind: 'clear' });
  });

  it('(d) holds a resume with no witness while an open run names the id', () => {
    const s = store();
    s.open({ sessionId: ID });
    expect(collectOpenRunHold(s.coord, ID, resumed(null, null))).toMatchObject({ kind: 'held', why: 'id-in-open-run' });
  });

  it('(e) a FRESH collectable document with no witness run holds; a resume with no witness and nothing open does not', () => {
    const s = store();
    expect(collectOpenRunHold(s.coord, ID, fresh(null, null))).toMatchObject({ kind: 'held', why: 'no-witness-run' });
    expect(collectOpenRunHold(s.coord, ID, resumed(null, null))).toEqual({ kind: 'clear' });
  });

  describe('(f) a read that fails holds, at the job as at the pass', () => {
    const failing = (over: Partial<HoldCoord>) => {
      const s = store();
      const run = s.minting();
      const coord: HoldCoord = {
        run: (id: number) => s.coord.run(id),
        openRunsForSession: (id: string) => s.coord.openRunsForSession(id),
        openRunsClaimedBy: (id: string) => s.coord.openRunsClaimedBy(id),
        ...over,
      };
      return collectOpenRunHold(coord, ID, fresh(run, AT));
    };
    it.each<[string, Partial<HoldCoord>]>([
      ['the witness run’s read', { run: (): RunReadResult => ({ ok: false, kind: 'run-unreadable', detail: 'id out of range' }) }],
      ['the session read', { openRunsForSession: (): OpenSiblingsResult => ({ ok: false, kind: 'run-unreadable', detail: 'x' }) }],
      ['the coordinator read', { openRunsClaimedBy: (): OpenSiblingsResult => ({ ok: false, kind: 'run-unreadable', detail: 'x' }) }],
      ['a read that throws', { openRunsClaimedBy: () => { throw new Error('database is locked'); } }],
    ])('%s failing holds', (_what, over) => {
      expect(failing(over)).toMatchObject({ kind: 'held', why: 'store-unreadable' });
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-temp-root.test.ts test/collect-temp-root-reads.test.ts test/collect-open-run-hold.test.ts
```

Expected: all three files FAIL to load, and no test runs. The executor and reads files fail through the fixture: `Error: Failed to load url ../src/coord/collectTempRoot.js (resolved id: ../src/coord/collectTempRoot.js) in …/server/test/collectTempRootFixture.ts. Does the file exist?`. The hold file names itself as the importer. The summary reads `Test Files  3 failed (3)` with no tests. A load error on `../src/collectLane.js` instead means Tasks 2–4 are not on the branch: STOP (Step 0).

- [ ] **Step 4: Implement**

(a) Create `server/src/coord/collectTempRoot.ts`:

```ts
import path from 'node:path';
import type { FleetIO, MeasuredPathKind, MeasuredStat } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { Deps } from '../server.js';
import type { Presence } from '../presence.js';
import type { CcdResult } from '../lifecycle.js';
import { CCD_ARGV, COLLECT_CAP, RECLAIM_PAUSE_CAP, capSupported, sweepDec, verbSupported } from '../ccdargv.js';
import type { CoordStore } from './store.js';
import { RECLAIM_PAUSE_MARKER } from './rundefs.js';
import { CHILD_BIRTH_SKEW_MS } from './childSpent.js';
import {
  COLLECT_LANE_LIVE_MARKER, collectLicence, collectLicenceStands, parseCollectAudit, parseCollectResult,
  type CollectAudit, type CollectCapture, type CollectHoldWhy, type CollectListing, type CollectObservation,
  COLLECT_HOLD_WHYS, type CollectResult,
} from '../collectLane.js';
import { TERMINAL_RUN_STATES, TMPROOT_ID_MAX_CHARS, isTmpRootId, type RunState } from '../../../shared/api.js';

/**
 * THE TEMP-ROOT COLLECTOR'S ONE EXECUTOR, AND ITS READS (child reclamation spec 2026-09-22 §5.10).
 *
 * It runs `ws-audit --collect` as observation 2, then the collector's verb with THAT audit's token. The server composes
 * the verb, and nothing else does. It follows `expireArchived`'s shape, in a file of its own, so it shares no
 * vocabulary, feed row or attention list with the reclaim and expiry lanes. Its callers are `watch.ts`'s collector
 * pass. Every call runs on the id's `KeyedQueue` key, the key the reclaim and expiry executors use, so no two lanes
 * touch one id at once.
 *
 * THE JOB, in order. Every doubt is "not this time". Nothing here paces, frees a slot or writes a feed row: the job
 * REPORTS (`CollectJobOutcome`), and the lane folds the report through its L1 rules (`collectLane.ts`).
 *   1. The box must PROVE both capabilities, `collect-v1` and `reclaim-pause-v1` (`capSupported`, which refuses on no
 *      evidence). An automatic destructive lane never runs on a box the phone cannot pause. Then the id predicate
 *      AGAIN, on the job's own id: the population gated it, and this is the second check before any argv.
 *   2. The switch, from ONE registry listing. A raised `reclaim-paused`, or a listing that could not be taken, stops it.
 *   3. A person looking at the session stops it, with no ceiling and no licence past it.
 *   4. The audit is OBSERVATION 2. It is stamped when its answer arrives, and it is an observation only if neither
 *      clear generation moved while it was in flight. It licenses the act only under the lane's one licence rule
 *      (`collectLicence`): observation 1 stands, with the same token, and arrived at least the interval before. Then
 *      the open-run hold is judged on observation 2's document, licensed or not, so a held id never seeds a pair.
 *   5. The switches once more, with the live marker, from one fresh listing. This is the job's LAST await. A marker that
 *      differs from the lane's last-seen flag is a flip: every pair clears, and this job composes nothing.
 *   6. SYNCHRONOUSLY, with no await before the argv: observation 1 is re-read (`collectLicenceStands`: a pair cleared
 *      since composes nothing), presence is read again, the hold's store reads are made again (CoordStore is
 *      synchronous), and the capability is asked again in the act's own scope. Shadow: "would collect", and stop.
 *      Live: the verb, on observation 2's token and the job's id. The start hold-off is the lane's, asked at its offer.
 * It never kills a holder. It never passes `--defer-expired`: the builder has no such flag, and ccd's arity guard
 * dies on it. It never retries inside itself: ccd recomputes the token inside the reap lock before anything moves.
 */

// ── the ports (L2, declared by this consumer) ────────────────────────────────

/** The two clocks, read together, once, as the first statement after an answer settles (spec §5.7's clock rule).
 *  `mono` decides; `wall` is compared only with a ccd stamp, at arrival. */
export interface CollectClock { readonly mono: number; readonly wall: number }

/** The lane's two clear generations for one id (spec §5.10):
 *  - the lane-wide one moves on a raised pause or an unlistable registry, a missing capability, a pass that failed
 *    shut, or a marker flip;
 *  - the id's own moves on any reset of its pair.
 *  Both are captured when a call is composed. Its answer is an observation only if both still stand when it arrives.
 *  It is L1's `CollectCapture`, spelled once there (H3). */
export type CollectGenerations = CollectCapture;

/** An answer, with the generations it was composed under and the instant it arrived. */
export interface CollectAnswer<T> {
  readonly value: T;
  readonly composed: CollectGenerations;
  readonly arrived: CollectClock;
}

/** A collectable audit document: the only one that carries a token. */
export type CollectAuditCollectable = Extract<CollectAudit, { kind: 'collectable' }>;

/**
 * The lane's memory, as the executor reads it and reports to it. `watch.ts` implements it over the lane's L1 state.
 * EVERY MEMBER IS SYNCHRONOUS, so step 6's reads sit between the job's last await and the argv with nothing in
 * between. The executor writes no pacing through it. `cleared` and `flipped` are the two LANE-WIDE events a job can be
 * the first to see. They are applied the instant the job sees them, so an answer composed before one can never seed an
 * observation after it. Everything per-id is reported in the job's outcome, and the lane folds it when the job settles.
 */
export interface CollectLanePort {
  /** The two clocks, read together. */
  clock(): CollectClock;
  /** Both clear generations for `id`, as they stand now. */
  generations(id: string): CollectGenerations;
  /** Observation 1: the standing pair's token and its first answer's arrival, or null when no pair stands. */
  observation(id: string): CollectObservation | null;
  /** A lane-wide clear this job saw. `paused` is `reclaim-paused` raised, or a registry that did not list; `caps` is a
   *  missing capability. Every pair clears now, and the per-id pacing stays. */
  cleared(why: 'paused' | 'caps'): void;
  /** The live marker as this job read it at its last await. Answers true when it differs from the lane's last-seen
   *  flag, which starts `shadowed` when the lane is constructed. The lane has then set the flag, cleared every pair and
   *  written the flip's one feed row, and this job composes nothing. Answers false otherwise, and nothing changed. */
  flipped(live: boolean): boolean;
}

/** The executor's ports. Each is narrowed to what is asked of it:
 *  - `coord` to the three destructive-grade reads the hold makes;
 *  - `io` to the one listing the switches read;
 *  - `presence` to its one question.
 *  `observeIntervalMs` is the lane's `COLLECT_OBSERVE_INTERVAL_MS`, passed in, as the L1 licence takes it. `runCcd` is
 *  the lane's stamping wrapper (Task 7), which reads `argv[0]` to tell this job's audit from its act (H1). */
export interface CollectTempRootDeps {
  coord: Pick<CoordStore, 'run' | 'openRunsForSession' | 'openRunsClaimedBy'>;
  io: Pick<FleetIO, 'readdir'>;
  cfg: Pick<CcrcConfig, 'registryDir'>;
  runCcd: Deps['runCcd'];
  fleetState?: FleetState;
  presence?: Pick<Presence, 'isVisible'>;
  lane: CollectLanePort;
  observeIntervalMs: number;
}

/** One job: the id the lane offered. Observation 1 is read from the lane's memory and never carried: a token is a
 *  comparand, never a request's payload. */
export interface CollectJob { readonly id: string }

// ── what a job reports ───────────────────────────────────────────────────────

/** A hold that stood (spec §5.10). `why` is the lane's word, and `detail` names the run or the read. */
export interface CollectHeld { readonly kind: 'held'; readonly why: CollectHoldWhy; readonly detail: string }
export type CollectHoldRead = { readonly kind: 'clear' } | CollectHeld;

/** Why a job that asked the box for observation 2 composed nothing. */
export type CollectAnsweredWhy =
  | 'stale' | 'not-collectable' | 'not-licensed' | 'paused' | 'marker-flip' | 'pair-cleared' | 'presence' | 'caps';

/** What one job did (spec §5.10), for the lane to fold. Only `acted` composed the collector's verb. Every other arm
 *  composed none, and the lane frees the slot on it. Each arm says what was measured, never what to do next. */
export type CollectJobOutcome =
  /** Nothing was asked of the box: at step 1, 2 or 3, or at step 4 when the audit's own gate refused. */
  | { readonly kind: 'not-asked'; readonly step: 1 | 2 | 3 | 4; readonly why: 'caps' | 'id-refused' | 'paused' | 'presence';
      readonly detail: string }
  /** Observation 2 was asked, and the job stopped at step 4, 5 or 6 without composing. */
  | { readonly kind: 'answered'; readonly step: 4 | 5 | 6; readonly why: CollectAnsweredWhy; readonly detail: string;
      readonly audit: CollectAnswer<CollectAudit> }
  /** The open-run hold stood on observation 2's document, at step 4 or at step 6's re-read. */
  | { readonly kind: 'held'; readonly step: 4 | 6; readonly hold: CollectHeld;
      readonly audit: CollectAnswer<CollectAuditCollectable> }
  /** Shadow: every gate passed, and nothing was composed. */
  | { readonly kind: 'would-collect'; readonly audit: CollectAnswer<CollectAuditCollectable> }
  /** Live: the verb was composed at `composedMono`, and answered `result` at `arrived`. A `no-document` result may
   *  have acted, so the lane keeps the id and the slot until `CHILD_RECLAIM_STALL_MS` after `composedMono`. */
  | { readonly kind: 'acted'; readonly audit: CollectAnswer<CollectAuditCollectable>; readonly composedMono: number;
      readonly result: CollectResult; readonly arrived: CollectClock };

/** The learning audit's answer: not asked, because the box cannot answer it, or answered, with its generations and
 *  its arrival. */
export type CollectLearnAnswer =
  | { readonly kind: 'not-asked'; readonly why: 'caps' }
  | { readonly kind: 'answered'; readonly audit: CollectAnswer<CollectAudit> };

// ── the words this file spells, for the coordination scanner ─────────────────

/** The kebab words this executor spells as quoted literals, as TOTAL tables over their own unions: the outcome kinds,
 *  the not-asked whys, the answered whys and the audit's kinds (its `no-document`). The hold's whys are L1's
 *  `COLLECT_HOLD_WHYS`, read, never re-spelled. None is a mail rejection or a run refusal: no `refused` or
 *  `reject.code` ever carries one; they ride the job's outcome and the lane's memory. */
const COLLECT_OUTCOME_KINDS: Readonly<Record<CollectJobOutcome['kind'], true>> = {
  'not-asked': true, answered: true, held: true, 'would-collect': true, acted: true,
};
const COLLECT_NOT_ASKED_WHYS: Readonly<Record<Extract<CollectJobOutcome, { kind: 'not-asked' }>['why'], true>> = {
  caps: true, 'id-refused': true, paused: true, presence: true,
};
const COLLECT_ANSWERED_WHYS: Readonly<Record<CollectAnsweredWhy, true>> = {
  stale: true, 'not-collectable': true, 'not-licensed': true, paused: true, 'marker-flip': true, 'pair-cleared': true,
  presence: true, caps: true,
};
const COLLECT_AUDIT_KINDS: Readonly<Record<CollectAudit['kind'], true>> = {
  collectable: true, verdict: true, unmeasured: true, unreadable: true, 'no-document': true,
};

/** Every kebab word this file spells, for `mail-routes.test.ts`'s scan of `server/src/coord`, where this executor
 *  lives: its SIXTEENTH union, admitted as `isArchivedExpiryKebab` admits the expiry lane's. Derived from the tables
 *  above and L1's `COLLECT_HOLD_WHYS`, never a list, so a word added to a union is admitted and a typo is not. */
export function isCollectExecutorKebab(v: string): boolean {
  const own = (o: object): boolean => Object.prototype.hasOwnProperty.call(o, v);
  return own(COLLECT_OUTCOME_KINDS) || own(COLLECT_NOT_ASKED_WHYS) || own(COLLECT_ANSWERED_WHYS)
    || own(COLLECT_AUDIT_KINDS) || (COLLECT_HOLD_WHYS as readonly string[]).includes(v);
}

// ── words ────────────────────────────────────────────────────────────────────

/** The `--actor` this lane declares: its name, as the expiry lane declares `expire sweep`. */
const COLLECT_ACTOR = 'collect sweep';
/** The population's two registry subdirectories (spec §5.10): witnesses, and quarantine records. */
const COLLECT_WITNESS_DIR = 'tmproots';
const COLLECT_RECORD_DIR = 'tmpquarantine';
const COLLECT_PAUSED = `${RECLAIM_PAUSE_MARKER} is raised, or the registry did not list so a raised one cannot be ruled `
  + 'out: cleanup is paused';
const COLLECT_SEEN = 'someone is viewing this session';
const COLLECT_ID_REFUSED = 'the id is not one the collector may name: a session id’s shape, with no leading dot or dash, '
  + `of at most ${TMPROOT_ID_MAX_CHARS} characters`;
const COLLECT_STALE = 'a clear landed while the audit was in flight, so its answer is no observation';
const COLLECT_NOT_LICENSED = 'no earlier audit answered collectable with this token at least the interval before this one';
const COLLECT_FLIPPED = 'the live marker changed since this lane last read it, so every pair was cleared and this job '
  + 'composes nothing';
const COLLECT_PAIR_CLEARED = 'the observations this act rested on were cleared before it could be composed';

const said = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const sameGenerations = (a: CollectGenerations, b: CollectGenerations): boolean => a.lane === b.lane && a.id === b.id;

// ── the population's two listings ────────────────────────────────────────────

/** THE POPULATION'S TWO LISTINGS (spec §5.10), read exactly, inside the pass's one gather, concurrently:
 *  `<registryDir>/tmproots` and `<registryDir>/tmpquarantine`. Each answers through `readCollectListing`, and a fault
 *  in one never touches the other. */
export async function readCollectPopulation(
  io: Pick<FleetIO, 'lstatMeasured' | 'readdir' | 'statMeasured'>, registryDir: string,
): Promise<{ tmproots: CollectListing; tmpquarantine: CollectListing }> {
  const [tmproots, tmpquarantine] = await Promise.all([
    readCollectListing(io, registryDir, COLLECT_WITNESS_DIR),
    readCollectListing(io, registryDir, COLLECT_RECORD_DIR),
  ]);
  return { tmproots, tmpquarantine };
}

/** ONE listing, in two measured steps (spec §5.10).
 *  1. The path's OWN kind first. `lstatMeasured` has no directory kind, so a directory is `other`. A PROVEN absence is
 *     an empty listing, and nothing is listed. These make THIS listing unmeasured, and are never listed:
 *     - a link (ccd never follows `tmproots/`);
 *     - a plain file;
 *     - every failure, `unreadable` and an agent too old to answer (`unmeasured`) alike;
 *     - a port that rejects.
 *  2. Only `other` is listed. A listing that comes back null, or rejects, is resolved by `statMeasured`. Its proven
 *     ENOENT (the directory went between the two reads) is empty. Every other answer is unmeasured: a FIFO, a socket or
 *     a device is `other` at the first step and lists nothing. The two are never folded.
 *  Names that are not strings are dropped here, because nothing past this adapter can see them. The dot-leading drop
 *  and the size cap belong to the L1 population (`collectPopulation`). STATED RESIDUAL: a directory swapped for a link
 *  between the two reads is listed through the link, and every audit of such a name answers ccd's `witness` probe and
 *  mints no token. */
async function readCollectListing(
  io: Pick<FleetIO, 'lstatMeasured' | 'readdir' | 'statMeasured'>, registryDir: string, leaf: string,
): Promise<CollectListing> {
  const dir = path.join(registryDir, leaf);
  let kind: MeasuredPathKind;
  try {
    kind = await io.lstatMeasured(dir);
  } catch (err) {
    return { kind: 'unmeasured', why: `what ${leaf}/ is could not be asked (${said(err)})` };
  }
  if (!kind.ok) {
    if (kind.reason === 'absent') return { kind: 'absent' };
    return { kind: 'unmeasured', why: kind.reason === 'unmeasured'
      ? `this fleet host’s agent cannot say what ${leaf}/ is` : `${leaf}/ could not be looked at` };
  }
  if (kind.kind === 'symlink') return { kind: 'unmeasured', why: `${leaf}/ is a symbolic link, which is never followed` };
  if (kind.kind === 'regular') return { kind: 'unmeasured', why: `${leaf}/ is a plain file, not a directory` };
  let names: readonly unknown[] | null;
  try { names = await io.readdir(dir); } catch { names = null; }
  if (names !== null) return { kind: 'listed', names: names.filter((n): n is string => typeof n === 'string') };
  let st: MeasuredStat;
  try {
    st = await io.statMeasured(dir);
  } catch (err) {
    return { kind: 'unmeasured', why: `${leaf}/ did not list, and what stands there could not be asked (${said(err)})` };
  }
  if (!st.ok && st.reason === 'absent') return { kind: 'absent' };
  return { kind: 'unmeasured', why: `${leaf}/ did not list` };
}

// ── the switches ─────────────────────────────────────────────────────────────

/** The two switches, from ONE registry listing (spec §5.10). A raised `reclaim-paused` is `paused`. A listing that
 *  could not be taken is `paused` too, because it cannot rule a pause out, and that is never shadow. `live` is whether
 *  `collect-lane-live` stands, which no writer in the tree touches. It is meaningful only when `paused` is false, and
 *  the executor asks `paused` first. */
export async function collectSwitches(io: Pick<FleetIO, 'readdir'>, registryDir: string): Promise<{ paused: boolean; live: boolean }> {
  let names: readonly string[] | null;
  try { names = await io.readdir(registryDir); } catch { names = null; }
  if (names === null) return { paused: true, live: false };
  return { paused: names.includes(RECLAIM_PAUSE_MARKER), live: names.includes(COLLECT_LANE_LIVE_MARKER) };
}

// ── the one audit site ───────────────────────────────────────────────────────

/** THE ONE AUDIT SITE (spec §5.10). It serves observation 2 for the executor, and the learning audit for the lane. Both
 *  questions are asked in its own scope:
 *  - the capability token, which refuses on no evidence;
 *  - the verb, by which `verb-gate.test.ts` keys this site (`ws-audit`). Where `collect-v1` is advertised the verb is
 *    too, so this check changes no decision.
 *  The generations are captured as the call is composed. The clocks are read as the first statement after it settles,
 *  whether it answered or rejected. A rejection is an audit with no document, never a probe. */
async function collectAudit(
  deps: Pick<CollectTempRootDeps, 'runCcd' | 'fleetState' | 'lane'>, id: string,
): Promise<CollectAnswer<CollectAudit> | 'not-asked'> {
  if (!capSupported(deps.fleetState, COLLECT_CAP)) return 'not-asked';
  const argv = CCD_ARGV.wsCollectAudit(id);
  if (!verbSupported(deps.fleetState, argv)) return 'not-asked';
  const composed = deps.lane.generations(id);
  let res: CcdResult;
  try {
    res = await deps.runCcd(argv);
  } catch (err) {
    const arrived = deps.lane.clock();
    return { value: { kind: 'no-document', stderr: said(err) }, composed, arrived };
  }
  const arrived = deps.lane.clock();
  return { value: parseCollectAudit(id, res.ok, res.stdout, res.stderr), composed, arrived };
}

/** The lane's LEARNING audit (spec §5.10). It is read-only on the box: the audit journals a terminal refusal and
 *  nothing else. It sits behind the capability, as the act does. The caller runs it on the id's queue key. */
export async function learnCollect(
  deps: Pick<CollectTempRootDeps, 'runCcd' | 'fleetState' | 'lane'>, id: string,
): Promise<CollectLearnAnswer> {
  const audit = await collectAudit(deps, id);
  return audit === 'not-asked' ? { kind: 'not-asked', why: 'caps' } : { kind: 'answered', audit };
}

// ── the job ──────────────────────────────────────────────────────────────────

export async function collectTempRoot(deps: CollectTempRootDeps, job: CollectJob): Promise<CollectJobOutcome> {
  // 1 — BOTH capabilities, proven: `capSupported` refuses on no evidence, where `verbSupported` would permit. A box the
  // phone cannot pause never runs an automatic destructive lane. Then the id predicate AGAIN, on the job's own id,
  // before any argv. The population gated it; this is the second check, pinned on its own (spec §5.10).
  if (!capSupported(deps.fleetState, COLLECT_CAP) || !capSupported(deps.fleetState, RECLAIM_PAUSE_CAP)) {
    deps.lane.cleared('caps');
    return { kind: 'not-asked', step: 1, why: 'caps',
      detail: `the fleet host does not advertise both ${COLLECT_CAP} and ${RECLAIM_PAUSE_CAP}` };
  }
  if (!isTmpRootId(job.id)) return { kind: 'not-asked', step: 1, why: 'id-refused', detail: COLLECT_ID_REFUSED };
  // 2 — THE SWITCH, from one listing. A registry that did not list cannot rule a raised pause out, so it is a pause.
  if ((await collectSwitches(deps.io, deps.cfg.registryDir)).paused) {
    deps.lane.cleared('paused');
    return { kind: 'not-asked', step: 2, why: 'paused', detail: COLLECT_PAUSED };
  }
  // 3 — a person at the session. No ceiling, and no licence past it.
  if (deps.presence?.isVisible(job.id) === true) return { kind: 'not-asked', step: 3, why: 'presence', detail: COLLECT_SEEN };
  // 4 — OBSERVATION 2, through the one audit site. It is stale if a clear landed while it was in flight. Then the
  // licence against observation 1, read from the lane's memory and never carried. Then the open-run hold, judged on
  // THIS document, licensed or not.
  const asked = await collectAudit(deps, job.id);
  if (asked === 'not-asked') {
    deps.lane.cleared('caps');
    return { kind: 'not-asked', step: 4, why: 'caps', detail: 'the fleet host cannot answer ws-audit' };
  }
  const audit: CollectAnswer<CollectAudit> = asked;
  const answered = (step: 4 | 5 | 6, why: CollectAnsweredWhy, detail: string): CollectJobOutcome =>
    ({ kind: 'answered', step, why, detail, audit });
  if (!sameGenerations(audit.composed, deps.lane.generations(job.id))) return answered(4, 'stale', COLLECT_STALE);
  const obs2 = audit.value;
  if (obs2.kind !== 'collectable') return answered(4, 'not-collectable', `ws-audit answered ${obs2.kind}`);
  const observed: CollectAnswer<CollectAuditCollectable> = { ...audit, value: obs2 };
  // The licence is R85's ONE L1 rule, `collectLicence`, against observation 1 read from the lane's memory. `observes`
  // is true: the stale check above has already asked whether this answer is an observation.
  const licence = collectLicence(deps.lane.observation(job.id), obs2, audit.arrived.mono, deps.observeIntervalMs, true);
  const hold = collectOpenRunHold(deps.coord, job.id, obs2);
  if (hold.kind === 'held') return { kind: 'held', step: 4, hold, audit: observed };
  if (licence.kind !== 'licensed') return answered(4, 'not-licensed', `${COLLECT_NOT_LICENSED} (${licence.kind})`);
  const obs1 = licence.first;
  // 5 — THE SWITCHES ONCE MORE, with the live marker: the job's LAST await.
  const last = await collectSwitches(deps.io, deps.cfg.registryDir);
  // ── 6 — SYNCHRONOUS from here to the argv: no await may stand between these reads and the act (spec §5.10). ──
  if (last.paused) {
    deps.lane.cleared('paused');
    return answered(5, 'paused', COLLECT_PAUSED);
  }
  if (deps.lane.flipped(last.live)) return answered(5, 'marker-flip', COLLECT_FLIPPED);
  if (!collectLicenceStands(obs1, audit.composed, deps.lane.generations(job.id), deps.lane.observation(job.id))) {
    return answered(6, 'pair-cleared', COLLECT_PAIR_CLEARED);
  }
  if (deps.presence?.isVisible(job.id) === true) return answered(6, 'presence', COLLECT_SEEN);
  const holdAtAct = collectOpenRunHold(deps.coord, job.id, obs2);
  if (holdAtAct.kind === 'held') return { kind: 'held', step: 6, hold: holdAtAct, audit: observed };
  if (!capSupported(deps.fleetState, COLLECT_CAP)) {
    deps.lane.cleared('caps');
    return answered(6, 'caps', `the fleet host no longer advertises ${COLLECT_CAP}`);
  }
  if (!last.live) return { kind: 'would-collect', audit: observed };
  const now = deps.lane.clock();
  let act: CcdResult;
  try {
    act = await deps.runCcd(CCD_ARGV.wsCollect(obs2.token, job.id, sweepDec(deps.fleetState, COLLECT_ACTOR)));
  } catch (err) {
    const arrived = deps.lane.clock();
    return { kind: 'acted', audit: observed, composedMono: now.mono, result: { kind: 'no-document', stderr: said(err) }, arrived };
  }
  const arrived = deps.lane.clock();
  return { kind: 'acted', audit: observed, composedMono: now.mono,
    result: parseCollectResult(job.id, act.ok, act.stdout, act.stderr), arrived };
}

// ── the open-run hold ────────────────────────────────────────────────────────

/** THE OPEN-RUN HOLD (spec §5.10), judged on OBSERVATION 2's document, never observation 1's. It only ever makes the
 *  lane slower. Whatever it answers, ccd decides inside its lock. Every read is a synchronous CoordStore read, and so is
 *  a re-read made at step 6 with no await before the argv. It holds when:
 *  - (a) the witness's run is not terminal; `unknown` and a word from a newer build hold;
 *  - (b) the witness's run is ABSENT from the database. A lost, rebuilt or restored database makes every run absent at
 *    once, the open ones included;
 *  - (c) the witness's run opened after the witness's instant plus `CHILD_BIRTH_SKEW_MS`, so it is not the minting run:
 *    run ids restart after a database loss. A witness with a run and no instant cannot be placed, and holds the same
 *    way;
 *  - (d) any non-terminal run names the id as its session or its coordinator. A later run may bind an unspent child,
 *    and this also holds an id that only a record names;
 *  - (e) a FRESH collectable document (no `resume` key: its token mode is `collect` or `collect-absent`) whose witness
 *    names no run. A wave-7 ccd never prints one, so this is defence in depth. A RESUME with no witness is not held by
 *    (a) to (e): it finishes an act that began under these same gates, and (d) alone holds it. The stated residual is
 *    that a record's own run is not on the wire;
 *  - (f) any of these reads fails.
 *  It counts nothing. The lane clears the pair, and the id's next ask waits `CHILD_RECLAIM_DEFER_CEILING_MS` flat (R87,
 *  H1). */
export function collectOpenRunHold(
  coord: CollectTempRootDeps['coord'], id: string, doc: Pick<CollectAuditCollectable, 'resume' | 'witnessRun' | 'witnessAt'>,
): CollectHoldRead {
  const held = (why: CollectHoldWhy, detail: string): CollectHeld => ({ kind: 'held', why, detail });
  try {
    if (doc.resume === null && doc.witnessRun === null) {
      return held('no-witness-run', `ws-audit offered a fresh collection of ${id} whose witness names no run, so no run `
        + 'can be asked whether it still needs the temp root');
    }
    if (doc.witnessRun !== null) {
      const n = doc.witnessRun;
      const read = coord.run(n);
      if (!read.ok) return held('store-unreadable', `run ${n}, named by ${id}’s witness, could not be read (${read.detail})`);
      if (read.run === null) {
        return held('run-absent', `run ${n}, named by ${id}’s witness, is not in the coordination database; a lost, rebuilt `
          + 'or restored database makes every run absent at once, the open ones included');
      }
      if (!(TERMINAL_RUN_STATES as readonly RunState[]).includes(read.run.state)) {
        return held('run-open', `run ${n}, named by ${id}’s witness, is ${read.run.state}, not finished`);
      }
      if (doc.witnessAt === null) {
        return held('run-after-witness', `${id}’s witness names run ${n} but carries no instant, so whether that run `
          + 'handed this temp root out cannot be said');
      }
      if (read.run.openedAt > doc.witnessAt + CHILD_BIRTH_SKEW_MS) {
        return held('run-after-witness', `run ${n} opened ${read.run.openedAt - doc.witnessAt} ms after ${id}’s witness `
          + `was written, past the ${CHILD_BIRTH_SKEW_MS} ms skew, so it is not the run that handed this temp root out: `
          + 'run ids restart after a database loss');
      }
    }
    const worker = coord.openRunsForSession(id);
    if (!worker.ok) return held('store-unreadable', `which open runs name ${id} as their session could not be read (${worker.detail})`);
    const claims = coord.openRunsClaimedBy(id);
    if (!claims.ok) return held('store-unreadable', `which open runs ${id} coordinates could not be read (${claims.detail})`);
    const naming = [...new Set([...worker.siblings, ...claims.siblings].map((r) => r.id))].sort((a, b) => a - b);
    if (naming.length > 0) {
      return held('id-in-open-run', `open run(s) ${naming.map((r) => `#${r}`).join(', ')} name ${id} as their session or coordinator`);
    }
    return { kind: 'clear' };
  } catch (err) {
    return held('store-unreadable', `the coordination database could not be read (${said(err)})`);
  }
}
```

(b) In `server/test/verb-gate.test.ts`, `CAP_GATED_VERBS` (`grep -n "^const CAP_GATED_VERBS" server/test/verb-gate.test.ts`) gains `'ws-collect'` after `'ws-expire'`. Change only that one line of the literal:

```ts
  'route', 'ws-reclaim', 'reclaim-pause', 'ws-expire', 'ws-collect', 'docs-index', 'docs-tree', 'docs-show', 'docs-fetch',
```

The act's site in `collectTempRoot` is gated by `capSupported(` in its own scope (steps 1 and 6), never by `verbSupported(`: the one audit site lives in `collectAudit`. So without this word the scanner reports that site ungated. Task 8 keeps `NEW_GENERATION` and the comment (R86).

(c) In `server/test/ws-collect-wiring.test.ts`, in the INERT `it` (`grep -n "the builders, the verb, its mode flag" server/test/ws-collect-wiring.test.ts`), change exactly two arrays:
- the builder list (`grep -n "a reference to either builder" …`) becomes `.toEqual(['ccdargv.ts', 'coord/collectTempRoot.ts']);`;
- the capability list (`grep -n "declared, read by nothing" …`) becomes `.toEqual(['ccdargv.ts', 'coord/collectTempRoot.ts']);`.

The `'ws-collect'` list and the `'--collect'` list stay byte for byte. The describe, its title and the assertion messages are Task 8's deliberate rewrite (R86). Task 7 adds `'watch.ts'` to the capability list in its own commit, because its pass gate asks `capSupported(…, COLLECT_CAP)` in `watch.ts` (H5).

(d) In `server/src/ccdargv.ts`, comment-only and line-neutral (H5, `ccdargv-collect-docstrings-rewritten`, moved here from Task 8 because this commit makes both docstrings false):
- `wsCollect`'s docstring, as Task 1 Step 4 (e) left it (seven lines; the `:455-456` of `d0c2b7803` no longer locate it): replace its LAST THREE lines, from `   *  dec trails, and ccd strips it before it binds a positional. Composed by NOTHING in this build: the collector's lane` (`grep -n "Composed by NOTHING in this build" server/src/ccdargv.ts`) through `   *  until then. */`, with:
  ```ts
     *  dec trails, and ccd strips it before it binds a positional. Its ONE composer is the collector's executor
     *  (`coord/collectTempRoot.ts`), behind `COLLECT_CAP`, armed only by `$REG/collect-lane-live`;
     *  `ws-collect-wiring.test.ts` pins that no other server source composes it. */
  ```
  Replacing only the `Composed by NOTHING` line and the one after it would drop `dec trails, and ccd strips it before it binds a` and leave `   *  until then. */` after the comment had closed: a syntax error in `ccdargv.ts` that the stat check below cannot see (P10). Only `tsc` (Step 7) would.
- `COLLECT_CAP`'s docstring: its last two lines (`grep -n "Nothing reads it in" server/src/ccdargv.ts` and the line after, `:895-896`) become:
  ```ts
   *  to a box with no evidence it exists is the failure the capability reader was built to prevent. The collector's lane
   *  asks it before every audit and again in the act's own scope (`verb-gate.test.ts`, `collect-temp-root.test.ts`). */
  ```

These are Task 8 Step 9's texts, rewrapped to the file's 122-column width, citing `collect-temp-root.test.ts` where Task 8's text cites `collect-lane-scans.test.ts`, which does not exist until Task 8. Check: `git diff --stat server/src/ccdargv.ts` shows equal insertions and deletions (5 and 5: three lines of `wsCollect`'s docstring, two of `COLLECT_CAP`'s), `grep -c "Composed by NOTHING in this build\|Nothing reads it in" server/src/ccdargv.ts` prints `0`, `grep -c "until then\. \*/" server/src/ccdargv.ts` prints `0`, and `cd server && ./node_modules/.bin/tsc --noEmit -p .` prints nothing (the docstring still closes once).

(e) In `server/test/mail-routes.test.ts` (P9), admit the executor's kebab words through its own guard:
- after `import { isDeadCoordinatorKebab } from '../src/deadCoordinator.js';` (`:23` at `d0c2b7803`), add:
  ```ts
  import { isCollectExecutorKebab } from '../src/coord/collectTempRoot.js';
  ```
- in the kebab scanner's accept chain, replace its last arm, `        || isDeadCoordinatorKebab(tok),` (`grep -n "|| isDeadCoordinatorKebab(tok)," server/test/mail-routes.test.ts`; `:856` at `d0c2b7803`), with:
  ```ts
          || isDeadCoordinatorKebab(tok)
          // CHILD RECLAMATION, WAVE 9: the SIXTEENTH union, checked together and never merged, on the standing rule
          // `enter-ignored` above states. `coord/collectTempRoot.ts` (the temp-root collector's one executor) spells its
          // outcome kinds, its not-asked and answered whys, the open-run hold's whys and the audit's `no-document` as
          // literals. None is a mail rejection or a run refusal — no route answers with one; they ride the job's outcome
          // and the lane's memory. Admitted through the exported guard, derived from that file's tables and L1's
          // `COLLECT_HOLD_WHYS`, never NOT_CODES, for the reason every union above gives.
          || isCollectExecutorKebab(tok),
  ```
- in the assertion message on the line after, `stall-watch settings word or dead-coordinator word` becomes `stall-watch settings word, dead-coordinator word or temp-root collector word`. Nothing else in the file changes.

(f) In `server/test/single-definition.test.ts`, ONE in-place edit of the archive-door scan's `want` line, line-neutral (P8; `grep -n "code === 'run-open' ?" server/test/single-definition.test.ts`, `:4192` at `d0c2b7803`). Task 4's
`code === 'run-open' ? ['server/src/collectLane.ts', 'shared/api.ts']` becomes
`code === 'run-open' ? ['server/src/collectLane.ts', 'server/src/coord/collectTempRoot.ts', 'shared/api.ts']`, the order the scan's `.sort()` produces. The hold's `held('run-open', …)` above is the executor's one code-line spelling of the word; the guard reads `COLLECT_HOLD_WHYS` and spells none.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-temp-root.test.ts test/collect-temp-root-reads.test.ts test/collect-open-run-hold.test.ts
cd server && ./node_modules/.bin/vitest run test/verb-gate.test.ts test/ws-collect-wiring.test.ts test/whitelist-subset.test.ts
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/ccdargv-dec-parity.test.ts test/expire-archived.test.ts test/mail-routes.test.ts
```

Expected: every file PASSES. Run each line in the foreground, with a timeout of at least 600000 ms. If (e) is skipped, `mail-routes.test.ts` reds with `not-collectable is not a declared MailRejectCode, … or dead-coordinator word: expected false to be true`. If (f) is skipped, `single-definition.test.ts` reds with `a second 'run-open': expected [ 'server/src/collectLane.ts', 'server/src/coord/collectTempRoot.ts', 'shared/api.ts' ] to deeply equal [ 'server/src/collectLane.ts', 'shared/api.ts' ]`. If (b) is skipped, `verb-gate.test.ts` reds with `has no ungated call site outside UNGATED_BY_DECISION: expected [ 'coord/collectTempRoot.ts:<n> wsCollect (ws-collect)' ] to deeply equal []`. If (c) is skipped, `ws-collect-wiring.test.ts` reds with `a reference to either builder: expected [ 'ccdargv.ts', 'coord/collectTempRoot.ts' ] to deeply equal [ 'ccdargv.ts' ]`. If the consumer case "what the hold keys on…" reds, Task 2's reader answers the hold's keys differently from the contract above: STOP and report `collect-audit-hold-keys`. Re-run a known load flake in isolation before calling it a break.

- [ ] **Step 6: Mutation check**

Make each edit, run it, see the red, and revert before the next. The commands are run from `server/`:
- E is `./node_modules/.bin/vitest run test/collect-temp-root.test.ts`;
- R is the same with `test/collect-temp-root-reads.test.ts`;
- H is the same with `test/collect-open-run-hold.test.ts`;
- G is the same with `test/verb-gate.test.ts`;
- M is the same with `test/mail-routes.test.ts`.

Every red text is measured by the worker; where the measured text differs, it replaces the draft's.

| # | Mutation (exact edit in `collectTempRoot.ts` unless named) | Command | Expected red |
|---|---|---|---|
| 1 | Step 1: delete `\|\| !capSupported(deps.fleetState, RECLAIM_PAUSE_CAP)` | `E -t 'step 1'` | "no reclaim-pause-v1…": `expected { kind: 'acted', … } to match object { kind: 'not-asked', step: 1, why: 'caps' }` |
| 2 | Step 1: delete `!capSupported(deps.fleetState, COLLECT_CAP) \|\|` | `E -t 'step 1'` | "no collect-v1…": `expected { kind: 'not-asked', step: 4, … } to match object { kind: 'not-asked', step: 1, … }` |
| 3 | Step 1: delete the first `deps.lane.cleared('caps');` | `E -t 'step 1'` | `expected [] to deeply equal [ 'caps' ]` |
| 4 | Step 1: delete `if (!isTmpRootId(job.id)) return …;` | `E -t 'refused before any argv'` | "the id --actor…": `expected { kind: 'answered', step: 4, why: 'not-collectable', … } to match object { kind: 'not-asked', step: 1, why: 'id-refused' }` |
| 5 | Step 2: delete the step-2 `if ((await collectSwitches(…)).paused) { … }` block | `E -t 'step 2'` | "reclaim-paused stops it…": `live: true: expected { kind: 'answered', step: 5, why: 'paused', … } to match object { kind: 'not-asked', step: 2, why: 'paused' }` |
| 6 | `collectSwitches`: `if (names === null) return { paused: true, live: false };` becomes `… { paused: false, live: false };` | `E -t 'step 2'`, then `R -t 'collectSwitches'` | E "…answers null…": `expected { kind: 'acted', … } to match object { kind: 'not-asked', step: 2, … }`. R: `expected { paused: false, live: false } to deeply equal { paused: true, live: false }` |
| 7 | `collectSwitches`: replace its `try`/`catch` line with `names = await io.readdir(registryDir);` | `E -t 'step 2'` | "…answers reject…": `promise rejected "Error: EIO: the registry listing failed" instead of resolving` |
| 8 | Step 3: delete the presence check | `E -t 'step 3'` | `expected { kind: 'answered', step: 6, why: 'presence', … } to match object { kind: 'not-asked', step: 3, why: 'presence' }` |
| 9 | `collectAudit`: delete `if (!verbSupported(deps.fleetState, argv)) return 'not-asked';` | `E -t 'cannot answer ws-audit'`, then `R -t 'learnCollect'` | E: `expected { kind: 'acted', … } to match object { kind: 'not-asked', step: 4, why: 'caps' }`. R "collect-v1 but no ws-audit…": `expected { kind: 'answered', … } to deeply equal { kind: 'not-asked', why: 'caps' }` |
| 10 | `collectAudit`: delete `if (!capSupported(deps.fleetState, COLLECT_CAP)) return 'not-asked';` | `R -t 'learnCollect'` | "no collect-v1…": `expected { kind: 'answered', … } to deeply equal { kind: 'not-asked', why: 'caps' }` |
| 11 | `collectAudit`: move `const composed = deps.lane.generations(id);` below the `try`/`catch` | `E -t 'stale'`, then `R -t 'learnCollect'` | E: `lane: expected { kind: 'acted', … } to match object { kind: 'answered', step: 4, why: 'stale' }`. R: `…composed: { lane: 1, id: 0 }… to match object { …composed: { lane: 0, id: 0 }… }` |
| 12 | `collectAudit`: read `const arrived = deps.lane.clock();` once above the `try`, and use it in both returns | `E -t 'arrives when its answer arrives'` | `expected { kind: 'answered', step: 4, why: 'not-licensed', … } to match object { kind: 'acted', composedMono: 5000005 }` |
| 13 | `collectAudit`: delete its `try`/`catch`, keeping `res = await deps.runCcd(argv);` | `E -t 'no document'` | "an audit with no document (reject)…": `promise rejected "Error: the runner was killed" instead of resolving` |
| 14 | Step 4: delete `if (!sameGenerations(audit.composed, …)) return answered(4, 'stale', …);` | `E -t 'stale'` | `lane: expected { kind: 'answered', step: 6, why: 'pair-cleared', … } to match object { kind: 'answered', step: 4, why: 'stale' }` |
| 15 | Step 4: `collectLicence(deps.lane.observation(job.id), obs2, …)` becomes `(deps.lane.observation(job.id) === null ? { kind: 'no-first' as const } : { kind: 'licensed' as const, first: deps.lane.observation(job.id)! })` (observation 1 standing taken for the licence) | `E -t 'not licensed'` | "observation 1 carries another token…" and "…less than the interval…": `expected { kind: 'acted', … } to match object { kind: 'answered', step: 4, why: 'not-licensed', … }` |
| 16 | Step 4: pass `1` for `deps.observeIntervalMs` (not `0`: `collectLicence` licenses nothing on a non-positive interval, so `0` reds the control instead) | `E -t 'not licensed'` | "…less than the interval…": `expected { kind: 'acted', … } to match object { …why: 'not-licensed' }` |
| 17 | Step 4: delete `if (hold.kind === 'held') return { kind: 'held', step: 4, … };` | `E -t 'open-run hold'` | "a run bound to the id DURING the audit…": `expected { kind: 'held', step: 6, … } to match object { kind: 'held', step: 4, … }`. "…licensed or not…": `expected { kind: 'answered', step: 4, why: 'not-licensed', … } to match object { kind: 'held', step: 4, … }` |
| 18 | Step 4: move the step-4 hold below `if (licence.kind !== 'licensed') return …;` | `E -t 'licensed or not'` | `expected { kind: 'answered', step: 4, why: 'not-licensed', … } to match object { kind: 'held', step: 4, hold: { why: 'id-in-open-run' } }` |
| 19 | Step 5: delete `if (last.paused) { … }` | `E -t 'step 5'` | "a pause raised during the audit…": `expected { kind: 'acted', … } to match object { kind: 'answered', step: 5, why: 'paused' }`. "…never read as a flip…": `expected { …why: 'marker-flip' } to match object { …why: 'paused' }` |
| 20 | Step 5: ask `deps.lane.flipped(last.live)` before `last.paused` | `E -t 'never read as a flip'` | `expected { kind: 'answered', step: 5, why: 'marker-flip', … } to match object { …why: 'paused' }` |
| 21 | Step 5: delete `if (deps.lane.flipped(last.live)) return …;` | `E -t 'step 5'` | "the marker touched during the audit…" and "a lane constructed with the marker standing…": `expected { kind: 'acted', … } to match object { kind: 'answered', step: 5, why: 'marker-flip' }` |
| 22 | Step 6: delete the whole pair re-read `if (!collectLicenceStands(…)) { return answered(6, 'pair-cleared', …); }` | `E -t 'pair cleared'` | `lane false: expected { kind: 'acted', … } to match object { kind: 'answered', step: 6, why: 'pair-cleared' }` |
| 23 | Step 6: in the `collectLicenceStands(…)` call, pass `audit.composed` in place of `deps.lane.generations(job.id)` (the generations not re-read) | `E -t 'pair cleared'` | `lane true: expected { kind: 'acted', … } to match object { …why: 'pair-cleared' }` |
| 24 | Step 6: in the `collectLicenceStands(…)` call, pass `obs1` in place of `deps.lane.observation(job.id)` (observation 1 not re-read; the token and arrival comparisons inside it are Task 4's mutation rows) | `E -t 'replaced during the last await'` | `{"token":"dddd…","arrivedMono":4940000}: expected { kind: 'acted', … } to match object { …why: 'pair-cleared' }` |
| 25 | Step 6: delete the presence re-read | `E -t 'presence that appears'` | `expected { kind: 'acted', … } to match object { kind: 'answered', step: 6, why: 'presence' }` |
| 26 | Step 6: delete `if (holdAtAct.kind === 'held') return …;` | `E -t 'store reads are made again'` | `{"sessionId":"demo-quiet-tarn"}: expected { kind: 'acted', … } to match object { kind: 'held', step: 6, … }` |
| 27 | Step 6: delete the capability re-check block | `E -t 'withdrawn'` | `expected { kind: 'acted', … } to match object { kind: 'answered', step: 6, why: 'caps' }` |
| 28 | Step 6: delete `if (!last.live) return { kind: 'would-collect', … };` | `E -t 'SHADOW'` | `expected { kind: 'acted', … } to match object { kind: 'would-collect', … }` |
| 29–31 | Deleted (H4): the executor asks no start hold-off. It is asked at Task 7's offer (`collectOffers`, shadow included), and its pins and mutation rows are Task 7's | — | — |
| 32 | The act: `CCD_ARGV.wsCollect(obs2.token, …)` becomes `CCD_ARGV.wsCollect(obs1.token, …)` | E | GREEN BY CONSTRUCTION: the licence makes the two tokens equal. Its red is Task 8's first-argument scan. Recorded here so nobody reads this suite as pinning it |
| 33 | The act: delete its `try`/`catch`, keeping `act = await deps.runCcd(…);` | `E -t 'act answering no document'` | `reject: promise rejected "Error: the agent link closed" instead of resolving` |
| 34 | The act's document return: `composedMono: now.mono` becomes `composedMono: arrived.mono` | `E -t 'act answering no document'` | `empty: expected { …composedMono: 5000009… } to match object { …composedMono: 5000000… }` |
| 35 | `verb-gate.test.ts`: remove `'ws-collect'` from `CAP_GATED_VERBS` | G | `has no ungated call site outside UNGATED_BY_DECISION: expected [ 'coord/collectTempRoot.ts:<n> wsCollect (ws-collect)' ] to deeply equal []` |
| 36 | `readCollectListing`: delete `if (kind.reason === 'absent') return { kind: 'absent' };` | `R -t 'both absent'` | `expected { tmproots: { kind: 'unmeasured', … }, … } to deeply equal { tmproots: { kind: 'absent' }, … }` |
| 37 | `readCollectListing`: delete the symlink line | `R -t 'symbolic link'` | `expected [ 'demo-a' ] to contain 'symbolic link'`, or the listing's `listed` object in its place |
| 38 | `readCollectListing`: delete the plain-file line | `R -t 'plain file'` | `expected 'tmproots/ did not list' to contain 'plain file'` |
| 39 | `readCollectListing`: the failure arm's unmeasured return becomes `return { kind: 'absent' };` | `R -t 'an lstat that answers'` | `expected { kind: 'absent' } to match object { kind: 'unmeasured' }` |
| 40 | `readCollectListing`: delete the lstat `try`/`catch` | `R -t 'a rejection'` | `promise rejected "Error: the agent link closed" instead of resolving` |
| 41 | `readCollectListing`: `if (!st.ok && st.reason === 'absent')` becomes `if (!st.ok)` | `R -t 'null listing'` | "…a stat that answers unreadable…": `expected { kind: 'absent' } to match object { kind: 'unmeasured' }` |
| 42 | `readCollectListing`: the final unmeasured return becomes `return { kind: 'absent' };` | `R -t 'null listing'` | "…a FIFO, a socket or a device…": `expected { kind: 'absent' } to match object { kind: 'unmeasured' }` |
| 43 | `readCollectListing`: `names.filter((n): n is string => …)` becomes `names as string[]` | `R -t 'not strings'` | `expected { kind: 'listed', names: [ 'demo-a', 7, null, 'demo-b' ] } to deeply equal { kind: 'listed', names: [ 'demo-a', 'demo-b' ] }` |
| 44 | Hold (a): `!(TERMINAL_RUN_STATES as readonly RunState[]).includes(read.run.state)` becomes `read.run.state === 'working' \|\| read.run.state === 'dispatched'` | `H -t '(a)'` | "(a) a witness run in planned…", "…unknown…", "…x-from-a-newer-build…": `expected { kind: 'clear' } to match object { kind: 'held', why: 'run-open' }` |
| 45 | Hold (b): `if (read.run === null) { return held('run-absent', …); }` returns `{ kind: 'clear' }` | `H -t '(b)'` | `expected { kind: 'clear' } to match object { kind: 'held', why: 'run-absent' }` |
| 46 | Hold (c): `>` becomes `>=` | `H -t '(c)'` | `the boundary: expected { kind: 'held', why: 'run-after-witness', … } to deeply equal { kind: 'clear' }` |
| 47 | Hold (c): delete `if (read.run.openedAt > doc.witnessAt + CHILD_BIRTH_SKEW_MS) { … }` | `H -t '(c)'`, then `E -t 'reused run id'` | H: `expected { kind: 'clear' } to match object { kind: 'held', why: 'run-after-witness' }`. E: `expected { kind: 'acted', … } to match object { kind: 'held', step: 4, … }` |
| 48 | Hold (d): replace the `worker` read with `const worker: OpenSiblingsResult = { ok: true, siblings: [] };` | `H -t '(d)'`, then `E -t 're-bound child'` | H "…as its session…": `expected { kind: 'clear' } to match object { kind: 'held', why: 'id-in-open-run' }`. E: `expected { kind: 'acted', … } to match object { kind: 'held', … }` |
| 49 | Hold (d): replace the `claims` read with `const claims: OpenSiblingsResult = { ok: true, siblings: [] };` | `H -t 'coordinator holds'` | `expected { kind: 'clear' } to match object { kind: 'held', why: 'id-in-open-run' }` |
| 50 | Hold (e): delete the `if (doc.resume === null && doc.witnessRun === null) { … }` block | `H -t '(e)'`, then `E -t 'FRESH collectable'` | H: `expected { kind: 'clear' } to match object { kind: 'held', why: 'no-witness-run' }`. E: `expected { kind: 'acted', … } to match object { kind: 'held', … }` |
| 51 | Hold (e): drop `doc.resume === null &&` (any document with no witness run holds) | `H -t '(e)'`, then `E -t 'resume document with no witness'` | H: `expected { kind: 'held', why: 'no-witness-run', … } to deeply equal { kind: 'clear' }`. E: `it finishes an act begun under these gates: expected { kind: 'held', … } to match object { kind: 'acted' }` |
| 52 | Hold (f): the `catch` returns `{ kind: 'clear' }` | `H -t 'a read that throws'` | `expected { kind: 'clear' } to match object { kind: 'held', why: 'store-unreadable' }` |
| 53 | Hold (f): `if (!worker.ok) return held('store-unreadable', …);` returns `{ kind: 'clear' }` | `H -t 'the session read'` | `expected { kind: 'clear' } to match object { kind: 'held', why: 'store-unreadable' }` |
| 54 | Hold (f): `if (!read.ok) return held('store-unreadable', …);` returns `{ kind: 'clear' }` | `H -t 'witness run'` | "the witness run’s read failing holds": `expected { kind: 'clear' } to match object { kind: 'held', why: 'store-unreadable' }` |
| 55 | `mail-routes.test.ts`: delete the `\|\| isCollectExecutorKebab(tok),` arm, ending the chain at `\|\| isDeadCoordinatorKebab(tok),` again (P9) | `M -t 'every quoted kebab token'` | `not-collectable is not a declared MailRejectCode, … or temp-root collector word: expected false to be true` |
| 56 | `isCollectExecutorKebab`: delete `\|\| (COLLECT_HOLD_WHYS as readonly string[]).includes(v)` (the hold's whys no longer admitted) | `M -t 'every quoted kebab token'` | `no-witness-run is not a declared MailRejectCode, … or temp-root collector word: expected false to be true` |

Two guards are held by the compiler, not by a case; record them as such:
- Deleting `if (obs2.kind !== 'collectable') return …` makes `obs2.token` a TS2339.
- Deleting the (c) arm for a null `witnessAt` makes `doc.witnessAt + CHILD_BIRTH_SKEW_MS` a TS18047.

Neither has a runtime red, because tsc refuses the mutant.

- [ ] **Step 7: Typecheck**

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
```

Expected: no output from either.

- [ ] **Step 8: Commit**

```bash
git add server/src/coord/collectTempRoot.ts server/test/collectTempRootFixture.ts \
  server/test/collect-temp-root.test.ts server/test/collect-temp-root-reads.test.ts \
  server/test/collect-open-run-hold.test.ts server/test/verb-gate.test.ts server/test/ws-collect-wiring.test.ts \
  server/test/mail-routes.test.ts server/test/single-definition.test.ts server/src/ccdargv.ts
git commit -m "$(cat <<'MSG'
feat(server): the temp-root collector's executor, its reads and its open-run hold

collectTempRoot is the one composer of the collector's verb. In order:
- it proves collect-v1, reclaim-pause-v1 and the id predicate;
- it reads the pause switch and defers to presence;
- it audits for observation 2, licenses it against observation 1 from
  the lane's memory, and judges the open-run hold on observation 2's
  document;
- it reads the switches and the live marker as its last await;
- then, with no await before the argv, it re-reads the pair, presence,
  the hold and the capability.
Shadow records would-collect. Live spends observation 2's token on the
job's id; the start hold-off is the lane's, asked at its offer. It
reports every outcome and paces nothing.

readCollectPopulation reads tmproots/ and tmpquarantine/ exactly.
collectSwitches reads both switches from one listing. learnCollect and the
executor share the one audit site. verb-gate classifies ws-collect as
capability-gated, and the wiring census names the executor. The two
ccdargv.ts docstrings that said nothing composes the verb or reads its
capability now name the executor. mail-routes' kebab scanner admits the
executor's words through its own guard, isCollectExecutorKebab, and
single-definition's run-open scan names the executor beside the lane.
Spec §5.10.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

Name these departures, by slug, in the wave-done (H9, H5): `hold-reported-ahead-of-the-licence`, `unplaced-witness-instant-holds`, `audit-gate-refusal-clears-as-caps`, `learn-collect-asks-no-id-predicate` (two checks, as R83 names; H13), and `ccdargv-collect-docstrings-rewritten`. `hold-off-asked-at-step-6-live-only` is VOID (H4) and is not named.

---

---

### Task 7: The L4 pass — `sweepTempRootCollect` in `watch.ts`: one gather, the offers, the fleet-wide slot, the start hold-off, the unsettled line, the flock latch, the live flag, and the publish merge

**Model routing:** **`opus`, effort `xhigh`**. This is SAFETY. It wires the first AUTOMATIC composer of wave 7's destructive `ws-collect`. It decides when an act job may run, how many may be in flight, when the slot comes back, what a stale answer is, and when the lane sees an arming. The executor's own six steps are Task 6's. The per-id pacing and the observation pair are Task 4's.

**Why:** contract §16, which this task implements and never improvises past.
- **R85, "Bounds".**
  - **The pass.** One pass at a time, under `collectSweeping`, which spans the gather and the synchronous decide-and-enqueue ONLY (H1). The pass never awaits a learning audit, an executor job or an act it enqueued. Each is tracked by stamps in memory (`collectInFlight`, the slot), and every pass derives the unsettled lines from them, so a call that never settles cannot stop later passes.
  - The per-id set covers EVERY collector call: the learning audits, and the act job (its own audit and its act). Each call rides `queue.run(id, …)`. No further call is queued for an id whose last call has not settled.
  - **Stale answers.** A lane-wide clear generation and a per-id one are captured when a request is COMPOSED: the executor captures them through the port's `generations` (Task 6). The answer is an observation only if both still stand when it arrives (Task 4's `collectFresh`).
  - **Offers (H1).** At most `COLLECT_AUDITS_PER_PASS` learning audits and at most ONE act job a pass. The act job is offered FIRST, to the earliest ripe id by ripening instant and then id. Learning audits are offered next, to due ids by next-ask instant and then id. Each skips an id with an unsettled or already-enqueued collector call. An id holding an observation is never offered a learning audit: its next ask is its ripening instant.
  - **The fleet-wide slot.** It is taken when the act job is queued. It is freed by any job that composed no `ws-collect`, and by a document or a recognised arm-1 die. It is kept, with its id, until `CHILD_RECLAIM_STALL_MS` after an act that answered no document of arm 2 or 3. A job still unsettled at STALL keeps it.
  - **The start hold-off (H4).** No act job, shadow's would-collect included, is OFFERED until `CHILD_RECLAIM_STALL_MS` after the lane's start, so no `ws-collect` is composed inside it.
  - **Unsettled calls and jobs (H1).** Any collector call still unsettled at its bound (2 × 90 s for an audit, the learning audit and the executor's own alike; STALL for the act) raises ONE box-wide line naming the id. So does an executor JOB not settled STALL after it took the slot, even if it never composed a call (it may wait behind another lane's job on the id's key); that line says the act slot is held. The id is never re-queued until its call or job settles.
  - The pins listed at the end of R85, the three H1 adds among them: a single collectable orphan reaches its executor job within the interval plus two passes; a ripe X with a never-settling call does not stop Y's act; an act, and separately an executor audit, that never settles raises the line at its bound while later passes still compose learning audits for other ids; an executor job queued behind a never-settling job on its key raises the slot-held line at STALL.
- **R82.**
  - The marker is read by the executor alone, nearest the argv.
  - The last-seen-live flag lives in the lane's memory and starts `shadowed`. A flip either way clears every pair, writes ONE feed row, and the job that sees it composes nothing.
  - An unlistable registry is a pause, never shadow.
  - Pin: a lane built with the marker standing writes "now live" and composes nothing on its first job.
- **R86.**
  - The pass starts only under `capSupported(COLLECT_CAP) && capSupported(RECLAIM_PAUSE_CAP)`.
  - `reclaim-paused` is read before any audit; when present, nothing is audited and the pairs clear.
  - The presence defer moves the id's next ask, so an open tab never starves another id (pin).
- **R83.**
  - The population is read INSIDE the pass's one gather.
  - The pre-filter reads the tick's registry names, and is economy, never permission.
  - Forgetting happens only when both listings were measured (Task 3's `collectForgets`, the one rule).
  - Task 6's two reads never reject: a port that rejects makes THAT listing unmeasured, and an unlistable registry reads `paused`. So "a pass that fails shut" is reached through those answers, never through a rejected gather.
- **R87.**
  - One pass, one gather: the throttle and every stored instant are MONOTONIC (`pass-clock-after-gather`).
  - A clear clears the observation PAIRS only, and per-id pacing survives it.
  - `flock-unavailable` latches for the process, and a box-wide line says so while it stands.
  - The pacing rows are Task 4's (H1: the hold waits the ceiling flat; presence waits the ramp over its own count). This task folds each answer through Task 4's transitions and decides no pace of its own.
  - Stated residual: the pacing is memory only, so every restart (a rollout is one) re-enters each terminal and verb-failed id at j = 0, about eight extra terminal audits or failing acts per such id after it.
- **R88.** The collector's items join the list inside `childReclaimPublishAttention`, the list's ONE write, and the collector never assigns the list. Census (c)'s WRITE literal in `child-reclaim-verdict-readers.test.ts` is re-pointed in this commit, from Task 5's interim `CHILD_RECLAIM_COLLECT_NONE` (H8). Stated residual: collector items reach the frame only at the reclaim pass's publish.
- **R82, the feed.** The lane's feed rows are written in `watch.ts`, in `recordExpireFeed`'s idiom, never in `collectLane.ts` or `coord/collectTempRoot.ts`. Task 4's episode memory (`collectFeedStep`) decides when a row is due, over Task 5's cues; Task 5's builders word it.
- **H5.** No commit is red: this commit adds `'watch.ts'` to `ws-collect-wiring.test.ts`'s `COLLECT_CAP` holders, because the pass's gate names `COLLECT_CAP` in `watch.ts`.
- **R91.** Workspace-lifecycle wave 6 (run 358) edits `watch.ts`'s import lines `:112`, `:121` and `:125`, the expiry feed call at about `:4155`, and the dead-coordinator deps at about `:4366` (all at `d0c2b7803`). This task touches none of them:
  - its import block goes after `:136`;
  - the one existing import it edits is the `./childReclaimSweep.js` block (`:94-108`), where it deletes the name `CHILD_RECLAIM_COLLECT_NONE` that Task 5 added (H8), once unused;
  - its pass goes after `execChildReclaim` (about `:4032-4041`);
  - its fields go after `:1195`;
  - its tick call goes after `:1952-1953`.

  If run 358 has merged, re-measure by content. Wave 9 is the second lander.

**Measured at planning:** nothing. Tasks 1–6 are not in the `d0c2b7803` export, so no case below has run. Every count, red text and wall time below is DERIVED. The worker measures each one, and the measured value replaces the derived one. A different count is not a departure; a different meaning is.

**Names.** Every name this task consumes is the canonical one the coordinator's rulings fix (H2, H3, H4, H6, H11), and every behaviour is contract §16's FINAL text (H1). Where an earlier draft of this task assumed a name, the canonical one replaces it; none is reconciled at a call site.

**Departures this task names (by slug; the coordinator numbers them; all accepted in H1, H4 or H9):**
- **`collect-sweeping-is-the-overtaken-guard`** (now §16's text). `collectSweeping` (R85's one-pass-at-a-time guard) is held from before the gather to the end of the pass's decide-and-enqueue, so no pass can start while another gathers, and wave 8's passSeq check is not needed: a pass counter could never differ, and a guard that cannot fire has no red. The throttle keeps both of wave 8's stamps: before the gather, and again after it with the decision clock.
- **`pass-reads-its-switches-in-its-gather`.** R86's pass-start pause read is `collectSwitches` inside the one gather, not the tick's `names`. The tick never hands a lane an unlistable registry, because it returns first. So only the lane's own listing can see R82's "an unlistable registry … the pass audits nothing and clears the observation pairs". The read still comes before any audit. The pass reads `paused` alone and never the listing's `live`, which is the executor's (R82); a source pin holds that.
- **`start-hold-off-asked-at-the-offer`.** The hold-off is asked where the act job is OFFERED (`collectOffers`), not inside the job. A job is composed after it is offered, so "no `ws-collect` until STALL after the start" holds. Shadow's would-collects wait the hold-off too, which is only slower. R85 lists "the start hold-off" among the slot-freeing job outcomes; with no job inside the hold-off, there is no slot to free. H4 rules it so: Task 6 asks no hold-off, and its port has no hold-off member.
- **`lane-bounds-decided-in-l1`.** The offers (`collectCandidateOf`, `collectOffers`), the slot's freeing rules (`collectJobEffects`) and the learning cap (`COLLECT_AUDITS_PER_PASS`, which no other task declares) are L1, appended to `collectLane.ts` by this task. So L4 applies and never decides. Wave 8 made the same move with `childReclaimAskOrder`. The fixed interface names the slot as `watch.ts` state, and it stays there; only its rules move to L1. `CollectJobSettled` is declared there STRUCTURALLY, because L1 may not import Task 6's L3 `CollectJobOutcome` (H2); a compile pin holds that the outcome is assignable to it.
- **`a-thrown-job-reads-as-no-document`.** A learning audit or an act job that REJECTS is a defect the reader could not name.
  - Its id is folded as an audit answering no document, which resets the pair and is paced as a failure.
  - A thrown act job also keeps the slot and its id until STALL after it SETTLED. When it composed is not known, so the later instant is used.
- **`an-answer-for-a-forgotten-id-is-dropped`.** Forgetting does not wait for an id's call to settle. Its answer then finds no entry and is dropped from the id's memory; what it says of the BOX (the box-wide probes, the pass's tally) still counts, and so do the lane effects of an act job. An entry is created only when the lane queues a call, and an id with a call out is never offered another, so an answer is never folded into a re-created entry.
- **`unsettled-bound-counts-from-the-queue`.** Every bound counts from when the lane QUEUED the call or job. A call waiting behind another lane's job for the id counts that wait too. So an act job that never starts still raises the slot-held line at STALL, and is never silent.
- **`collector-records-unread`.** `sweepTempRootCollect(records, names)` keeps the siblings' signature, but `records` is not read. The population is the two listings, never the registry rows (R83 supersedes R58's "through the registry read").

**Stated residuals (in the docstrings):**
- Collector items reach the frame only at the reclaim pass's publish, and stand unchanged while that pass fails shut (R88).
- In local mode, the restart half of "one in flight" rests on the server unit's `KillMode=control-group` (R85).
- A killed ccd's orphaned children are not counted against the slot (R85).
- The unsettled bound counts queueing time (above).
- The pacing is memory only: every restart re-enters each terminal and verb-failed id at j = 0 (R87).

**Files:**
- Modify: `server/src/watch.ts` (L4). Anchors are by content; the line numbers are at `d0c2b7803`.
  - (a) a NEW import block directly after `import { CATALOGUE_POLL_INTERVAL_MS } from './update/catalogue.js';` (`:136`), and the name `CHILD_RECLAIM_COLLECT_NONE` deleted from the `./childReclaimSweep.js` import (`:94-108`, Task 5's addition, unused once (h) lands);
  - (b) `COLLECT_OBSERVE_INTERVAL_MS` directly after `export const CHILD_RECLAIM_SWEEP_MS = 60_000;` (`:178`);
  - (c) `COLLECT_AUDIT_STALL_MS`, `CollectFlight` (with its `phase`) and `CollectSlot` directly after `export const CHILD_RECLAIM_STALL_MS = 480_000;` (`:196`);
  - (d) the lane's fields directly after `  private deadCoordinatorSerial: CoordRoutesHandle['withSweepAbandon'] | null = null;` (`:1195`);
  - (e) one line at the end of the constructor body (`:1242`);
  - (f) the accessor `currentCollectLane()` directly after `currentDeadCoordinators()`'s closing brace (`:1728-1730`);
  - (g) the tick's dispatch directly after `sweepDeadCoordinators`'s `.catch` line (`:1952-1953`);
  - (h) the `childReclaimAttentionList` field docstring (one bullet), and `childReclaimPublishAttention`'s docstring and third argument, Task 5's `CHILD_RECLAIM_COLLECT_NONE` (`:3959-3971`);
  - (i) the pass, its folds, its port, its feed writer and its private helpers, directly after `execChildReclaim`'s closing brace (`:4041`) and before the expiry lane's docstring.
- Modify: `server/src/collectLane.ts` (L1, Task 2's file): append `COLLECT_AUDITS_PER_PASS`, `CollectCandidate`, `collectCandidateOf`, `CollectOfferInput`, `CollectOffers`, `collectOffers`, `CollectJobSettled`, `CollectJobEffects` and `collectJobEffects` at its FOOT. Nothing above the foot changes, and no import line is added (H2).
- Modify: `server/test/child-reclaim-verdict-readers.test.ts`: case (c)'s `WRITE` literal and its comment only.
- Modify: `server/test/ws-collect-wiring.test.ts`: the INERT `it`'s `COLLECT_CAP` holder list only, which gains `'watch.ts'` (H5). Every other line stays byte for byte; the describe's title and messages are Task 8's.
- Create: `server/test/collectLaneFixture.ts` (THE collector lane rig; a later task adds to it, never a second rig).
- Test (new):
  - `server/test/collect-lane-bounds.test.ts` (L1);
  - `server/test/collect-lane-pass.test.ts` (the pass);
  - `server/test/collect-lane-slot.test.ts` (the SAFETY bounds).
- No edit to:
  - `shared/api.ts`, `README.md`, `ccd/`, `agent/` or `pwa/`;
  - `single-definition.test.ts` or `verb-gate.test.ts` (Task 8's);
  - `coord/collectTempRoot.ts` or `server/test/collectTempRootFixture.ts` (Task 6's), or any line of `collectLane.ts` above its foot.

**Interfaces:**
- Consumes. These are the canonical names and signatures the coordinator's rulings fix (H2, H3, H4, H6, H11), each owned by the named task. A name that is missing, or a signature that differs, STOPS this task at Step 1. It is never reconciled by renaming at the call site.
  - **Task 1 (`shared/api.ts` foot).**
    - `type CollectToken`;
    - `interface ChildReclaimCollectAttention { kind: 'collect'; sessionId: string; runId: number | null; word: string; sentence: string }`, an arm of `ChildReclaimAttention`;
    - `COLLECT_BOX_LABELS`, the total table of box-wide labels (keys `tmproots`, `tmpquarantine`, `refused-names`, `box-probe`, `no-document`, `lock`, `flock`, `unsettled`, `unvouched`, `no-run`), read with `Object.values` and by key.
  - **`server/src/ccdargv.ts` (wave 7):** `COLLECT_CAP` (`'collect-v1'`, `:897`), `RECLAIM_PAUSE_CAP`, and `capSupported(state, cap): boolean`.
  - **Task 2 (`collectLane.ts`):**
    - `type CollectAudit`: its `collectable`, `verdict` and `unmeasured` arms carry `witnessRun` and `leaf` (H3), and its no-document arm is exactly `{ kind: 'no-document'; stderr: string }`;
    - `type CollectResult` (`collected | refused | failed | die | no-document`);
    - `COLLECT_LANE_LIVE_MARKER`, read by the TESTS only (H11). `watch.ts` never names it: the marker is the executor's.
  - **Task 3 (`collectLane.ts`):**
    - `type CollectListing`;
    - `type CollectPopulation`, of which this task reads `candidates`, `unmeasured` and `refusedNames`;
    - `collectPopulation(input: { tmproots: CollectListing; tmpquarantine: CollectListing; registryNames: ReadonlySet<string> }): CollectPopulation`;
    - `collectForgets(pop: CollectPopulation, id: string): boolean`, the ONE forgetting rule (both listings measured, neither names the id).
  - **Task 4 (`collectLane.ts`).** The semantics relied on: only the OBSERVATION is gated on the generations, and every other effect of a late answer still folds; every generation is drawn from ONE counter the lane keeps; a lane-wide clear moves the lane's generation AND maps every entry through `collectClearPair` (the pairs only: pacing, runs, clocks and episodes survive).
    ```ts
    export interface CollectEntry { readonly idGen: number; readonly obs: CollectObservation | null; readonly evidence: CollectEvidence; /* …Task 4's… */ }
    export interface CollectObservation { readonly token: CollectToken; readonly arrivedMono: number }
    export interface CollectStep { readonly now: ChildReclaimLaneNow; readonly gen: number; readonly passIntervalMs: number }
    export interface CollectCapture { readonly lane: number; readonly id: number }
    export const collectFirstSighting: (gen: number) => CollectEntry;
    export const collectFresh: (cap: CollectCapture, laneGen: number, e: CollectEntry | undefined) => e is CollectEntry;
    export const collectClearPair: (e: CollectEntry) => CollectEntry;
    export function collectAfterAudit(e: CollectEntry, a: CollectAudit, s: CollectStep, observes: boolean): CollectEntry;
    export function collectAfterAct(e: CollectEntry, r: CollectResult, s: CollectStep): CollectEntry;
    export function collectAfterHold(e: CollectEntry, why: CollectHoldWhy, s: CollectStep): CollectEntry;
    export function collectAfterPresence(e: CollectEntry, s: CollectStep): CollectEntry;
    export function collectAfterWouldCollect(e: CollectEntry, s: CollectStep): CollectEntry;
    export function collectNextAskMono(e: CollectEntry, passIntervalMs: number, observeIntervalMs: number): number | null; // null: due at once
    export const collectRipe: (e: CollectEntry, nowMono: number, passIntervalMs: number, observeIntervalMs: number) => boolean;
    export type CollectFeedCue = { kind: 'row'; key: string } | { kind: 'observe'; token: CollectToken } | { kind: 'quiet' };
    export function collectFeedStep(e: CollectEntry, cue: CollectFeedCue): { readonly entry: CollectEntry; readonly opened: string | null };
    export const collectWouldCollectKey: (token: CollectToken) => string;
    ```
  - **Task 5 (`collectLane.ts`, `childReclaimSweep.ts`).**
    ```ts
    // collectLane.ts
    export interface CollectAttentionView { /* …Task 5's… */ }
    export function collectAttentionViewOf(e: CollectEntry): CollectAttentionView;
    export type CollectPassClass = 'no-document' | 'lock' | 'other';
    export type CollectUnsettledKind = 'audit' | 'act' | 'job';
    export interface CollectBoxFacts {
      readonly unmeasured: readonly CollectListingDoubt[]; readonly refusedNames: number;
      readonly boxProbes: ReadonlyMap<string, string>; readonly passAudits: ReadonlyMap<string, CollectPassClass>;
      readonly flockLatched: boolean; readonly unsettled: ReadonlyMap<string, CollectUnsettledKind>;
    }
    export function collectPassClass(a: CollectAudit): CollectPassClass;
    export function collectBoxProbesAfter(prev: ReadonlyMap<string, string>, a: CollectAudit | CollectResult): ReadonlyMap<string, string>;
    export function collectAttentionItems(i: {
      readonly entries: ReadonlyMap<string, CollectAttentionView>; readonly box: CollectBoxFacts; readonly nowMono: number;
    }): ChildReclaimCollectInput;
    export function collectFeedCueOfAudit(a: CollectAudit): CollectFeedCue;   // collectable: observe; anything else: one row per episode
    export function collectFeedCueOfAct(r: CollectResult): CollectFeedCue;    // one row per (outcome, word) episode
    export type CollectFeedKind = 'collected' | 'would-collect' | 'answer' | 'switch';
    export const COLLECT_FEED_TITLE: Readonly<Record<CollectFeedKind, string>>;
    export function collectFeedCollectedBody(id: string, runId: number | null, leaf: string | null,
      r: Extract<CollectResult, { readonly kind: 'collected' }>): string;
    export function collectFeedWouldCollectBody(id: string, runId: number | null, leaf: string | null): string; // "would collect <id>…"
    export const collectFeedSwitchBody: (live: boolean) => string;                                            // "now live" / "now shadowed"
    export function collectFeedAnswerBody(id: string, runId: number | null, word: string, detail: string | null,
      paths: readonly string[]): string;
    // childReclaimSweep.ts
    export interface ChildReclaimCollectInput { /* perId, manyLead, box: Task 5's */ }
    export const CHILD_RECLAIM_COLLECT_NONE: ChildReclaimCollectInput;   // Task 5's interim third argument (H8)
    export function childReclaimAttentionWithLeaves(list: readonly ChildReclaimAttention[],
      leaves: readonly ChildReclaimLeafKept[], collect: ChildReclaimCollectInput): ChildReclaimAttention[];
    ```
    Task 5 leaves the publish call's third argument as `CHILD_RECLAIM_COLLECT_NONE`, imported in `watch.ts`'s `./childReclaimSweep.js` block (`:94-108`), and census (c)'s `WRITE` literal to match.
  - **Task 6 (`coord/collectTempRoot.ts`, L3; the port declared by this consumer's executor, implemented here).**
    ```ts
    export interface CollectClock { readonly mono: number; readonly wall: number }
    export type CollectGenerations = CollectCapture;
    export interface CollectAnswer<T> { readonly value: T; readonly composed: CollectGenerations; readonly arrived: CollectClock }
    /** Every member synchronous; no hold-off member (H4). */
    export interface CollectLanePort {
      clock(): CollectClock;
      generations(id: string): CollectGenerations;
      observation(id: string): CollectObservation | null;
      cleared(why: 'paused' | 'caps'): void;
      flipped(live: boolean): boolean;
    }
    export interface CollectTempRootDeps {
      coord: Pick<CoordStore, 'run' | 'openRunsForSession' | 'openRunsClaimedBy'>; io: Pick<FleetIO, 'readdir'>;
      cfg: Pick<CcrcConfig, 'registryDir'>; runCcd: Deps['runCcd']; fleetState?: FleetState;
      presence?: Pick<Presence, 'isVisible'>; lane: CollectLanePort; observeIntervalMs: number;
    }
    export interface CollectJob { readonly id: string }
    export type CollectJobOutcome =
      | { kind: 'not-asked'; step: 1 | 2 | 3 | 4; why: 'caps' | 'id-refused' | 'paused' | 'presence'; detail: string }
      | { kind: 'answered'; step: 4 | 5 | 6; why: CollectAnsweredWhy; detail: string; audit: CollectAnswer<CollectAudit> }
      | { kind: 'held'; step: 4 | 6; hold: CollectHeld; audit: CollectAnswer<CollectAuditCollectable> }
      | { kind: 'would-collect'; audit: CollectAnswer<CollectAuditCollectable> }
      | { kind: 'acted'; audit: CollectAnswer<CollectAuditCollectable>; composedMono: number; result: CollectResult;
          arrived: CollectClock };
    export type CollectLearnAnswer =
      | { kind: 'not-asked'; why: 'caps' } | { kind: 'answered'; audit: CollectAnswer<CollectAudit> };
    // NEVER rejects: a port that rejects makes THAT listing unmeasured (R83).
    export function readCollectPopulation(io: Pick<FleetIO, 'lstatMeasured' | 'readdir' | 'statMeasured'>, registryDir: string):
      Promise<{ tmproots: CollectListing; tmpquarantine: CollectListing }>;
    // Never rejects: an unlistable or rejecting listing is { paused: true, live: false }.
    export function collectSwitches(io: Pick<FleetIO, 'readdir'>, registryDir: string): Promise<{ paused: boolean; live: boolean }>;
    export function learnCollect(deps: Pick<CollectTempRootDeps, 'runCcd' | 'fleetState' | 'lane'>, id: string): Promise<CollectLearnAnswer>;
    export function collectTempRoot(deps: CollectTempRootDeps, job: CollectJob): Promise<CollectJobOutcome>;
    ```
    The executor captures the generations through `lane.generations` as it composes each audit, applies every lane-wide clear it sees through `lane.cleared` or `lane.flipped` before it returns (so the lane never folds one twice), and makes every ccd call through the `runCcd` it is handed. It writes no feed row (R82).
  - **`watch.ts` itself:** `childReclaimLaneNow()` (`:3865`), `this.deps.queue`, `this.deps.notifyLog`, `CHILD_RECLAIM_SWEEP_MS` (`:178`), `CHILD_RECLAIM_STALL_MS` (`:196`), and `childReclaimPublishAttention` (`:3964`).
  - **Tests:** `codeOnly` (`server/test/sourceScan.ts`), `testDeps` and `seedRoster` (`server/test/helpers.ts`), `mkTmp`, `NotifyLog`, and `FULL_CAPS` (`server/test/collectTempRootFixture.ts`, Task 6's: the rig advertises it rather than a copy).
- Produces:
  ```ts
  // server/src/watch.ts (L4)
  export const COLLECT_OBSERVE_INTERVAL_MS = CHILD_RECLAIM_SWEEP_MS;
  export const COLLECT_AUDIT_STALL_MS = 2 * 90_000;           // pinned against remote/runner.ts's ws-audit row
  export interface CollectFlight {
    readonly kind: 'learn' | 'act'; readonly sinceMono: number; readonly phase: 'queued' | 'audit' | 'act' }
  export type CollectSlot =
    | { readonly kind: 'free' }
    | { readonly kind: 'job'; readonly id: string; readonly sinceMono: number }
    | { readonly kind: 'kept'; readonly id: string; readonly untilMono: number };
  FleetWatcher.sweepTempRootCollect(records: readonly SessionRecord[], names: readonly string[]): Promise<void>;
  FleetWatcher.currentCollectLane(): {
    readonly entries: ReadonlyMap<string, CollectEntry>; readonly inFlight: ReadonlyMap<string, CollectFlight>;
    readonly slot: CollectSlot; readonly laneGen: number; readonly lastSeenLive: boolean; readonly flockLatched: boolean };
  // server/src/collectLane.ts (L1, appended at the foot)
  export const COLLECT_AUDITS_PER_PASS = 2;
  export interface CollectCandidate {
    readonly id: string; readonly nextAskMono: number; readonly ripeningMono: number | null; readonly ripe: boolean }
  export function collectCandidateOf(id: string, entry: CollectEntry | undefined, nowMono: number, passIntervalMs: number,
    observeIntervalMs: number): CollectCandidate;
  export interface CollectOfferInput { readonly candidates: readonly CollectCandidate[]; readonly busy: ReadonlySet<string>;
    readonly nowMono: number; readonly auditsMax: number;
    readonly act: { readonly slotFree: boolean; readonly flockLatched: boolean; readonly startMono: number; readonly holdOffMs: number } }
  export interface CollectOffers { readonly learn: readonly string[]; readonly act: string | null }
  export function collectOffers(i: CollectOfferInput): CollectOffers;
  export type CollectJobSettled =
    | { readonly kind: 'not-asked' | 'answered' | 'held' | 'would-collect' }
    | { readonly kind: 'acted'; readonly composedMono: number; readonly result: CollectResult }
    | { readonly kind: 'threw'; readonly detail: string };
  export interface CollectJobEffects { readonly keptUntilMono: number | null; readonly latchFlock: boolean }
  export function collectJobEffects(s: CollectJobSettled, settledMono: number, stallMs: number): CollectJobEffects;
  // server/test/collectLaneFixture.ts
  export const collectRig: (opts?: CollectRigOpts) => Promise<…>;
  export type CollectRig; export interface CollectRigOpts; export interface CollectCall; export interface CcdAnswer;
  export type CollectVerb;
  ```
- For the later tasks:
  - **Task 8.**
    - `ws-collect-wiring.test.ts` is GREEN at Task 8's entry: this task added `'watch.ts'` to the INERT case's `COLLECT_CAP` holders (H5). Task 8's rewrite of that describe keeps `['ccdargv.ts', 'coord/collectTempRoot.ts', 'watch.ts']`.
    - `watch.ts` spells neither `wsCollect` nor `wsCollectAudit`, `'ws-collect'`, `'--collect'`, `collect-lane-live` or `COLLECT_LANE_LIVE_MARKER`. Its runner wrapper tells an audit by `argv[0] === 'ws-audit'` alone.
    - The census title edit is Task 8's.
    - Tasks 8 and 9 import `COLLECT_AUDITS_PER_PASS` from `collectLane.ts`.
  - **Task 9.** The spec text (§5.10) describes this pass as built. "§16 as built" names this task's departures above by slug.

- [ ] **Step 1: Re-measure the anchors (read-only)**

```bash
grep -n "^import { CATALOGUE_POLL_INTERVAL_MS } from './update/catalogue.js';\|^export const CHILD_RECLAIM_SWEEP_MS = 60_000;\|^export const CHILD_RECLAIM_STALL_MS = 480_000;\|  private deadCoordinatorSerial: CoordRoutesHandle\['withSweepAbandon'\] | null = null;\|    this.headsSettled = new Promise<void>((resolve) => { this.settleHeads = resolve; });\|  currentDeadCoordinators(): ReadonlyMap<string, DeadCoordinatorEntry> {\|      void this.sweepDeadCoordinators(records, registryRead.names)\|  private childReclaimPublishAttention(\|  private execChildReclaim(coord: CoordStore, req: ChildReclaimRequest): Promise<ChildReclaimOutcome> {" server/src/watch.ts
# at d0c2b7803: 136, 178, 196, 1195, 1242, 1728, 1952, 3964, 4032
grep -n "this.childReclaimAttentionList = childReclaimAttentionWithLeaves(" -A1 server/src/watch.ts   # Task 5's call: its third argument is CHILD_RECLAIM_COLLECT_NONE
grep -n "CHILD_RECLAIM_COLLECT_NONE" server/src/watch.ts           # two lines: the ./childReclaimSweep.js import (:94-108) and the call
grep -nE "^export (const|function|type|interface) (collectFirstSighting|collectFresh|collectClearPair|collectAfterAudit|collectAfterAct|collectAfterHold|collectAfterPresence|collectAfterWouldCollect|collectNextAskMono|collectRipe|collectFeedStep|collectWouldCollectKey|CollectFeedCue|CollectEntry|CollectObservation|CollectStep|CollectCapture)\b" server/src/collectLane.ts   # Task 4
grep -nE "^export (const|function|type|interface) (CollectAudit|CollectResult|COLLECT_LANE_LIVE_MARKER|CollectListing|CollectPopulation|collectPopulation|collectForgets)\b" server/src/collectLane.ts   # Tasks 2 and 3
grep -nE "^export (const|function|type|interface) (collectAttentionViewOf|CollectAttentionView|CollectPassClass|CollectUnsettledKind|CollectBoxFacts|collectPassClass|collectBoxProbesAfter|collectAttentionItems|collectFeedCueOfAudit|collectFeedCueOfAct|COLLECT_FEED_TITLE|collectFeedCollectedBody|collectFeedWouldCollectBody|collectFeedSwitchBody|collectFeedAnswerBody)\b" server/src/collectLane.ts   # Task 5
grep -nE "^export (const|interface) (CHILD_RECLAIM_COLLECT_NONE|ChildReclaimCollectInput)\b" server/src/childReclaimSweep.ts   # Task 5
grep -n "COLLECT_AUDITS_PER_PASS\|collectOffers\|collectJobEffects\|collectCandidateOf" server/src/collectLane.ts   # prints NOTHING: this task declares them
grep -n "^import" server/src/collectLane.ts                         # exactly the two H2 specifiers: ../../shared/api.js and ./childReclaimSweep.js
grep -nE "^export (async function|function|type|interface) (readCollectPopulation|collectSwitches|learnCollect|collectTempRoot|CollectLanePort|CollectJobOutcome|CollectLearnAnswer|CollectGenerations|CollectClock|CollectAnswer)\b" server/src/coord/collectTempRoot.ts   # Task 6
grep -n "holdOffUntilMono\|recordCollectFeed\|collectFlipFeedRow" server/src/coord/collectTempRoot.ts server/src/collectLane.ts   # prints NOTHING (H4, R82)
grep -n "const WRITE = 'this.childReclaimAttentionList" -A1 server/test/child-reclaim-verdict-readers.test.ts   # ends `, CHILD_RECLAIM_COLLECT_NONE)'`
grep -n "declared, read by nothing" server/test/ws-collect-wiring.test.ts   # Task 6's list: ['ccdargv.ts', 'coord/collectTempRoot.ts']
grep -n "^export const FULL_CAPS" server/test/collectTempRootFixture.ts     # Task 6's
grep -n "'ws-audit': 90_000," server/src/remote/runner.ts                                   # 49
grep -n "^export const COLLECT_BOX_LABELS\|^export interface ChildReclaimCollectAttention\|^export type CollectToken" shared/api.ts
```

Every Task 1–6 name above must be found, and each name this task declares must be absent.
- A missing one, or one whose signature differs from **Interfaces → Consumes**, STOPS this task. Name it in the progress ledger as `collect-lane-consumes-<name>`, and do not invent the name. Never rename at the call site to make a mismatch compile.
- If run 358 (workspace-lifecycle wave 6) has merged, the import lines near `:112`, `:121` and `:125`, the expiry feed call and the dead-coordinator deps have moved. This task touches none of them. Re-measure by content.

- [ ] **Step 2: Write the failing tests**

Create `server/test/collectLaneFixture.ts`:

```ts
// Child reclamation wave 9 (spec §5.10): THE collector lane's rig, shared by `collect-lane-pass.test.ts` and
// `collect-lane-slot.test.ts`. A later task that needs more of it adds a member here, additively, and never builds a
// second watcher rig for this lane. What it is:
// - a real `FleetWatcher`, a real `CoordStore` and a real `KeyedQueue` (`testDeps`'s), with the registry, its
//   `tmproots/`, its `tmpquarantine/` and its switches under a fixture HOME, read through the real `localIO`;
// - the REAL population read, switches, learning audit and executor (`coord/collectTempRoot.ts`), and the real L1;
// - a scripted ccd behind the agent's real exec whitelist: a MODEL of `ws-audit --collect` and `ws-collect`, printing
//   the documents ccd prints (`_ws_collect_audit_doc`'s keys, the verb's done line), one token per id, spent only while
//   it is the current one. A case can script any id's answers, and HOLD any call, or the next registry listing, until it
//   releases it;
// - two clocks a case moves together: the wall clock (`Date.now`) and the lane's monotonic clock (`monotonicMs`);
// - `pass()` resolves when the pass has decided and enqueued, as the lane's own pass does (spec §5.10: a pass never
//   awaits a call it queued), and `settled()` waits for those calls, all but the ones a case is holding.
// The witness's run is a CLOSED run, opened before the witness was written, so the open-run hold never applies unless a
// case makes it. FIXTURE HOME ONLY: every path derives from `mkTmp`; no `ccd` runs and nothing reaches a box.
import { vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_STALL_MS, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { COLLECT_FEED_TITLE, COLLECT_LANE_LIVE_MARKER } from '../src/collectLane.js';
import { NotifyLog } from '../src/notifylog.js';
import type { FleetIO } from '../src/io.js';
import type { Runner } from '../src/exec.js';
import { COLLECT_BOX_LABELS, type ChildReclaimAttention, type ChildReclaimCollectAttention } from '../../shared/api.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { FULL_CAPS } from './collectTempRootFixture.js';

export type CollectVerb = 'audit' | 'collect';
export interface CcdAnswer { readonly code: number; readonly stdout: string; readonly stderr?: string }
/** One collector call ccd received, in arrival order: the verb, the id, the token a `ws-collect` spent, and the rig's
 *  monotonic clock when the server composed it. */
export interface CollectCall { readonly verb: CollectVerb; readonly id: string; readonly token: string | null; readonly mono: number }

export interface CollectRigOpts {
  /** A RESTART: an earlier rig's HOME, coord.db, feed log, witness run and clocks. */
  readonly home?: string;
  readonly coord?: CoordStore;
  readonly notifyLog?: NotifyLog;
  readonly mintingRun?: number;
  readonly clock?: number;
  readonly mono?: number;
  /** The live marker already stands when the watcher is built. */
  readonly armed?: boolean;
}

/** The rig's WALL-clock origin. Module-private: Task 6's fixture exports a monotonic `T0`, and one name must not mean
 *  two clocks. The advertised verbs are Task 6's `FULL_CAPS`, never a copy. */
const WALL_T0 = 1_790_000_000_000;
const LABELS: ReadonlySet<string> = new Set(Object.values(COLLECT_BOX_LABELS) as string[]);
let progN = 0;

export const collectRig = async (opts: CollectRigOpts = {}) => {
  let clock = opts.clock ?? WALL_T0;
  let mono = opts.mono ?? 5_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const home = opts.home ?? mkTmp('ccrc-collect-lane-');
  seedRoster(home);
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  const reg = cfg.registryDir;
  const tmproots = path.join(reg, 'tmproots');
  const quarantine = path.join(reg, 'tmpquarantine');
  mkdirSync(tmproots, { recursive: true });
  const coord = opts.coord ?? new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  let notifyLog = opts.notifyLog;
  if (notifyLog === undefined) {
    notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
  }
  // THE WITNESS'S RUN: closed (terminal), present, and opened before the witness was written (spec §5.10's hold).
  const mintingRun = opts.mintingRun ?? (() => {
    const program = `w9-collect-${++progN}`;
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    const c = coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program,
      viaClosing: false });
    if (!c.ok) throw new Error(`abandon refused: ${JSON.stringify(c)}`);
    return r.id;
  })();
  const witnessAt = WALL_T0 + 1_000;

  // ── the scripted ccd ──
  const tokenOf = (id: string): string => createHash('sha256').update(`collect ${id}`).digest('hex');
  const collectable = (id: string): CcdAnswer => ({ code: 0, stdout: JSON.stringify({
    session: id, mode: 'collect', exists: true,
    collect: { leaf: path.join(home, '.cc-tmp', id), records: [], newestCtimeNs: '1789990000000000000', entries: 3,
      floorS: 86400, idleAt: 1_789_990_000 + 86_400, unmeasured: null,
      witness: { dev: '2049', ino: '77', btime: '1789990000', run: String(mintingRun), at: String(witnessAt) } },
    verdict: 'collectable', detail: '', token: tokenOf(id) }) });
  const lockPath = (id: string): string => path.join(reg, `.reap-${id}.lock`);
  const answers = {
    collectable,
    /** No document, no recognised die: a runner kill, a timeout, a link failure (arms 2 and 3). It MAY have acted. */
    noDocument: (): CcdAnswer => ({ code: 1, stdout: '', stderr: '' }),
    /** ccd's own lock-unopenable die: bash's line for the lock path, then ccd's. It acted nothing. */
    lockUnopenable: (id: string): CcdAnswer => ({ code: 1, stdout: '',
      stderr: `${cfg.ccdBin}: line 34101: ${lockPath(id)}: Is a directory\nccd: cannot open the reap lock at ${lockPath(id)}\n` }),
    flockUnavailable: (): CcdAnswer => ({ code: 1, stdout: '',
      stderr: 'ccd: flock (util-linux) is unavailable — refusing to run the destructive verb unserialised\n' }),
  };
  const model = (verb: CollectVerb, id: string, args: readonly string[]): CcdAnswer => {
    if (verb === 'audit') return collectable(id);
    if (args[args.indexOf('--expect') + 1] !== tokenOf(id)) {
      return { code: 0, stdout: JSON.stringify({ refused: 'state-changed', detail: 'the token no longer binds it', paths: [] }) };
    }
    rmSync(path.join(tmproots, id), { force: true });                      // the witness is dropped with the leaf
    return { code: 0, stdout: JSON.stringify({ collected: id, record: `${id}.1790000000000000000.4242`, resumed: false,
      witness: 'dropped' }) };
  };
  const scripts = new Map<string, (verb: CollectVerb, args: readonly string[]) => CcdAnswer | undefined>();
  const holds = new Map<string, { promise: Promise<void>; reached: boolean }>();
  /** Per id, how many of its calls a case is holding (`hold` or `holdListing` reached, `occupy` standing): `settled()`
   *  waits on none. */
  const parked = new Map<string, number>();
  const park = (id: string, by: number): void => {
    const n = (parked.get(id) ?? 0) + by;
    if (n > 0) parked.set(id, n); else parked.delete(id);
  };
  const onCall: ((c: CollectCall) => void)[] = [];
  const calls: CollectCall[] = [];
  const run: Runner = async (cmd, args) => {
    if (path.basename(cmd) === 'tmux') return { code: 1, stdout: '', stderr: '' };   // the tick's pane reads, not ccd
    const verb: CollectVerb | null = args[0] === 'ws-audit' && args.includes('--collect') ? 'audit'
      : args[0] === 'ws-collect' ? 'collect' : null;
    if (verb === null) return { code: 1, stdout: '', stderr: `unscripted ${args[0] ?? ''}` };
    const id = args[args.indexOf('--session') + 1] ?? '';
    const call: CollectCall = { verb, id, token: verb === 'collect' ? (args[args.indexOf('--expect') + 1] ?? null) : null, mono };
    calls.push(call);
    for (const f of onCall) f(call);
    const key = `${verb} ${id}`;
    const h = holds.get(key);
    if (h !== undefined) {
      holds.delete(key); h.reached = true; park(id, 1);
      try { await h.promise; } finally { park(id, -1); }
    }
    const a = scripts.get(id)?.(verb, args) ?? model(verb, id, args);
    return { code: a.code, stdout: a.stdout, stderr: a.stderr ?? '' };
  };

  // ── the io: the real one, with three switches a case throws ──
  const base = testDeps(home, run);
  let gate: Promise<void> | null = null;   // while set, the population's lstat of `tmproots` waits on it
  let gatherReached = 0;                   // how many gathers reached the population read
  let unlistable = false;                  // the registry's own listing fails (null), as an unreadable `$REG` does
  let rejecting = false;                   // the population's lstat of EITHER listing rejects, as a port gone mid-call does
  let listingHold: { readonly promise: Promise<void>; readonly id: string } | null = null;   // the NEXT `$REG` listing waits
  const io: FleetIO = {
    ...base.io,
    async lstatMeasured(p) {
      const leaf = path.basename(p);
      if (leaf === 'tmproots') gatherReached += 1;
      if (rejecting && (leaf === 'tmproots' || leaf === 'tmpquarantine')) throw new Error('agent gone');
      if (leaf === 'tmproots' && gate !== null) await gate;
      return base.io.lstatMeasured(p);
    },
    async readdir(p, timeoutMs, signal) {
      if (p === reg && listingHold !== null) {
        const h = listingHold;
        listingHold = null; park(h.id, 1);
        try { await h.promise; } finally { park(h.id, -1); }
      }
      if (p === reg && unlistable) return null;
      return base.io.readdir(p, timeoutMs, signal);
    },
  };
  const fleetState = { connected: true, downSince: null, rosterFp: null, build: null, ccdVerbs: [...FULL_CAPS] };
  let visible: (id: string) => boolean = () => false;
  const deps = { ...base, cfg, io, coord, notifyLog, fleetState, presence: { isVisible: (id: string) => visible(id) },
    monotonicMs: () => mono };
  if (opts.armed === true) writeFileSync(path.join(reg, COLLECT_LANE_LIVE_MARKER), '');
  const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  const startMono = mono;

  // ── helpers ──
  const names = (): string[] => readdirSync(reg);
  /** A witnessed temp root: `$REG/tmproots/<id>` (the lane never reads its bytes; ccd does). */
  const witness = (id: string): void => {
    writeFileSync(path.join(tmproots, id), `dev=2049 ino=77 btime=1789990000 run=${mintingRun} uid=1000 at=${witnessAt}\n`);
  };
  const unwitness = (id: string): void => { rmSync(path.join(tmproots, id), { force: true }); };
  const touch = (name: string): void => { writeFileSync(path.join(reg, name), ''); };
  const remove = (name: string): void => { rmSync(path.join(reg, name), { force: true }); };
  /** One pass, over a listing the tick would hand it (default: the registry as it stands). Resolves when the pass has
   *  decided and enqueued: it never awaits a call it queued (spec §5.10). `settled()` waits for those. */
  const pass = async (listing: readonly string[] = names()): Promise<void> => {
    await watcher.sweepTempRootCollect([], listing);
  };
  /** Waits until every collector call the lane has queued has settled (its fold, its slot effect and its feed row
   *  applied), but for the calls a case is holding (`hold` or `holdListing` reached, `occupy` standing). Read what a
   *  pass's calls did after this. */
  const settled = async (): Promise<void> => {
    // A call or job a case has just RELEASED is unparked a microtask later (`hold`'s and `occupy`'s `finally`): let
    // those run first, or this resolves before the released call has even been composed.
    await new Promise<void>((r) => { setImmediate(r); });
    await vi.waitFor(() => {
      const open = [...watcher.currentCollectLane().inFlight.keys()].filter((id) => !parked.has(id));
      if (open.length > 0) throw new Error(`collector calls not settled: ${open.join(', ')}`);
    }, { timeout: 5_000, interval: 1 });
  };
  const next = (): void => { clock += CHILD_RECLAIM_SWEEP_MS + 1; mono += CHILD_RECLAIM_SWEEP_MS + 1; };
  const advance = (ms: number): void => { clock += ms; mono += ms; };
  /** Past the lane's start hold-off: `CHILD_RECLAIM_STALL_MS` after the watcher was built. */
  const pastHoldOff = (): void => { advance(CHILD_RECLAIM_STALL_MS); };
  /** `next()`, a pass and its calls settled, until `pred` holds; the number of passes it took. Throws past `max`. */
  const passesUntil = async (pred: () => boolean, max = 30): Promise<number> => {
    for (let n = 1; n <= max; n += 1) {
      next();
      await pass();
      await settled();
      if (pred()) return n;
    }
    throw new Error(`not reached within ${max} passes`);
  };
  /** The NEXT `verb` for `id` waits until released. */
  const hold = (verb: CollectVerb, id: string): { release: () => void; reached: () => boolean } => {
    let release: () => void = () => {};
    const h = { promise: new Promise<void>((r) => { release = r; }), reached: false };
    holds.set(`${verb} ${id}`, h);
    return { release: () => release(), reached: () => h.reached };
  };
  /** Every gather's population read waits until released. */
  const holdGather = (): { release: () => void } => {
    let release: () => void = () => {};
    gate = new Promise<void>((r) => { release = r; });
    return { release: () => { gate = null; release(); } };
  };
  /** The NEXT listing of the registry itself (a switches read: a pass's gather, or an act job's step 2 or step 5) waits
   *  until released, counted as one of `id`'s held calls. Arm it from `onCall` at the job's own audit to hold its step 5. */
  const holdListing = (id: string): { release: () => void } => {
    let release: () => void = () => {};
    listingHold = { promise: new Promise<void>((r) => { release = r; }), id };
    return { release: () => release() };
  };
  /** A job on the id's queue key that holds it until released: another lane's executor (a reclaim, an expiry). The
   *  id's collector calls queued behind it are held with it. */
  const occupy = (id: string): (() => void) => {
    let release: () => void = () => {};
    const p = new Promise<void>((r) => { release = r; });
    park(id, 1);
    void base.queue.run(id, () => p).finally(() => park(id, -1));
    return () => release();
  };
  /** Makes the lane LIVE as the operator does: the marker touched, and one act job (on `via`, which then leaves the
   *  listing) seeing it, composing nothing. Call it past the start hold-off, before planting the ids a case asks about. */
  const goLive = async (via = 'demo-z'): Promise<void> => {
    touch(COLLECT_LANE_LIVE_MARKER);
    witness(via);
    await passesUntil(() => watcher.currentCollectLane().lastSeenLive);
    unwitness(via);
  };
  const audits = (id?: string): CollectCall[] => calls.filter((c) => c.verb === 'audit' && (id === undefined || c.id === id));
  const collects = (id?: string): CollectCall[] => calls.filter((c) => c.verb === 'collect' && (id === undefined || c.id === id));
  const feed = () => coord.feedEvents(500).map((e) => ({ sessionId: e.sessionId, title: e.title, body: e.body }));
  /** The would-collect rows for `id` (spec §5.10: shadow writes "would collect <id>"), by Task 5's title. */
  const wouldCollects = (id: string) => feed().filter((e) => e.title === COLLECT_FEED_TITLE['would-collect']
    && e.body.includes(`would collect ${id}`));
  /** The attention list as the frame carries it: the child lane's pass PUBLISHES (its one write merges the collector's
   *  items), then a tick emits the frame. Call it right after a pass, at that pass's clock, so the tick's own dispatch of
   *  both lanes is throttled. */
  const attention = async (): Promise<readonly ChildReclaimAttention[]> => {
    await watcher.sweepChildReclaim([], names());
    await watcher.tick();
    return watcher.currentCoord()?.childReclaimAttention ?? [];
  };
  /** The box-wide collector items: a `collect` item whose `sessionId` is one of the fixed labels, never an id. */
  const boxWide = (items: readonly ChildReclaimAttention[]): ChildReclaimCollectAttention[] =>
    items.filter((a): a is ChildReclaimCollectAttention => a.kind === 'collect' && LABELS.has(a.sessionId));
  return {
    home, reg, cfg, coord, notifyLog, watcher, mintingRun, startMono, fleetState, calls, onCall, scripts, answers,
    now: (): number => clock, mono: (): number => mono, names, witness, unwitness, touch, remove, pass, settled, next, advance,
    pastHoldOff, passesUntil, hold, holdGather, holdListing, occupy, goLive, audits, collects, feed, wouldCollects, attention,
    boxWide,
    gatherReached: (): number => gatherReached,
    setUnlistable: (v: boolean): void => { unlistable = v; },
    setRejecting: (v: boolean): void => { rejecting = v; },
    setVisible: (f: (id: string) => boolean): void => { visible = f; },
    pause: (): void => touch(RECLAIM_PAUSE_MARKER),
    unpause: (): void => remove(RECLAIM_PAUSE_MARKER),
    disarm: (): void => remove(COLLECT_LANE_LIVE_MARKER),
    /** `tmproots` replaced by a LINK: never followed, so that listing is unmeasured. */
    breakTmproots: (): void => { rmSync(tmproots, { recursive: true, force: true }); symlinkSync(mkTmp('ccrc-elsewhere-'), tmproots); },
    /** `tmpquarantine` is a LINK (unmeasured), then gone again (a proven absence: an empty, measured listing). */
    breakQuarantine: (): void => { symlinkSync(mkTmp('ccrc-elsewhere-'), quarantine); },
    mendQuarantine: (): void => { rmSync(quarantine, { force: true }); },
    lane: () => watcher.currentCollectLane(),
  };
};
export type CollectRig = Awaited<ReturnType<typeof collectRig>>;
```

Create `server/test/collect-lane-bounds.test.ts`:

```ts
// Child reclamation wave 9 (spec §5.10): the collector lane's OWN decisions, which the L4 pass applies and never makes —
// who one pass asks (`collectOffers`, over `collectCandidateOf`'s plain facts) and what a settled act job does to the
// lane (`collectJobEffects`: the slot and the flock latch). Pure: no clock, no fleet, no watcher. The lane suites
// (`collect-lane-pass`, `collect-lane-slot`) pin what reaches ccd.
import { describe, it, expect } from 'vitest';
import {
  collectCandidateOf, collectFirstSighting, collectJobEffects, collectOffers,
  type CollectCandidate, type CollectJobEffects, type CollectJobSettled, type CollectOfferInput,
} from '../src/collectLane.js';
import type { CollectJobOutcome } from '../src/coord/collectTempRoot.js';
import type { CollectToken } from '../../shared/api.js';

const T = 'a'.repeat(64) as CollectToken;
const STALL = 480_000;
const NOW = 1_000_000;
/** An unpaired id: no observation, so no ripening instant. */
const c = (id: string, nextAskMono: number, over: Partial<CollectCandidate> = {}): CollectCandidate =>
  ({ id, nextAskMono, ripeningMono: null, ripe: false, ...over });
/** A ripe id: observation 1 stands, it ripened at `at`, and nothing else moves its next ask past that. */
const ripe = (id: string, at: number): CollectCandidate => c(id, at, { ripeningMono: at, ripe: true });
const input = (over: Partial<CollectOfferInput> = {}): CollectOfferInput => ({
  candidates: [], busy: new Set(), nowMono: NOW, auditsMax: 2,
  act: { slotFree: true, flockLatched: false, startMono: 0, holdOffMs: STALL }, ...over });

describe('collectOffers: who one pass asks (spec §5.10)', () => {
  it('a never-asked id is due at once; learning is capped, by next-ask instant and then id', () => {
    expect(collectOffers(input({ candidates: [c('demo-c', -Infinity), c('demo-a', -Infinity), c('demo-b', -Infinity)] })))
      .toEqual({ learn: ['demo-a', 'demo-b'], act: null });
  });

  it('the next-ask instant orders before the id, and an id not yet due is offered nothing', () => {
    expect(collectOffers(input({ candidates: [c('demo-a', NOW - 10), c('demo-z', NOW - 20), c('demo-b', NOW + 1)] })))
      .toEqual({ learn: ['demo-z', 'demo-a'], act: null });
  });

  it('an id is due at exactly its instant', () => {
    expect(collectOffers(input({ candidates: [c('demo-a', NOW)] })).learn).toEqual(['demo-a']);
  });

  it('a busy id — a call not settled, or the slot kept for it — is offered nothing, to learn or to act', () => {
    expect(collectOffers(input({ candidates: [c('demo-a', -Infinity), ripe('demo-b', NOW - 1)],
      busy: new Set(['demo-a', 'demo-b']) }))).toEqual({ learn: [], act: null });
  });

  it('a ripe X with a never-settling call does not stop Y’s act', () => {
    expect(collectOffers(input({ candidates: [ripe('demo-x', NOW - 9), ripe('demo-y', NOW - 5)],
      busy: new Set(['demo-x']) })).act).toBe('demo-y');
  });

  it('an id holding an observation is never offered a learning audit, even while the act is closed to it', () => {
    expect(collectOffers(input({ candidates: [ripe('demo-a', NOW - 1)] }))).toEqual({ learn: [], act: 'demo-a' });
    expect(collectOffers(input({ candidates: [ripe('demo-a', NOW - 1)],
      act: { slotFree: false, flockLatched: false, startMono: 0, holdOffMs: STALL } }))).toEqual({ learn: [], act: null });
  });

  it('the act is offered FIRST and counts against no learning audit', () => {
    expect(collectOffers(input({ candidates: [c('demo-b', -Infinity), ripe('demo-a', NOW - 1), c('demo-c', -Infinity)] })))
      .toEqual({ learn: ['demo-b', 'demo-c'], act: 'demo-a' });
  });

  it('ONE act, to the earliest RIPENING instant and then id — never by next-ask instant or listing order', () => {
    expect(collectOffers(input({ candidates: [ripe('demo-b', NOW - 5), ripe('demo-a', NOW - 5), ripe('demo-c', NOW - 9)] })).act)
      .toBe('demo-c');
    expect(collectOffers(input({ candidates: [ripe('demo-b', NOW - 5), ripe('demo-a', NOW - 5)] })).act).toBe('demo-a');
    // demo-a ripened first, though a floor moved its next ask after demo-b's: the ripening instant decides.
    expect(collectOffers(input({ candidates: [c('demo-a', NOW - 1, { ripeningMono: NOW - 9, ripe: true }),
      ripe('demo-b', NOW - 5)] })).act).toBe('demo-a');
  });

  it('an id that holds an observation but is not ripe is not offered the act', () => {
    expect(collectOffers(input({ candidates: [c('demo-a', NOW + 1, { ripeningMono: NOW + 1 })] })).act).toBeNull();
  });

  it('the act is closed while the slot is taken, while flock-unavailable is latched, and inside the start hold-off', () => {
    const act = (a: Partial<CollectOfferInput['act']>): string | null => collectOffers(input({
      candidates: [ripe('demo-a', NOW - 1)],
      act: { slotFree: true, flockLatched: false, startMono: 0, holdOffMs: STALL, ...a } })).act;
    expect(act({}), 'CONTROL').toBe('demo-a');
    expect(act({ slotFree: false })).toBeNull();
    expect(act({ flockLatched: true })).toBeNull();
    expect(act({ startMono: NOW - STALL + 1 }), 'one millisecond inside the hold-off').toBeNull();
    expect(act({ startMono: NOW - STALL }), 'exactly at its end').toBe('demo-a');
  });

  it('the learning cap is its argument', () => {
    const four = ['demo-a', 'demo-b', 'demo-c', 'demo-d'].map((id) => c(id, -Infinity));
    expect(collectOffers(input({ candidates: four, auditsMax: 0 })).learn).toEqual([]);
    expect(collectOffers(input({ candidates: four, auditsMax: 3 })).learn).toEqual(['demo-a', 'demo-b', 'demo-c']);
  });
});

describe('collectCandidateOf: an id’s facts through Task 4’s rules', () => {
  const PASS = 60_000;
  const OBSERVE = 60_000;
  it('no entry: never asked, so due at once, with no observation and not ripe', () => {
    expect(collectCandidateOf('demo-a', undefined, NOW, PASS, OBSERVE))
      .toEqual({ id: 'demo-a', nextAskMono: Number.NEGATIVE_INFINITY, ripeningMono: null, ripe: false });
  });

  it('a first sighting reads through L1: no wait, so due at once, and no observation', () => {
    expect(collectCandidateOf('demo-a', collectFirstSighting(1), NOW, PASS, OBSERVE))
      .toEqual({ id: 'demo-a', nextAskMono: Number.NEGATIVE_INFINITY, ripeningMono: null, ripe: false });
  });

  it('observation 1 ripens one interval after it ARRIVED: not before, and exactly then', () => {
    const at = (arrivedMono: number) =>
      collectCandidateOf('demo-a', { ...collectFirstSighting(1), obs: { token: T, arrivedMono } }, NOW, PASS, OBSERVE);
    expect(at(NOW - OBSERVE + 1)).toEqual({ id: 'demo-a', nextAskMono: NOW + 1, ripeningMono: NOW + 1, ripe: false });
    expect(at(NOW - OBSERVE)).toEqual({ id: 'demo-a', nextAskMono: NOW, ripeningMono: NOW, ripe: true });
  });
});

describe('collectJobEffects: the slot’s life, and the latch (spec §5.10)', () => {
  // Task 6's outcome is a CollectJobSettled: L1 declares the shape structurally, because it may not import L3 (H2).
  const settles = (o: CollectJobOutcome): CollectJobSettled => o;
  void settles;
  const FREE: CollectJobEffects = { keptUntilMono: null, latchFlock: false };
  const acted = (result: Extract<CollectJobSettled, { kind: 'acted' }>['result']): CollectJobSettled =>
    ({ kind: 'acted', composedMono: 7_000, result });
  it.each<readonly [string, CollectJobSettled, CollectJobEffects]>([
    ['shadow’s would-collect frees it', { kind: 'would-collect' }, FREE],
    ['a job that asked nothing frees it (caps, a refused id, a pause, presence at step 3)', { kind: 'not-asked' }, FREE],
    ['a job stopped after its audit frees it (stale, not licensed, a flip, a cleared pair, presence at step 6)',
      { kind: 'answered' }, FREE],
    ['the open-run hold frees it', { kind: 'held' }, FREE],
    ['a document frees it: collected', acted({ kind: 'collected', record: null, resumed: false, witness: 'dropped' }), FREE],
    ['a document frees it: refused', acted({ kind: 'refused', word: 'in-use', detail: 'x', paths: [] }), FREE],
    ['a document frees it: failed', acted({ kind: 'failed', token: 'probe-unmeasured', detail: 'x' }), FREE],
    ['a recognised die acted nothing: lock-unopenable frees it', acted({ kind: 'die', word: 'lock-unopenable' }), FREE],
    ['flock-unavailable frees it, and latches', acted({ kind: 'die', word: 'flock-unavailable' }), { ...FREE, latchFlock: true }],
    ['NO DOCUMENT may have acted: kept until STALL after the act was COMPOSED', acted({ kind: 'no-document', stderr: '' }),
      { ...FREE, keptUntilMono: 7_000 + STALL }],
    ['a job that threw may have acted: kept until STALL after it SETTLED', { kind: 'threw', detail: 'x' },
      { ...FREE, keptUntilMono: 9_000 + STALL }],
  ])('%s', (_label, settled, effects) => {
    expect(collectJobEffects(settled, 9_000, STALL)).toEqual(effects);
  });
});
```

Create `server/test/collect-lane-pass.test.ts`:

```ts
// Child reclamation wave 9 (spec §5.10): the temp-root collector's PASS, wired into the watcher. `collect-lane-bounds`
// pins who a pass asks and what a settled act job does to the lane; the executor's and L1's suites pin each step and
// each answer. What is only provable HERE is what reaches ccd, when, and on which queue:
// - the constants are derived, and the tick dispatches the pass after the dead-coordinator lane;
// - ONE gather (the two listings and the switches' own listing, read together) after the throttle, and nothing else
//   awaited: the pass never awaits a call it queued; one pass at a time; the throttle on the monotonic clock, stamped
//   before and after;
// - the gates at the pass's start (both capabilities, the pause, an unlistable registry) each clear every observation
//   pair; a port that rejects under the population read is no gate: it makes those listings unmeasured;
// - forgetting, the pre-filter's listing, the learning cap, the act offered first, and the id's queue key;
// - the stale-answer generations across a marker flip, the live flag that starts SHADOWED, a restart, and an id under a
//   standing presence claim that never starves another;
// - the collector's items reach the frame through the attention list's ONE write.
// FIXTURE HOME ONLY (`collectLaneFixture.ts`): ccd is a scripted model, the registry a fixture HOME's.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHILD_RECLAIM_SWEEP_MS, COLLECT_AUDIT_STALL_MS, COLLECT_OBSERVE_INTERVAL_MS } from '../src/watch.js';
import {
  COLLECT_AUDITS_PER_PASS, COLLECT_FEED_TITLE, COLLECT_LANE_LIVE_MARKER, collectFeedSwitchBody,
} from '../src/collectLane.js';
import { COLLECT_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { COLLECT_BOX_LABELS } from '../../shared/api.js';
import { collectRig, type CollectRig } from './collectLaneFixture.js';
import { FULL_CAPS } from './collectTempRootFixture.js';
import { codeOnly } from './sourceScan.js';

afterEach(() => { vi.restoreAllMocks(); });

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const watchSrc = (): string => codeOnly(readFileSync(path.join(srcDir, 'watch.ts'), 'utf8'));
/** A method's code, from its signature to its closing brace at two spaces. */
const methodOf = (src: string, sig: string): string => {
  const at = src.indexOf(sig);
  expect(at, `${sig.trim()} is gone`).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('\n  }\n', at));
};
/** The feed rows of one flip, by Task 5's own title and words. */
const flipRows = (f: CollectRig, live: boolean) =>
  f.feed().filter((e) => e.title === COLLECT_FEED_TITLE.switch && e.body === collectFeedSwitchBody(live));

describe('the lane’s constants are derived, and the tick dispatches it (spec §5.10)', () => {
  it('the observation interval IS the sweep interval, spelled from it, never a second literal', () => {
    expect(COLLECT_OBSERVE_INTERVAL_MS).toBe(CHILD_RECLAIM_SWEEP_MS);
    expect(watchSrc()).toContain('export const COLLECT_OBSERVE_INTERVAL_MS = CHILD_RECLAIM_SWEEP_MS;');
  });

  it('a learning audit’s unsettled bound is twice ws-audit’s remote runner row', () => {
    const row = /^\s*'ws-audit':\s*([0-9_]+),/m.exec(readFileSync(path.join(srcDir, 'remote', 'runner.ts'), 'utf8'));
    expect(row, 'ws-audit’s runner row is gone').not.toBeNull();
    expect(COLLECT_AUDIT_STALL_MS).toBe(2 * Number(row![1]!.replace(/_/g, '')));
  });

  it('the tick dispatches the pass, unawaited, after the dead-coordinator lane and before the mail lane', () => {
    const src = watchSrc();
    const dead = src.indexOf('void this.sweepDeadCoordinators(records, registryRead.names)');
    const mine = src.indexOf('void this.sweepTempRootCollect(records, registryRead.names)');
    const mail = src.indexOf('void this.sweepMail()');
    expect([dead, mine, mail].every((i) => i > -1), 'an anchor is gone').toBe(true);
    expect(dead).toBeLessThan(mine);
    expect(mine).toBeLessThan(mail);
  });

  it('and a tick reaches the lane: a witnessed id is audited', async () => {
    const f = await collectRig();
    f.witness('demo-a');
    await f.watcher.tick();
    await vi.waitFor(() => expect(f.audits('demo-a')).toHaveLength(1));
  });
});

describe('one gather, one pass at a time, a monotonic throttle (spec §5.10)', () => {
  it('the pass awaits ONE thing — the gather, after the throttle — never a call it queued, and reads the pause alone', () => {
    const src = watchSrc();
    const outer = methodOf(src, '  async sweepTempRootCollect(');
    const stamp = outer.indexOf('this.lastCollectSweep = gate;');
    const guard = outer.indexOf('this.collectSweeping = true;');
    expect(stamp > -1 && guard > stamp, 'the throttle is stamped, then the guard raised').toBe(true);
    expect([...outer.matchAll(/\bawait\b/g)], 'the pass awaits its gather alone').toHaveLength(1);
    const pass = methodOf(src, '  private async collectPass(');
    const gather = pass.indexOf('await Promise.all([');
    expect([...pass.matchAll(/\bawait\b/g)].map((m) => m.index)).toEqual([gather]);
    expect(pass.indexOf('readCollectPopulation(this.deps.io, this.deps.cfg.registryDir)')).toBeGreaterThan(gather);
    expect(pass.indexOf('collectSwitches(this.deps.io, this.deps.cfg.registryDir)')).toBeGreaterThan(gather);
    expect(pass.indexOf('this.lastCollectSweep = mono;')).toBeGreaterThan(gather);
    expect(pass, 'the live marker is the executor’s to read, at its act').not.toMatch(/\.live\b/);
  });

  it('a tick that lands while a pass gathers returns at once: a second gather never starts', async () => {
    const f = await collectRig();
    f.witness('demo-a');
    const gate = f.holdGather();
    const first = f.pass();
    await vi.waitFor(() => expect(f.gatherReached()).toBe(1));
    f.next();                                               // a whole interval on: only one-pass-at-a-time can stop it
    await f.pass();
    expect(f.gatherReached(), 'the second pass gathered nothing').toBe(1);
    gate.release(); await first; await f.settled();
    expect(f.audits('demo-a')).toHaveLength(1);
  });

  it('a pass inside the interval reads nothing, and one a whole interval later reads again', async () => {
    const f = await collectRig();
    await f.pass();
    f.advance(CHILD_RECLAIM_SWEEP_MS - 1); await f.pass();
    expect(f.gatherReached()).toBe(1);
    f.advance(1); await f.pass();
    expect(f.gatherReached()).toBe(2);
  });

  it('the throttle is stamped BEFORE the gather: a pass the capability gate stopped still spends its interval', async () => {
    const f = await collectRig();
    f.fleetState.ccdVerbs = FULL_CAPS.filter((v) => v !== COLLECT_CAP);
    await f.pass();                                         // stopped at the gate, before any read
    f.fleetState.ccdVerbs = [...FULL_CAPS];
    await f.pass();                                         // the same instant: throttled by the stopped pass's stamp
    expect(f.gatherReached(), 'throttled from the stamp before the gather').toBe(0);
    f.next(); await f.pass();
    expect(f.gatherReached()).toBe(1);
  });

  it('and RE-STAMPED after it: a gather that settles just short of an interval puts the next pass a whole interval later', async () => {
    const f = await collectRig();
    const gate = f.holdGather();
    const first = f.pass();
    await vi.waitFor(() => expect(f.gatherReached()).toBe(1));
    f.advance(CHILD_RECLAIM_SWEEP_MS - 1);
    gate.release(); await first;
    f.advance(1);                                           // an interval after the gate's stamp, 1 ms after the decision
    await f.pass();
    expect(f.gatherReached(), 'throttled from the decision clock').toBe(1);
  });
});

describe('the gates at the pass’s start: nothing is asked, and every observation pair clears (spec §5.10)', () => {
  /** Shadowed, past the start hold-off: demo-a gets its first observation; `raise` stands for ONE pass; then `lower`.
   *  Answers the pass, counted after the gate lowered, that records demo-a's would-collect: 2 when the pair was cleared
   *  (a fresh observation first), 1 when it survived. demo-b, planted while the gate stands, is due for a LEARNING audit,
   *  which reads no switch itself: only the pass's own gate keeps it unasked. */
  const passOfWouldCollect = async (f: CollectRig, raise: () => void, lower: () => void): Promise<number> => {
    f.pastHoldOff();
    f.witness('demo-a');
    await f.pass(); await f.settled();
    expect(f.audits('demo-a'), 'observation 1').toHaveLength(1);
    raise();
    f.witness('demo-b');                                    // never asked: due for a LEARNING audit, which reads no switch itself
    f.next(); await f.pass(); await f.settled();
    expect(f.audits('demo-a'), 'nothing is asked while the gate stands').toHaveLength(1);
    expect(f.audits('demo-b'), 'no learning audit while the gate stands: the pass itself stops').toEqual([]);
    lower();
    return f.passesUntil(() => f.wouldCollects('demo-a').length > 0, 3);
  };
  const without = (f: CollectRig, cap: string) => (): void => { f.fleetState.ccdVerbs = FULL_CAPS.filter((v) => v !== cap); };
  const restore = (f: CollectRig) => (): void => { f.fleetState.ccdVerbs = [...FULL_CAPS]; };

  it('the collector’s capability missing', async () => {
    const f = await collectRig();
    expect(await passOfWouldCollect(f, without(f, COLLECT_CAP), restore(f))).toBe(2);
  });

  it('the pause’s capability missing: never an automatic destructive lane on a box the phone cannot pause', async () => {
    const f = await collectRig();
    expect(await passOfWouldCollect(f, without(f, RECLAIM_PAUSE_CAP), restore(f))).toBe(2);
  });

  it('reclaim-paused raised', async () => {
    const f = await collectRig();
    expect(await passOfWouldCollect(f, f.pause, f.unpause)).toBe(2);
  });

  it('a registry that does not list: a pause this server cannot rule out, never shadow', async () => {
    const f = await collectRig();
    expect(await passOfWouldCollect(f, () => f.setUnlistable(true), () => f.setUnlistable(false))).toBe(2);
  });

  it('a port that rejects under the population read is no gate: both listings unmeasured, nothing audited or forgotten from them, two box lines, and the pair survives', async () => {
    const f = await collectRig();
    expect(await passOfWouldCollect(f, () => f.setRejecting(true), () => f.setRejecting(false)), 'no pair cleared').toBe(1);
    const g = await collectRig();
    g.witness('demo-a');
    await g.pass(); await g.settled();
    g.setRejecting(true);
    g.next(); await g.pass(); await g.settled();
    expect(g.audits('demo-a'), 'nothing audited from an unmeasured listing').toHaveLength(1);
    expect(g.lane().entries.has('demo-a'), 'nor forgotten').toBe(true);
    expect(g.boxWide(await g.attention()).map((a) => a.sessionId).sort())
      .toEqual([COLLECT_BOX_LABELS.tmpquarantine, COLLECT_BOX_LABELS.tmproots].sort());
  });

  it('the capabilities are asked before anything is read', async () => {
    const f = await collectRig();
    without(f, COLLECT_CAP)();
    await f.pass();
    expect(f.gatherReached()).toBe(0);
  });
});

describe('the population is the two listings, read in the gather (spec §5.10)', () => {
  it('an id is forgotten only when BOTH listings were measured and neither names it', async () => {
    const f = await collectRig();
    f.witness('demo-a');
    await f.pass(); await f.settled();
    expect(f.lane().entries.has('demo-a')).toBe(true);
    f.unwitness('demo-a');
    f.breakQuarantine();
    f.next(); await f.pass(); await f.settled();
    expect(f.lane().entries.has('demo-a'), 'one listing unmeasured: its absence is never read').toBe(true);
    f.mendQuarantine();
    f.next(); await f.pass(); await f.settled();
    expect(f.lane().entries.has('demo-a'), 'both measured, neither names it: forgotten').toBe(false);
  });

  it('an answer that arrives after its id was forgotten is dropped: no entry comes back', async () => {
    const f = await collectRig();
    f.witness('demo-a');
    const late = f.hold('audit', 'demo-a');
    await f.pass();
    await vi.waitFor(() => expect(late.reached()).toBe(true));
    f.unwitness('demo-a');
    f.next(); await f.pass();                               // the guard is down: the calls are not under it
    expect(f.lane().entries.has('demo-a')).toBe(false);
    late.release(); await f.settled();
    expect(f.lane().entries.has('demo-a'), 'the late answer re-created nothing').toBe(false);
  });

  it('the pre-filter reads the listing the TICK handed the pass: an id whose exact row stands there is not audited', async () => {
    const f = await collectRig();
    f.witness('demo-a');
    await f.pass([...f.names(), 'demo-a.uuid']); await f.settled();
    expect(f.audits('demo-a')).toEqual([]);
    f.next(); await f.pass(); await f.settled();
    expect(f.audits('demo-a')).toHaveLength(1);
  });

  it(`at most ${COLLECT_AUDITS_PER_PASS} learning audits a pass; the never-asked go by id`, async () => {
    const f = await collectRig();
    for (const id of ['demo-d', 'demo-b', 'demo-a', 'demo-c']) f.witness(id);
    await f.pass(); await f.settled();
    expect(f.audits().map((c) => c.id).sort()).toEqual(['demo-a', 'demo-b']);
    f.next(); await f.pass(); await f.settled();            // inside the hold-off: the two paired wait; the rest learn
    expect(f.audits().map((c) => c.id).slice(2).sort()).toEqual(['demo-c', 'demo-d']);
  });
});

describe('the act is offered first (spec §5.10)', () => {
  it('a single collectable orphan reaches its executor job within the interval plus two passes', async () => {
    const f = await collectRig();
    f.pastHoldOff(); f.witness('demo-a');
    const jobAt: number[] = [];                             // when the slot became the job for demo-a
    f.onCall.push(() => {
      const s = f.lane().slot;
      if (jobAt.length === 0 && s.kind === 'job' && s.id === 'demo-a') jobAt.push(s.sinceMono);
    });
    const firstPass = f.mono();
    await f.pass(); await f.settled();
    await f.passesUntil(() => jobAt.length > 0, 3);
    expect(jobAt[0]! - firstPass).toBeLessThanOrEqual(COLLECT_OBSERVE_INTERVAL_MS + 2 * CHILD_RECLAIM_SWEEP_MS);
  });
});

describe('every collector call rides the id’s queue key (spec §5.10)', () => {
  it('a learning audit waits behind that id’s queued job — another lane’s reclaim or expiry', async () => {
    const f = await collectRig();
    f.witness('demo-a'); f.witness('demo-b');
    const release = f.occupy('demo-a');
    await f.pass();
    await vi.waitFor(() => expect(f.audits('demo-b')).toHaveLength(1));
    expect(f.audits('demo-a'), 'queued behind it, not composed').toEqual([]);
    release(); await f.settled();
    expect(f.audits('demo-a')).toHaveLength(1);
  });

  it('so does the act job, its slot taken as it is queued', async () => {
    const f = await collectRig();
    f.pastHoldOff(); f.witness('demo-a');
    await f.pass(); await f.settled();                      // observation 1
    const release = f.occupy('demo-a');
    f.next();
    await f.pass();
    await vi.waitFor(() => expect(f.lane().slot).toMatchObject({ kind: 'job', id: 'demo-a' }));
    expect(f.audits('demo-a'), 'the job’s own audit waits too').toHaveLength(1);
    release(); await f.settled();
    expect(f.audits('demo-a')).toHaveLength(2);
    expect(f.wouldCollects('demo-a')).toHaveLength(1);
  });
});

describe('stale answers, the live flag and a restart (spec §5.10)', () => {
  it('a learning audit composed before a job sees the marker appear, answering collectable after it, seeds no observation; each first live act follows two observations composed after the flip', async () => {
    const f = await collectRig();
    f.pastHoldOff();
    f.witness('demo-b');
    await f.pass(); await f.settled();                      // demo-b: observation 1
    f.touch(COLLECT_LANE_LIVE_MARKER);
    f.witness('demo-a');
    const late = f.hold('audit', 'demo-a');
    f.next();
    await f.pass();                                         // demo-b's act job sees the arming; demo-a is learned, held
    await vi.waitFor(() => expect(f.lane().lastSeenLive).toBe(true));
    expect(late.reached(), 'demo-a’s audit was composed before the flip was seen').toBe(true);
    expect(f.collects(), 'the job that saw the flip composed nothing').toEqual([]);
    late.release(); await f.settled();                      // ...and it answers collectable AFTER the flip
    const flipAt = f.calls.length;
    await f.passesUntil(() => f.collects('demo-a').length > 0 && f.collects('demo-b').length > 0);
    for (const id of ['demo-a', 'demo-b']) {
      const first = f.calls.findIndex((c) => c.verb === 'collect' && c.id === id);
      const fresh = f.calls.slice(flipAt, first).filter((c) => c.verb === 'audit' && c.id === id);
      expect(fresh.length, `${id}: observations composed after the flip, before its first ws-collect`).toBeGreaterThanOrEqual(2);
    }
  });

  it('a lane built with the marker standing writes "now live" and composes nothing on its first job', async () => {
    const f = await collectRig({ armed: true });
    f.pastHoldOff(); f.witness('demo-a');
    await f.pass(); await f.settled();                      // observation 1
    f.next(); await f.pass(); await f.settled();            // the first act job: the flag starts SHADOWED, so a flip
    expect(flipRows(f, true)).toHaveLength(1);
    expect(f.collects()).toEqual([]);
    await f.passesUntil(() => f.collects('demo-a').length > 0);
    expect(flipRows(f, true), 'one row per flip').toHaveLength(1);
  });

  it('each flip writes ONE row, either way, and the job that sees it composes nothing', async () => {
    const f = await collectRig({ armed: true });
    f.pastHoldOff(); f.witness('demo-a'); f.witness('demo-b');
    await f.passesUntil(() => f.lane().lastSeenLive);
    f.disarm();
    await f.passesUntil(() => !f.lane().lastSeenLive);
    expect(flipRows(f, true)).toHaveLength(1);
    expect(flipRows(f, false)).toHaveLength(1);
    expect(f.collects()).toEqual([]);
  });

  it('a restart needs two fresh observations: no memory is carried', async () => {
    const a = await collectRig();
    a.pastHoldOff(); a.witness('demo-a');
    await a.pass(); await a.settled();                      // observation 1, in the first process
    const b = await collectRig({ home: a.home, coord: a.coord, notifyLog: a.notifyLog, mintingRun: a.mintingRun,
      clock: a.now() + CHILD_RECLAIM_SWEEP_MS + 1, mono: a.mono() + CHILD_RECLAIM_SWEEP_MS + 1 });
    b.pastHoldOff();
    await b.pass(); await b.settled();
    expect(b.wouldCollects('demo-a'), 'the new process learns first: nothing rests on the old one’s observation').toEqual([]);
    expect(b.audits('demo-a')).toHaveLength(1);
    b.next(); await b.pass(); await b.settled();
    expect(b.wouldCollects('demo-a')).toHaveLength(1);
  });

  it('an id under a standing presence claim never starves another: the other’s act is composed within two passes', async () => {
    const f = await collectRig();
    f.pastHoldOff(); await f.goLive();
    f.setVisible((id) => id === 'demo-a');                  // a tab left open on demo-a, its claim re-stated for ever
    f.witness('demo-a'); f.witness('demo-b');
    f.next(); await f.pass(); await f.settled();            // observation 1 of each
    const before = f.calls.length;
    f.next(); await f.pass(); await f.settled();
    f.next(); await f.pass(); await f.settled();
    expect(f.calls.slice(before).filter((c) => c.verb === 'collect').map((c) => c.id)).toEqual(['demo-b']);
  });
});

describe('the collector’s items reach the frame through the list’s ONE write (spec §5.10, §5.9)', () => {
  it('an unmeasured listing is ONE box-wide item with no run, merged by the child lane’s publish', async () => {
    const f = await collectRig();
    f.breakTmproots();
    await f.pass();
    const box = f.boxWide(await f.attention());
    expect(box, 'one box-wide line for the unmeasured listing').toHaveLength(1);
    expect(box[0]!.runId).toBeNull();
  });

  it('a pass whose audits all print nothing raises the no-document box line, published once that pass’s calls settle', async () => {
    const f = await collectRig();
    for (const id of ['demo-a', 'demo-b']) {
      f.witness(id);
      f.scripts.set(id, (verb) => (verb === 'audit' ? f.answers.noDocument() : undefined));
    }
    await f.pass(); await f.settled();                      // two learning audits, one pass, neither printed anything
    expect(f.audits().map((c) => c.id).sort()).toEqual(['demo-a', 'demo-b']);
    expect(f.boxWide(await f.attention()).map((a) => a.word), 'the pass’s tally reached the frame').toContain('no-document');
  });
});
```

Create `server/test/collect-lane-slot.test.ts`:

```ts
// Child reclamation wave 9 (spec §5.10): the collector's SAFETY bounds, at the lane. At most ONE `ws-collect` in flight
// fleet-wide, and the slot's life is exact: taken when the act job is queued; freed when it settles having composed
// nothing (shadow's would-collect, presence at step 6) or when the act answers a document or a recognised pre-lock die;
// KEPT, with its id, until CHILD_RECLAIM_STALL_MS after an act that answered no document; kept for as long as a job does
// not settle, never "stops counting". No act job is offered inside the lane's first CHILD_RECLAIM_STALL_MS. A call or
// job that never settles is listed at its bound, never re-queued, and never stops a later pass. `flock-unavailable`
// latches for the process.
// FIXTURE HOME ONLY (`collectLaneFixture.ts`): ccd is a scripted model, the registry a fixture HOME's.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CHILD_RECLAIM_STALL_MS, CHILD_RECLAIM_SWEEP_MS, COLLECT_AUDIT_STALL_MS } from '../src/watch.js';
import { CHILD_RECLAIM_DEFER_CEILING_MS } from '../src/childReclaimSweep.js';
import { collectRig, type CollectRig } from './collectLaneFixture.js';

afterEach(() => { vi.restoreAllMocks(); });

/** A LIVE lane, past its hold-off, where demo-a holds a pair ripe on the next pass and demo-b is planted to be learned on
 *  that same pass, so the next pass offers demo-a its act and demo-b ripens one pass later. */
const live = async (): Promise<CollectRig> => {
  const f = await collectRig();
  f.pastHoldOff(); await f.goLive();
  f.witness('demo-a');
  f.next(); await f.pass(); await f.settled();              // demo-a: observation 1
  f.witness('demo-b');
  return f;
};
/** The box-wide lines that name `id`. */
const linesFor = async (f: CollectRig, id: string) => f.boxWide(await f.attention()).filter((a) => a.sentence.includes(id));

describe('the slot is kept, with its id, after an act that may have acted (spec §5.10)', () => {
  it('an act answering NO DOCUMENT blocks every act, and its own id, until STALL after it was composed', async () => {
    const f = await live();
    f.scripts.set('demo-a', (verb) => (verb === 'collect' ? f.answers.noDocument() : undefined));
    f.next(); await f.pass(); await f.settled();            // demo-a's act: no document. demo-b learned
    const act = f.collects('demo-a')[0];
    expect(act, 'demo-a’s act was composed').toBeDefined();
    const until = act!.mono + CHILD_RECLAIM_STALL_MS;
    expect(f.lane().slot).toEqual({ kind: 'kept', id: 'demo-a', untilMono: until });
    const from = f.calls.length;
    await f.passesUntil(() => f.collects('demo-b').length > 0);
    const inside = f.calls.slice(from).filter((c) => c.mono < until);
    expect(inside.filter((c) => c.verb === 'collect'), 'no act, on any id, inside the window').toEqual([]);
    expect(inside.filter((c) => c.id === 'demo-a'), 'demo-a is not asked at all inside it').toEqual([]);
    expect(f.collects('demo-b')[0]!.mono).toBeGreaterThanOrEqual(until);
  });

  it('after the window, the next act on that id follows two fresh observations: never a re-spend', async () => {
    const f = await live();
    f.unwitness('demo-b');
    f.scripts.set('demo-a', (verb) => (verb === 'collect' ? f.answers.noDocument() : undefined));
    f.next(); await f.pass(); await f.settled();
    f.scripts.delete('demo-a');
    await f.passesUntil(() => f.collects('demo-a').length > 1, 40);
    const at = f.calls.flatMap((c, i) => (c.verb === 'collect' && c.id === 'demo-a' ? [i] : []));
    const between = f.calls.slice(at[0]! + 1, at[1]).filter((c) => c.verb === 'audit' && c.id === 'demo-a');
    expect(between.length).toBeGreaterThanOrEqual(2);
  });

  it('an act whose call rejects is read as one that may have acted: the slot and the id wait STALL', async () => {
    const f = await live();
    f.scripts.set('demo-a', (verb) => { if (verb === 'collect') throw new Error('link lost'); return undefined; });
    f.next(); await f.pass(); await f.settled();
    const act = f.collects('demo-a')[0];
    expect(act).toBeDefined();
    expect(f.lane().slot).toEqual({ kind: 'kept', id: 'demo-a', untilMono: act!.mono + CHILD_RECLAIM_STALL_MS });
  });
});

describe('the slot is freed by everything else (spec §5.10)', () => {
  it('an arm-1 lock-unopenable answer acted nothing: the next pass composes another id’s act', async () => {
    const f = await live();
    f.scripts.set('demo-a', (verb) => (verb === 'collect' ? f.answers.lockUnopenable('demo-a') : undefined));
    f.next(); await f.pass(); await f.settled();
    expect(f.collects('demo-a')).toHaveLength(1);
    expect(f.lane().slot).toEqual({ kind: 'free' });
    f.next(); await f.pass(); await f.settled();
    expect(f.collects('demo-b')).toHaveLength(1);
  });

  it('a presence that appears at step 6 composes nothing and frees the slot: the next pass composes another id’s act', async () => {
    const f = await live();
    let looked = false;                                     // step 3 reads nobody; step 6, after the job's audit, reads someone
    f.setVisible((id) => id === 'demo-a' && looked);
    f.onCall.push((c) => {
      const s = f.lane().slot;
      if (c.verb === 'audit' && c.id === 'demo-a' && s.kind === 'job') looked = true;
    });
    f.next(); await f.pass(); await f.settled();
    expect(f.collects('demo-a')).toEqual([]);
    expect(f.lane().slot).toEqual({ kind: 'free' });
    f.next(); await f.pass(); await f.settled();
    expect(f.collects('demo-b')).toHaveLength(1);
  });

  it('an open-run hold composes nothing, frees the slot and CLEARS THE PAIR: once it releases, the act follows two observations composed after it, a ceiling later', async () => {
    const f = await live();
    const program = 'w9-collect-held';
    const r = f.coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    f.coord.bindSession(r.id, 'demo-a');                    // an open run names demo-a: the hold's (d)
    f.next(); await f.pass(); await f.settled();            // demo-a's act job: held at step 4
    expect(f.collects('demo-a')).toEqual([]);
    expect(f.lane().slot).toEqual({ kind: 'free' });
    expect(f.lane().entries.get('demo-a')?.obs ?? null, 'the hold cleared the pair').toBeNull();
    const heldAt = f.calls.length;
    const heldMono = f.mono();
    const c = f.coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program,
      viaClosing: false });
    if (!c.ok) throw new Error(`closeRun refused: ${JSON.stringify(c)}`);
    await f.passesUntil(() => f.collects('demo-a').length > 0, 40);
    const fresh = f.calls.slice(heldAt).filter((x) => x.verb === 'audit' && x.id === 'demo-a');
    expect(fresh.length, 'two observations composed after the hold').toBeGreaterThanOrEqual(2);
    expect(f.collects('demo-a')[0]!.mono - heldMono, 'the held id waited the ceiling').toBeGreaterThanOrEqual(CHILD_RECLAIM_DEFER_CEILING_MS);
  });

  it('two ids each get a would-collect on consecutive shadow passes', async () => {
    const f = await collectRig();
    f.pastHoldOff(); f.witness('demo-a');
    await f.pass(); await f.settled();
    f.witness('demo-b');
    f.next(); await f.pass(); await f.settled();            // demo-a: would-collect. demo-b learned
    expect(f.wouldCollects('demo-a')).toHaveLength(1);
    f.next(); await f.pass(); await f.settled();
    expect(f.wouldCollects('demo-b')).toHaveLength(1);
    expect(f.collects()).toEqual([]);
  });
});

describe('the start hold-off (spec §5.10)', () => {
  it('a lane composes no act inside CHILD_RECLAIM_STALL_MS of its start — no act job runs at all', async () => {
    const f = await collectRig({ armed: true });
    f.witness('demo-a');
    for (; f.mono() - f.startMono < CHILD_RECLAIM_STALL_MS; f.next()) { await f.pass(); await f.settled(); }
    expect(f.lane().lastSeenLive, 'no act job ran: none saw the marker').toBe(false);
    expect(f.collects()).toEqual([]);
    expect(f.audits('demo-a'), 'it learned meanwhile, once').toHaveLength(1);
    await f.pass(); await f.settled();                      // the first pass past the hold-off
    expect(f.lane().lastSeenLive, 'the first act job runs now').toBe(true);
  });

  it('exactly CHILD_RECLAIM_STALL_MS after its start, the act is offered', async () => {
    const f = await collectRig();
    f.witness('demo-a');
    await f.pass(); await f.settled();                      // at the start: observation 1
    f.advance(CHILD_RECLAIM_STALL_MS);
    await f.pass(); await f.settled();
    expect(f.wouldCollects('demo-a')).toHaveLength(1);
  });
});

describe('a call or job that never settles (spec §5.10: local mode’s runner has no timeout)', () => {
  it('a learning audit is listed at twice the audit row, not before, and is never queued again', async () => {
    const f = await collectRig();
    f.witness('demo-a');
    f.hold('audit', 'demo-a');                              // never released
    await f.pass();
    await vi.waitFor(() => expect(f.audits('demo-a')).toHaveLength(1));
    const queued = f.mono();
    while (f.mono() + CHILD_RECLAIM_SWEEP_MS + 1 - queued < COLLECT_AUDIT_STALL_MS) { f.next(); await f.pass(); }
    expect(await linesFor(f, 'demo-a'), 'not before its bound').toEqual([]);
    f.next(); await f.pass();
    expect(f.mono() - queued).toBeGreaterThanOrEqual(COLLECT_AUDIT_STALL_MS);
    expect(await linesFor(f, 'demo-a')).toHaveLength(1);
    for (let i = 0; i < 5; i += 1) { f.next(); await f.pass(); }
    expect(f.audits('demo-a'), 'never queued again while it stands').toHaveLength(1);
  });

  it('an executor audit that never settles raises the line at COLLECT_AUDIT_STALL_MS while later passes still compose learning audits for other ids, and at STALL says the act slot is held', async () => {
    const f = await live();
    f.hold('audit', 'demo-a');                              // the NEXT audit of demo-a: its act job's own, never answered
    f.next(); await f.pass();
    await vi.waitFor(() => expect(f.audits('demo-a')).toHaveLength(2));
    const queued = f.mono();
    expect(f.lane().slot).toEqual({ kind: 'job', id: 'demo-a', sinceMono: queued });
    f.witness('demo-c');
    while (f.mono() + CHILD_RECLAIM_SWEEP_MS + 1 - queued < COLLECT_AUDIT_STALL_MS) { f.next(); await f.pass(); await f.settled(); }
    expect(await linesFor(f, 'demo-a'), 'not before its bound').toEqual([]);
    f.next(); await f.pass(); await f.settled();
    const line = await linesFor(f, 'demo-a');
    expect(line, 'listed at the audit’s bound, not the act’s').toHaveLength(1);
    expect(line[0]!.sentence, 'an audit, not a held slot').not.toMatch(/act slot is held/);
    expect(f.audits('demo-c').length, 'later passes still learn other ids').toBeGreaterThanOrEqual(1);
    expect(f.collects()).toEqual([]);
    while (f.mono() - queued < CHILD_RECLAIM_STALL_MS) { f.next(); await f.pass(); await f.settled(); }
    const atStall = await linesFor(f, 'demo-a');
    expect(atStall, 'still one line, now at the job’s own bound').toHaveLength(1);
    expect(atStall[0]!.sentence, 'its audit still out at STALL: the act slot is held').toMatch(/act slot is held/);
  });

  it('an act job keeps the slot past STALL — it never stops counting — is listed as holding it, and later passes still learn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = await live();
    f.hold('collect', 'demo-a');                            // demo-a's ws-collect never answers
    f.next();
    await f.pass();
    await vi.waitFor(() => expect(f.collects('demo-a')).toHaveLength(1));
    const queued = f.mono();
    f.witness('demo-c');
    while (f.mono() - queued < CHILD_RECLAIM_STALL_MS + 2 * CHILD_RECLAIM_SWEEP_MS) { f.next(); await f.pass(); await f.settled(); }
    expect(f.collects('demo-b'), 'the slot was never freed by time').toEqual([]);
    expect(f.lane().slot).toEqual({ kind: 'job', id: 'demo-a', sinceMono: queued });
    const line = await linesFor(f, 'demo-a');
    expect(line).toHaveLength(1);
    expect(line[0]!.sentence, 'its act is out: the act slot is held').toMatch(/act slot is held/);
    expect(f.audits('demo-c').length, 'later passes still learn other ids').toBeGreaterThanOrEqual(1);
    expect(warn.mock.calls.some(([m]) => String(m).includes("the collector's call for demo-a has not settled")
      && String(m).includes('the act slot stays taken')), 'logged once, as its ws-collect call').toBe(true);
  });

  it('an executor job queued behind a never-settling job on its key raises the slot-held line at STALL', async () => {
    const f = await live();
    f.occupy('demo-a');                                     // another lane's job on demo-a's key, never released
    f.next(); await f.pass(); await f.settled();
    const s = f.lane().slot;
    expect(s, 'the act job took the slot as it was queued').toMatchObject({ kind: 'job', id: 'demo-a' });
    const queued = s.kind === 'job' ? s.sinceMono : Number.NaN;
    while (f.mono() + CHILD_RECLAIM_SWEEP_MS + 1 - queued < CHILD_RECLAIM_STALL_MS) { f.next(); await f.pass(); await f.settled(); }
    expect(await linesFor(f, 'demo-a'), 'not before STALL').toEqual([]);
    f.next(); await f.pass(); await f.settled();
    const line = await linesFor(f, 'demo-a');
    expect(line, 'a job that composed nothing is listed too').toHaveLength(1);
    expect(line[0]!.sentence).toMatch(/act slot is held/);
    expect(f.audits('demo-a'), 'the job composed nothing: only observation 1').toHaveLength(1);
  });

  it('a job whose own audit answered, waiting between its calls, is no unsettled audit: it is listed at STALL, holding the slot', async () => {
    const f = await live();
    const step5: { release: () => void }[] = [];            // the job's step-5 listing, held once its own audit is composed
    f.onCall.push((c) => {
      const s = f.lane().slot;
      if (step5.length === 0 && c.verb === 'audit' && c.id === 'demo-a' && s.kind === 'job') step5.push(f.holdListing('demo-a'));
    });
    f.next(); await f.pass(); await f.settled();            // demo-a's job: its audit answered; its step 5 waits
    expect(f.audits('demo-a')).toHaveLength(2);
    const s = f.lane().slot;
    expect(s).toMatchObject({ kind: 'job', id: 'demo-a' });
    expect(f.lane().inFlight.get('demo-a')?.phase, 'back to queued once its audit answered').toBe('queued');
    const queued = s.kind === 'job' ? s.sinceMono : Number.NaN;
    while (f.mono() + CHILD_RECLAIM_SWEEP_MS + 1 - queued < CHILD_RECLAIM_STALL_MS) { f.next(); await f.pass(); await f.settled(); }
    expect(f.mono() - queued).toBeGreaterThanOrEqual(COLLECT_AUDIT_STALL_MS);
    expect(await linesFor(f, 'demo-a'), 'its audit answered: no unsettled audit, and not yet STALL').toEqual([]);
    f.next(); await f.pass(); await f.settled();
    const line = await linesFor(f, 'demo-a');
    expect(line).toHaveLength(1);
    expect(line[0]!.sentence).toMatch(/act slot is held/);
  });
});

describe('flock-unavailable latches for the process (spec §5.10)', () => {
  it('no act job after it; learning goes on; a box-wide line says so', async () => {
    const f = await live();
    f.scripts.set('demo-a', (verb) => (verb === 'collect' ? f.answers.flockUnavailable() : undefined));
    f.next(); await f.pass(); await f.settled();            // demo-a's act: the die. demo-b learned
    expect(f.lane().flockLatched).toBe(true);
    for (let i = 0; i < 4; i += 1) { f.next(); await f.pass(); await f.settled(); }
    expect(f.collects().map((c) => c.id), 'nothing composed after it').toEqual(['demo-a']);
    f.witness('demo-c');
    f.next(); await f.pass(); await f.settled();
    expect(f.audits('demo-c'), 'learning is not latched').toHaveLength(1);
    expect(f.boxWide(await f.attention()).some((a) => /flock/.test(a.sentence))).toBe(true);
  });
});
```

How these cases are built:
- **SAFETY cases.** Every one drives the REAL executor and the REAL L1 through the watcher. ccd is a model, and the only fake clocks are `Date.now` and `monotonicMs`.
- **What they assert.** Their assertions are what reaches ccd: the call log, in composition order with the clock it was composed at. They also read the feed and the frame. `currentCollectLane()` is read only for what no call shows directly: the slot, the flag, the latch, the entries forgetting drops, and the flights `settled()` waits on.
- **Settling (H1).** `pass()` resolves when the pass has decided and enqueued, because the lane's pass never awaits a call it queued. A case that reads what the calls did calls `settled()` first; `passesUntil` does so after every pass. A call a case is holding (`hold` or `holdListing` reached, `occupy` standing) is never waited on, so a never-settling call cannot hang a case. `settled()` first yields one macrotask (`setImmediate`): a released hold unparks its id a microtask after `release()`, and without the yield `release(); await f.settled()` returns before the released call is composed (the act job's case in `collect-lane-pass` and T7.34 would read too early).
- **Escapes.** The `’` in titles is U+2019, as wave 8's suites write it. There are no `\n` or `\0` escapes in these files other than the rig's `stderr` strings, where `\n` is a backslash followed by the letter. Check them with `cat -A`.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-lane-bounds.test.ts test/collect-lane-pass.test.ts test/collect-lane-slot.test.ts
```

Expected: FAIL, every case. These are derived, not measured: re-measure the count and record it.
- `collect-lane-bounds`:
  - `TypeError: collectOffers is not a function` (the eleven offer cases);
  - `TypeError: collectCandidateOf is not a function` (three);
  - `TypeError: collectJobEffects is not a function` (the eleven rows).
- `collect-lane-pass` and `collect-lane-slot`:
  - every rig case: `TypeError: watcher.sweepTempRootCollect is not a function`, or `TypeError: watcher.currentCollectLane is not a function` (`settled()` reads it);
  - the constants: `expected undefined to be 60000` and `expected undefined to be 180000`;
  - the learning-cap case's title reads `at most undefined learning audits a pass…`, because `COLLECT_AUDITS_PER_PASS` is this task's;
  - the source pins: `async sweepTempRootCollect( is gone: expected -1 to be greater than -1`, and `an anchor is gone: expected false to be true`.

A case that PASSES here is a defect in the case: report it and fix the case, never the code.

- [ ] **Step 4: L1, append to the foot of `server/src/collectLane.ts`**

Append, after the last line Task 6 or Task 5 left there. Nothing above changes.

```ts

// ── The lane's bounds (spec §5.10): what the watcher's pass applies, decided here so it decides nothing ──────────────

/** At most this many LEARNING audits a pass (spec §5.10), besides the one act job. Declared here, in L1, so the offer
 *  and every suite read one number; the act job's own audit is not one of them. */
export const COLLECT_AUDITS_PER_PASS = 2;

/** One id as a pass sees it (spec §5.10): when it may next be asked; its RIPENING instant, observation 1's arrival
 *  plus the interval, or null when it holds no observation; and whether it is ripe for the act now (Task 4's
 *  `collectRipe`). Plain facts, so who is asked (`collectOffers`) is decided over them alone. */
export interface CollectCandidate {
  readonly id: string;
  readonly nextAskMono: number;
  readonly ripeningMono: number | null;
  readonly ripe: boolean;
}

/** `id`'s facts from its entry, through Task 4's rules (spec §5.10). An id with no entry has never been asked, and an
 *  entry with no wait is due at once: both read `-Infinity`. */
export function collectCandidateOf(
  id: string, entry: CollectEntry | undefined, nowMono: number, passIntervalMs: number, observeIntervalMs: number,
): CollectCandidate {
  if (entry === undefined) return { id, nextAskMono: Number.NEGATIVE_INFINITY, ripeningMono: null, ripe: false };
  return {
    id,
    nextAskMono: collectNextAskMono(entry, passIntervalMs, observeIntervalMs) ?? Number.NEGATIVE_INFINITY,
    ripeningMono: entry.obs === null ? null : entry.obs.arrivedMono + observeIntervalMs,
    ripe: collectRipe(entry, nowMono, passIntervalMs, observeIntervalMs),
  };
}

/** What one pass may ask for. `busy` holds every id with a collector call or job not yet settled, and the id the slot
 *  is kept for. `act` is the fleet-wide slot, the `flock-unavailable` latch and the start hold-off, as the watcher
 *  holds them. */
export interface CollectOfferInput {
  readonly candidates: readonly CollectCandidate[];
  readonly busy: ReadonlySet<string>;
  readonly nowMono: number;
  readonly auditsMax: number;
  readonly act: {
    readonly slotFree: boolean; readonly flockLatched: boolean; readonly startMono: number; readonly holdOffMs: number;
  };
}

/** The pass's asks: the one id offered the act job, or none, and the ids to audit to learn. */
export interface CollectOffers { readonly learn: readonly string[]; readonly act: string | null }

/** WHO ONE PASS ASKS (spec §5.10). An id with a call or job pending (`busy`) is skipped by both offers.
 *  - THE ACT FIRST: to the earliest RIPE id (Task 4's `collectRipe`, which is due by its own next ask), by ripening
 *    instant and then id, so a ripe id whose call never settles never stops another's act. Only while the slot is
 *    free, no `flock-unavailable` is latched, and the lane is past its start hold-off, shadow's would-collect included
 *    (`start-hold-off-asked-at-the-offer`), because a restart forgets the slot while the previous process's act may
 *    still be running on the box.
 *  - THEN at most `auditsMax` LEARNING audits, to DUE ids holding no observation, by next-ask instant and then id —
 *    never by observation age or listing order, so an id a deferral moved out cannot take every pass. An id holding an
 *    observation is never learned: its next ask is its ripening instant, and its act's job audits it itself. */
export function collectOffers(i: CollectOfferInput): CollectOffers {
  const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const byInstant = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);
  const free = i.candidates.filter((c) => !i.busy.has(c.id));
  const due = (c: CollectCandidate): boolean => c.nextAskMono <= i.nowMono;
  const open = i.act.slotFree && !i.act.flockLatched && i.nowMono - i.act.startMono >= i.act.holdOffMs;
  const ripe = free.flatMap((c) => (c.ripe && c.ripeningMono !== null ? [{ id: c.id, at: c.ripeningMono }] : []))
    .sort((a, b) => byInstant(a.at, b.at) || byId(a.id, b.id));
  return {
    act: open ? (ripe[0]?.id ?? null) : null,
    learn: free.filter((c) => c.ripeningMono === null && due(c))
      .sort((a, b) => byInstant(a.nextAskMono, b.nextAskMono) || byId(a.id, b.id))
      .slice(0, i.auditsMax).map((c) => c.id),
  };
}

/** A settled act job as the LANE folds it (spec §5.10): the executor's outcome, by its kind, or a job that THREW — a
 *  defect, since the executor names every condition it meets — which may have acted. Declared STRUCTURALLY: L1 may not
 *  import the executor's L3 `CollectJobOutcome` (H2), which is assignable to this (a compile pin holds it). */
export type CollectJobSettled =
  | { readonly kind: 'not-asked' | 'answered' | 'held' | 'would-collect' }
  | { readonly kind: 'acted'; readonly composedMono: number; readonly result: CollectResult }
  | { readonly kind: 'threw'; readonly detail: string };

/** What a settled act job does to the LANE (spec §5.10). What it does to its id is Task 4's transitions'. A lane-wide
 *  clear is not here: the executor applies one through the port the instant it sees it, and it is never folded twice. */
export interface CollectJobEffects {
  /** The slot, and its id with it, kept until this monotonic instant; `null` frees it. */
  readonly keptUntilMono: number | null;
  /** ccd's `flock-unavailable` die: latched for the process. */
  readonly latchFlock: boolean;
}

const COLLECT_SLOT_FREED: CollectJobEffects = { keptUntilMono: null, latchFlock: false };

/** THE SLOT'S LIFE (spec §5.10). FREED by a job that composed no `ws-collect`, at any step — a switch, presence, the hold,
 *  a cleared pair, the capability re-check, a marker flip and shadow's would-collect alike — and by an act that answered
 *  a document or a recognised pre-lock die, which acted nothing. ONLY an act that answered no document (a runner kill, a
 *  timeout, a client wait expiry, a link failure, or anything unrecognised), which MAY have acted, keeps the slot and
 *  its id until `stallMs` after the act was COMPOSED; a job that threw keeps them until `stallMs` after it SETTLED, the
 *  later instant, since when it composed is not known. Every arm is named, so a new one is a compile error here before
 *  it is a slot nobody frees. */
export function collectJobEffects(s: CollectJobSettled, settledMono: number, stallMs: number): CollectJobEffects {
  switch (s.kind) {
    case 'not-asked': case 'answered': case 'held': case 'would-collect':
      return COLLECT_SLOT_FREED;
    case 'acted':
      switch (s.result.kind) {
        case 'no-document': return { ...COLLECT_SLOT_FREED, keptUntilMono: s.composedMono + stallMs };
        case 'die': return s.result.word === 'flock-unavailable' ? { ...COLLECT_SLOT_FREED, latchFlock: true } : COLLECT_SLOT_FREED;
        case 'collected': case 'refused': case 'failed': return COLLECT_SLOT_FREED;
        default: { const unnamed: never = s.result; return unnamed; }
      }
    case 'threw':
      return { ...COLLECT_SLOT_FREED, keptUntilMono: settledMono + stallMs };
    default: { const unnamed: never = s; return unnamed; }
  }
}
```

`collectNextAskMono`, `collectRipe`, `CollectEntry` and `CollectResult` are Tasks 2 and 4's, in this same file, so the block imports nothing. `collectLane.ts` still imports only its two H2 specifiers, `../../shared/api.js` and `./childReclaimSweep.js`, and Task 4's `collect-pacing` suite pins that pair.

- [ ] **Step 5: L4, `server/src/watch.ts`**

(a) **The import block.** Insert directly after `import { CATALOGUE_POLL_INTERVAL_MS } from './update/catalogue.js';` (`:136`). It is a block of its own, so no existing import line changes; run 358 edits `:112`, `:121` and `:125`.

```ts
// THE TEMP-ROOT COLLECTOR'S LANE (child reclamation wave 9, spec §5.10). A block of its own, so no import line above
// changes: `ccdargv.js` and `childReclaimSweep.js` are imported a second time here, by name.
import { COLLECT_CAP } from './ccdargv.js';
import type { ChildReclaimCollectInput } from './childReclaimSweep.js';
import {
  COLLECT_AUDITS_PER_PASS, COLLECT_FEED_TITLE, collectAfterAct, collectAfterAudit, collectAfterHold, collectAfterPresence,
  collectAfterWouldCollect, collectAttentionItems, collectAttentionViewOf, collectBoxProbesAfter, collectCandidateOf,
  collectClearPair, collectFeedAnswerBody, collectFeedCollectedBody, collectFeedCueOfAct, collectFeedCueOfAudit,
  collectFeedStep, collectFeedSwitchBody, collectFeedWouldCollectBody, collectFirstSighting, collectForgets, collectFresh,
  collectJobEffects, collectOffers, collectPassClass, collectPopulation, collectWouldCollectKey,
  type CollectAttentionView, type CollectAudit, type CollectEntry, type CollectFeedCue,
  type CollectPassClass, type CollectPopulation, type CollectResult, type CollectStep, type CollectUnsettledKind,
} from './collectLane.js';
import {
  collectSwitches, collectTempRoot, learnCollect, readCollectPopulation,
  type CollectClock, type CollectGenerations, type CollectJobOutcome, type CollectLanePort,
} from './coord/collectTempRoot.js';
```

Then, in the `./childReclaimSweep.js` import block (`:94-108`), delete the name `CHILD_RECLAIM_COLLECT_NONE` that Task 5 added (with its separating `, `), and nothing else: (h) leaves it unused. Locate it by content (`grep -n "CHILD_RECLAIM_COLLECT_NONE" server/src/watch.ts`); it is clear of run 358's lines.

(b) **The observation interval.** Directly after `export const CHILD_RECLAIM_SWEEP_MS = 60_000;`, insert:

```ts

/** The temp-root collector's observation interval (spec §5.10): the lane spends a token only when its executor's own
 *  audit ARRIVED at least this long after an earlier audit of the id answered that same token, on this process's
 *  monotonic clock. The child lane's cadence, for that lane's reason, and DERIVED from it, never a second literal; L1
 *  takes it as an argument (it imports no L4 constant). EXPORTED for its suite. */
export const COLLECT_OBSERVE_INTERVAL_MS = CHILD_RECLAIM_SWEEP_MS;
```

(c) **The audit's bound and the lane's two state shapes.** Directly after `export const CHILD_RECLAIM_STALL_MS = 480_000;`, insert:

```ts

/** How long a collector AUDIT (`ws-audit --collect`, a learning audit or the executor's own) may stay unsettled before
 *  the lane lists it (spec §5.10): twice `ws-audit`'s remote runner row, 90 s (`remote/runner.ts`, whose table is not
 *  exported, so the suite reads the row and pins this against it). Local mode's runner has no timeout, so a call can
 *  hang for ever; the id is never asked again until it settles. An act JOB's bound, whatever it has out (its act, its
 *  own audit, or nothing yet), is `CHILD_RECLAIM_STALL_MS`, asked first. Counted from when the lane QUEUED the call
 *  (`unsettled-bound-counts-from-the-queue`).
 *  EXPORTED for its suite. */
export const COLLECT_AUDIT_STALL_MS = 2 * 90_000;

/** One collector call or job the lane has queued and not heard back on (spec §5.10), with the monotonic instant it
 *  was QUEUED:
 *  - `learn`: a learning audit;
 *  - `act`: the executor's job, whose `phase` says what is out: `queued` (waiting on the id's key, or between its
 *    calls), `audit` (its own `ws-audit`) or `act` (its `ws-collect`). The runner the lane hands the executor sets it
 *    (`collectRunCcd`), so the unsettled line can list the executor's own audit at the audit's bound; at STALL the job
 *    is listed as holding the act slot, whatever is out. */
export interface CollectFlight {
  readonly kind: 'learn' | 'act';
  readonly sinceMono: number;
  readonly phase: 'queued' | 'audit' | 'act';
}

/** The collector's fleet-wide act slot (spec §5.10): free; taken by the act job queued for `id`; or KEPT, with its id,
 *  until `untilMono`, after an act that may have acted. */
export type CollectSlot =
  | { readonly kind: 'free' }
  | { readonly kind: 'job'; readonly id: string; readonly sinceMono: number }
  | { readonly kind: 'kept'; readonly id: string; readonly untilMono: number };
```

(d) **The lane's fields.** Directly after `  private deadCoordinatorSerial: CoordRoutesHandle['withSweepAbandon'] | null = null;`, insert:

```ts
  /** THE TEMP-ROOT COLLECTOR'S LANE (spec §5.10, child reclamation wave 9): its clocks and memory, its OWN — never the
   *  child lane's, the expiry lane's or the dead-coordinator lane's. IN MEMORY ONLY, deliberately: a restart loses all of
   *  it, and losing it can only DELAY a collection (two fresh observations, the start hold-off), never cause one. STATED
   *  RESIDUAL (R87): a restart re-enters each terminal and verb-failed id at j = 0, about eight extra terminal audits or
   *  failing acts per such id after it.
   *  - `lastCollectSweep`: the throttle, on the MONOTONIC clock; `null` before the first pass.
   *  - `collectSweeping`: one pass at a time (`sweepTempRootCollect`), over the gather and the decide-and-enqueue only.
   *  - `collectStartMono`: this lane's start (the watcher's construction), monotonic. No act job is offered until
   *    `CHILD_RECLAIM_STALL_MS` after it.
   *  - `collectGen`: the ONE counter every generation is drawn from, the lane-wide one and every id's (Task 4).
   *  - `collectLaneGen`: the lane-wide clear generation (`collectClearPairs`).
   *  - `collectState`: per id, `CollectEntry` (L1): the observation pair and its generation, the deferral count, the
   *    failing, verb-failed and terminal runs, the continuity clocks, the latest document's evidence and the feed
   *    episode. An entry is created only when a call for the id is queued.
   *  - `collectInFlight`: per id, the ONE call or job queued and not heard back on (`CollectFlight`). No further call is
   *    queued for an id in it.
   *  - `collectSlot`: the fleet-wide act slot (`CollectSlot`).
   *  - `collectUnsettledLogged`: the ids whose call this process has logged as unsettled, once.
   *  - `collectFlockLatched`: an act answered ccd's `flock-unavailable`: no act job is offered again in this process, and
   *    a box-wide line says so, so an armed lane is never silently off.
   *  - `collectLastSeenLive`: the live marker as the last act job read it. It starts SHADOWED, so an arming made while the
   *    server was down, or before a restart no job saw, is still a flip, and still writes its row.
   *  - `collectPop`: the last measured pass's population, for the box-wide listing and refused-name lines; `null` before
   *    one.
   *  - `collectBoxProbes`: the box-wide probes standing (Task 5's `collectBoxProbesAfter`, over every answer).
   *  - `collectPassSeq`, `collectPassTally`, `collectPassPublished`, `collectPassAudits`: each pass's audits by class
   *    (Task 5's `collectPassClass`), keyed by the pass that queued them; the latest pass whose calls have all settled is
   *    the one the pass-scoped box lines read. */
  private lastCollectSweep: number | null = null;
  private collectSweeping = false;
  private readonly collectStartMono: number;
  private collectGen = 0;
  private collectLaneGen = 0;
  private collectState = new Map<string, CollectEntry>();
  private collectInFlight = new Map<string, CollectFlight>();
  private collectSlot: CollectSlot = { kind: 'free' };
  private collectUnsettledLogged = new Set<string>();
  private collectFlockLatched = false;
  private collectLastSeenLive = false;
  private collectPop: CollectPopulation | null = null;
  private collectBoxProbes: ReadonlyMap<string, string> = new Map();
  private collectPassSeq = 0;
  private collectPassTally = new Map<number, { pending: number; readonly audits: Map<string, CollectPassClass> }>();
  private collectPassPublished = 0;
  private collectPassAudits: ReadonlyMap<string, CollectPassClass> = new Map();
```

(e) **The constructor.** Directly after `    this.headsSettled = new Promise<void>((resolve) => { this.settleHeads = resolve; });` (the constructor's last line), insert:

```ts
    // The collector lane's start (spec §5.10): its act hold-off counts from here, on the lane's monotonic clock.
    this.collectStartMono = deps.monotonicMs?.() ?? performance.now();
```

(f) **The accessor.** Directly after `currentDeadCoordinators()`'s closing brace, insert:

```ts

  /** The collector lane's memory, read-only (child reclamation wave 9, spec §5.10) — for its tests. No decision outside
   *  the lane reads it. */
  currentCollectLane(): {
    readonly entries: ReadonlyMap<string, CollectEntry>; readonly inFlight: ReadonlyMap<string, CollectFlight>;
    readonly slot: CollectSlot; readonly laneGen: number; readonly lastSeenLive: boolean; readonly flockLatched: boolean;
  } {
    return { entries: this.collectState, inFlight: this.collectInFlight, slot: this.collectSlot,
      laneGen: this.collectLaneGen, lastSeenLive: this.collectLastSeenLive, flockLatched: this.collectFlockLatched };
  }
```

(g) **The tick.** Directly after the two lines

```ts
      void this.sweepDeadCoordinators(records, registryRead.names)
        .catch(() => { /* one bad sweep must not kill the poll */ });
```

insert:

```ts
      // NEVER awaited, the same reasons: the TEMP-ROOT COLLECTOR's lane (child reclamation wave 9, spec §5.10) — a fourth
      // sibling at this tick's cadence and under its switch. Its population is its own two listings, read in its own
      // gather; this listing feeds its pre-filter, which is economy and never a permission.
      void this.sweepTempRootCollect(records, registryRead.names)
        .catch(() => { /* one bad sweep must not kill the poll */ });
```

(h) **The list's one write.**
- In the `childReclaimAttentionList` field docstring, directly after the bullet that ends `for the same child.`, insert:

```ts
   *  - Its `collect` items come from the temp-root collector's memory, read at the same one write (spec §5.10): that lane
   *    never assigns this list, and its items reach the frame only when the child lane publishes.
```

- In `childReclaimPublishAttention`'s docstring, replace `a child whose recorded verdict is \`held\`. L1 decides every item; this method only assigns.` with:

```ts
   *  a child whose recorded verdict is `held`; then the kept leaves, and the temp-root collector's items, read from that
   *  lane's memory here (spec §5.10). L1 decides every item and the precedence between them; this method only assigns.
```

  Keep the docstring's line breaks wherever the replaced text spans them.
- Replace the write's second line (its third argument is `CHILD_RECLAIM_COLLECT_NONE` as Task 5 leaves it, H8):

```ts
      childReclaimAttentionWithKept(mirrorArms, kept, verdicts), this.childReclaimLeaves, CHILD_RECLAIM_COLLECT_NONE);
```

with

```ts
      childReclaimAttentionWithKept(mirrorArms, kept, verdicts), this.childReclaimLeaves, this.collectAttention());
```

(i) **The pass.** Directly after `execChildReclaim`'s closing brace, and before `  /**\n   * THE EXPIRY LANE`, insert:

```ts

  /**
   * THE TEMP-ROOT COLLECTOR'S LANE (spec §5.10; child reclamation wave 9): the first AUTOMATIC composer of `ws-collect`.
   * A FOURTH sibling of `sweepChildReclaim` on the tick, at its cadence (`CHILD_RECLAIM_SWEEP_MS`) and under its switch
   * (`reclaim-paused`, the fleet's one cleanup switch), and nothing else: its own population (`$REG/tmproots` and
   * `$REG/tmpquarantine`, read in its own gather, never the registry rows and never `~/.cc-tmp`), its own memory, its
   * executor (`collectTempRoot`), its feed rows, and its attention items, which reach the frame only through the child
   * lane's one write (`childReclaimPublishAttention`).
   *
   * IT SHIPS SHADOWED. Until the operator touches the live marker by hand, a token the lane would spend is RECORDED — a
   * feed row once per (id, token) episode, and an attention item — and nothing is composed. The marker is read by the
   * executor alone, nearest the argv; this pass never reads it.
   *
   * WHAT IT ASKS. Each pass, at most ONE ACT JOB and at most `COLLECT_AUDITS_PER_PASS` LEARNING audits, chosen by
   * `collectOffers` (L1): the act first, to the earliest ripe id by ripening instant; then learning audits to due ids by
   * next-ask instant; each by id after that, and each skipping an id with a call pending. Every call rides the id's
   * `KeyedQueue` key, the key the reclaim and expiry executors use, so no two lanes touch one id at once, and no further
   * call is queued for an id whose last call has not settled (`collectInFlight`). The executor captures each request's
   * generations when it is COMPOSED; its answer is an OBSERVATION only if both still stand when it arrives (L1's
   * `collectFresh`). The act job spends only its OWN audit's token (observation 2), the token an earlier audit answered
   * (observation 1) at least `COLLECT_OBSERVE_INTERVAL_MS` before it, with only that token answered between.
   *
   * IT NEVER AWAITS A CALL IT QUEUED. `collectSweeping` spans the gather and the decide-and-enqueue only. Each call is
   * tracked by its queued-at stamp (`collectInFlight`), and every pass derives the unsettled lines from those stamps, so a
   * call or job that never settles never stops a later pass.
   *
   * THE SLOT. At most one act job in flight fleet-wide. It is taken when the job is queued; `collectJobEffects` (L1) says
   * whether the settled job frees it or keeps it, with its id, until `CHILD_RECLAIM_STALL_MS` after an act that may have
   * acted. A job that never settles keeps it for as long as it stands, and is listed. No act job is offered until
   * `CHILD_RECLAIM_STALL_MS` after this lane's start, because a restart forgets the slot while the previous process's
   * act may still be running on the box. STATED RESIDUALS (spec §7): in local mode that rests on the server unit's
   * default `KillMode=control-group`; and a killed ccd's orphaned children are not counted against the slot (they hold
   * the id's reap lock, so ccd answers `in-progress` for it).
   *
   * PUBLIC for `sweepDivergences`'s reason: `tick()` dispatches it with `void`. `records` is NOT read — the population is
   * the two listings — and is kept for the siblings' signature. `names` is the tick's listing, which feeds the
   * pre-filter alone: economy, never permission.
   */
  async sweepTempRootCollect(records: readonly SessionRecord[], names: readonly string[]): Promise<void> {
    const coord = this.deps.coord;
    if (!coord || this.collectSweeping) return;
    // THE THROTTLE, on the MONOTONIC clock (spec §5.10): stamped BEFORE the gather, so a pass a gate stops still spends
    // its interval, and re-stamped after it (`collectPass`) with the pass's decision clock.
    const gate = this.childReclaimLaneNow().monoMs;
    if (this.lastCollectSweep !== null && gate - this.lastCollectSweep < CHILD_RECLAIM_SWEEP_MS) return;
    this.lastCollectSweep = gate;
    // ONE PASS AT A TIME (spec §5.10): held over the gather and the decide-and-enqueue, so no pass is ever overtaken
    // while it gathers. The calls a pass queues are NOT under it, and are never awaited: they settle on their own.
    this.collectSweeping = true;
    try {
      await this.collectPass(coord, names);
    } finally {
      this.collectSweeping = false;
    }
  }

  /** One pass of the collector's lane, run only while no other pass runs. Its ONE await is the gather. It queues its
   *  calls and never awaits them (`sweepTempRootCollect`). */
  private async collectPass(coord: CoordStore, names: readonly string[]): Promise<void> {
    // ONE — the capabilities (spec §5.10): both, or the lane never runs — never an automatic destructive lane on a box the
    // phone cannot pause. A missing one clears every pair, so each id needs two FRESH observations once it returns.
    if (!capSupported(this.deps.fleetState, COLLECT_CAP) || !capSupported(this.deps.fleetState, RECLAIM_PAUSE_CAP)) {
      this.collectClearPairs();
      return;
    }
    // TWO — THE ONE GATHER (spec §5.10): the population's two listings and the switches' own registry listing, together.
    // The pause is read from THIS listing, not the tick's, because the tick never hands a lane a registry that did not
    // list, and this lane must read one as a pause. Neither read rejects: a port that does makes THAT listing unmeasured,
    // or the registry paused. So no catch stands here: a guard no case can reach has no red (H13).
    const gathered = await Promise.all([
      readCollectPopulation(this.deps.io, this.deps.cfg.registryDir),
      collectSwitches(this.deps.io, this.deps.cfg.registryDir),
    ]);
    // The pass's decision clock, read AFTER the gather; the throttle re-stamped with it, so any two deciding passes are at
    // least one interval apart however long a gather takes.
    const mono = this.childReclaimLaneNow().monoMs;
    this.lastCollectSweep = mono;
    const [listings, switches] = gathered;
    // THREE — the switch: a raised pause, or a registry that did not list, stops the pass before any audit and clears
    // every pair. Only `paused` is read: the live marker in the same listing is the executor's, at its act.
    if (switches.paused) {
      this.collectClearPairs();
      return;
    }
    // FOUR — the population (L1): the ids to consider, from the MEASURED listings only, pre-filtered on the tick's exact
    // `<id>.child` and `<id>.uuid` names unless a measured record names the id. Kept for the box-wide lines. An id is
    // forgotten — its pacing and episodes with it, and no feed row — only when `collectForgets` says so (both listings
    // measured, neither names it); an answer still out for it then finds no entry, and is dropped.
    const pop = collectPopulation({ ...listings, registryNames: new Set(names) });
    this.collectPop = pop;
    for (const id of [...this.collectState.keys()]) if (collectForgets(pop, id)) this.collectState.delete(id);
    // FIVE — the slot's kept deadline, and each call past its bound, logged once (its line is derived at the publish).
    if (this.collectSlot.kind === 'kept' && mono >= this.collectSlot.untilMono) this.collectSlot = { kind: 'free' };
    this.collectLogUnsettled(mono);
    // SIX — who is asked (L1), and the calls, each on its id's queue key, the act first. None is awaited.
    const busy = new Set<string>(this.collectInFlight.keys());
    if (this.collectSlot.kind === 'kept') busy.add(this.collectSlot.id);
    const offers = collectOffers({
      candidates: pop.candidates.map((id) => collectCandidateOf(id, this.collectState.get(id), mono,
        CHILD_RECLAIM_SWEEP_MS, COLLECT_OBSERVE_INTERVAL_MS)),
      busy, nowMono: mono, auditsMax: COLLECT_AUDITS_PER_PASS,
      act: { slotFree: this.collectSlot.kind === 'free', flockLatched: this.collectFlockLatched,
        startMono: this.collectStartMono, holdOffMs: CHILD_RECLAIM_STALL_MS },
    });
    const calls = offers.learn.length + (offers.act === null ? 0 : 1);
    if (calls === 0) return;
    const pass = ++this.collectPassSeq;
    this.collectPassTally.set(pass, { pending: calls, audits: new Map() });
    if (offers.act !== null) this.collectAct(coord, offers.act, pass, mono);
    for (const id of offers.learn) this.collectLearn(coord, id, pass, mono);
  }

  /** One LEARNING audit (spec §5.10): `learnCollect` on the id's queue key, never awaited. The executor captures the
   *  generations as it composes, through the port. An answer folds through Task 4's `collectAfterAudit`, an observation
   *  only under its capture; a missing capability is a lane-wide clear; a rejection is a defect the reader could not
   *  name, folded as an audit with no document that observes nothing (`a-thrown-job-reads-as-no-document`). */
  private collectLearn(coord: CoordStore, id: string, pass: number, mono: number): void {
    this.collectEntryOf(id);
    this.collectInFlight.set(id, { kind: 'learn', sinceMono: mono, phase: 'queued' });
    void this.deps.queue.run(id, () => learnCollect({
      runCcd: this.collectRunCcd(id), fleetState: this.deps.fleetState, lane: this.collectPortFor(coord, id),
    }, id))
      .then((answer) => {
        if (answer.kind === 'not-asked') { this.collectClearPairs(); return; }
        this.collectFoldAudit(coord, id, pass, answer.audit.value, answer.audit.arrived, answer.audit.composed);
      }, (err: unknown) => {
        this.collectFoldAudit(coord, id, null, { kind: 'no-document', stderr: err instanceof Error ? err.message : String(err) },
          this.collectClock(), null);
      })
      .catch((err: unknown) => {
        console.warn(`ccrc-server: sweepTempRootCollect: folding the learning audit for ${id} failed (${err instanceof Error ? err.message : String(err)})`);
      })
      .finally(() => { this.collectSettled(id, pass); });
  }

  /** The ONE act job (spec §5.10): `collectTempRoot`'s six steps on the id's queue key, the fleet-wide slot taken as it
   *  is queued, never awaited. The deps are composed INSIDE the queue callback, `execChildReclaim`'s idiom, so the job
   *  reads `deps`'s current answer when it runs. It reaches this lane's memory through `collectPortFor` alone. Its
   *  answer is folded for the LANE first (`collectJobEffects`: the slot, the latch), then for its id
   *  (`collectFoldJob`). */
  private collectAct(coord: CoordStore, id: string, pass: number, mono: number): void {
    this.collectEntryOf(id);
    this.collectInFlight.set(id, { kind: 'act', sinceMono: mono, phase: 'queued' });
    this.collectSlot = { kind: 'job', id, sinceMono: mono };
    void this.deps.queue.run(id, () => collectTempRoot({
      coord, io: this.deps.io, cfg: this.deps.cfg, runCcd: this.collectRunCcd(id), fleetState: this.deps.fleetState,
      presence: this.deps.presence, lane: this.collectPortFor(coord, id), observeIntervalMs: COLLECT_OBSERVE_INTERVAL_MS,
    }, { id }))
      .then((outcome) => { this.collectSettleJob(coord, id, pass, outcome); }, (err: unknown) => {
        const detail = err instanceof Error ? err.message : String(err);
        console.warn(`ccrc-server: sweepTempRootCollect: the collector's job for ${id} threw (${detail}) — read as one that may have acted: the act slot and ${id} wait CHILD_RECLAIM_STALL_MS`);
        this.collectSettleJob(coord, id, pass, { kind: 'threw', detail });
      })
      .catch((err: unknown) => {
        console.warn(`ccrc-server: sweepTempRootCollect: folding the collector's job for ${id} failed (${err instanceof Error ? err.message : String(err)})`);
      })
      .finally(() => { this.collectSettled(id, pass); });
  }

  /** A settled act job (spec §5.10): its LANE effects first (L1's `collectJobEffects`: the slot, the latch), then its
   *  fold for the id. A lane-wide clear the job saw was applied through the port the instant it saw it, never here. */
  private collectSettleJob(coord: CoordStore, id: string, pass: number,
    s: CollectJobOutcome | { readonly kind: 'threw'; readonly detail: string }): void {
    const clock = this.collectClock();
    const fx = collectJobEffects(s, clock.mono, CHILD_RECLAIM_STALL_MS);
    this.collectSlot = fx.keptUntilMono === null ? { kind: 'free' } : { kind: 'kept', id, untilMono: fx.keptUntilMono };
    if (fx.latchFlock) this.collectFlockLatched = true;
    this.collectFoldJob(coord, id, pass, s, clock);
  }

  /** THE FOLD TABLE (spec §5.10): each of the executor's outcome arms through Task 4's transitions, each transition at
   *  the answer's ARRIVAL under a generation the lane never used before. Nothing here decides a pace; L1 does.
   *  - `not-asked`: caps and paused were cleared through the port already, and a refused id has nothing to pace;
   *    presence (step 3) is `collectAfterPresence`.
   *  - every arm that carries observation 2's answer folds it first (`collectFoldAudit`): an observation only under its
   *    capture, so a stale, paused, flipped, capability-less or cleared job's answer paces and never observes; then
   *    `answered` presence (step 6) is `collectAfterPresence`, `held` is `collectAfterHold`, `would-collect` is
   *    `collectAfterWouldCollect` with its once-per-(id, token) row, and `acted` is `collectAfterAct` with its row.
   *  - `threw`: an audit with no document, which observes nothing. */
  private collectFoldJob(coord: CoordStore, id: string, pass: number,
    s: CollectJobOutcome | { readonly kind: 'threw'; readonly detail: string }, clock: CollectClock): void {
    if (s.kind === 'threw') {
      this.collectFoldAudit(coord, id, null, { kind: 'no-document', stderr: s.detail }, clock, null);
      return;
    }
    if (s.kind === 'not-asked') {
      const e = this.collectState.get(id);
      if (s.why === 'presence' && e !== undefined) this.collectState.set(id, collectAfterPresence(e, this.collectStepAt(clock)));
      return;
    }
    const e = this.collectFoldAudit(coord, id, pass, s.audit.value, s.audit.arrived, s.audit.composed);
    if (e === null) return;
    const at = this.collectStepAt(s.audit.arrived);
    switch (s.kind) {
      case 'answered':
        if (s.why === 'presence') this.collectState.set(id, collectAfterPresence(e, at));
        return;
      case 'held':
        this.collectState.set(id, collectAfterHold(e, s.hold.why, at));
        return;
      case 'would-collect': {
        const next = collectAfterWouldCollect(e, at);
        this.collectFeedAfter(coord, id, next, { kind: 'row', key: collectWouldCollectKey(s.audit.value.token) },
          () => ({ title: COLLECT_FEED_TITLE['would-collect'],
            body: collectFeedWouldCollectBody(id, next.evidence.runId, next.evidence.leaf) }));
        return;
      }
      case 'acted': {
        this.collectBoxProbes = collectBoxProbesAfter(this.collectBoxProbes, s.result);
        const next = collectAfterAct(e, s.result, this.collectStepAt(s.arrived));
        this.collectFeedAfter(coord, id, next, collectFeedCueOfAct(s.result), () => this.collectActRow(id, next, s.result));
        return;
      }
      default: { const unnamed: never = s; return unnamed; }
    }
  }

  /** Folds one AUDIT answer (spec §5.10). What it says of the BOX counts whatever became of the id: the box-wide probes
   *  (Task 5's `collectBoxProbesAfter`) and, for an answer a pass queued, that pass's tally (`collectPassClass`). Then
   *  the id's entry, through Task 4's `collectAfterAudit`: an OBSERVATION only when `composed` is given and both
   *  generations it captured still stand (`collectFresh`); then the feed cue. An id forgotten while the call was out has
   *  no entry, and the answer is dropped for it (`an-answer-for-a-forgotten-id-is-dropped`): the entry written, or
   *  null. */
  private collectFoldAudit(coord: CoordStore, id: string, pass: number | null, a: CollectAudit, arrived: CollectClock,
    composed: CollectGenerations | null): CollectEntry | null {
    this.collectBoxProbes = collectBoxProbesAfter(this.collectBoxProbes, a);
    if (pass !== null) this.collectPassTally.get(pass)?.audits.set(id, collectPassClass(a));
    const entry = this.collectState.get(id);
    if (entry === undefined) return null;
    const observes = composed !== null && collectFresh(composed, this.collectLaneGen, entry);
    const next = collectAfterAudit(entry, a, this.collectStepAt(arrived), observes);
    return this.collectFeedAfter(coord, id, next, collectFeedCueOfAudit(a), () => ({ title: COLLECT_FEED_TITLE.answer,
      body: this.collectAuditBody(id, next, a) }));
  }

  /** Writes `next` back after one step's feed cue (Task 4's `collectFeedStep`, over Task 5's cue), and writes the
   *  episode's ONE row only when the step opened one: a repeat is quiet. */
  private collectFeedAfter(coord: CoordStore, id: string, next: CollectEntry, cue: CollectFeedCue,
    row: () => { readonly title: string; readonly body: string }): CollectEntry {
    const stepped = collectFeedStep(next, cue);
    this.collectState.set(id, stepped.entry);
    if (stepped.opened !== null) {
      const r = row();
      this.collectRecordFeed(coord, { sessionId: id, runId: stepped.entry.evidence.runId, title: r.title, body: r.body });
    }
    return stepped.entry;
  }

  /** An audit answer's row body, worded by Task 5's builder (spec §5.10). A collectable answer opens no row. */
  private collectAuditBody(id: string, e: CollectEntry, a: CollectAudit): string {
    const runId = e.evidence.runId;
    switch (a.kind) {
      case 'verdict': return collectFeedAnswerBody(id, runId, a.verdict, a.detail, []);
      case 'unmeasured': return collectFeedAnswerBody(id, runId, a.probe, a.detail, []);
      case 'no-document': return collectFeedAnswerBody(id, runId, a.kind, a.stderr, []);
      case 'unreadable': return collectFeedAnswerBody(id, runId, a.kind, a.detail, []);
      case 'collectable': return collectFeedAnswerBody(id, runId, a.kind, null, []);
      default: { const unnamed: never = a; return unnamed; }
    }
  }

  /** An act's row, titled and worded by Task 5 (spec §5.10): `collected` its own; every other outcome ccd's word. */
  private collectActRow(id: string, e: CollectEntry, r: CollectResult): { readonly title: string; readonly body: string } {
    const runId = e.evidence.runId;
    switch (r.kind) {
      case 'collected':
        return { title: COLLECT_FEED_TITLE.collected, body: collectFeedCollectedBody(id, runId, e.evidence.leaf, r) };
      case 'refused': return { title: COLLECT_FEED_TITLE.answer, body: collectFeedAnswerBody(id, runId, r.word, r.detail, r.paths) };
      case 'failed': return { title: COLLECT_FEED_TITLE.answer, body: collectFeedAnswerBody(id, runId, r.token, r.detail, []) };
      case 'die': return { title: COLLECT_FEED_TITLE.answer, body: collectFeedAnswerBody(id, runId, r.word, null, []) };
      case 'no-document': return { title: COLLECT_FEED_TITLE.answer, body: collectFeedAnswerBody(id, runId, r.kind, r.stderr, []) };
      default: { const unnamed: never = r; return unnamed; }
    }
  }

  /** The collector's feed rows (spec §5.10, R82): written HERE, never by the definer (`collectLane.ts`) or the executor
   *  (`coord/collectTempRoot.ts`), in `recordExpireFeed`'s idiom — a `run` row, recorded and archived, never pushed; a
   *  failed archive write is said and never stops the lane; the log is flushed whatever happened. */
  private collectRecordFeed(coord: CoordStore, row: {
    readonly sessionId: string; readonly runId: number | null; readonly title: string; readonly body: string;
  }): void {
    const log = this.deps.notifyLog;
    if (!log) return;
    try {
      const ev = log.record({ kind: 'run', sessionId: row.sessionId, runId: row.runId, title: row.title, body: row.body });
      coord.recordFeedEvent(log.epoch, ev);
    } catch (err) {
      console.warn('ccrc-server: recordFeedEvent failed '
        + `(${err instanceof Error ? err.message : String(err)}) — temp-root collector ${row.title}, feed archive degraded`);
    } finally {
      void log.flush();
    }
  }

  /** The executor's view of this lane's memory (spec §5.10; `CollectLanePort`, declared by the executor). Every member is
   *  synchronous, so the executor's step 6 reads observation 1 with no await between that read and its argv, and its step
   *  5 records the marker with none between the read and the flip. `id` is the job's, which the flip's row names. */
  private collectPortFor(coord: CoordStore, id: string): CollectLanePort {
    return {
      clock: () => this.collectClock(),
      generations: (of) => ({ lane: this.collectLaneGen, id: this.collectState.get(of)?.idGen ?? -1 }),
      observation: (of) => this.collectState.get(of)?.obs ?? null,
      cleared: () => { this.collectClearPairs(); },
      flipped: (live) => {
        // THE LAST-SEEN-LIVE FLAG (spec §5.10). A change either way is a FLIP: every pair clears, ONE feed row says so —
        // any same-uid session can touch the marker, so the operator sees every change — and the job that saw it
        // composes nothing. It starts SHADOWED, so an arming the lane never saw is a flip too.
        if (live === this.collectLastSeenLive) return false;
        this.collectLastSeenLive = live;
        this.collectClearPairs();
        this.collectRecordFeed(coord, { sessionId: id, runId: null, title: COLLECT_FEED_TITLE.switch,
          body: collectFeedSwitchBody(live) });
        return true;
      },
    };
  }

  /** The runner the lane hands its calls (spec §5.10): `deps.runCcd`, marking the id's flight with what is out — an
   *  audit (`argv[0]` is `ws-audit`) or the act (anything else the executor composes) — and back to `queued` when the
   *  call settles, so the unsettled line can tell the executor's audit from its act and from a job that has composed
   *  nothing. It decides nothing and composes nothing. */
  private collectRunCcd(id: string): Deps['runCcd'] {
    return async (argv) => {
      this.collectPhase(id, argv[0] === 'ws-audit' ? 'audit' : 'act');
      try {
        return await this.deps.runCcd(argv);
      } finally {
        this.collectPhase(id, 'queued');
      }
    };
  }

  private collectPhase(id: string, phase: CollectFlight['phase']): void {
    const f = this.collectInFlight.get(id);
    if (f !== undefined) this.collectInFlight.set(id, { ...f, phase });
  }

  /** The lane's two clocks, read together (Task 6's `CollectClock`). */
  private collectClock(): CollectClock {
    const n = this.childReclaimLaneNow();
    return { mono: n.monoMs, wall: n.wallMs };
  }

  /** One transition's context (Task 4's `CollectStep`): the answer's ARRIVAL, and a generation drawn from the ONE
   *  counter, never used before. */
  private collectStepAt(arrived: CollectClock): CollectStep {
    return { now: { monoMs: arrived.mono, wallMs: arrived.wall }, gen: ++this.collectGen, passIntervalMs: CHILD_RECLAIM_SWEEP_MS };
  }

  /** The id's entry, a first sighting (L1) the first time the lane queues a call for it, under a fresh generation. */
  private collectEntryOf(id: string): CollectEntry {
    const known = this.collectState.get(id);
    if (known !== undefined) return known;
    const fresh = collectFirstSighting(++this.collectGen);
    this.collectState.set(id, fresh);
    return fresh;
  }

  /** A LANE-WIDE CLEAR (spec §5.10): a raised pause or an unlistable registry, a missing capability, a marker flip.
   *  The lane's generation moves to a value never used before, so the answer to any call composed
   *  before it is no observation, and every entry goes through Task 4's `collectClearPair`: the PAIRS only. Each id's
   *  next ask, its runs, its clocks and its feed episodes survive; only a restart loses them. */
  private collectClearPairs(): void {
    this.collectLaneGen = ++this.collectGen;
    for (const [id, e] of this.collectState) this.collectState.set(id, collectClearPair(e));
  }

  /** One call or job settled: its flight ends, and its pass's tally counts it. The latest pass whose calls have all
   *  settled becomes the one the pass-scoped box lines read; an older pass still open is dropped then. */
  private collectSettled(id: string, pass: number): void {
    this.collectInFlight.delete(id);
    this.collectUnsettledLogged.delete(id);
    const t = this.collectPassTally.get(pass);
    if (t === undefined) return;
    t.pending -= 1;
    if (t.pending > 0) return;
    this.collectPassTally.delete(pass);
    if (pass < this.collectPassPublished) return;
    this.collectPassPublished = pass;
    this.collectPassAudits = t.audits;
    for (const p of [...this.collectPassTally.keys()]) if (p < pass) this.collectPassTally.delete(p);
  }

  /** The ids whose collector call or job has not settled within its bound (spec §5.10), by kind, each counted from when
   *  it was QUEUED. An act JOB not settled `CHILD_RECLAIM_STALL_MS` after it took the slot is asked FIRST, whatever it
   *  has out: its `ws-collect` (`act`), or its own audit or nothing yet (`job`) — R85's "even if it never composed a
   *  call" — and Task 5's line says the act slot is held for both. Short of that, an audit (a learning audit, or the
   *  job's own) is listed at `COLLECT_AUDIT_STALL_MS`. The two kinds differ only in the process log's noun. */
  private collectUnsettled(mono: number): Map<string, CollectUnsettledKind> {
    const out = new Map<string, CollectUnsettledKind>();
    for (const [id, f] of [...this.collectInFlight].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const age = mono - f.sinceMono;
      if (f.kind === 'act' && age >= CHILD_RECLAIM_STALL_MS) out.set(id, f.phase === 'act' ? 'act' : 'job');
      else if ((f.kind === 'learn' || f.phase === 'audit') && age >= COLLECT_AUDIT_STALL_MS) out.set(id, 'audit');
    }
    return out;
  }

  /** Each unsettled call is logged ONCE per process (spec §5.10); its attention line is derived at the publish. */
  private collectLogUnsettled(mono: number): void {
    for (const [id, kind] of this.collectUnsettled(mono)) {
      if (this.collectUnsettledLogged.has(id)) continue;
      this.collectUnsettledLogged.add(id);
      console.warn(`ccrc-server: sweepTempRootCollect: the collector's ${kind === 'job' ? 'job' : 'call'} for ${id} has not `
        + `settled within its bound — nothing further is queued for ${id} until it does`
        + `${this.collectSlot.kind === 'job' && this.collectSlot.id === id ? ', and the act slot stays taken' : ''}`);
    }
  }

  /** The collector's attention (spec §5.10), derived from this lane's memory when the child lane publishes its list:
   *  each entry through Task 5's projection, and the box facts. L1 decides every item; the list's ONE write merges them
   *  (`childReclaimPublishAttention`). A stated residual: they reach the frame only at that publish, and stand unchanged
   *  while the child lane's pass fails shut. */
  private collectAttention(): ChildReclaimCollectInput {
    const nowMono = this.collectClock().mono;
    const entries = new Map<string, CollectAttentionView>();
    for (const [id, e] of this.collectState) entries.set(id, collectAttentionViewOf(e));
    return collectAttentionItems({ entries, nowMono, box: {
      unmeasured: this.collectPop?.unmeasured ?? [], refusedNames: this.collectPop?.refusedNames ?? 0,
      boxProbes: this.collectBoxProbes, passAudits: this.collectPassAudits, flockLatched: this.collectFlockLatched,
      unsettled: this.collectUnsettled(nowMono),
    } });
  }
```

`ChildReclaimLaneNow`, `SessionRecord`, `CoordStore`, `Deps`, `capSupported` and `RECLAIM_PAUSE_CAP` are already imported by `watch.ts`. `performance` is imported at `:1`.

- [ ] **Step 6: Re-point census (c), and add `watch.ts` to the capability's holders, in the same commit**

(a) In `server/test/child-reclaim-verdict-readers.test.ts`, case `(c) the attention list is read only by the coord frame and the feedQuiet call site`, replace the `WRITE` literal as Task 5 left it (H8):

```ts
    const WRITE = 'this.childReclaimAttentionList = childReclaimAttentionWithLeaves(\n'
      + '      childReclaimAttentionWithKept(mirrorArms, kept, verdicts), this.childReclaimLeaves, CHILD_RECLAIM_COLLECT_NONE)';
```

with

```ts
    const WRITE = 'this.childReclaimAttentionList = childReclaimAttentionWithLeaves(\n'
      + '      childReclaimAttentionWithKept(mirrorArms, kept, verdicts), this.childReclaimLeaves, this.collectAttention())';
```

and its comment `// \`childReclaimPublishAttention\`: its one write.` with `// \`childReclaimPublishAttention\`: its one write, which merges the temp-root collector's items (spec §5.10).`

If Task 5's literal differs from the "before" text above, keep Task 5's shape and change only the third argument. Name the difference in the progress ledger.

(b) In `server/test/ws-collect-wiring.test.ts`, in the INERT `it` (`grep -n "the builders, the verb, its mode flag" server/test/ws-collect-wiring.test.ts`), change exactly ONE array (H5): the capability list (`grep -n "declared, read by nothing" …`), which Task 6 left as `.toEqual(['ccdargv.ts', 'coord/collectTempRoot.ts']);`, becomes `.toEqual(['ccdargv.ts', 'coord/collectTempRoot.ts', 'watch.ts']);`. The pass's gate asks `capSupported(…, COLLECT_CAP)` in `watch.ts`. The builder list, the `'ws-collect'` list and the `'--collect'` list stay byte for byte (`watch.ts` names none of them); the describe's title and messages are Task 8's.

- [ ] **Step 7: Run to green: the new files, the touched suites, both `tsc`, `typecheck-tests`**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-lane-bounds.test.ts test/collect-lane-pass.test.ts test/collect-lane-slot.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim-verdict-readers.test.ts test/child-reclaim-chip-source.test.ts \
  test/child-reclaim-leaf-kept-lane.test.ts test/child-reclaim-sweep.test.ts test/archived-expiry-lane.test.ts \
  test/dead-coordinator-lane.test.ts test/verb-gate.test.ts test/single-definition.test.ts test/ws-collect-wiring.test.ts
cd server && ./node_modules/.bin/vitest run test/collect-licence.test.ts test/collect-pacing.test.ts test/collect-population.test.ts \
  test/collect-readers.test.ts test/collect-attention.test.ts test/collect-feed-body.test.ts test/collect-temp-root.test.ts \
  test/collect-temp-root-reads.test.ts test/collect-open-run-hold.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
git diff --stat HEAD -- shared ccd agent pwa README.md server/test/single-definition.test.ts server/test/verb-gate.test.ts server/src/coord/collectTempRoot.ts server/test/collectTempRootFixture.ts   # prints nothing
git diff -U0 HEAD -- server/src/collectLane.ts | grep -c '^-[^-]'   # 0: the foot is appended, nothing above it changes
```

Expected:
- **The three new files:** `Test Files  3 passed (3)`, with every case green. The count is derived (bounds 25, pass 29, slot 15) and must be re-measured.
- **The nine touched or neighbouring suites:** all green. Census (c) now lists the new `WRITE`. `ws-collect-wiring.test.ts` is GREEN, all five cases: its INERT `it` names `watch.ts` among `COLLECT_CAP`'s holders (H5: no commit is red).
- **Tasks 2–6's collector suites:** green at the counts those tasks left. This task changed none of their files above `collectLane.ts`'s foot.
- **Both `tsc` runs** print nothing. The bounds suite's compile pin (`settles`) is where a `CollectJobOutcome` that is not assignable to `CollectJobSettled` reds.
- **`typecheck-tests`** is green. It is a known load flake: re-run it in isolation before calling it red.
- **The `git diff --stat` line** prints nothing, and **the last line** prints `0`.

Then run every other suite that builds a watcher, each file through vitest in the foreground. With no `collect-v1` advertised, the new pass returns at its cap gate:

```bash
grep -rln "new FleetWatcher" server/test | sort
```

All green, apart from the known load flakes, each re-run in isolation.

- [ ] **Step 8: Mutation check**

Make each mutation alone, record its red, and revert it before the next. B, P, S, V and W below are the files `test/collect-lane-bounds.test.ts`, `test/collect-lane-pass.test.ts`, `test/collect-lane-slot.test.ts`, `test/child-reclaim-verdict-readers.test.ts` and `test/ws-collect-wiring.test.ts`. Every row is DERIVED, not measured: measure each one and record its count.

| # | Mutation (exact edit) | Command (`cd server && ./node_modules/.bin/vitest run …`) | Expected red |
|---|---|---|---|
| T7.1 | `collectOffers`'s learning sort: delete `\|\| byId(a.id, b.id)` | `B` | `a never-asked id is due at once…`: `expected [ 'demo-c', 'demo-a' ] to deeply equal [ 'demo-a', 'demo-b' ]` |
| T7.2 | `collectOffers`'s act sort: delete `\|\| byId(a.id, b.id)` | `B` | `ONE act, to the earliest RIPENING instant…`: `expected 'demo-b' to be 'demo-a'` |
| T7.3 | the learning sort: delete `byInstant(a.nextAskMono, b.nextAskMono) \|\| ` (id order only) | `B` | `the next-ask instant orders before the id…`: `expected [ 'demo-a', 'demo-z' ] to deeply equal [ 'demo-z', 'demo-a' ]` |
| T7.4 | the act ranked by next-ask instant: `[{ id: c.id, at: c.ripeningMono }]` → `[{ id: c.id, at: c.nextAskMono }]` | `B` | `ONE act, to the earliest RIPENING instant…`: `expected 'demo-b' to be 'demo-a'` |
| T7.5 | `const free = i.candidates.filter((c) => !i.busy.has(c.id));` → `const free = i.candidates;` | `B` | `a busy id…`: `expected { act: 'demo-b', learn: [ 'demo-a' ] } to deeply equal { learn: [], act: null }`; `a ripe X with a never-settling call…`: `expected 'demo-x' to be 'demo-y'` |
| T7.6 | the act alone: `const ripe = free.flatMap(` → `const ripe = i.candidates.flatMap(` | `B` | `a ripe X with a never-settling call does not stop Y’s act`: `expected 'demo-x' to be 'demo-y'` |
| T7.7 | `learn`: delete `c.ripeningMono === null && ` | `B` | `an id holding an observation is never offered a learning audit…`: `expected { act: 'demo-a', learn: [ 'demo-a' ] } to deeply equal { learn: [], act: 'demo-a' }`, and the closed-act expectation |
| T7.8 | the act: delete `c.ripe && ` | `B` | `an id that holds an observation but is not ripe…`: `expected 'demo-a' to be null` |
| T7.9 | `open`: delete `!i.act.flockLatched && ` | `B`, `S` | B: `expected 'demo-a' to be null`. S, `flock-unavailable…`: `nothing composed after it: expected [ 'demo-a', 'demo-b' ] to deeply equal [ 'demo-a' ]` |
| T7.10 | `open`: delete `i.act.slotFree && ` | `B`, `S` | B, `the act is closed while the slot is taken…`: `expected 'demo-a' to be null`. S, `an act answering NO DOCUMENT…`: `no act, on any id, inside the window: expected [ { … } ] to deeply equal []` |
| T7.11 | `>= i.act.holdOffMs` → `> i.act.holdOffMs` | `B`, `S` | B: `exactly at its end: expected null to be 'demo-a'`. S, `exactly CHILD_RECLAIM_STALL_MS after its start…`: `expected [] to have a length of 1 but got 0` |
| T7.12 | `learn`: delete `.slice(0, i.auditsMax)` | `B`, `P` | B, `a never-asked id…`: `expected [ 'demo-a', 'demo-b', 'demo-c' ] to deeply equal [ 'demo-a', 'demo-b' ]`, and the cap case. P, `at most 2 learning audits a pass…`: the same |
| T7.13 | `collectCandidateOf`: `?? Number.NEGATIVE_INFINITY` → `?? 0` | `B` | `a first sighting reads through L1…`: `expected { …, nextAskMono: 0, … } to deeply equal { …, nextAskMono: -Infinity, … }` |
| T7.14 | `collectCandidateOf`, no entry: `nextAskMono: Number.NEGATIVE_INFINITY` → `nextAskMono: 0` | `B` | `no entry: never asked…`: `expected { …, nextAskMono: 0, … } to deeply equal { …, nextAskMono: -Infinity, … }` |
| T7.15 | `ripeningMono: entry.obs === null ? null : entry.obs.arrivedMono + observeIntervalMs` → `… : entry.obs.arrivedMono` | `B` | `observation 1 ripens one interval after it ARRIVED…`: `expected { …, ripeningMono: 940001, … } to deeply equal { …, ripeningMono: 1000001, … }` |
| T7.16 | `collectJobEffects`: `case 'no-document': return { …keptUntilMono… }` → `return COLLECT_SLOT_FREED;` | `B`, `S` | B, `NO DOCUMENT may have acted…`: `expected { keptUntilMono: null, … } to deeply equal { keptUntilMono: 487000, … }`. S, `an act answering NO DOCUMENT…`: `expected { kind: 'free' } to deeply equal { kind: 'kept', … }` |
| T7.17 | the `die` arm → `{ ...COLLECT_SLOT_FREED, keptUntilMono: s.composedMono + stallMs }` | `B`, `S` | B: both die rows. S, `an arm-1 lock-unopenable answer…`: `expected { kind: 'kept', … } to deeply equal { kind: 'free' }` |
| T7.18 | the `die` arm: `latchFlock: true` → `latchFlock: false` | `B`, `S` | B: the flock row. S: `expected false to be true` |
| T7.19 | move `case 'would-collect':` to return `{ ...COLLECT_SLOT_FREED, keptUntilMono: settledMono + stallMs }` | `B`, `S` | B: the would-collect row. S, `two ids each get a would-collect…`: `expected [] to have a length of 1 but got 0` |
| T7.20 | `case 'threw':` → `return COLLECT_SLOT_FREED;` | `B` | `a job that threw may have acted…`: `expected { keptUntilMono: null, … } to deeply equal { keptUntilMono: 489000, … }` |
| T7.21 | delete the tick's two-line `void this.sweepTempRootCollect(…)` dispatch | `P` | `the tick dispatches the pass…`: `an anchor is gone: expected false to be true`; `and a tick reaches the lane…`: `vi.waitFor` gives up, `expected [] to have a length of 1 but got 0` |
| T7.22 | `if (!coord \|\| this.collectSweeping) return;` → `if (!coord) return;` | `P` | `a tick that lands while a pass gathers…`: `the second pass gathered nothing: expected 2 to be 1` |
| T7.23 | delete `    this.lastCollectSweep = gate;` | `P` | `the throttle is stamped BEFORE the gather…`: `throttled from the stamp before the gather: expected 1 to be 0`; the source pin: `the throttle is stamped, then the guard raised: expected false to be true` |
| T7.24 | delete `    this.lastCollectSweep = mono;` | `P` | `and RE-STAMPED after it…`: `throttled from the decision clock: expected 2 to be 1`; the source pin: `expected -1 to be greater than <n>` |
| T7.25 | the pass awaits its calls: `collectLearn` and `collectAct` return their chains (drop the `void`), `collectPass` returns them, and `sweepTempRootCollect` awaits `Promise.all` of them inside its `try` | `P`, `S` | P, the source pin: `the pass awaits its gather alone: expected [ …(2) ] to have a length of 1 but got 2`. S, `an executor audit that never settles…`: `Error: Test timed out` (the pass waits on the held audit) |
| T7.26 | the cap gate: delete `\|\| !capSupported(this.deps.fleetState, RECLAIM_PAUSE_CAP)` | `P` | `the pause's capability missing…`: `no learning audit while the gate stands: the pass itself stops: expected [ {…} ] to deeply equal []` (demo-a's own job still stops at its step 1, so demo-a's count is no red) |
| T7.27 | the cap gate: delete its `this.collectClearPairs();` | `P` | both capability cases: `expected 1 to be 2` |
| T7.28 | delete the `if (switches.paused) { … }` block | `P` | `reclaim-paused raised` and `a registry that does not list`: `no learning audit while the gate stands: the pass itself stops: expected [ {…} ] to deeply equal []` (demo-a's own job still stops at its step 2) |
| T7.29 | the paused branch: delete its `this.collectClearPairs();` | `P` | the same two cases: `expected 1 to be 2` |
| T7.30–T7.31 | Deleted (H13): the gather's try/catch is gone from Step 5 (i), so these two rows, which could only measure green, go with it. The numbers are kept so that T7.32 onwards keep theirs | — | — |
| T7.32 | the forgetting rule: `if (collectForgets(pop, id))` → `if (!pop.ids.includes(id))` | `P` | `an id is forgotten only when BOTH…`: `one listing unmeasured: its absence is never read: expected false to be true`; `a port that rejects…`: `nor forgotten: expected false to be true` |
| T7.33 | delete the forgetting `for` line | `P` | `an id is forgotten only when BOTH…`: `both measured, neither names it: forgotten: expected true to be false` |
| T7.34 | `collectFoldAudit`: `const entry = this.collectState.get(id);` → `const entry = this.collectEntryOf(id);` | `P` | `an answer that arrives after its id was forgotten…`: `the late answer re-created nothing: expected true to be false` |
| T7.35 | `auditsMax: COLLECT_AUDITS_PER_PASS` → `auditsMax: COLLECT_AUDITS_PER_PASS + 1` | `P` | `at most 2 learning audits a pass…`: `expected [ 'demo-a', 'demo-b', 'demo-c' ] to deeply equal [ 'demo-a', 'demo-b' ]` |
| T7.36 | `export const COLLECT_AUDITS_PER_PASS = 2;` → `= 3;` | `P` | `at most 3 learning audits a pass…`: `expected [ 'demo-a', 'demo-b', 'demo-c' ] to deeply equal [ 'demo-a', 'demo-b' ]` |
| T7.37 | `collectLearn`: `this.deps.queue.run(id, () => learnCollect(…))` → `learnCollect(…)` | `P` | `a learning audit waits behind…`: `queued behind it, not composed: expected [ { … } ] to deeply equal []` |
| T7.38 | `collectAct`: `this.deps.queue.run(id, () => collectTempRoot(…))` → `collectTempRoot(…)` | `P` | `so does the act job…`: `the job's own audit waits too: expected [ …(2) ] to have a length of 1 but got 2` |
| T7.39 | `collectFoldAudit`: `const observes = composed !== null && collectFresh(composed, this.collectLaneGen, entry);` → `const observes = composed !== null;` | `P` | the stale-answer case: `demo-a: observations composed after the flip, before its first ws-collect: expected 1 to be greater than or equal to 2` |
| T7.40 | `collectClearPairs`: delete `this.collectLaneGen = ++this.collectGen;` (the pairs clear, the generation stands) | `P` | the stale-answer case, the same red |
| T7.41 | `collectClearPairs`: delete its `for (…) this.collectState.set(id, collectClearPair(e));` line (the generation moves, the pairs stand) | `P` | the four gate cases: `expected 1 to be 2` |
| T7.42 | `flipped`: delete `this.collectClearPairs();` | `P` | the stale-answer case: `demo-b: observations composed after the flip, before its first ws-collect: expected 1 to be greater than or equal to 2` |
| T7.43 | `private collectLastSeenLive = false;` → `private collectLastSeenLive = true;` | `P` | `a lane built with the marker standing…`: `expected [] to have a length of 1 but got 0`, and `expected [ { verb: 'collect', … } ] to deeply equal []` |
| T7.44 | `flipped`: delete the `this.collectRecordFeed(…)` call | `P` | `a lane built with the marker standing…` and `each flip writes ONE row…`: `expected [] to have a length of 1 but got 0` |
| T7.45 | add `const SHARED_COLLECT_STATE = new Map<string, CollectEntry>();` at module scope, and `private collectState = SHARED_COLLECT_STATE;` | `P` | `a restart needs two fresh observations…`: `the new process learns first…: expected [ { … } ] to deeply equal []` |
| T7.46 | `collectSettleJob`: after `if (fx.latchFlock) …`, insert `if (fx.keptUntilMono === null) return;` (no fold) | `P`, `S` | P, the presence case: `expected [] to deeply equal [ 'demo-b' ]`. S, `two ids each get a would-collect…`: `expected [] to have a length of 1 but got 0` |
| T7.47 | `collectFoldJob`, `would-collect`: the cue `{ kind: 'row', key: collectWouldCollectKey(…) }` → `{ kind: 'quiet' }` | `S` | `two ids each get a would-collect…`: `expected [] to have a length of 1 but got 0` |
| T7.48 | the publish: `this.collectAttention()` → `{ perId: [], manyLead: {}, box: [] }` | `P` | `an unmeasured listing is ONE box-wide item…`: `one box-wide line for the unmeasured listing: expected [] to have a length of 1 but got 0` |
| T7.49 | delete `if (this.collectSlot.kind === 'kept' && mono >= this.collectSlot.untilMono) this.collectSlot = { kind: 'free' };` | `S` | `an act answering NO DOCUMENT…`: `Error: not reached within 30 passes` |
| T7.50 | delete `if (this.collectSlot.kind === 'kept') busy.add(this.collectSlot.id);` | `S` | `an act answering NO DOCUMENT…`: `demo-a is not asked at all inside it: expected [ { … } ] to deeply equal []` |
| T7.51 | `slotFree: this.collectSlot.kind === 'free'` → `slotFree: this.collectSlot.kind === 'free' \|\| (this.collectSlot.kind === 'job' && mono - this.collectSlot.sinceMono >= CHILD_RECLAIM_STALL_MS)` (reclaim's "stops counting") | `S` | `an act job keeps the slot past STALL…`: `the slot was never freed by time: expected [ { … } ] to deeply equal []` |
| T7.52 | `startMono: this.collectStartMono` → `startMono: this.collectStartMono - CHILD_RECLAIM_STALL_MS` | `S` | `a lane composes no act inside CHILD_RECLAIM_STALL_MS…`: `no act job ran: none saw the marker: expected true to be false` |
| T7.53 | `collectUnsettled`: `age >= COLLECT_AUDIT_STALL_MS` → `age >= CHILD_RECLAIM_STALL_MS` | `S` | `a learning audit is listed at twice the audit row…` and `an executor audit that never settles…`: `expected [] to have a length of 1 but got 0` |
| T7.54 | `collectUnsettled`: delete `\|\| f.phase === 'audit'` | `S` | `an executor audit that never settles…`: `listed at the audit’s bound, not the act’s: expected [] to have a length of 1 but got 0` |
| T7.55 | `collectUnsettled`: swap the two branches back, the audit's bound asked first (`if ((f.kind === 'learn' \|\| f.phase === 'audit') && age >= COLLECT_AUDIT_STALL_MS) out.set(id, 'audit'); else if (f.kind === 'act' && age >= CHILD_RECLAIM_STALL_MS) …`) | `S` | `an executor audit that never settles…`: `its audit still out at STALL: the act slot is held: expected '…' to match /act slot is held/` |
| T7.56 | `collectUnsettled`: `f.phase === 'act' ? 'act' : 'job'` → `'job'` (Task 5's line words `act` and `job` alike, so the kind tells only the log's noun) | `S` | `an act job keeps the slot past STALL…`: `logged once, as its ws-collect call: expected false to be true` |
| T7.57 | `collectRunCcd`: delete `this.collectPhase(id, argv[0] === 'ws-audit' ? 'audit' : 'act');` (the phase never leaves `queued`) | `S` | `an executor audit that never settles…`: `listed at the audit’s bound…: expected [] to have a length of 1 but got 0`; `an act job keeps the slot past STALL…`: `logged once, as its ws-collect call: expected false to be true` |
| T7.58 | `const busy = new Set<string>(this.collectInFlight.keys());` → `const busy = new Set<string>();` | `S` | `a learning audit is listed…`: `never queued again while it stands: expected [ …(2) ] to have a length of 1 but got 2` |
| T7.59 | delete `if (fx.latchFlock) this.collectFlockLatched = true;` | `S` | `flock-unavailable latches…`: `expected false to be true` |
| T7.60 | the constructor: delete `this.collectStartMono = deps.monotonicMs?.() ?? performance.now();` | `./node_modules/.bin/tsc --noEmit -p .` | `src/watch.ts(…): error TS2564: Property 'collectStartMono' has no initializer and is not definitely assigned in the constructor.` |
| T7.61 | `export const COLLECT_OBSERVE_INTERVAL_MS = CHILD_RECLAIM_SWEEP_MS;` → `= 60_000;` | `P` | `the observation interval IS the sweep interval…`: `expected '…' to contain 'export const COLLECT_OBSERVE_INTERVAL_MS = CHILD_RECLAIM_SWEEP_MS;'` |
| T7.62 | `export const COLLECT_AUDIT_STALL_MS = 2 * 90_000;` → `= 90_000;` | `P` | `a learning audit's unsettled bound…`: `expected 90000 to be 180000` |
| T7.63 | revert Step 6 (a) (V's `WRITE` back to `…, this.childReclaimLeaves, CHILD_RECLAIM_COLLECT_NONE)`) | `V` | `(c) the attention list is read only…`: `watch.ts: NOT ALLOWED this.childReclaimAttentionList = childReclaimAttentionWithLeaves(` |
| T7.64 | revert Step 6 (b) (drop `'watch.ts'` from W's `COLLECT_CAP` holders) | `W` | `the builders, the verb, its mode flag and its token…`: `expected [ 'ccdargv.ts', 'coord/collectTempRoot.ts', 'watch.ts' ] to deeply equal [ 'ccdargv.ts', 'coord/collectTempRoot.ts' ]` |
| T7.65 | `collectFoldJob`, `case 'held':` delete the `this.collectState.set(id, collectAfterHold(e, s.hold.why, at));` line (H13: the `held` fold) | `S` | `an open-run hold composes nothing…`: `the hold cleared the pair: expected { …(2) } to be null` |
| T7.66 | `collectLane.ts`'s `collectNextAskMono`: delete `if (e.held !== null) waits.push(e.held.atMono + CHILD_RECLAIM_DEFER_CEILING_MS);` | `S` | `an open-run hold composes nothing…`: `the held id waited the ceiling: expected <n> to be greater than or equal to 900000` |
| T7.67 | `collectSettled`: delete `this.collectPassAudits = t.audits;` (H13: the pass-scoped lines' publication) | `P` | `a pass whose audits all print nothing…`: `the pass’s tally reached the frame: expected [] to include 'no-document'` |
| T7.68 | `collectRunCcd`: `try { return await this.deps.runCcd(argv); } finally { this.collectPhase(id, 'queued'); }` → `return await this.deps.runCcd(argv);` (H13: the phase reset) | `S` | `a job whose own audit answered…`: `back to queued once its audit answered: expected 'audit' to be 'queued'` |

After each mutation, revert it. Then re-run Step 7's first three commands green.

- [ ] **Step 9: Commit**

```bash
git add server/src/watch.ts server/src/collectLane.ts server/test/child-reclaim-verdict-readers.test.ts \
  server/test/ws-collect-wiring.test.ts server/test/collectLaneFixture.ts server/test/collect-lane-bounds.test.ts \
  server/test/collect-lane-pass.test.ts server/test/collect-lane-slot.test.ts
git commit -m "$(cat <<'MSG'
feat(collect): the temp-root collector's lane, shadowed: one gather, one slot, two observations

The watcher gains its fourth sibling lane (spec §5.10). Each pass, under
both capabilities and the cleanup switch, reads the two listings and its
own registry listing in one gather, forgets an id only when both listings
were measured, and offers at most one act job, first, to the earliest
ripe id, then at most two learning audits by next-ask instant and then
id, never to an id holding an observation. The pass never awaits a call
it queued. Every call rides the id's queue key, and no unsettled call is
queued again. An answer is an observation only under the generations the
executor captured when it composed the call. The act slot is fleet-wide:
freed by any job that composed nothing and by a document or a recognised
die; kept with its id for the stall bound after an act that may have
acted; never freed by time while a job stands. A call or job unsettled
past its bound is listed. No act job is offered inside the stall bound of
the lane's start, flock-unavailable latches, and the live flag starts
shadowed, so a standing marker is a flip. The collector's items join the
attention list at its one write, and its feed rows are written here.
watch.ts joins the collector capability's holders.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: The guard pins — the live switch, the id predicate's collector readers, the capability gates, the token's provenance, `~/.cc-tmp`, the readers, the runner budget, the defer-whys floor and the census title

**Model routing:** **`opus`, effort `xhigh`**. Most of these pins fence what `ws-collect` is licensed against: the token that reaches the argv, the capability asked in the act's own scope, the switch nothing may write, and the predicate that keeps a redirect id out of every argv. The SAFETY lens reads this diff against R82, R83, R85 and R86.

**Why:**
- **R82.** `$REG/collect-lane-live` is hand-touched. Its constant is defined once, in the lane's L1 file, which has no `node:` import. Its holders are exactly that definer and the executor, and neither matches single-definition's WRITE pattern. "A new describe in `single-definition.test.ts` pins this the way `:4747-4772` pins `expire-lane-live`."
- **R83.** ONE exported L0 predicate decides a temp-root id, and single-definition holds its one definer (Task 1's wave-9 describe). This task adds only that the collector's lane and executor import and call it (H10). The lane never reads `~/.cc-tmp`: "A scan pins that no lane file passes a path spelling `.cc-tmp` to an `io` member or builds one with a path join."
- **R84.** "A scan pins that the collect readers neither import nor call `parseChildReclaimResult` or `parseChildReclaimAuditFailed`."
- **R85.** A string brand does not keep a `CollectToken` out of `wsReclaim` or `wsExpire`. So "a scan pins that the first argument at the one `CCD_ARGV.wsCollect(` site is the identifier bound from observation 2's parsed document in the same function, and that no `wsReclaim(` or `wsExpire(` site names a collector type or variable." Step 6 also asks `capSupported(COLLECT_CAP)` again "in the act's own scope", with no await before the argv. H6 fixes that scan to Task 6's shape: the first argument is `<x>.token`, `<x>` bound once in `collectTempRoot` as `const <x> = <a>.value;`, and `<a>` bound there, before the site, from the job's one `await collectAudit(deps, job.id)` (directly or through one `const <a>: … = <asked>;` alias).
- **R86.** `CAP_GATED_VERBS` and `NEW_GENERATION` both gain `ws-collect`: Task 6 added it to `CAP_GATED_VERBS` in the commit that composes the act (H5), and this task adds it to `NEW_GENERATION`. A new scan pins that the one `wsCollectAudit(` scope (Task 6's `collectAudit`) holds `capSupported(` with `COLLECT_CAP`; that scope also needs `verbSupported(`, as verb-gate already requires for `ws-audit`. `ws-collect-wiring.test.ts`'s INERT `it` already names the lane's files in its builder and `COLLECT_CAP` holder lists (Tasks 6 and 7, H5); this task retitles it ONE LANE and rewrites its header, comment and messages, and the `'ws-collect'` and `'--collect'` literal lists stay byte for byte.
- **R87.** A new scan pins one definer of the pace formula, and that the collector imports it. That scan is Task 4's, in `collect-pacing.test.ts` alone (H10); this task adds no copy. The runner budget stays: "A test reads both sides from source and pins `30 + 10 + 30 + grace < 90`."
- **R90.** `defer-whys-loop-has-no-floor`: a `toContain('generation-changed')` floor and a length floor, in the sweep-policy suite. `leaf-kept-census-title-overclaims`: the title says what the census checks.
- **R89.** No skill text names the verb, and the CLAUDE.md SAFETY bullet is not edited. `ws-collect-prose.test.ts` stays green untouched.

**Readings this task takes (each named by slug in the wave-done, for the coordinator):**
- `ws-collect-cap-entry-is-a-classification` (named in H9; its premise moved with H6). At Task 6's shape the act's function, `collectTempRoot`, composes no `wsCollectAudit(` of its own: the one audit site is `collectAudit`, a separate function, so `collectTempRoot`'s scope holds `capSupported(` and no `verbSupported(`. Task 6's `CAP_GATED_VERBS` entry for `ws-collect` is therefore the act site's gate in verb-gate's scan, and deleting it reds (T8.26, to be measured). The act's second ask is pinned in place by `collect-act-cap-after-last-await-pinned` below. H13 voided this slug: the wave-done does not name it, and T8.26 pins the entry as load-bearing.
- `collect-act-cap-after-last-await-pinned`. This is a textual pin of R85 step 6 in `collect-lane-scans.test.ts`. The act job asks `capSupported(…, COLLECT_CAP)` at least twice, and the last ask stands after the job's last `await` and before the statement that composes the argv.
- `cc-tmp-scan-display-only`. R83's "passes a path … to an `io` member" cannot be read textually across lines. The scan therefore pins three things in the pass, the lane and the executor:
  - every `.cc-tmp` spelling is the display form `~/.cc-tmp`, which no `io` call can resolve, because there is no tilde expansion;
  - no line holding one calls an `io` member or a path join;
  - the lane and the executor never read the home directory (`homedir(`, `process.env.HOME`).
- `budget-test-pins-the-read-values`. The budget test also pins the six values it reads (30, 10, 30, 3, 8, 90), so a ccd change to any bound reds it and the sum is argued again.
- `census-title-control-pins-its-width`. The retitled census gains one CONTROL line: a double-quoted list is outside it, as the title now says. Widening `SET` reds that line until the title moves with it.

**Files:**
- Modify: `server/test/single-definition.test.ts`. APPEND (A) and the reduced (B) after Task 1's wave-9 describe (`grep -n "child reclamation wave 9: the temp-root id predicate and its cap are defined once" server/test/single-definition.test.ts`), which Task 1 appended at the file's foot after the last describe at `d0c2b7803` (`docs W3 — GET never fetches …`, `:5590`). Never insert above it, because `session-hook.test.ts`'s citation audit cites this file by line (the reason `:4744-4746` states), and H10 sets the order. The describes:
  - (A) the live switch, modelled on `:4747-4772` (`grep -n "the expiry lane’s live switch has no writer in the tree" server/test/single-definition.test.ts`);
  - (B) the collector's readers of the id predicate: ONE case, that the lane and the executor import and call it. Task 1's describe already pins the predicate's one definer, its forerunners' absence, and the kept-leaf reader's and the store's use (H10).

  No pace-formula describe: that scan is Task 4's `collect-pacing.test.ts` alone (H10).
- Modify: `server/test/verb-gate.test.ts`. Edits, located by content:
  - `CAP_GATED_VERBS` (`:104-106`; `grep -n "^const CAP_GATED_VERBS" server/test/verb-gate.test.ts`) keeps Task 6's `'ws-collect'` entry as Task 6 wrote it (H5); its docstring above gains one paragraph.
  - `interface Site` (`:197`) gains `body: string`.
  - The two `sites.push(` calls (`:244`, `:255-259`) carry it.
  - `NEW_GENERATION` (`:408-409`) gains `'ws-collect'`, and its comment above gains one sentence.
  - One describe is appended at the file's foot.
- Modify: `server/test/ws-collect-wiring.test.ts`:
  - the header comment (`:1-6`);
  - the INERT describe (`:44-67`; `grep -n "describe('INERT" server/test/ws-collect-wiring.test.ts`), rewritten as ONE LANE: its title, comment and messages. Its holder lists are already Tasks 6 and 7's (H5), so the file is green at entry and stays green.

  `:25-26` and `:39` are untouched; the file's one cast is at its `TOKEN` declaration (H1).
- Modify: `server/test/child-reclaim-sweep-policy.test.ts`. The case `a defer that is not presence starts the ANY-kind clock` (`:547-557`; `grep -n "for (const why of CHILD_RECLAIM_DEFER_WHYS" server/test/child-reclaim-sweep-policy.test.ts`) gains the floor. Nothing else changes.
- Modify: `server/test/child-reclaim-attention-arms.test.ts`. The census case title (`:40`; `grep -n "no other file spells the three words as a set" server/test/child-reclaim-attention-arms.test.ts`) and one CONTROL line.
- Test (new): `server/test/collect-lane-scans.test.ts`. The token's provenance, the act's last capability check, no other destructive builder handed a collector value, `~/.cc-tmp`, and the readers.
- Test (new): `server/test/collect-audit-budget.test.ts`. The runner-budget inequality, read from `ccd/ccd` and `server/src/remote/runner.ts`.
- Run, never edit: `server/test/ws-collect-prose.test.ts`, `server/test/typecheck-tests.test.ts`.
- NOT edited: `shared/api.ts`, `server/src/**` (Task 6 rewrote `ccdargv.ts`'s two docstrings, H5), `ccd/`, `agent/`, `pwa/`, `CLAUDE.md`, and the skill corpora. `child-reclaim-verdict-readers.test.ts`'s census (c) is Task 7's (R88), never this task's.

**Interfaces:**
- Produces (`server/test/verb-gate.test.ts`, test-local):
  ```ts
  interface Site { file: string; line: number; key: string; verb: string; gated: boolean; scope: string | null; body: string }
  // body: the enclosing scope's text with comments and string bodies blanked (blankCommentsAndStrings); '' when scope is null
  ```
- Produces (`server/test/collect-lane-scans.test.ts`, test-local, not exported):
  ```ts
  function enclosingFunction(text: string, at: number): { readonly name: string; readonly start: number; readonly body: string } | null;
  function firstArg(text: string, open: number): string;
  ```
- Produces (`server/test/collect-audit-budget.test.ts`, test-local):
  ```ts
  function collectAuditBudgetIn(ccd: string, runner: string): {
    readonly idleS: number; readonly usersS: number; readonly scanS: number;
    readonly graceS: number; readonly graceMaxS: number; readonly rowS: number;
  };
  ```
- Consumes (Tasks 1–7, by the fixed names):
  - `shared/api.ts` foot (Task 1): `export const TMPROOT_ID_MAX_CHARS = 255;`, `export function isTmpRootId(id: unknown): id is string` (a function declaration, as Task 1 writes it), `export type CollectToken = string & { readonly [collectTokenBrand]: true }`.
  - `server/src/ccdargv.ts` (Task 1): `wsCollect: (token: CollectToken, id: string, dec: ActorFlags | null) => …`, `wsCollectAudit: (id: string) => …`, `export const COLLECT_CAP = 'collect-v1'`.
  - `server/src/collectLane.ts` (Tasks 2–5; the live marker is Task 2's, H3): `export const COLLECT_LANE_LIVE_MARKER = 'collect-lane-live';`, `export function parseCollectAudit(sessionId: string, ok: boolean, stdout: string, stderr: string): CollectAudit`, `export function parseCollectResult(sessionId: string, ok: boolean, stdout: string, stderr: string): CollectResult`, and an `import { … childReclaimBackoffMs, childReclaimTierPaceMs, childReclaimTierFrom … } from './childReclaimSweep.js'`. The file imports only `'../../shared/api.js'` and `'./childReclaimSweep.js'`.
  - `server/src/childReclaimSweep.ts` (Task 4): `export function childReclaimTierFrom(token: string | null, run: number, stuck: boolean): ChildReclaimTierState` (the export keyword only). This file and the collector both call `isTmpRootId(` (Task 1 replaced `leafIdOk`).
  - `server/src/coord/store.ts` (Task 1): `TMPROOT_ID_MAX_CHARS` imported in place of `CHILD_RECLAIM_MAX_SESSION_ID_CHARS`.
  - `server/src/coord/collectTempRoot.ts` (Task 6). The SHAPE these scans read (H6):
    - the private `collectAudit(deps, id)` holds the ONE `CCD_ARGV.wsCollectAudit(`, with `capSupported(deps.fleetState, COLLECT_CAP)` and `verbSupported(deps.fleetState, argv)` in its own body; `learnCollect(deps, id)` and `collectTempRoot` both call it.
    - `collectTempRoot(deps, job)` holds, in its own body and in this order: `capSupported(…, COLLECT_CAP)` (step 1); `const asked = await collectAudit(deps, job.id);` and its one alias `const audit: CollectAnswer<CollectAudit> = asked;`; ONE `const obs2 = audit.value;` (observation 2); step 5's last await, `await collectSwitches(`; `capSupported(…, COLLECT_CAP)` again (step 6); and the one `CCD_ARGV.wsCollect(obs2.token, job.id, …)`.
    - `collectSwitches` reads `names.includes(COLLECT_LANE_LIVE_MARKER)`.
  - `server/src/watch.ts` (Task 7): `sweepTempRootCollect` gates its pass on `capSupported(this.deps.fleetState, COLLECT_CAP) && capSupported(this.deps.fleetState, RECLAIM_PAUSE_CAP)`. It never calls `parseCollectAudit`, `parseCollectResult` or a `CCD_ARGV.wsCollect*` builder, and never names `COLLECT_LANE_LIVE_MARKER`.
  - Existing at `d0c2b7803`:
    - `holdersOf`, `stallCode`, `ALL`, `rel`, `ccrcRoot` (single-definition.test.ts `:1331`, `:4096`, `:63-64`, `:32`);
    - `scanCcdCallSites`, `ALL_SITES`, `show` (verb-gate.test.ts `:199-262`, `:271`, `:274`);
    - `codeOnly` (`server/test/sourceScan.ts:28`);
    - `CHILD_RECLAIM_DEFER_WHYS` (`server/src/coord/childReclaim.ts:272`);
    - `CHILD_RECLAIM_PRESENCE_DEFERS` (`server/src/childReclaimSweep.ts:38`).

- [ ] **Step 0: Entry conditions (Tasks 1–7 are committed; measure, never assume)**

```bash
grep -n "export const COLLECT_LANE_LIVE_MARKER = 'collect-lane-live'" server/src/collectLane.ts      # (a) one line
grep -n 'TMPROOT_ID_MAX_CHARS\|isTmpRootId\|CollectToken' shared/api.ts | head                         # (b) the foot declarations
grep -rn 'leafIdOk\|CHILD_RECLAIM_MAX_SESSION_ID_CHARS' server/src shared | grep -v '^\S*:\s*\*' || echo "forerunners gone"   # (c)
grep -n '^export function childReclaimTierFrom' server/src/childReclaimSweep.ts                        # (d) Task 4's export
grep -n "from './childReclaimSweep.js'" server/src/collectLane.ts                                      # (e) the formula import
grep -n 'CCD_ARGV.wsCollect(\|CCD_ARGV.wsCollectAudit(\|await collectAudit(deps, job.id)\|const obs2 = audit.value\|COLLECT_CAP)' server/src/coord/collectTempRoot.ts   # (f) the executor's shape (H6)
grep -n 'COLLECT_CAP' server/src/watch.ts                                                               # (g) the pass's gate
grep -n 'Composed by NOTHING in this build\|Nothing reads it in' server/src/ccdargv.ts                  # (h) NOTHING: Task 6 rewrote both (H5)
grep -n "'ws-expire', 'ws-collect'" server/test/verb-gate.test.ts                                     # (i) one line: Task 6's CAP_GATED_VERBS entry (H5)
(cd server && ./node_modules/.bin/vitest run test/ws-collect-wiring.test.ts test/verb-gate.test.ts)    # (j) GREEN: Tasks 6 and 7 left both files green (H5)
```

- (f) shows H6's shape: one `CCD_ARGV.wsCollect(` inside `collectTempRoot`, after `await collectAudit(deps, job.id)` and `const obs2 = audit.value` in the same function, and one `CCD_ARGV.wsCollectAudit(`, in `collectAudit`. Step 2's provenance case reads exactly that shape (H6) and is never bent to fit another; a different shape reds it in Step 7, which STOPs and reports the measured lines.
- If (g) prints nothing, the wiring list in Step 7 loses `'watch.ts'`. Report `pass-cap-gate-not-in-watch`, and write the list as measured only on the coordinator's word.
- If (h) prints a line, or (i) prints none, Task 6's commit did not make the edits H5 gives it: **STOP** and report the measured lines. This task edits neither `ccdargv.ts` nor the `CAP_GATED_VERBS` literal.

- [ ] **Step 1: Write the two single-definition describes**, appended at the foot of `server/test/single-definition.test.ts`, below the last `});`, which is Task 1's wave-9 describe's (H10):

```ts
// CHILD RECLAMATION WAVE 9 (spec 2026-09-22 §5.10). APPENDED, for the reason the blocks above state: `session-hook.test.ts`'s
// citation audit cites this file by line. The temp-root collector's lane SHIPS SHADOWED: until `$REG/collect-lane-live`
// exists it audits and records "would collect" and never composes `ws-collect`. The file is the operator's to touch BY
// HAND on the fleet box, as `expire-lane-live` is, so no line of shell names it. Its one TS spelling is its definer, an
// L1 file that reaches no `node:` module and so cannot write it.
describe('child reclamation wave 9: the collector lane’s live switch has no writer in the tree', () => {
  const NAME = 'collect-lane-live';
  const DEFINER = 'server/src/collectLane.ts';

  it('no shell line names it, and its one TS holder is its definer', () => {
    expect(holdersOf(NAME), 'a line of shell names it — a writer, or a reader this design never had').toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(NAME)).map(rel).sort(), `spelled on a code line outside ${DEFINER}`)
      .toEqual([DEFINER]);
    expect(stallCode(path.join(ccrcRoot, DEFINER)), `${DEFINER} reaches a node: module or require — it could write the marker`)
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });

  // THE WIDER WRITER, the expiry pin's argument: a file that imports the ONE spelling and holds an `io` could write it
  // without spelling its name. The files whose code names the constant are the definer and the executor, which reads
  // it from the registry listing alone, and neither reaches a write. The lane's feed and attention writes live in
  // watch.ts, which never names the constant.
  it('the files that name its constant are the definer and the executor, and neither reaches a write', () => {
    const WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;
    expect(WRITE.test('await deps.io.writeFile(`${dir}/${m}`, "");'), 'CONTROL: the pattern sees a write').toBe(true);
    const holders = ALL.filter((f) => stallCode(f).includes('COLLECT_LANE_LIVE_MARKER')).map(rel).sort();
    expect(holders).toEqual([DEFINER, 'server/src/coord/collectTempRoot.ts']);
    for (const f of holders) expect(stallCode(path.join(ccrcRoot, f)), `${f} reaches a write`).not.toMatch(WRITE);
  });
});

// CHILD RECLAMATION WAVE 9 (spec 2026-09-22 §5.10, "The population"). Task 1's wave-9 describe ("the temp-root id
// predicate and its cap are defined once, in shared/api.ts") holds the predicate's one L0 definer, its forerunners'
// absence, and the kept-leaf reader's and the store's use. This block adds the collector's two files: the lane and the
// executor each import the L0 predicate and CALL it, so the population and the job's step 1 cannot drift to a private
// copy under a new name, which a scan of declarations would not see. KNOWN WIDTH: a call kept beside a private copy
// still passes here.
describe('child reclamation wave 9: the collector’s lane and executor call the temp-root id predicate from L0', () => {
  it('its readers import it: the lane and the executor import isTmpRootId from shared/api.js and call it', () => {
    const code = (r: string): string => stallCode(path.join(ccrcRoot, r));
    for (const r of ['server/src/collectLane.ts', 'server/src/coord/collectTempRoot.ts']) {
      expect(code(r), r).toMatch(/\bisTmpRootId\s*\(/);
      expect(code(r), `${r} does not import it from L0`)
        .toMatch(/import\s*(?:type\s*)?\{[^}]*\bisTmpRootId\b[^}]*\}\s*from\s*'(?:\.\.\/)+shared\/api\.js'/);
    }
  });
});
```

- [ ] **Step 2: Write `server/test/collect-lane-scans.test.ts`**

```ts
// Child reclamation wave 9: the temp-root collector's lane, read as TEXT (spec 2026-09-22 §5.10). These are the
// fences a type cannot draw:
//   - the collect token reaches `ws-collect` only from the act job's own audit document, and the act asks its
//     capability again after the job's last await;
//   - no `ws-reclaim` or `ws-expire` site is handed a collector value (a `CollectToken` is a `string`, so tsc lets one
//     through: this is the half the brand cannot hold);
//   - the lane never reads `~/.cc-tmp`;
//   - the collect readers never borrow reclaim's.
// KNOWN WIDTH, stated: an alias (`const A = CCD_ARGV`), a table lookup, a value routed through a helper in another
// file, and a shadowing destructure are not seen. The bar is the ordinary composer, as it is in `verb-gate.test.ts`.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './sourceScan.js';

const ccrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (p: string): string => path.relative(ccrcRoot, p).split(path.sep).join('/');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
  if (e.startsWith('__')) return [];   // a parallel suite's transient mutant (single-definition.test.ts's reason)
  const p = path.join(dir, e);
  return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
});
const SERVER = walk(path.join(ccrcRoot, 'server', 'src'));
const codeAt = (r: string): string => codeOnly(readFileSync(path.join(ccrcRoot, r), 'utf8'));
const LANE = 'server/src/collectLane.ts';
const EXECUTOR = 'server/src/coord/collectTempRoot.ts';

interface Fn { readonly name: string; readonly start: number; readonly body: string }
/** The top-level function around `at`: from its head line (`function name(` or `const name = (`, at column 0, with
 *  `export` and `async` allowed) to the first later line that opens with `}` at column 0. This tree writes every
 *  top-level function that way. A head this cannot find answers null, and every case below reads null as a red. */
function enclosingFunction(text: string, at: number): Fn | null {
  const HEAD = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/gm;
  let head: RegExpMatchArray | null = null;
  for (const m of text.matchAll(HEAD)) {
    if (m.index! > at) break;
    head = m;
  }
  if (head === null) return null;
  const close = /^\}/gm;
  close.lastIndex = head.index!;
  const end = close.exec(text);
  if (end === null || end.index < at) return null;
  return { name: head[1] ?? head[2]!, start: head.index!, body: text.slice(head.index!, end.index + 1) };
}

/** The first argument of the call whose `(` ends just before `open`: the text up to its first comma at depth 0. */
function firstArg(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i]!;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return text.slice(open, i).trim(); depth--; }
    else if (c === ',' && depth === 0) return text.slice(open, i).trim();
  }
  return text.slice(open).trim();
}

interface CallSite { readonly file: string; readonly text: string; readonly at: number; readonly open: number }
const sitesOf = (key: string): CallSite[] => SERVER.flatMap((f) => {
  const text = codeOnly(readFileSync(f, 'utf8'));
  return [...text.matchAll(new RegExp(`\\bCCD_ARGV\\s*\\.\\s*${key}\\s*\\(`, 'g'))]
    .map((m) => ({ file: rel(f), text, at: m.index!, open: m.index! + m[0].length }));
});
const collectGate = (): RegExp => /capSupported\s*\(\s*[\w.]+\s*,\s*COLLECT_CAP\s*\)/g;
/** The identifier whose `.token` the one ws-collect site spends, or null. */
const spentObservation = (): string | null => {
  const [c] = sitesOf('wsCollect');
  return c === undefined ? null : /^([A-Za-z_$][\w$]*)\.token$/.exec(firstArg(c.text, c.open))?.[1] ?? null;
};

describe('the collect token reaches ws-collect only from the act job’s own audit (spec §5.10)', () => {
  it('CONTROL: the readers find the function and its first argument, and miss nothing outside a function', () => {
    const planted = [
      'export async function collectTempRoot(deps: D, job: J): Promise<void> {',
      '  const obs1 = deps.lane.observation(job.id);',
      '  await deps.runCcd(CCD_ARGV.wsCollect(obs1.token, job.id, sweepDec(deps.fleetState, `collect ${job.id}`)));',
      '}',
      '',
    ].join('\n');
    const at = planted.indexOf('CCD_ARGV.wsCollect(');
    expect(enclosingFunction(planted, at)?.name).toBe('collectTempRoot');
    expect(firstArg(planted, at + 'CCD_ARGV.wsCollect('.length)).toBe('obs1.token');
    expect(enclosingFunction('const x = 1;\nvoid CCD_ARGV.wsCollect(t, i, d);\n', 18), 'no function, no scope').toBeNull();
  });

  it('there is ONE CCD_ARGV.wsCollect( site in server/src, inside collectTempRoot', () => {
    const sites = sitesOf('wsCollect');
    expect(sites.map((s) => s.file)).toEqual([EXECUTOR]);
    expect(enclosingFunction(sites[0]!.text, sites[0]!.at)?.name).toBe('collectTempRoot');
  });

  it('its first argument is <obs>.token, <obs> bound ONCE as <answer>.value, <answer> the job’s one collectAudit( answer, before the act (H6)', () => {
    const [s] = sitesOf('wsCollect');
    const fn = enclosingFunction(s!.text, s!.at)!;
    const site = s!.at - fn.start;
    const arg = firstArg(s!.text, s!.open);
    const m = /^([A-Za-z_$][\w$]*)\.token$/.exec(arg);
    expect(m, `the first argument is ${JSON.stringify(arg)}, not <identifier>.token`).not.toBeNull();
    const obs = m![1]!;
    const binds = [...fn.body.matchAll(new RegExp(`\\bconst\\s+${obs}\\s*(?::[^=;]+)?=\\s*([A-Za-z_$][\\w$]*)\\.value\\s*;`, 'g'))];
    expect(binds.length, `${obs} is bound as <answer>.value exactly once in ${fn.name}`).toBe(1);
    expect([...fn.body.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${obs}\\b`, 'g'))].length, `${obs} is declared more than once`).toBe(1);
    const bindAt = binds[0]!.index! + binds[0]![0].search(new RegExp(`\\b${obs}\\b`));
    expect(new RegExp(`(?<![\\w$.])${obs}\\b`).exec(fn.body)!.index, `${obs} is named before its binding: a parameter, or an earlier value`).toBe(bindAt);
    // <answer> is the binding of the job's ONE audit call, or ONE alias of it, both in this function and before <obs>.
    const asks = [...fn.body.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*await\s+collectAudit\s*\(\s*deps\s*,\s*job\.id\s*\)\s*;/g)];
    expect(asks.length, `${fn.name} binds its own audit, await collectAudit(deps, job.id), exactly once`).toBe(1);
    expect(fn.body.match(/\bcollectAudit\s*\(/g)?.length ?? 0, `${fn.name} calls collectAudit( more than once`).toBe(1);
    const asked = asks[0]![1]!;
    const answer = binds[0]![1]!;
    const via = answer === asked ? asks[0]! : new RegExp(`\\bconst\\s+${answer}\\s*(?::[^=;]+)?=\\s*${asked}\\s*;`).exec(fn.body);
    expect(via, `${answer} is neither ${asked}, the audit call's binding, nor one alias of it`).not.toBeNull();
    expect([...fn.body.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${answer}\\b`, 'g'))].length, `${answer} is declared more than once`).toBe(1);
    expect(asks[0]!.index!, 'the alias names an answer the function had not yet asked for').toBeLessThanOrEqual(via!.index!);
    expect(via!.index!, `${obs} reads an answer bound after it`).toBeLessThan(binds[0]!.index!);
    expect(binds[0]!.index!, 'the act composed before its observation').toBeLessThan(site);
  });

  it('the act asks COLLECT_CAP again after the job’s last await, before the statement that composes the argv', () => {
    const [s] = sitesOf('wsCollect');
    const fn = enclosingFunction(s!.text, s!.at)!;
    const site = s!.at - fn.start;
    const stmt = Math.max(fn.body.lastIndexOf(';', site), fn.body.lastIndexOf('{', site), fn.body.lastIndexOf('}', site));
    const gates = [...fn.body.slice(0, stmt).matchAll(collectGate())];
    expect(gates.length, 'asked at the job’s start and again before the act').toBeGreaterThanOrEqual(2);
    expect(fn.body.slice(gates.at(-1)!.index!, stmt), 'an await stands between the last capability check and the argv')
      .not.toMatch(/\bawait\b/);
  });
});

describe('no other destructive builder is handed a collector value (spec §5.10)', () => {
  const COLLECTOR = /\b(?:Collect(?:Token|Audit|Result|Entry|Listing|Population)|parseCollect(?:Audit|Result)|collectTempRoot|learnCollect|collectOpenRunHold)\b/;
  const LANE_IMPORT = /\bfrom\s*['"][^'"]*\/(?:collectLane|collectTempRoot)\.js['"]/;

  it('CONTROL: a collector type in a signature and a lane import are seen; a plain string is not', () => {
    expect(COLLECTOR.test('async function childReclaimAct(deps: D, req: R, token: CollectToken) {')).toBe(true);
    expect(COLLECTOR.test('async function childReclaimAct(deps: D, req: R, token: string) {')).toBe(false);
    expect(LANE_IMPORT.test("import { learnCollect } from './collectTempRoot.js';")).toBe(true);
  });

  it('each ws-reclaim and ws-expire site lies in a file that imports no lane module, in a function that names no collector type, reader or the act’s observation', () => {
    const obs = spentObservation();
    const sites = [...sitesOf('wsReclaim'), ...sitesOf('wsExpire')];
    expect(sites.map((s) => s.file).sort()).toEqual(['server/src/coord/childReclaim.ts', 'server/src/coord/expireArchived.ts']);
    for (const s of sites) {
      expect(LANE_IMPORT.test(s.text), `${s.file} imports a collector module`).toBe(false);
      const fn = enclosingFunction(s.text, s.at);
      expect(fn, `${s.file}: the site's function was not found`).not.toBeNull();
      expect(fn!.body.match(COLLECTOR)?.[0] ?? null, `${s.file} ${fn!.name}`).toBeNull();
      if (obs !== null) {
        expect(new RegExp(`(?<![\\w$.])${obs}\\b`).test(firstArg(s.text, s.open)), `${s.file} spends ${obs}`).toBe(false);
      }
    }
  });
});

describe('the lane never reads ~/.cc-tmp (spec §5.10)', () => {
  const FILES = [LANE, EXECUTOR, 'server/src/watch.ts'];
  const IO_OR_JOIN = /\bio\s*\.\s*\w+\s*\(|\.\s*(?:join|resolve)\s*\(/;
  /** Every `cc-tmp` spelling that is NOT the display form `~/.cc-tmp`, with a little context. */
  const loose = (code: string): string[] => [...code.matchAll(/cc-tmp/g)]
    .filter((m) => code.slice(m.index! - 3, m.index!) !== '~/.')
    .map((m) => code.slice(Math.max(0, m.index! - 30), m.index! + 10));
  const ioLines = (code: string): string[] => code.split('\n').filter((l) => l.includes('cc-tmp') && IO_OR_JOIN.test(l));

  it('CONTROL: a built path and an io read are seen; a display sentence is not', () => {
    expect(loose('const p = `${registryDir}/../.cc-tmp`;')).toHaveLength(1);
    expect(loose("const p = path.join(home, '.cc-tmp', id);")).toHaveLength(1);
    expect(loose("const s = 'its temp root ~/.cc-tmp/' + id;")).toEqual([]);
    expect(ioLines("await io.readdir('~/.cc-tmp');")).toHaveLength(1);
    expect(ioLines('const s = `the leaf under ~/.cc-tmp`;')).toEqual([]);
  });

  it('the pass, the lane and the executor spell .cc-tmp only as the display form, never beside an io call or a path join', () => {
    for (const f of FILES) {
      const code = codeAt(f);
      expect(loose(code), `${f}: a path spelling of .cc-tmp`).toEqual([]);
      expect(ioLines(code), `${f}: .cc-tmp beside an io call or a join`).toEqual([]);
    }
  });

  it('the lane and the executor never read the home directory, the only root a ~/.cc-tmp path is built from', () => {
    for (const f of [LANE, EXECUTOR]) {
      expect(codeAt(f), f).not.toMatch(/\bhomedir\s*\(|\bprocess\s*\.\s*env\s*(?:\.\s*HOME\b|\[\s*['"]HOME['"]\s*\])/);
    }
  });
});

describe('the collect readers never borrow reclaim’s (spec §5.10)', () => {
  const RECLAIM_READERS = /\b(?:parseChildReclaimResult|parseChildReclaimAuditFailed|parseChildReclaimAudit|childReclaimFailedResume|isChildReclaimPreCrumbFailed|childReclaimFailedTail)\b/;

  it('CONTROL: a reclaim reader is seen, a collect reader is not', () => {
    expect(RECLAIM_READERS.test("import { parseChildReclaimAuditFailed } from './coord/childReclaim.js';")).toBe(true);
    expect(RECLAIM_READERS.test('const r = parseCollectResult(id, res.ok, res.stdout, res.stderr);')).toBe(false);
  });

  it('neither the lane nor the executor imports or calls a reclaim reader, and the L1 file imports nothing from coord/', () => {
    for (const f of [LANE, EXECUTOR]) expect(codeAt(f).match(RECLAIM_READERS)?.[0] ?? null, f).toBeNull();
    expect(codeAt(LANE)).not.toMatch(/\bfrom\s*['"]\.\/coord\//);
  });

  it('the two collect readers are defined in the lane’s L1 file alone, and only the lane and the executor name a call of them', () => {
    for (const name of ['parseCollectAudit', 'parseCollectResult']) {
      const DEF = new RegExp(`^\\s*(?:export\\s+)?(?:function\\s+${name}\\b|const\\s+${name}\\s*=)`, 'm');
      expect(SERVER.filter((f) => DEF.test(codeOnly(readFileSync(f, 'utf8')))).map(rel), name).toEqual([LANE]);
      expect(SERVER.filter((f) => new RegExp(`\\b${name}\\s*\\(`).test(codeOnly(readFileSync(f, 'utf8')))).map(rel).sort(), name)
        .toEqual([LANE, EXECUTOR]);
    }
  });
});
```

- [ ] **Step 3: Write `server/test/collect-audit-budget.test.ts`**

```ts
// Child reclamation wave 9 (spec 2026-09-22 §5.10, "The idle floor"): `ws-audit --collect` keeps `ws-audit`'s runner
// row. Its three bounded probes run in sequence (the idle walk, the in-use probe and the checkout scan), and a probe
// that reaches its bound ends the audit, so ONE TERM-to-KILL grace is paid. That sum must stay under the row, at the
// default grace and at the widest. The halves live in two languages and neither can import the other's number, so each
// is read from source as TEXT, and each read asserts it matched exactly once (`docs-budget.test.ts`'s method). Stated
// residual: the registry row pass carries no bound of its own and is not in the sum. A runner kill there answers no
// document, which the lane reads as `no-document` and paces as a failure, so it fails closed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readRel = (r: string): string => readFileSync(path.join(ROOT, r), 'utf8');

/** The one match of `re` (a `g` regex) in `text`; throws on zero or on more than one. */
function exactlyOne(text: string, re: RegExp, what: string): RegExpMatchArray {
  const hits = [...text.matchAll(re)];
  if (hits.length !== 1) throw new Error(`${what}: ${hits.length} matches; the contract is one`);
  return hits[0]!;
}

interface CollectAuditBudget {
  readonly idleS: number; readonly usersS: number; readonly scanS: number;
  readonly graceS: number; readonly graceMaxS: number; readonly rowS: number;
}

function collectAuditBudgetIn(ccd: string, runner: string): CollectAuditBudget {
  const int = (re: RegExp, what: string): number => Number(exactlyOne(ccd, re, what)[1]!);
  const row = exactlyOne(runner, /^[ \t]*'ws-audit':[ \t]*([\d_]+),/gm, "CCD_VERB_TIMEOUT_MS['ws-audit']");
  return {
    idleS: int(/^WS_COLLECT_IDLE_SCAN_S=(\d+)\b/gm, 'WS_COLLECT_IDLE_SCAN_S'),
    usersS: int(/^WS_PATH_USERS_SCAN_S=(\d+)\b/gm, 'WS_PATH_USERS_SCAN_S'),
    scanS: int(/^REAP_SCAN_SECONDS=(\d+)\b/gm, 'REAP_SCAN_SECONDS'),
    graceS: int(/grace="\$\{CCD_TIMEOUT_KILL_AFTER:-(\d+)\}"/g, "_plat_timeout's default grace"),
    graceMaxS: int(/\[ "\$grace" -gt (\d+) \] && grace=\1\b/g, "_plat_timeout's grace ceiling"),
    rowS: Number(row[1]!.replace(/_/g, '')) / 1000,
  };
}

const ccdSrc = (): string => readRel('ccd/ccd');
const runnerSrc = (): string => readRel('server/src/remote/runner.ts');
const probesS = (b: CollectAuditBudget): number => b.idleS + b.usersS + b.scanS;

describe('the collect audit fits ws-audit’s runner row (spec §5.10)', () => {
  it('reads 30 + 10 + 30 s of probes and a 3 s grace capped at 8, against a 90 s row', () => {
    expect(collectAuditBudgetIn(ccdSrc(), runnerSrc())).toEqual({ idleS: 30, usersS: 10, scanS: 30, graceS: 3, graceMaxS: 8, rowS: 90 });
  });

  it('the probes and ONE grace sum under the row: 73 s at the default grace, 78 s at the widest', () => {
    const b = collectAuditBudgetIn(ccdSrc(), runnerSrc());
    expect(probesS(b) + b.graceS).toBeLessThan(b.rowS);
    expect(probesS(b) + b.graceMaxS).toBeLessThan(b.rowS);
  });
});

describe('CONTROL: the reads refuse zero and two, and a longer probe breaks the sum', () => {
  it('a renamed or doubled binding throws', () => {
    const ccd = ccdSrc(); const runner = runnerSrc();
    expect(() => collectAuditBudgetIn(ccd.replace(/^WS_COLLECT_IDLE_SCAN_S=/m, 'WS_COLLECT_IDLE_S='), runner)).toThrow(/WS_COLLECT_IDLE_SCAN_S: 0 matches/);
    expect(() => collectAuditBudgetIn(`${ccd}\nREAP_SCAN_SECONDS=30\n`, runner)).toThrow(/REAP_SCAN_SECONDS: 2 matches/);
    expect(() => collectAuditBudgetIn(ccd, runner.replace("'ws-audit': 90_000,", '// gone'))).toThrow(/ws-audit'\]: 0 matches/);
  });

  it('a 50 s idle walk would not fit', () => {
    const b = collectAuditBudgetIn(ccdSrc().replace(/^WS_COLLECT_IDLE_SCAN_S=30\b/m, 'WS_COLLECT_IDLE_SCAN_S=50'), runnerSrc());
    expect(probesS(b) + b.graceS).toBeGreaterThanOrEqual(b.rowS);
  });
});
```

- [ ] **Step 4: Rewrite `ws-collect-wiring.test.ts`'s header and its INERT describe** (`grep -n "describe('INERT" server/test/ws-collect-wiring.test.ts`). It is GREEN at entry (H5, Step 0 (j)): Tasks 6 and 7 already put the lane's files in the builder and `COLLECT_CAP` holder lists. This step changes the header, the describe's title and comment, and the messages, and leaves every list as Tasks 6 and 7 left it. Replace `:1-6` with:

```ts
// The collector's server and agent wiring (child reclamation spec 2026-09-22 §5.10, §8's waves 7 and 9). The agent grants
// `ws-collect` on its confirmation token and nothing else new: `ws-audit --collect` rides the existing
// `['ws-audit','--session']` prefix. `CCD_ARGV` declares the two builders and `COLLECT_CAP`, and wave 9's lane is their ONE
// composer, behind `capSupported(COLLECT_CAP)` (`verb-gate.test.ts`'s `CAP_GATED_VERBS` entry for `ws-collect`). The lane
// ships shadowed behind `$REG/collect-lane-live`. The ONE LANE case below names the lane's files as the only holders, and
// keeps the verb and its mode flag spelled exactly where wave 7 put them.
```

Replace the describe (its title line through its closing `});`) with:

```ts
describe('ONE LANE — the collector’s lane is the only server source that composes the collector', () => {
  /** Whole-line and trailing `// ` comments dropped (whitelist-subset layer 4's cut), so prose naming a builder is
   *  never read as a call. An alias (`const A = CCD_ARGV`) or a table lookup is invisible to this scan, as it is to
   *  `verb-gate.test.ts`'s; it catches the honest composer, not someone routing around it. */
  const code = (src: string): string => src.split('\n').filter((l) => !/^\s*(?:\/\/|\/\*|\*)/.test(l))
    .map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []);
  const files = (): string[] => walk(SRC).map((f) => path.relative(SRC, f).split(path.sep).join('/')).sort();
  const holders = (re: RegExp): string[] =>
    files().filter((f) => re.test(code(fs.readFileSync(path.join(SRC, f), 'utf8'))));

  it('CONTROL: the walk reaches subdirectories and the comment cut keeps code — ws-expire has its one composer', () => {
    expect(files().length, 'the walk read server/src').toBeGreaterThan(50);
    expect(holders(/\bCCD_ARGV\s*\.\s*wsExpire\s*\(/)).toEqual(['coord/expireArchived.ts']);
  });

  it('the builders and the token are named only where declared and by the lane’s files; the verb and its mode flag stand where they were', () => {
    expect(holders(/\bwsCollect(?:Audit)?\b/), 'a reference to either builder: the declaration, and the lane’s executor').toEqual(['ccdargv.ts', 'coord/collectTempRoot.ts']);
    expect(holders(/['"`]ws-collect['"`]/), 'the verb as a literal: the builder, and the budget row').toEqual(['ccdargv.ts', 'remote/runner.ts']);
    expect(holders(/['"`]--collect['"`]/), 'the audit mode flag').toEqual(['ccdargv.ts']);
    expect(holders(/\bCOLLECT_CAP\b|['"`]collect-v1['"`]/), 'the capability token: declared, and asked by the executor and by the pass').toEqual(['ccdargv.ts', 'coord/collectTempRoot.ts', 'watch.ts']);
  });
});
```

The second and third `expect` lines are byte for byte the lines they replace (R86). Check:

```bash
git diff -U0 server/test/ws-collect-wiring.test.ts | grep -c "toEqual(\['ccdargv.ts', 'remote/runner.ts'\])\|'the audit mode flag').toEqual(\['ccdargv.ts'\])"   # 0: neither line is in the diff
```

- [ ] **Step 5: `verb-gate.test.ts`**
  - (a) `CAP_GATED_VERBS`. The set literal is left as Task 6 wrote it, with `'ws-collect'` after `'ws-expire'` (H5; Step 0 (i)). Append to the docstring above it, before its closing ` */`:
    ```ts
     *
     * `ws-collect` (child reclamation wave 9, spec 2026-09-22 §5.10) argues it once more: the collector lane's act job
     * (`coord/collectTempRoot.ts`'s `collectTempRoot`) composes it only behind `capSupported(deps.fleetState, COLLECT_CAP)`,
     * asked at the job's start and again after its last await. The job's own `ws-audit` is composed in `collectAudit`, a
     * separate function, so this scope holds no `verbSupported(` and this entry is the act site's gate here; the second
     * ask's place is pinned in `collect-lane-scans.test.ts`.
    ```
  - (b) `interface Site { …; scope: string | null; body: string }`. The scope-less push gains `body: ''`, and the scoped push gains `body: scopeText,`, the `const scopeText = code.slice(open, end);` already computed above it.
  - (c) `NEW_GENERATION` gains `'ws-collect'` at its end:
    ```ts
    const NEW_GENERATION = ['pr-state', 'pr-open', 'ws-archive', 'ws-restore', 'ws-audit', 'ws-reap', 'project-pool',
      'ws-reclaim', 'docs-index', 'docs-tree', 'docs-show', 'docs-fetch', 'ws-collect'];
    ```
    One comment line is added above it, after the Docs sentence: `// \`ws-collect\` (child reclamation wave 9) joins for the same reason: naming it reds a vanished act site or a lost gate.`
  - (d) Append at the file's foot:
    ```ts
    // Child reclamation wave 9 (spec 2026-09-22 §5.10). The collector's audit is the OLD verb `ws-audit`, so the scan
    // above already requires `verbSupported(` in its scope. The FLAG's question, `collect-v1`, is asked there too, as
    // `learnExpiry` asks `EXPIRE_CAP` before its audit: a box that stopped advertising the token is never audited. The
    // one site is the executor's `collectAudit`, which the learning audit and the act job both call.
    // `ws-audit` itself is never added to CAP_GATED_VERBS.
    describe('every wsCollectAudit( scope asks the collector’s capability too (spec §5.10)', () => {
      const COLLECT_GATE = /capSupported\s*\(\s*[\w.]+\s*,\s*COLLECT_CAP\s*\)/;
      const sites = ALL_SITES.filter((s) => s.key === 'wsCollectAudit');

      it('CONTROL: the gate pattern sees the call, not another token, and not prose', () => {
        expect(COLLECT_GATE.test('if (!capSupported(deps.fleetState, COLLECT_CAP)) return x;')).toBe(true);
        expect(COLLECT_GATE.test('if (!capSupported(deps.fleetState, RECLAIM_PAUSE_CAP)) return x;')).toBe(false);
        const [s] = scanCcdCallSites('export function f(deps: D) {\n  // capSupported(deps.fleetState, COLLECT_CAP)\n'
          + '  return deps.runCcd(CCD_ARGV.wsCollectAudit(id));\n}\n', 'f.ts');
        expect(COLLECT_GATE.test(s!.body), 'a comment is not a gate').toBe(false);
      });

      it('the one site is the executor’s collectAudit, shared by the learning audit and the act job', () => {
        expect([...new Set(sites.map((s) => s.file))]).toEqual(['coord/collectTempRoot.ts']);
        expect(sites.length).toBe(1);
      });

      it('each holds capSupported(…, COLLECT_CAP) and verbSupported( in its own scope', () => {
        expect(sites.filter((s) => !COLLECT_GATE.test(s.body)).map(show)).toEqual([]);
        expect(sites.filter((s) => !/verbSupported\s*\(/.test(s.body)).map(show)).toEqual([]);
      });
    });
    ```

- [ ] **Step 6: The defer-whys floor and the census title**
  - (a) `child-reclaim-sweep-policy.test.ts`, in `it('a defer that is not presence starts the ANY-kind clock, and clears the presence clock'`, replace the `for (const why of CHILD_RECLAIM_DEFER_WHYS.filter(…)) {` line with:
    ```ts
        const whys = CHILD_RECLAIM_DEFER_WHYS.filter((w) => !(CHILD_RECLAIM_PRESENCE_DEFERS as readonly string[]).includes(w));
        // A FLOOR, so the loop below can never pass on an emptied or narrowed list (spec §5.7): the server's own word is
        // in it, and every box and server defer word that is not presence, twelve when this was written.
        expect(whys, 'the derived list lost the server’s own word').toContain('generation-changed');
        expect(whys.length, 'the derived list was narrowed').toBeGreaterThanOrEqual(12);
        for (const why of whys) {
    ```
    Measure the twelve first: `node -e` is not needed. `CHILD_RECLAIM_DEFER_WHY` has 15 keys (`coord/childReclaim.ts:265-270`) and 3 are presence (`childReclaimSweep.ts:38`). Count them at the tip with `grep -o "[a-z-]*': true\|[a-z]*: true" server/src/coord/childReclaim.ts | sed -n '1,15p'`. If the count differs, the floor is the measured count, recorded.
  - (b) `child-reclaim-attention-arms.test.ts`. The title becomes:
    ```ts
      it('is declared once, in shared/api.ts; no other file has one code line naming all three words, each single-quoted or a bare key, nor wave 5’s names', () => {
    ```
    Directly after the two existing `CONTROL` lines, add:
    ```ts
        expect(SET('const W = ["refused", "unmeasured", "in-use"];'), 'CONTROL: double quotes are outside this census, as the title says').toBe(false);
    ```

- [ ] **Step 7: Run the new and changed files**

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/verb-gate.test.ts test/ws-collect-wiring.test.ts test/collect-lane-scans.test.ts test/collect-audit-budget.test.ts test/child-reclaim-sweep-policy.test.ts test/child-reclaim-attention-arms.test.ts test/ws-collect-prose.test.ts
```

Expected: PASS. In particular:
- `ws-collect-prose.test.ts` is green UNCHANGED. Check `grep -rc 'ws-collect' ccd/coordinator-skill ccd/worker-skill ccd/reviewer-skill | grep -v ':0$'`, which prints nothing.
- `git diff $(git merge-base origin/main HEAD) -- CLAUDE.md` shows nothing from this task. The merge base is used so that a CLAUDE.md edit another PR landed on `main` is not read as this branch's.

If a scan reds on code Tasks 1–7 shipped, the scan is never loosened to pass. **STOP** and report by slug (for example `pass-cap-gate-not-in-watch`) with the measured text; a red provenance case is reported with `collectTempRoot`'s measured lines (H6 voids `collect-scan-shape-mismatch`).

- [ ] **Step 8: Mutation table.** Apply each mutation alone, run its command from `server/`, see the red, and revert. Every red text below was drafted, not measured: measure each and record the measured text. A count that differs is not a departure.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| T8.1 | `coord/collectTempRoot.ts`: add `const LIVE = 'collect-lane-live';` at module scope and use it in `collectSwitches` in place of `COLLECT_LANE_LIVE_MARKER` | `./node_modules/.bin/vitest run test/single-definition.test.ts -t 'collector lane'` | "no shell line names it…": `spelled on a code line outside server/src/collectLane.ts: expected [ 'server/src/collectLane.ts', 'server/src/coord/collectTempRoot.ts' ] to deeply equal [ 'server/src/collectLane.ts' ]`; "the files that name its constant…": `expected [ 'server/src/collectLane.ts' ] to deeply equal [ 'server/src/collectLane.ts', 'server/src/coord/collectTempRoot.ts' ]` |
| T8.2 | `collectLane.ts`: add `import { existsSync } from 'node:fs';` under its imports | same | `server/src/collectLane.ts reaches a node: module or require — it could write the marker: expected '…' not to match /from\s+['"]node:|…/` |
| T8.3 | `coord/collectTempRoot.ts` `collectSwitches`: add `await io.writeFile(\`${registryDir}/${COLLECT_LANE_LIVE_MARKER}\`, '');` before its return (vitest does not type-check, so the scan runs) | same | `server/src/coord/collectTempRoot.ts reaches a write: expected '…' not to match /\b(?:writeFile|…/` |
| T8.4 | `watch.ts`: import `COLLECT_LANE_LIVE_MARKER` from `./collectLane.js` and add `void COLLECT_LANE_LIVE_MARKER;` in `sweepTempRootCollect` | same | "the files that name its constant…": `expected [ 'server/src/collectLane.ts', 'server/src/coord/collectTempRoot.ts', 'server/src/watch.ts' ] to deeply equal [ 'server/src/collectLane.ts', 'server/src/coord/collectTempRoot.ts' ]` |
| T8.5 | `collectLane.ts`: add `const tmpRootIdOk = (id: string): boolean => isSessionIdShape(id) && id.length <= 255 && !/^[.-]/.test(id);` (importing `isSessionIdShape` beside it) and call it in place of every `isTmpRootId(` call; the `isTmpRootId` import stays | `./node_modules/.bin/vitest run test/single-definition.test.ts -t 'call the temp-root id predicate from L0'` | "its readers import it…": `server/src/collectLane.ts: expected '…' to match /\bisTmpRootId\s*\(/` |
| T8.6 | `coord/collectTempRoot.ts`: delete step 1's `if (!isTmpRootId(job.id)) return …;` line and `isTmpRootId` from its import | same | "its readers import it…": `server/src/coord/collectTempRoot.ts: expected '…' to match /\bisTmpRootId\s*\(/`; Task 6's own step-1 id case reds too |
| T8.7 | Retired (H10): the declaration-width row belonged to the definer case, which is Task 1's describe's. Nothing to apply | — | — |
| T8.8 | `collectLane.ts`: delete `childReclaimTierPaceMs` from the `./childReclaimSweep.js` import and add `const childReclaimTierPaceMs = (j: number): number => Math.min(4 * 3600_000, 15 * 60_000 * 2 ** Math.max(0, j));` | `./node_modules/.bin/vitest run test/collect-pacing.test.ts -t 'spells no formula of its own'` | Task 4's pin (H10): `childReclaimTierPaceMs: expected '…' to match /\bchildReclaimTierPaceMs\b/` |
| T8.9 | `collectLane.ts`: add `import { CHILD_RECLAIM_DEFER_WHYS } from './coord/childReclaim.js';` and `void CHILD_RECLAIM_DEFER_WHYS;` | `./node_modules/.bin/vitest run test/collect-pacing.test.ts -t 'imports the derivation'`, and `./node_modules/.bin/vitest run test/collect-lane-scans.test.ts -t 'borrow'` | collect-pacing (H10): `L1: L0 and the one L1 file whose formula it shares: expected [ '../../shared/api.js', './childReclaimSweep.js', './coord/childReclaim.js' ] to deeply equal [ '../../shared/api.js', './childReclaimSweep.js' ]`; collect-lane-scans "neither the lane nor the executor imports…": `expected '…' not to match /\bfrom\s*['"]\.\/coord\//` |
| T8.10 | `coord/collectTempRoot.ts` `collectAudit`: delete its `if (!capSupported(deps.fleetState, COLLECT_CAP)) return 'not-asked';` line | `./node_modules/.bin/vitest run test/verb-gate.test.ts` | "each holds capSupported(…, COLLECT_CAP)…": `expected [ 'coord/collectTempRoot.ts:NN wsCollectAudit (ws-audit)' ] to deeply equal []` |
| T8.11 | `collectAudit`: delete its `if (!verbSupported(deps.fleetState, argv)) return 'not-asked';` line | same | "has no ungated call site outside UNGATED_BY_DECISION": `expected [ 'coord/collectTempRoot.ts:NN wsCollectAudit (ws-audit)' ] to deeply equal []`; "gates every verb this branch added…" (`ws-audit`); and the new case's second `expect` |
| T8.12 | `collectTempRoot`: delete step 6's `capSupported(…, COLLECT_CAP)` re-check (keep step 1's) | `./node_modules/.bin/vitest run test/collect-lane-scans.test.ts -t 'last await'` | `asked at the job’s start and again before the act: expected 1 to be greater than or equal to 2` |
| T8.13 | `collectTempRoot`: move step 6's re-check to directly before step 5's `await collectSwitches(` | same | `an await stands between the last capability check and the argv: expected '…' not to match /\bawait\b/` |
| T8.14 | `collectTempRoot`: replace `CCD_ARGV.wsCollect(` with `CCD_ARGV['wsCollect'](` | `./node_modules/.bin/vitest run test/verb-gate.test.ts test/collect-lane-scans.test.ts` | verb-gate "gates every verb this branch added…": `ws-collect has no call site at all: expected 0 to be greater than 0`; collect-lane-scans "there is ONE … site": `expected [] to deeply equal [ 'server/src/coord/collectTempRoot.ts' ]` |
| T8.15 | `collectTempRoot`: spend observation 1's token, replacing `obs2.token` at the site with `obs1.token` (`const obs1 = deps.lane.observation(job.id);`, as Task 6 names it) | `./node_modules/.bin/vitest run test/collect-lane-scans.test.ts` | "its first argument is <obs>.token…": `obs1 is bound as <answer>.value exactly once in collectTempRoot: expected 0 to be 1` |
| T8.16 | `collectTempRoot`: spend a literal, `CCD_ARGV.wsCollect('a'.repeat(64) as CollectToken, job.id, …)` (H6) | same | "its first argument is <obs>.token…": `the first argument is "'a'.repeat(64) as CollectToken", not <identifier>.token: expected null not to be null` |
| T8.17 | `coord/childReclaim.ts` `childReclaimAct`: change `token: string` to `token: CollectToken`, importing the type from `../../../shared/api.js` | same | "each ws-reclaim and ws-expire site…": `server/src/coord/childReclaim.ts childReclaimAct: expected 'CollectToken' to be null` |
| T8.18 | `coord/collectTempRoot.ts`: add `await io.readdir(path.join(registryDir, '..', '..', '.cc-tmp'));` in `readCollectPopulation` | `./node_modules/.bin/vitest run test/collect-lane-scans.test.ts -t 'cc-tmp'` | "the pass, the lane and the executor spell…": `server/src/coord/collectTempRoot.ts: a path spelling of .cc-tmp: expected [ '…' ] to deeply equal []` |
| T8.19 | `coord/collectTempRoot.ts`: add `const home = homedir();` (importing `homedir` from `node:os`) | same | "the lane and the executor never read the home directory…": `server/src/coord/collectTempRoot.ts: expected '…' not to match /\bhomedir\s*\(|…/` |
| T8.20 | `collectLane.ts`: import `parseChildReclaimResult` from `./coord/childReclaim.js` and call it in `parseCollectResult`'s exit-0 arm | `./node_modules/.bin/vitest run test/collect-lane-scans.test.ts -t 'borrow'` | `server/src/collectLane.ts: expected 'parseChildReclaimResult' to be null` |
| T8.21 | `watch.ts` `sweepTempRootCollect`: parse an act answer itself with `parseCollectResult(` | same | "the two collect readers are defined…": `parseCollectResult: expected [ 'server/src/collectLane.ts', 'server/src/coord/collectTempRoot.ts', 'server/src/watch.ts' ] to deeply equal [ … ]` |
| T8.22 | `server/src/remote/runner.ts`: `'ws-audit': 90_000,` becomes `'ws-audit': 70_000,` | `./node_modules/.bin/vitest run test/collect-audit-budget.test.ts` | "reads 30 + 10 + 30 s…": `expected { …, rowS: 70 } to deeply equal { …, rowS: 90 }`; "the probes and ONE grace…": `expected 73 to be less than 70` |
| T8.23 | `server/src/coord/childReclaim.ts`: `export const CHILD_RECLAIM_DEFER_WHYS = [] as readonly ChildReclaimDeferWhy[];` | `./node_modules/.bin/vitest run test/child-reclaim-sweep-policy.test.ts -t 'ANY-kind clock'` | `the derived list lost the server’s own word: expected [] to include 'generation-changed'`. Before this task's floor the same mutation is GREEN (measure it once on the pre-task file and record it, the evidence for the floor) |
| T8.24 | The same export: `Object.keys(CHILD_RECLAIM_DEFER_WHY).slice(0, 7) as readonly ChildReclaimDeferWhy[]` | same | `the derived list lost the server’s own word: expected [ 'siblings-open', … ] to include 'generation-changed'` |
| T8.25 | `child-reclaim-attention-arms.test.ts` `SPELLED`: `` `'${w}'|…` `` becomes `` `['"]${w}['"]|…` `` | `./node_modules/.bin/vitest run test/child-reclaim-attention-arms.test.ts` | `CONTROL: double quotes are outside this census, as the title says: expected true to be false` |
| T8.26 | `verb-gate.test.ts`: delete Task 6's `'ws-collect'` from `CAP_GATED_VERBS` | `./node_modules/.bin/vitest run test/verb-gate.test.ts` | RED at Task 6's shape (H6; H13 voids `ws-collect-cap-entry-is-a-classification`, because the entry is load-bearing): "has no ungated call site outside UNGATED_BY_DECISION": `expected [ 'coord/collectTempRoot.ts:NN wsCollect (ws-collect)' ] to deeply equal []`; "gates every verb this branch added…": `ws-collect: expected [ 'coord/collectTempRoot.ts:NN wsCollect (ws-collect)' ] to deeply equal []` |
| T8.27 | `watch.ts`: compose `CCD_ARGV.wsCollectAudit(id)` in `sweepTempRootCollect` (with `verbSupported` and `capSupported(…, COLLECT_CAP)` beside it, so verb-gate's own cases stay green) | `./node_modules/.bin/vitest run test/ws-collect-wiring.test.ts test/verb-gate.test.ts` | wiring: `a reference to either builder…: expected [ 'ccdargv.ts', 'coord/collectTempRoot.ts', 'watch.ts' ] to deeply equal [ 'ccdargv.ts', 'coord/collectTempRoot.ts' ]`; verb-gate: `expected [ 'coord/collectTempRoot.ts', 'watch.ts' ] to deeply equal [ 'coord/collectTempRoot.ts' ]` |
| T8.28 | `collectLane.ts`: add `const VERB = 'ws-collect';` and use it in a feed title | `./node_modules/.bin/vitest run test/ws-collect-wiring.test.ts` | `the verb as a literal…: expected [ 'ccdargv.ts', 'collectLane.ts', 'remote/runner.ts' ] to deeply equal [ 'ccdargv.ts', 'remote/runner.ts' ]` |
| T8.29 | `collectTempRoot`: spend a token read from the lane's memory, `CCD_ARGV.wsCollect(deps.lane.observation(job.id)!.token, job.id, …)` (H6) | `./node_modules/.bin/vitest run test/collect-lane-scans.test.ts` | "its first argument is <obs>.token…": `the first argument is "deps.lane.observation(job.id)!.token", not <identifier>.token: expected null not to be null` |
| T8.30 | `collectTempRoot`: rebind observation 2 from the lane's memory, replacing `const obs2 = audit.value;` with `const mem = { value: deps.lane.observation(job.id)! }; const obs2 = mem.value;` (H6) | same | "its first argument is <obs>.token…": `mem is neither asked, the audit call's binding, nor one alias of it: expected null not to be null` |

Revert each mutation, then re-run Step 7's command: green.

- [ ] **Step 9: Type-check**

```bash
( cd server && ./node_modules/.bin/tsc --noEmit -p . )
( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )
```

Expected: tsc prints nothing; `typecheck-tests` PASSES with the two new test files included.

- [ ] **Step 10: Commit**

```bash
git add server/test/single-definition.test.ts server/test/verb-gate.test.ts server/test/ws-collect-wiring.test.ts \
  server/test/child-reclaim-sweep-policy.test.ts server/test/child-reclaim-attention-arms.test.ts \
  server/test/collect-lane-scans.test.ts server/test/collect-audit-budget.test.ts
git commit -F - <<'EOF'
test(collect): pin the collector lane's switch, predicate readers, gates and token provenance

The temp-root collector's lane is wave 7's destructive verb's first composer,
so the fences a type cannot draw are pinned as text:

- collect-lane-live has no writer: one L1 definer with no node: import, and
  only the definer and the executor name its constant, neither reaching a
  write;
- the collector's lane and executor import and call the L0 temp-root id
  predicate, beside the block that pins its one definer;
- ws-collect joins NEW_GENERATION, and the one collect audit site, which
  the learning audit and the act job share, asks COLLECT_CAP as well as
  verbSupported;
- the one ws-collect site spends observation two's token, bound once from
  the act job's own audit answer, and the act asks COLLECT_CAP again after
  the job's last await; no ws-reclaim or ws-expire site names a collector
  value;
- the lane spells ~/.cc-tmp only for display and never reads the home
  directory, and the collect readers never borrow reclaim's;
- ws-audit's 90 s row holds the audit's three probes and one kill grace,
  read from ccd and the runner: 73 s, or 78 s at the widest grace.

The wiring test's INERT case, whose holder lists the executor and the pass
already joined, becomes ONE LANE in its title, header and messages, and the
verb and mode-flag literal lists stay as they were. The sweep-policy loop
over the defer words gains a floor, and the kept-word census title says what
it checks.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Docs — the lane as built, shadowed: the spec, README and its arming checklist, "§16 as built", and the citation tax

**Model routing:** `opus`, effort `high`. This is prose that the operator acts on before arming a destructive lane. Every sentence is measured against the code at this branch's tip, never against the rulings' text.

**Why:**
- **R92.** It rewrites the spec to describe the lane as built, shadowed:
  - §5.10 at `:233`, `:1261-1264`, `:1294-1299`, `:1321-1322` and `:1364-1367`;
  - "§7" at `:1540`, `:1559`, `:1564` and `:1567`;
  - §8's wave 9 row at `:1872`, and the paragraph at `:1878-1881`.

  It rewrites the README too: the "shipped inert" heading and the three "nothing composes it" sentences (`:3762`, `:3780-3781`, `:5307`, `:5317-5318`), plus `:4199-4201` (R86). "§16 as built (wave 9, run 380)" names departures by slug, with no number.
- **R82.** "Before arming (the operator's checklist, written by wave 9's docs task)": four items.
- **R86.** README `:4199-4201`'s list of what `reclaim-paused` stops gains the collector. The cleanup-pause row (`:5310`) stays as it is, and its two prose pins are run 358's.
- **R87 and R90.** `g9-kill-grace-residual`: the spec's `:1364-1366` prose gets an as-built note. One kill grace is paid: about 73 s, or 78 s at the 8 s grace. `spec-presence-constants-citation-stale` is re-pointed by content.
- **R91.** CLAUDE.md is touched, if at all, only at `:10`. `shared/api.ts` insertions only at the foot, so README's `shared/api.ts:` anchors do not move. The five session-hook citation cases are re-run.

**Readings this task takes (each named by slug in the wave-done):**
- `r92-section-7-lines-are-section-5-10s`. R92 calls `:1540`, `:1559`, `:1564` and `:1567` "§7". At `d0c2b7803` they lie inside §5.10 (`:1254-1573`), in its own list of residuals; §7 begins at `:1655`. They are edited by content where they stand.
- `spec-stale-sentences-beyond-the-r92-list`. Four more sentences of the same class are false once the lane exists, and are edited in the same way:
  - §5.10 `:1337`, "both are carried to wave 9's pre-flight list";
  - `:1562`, "on every pass";
  - `:1570`, the audit's "worst case can exceed its runner row";
  - §7 item 6 at `:1794`, "about 79 seconds (94 at the widest kill grace)".
- `collect-lane-prose-pins`. This adds a NEW prose test, `server/test/collect-lane-prose.test.ts`. It pins the sentences this task writes and the stale ones it removes, as `expiry-lane-prose` and `dead-coordinator-prose` do for their lanes. The plan names no such file. Run 358's two prose files are run and never edited.
- `spec-5-8-pause-sentence-untouched`. §5.8's "Pausing stops reclamation fleet-wide, and … the dead-coordinator lane: it is the fleet's one cleanup switch … Nothing else" is not in R92's list. It is pinned by run 358's `expiry-lane-prose.test.ts:73-75` and `dead-coordinator-prose.test.ts:108-109`. It is read as R86 reads README `:5310`: "child reclamation" covers the collector. §5.10 says the lane runs under `reclaim-paused`.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`.
- Modify: `README.md`: `:3762`, `:3779-3781` and one new paragraph after it, `:4199-4201`, `:5307` and `:5317-5318`. NOT `:5310`. Run 358's regions (`:3552-3553`, `:3585`, `:3789-3790` at `d0c2b7803`) are not touched; re-point every edit by content after `main`'s merge.
- Modify: `docs/superpowers/programs/child-reclamation-contract.md`. APPEND "### §16 as built (wave 9, run 380)" after R92, at the end of §16 ONLY. Nothing above it is edited.
- Modify (only if Step 4 measures a change): `CLAUDE.md:10`, the README numeral alone.
- Test (new): `server/test/collect-lane-prose.test.ts`.
- NOT edited:
  - this plan's `## Deviations found` (the coordinator's, at the fix round);
  - `server/test/expiry-lane-prose.test.ts`, `server/test/dead-coordinator-prose.test.ts` (run 358's);
  - `server/test/pools-prose.test.ts`, `server/test/child-reclaim-prose.test.ts`, `server/test/ws-collect-prose.test.ts`;
  - every skill under `ccd/`;
  - `agent/CLAUDE.md`.

**Interfaces:**
- Produces: prose only, plus the test file. The sentences below are pinned verbatim by `collect-lane-prose.test.ts`, so a later edit to one moves its pin in the same commit.
- Consumes:
  - the code at this branch's tip after Tasks 1–8: the names `COLLECT_LANE_LIVE_MARKER`, `isTmpRootId`, `TMPROOT_ID_MAX_CHARS`, `COLLECT_POPULATION_MAX`, `COLLECT_AUDITS_PER_PASS`, `COLLECT_OBSERVE_INTERVAL_MS`, `collectTempRoot`, `sweepTempRootCollect` and `CHILD_RECLAIM_STALL_MS`;
  - Task 5's feed titles (quoted only if Step 0 finds them);
  - Task 8's `collect-audit-budget.test.ts`;
  - the departure slugs the coordinator accepted in H1–H9 (Step 5 lists them), never a void one.

- [ ] **Step 0: Entry conditions and measurements**

```bash
git log --oneline -9                                                                   # Tasks 1–8 committed, one each
git fetch origin main && { git grep -q 'rereadDeadCoordinatorJournalTrust' origin/main -- server/src/watch.ts && echo "WL W6 on main: merge it first (git merge origin/main), then re-anchor by content" || echo "WL W6 not on main"; }   # a content probe: main's own docs(plan) commit for wave 6 (cc33c8d51) matches a log grep, so a log grep says landed too early
grep -n "Wave 7 ships it inert" docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md            # :233 and :1262
grep -n "The server's lane (wave 9) owns the rest" docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md
grep -n "the lane audits every pass\|about 79 seconds\|pre-flight list\|on every pass for the child's life\|worst case can exceed" docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md
grep -n "shared/api.ts:3856-3857" docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md
grep -n "export const PRESENCE_REFRESH_MS\|export const PRESENCE_TTL_MS" shared/api.ts                               # the re-pointed citation
grep -n "shipped inert)\|no server code composes the verb\|nothing composes it yet\|nothing composes it in this build\|as does the dead-coordinator lane" README.md
grep -n "README.md\` (~" CLAUDE.md; wc -l < README.md
grep -rn "title: '\|TITLE" server/src/collectLane.ts | head                                                             # Task 5's feed titles, to quote exactly if quoted
```

- [ ] **Step 1: Write the prose test first**, `server/test/collect-lane-prose.test.ts`:

```ts
// Child reclamation wave 9: what the operator documents say about the temp-root collector's lane (spec 2026-09-22
// §5.10, §8). The lane ships shadowed, so every sentence that said nothing composes the verb is gone, and the arming
// checklist stands where the operator reads it. Run 358's prose pins (`expiry-lane-prose`, `dead-coordinator-prose`)
// own the cleanup-pause sentences this wave extends; this wave runs them and never edits them.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const flat = (f: string): string => readFileSync(path.join(root, f), 'utf8').replace(/\s+/g, ' ');
const SPEC = 'docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md';

describe('README: the temp-root collector', () => {
  const readme = flat('README.md');
  it('no sentence says the verb is inert or that nothing composes it', () => {
    for (const gone of ['shipped inert).**', 'no server code composes the verb until', 'nothing composes it yet',
      'nothing composes it in this build']) expect(readme, gone).not.toContain(gone);
  });
  it('says the lane composes it, shadowed behind a file nothing in the tree writes', () => {
    expect(readme).toContain("**The collector's lane (child reclamation wave 9) ships shadowed.**");
    expect(readme).toContain('until the operator touches that file by hand in the registry the server reads');
    expect(readme).toContain('and never composes `ws-collect`');
    expect(readme).toContain('only after two audits at least a sweep interval apart minted the same token');
    expect(readme).toContain('`$REG/reclaim-paused` stops the lane, shadow included');
    expect(readme).toContain('runs at most two learning audits and one act job');
    expect(readme).toContain('no act job, shadow included, is offered in the first eight minutes after the server starts');
  });
  it('carries the four-item checklist before arming', () => {
    expect(readme).toContain('**Before arming it**, read the shadow feed rows, and arm only when:');
    expect(readme).toContain('every "would collect" names an orphan whose run is closed;');
    expect(readme).toContain('except the one for temp roots whose runs the coordination database cannot vouch for, which may stand once you have read it');
    expect(readme).toContain('you know that any process of this uid can touch `$REG/collect-lane-live`');
  });
  it('names the collector among what the cleanup pause stops, keeping run 358’s pinned words', () => {
    expect(readme).toContain('and the expiry of archived workspaces stops too, as does the dead-coordinator lane, and so does the temp-root collector’s lane');
    expect(readme).toContain('`ws-reclaim` and `ws-collect`, each token-gated the same way, are composed by the server alone');
  });
});

describe('the design spec', () => {
  const s = flat(SPEC);
  it('§5.10 describes the lane as built, and the inert sentences are gone', () => {
    expect(s).toContain("**The server's lane (wave 9), as built.**");
    expect(s).toContain('`$REG/collect-lane-live`');
    for (const gone of ['Wave 7 ships it inert, and no lane composes it until wave 9', 'a builder that nothing calls',
      'the lane audits every pass', "arried to wave 9's pre-flight list", "on every pass for the child's life"]) {
      expect(s, gone).not.toContain(gone);
    }
  });
  it('the audit budget pays one grace: about 73 seconds, 78 at the widest (as built, wave 9)', () => {
    expect(s).not.toContain('about 79 seconds');
    expect(s).toContain('about 73 seconds, or 78 at the widest grace');
  });
  it('states the offer order, the start hold-off at the offer, the flat hold and the restart residual (as built, wave 9)', () => {
    expect(s).toContain("No act job, shadow's would-collect included, is offered within eight minutes of the lane's start.");
    expect(s).toContain('Each pass offers the act job first, to the earliest ripe id by its ripening instant and then id');
    expect(s).toContain('The pass never awaits a call it queued.');
    expect(s).toContain('A hold waits one ceiling flat.');
    expect(s).toContain('about eight extra journaled terminal audits or failing acts per such id');
  });
  it('Appendix A cites the presence constants at the lines that hold them', () => {
    const m = /`PRESENCE_REFRESH_MS = 15_000`, `PRESENCE_TTL_MS = 45_000` \(`shared\/api\.ts:(\d+)-(\d+)`\)/.exec(s);
    expect(m, 'the citation is gone').not.toBeNull();
    const api = readFileSync(path.join(root, 'shared/api.ts'), 'utf8').split('\n');
    expect(api[Number(m![1]) - 1]).toContain('export const PRESENCE_REFRESH_MS = 15_000;');
    expect(api[Number(m![2]) - 1]).toContain('export const PRESENCE_TTL_MS = 45_000;');
  });
});

describe('the programme’s rulings file', () => {
  it('carries the wave’s as-built note, naming slugs and no number', () => {
    const c = readFileSync(path.join(root, 'docs/superpowers/programs/child-reclamation-contract.md'), 'utf8');
    const at = c.indexOf('### §16 as built (wave 9, run 380)');
    expect(at, 'the as-built note is missing').toBeGreaterThan(-1);
    expect(c.slice(at)).not.toMatch(/\bD-\d/);
  });
});
```

- [ ] **Step 2: Run it: RED.**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-lane-prose.test.ts
```

Expected: every case but none fails. The first `not.toContain` of each removal case reds, for example `shipped inert).**: expected '…' not to contain 'shipped inert).**'`. The new-text cases red with `expected '…' to contain '**The collector's lane (child reclamation wave 9) ships shadowed.**'`. The Appendix A case reds on `export const PRESENCE_REFRESH_MS` at line 3856. The rulings-file case reds with `the as-built note is missing: expected -1 to be greater than -1`.

- [ ] **Step 3: The spec**, each located by its grep, never by number. The spec's voice: no contract rule, no `D-` token, and no plan task number.
  - (a) §5.2, `Wave 7 ships it inert, and no lane composes it until wave 9 (§8).` becomes:
    > Wave 9's lane, in the server's sweep, is its one composer, and it ships shadowed: until the operator arms it, it audits and records what it would collect and composes nothing (§5.10, §8).
  - (b) §5.10's opening paragraph, from `Wave 7 ships it inert: the grant,` to `until wave 9's lane does (§8).`, becomes:
    > Wave 7 shipped it inert: the grant, the declarations, the runner budget row of 240 seconds and a builder. Wave 9's lane is its one composer (below), and it ships shadowed behind `$REG/collect-lane-live`, a file nothing in the tree writes. A scan pins that only the lane's files name the builders and the capability token.
  - (c) Replace the paragraph `The server's lane (wave 9) owns the rest, and is stated here as the design it is built to: …` (through `… the sweep's pacing.`) with:
    > **The server's lane (wave 9), as built.** The lane is the verb's one composer, in the server's sweep. It ships shadowed: it composes `ws-collect` only while `$REG/collect-lane-live` exists, a file nothing in the tree writes and the operator touches by hand. Without it, the lane audits under every rule below and records "would collect" where it would spend, one feed row per id and token. The executor reads the file from the same registry listing as `reclaim-paused`, nearest the argv. The lane keeps a last-seen flag that starts at shadowed, so an arming it has not yet seen, a restart's included, is a flip. Each flip writes one feed row, clears every observation pair, and composes nothing on the job that sees it.
    > - **The population** is read every pass, inside the pass's one gather, from two listings, `<registryDir>/tmproots` and `<registryDir>/tmpquarantine`, never `~/.cc-tmp`.
    >   - Each is `lstat`ed first. A proven absence is an empty listing. A link, a file or a failed answer makes that listing unmeasured, and only a real directory is listed.
    >   - A null listing is resolved by a measured stat, so only a proven absence is empty.
    >   - Dot-leading names are dropped.
    >   - A listing of more than `COLLECT_POPULATION_MAX` (1024) names, counted before any is dropped, is unmeasured. The cap bounds what the lane audits and remembers, not the listing itself: the agent's `readdir` returns every name in one frame, as the registry's own `$REG` listing already does every tick.
    >   - A record's id is parsed as ccd parses it (`<id>.<ns>.<pid>`, never a prefix).
    >   - An id must pass `isTmpRootId`: a session id's shape, leading with neither `.` nor `-`, of at most 255 characters. It is checked before any argv and again at the act. A name that fails it is counted, never named, and never audited.
    >   - An id whose exact `<id>.child` or `<id>.uuid` row stands is not audited that pass, unless a quarantine record names it.
    >   - An id is forgotten only when both listings were measured and neither names it.
    >   - While a listing is unmeasured, the lane audits the other listing's ids alone and lists the unmeasured one once.
    > - **The licence** is two observations of one unchanged token.
    >   - The second observation is the act job's own audit. It must arrive at least `COLLECT_OBSERVE_INTERVAL_MS`, one sweep interval, after the first, on the server's monotonic clock, and every answer between the two must be that same collectable token.
    >   - The pairs live in memory only. A restart, a raised pause, a missing capability, a pass that fails shut, an unlistable registry and an arming flip each clear them, and an answer composed before a clear is no observation.
    >   - The argv takes the second observation's token and the job's id. The token is a branded type that only the collect audit's reader mints, and a scan pins where it is bound.
    >   - All three token modes take this rule. The lane never passes `--defer-expired` and never kills a holder.
    > - **The gates.**
    >   - The capabilities: `collect-v1` and `reclaim-pause-v1` must both be advertised.
    >   - The pause: `reclaim-paused` is read at the pass's start, at the job's start, and after the job's last await. An unlistable registry reads as paused.
    >   - Presence: an id shown on any phone is deferred. Presence is read at the job's start and again after its last await.
    >   - The open-run hold, judged on the second observation's document. Any of these holds the id:
    >     - the witness's run is not terminal;
    >     - that run is absent from the coordination database, or opened after the witness's time plus the birth skew;
    >     - any open run names the id as its session or its claimant;
    >     - a fresh collection's document names no witness run;
    >     - any of those reads fails.
    >   - A hold resets the pair. Ids held because the database cannot vouch for their runs are listed together on one line once held past the ceiling.
    > - **Its pacing** is its own, with reclaim's ramp and tier by import (§5.7).
    >   - A deferral count, and three runs, each with its last arrival:
    >     - failing, which a per-leaf deterministic answer enters at once;
    >     - verb-failed, which a collectable answer never clears;
    >     - terminal, which enters at once and is never asked sooner than the tier pace.
    >   - `changed-recently` is asked again at the leaf's own idle instant, clamped between one pass and a day.
    >   - There is a floor of one ceiling after any verb refusal, after a recognised pre-lock die other than `flock-unavailable`, and after a shadow "would collect". The same die recurring past the ceiling is listed.
    >   - A hold waits one ceiling flat. Presence waits the ramp over its own count.
    >   - `not-witnessed` clears the three runs and advances the deferral count. An unreadable document or an unknown verdict advances the failing run. A verb refusal or failure whose word is terminal advances the terminal run, ahead of the refusal and verb-failed rows.
    >   - The next ask is the latest of these waits. An id holding an observation is next asked at its ripening instant, the first observation's arrival plus the interval.
    >   - At most `COLLECT_AUDITS_PER_PASS` (2) learning audits run a pass. At most one `ws-collect` is composed a pass, and one is in flight fleet-wide, under a slot of the collector's own.
    >   - Each pass offers the act job first, to the earliest ripe id by its ripening instant and then id, then up to two learning audits by next-ask instant and then id. An id with a collector call or job still pending is skipped, and an id holding an observation is never offered a learning audit. The pass never awaits a call it queued.
    >   - An act that answered no document keeps its id and the slot for `CHILD_RECLAIM_STALL_MS` (eight minutes). No act job, shadow's would-collect included, is offered within eight minutes of the lane's start.
    >   - A collector call or executor job unsettled past its bound is listed on one box-wide line, and its id is not asked again until it settles. An act job's bound, eight minutes, is checked first: past it, the line says the act slot is held, whether or not the job's `ws-collect` is out. A learning audit, or an act job's own audit inside those eight minutes, is listed as a call once it stands past twice the 90 s row.
    >   - The pacing is memory only: every restart, a rollout included, re-enters each terminal and verb-failed id at j = 0, about eight extra journaled terminal audits or failing acts per such id in the 4.5 h after it. The 12-then-6 bound holds between restarts only.
    > - **What it shows.**
    >   - Collector items join the cleanup row's attention list (§5.9), one per id. Answers that stand for the whole box are listed once each.
    >   - A reclaim item wins over a collector item, and a collector item wins over a kept-leaf item. The winner carries the loser's instruction as a second clause.
    >   - Every string ccd prints reaches a sentence only through the one bounded plain-text reader.
    >   - Feed rows are one per episode.
    > - **Before arming** (README, "Before arming it"), the operator:
    >   - reads the shadow feed rows;
    >   - checks that every "would collect" names an orphan whose run is closed;
    >   - checks that no box-wide line stands but the one for ids whose runs the database cannot vouch for;
    >   - knows that any process of this uid can touch the file.
    >
    >   Arming is what makes "an orphaned temp root is collected with no human act" true.

    After writing (c), re-measure every number and name in it against the tip:

    ```bash
    grep -n "COLLECT_POPULATION_MAX = \|COLLECT_AUDITS_PER_PASS = \|COLLECT_OBSERVE_INTERVAL_MS = \|CHILD_RECLAIM_STALL_MS = \|TMPROOT_ID_MAX_CHARS = " server/src/*.ts shared/api.ts
    ```

    Correct the text to the code, never the reverse. A sentence that cannot be made true is reported by slug.
  - (d) `` `containment-unproven`, and only they are journaled, act `collect`, verb `ws-audit`: the lane audits every pass, and a retryable word a pass would bury the journal. `` becomes:
    > `` `containment-unproven`, and only they are journaled, act `collect`, verb `ws-audit`: the lane audits each id at its own pace, and a retryable word journaled at every audit would bury the journal. ``
  - (e) `both are carried to wave 9's pre-flight list.` (the audit paragraph's last line) becomes:
    > both are the tail's, and the server cannot see a slot or a hidden leaf, so the lane reads `not-witnessed` as ending nothing; they go to the path-identity follow-up, which is ccd-bearing.
  - (f) The budget sentences, from `Each bounded probe adds its own TERM-to-KILL grace` through `A budget keyed on the mode is wave 9's.`, become:
    > A probe that reaches its bound ends the audit, so one TERM-to-KILL grace is paid, 3 seconds by default and at most 8: about 73 seconds, or 78 at the widest grace, against the same 90 seconds, a sum `collect-audit-budget.test.ts` reads from source. The registry row pass carries no bound of its own in that sum. A runner that kills the audit gets no document, which the lane reads as `no-document` and paces as a failure, so it fails closed. As built (wave 9), no budget is keyed on the mode: the audit keeps `ws-audit`'s row. The figures this paragraph once gave, about 79 and 94 seconds, counted a grace per probe, and only one is ever paid.
  - (g) The residual list at the end of §5.10:
    - `TERMINAL and journaled `refused` on every pass for the child's life,` becomes `TERMINAL and journaled `refused` at every audit for the child's life (the lane paces those audits on its terminal run),`.
    - The device bullet's `Carried to wave 9's pre-flight list.` becomes: "It loses a witness, never data. The lane's only mitigation is its two observations of one token, and the cure is ccd's, in the path-identity follow-up."
    - The permanent-device bullet: `every `removed` record at unmeasured `device` on every pass` becomes `… at every audit`, and its `Carried to wave 9's pre-flight list.` becomes: "Wave 9's lane does not: `device` is a per-leaf answer that enters its failing run's tier at once and is listed at once. The cure is ccd's."
    - The tail-drop bullet's `Both are carried to wave 9's pre-flight list.` becomes: "Both are the tail's, and the lane reads `not-witnessed` as ending nothing; they go to the path-identity follow-up."
    - `- The audit's worst case can exceed its runner row (above); it fails closed.` becomes `- The registry row pass has no bound of its own, so the audit can still outrun its runner row (above); a kill there fails closed.`
  - (h) §7 item 6, `and the audit's worst case, about 79 seconds (94 at the widest kill grace) against a 90 second runner row, fails closed when the runner kills it.`, becomes:
    > `and the audit's probes, about 73 seconds (78 at the widest kill grace) against a 90 second runner row, leave the row pass unbounded, which fails closed when the runner kills it.`
  - (h2) §7's residual lists end with wave 8's (`Wave 8 carries these residuals as well, and amends the ones above.`, whose last bullet begins `The seed's windowed slice and the recycled-slug window affect pacing only.`). Directly after that last bullet, before the `---` above `## 8. The waves`, append a paragraph of the same shape and indentation. Two comments this wave ships cite §7 for these residuals (Task 1's `TMPROOT_ID_MAX_CHARS` docstring and Task 7's `sweepTempRootCollect` docstring), and R89's stated residuals have no other home in the spec:
    ```markdown

       Wave 9 carries these residuals as well, as built.
       - The lane's memory is its only pacing, so every restart, a rollout included, re-enters each terminal and
         verb-failed id at j = 0 (§5.10).
       - No act job is offered for eight minutes after the lane starts, because a restart forgets the slot while the
         previous process's act may still run. In local mode that rests on the server unit's default
         `KillMode=control-group`.
       - A killed ccd's orphaned children are not counted against the slot. They hold the id's reap lock, so ccd
         answers `in-progress`.
       - An id of 223 to 244 bytes passes the reap lock but cannot name a slot or a record within NAME_MAX. ccd's answer
         there is paced by the tier like any per-id answer.
       - A witness-only `collect` `done` ends a kept-leaf item's temp-root half (§5.9) even when the device test could
         not see a same-device bind mount. The item can then end while the leaf stands under the mount, until the
         path-identity follow-up filters that end on a removal.
    ```
    Measure each bullet against the tip (`grep -n 'KillMode\|orphaned children' server/src/watch.ts` and `grep -n 'past 244' shared/api.ts`), and correct the text to the code, never the reverse.
  - (i) §8, the wave 9 row (`grep -n "^| 9 | server |" …`) becomes:
    > `| 9 | server | the collector's lane, as built and shipped shadowed behind `$REG/collect-lane-live`: its population from the two registry listings and the one id predicate; two observations of one token, the second the act job's own audit, before one act; the capability, pause, presence and open-run gates; its own pacing over reclaim's ramp and tier, and its own destructive slot; collector items in the cleanup row's list, and the feed (§5.10) | in shadow every would-collect is recorded and nothing is composed; once the operator arms it, an orphaned temp root is collected with no human act |`
  - (j) §8's paragraph, from `half and the collector's lane both edit the sweep, so wave 9 is dispatched` through `which brought the expiry lane, is met.`, becomes:
    > `half and the collector's lane both edit the sweep, so wave 9 was dispatched once the fleet's `ccd caps` advertised wave 7's token and wave 8 had merged. Wave 9's subject is what `ws-collect` is licensed against, and it ships its lane shadowed: arming it is the operator's act, after the checks §5.10 names.`
  - (k) Appendix A, `(`shared/api.ts:3856-3857`)` becomes the measured lines from Step 0's grep. At `d0c2b7803` they are `(`shared/api.ts:4141-4142`)`. Task 1 inserts only at the foot, so they hold; measure anyway.
  - (k2) The `crumb` paragraph's `ws-expire` sentence (§5.6, `grep -n "this wave leaves it alone" docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`; `:728-732` at `d0c2b7803`). Make this edit ONLY if Step 0's content probe printed `WL W6 on main` (workspace lifecycle wave 6, #351, merged into this branch first). At `d0c2b7803` the paragraph says that `ws-expire`'s own pre-breadcrumb documents and its resumed arm's `probe-unmeasured` "carry no key … because the code that prints it is `_ws_expire_locked`'s and this wave leaves it alone". Once wave 6 is on `main`, `_ws_expire_locked` sets `crumb` itself: `true` on its resumed arm, `false` on its fresh arm before its own breadcrumb is written, and no key over a breadcrumb that stands but could not be read. Measure that first with `grep -n '_WS_RCL_CRUMB=' ccd/ccd`.
    - In the sentence that begins `` `ws-reclaim` sets it itself: ``, add after its clause about the shared tail: "`ws-expire`'s locked region sets it the same way (workspace lifecycle's wave 6): `true` on its resumed arm, so the `probe-unmeasured` printed there while its `expire:` breadcrumb stands reads resumable, and `false` on its fresh arm until its breadcrumb is written".
    - In the absence list, the two clauses from `` `ws-expire`'s own pre-breadcrumb documents, `` through `` `_ws_expire_locked`'s and this wave leaves it alone; `` become: "a `ws-expire` whose breadcrumb stands but could not be read;". The reclaim clause before it and the `ws-collect` clause after it stay.
    - Correct the text to the code. The edit is one more sentence of `spec-stale-sentences-beyond-the-r92-list`'s class, and the wave-done says so.

    If Step 0 printed `WL W6 not on main`, leave the paragraph alone. The wave-done then names slug `spec-ws-expire-crumb-sentence-after-wl-w6`, so that the second lander makes this edit in its merge.
  - (l) Every code comment and test title this wave added cites a spec section. List them with `git diff origin/main...HEAD -- server/src server/test shared | grep -oE '§[0-9]+(\.[0-9]+)?[^)]*' | sort | uniq -c`, which lists every section cited, §7's included, never §5.x's alone. Confirm each cited section now says what the comment says it says. A miss is fixed in the spec, or reported by slug.

- [ ] **Step 4: README and CLAUDE.md**
  - (a) `:3762`, `**The temp-root collector (child reclamation wave 7, shipped inert).**`, becomes `**The temp-root collector (child reclamation waves 7 and 9; the lane ships shadowed).**`.
  - (b) `:3779-3781`, from ``` `mv` with `--no-copy` (coreutils 9.2 or later); on Darwin the audit measures nothing. ``` (the whole of `:3779`, from its first character) to the paragraph's end (`until the collector's lane lands (wave 9).`, `:3781`), becomes:
    ```markdown
    `mv` with `--no-copy` (coreutils 9.2 or later); on Darwin the audit measures nothing. `ccd caps` advertises
    `collect-v1` and `ws-collect`, and the agent grants `['ws-collect','--expect']`.

    **The collector's lane (child reclamation wave 9) ships shadowed.** The server's sweep is the verb's one composer, behind
    `$REG/collect-lane-live`: until the operator touches that file by hand in the registry the server reads (the fleet
    box's, through the agent, when the server runs `CCRC_FLEET=remote`; nothing in this tree writes it), the lane audits
    and records what it would collect — a feed row and an entry in the cleanup row on `/runs` — and never composes
    `ws-collect`. Removing the file shadows it again; each change writes one feed row, and the first act after either
    waits for two fresh audits. Each pass the lane lists `$REG/tmproots` and `$REG/tmpquarantine`, never `~/.cc-tmp`, and
    runs at most two learning audits and one act job. It composes `ws-collect` for an id only after two audits at least a
    sweep interval apart minted the same token, the second in the act's own job, and only on a box whose ccd advertises
    both `collect-v1` and `reclaim-pause-v1`. Armed, at most one `ws-collect` is composed per pass and one runs
    fleet-wide, and no act job, shadow included, is offered in the first eight minutes after the server starts.
    `$REG/reclaim-paused` stops the lane, shadow included. It leaves alone an id
    someone is viewing, an id an open run names, and an id whose witness names a run that is still open, that the
    coordination database does not hold, or that opened after the witness was written. It never kills a holder. A temp
    root it cannot take — in use, changing for a day, kept in quarantine, refused or unmeasurable — is listed in the
    cleanup row, and an answer that stands for the whole box is listed once.

    **Before arming it**, read the shadow feed rows, and arm only when:
    - every "would collect" names an orphan whose run is closed;
    - no box-wide line stands in the cleanup row, except the one for temp roots whose runs the coordination database
      cannot vouch for, which may stand once you have read it: those ids stay held, armed or not, until a person removes
      them;
    - you know that any process of this uid can touch `$REG/collect-lane-live`, as it can `expire-lane-live`, which is
      why each change writes a feed row.
    ```
    Re-measure every claim against the tip. If a Task 5 feed title is quoted, quote it exactly as Step 0's grep printed it.
  - (c) `:4199-4201`. Only the sentence's end changes, and run 358's pinned words stay intact: `…and the expiry of archived workspaces stops too, as does the dead-coordinator lane.` becomes `…and the expiry of archived workspaces stops too, as does the dead-coordinator lane, and so does the temp-root collector’s lane (`ws-collect` itself refuses `paused` on the box).`
  - (d) `:5307`'s cell, `and nothing composes it yet |`, becomes ``and the server's collector lane composes it only once the operator has armed it (`$REG/collect-lane-live`) |``.
  - (e) `:5317-5318`, `` `ws-reclaim`, token-gated the same way, is composed by the server alone, and `ws-collect`, gated on its own token, will be (nothing composes it in this build). `` becomes ``` `ws-reclaim` and `ws-collect`, each token-gated the same way, are composed by the server alone, `ws-collect` only once the operator has armed its lane. ```
  - (f) `:5310` (the cleanup-pause row) is NOT touched. Check with `git diff -U0 origin/main -- README.md | grep -c "raise / lower the cleanup pause"`, which prints `0`.
  - (g) CLAUDE.md:10. Measure `wc -l < README.md` and round to the nearest hundred. If that differs from CLAUDE.md's `(~6000 lines)`, edit that numeral alone (`git diff $(git merge-base origin/main HEAD) -- CLAUDE.md` shows one line; the merge base, so a CLAUDE.md edit another PR landed on `main` is not read as this branch's). If it does not differ, CLAUDE.md is not touched.

- [ ] **Step 5: "§16 as built (wave 9, run 380)"**, appended after R92 at the end of §16. Model it on "§15 as built" (`grep -n '^### §15 as built' docs/superpowers/programs/child-reclamation-contract.md`). It names slugs, never a number:

```markdown
### §16 as built (wave 9, run 380)

Where wave 9's code and the plan's text narrowed or spelled out the rulings above (R82 to R92), they now read as
follows. This note amends; it edits no earlier text. It names each departure by slug and carries no number: the
coordinator assigns this wave's numbers from the block run 380 was issued, and the wave 9 plan's `## Deviations found`
defines them. This wave's committed comments and test titles cite §5.10 of the design spec, and §5.7 and §5.9 where the
lane reuses reclaim's pacing and attention. The spec text this wave adds is in §5.10, with edits to §5.2, §7, §8 and
Appendix A.

**R83 (the population).**
- `population-cap-counts-the-raw-listing`: the 1024 cap counts the raw listing, before the drop of dot-leading and
  non-string names. Only stricter.
- `junk-quarantine-names-are-refused-names`: a non-dot name in `tmpquarantine` that is no record of an id the lane may
  take (junk, or a dash-leading id's record) is counted among the refused names, as a refused witness name is.
- `population-ids-and-candidates-split`: the population carries its ids, which forgetting reads, apart from its
  candidates, the ids less the pre-filter, so a pre-filtered id keeps its pacing and its episodes.
- `collector-records-unread`: the pass keeps the `sweepTempRootCollect(records, names)` signature, and does not read
  `records`; the population comes from the two listings alone.
- `an-answer-for-a-forgotten-id-is-dropped`: forgetting an id does not wait for its in-flight call, and that call's late
  answer is dropped.
- `learn-collect-asks-no-id-predicate`: the learning audit does not re-assert the id predicate; the population's check
  and the act job's step 1 are the two checks this rule names.
- `population-cap-bounds-the-lane-not-the-frame` (a stated residual): the 1024 cap bounds what the lane audits and
  remembers, not the listing itself. The agent's `readdir` returns every name in one frame, as the registry's own `$REG`
  listing already does every tick, so R83's "cannot bloat the agent frame" holds for the lane's memory only.
- `cc-tmp-scan-display-only`: the scan pins three things, because a value handed to `io` cannot be followed across
  lines as text: the pass, the lane and the executor spell `.cc-tmp` only as the display form `~/.cc-tmp`, never beside
  an `io` call or a path join, and the lane and the executor never read the home directory.

**R84 (the readers).**
- `exists-not-carried`: the audit reader does not carry the document's `exists`, since nothing gates on it.

**R85 (the licence).**
- `a-stale-answer-paces-but-never-observes`: a stale answer is never an observation, but its pacing still applies, so a
  lane-wide clear landing between a terminal audit's compose and its answer cannot buy another journaled terminal audit.
- `observation-wait-in-the-next-ask`: while observation 1 stands, the id's next ask is its ripening instant, so a holder
  ripens into the act job instead of taking a learning audit that could only repeat observation 1. §16 now says this.
- `hold-reported-ahead-of-the-licence`: the executor judges the open-run hold on every collectable observation 2,
  licensed or not, and reports `held` whenever it stands, so a held id never seeds a pair. Only slower.
- `lane-bounds-decided-in-l1`: the offers and the slot's freeing rules are pure functions in the lane's L1 file; the
  slot's state stays in the sweep.
- `start-hold-off-asked-at-the-offer`: no act job is offered within `CHILD_RECLAIM_STALL_MS` of the lane's start, shadow
  included, so a restarted lane's first would-collect waits eight minutes; the executor asks no hold-off. Only slower.
- `unsettled-bound-counts-from-the-queue`: the unsettled bounds (twice the 90 s row, and `CHILD_RECLAIM_STALL_MS`) count
  from the lane's enqueue of the call or job, not from ccd's composition.
- `a-thrown-job-reads-as-no-document`: a rejected job or learning audit is folded as an audit with no document; a thrown
  act job keeps the slot and its id until `CHILD_RECLAIM_STALL_MS` after it settled, since its composition time is
  unknown.
- `collect-act-cap-after-last-await-pinned`: a textual pin of step 6. The act job asks `COLLECT_CAP` at least twice, and
  the last ask follows the job's last await and precedes the argv's statement.

**R86 (the gates).**
- `pass-reads-its-switches-in-its-gather`: the pause read "at the pass's start" is the registry listing inside the
  pass's one gather, before any audit, so an unlistable registry's clear is reachable at the pass.
- `unplaced-witness-instant-holds`: a collectable document whose witness names a run but carries no instant holds under
  (c)'s word, `run-after-witness`, because whether that run minted the temp root cannot be said.
- `audit-gate-refusal-clears-as-caps`: the one audit site refuses when `ws-audit` is not advertised; that refusal is
  reported as a missing capability and clears the pairs as one. A ccd that advertises `collect-v1` never reaches it.
- `ccdargv-collect-docstrings-rewritten`: `ccdargv.ts`'s two docstrings that said nothing composes `ws-collect` and
  nothing reads `COLLECT_CAP` were rewritten, line for line, in the commit that composes the verb.

**R87 (pacing).**
- `collector-l1-imports-the-formula-file`: the lane's L1 file imports `../../shared/api.js` and `./childReclaimSweep.js`
  and nothing else, one way, and the pacing suite pins exactly those two.
- `changed-recently-without-idleat-is-a-deferral`: a `changed-recently` whose `idleAt` is not a finite non-negative
  integer advances the deferral count instead of clearing it, so the leaf is not re-walked every pass.
- `failing-run-stays-on-the-tier-once-entered`: a failing run marked stuck by a per-leaf deterministic answer stays on
  the tier until the run clears, so a later load-sensitive answer cannot take it off.
- `unreadable-and-unknown-verdict-are-failures`: an unreadable document and an exit-0 verdict word the reader does not
  know each advance the failing run, as §16 now says.
- `verb-terminal-refusal-advances-the-terminal-run`: a verb refusal or failure whose word is terminal advances the
  terminal run, ahead of the refusal and verb-failed rows, as §16 now says.
- `continuity-measured-answer-to-answer`: a span "continuously past" is measured from a streak's first answer to its
  latest, never to now, and is inclusive at the span.
- `hold-and-presence-continuity-survive-observations`: a collectable observation never ends the hold's or presence's
  continuity, since a held id is re-observed between holds; every other answer, and every act outcome, ends both.
- `collect-sweeping-is-the-overtaken-guard`: the one-pass-at-a-time `collectSweeping` guard spans the gather, so no pass
  counter is added, as §16 now says.
- `budget-test-pins-the-read-values`: `collect-audit-budget.test.ts` pins the six values it reads (30, 10, 30, 3, 8 and
  90) as well as the inequality, so a change to any bound reds it and the sum is argued again.
- `flock-unavailable-takes-no-floor` (H13): a `flock-unavailable` die takes no refusal floor and starts no die streak.
  It latches box-wide instead and waits the ramp alone.
- `would-collect-ends-the-die-streak` (H13): a shadow would-collect ends a recurring die's streak, as every act outcome
  but the same die does.
- `terminal-refusal-keeps-the-refusal-floor` (H13): a verb refusal whose word is terminal advances the terminal run and
  keeps the refusal row's deferral and floor beside it.
- `terminal-failure-clears-the-deferral-count` (H13): a verb failure whose word is terminal (`failed quarantine-kept`)
  advances the terminal run and clears the deferral count, as every other verb failure does.

**R88 (attention and the feed).**
- `collect-many-arm-declared`: the collapsed per-id collector line is a new L0 arm, `ChildReclaimCollectMany`, whose word
  begins `collect:`, declared in the one rewrite of the attention union's last line.
- `clips-clause-wrapped-in-one-sentence`: the leaf's clips clause is carried verbatim inside one wrapper sentence that
  is true of both of its shapes.
- `stuck-end-exported`: `childReclaimStuckEnd` gains the `export` keyword and nothing else.
- `unvouched-line-waits-the-ceiling`: ids held because the database cannot vouch for their runs join the one box line
  once held past the ceiling, the rule every per-id hold keeps.
- `no-run-lines-share-one-label`: run-less collector items over the limit share ONE `no-run` line, with one clause per
  word.
- `box-probe-line-clears-on-a-passing-answer`: a box-wide probe line stands until an answer passes every rung.
- `reclaim-kept-many-member-with-a-clause-stays-single`: a reclaim kept-many member carrying a second clause leaves the
  line and stays single, and the rest are relisted.
- `watch-interim-empty-collector`: until the lane's sweep landed, the publish call passed `CHILD_RECLAIM_COLLECT_NONE`.

**R90 (the carried list).**
- `census-title-control-pins-its-width`: the kept-word census's retitle is held by one CONTROL line. A double-quoted list
  is outside the census, as its title says.

**R91 (the L0 edits).**
- `attention-doc-pair-counts-the-collector`: `ChildReclaimAttention`'s doc pair was rewritten in place, line for line,
  so it counts the collector's arms; no README anchor moved.

**R92 (amendments).**
- `r92-section-7-lines-are-section-5-10s`: the four lines R92 lists under §7 lie in §5.10's own residual list, and were
  edited there.
- `spec-stale-sentences-beyond-the-r92-list`: four more sentences of the same class are corrected: §5.10's
  `not-witnessed` paragraph, the "on every pass" device line, the "worst case can exceed" residual, and §7 item 6's echo
  of the old budget figures.
- `collect-lane-prose-pins`: `collect-lane-prose.test.ts` pins the sentences this wave wrote and the stale ones it
  removed. Run 358's prose files are run, never edited.
- `spec-5-8-pause-sentence-untouched`: §5.8's pause sentence is not in R92's list and is pinned by run 358's suites. It
  is read as R86 reads README `:5310`: "child reclamation" covers the collector.
```

The note names exactly the slugs H1–H9 and H13 accepted, plus the plan attack's stated residual `population-cap-bounds-the-lane-not-the-frame`, one sentence each under the R it amends, and no void slug (`hold-count-never-binds`, `hold-off-asked-at-step-6-live-only`, `collect-scan-shape-mismatch`, `refusal-kind-spelled-by-task-2`, `collector-imports-childreclaimsweep`, `ws-collect-cap-entry-is-a-classification`). An R with no departure gets no heading (R82 has none). Measure each sentence against the tip and correct it to the code, never the reverse; a slug a worker recorded beyond these is added only on the coordinator's word. Then:

```bash
sed -n '/^### §16 as built (wave 9, run 380)/,$p' docs/superpowers/programs/child-reclamation-contract.md | grep -cE 'D-[0-9]|[0-9]{4} ?(–|\.\.|-) ?[0-9]{4}'   # 0
sed -n '/^### §16 as built (wave 9, run 380)/,$p' docs/superpowers/programs/child-reclamation-contract.md | grep -cE 'hold-count-never-binds|hold-off-asked-at-step-6-live-only|collect-scan-shape-mismatch|refusal-kind-spelled-by-task-2|collector-imports-childreclaimsweep|ws-collect-cap-entry-is-a-classification'   # 0
```

- [ ] **Step 6: Run the prose test: GREEN.**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-lane-prose.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run every prose and citation suite the edited sentences touch.** None of these is edited by this task, except the new file.

```bash
cd server && ./node_modules/.bin/vitest run test/collect-lane-prose.test.ts test/expiry-lane-prose.test.ts test/dead-coordinator-prose.test.ts test/pools-prose.test.ts test/child-reclaim-prose.test.ts test/ws-collect-prose.test.ts test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored|CITATION DEBT|README HAS ITS OWN CENSUS|THE RANGE BOUND'
```

Expected: PASS. Each suite and the sentences it pins:
- **`expiry-lane-prose.test.ts:44`** (`and the expiry of archived workspaces stops too`) and **`dead-coordinator-prose.test.ts:51`** (`…stops too, as does the dead-coordinator lane`): README `:4201`. Both substrings survive Step 4 (c) byte for byte.
- **`expiry-lane-prose.test.ts:45`** and **`dead-coordinator-prose.test.ts:52`**: the untouched `:5310` row.
- **`expiry-lane-prose.test.ts:73-75`** and **`dead-coordinator-prose.test.ts:108-109`**: the untouched spec §5.8.
- **`pools-prose.test.ts:868`**: the CLAUDE.md:10 numeral, kept within 100 lines of README's length (Step 4 (g)).
- **`child-reclaim-prose.test.ts`**: CLAUDE.md's `ws-reclaim` SAFETY bullet and README's "A child is not a reap" paragraph (`:3716`, a 900-character slice that ends well above `:3762`). Neither is touched.
- **`ws-collect-prose.test.ts`**: CLAUDE.md's `ws-collect` SAFETY bullet, `agent/CLAUDE.md`, and the skill corpora. None is touched.
- **The four session-hook cases**: README's `shared/api.ts:` anchors (`:7878-7880`, `:7930`). Task 1 inserted only at the foot, so none moved. If one reds, re-anchor it BY CONTENT in this commit, and say so in the wave-done.

- [ ] **Step 8: Mutation table.** Apply each mutation alone, run `./node_modules/.bin/vitest run test/collect-lane-prose.test.ts` from `server/`, see the red, and revert. The red texts were drafted, not measured: measure them.

| # | Mutation | Expected red |
|---|---|---|
| T9.1 | README `:5307`: restore `and nothing composes it yet` | "no sentence says the verb is inert…": `nothing composes it yet: expected '…' not to contain 'nothing composes it yet'` |
| T9.2 | README: delete the checklist's third item (the box-wide line) | "carries the four-item checklist…": `expected '…' to contain 'except the one for temp roots whose runs the coordination database cannot vouch for, which may stand once you have read it'` |
| T9.3 | README `:4201`: drop `, and so does the temp-root collector’s lane (…)` | "names the collector among what the cleanup pause stops…": `expected '…' to contain 'and the expiry of archived workspaces stops too, as does the dead-coordinator lane, and so does the temp-root collector’s lane'` |
| T9.4 | Spec (f): restore `about 79 seconds, and 94 at the widest grace` | "the audit budget pays one grace…": `expected '…' not to contain 'about 79 seconds'` |
| T9.5 | Spec (g): restore one `Carried to wave 9's pre-flight list.` | "§5.10 describes the lane as built…": `arried to wave 9's pre-flight list: expected '…' not to contain "arried to wave 9's pre-flight list"` |
| T9.6 | Spec Appendix A: put back `shared/api.ts:3856-3857` | "Appendix A cites the presence constants…": `expected '…' to contain 'export const PRESENCE_REFRESH_MS = 15_000;'` |
| T9.7 | Contract: add a deviation token (the letter D, a hyphen and four digits; type it in the scratch edit only, never in a committed file) to one sentence of the note | "carries the wave’s as-built note…": `expected '…' not to match /\bD-\d/` |
| T9.8 | Spec (c): put `None is composed within eight minutes of the server's start.` in place of the offer's hold-off sentence | "states the offer order…": `expected '…' to contain "No act job, shadow's would-collect included, is offered within eight minutes of the lane's start."` |
| T9.9 | README: put back `none in the first eight minutes after the server starts` in place of the offer's hold-off clause | "says the lane composes it…": `expected '…' to contain 'no act job, shadow included, is offered in the first eight minutes after the server starts'` |

Revert each, then re-run Step 6: green.

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md README.md \
  docs/superpowers/programs/child-reclamation-contract.md server/test/collect-lane-prose.test.ts
git add CLAUDE.md   # only if Step 4 (g) changed the numeral; otherwise this adds nothing
git diff --cached -- CLAUDE.md | grep '^[-+][^-+]' | grep -v 'README.md` (~' && echo "CLAUDE.md staged beyond the :10 numeral: unstage it" || true
git commit -F - <<'EOF'
docs(collect): the temp-root collector's lane as built, shadowed, and the checklist before arming it

The spec's §5.10 now describes the lane wave 9 built, instead of the design
it was to be built to. It covers the population from the two registry
listings and the one id predicate, two observations of one token before one
act, the capability, pause, presence and open-run gates, the lane's own
pacing and slot, and what it shows. §5.2 and §8 say the lane composes the
verb, shadowed behind a file nothing in the tree writes. The audit's budget
pays one kill grace, about 73 s or 78 s at the widest grace, and the old
79/94 s figures are corrected in §5.10 and §7. The residuals carried to this
wave's pre-flight say where each went, and §7 lists the residuals wave 9
carries as built. Appendix A's presence citation points at the lines that
hold the constants.

README's collector paragraph loses "shipped inert" and every "nothing
composes it". A new paragraph says how the lane runs shadowed and armed, and
lists the four checks to make before arming it. The cleanup pause's sentence
names the collector, keeping the words the expiry and dead-coordinator prose
pins read; the cleanup-pause row is unchanged.

The rulings file gains "§16 as built (wave 9, run 380)", which names each
departure by slug. A new prose suite pins the sentences written here and
the stale ones removed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

---

### Task 10: Whole-branch verification and the PR

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified, unless Step 3 re-measures a citation census, which then goes in its own `docs(census)` commit.

- [ ] **Step 1: The FIRST full run after implementation, in the foreground**

This run's verdict is the wave-done's `suite:` line (worker clause 15). Record it before any fix.

```bash
cd server && npm ci && find test -name '*.test.ts' | wc -l
cd server && ./node_modules/.bin/vitest run --shard=1/24      # … through --shard=24/24, one call each, timeout 600000 ms
cd agent  && npm ci && npm run test
cd pwa    && npm ci && npm run test
```

- Use ONE denominator for the whole set. If a shard overruns 600 s, re-run the whole set at `/48`. Check that the shards' `Test Files` lines sum to the `find` count.
- Re-run a CLAUDE.md load flake in isolation before calling it a break.
- A red that a clean checkout of `origin/main` also shows is reported once as `main-red`.
- The PWA is untouched, and must be green unchanged. That proves the widened attention union and the box-wide labels need no PWA edit.

- [ ] **Step 2: Type-check, build, and the deviation and token cross-checks**

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p .
cd pwa    && npm run build
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/single-definition.test.ts test/topology-clean.test.ts test/lifecycle-refusal-word.test.ts test/verb-gate.test.ts test/ws-collect-wiring.test.ts test/ws-collect-prose.test.ts test/typecheck-tests.test.ts
git log origin/main..HEAD --format=%B | grep -cE 'D-[0-9]'
git log origin/main..HEAD --format=%B | grep -cE '[0-9]{4} ?(–|\.\.|-) ?[0-9]{4}'
git diff origin/main...HEAD | grep -nE '^\+.*D-[0-9]+ ?(–|\.\.|-) ?(D-)?[0-9]+'
```

Expected:
- every type-check and build exits 0;
- the vitest files PASS;
- both `grep -c` lines print `0`;
- the last line prints nothing.

- [ ] **Step 3: The citation tax, ownership and the README size**

```bash
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts test/pools-prose.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored|CITATION DEBT|README HAS ITS OWN CENSUS|THE RANGE BOUND')
```

Expected: PASS.

- [ ] **Step 4: The hard boundary**

```bash
git diff --name-only origin/main...HEAD | grep -vE '^(server/src/|server/test/|shared/api\.ts$|README\.md$|CLAUDE\.md$|docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design\.md$|docs/superpowers/programs/child-reclamation-contract\.md$|docs/superpowers/plans/2026-10-11-child-reclamation-wave9-collector-lane\.md$)'
git diff --name-only origin/main...HEAD -- ccd/ agent/ pwa/ deploy/ server/src/coord/schema.ts server/src/archivedExpiry.ts server/src/coord/expireArchived.ts server/src/deadCoordinator.ts server/src/coord/endDeadCoordinator.ts
git diff origin/main...HEAD -- CLAUDE.md | grep '^[-+][^-+]' | grep -v 'README.md` (~' || true
```

Expected: the first two print nothing; the third prints nothing (only line 10's numeral may change).

- [ ] **Step 5: Push and open the PR.**
  - The title is "Child reclamation wave 9: the temp-root collector's server lane, shadowed".
  - The body lists:
    - the tasks and the boundary;
    - that the lane ships SHADOWED, and the operator's Before-arming checklist (R82);
    - the suite verdict;
    - each stated residual;
    - each departure, by slug;
    - the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
  - The body has no box path and no docserver link.
- [ ] **Step 6: The wave-done**, per the worker skill, sent in the same turn as the push. CI is the coordinator's re-measure; never end a turn to wait for it.

---

## Review lenses

These lenses run IN ADDITION to the held-out panel (`ccd/coordinator-skill/references/review-panel.md`), which runs as written (coordinator clause 14). Every finding gets the panel's refuters. A lens that dies or returns nothing is unverified, never approval. Every scratch case uses fakes or fixture HOMEs only.

### 0. SAFETY: what `ws-collect` is licensed against (opus, xhigh, MANDATORY)

This is the destructive subject alone. Read these at the tip, against `origin/main`:
- `collectTempRoot` whole, and `collectOpenRunHold`;
- `learnCollect`, `collectSwitches` and `readCollectPopulation`;
- `sweepTempRootCollect`, the slot, the start hold-off and the generations;
- `collectPopulation`, `isTmpRootId` and `parseCollectRecordName`;
- `parseCollectAudit` and `parseCollectResult`;
- the one `CCD_ARGV.wsCollect(` site.

**Re-derive:**
- **The licence.** For every route to the argv, construct: a pause raised at each of the three reads; the registry unlistable; shadow, and a marker flip at each point of a job (including a lane constructed with the marker standing); a capability lost at step 1 and step 6; presence at step 3 and step 6; a run opened or bound during the audit; an absent run; a run opened after the witness's `at` plus skew; a re-bound child; a resume document with and without a witness; a recycled spawn between the observations; a stale answer after each kind of reset; a dash-leading, dot-leading or 256-character id; and a restart. None may compose `ws-collect`, and none may act on a leaf other than the one observation 2 judged.
- **The slot.** It is freed by every settled job that composed nothing, and held only by an act with no document of arm 2 or 3; the start hold-off holds.
- **No silent wedge.** Every per-id hold, defer and run ends in attention or a bounded pace.

### 1. SECURITY (opus, high, MANDATORY)

- planted names in both listings: argv injection, length, newline, a name equal to a live id, a record name parsing to a live id, a flood of names;
- the audit's UNCUT stdout `detail`, `paths`, `collect.leaf` and record names: every one reaches a sentence only through `childReclaimDetailText`, with `detailUnsafe` covering Cc, Cf, Zl, Zp, Cs, U+034F and the tag block, and the 2048 cut;
- the lstat and readdir over the agent wire and in local mode;
- confirm that no other builder in the wave puts a listing-derived id after a flag-scanning parse (R90).

### 2. Derivation and wire (opus, high)

- every new type and its single definition (`isTmpRootId`, `CollectToken`, the attention arm, `COLLECT_BOX_LABELS`, the marker);
- the probe-class table pinned in both directions against ccd;
- the attention union's new arm and the box-wide items rendering with no PWA edit;
- wave 8's reclaim answers unchanged: only `childReclaimTierFrom`'s `export`, the clips clause, the precedence and the two sentences change there;
- additive-only and absence-permits for every ccd field the lane reads.

### 3. Pacing and cost (sonnet, high)

- the deferral count and the three runs: advance and clear rules, and the latest-of next ask;
- terminal re-asks at most 12 in the first 24 h and 6 a day after, with alternation;
- verb refusals at most 96 a day per id;
- `changed-recently` scheduled from `idleAt`, with its clamp and its non-finite arm;
- at most two learning audits and one act per pass; the per-pass agent load; the 90 s audit row's inequality.

---

## Deviations found

This wave's numbers come from the blocks the allocator issued for run 380, listed singly in the coordinator's evidence archive (`wave9/block-numbers.txt`). The coordinator assigns them at the fix round: one per departure, each defined here, singly. A departure the worker finds is named by slug in the wave-done.

Numbers are ISSUED, never chosen. Run 380's two blocks were allocated by the coordinator on 2026-10-11: thirty-two single numbers, 4788, 4789, 4790, 4791, 4792, 4793, 4794, 4795, 4796, 4797, 4798, 4799, 4800, 4801, 4802, 4803, 4804, 4805, 4806, 4807, 4808, 4809, 4810, 4811, 4812, 4813, 4814, 4815, 4816, 4817, 4818 and 4819. Twenty-nine more were allocated for the first fix round, on 2026-10-12: 4828, 4829, 4830, 4831, 4832, 4833, 4834, 4835, 4836, 4837, 4838, 4839, 4840, 4841, 4842, 4843, 4844, 4845, 4846, 4847, 4848, 4849, 4850, 4851, 4852, 4853, 4854, 4855 and 4856. That is sixty-one single numbers. None is written as a range. Every one of them is defined below, once each, so nothing is held in reserve. Fifty-one entries are substantive departures, one number each, and ten are shared, one for each of the ten tasks, for that task's plan-text corrections and extra pins.

- The worker never calls the allocator (worker clause 11; coordinator clause 10).
- A departure from this plan is named by a short kebab-case slug in the wave-done mail. It is never given a number by the worker.
- The worker writes no `D-` token for a number that `origin/main` does not define, and puts none in a commit message.
- The coordinator assigns each departure a number and defines it here, number and definition in one act. Each substantive departure gets its own number; each task's plan-text corrections and extra pins share one.
- A new substantive departure that a later round finds is named by slug in that round's wave-done, and the coordinator allocates its number.
- A sentence of this plan's body that a fix round made false is not edited. The plan's text is corrected by the entry that names it, and the entry's sentence says what changed.

### Substantive departures, one number each

- **D-4788** (Task 1) `collect-many-arm-declared` — §16 had a collapsed per-id collector line use `kind: 'kept-many'` with a word no other line uses, and listed the union line, the `runId` sentence and the predicate's declaration as `shared/api.ts`'s edits, and as built the line is a second L0 arm, `ChildReclaimCollectMany` (`kind: 'kept-many'`, a word typed `` `collect:${string}` ``, members that carry a numeric run), declared at the file's foot and joined to the union in the same one rewrite of its last line as `ChildReclaimCollectAttention` (plan :350), so the union line is rewritten once and Task 5 declares nothing in L0.
- **D-4789** (Task 2) `exists-not-carried` — §16's audit reader carried `resume`, `exists`, `collect.idleAt`, `collect.leaf` and `collect.witness`, and as built `CollectAudit` carries every one of them but `exists`, because nothing gates on it.
- **D-4790** (Task 3) `junk-quarantine-names-are-refused-names` — §16 counted a name that fails the id predicate and never carried it, and did not say what a quarantine name that is no record is, and as built a non-dot name in `tmpquarantine` that `parseCollectRecordName` reads as no record of an id the lane may take (junk, or a dash-leading id's record) is counted in `refusedNames` exactly as a refused witness name is, and never becomes an id.
- **D-4791** (Task 3) `population-ids-and-candidates-split` — §16 made the population the witnessed ids together with the record ids, had the pre-filter skip some of them, and did not say which set forgetting reads, and as built `CollectPopulation` carries `ids` (every id a measured listing names, which forgetting reads) apart from `candidates` (`ids` less the registry pre-filter, which the offers read), so an id the pre-filter skips keeps its pacing and its feed episodes and is never forgotten for being skipped.
- **D-4792** (Task 3) `population-cap-counts-the-raw-listing` — §16 put the 1024-name cap after the drop of dot-leading names, and as built `collectPopulation` counts the raw listing, dot-leading names included, so a flood of a writer's temp names reads unmeasured too; the executor's read has already dropped non-string names, so those are not counted, and the rule is only stricter.
- **D-4793** (Task 4) `a-stale-answer-paces-but-never-observes` — §16 said a stale answer is discarded, and as built a stale answer is never an observation but is still paced: `collectAfterAudit` with `observes` false resets the pair under a new generation and applies the answer's runs, counts and floors as any answer's, because discarding the pacing too would let each lane-wide clear that lands between a terminal audit's compose and its answer buy one more journaled terminal audit, without bound.
- **D-4794** (Task 4) `observation-wait-in-the-next-ask` — §16, as Task 4 was drafted against it, gave an id holding observation 1 no wait of its own, and as built `collectNextAskMono` also waits for observation 1's arrival plus the observation interval, so a holder is next due exactly at its ripening instant and is offered the act job then, never a learning audit that could only repeat observation 1; §16's final text adopted it as the ripening instant, and it is only slower.
- **D-4795** (Task 4) `changed-recently-without-idleat-is-a-deferral` — §16 said a `changed-recently` with no usable `idleAt` takes the deferral wait, and as built it advances the deferral count (`collectIdleSchedule` answers `no-idle-at` for an `idleAt` that is not a finite non-negative integer), because a `changed-recently` that cleared the count and then waited the ramp over zero would re-walk the leaf every pass.
- **D-4796** (Task 4) `failing-run-stays-on-the-tier-once-entered` — wave 8's `childReclaimTierFrom` derives tier membership from the `stuck` argument of each call, and as built a collector run's `stuck` mark, set when an answer enters it on the tier at once (a per-leaf deterministic probe, or any terminal answer), stays set until the run clears, so a later load-sensitive answer cannot take the run off the tier.
- **D-4797** (Task 4) `unreadable-and-unknown-verdict-are-failures` — §16, as Task 4 was drafted against it, called an unknown verdict a retry, never spent, with no pacing row for it or for an unreadable document, and as built each advances the failing run (never spent, asked again on the ramp, and listed at the tier), as an unknown probe word does; §16's final text says so.
- **D-4798** (Task 4) `verb-terminal-refusal-advances-the-terminal-run` — §16, as Task 4 was drafted against it, paced a verb refusal on the refusal row and a verb failure on the verb-failed row whatever the word, and as built a verb refusal or failure whose word is terminal by the verb's own refusal table (`collectRefusalClass`) advances the terminal run ahead of those rows, so `failed quarantine-kept` never advances the verb-failed run; an agreement case holds the audit's and the verb's tables to one reading of each word, and §16's final text says so.
- **D-4799** (Task 4) `continuity-measured-answer-to-answer` — §16 lists an id once an answer stands "continuously past" a span, and as built the span is measured from a streak's first answer to its latest, never to now, and is inclusive (`collectAttentionCauses`), so a cause stands only on evidence, and attention reads no clock (`collectAttentionItems` carries its `nowMono` unread).
- **D-4800** (Task 4) `hold-and-presence-continuity-survive-observations` — §16 said the hold and presence each keep their own continuity clock and did not say what ends one, and as built a `collectable` observation ends neither (a held id is re-observed between holds), while every other answer, every act outcome and a would-collect ends both, and a hold ends presence's clock and a presence defer ends the hold's; the alternation this allows was ruled not a finding at fix round 1.
- **D-4801** (Task 4) `flock-unavailable-takes-no-floor` — §16 gave every recognised pre-lock die but `flock-unavailable` the refusal floor and had that one latch box-wide, and as built a `flock-unavailable` die is a deferral alone: it takes no floor and starts no die streak (it ends a standing one), while the latch stops every act job for the process and a box-wide line says so.
- **D-4802** (Task 4) `would-collect-ends-the-die-streak` — §16 lists the same die recurring past the ceiling as attention without saying what ends its streak, and the plan ended it at any other answer or act outcome (plan :2552), which leaves shadow's would-collect unnamed, and as built `collectAfterWouldCollect` ends it, as every act outcome but the same die does.
- **D-4803** (Task 4) `terminal-refusal-keeps-the-refusal-floor` — §16 put a terminal verb refusal ahead of the refusal row, and as built it advances the terminal run and keeps the refusal row's deferral count and refusal floor beside it.
- **D-4804** (Task 4) `terminal-failure-clears-the-deferral-count` — §16 put a terminal verb failure ahead of the verb-failed row, and as built `failed quarantine-kept` advances the terminal run and clears the deferral count, as every other verb failure does.
- **D-4805** (Task 4) `collect-fresh-returns-boolean` — the plan typed `collectFresh` as a type predicate (`e is CollectEntry`), and as built it returns a plain `boolean`, because its false arm means forgotten OR stale, and a consumer narrowing on it would read a stale answer's entry as absent and drop the pacing `a-stale-answer-paces-but-never-observes` keeps; a case in the test project reds the predicate form.
- **D-4806** (Task 4) `a-refusal-or-die-episode-outlives-observations` — the plan let an observation end every feed episode but a would-collect of its own token (plan :4059), so a refusal or a die that persisted wrote a feed row every cycle, against the plan's "one row per (id, word) episode, quiet on repeats" (plan :2556), and as built, from fix round 1, a refused or die act episode, `flock-unavailable` included, outlives observations: `collectFeedCueOfAct`'s refused and die arms mark their row cue `outlivesObservations`, the entry keeps the flag beside its episode (`feedOutlivesObservations`), and `collectFeedStep` keeps such an episode at an observation, so it ends only at a row cue of another key (an audit answer, an act outcome or a would-collect), at forgetting the id, or at a restart; every other episode ends at an observation as before, nothing is classed by parsing a key, and the pacing and the die streak are unchanged.
- **D-4807** (Task 4) `collector-l1-imports-the-formula-file` — the wave's brief had the lane's L1 file import `shared/api.js` only, while §16's pacing imports wave 8's formula, and as built `collectLane.ts` imports exactly `../../shared/api.js` and `./childReclaimSweep.js`, one statement each and one way (that file never imports this one), and the pacing suite pins the two specifiers.
- **D-4808** (Task 5) `clips-clause-wrapped-in-one-sentence` — §16 had a winning item carry a leaf-kept item's clips clause verbatim as its second clause, and as built the clause, in either of its two shapes, is carried verbatim inside one wrapper sentence true of both (`childReclaimClipsSecond`: "Also, an earlier reclaim of this id may have left a clips directory on disk: <clause>. ccrc never removes the clips directory; a person removes it once nothing still uses it.").
- **D-4809** (Task 5) `terminal-collapsed-and-count-lines-past-tense` — the plan's collapsed terminal lead (plan :5477, "ccd’s last answer for its temp root was terminal; each is listed for you to look at, and the feed row of each names ccd’s word and what it found.") and its run-less count prefix (plan :5286, "<n> answer <word>") are false once a later `collectable` leaves the terminal run standing, and as built they read "ccd has answered its temp root with a terminal word, so it is listed for you to look at; its feed row names that word and what ccd found." and "<n> are listed under <word>", true in every state as the plan's ruling H8 requires; a case folding terminal then collectable through the projection, the items and the merge, past the collapse limit, reds on the old text.
- **D-4810** (Task 5) `count-line-word-through-detail-text` — the plan's count line interpolated its word raw (plan :5286), and as built the word goes through `childReclaimDetailText`, byte-identical for every real word, because the merge is an exported L1 seam typed `string`; a hostile word passed straight to the merge reaches the line escaped.
- **D-4811** (Task 5) `a-registered-id-projects-no-item` — the plan projected every remembered id (plan :4358, each entry mapped through `collectAttentionViewOf`), and as built `collectAttentionViews` hides every per-id item of an id whose exact `<id>.child` or `<id>.uuid` registry row stands in the listing the last measured pass's pre-filter read (through the one helper `collectRowStands`) while the MEASURED `tmpquarantine` names no record of it. Such an id, a reused slug's live workspace, projects no terminal, verb-failed, die, failing, in-use, held (the unvouched box line included), in-progress, registered, presence, changed-recently or would-collect item, which narrows the plan's ruling H8 that a terminal item stands while the terminal run stands; its pacing memory is kept, so the item returns as it stood once the row goes, and nothing is hidden because an id is merely absent from a listing in doubt. From fix round 1 the hide applies only while `tmpquarantine` is measured, through one exported L1 helper, `collectRecordsInDoubt` (true when the population's doubts name `tmpquarantine`, unmeasured or over its cap; an absent listing counts as measured), which the records-subsumed rule in `collectAttentionItems` reads too: while the record listing is in doubt, every such id's items stand as remembered, the `quarantine-kept` item and its second clause on a reclaim item included, the accepted stale item during the doubt. Candidates still exclude a registered id, so no audit or act changes.
- **D-4812** (Task 5) `unvouched-line-waits-the-ceiling` — §16 collapsed ids held because the coordination database cannot vouch for their runs into one box-wide line and did not say when a held id joins it, and as built such an id (held as `run-absent` or `run-after-witness`) joins the `unvouched` line under the rule every per-id hold keeps, once held for the ceiling from its first hold to its latest; its next ask waits the ceiling flat, so the line appears at its second hold.
- **D-4813** (Task 5) `no-run-lines-share-one-label` — §16 collapsed run-less items of one word past the limit into one box-wide count line, and as built run-less items of every word past the limit share ONE line under the `no-run` label, one clause per word, because the banner keys each line by its label and two lines under one label would be a duplicate key.
- **D-4814** (Task 5) `box-probe-line-clears-on-a-passing-answer` — §16 said when a box-wide probe's line stands and not when it ends, and as built `collectBoxProbesAfter` keeps each box-wide probe's latest detail until an answer that passed every rung (`collectable`, a `changed-recently` verdict, or a `collected` act) clears them all, while a per-id answer leaves them standing; the final fix wave also clears them once both listings are measured and the population holds no id (`box-lines-clear-when-their-ids-leave`), and fix round 1 lets no answer older than the probes' latest change clear them (`older-answer-never-clears-a-newer-probe`).
- **D-4815** (Task 5) `reclaim-kept-many-member-with-a-clause-stays-single` — §16's rule that an item carrying a second clause never joins a collapsed line did not say it reaches wave 8's reclaim `kept-many`, and as built it does: a member that would carry a collector `quarantine-kept` sentence or a clips clause leaves the line as a single `kept` item with its skip sentence and the clause, and the rest are relisted through `childReclaimKeptList`, so they collapse again only past the limit.
- **D-4816** (Task 5) `reader-made-words-are-ccrcs` — the plan's `collectSaid` (plan :5444) led every detail "What ccd said:" and its `collectProbeText` (plan :5448) printed a word as it cleaned, so the reader's own words (`unreadable`, `no-document`, and the empty word the verb reader makes) read as ccd's and an empty word printed `()`, and as built, from fix round 1, `collectReaderMade` names those three as this build's reader's words; `collectSaid` takes the word, with no default, and leads "What ccrc saw:" for one of them and "What ccd said:" otherwise; `collectProbeText` reads no word as "no word", `no-document` as "ccd answered nothing", the empty word as "ccrc could not accept ccd’s answer", and a word that cleans to nothing as "a word this build cannot show", so no sentence prints `()`; `parseCollectResult` reads a `failed` document with an empty word as the reader's own ("ws-collect answered failed with no word"); and the feed rows for an audit with no document or an unreadable one, an act with no document, and an act `failed` with an empty word are built by one L1 builder, `collectFeedReadBody`, chosen by kind and never by word. Feed keys, episodes, pacing and gates are unchanged.
- **D-4817** (Task 6) `hold-reported-ahead-of-the-licence` — §16's step 4 compares observation 2 with observation 1 and then judges the open-run hold, and as built `collectTempRoot` judges the hold on every collectable observation 2, licensed or not, and reports `held` ahead of the licence's refusal, so a held id never seeds a pair; only slower.
- **D-4818** (Task 6) `unplaced-witness-instant-holds` — §16's hold for a run that opened after the witness assumed the witness carries its instant, and as built a collectable document whose witness names a run but carries no instant holds under that rule's word, `run-after-witness`, because whether that run minted the temp root cannot be said.
- **D-4819** (Task 6) `audit-gate-refusal-clears-as-caps` — §16 named a missing capability among the lane-wide clears and not the audit site's own verb gate, and as built a step-4 refusal by the one audit site (no `ws-audit` in the box's verb list, or `collect-v1` withdrawn since step 1) answers `not-asked` with the `caps` word and clears the pairs as a missing capability does; a ccd that advertises `collect-v1` never reaches the verb arm.
- **D-4828** (Task 6) `learn-collect-asks-no-id-predicate` — §16 has the id predicate gate the population before any argv and the act job assert it again on its own id at step 1, and as built `learnCollect` does not assert it again: the population's check and the act job's step 1 are the two checks, and a learning audit is offered only to a population candidate.
- **D-4829** (Task 6) `population-reads-tmproots-before-tmpquarantine` — the plan read the two listings "inside the pass's one gather, concurrently" (plan :7268, through `Promise.all` at plan :7274), and as built `readCollectPopulation` reads `tmproots` and then `tmpquarantine`, one after the other, because ccd collects by writing the quarantine record, dropping the witness and then dropping the record, so a record listing taken first could see neither for an id ccd is collecting between the two and forget it once; a read-order case pins it.
- **D-4830** (Task 6) `collect-switches-tells-raised-from-unlistable` — the plan's `collectSwitches` answered `{ paused, live }` alike for a raised `reclaim-paused` and a registry that did not list (plan :7331), with one sentence for both (plan :7252), and as built its paused arm carries `why: 'raised' | 'unlistable'` and steps 2 and 5 word their detail from it, because an adapter may not narrow a distinction it received; both still stop a job alike, and neither is ever shadow.
- **D-4831** (Task 6) `collect-audit-names-its-refusing-gate` — the plan's audit site answered `'not-asked'` from both of its gates (plan :7350 and plan :7352) and step 4 said "the fleet host cannot answer ws-audit" for both (plan :7399), and as built it answers `{ notAsked: 'capability' }` or `{ notAsked: 'verb' }`, and step 4's detail says that `collect-v1` was withdrawn since step 1, or that the box cannot answer `ws-audit`; the outcome and the clear are unchanged.
- **D-4832** (Task 6) `learn-collect-not-asked-keeps-one-caps-word` — the audit site tells its two gates apart, and as built `learnCollect` still answers both as `{ kind: 'not-asked', why: 'caps' }`, because the lane folds both alike (it clears the pairs), no sentence is built from a learning audit's refusal, and widening `CollectLearnAnswer` would reshape the type Task 7 consumes; this answer is the one place the gate's name stops.
- **D-4833** (Task 7) `collect-sweeping-is-the-overtaken-guard` — wave 8's lane guards a late gather with a pass counter, and as built `collectSweeping` is held from before the gather to the end of the decide-and-enqueue, so no pass can start while another gathers and no counter is added (one could never differ, and a guard that cannot fire has no red); the throttle is stamped before the gather and again after it with the decision clock, as wave 8's is, and §16's final text says so.
- **D-4834** (Task 7) `pass-reads-its-switches-in-its-gather` — §16 read the pause at the pass's start, and as built that read is `collectSwitches`' own registry listing inside the pass's one gather, before any audit, because the tick never hands a lane a registry that did not list, so only the lane's own listing can see an unlistable registry and clear the pairs; the pass reads `paused` alone, never the listing's `live`, which is the executor's.
- **D-4835** (Task 7) `a-thrown-job-reads-as-no-document` — §16 named no fold for a learning audit or act job that rejects, and as built such a rejection, a defect the reader could not name, is folded as an audit with no document that observes nothing (the pair resets, and it is paced as a failure), and a thrown act job keeps the slot and its id until `CHILD_RECLAIM_STALL_MS` after it settled, since when it composed is not known; a fold that itself throws is `fold-failure-resets-the-pair-and-floors`.
- **D-4836** (Task 7) `an-answer-for-a-forgotten-id-is-dropped` — §16 did not say what becomes of a call still out when its id is forgotten, and as built forgetting does not wait for it, and its late answer folds nothing for the id, while what it says of the box still counts (the box-wide probes, its pass's tally, an act's word about the box) and so do an act job's lane effects (the slot, the latch), as plan :7758 says. It is narrowed by `a-collected-act-always-writes-its-row`: a `collected` act still writes its feed row, worded from the job's own observation 2, which makes the plan's draft of the as-built note false at plan :10983 ("that call's late answer is dropped").
- **D-4837** (Task 7) `collector-records-unread` — the earlier rulings had the population come through the registry read, and §16 replaced it with the two listings; as built `sweepTempRootCollect(records, names)` keeps its siblings' signature but never reads `records`, and `names` feeds the pre-filter alone.
- **D-4838** (Task 7) `a-collected-act-always-writes-its-row` — the plan dropped every fold for an id forgotten while its job was out, and as built a `collected` act still writes its feed row for such an id: `collectForgottenActRow` (L1) returns, for an `acted` outcome whose result is `collected` and for nothing else, the row a remembered id gets, worded from the job's own observation-2 document (its witness's run and leaf, through `collectEvidenceOf`, now the one derivation of a document's evidence), and the fold writes it and returns, because that row is the operator's record of a deletion the server made, and ccd drops the quarantine record as a collection's last step, so a gather landing in between forgets the id the act just collected.
- **D-4839** (Task 7) `box-lines-clear-when-their-ids-leave` — the plan's pass-scoped box lines (`no-document`, `lock`) stood until a later pass published a tally, and a pass that queues no call publishes none, while its box-wide probes stood until a passing answer, and as built `collectBoxAfterPopulation` (L1), applied on every measured pass, drops the pass-scoped lines once none of their ids is still a candidate and clears the probes once the population holds no id, so no line stands on evidence no later answer can clear (a stale line blocked the arming checklist until a restart), and a paced id that is still a candidate keeps its line, so nothing flickers. Review 386 questioned the probe clear, and it was accepted: with both listings measured and no id left, nothing carries the condition, the line is memory only, and the next id's first audit raises it again before any observation can form. It retires `pass-scoped-box-lines-stand-until-the-next-call`.
- **D-4840** (Task 7) `box-line-clears-need-both-listings-measured` — the fix wave's brief asked only the probe clear to wait for a measured population, and as built both of `collectBoxAfterPopulation`'s clears need both listings measured (`bothMeasured`), as forgetting does, because each reads an absence; an unmeasured listing changes nothing.
- **D-4841** (Task 7) `fold-failure-resets-the-pair-and-floors` — the plan's act job only logged a fold that threw (plan :9563), so a fold that failed after observation 1 left the pair standing, and as built, from fix round 1, that `.catch` first applies one pure L1 transition, `collectAfterFoldFailed`, to the id's entry when it stands: observation 1 is dropped, the pair resets under a new generation, the id takes the refusal floor, and nothing else moves, because the lane does not know what the job did. The warning keeps its text and adds the reset and the ceiling wait, or, for an id forgotten while the job was out, that nothing is reset; the slot is left as it was, and the learning audit's and the tick's catches are untouched, since neither can leave a pair standing. Without the floor, a fold defect that recurred on every act would license a `ws-collect` about every two passes per id, about 720 a day against the 96 the pacing allows.
- **D-4842** (Task 7) `older-answer-never-clears-a-newer-probe` — the plan applied each answer's word about the box when its fold ran (plan :9617 and plan :9634), so an act job's observation-2 document, folded only when the job settled, could clear a box-wide probe a later audit had raised, and as built, from fix round 1, an answer that arrived before the probes' latest change says nothing of them: `collectBoxProbesAtArrival` (L1) leaves the probes as they stand when the answer's arrival is earlier than their latest change (a tie applies), and otherwise applies `collectBoxProbesAfter` and moves the change stamp to the answer's arrival whenever that returns a new map, a box-wide answer re-asserting a standing probe and any answer that passed every rung included, since each is a newer word about the box, while an answer it returns the standing map for (a per-id probe, a non-passing verdict, no document) never moves it, as the ruling's "(a new reference)" reads; a case pins that a re-assertion moves it; the watcher keeps that stamp beside the probes and folds both the audit and the act result through one helper. The act result's update stays ahead of the forgotten-id return, since it is the only clear for a probe raised between observation 2's arrival and a `collected` act's answer, and the population clear stays unstamped.
- **D-4843** (Task 7) `lane-bounds-decided-in-l1` — the plan's fixed interface named the slot as the watcher's state, and as built the offers (`collectCandidateOf`, `collectOffers`), the slot's freeing rules (`collectJobEffects`) and the learning cap (`COLLECT_AUDITS_PER_PASS`) are pure functions and a constant in the lane's L1 file, so the watcher applies and never decides, as wave 8 did with `childReclaimAskOrder`; the slot's state stays in the watcher, and L1 declares `CollectJobSettled` structurally, since it may not import the executor's outcome type, with a compile pin holding that the outcome is assignable to it.
- **D-4844** (Task 7) `start-hold-off-asked-at-the-offer` — §16 had the lane compose no `ws-collect` until `CHILD_RECLAIM_STALL_MS` after its start and listed the start hold-off among the job outcomes that free the slot, and as built `collectOffers` offers no act job inside that hold-off, shadow's would-collect included, and the executor asks none, so a restarted lane's first would-collect waits eight minutes; only slower.
- **D-4845** (Task 7) `unsettled-bound-counts-from-the-queue` — §16 did not say whether an unsettled call's bound counts from ccd's composition or from the lane's queue, and as built every unsettled bound (twice the 90 s row for an audit, `CHILD_RECLAIM_STALL_MS` for an act job) counts from when the lane queued the call or job, so a call waiting behind another lane's job on the id's queue key counts that wait, and an act job that never starts still raises the slot-held line.
- **D-4846** (Task 8) `cc-tmp-scan-display-only` — §16 had a scan pin that no lane file passes a path spelling `.cc-tmp` to an `io` member or builds one with a path join, and a value handed to `io` cannot be followed across lines as text, so as built `collect-lane-scans.test.ts` pins three textual facts instead: the pass, the lane and the executor spell `.cc-tmp` only as the display form `~/.cc-tmp`, which no `io` call can resolve; no line that holds one calls an `io` member or a path join; and the lane and the executor never read the home directory. A CONTROL shows that the patterns see a built path and an io read and pass over a display sentence.

### Plan-text corrections and extra pins, one number per task

- **D-4847** (Task 1, plan-text corrections and extra pins) `attention-doc-pair-counts-the-collector` (the rewrite of `ChildReclaimAttention`'s doc pair, which §16's list of L0 edits does not name, accepted in the plan's ruling H9: it now counts "the five this file's foot declares (stuck, kept leaves, the collector's)", save the three that share `kept-many`, line for line, so no README anchor moved), `collect-many-word-type-pinned-by-ts-expect-error` (plan :942's T1.11 row, which said the `word: string` mutation "Stays green" and to "Record it as `collect-many-word-type-unpinned-by-a-red` and leave it", is false: a `@ts-expect-error` over an unprefixed collapsed-line word in `collect-l0.test.ts` now reds that mutation as TS2578), `collect-l0-red-at-collection` (plan :674, "vitest resolves a missing named export to `undefined`, so:", predicted per-case reds, and the red was the whole file failing at collection, because `it.each(Object.keys(COLLECT_BOX_LABELS))` throws; the per-case reds were measured through a temporary copy), `step3-attention-case-reds-at-runtime` (plan :680, "the two attention and CollectToken cases pass at run time, because they are compile-time facts", is false for the first attention case, which reads `COLLECT_BOX_LABELS['box-probe']` at run time and reds with a TypeError), `step3-tsc-shape-differs` (plan :694 put the base's TS2578 "on the dated item", and it landed on the forged-token directive, beside a TS18046 and three more TS2322s) and `t1-9-dated-directive-stays-consumed` (plan :940's T1.9 row also predicted a TS2578 on the dated item, which does not appear, because that item's directive is consumed by its own TS2322; the arm's lack of an `at` is pinned by T1.10).
- **D-4848** (Task 2, plan-text corrections and extra pins) `lock-die-mixed-bash-lines-row-added` (plan :1981's T2.17 row said "`a bash line naming another path` reds" when `every` becomes `some`, and it cannot, because with one earlier line the two agree; one row was added, this lock's bash line, then one naming another path, then ccd's line, which must read `no-document` and reds under the mutation) and `t2-16-longer-id-row-reds` (plan :1980's T2.16 row said to "Expect `a longer id…` to stay green under this row alone", and it reds, because the `endsWith` line is the only check of the path).
- **D-4849** (Task 3, plan-text corrections and extra pins) `population-header-in-task-2-style` (plan :2337's block-comment header, `/* ── THE POPULATION (child-reclamation spec §5.10, "the population") ── */`, is written as the file's `// ── the population (spec §5.10, "the population") ───` line, with the same words as `//` lines; no code changed).
- **D-4850** (Task 4, plan-text corrections and extra pins) `licence-header-in-task-2-style` (plan :3624's `/* ── THE LICENCE AND THE PACING (…) ── */` header, written the same way), `presence-null-already-red` (a deferred review note said the `presence: null` in `collectAfterAct`'s `after` had no red; measured, the existing refused-act pacing case already reds its deletion, and the final fix wave widened the pin to every act outcome in `collect-leaving-l1.test.ts`), `r23-sweep-of-contract-and-ruling-tokens` (the plan's code blocks and tables cite contract and ruling ids in comments and test titles, for example plan :6132, against its own Global Constraint at plan :70 that comments and test titles cite the spec, never the contract; one sweep after Task 9 replaced each with the spec section it argues, or dropped it, across every file the wave added or edited, with no asserted string changed, and only `collect-lane-prose.test.ts`'s two reads of the contract file's path and heading keep the word), and fix round 1's pacing pins: rows after the hold-and-presence describe in `collect-pacing.test.ts`, built through transitions from a held setup and a die-plus-presence setup, pin what each answer ends (a terminal word, `not-witnessed`, a deferral, `changed-recently` with and without `idleAt`, a `flock` probe and each failure answer), with a collectable control, and each reds when one return's spread of the ended clocks is dropped; and the test title at plan :3513, "not-witnessed raises nothing and ends nothing it did not clear", which overclaimed, now reads "not-witnessed raises nothing: it clears the three runs, advances the deferral count and ends the continuity clocks, as every answer but a collectable one does, and leaves every floor and the feed episode standing", over a whole-entry `toEqual` from an entry that seeds every field the title names; and `changed-recently-row-uses-a-later-idleat` (the ruled `changed-recently` row with an `idleAt` takes one later than the setup's, because the setup's own `idleAt` gives the same schedule instant at the answer as at the setup, so "the schedule is new" could not be observed). Fix round 2: `CollectEntry`'s docstring said only `collectFeedStep` reads `feedOutlivesObservations`, and `collectAfterAct`'s `collected` arm also carries it, so it now says only `collectFeedStep` decides on it and that arm carries it.
- **D-4851** (Task 5, plan-text corrections and extra pins) `stuck-end-exported` (wave 8's `childReclaimStuckEnd` gains the `export` keyword and nothing else, so the collector's quoted detail ends as the stuck sentence's does), `would-collect-body-calls-collect-who` (plan :5694's `collectFeedWouldCollectBody` spelled its run clause inline, and it calls the shared `collectWho` instead, byte for byte, held by an extra mutation row), `watch-interim-empty-collector` (until Task 7 wired the lane, the publish call passed `CHILD_RECLAIM_COLLECT_NONE`, never an inline object, and the constant stays exported, because `child-reclaim-leaf-kept.test.ts` reads it as the merge's empty collector input), and the comment above the run-less count line in `childReclaimSweep.ts`, rewritten at fix round 1 to say that only a terminal word is ccd's own and every other word is a fixed label of this build, naming them, and that this seam takes any string, so every word goes through `childReclaimDetailText` alike; the escape stays on every word. And fix round 1's shape choices for the hide's gate and the reader-made words: `reasons-hide-row-per-test` (the re-pointed hide case is an `it.each`, one test per row, so each row's red is measured alone), `records-in-doubt-takes-the-doubts` (`collectRecordsInDoubt` takes the population's doubts, not the population, because its two callers hold different objects that carry the same array), `collect-said-word-nullable` (`collectSaid`'s `word` stays required and is typed `string | null`, because a run view's word is null exactly when its detail is, and then no clause prints), `collect-read-what-exported` (`CollectReadWhat` is exported so the tests type their rows from it), a CONTROL lane row (an act `failed` with a non-empty token keeps `collectFeedAnswerBody`), and three one-clause docstrings beyond the three the ruling named (`collectFeedAnswerBody`, and the watcher's `collectAuditBody` and `collectActRow`). Fix round 2: the continuation lines of those two watcher docstrings are indented to sit under their `/**`.
- **D-4852** (Task 6, plan-text corrections and extra pins) `outcome-detail-is-diagnostic` (`CollectJobOutcome`'s docstring now says its `detail` is diagnostic: tests and reports read it and the lane surfaces no sentence from it, so the distinctions only it words, a raised pause from an unlistable registry and a missing capability from a missing verb, are carried to the lane, not shown) and `ccdargv-collect-docstrings-rewritten` (moved here from Task 8 by the plan's ruling H5; as plan :854 says, `wsCollect`'s "Composed by NOTHING" and `COLLECT_CAP`'s "Nothing reads it in this build" were rewritten, line-neutrally, in the commit that composes the verb, and now name its one composer and say the lane asks the capability before every audit and again in the act's own scope).
- **D-4853** (Task 7, plan-text corrections and extra pins) `collect-lane-fields-beside-the-child-reclaim-lane` (plan :7774 put the lane's fields after `deadCoordinatorSerial`, and plan :7776 its accessor after `currentDeadCoordinators()`, both inside regions workspace lifecycle's wave 6 holds; they follow `childReclaimLeaves` and `currentChildReclaimDoneAt()` instead), `older-pass-guard-is-shadowed-by-the-prune` (`collectSettled`'s older-pass guard cannot fire while the tally prune stands, since publishing a pass deletes every tally numbered below it, so deleting the guard alone stays green and the two are pinned as a pair), `t7-38-act-queue-pinned-by-the-registry-listing-count` (plan :9932's T7.38 row predicted a red from the brief's case, and it stayed green, because an unqueued job reaches its own audit only after its step-2 listing; one fixture member, `registryListings()`, and one expectation make it red), `t7-22-reds-as-a-timeout` (plan :9917's T7.22 row predicted "expected 2 to be 1", and it reds as a 20 s test timeout, because the second pass waits on the held gate), `publish-docstring-returns-rewrapped` (in the replacement plan :9386 gives for `childReclaimPublishAttention`'s docstring, the trailing "Returns the kept items it listed, for the feed row." moved onto its own line, to keep line widths), the fix round's lane cases the mutation-table rule asks for (in `collect-lane-pass.test.ts`, a pause seen at step 5, red when the port's `cleared` does nothing, and a learning audit's `not-asked` clearing a standing observation, red when that clear is deleted; in `collect-lane-slot.test.ts`, a learning audit held behind another job on its id's queue raises no line before `COLLECT_AUDIT_STALL_MS` and one line at it, never the act slot's clause, red when the learning arm of the bound is deleted), and the two code comments on the flip row, `collectFeedSwitchBody`'s docstring (plan :5698, "Any same-uid session can touch the switch, so every change is said.") and the `flipped` comment (plan :9714, "so the operator sees every change"), which now say a row is written for each flip an act job sees at its last check, and a change undone between two such reads writes none. And fix round 1's probe-stamp reading and lane-case sequencing: `box-probe-stamp-is-a-new-map` (the stamp moves whenever `collectBoxProbesAfter` returns a new map, a box-wide answer re-asserting a standing probe and a passing answer with nothing standing included, which is the ruling's "(a new reference)"; a content comparison would let an older answer clear a probe a newer one re-asserted, and an L1 row pins the re-assertion), `probes-read-where-they-live-mid-sequence` (the lane cases' mid-sequence preconditions that a probe stands read the watcher's own probe map, because the attention frame is republished only at the child lane's throttled pass; each closing check reads the frame, and reds under its ruled mutation on its own), `f4-answers-arrive-a-whole-interval-apart` (the probe-raising id is learned on a later pass than observation 2, because the rig's clock stands still inside one pass and a tie applies) and `f4-step-5-hold-armed-after-the-probe-pass` (the step-5 listing hold is armed after the pass that raises the probe, because an intervening pass's gather would take it). Fix round 2: a lane case in `collect-lane-leaving.test.ts` pins that a forgotten id's `collected` act still clears a box probe another id raised while the act was out, because the act's box write stands ahead of the forgotten-id return (red when that write is moved behind the return); an L1 row in `collect-attention.test.ts` pins that a passing answer with nothing standing still moves the stamp, so an older raise folded after it is skipped (red when an empty pass keeps the standing state), and the title of the no-change row is narrowed to the answers `collectBoxProbesAfter` returns the standing map for; `CollectEntry`'s and `collectNextAskMono`'s docstrings name the fold-failure floor, whose origin is the fold-failure catch's own clock, beside the verb refusal's arrival; and `CollectBoxProbeState`'s docstring and the watcher field's say the stamp is the arrival of the answer that last rebuilt the probes (a change, a re-assertion or an empty pass), not the one that changed them.
- **D-4854** (Task 8, plan-text corrections and extra pins) `collect-act-cap-after-last-await-pinned` (a textual pin of the act's step 6: the job asks `COLLECT_CAP` at least twice, and the last ask follows its last await and precedes the statement that composes the argv), `budget-test-pins-the-read-values` (the budget suite pins the six values it reads, 30, 10, 30, 3, 8 and 90, beside the inequality, so a change to any bound reds it and the sum is argued again), `census-title-control-pins-its-width` (the kept-word census in `child-reclaim-attention-arms.test.ts` is retitled to what it checks and holds one CONTROL line: a double-quoted list is outside it), `h6-scan-follows-the-reshaped-audit-site` (recorded, not a departure: the provenance and gate scans matched Task 6's reshaped audit site, its `{ notAsked: … }` answers and its `asked` alias, with no pattern changed), `destructive-builder-fence-reads-whole-files` (the fence in `collect-lane-scans.test.ts` reads the whole file of each `ws-reclaim` and `ws-expire` site, not only the site's function, so a collector type at a same-file caller is seen; the plan's case title at plan :10299, "…in a function that names no collector type, reader or the act’s observation", is false and now reads "…names no collector type or reader anywhere, and none spends the act’s observation"; a CONTROL plants a same-file caller and shows the whole-file read sees it while the function read does not; and a real-file mutation row, measured in a scratch copy, plants a `CollectToken`-typed parameter at a caller in `coord/childReclaim.ts` outside the function that holds the `wsReclaim` site, which reds the whole-file check while the site check stays green, so a narrowing of the whole-file check back to the call site is caught by that planted row alone, not by the CONTROL), the fix round's pin that the act slot's bound covers twice `ws-collect`'s remote runner row (read from `remote/runner.ts` with a guard for a missing row, it asserts `CHILD_RECLAIM_STALL_MS` is at least twice the row, greater-or-equal because the constant is shared with reclaim and a raise is only slower; one sentence in `CHILD_RECLAIM_STALL_MS`'s docstring names the collector's three uses of it and the pin; raising the row, lowering the constant and renaming the key each red), and the fix round's rewrite of the archive-door scan's comment in `single-definition.test.ts` to name every vocabulary it excuses (the audit verdict words in `wsaudit.ts`, the collector's open-run hold word `run-open` in `collectLane.ts` and `coord/collectTempRoot.ts`, the docs reader's `worktree-gone`, and the runs board's `className="run-open"`, which the pattern excludes) and to say that the collector's and the docs reader's excusals are by file, so a door code spelled in one of those files is not seen. Fix round 2: the comment over F15's pin gave the wrong threshold (a value below twice the runner row was said to let the bounds fire inside a running `ws-collect`, while the runner kills it at its row plus the client's slack), so it now says that twice the row is margin over the runner's row, its client slack and the job's own steps; the `>=` assertion and the watcher's docstring are unchanged.
- **D-4855** (Task 9, plan-text corrections and extra pins) `collect-lane-prose-pins` (the plan's file lists named no prose test, and a new `collect-lane-prose.test.ts` pins the sentences this wave wrote and the stale ones it removed; run 358's prose files are run, never edited), `r92-section-7-lines-are-section-5-10s` (the four spec lines §16's amendment list calls "§7" lie in §5.10's own residual list, and were edited where they stand), `spec-stale-sentences-beyond-the-r92-list` (four more spec sentences of the same class were corrected: "both are carried to wave 9's pre-flight list", "on every pass", the audit's "worst case can exceed its runner row", and §7 item 6's "about 79 seconds (94 at the widest kill grace)"), `spec-5-8-pause-sentence-untouched` (§5.8's pause sentence is not in the amendment list, is pinned by run 358's suites, and is read as covering the collector, as README's cleanup-pause row is), `no-pass-fails-shut-clear` (the plan listed "a pass that fails shut" among the clears of the observation pairs, at plan :10830 in the spec text, plan :3796 in `collectClearPair`'s docstring, plan :2818 in a test's list and plan :6245 in a fixture's comment, and no such clear exists: the pairs are cleared by a missing capability, a raised pause or an unlistable registry, and a flip; the spec's list dropped the phrase in Task 9's own fix round, the final fix wave corrected the five code and test sites, and §16's earlier lines keep it as history), `flip-rows-are-for-changes-an-act-job-sees` (plan :10935, "each change writes one feed row", and plan :10952, "which is why each change writes a feed row", are false, because the marker is read only at an act job's last check: an act job that finds the file changed since the last such read writes one row, clears every pair and composes nothing, a change undone between two such reads writes none, and an arming writes its row only once the first id is ready to act; README's sentence and checklist item and the spec's "Each flip is seen by the next act job to read the file" are reworded so, and the prose suite reds on the old sentences, with no lane case pinning the narrowing as behaviour), `arming-checklist-names-the-capabilities` (README's "Before arming it" checklist and the spec's "Before arming" list, plan :10864, gain an item saying that `ccd caps` on the box whose ccd the server drives lists both `collect-v1` and `reclaim-pause-v1`, since without either the lane does not run at all, shadow included, so an empty shadow feed proves nothing; it is a fact the operator checks, never a step ccrc enforces; plan :10751's case title, "carries the four-item checklist before arming", named four items over a list of three, Task 9 retitled it three-item, and with this item it is four again), and the refresh of the contract's "§16 as built (wave 9, run 380)" note: a new block, ahead of the population's, names `flip-rows-are-for-changes-an-act-job-sees` and the residual `marker-removal-after-the-last-listing-still-composes`; the forgotten-id line says what `a-collected-act-always-writes-its-row` narrows it to; the box-probe line's clearing is extended; `a-registered-id-projects-no-item` and every other fix-wave and fix-round slug and stated residual are named; a "Plan-text corrections and measured red shapes" line names the corrections; and "Left open for the coordinator's ruling" becomes "Ruled at fix round 1", with all seven items and their outcomes and `pass-scoped-box-lines-stand-until-the-next-call` struck as retired. That refresh makes the plan's Task 9 check at plan :11089 and plan :11093 false: the note no longer names only the slugs the plan's rulings accepted and the plan attack's residual, since it names every fix-wave and fix-round slug and stated residual too; "R82 has none" is false, since the note now has an R82 block; and "no void slug", with the grep at plan :11093 expected to print 0, is false, since the note's closing line names the void `ws-collect-cap-entry-is-a-classification`, so that grep prints 1. The prose suite reads the note with its whitespace flattened before a `not.toContain`, because the file wraps the old sentence and an unflattened check of it could never red. Fix round 2: the note names the two stated residuals the fold added, `failed-flag-not-pinned-at-the-lane` under the refusal-or-die episode rule and `a-ccd-word-spelled-like-a-reader-word-reads-as-ccrcs` beside the reader-made words, so its promise to name every residual is true; the prose suite's slug list carries both, and its corrections list carries the fold's nine per-task slugs, each list red when one of them is deleted.
- **D-4856** (Task 10, plan-text corrections and extra pins) `task-10-shards-run-as-halves-after-an-oom` (plan :11193 says "If a shard overruns 600 s, re-run the whole set at `/48`"; after the box-wide OOM killed the verification subagent mid-run, the 48-shard run's remaining shards ran as explicit halves of the same partition, each call under 600 s, and the partition and its 663-file total are unchanged) and `commit-subject-follows-the-frame` (the plan's commit steps carry `feat(…)` and `test(…)` subjects, for example plan :959 and plan :10624, and each commit reads `child-reclamation wave 9 task N: …`, the implementer frame's style, with the plan's body).

Named, with no number: stated residuals, `population-cap-bounds-the-lane-not-the-frame` (the 1024 cap bounds what the lane audits and remembers, not the listing the agent returns in one frame), `marker-removal-after-the-last-listing-still-composes` (the marker is read once, in step 5's registry listing, with no await before the argv, so a removal after that listing still composes or completes, because ccd never reads the marker), `settle-throw-before-the-slot-write-wedges-the-slot` (a throw inside the act job's settle before its slot write leaves the slot taken with no flight and no line; it needs a defect, and closing it would make that path faster), `a-retryable-refusal-says-once` (a retryable refusal such as `in-use` writes one row and has no attention arm, so ccd may refuse it silently up to 96 times a day), `act-failure-rows-repeat-per-act` (`failed <token>` and an act with no document keep one row per act, since each may have acted; the verb-failed ramp and tier bound them), `would-collect-verdict-collides` (an audit verdict spelled `would-collect <token>` would read as a standing would-collect; pre-existing), `registered-id-with-only-an-unparseable-record-stays-hidden` (a quarantine name that fails the record grammar is a refused name, not a record, so a registered id with only such a record stays hidden, and the refused-names box line counts it and never names it), `failed-flag-not-pinned-at-the-lane` (two mutants of the refusal-or-die episode, the flag set on the `failed` arm and an observation keeping every episode, red at L1 only; the lane case covers a refusal and a die) and `a-ccd-word-spelled-like-a-reader-word-reads-as-ccrcs` (the attention lead is chosen by word, so a ccd word spelled exactly `unreadable` or `no-document` is led "What ccrc saw"; the text is still escaped, and the feed rows are chosen by kind); open items ruled not findings, `hold-presence-alternation-can-starve-attention` (the accepted reading `hold-and-presence-continuity-survive-observations` stands), `collectable-alternation-is-silent` (not a finding as worded; its feed cost is `a-refusal-or-die-episode-outlives-observations`), `lane-silent-without-capabilities` (specified behaviour, which README's checklist and the spec now name) and `flip-row-filed-under-a-job-id` (prescribed, and nothing reads it); retired, `pass-scoped-box-lines-stand-until-the-next-call` (by `box-lines-clear-when-their-ids-leave`), `collect-many-word-type-unpinned-by-a-red` (by `collect-many-word-type-pinned-by-ts-expect-error`) and `projection-hides-items-while-a-listing-is-unmeasured` (by the narrowing of `a-registered-id-projects-no-item`); and void, `ws-collect-cap-entry-is-a-classification` (the plan's ruling H13: at Task 6's shape the entry is load-bearing, and deleting it reds).
