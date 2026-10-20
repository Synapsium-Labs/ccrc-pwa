# Consolidation wave, W0 now: the pins W1a needs — the growth check, the writers pin and its census, the feed writers' modes and order, the `reclaim-paused` verdicts, the parser and the symbol-keyed slice — Implementation Plan

> **For agentic workers:** one PR per task, in the order of §Landing order, each dispatched only when its row in §Gates is all green. To execute a task, REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every step that adds a test. Steps use checkbox (`- [ ]`) syntax. Workers do not edit §Deviations and decisions. A departure is named by slug in the task's report; the coordinator enters it from this programme's issued block, never the worker.

**Spec:** `docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md` (rev 2, approved by the operator 2026-10-19). §5.1 (the rules every wave follows) and §5.2 (W0) bind every task; the clusters each task pins are named in its header. Read them before Step 0.

**Status:** rev 1 (2026-10-19): rev 0 with two reviews applied (§Review log). **The spec was approved by the operator 2026-10-19**, in their words: "answers locked" (the twelve decisions of its §6, each at its recommended option; O1 (d), the sliced W0 then W1a, clicked explicitly). This plan was written in the same docs PR as the spec's rev 2 and the W1a plan (`2026-10-19-consolidation-w1a-switches-notify.md`). Tasks dispatch as their gates open.

**Inputs.** The spec's §5.1 rules 1, 1b, 3 and 6, §5.2, K6 and K12 (the facts W1a moves), §2.1's rule (f) (one writer per fact); the Linear tickets ARCH-00 (#525), ARCH-01 (#526), ARCH-06 (#554); the existing writer and holder scans in `server/test/single-definition.test.ts` (for example "deploy.sh is the only writer…" ≈:1457, "child-reclamation wave 4 — one 'reclaim-paused' literal" ≈:2337); the CI selector's rule 2 (`.github/ci/select-tests.mjs`, `RULE_NAMES` 2 `ALWAYS`: a test that reads `.git` is always selected).

**Base:** `origin/main` `f64c27b65`. Code is cited by file and by function, constant or `describe` title, with `≈` line hints measured at that sha; hints added in rev 1 are measured at `4bc6c756d` (after #397 merged as `6ae03d2de`) and marked `(4bc6c756d)`. Step 0 of each task re-grounds them by content on the tree it starts from.

**Deploy class.** Tests and docs only. **Zero production bytes change**: no file under `server/src`, `agent/src`, `shared/`, `pwa/`, `ui/`, `ccd/` or `deploy/` is edited, and the ccd launcher's SHA-256 is unchanged. No deploy is needed for any task. The one non-test edit is C0f's exact `devDependency` pin in `server/package.json` and its lockfile, which ships nothing.

**Names.** Tasks are **C0a** to **C0g** (W0 now), plus **C0h** (ARCH-02a, a later W0 slice planned here). The W1a plan's tasks are **C1a** to **C1f**. Operator acts are **OA-C1** to **OA-C3** (C1 and C2 here, C3 in the W1a plan). Later W0 slices (spec §5.2) get their own plans before the wave that needs them.

**Goal, PR by PR.**

| After | The operator sees | Underneath |
|---|---|---|
| `main` | nothing | no size check on any god file; no census behind the spec's counts; no pin on how a feed row is written or how a pause is read |
| C0a | a growth table in each PR's test output | `growth-check.test.ts`: net code-line growth of nine listed files against the merge-base, reporting only |
| C0b | nothing | `consolidationCensus.ts` with the named queries W1a's exits use; the writers pin for the two switches already at one writer |
| C0c | nothing | `feed-writers-pin.test.ts`, part 1: `pushOne`'s three reachable flag combinations, the idle nudge's landing gate, and the four hand-written pairs outside `coord/` |
| C0d | nothing | the same pin, part 2: the ten writers in `coord/` and `stopDoneSweep.ts`, and `endDeadCoordinator`'s multi-row failure |
| C0e | nothing | `reclaim-pause-pin.test.ts`: every reader's verdict, word for word, over four listings, and "a pause raised during the act holds" at each executor's late read |
| C0f | nothing | `server/test/scan/parse.ts`, the one TS parser wrapper (after OA-C1) |
| C0g | nothing | `server/test/scan/symbols.ts` and the literal source pins on W1a's files moved onto it |

---

## Gates: what each task waits for, stated honestly

Measured on 2026-10-19 at `f64c27b65` with `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,files` (26 open PRs; the dependency bumps edit only lockfiles, `package.json` files and `.github/workflows/*`).

- **#397** (path identity W1a) **merged on 2026-10-19 as `6ae03d2de`**, after this plan's rev 0 was measured. Every pin is written on the tree after it, with ids valid under its id gate; it gates nothing here any more.
- **#737** (history 5h-1) holds `server/test/single-definition.test.ts` (one hunk, ≈:5237 at `f64c27b65`). C0b appends one `describe` after the file's last line (≈:7322 at `4bc6c756d`), which is line-disjoint from it. No other task here edits a file an open PR holds.
- **#364** holds `.github/workflows/*`. No task edits a workflow: C0a and C0b read `.git`, so the selector runs them on every PR without one.
- **#424** bumps `typescript` in `ui/`, not `server/`. C0f pins its parser package in `server/package.json` exactly; no open PR holds that file outside the dependabot groups (#366, #367, #368), whose `package.json` hunks are version lines C0f does not touch. C0f merges `main` and re-runs `npm ci` if one of them lands first.
- **OA-C1** (the operator's parser choice for ARCH-00) gates C0f, and through it C0g. Nothing else here waits for an operator act.

| Task | #397 | #737 | #364 / deps | OA | Other |
|---|---|---|---|---|---|
| C0a growth check | merged | no | no | — | — |
| C0b census and writers pin | merged | disjoint (tail append) | no | — | — |
| C0c feed pin, part 1 | merged | no | no | — | — |
| C0d feed pin, part 2 | merged | no | no | — | C0c (shared fixture) |
| C0e pause pin | merged | no | no | — | — |
| C0f parser | merged | no | merge `main` if a server bump lands | **OA-C1** | — |
| C0g symbol slice | merged | no | no | — | C0f |

## In flight, and what it fences off

| In flight | Files it changes that this plan would otherwise touch | Tasks it gates |
|---|---|---|
| #737 | `server/test/single-definition.test.ts` (≈:5237) | none (C0b is a tail append) |
| #366, #367, #368 | `server/package.json`, `server/package-lock.json` (version lines) | C0f merges `main` first if one lands |

No open PR holds `server/test/growth-check.test.ts`, `server/test/consolidationCensus.ts`, `server/test/consolidation-census.test.ts`, `server/test/feed-writers-pin.test.ts`, `server/test/reclaim-pause-pin.test.ts` or `server/test/scan/` (all new). C0g edits existing suites that read W1a's files; its Step 0 lists them and checks each against every open PR before it edits one. Each task re-reads every list at Step 0.

## Landing order

```
C0a (growth check, reporting) ─┐
C0b (census, writers pin) ─────┼── W1a's gate (with #397)
C0c (feed pin 1) ── C0d (feed pin 2)
C0e (pause pin) ───────────────┘
OA-C1 ── C0f (parser) ── C0g (symbol slice) ── W1a's gate
```

C0a to C0e are independent and may land in any order. C0c and C0d share one fixture module, so C0d follows C0c. Any of them may land standalone: each is a characterization or enforcement PR with counted exits (spec §6 O9 (a)).

## Global constraints

Every task's requirements include this section. `CLAUDE.md` is the authority; this is its working subset for the consolidation wave, and the W1a plan binds it by reference.

- **Public repository.** Every line, fixture, commit message and PR body is public. Fixtures use neutral names: sessions `acct-a-project-a` and `acct-b-project-a`, projects `project-a` and `project-b`, nodes `fleet` and `server`. No hostnames, IPs, tailnet names, account or lane names, emails, absolute home paths, other project names or people's names. Paths are written `~/.ccrc/…`, `$REG/…`. `server/test/topology-clean.test.ts` stays green.
- **SAFETY.** Nothing here runs `ccd` against a live `$HOME`, touches tmux, a live pane, `~/.cc-sessions` or a `claude-session@*` unit, or runs `ws-expire`, `ws-reclaim` or `ws-reap`. Every pin drives the server's code through its existing seams (fake `FleetIO`, fake `NotifyLog`, fake `PushService`, an in-memory `CoordStore`, Fastify `inject`) or `makeCcdHarness` fixture HOMEs.
- **Zero production bytes.** A task whose diff touches a production file is refused in review. The check: `git diff --name-only origin/main...HEAD -- server/src agent/src shared pwa ui ccd deploy` prints nothing.
- **No root runner.** Run cd'd into a package: `cd server && ./node_modules/.bin/vitest run test/<file> --maxWorkers=2`. Never bare `npx vitest` at the root, never the full server suite; one suite at a time, in the foreground, with a timeout of at least 600000 ms.
- **Characterization discipline** (spec §5.1 rule 1). A pin is green on `main` against today's code, and pins inputs to outputs, never source text. Each pin records at least one mutant: delete or reorder a guard, run the named suite alone, record the red line in the PR body, restore with `git checkout -- <file>`. Never commit a mutant.
- **Counts are measured, never typed.** Every count in a PR body or an exit comes from the census module's named query, run on the PR's tip.
- **Band routing.** Band 1: mechanical. Band 2: spec-able, one reviewer. **Band 3: anything on the swap, approval or destructive path, or a security boundary; written and reviewed natively, never handed off, two reviewers.** Each task's header names its band. W0 is band 1 to 2 by spec §5.1 rule 7: characterization rows are `/handoff` material, and the orchestrator reviews every diff.
- **Deviation ledger.** This plan defines D-5848 to D-5854 (§Deviations and decisions) and never allocates. No tracked file carries a concrete `D-TBD` placeholder (`dtbd.test.ts`).
- **Branch discipline.** One commit per task on the workspace's own branch; absorb `main` only with `git merge`; every commit leaves the suites it touches green.

## Review focus (the failure modes most likely to bite)

1. **A pin that reads source text.** Every C0c, C0d and C0e row calls code and asserts on what it returns, records or sends. A `readFileSync` of a `server/src` file in those suites is a STOP (C0g is where source slices live, and only through `symbols.ts`).
2. **A growth check that can red what is already in flight.** C0a reports and never fails until OA-C2. It holds no per-file absolute constant, so two concurrent PRs cannot conflict on it.
3. **A census that counts comments.** The `reclaim-paused` census counts `includes(RECLAIM_PAUSE_MARKER)` expressions, not files that name the marker (12 files name it, mostly in comments; 10 expressions in 6 files parse it). The feed census counts `recordFeedEvent(` call expressions outside `coord/store.ts`, not docstring mentions.
4. **A feed pin that asserts what production cannot observe.** `pushOne` has two independent flags, but only three combinations have a caller (every `recordOnly` caller also sets `recordAlways`); the pin drives those three through lanes and records the fourth as "no caller". For each hand-written pair it asserts only what production can see: the record gate, the push, the archive row, isolation of a throwing archive, the degrade sentence printed byte for byte, a flush after the ring record, and (for `endDeadCoordinator`) which rows survive a failure mid-batch. Where the flush sits relative to the archive, and whether a throwing ring record is caught, are recorded as observations in the PR body, never asserted: `NotifyLog.record` is in-memory and cannot throw, and `flush` is a chained async write (spec K6, rev 2.1).
5. **A pause pin without the late read.** Each executor reads the switch twice inside the act (expiry: step 2 and step 6, "NEAREST THE ARGV"; collect: its first and last reads; `endDeadCoordinator`: step 1 and `stillCrashed` inside `abandon`), and `releaseRetiredChildHold` reads it at its step 6. A row that raises the marker before the executor's first read cannot tell the two reads apart. The fake `readdir` is scripted per call, so the marker appears only from the late read on. Deleting the late read is the mutant, one per executor.
6. **A writers pin that is a freeze.** C0b pins only facts whose writer set is already at its target (spec §5.1 rule 3, rev 2). The feed archive's writer set is not pinned here; C1e lands it.

## Tasks

### Task C0a: the god-file growth check, reporting (D-5848; ARCH-01 (#526); spec §5.2) — lands now

**Routing:** band 2. **Lane:** tests only. **Needs:** nothing.

**Files:**
- Create `server/test/growthCheck.ts`: one comment-and-blank stripper per language. TS: strips `//` and `/* … */` comments (string- and template-aware) and blank lines. Bash: strips `#` comment lines and blank lines, and counts heredoc bodies separately (`<<'EOF'` … `EOF`, `<<-` included). `netGrowth(file, baseSha, headSha)` reads both blobs with `git show` and answers `{ base, head, delta }` in code lines.
- Create `server/test/growth-check.test.ts`. The listed files: `ccd/ccd`, `ccd/ccrc`, `ccd/session-hook.sh`, `server/src/watch.ts`, `server/src/coord/store.ts`, `server/src/coord/routes.ts`, `server/src/server.ts`, `server/src/sessionws.ts`, `pwa/src/lib/api.ts` (the union of spec §5.2 and the ARCH-01 ticket). It computes `git merge-base origin/main HEAD`, prints one table row per file (base, head, net delta) and a `GROWTH_OVER` list of files that grew by more than 40 net code lines, unless the same diff adds a new file under a path the waiver list names or shrinks another listed file by at least the same amount. The waiver list is `L1_L2_NEW_FILE_DIRS`, read from the 08-10 spec's ring table (`server/src/coord/` deciders and `shared/`), until ARCH-04 stage 1 replaces it with its classifier.
- **Reporting only.** The test never fails on growth. It has one `it` per listed file whose title carries the delta, and a single `GROWTH_ARMED = false` constant; while it is false an over-limit file is printed with `console.warn`. Arming is OA-C2: one commit flips the constant and nothing else. Outside CI, or with no `origin/main`, the test skips with a printed notice and never fails falsely.

- [ ] **Step 0: Re-ground.** Confirm the CI selector's `ALWAYS` rule fires for a test that reads `.git` (`.github/ci/select-tests.mjs`, rule 2), so no workflow edit is needed. Measure today's code lines of the nine files with the new stripper and record them in the PR body (not in the test).
- [ ] **Step 1: Red.** `growthCheck.ts`'s own rows: a TS sample with a `//` inside a string keeps its line; a `/* */` spanning lines is stripped; a bash heredoc holding `#` lines counts as heredoc, not code; an empty diff is delta 0. Each is red against `main` (no module).
- [ ] **Step 2: Green.** Write the module and the test.
- [ ] **Step 3: Mutation table, RUN** (on a throwaway branch, never committed).

  | Mutant | Suite | Expected |
  |---|---|---|
  | 41 code lines appended to `watch.ts` | growth-check | `GROWTH_OVER` names `watch.ts` |
  | 200 comment lines appended to `watch.ts` | growth-check | no warning |
  | 60 lines in `watch.ts` plus a new `server/src/coord/` decider | growth-check | no warning (waived) |
  | the stripper keeps `//` comment lines | growth-check | "a `//` comment line is not code" |
  | `GROWTH_ARMED = true` with the 41-line branch | growth-check | red (proves OA-C2's flip works) |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/tsc --noEmit
      cd server && ./node_modules/.bin/vitest run test/growth-check.test.ts --maxWorkers=2

**Exit (GATES):** the check runs on every PR (recorded: the selector's trace for this PR names it); zero production bytes. **OBSERVATION:** the nine files' code lines at `f64c27b65`, in the PR body. **Not in this task:** the CI job summary with FleetWatcher's method count (it needs ARCH-00's parser; it lands with C0f's follow-up in a later slice), and arming (OA-C2).

### Task C0b: the census module and the writers pin for the facts at target (D-5849; ARCH-40 (#775); spec §2.1 rule (f), §5.1 rule 3) — lands now

**Routing:** band 2. **Lane:** tests only. **Needs:** nothing (a tail append to `single-definition.test.ts`, line-disjoint from #397 and #737).

**Files:**
- Create `server/test/consolidationCensus.ts`. Each query is a named, exported function that returns the sites it found (`{ file, line, text }[]`), so a count is the list's length and a PR body can print the list:
  - `feedRecordCallSites()`: `recordFeedEvent(` call expressions under `server/src`, excluding `coord/store.ts` and comment lines. 16 on `f64c27b65` (`watch.ts` 3, of which `pushOne`'s is one; `coord/routes.ts` 5; `coord/childReclaim.ts` 3; one each in `coord/expireArchived.ts`, `coord/endDeadCoordinator.ts`, `interruptlog.ts`, `server.ts`, `stopDoneSweep.ts`).
  - `reclaimPauseParseSites()`: `includes(RECLAIM_PAUSE_MARKER)` expressions under `server/src`. 10 on `f64c27b65`, in 6 files.
  - `markerDefinitions(name)`: `const <X> = '<name>'` definitions of a marker literal under `server/src` and `shared/`. `mail-disabled`: 2 (`coord/rundefs.ts` ≈:50, exported; `watch.ts` ≈:678, private).
  - `markerLiteralFiles()`: files under `server/src` that spell any `$REG` marker literal (the spec's "46 marker-name literals"), recorded, gating nothing yet.
- Create `server/test/consolidation-census.test.ts`: each query runs, returns a list, and finds the site the spec cites (one known row per query, so a query that silently matches nothing is red). **No count is pinned here** (spec §5.1 rule 3, rev 2: a census reports until its series reaches its target).
- Modify `server/test/single-definition.test.ts`: append one `describe('one writer per fact (ARCH-40): the switches whose writer set is already at target', …)` after the last line. Two rows, each a writer set that may only shrink:
  - `reclaim-paused`: the one writer is ccd's `reclaim-pause` verb (`ccd/ccd`), reached from the server only through its `CCD_ARGV` row; no `server/src`, `agent/src` or `shared/` file writes `$REG/reclaim-paused` (a write is a `writeFile`/`touch`/`>` to a path ending in the marker).
  - `mail-disabled`: hand-only. No file in the tree writes it (`ccd/ccrc` ≈:23815 says "removable only by a human at a terminal").

- [ ] **Step 0: Re-ground.** Run each query on the PR's base and record its list in the PR body. Read the existing writer scans (`single-definition.test.ts` ≈:1457, ≈:2337, ≈:4275 "the four operator-switch markers have no writer in the tree") and reuse their write-detection helper if one is exported; if none is, the new `describe` defines its own in the same file, never a third copy elsewhere.
- [ ] **Step 1: Red.** Each census row and each writers row is written against a fixture tree first, so it can be shown red (a fixture with an extra writer, an extra parse site, a comment-only mention that must not count).
- [ ] **Step 2: Green** on the real tree.
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | a `writeFileSync(join(reg, 'reclaim-paused'), '')` added to `server/src/watch.ts` | single-definition | "reclaim-paused: one writer" |
  | a `touch "$REG/mail-disabled"` added to `ccd/ccd` | single-definition | "mail-disabled: hand-only" |
  | `feedRecordCallSites` counts comment lines | consolidation-census | "a docstring mention is not a call site" |
  | `reclaimPauseParseSites` matches the bare word | consolidation-census | "FIXTURE: an import, a comment, a template or a bare literal names the marker but is not a parse" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/consolidation-census.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

**Exit (GATES):** four named queries exist and each finds its cited site; the two writer sets are pinned at one and zero; zero production bytes.

### Task C0c: the feed writers' pin, part 1 — `pushOne` and the writers outside `coord/` (D-5850; ARCH-54 (#789)'s characterization half; spec K6) — lands now

**Routing:** band 2 (`/handoff`-able rows; the orchestrator reviews the table). **Lane:** tests only. **Needs:** nothing.

**Files:**
- Create `server/test/feedWriterFixture.ts`: a recording fake for the three sinks that logs every call in order into one array: `NotifyLog.record` (returns `{ epoch, seq }`, never throws, like the real one), `NotifyLog.flush`, `CoordStore.recordFeedEvent`, `PushService.notify`, and a presence fake (`isVisible(id)` per session). `recordFeedEvent` can be told to throw on its n-th call; `console.warn` is spied so each degrade sentence can be asserted byte for byte. The ring events are kept as recorded objects, so a row can compare `JSON.stringify` of what reaches catch-up (key order included).
- Create `server/test/feed-writers-pin.test.ts`, part 1:
  - **`pushOne`'s three reachable combinations** (driven through the lanes that call it, never by reaching into a private method): for `visible ∈ {true, false}` × {neither flag, `recordAlways`, `recordAlways` + `recordOnly`}, the sinks reached. Today: not visible records, archives and pushes unless `recordOnly`; visible records only with `recordAlways`, and never pushes. **The fourth combination** (`recordOnly` without `recordAlways`) has no caller on `origin/main` (every `recordOnly` call site also sets `recordAlways`); it is recorded in the PR body as "no caller", with the `git grep -n recordOnly server/src` list, not as a row.
  - **The order:** the ring record comes before the archive, and the archive before the push; a flush follows the ring record. Where the flush sits relative to the archive is recorded in the PR body as an observation, not asserted (it is unobservable in production).
  - **Failure isolation:** a throwing `recordFeedEvent` leaves the ring record and the push in place, and prints `pushOne`'s sentence, `— feed archive degraded, ring/push unaffected`, byte for byte (`watch.ts` ≈:3172).
  - **The idle nudge's landing gate** (`watch.ts` `idleNudgeOne`, ≈:6705–6713 (4bc6c756d)), through the idle-nudge lane with a fake tmux and queue: the archive throws → the nudge is not typed (no `sendPrompt` call) and the "the feed record did not land — nothing typed" line is printed; no `notifyLog` configured → nothing typed. This gate is not a dedupe and stays through W1a (spec K6, rev 2.1).
  - **The writers outside `coord/`, one row each:** `watch.ts`'s two hand pairs (≈:4984, the collector's `run` row; ≈:5003, the collector's `coord` row), `interruptlog.ts` `recordInterrupt` (≈:53), and `server.ts`'s hand pair (≈:2485). For each: record gate (`always` or `unless-visible`), push (`never` or `unless-visible`), the archive row, a flush after the record, and, with the archive throwing, the act's own result unchanged and the writer's degrade sentence byte for byte (for example `— interrupt answered, feed archive degraded`).

- [ ] **Step 0: Re-ground.** Read each site and its docstring; write the expected sinks, degrade sentence and observations (flush placement, ring-throw handling) for each in the PR body before writing a row. Find the narrowest existing seam each writer is reachable through (the collector lane's tests, `recordInterrupt`'s callers, the `server.ts` route under `inject`, the idle-nudge lane's suite).
- [ ] **Step 1: Rows.** Write each row against `main`; it must be green.
- [ ] **Step 2: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `pushOne`: push before the ring record | feed-writers-pin | "ring, archive, push" |
  | `pushOne`: drop `if (visible && !e.recordAlways) return` | feed-writers-pin | "visible without recordAlways records nothing" |
  | `pushOne`: drop `if (e.recordOnly) return` | feed-writers-pin | "recordOnly never pushes" |
  | `pushOne`: remove the `try` around `recordFeedEvent` | feed-writers-pin | "a failed archive leaves the push" |
  | `idleNudgeOne`: drop the `hasFeedEvent` check before `sendPrompt` | feed-writers-pin | "a row that did not land types nothing" |
  | `watch.ts` ≈:4984: move `void log.flush()` into the `try` body after `recordFeedEvent` | feed-writers-pin | "the collector's run row flushes after a failed archive" |
  | `interruptlog.ts`: reword the degrade sentence | feed-writers-pin | "recordInterrupt's degrade sentence" |
  | `interruptlog.ts`: drop the archive call | feed-writers-pin | "an interrupt is archived" |

- [ ] **Step 3: Verify.**

      cd server && ./node_modules/.bin/tsc --noEmit
      cd server && ./node_modules/.bin/vitest run test/feed-writers-pin.test.ts --maxWorkers=2

**Exit (GATES):** `pushOne`'s three reachable combinations, its archive-failure sentence and the idle nudge's landing gate pinned; 4 of the 15 hand-written pairs pinned (5 of the 16 call lines, `pushOne`'s included), each with its degrade sentence; zero production bytes.

### Task C0d: the feed writers' pin, part 2 — the writers in `coord/` and `stopDoneSweep.ts` (D-5851; ARCH-54 (#789)'s characterization half; spec K6) — after C0c

**Routing:** band 2 for the rows; the `coord/routes.ts` ≈:4545 row (the approval ruling's feed row) and the three `coord/childReclaim.ts` rows are on the approval and destructive paths, so **the orchestrator writes those four rows natively** (band 3) and a worker may write the rest. **Lane:** tests only. **Needs:** C0c (the shared fixture).

**Files:**
- Modify `server/test/feed-writers-pin.test.ts`, part 2, one row per writer, the same observable facts as C0c (record gate, push, archive row, a flush after the record, and with the archive throwing the act's result unchanged and the writer's degrade sentence byte for byte):
  - `coord/routes.ts`'s five pairs (≈:2485, ≈:2703, ≈:2859, ≈:3985, ≈:4545), each through its route under `inject`; the ≈:4545 row asserts the ruling is stored when the archive throws ("ruling stored, feed archive degraded");
  - `coord/childReclaim.ts`'s three (≈:1692, ≈:1719, ≈:1758), each "recorded and NEVER pushed" (≈:1679's ruling, "every reclaim lands in the feed; no push per reap"), whatever the presence;
  - `coord/expireArchived.ts` (≈:287), `coord/endDeadCoordinator.ts` (≈:280);
  - **`endDeadCoordinator`'s batch** (`recordRows`, one `try` over several rows): two dead-coordinator rows with the archive throwing on the first. Today the first row is in the ring, the second is in neither the ring nor the archive, and one degrade sentence (`— dead coordinator <what>, feed archive degraded`) is printed. The row asserts the ring contents and the archive rows;
  - `stopDoneSweep.ts` (≈:159). It is pinned now and moves in W4; W1a never touches it.

- [ ] **Step 0: Re-ground** as C0c's Step 0, for these eleven sites (ten in `coord/`, plus `stopDoneSweep.ts`). Check that each `coord/` executor's row uses only fixture registries and a fake runner (SAFETY).
- [ ] **Step 1: Rows**, green on `main`.
- [ ] **Step 2: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `childReclaim.ts` ≈:1692: add a push | feed-writers-pin | "no push per reap" |
  | `childReclaim.ts` ≈:1719: gate the record on presence | feed-writers-pin | "every reclaim lands in the feed" |
  | `routes.ts` ≈:4545: let the archive's throw escape | feed-writers-pin | "ruling stored, feed archive degraded" |
  | `expireArchived.ts` ≈:287: drop the flush | feed-writers-pin | "expiry's row is flushed" |
  | `stopDoneSweep.ts` ≈:159: drop the archive call | feed-writers-pin | "stop-done's sleep has a feed row" |
  | `endDeadCoordinator.ts` `recordRows`: one `try` per row | feed-writers-pin | "a failed archive mid-batch drops the rows after it" |
  | `childReclaim.ts` ≈:1720: reword the degrade sentence | feed-writers-pin, child-reclaim-sweep | "child reclaim kept, feed archive degraded" |

- [ ] **Step 3: Verify** as C0c's Step 3.

**Exit (GATES):** all 16 call lines' writers pinned (`feedRecordCallSites()` lists 16, and every site in the list has a row), each with its degrade sentence; `endDeadCoordinator`'s mid-batch failure pinned; zero production bytes.

### Task C0e: the `reclaim-paused` verdict pin, and the mail switch's two definitions (D-5852; ARCH-70 (#805)'s characterization half; spec K12) — lands now

**Routing:** band 2 for the lane-selection rows; the late-read rows are on the destructive path, so **the orchestrator writes them natively** (band 3). **Lane:** tests only. **Needs:** nothing.

**Files:**
- Create `server/test/reclaim-pause-pin.test.ts`. One row per parse site (`reclaimPauseParseSites()`'s 10), each over **four** registry listings: marker present, marker absent, listing `null` (the `FleetIO` adapters' fold), and `readdir` rejecting. Each row asserts the verdict word and its sentence byte for byte:
  - `coord/childReclaim.ts` ≈:1013 (`childReclaimPauseRead`, `'set' | 'clear'`) and its `paused-at-server` deferral ≈:1123–1129. A **rejecting** `readdir` keeps its own sentence here ("whether reclaim-paused is raised could not be read (<err>)"), while collect, expiry and `endDeadCoordinator` fold a reject into the unlistable sentence ("the registry did not list, so …"); both are pinned;
  - `coord/childReclaim.ts` `releaseRetiredChildHold` step 6 (≈:1549 (4bc6c756d)), the second caller of `childReclaimPauseRead`: present → `'changed'`, absent → continues to step 7, `null` → `'failed'`, rejecting → `'failed'` plus its warning;
  - `coord/collectTempRoot.ts` ≈:365 (`collectSwitches`: `paused`, `why: 'raised'` or the unlistable cause, ≈:252–253's words);
  - `coord/endDeadCoordinator.ts` ≈:161–162 (`stillCrashed`, the act's late `switch` verdict, "was raised during the act") and ≈:193–196 (the executor's step 1, `paused-at-server`). The lane's pass read is `watch.ts` ≈:5471;
  - `coord/expireArchived.ts` ≈:137–140 (`expirySwitches`, called at step 2 and again at step 6);
  - `stopDoneSweep.ts` ≈:172 (with `stop-done-disabled` beside it);
  - `watch.ts` ≈:2858 (the switch summary's `reclaim` field), ≈:4065, ≈:5261 (with the expire capability), ≈:5471 (the dead-coordinator lane's pass).
- **The coord frame's switch bytes.** One row: `emitCoord`'s `reclaim` field is `'set'`, `'clear'` or `'unmeasurable'` (the wire's `MarkerState`, `shared/api.ts`) for present, absent and `null`, asserted on the frame's bytes, so C1a's `readSwitches` can answer the same vocabulary without a translation.
- **The late-read rows ("a pause raised during the act holds").** The fake `readdir` is scripted per call: clean for the tick's listing and for the executor's first read, the marker raised only from the late read on. One row per late read:
  - expiry: raised during the fake audit, so step 6's `expirySwitches` sees it; no destructive argv, verdict `paused`;
  - collect: raised before its last read; no destructive argv;
  - `endDeadCoordinator`: raised inside `abandon`'s `stillCrashed` callback; the close does not run, verdict "was raised during the act";
  - `releaseRetiredChildHold`: raised before step 6; outcome `'changed'`, no release.
  - And the same shape for the lane-live markers those late reads carry: `expire-lane-live` removed before step 6 (outcome would-expire, nothing deleted), and the dead-coordinator lane disarmed during the act (`deadCoordinatorLaneArmed` false at `stillCrashed`).
- **The mail switch.** One row: `MAIL_DISABLED_MARKER` in `coord/rundefs.ts` and `watch.ts`'s private copy spell the same string, and a listing holding it stops `coord/dispatch.ts`'s dispatch (≈:515) and `watch.ts`'s mail lane alike.

- [ ] **Step 0: Re-ground.** List the 10 sites with `reclaimPauseParseSites()` if C0b has landed, or with `git grep -n "includes(RECLAIM_PAUSE_MARKER)"` if not, plus every caller of `childReclaimPauseRead`, `expirySwitches`, `collectSwitches` and `stillCrashed`; the PR body carries the list.
- [ ] **Step 1: Rows**, green on `main`.
- [ ] **Step 2: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `expireArchived.ts`: delete step 6's `expirySwitches` call | reclaim-pause-pin | "a pause raised during the act holds: expiry" |
  | `collectTempRoot.ts`: delete the last switch read | reclaim-pause-pin | "…holds: collect" |
  | `endDeadCoordinator.ts` ≈:162: drop the check in `stillCrashed` | reclaim-pause-pin | "…holds: dead coordinator" |
  | `childReclaim.ts` `releaseRetiredChildHold`: delete step 6 | reclaim-pause-pin | "…holds: retired-child release" |
  | `childReclaim.ts` ≈:1123: treat a failed listing as clear | reclaim-pause-pin | "an unlistable registry cannot rule the pause out" |
  | `childReclaim.ts`: fold a rejecting `readdir` into `null` | reclaim-pause-pin | "childReclaim names a read that failed" |
  | `collectTempRoot.ts` ≈:365: `why` always `raised` | reclaim-pause-pin | "the two causes are not one fact" |
  | `watch.ts` ≈:678: change the private copy's string | reclaim-pause-pin | "both spellings of mail-disabled agree" |

- [ ] **Step 3: Verify.**

      cd server && ./node_modules/.bin/tsc --noEmit
      cd server && ./node_modules/.bin/vitest run test/reclaim-pause-pin.test.ts --maxWorkers=2

**Exit (GATES):** 10 of 10 parse sites and `releaseRetiredChildHold` pinned over four listings; 4 of 4 executors' late reads and the two lane-live late reads pinned; the coord frame's switch bytes pinned; zero production bytes.

### Task C0f: one TS parser for the test scanners (D-5853; ARCH-00 (#525)) — GATED: after OA-C1

**Routing:** band 2, orchestrator-reviewed (the ticket's own routing). **Lane:** tests only (a dev-only dependency). **Needs:** OA-C1.

**Files:** as the ticket (#525) says, with the operator's option: create `server/test/scan/parse.ts` (`parseFile(path) → { imports, exportedTypeAliases, symbols }`, syntax only) and its self-test `server/test/scan-parse.test.ts`; pin the chosen package exactly in `server/package.json` (an option (a) alias or (b) package), or wrap `typescript/unstable/ast` (option (c)); add a scanner row to `single-definition.test.ts`'s ARCH-40 `describe` (C0b's tail block): only `scan/parse.ts` imports the chosen package. Record the choice and its reason in the spec's §8 log in the same PR.

- [ ] **Step 0: Re-ground.** Re-run the ticket's probe (`typeof require('typescript').createSourceFile` in `server/`) on the PR's base.
- [ ] **Step 1: Red.** The self-test parses a fixture holding an `import`, an `import type`, an exported literal union, a class method and an arrow property; red against `main` (no module).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.** A second test file importing the package directly is red ("only `scan/parse.ts` imports the parser"); a `^` range in place of the exact pin is red.
- [ ] **Step 4: Verify.**

      cd server && npm ci && ./node_modules/.bin/tsc --noEmit
      cd server && ./node_modules/.bin/vitest run test/scan-parse.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

**Exit (GATES):** one parser wrapper, one importer; the version is exact; zero production bytes.

### Task C0g: symbol-keyed source slices for W1a's files (D-5854; ARCH-06 (#554), the W1a slice) — GATED: after C0f

**Routing:** band 2. **Lane:** tests only. **Needs:** C0f.

**Files:**
- Create `server/test/scan/symbols.ts`: `sourceOfSymbol(file, 'FleetWatcher.pushOne')`, `callsIn(symbol)`, as the ticket says (`sqlStatementsIn` arrives with the slice that needs it), and its tests over methods, arrow-function properties and nested functions.
- Modify only the suites whose literal source pins read the code W1a moves: the feed pairs (the 16 sites), the `reclaim-paused` parse sites and both `MAIL_DISABLED_MARKER` definitions. Step 0 finds them. Each moves onto `symbols.ts` with its assertions unchanged. The two `single-definition.test.ts` blocks that pin where the `reclaim-paused` and `mail-disabled` literals live (≈:2337 and its neighbours) are **security- and switch-relevant censuses**: each moves in its own commit, never in bulk (ticket risk).
- **What symbol keying cannot rescue.** A slice keyed on a symbol survives code that moves; it does not survive code that is **rewritten**. A literal pin over text W1a rewrites (for example "watch.ts reaches the reclaim marker through the shared constant", `toContain('names.includes(RECLAIM_PAUSE_MARKER)')`, ≈:2347–2351, which C1b's rewrite of the four `watch.ts` sites turns red) is listed in Step 0's output as **re-pointed by W1a**, with the W1a task that re-points it in its own named commit. C0g does not touch it.
- Modify `server/test/single-definition.test.ts`'s ARCH-40 block: the ticket's ratchet predicate (a test file counts when it reads a `server/src` `.ts` path with `readFileSync`; a pin counts when `indexOf`, `toContain` or `match` is called with a literal on that variable), applied to **W1a's files only** for this slice, pinned at what it measures on merge day.

- [ ] **Step 0: Re-ground.** List every suite that reads `watch.ts`, `server.ts`, `interruptlog.ts`, `coord/routes.ts`, `coord/childReclaim.ts`, `coord/expireArchived.ts`, `coord/collectTempRoot.ts`, `coord/endDeadCoordinator.ts` or `coord/rundefs.ts` with `readFileSync` and asserts a literal over a region W1a moves. Check each against every open PR's file list; a suite an open PR holds waits for it, and the PR body says which.
- [ ] **Step 1: Throwaway refactor, recorded.** On a scratch branch, move `pushOne`'s body into a private helper: the listed suites are red before the rewrite and green after it. The PR body records both runs.
- [ ] **Step 2: Mutation table, RUN.** Adding one new literal `indexOf` pin on `watch.ts` is red (the ratchet); `sourceOfSymbol` on a renamed method throws by name.
- [ ] **Step 3: Verify** each modified suite alone, then `single-definition.test.ts`.

**Exit (GATES):** the literal source pins over W1a's moved regions: the Step 0 count → 0; the ratchet predicate pinned for W1a's files; zero production bytes. **Not in this slice:** the other files' literal pins (later slices, ahead of the wave that moves their code).

### Task C0l: the ring rules, stage 1 — L4-only fastify, `shared/*.ts` imports only `./`, no builtin in a `.mjs` the PWA reaches (D-6045; ARCH-04 (#545), stage 1) — lands now

A later W0 slice (spec §5.2), planned here so it has a section. **Routing:** native (band 2: it writes the first repo-wide ring rules, and which per-file pins they make redundant is a judgment). **Lane:** tests only; zero production bytes. **Needs:** nothing; no operator ruling (ARCH-04 says stage 1 is standalone). **Gates:** ARCH-00 (#915, `scan/parse.ts`), ARCH-02a (#874, the ring rules and the `.mjs` carve-out) and ARCH-03 (#894, #919) merged; all are. #826 edits `lifecycle.test.ts` (≈:1079, ≈:1278), #737 and #929 edit `single-definition.test.ts` (≈:5237; ≈:7538, ≈:7751), and #929 and #931 edit `scan/parse.ts` (≈:10, ≈:51, ≈:85, ≈:98, ≈:137, ≈:181) and `scan-parse.test.ts` (≈:6, ≈:96); this task's hunks in those files are line-disjoint from theirs, and its tree merges cleanly with each (#895, once listed here, merged as c2471e1bd). #927 holds this plan's lines after C0i's exit and around C0i's issued block, and #931 holds the lines after C0h's exit and after C0h's issued block; this section and D-6045's block sit before C0h's section and C0h's issued block, clear of both.

**Files:**
- Create `server/test/rings/walkSrc.ts`: the rules' one walk, `walkSrc({ roots, min, flat?, match? })`, which throws below its floor, and `REPO`/`rel`.
- Create `server/test/rings/exemptions.ts`: the `Entry` shape (`reason`, one line; `since`, a `YYYY-MM-DD` day not in the future) every data file uses, and `malformedEntries`.
- Create one rule per test file, each with its data file beside it:
  - `rings/fastify-l4.test.ts` + `fastify-l4.data.ts`: the `server/src`, `agent/src`, `pwa/src` and `ui/src` files that import `fastify` or `@fastify/*`, or bind a `Fastify*` name from any module, in any form (type import, per-name `type`, `export … from`, dynamic import, type query), are EXACTLY the allowlist, generated from the tree on the day the rule lands (11 files, all L4 by the ring rules).
  - `rings/shared-imports.test.ts` + `shared-imports.data.ts`: every edge of every `shared/*.ts` file, a type-only one included, names a `./` sibling. No exemption. The loads `scan/parse.ts` reports no edge for (its KNOWN WIDTH), a `require(…)` call and an `import(…)` whose argument is not a string literal, are refused anywhere in a `shared/*.ts` file's comment-stripped text, with a CONTROL. A `./` sibling that is a `shared/*.mjs` importing a builtin is left to `mjs-node`'s reach and carve-out.
  - `rings/mjs-node.test.ts` + `mjs-node.data.ts`: a `.mjs` file the PWA's bundle reaches imports no Node builtin (prefixed or bare), and a `shared/*.mjs` file imports none beyond ARCH-02a's carve-out (`node:crypto`, `node:fs`, `node:url`; the data is pinned to the 08-10 spec's sentence). Reachability follows Vite's resolution, `.mjs` before `.ts` for an extension-less specifier, from every `pwa/src` source over every runtime edge, through `@/` and `@ccrc/ui` into `ui/src`.
- Modify `server/test/scan/parse.ts`: a type query (`import('x').T`, `typeof import('x')`) is an edge of a new kind, `type-query`, always type-only. Additive: no consumer's verdict changes. `scan-parse.test.ts` gains its row.
- Delete the per-file L0 pins stage 1 makes redundant: a pin is redundant when every shape it refuses is an import edge `shared-imports` refuses, a `require(…)` call or non-literal `import(…)` it refuses, or a `./` sibling import, which the L0 ring allows, and it states no reason of its own beyond the ring. Retired: `single-definition`'s "shared/ask-menu.ts is L0: it imports nothing"; `update-semver`'s import row (its describe keeps the parse row); `claude-version`'s "shared/claudeVersion.ts is L0 and imports nothing"; `lifecycle`'s "is L0: imports nothing at all"; `providers`'s two "imports nothing at all" rows (`providers.ts`, `base-url.ts`); `routing-ladder`'s whole-source `node:` belt. **Kept, stricter for a reason of their own:** `docs-shared` (host globals), `base-url.test.ts` (the decision may not learn the table), `pool-rule-core` (type imports only, no clock), `peers-claims-l0` and `collect-lane-l0` (`shared/api.ts`'s exact type-only lines), `token-shared`, `routing-ladder`'s and `providers`'s exact import lists (an addition must be stated).
- Modify `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`: the "Import-direction test" and "No `reply` below L4" status rows name the stage 1 rules.
- **Not in this task:** stages 2 to 4 (outward edges, the PWA rules, one ring and one context per file), the 60-day re-date meta-rule, and C0a's waiver classifier (D-6046). No `single-definition` row is added.

- [ ] **Step 0: Re-ground.** On `origin/main`, list with `scan/parse.ts` every `server/src`, `pwa/src`, `agent/src`, `shared` and `ui/src` edge to `fastify`, `@fastify/*` or a `Fastify*` name (11 files, all `server/src`), every non-`./` edge in `shared/*.ts` (none) and every builtin in `shared/*.mjs` (`mark.mjs`: the three; `modelenv.mjs`: `node:fs`). Grep the suites for per-file L0 pins over `shared/*` and read each. `gh pr list --state open` with `gh pr diff` for every file touched.
- [ ] **Step 1: Red.** On a `git archive` of `origin/main` with the new test files copied in: `scan-parse.test.ts`'s type-query row is red (no such edge), and `fastify-l4`'s CONTROL is red on `import('fastify').FastifyReply` and `typeof import('fastify')`. Every rule is green on the tree: stage 1 stops new debt, and the tree has none.
- [ ] **Step 2: Green.** The `parse.ts` edge kind, the kit, the three rules and their data, the pin deletions, the status rows.
- [ ] **Step 3: Mutation table, RUN** (on a `git archive` copy, never committed).

  | Mutant | Check | Expected |
  |---|---|---|
  | `import type { FastifyReply } from 'fastify'` in `coord/close.ts` (acceptance) | fastify-l4 | red, listing `server/src/coord/close.ts` |
  | `import fs from 'node:fs'` in `shared/lifecycle.ts` (acceptance) | shared-imports | red, listing `shared/lifecycle.ts` |
  | `coord/close.ts` names `import('fastify').FastifyReply` in a parameter type | fastify-l4 | red, listing `server/src/coord/close.ts` |
  | `server/src/refuse.ts` dropped from the allowlist | fastify-l4 | red, listing `server/src/refuse.ts` |
  | an allowlist entry for `server/src/coord/close.ts`, which imports no fastify | fastify-l4 | red: stale entry |
  | an allowlist entry's reason blanked | fastify-l4 | red, naming the entry |
  | `import type { Deps } from '../server/src/deps.js'` in `shared/api.ts` | shared-imports | red: a type-only edge counts |
  | `import { readFileSync } from 'node:fs'` in `shared/models.mjs` (bundled through `../../../shared/models`) | mjs-node | red, listing `shared/models.mjs` |
  | `import path from 'node:path'` in `shared/mark.mjs` | mjs-node | red: beyond the carve-out |
  | a `pwa/src` file imports `../../../shared/mark.mjs` | mjs-node | red: `mark.mjs`'s three builtins reach the bundle |
  | the resolver tries `.ts` before `.mjs` | mjs-node | red: the CONTROL resolves `shared/models.ts`, and `base-url.mjs` leaves the reach |
  | `node:path` added to the carve-out data | mjs-node | red: the data is not the spec sentence |
  | `parse.ts` loses the type-query branch | scan-parse, fastify-l4 | red: the parse row and the CONTROL |
  | a walk's floor above its count | each rule | red: `walkSrc` throws "below the floor" |
  | `const fs = require('node:fs');` in `shared/lifecycle.ts` | shared-imports | red, listing `shared/lifecycle.ts` and `require(` |
  | `export const load = (s: string) => import(s);` in `shared/semver.ts` | shared-imports | red, listing `shared/semver.ts` and `import(` |
  | `import type { FastifyReply } from 'fastify'` in an `agent/src` file | fastify-l4 | red, listing the file |

- [ ] **Step 4: Verify.** From `server/`, one at a time with `--maxWorkers=2`: the three rules, `scan-parse`, `update-semver`, `claude-version`, `lifecycle`, `providers`, `routing-ladder`, `single-definition`; `tsc -p server` and `tsc -p server/test/tsconfig.tests.json`; then, after `git fetch -q origin main`, `deviation-refs`, `dtbd`, `topology-clean` and `docs-grammar`.

**Exit (GATES):** the three stage 1 rules hold the tree with no exemption and an 11-file fastify allowlist; both acceptance mutants are red; seven per-file pins are retired with their reasons; zero production bytes.

### Task C0h: decidable ring wording, contexts 7 to 9, the PWA ring map and the status tables (D-6000; ARCH-02a (#528); spec §2.1) — lands now

A later W0 slice (spec §5.2), planned here so it has a section. **Routing:** native (judgment: it writes the rules every ring scanner will assert). **Lane:** docs only. **Needs:** nothing; no operator ruling (the spec is approved at rev 2.1, and ARCH-02a says none is needed). **Gates:** none. #434 is another session's superseded PR and is not ridden (D-6001). CLAUDE.md is also edited by #842 and #851; this task's hunk (the "Rings / bounded contexts" bullet) is line-disjoint from both.

**Files:**
- Modify `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`:
  - (a) the timer rule under L3, and L4's "timers" read as "schedulers and pollers";
  - (b) the `.mjs` carve-out under L0, listing every `node:*` module it allows (`node:crypto`, `node:fs`, `node:url`);
  - (c) contexts 7 (Update control plane, `update/`), 8 (Auth & box token, `auth/`, `token/`) and 9 (Docs, `docs/`), each with its language and allowed dependencies, plus the **K** row (kernels and platform files, no aggregate);
  - (d) a new section, "Deciding a file's ring and context": the server and PWA ring predicates, the header declaration rule (outward only), and the path table between `ring-context-map` markers;
  - (e) a status table per increment and per enforcement item, each row naming its test file or ARCH ticket, and the "still open" lines re-verified against `main` by symbol.
- Modify `docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md`: §2.1's adoption bullet quotes the wording; C7 to C9 point at the 08-10 contexts.
- Modify `CLAUDE.md`: the "Rings / bounded contexts" bullet copies the timer, `.mjs` and PWA sentences word for word.
- No test file, no production byte. The proof is a throwaway checker in the scratchpad, never committed: ARCH-04 stage 4 is the committed assertion.

- [ ] **Step 0: Re-ground.** On `origin/main`: list `shared/*.mjs`'s `node:*` imports; read `CoordStore.bumpReplayCount`, `markIngested`, `markDelivered`, `rejectDelivery`, `backOff` and `FleetWatcher.sweepMail`'s use of them; list every timer call in `server/src` with where its handle lives; list every test the status tables will cite. `gh pr list --state open` for PRs holding the three files.
- [ ] **Step 1: Red (doc checks).** Two throwaway scripts: `map-check.mjs` parses the spec's `ring-context-map` table and the ring rules and lists every non-test `server/src` and `pwa/src` file that maps to zero or two rings or contexts; `word-check.mjs` asserts CLAUDE.md and the consolidation spec carry the 08-10 spec's timer, `.mjs` and PWA sentences byte for byte after whitespace folding. Both are red on `origin/main` (no table; no sentences).
- [ ] **Step 2: Green.** Write the spec, consolidation-spec and CLAUDE.md edits. `map-check` reports zero files with zero or two contexts; the ring predicates exclude each other by construction (ordered "any other file" clauses), so for rings it measures coverage, and it lists every header that names a ring token without a declaration the grammar accepts, each read by hand to confirm it is a reference to another file's ring and not the file's own. The timer rule is wired into the predicates (a deadline timer is an L3 fact, a scheduler or poller an L4 fact, in both packages), so no file has one ring by the predicates and another by the timer sentence. `word-check` passes. The PR body carries the per-ring and per-context counts.
- [ ] **Step 3: Mutation table, RUN** (on a `git archive` copy, never committed).

  | Mutant | Check | Expected |
  |---|---|---|
  | delete the `fleet/**` row from the table | map-check | the `fleet/` files no file row names are listed with zero contexts |
  | add `watch.ts` to C3's file rows as well as K's | map-check | `server/src/watch.ts` listed with two contexts |
  | duplicate the `session/**` directory row under C6 | map-check | every `session/` file no file row names listed with two contexts |
  | drop the scheduler/poller clause from the server L4 predicate | map-check | the ring counts change: `auth/sessions.ts`, `remote/client.ts`, `sessionws.ts` and `watch.ts` leave L4 (`token/driver.ts` stays, by its header) |
  | drop the deadline-timer clause from the server L3 predicate | map-check | the ring counts change: `inject/send.ts`, `livestate.ts` and `shutdownseal.ts` fall to L1 |
  | the header grammar loses the `— ` and `ring ` prefixes | map-check | `update/converge.ts` and `token/link.ts` fall to L1 and are listed as undeclared ring tokens |
  | CLAUDE.md's timer sentence loses "inside one adapter call" | word-check | red, naming the timer sentence |
  | the spec's carve-out drops `node:url` | word-check | red, naming the `.mjs` sentence |
  | D-6000 defined a second time, with another subject, in another plan | `deviation-refs.test.ts` | red (one number, two subjects) |
  | a concrete `D-TBD-<slug>` placeholder (a real slug) in the task section | `dtbd.test.ts` | red |

- [ ] **Step 4: Verify.** From `server/`, after `git fetch -q origin main`: `deviation-refs`, `dtbd`, `topology-clean`, `single-definition`, `docs-grammar`, one at a time with `--maxWorkers=2`. No `tsc` is needed (no TypeScript changes).

**Exit (GATES):** every non-test `server/src` and `pwa/src` file has exactly one ring and one context under the written rules (counts in the PR body); CLAUDE.md's restatement matches the spec word for word; the doc suites are green; zero production bytes. **Not in this task:** the committed scanner (ARCH-04), draining outward edges (ARCH-05), and `markDelivered`'s result (ARCH-15).

### Task C0i: consumer-side ports for the coordination lanes and the turn reads (D-6003; ARCH-03 (#541), first half) — lands now

A later W0 slice (spec §5.2), planned here so it has a section. **Routing:** native (band 1, literal moves, but every line sits in a file another open PR edits, so the line-disjointness check is the judgment). **Lane:** server types only; zero emitted bytes change. **Needs:** nothing; no operator ruling (the spec is approved at rev 2.1, and ARCH-03 says none is needed). **Gates:** ARCH-05 (#846) and ARCH-02a (Task C0h, #874) merged; both are. **Not yet:** the `Deps` move, which #850 blocks (D-6004). #434 is not ridden.

**Files:**
- Create `server/src/coord/ports.ts` (L2: every top-level statement is a type): `CcdResult` (moved from `lifecycle.ts`, docstring and all), `RunCcd`, and `FleetWatcherView` (the two pane-scraped reads `turnverdict.ts` takes), each with its failure contract.
- Modify `server/src/lifecycle.ts`: `CcdResult` is re-exported from `coord/ports.ts`; `CcdRunner` becomes `RunCcd`'s alias, so the runner type has one definition.
- Modify the seven coordination lanes that took `Deps['runCcd']`: `coord/childReclaim.ts`, `childSpent.ts`, `close.ts`, `collectTempRoot.ts`, `dispatch.ts`, `expireArchived.ts` and `fingerprint.ts`. Each swaps `import type { Deps } from '../server.js'` for `import type { RunCcd } from './ports.js'`, and `Deps['runCcd']` for `RunCcd`.
- Modify `server/src/turnverdict.ts`: `FleetWatcher` (from `watch.ts`) becomes `FleetWatcherView` (from `coord/ports.ts`).
- Create `server/test/inner-ring-host-imports.test.ts`: the files that import `server.ts` or `watch.ts` in any form (type-only, extension-less, dynamic, `typeof import`) are exactly a pinned outer set plus a pinned pending set. A CONTROL proves each outer member is L4 or L5 by a ring fact the spec states: `index.ts`, a `fastify` import, a timer handle kept on a field, or an L4 header declaration. A second CONTROL proves each pending member is not.
- Modify `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`: the "Import-direction test" status row names the new pin.
- `server.ts` and `watch.ts` are not touched. Nothing moves out of `watch.ts`: `FleetWatcher` is a runtime class and `FleetWatcherView` is a new port, so ARCH-03's "watch.ts re-exports the moved types" clause has nothing to re-export, and this task records that it does not apply to `watch.ts`. `server.ts`'s re-export of `Deps` comes with the `Deps` move (D-6004).

- [ ] **Step 0: Re-ground.** On `origin/main`, list every non-test `server/src` file that names `server.js` or `watch.js` in any import form, and decide each one's ring by the C0h rules. The issue's nine are the inner ones: `commands.ts`, `turnverdict.ts` and the seven lanes. Read what each takes. The seven take only `Deps['runCcd']`, `turnverdict.ts` takes two `FleetWatcher` reads, and `commands.ts` takes the whole `Deps`. Run `gh pr list --state open` with `gh pr diff` for every file touched. #870 (`collectTempRoot.ts` lines 2 and 151, `expireArchived.ts` line 1) and #877 (`dispatch.ts` after line 26) change no line this task changes, and one unchanged line separates each pair. #850 edits inside `Deps` (`server.ts` ≈:279–287).
- [ ] **Step 1: Red.** The new pin, run on `origin/main`, lists the eight drainable files beyond the pinned sets. Its CONTROLs pass on `main`: the scan sees every import shape, and every outer and pending member has the ring the pin claims.
- [ ] **Step 2: Green.** Make the moves above. `tsc` is clean, and the pin passes.
- [ ] **Step 3: Emit proof.** `tsc -p server --outDir` from a `git archive` of `origin/main` and from the branch: `diff -r` shows every existing emitted file byte-identical, and one new file, `coord/ports.js`, which is `export {};`. Nothing imports it at runtime, because every importer takes it as a type. The removed lines were type-only imports, which tsc already elided.
- [ ] **Step 4: Mutation table, RUN** (on a `git archive` copy, never committed).

  | Mutant | Check | Expected |
  |---|---|---|
  | `coord/close.ts` takes `import type { Deps } from '../server.js'` again | the pin | red, listing `coord/close.ts` |
  | `turnverdict.ts` takes `import type { FleetWatcher } from './watch.js'` again | the pin | red, listing `turnverdict.ts` |
  | `coord/fingerprint.ts` takes the host extension-less (`'../server'`) | the pin | red, listing `coord/fingerprint.ts` |
  | `coord/dispatch.ts` reaches the host through `typeof import('../server.js')` | the pin | red, listing `coord/dispatch.ts` |
  | `commands.ts` moved from the pending list to the outer list | CONTROL | red: `commands.ts` is not L4 or L5 by any ring fact |
  | `commands.ts` drains (its import removed) but stays pending | the pin | red: the pending entry must go with it |
  | the scan skips `import type` lines | CONTROL | red: the shape list loses `./server.js` and `./c.js` |
  | the fastify fact dropped from the ring facts | CONTROL | red for `coord/routes.ts`, `token/routes.ts` and `update/routes.ts` |
  | D-6003 defined a second time, with another subject, in another plan | `deviation-refs.test.ts` | red (one number, two subjects) |

- [ ] **Step 5: Verify.** `tsc -p server`. Then, one at a time with `--maxWorkers=2`, the new pin, `coord-policy-rings`, `docs-source` (it imports `CcdResult` and `CcdRunner` from `lifecycle.ts`), `archive-door`, `dispatch-live-gate` and `single-definition`. Then the doc suites from `server/`, after `git fetch -q origin main`: `deviation-refs`, `dtbd`, `topology-clean` and `docs-grammar`.

**Exit (GATES):** inner-ring importers of `server.ts`/`watch.ts` go from 9 to 1 (`commands.ts`, pending, D-6004). The pin holds the count, and the emit is byte-identical. No new `ports/` or `domain/` directory exists. **Not in this task:** `Deps`'s move to a type-only `server/src/deps.ts`, its re-export from `server.ts`, `commands.ts`'s import, and ARCH-02b's justification line. All of these are the second half, after #850 lands.

### Task C0j: the `ran` arm, step 1 of 2 — the runners say a command never ran, and the expiry and collect lanes read it first (D-6034; ARCH-10 (#543), its lower-churn landing path) — lands now

A later W0 slice (spec §5.2), planned here so it has a section. ARCH-10 is a consolidation PREREQUISITE: the spec's mapping table says "the retire executor must tell transport failure from refusal". Both runners forge `code: 1` when the command never ran or the link failed: `remote/runner.ts`'s catch arm (a disconnect, a timeout, `forbidden`) and `exec.ts` (a non-numeric exit becomes 1). `cutShort` answers `UNMEASURED` there, but only `dispatch.ts` consults it, so at every other `runCcd` site an agent drop reads as a ccd refusal. **This step** takes the issue's allowed lower-churn path: `ran` is an ADDITIVE optional arm, and only the two refusal-classifying lanes the issue names read it. **Step 2** (after consolidation W1a lands) makes `ran` required and migrates every other site, with a per-site arm table the orchestrator reviews. **Routing:** native. The lane hunks sit on the destructive path (`ws-expire`, `ws-collect`), so they are band 3 by §Global constraints: written natively, two reviewers. **Lane:** server. Production bytes change (D-6035). **Needs:** nothing; no operator ruling (ARCH-10 names none). **Gates:** ARCH-03 (#894, #919) and working-state Task 12 (D-5240) merged; all three are. **Deploy:** rides the next server release; nothing on a box is touched.

**Files:**
- Modify `server/src/unmeasured.ts` (the pure vocabulary leaf): `NotRanReason` (`transport`, `spawn`, `timeout`) and `NotRan` (`{ ran: false; reason; detail }`), defined once for both layers.
- Modify `server/src/exec.ts`: `ExecResult` becomes a union of today's shape with `ran?: true` and the same shape with `NotRan`. `realRunner` answers `ran: false, reason: 'spawn'` for a spawn error only (node names the syscall `spawn <cmd>`), and keeps every field it produced before, both kill halves included.
- Modify `server/src/remote/runner.ts`: the catch arm adds `ran: false`, the reason and the detail beside the forged `code: 1` and the stderr it already sent, and still sends neither kill half. The reason is read off the error's `name`, because `client.ts` imports this file: `AgentOpError` (the agent declined) is `spawn`, a plain `Error('timeout')` is `timeout`, and everything else is `transport`.
- Modify `server/src/coord/ports.ts`: `CcdResult` becomes the same two-arm union. On `ran: false` it keeps `ok: false` and every field it had before.
- Modify `server/src/lifecycle.ts`: `ccd()` carries the arm. A ran answer gains no key, so every reader and every whole-object `toEqual` is unchanged. `cutShort` and `ccdEnding` are untouched.
- Modify `server/src/coord/expireArchived.ts`: `expireAudit` reads `ran === false` before the document and answers `unreadable`, so the executor answers `audit-failed`. `expireAct` reads it before the box words and the composition dies and answers `failed`, resumable: the verb may have started, so this is the reader's own "may have been cut short" answer.
- Modify `server/src/coord/collectTempRoot.ts`: `collectAudit` and the act read `ran === false` before their readers and answer `no-document`, exactly as a rejection does. The act may have acted, so the lane keeps the id and the slot; it never reads a recognised die off a runner's words.
- Create `server/test/helpers/ranFakes.ts`: `ranOk(stdout, stderr)`, `ranExit(code, stdout, stderr)` and `notRan(reason, detail)`, so step 2's churn is mechanical.
- Create `server/test/ran-arm.test.ts`. Add `runCcdOldFoldSites` to `server/test/consolidationCensus.ts`, with its rows in `consolidation-census.test.ts`.
- Modify `server/test/remote-runner.test.ts`: the catch-arm pin was source text, because "the arm is unreachable through a client stub that resolves". It now drives a stub that rejects, and keeps its no-kill-claim source check. Modify `server/test/docs-source.test.ts`: the `ccd()` plant anchor moves one line, and the `res` helper takes the five shared fields, because `Partial` of the union would distribute over the new arm.

- [ ] **Step 0: Re-ground.** Re-check the gates with `gh pr view`. List the `runCcd(` sites in `server/src` (44 at `bed67053e`). Run `gh pr list --state open` with each PR's files: no open PR touches a production file this task edits. #911 holds `archived-expiry-lane.test.ts` and `archived-expiry-policy.test.ts`, and #826 holds `lifecycle.test.ts`, so the new rows go in a new file.
- [ ] **Step 1: Red.** `ran-arm.test.ts` and the fakes, copied onto a `git archive` of `origin/main`. It should give 23 red and 11 green (the controls, and the rows whose bytes do not change). The acceptance rows are red: a disconnect has no `ran`. An act whose runner words spell `ccd: bad token` is `composition` at expiry, which is never asked again, and the die `bad-token` at collect, which "acted nothing" and frees the slot.
- [ ] **Step 2: Green.** Make the changes above. Both `tsc` projects should be clean.
- [ ] **Step 3: Census.** `runCcdOldFoldSites` lists every `runCcd(` site not yet narrowed on `ran`. It skips a pass-through wrapper (`return await …runCcd(`) and a site whose assigned name is read as `<name>.ran === false` within 12 lines and before its declaration closes. It reports and pins no count (spec §5.1 rule 3): 44 sites, 1 pass-through and 4 migrated leave **39**, which step 2 drives to 0 and pins.
- [ ] **Step 4: Mutation table, RUN** (on a `git archive` copy, never committed).

  | Mutant | Check | Expected |
  |---|---|---|
  | the remote catch arm returns the old shape (no `ran`) | `ran-arm` | red: the disconnect acceptance row and every reason row |
  | `notRanReason` loses its `timeout` line | `ran-arm` | red: the client's own wait reads `transport` |
  | `notRanReason` loses its `AgentOpError` line | `ran-arm` | red: `forbidden` reads `transport` |
  | `realRunner`'s spawn check dropped | `ran-arm` | red: a missing binary has no `ran` |
  | `realRunner` says `ran: false` for any error | `ran-arm` | red: an exit 1 that ran carries `ran` |
  | `ccd()` drops the carry | `ran-arm` | red: the `CcdResult` row and both lanes' rows |
  | `ccd()` adds `ran` to a ran answer | `ran-arm` | red: "a ran answer reaches CcdResult with no new key" |
  | `expireAudit` loses its `ran` read | `ran-arm` | red: the audit rows' detail does not name the reason |
  | `expireAct` loses its `ran` read | `ran-arm` | red: `box` and `composition` come back |
  | `expireAct` answers `resumable: false` | `ran-arm` | red: the act rows want resumable |
  | the collect act loses its `ran` read | `ran-arm` | red: the die comes back |
  | the collect audit loses its `ran` read | `ran-arm`; `consolidation-census` | EQUIVALENT at `ran-arm`: `parseCollectAudit` reads an empty stdout as `no-document` with the same stderr, and the read is kept so the order is stated, not inferred. Red at the census: the site returns to the old fold |
  | the census drops its pass-through skip | `consolidation-census` | red: the fixture lists line 13 |
  | the census reads past its declaration's close | `consolidation-census` | red: the fixture's line 3 borrows the next declaration's narrowing |
  | D-6034 defined a second time, with another subject, in another plan | `deviation-refs` | red (one number, two subjects) |

- [ ] **Step 5: Verify.** `tsc -p server` and `tsc -p server/test/tsconfig.tests.json`. Then, one at a time with `--maxWorkers=2`: `ran-arm` and `consolidation-census`; `remote-runner`, `exec`, `lifecycle`, `docs-source` and `dispatch-adopt` (cutShort's readers); `expire-archived`, `expire-id-boundary`, `archived-expiry-lane` and `archived-expiry-policy`; `collect-temp-root`, `collect-switch-executor`, `collect-readers`, `collect-lane-scans`, `collect-id-pins` and `ws-collect-wiring`; `reclaim-pause-pin`, `feed-writers-pin` and `mail-routes` (the kebab scan of `coord/`); `verb-gate`, `coord-policy-rings`, `inner-ring-host-imports` and `single-definition`. Then the doc suites from `server/`, after `git fetch -q origin main`: `deviation-refs`, `dtbd`, `topology-clean` and `docs-grammar`.

**Exit (GATES):** a remote runner disconnect returns `ran: false` with reason `transport`. At the expiry and collect lanes, `ran: false` is unmeasured and retryable (`audit-failed`, a resumable `failed`, `no-document`) and never a classified refusal, box word, die or composition error. Every other site's behaviour is byte-identical: its suites are green unchanged, and the census lists it on the old fold. **Not in this task:** making `ran` required, the other 39 sites, and the per-site arm table. All of these are step 2, after W1a lands. Step 2's arm table also carries two remote-mode caveats. First, the agent's own exec still answers a spawn failure on the fleet box (ccd missing, not executable) as a ran exit 1, so in remote mode `ran` absent is not yet proof that the command ran; the agent must report spawn errors as their own answer before `ran` becomes required. Second, the remote runner's `spawn` covers every `AgentOpError`, and the agent can fail a request after its exec resolved, so no step-2 site may read `spawn` as "nothing acted, act again" without a fresh audit.

## Operator acts in this wave

- **OA-C1 (before C0f): the parser option for ARCH-00.** The ticket (#525) offers (a) a pinned `devDependency` alias of an older TypeScript, (b) a standalone parser package, or (c) `typescript/unstable/ast` behind the wrapper. The ask presents all three with the ticket's risk line; the plan does not choose. Nothing on a box is touched.
- **OA-C2 (after C0a, when ready): arm the growth check.** Flip `GROWTH_ARMED` to `true` in one commit. The ask lists the PRs that were open when C0a landed and grow a listed file, so the operator can wait for them to merge or name them exempt (spec §5.2, rev 2; O3 (a)).
- **No deploy.** W0 ships no production byte.

## Acceptance

Every PR body carries its mutation table's red lines, the census lists it relied on, and `git diff --name-only origin/main...HEAD -- server/src agent/src shared pwa ui ccd deploy` printing nothing. C0a's body carries the nine files' code-line table; C0f's records the operator's option.

## Rollback

Every task is a test or a dev-only dependency: `git revert` of its commit. Reverting C0b's writers rows reopens nothing a production path depends on. Reverting C0f after C0g needs C0g reverted first.

## Deviations and decisions

### Issued for this work and defined here

The allocator issued the consolidation wave a block of 30 numbers, 5848 to 5877, one per task. This plan defines D-5848 to D-5854; the W1a plan defines D-5855 to D-5860; the spec cites, never defines.

- **D-5848** — `growth-check-reports-first` (Task C0a; ARCH-01): the god-file growth check measures net code-line growth of nine listed files against the merge-base, with one stripper per language and no per-file absolute constant, and lands **reporting**: it never fails until the operator arms it (OA-C2).
  - **Departs from ARCH-01:** the ticket lands it red, with a CI job summary. Red on landing would stop PRs already in flight that grow a listed file, which O3 (a) ("nothing pauses") rules out; the summary's method count needs ARCH-00's parser and follows it. The file list is the union of the ticket's seven and the spec's §5.2 (adding `ccd/ccrc` and `sessionws.ts`).
- **D-5849** — `consolidation-census-and-writers-at-target` (Task C0b; ARCH-40): the wave's counts come from one census module of named queries that return their sites, and a census reports until its series reaches its target. The W0 writers pin covers only the two switches already at their target: `reclaim-paused` (one writer, ccd's `reclaim-pause` verb) and `mail-disabled` (hand-only, no writer in the tree).
  - **Departs from ARCH-40 as the spec's §4.2 sized it:** the writer sets for facts not yet at target (the feed archive among them) are pinned by the series that reaches each target (C1e for the feed), not in W0 (spec §5.1 rule 3, rev 2).
- **D-5850** — `feed-writers-pin-outside-coord` (Task C0c; ARCH-54's characterization half): `pushOne`'s three reachable flag combinations (the fourth has no caller), its ring-archive-push order and its archive-failure isolation are pinned through the lanes that call it, and so are the idle nudge's landing gate (a row that did not land types nothing) and the four hand-written pairs outside `coord/` (two in `watch.ts`, `recordInterrupt`, `server.ts`), each with its record gate, push and degrade sentence. Flush placement and ring-throw handling are observations, not assertions, because production cannot observe them.
- **D-5851** — `feed-writers-pin-coord` (Task C0d; ARCH-54's characterization half): the same observable facts for the ten writers in `coord/` and `stopDoneSweep.ts`, `endDeadCoordinator`'s stop-on-first-failure batch, including "no push per reap" for the three child-reclaim rows and "ruling stored, feed archive degraded" for the approval ruling's row. The approval and child-reclaim rows are written natively.
- **D-5852** — `reclaim-pause-verdicts-pinned` (Task C0e; ARCH-70's characterization half): every `includes(RECLAIM_PAUSE_MARKER)` site's verdict and words, and `releaseRetiredChildHold`'s, are pinned over present, absent, `null` and rejecting listings; each executor's late read inside the act is pinned with a per-call scripted listing ("a pause raised during the act holds"), so deleting it is red; the coord frame's `MarkerState` bytes are pinned; and the two spellings of `mail-disabled` are pinned equal.
- **D-5853** — `one-scan-parser` (Task C0f; ARCH-00): one wrapper, `server/test/scan/parse.ts`, is the only importer of the TS parser the operator chose (OA-C1), pinned exactly.
  - **As planned:** the spec's rev 1 put ARCH-00 in a later slice; rev 2 moves it into W0 now because ARCH-06 depends on it.
- **D-5854** — `symbol-slices-for-w1a` (Task C0g; ARCH-06, first slice): `scan/symbols.ts` replaces literal source slices, and the suites that pin W1a's moved regions move onto it first, with the ticket's ratchet predicate applied to W1a's files.
  - **Departs from ARCH-06:** the ticket's exemplar suites (the stall-sweep tick order, the coord-store UPDATE census) are not W1a's and move in a later slice; this slice moves the suites W1a needs.

### Departures entered by the coordinator

- **D-5865** — `pause-pin-tick-fold-for-lane-sites` (Task C0e, #871; extends D-5852): the four `watch.ts` lane sites and `stopDonePass` take the tick's listing, which cannot be `null` by type, so their `null` and rejecting legs are pinned once, at the tick, not per site: neither reaches any lane, a `null` listing gives an `unmeasurable` coord frame, and a rejecting one emits no frame at all.
  - **Departs from** Task C0e's "four listings per site" for those five sites only; every executor site keeps all four. The worker named it by slug and the coordinator entered it from the wave's held numbers, as this plan's header requires.

- **D-6059** — `c0g-no-rescuable-pins` (Task C0g, #929; extends D-5854): Step 0 found no literal pin over a W1a-moved region that symbol keying could rescue, so "each moves onto `symbols.ts`" moved nothing and Step 1's "red before" had no suite to show. The three in-region literal pins are W1a's rewrites (C1a, C1b).
- **D-6060** — `parse-calls-bindings` (Task C0g, #929; extends D-5853 and D-5854): C0g adds `calls` and `bindings` to C0f's `scan/parse.ts`, which C0g's Files line did not list, because `callsIn` and the counting rule need the syntax tree and only `scan/parse.ts` may import the parser.
- **D-6061** — `ratchet-counts-tomatch` (Task C0g, #929; extends D-5854): the literal-pin counting rule also counts `toMatch`, the `expect` spelling of the ticket's `match`.
- **D-6062** — `c0g-censuses-to-c1a` (Task C0g, #929; extends D-5854): the two `single-definition` holder-census blocks that C0g's Files line moved stay for C1a. They are whole-file censuses that W1a rewrites, and the W1a plan gives them to C1a (its Files, A1), so the W1a plan's line supersedes this plan's here.
- **The parser pin and Dependabot** (Task C0f, #915; D-5853): the `/server` block of `.github/dependabot.yml` ignores `typescript-api`, so a grouped minor or patch PR cannot move the exact pin the scanners rely on. A new version of the parser is a reviewed PR that edits the pin.

### Issued for Task C0l and defined here

Task C0l was issued three numbers, 6045 to 6047.

- **D-6045** — `ring-rules-stage-1` (Task C0l; ARCH-04, #545, stage 1): the repo-wide ring rules live one per test file under `server/test/rings/`, each over `scan/parse.ts` and the shared `walkSrc({ min })` floor, never in `single-definition.test.ts`; each rule's allowed or exempted entries live in its own `*.data.ts`, every entry with a one-line reason and a date, and each set is held exactly, so a stale entry is red. Stage 1 holds three rules: `fastify`, `@fastify/*` and every `Fastify*` name are imported, in any form, only by an L4 allowlist generated on the day the rule landed, across `server/src`, `agent/src`, `pwa/src` and `ui/src` (`fastify-l4`); a `shared/*.ts` file imports only its `./` siblings, a type-only edge included, and calls neither `require(…)` nor a non-literal `import(…)`, the loads `scan/parse.ts` reports no edge for (`shared-imports`); and a `.mjs` file the PWA's bundle reaches, by Vite's `.mjs`-first resolution, imports no Node builtin, while a `shared/*.mjs` file imports none beyond ARCH-02a's carve-out (`mjs-node`). `scan/parse.ts` reports a type query as a type-only edge of its own kind. A per-file L0 pin is retired when every shape it refuses is an import edge `shared-imports` refuses, a `require(…)` call or non-literal `import(…)` it refuses, or a `./` sibling import, which the L0 ring allows, and it states no reason of its own beyond the ring; a pin stricter for a reason of its own stays. A `./` sibling that is a `shared/*.mjs` importing a builtin is allowed by `shared-imports`; whether that builtin may reach the PWA is `mjs-node`'s reach and carve-out, not this rule.
- **D-6046** — `growth-waiver-stays-until-stage-4` (Task C0l): C0a's `L1_L2_NEW_FILE_DIRS` waiver list stays.
  - **Departs from** Task C0a's "until ARCH-04 stage 1 replaces it with its classifier". Stage 1's rules decide no file's ring: they hold three import facts. The classifier that gives every file one ring is stage 4, so the list is replaced there.

Issued and unused (Task C0l): 6047.

### Issued for Task C0h and defined here

Task C0h was issued three numbers, 6000 to 6002.

- **D-6000** — `ring-rules-decidable` (Task C0h; ARCH-02a): the 08-10 spec's ring rules are decidable from a file's own imports, timers and header: a deadline timer inside one adapter call is L3 and schedulers and pollers are L4 (a timer's handle says which: a local of one call or one not kept is a deadline, one stored on an object field or at module scope is a scheduler or poller), and both are facts the ring predicates use in both packages; the `.mjs` carve-out lists `node:crypto`, `node:fs` and `node:url`; contexts 7 to 9 and the K row join the map; the PWA rings are stated; one path table gives every `server/src` and `pwa/src` file one context; and the increments and enforcement items carry a status row each.
  - **Departs from ARCH-02a as written:** two rules were needed to keep the ring decidable on today's tree, and both are stated in the spec. `node:path`, `node:url`, `node:util` and `node:crypto` do not make a file L3, because the 08-10 L1 rule never forbade them and `coord/delegation-model.ts` hashes in L1. A file that acts only through the deps it is handed may declare its ring in its header, outward only, because by imports and timers alone fourteen files would read as L1 against their own stated ring (thirteen by their header, among them `hibernateSweep.ts`, `stopDoneSweep.ts`, `coord/mirror.ts`, `update/converge.ts`, `token/link.ts` and `accounts/audit.ts`, and `docs/ccdsource.ts` by its ring pin). Two files still decide L1 by rule though their comments call them adapters, because neither states its ring in a form the grammar accepts: `coord/store.ts` (it holds the handle it is handed) and `fleet.ts`; ARCH-04 or ARCH-05 gives each a header declaration.
- **D-6001** — `arch-02a-standalone` (Task C0h): the CLAUDE.md edit lands standalone and does not ride #434.
  - **Departs from** the spec's §5.2 ("ARCH-02a's CLAUDE.md edit rides #434 if that PR is still open") and ARCH-02a's routing line. #434 is still open, but it is superseded and belongs to another session, so riding it would tie this work to a PR nobody is landing. This task's CLAUDE.md hunk is line-disjoint from #434's, #842's and #851's.

Issued and unused (Task C0h): 6002.

### Issued for Task C0i and defined here

Task C0i was issued three numbers, 6003 to 6005.

- **D-6003** — `consumer-side-ports-coord-and-turn-reads` (Task C0i; ARCH-03): ports that a consumer below L4 takes from an L4 host are declared beside the consumer, in `server/src/coord/ports.ts` (L2). That file holds `CcdResult`, `RunCcd` (which `lifecycle.ts`'s `CcdRunner` aliases) and `FleetWatcherView`. No file below L4 imports `server.ts` or `watch.ts` in any form, and `server/test/inner-ring-host-imports.test.ts` holds that with an exact outer set whose ring each CONTROL proves. Declarations move, nothing is narrowed, and the emitted JS of every existing file is byte-identical.
  - **Second half (ARCH-03, after #850 merged):** `Deps` and its member `CollectLaneDeps` move to `server/src/deps.ts`, which is type-only (L2 by the ring rules, K by context: a composition-root type, not a domain layer). `server.ts` re-exports both, so no caller breaks, and `commands.ts` imports `deps.ts`. The pin's pending list is gone: no file below L4 imports either host. D-6004's departure is closed.
- **D-6004** — `arch-03-deps-move-after-850` (Task C0i): this task lands ARCH-03's ports half now. `commands.ts` stays the one pinned pending importer until `Deps` moves.
  - **Departs from ARCH-03 as written**, which moves `Deps` to a type-only `server/src/deps.ts` in the same change. #850 is open and adds a member inside `Deps` (`server.ts` ≈:279–287). Moving the declaration would delete that range, so it cannot stay line-disjoint from #850. The ports half touches no line any open PR changes. The `watch.ts` re-export clause does not apply, because nothing declared in `watch.ts` moves.

Issued and unused (Task C0i): 6005.

### Issued for Task C0j and defined here

Task C0j was issued three numbers, 6034 to 6036.

- **D-6034** — `ran-arm-additive-step-1` (Task C0j; ARCH-10, #543): a runner says when a command never ran, or may not have. `ExecResult` and `CcdResult` each gain an additive arm, `{ ran: false; reason: 'transport' | 'spawn' | 'timeout'; detail }`, defined once in `unmeasured.ts`. On that arm every field a reader had before is unchanged: the forged `code: 1`, `ok: false`, the runner's stderr, and the kill halves or their absence. `spawn` means it was never started, and that is known: a local spawn error, or the agent declining the request. `transport` means the link failed. `timeout` means this server stopped waiting. In both of those, whether it ran is unknown. A ran answer carries no new key. The expiry and collect lanes read `ran === false` before any reader of the runner's words, and answer unmeasured and retryable: `audit-failed`, a resumable `failed`, `no-document`. They never answer a refusal, a box word, a die or a composition error. `ranOk`, `ranExit` and `notRan` (`server/test/helpers/ranFakes.ts`) are the fakes step 2 uses. `runCcdOldFoldSites` counts the sites still on the old fold.
  - **Step 2 (ARCH-10, after W1a):** `ran` becomes required, every other `runCcd` site narrows on it, and the census pins 0. The PR lists each site's arm.
- **D-6035** — `c0j-ships-production-bytes` (Task C0j): this slice edits `server/src`.
  - **Departs from** this plan's Deploy class and §Global constraints ("Zero production bytes"). That rule is W0's characterization discipline: a pin must be green on `main`. ARCH-10 is a fix, not a pin, and the spec lists it among W0's later slices as a consolidation prerequisite. Every other constraint binds it, and its lane hunks are band 3.

Issued and unused (Task C0j): 6036.

## Out of scope

Every later W0 slice (spec §5.2) except ARCH-02a, which is Task C0h, ARCH-03's ports half, which is Task C0i, and ARCH-10's first step, which is Task C0j: ARCH-02b's programme ruling, ARCH-04, ARCH-23, ARCH-34, the pane corpus, the liveness truth table, the retire-verdict table. Any production byte outside C0j (D-6035).

## Review log

**rev 0 (2026-10-19).** Written from the spec's rev 2 and measured on `origin/main` `f64c27b65`.

**rev 1 (2026-10-19).** Two reviews (A, B). Each finding was re-measured on `origin/main` `4bc6c756d`, after #397 merged as `6ae03d2de`. Findings that touch only the W1a plan are in its log.

| # | Sev | Finding (short) | Checked against | Outcome | Where |
|---|---|---|---|---|---|
| A5, B9 | medium, low | `pushOne`'s fourth flag combination has no caller, so a lane cannot drive it | `git grep recordOnly server/src`: every call site also sets `recordAlways` | Applied: three reachable combinations pinned; the fourth recorded as "no caller" | C0c, D-5850, focus 4 |
| A8 | low | moving the collector's flush out of its `finally` is an equivalent mutant (the catch swallows) | `watch.ts` `collectRecordFeed` | Applied: the mutant moves the flush into the `try` body | C0c |
| A11 | low | "five writers outside `coord/`" and "these ten sites" miscount | the lists themselves | Applied: four pairs; eleven sites | Goal table, C0d |
| B2 | high | the act-time rows cannot tell an executor's first switch read from its late read | `expireArchived.ts` `expirySwitches` called at steps 2 and 6; `collectSwitches`; `endDeadCoordinator` step 1 vs `stillCrashed` | Applied: the fake `readdir` is scripted per call; one late-read row and one deletion mutant per executor, plus the two lane-live late reads; the ≈:193 label fixed to "executor step 1", the pass named as `watch.ts` ≈:5471 | C0e, D-5852, focus 5 |
| A3, B4 | medium | flush placement and ring-throw handling are pinned through a fake, though production cannot observe them; the funnel then cannot keep the rows | `notifylog.ts` `record` is in-memory and cannot throw; `flush` is a chained async write | Applied (B4's form): only observable facts are asserted; flush placement and ring-throw handling are PR-body observations. **Rejected in part:** A3's per-call flush-placement option for `notify` is not needed once the pin stops asserting it | C0c, C0d, focus 4 |
| B5 | medium | each hand pair prints its own degrade sentence, and an existing suite pins one | `child-reclaim-sweep.test.ts` ≈:2502 | Applied: every row asserts its writer's sentence byte for byte | C0c, C0d |
| B6 | medium | `endDeadCoordinator`'s `recordRows` drops the rows after a failed archive | `endDeadCoordinator.ts` `recordRows` | Applied: a mid-batch failure row and mutant | C0d, D-5851 |
| B1 (C0 half) | high | the idle nudge's `hasFeedEvent` after the record is a landing gate before a pane keystroke | `watch.ts` `idleNudgeOne` | Applied: C0c pins "archive throws → nothing typed" | C0c |
| B7 | medium | `releaseRetiredChildHold` is a second, unpinned act-time reader | `childReclaim.ts` step 6 | Applied | C0e |
| B8 | medium | a rejecting `readdir` is worded differently by `childReclaim` | `childReclaim.ts` ≈:1133–1141 vs the other three | Applied: a fourth listing, and a mutant | C0e |
| B10 (C0 half) | low | the wire already names the switch state `MarkerState` | `shared/api.ts` ≈:4044 | Applied: C0e pins the coord frame's bytes so C1a can reuse the vocabulary | C0e |
| A4 (C0 half) | medium | symbol keying cannot rescue a literal pin over text W1a rewrites | `single-definition.test.ts` ≈:2347–2351 | Applied: C0g lists such pins as re-pointed by W1a | C0g |
| A7 | low | #397's file list was incomplete | `gh pr view 397` | Superseded: #397 merged on 2026-10-19; the gates say so | Gates |
