# The wave lifecycle, in full

Every call below is `POST`/`GET` against `http://203.0.113.7:7788` with
`x-ccrc-mail-token: $(cat ~/.cc-secrets/ccrc-mail.token)`. One **run row per
wave**: `POST /api/runs` opens a new run for each wave of a program, not one
row for the whole program.

## 1 — Open the run

1. Copy `references/ledger-template.md` to
   `docs/superpowers/programs/<slug>.md` in the project's own repo, fill the
   header and the wave-1 row, and **commit it**. The commit is the artefact; an
   uncommitted ledger is not a handoff.
2. `POST /api/runs`
   `{"program":"<slug>","title":"<title>","project":"<project>","wave":1,"waveOf":<M or null>,"claimedBy":"<your session id>"}`
   → `{"ok":true,"id":<run id>,…}`, or
   `{"ok":false,"refused":"claimed-by-another","by":"<other coordinator id>"}`
   if another coordinator holds this program (clause 8 — stop).

   For wave ≥ 2, reclaiming the workspace wave 1 held, add
   `"sessionId":"<the held session id>"` to the same call — it tells the open
   route this run reuses an existing workspace, so the next dispatch resumes
   it instead of spawning a fresh one.

The server places the hold. Its reason is `program:<slug> wave:1/M`, and it is
**display-only** — never parse a hold reason to learn what wave you are on. Ask
`GET /api/runs` and read the run row's own `wave`.

## 2 — Dispatch a wave

`POST /api/runs/:id/dispatch` `{"brief":"<the wave brief, prose>"}`
→ `{"ok":true,"id":<run id>,"sessionId":…,"resumed":…,"clearedAt":…,"briefQueued":…}`
with the run now `dispatched`, or a refusal:

| refused | what it means | what you do |
|---|---|---|
| `paused` | `$REG/coordinator-paused` exists | stop, report, touch nothing |
| `mail-disabled` | `$REG/mail-disabled` exists | stop, report, touch nothing |
| `cap-concurrency` | `maxConcurrentWorkers` is full | stop, name the cap, wait |
| `cap-daily` | `maxSessionsPerDay` is used up | stop, name the cap, wait |
| `ambiguous-dispatch` | wave 1's spawn found 0 or >1 candidate workspaces | stop and report; the operator resolves it |
| `worker-busy` | wave ≥ 2's session is observably mid-turn | wait and retry; do not force it |

`unknown-run` (404) means the run id is wrong or the DB was rebuilt — re-read
`GET /api/runs`. `bad-transition` (409) means this run is not `planned` —
someone already dispatched it, or it is further along than you think.

For wave ≥ 2, this route itself resumes the held workspace and injects
`/clear` through the send path before it queues the brief — recording
`resumed`/`clearedAt` on the response. This session never sends `/clear`
to a worker by any other route; dispatch is the one writer of that step,
and a coordinator that "helps" by clearing the pane itself is a second
writer racing the first.

Then **end your turn.** Do not sleep-poll. Do not "check in five minutes". The
delivery lane will inject the worker's mail into your session when it is idle,
and that injection is your next turn.

## 3 — Read mail

Mail arrives as the envelope in `references/mail-envelope.md`. For each one:

1. `POST /api/mail/:id/ack` **first**. Until you ack, the lane replays it
   verbatim on later sweeps — you will see it again, and a second copy of a
   message you already acted on is how a wave gets dispatched twice.
2. Then act.

To see what is outstanding: `GET /api/mail?to=<your session id>`.

## 4 — Advance the run as the wave progresses

`RunState` only reaches `awaiting-review`/`merging` from `working`, never
directly from `dispatched` — so the ordinary forward path is two kinds of
`POST /api/runs/:id/advance` call, both `{"to":"<state>","fingerprint":{…}}`:

- **`{"to":"working"}`** — no re-measurement (this is a status marker, not a
  doneness claim). Send it once the worker is genuinely underway.
- **`{"to":"awaiting-review"}`** or **`{"to":"merging"}`** — re-measured. Send
  it when a `status`/`wave-done` mail carries a claimed fingerprint
  (`{branchTip, prNumber, prPhase, handoffCommit}`). Re-measure each fact
  yourself first (read-only ccd is fine here: `ccd pr-state --session
  <worker id>`, and `git -C <worktree> rev-parse` for the tip) — then submit
  it and **believe the server's own re-measurement over yours** (contract
  clause 6). A mismatch answers
  `{"ok":false,"reject":{"code":"<code>","detail":"<why>"}}` and leaves the
  run state untouched:

| reject.code | meaning |
|---|---|
| `stale-tip` | the branch moved after the claim was written |
| `tip-unmeasurable` | the branch tip could not be re-read (not evidence either way) |
| `pr-regressed` | the PR is not in the phase the claim asserted |
| `pr-unmeasurable` | the PR state could not be re-read (not evidence either way) |
| `no-handoff-commit` | the last commit is not the ledger-updating handoff |
| `unknown-run` | the run id is wrong |
| `not-dispatched` | this run has no worker session to re-measure against |
| `bad-transition` | `to` is not reachable from the run's current state |

Mail the code back to the worker (`POST /api/mail`, kind `answer`, subject
`rejected: <code>`) and leave the run alone. A stale `wave-done` must never
settle a wave. `{"to":"working"}` is also how a review sends work back, or a
lost merge race is recorded — `RUN_TRANSITIONS` treats both as the ordinary
case, not a failure, and neither re-measures.

## 5 — The boundary: close this wave's run, open the next

1. Review the handoff commit the way you would review any commit.
2. Update the ledger — Waves row, Decisions, Carried constraints, and the
   **Next-wave brief**, which is the whole of what the fresh session reads.
   Commit it.
3. `POST /api/runs/:id/close` `{"fingerprint":{…},"final":false}` — re-measures
   the same way `/advance` does (skipped only on an explicit
   `"state":"failed"` abandon), closes **this wave's** run row as `done`, and
   the route itself re-holds the same workspace with reason
   `program:<slug> wave:<N+1>/M`. No separate hold call is needed.
4. `POST /api/runs` for wave N+1 (step 1, with `sessionId` naming the same
   session), then dispatch it (step 2) into the **same workspace**.

## 6 — Final merge

`POST /api/runs/:id/close` `{"fingerprint":{…},"final":true}` on the last
wave's run — re-measures, closes this run `done`, and **releases** the hold
(`ws-release`) instead of re-holding for a next wave. The ordinary sweep
archives the workspace on its own clock and its manifest carries the whole PR
lineage. You do not reap, ever (clause 3); cleanup is the operator's ceremony
in the PWA.
