# Program: reclaim-row-placement-safety

Plan: `docs/superpowers/plans/2026-10-01-reclaim-row-placement-safety.md` (created only after the run-open deviation allocation)
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-calm-mesa`   Workspace: a fresh child
A one-wave safety prerequisite to `reclaim-entry-safety` and then `child-reclamation` wave 4 (CCR-15).

**What this program is.** Child-reclamation wave 4's Fix Round 3 rereview measured a pre-existing gap in
R31's cross-row ownership proof. A competing registry row can have entered a child through an ancestor symlink,
retain the physical child cwd after that symlink is removed, and then resolve only by textual suffix projection
below the proven-absent component. The current resolver reports that projection as ordinary success, so audit,
locked recomputation and final ownership remeasurement can all accept it as proof that the competing row lies
outside the child. This prerequisite distinguishes complete current resolution from an absent-suffix namespace
projection and makes the latter fail shut for alternate rows before either later prerequisite may authorize
automatic deletion.

## Waves

| # | scope | deploy class | PRs | state |
|---|---|---|---|---|
| 1 | distinguish complete alternate-row placement from absent-suffix projection; fail shut that ambiguity at audit, locked recomputation and both final ownership arms; preserve target-child vanished-worktree behavior; prove liveness-independent mutations and controls; merge current main and open the prerequisite PR | **AGENT-FIRST** | #226 (merged `0db98707`) | **done** — accepted on review run 215 at `1e533785`; squash-merged 2026-10-02 01:43 UTC; run 208 closed `done` with `final:true`, its child released and queued for reclaim; release v0.0.58 published 01:44 UTC, rollout by the automatic updater only |

**Deviation block: sixteen numbers, the first of them 3731** (allocated exactly once at run 208 open,
2026-10-01; floor now 3747). The finalized plan defines the first as
`alternate-row-absent-suffix-is-not-placement-proof`. No other issued number is rendered as a `D-` token unless
a measured departure is defined in that plan; unused headroom remains unrendered.

## Decisions & deviations

- **D-3731 — `alternate-row-absent-suffix-is-not-placement-proof`.** The inherited resolver contract reports both
  a complete current resolution and a textual suffix reconstructed below a proven-absent component as rc 0 plus one
  path string. That was sufficient for non-destructive path presentation and for the target child's deliberate R19
  vanished-worktree arm, but it is not sufficient evidence for destructive comparison against another registry row:
  the removed spelling may still name a process-retained physical cwd. This wave adds a proof basis and requires the
  alternate-row consumer to accept only `complete`; `absent-suffix`, `unmeasured`, empty and unknown bases make the
  ownership result unmeasured. This is a measured strengthening of R31 rather than a global missing-path refusal, so
  the subject child's existing absent-worktree behavior remains unchanged.
- **2026-10-01 — run 208 opened only after claim release.** Wave 4 released overlapping claims 850 and 851 while
  retaining its non-overlapping claims. The coordinator then opened run 208 and allocated its sixteen-number block
  once. The finalized plan is reviewed and published at one exact coordinator handoff commit before a fresh child is
  dispatched; the child copies that plan blob with read-only `git show`, verifies its blob ID and bytes, commits it
  alone as its first branch commit, and never cherry-picks coordinator ancestry.
- **2026-10-01 — split as a second blocking prerequisite.** Fix Round 3's scoped changes are accepted as addressing
  their assigned findings, but its held-out rereview measured the removed-symlink row-placement failure outside
  that diff. The defect is pre-existing and Important-grade because the same false-safe answer reaches unattended
  deletion. It is not an inherited-Bash/process-entry defect, cannot change run 199's immutable four-item shape,
  and does not belong to Wave 5. One child per PR therefore requires a new run, child, block, plan, review and PR.
- **The proof-qualified invariant.** During destructive cross-row ownership comparison, an alternate registry row
  may prove non-containment only when its complete current spelling resolves through existing directories. If
  resolution stops at a proven-absent component and reconstructs the remaining suffix textually, that result is a
  namespace projection, not identity evidence, and the row makes reclaim `unmeasured`, regardless of whether its
  tmux session is reported live, gone or unknown.
- **Resolver result shape.** The implementation plan carries one explicit result vocabulary, with a canonical or
  projected path where available and a basis equivalent to `complete`, `absent-suffix` or `unmeasured`. Unknown,
  empty and unreadable alternate-row basis values fail shut. The alternate-row consumer, not a global resolver
  redefinition, owns the new authorization rule.
- **The target child is intentionally different.** R19's vanished-worktree behavior remains legal for the subject
  child's own path. The implementation must not turn every proven missing suffix into a refusal, and controls must
  show a vanished target still reaches its existing absent-worktree ladder while an ambiguous alternate row blocks.
- **Process state is not deletion consent.** `pane_current_path`, `/proc/<pid>/cwd`, `lsof`, libproc and equivalent
  process snapshots are outside the authority model. They may strengthen a refusal in some future design, but they
  cannot turn a namespace projection into proof of non-containment. This wave adds no process-table reader, tmux
  format, platform-specific branch or real-tmux test dependency.
- **Every destructive seam is covered.** The fail-shut answer must prevent token minting at audit/evaluation, defeat
  a token minted before the competing row appears during locked recomputation, and refuse `_ws_reclaim_owned` on
  both the fresh and resumed tail arms. `--defer-expired` does not bypass cross-row ownership.
- **Landing order is strict.** This PR merges first. Run 199 then performs its already-declared merge-current-main
  integration item and completes `reclaim-entry-safety`. Only after both prerequisites merge may `swift-hollow`
  merge current main, repair its two remaining minors, regenerate and re-stamp `ccd/ccd`, and submit a fresh Wave 4
  fingerprint for official review. No worker rebases.
- **Routing escalation.** This is destructive-path safety work. The main loop runs Opus at `xhigh`; implementation
  subagents run Sonnet at `high`; workflows are off; compact threshold is 40. Official acceptance requires the
  standard held-out panel plus an Opus `xhigh` destructive SAFETY lens.
- **Rollout is automatic-updater-only.** After merge, observe the release and ccrc's own convergence read-only.
  No session manually rolls out this programme.
- **2026-10-01 — wave-done accepted for review.** Mail 3008 claimed branch tip and handoff
  `dd4e2a8616fe87041064c8b7db56f7380a1e03f0`, PR #226 open. Re-measured before submission: remote and worker tips
  equal it, the worker tree is clean, PR #226's head equals it, `origin/main` `e0a52953d` is its ancestor, the
  first child commit's plan equals the handoff blob, `ccd/ccd` passes the generated-marker check and `bash -n`, and
  only issued numbers 3731 and 3732 are rendered. Number 3732 defines a substitute for mutation row 12, whose exact
  edit crashes under `set -u` before any pin on current main; the review judges whether the substitute is equally
  strong. The server accepted the fingerprint (`awaiting-review`) and items 956-959 settled `done`.
- **2026-10-01 — the suite signal was environmental; routing unchanged.** The worker reported `suite: red`,
  `failure: unclear`: every first-run red was load-timing (green in isolation) or tmp-sweep's FAILS CLOSED case,
  which is red on `main` on this box. That is not evidence about the wave's work, so no rung was applied; the wave
  has no successor whose routing it could inform. Root disk was at 97-99% and `/tmp` held other projects' leaked
  fixtures.
- **2026-10-01 — held-out review is run 212.** It reads one measured tip in `ccrc-pwa-soft-canyon`'s own worktree
  with the standard panel plus the Opus `xhigh` destructive SAFETY lens, route opus/xhigh with workflows ON (the
  panel is a Workflow), and writes its report under `~/.cc-clips/<reviewer id>/`. The worker's note that a wave-3
  plan's citation of the contract's R28 lines shifted by three lines is outside claim 870 and is carried to Wave 4's
  integration round rather than edited here.
- **2026-10-01 — review run 212's verdict and the rulings on it.** `ccrc-pwa-soft-canyon` read `dd4e2a86` with the
  literal panel (one Workflow, 52 agents, none errored or empty): correctness 3 findings, 3 confirmed; spec 4, 3
  confirmed and 1 refuted; reproduce 1, refuted; the Opus `xhigh` SAFETY lens 8, 6 confirmed and 2 refuted. No lens
  is unverified and no finding unexamined; the report merges them into F1-F10. SAFETY: no path removes a live child
  through the removed-alias class; questions (a)-(g) hold; (h), the stated cost, fails as written. All 18 mutation
  rows and the row-12 substitute red at an assertion when re-run by the reviewer. Rulings:
  - **F1, operator:** any gone-directory alternate row (a stale row, a second vanished child, a child whose reclaim
    stopped after its `worktree` phase) holds every other child at `unmeasured`, a vanished subject included, and two
    such children hold each other. Accepted as the cost of the binding invariant, pinned by tests, and documented by
    qualifying R19's sentence, the plan's "preserve R19 exactly" and the cost bullet. Evidence that a gone row named
    ccd's own former worktree, so it stops holding others, is carried to wave 5 of `child-reclamation`.
  - **F2, coordinator:** no retry exists on `main`; the only request trigger is `close`. The spec already makes the
    sweep (child-reclamation wave 4) the retrier of every retryable refusal, so this cost stands until it ships, and
    the contract's cost bullet now says so.
  - **F3 and F4, operator:** both pre-existing on `main`. A re-pointed alias and a bind-mount spelling resolve
    `complete` and outside even when a session sits inside the child (`~/worktrees` is a bind mount on the fleet
    box; no live row uses such a spelling today). This PR documents the caveat, stops the `unres` remedy inviting a
    re-point, and renames the verb control that called a re-point a recovery. A device/inode identity follow-up
    programme is opened after wave 5; F8, the pre-existing window before the tail's `git worktree remove`, joins it.
  - **F10, coordinator:** the per-row `rok=0` reset is load-bearing and unpinned (a hoisting mutant keeps 351 tests
    green while a probe answers `reclaimable`). Fixed now, red first, with a mutation row.
  - **F5, F6, F7, F9, coordinator:** prose and comment corrections, and mutation row 13 made exact; fixed now.
  - Each measured departure from the plan's text in the round takes the next issued number, in order from 3733.
- **2026-10-01 — fix round 1 accepted for its second review.** Mail 3027 claimed `81a2158eae2f8370ca1e9e4b82e4b0adf75cb735`
  (two commits over `dd4e2a86`, `origin/main` unchanged). Re-measured: remote, worker and PR #226 heads equal it, the
  worker tree is clean, the diff stays inside the worker's claim 871, `ccd/ccd` passes the marker check and
  `bash -n`, and issued numbers 3731 through 3737 are each defined once in the plan with none rendered beyond them.
  The worker re-ran the full mutation table on the final bytes, every row red at an assertion, and did not re-run
  the whole server suite because production changed only in comments and one diagnostic string; CI is the arbiter.
  The server accepted the fingerprint; review run 213 reads it with the same panel and SAFETY lens.
- **2026-10-01 — review run 213's verdict and the second fix round.** `ccrc-pwa-brisk-prairie` read `81a2158e` with
  the literal panel (34 agents, none dead or empty): correctness 4 findings, 3 confirmed; spec 2, 1 confirmed;
  reproduce 2, 1 confirmed; the SAFETY lens 2, both refuted 3-0. No lens is unverified and no finding unexamined.
  SAFETY (a)-(g) hold, each measured; every review-212 finding is resolved, documented or carried as ruled; the fix
  round introduced no defect. The five confirmed findings are minor and predate the fix round: an arm now reached
  only by a contrived input (kept and commented as defence in depth, not deleted), two stale comments, a ladder
  placement snapshot that compares paths where the plan asks for bytes, and an overstatement in the row-12
  departure's text. All five are fixed in fix round 2.
  - **Remedy wording, coordinator ruling.** The SAFETY lens measured that following the new `unres` remedy ("restore
    its path to what it ran through") with a `mkdir` where a removed alias stood makes the child reclaimable while a
    session may sit inside it. Its refuters killed the finding as the ruled re-point class, but the wording had
    drifted from the operator's F3 ruling, which named restoring the link to its original target or removing the
    entry once its session has ended. Fix round 2 restores that wording, says never to create a directory in a
    link's place, and pins the instruction positively. Shipping guidance that a reviewer measured as unsafe to
    follow was not accepted in exchange for an earlier merge.
- **2026-10-01 — fix round 2 accepted for its final review.** Mail 3041 claimed `4d0070ba3b9ad469d97532c4d1b3d0c58cb7cec1`
  (two commits over `81a2158e`, `origin/main` unchanged). Re-measured: remote, worker and PR #226 heads equal it, the
  tree is clean, the diff stays inside claim 871, `ccd/ccd` passes the marker check and `bash -n`, and its only
  non-comment change is the `unres` remedy string, which now says to restore a link to its original target and
  never to create a directory in a link's place. No new issued number is rendered. Review run 214 reads it with the
  same panel and SAFETY lens.
- **2026-10-02 — review run 214's verdict, the third fix round and a convergence rule.** `ccrc-pwa-warm-harbor` read
  `4d0070ba` with the literal panel (46 agents, none errored). The first reproduce lens returned an empty list with no
  record; the reviewer counted it unverified and re-ran it, and the re-run reproduced all 30 commit claims. Counts:
  correctness 4 confirmed; spec 6, 3 confirmed and 3 refuted; reproduce 0; SAFETY 4, 2 confirmed and 2 refuted. No
  lens is unverified and no finding unexamined. SAFETY (a)-(g) hold, each measured; the `unres` remedy is safe to
  follow literally in every case it names, and the parenthetical forbidding a directory in a link's place is
  load-bearing. Fix round 2 introduced nothing, and every finding of reviews 212 and 213 is resolved, documented or
  carried. Nine minor findings predate fix round 2. Rulings:
  - **Fix now.** The resolver port made a subject whose workdir leaf is a link answer retryable `unmeasured` instead
    of contract R31's terminal `containment-unproven` whenever any other row exists, with a remedy ("remove what
    stands at it") whose literal following deletes the branch and de-registers a standing tree. Restoring R31 is
    conformance, not a new decision. Also fixed: one stale placement comment, the plan's mutation count, a comment
    that the plan-mandated `_ws_reclaim_resolvable` has no shipped caller yet, and a numbered record of the unknown
    liveness subcases' `--defer-expired` isolation route.
  - **Carried to child-reclamation wave 4's integration round:** the positive remedy pin binds the shared string,
    not the printed text; three row-level ladder cases no longer tell their resolver guards apart (resolver-level
    cases still pin them); and two pre-existing `//` remedy wordings still name a re-point.
  - **Convergence rule.** Each review so far found new minor first-round findings. The next review accepts the wave
    when SAFETY (a)-(h) hold, no confirmed critical or important finding stands, and fix round 3 introduces nothing;
    a newly found minor that predates fix round 3 is carried to wave 4 rather than opening another round.
- **2026-10-02 — fix round 3 accepted for review.** Mail 3055 claimed `1e533785864e615e55c2762c9d2001605da0e2c8`, one
  commit over `4d0070ba` (`origin/main` unchanged). Re-measured: remote, worker and PR #226 heads equal it, the tree
  is clean, the diff stays inside claim 871, and `ccd/ccd` passes the marker check and `bash -n`. Its production
  change moves the existing leaf-link refusal ahead of other-row placement in `_ws_reclaim_eval` and rewords the
  child's own rc-1 remedy so it never invites removing what stands at the child's workdir. Issued numbers 3738 and
  3739 are newly rendered; 3740 onward stay unrendered. Review run 215 reads it.
- **2026-10-02 — accepted, merged and closed.** `ccrc-pwa-amber-cove` read `1e533785` (panel 16 agents, plus a
  reproduce re-run after an empty first result: 32 of 33 claims reproduced, the 33rd not checkable and its finding
  refuted 3-0). Counts: correctness 1 confirmed; spec 1 confirmed and 1 refuted; reproduce 1 refuted; SAFETY 1
  confirmed. SAFETY (a)-(h) all hold, measured with the 20 tabled rows, nine extra mutants and 21 fixture probes on
  tip and prior bytes: no path removes a live child, R31's leaf refusal is terminal again ahead of row placement, R19
  is unchanged, and the moved rung puts one refusal ahead of others and never turns a refusal into a pass. Rulings:
  - **The fix round's own finding** is a test gap, not a behavior: no assertion binds the new rc-1 remedy's
    prohibition clause, so rewording it ships green. Read literally, the convergence rule's "introduces nothing" would
    open a fourth round; the coordinator ruled it the remedy-pin class already carried from review 214 (a pin that
    binds less than it claims), because SAFETY (h) measured every printed remedy safe to follow and the code's one
    behavioral change is pinned by mutation row 20. It is carried to child-reclamation wave 4 with that class.
  - **Two findings predate the round** and are carried to wave 4: the resolver refuses a `..` in the rest before
    re-walking a prefix that holds one (fail-closed: such a row lands in retryable `unres` with a false detail rather
    than terminal SHARED), and three plan selectors still name the retired `repairing the alias` control.
  - Run 208 advanced to `merging` on the reviewed fingerprint; PR #226 was squash-merged with `--admin` (the ruleset's
    approval cannot be given) and `--match-head-commit 1e533785`, as `0db987074dc7c14e30b661649810d6191596b3e6`;
    Linux CI was green and the macOS legs red, advisory by standing ruling. The `final:true` close answered `done`,
    `released:true`, `childReclaim:"queued"`. The release workflow published prerelease v0.0.58 from that merge at
    01:44 UTC; convergence is the automatic updater's and is observed read-only.
- **2026-10-02 — converged by the automatic updater.** Measured read-only at 02:27 UTC: the fleet box's
  `ccrc version` reads v0.0.58 at `0db98707`, install complete, and `ccrc update --check` answers `current`;
  `ccrc rollout --to v0.0.58 --check` reports fleet and server both `v0.0.58 (0db98707) [current]`. No box was moved
  by hand. The worker child `quiet-basin` was reclaimed on the close at 01:43:55 UTC with nothing uncommitted left.
  The four reviewer children of runs 212-215 keep their rows and worktrees, released and unheld: by contract R16 a
  review child is reclaimed by the sweep once its reviewed run is terminal, and the sweep ships in child-reclamation
  wave 4, so they wait for it rather than for a human.

## Carried constraints

- Fixture HOMEs only. Never run `ws-reclaim`, `ws-reap`, `ws-rm`, `ws-gc --prune`, `ws-archive`, `ws-restore` or
  any destructive ccd verb against the live HOME.
- Tests reproduce both a direct removed alias and a removed alias reached through `..`, proving complete placement
  before removal and absent-suffix projection after it. Modeled tmux live, gone and unknown states must all refuse
  identically and leave the target tree, branch, competing row, pane model and unit-call record untouched.
- Controls preserve a fully resolved outside row as non-blocking, a fully resolved inside row as
  `containment-unproven`, the target child's vanished path under R19, and recovery after the ambiguous alternate
  row is repaired or removed. Diagnostics name row IDs but never raw workdir values.
- Mutations delete or relabel the absent-suffix basis, delete each alternate-row check, permit it under live/gone or
  unknown state, leave only audit or locked enforcement, bypass each final ownership arm, let `--defer-expired`
  bypass it, apply it globally to the subject, collapse other failures into absent-suffix, remove literal or physical
  comparisons, mint a token despite ambiguity, and leak the raw workdir. Every row has a green control and reds
  before restoration.
- `ccd/ccd` is generated: re-stamp every edit. Pay S6-R11 with the real citation selector and locate code by content,
  not historical line numbers.
- Commit on the child's own workspace branch, never a separate feature branch. One child opens one PR.
- Official acceptance comes only from a distinct review run reading one server-accepted exact tip in its own
  worktree. A dead or empty lens is unverified, never approval.

## Next-wave brief

One wave, four machine-readable units mirrored exactly in the dispatch body (the strings omit terminal
punctuation):

1. `Distinguish complete alternate-row placement from absent-suffix projection`
2. `Fail shut ambiguous alternate rows across audit, locked and final reclaim seams`
3. `Preserve vanished-subject behavior and prove liveness-independent mutations and controls`
4. `Merge current main, run the required gates, and open the row-placement prerequisite PR`

The brief will name `superpowers:executing-plans`, the finalized exact plan blob, the allocated block, the routing
above and the claim set. It excludes process-entry/install work from run 199, process-cwd inspection, Wave 4's two
remaining minors and unrelated implementation, Wave 5's product scope, deployment and live fleet mutation.
