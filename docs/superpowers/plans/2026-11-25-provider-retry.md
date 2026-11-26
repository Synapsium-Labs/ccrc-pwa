# The provider-failure ladder: waves 1, 2 and 3a

Programme: sessions find a working lane by themselves. Wave 1 of it: a session whose turn ended on a provider error is told to
carry on, by itself, until a turn runs; the operator hears once per outage.

## The ruling

The operator, 2026-11-25: sessions should naturally find a working lane. Nudge at about 1, 4 and 15 minutes after a provider
error; in a later wave, move the session to another account by itself; say in words what is happening; one operator notice per
outage; no coordinator is asked to mend a provider. No new settings. It ships armed.

**Wave 1:** no account moves, no change to `ccd`, no console words on the wire. Wave 2, below, is the words; account moves are a
later wave.

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

## Wave 2: the console's words

The ruling's "say in words what is happening". One optional wire field, words, and nothing else: no change to a nudge, a notice, the
arming or `ccd`, and no setting.

8. **The field** (`shared/provider-retry.ts#ProviderRetryWire`, L0; `FleetSession.providerRetry`, optional): `err`, `since`,
   `attempts`, `nextAt`, `phase: 'retrying'`. One reader, `providerRetryOf`, for a revived row (`reviveFleetSession`) and for a live
   frame, which is cast. A phase it does not know, and anything malformed, reads as absent. No `FLEET_PROTO` change.
9. **Its one writer** (`providerRetry.ts#providerRetryWire`, L1), off the marker and the schedule the verdict nudges on
   (`owedNudges`, read by both): present only while the ladder is armed, a retry is owed, and the session is one it would nudge or is
   held by what a person can end. `providerRetryLane.ts` (L4) says it afresh each pass, so a session no pass could judge is absent,
   and a stopped ladder clears it at once. `fleet.ts` puts it on the row unless the raw live word is `busy` now
   (`providerRetryShown`): the pass judged up to a minute ago.
10. **When no time is promised** (`nextAt` null): a dialog, a question, a usage limit, or a nudge queued and not typed (a person's
    draft, or any other gate of the mail lane).
11. **The words** (`pwa/src/fleet/providerRetryWords.ts`, L1), and whose place they take:

| State | Words |
|---|---|
| due later | `Provider overloaded, retrying 14:52` / `Provider error, retrying 14:52` (the viewer's time; a date when not today) |
| past due | `Provider overloaded, retrying now` / `Provider error, retrying now` |
| held | `Provider overloaded, retry waiting` / `Provider error, retry waiting` |

| Owner extended | What it says in their place |
|---|---|
| `sessionFacts.ts#sessionFacts`, the row's status word | idle, done, working, waiting on workers, and the `stalled` marker (context pressure is still said) |
| `sessionFacts.ts#headerStatusWord`, `sessionHeaderView.ts`, the session screen's status line | the same; a session that waits on you reads `waiting on you · Provider overloaded, retry waiting` |
| `runWords.ts#workerSeenNote`, the run row and the run page | `turn failed` and `quiet` |

Hibernated, dead, exited and archived rows, and a question a coordinator holds, keep their own word.

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
- **D-9100** — the field is absent, never null, when none is known, and it is not kept from one pass to the next: a
  session whose marker, live word or mail could not be read this pass says nothing, where the outage count keeps its last reading.
  Words are a promise, so an unread session makes none.
- **D-9101** — wave 1's `busy` hold is absence, not "waiting": a running turn is the retry. The pass is a minute
  apart, so the assembly takes the field off a row whose raw live word is `busy` now (`shell` is at rest and keeps it).
- **D-9102** — a draft is read as "queued and not typed at a later pass", not as the delivery's `draft-present`
  reason, which the watch's own mail read does not carry. Whatever gate holds a nudge, "retry waiting" is true of it.
- **D-9103** — a row that waits on the operator keeps `waiting`: the operator's act is the one thing that
  moves it. Its header says both, and never a time.
- **D-9104** — a programme box's "no move 2h" and the face's mood keep reading as before: they speak of a
  programme's movement, not of a failed turn.

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
(`_lane_provider_to`). They are 14 code lines and this wave is at the growth limit (`ccd (program)` +40). They landed in wave 3b, A.

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

## Wave 3b: a session moves to a working lane

After its third provider failure on a lane a session moves to another account by itself; with no lane that can take it, it stays and
wave 1's retries continue. No setting, armed. Three pull requests, each safe alone, in this order: A (below) moves nobody; B is the
act's own gate, which nothing dispatches; C decides and dispatches. `ccd` alone decides and acts; the server's part is the placement
forecast (A) and one more restart word (B).

### A. The pure pieces, and new-session placement

1. **The order of a move's targets** (`ccd/ccd#_provider_move_rank_to`, pure, no caller yet): 0 a lane with a good Stop newer than the
   episode's first failure, 1 a lane of another provider, 2 an unproved lane of the same one. Never the lane it is on, a marked lane,
   or a lane of a provider with two marked lanes. A lane's provider is `ccd/ccd#_lane_provider_to`.
2. **Whether the session fits** (`ccd/ccd#_provider_move_fits`, no caller yet). No owner existed: a rescue lands a session on any lane
   with room, whatever its context.

| The target | Its window | The session's context | Answer |
|---|---|---|---|
| on another provider | stated by its own settings | measured | fits at nine tenths of the window |
| an Anthropic lane, entered from another provider | not stated: 200000, the smallest a Claude model has | measured | the same |
| any other lane of another provider | not stated | any | never |
| on another provider | any | not measured | never |
| on the same provider | stated | measured | fits at nine tenths |
| on the same provider | not stated | any | yes |
| on the same provider | any | not measured | yes |

   The window is the lane's `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, which `shared/modelenv.mjs` decides and writes to its settings; settings
   that cannot be read state nothing, and take the floor away. The context is `ctxTokens` of the statusline's sidecar, when it names
   this conversation, is at most 2 h old, and is not zero.
3. **Placement** (`ccd/ccd#_ws_least_loaded`, and its forecast `server/src/limits.ts#projectHome`): the walk runs without the marked
   lanes, and again with them only when it found no lane that is not condemned. `readLimits` reads the mark as `_provfail` does (type,
   grammar, 30 minutes, at most a minute ahead) and says `providerFailing` only when it stands. `projected-home.test.ts` drives both
   sides over one home.

### Deviations found (wave 3b, A)

- **D-9119** — the fit is at nine tenths, not at the whole window: the landing's first turn sends the whole conversation
  and needs room to answer, and the figure is from the last render. It is asked of a provider move only; a limit rescue, the wake
  move and the operator's verbs are unchanged.
- **D-9120** — the window of an Anthropic lane is stated nowhere. Between two of them the model, and so the window, is
  the session's own, so nothing is compared; from another provider it is taken as 200000, which refuses some sessions a one-million
  window would take and never admits one that does not fit.
- **D-9121** — a marked lane is left out of every tier of the placement walk, the measured one included: an unmeasured
  unmarked lane is taken before a marked one with room. Only a dead credential, or a lane whose newest spawn was refused, ranks behind.

### B. The act: what a move proves before it ends anything

Nothing dispatches the arm yet.

4. **One row's evidence** (`ccd/ccd#_provfail_row`), out of wave 3a's pass in a commit of its own: one count for the lane's mark and
   for the session's move. **What is owed** (`ccd/ccd#_provfail_owed`): three counted failures or more since the last move, inside 2 h,
   no turn newer than the newest, and the line's own word a provider's (never `unknown`, `max_output_tokens`, or a limit's).
5. **What holds it** (`ccd/ccd#_provider_hold_to`), asked at the decision and at the act: `_swap_idle_gate` as it is, then background
   work, then the input box. The box must read `empty`: a draft is a person about to continue the session, and no box is a dialog.
   A pending question holds twice over: the live status is not `idle`, and there is no box.
6. **The act's gate** (`ccd/ccd#_swap_provider_act_gate`), `cmd_swap`'s arm `provider`. Cancelled, with `provider-cancel` in the log
   and nothing stopped, when any of these holds:

| At the act | `lastswap` |
|---|---|
| it is not what the dispatch stamped: another move landed, the operator's own | left as it is |
| the session was stopped, is asleep, or a probe does not say it is live | put back |
| the newest counted failure is not the one the decision read (`CCD_SWAP_FAIL`), or is no longer owed | put back |
| the target is marked, switched off, or at its ceiling | put back |
| anything of 5 | put back |

7. **What the move records**: the cause `swap-auto-provider` (`.lastend`, the `ended` line, the resume prompt, the console's "moved off
   a failing provider"), where a rescue records `swap-auto-rescue`. `ccd/ccd#_rescue_history` reads a `provider-rescue` line as it
   reads a `watchdog-rescue` one, so do-not-bounce and spread see it, and `ccd/ccd#_rescue_target` keeps a skip list its caller set.
8. **Nothing is typed.** `ccd-limit-no-keys.test.ts` names every function of this, its transitive scan included.
9. **The carry.** A swap does not touch the marker: it is keyed by the session's id, not by the lane, and the uuid it names is kept, so
   `failAts` survives it (pinned in `ccd-provider-move.test.ts`). The landing's `SessionStart` relabels the line `done` and carries the
   list (pinned since wave 1, `session-hook-turnmark.test.ts`), and wave 1 owes the nudge on the list, so the moved session is nudged
   at the due time its newest failure already had. One case is not carried: a conversation continued under a new id
   (`_ci_resume_follow`) is another conversation to the hook, which starts an empty list.

### Deviations found (wave 3b, B)

- **D-9122** — `_swap_bg_hold` reads nothing into a `failed` line, whose `bg` the last good Stop counted. A provider move
  holds on any count but 0, `-1` included, for 30 minutes from the episode's first failure: a subagent still running then is a client
  of the same provider, and only a good Stop would rewrite the count, so an unbounded hold would never end during an outage. A
  background shell holds without a bound, by the live status word.
- **D-9123** — the move does not run `notify.sh`, which every other swap does: the ruling is one operator notice per
  outage, and the server raises it.
- **D-9124** — a cause word of its own, where the watchdog's and the wake move's arms took existing ones: "off a blocked
  account" is false of this move and is said to the session itself. An older server or console reads it as `unknown`.
