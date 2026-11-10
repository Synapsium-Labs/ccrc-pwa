# The wave lifecycle: the ask lane and the approval lane

One part of the wave lifecycle. `wave-lifecycle.md` lists every part.

## The ask lane — pre-empting a child's question (Tasks 9-11)

Clause 11 is what licenses this: `"$API" asks answer`, which sends `POST /api/questions/:id/rule`
(id `ask-<n>`), is the one call that types into a child's pane, and this session never does it by
any other means. All three routes in the lane are named here — a coordinator IS a parent and
calls all three, so this is the truthful entry, not an invitation like the operator-only doors
above.
The client sends `asks answer` and `asks release` to the question door family's claimant pair,
`POST /api/questions/:id/rule` and `POST /api/questions/:id/release` (id `ask-<n>`), with the
row's kind added for you; the commands below do not change. A box whose server is older than the
family is refused by the client before anything is sent (`no-questions-door`): nothing was
answered, so say so to the operator rather than retrying.

**A cross-project coordinator receives its children's questions** (the operator's ruling of
2026-10-18, D-5530). A child's question is held for the recorded claimant of the child's run
wherever that claimant sits — no project is compared — so if you coordinate a programme whose
runs are in another project, its children's questions are mailed to you and are yours to
answer. The answer route admits exactly the session a row is held for: any other caller,
whatever its project, is `403 not-parent`. A question the server could not hold for anyone (a
run with no claimant, a run of another programme, or a parent it could not measure) goes to the
operator at once, is never mailed to you, and is not in your `asks list`; an answer to one is
refused (`not-held`, or `403 not-parent` when it was held for nobody). So does one whose run was
opened without your attribution (D-5531): a run opened with no claimant uuid before the fleet
carried `ccrc-api`, or before the attributed binding, holds nothing, wherever you sit.

```bash
: "${ask_id:?set ask_id to the held ask row positive decimal id}"
"$API" asks answer "$ask_id" --json - <<JSON
{"fromId":"$id","fromUuid":"$uuid","optionIndexes":[0]}
JSON
```

Press an answer in with that body. A LAPSE DOES NOT END YOUR TURN (late answer wins, D-5289):
when the grace window lapses, the operator's notification fires and the row moves to
`released`, but it stays answerable, by you or by the operator, until one of you acts. An
answer you press after the lapse still lands, and the operator's notification is replaced by
one saying you answered it. Only a ruling ends it: an answer from either principal, or your
own release (below).

A 409 from this route can come from six route/CAS guards before `answerAsk` (`not-held`,
`ask-moved`, `child-unmeasurable`, `declined`, `already-answered`, or `ask-mismatch`) or from
a downstream `answerAsk` refusal (D-5357, D-5368). No refusal path presses a digit when the eligible ask is
single-select, which is the only shape this hold lane mints; after a downstream refusal the
route puts the row back in the state it was taken from: `held`, or `released` if the window
had already lapsed.
- `not-held` — the row is in no state a principal can take it from, and no ruling is the
  reason. That is THREE different endings, not one: another principal is mid-answer, the
  child's dialog went away, or the row carries a state this build cannot read. Only the first
  is a race a retry could win, and you cannot tell which from this code alone — read the row
  (`GET /api/asks`, below) rather than retrying blind. A lapse is NOT one of them: a lapsed
  row is still answerable (above). (This entry said "a lost race against another principal
  that already took the row" for one wave, naming one of its endings: the gloss came from
  `store.ts`, where it was equally wrong, and both were corrected together. It then said
  `not-held` also covered a lapse and an answered row, until D-5289 made a lapsed row
  answerable and named the two rulings below apart.)
- `ask-mismatch` — your body carried an `askKey` (optional; the operator's route sends one)
  that is not this row's key (D-5368). The route refuses it before it takes the row: nothing
  is pressed and the row is unchanged. Re-read the ask (`GET /api/asks`, below) and answer
  the question it shows, or send no `askKey`.
- `declined` — YOU released this question yourself (`asks release`, below). A release is
  final: you handed the question to the operator, and your later answer is refused. Do not
  retry; the question is the operator's now.
- `already-answered` — a principal already ruled: you earlier, or the operator from their own
  phone, after the lapse or before it. Nothing is left to do; read the row (`GET /api/asks`)
  for who answered if your ledger needs it.
- `ask-moved` — the CHILD REPAINTED AN IDENTICAL QUESTION since this row was minted; the menu
  on its screen right now may be a different instance of what looks like the same question.
  This IS a reason to re-read the ask and answer the CURRENT one, never a reason to retry the
  same call — a blind retry risks pressing a digit into a menu that has since moved on.
- `child-unmeasurable` — the server could not read the child's live state at all (no session
  record, no measured identity, or no readable hookstate). Nothing has moved and nothing is
  wrong with your call: re-reading the ask will show you the same `held` row it showed before,
  so do NOT loop on it. Wait for the next tick, or leave it to the grace window, which fires
  the operator's own notification on schedule regardless.
- Downstream `answerAsk` refusals include `stale-ask`, `not-waiting`,
  `ask-mismatch`, `multi-question`, `range`, `multiselect`, `duplicate-index`,
  `not-alive`, `no-menu`, and `menu-mismatch`. Each names the failed live-state,
  option, or pane guard; stop and re-read rather than treating 409 as three
  possible conditions or retrying blind. Counting both halves, this route answers
  409 with 15 distinct codes (6 + 10, `ask-mismatch` in both halves).
```bash
: "${ask_id:?set ask_id to the held ask row positive decimal id}"
"$API" asks release "$ask_id" --json - <<JSON
{"fromId":"$id","fromUuid":"$uuid"}
JSON
```

Decline to rule on it with that body. A decline is not a failure: it is what turns the grace window
into a CEILING rather than a flat tax on every question you cannot answer — the operator's
notification fires AT ONCE on release, instead of the child's question sitting quiet until the
window lapses on its own. A release is FINAL: the row moves to `declined`, a terminal state,
and an answer you send for it afterwards is refused `declined` (D-5289) — releasing hands the
question over, it does not defer it. Only a `held` row can be released; a release of a row
that has already lapsed, or that a principal has taken or answered, is refused `not-held`.
Decline anything that would be a NEW decision (clause 11's own words — product intent, scope, a tradeoff nobody ruled on, anything irreversible) rather than
guessing at it.
```bash
"$API" asks list
```

Read your own children's HELD asks — the ones still waiting on a ruling — to see whether two of
them are asking contradictory things before either grace window lapses. The client hard-codes
`state=held`, which is NARROWER than the open set the route itself can return: an ask another
principal has already taken reads `answering`, and this view deliberately omits it, because a row
someone else is mid-answer on is not yours to rule on. The client derives this pane's parent id and
current uuid and sends both; neither is caller-selectable. `--parent <your id>` is accepted only
  as a matching compatibility assertion and cannot select another parent. The box token alone proves
  only "a process on this box", never WHICH parent is asking, so the derived uuid supplies the same
  attribution proof `/answer` and `/release` take above.

What the ask row does NOT carry is the reason to answer it. `question` and `options` are its
entire evidentiary surface — no rationale, no chat history, no transcript of the child's
reasoning is readable through any route in this tree. Rule only from what you can already read
elsewhere: the spec, the plan, the ledger, the branch, and your own prior rulings on this
program. If answering would require guessing rather than reading, decline it.

## The approval lane — a child's permission prompt (plan Task 16)

Clause 11 licenses this too. A child's permission prompt reaches you as mail (subject
`approval:<id>`), held for you as the recorded claimant of the child's run wherever you sit
(D-5530), with the command fenced as untrusted data, the server's class, the window's end in
UTC and the ready-to-run commands. Three routes are yours, each through the client:

- `POST /api/questions/:id/rule` (`"$API" approvals rule <id>`, id `approval-<n>` on the wire) —
  allow once (an `ordinary` row only) or deny, with a reason the child reads. The mailed command
  reads your reason through a quoted heredoc and builds the body with jq, so type the reason on
  its own line and nothing in it is run (D-5489).
- `POST /api/questions/:id/release` (`"$API" approvals release <id>`) — hand it over: the
  operator is notified at once, and it is final.
- `GET /api/approvals/:id` (`"$API" approvals show <id>`) — the row, redacted, for the claimant
  it was held for; anyone else is `403`.

The first two are the question door family's claimant pair, the same doors as the ask lane's;
the client adds the row's kind, and the mailed commands do not change. A box whose server is
older than the family is refused by the client before anything is sent (`no-questions-door`).

A ruling after the window is refused `hook-gone`: the child's hook has returned and the
operator has the prompt. Any other caller is `403 not-parent`, wherever it sits. The other
three routes of the lane are the child's hook's and the install's, never yours:
`POST /api/approvals` (the hook's request), `GET /api/approvals/:id/ruling` (the hook's wait,
by its nonce) and `GET /api/approvals/key` (the public key a fleet box pins).
