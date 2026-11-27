# Wave 5k, Task 4: the view model

`pwa/src/fleet/landingLineView.ts` (L1, C5), with `pwa/test/landing-line-view.test.ts`, and its C5 row.

- `readLandingLine` checks every field the console reads, an entry's whole shape and the order's arms included, and
  drops `binding` and `recovery`. `entriesScope` is kept when it is one of its two words.
  - An ejection kind outside the three known words makes the whole answer unreadable, as an unknown state word does.
  - A newer server that adds an ejection kind therefore shows as a stale line until this console learns the word.
    That follows the plan's guard rule for the state word; I am noting it here, not proposing a change.
- `landingRunless` is the one reader of the run-less fact (section 11, C7). The row's tag, the preview and the sheet's
  done phase all call it.
- The rows, the status, the control, the preview, the reducer, the equality and the hold part follow section 4.2 rule by
  rule. A row's role comes from the entry in `entries`, by id, so an inconsistent read that lists an ejected or set-aside
  entry in `order.order` still gives it its own role (row M30). An id in `order.order` that is not an open entry is
  skipped.
- `sameLandingState` compares `card`, `stale` and the open entries' `id`, `pr`, `state`, `pinnedAt`, `runId` and
  `afterIds`, by `sameJson`.

## Runs

`landing-line-view` (35), the pwa typecheck, and from `server/` `rings/pwa-rings`, `rings/totality` and
`rings/pwa-one-owner`: green.
