# The steps of a wave

Part of the `ccrc-coordinator` skill, whose `SKILL.md` holds the contract.

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
   The dispatch may also carry `intents`, the landing intents of the wave
   (`references/wave-lifecycle.md` §2).
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
   reviewer died), then retry. When a review round's report lands and the
   work run has had its three review rounds, decide BEFORE opening the next:
   by the rules in `references/wave-lifecycle.md` (Extending a reached review
   cap), extend with `"$API" runs review-rounds <work run id> --json -` and a
   one-line reason, or rule on the findings you hold, or wait. Extending first
   means the open is never refused, so the operator is never asked or pushed.
   `cap-review-rounds` on an open means you opened without deciding: do not retry
   the open. The server has told the operator (one ask, with the last review's
   open findings); a late extension still closes that ask, but the operator has
   already been pushed once, so decide at the cap, not at the refusal. A bare `400 bad-request` with no `detail` on
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
   with `{"state":"failed"}` and open a new one. `lineage-unmeasured` on a review close is never a failed review run:
   the server has already mailed the reviewer, who re-sends its unchanged `review-done` after the radar's next tick,
   so close nothing, open nothing and send no `rejected:` mail until it does. In a project the brief names as opted in
   to the radar's lineage, `stale-review` means a push the lineage could not prove clean; everywhere else it means
   what it means today. A report whose first line is `TIP MOVED` is never ruled on, even when its close was accepted.
   Open a fresh review run against the live tip instead, and the review run that was closed counts as a round.
   Once the close answers `ok`, read the
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
     **A fix round with no report behind it** comes from `merging`, and the
     cause you measured decides which of two forms it takes. **An ejection** is
     sent in two cases only: the new-head route for a red that is `main`'s own
     (`references/wave-lifecycle.md` §5b), and a dequeue (§5) whose cause is a
     conflict you measured: after one `git fetch origin`, `git merge-tree
     --write-tree --name-only --no-messages origin/main <handoffCommit>` exits 1
     with a tree id on its first line, then the conflicted paths. Its body holds
     three entries, one to a line, and nothing else: `ejected: new-head:#<pr>`
     or `ejected: dequeued:#<pr>`, then `base: <sha>`, the `origin/main` sha you
     read after one `git fetch origin`, then `checks: <required names that are
     red>` for the new-head route or `paths: <the conflicted paths>` for the
     dequeue. Every ejection is clause 15's ejection, its base recorded on the
     landing line by the advance that sends the run back: first read the line,
     `GET /api/landing?project=<project>` (`ccrc-api landing show --project
     <project>`), and send an ejection only where this PR's entry for this run
     reads `pinned`; with no such entry the round is no ejection, and it stays
     a stop for the operator. **A red the PR owns** is sent when the queue
     dequeued the PR for a required check and no conflict was measured, or when
     the verdict's `RED` line names a required check red on the head that is the
     PR's own. Its body holds two entries, one to a line, and nothing else:
     `red: #<pr>`, then `checks: <required names that are red>`. It has no
     `base:` entry and licenses no absorb: the worker absorbs only on its own
     clause 16's first two triggers. A dequeue with any other cause, a
     requested change or a cause you could not read among them, is no
     report-less round: it stays a stop for the operator. For either form, on
     route Q disarm first (§5), then make the same advance to `working`, on the
     `merging → working` edge, and send the same `fix-round` mail with no
     `artifacts`. Every `ejected:` round's advance carries `ejection`, an
     object of two fields: `base`, the sha on the mail's `base:` line, and
     `kind`, `new-head` or `dequeued` as the mail's first line names it; a
     `red:` round's advance, and any other retreat, carries none. Send the
     `ejected:` mail once the advance's answer reads `landing.kind` `ejected`
     and `landing.entry.baseSha` equals the base you sent. If it reads
     anything else, the line recorded no
     base: send no mail, and report it to the operator with the run's state
     as the advance answered it: `working` after `ok`; after a refusal, the
     state the answer names (its `from`), which is still `merging` only when
     the refusal came before any move; and when the answer names no state or
     was uncertain (the 503 `run-unreadable`, an `unknown-run` after the
     commit, a transport failure), read `runs list` for the run's state
     before reporting. The second ejection of one entry is not refused: where
     the entry you read counts one ejection already, the advance still answers
     `ok` and the server raises one notice to the operator, so name the second
     ejection in your turn's text and send the round as usual. The worker's
     answering wave-done gets a NEW review run (step 5), whose brief names that
     round's commits as the change under review, for the new-head round its
     merge commit; the reviewer still reads the whole diff (reviewer clause 5),
     and a merge of `main` is reviewed like any other change.
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
     once wave N's PR is proven merged — MERGED at its verified head, or
     CLOSED there with `landedInTrain: true` on its row of
     `ccd pr-state --session <id>` — exactly as §5's "One PR per child"
     requires. An UNMARKED producer — every workspace minted without a
     marker: by a box whose ccd did not yet mark children, or by a
     dispatch that journaled `child-omitted` — is never refused this way;
     dropping its `sessionId` anyway is still safe and follows the same
     one-PR rule. The same-project arm is for a producer whose workspace
     opened no PR. On a native-queue project the producer LANDS before it
     closes (clause 15; `references/wave-lifecycle.md` §5,
     "Landing on a native-queue project"). Every producer lands by the route
     the landing verdict reads from the rules of its repository
     (`references/wave-lifecycle.md` §5b), on every project, before each
     landing.
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
     producer contract (it reads MERGED there, or CLOSED there with
     `landedInTrain: true` on its row of `ccd pr-state --session <id>`). A missing or non-`done` row, failed release, or required
     exact-SHA merge proof that is absent means report and do not dispatch. The
     closed row proves the fingerprint and terminal run state; it does not prove
     a required interface merged. Only then dispatch wave N+1 (step 2).
7. **Final merge:** on a native-queue project the last wave's producer LANDS
   before this close, as every producer does (clause 15;
   `references/wave-lifecycle.md` §5, "Landing on a native-queue project").
   The last wave's producer lands by the route the landing verdict reads
   (`references/wave-lifecycle.md` §5b).
   `POST /api/runs/:id/close` with `final:true` closes the run
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
