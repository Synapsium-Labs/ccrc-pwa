# Runs screen rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/runs` so a person can find any run by number, see what is stuck and why, end it with proof, and have the ruled lanes close the rest.

**Architecture:** The server gains the facts the screen lacks (titles, who closed a run and why, a stuck verdict, two reads). The PWA gains one route per job (`/runs/<id>`, `/runs/advanced`), a Stuck band above programme cards, and a bulk abandon that loops over the existing route. Sessions may only ask for a run to end, and the auto-close lanes land last, behind shadow.

**Tech Stack:** TypeScript, Fastify, `node:sqlite` (`coord.db`), React, vitest, the `pwa/browser` Chrome leg.

**Spec:** `docs/superpowers/specs/2026-11-04-runs-screen-rebuild-design.md` (rev 4). Read it with this plan. Numbers such as §9.2, A35 and "check 12" are the spec's. Exact words on screen are in the spec and are not repeated here unless a test needs them.

## What holds this work

**Nothing here is built yet. The operator sees the frames first.** No task starts until the operator has seen them. If the frames change a rule, the spec changes first, then this plan.

The operator's note was that board builds wait on S2. Read at `origin/main` `5dd21cdb2` on 2026-11-06, **that wait is over: S2 merged as #2341 on 2026-11-06, and #2290 merged on 2026-11-05.** The gates are now:

| Gate | Holds | State at `5dd21cdb2` |
|---|---|---|
| The operator sees the frames | Every task | **Holding** |
| S2, the paged run read (#2341) | B1 and all board work | Clear. Merged |
| #2290, C1 (`ApiTimeout`, lazy screens) | B2 | Clear. Merged |
| #2286, PL10 (route table, `PhoneBar`) | B2 | Clear. Merged |
| C2 (#2318), the screen cache | F28 of B2 | Clear. Merged |
| #2343, PL11 (Goals page, `/waiting` filter) | B5 | Clear. Merged |
| #2305, S1 (the watcher tick) | B7 | Clear. Merged |
| #119, the worker heartbeat | B9 alone | **Holding.** Open |
| #2394, chat names link to their objects | Nothing, but it touches `RunRow.tsx`, `RunsScreen.tsx` and `runWords.ts` | Open. Whichever lands second rebases |

Merged is not deployed: whether S2 is live on the boxes was not read, and no build step here needs it. Re-read this table when the frames clear, because the base will have moved.

**Order inside the work:** B1, B2, B3, B4 in a line. B5 and B7 can run beside B4 once B3 lands. B6 follows B5, B8 follows B7, and B7's refused-close items (Task 27) need B6. Each wave is its own PR or a short series.

## Global Constraints

- Public repository: cite #1518, D-numbers, ARCH-NN or GitHub `#n` only. No tracker ids, hosts, accounts, sessions or other projects. Fixtures use `programme-a`, `lane-a`.
- Rulings bind every task: a Waiting on you item carries its own control, one tap plus a confirm. A delegated request reaches the operator only if the coordinator did not handle it.
- Wire additions are optional, with one PWA reader each and a skew test in both directions. `FLEET_PROTO` is not bumped.
- Decide in L1, act in L4. `moveItemInTx` stays the only writer of `operator_items.state`. `advanceInner` stays the writer of the close columns.
- A session never calls the abandon act. `POST /api/runs/:id/abandon` keeps its gate, its unread body and its answers (D-280, D-282, D-688). No corpus teaches it.
- Migrations take the next free slot at landing. Assume no number; the schema is at `user_version 40` today.
- Every PWA wave is judged at 360, 390, 1280, 1470 and 1920 wide, Refined and Instrument, light and dark. Text meets 4.5:1. Colours come only from skin tokens. `instrument.css` and `refined.css` gain no `.run` rules.
- An item is a name, a lamp with its word, one context line and at most one marker. Ids in details only. Text wraps, nothing is ellipsised, nothing on an item arrives late.
- Every phone link and control is `--tap-min` (44px) tall.
- No run number on a card, and no run state that means "waits on the operator" (D-6170).
- Each new `pwa/src` or `server/src` file declares its ring and context so the `rings` and `ownership` censuses pass. Characterization pins land first when code moves.
- Tests: from the package, `npx vitest run --maxWorkers=2 <files>`, named files only. A change to pwa rendering or a rendered count also runs the browser leg: build `ui`, then from `pwa/`, `CCRC_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npx vitest run --config vitest.browser.config.ts --maxWorkers=2 <files>`.
- Commits end with the repository's attribution lines. Each cites its wave's D-number from "Deviations found".

## Review Focus

1. **A phone clock ahead of the server.** `closes.at` reads as past too soon. Expected: the row shows the zero form, never a negative time and never "in 0". Pinned in Task 13.
2. **A long sheet on a short phone.** The child-workspace sentence (about 300 characters) under a 122-character title at 360 by 667. Expected: Confirm and Cancel stay reachable, and the sheet scrolls inside itself. Pinned in Task 10.
3. **The link drops during a bulk abandon.** A timeout or network failure on one call, where the run's fate is unknown. Expected: the loop stops, that run counts as not reached, the sheet re-reads the frame before reporting, and nothing is retried blind. Pinned in Task 14.
4. **An odd address.** `/runs/0`, `/runs/007`, `/runs/99999999999999999999`, `/runs/410/`. Expected: only canonical positive safe integers open a run page, the slash form included, and the others fall to the router's ordinary miss, with no read sent. Pinned in Task 7.
5. **A new PWA on an older server.** No `stuck`, and `find` answers 404. Expected: the board reads as today, and search says "Could not search closed runs. Showing open runs only." Pinned in Task 8.

---

## File structure

| File | Ring, context | Holds | Task |
|---|---|---|---|
| `server/src/coord/runStuck.ts` (new) | L1, Coordination | `runStuck`, `runWaitsOn`, `blockedByOf` | 4 |
| `server/src/coord/runFind.ts` (new) | L3 | the find query, beside `runsPage.ts` | 5 |
| `server/src/coord/runRecord.ts` (new) | L3 | events, stall folding | 6 |
| `server/src/coord/programmesRead.ts` (new) | L3 | `GET /api/programmes` aggregate | 16 |
| `server/src/coord/endRequest.ts` (new) | L1 | who may ask, repeat rule | 22 |
| `shared/api.ts`, `shared/ledgers.ts` | L0 | wire types, three item moves | 2 to 6, 21 |
| `pwa/src/fleet/stuckWords.ts` (new) | L1, PWA | heads' order, `stuckLine`, `closeWhen`, card line | 13 |
| `pwa/src/fleet/closeWords.ts` (new) | L1, PWA | `closeWords`, `closedLine` | 3 |
| `pwa/src/fleet/groupAbandon.ts` (new) | L1 and L4 | the loop and its five results | 14 |
| `pwa/src/fleet/GroupAbandonSheet.tsx` (new) | L4 | the sheet | 14 |
| `pwa/src/screens/RunDetailScreen.tsx` (new) | L4 | `/runs/<id>` | 7 |
| `pwa/src/screens/RunFind.tsx`, `useRunFind.ts` (new) | L4 | search box and results | 8 |
| `pwa/src/screens/StuckBand.tsx` (new) | L4 | heads and rows | 13 |
| `pwa/src/screens/RunsAdvancedScreen.tsx` (new) | L4 | `/runs/advanced` | 11, 20, 26 |
| `pwa/src/screens/ProgrammeCard.tsx`, `usePrograms.ts` (new) | L4 | cards | 18 |
| `pwa/src/ledgers/needsYou.ts` (new) | L1 | the one selector | 17 |

## Wave B1: server facts (D-8071)

### Task 1: Read before building

**Files:** none in the tree. The result goes in the PR body of Task 4.

This is a report, not code. It needs the operator's yes for a read-only look at `coord.db` on the controller, and it writes nothing.

- [ ] **Step 1: Read** `run_events` for OA-R0, `programs.state` for OA-R4, and who closed run 410 (spec §19).
- [ ] **Step 2: Replay** §7's five reasons on the live open runs with Task 4's `runStuck`, once written.
- [ ] **Step 3: Report** the counts against the spec's 5, 2, 12, 7, 2, and which runs moved between groups 4 and 5. Expected: total 28 plus any drift since. B4 does not start until this is reported.

### Task 2: Run titles stop moving (§11.1, F6, A8)

**Files:**
- Modify: `server/src/coord/schema.ts` (next migration), `server/src/coord/store.ts` (`openRun`, the reconstruct path), `server/src/coord/routes.ts` (`POST /api/runs`), `shared/api.ts`, `pwa/src/fleet/runWords.ts` (`runRowName`)
- Test: `server/test/run-titles.test.ts` (new), `pwa/test/run-row-name.test.ts` (new)

**Interfaces:**
- Produces: `runs.title TEXT NULL`; `RunSummary.runTitle?: string | null`; `POST /api/runs` body gains optional `programmeTitle`; `programmeNameFromSlug(slug: string): string`.

- [ ] **Step 1: Write the failing tests.** `an open leaves programs.title alone`, `a run keeps its own title after a later open`, `programmeTitle is used only for a new programme row`, `the migration copies programs.title to the newest run and sets programs.title to the slug as words` (`programme-a` gives `Programme a`), `earlier runs keep a null title`. PWA: `runRowName prefers runTitle`, `an older server with no runTitle names the row as today`.
- [ ] **Step 2: Run** `cd server && npx vitest run --maxWorkers=2 test/run-titles.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Both `ON CONFLICT(slug)` arms stop writing `title`. The coordinator skill sends `programmeTitle`.
- [ ] **Step 4: Run** the same file and `coordinator-skill.test.ts`, then `pwa/test/run-row-name.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 3: Who closed a run, and the one state word (§9.3, §11.2, §11.3, A16, A17, A30)

**Files:**
- Modify: `server/src/coord/schema.ts`, `server/src/coord/store.ts` (`advanceInner`), `server/src/coord/close.ts` (`closeRun`, the abandon arm), `shared/api.ts`, `pwa/src/fleet/runWords.ts`
- Create: `pwa/src/fleet/closeWords.ts`
- Test: `server/test/run-close-columns.test.ts` (new), `pwa/test/close-words.test.ts` (new)

**Interfaces:**
- Produces: `runs.closedBy`, `runs.closeDetail` (nullable); `closeRun` gains optional `detail`; `RunClosedBy = 'coordinator' | 'operator' | 'sweep'`; `RunSummary.closedBy?`, `closeDetail?`.
- Produces: `closeWords(run: Pick<RunSummary,'state'|'closedBy'|'closeDetail'>): string | null`; `closedLine(run, fmt: (ms: number) => string): string`; `runStateWord(run: RunSummary): string`.

- [ ] **Step 1: Write the failing tests.** Server: `advanceInner writes the close columns in the statement that writes closedAt`, `the stored columns equal the terminal run_events row`, `the migration fills them from that row`, `an unknown causedBy gives no closedBy`, `the abandon arm writes abandon:<reason> from the verdict it reads`. PWA, one case per row of §9.3's table, plus check 5:

```ts
expect(closeWords({ state: 'failed', closedBy: 'operator', closeDetail: 'abandon:overtaken' })).toBe('closed by you: overtaken');
expect(closeWords({ state: 'failed', closedBy: 'operator', closeDetail: null })).toBe('closed by you');
expect(closedLine(run({ closedBy: 'operator', closeDetail: 'abandon:owner-gone' }), fmt)).toBe('4 Nov at 15:05');
expect(closedLine(run({ state: 'done', closedBy: 'coordinator' }), fmt)).toBe('Closed by the coordinator, 2 Nov at 11:20');
expect(runStateWord(run({ state: 'failed', closedBy: 'operator' }))).not.toBe('failed');
```

- [ ] **Step 2: Run** both new files. Expected: FAIL.
- [ ] **Step 3: Implement.** `runStateWord` here is `closeWords`, then `RUN_WORD[state]`. Task 4 adds its other two arms. Add a single-definition pin that nothing else reads `RUN_WORD` for a row's word.
- [ ] **Step 4: Run** both files, `run-last-move`, `runs-screen`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 4: The stuck verdict (§7, §11.2, A4, A28, A29, A39)

**Files:**
- Create: `server/src/coord/runStuck.ts`
- Modify: `server/src/laneSchedule.ts` (one read-only row), `server/src/watch.ts` (stamp the answer on the runs frame), `shared/api.ts`, `pwa/src/fleet/runWords.ts`
- Test: `server/test/run-stuck.test.ts` (new), `server/test/run-stuck-skew.test.ts` (new)

**Interfaces:**
- Produces in `shared/api.ts`: `StuckReason = 'owner-gone' | 'start-never-landed' | 'review-of-closed' | 'overtaken' | 'never-started'`; `RunStuck = { reason: StuckReason; since: number; closes: { at: number; armed: boolean } | null }`; `RunWaitsOn = 'worker' | 'reviewer' | 'coordinator' | 'merge-queue' | 'nobody'`; `RunSummary.stuck?: RunStuck | null`, `waitsOn?: RunWaitsOn`, `blockedBy?: number | null`.
- Produces: `runStuck(facts: RunStuckFacts, nowMs: number): RunStuck | null`, `runWaitsOn(facts: RunStuckFacts): RunWaitsOn | undefined`, `blockedByOf(facts: RunStuckFacts): number | null`. All pure.

- [ ] **Step 1: Write the failing tests.** One per row of §7's table in first-match order, with its age boundary: `owner-gone at 1 h of a dead claimant, not at 59 min`, `start-never-landed over 1 h`, `review-of-closed over 1 h`, `overtaken over 24 h`, `never-started over 7 days with nothing else open`. Also `hibernated is never owner-gone`, `an absent claimant with no history gets no verdict`, `an uncertain reading gives no verdict`, `closes is null on every verdict` (until Task 25), and one `since` case per reason (A39). The `waitsOn` table of §7, row by row. `waitsOn has no operator value` as a type pin. Skew: `a frame with no stuck draws nothing`. PWA, in `close-words.test.ts`: `runStateWord says stuck and reviewed`, `an older server reads as today`.
- [ ] **Step 2: Run** the two files. Expected: FAIL.
- [ ] **Step 3: Implement.** `runStateWord` gains its two arms, in this order after `closeWords`: "stuck" when `stuck` is set, then "reviewed" when awaiting review and `waitsOn` is `coordinator`. Add the `LANE_SCHEDULE` row `{ name: 'runStuck', cadenceMs: RUN_STUCK_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'skip', warnKey: null }`, with `RUN_STUCK_SWEEP_MS = 60_000`. It adds no statement to the 2-second tick. A verdict may lag by one pass, and before the first pass `stuck` is absent.
- [ ] **Step 4: Run** the two files and the lane schedule's census. Expected: PASS.
- [ ] **Step 5: Commit**, with Task 1's replay in the PR body.

### Task 5: `GET /api/runs/find` (§11.4, A30, A31)

**Files:**
- Create: `server/src/coord/runFind.ts`
- Modify: `server/src/coord/schema.ts` (the partial index on `closedAt`), `server/src/coord/store.ts` (one delegate), `server/src/coord/routes.ts`, `shared/api.ts`, `pwa/src/lib/api.ts`
- Test: `server/test/run-find.test.ts` (new)

**Interfaces:**
- Produces: `RunHit` and the answer `{ok, exact, runs, reviewsOf, next}` as §11.4 says; `api.findRuns(q: RunFindQuery, opts?: ReadOpts): Promise<RunFindAnswer>`.

- [ ] **Step 1: Write the failing tests.** `closed runs order by closedAt, not id`, `a closed run below any read floor comes back`, `a number that also matches a reviews target or a title resolves to that id, the others under their own headings`, `open runs come on the first page only, outside limit`, `scope=open has no next`, `the cursor walks closed runs alone`, `% and _ in q are escaped`, `closedBy filters on the stored column`, `session only`, `120 a minute`, and `a page under 20 ms at 10,000 seeded rows`.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement** beside `runsPage.ts`, with the same structural `RunsDb` port. One statement per part. No hydrate, no join to `run_events`.
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 6: `GET /api/runs/:id/record`, and last moves on the cold read (§11.5)

**Files:**
- Create: `server/src/coord/runRecord.ts`
- Modify: `server/src/coord/routes.ts` (the record route; `GET /api/runs` calls `withLastMoves`), `shared/api.ts`, `pwa/src/lib/api.ts`
- Test: `server/test/run-record.test.ts` (new)

**Interfaces:**
- Produces: `RunRecordEvent`; the answer `{ok, run, events, reviewedBy, olderEvents}`; `api.runRecord(id: number, opts?: ReadOpts)`.

- [ ] **Step 1: Write the failing tests.** `any run reads, open or closed, however old`, `stall observations fold into one row per unbroken span`, `the newest 200 rows with olderEvents counting the rest`, `detail goes through the redaction profile`, `dual gate`, `no agent link is needed`, and `the cold read carries lastMoveAt`.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit.**

## Wave B2: find and open (D-8072)

### Task 7: The run page (§8.4, F16, check 5, check 16)

**Files:**
- Create: `pwa/src/screens/RunDetailScreen.tsx`
- Modify: `pwa/src/lib/routes.ts`, `pwa/src/ledgers/WaitingRoutes.tsx` (lift the way-back strip so both screens share it)
- Test: `pwa/test/run-detail.test.tsx` (new), `pwa/test/card-header-facts.test.tsx`

**Interfaces:**
- Consumes: `api.runRecord`, `api.run`, `closeWords`, `closedLine`, `runSpendLine`, `backLabel`.
- Produces: route id `run`, `/^\/runs\/(\d+)\/?$/`, `accepts: isRunId`; `runPath(id: number): string`; `WayBack({ to, label })`.

- [ ] **Step 1: Write the failing tests.** `/runs/410 opens a closed run`, `0, 007 and a number past safe integer are refused and send no read`, `/runs/410/ opens`, `a slow spend read delays one line and nothing else`, `spend reads ≈ $X.XX · out N`, `a closed run shows no Abandon`, `the line carries only what the word lacks`, `an absent fact is left out, except Last move, which says None recorded`, `There is no run 9999.`, `Could not load this run. Try again. on ApiTimeout`, `the strip says Back to Search results and keeps the query`, `the strip says Back to Runs from a cold link`, `no strip in the wide right pane`, and `every row element appears verbatim in the header`.
- [ ] **Step 2: Run** the files. Expected: FAIL.
- [ ] **Step 3: Implement.** The strip's origin rides history state, so a reload that loses it reads "Back to Runs". Move the strip with its pins green first, in a commit of its own.
- [ ] **Step 4: Run** the files plus `waiting-routes`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 8: Finding a run (§8.3, F1, F2, F4)

**Files:**
- Create: `pwa/src/screens/RunFind.tsx`, `pwa/src/screens/useRunFind.ts`
- Modify: `pwa/src/screens/RunsScreen.tsx`, `pwa/src/command/CommandLayer.tsx` and its registry
- Test: `pwa/test/run-find.test.tsx` (new), `pwa/test/command-registry.test.ts`

**Interfaces:**
- Consumes: `api.findRuns`, `runPath`.
- Produces: `parseRunNumber(text: string): number | null` for "410", "#410", "run 410"; `useRunFind(q: string): { exact, open, closed, reviewsOf, failed }`.

- [ ] **Step 1: Write the failing tests.** `the three spellings mean run 410`, `open runs filter at once from the frame`, `closed runs arrive 200 ms after typing stops`, `?q= holds the query across a reload`, `a whole number and Enter opens /runs/<id>`, `clearing restores the board with its folds and scroll`, `no Abandon on a result`, `Reviews of run 410 sits below the exact hit`, the three failure sentences, `a 404 from find on an older server reads Could not search closed runs`, `/ focuses the box on /runs`. Palette: `a number offers Open run 410`, `other text offers Find runs matching`, `the palette reads no server`.
- [ ] **Step 2: Run** the files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the files plus `command-layer`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 9: Every row opens (F7, F12, F14, F15, F19, F28, A9, A10)

**Files:**
- Modify: `pwa/src/screens/RunRow.tsx`, `pwa/src/screens/RunsScreen.tsx`, `pwa/src/fleet/inboxTarget.ts`, the session header link, the hold cell and Collect lane links
- Delete: `pwa/src/screens/useRunSpend.ts` if no caller remains
- Test: `pwa/test/runs-screen.test.tsx`, `pwa/test/inbox-target.test.ts`, `pwa/test/run-spend-line.test.tsx`, `pwa/browser/runs-widths.browser.test.ts` (new)

**Interfaces:**
- Consumes: `runPath`; C2's `screenCache` for fold and scroll.

- [ ] **Step 1: Write the failing tests.** `no row carries data-inert`, `a tap on any row opens /runs/<id>`, `mounting the board fires no GET /api/runs/:id`, `every door lands on /runs/<id> or the programme page`, `a return from a session keeps folds and scroll`. Browser: `a phone reaches a run by number`, with the width matrix set up once for later waves.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Rebase over #2394 if it has landed, and keep what it adds to a row.
- [ ] **Step 4: Run** them, the browser leg included. Expected: PASS.
- [ ] **Step 5: Commit.**

## Wave B3: abandon with proof (D-8073)

### Task 10: The single sheet (§9.1, check 13, F8, F9, F23, F24, A44)

**Files:**
- Modify: `pwa/src/fleet/AbandonSheet.tsx`, `pwa/src/lib/api.ts` (`abandonRun` keeps `childReclaim`, `childReclaimWhy`)
- Test: `pwa/test/abandon-sheet.test.tsx`, `pwa/browser/abandon-sheet.browser.test.ts` (new)

**Interfaces:**
- Produces: `abandonConsequence(run, child)` keeps its signature with new sentences; `workspaceNameOf(run): string | null` replaces the private `workspaceOf` and never returns the run number.

- [ ] **Step 1: Move the pinned sentences and write the failing tests.** This is an intended wording change, so the `NOT_CHILD`, `CHILD`, `UNKNOWN` and `NO_SESSION` pins change in the same commit as the code:

```ts
expect(abandonConsequence(noSession, 'unknown')).toBe('It holds no workspace of its own, so it has none to release or reclaim.');
expect(abandonConsequence(run({ workspace: 'ws-a' }), 'not-child')).toBe('Its workspace is ws-a. A release destroys nothing: the worktree survives, the record stays.');
expect(abandonConsequence(run({ workspace: null, branch: null }), 'not-child')).toBe('A release destroys nothing: the worktree survives, the record stays.');
for (const c of ['not-child', 'child', 'unknown'] as const) expect(abandonConsequence(run(), c)).not.toMatch(/^Abandon run/);
```

Also `the sheet repeats the row's name and context line verbatim`, `See this run links to the detail`, a toast test for each of the three success rows, a test for each refusal row with `the sheet stays open`, `400 and 413 show the server's detail`, and D-280's negative pin unchanged. Browser: `at 360 by 667 the child sentence under a 122-character title leaves Confirm and Cancel reachable`.

- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them, the browser leg included. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 11: `/runs/advanced` and close order (§8.2.3, §8.6, F10, F18)

**Files:**
- Create: `pwa/src/screens/RunsAdvancedScreen.tsx`
- Modify: `pwa/src/lib/routes.ts`, `pwa/src/screens/RunsScreen.tsx` (Finished reads `findRuns`)
- Test: `pwa/test/runs-advanced.test.tsx` (new), `pwa/test/runs-finished-fold.test.tsx`, `pwa/test/runs-pages.test.tsx`

**Interfaces:**
- Consumes: `api.findRuns`.
- Produces: `runsAdvancedPath(filter?: RunsFilter): string`; `RunsFilter = 'open' | 'by-you' | 'by-ccrc' | 'by-coordinators'`.

- [ ] **Step 1: Write the failing tests.** `open runs first, then close order, 50 at a time with Show older`, `the chip is in the URL`, `a just-abandoned old run heads All runs and Finished`, `the board no longer calls runsPage for Finished`. S2's `runsPage` stays for the Inbox and Mail, which keep their own read.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 12: Telling the coordinator (§11.7)

**Files:**
- Modify: `server/src/coord/schema.ts` (`untold`), `server/src/coord/close.ts`, the mail lane
- Test: `server/test/run-untold.test.ts` (new)

The ruled plan's W1 text holds for this part, unchanged but for its wave.

- [ ] **Step 1: Write the failing tests.** `the close transaction writes one row per run`, `a drain sends one system mail per claimant per pass with runId null`, `it never asks a wake`, `it is record-only`, `a gone claimant's rows wait for an heir`.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit.**

## Wave B4: the Stuck band (D-8074)

Starts when Task 1's replay is reported.

### Task 13: Heads and rows (§7, §8.2, §8.2.1, checks 1, 2, 4, 6, 9, 11, 12, 14, 15, A35 to A39, A43)

**Files:**
- Create: `pwa/src/fleet/stuckWords.ts`, `pwa/src/screens/StuckBand.tsx`
- Modify: `pwa/src/screens/RunsScreen.tsx`, `pwa/src/fleet/fleet.css`
- Test: `pwa/test/stuck-words.test.ts` (new), `pwa/test/stuck-band.test.tsx` (new), `pwa/test/danger-buttons.test.tsx`, `pwa/test/control-census.test.ts`, `pwa/browser/runs-widths.browser.test.ts`

**Interfaces:**
- Produces: `STUCK_HEAD_ORDER: readonly StuckReason[]`, with `review-of-closed, overtaken, owner-gone, start-never-landed, never-started`; `STUCK_HEADING`; `closeWhen(at: number, nowMs: number): string | null` (null at zero); `stuckNext(closes, nowMs): string`; `stuckLine(run: RunSummary, nowMs: number): string`; `runMarker(run, needsYou: boolean): 'needs you' | 'holds a workspace' | 'holds a session' | null`; `heldBack(run): boolean`; `heldBackLine(n: number): string`; `oldestDays(runs, nowMs): number`.

- [ ] **Step 1: Write the failing tests.**

```ts
const H = 3_600_000, now = 1_000 * H;
expect(stuckNext(null, now)).toBe('Nothing closes this on its own');
expect(stuckNext({ at: now + 20 * H, armed: false }, now)).toBe('ccrc would close this in 20 h');
expect(stuckNext({ at: now + 20 * H, armed: true }, now)).toBe('ccrc closes this in 20 h');
expect(stuckNext({ at: now, armed: false }, now)).toBe('ccrc would close this now');
expect(stuckNext({ at: now - H, armed: true }, now)).toBe('ccrc closes this soon');
expect(closeWhen(now + 40 * 60_000, now)).toBe('in 40 min');
expect(closeWhen(now + 19.2 * H, now)).toBe('in 20 h');
expect(closeWhen(now + 60 * H, now)).toBe('in 3 days');
expect(closeWhen(now + 1, now)).toBe('in 1 min');
expect(stuckLine(ownerGoneArchived49, now)).toBe('Coordinator archived 49 days ago · Nothing closes this on its own');
expect(runMarker(run({ sessionId: 's', workspace: null }), false)).toBe('holds a session');
expect(heldBackLine(1)).toBe('1 holds a workspace or session: one at a time');
```

Also, in `stuck-band`: `heads keep the fixed order when Review falls to 1`, `an empty head leaves and nothing else moves`, `heads fold by default at every width`, `an opened head is remembered per viewer`, `a head's oldest equals the largest age on its rows, in whole days`, `Start never finished shows the held-back line and no control`, `no would-close appears while every closes is null`, `Abandon sits only on stuck rows`, and `stuck never counts in a badge`. Census: `no healthy run renders above the band`, and `Closed today sits below it` joins Task 20. Browser, at each width, skin and theme: `the last head's bottom is within half a visible height of the fold at 667 tall`, `the visible height stops at the bottom bar`, `the last fold scrolls clear of the bar`, `every link on a phone is at least 44px`, `first programme card under 800px at Instrument 1920`.

- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Rows and heads take the clock from the one page clock. Nothing in the row reads the network.
- [ ] **Step 4: Run** them, the browser leg included. Record the measured heads' end and first-card figures in the PR body, against the spec's inferred 742px. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 14: Abandon a group (§9.2, checks 8, A12, A13, A33, A34, A40, A41)

**Files:**
- Create: `pwa/src/fleet/groupAbandon.ts`, `pwa/src/fleet/GroupAbandonSheet.tsx`
- Modify: `pwa/src/screens/StuckBand.tsx`
- Test: `pwa/test/group-abandon.test.ts` (new), `pwa/test/group-abandon-sheet.test.tsx` (new)

**Interfaces:**
- Consumes: `api.abandonRun`, `heldBack`.
- Produces:

```ts
interface GroupResult {
  abandoned: number[]; alreadyClosed: number[]; leftAlone: number[];
  refused: { id: number; sentence: string }[]; notReached: number[];
}
runGroupAbandon(list: readonly number[], deps: {
  abandon(id: number): Promise<AbandonAnswer>;
  stillInGroup(id: number): boolean;
  stopped(): boolean;
  onStep(done: number): void;
}): Promise<GroupResult>;
groupControlWords(free: number, total: number): string | null;
groupToast(r: GroupResult): string | null;   // null when the sheet must stay
groupSummary(r: GroupResult): string;
```

- [ ] **Step 1: Write the failing tests.**

```ts
expect(groupControlWords(12, 12)).toBe('Abandon all 12…');
expect(groupControlWords(2, 5)).toBe('Abandon 2…');
expect(groupControlWords(1, 1)).toBe('Abandon 1…');
expect(groupControlWords(1, 3)).toBe('Abandon 1…');
expect(groupControlWords(0, 2)).toBeNull();
expect(groupToast(res({ abandoned: 11, leftAlone: 1 }))).toBe('11 runs abandoned. 1 started moving and was left alone.');
expect(groupToast(res({ abandoned: 1 }))).toBe('1 run abandoned.');
expect(groupToast(res({ abandoned: 9, alreadyClosed: 2, refused: 1 }))).toBeNull();
expect(groupSummary(res({ abandoned: 9, alreadyClosed: 2, refused: 1 }))).toBe('9 abandoned, 2 had already closed, 1 not:');
```

Loop: `one call at a time`, `a run that left the group is skipped as left alone`, `409 counts as already closed and continues`, `501, 502 and registry-unmeasurable stop the loop`, `a timeout stops the loop and leaves the run not reached, with no retry`, `Stop finishes the run in flight`, `a run that joins after the sheet opens is not added`, and `every confirmed id ends in exactly one result`. Sheet: `a held run is never listed`, `unticking follows in the title and confirm`, `down to one uses the singular words`, `Abandon 1… opens the single sheet`, `no list when one run is free`, `left alone shows in the sheet only when it stays open`, `Closed today re-reads when the loop ends and never adds locally`. Risk pin: `a re-open is a new id and leaves programs.state alone`, in `server/test/run-reopen.test.ts`.

- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** No new route (A12).
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 15: Waiting on its coordinator (§8.2 item 6, A14, A29)

**Files:**
- Modify: `pwa/src/screens/RunsScreen.tsx`, `pwa/src/screens/StuckBand.tsx`
- Test: `pwa/test/stuck-band.test.tsx`

- [ ] **Step 1: Write the failing tests.** `awaiting-review with waitsOn coordinator and lastMoveAt over a day joins the band`, `a run at 23 h does not`, `one folded row`, `Open the coordinator on its rows`, `no Abandon there`, `Waits behind a stuck run links to blockedBy`.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit.**

## Wave B5: programmes (D-8075)

### Task 16: `GET /api/programmes` (§11.6, A26, A32)

**Files:**
- Create: `server/src/coord/programmesRead.ts`
- Modify: `server/src/coord/routes.ts`, `shared/api.ts`, `pwa/src/lib/api.ts`
- Test: `server/test/programmes-read.test.ts` (new)

**Interfaces:**
- Produces: `ProgrammeRow` with the fields of §11.6; `pendingClose` per reason, from `stuck.closes`; `closedToday: {operator, sweep, coordinator}`; `api.programmes(since: number)`.

- [ ] **Step 1: Write the failing tests.** `open comes from runs, never programs.state`, `a leftover review's abandon leaves a finished programme complete`, `since is clamped to the last 48 hours`, `one aggregate statement`, `session only`, and `a programme with a gone coordinator has a row`.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement** `programmeCurrentWave`, which the ruled spec names and main does not have yet.
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 17: One needs-you source (§8.7, A5, F20)

**Files:**
- Create: `pwa/src/ledgers/needsYou.ts`
- Modify: `pwa/src/fleet/navBadges.ts` and every chip that counts for itself: the programme card chip, the Fleet box chip
- Test: `pwa/test/needs-you.test.ts` (new), `pwa/test/waiting-view.test.ts`

**Interfaces:**
- Produces: `needsYou(items, sessions, runs): readonly NeedsYouEntry[]`; `NeedsYouEntry = { programme: string; runId: number | null; kind: 'item' | 'question' | 'review-cap' }`.

D-8049's `runsNeedYou` already reads the run binding. Fold it in, keeping its characterization.

- [ ] **Step 1: Write the failing tests.** `every badge reads the selector`, as a census; `no run state appears in it`; `a child's held ask does not count until handed over`; `stuck never counts`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them plus `runs-health` and `status-programmes`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 18: Programme cards and Finished (§8.2.2, §8.2.3, checks 3, 10, A37)

**Files:**
- Create: `pwa/src/screens/ProgrammeCard.tsx`, `pwa/src/screens/usePrograms.ts`
- Modify: `pwa/src/fleet/programmeBoxes.ts` (extract the state step), `pwa/src/fleet/stuckWords.ts`, `pwa/src/screens/RunsScreen.tsx`
- Delete: `pwa/src/fleet/runGroups.ts`, `pwa/test/run-groups.test.ts` (F22)
- Test: `pwa/test/programme-card.test.tsx` (new), `pwa/test/stuck-words.test.ts`, `pwa/test/programme-box.test.ts`

**Interfaces:**
- Produces: `motionState(lastMoveAt, now, quietMs, paused): 'paused' | 'stalled' | 'moving'`; `boxState` calls it after its needs step, and its answers stay pinned. `cardWord(motion, everyOpenRunStuck): string`. `programmeStuckLine(stuck: readonly RunStuck[], nowMs: number): string`.

- [ ] **Step 1: Write the failing tests.**

```ts
const mixed = [s(null), s(null), s({ at: now + 20 * H, armed: false })];
expect(programmeStuckLine(mixed, now)).toBe('3 stuck · ccrc would close 1 in 20 h');
expect(programmeStuckLine(mixedArmed, now)).toBe('3 stuck · ccrc closes 1 in 20 h');
expect(programmeStuckLine([s(null), s(null), s(null)], now)).toBe('3 stuck · nothing closes them on its own');
expect(programmeStuckLine(allAt20h, now)).toBe('3 stuck · ccrc closes them in 20 h');
```

Also `the soonest time shows when times differ`, `armed wins over shadow`, `the zero forms read now and soon`, `a needing card keeps its motion word and carries needs you · 1`, `boxState's answers are unchanged`, `a programme with a gone coordinator has a card`, `no run number on a card`, `a card's facts all appear in its header`, and the three Finished endings.

- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them, then the browser matrix. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 19: The programme page's Runs section (§8.5, §9.5, F25)

**Files:**
- Modify: `pwa/src/ledgers/ProgrammeScreen.tsx`, `pwa/src/fleet/ResumeSheet.tsx`
- Test: `pwa/test/programme-screen.test.tsx`, `pwa/test/resume-sheet.test.tsx`

- [ ] **Step 1: Write the failing tests.** `the header is a superset of the card`, `open waves newest first with reviews nested`, `a stuck row carries its Abandon`, `closed waves read through find with their close word`, `Resume sits once on the head, shown from the server's verdict`, `a claimant with no fleet row still shows Resume`, `step 3 offers a picker with the typed id below it`, `the lead sentence comes first`, and `an owner-gone row carries Abandon and never Resume`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** No second programme page (A1).
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 20: Bands move, Closed today, and the words (§8.2, §8.6, F21, F27, A32)

**Files:**
- Modify: `pwa/src/screens/RunsScreen.tsx`, `pwa/src/screens/RunsAdvancedScreen.tsx`, `pwa/src/fleet/ArchiveSheet.tsx`, `pwa/src/fleet/CollectLaneSection.tsx`, `pwa/src/fleet/StartProgramSheet.tsx`
- Test: `pwa/test/runs-screen.test.tsx`, `pwa/test/runs-advanced.test.tsx`

- [ ] **Step 1: Write the failing tests.** `the board's order is header, search, paused banner, Stuck, Closed today, Waiting band, programmes, quiet, Finished, foot`, `Closed today links each count to All runs with closedSince`, `it shows only once a close landed today`, `midnight is the operator's local day`, `the pause toggle lives under Advanced`, `ArchiveSheet and CollectLaneSection point at the new places`, `Start a programme replaces every "program" on this screen`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them, then the full matrix. Check §17's page budgets, and report them. Expected: PASS.
- [ ] **Step 5: Commit.**

## Wave B6: action on the item and end requests (D-8076)

The rulings this wave carries: an item that asks carries its own control, and a delegated request reaches the operator only if the coordinator did not handle it.

### Task 21: The item's new columns and moves (§10, A18, A19, A20, A21)

**Files:**
- Modify: `server/src/coord/schema.ts`, `server/src/coord/ledgersStore.ts`, `shared/ledgers.ts`
- Test: `server/test/ledger-store.test.ts`, `server/test/ledgers-frame.test.ts`

**Interfaces:**
- Produces: `operator_items.action`, `heldUntil` (nullable); `ItemAction = { verb: 'end-run'; runId: number; stuckReason: StuckReason | null }`; `ItemActor` gains `'ccrc'`; `ItemAct` gains `act`, `decline`, `settle`; `raiseItem(db, input, now, actor: 'coordinator' | 'ccrc' = 'coordinator')`.

- [ ] **Step 1: Write the failing tests.** The three rows of §10's move table, each with `none takes programme-live`; `itemsFor leaves out an item whose heldUntil is in the future`; `itemById stays raw`; `the view shows the item within one emit of its hold ending`; `parseRaise still refuses action`; `the raise event names its actor`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 22: `POST /api/runs/:id/end-request` (§10, A22, A24)

**Files:**
- Create: `server/src/coord/endRequest.ts`
- Modify: `server/src/coord/routes.ts`, `server/src/coord/ledgersRoutes.ts` (withdraw mails the asker), `server/src/coord/ledgersMail.ts`, the `ccrc-api` table, the skill corpora
- Test: `server/test/end-request.test.ts` (new), `server/test/coordinator-skill.test.ts`

**Interfaces:**
- Produces: `endRequestDecide(facts): { kind: 'raise'; heldUntil: number | null; line: EndRequestLine } | { kind: 'refuse'; why: 'not-yours' | 'already-asked' | 'recently-asked' | 'run-closed' }`.

- [ ] **Step 1: Write the failing tests.** `a coordinator's own request shows at once`, `a gone coordinator's run shows at once`, `a worker's request is held ASK_GRACE_MS and the coordinator is mailed`, `a coordinator's withdraw inside the hold means the operator sees nothing and the asker is told`, `a late withdraw wins until the operator has acted`, `anyone else is not-yours, by the attributed claimant and never by project`, `already-asked names the item`, `recently-asked for 24 hours after a decline or a withdraw, unless the stuck reason changed`, `run-closed`, `a planned run starting or any run closing settles the item, with its note`, `neededBy soon sends no push`. Corpus: `end-request is taught as asking` and `abandon does not appear beside it`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 23: `act` and `decline` (§10, A23)

**Files:**
- Modify: `server/src/coord/ledgersRoutes.ts` (`registerLedgerOperatorRoutes` takes `withAbandon`), `server/src/coord/routes.ts` (the handle's arm takes an optional detail), `server/src/coord/close.ts`
- Test: `server/test/ledger-routes.test.ts`, `server/test/ccrc-api-closed.test.ts`, `server/test/coord-pause-route.test.ts`, `server/test/coordinator-skill.test.ts`

**Interfaces:**
- Produces: `POST /api/items/:id/act`, `POST /api/items/:id/decline`, both session only and body-less. `act` answers as `sendCloseOutcome` does.

- [ ] **Step 1: Write the failing tests.** `act runs inside the coordMutex hold`, `act writes abandon:requested:<item> as the operator`, `act answers as abandon does, childReclaim included`, `abandoning a last open run closes its own item`, `an already-closed run closes the item with its note and is success`, `a death between the two steps is mended on the next read`, `decline mails the asker in the move's transaction`, `both refuse the box token`, `both are absent from ccrc-api`, `the abandon route's body is still unread`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the four steps of §10's "The act", in order.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 24: The controls on `/waiting`, and review caps (§8.7, §10, F21)

**Files:**
- Modify: `pwa/src/ledgers/WaitingScreen.tsx`, `pwa/src/ledgers/ItemView.tsx`, `pwa/src/ledgers/needsYou.ts`, `pwa/src/fleet/AbandonSheet.tsx` (a confirm that calls `act`), `pwa/src/screens/RunsScreen.tsx`
- Delete: `pwa/src/fleet/ReviewCapBand.tsx`
- Test: `pwa/test/waiting-screen.test.tsx`, `pwa/test/abandon-sheet.test.tsx`, `pwa/test/control-census.test.ts`

- [ ] **Step 1: Write the failing tests.** `an end-run row carries Abandon run and Keep the run, at the right from 640 and on their own line below it`, `Abandon run opens the single sheet and calls act`, `Keep the run confirms and calls decline`, `the row line ends in one of the three origins`, `a held item is on no list or badge`, `a review cap is a /waiting row with Lift cap on it`, and `/runs has one surface called Waiting on you, which is none`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them, then the browser matrix for `/waiting`. Expected: PASS.
- [ ] **Step 5: Commit.**

## Wave B7: never-started runs close themselves (D-8077)

Reuse the ruled plan's Task W1 (`2026-10-21-runs-auto-expire-and-programme-view.md`, D-6171) with the amendments of spec §12, and leave out the `untold` rows, which Task 12 landed. Read `lastDispatchAttemptAt`, the warning, the budget and rules R1 to R8 from it.

### Task 25: The lane rows E1 and E1r, and `closes` (§7, §12, A35, A36)

**Files:** as W1 lists, on one `LANE_SCHEDULE` row, plus `server/src/coord/runStuck.ts`.
- Test: as W1 lists, plus `server/test/run-stuck-closes.test.ts` (new)

**Interfaces:**
- Produces: `closesOf(row: LaneRowName, anchor: LaneAnchor, warning: WarningRead | null, armed: boolean): { at: number; armed: boolean } | null`. The lane and the verdict read the same predicates.

- [ ] **Step 1: Write the failing tests.** W1's pins, plus: `at comes from the anchor, never the run's age`, `a 50-day-old run in its first pass reads the full grace`, `E1r is anchor plus 1 h`, `shadow E1 is anchor plus 72 h`, `armed E1 is no earlier than deliveredAt plus 24 h`, `armed E1 with no delivery has closes null`, `closes is null while the lane holds and on an uncertain reading`, `activity moves at later`, `a refused close sets closes null and raises the item`, `E1r's check on a live session` for run 1085's shape.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Land after B3, in shadow.
- [ ] **Step 4: Run** them, then `stuck-words` to confirm the screen needed no change. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 26: Arming from the UI (§12.3, A15)

**Files:**
- Modify: `shared/switches.ts`, `server/src/coord/routes.ts` (`GET/POST /api/coord/run-close`), `pwa/src/screens/RunsAdvancedScreen.tsx`
- Test: `server/test/run-close-switch.test.ts` (new), `pwa/test/runs-advanced.test.tsx`

- [ ] **Step 1: Write the failing tests.** `three states per group, default shadow`, `Turn on lists what would close now, with reasons`, `session only`, `a marker remains an emergency override`, `the crash row gets the same control`, `closes and refusals of the last 7 days show per group`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** The operator arms after 3 days of shadow and reading the list. No session arms a lane.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 27: Refused closes become items (§10, §12.2, A19). Needs B6.

**Files:**
- Modify: `shared/ledgers.ts` (`action` widens), the lane, `server/src/coord/ledgersRoutes.ts`, `pwa/src/ledgers/WaitingScreen.tsx`
- Test: `server/test/ledger-routes.test.ts`, `pwa/test/waiting-screen.test.tsx`

**Interfaces:**
- Produces: `ItemAction` gains `{ verb: 'close-refused'; runId: number; doors: readonly ItemDoor[] }`; `ItemDoor = 'open-pr' | 'hand-to-coordinator' | 'abandon-anyway' | 'open-worker' | 'open-coordinator'`.

- [ ] **Step 1: Write the failing tests.** `each refusal raises its item at once, raised by ccrc`, `each door renders on the row`, `Abandon anyway reuses act, with The branch stays on disk.`, `decline applies to end-run alone`, `an undelivered warning raises Open the coordinator`, `settle closes the item when the reason has gone`, `the row gains needs you from the selector`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit.**

## Wave B8: coordinator gone (D-8078)

### Task 28: Rows E3, E3s and E5

Reuse the ruled Task W2 (D-6172) with spec §12's amendments. `closesOf` gains these rows at §7's graces.

- [ ] **Step 1: Write the failing tests.** W2's pins, plus `E3 and the crash row read anchor plus 1 h`, `E3s anchor plus 24 h`, `E5 the next pass`, `run 83's shape reads the held marker and closes through E1 or E3`.
- [ ] **Step 2: Run** them, then implement, then run them again. Expected: FAIL, then PASS.
- [ ] **Step 3: Commit.**

## Wave B9: worker gone (D-8079). Held by #119.

### Task 29: Rows E2 and E4

Reuse the ruled Task W5 (D-6175) with spec §12's amendments. This does not start until #119 lands.

- [ ] **Step 1: Write the failing tests.** W5's pins, plus `417 and 848's shapes reach a row`, `E2 anchor plus 1 h`, `E4 anchor plus 24 h`.
- [ ] **Step 2: Run** them, then implement, then run them again. Expected: FAIL, then PASS.
- [ ] **Step 3: Commit.**

## Acceptance

After each PWA wave, run the same scripts and compare with spec §17. After B4 the operator should be able to clear today's stuck set in 18 taps, with a toast and a record for each close.

## Rollback

Each PWA wave reverts as its PR. New wire fields are optional, so a revert leaves older readers working. Migrations only add. Lanes fall back to shadow from Advanced.

## Deviations found

Issued by the allocator on 2026-11-06, one per wave, and defined here. None has shipped.

- **D-8071 (2026-11-06)** — B1, the runs screen's server facts: a run keeps its own title, the close columns are stored, one stuck verdict, `GET /api/runs/find` and `GET /api/runs/:id/record`.
- **D-8072 (2026-11-06)** — B2, find and open: `/runs/<id>` for any run, the search box and palette entries, every row opens, and spend leaves the row.
- **D-8073 (2026-11-06)** — B3, abandon with proof: the sheet's new sentences and toast, `/runs/advanced` with All runs in close order, and the coordinator told of a close.
- **D-8074 (2026-11-06)** — B4, the Stuck band: heads in a fixed order and folded at every width, group abandon with five results that add up, and the Waiting on its coordinator band.
- **D-8075 (2026-11-06)** — B5, programmes: `GET /api/programmes`, one needs-you selector, cards that keep their motion word, the programme page's Runs section, and Closed today below the band.
- **D-8076 (2026-11-06)** — B6, action on the item: end requests with the coordinator first, `act` and `decline`, and review caps on `/waiting`.
- **D-8077 (2026-11-06)** — B7, never-started runs close themselves, as D-6171 amended by the rebuild spec: `stuck.closes` from the lane's anchor, arming from Advanced, and refused closes as items.
- **D-8078 (2026-11-06)** — B8, coordinator-gone rows, as D-6172 amended by the rebuild spec.
- **D-8079 (2026-11-06)** — B9, worker-gone rows, as D-6175 amended by the rebuild spec, held until #119 lands.
