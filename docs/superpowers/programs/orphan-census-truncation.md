# Program: orphan-census-truncation

Spec: GitHub issue #1565, and the fleet disk retention spec's §2.3 (`docs/superpowers/specs/2026-10-23-fleet-disk-retention-design.md`).
Plan: `docs/superpowers/plans/2026-10-26-orphan-census-truncation.md`. The wave's worker commits it as its PR's first commit.
Workspace: each wave's child workspace, minted by its dispatch.

A two-wave programme. The coordinator's hourly update probe found the orphan-tree lane inert on a loaded fleet box. Its
census meets its 60 s bound, answers `truncated: true`, and the lane then waits the full 6 h, silently. Its pressure
cadence is never wired either. On 2026-10-26 the operator approved a fix in answer to a question in chat ("File and run a
one-wave fix"), and #1565 was filed. The coordinator split the fix into two waves, because the pressure wiring needs one
line in a file another wave holds under claim (below).

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | A truncated census is retried with a back-off, starting at `ORPHAN_RETRY_MS`, and each one writes a feed row that names the rows seen and the seconds taken. The unreadable arm's retry gets its first row. | #1569 | **DONE** 2026-10-26 13:00 UTC: #1569 merged at 12:59:10 as `dec889f5f`. Its tree equals the merge-tree of the reviewed tip `9efdbd52d` onto its parent `f70956cc3`. Run 986 is closed `done`, with its workspace released. Was **ACCEPTED, IN THE MERGE QUEUE** 2026-10-26 12:36 UTC: review 990 at `9efdbd52d` found one important finding (F1, latent until wave 2) and three minor ones, all carried to wave 2 below. Its CI was green at the tip, with 35 checks passing. The PR was enqueued at 12:36:55, at position 4. Was **IN REVIEW** 2026-10-26 12:16 UTC: review run 990, on the held-out panel plus a lens on load and on failing toward keeping. The wave-done (mail 10145) re-measured at `9efdbd52d`: the workspace branch, the handoff and the PR head agree, the PR touches the plan and three server files only, and it merges cleanly. Was **DISPATCHED** 2026-10-26 11:56 UTC, run 986. |
| 2 | First, F1's fix: the due instant is stored apart from the cadence, so a change of pressure can only lengthen a pending retry. Then pressure reads the disk alarm's critical state (`DiskAlarmLane.block()?.pressure`), through a third port on `OrphanTreeBeat` and one line in `server/src/watch.ts`. | #2183 | **DONE** 2026-11-03 11:27 UTC: #2183 merged through the merge queue at 11:26:13 as `0d3128e1c`. Its tree equals the merge-tree of the reviewed tip `056aa7a85` onto its parent `bf3dd1232`. Run 992 is closed `done`, with its workspace released and its reclaim queued. Was **ACCEPTED, IN THE MERGE QUEUE** 2026-11-03 10:52 UTC: review 1376 at `056aa7a85` found nothing that blocks (below). The full-mode CI run 41598916386 on that head passed every Linux leg, including all 12 server shards. It reads `cancelled` only because two macOS legs failed or hit their cap, and macOS legs gate nothing (operator ruling, 2026-09-28). The landing verdict read the native queue, the four required checks passed, and the PR was enqueued bound to `056aa7a85`, at position 2. Was **IN REVIEW** 2026-11-03 08:11 UTC: review run 1376, on the held-out panel plus a lens on clocks and on failing toward keeping. The wave-done (mail 14185) re-measured at `056aa7a85`: the workspace branch, the handoff and the PR head agree, the PR touches eight files, and it merges cleanly. Was **DISPATCHED** 2026-11-03 06:56 UTC, run 992. Was **PLANNED** as run 992, opened 2026-10-26 12:36 UTC. It stays held until #1558 lands after the soak gate, and then follows the live claims on `watch.ts`. Before dispatch, the coordinator mails the broker's coordinator to agree order with its two wave-4 PRs. **2026-11-02:** #1558 has merged and no live claim holds `watch.ts`; the run is still planned and not dispatched. |

## Decisions & deviations

- **Deviation block:** four numbers, 6987 to 6990, issued 2026-10-26 for wave 1. The worker gives them to the back-off,
  the feed row, the unreadable arm's row, and a spare.
- **Server side only.** `ccd`'s census verb is not touched, because #1404 is moving that code. The census answer carries
  only `truncated: boolean`, so the row names the rows seen and the seconds the census took, and copies no ccd constant.
- **A back-off, not a flat retry.** A flat 15-minute retry on a box that always truncates would run a 60 s walk 96
  times a day, on the box whose load caused the truncation. The wait doubles from `ORPHAN_RETRY_MS` up to the regular
  6 h, and a whole census resets it.
- **The strict reading stays.** A truncated pass audits nothing, not even trees the lane already knows (spec §2.3).
- **health() is unchanged.** `DiskOrphanTrees` has no field for a census outcome, and adding one would change the wire.
- **The plan** was drafted by workflow `wf_0ee53f23-476` (a Sonnet scout, an Opus planner and an Opus critic) at `ea1e84c09`, and ruled by the coordinator. The plan's closing section holds the rulings.
- **Routing:** a worker executing a spec'd plan, one small dependent chain. That is Opus at high effort, Sonnet high
  subagents, workflows off and compaction at 40. The review uses the held-out panel.

- **The worker's two open readings, ruled 2026-10-26 12:16 UTC.**
  - (a) The back-off's cap is the pass's cadence (`censusMs`), which equals `ORPHAN_CENSUS_MS` until wave 2: accepted.
  - (b) An unreadable census neither resets nor extends the truncated streak: accepted.

- **Review 990 (2026-10-26 12:36 UTC): wave 1 accepted, and its findings carried to wave 2.**
  - **F1 (important, latent).** A rise in pressure after a truncated census re-asks the census on the next tick, so the
    back-off is skipped. The retry instant is stored as `now - censusMs + waitMs` with the writing pass's cadence, and it
    is tested with the reading pass's own. The unreadable arm, unchanged from `main`, has the same shape. No pass can read
    pressure until wave 2 wires it (`orphanTreeBeat.ts` passes `pressure: () => false`), so the defect cannot fire at
    wave 1's tip. Wave 2 may not land without the fix: a due instant stored apart from the cadence, so a change of
    pressure can only lengthen a pending retry. A row pins each direction.
  - **F2 (minor).** No row pins that the truncated arm passes the pass's own `censusMs`. Wave 2's pressure knob on the
    rig pins it.
  - **F3 (minor, disclosed in deviation 6987).** The streak starts over on every server restart. On a box where every
    census truncates, that means six bounded walks in the first 7 h 45 min after each restart. Wave 2 either keeps
    this, saying so, or persists the streak.
  - **F4 (minor).** The plan's anchors drift by one line at the tip, so wave 2's plan edit corrects them.

- **2026-10-26 15:14 UTC - shared-file landing order updated (mail 10247).** The broker's coordinator says two wave-4
  PRs will claim `server/src/watch.ts` for its frame and compaction. Wave 2 does not start just because the calendar
  reaches 10-31: #1558 lands first, then the live claims determine order. Mail the broker's coordinator before
  dispatch and agree the order; do not bypass or break a standing claim. F1 still goes first and blocks landing.
  The operator's shorter gates for the broker's later waves do not move the current seven-day gate by themselves.

- **2026-11-02 UTC: the ledger lands on `main`, and wave 2's gates are re-measured.** Until today this ledger existed
  only on the coordinator's workspace branch. It lands now on its own ledger PR, with only this entry and row 2's state
  added. Measured today: #1558 merged on 2026-10-27 at 12:21 UTC as `66fd18299`. Of the project's two live claims,
  neither names `server/src/watch.ts`. Run 992 is still `planned`, with no worker. The broker's soak obligations were
  waived on 2026-10-28 (waived, not passed). Every suite and typecheck now runs through `ccrc test`, which queues heavy
  runs fleet-wide. This entry dispatches nothing: the next-wave brief's mail to the broker's coordinator and its claim
  read still come first.

- **2026-11-03 06:56 UTC: wave 2 dispatched as run 992, on the operator's word ("Dispatch if still relevant").**
  - **Still relevant:** a read-only audit at `408d93806` (three Opus agents) found F1's shape in both arms of
    `orphanTreeLane.ts`, the `pressure: () => false` stub in `orphanTreeBeat.ts`, and the wiring site at `watch.ts:988`:
    one line, no new import.
  - **Deviation block:** four numbers, 7864 to 7867, issued at dispatch (wave 1's block was spent).
  - **F3, ruled by the coordinator:** the streak stays in memory, and the README paragraph and the PR body say so. F1
    goes first, in both arms, with a row for each direction. The new `watch.ts` source pin is built on
    `server/test/scan`, so the ARCH-06 ratchet does not move.
  - **The gate this ledger set was kept.** Before dispatch the coordinator mailed the broker's coordinator (mail 14131).
    No live claim named `watch.ts`. The broker's frame PR had merged, and its compaction PR does not touch the orphan
    beat, so whichever lands first lands and the other merges `main`. README.md was then under the broker's claim
    (#1619). Consent for the one lane paragraph came in mail 14132, and the worker edited README last.
  - **One coordinator defect, fixed by mail before any edit.** Both of this coordinator's waves, this one and the box
    settings view's run 1369, edit `watch.ts`, and neither brief said so (clause 10). Run 1369 holds the file under
    claim. Mail 14148 cleared this wave's one line under that claim, and mail 14149 told this wave to edit that line only
    and claim nothing in `watch.ts`.

- **Review 1376 (2026-11-03 08:19 UTC): wave 2 accepted, with no fix round.** The held-out panel plus a clocks lens:
  24 agents, none died, no lens unverified. Its suites passed at the tip.
  - **F1 (low).** The middle commit `1c6189ecd` does not typecheck, because the beat's new third parameter is required
    one commit before `watch.ts` passes it. The tip is consistent, and the squash merge removes the middle commit. No
    change.
  - **F2 (advisory).** The plan's Review Focus says an unmeasured disk read is pinned to the 6 h side. Only the `null`
    half is pinned: what `unmeasuredDiskBlock` (`server/src/disk.ts`) reports as `pressure` is not pinned by any test.
    The behaviour is the disk alarm's deliberate standing-critical hold, and it errs toward more reads, never toward a
    removal. **Follow-up, not dispatched:** pin `unmeasuredDiskBlock`'s pressure in `disk-sweep.test.ts`, a file this
    PR did not touch.
  - **F3 (advisory).** The plan's run line omits the README citation and docs-parity suites, which ruling 6 requires
    when README changes. The PR body lists them green at the head, and the panel re-ran them at the tip (145 of 145).
    No change.
  - **Refuted by the panel and kept as a measured behaviour:** a back-off already stored at the 6 h cap is not cut
    short when pressure rises after it. That is deviation 7864's rule, pinned by a test and stated in the README. The
    coordinator accepts it.

- **2026-11-03 10:52 UTC: the worker's `suite: red` is arbitrated as load.** Its local whole-suite run was killed in
  the test slice after two 20 s timeouts in `delegation-recovery.test.ts`, a file this PR does not import. The full-mode
  CI run on the same head passed every Linux leg. #2183 was enqueued bound to `056aa7a85`.

- **2026-11-03 11:27 UTC: the programme is complete.** #2183 merged as `0d3128e1c`, the merged-mail went to the worker
  first (mail 14296), and run 992 closed `done` with `final: true`. Both waves of #1565 are on `main`: a truncated or
  unreadable census is retried with a back-off whose due instant ignores later pressure, and pressure now reads the disk
  alarm's critical state. The one open item is F2's follow-up above.

## Carried constraints

None open; the programme is complete. Historical, for the record:
- No edit to `server/src/watch.ts` in wave 1, and none to `ccd/ccd`.
- Suites run one file at a time at idle priority while the delegation broker's soak runs. That soak was waived on
  2026-10-28.

## Next-wave brief

None: both waves have landed. If the operator wants F2's follow-up, it is one small change to
`server/test/disk-sweep.test.ts`. It pins the `pressure` that `unmeasuredDiskBlock` reports for each held level, and it
belongs to the fleet disk retention work rather than to a wave of this programme.
