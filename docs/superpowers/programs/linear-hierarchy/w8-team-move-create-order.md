# Run 3955 (`w8-team-move-create-order`): a team-key move no longer deadlocks the plan sync

Linear hierarchy wave 8, follow-up. This note defines two deviations, D-9131 and D-9132, and no others. The plan carries both
definitions, and one pointer from Task 3.2's outcome table to D-9132. The spec is unchanged. Both deviations change
behaviour the plan and the spec leave unstated.

## The defect

A project's Linear team key is changed by hand from team B to team A, in the same Linear workspace. The epic's project in
Linear was last written with teams [B], and its bound tickets' issues are in B. Then a new ticket is added to that epic.

1. The ticket step in `server/src/linear/planSyncPolicy.ts` compared the ticket's team with the epic's team as planned now.
   Both read A, so the new ticket's `issueCreate` was ready at once. `projectHasTeams` was false: the planned project now
   carries [A, B], A as planned and B held by the bound tickets until they move.
2. Steps come in phases, creates before updates, and `runPass` in `server/src/linear/planSync.ts` runs the first runnable
   step, then decides again. So the create went into a project whose Linear teams were still [B], before the
   `projectUpdate` that would add A.
3. Linear refused it with an error code the closed table (`server/src/linear/ops.ts`) does not know. By the spec's rule,
   such a code reads as `unreachable`, which is also the word for a transport failure. So `onFailure` held the workspace
   on backoff, and kept holding it. No binding got a word and no mail was sent. Every pass sent the same create first, so
   the project update and the moves never ran.

## D-9131: a create waits for the project's team as last written to Linear

**Definition.** A create (a ticket with no issue yet) goes ahead before `projectHasTeams` only when two things hold, both
compared without regard to case:

- the ticket's team is the epic's planned team; and
- that team is the one the epic's project binding recorded at its last successful write (`teamKey` on the binding).

The binding records the planned team at every successful project write: its create, its adoption and every `projectUpdate`
(`PlanSync.bind` through `markBound`, still the one writer). The planned team is always among the teams that write sends.
Before fix round 1 an update recorded nothing, so the recorded team was that of the create or adoption, and a key moved away
and back could send a create into a project that no longer held the team.

Otherwise the create waits until the project's stored fingerprint is current (`projectHasTeams`). A binding that recorded
no team cannot tell what Linear holds, so its create waits too.

The decision is in L1 (`planSyncSteps`). Nothing else changes: `projectHasTeams`, the project step, `heldTeam`, the phase
order, what a write records on a binding, and when a bound ticket's update or move is ready all stay as they were.

**Why the recorded team.** After a move, the planned key is not what Linear holds. The binding's recorded team is the
last fact ccrc wrote. When the project's update is not current, it is emitted in the same pass. So the wait costs one pass
at most, and a project binding that failed skips its tickets, as before. A stale record can only cost a pass, never a
create into a project without its team: a record that lags makes the create wait.

**Readers of an epic binding's team.** Recording the team at an update changes what the readers see, and each was read:

- the wait above reads it as the written fact, which is the point;
- the restore comment of a project (`projectComment`) asks the policy and the journal with the binding's team, which is now
  the team the project was last written with, the same team a `projectUpdate` is asked with; the issue reads of the drift
  pass use ticket bindings, which this change does not touch;
- the public-text facts of the binding (`textFactsOf`) use it only when the snapshot does not describe the project, and
  then it is the team the project was last written with;
- the drift pass judges a project by its binding's team against the managed teams, and an initiative by its projects'
  binding teams. After a move the project follows the planned team, as its moved tickets already do.

No reader needs the team of the create.

**The order after the fix.** In the live sequence, the pass now sends:

1. the project update with teams [A, B];
2. the new ticket's create, in A, now that the project carries A;
3. each bound ticket's `issueUpdate` with A's team (the C15 move, `destinationTeamKey`); and
4. once no bound ticket holds B, the project's next update drops it (the `heldTeam` rule, unchanged here and not pinned
   again by this wave).

The brief put the create after the moves. The phases put creates before updates, so the create runs once the project
carries its team, and before the moves. The pins assert what matters: the project update comes before the create, each bound
ticket is moved by its own issue, and exactly one create is sent.

**A refused create's pending binding.** A pass on the old rule may already have sent a refused create, which leaves a
pending binding with no issue. When that binding later becomes ready, request-id recovery finds nothing and the create is
sent once, with the same request id. No issue is created twice.

## D-9132: an answer outside the closed error table is never a silent, permanent hold

**Definition.** A write or a read that Linear answered with an error the closed table does not know, or with a payload that
is not `success`, is handled like `malformed`. It holds on the backoff steps (`PLAN_SYNC_BACKOFF_MS`) with the same
per-binding counter. After the last step, its binding fails with the word `malformed` and the failure is mailed once, as a
`malformed` failure already is. The pass then goes on to the programme's other objects.

- **Reads.** The plan sync sends every read failure through the same handling, so a read answered outside the table (the
  issue read before an update, a recovery or an adoption read) follows the rule too. One pin drives the issue read.
- **Non-2xx answers.** `callLinear` keeps the parsed body of a refusal other than 401, 403 and 429 when it has an `errors`
  array and the caller asked (`keepErrors`, which only `runCcrcOp` does), as `answered` on the `unreachable` failure.
  `runCcrcOp` reads it through the same table as a 200 body. So an unknown code on a 400 or a 500 is marked `outsideTable`,
  and a code that is in the table now answers its table word on a non-2xx. A body that does not parse, or has no `errors`
  array, is a plain `unreachable` as before. The body is never logged, journaled or sent on a wire.
- **Consecutive answers.** The counter counts consecutive answers for one binding. A good answer for the binding clears it
  (`bind`), as does the programme going clean and the failure itself, so a requeued binding counts again from one. This also
  changes the true `malformed` word, for the better: its count used to run over the life of the server.

- **Word.** `malformed` is an existing word. The console shows it as "Linear answered in a form ccrc could not read",
  which is true of this answer. No word, deferral cause or table row is added.
- **Carrier.** `runCcrcOp` (`server/src/linear/ccrcCall.ts`) gives its failure outcome an optional field,
  `outsideTable: true`. It is set only when a body arrived and was read as `unreachable`. The word stays `unreachable`, so
  the spec's rule (§6.8) is unchanged for every other reader. A thrown fetch, a timeout and a rate limit never carry the
  field, and the journal is unchanged.
- **Handling.** `onFailure` in `planSync.ts` sends an `unreachable` that carries the field through the `malformed`
  handling it already had. A plain `unreachable`, a `timeout`, a `rate-limited`, a `policy-unavailable` and a
  `journal-unavailable` keep their current holds.

## Pins

Fixtures only, with neutral team keys AAA, BBB and CCC. None calls Linear.

| File | Case | On the base | After |
|---|---|---|---|
| `plan-sync-lifecycle.test.ts` | the live sequence: project update with [AAA, CCC] before the create, each bound ticket moved by its own issue to CCC and rebound, one create for the new ticket in CCC, no issue twice | red (no project update is ever sent) | green |
| `plan-sync-lifecycle.test.ts` | a refused create's pending binding: one create, same request id, binds | red (the create is sent six times) | green |
| `plan-sync-lifecycle.test.ts` | characterization: a ticket in the project's own unchanged team is created in the first pass, with no project update before it | green | green |
| `plan-sync-policy.test.ts` | the project last written with another team: no create, the project update is emitted, the bound ticket moves | red | green |
| `plan-sync-policy.test.ts` | a binding that recorded no team: the create waits | red | green |
| `plan-sync-policy.test.ts` | the project last written with the planned team (any case), and current: the create is emitted | green | green |
| `plan-sync-policy.test.ts` | round 1: the project not current, its recorded team differing from the planned one in case only: the create is emitted (red when the compare is made case-sensitive: measured) | green | green |
| `plan-sync-lifecycle.test.ts` | round 1: a key moved away and back, the project last written with CCC only: the project update with AAA comes before the one create, no create is refused, no mail | red (the create goes first and is refused) | green |
| `plan-sync.test.ts` | round 1: four answers outside the table, a good write, four more: not failed; the fifth in a row fails it `malformed`, mailed once | red (failed at the first answer after the good write) | green |
| `plan-sync.test.ts` | round 1: the issue read answered outside the table every time fails the ticket binding `malformed`, mailed once | green (a characterization of the reads) | green |
| `linear.test.ts` | round 1: a 400 with an `errors` body keeps it on the outcome when asked; a 500 with no JSON, a 400 with no `errors` array and a call that did not ask stay plain | red | green |
| `linear-ccrc-call.test.ts` | round 1: a 400 with an unknown-code `errors` body is `unreachable`, `outsideTable`, maybe sent | red | green |
| `linear-ccrc-call.test.ts` | round 1: a 500 with no parseable body is `unreachable`, maybe sent, without `outsideTable` | green | green |
| `plan-sync.test.ts` | an answer outside the table fails `malformed` after the last backoff step, mailed once | red (pending, held) | green |
| `plan-sync.test.ts` | end to end through `runCcrcOp`: an initiative create answered every time with an unknown code fails `malformed`, mailed once, and the other objects are written | red (pending, held) | green |
| `plan-sync.test.ts` | characterization: a plain `unreachable`, maybe sent, only holds however many passes run, and mails nothing | green | green |
| `linear-ccrc-call.test.ts` | an unknown-code errors body is `unreachable`, carries `outsideTable`, journaled `unknown` | red | green |
| `linear-ccrc-call.test.ts` | a transport failure is `unreachable` without `outsideTable` | green | green |

Red first: on the base, 7 of the 282 cases in the four changed test files failed (the rows marked red), and the rest
passed. With the fix, all of them pass. The round 1 rows were measured against the head the review read: of the five test
files they touch, four of the new cases failed there (marked red) and the others passed.

The end-to-end case in `plan-sync.test.ts` (the initiative create answered with an unknown code) was amended in the fix
commit: it gained an `initiativesByName` answer with no nodes. The pending binding's recovery makes that by-name read, and
without an answer the fake threw, which is a transport-shaped `unreachable` that holds, so the case never reached the
`malformed` path. The case as first committed stays red on the fixed source for that reason, and it was re-measured red on
the base in its amended form.

## Limits

- **Linear's real answer is modelled, not recorded.** This wave could not record a new live answer. The error that Linear
  returns for an issue created in a project that does not carry the issue's team is constructed in the pins: the
  lifecycle rig refuses a create whose team is not among the project's last-sent teams, and the end-to-end case answers
  with an errors body whose code (`SOMETHING_NEW`) is not in the table. If Linear answers that create some other way (with
  a code the table does know, for example), D-9131 still keeps the create from being sent early. D-9132 only covers codes
  outside the table.
- **The wait is conservative.** A project binding that recorded no team (one written before the team was recorded) makes
  a later create in its planned team wait for the project's update to be current. When the update is current, the create
  goes ahead in the same pass. When it is not, the update is emitted first. No sequence leaves the create waiting forever.
- **The moves follow the create.** See the order above. Nothing in Linear depends on the moves coming first: the create
  needs only its team on the project.
