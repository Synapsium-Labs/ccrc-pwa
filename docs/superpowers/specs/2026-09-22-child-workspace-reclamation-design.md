# Child-workspace reclamation — the fleet closes the loop it has never closed

**Status:** design approved by the operator 2026-09-22; written spec accepted the same day. Ticket CCR-15 ("Reclamation policy: the fleet can act on
idle and finished workspaces"). Supersedes nothing; **narrows** two standing rulings and **satisfies** a
third that has been open since 2026-08-11. Implementation rides nine waves (§8), agent-first; wave 7 is the temp-root collector.

This document is the design. The numbered deviations, the task breakdown and the mutation tables belong to
the plans that follow it.

---

## 1. The operator's rules

Given 2026-09-22, verbatim, and they are the requirement — everything below is machinery in their service.

> 1. When coordinator finishes with a sub-workspace, that workspace always gets cleaned up.
> 2. Artifacts, including any cd.out etc., for workspaces that get cleaned up always get cleaned up too.
> 3. Any signle sub-workspace spawned by a coordinator cannot be used for more than one PR, and should be
>    cleaned up by the coordinator after the PR is done (this does not mean that the sub-workspace MUST
>    produce a PR, but once it produces a PR it must report its work back to coordinator and then be
>    terminated by coordinator/automation, depending on what makes most sence, and future PRs are picked
>    up by other fresh spawned children).
> 4. Manul cleanup should be reserver OLNLY FOR COORDINATOR WORKSPACE CLEANUP. These are the workspaces
>    that the human user interacts with directly. The human should not need to directly interact with any
>    sub-workspaces the coordinator spawns.

(Quoted as given, typos included, because a requirement that has been tidied is a requirement that has been
interpreted.)

Four further rulings, given the same day against four questions this design could not answer for itself:

| Question | Ruling |
|---|---|
| A child the reap ladder cannot prove safe (dirty tree, unpushed unique commits, secret-shaped ignored files, a PR closed unmerged) | **Pin everything, then reap.** Dirty tree gets a WIP commit on the child's branch; every commit and stash is attic-pinned; the tombstone records it; then worktree, branch and clips go. Secret-shaped ignored files die with the tree. Nothing waits for a human. |
| What spends a child | **A PR opened from its branch.** After that no new run may bind it, and it is reclaimed when its run closes. A wave that opened no PR may still hand over to the next wave on the same child. |
| The child's conversation transcripts | **Keep them.** Not an artifact under rule 2. |
| How much of the 2026-08-11 Tier B ceremony to keep | **Kill-switch plus attached-defer.** A fleet-visible pause toggled from the phone, and a defer while someone is present. Every reclaim lands in the feed; no push per reap. |

As built (§5.5 step 2; wave 3's `wip-moves-no-ref`), the WIP commit is pinned in the attic and moves no branch.

**Rule 4 is the load-bearing one**, and not because of what it asks for. It changes the *population* an
automatic collector acts on, and that is what makes one safe here where the last one was not — see §3.

One qualification is owed up front, because the first ruling's "nothing waits for a human" is not kept
absolutely: three conditions — two where proceeding would destroy work **nobody could see**, and one where
ccd cannot tell the directory is the child's at all — refuse instead of proceeding. They are argued at §5.5
and bounded at §7. They are not all that the automatic path keeps for a person: it also keeps a child
under any other terminal refusal (`branch-elsewhere` among them), each child the sweep's kept verdicts name
(§5.9), and a child whose reclaim fails past the ceiling for good, such as `pin-failed` with its HEAD still
on a branch that is already gone. Each is reported (§5.9).

---

## 2. What exists today

Measured this session, in this tree at `origin/main` `46aca9fe`.

**Dispatch mints workspaces and nothing reclaims them.** `dispatchRun` runs `ccd ws-add --no-rc` for a run
with no session (`server/src/coord/dispatch.ts`), and `closeRun` performs exactly one fleet act —
`ws-release`, `ws-hold`, or, only on an explicit operator abandon carrying `archive:true`, `ws-archive`
(`server/src/coord/close.ts`). None of the three destroys anything. `ws-archive` "DESTROYS NOTHING: no
worktree remove, no branch -d, no rm of the registry" (`ccd/ccd`, `cmd_ws_archive`'s own header); its one
cost is the tmux pane.

**Both ends of the archived queue are manual.** The merged sweep stopped archiving on 2026-09-10 —
"The merged lane: it ANNOUNCES, and it never acts" (`server/src/watch.ts`, `sweepMerged`) — after it was
measured killing sessions a human was still using. `ws-reap`, the one verb that removes a worktree, has
**zero automatic callers**: the only argv constructor in the tree is the PWA-facing route
(`server/src/server.ts`). The 2026-08-11 artifact-lifecycle policy names this exact state its "single
largest structural defect": *the queue with an inflow and no outflow*.

**The contracts forbid the agents from closing it.** Coordinator clause 3 ("This session never reaps…at any
wave, for any reason"), worker clause 8 and reviewer clause 8 are pinned verbatim by three test files, and
the forbidden verbs are additionally pinned by an equality check that requires each verb name to appear
exactly once, only inside the clause that forbids it. `wave-lifecycle.md` §6 says it in prose: "nothing
archives it: it stays live and supervised until a human archives it… cleanup is the operator's ceremony in
the PWA."

**And the reuse model is the opposite of rule 3.** A program's waves share one workspace by design: wave
N+1 opens on the same `sessionId` before wave N closes, the close sees an open sibling and re-holds instead
of releasing, and dispatch resumes rather than spawning (`wave-lifecycle.md` §5, deviation D-1). One
workspace legitimately carries several waves and several PRs across a program's life.

So the four rules are not an increment on what is here. They replace the disposal model.

---

## 3. Why an automatic collector is safe here when the last one was not

The 2026-09-10 ruling is the strongest argument in the tree against exactly what this spec proposes, and it
must be answered rather than stepped around. Its own words:

> `archiveSafety` measured an INSTANTANEOUS `idle` — and a session parked at the prompt while its operator
> reads the last answer measures exactly that. A `tmux attach` on the fleet box was invisible to it; only an
> open PWA websocket counted. Deferring on `busy`/`attached`/`unknown` narrowed the window; it could not
> close it, **because the thing being measured is not the thing that matters** (whether a human is coming
> back).

That argument is correct and this design does not dispute it. **No snapshot can tell "finished" from
"a human is reading it".** Every attempt to sharpen the measurement is the mistake that ruling identifies.

What changes is the subject. The old sweep acted on *every merged workspace*, a population whose defining
members were the operator's own. Rule 4 declares a population for which the question "is a human coming
back" has a contractual answer of **no**: a child is a workspace the human is never expected to touch. The
collector is safe not because it measures better, but because it acts only on workspaces that are, by
declaration at the moment of creation, nobody's to come back to.

That shifts the whole weight of the design onto one question: **how does a process know a workspace is a
child?** Everything in §5 follows from taking that question seriously. A collector whose population test is
weak is the 2026-09-10 sweep again, with a worse verb.

Three consequences are accepted openly:

- **The presence defer is kept anyway**, as depth, not as the argument. Rule 4 says nobody should be at a
  child; the defer covers the case where somebody is anyway. It is bounded (§5.7), because an unbounded
  defer cleared only by a human inverts rule 4.
- **The kill-switch is kept**, as the 2026-08-11 Tier B ruling requires, and is read at the instant of
  deletion rather than only by the server (§5.8).
- **Nothing here widens reach over non-children.** The operator's own workspaces, the coordinator's, and
  every workspace that exists today keep today's behaviour exactly: human ceremony, `ws-reap`, `--expect`,
  no override. This design must not become leverage for that, which is the worst available outcome of a
  governance exercise and is named as such in the 2026-08-11 policy's own Tier C.

---

## 4. Vocabulary

Three words, each with exactly one definition and one authority.

**Child.** A workspace minted by `dispatch` for a run. It is a child because ccd was *told so at creation*
and recorded it — never because a heuristic recognised it later. There is no path by which a human's
workspace, a coordinator's workspace, or any workspace that exists today becomes a child.

**Spent.** A child whose branch has ever had a PR dated to it (§5.3), in any phase — open, draft, merged or
closed. Spending is monotone: nothing un-spends a child.

**Reclaim.** The act: pin everything recoverable, then destroy the worktree, the branch, the clips, the
per-session temp root, the pane, the unit and the registry row. It keeps the attic refs, the tombstone, the
lifecycle journal and the transcripts. It is `ws-reap`'s destruction with a different consent model and a
different ladder in front of it — not `ws-reap` with a flag, for the reasons in §5.5.

**The word is already taken in code, so code does not use it bare.** `POST /api/runs/:id/reclaim`, its
refusal-code type and the PWA's resume sheet all mean *reassigning a dead coordinator's claim* — nothing is
destroyed. The ccd surfaces keep this spec's names (`ws-reclaim`, `reclaim-pause`, the journal act
`reclaim`), because ccd's vocabulary has no such collision; every TypeScript identifier, file, CSS class and
test file this programme adds says `childReclaim` instead, so a grep for one feature never returns the other.

---

## 5. The design

### 5.1 The marker, and why child-ness needs two authorities

`wsAddWorker` passes `--child <runId>`; `cmd_ws_add` parses it in the strip-then-bind loop it already has
and writes `$REG/<id>.child` holding the minting run id. That marker is what makes a workspace a child.

**It is not a credential, and the design must not pretend it is.** `_reg_get` is a bare read, every session
on the fleet box runs as one UNIX user, and ccd has no caller auth — CLAUDE.md states it plainly: *identity
on the fleet is attribution, not authentication*. A boolean file any process can `touch` cannot be the sole
gate on a verb that deletes a worktree.

So child-ness requires **two authorities to agree**:

1. the marker on the box, holding a run id; and
2. the argv the server composed, `--child-of <runId>`, taken from the run row that minted it.

`ws-reclaim` refuses `not-a-child` unless both are present and **equal**. Neither alone authorises anything.
A marker written by mistake names a run that did not mint that workspace, and the verb refuses.

This is a bar, not a wall, and the spec says so: a session with a shell can run ccd directly and supply both
halves. What the two-authority rule buys is that **the automated path cannot be steered by a single stray
file**, which is the failure mode that matters here — the automated path is the one with no human in it.

**The server's reader tells three conditions apart, not two.** `readRegistry` exposes the field as the
minting run id or a distinct *unreadable* answer, through the measured-read pattern the row already uses for
`held`. It is never a boolean. A listed-but-unreadable marker must **refuse** a run bind (or a spent child
takes a second run) and **defer** the sweep (or an unreadable marker authorises a deletion). Those are
opposite directions from one condition, which is precisely why absence and unreadability may not collapse.

### 5.2 Artifacts: containment for children only

ccd's session launch exports `TMPDIR=$HOME/.cc-tmp/<id>` (mode 0700, created at spawn) **only for a session
minted with `--child`** — the condition is known at exactly that moment. This is the containment the
2026-08-11 policy designed as Build 5 and never shipped: tool scratch that follows `TMPDIR`, `cdk.out`
foremost, lands inside a directory the reclaim tail removes, so rule 2 is satisfied *by construction*
rather than by a second collector chasing paths.

Two honesty constraints, both load-bearing:

- **Children only.** Exporting it fleet-wide would move uncollected scratch out of an OS-reclaimed `/tmp`
  into `$HOME` for the ~20 sessions that are *not* children and have no collector — a larger, quieter leak
  on a population rule 2 never named. Fleet-wide containment is a good idea and it is **a different spec**.
- **One measured prerequisite, measured before it is relied on.** Whether the Claude Code harness
  scratchpad follows `TMPDIR` is a claim about another program, not about this tree. `ccd-tmp-sweep`
  (#168, merged the day this spec was written) states its root as `${TMPDIR:-/tmp}/claude-<uid>/`, which
  is the same claim; neither it nor this spec has measured it. Wave 1 spawns one child with `TMPDIR` set
  and reads where the scratchpad lands. If it does not follow, the child's scratchpad stays under
  `/tmp/claude-<uid>/` and `ccd-tmp-sweep` already collects it by session id — **never** by deleting a
  directory keyed on the workspace path, which two live sessions can share.

**A temp root that cannot be made private is not used.** If `$HOME/.cc-tmp/<id>` already exists as a symlink
or a regular file, or cannot be created mode 0700, the child spawns *without* `TMPDIR` and ccd warns. Refusing
the spawn would leave a swap or a supervisor restart with no session at all, and pointing `TMPDIR` through a
planted link is worse. That child's scratch lands under `/tmp` instead, where `ccd-tmp-sweep` collects it, and
the reclaim tail unlinks the odd leaf itself — `rm -f` on the exact path, never following it.

**Two collectors, disjoint roots.** `ccd-tmp-sweep` refuses any root that does not resolve strictly inside
`/tmp` or its own `TMPDIR`, and as a systemd user unit its `TMPDIR` is the box default. A child's temp root
under `$HOME/.cc-tmp/<id>` is therefore invisible to it. The reclaim tail removes it at once, rather than after
the sweep's seven-day horizon, and the second collector, `ws-collect` (§5.10), takes back a witnessed one that
the tail kept or a human verb left behind, once the row that named it is gone. The roots never overlap, so the
2026-08-11 policy's warning about two collectors on one filesystem does not apply. The price is stated: a child
that hits a terminal refusal (§5.5) keeps its temp root, which the hourly sweep would otherwise have collected
once the session died, and `ws-collect` does not take it either, because that child's row still stands. That
child is itself uncollected and already on the attention item, so nothing new goes unreported.

**The positive witness.** Each time `_child_tmpdir` hands a child its temp root, ccd records one line at
`$REG/tmproots/<id>`: `v=1`, the id, the run, and the leaf's device, inode, birth time (`-` where the
filesystem keeps none), owning uid and the time, taken by `stat` right after the leaf's mkdir and chmod. It is
written, by a temp file moved into place, only when it is absent or unparseable, or its device, inode, birth
time or run no longer match, so a recycled slug's new child overwrites it on its first spawn. A failed write
never fails the spawn. The registry subdirectory has no leading dot, as `pools/` has none: no registry glob
sees it, a row's purge leaves it standing, and a slug whose only trace is its witness reads free. A
`tmproots/` that is itself a link is never followed, by the writer, the reader, the remover or the collector. It
dies only once its leaf is proven absent: by the removal helper (§5.6) after it removes the leaf, by the tail's own
absence proof when the in-use probe answered in use or unmeasured and the helper was never asked (§5.6), or by the
collector (§5.10), which drops it by compare-and-drop and only after the leaf is proven gone. The collector also drops the witness of a leaf
that is already absent, but only when no quarantine record of that id stands, because a record is the proof that a
leaf may be waiting in a quarantine slot. A leaf whose identity no longer matches its witness, which is what a
storage migration does to every leaf, is never collected; it is the operator's.
Identity on the box is attribution: any process of this uid can write the file, so the binding narrows a
forgery to a directory ccd itself made, and it is not a wall. Only `ws-collect` collects by the witness (§5.10).
Wave 7 ships it inert, and no lane composes it until wave 9 (§8).

**Darwin keeps its temp roots.** Whether a process still uses a temp root is read from `/proc`, which
Darwin lacks, so there that probe answers unmeasured and every reclaim and expiry tail keeps the temp root
directory, recorded as kept (§5.6); a link or file leaf is unlinked there as before. The collector is
Linux-first too. A Darwin box's `~/.cc-tmp` therefore grows by one leaf per child until a person clears it.

**The residue probe.** After a reclaim, the lane measures what the child left outside the worktree and its
temp root and records the total. Rule 2's claim is thereby *bounded and observable*: containment covers
writers that respect `TMPDIR`; writers that hardcode `/tmp`, or write to `~/.cache`, `~/.npm`, a docker
volume or the project's main checkout, are not contained, and the probe turns that gap into a number
instead of an assumption.

### 5.3 Spent, measured when it is asked

`childSpent` returns **three** values — `spent`, `unspent`, `unmeasured` — never a boolean.

- Fast path: the registry's PR number, and `.prhistory`. Either naming a PR answers `spent`. The two are
  not equal evidence, and only one direction of the first is used: the registry's PR number is read through
  the collapsing reader, which folds an absent file and an unreadable one into the same null. So a PR number
  **present** is evidence of spent, and a null is evidence of nothing. `.prhistory` is read through its
  measured reader and tells absent from unreadable.
- Slow path: when the fast path says no, a **live** `ccd pr-state --session <id>` runs at the moment of the
  question. Nothing in this system learns of a PR by push or webhook — every PR fact comes from a `gh` call
  something triggered, and the only untriggered one is the sweep, whose idle cadence is measured in minutes
  while a coordinator opens wave N+1 within seconds of the worker's done mail. A stale read would answer
  `unspent` for the exact hand-over the rule exists to stop, so the gate measures rather than recalls.
- An unreadable ledger, or a failed measurement, answers `unmeasured` — never `unspent`. This follows
  `closeRun`'s own fail-shut direction on the same file, where an unreadable `.prhistory` refuses the whole
  close rather than asserting "this workspace retired no PRs".
- **`branch-drift` is `unmeasured`, not `unspent`.** `pr-state --session` narrows its `gh` call with the
  branch the registry currently records; when that disagrees with git's own worktree record it refuses with
  that word and persists nothing, rather than measuring the wrong branch. A drifted child is one whose PR
  this gate provably did not look for, which is the definition of unmeasured.
- **Which workspace a PR spent.** A child's branch name is a recycled slug, so a PR on it may belong to an
  earlier workspace that wore the same name. The live rung counts every same-repository PR whose head is the
  child's branch, in any state and whatever its base, and places each against the child's birth: the stamp
  the dispatch that minted it took on the server's clock just before its `ws-add`, written once when it
  bound the session. With 120 seconds of skew either side, a PR created at or after the birth plus the skew
  is placed `this`; one created before the birth less the skew is placed `inherited`, and dropped; anything
  else is `unplaced`: no creation date, a date inside the skew, or a birth that cannot be placed (the
  minting run unreadable, absent or bound to another session, or holding no birth that is provably this
  occupant's, as for a workspace a dispatch adopted rather than minted). The fast path carries no date, so
  its answers are `unplaced` too.
- **The bind and the close read the placement differently.** A bind refuses on `this` or `unplaced`,
  because a wrong refusal costs one round. A close treats `spent` as finished only when a dated live row
  proves `this`, and re-dates a fast-path answer through the live rung before it decides; `unplaced` and
  `inherited` hold the child. A wrong reclaim would destroy a held child's clips, temp root, ignored files
  and pane, and on this repository merge-commit merges have bound old PRs to recycled slugs. A child held
  this way is released when its programme ends (§5.7).

### 5.4 Rule 3: two refusals

`POST /api/runs` carrying a `sessionId`, and dispatch's resume arm, both consult the verdict:

| Verdict | Answer | Remedy the caller takes |
|---|---|---|
| `spent` | 409 `workspace-spent`, naming the PR | open the run **without** `sessionId`; dispatch mints a fresh child |
| `unmeasured` | 409 `spent-unmeasured` | retry; the evidence was unreadable, not absent |
| `unspent` | proceed | hand-over as today |

Two codes, not one with a detail string, because the caller's remedy differs — the distinction is the whole
value of the answer.

**Spentness can turn true between open and dispatch** (wave N's own worker opens the PR after wave N+1 was
opened on the child). Dispatch's refusal therefore does not merely fail: it **clears the binding** —
`sessionId` back to null and the hold released, the run staying `planned`, which is where a run awaiting
dispatch already sits, so no backwards state transition is invented. The next dispatch mints a fresh child
and the run proceeds. A refusal with no automated exit would need a human, which rule 4 forbids.

**Non-children are untouched by all of this, with one fail-shut exception.** A workspace with no marker binds
exactly as today — unless the registry cannot be listed at all. Then no bind can prove it is not naming a
spent child, so every bind answers `spent-unmeasured`, retryably, rather than guessing.

### 5.5 `ws-reclaim`: its own verb, its own token

A new ccd verb, `ws-reclaim --expect <token> --child-of <runId> --session <id>`, granted on the agent
whitelist as `['ws-reclaim','--expect']` and enrolled in the required-flag table.

**Why a token, when the marker already gates it.** The whitelist's own docstring rules that a grant of a
bare verb "is not a smaller grant, it is a DIFFERENT one — it permits an UNCONFIRMED reap". `ws-reclaim`
destroys what `ws-reap` destroys. Granting it on `--session <id>` would permit the argv for *any* session,
with no fingerprint re-proved against the world at the instant of deletion — so any defect that composed the
wrong id (a stale wire field, a recycled slug, a sweep racing a rename) would destroy that workspace with
nothing on either side able to notice. `ws-audit --reclaim` mints the token over the reclaim ladder's own
facts; `cmd_ws_reclaim` recomputes and compares it inside the lock, refusing `state-changed` on any drift.
The marker becomes the *second* check rather than the only one.

**The token also binds which row it was minted over.** A slug is recycled: a later `ws-add` can mint a new row
under the id an earlier token named, and nothing else in that token would differ. So the row's generation, the
value in `$REG/<id>.generation` that is minted with the row, removed with it and rewritten by nothing else (`/clear`,
a swap and a respawn leave it alone), is an input of the fresh reclaim token and of the resume token, and a token
minted over one row can never be spent on a re-mint of the same id. `ws-audit --reclaim` prints it as the
`generation` key: the string, or null where the first two rungs refused before it was read or where the read itself
answered unmeasured. It is read after those
two rungs, so their terminal words are unchanged, and it is read under the row's compaction lock:
`_ws_reclaim_generation` takes the lock, reads through the one generation reader, releases the lock, and sets
`RECLAIM_GENERATION`, or `RECLAIM_GENERATION_WHY` where it answers unmeasured. The order, reap lock and then
compaction lock, is the purge's own. A lock that cannot be taken, a generation that is absent, one that is not a
36-byte lowercase UUID, and one the reader cannot read through its alias all answer unmeasured: no token is minted
and the ask is retried. So a `.child` row without a valid generation is unmeasured on every pass and never
terminal, and the sweep never reclaims it, because a token bound to an empty generation would be one no re-mint
could invalidate. That liveness residual is zero today: all 35 live `.child` rows were read carrying a generation
(read-only, on 8 October 2026). An absent generation heals at the next supervised respawn, and an invalid one never
does, by design. The audit took no compaction lock before; its acquire may now publish
`$REG/.<id>.compactions.lock` where none stands yet, and it waits up to five seconds for a contended one.

**Why a separate verb rather than a flag on `ws-reap`.** They accept opposite evidence. `ws-reap` refuses
`dirty-tree`, `sensitive-ignored`, `unpushed-commits`, `no-upstream` and `not-merged`; reclaim's whole
purpose is to proceed through the first two and to ignore the last three. Folding both into one verb makes
every rung ask "which caller am I serving", which is how a refusal ladder becomes unreadable and how a flag
becomes an override on a destructive act.

**The eval ladder**, in order. Retryable refusals are re-tried by the sweep; terminal ones are reported and
nothing is destroyed.

| # | Rung | Refusal | Kind |
|---|---|---|---|
| 1 | registry identity: entry exists, is a workspace | `no-such-session` / `not-a-workspace` | terminal |
| 2 | `.child` present **and** equal to `--child-of` | `not-a-child` | terminal, **no override anywhere** |
| 3 | `$REG/reclaim-paused` absent | `paused` | retryable |
| 4 | `.hold` absent | `held` | retryable |
| 5 | no tmux client attached | `attached` | retryable, bounded (§5.7) |
| 6 | no in-progress git operation in the tree | `tree-busy` | retryable, bounded |
| 7 | the branch is checked out in no other worktree | `branch-elsewhere` | terminal |
| 8 | the tree reads, after a permission normalisation pass | `tree-unreadable` | **terminal** |
| 9 | no nested checkout of a **different repository** is dirty or holds commits unreachable from its own upstream | `containment-unproven` | **terminal** |
| 10 | the recomputed fingerprint equals `--expect` | `state-changed` | retryable |
| — | the workdir exists but git records no worktree there | `no-worktree-record` | **terminal** |

**A vanished worktree is not a refusal.** When the child's workdir no longer exists and no breadcrumb says a
reclaim was already under way, there is nothing left on disk that could be lost: the branch tip and its
stashes are pinned into the attic, the tombstone records `worktree: absent`, and the tail runs from the branch
delete on. Retrying such a child would never succeed, and it would write a feed row every time it failed. A
directory that *exists* but that git does not record as this project's worktree is the opposite case: ccd
cannot tell what it would be deleting, so it refuses with `no-worktree-record`, terminally.

**Git's silence about a record is not an answer.** The `no-worktree-record` refusal, and the vanished arm's reading
that git has no record of the child's tree, both rest on `git worktree list`, and that list exits 0 while omitting
the stanza of a record whose `gitdir` it cannot read or that reads empty (every linked stanza, when `worktrees/`
cannot be listed), and lists a blank one at no path. Rung 8's rule, that a read which failed measured nothing,
therefore reaches them. A list that printed no record of
the tree is believed only once git's admin entries are read, through the one matcher of an entry to a path
(`_ws_reclaim_no_record`). An entry that names the tree makes the list's silence a falsehood, so the answer is
unmeasured; an entry or a `worktrees/` that cannot be read, an entry whose `gitdir` names no path on its first line,
empty or blank (`rung8-empty-gitdir-is-unreadable`, on the standing arm and the vanished arm alike, so the vanished
arm mints no token over a record never read), and a stray non-directory entry under `<common>/worktrees/`, hold every
such ask unmeasured too; `ws-expire`'s ladder runs the same matcher and answers the same; and only a clean "no entry names it" leaves
`no-worktree-record` standing. The audit answers unmeasured, retried and with no new refusal word, on both lanes,
where it used to answer the terminal word or, on the vanished arm, mint a token over a record that was never read
and stop at the pin. On reclaim the omission shape journals one `failed` `probe-unmeasured` line per audit pass,
which the retry backoff bounds. The fix sits at the ladder's call sites, never inside the record reader, which
other callers share.

**Another row's projection is not a placement** (D-3731). The vanished-worktree arm reads the child's *own*
missing path, already proven absent. Rung 9's comparison with another registry row reads someone else's, and
the two are not the same question. Take a row whose spelling resolves only below a proven-absent component, such
as `<alias>/server` after `<alias>` was removed. It names where that spelling would lead now, not where that
session is: a process that entered through the alias keeps its physical cwd inside the child, and nothing on the
box can reconstruct that cwd from a name that no longer exists. So another row is placed only on a `complete`
resolution, every component of its spelling walked and entered. A projected one makes the reclaim `unmeasured`,
retryable and with no new refusal word, at the audit and at the locked recomputation. The tail's final ownership
check asks the same question. A refusal there fails the reclaim as `containment-refuted` when it proves the tree is
not only the child's own, and as `worktree-remove-failed` when the question could not be asked (§5.6): it is
journalled, and the tree, the branch and the breadcrumb are kept (D-3736). A row literally at, below or through the child's path
keeps its terminal `containment-unproven`, because literal containment needs no resolution to be proven.

Two limits follow, and both are stated so neither is discovered later:
- **The hold reaches a vanished child.** The vanished-worktree arm itself is unchanged. But an ambiguous row holds
  a vanished child as it holds a present one, and two vanished children hold each other. The hold ends safely
  only once the row is purged after its session has ended, or a link on its path is restored to its original
  target, and then a later attempt has to run (D-3734). A directory created where a link stood ends it unsafely,
  because that re-points the spelling (D-3735).
  Since wave 6 a row whose directory is gone also stops holding on positive evidence alone, by one of two
  arms: git's own record of that worktree, exactly one, marked prunable, with the leaf the only absent
  component and the parent resolving complete to its literal spelling; or the row's own interrupted reap or
  reclaim, whose breadcrumb phase is past the worktree's removal, whose tombstone is the row's own and, for
  a reclaim, says ccd removed a present tree, and which git no longer records: the arm also proves that no
  admin entry names the tree, so a `worktrees/` or a `gitdir` that cannot be read, or that names no path, keeps the
  hold. An
  interrupted expiry's breadcrumb is not such evidence, a lifecycle `create` row never decides, and an
  unreadable record is never read as no record. No checkout inside the child's worktree may resolve its git directory to
  the admin directory a recovered row named. That refusal reuses `containment-unproven`, whose sentence
  describes such a moved tree only approximately. The recovery creates nothing, prunes nothing and purges no
  row. Only the git-record arm needs the parent to resolve complete. The breadcrumb arm places the row by its
  literal spelling, so a row whose parent is gone or reached through a link is released there once its leaf is
  proven absent. A spelling with a `.` or `..` component, a trailing `/` or a `//` is refused before either
  arm, and such a row holds.
- **A `complete` resolution places the spelling as it reads now, not the session.** An alias re-pointed after a
  session entered through it resolves complete and outside, and so does a spelling through a bind mount. Both are
  pre-existing and left to a follow-up (D-3735).

**Another session's tree can be moved into a leaf.** The tail deletes three trees: the worktree, the clips
directory and the per-session temp root. The check above guards the worktree, and only the worktree. A tree that
someone moves into the clips directory or the temp root keeps a `.git` file that names the admin directory its
repository holds for it, and git reads that record as prunable. So the recovery above places the moved tree's row by
that record, and nothing the check above looks at says where the tree went. Two rules close the two leaves:
- **A leaf that holds a checkout git records elsewhere is kept, never removed.** The removal helper asks this of
  every directory leaf at the instant of removal, whatever rows the registry holds (§5.6 gives the question). It
  never refuses the act: the helper answers refused or unmeasured, the tail keeps the leaf and records it, on the
  `done` row and in the done document, and the act completes.
- **A registry row at, inside or through a leaf is nested.** The nested-row comparison the worktree gets, literal
  and resolved, equal or inside, and through, is made against the clips directory and the temp root as well, for
  every row, standing or recovered by either arm, in one registry pass. Such a row refuses the act with
  `containment-unproven`, at reclaim and at expiry alike, as a nested row of the worktree does, and no word is
  added. A leaf proven absent is skipped, so a recovered row inside an absent leaf does not hold. A leaf whose
  absence cannot be proven, or whose root cannot be resolved, reads unmeasured. A link or file leaf is compared by
  its spelling alone, because the helper unlinks it and follows nothing. This also closes an older shape: a
  standing row whose directory lay inside the temp root was removed with it.

Rungs 8 and 9 are the two places this design **refuses rather than proceeds**, and they are a deliberate
reading of the operator's ruling rather than a softening of it. The ruling authorises overriding
`dirty-tree` and `sensitive-ignored` — conditions where the work is *seen* and can therefore be pinned. It
does not authorise proceeding over work nobody could see: a tree ccd cannot read after normalisation may
hold uncommitted work that a WIP commit would silently commit nothing over (ccd has measured a mode-000
directory answering rc 0 with empty status output — clean-looking and not clean), and a nested *foreign*
repository's unpushed commits cannot be pinned into this repository's attic at all. Proceeding there is not
"pin everything, then reap"; it is "reap, and note". Both surface through §5.9's attention item, which is
the one exception §7 records against rule 4 — and it asks nothing of anyone.

Rung 7 keeps `ws-reap`'s answer rather than the earlier proposal's "remove the worktree, keep the branch":
the tail's branch delete is a `update-ref -d`, which — unlike `git branch -d` — does **not** refuse a branch
another worktree has checked out, and a resumed reclaim has no way to learn that a skip was intended.
Refusing keeps one rule at one rung instead of a conditional two places must agree on.

**The pin phase**, which runs after the ladder and before anything is destroyed:

1. Untracked and ignored files are classified by the existing secret-shape classifier. **Secret-shaped files
   are never staged** — whether ignored or merely untracked. The operator ruled that secret-shaped ignored
   files die with the tree; a file that is secret-shaped but happens not to match `.gitignore` must get the
   same disposition, or an accident of `.gitignore` decides whether a credential is committed and then
   attic-pinned **permanently in a public repository**. Their paths are recorded in the tombstone; their
   bytes are not.
2. Everything else uncommitted — tracked modifications (an edit git was told not to look at, under
   skip-worktree or assume-unchanged, included), a staged version that differs from both HEAD and the disk,
   and non-secret untracked files — becomes one WIP commit. It is built with `git commit-tree` in a scratch
   copy of the tree's own index, so the user's index file is never written, and its parents are HEAD and
   each `MERGE_HEAD` line, where `git commit` would put them, and last, only when the staged version
   differs from both HEAD's tree and the WIP's, a commit of that staged index.
   **It moves no branch and no HEAD** (wave 3's `wip-moves-no-ref`, D-3365): it is kept by its id in the
   attic (step 3), so whichever branch the tree has checked out is never written, and the tombstone's `tip`
   is the branch's own tip, never the WIP. Each same-repository nested checkout gets its own WIP commit the
   same way, innermost first. ccd had no commit helper before this verb; every commit a reclaim writes —
   these, and step 3's reflog keep — goes through one writer (`_ws_reclaim_commit_tree`) with one fixed
   identity, under the reclaim's git containment, and it is still the only place in ccd that writes a commit.
3. Attic pins are taken under `refs/ccrc/attic/<id>/`, and none is optional: the in-progress operation heads
   (`REBASE_HEAD`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `ORIG_HEAD`) where present; HEAD; the WIP commit, by its
   id; each nested same-repository checkout's operation heads, HEAD and WIP commit; the branch tip when the
   branch exists, which is then required because it is the commit the tail deletes the branch at and, on a
   detached or drifted tree, nothing else pins it; and every stash attributed to the branch. Then every commit
   the child's own reflogs name (its HEAD's, its branch's, and each nested checkout's and nested branch's), and
   everything the child's and each nested checkout's own git directory names, is kept reachable from
   `refs/ccrc/attic/<id>/reflogs`. A pin that cannot be taken fails the reclaim as `pin-failed` while nothing
   is destroyed. Whether the branch exists is read three ways, by `git show-ref --exists`: present, absent,
   or a read that did not run. Every arm takes this one read in one act: the ladder's two tip reads, the pin,
   the vanished arm's pin read, and the tail's step 5. Only a proven absence goes ahead with no tip: HEAD,
   the WIP commit and every reflog and per-worktree ref commit are pinned as above, and the tail then
   deletes no branch. A read that did not run stops the reclaim: the audit answers unmeasured, and at the
   tail's branch step it fails `branch-unmeasured` with the row and the breadcrumb kept. A git older than
   2.43 has no `--exists`: there a branch that resolves still reads present and anything else reads
   unmeasured, so such a box (Apple's git 2.39, for one) reclaims a standing branch as before and never
   reclaims a gone one. A branch that reappears after the tombstone is `branch-moved`. The consent binds the
   branch's state in both directions: a branch the pin reads in a different state (present or absent) from
   the one the in-lock recomputation read stops the act before the tombstone as `state-changed`, journaled
   as a `failed` line, with nothing destroyed. A worktree that stands with its HEAD still
   symbolic to a branch proven gone stays `pin-failed`, because the WIP commit needs a HEAD. On the vanished arm no
   tree stands to need one, and git's record of the vanished worktree lists the all-zero id as its head in two
   shapes: an admin `HEAD` git cannot read, which prints no `branch` line, and a `HEAD` symbolic to a branch that no
   longer exists, which keeps it. A record whose head is all-zero in either shape answers unmeasured at the audit,
   where a token used to be minted over a head no pin could keep, and is retried with no new refusal word. A nested checkout of a different repository
   cannot be pinned here, so each run of this phase proves it again by rung 9's predicate, and a failure
   there is a pin that cannot be taken. A HEAD that has drifted onto another branch keeps that branch: it is
   recorded, and the tail deletes only the child's own. The tail runs this whole phase again as its settle
   once the pane is dead; every pin is idempotent.
4. The tombstone is written **before the first destructive act**, recording the branch, the tip, the WIP
   commit sha, the attic refs, the secret-shaped paths that were dropped, the containment verdict and the
   residue measurement. It is the one document that outlives the workspace.

### 5.6 The tail, the breadcrumb and the resume

`ws-reclaim` gets **its own arm** through the teardown, and the spec says so rather than claiming the
existing tail is reused unchanged. Three facts force it:

- The existing tail re-reads the `archived` marker before its first write and refuses `not-archived`. A
  child never passes through `archived`, so an unchanged tail refuses every child.
- The existing tail's resume arm does **not** re-run unsupervise and pane-kill, and its own comment says
  that is safe *only because* `ws-archive` performed both before any breadcrumb could exist. For a child
  nothing did. A resumed reclaim under that arm would purge the registry row while
  `claude-session@<id>.service` — `Restart=always` — is still alive, leaving a unit respawning forever
  against a workspace with no row: the exact out-of-band breakage CLAUDE.md forbids, produced by automation
  with no human in the path.
- The existing resume fork branches on the breadcrumb **before any eval**, calling the tail directly. Under
  a shared breadcrumb value, `not-a-child` would be overridable by the simple expedient of a crash.

Therefore:

- **Distinct breadcrumb value.** `reclaim:<phase>`, never `ws-reap`'s. A reclaim resume runs the *reclaim*
  ladder; a reap resume runs reap's. Neither verb may resume the other's interrupted work, and a mismatched
  flavour refuses.
- **The shared lock is kept** (`$REG/.reap-<id>.lock`), because reap and reclaim must never run on one
  workspace at once.
- **Unsupervise and pane-kill run first, unconditionally, on both the fresh and the resumed arm.** They are
  idempotent; running them twice costs nothing and skipping them once wedges a unit.
- **The resume arm re-asserts what authorised the act**: the marker and its `--child-of` match, and the
  pause file. A crash may not launder a refusal.

Teardown order, after the pin phase: unsupervise and kill the pane → tear down registered nested children →
remove the worktree → CAS-delete the branch → remove the clips directory under its two existing containment
re-checks → remove the per-session temp root under the same discipline → purge the registry row last. After
the box reports success, the **server** cancels the child's outstanding mail deliveries keyed on session id:
a purged registry row is what ends such a delivery today, on a horizon of tens of minutes, and this design
raises purge from a rare human ceremony to once per child, which would turn a bounded slug-recycling hazard
into a routine one.

**What the tail removes, and what it keeps (wave 6).** A pane's processes can outlive `tmux
kill-session`, and one that carries `TMPDIR=<leaf>` can recreate the temp root after the tail removed it.
Measured: a reclaimed child's leaf came back 3.7 s after `reclaim done`. So after the kill the tail waits,
for up to 15 s, until no process of this uid uses the temp root, and asks once more at the instant of removal.
The wait also ends after one ask more than four per second of its bound, so a clock stepped backwards cannot
lengthen it without limit. The bound is on the clock between asks, and each ask's own walk is bounded at 10 s,
so measured at worst the tail spends about 35 to 41 s here. A process uses the temp root when its `TMPDIR` is
at or under the leaf, its working directory is there, or it holds a file there open. A process of another
uid, or a same-uid process the kernel will not let ccd read, is skipped, as a stated limit. A probe that
could not look answers unmeasured, never "nobody". The clips and temp-root leaves go through one removal
helper. It:
- validates the id, resolves the root physically, and never uses a root that resolves to nothing or to `/`. One
  function reads that physical path whole, so a root whose physical path holds a newline is never used either: the
  helper answers unmeasured. A bare path capture would drop the newline and name a directory outside the root;
- unlinks a link or file leaf without following it;
- takes a directory leaf only when it is a real directory this uid owns, at exactly root/id (and at the
  expected device and inode when a caller names them), and whose device is its root's: a mount of another
  file system at the leaf is refused before anything is changed, and a same-file-system bind mount at it is
  not seen, as inside it (§7);
- sets the leaf's own owner bits so a mode-000 leaf can be entered, asks whether the leaf holds a checkout git
  records elsewhere (below), and only then normalises the permissions beneath it and removes it without crossing a
  file-system boundary, reading every exit code;
- proves the leaf absent.

It answers removed, refused with a reason, or unmeasured. A temp root still in use, or unmeasured, when the
wait ends, and a leaf the helper refuses or cannot measure, is kept with its witness. The exception is a temp root
the tail finds already absent: a probe that answers in use, or unmeasured (always, on Darwin), over a leaf the tail
proves absent keeps nothing, and the witness is dropped. If that absence cannot be proven, the leaf is kept and
recorded unmeasured, and its witness stays. The act completes, and its `done` row records what was kept and why.
The tail's stdout done document, on both verbs, carries the same two words as additive keys, `clipsKept` and
`tmpRootKept`: the kept word (`refused`, `unmeasured` or `in-use`), or `null` when nothing was kept. A document from
an older ccd omits both keys, and a reader treats absence as unmeasured, never as gone. Each kept reason is cut at
300 bytes of printable ASCII
and marked with a trailing "…". That is not a refusal. What the worktree removal deletes is unchanged. Every
deleting git call the tail makes
runs under the reclaim's git containment: the worktree removal, `update-ref -d` and the branch delete. So
the repository's hooks and its fsmonitor never run while it deletes. That containment first drops an
inherited `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG` and `GIT_CONFIG_COUNT`, so its own `core.hooksPath`,
`core.fsmonitor` and `status.showUntrackedFiles` pins are the only entries. Whatever selects the global or
system config file (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG_NOSYSTEM`, and `HOME` or
`XDG_CONFIG_HOME`) names this uid's own files and sits below the pins' command-line precedence; it stays a
stated residual (§7). `ws-expire` runs the same tail.

**The ownership check has three answers, and `containment-refuted` is one.** After the unit is stopped and the pane
killed, and before the tail does anything further, it asks again that the tree at the workdir is still only the
child's own (`_ws_reclaim_owned`); on a resumed arm that is the only identity check there is. The check answers 0,
own; 1, PROVEN not own; or 2, could not be asked. Only a proof is `containment-refuted`, and five shapes are one:
another session's registry row shared with the worktree, nested in it or in either leaf, or spelled through it; a
gone row's tree moved inside it; a workdir that is the main checkout or the project directory; a link or a
non-directory at the workdir; and a recorded workdir that is not one plain path. The tail prints it from its own
literal call site, journaled `failed` and never `refused`, for `ws-reclaim` and `ws-expire` alike because the tail is
shared. Everything that could not be asked stays the resumable `worktree-remove-failed`: an absence that cannot be
proven, a worktree list that cannot be read, a registry that could not be compared, a scan that failed, the
moved-tree check's own unmeasured answer, and a tree that stands with no worktree record (rung 8's rule, §5.5).
Both stop in the place the tail always stopped, with nothing further deleted, the breadcrumb standing and no later
step run, and every refusal arm keeps a non-zero status. The operator's sentence says only what is true under any
server: the session was stopped, nothing further was deleted, and a retry finds the same thing until the other tree
or row is moved or removed. Until the server gives the word a class of its own (§8, wave 8), its parsers read it as
any other resumable failure and retry it, which is safe because the resumed tail deletes nothing before this check.

**The branch delete is a compare-and-swap, and the all-zero id is no compare.** `update-ref -d --no-deref <ref>
<old>` deletes the ref only if it holds `<old>`, except that an all-zero `<old>` is no compare at all: measured on
git 2.43, it exits 0 and deletes the ref whatever it holds. So the tail rejects a forty-zero id at its two shape
checks, the tombstone's recorded tip of a branch that stands and a nested checkout's recorded head, before the
branch's compare-and-swap, and answers `branch-unmeasured`: journaled `failed`, retried, with the breadcrumb at the
same step. It stops before that compare-and-swap, and not before any delete
(`rk-stops-before-the-branch-not-before-any-delete`): a resume whose tree is already gone has by then deleted each
nested checkout's branch, after an attic pin, and cleared git's stale records of the nested checkouts and of the
child's own vanished worktree, the last even on a resume that enters at the branch step, where the earlier steps never
run. The base did the same before it deleted the child's branch unconditionally. The branch's compare-and-swap is the
one delete this check guards.
ccd never writes an all-zero tip or head, so the shape arises only from a hand-edited tombstone, and such a resume
retries `branch-unmeasured` until an operator repairs it.

**The checkout question.** Another session's tree moved into a leaf (§5.5) is what the helper asks about. It asks of
every directory leaf, after the identity checks and the owner-bits pass, and before it normalises or removes
anything. It reads no registry row, so the registry-row rule of §5.5 is not the helper's: the tail asks it at its
start, and the collector asks it itself (§5.10). The answer is clean (rc 0), refused (rc 1) or unmeasured (rc 2). Either of the
last two leaves everything under the leaf untouched, and the tail keeps and records the leaf as it keeps any other,
so the question never fails the tail. A link or file leaf is unlinked and never scanned, except when the collector
passes its alias argument (§5.10), which refuses it and leaves it standing. The owner-bits pass is the
one write before the question: it sets the owner bits of the leaf itself, never of anything under it, so a foreign
tree moved in AS the leaf has its root's owner bits set (555 reads 755 afterwards) even when it is then refused.
- **The scan.** It walks the leaf's physical path without following a link or crossing a file system, from depth 1
  (so a tree moved AS the leaf is seen), and it is bounded by the same scan limit the ladder's own scans use. A
  timeout, any error from the walk (an unreadable directory hides what is under it) and more than 64 entries named
  `.git` read unmeasured. It does not prune at a `.git` directory: a foreign tree can be parked inside a clone's
  `.git` as easily as anywhere else, so the time bound caps the walk.
- **Each `.git`** is asked without being followed, and git is never run inside a leaf. A link is refused. A
  directory, a full clone, passes. A file must be exactly one `gitdir: <path>` line of at most 4096 bytes, else it
  reads unmeasured. The admin directory it names is resolved physically, a relative path against the `.git` file's
  own directory as git does. A `..` after another component of a relative path, or any `..` in an absolute one,
  reads unmeasured. One proven absent refuses, because git no longer records the tree, and one that cannot be
  resolved is unmeasured. One inside the leaf passes: a submodule, or a worktree of a clone in the leaf. One outside
  the leaf passes only as a linked worktree whose admin `gitdir` names this `.git` back, literally or by its
  directory's physical path, and refuses otherwise. That last clause also catches a recycled admin name, where a
  later `ws-add` recreated `worktrees/<name>` for another workspace. A refusal outranks an unmeasured entry.
- **Its limits, stated.**
  - A tree stripped of its `.git`, or content that is no checkout, parked in a leaf is not seen. The base held
    these only by accident, through the blanket hold on a gone row.
  - The question and the `rm` are two looks, not one. A same-uid rename in between is removed with the leaf. The
    collector's quarantine rename closes this for a collected leaf (§5.10), and the tail keeps the window. Beside it,
    a registry row placed into a leaf after the ownership check the
    tail makes at its start is not asked again at step 6. The removal-time question and the temp root's in-use probe
    still stand, and the worktree has the same window class.
  - A clone, a submodule of one, or a worktree of one inside a leaf is the leaf's own, and goes with it. That
    includes a foreign main checkout, a `.git` directory, moved into a leaf: with no registry row naming it, it
    passes the question and is removed with its object store. This is ruled, because a clone in a leaf is the leaf's
    own. A registry row that names the moved tree's old path is a gone row, and the blanket hold on a gone row keeps
    the child unmeasured.
  - The bind-mount alias spelling of a leaf is not compared. This is the existing residual (§7).
  - On a case-insensitive file system (Darwin APFS), a hand-renamed `.GIT` that git honours is missed by the walk's
    name match. Git never writes that name.

**The witness of an absent leaf.** Only the tail and the collector remove a witness, and the tail only its own
leaf's; the collector's drop is a compare-and-drop of its own (§5.10), because the witness writer replaces the file
without a lock. The tail's witness is dropped
by a function of its own, called after the leaf's removal and, in the kept arms above, only when the leaf is proven
absent. Those arms never go through the leaf's removal itself, because its leaf half would run an unprobed `rm` on a
leaf re-created in the window. A leaf re-created between the proof that it is absent and the drop leaves a leaf with
no witness: a leak, never a loss, because the collector takes only a witnessed leaf.

**A failure printed before the breadcrumb is retried from the start.** On the fresh arm, `probe-unmeasured` and the
consent binding's `state-changed` (§5.5) are printed before the tombstone and the breadcrumb, so nothing had
started. The server reads those two words as not resumable, and its feed says the act is retried from the start, not
that the box resumes where it stopped. The consent binding's `state-changed` is printed on the fresh arm only,
because only the fresh arm runs the pin phase. `probe-unmeasured` is pre-breadcrumb on the fresh arm only: the
locked recomputation prints it on the resumed arm too, where an earlier attempt's breadcrumb stands (§7).
`pin-failed` and `tombstone-unwritable` stay resumable, because each is printed once in the pin phase, before the
breadcrumb, and also by the tail after it, so the word alone cannot tell the two apart (§7).

**`crumb`: whether a failure was printed past the breadcrumb.** The failed document carries an additive key
`crumb`, `false` before the act's breadcrumb was written and `true` once it was, which tells apart the words that are
printed both before it and after it. `ws-reclaim` sets it itself: `true` on a resumed arm, `false` on a fresh arm, and `true` from the moment its
breadcrumb is written; the shared tail sets `true` for both verbs, because every failure it prints is past a
breadcrumb. `true` says the breadcrumb was written, never that it stands now (a `purge-*` failure is printed after the
purge took it). The key is absent where whether an act had started is not known: a reclaim whose breadcrumb stands
but could not be read; `ws-expire`'s own pre-breadcrumb documents, which workspace lifecycle's locked region prints
and which carry no key; `ws-expire`'s resumed arm's `probe-unmeasured`, printed while its `expire:` breadcrumb stands
(reclaim says `crumb` true on the same arm), which carries no key either, because the code that prints it is
`_ws_expire_locked`'s and this wave leaves it alone; and every `ws-collect` document, since a collection has no breadcrumb. A reader takes
absence as unmeasured, never as either value, and a document from an older ccd omits the key in the same way. The
key rides a global that the document's printer reads, not an argument threaded through every failure printer.
`ws-audit --reclaim` already prints `resume`, and is unchanged.

**Every reason is one capped line.** The permission pass's reason carries a name the session chose and a path, and a
long or non-UTF-8 one, raw, grew at the journal's encoder until the refusal row lost its `detail`, `verb` and
`dec.*`. It is cut by the same cutter as every kept reason above: printable ASCII, 300 bytes, the cut marked with a
trailing "…". So is rung 8's reason for git's silence (§5.5), on both arms: it names an admin entry under
`<common>/worktrees/`, which git names after the basename of a worktree a session chose, and it reaches the same
journal through `ws-reclaim`'s and `ws-audit`'s `probe-unmeasured` rows. Its tokens are unchanged, and no token reads
the reason.

### 5.7 When reclaim happens

**On close.** After `closeRun` or `closeReviewRun` has committed its transaction — never before, so a failed
reclaim can never un-close a run — the child is reclaimed when all of:

- the workspace is a child (the registry verdict names a run id; `unreadable` defers), **and**
- no sibling run is open, re-read **inside the coordination mutex** immediately before the argv is composed,
  with an unreadable sibling list counting as *ineligible* rather than as "none", **and**
- the close is `final`, **or** the child is `spent` by a PR dated to it (§5.3), **or** this close retires
  the program.

The mutex is available here and only here. It is not exported and the watcher holds no handle on it, so
**the sweep cannot take it** — which is the second reason the `--expect` token exists rather than a nicety:
on the path that cannot serialise against the write routes, the only thing that can close the window is a
re-proof taken on the box, inside the lock, at the instant of deletion. The server's checks narrow the
window; ccd's re-proof is what ends it.

The last conjunct is the correction that matters most. "No open sibling" is *also* true on the ordinary
non-final close, which has just written a hold claiming the child for wave N+1 — so triggering on it alone
would reclaim a live, held, mid-program workspace: the 2026-09-10 harm through a new door. "The coordinator
has finished with this child" and "this child has no open run this instant" are different facts, and only
the first authorises destruction. An abandon (`state:'failed'`) counts as finished.

**A close that retires the program counts as finished too**, and this was found while planning rather than
designing. A non-final close with no open sibling drops the program's open-run count to zero, and the
server retires it on the spot; nothing in the HTTP API reactivates a retired program. The hold that close
writes claims the child for a wave that can never be opened, and a hold defers reclaim for ever. So for a
child, and only for a child, that close releases rather than holds, and the child is reclaimed.

**A review child is finished later than its own run.** The reviewer keeps its report in its own clips
directory and the coordinator cites that path in fix-round mail for as long as the reviewed work is open, so
a review child is not reclaimed when its review run closes. It is reclaimed once the run it reviewed is
terminal, by whichever trigger sees that first. And an archive request on an eligible child is overruled: the
close releases and reclaims instead, because an archived child would wait on a human's `ws-reap`, which
rule 4 forbids. A non-child's archive is unchanged.

**A workspace that has coordinated is a coordinator's workspace**, and rule 4 reserves manual cleanup for
those. So neither trigger reclaims a marked child that has coordinated a run in its current generation: the
close answers `has-coordinated`, and the sweep keeps the child as `coordinating` (§5.9). Slugs recycle
(§5.6), so the question is asked of this incarnation of the workspace, never of its name. A child has
coordinated when its session id holds a claim on record and any one of these is true:

- a run naming it `claimedBy` is not terminal;
- a claim has no instant that can be read: a terminal claiming run with no `closedAt`, or a stored instant
  that does not read as a time;
- its creation cannot be placed: the lifecycle journal holds no dated `create` row opening its current
  generation;
- the claim's latest instant is no earlier than 120 seconds before that creation, the skew allowed between
  the fleet box's clock and the server's.

A claim's instant is the latest of each terminal claiming run's `closedAt` and the time of every
reassignment of a dead coordinator's claim (§4) that names the id on either side: the displaced
coordinator's claim ended there, and the heir's claim on runs already terminal began there. A claim that
ended before this generation was created belonged to an earlier workspace under the same name, and keeps
nothing. That is safe because ccd journals a `create` only after refusing a slug that has any registry
entry or whose git state is taken, so a later `create` proves that the coordinator's workspace was removed
before this one existed. Every doubt keeps the child. One fence decides the question everywhere it is
asked: the close, the executor's re-read before it composes the argv, the sweep's verdict, and the sweep's
release of a finished programme's hold (below). Its residual is stated: the fence compares the fleet box's
clock with the server's, so an offset between them larger than the skew can make reclaimable a child whose
own coordination ended within that excess after its creation. That fails open, in the same direction as
the sweep's check that a child's minting run predates it (below). A lost or rebuilt coordination database
loses the claim history, but it loses every minting run with it, and the sweep then keeps every child.

**Close decides; it does not wait.** The eligibility above is decided inside the mutex, and the act —
`ws-audit --reclaim` → token → `ws-reclaim` — runs on the session's own queue immediately *after* close has
answered. That ordering is measured, not chosen: the coordinator's API client gives up after a flat
30 seconds, while `ws-reap`'s own remote budget is 240, and a close that the caller saw time out but the
server committed is worse than one that answered `queued`. The act re-reads the sibling list and the
presence signals itself before composing the argv, outside the mutex. That leaves close on exactly the
footing the sweep has always been on: the server's checks narrow the window, and the re-proof on the box,
inside the lock, is what ends it. Any failure is recorded and left to the sweep. **One executor serves both
triggers**, so presence, the ceiling and the feed row behave identically however a reclaim was started.

**On the sweep.** The close path cannot cover every case, and the cases it misses are real: dispatch has two
shipped arms that mint a child and then fail to bind it, leaving a run `planned` with no session and a
marked workspace named by no run row. A predicate written over run rows can never reach those.

So the sweep's subject is **the marker**, which already holds the minting run id. A child is eligible when:

- no open run names it (unreadable ⇒ ineligible), and
- its minting run exists, and is either terminal or bound to a **different** session — which is how the
  orphans above are reached: their run was re-dispatched and names the child that did get bound — and
  is not a `planned` run whose dispatch started less than one spawn-stall interval ago, and
- no hold, no presence signal, no in-flight dispatch window, and
- `reclaim-paused` is absent, and
- every one of the above held on the **previous** pass too — the 2026-08-11 policy's twice-observed rule,
  kept verbatim.

**A minting run absent from the database makes a child ineligible**, not eligible. The first draft of this
section said the opposite, and it fails open in the one case that matters: a lost or rebuilt coordination
database makes *every* child's run absent at once, the live ones included. Absence is logged and
skipped; the orphans that motivated it are reached through the bullet above instead. Two more answers leave
a child alone for the same reason. Run ids restart when the database is rebuilt, so a minting run that opened
more than 120 seconds after the child was created (the dated `create` row opening its current generation
in the lifecycle journal) cannot be the run that made it; a fleet box whose clock runs behind the server's
gives the same answer. And a child whose creation the journal does not date cannot be matched to its run
at all. The first of these two is kept, never reclaimed automatically, and reported (§5.9). The second,
`child-birth-unplaced`, is doubt, not a keep: the sweep looks for the creation again on its next pass, and
the child reads `deferred` meanwhile (§5.9).

**A programme's own hold ends with the programme.** The close holds a child it cannot prove finished
(§5.3), and no later close decides a child an earlier run minted, so "no hold" alone would keep such a
child for ever, against rule 1. A hold therefore stops protecting a marked child when its text is the
server's own rendering of a terminal run that names the child (a dispatch's claim, or a non-final
close's), that run's programme has no open run, the minting run is terminal, no open run names the child,
and the child has not coordinated in its current generation (above). The text is compared, never parsed,
so a person's hold is never released, even one written in a programme's grammar, and neither is one that
cannot be read. The sweep releases such a hold in its own job, which re-reads everything first and deletes
nothing but the hold, and the child is judged afresh on the passes after.

The lane runs on a pass that already reads the registry, so it costs one predicate rather than a new timer;
the plan names which pass, under the constraint that it must not race the write routes.

**Presence, and its bound.** The defer is a union of the two signals that exist, each measured where it
lives:

- **On the box, by ccd:** a tmux client attached to the session. ccd already shells `tmux` locally, so this
  rung needs no new grant; the server could not ask this question without one, since `list-clients` is not
  on the agent's tmux grant today.
- **On the server, before the argv is composed:** the existing per-session visibility claim — "which
  sessions a human is currently looking at" — keyed per connection and expiring on a TTL.

Measuring tmux alone would be useless: the PWA's ordinary chat surface attaches no tmux client, so the human
most likely to be at a child would register nothing, which is the 2026-09-10 insufficiency exactly. The
visibility claim is the signal that sees them — and its honest limits are stated rather than assumed. It is
**client-declared**, so a client that stops re-stating it goes quiet; it is **not persisted**, so a restarted
server correctly believes nobody is watching; and there is **no durable per-session "last interaction"
timestamp anywhere in the tree** to fall back on. For notifications its expiry direction is fail-shut; for
reclamation the same expiry is fail-open, and what compensates is the population (rule 4 says nobody is
there), the twice-observed rule, and ccd's independent tmux rung.

The defer is **bounded**: after a ceiling of **15 minutes** of continuous deferral the reclaim proceeds, and
the feed row says how long it waited and why. Proceeding past a defer ccd measures on the box takes a flag,
`--defer-expired`, on both the audit and the verb. It skips rungs 5 and 6 and nothing else, and it is an
input to the fingerprint, so a token minted without it cannot be spent with it. It is not an override of a
safety rung: rungs 5 and 6 measure presence, not containment, and the pin phase still takes the in-progress
operation heads. Unbounded would be worse than absent: the PWA's terminal
drawer opens a real `tmux attach`, so a phone that locks with the drawer open would wedge a child forever,
and the only exit would be a human detaching from a sub-workspace — rule 4 inverted by its own safeguard.

**Continuous means observed.** A child that is not asked writes nothing, so time nobody measured never
counts as presence. Each presence-class answer (the server's visibility claim, or ccd's `attached` or
`tree-busy`) brackets its observation between the request that asked and its own arrival. An episode starts
at its first answer's arrival. The next answer continues it only if it arrives within two and a half pass
intervals of the previous answer's request; otherwise the episode restarts at that arrival. The ceiling
licenses one `--defer-expired` ask once the episode has spanned 15 minutes and its latest answer's request
is that recent. A licensed answer, any other outcome, and a request that fails without an answer each end
or restart the episode, so one episode licenses at most once. None of this licenses an ask earlier, or
more often, than the ceiling would for a lone child.

**Two clocks.** The clocks the sweep keeps for its own decisions (its pacing, and each child's episode and
place in line) are the server's monotonic clock, which never steps and stops while the box is suspended;
stamps it compares with another process's stay on the wall clock. Each gap is read as the larger of the
monotonic and the wall-clock difference, so a suspended box and a backward wall step each read as a hole,
never as continuity, and a forward step over-reads and restarts the episode, which fails closed. The
ceiling's span is read on the monotonic clock alone, which never over-reads. A suspend and a backward wall
step inside the same gap under-read both clocks; that residual is stated, not closed. Of the times the
sweep keeps, the one it displays is a child's first deferral, which stays wall-clock: the chip's time and
the wait a feed row states (§5.9).

**The lease.** The sweep asks one child at a time. Asked in turn, three or more due children that kept
deferring kept every presence-held child's episode broken, so none was ever licensed: the unbounded wait
this section forbids. So a presence-held child joins a line at its first unlicensed presence answer, and
the due child longest in that line holds a lease. It is asked first, on every pass it is due, exactly as a
lone child is, and every other due child follows in the fairness order (never asked first, then least
recently asked). The order adds no ask and relaxes no pacing. Its cost is stated: while a lease runs no
other due child is asked, so a backlog drain pauses for one lease per presence-held child.

**The lease's tenure is bounded.** A holder whose answer does not continue its episode, or whose request
fails without an answer or stalls, forfeits the lease and re-joins the line at the back; a child waiting
in line keeps its place. So a breach of the timing costs one lease, never the lane, and licenses nothing a
continuous episode did not earn.

**The bound, as three figures that are never added together.** C is the 15-minute ceiling; S the largest
spacing between two passes, measured at up to 80 seconds on 2026-10-05; G the gap of two and a half pass
intervals, 150 seconds; STALL the 480 seconds after which an unanswered request stops holding the one
slot; L_p and L_r the largest latencies of a presence answer and of a reclaim.

- From its lease's first ask, a holder is licensed within C + S + L_p, about 16.5 minutes at that spacing.
- One lease, from its first ask to the next lease's first ask, takes at most C + 2S + L_p + L_r, about
  18.6 minutes.
- The k-th presence-held child in the ask order is licensed within k × (C + 2G + STALL), k × 28 minutes:
  the worst case the timing allows.

They hold while a pass plus a presence answer stays within G, an answer settles before the next pass,
neither clock steps nor the box suspends during the lease, each child in the line stays eligible and keeps
answering presence until it is licensed, and the sweep's memory is not cleared. A raised
switch, a missing capability, a failed read and a restart clear it, and every episode and lease then starts
again. A violation forfeits the lease and fails closed: on a box so slow that a pass and an answer exceed
G, no presence-held child is licensed, as no lone child would be, and every other due child is still
asked. And that memory holds one workspace generation per child: a slug minted again is a new child,
sighted afresh.

**Presence never authorises deletion.** `--defer-expired` changes the fingerprint and skips the presence
rungs. It never skips the ownership comparison with other rows (§5.5, D-3731). The converse holds too: no
liveness reading makes a projected row placeable, whether its session is up, gone, or tmux cannot be asked. A
session reported gone may still have processes whose cwd is inside the child, and a live one exposes nothing
that ccd could check against a removed alias. Presence defers. Only a complete resolution places a row, and even
that places its spelling, not its session (D-3735).

### 5.8 The kill-switch

`$REG/reclaim-paused`, raised and lowered by `ccd reclaim-pause --state on|off`, a copy of the existing
coordinator-pause verb in every respect: non-destructive, idempotent, checked on both arms, its echoed word
parsed by nothing.

It is driven by `POST /api/coord/reclaim-pause`, session-gated with no box token, registered beside the
existing pause route so the route censuses harvest it, and surfaced on the Runs screen in the existing
pause banner's shape: rendered only once a frame has arrived, non-optimistic, with inline refusal text.

**Four readers, and the fourth is the one that matters.** The sweep skips; the close path skips; the PWA
renders. And `ws-reclaim` itself reads it — in the eval ladder and again on resume — because a gate
evaluated only by the server fails open into deletion when the pause lands mid-flight, when the server's
snapshot is one tick stale, or when a crashed reclaim resumes. ccd already states this rule for its own
destructive verb: every guard is evaluated on the box, at the instant of deletion.

Default: running. Pausing stops reclamation fleet-wide, and — since workspace lifecycle wave 3b — the expiry of archived
workspaces too, and — since wave 4 — the dead-coordinator lane: it is the fleet's one cleanup switch (`2026-09-24-workspace-lifecycle-design.md` §5.3). Nothing else;
unpausing drains what queued.

### 5.9 What the operator sees

**The durable record is ccd's lifecycle journal**, which is written where the registry purge cannot reach it
and is already readable per session after the workspace is gone. A new act, `reclaim`, joins its vocabulary
(§6 lists every site that declaration touches).

**One feed row per outcome, unless it repeats one** — reclaimed, deferred with its elapsed time, refused or
failed with its sentence — written explicitly by the lane. This is stated because it does not come for free:
a reclaim on an already-closed run is an observation rather than a transition, and the existing event path
deliberately skips observations, so a design that assumed a feed row would have delivered none while
promising all. A row that repeats what the feed already says is not written. A deferral for any reason but
presence writes one row per episode, not one per pass. A failure the attention item already lists writes
no further row until its word changes or it leaves the list. A presence deferral writes its row on every
pass, and an attempt the ceiling licensed always writes, because its row states the wait it ended. A child
the sweep keeps for a person (below) writes one `child reclaim kept` row per word, once in each server
process.

**A chip on the closed run's row**, reading the lifecycle mirror rather than the registry row that no longer
exists, and the sweep's last verdict on a child that still stands: reclaimed, pending, deferred, paused, or
refused with the sentence. Refusal sentences come from a
lookup keyed by the refusal token, never respelled at the surface — **and the lookup is the server's**. The
PWA-reachable refusal words and the server's audit sentences are held disjoint by a test today, and several
of this verb's tokens share names with the audit's. So the server composes the sentence and ships it with
the status; the PWA renders what it is given and maps no token itself. A reclaimed child's row stops
offering to open its session, which no longer exists. The board re-reads the run archive when a finished
child leaves the fleet frame. It re-reads again whenever the newest reclaim `done` the server's journal
mirror has ingested changes, while some finished row's chip is still unsettled; that value rides the
coordination frame and is omitted until there is one. A child leaving the registry listing also brings
the mirror's next sweep forward, and the tick does not wait for it. Each re-read follows one measured fact,
so it is not a polling cadence. The board keeps the newest read it has applied, so a read older than the newest
one applied changes nothing, whether it lands or fails. A failure never advances that mark, so an older success
still lands after a newer failure: it is the freshest answer there is. A board mounted after its child left,
whose first read lands between the registry purge and the journal's `done`, keeps a null chip until its next
load.

**The chip says why the sweep leaves a child alone.** The sweep keeps each marked child's last verdict in
memory. A reclaim that happened, ccd's word that the session is already gone, and a terminal refusal ccd
recorded are settled, and answer first. A verdict that keeps the child, holds it, or could not judge it
answers next, ahead of every other event, a retryable refusal or a failure among them, because an older
answer must not promise a retry the sweep will not make.

- A child the sweep keeps for a person reads `refused`, with a sentence that says why and ends "ccrc never
  reclaims it on its own; a person removes it once nothing still needs it." The kept words are
  `coordinating` (§5.7), `minting-run-absent`, `minting-run-postdates-child`,
  `reviewed-run-absent`, and `not-a-workspace`, a project's main checkout carrying a marker. The two
  minting-run sentences add "After a rebuild, workers may still be running in these." before that ending,
  and the main checkout's ends by telling a person to remove the marker, never the checkout. The switch
  never replaces a kept answer: a pause leaves it standing, because the attention item keeps listing the
  child.
- A child the sweep could not judge because a read failed (`marker-unreadable`, `identity-unmeasured`,
  `hold-unmeasured`, `minting-run-unreadable`, `reviewed-run-unreadable`, `siblings-unreadable`), or
  because the lifecycle journal holds no dated creation of its workspace (`child-birth-unplaced`), reads
  `deferred`, with a sentence naming the read and saying the sweep reads it again on its next pass. A held
  child, under a person's hold or a programme's while that programme is open, reads `deferred` with the
  hold's sentence. The switch turns both to `paused`.
- Where nothing else answers, a child with no verdict yet reads `pending` with a sentence of its own, never
  the one that says it is waiting to be reclaimed, and the switch turns it to `paused`. That is every child
  after a restart until the first judging pass, and every child but the kept ones after a pass that judged
  nothing (the switch raised, a capability missing, a read failed).
- The four pre-lock refusals the attention item reads as failures (below) read `deferred` on the chip too.

There is no sixth word: the chip keeps its five.

**No child appears in the reap or archive sheets unless a person archived it by hand.** Every session offers
Archive (workspace lifecycle §5.2), so a child can be archived like any workspace; "Archive all" skips children
(workspace lifecycle §5.1, §6 item 3).

**One fleet-level attention item** collects children under a terminal refusal, children whose reclaim
has kept failing past the defer ceiling (retries back off in between), and children the sweep keeps for a
person, with each one's sentence. A failure includes the four refusals ccd journals before it takes the
reclaim's lock. Two are written when it cannot take the lock (`flock-unavailable` and `lock-unopenable`),
and two when the server's argv carries a malformed token or run id beside a valid session id
(`token-malformed` and `run-id-malformed`). ccd records them as refusals, but the server retries them, so
every surface reads them as failures and never as settled refusals. Only those four are read that way, by
name; a refusal ccd later journals the same way is classified when it is added, never
inherited. ccd also journals three failures as `failed`. The first is a probe that could not measure
(`probe-unmeasured`), from the locked recomputation and from `ws-audit --reclaim`, told apart by the line's
verb; it is the one audit-time line that is not a terminal refusal. The second is a tail that could not read
whether the branch still exists (`branch-unmeasured`). The third is a pin that read the branch in a different
state from the in-lock recomputation (`state-changed`, §5.5), which stops the act before the tombstone.
Seven dies stay unjournaled: the usage die and
the four `--actor`/`--reason` checks run before any id is bound, a malformed session id binds no
trustworthy id, and the journal's encoder is the `python3` whose absence the last reports.
It is a *report*, not a tap: nothing waits on it, and ignoring it costs disk rather than correctness. It
lives in the reclaim row of the Runs screen's banner, beside the pause toggle, carried on the coordination
frame. On every sweep pass its terminal and failing children are
derived from the lifecycle mirror so a restart does not lose it. Its kept children come from the sweep's
last judging pass, which reads only durable state (the registry listing, the coordination database and the
mirror); they stay listed across a pass that judged nothing, a paused one included, and a restart lists
them again at its first judging pass. A child has one item: a kept item replaces a failing one, and a
terminal item stands, with no kept item beside it. More than five children answering one kept word, which
is what a lost or rebuilt coordination database produces, render as one line with the count and the list
behind it. A failed read never lists a child by itself. A child whose last verdict is a hold is not listed
for a failure, though its terminal item stands; with no verdict recorded, a failing child is listed as before.
It is **not** a divergence pattern: nothing in the PWA reads divergences today, so one there would be a
report nobody receives.

### 5.10 The temp-root collector

`ws-collect` takes back a child's temp root, `$HOME/.cc-tmp/<id>`, that nobody owns any more: the reclaim tail kept
it (§5.6), or a human verb left it, and the row that named it is gone. It is a sibling of `ws-reclaim` and
`ws-expire`, never a flag on either, because rung 2's `.child` marker is gone for this population and the only
evidence left is the positive witness (§5.2). Its audit is `ws-audit --session <id> --collect`, which rides the
granted `['ws-audit','--session']` prefix and mints the token; the verb is granted on `['ws-collect','--expect']`
alone, and ccd advertises the pair on its caps line: the token `collect-v1`, which the server reads with the
capability reader, and the verb. It is the server's act and no session's (CLAUDE.md). Wave 7 ships it inert: the grant, the declarations, the runner
budget row of 240 seconds and a builder that nothing calls, with a scan pinning that no server source composes it
until wave 9's lane does (§8).

**The population** is every witnessed id, a name that passes the witness's id grammar with `$REG/tmproots/<id>`
standing, plus every quarantine record, `$REG/tmpquarantine/<id>.<ns>.<pid>`. `tmpquarantine/` is a dotless
registry subdirectory on the `pools/` and `tmproots/` precedent, so `_reg_purge`, `_ws_slug_free`, `ccd ls` and the
server's registry read never see it and a record outlives the row it was never part of. A record's id is parsed
exactly: its name less its two trailing all-digit dot-fields, never an `<id>.*` prefix, because ids admit dots and a
nested project's id is not its parent's. An id outside the population answers `not-witnessed`, and neither the audit
nor the verb takes a lock for a name outside it. A `tmproots/` that is itself a link puts no id in the population
and is never followed; whether an id is in it is then unmeasured. "No witness" is a measurement, never a failed
test: a witness whose absence cannot be proven (a `tmproots/` this process cannot search) is unmeasured too, at the
audit and, before any lock, at the verb, never `not-witnessed`. Unwitnessed leaves are never touched: every leaf
made before the witness shipped, and every row-less leaf that has no witness. They are the operator's, as
are the kept clips leaves (§5.2), for which no clips witness is planned. **The collector never takes a
non-directory.** The tail unlinks a link or file leaf (§5.2); the collector does not. A link, a file or any other
directory at the id is not the one its witness names, and is refused and offered to the operator.

**The candidate rules, and which are ccd's and which the lane's.** ccd checks these at the audit, and again inside
the lock before anything moves:

| Rule | Where it is read |
|---|---|
| no registry row stands for the id: `.child` and `.uuid` by direct lookup, and the slug free behind a listing control | `ws-audit --collect`, again in the verb |
| the witness matches the leaf's device, inode and birth time; a birth time of `-` and an unreadable witness are never taken | likewise |
| the idle floor holds (below) | likewise |
| the in-use probe (§5.6) answers nobody | likewise |
| the checkout question (§5.6) answers clean | likewise |
| no registry row lies at, inside or through the leaf, and the id has no row of its own | likewise |
| reclamation is not paused | the audit last, so a pause stops the act and not the measurement; the verb first, inside the lock |

The server's lane (wave 9) owns the rest, and is stated here as the design it is built to: it finds its population
by listing `<registryDir>/tmproots` and `<registryDir>/tmpquarantine`, never `~/.cc-tmp`; it drops dot-leading
names; it resolves a null listing by a measured stat, so that only a proven absence is empty; it acts only after
two observations of one unchanged token, at least one sweep interval apart on its own monotonic clock, keyed by the
id and the token; and it runs under `reclaim-pause` and the sweep's pacing.

**The registry-row rule is asked by the collector itself.** The removal helper does not carry it (§5.6). It is the
question §5.5 asks of a leaf, in one registry pass with the leaf as the workdir: every row, standing or placed by
either gone-row arm, compared literally and resolved, at, inside or through the leaf. An unlistable registry, or a
row that cannot be placed, answers unmeasured. The collector's rule differs from the tail's in two ways, both
fail-closed: it also asks the id's own row first, by its `.workdir`, so that a temp root whose id has a row is never
collected, and it also compares the id's clips leaf, so that a row there refuses. Without the rule a stopped session's
clone inside a dead child's temp root is deleted with the leaf.

**The audit's answer.** Under `$REG/.reap-<id>.lock`, taken without waiting, the audit prints one document and runs
the fresh rungs in order, the first that does not pass ending it: `registered`; `not-witnessed`; for a witnessed id
whose leaf is absent, the witness-only arm below; for a present leaf, the quarantine question (unmeasured
`quarantine`, below), the refusal `quarantine-kept` while any slot of the id stands with no record naming it
(`fresh-collect-refuses-beside-a-standing-slot`: a fresh collection is never made beside such a slot, and the witness
stays; a slot listing that fails is unmeasured `quarantine`, and a nested id's slot is not counted), then
`witness-mismatch` (the witness unreadable, without a birth time, or not the real directory at the id by device, inode
and birth time); the leaf's owner write (unmeasured `mode`, `audit-asks-owner-write`: a leaf whose own mode lacks
owner write cannot be renamed to another parent, so the audit licenses no move, no `failed` row is journaled per pass,
and the leaf stays listed; the collector never changes a leaf's mode, and the token binds it through the change time);
the idle walk; the floor, `changed-recently`; `in-use`; the checkout question and the row rule, both
`containment-unproven`; `paused`; and the token. Terminal words are `witness-mismatch`, `quarantine-kept` and
`containment-unproven`, and only they are journaled, act `collect`, verb `ws-audit`: the lane audits every pass,
and a retryable word a pass would bury the journal. `registered`, `not-witnessed`, `changed-recently`, `in-use`,
`paused` and `in-progress` (the lock held by another ccd process) are retryable and unjournaled. A probe that
cannot answer ends the audit at its rung as `unmeasured`: the document names the probe and exits 1, which the
server reads as a failed audit and retries, and nothing is journaled. A witness whose leaf is proven absent, with
no quarantine record and no quarantine slot of the id, is collectable at once, under a token of its own, once the
physical `~/.cc-tmp` is shown to be on the device the witness carries
(`collect-absence-needs-the-recorded-device`): the device is asked first on this arm, and a mismatch, a device that
cannot be read, or a `~/.cc-tmp` that cannot be resolved, one proven absent included, answers unmeasured `device` and
drops nothing, so an empty mount point is never read as the leaf's absence. The verb then drops the witness and
nothing else, and makes no quarantine, record or slot for a leaf that is not there. A witnessed id whose leaf is
absent while any of its quarantine slots stands, with no record naming it, is refused `quarantine-kept` and its
witness stays, and so is a witnessed id whose leaf is present beside such a slot (above): the collector's own arms
never orphan a slot in silence. The reclaim tail's own witness drop is not one of them: `_ws_tmproot_remove` still
drops the witness of an id whose recordless slot stands (stated residual `tail-drop-ignores-a-recordless-slot`), and
still drops one whose leaf is absent without asking the device (stated residual `tail-drop-believes-an-absent-leaf`);
both are carried to wave 9's pre-flight list.

**The token** is `ws-audit --collect`'s consent, in the reclaim token's encoding, with `mode=collect` first so that
it never equals a reclaim, an expiry or a resume token. It binds the id, the witness's device, inode, birth time,
run and write time, the newest change time in nanoseconds and the entry count. Any change under the leaf stamps a
change time, and a re-witness changes the run or the time, so either mints another token. An input that was not
measured mints nothing. The witness-only token, `mode=collect-absent`, binds the witness alone. A resume token,
`mode=collect-resume`, binds the id, the record's name, the phase read off the disk, the slot, the record's device,
inode, birth time, run and time, the token the record was written under, and the record's `checkouts=` list, which
the removal is handed as the checkouts it accepts, so a record whose list changed is another consent. The witness is
not an input of a resume, because the record is its authority.

**The idle floor** is the newest change time, in nanoseconds, over every entry under the leaf, the leaf included,
and it must be at least `max(86400, knob)` seconds old, where the knob (`WS_COLLECT_IDLE_FLOOR_S`) only raises the
floor. Only the change time is read. The modification time is user-settable, so a future one would hold a leaf for
ever, and every change that moves it stamps the change time too. A non-empty knob that is not a whole number is not
folded to 24 hours: a fresh audit answers unmeasured, naming the knob, and prints no floor (a resume asks no floor: it
prints `floorS: null` and decides nothing from it). A whole number of ten or more significant digits is clamped to
999999999 (`floor-knob-reads-its-value-before-the-clamp`): the knob's leading zeros are stripped first and an all-zero
knob reads 0, the clamp is asked of the length of what is left, and only then is the value compared, so `0000000001`
is the 86400 minimum and arithmetic never sees more than nine digits. The walk is GNU `find -P <leaf> -xdev -printf %C@` under `LC_ALL=C`: it never
follows a link and never crosses a file system, and it writes nothing inside the leaf before the comparison, so no
permission pass runs first. Its one write is the stderr scratch file it makes under `$TMPDIR`; a `$TMPDIR` inside the
leaf is written there, and that fails closed, because the leaf then reads busy. It is bounded by `WS_COLLECT_IDLE_SCAN_S`, 30 seconds, and a cap of 2,000,000 entries;
the largest live leaf, 76,915 entries, walked in at most 4.8 seconds warm. A timeout, an unreadable entry, the cap
and a walk that printed no change time each answer unmeasured, naming which, and the leaf is retried. With the
in-use probe's 10 seconds and the checkout scan's 30, the audit spends at most 70 seconds plus the row pass, inside
`ws-audit`'s 90 second runner budget. Each bounded probe adds its own TERM-to-KILL grace, 3 seconds by default and
at most 8, so the worst case is about 79 seconds, and 94 at the widest grace, against the same 90 seconds; a runner
that kills the audit gets no document, which the server reads as a failed audit and retries, so it fails closed.
A budget keyed on the mode is wave 9's.

**The steps and the record order.** `ws-collect --expect <token> --session <id>` runs everything below under
`$REG/.reap-<id>.lock`, the lock every verb that removes anything of the id takes; held by another process, it
refuses `in-progress`. The pause is read first, inside the lock, and stops a fresh collection, a resume and a
witness-only drop alike.

1. **Recompute and compare.** The one evaluation the audit runs is run again here, and its token compared with
   `--expect`; any difference refuses `state-changed` and nothing moves. The move re-stamps the leaf's change time
   (measured on ext4: the inode, birth time and modification time are kept; the change time is not), so neither the
   floor nor the tree's token is ever asked after the move, and a leaf moved back waits a fresh floor.
2. **lstat the leaf.** It must be a real directory with the witness's device, inode and birth time. A link, a file or
   a different directory is refused `witness-mismatch` and left standing. A leaf gone at this lstat, after the
   evaluation saw it, is a retry: `state-changed`, never `witness-mismatch`, and the next audit takes the
   witness-without-leaf arm. Only something else standing at the id is a mismatch.
3. **The checkout question, the record and the slot.** The checkout question (§5.6) is asked of the original path,
   and anything but clean stops here and moves nothing; each outside admin directory it let pass by back-link is kept,
   with its back-link value, for the record. Then the record is written, a temp file renamed into place and read
   back, so a failed write stops the verb before the move; then the slot is made by an exclusive `mkdir`.
4. **Move the leaf into the slot.** One rename, proven by an lstat (below).
5. **Re-prove after the move.** Below. Any doubt moves the leaf back.
6. **Remove the slot's leaf** through the removal helper (§5.6), handed the witness's device and inode and the
   alias (below), and inheriting its checkout question.

Then the order, from the slot's leaf proven gone: remove the empty slot by `rmdir`, never a recursive remove; compare
and drop the witness; remove the witness writer's dead temp files of the id; and drop the record LAST. A crash at
any point leaves the record, and the next audit of that id visits it whatever the witness says by then: rewritten by
a recycled spawn, dropped by a later tail, or absent. The lifecycle journal records the intent and the outcome and
binds nothing; ccd has no journal reader, and the journal never gates an act.

**Why a rename.** A recycled slug's spawn hands out `$HOME/.cc-tmp/<id>` with `mkdir -p`, which adopts whatever
stands there and takes no lock this verb takes. But every hand-out goes through one function, `_child_tmpdir`, which
has one call site and reads `.child` before its `mkdir`; the marker has one writer; and a scan pins all three, so a
spawn before the move is seen by step 5's direct lookup, a spawn after it gets a new inode from `mkdir -p`, and
step 6 removes only the slot's inode, checked by device and inode. The witness binds birth time in whole seconds, and
birth time is never the only guard of a race case.

**The quarantine, the slot and the move.** The quarantine is `<physical ~/.cc-tmp>/.ccd-quarantine`, on the leaf's
own file system so that a rename never crosses one: a real directory of this uid at mode 0700, made by the verb alone,
by `mkdir -m 0700` when it is proven absent and then `chmod g-s` on the directory that call made, and anything else
answers unmeasured. The `chmod g-s` departs from a plain `mkdir -m 0700` (`quarantine-made-without-setgid`): on a
setgid `~/.cc-tmp` the bare `mkdir` is born 2700, which the mode check refuses for ever. A quarantine that already
stands at 2700 stays unmeasured and is the operator's to fix, and a `mkdir` lost to another maker is never chmod-ed.
The audit and the resume's audit ask the same question read-only (`audit-asks-the-quarantine-question`): a real
directory, not a link, of this uid, at mode exactly 0700, or PROVEN absent. They make and write nothing, so an audit
with no quarantine leaves none behind and still mints its token, and a link, a non-directory, another uid's directory,
any other mode or an absence that cannot be proven exits 1 unmeasured, naming `quarantine`. A slot is `slot.<id>.<ns>.<pid>`
inside it; the `slot.` prefix keeps it clear of any rule keyed on a leaf's own name (the box's `cdk-out-sweep`
matches `cdk.out*` at that depth), and a slot name that already stands is never reused. The move is `mv -T -n
--no-copy`, one `renameat2(RENAME_NOREPLACE)`, inline in the collector's Linux-only region and never a shared
platform helper. The proof of the move is an lstat, never `mv`'s exit code, whose answer on a skip changed in
coreutils 9.2: the slot's `leaf` is the witnessed directory, with its device, inode and birth time, and nothing
stands at the original path. A box whose `mv` lacks `--no-copy` answers unmeasured, because without it a rename
across file systems becomes a copy; with it a cross-device rename fails and reads as not moved. The identity of the
source is asked BEFORE the rename, so anything swapped in at the id after step 2 is refused before it reaches a
slot: the empty slot is cleared and the answer is `probe-unmeasured`, with the object untouched. Whatever reaches a
slot through the window inside the rename itself is not provably the witnessed leaf, and is kept there with its
record, `quarantine-kept`, never moved back and never unlinked.

**The re-proof, the restore and its lstat proof.** After the move the verb asks, in this order: the registry again,
`.child` and `.uuid` by direct lookup and the slug free behind the listing control, because a registry that can be
searched but not listed makes every glob come back empty and `_ws_slug_free` then answers free over a standing row
(measured); the in-use probe on both spellings, the original, which is what `TMPDIR` names, and the slot's leaf;
the registry-row rule on the pre-move spelling, compared literally though nothing stands there now; that
`/proc/self/mountinfo` lists no mount point at or under the slot's leaf; and, last, that the slot's leaf is still
the witnessed directory, so that the removal runs directly after an lstat of it in the same lock. Any doubt moves the
leaf back by the same rename reversed. The restore is proven by an lstat: the original path holds the record's
device and inode again and the slot's leaf is gone, after which the empty slot is removed and the record dropped. A
doubt about the registry, the probe or the rows is then answered by its own word, `registered`, `in-use` or
`containment-unproven`; one that could not be asked, a mount among them, is `probe-unmeasured`; and in each the
leaf is back where it was. If the restore is not proven, the record and the slot are kept, listed for the operator,
and nothing in them is removed. If the original path was taken again since the move, the restore refuses
(`quarantine-kept`, terminal for as long as the path stays taken). A slot's leaf that is not the witnessed directory
is never moved back to the id: it is kept. What the answer is depends on what was measured. A slot leaf PROVEN to be
something else, a non-directory, a link or another identity, is `refused` `quarantine-kept`, terminal and the
operator's, with the record and the slot kept. One whose identity cannot be measured is the retryable `failed`
`quarantine-kept`. A leaf that vanished from its slot is nothing to move back or remove,
and is a retry, `probe-unmeasured`, with the record and slot standing.

**Resume from the record.** A resume never recomputes the tree's token or the floor, because the move stamped the
change time. Its authority is the record, and the phase is read off the disk, never off the journal: `moved`, the
record's directory stands in its slot and nothing stands at the id; `unmoved`, it stands at the id and the slot holds
nothing; `removed`, it stands at neither. A `moved` resume re-proves the slot's leaf against the record and then runs
step 5 and the rest; an `unmoved` one clears the empty slot and the record, keeps the witness and refuses
`state-changed`, so that the leaf is audited afresh; a `removed` one finishes the order from the slot's `rmdir`. A
`removed` phase is believed only while the physical `~/.cc-tmp`'s device equals the record's `dev=`; on a mismatch, or
a device that cannot be read, the answer is unmeasured `device` and nothing is dropped
(`collect-absence-needs-the-recorded-device`), while `moved` and `unmoved` never ask it. A
slot that holds anything the collector did not put there, a slot leaf that is not the record's directory, several
records for one id, and a directory that stands both in its slot and at the id are `quarantine-kept`: a forged slot
or record fails one of these and is listed, never taken. A record whose leaf stands in its slot, and whose original path is retaken, answers
`quarantine-kept` for as long as it is retaken, read off the disk, so it clears once the path is free again, and the
next pass resumes from the record with every re-proof. The registry is asked only after the phase, because a retake
usually brings a row whose retryable `registered` would otherwise hide it. A record that vanishes between the
evaluation and the verb, inside the lock, is a retry, `state-changed`: only an actor that does not take the lock
removes one, and the next audit reads the id afresh.

**The quarantine record** is one line, `v=1 id=<id> dev= ino= btime= run= at= token=<64 hex> checkouts=<list>`, of at
most 65,536 bytes. It shares the witness's trust note: it is same-uid writable, and guards against ccd's own crash
and a recycled id, never a hostile session. It names no slot path; the `checkouts=` list's encoded admin and back-link
paths are the one kind of path it carries. The slot is derived from the record's name and the
physical quarantine, so that a space in a path never splits a field, and the `checkouts=` list holds the accepted
admin directories and back-links, each side percent-encoded. The reader has four readings, never an overloaded one:
parsed; absent, proven; malformed, which is a record that is a link or a directory, has a name or body that does not
parse, names an `id=` that is not its name's id, or carries a bad `checkouts=` encoding, and is kept for the operator
as `quarantine-kept`; and unmeasured, when the physical `~/.cc-tmp` cannot be resolved, so that the slot cannot be
derived, or whether the record stands was never measured, which is retried and never kept. Kept records have an owner,
the operator, told on every audit and never in silence; no session acts on one.

**The checkout question across the move.** Inside the lock and before the move, the collector asks the question of the
original path. After the move, the removal helper and the question take the same additive alias argument, passed only
by the collector: the leaf's physical pre-move spelling and the accepted list from the record. Under it a back-link
that names the pre-move spelling counts as the leaf's own only when both hold: the same admin directory, with the
same back-link value, was accepted by the pre-move question, in the lock that wrote the record, and is carried by the
record (on a resume it reaches the removal under the resume token that binds that list); and nothing stands at the
pre-move spelling now, proven absent. Any other outside back-link refuses while the leaf is in its slot, as it does
with no alias, because a recycled admin name otherwise passes and deletes a moved foreign worktree's uncommitted work
(measured). That refusal ends at the putback: once the restore puts the leaf back at its original path there is no
alias, and the un-aliased rule decides, as it did before this wave, so a later worktree that recycled the admin name and
whose back-link names the restored `.git` passes it. The rule is shared with the reclaim tail and the wave adds no
deletion class; it is a stated residual (`alias-refusal-ends-at-the-putback`), carried to the path-identity
programme. A linked worktree of a clone that is
itself in the leaf names its git directory absolutely, by the pre-move spelling. It is read at the leaf's new place
only while nothing stands again at that spelling, proven absent, and the inside-the-leaf rule then answers for it as
the pre-move question did, with no accepted pair needed; so a leaf holding a clone and a worktree of it is collected
rather than refused for ever. An alias handed without the expected device and inode is unmeasured, because it speaks only for the
one recorded leaf. With an alias, a non-directory at the leaf is refused and left standing, never unlinked. Every
other caller is unchanged.

**Compare-and-drop of the witness.** The tail's plain unlink (§5.6) is not used. The witness writer replaces the file
with an unlocked temp file and a `mv -f`, so reading and then unlinking the live name can delete a recycled spawn's
fresh witness. The collector moves the live name aside, by one no-replace rename, to a dot-leading name no reader
takes for an id; reads the moved copy; unlinks it only if it is, field for field, the witness this collection acted
on; and otherwise moves it back. The witness writer's dead temp files, `tmproots/.<id>.<pid>.<rand>.tmp`, are removed
under the id's lock while the slug reads free: only a name that matches that shape exactly, with the id matched
literally and two all-digit fields, and only when its modification time is at least an hour old. A temp file of an id
with neither a witness nor a quarantine record is never visited.

**The unmeasured answers, Darwin included.** The collector is Linux-first. On Darwin the audit answers unmeasured
before it reads anything, the verb never renames, and the idle walk's GNU `find` has no Darwin spelling; the same
holds on a box whose `mv` has no `--no-copy`, and where `flock` is unavailable. Also unmeasured, and retried: a
`tmproots/` that is a link; quarantine records that cannot be listed; a registry that cannot be listed or a row that
cannot be placed; a floor knob that is not a number (on a fresh audit; a resume asks no floor); a walk that timed out, hit the cap or met an unreadable entry; a
clock that cannot be read; a probe that cannot look; a checkout question that could not be answered; a quarantine that
is not a real directory of this uid at mode 0700, or quarantine slots that cannot be listed beside a present leaf; a
leaf whose own mode lacks owner write, or cannot be read (`mode`); a physical `~/.cc-tmp` that is off the device a
witness or a record carries, or whose device or path cannot be read, before an absence is believed (`device`); a leaf
or slot whose absence cannot be proven; and a token that cannot be minted. The audit exits 1 on each and journals nothing; the verb prints `probe-unmeasured`, journaled
`failed`. A box without `flock` refuses `flock-unavailable` before the lock, as every destructive verb does.

**Its limits, stated.**
- atime is not consulted: a reader holding no file descriptor and no working directory at probe time is not seen.
- A nested mount's contents are not walked by the idle walk, which never crosses a file system.
- A backwards clock step delays the floor and never shortens it. A FORWARD step shortens it, because the floor
  compares `date +%s%N` against the kernel's change time; the in-use probe and the row rule still guard live users.
- The operator's `cdk-out-sweep` restarts a CDK-using orphan's floor, until it has nothing left to remove.
- A new child on a recycled slug adopts an old leaf through `mkdir -p` in three cases: a leaf the tail deliberately
  kept, a leaf a human verb left (`ws-rm`, `ws-reap` and `ws-gc --prune` leave the leaf and its witness, because the
  tail is the only caller of the witness drop), and a leaf the collector's own restore put back before that child's
  `mkdir -p`. The removal helper's checkout question still guards every later removal.
- The witness writer's temp files of an id with neither a witness nor a quarantine record are never visited.
- A rename's EBUSY on a mount point, and a same-file-system bind mount inside a leaf, cannot be measured without root
  on this fleet. Step 5's mountinfo check covers the collector; the tail's share is stated in §7.
- The in-use probe does not count ccd's own process, the scan's chain, or any child of those. That is safe here
  because `ws-collect` runs as a ccd process of its own, started per call, so no session's process is one of its
  children; a caller that ran the verb inside a long-lived session's process would break it.
- A recycled spawn can adopt the leaf between the record and the move
  (`crash-at-moved-residual-widened`; the first form was `crash-at-moved-after-a-spawn-keeps-the-leaf-in-its-slot`).
  If ccd is then killed anywhere between the move and the putback's move-back rename, not at the re-proof alone, the
  next audit reads the phase `moved`. Before the adopting child's `mkdir -p` runs again it answers `registered` with no
  token; after it, it answers `quarantine-kept`, TERMINAL and journaled `refused` on every pass for the child's life,
  and it clears by itself once the path is free. The retaken-path arm stays above the registry, so a retake is never
  silent. Either way the live child's adopted scratch stays in the slot for the child's life, its contents leave the
  child's path, and nothing durable is lost. Once the child's row is gone and the path is free, the record resumes and
  the leaf is collected with no idle floor. A same-run recycled child, or one whose witness write failed, passes the
  record's read-back and so reaches the move: `spawn-at-consented-stops-at-the-record` holds only for a spawn whose
  witness write changes the witness.
- A persistent step-5 doubt makes a move and a move-back on every floor, journaled `failed` `probe-unmeasured`: a
  mount inside the leaf, a mount table that cannot be read, or the in-use probe timing out under load. Each move-back
  restamps the change time, so each cycle waits a fresh floor, and nothing is lost. The `containment-unproven` loop is
  the other one.
- The device test cannot tell an empty bind-mount point from the leaf's absence when the bind source and the mount
  point share a file system, because both carry the same device
  (`device-test-cannot-see-a-same-device-bind-mount`): the absence is believed, as it was before the device test.
  Carried to wave 9's pre-flight list.
- A PERMANENT change of the physical `~/.cc-tmp`'s device (a tmpfs or btrfs anonymous device across a reboot or a
  remount, a re-enumerated block device, `~/.cc-tmp` moved to a new volume) holds every witness without a leaf and
  every `removed` record at unmeasured `device` on every pass, with no terminal word and no journal row
  (`permanent-device-change-holds-every-absence`). It fails closed, loses nothing and never heals by itself, so a lane
  must not read a standing `device` answer as transient. Carried to wave 9's pre-flight list.
- The reclaim tail's own witness drop keeps two pre-existing behaviours the collector's arms refuse: it believes a
  leaf's absence without asking the device (`tail-drop-believes-an-absent-leaf`), and it drops the witness of an id
  whose recordless slot stands (`tail-drop-ignores-a-recordless-slot`). Both are carried to wave 9's pre-flight list.
- The inert witness left aside when a compare-and-drop could not move it back is warned about, and no reader takes it
  for an id.
- The audit's worst case can exceed its runner row (above); it fails closed.

---

## 6. What this changes outside itself

Every item below is a place the change is *visible to a guard*, and the plan that ships the wave carries the
edit. They are listed because a wave planned without them discovers them mid-implementation.

**Contracts (prose, pinned verbatim).**

- Coordinator clause 3 is rewritten: it keeps all three verb names inside it, so the equality pin that
  requires each name to appear exactly once still holds, and it gains the fact that a child the coordinator
  dispatched is reclaimed by the server when that child's run closes, while the coordinator's own workspace
  is cleaned up by a human and never by a sweep. The verbatim pin moves in the same commit.
- Worker clause 8 and reviewer clause 8 are **unchanged**. Both skills gain a non-clause sentence in their
  reporting section: this workspace ends when its run closes, and anything not committed on this branch by
  then is committed for you as a WIP commit and attic-pinned.
- `wave-lifecycle.md` §5 and §6 are rewritten for one PR per child: after a PR-bearing wave, wave N+1 opens
  **without** `sessionId`; "nothing archives it" becomes "a child is reclaimed on close; your own workspace
  stays until a human cleans it up". The two new refusal codes are named in the skill and explained here,
  which the reverse census over refusal codes requires.
- CLAUDE.md: the SAFETY bullet is narrowed to say that the five destructive verbs remain forbidden to every
  session and that `ws-reclaim` is a server-composed act on children only; **and** the coordination bullet
  that enumerates session-only writes gains the new route, because a census derives that list from the test
  literal and checks this file's sentence against it.
- README's paragraph on why `ws-reap` stays human-only is narrowed the same way.
- Wave 7 names `ws-collect` in CLAUDE.md's SAFETY bullet, in bold beside `ws-reclaim` and `ws-expire`, and in
  `agent/CLAUDE.md`'s gated verbs, on `--expect`. `ws-collect-prose.test.ts` pins both sentences, and pins that no
  skill corpus names the verb, because a skill that names a verb has given a model a reason to reach for it.
- The 2026-09-10 ruling's own text in the merged sweep stays true and untouched: that lane still only
  announces.

**Censuses, cardinals and vocabularies that move.** Each was measured; Appendix A holds the value and the
tool.

- **The new lifecycle act is seven edits, not one.** Three declaration sites (the union and its total map in
  `shared/api.ts`; ccd's own act array, which is alphabetical and excludes the reader's degrade; the PWA's
  word map) and **four independent cardinal assertions** across four test files — two counting the union
  and two counting it minus the degrade. Adding `reclaim` moved 25 to 26 twice and 24 to 25 twice (wave 3's
  Task 1; Appendix A records the values as built).
- **The route cardinals that move are the ones for its own file.** Registering the pause route in
  `coord/routes.ts` moves that file's exact count and the whole-tree count; the count for `server.ts` is
  untouched. Registering it in `server.ts` instead would move the other two *and* put it out of reach of the
  literal the session-only census harvests — which is why its home is not a matter of taste.
- **The coordinator-skill route census** requires every route registered in `coord/routes.ts` to be named in
  the skill corpus or to carry a written exemption. A reclamation dial the coordinator must not be told
  about takes the exemption, with the argument spelled out beside the existing pause route's.
- **The refusal scanner** holds a hand-written list of destructive verbs and an exact sanctioned-exception
  set. `ws-reclaim` must join it in the same commit that ships the verb, or the scanner stays green over the
  newest destructive path while proving nothing about it.
- **The registry field inventory** learns one new per-session marker. That inventory's own comment admits it
  is not an exhaustive census, so the plan verifies the purge against the marker rather than against the
  count.
- **The whitelist parity machinery** lives in the agent package, not the server one, and a required-flag
  verb carries a negative fixture proving the bare form is refused. Two verbs means two fixtures.

**Wire and capability.** `FleetSession` gains the child field, additively, read through the single measured
reader, with absence permitted. `FLEET_PROTO` stays 1.

Three capability tokens, because each surface must be able to ship and be refused independently: one for the
`--child` argv, one for the reclaim pair (`ws-audit --reclaim` and `ws-reclaim`), one for the pause verb.
All three are read with the **capability** reader, never the verb reader. That is not a preference: the verb
reader *permits* when the box's verb list is absent, which is the right default for verbs that have always
existed and precisely the wrong one for a verb that never did — a destructive verb dispatched to a box with
no evidence it exists is the failure that distinction was built to prevent. Each token joins the
parity-pinned token list and gains its equality line against the exported constant, so the three spellings
(the list, ccd's echo, the server's constant) cannot drift. Wave 7 adds a further token, `collect-v1`, for
`ws-audit --collect` and `ws-collect` together, read with the capability reader for the same reason.

**Deploy.** Agent-first, and it is not a slogan here. `--child` on `ws-add` is a new flag, and this tree has
already paid for one of those: an older `cmd_ws_add` binds an unknown flag as a positional, the slug check
refuses, and every wave-1 dispatch on the fleet fails. The flag is therefore **gated on its own capability
token** and omitted when the box does not advertise it, with the omission recorded — a workspace minted
without the marker is simply not a child, which is the same fallback the pre-policy stock already takes.

**Not changed, deliberately:** `ws-reap`, `ws-rm`, `ws-gc`, `ws-archive`, `ws-restore`, their grants, their
refusals, the audit-token ceremony, and every PWA surface that drives them. (Qualified by workspace lifecycle's
wave 3, which adds two refusals of its own: `ws-reap` refuses `expire-in-progress` when the breadcrumb starts
`expire:`, beside its `reclaim:` mirror, and `ws-restore` refuses `in-progress` under its lock when an `expire:`
breadcrumb stands, or a breadcrumb that stands but cannot be read. Their grants and every other refusal stand. See
`2026-09-24-workspace-lifecycle-design.md` §5.3.)

---

## 7. What this does not claim

Stated here rather than discovered later, because a spec approved on a broader reading is worse than one
approved on a narrow one.

1. **Rule 2 is bounded.** Containment covers what a child writes inside its worktree and under its temp
   root, and covers tool scratch only insofar as the writer respects `TMPDIR`. Writers that hardcode `/tmp`,
   or write to `~/.cache`, `~/.npm`, a docker volume or the project's main checkout, are not contained. The
   residue probe measures the remainder so it is a number rather than a belief.
2. **"Always" in rule 1 is bounded by three refusals, and by the children kept for a person.** A child
   whose tree cannot be read, which holds a foreign repository's unpushed commits, or whose directory git
   does not record as a worktree, is reported and left alone. That is the operator's pin-everything
   ruling applied honestly: it overrides conditions where the work is visible and can be pinned, not
   conditions where proceeding means silent loss. The automatic path also keeps, for a person, and
   reports: a child under any other terminal refusal (`branch-elsewhere` among them, §5.5); each child the
   sweep's kept verdicts name (§5.9); and a child whose reclaim fails past the ceiling for good,
   such as `pin-failed` with its HEAD still on a branch that is already gone.
3. **Rule 4 has one exception, and it is a report.** The attention item asks nothing of the human and
   nothing waits on it.
4. **The pre-policy stock is out of scope.** Every workspace that exists when wave 1 ships carries no
   marker and is therefore not a child; none will ever be reclaimed by this machinery. Their disposal stays
   the existing human ceremony. Wave 1 records the measured count so the size of that set is known rather
   than assumed.
5. **The box is not a wall.** Identity on the fleet is attribution. The two-authority gate raises the bar on
   the automated path — the path with no human in it — and does not prevent a session with a shell from
   running ccd directly.
6. **Wave 6 carries these residuals, stated rather than discovered.**
   - The manifest and PR-phase branch reads, and the tail's reads of a nested checkout's branch, keep their
     two-way read: an unreadable ref there still reads as no branch. They sit outside the reclaim's branch arms.
   - A stash made on no branch is attributed to the child by its ancestry from the branch, so with the branch
     proven absent no such stash is attributed or pinned. It stays in `refs/stash` and is never deleted.
   - A witness binds birth time in whole seconds. A leaf removed and recreated within one second on the same
     inode matches its witness. The collector's quarantine rename and its lstat proofs own this (§5.10), and birth
     time is never the only guard of a race case there.
   - A clips leaf the helper refuses or cannot measure is kept, recorded, and collected by nothing: the collector
     takes a witnessed temp root only (§5.10) and no clips witness is planned, so such a leaf is the operator's, and
     reaches them through the server's report of what a tail kept (wave 8, §8).
   - A temp-root leaf re-created between the tail's proof that it is absent and the drop of its witness, or by a
     process that outlives the wait after `done`, is a leaf with no witness. It is a leak, never a loss, because the
     collector takes only a witnessed leaf.
   - A board mounted after its child left, whose first read lands between the registry purge and the
     journal's `done`, keeps a null chip until its next load.
   - A ccd that dies between the registry purge and the journal's `done` leaves a null chip and no attention
     item. A fix would read the tombstone, never reorder ccd.
   - Whatever selects git's global or system config file (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`,
     `GIT_CONFIG_NOSYSTEM`, and `HOME` or `XDG_CONFIG_HOME`) names this uid's own files and sits below the
     pins' command-line precedence, so it passes through the reclaim's git containment.
   - A straggler that writes into the removed worktree's path recreates a directory there that nothing
     collects. The tail's wait covers the temp root only.
   - On Darwin every directory temp root a tail meets is kept (§5.2). A link or file leaf is unlinked, as before.
   - Removal compares devices only. So `rm --one-file-system` does cross a bind mount of the SAME file system
     nested inside a leaf, and only root can make one. A mount of another file system at the leaf is refused,
     because the leaf's device is compared with the root's before anything is changed; a same-file-system bind
     mount at it is not seen, as inside it, and neither is a mount made there after that check, during the
     permission pass.
   - The removal helper's checks are not atomic with its `rm`. A same-uid rename of another directory onto
     `<root>/<id>` between the two is removed with it. The collector's quarantine rename closes this for a collected
     leaf (§5.10), and the tail keeps the window. The owner-bits `chmod` that lets the helper enter a mode-000 leaf
     dereferences its operand,
     bounded to this uid's own files and their owner bits.
   - The checkout question (§5.6) sees checkouts and nothing else. A tree stripped of its `.git`, or content that is
     no checkout, parked in a clips directory or a temp root is not seen. The base held these only by accident,
     through the blanket hold on a gone row. A clone, a submodule of one, or a worktree of one inside a leaf is the
     leaf's own and goes with it, and so does a foreign main checkout, a `.git` directory, moved into a leaf with no
     registry row naming it: it is removed with its object store. A row that names the moved tree's old path is a
     gone row, and the blanket hold keeps the child unmeasured. The bind-mount alias spelling of a leaf is not
     compared. The question and the `rm` are two looks, and the same-uid rename window above covers both. A registry
     row placed into a leaf after the ownership check the tail makes at its start is not asked again at step 6;
     the removal-time question and the temp root's in-use probe still stand, and the worktree has the same window
     class. On a case-insensitive file system (Darwin APFS), a hand-renamed `.GIT` that git honours is missed by the
     walk's name match, and git never writes that name. The question's one write before it answers is the owner bits
     of the leaf itself, so a foreign tree moved in AS the leaf has its root's owner bits set even when it is then
     refused.
   - The checkout question fails closed, and it leaks. A temp root that holds a directory ccd cannot read, more
     than 64 entries named `.git`, or a tree whose walk outlasts the scan bound is kept unmeasured on every pass,
     where the permission pass used to normalise it and remove it. A clips leaf is mostly spared the first shape,
     because the ladder normalises clips before the tail. Measured on one fleet, 47 entries named `.git` sat in 6 of
     45 temp roots, none of them near the cap, and none in clips.
   - A leaf the tail could not prove absent or look at makes the tail fail resumable `worktree-remove-failed` at its
     start, and so on every resume, until the leaf is fixed. A standing row at, inside or through a leaf (§5.5), and a
     foreign tree that stands in the child's worktree at the tail's moved-tree check, are proofs, not unanswered
     questions: they fail as `containment-refuted` (§5.6), and a retry meets the same thing until the other row or
     tree is moved or removed. Nothing is deleted in either case, and a fresh reclaim is held at the ladder. These are
     persistent per-child failures that retry for ever. Wave 7 names the proven ones; the server's own reading of
     `containment-refuted`, with attention at once and a long, capped retry tier, is wave 8's (§8).
   - A `pin-failed` or `tombstone-unwritable` printed in the pin phase, before the breadcrumb, reads resumable to the
     server (§5.6), so the feed says the box resumes where it stopped of an act that is retried from the start.
     `ws-expire`'s pin phase prints the same two words before its own breadcrumb, and its reader reads them the same
     way. The additive `crumb` field on ccd's document now tells the two cases apart (§5.6); the server's reader of
     it is wave 8's (§8).
   - A `probe-unmeasured` printed on the resumed arm reads not resumable to the server (§5.6), though an earlier
     attempt's breadcrumb stands. The locked recomputation prints it for any unmeasured verdict, and on a resume that
     verdict can come from the resume's own reads (an unreadable tombstone, for one). The feed says the act is retried
     from the start, but the box's next attempt resumes from that breadcrumb and completes.
     - The audit path reaches it too, and first. `ws-audit --reclaim` runs before the verb and goes through the same
       `_ws_reclaim_resume_eval`. Over a standing breadcrumb with an unreadable tombstone it exits 1 with
       `{"resume":…,"verdict":"unmeasured"}` and journals `probe-unmeasured`. The server maps the audit's non-zero
       exit to `unreadable` (`childReclaimAudit`), and the executor then reads not resumable. So the feed says the act
       is retried from the start on every attempt while the tombstone stays unreadable, yet ccd's next attempt resumes
       from the breadcrumb. The verb arm is reached only in an audit-to-verb race.
     - This is the mirror image of the residual above: the same kind of fault, a wrong sentence and never a wrong act,
       and the same additive field (`crumb`) tells the cases apart (§5.6); the server's reader of it is wave 8's.
   - The in-use probe reads each process's environment as exec'd, so a TMPDIR set after exec is not seen.
     - A cwd or fd reached through another mount of the same directory has a spelling neither of its compared
       spellings names. `~/.cc-tmp` is a bind mount on the fleet box, and the TMPDIR arm compares ccd's own
       spelling.
     - A pid reused within one walk is read once.
     - A process table whose churn outlasts the walk's time limit reads unmeasured, never nobody.
     - Same-uid non-dumpable processes and other uids' processes are not read.
   - On a git older than 2.43, a resume whose branch is already gone fails closed on every retry, at one of two
     places. A reclaim resumed after its own branch delete reads `branch-unmeasured` at the tail's branch step until
     the branch is recreated. A resume that enters at `children` or `worktree`, whose branch was present at the pin
     and was deleted by someone after the tombstone, never reaches that step: the settle's pin reads unmeasured and
     stops `pin-failed` on every retry, with the tree, the breadcrumb and the row standing and nothing deleted. Both
     are leaks. The fleet runs 2.43.
   - A branch whose tip moves while it stays present, between the in-lock recomputation and the pin, is still
     taken over at its pinned tip; the delete's compare-and-swap at that tip bounds it. `ws-expire` keeps the
     recomputation-to-pin window for the branch's state too, because its locked recomputation is workspace
     lifecycle's, so a branch created in that window is still adopted at its pinned tip there.
   - A dangling-symlink loose ref that shadows a packed entry reads absent. The branch is then left, never
     deleted: a leak, not a loss.
   - A symbolic registry branch reads unmeasured and is never deleted through. Every branch delete in the tail
     is `update-ref -d --no-deref`.
   - The test harness's git spawns keep the runner's own `HOME` git config.
   - A witness writer's interrupted temp file (`$REG/tmproots/.<id>.*.tmp`) is reaped by nothing but the collector,
     which removes a dead one of an id with a witness or a quarantine record under that id's lock, while the slug reads free and only when it is
     at least an hour old (§5.10). One of an id with neither a witness nor a quarantine record is never visited.

   Wave 7 carries these residuals as well, and amends the ones above.
   - The collector's own are in §5.10, "Its limits, stated": atime is not consulted; a nested mount's contents are
     not walked; a backwards clock step delays the floor, and a forward one shortens it; the operator's `cdk-out-sweep`
     restarts a CDK-using orphan's floor; a new child on a recycled slug can adopt a leaf the tail kept, a leaf a human
     verb left or the collector's restore put back; a witness writer's temp files of an id with neither a witness nor a quarantine record are never visited; a rename's EBUSY on a mount
     point and a same-file-system bind mount cannot be measured without root on this fleet; the in-use probe does
     not count ccd's own process or its children, which is safe because the verb runs as a ccd process of its own;
     a kill between the move and the putback's move-back rename, after a recycled spawn adopted the leaf, keeps that
     leaf in its slot for the child's life, answered `registered` until the child's `mkdir -p` retakes the path and
     terminal `quarantine-kept` after it; a persistent step-5 doubt moves and restores the leaf on every floor; the
     alias refusal ends at the putback; the device test cannot see a same-device bind mount, and a permanent device
     change holds every absence at `device`; the reclaim tail's witness drop believes an absent leaf and ignores a
     recordless slot; and the audit's worst case, about 79 seconds (94 at the widest kill grace) against a 90 second
     runner row, fails closed when the runner kills it.
   - A witness with no birth time whose leaf is gone stays a terminal `witness-mismatch`, offered to the operator and
     journaled by each audit; the collector never takes a leaf nothing vouches for.
   - A `.child` row without a valid generation is unmeasured on every pass and never reclaimed by the sweep (§5.5).
     The spend's generation read takes the row's compaction lock inside the reap lock, and waits up to five seconds
     for a contended one; the audit's generation read (`ws-audit --reclaim`) holds no reap lock.
   - A tombstone that records an all-zero tip or head, which no ccd writes, retries `branch-unmeasured` until an
     operator repairs it (§5.6).
   - Review 346's corrected sentences. In the checkout question, "only a tree git back-links passes" holds for an
     admin directory OUTSIDE the leaf: one that resolves inside the leaf passes before any back-link is read, which is
     safe because the removal takes the whole tree with the leaf. A NUL inside a `.git` file splits its line and reads
     unmeasured; inside an admin directory's `gitdir` back-link it leaves a newline in the text compared with the
     `.git` path, so the tree is refused only when that path holds no newline, accepted when the NUL sits at the offset
     of a newline the path does hold (a hand-crafted file: git writes no NUL), and unmeasured otherwise
     (`nul-back-link-prose-corrected`; the corner and its missing pins go to the path-identity programme); a trailing
     NUL is a line end each caller strips. The bare path captures that remain are examples, not
     a census: some fail closed (the tail's `wdreal`, `_ws_reclaim_nested_proven`'s `real` and the removal helper's
     `lreal`), and others are label prefixes only (the pin's `wdreal` and rung 9's), any refusal there coming later
     from the tail's containment proof.

---

## 8. The waves

Each is green on its own, each is measurable on its own, and each can be sent back without taking the others
with it. Rule 3 in particular ships in wave 2 and stops the bleeding — every PR-bearing child becomes
unbindable — without any destructive verb existing yet.

| Wave | Side | Contents | What it is measured by |
|---|---|---|---|
| 1 | agent | `--child <runId>` on ws-add behind its capability token; the marker; child-only `TMPDIR`; the measured prerequisite and the pre-policy count | a dispatched child carries the marker and its temp root; an older ccd composes the identical old argv |
| 2 | server | the registry field through the measured reader; the three-valued spent verdict; the two 409s; the unbind on dispatch | **rule 3 enforced**: a second bind on a PR-bearing child refuses, an unreadable marker refuses, a research child still hands over |
| 3 | both | `ws-audit --reclaim` and the token; `ws-reclaim` and its ladder; its own tail arm and breadcrumb; close's fourth act; delivery cancellation after a successful reclaim | **rules 1 and 2**: a child is gone after its final close, its temp root with it, its work in the attic |
| 4 | both | the sweep lane; `reclaim-pause` and its route and toggle; the attention item | **rule 4**: an orphaned child is reclaimed with no human act; the switch stops it from a phone |
| 5 | server + pwa | the run-row chip and its sentences; the sweep's verdicts on the chip and the attention item; feed rows that do not repeat; the presence lease and its bound; "has coordinated" fenced to the workspace's current generation | the operator can read what became of a child, and why the sweep keeps one; a presence-held child is licensed within the stated bound |
| 6 | both (agent first) | what `ws-reclaim` deletes, repaired: after the kill the tail waits, bounded, until no process uses the temp root, removes it through one removal helper or keeps it and records why; the temp root's positive witness; the tail's deleting git calls contained, and git's inherited config dropped inside the containment; ccd journaling the failures the lifecycle mirror never saw; the pin for a child whose branch is already gone; recovery from a registry row whose directory is gone; the board's second re-read trigger | a child whose branch is gone is reclaimed rather than failing; a reclaimed child's temp root does not come back; a gone row no longer holds the children it cannot reach; an unmeasured probe and an id-tied pre-lock die each leave a journal line |
| 7 | agent (inert) | the collector verb for a witnessed child temp root that a human verb or a kept tail left behind: `ws-audit --collect` and `ws-collect`, the quarantine record, the `collect` act and its words, the `collect-v1` capability token and the agent grant on `--expect`; and the reclaim tail's ccd corrections, which `ws-expire` shares: `containment-refuted`, `crumb`, rung 8's reading of git's silent omission, the capped permission-pass reason, and the reclaim token's binding to the row's generation | the fleet's `ccd caps` advertises the collector's token, and nothing composes it yet |
| 8 | server | reclaim's server half: the queued licence keyed on the row's generation, the reader of `crumb` on the verb's failed document, the audit arm that reads an exit-1 audit document's `resume`, `containment-refuted` as a class of its own on a persistent retry tier, and the report of what a tail kept (`clipsKept`, `tmpRootKept`) | a licence minted for one row is never spent on a re-mint of its id; a proven, persistent failure is listed at once and retried slowly, never given up |
| 9 | server | the collector's lane in the sweep, under `reclaim-pause` and the sweep's pacing | an orphaned temp root is collected with no human act |

Wave 3 built the destructive verb, and it is the one to review hardest. Every later wave that changes what
reaches a destructive act is reviewed for safety too: wave 4's sweep is its first automatic caller, wave 5's
lease and coordination fence change when a wait licenses `--defer-expired` and which children may be taken,
wave 6 changes what the existing verb deletes and keeps, and wave 7's collector is a second destructive
path, which wave 9's lane is the first to call. Wave 8 changes what a `ws-reclaim` token is licensed against, so
it is reviewed for safety too. The waves are cut so that no one of them carries two such subjects: reclaim's server
half and the collector's lane both edit the sweep, so wave 9 is dispatched once the fleet's `ccd caps` advertises
wave 7's token and wave 8 has merged. The other gate it once carried, workspace lifecycle's wave 3b, which brought
the expiry lane, is met. Delivery cancellation rides with wave 3 rather than with
the sweep, because §5.6 makes it part of the act: shipping reclaim-on-close without it would run the
slug-recycling hazard at the new, higher rate for as long as wave 4 took to land.

---

## 9. Testing discipline

The repo's own rules apply unchanged and are restated only where this design adds a hazard.

- Every new guard ships with a test that goes **red when the guard is deleted or mutated**, measured before
  and after. A comment is a request; a red suite is a mechanism.
- Fixture HOMEs only. No ccd verb runs against the live `$HOME`, and the destructive verb makes that rule
  absolute rather than merely standard.
- The load-bearing pins, the ones whose absence would let a defect ship silently: a non-child close never
  composes the reclaim argv; `not-a-child` has no override on **either** the fresh or the resumed arm; the
  marker is never inferred from any other flag or string; the pause file is honoured **inside** the verb;
  the two 409s fire at open *and* at dispatch; an unreadable sibling list and an unreadable marker each
  refuse rather than permit; the secret-shape classifier runs over the WIP commit's candidates, asserted by
  reading the resulting tree rather than the tombstone; the WIP commit and the attic pins are asserted by
  reading git refs after a reclaim; the unsupervise step runs on the resumed arm; the defer ceiling is
  reached and the act proceeds; an older agent omitting the wire field still parses.
- Suites run in the foreground with the repo's timeout, per package, never bare. The known load flakes are
  re-run in isolation before anything is called a break.

---

## Appendix A — measured anchors

Values measured in this tree at `origin/main` `46aca9fe`, and re-measured unchanged after merging `d759c914`, each with the site that holds it. They are here so
the plans can cite a number and the reader can re-measure it; **a number without its tree goes stale
silently**, so re-measure before relying on any of them.

**The lifecycle act vocabulary — three declarations, four cardinals.**

| Site | Current value | Read with |
|---|---|---|
| `shared/api.ts` — the `LifecycleAct` union and its total `Record<…, true>` map | 25 members; omission is a compile error, a stray key likewise | `grep -n "^export type LifecycleAct ="` |
| `ccd/ccd:4119-4121` — `_LC_ACTS` | 24, alphabetical, excluding the reader's degrade | `sed -n 4119,4121p ccd/ccd` |
| `pwa/src/session/journalWords.ts` — `ACT_WORD` | 25 keys, total over the union | `grep -n ACT_WORD` |
| `server/test/lifecycle-acts.test.ts:33` | `expect(ACTS.length).toBe(25)` | `grep -n 'ACTS.length' server/test/*.ts` |
| `server/test/single-definition.test.ts:2919` | `expect(LIFECYCLE_ACTS.length).toBe(25)` | same |
| `server/test/lifecycle-vocabulary.test.ts:149` | `.toBe(24)` — the union minus the degrade, compared against ccd's executed array | same |
| `server/test/ccd-lifecycle-emit.test.ts:28` | `.toBe(24)` — the ccd-side twin | same |

**As built.** Wave 3's Task 1 (#187) added `reclaim` at all seven sites, and no act has been added since.
At `origin/main` `c41bf8c5`: the union and `ACT_WORD` hold 26; `_LC_ACTS` holds 25 (`ccd/ccd:4368-4370`,
read with `sed -n 4368,4370p ccd/ccd`); the two union cardinals read `.toBe(26)`
(`server/test/lifecycle-acts.test.ts:33`, `server/test/single-definition.test.ts:3064`), and the two that
exclude the degrade read `.toBe(25)` (`server/test/lifecycle-vocabulary.test.ts:149`,
`server/test/ccd-lifecycle-emit.test.ts:28`).

Waves 1 to 4 moved other values below as well; they stay as the `46aca9fe` snapshot, so re-measure each
at the site its entry names (`server/test/auth-gate.test.ts`, `server/test/ccd-archive.test.ts`,
`agent/src/whitelist.ts`, `ccd/ccd`, `shared/api.ts`, `server/src/watch.ts`, `server/src/registry.ts`).

**Route censuses.** `server/test/auth-gate.test.ts` holds three exact counts: `scanRoutes('server.ts')` is
**51**, `scanRoutes('coord/routes.ts')` is **30**, and the whole-tree `ROUTES.length` is **81**. A route
registered in `coord/routes.ts` moves the second and the third only.
Tool: `grep -n 'toBe([0-9]' server/test/auth-gate.test.ts`.

**Capability tokens.** The parity-pinned list at `server/test/ccd-archive.test.ts:154` currently holds ten:
`account-pools, account-v1, actor-flags-v1, lifecycle-v1, pools-v1, route-apply-v1, route-argv-v1, route-v1,
stop-surface, win-size-v1`, each with an equality line against its exported constant. It governs capability
tokens, not verbs: a new dispatchable verb is advertised by being in ccd's dispatcher, which is why this
spec's three tokens are tokens rather than relying on verb advertisement alone.

**Required-flag verbs.** `agent/src/whitelist.ts` currently gates six: `ws-reap → --expect`,
`ws-rename → --session`, `coord-pause → --state`, `project-pool → --project`, `route → --session`,
`win-size → --session`. `UNGRANTABLE_VERBS` is `['ws-rm','ws-gc']` and is **not** touched by this spec —
both new verbs have a lawful grantable form.

**The reap tail's two facts that force a separate arm** (both read directly, not inferred):

- `ccd/ccd:14149` re-reads `$REG/<id>.archived` and refuses `not-archived` before the tail's first write.
- `ccd/ccd:14432-14434` runs `_ws_unsupervise` (d) and `tmux kill-session` (e) only under
  `[[ -z "$resumed" ]]`, and the comment at `:14183-14185` states the safety argument explicitly: it is safe
  only because `cmd_ws_archive` writes the marker *after* both. Nothing writes that marker for a child.

**Presence.** `PRESENCE_REFRESH_MS = 15_000`, `PRESENCE_TTL_MS = 45_000` (`shared/api.ts:3856-3857`). Claims
are per-connection, client-re-stated, TTL-swept and never persisted.

**PR sweep cadence.** `PR_SWEEP_MS = 120_000`; `PR_SWEEP_ACTIVE_MS = 30_000`, the latter only while some
project already has an open PR with pending checks (`server/src/watch.ts:196-197`). This is the staleness
§5.3's live measurement exists to avoid.

**The measured reader.** `fieldMeasured(io, dir, id, name): Promise<MeasuredRead>`
(`server/src/registry.ts:472`) is the existing pattern the child field uses; the registry's `held` field is
the precedent for absent-versus-unreadable being two answers rather than one.

**Known gaps in the tree's own records, found while measuring** — recorded so a plan does not trust them:
the registry field inventory's own comment admits it is not an exhaustive census; a docstring on the
sibling-runs query claims three consumers where six call sites exist; the PR-history reader's line citations
into ccd are stale; and one route test's cross-reference comment points at a line the assertions have moved
away from.

## Appendix B — the review that shaped this

The first form of this design was reviewed adversarially before approval: six independent lenses (safety and
blast radius, collisions with pinned invariants, ordering and races, rule fidelity, scope, wire and deploy),
deduplicated to 44 findings, each put to three refuters with majority rule. 38 survived.

The design above differs from the reviewed one in every place a finding survived. The seven that changed it
most:

1. A registry marker any process can write was the only gate on deletion — hence the two-authority rule and
   the `--expect` token (§5.1, §5.5).
2. The trigger "no open sibling" fires on the ordinary non-final close, which has just held the child for
   the next wave — hence the `final or spent` conjunct (§5.7).
3. The existing reap tail refuses `not-archived` before its first write and its resume arm skips the
   unsupervise its safety argument depends on — hence reclaim's own arm (§5.6).
4. A shared breadcrumb makes `not-a-child` overridable by a crash — hence the distinct flavour (§5.6).
5. `tmux list-clients` does not see the PWA's ordinary chat surface — hence the presence union, and the
   ceiling that keeps it from inverting rule 4 (§5.7).
6. A boolean spent-verdict read from a sweep-written field fails open on exactly the hand-over it must stop
   — hence three values and a live measurement (§5.3).
7. Rule 3's enforcement needs no destructive verb at all — hence wave 2 shipping and being measured alone
   (§8).

Six findings were refuted and are recorded as such: the two that argued rule 2 and rule 1 were overclaimed
were refuted because the design already bounded both, which §7 now states rather than implies.
