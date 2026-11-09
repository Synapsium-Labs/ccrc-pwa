# Runs screen rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/runs` so a person can find any run by number, see what is stuck and why, end it with proof, and have the ruled lanes close the rest.

**Architecture:** The server gains the facts the screen lacks (titles, who closed a run and why, a stuck verdict, two reads). The PWA gains one route per job (`/runs/<id>`, `/runs/advanced`), a Stuck band above programme cards, and a bulk abandon that loops over the existing route. Sessions may only ask for a run to end, and the auto-close lanes land last, behind shadow.

**Tech Stack:** TypeScript, Fastify, `node:sqlite` (`coord.db`), React, vitest, the `pwa/browser` Chrome leg.

**Spec:** `docs/superpowers/specs/2026-11-04-runs-screen-rebuild-design.md` (rev 8, approved for build). Read it with this plan.

**Frames:** `docs/superpowers/specs/2026-11-04-runs-screen-rebuild-frames.html`, the frames the build follows. The operator approved them on 2026-11-07 (D-8115). Where a frame and a task's words differ, the spec decides, then the frame.

Numbers such as §9.2, A35 and "check 12" are the spec's. Exact words on screen are in the spec and are not repeated here unless a test needs them. Tasks with a letter, such as 7a, were added after review, so that earlier references to a task number still hold.

**Change, 2026-11-07 (D-8099):** the operator's one extra pass past the review cutoff. Task 27's items each name a control that works, and its pin fails on an empty list. Tasks 11 and 12a keep the board's reading and failed states, and Finished works against an older server. Task 4 counts the owner-gone hour and `since` from stored times, with a restart test.

**Change, 2026-11-07 (D-8115):** the operator approved the frames and ruled A35 to A61, the 14 open points (o1 to o14) and n1 to n4, each as recommended. Spec §4.6 holds them. Tasks 7, 9, 10, 11, 13, 14, 18, 19, 20, 25, 26 and 27 carry the rulings that change their words or tests. No answer moves a task to another wave: `gone_since` (n3) was already in Task 4's migration.

## What holds this work

**Nothing here is built yet. The operator approved the frames on 2026-11-07 (D-8115), so B1 can start.** If a later look at the frames changes a rule, the spec changes first, then this plan.

The operator's note was that board builds wait on S2. **That wait is over: S2 merged as #2341 on 2026-11-06, and #2290 merged on 2026-11-05.** The table was re-read against `origin/main` at `67db632c2` on 2026-11-07, after the frames cleared: each merge commit below is on it, and #119 is still an open issue. The gates are now:

| Gate | Holds | State at `67db632c2` |
|---|---|---|
| The operator approves the frames | Every task | Clear. Approved 2026-11-07 (D-8115) |
| S2, the paged run read (#2341) | B1 and all board work | Clear. Merged, `1fdd12f33` |
| #2290, C1 (`ApiTimeout`, lazy screens) | B2 | Clear. Merged, `2d7457499` |
| #2286, PL10 (route table, `PhoneBar`) | B2 | Clear. Merged, `cbdbe9f19` |
| C2 (#2318), the screen cache | F28 of B2 | Clear. Merged, `f88bae54d` |
| #2343, PL11 (Goals page, `/waiting` filter) | B5 | Clear. Merged, `97715bd47` |
| #2305, S1 (the watcher tick) | B7 | Clear. Merged, `ac6669182` |
| #119, the worker heartbeat | B9 alone | **Holding.** Open |
| #2394, chat names link to their objects | Nothing, but it touches `RunRow.tsx`, `RunsScreen.tsx`, `runWords.ts`, `lib/routes.ts`, `WaitingRoutes.tsx`, `ledgerWords.ts`, `ProgrammeScreen.tsx`, `useColdRuns.ts` and `control-census.test.ts` | Merged 2026-11-07, `176a3a38d`, so B2 rebases over it. Task 9 says how `/runs/<id>` replaces its `/runs?run=<id>` (A50) |

Merged is not deployed: whether S2 is live on the boxes was not read, and no build step here needs it. The frames have cleared, and this table was re-read then: `git fetch`, then each PR's state and its merge commit's ancestry on `origin/main` `67db632c2`. Re-read it again before each wave starts, because the base keeps moving.

**Order inside the work:** B1, B2, B3, B4 in a line. B5 and B7 both start after B4, and can run beside each other (A48). B5 cannot run beside B4: Task 18 changes B4's `stuckWords.ts`, and Task 20 places B4's `StuckBand`. B7 cannot either: Task 25 ends by running B4's `stuck-words`. B6 follows B5, B8 follows B7, and B7's refused-close items (Task 27) need B6. Each wave is its own PR or a short series. Tasks 18 and 19 land in one PR, because Task 18 replaces the Finished rows that carry Resume and Task 19 gives it its new home (A55).

## Global Constraints

- Public repository: cite #1518, D-numbers, ARCH-NN or GitHub `#n` only. No tracker ids, hosts, accounts, sessions or other projects. Fixtures use `programme-a`, `lane-a`.
- Rulings bind every task: a Waiting on you item carries its own control, one tap plus a confirm. A delegated request reaches the operator only if the coordinator did not handle it.
- Wire additions are optional, with one PWA reader each and a skew test in both directions. `FLEET_PROTO` is not bumped.
- Decide in L1, act in L4. `moveItemInTx` stays the only writer of `operator_items.state`. `advanceInner` stays the writer of the close columns.
- A live coordinator hears first. A refused close reaches the operator only as §12.2 says (A59). Doubt is never gone: D-7370 and D-7371 hold on the server's verdict (A56).
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
3. **The link drops during a bulk abandon.** A timeout or network failure on one call, where the run's fate is unknown. C1 puts no limit on a POST, so the loop passes its own. Expected: the loop stops within `ABANDON_CALL_MS`, that run counts as no answer and says it may have closed, the runs after it count as not reached, and nothing is retried blind. Pinned in Task 14.
4. **An odd address.** `/runs/0`, `/runs/007`, `/runs/99999999999999999999`, `/runs/410/`. Expected: only canonical positive safe integers open a run page, the slash form included, and the others fall to the router's ordinary miss, with no read sent. Pinned in Task 7.
5. **A new PWA on an older server.** No `stuck`, and `find` fails: there `/api/runs/find` reaches `GET /api/runs/:id`, whose id parse refuses "find" with 400 rather than 404. Any failure counts. Expected: the board reads as today, and search says "Could not search closed runs. Showing open runs only." Pinned in Task 8.

---

## File structure

| File | Ring, context | Holds | Task |
|---|---|---|---|
| `server/src/coord/runStuck.ts` (new) | L1, Coordination | `runStuck`, `runWaitsOn`, `blockedByOf`, `claimantGone`, `stuckCause` | 4, 25, 28 |
| `server/src/coord/runVerdicts.ts` (new) | L3 | `RunVerdicts`, the one in-memory holder of the pass's answers | 4 |
| `server/src/coord/runFind.ts` (new) | L3 | the find query, beside `runsPage.ts` | 5 |
| `server/src/coord/runRecord.ts` (new) | L3 | events, stall folding | 6 |
| `server/src/coord/programmesRead.ts` (new) | L3 | `GET /api/programmes` aggregate | 16 |
| `server/src/coord/endRequest.ts` (new) | L1 | who may ask, repeat rule | 22 |
| `shared/api.ts`, `shared/ledgers.ts` | L0 | wire types, three item moves | 2 to 6, 21 |
| `pwa/src/fleet/stuckWords.ts` (new) | L1, PWA | heads' order, `stuckLine`, `closeWhen`, card line | 13 |
| `pwa/src/fleet/closeWords.ts` (new) | L1, PWA | `closeWords`, `closedLine` | 3 |
| `pwa/src/fleet/groupAbandon.ts` (new) | L1 and L4 | the loop and its six results | 14 |
| `pwa/src/fleet/GroupAbandonSheet.tsx` (new) | L4 | the sheet | 14 |
| `pwa/src/screens/RunDetailScreen.tsx` (new) | L4 | `/runs/<id>`, as a page or the right pane | 7, 7a, 9a, 10, 19 |
| `pwa/src/screens/RunTrail.tsx`, `pwa/src/fleet/trailWords.ts` (new) | L4, L1 | the trail and its words | 7a |
| `pwa/src/screens/runColumn.ts` (new) | L1 and L4 | the column's name, from the one set of thresholds | 9a |
| `pwa/src/screens/RunFind.tsx`, `useRunFind.ts` (new) | L4 | search box and results | 8 |
| `pwa/src/screens/StuckBand.tsx` (new) | L4 | heads and rows | 13 |
| `pwa/src/screens/RunsAdvancedScreen.tsx` (new) | L4 | `/runs/advanced` | 11, 12a, 26 |
| `pwa/src/screens/ProgrammeCard.tsx`, `usePrograms.ts` (new) | L4 | cards | 18 |
| `pwa/src/ledgers/needsYou.ts` (new) | L1 | the one selector | 17 |

## Wave B1: server facts (D-8071)

### Task 1: Read before building

**Files:** none in the tree. The result goes in the PR body of Task 4.

This is a report, not code. It needs the operator's yes for a read-only look at `coord.db` on the controller, and it writes nothing.

- [ ] **Step 1: Read** `run_events` for OA-R0, `programs.state` for OA-R4, and who closed run 410 (spec §19).
- [ ] **Step 2: Replay** §7's five reasons on the live open runs with Task 4's `runStuck`, once written.
- [ ] **Step 3: Report** the counts against the spec's 5, 2, 12, 7, 2, which runs moved between groups 4 and 5, and how the owner-gone runs split by cause. Expected: total 28 plus any drift since. B4 does not start until this is reported.

### Task 2: Run titles stop moving (§11.1, F6, A8)

**Files:**
- Modify: `server/src/coord/schema.ts` (next migration), `server/src/coord/store.ts` (`openRun`, the reconstruct path), `server/src/coord/routes.ts` (`POST /api/runs`), `shared/api.ts`, `pwa/src/fleet/runWords.ts` (`runRowName`)
- Test: `server/test/run-titles.test.ts` (new), `pwa/test/run-row-name.test.ts` (new)

**Interfaces:**
- Produces: `runs.title TEXT NULL`; `RunSummary.runTitle?: string | null`; `POST /api/runs` body gains optional `programmeTitle`; `programmeNameFromSlug(slug: string): string`.

- [ ] **Step 1: Write the failing tests.** `an open leaves programs.title alone`, `a run keeps its own title after a later open`, `programmeTitle is used only for a new programme row`, `the migration copies programs.title to the newest run and sets programs.title to the slug as words` (`programme-a` gives `Programme a`), `earlier runs keep a null title`, `the restore statement puts each programme's old title back`. That statement lives in this test, and Rollback names it. PWA: `runRowName prefers runTitle`, `an older server with no runTitle names the row as today`.
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

- [ ] **Step 1: Write the failing tests.** Server: `advanceInner writes the close columns in the statement that writes closedAt`, `the stored columns equal the terminal run_events row`, `the migration fills them from that row`, `an unknown causedBy gives no closedBy`, `closeRun passes its detail to the final advance`. The abandon arm's reason needs Task 4's reader, so its pin is there. PWA, one case per row of §9.3's table, plus check 5:

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

### Task 4: The stuck verdict and its one reader (§7, §9.3, §11.2, A4, A28, A29, A39, A45, A46, A54 to A57, A60)

**Files:**
- Create: `server/src/coord/runStuck.ts`, `server/src/coord/runVerdicts.ts`
- Modify: `server/src/laneSchedule.ts` (one read-only row), `server/src/coord/schema.ts` (the `gone_since` table, in B1's migration), `server/src/coord/store.ts` (its writer pair), `server/src/coord/reclaim.ts` (`claimantFacts` also hands back the record's `substrate`, `archivedAt` and `stopped`), `server/src/coord/runWire.ts` (`withVerdicts`), `server/src/watch.ts` and `server/src/server.ts` (the frame and its cold start), `server/src/coord/routes.ts` (`GET /api/runs`, `GET /api/runs/:id`, and `withAbandon`'s arm), `shared/api.ts`, `pwa/src/fleet/runWords.ts`
- Test: `server/test/run-stuck.test.ts` (new), `server/test/run-stuck-skew.test.ts` (new), `server/test/run-stuck-restart.test.ts` (new), `server/test/coord-abandon.test.ts`, `pwa/test/close-words.test.ts`

**Interfaces:**
- Produces in `shared/api.ts`: `StuckReason = 'owner-gone' | 'start-never-landed' | 'review-of-closed' | 'overtaken' | 'never-started'`; `StuckCause = 'coordinator-archived' | 'coordinator-forgotten' | 'coordinator-removed' | 'coordinator-stopped' | 'coordinator-gone' | 'worker-stopped' | 'worker-gone' | 'name-reused' | 'target-closed' | 'later-review'`; `RunStuck = { reason: StuckReason; cause: StuckCause | null; since: number; closes: { at: number; armed: boolean } | null }`; `RunWaitsOn = 'worker' | 'reviewer' | 'coordinator' | 'merge-queue' | 'nobody'`; `RunSummary.stuck?: RunStuck | null`, `waitsOn?: RunWaitsOn`, `blockedBy?: number | null`, `coordinatorGone?: boolean`.
- Produces: `runStuck(facts: RunStuckFacts, nowMs: number): RunStuck | null`, `runWaitsOn(facts: RunStuckFacts): RunWaitsOn | undefined`, `blockedByOf(facts: RunStuckFacts): number | null`, `claimantGone(person: PersonFacts): 'gone' | 'asleep' | 'uncertain' | 'alive'`, where `PersonFacts` is the `ClaimantVerdict`, `hibernatedAt` and the `substrate` stamp, read in that order; `stuckCause(person: PersonFacts, journal: DeadCoordinatorJournal, role: 'coordinator' | 'worker'): StuckCause`; `stuckSince(cause: StuckCause | null, reason: StuckReason, times: StoredTimes): number | null`, where `StoredTimes` holds the journal act, `archivedAt`, `stopped.at`, the `dead_claimants` anchor with `supervisedAt`, the `gone_since` row and the run's own columns, all in ms (`archivedAt` and `stopped.at` are stored in epoch seconds, so the reader multiplies them by 1000, as `fleet.ts` does), and null means no stored time, so no verdict that pass. All pure. `name-reused` and `later-review` have no producer until Tasks 28 and 25.
- Produces in `runVerdicts.ts`: `RunVerdict = { stuck: RunStuck | null; waitsOn?: RunWaitsOn; blockedBy: number | null; coordinatorGone: boolean }`; `RunVerdicts = { replace(answers: ReadonlyMap<number, RunVerdict>, programmes: ReadonlyMap<string, boolean>): void; setCloses(closes: ReadonlyMap<number, NonNullable<RunStuck['closes']>>): void; of(id: number): RunVerdict | null; ofProgramme(slug: string): boolean | null; all(): ReadonlyMap<number, RunVerdict> }`. The lane row is `replace`'s one caller, and `programmes` holds `coordinatorGone` for each programme with no open run, for 7 days after its last close. `closes` is a map of its own: `replace` never touches it, and `of` joins it onto `stuck` as it reads, so a run missing from the map reads null. `setCloses` has no caller until Task 25.
- Produces in `store.ts`: `goneSince(): ReadonlyMap<string, GoneAnchor>`, `setGoneSince(personId: string, a: GoneAnchor): void` and `deleteGoneSince(personId: string): void`, with `GoneAnchor = { firstGoneAt: number; lastGoneAt: number }`. The verdict's pass is the pair's one caller, and it steps a row with `deadAnchorNext`.
- Produces in `runWire.ts`: `withVerdicts<R extends { readonly id: number }>(verdicts: RunVerdicts, runs: readonly R[]): R[]`. In `close.ts`: `abandonDetail(verdict: RunVerdict | null): string | null`, which gives `abandon:<reason>`, or null with no verdict.

- [ ] **Step 1: Write the failing tests.** One per row of §7's table in first-match order, with its age boundary: `owner-gone at 1 h of a dead claimant, not at 59 min`, `start-never-landed over 1 h`, `review-of-closed over 1 h`, `overtaken over 24 h`, `never-started over 7 days with nothing else open`. Also `hibernated is never owner-gone`, `an absent claimant with no history gets no verdict`, `an uncertain reading gives no verdict`, `closes is null on every verdict` (until Task 25), and one `since` case per reason (A39), overtaken's being the first later wave to leave planned. `a claimant with no fleet row that reads dead is coordinatorGone true`, `alive, hibernated and uncertain are coordinatorGone false`, `a reader with no entry stamps no coordinatorGone`. Doubt (A56): `a substrate stamp over a gone pane gives no verdict and coordinatorGone false under every dead lifecycle (D-7370)`, `a hibernated orphan or never-started claimant is asleep, and hibernation wins over a substrate stamp (D-7371)`, `a worker's substrate stamp gives no owner-gone`. Causes (A54), one case per row of §7's cause table: `archivedAt gives coordinator-archived`, `forget gives coordinator-forgotten`, `purge, destroy, reap, reclaim and expire give coordinator-removed`, `stop or a stopped lifecycle gives coordinator-stopped`, `a crash or an unreadable journal gives coordinator-gone`, `a worker reading orphan, never-started or absent with history gives worker-gone`, `every owner-gone verdict has a cause`, `the other reasons but review-of-closed have a null cause`, and `since is the act the cause names`. Programmes (A55): `a programme with no open run and a close in the last 7 days has a reading`, `past 7 days it has none`, `each claimant is measured once a pass`, `a closed run takes coordinatorGone from its programme's entry and nothing else`. The reader: `the frame, its cold start, GET /api/runs and GET /api/runs/:id all carry the verdict`, `an empty reader stamps nothing`, `a run gone from a pass loses its entry`, `replace leaves the closes map alone`. Stored times (A63), one case per row of spec §7's age table: `coordinator-archived reads the archive act, else archivedAt`, `coordinator-stopped reads the stop act, else stopped.at`, `a crash reads deadCoordinatorSince over dead_claimants`, `a crash with no dead_claimants row reads gone_since`, `with reclaim-paused set, a crash still reads owner-gone an hour after gone_since's first pass`, `with the journal held, the same`, `once the lane writes its row, the row wins`, `worker-stopped reads the worker's stopped.at`, `worker-gone and an untrusted journal read gone_since`. The table: `gone_since is written only for a person with no other stored time`, `a later pass moves lastGoneAt alone`, `a gap over DEAD_COORDINATOR_GAP_MS starts afresh`, `alive or asleep deletes the row`, `an uncertain pass moves lastGoneAt alone`, `an uncertain spell longer than DEAD_COORDINATOR_GAP_MS keeps firstGoneAt`, `archivedAt and stopped.at are seconds and read as ms`, `a person with no open run loses it`, `an older build opens the file at the new version`. Restart, in `run-stuck-restart.test.ts` (new), on a file-backed store: `a crash first read at T reads owner-gone at T plus 1 h after a sealed shutdown, the store reopened and RunVerdicts rebuilt, with since T`, `after an unsealed restart a crash's since moves with the lane's seed pass, and the row and the verdict agree`, `it does not read owner-gone at T plus 59 min after the same restart`, `a worker gone at T reads owner-gone at T plus 24 h across a restart`, `a stopped coordinator keeps since across a restart`, and `the first pass after a restart gives every open run the since it had before`. The arm, in `coord-abandon.test.ts`: `the abandon arm writes abandon:<reason> from what RunVerdicts holds`, `it reads inside the hold`, `with no verdict it writes no detail and the run reads closed by you`, `the route still reads no body`. The `waitsOn` table of §7, row by row. `waitsOn has no operator value` as a type pin. Skew: `a frame with no stuck draws nothing`. PWA, in `close-words.test.ts`: `runStateWord says stuck and reviewed`, `an older server reads as today`.
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement.** `runStateWord` gains its two arms, in this order after `closeWords`: "stuck" when `stuck` is set, then "reviewed" when awaiting review and `waitsOn` is `coordinator`. Add the `LANE_SCHEDULE` row `{ name: 'runStuck', cadenceMs: RUN_STUCK_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'skip', warnKey: null }`, with `RUN_STUCK_SWEEP_MS = 60_000`. It adds no statement to the 2-second tick. Each pass reads the journal once for the claimants it measures (`deadCoordinatorJournalRows`). A verdict may lag by one pass, and before the first pass, or after a restart, the reader is empty, so `stuck` is absent and an abandon records no reason. `withAbandon`'s arm reads `verdicts.of(runId)` and passes `abandonDetail` as `closeRun`'s detail. `since` and the owner-gone hour come from `stuckSince`, never from the pass's own clock, so the in-memory reader can empty on a restart and no age moves. The `gone_since` migration adds a table and nothing else, as migration 18 did.
- [ ] **Step 4: Run** the three files and the lane schedule's census. Expected: PASS.
- [ ] **Step 5: Commit**, with Task 1's replay in the PR body.

### Task 5: `GET /api/runs/find` (§11.4, A30, A31)

**Files:**
- Create: `server/src/coord/runFind.ts`
- Modify: `server/src/coord/schema.ts` (the partial index on `closedAt`), `server/src/coord/store.ts` (one delegate), `server/src/coord/routes.ts`, `shared/api.ts`, `pwa/src/lib/api.ts`
- Test: `server/test/run-find.test.ts` (new)

**Interfaces:**
- Produces: `RunHit` and the answer `{ok, exact, runs, reviewsOf, next}` as §11.4 says; `api.findRuns(q: RunFindQuery, opts?: ReadOpts): Promise<RunFindAnswer>`.

- [ ] **Step 1: Write the failing tests.** `closed runs order by closedAt, not id`, `a closed run below any read floor comes back`, `a number that also matches a reviews target or a title resolves to that id, the others under their own headings`, `open runs come on the first page only, outside limit`, `scope=open has no next`, `the cursor walks closed runs alone`, `% and _ in q are escaped`, `closedBy filters on the stored column`, `closedSince keeps closes at or after it`, `program keeps one slug's runs`, `a hit carries claimedBy`, `a bad closedSince or program is 400`, `closedBy with closedSince equals the Closed today count for that closer`, `session only`, `120 a minute`, and `a page under 20 ms at 10,000 seeded rows`.
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
- Consumes: `withVerdicts`.
- Produces: `RunRecordEvent`, with `folded?: {count, untilAt}`; the answer `{ok, run, events, reviewedBy, olderEvents}`; `api.runRecord(id: number, opts?: ReadOpts)`.

- [ ] **Step 1: Write the failing tests.** `any run reads, open or closed, however old`, `the record's run carries stuck, waitsOn, blockedBy and coordinatorGone as a frame row does`, `stall observations fold into one row per unbroken span, with its count and end`, `the newest 200 rows with olderEvents counting the rest`, `detail goes through the redaction profile`, `dual gate`, `no agent link is needed`, and `the cold read carries lastMoveAt`.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit.**

## Wave B2: find and open (D-8072)

### Task 7: The run page: route, header, facts and way back (§8.4, F16, check 5, check 16, A42)

**Files:**
- Create: `pwa/src/screens/RunDetailScreen.tsx`
- Modify: `pwa/src/lib/routes.ts`, `pwa/src/lib/api.ts` (`/items`, `/signals`, which have no PWA caller today), `pwa/src/app.tsx`, `pwa/src/ledgers/WaitingRoutes.tsx` (lift the way-back strip so both screens share it)
- Test: `pwa/test/run-detail.test.tsx` (new), `pwa/test/card-header-facts.test.tsx`

**Interfaces:**
- Consumes: `api.runRecord`, `api.run`, `closeWords`, `closedLine`, `runSpendLine`, `backLabel`.
- Produces: route id `run`, `/^\/runs\/(\d+)\/?$/`, `accepts: isRunId`; `runPath(id: number, q?: string): string`; `runQueryOf(search: string): string | null`; `WayBack({ to, label })`.

- [ ] **Step 1: Write the failing tests.** `/runs/410 opens a closed run`, `0, 007 and a number past safe integer are refused and send no read`, `/runs/410/ opens`, `a slow spend read delays one line and nothing else`, `spend reads ≈ $X.XX · out N`, `a closed run shows no Abandon`, `the line carries only what the word lacks`, `an absent fact is left out, except Last move, which says None recorded`, `There is no run 9999.`, `Could not load this run. Try again. on ApiTimeout`, `the strip shows ‹ Search results, is named Back to Search results for screen readers, and keeps the query`, `a reload of /runs/410?q=x keeps that strip`, `the strip shows ‹ Runs, named Back to Runs, from a cold link` (o3: today's Waiting strip pattern, the visible words without Back to), `the facts come in §8.4's order, under their five groups`, `items, suite and checks, and unread mail read from their own calls`, and `every row element appears verbatim in the header`, with a row carrying `stuck`, `waitsOn` and a marker. Task 9a pins the right pane, which has no strip.
- [ ] **Step 2: Run** the files. Expected: FAIL.
- [ ] **Step 3: Implement.** The strip's origin rides the URL as `?q=`. `navigate` (`lib/router.ts`) writes null history state and takes none, and Waiting's own strip rides `?from=` for the same reason, so a reload keeps the label. Move the strip with its pins green first, in a commit of its own.
- [ ] **Step 4: Run** the files plus `waiting-routes`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 7a: The run page's controls and trail (§8.4, §9.4, F16)

**Files:**
- Create: `pwa/src/screens/RunTrail.tsx`, `pwa/src/fleet/trailWords.ts`
- Modify: `pwa/src/screens/RunDetailScreen.tsx`
- Test: `pwa/test/run-detail.test.tsx`, `pwa/test/trail-words.test.ts` (new), `pwa/test/control-census.test.ts`

**Interfaces:**
- Consumes: `sessionPath`, `LiftCapSheet`, `RunRecordEvent`.
- Produces: `trailLine(e: RunRecordEvent, fmt: (ms: number) => string): string`; `trailBy(by: RunRecordEvent['by']): string`; `olderEventsLine(n: number): string | null`.

Abandon joins these controls in Task 10, and Resume in Task 19, each with its own sheet.

- [ ] **Step 1: Write the failing tests.**

```ts
expect(trailBy('operator')).toBe('you');
expect(trailBy('sweep')).toBe('ccrc');
expect(trailBy('coordinator')).toBe('the coordinator');
expect(trailBy('session')).toBe('a session');
expect(trailLine(stallSpan({ count: 6, from: '2 Nov', until: '4 Nov' }), fmt)).toBe('6 stall checks, 2 to 4 Nov');
expect(olderEventsLine(0)).toBeNull();
expect(olderEventsLine(12)).toBe('12 older events not shown.');
```

Page: `Open the session shows when a session exists or existed and can be opened`, `no session, no control`, `Open the coordinator shows when the claimant has a session`, `Lift cap shows when the run's review cap is waiting and opens LiftCapSheet`, `each control is one tap to its place`, `the trail lists every event newest first, as time, words and who`, `the trail sits last at every width`, `the detail shows through the redaction profile as stored`, and `a closed run still shows its trail`.

- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 8: Finding a run (§8.3, F1, F2, F4)

**Files:**
- Create: `pwa/src/screens/RunFind.tsx`, `pwa/src/screens/useRunFind.ts`
- Modify: `pwa/src/screens/RunsScreen.tsx`, `pwa/src/command/CommandLayer.tsx` and its registry
- Test: `pwa/test/run-find.test.tsx` (new), `pwa/test/command-registry.test.ts`

**Interfaces:**
- Consumes: `api.findRuns`, `runPath`, `runQueryOf`.
- Produces: `parseRunNumber(text: string): number | null` for "410", "#410", "run 410"; `useRunFind(q: string): { exact, open, closed, reviewsOf, failed }`.

- [ ] **Step 1: Write the failing tests.** `the three spellings mean run 410`, `open runs filter at once from the frame`, `closed runs arrive 200 ms after typing stops`, `?q= holds the query across a reload`, `a whole number and Enter opens /runs/<id>`, `clearing restores the board with its folds and scroll`, `a result opens /runs/<id>?q=<query>`, `no Abandon on a result`, `Reviews of run 410 sits below the exact hit`, the three failure sentences, `any failure from find, as on an older server where the id parse refuses it with 400, reads Could not search closed runs`, `/ focuses the box on /runs`. Palette: `a number offers Open run 410`, `open runs join the entries by the same terms, ranked after sessions`, `other text offers Find runs matching`, `the palette reads no server`.
- [ ] **Step 2: Run** the files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the files plus `command-layer`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 9: Every row opens, says what it waits on, and the board's states (§7, §8.2, F7, F11, F12, F14, F15, F19, F28, A9, A10, A50)

**Files:**
- Modify: `pwa/src/screens/RunRow.tsx`, `pwa/src/screens/RunsScreen.tsx`, `pwa/src/fleet/runWords.ts`, `pwa/src/fleet/inboxTarget.ts`, the session header link, the hold cell and Collect lane links, and `pwa/src/lib/routes.ts`, which #2394 changed
- Delete: `pwa/src/screens/useRunSpend.ts` if no caller remains
- Test: `pwa/test/runs-screen.test.tsx`, `pwa/test/inbox-target.test.ts`, `pwa/test/run-spend-line.test.tsx`, `pwa/test/run-wait-line.test.ts` (new), `pwa/browser/runs-widths.browser.test.ts` (new)

**Interfaces:**
- Consumes: `runPath`; C2's `screenCache` for fold and scroll; `ApiTimeout`.
- Produces: `runWaitLine(run: RunSummary, nowMs: number): string | null`, the one reader of §7's lines, in `runWords.ts`. Null means today's line.

- [ ] **Step 1: Write the failing tests.**

```ts
expect(runWaitLine(run({ state: 'planned', blockedBy: 1012 }), now)).toBe('Waits behind a stuck run.');
expect(runWaitLine(run({ state: 'planned', waitsOn: 'coordinator' }), now)).toBe('Waits for its coordinator to start it.');
expect(runWaitLine(run({ state: 'awaiting-review', waitsOn: 'coordinator' }), now)).toBe('Reviews done. Waits on its coordinator.');
expect(runWaitLine(run({ state: 'awaiting-review', waitsOn: 'reviewer' }), now)).toBe('Waits on a reviewer.');
expect(runWaitLine(run({ state: 'working', waitsOn: 'worker', lastMoveAt: now - 9 * DAY }), now)).toBe('No move in 9 days.');
expect(runWaitLine(run({ state: 'working', waitsOn: 'worker', lastMoveAt: now - 23 * H }), now)).toBeNull();
expect(runWaitLine(run({ state: 'planned', waitsOn: undefined }), now)).toBeNull();
```

Rows: `no row carries data-inert`, `a tap on any row opens /runs/<id>`, `mounting the board fires no GET /api/runs/:id`, `every door lands on /runs/<id> or the programme page`, `a return from a session keeps folds and scroll`, `a row shows runWaitLine in place of its ordinary line`. Board: `No runs open. with no open run`, `Could not load runs. Try again. on ApiTimeout, with a Try again control`, `Try again reads again`, `the information line names a run no act can move and carries no control` (n2), `a list not yet heard says Loading and never no runs`, `reconnecting keeps today's line`. Browser: `a phone reaches a run by number`, with the width matrix set up once for later waves.

#2394 has landed (`176a3a38d`), so also (A50): `runsRunHref builds /runs/<id>`, `/runs?run=410 is replaced by /runs/410, and Back skips it`, `/runs?run=410&q=x goes to the run`, and `/runs?run=9999 reads There is no run 9999.` on the run page.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** #2394 has landed, so rebase over it: `runsRunHref` builds `runPath(id)`, and `/runs?run=<id>` stays only for old chat text, which the board replaces with `/runs/<id>`. That way `?run=` and `?q=` never meet, and no arrival has to find a row folded under a Stuck head. `runNotLoadedLine` and the board's `useArrival`, `arrived` and `rowRef` leave, and `runs-arrival.test.tsx` moves to the pins above. `useArrival` stays for accounts. Its route comment, "the runs route's one query", is corrected.
- [ ] **Step 4: Run** them, the browser leg included. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 9a: One layout rule and the broad pane (§8.1, §8.2 to §8.4 per-width tables, §16, A9, A51, check 16)

**Files:**
- Create: `pwa/src/screens/runColumn.ts`
- Modify: `pwa/src/screens/RunsScreen.tsx`, `pwa/src/screens/RunDetailScreen.tsx`, `pwa/src/screens/RunFind.tsx`, `pwa/src/app.tsx` (the `run` route mounts the board in a broad column), `pwa/src/fleet/fleet.css`
- Test: `pwa/test/run-column.test.ts` (new), `pwa/test/runs-broad.test.tsx` (new), `pwa/test/skin-axis-census.test.ts` (new), `pwa/browser/runs-widths.browser.test.ts`

**Interfaces:**
- Produces: `RUN_COLUMN = { medium: 640, cards: 840, broad: 1240 } as const`; `columnName(width: number): 'narrow' | 'medium' | 'broad'`; `useColumnName(ref: RefObject<HTMLElement>): 'narrow' | 'medium' | 'broad'`, one `ResizeObserver`. `RunDetailScreen` gains `pane?: boolean`.

The `container-type: inline-size` rule sits on the board's own column, as Settings' does. Rows, stuck heads and cards take their medium and broad forms from it, each in its own task: rows here, heads in Task 13, cards in Task 18. Task 11 adds Advanced's pane on this same reading.

- [ ] **Step 1: Write the failing tests.**

```ts
expect(columnName(639)).toBe('narrow');
expect(columnName(640)).toBe('medium');
expect(columnName(1239)).toBe('medium');
expect(columnName(1240)).toBe('broad');
```

Census: `fleet.css's @container thresholds equal RUN_COLUMN`, `instrument.css and refined.css hold no .run, .stuck or .programme-card rule`, `the board's container rule is the only one on its column`. Broad: `/runs with no run open reads Select a run to see it here.`, `a row opens in the right pane and the URL becomes /runs/<id>`, `a cold /runs/410 in a broad column draws the list and the pane`, `the pane has no strip and no Back`, `the open row is marked current`, `/runs/410?q=x keeps the results in the list`, `a result opens in the pane`, `narrower than broad, the same URL is a page with its strip`. Browser, at each width, skin and theme: `360, 390 are narrow; 1280, 1470 are medium; 1920 is medium in Refined and broad in Instrument`, `the pane sits at about 40 and 60 percent`, `the search box is sticky under the header on a phone and tops the list pane when broad`, `facts are label over value when narrow and two columns from medium`, `long branch names wrap`, and `medium rows run on one line where the text fits, with the control at the right`.

- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** One rule, on column width. Skins change the column through their tokens and nothing else (§8.1, Q2).
- [ ] **Step 4: Run** them, the browser leg included. Record the measured column at 1470, which spec §19 lists as unmeasured. Expected: PASS.
- [ ] **Step 5: Commit.**

## Wave B3: abandon with proof (D-8073)

### Task 10: The single sheet, and Abandon on the run page (§8.4, §9.1, check 13, F8, F9, F23, F24, A44, A52)

**Files:**
- Modify: `pwa/src/fleet/AbandonSheet.tsx`, `pwa/src/screens/RunDetailScreen.tsx`, `pwa/src/lib/api.ts` (`abandonRun` keeps `childReclaim`, `childReclaimWhy`, and takes optional `opts?: ReadOpts`), `pwa/src/fleet/runWords.ts` (`coordinatorGoneOf`)
- Test: `pwa/test/abandon-sheet.test.tsx`, `pwa/test/run-detail.test.tsx`, `pwa/browser/abandon-sheet.browser.test.ts` (new)

**Interfaces:**
- Produces: `abandonConsequence(run, child)` keeps its signature with new sentences; `workspaceSubject(run): { subject: string; Subject: string }` replaces the private `workspaceOf`. It gives the recorded workspace, "the workspace on <branch>" or "its workspace", and never the run number. `coordinatorGoneOf(run: { coordinatorGone?: boolean }, presence: CoordinatorPresence): boolean` is the field's one reader: `run.coordinatorGone ?? presence === 'dead'`. True and false win, and only an absent field falls back (A60).

- [ ] **Step 1: Move the pinned sentences and write the failing tests.** This is an intended wording change, so the `NOT_CHILD`, `CHILD`, `UNKNOWN` and `NO_SESSION` pins change in the same commit as the code:

```ts
expect(abandonConsequence(noSession, 'unknown')).toBe('It holds no workspace of its own, so it has none to release or reclaim.');
expect(abandonConsequence(run({ workspace: 'ws-a' }), 'not-child')).toBe('Its workspace is ws-a. A release destroys nothing: the worktree survives, the record stays.');
expect(abandonConsequence(run({ workspace: null, branch: 'b-a' }), 'not-child')).toBe('Its branch is b-a. A release destroys nothing: the worktree survives, the record stays.');
expect(abandonConsequence(run({ workspace: null, branch: null }), 'not-child')).toBe('A release destroys nothing: the worktree survives, the record stays.');
expect(abandonConsequence(run({ workspace: null, branch: 'b-a' }), 'child')).toMatch(/^The workspace on b-a is a child workspace, so/);
expect(abandonConsequence(run({ workspace: null, branch: null }), 'child')).toMatch(/^Its workspace is a child workspace, so/);
expect(abandonConsequence(run({ workspace: null, branch: null }), 'unknown')).toMatch(/^This board cannot tell whether its workspace is a child workspace\./);
for (const c of ['not-child', 'child', 'unknown'] as const) expect(abandonConsequence(run(), c)).not.toMatch(/^Abandon run/);
```

Also `the sheet repeats the row's name and context line verbatim`, `the sheet states a close time once, in that line`, `Its worker is still running. shows when waitsOn is worker and not otherwise`, `Its coordinator is told. shows, and is left out when the coordinator reads gone`, `coordinatorGone false wins over a presence of dead`, `coordinatorGone true wins over a presence of unknown`, `an absent field reads presence`, `See this run links to the detail`, `an unreadable child marker reads unknown, the sheet says this board cannot tell, and Abandon still acts` (n1), `the desk dialog is 560px wide at 1280 and at 1470` (o11), a toast test for each of the three success rows, a test for each refusal row with `the sheet stays open`, `409 unknown-run reads as a 404 does`, `400 and 413 show the server's detail`, and D-280's negative pin unchanged. Run page: `an open run shows Abandon`, `an open run with no verdict still shows Abandon`, `an open run with a wrong stuck reason still shows Abandon`, `the page uses this same sheet`, `after an abandon the page shows the close`. Browser: `at 360 by 667 the child sentence under a 122-character title leaves Confirm and Cancel reachable`.

- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them, the browser leg included. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 11: `/runs/advanced`, the door to it, and close order (§8.2 item 10, §8.2.3, §8.6, §9.5, F10, F18, A55)

**Files:**
- Create: `pwa/src/screens/RunsAdvancedScreen.tsx`
- Modify: `pwa/src/lib/routes.ts`, `pwa/src/screens/RunsScreen.tsx` (Finished reads `findRuns`), `pwa/src/fleet/fleet.css`
- Test: `pwa/test/runs-advanced.test.tsx` (new), `pwa/test/runs-finished-fold.test.tsx`, `pwa/test/runs-pages.test.tsx`, `pwa/browser/runs-widths.browser.test.ts`

**Interfaces:**
- Consumes: `api.findRuns`, `useColumnName`, `RunDetailScreen`'s `pane`.
- Produces: `runsAdvancedPath(filter?: RunsFilter, closedSince?: number): string`; `RunsFilter = 'open' | 'by-you' | 'by-ccrc' | 'by-coordinators'`.

- [ ] **Step 1: Write the failing tests.** `the board's foot links to /runs/advanced at every width, whatever else the board holds`, with the browser leg's `the foot link is reachable and 44px tall on a phone`. Task 12a moves the switches behind this link, so it lands first. `open runs first, then close order, 50 at a time with Show older`, `a failed Show older says Could not load older runs. Try again. and keeps the rows already read` (o13), `the chip is in the URL`, `closedSince rides the URL beside the chip`, `a just-abandoned old run heads All runs and Finished`, `Finished no longer reads the paged archive`, `a Finished row of a programme with no open run still offers Resume, as today`, `a Finished row beside an open wave offers none`, `an open hit reads its word and line from the live frame`, `in a broad column a row opens beside the list with ?open=<id>`, and, per §8.6's table, `chips wrap on a phone`. Skew (spec §8.2.3): `against an older server, whose find reaches GET /api/runs/:id and answers 400 bad-request, Finished reads the unpaged archive, sorts it by closedAt, and says This server is older, so Finished shows only the runs it can list.`, `that case never reads as failed or as empty`, `a 404 from find reads the same`, `the board's own find call is never answered 400 bad-request by a new server`, `a 400 with another error code reads as failed`, and `a find that fails for any other reason shows as failed, as today's cold read does`. The board's states (spec §8.2): `before the first frame and before Finished answers, the board says Loading…`, `a failed Finished read with no frame says Could not reach the server — runs may exist that are not shown., never No runs open.`, `with the frame seen, no open run and a failed Finished read, it says the same`, `with open runs and a failed Finished read, the Finished group says it could not be read`, and `a held Finished answer is a signal even when its re-read fails`. Today's pins of review finding 19 and I6 in `runs-screen.test.tsx` stay green, moved to this source. The board is `api.runsPage`'s one PWA caller, and the Inbox and Mail keep the unpaged `loadColdRuns`. After this task the paged arm of `useColdRuns` feeds only `ChildReclaimBanner` (`cold`, RunsScreen.tsx line 336). Task 12a takes that last use away. The tests of `the program-level half of the resume door (D-1146)` in `runs-screen.test.tsx` stay green through this move: a hit carries `claimedBy`, so `coordinatorPresence` and `programsWithOpenRun` read as they do today. Task 19 moves the door.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Finished's read has its own state, `finishedState: 'loading' | 'ok' | 'error' | 'older'`, and its rows. In this task `noSignalYet` and `coldFailed` keep their meaning and read both sources: the paged arm's `coldState` and `finishedState`. `older` is set on a 400 `bad-request` or a 404 from `find`, and counts as answered. On `origin/main` the path reaches `GET /api/runs/:id`, which refuses "find" as an id with 400 `bad-request`, so a 404 alone would never fire. Any other failure is `error`.
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

### Task 12a: The top of the board (§8.2, §8.6, §9.4, F21, A48)

The surfaces above the list leave first, so Task 13's top-of-board and 667-tall pins measure the real board. `ReviewCapBand` cannot leave until review caps join `/waiting` in Task 24, so it sits below the band until then.

**Files:**
- Modify: `pwa/src/screens/RunsScreen.tsx`, `pwa/src/screens/RunsAdvancedScreen.tsx`, `pwa/src/screens/useColdRuns.ts`, `pwa/src/stores/fleet.ts`, `pwa/src/fleet/runWords.ts`, `pwa/src/fleet/ArchiveSheet.tsx`, `pwa/src/fleet/CollectLaneSection.tsx`
- Test: `pwa/test/runs-screen.test.tsx`, `pwa/test/runs-advanced.test.tsx`, `pwa/test/runs-pages.test.tsx`, `pwa/test/api-timeout.test.ts`

- [ ] **Step 1: Write the failing tests.** `CapsControl and ChildReclaimBanner render on Advanced and not on the board`, `the pause toggle lives under Advanced`, `the foot link still reaches them from the board, with no group act first`, `Start a programme sits in the header's actions slot`, `only the header, the search box and the paused banner sit above the list`, `ReviewCapBand sits below where the band goes`, `ChildReclaimBanner names a closed run from All runs' hits`, `ArchiveSheet and CollectLaneSection point at the new places`, `the Inbox and Mail still read the unpaged archive`. The board's states, with the paged arm gone: `before the first frame and before Finished answers, the board says Loading…, with data-state loading`, `a failed Finished read before any frame says Could not reach the server — runs may exist that are not shown., never No runs open.`, `with the frame seen, no open run and a failed Finished read, it says the same`, `with open runs and a failed Finished read, the Finished group says it could not be read`, `an older server's Finished reads as answered`, `with Finished answered ok and no frame yet, the open half says Loading… and never No runs open., and Finished's rows show`, `the same holds when the server never sends a frame`, and `no state reads the removed coldState`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** `RunHit` carries what the banner's run context needs: `program`, `programTitle`, `wave`, `waveOf` and `kind`. With that use gone, `api.runsPage`, the paged arm of `useColdRuns`, the store's `runPages` and `mergeFirstRunPage` have no caller, so they leave with their pins. With the paged arm gone, nothing but the frame lists open runs, so the open half keys on the frame alone: `noSignalYet = !runsFrameSeen`. While it holds, the open half shows Loading…, or the failed line once `finishedState` is `error`, whatever Finished answered. `coldFailed = finishedState === 'error'` keeps today's I6 lines. Finished's own rows show below as they arrive. So the open half never says "No runs open." before the first frame, even when Finished answered first or the server sends no frame. The server keeps `limit` and `before` on `GET /api/runs` (§11.4).
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 13: Heads and rows (§7, §8.2, §8.2.1, checks 1, 2, 4, 6, 9, 11, 12, 14, 15, A35 to A39, A43, A47, A54)

**Files:**
- Create: `pwa/src/fleet/stuckWords.ts`, `pwa/src/screens/StuckBand.tsx`
- Modify: `pwa/src/screens/RunsScreen.tsx`, `pwa/src/screens/RunRow.tsx` (Abandon leaves the ordinary row), `pwa/src/fleet/fleet.css`
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
expect(stuckLine(stuck('owner-gone', 'coordinator-archived', 49), now)).toBe('Coordinator archived 49 days ago · Nothing closes this on its own');
expect(stuckLine(stuck('owner-gone', 'coordinator-forgotten', 12), now)).toBe('Coordinator forgotten 12 days ago · Nothing closes this on its own');
expect(stuckLine(stuck('owner-gone', 'coordinator-removed', 12), now)).toBe('Coordinator removed 12 days ago · Nothing closes this on its own');
expect(stuckLine(stuck('owner-gone', 'coordinator-stopped', 8), now)).toBe('Coordinator stopped 8 days ago. Nothing has moved since · Nothing closes this on its own');
expect(stuckLine(stuck('owner-gone', 'coordinator-gone', 8), now)).toBe('Coordinator gone 8 days ago. Nothing has moved since · Nothing closes this on its own');
expect(stuckLine(stuck('owner-gone', 'worker-stopped', 8), now)).toBe('Worker stopped 8 days ago. Nothing has moved since · Nothing closes this on its own');
expect(stuckLine(stuck('owner-gone', 'worker-gone', 8), now)).toBe('Worker gone 8 days ago. Nothing has moved since · Nothing closes this on its own');
expect(stuckLine(stuck('owner-gone', 'name-reused', 3), now)).toBe('Its session moved to a later run 3 days ago · Nothing closes this on its own');
expect(stuckLine(stuck('review-of-closed', 'later-review', 3), now)).toBe('A later review moved on 3 days ago · Nothing closes this on its own');
expect(stuckLine(overtaken28, now)).toBe('A later wave moved on 28 days ago · Nothing closes this on its own');
expect(stuckLine(reviewClosed5h, now)).toBe('The work it reviews closed 5 h ago · Nothing closes this on its own');
expect(runMarker(run({ sessionId: 's', workspace: null }), false)).toBe('holds a session');
expect(heldBackLine(1)).toBe('1 holds a workspace or session: one at a time');
```

The line table is a `Record<StuckCause, ...>`, so a cause with no line does not compile. Also, in `stuck-band`: `heads keep the fixed order when Review falls to 1`, `an empty head leaves and nothing else moves`, `heads fold by default at every width`, `an opened head is remembered per viewer`, `a head's oldest equals the largest age its rows show, for every reason, in whole days and in hours under a day`, `Start never finished shows the held-back line and no control`, `a head of two reads Abandon 2…, not Abandon all 2…` (o1), `no would-close appears while every closes is null`, `Abandon sits only on stuck rows`, and `stuck never counts in a badge`. Census: `no healthy run renders above the band`. Task 20 pins Closed today below it, and Task 24 pins the final order. Browser, at each width, skin and theme: `the last head's bottom is within half a visible height of the fold at 667 tall`, `the visible height stops at the bottom bar`, `the last fold scrolls clear of the bar`, `every link on a phone is at least 44px`, `a head's group control sits on its own line when narrow and at the right from medium`. Task 20 pins the first card's place, because cards land in Task 18.

- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Rows and heads take the clock from the one page clock. Nothing in the row reads the network.
- [ ] **Step 4: Run** them, the browser leg included. Record the measured heads' end in the PR body, against the spec's half-screen measure. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 14: Abandon a group (§9.2, checks 8, A12, A13, A33, A34, A40, A41, A49, A61)

**Files:**
- Create: `pwa/src/fleet/groupAbandon.ts`, `pwa/src/fleet/GroupAbandonSheet.tsx`
- Modify: `pwa/src/screens/StuckBand.tsx`
- Test: `pwa/test/group-abandon.test.ts` (new), `pwa/test/group-abandon-sheet.test.tsx` (new)

**Interfaces:**
- Consumes: `api.abandonRun`, `heldBack`.
- Produces:

```ts
const ABANDON_CALL_MS = 30_000;   // C1 sets no limit on a POST, so the loop passes this
type GroupStanding = 'in-group' | 'moved' | 'closed' | 'unread';
interface GroupResult {
  abandoned: number[]; alreadyClosed: number[]; leftAlone: number[];
  refused: { id: number; sentence: string }[]; noAnswer: number[]; notReached: number[];
}
groupStanding(run: RunSummary | undefined, reason: StuckReason): GroupStanding;  // undefined: gone from the frame, so closed. stuck absent: unread. stuck null: moved
runGroupAbandon(list: readonly number[], deps: {
  abandon(id: number): Promise<AbandonAnswer>;   // api.abandonRun(id, { timeoutMs: ABANDON_CALL_MS })
  standing(id: number): GroupStanding;
  stopped(): boolean;
  onStep(done: number): void;
}): Promise<GroupResult>;
groupControlWords(free: number, total: number): string | null;
groupToast(r: GroupResult): string | null;   // null when the sheet must stay
groupToastHasLink(r: GroupResult): boolean;   // See them, only with something abandoned
groupSheetLines(reason: StuckReason, ticked: readonly RunSummary[], presence: (r: RunSummary) => CoordinatorPresence): { title: string; lines: readonly string[]; confirm: string | null };
groupSummary(r: GroupResult): string;
groupRunSentence(r: GroupResult, id: number): string;
```

- [ ] **Step 1: Write the failing tests.**

```ts
expect(groupControlWords(12, 12)).toBe('Abandon all 12…');
expect(groupControlWords(2, 5)).toBe('Abandon 2…');
expect(groupControlWords(2, 2)).toBe('Abandon 2…');   // o1: all only from 3 up
expect(groupControlWords(3, 3)).toBe('Abandon all 3…');
expect(groupControlWords(1, 1)).toBe('Abandon 1…');
expect(groupControlWords(1, 3)).toBe('Abandon 1…');
expect(groupControlWords(0, 2)).toBeNull();
expect(groupToast(res({ abandoned: 11, leftAlone: 1 }))).toBe('11 runs abandoned. 1 started moving and was left alone.');
expect(groupToast(res({ abandoned: 1 }))).toBe('1 run abandoned.');
expect(groupToast(res({ abandoned: 9, alreadyClosed: 2, refused: 1 }))).toBeNull();
expect(groupToast(res({ abandoned: 10, alreadyClosed: 2 }))).toBe('10 runs abandoned. 2 had already closed.');
expect(groupToast(res({ abandoned: 10, leftAlone: 2 }))).toBe('10 runs abandoned. 2 started moving and were left alone.');
expect(groupToast(res({ leftAlone: 3 }))).toBe('No runs abandoned. 3 started moving and were left alone.');
expect(groupToast(res({ alreadyClosed: 1 }))).toBe('No runs abandoned. 1 had already closed.');
expect(groupToastHasLink(res({ leftAlone: 3 }))).toBe(false);
expect(groupToastHasLink(res({ abandoned: 1 }))).toBe(true);
expect(groupToast(res({ abandoned: 3, noAnswer: 1 }))).toBeNull();
expect(groupToast(res({ abandoned: 3, notReached: 2 }))).toBeNull();
expect(groupSummary(res({ abandoned: 9, alreadyClosed: 2, refused: 1 }))).toBe('9 abandoned, 2 had already closed, 1 not:');
expect(groupSummary(res({ abandoned: 3, noAnswer: 1, notReached: 2 }))).toBe('3 abandoned, 3 not:');
expect(groupRunSentence(res({ noAnswer: [7] }), 7)).toBe('No answer. It may have closed.');
expect(groupRunSentence(res({ notReached: [7] }), 7)).toBe('Not reached.');
expect(groupStanding(undefined, 'overtaken')).toBe('closed');
expect(groupStanding(stuckRun('never-started'), 'overtaken')).toBe('moved');
expect(groupStanding(run({ stuck: null }), 'overtaken')).toBe('moved');
expect(groupStanding(run({ stuck: undefined }), 'overtaken')).toBe('unread');
expect(groupStanding(heldStuckRun('overtaken'), 'overtaken')).toBe('moved');
```

Loop: `one call at a time`, `each call passes ABANDON_CALL_MS`, `a run that moved is left alone`, `a run someone else closed counts as already closed, and the toast says so`, `a 409 with error bad-transition counts as already closed and continues`, `a 409 with unknown-run or refused, and a 404, count as that run's refusal and continue`, `501, 502 and registry-unmeasurable stop the loop, that run refused and the rest not reached`, `an unread run stops the loop, it and the rest not reached and never left alone`, `a timeout or a network failure stops the loop, that run no answer and the rest not reached, with no retry`, `Stop finishes the run in flight, within one limit`, `a run that joins after the sheet opens is not added`, and `every confirmed id ends in exactly one result`. Sheet: `a held run is never listed`, `unticking follows in the title and confirm`, `down to one uses the singular words`, `unticking to none disables Confirm`, `each of the five reasons has its sentence, in both numbers`, `every coordinator there reads Their coordinators are told.`, `some gone reads Live coordinators are told.`, `all gone, as on the Owner gone head, leaves the sentence out`, `the singular follows the same three cases`, `Abandon 1… opens the single sheet`, `no list when one run is free`, `left alone shows in the sheet only when it stays open`, `the part-done list puts each run not abandoned first, then each run that had already closed with This run already closed. and an Open record link` (o4), `no answer links to the run's record`, `onDone fires once when the loop ends`. Task 20 hangs Closed today's re-read on that. Risk pin: `a re-open is a new id and leaves programs.state alone`, in `server/test/run-reopen.test.ts`.

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

### Task 16: `GET /api/programmes` (§11.6, A26, A32, A55)

**Files:**
- Create: `server/src/coord/programmesRead.ts`
- Modify: `server/src/coord/routes.ts`, `shared/api.ts`, `pwa/src/lib/api.ts`
- Test: `server/test/programmes-read.test.ts` (new)

**Interfaces:**
- Consumes: `RunVerdicts`.
- Produces: `ProgrammeRow` with the fields of §11.6; `stuck`, a count, and `pendingClose`, one `{reason, count, soonestAt, armed}` per reason with a clock, both folded in from `RunVerdicts.all()`; `coordinatorGone?: boolean`, from the programme's open runs or `RunVerdicts.ofProgramme`; `closedToday: {operator, sweep, coordinator}`; `api.programmes(since: number)`.

- [ ] **Step 1: Write the failing tests.** `open comes from runs, never programs.state`, `a leftover review's abandon leaves a finished programme complete`, `since is clamped to the last 48 hours`, `one aggregate statement gives the run facts`, `stuck and pendingClose fold in from RunVerdicts, and the stuck count equals its entries for that programme`, `before the first pass both are absent`, `session only`, `a programme with a gone coordinator has a row`, `coordinatorGone reads from its open runs`, `a programme with no open run reads its own entry (D-1146)`, and `past the window the field is absent`.
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

### Task 18: Programme cards and Finished (§8.1, §8.2, §8.2.2, §8.2.3, checks 3, 10, A37)

**Files:**
- Create: `pwa/src/screens/ProgrammeCard.tsx`, `pwa/src/screens/usePrograms.ts`
- Modify: `pwa/src/fleet/programmeBoxes.ts` (extract the state step), `pwa/src/fleet/stuckWords.ts`, `pwa/src/screens/RunsScreen.tsx`, `pwa/src/fleet/fleet.css`
- Delete: `pwa/src/fleet/runGroups.ts`, `pwa/test/run-groups.test.ts` (F22)
- Test: `pwa/test/programme-card.test.tsx` (new), `pwa/test/stuck-words.test.ts`, `pwa/test/programme-box.test.ts`, `pwa/browser/runs-widths.browser.test.ts`

**Interfaces:**
- Produces: `motionState(lastMoveAt, now, quietMs, paused): 'paused' | 'stalled' | 'moving'`; `boxState` calls it after its needs step, and its answers stay pinned. `cardWord(motion, everyOpenRunStuck): string`, where every open run counts as stuck when it is stuck or waits behind a stuck run (`blockedBy`, o5). `programmeStuckLine(stuck: readonly RunStuck[], nowMs: number): string`.

- [ ] **Step 1: Write the failing tests.**

```ts
const mixed = [s(null), s(null), s({ at: now + 20 * H, armed: false })];
expect(programmeStuckLine(mixed, now)).toBe('3 stuck · ccrc would close 1 in 20 h');
expect(programmeStuckLine(mixedArmed, now)).toBe('3 stuck · ccrc closes 1 in 20 h');
expect(programmeStuckLine([s(null), s(null), s(null)], now)).toBe('3 stuck · nothing closes them on its own');
expect(programmeStuckLine(allAt20h, now)).toBe('3 stuck · ccrc closes them in 20 h');
expect(programmeStuckLine([s(null)], now)).toBe('1 stuck · nothing closes it on its own');
expect(programmeStuckLine([s({ at: now + 20 * H, armed: true })], now)).toBe('1 stuck · ccrc closes it in 20 h');
expect(programmeStuckLine([s({ at: now + 20 * H, armed: false })], now)).toBe('1 stuck · ccrc would close it in 20 h');
```

Also `the soonest time shows when times differ`, `armed wins over shadow`, `the zero forms read now and soon`, `a needing card keeps its motion word and carries needs you · 1`, `a programme with 3 stuck runs and 1 queued behind a stuck one reads stuck` (o5), `the last move reads moved 12m ago, the app's elapsed form` (o9), `boxState's answers are unchanged`, `a programme with a gone coordinator has a card`, `no run number on a card`, `a card's facts all appear in its header`, `cards sort needs you first, then by last move`, `a programme with no run opened or closed in 7 days folds under quiet programmes, and one at 6 days does not`, `the Finished fold ends with All runs, newest close first, which opens All runs`, and the three Finished endings. Browser: `cards are one across under 840, two across at 860, 912 and 1056, and one across in the broad list`.

- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them, then the browser matrix. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 19: The programme page's Runs section, and Resume on both pages (§8.4, §8.5, §9.5, F25, A46, A55, A56, A60)

**Files:**
- Modify: `pwa/src/ledgers/ProgrammeScreen.tsx`, `pwa/src/screens/RunDetailScreen.tsx`, `pwa/src/screens/RunRow.tsx` (Resume leaves the row), `pwa/src/fleet/ResumeSheet.tsx`, `pwa/src/fleet/runWords.ts`
- Test: `pwa/test/programme-screen.test.tsx`, `pwa/test/run-detail.test.tsx`, `pwa/test/resume-sheet.test.tsx`, `pwa/test/runs-screen.test.tsx`
- **Open regression carried in from Task 18 (A55):** Task 18 removed the board's `ResumeSheet` use and `RunRow`, so nothing in the app reaches Resume until this task; `pwa/browser/refusal-copy.browser.test.ts` (which waits for the `Resume run 4` button on `/runs`) is red 16 of 16 meanwhile. The Stuck band carries no Resume, so the fixture is not repointed at it. This task closes it by pointing that fixture at the programme head or the run page, and the PR does not land until `refusal-copy.browser.test.ts` is green (PR CI skips the browser leg, so run it locally).

**Interfaces:**
- Produces: `resumeShown(run: Pick<RunSummary, 'state' | 'coordinatorGone'>, presence: CoordinatorPresence, programHasOpenRun: boolean | null): boolean`, which is `coordinatorGoneOf` and D-1146's second half, with null, a frame not yet heard, hiding the door. `ResumeSheet`'s `run` narrows to `Pick<RunSummary, 'id' | 'program' | 'programTitle' | 'wave' | 'claimedBy'>`, so a `RunHit` feeds it.

- [ ] **Step 1: Write the failing tests.** `the header is a superset of the card`, `the header carries the pending-close line per reason`, `open waves newest first with reviews nested`, `a stuck row carries its Abandon`, `closed waves read through find with their close word and line`, `a failed closed waves read says Could not load closed waves. Try again. in the fold alone` (o13), `at a desk Waiting on you and Stored secrets sit under Goals, and Runs in the other column` (o8), `done reads with Closed by the coordinator on its line`, `Resume sits once on the head, shown from coordinatorGone`, `Resume shows on the run page from coordinatorGone`, `a live coordinator shows no Resume on either page`, `no row carries Resume`, `a claimant with no fleet row still shows Resume`, `an older server with no field reads coordinatorPresence`, `coordinatorGone false hides Resume over a presence of dead, as a substrate fault sends (D-7370)`. The D-1146 case: `an all-terminal programme with a gone coordinator shows Resume on its head`, `and on each of its closed run pages`, `a closed run beside an open wave shows none`, `a frame not yet heard hides it`, `Resume from the head of an all-terminal programme calls the reclaim for its newest run's claimant`. The D-1146 tests in `runs-screen.test.tsx` move here with their cases kept. `step 3 offers a picker with the typed id below it`, `the lead sentence comes first`, and `an owner-gone row carries Abandon and never Resume`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** No second programme page (A1). `programsWithOpenRun` stays the one source of the second half. Land in one PR with Task 18.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 20: Closed today, the first card's place, and the words (§8.2, F27, A32, check 11)

**Files:**
- Modify: `pwa/src/screens/RunsScreen.tsx`, `pwa/src/fleet/StartProgramSheet.tsx`
- Test: `pwa/test/runs-screen.test.tsx`, `pwa/test/group-abandon-sheet.test.tsx`, `pwa/browser/runs-widths.browser.test.ts`

- [ ] **Step 1: Write the failing tests.** `the board's order is header, search, paused banner, Stuck, Closed today, Waiting band, ReviewCapBand, programmes, quiet, Finished, foot`, `Closed today links each count through runsAdvancedPath with its filter and closedSince`, `it shows only once a close landed today`, `a zero count is left out: Closed today: 5 by you · 60 by coordinators` (o6), `midnight is the operator's local day`, `Closed today re-reads when a group loop ends and never adds locally`, `Start a programme replaces every "program" on this screen`. Browser: `first programme card under 800px at Instrument 1920`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them, then the full matrix. Check §17's page budgets, and report them with the first card's measured place, against the spec's inferred 742px. Expected: PASS.
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
- Modify: `server/src/coord/ledgersRoutes.ts` (`registerLedgerOperatorRoutes` takes `withAbandon`), `server/src/server.ts` (the one call site, which passes it), `server/src/coord/routes.ts` (the handle's arm takes an optional detail), `server/src/coord/close.ts`
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

- [ ] **Step 1: Write the failing tests.** `an end-run row carries Abandon run and Keep the run, at the right from 640 and on their own line below it`, `Abandon run opens the single sheet and calls act`, `Keep the run confirms and calls decline`, `the row line ends in one of the three origins`, `a held item is on no list or badge`, `a review cap is a /waiting row with Lift cap on it`, `/runs has one surface called Waiting on you, which is none`, and `the board's order is exactly §8.2's, with no ReviewCapBand`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them, then the browser matrix for `/waiting`. Expected: PASS.
- [ ] **Step 5: Commit.**

## Wave B7: never-started runs close themselves (D-8077)

Reuse the ruled plan's Task W1 (`2026-10-21-runs-auto-expire-and-programme-view.md`, D-6171) with the amendments of spec §12, and leave out the `untold` rows, which Task 12 landed. Read `lastDispatchAttemptAt`, the warning, the budget and rules R1 to R8 from it.

### Task 25: The lane rows E1 and E1r, and `closes` (§7, §12, A35, A36, A53, A57, A58)

**Files:** as W1 lists, on one `LANE_SCHEDULE` row, plus `server/src/coord/runStuck.ts` and `server/src/coord/runVerdicts.ts`.
- Test: as W1 lists, plus `server/test/run-stuck-closes.test.ts` (new)

**Interfaces:**
- Produces: `rowAnchor(row: LaneRowName, facts: LaneAnchorFacts): number | null`, which gives §7's anchor per row and is the one place a row's activity enters; `closesOf(row: LaneRowName, anchor: number | null, warning: WarningRead | null, armed: boolean, nowMs: number): { at: number; armed: boolean } | null`. The lane and the verdict read the same predicates, so `RunStuckFacts` gains `e1Quiet`, which adds `never-started`'s quiet arm at 48 h, and `laterReviewMoved`, which adds `review-of-closed`'s `later-review` cause. The lane writes every run's answer with `RunVerdicts.setCloses`, whole, on each of its passes, and an empty map while it holds.

- [ ] **Step 1: Write the failing tests.** W1's pins, plus: `at comes from the anchor, never the run's age`, `a 50-day-old run in its first pass reads the full grace`, `E1r is anchor plus 1 h`, `shadow E1 is anchor plus 72 h`, `armed E1 is no earlier than deliveredAt plus 24 h`, `armed E1 before the warning is due reads the same at as shadow`, `armed E1 with a warning on its way reads the later of anchor plus 72 h and 24 h from now`, `armed E1 with a warning 24 h undelivered has closes null`, `closes is null while the lane holds and on an uncertain reading`, `activity on the programme moves E1's at later`, `a mail or a dispatch attempt leaves E1r's at where it was`, `a gap restarts E1r's at`, `closes.at never reads later than the moment the lane closes`, `in shadow, a run with an open PR or unpushed commits has closes null, reads Nothing closes this on its own and raises no item`, `armed, a refused close sets closes null`, `E1r's check on a live session` for run 1085's shape: `a run E1r fits with a live session has closes null and reads Nothing closes this on its own`. `an archived coordinator's planned runs, such as 65, 66 and 83, read E1 with hours` (o2). The map (A57): `a planned run on day 4 of a quiet programme reads never-started and carries closes`, `a quiet programme with two planned waves carries closes on both`, `a programme quiet for 47 h has no quiet-arm verdict`, `E1r's later-review arm reads review-of-closed with later-review`, `an overtaken run E1 reaches keeps its reason and carries closes`, and, for each row this wave lands, `every run the lane lists has a verdict`. The reader: `a verdict pass keeps closes`, `a row never flips to Nothing closes between a verdict pass and a lane pass`, `a run the lane no longer lists loses closes`, `a holding lane clears the map`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Land after B4, in shadow (A48).
- [ ] **Step 4: Run** them, then `stuck-words` to confirm the screen needed no change. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 26: Arming from the UI (§12.3, A15)

**Files:**
- Modify: `shared/switches.ts`, `server/src/coord/routes.ts` (`GET/POST /api/coord/run-close`), `pwa/src/screens/RunsAdvancedScreen.tsx`
- Test: `server/test/run-close-switch.test.ts` (new), `pwa/test/runs-advanced.test.tsx`

- [ ] **Step 1: Write the failing tests.** `three states per group, default shadow`, `a row shows its state word, Turn off and Turn on, and Back to shadow when on` (o7), `Turn on lists every run that would close once on, with reasons, and counts those closing now and those closing when their time runs out`, `a run the row fits but the lane holds, such as 1085 with a live session, is named under the list and not in it`, `a run whose E1 warning cannot be delivered, such as 65, 66 and 83 under an archived coordinator, is named under the list and not counted in it` (o2, A58), `the Advanced row's count matches the sheet's`, `while coordination is paused every row reads held with no would-close list, Turn on is disabled, and POST /api/coord/run-close refuses to arm` (o12), `session only`, `a marker remains an emergency override`, `the crash row gets the same control`, `closes and refusals of the last 7 days show per group`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** The operator arms after 3 days of shadow and reading the list. No session arms a lane.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 27: Refused closes go to the coordinator, then to an item (§10, §12.2, A19, A59, A62). Needs B6.

**Files:**
- Modify: `shared/ledgers.ts` (`action` widens), the lane, `server/src/runClose.ts` (one decider row per refusal), `server/src/coord/ledgersRoutes.ts`, `pwa/src/ledgers/WaitingScreen.tsx`
- Test: `server/test/ledger-routes.test.ts`, `pwa/test/waiting-screen.test.tsx`

**Interfaces:**
- Produces: `ItemAction` gains `{ verb: 'close-refused'; runId: number; doors: readonly [ItemDoor, ...ItemDoor[]] }`, so an item with no door does not compile; `ItemDoor = 'open-pr' | 'hand-to-coordinator' | 'abandon' | 'abandon-anyway' | 'open-worker' | 'open-coordinator'`; `refusalRoute(reason: RefusalReason, coordinator: 'lives' | 'gone', abandonable: boolean): { kind: 'tell' } | { kind: 'tell-and-hold'; heldUntilMs: number; doors: ItemAction['doors'] } | { kind: 'item'; doors: ItemAction['doors'] } | { kind: 'inform' }`, pure, one row per line of §12.2's table. `abandonable` is `abandonRefusal(coord, runId) === null`, read inside the lane's hold. `inform` puts the run on the board's information line and one feed row, and raises no item. `REFUSAL_DOORS: Record<RefusalReason, readonly ItemDoor[]>` is the one table of each raising row's doors.

- [ ] **Step 1: Write the failing tests.** The decider, one case per cell of §12.2's table. `an open PR under a live coordinator tells it and raises no item`, `so do unpushed commits`, `an asleep coordinator counts as living and is not woken`, `the notice is record-only and rides untold`, `a refusal that lasts tells once, by the lane's anchor`, `a changed reason tells again`, `the row reads Nothing closes this on its own with no marker while only told`, `an unreadable marker under a live coordinator is held ASK_GRACE_MS and is on no list until then`, `a withdraw inside that hold means the operator sees nothing`, `a coordinator that goes gone turns the refusal into its item on the next pass`, `under a gone coordinator each refusal raises its item at once, raised by ccrc`, `an absent claimant with no history shows at once, with Abandon`, `an unreadable marker's item carries Abandon and the sheet's cannot tell sentence, and the act runs as today` (n1: R1 binds the lane only), `an unknown run raises no item, and shows once on the board's information line and once in the feed, under a live or a gone coordinator`, `under a live coordinator it is also told, and the notice asks nothing`, `a run abandonRefusal refuses for any reason raises no item, under a live or a gone coordinator`, `a closing run's line says it is already closing`, `an act-time refusal of an item's Abandon shows in the sheet and leaves the item raised` (n4). `refusalRoute` returns `inform` for an `unknown` run whoever owns it, and the lane also tells a live coordinator. The control pin, which fails on an empty list: `the list of cells that raise an item is not empty, and holds the seven cells of §12.2 that raise one`, `every such cell names at least one door`, `each Abandon or Abandon anyway door, run against that cell's fixture run on a real store, is accepted by POST /api/runs/:id/abandon and ends the run`, `each Hand to a coordinator door is accepted by POST /api/runs/:id/reclaim under a gone claimant`, `each link door opens a page that exists for that run`, and `each door renders on the row`. The fixtures cover a run in every open state the lane can raise for, and the decider is run on each first. A fixture the decider routes to `inform`, such as a `closing` run, is checked as inform: no item and its information line. A fixture the decider routes to an item whose door the route then refuses from the row fails the pin. `Abandon anyway reuses act, with The branch stays on disk.`, `decline applies to end-run alone`, `a warning 24 h undelivered raises Open the coordinator at once`, `settle closes the item when the reason has gone`, `the row gains needs you from the selector`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit.**

## Wave B8: coordinator gone (D-8078)

### Task 28: Rows E3, E3s and E5

Reuse the ruled Task W2 (D-6172) with spec §12's amendments. `closesOf` gains these rows at §7's graces. `runStuck` gains `name-reused` with E5, and `run-stuck-closes.test.ts`'s `every run the lane lists has a verdict` gains these rows. Rows read `claimantGone`, so a substrate stamp holds them as it holds the verdict (A56).

- [ ] **Step 1: Write the failing tests.** W2's pins, plus `E3 and the crash row read the first pass plus 1 h`, `E3s the first pass plus 24 h`, `E5 the next pass`, `activity leaves E3, E3s, E5 and the crash row where they were`, `a busy worker under a gone coordinator has closes null`, `E5's condition reads owner-gone with name-reused`, `a substrate stamp on the claimant holds E3, E3s and the crash row, with no close and no closes`, `65, 66 and 83 stay on E1 with hours and E3 gives them no closes` (o2, §12.2's precedence rule).
- [ ] **Step 2: Run** them, then implement, then run them again. Expected: FAIL, then PASS.
- [ ] **Step 3: Commit.**

## Wave B9: worker gone (D-8079). Held by #119.

### Task 29: Rows E2 and E4

Reuse the ruled Task W5 (D-6175) with spec §12's amendments. This does not start until #119 lands.

- [ ] **Step 1: Write the failing tests.** W5's pins, plus `417 and 848's shapes reach a row`, `E2 the first pass plus 1 h, and activity leaves it there`, `E4 the latest of its run's last activity, the first pass and workerLastSeen, plus 24 h`, `activity on the run moves E4's at later`, `activity on a sibling run does not`, `every run the lane lists has a verdict`, for these rows.
- [ ] **Step 2: Run** them, then implement, then run them again. Expected: FAIL, then PASS.
- [ ] **Step 3: Commit.**

## Acceptance

After each PWA wave, run `pwa/browser/runs-widths.browser.test.ts` and compare its figures with spec §17. Live counts come from repeating Task 1's read, with the operator's yes. After B4 the operator should be able to clear today's stuck set in 18 taps, with a toast and a record for each close.

## Rollback

Each PWA wave reverts as its PR. New wire fields are optional, so a revert leaves older readers working. Lanes fall back to shadow from Advanced.

Migrations add columns, an index and one table, `gone_since`, with one exception: Task 2's migration rewrites every `programs.title`, so reverting B1's code leaves the new short names in place. To restore them, run the statement that `run-titles.test.ts` pins, which sets each `programs.title` from its newest run's `title` (spec §18). `RunVerdicts` is in memory, so it needs no rollback. The `gone_since` table stays on a revert, and an older build never names it.

## Deviations found

Issued by the allocator on 2026-11-06, one per wave, and defined here, with D-8099 for the extra pass of 2026-11-07 and D-8115 for the operator's frames verdict that day. None has shipped.

- **D-8071 (2026-11-06)** — B1, the runs screen's server facts: a run keeps its own title, the close columns are stored, one stuck verdict, `GET /api/runs/find` and `GET /api/runs/:id/record`.
- **D-8072 (2026-11-06)** — B2, find and open: `/runs/<id>` for any run, its controls and trail, one layout rule with the broad pane, the search box and palette entries, every row opens and says what it waits on, and spend leaves the row.
- **D-8073 (2026-11-06)** — B3, abandon with proof: the sheet's new sentences and toast, `/runs/advanced` with All runs in close order, and the coordinator told of a close.
- **D-8074 (2026-11-06)** — B4, the Stuck band: the switches leave the top of the board, heads in a fixed order and folded at every width, group abandon with six results that add up, and the Waiting on its coordinator band. Operator rulings of 2026-11-08, after Task 1's live read (27 stuck: owner-gone 5, start-never-landed 2, review-of-closed 12, overtaken 7, never-started 1): R1, never-started's "nothing else open" counts only open runs that are not themselves stuck, so `runStuckPass` stops counting stuck open runs in `aloneInProgramme` (a run's own verdict depends on it, so the other reasons are computed first or the pass runs to a fixed point), and a planned run whose only other open runs are stuck reviews reads never-started; R2, a run with a stuck verdict never joins Waiting on its coordinator (Task 15), so an owner-gone run that is also awaiting-review appears in the Stuck band alone. Spec §7 (reason 5) and §8.2 item 6 carry the same words. Task 12a, as built: the paused banner draws for `set` and `unmeasurable` alike (a registry that cannot be read is a pause dispatch cannot rule out); `useRunList` gained `timedOut`, so the board keeps its "Could not load runs. Try again." line now that the paged arm's `timedOut` is gone; while no frame has landed a Finished row is handed `programHasOpenRun` true, so it offers no Resume against an open wave nobody has listed yet; the "Start a program" label keeps its spelling until Task 20 (F27). Task 13, as built (2026-11-09): R1 is in `runStuckPass` (the other reasons are read first with `aloneInProgramme` false, then a loop turns never-started on for a run alone among unstuck open runs until no verdict changes); a head's group control is drawn disabled until Task 14 wires its sheet, and `groupControlWords` is defined in `stuckWords.ts` (Task 14 imports it); a stuck run is listed in the band and also stays in its programme's group, rows, counts and wave heading, because the band is a second view and not a move (§8.2.2; fix-forward 2026-11-09, which keeps the Resume door of an owner-gone run on the board until Task 19); the abandon sheet opened from a stuck row repeats `stuckLine`; open heads are kept per viewer in `localStorage` under `ccrc-runs-stuck-open`. Task 15, as built (2026-11-09): `WaitingBand` and `isWaitingOnCoordinator` live in `StuckBand.tsx`; the band is one folded row (its fold kept per viewer under `ccrc-runs-waiting-open`) under the Stuck band, takes open `awaiting-review` runs with `waitsOn` `coordinator`, `lastMoveAt` over a day old and no stuck verdict (R2), and its rows carry the run's door, its wait line (or "Waits behind a stuck run." linking `blockedBy`) and "Open the coordinator" when the claimant has a session, with no Abandon; the section uses `waiting-band`, not `stuck-band`, and the width pins scope the heads to `[data-testid="stuck-band"]`; `groupAbandon.ts` declares L4 in its header (Task 14 left `pwa-rings` red).
- **D-8075 (2026-11-06)** — B5, programmes: `GET /api/programmes`, one needs-you selector, cards that keep their motion word, the programme page's Runs section, and Closed today below the band. Task 18 fix-forward (2026-11-09): a card with no known last move waits for the programmes read; `QUIET_AFTER_MS` is the twelfth seven-day quantity in `token-shared`'s holders pin.
- **D-8076 (2026-11-06)** — B6, action on the item: end requests with the coordinator first, `act` and `decline`, and review caps on `/waiting`.
- **D-8077 (2026-11-06)** — B7, never-started runs close themselves, as D-6171 amended by the rebuild spec: `stuck.closes` from the lane's anchor, arming from Advanced, and refused closes as items.
- **D-8078 (2026-11-06)** — B8, coordinator-gone rows, as D-6172 amended by the rebuild spec.
- **D-8079 (2026-11-06)** — B9, worker-gone rows, as D-6175 amended by the rebuild spec, held until #119 lands.
- **D-8099 (2026-11-07)** — the runs plan's three fixes past the review cutoff: every Waiting on you item names a control that works and Task 27's pin fails on an empty list, the board keeps its reading and failed states and Finished works against an older server, and owner-gone ages count from stored times.
- **D-8115 (2026-11-07)** — the operator approved the frames and ruled A35–A61, the 14 open points and n1–n4 as recommended.
