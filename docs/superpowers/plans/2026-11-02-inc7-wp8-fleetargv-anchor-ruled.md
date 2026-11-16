# Increment 7 WP8: the unattended-actor close-composer anchor, the coordinator's ruling

The plan is `docs/superpowers/plans/2026-10-30-consolidation-increment7-watcher-store-port.md`, Task WP8 (D-7585). Its
close-path commit gives `coord/close.ts#fleetArgv`, like every helper on the chain that takes `CloseRunDeps`, the
parameter type `Omit<CloseRunDeps, 'coord'> & { coord: WatcherCoordPort }`. The emitted JavaScript is unchanged, but
`server/test/unattended-actor.test.ts` finds the close composer by a literal regex over its signature, so the build's
one red test was that anchor ("fleetArgv moved or was rewritten"). WP8's Files list does not name that suite, and the
plan's global constraints let no task edit a test outside its named re-points. The coordinator ruled it (2026-11-02,
option (a)).

## Deviations found

- **D-7737 (2026-11-02)** — unattended-actor fleetArgv anchor re-pointed to the port Omit form. Ruled by the
  coordinator, option (a), a named exception to WP8's Files list. In ONE commit placed before the close-path commit,
  only the regex of `unattended-actor.test.ts`'s "the close composer declares the run it closes as the actor" row
  changes: its parameter text reads `deps: Omit<CloseRunDeps, 'coord'> & { coord: WatcherCoordPort }` in place of
  `deps: CloseRunDeps`. The rest of the anchor (the id, session and act parameters, the `FleetVerb` return and the
  `sweepDec(deps.fleetState, …)` first line) and both assertions stay as they were: the anchor must be found, and the
  captured label must be exactly `` `run:${id} close` ``. Nothing is dropped or loosened; the anchor does not accept
  the old form. On its own, that commit leaves this one row red until the close-path commit retypes `fleetArgv`; the
  branch lands as one squashed change, so no landed tree carries the red.
