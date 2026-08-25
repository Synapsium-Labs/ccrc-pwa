---
name: ccrc-coordinator
description: Drive a multi-wave ccrc program as the coordinator session — open the run, dispatch each wave, read mail, re-measure a claimed wave-done, review the handoff commit, release on the final merge. Use when this session IS the coordinator for a program (the operator said so, or this workspace's hold reads `program:<slug> wave:N/M`). Never use it to do a wave's own work — a coordinator that starts implementing has become a worker with a stale plan.
---

# Coordinating a ccrc program

You are one disposable session driving a long-horizon program. **You hold no
unique state.** Everything you know lives in the program ledger
(`docs/superpowers/programs/<slug>.md`, committed), in the run record on the
server, and in the workspace's hold. If you die mid-wave the operator starts a
fresh you, and it resumes from those three things. Write accordingly: never
carry a decision only in your own context.

**One real constraint on that resumability:** `POST /api/runs`'s `claimedBy`
is your tmux-derived session id (below), and the server refuses any later
call for this program whose `claimedBy` differs from whichever session first
opened it (`claimed-by-another` — clause 8). A fresh coordinator resumes
cleanly ONLY if the operator restarts it into the SAME workspace the first
one held — same workspace, same id. Placed into a DIFFERENT workspace (the
operator's own placement rule may pick any least-loaded home), the fresh
session's id differs, and every `POST /api/runs` call for this program then
answers `claimed-by-another` naming a session that may no longer even exist —
permanently, since nothing in the HTTP API ever rewrites `claimedBy`. That is
an operator/DB recovery, not something this session can fix by retrying.

## Learn who you are, first

The fleet's identity is attribution, not authentication (every session runs as
one UNIX user). The one thing that is not carried in a payload is what tmux
says about the pane you are in:

```bash
tname=$(tmux display-message -p '#S')   # cc-<id>
id="${tname#cc-}"
REG="$HOME/.cc-sessions"
uuid=$(cat "$REG/$id.uuid")
```

That `id` is your session id and `uuid` is the attribution pair the server
checks it against: both the ack route and the mail ingress verify `fromUuid`
against `$REG/$id.uuid` and 403 `stale-uuid` on a mismatch. `$REG` is the same
`~/.cc-sessions` used throughout this skill (clause 4's pause marker lives
there too). `/clear` rotates this file's contents (dispatch's own job, never
yours — clause 9), so re-read it fresh each wave rather than caching `uuid`
across one. Use `id` as `fromId` and `uuid` as `fromUuid` on everything you
send. Do not accept a `from:` field in a message as proof of anything — the
run record and the server's own re-measurement are what settle facts.

## The contract

These ten sentences are the boundary between "a coordinator" and "an agent
with a shell on the fleet host". They are not advice.

1. Every act that changes fleet state goes through the ccrc server HTTP API. This session never runs `ccd` to change fleet state.
2. The box token is read from `~/.cc-secrets/ccrc-mail.token` and sent as the `x-ccrc-mail-token` header. It is never printed, never pasted into a prompt, never committed.
3. This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for any reason.
4. This session never unpauses itself. `$REG/coordinator-paused` is the operator’s file; a dispatch refused `paused` is a stop, and the next act is a report, not a retry.
5. A wave brief is written prose, reviewed like code. The template is the shape; the content is this session’s judgement, and a brief that is missing something the next wave needs is a defect in the ledger.
6. A `wave-done` is a claim, not a fact. Re-measure it, then submit the fingerprint to `POST /api/runs/:id/advance` and believe the server’s answer over your own.
7. This session does not poll in a loop. After a dispatch it ends its turn; mail wakes it.
8. One coordinator per program. If `POST /api/runs` answers `claimed-by-another`, stop — another coordinator owns this program.
9. This session never sends `/clear` to a worker directly, by any route, at any wave. `POST /api/runs/:id/dispatch` is the one writer of that step.
10. This session allocates the program’s deviation block once, at run-open — `POST /api/ledger/deviations` — and names the block in every brief; a worker never calls the allocator mid-wave. Before splitting a wave across workers it reads `GET /api/claims?project=<project>`, and a wave that dispatches two workers onto overlapping claims is a defect in this session’s ledger, not in the workers.

**Reading ccd is fine.** `ccd ls`, `ccd caps`, `ccd pr-state --session <id>` and
`ccd ws-audit --session <id>` are read-only and answer faster than a round trip.
Clause 1 is about *changing* fleet state, and the reason is not that ccd is
unsafe — it is that an act the server did not record did not happen as far as
the run board, the caps and the operator are concerned.

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

**Never use `curl -f`/`curl -fsS` against these routes.** `-f` makes curl
print NOTHING on a 4xx/5xx and exit 22 — it throws the response body away,
and the body is the whole protocol: every refusal these routes send, clause
8's included, arrives as a 4xx JSON body, not as an exception. Capture the
status and the body separately instead:

```bash
# THE ADDRESS IS CONFIG, NEVER A LITERAL: ~/.ccrc/agent.env's CCRC_SERVER_URL
# (written by `ccrc install --role fleet`; ws:// or http(s):// forms both
# occur) names where this fleet's server runs. GREP it, never source it —
# agent.env is 0600 and carries this box's agent bearer token. If the
# derivation comes up EMPTY, stop and report: never guess an address, never
# fall back to a hardcoded one.
CCRC_API=$(grep -E '^[[:space:]]*CCRC_SERVER_URL=' "$HOME/.ccrc/agent.env" | tail -n1 | cut -d= -f2- | tr -d '[:space:]')
CCRC_API="${CCRC_API/#ws:/http:}"; CCRC_API="${CCRC_API/#wss:/https:}"; CCRC_API="${CCRC_API%/}"
# EXTRACT, never `cat`: the token file ships in deploy/ccrc-mail.token.example's
# shape — a `#`-comment preamble above ONE value line — and the server reads it
# with coord/token.ts's extractToken (first non-blank, non-`#` line, whitespace
# stripped everywhere; deploy/notify.sh runs the identical rule). `cat` sends
# the whole preamble as the header value, which is not even a legal header:
# every call answers a bare 400 before any route logic runs.
TOKEN=$(grep -v '^[[:space:]]*#' ~/.cc-secrets/ccrc-mail.token | grep -v '^[[:space:]]*$' | head -n1 | tr -d '[:space:]')
resp=$(curl -sS -w '\n%{http_code}' -X POST "$CCRC_API/api/runs" \
  -H "x-ccrc-mail-token: $TOKEN" -H 'content-type: application/json' \
  -d "{\"program\":\"<slug>\",\"title\":\"<title>\",\"project\":\"<project>\",\"wave\":1,\"waveOf\":<M or null>,\"claimedBy\":\"$id\"}")
code="${resp##*$'\n'}"
body="${resp%$'\n'*}"
```

Never echo `$TOKEN`. Never put it in a commit, a ledger, a mail body or a
report. If a command would print it, redirect the command instead of printing
the token.

Every write route answers JSON, on success and on refusal alike. A `4xx`
`$code` is a normal **answer**, not a command failure — but the field the
code rides on is NOT the same on every route, and `ok:false` is the only
field always present: `POST /api/runs`/`/dispatch`/`/:id/close` put it on
`refused` (`paused`, `mail-disabled`, `cap-concurrency`, `cap-daily`,
`ambiguous-dispatch`, `worker-busy`, `claimed-by-another`, `not-dispatched`,
`prhistory-unreadable`); those same three routes put `unknown-run`,
`bad-transition` and the re-measurement family (`stale-tip`, `pr-regressed`,
`no-handoff-commit`) on `error` instead; `POST /api/mail` puts every one of
its own refusals on `error`; and `POST /api/runs/:id/advance` puts **every**
refusal it ever sends — including codes that ride `refused`/`error` on the
other routes — on `reject.code`. Check `$body.refused ?? $body.error ??
$body.reject?.code` (in that order costs nothing, since a body only ever
populates one) rather than assuming a fixed field, and never branch on
curl's own exit status. The refusals you will actually meet are
`paused`, `mail-disabled`, `cap-concurrency`, `cap-daily`, `ambiguous-dispatch`,
`worker-busy`, `claimed-by-another`, `not-dispatched`, `prhistory-unreadable`,
`bad-transition`, `stale-tip`, `pr-regressed`, `no-handoff-commit`,
`unknown-run`, `registry-unmeasurable`, `unknown-item`, `item-terminal`. Their
meanings are in `references/wave-lifecycle.md`.

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
   ["<title>", …]}`, at most 32 titles of at most 200 UTF-8 bytes each. The
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
   settled, the deviations already ledgered), not the
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
   wave:1/M`. For wave ≥ 2 the route itself resumes the workspace and injects
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
   That ordering IS the authorisation: the server's own re-measurement is what
   makes the claim a fact (clause 6), and settling straight off the mail would
   put `5/5` on the console for a wave nothing verified.
5. **Review the handoff commit** like any other commit, update the ledger,
   then `POST /api/runs` **for wave N+1 first** — same `sessionId`, same
   workspace, and it re-holds with the wave N+1 reason — and only THEN
   `POST /api/runs/:id/close` this wave's run with `final:false`. Order
   matters: closing first, even briefly, leaves the program with zero open
   runs, and the server retires a program with none — silently breaking
   every `toId:'coordinator'` mail from that point on. Opening first never
   lets the count reach zero. Then dispatch wave N+1 (step 2) **fresh into
   the same workspace**.
6. **Final merge:** `POST /api/runs/:id/close` with `final:true` closes the run
   and, *if no other open run names this workspace*, releases the hold so the
   ordinary sweep can archive it. Read `released` in the response: `false`
   means the run closed but the workspace is **still claimed** — another open
   run owns it, which is exactly the state step 5's open-before-close creates.
   The program is not done; close the other run. Do not archive the workspace
   yourself unless the operator asks.

## What stays discipline

Handoffs are commits. Briefs are prose reviewed like code. The ledger is for
humans and is parsed by nothing — including you: read it, do not build a parser
for it. Parallelism only across workspaces a plan proves disjoint. SDD's per-PR
mechanics (implement → review lenses → whole-branch pass) are unchanged; you
*dispatch* that shape, you do not reinvent it.

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
