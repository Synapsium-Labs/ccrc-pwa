# Approvals PR 3c, the park's clear and park ordering: task note

Plan: `docs/superpowers/plans/2026-11-18-overlord-approvals.md` (on `main`), §3.3.1 and §3.3.2's line on a press in the clear
interval. The findings are review 2980's, carried here by the coordinator's ruling: `approvals-pr3-park.md`, "Residuals: For PR
3c". Departures are listed by slug; the coordinator mints the numbers.

## In short

The park lane stays gated: nothing here arms it or changes its gate words, and with the gate standing nothing in this PR
changes behaviour (the mint stores `shadow`, so no row is `live` and nothing parks). Each fix went red first (one commit of
red cases before any fix), and each guard is measured by a mutant (below).

- **F-A.** A clear edge seen at or past a `held` `live` row's `notifyAt` less 1.5 s settles nothing: it is the hook's park
  deny, and the sweep parks the row. After the park, the deferred push entry is kept while its dialog is painted, so the
  operator's press through the session door on that dialog marks the parked row `operator` and voids its park, once the press
  has landed and only while hook state, read fresh, still names that row's own prompt (fix round 1). A clear after the park
  voids nothing.
- **F-B.** `parkApprovalRow`, the one write of `parked`, asks `parkOpen` over the park's own run inside its transaction. A
  closed key takes no row: a `held` row is staled in that write, and the park write pushes nothing and mails nothing.
  `parkApproval` nudges only when the park took the moved ruling. A dialog still painted on the closed key is a live prompt no
  row will answer, so the deferred push sends it to the operator once (fix round 1, F3; a case pins it).
- **F-C.** A throwing `markApprovalFetched` withholds the ruling: the owner warns once and throws a 503, so the route sends no
  ruling and the hook polls again.
- **F-D.** The parked view names the park's run (`approval_parks.runId`), not the run the child's mark names.

## F-A: why the slack, not the reorder (measured)

The brief offered two ways out: (i) a clear edge never settles a `held` `live` row at or past `notifyAt` less a slack, or
(ii) the sweep runs before the clear settle. Measured from the hook (`ccd/session-hook.sh`, `_hook_approval_wait`):

- its deadline is its own clock at the `201` plus `waitS * 1000`. Windows are whole seconds (`askwindow.ts`) and `waitS` is
  taken from the same `now` as `notifyAt`, so the `floor` loses nothing today (review 3022 F4 corrected this note's first
  version, which counted up to 1 s here); the response's transit only makes the deadline later;
- its clock (`_hook_epoch_ms`) falls back to whole seconds (`date +%s`) when `EPOCHREALTIME` and `date +%s%3N` both fail, which
  can put the deadline up to 1 s early: the one real early source;
- it prints the park deny at its first 0.5 s tick at or past that deadline, and only then can the dialog clear.

So the park deny can clear the prompt up to 1 s before the server's `notifyAt`. Option (ii) alone does not cover that: a
clear seen in a tick whose `now` is still short of `notifyAt` would settle the row `operator` before any sweep could park it,
whatever the order inside the tick. Option (i) covers both orders, so it is the fix, and the tick order in `watch.ts` is left
as it is (it orders the asks' half too). The slack is `APPROVAL_PARK_CLEAR_SLACK_MS`, decided in L1 by
`questionPolicy.ts#clearSettledApprovalIds`, beside the deferred push's decider. It was 2 000 ms; fix round 1 (the
coordinator's ruling on F4) lowered it to 1 500 ms: the 1 s fallback plus half a second against a clock step, because every
extra second of slack is a second of pane answers lost, and a lost refusal can let a later allow run a command the operator
already refused. The code comment carries the reason.

- **`clear-slack-over-reorder`.** Option (i), for the measurement above.
- **`clear-never-voids-a-park`** (accepted by the coordinator in fix round 1, with F4's true window recorded under Residuals).
  The brief says "a later pane press or clear must still void that row's park". A watcher clear after the park cannot be told
  from the park deny (the deny is what clears the prompt), so a clear after the park voids nothing; voiding there would void
  every park at once. What voids it is the operator's press through the session door (`POST /api/questions/session-<id>/answer`),
  which is the plan's "through the `session-<id>` arm". The watcher-level case pins both: a press after the park voids it, a
  clear after the park does not.
- **`parked-entry-kept-while-painted`.** `decideDeferredApprovalPush` answers `wait` for an entry covering a `parked` row while
  its dialog is painted (it was `drop`), and `drop` once it is not. Such an entry is never pushed: the parked row's push is sent
  at park time.
- **`press-reaches-parked-by-dialog`.** The session door's option-row press, on the dialog a held entry covers, calls
  `markApprovalOperatorRows` with that entry's rows (which marks a parked row `operator` and voids its park). The child-wide
  `markApprovalOperator` is unchanged, so review 2889 F3 holds: a press on another dialog reaches no parked row (a case pins it).
- **`press-bound-to-the-held-prompt`** (fix round 1, review 3022 F1). The dialog id hashes the menu's labels and first title
  line, not its command, so after a park a second prompt with the same menu can paint under the same id before the poll sees
  the first one clear. A held entry now records the prompt it was held for, `HeldPrompt`: the hook envelope's stamp (the main
  thread's wait keeps its `updatedAt` across subagent events, `_hook_keep_stamp`; a subagent's entry carries its own `at`) and
  the subagent's id. The press reaches the entry's rows only while hook state still names that prompt
  (`questionPolicy.ts#pressAnswersHeldPrompt`, L1). No hook state read: it does not, so a press with nothing to prove it
  answers the parked prompt voids no park.
- **`fresh-hook-state-at-the-press`.** The door's `hookStateOf` is the copy the watcher's last tick cached, which lags a
  second prompt exactly as long as it lags the clear, so the check reads hook state fresh: `registry.ts#freshHookState`, the
  read ladder `freshAskAt` already ran, which now derives from it (one ladder, no second reader).
- **`press-marks-after-it-lands`** (fix round 1, review 3022 F2). The rows are taken before the press (a tick during it can drop
  the entry) and marked, with the park voided, only when `pressDialog` answers ok, inside a guarded try. A press refused
  `stale-dialog` (the deny cleared the prompt before the poll saw it) leaves the park open and the row parked. The child-wide
  `markApprovalOperator` above it keeps its mark-before-press order (D-5298's "BEFORE any key"): it takes no parked row, and a
  refused press there leaves a painted dialog the operator can press again.
- **The case the note asked for** is `server/test/approval-park-order.test.ts`, through the watcher: a clear edge in the tick
  whose sweep parks the row, a clear 1.5 s before `notifyAt`, a clear earlier than the slack (the operator's answer:
  `operator`), a press after the park, a press on another dialog, a press on a second prompt under the same id (F1), a press
  refused `stale-dialog` (F2), a clear after the park, and a painted dialog on a closed key (F3). The park lane is stored live and its gate
  opened for the mint through the watcher's own questions instance; ticks, the clear and the press go through the watcher and
  the server.

## F-B, F-C, F-D

- **`closed-park-stales-the-held-row`.** A `held` `live` row whose key's park is closed at its window's end is staled in the
  park write itself (compare-and-set on `held`), not left `held` to the hook's ceiling: it can never meet a ruling, and it
  leaves the coordinator's card. The hook has normally already printed "parked" by then (it checks its deadline before it
  polls, and the server writes at its first tick at or after `notifyAt`), so the child was told to wait for a mail that no stale
  or void park sends: review 3022 F5, on the arming list below. (This note's first version said the hook's next poll stops on
  `stale`; that is true only in the rare order where the hook polls after the write and before its deadline.) A ruled row the
  hook never fetched keeps its state on a closed key; the sweep asks again each tick until the hook's ceiling, and each ask
  refuses inside the transaction.
- **`closed-key-painted-prompt-pushed`** (fix round 1, F3, the coordinator's ruling). On `closed`, the child's deferred push
  entry still stands and now covers no `held`, ruled or parked row, so the deferred push decider answers `push` while the dialog
  is painted: the operator is told of a standing prompt that no row will answer. Kept, and pinned by a closed-run case with a
  painted dialog (one push of the prompt, no "parked for a ruling" push).
- **`park-move-word`.** `parkApprovalRow` answers `ParkMove` (`parked`, `ruled`, `closed`, `unmoved`) instead of a
  boolean, so `parkApproval` acts on what the write did: the push for a moved `held` row, the nudge only for `ruled`.
- **`park-run-doubt-closes`.** The park's run is read through the owner's `runClosedOf`, the doors' read; a run it cannot read
  closes the park here (as `parkFactsFor(…, true)` does at the doors). A run that cannot be read at the window's end closes that
  key for good in this write's terms, and the row's mint-time slot is not released, so later mints of the key reach `capped`
  sooner: failing closed is the intended direction.
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
  `ParkMove`), agreed with W1-4b's holder (claim 6009, their mail 28686: their hunks do not touch that line); in fix round 1,
  `staleApproval`'s docstring names every writer of `stale` (claimed once that holder's claim had ended).
- Fix round 1 also touches `server/src/registry.ts` (`freshHookState`, above) and `shared/approval-park.ts` (one line:
  `ParkedApprovalView.runId`'s comment says `null` is a row whose park cannot be read), each claimed first.
- `main` was absorbed once in fix round 1, at the coordinator's word, so the park suites run over the real verifier (#3140).
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
- **Fix round 1 (review 3022).** Red first: against the round's base (the absorbed tip), the F1 and F2 order cases are red, and
  so is the clear 1.5 s before `notifyAt` that pins F4's lower slack; the F3 closed-key case is a pin (the push already stood).
  L1: a new set and floor for `questionPolicy.ts#pressAnswersHeldPrompt`, 7 mutants (any press answers; no hook state answers;
  the main thread's stamp or its ask not checked; a subagent's agent or stamp not compared; a subagent read as the main
  thread), and the clear-settle set re-pinned at 1.5 s with CS-11 (the slack back at 2 s). Four hand mutants on the questions
  owner, all killed by `approval-park-order.test.ts`, the file restored byte for byte after each: the press matched by dialog
  id alone (R1-1); the last tick's cached hook state instead of a fresh read (R1-2); the hold recording no prompt stamp (R1-3);
  the rows marked whether or not the press landed (R1-4).

## Residuals

- **The lost-press window (review 3022 F4, the true figure).** The slack is compared with `now` at the tick that SEES the
  clear, not when it happened, and the watcher polls every 2 s (a tick is skipped while one runs). So a pane answer by hand (an
  option or Esc in the tmux pane, not through the session door) from about `notifyAt` less the slack less one poll, up to the
  hook's deny, is read as the deny: about the slack plus the poll's lag. At the reviewed 2 s slack that was about 2.4 to 4.4 s
  (about 3.4 s mean); at 1.5 s it is about 0.5 s less. The hook drops on seeing the tool result and prints no deny, the server
  learns nothing, and the row parks: a "parked for a ruling" push goes out, a Waiting on you row appears, and a later allow
  mails the child to run the same command again, so a command the operator already allowed or refused can run again. The
  session door's press is caught either way. A hand answer after the park is the same: indistinguishable from the deny.
- **A stale or void park mails nobody (review 3022 F5 (a)).** A `held` `live` row staled on a closed key, or a parked row staled
  at its horizon or when its park goes void, sends no mail, push or run event, though the hook told the child "parked" and to
  wait for a mail. The child waits with no timeout. Not a regression (before this PR such a row parked, then staled, also
  mailless).
- **A decline in the deadline gap (review 3022 F5 (b)).** A claimant's decline (`declineApproval`, no clock check) between the
  hook's deadline and the next sweep (about 1 to 3 s) makes the row `declined` while the hook printed "parked"; nothing parks
  or mails it.
- **A restart loses a kept entry.** A server restart after the park, with the dialog still painted, loses the deferred entry
  (only `held` rows are re-seeded), so a later press reaches no parked row.
- **No hook state, no reach.** A press whose fresh hook state cannot be read reaches no parked row (F1's fail direction: it
  never voids the wrong park, but it can leave a park open after a real press).
- `CCRC_APPROVAL_CEILING_S` (the hook's knob that can only shorten its wait), and a forward step of the fleet box's clock of
  more than the slack during the wait, can put the hook's park deny more than 1.5 s before `notifyAt`; that clear is then read as
  a press and the row becomes `operator`, though the child was told "parked" (the safe direction for authority).
- Carried unchanged from PR 3: F10 (the deny standing read before `liveVersionOf` and `heldFor`'s awaits on the retry path).
- `markApprovalOperatorRows` runs its void and its per-row updates outside a transaction (older than this PR).

## For the arming review

Every residual above has one cause: the hook decides "parked" on its own clock, with no final read and no way to tell the
server of a pane answer, and the server reconstructs that decision from timing. Before the lane is armed:

1. **The hook tells the server of a pane answer** (the coordinator's ruling on F4), so a hand answer is never read as the deny.
2. **One ruling read at the hook's deadline before it prints "parked", or a mail on stale or decline of a `live` row** (F5),
   so a child told "parked" is told when nothing will come.
3. **The slack decided against the measured early sources** (today 1.5 s, the clock fallback plus margin), and whether the
   hook's deadline may ever undercut `notifyAt` less the slack (`CCRC_APPROVAL_CEILING_S`, a clock step).
4. **A restart's kept entry** (re-seed parked rows' entries, or accept the gap).

## For the ledger

- Hook refusals: one. The graph-first gate refused a read-only search of the test tree for the kebab-token scan (no graph
  query yet this session); I ran the graph query the refusal named (its graph is not an ancestor of HEAD, so its answer was
  a lead only), and the gate then let the search through.
- Fix round 1 (review 3022, the coordinator's rulings): F1, F2 fixed with red-first cases; F3 kept and pinned; F4's slack
  lowered to 1.5 s; F5 and the nits in this note; `main` absorbed once at the coordinator's word. Co-edit agreed with W1-4b on
  `store.ts` (their mail 28828, one comment in `lastRunBySession`; my answer 28826: yes).
- The first fast run was red on one guard, `mail-routes.test.ts`'s scan of quoted kebab tokens under `server/src/coord`: the
  `ParkMove` word for a moved ruling the park took was kebab (`parked` plus `ruled`). It is now `ruled`, not kebab, so the scan's
  allowlist is unchanged. That guard was not in the brief's list and I did not run it before the push.
