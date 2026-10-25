# Program: tmp-sweep-census-fix

Spec: `docs/superpowers/specs/2026-10-23-fleet-disk-retention-design.md` §2.1 and §2.2.
Plan: `docs/superpowers/plans/2026-10-25-tmp-sweep-census-test-run-rows.md`. The wave's worker commits it as its
PR's first commit.
Workspace: the wave's child workspace, minted by its dispatch.

A one-wave programme. On 2026-10-25 the operator said "Proceed" to a report from the centralised update management
programme's hourly monitoring. That report said the tmp sweep's census has been read as malformed since 07:07 UTC: the
sweep's test-run arm writes `moved` rows with an empty session id and uuid, and the server's reader refuses them. The
fleet disk retention plan that shipped both halves (#1246, #1261) is owned by a session that is now stopped, so this
programme carries the fix.

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | The reader accepts a session-less `test-run` row and parses its id and uuid as "no session"; receipts never mail one; the spec says what the writer writes; a contract row runs the real sweep's census through the reader. | #1378 | **LANDED** 2026-10-25 12:13 UTC as `9e1e45615`, first released in v0.0.681; run 941 closed `done` (final) at 12:28 UTC, its child workspace queued for reclaim. Left: the first server boot on v0.0.681 or later must log no malformed census line. Was **IN THE MERGE QUEUE** 2026-10-25 11:55 UTC: review 945 on fix round 1 found no critical and no important finding (two minor advisories, carried); the rulings are recorded verbatim; run 941 at merging, `d9a939af8` queued at position 2. Was **IN REVIEW, ROUND 2** 2026-10-25 11:22 UTC: fix round 1's wave-done at `d9a939af8` (tip, PR head and handoff re-measured equal; two files, tests and the plan; merge-tree clean), moved to awaiting review; review run 945 dispatched on the delta. Was **FIX ROUND 1** 2026-10-25 11:08 UTC, ruled on review 942 at `41bbe7ead`: one important test gap (the carve-out's kind clause was held by no test) and a hermetic positive parse, with the gates recorded; run 941 back at working. Was **IN REVIEW** 2026-10-25 10:38 UTC: wave-done at `41bbe7ead` (tip, PR head and handoff re-measured equal; merge-tree clean), moved to awaiting review; review run 942 dispatched with the held-out panel and a writer-reader contract lens. Was: dispatched 10:12 UTC as run 941. |

## Decisions & deviations

- **The reader follows the writer.** The writer has been in the field since v0.0.637 and is the census's only writer.
  The spec names the `moved` row's fields but not what a test-run row carries in them. So the reader changes, and the
  writer stays as it is. The parsed row says "no session" as its own value, not an empty string, so that no caller can
  mistake it for an id.
- **Deviation block:** two numbers, 6854 and 6855, issued 2026-10-25 to this programme. The first is the reader's
  carve-out. The second is a spare, which the worker spends only on a departure found while executing.
- **Routing:** a worker executing a spec'd plan, as one dependent chain that fits one context. That is Opus at high
  effort, Sonnet high subagents, workflows off and compaction at 40 (the routing matrix's worker row). The review uses
  the held-out panel.

## Carried constraints

- From review 942, not this wave's (minor, all pre-existing or documentation):
  - README's test-run arm text does not say that its rows name no session.
  - A live output-capped row is mailed under the "moved into quarantine" heading, although nothing was quarantined.
  - A failed journal unlink after the census rename can fold the same rows twice and send a second receipt.
  - Only two of the writer's shapes have a contract row that runs the real sweep.
  - The spec's census paragraph names a `task-output` kind no writer emits, and omits `top` and `keptMore`.
  - CLAUDE.md says `test-macos` runs the selection on a pull request, which it skips.
- From review 945 (minor): the A2 comment is two sentences where the ruling asked for one, and the plan's line for fix
  round 1's gates names no commit. Every count re-measured equal at the tip.
- `tmp-sweep.test.ts`'s "FAILS CLOSED" row is load-sensitive. It failed locally at load averages of 44 to 63, on main
  as well, and passed in CI, which ran the whole file. It is a flake, not a main issue.

- The live census on the fleet box is never copied into the repo: it names sessions and paths. Every fixture is
  synthetic or written by the real sweep under a fixture HOME.
- No other file of the fleet disk retention plan changes in this wave.

## Next-wave brief

None. The hourly update monitoring checks the first server boot on v0.0.681 or later and records it here. The programme closes when wave 1 lands and the next server boot reads the census without the malformed line.
