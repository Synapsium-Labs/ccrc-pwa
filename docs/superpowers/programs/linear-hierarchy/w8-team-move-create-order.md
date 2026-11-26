# Run 3955 (`w8-team-move-create-order`): a team-key move no longer deadlocks the plan sync

Linear hierarchy wave 8, follow-up. This note defines two deviations, D-9131 and D-9132, and no others. Neither changes the
plan or the spec. Both change behaviour the plan and the spec leave unstated.

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
- that team is the one the epic's project binding recorded when it was last written (`teamKey` on the binding, set at the
  project's create or adoption).

Otherwise the create waits until the project's stored fingerprint is current (`projectHasTeams`). A binding that recorded
no team cannot tell what Linear holds, so its create waits too.

The decision is in L1 (`planSyncSteps`). Nothing else changes: `projectHasTeams`, the project step, `heldTeam`, the phase
order, what a write records on a binding, and when a bound ticket's update or move is ready all stay as they were.

**Why the recorded team.** After a move, the planned key is not what Linear holds. The binding's recorded team is the
last fact ccrc wrote. When the project's update is not current, it is emitted in the same pass. So the wait costs one pass
at most, and a project binding that failed skips its tickets, as before.

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

**Definition.** A write that Linear answered with an error the closed table does not know, or with a payload that is not
`success`, is handled like `malformed`. It holds on the backoff steps (`PLAN_SYNC_BACKOFF_MS`) with the same per-binding
counter. After the last step, its binding fails with the word `malformed` and the failure is mailed once, as a `malformed`
failure already is. The pass then
goes on to the programme's other objects.

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
| `plan-sync.test.ts` | an answer outside the table fails `malformed` after the last backoff step, mailed once | red (pending, held) | green |
| `plan-sync.test.ts` | end to end through `runCcrcOp`: an initiative create answered every time with an unknown code fails `malformed`, mailed once, and the other objects are written | red (pending, held) | green |
| `plan-sync.test.ts` | characterization: a plain `unreachable`, maybe sent, only holds however many passes run, and mails nothing | green | green |
| `linear-ccrc-call.test.ts` | an unknown-code errors body is `unreachable`, carries `outsideTable`, journaled `unknown` | red | green |
| `linear-ccrc-call.test.ts` | a transport failure is `unreachable` without `outsideTable` | green | green |

Red first: on the base, 7 of the 282 cases in the four changed test files failed (the rows marked red), and the rest
passed. With the fix, all of them pass.

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
