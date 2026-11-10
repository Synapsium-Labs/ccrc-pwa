# The wave lifecycle: step 6, the final merge

One part of the wave lifecycle. `wave-lifecycle.md` lists every part.

## 6 — Final merge

On a native-queue project the last wave's producer lands BEFORE this close,
exactly as §5's "Landing on a native-queue project" says: with no wave N+1
open, closing it first would retire the programme and reclaim the child
under a PR still queued.

`POST /api/runs/:id/close` `{"fingerprint":{…},"final":true}` on the last
wave's run — re-measures, closes this run `done`, and releases the hold
(`ws-release`) **only when no other open run names this session**. The response
carries `released`. `released: true` means the claim is gone. A workspace that
is not a child — your own, or any workspace dispatch did not mint — is an
ordinary unheld, unclaimed row again; nothing archives it, and it stays live
and supervised until a human cleans it up. A child is reclaimed instead (below).
`released: false` means the
claim was **handed over**, not dropped: another run still owns this workspace,
so the hold was rewritten with that run's own reason and nothing was archived.
That is not an error — it is the ordinary consequence of opening wave N+1
before closing wave N — but the program is not finished until that run closes
too. The same field rides the abandon response.

Since Build 8 the merged sweep asks the same question the close does, before it
picks which notice to push: a workspace whose hold is absent but whose run is
still open is announced as **still claimed**, naming that run. Releasing a hold
by hand only changes which of the two notices the next sweep sends.

Neither notice archives anything, and nothing else touches a workspace that is
not a child. Such a merged workspace stays where it is — live, supervised, its
PR merged — until a human archives it, and when a human does, its manifest
carries the whole PR lineage. A child the close has finished with is the one
exception, and the server's, not yours (below).
You do not reap, ever (clause 3); cleanup is the operator's ceremony
in the PWA.

**A child is reclaimed; your own workspace is not.** A CHILD is a workspace
dispatch minted for one of your runs — the box marks it with the run that
minted it, and the server holds the same run as having minted it; both must
agree, or it is not a child. When a close FINISHES with a child — a `final`
close, an abandon (`state:'failed'`), a close of a child whose branch opened
a PR after it was created, or a close that leaves your program with no open
run — the server
RELEASES it rather than holding it for a next wave, and the close response
carries `"childReclaim":"queued"`. The reclaim itself runs after the answer,
on the child's own queue: it records anything left uncommitted as a WIP
commit (it moves no branch) — except a secret-shaped file, which is never
committed and is deleted with the tree — pins every commit and stash in the
attic, writes a tombstone, and then removes the pane, the worktree, the
branch, the clips directory and the child's temp directory. Its outcome
lands in the feed — reclaimed, deferred with its reason, refused with its
sentence, or failed — and never in a reply to you. A child that another open
run still names, or that the operator is looking at, is deferred and picked
up later; nothing you do speeds it or stops it. Otherwise
the response carries `"childReclaim":"not-queued"` and `childReclaimWhy`
says why: `not-a-child`, `marker-unreadable`, `siblings-open`,
`siblings-unreadable`, `review-report-live`, `has-coordinated`,
`not-finished-undated`, `not-finished-merge-commit`, `not-finished-unmeasured`
or `not-finished` — the last is
the ordinary non-final close holding a child for wave N+1.
`not-finished-undated`, `-merge-commit` and `-unmeasured` hold a child whose
spent evidence the server could not use: a PR from its branch that no dated
row places in this workspace's life, a fast-path PR number (the registry's
own, or a `.prhistory` row) the live read dated to an earlier workspace of the
same name, or a spent read that did not
answer. A next wave's bind re-reads it and refuses `workspace-spent` or
`spent-unmeasured` rather than take a spent child; the server reclaims it
once your program has no open run. `has-coordinated` means the child has
coordinated a run, so its workspace is cleaned up by a human. No
`childReclaimWhy` at all means the child was eligible but the hand-off did
not start; it is reached regardless. **A review run's reviewer
is a child too, but it is kept while the run it reviewed is open**: its
clips directory holds the report you cite by path in every `fix-round` mail
sent on a review report (a report-less round, SKILL.md step 6, cites none).
If the run it reviewed is still open when the review run closes, that close
releases the reviewer and answers `review-report-live`; if the reviewed run
is by then already terminal, the review close finishes the reviewer
directly instead, with no `review-report-live` deferral. Either way, the
reviewer is reclaimed only after the run it reviewed has closed. Nothing
changes in how you read or cite the report (SKILL.md step 6). Your own
workspace, and any workspace dispatch did not mint, is never reclaimed — it
stays until a human cleans it up, or — when it carries no child marker — until the server cleans it up seven days after it is archived, once the operator has armed the server’s expiry lane (until then the lane only records what it would expire).
