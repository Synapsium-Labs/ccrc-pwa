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

## Learn who you are, first

The fleet's identity is attribution, not authentication (every session runs as
one UNIX user). The one thing that is not carried in a payload is what tmux
says about the pane you are in:

```bash
tname=$(tmux display-message -p '#S')   # cc-<id>
id="${tname#cc-}"
```

That `id` is your session id. Use it as `fromId` on everything you send. Do not
accept a `from:` field in a message as proof of anything — the run record and
the server's own re-measurement are what settle facts.

## The contract

These eight sentences are the boundary between "a coordinator" and "an agent
with a shell on the fleet host". They are not advice.

1. Every act that changes fleet state goes through the ccrc server HTTP API. This session never runs `ccd` to change fleet state.
2. The box token is read from `~/.cc-secrets/ccrc-mail.token` and sent as the `x-ccrc-mail-token` header. It is never printed, never pasted into a prompt, never committed.
3. This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for any reason.
4. This session never unpauses itself. `$REG/coordinator-paused` is the operator’s file; a dispatch refused `paused` is a stop, and the next act is a report, not a retry.
5. A wave brief is written prose, reviewed like code. The template is the shape; the content is this session’s judgement, and a brief that is missing something the next wave needs is a defect in the ledger.
6. A `wave-done` is a claim, not a fact. Re-measure it, then submit the fingerprint to `POST /api/runs/:id/advance` and believe the server’s answer over your own.
7. This session does not poll in a loop. After a dispatch it ends its turn; mail wakes it.
8. One coordinator per program. If `POST /api/runs` answers `claimed`, stop — another coordinator owns this program.

**Reading ccd is fine.** `ccd ls`, `ccd caps`, `ccd pr-state --session <id>` and
`ccd ws-audit --session <id>` are read-only and answer faster than a round trip.
Clause 1 is about *changing* fleet state, and the reason is not that ccd is
unsafe — it is that an act the server did not record did not happen as far as
the run board, the caps and the operator are concerned.

**`/clear` is dispatch's job, never yours.** For wave ≥ 2, `POST
/api/runs/:id/dispatch` itself resumes the workspace and injects `/clear`
before it queues the brief — that is what `resumed`/`clearedAt` on the
response record. This session never sends `/clear` to a worker directly, by
any route, at any wave: one writer per step, and the dispatch route is the
chokepoint (clause 1's "never runs `ccd` to change fleet state" already
forbids the raw form; this is the same rule stated against the mail route
too, since a `/clear` mailed as a message would be no less a second writer).

## How to call the API

```bash
TOKEN=$(cat ~/.cc-secrets/ccrc-mail.token)
curl -fsS -X POST "http://203.0.113.7:7788/api/runs" \
  -H "x-ccrc-mail-token: $TOKEN" -H 'content-type: application/json' \
  -d "{\"program\":\"<slug>\",\"title\":\"<title>\",\"project\":\"<project>\",\"wave\":1,\"waveOf\":<M or null>,\"claimedBy\":\"$id\"}"
```

Never echo `$TOKEN`. Never put it in a commit, a ledger, a mail body or a
report. If a command would print it, redirect the command instead of printing
the token.

Every write route answers JSON. A refusal is an **answer**, not an error: read
the refusal field and act on it. The refusals you will actually meet are
`paused`, `mail-disabled`, `cap-concurrency`, `cap-daily`, `ambiguous-dispatch`,
`worker-busy`, `claimed-by-another`, `not-dispatched`, `prhistory-unreadable`,
`bad-transition`, `stale-tip`, `pr-regressed`, `no-handoff-commit`,
`unknown-run`. Their meanings are in `references/wave-lifecycle.md`.

## The wave lifecycle

Six steps, and they are Build 2.5's manual six with the manual taken out. The
full form — every call, every refusal, what to do with each — is
`references/wave-lifecycle.md`. Read it before the first dispatch of a program,
not after.

1. **Open the run.** Write the ledger from `references/ledger-template.md`,
   commit it, then `POST /api/runs`. The server places the hold whose reason is
   `program:<slug> wave:1/M`.
2. **Dispatch.** `POST /api/runs/:id/dispatch` with the wave brief. For
   wave ≥ 2 the route itself resumes the workspace and injects `/clear` before
   queuing the brief — this session never sends `/clear` itself. Then **end
   your turn** (clause 7).
3. **Wake on mail.** A worker's message arrives injected in the envelope shape
   in `references/mail-envelope.md`. Ack it (`POST /api/mail/:id/ack`) before
   acting on it, or the delivery lane replays it verbatim.
4. **Re-measure a claimed `wave-done`**, then `POST /api/runs/:id/advance` with
   the fingerprint. A typed rejection means the claim was stale: mail the worker
   the rejection code and leave the run where it is.
5. **Review the handoff commit** like any other commit, update the ledger, and
   `POST /api/runs/:id/close` with `final:false` — it re-holds the same
   workspace with the wave N+1 reason for you. Then `POST /api/runs` and
   dispatch wave N+1 **fresh into the same workspace**.
6. **Final merge:** `POST /api/runs/:id/close` with `final:true` releases the
   hold and lets the ordinary sweep archive the workspace. Do not archive it
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
