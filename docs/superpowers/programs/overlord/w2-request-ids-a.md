# W2 request ids, PR A: task note

The task note of the W2 piece "Request ids", PR A: plan
[`w2-request-ids.md`](../../plans/2026-11-16-overlord-w2/w2-request-ids.md) Tasks A1 to A5, with the W2 index's row
"Request ids" and the coordinator's rulings for this wave (calls 1936 to 1943). It records what Step 0 measured on `main`,
what was built, the fixed-line table's shape as ruled, what a coordinator can now do, every departure by slug, the mutation
rows, what PR B reads, and the known limits. The coordinator folds it into the programme ledger; this pull request edits no
plan, spec or ledger.

## 1. Step 0: what `main` held

Measured at `1efcbe78cb` (2026-11-28).

| Question | Answer on `main` |
|---|---|
| The coordination database's migrations | 135 entries. This piece's migration is the next free slot, 136; the version pins of `coord-db.test.ts` (three) and the undo steps and prose of `run-close-switch.test.ts` and `limit-samples-store.test.ts` were re-derived. |
| The refusal word for a request that is not the caller's | `request-not-yours` (403) is already in `shared/refusal.ts#OVERLORD_REFUSALS`. The mail routes suite's kebab-token census admits any Overlord refusal word through `isOverlordRefusal`, so it needs no second home in `MAIL_REJECT_CODES` (item 1). |
| How the mail door records a refusal | `refuse()` in `routes.ts` takes a `MailRouteRefusal` and writes `CoordStore.recordRejection`, whose code is a `MailRejectCode`. Both now take `MailRejectCode | Extract<OverlordRefusal, 'request-not-yours'>`: a reference to the one home, no copy. |
| Check 7 for mail to the Overlord | Refused by rule, `unknown-recipient`, status 404, detail "the Overlord's role takes no mail in W1", recorded, before the registry is asked. |
| The fixed-line table | Five rows. The matcher reads `{ fromId, subject, mailToId }`; a row's name is a closed list; its line is never absent; the one hold is `waitsForCard` (the timer row's). No push column (item 2). |
| The sweep's mail origin read | `CoordStore.mailOrigin` already returns the mail row's own `toId`, which the table matches as `mailToId`. |
| Where `waitsForCard` is read | `envelope.ts` (the table and `mailNudgeOf`), `watch.ts` (the card hold), a doc comment in `overlordGate.ts`, and the fixed-line sim sets. Nothing outside the server process: no agent frame, no persisted row or file, no answer a client or an older build reads. So the boolean was swapped for the word in place (call 1937, condition 1). |
| The owner test | `CoordStore.claimsProgramme(session, programme, uuid)` (item 4): the programme's coordinator binding, with the session's uuid. |
| The designation read | `designationRead()` answers `designated` (a bound session), `not-designated` with `row: null` (none) or with a row (designated, no session bound), or `unmeasured`. |
| The masker at the mail door | `routes.ts` is handed the composition's whole `deps` and already reads `deps.masker` (with the shape-only fallback) for its other egress; the prompt route reads the same `deps.masker`. So the news line uses that instance, and no port was added (item 5). The goals door stamps no news and needs none. |
| The system mail insert | `rundefsTx.ts#insertSystemMailTx` (`deliverTo` from the timers piece); it now takes an optional `requestId` (item 6). |
| A census of writers of mail to the Overlord | None on `main`: the timers piece's plan names one, but no suite scans for it. Nothing to extend. |
| What makes a held delivery outstanding elsewhere | `outstandingMailFor` lists any non-terminal delivery; `sleep.ts#mailHoldsSleep` holds its session awake; the stall watch's mail-stuck arm read any queued delivery to a coordinator-judged session. |

## 2. What was built

- **The migration (A1).** `runs.requestId`, `mail.requestId` and `programme_modifications.requestId`, each nullable and
  referencing `overlord_requests(id)`, and the partial index `runs_request`. One writer per column, in the insert it already
  makes: `CoordStore.openRun`, `CoordStore.insertMail`, `ledgersStore.ts#addModification`. NULL names no request.
- **The readers (A1).** `CoordStore.runsForRequest(requestId, program)`, through `run()`'s row mapper, in id order, and
  `modificationsForRequest(requestId, program)` with its one-line `CoordStore` delegate. Neither catches.
- **One rule for three doors (L1, `server/src/coord/requestMail.ts`).** `requestOwnerReadOf` (the store's row as the rule reads
  it), `programmeRequestVerdict` (the run door's and the goals door's rule: the owner is the programme), `mailDesignationOf`,
  and `requestMailVerdict` (the mail door's rule, first match, in the ruled order: identity, then ownership, then, for the owner
  only, the request's state and the designation).
- **The run door (A2).** `openRun.ts`'s `shape` takes an optional `requestId`; a `request` gate after `claimantWorker` (so after
  `program`, `attribution` and `claimantWorker`, and before the registry reads) answers `request-not-yours` with one detail for
  unknown, unowned and foreign, or `run-unreadable` when the record could not be read. `OpenRunPlan.requestId` reaches the
  insert.
- **The mail door (A3).** The body's `requestId` (refused `bad-kind` when malformed, as its neighbours are); check 7 asks
  `requestMailVerdict` when the mail is to the Overlord or names a request; a refusal is recorded through `refuse()`, an
  unreadable fact is a plain reply; the role's resolution takes the verdict's `deliverTo`; check 9 sends a report to
  `reportMailVerdict` (60 an hour from one sender, answering `peer-quota` with its time retry) in place of the peer bound,
  whether or not it names a run; the transaction writes `mail.requestId` and stamps the news.
- **The news writer (A3).** `overlordRequestStore.ts#stampRequestNewsInTx`: refuses outside a transaction, stamps only an open
  request, cuts the masked subject at `REQUEST_NEWS_CHARS` (200) code points, raises no revision, stamps no sequence line.
  `REPORTS_TO_OVERLORD_HOURLY` and `REQUEST_NEWS_CHARS` live in `shared/overlordRequests.ts`.
- **The peer bound skips reports (A3).** `peerMailAtsInLastHour`, `outstandingPeerCount` and `hasOutstandingPeerDuplicate`
  leave out mail whose row is to the Overlord, so reports never spend a coordinator's peer quota (C14).
- **The report's hold and push (A4).** Section 3.
- **The goals door and `ratifiedBy` (A5).** `POST /api/programmes/:slug/modifications` takes `requestId` (never with `itemId`,
  refused before any read), which stands for a new definition of done; after `owns`, the request must be the path programme's
  own; an unreadable record answers `unmeasured`. `RatifiedBy` gains `{ kind: 'request'; requestId }`, `RatificationWhy`
  `not-opened`; `parseRatifiedBy(raw, requestId)` reads the id from the row and answers `unreadable` without one;
  `modificationSource(itemId, requestId)` prefers the request; `goalRatification`'s `request` arm answers `not-opened`.
- **The console, by two rows (call 1940).** The ledger words file's two exhaustive tables each gain a row: the request source's
  ratified words (never drawn on this build, said in a comment) and the `not-opened` sentence, in the file's voice. The console's
  words suite pins what a request-sourced version draws (the sentence, with Ratify offered, as every readable unratified version
  does: the spec's "counts as goal evidence once the operator has opened it" names no control, and Ratify is the operator's own
  act) and that a source kind the build lacks reads the unreadable words with no Ratify. No other console source file.
- **Every exhaustive table the new source reached** (the rule of call 1940: one row each, by packet to its holder, with a case
  pinning what this build draws): the console's `RATIFIED_WORDS` and `NOT_RATIFIED_WORDS` (`pwa/src/ledgers/ledgerWords.ts`),
  and the continuity card's `RATIFIER_WORDS` (`server/src/continuity/card.ts`), whose row says what will be true once an
  opening ratifies ("ratified by the operator opening the request it rests on") and is never printed on this build; its facts
  suite pins that a definition of done resting on a request reads not ratified, and its render suite's stand-in for an unknown
  word moved from `request` to `not-in-this-build`. The shared vocabulary maps (`RATIFIED_BY_KIND_MAP`,
  `RATIFICATION_WHY_MAP`) gained their rows with the types.

Nothing is reachable at merge: no request exists until the Overlord's doors open behind `overlord-route-v1`, so every new
check is reachable only after that. The programme's design rule (item 9): everything here is the server's own doors, tables
and deciders, which any agent harness can use; nothing depends on one harness.

## 3. The fixed-line table and its hold, as ruled (call 1937)

- `FixedLineMailRow.name` gains `overlord-report`. Its matcher reads the inputs of today: the mail row's recipient is the
  Overlord's identity and the sender is no mail role (`MAIL_ROLE_IDS`). Not `designatedOnly`: a report to a body retired since
  is still held.
- **One hold column with two words.** `waitsForCard: boolean` became `hold?: 'card' | 'acked'`: the timer row says `card`, the
  report row `acked`, the four other rows say nothing (absent: no hold, today's). The nudge carries the same word. The word is
  `acked`, not the proposal's `until-acked`: a hyphenated word in the coordination directory meets the kebab-token census, and
  a one-word value needs no entry there.
- **Two release rules, one column.** `card` is read where the card hold was read (after the gates, `timerLineHold`, unchanged).
  `acked` is read where the sweep builds its due list (`heldUntilAcked`), so a held delivery never enters the ladder: no gate
  stamp, no attempt, no wake, no park, nothing typed, read again each sweep. The first build held it with a `continue` at the
  head of the due loop; the mail sweep suite's D-792 census reads every bare `continue` before the send as a refusal that must
  name a gate, and a held report is no refusal, so it is filtered out of the list instead (the watcher's holder approved both
  packets).
- **The line stays.** The report row's line is a real fixed line (the mail nudge's head, then "A report on a request waits in
  your inbox."), never typed while the hold stands.
- **The push column.** `push?: 'record-only'`, absent on the five older rows. `pushNewMail` reads it through
  `fixedLinePushOf`, the table's find without the `designatedOnly` filter; `mailQueuedSince` gained the mail row's `toId` as
  `mailToId` for it.
- **The stall watch reads the same rule.** Its mail-stuck arm now leaves out a delivery `heldUntilAcked` holds. The plan said the
  review had measured that the arm does not read a held report as stuck; measured here, it did, for a session judged as a
  coordinator (an Overlord session never is, since the run door refuses it, so the exposure was a retired body that later
  coordinates).
- **The forms census, narrowed (call 1943).** `mail-prompt-forms.test.ts` maps to fixture forms only the rows whose hold is not
  `acked` (derived from the column, never a name); the held rows, the complement, are each pinned never typed with the mail
  unacked, acked, and under the mail-off and the pause markers; the first loop still runs over every row; and a control holds
  the one `card` row inside the census, so widening the filter to a second word reds it.

**Item 2's conditions, each with a case.** Condition 1: no wire (section 1). Condition 2, the endings, in
`overlord-report-hold.test.ts`:

| Ending | Whose act | The delivery afterwards |
|---|---|---|
| The Overlord's session acks it | the session, through the one writer (`markAcked`) | `acked` |
| The designation is rebound | the operator; `goLive` repoints outstanding mail to the role (`repointOverlordMail`, the one writer) | `queued`, naming the new body, still held |
| The designation is retired | the operator | `queued`, naming the old body, still held |
| The request closes | whoever closes it | `queued`, held (the report is still a fact) |
| The sender's session ends | ccd | `queued`, held |
| No Overlord ever reads | nobody | `queued`, held: outstanding for good |

Only an ack ends a held report, and in this build nothing the Overlord runs acks one: its inbox's band 3 (a later piece) serves
held reports by the mail row's recipient and acks them. No sweeper or writer was added (the ruling's condition). The bound and
what an operator sees are in section 8. Condition 3: with the mail-off marker or the pause standing, a held report is neither
typed nor marked, and an ack still ends it through the one writer (the mail-off file ends the sweep before the loop; the pause
is not read by the mail sweep, and the due list's filter leaves the row as it was). Condition 4: the five older rows' mail pushes
exactly as on main (the operator message, the inbox wake, the provider retry and the timer record-only; the spot-probe notice
pushed, as it does on main), and a report reaches no push sender.

## 4. Item 3, the Overlord recipient, as ruled (call 1938)

| Caller and state | Answer |
|---|---|
| Owner of the named open request, Overlord designated with a bound session | 202; mail row `toId: 'overlord'` with `requestId`; delivery to the bound session; news stamped; held |
| Owner, designated with no session bound | 202; delivery addressed to the role's own identity, held (sharpening 2: a held report needs no pane) |
| No request named; an unknown, unowned or foreign request; a sender that does not own it | `unknown-recipient`, 404, recorded, detail "the Overlord's role takes no mail in W1": today's answer byte for byte, one detail for all (a case compares them) |
| Owner of a closed request | `unknown-recipient`, recorded, "request N is closed" (told to the owner only) |
| Owner, no Overlord designated | `unknown-recipient`, recorded, "no Overlord is designated" |
| The request read or the owner test threw | `run-unreadable`, 503, unrecorded; the detail names what could not be read and no request |
| Owner, the designation unreadable | `unmeasured`, 502, unrecorded |

A non-owner never reaches the designation read or the request's state (sharpening 3). Mail to anyone else that names a request
answers `request-not-yours` (403, recorded) for an unknown, unowned or foreign request, sends and stamps nothing for a closed
one, and stamps news for an open one; it keeps the peer quotas.

## 5. What a running coordinator can do now, and what it still cannot

- **Can:** name a `requestId` on `POST /api/runs`, `POST /api/mail` and goals modify, each checked against its programme's
  ownership; report on its own open request to the Overlord's role, within 60 an hour, without spending its peer quotas; rest a
  new definition of done on its request. A goals change made for a request reads `not-opened` on the console.
- **Cannot yet:** do any of it for real, since no request exists before the Overlord's doors open (`overlord-route-v1`); have a
  report reach the Overlord's pane or be acked (inbox band 3); read the Overlord's mail or its attested quote (PR B); have a
  request-backed version count as goal evidence without the operator's Ratify (the piece that records an opening).

## 6. Departures, by slug

- **`request-not-yours-one-home`** (item 1): the word stays in `OVERLORD_REFUSALS` alone; `MAIL_REJECT_CODES` and
  `shared/api.ts` are unchanged; the mail door's refusal helper and `recordRejection` take it by reference. The plan's RI1 put it
  in `MAIL_REJECT_CODES`.
- **`fixed-line-hold-one-column`** (call 1937): one `hold` word in place of the plan's `line: null` plus `holdUntilAcked`; the
  line stays; the word is `acked`.
- **`report-held-before-every-gate`**: the hold is read where the due list is built, before the ladder, not where the card
  hold is.
- **`overlord-recipient-keeps-todays-answer`** (call 1938): at the Overlord recipient every caller that may not report reads
  today's `unknown-recipient` with today's detail; the plan's Table 3 answered `request-not-yours` there.
- **`closed-request-refused-at-the-overlord`** (call 1938 (a)): the plan's Table 3 admitted a report on a closed request.
- **`unbound-designation-admits-to-the-role`** (call 1938, sharpening 2): a designation with no session bound admits the report
  to the role's identity, held.
- **`owner-test-as-on-main`** (item 4): `claimsProgramme(session, programme, uuid)`, with the sender's measured uuid.
- **`report-after-final-close-measured`** (RI18): the plan says a coordinator's report after its programme's last run closes
  is refused. On `main` the owner test is the programme's coordinator binding, which outlives the last run (nothing retires a
  programme any more), so the report is accepted; it is refused once the binding names another session. Both are pinned.
- **`request-owner-read-in-the-store`**: `requestOwnerOf` is the store's `requestById` through the L1 `requestOwnerReadOf`;
  it throws, and each door answers a throw as its own unreadable case. All three doors read it through one `CoordStore`
  delegate, `requestOwner(id)`, so the goals door (`ledgersRoutes.ts`) names no database handle: only `store.ts`,
  `rundefsTx.ts` and `routes.ts` may (the core vocabulary census; found red on the fast run).
- **`news-cut-in-the-writer`**: the 200-character cut is the writer's; the mail door's subject bound (200 bytes) already keeps
  every subject under it.
- **`mail-origin-not-widened`**: the plan widened `mailOrigin` with `toId` and `requestId`; it already carried `toId`, and the
  matcher never reads `requestId`.
- **`peer-counts-skip-reports`**: the peer bound's three counts leave out reports (measured: without it, 60 run-less reports
  spent the sender's peer hour and held reports filled the outstanding pair forever).
- **`stall-mail-stuck-reads-the-hold`**: the mail-stuck arm leaves out a held report (section 3). The pure stall module may
  import values only from its fixed list (the stall vocabulary suite), so it does not call the hold rule itself. The watcher
  reads the held delivery ids through `envelope.ts#heldDeliveryIdsOf` and passes them in as a fact, `heldDeliveryIds`, at the
  worker and coordinator judgements. Absent, nothing is held. A census case pins both call sites. This was found red on the
  fast run, where the first form had imported `heldUntilAcked` into the stall module.
- **`news-writer-is-a-non-stamper`**: the sequence stamp census lists `stampRequestNewsInTx` with the request kind's
  non-stampers. It writes the line of news and its time, and no state word.
- **`held-filter-beside-its-decider`** (call 1995): the mail sweep's filter of held deliveries is
  `envelope.ts#notHeldUntilAcked(due, origins)`, beside `heldUntilAcked`. It applies the rule to the due list and decides
  nothing new: a held report is left out, every other row passes in its order, and a row whose mail is not found is kept,
  as it was when the filter stood in the pass, since a null origin is no report. A throwing read is not caught. `mailPass`
  makes one call to it. This keeps the delivery decide suite's acceptance pin, at most 150 code lines in `mailPass`, which
  the first full run found at 151, without a longer line. The ruling refused joining the two lines.
- **`forms-census-narrowed-by-hold`** (call 1943).
- **`console-two-rows`** (call 1940, clarified): one console source file, two rows, and one case pair in its words suite.
- **`masker-already-in-the-route-deps`** (item 5): no port was added; the mail door uses the composition's `deps.masker`.
- **`goals-door-unreadable-is-unmeasured`**: as the plan's RI9 says, the goals door answers an unreadable record `unmeasured`
  (502), where the run and mail doors answer `run-unreadable` (503), as check 8 does.

## 7. Mutation rows

Deciders registered at floor 1 (every mutant killed), each run through the floors' own runner (`runMutants`):

| Decider | Mutants | Before | After |
|---|---|---|---|
| `requestMail.ts#requestOwnerReadOf` | 9 | not registered | 1 |
| `requestMail.ts#programmeRequestVerdict` | 7 | not registered | 1 |
| `requestMail.ts#mailDesignationOf` | 10 | not registered | 1 |
| `requestMail.ts#requestMailVerdict` | 41 | not registered | 1 |
| `peerBound.ts#reportMailVerdict` | 15 | not registered | 1 |
| `envelope.ts#fixedLineMailOf` (the report row, `heldUntilAcked`, `fixedLinePushOf`, `heldDeliveryIdsOf`, `notHeldUntilAcked`) | +21 (F25 to F45) | 1 | 1 |
| `shared/ledgers.ts#goalRatification` | 12 (+2: the request arm ratified, and answering `effect-unmeasured`) | 1 | 1 |
| `shared/ledgers.ts#modificationSource` | 4 (+2: the request ignored, an item preferred over it) | 1 | 1 |
| `shared/ledgers.ts#parseRatifiedBy` | 4 (the id check dropped, `request` always unreadable, another kind taking the id, the kind guard bypassed) | not registered | 1 |

The `modificationSource` set's two older mutants (M-1, M-2) quoted the function's text before this piece changed it, so they
had become invalid (an `old` that occurs nowhere makes the runner throw); their `old` text was re-taken from the current source,
and both are killed again.

Left out as equivalent, on `programmeRequestVerdict`: dropping `read.kind === 'owned' &&`, or widening it to `!== 'absent'`;
an unowned or absent read carries no owner, so the compare is false for every programme a door passes.

Hand mutations, each red and then restored byte for byte (measured with `git diff`):

- The run door's `request` gate made to pass: 3 cases of the gate-order suite red, 1 of the route suite.
- The gate comparing the owner to the claimant instead of the programme: 1 and 1 red.
- The gate moved before `attribution`: 3 red (the pair row, the adjacency check, and the "reads nothing for a worker or an
  unattributed caller" case).
- The news writer's row taken out of the row-revisions census: the census reds.

## 8. Known limits

- **Held reports pile up until inbox band 3.** Only an ack ends one, and nothing the Overlord runs acks yet. The bound is the
  reports' quota, 60 an hour from one coordinator, from the moment `overlord-route-v1` opens the doors. An operator sees them as
  the bound session's unread mail (the fleet's count and the Overlord's card), and each holds that session awake
  (`mailHoldsSleep`): a retired body with held reports never sleeps. No sweeper was added, by the ruling; band 3 is the end.
- **The non-owner's detail is stale wording.** "the Overlord's role takes no mail in W1" is kept byte for byte by the ruling,
  though W2 now takes the owner's reports.
- **The mail idempotency key ignores `requestId`.** A resend with the same `clientKey` and a different `requestId` answers as
  the first mail.
- **The run door's idempotent retry** (the same programme, wave and claimant against a `planned` row) keeps the first row's
  `requestId`.
- **An urgent report** is not measured: the urgent arm's sender rule runs after the verdict, on the bound session.
- **The tests' type check.** The console package's ran clean here. The server's tests' type check found two of my test
  files red on the fast run: a mail kind that is not a `MailKind`, and an optional field read without a guard. Both are fixed.
  The whole-directory check is killed by the test slice's memory cap on this box. So the server's tests were checked here
  with a project of this branch's server test files and every file they import (152 test files, the watcher included), and it
  is clean. CI's tests' type check is the arbiter.
- **Five guard suites were not run here before the first push**: the core vocabulary census, the stall vocabulary suite,
  the sequence stamp census, the literal source pin ratchet and the tests' type check. Each was found red on the fast run,
  each is fixed in the second push, and each now passes alone through `ccrc test`. The readers suite now reads the store
  through the symbol scan, so the ratchet's count for `store.ts` is unchanged.
- **The delivery decide suite was not run here before the second push.** It reads `watch.ts` as text, so a fast run does not
  select it. The first full run found `mailPass` at 151 code lines. The third push moves the filter out
  (`held-filter-beside-its-decider`), and the suite passes alone.
- **A known flake in the first full run**: a focus-timing row of the delegation adoption card's browser suite failed its
  own precondition (issue #3419). It is not this change's.

## 9. What PR B reads from this one

| Reader | What it reads |
|---|---|
| PR B's fetch rule and quote | `requestMail.ts` (it adds `mailFetchVerdict` beside the verdicts), `mail.requestId`, the mail door's `requestId` field |
| PR B's `overlord` sender | the fixed-line table's report row (its matcher excludes every mail role, so a relay from the new role is no report), `insertSystemMailTx`'s `requestId` |
| Relay A | the goals door's ownership check, to add the `widens` half; `insertSystemMailTx`'s `requestId` |
| Done tests B, follow-up, the operator's request doors, forecasts B | `runsForRequest`, `modificationsForRequest` |
| Inbox band 3 | the report row's `acked` hold and `heldUntilAcked`; held reports served by the mail row's recipient |
