# The wave lifecycle: step 4, advance the run, and 4b, settle the work items

One part of the wave lifecycle. `wave-lifecycle.md` lists every part.

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

**The shape a `wave-done` mail carries it in.** The fingerprint is the
worker's to measure and yours to submit unchanged, so it travels as JSON in
the mail body rather than as prose you would have to re-type by eye. One
correct wave-done body, minimal — both shas below are PLACEHOLDERS, and a real
claim repeats one and the same 40-hex sha in both fields:

```json
{"branchTip":"<40-hex sha>","prNumber":591,"prPhase":"open",
 "handoffCommit":"<the same 40-hex sha>"}
```

Prose around that object is fine and often useful. Prose INSTEAD of it is what
produces `pr-unmeasurable` below: "PR #591 is green" is not a `prPhase`, and
inventing one out of a sentence is the single commonest way a finished wave is
refused.

**Two signal lines open the body** (routing spec §5.5; worker clause 15), before any prose and
before the JSON — the first two lines, in either order, grammar exactly `key: word` with one space:
`suite: green|red|unrun` (the whole suite on its FIRST full run after the wave's implementation
was complete — red stays red however many fix rounds followed; unrun when no full run happened)
and, only when a check failed, `failure: shallow|ceiling|unclear` (shallow: tests missed, a plan
half-followed — raise effort; ceiling: an ambiguity the worker could not resolve, a design flaw,
a debug that survived two attempts — raise class; unclear: effort-first). A complete body:

```
suite: red
failure: ceiling
{"branchTip":"<40-hex sha>","prNumber":591,"prPhase":"open","handoffCommit":"<the same 40-hex sha>"}
```

The server reads them from the mail row, never from the envelope: `GET /api/runs/:id/signals`
answers `signals.suite` and `signals.failure`, each one of THREE answers — a value, `absent`
(the line was not sent: an older worker, or nothing to say), or `unrecognised` (a line was sent
with a word outside the vocabulary — a defect in the worker's report, surfaced, never read as
silence). They are what spec §6's first-run quality signal and clause 13's next-wave routing
decision read; a wave-done that omits the suite line is accepted by the fingerprint route all the
same, and shows as `absent`.

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
  the worker reported it** (the one exception is the recorded head in §5:
  while the same wave-done is still being answered after an advance answered
  `verifiedHead`, the later advances and the close submit that `verifiedHead`
  as both tips) — never rebuild it by pairing a freshly re-measured
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
| `tip-unmeasurable` | the branch tip could not be re-read (not evidence either way). On a REVIEW run's close it can also mean the reviewed run itself cannot be measured (it names no run, is gone, or has no session); the answer there is `{"state":"failed"}` on the review run, not a re-submit. |
| `branch-unmeasurable` | the workspace's branch could not be resolved: the live registry has a row for this session and the row's own branch field is null — either listed with bytes that did not come back (transient) or absent (not). Not evidence either way; the run is unchanged. Re-submit once the registry reads clean. If it keeps answering this, the session's registry row needs a human — the run row's frozen branch column is deliberately not used as a guess |
| `pr-regressed` | the PR is not in the phase the claim asserted |
| `pr-unmeasurable` | the PR state could not be re-read (not evidence either way) — but see below: this is ALSO what a malformed submission of your own gets, before any I/O runs |
| `no-handoff-commit` | `handoffCommit` and `branchTip`, IN THIS CLAIM, are not the identical 40-hex sha (or either fails the sha shape) — a correspondence check ONLY ("the worker's two facts agree, and the tip is real"), never a claim that the commit's *content* is a real handoff (that stays the review run's job, §5 step 1). It fires on a perfectly good wave if you submit a freshly re-measured `branchTip` alongside the mail's ORIGINAL `handoffCommit`: any review fix, lint fix or merge commit pushed to the branch after `wave-done` moves the tip away from what the worker claimed, and mixing the two sources here reports that ordinary shape as this code instead of the accurate `stale-tip` |
| `unknown-run` | the run id is wrong |
| `not-dispatched` | this run has no worker session to re-measure against |
| `bad-transition` | `to` is not reachable from the run's current state |
| `review-in-flight` | a non-terminal review run already names this work run — on an OPEN, a second reviewer for one wave; on an ADVANCE to `working`, a send-back while its review is still open. Close the review run first (body `{"state":"failed"}` if it died — no fingerprint needed), then retry. |
| `cap-review-rounds` | on an OPEN of a review run: the work run already has three review runs, in any state. The server raised one ask to the operator carrying the run, its round count and the last review's open findings (the refusal body carries the same under `ask`). Do not retry the open and do not look for another way to start a review. Decide first whether another round is truly needed (Extending a reached review cap, below): if so, extend the cap with `"$API" runs review-rounds`, and a further open then succeeds; if not, rule on the findings you already hold, or wait. |
| `ejection-not-merging` | on an ADVANCE to `working` whose body carries `ejection`, from a run not at `merging`: an ejection rides only the `merging → working` edge, so a run at `dispatched` or `awaiting-review` answers this code, while the edge gate's `bad-transition` (a run at `working`, among others), a review in flight and, from `awaiting-review`, the dispatch cap answer first, each with its own code. The server recorded nothing: the run and its landing entry are unchanged. Do not retry with the body and send no `fix-round` mail; re-read the run, and a run no longer at `merging` gets no ejection: report it to the operator (SKILL.md step 6). |
| `stale-review` | the reviewed branch's live tip is not the `reviewedTip` the report describes — the worker pushed after wave-done, or the report is about an older tip. Do not rule on it: close the review run with body `{"state":"failed"}` (no fingerprint needed), mail the worker the code and detail verbatim, and open a fresh review run against the live tip once its re-measured wave-done arrives. (A malformed `reviewedTip` reaching the verifier directly also answers this code, but the close route refuses that shape as `bad-request` first.) |
| `report-unreadable` | the report path the reviewer named cannot be opened — absent or unreadable. Close the review run with body `{"state":"failed"}` (no fingerprint needed) and open a new one; the reviewer's clause 7 says the report is written by temp-then-rename, so a half-written file is never the cause. |
| `lineage-unmeasured` | in a project the operator opted in to the radar's lineage, the live tip is not the claim and the radar has not yet measured the clean merges between them. It is a wait, not a refusal: the server has already mailed the claim's sender, which re-sends the same claim unchanged after the radar's next tick, at most twice. Re-sending means repeating the call that answered it, the same advance or the same close, so a re-sent `wave-done` that reaches you with the run already at `awaiting-review` is not a fresh wave-done and needs no new review run. The advance and the work close mail the worker, and the review close mails the reviewer. You send no `rejected:` mail for it, and you act only when the sender reports it. `detail` says why (`not-yet-measured`, `lineage-stale`, `older-than-the-live-tip` and the like). |

**Extending a reached review cap.** A cap is three review rounds. Decide as soon as the third round's report lands, before you open a fourth: an extension at the cap means the open is never refused, so no ask is raised and the operator is not pushed. If the open answers `cap-review-rounds` anyway, do not retry it: the operator has already been asked, so decide at once whether another round is truly needed.

Extend only when all of these hold:

- the last review left real, unresolved MAJOR findings (not minors, style or taste);
- the last round made measurable progress (fewer or narrower majors than the round before, so the work converges);
- the next round has a named scope (the findings it must close).

Stop instead when any of these holds:

- the open findings are minors or style;
- the last two rounds churned on the same findings with no progress;
- the open finding is a known limit or needs the operator's ruling (raise a `decide` item instead);
- the work is past the operator's review-round cutoff, 2 rounds, 3 for security work, unless you judge that this work must go on and say why in the reason.

To extend, run `"$API" runs review-rounds <work run id> --json -` (`POST /api/runs/:id/review-rounds`) with `{"reason":"<one line: which majors are open and real, and why they converge>"}`, the reason 16 to 300 characters. Do not put `byId` or `byUuid` in the body: the client fills them from your own pane and refuses a body that names either (`bad-body`). It allows three more rounds; at the next cap decide again. Every extension is recorded on the run and shown to the operator, and it closes the operator's ask for that cap.

Refusals:

- `no-review-rounds-door`, or a 404: an older server. In both cases the cap is the operator's: rule on the findings you hold, or wait.
- `cap-not-reached`: the cap is not reached, or the operator already lifted it; open the review.
- `not-your-programme`: you do not claim this run's programme; do not retry.

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

**Except `lineage-unmeasured`.** The server has already mailed that answer to whoever sent the claim, under its own
subject (`wave-done-unmeasured`, `wave-advance-unmeasured` or `review-done-unmeasured`), so send no
`rejected: lineage-unmeasured` mail. The sender re-sends the same claim after the radar's next tick, at most twice, and
you act only when it reports the answer.

**Put `reject.detail` in that mail's body, verbatim.** The code alone is not
always the whole message: `pr-unmeasurable` above means two different things —
"your `prPhase` is not one of the eight words" and "the fleet could not read
the PR" — and `detail` is the ONLY thing that separates them. The worker's own
skill tells it to read that detail and act on which one it is, so a rejection
that arrives with the code and nothing else asks a worker to guess between a
fix-and-resend and a wait-and-retry. Copy it as the server sent it; do not
paraphrase it into your own words.

**When a check failed, the failure kind names the rung** (spec §3):

```bash
printf '{"target":"worker","kind":"<shallow|ceiling|unclear>","why":"<one sentence>"}' | "$API" runs route "$run_id" --json -
```

— the server computes the rung from the ladders on the session's record, writes it through the
routing verb with no `--apply` (ccd applies it at the next settle or idle tick), and records a run
event; `ceiling`/`floor`/`no-record` (409) are answers, not errors — record them in the ledger and
decide by hand with `{"target":"worker","field":"<field>","value":"<value>","why":"…"}`.
**Demotion** is your judgement (§3): after three consecutive clean waves of one shape on one
session, `{"target":"worker","demote":"effort","why":"…"}`; any later failed check reverses it
before the ladder applies. Never `ccd route` (clause 1) and never `--apply` (clause 12's evidence
rule and spec §8 row 5). Every call that CHANGES a record is one run event and one journal row;
a refusal — the ladder's answers included — records neither.

**The reversal follows the SESSION, across every wave.** The door derives "the last unreversed
demotion" — and the same-kind count that gates `max` — by walking every run that names the target
session, worker or coordinator, in the order each `route:` event landed: a demotion taken on wave
N's run IS reversed by a failed check you report against wave N+1's run, on the same session, and
the same-kind count carries forward with it rather than restarting at zero. (D-2957, the run-scoped
rule this paragraph used to state, is CLOSED by routing slice 6 — the `route:` event now names its
own session, so the door can walk the session's whole trail instead of one run's rows.) Nothing
here changes what you send: report the failure against the CURRENT wave's run id as always, and
the door reads the session's history for you — there is no by-hand carry left to do.

**A class rung is two fields in one write.** An escalation or demotion that moves `class` resets
effort in the SAME call (spec §3 — effort names do not transfer across classes): to `high`, or to
`auto` onto haiku, which takes no effort level at all. The answer's `applied.effortReset` names
the value that went with it, and is `null` when the call wrote a single field — an effort rung, or
a manual `field`/`value` write, which this door forwards exactly as you typed it.

### 4b — Settle the work items, AFTER the advance answers `ok`

`GET /api/runs/:id/items` / `POST /api/runs/:id/items`
`{"items":[{"id":<item id>,"state":"done","claimedBy":"<worker id>"}, …]}`
→ `{"ok":true,"id":<run id>,"items":{"done":<n>,"total":<n>}}` — the fresh
tally, which is what the board renders.

**Order is the authorisation.** Send this only once `POST /api/runs/:id/advance`
has answered `ok` for the same claim. That answer is the server's own
re-measurement, and it is the moment ccrc is allowed to believe a worker
(contract clause 6). Settling never off the worker's claim alone: a tally that
flips to `5/5` because a mail said so is a lie on the console, and the console
is the product. Nothing re-measures here — this route performs no fleet act at
all — precisely because the re-measurement already happened one call earlier.

`state` is one of `pending` / `claimed` / `done` / `failed` / `abandoned`.
`unknown` is a READ-side value the board uses for a token it does not
recognise; a writer may not name it (400 `bad-request`). `claimedBy` is
optional and defaults to `null`. Item ids come from the run row's own ledger —
`GET /api/runs` carries the tally, and the ids are the ones the dispatch
declared, in body order.

A batch is **all-or-nothing**, inside one transaction: a body naming one bad
id settles NOTHING, and the earlier ids in the same body are untouched.
Partial success on a ledger write is how tallies drift.

| shape | meaning | what you do |
|---|---|---|
| `refused:'unknown-item'` (404), with `itemId` | that id is not THIS run's item (another run's, or none) | **stop and report** — do not retry with a guessed id. Re-read the run's ledger first |
| `refused:'item-terminal'` (409), with `itemId` and `state` | the item already settled (`done`/`failed`/`abandoned` are terminal) and the write was refused, not silently applied | **stop and report** — a tally that moved backwards is a lie on the console. If the item genuinely needs a different outcome, that is an operator decision, not a retry |
| `error:'unknown-run'` (404) | the run id is wrong or the DB was rebuilt | re-read `GET /api/runs` |
| `error:'bad-request'` (400) | shape: no `items` array, an empty one, a non-integer id, a `state` outside the vocabulary, or past 32 entries | fix the body; nothing was written |
