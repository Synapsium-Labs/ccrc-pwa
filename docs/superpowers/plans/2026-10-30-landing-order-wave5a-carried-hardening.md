# Landing order, wave 5a — the hardening carried from waves 4c and 4b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close what the reviews of waves 4c and 4b carried to "wave 5", apart from the landing line itself (spec §5.5, which is wave 5).
- **The lineage parser:** it refuses the one null-tip shape the radar never writes, and its header states the rules it actually measures.
- **The radar lane:**
  - it checks each listed project name before it joins a path;
  - it bounds its reads, and its deadline covers the listing;
  - an abandoned pass never overwrites a newer map;
  - it says a thrown listing once per change;
  - it keeps an unreadable `.project` as a fact instead of folding it into the session's id.
- **The chip:** its sentence is capped, and each kind of cut has its own words.
- **The coordinator skill:**
  - the landing verdict keeps its strict rule, and the stop for a red that is `main`'s own names the new-head route;
  - a PR that landed in a merge train is proved on the `CLOSED` stop.
- **The rest are pins and text:** wider D-7514 scans, review 1222's three items, the clause 15 pin, and stale comments and titles.

**Why:**
- Every item here is minor, fails closed, is a gap in a test or guard, or is text. The ledger carries each one, by name, to wave 5.
- Wave 5's landing line adds new tables, routes, a `ccd` verb and PWA doors. Landing these first keeps its PR to that work alone. That is D-4329's reason, which also split wave 4b from 4c.

**Architecture:**
- **Task 1 (L1, `server/src/coord/lineage.ts`).**
  - The parser loses one dead arm and gains one rule: a `null` tip under a sha `base` is unreadable.
  - Its header is restated (D-7528, D-7529).
  - The landing lane gains one end-to-end case for a run sent back and then dequeued.
- **Task 2 (L3 `lineageRead.ts`, L1 `radar.ts` and `registry.ts`, L4 `watch.ts`).**
  - The pass refuses unsafe names and keeps them out of every path.
  - It runs at most `RADAR_PASS_CONCURRENCY` reads at once, under one deadline that covers the listing. A pass generation stops an overtaken pass from committing (D-7530, D-7531).
  - The registry record gains a server-internal `projectEvidence`, read by `radar.ts`'s `radarRowsOf` alone. A row whose `.project` is unreadable is stray in every project, so it can only make a landing read less clean (D-7532).
- **Task 3 (L1 `pwa/src/fleet/conflictWords.ts`).**
  - The summary keeps lists, not counts.
  - The sentence is capped by `CHIP_PATHS_MAX` and `CHIP_LINES_MAX`.
  - "(list cut)" is retired for three sentences of their own.
  - A guard pins `landingOf` as the PWA's one reader (D-7533 to D-7535).
- **Task 4 (tests, comments, the coordinator skill).**
  - The skill's §5b text names the new-head route in the `red-unreachable` stop's report, and the train-landed proof on the `CLOSED` stop. The verdict block stays byte-identical (D-7536, D-7537).
  - The D-7514 scan requires each listed reader and scans the server's readers for `new Date(` (D-7538).
  - The retire-verdicts guard compares modes and blob ids (D-7539).
  - The rest: the clause 15 pin, the cold-frame comments, two test titles and wave 3d's docstrings.
- **Task 5.** The gate, the mutation table, the PR and the wave-done.

**Tech Stack:** TypeScript (Node ≥ 22.16), React, vitest with jsdom, and the coordinator skill's Markdown with its verbatim pins.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`:
- §5.3, the radar and its console half;
- §5.4, the lineage acceptance;
- §5.7, the landing route, and §5.7.5's stops in particular.

**Other sources:**
- the ledger, `docs/superpowers/programs/landing-order.md`, Carried constraints:
  - "From wave 4c's review (1220) and its landing, carried to wave 5";
  - "From wave 4b's reviews (1225 and 1226), carried to wave 5";
  - "From review 1222 (the retire-verdicts fix, D-7496)";
  - "From wave 3e's review (1141)";
  - "From wave 4's review 1216".
- wave 4c's plan, `docs/superpowers/plans/2026-10-29-landing-order-wave4c-lineage-hardening.md` (D-7469, D-7470, D-7475, D-7495);
- wave 4b's plan, `docs/superpowers/plans/2026-10-29-landing-order-wave4b-radar-console.md`, and its departures note, `docs/superpowers/plans/2026-10-29-landing-order-wave4b-departures.md` (D-7514 to D-7523, and D-7526).

**Prerequisite:** wave 4b (#1923) and its ledger PR (#1936) are on `main`.

**Plan review.**
- **Drafting.** Each task was drafted against `main` by its own Opus reader. A separate Sonnet reader then checked it against `main`: every code claim, every red-first step and every mutation row's red. All 21 fixes it found are applied.
- **Review.** Three Opus lenses then reviewed the whole plan (executability, fidelity, proportion), and a Sonnet refuter checked each serious finding. Three important findings held, and each is answered:
  - `baseCcd`'s `root` parameter is added in the step that first needs it.
  - Row T3-13b moves the chip outside the runs line's conditional.
  - Two guards that had no red now have one (T2-21, T4-19).
- **Minors.** Each minor finding is answered too. The review's cut list removed drafting history and repeated rules.

## What this does not claim
- **Not the landing line.** No landing entries, intents or holds, no `land-candidate`, no PR-keyed `pr-state`, and no server reader of `main-health`. Wave 5 (spec §5.5) does that.
- **No edit to three ccd files.** It does not touch `ccd/ccd`, `ccd/session-hook.sh` or `ccd/ccd-land-probe`. Their carried items stay carried to the next wave that edits each file (Carried constraints):
  - the hook's items from wave 2b's reviews and review 228;
  - wave 3d's "at or one second before" sentence, carried to the next wave that edits `ccd/ccd`, the README, the spec and `prstate.ts` together;
  - the single-page `rules/branches` reads in `ccd/ccd` and `deploy/measure-landing.py`;
  - the probe's items from wave 3b's reviews.
- **The landing verdict's behaviour is unchanged.** The §5b block is byte-identical (D-7536).
- **It does not decide whether the coordinator may take the new-head route unasked.** Spec §5.7.5 makes a red that is not the PR's own a stop, when it is not a GitHub Actions run or is still red after the one rerun. Wave 4c's landing took the route under D-7495, and whether that becomes the coordinator's own act is the operator's to rule.
- **No wire change.** `projectEvidence` is server-internal, and `FLEET_PROTO` is untouched.
- **It does not prove a doc came from the radar.** The lineage parser's rules are rules the radar's writers keep. A hand-written doc that keeps every one of them still parses (D-7528).

## Global Constraints
- **Public repository.**
  - Fixtures use neutral names: `proj-a`, `ws/alpha`, `lane-a`, `t@example.invalid`.
  - No added line holds a host, lane, account or private name.
- **Fail closed.**
  - Every new refusal answers a word that already exists, with one exception:
    - the existing words are `unreadable`, `late`, `lineage-unreadable` and the `red-unreachable` stop;
    - the exception is `refused`, a new internal reason on `RadarPassRead` (D-7530). It is never on the wire, and like `unreadable` it contributes no landing.
  - No accept row widens, and no refusal code is added or loosened.
- **The wire is additive only.**
  - No `FleetSession` field is added, and `FLEET_PROTO` is unchanged.
  - `SessionRecord.projectEvidence` is server-internal and is never serialised.
- **Rings.**
  - `lineage.ts` and `conflictWords.ts` stay L1, with their import blocks.
  - `radar.ts` stays L1. It gains one type-only import, `ProjectEvidence` from `registry.ts`. The ring checks do not count a type-only edge, and `registry.ts` is L1 too, so the edge is not outward either way.
  - `lineageRead.ts` stays L3, and `registry.ts` stays L1.
  - `watch.ts` (L4) gains a pass generation and its commit check, and decides nothing else.
- **Single definitions.**
  - `RADAR_PASS_CONCURRENCY = 8` is defined in `lineageRead.ts`.
  - `CHIP_PATHS_MAX = 3` and `CHIP_LINES_MAX = 5` are defined in `conflictWords.ts`.
  - Each is defined once, and tests pin its value as a literal, never through the constant.
  - The two chip caps carry a defined-once guard. `RADAR_PASS_CONCURRENCY` has its value pinned but no such guard, like the radar's other constants on `main`.
  - `isSafeProjectSegment` (`ledgerseed.ts`) and `printableDetail` (`update/inventory.ts`) are reused, never copied.
  - The pass deadline stays `LANDING_RADAR_SWEEP_MS / 2` (30 000 ms).
- **The `landingRadar` lane row is unchanged:** cadence `60_000`, flight `'skip'`, `staleAfterMs` and `warnKey`.
- **Growth.**
  - `watch.ts` and `server.ts` are growth-listed.
  - Task 2 adds net code lines to `watch.ts`: about 0 for Part A and about 3 for Part B. Measure and record the figure.
  - Task 4 changes `server.ts` and `watch.ts` in comment lines only. Its baselines are the `watch.ts` delta recorded at Task 2's Step 9, and 0 for `server.ts`.
  - Run `growth-check` with `GROWTH_CHECK=1` after `git fetch origin main`, and report its figures.
  - If a listed file passes its limit, stop and report before adding any waiver.
- **The skill.**
  - Pins move in the same commit as their text.
  - The nineteen clauses and `SKILL.md` are unchanged.
  - No new skill sentence holds a double quote.
  - The §5b verdict block is byte-identical (D-7536).
- **Citations.** Cite code by symbol or `@anchor`, never by file and line, in comments, test text and skill text.
- **Mutations.**
  - Every new guard has a measured red.
  - Mutate in the worktree, sequentially, and bound each run with `timeout -k` and a measured `ulimit -u`. A row that needs a scratch git fixture builds one.
  - A file that a mutant alone edits is claimed for that row, as each task's Files block names it.
  - Restore each mutated file from a saved copy, with its sha256 checked, never with `git checkout`.
  - Keep each row's log under the worktree's `.superpowers/sdd/`.
- **Tests.**
  - Use fixture HOMEs and scratch git repositories only. Never run `ccd`, `ccrc`, `tmux` or `gh` against the live HOME.
  - Run suites in the foreground, one file per process, with a timeout of at least 600 000 ms.
  - Run typechecks and many-file runs through `~/.local/bin/ccrc test`.
- **Deviation numbers are issued, never chosen.**
  - This plan's block is D-7528 to D-7539, and the plan defines all twelve.
  - A departure found during execution is named by slug in the wave-done (`D-TBD-<slug>`), and the coordinator numbers it.
- **Commits** go on the workspace's own branch. Never update-branch, rebase or force-push.

## Review Focus
1. **An unreadable `.project` never makes a landing read cleaner.** The row's branch is stray in every project, so a null-`id` radar head on it sets `cut.unbound` and the landing is partial. When nothing is in conflict the chip says partly measured. When something is, it adds the unbound sentence beside the conflicts.
2. **The lane always settles.** Under a hung listing, a hung read, or a pass overtaken by a newer one, it settles by the deadline and frees its slots. It never commits an older map over a newer one, and never speaks for one.
3. **The capped sentence hides no partial reading.** The cut sentences and the "not measured" and "not paired" clauses always show. Only three things are dropped, each with "and N more": conflict lines past `CHIP_LINES_MAX`, paths past `CHIP_PATHS_MAX` on a line, and PRs past `CHIP_PATHS_MAX` in a clause.
4. **Every shape the radar writes still parses.** The only newly refused doc is a null tip under a base. It answers `lineage-unreadable`, an unmeasured answer, never an accept.
5. **§5b keeps the strict rule.**
   - The any-run-red rule still decides: a required name that failed and then passed on one head prints `RED`.
   - A train-landed PR is proved on the `CLOSED` stop by step 3's own proof alone.
   - The RED bullet's one rerun does not clear a red that is `main`'s own, because it replays the old merge commit.
   - Once the stop is `red-unreachable`, no further rerun and no close and reopen is offered. The report names the new-head route (D-7536).

---

### Task 1: the lineage parser

Three items from wave 4c's review (4c F2, F3/F4 and F8). The parser loses a dead arm, refuses one doc shape the radar never writes, and its header states the rules it actually checks. The landing lane gains one case that drives `sweepLanding` end to end for a run that was sent back and then dequeued. No server code outside `lineage.ts` changes.

The F8 lane case is green on main (it pins D-7470); mutants T1-4 and T1-5 measure its red.

**Files:**
- Modify: `server/src/coord/lineage.ts`. Changes: the header, `LineageDoc`'s doc comment, and `parseLineage`, which gains one rule and loses one arm. No new export and no new string literal.
- Test: `server/test/coord-lineage.test.ts`. One new describe, and one existing comment amended.
- Test: `server/test/pr-queue-lane.test.ts`. One new case in the describe "the landing briefs carry the run's recorded episode head (landing order wave 4, D-7102)".
- Run, unmodified: `server/test/coord-fingerprint.test.ts`, `server/test/landing-verdict.test.ts`, `server/test/run-routes.test.ts`, `server/test/ccd-land-lineage-accept.test.ts`.
- Not modified: `server/src/coord/landing.ts` and `server/src/watch.ts`. F8 pins their behaviour. Only the mutants touch them, and each is claimed for T1-4 and T1-5 alone.

**Interfaces:**
- Consumes: `parseLineage(content: string, expect: { project: string; id: string; branch: string }, nowMs: number): LineageRead` and `decideLineage(i: LineageInput): LineageDecision`, both as on main. From the lane: `landingVerdict(a: LandingAsk, f: LandingFacts): LandingStep` and `FleetWatcher`'s private `sweepLanding`, both unchanged.
- Produces:
  - **Signatures:** `parseLineage` keeps the same signature and the same `LineageRead` / `LineageDoc` types. `LineageDoc.tip` stays `string | null`, and only its doc comment narrows to "only in a failed-fetch doc (no `base`)".
  - **Behaviour change:** a doc whose `tip` is `null` and whose `base` is a sha now answers `{ ok: false, reason: 'unreadable' }`. On main it answered `ok: true`. Through `decideLineage`, that doc moves from `{ answer: 'unmeasured', detail: 'tip-unmeasured' }` to `{ answer: 'unmeasured', detail: 'lineage-unreadable' }`.
  - **Unchanged:** every other doc keeps its verdict. `decideLineage`'s `tip-unmeasured` row stays reachable through the failed-fetch shape with a `null` tip.

**Design.**
- **4c F2.** `parseLineage`'s `state`/`stop` line becomes `if (measured && stop === 'unmeasured') return bad;`. Its comment becomes: "A measured walk never says it was cut (fix round 1, F1). An unmeasured doc's stop is the two base rules' below."
  - The unmeasured arm (`!measured && stop !== undefined && stop !== 'unmeasured'`) is subsumed. With a base, the base-bearing-unmeasured rule (`!measured && base !== undefined && stop !== 'unmeasured'`) refuses it. With no base, the no-base-no-stop rule (`!measured && base === undefined && stop !== undefined`) refuses it.
  - After the deletion, case (c) of the describe "parseLineage: the radar writes three shapes only (fix round 1, F1)" is refused by the base-bearing-unmeasured rule alone. Case (d) is refused by the kept arm alone.
  - Amend that describe's leading comment ("(a) and (b) are still refused twice …; (f) is the chain rule alone.") to add: "(c) is the base-bearing-unmeasured rule alone since wave 5a, and (d) the measured-stop rule alone."
- **4c F3/F4.** Directly after the `base` sha check, add:
  ```ts
  // A null tip is a failed fetch's alone: `lineage_unmeasured` writes no base, and a walk always has a tip (D-7529, narrowing D-7269).
  if (tip === null && base !== undefined) return bad;
  ```
  - The comment above the `tip` check becomes: "A `null` reads as absent (D-7269). A `tip` is a sha, or `null` in a failed-fetch doc only (D-7529)."
  - `LineageDoc`'s doc comment becomes: "`tip` stays `null` only in a failed-fetch doc (no `base`) whose radar could not read the local tip."
- **The header.** Replace the paragraph that begins "The parser reads only the shapes the radar writes" with this text, verbatim. `D-7528` is the departure that restates the header to the rules the parser measures.
  ```
   * The parser reads the files the radar writes (`lineage_unmeasured`, `lineage_pass` and `walk_lineage` in
   * `ccd/ccd-land-probe`) by the rules below, and a doc that breaks any of them is unreadable (a doc that keeps them
   * all but lacks a fresh `at` reads `stale`, not unreadable). They are rules the radar's writers keep; they do not
   * prove that a doc which keeps them came from the radar or from real merges (D-7528, restating D-7469). Every doc
   * is one JSON object of at most `LINEAGE_MAX_BYTES` with `v: 1`, and carries the row's `project`, `id` and
   * `branch`, and a fresh `at` (`freshWithin`). A measured doc has a sha `tip`,
   * a sha `base`, a stop other than `unmeasured`, and no `why`. An unmeasured doc has a non-empty `why`, and is a
   * failed fetch (no base, no stop, an empty chain, a sha or `null` tip) or a cut walk (a sha base, a sha tip, `stop:
   * 'unmeasured'`). A chain needs a base, starts at the tip, links each `p1` to the next `merge`, holds at most
   * `LINEAGE_MAX_CHAIN` entries and, at that length, says `limit`; a `limit` walk of fewer is readable, because the
   * step count is a knob. No entry has `p1 === p2`, and no `merge` repeats.
  ```
  The "Fail closed." paragraph after it is unchanged.
- **4c F8.** One lane-level case drives `FleetWatcher.tick()` → `sweepPr` → `sweepLanding` over a real `CoordStore`. The case:
  1. A run reaches `merging` with a recorded episode head, and its PR reads `queued`.
  2. The run is sent back on the `merging → working` edge (`RUN_TRANSITIONS`). Its episode row stays, so `currentEpisode(runId).head` still answers that head.
  3. The PR then reads `dequeued`.

  `landingVerdict`'s dequeue arm (D-7470) must deliver the brief with no recorded-head line. The case pins this at the lane, through `sweepLanding`'s `runState` read, which the verdict suite cannot see.

- [ ] **Step 1: The failing tests.**
  - **`server/test/coord-lineage.test.ts`.** Add a new describe directly before `describe('freshWithin: the one freshness rule (D-7475)', …)`:
    ```ts
    describe('parseLineage: the rules the parser measures (wave 5a)', () => {
      const decide = (lineage: LineageRead) => decideLineage({
        claim: sha(2), live: sha(1), marker: 'trusted', globalPause: 'running', projectPause: 'running', qualifies: true,
        lineage,
      });
      /** A cut walk's shape with a null tip and an empty chain: main reads it and answers `tip-unmeasured`. */
      const NULL_TIP_UNDER_BASE = { state: 'unmeasured', why: 'budget', stop: 'unmeasured', tip: null, chain: [] };

      it('a null tip under a sha base is unreadable (the null-tip rule: only a failed fetch has a null tip)', () => {
        expect(lin(NULL_TIP_UNDER_BASE)).toEqual({ ok: false, reason: 'unreadable' });
        expect(decide(lin(NULL_TIP_UNDER_BASE))).toEqual({ answer: 'unmeasured', detail: 'lineage-unreadable' });
      });
      it('control: the same cut walk with a sha tip reads', () => {
        expect(lin({ ...NULL_TIP_UNDER_BASE, tip: sha(1) }).ok).toBe(true);
      });
      it('control: the failed fetch keeps its null tip, and still answers tip-unmeasured', () => {
        const lineage = lin({ ...FETCH_FAILED, tip: null });
        expect(lineage.ok).toBe(true);
        expect(decide(lineage)).toEqual({ answer: 'unmeasured', detail: 'tip-unmeasured' });
      });
    });
    ```
    The refused case fails exactly one rule, the null-tip rule:
    - its `base` is `doc()`'s default `sha(9)`;
    - its `stop` is `'unmeasured'`, so the base-bearing-unmeasured rule holds;
    - its `why` is non-empty;
    - its chain is empty, so no chain rule applies.

    Also amend the leading comment of the describe "parseLineage: the radar writes three shapes only (fix round 1, F1)", as the Design says.
  - **`server/test/pr-queue-lane.test.ts`.** Add this case in the describe "the landing briefs carry the run's recorded episode head (landing order wave 4, D-7102)", before "a run with no episode head gets exactly the text it always did". It reuses that describe's `HEAD`, `bodyOf` and `atMerging`:
    ```ts
    it('a run sent back to working while its PR is queued, then dequeued, gets the brief with no recorded head (D-7470)', async () => {
      const f = await atMerging(openLine({ queue: 'queued', queueAt: T1 }), HEAD);
      await f.sweep();
      expect(f.mail(), 'a queued PR asks for nothing').toEqual([]);
      expect(f.coord.advance(f.firstRunId, 'working', 'coordinator').ok).toBe(true);
      // The send-back leaves the episode row in place, so the head is there to be misread.
      expect(f.coord.currentEpisode(f.firstRunId)?.head).toBe(HEAD);
      await f.sweep(openLine({ queue: 'dequeued', queueAt: T2 }));
      expect(f.mail().map((m) => m.subject)).toEqual([dequeuedSubject(42, T2)]);
      const body = bodyOf(f);
      expect(body).toBe(renderDequeueBrief(ID, 42));
      expect(body).not.toContain(HEAD);
      expect(f.queueFeed()).toHaveLength(1);
      f.stop();
    });
    ```
- [ ] **Step 2: Run the tests and see the expected failures.** From `server/`:
  - `./node_modules/.bin/vitest run test/coord-lineage.test.ts`. Expected: 1 failed, 160 passed. The failing case is "a null tip under a sha base is unreadable …", at `expect(lin(NULL_TIP_UNDER_BASE)).toEqual({ ok: false, reason: 'unreadable' })`, because it received `{ ok: true, doc: { tip: null, base: sha(9), state: 'unmeasured', stop: 'unmeasured', chain: [], branch: 'ws/alpha' } }`.
  - `./node_modules/.bin/vitest run test/pr-queue-lane.test.ts`. Expected: 35 passed. The new case is green on main (D-7470); its red is measured by mutants T1-4 and T1-5 in Step 6.
- [ ] **Step 3: Implement** the Design in `server/src/coord/lineage.ts`, with the header paragraph verbatim. Do not touch `decideLineage`, `landing.ts` or `watch.ts`.
- [ ] **Step 4: Run the tests and see them pass,** under the Global Constraints:
  - `test/coord-lineage.test.ts`: 161 passed.
  - `test/pr-queue-lane.test.ts`: 35 passed.
  - `test/coord-fingerprint.test.ts`: 109 passed, unchanged.
  - `test/landing-verdict.test.ts`: 46 passed.
  - `test/run-routes.test.ts`, from the full worktree.
  - `test/ccd-land-lineage-accept.test.ts`.
- [ ] **Step 5: The guards,** under the Global Constraints:
  - `test/single-definition/*.test.ts`, `test/rings/*.test.ts`, `test/mail-routes.test.ts`, `test/citations.test.ts`, `test/anchors.test.ts` and `test/docs-parity.test.ts`.
  - `git fetch origin main`, then `test/deviation-refs.test.ts`. The header's `D-7528` and the null-tip comments' `D-7529` must be numbers the 5a plan defines.
  - `GROWTH_CHECK=1 ./node_modules/.bin/vitest run test/growth-check.test.ts`.
  - `test/typecheck-tests.test.ts`, and `~/.local/bin/ccrc test -- <the server tsc --noEmit>`.
- [ ] **Step 6: Mutations.** Run the table's mutants under the Global Constraints.
- [ ] **Step 7: Commit:** `fix(coord): the lineage parser refuses a null tip under a base and states the rules it measures (landing order wave 5a)`.

**Mutation table (Task 1).**

| # | Mutation | Predicted red |
|---|---|---|
| T1-1 | In `parseLineage`, delete `if (measured && stop === 'unmeasured') return bad;`, the kept arm. | `coord-lineage` "(d) state: 'measured' beside stop: 'unmeasured', a sha base and a chain holding the claim". It is the only row this arm alone refuses: a measured doc with a sha base, a stop, no `why` and a valid chain. |
| T1-2 | Delete `if (tip === null && base !== undefined) return bad;`. | `coord-lineage` "a null tip under a sha base is unreadable (the null-tip rule: only a failed fetch has a null tip)". The doc reads `ok: true`, because no other rule refuses it. |
| T1-3 | Widen the rule to `if (tip === null) return bad;`. This over-refuses the failed fetch. | Five reds in `coord-lineage`: "a failed fetch's shape with a null tip"; "the failed fetch's shape, with a sha tip and with a null tip"; "the failed-fetch doc, with its why, with a sha tip and with a null tip"; "control: the failed fetch keeps its null tip, and still answers tip-unmeasured"; and "row 9: a null doc tip -> unmeasured, tip-unmeasured (never lineage-unreadable)". Each expects the null-tip failed fetch to read. |
| T1-4 | In `landingVerdict`'s dequeue arm, replace `if (f.runState.state === 'merging') {` with `{`, so a named dequeue reads the head whatever the state. | `landing-verdict` "a run no longer at merging (sent back to working) delivers a brief with no recorded-head line, and asks for no head" and "every state but merging delivers headless, and a run row that is gone does too". `pr-queue-lane`'s new case also goes red, because the body carries the `HEAD` line and so is not `renderDequeueBrief(ID, 42)`. |
| T1-5 | In `sweepLanding`'s `case 'runState'`, answer `state: ask.notice === 'dequeued' ? 'merging' : read.run?.state ?? null`. This is a lane-only misread. | Only `pr-queue-lane`'s new case, because the lane reads the head of a run at `working`. `landing-verdict` stays at 46 of 46, because it never runs `watch.ts`. This row shows that the case drives the lane, not the verdict alone. |


### Task 2: the radar lane hardening

Closes wave 4b's carried F9 (1)–(5) and F5. It changes no wire field, no lane row and no verdict. Every new refusal
fails closed to an answer the lane already gives: no `landing`, a re-aged map, or `cut.unbound`.

**Design, in one place.**
- **Safe names (F9 (1); D-7530).** `listRadarProjects` checks every listed name except the lister's `.lp.*` temporaries
  against `isSafeProjectSegment` (`server/src/coord/ledgerseed.ts#isSafeProjectSegment`, the one definition). That
  grammar is the radar's own `PROJECT_RE` in `ccd/ccd-land-probe`, so no project the radar writes is refused.
  - A name that passes goes to `names`.
  - A name that fails goes to `refused`.
  - `readRadarPass` gives a refused name that a session names the read `{ok: false, reason: 'refused'}`. It joins no
    path for that name and makes no io call.
  - The lane's existing loop says it once per change, through `said()`.
- **One sanitiser (F9 (2); D-7530).** The tree has one: `printableDetail` (`server/src/update/inventory.ts#printableDetail`).
  It replaces each run of characters outside printable ASCII with one space, trims, and cuts to 200 characters.
  `watch.ts` already imports from that module. `said()` names a project as `printableDetail(key)`. `radarSaid` stays
  keyed by the raw name. No new helper is added, so no single-definition row is needed for one.
- **A bounded pass (F9 (3); D-7531).** `RADAR_PASS_CONCURRENCY = 8` is exported once from `lineageRead.ts`. The reads go
  through `mapBounded` (`server/src/bounded.ts#mapBounded`, the one pool). Each limited call races its read against the
  deadline, so a hung read frees its slot at the deadline. A name whose turn comes after the deadline answers `late`
  without any io.
- **The deadline covers the listing (F9 (4a); D-7531).** The pass's one timer starts before the listing, and the listing races
  it. A listing that has not answered by `deadlineMs` aborts and answers `{ok: false, reason: 'late'}`. The lane's
  existing `!pass.ok` arm re-ages the kept map and says `late` once.
- **A generation (F9 (4b); D-7531).** `sweepRadar` takes `const gen = ++this.radarGen` as its first statement, before the
  `records === null` arm, so a re-age-only pass also counts as a newer pass. After the pass's one await,
  `if (gen !== this.radarGen) return;` comes before any `said()` or write. An abandoned pass released later neither
  writes nor speaks.
- **A thrown listing (F9 (5); D-7530).** `readRadarPass` catches a rejected listing as `{ok: false, reason: 'unreadable'}`,
  beside its per-project reads' own `.catch`. So the lane says `the landing radar's listing is unreadable` once per
  change, and the runner's `the landing radar lane failed` sentence (the `landingRadar` row's `warnKey`, unchanged)
  stays as the backstop for a programming fault.
- **The measured `.project` (F5; D-7532).**
  - **The record.** `buildRecord` reads `.project` through `listedMeasured('project')` instead of
    `listedField('project')`. That keeps registry-read-census's four unconditional reads at four. The record gains
    `projectEvidence: ProjectEvidence` (`'measured' | ReadFailure`). `project` keeps its display default: the content
    when `'measured'`, otherwise `id`, for every other reader.
  - **The rows.** A new L1 `radarRowsOf` in `radar.ts` is the field's one reader:
    - a `'measured'` row joins its project's rows;
    - an `'unreadable'` row gives only its current branch, as `stray`;
    - an `'absent'` row joins nothing, as the radar's own `project_rows` treats a row with no `.project`.
  - **The landings.** `sessionLandingsOf` takes `stray` as a required fourth parameter. A null-`id` head on a stray
    branch sets `unbound` for every landing of every project. A stray row never matches a head.

**Files:**
- Modify: `server/src/registry.ts`, `server/src/coord/radar.ts`, `server/src/coord/lineageRead.ts`, `server/src/watch.ts`
- Test: modify the following:
  - `server/test/radar-lane.test.ts`, `server/test/coord-radar.test.ts` and `server/test/registry-bounded-read.test.ts`;
  - `server/test/fixtures/registry/edge-base-records.json`;
  - `server/test/single-definition/core-vocab.test.ts` and `server/test/single-definition/vocabularies.test.ts`;
  - the four `SessionRecord` literals in `server/test/stall-sweep.test.ts` (`regRow`),
    `server/test/feed-writers-pin.test.ts`, `server/test/hold-gate.test.ts` and
    `server/test/idle-compact-nudge-lane.test.ts` (`regRow`).
- Mutation-only, claimed for that row alone: `server/src/laneSchedule.ts` (T2-17).
- Read, unchanged:
  - `server/src/laneSchedule.ts`: the `landingRadar` row, its cadence, `staleAfterMs` and `warnKey` stay;
  - `server/src/coord/ledgerseed.ts`, `server/src/bounded.ts` and `server/src/update/inventory.ts`, which are imported
    only.

**Interfaces:**
- Consumes:
  - `isSafeProjectSegment(project: string): boolean`;
  - `mapBounded<T, R>(items, limit, fn): Promise<R[]>`;
  - `printableDetail(raw: string): string`;
  - `ReadFailure` (`'absent' | 'unreadable'`, `server/src/io.ts` re-export).
- Produces, `server/src/registry.ts`:
  ```ts
  /** How `.project` read: `measured` (the record's `project` is the file's trimmed content), `absent` (no `.project`
   *  in the listing, or a raced removal) or `unreadable` (listed, and the read failed). `project` stays `id` unless
   *  this is `measured` — a display default; nothing may decide on it (4b F5). */
  export type ProjectEvidence = 'measured' | ReadFailure;
  // on SessionRecord, beside branchEvidence:
  projectEvidence: ProjectEvidence;
  ```
- Produces, `server/src/coord/radar.ts`:
  ```ts
  import type { ProjectEvidence } from '../registry.js';   // type-only: no ring edge
  export function radarRowsOf<R extends { readonly project: string; readonly projectEvidence: ProjectEvidence }>(
    records: readonly R[], rowOf: (r: R) => RadarRow,
  ): { byProject: Map<string, RadarRow[]>; stray: ReadonlySet<string> };
  export function sessionLandingsOf(
    doc: ProbeDoc, rows: readonly RadarRow[], nowMs: number, stray: ReadonlySet<string>,
  ): Map<string, SessionLanding>;   // unbound = some null-id head whose branch is in rowBranches OR in stray
  ```
- Produces, `server/src/coord/lineageRead.ts`:
  ```ts
  export const RADAR_PASS_CONCURRENCY = 8;
  export async function listRadarProjects(
    io: Pick<FleetIO, 'readdirMeasured'>, registryDir: string, signal?: AbortSignal,
  ): Promise<{ ok: true; names: string[]; refused: string[] } | { ok: false; reason: ReadFailure }>;
  export type RadarPassRead = ProbeRead | { ok: false; reason: ReadFailure | 'late' | 'refused' };
  export async function readRadarPass(
    io: Pick<FleetIO, 'readFileMeasured' | 'lstatMeasured' | 'statMeasured' | 'readdirMeasured'>, registryDir: string,
    projectsWanted: ReadonlySet<string>, nowMs: number, deadlineMs: number,
  ): Promise<{ ok: true; reads: Map<string, RadarPassRead> } | { ok: false; reason: ReadFailure | 'late' }>;
  ```
- Produces, `server/src/watch.ts`: `private radarGen = 0`, with a docstring saying the latest pass to start is the only
  one that may commit `landings` or speak. `sweepRadar`'s signature is unchanged.

#### Part A: the measured `.project` (4b F5)

- [ ] **Step 1: The failing tests.**
  - `registry-bounded-read.test.ts`, in `describe('what the listing decides')`:
    `it('the .project read keeps its measured state, and the display default stays the id (4b F5)')`. Over
    `countingIO`:
    - `lane-a-named` has `project: 'proj-a'`;
    - `lane-a-unreadable` and `lane-a-raced` each `put` a `project` value into `files` (`countingIO` lists only the paths
      in `files`, and an unlisted `.project` reads as a synthesised `absent`), and then add `at(id, 'project')` to
      `unreadable` and to `racedAbsent` respectively, as the describe's existing `lane-a-listed` case does for `branch`;
    - `lane-a-none` has no `.project`;
    - each row has `uuid`, `wrapper: 'lane-a'` and `workdir: '/w'`.
    ```ts
    expect(by('lane-a-named')).toMatchObject({ project: 'proj-a', projectEvidence: 'measured' });
    expect(by('lane-a-unreadable')).toMatchObject({ project: 'lane-a-unreadable', projectEvidence: 'unreadable' });
    expect(by('lane-a-raced')).toMatchObject({ project: 'lane-a-raced', projectEvidence: 'absent' });
    expect(by('lane-a-none')).toMatchObject({ project: 'lane-a-none', projectEvidence: 'absent' });
    ```
  - `edge-base-records.json`, the golden, changed by hand and on purpose (its header says a change to a covered record
    is a change of this file). Each of the 30 records gains `"projectEvidence"`:
    - `"measured"` for `edge-plain`, the one row `edgeFixture()` gives a `.project`;
    - `"absent"` for the other 29.

    Derive the values from the fixture's files, never by regenerating the golden with the new code.
  - `coord-radar.test.ts`:
    - `it('radarRowsOf: a measured row joins its project, an unreadable one gives only its branch, an absent one gives nothing (4b F5)')`:
      ```ts
      const recs = [
        { id: 'lane-a-proj-a-alpha', project: 'proj-a', projectEvidence: 'measured', branch: 'ws/alpha' },
        { id: 'lane-a-proj-b-bob', project: 'proj-b', projectEvidence: 'measured', branch: 'ws/bob' },
        { id: 'lane-a-held', project: 'lane-a-held', projectEvidence: 'unreadable', branch: 'ws/held' },
        { id: 'lane-a-held-2', project: 'lane-a-held-2', projectEvidence: 'unreadable', branch: null },
        { id: 'lane-a-bare', project: 'lane-a-bare', projectEvidence: 'absent', branch: 'ws/bare' },
      ] as const;
      const out = radarRowsOf(recs, (r) => ({ id: r.id, branch: r.branch, pr: null }));
      expect([...out.byProject.keys()].sort()).toEqual(['proj-a', 'proj-b']);
      expect(out.byProject.get('proj-a')).toEqual([{ id: 'lane-a-proj-a-alpha', branch: 'ws/alpha', pr: null }]);
      expect([...out.stray]).toEqual(['ws/held']);
      ```
    - `it('a null-id head on a stray branch sets unbound on every landing; one on no stray branch does not (4b F5)')`:
      ```ts
      for (const l of sessionLandingsOf(okDoc(worked()), ROWS, NOW, new Set(['feature/x'])).values()) expect(l.cut.unbound).toBe(true);
      for (const l of sessionLandingsOf(okDoc(worked()), ROWS, NOW, new Set(['ws/other'])).values()) expect(l.cut.unbound).toBe(false);
      ```
    - The three existing calls (`landings`, and the two in the window case) pass `new Set()`.
  - `radar-lane.test.ts`. Scaffolding, added once inside `describe('the radar lane')` (to reach `plantRow`, `bent`,
    `make`, `reg` and `keys`; none of these is a file-level helper on `main`, and the existing `said` is local to one case):
    - a `warnSpy()` helper that installs `vi.spyOn(console, 'warn').mockImplementation(() => undefined)` and returns
      `{ lines, said }`, where `lines()` is every warn call's first argument as a string and `said()` is those lines that
      contain `landing radar`; the new cases call it where they need it;
    - the `RADAR_PASS_CONCURRENCY` import, added to the existing `../src/coord/lineageRead.js` import line;
    - a second watcher `w2 = make()` over `localIO` for the CONTROL below.

    `it('a row whose .project will not read puts its branch into every project: a null-id head there sets unbound (4b F5)')`.
    - Plant `ALPHA`, `BETA` (branch `ws/beta`) and `BOB = 'claude-a-proj-b-alpha'` (`project: 'proj-b'`,
      `branch: 'ws/bob'`).
    - proj-a's doc has heads `{pr: 12, ws/alpha, id: ALPHA}` and `{pr: 13, ws/beta, id: null}`, with `pairHeads: [12]`.
    - proj-b's doc has heads `{pr: 21, ws/bob, id: BOB}` and `{pr: 22, ws/beta, id: null}`, with `pairHeads: [21]`.
    - Fail BETA's `.project` for both readers, so the case is red on main too:
      ```ts
      const unread = (p: string): boolean => p.endsWith(`${BETA}.project`);
      const io: FleetIO = { ...bent((m, p) => (m === 'read' && unread(p) ? { ok: false, reason: 'unreadable' } : undefined)),
        readFile: (p) => (unread(p) ? Promise.resolve(null) : localIO.readFile(p)) };
      // after one pass at NOW:
      expect(keys(w)).toEqual([ALPHA, BOB]);
      expect(w.currentLandings().get(ALPHA)?.cut.unbound, 'proj-a').toBe(true);
      expect(w.currentLandings().get(BOB)?.cut.unbound, 'proj-b, a project the held row may belong to').toBe(true);
      // CONTROL: with BETA's .project readable (localIO), BETA is proj-a's alone.
      expect(w2.currentLandings().get(BOB)?.cut.unbound, "a readable .project is its own project's only").toBe(false);
      ```
  - `single-definition/vocabularies.test.ts`, in `describe('one absent/unreadable read vocabulary')`:
    `it('is what registry.ts derives ProjectEvidence from, not a second copy (4b F5)')`. The case reads `registry.ts`
    itself, first, as the `BranchEvidence` case does (`const registry = readFileSync(path.join(ccrcRoot, 'server/src/registry.ts'), 'utf8');`);
    `PAIR` is the describe's own:
    ```ts
    expect(registry).not.toMatch(PAIR);
    expect(registry).toMatch(/export type ProjectEvidence = 'measured' \| ReadFailure;/);
    ```
  - `single-definition/core-vocab.test.ts` gets a new describe beside D-7514's,
    `describe('SessionRecord.projectEvidence has one reader (landing order wave 5a, 4b F5)')`, with
    `it("is on a code line only in registry.ts, which writes it, and radar.ts's radarRowsOf, which reads it")`.
    The `./helpers.js` import gains `stallCode` (the file imports `stallCodeText` already, and `sourceOfSymbol` from
    `../scan/symbols.js`):
    ```ts
    import { ALL, REACH, ROOTS, ccrcRoot, here, holdersOf, passage, prose, rel, sources, stallCode, stallCodeText } from './helpers.js';
    ```
    The case uses a non-global regex for the membership test (a `/g` regex carries `lastIndex` between files and can
    skip a holder) and a global one only to count:
    ```ts
    it("is on a code line only in registry.ts, which writes it, and radar.ts's radarRowsOf, which reads it", () => {
      const NAMED = /\bprojectEvidence\b/;
      const COUNT = /\bprojectEvidence\b/g;
      expect(ALL.filter((f) => NAMED.test(stallCode(f))).map(rel).sort()).toEqual(['server/src/coord/radar.ts', 'server/src/registry.ts']);
      const radar = path.join(ccrcRoot, 'server/src/coord/radar.ts');
      const whole = (stallCode(radar).match(COUNT) ?? []).length;
      const inFn = (stallCodeText(sourceOfSymbol(radar, 'radarRowsOf')).match(COUNT) ?? []).length;
      expect(inFn).toBeGreaterThan(0);
      expect(whole, 'a reader of projectEvidence in radar.ts outside radarRowsOf').toBe(inFn);
    });
    ```
- [ ] **Step 2: Run them, and see them fail.** From `server/`, run `./node_modules/.bin/vitest run test/<file>` for each
  file. Expect these failures:
  - the registry case: `projectEvidence` is `undefined`;
  - the golden: an extra key;
  - `coord-radar`: `radarRowsOf` is not exported;
  - the lane case: `unbound` is `false` for both;
  - `vocabularies`: no `ProjectEvidence` line;
  - `core-vocab`: `holders` is `[]`.
- [ ] **Step 3: Implement.**
  - **`registry.ts`:**
    - the type and the field, as in Interfaces;
    - in `buildRecord`, `listedMeasured('project')` takes `listedField('project')`'s place in the `Promise.all`, as
      `projectRead`;
    - the record literal reads
      `project: projectRead.ok ? projectRead.content : id, projectEvidence: projectRead.ok ? 'measured' : projectRead.reason`;
    - `fieldMeasured`'s docstring drops `project` from the list of fields `field()` still backs.
  - **`radar.ts`:** `radarRowsOf` and `sessionLandingsOf`'s `stray`, as in Design and Interfaces, plus one header
    sentence: a row whose `.project` would not read is held by the radar, so its branch is checked against every
    project's null-`id` heads.
  - **`watch.ts` `FleetWatcher.sweepRadar`:**
    - build `const { byProject, stray } = radarRowsOf(records, (r) => { …today's RadarRow body, D-7515 comment kept… })`
      before `readRadarPass`. Today's body reads `heads.get(r.id)`, and `const heads = this.currentHeadBranches();` is
      declared after the pass's await, so move that line above the `radarRowsOf` call (a closure over a later `const`
      is a runtime error that `tsc` does not flag). The growth figure is unchanged;
    - pass `new Set(byProject.keys())` as `projectsWanted`;
    - call `sessionLandingsOf(read.doc, byProject.get(project) ?? [], nowMs, stray)`;
    - drop the `RadarRow` type import, and add `radarRowsOf` to the `./coord/radar.js` import;
    - leave the re-age line (`freshWithin(l.at, RADAR_PROBE_FRESH_S, nowMs)`, which core-vocab D-7514 pins) unchanged.
  - **The four test literals** each gain `projectEvidence: 'measured'`.
- [ ] **Step 4: Run and pass.** Run each touched file whole, plus `registry.test.ts` (registry-read-census stays at 4),
  `radar-fleet-frames`, `fleetws` and `ccd-land-lineage-accept` (both call `sweepRadar(records)`). Then run
  `typecheck-tests` alone, through `~/.local/bin/ccrc test -- …`, which names any `SessionRecord` literal this list
  missed.
- [ ] **Step 5: Commit:** `fix(registry): the record keeps how .project read, and the radar fails closed on an unreadable one (landing order wave 5a)`.

#### Part B: the pass (4b F9 (1)–(5))

- [ ] **Step 6: The failing tests.** In `radar-lane.test.ts`, under a new
  `describe("wave 5a: the pass's hardening (4b F9)")`, nested inside `describe('the radar lane')` so that `plantRow`,
  `plantProbe`, `bent`, `make`, `reg` and `keys` are in scope. The retitled and added cases that sit in existing
  describes use the same `warnSpy()`. Scaffolding local to the cases that need it:
  - `landingReaddirs`: a counter, bumped by an io whose landing `readdirMeasured` rejects (the thrown-listing case);
  - `holdNext` and `hold()`: a boolean, and a function that parks the landing `readdirMeasured` call made while
    `holdNext` is set on a promise released later (the abandoned-pass case);
  - `held` (an array of release functions) and `issued` (a counter): the bound case's gate on `lstatMeasured`.
  - `it('a project name that is not a safe segment is never read, and is said once on one line (4b F9 (1), (2))')`:
    ```ts
    const bad = 'proj\nccrc-server: forged';
    plantRow(ALPHA, { project: bad }); plantProbe(worked({ project: bad }), bad);
    const seen: string[] = []; const io = bent(() => undefined, seen);
    // two passes, at NOW and NOW + 1000
    expect(seen.filter((s) => s.includes('forged') && !s.startsWith('readdir ')), 'a path was joined on an unsafe name').toEqual([]);
    expect(keys(w)).toEqual([]);
    expect(said()).toEqual(["ccrc-server: the landing radar's probe of proj ccrc-server: forged is refused"]);
    ```
  - The existing listing case becomes
    `it("the listing leaves out the lister's .lp.* temporaries, keeps an unsafe name apart, and says absent for no directory")`.
    Add the directories `bad name` and `.lp.123` beside `proj-a`:
    ```ts
    const r = await listRadarProjects(localIO, reg);
    expect(r.ok && { names: r.names, refused: [...r.refused].sort() }).toEqual({ names: ['proj-a'], refused: ['bad name'] });
    ```
  - `it('a pass has at most RADAR_PASS_CONCURRENCY (8) probe reads in flight (4b F9 (3))')`:
    - plant 20 projects, `proj-00` to `proj-19`, each with a headless measured doc;
    - gate `lstatMeasured` on `…/probe` paths, and count each one as `issued`;
    - call `readRadarPass(io, reg, new Set(projects), NOW, 60_000)` directly.
    ```ts
    expect(RADAR_PASS_CONCURRENCY).toBe(8);
    await vi.waitFor(() => expect(issued).toBe(8), { timeout: 5000 });
    await new Promise<void>((r) => setImmediate(r));
    expect(issued, 'more than the bound went out at once').toBe(8);
    held.shift()!();
    await vi.waitFor(() => expect(issued).toBe(9), { timeout: 5000 });
    // release the rest, round by round
    expect(r.ok && r.reads.size).toBe(20);
    expect(r.ok && [...r.reads.values()].every((x) => x.ok)).toBe(true);
    ```
  - `it('a listing that hangs settles as late at the deadline, and the kept map is re-aged (4b F9 (4))')`:
    - a good pass at `NOW` gives `[ALPHA, BETA, GAMMA]`;
    - then the landing `readdirMeasured` never answers;
    - fake `setTimeout`/`clearTimeout`, and start the pass at `NOW + 1000` with `.then(() => { settled = true; })`.
    ```ts
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled, 'the pass settled before its deadline').toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await new Promise<void>((r) => setImmediate(r));
    expect(settled, 'a hung listing held the pass past its deadline').toBe(true);
    expect(keys(w), 'a late listing re-ages the kept map').toEqual([ALPHA, BETA, GAMMA]);
    expect(said()).toEqual(["ccrc-server: the landing radar's listing is late"]);
    ```
  - `it('readRadarPass answers late for a listing that has not answered, and aborts it')`. `readdirMeasured` captures
    its signal and never answers:
    ```ts
    expect(await readRadarPass(io, reg, new Set(['proj-a']), NOW, 20)).toEqual({ ok: false, reason: 'late' });
    expect(signal?.aborted).toBe(true);
    ```
  - `it('an abandoned pass released after a newer one started never overwrites its map (4b F9 (4))')`. The landing
    `readdirMeasured` holds its next call when `holdNext` is set, releasing through `hold()`.
    1. Plant the fleet and `worked()`.
    2. Start pass A at `NOW`, held. Run pass B at `NOW + 1000`, and expect `[ALPHA, BETA, GAMMA]`.
    3. Plant `worked({ heads: [], pairs: [], pairHeads: [] })`, then release A:
       ```ts
       expect(keys(w), 'the older pass overwrote the newer map').toEqual([ALPHA, BETA, GAMMA]);
       ```
    4. Plant `worked()` again. Start pass C at `NOW + 2000`, held.
    5. Plant the headless doc. Run `sweepRadar(null, NOW + 3000)`, then release C:
       ```ts
       expect(keys(w), 'a re-age-only pass did not count as newer').toEqual([ALPHA, BETA, GAMMA]);
       ```
  - The existing case "a lane failure is caught by the lane and never stops the tick" becomes
    `it('a thrown listing is said once through the lane, never by the runner, and never stops the tick (4b F9 (5))')`.
    The landing `readdirMeasured` rejects `new Error('boom')`, and the io counts those calls.
    ```ts
    await expect(w.sweepRadar(recs, NOW)).resolves.toBeUndefined();
    await expect(w.sweepRadar(recs, NOW + 1000)).resolves.toBeUndefined();
    await expect(w.tick()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(landingReaddirs).toBeGreaterThanOrEqual(3), { timeout: 5000 });
    await new Promise<void>((r) => setImmediate(r));
    expect(said()).toEqual(["ccrc-server: the landing radar's listing is unreadable"]);
    expect(lines().join('\n')).not.toContain('the landing radar lane failed');
    ```
  - The runner's backstop stays pinned by its own case (the retitled case above no longer mentions the
    `landingRadar` row's `warnKey`, so this one does). It is green on `main` as well as after the change, because it
    pins what stays:
    ```ts
    it('a fault the pass does not catch is still said by the runner: the landingRadar row\'s warnKey is the backstop (4b F9 (5))', async () => {
      plantRow(ALPHA);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const w = make();
      vi.spyOn(w, 'sweepRadar').mockRejectedValue(new Error('boom'));
      await expect(w.tick()).resolves.toBeUndefined();
      await vi.waitFor(() => expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('the landing radar lane failed'), { timeout: 5000 });
    });
    ```
  - A queue that reaches past the deadline (the bound case never gets there):
    ```ts
    it('a hung read frees its slot at the deadline, and a name whose turn comes after it answers late with no io (4b F9 (3), (4))', async () => {
      const projects = Array.from({ length: 10 }, (_, i) => `proj-${String(i).padStart(2, '0')}`);
      for (const p of projects) plantProbe(worked({ project: p, heads: [], pairs: [], pairHeads: [] }), p);
      const lstats: string[] = [];
      const io: FleetIO = { ...localIO, lstatMeasured: (p) => { if (p.endsWith(`${path.sep}probe`)) lstats.push(p); return new Promise<never>(() => undefined); } };
      const r = await readRadarPass(io, reg, new Set(projects), NOW, 50);
      expect(r.ok && r.reads.size).toBe(10);
      expect(r.ok && [...r.reads.values()].every((x) => !x.ok && x.reason === 'late')).toBe(true);
      expect(lstats, 'a read was issued after the deadline').toHaveLength(8);
    });
    ```
  - A silent skip (the unsafe-name case names its directory, so it cannot see this one):
    ```ts
    it('an unsafe directory no session names is skipped without a word (4b F9 (1))', async () => {
      plantRow(ALPHA); plantProbe(worked());
      mkdirSync(path.join(reg, 'landing', 'bad name'), { recursive: true });
      const r = await readRadarPass(localIO, reg, new Set(['proj-a']), NOW, 5000);
      expect(r.ok && [...r.reads.keys()]).toEqual(['proj-a']);
    });
    ```
- [ ] **Step 7: Run them, and see them fail.** Expect these failures:
  - the unsafe name is read, and no `refused` line is said;
  - `refused` is missing from the listing;
  - `RADAR_PASS_CONCURRENCY` is not exported, and `issued` reaches 20;
  - `settled` stays false;
  - the direct late-listing case times out at vitest's default timeout, because on `main` the listing is awaited before
    any timer starts;
  - A overwrites with `[]`;
  - `sweepRadar` rejects `boom`;
  - the late-slot case: `lstats` holds 10 entries, not 8 (no bound yet);
  - the unsafe-directory case (no session names it) and the backstop case pass on `main` as well: they pin what stays,
    so mutants T2-20 and T2-17 measure their reds, not red-first.
- [ ] **Step 8: Implement.**
  - **`listRadarProjects`:** call `io.readdirMeasured(path.join(registryDir, 'landing'), undefined, signal)` (the signal
    is the third argument; `readdirMeasured(path, timeoutMs?, signal?)`), then partition as in Design.
  - **`readRadarPass`:** the order matters and the tests fix it, so here is the body:
    ```ts
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<{ ok: false; reason: 'late' }>((resolve) => {
      timer = setTimeout(() => { ac.abort(); resolve({ ok: false, reason: 'late' }); }, deadlineMs);
    });
    try {
      const listing = await Promise.race([
        listRadarProjects(io, registryDir, ac.signal).catch(() => ({ ok: false, reason: 'unreadable' }) as const), late]);
      if (!listing.ok) return listing;
      const safe = listing.names.filter((n) => projectsWanted.has(n));
      const answers = await mapBounded(safe, RADAR_PASS_CONCURRENCY, (n): Promise<RadarPassRead> => (ac.signal.aborted ? late
        : Promise.race([readRadarProbe(io, registryDir, n, nowMs, ac.signal).catch((): RadarPassRead => ({ ok: false, reason: 'unreadable' })), late])));
      const reads = new Map<string, RadarPassRead>(safe.map((n, i) => [n, answers[i]!] as const));
      for (const n of listing.refused) if (projectsWanted.has(n)) reads.set(n, { ok: false, reason: 'refused' });
      return { ok: true, reads };
    } finally { clearTimeout(timer); }
    ```
  - **The `lineageRead.ts` header:** one paragraph covering the four changes of Design.
  - **`watch.ts`:** the Design's generation and sanitiser, with `printableDetail` added to the existing
    `./update/inventory.js` import and one docstring sentence on each.
- [ ] **Step 9: Run and pass.** Run the guards under the Global Constraints (Task 5 Step 3 holds the common list). The
  deltas for this task:
  - run whole: `radar-lane`, `coord-radar`, `radar-fleet-frames`, `fleetws`, `ccd-land-lineage-accept`, `lane-schedule`,
    `update-inventory` (`printableDetail`, untouched), `mail-routes` (the coord literal census: `'late'` and `'refused'`
    are not kebab literals) and `registry-bounded-read`;
  - `single-definition/*`, especially `core-vocab`, `vocabularies` and `advance-switches` (the lane still makes no
    registry listing of its own);
  - `rings/*`: `lineageRead.ts` stays L3, and its new imports, `ledgerseed.ts` and `bounded.ts`, point inward; `radar.ts`
    stays L1, with a type-only edge to `registry.ts`;
  - `growth-check`: measure `watch.ts`'s net code lines against the merge-base. Part A about 0, Part B about +3 (the
    field, `gen`, the check), far under 40; measure and record both in the wave-done.
- [ ] **Step 10: Mutations.** Run them one at a time, each restored from a saved copy, with each red measured.
- [ ] **Step 11: Commit:** `fix(watch): the radar lane's pass — safe names, one log sanitiser, a bounded fan-out, a deadline over the listing, a generation (landing order wave 5a)`.

**Mutation table (Task 2):**

| # | Mutation | Expected red |
|---|---|---|
| T2-1 | `listRadarProjects` puts every non-`.lp.` name in `names` (no `isSafeProjectSegment` partition) | the listing case (`refused` is `[]`, and `bad name` is in `names`); the unsafe-name case (`seen` holds an `lstat` of the forged path) |
| T2-2 | `said()` names `key` raw, without `printableDetail` | the unsafe-name case: the said line holds `\n` and differs from the literal |
| T2-3 | `readRadarPass` fans out with `Promise.all`, not `mapBounded` | the bound case: `issued` reaches 20, where `waitFor` expects 8 |
| T2-4 | `RADAR_PASS_CONCURRENCY = 9` | the bound case: `expect(RADAR_PASS_CONCURRENCY).toBe(8)`, and `issued` 9 ≠ 8; the late-slot case (`lstats` has 9 entries, not 8) |
| T2-5 | the listing is awaited before the timer starts (today's order) | the hung-listing case: `settled` is false at 30 000 ms; the direct late-listing case never resolves (test timeout) |
| T2-6 | the `gen !== this.radarGen` check is removed | the abandoned-pass case, phase 1: keys are `[]` |
| T2-7 | `++this.radarGen` moved below the `records === null` return | the abandoned-pass case, phase 2: keys are `[]` after C is released |
| T2-8 | the listing's `.catch` in `readRadarPass` is removed | the thrown-listing case: `sweepRadar` rejects `boom` |
| T2-9 | `buildRecord` writes `projectEvidence: projectRead.ok ? 'measured' : 'absent'` | the registry case (`lane-a-unreadable` reads `absent`); the lane F5 case (`unbound` is false for both) |
| T2-10 | `buildRecord` writes `project: projectRead.ok ? projectRead.content : ''` | the registry case (`project` is `''`, not the id); the golden |
| T2-11 | `radarRowsOf` never fills `stray` | the `radarRowsOf` case (`stray` is `[]`); the lane F5 case |
| T2-12 | `radarRowsOf` treats `absent` as stray too | the `radarRowsOf` case: `stray` gains `ws/bare` |
| T2-13 | `sessionLandingsOf` ignores `stray` | the stray-branch case (`unbound` is false with `feature/x`); the lane F5 case |
| T2-14 | the lane passes `new Set()` for `stray` | the lane F5 case: ALPHA's and BOB's `unbound` are false |
| T2-15 | `sweepRadar` reads `r.projectEvidence` itself (a second reader) | core-vocab's one-reader case: `holders` gains `server/src/watch.ts` |
| T2-16 | `ProjectEvidence` restated as `'measured' \| 'absent' \| 'unreadable'` | vocabularies' `ProjectEvidence` case (`not.toMatch(PAIR)`, and the `toMatch` line) |
| T2-17 | the `landingRadar` row's `warnKey` set to `null` in `laneSchedule.ts` (run and restored, not committed) | the backstop case: the runner says nothing, and `waitFor` times out |
| T2-18 | the `ac.signal.aborted ? late :` guard removed from the limited call | the late-slot case: `lstats` has 10 entries, not 8 |
| T2-19 | the inner `, late` race removed from the limited call (no outer race kept) | the late-slot case never settles (test timeout), because the 8 hung reads hold every slot |
| T2-20 | `readRadarPass` sets `refused` for every refused name, without the `projectsWanted.has(n)` test | the unsafe-directory-no-session case: `reads` also holds `bad name` |
| T2-21 | a second `r.projectEvidence` read in a new helper in `radar.ts`, outside `radarRowsOf` | core-vocab's one-reader case: the whole `!== inFn` assertion (file membership still passes, since `radar.ts` is a holder) |


### Task 3: the chip words

Wave 4b's review 1225 carried F6 and two of F4's smaller gaps here. F6: the chip's sentence has no cap. Ten heads with twenty 300-character paths each measured a 334,403-character accessible name. "(list cut)" stands for three different cuts, and the partial clauses name no PR. F4 (a): no case checks that the chip renders after the strip. F4 (d): no guard pins `landingOf` as the PWA's one reader. This task changes only the words and adds pins. The wire, the server and `ConflictChip.tsx` do not change. D-7480's rule, that the words are true, binds every sentence below.

**Files:**
- Modify: `pwa/src/fleet/conflictWords.ts`
- Test, modify: `pwa/test/conflict-words.test.ts`, `pwa/test/fleet-screen.test.tsx`, `pwa/test/fleet-css.test.ts` (one assertion), `server/test/rings/pwa-one-owner.test.ts`
- Mutation-only, claimed for T3-15 and T3-17 and for those rows alone: `pwa/src/fleet/FleetCards.tsx`, `pwa/src/fleet/runWords.ts`. Each is restored from its saved copy, checked by sha, before the next row, and neither carries any other edit.
- Mutation-only, claimed for the named rows alone: `pwa/src/screens/FleetScreen.tsx` (T3-13a, T3-13b) and `pwa/src/fleet/ConflictChip.tsx` (T3-14). Each is restored from its saved copy, checked by sha.
- Read and run, not edited: `pwa/test/conflict-chip.test.tsx`, `pwa/test/plain-words.test.ts`, `pwa/test/literal-census.test.ts`

**Interfaces:**
- Consumes:
  - from `shared/api.ts`: `reviveSessionLanding`, `landingShown`, `SessionLanding`, `FleetSession` (unchanged);
  - `pwa/src/lib/format.ts#timeOf`;
  - in the guard: `identifierReferences` and `stringPieces` from `server/test/scan/parse.ts`, and `walkSrc` from `server/test/rings/walkSrc.ts`.
- Produces, in `pwa/src/fleet/conflictWords.ts`:

```ts
/** Paths named on one conflict line, and PRs named in one partial clause; the rest read "and N more" (wave 5a, 4b F6). */
export const CHIP_PATHS_MAX = 3;
/** Conflict lines in one sentence; the rest read "and N more". The word above them already gives the total. */
export const CHIP_LINES_MAX = 5;

/** One merge the radar answered for, within one project: a PR with its base branch, or a pair under its lower PR. */
export interface ConflictRef {
  project: string;
  pr: number;
  against: { base: string } | { pr: number };
}
/** One predicted conflict, shown once (unchanged keys: project, pr, against, paths, pathsCut). */
export interface ConflictLine extends ConflictRef {
  paths: readonly string[];
  pathsCut: boolean;
}

export interface ConflictSummary {
  measured: number;                                      // unchanged
  projects: number;                                      // unchanged
  unpaired: readonly { project: string; pr: number }[];  // was a count; sorted by project, then PR
  conflicted: readonly ConflictLine[];                   // unchanged
  partial: boolean;                                      // unchanged
  unmeasured: readonly ConflictRef[];                    // was a count; an unmeasured base merge or pair, each once, sorted like `conflicted`
  listCut: boolean;                                      // some landing's radar cut its heads or its pairs (cut.heads || cut.pairs)
  unbound: boolean;                                      // some landing carries cut.unbound
  oldestAt: string;                                      // unchanged
}
// `cut: boolean` is removed: it is split into `listCut` and `unbound`.
// landingOf, conflictChipState and conflictChipWord keep their signatures and answers.
// conflictChipSentence(summary: ConflictSummary): string keeps its signature.
```

**The words.** The tests below fix each of these, and the order case fixes the part order:

| What | Words |
|---|---|
| A conflict line's paths, over the cap | ` in a, b, c and N more` (`N = paths.length - 3`) |
| The radar cut a line's path list (`pathsCut`) | ` (more paths not recorded)`, at the end of that line |
| Conflict lines over the cap | its own part: `and N more` (`N = conflicted.length - 5`) |
| The radar cut its heads or its pairs | `Not every open PR or pair of PRs was measured` |
| An unbound head | `A PR on a session's branch was not matched to its session, so it was not compared with the others` |
| Unmeasured merges | `N not measured: #12 with main, #12 with #14, #12 with #15 and M more` |
| Landings left out of pairing | `N not paired: #12, #14 and M more` |
| Fleet spans more than one project | each clause item is prefixed with `<project> `, for example `proj-a #12 with #14` |

- **Part order.** The parts are joined with `'. '`: the word, at most 5 conflict lines, the `and N more` tail, the heads-or-pairs cut sentence, the unbound sentence, the `not measured` clause, the `not paired` clause, then `measured HH:MM`. The order case pins it.
- **The bound.** Review 1225's worst fleet (10 PRs, 55 conflicts, 20 paths of 300 characters) stays under 5,000 characters; the bound case pins it.
- **"(list cut)" is retired.**
- **Path cap.** The paths on a line and the items of a clause share one private helper, `capped(items)`. It returns the first `CHIP_PATHS_MAX` items joined with `', '`, then ` and N more` when items were left out.
- **No `Date`.** `conflictWords.ts` still builds no `new Date(`. D-7514's PWA scan in `server/test/single-definition/core-vocab.test.ts` holds it to that.

- [ ] **Step 1: The failing word tests.** In `pwa/test/conflict-words.test.ts`, import `CHIP_PATHS_MAX` and `CHIP_LINES_MAX` and add the cases below. Then edit the existing rows as listed after them.

  New describe: `'the sentence is capped, and each cut says what it is (landing order wave 5a; 4b F6)'`:

```ts
const PATH_CUT = '(more paths not recorded)';
const LIST_CUT = 'Not every open PR or pair of PRs was measured';
const UNBOUND = "A PR on a session's branch was not matched to its session, so it was not compared with the others";
const conflictAt = (pr: number, paths: string[]) => landing({ pr, base: { state: 'conflict', paths } });

it('pins the caps by their literal values', () => {
  expect(CHIP_PATHS_MAX).toBe(3);
  expect(CHIP_LINES_MAX).toBe(5);
});

it('names at most three paths on a line, and says how many more', () => {
  const five = conflictChipSentence(conflictSummaryOf([sess('a', conflictAt(12, ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts']))], NOW)!);
  expect(five).toContain('PR #12 conflicts with main in src/a.ts, src/b.ts, src/c.ts and 2 more.');
  expect(five).not.toContain('src/d.ts');
  const three = conflictChipSentence(conflictSummaryOf([sess('a', conflictAt(12, ['src/a.ts', 'src/b.ts', 'src/c.ts']))], NOW)!);
  expect(three).toContain('PR #12 conflicts with main in src/a.ts, src/b.ts, src/c.ts.');
  expect(three).not.toContain(' more');
});

it('lists at most five conflict lines, then "and N more"', () => {
  const at = (prs: number[]) => conflictChipSentence(conflictSummaryOf(prs.map((pr) => sess(`s${pr}`, conflictAt(pr, ['src/a.ts']))), NOW)!);
  const parts = at([11, 12, 13, 14, 15, 16, 17]).split('. ');
  expect(parts.slice(0, 7)).toEqual([
    '7 predicted conflicts',
    ...[11, 12, 13, 14, 15].map((pr) => `PR #${pr} conflicts with main in src/a.ts`),
    'and 2 more',
  ]);
  expect(parts[7]).toMatch(/^measured \d\d:\d\d$/);
  expect(at([11, 12, 13, 14, 15])).not.toContain('more');
});

it.each([
  ['a path list the radar cut', { base: { state: 'conflict', paths: ['src/a.ts'], pathsCut: true } }, PATH_CUT],
  ["the radar's heads cut", { cut: { heads: true, pairs: false, unbound: false } }, LIST_CUT],
  ["the radar's pairs cut", { cut: { heads: false, pairs: true, unbound: false } }, LIST_CUT],
  ['an unbound head', { cut: { heads: false, pairs: false, unbound: true } }, UNBOUND],
] as const)('%s has its own words, and only those', (_name, over, words) => {
  const sentence = conflictChipSentence(conflictSummaryOf([sess('a', landing(over as Partial<SessionLanding>))], NOW)!);
  for (const w of [PATH_CUT, LIST_CUT, UNBOUND]) expect(sentence.includes(w), w).toBe(w === words);
  expect(sentence).not.toContain('(list cut)');
});

it('says a path cut on its own line, for a base line and a pair line', () => {
  const s = conflictSummaryOf([sess('a', landing({
    base: { state: 'conflict', paths: ['src/a.ts'], pathsCut: true },
    conflicts: [{ pr: 14, paths: ['src/x.ts'], pathsCut: true }],
  }))], NOW)!;
  const sentence = conflictChipSentence(s);
  expect(sentence).toContain('PR #12 conflicts with main in src/a.ts (more paths not recorded)');
  expect(sentence).toContain('PRs #12 and #14 conflict in src/x.ts (more paths not recorded)');
});

it('names what "not measured" counts, a base merge and a pair, within the cap', () => {
  expect(conflictChipSentence(conflictSummaryOf([sess('a', landing({ base: { state: 'unmeasured' } }))], NOW)!))
    .toContain('1 not measured: #12 with main');
  expect(conflictChipSentence(conflictSummaryOf([sess('a', landing({ unmeasuredWith: [13, 14, 15, 16, 17] }))], NOW)!))
    .toContain('5 not measured: #12 with #13, #12 with #14, #12 with #15 and 2 more');
});

it('orders the named merges by project and PR, base first, and names the project across projects', () => {
  const s = conflictSummaryOf([
    sess('b', landing({ unmeasuredWith: [14], base: { state: 'unmeasured' } }), 'proj-b'),
    sess('a', landing({ unmeasuredWith: [14] }), 'proj-a'),
  ], NOW)!;
  expect(conflictChipSentence(s)).toContain('3 not measured: proj-a #12 with #14, proj-b #12 with main, proj-b #12 with #14');
});

it('names what "not paired" counts, within the cap and across projects', () => {
  const five = conflictSummaryOf([11, 12, 13, 14, 15].map((pr) => sess(`s${pr}`, landing({ pr, paired: false }))), NOW)!;
  expect(conflictChipSentence(five)).toContain('5 not paired: #11, #12, #13 and 2 more');
  const two = conflictSummaryOf([sess('b', landing({ paired: false }), 'proj-b'), sess('a', landing({ pr: 30, paired: false }), 'proj-a')], NOW)!;
  expect(conflictChipSentence(two)).toContain('2 not paired: proj-a #30, proj-b #12');
});

it("bounds review 1225's measured fleet: 10 PRs, 55 conflicts, 20 paths of 300 characters", () => {
  const long = Array.from({ length: 20 }, (_, i) => `src/${String(i).padStart(2, '0')}/${'x'.repeat(293)}`);
  const prs = Array.from({ length: 10 }, (_, i) => 101 + i);
  const s = conflictSummaryOf(prs.map((pr) => sess(`s${pr}`, landing({
    pr, base: { state: 'conflict', paths: long, pathsCut: true },
    conflicts: prs.filter((o) => o !== pr).map((o) => ({ pr: o, paths: long, pathsCut: true })),
  }))), NOW)!;
  expect(s.conflicted).toHaveLength(55);
  const sentence = conflictChipSentence(s);
  const parts = sentence.split('. ');
  const shown = `${long.slice(0, 3).join(', ')} and 17 more (more paths not recorded)`;
  expect(parts[0]).toBe('55 predicted conflicts');
  expect(parts.filter((p) => /^PRs? #/.test(p))).toHaveLength(5);
  expect(parts[1]).toBe(`PR #101 conflicts with main in ${shown}`);
  expect(parts[5]).toBe(`PRs #101 and #105 conflict in ${shown}`);
  expect(parts[6]).toBe('and 50 more');
  expect(sentence.length).toBeLessThanOrEqual(5_000);
});

it('orders the parts: word, lines, tail, the cut sentences, the clauses, the time', () => {
  const s = conflictSummaryOf([sess('a', landing({
    pr: 12, paired: false, unmeasuredWith: [19],
    base: { state: 'conflict', paths: ['src/a.ts'] },
    conflicts: [14, 15, 16, 17, 18].map((pr) => ({ pr, paths: ['src/x.ts'], pathsCut: false })),
    cut: { heads: true, pairs: false, unbound: true },
  }))], NOW)!;
  const parts = conflictChipSentence(s).split('. ');
  expect(parts.slice(0, 11)).toEqual([
    '6 predicted conflicts',
    'PR #12 conflicts with main in src/a.ts',
    ...[14, 15, 16, 17].map((pr) => `PRs #12 and #${pr} conflict in src/x.ts`),
    'and 1 more',
    LIST_CUT,
    UNBOUND,
    '1 not measured: #12 with #19',
    '1 not paired: #12',
  ]);
  expect(parts[11]).toMatch(/^measured \d\d:\d\d$/);
  expect(parts).toHaveLength(12);
});
```

  **The existing rows that change, in this commit.** These are the intended behaviour change: the words are now true.
  - `'says what was cut, what was not measured, and when the oldest reading was measured'`:
    - `toContain('(list cut)')` becomes `toContain('PR #12 conflicts with main in src/a.ts (more paths not recorded)')` and `toContain('Not every open PR or pair of PRs was measured')`;
    - add `not.toContain('(list cut)')`;
    - `toContain('1 not measured')` becomes `toContain('1 not measured: #12 with #15')`.
  - `'counts unmeasuredWith across sessions, and a pair reported from both of its PRs once'`:
    - `expect(s.unmeasured).toBe(2)` becomes `toHaveLength(2)`;
    - `toContain('2 not measured')` becomes `toContain('2 not measured: #12 with #14, #12 with #15')`.
  - `'counts the same pair numbers of two projects separately, and an unmeasured base beside them'`: `expect(s.unmeasured).toBe(3)` becomes `toHaveLength(3)`.
  - `'adds "N not paired" for a landing the radar left out of its pairs, beside the unchanged word'`:
    - `expect(s.unpaired).toBe(2)` becomes `toHaveLength(2)`;
    - `toContain('2 not paired')` becomes `toContain('2 not paired: #12, #14')`.

- [ ] **Step 2: Run the file and see it fail.**
  - Command: `cd pwa && ./node_modules/.bin/vitest run test/conflict-words.test.ts`
  - Expected:
    - the pin reads `expected undefined to be 3`;
    - the cap, cut, clause and bound cases fail on their `toContain` and `toBe` texts, because main still says `(list cut)`, has no tail, and prints bare counts;
    - three of the four edited rows fail on `toHaveLength`, because main's `unmeasured` and `unpaired` are numbers; the fourth, 'says what was cut...', fails on its new `toContain` texts.
  - Every other case stays green.

- [ ] **Step 3: Implement** in `conflictWords.ts`, to the Interfaces, the words table and the tests above:
  - Add the two constants and `ConflictRef`; `ConflictLine` extends it.
  - `conflictSummaryOf` collects `unmeasured` (base merges and pairs, each pair once under its lower PR) and `unpaired`, sorted like `conflicted`, with a base merge before a pair; it sets `listCut` and `unbound`; `partial` and `hasCut` are unchanged.
  - Two private helpers: `capped(items)` and `refWords(r, named)`.
  - The three fixed sentences are private top-level constants, so `plain-words` reads them.
  - The header says the sentence is capped (wave 5a, 4b F6) and every word is true (D-7480).

- [ ] **Step 4: Run the words suites and see them pass.** In `pwa/`, run each file on its own:
  - `test/conflict-words.test.ts`
  - `test/conflict-chip.test.tsx`: unchanged. Its name case still matches `/PRs #12 and #14 conflict in src\/x\.ts/`.
  - `test/plain-words.test.ts`: `conflictWords.ts` is already on its fleet list. The new constants say none of the forbidden words.
  - `test/literal-census.test.ts`: each new sentence of 25 or more characters is spelled once.

- [ ] **Step 5: The pins on order and ownership.** These pass on the tree as it stands. Each one's red is measured by its mutant in Step 7.
  - **`pwa/test/fleet-screen.test.tsx`.** Add a new describe, using the file's own `makeStore`, `renderFleet`, `seed`, `session` and `TEST_ROSTER`:

```tsx
describe('the predicted-conflict chip renders after the claimed-files strip (landing order wave 5a; 4b F4 a)', () => {
  it('puts the chip after the strip in the document, and outside it', async () => {
    const T = Date.now();
    vi.spyOn(api, 'claims').mockResolvedValue({ claims: [{
      id: 1, project: 'ProjectC', paths: ['src/a.ts'], heldBy: 'lane-a-proj-a-alpha', heldByUuid: null, intent: '',
      runId: 3, state: 'live', createdAt: T - 60_000, renewedAt: T - 60_000, expiresAt: T + 40 * 60_000,
      hardExpiresAt: T + 8 * 3_600_000, endedAt: null, endedBy: null,
    }] });
    const store = makeStore();
    renderFleet(<FleetScreen store={store} />);
    seed(store, { conn: 'open', roster: TEST_ROSTER, sessions: [session({ landing: {
      at: new Date(T - 30_000).toISOString().replace(/\.\d{3}Z$/, 'Z'), pr: 12, head: 'abc1234', baseRef: 'main',
      base: { state: 'clean' }, paired: true, conflicts: [], unmeasuredWith: [],
      cut: { heads: false, pairs: false, unbound: false },
    } })] });
    const strip = await screen.findByRole('region', { name: 'Claimed files' }, { timeout: 5000 });
    const chip = screen.getByRole('status', { name: /No predicted conflicts in 1 measured PR/ });
    expect(strip.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING, 'the chip renders after the strip').not.toBe(0);
    expect(strip.contains(chip), 'the chip is not inside the strip').toBe(false);
  });
});
```

  - **`pwa/test/fleet-css.test.ts`.** In the case `'seats the predicted-conflict chip beside the hot-files strip, outside the runs line (wave 4b)'`, add `expect(chip, 'the chip mounts after the strip').toBeGreaterThan(strip);` right after the `'the chip left the fleet screen'` assertion. Without it, a chip moved above the runs line leaves both existing slices empty or chip-free, so the case passes.
  - **`server/test/rings/pwa-one-owner.test.ts`.** Add `identifierReferences` and `stringPieces` to the `../scan/parse.js` import, then add a describe:

```ts
// Landing order wave 5a (4b review F4 d; D-7481): `landingOf` in conflictWords.ts is the PWA's one reader of
// FleetSession.landing. Outside it, the one allowance is ConflictChip's clock gate, `s.landing !== undefined`, a presence
// test that reads no content. Any identifier named `landing` and any string 'landing' counts: the owner itself reads the
// key as a string through `reviveSessionLanding`, and a destructure or an element access is a read too.
const LANDING_OWNER = 'pwa/src/fleet/conflictWords.ts';
interface LandingSite { file: string; line: number; context: string }
const landingSitesIn = (text: string, file: string): LandingSite[] => [
  ...identifierReferences(text, file, new Set(['landing'])).map((r) => ({ file, line: r.line, context: r.context })),
  ...stringPieces(text, file).filter((s) => s.text === 'landing').map((s) => ({ file, line: s.line, context: "'landing'" })),
].sort((a, b) => a.line - b.line);
const CHIP_NAMES = new Set(['CHIP_PATHS_MAX', 'CHIP_LINES_MAX']);
const chipDefinitionsIn = (text: string, file: string): string[] => identifierReferences(text, file, CHIP_NAMES)
  .filter((r) => r.role === 'other' && new RegExp(`^${r.name}\\s*(?:=(?!=)|:)`).test(r.context)).map((r) => r.name);

describe('landingOf is the PWA\'s one reader of FleetSession.landing; the chip caps are defined once (wave 5a)', () => {
  it('CONTROL: the scans see each shape of a read and a definition, and not a comment, a longer name or a use', () => {
    expect(landingSitesIn('const a = s.landing;', 'x.ts').map((x) => x.context)).toEqual(['s.landing']);
    expect(landingSitesIn("const a = s['landing'];", 'x.ts').map((x) => x.context)).toEqual(["'landing'"]);
    expect(landingSitesIn('const { landing } = s;', 'x.ts')).toHaveLength(1);
    expect(landingSitesIn("reviveSessionLanding(s, 'landing');", 'x.ts').map((x) => x.context)).toEqual(["'landing'"]);
    expect(landingSitesIn('// s.landing\nconst a = landingOf(s, 1); type T = SessionLanding;', 'x.ts')).toEqual([]);
    expect(chipDefinitionsIn('export const CHIP_LINES_MAX = 5;', 'x.ts')).toEqual(['CHIP_LINES_MAX']);
    expect(chipDefinitionsIn("import { CHIP_LINES_MAX } from './w'; const n = CHIP_LINES_MAX + 1;", 'x.ts')).toEqual([]);
    expect(chipDefinitionsIn('if (CHIP_LINES_MAX === 5) {}', 'x.ts')).toEqual([]);
  });

  it('no pwa/src file but conflictWords.ts reads a landing; the chip\'s clock gate is the one allowance', () => {
    const owner = landingSitesIn(parse(LANDING_OWNER).text, LANDING_OWNER);
    expect(owner.map((s) => s.context), 'the owner reads the key through the wire revive').toContain("'landing'");
    const outside = files().filter((f) => f !== LANDING_OWNER).flatMap((f) => landingSitesIn(parse(f).text, f));
    expect(outside.map(({ file, context }) => ({ file, context })))
      .toEqual([{ file: 'pwa/src/fleet/ConflictChip.tsx', context: 's.landing' }]);
    const gate = outside[0]!;
    expect(parse(gate.file).text.split('\n')[gate.line - 1], 'the allowance is a presence test only')
      .toContain('s.landing !== undefined');
  });

  it('defines CHIP_PATHS_MAX and CHIP_LINES_MAX once each, in conflictWords.ts', () => {
    const where: Record<string, string[]> = {};
    for (const f of walkSrc({ roots: ['pwa/src', 'ui/src', 'shared'], min: 200 })) {
      for (const n of chipDefinitionsIn(parse(f).text, f)) (where[n] ??= []).push(f);
    }
    expect(where).toEqual({ CHIP_PATHS_MAX: [LANDING_OWNER], CHIP_LINES_MAX: [LANDING_OWNER] });
  });
});
```

  The defined-once case was red before Step 3, when `where` was `{}`. The other two pass on main.

- [ ] **Step 6: Run every touched file whole,** one process each, in the foreground, under the Global Constraints, then Task 5 Step 3's guards. Beyond those:
  - **pwa:** `conflict-words`, `conflict-chip`, `plain-words`, `literal-census` and `fleet-css`; `fleet-screen`, which is heavy, through `~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/fleet-screen.test.tsx`.
  - **server:** `rings/pwa-one-owner` (its imports grew, so `typecheck-tests` runs alone too); `census-w7/pwa`, which must find no new poll and no storage owner; `single-definition/core-vocab`, whose D-7514 scan must still find no `new Date(` in `conflictWords.ts`.
  - **growth-check:** no growth-listed file is touched, and the row says so.

- [ ] **Step 7: The mutations.** Run them one at a time. Save a copy of each file first, and restore it from that copy, checked by its sha, never with `git checkout`. For each row, record the red the table predicts. `FleetCards.tsx` and `runWords.ts` are claimed for T3-15 and T3-17 only.

- [ ] **Step 8: Commit:** `fix(pwa): the predicted-conflict chip's sentence is capped and names each cut (landing order wave 5a)`

| # | Mutation | Predicted red |
|---|---|---|
| T3-1 | `CHIP_PATHS_MAX` 3 → 4 | the pin (`expected 4 to be 3`); "names at most three paths" (it reads `…src/d.ts and 1 more`); the bound case (the sentence passes 5,000) |
| T3-2 | `CHIP_LINES_MAX` 5 → 6 | the pin; "lists at most five conflict lines" (part 6 is `PR #16 …`, not `and 2 more`); the bound case (the sentence passes 5,000, and six lines match `/^PRs? #/`) |
| T3-3 | `capped` drops its ` and N more` tail | "names at most three paths" (`…src/c.ts.`); the `5 not measured: … and 2 more` case; the `5 not paired: … and 2 more` case; the bound case's `parts[1]` |
| T3-4 | the lines tail part is not emitted | "lists at most five conflict lines" (`parts[6]` is `measured …`); the bound case's `parts[6]` |
| T3-5 | the path-cut words revert to ` (list cut)` | the path-list it.each row (no `PATH_CUT`, and it contains `(list cut)`); "says a path cut on its own line"; the edited "says what was cut" row |
| T3-6 | `listCut` reads `cut.heads` only | the "pairs cut" it.each row (`LIST_CUT` absent) |
| T3-7 | the unbound sentence is spelled as `LIST_CUT` | the "unbound head" row (`UNBOUND` absent, `LIST_CUT` present) |
| T3-8 | `listCut` also takes `cut.unbound` | the "unbound head" row (`LIST_CUT` is present where it must be absent) |
| T3-9 | the `not measured` clause prints the count alone | the base-merge and cap cases; the cross-project order case; the edited `2 not measured: …` and `1 not measured: #12 with #15` rows |
| T3-10 | `unmeasured` is left unsorted (in collection order) | the cross-project order case: sessions are given proj-b first, so the clause reads `proj-b #12 with main, …` |
| T3-11 | clause items drop the project prefix when `projects > 1` | the cross-project order case; `2 not paired: proj-a #30, proj-b #12` |
| T3-12 | the `not paired` clause prints the count alone | the edited `2 not paired: #12, #14` row; both "names what not paired counts" assertions |
| T3-13a | in `FleetScreen.tsx`, `<ConflictChip sessions={sessions} />` moves to directly above `<HotFilesStrip />` | the fleet-screen case (`compareDocumentPosition` gives PRECEDING, so `& FOLLOWING` is 0); in fleet-css the new `toBeGreaterThan(strip)` and, behind it, the existing 'pulled inside the runs line' assertion |
| T3-13b | in `FleetScreen.tsx`, the `<ConflictChip sessions={sessions} />` line moves to just above `{runsLine && (`, the runs-line conditional, outside it (not above the `fleet-runs-line` div, which would put two siblings inside the `&&`) | the fleet-screen case; in fleet-css ONLY the new `expect(chip, 'the chip mounts after the strip').toBeGreaterThan(strip)` (the existing slice checks stay green, which is what makes the new line necessary) |
| T3-14 | `ConflictChip`'s gate reads `s.landing?.at !== undefined` | the one-reader case: the site's line no longer contains `s.landing !== undefined` |
| T3-15 | add `export const landingKey = 'landing';` to `pwa/src/fleet/FleetCards.tsx` | the one-reader case: `outside` gains a `FleetCards.tsx` site, so it no longer equals the one allowance |
| T3-16 | `landingSitesIn` drops its `stringPieces` arm | CONTROL (the `s['landing']` and revive-key rows give `[]`); the one-reader case's owner assertion (no `'landing'`) |
| T3-17 | add `export const CHIP_LINES_MAX = 5;` to `pwa/src/fleet/runWords.ts` | the defined-once case (`CHIP_LINES_MAX` lists two files) |
| T3-18 | `chipDefinitionsIn`'s regex loosens to `^NAME\s*[=:]` | CONTROL's `if (CHIP_LINES_MAX === 5) {}` row (it now reads as a definition) |
| T3-19 | the `not paired` clause is emitted before the `not measured` clause | the order case (`parts[9]` is `1 not paired: #12`, not the not-measured clause) |
| T3-20 | the 'and N more' lines tail is emitted after the unbound sentence | the order case (`parts[6]` is `LIST_CUT`, not `and 1 more`) |
| T3-21 | `unpaired` is left unsorted (collection order) | 'names what "not paired" counts' two-project assertion (sessions are given proj-b first, so the clause reads `proj-b #12, proj-a #30`) |


### Task 4: text and pins

Everything here is text, comments or tests, plus test helpers. No server or verdict code changes (D-7536, the ruling on D-7495's carried question: keep the strict rule); the §5b verdict block stays byte-identical. Task 4 changes `server.ts` and `watch.ts` in comment lines only, so it adds no net code line to either. Wave 3d's docstring items are taken here too (Step 6): both of the scope's conditions hold, because Tasks 2 and 4 edit `watch.ts` and growth-check does not count comment lines.

**Files:**
- Modify:
  - `ccd/coordinator-skill/references/wave-lifecycle.md`, §5b only: the `MERGED head=<sha>` bullet, the **On every route** sentence and the stop paragraph.
  - `server/src/server.ts`: the comment above the `/ws/fleet` cold frame (`THE COLD FRAME IS THE WATCHER'S LAST BROADCAST …`).
  - `server/src/watch.ts`, docstrings only:
    - `FleetWatcher.currentFleet` and `FleetWatcher.currentPending` (review 1226 F1);
    - the `FleetWatcher.mergedNotified` field and `FleetWatcher.sweepPr` (wave 3d's docstring items; the scope's condition holds, see Step 6).
- Test:
  - `server/test/radar-fleet-frames.test.ts`
  - `server/test/radar-lane.test.ts`
  - `server/test/single-definition/core-vocab.test.ts`
  - `server/test/ccd-retire-verdicts.test.ts`
  - `server/test/mergeBase.ts` (test helper)
  - `server/test/coordinator-skill.test.ts`
  - `server/test/coordinator-landing-verdict.test.ts`
- Read, not modified: `ccd/coordinator-skill/SKILL.md`. Its clause 15 pin gets stronger, but its text does not change. The new-head route and the train-landed proof live in §5b, and step 6 already sends every landing there.
- Mutation-only, claimed for that row alone: `ccd/coordinator-skill/SKILL.md` (T4-11) and `server/src/coord/lineageRead.ts` (T4-2, which Task 2 already edits).

**Interfaces:**
- Consumes:
  - from `server/test/scan/symbols.ts`: `sourceOfSymbol(file, name)`;
  - from `server/test/single-definition/helpers.ts`: `stallCodeText`;
  - from `server/test/consolidationCensus.ts`: `ccdLauncherIn`.
- Produces, in `server/test/mergeBase.ts`. Both changes are additive. `citations.test.ts` and `refusal-status.test.ts` import only `mergeBaseDiff`, `mergeBaseText`, `addedLines` and `removedLines`, which do not change.
  ```ts
  export interface TreeEntry { readonly mode: string; readonly type: string; readonly oid: string; readonly path: string }
  export function treeEntriesAt(cwd: string, rev: string, dir: string): TreeEntry[] | null;
  export function mergeBaseFiles(cwd: string, dir: string): { base: string; files: string[]; entries: TreeEntry[] } | null;
  ```
  `treeEntriesAt` reads `git ls-tree -r -z <rev> -- <dir>/`. A record parses only if it matches `/^(\d{6}) (blob|commit|tree) ([0-9a-f]{40,64})\t([\s\S]+)$/`. Otherwise the whole answer is `null`. `files` is `entries.map((e) => e.path)`.
- Produces, module-local in `server/test/ccd-retire-verdicts.test.ts`:
  ```ts
  const blobId = (bytes: Buffer): string;
  function lsTree(cwd: string, rev: string, dir: string): string[];
  function treeOf(root: string, dir: string): string[];
  function extractEntries(cwd: string, rev: string, entries: readonly TreeEntry[], into: string): boolean;
  function baseCcd(root: string = ROOT): string | null;
  ```

---

- [ ] **Step 1: The frame and lane cases (4b F4 (b), review 1226 F2).**
  - **`radar-fleet-frames.test.ts`.** The case `tick() runs the lane itself: no earlier pass, and the broadcast still reaches a landing` keeps its title and now asserts what the title claims:
    ```ts
    const { bus, watcher } = await boot(false);
    const frames: FleetSession[][] = [];
    bus.on('fleet', (s) => frames.push(s as FleetSession[]));
    await watcher.tick();                                                         // the lane's first pass starts here
    await vi.waitFor(() => expect(watcher.currentLandings().get(ID)).toMatchObject(LANDING));
    await watcher.tick();                                                         // a tick after the pass broadcasts it
    expect(frames.length, 'tick() broadcast no fleet').toBeGreaterThan(0);
    expect(row(frames.at(-1)!).landing, 'the broadcast never reached the landing the lane found').toMatchObject(LANDING);
    expect(row(watcher.currentFleet()!).landing).toMatchObject(LANDING);
    ```
    The lane runs unawaited, so the first tick's broadcast may or may not carry the landing. The second tick re-emits only if its fleet differs from the last one. Either way, the last frame carries the landing.
  - **`radar-lane.test.ts`, the G6 case.**
    - Its title becomes `tick() hands an unlistable registry to the lane as null, and the lane keeps the map it holds (G6)`.
    - Its comment gains: "It pins the null hand-off and the kept map. Its second tick runs at +61 s, inside the doc's window, so the re-ageing is pinned by the direct `sweepRadar(null, …)` cases above (review 1226, F2)."
    - The body is unchanged.
  - **Run** each file alone, from `server/`:
    - `./node_modules/.bin/vitest run test/radar-fleet-frames.test.ts`
    - `./node_modules/.bin/vitest run test/radar-lane.test.ts`

    Expected: both green. These are pins of today's behaviour. Their red is T4-1, measured in Step 9.

- [ ] **Step 2: The D-7514 scan (4b F4 (c); D-7538, amending D-7514), in `core-vocab.test.ts`'s describe `the radar files have one freshness rule (D-7514)`.**
  - **Rename `PWA_ONLY` to `BUILDS_A_DATE`** (same regex, `/\bnew Date\(/`). Its two CONTROL lines are unchanged. Rewrite the comment above it: the PWA's two readers build no `Date`, and the server readers build one only at the named log line below.
  - **A new case:** `every listed radar reader exists: a moved or deleted one is red, never skipped (D-7514)`.
    ```ts
    const missing = [...READERS].filter((f) => !existsSync(path.join(ccrcRoot, f)));
    expect(missing, 'a listed radar reader is missing: move its row with the file').toEqual([]);
    ```
  - **The existing scan case reads every listed file.**
    - `const present = READERS;` and the PWA scan reads `PWA_READERS` unfiltered.
    - The `must` loop and the "never vacuous" line go, because the existence case now holds both.
    - Rewrite the comment above `READERS`: a file missing from the list is red, never skipped.
  - **A new case:** `no server radar reader builds a Date on a code line, save the busy-shadow log line in FleetWatcher.mailPass (D-7514)`.
    ```ts
    const DATE_ALLOWANCE = { file: 'server/src/watch.ts', symbol: 'FleetWatcher.mailPass' } as const;
    const SERVER_READERS = READERS.filter((f) => f.startsWith('server/'));
    expect(SERVER_READERS).toEqual(['server/src/coord/radar.ts', 'server/src/coord/lineage.ts', 'server/src/coord/lineageRead.ts',
      'server/src/watch.ts', 'server/src/fleet.ts', 'server/src/server.ts']);
    const allowed = sourceOfSymbol(path.join(ccrcRoot, DATE_ALLOWANCE.file), DATE_ALLOWANCE.symbol);
    const at = stallCodeText(allowed).split('\n').filter((l) => BUILDS_A_DATE.test(l));
    expect(at, 'the allowance holds exactly one new Date(, its log line').toHaveLength(1);
    expect(at[0]).toMatch(/console\.warn\(`ccrc-server: mail-gate busy-shadow /);
    const hits = SERVER_READERS.filter((f) => {
      const raw = readFileSync(path.join(ccrcRoot, f), 'utf8');
      if (f !== DATE_ALLOWANCE.file) return BUILDS_A_DATE.test(stallCodeText(raw));
      expect(raw.includes(allowed), 'the allowed symbol is not verbatim in its file').toBe(true);
      return BUILDS_A_DATE.test(stallCodeText(raw.replace(allowed, '')));
    });
    expect(hits, 'a server radar reader that builds a Date').toEqual([]);
    ```
    The allowance is named by symbol, never by line number. Its comment says why: the line formats a time for a person and reads no freshness.
  - **Run** `./node_modules/.bin/vitest run test/single-definition/core-vocab.test.ts`. Expected: green on today's tree. The reds are T4-2, T4-3 and T4-4.

- [ ] **Step 3: The retire-verdicts guard (review 1222, D-7496, D-7539): failing first.**
  1. **Factor without changing behaviour.**
     - Add `TreeEntry`, `treeEntriesAt` and `entries` to `server/test/mergeBase.ts`.
     - Move today's write loop of `baseCcd` into `extractEntries`, unchanged: plain `writeFileSync`, no mode, a link written as a file. In this step the try covers the reads only.
     - `baseCcd` gains `root: string = ROOT`. It passes `root` to `mergeBaseFiles` and as `show`'s cwd, and computes the repo-relative names (the launcher's, `ccd/lib`) from `ROOT` and `CCD`/`CCD_LIB` as today. Its caller `baseCcd()` is unchanged. Without this step the fixture cases below would call a zero-parameter `baseCcd` and read the real repository's base.
     - `lsTree` and `treeOf` both return `${mode} ${oid} ${path}` lines, sorted. `lsTree` is the guard's own `git ls-tree` reader, independent of `mergeBase.ts`. `treeOf` reads disk under `root/dir` and never follows a link: a link is `120000` with the blob id of its target text, and a file is `100755` when any x bit is set, otherwise `100644`.
  2. **The fixture describe.** Add `describe('the base extraction keeps every entry it can, and refuses the rest (D-7496, review 1222)')`. It is not `skipIf(!LINUX)`: it uses git and symlinks only.
     - Its `scratch()` makes a repository and runs every git call as `git -c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null -c init.templateDir=` (with `-q` on `init` and `commit`), so a runner's global signing, hooks or template directory cannot reach the fixture.
     - Commit A holds:
       - `ccd/lib/plain.sh` (100644, `echo a\n`);
       - `ccd/lib/run.sh` (100755);
       - `ccd/lib/link`, a symlink to `plain.sh` (120000).
     - Commit B (HEAD) rewrites `plain.sh` to `echo b\n`.
     - Its cases:
       - `keeps a 100644 file, a 100755 file and a 120000 link as git holds them at the named commit, never at HEAD`:
         ```ts
         const { repo, a } = scratch();
         const want = lsTree(repo, a, 'ccd/lib');
         expect(want.map((l) => l.split(' ')[0]).sort(), 'fixture control').toEqual(['100644', '100755', '120000']);
         const out = mkTmp('c5d-extract-');
         expect(extractEntries(repo, a, treeEntriesAt(repo, a, 'ccd/lib')!, out)).toBe(true);
         expect(treeOf(out, 'ccd/lib')).toEqual(want);
         ```
       - `refuses a gitlink, whose bytes it cannot keep`:
         - commit C adds `git update-index --add --cacheinfo 160000,<a>,ccd/lib/sub`;
         - expect `extractEntries(repo, c, treeEntriesAt(repo, c, 'ccd/lib')!, mkTmp('c5d-extract-'))` `toBe(false)`.
       - `never throws: a destination it cannot write answers false`:
         - `into` is `path.join(<a regular file>, 'x')`;
         - expect `extractEntries(repo, a, …, into)` `toBe(false)`.
       - `baseCcd extracts a repository's merge-base ccd/lib and launcher`:
         - the scratch repository holds `ccd/ccd` as well, and `git update-ref refs/remotes/origin/main <A>` is run in it;
         - `baseCcd(repo)` returns a path that exists, and `treeOf(path.dirname(path.dirname(<that path>)), 'ccd/lib')` equals `lsTree(repo, a, 'ccd/lib')`.
       - `baseCcd answers null, and leaves no temp tree, when an entry is refused`:
         - the same repository with the gitlink commit C as HEAD and `refs/remotes/origin/main` at C;
         - `baseCcd(repo)` is `null`, and the temp directory it made is gone.
  3. **The D-7496 case.** Its new title is `the extracted tree holds every entry the merge-base's own ccd/lib holds, byte for byte and mode for mode, and that is not nothing (D-7496)`. It reads the base with its own `git merge-base` call:
     ```ts
     const want = lsTree(ROOT, at, lib);
     expect(want.length, 'the base holds no ccd/lib entry: the guard would compare nothing').toBeGreaterThan(0);
     expect(treeOf(path.dirname(path.dirname(base)), lib)).toEqual(want);
     ```
     The non-empty assertion now comes before any read of the extracted tree.
  - **Run** `CI=1 ./node_modules/.bin/vitest run test/ccd-retire-verdicts.test.ts`. Expected red, from today's extraction:
    - the first fixture case: `run.sh` reads `100644` where git holds `100755`, and `link` reads `100644` where git holds `120000`;
    - the gitlink case: `true`, not `false`;
    - the unwritable case: an `ENOTDIR` throw;
    - `baseCcd extracts …`: the same mode mismatches as the first fixture case;
    - `baseCcd answers null …`: a path, not `null`.

    The D-7496 case and the 15 rows stay green, because every `ccd/lib` entry at today's base is a `100644` blob.

- [ ] **Step 4: Implement the extraction, then run it again.**
  - `extractEntries` writes each entry from `git show <rev>:<path>` in `cwd`, at `into/<path>`, by mode, and its whole body goes inside one try, so it never throws and any failure returns `false`:
    - `100644` → a file, `0o644`; `100755` → a file, `0o755`; both set with `chmodSync` after the write, so the umask cannot change the mode;
    - `120000` → `symlinkSync(target, dest)`, the target being the entry's text;
    - any other mode (a `160000` gitlink, a `tree`) → `false`.
  - `baseCcd`'s try widens to its whole body (the reads, `mkTmp`, the launcher write and `extractEntries`). On a failure it removes the temp directory it made, if any, and returns `null`. Its doc comment becomes: "It never throws on a refused or unreadable entry, and returns null."
  - **The no-base path's two messages** (the CI error and the local skip warning) say "no origin/main or no merge-base, or the extraction refused an entry or could not be written". `baseCcd answers null, and leaves no temp tree, when an entry is refused` asserts the `null` and the removed temp directory, and nothing more: the branch it feeds, `if (process.env['CI']) throw …` else warn, is the existing one, which the step rewords and no case drives. Under CI a `null` base therefore reds the differential half instead of skipping it, which Step 3's `CI=1` run exercises on every run.
  - Keep every `execFileSync` text in `baseCcd`, `extractEntries`, `lsTree` and `treeEntriesAt` free of `CCD`, `CCD_LIB` and `ccdLauncherIn`: read `ccd/ccd` through a `show(rel)` helper, as today, so `raw-spawn-census` does not read a git spawn as running ccd. `raw-spawn-census` runs in Step 8.
  - Run `CI=1 ./node_modules/.bin/vitest run test/ccd-retire-verdicts.test.ts`. Expected: all green, with the differential half and the 15 rows passing.
  - Then run `./node_modules/.bin/vitest run test/citations.test.ts` and `./node_modules/.bin/vitest run test/refusal-status.test.ts`, the other importers of `mergeBase.ts`. Both should be green.

- [ ] **Step 5: The skill text and its pins (D-7495 and review 1216 (2), review 1141).**
  - **The pins first.** In `coordinator-skill.test.ts`:
    1. **The clause 15 pin.** In `pins clause 15 as a whole line of SKILL.md, …`, add:
       ```ts
       expect(skill.split(line15), 'clause 15\'s line is written more than once in SKILL.md').toHaveLength(2);
       ```
    2. **The moved pins.** Change each of these to the new text below, flattened:
       - the `MERGED head=<sha>` entry in `pins the action text of every verdict line, whole (the action pins)` and in `pins the whole verdict-line list, …`;
       - the `**On every route**` sentence in the action pins and in `pins the whole No --admin paragraph and the proof paragraph …`.

       In `pins the whole stop paragraph, to the end of §5b: …`, append the two new-head sentences after the `Not a stop: …` sentence.
    3. **A new describe, at the end of the file:** `describe('landing order wave 5a: §5b names the train-landed proof and the new-head route')`. Its cases:
       - `the CLOSED stop the MERGED line names is the one the block prints for a closed PR (review 1216)`:
         - `expect(block).toContain('[ "$state" = CLOSED ] && stop "not-at-head: the PR is CLOSED"')`;
         - `expect(prose).toContain('for it the verdict prints `STOP not-at-head: the PR is CLOSED`')`.

         Here `block` and `prose` are derived as in the 3e describe.
       - `the strict rule the stop paragraph states is the block's own arm (D-7495)`:
         - `expect(block).toContain('elif any($r[]; .status == "completed" and (.conclusion | IN("success", "neutral", "skipped") | not))')`.
       - `no 5a sentence holds a double quote`. It uses the wave 4 census's loop over `flat(allSkillText)`, for these openings:
         - `'A PR a merge train landed reads CLOSED'`
         - `'Before you report that stop'`
         - `'Where that proof holds'`
         - `'A `red-unreachable` whose red is'`
         - `'The one rerun the RED bullet allows'`
  - **The verdict file.** In `coordinator-landing-verdict.test.ts`, add one row to `CHECKS`:
    ```ts
    ['a required name that failed and then passed on the same head is still red: any completed run that failed is red (D-7495)',
      with_(measured, { checkruns: runs(run('test (server)', 'failure'), run('test (server)'), run('test (agent)'), run('test (pwa)'), run('build-pwa')) }),
      'RED test (server) [github-actions]'],
    ```
  - Put the new describe at the end of the file, after the wave 4 describe, so it can use `allSkillText`, `refs`, `skill` and `flat`, and declare its own `wl`, `at`, `sec`, `fence`, `block` and `prose` exactly as the 3e describe does.
  - **Run** `./node_modules/.bin/vitest run test/coordinator-skill.test.ts`. Expected red: the action pins (one case, holding both the `MERGED` bullet and the **On every route** sentence), the list pin, the no-admin pin, the stop pin, the new CLOSED-stop prose pin, and the 5a quote census (its presence assertion fails until §5b is written). Expected green: the clause 15 pin, the arm pin and the verdict file's new row, which hold today's text and behaviour; their reds are T4-11 and T4-16.
  - **Then write §5b**, wrapped at the file's width. No sentence holds a `"`. Two decisions shape it:
    - D-7536: the strict rule is kept, pinned by the new `CHECKS` row and the arm-text pin (D-7536, the ruling on D-7495's carried question). A red that is `main`'s own is the `red-unreachable` stop, and its report names the new-head route. The coordinator does not take that route unasked, which spec 5.7.5 makes a stop.
    - D-7537: the train-landed proof is written on the CLOSED stop, not on the `MERGED head=` line, because the verdict prints `MERGED head=` only for state MERGED.

    Flattened, the text is:
    - **The `MERGED` bullet, whole:** "- `MERGED head=<sha>` — the PR already landed: prove it as step 3 does (MERGED, `headRefOid` equal to `handoffCommit`). It is not a stop; a different head fails the proof, and that is reported, never closed on. A PR a merge train landed reads CLOSED instead, so for it the verdict prints `STOP not-at-head: the PR is CLOSED`. Before you report that stop, prove the landing as step 3 does: CLOSED, `headRefOid` equal to `handoffCommit`, and `landedInTrain: true` on the PR's row of `ccd pr-state --session <sessionId>`. Where that proof holds, the PR landed, as on this line; where it does not (`trainUnproven`, `trainUnread`, no row, or another head), the stop stands."
    - **The proof sentence:** "**On every route** the merge is proven as step 3 proves it: MERGED, or CLOSED with `landedInTrain: true` on the PR's row of `ccd pr-state --session <sessionId>`, with `headRefOid` equal to `handoffCommit`."
    - **Appended to the stop paragraph:**
      - "A `red-unreachable` whose red is `main`'s own, already fixed on `main`, needs a new head, and its report names that route: a fix round to the owning worker on the `merging → working` edge (on route Q disarm first) for one clean merge of `main` and nothing else, then a review run scoped to that merge alone."
      - "The one rerun the RED bullet allows does not clear a red that is `main`'s own, and no close and reopen does either: the verdict calls a required name red while any completed run of it on the head failed, a later green run of it included (D-7495; judging only the newest run would loosen the gate, which is the operator's to decide), a rerun replays its run's original merge commit, and a close and reopen of the PR can race GitHub's recompute of the merge ref. The report of the stop names the new-head route above, not a rerun."
  - **Run** `coordinator-skill`, then `coordinator-landing-verdict`, each alone. Expected: green.

- [ ] **Step 6: The comments (review 1226 F1, and wave 3d's docstring items).** Comment lines only, so `growth-check` counts no net code line.
  - **`server.ts`, above the cold frame.** The block becomes: "THE COLD FRAME IS THE WATCHER'S LAST BROADCAST once there is one (`currentFleet`), less any landing past its window (`dropStaleLandings`, D-7481), and a snapshot is assembled only before it. The watcher re-emits only on change (`lastJson`), so a cold frame ASSEMBLED apart from that broadcast would never be corrected: one assembled from watcher state captured at connect could land AFTER a newer broadcast and replace it, and one assembled off a registry listing that failed once sent `fleet: []` to a fleet that was there. The one difference the cold frame may carry is the landings it drops. Those are past their window: the next listable tick assembles without them and re-emits, and until then the PWA's `landingOf` hides them too (review 1226, F1)." The `broadcastSeen` sentences that follow are unchanged.
  - **`FleetWatcher.currentFleet`:** "The fleet this watcher last BROADCAST, or null before its first. A new /ws/fleet socket takes it as its cold frame, and the degraded GET /api/fleet answers it, in both cases less any landing past its window (`server.ts` passes it through `dropStaleLandings`): what every connected client holds, save a prediction too old to show, which the next listable tick drops for them too. This watcher re-emits only on change, so a cold frame assembled apart from it, from state captured at connect or off a registry listing that failed once, was never corrected."
  - **`FleetWatcher.currentPending`:** change only the clause "after it, the cold frame IS that broadcast, `currentFleet`" to "after it, the cold frame is that broadcast, `currentFleet`, less any landing past its window (`dropStaleLandings`)". Keep the rest of the parenthesis and the paragraph as they are.
  - **The `FleetWatcher.mergedNotified` docstring (3d F2, F3).** Replace the sentence that starts "Three repeats remain, by design:" and runs to the end of the docstring with, re-wrapped at the file's width: "Four repeats remain, by design: a row pruned past `FEED_RETENTION` reads as never written; a push the presence gate kept out of the archive wrote no row to find; a push whose archive write threw (`notify` logs it, answers `archived: 'failed'` and still pushes) wrote none either; and a row archived before the key existed is matched only by its exact body, so one whose reason clause changed since (a hold placed, released or reworded, a run opened or closed, or the run read turning readable or unreadable) repeats once, at the first sweep after the deploy, and that repeat is keyed."
  - **The `FleetWatcher.sweepPr` docstring (3d F5).** "losing that edge to a restart costs one silently-replaced notification (see the field's own docstring)" becomes "a restart that loses that edge does not repeat the announcement, because the archive's keyed row answers `hasNotice` (the field's own docstring lists the repeats that remain)".
  - **Carried:** `README.md`'s and `pr-sweep.test.ts`'s copies of the repeat wording stay carried. They are outside this task's files.

- [ ] **Step 7: Run the suites that read `wave-lifecycle.md`,** each in the foreground, one file per process, with a timeout of at least 600000 ms, from `server/`. Expected: green. Steps 1 to 5 already ran the touched test files alone.
  - `child-reclaim-refusals`, `ccrc-api-closed`, `expiry-lane-prose`, `auth-passkey`, `worker-skill`, `reviewer-skill`, `install-coordinator-skill`, `session-hook-merge-deny`, `landing-verdict`, `ccrc-install-landing`, `ccrc-install-graphify`

- [ ] **Step 8: The guards.**
  - `growth-check`, with `GROWTH_CHECK=1`, after `git fetch origin main`. The delta it prints for `watch.ts` and for `server.ts` must equal the figures Task 2 recorded at its Step 9: its `watch.ts` delta, and 0 for `server.ts` (Task 3 touches neither), because Task 4 adds no net code line. The PR's own `watch.ts` delta also carries Task 2's and must stay inside the limit or a waiver.
  - `raw-spawn-census`.
  - The rest of the generic gate set runs as the Global Constraints say.

- [ ] **Step 9: Mutations.** Each runs one at a time, in the worktree, under the Global Constraints: save the file, mutate it, run, and restore it from the saved copy with its sha256 checked, never with `git checkout`. A row uses a scratch git fixture only when it needs one.
  - Run only the named file. A verdict-block or `SKILL.md` mutant is measured and restored like any other. It never ships.

  | # | Mutation | Expected red |
  |---|---|---|
  | T4-1 | `FleetWatcher.tick`'s `assembleFleet(…, panePids, this.landings)` drops `this.landings` | `tick() runs the lane itself: …` (its last frame's row has no `landing`). Also `tick() broadcasts the landing the lane holds`, and `stall-sweep`'s source pin. |
  | T4-2 | `mv server/src/coord/lineageRead.ts` aside (no other edit; core-vocab reads text only) | `every listed radar reader exists: …`, with `missing` `['server/src/coord/lineageRead.ts']`. Before this task it was filtered out and skipped. |
  | T4-3 | add the code line `const t0 = new Date(nowMs);` inside `FleetWatcher.sweepRadar` | `no server radar reader builds a Date …`: `hits` `['server/src/watch.ts']`. The allowance subtracts only `mailPass`, so the rest of the file is scanned. |
  | T4-4 | add the code line `const quiet = new Date(turn.since);` inside `FleetWatcher.mailPass`, outside the `console.warn` | the same case: `the allowance holds exactly one new Date(` reads 2 |
  | T4-5 | `extractEntries` writes `Buffer.concat([bytes, Buffer.from('\n')])` | the D-7496 case (every blob id differs) and the first fixture case. |
  | T4-6 | `extractEntries` writes every regular file `0o644` (drops the `100755` arm) | the first fixture case: `run.sh` reads `100644`. The D-7496 case stays green, because today's base holds only `100644` blobs, which is why the fixture exists. |
  | T4-7 | `extractEntries` writes a `120000` entry as a regular file of its target text | the first fixture case: `link`'s mode reads `100644` and its blob id is unchanged, so only the mode compare can red it |
  | T4-8 | `extractEntries` reads `git show HEAD:<path>` instead of `<rev>:<path>` | the first fixture case: `plain.sh` carries B's blob id. Equivalent at today's real base unless the branch changes `ccd/lib`. |
  | T4-9 | `extractEntries` writes a `160000` entry from `git show` instead of refusing | `refuses a gitlink, …`: `true`, not `false` |
  | T4-10 | `extractEntries`'s writes move outside its try | `never throws: …`: an `ENOTDIR` throw |
  | T4-11 | a second verbatim line `15. <clause 15>` inserted after clause 19's line in `SKILL.md` | the clause 15 pin's new assertion (length 3, not 2). The `update-branch` census also goes red (hits 2, licensed 1). |
  | T4-12 | the `MERGED` bullet loses its three train-landed sentences | the action pins, the list pin, and `the CLOSED stop the MERGED line names …` |
  | T4-13 | the stop paragraph loses its two new-head sentences | the stop pin (the whole paragraph `toBe`) |
  | T4-14 | the **On every route** sentence loses `or CLOSED with \`landedInTrain: true\` …` | the action pins and the no-admin pin |
  | T4-15 | the verdict block's `stop "not-at-head: the PR is CLOSED"` becomes `stop "not-at-head: the PR was closed"` | `the CLOSED stop the MERGED line names …` (block half). Also `coordinator-landing-verdict`'s CLOSED rows. |
  | T4-16 | the block's red arm `any($r[]; .status == "completed" and (…))` becomes the last completed run deciding: `(($r \| map(select(.status == "completed")) \| last) // null \| . != null and (.conclusion \| IN("success", "neutral", "skipped") \| not))` | the new `CHECKS` row: the green run is last, so the block prints `ROUTE Q …`, not `RED`. Also `the strict rule … is the block's own arm`. Every older row has one run per name, so they stay green under this mutant. |
  | T4-17 | `baseCcd` ignores a `false` from `extractEntries` and returns the launcher | `baseCcd answers null, and leaves no temp tree, when an entry is refused` |
  | T4-18 | insert a double quote into §5b's `Where that proof holds` sentence | the 5a quote census names the quote. The whole-text pins go red as well, but the census names it. |
| T4-19 | in the D-7496 case, `lsTree` reads a directory the base does not hold, such as `ccd/lib-x` | the non-empty assertion, by its message `the base holds no ccd/lib entry: the guard would compare nothing` |

- [ ] **Step 10: Commit.** Run `git add` on the ten files above, then commit:
  `test: text and pins — the tick broadcast, the D-7514 scan, retire-verdicts' blob and mode guard, clause 15 once, and §5b's new-head route and train-landed proof (landing order wave 5a)`

### Task 5: The gate, the PR and the wave-done

**Files:** none new. This task runs the gate over Tasks 1 to 4 at the final tip, measures the whole mutation table, and reports.

- [ ] **Step 1: Install every package's modules once.** Run `npm ci` in `server/`, `agent/`, `ui/` and `pwa/`, in that order, so `typecheck-tests` and the PWA suite measure the wave.
- [ ] **Step 2: Every touched test file, whole.** Run each one alone, in the foreground. Each task's run steps name its files. A known load flake is re-run alone once, and named in the wave-done.
- [ ] **Step 3: The repository's guards.** Run each test file as its own process: every file of `single-definition/` and `rings/`, and the files below.
  - `growth-check`, with `GROWTH_CHECK=1` after `git fetch origin main`. Report the figures for `watch.ts` and `server.ts`.
  - `deviation-refs`, after `git fetch origin main`.
  - `citations`, `anchors`, `docs-parity`, `raw-spawn-census` and `coordinator-skill`.
  - `typecheck-tests`, alone, through `ccrc test`.
  - `tsc --noEmit` for `server`, `pwa` and `agent`, through `ccrc test`.
  - The full PWA suite once, through `ccrc test`.
  - Do not run the full server suite: the merge queue runs it.
- [ ] **Step 4: The mutation table.** Measure every row of T1 to T4 on the final files, sequentially, under the Global Constraints' mutation rules. Report each row's measured red beside its prediction.
- [ ] **Step 5: The PR.**
  - Open the PR from the workspace branch.
  - Its body lists D-7528 to D-7539 and every departure found during execution.
  - Scan the body for private names before saving it.
  - Read the PR's fast run. The `plan fast server tests` job summary lists every selected server test file, so confirm each touched file is listed there. Read the pwa shards' logs as well.
- [ ] **Step 6: The wave-done.**
  - Send one wave-done at the exact final tip, with its fingerprint and the PR number.
  - Include the gate's lines, each mutation measured against its prediction, every departure, and the fast run's coverage.
  - Push nothing after the wave-done.

## Deviations found

This plan's block is D-7528 to D-7539, issued 2026-10-30. Each entry is dated 2026-10-30.

- **D-7528** — `lineage-header-measured-rules` (Task 1): wave 4c's D-7469 says the parser now refuses every doc that the radar's writers cannot produce, and `lineage.ts`'s header adds "from real merges". Neither is true. A hand-written doc that keeps every rule, with invented shas, still parses, and so did a `null` tip under a sha `base` until this wave. The header is restated to the shape rules `parseLineage` measures, and says they do not prove that a doc came from the radar or from real merges. D-7469's text stays as it is, because merged plans are append-only, and the header cites this entry. Nothing is loosened: the same rules apply, plus D-7529's.
- **D-7529** — `null-tip-under-a-base-unreadable` (Task 1): this narrows wave 4's D-7269, under which a `null` tip answered `tip-unmeasured`, never `lineage-unreadable`. A doc whose `tip` is `null` and whose `base` is a sha is now unreadable, so `decideLineage` answers `lineage-unreadable` for it. The radar never writes that doc: `lineage_unmeasured` writes no `base`, and a walk always has a tip. D-7469 refuses what the radar's writers cannot produce, and this follows it. Both answers are unmeasured, so no acceptance and no refusal code changes. D-7269's `tip-unmeasured` row stays reachable through the failed-fetch shape, whose `null` tip has no base.
- **D-7530** — `radar-pass-catches-and-names` (Task 2):
  - **The thrown listing.** It is caught in `readRadarPass`, around the listing alone, and answers `unreadable`, beside the per-project reads' own catch, not in the lane as the scope said. The lane says it through `said()`, once per change. A catch around the whole sweep would turn a programming fault into an io word and drop its stack. So the `landingRadar` row's `warnKey` stays as the runner's backstop for such faults, and a test pins it. One visible change follows: a thrown listing now logs that the listing is unreadable, not that the lane failed.
  - **Unsafe names.** A listed name that fails `isSafeProjectSegment` joins no path. It is reported, as the read `refused`, only when a listed record names that project. An unsafe directory that no session names is skipped silently, like every directory no session names. `listRadarProjects` still returns every refused name, so the adapter narrows nothing.
  - **The sanitiser.** The lane's log line names a project through the tree's existing `printableDetail` (`update/inventory.ts`), which `watch.ts` already imports. It replaces each run of non-printable characters with one space rather than deleting them. A newline cannot forge a second line, and no second helper is added.
- **D-7531** — `radar-pass-bounded-and-generational` (Task 2): the pass runs at most `RADAR_PASS_CONCURRENCY` (8) probe reads at once. Its one deadline, `LANDING_RADAR_SWEEP_MS / 2`, covers the listing as well as the reads, so a hung local listing settles as `late`. A hung read frees its slot at the deadline, and a name whose turn comes after the deadline answers `late` with no io. Each pass carries a generation, and the lane commits its map, and speaks, only if no newer pass has started. A pass the runner abandoned and later released can no longer overwrite a newer map, an empty one included. Wave 4b's plan had no bound and started the deadline after the listing.
- **D-7532** — `project-evidence` (Task 2, 4b F5):
  - **The field.** `registry.ts` keeps `project: project ?? id` as the display default for every reader. The record also gains a server-internal `projectEvidence` (absent, unreadable or measured), so the radar can tell an unreadable `.project` from a project named like the session's id. `radar.ts`'s `radarRowsOf` is its one reader, and a `core-vocab` row pins that.
  - **Unreadable.** A row whose `.project` is unreadable is stray in every project. Its branch joins every project's `rowBranches`, so it can only make a landing read less clean.
  - **Absent.** A row whose `.project` is absent joins no project. This goes past the scope's ruling, which named only the unreadable case. It follows the radar's own writer, which lists only rows that have a `.project` file.
  - **Order.** Rows are derived once, before the pass, so their branch and PR are as of the pass's start, at most the pass deadline older than before.
- **D-7533** — `chip-summary-lists-and-cut-words` (Task 3, 4b F6):
  - **Lists.** `ConflictSummary`'s `unmeasured` and `unpaired` become lists of what they count, so the clauses can name their PRs. Each count is now its list's length.
  - **Cuts.** `cut` splits into `listCut` (the radar cut its heads or its pairs) and `unbound`. "(list cut)" is retired.
  - **Three sentences.** The radar's heads-or-pairs cut and an unbound head are sentences of their own. A path-list cut is said at the end of its own conflict line ("(more paths not recorded)"), because `pathsCut` belongs to one conflict.
  - **No PRs named in the cut sentences.** `SessionLanding` carries only the three `cut` booleans, and naming the PRs left out would need a wire field.
  - **Tests.** Four existing rows in `conflict-words.test.ts` change in the same commit, as the intended behaviour change.
- **D-7534** — `chip-caps` (Task 3, 4b F6):
  - **`CHIP_PATHS_MAX = 3`.** It caps the paths named on one conflict line, and the PRs named in one partial clause. A shown path can be 300 characters, and three paths are enough to say where two PRs collide.
  - **`CHIP_LINES_MAX = 5`.** It caps the conflict lines only. The word, the cut sentences, the partial clauses and the time always show, so no partial reading is hidden. Review 1225's measured worst fleet falls from a 334,403-character sentence to under 5,000.
  - **Tails.** A cut tail reads "and N more".
  - **Guards.** A guard finds one declaration of each cap, and tests pin their values as literals.
- **D-7535** — `landing-one-reader-and-chip-order` (Task 3, 4b F4):
  - **One reader.** The guard that `landingOf` is the PWA's one reader of a landing counts every identifier named `landing` and every string piece `'landing'`, not only `.landing`. The owner reads the field through the key it passes to `reviveSessionLanding`, and a destructure or an element access is a read too. The guard lives in `rings/pwa-one-owner.test.ts`, beside the PWA's other one-owner rules. Its one allowance is the chip's clock gate, `s.landing !== undefined`, matched by its text.
  - **Chip order.** The order "chip after the hot-files strip" is pinned twice: in the rendered DOM (`fleet-screen.test.tsx`), and by a new `chip > strip` assertion in `fleet-css.test.ts`. The existing assertion passed with the chip above the runs line.
- **D-7536** — `strict-rule-kept-new-head-route-reported` (Task 4): this rules on D-7495's carried question. The verdict keeps its strict rule: a required name is red while any completed run of it on the head failed, a later green run included. Judging the newest run per name would loosen a landing gate, and that is the operator's to rule. A new row in `coordinator-landing-verdict.test.ts` (failed, then green, on one head, prints `RED`) and a text pin on the block's arm make the rule a mechanism. The §5b block stays byte-identical. A red that is `main`'s own, already fixed on `main`, ends as the `red-unreachable` stop: after the RED bullet's one rerun for a GitHub Actions run, and at once for an app or status check. Its report names the new-head route: a fix round for one clean merge of `main`, then a scoped review. A rerun replays the old merge commit, and a close and reopen can race GitHub's recompute of the merge ref, so neither is offered. The coordinator reports the route and does not take it unasked, because spec §5.7.5 makes such a red a stop. Wave 4c's landing took the route under D-7495, and whether the coordinator may do so on its own is the operator's to rule.
- **D-7537** — `train-landed-proof-on-the-closed-stop` (Task 4, review 1216 (2)): the verdict prints `MERGED head=` only for state `MERGED`. A train-landed PR is `CLOSED`, and for it the block prints the not-at-head stop, `the PR is CLOSED`. The block stays byte-identical. §5b's `MERGED` bullet now names that `CLOSED` stop, and tells the session to run step 3's train-landed proof before reporting it: `CLOSED`, `headRefOid` equal to `handoffCommit`, and `landedInTrain: true` on the `pr-state` row. When the proof does not hold, the stop stands. A pin ties the quoted stop text to the block's own line. For a train-landed PR, this amends the reading of two spec sections:
  - §5.7.5, which lists a `CLOSED` state among the not-at-head stops;
  - §5.7.4, which says the merge is proven "the same way it is today: MERGED, with `headRefOid` equal to `handoffCommit`".

  Today's proof, `wave-lifecycle.md` §5 step 3 (with clause 15), already accepts a merge train's landing on a `CLOSED` PR. This entry carries that into §5b. The verdict's own output is unchanged. Item (1) needs the PR-keyed `pr-state` form, so it goes to wave 5: proving a train-landed producer after its row is reclaimed.
- **D-7538** — `d7514-reader-scan-widened` (Task 4, 4b F4 (c)): this amends D-7514, whose test comment says `new Date(` is not scanned on the server, and whose scan skipped a listed reader file that no longer exists. A listed reader must now exist, and a missing one is red. The six server radar readers' code lines are scanned for `new Date(` too. The one allowance is `FleetWatcher.mailPass`'s log line, named by its symbol and limited to one occurrence on a `console.warn` line.
- **D-7539** — `retire-verdicts-entries` (Task 4, review 1222):
  - **Entries.** `server/test/mergeBase.ts` gains a `TreeEntry` type, a `treeEntriesAt` reader and an `entries` field beside the unchanged `files`. The change is additive, and its other importers are run in the gate.
  - **The comparison.** The D-7496 guard compares mode, blob id and path, not names.
  - **The extraction.** It keeps each entry's mode, and writes a `120000` entry as a symlink. A gitlink, or any mode other than `100644`, `100755` and `120000`, is refused, and `baseCcd` answers `null`, the existing no-base path.
  - **The no-base messages.** Its CI error and its local skip warning now name a refused or unwritable entry as well as a missing `origin/main` or merge base.
  - **The listing.** The case asserts that the base listing is non-empty before it reads the extracted tree, a hardening beside review 1222's three items.
  - **`baseCcd`.** It takes an optional root, so a fixture can measure its `null` path. Its comment claims only what is pinned: a refused or unreadable entry never throws.
