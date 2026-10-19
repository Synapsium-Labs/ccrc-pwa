# Consolidation wave, W0 now: the pins W1a needs — the growth check, the writers pin and its census, the feed writers' modes and order, the `reclaim-paused` verdicts, the parser and the symbol-keyed slice — Implementation Plan

> **For agentic workers:** one PR per task, in the order of §Landing order, each dispatched only when its row in §Gates is all green. To execute a task, REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every step that adds a test. Steps use checkbox (`- [ ]`) syntax. Workers do not edit §Deviations and decisions. A departure is named by slug in the task's report; the coordinator enters it from this programme's issued block, never the worker.

**Spec:** `docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md` (rev 2, approved by the operator 2026-10-19). §5.1 (the rules every wave follows) and §5.2 (W0) bind every task; the clusters each task pins are named in its header. Read them before Step 0.

**Status:** rev 0 (2026-10-19). **The spec was approved by the operator 2026-10-19**, in their words: "answers locked" (the twelve decisions of its §6, each at its recommended option; O1 (d), the sliced W0 then W1a, clicked explicitly). This plan was written in the same docs PR as the spec's rev 2 and the W1a plan (`2026-10-19-consolidation-w1a-switches-notify.md`). Tasks dispatch as their gates open.

**Inputs.** The spec's §5.1 rules 1, 1b, 3 and 6, §5.2, K6 and K12 (the facts W1a moves), §2.1's rule (f) (one writer per fact); the Linear tickets ARCH-00 (CCRCP-97), ARCH-01 (CCRCP-98), ARCH-06 (CCRCP-126); the existing writer and holder scans in `server/test/single-definition.test.ts` (for example "deploy.sh is the only writer…" ≈:1457, "child-reclamation wave 4 — one 'reclaim-paused' literal" ≈:2337); the CI selector's rule 2 (`.github/ci/select-tests.mjs`, `RULE_NAMES` 2 `ALWAYS`: a test that reads `.git` is always selected).

**Base:** `origin/main` `f64c27b65`. Code is cited by file and by function, constant or `describe` title, with `≈` line hints measured at that sha. Step 0 of each task re-grounds them by content on the tree it starts from.

**Deploy class.** Tests and docs only. **Zero production bytes change**: no file under `server/src`, `agent/src`, `shared/`, `pwa/`, `ui/`, `ccd/` or `deploy/` is edited, and the ccd launcher's SHA-256 is unchanged. No deploy is needed for any task. The one non-test edit is C0f's exact `devDependency` pin in `server/package.json` and its lockfile, which ships nothing.

**Names.** Tasks are **C0a** to **C0g** (W0 now). The W1a plan's tasks are **C1a** to **C1f**. Operator acts are **OA-C1** to **OA-C3** (C1 and C2 here, C3 in the W1a plan). Later W0 slices (spec §5.2) get their own plans before the wave that needs them.

**Goal, PR by PR.**

| After | The operator sees | Underneath |
|---|---|---|
| `main` | nothing | no size check on any god file; no census behind the spec's counts; no pin on how a feed row is written or how a pause is read |
| C0a | a growth table in each PR's test output | `growth-check.test.ts`: net code-line growth of nine listed files against the merge-base, reporting only |
| C0b | nothing | `consolidationCensus.ts` with the named queries W1a's exits use; the writers pin for the two switches already at one writer |
| C0c | nothing | `feed-writers-pin.test.ts`, part 1: `pushOne`'s four flag combinations and the five writers outside `coord/` |
| C0d | nothing | the same pin, part 2: the ten writers in `coord/` and `stopDoneSweep.ts` |
| C0e | nothing | `reclaim-pause-pin.test.ts`: every reader's verdict, word for word, and "a pause raised between the pass and the act holds" |
| C0f | nothing | `server/test/scan/parse.ts`, the one TS parser wrapper (after OA-C1) |
| C0g | nothing | `server/test/scan/symbols.ts` and the literal source pins on W1a's files moved onto it |

---

## Gates: what each task waits for, stated honestly

Measured on 2026-10-19 at `f64c27b65` with `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,files` (26 open PRs; the dependency bumps edit only lockfiles, `package.json` files and `.github/workflows/*`).

- **#397** (path identity W1a) and **#737** (history 5h-1) both hold `server/test/single-definition.test.ts`: #397 one hunk at ≈:5917, #737 one at ≈:5237. C0b appends one `describe` after the file's last line (≈:7250), which is line-disjoint from both. No other task here edits a file an open PR holds.
- **#397** also changes the code C0c, C0d and C0e drive (`watch.ts`, `coord/routes.ts`, `coord/childReclaim.ts`, `coord/expireArchived.ts`, `server.ts`, `coord/reclaim.ts`). Their pin rows use ids valid under #397's id gate (Step 0 reads its id grammar from the PR), so its merge does not red them. If it does, #397 wins: the pin's row is re-grounded in a follow-up commit, and #397 never rebases (spec §5.1 rule 6).
- **#364** holds `.github/workflows/*`. No task edits a workflow: C0a and C0b read `.git`, so the selector runs them on every PR without one.
- **#424** bumps `typescript` in `ui/`, not `server/`. C0f pins its parser package in `server/package.json` exactly; no open PR holds that file outside the dependabot groups (#366, #367, #368), whose `package.json` hunks are version lines C0f does not touch. C0f merges `main` and re-runs `npm ci` if one of them lands first.
- **OA-C1** (the operator's parser choice for ARCH-00) gates C0f, and through it C0g. Nothing else here waits for an operator act.

| Task | #397 | #737 | #364 / deps | OA | Other |
|---|---|---|---|---|---|
| C0a growth check | no | no | no | — | — |
| C0b census and writers pin | disjoint (tail append) | disjoint (tail append) | no | — | — |
| C0c feed pin, part 1 | no (rows valid under its id gate) | no | no | — | — |
| C0d feed pin, part 2 | no (rows valid under its id gate) | no | no | — | C0c (shared fixture) |
| C0e pause pin | no (rows valid under its id gate) | no | no | — | — |
| C0f parser | no | no | merge `main` if a server bump lands | **OA-C1** | — |
| C0g symbol slice | no | no | no | — | C0f |

## In flight, and what it fences off

| In flight | Files it changes that this plan would otherwise touch | Tasks it gates |
|---|---|---|
| #397 | `server/test/single-definition.test.ts` (≈:5917) | none (C0b is a tail append) |
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
4. **A feed pin that assumes three modes.** `pushOne` has two independent flags, so the pin states all four combinations, and for each hand-written pair it records the record gate, the push, where the flush happens and whether a failed ring record is caught (spec K6, rev 2).
5. **A pause pin without the act-time row.** For every executor that re-reads the switch at the act (`coord/childReclaim.ts`, `coord/expireArchived.ts`, `coord/collectTempRoot.ts`, `coord/endDeadCoordinator.ts`), a pause raised after the pass decided and before the act runs holds the act. Deleting the act-time read is the mutant.
6. **A writers pin that is a freeze.** C0b pins only facts whose writer set is already at its target (spec §5.1 rule 3, rev 2). The feed archive's writer set is not pinned here; C1e lands it.

## Tasks

### Task C0a: the god-file growth check, reporting (D-5848; ARCH-01; spec §5.2) — lands now

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

### Task C0b: the census module and the writers pin for the facts at target (D-5849; ARCH-40; spec §2.1 rule (f), §5.1 rule 3) — lands now

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
  | `reclaimPauseParseSites` matches the bare word | consolidation-census | "12 files name it; 10 expressions parse it" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/consolidation-census.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

**Exit (GATES):** four named queries exist and each finds its cited site; the two writer sets are pinned at one and zero; zero production bytes.

### Task C0c: the feed writers' pin, part 1 — `pushOne` and the writers outside `coord/` (D-5850; ARCH-54's characterization half; spec K6) — lands now

**Routing:** band 2 (`/handoff`-able rows; the orchestrator reviews the table). **Lane:** tests only. **Needs:** nothing.

**Files:**
- Create `server/test/feedWriterFixture.ts`: a recording fake for the three sinks that logs every call in order into one array: `NotifyLog.record` (returns `{ epoch, seq }`), `NotifyLog.flush`, `CoordStore.recordFeedEvent`, `PushService.notify`, and a presence fake (`isVisible(id)` per session). Each sink can be told to throw once.
- Create `server/test/feed-writers-pin.test.ts`, part 1:
  - **`pushOne`'s four combinations** (driven through the lanes that call it, never by reaching into a private method): for `visible ∈ {true, false}` × `recordAlways ∈ {unset, true}` × `recordOnly ∈ {unset, true}`, the call log. Today: not visible records, flushes, archives and pushes unless `recordOnly`; visible records only with `recordAlways`, and never pushes.
  - **The order:** ring record, then flush, then archive, then push (the call log, exactly).
  - **Failure isolation:** a throwing `recordFeedEvent` leaves the ring record and the push in place (`watch.ts` ≈:3172).
  - **The writers outside `coord/`, one row each, with their sink calls in order and their failure isolation:** `watch.ts`'s two hand pairs (≈:4984, the collector's `run` row; ≈:5003, the collector's `coord` row), `interruptlog.ts` `recordInterrupt` (≈:53), and `server.ts`'s hand pair (≈:2485). For each: record gate (`always` or `unless-visible`), push (`never` or `unless-visible`), where the flush happens (in a `finally` or after), and whether a throwing ring record is caught.

- [ ] **Step 0: Re-ground.** Read each site and its docstring; write the expected call log for each in the PR body before writing a row. Find the narrowest existing seam each writer is reachable through (the collector lane's tests, `recordInterrupt`'s callers, the `server.ts` route under `inject`).
- [ ] **Step 1: Rows.** Write each row against `main`; it must be green.
- [ ] **Step 2: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `pushOne`: swap the archive and the flush | feed-writers-pin | "ring, flush, archive, push" |
  | `pushOne`: drop `if (visible && !e.recordAlways) return` | feed-writers-pin | "visible without recordAlways records nothing" |
  | `pushOne`: drop `if (e.recordOnly) return` | feed-writers-pin | "recordOnly never pushes" |
  | `pushOne`: remove the `try` around `recordFeedEvent` | feed-writers-pin | "a failed archive leaves the push" |
  | `watch.ts` ≈:4984: move the flush out of its `finally` | feed-writers-pin | "the collector's run row flushes after a failed archive" |
  | `interruptlog.ts`: drop the archive call | feed-writers-pin | "an interrupt is archived" |

- [ ] **Step 3: Verify.**

      cd server && ./node_modules/.bin/tsc --noEmit
      cd server && ./node_modules/.bin/vitest run test/feed-writers-pin.test.ts --maxWorkers=2

**Exit (GATES):** `pushOne`'s four combinations and 4 of the 15 hand-written pairs pinned (5 of the 16 call lines, `pushOne`'s included); zero production bytes.

### Task C0d: the feed writers' pin, part 2 — the writers in `coord/` and `stopDoneSweep.ts` (D-5851; ARCH-54's characterization half; spec K6) — after C0c

**Routing:** band 2 for the rows; the `coord/routes.ts` ≈:4545 row (the approval ruling's feed row) and the three `coord/childReclaim.ts` rows are on the approval and destructive paths, so **the orchestrator writes those four rows natively** (band 3) and a worker may write the rest. **Lane:** tests only. **Needs:** C0c (the shared fixture).

**Files:**
- Modify `server/test/feed-writers-pin.test.ts`, part 2, one row per writer, same four facts as C0c:
  - `coord/routes.ts`'s five pairs (≈:2485, ≈:2703, ≈:2859, ≈:3985, ≈:4545), each through its route under `inject`; the ≈:4545 row asserts the ruling is stored when the archive throws ("ruling stored, feed archive degraded");
  - `coord/childReclaim.ts`'s three (≈:1692, ≈:1719, ≈:1758), each "recorded and NEVER pushed" (≈:1679's ruling, "every reclaim lands in the feed; no push per reap"), whatever the presence;
  - `coord/expireArchived.ts` (≈:287), `coord/endDeadCoordinator.ts` (≈:280);
  - `stopDoneSweep.ts` (≈:159). It is pinned now and moves in W4; W1a never touches it.

- [ ] **Step 0: Re-ground** as C0c's Step 0, for these ten sites. Check that each `coord/` executor's row uses only fixture registries and a fake runner (SAFETY).
- [ ] **Step 1: Rows**, green on `main`.
- [ ] **Step 2: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `childReclaim.ts` ≈:1692: add a push | feed-writers-pin | "no push per reap" |
  | `childReclaim.ts` ≈:1719: gate the record on presence | feed-writers-pin | "every reclaim lands in the feed" |
  | `routes.ts` ≈:4545: let the archive's throw escape | feed-writers-pin | "ruling stored, feed archive degraded" |
  | `expireArchived.ts` ≈:287: drop the flush | feed-writers-pin | "expiry's row is flushed" |
  | `stopDoneSweep.ts` ≈:159: drop the archive call | feed-writers-pin | "stop-done's sleep has a feed row" |

- [ ] **Step 3: Verify** as C0c's Step 3.

**Exit (GATES):** all 16 call lines' writers pinned (`feedRecordCallSites()` lists 16, and every site in the list has a row); zero production bytes.

### Task C0e: the `reclaim-paused` verdict pin, and the mail switch's two definitions (D-5852; ARCH-70's characterization half; spec K12) — lands now

**Routing:** band 2 for the lane-selection rows; the four executors' act-time rows are on the destructive path, so **the orchestrator writes them natively** (band 3). **Lane:** tests only. **Needs:** nothing.

**Files:**
- Create `server/test/reclaim-pause-pin.test.ts`. One row per parse site (`reclaimPauseParseSites()`'s 10), each over three registry listings: marker present, marker absent, listing failed. Each row asserts the verdict word and its sentence byte for byte:
  - `coord/childReclaim.ts` ≈:1013 (`'set' | 'clear'`) and its `paused-at-server` deferral ≈:1123–1129;
  - `coord/collectTempRoot.ts` ≈:365 (`paused`, `why: 'raised'` or the unlistable cause, ≈:252–253's words);
  - `coord/endDeadCoordinator.ts` ≈:161–162 (the act-time `switch` verdict) and ≈:193–196 (the pass's `paused-at-server`);
  - `coord/expireArchived.ts` ≈:137–140;
  - `stopDoneSweep.ts` ≈:172 (with `stop-done-disabled` beside it);
  - `watch.ts` ≈:2858 (the switch summary's `reclaim` field), ≈:4065, ≈:5261 (with the expire capability), ≈:5471.
- **The act-time rows ("a pause raised between the pass and the act holds").** For each executor that re-reads at the act (`childReclaim`, `expireArchived`, `collectTempRoot`, `endDeadCoordinator`): the fake `FleetIO` lists clean for the pass and lists the marker on the executor's own read; the act does not run, the fake runner records no destructive argv, and the verdict names the pause.
- **The mail switch.** One row: `MAIL_DISABLED_MARKER` in `coord/rundefs.ts` and `watch.ts`'s private copy spell the same string, and a listing holding it stops `coord/dispatch.ts`'s dispatch (≈:515) and `watch.ts`'s mail lane alike.

- [ ] **Step 0: Re-ground.** List the 10 sites with `reclaimPauseParseSites()` if C0b has landed, or with `git grep -n "includes(RECLAIM_PAUSE_MARKER)"` if not; the PR body carries the list.
- [ ] **Step 1: Rows**, green on `main`.
- [ ] **Step 2: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `expireArchived.ts`: skip the act-time listing | reclaim-pause-pin | "a pause raised between the pass and the act holds: expiry" |
  | `childReclaim.ts` ≈:1123: treat a failed listing as clear | reclaim-pause-pin | "an unlistable registry cannot rule the pause out" |
  | `endDeadCoordinator.ts` ≈:162: drop the act-time check | reclaim-pause-pin | "…holds: dead coordinator" |
  | `collectTempRoot.ts` ≈:365: `why` always `raised` | reclaim-pause-pin | "the two causes are not one fact" |
  | `watch.ts` ≈:678: change the private copy's string | reclaim-pause-pin | "both spellings of mail-disabled agree" |

- [ ] **Step 3: Verify.**

      cd server && ./node_modules/.bin/tsc --noEmit
      cd server && ./node_modules/.bin/vitest run test/reclaim-pause-pin.test.ts --maxWorkers=2

**Exit (GATES):** 10 of 10 parse sites pinned; 4 of 4 act-time re-reads pinned; zero production bytes.

### Task C0f: one TS parser for the test scanners (D-5853; ARCH-00) — GATED: after OA-C1

**Routing:** band 2, orchestrator-reviewed (the ticket's own routing). **Lane:** tests only (a dev-only dependency). **Needs:** OA-C1.

**Files:** as the ticket (CCRCP-97) says, with the operator's option: create `server/test/scan/parse.ts` (`parseFile(path) → { imports, exportedTypeAliases, symbols }`, syntax only) and its self-test `server/test/scan-parse.test.ts`; pin the chosen package exactly in `server/package.json` (an option (a) alias or (b) package), or wrap `typescript/unstable/ast` (option (c)); add a scanner row to `single-definition.test.ts`'s ARCH-40 `describe` (C0b's tail block): only `scan/parse.ts` imports the chosen package. Record the choice and its reason in the spec's §8 log in the same PR.

- [ ] **Step 0: Re-ground.** Re-run the ticket's probe (`typeof require('typescript').createSourceFile` in `server/`) on the PR's base.
- [ ] **Step 1: Red.** The self-test parses a fixture holding an `import`, an `import type`, an exported literal union, a class method and an arrow property; red against `main` (no module).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.** A second test file importing the package directly is red ("only `scan/parse.ts` imports the parser"); a `^` range in place of the exact pin is red.
- [ ] **Step 4: Verify.**

      cd server && npm ci && ./node_modules/.bin/tsc --noEmit
      cd server && ./node_modules/.bin/vitest run test/scan-parse.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

**Exit (GATES):** one parser wrapper, one importer; the version is exact; zero production bytes.

### Task C0g: symbol-keyed source slices for W1a's files (D-5854; ARCH-06, the W1a slice) — GATED: after C0f

**Routing:** band 2. **Lane:** tests only. **Needs:** C0f.

**Files:**
- Create `server/test/scan/symbols.ts`: `sourceOfSymbol(file, 'FleetWatcher.pushOne')`, `callsIn(symbol)`, as the ticket says (`sqlStatementsIn` arrives with the slice that needs it), and its tests over methods, arrow-function properties and nested functions.
- Modify only the suites whose literal source pins read the code W1a moves: the feed pairs (the 16 sites), the `reclaim-paused` parse sites and both `MAIL_DISABLED_MARKER` definitions. Step 0 finds them. Each moves onto `symbols.ts` with its assertions unchanged. The two `single-definition.test.ts` blocks that pin where the `reclaim-paused` and `mail-disabled` literals live (≈:2337 and its neighbours) are **security- and switch-relevant censuses**: each moves in its own commit, never in bulk (ticket risk).
- Modify `server/test/single-definition.test.ts`'s ARCH-40 block: the ticket's ratchet predicate (a test file counts when it reads a `server/src` `.ts` path with `readFileSync`; a pin counts when `indexOf`, `toContain` or `match` is called with a literal on that variable), applied to **W1a's files only** for this slice, pinned at what it measures on merge day.

- [ ] **Step 0: Re-ground.** List every suite that reads `watch.ts`, `server.ts`, `interruptlog.ts`, `coord/routes.ts`, `coord/childReclaim.ts`, `coord/expireArchived.ts`, `coord/collectTempRoot.ts`, `coord/endDeadCoordinator.ts` or `coord/rundefs.ts` with `readFileSync` and asserts a literal over a region W1a moves. Check each against every open PR's file list; a suite an open PR holds waits for it, and the PR body says which.
- [ ] **Step 1: Throwaway refactor, recorded.** On a scratch branch, move `pushOne`'s body into a private helper: the listed suites are red before the rewrite and green after it. The PR body records both runs.
- [ ] **Step 2: Mutation table, RUN.** Adding one new literal `indexOf` pin on `watch.ts` is red (the ratchet); `sourceOfSymbol` on a renamed method throws by name.
- [ ] **Step 3: Verify** each modified suite alone, then `single-definition.test.ts`.

**Exit (GATES):** the literal source pins over W1a's moved regions: the Step 0 count → 0; the ratchet predicate pinned for W1a's files; zero production bytes. **Not in this slice:** the other files' literal pins (later slices, ahead of the wave that moves their code).

## Operator acts in this wave

- **OA-C1 (before C0f): the parser option for ARCH-00.** The ticket (CCRCP-97) offers (a) a pinned `devDependency` alias of an older TypeScript, (b) a standalone parser package, or (c) `typescript/unstable/ast` behind the wrapper. The ask presents all three with the ticket's risk line; the plan does not choose. Nothing on a box is touched.
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
- **D-5850** — `feed-writers-pin-outside-coord` (Task C0c; ARCH-54's characterization half): `pushOne`'s four flag combinations, its ring-flush-archive-push order and its archive-failure isolation are pinned through the lanes that call it, and so are the four hand-written pairs outside `coord/` (two in `watch.ts`, `recordInterrupt`, `server.ts`), each with its record gate, push, flush placement and ring-failure handling.
- **D-5851** — `feed-writers-pin-coord` (Task C0d; ARCH-54's characterization half): the same four facts for the ten writers in `coord/` and `stopDoneSweep.ts`, including "no push per reap" for the three child-reclaim rows and "ruling stored, feed archive degraded" for the approval ruling's row. The approval and child-reclaim rows are written natively.
- **D-5852** — `reclaim-pause-verdicts-pinned` (Task C0e; ARCH-70's characterization half): every `includes(RECLAIM_PAUSE_MARKER)` site's verdict and words are pinned over present, absent and unlistable listings; each of the four executors' act-time re-read is pinned as "a pause raised between the pass and the act holds"; and the two spellings of `mail-disabled` are pinned equal.
- **D-5853** — `one-scan-parser` (Task C0f; ARCH-00): one wrapper, `server/test/scan/parse.ts`, is the only importer of the TS parser the operator chose (OA-C1), pinned exactly.
  - **As planned:** the spec's rev 1 put ARCH-00 in a later slice; rev 2 moves it into W0 now because ARCH-06 depends on it.
- **D-5854** — `symbol-slices-for-w1a` (Task C0g; ARCH-06, first slice): `scan/symbols.ts` replaces literal source slices, and the suites that pin W1a's moved regions move onto it first, with the ticket's ratchet predicate applied to W1a's files.
  - **Departs from ARCH-06:** the ticket's exemplar suites (the stall-sweep tick order, the coord-store UPDATE census) are not W1a's and move in a later slice; this slice moves the suites W1a needs.

## Out of scope

Every later W0 slice (spec §5.2): ARCH-02a, ARCH-02b's programme ruling, ARCH-04, ARCH-23, ARCH-34, the pane corpus, the liveness truth table, the retire-verdict table. Any production byte.

## Review log

**rev 0 (2026-10-19).** Written from the spec's rev 2 and measured on `origin/main` `f64c27b65`. Not yet reviewed.
