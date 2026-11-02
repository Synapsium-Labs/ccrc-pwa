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
| 2 | First, F1's fix: the due instant is stored apart from the cadence, so a change of pressure can only lengthen a pending retry. Then pressure reads the disk alarm's critical state (`DiskAlarmLane.block()?.pressure`), through a third port on `OrphanTreeBeat` and one line in `server/src/watch.ts`. | — | **PLANNED** as run 992, opened 2026-10-26 12:36 UTC. It stays held until #1558 lands after the soak gate, and then follows the live claims on `watch.ts`. Before dispatch, the coordinator mails the broker's coordinator to agree order with its two wave-4 PRs. **2026-11-02:** #1558 has merged and no live claim holds `watch.ts`; the run is still planned and not dispatched. |

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

## Carried constraints

- No edit to `server/src/watch.ts` in wave 1, and none to `ccd/ccd`.
- Suites run one file at a time at idle priority while the delegation broker's soak runs.

## Next-wave brief

Before wave 2 dispatch, mail the broker's coordinator, prove #1558 merged, and read the live `server/src/watch.ts` claims. Agree ordering with its wave-4 frame and compaction PRs. Its brief names the plan's "Wave 2" section,
re-reads `watch.ts` at its base, and checks the wiring against the soak's lane-path rule before a tap carries it.
