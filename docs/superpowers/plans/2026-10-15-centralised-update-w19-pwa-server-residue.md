# Centralised update management, wave 19: the PWA and server residue (R24, R26, R27) and the stable flake B5: Implementation Plan

The coordinator scoped wave 19 on 2026-10-15: the programme ledger's 22:11 UTC entry, "the cut to completion", placed R24(a), (b) and (d), R26(a) to (d), R27(a), R27(b)'s test half and B5 in this wave, and closed R24(c) as a documented limitation. The wave is run 483, with deviation block 5115 to 5134 (written bare until defined: this plan defines D-5115 to D-5124). A workflow drafted this plan on 2026-10-15 (a scout, then a prototyping drafter) from `main` at `518789ad039188950f5b33872dccd67c022f03c0` (#426). Every task was prototyped in the drafter's own worktree at `518789ad0`, at a load of 27 to 211 on 16 cores. Rows marked *(prototype)* were run through the real file with vitest, red first and then green, and every mutation was restored with `cp` and checked with `cmp`. Three attack passes read the draft on 2026-10-16, and a reviser applied the findings that held. **Lines the reviser added or changed and could not measure are marked *(revised, unmeasured)*.** A *(prototype)* mark on a revised line covers only the part that was measured, and the line says which part that is. The plan's file is `docs/superpowers/plans/2026-10-15-centralised-update-w19-pwa-server-residue.md`.

**Claims at drafting (read at 22:16 UTC by the scout, about 22:40 UTC by the drafter, at 23:47 UTC, and by the reviser at 00:37 UTC on 2026-10-16).**
- At 22:40, claim **1392** (run 400) held `pwa/src/screens/SettingsScreen.tsx`, `pwa/test/settings-screen.test.tsx` and `pwa/test/markup-census.test.ts`, among others. Claim **1390** (run 360) held `shared/api.ts` and `server/test/single-definition.test.ts`.
- **At 23:47 both had ended.** Run 400's PR, #384, had merged.
- At 00:37 on 2026-10-16:
  - claim **1436** (run 399) holds `server/test/single-definition.test.ts`;
  - claim **1419** (run 360) holds `server/test/box-token-census.test.ts`, among others;
  - this wave only runs those two files and never writes them;
  - no live claim names any File-structure path.
- This wave writes `SettingsScreen.tsx` only in **Task 6**, and `shared/api.ts` only in **Task 7** (a docstring). Both tasks are last and separable, because those claims renew. Each task takes its own claim, and it is **cut to a later fold, not the wave held,** if a live claim names its file again (Step 0). The wave never writes `settings-screen.test.tsx`, `markup-census.test.ts`, `single-definition.test.ts` or `box-token-census.test.ts`.
- Run 360's unlanded branch touches `server/src/coord/store.ts`. Task 2 Step 1 measures it against Task 2's edit sites.

**`main` has moved since drafting.** The prototype was built at `518789ad0`. At 23:47 UTC on 2026-10-15, and still at 00:37 UTC on 2026-10-16, `origin/main` was `0b3ff2f62` (#384). Between the two, `main` changed four of this wave's files away from its edits:
- `SettingsScreen.tsx`: three lines above Task 6's anchors;
- `server/src/coord/store.ts`: `rowHalts` moved from line 1063 to 1070;
- `shared/api.ts`: Task 7's docstring moved from 9333-9337 to 9346-9350, and the file is 10080 lines;
- `pwa/test/settings-screen.test.tsx`: run only.

The prototype merged `0b3ff2f62` cleanly, with no conflict, and re-ran Task 8's suites on the merged tree. The anchors below are quoted, with their line numbers at `0b3ff2f62`. The worker's workspace is cut from `main` at dispatch, so it already holds `0b3ff2f62` or later. This wave absorbs a later `main` only on the worker skill's clause-16 triggers (Task 8 Step 1).

**Wave 19 is a PWA wave with two small server touches and one test-only server fix.** Its items are residue of waves 14 and 15. None adds a route, a wire field, a store write or an operator-facing sentence. The two sentences it shows are shipped ones, reused verbatim: `updateAllHaltedText` and Settings' stale sentence.

One line per task:
- **Task 1.** B5. In `update-inventory.test.ts`, the case "the shared per-node deadline expiring" answers every file but the hung floor from memory, so the 50 ms deadline can expire only the floor (D-5115). Test only.
- **Task 2.** R24(d), the store's half, and R26(b). `store.ts`'s `rowHalts` calls `isHaltingUpdate`, and `resolve.ts`'s `autoGateBlockers` calls `carriesUpdateGate`. The SQL form stays. Two pins widen and three source pins join `update-move.test.ts` (D-5116).
- **Task 3.** R27(a), R27(b)'s test half and R26(a)'s halt-banner half.
  - The `Number.isInteger(issued)` sub-term goes (D-5117).
  - The "ruling G" cite becomes round 2's FIX item 1.
  - A focused Ack that disables hands focus to its own row, through a new `keepFocusInRow` in `fleet/updateAck.ts`.
  - When the poll after a clean ack drops that row while the banner stays, focus goes to the banner's list (D-5118).
- **Task 4.** R24(a) and R26(a)'s Settings half.
  - While a node halts, Settings' release-row **Install** and every node's **Update** are disabled, and each is described by `updateAllHaltedText`'s line.
  - The line shows only above a list where it gates a control.
  - **Roll back stays offered**, and a pin holds it so.
  - The node row's Ack keeps focus in its row.
  - The cases are in a new `pwa/test/update-halt-controls.test.tsx`, which renders the exported `ReleaseList` and `NodeList`, so `settings-screen.test.tsx` is not edited.
- **Task 5.** R24(b) and R26(d).
  - After a later poll fails, the skew banner, the halt banner, the release banner and BuildLine each show it once, in Settings' words (D-5119).
  - The sentence is announced to assistive technology once, from one live region (D-5124).
  - While a failure stands, the skew arm never advises auto (D-5120).
  - BuildLine takes the sentence as a prop (D-5121).
  - The autoArm comment says why an extra untagged node forces `cli`.
- **Task 6 (Settings; claim 1392 at drafting; last, separable).** R24(d)'s Settings line: `autoGateMissing` calls `carriesUpdateGate`. In the same fold Settings' `STALE_TEXT` gives way to the shared constant (D-5122).
- **Task 7 (`shared/api.ts`; claim 1390 at drafting; last, separable).** R26(c): the `PROVENANCE_DETAIL_PREFIX` docstring in `shared/api.ts`, rewritten in place, line-count neutral (D-5123).
- **Task 8.** The gate and the PR.

**Live effect.**
- The server bundle ships the PWA, so the PWA changes reach the server box with the first release after the merge, by auto.
- The two server changes are delegations that give the same answers. These suites were measured green on the prototype: `update-store-nodes` (43), `update-resolve` (48), `update-routes` (41), `update-dispatch` (92), `update-auto-dispatch` (15) and `update-apply-routes` (53).
- The fleet box gets no change it acts on, so fleet-first ordering does not matter.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:**
- Settings never offers a move that the dispatcher will refuse because the fleet is halted. It says why, in the sentence the home screen's Update all already uses, and only where that sentence explains a control on screen.
- Every update surface that shows a kept view after a failed poll says that it is the last answer that landed. Assistive technology hears this once. The skew advice never promises auto on such a view.
- The store's JS halt and the resolver's gate read ask the same L0 predicates that the dispatcher and the PWA ask.
- A focused Ack that disables leaves focus in its row. When the halt banner's next poll drops that row and the banner stays, focus goes to the banner's list. In neither case does it fall to `<body>`.
- The stable gate stops losing `update-inventory.test.ts` to load.

**Architecture:**
- **L0, `shared/update-move.ts`:** no code change. Its header's "NOT HERE" sentence is rewritten in place, because `rowHalts` now calls it.
- **L1, `server/src/update/resolve.ts`:** one import (`../../../shared/update-move.js`) and one clause. The ring test's import set gains the specifier.
- **Store, `server/src/coord/store.ts`:** one import and `rowHalts`' body. `haltingRowSql` and `haltedOf` are untouched.
- **PWA, pure:**
  - `fleet/updateAck.ts` gains `keepFocusInRow`;
  - `fleet/updateHalt.ts`'s `skewRemedy` gains a defaulted `stale` parameter;
  - `fleet/useUpdatesView.ts` gains `UPDATES_STALE_TEXT`.
- **PWA, delivery:** `screens/updates.tsx` (Install, Update, the reason line, the node row's focus), `fleet/HaltBanner.tsx`, `fleet/UpdateBanner.tsx`, `fleet/FleetHostBanner.tsx`, `screens/FleetScreen.tsx` (which also holds the stale sentence's one live region).
- **ui, `ui/src/components/build-line.tsx`:** an optional `staleNote` prop, rendered with the existing `.build-line-next` class and hidden from assistive technology. No stylesheet changes.
- **One poll.** `FleetScreen`'s `useUpdatesView()` stays the screen's only `/api/updates` reader. It now hands down `stale = view !== null && failure !== null` beside the view.
- **No server route, wire field or store write changes.**

**Tech Stack:** TypeScript on node, at the floor `main` sets. React 19, vitest and Testing Library in `pwa/`; vitest in `server/`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md` (§10 the halt, §13 the PWA). No section changes. The inputs are:
- R24, R26 and R27 in the programme ledger (`docs/superpowers/programs/centralised-update-management.md`, "## Post-rollout residue");
- the ledger's 2026-10-15 22:11 entry;
- wave 14's plan and its Readings 11, 12, 15 and 16.

**Producers:**
- `main` at `518789ad0` (#426).
- The ledger's residue items and its 22:11 entry.
- This plan's scout, read-only at `518789ad0`.
- This plan's prototype, at `518789ad0` (load 27 to 211).
- Three attack passes and a reviser, at `518789ad0` and `0b3ff2f62`, on 2026-10-16.

**D-refs this plan cites as they stand:**
- D-3378: a `failed` row with a `provenance:` detail is a verdict on the release, and does not halt.
- D-3412: the store's notion of the halt, in SQL.
- D-4266: the halt rule and the capability predicates live in `shared/update-move.ts`.
- D-4267: the Ack's gate and tap live in `fleet/updateAck.ts`; a fleet component never imports a screen.
- D-4268: the `halted` sentence names both places where the Ack is.
- D-4271: the skew arm's `auto` needs every node to end on one release tag.
- D-4273: the halt banner's hold, and the lease fallback when a parent issues no read.

## Not in this wave

Reviewers: do not raise these.

- **R24(c)**: the halt banner listing requests that a racing `{all: true}` wrote while the halt stood. The 22:11 entry closed it as a documented limitation.
- **R24(e)**, **R27(b)'s plan half** and **R27(c)**: they belong to the coordinator's docs PR.
- **Roll back while a node halts**: the release row's Roll back direction and each node's Roll back. The items name Install and Update only, and Task 4 pins Roll back as still offered (T4-8, T4-9). The single-node route still refuses it with the `halted` sentence (D-4268), and `{all: true}` still answers 202 with its skips (Reading 2).
- **Staleness as a gate.** A stale view disables nothing: not Ack, not Update all, not Install (Reading 6).
- **The SQL form of the halt** (`haltingRowSql`). SQL cannot call the L0 rule (Reading 12 of wave 14).
- **Focus when the whole halt banner unmounts.** The last halting row's Ack lands, and the poll after a clean 200 drops that row and with it the banner, so focus falls to `<body>`. Task 3 covers a focused Ack disabling, and also its row leaving while the banner stays (Reading 11).
- **Focus when a poll disables a focused Install or Update.** A keyboard user resting on Install or a node's Update loses focus to `<body>` when a background poll (60 s, or a visibilitychange) brings a halt. `keepFocusInRow` runs only inside a tap handler, so it does not cover this case. It is the R26(a) class, raised by this wave's new gate, and it is offered as a residue item (Reading 16).
- **`update-store-nodes.test.ts`'s heir-guard case and its 20 s default timeout.** It timed out at load 30 on the shipped `store.ts` as well as on the delegated one (Risk notes). It is not B5, and not this wave's.
- **Everything under a live claim**, except Tasks 6 and 7 once their claims have ended.

## Global Constraints

- **Scratch.** `SCRATCH` is the session's scratchpad directory, set once per shell. Then run `mkdir -p "$SCRATCH/tmp"`. All scratch output and `TMPDIR` go under it.
- **Anchors.**
  - Every anchor is measured at `518789ad0` and quoted, with its line at `0b3ff2f62` where `main` moved it.
  - Step 1 of each task re-measures its anchors by QUOTED TEXT (`grep -nF`) on the tip being built, after one `git fetch origin`. The quote wins over any line number.
  - **Absorb `origin/main` only on the worker skill's clause-16 triggers** (Task 8 Step 1), never because `main` moved. Read `origin/HEAD` throughout, and keep no local `main`.
  - Find code with graphify first (`graphify query "…"` over `graphify-out/`), weighed by the SessionStart card's freshness, then confirm with `grep -nF`.
- **Claims (clause 11).** Claims are taken, not only read. All-or-nothing, so the wave takes three of them (Step 0 below):
  - **claim A**, before the first edit, over every File-structure path except `pwa/src/screens/SettingsScreen.tsx` and `shared/api.ts`;
  - **claim B** (`SettingsScreen.tsx`), at Task 6 Step 1;
  - **claim C** (`shared/api.ts`), at Task 7 Step 1.
  
  A 409 on claim A stops the wave: mail the holder through the response's `mailHint` and report. A 409 on claim B or C cuts that task, nothing more. Re-take a claim with the same paths at each task's Step 1, which renews its lease. Take a fresh one if the wave nears the claim's hard cap. Release none of them before the wave-done.
- **Scope.**
  - Change the files in File structure, and nothing else.
  - **Never write** `docs/superpowers/specs/*`, the programme ledger, `README.md`, `CLAUDE.md`, `pwa/test/settings-screen.test.tsx`, `pwa/test/markup-census.test.ts`, `server/test/single-definition.test.ts` or `server/test/box-token-census.test.ts`.
  - Write `pwa/src/screens/SettingsScreen.tsx` only in Task 6, and `shared/api.ts` only in Task 7, each only under its own claim.
  - Re-read the live claims before the first edit, before Task 6, before Task 7 and before the push.
  - **The scope check is derived from the live claims at run time, and it prints NOTHING.** The client prints its `http 200` status on stderr, so drop stderr. A live claim held by this wave's own claims A, B or C is excluded by its id. Any other line it prints is a collision with another session's live claim, including `SettingsScreen.tsx` or `shared/api.ts`. On such a line, stop and report, and never push. *(revised, unmeasured: the own-claim exclusion)*

        ~/.local/bin/ccrc-api claims list --project ccrc-pwa 2>/dev/null \
          | jq -r --argjson mine "[$CLAIM_A${CLAIM_B:+,$CLAIM_B}${CLAIM_C:+,$CLAIM_C}]" \
              '.claims[] | select(.state == "live") | select(.id as $i | $mine | index($i) | not) | .paths[]' > "$SCRATCH/claimed"
        xargs -a "$SCRATCH/claimed" -r git diff --name-only origin/HEAD...HEAD --
        git diff --name-only origin/HEAD...HEAD -- docs/superpowers/specs docs/superpowers/programs README.md CLAUDE.md \
          pwa/test/settings-screen.test.tsx pwa/test/markup-census.test.ts server/test/single-definition.test.ts \
          server/test/box-token-census.test.ts

  - `git diff --stat origin/HEAD...HEAD` lists exactly the files in File structure, less Tasks 6 and 7's files if those tasks are cut.
- **No new operator-facing sentence.** The two sentences shown are:
  - `updateAllHaltedText` (`pwa/src/fleet/updateHalt.ts`);
  - the stale sentence `The latest read failed — this is the last answer that landed.` (Settings' `STALE_TEXT` at `518789ad0`).
  
  Each new rendering is pinned by exact text.
- **The design system.**
  - No stylesheet changes.
  - The Settings reason line reuses `.settings-release-refused`, the halt banner's stale line `.halt-banner-msg`, the release banner's `.update-banner-msg`, BuildLine's `.build-line-next`, and the one announcement `.sr-only` (base.css; `BucketBar.tsx` holds the same `div.sr-only[role=status]`).
  - `node design/contrast-check.mjs` must still print ALL PASS (`ALL 3504 PASS` at `0b3ff2f62`).
- **Safety.**
  - Tests use fixture data only. No case reaches a real server, a real HOME or a real `gh`.
  - Never run `ccd`, `ccrc update`, `rollback`, `rollout`, `install` or `deploy.sh`.
  - Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or the `claude-session@*` units. Never read a token file.
- **Mutation-table discipline.**
  - Before each mutation, run `cp <file> "$SCRATCH/<id>.orig"`. Never use `git checkout --`, and never a bare `git stash`.
  - Apply the mutation and run the named commands. Restore with `cp`, check with `cmp`, then confirm that `git status --porcelain` shows only this wave's files.
  - A row is done only with a measured red count and the assertion that fired. Each row lists its full expected red set. Report any difference, and never accept it silently. A row marked *(revised, unmeasured)* has an expected set that nobody has measured yet: measure it, and report the measured set beside the expected one.
  - A filter pattern in a table cell that would need a `|` is written as a fenced command under the table, never inside the cell. Markdown's `\|` reaches vitest as a literal pipe and skips every test.
- **D-numbers.**
  - This plan defines D-5115 to D-5124, from the block issued to run 483 (5115 to 5134), in `## Deviations found`.
  - **The worker's reserve is 5125 to 5129.** Take reserve numbers in order. Define each one in this plan's `## Deviations found`, in the commit that first cites it.
  - **Past 5129, write nothing tracked.** Name the deviation `D-TBD-<slug>` in the wave-done mail only, and ask the coordinator, who holds 5130 to 5134, for a number.
  - Never write a number outside the block. Never call the allocator. Never land a `D-TBD-` spelling in tracked text.
  - The commit that first writes D-5115 to D-5124 anywhere tracked must contain this plan, or come after the commit that does.
- **Suites.**
  - Run each file in the foreground, one command per call, inside its package, with a timeout of at least 600000 ms: `./node_modules/.bin/vitest run test/<file>.test.ts[x] [-t '<pattern>']`. Never use a bare `npx vitest`.
  - Run `npm ci` in `server/`, `pwa/`, `ui/` and `agent/` wherever `node_modules` is absent:
    - `pwa/` loads `@ccrc/ui` from source, so the pwa suites need `ui/`'s modules too. Measured: without them, every pwa file fails to resolve `class-variance-authority`.
    - `typecheck-tests` needs `agent/`'s modules (`Cannot find module 'ws'` without them).
  - `TMPDIR` goes under `$SCRATCH/tmp`.
  - `-t` is a regex over the full test name. A filtered run that reports zero tests fails the gate.
- **No residue in tracked text:** no hostname, username, absolute home path, mount path, docserver URL or org name. Run `topology-clean.test.ts` after `git add` of each new or changed file.
- **Commits.**
  - Commit on the workspace branch only, at least once per task, with a prefix `fix(update): …`, `refactor(update): …`, `test(update): …` or `feat(update): …`. Never commit on a separate feature branch.
  - The author and committer are the noreply identity.
  - Send the wave-done in the same turn as the push. Never end a turn to wait on CI.

### Step 0 (before Task 1): take claim A *(revised, unmeasured)*

```bash
W=$(~/.local/bin/ccrc-api whoami)
printf '%s\n' \
  docs/superpowers/plans/2026-10-15-centralised-update-w19-pwa-server-residue.md \
  pwa/test/update-halt-controls.test.tsx server/test/update-inventory.test.ts server/src/coord/store.ts \
  server/src/update/resolve.ts shared/update-move.ts server/test/update-move.test.ts server/test/update-resolve.test.ts \
  pwa/src/fleet/updateAck.ts pwa/src/fleet/HaltBanner.tsx pwa/test/halt-banner.test.tsx pwa/src/screens/updates.tsx \
  pwa/src/fleet/useUpdatesView.ts pwa/src/fleet/updateHalt.ts pwa/src/fleet/FleetHostBanner.tsx pwa/src/fleet/UpdateBanner.tsx \
  ui/src/components/build-line.tsx pwa/src/screens/FleetScreen.tsx pwa/test/update-halt.test.ts \
  pwa/test/fleet-host-banner.test.tsx pwa/test/update-banner.test.tsx pwa/test/build-line.test.tsx \
  pwa/test/fleet-screen.test.tsx pwa/test/literal-census.test.ts > "$SCRATCH/claim-a.paths"
jq -n --argjson w "$W" --rawfile p "$SCRATCH/claim-a.paths" \
  '{byId: $w.id, byUuid: $w.uuid, project: "ccrc-pwa", runId: 483,
    paths: ($p | split("\n") | map(select(. != ""))),
    intent: "wave 19: update-plane residue (R24, R26, R27, B5)"}' \
  | ~/.local/bin/ccrc-api claims take --json - | tee "$SCRATCH/claim-a.json"
CLAIM_A=$(jq -r '.claim.id // .id' "$SCRATCH/claim-a.json")   # read the field the 200 actually carries
```

Claims B and C use the same shape, with one path each and their own intent (Tasks 6 and 7, Step 1). Record each id as `CLAIM_B` or `CLAIM_C`.

## Review Focus

1. **Settings' gate is the dispatcher's.**
   - Who halts is `haltingNodes`, the L0 rule. While it names anyone, Install (release row, install direction) and every node's Update are disabled. Each is described by the one reason line above its list (`toHaveAccessibleDescription`).
   - The line shows only above a list where it gates a control: some release row in the install direction, or some node with a pending tag.
   - A disabled Install never calls `onMove`. A `failed` row with a `provenance:` detail does not gate (D-3378).
   - Roll back is not gated, and is pinned so.
   - The single-node route measures the same thing. `singleNodeMove` passes the real `fleetGate` to `moveRefusal` (`server/src/update/routes.ts`), whose first clause answers `halted` while any node halts (`if (gate.haltedBy.length > 0) return 'halted';` in `dispatch.ts`). So a per-node Update during another node's halt was always a 409, and now it is not offered.
2. **The stale mark says only what is true, and says it once to assistive technology.**
   - `stale = view !== null && failure !== null` is computed once in `FleetScreen` from its one poll. The standalone release banner computes the same from its own poll.
   - A screen that never had an answer says nothing of the kind (T5-7's row).
   - On a stale view the skew arm never says that the console or auto will move the box: `skewRemedy(…, true)` answers `cli`, or `halt` with `then: 'cli'`.
   - The four visible copies are `aria-hidden`, and `FleetScreen`'s one `.sr-only` status region carries the sentence (D-5124).
   - Staleness is said, never a gate (Reading 6).
3. **One spelling each.**
   - `rowHalts` is `isHaltingUpdate(state, detail)`, pinned in source, and the provenance census no longer lists `store.ts`.
   - `autoGateBlockers` asks `carriesUpdateGate`, pinned in source. A new census pins `includes(UPDATE_GATE_CAP)` on a code line to `shared/update-move.ts`, plus `SettingsScreen.tsx` until Task 6.
   - The stale sentence is `UPDATES_STALE_TEXT`. Literal-census keeps it registered, and two exact-text pins hold the interim copy equal until Task 6: this wave's, and the Settings suite's `T7_STALE`.
4. **Focus.**
   - `keepFocusInRow` moves focus to the row only when focus is inside that row. A CONTROL case pins that focus elsewhere is left alone, on both Ack surfaces.
   - On the halt banner, a row that leaves while holding focus hands it to the banner's list. It does so from a layout-effect cleanup, which runs before React removes the `<li>`.
5. **B5 is deterministic by construction.** The six other files settle in the microtask queue, which drains before any timer callback runs, so no load can expire them before the floor's 50 ms deadline. The floor still waits one real deadline, so the case still proves the DEADLINE path.

## Risk notes

- **Claims move.** Claims 1392 and 1390 renew themselves.
  - Tasks 6 and 7 each take their own claim. If a live claim stands on the file, cut that task and its rows to a later fold, keep its D-entry with a **Cut:** line (the task's Step 1), and say so in the wave-done.
  - Task 2's gate census then keeps `SettingsScreen.tsx` as a listed holder, which is correct for that tree.
- **Run 360's unlanded branch and `store.ts`.**
  - At drafting, run 360's branch was run 360's branch: local only, with no remote ref. Read its branch with `~/.local/bin/ccrc-api runs list 2>/dev/null | jq -r '.runs[] | select(.id == 360) | .branch'`.
  - Measured on 2026-10-16, its `store.ts` hunks were `@@ -29,6 +29,13 @@` (an import, about 10 lines above the `newestTag` import) and `@@ -8175,4 +8182,214 @@`. Neither overlaps `rowHalts` or the `newestTag` import line.
  - Task 2 Step 1 holds the task only on a hunk that overlaps, or falls within 3 lines of, Task 2's two edit sites, or on a `git merge-tree` of the two tips that lists `store.ts` as conflicted.
  - Anything else sets the landing order only, under Reading 7 as re-ruled on 2026-10-15.
- **Load-sensitive cases.**
  - `update-store-nodes.test.ts`'s "the heir guard IS `isHalting`" builds 27 SQLite stores, under vitest's 20 s default timeout. At load 30 it timed out in isolation at 23.1 s on the delegated `store.ts`, and at 38.5 s on the shipped body (mutation T2-1 applied). So the timeout is load, not the delegation. Re-run it in isolation before calling it red; CI on a quiet box is the arbiter.
  - `typecheck-tests` is on CLAUDE.md's list of load flakes.
- **Line citations.**
  - `FleetScreen.tsx` gains about four lines after its `useUpdatesView()` call and before `BuildLine`, so later lines move.
  - Two source comments cite `FleetScreen.tsx` by line: `pwa/src/screens/RunsScreen.tsx:344` (`FleetScreen.tsx:288-294`) and `pwa/src/fleet/useProjectedHome.ts:19` (`FleetScreen.tsx:145`). Both were already stale on `main` before this wave, and nothing pins them. They are not this wave's to fix, and this wave does not make them worse in kind.
  - Nothing else in the four roots cites `updates.tsx`, `updateHalt.ts`, `HaltBanner.tsx`, `store.ts` (at these lines), `resolve.ts`, `update-move.ts` or `update-inventory.test.ts` by line. Measured with `grep -rnE` over `shared server/src server/test pwa/src pwa/test agent/src ui/src ccd`.
  - Task 7's docstring is line-count neutral, because `shared/api.ts` is cited by line elsewhere.
- **CI selection.**
  - `pwa/src` and `ui/src` edits select the server tests that walk `pwa/src`, `single-definition` and `update-move` among them.
  - `store.ts` and `resolve.ts` select a large share of the server suite.
  - Task 7's `shared/api.ts` edit selects nearly all of it.
  - Task 8 Step 5 reads the `select tests` summary.
- **Markup census and the new attributes.** Each new element carries at most one attribute besides `className`, under the census's leaf floor of two: `aria-hidden` on the stale spans, `role` on the `.sr-only` div. Measure `markup-census` anyway. If it reds, change the markup's shape, never the census file (Never write).

## Deviations found

These are departures from the residue text (R24, R26, R27 and B5 as the ledger words them), from a prior ruling, or from what shipped text at `518789ad0` documents.

- **D-5115** — *B5 is fixed by answering the six other node files from memory in the test, not by a fake clock or a larger budget.*
  - **Ruled:** the 22:11 entry: "Make the deadline deterministic (a fake clock, or a budget that cannot expire before the row is written)".
  - **Shipped:**
    - The case hung only the floor's read, over real fs, with `budgetMs: 50`. All seven files raced one shared real `setTimeout` deadline.
    - Under load the timer fired before the other files' fs completions were processed. So `node-id` read as unreadable too, the row was keyed by label, and `store.node(U1)` answered null.
    - Measured in the prototype at load 63 to 211: 28 of 150 runs red, and every red was that arm.
  - **Now:**
    - `lstatMeasured`, `statMeasured` and `readFileMeasured` answer the planted files from a map read before the sweep, and hang the floor's read.
    - Each answer settles in the microtask queue, which drains before any timer callback runs, so the deadline can expire only the floor.
    - Measured at the same load: 0 of 150 red.
    - `budgetMs: 50` and the assertion are unchanged.
  - **Why not the two named shapes:**
    - A fake clock needs a barrier that waits for the other reads before advancing: more code, and the same ordering argument.
    - A budget large enough "not to expire" under any load is not a bound, and it adds wall time to every run.
    - No production seam changes (Reading 13).
- **D-5116** — *Two pins widen and three source pins are added, for R24(d)'s store half and R26(b).*
  - **Shipped:**
    - `update-move.test.ts` pinned the code-line holders of `startsWith(PROVENANCE_DETAIL_PREFIX)` to `store.ts`, `inventory.ts` and `update-move.ts`.
    - `update-resolve.test.ts` pinned `resolve.ts`'s import set to `shared/api` and `shared/semver`.
    - `resolve.ts`'s header said "two shared/ modules".
  - **Now:**
    - The provenance census lists `inventory.ts` and `update-move.ts` only.
    - The ring set gains `../../../shared/update-move.js`, which is L0: it imports only `./api.js` and `./agent-protocol.js`. The header says "three".
    - A new describe in `update-move.test.ts` pins `rowHalts`' body and import, `autoGateBlockers`' clause and import, and the code-line holders of `includes(UPDATE_GATE_CAP)`: `shared/update-move.ts`, plus `pwa/src/screens/SettingsScreen.tsx` until Task 6 folds it.
  - **Why:** the residue says "can call", and a call with no pin is a comment. Each pin is a row that reds when the call is reverted (T2-1, T2-3).
- **D-5117** — *R27(a): the `Number.isInteger(issued)` sub-term is removed, not pinned.*
  - **Ruled:** "Remove the sub-term, or pin it."
  - **Now:** `after: issued > 0 ? issued : null`.
    - `issued` is `onAcked()`'s number, and `reload()` answers `++issuedRef.current` or 0, so no reachable input separates the two forms.
    - The fallback itself stays pinned by the four `0` / `undefined` cells, which red when `> 0` is dropped too (T3-3).
- **D-5118** — *R26(a): focus goes to the Ack's own row, through one helper both Ack surfaces call. On the halt banner, a row that leaves while holding focus hands it to the banner's list. One of wave 14's source pins changes with it.*
  - **Shipped:** both Acks (`HaltRow`, `NodeItem`) disable on the tap. A focused control that becomes disabled loses focus to `<body>`. On the halt banner, a clean ack returns the row to idle, so the next poll's `haltingNodes` drops its `<li>`, and focus falls to `<body>` even while other rows still halt and the banner stays.
  - **Now:**
    - `keepFocusInRow(row)` in `fleet/updateAck.ts` focuses the row when focus is inside it, and does nothing otherwise.
    - Each row is `tabIndex={-1}` with a ref, and each `ack()` calls the helper before `setAcking(true)`.
    - On the halt banner, the `<ul aria-label="Halted nodes">` is `tabIndex={-1}` with a ref. Each `HaltRow`'s `useLayoutEffect` cleanup moves focus to that list when the row holds focus as it leaves. The cleanup runs before React removes the `<li>`, so `row.contains(document.activeElement)` can still be tested. *(revised, unmeasured)*
    - No stylesheet rule.
    - `halt-banner.test.tsx`'s D-4267 pin on `HaltBanner.tsx`'s import line now reads `import { canAck, keepFocusInRow, sendAck } from './updateAck';`.
    - When the whole banner unmounts, focus still falls to `<body>` (Not in this wave; Reading 11).
  - **Why the row:** it names the node, its state, its target and its detail, which is the context a screen-reader user needs once the button goes.
  - **Why the list after the row leaves:** it is the nearest stable element that still names what the user was acting on ("Halted nodes").
  - **Alternatives:**
    - `aria-disabled` needs `aria-disabled:` variants in ui's `Button`, a ui change with a wider reach.
    - A ref on `Button` is not in its props type (Reading 10).
- **D-5119** — *R24(b)'s sentence is Settings' stale sentence, verbatim, on a line of its own, in a new fleet constant.*
  - **Ruled:** the residue says "as of the last read". Wave 14's Reading 15(b) said "qualify the halt lead". The 22:11 entry's item list says "reuse Settings' existing STALE_TEXT verbatim, so there are no new operator strings".
  - **Shipped:** `STALE_TEXT` is module-private in `SettingsScreen.tsx` (claim 1392), and a fleet component must not import a screen (D-4267).
  - **Now:**
    - `UPDATES_STALE_TEXT` lives in `pwa/src/fleet/useUpdatesView.ts`, beside `UpdatesFailure`, with the identical words.
    - Each surface says it as a line or sentence of its own, and no lead is reworded.
    - Until Task 6, the words are in three files: `useUpdatesView.ts`, `SettingsScreen.tsx`, and `shared/api.ts`'s `STALL_SECTION_TEXT.stale`. Literal-census keeps the sentence registered. Its reason is rewritten to name the update plane's constant and the pending Settings fold, and Task 6 rewrites it again.
    - `halt-banner.test.tsx` pins the constant's exact text, and the Settings suite's `T7_STALE` pins Settings' copy, so the interim copies cannot drift apart unnoticed.
- **D-5120** — *While a failure stands, the skew arm keeps its halt arm and withdraws only the promise of auto.*
  - **Ruled:** "While a failure stands, the skew arm answers `cli`" (R24(b)).
  - **Now:** `skewRemedy(nodes, intent, stale = false)`, where `then` is `cli` when `stale`.
    - A halt still reads as the halt, followed by "then run ccrc rollout …".
    - With no halt, the arm reads as the terminal verbs: `{kind: 'cli'}` is returned whenever there is no halt.
  - **Why:** the Ack is still the only door while a halt stands, whatever the poll did. Dropping the halt sentence would hide the remedy exactly while the screen cannot re-check (Reading 8).
- **D-5121** — *BuildLine (a `@ccrc/ui` component) gains an optional `staleNote` prop, and shows it with the existing `.build-line-next` class.*
  - **Shipped:** `BuildLine({ health, nodes })`, and the ui package imports no app copy (`ui-package-boundary.test.ts`).
  - **Now:**
    - `BuildLine({ health, nodes, staleNote = null })` renders ` · <staleNote>` after the server side when `staleNote !== null`. The prototype's `staleNote !== ''` sub-term is dropped as unreachable, the R27(a) shape (T5-9). *(revised, unmeasured)*
    - The note's span is `aria-hidden="true"`: the caller owns the announcement (D-5124).
    - `FleetScreen` passes `UPDATES_STALE_TEXT` while stale.
    - The class is the affix's: amber on the same ground, already registered in `design/audit.mjs` and `contrast.test.ts`, so no stylesheet or audit entry changes (Reading 7).
- **D-5122** — *Task 6 (R24(d)'s Settings line) also folds Settings' `STALE_TEXT` onto `UPDATES_STALE_TEXT`, and pins both from the wave's new test file by reading the screen's source.*
  - **Ruled:** R24(d) names only `caps.includes(UPDATE_GATE_CAP)`.
  - **Now:**
    - The same fold drops `STALE_TEXT` and imports the fleet constant. The words are the same, so `T7_STALE` stays green.
    - It drops `UPDATE_GATE_CAP` from the screen's import, and keeps `autoGateMissing`'s `Array.isArray` guard.
    - `update-halt-controls.test.tsx` reads `SettingsScreen.tsx` and pins four things: `carriesUpdateGate(n.caps)` present, `caps.includes(UPDATE_GATE_CAP)` absent, the stale line's `{UPDATES_STALE_TEXT}` present, and the quoted sentence absent. It reads source because `settings-screen.test.tsx` is not this wave's to edit.
    - The gate census drops `SettingsScreen.tsx`, and the literal-census reason returns to "two sections, two copies".
    - Settings' own stale line keeps its own exposure. It is a separate screen, so it is not part of D-5124's single announcement.
  - **Why together:** both are one-line folds of a Settings copy onto a shared read, and both wait on the same claim. Doing them apart would edit the same import block twice.
- **D-5123** — *R26(c)'s docstring is in `shared/api.ts`, not `pwa/src/lib/api.ts`, and it is rewritten in place, line-count neutral.*
  - **Ruled:** R26(c) names "the `PROVENANCE_DETAIL_PREFIX` docstring in `pwa/src/lib/api.ts`". That file has no such docstring at `518789ad0`. The declaration is in `shared/api.ts` (line 9337 at `518789ad0`, 9350 at `0b3ff2f62`).
  - **Now:** the docstring names three readers:
    - `isHaltingUpdate` (shared/update-move.ts) as the JS reader, asked by `isHalting`, `rowHalts` and the PWA's `haltingNodes`;
    - the store's `haltingRowSql` in SQL (D-3412);
    - `sweepPlanFor` (update/inventory.ts).
    
    Three lines replace three, so neither the declaration's line nor the file's line count moves. If Task 2 is not on the branch, drop `rowHalts` from the sentence.
- **D-5124** — *R24(b)'s sentence is shown on up to four surfaces but announced once: the four visible copies are `aria-hidden`, and one `.sr-only` status region in `FleetScreen` carries it.*
  - **Ruled:** the residue says "mark it on all of them at once". It says nothing of assistive technology.
  - **Shipped:** all four surfaces are polite live regions. The skew banner is `Banner`'s default `role="status"` (`ui/src/primitives/banner.tsx`), and `.halt-banner`, `.update-banner` and `.build-line` are each `role="status"`. One failed poll would add the same sentence to four live regions in one commit, so a screen reader would hear it up to four times, again on every 60 s poll and visibilitychange on a flapping link.
  - **Now:** *(revised, unmeasured)*
    - Each surface's stale copy is `aria-hidden="true"`. The halt banner's and release banner's spans carry the attribute themselves. The skew arm wraps its appended sentence in a `<span aria-hidden="true">`. BuildLine's note span carries it (D-5121).
    - `FleetScreen` renders `<div className="sr-only" role="status">{stale ? UPDATES_STALE_TEXT : null}</div>` always, so the region exists before its text changes. This is `BucketBar.tsx`'s shape.
    - BuildLine is absent in local mode, so the announcement cannot live there.
    - The standalone, self-polled `UpdateBanner` has no production mount (`FleetScreen` injects its view). Its copy is shown, not announced.
    - The fleet-screen case pins that exactly one stale copy is exposed to assistive technology (T5-10, T5-11).
  - **Why:** the operator should not hear one fact four times. The visible marks stay, as the residue asks (Reading 5).

The worker's reserve: numbers 5125 to 5129, written bare until defined. The coordinator holds 5130 to 5134.

## File structure

**New**
- `docs/superpowers/plans/2026-10-15-centralised-update-w19-pwa-server-residue.md` (this plan).
- `pwa/test/update-halt-controls.test.tsx` (Task 4; Task 6 appends one describe).

**Changed**
- `server/test/update-inventory.test.ts` (Task 1): one case's io, and its import line.
- `server/src/coord/store.ts` (Task 2): one import, and `rowHalts`' docstring and body.
- `server/src/update/resolve.ts` (Task 2): the header's "two" becomes "three"; one import; one clause.
- `shared/update-move.ts` (Task 2): the header's "NOT HERE" sentence, rewritten in place.
- `server/test/update-move.test.ts` (Tasks 2 and 6): the provenance census edited in place and one describe appended (Task 2); one case's holder list edited (Task 6).
- `server/test/update-resolve.test.ts` (Task 2): the ring case's title, a comment, and its import set.
- `pwa/src/fleet/updateAck.ts` (Task 3): `keepFocusInRow` appended.
- `pwa/src/fleet/HaltBanner.tsx` (Tasks 3 and 5): the focus hand-off; the lease fallback's sub-term; the row's ref and `tabIndex`; the list's ref and `tabIndex`; the row's leave hand-off; the `stale` prop and its line.
- `pwa/test/halt-banner.test.tsx` (Tasks 3 and 5): the "ruling G" comment and describe title; the D-4267 import pin; two describes appended (focus, stale); one import name.
- `pwa/src/screens/updates.tsx` (Task 4): imports, `MoveButton`'s `describedBy`, `haltedReason`, `HaltedLine`, `ReleaseItem`, `ReleaseList`, `NodeItem` (focus, Update gate), `NodeList`, and one header sentence.
- `pwa/src/fleet/useUpdatesView.ts` (Task 5): `UPDATES_STALE_TEXT`.
- `pwa/src/fleet/updateHalt.ts` (Task 5): the header's callers, `skewRemedy`'s `stale`, and the autoArm comment (R26(d)).
- `pwa/src/fleet/FleetHostBanner.tsx`, `pwa/src/fleet/UpdateBanner.tsx` (Task 5): the `stale` prop and its sentence; FleetHostBanner's header bullet.
- `ui/src/components/build-line.tsx` (Task 5): the `staleNote` prop.
- `pwa/src/screens/FleetScreen.tsx` (Task 5): one import name, `stale`, four props, and the one `.sr-only` status region.
- `pwa/test/update-halt.test.ts`, `pwa/test/fleet-host-banner.test.tsx`, `pwa/test/update-banner.test.tsx`, `pwa/test/build-line.test.tsx`, `pwa/test/fleet-screen.test.tsx` (Task 5): cases appended or inserted, plus one import each where named.
- `pwa/test/literal-census.test.ts` (Tasks 5 and 6): the registered entry's comment and reason.
- `pwa/src/screens/SettingsScreen.tsx` (Task 6, claim-gated): the imports, `STALE_TEXT` removed, `autoGateMissing`'s clause, the stale line.
- `shared/api.ts` (Task 7, claim-gated): three docstring lines, in place.

**Run, not edited:**
- pwa: `settings-screen`, `markup-census` (both held by claim 1392 at drafting), `control-census`, `shape-census`, `use-updates-view`, `update-move-sheet`, `contrast`, `ui-package-boundary`, `design-system-boundary`, and the whole pwa suite.
- server: `single-definition` (claim 1436), `box-token-census` (claim 1419), `inventory-identity`, `update-store-nodes`, `update-routes`, `update-dispatch`, `update-auto-dispatch`, `update-apply-routes`, `mail-hardening`, `update-killed-arms`, `update-writer-groups`, `update-intent-cross-side`, `crossrepo-prose`, `update-projection`, `update-catalogue`, `ledger-sweep`, `typecheck-tests`.
- The ledger and scope guards: `topology-clean`, `dtbd`, `deviation-refs`.

## Tasks

### Task 1: B5 — the deadline case cannot lose `node-id` to load (D-5115)

**Files:** `server/test/update-inventory.test.ts`.

- [ ] **Step 1: Re-read the claims, renew claim A, then re-measure.**
  ```bash
  ~/.local/bin/ccrc-api claims list --project ccrc-pwa 2>/dev/null | jq -r '.claims[] | select(.state == "live") | "\(.id) \(.paths | join(" "))"'
  git fetch origin
  cd server
  grep -nF "it('the shared per-node deadline expiring reads the floor as unmeasured too (m-3), never absent'" test/update-inventory.test.ts   # 412
  grep -nF "const deps: InventoryDeps = { store: b.store, localIo: hungFloor, ccrcDir: b.ccrcDir, role: 'both', fleet: null, budgetMs: 50 };" test/update-inventory.test.ts   # 423
  grep -nF "import { localIO, type FleetIO, type MeasuredRead } from '../src/io.js';" test/update-inventory.test.ts   # 19
  grep -nF "  const within = <T>(op: Promise<T>): Promise<T | null> => (deadline === null ? op.catch(() => null) : deadline.race(op));" src/update/inventory.ts
  grep -nF "export type MeasuredPathKind =" src/io.ts; grep -nF "export type MeasuredStat =" src/io.ts
  ```
- [ ] **Step 2: Show the flake (red is a rate, not a single run).** A single quiet run of the shipped case passes. To see the flake, loop both shapes in a scratch file, `server/test/zz-w19-flake.test.ts`, which is deleted after the run and never committed. It has two `it`s, each with its own timeout, so neither nears the 600000 ms call cap. *(revised, unmeasured: the split, `N = 60`, and `once` as spelled)*
  ```ts
  // Scratch only: delete after the run. The fixtures (box, plant, FULL, NODE_FILES, U1, NOW, sweepInventory, localIO)
  // are update-inventory.test.ts's; copy what this needs from its head.
  const N = Number(process.env.FLAKE_N ?? 60);
  // One sweep over a fresh box; true when the row landed as the shipped case asserts.
  const once = async (mkIo: (b: ReturnType<typeof box>) => FleetIO): Promise<boolean> => {
    const b = box('ccrc-inv-w19-flake-');
    plant(b.ccrcDir, FULL);
    await sweepInventory({ store: b.store, localIo: mkIo(b), ccrcDir: b.ccrcDir, role: 'both', fleet: null, budgetMs: 50 }, NOW);
    const row = b.store.node(U1);
    return row !== null && row.highestVersion === null && row.floorRead === 'unmeasured';
  };
  const shipped = (): FleetIO => ({            // the shipped case's io: real fs, only the floor hung
    ...localIO,
    readFileMeasured: async (p: string, t?: number, s?: AbortSignal): Promise<MeasuredRead> =>
      (p.endsWith(`${path.sep}floor`) ? new Promise<MeasuredRead>(() => {}) : localIO.readFileMeasured(p, t, s)),
  });
  // inMemory(b): Step 3's `hungFloor`, built over `b` exactly as Step 3 builds it.
  it('shipped shape', async () => {
    let red = 0;
    for (let i = 0; i < N; i++) red += (await once(shipped)) ? 0 : 1;
    console.warn(`shipped red ${red}/${N}`);
  }, 590_000);
  it('in-memory shape', async () => {
    let red = 0;
    for (let i = 0; i < N; i++) red += (await once(inMemory)) ? 0 : 1;
    console.warn(`in-memory red ${red}/${N}`);
  }, 590_000);
  ```
  Run each `it` in its own call (`-t 'shipped shape'`, then `-t 'in-memory shape'`). *(prototype, load 63 to 211, 150 iterations each, about 594 s for both together: the shipped shape was red 28/150, every red the row-null arm, with node-id expired too; the in-memory shape was red 0/150. At `N = 60`, expect about one shipped red in five under comparable load, which is unmeasured.)* Loop only with processes you own, and never use `pkill`.
- [ ] **Step 3: Implement.** Change the import line to:
  ```ts
  import { localIO, type FleetIO, type MeasuredPathKind, type MeasuredRead, type MeasuredStat } from '../src/io.js';
  ```
  Then replace the case's comment and `hungFloor` with:
  ```ts
    // Only the floor's own read hangs, so this isolates the DEADLINE path (readNodeFile's own `deadline?.expired()`
    // check, not an EACCES/chmod-based unreadable) from every other file. Every OTHER file answers from memory
    // (centralised-update wave 19, B5): each of its lstat/stat/read promises settles in the microtask queue, which
    // drains before any timer callback runs, so the 50 ms deadline cannot expire them first however loaded the box
    // is. Over real fs they raced the one shared deadline, and under load node-id lost: the row was then keyed by
    // label, and `node(U1)` answered null.
    const planted = new Map<string, string>((Object.keys(FULL) as Measured[])
      .map((k) => [NODE_FILES[k], readFileSync(path.join(b.ccrcDir, NODE_FILES[k]), 'utf8')]));
    const bodyOf = (p: string): string | undefined => planted.get(path.basename(p));
    const hungFloor: FleetIO = {
      ...localIO,
      lstatMeasured: async (p: string): Promise<MeasuredPathKind> =>
        (bodyOf(p) === undefined ? { ok: false, reason: 'absent' } : { ok: true, kind: 'regular' }),
      statMeasured: async (p: string): Promise<MeasuredStat> => {
        const body = bodyOf(p);
        return body === undefined ? { ok: false, reason: 'absent' } : { ok: true, mtimeMs: 0, size: Buffer.byteLength(body, 'utf8') };
      },
      readFileMeasured: async (p: string): Promise<MeasuredRead> => {
        if (path.basename(p) === NODE_FILES.floor) return new Promise<MeasuredRead>(() => {});
        const body = bodyOf(p);
        return body === undefined ? { ok: false, reason: 'absent' } : { ok: true, content: body };
      },
    };
  ```
  The `plant(b.ccrcDir, FULL)` line, the `deps` line with `budgetMs: 50`, the sweep and the assertion stay as they are.
- [ ] **Step 4: Run** (server):
  - `./node_modules/.bin/vitest run test/update-inventory.test.ts -t "shared per-node deadline expiring"` *(prototype: `Tests  1 passed | 89 skipped (90)`)*;
  - then the whole file *(prototype: 90 passed)*.
  
  Delete `test/zz-w19-flake.test.ts` and confirm `git status --porcelain` does not list it.
- [ ] **Step 5: Mutation table** *(prototype)*. Each row runs `update-inventory -t "shared per-node deadline expiring"`.

  | Row | File | Mutation | Measured red |
  |---|---|---|---|
  | T1-1 | `src/update/inventory.ts` | `if (read === null \|\| deadline?.expired()) return ABSENT;` (was `UNREADABLE`) | 1 (`… never absent`: `-"floorRead": "unmeasured"` / `+"floorRead": "absent"`) |
  | T1-2 | `src/update/inventory.ts` | `within` never races: `op.catch(() => null);` | 1 (`Error: Test timed out in 20000ms.`) |

  (T1-1's `\|` is a source-code pipe inside the mutation text, not a filter pattern.)
- [ ] **Step 6: Commit:** `test(update): the deadline case answers the six other node files from memory, so load cannot expire them (wave 19, B5; D-5115)`. If this plan is not on the branch yet, include it in the same commit.

### Task 2: R24(d)'s store half and R26(b) — `rowHalts` and `autoGateBlockers` ask the L0 rules (D-5116)

**Files:** `server/src/coord/store.ts`, `server/src/update/resolve.ts`, `shared/update-move.ts`, `server/test/update-move.test.ts`, `server/test/update-resolve.test.ts`.

- [ ] **Step 1: Re-measure.**
  ```bash
  cd server
  grep -nF "const rowHalts = (state: UpdateState, detail: string | null): boolean =>" src/coord/store.ts   # 1070 at 0b3ff2f62 (1063 at 518789ad0)
  grep -nF "  haltedOf(state) !== null && !(state === 'failed' && detail !== null && detail.startsWith(PROVENANCE_DETAIL_PREFIX));" src/coord/store.ts   # 1071
  grep -nF "import { newestTag } from '../../../shared/semver.js';" src/coord/store.ts   # 45 (38)
  grep -nF "    if (rowHalts(row.updateState, row.updateDetail)) return { ok: false, why: 'halted', state: row.updateState };" src/coord/store.ts
  grep -nF "    .filter((n) => (scope === FLEET_SCOPE || n.nodeId === scope) && !n.caps.includes(UPDATE_GATE_CAP))" src/update/resolve.ts   # 236
  grep -nF "// below — two shared/ modules and nothing else — and update-resolve.test.ts" src/update/resolve.ts   # 6
  grep -nF "    expect(new Set(specs)).toEqual(new Set(['../../../shared/api.js', '../../../shared/semver.js']));" test/update-resolve.test.ts   # 469
  grep -nF "      'server/src/coord/store.ts', 'server/src/update/inventory.ts', 'shared/update-move.ts'," test/update-move.test.ts   # 201
  grep -nF '// NOT HERE: `server/src/coord/store.ts`'"'"'s SQL (`haltingRowSql`) and JS (`rowHalts`) forms of the halt. They are' ../shared/update-move.ts   # 14
  grep -rn "includes(UPDATE_GATE_CAP)" ../shared ../server/src ../pwa/src ../agent/src   # update-move.ts:43, resolve.ts:236, SettingsScreen.tsx:114
  ```
  Measure run 360's branch against Task 2's two edit sites: the `newestTag` import line and `rowHalts` (Risk notes). *(revised, unmeasured: this measurement's form)*
  ```bash
  B360=$(~/.local/bin/ccrc-api runs list 2>/dev/null | jq -r '.runs[] | select(.id == 360) | .branch')   # run 360's branch at drafting
  git rev-parse --verify -q "$B360" >/dev/null && git diff origin/HEAD..."$B360" -- src/coord/store.ts | grep -nE '^@@'
  git rev-parse --verify -q "$B360" >/dev/null && git merge-tree --write-tree --name-only --no-messages HEAD "$B360" | sed -n '2,$p' | grep -nxF 'server/src/coord/store.ts'
  ```
  Hold the task only if a hunk's old-side range overlaps, or comes within 3 lines of, either edit site, or if the merge-tree lists `store.ts` as conflicted. Otherwise record the hunks: they set the landing order only (Reading 7 as re-ruled). If the branch is not readable from this workspace, record that and proceed.
- [ ] **Step 2: Write the pins first (red).** In `server/test/update-move.test.ts`, rewrite the provenance census case's comment and list in place:
  ```ts
      // `startsWith(PROVENANCE_DETAIL_PREFIX)` is the halt rule's exception (shared/update-move.ts) and the inventory's
      // refusal recorder (update/inventory.ts — a different question: is this report a verdict on the release). The
      // store's own JS form (`rowHalts`, coord/store.ts) asks `isHaltingUpdate` since wave 19 (R24(d)), so it is not a
      // holder any more. It pins THIS spelling only: a copy written another way (a 'provenance:' literal, `indexOf`, a
      // bare `failed || reverted`) is not seen here.
      const PREFIX_TEST = /startsWith\(PROVENANCE_DETAIL_PREFIX\)/;
      expect(ALL.filter((f) => PREFIX_TEST.test(codeOnly(f))).map(rel).sort()).toEqual([
        'server/src/update/inventory.ts', 'shared/update-move.ts',
      ]);
  ```
  Then append after the file's last describe:
  ```ts

  // Centralised-update wave 19 (R24(d), R26(b)): the store's JS halt and the resolver's gate read ask the L0 rules
  // rather than restating them. Behaviour is unchanged and stays pinned where it was (`update-store-nodes.test.ts`'s
  // heir-guard spread and handOffLease cases; `update-resolve.test.ts`'s autoGateBlockers cases); these pin the CALL,
  // so a revert to an inline copy reds here.
  describe('centralised-update wave 19: the store and the resolver ask the L0 rules', () => {
    it('store.ts\'s rowHalts asks isHaltingUpdate, and spells no halt of its own', () => {
      const src = readFileSync(path.join(here, '..', 'src', 'coord', 'store.ts'), 'utf8');
      expect(src).toContain("import { isHaltingUpdate } from '../../../shared/update-move.js';");
      expect(src).toContain('const rowHalts = (state: UpdateState, detail: string | null): boolean => isHaltingUpdate(state, detail);');
      expect(src).not.toMatch(/haltedOf\(state\) !== null &&/);
    });

    it('resolve.ts\'s autoGateBlockers asks carriesUpdateGate', () => {
      const src = readFileSync(path.join(here, '..', 'src', 'update', 'resolve.ts'), 'utf8');
      expect(src).toContain("import { carriesUpdateGate } from '../../../shared/update-move.js';");
      expect(src).toContain('.filter((n) => (scope === FLEET_SCOPE || n.nodeId === scope) && !carriesUpdateGate(n.caps))');
    });

    it('the gate word is tested by includes(UPDATE_GATE_CAP) on a code line only in shared/update-move.ts, and in Settings until its fold', () => {
      // SettingsScreen.tsx's `autoGateMissing` is the one other holder while another run's claim holds that file; the
      // claim-gated last task of wave 19 folds it onto `carriesUpdateGate` and drops it from this list.
      const GATE_TEST = /includes\(UPDATE_GATE_CAP\)/;
      expect(GATE_TEST.test('n.caps.includes(UPDATE_GATE_CAP)'), 'CONTROL: the pattern sees the copy').toBe(true);
      expect(ALL.filter((f) => GATE_TEST.test(codeOnly(f))).map(rel).sort()).toEqual([
        'pwa/src/screens/SettingsScreen.tsx', 'shared/update-move.ts',
      ]);
    });
  });
  ```
  In `server/test/update-resolve.test.ts`, replace the ring case's title line with:
  ```ts
    // Wave 19 (R26(b)) adds shared/update-move: autoGateBlockers asks carriesUpdateGate, the L0 gate read. It is L0
    // (it imports only shared/api and shared/agent-protocol), so the ring holds.
    it('resolve.ts imports only shared/api, shared/semver and shared/update-move — no fs, no store, no fastify', () => {
  ```
  and replace its set with `new Set(['../../../shared/api.js', '../../../shared/semver.js', '../../../shared/update-move.js'])`.
- [ ] **Step 3: Run, expect red** *(prototype)*:
  - `update-move` → `Tests  4 failed | 17 passed (21)`: the provenance census, `store.ts's rowHalts asks isHaltingUpdate …`, `resolve.ts's autoGateBlockers asks carriesUpdateGate`, and `the gate word is tested by includes(UPDATE_GATE_CAP) …` (the last because `resolve.ts` still holds it).
  - `update-resolve` → 1 failed (the ring case).
- [ ] **Step 4: Implement.** In `server/src/coord/store.ts`, after `import { newestTag } from '../../../shared/semver.js';`, add:
  ```ts
  // Centralised-update wave 19 (R24(d)): `rowHalts` asks the dispatcher's own halt rule rather than restating it.
  import { isHaltingUpdate } from '../../../shared/update-move.js';
  ```
  Then replace `rowHalts` (docstring and body):
  ```ts
  /** The same notion over a read-back row (`handOffLease`'s `why`): the dispatcher's own rule, `isHaltingUpdate`
   *  (shared/update-move.ts, L0), asked rather than restated (wave 19, R24(d)). A state this build cannot name reads
   *  `unknown`, which is busy and never halts. */
  const rowHalts = (state: UpdateState, detail: string | null): boolean => isHaltingUpdate(state, detail);
  ```
  `haltingRowSql`, `haltedOf` and `PROVENANCE_DETAIL_PREFIX`'s import stay: `haltingRowSql` still uses the prefix, and `haltedOf` keeps its other caller (`const halted = haltedOf(row.updateState);`).

  In `server/src/update/resolve.ts`:
  - the header line becomes `// below — three shared/ modules and nothing else — and update-resolve.test.ts`;
  - after the `shared/semver.js` import, add
    ```ts
    // Centralised-update wave 19 (R26(b)): the gate word is read by the L0 predicate the dispatcher and the PWA ask.
    import { carriesUpdateGate } from '../../../shared/update-move.js';
    ```
  - the clause becomes `.filter((n) => (scope === FLEET_SCOPE || n.nodeId === scope) && !carriesUpdateGate(n.caps))`;
  - `export { UPDATE_GATE_CAP };` stays, so its importers keep their path.

  In `shared/update-move.ts`, replace the two "NOT HERE" header lines with:
  ```ts
  // Since wave 19 (R24(d), R26(b)) the store's JS form of the halt (`rowHalts`, `server/src/coord/store.ts`) calls
  // `isHaltingUpdate`, and the resolver's `autoGateBlockers` calls `carriesUpdateGate`. NOT HERE: the store's SQL form
  // (`haltingRowSql`), which SQL cannot call; `update-store-nodes.test.ts` pins it equal to `isHalting`.
  ```
- [ ] **Step 5: Run** (server, one file per call):
  - `update-move` (**21**), `update-resolve` (**48**), `update-store-nodes` (**43**; see Risk notes on its heir-guard case), `update-routes` (**41**), `update-dispatch` (**92**), `update-auto-dispatch` (**15**), `update-apply-routes` (**53**);
  - `./node_modules/.bin/tsc --noEmit -p .`, which must be clean.
  
  *(prototype: the six files other than `update-store-nodes` were green, 360 tests with `update-inventory`. `update-store-nodes` had 42 green, plus the heir-guard case timed out at 20 s under load 30, as it does on the shipped body. An attacker measured `update-store-nodes` 43 passed in 13.3 s at load about 26.)*
- [ ] **Step 6: Mutation table** *(prototype; T2-2's `update-store-nodes` cell was measured by an attack pass at `518789ad0`)*.

  | Row | File | Mutation | Command(s) | Measured red |
  |---|---|---|---|---|
  | T2-1 | `store.ts` | `rowHalts` back to its shipped body (`haltedOf(state) !== null && !(… startsWith(PROVENANCE_DETAIL_PREFIX))`) | `update-move` | 2 (the provenance census; `store.ts's rowHalts asks isHaltingUpdate …`) |
  | T2-2 | `store.ts` | `isHaltingUpdate(state, null)` (drops the detail) | `update-move`; `update-store-nodes` | `update-move` 1 (`store.ts's rowHalts …`); `update-store-nodes` 1 (`the heir guard refuses a row that HALTS and only that: failed: provenance: is not one …`: `expected { ok: false, why: 'halted', … } to deeply equal { ok: false, why: 'no-lease-to-hand' }`) |
  | T2-3 | `resolve.ts` | the clause back to `!n.caps.includes(UPDATE_GATE_CAP)` | `update-move`; `update-resolve` | `update-move` 2 (`resolve.ts's autoGateBlockers asks carriesUpdateGate`, `the gate word is tested …`); `update-resolve` 48 green (same behaviour, as it must be) |
  | T2-4 | `resolve.ts` | `&& carriesUpdateGate(n.caps)` (negation dropped) | `update-move`; `update-resolve` | `update-resolve` 2 (`the fleet scope names every node lacking update-gate …`, `a node scope names only that node …`); `update-move` 1 (`resolve.ts's autoGateBlockers …`) |

  Under T2-2, the case "the heir guard IS `isHalting`" cannot red by assertion. `handOffLease`'s SQL guard (`haltingRowSql`) lets a `failed: provenance:` heir through, and `rowHalts` is reached only after the SQL refused, for rows where the detail does not change the answer. A timeout in that case under T2-2 is load (Risk notes), not the mutation's red: re-run it in isolation.
- [ ] **Step 7: Commit:** `refactor(update): rowHalts and autoGateBlockers ask the L0 rules, pinned in source (wave 19, R24(d), R26(b); D-5116)`.

### Task 3: R27(a), R27(b)'s test half and R26(a) in the halt banner (D-5117, D-5118)

**Files:** `pwa/src/fleet/updateAck.ts`, `pwa/src/fleet/HaltBanner.tsx`, `pwa/test/halt-banner.test.tsx`.

- [ ] **Step 1: Re-measure.**
  ```bash
  cd pwa
  grep -nF "          after: Number.isInteger(issued) && issued > 0 ? issued : null," src/fleet/HaltBanner.tsx   # 74
  grep -nF '    <li className="halt-banner-node" data-node-id={n.nodeId}>' src/fleet/HaltBanner.tsx   # 81
  grep -nF '      <ul className="halt-banner-list" aria-label="Halted nodes">' src/fleet/HaltBanner.tsx
  grep -nF "import { canAck, sendAck } from './updateAck';" src/fleet/HaltBanner.tsx   # 26
  grep -nF "// Ruling G (D-4273): a parent that issues no read" test/halt-banner.test.tsx   # 325
  grep -nF "describe('HaltBanner — a parent that issues no read holds on the lease (D-4273, ruling G)'" test/halt-banner.test.tsx   # 327
  grep -nF "    expect(bannerSrc).toMatch(/import \{ canAck, sendAck \} from '\.\/updateAck';/);" test/halt-banner.test.tsx   # 183
  ./node_modules/.bin/vitest list test/halt-banner.test.tsx | wc -l     # 47
  ```
- [ ] **Step 2: Write the cases first (red).** In `halt-banner.test.tsx`:
  - R27(b): replace the comment at :325-326 and the title at :327 with
    ```ts
    // Round 2's FIX item 1 (D-4273; `useUpdatesView(0)`, the injected mode, whose `reload()` answers 0): a parent that
    // issues no read gives the hold nothing to date a read by, so the hold falls back to the LEASE. No mode can re-arm on
    // a read it cannot date.
    describe('HaltBanner — a parent that issues no read holds on the lease (D-4273, round 2 FIX item 1)', () => {
    ```
  - D-5118: the import pin becomes
    ```ts
        expect(bannerSrc).toMatch(/import \{ canAck, keepFocusInRow, sendAck \} from '\.\/updateAck';/);   // + R26(a)'s focus hand-off (wave 19)
    ```
  - Append at the end of the file. The third case is *(revised, unmeasured)*:
    ```ts

    // Centralised-update wave 19, R26(a): the tap disables the Ack it was made on (in flight, then held after a clean
    // 200), and a focused control that disables drops focus to <body>. The row takes it first: it is focusable from
    // script only (tabIndex -1), and it names the node, its state, its target and its detail. jsdom does not run the
    // browser's focus fix-up, so without the move document.activeElement stays the disabled button, which is the red.
    // A clean ack returns the row to idle, so the next poll drops it; while another row still halts, focus goes to the
    // banner's list rather than <body>.
    describe('HaltBanner — focus survives the Ack disabling (wave 19, R26(a))', () => {
      it('a focused Ack that disables hands focus to its own row, in flight and while held', async () => {
        vi.spyOn(api, 'ackUpdateNode').mockResolvedValue({ ok: true, node: node() });
        const { onAcked } = mount(view([server({ update: { state: 'reverted', target: 'v0.0.84', startedAt: 1, detail: null } }), failed()]));
        const btn = screen.getByRole('button', { name: 'Ack fleet' });
        const row = btn.closest('li.halt-banner-node') as HTMLElement;
        btn.focus();
        fireEvent.click(btn);
        expect(btn).toBeDisabled();
        expect(document.activeElement, 'in flight: the row holds focus, not the disabled button').toBe(row);
        expect(row).toHaveAttribute('tabindex', '-1');
        await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
        expect(screen.getByRole('button', { name: 'Acked fleet' })).toBeDisabled();
        expect(document.activeElement, 'held after the 200: still the row').toBe(row);
      });

      it('CONTROL: an Ack tapped while focus is elsewhere leaves focus where it was', async () => {
        vi.spyOn(api, 'ackUpdateNode').mockResolvedValue({ ok: true, node: node() });
        const { onAcked } = mount(view([server({ update: { state: 'reverted', target: 'v0.0.84', startedAt: 1, detail: null } }), failed()]));
        const other = screen.getByRole('button', { name: 'Ack server' });
        other.focus();
        fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
        await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
        expect(document.activeElement).toBe(other);
      });

      it('the poll that drops the acked row hands focus to the banner\'s list while another row still halts', async () => {
        vi.spyOn(api, 'ackUpdateNode').mockResolvedValue({ ok: true, node: node() });
        const reverted = server({ update: { state: 'reverted', target: 'v0.0.84', startedAt: 1, detail: null } });
        const onAcked = vi.fn(() => 2);
        const { rerender } = render(<><ToastHost /><HaltBanner updates={view([reverted, failed()])} seq={1} onAcked={onAcked} /></>);
        const btn = screen.getByRole('button', { name: 'Ack fleet' });
        btn.focus();
        fireEvent.click(btn);
        await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
        // The re-poll's answer: fleet went back to idle on the ack, server still halts, so the banner stays.
        rerender(<><ToastHost /><HaltBanner updates={view([reverted, node()])} seq={2} onAcked={onAcked} /></>);
        expect(screen.queryByRole('button', { name: /^Ack(ed)? fleet$/ }), 'the acked row is gone').toBeNull();
        const list = screen.getByRole('list', { name: 'Halted nodes' });
        expect(list).toHaveAttribute('tabindex', '-1');
        expect(document.activeElement, 'the list, not <body>').toBe(list);
      });
    });
    ```
- [ ] **Step 3: Run, expect red** *(prototype, for the first two cases and the pin)*. `halt-banner` should red on two things: `a focused Ack that disables hands focus to its own row …` (`expected <button …> to be <li class="halt-banner-node" …>`), and the D-4267 source pin (`expected '// HaltBanner …' to match /import \{ canAck, keepFocusInRow, sendAck …/`). The CONTROL passes.
  - Measured: the focus case alone gave `1 failed | 48 passed (49)` before the pin edit. The pin edit alone red as `Settings re-exports the same function and text, and holds no copy of either (D-4267)` while the import lagged.
  - *(revised, unmeasured)* The third case reds too (`expected <body> to be <ul …>`), so expect 3 failed of 50. An attack pass measured its premise at `0b3ff2f62` with Task 3's prototype code applied: the rerender left `document.activeElement` on `<body>`.
- [ ] **Step 4: Implement.** Append to `pwa/src/fleet/updateAck.ts`:
  ```ts

  /** Before an Ack disables itself (wave 19, R26(a)): a focused control that becomes disabled drops focus to <body>.
   *  So when focus is inside the Ack's row, the row takes it first. The row is `tabIndex={-1}`, focusable from script
   *  only, and its text names what the Ack was for. Focus anywhere else is left where it is. Both Ack surfaces call
   *  this, before they set their busy flag. */
  export function keepFocusInRow(row: HTMLElement | null): void {
    const active = document.activeElement;
    if (row !== null && active !== null && row.contains(active)) row.focus();
  }
  ```
  In `pwa/src/fleet/HaltBanner.tsx`:
  - imports: `import { useLayoutEffect, useRef, useState, type RefObject } from 'react';` (keep any other names the line already imports) and `import { canAck, keepFocusInRow, sendAck } from './updateAck';`;
  - `HaltRow` takes `listRef: RefObject<HTMLUListElement | null>` beside its other props;
  - after the `hold` state, add `const rowRef = useRef<HTMLLIElement>(null);`, then *(revised, unmeasured)*:
    ```tsx
      // Wave 19, R26(a): a clean ack returns this row to idle, so the next poll drops it. If it holds focus as it
      // leaves, the banner's list takes it; this cleanup runs before React removes the <li>, so the test can still see it.
      useLayoutEffect(() => {
        const row = rowRef.current;
        return () => { if (row !== null && row.contains(document.activeElement)) listRef.current?.focus(); };
      }, [listRef]);
    ```
  - in `ack`, after `const sentAgainst = leaseKey(n);`, add
    ```ts
        keepFocusInRow(rowRef.current);   // the tap disables this Ack, in flight and then held (wave 19, R26(a))
    ```
  - the lease fallback becomes `after: issued > 0 ? issued : null,` (D-5117);
  - the row becomes `<li className="halt-banner-node" data-node-id={n.nodeId} ref={rowRef} tabIndex={-1}>`;
  - in `HaltBanner`, add `const listRef = useRef<HTMLUListElement>(null);` as the first statement, before the early returns. The list becomes `<ul className="halt-banner-list" aria-label="Halted nodes" ref={listRef} tabIndex={-1}>`, and each `HaltRow` gets `listRef={listRef}`. *(revised, unmeasured)*

  If the cleanup measures otherwise (focus already on `<body>` when it runs), stop and report it as a reserve deviation. Do not improvise another mechanism.
- [ ] **Step 5: Run:** `halt-banner` (**50**). *(prototype: `Tests  49 passed (49)` before the third case; 50 is revised, unmeasured)*
- [ ] **Step 6: Mutation table** *(prototype for T3-1 to T3-4; T3-5 and T3-6 revised, unmeasured; every row runs `halt-banner` whole)*.

  | Row | File | Mutation | Measured red |
  |---|---|---|---|
  | T3-1 | `HaltBanner.tsx` | delete the `keepFocusInRow(rowRef.current);` line | 1 (`a focused Ack that disables hands focus to its own row …`) |
  | T3-2 | `HaltBanner.tsx` | the row loses `tabIndex={-1}` | 1 (the same case: jsdom will not focus a non-focusable `li`) |
  | T3-3 | `HaltBanner.tsx` | `after: issued,` (the `> 0` fallback dropped too) | 4 (`unanswered`/`unreadable ending, onAcked answers 0`/`undefined: held on the lease through any seq …`) |
  | T3-4 | `updateAck.ts` | `if (row !== null) row.focus();` (no "focus is inside the row" test) | 1 (`CONTROL: an Ack tapped while focus is elsewhere …`); after Task 4, also `update-halt-controls` 1 (its CONTROL) |
  | T3-5 | `HaltBanner.tsx` | the cleanup's `listRef.current?.focus();` deleted | expected 1 (`the poll that drops the acked row …`) *(revised, unmeasured)* |
  | T3-6 | `HaltBanner.tsx` | the list loses `tabIndex={-1}` | expected 1 (the same case) *(revised, unmeasured)* |
- [ ] **Step 7: Commit:** `fix(update): a focused Ack that disables hands focus to its row, and to the banner's list when its row leaves; the lease fallback's dead sub-term goes; the cite is round 2's FIX item 1 (wave 19, R26(a), R27(a), R27(b); D-5117, D-5118)`.

### Task 4: R24(a) and R26(a) in Settings — Install and Update wait on a halt, with Update all's reason; the node row keeps focus

**Files:** `pwa/src/screens/updates.tsx`, `pwa/test/update-halt-controls.test.tsx` (new).

- [ ] **Step 1: Re-measure.**
  ```bash
  cd pwa
  grep -nF "function MoveButton({ disabled, onClick, children }: {" src/screens/updates.tsx   # 186
  grep -nF "            <MoveButton disabled={blockers.length > 0} onClick={() => onMove(intent as MoveIntent)}>" src/screens/updates.tsx   # 246
  grep -nF "              disabled={next === null}" src/screens/updates.tsx   # 462
  grep -nF "              disabled={previous === null || previousRefusal !== null}" src/screens/updates.tsx
  grep -nF "        <MoveButton disabled={!ackable || acking} onClick={ack}>Ack</MoveButton>" src/screens/updates.tsx   # 475
  grep -nF '    <li className="settings-node" data-node-id={n.nodeId}>' src/screens/updates.tsx   # 434
  grep -nF "// wave 5): Update iff pendingTag names a tag, Roll back iff previousVersion" src/screens/updates.tsx   # 289
  grep -nF "export function releaseDirection(tag: string, nodes: readonly NodeWire[]): 'install' | 'rollback' | 'running' {" src/screens/updates.tsx
  grep -nF 'export const updateAllHaltedText = (halting: readonly NodeWire[]): string =>' src/fleet/updateHalt.ts   # 57
  grep -nF ".settings-release-refused { margin: 0; font-size: var(--fs-xs); color: var(--status-attention-text); }" src/fleet/fleet.css
  ```
  Confirm the server side of Review Focus 1: `grep -nF "  const gate = fleetGate(views.map((v) => v.row));" ../server/src/update/routes.ts` (in `singleNodeMove`) and `grep -nF "  if (gate.haltedBy.length > 0) return 'halted';" ../server/src/update/dispatch.ts`.
- [ ] **Step 2: Write the cases first (red).** Create `pwa/test/update-halt-controls.test.tsx`. The first six cases of the first describe, and the second describe, are *(prototype)*. The three cases marked in comments are *(revised, unmeasured)*.
  ```tsx
  // Settings' own move controls while a node halts the fleet (centralised-update programme wave 19, R24(a), R26(a)).
  // While any node halts, the dispatcher refuses every move but the Ack (spec §10; `moveRefusal`'s first clause), so
  // the release row's Install (`{all: true}`) and every node's Update wait, disabled, and say why with Update all's own
  // reason line (`updateAllHaltedText`, reused verbatim: no new sentence). The line shows only above a list where it
  // gates a control. Roll back is not gated (the residue names Install and Update). The Ack on a node's row keeps
  // focus in that row when it disables (R26(a)), as the halt banner's does.
  //
  // It renders the exported `ReleaseList` and `NodeList` directly, so the screen's own suite (another run's claim)
  // is not edited; that suite's idle fixtures stay green beside these.
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
  import type { NodeWire, ReleaseWire } from '../../shared/api';
  import type { BuildInfo } from '../../shared/buildinfo';
  import { api } from '../src/lib/api';
  import { ToastHost } from '@ccrc/ui';
  import { updateAllHaltedText } from '../src/fleet/updateHalt';
  import { NodeList, ReleaseList } from '../src/screens/updates';

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const T0 = 1_760_000_000_000;
  const FLEET_ID = '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10';
  const SERVER_ID = '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93';
  const stamp = (version: string): BuildInfo => ({ sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-23T12:00:00Z', dirty: false, version });
  const node = (over: Partial<NodeWire> = {}): NodeWire => ({
    nodeId: FLEET_ID, role: 'fleet', label: 'fleet', os: 'linux',
    current: stamp('v0.0.9'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
    caps: ['detach', 'update-gate'], agentOps: ['update'], highestVersion: 'v0.0.9', previousVersion: null,
    floorRead: 'measured', previousRead: 'absent',
    measuredAt: T0, reachable: true, unreachableSince: null,
    channel: 'stable', desiredTag: 'v0.0.10', resolveDetail: null,
    request: null, report: null,
    update: { state: 'idle', target: null, startedAt: null, detail: null },
    ...over,
  });
  const server = (over: Partial<NodeWire> = {}): NodeWire =>
    node({ nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null, ...over });
  const failed = (detail = 'gate: unit not up'): Partial<NodeWire> =>
    ({ update: { state: 'failed', target: 'v0.0.10', startedAt: T0, detail } });
  const release = (tag: string): ReleaseWire => ({
    tag, version: tag, channel: 'stable', publishedAt: T0, commitSha: 'c'.repeat(40),
    bundleListed: true, yanked: false, refused: [], notes: null,
  });

  const ONE_HALT = 'Update all waits: nothing moves until fleet is acknowledged — tap Ack on it in the halt banner.';

  const renderReleases = (nodes: NodeWire[], releases: ReleaseWire[] = [release('v0.0.10')]) => {
    const onMove = vi.fn();
    render(<ReleaseList releases={releases} nodes={nodes} onMove={onMove} />);
    return { onMove, list: screen.getByRole('list', { name: 'Releases' }) };
  };
  const renderNodes = (nodes: NodeWire[]) => {
    const onMove = vi.fn();
    const onAcked = vi.fn();
    render(<><ToastHost /><NodeList nodes={nodes} releases={[release('v0.0.10')]} now={T0} catalogueLastOkAt={T0} onAcked={onAcked} onMove={onMove} /></>);
    return { onMove, onAcked, list: screen.getByRole('list', { name: 'Nodes' }) };
  };
  const rowOf = (list: HTMLElement, id: string): HTMLElement => list.querySelector(`li[data-node-id="${id}"]`) as HTMLElement;

  describe('Settings while a node halts — Install and Update wait, with Update all\'s reason (wave 19, R24(a))', () => {
    it('the reason is updateAllHaltedText, verbatim', () => {
      expect(updateAllHaltedText([node()])).toBe(ONE_HALT);
    });

    it('a halting row disables the release row\'s Install, described by the one reason line', () => {
      const { onMove, list } = renderReleases([node(failed()), server()]);
      const install = within(list).getByRole('button', { name: 'Install' });
      expect(install).toBeDisabled();
      expect(install).toHaveAccessibleDescription(ONE_HALT);
      expect(screen.getAllByText(ONE_HALT)).toHaveLength(1);
      fireEvent.click(install);
      expect(onMove, 'a disabled Install opens no sheet').not.toHaveBeenCalled();
    });

    it('a halting row disables every node\'s Update, each described by the one reason line', () => {
      const { onMove, list } = renderNodes([node(failed()), server()]);
      const updates = within(list).getAllByRole('button', { name: 'Update' });
      expect(updates).toHaveLength(2);
      for (const b of updates) {
        expect(b).toBeDisabled();
        expect(b).toHaveAccessibleDescription(ONE_HALT);
      }
      expect(screen.getAllByText(ONE_HALT)).toHaveLength(1);
      fireEvent.click(updates[1]!);
      expect(onMove).not.toHaveBeenCalled();
    });

    it('with no halt both stay enabled, undescribed, with no reason line, and open the sheet', () => {
      const r = renderReleases([node(), server()]);
      const install = within(r.list).getByRole('button', { name: 'Install' });
      expect(install).not.toBeDisabled();
      expect(install).not.toHaveAttribute('aria-describedby');
      fireEvent.click(install);
      expect(r.onMove).toHaveBeenCalledWith({ scope: 'fleet', direction: 'update', tag: 'v0.0.10' });
      cleanup();
      const n = renderNodes([node(), server()]);
      for (const b of within(n.list).getAllByRole('button', { name: 'Update' })) {
        expect(b).not.toBeDisabled();
        expect(b).not.toHaveAttribute('aria-describedby');
      }
      expect(screen.queryByText(ONE_HALT)).toBeNull();
    });

    it('a failed row whose detail is a provenance verdict does not halt (D-3378): both stay enabled', () => {
      const r = renderReleases([node(failed('provenance: unsigned bundle')), server()]);
      expect(within(r.list).getByRole('button', { name: 'Install' })).not.toBeDisabled();
      cleanup();
      const n = renderNodes([node(failed('provenance: unsigned bundle')), server()]);
      expect(within(n.list).getAllByRole('button', { name: 'Update' })[1]).not.toBeDisabled();
      expect(screen.queryByText(ONE_HALT)).toBeNull();
    });

    it('two halting rows name both, in inventory order', () => {
      renderReleases([node(failed()), server({ update: { state: 'reverted', target: 'v0.0.10', startedAt: T0, detail: null } })]);
      expect(screen.getByText(
        'Update all waits: nothing moves until fleet, server are acknowledged — tap Ack on each in the halt banner.',
      )).toBeInTheDocument();
    });

    // (revised, unmeasured) The CONTROL proves the fixture is an offered rollback row; if it reds, fix the fixture
    // (rollbackBlockers' inputs), never the assertion.
    it('a halt with no Install on screen shows no reason line above Releases; Roll back stays enabled and undescribed (Reading 2)', () => {
      const older = [release('v0.0.8')];
      const c = renderReleases([node(), server()], older);
      expect(within(c.list).getByRole('button', { name: 'Roll back' }), 'CONTROL: an offered rollback row').not.toBeDisabled();
      cleanup();
      const { onMove, list } = renderReleases([node(failed()), server()], older);
      const back = within(list).getByRole('button', { name: 'Roll back' });
      expect(back).not.toBeDisabled();
      expect(back).not.toHaveAttribute('aria-describedby');
      expect(screen.queryByText(ONE_HALT), 'no Install on screen: nothing for the line to explain').toBeNull();
      fireEvent.click(back);
      expect(onMove).toHaveBeenCalledWith({ scope: 'fleet', direction: 'rollback', to: 'v0.0.8' });
    });

    // (revised, unmeasured)
    it('a node\'s Roll back stays enabled and undescribed while another node halts (Reading 2)', () => {
      const back = (list: HTMLElement) => within(rowOf(list, SERVER_ID)).getByRole('button', { name: 'Roll back' });
      const c = renderNodes([node(), server({ previousVersion: 'v0.0.8' })]);
      expect(back(c.list), 'CONTROL: the fixture offers a Roll back').not.toBeDisabled();
      cleanup();
      const { list } = renderNodes([node(failed()), server({ previousVersion: 'v0.0.8' })]);
      expect(back(list)).not.toBeDisabled();
      expect(back(list)).not.toHaveAttribute('aria-describedby');
    });

    // (revised, unmeasured)
    it('a halt that gates no Update shows no reason line above Nodes', () => {
      const { list } = renderNodes([node({ ...failed(), desiredTag: null }), server({ desiredTag: null })]);
      const updates = within(list).getAllByRole('button', { name: 'Update' });
      expect(updates, 'CONTROL: the rows still offer an Update control').toHaveLength(2);
      for (const b of updates) expect(b).toBeDisabled();
      expect(screen.queryByText(ONE_HALT)).toBeNull();
    });
  });

  describe('Settings\' Ack keeps focus in its row when it disables (wave 19, R26(a))', () => {
    it('a focused Ack that disables hands focus to its node row', async () => {
      vi.spyOn(api, 'ackUpdateNode').mockResolvedValue({ ok: true, node: node() });
      const { onAcked, list } = renderNodes([node(failed()), server()]);
      const row = rowOf(list, FLEET_ID);
      const ack = within(row).getByRole('button', { name: 'Ack' });
      ack.focus();
      fireEvent.click(ack);
      expect(ack).toBeDisabled();
      expect(document.activeElement, 'in flight: the row holds focus, not the disabled button').toBe(row);
      expect(row).toHaveAttribute('tabindex', '-1');
      await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    });

    it('CONTROL: an Ack tapped while focus is elsewhere leaves focus where it was', async () => {
      vi.spyOn(api, 'ackUpdateNode').mockResolvedValue({ ok: true, node: node() });
      const { onAcked, list } = renderNodes([node(failed()), server()]);
      const other = document.body.appendChild(document.createElement('button'));
      try {
        other.focus();
        fireEvent.click(within(rowOf(list, FLEET_ID)).getByRole('button', { name: 'Ack' }));
        await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
        expect(document.activeElement).toBe(other);
      } finally {
        other.remove();
      }
    });
  });
  ```
- [ ] **Step 3: Run, expect red.** `update-halt-controls` → *(prototype, on the 8 original cases)* `Tests  4 failed | 4 passed (8)`:
  - the Install case and the Update case (`toBeDisabled`);
  - `two halting rows name both …` (no such text);
  - `a focused Ack that disables hands focus to its node row` (`expected <button …> to be <li class="settings-node" …>`).
  
  The three new cases guard against over-gating, so they pass before the implementation: expect `4 failed | 7 passed (11)` *(revised, unmeasured)*. Their reds are T4-8 to T4-11.
- [ ] **Step 4: Implement** in `pwa/src/screens/updates.tsx` (Task 3's `keepFocusInRow` must be on the branch):
  - imports: `import { useId, useRef, useState } from 'react';`; `import { ACK_UNREADABLE_TEXT, canAck, keepFocusInRow, sendAck } from '../fleet/updateAck';` and, below it, `import { haltingNodes, updateAllHaltedText } from '../fleet/updateHalt';`. `pendingTag` is already imported (NodeItem uses it).
  - `MoveButton` and two helpers after it:
    ```tsx
    function MoveButton({ disabled, onClick, children, describedBy }: {
      disabled: boolean;
      onClick: () => void;
      children: ReactNode;
      describedBy?: string;
    }): ReactNode {
      return (
        <Button variant="ghost" size="fit" className="settings-move"
                disabled={disabled} aria-describedby={describedBy} onClick={onClick}>
          {children}
        </Button>
      );
    }

    /** Wave 19, R24(a): while a node halts the fleet the dispatcher refuses every move but the Ack (spec §10;
     *  `moveRefusal`'s first clause), so the release row's Install (`{all: true}`) and every node's Update wait, and say
     *  why with Update all's own reason line, verbatim (`updateAllHaltedText`; who halts is `haltingNodes`, the
     *  dispatcher's own rule from L0). Null when nothing halts. Roll back is not gated here (the residue item names
     *  Install and Update; the route still refuses it with the `halted` sentence). */
    function haltedReason(nodes: readonly NodeWire[]): string | null {
      const halting = haltingNodes(nodes);
      return halting.length > 0 ? updateAllHaltedText(halting) : null;
    }

    /** The reason line, once per list, above it, and only where it gates a control on screen; the gated buttons point
     *  at it by `aria-describedby`. */
    function HaltedLine({ id, text }: { id: string; text: string }): ReactNode {
      return <p className="settings-release-refused" id={id}>{text}</p>;
    }
    ```
  - `ReleaseItem` takes `haltedBy: string | null` (`{ release: r, nodes, haltedBy, onMove }`, typed beside `nodes`), and its button becomes
    ```tsx
                <MoveButton
                  disabled={blockers.length > 0 || (direction === 'install' && haltedBy !== null)}
                  describedBy={direction === 'install' && haltedBy !== null ? haltedBy : undefined}
                  onClick={() => onMove(intent as MoveIntent)}
                >
    ```
  - `ReleaseList`'s body. The `shown` line is *(revised, unmeasured)*:
    ```tsx
      const haltedId = useId();
      if (releases.length === 0) return null;
      const sorted = sortReleases(releases);
      const halted = haltedReason(nodes);
      // Wave 19 (UI-4): the line is said only where it gates a control on screen — some row in the install direction.
      const shown = halted !== null && sorted.some((r) => releaseDirection(r.tag, nodes) === 'install') ? halted : null;
      return (
        <>
          {shown !== null && <HaltedLine id={haltedId} text={shown} />}
          <ul className={`settings-releases ${RESET_LIST}`} aria-label="Releases">
            {sorted.map((r) => (
              <ReleaseItem key={r.tag} release={r} nodes={nodes} haltedBy={shown !== null ? haltedId : null} onMove={onMove} />
            ))}
          </ul>
        </>
      );
    ```
  - `NodeItem`:
    - it takes `haltedBy: string | null`, typed after `catalogueLastOkAt`;
    - after its `acking` state, add `const rowRef = useRef<HTMLLIElement>(null);`;
    - in `ack`, before `setAcking(true);`, add
      ```tsx
          keepFocusInRow(rowRef.current);   // the tap disables this Ack while it is in flight (wave 19, R26(a))
      ```
    - the row becomes `<li className="settings-node" data-node-id={n.nodeId} ref={rowRef} tabIndex={-1}>`;
    - the Update button becomes the following, where `describedBy` is narrowed to a row that has an Update to wait on *(revised, unmeasured)*:
      ```tsx
                <MoveButton
                  disabled={next === null || haltedBy !== null}
                  describedBy={next !== null && haltedBy !== null ? haltedBy : undefined}
                  onClick={() => { if (next !== null) onMove({ scope: 'node', direction: 'update', nodeId: n.nodeId, tag: next }); }}
                >
      ```
    - Roll back is unchanged.
  - `NodeList`'s body, the same shape as `ReleaseList`'s: `const haltedId = useId();` before the empty return, `const halted = haltedReason(nodes);`, and `const shown = halted !== null && nodes.some((n) => pendingTag(n) !== null) ? halted : null;` *(revised, unmeasured)*. The `<HaltedLine>` goes before the `<ul>` in a fragment, and each `NodeItem` gets `haltedBy={shown !== null ? haltedId : null}`. `pendingTag` already answers null for a Darwin node.
  - The inventory header's sentence becomes `// wave 5): Update iff pendingTag names a tag and no node halts the fleet (wave` / `// 19, R24(a): \`haltedReason\`), Roll back iff previousVersion`.
- [ ] **Step 5: Run:** `update-halt-controls` (**11**), `halt-banner` (**50**), `settings-screen` (**189**, unchanged and green: its fixtures are idle), `markup-census` (**10**), `literal-census` (**4**), `control-census`, `shape-census`. *(prototype: the seven files gave `Tests  278 passed (278)` with 8 and 49 in the first two; 11 and 50 are revised, unmeasured.)*
- [ ] **Step 6: Mutation table** *(prototype for T4-1 to T4-7; T4-8 to T4-11 revised, unmeasured; every row runs `update-halt-controls` whole)*.

  | Row | Mutation in `updates.tsx` | Measured red |
  |---|---|---|
  | T4-1 | Install's `disabled={blockers.length > 0}` (no halt term) | 1 (`a halting row disables the release row's Install …`) |
  | T4-2 | Update's `disabled={next === null}` (no halt term) | 1 (`a halting row disables every node's Update …`) |
  | T4-3 | `haltedReason` returns `null` | 3 (the Install case, the Update case, `two halting rows name both …`) |
  | T4-4 | delete `NodeItem`'s `keepFocusInRow(rowRef.current);` | 1 (`a focused Ack that disables hands focus to its node row`) |
  | T4-5 | `MoveButton` drops `aria-describedby={describedBy}` | 2 (the Install case, the Update case: `toHaveAccessibleDescription`) |
  | T4-6 | the node row loses `tabIndex={-1}` | 1 (`a focused Ack that disables …`) |
  | T4-7 | `NodeList` renders no `<HaltedLine>` | 1 (`a halting row disables every node's Update …`) |
  | T4-8 | Install's disabled drops `direction === 'install' &&` (`disabled={blockers.length > 0 \|\| haltedBy !== null}`) | expected 1 (`a halt with no Install on screen …`; its Roll back is then disabled). Measured by an attack pass on the prototype, before the `shown` rule: with that mutation and the describedBy one together, the suite then held no case, `Tests 241 passed (241)`. That gap is this row's reason. |
  | T4-9 | NodeItem's Roll back gains `\|\| haltedBy !== null` | expected 1 (`a node's Roll back stays enabled …`) |
  | T4-10 | `ReleaseList`'s `shown = halted` (no install-direction test) | expected 1 (`a halt with no Install on screen …`: the line shows) |
  | T4-11 | `NodeList`'s `shown = halted` (no pending-tag test) | expected 1 (`a halt that gates no Update …`) |

  (Each `\|` in T4-8 and T4-9 is a source-code `||` inside the mutation text, not a filter pattern.)
- [ ] **Step 7: Commit:** `feat(update): Settings' Install and Update wait on a halt with Update all's reason, said only where it gates a control; Roll back stays offered; the node row keeps the Ack's focus (wave 19, R24(a), R26(a))`.

### Task 5: R24(b) and R26(d) — every home-screen update surface says when it is the last answer, announced once (D-5119, D-5120, D-5121, D-5124)

**Files:** `pwa/src/fleet/useUpdatesView.ts`, `pwa/src/fleet/updateHalt.ts`, `pwa/src/fleet/HaltBanner.tsx`, `pwa/src/fleet/UpdateBanner.tsx`, `pwa/src/fleet/FleetHostBanner.tsx`, `ui/src/components/build-line.tsx`, `pwa/src/screens/FleetScreen.tsx`, `pwa/test/update-halt.test.ts`, `pwa/test/halt-banner.test.tsx`, `pwa/test/update-banner.test.tsx`, `pwa/test/fleet-host-banner.test.tsx`, `pwa/test/build-line.test.tsx`, `pwa/test/fleet-screen.test.tsx`, `pwa/test/literal-census.test.ts`.

- [ ] **Step 1: Re-measure.**
  ```bash
  cd pwa
  grep -nF "const STALE_TEXT = 'The latest read failed — this is the last answer that landed.';" src/screens/SettingsScreen.tsx   # 104 at 0b3ff2f62 (read only here)
  grep -nF "export type UpdatesFailure = 'not-configured' | 'failed';" src/fleet/useUpdatesView.ts   # 42
  grep -nF "  const then = nodes.some(leaseUnreadable) ? 'cli' : autoArm(nodes, intent);" src/fleet/updateHalt.ts   # 133
  grep -nF "  // skew would widen, not close. \`auto\` only when every node ends on the SAME release tag." src/fleet/updateHalt.ts   # 121
  grep -nF '      <span className="halt-banner-msg">{HALT_LEAD_TEXT}</span>' src/fleet/HaltBanner.tsx
  grep -nF '          {halted !== null && <span className="update-banner-msg" id={haltedId}>{halted}</span>}' src/fleet/UpdateBanner.tsx
  grep -nF "    const remedy = skewRemedy(nodes, intent);" src/fleet/FleetHostBanner.tsx
  grep -nF "  const updates = useUpdatesView();" src/screens/FleetScreen.tsx   # 178, the screen's one poll
  grep -nF '      <BuildLine health={fleetHealth} nodes={updates.view?.nodes ?? null} />' src/screens/FleetScreen.tsx   # 535
  grep -nF '<div className="sr-only" role="status">' src/fleet/BucketBar.tsx   # the shape D-5124 reuses
  grep -nF "export function BuildLine({ health, nodes }: { health: FleetHealth | null; nodes: readonly NodeWire[] | null }): ReactNode {" ../ui/src/components/build-line.tsx   # 42
  grep -nF "  // No NEXT. The one entry below is argued, not deferred." test/literal-census.test.ts   # 143
  ```
- [ ] **Step 2: Write the cases first (red).** Each `aria-hidden` assertion, the `exposed()` helper, and the fleet-screen counts of 5 and 1 are *(revised, unmeasured)*. The rest is *(prototype)*.
  - `update-halt.test.ts`, appended:
    ```ts

    // Centralised-update wave 19, R24(b): while a later poll's failure stands, the view is the last answer that landed,
    // so the console cannot vouch that auto will move the lagging box. The halt is still said (the Ack is still the
    // door), and what follows the ack is the terminal.
    describe('skewRemedy — a standing poll failure never vouches for auto (wave 19, R24(b))', () => {
      const movable = [node(), server()];
      it('stale: the console\'s own move becomes the terminal verbs', () => {
        expect(skewRemedy(movable, [intent('channel')]), 'CONTROL: the same rows, fresh').toEqual({ kind: 'auto' });
        expect(skewRemedy(movable, [intent('channel')], true)).toEqual({ kind: 'cli' });
      });

      it('stale: a halt still outranks everything, and what follows the ack is the terminal', () => {
        const halted = [node({ update: lease('failed', 'x') }), server()];
        expect(skewRemedy(halted, [intent('channel')]), 'CONTROL: fresh').toEqual({ kind: 'halt', halting: [halted[0]], then: 'auto' });
        expect(skewRemedy(halted, [intent('channel')], true)).toEqual({ kind: 'halt', halting: [halted[0]], then: 'cli' });
      });

      it('fresh (false) answers exactly as with no third argument', () => {
        expect(skewRemedy(movable, [intent('channel')], false)).toEqual({ kind: 'auto' });
        expect(skewRemedy(null, [intent('channel')], true)).toEqual({ kind: 'cli' });
      });
    });
    ```
  - `halt-banner.test.tsx`: `import { UPDATES_STALE_TEXT, useUpdatesView } from '../src/fleet/useUpdatesView';`, and before Task 3's focus describe:
    ```tsx
    // Centralised-update wave 19, R24(b): a later poll failed, so the rows are the last answer that landed, and the
    // banner says so in the update plane's own sentence (UPDATES_STALE_TEXT, Settings' words), under its lead. It is
    // shown, not announced: the fleet screen's one status region says it once (D-5124).
    describe('HaltBanner — a stale view says so (wave 19, R24(b))', () => {
      it('stale: one line under the lead, in the update plane\'s own sentence, hidden from assistive tech; fresh or absent: none', () => {
        render(<HaltBanner updates={view([failed()])} seq={1} onAcked={() => 2} stale />);
        expect(UPDATES_STALE_TEXT).toBe('The latest read failed — this is the last answer that landed.');
        const msgs = [...banner()!.querySelectorAll('.halt-banner-msg')].map((e) => e.textContent);
        expect(msgs).toEqual([HALT_LEAD_TEXT, UPDATES_STALE_TEXT]);
        expect(screen.getByText(UPDATES_STALE_TEXT)).toHaveAttribute('aria-hidden', 'true');
        cleanup();
        render(<HaltBanner updates={view([failed()])} seq={1} onAcked={() => 2} stale={false} />);
        expect(screen.queryByText(UPDATES_STALE_TEXT)).toBeNull();
        cleanup();
        mount(view([failed()]));
        expect(screen.queryByText(UPDATES_STALE_TEXT)).toBeNull();
      });
    });
    ```
  - `update-banner.test.tsx`: `import { UPDATES_POLL_MS, UPDATES_STALE_TEXT } from '../src/fleet/useUpdatesView';`. In the R15(b) describe, before `it('enables again on the poll after the ack, with no reason line'`, add:
    ```tsx
      it('wave 19, R24(b): a stale view says so beside the release line, injected or self-polled; Update all is unchanged', async () => {
        render(<UpdateBanner updates={view()} stale />);
        expect([...banner()!.querySelectorAll('.update-banner-msg')].map((e) => e.textContent)).toEqual([
          'v0.0.9 is out on stable — fleet and server are on v0.0.7.', UPDATES_STALE_TEXT,
        ]);
        expect(screen.getByText(UPDATES_STALE_TEXT), 'shown, not announced (D-5124)').toHaveAttribute('aria-hidden', 'true');
        expect(screen.getByRole('button', { name: 'Update all' }), 'staleness is said, never a gate').not.toBeDisabled();
        cleanup();
        render(<UpdateBanner updates={view()} />);
        expect(screen.queryByText(UPDATES_STALE_TEXT)).toBeNull();
        cleanup();
        vi.useFakeTimers();
        try {
          vi.spyOn(api, 'updates').mockResolvedValueOnce(view()).mockRejectedValueOnce(new Error('offline'));
          render(<UpdateBanner />);
          await act(async () => {});
          expect(screen.queryByText(UPDATES_STALE_TEXT), 'the first read landed').toBeNull();
          await act(async () => { await vi.advanceTimersByTimeAsync(UPDATES_POLL_MS); });
          await act(async () => {});
          expect(screen.getByText(UPDATES_STALE_TEXT)).toBeInTheDocument();
        } finally {
          vi.useRealTimers();
        }
      });
    ```
  - `fleet-host-banner.test.tsx`: `import { UPDATES_STALE_TEXT } from '../src/fleet/useUpdatesView';` after the `FleetHostBanner` import. At the end of the R15(c) describe, add:
    ```tsx
      // Centralised-update wave 19, R24(b): a later poll failed, so the versions and the remedy come from the last answer
      // that landed. The arm says so in the update plane's own sentence, and never vouches for auto on it.
      it('stale: the terminal verbs where auto would have been, then the update plane\'s own stale sentence', () => {
        render(<FleetHostBanner health={skewed} nodes={[movable('fleet', FLEET_V7), movable('server', SERVER_V9)]} intent={autoOn} stale />);
        expect(msg()).toBe('The two boxes run different builds. fleet v0.0.7 (bd2bf57a) · server v0.0.9 (2985b9d1). '
          + 'Run ccrc rollout from the deploying machine, or ccrc update on the lagging box, fleet box first. '
          + UPDATES_STALE_TEXT);
        expect(screen.getByText(UPDATES_STALE_TEXT, { exact: false, selector: '[aria-hidden="true"]' }),
          'shown, not announced (D-5124)').toBeInTheDocument();
      });

      it('stale with a halt: the halt, then the terminal, then the stale sentence; fresh says no stale sentence', () => {
        const fleet = { ...movable('fleet', FLEET_V7), update: { state: 'failed' as const, target: 'v0.0.9', startedAt: 1, detail: 'gate: unit not up' } };
        const { rerender } = render(<FleetHostBanner health={skewed} nodes={[fleet, movable('server', SERVER_V9)]} intent={autoOn} stale />);
        expect(msg()).toBe('The two boxes run different builds. fleet v0.0.7 (bd2bf57a) · server v0.0.9 (2985b9d1). '
          + 'Nothing moves until fleet is acknowledged — tap Ack on it in the halt banner, then run ccrc rollout from the '
          + 'deploying machine, or ccrc update on the lagging box, fleet box first. ' + UPDATES_STALE_TEXT);
        rerender(<FleetHostBanner health={skewed} nodes={[fleet, movable('server', SERVER_V9)]} intent={autoOn} stale={false} />);
        expect(msg()).not.toContain(UPDATES_STALE_TEXT);
        expect(msg()).toContain('auto-install then moves the lagging box.');
      });
    ```
  - `build-line.test.tsx`: `import { UPDATES_STALE_TEXT } from '../src/fleet/useUpdatesView';` after the `cssRule` import. First in `describe('BuildLine'`, add:
    ```tsx
      it('wave 19, R24(b): a stale note the caller passes is said after the server side, amber, hidden from assistive tech; none when absent', () => {
        const nodes = [node('fleet', stamp(SHA_A, 'v0.0.7')), node('server', stamp(SHA_A, 'v0.0.7'))];
        const { rerender } = render(<BuildLine health={remote()} nodes={nodes} staleNote={UPDATES_STALE_TEXT} />);
        expect(line()!.textContent).toBe(`fleet v0.0.7 · server v0.0.7 · ${UPDATES_STALE_TEXT}`);
        expect(screen.getByText(UPDATES_STALE_TEXT)).toHaveClass('build-line-next');
        expect(screen.getByText(UPDATES_STALE_TEXT), 'the caller announces it (D-5124)').toHaveAttribute('aria-hidden', 'true');
        rerender(<BuildLine health={remote()} nodes={nodes} staleNote={null} />);
        expect(line()!.textContent).toBe('fleet v0.0.7 · server v0.0.7');
        rerender(<BuildLine health={remote()} nodes={nodes} />);
        expect(line()!.textContent).toBe('fleet v0.0.7 · server v0.0.7');
      });
    ```
  - `fleet-screen.test.tsx`, as the last case of `describe('the halt on the fleet screen (programme wave 14, R15)'`:
    ```tsx
      // Centralised-update wave 19, R24(b): a later poll failed, so every update surface on the screen is showing the
      // last answer that landed, and each says so once, in the update plane's own sentence. Assistive tech hears it once,
      // from the screen's one status region (D-5124). A screen that never had an answer says nothing of the kind: there
      // is no "last answer" to mark.
      it('wave 19, R24(b): after a failed later poll every update surface says it is the last answer, once each, announced once; with no answer ever, none does', async () => {
        const until = async (check: () => void): Promise<void> => {   // the case above says why not waitFor
          for (let i = 0; i < 100; i++) {
            try { check(); return; } catch { /* not yet */ }
            await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
          }
          check();
        };
        const STALE = 'The latest read failed — this is the last answer that landed.';
        const count = (el: Element | null): number => (el?.textContent ?? '').split(STALE).length - 1;
        const exposed = (): number => {   // text nodes carrying the sentence outside any aria-hidden subtree
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n = 0;
          for (let t = w.nextNode(); t !== null; t = w.nextNode()) {
            if ((t.textContent ?? '').includes(STALE) && t.parentElement?.closest('[aria-hidden="true"]') == null) n++;
          }
          return n;
        };
        vi.spyOn(api, 'fleetHealth').mockResolvedValue({ mode: 'remote', connected: true, downSince: null, roster: 'agreed', build: 'skewed' });
        const updates = vi.spyOn(api, 'updates')
          .mockImplementationOnce(() => Promise.resolve(halted()))
          .mockImplementation(() => Promise.reject(new Error('offline')));
        render(<FleetScreen store={makeStore()} />);
        await screen.findByRole('button', { name: 'Ack fleet' });
        await until(() => expect(screen.getByText(/run different builds/i)).toBeInTheDocument());
        expect(count(document.body), 'the first read landed: nothing is stale yet').toBe(0);
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        await until(() => expect(updates).toHaveBeenCalledTimes(2));
        await until(() => expect(count(document.querySelector('.halt-banner'))).toBe(1));
        expect(count(document.querySelector('.banner')), 'the skew banner').toBe(1);
        expect(count(document.querySelector('.update-banner')), 'the release banner').toBe(1);
        expect(count(document.querySelector('.build-line')), 'the build line').toBe(1);
        expect(count(document.body), 'four surfaces shown, and the one announcement').toBe(5);
        expect(exposed(), 'said to assistive tech once').toBe(1);
        expect(screen.getByText(/run different builds/i), 'and the skew arm no longer vouches for auto').toHaveTextContent('then run ccrc rollout');
        cleanup();
        vi.spyOn(api, 'updates').mockRejectedValue(new Error('offline'));
        render(<FleetScreen store={makeStore()} />);
        await until(() => expect(document.querySelector('.build-line')).not.toBeNull());
        expect(count(document.body), 'no answer ever landed: nothing to call the last one').toBe(0);
      });
    ```
- [ ] **Step 3: Run, expect red** *(prototype, on the cases before the aria-hidden assertions)*:
  - `update-halt`, `halt-banner`, `update-banner`, `fleet-host-banner` and `build-line` together → `Tests  7 failed | 172 passed (179)`: `update-halt` 2 (the two `stale:` cases; `fresh (false) …` passes), `halt-banner` 1, `update-banner` 1, `fleet-host-banner` 2, `build-line` 1 (`expected 'fleet v0.0.7 · server v0.0.7' to be 'fleet v0.0.7 · server v0.0.7 · …'`).
  - `fleet-screen -t "wave 19"` → `1 failed | 101 skipped (102)` (`expected +0 to be 1`).
  
  The same files and counts are expected with the revised assertions, but the halt-banner total is now 180 with Task 3's third case *(revised, unmeasured)*.
- [ ] **Step 4: Implement.** Each `aria-hidden`, the `.sr-only` region, and BuildLine's `staleNote !== null` are *(revised, unmeasured)*.
  - `useUpdatesView.ts`, after `UpdatesFailure`:
    ```ts

    /** A later poll failed, so what a surface shows is the last answer that landed (`view` is kept, `failure` stands).
     *  The update plane's one sentence for it (wave 19, R24(b)), shown by every surface that reads this poll's kept
     *  view: the home screen's skew, halt and release banners and BuildLine, and announced once by the fleet screen's
     *  own status region (D-5124). Settings' `STALE_TEXT` spells the same words until its own fold imports this one
     *  (another run's claim holds that file). */
    export const UPDATES_STALE_TEXT = 'The latest read failed — this is the last answer that landed.';
    ```
  - `updateHalt.ts`:
    - the header's second and third lines become
      ```ts
      // programme wave 14, R15). Pure reads of FleetScreen's one /api/updates answer, with no poll of their own. Four
      // callers: the halt banner (HaltBanner.tsx), Update all (UpdateBanner.tsx), the skew arm (FleetHostBanner.tsx) and,
      // since wave 19 (R24(a)), Settings' release-row Install and per-node Update (screens/updates.tsx).
      ```
    - the autoArm comment's last line becomes (R26(d))
      ```ts
        // skew would widen, not close. `auto` only when every node ends on the SAME release tag. So one EXTRA untagged
        // inventory row (a hand-placed or unmeasured third node, with no desired tag and no release version) forces `cli`
        // too (wave 19, R26(d)). That is the safe direction: the terminal verbs are never a false promise that the
        // console will move the box.
      ```
    - `skewRemedy` becomes
      ```ts
      /** `stale` (wave 19, R24(b)): a later poll failed, so `nodes` and `intent` are the last answer that landed. A
       *  standing failure never vouches for auto: `then` (and so the arm) is `cli`. The halt is still said, because the
       *  Ack is still the door; only the promise of what moves after it is withdrawn. */
      export function skewRemedy(
        nodes: readonly NodeWire[] | null | undefined, intent: readonly UpdateIntentWire[] | null | undefined, stale = false,
      ): SkewRemedy {
        // An empty inventory needs no guard of its own: no node has a tag to move to, so autoArm answers `cli`.
        if (!Array.isArray(nodes)) return { kind: 'cli' };
        const halting = haltingNodes(nodes);
        const then = stale || nodes.some(leaseUnreadable) ? 'cli' : autoArm(nodes, intent);
        if (halting.length > 0) return { kind: 'halt', halting, then };
        return { kind: then };
      }
      ```
  - `HaltBanner.tsx`:
    - add `import { UPDATES_STALE_TEXT } from './useUpdatesView';`;
    - the signature becomes `export function HaltBanner({ updates: view, seq, onAcked, stale = false }: { updates: UpdatesView | null; seq: number; onAcked: () => number; stale?: boolean; })`, with `listRef` from Task 3 still first;
    - after the lead span:
      ```tsx
            {/* Wave 19, R24(b): a later poll failed, so these rows are the last answer that landed. Shown, not announced:
                the fleet screen's one status region says it (D-5124). */}
            {stale && <span className="halt-banner-msg" aria-hidden="true">{UPDATES_STALE_TEXT}</span>}
      ```
  - `UpdateBanner.tsx`:
    - add `UPDATES_STALE_TEXT` to the `./useUpdatesView` import;
    - the signature becomes `({ updates: injected, health = null, onMoved, stale: staleInjected = false }: { …; stale?: boolean; } = {})`;
    - after `const view = …`:
      ```tsx
        // Wave 19, R24(b): a later poll failed and the view is the last answer that landed — said, never a gate.
        const stale = injected === undefined ? polled.view !== null && polled.failure !== null : staleInjected;
      ```
    - after the halted span: `{stale && <span className="update-banner-msg" aria-hidden="true">{UPDATES_STALE_TEXT}</span>}`.
  - `FleetHostBanner.tsx`:
    - add `import { UPDATES_STALE_TEXT } from './useUpdatesView';`;
    - the props gain `stale = false` / `stale?: boolean;`;
    - the skew arm's remedy line becomes
      ```tsx
          // Wave 19, R24(b): `stale` — a later poll failed, so the versions and the remedy are the last answer that
          // landed. The remedy never vouches for auto then, and the arm ends with the update plane's own sentence,
          // shown but not announced (the fleet screen's status region says it once, D-5124).
          const remedy = skewRemedy(nodes, intent, stale);
      ```
    - the line `{stale && <span aria-hidden="true">{` ${UPDATES_STALE_TEXT}`}</span>}` goes after the remedy's closing `)}`, inside the `Banner`;
    - the header bullet's `` `ccrc update` from a terminal. `` gains: `While a later poll's failure stands` / `` (`stale`, wave 19, R24(b)) it never advises auto, and it ends with the `` / `update plane's own sentence for the last answer that landed.`
  - `ui/src/components/build-line.tsx`:
    - the docstring gains `` `staleNote` (centralised-update wave 19, R24(b)): the caller's sentence for "a later poll failed, this is the last answer that landed", said after the server side in the affix's amber and hidden from assistive tech, because the caller announces it once. The words are the caller's (this package imports no app copy); absent or null says nothing. ``;
    - the signature becomes
      ```tsx
      export function BuildLine({ health, nodes, staleNote = null }: {
        health: FleetHealth | null; nodes: readonly NodeWire[] | null; staleNote?: string | null;
      }): ReactNode {
      ```
    - after the server side:
      ```tsx
            {staleNote !== null && (
              <>
                <span className="build-line-sep"> · </span>
                <span className="build-line-next" aria-hidden="true">{staleNote}</span>
              </>
            )}
      ```
  - `FleetScreen.tsx`:
    - `import { UPDATES_STALE_TEXT, useUpdatesView } from '../fleet/useUpdatesView';`;
    - after `const updates = useUpdatesView();`:
      ```tsx
        // Wave 19, R24(b): a later poll failed and the view is the last answer that landed; every reader below says so.
        const stale = updates.view !== null && updates.failure !== null;
      ```
    - `stale={stale}` on `FleetHostBanner`, `HaltBanner` and `UpdateBanner`, and `staleNote={stale ? UPDATES_STALE_TEXT : null}` on `BuildLine`;
    - just before `BuildLine`:
      ```tsx
            {/* Wave 19, D-5124: the four surfaces show the stale sentence; this one region announces it, once. */}
            <div className="sr-only" role="status">{stale ? UPDATES_STALE_TEXT : null}</div>
      ```
  - `literal-census.test.ts`: the registered entry's comment and the first lines of its reason become
    ```ts
      // One NEXT, inside the entry below: Settings' own copy of the update plane's sentence (centralised-update wave 19).
      'The latest read failed — this is the last answer that landed.':
        'TWO SECTIONS, agreeing today. The UPDATE plane\'s sentence for a poll that '
        + 'failed after one landed is `UPDATES_STALE_TEXT` (fleet/useUpdatesView.ts, '
        + 'wave 19), said by every update surface on the home screen. NEXT: '
        + '`SettingsScreen`\'s `STALE_TEXT` still spells it while another run\'s claim '
        + 'holds that file; its fold imports the fleet constant. '
        + '`STALL_SECTION_TEXT.stale` (shared/api.ts) is the stall-watch section\'s '
    ```
    (the rest of the reason is unchanged).
- [ ] **Step 5: Run:**
  - `update-halt` (**49**), `halt-banner` (**51**), `update-banner` (**33**), `fleet-host-banner` (**29**), `build-line` (**18**), `literal-census` (**4**), `markup-census` (**10**), `fleet-screen` (**102**), `use-updates-view` (**38**), `ui-package-boundary` (**24**), `design-system-boundary` (**15**), `contrast` (**265**);
  - `./node_modules/.bin/tsc --noEmit -p .` in `pwa/` and `./node_modules/.bin/tsc --noEmit` in `ui/`, both clean.
  
  *(prototype: the first seven gave `Tests  193 passed (193)` with `halt-banner` at 50, and 51 is revised, unmeasured. `fleet-screen -t "wave 19"` 1 passed. Both `tsc` runs clean.)*
- [ ] **Step 6: Mutation table** *(prototype for T5-1 to T5-8, on the pre-revision cases; T5-7's measured message changes with D-5124; T5-9 to T5-11 revised, unmeasured)*. Each row's commands are in the block under the table: the patterns contain `|`, which a table cell cannot carry.

  | Row | File | Mutation | Commands (block below) | Measured red |
  |---|---|---|---|---|
  | T5-1 | `updateHalt.ts` | `const then = nodes.some(leaseUnreadable) ? 'cli' : …` (no `stale` term) | A | 5 (`update-halt` 2 `stale:` cases; `fleet-host-banner` 2 `stale …` cases; `fleet-screen` 1) |
  | T5-2 | `FleetScreen.tsx` | `const stale = false;` | B | 1 |
  | T5-3 | `HaltBanner.tsx` | delete the `{stale && …}` line | C | 2 (`stale: one line under the lead …`; `fleet-screen` 1) |
  | T5-4 | `UpdateBanner.tsx` | the standalone arm `injected === undefined ? false : staleInjected` | D | 1 (`update-banner`'s case, the self-polled half); `fleet-screen` green (it injects) |
  | T5-5 | `FleetHostBanner.tsx` | delete the `{stale && <span aria-hidden="true">…</span>}` line | A (less `update-halt`) | 3 (`fleet-host-banner` 2; `fleet-screen` 1) |
  | T5-6 | `build-line.tsx` | delete the `.build-line-next` stale span | E | 2 (`build-line` 1; `fleet-screen` 1) |
  | T5-7 | `FleetScreen.tsx` | `const stale = updates.failure !== null;` (no `view !== null`) | B | 1 (`no answer ever landed: nothing to call the last one`; prototype message `expected 2 to be +0`, expected `expected 3 to be +0` with D-5124's region, unmeasured) |
  | T5-8 | `useUpdatesView.ts` | the constant's `—` becomes `:` | F | 2 (`halt-banner`'s exact-text pin; `fleet-screen` 1); `literal-census` green (the sentence is still in two files) |
  | T5-9 | `build-line.tsx` | the `staleNote !== null &&` guard dropped (the fragment always renders) | E | expected 1 (`build-line`: `staleNote={null}` renders a trailing ` · `) *(revised, unmeasured)* |
  | T5-10 | `FleetScreen.tsx` | the `.sr-only` region renders `{null}` always | B | expected 1 (`fleet-screen`: `four surfaces shown, and the one announcement`, 4 for 5; or `said to assistive tech once`, 0 for 1) *(revised, unmeasured)* |
  | T5-11 | `HaltBanner.tsx` | the stale span loses `aria-hidden="true"` | C | expected 2 (`halt-banner`'s `aria-hidden` assertion; `fleet-screen`'s `said to assistive tech once`, 2 for 1) *(revised, unmeasured)* |

  ```bash
  # (pwa) A: T5-1, T5-5
  ./node_modules/.bin/vitest run test/update-halt.test.ts -t 'wave 19|stale'
  ./node_modules/.bin/vitest run test/fleet-host-banner.test.tsx -t 'wave 19|stale'
  ./node_modules/.bin/vitest run test/fleet-screen.test.tsx -t 'wave 19|stale'
  # B: T5-2, T5-7, T5-10
  ./node_modules/.bin/vitest run test/fleet-screen.test.tsx -t 'wave 19'
  # C: T5-3, T5-11
  ./node_modules/.bin/vitest run test/halt-banner.test.tsx -t 'wave 19'
  ./node_modules/.bin/vitest run test/fleet-screen.test.tsx -t 'wave 19'
  # D: T5-4
  ./node_modules/.bin/vitest run test/update-banner.test.tsx -t 'wave 19'
  ./node_modules/.bin/vitest run test/fleet-screen.test.tsx -t 'wave 19'
  # E: T5-6, T5-9
  ./node_modules/.bin/vitest run test/build-line.test.tsx -t 'wave 19'
  ./node_modules/.bin/vitest run test/fleet-screen.test.tsx -t 'wave 19'
  # F: T5-8
  ./node_modules/.bin/vitest run test/halt-banner.test.tsx -t 'wave 19|literal'
  ./node_modules/.bin/vitest run test/fleet-screen.test.tsx -t 'wave 19|literal'
  ./node_modules/.bin/vitest run test/literal-census.test.ts
  ```
  Each filtered run must report at least one test. An attack pass measured that `-t "wave 19\|stale"` (the Markdown-escaped form) skips all 29 `fleet-host-banner` tests, while `-t 'wave 19|stale'` runs 2.
- [ ] **Step 7: Commit:** `feat(update): every home-screen update surface says when it shows the last answer, announced once; the skew arm never vouches for auto on it (wave 19, R24(b), R26(d); D-5119, D-5120, D-5121, D-5124)`.

### Task 6 (Settings, claim 1392 at drafting; last, separable): R24(d)'s Settings line, and Settings' stale sentence folded (D-5122)

**Files:** `pwa/src/screens/SettingsScreen.tsx`, `pwa/test/update-halt-controls.test.tsx`, `server/test/update-move.test.ts`, `pwa/test/literal-census.test.ts`.

- [ ] **Step 1: Re-read the claims, then take claim B.** First read the live claims. If any live claim other than this wave's names `pwa/src/screens/SettingsScreen.tsx` (claim 1392 did at drafting, and had ended by 23:47 UTC), or if taking claim B answers 409, **cut this task**:
  - commit no code here;
  - leave Task 2's census and Task 5's literal-census reason as they are, since both are correct for that tree;
  - append to D-5122's entry, keeping its first line (the subject) unchanged, the line `  - **Cut:** claim <id> stood at <UTC>; a later fold carries it and cites this number, never redefines it.`, committed with the plan;
  - say "Task 6 cut: claim <id> stands" in the wave-done.
  ```bash
  ~/.local/bin/ccrc-api claims list --project ccrc-pwa 2>/dev/null | jq -r '.claims[] | select(.state == "live") | "\(.id) \(.paths[])"' | grep -F ' pwa/src/screens/SettingsScreen.tsx'   # nothing but this wave's own
  # take claim B: Step 0's shape, paths ["pwa/src/screens/SettingsScreen.tsx"], intent "wave 19 Task 6: Settings asks carriesUpdateGate"; record CLAIM_B
  cd pwa
  grep -nF "  AUTO_MODES, FLEET_SCOPE, NOTIFY_MODES, UPDATE_CHANNELS, UPDATE_GATE_CAP, isNotifyMode," src/screens/SettingsScreen.tsx   # 29 at 0b3ff2f62 (27 at 518789ad0)
  grep -nF "  return nodes.filter((n) => !(Array.isArray(n.caps) && n.caps.includes(UPDATE_GATE_CAP)));" src/screens/SettingsScreen.tsx   # 114 (111)
  grep -nF "const STALE_TEXT = 'The latest read failed — this is the last answer that landed.';" src/screens/SettingsScreen.tsx   # 104 (101)
  grep -nF '      {stale && <p className="settings-note">{STALE_TEXT}</p>}' src/screens/SettingsScreen.tsx   # 681 (675)
  grep -nF "import { isPlaceableInstant, useUpdatesView, type UpdatesPoll } from '../fleet/useUpdatesView';" src/screens/SettingsScreen.tsx   # 42
  grep -n "UPDATE_GATE_CAP" src/screens/SettingsScreen.tsx   # 29 and 114 only
  ```
  Run 400's #384 landed before this plan's re-measure. Another Settings change may land first, so the quotes win over the numbers.
- [ ] **Step 2: Write the pins first (red).** In `update-halt-controls.test.tsx`, add `import { readFileSync } from 'node:fs';` and `import path from 'node:path';` above the `vitest` import. Before `describe('Settings\' Ack keeps focus …`, add:
  ```tsx
  // Wave 19's claim-gated fold (R24(d), and R24(b)'s Settings half): the screen asks the L0 gate read and says the
  // update plane's one stale sentence, rather than spelling either itself. Read from source: the screen's own suite is
  // another run's to edit, and behaviour is pinned there already (its gated fixtures and T7_STALE).
  describe('SettingsScreen asks the shared reads (wave 19, R24(d))', () => {
    const settingsSrc = readFileSync(path.join(import.meta.dirname, '..', 'src', 'screens', 'SettingsScreen.tsx'), 'utf8');
    it('autoGateMissing asks carriesUpdateGate, keeping its Array.isArray guard', () => {
      expect(settingsSrc).toContain('nodes.filter((n) => !(Array.isArray(n.caps) && carriesUpdateGate(n.caps)))');
      expect(settingsSrc).not.toMatch(/caps\.includes\(UPDATE_GATE_CAP\)/);
    });
    it('the stale line is UPDATES_STALE_TEXT, imported, not a copy', () => {
      expect(settingsSrc).toContain('{stale && <p className="settings-note">{UPDATES_STALE_TEXT}</p>}');
      expect(settingsSrc).not.toContain("'The latest read failed — this is the last answer that landed.'");
    });
  });
  ```
  In `server/test/update-move.test.ts`, the gate census case becomes:
  ```ts
    it('the gate word is tested by includes(UPDATE_GATE_CAP) on a code line only in shared/update-move.ts', () => {
      // SettingsScreen.tsx's `autoGateMissing` asks `carriesUpdateGate` too since wave 19's claim-gated fold (R24(d)).
      const GATE_TEST = /includes\(UPDATE_GATE_CAP\)/;
      expect(GATE_TEST.test('n.caps.includes(UPDATE_GATE_CAP)'), 'CONTROL: the pattern sees the copy').toBe(true);
      expect(ALL.filter((f) => GATE_TEST.test(codeOnly(f))).map(rel).sort()).toEqual(['shared/update-move.ts']);
    });
  ```
- [ ] **Step 3: Run, expect red** *(prototype)*:
  - `update-halt-controls` → `Tests  2 failed | 8 passed (10)` (both new cases). With Task 4's three revised cases the totals are `2 failed | 11 passed (13)` *(revised, unmeasured)*.
  - Server `update-move` → `Tests  1 failed | 20 passed (21)` (the gate census).
- [ ] **Step 4: Implement** in `SettingsScreen.tsx`:
  - the `shared/api` value import drops `UPDATE_GATE_CAP`, and below it goes `import { carriesUpdateGate } from '../../../shared/update-move';`;
  - `import { UPDATES_STALE_TEXT, isPlaceableInstant, useUpdatesView, type UpdatesPoll } from '../fleet/useUpdatesView';`;
  - delete `STALE_TEXT` and its one-line docstring (`/** A later poll failed: what is shown is the last answer that landed, and it says so. */`);
  - `autoGateMissing`'s return becomes `return nodes.filter((n) => !(Array.isArray(n.caps) && carriesUpdateGate(n.caps)));`, and its `Array.isArray` comment stays;
  - the stale line:
    ```tsx
          {/* A later poll failed: the update plane's one sentence for the last answer that landed (wave 19, R24(b)). */}
          {stale && <p className="settings-note">{UPDATES_STALE_TEXT}</p>}
    ```
  
  In `literal-census.test.ts`, the entry's comment and the first lines of its reason become:
  ```ts
    // No NEXT. The one entry below is argued, not deferred.
    'The latest read failed — this is the last answer that landed.':
      'TWO SECTIONS, TWO COPIES, agreeing today. `UPDATES_STALE_TEXT` '
      + '(fleet/useUpdatesView.ts) is the UPDATE plane\'s sentence for a poll that '
      + 'failed after one landed, said by Settings and every update surface on the '
      + 'home screen (centralised-update wave 19); '
      + '`STALL_SECTION_TEXT.stale` (shared/api.ts) is the stall-watch section\'s '
  ```
- [ ] **Step 5: Run:** `update-halt-controls` (**13**), `settings-screen` (**189**, green: `T7_STALE` reads the same words), `literal-census` (**4**), `halt-banner` (**51**); server `update-move` (**21**). *(prototype: the four pwa files gave `Tests  253 passed (253)` with 10 and 50, and 13 and 51 are revised, unmeasured; `update-move` 21 passed.)*
- [ ] **Step 6: Mutation table** *(prototype)*.

  | Row | Mutation in `SettingsScreen.tsx` | Command(s) | Measured red |
  |---|---|---|---|
  | T6-1 | `&& n.caps.includes('update-gate')` for `&& carriesUpdateGate(n.caps)` | `update-halt-controls`; `settings-screen` | 1 (`autoGateMissing asks carriesUpdateGate …`); `settings-screen` 189 green (same behaviour) |
  | T6-2 | the stale line spells the quoted sentence again | `update-halt-controls`; `literal-census` | 1 (`the stale line is UPDATES_STALE_TEXT …`); `literal-census` 4 green (registered) |
  | T6-3 | `&& n.caps.includes(UPDATE_GATE_CAP)` for `&& carriesUpdateGate(n.caps)` | server `update-move` | 1 (`the gate word is tested by includes(UPDATE_GATE_CAP) …`) |
- [ ] **Step 7: Commit:** `refactor(update): Settings asks carriesUpdateGate and says the update plane's stale sentence (wave 19, R24(d); D-5122)`.

### Task 7 (`shared/api.ts`, claim 1390 at drafting; last, separable): R26(c), the `PROVENANCE_DETAIL_PREFIX` docstring (D-5123)

**Files:** `shared/api.ts`.

- [ ] **Step 1: Re-read the claims, then take claim C.** First read the live claims. If any live claim other than this wave's names `shared/api.ts` (claim 1390 did at drafting, and had ended by 23:47 UTC; run 360 re-takes its claims every few hours), or if taking claim C answers 409, **cut this task**:
  - append to D-5123's entry, keeping its first line unchanged, the line `  - **Cut:** claim <id> stood at <UTC>; a later fold carries it and cites this number, never redefines it.`, committed with the plan;
  - say so in the wave-done.
  ```bash
  ~/.local/bin/ccrc-api claims list --project ccrc-pwa 2>/dev/null | jq -r '.claims[] | select(.state == "live") | "\(.id) \(.paths[])"' | grep -F ' shared/api.ts' | grep -vF 'shared/api.ts.'   # nothing but this wave's own
  # take claim C: Step 0's shape, paths ["shared/api.ts"], intent "wave 19 Task 7: PROVENANCE_DETAIL_PREFIX docstring"; record CLAIM_C
  grep -nF "export const PROVENANCE_DETAIL_PREFIX = 'provenance:';" shared/api.ts   # 9350 at 0b3ff2f62 (9337 at 518789ad0)
  grep -nF " *  on the tag, recorded beside the row (\`node_release_refusals\`, D-3378) and NOT a halt. Spelled ONCE: \`isHalting\`" shared/api.ts   # 9347 (9334)
  wc -l shared/api.ts   # 10080 at 0b3ff2f62 (9968 at 518789ad0); record it
  ```
  Run 360's branch had `shared/api.ts` hunks at about 3349 and 9966 onward on 2026-10-16, away from 9347-9349. Re-measure them as Task 2 Step 1 does if run 360 is still unlanded.
- [ ] **Step 2: Implement.** Replace the docstring's last three lines (9347 to 9349 at `0b3ff2f62`) with three lines:
  ```ts
   *  on the tag, recorded beside the row (`node_release_refusals`, D-3378) and NOT a halt. Spelled ONCE: the halt rule
   *  `isHaltingUpdate` (shared/update-move.ts; `isHalting`, `rowHalts` and the PWA's `haltingNodes` ask it) reads it in
   *  JS, the store's `haltingRowSql` in SQL (D-3412), and `sweepPlanFor` (update/inventory.ts) decides the refusal. */
  ```
  If Task 2 is not on the branch, write `` `isHalting` and the PWA's `haltingNodes` ask it `` instead.
- [ ] **Step 3: Check:**
  - `wc -l shared/api.ts` equals Step 1's count, and `export const PROVENANCE_DETAIL_PREFIX` is still on Step 1's line *(prototype: 9968 and line 9337 at `518789ad0`; 10080 and line 9350 on the tree merged with `0b3ff2f62`)*.
  - No test pins this docstring: `grep -rn "Spelled ONCE: \`isHalting\`"` over the tree finds only the old text.
  - Run server `update-move` (**21**) and `single-definition` (at `main`'s count: **585** at `0b3ff2f62`; claim 1436's file, run only).
- [ ] **Step 4: Commit:** `docs(update): PROVENANCE_DETAIL_PREFIX's docstring names isHaltingUpdate as its JS reader (wave 19, R26(c); D-5123)`.

### Task 8: The gate and the PR

- [ ] **Step 1: Start from a clean tree, and absorb `main` only on clause 16.** *(revised, unmeasured)*
  ```bash
  git status --porcelain
  git fetch origin
  git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD; echo "merge-tree rc=$?"
  ~/.local/bin/ccrc-api claims list --project ccrc-pwa 2>/dev/null   # then the derived scope check (Global Constraints)
  ```
  - **rc 1** (a tree id on the first line, then the conflicted paths): the branch conflicts, which clause 16 licenses, once per PR. Absorb with `git merge --no-edit origin/HEAD` (never a rebase, a force-push or `update-branch`), resolve, and record `git show --remerge-diff HEAD`.
  - **rc 0:** no absorption. Measure what `main` changed under this wave without merging:
    ```bash
    git diff HEAD...origin/HEAD -- shared/update-move.ts pwa/src/fleet/updateHalt.ts pwa/src/fleet/useUpdatesView.ts \
      pwa/src/fleet/HaltBanner.tsx pwa/src/screens/updates.tsx ui/src/components/build-line.tsx server/src/coord/store.ts \
      pwa/src/screens/SettingsScreen.tsx shared/api.ts
    ```
  - Any other rc is unmeasured and licenses nothing: report it.
  - **Stop and report** if `main` changed `isHaltingUpdate` or `carriesUpdateGate`, `useUpdatesView`'s kept-view rule, `skewRemedy`, the Ack in `HaltBanner.tsx` or `updates.tsx`, `BuildLine`'s signature, or `store.ts`'s `rowHalts`.
  - If run 360, or any other change to `SettingsScreen.tsx` or `shared/api.ts`, landed since Tasks 6 and 7 ran, re-run their Step 1 anchor checks against `git show origin/HEAD:<file>`.
- [ ] **Step 2: Dependencies.** Run `npm ci` in `server/`, `pwa/`, `ui/` and `agent/` wherever `node_modules` is absent.
- [ ] **Step 3: Suites, one file per call, in the foreground, with a timeout of at least 600000 ms.** The counts were measured on the prototype with every task applied, at `518789ad0` and again on the tree merged with `0b3ff2f62`, where every edited and named file's count held. Counts the revision changed are marked.
  - `pwa`:
    - `update-halt-controls` (**13**, or **11** if Task 6 is cut; *revised, unmeasured*: prototype 10 / 8), `halt-banner` (**51**; *revised, unmeasured*: prototype 50), `update-halt` (**49**), `update-banner` (**33**), `fleet-host-banner` (**29**), `build-line` (**18**), `fleet-screen` (**102**), `settings-screen` (**189**), `literal-census` (**4**), `markup-census` (**10**), `use-updates-view` (**38**), `update-move-sheet` (**42**), `contrast` (**265**), `ui-package-boundary` (**24**), `design-system-boundary` (**15**);
    - then the whole package: `./node_modules/.bin/vitest run`. *(prototype at `518789ad0`: `Test Files  169 passed (169)`, `Tests  5011 passed (5011)`, 255 s at load 27. On the tree merged with `0b3ff2f62`, at load 30 to 50: `Tests  5 failed | 6616 passed (6621)`, each red `Test timed out in 5000ms` in a file this wave does not touch — `drawer-paste`, `lifecycle-ui`, `pr-sheet`, `session-pickers`, `wrap-screen-golden` — and all five files green when re-run in isolation, 179 and 1041 passed. The revision adds 5 tests, 4 if Task 6 is cut.)* Re-run any timeout in isolation before calling it a break;
    - `./node_modules/.bin/tsc --noEmit -p .`, and in `ui/` `./node_modules/.bin/tsc --noEmit`;
    - `./node_modules/.bin/vite build --outDir "$SCRATCH/dist" --emptyOutDir` (green; never into the tree);
    - `node design/contrast-check.mjs` (`ALL 3504 PASS` on the merged tree).
  - `server`:
    - edited: `update-inventory` (**90**), `update-move` (**21**), `update-resolve` (**48**);
    - run, not edited: `update-store-nodes` (**43**; Risk notes), `update-routes` (**41**), `update-dispatch` (**92**), `update-auto-dispatch` (**15**), `update-apply-routes` (**53**), `mail-hardening` (**18**), `update-killed-arms` (**35**), `update-writer-groups` (**20**), `update-intent-cross-side` (**9**), `crossrepo-prose` (**17**), `update-projection` (**21**), `update-catalogue` (**114**), `ledger-sweep` (**20**), `box-token-census` (**37**; claim 1419's file, run only), `inventory-identity` (**11**, new on `main`), `single-definition` (**585** at `0b3ff2f62`, `main`'s count; claim 1436's file, run only), `typecheck-tests` (**12**);
    - `./node_modules/.bin/tsc --noEmit -p .`.
  
  *(prototype: every server file above was green except `update-store-nodes`' heir-guard case, which timed out at 20 s under load 30, as it does on the shipped body.)* If a known load flake reds (CLAUDE.md's list, which includes `typecheck-tests`), or the heir-guard case reds, re-run it IN ISOLATION before calling it a break.
- [ ] **Step 4: The ledger and scope guards, last.**
  ```bash
  git fetch origin
  cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts     # 31
  ./node_modules/.bin/vitest run test/dtbd.test.ts                            # 1
  ./node_modules/.bin/vitest run test/topology-clean.test.ts                  # 55
  cd ..
  # the derived scope check (Global Constraints): it prints NOTHING; any line is a live-claim collision — stop, never push
  git diff --stat origin/HEAD...HEAD     # exactly File structure's New and Changed lists (less a cut task's files)
  ```
  Then the D-number check. Every D-token the branch adds must either be one of 5115 to 5129 and defined in this plan, or already be on `origin/HEAD`. Block and reserve numbers are checked for a definition BEFORE the on-main skip. The check prints nothing. *(revised, unmeasured: the ranges)*
  ```bash
  PLAN=docs/superpowers/plans/2026-10-15-centralised-update-w19-pwa-server-residue.md
  git diff origin/HEAD...HEAD | grep '^+' | grep -oE '\bD-[0-9]+\b' | sort -u > "$SCRATCH/dnums"
  while read -r d; do
    case "${d#D-}" in
      511[5-9]|512[0-9]) grep -qE "^- \*\*$d\*\* — " "$PLAN" || echo "UNDEFINED $d"; continue ;;
      513[0-4])          echo "BLOCK NUMBER PAST THE RESERVE: $d"; continue ;;
    esac
    git grep -qwF -e "$d" origin/HEAD -- docs/superpowers && continue          # cited as it stands
    echo "OUTSIDE THE BLOCK OR THE RESERVE: $d"
  done < "$SCRATCH/dnums"
  ```
- [ ] **Step 5: The PR,** from the workspace branch.
  - **Its first paragraph says:**
    - Settings' Install and per-node Update now wait while a node halts the fleet, and say why in the home screen's own Update all sentence, only where it gates a control. Roll back stays offered;
    - every update surface on the home screen now says when it is showing the last answer that landed, in Settings' words, announced to assistive technology once, and the skew banner never promises auto on such a view;
    - the store's JS halt and the resolver's gate read now ask the L0 predicates, with no behaviour change;
    - a focused Ack that disables keeps focus in its row, and on the halt banner focus goes to the list when that row leaves;
    - the stable flake in `update-inventory.test.ts` is deterministic;
    - which of Tasks 6 and 7 landed, and which were cut to a later fold because a claim stood;
    - the server bundle carries the PWA to the server box on the next release, by auto.
  - **The body has** one section per task, carrying D-5115 to D-5124 by number, the B5 measurement (28 of 150 red before, 0 of 150 after, under load), and the mutation table's measured results.
  - **Public repo.** Scan the body and every commit message before posting: no hostnames, usernames, absolute or home paths, lane or account names, other projects' names, private repos or ticket links. Refer to other ccrc work by its GitHub `#n`, and to claims and runs by number.
  - **Links:** the plan and the files as GitHub `blob/main` URLs built from `git remote get-url origin`, with the PR's `/files` view beside each until the merge. Never a docserver URL.
  - The body is hand-written and ends with the attribution line the session's instructions give.
  - Every commit's author and committer are the noreply identity: check with `git log --format='%an <%ae> | %cn <%ce>' origin/HEAD..HEAD`.
  - **After CI starts,** read the PR's `select tests` summary. CI runs the server tests a change can affect, sharded behind the required `test (server)`, and runs `test (pwa)`, `test (agent)` and `build-pwa` in full. The summary must list `update-inventory`, `update-move`, `update-resolve`, `update-store-nodes` and `single-definition`. If one is missing, run `gh workflow run ci.yml --ref <branch> -f mode=full` and name that run in the wave-done.
- [ ] **Step 6: The wave-done, in the same turn as the push.** It opens with clause 15's `suite:` line (and `failure:` only when a check failed), then carries:
  - the tip sha, the PR number, and the clause-16 probe's rc, with the remerge-diff result if it absorbed;
  - claims A, B and C by id; which of Tasks 6 and 7 landed or were cut; and the claims read that decided it;
  - each suite's count, and the load;
  - every mutation row (T1-1 … T6-3), with its measured red set against the listed set and the assertion that fired; rows marked *(revised, unmeasured)* say "measured: …" beside "expected: …";
  - any reserve number spent, defined in this plan in the commit that cites it, and any `D-TBD-<slug>` past 5129, named in this mail only.

## Readings (for the coordinator to rule; each was chosen where no ruling decided it)

1. **The reason line's words on Settings.** `updateAllHaltedText` says "Update all waits … tap Ack on it in the halt banner". On Settings, the Ack is also on the node's own row, and the line sits beside Install and per-node Update, not Update all.
   - (a) As built: verbatim, as the 22:11 entry rules ("reusing updateAllHaltedText verbatim").
   - (b) `UPDATE_ERROR_TEXT.halted` (`pwa/src/lib/api.ts`, D-4268), which names both places the Ack is. It is also shipped, so it adds no new string.

   **Recommended: (a)**, as ruled. (b) is the better fit if the operator wants the Settings line to name the row's own Ack, and it is a one-line change in `haltedReason`.
2. **Roll back while a node halts.** The dispatcher refuses every move while any node halts, rollbacks included, and the single-node route answers `409 halted`. The items name Install and Update only, so the release row's Roll back direction and each node's Roll back stay enabled, now pinned (T4-8, T4-9). A tap there gets the `halted` sentence (D-4268) as a toast or in the sheet. **Recommended: as built**, plus a residue item if the operator wants Roll back gated too. That would need its own reason sentence, because "Update all waits" would be wrong beside Roll back.
3. **The line once per list, and only where it gates.** On a halted fleet, Settings shows the reason above Releases when some release row is an Install, and above Nodes when some node has a pending Update. So it can appear twice. Each list's buttons describe a line in their own list, and each list renders on its own. The alternative is one line at the top of the section, passed down. **Recommended: as built.**
4. **Per-node Update on a healthy node while another halts.** The single-node route refuses it (`singleNodeMove` passes the real fleet gate; Review Focus 1), so disabling it matches the server. Only `{all: true}` writes a request for a non-halting row during a halt (`NO_HALT`), and that request moves after the ack. **Recommended: as built.**
5. **How many stale sentences the home screen shows, and how many it announces.** Up to four surfaces show it at once (skew, halt, release banner, BuildLine), each only when that surface speaks; BuildLine always speaks in remote mode.
   - All four are polite live regions, so without D-5124 a screen-reader user would hear the sentence up to four times on each failing poll, and again on a flapping link.
   - (a) As built: each surface marks itself visually (the residue's "mark it on all of them at once"), and one `.sr-only` region announces it once (D-5124). It cannot be BuildLine's region, because BuildLine is absent in local mode.
   - (b) One visible line only, on BuildLine, with no announcement in local mode.
   - On a phone, the sticky skew banner grows by one or two lines while it already carries the halt-and-cli remedy.

   **Recommended: (a).** (b) is a one-commit change if the operator finds four visible copies too loud.
6. **Staleness gates nothing.** Ack, Update all and Install stay enabled on a stale view. `ackNode` acks any settled row and clears its request. The halt banner's per-lease hold covers a double tap, not a stale view. **Recommended: as built (said, never a gate).** A gate would be a new residue item with its own design.
7. **BuildLine's class.**
   - (a) As built: reuse `.build-line-next` (amber, on the same ground, already in `design/audit.mjs` and `contrast.test.ts`).
   - (b) A new `.build-line-stale` rule in `ui/src/components/build-line.css`, with an `INHERITED_GROUNDS` entry and a `contrast.test.ts` row.

   **Recommended: (a).** The colour is the same decision ("something to note, not a fault"), and (b) costs three files for a name.
8. **The stale skew arm** keeps its halt sentence, with the terminal after the ack (D-5120). The alternative reads "answers cli" as dropping the halt arm too. **Recommended: as built.**
9. **`not-configured` with a kept view** reads as stale, as Settings already does (`stale={failure !== null}`). **Recommended: keep the two alike.**
10. **No stylesheet rule for the focused row or list.** After a keyboard-initiated Ack, the browser draws base.css's global `:focus-visible` ring on the row, or on the halt banner's list after its row leaves. On the halt banner that is the accent ring on the attention tint, which the contrast audit does not measure. The alternative is `outline: none` on `.halt-banner-node:focus`, `.halt-banner-list:focus` and `.settings-node:focus`, as `.bucket-head-label:focus` does in `fleet.css`. **Recommended: as built**, because the ring shows where focus went. Measure it in the review if the operator asks.
11. **Focus when the whole halt banner unmounts.** Task 3 now covers a row leaving while the banner stays: focus goes to the list (D-5118). When the last halting row's Ack lands, the poll after the clean 200 unmounts the whole banner, and focus falls to `<body>`. A refused Ack re-arms its button while focus stays on the row. **Recommended: out of scope**, with a residue item if wanted (a screen-level focus target after the banner leaves).
12. **R27(a): remove, not pin** (D-5117). Pinning would add cells for `1.5` and `Infinity`, which no producer returns. BuildLine's `staleNote !== ''` is dropped for the same reason (D-5121). **Recommended: remove.**
13. **B5's shape** (D-5115). The alternatives:
    - (a) fake timers, plus a barrier before `advanceTimersByTimeAsync(50)`;
    - (b) a budget of about 1000 ms and a longer test timeout, which is not a bound, and slower;
    - (c) an injectable deadline in `InventoryDeps`, a production seam added for a test.

    **Recommended: the in-memory io, as built.**
14. **The heir-guard case's timeout** in `update-store-nodes.test.ts` (Risk notes) reds by load at 20 s on the shipped body too. **Recommended: a residue item for the stable path**, beside B5's class; not this wave's.
15. **Tasks 6 and 7 when their claims stand.** They are cut to a later fold (the 22:11 entry's rule), and each keeps its D-entry with a **Cut:** line, never deleted and never redefined. The interim tree is consistent: Task 2's gate census lists `SettingsScreen.tsx` as a holder, and literal-census's reason names the pending Settings fold. **Recommended: as the entry rules.**
16. **A poll-driven disable of a focused Install or Update.** This wave's new gate means a keyboard user resting on Install or a node's Update loses focus to `<body>` when a background poll brings a halt. `keepFocusInRow` runs only in a tap handler. The fix shape is a `useLayoutEffect` keyed on the halted flag in `ReleaseItem` and `NodeItem` that moves focus to the row when the now-disabled button is `document.activeElement`. The release row would need `tabIndex={-1}` too. **Recommended: a residue item**, the R26(a) class, not built here (Not in this wave).

## Coordinator rulings on this plan's readings (2026-10-16)

The coordinator ruled every reading as recommended, except where a line below says otherwise.

- **Readings 1 to 10, 12, 13 and 15:** as recommended. Reading 1 keeps `updateAllHaltedText` verbatim (a). Reading 5
  keeps four visible copies and one announcement (a, D-5124). Reading 7 reuses `.build-line-next` (a). Reading 12
  removes the sub-term (D-5117). Reading 13 keeps the in-memory io.
- **Readings 11, 14 and 16:** not built here. Each becomes a residue item in the programme ledger: focus when the
  whole halt banner unmounts (11), the heir-guard case's load timeout (14), and a poll-driven disable of a focused
  Install or Update (16).
- **D-5124:** confirmed inside the issued block. The worker's reserve is numbers 5125 to 5129, and the coordinator holds
  5130 to 5134, both written bare until defined.
- **The base moved.** This plan was drafted at `518789ad0`. `main` is now `0b3ff2f62`: #384 changed
  `pwa/src/screens/SettingsScreen.tsx` (+12), `pwa/test/settings-screen.test.tsx`, `pwa/test/markup-census.test.ts`
  (+16), `server/src/coord/store.ts` (+115), `server/src/update/inventory.ts` (+70, in `sweepOwn` and `sweepFleet`'s
  budget path) and `shared/api.ts` (+136). Before each task, re-measure its anchors by their quoted text at the
  dispatch base, and re-run Task 1's red step against the new `inventory.ts` before trusting its mechanism.
- **Claims at dispatch.** Claim 1392 has ended, so Task 6 proceeds; re-measure `SettingsScreen.tsx` first, because
  #384 edited it. Claim 1474 (run 360) now holds `server/src/coord/store.ts`, and claim 1471 (run 360) holds
  `shared/api.ts`. So Task 2's `store.ts` half (`rowHalts`) and Task 7 run only if the coordinator mails the holder's
  consent. Without it, each is cut with a **Cut:** line under its D-entry, never deleted or redefined, and Task 2's
  `resolve.ts` half (R26(b)) still lands.
