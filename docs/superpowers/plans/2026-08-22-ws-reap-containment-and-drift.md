# `ws-reap` — containment by evidence, and drift by git's record

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Workspace / branch:** `ccrc-pwa-soft-cove` on `ws/soft-cove`. Every commit lands here; no feature
branch (worker-skill clause 2).
**Base:** `c39eabc` (`origin/main` at survey time). Every anchor below was derived by identifier
against that tree; if `main` moves, re-derive by `git grep -n <identifier>`, never by offset.
**Ledger:** highest `D-` on `origin/main` at cut time is **D-170**; this plan allocates **D-171…**.

**Goal.** Two defects in `_ws_reap_eval` make the PWA's reap flow refuse workspaces that are provably
safe to remove. On 2026-08-22 all three archived `expoAI-assistant` workspaces (`clear-cove`,
`warm-mesa`, `swift-delta`, ~3.6 G) were refused through the UI and removed by hand with `ccd ws-rm`
+ `git branch -D`. `ws-rm` accepted all three. **The UI and the CLI disagreed about identical
evidence, and the UI was wrong.**

Both defects are the same shape: **ccd already owns a correct prover and fails to consult it.**

**Not the goal.** No refusal is weakened into a warning. No force flag is added. No guard loses its
mutation test. Where this plan *widens* what reap accepts it does so by reaching a prover that was
already written and already trusted elsewhere — and each widening is a numbered deviation below with
its own pinning test.

---

## The two defects, measured

### Defect 1 — the merge prover is unreachable in the case it exists for

`_ws_reap_eval` decides containment on whether `"$branch@{upstream}"` resolves (`ccd/ccd`, search
`THE CONTAINED RUNG`):

```
if up=$(git rev-parse --verify --quiet "$branch@{upstream}"); then
    ahead=…; (( ahead == 0 )) || refuse unpushed-commits
else
    # "never pushed" arm — strict ancestry against origin/HEAD, or refuse no-upstream
fi
if (( ! contained )); then
    … _ws_merge_proof "$main" "$REAP_MERGE" "$REAP_TIP" …   # ancestor|tree|patch-id|cherry
fi
```

GitHub deletes the head branch on merge (default). The local upstream then stops resolving, so a
**merged** branch takes the "never pushed" arm, which demands strict ancestry — which a squash merge
can never satisfy. Refusal: `no-upstream — "<branch> was never pushed and holds commits not reachable
from origin/HEAD"`. **That sentence is false**; the branch was pushed, reviewed and merged.

Measured on `clear-cove` (tip `e071a3aa`, PR #618 squashed as `e5ffe56d`):

| rung | result |
|---|---|
| `ancestor` | fail |
| `tree` | fail |
| `patch-id` | **PASS** (`a == b == 59f7ec90ba8e3acffe6dab96a8dcafdc69be8d0b`) |
| `cherry` | fail (98 unmatched — expected; a squash collapses N commits into 1) |

Re-measured independently in a throwaway fixture (git 2.43.0, this box, 2026-08-22): after
`git push origin --delete ws/x`, `ws/x@{upstream}` stops resolving **immediately** — git removes the
remote-tracking ref on a delete-push, so no `--prune` is even required — while `patch-id` proves the
squash and `cherry` reports `+` for all three commits. `_ws_merge_proof` approves it; it is simply
never called.

**This defect is pinned as a passing test today.** `server/test/ccd-ws-audit.test.ts`, *"refuses a
branch with no upstream — never pushed is never proven"*, takes the genuine `squashMovedBase()`
fixture, runs `git branch --unset-upstream`, and asserts `no-upstream`. That test asserts the bug.
It inverts in Task 2 (D-179).

### Defect 2 — registry/git branch drift is fatal in the UI, repairable in the CLI

```
[[ "$wthead" == "$branch" ]] || refuse registry-branch-drift
```

`$branch` is the registry's `.branch`, written at spawn and never updated when the operator switches
branch inside the worktree. **Drift is the NORMAL end state**: a workspace is archived, then reused
for new work on a new branch. It hit 2 of 3 workspaces, and `warm-mesa`'s drift was created by work
merged FOUR DAYS AFTER the archive (registry `ws/evaluate-lightpanda-as-playwright` #596, disk
`fix/ops-alerts-publish-and-kb-names` #620).

`cmd_ws_rm` already resolves this correctly and says so in its own comment — *"git had a record, so
the registry is a witness, never the decider"* — printing

```
note: registry recorded 'X', git's worktree record says 'Y' — deleting 'Y'; 'X' left alone
```

and proceeding. `_ws_reap_eval` refuses on the same evidence.

### Defect 3 — `.prphase` reads the registry's branch too

`swift-delta`'s `.prphase` read `no-commits` while its worktree held 27 commits on a different
branch, because the PR poller measures the registry's `.branch`. Closed in Task 6 — same rule, same
reason.

---

## Global constraints

Every task's requirements implicitly include this section.

- **AGENT-FIRST.** This wave's centre of mass is `ccd/`, so it ships to the fleet host *before* the
  server (`CLAUDE.md`, "Build / test / deploy"). The server reads what ccd writes.
- **`FLEET_PROTO` stays 1.** The audit wire gains fields; they are **additive and
  absence-permitting**, read through a SINGLE reader (`parseWsAudit`, `shared/api.ts`) with
  `optStr`/`optBool`, never `reqStr`. An older ccd on the fleet host omits them and must still parse.
- **No new dependency in any `package.json`. Node floor stays `>=22.13.0`.**
- **Suites run in the FOREGROUND, timeout ≥600000 ms**, as `./node_modules/.bin/vitest run
  test/<file>` from inside the package. **Never bare `npx vitest`.** Known load flakes (`ccd-ws-gc`,
  `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`) — re-run in isolation before
  calling a break.
- **Tests use FIXTURE HOMEs only** (`makeCcdHarness`). No `ccd` verb ever runs against the live
  `$HOME`. `ghContainedEnv` stays in force; a test that means to reach gh reaches the *stub*.
- **Mutation-table discipline.** Every guard ships with a test that goes RED when the guard is
  deleted or mutated, measured before/after and recorded in the ledger. TDD red-first.
- **Refusal tokens are INLINE LITERALS** in `ccd/ccd` — `server/test/wsaudit.test.ts` harvests them
  from this file's bytes with `/"refused":"([a-zA-Z0-9-]+)"/` and holds the set exactly equal to
  `wsaudit.ts`'s `SENTENCES`. A new token needs a sentence; **no comment may spell a refusal object
  out in full**.
- **No `git push`, no `gh`, in any task step.** Branch, commit, stop. The PR is opened once at the
  end.

---

## THE GOVERNING RULES (read both before touching `_ws_reap_eval`)

> **RULE 1 — evidence selects the prover; nothing else does.**
> Which prover runs may never depend on a fact that is orthogonal to what is being proven.
> `@{upstream}` resolving is a fact about the *remote-tracking ref*, not about whether the work is
> safely elsewhere. After this wave it decides exactly one thing: the WORDING of a refusal (which
> missing evidence to name), never which prover runs.

> **RULE 2 — git's worktree record names the branch; the registry is a witness.**
> `_ws_wt_branch "$main" "$workdir"` is the authority, exactly as in `cmd_ws_rm`. The registry entry
> is **reported, never trusted, never silently deleted**. Every downstream rung — stashes,
> containment, PR binding, the CAS delete — evaluates the branch git actually has checked out. The
> two conditions that are *not* drift stay refusals: **no worktree record** and **detached HEAD**.

---

## The new containment ladder

Operator ruling 2026-08-22 (asked and answered before implementation): **ancestry first, PR second**,
with both consequences accepted and pinned (D-173, D-174).

```
Phase C — containment, from the evidence, in order

  C0  REAP_TIP = rev-parse refs/heads/$branch          || branch-missing
  C1  if $branch@{upstream} resolves:  ahead == 0      || unpushed-commits     (unchanged, pre-fetch)
  C2  origin remote exists                             || no-remote
  C3  fetch origin                                     || fetch-failed         (REAP_FETCHED)
  C4  RUNG 1 — ancestry:  set-head --auto, obase=origin/HEAD,
                          merge-base --is-ancestor $branch $obase
                          -> REAP_PROOF=contained, binds no PR
  C5  RUNG 2 (only when rung 1 did not prove) — the PR bind and `_ws_merge_proof`:
                          -> REAP_PROOF=ancestor|tree|patch-id|cherry, binds the PR
  C6  REAP_BASEOID = rev-parse $base                   || base-missing         (once, for the token)
  C7  refuse: no-upstream   — no remote-tracking evidence AND no merged PR AND no ancestry
              no-bound-pr   — remote-tracking evidence, but no merged PR binds
```

**What each outcome becomes:**

| fixture | today | after |
|---|---|---|
| squash-merged, remote head deleted (upstream gone) | `no-upstream` ❌ | `patch-id` ✅ |
| squash-merged, remote head present | `patch-id` | `patch-id` (unchanged) |
| never pushed, contained by origin/HEAD | `contained` | `contained` (unchanged, still no gh call) |
| never pushed, holds unique work | `no-upstream` | `no-upstream` (unchanged) |
| merge-commit merged into the DEFAULT branch | `ancestor` + PR bound | **`contained`, PR unbound** (D-173) |
| merge-commit merged into a NON-default base | `ancestor` + PR bound | `ancestor` + PR bound (unchanged) |
| bound PR OPEN, commits already in origin/HEAD | refuse `not-merged` | **reapable, `contained`** (D-174) |
| bound PR OPEN, commits NOT in origin/HEAD | refuse `not-merged` | refuse `not-merged` (unchanged) |
| gh unreadable, ancestry fails | `gh-unreadable` | `gh-unreadable` (unchanged) |
| gh unreadable, ancestry proves | (unreachable) | `contained` — gh is never called |

**C1 survives verbatim, and that is load-bearing.** The upstream probe keeps its own rung — a
tracking ref that EXISTS and shows local-only commits is independent evidence of work that is
nowhere else, and it refuses before any network cost. It selects no prover: when the tracking ref is
gone (the whole defect) C1 is simply skipped and BOTH provers still run. Keeping it also keeps
`unpushed-commits` reachable, with its "refusing on a comparison that did not run" fixture
(`ccd-ws-audit.test.ts`, the `NOCOUNT` shadow) — a rung deleted here would have taken that
regression guard with it.

**A comparison that did not run is never "no".** When `set-head --auto` or `symbolic-ref` fails,
rung 1 answers *unprovable*, not *disproven*: it falls through to rung 2 (whose merge proof needs no
`origin/HEAD` at all), and if that proves nothing either, the C7 detail must name WHICH — "not
reachable from origin/HEAD" and "origin/HEAD could not be re-derived" are different sentences and
`ccd`'s own polarity (`_ws_gc_merged`, `_ws_gc_dirty`: report unprovable as unprovable) requires
telling them apart. The `set-head --auto` re-derivation itself is NOT optional — it is the guard
against proving containment against a frozen tracking symref after the remote moved its default.

`cherry` **cannot prove a squash and must not be the deciding rung** — it reports `+` for every
commit a squash collapsed. It stays the last rung of `_ws_merge_proof`, where it is the rebase-merge
prover, and nothing about it changes.

---

## Deviations found

Numbered from **D-171** (highest on `origin/main` at cut time: D-170). Every entry that changes
behaviour names the test that pins it.

- **D-171 — containment is no longer selected by `@{upstream}`.** The upstream probe kept exactly one
  job (the `unpushed-commits` pre-filter) and lost the other (choosing the arm). RULE 1. Pinned by
  *"proves a squash whose remote head GitHub deleted — the upstream is gone, the proof is not"*.
- **D-172 — `no-upstream` vs `no-bound-pr` is now chosen by remote evidence**, not by which arm ran.
  Reserved exactly as the report requires: `no-upstream` for a branch with no merged PR bound to it
  AND no ancestry proof AND no tracking evidence. Both tokens keep a producer, so
  `wsaudit.test.ts`'s set equality is untouched.
- **D-173 — DISCLOSED WIDENING (information).** Ancestry-first swallows the merge-commit-into-default
  case: it now records proof `contained` with `pr.number: null` where it recorded `ancestor` plus the
  PR. `_ws_merge_proof`'s `ancestor` rung stays reachable — it is the prover for a PR merged into a
  **non-default base**, which is what its fixture is re-cut to exercise. The PR itself remains visible
  on the workspace row (`prnumber`/`prphase`) and in `.prhistory`; what is lost is the tombstone's
  `pr` field for that class. Accepted by the operator, 2026-08-22.
- **D-174 — DISCLOSED WIDENING (behaviour).** A workspace whose bound PR is still OPEN, but whose
  commits are all reachable from `origin/HEAD`, is now reapable (proof `contained`) where it refused
  `not-merged`. Nothing unique is destroyed — that is exactly what the ancestry proof states — and
  reap deletes only the LOCAL branch, so the open PR and its remote head are untouched. Pinned in
  BOTH directions: reapable when contained, still `not-merged` when not.
- **D-175 — `registry-branch-drift` is demoted from a refusal to a NOTE in reap.** git's worktree
  record names the branch to evaluate and to remove; the registry entry is reported and left alone,
  `cmd_ws_rm`'s rule verbatim. The token keeps its producer (`cmd_ws_rename`, which still refuses)
  and its `SENTENCES` entry, whose wording is corrected to be true of the verb that still emits it.
  `no-worktree-record` and `detached-head` stay refusals — different conditions, still unsafe.
- **D-176 — the tombstone becomes the resume path's branch source.** `_ws_reap_tail` and
  `_ws_reap_locked` read `branch` from the registry today; under drift that would CAS-delete the
  wrong name with the right tip and wedge every resume on `branch-moved`. The tombstone records the
  branch that was consented to (git's) plus `registryBranch` beside it, and the resume reads it from
  there — the same pattern `tombtip` already uses. Absence-permits: a tombstone written by an older
  ccd carries the registry name, which under the old rule was equal to git's by construction.
- **D-177 — `headMatchesRegistry` can now be `false` on a `reapable` verdict.** It was previously
  false only on a refusal, so the PWA never rendered it. The audit gains `worktreeBranch` (additive,
  `optStr`) and the sheet grows a visible drift note naming both branches and which one is removed.
- **D-178 — the PR poller stops asserting a phase it did not measure.** The report's diagnosis is
  right (`.prphase` said `no-commits` about a worktree holding 27 commits on another branch, because
  the poller reads the registry's `.branch`) and the obvious fix — switch the source to git's record
  — is **wrong here, and the tree already says why**. `_pr_state_one` does not merely read: it
  PERSISTS (`prphase`/`prnumber`/`prcheckedat`) and retires a superseded number into the
  append-only `.prhistory` ledger. Switching the source silently re-binds every drifted workspace in
  the fleet on the next 120 s sweep — `bound()` fails on the old name, one irreversible ledger line
  per workspace, before anyone looks. Every other verb that meets drift refuses and names both
  records (`cmd_pr_open`, `cmd_ws_rename`) or records both as fields
  (`_ws_archive_manifest`: *"DRIFT IS A FIELD, NOT A REFUSAL"*); a poller that picked would be the
  only verb in ccd that resolves drift by picking, and it would pick the direction that rewrites PR
  lineage. **The distinction against RULE 2 is principled**: reap destroys the worktree and the
  branch git has checked out, so git's record is the subject of the act; the poller binds a REMOTE PR
  to a name and writes that binding down, so picking a side there is a claim about history. So: the
  poller measures `_ws_wt_branch` FIRST and, on disagreement, answers `phase:'unknown'` with a new
  `PrReason` naming both branches, persisting NOTHING — the last honest value stays, and
  `prVerdict` (`server/src/coord/fingerprint.ts`) reads `unknown` as `unmeasurable`, never
  `regressed`. Costs no new git call: `_ws_wt_branch` is already invoked once per session at
  `ccd:3273`; the call moves, it is not added.
- **D-179 — a test that asserted the defect.** `ccd-ws-audit.test.ts`'s *"refuses a branch with no
  upstream — never pushed is never proven"* passed *because* of Defect 1. Inverted, with its title
  and body rewritten to say what is actually being proven; the "never pushed AND holds unique work"
  half it was conflating keeps its own test.

---

## Task 1 — the fixtures, and the test that asserts the defect

**Red-first.** No production change in this task.

- [x] Add `squashRemoteHeadDeleted()` beside `squashMovedBase()` in `server/test/ccd-ws-audit.test.ts`:
      a genuine multi-commit squash with a moved base, pushed with `-u`, PR row bound via
      `mergedRow({ headRefOid, mergeCommit })`, then `git push origin --delete ws/quiet-basin` so the
      remote-tracking ref is gone and `@{upstream}` no longer resolves. Assert the precondition in the
      fixture itself (`rev-parse --verify --quiet 'ws/quiet-basin@{upstream}'` must fail) — a fixture
      that silently stops reproducing the defect is worse than no fixture.
- [x] New test: **audit → `reapable`, `merge.proof === 'patch-id'`, `pr.number` bound**. RED today
      (`no-upstream`).
- [x] New test: same fixture with the remote head **still present** → `reapable`, `patch-id`. GREEN
      today; it exists so the fix cannot merely move the failure.
- [x] Record both RED outputs verbatim in the task's commit message.

## Task 2 — the containment ladder (`_ws_reap_eval`)

- [x] Restructure Phase C into C0…C7 above. The `if up … else … fi` arm split is deleted; the
      upstream probe survives only as C1.
- [x] `_ws_merge_proof` is UNCHANGED. So is every refusal it can reach.
- [x] Rung 1's `set-head --auto` / `symbolic-ref` failures become **"ancestry unprovable"**, falling
      through to rung 2 — they refuse only at C7, where the detail names what could not be checked.
      (Today they refuse `no-upstream` outright.)
- [x] Refusal details are rewritten to be TRUE: no sentence may say "was never pushed" about a branch
      whose upstream merely stopped resolving. Name what was checked and what was missing.
- [x] Invert D-179's test; re-cut the `ancestor`-rung fixture onto a non-default base (D-173); add
      D-174's pair.
- [x] Verify the six regression cases from the report end to end (audit AND reap, not audit alone).

## Task 3 — drift, the evaluation side

- [x] Replace the `registry-branch-drift` refusal with the `cmd_ws_rm` rule: `REAP_REGBRANCH` keeps
      the registry's name, `branch` becomes git's, `REAP_DRIFT` carries the note.
- [x] Fingerprint inputs keep their MEANINGS: `branch=` stays the registry's name and `worktreeHead=`
      stays git's, so both names are hashed and either one changing between audit and reap still
      moves the token. Fourteen inputs, unchanged in count and order.
- [x] Every downstream rung evaluates git's branch: stash count, tip resolve, upstream probe, PR
      bind, `commitsAheadOfBase`, and every refusal string that names a branch.
- [x] `no-worktree-record` and `detached-head` stay refusals, unchanged, with their tests.
- [x] Tests 3 and 4 from the report: drift + contained → ALLOWS, evaluates git's branch, emits the
      note, leaves the registry-named branch alone; drift + not contained → REFUSES **naming git's
      branch**, not the registry's.

## Task 4 — drift, the destructive side

- [x] `_ws_tombstone` records the branch that was consented to (git's) and `registryBranch` beside it.
- [x] `_ws_reap_tail` takes the branch from the eval on the fresh path and from the TOMBSTONE on the
      resume path; `_ws_reap_locked`'s live-tip re-validation reads the same source. Absence-permits
      for a tombstone written by an older ccd.
- [x] The CAS delete at (g) targets git's branch with git's tip. The registry-named branch is never
      deleted and never renamed — `_reg_purge` removes the registry ROW, which is unchanged.
- [x] The reap receipt names the branch actually deleted, and carries the note.
- [x] Test: drift + resume from each breadcrumb phase finishes without `branch-moved`, and the
      registry-named branch still exists afterwards.

## Task 5 — the wire and the sheet

- [x] `cmd_ws_audit` emits `worktreeBranch` (git's) beside `branch` (the registry's); `parseWsAudit`
      reads it with `optStr`; `WsAudit` gains the optional field.
- [x] `ReapSheet` renders the drift note whenever `headMatchesRegistry === false`, naming both
      branches and which one is removed. The operator must see it before the tap, not after.
- [x] Correct `SENTENCES['registry-branch-drift']` to describe the verb that still emits it.
- [x] `wsaudit.test.ts`'s token set equality stays green in both directions.

## Task 6 — `.prphase` stops asserting what it did not measure (D-178)

- [x] `_pr_state_one` reads `_ws_wt_branch` before it resolves a tip (two statements, `$?` on its own
      line — `local x=$(cmd)` returns local's status). Three states, three answers, no narrowing:
      **rc 0 + name == registry** → today's path verbatim; **rc 0 + name != registry** → the new
      answer; **rc 0 + empty (detached)** and **rc 1 (no record, or `$main` unreadable)** → today's
      behaviour, unchanged, because those two already collide with pinned shapes
      (`ccd-pr-state.test.ts:344-359`) and this wave does not widen them.
- [x] New `PrReason` in the SINGLE enumeration (`PR_REASON_MAP`, `shared/api.ts` — `PR_REASONS` is
      derived, never hand-listed), its `isPrReason` narrowing, and the matching copy in
      `PrKeycap.tsx`. `phase:'unknown'`, so `prVerdict` answers `unmeasurable`, never `regressed`.
- [x] **Persists nothing** on that answer: `prphase`/`prnumber`/`prcheckedat` keep their last honest
      values and `.prhistory` gains no line. Pinned by a test that reads the three files before and
      after and asserts them byte-identical.
- [x] Test: registry `.branch` != git's branch, worktree holds commits on git's branch → the answer
      is NOT `no-commits`, names both branches, and the "Open pull request" composer is not
      hard-disabled by a phase nobody measured.
- [x] The five pinned tests the naive fix would have broken (`ccd-pr-state.test.ts:294-359`,
      `:917-937`) stay GREEN unchanged — they are the negative control that this task did not switch
      the source.

### Recorded, not fixed — the seams this wave deliberately did not widen

Found while implementing (an adversarial completeness pass over every branch-name flow); each
is real, each is out of this wave's scope, and each would be re-found by a whole-branch review
if it were not written down.

- **D-180 — `verifyDone` re-measures the REGISTRY's branch tip.** `server/src/coord/
  fingerprint.ts` measures the done-fingerprint against the branch the live registry names, not
  git's. Under drift a worker commits on git's branch and the coordinator refuses `stale-tip`.
  This wave does not touch it: RULE 2 is scoped to the verbs whose SUBJECT is the checked-out
  branch (reap destroys it, `ws-rm` deletes it), and a wave close is a claim about a program's
  ledger. Left as is, deliberately, because moving it is a Build-7 decision with its own
  blast radius — not a side effect of a reap fix.
- **D-181 — the server's drift census is blind on exactly the rows reap operates on.**
  `server/src/divergence.ts` skips archived rows with the comment *"its worktree is gone by
  construction"*, which is false: `cmd_ws_archive` ends "worktree kept at `$workdir`, nothing
  deleted", and `_ws_gc_row` classifies live archived worktrees. So the fleet-wide drift signal
  never fires for an archived workspace — and now that reap no longer refuses on drift, the reap
  sheet's note (D-177) is the only place that disagreement surfaces at all. The note is at the
  point of action, which is where it matters most; the census remains worth fixing.
- **D-182 — `ws-gc --prune`'s orphan arm reads a branch name the way this file bans.**
  It takes the name from `git -C "$p" rev-parse --abbrev-ref HEAD` — the read
  `_ws_reap_eval` and `cmd_ws_rm` both refuse to use, because it answers from whatever
  repository owns the DIRECTORY — and hands it to `git branch -d` in `$main`. Its `ours` gate is
  a path-SHAPE test, not an ownership proof. Measured on git 2.43: unreachable today, because
  `git worktree remove` refuses a hijacked path (`fatal: validation failed … '.git' is not a
  .git file`, rc 128) before the branch-delete arm is entered. A latent single-guard-deep
  defect of exactly the family this wave is about.
- **Observed, unrelated: a cross-test race in `server/test/typecheck-tests.test.ts`.** Its
  "every .ts file is in some typecheck project" scan sees `src/__boot_control_mutant__.ts`,
  which `boot.test.ts` writes for ~15 s. `single-definition.test.ts` and `auth-routes.test.ts`
  already tolerate that file by name; this scan does not. Passes in isolation.

## Task 7 — sweep, docs, ship

- [x] Full suites: `server`, `agent`, `pwa`. Known flakes re-run in isolation.
- [x] Mutation sweep over every guard this wave touched; record survivors and kills in the ledger.
- [x] `CLAUDE.md` / `README.md` updated where they describe the reap ladder.
- [x] Deploy **agent-first**, then the server. Then the live verification below.

---

## Verification — not from unit tests alone

The report is explicit, and it is the acceptance criterion for this wave:

> Re-create an archived workspace whose branch was squash-merged with its remote head deleted, and
> drive the reap through the PWA UI, not just the CLI.

- [x] On the fleet host, create a scratch workspace, squash-merge its branch, delete the remote head,
      archive it.
- [x] Open the reap sheet in the PWA. It must offer the reap, showing proof `patch-id`.
- [x] Tap it. The workspace, its branch and its registry row go; the tombstone records the proof.
- [x] Repeat with a drifted registry entry and confirm the note is visible in the sheet BEFORE the
      tap, and that the registry-named branch survives the reap.
