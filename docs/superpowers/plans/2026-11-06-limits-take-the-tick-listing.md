# The limits read takes the tick's listing

The consolidation spec's W1b exit says "registry listings per tick: ≤ 1", and it does not say which listings count.
With every timer due a tick listed four times (the tick, limits, divergences, mail), and an ordinary 2-second tick
listed twice. The operator ruled on what the number means on 2026-11-06.

- **D-8069 (2026-11-06)** — "One registry listing per tick" means selection plus limits, and mail and divergences keep
  their own. `FleetWatcher.tick` hands `readLimits` the names it already listed, so an ordinary tick lists once and a
  tick with every timer due lists three times. By the timers that is about 67 listings a minute down to about 37;
  that figure is inferred, not measured. Request-time callers pass no names and keep listing for themselves, so a
  marker raised a moment ago still counts for the answer they give. `mailPass` keeps its fail-shut switch read and
  `divergencesPass` its listing after git's records. The mail one is a re-listing that K13 in
  `docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md` marks deleted, and this ruling keeps it.

## Known limits

- Nothing was measured on a live fleet, and nothing visible changes. The gain is one round trip to the fleet agent
  on each listed tick in remote mode.
- A `-disabled` or `-authdead` marker raised after the tick's listing reaches the limits one tick later than it did.
- `registryListingSites` reads `watch.ts` only, so `readLimits`' own listing stays outside it. The run-time count in
  `fleet-listing-characterization.test.ts` is what holds this.
