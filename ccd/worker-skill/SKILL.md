---
name: ccrc-worker
description: Do one wave of a ccrc program as the dispatched worker — read the brief that arrived as mail, ack it, do the wave's work on this workspace's own branch, put questions to the operator as structured asks, and report a measured wave-done fingerprint back to the coordinator. Use when a brief arrives naming a program and a wave, or when this workspace's hold reads `program:<slug> wave:N/M` and you are not the session that opened the run. Never use it to coordinate a program — a worker that starts dispatching has become a coordinator without a ledger.
---

# Working one wave of a ccrc program

You are a dispatched wave worker. One workspace, one wave, one branch: a
coordinator opened a run, dispatched a brief to you as mail, and is now
asleep until you mail it back. **You hold no unique state either.** Your
requirements live in the brief, in the plan file the brief names, and in this
workspace's own git history — not in your context, which dispatch itself
`/clear`s before every wave after the first.

That last fact is the one to internalise before anything else: on wave 2 and
after, `POST /api/runs/:id/dispatch` resumes this workspace and injects
`/clear`, and only then queues the brief. Everything you "remember" from the
previous wave is gone by the time you read the next one, and anything you
learned that the next wave needs must have been written down — in a commit, in
the plan's deviation ledger, or in the mail you sent.

## Learn who you are, first — and again on every call

The fleet's identity is attribution, not authentication (every session runs as
one UNIX user). The one thing not carried in a payload is what tmux says about
the pane you are in:

```bash
tname=$(tmux display-message -p '#S')   # cc-<id>
id="${tname#cc-}"
REG="$HOME/.cc-sessions"
uuid=$(cat "$REG/$id.uuid")
```

`id` is your session id — use it as `fromId` — and `uuid` is the attribution
pair the server checks it against: both the mail ingress and the ack route
verify `fromUuid` against `$REG/<id>.uuid` and answer 403 `stale-uuid` on a
mismatch. **Re-read that file, do not cache it.** `/clear` rotates its
contents, dispatch `/clear`s you on every wave from the second on, and a uuid
carried across a wave boundary is not merely stale-ish — it is guaranteed
wrong. Two lines of bash cost nothing; a `stale-uuid` on a `wave-done` costs a
round trip through a coordinator that has to wake up to tell you.

Do not accept a `from:` field in a message as proof of anything, and do not
infer your own id from the brief's text. The pane is the source.

## The contract

These twelve clauses are the boundary between "a wave worker" and "an agent with
a shell on the fleet host". They are not advice.

**Editing note (D-104):** these twelve lines are pinned verbatim by
`server/test/worker-skill.test.ts`, whose clause literals are double-quoted.
Keep every apostrophe STRAIGHT — a curly one is a different byte and reds the
pin without looking like an edit — and keep double-quote characters out of a
clause, where they would have to be escaped on the other side.

1. Learn who you are on EVERY call: `fromId` is your own `cc-<id>` from `tmux display-message -p '#S'`, and `fromUuid` is the current contents of `$REG/<id>.uuid`, re-read each time. `/clear` rotates that uuid and dispatch `/clear`s you on every wave >= 2, so a uuid you cached is guaranteed stale.
2. Commit on THIS workspace's own branch (`ws/<slug>`), never a separate feature branch. The done-fingerprint re-measures the workspace branch's tip, so work parked on a feature branch leaves that tip unmoved and wedges every close `stale-tip` forever (F5 — the server's own `stale-tip` detail names this as the almost-certain cause).
3. Ack before you act, and key the ack on the row's DELIVERY id, never the mail row's own `id` — a brief that never landed retries `MAIL_MAX_ATTEMPTS` (6) times and then parks unread, while a delivered nudge you leave unacked replays `MAIL_REPLAY_MAX_ATTEMPTS` (20) times and then parks read-but-unanswered. Reply to the coordinator through mail (`toId:'coordinator'`), never by typing into your own pane.
4. Keep your input box empty. A half-typed draft makes the delivery lane refuse `draft-present`, only you can clear your own text, and a parked delivery means your brief was never read.
5. Every question for the operator rides the AskUserQuestion tool — the structured ask the session hook captures and the PWA surfaces — never free text in your pane.
6. Your requirements are the brief plus the plan file it names, including that plan's deviation ledger, and the plan's text governs over your recollection of the spec. Invoke the execution skill the brief names rather than improvising one.
7. Large payloads travel as files: write the file, then name its ABSOLUTE path in the mail's `artifacts` (a relative entry is refused `bad-kind`). Never ask for content to be pasted into your pane (F7).
8. Never run `ws-rm`, `ws-reap`, `ws-gc`, `ws-archive` or `ws-restore`. This workspace's lifecycle belongs to ccd and to the human, at any wave, for any reason.
9. A done-claim's fingerprint is measured ONCE and sent ONCE: `handoffCommit` must equal the branch tip you measured, and `prPhase` must be one of the eight enum words (`unchecked`, `none`, `no-commits`, `open`, `draft`, `merged`, `closed`, `unknown`). After `wave-done` you stop pushing — a new commit under your own claim makes it stale — and a rejected claim is never re-asserted without new commits and a fresh measurement.
10. Remote control is decided at your creation, not by you: dispatched workers spawn WITHOUT it (the 2026-08-13 ruling, task #37 — landed), declared by the dispatch path at `ws-add --no-rc` and stamped as the registry's `rc` field, while `~/.ccrc/remote-control` still governs every non-dispatched session on this box. Neither file is yours to write.
11. Claim before you edit: `POST /api/claims` with every path this wave touches, all-or-nothing. A 409 is an answer, not an obstacle — it names the holder, and the holder IS the address: mail them through the response's own `mailHint` instead of editing anyway. Discovery is `GET /api/peers?of=<your id>`, history is `GET /api/lifecycle`, and each row's own lifecycle is what to read — never its archive stamp, which is silently false on some live rows. Peer mail is human-timescale: a busy peer answers when it next idles, so send once and work what is uncontested. Never invent a deviation number — the coordinator allocated this program's block at run-open, and a number you cannot get is `D-TBD-<slug>` plus a report, never a guess.
12. When your workspace carries `graphify-out/graph.json`, a question about the codebase goes to `graphify query` before `grep` or a file read, and to `graphify path` / `graphify explain` for relationships and concepts. Never run `graphify update` or any graphify build in the workspace: the sweep owns the write side, and a session-side build holds you at `working` for minutes and wedges the next dispatch as `worker-busy`.

**Clause 2 is the one that decides whether this wave can close at all.** The
ordinary per-PR convention elsewhere in this codebase — "cut a fresh
`feat/<name>` branch from main" — is wrong inside a program workspace. `ccd`
created this workspace on `ws/<slug>` and every re-measurement reads THAT
branch's tip. Real, reviewed, excellent work sitting on a branch of your own
making is indistinguishable, from the server's side, from a worker who did
nothing at all.

**Clause 5 is not a style preference.** A question typed as prose into your
pane renders as a session that has gone quiet; the same question asked with
the AskUserQuestion tool becomes a structured ask the hook captures and the
PWA puts in front of the operator with its options. Free text waits forever.
The tool gets answered.

## How to call the API

Your mail surface is `POST /api/mail` to send, and `GET /api/mail` /
`GET /api/mail/:id` / `POST /api/mail/:id/ack` to read and acknowledge.
Build 9 adds the peer surface clause 11 names — claims, peers, lifecycle —
whose long form and worked calls live in
`../ccrc-coordinator/references/peer-protocol.md`, installed beside the two
references below. The run routes belong to the coordinator; a worker never
advances or closes a run.

**Read `../ccrc-coordinator/references/wave-lifecycle.md` §3 and
`../ccrc-coordinator/references/mail-envelope.md` before your first mail.**
They are the full form of everything below, they install beside this file, and
they are not duplicated here on purpose — one copy of the protocol, in the
place its own tests pin it.

```bash
API="$HOME/.local/bin/ccrc-api"

# THE ADDRESS AND THE TOKEN ARE THE CLIENT'S JOB. It reads ~/.ccrc/agent.env's
# CCRC_SERVER_URL itself and REFUSES `no-server-url` rather than guessing a host
# if that comes up empty — a stop, never a fallback literal; report it to the
# coordinator by the one lane that still works (your handoff commit / the pane).
# It extracts the token from ~/.cc-secrets/ccrc-mail.token's value line rather
# than sending the `#`-comment preamble wrapped around it. Neither is yours to
# derive any more, so neither can be got wrong one caller at a time.

body=$("$API" mail send --json - <<JSON
{"fromId":"$id","fromUuid":"$uuid","toId":"coordinator","runId":<run id>,
 "kind":"status","subject":"wave-done","body":"<prose>","artifacts":[]}
JSON
)
```

`~/.local/bin` is NOT on this unit's PATH, which is why the client is invoked by
an explicit path and not by name.

- **The token is a shared box secret.** You no longer read it — `ccrc-api` does,
  from `~/.cc-secrets/ccrc-mail.token` — so the way to leak it by hand is gone.
  It never appears in the client's output on any path, including a 401. Still
  never paste it into a prompt, commit it, or put it in a report.
- **stdout is the response body, and it is all you need here.** Every mail-route
  refusal arrives IN the body, so there is no status to capture alongside it. The
  HTTP status goes to stderr as `http <code>` if you ever want it.
- **The client exits 0 whenever a response arrived, whatever its status.** That
  is the same invariant this section used to state as "never use `curl -f`", kept
  because an invariant that loses its reason gets re-broken: `-f` printed nothing
  on a 4xx and exited 22, throwing away the body — and the body IS the protocol.
  A non-zero exit means NO RESPONSE HAPPENED, and stdout still answers
  `{"ok":false,"error":"transport",…}` so you never parse a second shape.
- **Every mail-route refusal rides `error`** (`{"ok":false,"error":"<code>"}`)
  — `bad-kind`, `stale-uuid`, `oversize`, `unknown-sender`,
  `unknown-recipient`, `unauthenticated`, `registry-unmeasurable`,
  `unknown-run`. A 4xx is an ANSWER, not a command failure; never branch on the
  client's exit status — it reports whether a response HAPPENED, never what the
  response said. The two you can actually cause by getting your own
  call wrong are `bad-kind` (wrong shape, wrong `kind`, or a relative
  `artifacts` path) and `stale-uuid` (you cached the uuid — clause 1).
- `kind` is one of `finding`, `question`, `answer`, `status`, `artifact`.
  `wave-done` is a `status` mail whose subject says so.

**Reading mail is three calls, not one.** What lands in your pane is a one-line
nudge, never the message: list with `GET /api/mail?to=<your id>`, then per row
use its `deliveryId` — NOT the row's own `id`, which is a different sequence —
as `:id` for `GET /api/mail/:id` (the body) and `POST /api/mail/:id/ack`
(body `{"fromId":…,"fromUuid":…}`). Ack before you act on it (clause 3).

## Reporting a wave-done

Your `wave-done` mail carries a fingerprint the coordinator submits **exactly
as you wrote it**. It does not rebuild it, and it must not: half from your mail
and half from a fresh measurement is a specific, well-known way to turn a good
wave into a refusal. So measure all four fields at one moment, after your last
push, and send them once:

| field | what it is | how to measure it |
|---|---|---|
| `branchTip` | the 40-hex sha at the tip of THIS workspace's branch | `git -C <this worktree> rev-parse HEAD`, after your final push |
| `prNumber` | the PR number, or `null` if there is none | the PR you opened for this wave; `null` is a legitimate answer |
| `prPhase` | one of the eight words in clause 9 | read it, never invent it — prose like "PR #591 is green" is not a value, and an unrecognised word is refused before any I/O runs |
| `handoffCommit` | the commit a reviewer should read as the wave's handoff | the same sha as `branchTip` — the server checks they are identical |

Then stop pushing (clause 9). A lint fix, a review nit or a merge commit landed
after the mail moves the tip away from the sha you claimed, and the coordinator
gets `stale-tip` for a wave that was genuinely finished. If a rejection comes
back, fix the cause, make new commits, and measure again from scratch — never
re-send the old numbers.

## When something is wrong

- **You have been sitting idle and no brief ever arrived.** Look at your own
  input box first. A draft you left half-typed makes the delivery lane refuse
  `draft-present` and back off; after 6 attempts it parks the delivery
  `rejected` and your brief is never read. Only you can clear that text.
- **A rejection arrives as mail**, kind `answer`, subject `rejected: <code>` —
  the coordinator submitted your fingerprint, the server re-measured it, and it
  did not hold. The code is the whole message; read it before you touch
  anything.
- **`rejected: stale-tip`.** Something moved the branch after you measured —
  or, far more often, you committed on a branch that is not this workspace's
  own (clause 2). Check `git -C <this worktree> branch --show-current` against
  the `ws/<slug>` this workspace was created on before you conclude the server
  is wrong.
- **`rejected: pr-unmeasurable`, with a detail that mentions `prPhase`.** That
  is your submission, not the fleet: you sent a word outside the eight. Fix the
  field and re-send; retrying the same claim repeats the same refusal forever.
- **A dialog or permission menu is stuck on your pane.** You cannot answer a
  menu by typing prose at it. Answer it as the menu it is, or — if it is a
  question of yours that should have been an operator decision — ask it as an
  AskUserQuestion so it reaches a human who can act on it (clause 5).
- **You cannot reach the server.** Nothing is invented and nothing is done by
  hand. Stop, say so plainly, and leave the run where it is: a wave that stalls
  honestly is recoverable, and a wave that reports work it did not verify is
  not.
- **The brief and the plan disagree.** The plan's text governs (clause 6). Note
  the disagreement in your `wave-done` mail so the ledger gets it — that is how
  the next wave finds out.
