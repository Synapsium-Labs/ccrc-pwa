# The session stream has one schedule

- **D-8611 (2026-11-12)** — `session-stream-one-schedule`: `SessionStream` keeps no 2-second timer. It re-resolves on the watcher's `row:<id>` event, on a status change in the watcher's fleet frame (`'fleet'`), on the tailer's rotation and on the 30 s backstop, and nothing else. A box with no watcher hands `NO_TICK` and its streams re-resolve on the backstop alone. Filed as leftover 2 of the closed architecture refactor (`docs/superpowers/programs/architecture-refactor.md`).

## What changed

1. **The 2 s timer is gone.** `server/src/sessionws.ts` no longer defines `POLL_MS` or a `poll` interval. The stream's
   2 s look at the watcher's listing (`lookInListing`) is replaced by a listener on the fleet frame the watcher's tick
   already sends when its listing changed (`onFleet`). The listener re-resolves only when the row's `status` or
   `statusUpdatedAt` is not what the stream last measured. A frame without the row does nothing: the row leaving
   sends `row:<id>`, and the backstop covers the rest. A change that arrives while a tick is in flight, or before
   `start()` armed the stream, is kept as `rerun`, as a row event always was. The backstop is the stream's only timer
   that re-resolves, and its presence is the "armed" mark.
2. **The source is required, and smaller.** The constructor takes `rows: RowFactsSource`, and `since` becomes
   `… | undefined` so the required source can follow it. `RowFactsSource` drops `currentFleetListing`, which the
   stream no longer reads. `NO_TICK` (no row facts) is exported beside it, and `server.ts` hands `watcher ?? NO_TICK`.
3. **The tests drive what production drives.** The WebSocket rotation test sends the watcher's `row:<id>` on the
   server's bus after it flips the registry uuid. The unchanged-mail test sends two published panes, the feed's
   trigger, so it is no longer a quiet wait that passes vacuously: deleting the mail change gate turns it red
   (measured). The direct `tick()` calls in the unit suites are documented as a row event, awaited. The watcher-facts
   suite pins the new contract:
   - a status change in a fleet frame re-resolves;
   - an unchanged row, or a frame without the row, does not;
   - a change in a frame during an in-flight tick is kept;
   - a backstop that finds a tick in flight drops;
   - a `NO_TICK` stream makes no read before the backstop and one at it;
   - both listeners leave on `stop()` and are never installed for a proven-absent session.

## Deviations found

- **A stalled watcher now costs a chat up to 30 s, not 2 s.** Before, a stream whose watcher listing was stale or
  lacked the row ran a full resolve every 2 s. That was the source-less poll in another form. Now a stream sees
  nothing between the watcher's events, so when the watcher stalls it falls back to the backstop. The tailer still
  streams transcript lines live, so only the status header and a uuid rotation wait. This is the recorded degrade
  path, not a gap.
- **A box with no watcher re-resolves only on the backstop.** Production always builds the server with a watcher
  (`server/src/index.ts`), so this reaches tests and a watcher-less embedding only.
- **`'fleet'` gains one listener per open stream**, beside the one per `/ws/fleet` socket. This is the same fan-out
  `'notice'` already has, under the bus's cap of 100.
