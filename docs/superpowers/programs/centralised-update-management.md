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
| 2 | W2 | control plane, read-only: `MIGRATIONS[13]`, catalogue poller, node inventory, resolver, projection route + server-role writer, `GET /api/updates`, intent/refresh/ack, derived `builds` | agent-first (read allowlist), then server | — | **narrow fix round 4, the last send-back** (run 128, PR #176); review run 149 at `24e3379c`: 1 important behaviour (F1); plan `1288beec` |
| 3 | W3 | `/settings`, `UpdateBanner`, release push once per tag, move controls DISABLED | server | — | **run 130 open, planned**; plan `d638c602` + re-point `08cecd10`; dispatches when wave 2 merges |
| 4 | W4 part A | node side: `ccd-update-sync`, the projection reader in `cmd_update`, `--channel/--detach/--from/--no-gate`, the lock, `update.json`, `previous`, `install-step`, the health gate, `_upd_restore` arms 2–3, `ccrc rollback`, the watchdog, doctor `provenance` + unarmed-exposure, `ccrc channel`, `--check caps=`, `rollout --channel`, the W4 cap words | fleet-first | — | **paused for wave 2's merge** (run 129, `ccrc-pwa-keen-meadow`): Tasks 1–14 at `2fe02e2d` (2026-09-23 16:4x UTC); plan `4b361c00`; tasks 15–16 follow wave 2's merge |
| 5 | W4 part B | convergence: `update/dispatch.ts`, the agent `update` op + `ops` on ready, `apply`/`rollback` routes, the PWA controls enabled | agent-first | — | **run 132 open, planned**; plan `6acbff6d` + re-point `287caa07`; dispatches when waves 2, 3 and 4 have merged |
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
