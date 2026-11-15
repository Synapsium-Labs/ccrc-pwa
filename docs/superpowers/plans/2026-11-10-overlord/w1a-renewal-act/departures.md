# Overlord W1a renewal act: departures

Departures are recorded by slug, with no D-numbers: the coordinator mints one for any it keeps.

## rulings-rows (Task 3, measured)

A ruling is the operator's decision, sent to a coordinator. The checkpoint carries a coordinator's last ten, verbatim.
This is what was measured in the code, door by door.

**Rows that carry a ruling (both are system mail from `operator` to the coordinator's own session id, riding no run):**

1. **An item's tick.** `tickNow` in `server/src/coord/ledgersRoutes.ts` queues, in the tick's own transaction, mail of kind
   `answer` whose subject is `itemMailSubject(item)` (`done: item <id>: <title>`) and whose body is `itemMailBody`: it names
   the item and carries "The operator's answer: <answer>" (or says the item takes no answer). The answer is inside the body
   and is not a column anywhere else (`operator_item_events` stores no answer for a tick), so the body is the ruling's text.
   The record keeps the whole body as stored, never a re-parse of it, because reading the answer back out would need a
   second hand-typed copy of the body's wording.
2. **A digest correction.** `correctDigestRow` in `server/src/coord/digest.ts` (`POST /api/digest/correct`) queues mail of
   kind `finding` whose subject is `digestCorrectionSubject(rowKind, id)` (`Operator correction on ask|approval|call <id>`)
   and whose body is the operator's sentence, trimmed, verbatim. It goes to the row's coordinator (the held-for claimant or
   the call's maker), never the child.

**How the two are selected.** By the subject, through two predicates that sit beside their builders and derive from them:
`isTickMailSubject` (`ledgersMail.ts`, from the same head constant `itemMailSubject` uses) and `isDigestCorrectionSubject`
(`digest.ts`, from `digestCorrectionSubject` itself, so `Operator correction on` still has one holder). The read is
`mail.fromId = 'operator'`, `mail.toId = <the coordinator's session id>`, `mail.runId IS NULL`, newest first, with the
predicates applied row by row until the cap is reached. The mail kind is not selected on: the stall watch raises
`operator` mail of the kinds a stall notice carries, so a kind alone would not isolate rulings, while the subject does.

**Doors that send the coordinator no ruling (and so have no row here):**

- `POST /api/questions/session-<id>/answer` (the operator's answer door) presses the answer into the child's pane and
  settles the ask row; it queues no mail to the coordinator. A coordinator's own `rule` on an ask or approval is the
  coordinator's decision, not the operator's. The digest line it later appears on is what the correction door answers.
- The ask and approval nudges (`askNudgeSubject`, `approvalNudgeSubject`, kind `question`) are the watcher waking a parent
  before the operator's phone is asked: not rulings.
- `operator`-sender mail of kind `status`: stall checks and stall notices, landing notices (`dequeued`, `merged`),
  the program kickoff, a dead-dispatch abandon, a review release, a run-close refusal, an end request and its ended notice
  (to the asker), the tmp sweep and child-reclaim notices, `untold` notices. All are raised by the watcher or by a lane
  on the operator's behalf, or tell a session something happened; none is the operator deciding something for the
  coordinator.
- `POST /api/items/:id/act` and `decline` mail the asker of an end request, not the coordinator.

**Excluded by construction:** mail not from `operator` (a session cannot speak as the role), mail addressed to anyone but
the coordinator, mail on a run (`runId` not null), and any `operator` mail whose subject neither predicate names.

## outcome-from-the-start (Task 3, measured)

The card's checkpoint reads the checkpoint of the generation that ended last for the identity, and only when that
generation's `outcome` is `renewed`. `startOutcome` in `server/src/continuity/generationStart.ts` writes `renewed` on the
generation a start ends when that generation was `clearing`, that is, when a renewal's `renew` act asked for the start;
every other ending is `crashed`, `swapped`, `woken`, `woken-elsewhere`, `unmeasured` or `cleared`. So a crash, a swap or a
wake shows no checkpoint (the notes still ride the card by their own fact), and only a planned renewal hands the successor
its checkpoint. The outcome is written when the successor is minted, so `checkpointBefore` reads it from the predecessor's
own row and no state column.

## Tasks 1, 2 and 4 (the port, the adapter, the lane acts)

- **unproven-is-try-again-later** (the coordinator's carry, review 1919). The port's `RenewResult` has one word the plan's
  union lacks: `unproven`, ccd's exit 7 (`roll-fresh-unproven`: the fresh start could not be proven and the old uuid is
  back). It is never a failure: the machine reads it as after the receipt's first half (`host-failed` with `afterEnd`), so
  the lane retries within `clearing`'s deadline, on the next pass, after a receipt read. `unreachable` and `DeliverResult`'s
  `unreachable` carry a `detail`.
- **renew-checks-the-verb-too.** The adapter asks `capSupported(…, 'hibernate-fresh')` and `ccdCan(…, 'hibernate')`, as
  every other `hibernate` act asks the verb (`verb-gate.test.ts`). A box without either answers `capability-missing`.
- **renew-runs-on-the-serialisers.** The adapter's ccd call runs inside the stop-and-done serialiser around the session's
  queue (`around`), as the automatic roll's act does, so a renewal never interleaves with a send to that pane or a sleep
  lane's act on that row.
- **renew-is-not-a-sleep-act.** `late-census` pins the `ccd hibernate` act sites at one (`sleepAct`). The adapter's `renew`
  is named there as an exception by symbol, legitimately different: the act ends a long-lived session's conversation and
  starts a fresh one (spec §3.3.11 H13), never puts a session to sleep, and is driven by the generations lane through the
  port, not by the sleep executor's rows. A second sleep act site is still red.
- **renew-calls-claimed-first.** Idempotence on (generation, try) is a row of `continuity_renew_calls`, inserted before
  the port is called and given its answer after. A claim already taken is skipped, so a second pass or a restart never
  calls twice for one try; a crash between the claim and the call loses that try, and `clearing`'s deadline decides.
- **retry-owed-on-the-next-pass.** A step's `renew` action is never run straight off the step: `renewOwed` asks for the
  current try of a `clearing` generation whose call is not claimed, once a pass. So the first try runs in the pass that
  entered `clearing`, and a retry (after `host-failed` with `afterEnd`) waits for the next pass and its receipt read.
- **capability-before-due.** Without `hibernate-fresh` the permit refuses before any due is fed (`capability-missing`),
  live or shadow, so no drain begins and no mail is held for a renewal that cannot run. The adapter's own
  `capability-missing`, if it ever answers, reads as before the first half.
- **drain-asks-the-hold-table.** `drained` (and `softRenewalMay`'s `hibernateHold`) is `hibernateVerdict`'s answer with
  the facts that do not bear on a renewal set aside (`drainVerdict`): outstanding mail (the gate holds it), open runs and
  claims, a programme hold, the bucket, presence and the quiet window. Kept: the pane, the live word, a menu, background
  work, subagents, the turn marker and its background and scheduled work, a stranded, swap-blocked, substrate-marked or
  archived row. Every read it could not make holds.
- **walk-stops-at-a-state-change.** The feed orders events for the state the pass read; once one moves the state, the rest
  (the deadline above all) belong to a state the generation has left, so the walk stops and the next pass reads the new
  state's facts.
- **deadline-filter-on-the-feeds.** The card read and the probe rounds stay in their own feeds, each now fed only when it was
  stamped before the state's deadline (`beforeDeadline`); the lane's own step feeds `deadline` after them (m6).
- **checkpoint-sealed-at-renew.** `assemble-checkpoint` stores the checkpoint on entering `checkpointed`, and the `renew`
  act seals it again just before the port is called, with the handover note if one arrived. A hard renewal (no
  `checkpointed`) is sealed at its `renew`, with no handover note.
- **first-prompt-after-a-renewal-only.** The first prompt is planned for a generation the lane minted from a start whose
  ended predecessor's outcome is `renewed`. A start nobody renewed (a crash, a swap) gets the nudge at `carded`'s nudge
  point, as the machine already does.
- **handover-mail-says-note-handover** (notes review 2039 F11). The ask's body names `ccrc-api note handover`.
- **spot-probe-mail-wired** (ask 415). A spot round opened while live plans one system mail, subject `probe`, telling the
  session to run `ccrc-api probe`; in shadow a spot round is still recorded only.
- **degraded-item-deduplicated.** The item's title names the session and the generation; an open item with that prefix on
  the programme is not raised again. A degraded generation that is not a coordinator raises none (no programme) and logs.
- **soft-mode-defaults-when-away.** No Setting for R19's mode exists yet; the lane reads `when-away` until one does.
- **shadow-records-every-step.** In shadow each written step is one log line naming the machine's actions. A shadow walk
  sets no hold-off (that is an act), so a due coordinator's shadow walk can repeat every few minutes; the records show it.
- **gate-lifted-safely.** The `continuity` row and its gate shipped together in #2786, and no door ever accepted Live for
  it, so no stored `live` can stand on a box except by a hand write to coord.db; lifting the gate arms nothing.
- **compact-refused-at-the-route-doors** (launch profiles B review 2024 F3). The operator's `POST /api/sessions/:id/route`
  and the coordinator's `POST /api/runs/:id/route` refuse `compact` while `continuity` is live, 400 `bad-request` with the
  reason (`compactRefusal`). The spawn and dispatch `route` bodies are left as they are: the launch-profile lane rewrites the
  field on its next pass, and a first write at creation undoes no value the lane set.
- **renewing-gate-word.** The mail gate's word is `renewing` (a `MailGate`); the hold reads `state` only, so shadow holds
  nothing (`renewalHoldsMail`). It is checked first in the per-session loop, before the cooldown, so a gated replay spends no
  attempt: `noteGate` writes neither `attempts` nor `nextAttemptAt` (measured in `mail-sweep.test.ts`).
- **no-precompact-write.** Nothing in this piece writes or arms the route field `precompact`.
- **fitted-ceiling-left-out.** `renewalInputsOf`'s fitted ceiling stays unmeasured (`W1`); the renewal readings piece wires it.
- **deciders-beside-renewal-order.** The plan names one new L1 file (`renewalOrder.ts`). The walk's other decisions live in
  their own L1 files beside it, each with a mutant set and a floor: `renewalFeed.ts` (the permit, the ordered feed, renew's
  answer as an event, the owed try, a step's acts, the mail hold and the mail words), `renewalDrain.ts` (the drain) and
  `compactOwner.ts` (the doors' `compact`). `renewalWiring.ts` (L4) composes the adapter and the acts for the watcher, so
  `watch.ts` grows by a few lines only.
- **probing-wait-ends-at-its-deadline** (probes B review 2063 F3b). The walk feeds `deadline` to every timed state, so a
  `probing` generation whose start round is unanswered, or graded unmeasured, ends at `probing`'s deadline (`degraded`);
  a compaction round already supersedes an open spot round.
- **no-wave-map-word.** This piece adds no refusal word: the W1 vocabulary piece's W1a words (`renewing`, `renew-pending`,
  `renew-not-long-lived`, `baseline-missing`) stay on its wave map. The mail gate's `renewing` is a `MailGate`, another
  vocabulary.
- **renew-calls-keyed-by-episode** (found by the simulator, Task 5). A generation whose renewal went back to `active`
  renews again with its tries starting at 1, so a claim keyed by (generation, try) left every later renewal of that row
  without a call. `continuity_renew_calls` is keyed by (generation, episode, try), the episode being the wall time the
  generation entered `clearing` (set once on entry, kept while it retries). The table is new in this piece, so its key
  changed in place in migration 75.
- **soft-renewals-are-rows** (found by the simulator). The soft budget counted one stamp per generation row
  (`softRenewalObservedMs`), so a generation that renewed softly twice counted once, and a shadow walk that repeats was
  unbudgeted. Each soft due the lane feeds is now a row of `continuity_soft_renewals` (migration 75), counted per identity
  and term in observed time. The old column has no writer and is left as it is.
- **handover-belongs-to-its-renewal.** The notes door keeps one handover note per generation (`ON CONFLICT DO NOTHING`), so
  a generation that renews a second time still holds its first renewal's note. The walk's `handover` event takes a note only
  when it was written since the generation entered `checkpointed`, and a sealed checkpoint takes it only when it was written
  within `checkpointed`'s longest stay before the act's renewal began. A second renewal of the same generation therefore
  proceeds without a note (the door's key is the notes piece's to change).
- **simulator-invariant-names** (Task 5). G7 and G8 already existed in the generation day, so the plan's G7, G8 and G9 are
  G9 (at most one fresh conversation per renewal), G10 (every renewal ends within the budget, in `degraded`, or back in
  `active` with a hold-off, an unproven one in `degraded`) and G11 (mail held during a renewal and none lost). G12 is added:
  a live renewal that reaches `clearing` makes its call before it leaves (the check that found the claims fault). G2 now
  holds live and shadow. The day's server side is the real lane and acts over a fake `SessionHost`; the scenario steps no
  row itself. Two test seams were added to the pass: `GenerationsDeps.decide` (mutant deciders, as `observe` already was)
  and `GenReadings.soft` (the soft preconditions' fleet reads the hand-offs piece and W1 will fill; absent, unmeasured).
- **hold-off-and-item-not-rederived.** A crash between a pass and its acts loses that pass's hold-off and degraded item:
  they are acts of the step, not derived from stored state on the next pass.
- **port-delivers-list-rows** (the W1 vocabulary piece, #2840, landed during this piece). Every string ccrc types into a pane is a
  row of `INJECTED_PROMPTS`, and every `sendPrompt` types a row by reference. The first prompt is the new row
  `renewal-first-prompt` (exact, typed by the server), and the port's `deliver` takes a row's key (`RenewalPrompt`, today
  that one row), not free text; `renewalWiring.ts` types it with one `sendPrompt` per row. The vocabulary's key list and the
  characterization of `sendPrompt`'s callers grow by one each.
