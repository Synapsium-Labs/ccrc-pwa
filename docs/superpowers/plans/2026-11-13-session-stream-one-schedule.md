# The session stream has one schedule

- **D-8611 (2026-11-12)** — `session-stream-one-schedule`: `SessionStream` is always given a row-facts source, so its source-less 2-second poll is gone. The server hands the watcher, or `NO_TICK` (a watcher that has not ticked) on a box with none, and the tests pass `NO_TICK` the same way. Filed as leftover 2 of the closed architecture refactor (`docs/superpowers/programs/architecture-refactor.md`).

## What changed

1. **The source is required.** `server/src/sessionws.ts`'s constructor takes `rows: RowFactsSource`, no longer optional,
   and `since` becomes `… | undefined` so the required source can follow it. The `if (this.rows)` branches are gone: the
   stream always listens for `row:<id>`, always arms the 30 s backstop, and its `POLL_MS` timer always runs
   `lookInListing`. The second timer body, a bare `tick()` every 2 s when no source was given, is removed.
2. **`NO_TICK`.** A `RowFactsSource` whose `currentRowFacts` and `currentFleetListing` both answer null, exported
   beside the interface. `server.ts` hands `watcher ?? NO_TICK`, the same "no watcher reads as no tick" its other
   reads make (`watcher?.currentFleetListing() ?? null`). Production always builds the server with a watcher, so
   only tests and a watcher-less embedding see it.
3. **The tests subscribe as production does.** Every `new SessionStream(…)` in `server/test` that gave no source (59
   sites over seven files) passes `NO_TICK`; the watcher-facts suite's `open` now requires one. With no fresh
   listing, `lookInListing` runs a full `tick()` every `POLL_MS`, which is what the removed path did, so the tests
   that wait on a 2 s re-read keep their timing; each stream now also holds the row listener and the backstop, as a
   production stream does.
4. **Characterization, then the change.** `sessionws-watcher-facts.test.ts`'s "a stream with no watcher behaves as
   before" becomes the `NO_TICK` case: one has-session and one list-panes at open, a registry re-read after 2 s, no
   facts read, and the row listener armed (red before the change: a source-less stream had none). Two more cases pin
   `NO_TICK`'s two null answers and, by a `@ts-expect-error`, that a stream cannot be built without a source.

## Deviations found

- The `POLL_MS` timer itself stays. It is the in-memory look at the watcher's listing, and when the listing is stale
  or lacks the row it still runs a full `tick()` every 2 s: that is production's degrade path while the watcher is
  slow or the registry unlistable, not the source-less poll this change retires. Replacing it with a listing event
  would change what a stalled watcher costs a chat, which is a separate decision.
- `POLL_MS` keeps its name, because `token-shared.test.ts`'s scan names it and a rename buys nothing here.
