# Consolidation wave, W1a: one switchboard and one notice funnel — `SWITCHES` and `readSwitches`, the `reclaim-paused` readers, the `notify` funnel and its fifteen hand-written pairs (stop-done's excepted), and `dedupeKey` — Implementation Plan

> **For agentic workers:** one PR per task, in the order of §Landing order, each dispatched only when its row in §Gates is all green. To execute a task, REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Steps use checkbox (`- [ ]`) syntax. Workers do not edit §Deviations and decisions. A departure is named by slug in the task's report; the coordinator enters it from this programme's issued block, never the worker.

**Spec:** `docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md` (rev 2, approved by the operator 2026-10-19). §5.1, §5.3 (W1a), K6 (the funnel), K12 (switches), §2.3's switchboard row, §3.19 and §7 bind every task. Read them before Step 0.

**Status:** rev 1 (2026-10-19): rev 0 with two reviews applied (§Review log). **The spec was approved by the operator 2026-10-19**, in their words: "answers locked". Its O1 (d), clicked explicitly, is this wave: "a sliced W0 (only the pins W1a needs), then W1a: `SWITCHES` and the `notify` funnel, without stop-done, after #397 merges". O3 (a) (nothing in flight pauses), O9 (a) (a series lands standalone when its first commit is a characterization pin and its exit is counted) and O11 (a) (the ring stays the catch-up authority, `feed_events` its archive) also bind it. Written in the same docs PR as the spec's rev 2 and the W0 plan (`2026-10-19-consolidation-w0-pins.md`).

**Inputs.** The W0 plan's pins: C0b's census queries, C0c and C0d's feed-writer pin (`server/test/feed-writers-pin.test.ts`), C0e's pause pin (`server/test/reclaim-pause-pin.test.ts`), C0g's symbol slices. `watch.ts` `pushOne` (≈:3106) and its docstring; `coord/rundefs.ts`'s markers (≈:50–72); D-5242's presence contract (`presence.ts` ≈:28); the child-reclaim ruling "every reclaim lands in the feed; no push per reap" (`coord/childReclaim.ts` ≈:1679); expiry's step 6, "NEAREST THE ARGV" (`coord/expireArchived.ts`).

**Base:** `origin/main` `f64c27b65`. Code is cited by file and by function, constant or `describe` title, with `≈` line hints measured at that sha. **#397 merged on 2026-10-19 as `6ae03d2de`** and moved them; hints added in rev 1 are measured at `4bc6c756d` and marked `(4bc6c756d)`. Step 0 of each task re-grounds every hint by content on the tree it starts from.

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
| C1f | identical feed rows, except where the operator rules on a re-sent notice whose body changed (OA-C3) | `feed_events.dedupe_key`; the two body-match `hasFeedEvent` dedupe reads become key reads; the nudge's landing gate stays |

---

## Gates: what each task waits for, stated honestly

Measured on 2026-10-19 at `f64c27b65` with `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,files` (26 open PRs).

- **#397** (path identity W1a) **merged on 2026-10-19 as `6ae03d2de`**. It edited `watch.ts`, `server.ts`, `coord/routes.ts`, `coord/childReclaim.ts`, `coord/expireArchived.ts`, `coord/reclaim.ts`, `coord/dispatch.ts`, `coord/stall.ts`, `shared/api.ts`, `ccdargv.ts` and `single-definition.test.ts`. The gate it held (spec §5.3) is open; every Step 0 re-grounds on the tree after it.
- **#737** (history 5h-1) holds `single-definition.test.ts` at ≈:5237 only (at `f64c27b65`). C1a edits that file's switch-literal blocks from ≈:2280 to ≈:6990 (4bc6c756d; the list is in C1a), C1b the ≈:2347–2351 block and the ARCH-40 tail block, C1e the tail block. C1a's hunks from ≈:4946 onward sit near #737's: C1a's Step 0 measures each against #737's live diff and waits for it if any overlaps; each task re-checks at Step 0.
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
| #397 (**merged** `6ae03d2de`) | was: `watch.ts`, `server.ts`, `coord/routes.ts`, `coord/childReclaim.ts`, `coord/expireArchived.ts`, `coord/dispatch.ts`, `coord/stall.ts`, `shared/api.ts`, `ccdargv.ts`, `single-definition.test.ts` | none now |
| #737 | `server/test/single-definition.test.ts` (≈:5237) | C1a if a hunk overlaps (Step 0 measures) |

No open PR measured on 2026-10-19 holds `server/src/interruptlog.ts`, `server/src/coord/rundefs.ts`, `server/src/coord/collectTempRoot.ts`, `server/src/coord/endDeadCoordinator.ts`, `server/src/coord/store.ts`, `server/src/coord/schema.ts`, `shared/switches.ts` or `server/src/notice.ts`. Each task re-reads every list at Step 0.

## Landing order

```
#397 (merged) + W0 (C0b, C0c, C0d, C0e, C0g)
  ├── C1a (switchboard) ── C1b (pause readers; 10 → 1)
  └── C1c (funnel; 16 → 12) ── C1d (routes; 12 → 7) ── C1e (executors; 7 → 2) ── C1f (dedupeKey; OA-C3)
```

The two chains are independent, but only one series edits `watch.ts` at a time (spec §5.1 rule 6): C1b's `watch.ts` commit and C1c's `pushOne` commit never sit in the queue together. C1e follows C1b because both edit the same three executors.

## Global constraints

The W0 plan's §Global constraints bind this plan (public repository, SAFETY, no root runner, characterization discipline, counts measured, band routing, branch discipline), except "zero production bytes", which W1a replaces with the rules below.

- **Each PR's first commit is a characterization pin** (spec §5.1 rule 1, O9 (a)): the W0 rows for the sites the PR moves, re-run on the PR's base (after #397) and extended with the rows named in its Step 1. It is green against the old code. **Move commits** change those suites only in their imports; a move commit that edits a characterization assertion is refused in review. One consumer per commit. **The one exception is named, never assumed:** an existing literal source pin over text a task rewrites (not moves) cannot survive by symbol keying, so the task lists it in its Files and re-points it in its own commit, keeping every other half of that block byte-identical (C1a's marker blocks, C1b's `watch.ts` reclaim pin).
- **Behaviour commits** (spec §5.1 rule 1b) are their own commits, never squashed with a move, with their before/after rows in the PR body and the operator's ruling cited. W1a has exactly one: C1f's. Any other output change found mid-task stops the task and is reported, never folded in.
- **The act-time re-read stays** (spec K1, K12, §3.19). The tick's switch snapshot feeds the decision; every executor calls `readSwitches` **again, over a fresh listing, nearest the argv**. C0e's "a pause raised between the pass and the act holds" rows stay green, unchanged, through every commit.
- **No `pwa/` file** (spec §5.1 rule 8). C1a lands the path guard. It is keyed on the diff, not on a branch name (CI checks out a detached merge commit or a `gh-readonly-queue/*` ref): any diff that touches a W1a-owned file (the list in C1a) and any `pwa/` path is red.
- **No `ccd` byte, no agent byte.** `ccd` keeps reading its markers itself (they are what it can read with the server down, spec K12); `SWITCHES` describes them and changes none.
- **Wire discipline.** No frame changes in W1a. The catch-up response (`{ epoch, seq }` cursor, ring authority, O11 (a)) is byte-identical, held by C1c's catch-up row.
- **coord.db.** C1f's one `MIGRATIONS` entry is an `ALTER TABLE … ADD COLUMN` with no `NOT NULL` and no `CHECK`, so a rollback stays bootable (`db.ts` rule 3).
- **Counted exits.** Each PR body prints the census lists (C0b's queries) at its base and at its tip. The may-only-shrink pin for a count lands in the commit that reaches that count's wave target (spec §5.1 rule 3, rev 2), never earlier.
- **Deviation ledger.** This plan defines D-5855 to D-5860 and never allocates.

## Review focus (the failure modes most likely to bite)

1. **A deleted late read.** Moving an executor's switch read onto `readSwitches` must keep every read it has today: the lane's pass read on the tick's listing, the executor's first read, and its late read nearest the argv (expiry step 6, collect's last read, `stillCrashed`, `releaseRetiredChildHold` step 6), each over a fresh listing. One call over the tick's snapshot is the defect rev 1 of the spec was reviewed for (R1-3).
2. **A failed listing read as "clear".** `readSwitches` answers `'unmeasurable'` for a listing that could not be taken and never resolves it to a verdict; every reader keeps its own mapping. The ones that treat it as paused today still do (`childReclaim.ts` ≈:1123 and `releaseRetiredChildHold` step 6, `collectTempRoot.ts` ≈:252, `endDeadCoordinator.ts` ≈:161, `expireArchived.ts` ≈:137), and a rejecting `readdir` keeps `childReclaim`'s own sentence.
3. **A word that changed.** Each verdict sentence ("… is raised: cleanup is paused fleet-wide", "the registry did not list, so a raised … cannot be ruled out") is pinned byte for byte by C0e. A move that rephrases one is a behaviour change.
4. **A push where there was none.** The three child-reclaim rows stay "recorded and NEVER pushed", whatever the presence. The funnel's mode for them is the one C0d measured, and the PR names it.
5. **A reordered sink, or a changed sentence.** The funnel records the ring, archives and pushes in that order, with a flush after the ring record; an archive failure never stops the ring or the push, and prints the writer's own degrade sentence (`opts.degraded`). C0c and C0d are the check.
6. **A no-coord.db box.** With no `coord`, the funnel still records the ring and serves catch-up (`watch.ts` ≈:3103's rule). With no `notifyLog`, it archives nothing ("a feed row that mirrors nothing is not an archive").
7. **An approval ruling that fails on a feed write.** `coord/routes.ts` ≈:4545's route stores the ruling even when the archive throws (C0d's row). C1d moves it natively.
8. **A switch that changes meaning.** `SWITCHES` is data that describes today's markers; it adds none and removes none. `collect-lane-live` stays a row (spec K12). ARCH-77's child-reclaim off switch is **not** in W1a (it lands with W4's `child-spent` PR).

## Tasks

### Task C1a: the switchboard — `SWITCHES` and `readSwitches`, and `mail-disabled` defined once (D-5855; ARCH-70 (#805), first PR; spec K12, §2.3) — GATED: after #397, C0b, C0e, C0g

**Routing:** band 2 (data and a pure reader; no reader moves except the two duplicate definitions). **Lane:** server. **Needs:** #397, C0b, C0e, C0g.

**Files:**
- Create `shared/switches.ts` (L0, no imports beyond `shared/`): `SWITCHES`, a `const` record keyed by switch name. Each row: `storage` (`{ marker: '<name>' }` under `$REG`, or `{ setting: '<table>.<column>' }`), `default` (what absence means), `owner` (the spec's context, C1 to C9), `meaning` (one operator sentence), `writer` (the route or ccd verb that writes it, or `'hand-only'`). Rows: every marker exported today (`mail-disabled`, `coordinator-paused`, `reclaim-paused`, `asks-disabled`, `stop-done-disabled`, `hibernate-disabled`, `hibernate-live`, `expire-lane-live`, `collect-lane-live`, `dead-coordinator-lane-live`, `idle-compact-nudge-disabled`, `mail-gate-strict`, `mail-gate-busy`, `mail-gate-busy-shadow`, and any C0b's `markerLiteralFiles()` finds that this list misses) and the settings-table switches Step 0 finds (the spec's "3 tables"). `readSwitches(listing: string[] | null)` answers, per marker row, the wire's existing `MarkerState` (`'set' | 'clear' | 'unmeasurable'`, `shared/api.ts`), so `emitCoord` and the PWA need no translation (C0e pins the frame's bytes). A `null` listing is `'unmeasurable'` for every marker row, never `'clear'`. **`readSwitches` never resolves `'unmeasurable'` to a verdict:** each reader keeps its own mapping, because they differ today (the executors and the mail lanes fail shut; the stall-watch view in `coord/routes.ts`, ≈:2634 (4bc6c756d), reads `names ?? []` and treats an unlistable registry as mail enabled). The row schema has no single "default" for unlistable; the routes.ts display reader is recorded in the PR body as the one reader that maps it to clear, so W1b's census sees the split.
- Modify `server/src/coord/rundefs.ts`: `MAIL_DISABLED_MARKER`, `COORDINATOR_PAUSE_MARKER`, `RECLAIM_PAUSE_MARKER` become re-exports of their rows' marker names (callers unchanged).
- Modify `server/src/watch.ts`: the private `MAIL_DISABLED_MARKER` (≈:678) and `ASKS_DISABLED_MARKER` (≈:687) become imports. Nothing else in `watch.ts`.
- Modify the other exporters (`stopDone.ts` ≈:94, `coord/hibernate.ts` ≈:98–99, `archivedExpiry.ts` ≈:24, `collectLane.ts` ≈:37, `deadCoordinator.ts` ≈:23, `idlenudge.ts` ≈:47, `turnidle.ts` ≈:67–74): each constant re-exports its row. **`stopDone.ts` and `hibernate.ts` change only the right-hand side of one `export const` each**; if a reviewer reads that as touching the stop-done or hibernation lane, those two rows stay as they are and the PR says so (spec §5.3 never touches the sweeps; the decider files are not sweeps).
- Modify `server/test/single-definition.test.ts`. `ROOTS` includes `shared/`, so once a literal moves into `shared/switches.ts` every block that pins the literal's only code-line holder to its current definer goes red. Each of these blocks is re-pointed at `shared/switches.ts` **in its own commit** (they are switch censuses, C0g's risk rule), with its "no shell line names it" and "the definer reaches no `node:` module" halves kept byte-identical. Hints at `4bc6c756d`:
  - "Build 4 — one MarkerState, one coordinator-paused literal" (≈:2280), including its named `mail-disabled` holder list (≈:2299–2320), where `switches.ts` becomes the holder;
  - "child-reclamation wave 4 — one 'reclaim-paused' literal" (≈:2337), its literal-holder half (its ≈:2347–2351 `watch.ts` pin is C1b's);
  - "worker stall watch: the four operator-switch markers have no writer in the tree" (≈:4275; `mail-gate-strict` and its three neighbours, expected in `turnidle.ts` or `coord/stall.ts`);
  - "worker stall watch wave 2: the three new operator-switch markers have no writer" (≈:4431; `mail-gate-busy`, `mail-gate-busy-shadow`);
  - "the expiry lane's live switch has no writer" (≈:4950, `DEFINER` `archivedExpiry.ts`);
  - "the dead-coordinator lane's live switch has no writer" (≈:5019, `DEFINER` `deadCoordinator.ts`);
  - "the collector lane's live switch has no writer" (≈:5878, `DEFINER` `collectLane.ts`, and its ≈:6144 "spelled outside its definer" row);
  - "the stop-done lane's kill switch has no writer, and its constants one home" (≈:6750, `DEFINER` `stopDone.ts`);
  - "idle-compact-nudge: the kill switch has no writer" (≈:6778);
  - "hibernation's markers have no writer, and its holds one home" (≈:6984, `DEFINER` `coord/hibernate.ts`).
  If the `stop-done-disabled` and `hibernate-*` rows are left out (the fallback above), their two blocks are untouched as well, and the PR says so. The ARCH-40 tail block gains "every marker literal under `server/src` is a `SWITCHES` row". Rule 6: the ≈:4946–6990 hunks are measured against #737's live diff at Step 0.
- Create `server/test/switches.test.ts` and `server/test/consolidation-path-guard.test.ts` (rule 8). The guard is keyed on the **diff**, not on a branch name (CI runs `pull_request` on a detached merge commit and `merge_group` on a `gh-readonly-queue/*` ref, and nothing reads `GITHUB_HEAD_REF` today): over `git diff --name-only $(git merge-base origin/main HEAD) HEAD`, a diff that touches any W1a-owned file (`shared/switches.ts`, `server/src/notice.ts`, and the files this plan's tasks list) **and** any `pwa/` path is red. A diff that touches only one side passes, so the skins, Settings and Accounts PRs are never stopped by it. With no `origin/main` it skips with a printed notice; in CI (`CI` set) a missing base is red, never a silent skip.

- [ ] **Step 0: Re-ground** on the post-#397 tree: every marker constant and its value, every settings-table switch and its writer route, C0b's `markerDefinitions('mail-disabled')` (2) and `markerLiteralFiles()`. Rule 6 check for every file above.
- [ ] **Step 1: Characterization commit.** Re-run C0e on the base; add `switches.test.ts`'s first rows against the **old** code: every marker constant's value today, listed as the table the PR is about to add must equal (green on `main`, red if any value drifts).
- [ ] **Step 2: Red.** `readSwitches` rows: a listing with `reclaim-paused` is `'set'` for it and `'clear'` for the rest; `null` is `'unmeasurable'` for every marker row; a settings row ignores the listing; every row has a non-empty `meaning` and a `writer`. Red (no module).
- [ ] **Step 3: Green**, then the move commits, one file per commit: `rundefs.ts`, `watch.ts`, then the other exporters, each followed by the `single-definition.test.ts` block(s) its literal moves (one block per commit), then the tail row, then the path guard. A commit that leaves a listed block red is not landed.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `readSwitches(null)` answers `'clear'` | switches | "an unlistable registry is never clear" |
  | a row's marker misspelt (`reclaim-pause`) | switches | "every marker value equals today's" |
  | a new `const X_MARKER = 'x'` in `server/src` with no row | single-definition | "every marker literal is a SWITCHES row" |
  | `watch.ts` keeps its private `mail-disabled` | single-definition | "mail-disabled is defined once" |
  | a `pwa/` file touched in a diff that also touches `shared/switches.ts` | consolidation-path-guard | "no pwa/ file before W7" |
  | the expiry block's `DEFINER` left at `archivedExpiry.ts` | single-definition | the block's holder row |

- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/tsc --noEmit
      cd server && ./node_modules/.bin/vitest run test/switches.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/reclaim-pause-pin.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/consolidation-path-guard.test.ts --maxWorkers=2

**Exit (GATES):** `mail-disabled` definitions 2 → 1 (pinned, may only shrink); every marker literal under `server/src` is a `SWITCHES` row (pinned); every listed marker block re-pointed and green; C0e unchanged and green. **OBSERVATION:** `markerLiteralFiles()` at base and tip. **Rollback:** `git revert`; the re-exports make it a pure revert.

### Task C1b: every `reclaim-paused` reader through `readSwitches`, at the pass and at the act (D-5856; ARCH-70 (#805), second PR; spec K12, K1's act-time re-measure) — GATED: after C1a

**Routing:** **band 3, native** (the four executors are on the destructive path; the fleet's emergency stop). Two reviewers, one reading only Review focus 1 to 3. **Lane:** server. **Needs:** C1a.

**Files (one per commit, executors last):**
- `server/src/watch.ts`: the four sites (≈:2858, the switch summary's `reclaim` field, which already speaks `MarkerState`; ≈:4065; ≈:5261, beside the expire capability; ≈:5471, the dead-coordinator lane's pass) read `readSwitches(names)['reclaim-paused']`.
- `server/test/single-definition.test.ts` "child-reclamation wave 4 — one 'reclaim-paused' literal", its ≈:2347–2351 pin "watch.ts reaches the reclaim marker through the shared constant" (`toContain('names.includes(RECLAIM_PAUSE_MARKER)')`): the `watch.ts` commit turns it red, so it is re-pointed **in its own commit, just before** that one, to assert that `watch.ts` reaches `readSwitches` (through `sourceOfSymbol` after C0g) and that no `includes(RECLAIM_PAUSE_MARKER)` remains in `watch.ts`.
- `server/src/coord/collectTempRoot.ts` ≈:357–365: the pass's switch read and its two causes (`raised`, `unlistable`).
- `server/src/coord/expireArchived.ts` ≈:130–140 (`expirySwitches`): both of its calls, step 2's and step 6's "NEAREST THE ARGV".
- `server/src/coord/endDeadCoordinator.ts` ≈:161–162 (`stillCrashed`, the late read inside `abandon`) and ≈:193–196 (the executor's step 1).
- `server/src/coord/childReclaim.ts` ≈:1013 (`childReclaimPauseRead`), the executor's deferral ≈:1123–1129 and `releaseRetiredChildHold` step 6 (≈:1549 (4bc6c756d)), the second caller, whose `'set'` → `'changed'` and `'unmeasurable'` → `'failed'` mapping is kept. A rejecting `readdir` keeps `childReclaim`'s own sentence (it is not folded into `null`).
- `server/test/single-definition.test.ts` ARCH-40 tail block: the ratchet `reclaimPauseParseSites().length <= 1` (the one left is `stopDoneSweep.ts` ≈:172, which W4 moves), in the last commit.

- [ ] **Step 0: Re-ground** the 10 sites with `reclaimPauseParseSites()` on the post-#397 tree; rule 6 check for each file.
- [ ] **Step 1: Characterization commit.** C0e's rows for these nine sites and `releaseRetiredChildHold` re-run on the base, including the per-call scripted late-read rows (the marker raised only from the late read on), plus one row per executor that runs **two passes** with the marker raised between them, so a cached snapshot shows as a stale act (green on `main`).
- [ ] **Step 2: Move commits**, one file per commit, each keeping its verdict words and both reads. Each commit runs C0e and the file's own suites.
- [ ] **Step 3: Ratchet commit.**
- [ ] **Step 4: Mutation table, RUN** (on the moved code).

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `expireArchived.ts`: step 6 reuses step 2's `readSwitches` result | reclaim-pause-pin | "a pause raised during the act holds: expiry" |
  | `childReclaim.ts`: `releaseRetiredChildHold` maps `'unmeasurable'` to continue | reclaim-pause-pin | "…holds: retired-child release" |
  | `endDeadCoordinator.ts`: `unlistable` treated as `clear` at the act | reclaim-pause-pin | "an unlistable registry cannot rule the pause out" |
  | `childReclaim.ts`: the deferral's sentence reworded | reclaim-pause-pin | the byte pin on ≈:1128's words |
  | a new `names.includes(RECLAIM_PAUSE_MARKER)` in `watch.ts` | single-definition | "reclaim-paused is parsed at ≤ 1 site outside readSwitches" |

- [ ] **Step 5: Verify** C0e, `switches.test.ts`, `single-definition.test.ts`, and each moved file's existing suites (`child-reclaim*.test.ts`, `collect-switch-*.test.ts`, `dead-coordinator-lane.test.ts`, `expire-*.test.ts`), one at a time.

**Exit (GATES):** private `reclaim-paused` parse sites 10 → 1 (`stopDoneSweep.ts`), pinned; every late read green (C0e unchanged); the ≈:2347–2351 pin re-pointed, not deleted. **Rollback:** `git revert` per commit; the switch's meaning is unchanged, so the operator's pause works on either side of a revert.

### Task C1c: the `notify` funnel, and the writers outside `coord/` (D-5857; ARCH-54 (#789), first PR; spec K6) — GATED: after #397, C0b, C0c, C0g

**Routing:** band 2 for the funnel and the four moves (feed and push, not destructive); the orchestrator reviews the mode table. **Lane:** server. **Needs:** #397, C0b, C0c, C0g.

**Files:**
- Create `server/src/notice.ts`: `notify(deps, event, mode, opts?) → NoticeOutcome`, where `deps = { notifyLog?, coord?, push?, presence? }`, and the `NoticeSink` port type (`(event, mode, opts?) => NoticeOutcome`) that writers outside `watch.ts` receive. `notify` is **synchronous** and archives before it returns.
  - `event` is the ring record **as the caller builds it**, spread unchanged into `NotifyLog.record`, so each writer's key order reaches catch-up exactly as today (`pushOne` writes `{kind, sessionId, title, body, runId}`, several hand pairs `{kind, sessionId, runId, title, body}`).
  - `mode` is the record gate and the push, the three reachable combinations only: `'push'` (record unless visible, push unless visible), `'record-always'` (record always, push unless visible), `'record-only'` (record always, never push). There is no record-unless-visible mode: no caller has one (C0c).
  - It owns, in this order: the presence gate, the ring record, the flush, the guarded archive, the push. The flush placement relative to the archive is free (unobservable, spec K6 rev 2.1).
  - `opts` carries `tag`, `actions`, `url` (as `pushOne` does) and **`degraded`**, the text after `— ` in the archive-failure warning. The funnel prints ``ccrc-server: recordFeedEvent failed (<err>) — ${degraded}``, with `pushOne`'s `feed archive degraded, ring/push unaffected` as the default, so every writer keeps its own sentence byte for byte (`child-reclaim-sweep.test.ts` ≈:2502 stays unedited).
  - `NoticeOutcome` is `{ recorded: boolean; archived: 'landed' | 'failed' | 'none' }` (`'none'`: no `notifyLog` or no `coord`). A batch writer uses it to keep its stop-on-first-failure shape (C1e).
- Modify `server/src/watch.ts`: `pushOne` keeps its title decoration and calls `notify` with the mode its two flags name; its flag type narrows to the three named combinations (a type change, no behaviour change: no caller passes `recordOnly` without `recordAlways`). The two collector pairs (≈:4984, ≈:5003) call `notify(…, 'record-only', { degraded: … })` with their current sentences.
- Modify `server/src/interruptlog.ts` `recordInterrupt` and `server/src/server.ts`'s pair (≈:2485): each takes a `NoticeSink` from its deps and calls it. `server.ts`'s composition root builds the one sink and passes it.
- Create `server/test/notice.test.ts`.

- [ ] **Step 0: Re-ground** on the tree after #397. Read C0c's and C0d's PR bodies for the measured mode and degrade sentence of all 15 hand pairs, and confirm `NotifyLog.record` still cannot throw (in-memory). If it has become able to throw, stop and report: flush placement and ring-throw handling would then be observable, and the one shape would need a ruling.
- [ ] **Step 1: Characterization commit.** C0c's rows re-run on the base, plus: the catch-up response's bytes, **filled through each moved writer** (not a hand-built ring), compared as `JSON.stringify` output so key order counts; a box with no `coord` still records and serves catch-up; a box with no `notifyLog` archives nothing.
- [ ] **Step 2: Red.** `notice.test.ts`: each mode's sinks over `visible ∈ {true, false}` equal the matching `pushOne` combination's row in C0c; an archive throw leaves the ring and the push, returns `archived: 'failed'` and prints `opts.degraded`; the order is ring, archive, push, with a flush after the ring record; the caller's record object reaches the ring with its keys in the caller's order. Red (no module).
- [ ] **Step 3: Green**, then the move commits: `pushOne` → `notify`; then `watch.ts` ≈:4984; ≈:5003; `interruptlog.ts`; `server.ts`. Each runs C0c unchanged.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `notify`: push before the ring record | feed-writers-pin, notice | "ring, archive, push" |
  | `notify`: ignores `opts.degraded` | feed-writers-pin | the moved writer's degrade sentence |
  | `notify`: rebuilds the record in its own key order | notice | the catch-up byte row through `recordInterrupt` |
  | `notify`: `record-only` pushes when not visible | feed-writers-pin | "the collector's rows are never pushed" |
  | `notify`: the archive's `try` removed | notice | "a failed archive leaves the ring and the push" |
  | `notify`: archives with no `notifyLog` | notice | "no ring, no archive row" |
  | catch-up: the response gains a field | notice | the catch-up byte row |

- [ ] **Step 5: Verify** `notice.test.ts`, `feed-writers-pin.test.ts`, `notifylog.test.ts`, `consolidation-census.test.ts`, one at a time, then `tsc --noEmit`.

**Exit (GATES):** `feedRecordCallSites()` 16 → 12 (the funnel's own, 10 in `coord/` and `stopDoneSweep.ts`'s), measured, not yet pinned; each moved writer's C0c row unchanged, degrade sentence included; the idle nudge's landing gate unchanged; catch-up bytes unchanged. **Rollback:** `git revert`; no stored data changes.

### Task C1d: the funnel takes `coord/routes.ts`'s five writers (D-5858; ARCH-54 (#789), second PR; spec K6) — GATED: after C1c

**Routing:** **band 3, native**: the ≈:4545 writer is the approval ruling's feed row (coordinator-first, live), and the route around it is a security boundary's caller. Two reviewers. **Lane:** server. **Needs:** C1c; C0d.

**Files:** `server/src/coord/routes.ts`: the five pairs (≈:2485, ≈:2703, ≈:2859, ≈:3985, ≈:4545) call the `NoticeSink` the route's deps carry, in the mode C0d measured for each and with its current degrade sentence as `opts.degraded` (≈:4545's `ruling stored, feed archive degraded`); `server/src/server.ts` passes the sink into the coord routes' deps (one line). The routes stay in `coord/routes.ts`, behind its one auth gate (08-10 Rejected; spec §2.5).

- [ ] **Step 0: Re-ground**; rule 6 check on `coord/routes.ts` (the Settings redesign's server tasks edit it: their hunks must be line-disjoint or merged first).
- [ ] **Step 1: Characterization commit.** C0d's five route rows re-run on the base, plus one row per route asserting its HTTP status and body bytes with the archive throwing (the route never fails on a feed write).
- [ ] **Step 2: Move commits**, one route per commit, ≈:4545 last.
- [ ] **Step 3: Mutation table, RUN.** ≈:4545: let the sink's archive failure escape → red "ruling stored, feed archive degraded"; any route: mode `push` in place of the measured one → red on that route's C0d row.
- [ ] **Step 4: Verify** `feed-writers-pin.test.ts`, then each route's existing inject suite alone, then `tsc --noEmit`.

**Exit (GATES):** `feedRecordCallSites()` 12 → 7; the five C0d rows unchanged; the approval signing path untouched (`approvalsign.ts`, `approval-verify.mjs` not in the diff). **Rollback:** `git revert`.

### Task C1e: the funnel takes the executors' writers, and the feed's writer set is pinned (D-5859; ARCH-54 (#789), third PR; spec K6, §2.1 rule (f)) — GATED: after C1d and C1b

**Routing:** **band 3, native** (child reclaim, expiry and dead-coordinator executors are the destructive path). Two reviewers. **Lane:** server. **Needs:** C1d; C1b (both edit these three files; one series at a time).

**Files:**
- `server/src/coord/childReclaim.ts` (≈:1692, ≈:1719, ≈:1758), `server/src/coord/expireArchived.ts` (≈:287), `server/src/coord/endDeadCoordinator.ts` (≈:280): each pair calls its `NoticeSink` with the measured mode (`record-only` for the three reclaim rows: "every reclaim lands in the feed; no push per reap") and its current degrade sentence as `opts.degraded` (`child reclaim kept, feed archive degraded` stays byte-identical, so `child-reclaim-sweep.test.ts` ≈:2502 is not edited).
- `endDeadCoordinator.ts` `recordRows` keeps its batch semantics: it calls the sink per row and **stops at the first `archived: 'failed'`**, so the rows after a failed archive are dropped from the ring as today, and the warning is printed once (C0d's mid-batch row). Their deps' `notifyLog` and `coord.recordFeedEvent` members leave the `Pick<…>` types they no longer use.
- `server/test/single-definition.test.ts` ARCH-40 tail block, last commit: the feed archive's writer set is `{ notice.ts notify, stopDoneSweep.ts }` and `feedRecordCallSites().length <= 2`, may only shrink.

- [ ] **Step 0: Re-ground**; rule 6 check.
- [ ] **Step 1: Characterization commit.** C0d's five executor rows re-run on the base, plus: a reclaim with the operator visible is still recorded and still not pushed; a failed archive leaves the executor's act result and its journal row unchanged.
- [ ] **Step 2: Move commits**, one file per commit, `childReclaim.ts` last.
- [ ] **Step 3: Ratchet commit.**
- [ ] **Step 4: Mutation table, RUN.** `childReclaim.ts`: mode `record-always` (pushes when no one looks) → red "no push per reap"; `recordRows` keeps looping after a failed archive → red "a failed archive mid-batch drops the rows after it"; a new hand pair in `coord/close.ts` → red "the feed archive has two writers"; the act-time pause rows (C0e) stay green across every commit.
- [ ] **Step 5: Verify** `feed-writers-pin.test.ts`, `reclaim-pause-pin.test.ts`, `single-definition.test.ts`, `consolidation-census.test.ts`, then the three executors' suites, one at a time.

**Exit (GATES):** `recordFeedEvent` call lines outside the store 16 → 2 (the funnel and `stopDoneSweep.ts`'s, which W4 moves), pinned; the feed's writer set pinned at two; every writer's mode unchanged (C0c and C0d green, unedited). **Rollback:** `git revert`; the ratchet goes with it.

### Task C1f: `dedupeKey` on notices; the two body-match dedupe reads become key reads (D-5860; ARCH-55 (#790); spec K6, §5.1 rule 1b) — GATED: after C1e and OA-C3

**Routing:** **band 3, native**: the idle nudge's dedupe sits in front of a keystroke into a live pane. Two reviewers; the behaviour commit is checked against the operator's ruling. **Lane:** server (one additive coord.db column). **Needs:** C1e; OA-C3 for the behaviour commit.

**Scope, stated exactly.** `hasFeedEvent` has three callers in `watch.ts` (4bc6c756d): `idleNudgeOne`'s `alreadyNudged` (≈:6702) and the stall lane's landing step `facts.told` (≈:8211) are **read-before-write dedupe checks** that feed L1 deciders before any notice is written; `idleNudgeOne`'s check after the record (≈:6710) is a **landing gate**: "a row that did not land types nothing" before `sendPrompt`. Only the first two change. The landing gate is untouched by this task.

**Files:**
- `server/src/coord/schema.ts` / `db.ts` `MIGRATIONS`: `ALTER TABLE feed_events ADD COLUMN dedupe_key TEXT` (nullable, no `CHECK`), and an index on `(kind, session_id, dedupe_key)`.
- `server/src/coord/store.ts`: `recordFeedEvent` stores an optional `dedupeKey`; it **refuses nothing** (the archive never decides the ring, O11 (a)). A new read, `hasNotice(kind, sessionId, dedupeKey)`, answers whether a row with that key exists. `hasFeedEvent` stays for the landing gate.
- `server/src/notice.ts`: `opts.dedupeKey`, passed through to the archive. The funnel never suppresses the ring or the push on its own; the dedupe decision stays with the caller, read before the write, as today.
- `server/src/watch.ts`: `alreadyNudged` (≈:6702) and the landing step's feed-only `told` (≈:8211) read `coord.hasNotice(kind, id, key)` instead of the body match, and the notices they guard carry that key. The deciders' inputs and the read-before-write order are unchanged.

- [ ] **Step 0: Re-ground** every `hasFeedEvent(` and `hasMailWithSubject(` call. `hasMailWithSubject` at `coord/rundefs.ts` ≈:386 and `watch.ts` ≈:8208 (4bc6c756d) dedupes **mail**, not a notice, so it stays (see D-5860). Confirm the landing gate is still a re-read after the record. Rule 6 check for `schema.ts`, `store.ts` and any `MIGRATIONS` entry in flight (the CB programme's).
- [ ] **Step 1: Characterization commit.** For the two dedupe sites: the feed rows, pushes and (for the nudge) `sendPrompt` calls produced by (a) a first notice, (b) the same notice again, (c) the same notice after the first row's body changed, (d) a ring restart (new epoch) between them, (e) a server restart (the in-memory `idleNudged` set empty). Plus the landing gate's row from C0c (archive throws → nothing typed). Green on the old code.
- [ ] **Step 2: Additive commits** (the column, the store argument and `hasNotice`, the funnel option), each with no behaviour change: no caller passes a key yet, and Step 1 stays green.
- [ ] **Step 3: The behaviour commit** (after OA-C3): the two sites read and write keys; Step 1's rows change **only** where the operator ruled, and the PR body lists every before/after row and cites the ruling.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `hasNotice` ignores the key (matches kind and session only) | the idle-nudge suite | row (c) or a second compaction's first nudge |
  | the store refuses a duplicate key and the funnel skips the ring | notice | "an archive refusal never suppresses the ring" |
  | the landing gate removed | feed-writers-pin | "a row that did not land types nothing" |
  | the migration adds `NOT NULL` | the migration suite | the rollback-bootable row (`db.ts` rule 3's test) |

- [ ] **Step 5: Verify** `coord-store.test.ts` (or the migration suite Step 0 names), `notice.test.ts`, `feed-writers-pin.test.ts`, the idle-nudge and stall suites, one at a time.

**Exit (GATES):** body-match idempotency reads 2 → 0; the landing gate unchanged (1 `hasFeedEvent` caller left, by design); every notice that needs once-only carries a key. **Rollback:** `git revert` of the behaviour commit restores the body-match reads; the column stays, unused and harmless (spec §5.1 rule 4).

## Operator acts in this wave

- **OA-C3 (before C1f's behaviour commit): the `dedupeKey` rows.** The ask shows Step 1's before/after table for the idle-compact nudge's `alreadyNudged` and the stall lane's `queue` row, and names the case where a key and a body match can disagree (a re-sent notice whose body changed). It states that the landing gate is unchanged, and the no-coord.db behaviour (the nudge and stall lanes need coord.db today, so a box without it nudges and dedupes nothing before and after). The operator rules which rows change. Nothing on a box is touched.
- **Arming nothing.** W1a changes no lane's arming. Every switch keeps its meaning, so the operator's `reclaim-paused`, `mail-disabled` and the lane-live markers act exactly as before, on either side of any commit.
- **The wave's deploys** follow the standing rule: from a fresh `origin/main` worktree as a detached unit, verified from its log. Server lane only; no session restarts.

## Acceptance

Every PR body carries: the census lists at base and tip (C0b's queries), the mutation table's red lines, the rule 6 disjointness check (each edited file, each open PR holding it, line ranges), and the first commit's name as the characterization pin. C1b, C1d and C1e carry both reviewers' verdicts. C1f carries the operator's ruling.

## Rollback

Each task is a revert of its PR, newest first. No stored data changes before C1f, and C1f's column is additive. Because every switch keeps its meaning and every writer keeps its measured mode, any revert leaves the fleet's emergency stop and the feed working. The ratchet pins revert with the commits that landed them.

## Deviations and decisions

### Issued for this work and defined here

The allocator issued the consolidation wave a block of 30 numbers, 5848 to 5877. The W0 plan defines D-5848 to D-5854; this plan defines D-5855 to D-5860.

- **D-5855** — `switchboard-table` (Task C1a; ARCH-70): every operator switch is one row of L0 `SWITCHES` (storage, default, owner, meaning, writer), read by one `readSwitches(listing)` that answers the wire's `MarkerState` (`set | clear | unmeasurable`) and never resolves `unmeasurable` for a reader; the old marker constants re-export their row, `mail-disabled` is defined once, and every marker literal under `server/src` is a row. Markers stay the storage ccd and the hook read with the server down (spec K12).
  - **As planned:** ARCH-77's child-reclaim off switch is not added here; it lands as the first commit of W4's `child-spent` PR (spec §5.7).
- **D-5856** — `pause-read-at-pass-and-act` (Task C1b; ARCH-70): every `reclaim-paused` reader goes through `readSwitches`, keeping every read it has today (the lane's pass on the tick's listing; each executor's first read and its late read nearest the argv, each over a fresh listing; `releaseRetiredChildHold` step 6); each reader keeps its own mapping of `'unmeasurable'`; 10 parse sites → 1 (stop-done's, moved in W4).
- **D-5857** — `notify-funnel` (Task C1c; ARCH-54): one synchronous `notify(event, mode, opts)` in `server/src/notice.ts` owns the presence gate, ring, flush, guarded archive and push, and `pushOne` routes through it; its three modes are the reachable flag combinations (spec K6, rev 2.1); it spreads the caller's record unchanged, prints the caller's degrade sentence (`opts.degraded`) and returns the archive's outcome; the ring stays the catch-up authority (O11 (a)).
- **D-5858** — `funnel-coord-routes` (Task C1d; ARCH-54): `coord/routes.ts`'s five feed writers call the funnel through a `NoticeSink` in their measured modes, inside `coord/routes.ts` and behind its auth gate; the approval ruling is stored whatever the archive does.
- **D-5859** — `funnel-executors-and-feed-writers-pinned` (Task C1e; ARCH-54): the child-reclaim, expiry and dead-coordinator writers call the funnel ("no push per reap" kept), and the feed archive's writer set is pinned at the funnel plus stop-done's until W4.
- **D-5860** — `notice-dedupe-key` (Task C1f; ARCH-55): a notice that must happen once carries a `dedupeKey`, stored in an additive `feed_events.dedupe_key` column; the two read-before-write dedupe checks (`alreadyNudged`, the landing step's feed-only `told`) read the key through `hasNotice` instead of matching the body. The archive refuses nothing and never suppresses the ring or the push (O11 (a)). The idle nudge's landing gate (a row that did not land types nothing) stays a `hasFeedEvent` re-read. The behaviour commit changes only the rows the operator ruled (OA-C3).
  - **Departs from the spec's K6 as rev 2 wrote it:** `hasMailWithSubject` keeps its two callers (they dedupe mail to the operator, not a notice), and of `hasFeedEvent`'s three callers only the two dedupe reads change. Spec rev 2.1 records both.
  - **OA-C3, ruled 2026-10-21:** "A: the label decides". The same compaction or the same PR removal is already sent, whatever the row's wording. The behaviour commit changes the four rows that ruling names (a reworded row then a restart, for the nudge and for the dequeue; a dequeue mailed to a coordinator whose run then closed, then a restart; a later compaction in the same session, which the masked body read never nudged).
  - **Departure `dedupe-key-unmasked`** (measured in C1f's preparation): the key is stored as its SHA-256 hex, never through the body's redactor (D-5298). A compaction uuid is a token-shaped run the redactor masks, so a masked key would collide exactly as the masked body does, and the later-compaction row would stay unfixed.
  - **Departure `landing-gate-by-key`** (measured in C1f's preparation): the idle nudge's landing gate re-reads the compaction's key (`hasNotice`), not the body. Once a later compaction can be nudged, its body masks to the earlier compaction's row, so a body re-read would say "landed" over a row that did not land and type into the pane. This replaces "the landing gate stays a `hasFeedEvent` re-read" above; the gate is still a re-read after the record, and `hasFeedEvent`, left with no caller, is removed (its redacted-body comparison lives on in `hasNotice`'s pre-key read).
  - **Departure `dedupe-key-legacy-text`** (measured in C1f's preparation): a row archived before C1f carries no key (NULL), and `hasNotice` still matches such a row by its body, so the deploy itself re-sends nothing. A keyed row is never matched by its body. The pre-key rows age out of the archive's retention (2,000 rows, about 21 hours measured).

Issued and unused: 5868, 5869, 5870, 5871, 5872, 5873, 5874, 5875, 5876, 5877. They are held for the wave's later plans (W2 onward) and are never defined outside this programme's plans. D-5865 is defined in the W0 plan (C0e's departure, entered by the coordinator); D-5861 to D-5864, D-5866 and D-5867 are defined in the W1b plan (`2026-10-20-consolidation-w1b-schedule-listing-redactor.md`).

## Out of scope

W1b (the schedule table and `runLane`, the change latch, one registry listing per tick, `ccdCan`, the TS redactor); stop-done's feed pair and switch read (W4); any `pwa/` file (W7); any `ccd` byte (W5); ARCH-77 (W4); a server swap suggestion (O12 (a)).

## Review log

**rev 0 (2026-10-19).** Written from the spec's rev 2 and measured on `origin/main` `f64c27b65`.

**rev 1 (2026-10-19).** Two reviews (A, B). Each finding was re-measured on `origin/main` `4bc6c756d`, after #397 merged as `6ae03d2de`. Findings that touch only the W0 plan are in its log.

| # | Sev | Finding (short) | Checked against | Outcome | Where |
|---|---|---|---|---|---|
| A1 | high | moving the marker literals into `shared/` reds about ten single-definition holder blocks, and C1a listed two | `single-definition.test.ts` `ROOTS` includes `shared/`; the blocks at ≈:2280, :2337, :4275, :4431, :4950, :5019, :5878, :6750, :6778, :6984 (4bc6c756d) | Applied: every block listed, each re-pointed in its own commit with its other halves byte-identical; rule 6 against #737 for the later hunks | C1a, Gates |
| A2, B1 | high | the idle nudge's `hasFeedEvent` after the record is a landing gate before `sendPrompt`, not a dedupe; the other two reads precede any write | `watch.ts` `idleNudgeOne` ≈:6702 and ≈:6710; the landing step ≈:8211 | Applied: the gate stays; the two dedupe reads become `hasNotice` key reads, read before write; exit 2 → 0; band 3 native. **Rejected in part:** A2's "funnel returns a verdict and the nudge asserts landed" is not needed while the gate stays a re-read | C1f, D-5860, OA-C3 |
| B3 | high | "a refused archive suppresses the ring" needs the archive before the ring, contradicting the order and O11 (a) | the ring mints `{epoch, seq}` first; `recordFeedEvent` returns void | Applied: the store refuses nothing; dedupe stays at the caller | C1f, D-5860 |
| A3, B4 | medium | one funnel shape cannot keep rows that pin flush placement and ring-throw handling; spec K6 stated a third order | `notifylog.ts` `record` cannot throw; `flush` is chained async | Applied: the pin asserts only observable facts (W0 C0c); the funnel's flush placement is free; spec K6 aligned. **Rejected in part:** A3's per-writer flush-placement option, not needed once the pin stops asserting it | C1c, spec K6 |
| B5 | medium | each hand pair prints its own degrade sentence; one is pinned by an existing suite | `child-reclaim-sweep.test.ts` ≈:2502 | Applied: `opts.degraded` | C1c, C1d, C1e |
| B6 | medium | `endDeadCoordinator`'s `recordRows` drops the rows after a failed archive | `endDeadCoordinator.ts` `recordRows` | Applied: `notify` returns the archive outcome; the loop stops on `'failed'` | C1c, C1e |
| A4 | medium | C1b's rewrite reds the ≈:2347–2351 `watch.ts` pin it did not list; rule 1's "imports only" cannot hold for rewritten text | `single-definition.test.ts` ≈:2350 | Applied: listed in C1b and re-pointed in its own commit; the global constraint names the exception | C1b, Global constraints |
| A5, B9 | medium, low | the fourth flag combination has no caller | every `recordOnly` call site also sets `recordAlways` | Applied: three modes; `pushOne`'s flag type narrows | C1c |
| A6 | medium | a branch-name path guard skips itself in CI | CI checks out a detached merge commit or `gh-readonly-queue/*`; nothing reads `GITHUB_HEAD_REF` | Applied: the guard is keyed on the diff | C1a, Global constraints |
| B2 (C1 half) | high | C1b's "two passes" cannot reach inside the act | as W0 B2 | Applied: C1b's characterization commit carries C0e's per-call late-read rows | C1b, focus 1 |
| B7 | medium | `releaseRetiredChildHold` is an unnamed second caller of `childReclaimPauseRead` | `childReclaim.ts` step 6 | Applied | C1b, focus 2 |
| B8 | medium | a rejecting `readdir` keeps `childReclaim`'s own sentence | `childReclaim.ts` ≈:1133–1141 | Applied | C1b, focus 2 |
| A7 | low | #397 also edits `coord/dispatch.ts`, `coord/stall.ts`, `shared/api.ts` | `gh pr view 397` | Applied, and superseded: #397 merged; its full list is recorded | Gates, In flight |
| A9 | low | C1a's mutant 4 names a suite that pins no count | W0 C0b pins no counts | Applied: single-definition only | C1a |
| B10 | low | `readSwitches` would add a second vocabulary beside `MarkerState` | `shared/api.ts` ≈:4044 | Applied: marker rows answer `MarkerState` | C1a, D-5855 |
| B11 | low | a funnel that builds its own record reorders catch-up keys for some writers | `notifylog.ts` stores `{ ...e, seq, at }` | Applied: the caller's record is spread unchanged; the catch-up row goes through each moved writer | C1c |
| B12 | low | readers map an unlistable registry differently | `coord/routes.ts` ≈:2634 (4bc6c756d) vs the mail lanes | Applied: `readSwitches` never resolves `'unmeasurable'`; the display reader is recorded | C1a |
| A10 | low | spec rev 1 remnants | spec lines | Applied in spec rev 2.1 (its §8, R4-6) | spec |
