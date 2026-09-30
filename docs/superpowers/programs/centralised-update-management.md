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
| 2 | W2 | control plane, read-only: `MIGRATIONS[13]`, catalogue poller, node inventory, resolver, projection route + server-role writer, `GET /api/updates`, intent/refresh/ack, derived `builds` | agent-first (read allowlist), then server | — | **MERGED** `b501698a` (PR #176, run 128 done), released as v0.0.23 (dev); after round 5's scoped review, run 151 at `985e8c30`: no new behaviour defect; 7 findings carried to wave 5's Task 8A; plan `1288beec` |
| 3 | W3 | `/settings`, `UpdateBanner`, release push once per tag, move controls DISABLED | server | — | **MERGED** `4b2ff904` (PR #184, run 130 done) 2026-09-24 ~19:00 UTC; **DEPLOYED** on both boxes as v0.0.27 (calm-mesa's rollout, 20:23 UTC, `rollout --check` current/current; live exit criteria are phone-side and measured at the final rollout), after scoped review 161 at `e5ddd3ba` met none of the committed bar's four classes; 13 findings carried to wave 5's Task 8A (`d8db956a`); plan `d638c602` + re-points `08cecd10`, `733d295a` |
| 4 | W4 part A | node side: `ccd-update-sync`, the projection reader in `cmd_update`, `--channel/--detach/--from/--no-gate`, the lock, `update.json`, `previous`, `install-step`, the health gate, `_upd_restore` arms 2–3, `ccrc rollback`, the watchdog, doctor `provenance` + unarmed-exposure, `ccrc channel`, `--check caps=`, `rollout --channel`, the W4 cap words | fleet-first | — | **MERGED** `023fe94d` (PR #181, run 129 done) 2026-09-28 16:53 UTC, released as v0.0.35 (dev). The merged tree is byte-identical to the tip CI tested (`d1eed83f`, which merges `main` at `6ff4e2e9` with an empty remerge-diff); every Linux leg was green there. Scoped review 173 at `f546715d6` closed its rounds. F1r (ruled) and nine prose/pin items carry to wave 6's Task 8A (`4e05173a`). Earlier: **accepted; merging** (run 129): scoped review 173 at `f546715d6` closed 2026-09-28 16:30 UTC. Round 2 did what was ruled. One arm-3 wording defect (F1r, ruled) and nine coverage/prose items carry to wave 6's Task 8A (`rulings-run173.md`). `main` moved to `6ff4e2e9` (#187, #188) after CI started, so the worker merges it and CI's Linux legs re-run before `gh pr merge`. Was: narrow round 2 done 2026-09-28 15:45 UTC (F1+F2, F4; no new number; the census is back at `main`'s 5); scoped review run 173 dispatched 15:50 UTC to `ccrc-pwa-swift-summit`. Round 2 was sent 2026-09-25 02:35 UTC on scoped review 167 (`rulings-run129-fix2.md`). Was: scoped review at `7a20ff8f`, which merges `main` at `3fd6c816` with W3's README overlap resolved as ruled; fix round 1 done 2026-09-25 01:40 UTC (3288, 3289 and 3290 spent); scoped review run 167 dispatched 01:50 UTC to `ccrc-pwa-quiet-meadow`, under the bar in `rulings-run129-fix1.md`; round 1 sent 2026-09-24 14:25 UTC on review 155; wave-done was at `05b9ac4f`, PR #181, 16/16 items, reserve spent: 14 numbers, 3274 through 3287 (bare: their definitions are on the worker branch); review run 155 dispatched 09:55 UTC to `ccrc-pwa-keen-cove`; CI Linux legs green at the tip, `test-macos` cancelled at the 55-min cap; a scratch macOS run of the wave's 19 changed test files at `05b9ac4f` PASSED (1493 passed, 154 skipped; run 35984326446, branch deleted); plan `4b361c00` |
| 5 | W4 part B | convergence: `update/dispatch.ts`, the agent `update` op + `ops` on ready, `apply`/`rollback` routes, the PWA controls enabled | agent-first | — | **MERGED** `af5a29f8` (PR #201, run 132 done) 2026-09-29 06:40 UTC, released as v0.0.36 (dev). The merged tree is byte-identical to the tested tip `325d4072` (`main` unmoved at `023fe94d`, every Linux leg green). Scoped review 176 met none of the committed bar's four classes; F1 and F2 to F5 go to the residue list as R5 and R6 (`rulings-run176.md`). Earlier: **run 132 open, planned**; plan commits in cherry-pick order: `6acbff6d`, `287caa07`, `7210c4f6`, `a8c28b42`, `a404b1ac`, `419d626f`, `d5f923e8`, `e821ceba`, `fddf8370`, `d8db956a`, `0003a6c3` (re-point against W3's merge `4b2ff904`), `8d6f2515` (re-point against wave 4's reviewed tree `f546715d6`); **final scoped review** (run 176, dispatched 2026-09-29 06:00 UTC to `ccrc-pwa-soft-delta`) of fix round 1, done at `325d4072`: 33 commits, no merge (`main` unmoved at `023fe94d`), numbers 3411, 3412 and 3413 spent (bare: their definitions are on the worker branch). After it, #201 merges under the committed bar. Was: fix round 1 (`rulings-run132-fix1.md`, mail 2514, 2026-09-28 22:55 UTC) on review 175 at `8e9a9bf3`: 15 findings, the two important ones (F1, F2) ruled together, and the bar for the one scoped review after it committed now. Was: wave-done 2026-09-28 at `8e9a9bf3`, PR #201, 10/10 items, reserve spent: seven numbers, 3404 through 3410 (bare: their definitions are on the worker branch); `main` did not move during the wave; review run 175 dispatched 21:45 UTC to `ccrc-pwa-still-ridge`. Was: dispatched 2026-09-28 16:57 UTC to `ccrc-pwa-warm-harbor` |
| 6 | W5 | versioned installs: `~/ccrc-versions/<tag>` + symlink flip, migration + crash recovery, restore arm 1, GC, `ccrc versions`; the rehearsal | fleet-first | — | **MERGED** in two parts: the first cut as `c1c22489` (#202, 12:46 UTC, not by the coordinator), and fix round 1 as `a742eb6a` (#214, 2026-09-30 ~00:55 UTC, run 133 done; released as v0.0.49). #214's merged tree is byte-identical to its tested tip `29656594`, with `main` unmoved at `0ffa07f3` and every Linux leg green. Its two `test-macos` legs were red; they gate no merge (operator ruling 2026-09-28). Scoped review 181 met none of the bar's five classes; R1 was ruled inside item 2's accepted place (2); its findings are residue R9. Was: **Fix round 1 done** 2026-09-29 at `29656594` as new PR #214 (numbers 3465 and 3466 spent, bare: their definitions are on the worker branch; the full six local shards green at `b686e8d1`, the one later commit is prose); scoped review run 181 dispatched 23:55 UTC; after it, #214 merges. Was: **MERGED mid-round at its pre-round head** `751eb5da` as `c1c22489` (#202, 2026-09-29 12:46:52 UTC), NOT by the coordinator. So `main` carries wave 6 without fix round 1, and the round lands as a new PR from `ws/quiet-basin`. `stable` is held until it merges. Was: **Fix round 1 sent** 2026-09-29 12:05 UTC (mail 2552, `rulings-run133-fix1.md`) on review 179 at `751eb5da`: six behaviour defects the delta introduced, so the bar gives the one full round; a scoped review follows, then #202 merges. Was: **wave-done** 2026-09-29 at `751eb5da` (PR #202, 10/10 items; its one merge of `main` at `af5a29f8` has an empty remerge-diff; every Linux leg green in shadow mode; reserve spent: seven numbers, 3458 through 3464, bare: their definitions are on the worker branch); review run 179 dispatched under the bar committed before it. Was: **run 133 open, planned**; plan commits in cherry-pick order: `079f1881`, `edc98508`, `14f77194`, `e27aacae` (re-point against wave 4's reviewed tree `f546715d6`), `4e05173a` (review 173's residue); **DISPATCHED** 2026-09-28 16:57 UTC to `ccrc-pwa-quiet-basin` |
| 7 | — (residue) | before stable: a fleet-link failure after the op's hand-off holds the lease (R1), the answer follows the lease by identity (R5), wave 5's prose and pins (R6) | server | — | **MERGED** in two parts: the first cut as `6da36f0b` (#203, 12:46 UTC, not by the coordinator), and fix round 1 as `5964e7f2` (#205, 2026-09-29 ~14:47 UTC, run 177 done). #205's merged tree is byte-identical to its tested tip `2e984395`, with `main` unmoved at `1ae3411b` and every Linux leg green. Scoped review 180 met none of the bar's four classes; its five coverage/prose findings are residue R7. Was: **Fix round 1 done** 2026-09-29 at `2e984395` as new PR #205 (it merges `main` at `1ae3411b`; its diff against `main` has exactly the changed lines of the round's own `5f6eae8e..bb5c26f8`, measured; full gate on the merged tree; no number spent). Scoped review run 180 dispatched 14:28 UTC; after it, #205 merges. Was: **MERGED mid-round at its pre-round head** `5f6eae8e` as `6da36f0b` (#203, 2026-09-29 12:46:28 UTC), NOT by the coordinator. Its fix round lands as a new PR from `ws/quiet-summit`, on a merge of `main` with a full gate. `stable` is held until it merges. Was: **Fix round 1 sent** 2026-09-29 11:40 UTC (mail 2550, `rulings-run177-fix1.md`) on review 178 at `5f6eae8e`: its F1, a deadline sentence that can be false, is a behaviour defect the delta introduced, so the bar gives the one round; a scoped review follows, then #203 merges. Was: **wave-done** 2026-09-29 at `5f6eae8e` (PR #203, 4/4 items, no reserve number spent; `main` unmoved at `af5a29f8`); review run 178 dispatched under the bar committed before it. Was: **DISPATCHED** 2026-09-29 07:25 UTC to `ccrc-pwa-quiet-summit` (run 177); plan `c3382e95` (one departure, 3555, defined in it; a five-number reserve named in the brief) |
| 8 | — (live audit) | the live audit's residue: a move's source on record (A), backups pruned after a completed run (B), no one-tap rollback a node will refuse (C), doctor reads the armed gate (D), Settings wording (F), two box lines (G); E dropped by ruling | server + node | — | **Wave-done** 2026-09-30 21:10 UTC at `1eb9b011` (PR #219, 5/5 items). Its one merge of `main` at `1f9fa22d` hand-resolved two conflicts, both end-of-file appends, by keeping both sides (measured by remerge-diff). No reserve number was spent, and `DEP-move-record-kind` did not fire, so it is withdrawn unminted. Review run 196 is dispatched under the bar committed before it. Its merge reaches both boxes by auto within about 35 min. Was: **DISPATCHED** 2026-09-30 12:22 UTC to `ccrc-pwa-soft-ridge` (run 182); plan `8e73f825` (13 departures defined in it, one contingent by slug; a five-number reserve named in the brief). |
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

- **Wave 2's fix round 1 is done (2026-09-23), at `2b5d4ce1`.** Five reserve numbers are spent:
  - D-3213: an unmeasured floor, previous or report is never stored as absent. Two NOT NULL read-state columns join
    `MIGRATIONS[13]`, and an unmeasured floor with no carried value resolves nothing.
  - D-3214: a lease verdict never rests on an unread stamp or an undated report.
  - D-3215: the `releases/latest` probe, plus ruling R21's `releases/tags/K` re-read when the probe moves away from K.
    K is derived from the store, so it survives a restart.
  - D-3216: the download-URL and tag ingress bounds. The intent route did accept non-catalogue `pinnedTag`s, so the
    same predicate now guards it (R20).
  - D-3217: the plan's Interfaces blocks match what ships.

  Two branches were chosen: F12 was made true (node-file `lstat` scoped to the eight basenames), and F15 was narrowed
  (store.ts has 65 interpolated `prepare(` sites, so a literal-only check would red the whole file).

  **R21:** a withdrawn or demoted off-page stable is re-read by tag when the latest probe moves away from it. Residue
  carried to wave 5: an older off-page stable demoted while a newer stable is latest stays invisible, which matters
  only for rollback targets.

  The gate's reds are `tmp-sweep`, which predates the wave, and `boot.test.ts`'s timing case, which alternated green
  and red alone at a load average of 25–38. CI arbitrates.

  **Carried from the worker's parked minors:**
  - wave 3: its *Check now* plus the 30-minute polls must stay inside GitHub's unauthenticated 60/h budget;
  - wave 3 or wave 6: `NodeWire` carries no floor read-state, so a PWA reader would show a carried floor as measured;
  - to the second review: the tag re-read's 200 path does not check that the answer names K.

  Review run 143 carries the panel plus a security lens, over the whole wave, weighted to the fix round.

- **The later plans are re-pointed against W2 as executed (2026-09-23, at `2b5d4ce1`).** A workflow split the plans of
  waves 3 and 5 by task. 22 units were each scanned by an Opus agent against W2's tip tree, patched by a Sonnet agent,
  and checked by an Opus agent against the tree, with a Sonnet fixup where the check found something. That was 75
  agents and about 190 items in all:
  - names that moved (`UNIX_SECONDS_MAX`, `RekeyNodeResult.revived`, `NodeMeasurement`'s `floorRead`/`previousRead`);
  - code that would not compile or would red;
  - two silent catches the plans would have reintroduced;
  - behaviour the fix round changed;
  - about 85 shifted line anchors.

  **Wave 3:** `08cecd10`, cherry-picked after `d638c602`.

  **Wave 5:** `287caa07`, cherry-picked after `6acbff6d`. It carries four new departures, issued to run 132, the same
  day:
  - D-3492: a coordinator ruling. An update on a never-measured floor is refused with its OWN word, `floor-unread`.
    Reusing `stamp-unread` would have told the operator a stamp could not be read when the floor was the problem.
  - D-3493: the dispatch lane warns on a rejection.
  - D-3494: the move routes use the intent route's ingress tag gate.
  - D-3495: rollback's `no-previous` says when the previous file was never measured.

  It also carries R21's residue as a Global Constraint.

  **Wave 6:** unaffected; no task names W2.

  **Wave 4:** its plan is held by its worker, so it got a report only: 28 items, every one verified against the tree.
  That report is the artifact of its wake mail.

- **Review run 143 on wave 2 (2026-09-23), at `2b5d4ce1`.** The panel plus a security lens: 94 agents, no lens
  unverified, no finding unexamined. 25 survived and were merged into 16 (6 important, 10 minor); 5 were killed and
  kept. Ruled **send back, fix round 2, announced in its ruling as the LAST full round**. From review round 3, only a
  shipped-behaviour defect goes back. A coverage gap or false prose is carried to programme wave 5, which edits
  `server/src/update/` and `store.ts`, and #176 then merges with it recorded.

  **Shipped-behaviour defects, fixed now:**
  - R1: the refresh door counts every catalogue request, and its interval is derived from the per-poll maximum.
  - R2: a tag-check 404 yanks only when the same poll's listing answered 200. A repository-wide 404 had been yanking
    one stable per poll, for good.
  - R4: `NodeWire` gains optional `floorRead`/`previousRead`, always sent.
  - R7: the download URL is stored normalised, and a raw backslash is refused.
  - R8: a tag answer must name the tag asked for.
  - R9: no numeric component over 18 digits, the bash twin's ordering limit.

  **Coverage gaps and false prose, fixed by class:** R3 (a disarmed guard), R5 (D-3217's Interfaces), and R10–R16.

  **Carried:** R6 (the later plans) is the coordinator's second re-pointing pass after the merge. X1 goes to wave 5 as a
  known limitation: a garbled floor reads `absent` on the server while the node refuses it, which fails safe as a
  named halt.

  `main` moved to `a3a93b41` (#177) during the review. The tip merges clean onto it, and `MIGRATIONS[13]` still holds.

- **Wave 2's fix round 2 is done (2026-09-23), at `1258a57a`, after merging #177.**
  - **D-3218 (R1):** every catalogue request stamps the budget clock, and the refresh door's interval is derived from
    the per-poll maximum, the 60/h budget and the scheduled poll's own share: 200 s today.
  - **Amended in place:** D-3213 through D-3217, for R2, R4, R5, R7, R9 and R11.
  - **The worker's own review also caught S1:** the probe and the tag fetch never stamped the clock, and a throwing
    store read rejected `poll()`. Both are fixed.
  - **Mutation reds measured:** R3, R11, R12, R13 and R14's controls.
  - **Carried to wave 5 under the round-3 rule:** C-a (the tag check's own clock stamp is unpinned), C-b (the second
    `measuredCurrentK` site is unpinned), C-d (the warning is never re-armed after recovery, now documented), and
    three plan nits.
  - Review run 146, the final one, classifies each finding as behaviour or coverage/prose.
  - In parallel, the coordinator's second re-pointing pass (R6) runs against `1258a57a`. It covers every
    `NodeMeasurement`/`NodeRow`/`NodeWire` literal in waves 3 and 5, fix round 2's changes (including wave 3's copy
    for the refresh door, which is no longer "a minute"), and an addendum for wave 4.

- **Review run 146 on wave 2 (2026-09-23), the final one, at `1258a57a`.** 77 agents, no lens unverified, no finding
  unexamined; 23 survived and were merged into 14, and 1 was killed. The rule announced in round 2 applied as written:
  - **Behaviour → narrow fix round 3:**
    - B1: one throwing store read on the `/latest` 200 arm lost K until restart.
    - B2: R2's gate yanked K even when the same fresh listing named K, so the yank alternated every poll. **Ruling: the
      listing wins over `releases/tags/K` in the same poll.**
    - B3: the derived interval had zero headroom for a restart's immediate poll and for late sends. Each request now
      stamps at send time, with a named margin term.
  - **Coverage/prose → carried:** P1–P11, plus the worker's round-2 C-a, C-b, C-d and three nits. The escape hatch has
    to be real, and wave 5's planned tasks do not touch `catalogue.ts`. So the coordinator adds a residue task to wave
    5's plan (between its Tasks 8 and 9) holding each item. The review after round 3 is scoped to round 3's delta and
    sends back only a behaviour defect in it.

- **Wave 2's narrow fix round 3 is done (2026-09-24), at `24e3379c`, after merging #178/#179.** No new number;
  D-3215 and D-3218 are amended in place.
  - B1: a throwing store read on the `/latest` 200 arm is a failed probe.
  - B2: the listing wins; a pending yank or demote is dropped when the fresh listing names K.
  - B3: each request stamps the clock at its own send time, with a named margin (`MARGIN_POLLS_PER_HOUR = 1`), so the
    interval is 211,765 ms.
  - The worker's Opus task review approved it with 5 minors: m3 and m5 are fixed as prose, and m1, m2 and m4 go to
    wave 5's Task 8A. m1 is a behaviour edge only a draft-listing mirror can reach, and the "non-draft" wording
    governs.
  - Review run 149 is scoped to the four round-3 commits.
  - **Committed before its results exist:** a behaviour finding reachable only through a non-default release source
    (a `CCRC_RELEASE_API_URL` mirror) carries to Task 8A. Only a behaviour defect reachable against the default source,
    in round 3's delta, goes back.

- **Review run 149, scoped to round 3, at `24e3379c` (2026-09-24).** 42 agents, 3 Opus lenses; 7 findings.
  - B1, B2's alternation, and B3 are closed.
  - **F1** is an important behaviour defect that round 3 introduced and the default source reaches (an ordinary
    `gh release edit --prerelease`). A pending `'demote'` that the listing CONFIRMED was dropped, so the kept tag stayed
    pinned to K: 3 requests every poll, and a later-deleted off-page stable stayed resolvable until restart. The
    cause was the coordinator's B2 ruling's shape.
  - **Ruling reshaped:** the listing wins only when it DISAGREES with the tag check. When the two agree, the pending
    action applies and the kept tag moves. Draft rows never vouch (m1).
  - F3, a minor behaviour defect in the same arm (a persistent store throw disabled the kept tag), rides with F1.
  - F4 and F5 go to Task 8A. F6 and F7 are the same sentences F1's amendment rewrites.
  - **Round 4 is the last send-back of any kind.** After its scoped review, #176 merges, unless round 4's delta yanks a
    release it should not, keeps a withdrawn release resolvable, or leaks a secret.

- **Wave 2's narrow fix round 4 (the last) is done (2026-09-24), at `6213231a`.**
  - F1: the reshaped ruling. The listing wins only on disagreement; on agreement `applyWithdrawn` runs; draft rows
    never vouch.
  - F3: a `kNeedsReread` flag. A throwing 200 arm keeps T and re-reads K next poll.
  - F6 and F7: prose.
  - **The worker extended the ruling once.** Its own Opus task review found that a stale "still stable" `tags/K`
    beside a fresh dev listing counted as agreement and re-promoted a demoted K. So a demote now applies only when both
    the check and the listing say non-draft dev: the ruling's headline, applied. That extension is the worker's call,
    and an Opus re-review approved it.
  - Carried to Task 8A: the worker's m2 and m4.
  - **Merge-bar scope, recorded before review run 150 reports:** its three reopening conditions apply to states a
    HEALTHY `coord.db` can reach. A store that throws on every read is a corrupt database, a different failure class,
    and is carried. This settles the worker's m2 (an always-throwing store plus a later `/latest` 404 keeps a deleted T
    protected) in advance.

- **Review run 150, scoped to round 4, at `6213231a` (2026-09-24).** 60 agents; 10 findings.
  - Review 149's F1, F3, F6 and F7 are closed.
  - **F1 met the round-4 bar's condition 2**, and only it: introduced by 66e97ac2, it keeps a withdrawn release
    resolvable. A stale non-draft `tags/K` un-yanks a K that the same listing names as a draft. The bar carried no
    source qualifier, so the reachability limit (a draft-listing mirror only) did not exempt it.
  - It went back as a one-line round 5 with the reviewers' measured remedy: a draft listing row contradicts a
    non-draft demote check.
  - Carried to Task 8A: F2 (a store that throws on every read, outside the healthy-db scope); F3 and F4 (behaviour,
    predating round 4: a live off-page K yanked after a confirming check, and a deleted K kept resolvable by a stale
    check beside a complete listing); F5–F10 (prose).
  - **Committed before round 5's review exists:** after it, #176 MERGES, full stop. Everything it finds carries.
  - Lesson recorded in the coordinator's memory: a merge bar must carry forward every qualifier the previous bar had,
    or say that it dropped one.
- **2026-09-24 — review run 151 (round 5's scoped review, `985e8c30`): #176 merges, as committed.**
  - It closes review 150's F1: both new pins red at `6213231a`'s predicate, and the yank row is unchanged. The panel
    confirmed 16 of 16 raised findings, consolidated into 7, and found no new behaviour defect at either call site.
  - Carried to wave 5's Task 8A: F1 and F2 (coverage: the `!pending.row.draft` carve-out and the ETag-keep call site
    are unpinned); F3–F5 (prose); F6 and F7 (BEHAVIOUR residuals, not introduced by round 5).
  - **Ruling on F6.** In the draft-listing drop cell, the listing itself yanks K, so the drop skips only K's upsert.
    The kept tag still moves to `/latest`'s T. The non-draft drop cells stay as W2 shipped them.
  - **Ruling on F7.** F6's fix closes it (K stops being the kept tag), and review 150's F4 fix closes it again.
  - **Tie-break for every carried behaviour item.** When a mirror's answers disagree and no listing names K as
    non-draft, the outcome that leaves K yanked wins. No new column is added.
  - **Why merging with these open is safe:** W2 is read-only. Nothing moves a node from the catalogue until wave 5's
    dispatcher, and Task 8A lands in that same PR. A deleted release also has no tarball left to install.
- **2026-09-24 06:40 UTC — wave 4 edits `ccd/ccrc` and `ccd/ccrc-doctor-checks` under another programme's claim.**
  - Wave 4's final review wants fixes inside its own update functions. Claim 749 (child-reclamation wave 3, run 148)
    holds both files, and its holder had not read two mails all morning.
  - Measured first: that branch touches `ccd/ccd` only, with no hunk in either file. Claim 749 is a broad 30-path
    claim.
  - Ruled yes, on the advisory terms (whoever merges second resolves), with conditions: only wave 4's named
    functions; re-measure the other branch before the push, and stop and report on any adjacent hunk; claim 749 is
    left untouched. The holder's coordinator was told, with the function list.
- **2026-09-24 08:30 UTC — wave 4 wave-done (`05b9ac4f`, PR #181).**
  - Re-measured: tip = handoff = PR head; merge-base = `main` (`b501698a`); 35 commits, all by the noreply identity;
    clean tree. Items 16/16 settled after the `awaiting-review` advance.
  - `suite: red` with `failure: ceiling`. One red, the post-plan `install-census` deploy.sh-parity guard, conflicted
    with spec §19 and was ruled by the worker as D-3287. The other is `tmp-sweep`'s FAILS CLOSED case, red on `main` on
    this box too. The worker did not re-run the full gate after its final-review fixes, so CI arbitrates the tip.
  - Eight deferred design questions were raised in the wave-done. They are held until the review returns and ruled
    with it, so that the held-out brief carries none of the worker's framing.
  - Review run 155 carries three wave-specific lenses beyond the panel: security and untrusted input; safety hardware
    plus self-update (can this tree install its successor?); interface fidelity against W2 on `main` and the W5/W6
    plans.
- **2026-09-24 10:20 UTC — wave 3 wave-done (`432e2731`, PR #184).**
  - Re-measured: tip = handoff = PR head; merge-base = `b501698a`; 25 commits, all by the noreply identity; clean tree.
    Items 13/13 settled after the `awaiting-review` advance. CI's Linux legs are green.
  - `suite: red`, with three known reds, none of them this wave's: `session-hook`'s load flake, `session-hook`'s
    scratch-slug case under a `~/.cc-tmp` TMPDIR (child-reclamation's run 148 fixes that pattern), and `tmp-sweep`'s
    FAILS CLOSED case.
  - `main` moved to `28271ace` (#182). Measured with `git merge-tree`: #184 and #181 each merge with `main` cleanly.
    They conflict with EACH OTHER in `README.md` only. Whichever merges second merges `main` and resolves it; the
    worker's stated resolution keeps W4's Not-yet sentence, and places W3's paragraph after W4's trust-roots paragraph.
  - The worker's parked follow-ups and plan-text rulings are held until review 156 returns, out of the held-out brief.
- **2026-09-24 14:25 UTC — review run 155 (wave 4 at `05b9ac4f`): one full fix round, bounded now.**
  - 7 lenses, 136 agents: 43 findings raised, 36 survived. R1 is a refutation the reviewer set aside on a false
    premise; I re-measured it. The refuters were not pointed at the ledger, and my carried constraint is there.
  - Important:
    - R1: the README says `CCRC_SIGSTORE_TRUSTED_ROOT` overrides the root "by hand only", while the verifier reads
      the environment unconditionally. This was the plan's prescribed text, so the miss is mine.
    - C1: a false "REVERTED (arm 2)" after a same-tag `--force`.
    - C31: a detached rollback wedges `update.json` at `queued`.
    - C34: rollout blames doctor for a floor-write death (M1 one layer up).
  - Rulings:
    - C1: `previous` names the last DIFFERENT release, so a same-tag reinstall leaves it alone, and arm 2 is
      skipped for a same-tag run.
    - C16: `--from rollback|watchdog` are caller words, like `restore` (spec §9's "is the caller"), so a hand-typed
      one is refused.
    - C28: a converged no-op precedes the floor check.
    - C29: a killed watchdog rollback is never retried.
  - The worker's eight deferred questions: Q1 and Q3 accepted as designed; the other six ruled into fixes.
  - Carried:
    - C24 (plaintext box token, one of four copies) is reported to the operator as one class.
    - C26 and C27, and the floor-refusal wording, go to wave 6's new Task 8A (`edc98508`).
    - C33 (node clock vs server clock) goes to wave 5 as a Global Constraint and a Task 8A behaviour item
      (`fddf8370`), ruled "fresh by change, not by clock".
  - **The bar, committed before any result:** the next review is scoped to this round's delta. It sends back only a
    behaviour defect that the delta introduces, reachable on a box whose config ccrc wrote, and that does one of
    four things: leaves a box unable to install or roll back its next release; reports a restore, revert or success
    that did not happen; leaks a secret; or moves a box below its floor without `--downgrade`. That is at most one
    narrow round; after its scoped review, #181 merges.
- **2026-09-24 15:20 UTC — review run 156 (wave 3 at `432e2731`): one full fix round, bounded now.**
  - 6 lenses, 69 agents: 16 findings survived (0 of 3 refuted each) and 5 were refuted. Important: F1 (the banner and
    push body bypass D-3313's `remoteSides`, so they name an unmeasured fleet version) and F2 (the Notifications
    control is 29 × 25 px, under the tap floor).
  - Rulings:
    - F14: "unreachable is not current" binds BuildLine, the banner, the push summary and the push decision. This
      widens D-3309, so it takes reserve number 3316.
    - F12: announcement silencing survives a yank, so no older tag is pushed after a newer one was announced. This
      narrows spec §13's "newest eligible", so it takes 3317.
    - F7: D-3307 amended in place.
  - All four of the worker's parked follow-ups are ruled into fixes: element validation, the first-sweep flag, the
    prefix on W2's warning, and D-3303's wrap text.
  - Carried: F16 (wave 5's plan quotes stale README anchors into `shared/api.ts`) goes to my re-point of wave 5
    after waves 3 and 4 merge.
  - **The bar, committed before any result:** the next review is scoped to this round's delta. It sends back only a
    behaviour defect that the delta introduces, reachable from a server speaking W2's wire, and that does one of
    four things: a surface states an unmeasured version, reachability or catalogue state as fact; a push goes out
    twice for one tag, or for a tag `notify` excludes; a move control is enabled, or `apply`/`rollback` is sent;
    untrusted text becomes markup or off-origin navigation, or a secret leaks. That is at most one narrow round;
    after its scoped review, #184 merges.
- **2026-09-24 19:00 UTC — review 161 (W3's scoped review at `e5ddd3ba`): #184 merges under the committed bar.**
  - Every ruled item was done; the reviewer measured F2 at 46 × 44 px in Chromium and saw F12's guard red.
  - 13 findings. None meets the bar.
    - F-A is behaviour, introduced by the delta: a 409's node note lives one round trip. It withdraws a claim;
      it states nothing unmeasured, so it is outside the four classes.
    - F-B is reachable only from a non-conforming server, which the bar's qualifier excludes.
    - F-C to F-M are coverage and prose.
  - **Ruling on F-A:** the write's own reload IS F5's "later poll". Carried to wave 5 with the stored-view fix.
  - All 13 carried to wave 5's Task 8A (`d8db956a`).
  - **main is red on macOS** at `814fc53d`, in child-reclamation's tests from #175: `ccd-ws-add-child` and
    `ccd-child-tmpdir` fail, and one shard hung to its cap. #183's stable gate needs every macOS shard green, so this
    blocks every stable promotion. Raised with calm-mesa; #184's own macOS red is that same class, not its own.
  - Wave 4 merges second and resolves the `README.md` conflict (measured with `git merge-tree`) by W3's stated
    placement.
- **2026-09-24 19:15 UTC — the stable gate has two blockers, neither of them this programme's.** Measured by
  calm-mesa after my report:
  1. child-reclamation's `_child_tmpdir` writes `chmod 0700 -- "$dir"`. BSD chmod stops parsing options at the mode,
     so on macOS it returns rc 2, and all six macOS cases fail. calm-mesa's fix run 162 is dispatched and will add a
     Linux-visible pin.
  2. `server/test/ccgpt-proxy.test.ts` (the gpt lane, #165) wedges every macOS run since #165 merged, five of them
     before child-reclamation existed. The shard's log goes silent until the 55-min cap. calm-mesa is reporting it to
     the operator; the gpt lane's owner session owns it.
  - Until both are fixed, no full-suite verdict can be green, so nothing can be promoted to stable.
- **2026-09-24 20:20 UTC — W3 deploys on calm-mesa's v0.0.27 rollout (ruled "go").** #185 (the BSD chmod fix,
  `3fd6c816`) removed blocker 1 of the stable gate; ccgpt-proxy's macOS wedge remains. Both boxes were on v0.0.24,
  which already carries W2. v0.0.27 carries W3 (#184).
  - Ruled: default order (fleet box first); W3 needs no `--server-first`, because it is server and PWA over W2's
    projection, with no fleet-side reader change.
  - The release push is live from this build. I corrected my own first claim about it after measuring
    `releaseToNotify`: an unreachable or non-tag node can prompt one push (D-3316).
  - W3's live exit criteria get measured after this rollout.
- **2026-09-25 02:35 UTC — review 167 (W4's scoped review at `7a20ff8f`): one narrow round, by the committed bar.**
  - Every ruled item was done except C1, which was partly done: I4 narrowed arm 2's skip to a completed record.
  - 10 findings.
    - **F1 meets the bar.** It was introduced by D-3288's `same_build`, which reports "same build, not mixed" over a
      half-installed tree.
    - **F4 meets it too.** The ~100-byte SHA256SUMS fetch got only a stall bound, so a trickling host wedges
      `update.lock`. My round-1 item 12 is the cause: it grouped that fetch with the tarball.
    - **F2 does not meet it alone.** It is pre-existing: arm 2 "restores" the failed tag when `previous` names it and no
      record exists. It is included because it is the same arm-2/arm-3 decision as F1, and the two interact. That
      scope was recorded before round 2's result.
  - F3: the 5→4 census re-pin is coincidental; all five `ccd/ccrc` citations are stale. Accepted at 4, with its
    disclosure, because a pin of 5 reds against the audit.
  - Carried to wave 6's Task 8A (`14f77194`): the five citations (repaired in its Task 9), F5–F10, the refuted probe cap,
    and the worker's own carries.
  - After round 2's scoped review, #181 merges; no round 3.
- **2026-09-28 15:35 UTC — operator ruling: macOS CI legs gate nothing** ("ignore the macos runs for now, they are
  being fixed, treat as flaky"). No merge, review, wave-done or rollout waits on `test-macos`/`probe-macos`.
  - One mechanism still reads them: #183's `release-stable.yml` promotes only on a green `full-suite` verdict, and
    that verdict needs every `test-macos` shard. If macOS is still red at promotion time, the stable push is refused
    by CI itself. That is the operator's to decide then; it is not a reason to wait now.
- **2026-09-28 15:35 UTC — wave 4 round 2 is code-complete at `f546715d6` (unpushed); the gate was held for box memory.**
  - Measured: load 64, 4 GB available of 30, root disk 98% full.
  - Ruled: push, and let CI's Linux legs arbitrate. Under `CCRC_SELECTION: shadow`, PR CI still runs every server test,
    plus the full agent, pwa and build legs, and that costs the box nothing. Locally, the worker runs only the
    touched-file suites and the three main-compare guards.
  - The worker restored `session-hook.test.ts` to `main`'s pin of 5, because round 2's lines put the census back
    there. That supersedes round 2's "accept 4".

- **2026-09-28 16:30 UTC — review 173 closed; wave 4 round 2 ACCEPTED by the bar committed before it.**
  - Round 2 did F2's skip, F1's `same_build` narrowing and F4's bounds, in the reviewer's measure. The census is back
    at main's 5, and no new D-number was defined.
  - One finding is a behaviour defect the delta introduced: **F1r**, in arm 3's words only. It needed a ruling:
    **the staged sha decides MIXED, whatever the record says.** A differing sha is MIXED. The same sha with a
    completed record is "same build, not mixed". The same sha with no record is "the pre-update tree, which may be
    mixed".
    - This corrects my round-2 text, which did not separate the two conditions the sha tells apart. It is D-3288's
      own gap, so it takes no new number.
  - F1r and the other nine (P1–P4, F4a, F4b, T1–T4) carry to wave 6's Task 8A.
  - **Before the merge, main moved:** `6ff4e2e9` (#187, #188) landed after #181's CI started, and six files overlap
    (`ccd/ccrc`, `ccd/ccrc-doctor-checks`, `CLAUDE.md`, `README.md`, and two tests). `git merge-tree` is clean, but a
    clean text merge is not a tested tree.
    - So the worker merges main and runs the touched suites. A post-merge fix is allowed only where the two sides
      meet, and CI's Linux legs arbitrate before I merge.
    - Also measured: #187 moves `ccd/ccd` (net +3033 lines) and README (+35). Some of wave 5's and wave 6's re-pointed
      anchors (1 and 10 of the explicit ones) move with it. The briefs say so, because main keeps moving; the plans
      are not re-pointed again.

- **2026-09-28 16:57 UTC — wave 4 merged; waves 5 and 6 dispatched together.**
  - #181 merged as `023fe94d` (v0.0.35). Its tree is byte-identical to `d1eed83f`, the tip whose Linux legs CI ran
    green. `d1eed83f` merges `main` at `6ff4e2e9` with an empty remerge-diff and no post-merge commit. The worker's six
    reds in a combined local run each passed alone.
  - Run 132 (wave 5) went to `ccrc-pwa-warm-harbor` and run 133 (wave 6) to `ccrc-pwa-quiet-basin`, the plans
    cherry-picked in the orders the Waves table gives.
  - **They overlap in `README.md`, `CLAUDE.md` and `single-definition.test.ts` only.** In the first two it is prose in
    each wave's docs task; in the third, different censuses. So they run in parallel, as W3 and W4 did, and whoever merges
    second resolves. child-reclamation wave 4 (run 174) holds claims across both waves' files (claims 800–802); the
    same rule holds there.
  - The briefs had to fit the 8192-byte mail cap, prefix included. The hazards the plans' Global Constraints already
    carry are named there by reference, not restated.
  - Anchors that main's later commits moved (#187 onward: `ccd/ccd`, README, CLAUDE.md) are re-measured by the workers
    at their start tree and listed in their wave-dones. The plans are not re-pointed again.

- **2026-09-28 21:45 UTC — wave 5's wave-done accepted; its held-out review (run 175) dispatched.**
  - Re-measured: the tip is `8e9a9bf3`, PR #201, 41 commits, all by the noreply identity. `origin/main` (`023fe94d`) is
    its ancestor. Nothing under `ccd/`, `deploy/`, `agent/src/whitelist.ts` or `coord/schema.ts` changed.
  - The worker's gate: six server shards on the final tree, green except `session-hook`'s scratch-slug case under a
    `/mnt` TMPDIR (335/335 under the default); agent, pwa, build, contrast and both typechecks green. Its first run's
    reds were `ccd ws-add`'s 10 GB free-disk floor on the root disk, plus flakes that passed alone.
  - One departure changes a spec rule: report freshness goes by change and target identity, not by clock, and it
    supersedes spec §8's Precedence text and its §18 row. The review brief asks the panel to judge it on its own
    terms. The worker's argument for it is not in the brief, so the review stays held out.
  - The worker listed items it left open for my ruling. I rule on them together with the review's findings, not
    before, so that the review is not steered.

- **2026-09-28 22:55 UTC — review 175 (wave 5, 90 agents, 18 confirmed): the one full fix round sent.**
  - **The important pair are one rule.** A report says `busy` only while its writer's pid lives, and a lock-held
    `--detach` refusal (`_upd_busy_die`'s sentence) is `busy` too. This closes F1, where a lock held before the first
    in-flight write halted the fleet, and F2, where a dead updater's leftover answered `busy` forever. It departs from
    spec §10's "refuses when `update.json` says in flight", so it takes 3411.
  - **The spawn bound.** Both roles now decide it by attributed re-measurement: the report's pid must be the killed
    parent's. Only the "nothing was queued" arm releases, and every other arm holds to the deadline (F3, F4, and the
    worker's D-3400 asymmetry).
  - **The rest:** the watchdog's words reach the deadline verdict with no new settle path (F6); a revive keeps one
    lease per label and never drops a verdict (F7, number 3412); the whitelist pin tests gain the case the spec asks
    for (F9, F13); R13 holds (F10); plus the minors and prose.
  - **The rulings were attacked twice before sending (7 Opus agents).** Round 1 broke four of my first drafts:
    - "the lock decides" was false for `rollback`, which asks the release host first;
    - a `queued` write that fails silently would have released a live run;
    - a watchdog `done <prev>` would have been recorded as a success;
    - a revive would have wiped a halted verdict.

    Round 2 broke two of the revisions, and found a containment hole:
    - arm C released while our own run could be live;
    - a same-label revive dropped the one live lease;
    - the end-to-end pins would have run the real `systemd-run` against the live home.

    All of these are fixed in the sent text.
  - **The bar, committed before any result exists.** The scoped review after this round sends back only a behaviour
    defect introduced by the delta that does one of four things:
    - moves an unrequested node, or two nodes at once;
    - halts, or holds a lease, with no bound and no exit;
    - spawns beyond the two argvs, or lets the box token write intent;
    - records a move that did not happen, or leaks a secret.

    After that review, #201 merges.
  - **Residue.** No later wave edits these files, so residue goes to a post-rollout list that I own.
  - **Wave 6 was told** (mail 2515) the `ccd/ccrc` facts wave 5 now depends on.

- **2026-09-29 06:00 UTC — wave 5's fix round done at `325d4072`; its last review, run 176, dispatched.**
  - **Item 5's reading, asked and confirmed mid-round** (mails 2516 to 2519). The dividing line is HALTING versus
    not halting, never the state's name. A revived row that halts keeps its verdict, and the retired row's busy lease
    is dropped: the halt blocks every other move until ack. Any other revived row receives the handed lease through a
    new lease-group writer, a non-halting provenance heir included. The worker found the provenance case itself, by
    probe, as a bar class-1 path in its first reading.
  - **The worker's gate:** six server shards green except the known `session-hook` TMPDIR case (335/335 under the
    default); agent 410, pwa 3083, contrast 608, both typechecks, and the three guards. Its first full run caught two
    census reds that the task-scoped runs missed (`macos-platform`'s D-2765 notes, `mail-routes`' kebab words), and
    it fixed them before the push.
  - Through the real launcher, the spawner's pid IS the pid in the parent's `queued` report, so item 2's arm B
    matches end to end.
  - The worker reported one pre-existing path in bar class 1, now recorded in D-3400: a fleet-link `timeout`,
    `aborted` or `disconnected` releases `idle` after an agent that may already have spawned. By the committed bar it
    does not go back. It heads the residue list below, and it is fixed before the stable promotion (see there).

- **2026-09-29 06:40 UTC — wave 5 MERGED as `af5a29f8` (v0.0.36) under the bar committed before review 176.**
  - The review found one behaviour defect the delta introduced (F1): a rekey mid-op hands the lease on, the release
    by node id misses, and the row halts later as `failed: deadline`.
  - I ruled it outside the bar as written (`rulings-run176.md`):
    - `failed: deadline` records no move, settle, revert or success, and the deadline did pass;
    - it is bounded, and ack exits it;
    - it over-holds, and never moves a second node.
  - It is residue R5. F2 to F5 are coverage/prose, residue R6.
  - Wave 6 was told (mail 2532) to merge `af5a29f8` before its gate. It merges second and resolves the README,
    CLAUDE.md and `single-definition` overlaps. Wave 5's contained real-`ccd/ccrc` suites then run against wave 6's
    bash, which is the drift check on mail 2515's facts.

- **2026-09-29 07:25 UTC — wave 7 opened (run 177) for the residue that must land before stable, and dispatched.**
  - R1 is a bar class-1 path. The spec itself chose it (§10: "disconnected/timeout → idle … the lease never waits for
    the deadline"), so closing it is a ruled departure: 3555.
  - **The rule.** After the op frame is handed to the link, every transport failure HOLDS the lease. Only a failure
    proven to come before the hand-off, the client's new `LinkNotSentError` (measured: three arms of `request()`, all
    before `ws.send`), releases `idle`.
  - **The cost, accepted.** A link blip mid-op now costs a deadline and a halting row that the operator acks, instead
    of an immediate retry. Not chosen: an agent-side replay of the last op's outcome, because the node's own
    `update.json` already carries that fact, read by identity.
  - **R5.** The post-answer writes find the lease by identity. D-3412 is amended in place, with no number. R6 is
    wave 5's prose and pins.
  - **The plan** was written and attacked by four Opus agents against `main` at `af5a29f8`. Both attackers held it;
    their nine notes and amends are applied.
  - I confirmed its one narrowing. The deadline says "no run of `<tag>` was reported" only when that is true, because
    no column keeps the report as it stood at the acquire.
  - Opening run 177 with a wave title renamed the programme's `programTitle` (a work run's title does too, not only a
    review run's). The next open that passes "Centralised update management" restores it.

- **2026-09-29 10:00 UTC — wave 7's wave-done at `5f6eae8e` (PR #203); review run 178 dispatched.**
  - **The worker's gate:** six server shards green except three known cases, each measured: `session-hook`'s
    TMPDIR case (335/335 under the default), `tmp-sweep`'s FAILS CLOSED (red on `main`'s own tree too), and
    `update-store-nodes`' I1 differential under load (43/43 alone). Agent 410, pwa 1828 on a re-run of the 29
    files that timed out at load 41, both typechecks, and the three guards. Its first full run caught a real
    `typecheck-tests` red from the final-review fix commit, fixed in `5f6eae8e` before the push.
  - **One item for my ruling, not reshaped by the worker:** the hold words say the op "reached the fleet link" for
    every `maybe`, including a non-`Error` rejection, where the code does not know.
  - **The bar, committed before any result exists.** Review 178 is wave 7's first review, and it gets at most one
    fix round and one scoped review after it.
    - A behaviour defect introduced by this delta is fixed in that round. If the review finds none, #203 merges
      without a round, and its coverage/prose findings go to the residue list.
    - The scoped review after a round sends back only a behaviour defect introduced by the round's delta that
      does one of the four things wave 5's bar named:
      - moves an unrequested node, or two nodes at once;
      - halts, or holds a lease, with no bound and no exit;
      - spawns beyond the two argvs, or lets the box token write intent;
      - records a move that did not happen, or leaks a secret.
    - After that review, #203 merges.

- **2026-09-29 10:05 UTC — wave 6's wave-done at `751eb5da` (PR #202); review run 179 dispatched.**
  - **The worker's gate:** memory was under 6 GB, so the brief's substitution applied and CI's Linux legs
    arbitrated. The first full run was red on `pool-accounts-route`, whose `curl` stub modelled `ccd-pool-sync`'s
    argv before Task 8A-2's bounded read; it is fixed test-side at the tip. There, every Linux leg is green, and
    every server test ran in shadow mode.
  - **Wave 5's five `ccd/ccrc` facts hold at the tip**, as the worker measured them. Only C27 can refuse a busy box
    with its own sentence, and only on a bare rollback.
  - **One cross-wave item for my ruling, with no change on either branch:** wave 5's one-tap rollback always sends
    `--to <previous>`, so C27's layout check never runs on the PWA path. The worker recommends that C27 also run
    when `--to` equals `previous`'s tag and `--from` is not `cli`.
  - **The bar, committed before any result exists.** Review 179 is wave 6's first review. It gets one full fix
    round and one scoped review after it.
    - A behaviour defect introduced by this delta is fixed in that round. If the review finds none, #202 merges
      without a round, and its coverage/prose findings go to the residue list.
    - The scoped review after the round sends back only a behaviour defect introduced by the round's delta that
      does one of these:
      - removes, `--delete`s into, or overwrites a version that a unit runs, that `~/ccrc` names, that `previous`
        names, or that is the only copy;
      - leaves a box with no runnable `ccrc` that the next run does not recover;
      - makes a version directory hold another build's tree;
      - moves an unrequested node, or holds wave 5's lease with no bound and no exit;
      - runs a real tool against a live home, or records a move that did not happen.
    - After that review, #202 merges.

- **2026-09-29 11:40 UTC — review 178 closed; wave 7 gets its one fix round, by the committed bar.**
  - **F1 (behaviour, introduced).** The deadline's "no run of `<tag>` was reported" tests only the row's LAST stored
    report, and review 178 made it false twice: a later writer's report replaced this run's own, and D-3214's
    `stamp-unmeasured` override wrote the previous report back. The verdict is right; the sentence is not. It now
    says "the row's last report does not name `<tag>`", and 3555 is amended in place.
  - **The worker's open item.** For a rejection `request()` does not name, the hold says the op "may have reached"
    the link; the three named post-send arms keep "reached". The hold's message part is capped so the sentence
    keeps its tail.
  - F2 to F4 are coverage and prose: macOS's `E2BIG` premise goes `itLinux`, as the plan's own contingency said;
    the plan is re-cited; README's settle clause is corrected. The three real-verb watchdog-revert cases now assert
    containment.
  - CI's Linux legs on #203 were green at `5f6eae8e`.

- **2026-09-29 12:05 UTC — review 179 closed; wave 6 gets its one full fix round, by the committed bar.**
  - **Review 179:** 111 agents; 15 of 35 findings survived. Six are behaviour defects the delta introduced.
    - F1: C27 refuses the watchdog's rollback after a W6 update killed between its flip and its stamp.
    - F2: after a write-through, a rollback flips into a version directory that holds another build and records it
      complete.
    - F6: a huge `CCRC_VERSIONS_KEEP` prunes every unprotected version.
    - F7, F8 and F9 are smaller.
  - **The rulings were attacked twice before sending,** by Opus agents measuring in fixture homes. Round 1 broke
    both important drafts:
    - relaxing C27 on `previous == stamp` alone let a `deploy.sh` hot-fix send a hand-typed rollback two builds
      back;
    - comparing stamps could not see a write-through that did not restamp.

    Round 2 broke the revisions:
    - "flip only" could not be enforced from inside C27, which runs before the lock and never in a detached child;
    - a pre-W6 kept version's own spine would `npm ci` into the tree the units still run;
    - an ordinary `ccrc install` would re-record a digest of a written-through tree.

    All are fixed in the sent text.
  - **What was ruled.**
    - F1: in a measured six-condition "killed-flip" state, a rollback may only flip, re-measured under the lock.
    - F2: "kept" is a frozen-recipe digest of the version's bytes, recorded only when a run placed them and
      re-measured on every trust decision. GC's verdicts are unchanged.
    - One bounded validator for every KEEP knob, `CCRC_BACKUP_KEEP` included by class.
    - `CLAUDE.md`'s SAFETY sentence on `_upd_sweep`'s callers is corrected. Rollback by flip calls it from
      `cmd_rollback`, and the `KillMode=process` preflight is inside `_upd_sweep`, so no actor is added.
  - **To residue:**
    - F13: the launcher shim's `deploy.sh` advice on a crashed migration.
    - O1: the PWA's rollback trusts `previous`, including the route's no-`to` fallback.
    - Arm 1's point-back, then arm 2's in-place re-install under running units: the same in-place write `main`
      makes on every update.
    - Deferred item 3's measured shape: a unit not restarted since a flip counts as running the pointed-at version.

- **2026-09-29 13:20 UTC — #202 and #203 were merged mid-round, at their pre-round heads, by someone other than me.**
  - **What happened.** #200 merged at 12:46:07, #203 at 12:46:28, #202 at 12:46:52 and #149 at 12:47:46 UTC, all
    under the shared `gh` identity. `main` became prereleases v0.0.37 to v0.0.39.
  - **The effect.** `main` holds wave 6 without its fix round, including F1 (C27 refuses the watchdog's rollback
    after a killed update), F2 (a flip into a written-through version is recorded complete) and F6 (a huge KEEP
    prunes every unprotected version). It also holds wave 7 without its words round.
  - **Why no revert.** Both live boxes run a pre-W4 build (this fleet box measured `v0.0.33`, `~/ccrc` a real
    directory), and no dispatcher is live, so nothing moves to those prereleases unless a person runs
    `ccrc update --to` or `rollout --to`. `stable` is untouched at `f0cb8743`.
  - **What I ruled** (mails 2571, 2572):
    - Each round lands as a new PR from its own workspace branch. Its scoped review reads that PR's diff against
      `main`, which is exactly the round's delta, under the bar already committed.
    - Wave 7 merges `main` (with wave 6 in it) and re-runs its full gate, because the merged tree is one nobody ran.
    - No tag cut from `main` after `07940d36` is promoted until both rounds merge.
  - Reported to the operator.

- **2026-09-29 14:50 UTC — wave 7 MERGED: #205 as `5964e7f2`, under the bar committed before review 178.**
  - #205 carried fix round 1 as a new PR, because #203 had been merged mid-round. Its changed lines against `main`
    equal the round's own `5f6eae8e..bb5c26f8` exactly (I measured this), and the merged tree is byte-identical
    to the tested tip.
  - The worker's gate ran on the merged tree. It used vitest's default workers instead of the `--maxWorkers=2` I
    asked for, and I accepted that (mail 2586).
  - Review 180: all seven items were done as ruled, with no behaviour finding. Five coverage/prose findings are
    residue R7. Among them, my own ruled README words deny the stamp half of the settle rule.
  - Item 7's measurement was corrected by the worker (mail 2551), and my ruling had been unsafe: removing a plant
    on a real-verb case would have let the real `tmux` or `gh` resolve. I ruled its pre-written argv method
    instead (mail 2553).
  - **Left before stable:** wave 6's fix round, as a new PR. Then the promotion.

- **2026-09-29 23:55 UTC — wave 6's fix round done as PR #214; scoped review run 181 dispatched.**
  - **The live state changed under the programme.** The fleet box now runs v0.0.48, which is wave 6's first cut,
    in the versioned layout: `~/ccrc` links to `~/ccrc-versions/v0.0.48`, four versions are kept, and none carries
    a digest. Another session's rollout moved it, after #202 merged unfixed. So #214 is what makes the live boxes
    safe, and review 181 carries one extra lens: the update from exactly that state, with a gate failure, a kill
    at each step, and a rollback to v0.0.48.
  - **I measured the round's one hand-resolved merge** (`977112213`): `main` held `751eb5da`'s copies of the three
    conflicted files byte for byte, so the branch's side was right, and the README has no duplicate paragraph.
  - **The worker's gate:** all six server shards ran locally at `b686e8d1`, merging `main` `0ffa07f3`: 441 files,
    17661 passed. The only red was `session-hook`'s TMPDIR case, which is green under the default. CI now runs a
    selection (#211), so the local shards are the full-suite measure.
  - **Classified by me before the review:**
    - **N2** is item 2's accepted place (2), not a send-back. A hand-typed rollback after a plain install killed
      between the stamp removal and `_inst_enable` re-installs in place under running units, the same write
      `af5a29f8` made on every update. The narrow fix, refusing a cli rollback on an unstamped box whose link and
      units disagree, goes to residue.
    - **Residue 4** (the first killed update onto this build refuses the killed-flip recovery, because older
      versions have no digest) is a refusal, not a wrong flip.
    - Both go to residue R8, with the worker's other seven residue items (its report, `## Residue`).

- **2026-09-30 01:00 UTC — wave 6 MERGED: #214 as `a742eb6a` (v0.0.49). All seven waves are on `main`.**
  - Review 181 ran 52 agents, with an extra lens on the live upgrade path. Nothing met the bar.
  - R1 is the unattended in-place re-install into the running, digestless v0.0.48 after a first update killed
    between the stamp and the restart. I ruled it inside item 2's accepted place (2): it is the same write `main`
    made on every update and every watchdog rollback before wave 6, and D-3465 names it. It matters only for the
    first update onto v0.0.49 from today's digestless versions, and I run that update attended.
  - **Before the promotion:**
    - no full Linux suite has run in CI on this tree, because PRs run a selection since #211;
    - the `stable` gate's `full-suite` verdict needs `test-macos`, and #214's macOS legs were red.

    So a full run was dispatched on `main` (run 36652768968). If its macOS legs are red, whether to promote is the
    operator's decision: either the reds are fixed first, or macOS is ruled out of the gate.

- **2026-09-30 01:20 UTC — the full run on `main` `a742eb6a` (run 36652768968): every Linux leg green, macOS red, so
  `full-suite` is red and the `stable` gate refuses.**
  - **Linux, in full:** five server shards, agent, pwa, the server typecheck and the pwa build all pass. This is the
    first full CI measure of this tree, because PRs run a selection since #211.
  - **macOS: 9 cases in 5 files.**

    | Shard | File | Cases | From |
    |---|---|---|---|
    | 1 | `ccd-tmux-anchor` | 1: the dotted-id rename | D-3525, the residue batch |
    | 1 | `ccrc-update` | 3: `_upd_redact`'s jq `\/`, the long-HOME floor, `BASHPID` unbound | wave 4 |
    | 1 | `ccrc-update` | 1: the killed-flip control runs `--detach`, which is Linux-only | wave 6's fix round |
    | 2 | `update-spawn` | 2: a grandchild that holds the pipes | wave 5 |
    | 3 | `ccrc-install` | 2: the versioned-tree cases | wave 6 |
  - Both live boxes are Linux. They already run v0.0.48, which is wave 6's first cut, and was moved there by another
    session.
  - **For the operator:** whether `stable` waits for the macOS reds to be fixed, or macOS becomes advisory in the
    gate as the 2026-09-28 ruling reads; and whether v0.0.49 is rolled out to both boxes now, ahead of `stable`.

- **2026-09-30 10:40 UTC — the operator ruled: the coordinator does not roll out. It monitors ccrc's own update
  mechanism and makes sure it works. A read-only live audit (workflow `wf_52680e8a-215`, 12 agents) found that it
  works as designed.**
  - **The correction.** The boxes were never "moved there by another session", as the 2026-09-29 23:55 and
    2026-09-30 01:00 entries say. **Auto moved them.** The fleet-wide intent has been `channel dev, auto=channel`
    since the PWA set it at 2026-09-29 20:05:13 UTC. Since then each dev release has been installed within one
    catalogue poll of its publication, fleet box first and the server box about 4 minutes later: v0.0.46 at 20:06,
    v0.0.47 at 20:41, v0.0.48 at 21:17 and v0.0.49 at 01:23. Each report reads `from: pwa`, because the dispatcher
    spawns `--from pwa` for auto and taps alike (defect A below). So holding `stable` holds nothing while the boxes
    follow dev.
  - **Review 181's R1 window passed unattended and without incident.** The auto move onto v0.0.49 at 01:23 was not
    the attended first update the ruling assumed. It completed, and v0.0.49 now carries a digest, so the forward
    window is closed.
  - **Measured healthy:**
    - Both live rows are on v0.0.49 at `a742eb6a`, verified, complete and idle, with no request, lease, halt or
      refusal. They are re-measured about every 70 s.
    - `/health` answers v0.0.49.
    - Both projections are fresh.
    - The watchdog ticks every minute on the server box.
    - A `stable` resolution below the floor causes no churn.
    - The superseded server row from the 19:54 rekey is invisible, as designed.
  - **Exit criteria:** most of the §18 rows observable live are met. The W5 rehearsal's live half (a crash inside
    the window, one flip and one rollback on each node) is NOT met. It needs live moves, which are the operator's to
    order.
  - **Defects found (verified, or read in code):**
    - **A.** A move's source (auto or request) is kept nowhere durable.
    - **B.** `cmd_update` never prunes `~/ccrc-backups` (about 12 MB per update; 258 MB on the fleet box and 628 MB
      on the server box).
    - **C.** Every older release row offers a one-tap rollback, including tags a verified box will refuse. One tap
      would halt the fleet until ack, and the dispatcher's rollback check is only "a catalogue row exists".
    - **D.** doctor's `auth` says the gate is OFF on an armed box, because it reads `ccrc.env` and not
      `exposure.env`.
    - **E.** The catalogue's first poll comes 30 min after each boot, so auto lands a release up to 35 min after
      the merge.
    - **F.** PWA wording: a converged row shows the resolver's floor sentence; the running release reads "Install";
      a digestless rollback target is not marked as a download; a finished move leaves two undated lines.
    - **G.** Minor lines: the sweep's success line prints over zero units; install's tail claims "NO PWA
      passphrase"; `commitSha` is always null.
    - **H.** The fleet box's `ccrc.env` names the fleet box as the server, so doctor's cross-check never runs. That
      is box config.
  - **Monitoring:** an hourly read-only probe runs from the coordinator's session. It reports only a change or an
    anomaly.
    - **2026-09-30 14:37 UTC — auto moved both boxes onto v0.0.50** (`c88625aa`, #212, a docs-only merge),
      measured read-only as it happened:
      - The release was published at 14:07:15.
      - The fleet box ran 14:31:12–14:35:33, 24 min after publication.
      - The server box ran 14:35:55–14:36:16, 22 s after the fleet box finished: one node at a time, fleet first.
      - Both reports read `phase: done` (and `from: pwa`, defect A).
      - `/health` answers v0.0.50.
      - Both inventory rows were idle and complete by 14:37:31. The server row read `pending`/`incomplete` for one
        measurement, taken before its restart; the next tick cleared it.
      - STATUS: fleet and server v0.0.50, newest v0.0.50, intent `*` dev/auto=channel, backups fleet 270M/server
        672M.
      - Correcting B's figure: each update's backup is about 12 MB on the fleet box but **about 44 MB on the server
        box** (41 and 23 dirs).
    - **2026-09-30 17:18 UTC — auto moved both boxes onto v0.0.52** (`1f9fa22d`, #216), skipping v0.0.51 (#217):
      - v0.0.51 was published at 17:00:11 and v0.0.52 at 17:03:45.
      - The fleet box ran 17:07:12–17:11:34.
      - The server box ran 17:12:32–17:12:53, straight after the fleet box, one node at a time.
      - v0.0.51 was never installed. Auto resolves to the newest dev release at the move, which is as designed.
      - Both reports read `phase: done`, and `/health` answers v0.0.52.
      - STATUS: fleet and server v0.0.52, newest v0.0.52, intent `*` dev/auto=channel, backups fleet 282M/server
        716M (one backup each).
      - Each box keeps five versions: v0.0.47–v0.0.50 and v0.0.52. That is `~/ccrc`, `previous` (v0.0.50) and the
        newest `CCRC_VERSIONS_KEEP`=3 complete others. v0.0.46 was pruned, so W6's version GC holds live.

- **2026-09-30 12:22 UTC — wave 8 opened (run 182) for the live audit's residue, and dispatched.**
  - **Planning:** two Opus scoping agents measured each defect at `a742eb6a`, and an Opus writer assembled the
    plan. Two attack rounds followed, with 20 and then 21 breaks, each applied or stated in Risk notes. The rounds
    stopped there under the bound-before-a-third rule; the per-task reviews, the held-out review and a scoped
    review under a committed bar remain.
  - **Rulings in it:**
    - E is dropped, because main already polls on the first tick after start.
    - B's protections stand: this run's own backups and newer, the previous tree backup, and the newest earlier
      coord.db snapshot. Every timestamped dir counts toward KEEP, so less history is kept, and that is accepted.
    - C's exclusion covers `fleetAsk` AND `fleetAuto`, on the whole predicate, so it also releases main's
      unknown-tag stall.
    - F avoids the literal "up to date".
  - **The stakes:** auto on dev installs its merge on both boxes within about 35 min. B's prune takes effect from
    the release after that, because the update INTO wave 8 runs v0.0.49's script.

- **2026-09-30 21:20 UTC — wave 8's wave-done (mail at 21:10:56) at `1eb9b011` (PR #219); review run 196 dispatched.**
  - **Re-measured:** 15 commits, all by the noreply identity, 38 files, +3877/−236. The branch merges `main` at
    `1f9fa22d`. That merge's two hand resolutions, in `server/test/ccrc-update.test.ts` and `shared/api.ts`, keep
    both sides of an end-of-file append (remerge-diff). Run 182's first advance to `awaiting-review` was refused
    `pr-unmeasurable` with no detail, and the same claim went through on retry: a transient `pr-state` failure.
  - **The worker's gate:** one real red, fixed at the tip: pwa `contrast`'s census caught Task 3's new class. The
    other reds were each measured green in isolation: `ccgpt-usage` (a fixed-port collision), `update-store-nodes`
    (a load timeout), `session-hook`'s TMPDIR case, and the known fleet-box `tmp-sweep` FAILS CLOSED. Load ran
    20–32, so shards 4–6 ran in pieces over vitest's own partition. No reserve number was spent.
  - **Task 4's figure, and the first live prune.** The fixture minted one dir per update. The worker's final review
    reads the installers as minting up to about 6 on a fleet-role box whenever a release changes a skill or hook.
    Read-only on the live boxes: most auto updates left one timestamped dir, and one run on 2026-09-28 left four.
    Today the fleet box holds 39 timestamped dirs and the server box 17. So the first update that runs wave 8's
    script removes about 29 and about 7. Both boxes also hold hand-named siblings, one of them a coord.db
    snapshot, and one uses a different timestamp spelling. Both boxes run in UTC.
  - **For the review, not ruled by me:** the worker's own rulings (the `in`-narrowed `moveFeedRecord`, P7/P12
    `itLinux`, a seventh re-based auth case); "a refused or degraded sweep still prunes", which the worker's final
    review ruled harmless; and the TZ note, which widens Risk (b).
  - **The bar, committed before any result exists.** Review 196 is wave 8's first review. It gets one full fix
    round and one scoped review after it.
    - A behaviour defect introduced by this delta is fixed in that round. If the review finds none, #219 merges
      without a round, and its coverage/prose findings go to the residue list.
    - The scoped review after the round sends back only a behaviour defect introduced by the round's delta that
      does one of these:
      - removes a backup that a run, its restore or a rollback still needs, or anything under `~/ccrc-backups`
        that is not a timestamped backup;
      - turns a completed update or rollback into a failed one, or leaves a box with no runnable `ccrc`;
      - moves an unrequested node, or halts, or holds a lease, with no bound and no exit;
      - records a move that did not happen, or names the wrong source for one;
      - says the auth gate is armed on a box where it is off;
      - runs a real tool against a live home, or prints a secret's contents.
    - After that review, #219 merges. Its merge reaches both boxes by auto, so no merge happens before the
      review's verdict.

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

## Post-rollout residue (owner: the coordinator)

What a committed bar carried out of a wave whose files no later wave edits. Each item is worked after its wave
merges. The ones marked **before stable** are fixed, reviewed and merged before `stable` is promoted.

- **R1 — before stable, IN WAVE 7 (run 177) (bar class 1, wave 5, pre-existing in its first cut).** A fleet-link `timeout`, `aborted` or
  `disconnected` releases the fleet row `idle` after an agent that may already have spawned. Then a `met` settle
  while the fleet box is still in its gate can let the server move beside it. Recorded in D-3400.
- **R2 (wave 5, D-3412).**
  - A supersede of a busy row with no revive drops its lease while the run proceeds (W2's code).
  - After an ack clears a revived halting row, the dropped lease's run can proceed unleased, bounded only by that
    ack.
  - A handed lease does not carry the heir's `reported*` columns.
  - An idle heir's stale request is cleared when the handed lease settles (W2's unconditional clear).
- **R3 (wave 5, D-3411).**
  - (a) `rollback` asks the release host before the lock probe.
  - (b) A hung live updater answers `busy` on every sweep; the exit is ack.
  - (c) W4's D-3251 probe-to-acquire window.
  - A reused pid reads as alive.
- **R5 — IN WAVE 7 (wave 5, review 176 F1).** A `rekeyNode` revive during an in-flight op hands the lease to the heir. The
  dispatcher's release by `move.nodeId` then answers `superseded`, and the heir's copy is held until a halting
  `failed: deadline`. The fix direction: release by lease identity (label plus `updateStartedAt`), or re-resolve the
  heir on `superseded`.
- **R6 — IN WAVE 7 (wave 5, review 176 F2 to F5, prose and pins).**
  - Item 9's EAGAIN premise is false: spawn errnos resolve as a halting code 1, and only a synchronous throw rejects.
  - `update-watchdog-revert`'s tmux containment line is vacuous: plant a poisoned `tmux` and `gh`.
  - The plan's Task 2 snippets still show the old mapping.
  - The `UPDATE_STORE_REFUSE_CODES` glossary misses this round's words.
- **R7 (wave 7, review 180, prose).**
  - README's one-tap paragraph (about `:653`) says a lease "settles on the node's own report naming the tag, not a
    sweep measuring the target". That wording is my item-6 ruling, and it denies the stamp half of
    `leaseActionFor`'s done-settle (`inventory.ts:421-424`), which needs the report AND a sweep's stamp at the target.
    Suggested wording: "…on the node's own report naming the tag, confirmed by a sweep that measures the target".
  - The residue plan's prose:
    - `:40` has an escaped backtick inside a code span;
    - the PLATFORM-ONLY note's hypothesis undercuts its conclusion;
    - the `:381`/`:398` citations are 7 lines off;
    - `:719` cites a gitignored rulings copy.
- **R8 (wave 6, fix round 1: the worker's residue list and N2).**
  - N2's narrow fix: refuse a cli rollback on an unstamped box whose link and units disagree.
  - The first killed update onto the fixed build cannot use the killed-flip recovery, because older versions carry
    no digest.
  - `deploy.sh`'s `prune_backups` reads `CCRC_BACKUP_KEEP` unvalidated.
  - A launcher install over a written-through version still records a complete install.
  - A source with no git and no `build.json` keeps the old stamp.
  - `pathWithout` lacks `head`.
  - `_ver_verdicts`' error-rc path is untested.
  - FX-B M9 cannot red.
  - The launcher-stay line still says "unstamped".
- **R9 (wave 6, review 181).**
  - **R1, first among them.** The live boxes' kept versions carry no digest, so their first update onto v0.0.49,
    if killed between `_inst_stamp` and `_inst_enable`, is rolled back unattended by an in-place re-install
    (rsync `--delete` and `npm ci`) into the v0.0.48 tree the units still run. At `0ffa07f3` that state flipped with
    no write.
    - Ruled inside item 2's accepted place (2), as its three refuters voted and as D-3465's entry names it.
    - Mitigation: the coordinator runs that first update attended.
    - Fix direction: before a re-install, adopt a digestless version whose bytes equal the downloaded release's,
      and flip. That closes F2's download-for-every-rollback on these boxes too.
  - **F1.** The killed-flip refusal's remedy line advises `update --to <tag> --downgrade`, which is the in-place
    write. The safe hand repair is `bash ~/ccrc-versions/<tag>/ccd/ccrc install`.
  - **F2.** After a completed update onto this build, every rollback to a digestless version needs the release host.
  - **F3.** The not-kept sentence promises a digest those versions never get.
  - **F4.** `_ver_keep_state`'s copy into another version (pre-existing).
  - **F5 and F6.** A transcript promise; README's `unmeasured` gloss.
  - **F7.** The amendment list names D-3438 but not D-3427 or D-3430.
  - **F8.** The `keepDigest` test helper runs the real `ccd/ccrc` with the real PATH, under a fixture HOME.
  - **F9 and F10.** A stale mutation row; the `--to` pin uses the bare form.
  - **#214's `test-macos` reds.** Among them:
    - a new killed-flip control that runs `--detach`, which is Linux-only;
    - `BASHPID` unbound under the runner's bash;
    - jq escaping `/`;
    - a long-HOME floor case;
    - two `ccrc-install` versioned-tree cases.
- **R4 (wave 5, item 4).** `cmd_watchdog` rewrites an out-of-vocabulary `from` to `watchdog`, which is unreachable on
  `main` today. W2's P6 test comment claims 4 reds where 11 are measured. A killed `_upd_phase` can leave an orphan
  `update.json.tmp.<pid>`.

## Next-wave brief

**Wave 2 (run 128) — dispatched 2026-09-23.** The brief as sent is the plan's path and sha, tasks 1–15, execution
skill `superpowers:subagent-driven-development`, routing Opus · high main loop / Sonnet · high implementers / Opus ·
high per-task reviewer / workflow off / compact 40, the deviation block and reserve above, the migration-slot
re-measure, the concurrent-wave boundary (wave 2 never edits `ccd/`, `deploy/`), the sharded full-suite gate, and
"wave-done in the same turn as the push; never end a turn to wait on CI".

**Wave 3 and wave 4 plans** are in preparation; wave 4 may be dispatched while wave 2 runs, and merges after it.
