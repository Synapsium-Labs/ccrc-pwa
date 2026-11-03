/**
 * D-7578 (plan docs/superpowers/plans/2026-10-30-consolidation-increment7-watcher-store-port.md, Task WP1;
 * increment 7). The series' record of what the store census (`scan/parse.ts#storeReach`) measures for `watch.ts` and
 * its lane files: the members they reach through `Deps.coord`'s whole store, and where they hand the whole store on
 * (each key with its call-site count). The members they reach at all are no longer listed here: since D-7579 (WP2)
 * they are `coord/ports.ts#WatcherCoordMember`, the port's own list. This is the series' record, which each series task
 * rewrote to what the census measured. Since D-7587 (WP10, the series' target, spec §5.1 rule 3 rev 2) both sets
 * are empty and the census's rows pin them exactly, so each stays empty. Measured on `origin/main` 55f7f5727.
 */

/** The members reached through the whole store: none since D-7587 (WP10), whose flip of `FleetWatcher` and
 *  `DelegationLane` onto `WatcherDeps` took the last 69 (the members read on `this.deps.coord`'s whole value in
 *  `watch.ts`, directly or into a narrow slot) to the port. 166 before D-7580 (WP3), 155 before D-7581 (WP4), 132 before
 *  D-7582 (WP5), 129 before D-7583 (WP6), 123 before D-7584 (WP7), 122 before D-7585 (WP8) and 101 before D-7586 (WP9),
 *  with #1614's `delegationRunStamps` and #2038's `requestNode` counted from when they landed. */
export const WATCHER_WHOLE_REACH: readonly string[] = [];

/** Each whole hand-off key with its call-site count, sorted by key: none since D-7586 (WP9), whose questions,
 *  fleet-assembly and digest chains take the port. */
export const WATCHER_WHOLE_HANDOFFS: Readonly<Record<string, number>> = {};
