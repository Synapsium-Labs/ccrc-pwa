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

## Wave 3a: the lane-failing mark, and the gates that read it

A lane whose provider answers turns with errors is marked, and an automatic move prefers other lanes while the mark stands. **No
session is moved by this wave.** It lands before wave 3b (a session moves after its third failure), because a moved session
whose home is the failing lane would otherwise be returned to it at its next idle tick. `ccd` only: nothing on the wire, no
server reader, no setting, no key sent.

### The file

`$REG/<lane>-provfail` holds `<epoch> <word>`, the shape of `<lane>-authdead`: dotless and per lane, so it is in no registry
row's glob. One writer, `ccd/ccd#_provfail_pass`, called by `ccd/ccd#cmd_limit_watchdog` (its own timer, once a minute) before
it asks about any session. One reader, `ccd/ccd#_provfail`. It needs no purge, rename or teardown: past 30 minutes it means
nothing to the reader, and the next pass removes it, for a lane that left the roster too.

### What sets it, and what ends it

The evidence is each row's turn marker, through one reader (`ccd/ccd#_turn_mark_read`, moved out of the affinity move's
background hold in a commit of its own and extended by four fields). The lane is the row's `wrapper`. A stamp counts for a lane
only when it is newer than the row's `lastswap`. Marker, uuid, `wrapper` or `lastswap` absent where needed, unreadable, malformed
or another conversation's: evidence of nothing, neither failure nor health. A stamp over a minute ahead of the clock: the same.

| On one lane | A newer good Stop there | Mark before the pass | After it |
|---|---|---|---|
| one session, 3 counted failures within 2 h since its `lastswap`, the newest within 30 min | no | none, ended or malformed | written, with this pass's epoch |
| the same | yes | none | none |
| two sessions, each with an owed failure (no turn since) within 10 min | no | none | written |
| one such session, or two with one of them older, not owed, or from before its move | - | none | none |
| anything | no | under 30 min old | left as it is, never rewritten |
| anything | yes, newer than the mark | under 30 min old | removed |
| a failure newer than that good Stop, and the first or third row holds | no | under 30 min old | removed and written again |
| anything else | - | 30 min or older, or malformed | removed |

A **good Stop** is a `done` line whose event is `Stop`; or, on a line a later event wrote, its `stopAt` beside an empty
`failAts` and either no failure word or a provider's (the hook empties the list at a Stop and a clear only, and a clear writes
no `stopAt`). Beside any other word the `stopAt` may be that failure's own, so it says nothing.

### The gates

1. **Home** (`ccd/ccd#_swap_target`, through `ccd/ccd#_provfail_holds_home`): the home-recovered arm does not return a session
   to a marked home. A call that must leave keeps that home as the fallback the arm already had, so nothing is refused.
2. **Rank** (`ccd/ccd#_swap_target`): a marked candidate scores 101, behind measured (at most 97) and unmeasured (100), ahead of
   an auth-dead one (now 102). It stays eligible.
3. **Spread** (`ccd/ccd#_rescue_target`): the spread preference is never bought with a marked lane.

`ccd swap` in every form, `ccd swap-self` and `ccd prefer` read none of it. Pools, the class gate, the pool set, the cooldown and
do-not-bounce are unchanged.

### Left for the next pull request

The order a provider move takes its target in (`_provider_move_rank_to`, pure, no caller) and the provider of a lane
(`_lane_provider_to`). They are 14 code lines and this wave is at the growth limit (`ccd (program)` +40).

### Deviations found (wave 3a)

- **D-9095** — the mark is a per-lane fact with one writer in the limit watchdog's pass, so it is off with it:
  `CCRC_LIMIT_WATCHDOG_MIN=0` reads and writes nothing, by that setting's own rule. Readers then see no mark.
- **D-9096** — "fresh" is 10 minutes for an owed failure (the outage notice's window), and the three counted
  failures also need their newest inside the mark's own 30 minutes. Without the second rule a session that was stopped after its
  third failure would mark its lane again every 30 minutes for 2 h.
- **D-9097** — the mark is last among lanes a turn can run on, not behind a dead credential: that one cannot run a
  turn at all. Auth-dead moves from 101 to 102. Both rank inside a bracket, so a marked home-able lane still beats an unmarked
  overflow lane, as an auth-dead one does.
- **D-9098** — `_rescue_target`'s spread pass would have taken a marked lane as the only one no rescue had just
  landed on, ahead of a healthy one. Its name is refused when it is marked, and the pass after it decides.
- **D-9099** — `ccd prefer` acts through the home arm, so gate 1 alone would have held it back. A `.home` written
  after the mark is not held, for one move: a row whose `lastswap` is newer than its `.home` is held like any other.
