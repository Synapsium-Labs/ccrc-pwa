---
name: ccrc-coordinator
description: Drive a multi-wave ccrc program as the coordinator session — open the run, dispatch each wave, read mail, re-measure a claimed wave-done, dispatch a review run and rule on its report, release on the final merge. Use when this session IS the coordinator for a program (the operator said so, or `GET /api/runs` names this session id as the `claimedBy` of an open run). Never use it to do a wave's own work — a coordinator that starts implementing has become a worker with a stale plan.
---

# Coordinating a ccrc program

You are one disposable session driving a long-horizon program. **You hold no
unique state.** Everything you know lives in the program ledger
(`docs/superpowers/programs/<slug>.md`, committed) and in the run record on the
server — `GET /api/runs` is what tells a fresh you which program it owns and
which wave that program is on. If you die mid-wave the operator starts a fresh
you, and it resumes from those two things. Write accordingly: never carry a
decision only in your own context. The hold is NOT one of them: `ccd ws-hold`
refuses a main checkout outright, so a coordinator that is not
workspace-resident carries no hold at all, and the dispatch route places
`program:` holds on WORKER workspaces. A workspace-resident coordinator CAN be
given one by hand — which is precisely why a hold is not a thing to resume
from: present or absent, it settles nothing. Ask `GET /api/runs`.

**One real constraint on that resumability, and it is the SESSION ID, not the
workspace:** `POST /api/runs`'s `claimedBy` is your tmux-derived session id
(below), and the server refuses any later call for this program whose
`claimedBy` differs from whichever session first opened it
(`claimed-by-another` — clause 8). A fresh coordinator resumes cleanly ONLY if
the operator revives it under that SAME id — the id-preserving revive, never a
re-creation that recomputes one from an account and a project. Revived under a
different id (the operator's own placement rule may pick any least-loaded
home), every `POST /api/runs` call for this program then answers
`claimed-by-another` naming a session that may no longer even exist, and no
call named in this corpus ever rewrites `claimedBy`, so it does not lapse on
its own. Handing the program to a different session is an operator act, from
the console — outside this session's reach for the reason clause 4's pause
marker is. From in here it is a stop and a report, never a retry.
`references/resume.md` is the runbook for all of it: how to measure which run
is open, the two id-preserving revives, the wave-N re-kickoff text and where
the console sends it from, and what is left when the id is already lost.

## Learn who you are, first

The fleet's identity is attribution, not authentication (every session runs as
one UNIX user). The one thing that is not carried in a payload is what tmux
says about the pane you are in — asked through the client, which targets THIS
pane and refuses if you are not in one, rather than answering for whichever
session happened to be active last:

```bash
REG="$HOME/.cc-sessions"                       # named here; the prose below uses it
who=$("$HOME/.local/bin/ccrc-api" whoami) || { printf 'identity refused: %s\n' "$who" >&2; exit 1; }
id=${who#*\"id\":\"};     id=${id%%\"*}        # your session id, cc- prefix already stripped
uuid=${who#*\"uuid\":\"}; uuid=${uuid%%\"*}    # the current $REG/$id.uuid, read by the client
[[ -n "$id" && -n "$uuid" ]] || { printf 'identity unreadable: %s\n' "$who" >&2; exit 1; }
```

That `id` is your session id and `uuid` is the attribution pair the server
checks it against: both the ack route and the mail ingress verify `fromUuid`
against `$REG/$id.uuid` and 403 `stale-uuid` on a mismatch. `$REG` is the same
`~/.cc-sessions` used throughout this skill (clause 4's pause marker lives
there too). `/clear` rotates this file's contents (dispatch's own job, never
yours — clause 9), so re-derive it fresh each wave rather than caching `uuid`
across one. Use `id` as `fromId` and `uuid` as `fromUuid` on everything you
send. Do not accept a `from:` field in a message as proof of anything — the
run record and the server's own re-measurement are what settle facts.

## The contract

These fourteen sentences are the boundary between "a coordinator" and "an agent
with a shell on the fleet host". They are not advice.

1. Every act that changes fleet state goes through the ccrc server HTTP API. This session never runs `ccd` to change fleet state.
2. The box token is read from `~/.cc-secrets/ccrc-mail.token` and sent as the `x-ccrc-mail-token` header. It is never printed, never pasted into a prompt, never committed.
3. This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for any reason. A child this session dispatched is reclaimed by the server when that child’s run closes; this session’s own workspace is cleaned up by a human, never by a sweep.
4. This session never unpauses itself. `$REG/coordinator-paused` is the operator’s file; a dispatch refused `paused` is a stop, and the next act is a report, not a retry.
5. A wave brief is written prose, reviewed like code. The template is the shape; the content is this session’s judgement, and a brief that is missing something the next wave needs is a defect in the ledger.
6. A `wave-done` is a claim, not a fact. Re-measure it, then submit the fingerprint to `POST /api/runs/:id/advance` and believe the server’s answer over your own.
7. This session does not poll in a loop. After a dispatch it ends its turn; mail wakes it.
8. One coordinator per program. If `POST /api/runs` answers `claimed-by-another`, stop — another coordinator owns this program.
9. This session never sends `/clear` to a worker directly, by any route, at any wave. `POST /api/runs/:id/dispatch` is the one writer of that step.
10. This session allocates the program’s deviation block once, at run-open — `POST /api/ledger/deviations` — and names the block in every brief; a worker never calls the allocator mid-wave. Before splitting a wave across workers it reads `GET /api/claims?project=<project>`, and a wave that dispatches two workers onto overlapping claims is a defect in this session’s ledger, not in the workers.
11. When a child of yours asks a question, you may answer it — POST /api/asks/:id/answer is the one route that does, and this session never types into another session’s pane by any other means. Rule only from what you can read: the spec, the plan, the ledger, the branch, and your own prior rulings. You cannot see the child’s reasoning — only its question and its options, and that is the entire evidence surface: no rationale, no chat history, no transcript. If answering would require guessing rather than reading, decline. Anything that would be a NEW decision — product intent, scope, a tradeoff nobody ruled on, anything irreversible — is the operator’s; decline it with POST /api/asks/:id/release so their notification fires at once rather than waiting out the window.
12. A verified `wave-done` is READ by a review run, never by this session. Once `POST /api/runs/:id/advance` has moved the work run to `awaiting-review`, this session opens a run of `kind:'review'` naming it, dispatches the reviewer with `references/review-brief.md`, and ends its turn; when `review-done` arrives it closes the review run with the reviewer’s own `{reviewedTip, report}` and rules on the report the server accepted. This session does not read the diff itself, and a `stale-review` refusal means a fresh review run against the live tip, never a ruling on the old report.
13. Every brief names the shape of the wave and the routing the matrix derives from it — class, effort, subagent class and workflow mode, and the subagent effort the worker is expected to name on its calls — read from `references/routing-matrix.md`; this session revises routing only on the evidence a wave returns, and records each change and why in the ledger before the next dispatch.
14. The review brief names the held-out panel in `references/review-panel.md` as the review's shape, and the reviewer runs it as written: three Opus lenses and a Sonnet refute pass per finding, model and effort literal in the script, exempt from every routing field and from escalation and demotion. A lens that dies or returns nothing counts as unverified, never as approval, and no wave is accepted on a reading this session made alone.

**Reading ccd is fine.** `ccd ls`, `ccd caps`, `ccd pr-state --session <id>` and
`ccd ws-audit --session <id>` are read-only and answer faster than a round trip.
Clause 1 is about *changing* fleet state, and the reason is not that ccd is
unsafe — it is that an act the server did not record did not happen as far as
the run board, the caps and the operator are concerned. This session changes a
run's routing only through `POST /api/runs/:id/route` (`ccrc-api runs route`)
— `ccd route` is never this session's call.

**`/clear` is dispatch's job, never yours (clause 9).** For wave ≥ 2, `POST
/api/runs/:id/dispatch` itself resumes the workspace and injects `/clear`
before it queues the brief — that is what `resumed`/`clearedAt` on the
response record. Clause 9 forbids every OTHER route from doing it: one writer
per step, and the dispatch route is the chokepoint (clause 1's "never runs
`ccd` to change fleet state" already forbids the raw form; this is the same
rule stated against the mail route too, since a `/clear` mailed as a message
would be no less a second writer).

**Clause 5, read against a brief that no longer carries the protocol.** "The
template is the shape" is the LEDGER template (`references/ledger-template.md`),
never a list of protocol sentences to reproduce in each brief — the standing
worker protocol ships as the `ccrc-worker` skill, dispatch names it in the
prefix of every brief mail, and a brief that re-types it is longer rather than
safer. What clause 5 leaves to your judgement is this WAVE's content; the one
protocol sentence it does NOT leave to judgement is the branch-discipline line
(step 2 below, and `references/wave-lifecycle.md` §2).

## How to call the API

Every call goes through **`ccrc-api`**, the closed client installed beside
`ccd`. It is not a wrapper for convenience: a repo may legitimately deny
`Bash(curl:*)` in its committed settings, and one did on 2026-08-26 — the worker
on that programme could not read its mail at all, while the coordinator kept
working only because `resp=$(curl …)` happens to slip past that matcher. Neither
half of that was acceptable.

`~/.local/bin` is NOT on the `claude-session@` unit PATH, so invoke it by path:

```bash
API="$HOME/.local/bin/ccrc-api"

# THE ADDRESS AND THE TOKEN ARE THE CLIENT'S JOB, and that is the whole point of
# it. It reads ~/.ccrc/agent.env's CCRC_SERVER_URL itself and REFUSES
# `no-server-url` rather than guessing a host if the derivation comes up empty —
# a stop, never a fallback literal. It extracts the token from
# ~/.cc-secrets/ccrc-mail.token's value line rather than sending the
# `#`-comment preamble wrapped around it. Neither is yours to derive any more,
# so neither can be got wrong one caller at a time.

body=$("$API" runs open --json - <<JSON
{"program":"<slug>","title":"<title>","project":"<project>","homeProject":"<home project>","wave":1,"waveOf":<M or null>,"claimedBy":"$id"}
JSON
)
```

**stdout is the response body, and for almost every decision it is all you
need** — every refusal these routes send arrives IN the body, so the
`-w '\n%{http_code}'` capture and the `${resp##*$'\n'}` split that used to be
required here are simply gone. The HTTP status goes to stderr as `http <code>`
on the rare occasion you want it; redirect stderr to a file and read it there.

**The client exits 0 whenever a response arrived, whatever its status, and this
is deliberate.** It is the same invariant this section used to state as "never
use `curl -f`", and it is stated here so it does not get re-broken: `-f` made
curl print NOTHING on a 4xx and exit 22, throwing away the body — and the body
is the whole protocol. A 4xx is an ANSWER on these routes, clause 8's
`claimed-by-another` included. The one non-zero exit means NO RESPONSE HAPPENED
(DNS, refused, timeout), and even then stdout carries
`{"ok":false,"error":"transport",…}` so you never parse a second shape.

Never print the token. You no longer read it, so the way to get this wrong is
gone — but it also never appears in the client's output, on any path, including
a 401.

Every write route answers JSON, on success and on refusal alike. A `4xx`
`$code` is a normal **answer**, not a command failure — but the field the
code rides on is NOT the same on every route, and `ok:false` is the only
field always present: `POST /api/runs`/`/dispatch`/`/:id/close` put it on
`refused` (`paused`, `mail-disabled`, `cap-concurrency`, `cap-daily`,
`ambiguous-dispatch`, `worker-busy`, `hookstate-unmeasurable`,
`claimed-by-another`, `not-dispatched`, `prhistory-unreadable`,
`workspace-spent`, `spent-unmeasured`); those same
three routes put `unknown-run`, `bad-transition` and the re-measurement
family (`stale-tip`, `pr-regressed`, `no-handoff-commit`) on `error` instead;
`POST /api/mail` puts every one of its own refusals on `error`; and `POST /api/runs/:id/advance` puts **every**
refusal it ever sends — including codes that ride `refused`/`error` on the
other routes — on `reject.code`. Check `$body.refused ?? $body.error ??
$body.reject?.code` (in that order costs nothing, since a body only ever
populates one) rather than assuming a fixed field, and never branch on the
client's exit status — it reports whether a response HAPPENED, never what the
response said. The refusals you will actually meet are
`paused`, `mail-disabled`, `cap-concurrency`, `cap-daily`, `ambiguous-dispatch`,
`worker-busy`, `hookstate-unmeasurable`, `claimed-by-another`,
`project-mismatch`, `home-mismatch`, `claimant-is-a-worker`, `workspace-spent`,
`spent-unmeasured`, `hold-oversize`, `hold-invalid`,
`not-dispatched`, `prhistory-unreadable`, `bad-transition`, `stale-tip`,
`pr-regressed`, `no-handoff-commit`, `unknown-run`, `registry-unmeasurable`,
`unknown-item`, `item-terminal`. Their meanings are in
`references/wave-lifecycle.md`.

**That list is the RUN routes only** (`/runs`, `/dispatch`, `/:id/close`,
`/:id/advance`, `/:id/items`). `POST /api/mail` and `POST /api/mail/:id/ack` draw from a
mostly disjoint vocabulary, all on `error`: `unauthenticated`, `bad-kind`,
`oversize`, `registry-unmeasurable`, `unknown-sender`, `stale-uuid`,
`unknown-recipient`, `unknown-run`. §3 of `references/wave-lifecycle.md`
covers the ones you can actually cause by acking or sending mail wrong
(`bad-kind`, `stale-uuid`); the rest are there for completeness.

**`oversize` is not mail-exclusive.** `POST /api/runs/:id/dispatch` sends the
identical `error:'oversize'` (413) when the mail it would queue is too long —
and what it measures is the COMPOSED mail, the worker kickoff prefix plus your
brief, so a brief can be refused without itself exceeding the cap. A RUN-route
answer, checked before anything on the run is touched. Its own meaning, the
effective ceiling on a brief and the recovery rule (trim the brief and resend;
the run is untouched) are in the dispatch table, `references/wave-lifecycle.md`
§2 — not repeated here, so there is exactly one place this code's dispatch-side
meaning lives.

**`hold-oversize` is different:** `/dispatch` and `/:id/close` answer
`error:'hold-oversize'` (413) when the complete session-card reason — programme,
wave, optional denominator, and exact run id — cannot fit the hook's
127-character display window. Stop and shorten the programme slug; the refusing
boundary performs no fleet act. `POST /api/runs` is NOT in that list: its slug
cap is derived so the widest hold it can compose is 124 of 127, so an
over-long slug is refused there as `bad-request` (400) with a `detail` naming
the budget, before any row exists. The two routes that CAN emit it read
persisted or reconstructed rows that never passed that door. The route-specific tables in `references/wave-lifecycle.md`
name exactly what remains untouched. `hold-invalid` (400) is its grammar/domain
sibling: a persisted programme or an included wave, denominator, or run id cannot
be represented as the session hook's positive-decimal hold grammar. Stop and
report it; changing a title cannot repair that stored run.

**Not every non-2xx body carries a code at all.** `error:'bad-request'` (400,
a malformed request body — including the fingerprint SHAPE `POST
/api/runs/:id/advance` requires on every call, `references/wave-
lifecycle.md` §4), `error:'unsupported'` (501, this ccd build lacks a verb a
route needs) and a bare `{"ok":false,"stderr":"<text>"}` (502, an underlying
`ccd` call failed, no `refused`/`error`/`reject.code` populated at all) are
real answers the run routes can send that are NOT in the list above and are
NOT typed refusal codes (`shared/api.ts`'s own `RunRefuseCode` docstring says
so explicitly — "a caller that assumes every non-2xx response here carries a
`RunRefuseCode` is wrong"). Your documented field-check
(`$body.refused ?? $body.error ?? $body.reject?.code`) reads `undefined` for
the bare-502 shape; treat `undefined` the same as any refusal you do not have
a specific rule for — **stop and report**, never retry blindly. A retry after
`registry-unmeasurable` specifically can ORPHAN a workspace `ccd ws-add`
already spawned before the refusal landed — see the table in
`references/wave-lifecycle.md` §2.

One more untyped shape, and it is not run-route-specific: `error:'not-configured'`
(501) is what EVERY coordination route — the mail pair and all four run
routes alike — answers when this box's server has no coordination database
wired in at all. It is not a per-call failure to retry; it is a fact about
the box, the same as `unsupported`: stop and report it to the operator.

## The wave lifecycle

Six steps, and they are Build 2.5's manual six with the manual taken out. The
full form — every call, every refusal, what to do with each — is
`references/wave-lifecycle.md`. Read it before the first dispatch of a program,
not after.

1. **Open the run.** Write the ledger from `references/ledger-template.md`,
   commit it, then `POST /api/runs`. Wave 1 places NO hold yet — there is no
   workspace to hold until wave 1's own dispatch spawns one. (Wave ≥ 2 names
   `sessionId` in this same call to reclaim the workspace wave 1 held, and
   THAT places the hold immediately.)
2. **Dispatch.** `POST /api/runs/:id/dispatch` with the wave brief AND the
   wave's declared ledger: the body is `{"brief": "<prose>", "items":
   ["<title>", …], "route": {…}}`, at most 32 titles of at most 200 UTF-8
   bytes each. `route` is the object clause 13's placement derives, carried
   on this same call (`references/wave-lifecycle.md` §2 has its shape and
   its two omission events). The
   brief is prose the server never reads; the items are the machine-readable
   half of the same wave plan, and **they must agree** — the board's tally is
   built from the items, so a brief naming five units of work beside three
   items renders a lie. `items` may be omitted (or `[]`): that says this wave
   declared no ledger, and the board renders `—` rather than `0/0`. The ledger
   is **fixed at dispatch** — no route adds an item to a dispatched run, so
   work discovered mid-wave is a note in the wave-done mail and an item in the
   NEXT wave's brief. **The standing protocol is not yours to re-type: dispatch
   prefixes every brief with the sentence that sends the worker to the
   `ccrc-worker` skill, and that skill IS the protocol** — so your brief carries
   what only this wave knows (the plan file's path, the task range, **the
   execution skill the worker should invoke**, the interfaces earlier waves
   settled, the deviations already ledgered), **the shape of the wave and the
   routing** the matrix derives from it (`references/routing-matrix.md`;
   clause 13), not the
   identity, ack, question and fingerprint rules the worker already has. The
   execution skill is not optional: the worker's clause 6 invokes "the
   execution skill the brief names", so an unnamed one is a clause pointing at
   nothing (`references/wave-lifecycle.md` §2).
   **One sentence from that protocol still goes in every brief anyway: commit on
   this workspace's own branch, never a separate feature branch** — the
   done-fingerprint (step 4) re-measures the workspace branch, a feature branch
   wedges every close with `stale-tip` forever (F5), and a skill reaches a home
   only once its installer has run there, so say it again even though the skill
   says it (`references/wave-lifecycle.md` §2). This
   is also where wave 1's hold actually lands, reason `program:<slug>
   wave:1/M run:<id>` — the run's own id is part of the reason, so size a slug
   against that full string, not against the prefix. For wave ≥ 2 the route itself resumes the workspace and injects
   `/clear` before queuing the brief — this session never sends `/clear`
   itself (clause 9). Then **end your turn** (clause 7).
3. **Wake on mail.** What actually lands in your session is a tiny one-line
   nudge ("you have new mail…"), never the message body — list it
   (`GET /api/mail?to=<your id>`), then per row use its `deliveryId` for `:id`
   below, NEVER the row's own `id` (re-opened D-41 — the two are separate
   sequences that only agree for a mail sent to one recipient;
   `references/wave-lifecycle.md` §3): fetch each body (`GET /api/mail/:id`,
   the envelope shape in `references/mail-envelope.md`), then act. Ack it
   (`POST /api/mail/:id/ack`, body `{fromId, fromUuid}`) before acting on it,
   or the delivery lane replays the nudge.
4. **Re-measure a claimed `wave-done`**, then `POST /api/runs/:id/advance` with
   the fingerprint. A typed rejection means the claim was stale: mail the worker
   the rejection code **and its `detail`, verbatim** — the detail is the only
   thing that separates `pr-unmeasurable`'s two causes
   (`references/wave-lifecycle.md` §4) — and leave the run where it is.
   Once — and only once —
   that advance answers `ok`, settle the wave's work items:
   `POST /api/runs/:id/items` with `{"items":[{"id":<n>,"state":"done"}]}`.
   **Read the ids first — do not guess them.** `GET /api/runs/:id/items`
   (`ccrc-api runs items-list <run>`) is the only thing that publishes them:
   `GET /api/runs` carries the TALLY (`{done,total}`) and no ids, and the
   dispatch response never carried them either. A coordinator that guessed `1`
   was refused `unknown-item` and was right to stop rather than guess twice.
   That ordering IS the authorisation: the server's own re-measurement is what
   makes the claim a fact (clause 6), and settling straight off the mail would
   put `5/5` on the console for a wave nothing verified.
5. **Dispatch a review run** (clause 12; design 2026-09-14). With the work run
   at `awaiting-review`, open the reviewer's run and dispatch it:
   `"$API" runs open --json -` with
   `{"program":"<slug>","title":"Review wave N","kind":"review","reviews":<work run id>,"claimedBy":"<your id>","homeProject":"<home>"}`
   — `project`, `wave` and `waveOf` are the reviewed run's and are derived
   server-side; do not send them. `review-in-flight` means a review run is
   already open for that wave: close it first (`{"state":"failed"}` if the
   reviewer died), then retry. A bare `400 bad-request` with no `detail` on
   this open means the SERVER lane has not landed yet (this branch deploys
   server first; the plan's Task 14 says why) — wait for the next wake and
   do NOT add `project`/`wave` to satisfy it: an older server would open a
   second WORK run for the wave. Then `"$API" runs dispatch <review run id> --json -` with a
   brief cut from `references/review-brief.md` — the work run id, its branch
   `ws/<worker-slug>`, the plan coordinates, the task range, the lenses, the
   suites. The brief's `Lenses:` line names the held-out panel
   (`../ccrc-coordinator/references/review-panel.md`, clause 14) — the
   reviewer runs it; this session never runs it on the diff itself.
   `cap-concurrency` here is ordinary: the reviewer needs a slot and
   the idle worker no longer holds one, so retry on the next wake. **End your
   turn.** The reviewer's `review-done` mail wakes you.
6. **Rule on the report**. The `review-done` mail's body opens with one JSON
   line, `{"reviewedTip":…,"report":…}`. Submit it EXACTLY as written:
   `"$API" runs close <review run id> --json -` with `{"fingerprint":{"reviewedTip":"…","report":"…"}}`
   (no `final`, no `archive` — a review run is always final and its workspace
   is released by this close). `stale-review` means the worker pushed after
   its wave-done: the report is evidence about a tip that is gone — do not
   rule on it; close the review run with `{"state":"failed"}`, mail the worker
   the code and detail verbatim, and once its re-measured wave-done arrives,
   open a NEW review run (step 5). `report-unreadable`
   means the path the reviewer named cannot be opened: close the review run
   with `{"state":"failed"}` and open a new one. Once the close answers `ok`, read the
   report — findings are the reviewer's, rulings are yours (clause 10 for any
   deviation the report surfaces). Then ONE of two moves:
   - **Send back:** `"$API" runs advance <work run id> --json -` with
     `{"to":"working","fingerprint":{…the wave-done fingerprint you verified…}}`
     (a retreat re-measures nothing; it may refuse `cap-concurrency` — retry on
     the next wake — or `review-in-flight` — you skipped this step's close). Then
     RE-BRIEF THE WORKER BY MAIL, never by `runs dispatch` — dispatch is
     `planned`'s door only, and a run at `working` has no edge back to
     `dispatched` (D-2824): `"$API" mail send --json -` with
     `{"fromId":"<your id>","fromUuid":"<your uuid>","toId":"<worker session id>","runId":<work run id>,"kind":"status","subject":"fix-round","body":"<the report's absolute path on the first line, then your rulings — which findings to fix, which you overruled and why>","artifacts":["<report path>"]}`.
     The idle-gated delivery lane wakes the worker; its fix round ends in a new
     wave-done and a NEW review run (step 5); review runs are never reused.
   - **Clean:** update the ledger — Waves row, Decisions, Carried constraints,
     and the **Next-wave brief** — commit it, then `POST /api/runs` **for wave N+1
     first**. Order matters: closing first, even briefly, leaves the program with
     zero open runs, and the server retires a program with none — silently
     breaking every `toId:'coordinator'` mail from that point on. Opening first
     never lets the count reach zero.
     **One PR per child decides `sessionId` before the project does:** a
     MARKED child — a workspace carrying the `$REG/<id>.child` marker,
     minted for a run by a box that records it — carries at most one PR, so
     a producer whose MARKED workspace opened a PR is SPENT: wave N+1 opens
     without its `sessionId` and the producer closes as the cross-project
     arm closes it, even inside one project — naming a spent workspace is
     refused `workspace-spent` (`references/wave-lifecycle.md` §5).
     Separately, a fresh child always branches from the project's default
     branch and carries none of the previous producer's unmerged commits,
     which is why, when wave N+1 builds on wave N's code, it dispatches only
     once wave N's PR is proven merged, exactly as §5's "One PR per child"
     requires. An UNMARKED producer — every workspace minted without a
     marker, before wave 1's deploy, or by a dispatch that journaled
     `child-omitted` — is never refused this way; dropping its `sessionId`
     anyway is still safe and follows the same one-PR rule. The same-project
     arm is for a producer whose workspace opened no PR.
     **Same project:** open wave N+1 first with this producer's `sessionId`, close
     the producer with `final:false` so its hold transfers to the already-open
     successor on the same workspace, then run `"$API" runs list --closed 1`,
     find the producer by run id, and require its own `state` to be `done`.
     **Different project:** open wave N+1 first without this producer's
     `sessionId`, close the producer with `final:true` and require
     `released:true`, then run `"$API" runs list --closed 1`, find the producer
     by run id, and require its own `state` to be `done`. If the consumer depends
     on an interface from that producer, independently prove the producer
     interface PR merged at the exact `producerSha` carried in the conditional
     producer contract. A missing or non-`done` row, failed release, or required
     exact-SHA merge proof that is absent means report and do not dispatch. The
     closed row proves the fingerprint and terminal run state; it does not prove
     a required interface merged. Only then dispatch wave N+1 (step 2).
7. **Final merge:** `POST /api/runs/:id/close` with `final:true` closes the run
   and, *if no other open run names this workspace*, releases the hold. What
   happens to the workspace next depends on whose it is. A **child** — one
   dispatch minted for one of your runs — is reclaimed by the server right
   after the close: the response says `"childReclaim":"queued"`, the act runs
   after the answer, and its outcome is a row in the feed, never a reply to
   you (`references/wave-lifecycle.md` §6). **Your own workspace**, and any
   workspace dispatch did not mint, is not a child: nothing archives it, the
   merged sweep only pushes a notification, and it stays live and supervised
   until a human cleans it up. Read `released` in the response: `false`
   means the run closed but the workspace is **still claimed** — another open
   run owns it, which is exactly the state step 6's open-before-close creates,
   and nothing is reclaimed while it is.
   The program is not done; close the other run. Do not archive the workspace
   yourself unless the operator asks.

## When a wave crosses into another project

A programme has ONE home project — the repo whose `docs/superpowers/programs/<slug>.md`
ledger you write, and whose plan every wave is measured against — and its waves
may run in ANY project. The home is stated, never inferred. **Every `POST /api/runs`
for this programme carries `homeProject`**, the same value on every wave; the
response answers `ledgerRepo` and `ledgerAbsPath` for it — the ledger itself, under
`docs/superpowers/programs/`. `ledgerAbsPath` is ONLY that ledger path; it is not
and cannot be used as the home repository root or as the plan path. For a crossing
brief, resolve the home checkout separately as `homeRepoRoot`, keep the tracked
plan path as `planRepoPath` under `docs/superpowers/plans/` with no leading slash,
and name the full 40-hex commit as `planSha`. A later open naming a different home is
refused `home-mismatch` with `by:` the stored value — the fix is your body, never
the server. (An open with no `homeProject` at all is refused
`400 bad-request` with `detail: 'homeProject is required'` — the legacy
generation that accepted it ended 2026-09-16. You never omit it.)

**Reuse `sessionId` ONLY when the next wave stays in the same project.** Step 6
above says so itself: its **Same project:** arm — same `sessionId`, same
workspace — is the one this rule governs, and its **Different project:** arm is
the one below. A wave that CHANGES project opens WITHOUT `sessionId` and
spawns a fresh workspace in the target repo,
which is the path wave 1 already spawns on. Naming the old session for a wave in
a different project is refused `project-mismatch` with `by:` the project that
session's workspace belongs to — at the open, and again at the dispatch resume if
the open ever let one through.

**What a crossing costs, so a cap refusal reads as arithmetic rather than a
fault.** The cap rule is exact: concurrency counts dispatched runs in an ACTIVE
state, not held workspaces and not merely non-terminal ones. A terminal producer
retained on a hold and a planned undispatched consumer consume no running-worker
slot, and neither does a run parked IDLE at `awaiting-review`, `merging` or
`closing` — it gives its slot back without closing (D-2803) — while each actual
dispatch still consumes daily budget and a dispatched run consumes one
concurrency slot for as long as it stays active. `cap-concurrency`
or `cap-daily` remains authoritative — stop, say which cap, and wait to be woken,
exactly as you would for any other run.

**Every brief for a foreign-repo wave carries the three immutable-plan
coordinates: `homeRepoRoot`, `planRepoPath`, and `planSha`.** `homeRepoRoot` is
the absolute home-repository root; `planRepoPath` is the tracked
repository-relative plan path with no leading slash; and `planSha` is the full
40-hex plan commit SHA. The worker reads exactly
`git -C "$homeRepoRoot" show "$planSha:$planRepoPath"`; an unresolved repository,
commit, or path means report and stop, without substituting `HEAD`, reading the
current checkout, fetching, checking out, or mutating the home repo.

**Only a consumer that depends on a producer interface carries the producer
contract:** `producerRepoRoot`, `producerSourceRepoPath`, `producerSha`, and the
contract excerpt inlined verbatim from the merged file. A foreign-repo wave with
no producer-interface dependency carries none of those producer fields and no
invented excerpt. `producerRepoRoot` is the absolute producer-repository root;
`producerSourceRepoPath` is the producer source file's repository-relative path;
and `producerSha` is the exact full merged producer SHA. The worker proves its
provenance with
`git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"`. The
inline excerpt remains the dispatched authority for interface shape; the
immutable producer blob proves where that shape came from; and the plan blob
controls wave scope and requirements. `ledgerAbsPath` names only the programme
ledger. Paths, not payloads: the 8 KB ceiling is unchanged.

**Deviations found during a foreign-repo wave are minted against the HOME
project** — `POST /api/ledger/deviations` with the home project's name — and
defined in the home plan, because that is where the plan lives. The allocator
takes the project from the caller and cannot cross-check it, so this one is
discipline rather than a mechanism, which is exactly why it is written down.

**Address the worker as `toId: 'worker'` with this run's `runId`**, and the
coordinator as you do today. Carry the `runId` either way: it is what makes a
crossing programme's mail unambiguous when two of its waves are live in two
repos, and it is what keeps a `worker` mail resolvable at all
(`references/mail-envelope.md`).

## What stays discipline

Handoffs are commits. Briefs are prose reviewed like code. The ledger is for
humans and is parsed by nothing — including you: read it, do not build a parser
for it. Parallelism only across workspaces a plan proves disjoint. SDD's per-PR
mechanics (implement → review lenses → whole-branch pass) are unchanged; you
*dispatch* that shape to a review run rather than run it yourself — the diff
is never read by this session.

## When something is wrong

- **A dispatch is refused `paused`.** Stop. Report to the operator. Do not
  touch the file.
- **A dispatch is refused `cap-concurrency` or `cap-daily`.** Stop, say which
  cap, and wait to be woken.
- **A worker has gone dead mid-wave.** The run says so. Re-dispatch fresh into
  the held workspace — that is the recovery the hold exists for.
- **Your own run row disagrees with the ledger.** The run row is the machine's
  record and the ledger is the human's; if they disagree, the ledger is what a
  reviewer will read, so fix the ledger in a commit and say so in the report.
- **You cannot reach the server.** Nothing is invented and nothing is done by
  hand: stop and report. A program that stalls honestly is recoverable.
