# The server says a finished run had a child

**Why.** The runs board re-reads its archive when a workspace reclaim ends, and a finished row with no chip is worth that
read only if its run had a child. The board answered that from a browser set, `childRunsSeen`, gathered for its own life
from fleet marks and cold chips (D-7214). A board loaded after the child left had nothing to gather from, so its row kept
a stale label until the next read.

**The ruling.** The operator's ruling of 2026-11-06 on D-7214, which differs from the recommendation to keep the set: have
the server say a run had a child, through a new field on finished runs, and delete the browser's memory. This meets the
consolidation spec's exit for ARCH-61 ("`childRunsSeen` goes") through the new field D-8066 recorded, because
`RunSummary.childIds` names only open runs. D-7214 stays as the record of why `childIds` could not do it.

- **D-8068 (2026-11-06)** — run-had-child: `runs.hadChild` (migration 41) and `RunSummary.hadChild` say a run held a child
  workspace; `childRunsSeen` and its ref are deleted, and `childReclaimDoneRefreshDue` reads the field through
  `runHadChild`. Supersedes D-7214's "stays a named reader". Operator ruling 2026-11-06.

## What the field means

True when a session is bound to the run and either the run's dispatch asked ccd for `--child <run>`, or an earlier run
bound to that session had a child. The second arm is the hand-over wave: a child resumed for wave 5 keeps a mark naming
wave 1, and both rows end when it is reclaimed. The old set held the wave 5 row only once a chip had been seen.

| Writer | When | Why there |
|---|---|---|
| `CoordStore.markHadChild` | dispatch's fresh-spawn arm, before `ws-add`, only when `--child` is sent | a `ws-add` that returns late is bound by the dead-dispatch pass with no word from this arm |
| `CoordStore.inheritHadChild` | `bindSession`, when the occupant changes | every bind door funnels here |

The read is `hadChild === 1 && sessionId !== null`: a spawn that never bound held nothing.

`inheritHadChild` selects rows by `sessionId`, so the ARCH-62 census counts it. It is named in `NOT_BINDING_SITES`, not
routed through `runsNamingSession` or `bindingRunsOf`: it is one UPDATE inside a binding writer, no run is returned, neither
reader's row carries the column, and both answer failure on one unrepresentable row, which must not fail a bind over a flag
that costs one spare read.

Two ratchets hold the shape. `rings/pwa-one-owner.test.ts` reds any name `hadChild` in `pwa/src` outside `runHadChild`.
`run-had-child.test.ts` lists the composers of a `--child` argv, each of which owes `markHadChild`: `wsAddWorkerBase` has
no caller today, and wiring the promoting dispatch reds that list until its row is added.

## The four pinned rows

`pwa/test/w7-cold-runs-children.test.tsx` keeps each row's `loadRuns` counts, with the fixture now carrying the server's
answer. The race, resumed-child, board-mounted-after-close and skew rows hold. Three rows are new: the reload row (a board
no fleet frame ever told), a row showing the board no longer reads a mark, and the older-server row. The resumed-child row
now also covers the hand-over wave's own row.

## Rows stored before the field

Backfilled by migration 41, not read as false, because a row closed before the deploy can have its child reclaimed after
it. The evidence is the fresh-spawn arm's: a bound row with a `dispatchStartedAt` and no `child-omitted:` event, then every
row bound to a session such a row names. Pinned in `server/test/run-had-child.test.ts`. A wrong true (a row older than
child marks, or a recycled name's later row) costs one spare archive read per reclaim end. Nothing refuses, renders or
reclaims on the field. Live rows have one more wrong true at the same price: `markHadChild` is sticky, so a failed attempt
keeps its mark with no session, a later bind to a session that is no child reads true, and later waves inherit it.

## Versions

- **Controller and fleet.** The column is written and read on the server alone, from facts it already holds. There is no
  new agent frame, ccd verb or capability token, and `FLEET_PROTO` is not bumped. A fleet without `child-argv-v1` gets no
  `--child`, so the run records no child, which is true of it.
- **Server and PWA.** An older PWA ignores the key and keeps its own set. A newer PWA on an older server reads absent as
  false, so it re-reads on the chip triggers alone.
- **Rollback.** An older build opening the file at `user_version 41` takes rule 3 and inserts 0. Its rows keep 0 after the
  roll forward.

## The cost, stated

A finished child row with no chip (a workspace ccd found gone, or a hand-over wave's row before its reclaim) now counts
as unsettled for as long as it stays in the loaded pages, not only while a board happens to remember it. So the second
trigger fires on most reclaim ends: one archive read per change of the newest reclaim end, the cost the ruling's objection
named. It is still a diff against the previous
frame, never a poll.
