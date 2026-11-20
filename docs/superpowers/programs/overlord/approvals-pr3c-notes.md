# Approvals PR 3c, the park's clear and park ordering: task note

Plan: `docs/superpowers/plans/2026-11-18-overlord-approvals.md` (on `main`), §3.3.1 and §3.3.2's line on a press in the clear
interval. The findings are review 2980's, carried here by the coordinator's ruling: `approvals-pr3-park.md`, "Residuals: For PR
3c". Departures are listed by slug; the coordinator mints the numbers.

## In short

The park lane stays gated: nothing here arms it or changes its gate words, and with the gate standing nothing in this PR
changes behaviour (the mint stores `shadow`, so no row is `live` and nothing parks). Each fix went red first (one commit of
red cases before any fix), and each guard is measured by a mutant (below).

- **F-A.** A clear edge seen at or past a `held` `live` row's `notifyAt` less 2 s settles nothing: it is the hook's park deny,
  and the sweep parks the row. After the park, the deferred push entry is kept while its dialog is painted, so the operator's
  press through the session door on that dialog marks the parked row `operator` and voids its park. A clear after the park
  voids nothing.
- **F-B.** `parkApprovalRow`, the one write of `parked`, asks `parkOpen` over the park's own run inside its transaction. A
  closed key takes no row: a `held` row is staled in that write, nothing is pushed and nothing is mailed. `parkApproval`
  nudges only when the park took the moved ruling.
- **F-C.** A throwing `markApprovalFetched` withholds the ruling: the owner warns once and throws a 503, so the route sends no
  ruling and the hook polls again.
- **F-D.** The parked view names the park's run (`approval_parks.runId`), not the run the child's mark names.

## F-A: why the slack, not the reorder (measured)

The brief offered two ways out: (i) a clear edge never settles a `held` `live` row at or past `notifyAt` less a slack, or
(ii) the sweep runs before the clear settle. Measured from the hook (`ccd/session-hook.sh`, `_hook_approval_wait`):

- its deadline is its own clock at the `201` plus `waitS * 1000`, and `waitS` is `floor((notifyAt - now) / 1000)`, so the
  deadline falls up to 1 s before `notifyAt` (the response's transit only makes it later);
- its clock (`_hook_epoch_ms`) falls back to whole seconds (`date +%s`) when `EPOCHREALTIME` and `date +%s%3N` both fail, which
  can put it up to 1 s earlier still;
- it prints the park deny at its first 0.5 s tick at or past that deadline, and only then can the dialog clear.

So the park deny can clear the prompt up to 2 s before the server's `notifyAt`, and never earlier. Option (ii) alone does not
cover that: a clear seen in a tick whose `now` is still short of `notifyAt` would settle the row `operator` before any sweep
could park it, whatever the order inside the tick. Option (i) covers both orders, so it is the fix, and the tick order in
`watch.ts` is left as it is (it orders the asks' half too). The slack is `APPROVAL_PARK_CLEAR_SLACK_MS` (2 000 ms), decided in
L1 by `questionPolicy.ts#clearSettledApprovalIds`, beside the deferred push's decider.

- **`clear-slack-over-reorder`.** Option (i), for the measurement above.
- **`clear-never-voids-a-park`.** The brief says "a later pane press or clear must still void that row's park". A watcher clear
  after the park cannot be told from the park deny (the deny is what clears the prompt), so a clear after the park voids
  nothing; voiding there would void every park at once. What voids it is the operator's press through the session door
  (`POST /api/questions/session-<id>/answer`), which is the plan's "through the `session-<id>` arm". The watcher-level case
  pins both: a press after the park voids it, a clear after the park does not.
- **`parked-entry-kept-while-painted`.** `decideDeferredApprovalPush` answers `wait` for an entry covering a `parked` row while
  its dialog is painted (it was `drop`), and `drop` once it is not. Such an entry is never pushed: the parked row's push is sent
  at park time.
- **`press-reaches-parked-by-dialog`.** The session door's option-row press, on the dialog a held entry covers, calls
  `markApprovalOperatorRows` with that entry's rows (which marks a parked row `operator` and voids its park). The child-wide
  `markApprovalOperator` is unchanged, so review 2889 F3 holds: a press on another dialog reaches no parked row (a case pins it).
- **The case the note asked for** is `server/test/approval-park-order.test.ts`, through the watcher: a clear edge in the tick
  whose sweep parks the row, a clear 2 s before `notifyAt`, a clear earlier than the slack (the operator's answer: `operator`),
  a press after the park, a press on another dialog, and a clear after the park. The park lane is stored live and its gate
  opened for the mint through the watcher's own questions instance; ticks, the clear and the press go through the watcher and
  the server.

## F-B, F-C, F-D

- **`closed-park-stales-the-held-row`.** A `held` `live` row whose key's park is closed at its window's end is staled in the
  park write itself (compare-and-set on `held`), not left `held` to the hook's ceiling: it can never meet a ruling, it leaves the
  coordinator's card, and the hook's next poll stops on `stale`. A ruled row the hook never fetched keeps its state on a closed
  key; the sweep asks again each tick until the hook's ceiling, and each ask refuses inside the transaction.
- **`park-move-word`.** `parkApprovalRow` answers `ParkMove` (`parked`, `parked-ruled`, `closed`, `unmoved`) instead of a
  boolean, so `parkApproval` acts on what the write did: the push for a moved `held` row, the nudge only for `parked-ruled`.
- **`park-run-doubt-closes`.** The park's run is read through the owner's `runClosedOf`, the doors' read; a run it cannot read
  closes the park here (as `parkFactsFor(…, true)` does at the doors).
- **`withheld-as-503-in-the-owner`.** `server/src/coord/routes.ts` is held by run 1850's frozen landing work and is not touched.
  The route calls `noteRulingServed` before it sends, so the owner withholds by throwing: it warns once
  (`console.warn('ccrc-server: …')`) and throws an error carrying `statusCode: 503`, which the root error handler masks and
  answers. The hook's poll has no arm for a 503, so it reads no ruling and polls again; the next read that records `fetchedAt`
  serves it. If the mark keeps failing to the hook's deadline, the hook prints the park deny for a `live` row and the last-poll
  move carries the never-served ruling onto the park, which is correct because the hook never printed it.
- **`view-names-the-park-run`.** `ParkFacts` carries the park's `runId`; `parkedApprovalViewOf` names it, and its input rows no
  longer carry the mark's run. A row whose park cannot be read names no run (`null`), never the mark's.
- **`needs-you-reads-the-views-run`.** The console's `needsYou.ts` already filed a parked entry under the view's `runId`, so it
  had no defect of its own: the fix is the server's view. Its comment now names the park's run, and a case pins a resumed
  child's entry at wave 2's run. That case cannot be red first in the console, because the defect was never there.

## Agreed and untouched

- `server/src/coord/store.ts`: one line replaced (`CoordStore#parkApprovalRow` takes the park run's closure reader and answers
  `ParkMove`), agreed with W1-4b's holder (claim 6009, their mail 28686: their hunks do not touch that line).
- Not touched: `server/src/coord/routes.ts`, `server/test/coordinator-skill.test.ts`, the verifier, `shared/api.ts`, the lane's
  gate words, `FLEET_PROTO`, any run state, any `ccd` verb. No migration.

## Mutation measurements

Every source file was saved before the fixes (the red run) and after them (the mutant runs); each mutant was applied to the
saved copy, run, and the file restored and checked byte for byte.

- **L1, in `MUTANT_SETS` and `mutation-floors.json`, all killed** (the floors suite filtered to the park's sets, which asserts
  every mutant of each set killed): a new set and floor for `questionPolicy.ts#clearSettledApprovalIds`, 10 mutants (no slack,
  the slack exclusive, zero or doubled, every word spared, a parked row settled, a released row spared, an unreadable read
  settling every row, an uncovered row settled, a ruled row settled); `decideApprovalLapse`'s set gains LP-15 and LP-16 (a
  painted parked entry dropped; an unpainted one kept) and LP-14 now removes the new line; `parkedApprovalViewOf`'s set gains
  PV-6 (the mark's run named) and PV-7 (no run named).
- **The store and the questions owner, 10 hand mutants, all killed** (`approval-park.test.ts`, `approval-park-routes.test.ts`,
  `approval-park-order.test.ts`): the park write asking no openness (H1); the run's closure ignored (H2); a closed `held` row
  left `held` (H3); `recordParkRuling`'s answer ignored (H4); doubt opening the park (H5); a closed move pushed (H6); a
  throwing mark still serving (H7); the clear settling every covered row (H8); the press reaching no parked row (H9); a press
  on any dialog reaching them (H10). H1's first run printed no test results (a run of the test slice that produced no
  output) and was counted as surviving by the script; run again alone, five cases killed it.

## Residuals

- A press by hand in the tmux pane, not through the session door, in the last 2 s of a `live` row's window or after its park,
  is read as the park deny: the row parks though the operator answered, and a later ruling on that park could allow the next
  identical command. The session door's press is caught either way.
- `CCRC_APPROVAL_CEILING_S` (the hook's knob that can only shorten its wait) can put the hook's deadline, and so its park deny,
  more than 2 s before `notifyAt`; that clear is then read as a press and the row becomes `operator`, though the child was told
  "parked". A test knob; the arming review should decide whether the hook's deadline may ever undercut `notifyAt` less the slack.
- Carried unchanged from PR 3: F10 (the deny standing read before `liveVersionOf` and `heldFor`'s awaits on the retry path).

## For the ledger

- Hook refusals: none in this PR.
