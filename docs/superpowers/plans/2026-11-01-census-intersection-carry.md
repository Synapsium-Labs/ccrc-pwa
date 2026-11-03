# Increment 7, Task WP6: the store census carries an intersection by its members, ruled

**Plan:** `docs/superpowers/plans/2026-10-30-consolidation-increment7-watcher-store-port.md`, Task WP6 (D-7583), and
the census of Task WP1 (D-7578). Number issued by the ledger on 2026-11-01. The plan's own §Deviations found is not
edited here (the ledger guard, D-6926); the coordinator folds this one into it.

- **D-7727 (2026-11-01)** — census carries an intersection by its members

**What the departure is.** WP6's file list does not name `server/test/scan/parse.ts`. The census
(`storeReach`, D-7578) did not follow a store value handed to a parameter typed with the shared-deps rule's form,
`Omit<XDeps, 'coord'> & { coord: WatcherCoordPort }`: its `carries()` answered `false` for any type that is not an
object type, and an intersection is not one. Such a call was counted as neither a whole hand-off nor a port hand-off,
and the callee's reach was dropped. On WP6's retype of `childReclaim.ts` without the fix, the strict reach row went red
with a port member the census said nothing reaches (`cancelDeliveriesTo`, which tsc confirms is read). WP8's
`closeRun` overloads take the same form, so the gap would have grown there.

**The ruling (coordinator, 2026-11-01): accepted.** `carries()` answers an intersection by its members, the same way
it already answers a union. It lands in WP6's PR as its own commit, revertable alone. Measured at WP6's base, the fix
leaves reach, whole reach, port reach, units, hand-offs and chains unchanged; only port entries grow (20 to 22), by
the two WP5 calls into `measureClaimant`'s Omit form that the old walk never counted. No row, assertion, title or
CONTROL row changes in that PR.

**Follow-up.** Add a CONTROL row to `server/test/rings/watcher-store-port.test.ts` (the fixture block "the store census
on fixtures (CONTROL, exact)") that holds the intersection rule exactly: a fixture handing a store value to a
parameter of the Omit form counts as a port hand-off and carries the callee's reach, and reds if `carries()` stops
answering an intersection by its members. The series' tasks may not edit a test file, so it is not in WP6's PR; it
belongs to a task that may.
