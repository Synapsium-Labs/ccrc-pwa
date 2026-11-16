# The wave lifecycle: step 5, the boundary between waves

One part of the wave lifecycle. `wave-lifecycle.md` lists every part.

## 5 — The boundary: open the next wave's run, THEN close this one

**The handoff review is a REVIEW RUN, and the held-out panel is its shape** (clause 14,
`references/review-panel.md`): three Opus lenses over the wave's commit range, three Sonnet
refuters per critical or important finding (one per minor, returned as advisory), at most 8 findings per lens,
majority deciding, model and effort literal in the script. The REVIEWER
runs it — this session dispatches the review run and rules on the report it returns (step 1
below, clause 12); a lens that returned nothing is a review not yet done, never an approval.

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

**Link the PR to its ticket, once, before it lands, by the repository's visibility.** When the wave's work is tied to
a Linear ticket, read `ccrc-api linking show` (`mode`, `teamKey`). If `linking show` fails or
answers anything else, follow the `public` rule. `private`: the ticket is in the workspace (a
dispatch's `slug` starts `key-123-`) and the PR body says `Closes KEY-123` when the merge meets the ticket's
acceptance, `Refs KEY-123` when a live check is owed; Linear's GitHub integration links and closes. `public` or
`unknown`: the PR is linked from the Linear side with `ccrc-api linear link <REF> --json -` (body
`{"url":"<the PR's github.com URL>"}`), so the team's Git automations act on merge, and its body cites the ticket's
GitHub mirror issue and never the tracker id: `Closes #<n>` or `Refs #<n>` by the same test. A link refused
`not-found`, `bad-field` or `not-configured` is reported in your turn, not retried in a loop; it never blocks the
landing.

**The recorded head.** In §5 and §5b, `<handoffCommit>` is the recorded head: the advance answer's `verifiedHead` when
present, otherwise the head the server's dequeue or merged brief prints. An advance answer with no `verifiedHead` means
the claim you submitted was itself the verified head. On a project the operator opted in to the radar's lineage the
recorded head can be the live tip rather than the tip the worker claimed, and it is the head every spelling below
binds: the native-queue enqueue, the spent-producer arm and the MERGED proof. When an advance answered `verifiedHead`,
every later advance of that run and its close that answer the same wave-done submit the worker's fingerprint with
`branchTip` and `handoffCommit` both set to that `verifiedHead` (the server's own answer, not a fresh measurement), so
the ordinary path verifies the head that is landing. That rule ends with the wave-done it answered: once the run goes
back to `working` (a send-back, or a lost merge race recorded from `merging`) or a fresh `wave-done` arrives, submit
the worker's fingerprint exactly as the worker reports it.

1. Dispatch a review run and rule on its report (SKILL.md steps 5–6, clause 12); this session never reads the diff itself.
2. Update the ledger — Waves row, Decisions, Carried constraints, and the
   **Next-wave brief**, which is the whole of what the fresh session reads.
   Commit it.
3. `POST /api/runs` for wave N+1 (§1, step 2) before closing this run. The
   program now has two open runs (this wave's, still `working`/
   `awaiting-review`/`merging`, and the new `planned` one), so it can never
   read as zero between waves.

   **One PR per child — the PR decides `sessionId`, not the project.** A
   CHILD is a workspace carrying the `$REG/<id>.child` marker — ordinarily
   one the server minted for a run, on a box whose `ccd` records it — and a
   MARKED child carries at most one PR. A fresh
   child always branches from the project's default branch — `ccd ws-add`
   sets `base` from `git symbolic-ref refs/remotes/origin/HEAD` — so it
   carries NONE of a spent producer's unmerged commits. If this producer's
   MARKED workspace opened a PR — the ordinary case for a wave that shipped
   code — it is SPENT: open wave N+1 WITHOUT its `sessionId`, even in the
   same project, and close the producer exactly as the cross-project arm
   below closes it: `final:true`, then require `released:true`, then require
   its own closed row's `state` to be `done` (`"$API" runs list --closed 1`)
   — and, if wave N+1 depends on an interface from this producer,
   independently prove that producer's PR merged at the exact SHA before
   dispatching wave N+1, because the closed row proves fingerprint and
   terminal state, never merge. Here, with no cross-project `producerSha` to
   read, the exact SHA is the producer run's own verified `handoffCommit`:
   prove the merge with `gh pr view <pr> --json state,headRefOid`, answering
   MERGED with `headRefOid` equal to it, or CLOSED with `headRefOid` equal to it
   and `landedInTrain: true` on the PR's row of `ccd pr-state --session
   <sessionId>` (a merge train landed its work through a train PR and closed
   it; ccd sets it only when that train PR is MERGED and its record lists the
   PR at exactly this head, so a label alone reads `trainUnproven` when ccd read
   that record and it proves nothing, which is reported as not merged, or
   `trainUnread` when ccd could not read it, which is unmeasured and is read
   again later; never treat either as merged, and you never name a label) — the
   coordinator lands every PR with
   `--match-head-commit <handoffCommit>`, by the route §5b reads from the
   repository's own rules, for exactly this reason (`--admin` and GitHub API
   merge or enqueue calls are governed by the repository's external policy
   authority; until that authority answers (wave 2b), a coordinator never uses
   them) — and on a native-queue project it lands with the same binding, as
   "Landing on a native-queue project" below says. An UNMARKED producer —
   every workspace minted without a marker: by a box whose ccd did not yet
   mark children, or by a dispatch that journaled `child-omitted` (§2) — is
   never refused this way; dropping its `sessionId` anyway is still safe and
   follows the same one-PR rule. The same-project arm is for a producer whose
   workspace opened no PR — a research or measurement wave — and only for
   that. Naming a spent workspace is refused `workspace-spent`,
   with `pr` naming the PR, and nothing is opened; `spent-unmeasured` means
   the server could not read the evidence either way — retry the same open,
   and do not drop `sessionId` on its account. If the PR lands after you
   opened wave N+1 on the workspace, the DISPATCH refuses `workspace-spent`
   instead (§2); with `unbound:true` it has already released the workspace
   and unbound the run — dispatch it again and a fresh child is minted, again
   from the default branch and carrying none of the spent producer's code, so
   if wave N+1 depends on that code, wait for the same merge proof before
   redispatching.

   **Landing on a native-queue project** (one whose base branch requires
   GitHub's merge queue — measure it before each landing, never from memory:
   the landing verdict (§5b) answers `ROUTE Q`, reading the PR's own base,
   never the literal `main`): the producer LANDS BEFORE IT CLOSES. Once its review is
   clean and wave N+1 is open — or, on the programme's LAST wave, which has
   no wave N+1, once its review is clean (its close is SKILL.md step 7's and
   §6's) — advance the producer's run to `merging` (§4 — from
   `awaiting-review`, re-measured). Enqueue only a PR whose required checks
   have all passed — every required name the verdict discovered passes on the
   head, and `gh pr checks <pr> --required` exits 0: for any other
   PR gh arms auto-merge instead of queueing it,
   and prints the same "will be added to the merge queue … when ready" line
   either way. The `--required` exit decides, and a `ROUTE Q` answer does not waive it.
   On `0`, go on under this gate and the read-back below. On `8` (pending), if
   this landing attempt's bounded wait is already spent (§5b, **After a bounded
   wait**), do not start the wait: report the exit to the operator and leave the
   landing stopped; otherwise wait for them in the foreground —
   `gh pr checks <pr> --required --watch`, again if the call times out —
   never by ending your turn: no mail comes when checks finish; then run the
   verdict again. Whichever arm led back to the verdict, a `ROUTE Q` answer
   does not skip this gate: never enqueue on a verdict without an exit `0` read
   after it. On `1`, run the verdict again: a `RED` goes to the `RED`
   rule of §5b, which limits a rerun to the kind it names and never reruns
   unconditionally; a `ROUTE Q` answer is the stop `checks-gate-unread`; any
   other line goes by its bullet in §5b. On any other exit the stop is
   `checks-gate-unread` too. Stop `checks-gate-unread` means: report the exit
   and the whole output, and never enqueue, arm, retry or choose another route
   by hand. gh's "no required checks reported" and "no checks reported" are an
   exit `1`: with a `ROUTE Q` answer they are this stop, which is deliberately
   conservative on a queue repository, not support promised by an empty
   required set, and it does not touch a repository whose required checks gh
   reports.
   Then, from your own session, enqueue its PR with
   `gh pr merge <pr> --match-head-commit <handoffCommit>`: no `--squash`,
   because the queue's merge method applies, and never `--admin`. The same
   enqueue is what an unattended lander does (ruling R5 as amended
   2026-10-25: the queue re-tests the combined code, the required checks gate
   the enqueue, the head is bound): it needs no human present, and a worker
   still never enqueues its own PR. Prove it
   is IN the queue before you rely on the server:
   `gh api graphql -F o='{owner}' -F n='{repo}' -F p=<pr> -f query='query($o: String!, $n: String!, $p: Int!) { repository(owner: $o, name: $n) { pullRequest(number: $p) { state autoMergeRequest { enabledAt } mergeQueueEntry { state } } } }'`
   gives one of four answers. A queued PR answers a non-null
   `mergeQueueEntry`, the success answer. A `state` of `MERGED` — or of
   `CLOSED` with `landedInTrain: true` on the PR's row of
   `ccd pr-state --session <sessionId>`, a merge train having landed it and
   closed it — means it already landed: wait for or prove `merged:#<pr>`, and never disarm — a
   merged PR answers a null entry too, so the entry alone cannot tell merged
   from nothing queued. A PR with no entry but a non-null `autoMergeRequest`
   means it is only armed, and nothing is queued and nothing will tell you so:
   disarm it (`gh pr merge <pr> --disable-auto`) and read why before you do
   anything else. A PR with no entry, no `autoMergeRequest` and neither of
   those landed answers means nothing is queued: read why before you do anything else. Disarm the
   same way before any fix round from `merging` — an armed auto-merge queues
   whatever head the branch carries once its checks pass, and GitHub disarms it on a push only
   from a login without write access. End your turn. The run waits at
   `merging`, holding the child, so its workspace is not reclaimed under a PR
   still in the queue, and the server tells you how the queue answered: a
   `status` mail `merged:#<pr>` once the PR reads merged, or
   `dequeued:#<pr>@<time>` when the queue removed it without landing (GitHub
   does not re-enqueue). On `merged:`, prove the merge exactly as above —
   MERGED, or CLOSED with `landedInTrain: true`, `headRefOid` equal to
   `handoffCommit` — then close the producer as
   this step closes a spent one (on the last wave, as §6 closes it), and only
   then dispatch wave N+1. A `merged:#<pr>` can also reach a run at `merging`
   on a project without the queue, when a sweep reads your own synchronous
   merge before your close: prove and close as usual; a run already closed
   needs nothing. On `dequeued:`, read why from the queue's own CI run, not
   the PR's checks, which ran on a different commit and can read green —
   `gh run list --event merge_group --json databaseId,headBranch,conclusion`
   finds it by its `headBranch` (`gh-readonly-queue/<base>/pr-<pr>-…`) and
   `gh run view <id> --log-failed` says why, and a conflict is measured as
   SKILL.md step 6 measures it: after one `git fetch origin`, `git merge-tree
   --write-tree --name-only --no-messages origin/main <handoffCommit>` exits 1
   with a tree id on its first line, then the conflicted paths. Then either
   enqueue it again exactly as above — the landing verdict (§5b) again first,
   then the checks, then the read-back — or send the owning worker a fix round
   on the `merging → working` edge in one of the two report-less forms of
   SKILL.md step 6's send-back (its fresh wave-done gets a fresh review run,
   and a fresh `merging`). A dequeue that neither a re-enqueue nor one of
   those two forms answers, a requested change or a cause you could not read
   among them, is a stop for the operator and no report-less round (SKILL.md
   step 6). Closing before the landing would hand a PR still
   in the queue to a reclaim: nothing could then tell you of its dequeue, and
   no worker would be left to fix it. A coordinator whose own workspace
   carries a programme-wave hold or the child marker — a self-claimed run's,
   or a reclaim heir that was the programme's own worker — is refused its
   enqueue by the session hook, like any worker. Do not close to shed the
   hold (a final close of a child reclaims your own pane): ask the operator
   to enqueue, or disarm, with the same spellings from their own shell, and
   wait at `merging` as above.

   **Same project:** open wave N+1 first with this producer's `sessionId`, then
   close the producer with `final:false`; the hold transfers to the already-open
   successor on the same workspace. After that same-project close, run
   `"$API" runs list --closed 1`, find this producer by run id, and require its
   own `state` to be `done`.

   **Different project:** open wave N+1 first without this producer's `sessionId`,
   then close the producer with `final:true` and require `released:true`; there is
   no same-workspace successor to receive a synthetic hold. After that
   cross-project close, run `"$API" runs list --closed 1`, find this producer by
   run id, and require its own `state` to be `done`. If the consumer depends on
   an interface from this producer, independently prove the producer interface
   PR merged at the exact `producerSha` carried with `producerRepoRoot` and
   `producerSourceRepoPath` in the conditional producer contract (it reads
   MERGED there, or CLOSED there with `landedInTrain: true` on its row of
   `ccd pr-state --session <sessionId>`). The closed row
   proves fingerprint and terminal state, not merge.

   A missing/non-`done` producer row, failed release, or required exact-SHA merge
   proof that is absent means report and do not dispatch. The default `runs list`
   excludes `done` and `failed` rows, so it cannot perform the state check.
4. The close re-measures the SAME facts, against the SAME codes, as `/advance`
   does (skipped only on an explicit `"state":"failed"` abandon). Its response
   SHAPE differs from §4's table: a mismatch answers
   `{"ok":false,"error":"<code>","detail":"<why>"}` — `error`, not
   `reject.code` — so read `$body.error` on this route, not `$body.reject`.
   Two refusals besides the re-measurement codes are `not-dispatched` and
   `prhistory-unreadable`; both ride `refused`. A hold write that would exceed
   the hook's display window answers `error:'hold-oversize'` (413), while an
   invalid stored programme or numeric domain answers `error:'hold-invalid'`
   (400). Both leave the run open; report rather than retrying unchanged.
5. Dispatch wave N+1 (§2, step 2) only after the applicable close, closed-row
   proof, release proof, and exact-SHA merge proof above succeed.

**Attributed landing writes.** For a PR with no run, create its entry through
`POST /api/landing/entries`, using the closed client:

```text
ccrc-api landing entries --json -
```

Send `project`, `pr`, `pinnedSha`, `handoffCommit`, `byId` and `byUuid` in its
JSON body. `pinnedSha` claims the PR head and `handoffCommit` claims the
handoff commit. This door records your claims, not independent GitHub,
review or ancestry proof. Do not use it to replace an existing or recovered
entry, replace a run's entry or manufacture an ejection base.

Set or clear an existing entry's order through `POST /api/landing/order`:

```text
ccrc-api landing order --json -
```

Send `project`, `pr`, `afterIds`, `fixesMain`, `byId` and `byUuid` in its JSON
body. Read `GET /api/landing?project=<project>` first. `afterIds` are existing
entry ids from this project's line, never PR numbers. Send the whole new
`afterIds` array and the whole new `fixesMain` value, not deltas:
`afterIds: []` clears the edges and `fixesMain: false` clears the flag. Keep
the value you read for a field you are not changing; never default it away.

`fixesMain` is the coordinator's or the operator's to set or clear, never a
worker's. It records priority, not permission to skip any landing gate. Both
writes require the box token and attribute `setBy` through `byId` and
`byUuid`; this records who wrote, not who was authorized. Read the answer
before acting; a refused or unreadable answer licenses no retry or landing.
An answer with `mayApply: true` is uncertain, not a rejected write with no
effect. Recovery evidence is not a current pin or proof of a no-run entry.
A recovery hold or a fenced landing line licenses no landing.
