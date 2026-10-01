# Program: reclaim-entry-safety

Plan: `docs/superpowers/plans/2026-09-30-reclaim-entry-safety.md` (the worker commits the coordinator's exact plan artifact beside the fix)
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-calm-mesa`   Workspace: a fresh child
A one-wave safety prerequisite to `child-reclamation` (CCR-15), whose wave 4 cannot proceed until this programme merges.

**What this program is.** Child-reclamation wave 4's adversarial resolver rounds measured a process-wide
precondition that its call-site repair cannot establish: direct reclaim can inherit Bash functions and startup
state that shadow decision-critical commands. An imported `find` can make both registry ownership measurements
succeed with an empty answer, changing R31's verdict from `containment-unproven` to `reclaimable` and allowing
unattended removal of a live child. The prerequisite establishes a trustworthy Bash entry boundary for the two
direct reclaim argv shapes before automatic reclamation can ship.

## Waves

| # | scope | deploy class | PRs | state |
|---|---|---|---|---|
| 1 | establish an argv-selective privileged Bash boundary for direct `ws-reclaim` and direct `ws-audit --reclaim`; pin hostile inherited environments across supported entry paths; prove fail-shut behavior with mutations; merge current main and open the prerequisite PR | **AGENT-FIRST** | — | **working** — run 199 on `still-harbor`; adversarial plan review tightened protected-environment, kernel-entry and symlink-safe-publication gates before GREEN implementation; no PR |

**Deviation block: eight numbers, the first of them 3696** (allocated once at run 199 open, 2026-09-30; floor
now 3704). The finalized plan defines the first as `ccd-imported-functions-hijack-reclaim-reads`. No other issued
number is rendered as a `D-` token unless a measured departure is defined in that plan; unused headroom remains
unrendered.

## Decisions & deviations

- **2026-09-30 — split from child-reclamation wave 4 by operator ruling.** The existing wave 4 child has opened
  PR #215 and is spent. This repair therefore receives its own run, fresh child, deviation block and PR. It merges
  before #215 may proceed. It is not wave 5 and owns none of wave 5's product scope.
- **The boundary is selective, not a whole-ccd compatibility claim.** In scope are ordinary direct installed-path
  invocations of `ws-reclaim` and the exact `ws-audit --session <value> --reclaim [--defer-expired]` token skeleton
  from the agent, local server, systemd and launchd. The boundary must execute before any Bash body or `BASH_ENV`,
  strip Bash startup/function/option variables from the protected probe and payload environment, select and validate
  a PATH-resolved Bash >=4.4 on Linux and macOS, enter privileged mode, and have the Bash body remeasure both direct
  mode and actual privileged state without trusting an inherited marker.
- **Source mode remains structurally supported.** Fixture calls that intentionally `source ccd/ccd` do not pass
  through the direct-entry boundary. Explicit `bash ccd/ccd ...` exists in tests and in the wider product, but it
  bypasses this pre-Bash launcher and receives no security guarantee from this prerequisite. Detached swap
  self-reexec is outside this narrow claim because its ordinary outer `bash -c` has already started.
- **The plan handoff follows the stronger same-repository `ws-slug-collision` commit-blob precedent.** A fresh
  child starts from `origin/main` and cannot see coordinator-only files. Before run-open the coordinator commits
  and pushes this number-free programme skeleton and the parent-ledger update. After allocation it writes the
  finalized tracked plan with the first issued definition and run/block metadata, then commits and pushes one
  exact handoff SHA. Dispatch names that full SHA and plan path. The worker uses read-only `git show` to copy that
  exact blob byte-for-byte into its checkout, verifies equality, and commits it as its first branch commit before
  code. It does not cherry-pick coordinator ancestry, and this prerequisite does not wait for a separate docs merge.
- **2026-10-01 — adversarial plan review tightened, never relaxed, the dispatched boundary.** `bash -p` suppresses
  startup processing in that Bash but leaves hostile startup variables available to an ordinary child Bash, so the
  protected probe and payload now share a sanitized environment. The same review made two fail-shut publication
  claims executable: the staged launcher crosses its kernel shebang before publication, and exact destination
  entries are inspected without following symlinks and then atomically replaced or refused by type. The audit
  classifier's claim is narrowed to its exact token skeleton; the body remains the session-id grammar authority.
- **Routing escalation.** This is a destructive-path security boundary reached after repeated wave 4 resolver
  rounds exposed the process-level class. The main loop runs Opus at `xhigh`; implementation subagents run Sonnet
  at `high`; workflows are off; compact threshold is 40. The held-out review remains outside that routing and adds
  an Opus `xhigh` destructive SAFETY lens to the standard panel.
- **Rollout is automatic-updater-only.** After merge, observe the release and ccrc's own convergence read-only.
  No session manually rolls out this programme.

## Carried constraints

- Fixture HOMEs only. Never run `ws-reclaim`, `ws-reap`, `ws-rm`, `ws-gc --prune`, `ws-archive`, `ws-restore` or
  any other destructive ccd verb against the live HOME.
- Protect inherited Bash startup, function and option state across supported installed direct reclaim entry:
  `BASH_FUNC_*`, `BASH_ENV`, `ENV`, `SHELLOPTS`, `BASHOPTS` and `CDPATH` are absent from the protected probe and
  payload environment, so a trusted child Bash cannot re-consume them. Runtime PATH and the executables it selects
  are trusted prerequisites; privileged Bash does not authenticate them. A failed or unmeasured decision-critical
  command still fails shut.
- The rendered Python launcher is executable evidence, not only text: install and fallback deploy reject an
  unencodable or overlong absolute interpreter shebang and execute the staged launcher through the destination
  kernel before publishing either active file. Runtime body metadata does not follow symlinks, and both publication
  lanes replace or refuse each wrong destination type without moving a staged file through a symlinked directory.
- Preserve supported production entry on Linux and macOS. macOS uses a PATH-selected Homebrew Bash because
  `/bin/bash` 3.2 is unsupported. The standing operator ruling makes macOS CI legs non-gating, but portability
  evidence and fixture probes remain required and must be reported honestly.
- `ccd/ccd` is generated: re-stamp every edit. Every insertion above a frozen citation anchor pays S6-R11 with
  the real selector `-t 'every line citation is anchored'`; locate code by content, not historical line numbers.
- Every new guard ships with a deletion or bypass mutation that turns a green control red, then is restored.
- Commit on the child's own workspace branch, never a separate feature branch. One child opens one PR.
- The prerequisite's official acceptance comes only from a distinct review run reading one server-accepted exact
  tip in its own worktree: three Opus `high` lenses, three Sonnet `high` refuters per finding, plus the mandatory
  Opus `xhigh` destructive SAFETY lens. A dead or empty lens is unverified, never approval.

## Next-wave brief

One wave, four machine-readable units mirrored exactly in the dispatch body (the strings omit terminal
punctuation):

1. `Install the argv-selective privileged Bash boundary for direct reclaim entry`
2. `Pin hostile inherited environments across every supported reclaim entry path`
3. `Prove fail-shut reclaim behavior with second-command and authorization mutations`
4. `Merge current main, run the required gates, and open the prerequisite PR`

The brief names `superpowers:executing-plans`, the finalized absolute plan artifact, the exact eight-number block,
and the routing above. It explicitly excludes wave 5's reclaim chip, R25/R36 orphan temp-root collection, wave 5
attention-list questions, unrelated wave 4 fixes, detached swap self-reexec, deployment and live fleet mutation.
After this PR merges, wave 4's `swift-hollow` child merges `origin/main` (never rebases), regenerates and re-stamps
`ccd/ccd`, produces a fresh exact handoff, and only then becomes eligible for official review.
