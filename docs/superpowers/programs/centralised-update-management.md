# Program: centralised-update-management

Spec: `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md` (approved by the operator
2026-09-20; revision 3)
Plans: `docs/superpowers/plans/2026-09-20-centralised-update-w1-release-and-provenance.md` (W1, merged);
one plan per later wave, written by the coordinator immediately before that wave's run opens, so its anchors
are measured against the `main` the wave actually starts from.
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-bright-river`   Workspace: per-wave (each wave spawns)

**What this program is.** Nothing tells the operator a release exists, a failed update needs ssh, and every
fact about a box is a `{own, fleet}` pair. This programme gives ccrc two release channels on one version line,
Sigstore provenance verified on every node, a central control plane in `coord.db` (a release catalogue, a node
inventory, desired-state intent projected to the nodes), a `/settings` screen with the channel selector, a
one-tap update from the PWA, health-gated auto-rollback, and versioned installs behind an atomic symlink.

## Waves

The spec names five waves (§15). Its W4 is split across two runs here, because its node-side half (bash:
`ccd/ccrc`, the sync puller, the watchdog, doctor) and its server-side half (the dispatcher, the agent op, the
two routes, the PWA controls) share no file and review better apart. Programme wave numbers are the RUN
numbers; the spec wave each one implements is named beside it.

| # | spec wave | scope | deploy class | PRs | state |
|---|---|---|---|---|---|
| 1 | W1 | release side + provenance: prerelease per merge, `stable` promotion, Sigstore verify, tag binding, floor | both | #161 (`d41335b3`), #162 (`f0cb8743`), #164 | **merged; rolled out 2026-09-21** (v0.0.11, verified). Ran before this ledger existed, outside the run machinery |
| 2 | W2 | control plane, read-only: `MIGRATIONS[13]`, catalogue poller, node inventory, resolver, projection route + server-role writer, `GET /api/updates`, intent/refresh/ack, derived `builds` | agent-first (read allowlist), then server | — | **fix round 1** (run 128, PR #176); review run 134 at `a35f5e7c`: 21 findings survived; plan `1288beec` |
| 3 | W3 | `/settings`, `UpdateBanner`, release push once per tag, move controls DISABLED | server | — | **run 130 open, planned**; plan `d638c602`; dispatches when wave 2 merges |
| 4 | W4 part A | node side: `ccd-update-sync`, the projection reader in `cmd_update`, `--channel/--detach/--from/--no-gate`, the lock, `update.json`, `previous`, `install-step`, the health gate, `_upd_restore` arms 2–3, `ccrc rollback`, the watchdog, doctor `provenance` + unarmed-exposure, `ccrc channel`, `--check caps=`, `rollout --channel`, the W4 cap words | fleet-first | — | **paused for wave 2's merge** (run 129, `ccrc-pwa-keen-meadow`): Tasks 1–14 at `2fe02e2d` (2026-09-23 16:4x UTC); plan `4b361c00`; tasks 15–16 follow wave 2's merge |
| 5 | W4 part B | convergence: `update/dispatch.ts`, the agent `update` op + `ops` on ready, `apply`/`rollback` routes, the PWA controls enabled | agent-first | — | **run 132 open, planned**; plan `6acbff6d`; dispatches when waves 2, 3 and 4 have merged |
| 6 | W5 | versioned installs: `~/ccrc-versions/<tag>` + symlink flip, migration + crash recovery, restore arm 1, GC, `ccrc versions`; the rehearsal | fleet-first | — | **run 133 open, planned**; plan `079f1881`; dispatches when wave 4 has merged |
| — | — | final rollout: promote to `stable`, `ccrc rollout`, the exit criteria measured live | — | — | planned |

**Order.** 2 → {3, 4} → {5, 6} → rollout. Waves 3 and 4 touch disjoint files (PWA + notifier vs `ccd/ccrc` +
deploy units) and both need only wave 2's interfaces, so they may run concurrently on two workspaces once wave 2
has merged; wave 5 needs wave 3's controls and wave 4's `--detach`/`rollback`; wave 6 edits the same install
spine as wave 4 and follows it, and is disjoint from wave 5. Parallel dispatch happens only after a
`GET /api/claims` read and a claim per wave (coordinator clause 10).

## Decisions & deviations

- **2026-09-22 — the operator's directive.** "Act as the coordinator and take this programme to full completion
  and then rollout." Read as: every remaining wave is authorised, each wave's PR is admin-merged
  (`gh pr merge --squash --admin`, the one-approval ruleset nobody else can satisfy) once its review run is
  clean and its required checks are green, and the fleet is moved by `ccrc rollout` at the end. Genuinely new
  decisions (a spec reshaping, anything irreversible outside the spec) still go to the operator.
- **Plans are written per wave, by the coordinator, against the tree the wave starts from.** The spec's anchors
  were measured at `7d78b376`; W1 has since moved `ccd/ccrc` by hundreds of lines. Each plan is preceded by a
  measured understand sweep and followed by a review of the plan itself before dispatch.
- **The plan travels in the wave's own PR.** The plan is committed alone on the coordinator's branch; the
  worker's first act is to cherry-pick that one commit onto its workspace branch, so the PR carries the plan it
  implements and its `## Deviations found` section, exactly as W1's PRs did.
- **Deviation blocks are minted per RUN, at run-open**, sized from W1's measured rate (35 numbers over 14 tasks,
  most found by review rather than planning). A worker never mints; it names a departure in its mail and the
  coordinator assigns from the block.

- **Wave 2's plan (2026-09-23).** `docs/superpowers/plans/2026-09-22-centralised-update-w2-control-plane.md`, 15
  tasks, committed alone as `1288beec` and cherry-picked by the worker. Written by the coordinator's workflows: a
  ten-reader understand sweep at `d759c914`, an interface skeleton, fifteen task bodies (several measured in scratch
  copies of the tree), a fix pass applying thirteen rulings, then an eight-lens review (Opus) with two Sonnet
  refuters per finding — 28 survived, 5 refuted, all 28 applied. Rulings that cross waves: `~/.ccrc/update.json`
  times are unix SECONDS; the report reader ignores unknown keys (wave 4 adds `pid`); the projection route answers
  `text/plain`. The spec's §12 says six session doors; wave 2 registers the four it owns, wave 5 adds the other two.
- **Wave 2's deviation block.** The plan's thirty-three departures are D-3174 through D-3206, issued to run 128
  and defined in that plan. A reserve of twenty more, from 3207 (written bare here because none is defined yet),
  was issued to the same run; the worker spends it in order and defines each where it first cites it.

- **Wave 4's plan (2026-09-23).** `docs/superpowers/plans/2026-09-22-centralised-update-w4a-node-side.md`, 16
  tasks; the same pipeline as wave 2's (ten-reader sweep, skeleton, bodies, a rulings fix pass, then six Opus lenses
  with two Sonnet refuters per finding: 24 of 30 survived, all applied — one critical, Task 8 reddening Task 5's
  gate cases). Rulings R14–R18: `update.json` times are SECONDS on this side too; the `pid` key stays; the lock probe's
  unmeasured answer has an arm in every caller; W2's committed plan wins every shared name; and **R18 — operator
  ruling D-139 ("a fresh install ends green") stands over spec §11's WARN**: doctor's `provenance` check reports an
  `unsigned` mark as a PASS carrying next-steps text, because W1's D-3117 widened that mark to every first install and
  the spec's WARN sentence names `--allow-unsigned` only. Reversible by the operator.
- **Waves 2 and 4 run concurrently, with one bounded claim overlap.** Wave 2's claims (731, 732) hold `README.md`,
  `CLAUDE.md` and `server/test/single-definition.test.ts`, which wave 4 also edits. Ruled acceptable and bounded: wave
  4's two `single-definition.test.ts` edits (Tasks 6, 9) are inside the `BOX_INSTALLED_FILE` census describe, which
  wave 2 does not touch (wave 2 only appends describes and edits the import line); wave 4's README/CLAUDE.md edits are
  all in Tasks 15–16, which begin only after wave 2 has merged and its claims are released. Wave 2 merges first; wave 4
  merges `origin/main` in before Task 15.

- **Wave 4's deviation block.** The plan's forty-seven departures are D-3227 through D-3273, issued to run 129 and
  defined in its plan; a reserve of twenty more, from 3274 (bare here, none defined yet), was issued beside it.
- **Found dispatching wave 4 (for the operator; not this programme's to fix).** The first dispatch of run 129 answered
  a bare 502: `ccd ws-add` chose the workspace name `amber-mesa`, whose branch `ws/amber-mesa` still exists from an
  archived workspace, and `git worktree add` refused. Nothing was spawned or held (measured: no worktree, no registry
  rows, no tmux session, run still `planned`), so the retry was safe and landed on `keen-meadow`. The name picker does
  not check for an existing branch.

- **Wave 3's plan and block (2026-09-23).** `docs/superpowers/plans/2026-09-23-centralised-update-w3-settings-and-notification.md`,
  13 tasks, committed alone as `d638c602`; one combined pipeline (skeleton, bodies, fix, six Opus lenses with Sonnet
  refuters: 14 of 21 survived, none critical, all applied). Its twenty-one departures are D-3294 through D-3314,
  issued to run 130 and defined in that plan; a reserve of fifteen more, from 3315 (bare here), issued beside it.
- **Wave 5's plan and block (2026-09-23).** `docs/superpowers/plans/2026-09-23-centralised-update-w5-convergence.md`, 9
  tasks, committed alone as `6acbff6d`, written against the three committed producer plans (19 of 26 review findings
  survived, none critical, all applied). Its thirty-four departures are D-3370 through D-3403, issued for run **132**
  and defined in that plan; a reserve of fifteen, from 3404 (bare here), beside it. The allocator's title for the
  thirty-four says "run 131" — a typo of this session's (the run opened as 132 because another programme took 131
  between the plan and the open); the allocation log is append-only, so the correction lives here.
- **Wave 6's plan and block (2026-09-23).** `docs/superpowers/plans/2026-09-23-centralised-update-w6-versioned-installs.md`,
  9 tasks, committed alone as `079f1881` against wave 4's committed plan (31 of 36 review findings survived, none
  critical, all applied). Its thirty-nine departures are D-3419 through D-3457, issued to run 133 and defined in that
  plan; a reserve of fifteen, from 3458 (bare here), beside it. Ruling R19: a plain `ccrc install` does not hold the
  update lock across its placement and flip — the flip re-measures its target instead (D-3456 names the residual).
- **A planning agent detached this worktree's HEAD** (2026-09-23 ~13:00 UTC: reflog `checkout: moving from
  ws/pwa-update-programme-coordination to d759c914`) despite a read-only instruction; the wave-6 plan commit first
  landed on the detached HEAD (`ebf7e774`) and its push failed silently. Restored by checking the branch out and
  cherry-picking (`079f1881`); both workers' worktrees measured untouched. Later plan pipelines run their agents in
  scratch copies of the tree, never this worktree.

- **Wave 2's wave-done (2026-09-23).** PR #176 at `a35f5e7c` (fingerprint re-measured: branch tip, PR open, clean
  tree, 30 commits, all under the noreply identity). Six reserve numbers spent (D-3207…D-3212, each defined in the plan). The
  worker's gate ran six `/6` shards, not the brief's `1/3`+`3/6…6/6`: at this file count vitest's `1/3` shard ends one
  file before `3/6` starts, so the brief's split skips a file. Later briefs use `K/6` for K = 1…6. Its one red,
  `tmp-sweep.test.ts`'s FAILS CLOSED case, reproduces on a clean `main` worktree on this box (#168). The worker raised
  eight items for later waves. They are ruled with the review report, not before it. Review run 134 carries two
  wave-specific lenses beside the panel (security/untrusted input; interface fidelity against waves 3–5's committed
  plans).
- **The catalogue's page window, measured 2026-09-23:** 18 releases published; the current stable (v0.0.11) is the 8th
  newest. At about three merges a day, GitHub's first page of 30 stops showing it in about four days, and the seeded
  `'*'` → stable default would then resolve to "no eligible release". That fails safe but is wrong, so it must be fixed
  before rollout.

- **Review run 134 on wave 2 (2026-09-23), at `a35f5e7c`.** The held-out panel ran with two wave-specific lenses: 86
  agents, no lens unverified, no finding unexamined. 21 findings survived, 6 important and 15 minor; 4 were killed and
  kept. Survivors per lens:
  - correctness 4, spec 2, security 5, does-it-reproduce 3, interface fidelity 8;
  - one finding (F3, a credential in the boot log) was found by two lenses.

  Ruled **send back** (fix round 1; rulings in the `fix-round` mail's artifact). Every finding in W2's own code is
  fixed in this round:
  - the unmeasured-read-as-absent collapse (floor, previous, first-sweep report);
  - a stamp judged unread;
  - the credential leak;
  - redirects;
  - the download-URL check;
  - the tag length and leading-zero rule;
  - the symlink guarantee;
  - the route census's verbs;
  - the writer-group scan's literal-only check;
  - the basename-list pin.

  The worker's raised items are also in this round: the catalogue's page window (a conditional `releases/latest` per
  poll), a NULL-`startedAt` report never moving a lease, and a CLAUDE.md line on `req.log` being a no-op.

  **Not in the round:** F4–F6, F17–F19 and K4 are the committed plans of waves 3–6 drifting from what W2 shipped (a
  widened result arm, one constant replacing two, a catch and a dedupe key the fix rounds improved). W2 is right in
  every case. The coordinator re-points those plans against the merged tree after W2 merges, and sends wave 4's
  worker its K4 re-pointing with the merge sha.

  Recorded and outside this programme: no `setErrorHandler` anywhere in `server/src` (predates this wave, affects
  every route).
- **A review run's close needs `working` first (found 2026-09-23).** Run 134 was still `dispatched` when its
  `review-done` arrived. `REVIEW_RUN_TRANSITIONS` has no `dispatched` → `done` edge, so the close answered
  `bad-transition`.
  - Advancing it to `working` succeeded only with the WORK fingerprint shape (`branchTip`…); the review shape
    (`reviewedTip`, `report`) answered a bare `400`.
  - The work run 128 likewise sat at `dispatched` through its whole execution.
  - The coordinator skill's step 6 names neither. That is a skill/mechanism gap, reported to the operator.

- **Fix-round addenda for wave 2 (2026-09-23).**
  - **F11 (R20).** `RELEASE_TAG`/`isReleaseTag` stay byte-equal to `deploy/release-main.sh`'s `SHAPE`, which
    `update-states.test.ts` pins cross-side. The same pattern also lives in `deploy/*.sh` and `ccd/ccrc`, which are out
    of scope. The untrusted ingress is bounded instead: the catalogue parse skips a tag over 64 bytes or with a
    leading-zero component, and the intent route applies the same bounds if it takes a `pinnedTag` that is not a
    catalogue row. Tightening the shared `SHAPE` is a follow-up for `deploy/` and `ccd/`, outside this programme.
  - **macOS leg.** PR #176's `test-macos` was cancelled at the job's 55-minute cap, and so was `main`'s on each of its
    last four pushes (runs 35866485855, 35854286310, 35846285819, 35772125485; since 2026-09-22 19:11 UTC). The cap is
    main-wide, not this wave's.
    - `main` requires no status check (its only rule is `pull_request`), so it blocks nothing. It also measures
      nothing, on every PR.
    - This programme judges macOS from the Linux legs plus `probe-macos`, and reports the cap to the operator. The fix
      belongs to the CI-selection work.
    - The wave-2 worker adds a `timeout` to every `spawnSync` its tests added (the correct shape regardless).
  - **The fleet's gh API quota.** All 5000 calls an hour were used by 15:20 UTC. The coordinator's own CI reads now
    stay few.

- **Wave 4 reached its pause (2026-09-23).** Tasks 1–14 are committed at `2fe02e2d`, and every task passed its
  per-task review. Eight reserve numbers are spent (D-3274…D-3281), each defined in the plan:
  - D-3274: the lock tells contention from a flock that could not run.
  - D-3275: a restore child exiting 3 counts as restored.
  - D-3276: the watchdog never rolls back a pre-install-phase or unversioned report.
  - D-3277: the watchdog re-reads the report under its lock.
  - D-3278: three failing probe samples.
  - D-3279: an epoch over 18 digits is refused.
  - D-3280: the body is validated as bytes from a bounded temp file.
  - D-3281: `rollout` refuses a box whose floor is newer than the target unless `--downgrade`.

  The worker made plan-text corrections without numbers (test and anchor defects, not spec departures). It follows the
  Global Constraints' reserve-number rule over Task 15's slug wording. It shares `session-hook.test.ts` narrow hunks
  with runs 131 and 138 under its claim 733; whichever merges second re-measures the census. Its wake mail carries W2's
  merge sha and the K4 re-pointing: `REPORT_TIME_MAX_S`/`MAX_UNIX_S` became `shared/api.ts`'s `UNIX_SECONDS_MAX`.

## Carried constraints

From W1's whole-branch review (minors, not patched in W1) — each lands in the wave named:
- **M1** (wave 4): a floor-write failure is misattributed to doctor.
- **M2** (wave 4): the verifier's issuer check is pinned by nothing.
- **M3** (wave 4): `ccrc update --check` never consults the floor, so `ccrc rollout`'s preflight cannot see
  one; a fleet move onto a tag below one box's floor passes preflight and fails at that box's install — with
  `--server-first`, after the server already moved.
- **M4** (wave 4): `rollout` cannot express `--downgrade` / `--allow-unsigned`.
- **M6** (wave 4): `install.sh` does not strip an ambient `CCRC_UPDATE_VERIFIED`.
- **M7** (wave 4): no test that `--force` cannot bypass the floor.

Two trust roots to state durably (wave 4's README pass): the verifier's npm dependencies come from npm, not
the attested tarball; `CCRC_SIGSTORE_TRUSTED_ROOT` lets environment control substitute a root. The vendored
trusted root is dated — if it outlives an upstream key rotation it refuses every newer bundle.

## Next-wave brief

**Wave 2 (run 128) — dispatched 2026-09-23.** The brief as sent is the plan's path and sha, tasks 1–15, execution
skill `superpowers:subagent-driven-development`, routing Opus · high main loop / Sonnet · high implementers / Opus ·
high per-task reviewer / workflow off / compact 40, the deviation block and reserve above, the migration-slot
re-measure, the concurrent-wave boundary (wave 2 never edits `ccd/`, `deploy/`), the sharded full-suite gate, and
"wave-done in the same turn as the push; never end a turn to wait on CI".

**Wave 3 and wave 4 plans** are in preparation; wave 4 may be dispatched while wave 2 runs, and merges after it.
