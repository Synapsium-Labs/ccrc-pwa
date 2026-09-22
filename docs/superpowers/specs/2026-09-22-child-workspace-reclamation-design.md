# Child-workspace reclamation — the fleet closes the loop it has never closed

**Status:** design approved by the operator 2026-09-22; written spec accepted the same day. Ticket CCR-15 ("Reclamation policy: the fleet can act on
idle and finished workspaces"). Supersedes nothing; **narrows** two standing rulings and **satisfies** a
third that has been open since 2026-08-11. Implementation rides five waves, agent-first.

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

**Rule 4 is the load-bearing one**, and not because of what it asks for. It changes the *population* an
automatic collector acts on, and that is what makes one safe here where the last one was not — see §3.

One qualification is owed up front, because the first ruling's "nothing waits for a human" is not kept
absolutely: two conditions, both of them cases where proceeding would destroy work **nobody could see**,
refuse instead of proceeding. They are argued at §5.5 and bounded at §7, and they are the only two.

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

**Spent.** A child whose branch has ever had a PR, in any phase — open, draft, merged or closed. Spending is
monotone: nothing un-spends a child.

**Reclaim.** The act: pin everything recoverable, then destroy the worktree, the branch, the clips, the
per-session temp root, the pane, the unit and the registry row. It keeps the attic refs, the tombstone, the
lifecycle journal and the transcripts. It is `ws-reap`'s destruction with a different consent model and a
different ladder in front of it — not `ws-reap` with a flag, for the reasons in §5.5.

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

**Two collectors, disjoint roots.** `ccd-tmp-sweep` refuses any root that does not resolve strictly inside
`/tmp` or its own `TMPDIR`, and as a systemd user unit its `TMPDIR` is the box default. A child's temp root
under `$HOME/.cc-tmp/<id>` is therefore invisible to it, and is collected only by reclaim, at once rather
than after the sweep's seven-day horizon. The roots never overlap, so the 2026-08-11 policy's warning
about two collectors on one filesystem does not apply. The price is stated: a child that hits a terminal
refusal (§5.5) keeps its temp root, which the hourly sweep would otherwise have collected once the session
died. That child is itself uncollected and already on the attention item, so nothing new goes unreported.

**The residue probe.** After a reclaim, the lane measures what the child left outside the worktree and its
temp root and records the total. Rule 2's claim is thereby *bounded and observable*: containment covers
writers that respect `TMPDIR`; writers that hardcode `/tmp`, or write to `~/.cache`, `~/.npm`, a docker
volume or the project's main checkout, are not contained, and the probe turns that gap into a number
instead of an assumption.

### 5.3 Spent, measured when it is asked

`childSpent` returns **three** values — `spent`, `unspent`, `unmeasured` — never a boolean.

- Fast path: the registry's PR number, and `.prhistory`. Either naming a PR answers `spent`.
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

**Non-children are untouched by all of this.** A workspace with no marker binds exactly as today.

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
| 9 | no nested foreign checkout holds unpushed commits | `containment-unproven` | **terminal** |
| 10 | the recomputed fingerprint equals `--expect` | `state-changed` | retryable |

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
2. Everything else uncommitted — tracked modifications and non-secret untracked files — becomes one WIP
   commit on the child's own branch. **ccd has no commit helper today**; this one is new, and it is the
   only place in ccd that writes a commit, which is reason enough for it to be one function with one caller.
3. Attic pins are taken: the branch tip including that WIP commit, the reflog entries the existing pin
   already takes, every stash attributed to the branch, and the in-progress operation heads
   (`REBASE_HEAD`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `ORIG_HEAD`) where present.
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

### 5.7 When reclaim happens

**On close.** After `closeRun` or `closeReviewRun` has committed its transaction — never before, so a failed
reclaim can never un-close a run — the child is reclaimed when all of:

- the workspace is a child (the registry verdict names a run id; `unreadable` defers), **and**
- no sibling run is open, re-read **inside the coordination mutex** immediately before the argv is composed,
  with an unreadable sibling list counting as *ineligible* rather than as "none", **and**
- the close is `final`, **or** the child is `spent`.

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

The act is: `ws-audit --reclaim` → token → `ws-reclaim`. Any failure is recorded and left to the sweep.

**On the sweep.** The close path cannot cover every case, and the cases it misses are real: dispatch has two
shipped arms that mint a child and then fail to bind it, leaving a run `planned` with no session and a
marked workspace named by no run row. A predicate written over run rows can never reach those.

So the sweep's subject is **the marker**, which already holds the minting run id. A child is eligible when:

- no open run names it (unreadable ⇒ ineligible), and
- its minting run is terminal or absent from the coordination database, and
- no hold, no presence signal, no in-flight dispatch window, and
- `reclaim-paused` is absent, and
- every one of the above held on the **previous** pass too — the 2026-08-11 policy's twice-observed rule,
  kept verbatim.

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
the feed row says how long it waited and why. Unbounded would be worse than absent: the PWA's terminal
drawer opens a real `tmux attach`, so a phone that locks with the drawer open would wedge a child forever,
and the only exit would be a human detaching from a sub-workspace — rule 4 inverted by its own safeguard.

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

Default: running. Pausing stops reclamation fleet-wide and nothing else; unpausing drains what queued.

### 5.9 What the operator sees

**The durable record is ccd's lifecycle journal**, which is written where the registry purge cannot reach it
and is already readable per session after the workspace is gone. A new act, `reclaim`, joins its vocabulary
(§6 lists every site that declaration touches).

**One feed row per outcome** — reclaimed, deferred with its elapsed time, refused with its sentence — written
explicitly by the lane. This is stated because it does not come for free: a reclaim on an already-closed run
is an observation rather than a transition, and the existing event path deliberately skips observations, so
a design that assumed a feed row would have delivered none while promising all.

**A chip on the closed run's row**, reading the lifecycle mirror rather than the registry row that no longer
exists: reclaimed, pending, deferred, paused, or refused with the sentence. Refusal sentences come from a
lookup keyed by the refusal token, never respelled at the surface.

**No child ever appears in the reap or archive sheets.** Both are gated on a workspace being archived, which
a child never is.

**One fleet-level attention item** collects children under a terminal refusal, with each one's sentence.
It is a *report*, not a tap: nothing waits on it, and ignoring it costs disk rather than correctness.

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
- The 2026-09-10 ruling's own text in the merged sweep stays true and untouched: that lane still only
  announces.

**Censuses, cardinals and vocabularies that move.** Each was measured; Appendix A holds the value and the
tool.

- **The new lifecycle act is seven edits, not one.** Three declaration sites (the union and its total map in
  `shared/api.ts`; ccd's own act array, which is alphabetical and excludes the reader's degrade; the PWA's
  word map) and **four independent cardinal assertions** across four test files — two counting the union
  and two counting it minus the degrade. Adding `reclaim` moves 25 to 26 twice and 24 to 25 twice.
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
(the list, ccd's echo, the server's constant) cannot drift.

**Deploy.** Agent-first, and it is not a slogan here. `--child` on `ws-add` is a new flag, and this tree has
already paid for one of those: an older `cmd_ws_add` binds an unknown flag as a positional, the slug check
refuses, and every wave-1 dispatch on the fleet fails. The flag is therefore **gated on its own capability
token** and omitted when the box does not advertise it, with the omission recorded — a workspace minted
without the marker is simply not a child, which is the same fallback the pre-policy stock already takes.

**Not changed, deliberately:** `ws-reap`, `ws-rm`, `ws-gc`, `ws-archive`, `ws-restore`, their grants, their
refusals, the audit-token ceremony, and every PWA surface that drives them.

---

## 7. What this does not claim

Stated here rather than discovered later, because a spec approved on a broader reading is worse than one
approved on a narrow one.

1. **Rule 2 is bounded.** Containment covers what a child writes inside its worktree and under its temp
   root, and covers tool scratch only insofar as the writer respects `TMPDIR`. Writers that hardcode `/tmp`,
   or write to `~/.cache`, `~/.npm`, a docker volume or the project's main checkout, are not contained. The
   residue probe measures the remainder so it is a number rather than a belief.
2. **"Always" in rule 1 is bounded by two refusals.** A child whose tree cannot be read, or which holds a
   foreign repository's unpushed commits, is reported and left alone. That is the operator's pin-everything
   ruling applied honestly: it overrides conditions where the work is visible and can be pinned, not
   conditions where proceeding means silent loss.
3. **Rule 4 has one exception, and it is a report.** The attention item asks nothing of the human and
   nothing waits on it.
4. **The pre-policy stock is out of scope.** Every workspace that exists when wave 1 ships carries no
   marker and is therefore not a child; none will ever be reclaimed by this machinery. Their disposal stays
   the existing human ceremony. Wave 1 records the measured count so the size of that set is known rather
   than assumed.
5. **The box is not a wall.** Identity on the fleet is attribution. The two-authority gate raises the bar on
   the automated path — the path with no human in it — and does not prevent a session with a shell from
   running ccd directly.

---

## 8. The waves

Each is green on its own, each is measurable on its own, and each can be sent back without taking the others
with it. Rule 3 in particular ships in wave 2 and stops the bleeding — every PR-bearing child becomes
unbindable — without any destructive verb existing yet.

| Wave | Side | Contents | What it is measured by |
|---|---|---|---|
| 1 | agent | `--child <runId>` on ws-add behind its capability token; the marker; child-only `TMPDIR`; the measured prerequisite and the pre-policy count | a dispatched child carries the marker and its temp root; an older ccd composes the identical old argv |
| 2 | server | the registry field through the measured reader; the three-valued spent verdict; the two 409s; the unbind on dispatch | **rule 3 enforced**: a second bind on a PR-bearing child refuses, an unreadable marker refuses, a research child still hands over |
| 3 | both | `ws-audit --reclaim` and the token; `ws-reclaim` and its ladder; its own tail arm and breadcrumb; close's fourth act | **rules 1 and 2**: a child is gone after its final close, its temp root with it, its work in the attic |
| 4 | both | the sweep lane; `reclaim-pause` and its route and toggle; the attention item; delivery cancellation | **rule 4**: an orphaned child is reclaimed with no human act; the switch stops it from a phone |
| 5 | pwa | the run-row chip and its sentences | the operator can read what became of a child |

Wave 3 is the only wave that destroys anything, and it is the one to review hardest.

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
