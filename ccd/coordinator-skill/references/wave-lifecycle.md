# The wave lifecycle, in full

Every call below is `POST`/`GET` against `http://203.0.113.7:7788` with
`x-ccrc-mail-token: $(cat ~/.cc-secrets/ccrc-mail.token)`. One **run row per
wave**: `POST /api/runs` opens a new run for each wave of a program, not one
row for the whole program. `$REG` is `$HOME/.cc-sessions` throughout — SKILL.md's
"Learn who you are, first" defines it once and reads `$REG/<id>.uuid` for
`fromUuid`, the pair every mail call below needs.

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

**The hold, precisely.** When this call names `sessionId` (wave ≥ 2, reclaiming
an existing workspace), the server places the hold immediately, reason
`program:<slug> wave:<N>/M`. Wave 1's open has no workspace yet — nothing is
held until wave 1's own dispatch (§2) places it, same reason, `wave:1/M`. A
coordinator that checks for a hold between wave 1's open and its dispatch and
finds none has not found a bug — it has found the exact window before the
workspace exists. Either way the reason is **display-only** — never parse a
hold reason to learn what wave you are on. Ask `GET /api/runs` and read the
run row's own `wave`.

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

For wave 1, this call is also where the workspace's hold actually lands
(reason `program:<slug> wave:1/M` — see §1's own note on this). For wave ≥ 2,
this route itself resumes the held workspace and injects `/clear` through
the send path before it queues the brief — recording `resumed`/`clearedAt`
on the response. This session never sends `/clear` to a worker by any other
route (clause 9); dispatch is the one writer of that step, and a coordinator
that "helps" by clearing the pane itself is a second writer racing the
first.

Then **end your turn.** Do not sleep-poll. Do not "check in five minutes". The
delivery lane will inject the worker's mail into your session when it is idle,
and that injection is your next turn.

## 3 — Read mail

Mail arrives as the envelope in `references/mail-envelope.md`. For each one:

1. `POST /api/mail/:id/ack` **first**, body `{"fromId":"<your id>","fromUuid":"<your
   uuid>"}` — the exact pair from "Learn who you are, first" ($id, $uuid).
   Anything else 400s `bad-kind`; a `fromUuid` that does not match
   `$REG/<your id>.uuid` 403s `stale-uuid` (the file this session's own
   `/clear` would rotate — re-read it if you have any doubt). Until you ack,
   the lane replays the message verbatim on later sweeps — you will see it
   again, and a second copy of a message you already acted on is how a wave
   gets dispatched twice.
2. Then act.

To see what is outstanding: `GET /api/mail?to=<your session id>`.

**Sending mail of your own** — a rejection (§4), a question, a status
update — is `POST /api/mail`, body:

```json
{"fromId":"<your id>","fromUuid":"<your uuid>","toId":"<recipient id>",
 "runId":<run id or null>,"kind":"answer|question|status|finding|artifact",
 "subject":"<subject>","body":"<body>","artifacts":["<absolute path>", …]}
```

Same `fromId`/`fromUuid` pair as the ack, checked the same way. `artifacts`,
when given, must be **absolute paths** — the ingress refuses a relative one
`bad-kind` — because the recipient reads the file directly, from whatever
directory its own turn happens to be in, not from this session's.

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

Mail the code back to the worker — `POST /api/mail` (§3's body shape), kind
`answer`, subject `rejected: <code>`, `toId` the worker's session id, `runId`
this run's id — and leave the run alone. A stale `wave-done` must never
settle a wave. `{"to":"working"}` is also how a review sends work back, or a
lost merge race is recorded — `RUN_TRANSITIONS` treats both as the ordinary
case, not a failure, and neither re-measures.

## 5 — The boundary: open the next wave's run, THEN close this one

**Order is load-bearing here, and it is the opposite of what you might guess.**
A program is `active` only while it has at least one open (non-`done`,
non-`failed`) run; the instant its open-run count reaches zero the server
marks it `done`/`abandoned`, and nothing ever reactivates it. `toId:'coordinator'`
mail with no explicit `runId` resolves through `resolveCoordinator(null)`,
which requires exactly one program in state `active`. Closing this wave's run
before opening the next one, even for the few seconds between the two calls,
drops this program's open-run count to zero — the program retires right then,
and from that instant every such message is refused `unknown-recipient`,
permanently, until a human re-opens something under this program's slug.
**Open first** — the new run keeps the count above zero the whole time.

1. Review the handoff commit the way you would review any commit.
2. Update the ledger — Waves row, Decisions, Carried constraints, and the
   **Next-wave brief**, which is the whole of what the fresh session reads.
   Commit it.
3. `POST /api/runs` for wave N+1 (§1, step 2, naming `sessionId` for the SAME
   session this wave's run has) — this opens wave N+1's run row and re-holds
   the same workspace with reason `program:<slug> wave:<N+1>/M`. The program
   now has two open runs (this wave's, still `working`/`awaiting-review`/
   `merging`, and the new `planned` one) — it can never read as zero from
   here.
4. `POST /api/runs/:id/close` `{"fingerprint":{…},"final":false}` on **this
   wave's** run id — re-measures the same way `/advance` does (skipped only
   on an explicit `"state":"failed"` abandon), closes this wave's run row as
   `done`, and places the SAME hold reason again (`program:<slug>
   wave:<N+1>/M` — idempotent; step 3 already wrote it). Two refusals besides
   the re-measurement table in §4: `not-dispatched` (this run's `sessionId`
   is null — it was never dispatched, so there is nothing to re-measure or
   mail) and `prhistory-unreadable` (`.prhistory` could not be read — the
   route refuses to close on a ledger it cannot verify; retry once the file
   is readable again).
5. Dispatch wave N+1 (§2, step 2) into the **same workspace**.

## 6 — Final merge

`POST /api/runs/:id/close` `{"fingerprint":{…},"final":true}` on the last
wave's run — re-measures, closes this run `done`, and **releases** the hold
(`ws-release`) instead of re-holding for a next wave. The ordinary sweep
archives the workspace on its own clock and its manifest carries the whole PR
lineage. You do not reap, ever (clause 3); cleanup is the operator's ceremony
in the PWA.
