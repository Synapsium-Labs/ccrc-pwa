# Approvals PR 3, the park: task note

Plan: `docs/superpowers/plans/2026-11-18-overlord-approvals.md` (on `main`), §3.3, Table 8's PR 3 row and Tasks 3.1 to 3.3.
Departures are listed by slug; the coordinator mints the numbers. Read with its two companions in this directory:
`approvals-pr3b-packet.md` (the route hunks, not applied) and `approvals-pr3-verifier-patch.md` (the verifier's v2 rule, PR 3v,
not applied).

## Inert in this PR, and what turns it on

The coordinator split PR 3 three ways on 2026-11-19 (mails 26690, 26692 and 26712):

- **PR 3 (this PR)** is everything outside the held route file and the verifier. It is INERT: the Shadow lanes card's new
  `approval-park` row carries a gate (`shared/lane-arm.ts`), so Live is refused `lane-gated` at the card, and every reader
  reads the lane as not live (`laneArmLive`). The mint therefore stores `shadow`, nothing parks, no slot is reserved, no row is
  moved by the last-poll move, and no v2 record is signed. A shadow lapse records `wouldPark`. Pinned by
  `approval-park.test.ts`'s two "inert" cases (a shadow mint never parks; a shadow row's unfetched ruling is never moved) and
  by `approval-park-inert.test.ts` (the gate stands; an unchanged verifier prints nothing for a signed v2 record).
- **PR 3b** wires the request route's `park` word (H1), the ruling read's `fetchedAt` (H2), the operator door's `approval-<n>`
  arm (H3, with the account gate in the door's wiring) and the claimant door's deny-standing read (H4). PR 3 built and tested
  the two functions H2 and H3 call: `Questions#approvalRulingAnswer` and `approvalParkDoor.ts#approvalOperatorArm`.
- **PR 3v** gives the verifier its v2 rule for `operator`. Until it is on the fleet box, an operator's v2 record prints
  nothing and the menu paints (Table 3b's older-verifier row).
- **The gate lifts** only when H1 to H4 and PR 3v are both in place (the coordinator's ruling: PR 3b's arming check refuses
  `live` until the verifier knows v2). Then Live is the operator's, behind the card's step-up, refused while sign-in is dark,
  and only after Task 3.2's measurement before Live is read.

## What shipped

- **L0.** `parked` in `ApprovalState`'s map (derived list unchanged in kind) and not in `APPROVAL_HOOK_STOP_STATES`; record v2
  (`ApprovalRulingRecordV2`: `authority`, `denyCurrent`, `family`; `approvalRulingBytes` signs all thirteen fields);
  `APPROVAL_PARK_WORDS`, `APPROVAL_PARK_HORIZON_MS` (2 h), `APPROVAL_PARK_SLOTS` (3), `approvalParkDenyText`;
  `ApprovalRequestAccepted.park?`; `ParkedApprovalView`; `WaitingView.approvals?`; two refusals, `park-ruled` and
  `coordinator-denied` (409); the digest's `parked` line kind; the census's `parked` path and `byPark` counts; the lane row.
- **L1, `server/src/coord/approvalPark.ts`.** `parkWordAt`, `parkKeyOf`, `classMeets`, `parkOpen`, `parkFactsOf`,
  `parkRecordRefusal` (the doors), `signingRefusal` (the one signing site's guard), `fetchedAtRecordable`,
  `parkedApprovalViewOf`. `questionPolicy.ts#decideApprovalLapse` gains `park` and `shadow-park` beside `lapse` and `stale`, in the
  same function, reading the row's stored `parkWord` and `fetchedAt`, the grace, and the park's horizon and void;
  `decideDeferredApprovalPush` drops an entry covering a `parked` row.
- **L3, `server/src/coord/approvalParkStore.ts`, and the store.** `approval_parks` (migration 110: see "Migration"), written only through `CoordStore` from the questions owner. The mint's park step
  runs inside the mint's transaction (`insertApprovalAt`, the cap race). `parkApprovalRow` is the one statement that writes
  `parked`; a ruling inside the window releases its slot and records a coordinator's deny on the key in the same transaction,
  as the decline does; `meetApprovalParkRuling` is the spend (re-read, sign, use 0 to 1, the retry row's ruling) in one
  synchronous transaction; `markApprovalOperator*` take `parked` and void its park first; the stale sweep takes `parked`;
  `pruneApprovalParks` deletes a park at its horizon plus the input retention.
- **The questions owner.** The mint computes the key and the word and, for a retry whose park holds an unspent ruling of the
  same or a higher class, meets it at once through the one signing site and sends its coordinator no brief.
  `signApprovalRuling` is the ONE SIGNING SITE (the only caller of `signRuling`): the claimant's in-window ruling and a park's
  ruling at retry both go through it. `parkApproval` is the one write site, called by the lapse sweep (a `live` row at
  `notifyAt`, and the last-poll move); `nudgeParkRuling` is the one nudge site. The rule door takes a `parked` row until its
  horizon and records the ruling on the park; `operatorRuleApproval` is the operator arm's core, with no press function in
  reach. `parkedApprovalsFor`/`parkedApprovalsView` is Waiting on you's read, spread into `waitingViewOf` (one line in
  `ledgersRoutes.ts`, gates B's licensed union).
- **The hook.** The `201`'s `park` is read into `pk` (with `IFS=`, so `" live"` is not `live`); on an exact `live` the wait's end
  prints the park deny; a `parked` answer prints it at once. A deny names its ruler from the verifier's line (`deny:operator`,
  `deny:overlord`, else your coordinator). PR 0's history gate holds a v1 allow only: `allow:operator` passes it (Table 3b, any
  deny currency). The session hook grows by the lines `growth-check` measured (below).
- **The console.** Waiting on you's parked group (`pwa/src/ledgers/ParkedApprovals.tsx`, words in `parkedApprovalWords.ts`),
  with Allow and Deny through the step-up (`useStepUp`, as the replay quiz's rule does); the Shadow lanes card draws the new
  row (its gate words say what Live waits for); the M38 card and the digest name `parked`.

## Departures

- `inert-by-the-lane-gate` (the coordinator's split): the plan's lane goes Live by the operator's arming; here it cannot, until
  PR 3b and PR 3v, by the card's own gate mechanism (`laneArmGate`), not a new switch.
- `route-hunks-in-pr3b`: H1 to H4 and the server's one wiring line move to PR 3b (`approvals-pr3b-packet.md`).
- `verifier-in-pr3v`: Task 3.3's verifier rule and its red cases move to PR 3v (`approvals-pr3-verifier-patch.md`).
- `signing-site-standing-optional` (mail 26692): the one signing site re-checks the deny standing when its caller read it (the
  retry's mint always does); the claimant's door does not pass it until PR 3b's H4, and then answers exactly as before (PR 0's
  residual, which H4 closes). A case pins each path.
- `shadow-park-answer`: the decider's fifth word, `shadow-park` (a lapse that records `wouldPark`), so the sweep decides
  nothing about the shadow record.
- `met-ruling-settles-the-key`: when a retry meets a ruling, the key's `parked` rows are staled in the same transaction, so they
  leave Waiting on you; a later identical prompt is held fresh and may park again on the key. The plan leaves them parked to
  the horizon, listed as if still waiting.
- `coordinator-denied-word`: an allow on a key whose park records the coordinator's deny is refused with a new word,
  `coordinator-denied`; the plan names the rule, not the word.
- `coordinator-deny-on-a-park-marks-the-key`: a coordinator's deny recorded on a park (the rule door's parked arm) marks the
  key denied in the same write, as a deny inside the window does.
- `operator-record-family-none`: an operator's v2 record carries family `none`. Table 3b's row "family `none` … any authority:
  no allow" is read as the Overlord's, because its operator row allows.
- `operator-principal`: an operator ruling's `by` (and the retry row's `answeredBy`) is the operator principal, as a pane
  answer's is; the device's actor stays in the gate's audit.
- `park-push-through-the-lapse-sink`: a parked row's push is sent at park time through the lapse sweep's push sink
  (source `approval:<n>`), not a new outbox row; the deferred dialog push drops it, so one push owner stands.
- `park-key-raw-cwd`: the key hashes the request's own `cwd`, trusted by the build record or not.
- `slot-released-on-in-window-ruling`: as the plan says, a slot is released by a ruling inside the window (and by a retry
  that meets a ruling); a decline or a pane press keeps it, so a loop the operator answers in the pane still meets the cap.
- `parked-reaches-the-operator`: the census counts a `parked` row as reaching the operator (Table 2a's path 4, `parked`),
  whoever rules it later; `capped` and the other words are counted in `byPark`.
- `fetched-at-grace-param`: `approvalRulingAnswer` takes the grace; PR 3b moves `APPROVAL_RULED_GRACE_MS` to `askwindow.ts` so
  the route and the watcher read one constant.
- `no-capability-word`: `approval-park-v1` is not added. Nothing would read it: an older server omits `park`, which the hook
  reads as shadow (PR 0 to PR 2 dropped theirs for the same reason).
- `park-ruling-is-not-a-pane-answer`: the console's client for the operator's ruling is `ruleParkedApproval`, beside the
  answer lifecycle, never through it: the lifecycle owns pressing a painted dialog (`rings/pwa-one-owner.test.ts`'s one
  answer path), and a park ruling presses nothing. It posts to the same operator door, whose `approval-<n>` arm PR 3b wires.
- `parked-group-above-the-list`: the console draws the group above the programme list, so it shows when nothing else waits.

## Residuals

- Task 3.2's measurement before Live (does a model retry a parked command unchanged; does the park burn a turn) is not taken:
  the lane cannot go Live in PR 3. It belongs before the gate lifts (PR 3b's note).
- The claimant door's deny currency is re-checked at signing only from PR 3b's H4 (PR 0's residual until then).
- The operator's ruling cannot be printed until PR 3v (the menu paints), by design.
- A parked row's push carries no outbox row; a server restart between the park and the push loses the push, as any sink push.

## Migration

`approval_parks` and four nullable `approvals` columns (`parkWord`, `parkKey`, `fetchedAt`, `wouldPark`), one index each, and
the lane's seed row, at slot 110, the coordinator's: urgent mail (#3073) took 108 and Overlord gates B (#3076) 109, both
absorbed before the push; door process B1 builds on 111.

## Mutation measurements

Every guard was measured red by a mutant, each file restored from a copy saved before the mutant and checked byte for byte.

- **L1, in `MUTANT_SETS` and `mutation-floors.json` (floor 1 each), all killed:** `parkWordAt` 6, `parkKeyOf` 2, `classMeets` 4,
  `parkOpen` 4, `parkRecordRefusal` 11, `signingRefusal` 16, `fetchedAtRecordable` 3, `parkedApprovalViewOf` 5, and
  `decideApprovalLapse`'s park arms with the deferred push's parked drop, 14. Run through the floors suite filtered to these
  sets (`-t`).
- **The hook, two hand mutants, both killed** (`session-hook-approval-park.test.ts`): parking on any non-empty word (the
  `shadow`, `capped`, `Live` and `" live"` cases red), and the operator's deny not naming the operator (two cases red).
- **The store and the questions owner, 19 hand mutants, all killed** (`approval-park.test.ts`): the agent id in the key; the
  run id dropped from it; a retry meeting a ruling at a higher class; the signing site skipping the claimant (the heir); no
  last-poll move; the word read from a cap outside the mint's transaction (the cap race); `parked` left out of
  `markApprovalOperator` (the pane press); no cap; one ruling serving two uses (no unspent check at the mint, in the spend or
  in its compare-and-set); the gate ignored (the inert case); the rule door ignoring the standing read (F2's carry); a
  coordinator's deny, and a decline, not recorded on the key; the met ruling leaving the key parked; a closed run's parked row
  not staled; no prune; `fetchedAt` always recorded; the retry's brief mailed after a meet; no push at park time.
- **An equivalent mutant, measured and recorded:** dropping only the spend's `rulingUses = 0` clause survives, because the
  spend runs in one synchronous transaction that re-reads the park and refuses a spent ruling first. The meaningful mutant
  (every unspent check dropped) is the one above.
- The plan's mutant "call a press function from the new arm" has no site: the arm's core takes no press function at all
  (`OperatorApprovalRule` has none), which `approvalParkDoor.ts`'s ladder and the core's signature hold.

## For the ledger

- Hook refusals, each reported: the claim's first body (it named the verifier's files; taken from a body file after the
  coordinator's word); a python edit script quoting a doc line that names the approvals route (redone with the Edit tool,
  the prescribed path, mail 26710); a mail body naming the compiler check (sent from a file); four Edit-tool edits of the
  verifier (the boundary working: PR 3v); a console subagent's heredoc naming the operator door's approval path (redone with
  Write and Edit); a Bash edit of a test file naming the verifier (redone with Edit).
