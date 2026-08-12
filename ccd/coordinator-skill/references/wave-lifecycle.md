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

**Answers that do NOT ride `refused`.** The table above is what SKILL.md
calls "the refusals you will actually meet" — but this route (and `POST
/api/runs/:id/close`) can answer four other shapes, and blindly retrying any
of them is how a workspace gets orphaned:

| shape | meaning | what you do |
|---|---|---|
| `error:'oversize'` (413) | the wave brief itself exceeds the mail body byte cap (`MAIL_BODY_MAX_BYTES`) — checked FIRST, before the pause/kill-switch check, before caps, before anything is spawned or held (`dispatch.ts:98`). Not a mail-routes-only code: this is the SAME field/status `POST /api/mail`'s own oversize body/subject/artifacts refusals use (SKILL.md), but this occurrence is dispatch's own | trim the brief and resend — the run is untouched, still `planned`, and nothing on the fleet was spawned |
| `error:'registry-unmeasurable'` (502) | the fleet's registry directory could not be listed — and this can land AFTER `ccd ws-add` already ran, before the run row records the new workspace | **stop and report; the operator resolves it** — exactly like `ambiguous-dispatch`, never a blind retry. A retry's `before` snapshot now includes the orphaned workspace, so the retry binds a SECOND one and strands the first, unheld and unrecorded, on the fleet |
| `error:'unsupported'` (501) | this ccd build does not support a verb this route needs | stop and report — an operator/fleet-host issue, not a retryable one |
| a bare `{"ok":false,"stderr":"<text>"}`, no `refused`/`error`/`reject.code` field at all (502) | the underlying `ccd` call itself failed for one of its ordinary reasons — `ws-add` (wave 1's fresh spawn), `ensure` (wave ≥2's resume), or `ws-hold` (either wave, the claim itself) | stop and report — the SAME as the rows above, even though none of the three fields SKILL.md's own check reads is populated. `state` always stays `planned` (this shape never advances it) — but that is NOT "nothing happened yet": `sessionId` may already be WRITTEN onto the row (a wave-1 `ws-add` success writes it before `ws-hold` can go on to fail; wave ≥2 always starts with it already there, from an earlier open or dispatch), and a workspace may already exist on the fleet, freshly spawned and unheld. Confirm no partially-spawned or partially-held workspace was left behind by an earlier attempt before ANY retry — the fleet is where that evidence lives, not the run row's own `state` |

`error:'bad-request'` (400) is also possible — a malformed request body —
covered where it actually bites on the ordinary path, §4 below.

For wave 1, this call is also where the workspace's hold actually lands
(reason `program:<slug> wave:1/M` — see §1's own note on this). For wave ≥ 2,
this route itself resumes the held workspace and injects `/clear` through
the send path before it queues the brief — recording `resumed`/`clearedAt`
on the response. This session never sends `/clear` to a worker by any other
route (clause 9); dispatch is the one writer of that step, and a coordinator
that "helps" by clearing the pane itself is a second writer racing the
first.

**The brief must say: commit on the WORKSPACE branch — never a separate
feature branch (F5, build4 dogfood wave 1).** `ws-add` creates the workspace
on its own branch (`ws/<slug>`); §4's done-fingerprint re-measures THAT
branch's tip (`record.branch`, the live registry's own field), never a
branch the brief merely names. The ordinary per-PR SDD convention elsewhere
in this codebase — "cut a fresh `feat/<name>` branch from main" — is WRONG
here: a worker that follows it faithfully leaves the workspace branch
unmoved, so every later `/advance`/`/close` re-measures a tip that never
changes and refuses `stale-tip` forever, with no non-abandon path to close a
run whose work is otherwise correct and reviewed. Every brief — wave 1's
spawn and every reclaim after it — must say plainly: **"commit on this
workspace's own branch; do not create or switch to a separate feature
branch."** This is not optional phrasing left to judgement (clause 5's "the
content is this session's judgement" does not cover it) — it is the one
sentence that keeps the wave closeable at all.

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
   gets dispatched twice. This is bounded, not forever: past a bounded number
   of replay attempts the lane gives up and marks the delivery undeliverable
   (`state:"rejected"` — it stays visible on the read below, since it was
   never acked and never acted on). If you see the SAME `id` injected several
   times, that is a signal to ack (or act on) it now, not a promise it will
   keep arriving indefinitely.
2. Then act.

To see what is outstanding: `GET /api/mail?to=<your session id>`. This
returns only OUTSTANDING mail — `queued`/`delivered` (unacked), plus a
delivery the lane gave up retrying before anyone acted on it
(`state:"rejected"`, distinguishable by that field) — never a row you have
already acked. Add `&all=1` to read the full history instead (every state,
including `acked`), which is what you want for a human-facing "what happened"
question, never for "what do I still owe an answer to" — reading history for
the latter is how a wave gets dispatched twice (a stale copy of a `wave-done`
you already acted on reads identically to new work unless you separately
filter on `state`, which the unfiltered history does not do for you).

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

`RunState` reaches `awaiting-review` only from `working`, and `merging` only
from `awaiting-review` — there is NO `working` → `merging` edge
(`RUN_TRANSITIONS`, `shared/api.ts`), even for a wave whose PR is already
approved when `wave-done` lands. Send `{"to":"merging"}` straight from
`working` and the server 409s `bad-transition`; the accurate sequence always
passes through `awaiting-review`. Every call is `POST /api/runs/:id/advance`,
body `{"to":"<state>","fingerprint":{branchTip,prNumber,prPhase,handoffCommit}}`
— **the `fingerprint` object is REQUIRED on every call, including
`{"to":"working"}`**, even though that step does not re-measure it: a request
missing it, or with any field of the wrong shape (`branchTip`/`handoffCommit`/
`prPhase` not a string, or `prNumber` not a number-or-null), 400s
`{"ok":false,"error":"bad-request"}` before the run row is even looked at —
this one code rides `error`, not `reject.code`, unlike everything else this
route sends (see SKILL.md's field-check rule). For `{"to":"working"}`, where
there is nothing yet to claim, send the empty-claim shape:
`{"branchTip":"","prNumber":null,"prPhase":"none","handoffCommit":""}`.

- **`{"to":"working"}`** — no re-measurement (this is a status marker, not a
  doneness claim; the fingerprint above only satisfies the shape check and is
  never read). Send it once the worker is genuinely underway, and ALSO to
  send work back from `awaiting-review`, or to record a lost merge race from
  `merging` — `RUN_TRANSITIONS` treats both as the ordinary case, not a
  failure, and neither re-measures.
- **`{"to":"awaiting-review"}`** (from `working`) or **`{"to":"merging"}`**
  (from `awaiting-review` ONLY — see above) — re-measured. Send it when a
  `status`/`wave-done` mail carries a claimed fingerprint (`{branchTip,
  prNumber, prPhase, handoffCommit}`). Submit that fingerprint **exactly as
  the worker reported it** — never rebuild it by pairing a freshly re-measured
  `branchTip` with the mail's ORIGINAL `handoffCommit`; see the
  `no-handoff-commit` row below for what that specific mix produces. Re-
  measuring locally first (read-only ccd is fine here: `ccd pr-state
  --session <worker id>`, and `git -C <worktree> rev-parse` for the tip) is a
  sanity check on the claim before you spend a round trip on it — never a
  source for half the submission — and either way **believe the server's own
  re-measurement over yours** (contract clause 6). A mismatch answers
  `{"ok":false,"reject":{"code":"<code>","detail":"<why>"}}` and leaves the
  run state untouched:

| reject.code | meaning |
|---|---|
| `stale-tip` | the branch moved after the claim was written |
| `tip-unmeasurable` | the branch tip could not be re-read (not evidence either way) |
| `pr-regressed` | the PR is not in the phase the claim asserted |
| `pr-unmeasurable` | the PR state could not be re-read (not evidence either way) — but see below: this is ALSO what a malformed submission of your own gets, before any I/O runs |
| `no-handoff-commit` | `handoffCommit` and `branchTip`, IN THIS CLAIM, are not the identical 40-hex sha (or either fails the sha shape) — a correspondence check ONLY ("the worker's two facts agree, and the tip is real"), never a claim that the commit's *content* is a real handoff (that stays your ordinary review, §5 step 1). It fires on a perfectly good wave if you submit a freshly re-measured `branchTip` alongside the mail's ORIGINAL `handoffCommit`: any review fix, lint fix or merge commit pushed to the branch after `wave-done` moves the tip away from what the worker claimed, and mixing the two sources here reports that ordinary shape as this code instead of the accurate `stale-tip` |
| `unknown-run` | the run id is wrong |
| `not-dispatched` | this run has no worker session to re-measure against |
| `bad-transition` | `to` is not reachable from the run's current state |

**`pr-unmeasurable` has two causes, and they need different responses.** The
server returns it both for a transient re-read failure (`detail` reads like
`"pr-state answered …"` or names a stderr) AND, before any I/O runs at all,
for a malformed submission of your own: an omitted `prPhase`, or one spelled
outside its eight-value vocabulary — `unchecked | none | no-commits | open |
draft | merged | closed | unknown` (`PrPhase`, `shared/api.ts`) — refuses this
SAME code (`fingerprint.ts`'s claim-shape check runs before any registry or
`pr-state` read). A natural-language `prPhase` (the kind a `wave-done` body
prose like "PR #591 is green" might tempt you to invent, rather than one of
the eight values above) hits this every time. Read `detail`, not just for the
human-facing report: `"prPhase must be a recognised PrPhase…"` means fix the
field and resubmit now; anything else means a transient fleet problem, worth
a retry. Retrying a malformed claim without reading `detail` first repeats
the same refusal forever.

Mail the code back to the worker — `POST /api/mail` (§3's body shape), kind
`answer`, subject `rejected: <code>`, `toId` the worker's session id, `runId`
this run's id — and leave the run alone. A stale `wave-done` must never
settle a wave.

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
**permanently: nothing in the HTTP API reactivates a retired program, not
even opening a fresh run under the same slug** (`openRun`'s own conflict arm
only ever updates the program row's `title`, never its `state`). Recovery is
an operator/DB act, not a client one — or address the mail with an explicit
`runId` instead of relying on the `'coordinator'` role resolving to it, which
`resolveCoordinator(runId)` answers off that run's own claim regardless of
program state. **Open first** — the new run keeps the count above zero the
whole time, which is the only prevention this ordering rule buys.

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
   wave's** run id — re-measures the SAME facts, against the SAME codes, as
   `/advance` does (skipped only on an explicit `"state":"failed"` abandon),
   closes this wave's run row as `done`, and places the SAME hold reason
   again (`program:<slug> wave:<N+1>/M` — idempotent; step 3 already wrote
   it). The response SHAPE differs from §4's table, though: a mismatch here
   answers `{"ok":false,"error":"<code>","detail":"<why>"}` — `error`, not
   `reject.code` — so read `$body.error` on this route, not `$body.reject`.
   Two refusals besides the re-measurement codes: `not-dispatched` (this
   run's `sessionId` is null — it was never dispatched, so there is nothing
   to re-measure or mail) and `prhistory-unreadable` (`.prhistory` could not
   be read — the route refuses to close on a ledger it cannot verify; retry
   once the file is readable again) — both of THESE two ride `refused`, the
   third shape this one route can answer with.
5. Dispatch wave N+1 (§2, step 2) into the **same workspace**.

## 6 — Final merge

`POST /api/runs/:id/close` `{"fingerprint":{…},"final":true}` on the last
wave's run — re-measures, closes this run `done`, and **releases** the hold
(`ws-release`) instead of re-holding for a next wave. The ordinary sweep
archives the workspace on its own clock and its manifest carries the whole PR
lineage. You do not reap, ever (clause 3); cleanup is the operator's ceremony
in the PWA.
