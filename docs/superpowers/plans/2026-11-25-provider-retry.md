# The provider-failure ladder: wave 1

Programme: sessions find a working lane by themselves. Wave 1 of it: a session whose turn ended on a provider error is told to
carry on, by itself, until a turn runs; the operator hears once per outage.

## The ruling

The operator, 2026-11-25: sessions should naturally find a working lane. Nudge at about 1, 4 and 15 minutes after a provider
error; in a later wave, move the session to another account by itself; say in words what is happening; one operator notice per
outage; no coordinator is asked to mend a provider. No new settings. It ships armed.

**Wave 1 only:** no account moves, no change to `ccd`, no console words on the wire. Those are later waves.

## W0: what a failing provider looks like to the hook

Measured on a laptop, Claude Code 2.1.332, in its own tmux server with a throwaway home and a made-up key, against a local fake
server (`ANTHROPIC_BASE_URL`). A `StopFailure` and a `Stop` hook wrote their stdin to a file. One good turn, then the failure.

| Failure | `CLAUDE_CODE_MAX_RETRIES=0` | `=2` | `--resume` after it, server healthy, 35 s |
|---|---|---|---|
| HTTP 529 `overloaded_error` | `server_error` (1 request) | `server_error` (3 requests) | no request, no turn |
| HTTP 503 `api_error` | `server_error` (1) | `server_error` (3) | no request, no turn |
| HTTP 500 `api_error` | `server_error` (1) | not run | no request, no turn |
| connection reset before headers | `server_error` (1) | `server_error` (3) | no request, no turn |
| connection reset inside the stream | `server_error` (1 streamed, 1 not) | `server_error` (3 streamed, 1 not) | no request, no turn |
| stream ended cleanly with no `message_stop` | `server_error` (1 streamed, 1 not) | not run | not run |
| connection refused | `server_error` | `server_error` | no request, no turn |

Every one ends in exactly one `StopFailure` and no `Stop`; the prompt is not sent again by a resume, whose only hook is
`SessionStart` `resume`. So the provider tokens are `server_error` and `overloaded` (the second never seen here: it is in the
matcher list and stays counted). **`unknown` was not produced by any of them**, so a dropped connection is counted, and
`unknown` keeps the `failed` arm's path, unchanged.

Not measured: the first-party base URL, other Claude Code builds, an HTTP 429 (an account's, not a provider's).

After a failure the input box shows Claude Code's own dim hint, `Resend your message to try again`. Before #3387 the box reader
took the character under the cursor for a one-character draft (measured on a captured pane), and rule 5 below refuses a draft, so
a focused pane would never have been nudged. #3387 merged first; the same capture now reads as an empty box.

## The rungs

`n` is the number of consecutive provider failures the hook counted (`failAts`, at most eight kept).

| Failure | Nudge due after it | Nudge started no turn | Told besides the session |
|---|---|---|---|
| 1st | 1 min | again, 15 min after it landed | nobody |
| 2nd | 4 min | again, 15 min after it landed | nobody |
| 3rd and later | 15 min | again, 15 min after it landed | nobody |
| three sessions on one provider within 10 min | - | - | the operator, one notice; a record-only row when none has owed for 10 min |

A real Stop or a `clear` ends it. So does any turn: what is owed is `failAts` non-empty and `turnAt` older than its last entry.

## Rules and where they live

1. **The count** (`ccd/session-hook.sh`, `TURN_MARK_PROGRAM`): `failAts`. A `failed` with a provider token appends; another
   token leaves it; `done` and `clear` empty it; `working` and `restart` carry it. One reader, `server/src/turnmark.ts`:
   a malformed list reads as none and never condemns the marker. The trap it answers: a restart relabels `failed` as `done`.
2. **The policy** (`server/src/coord/providerRetry.ts`, L1): what is owed, when a nudge is due, what stops one, the arming.
   `server/src/coord/stopFailure.ts` (L1) holds the token table and the `failed` arm, moved out of `stall.ts` word for word
   in a commit of its own; `max_output_tokens` and the `request` class keep that arm.
3. **The quiet ladder's hold** (`stall.ts#stallVerdictInner`, hold `provider-retry`), so a worker that owes a retry is not
   mailed to its coordinator as `stall:`.
4. **Coverage**: every live session whose marker reads, through the stall pass's existing row scan. Never a running turn, an
   open dialog or a pending ask, no pane, a stopped, hibernated or archived session, a usage-limit hold, anything unmeasured.
5. **The mail** (`shared/provider-retry.ts`, L0): a run-less system mail to the session itself. It is a row of the mail lane's
   own fixed-line table (`envelope.ts#FIXED_LINE_MAIL`): its line is typed whole, acked as typed, and carries `draft: 'refuse'`,
   which the lane's existing `...nudge.rule` spread turns into `onDraft: 'refuse'`. The refusal is a hold in
   `delivery.ts#decideSendFailure`: no attempt, no park, no notice. `inject/send.ts` is not touched. It is queued `wake: never`, so
   a session that went to sleep after it was queued is not woken for it (D-8073).
6. **The notice** (`server/src/coord/providerOutage.ts`, L1; `server/src/providerOutageMark.ts`, L3;
   `server/src/providerRetryLane.ts`, L4): the disk alarm lane's shape, a durable mark and `hasNotice('coord', '', key)`.
7. **The arming** (`providerRetry.ts#providerRetryArmed`): its own rule. Off under `stall-watch-disabled`, a chosen level of
   Off or Log only, and `mail-disabled`.

Characterization: the moved arm was already pinned by `stall-session.test.ts`, `stall-bodies.test.ts`, `stall-sweep.test.ts`
and `stall-vocabulary.test.ts`; the move commit changes only their imports.

## Deviations found

- **D-9085** — the arm that reads a provider failure was dark by design (D-3605: a wave-2 arm is shadow
  until `stall-watch-w2-live`). The operator's ruling of 2026-11-25 above is what arms it. Its rule is its own: the two
  provider tokens leave the `failed` arm (class `provider`) and the repeat report to a coordinator is gone for them.
- **D-9086** — the marker gains a second additive field, `failAts`, after `crons`. A restart relabels a
  `failed` line `done` and starts no turn (W0), so the state word cannot say a retry is owed; the list can.
- **D-9087** — "stopped by Log only" is read as a level *chosen* in Settings. A box that follows its
  files with no `stall-watch-live` reads as Log only in Settings too, but it is armed: otherwise the ladder would ship dark on
  every box where nothing was ever touched, against the ruling.
- **D-9088** — a run worker's nudge is run-less too, keyed on its mail subject (the due time is in it),
  and writes no `run_events` row, unlike the `failed` arm's. One dedupe serves every kind of session, and a provider row on a
  run would read as a prior failure to the `failed` arm's repeat rule.
- **D-9089** — the mail is a fixed-line mail, not the generic nudge. The generic one asks the session to
  fetch and ack; in an outage it does neither, so the lane's replays would stand beside the ladder's repeats (two outstanding),
  and the designated Overlord has no mail client at all.
- **D-9090** — the one mail that refuses a person's draft instead of stashing it (D-5912). A person writing
  in that box is about to continue the session, and the hold waits for the box, with no attempt counted and no park.
- **D-9091** — "a held session" is not read as a workspace's programme hold: every programme
  worker carries one, so the ladder would reach no worker.
- **D-9092** — the outage notice shares the ladder's arming, so a stopped ladder raises none. One
  session that has got past none of its failures for an hour raises it too (the orchestrator's review): its coordinator is not
  told and the quiet ladder holds, so nobody else would hear of it.
