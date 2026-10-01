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
| 1 | distinguish complete alternate-row placement from absent-suffix projection; fail shut that ambiguity at audit, locked recomputation and both final ownership arms; preserve target-child vanished-worktree behavior; prove liveness-independent mutations and controls; merge current main and open the prerequisite PR | **AGENT-FIRST** | #226 (open) | **awaiting-review** — run 208 on `ccrc-pwa-quiet-basin` (dispatched 2026-10-01 12:23 UTC from handoff `2e84cbb0a`, claim 870) reported wave-done at `dd4e2a86`; the server accepted that fingerprint and all four items settled; held-out review run 212 dispatched to `ccrc-pwa-soft-canyon` |

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
