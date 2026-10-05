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
| 8 | — (live audit) | the live audit's residue: a move's source on record (A), backups pruned after a completed run (B), no one-tap rollback a node will refuse (C), doctor reads the armed gate (D), Settings wording (F), two box lines (G); E dropped by ruling | server + node | — | **MERGED** `5b1c58a8` (PR #219, 2026-10-01 01:49:28 UTC, run 182 done; released as v0.0.53 at 01:50:31). The merged tree is byte-identical to the tested tip `2555b082`, with `main` unmoved at `1f9fa22d` and every Linux leg green. Scoped review 203 met none of the bar's classes; its five prose findings are residue R11. Auto installed it on both boxes by 02:24 UTC. Was: **Fix round 1 done** 2026-10-01 at `2555b082` (7 commits; reserve number 3599 spent, bare: its definition is on the worker branch); scoped review run 203 dispatched under the committed bar; after it, #219 merges. Was: **Fix round 1 sent** 2026-09-30 22:50 UTC (`rulings-run182-fix1.md`) on review 196 at `1eb9b011`: F1 (item G's zero line over a failed listing) is a behaviour defect the delta introduced, so the bar gives the one round, with reserve number 3599 for the fail-closed sweep (bare: its definition goes on the worker branch); a scoped review follows, then #219 merges. Was: **Wave-done** 2026-09-30 21:10 UTC at `1eb9b011` (PR #219, 5/5 items). Its one merge of `main` at `1f9fa22d` hand-resolved two conflicts, both end-of-file appends, by keeping both sides (measured by remerge-diff). No reserve number was spent, and `DEP-move-record-kind` did not fire, so it is withdrawn unminted. Review run 196 is dispatched under the bar committed before it. Its merge reaches both boxes by auto within about 35 min. Was: **DISPATCHED** 2026-09-30 12:22 UTC to `ccrc-pwa-soft-ridge` (run 182); plan `8e73f825` (13 departures defined in it, one contingent by slug; a five-number reserve named in the brief). |
| 9 | — (stable readiness) | this programme's 12 macOS reds (harness, the Linux-only control, the escapee, the rsync recorder, the Darwin missing-deps block), tmux names sanitised at creation (M8, live), structural containment of the ccrc builders (R10d, R9-F8), doctor's auth reader models the unit's feeder (R10a, R10e), `ccrc backup`'s prune takes the lock (R10g), a prose batch | fleet-first | — | **MERGED** `00f8a193` (PR #251, 2026-10-05 11:10:12 UTC, run 223 done; released as v0.0.84 at 11:11:17). The merged tree is byte-identical to `git merge-tree` of the reviewed tip `0491a823` onto `main` at `b5593725`. That `main` differs from the one CI tested (`4100ae1c9`) only by #252's one plan file, which touches none of this wave's files. Every Linux leg was green, and the macOS acceptance was met. Scoped review 269 met neither class of the round-2 bar; its four minors are residue R14(g–j). It reaches neither box until the operator acks the failed v0.0.78 fleet row. Was: **Fix round 2 done** 2026-10-05 at `0491a823` (mail 3491; one commit on `670d25fd`, 4 files; reserve number 3833 spent, defined in the plan on the worker branch; `main` not merged, `git merge-tree` onto `4100ae1c9` clean). Every Linux leg of CI run 37290717097 is green, and the macOS acceptance is met on its `test-macos` legs. Scoped review run 269 dispatched 10:28 UTC to `ccrc-pwa-swift-prairie` once the work volume read 10.48 GB, under the round-2 bar in the rulings; after it, #251 merges. Was: **Fix round 2 (the last) sent** 2026-10-05 08:50 UTC (mail 3490, `rulings-run223-fix2.md`) on scoped review 266 at `670d25fd`: F1, the Darwin NUL test missing a NUL under a UTF-8 locale, is round 1's scoped class 2, so it goes back, with reserve number 3833 for the Darwin arm's C-locale pin (bare: its definition goes on the worker branch); a scoped review follows under the bar in the rulings, then #251 merges. Was: **Fix round 1 done** 2026-10-05 at `670d25fd` (mail 3485; one commit on `f74f5e90`, 7 files; reserve number 3832 spent, defined in the plan on the worker branch; `main` not merged, `git merge-tree` onto `4100ae1c9` clean). Scoped review run 266 dispatched 07:47 UTC to `ccrc-pwa-plain-prairie`, under the bar in the rulings; after it, #251 merges. Was: **Fix round 1 sent** 2026-10-05 (mail 3480, `rulings-run223-fix1.md`) on review 265 at `f74f5e90`: F1, a Darwin false ARMED on a NUL byte, is the bar's class 2, so the bar gives the one round, with reserve number 3832 for it (bare: its definition goes on the worker branch); a scoped review follows under the bar committed in the rulings, then #251 merges. Was: **Wave-done** 2026-10-05 05:51 UTC (mail 3473) at `f74f5e90` (PR #251, 7/7 items; reserve number 3831 spent, defined in the plan on the worker branch). The held-out review follows, under the bar committed before it. Was: **DISPATCHED** 2026-10-04 12:46 UTC to `ccrc-pwa-amber-harbor` (run 223), the brief brought up to date with `main` `59a435f0`. Was: **PLANNED** 2026-10-02 14:20 UTC; plan `e52f9859` (23 departures defined in it; a five-number reserve named in the brief). Its merge reaches both boxes by auto within about 35 min. The stable gate also needs the GPT lane's 45 macOS reds fixed by that programme. |
| 10 | — (R12, script half) | `deploy/verify-service.sh` tells a deliberate supervisor stop (settled `inactive` + `.stopped` stamp or a purged row) from a crash, so a serial sweep verify stops failing healthy updates; tests on fixture HOMEs; a cross-version case against `main`'s sweep | fleet-first (the move INTO it runs the old sweep with the new script) | — | **MERGED** `a6daa9cf` (PR #247, 2026-10-05 03:19:04 UTC, run 261 done; released as v0.0.80 at 03:19:51). The merged tree is byte-identical to the tested tip, `main` was unmoved at `b40f4145`, and every Linux leg is green. Review 263 met no bar class; residue R13. It reaches neither box until the operator acks the failed v0.0.78 fleet row. The first move after the ack goes straight to the newest release, so it runs v0.0.78's sweep with this script. Was: **Wave-done** 2026-10-05 02:18 UTC (mail 3446) at `a9a1cef8` (PR #247, 3/3 items; reserve number 3950 spent, defined in the plan on the worker branch). Review run 263 was dispatched to `ccrc-pwa-clear-meadow` at 02:42:59 UTC, under the bar committed before it. Was: **DISPATCHED** 2026-10-05 00:05 UTC to `ccrc-pwa-keen-harbor` (run 261). Was: **PLANNED** 2026-10-04 23:59 UTC (run 261); plan `e60d7174` (D-3946..D-3949 defined; a five-number reserve, numbers 3950 to 3954, named in the brief). Was: **SCOPED** 22:56 UTC (`wf_790a5b99-8ca`); runs beside wave 9, no shared file. |
| 11 | — (R12, sweep half) | `_upd_sweep`: one shared verify window by concurrent per-unit calls, the die's report-ownership guard and wording, no die in a subshell, the Darwin arm | fleet-first | — | **DISPATCHED** 2026-10-05 16:04 UTC to `ccrc-pwa-clear-meadow` (run 270). Plan `966ffe9f`, 9 tasks; it defines D-3972 to D-3984, and the five-number reserve, numbers 3987 to 3991, is named in the brief. Was: **Run 270 open, planned** 2026-10-05 11:10 UTC, opened before run 223 closed so the programme keeps an open run; to plan, with R13, R14 and R14(f) first. Was: **SCOPED** 2026-10-04 22:56 UTC; after wave 9 merges (`ccd/ccrc`). The 10-02 wave-10 deferrals move to wave 12. |
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
    - **2026-10-01 02:25 UTC — auto moved both boxes onto v0.0.53, wave 8** (`5b1c58a8`, #219):
      - The release was published at 01:50:31.
      - The fleet box ran 02:15:27–02:22:48; the server box ran 02:23:19–02:23:41, 31 s after the fleet box.
      - Both reports read `done`, and `/health` answers v0.0.53.
      - Both inventory rows were idle and complete by 02:24:55. The server row's one pre-restart reading was
        pending/incomplete, as on 2026-09-30.
      - **Item D is fixed live.** The server box's update doctor now prints `PASS auth: CCRC_AUTH=on in
        ~/.ccrc/exposure.env (it overrides ~/.ccrc/ccrc.env) … — logins are gated`, where it used to say the gate
        was OFF. Install's gate line names the exposure file too.
      - **This move ran v0.0.52's update script,** so its sweep and its backups are the old ones: one backup each,
        fleet 295M and server 762M, nothing pruned. Its server-box sweep still printed the every-live line over
        zero units.
      - **Wave 8's prune, its fail-closed sweep and A's feed row first run live on the NEXT release.** The move onto
        v0.0.53 was dispatched by v0.0.52's server, so it wrote no source row.
      - STATUS: fleet and server v0.0.53, newest v0.0.53, intent `*` dev/auto=channel.
    - **2026-10-01 08:34 UTC — auto moved both boxes onto v0.0.54** (`cca1b6d7`, #stall wave 2 Part A). This was the
      FIRST move to run wave 8's own update script and server; every item observable from the boxes held live:
      - The release was published at 08:03:35. The fleet box ran 08:25:18–08:32:34, and the server box 08:32:46–08:33:08.
        Both reports read `done`, and `/health` answers v0.0.54.
      - **A:** the server's feed holds one `update` row per move, each naming its source: "update fleet: auto
        update to v0.0.54 … lease held: accepted — the node queued a detached run" at 08:25:18, and the same for
        the server at 08:32:46.
      - **B, the first live prune:**
        - The fleet box removed its 33 oldest timestamped backups and kept the newest 10, plus both hand-named
          siblings. That took 295M to 121M.
        - The server box removed its 10 oldest and kept the newest 10, plus all six siblings: the other timestamp
          spelling, the `pre-*` dirs (one with its hand-made coord.db) and two plain files. That took 762M to 400M.
      - **G:** the server box's sweep now prints the zero line over its zero supervisors.
      - **The fail-closed sweep (wave 8 fix round 1, number 3599)** did not fire on either healthy box. The fleet box printed the every-live
        line.
      - **D** still reads the armed gate.
      - C and F are PWA-side and need a session, so they are not measured here.
      - STATUS: fleet and server v0.0.54, newest v0.0.54, intent `*` dev/auto=channel, backups fleet 121M/server 400M,
        no anomalies.
    - **2026-10-01 11:18 UTC — auto moved both boxes onto v0.0.55** (`a0860d1f`, a docs merge). This was the second
      move on wave 8's script:
      - The release was published at 10:20:12. The fleet box ran 10:34:02–10:39:58, and the server box
        10:40:46–10:41:07.
      - One auto-source feed row per box (10:34:01 and 10:40:45).
      - Each box pruned one dir, its oldest, and holds 10 timestamped backups. The server box's total rose to 446M
        only because the dir it pruned was smaller than the new one.
      - The server box printed the zero sweep line again.
      - STATUS: fleet and server v0.0.55, newest v0.0.55, backups fleet 122M/server 446M, no anomalies.
    - **2026-10-01 13:18 UTC — auto moved both boxes onto v0.0.57, skipping v0.0.56 by design.**
      - v0.0.56 was published at 12:24:08 and v0.0.57 at 12:25:13.
      - The fleet box ran 12:41:46–12:48:04, and the server box 12:48:29–12:48:50.
      - One auto-source feed row per box. Each box holds 10 timestamped backups and five versions.
      - STATUS: fleet and server v0.0.57, newest v0.0.57, backups fleet 122M/server 450M, no anomalies.
    - **2026-10-02 02:18 UTC — auto moved both boxes onto v0.0.58** (`0db98707`, a reclaim fix):
      - The release was published at 01:44:28, which is 8 min to the fleet box's start: the catalogue poll fell
        early this time.
      - The fleet box ran 01:52:51–01:59:15, and the server box 01:59:45–02:00:07.
      - One auto-source feed row per box. Each box holds 10 timestamped backups.
      - STATUS: fleet and server v0.0.58, newest v0.0.58, backups fleet 123M/server 454M, no anomalies.
    - **2026-10-04 12:48 UTC: eight auto moves landed while the hourly probe was down, v0.0.58 to v0.0.69.**
      - The probe's schedule was session-only and was gone by 12:47 today. It stopped at some point after the
        entry above. These moves were read back afterwards, read-only, from the server's `update` feed rows. None
        was watched as it happened.
      - Each move has one auto-source "accepted" row per box. The fleet box went first and the server box followed
        6–10 min later:
        - v0.0.59: 10-02 11:33 and 11:39;
        - v0.0.60: 15:12 and 15:19;
        - v0.0.63: 19:52 and 20:01;
        - v0.0.64: 10-03 13:35 and 13:44;
        - v0.0.65: 16:47 and 16:56;
        - v0.0.66: 18:58 and 19:08;
        - v0.0.68: 23:09 and 23:19;
        - v0.0.69: 23:21 and 23:31.
      - Each move starts from the version the previous move targeted, and both boxes and `/health` now answer
        v0.0.69. So every move landed, and none was reverted. v0.0.61, v0.0.62 and v0.0.67 were skipped by
        design, because a newer release was out before the poll.
      - The fleet box holds 10 timestamped backups and five versions. Its backup total fell from 123M to 100M
        under the same count of 10.
      - v0.0.70–v0.0.72 were published 12:41:17–12:44:13 today, so their poll is not yet due.
      - STATUS: fleet and server v0.0.69, newest v0.0.72, backups fleet 100M/server 496M, disk free fleet
        81G/server 33G, no anomalies.
    - **2026-10-04 13:31 UTC: auto moved both boxes onto v0.0.73, skipping v0.0.70–v0.0.72 by design. The fleet
      box's run took 19 min, against 6–10 before. The cause was box load, not the mechanism.**
      - The release was published at 12:56:41. Auto started the fleet box at 13:07:16, and that run ended at
        13:26:38. The server box ran 13:27:17–13:27:39.
      - There is one auto-source feed row per box. The hourly probe at 13:27:28 caught the server box mid-move
        (boxes differ, inventory pending/incomplete), which is the known transient. It converged by 13:31.
      - **Where the time went:**
        - The fleet box's `npm ci --omit=dev` for the server tree took 8 min ("added 108 packages in 8m"), and
          the agent's took 30 s. The v0.0.69 run at 23:21 the night before took 6 s and 4 s.
        - The 15-min load average was 78 on 16 CPUs, measured at 13:29.
        - The supervisor sweep, about 8 s per unit, took about 8 min in both runs. It grows with the session
          count: 85 verify lines on 10-03.
      - **Bearing on wave 10:** `npm ci` runs with no time bound (`ccd/ccrc`'s install spine). A hung `npm ci`
        holds the update lock indefinitely. That is R3's hung-updater class, and this run is its first measured
        instance on a live box. It is not a new residue item.
      - STATUS: fleet and server v0.0.73, newest v0.0.73, backups fleet 100M/server 500M, disk free fleet
        78G/server 33G, no anomalies.
    - **2026-10-04 17:47 UTC: auto moved both boxes onto v0.0.74** (`22f7931a`, #242, docs only). This move
      corrects the latency this ledger has quoted.
      - The release was published at 16:59:31, and the server's catalogue first listed it at 17:29:21. The fleet
        box ran 17:30:26–17:40:33, and the server box 17:41:11–17:41:32. There is one auto-source feed row per
        box.
      - **The bound is the catalogue's poll, not "8–26 min".** `CATALOGUE_POLL_INTERVAL_MS` is 30 min
        (`server/src/update/catalogue.ts`), so a release can wait up to about 30 min before any box starts. The
        8–26 min this ledger quoted is only the range of the samples watched so far.
      - **So the time to live is up to about 30 min plus both runs.** The fleet run takes 6–19 min, depending on
        load and session count, and the server run takes under a minute: about 50 min in the worst case seen. The
        "within about 35 min" in the wave 8 entry and the wave 9 brief is an under-estimate. Nothing depends on
        it.
      - **The 13:07 run's slowness was load, confirmed:**
        - at a 15-min load of 21, `npm ci` took 6 s and 4 s again;
        - the supervisor sweep, 17:31:35–17:40:33, is now most of the fleet run, and it grows with the session
          count.
      - The fleet box pruned one backup and one version, and holds 10 timestamped backups.
      - STATUS: fleet and server v0.0.74, newest v0.0.74, backups fleet 110M/server 503M, disk free fleet
        70G/server 33G, no anomalies.
    - **2026-10-04 22:27 UTC — FALSE FAILURE: the fleet box's auto update to v0.0.78 ended `failed` on a healthy
      box, and the halt rule now holds every move.** Reported by `ccrc-pwa-quiet-river` (mail 3419), re-measured
      read-only:
      - auto moved both boxes onto v0.0.76 at about 21:47 (the server row reads v0.0.76, done). v0.0.77 and v0.0.78
        followed at 21:44–21:45 and v0.0.79 (#215) at 22:11.
      - The fleet box ran v0.0.78 22:02:08–22:10:56. It installed completely (`installState` complete, stamp
        v0.0.78), and the gate passed. The sweep try-restarted all 65 supervisors at 22:05:52–22:06:13.
      - `_upd_sweep`'s Linux verify loop lists the active set ONCE, then runs `deploy/verify-service.sh` (3 s
        settle + 5 s window) on each listed unit IN TURN, and `_ccrc_die`s on the first that fails. At 65 units
        the last check runs about 8.5 min after the listing.
      - `ccrc-pwa-still-summit` was archived by hand at 22:10:51 (`.archivedreason` = manual), inside its own
        window. verify-service.sh failed it, and the update died with exit 1, phase `failed`, detail "…was restarted
        and did not stay up". 26 units were verified. The other 39 were restarted but never verified. At 22:25,
        65 units are active and 0 are failed.
      - **Consequence:** the server row reads "halted — a failed or reverted node (fleet) halts every move until it
        is acked". The boxes differ (fleet v0.0.78, server v0.0.76), and nothing moves, not v0.0.79 and not
        wave 9's merge, until the operator acks the fleet row in the PWA. The ack is the operator's.
      - **The defect:** a deliberate stop inside the serial verify fails the update. Wave 8 item G already treats a
        unit missing from the post-restart listing as a warning, never a failure. The verify arm treats the same
        stop, landing a few minutes later, as fatal. Child reclamation wave 4 (#215, v0.0.79) makes reclaims
        routine, so this will recur. It is residue R12, and the fix is planned through a wave.
    - **2026-10-05 07:27 UTC — two more prereleases, and the halt still holds.** v0.0.81 (#249) and v0.0.82 (#246),
      both stall-watch merges, published at 06:54–06:55. Neither box moved: the failed v0.0.78 fleet row still waits
      for the operator's ack. The first move after the ack goes to the newest release, now v0.0.82. It runs
      v0.0.78's sweep with wave 10's script, so the R12 protection holds. Wave 9's tip still merges cleanly onto the
      new `main` (`git merge-tree`).
      - STATUS: fleet v0.0.78 (update `failed`), server v0.0.76, newest v0.0.82, backups fleet 123M/server 506M,
        disk free fleet 64G/work volume 12G/server 33G.
    - **2026-10-05 11:27 UTC — v0.0.83 (#252) and v0.0.84 (wave 9, #251) published; the halt still holds.** Neither
      box moved. The first move after the ack now goes to v0.0.84, carrying waves 9 and 10, and runs v0.0.78's sweep
      with wave 10's script.
      - STATUS: fleet v0.0.78 (update `failed`), server v0.0.76, newest v0.0.84, backups fleet 123M/server 506M,
        disk free fleet 62G/work volume 10.5G/server 33G.
    - **2026-10-05 12:01 UTC — the operator's tap reached the server as an apply, not an ack, so the halt still
      holds.** The operator reported "acknowledged" at 11:58.
      - The server box's access log shows `POST /api/updates/apply` at 11:57:14, answered 202, and no `POST
        /api/updates/ack` at any time.
      - The fleet row still reads `failed` with v0.0.78's own detail and `updateStartedAt`. An ack would have set
        `idle` and "acknowledged by the operator" (`ackNode`), and no writer turns a settled row back to `failed`
        (`releaseLease` acts on a busy row only).
      - So the apply was skipped as `halted`, by design: a halted fleet row holds every move until it is acked.
      - The ack is the row's third button, **Ack**, on the fleet node's item in Settings, after **Update** and
        **Roll back**.
      - **Observation, for the residue list:** a tap on Update while the fleet is halted returns 202 and moves
        nothing. The remedy sits on a different button. Whether the answer should offer the ack in place is a
        product question for the operator; it is not a defect.
      - **12:12, the operator's screenshot of the home screen, which promotes this to a defect (R15):** the home
        screen shows two banners and neither names the halt.
        - The amber one says the boxes run different builds and advises `ccrc rollout` from the deploying machine, or
          `ccrc update` on the lagging box. That is the pre-central-management advice, and it contradicts auto.
        - The green one says v0.0.84 is out, with **Update all** and **See what's new**. **Update all** is the apply
          that the halt skips.
        - The only door out of a halt, **Ack**, is in Settings, on the failed node's item.
    - **2026-10-05 12:36 UTC — the operator acked at 12:21:44 (200), and auto converged both boxes on v0.0.84.**
      - **The ack** reached the server at 12:21:44, after two more applies (12:18:59, 12:19:15) that were skipped as
        halted. The fleet row read `idle`, "acknowledged by the operator".
      - **The fleet box** started at 12:22:31, 47 s after the ack, as `from: pwa`, and went v0.0.78 → v0.0.84.
        - Phases: `backing-up`, then `installing` 12:22:51, `checking` 12:23:36 (the gate passed), `restarting`
          12:23:51, and `done` 12:34:26.
        - The sweep ran v0.0.78's `_upd_sweep` with v0.0.84's `verify-service.sh`. It verified 71 supervisors one by
          one ("active, MainPID … stable across 5s"), about 8.9 s each, 10.5 min in all, and ended with "every live
          claude-session@ supervisor now runs the ccd this update installed".
        - No unit stopped inside the window: there was no "stopped on purpose" line. So wave 10's classifier was not
          exercised, and the move passed on ordinary verifies.
      - **The server box** started at 12:34:27, as the fleet box finished, and was `done` at 12:34:49. `/health`
        answers v0.0.84.
      - **The inventory settled at 12:36:** both rows read `idle`, install `complete`, provenance `verified`, "done:
        v0.0.84". A 12:35 read caught the server row still `pending`/`incomplete` from before its restart. That was
        transient: the next one-minute measurement settled it.
      - **Time from ack to convergence:** 13 min.
      - **Side observation, not this mechanism:** the fleet box's `ccd-graph-sweep.service` was OOM-killed at 12:33,
        during the sweep (peak 1.7G). It was killed 13 times in the last 24 h, with the box at 30G total and about 2G
        available.
      - STATUS: fleet and server v0.0.84, newest v0.0.84, backups fleet 98M/server 510M, disk free fleet 61G/work
        volume 11G/server 33G; no anomaly but the work volume.
    - **2026-10-05 13:27 UTC — the work volume was resized (491G → 672G, 213G free), and the probe is clean.** The
      operator did it; ccd's 10 GB `ws-add` floor no longer binds. The finished waves' leftovers are untouched and no
      longer pressing.
      - STATUS: fleet and server v0.0.84, newest v0.0.84, backups fleet 98M/server 510M, disk free fleet 80G/work
        volume 213G/server 33G, no anomalies.
    - **2026-10-05 14:27 UTC — v0.0.85 published at 14:14 (#253, the graph sweep's `MemoryMax` raised from 4G to
      6G).** Neither box has moved 13 min in, which is within the 30-min catalogue poll. Watched to its end.
      - STATUS: fleet and server v0.0.84, newest v0.0.85, backups fleet 98M/server 510M, disk free fleet 107G/work
        volume 235G/server 33G, no anomalies.
    - **2026-10-05 14:44 UTC — auto converged both boxes on v0.0.85 with no human act, the first unattended move since
      the halt.** v0.0.85 was published at 14:14.
      - **Fleet box:** it started about 14:36, within the catalogue poll, with `installing` at 14:36:28 and
        `restarting` at 14:37:29. It was `done` at 14:42:32. The sweep (v0.0.84's `_upd_sweep` with v0.0.85's
        script) verified 36 supervisors, all ordinary passes: no "stopped on purpose" and no "did not stay up". The
        fleet runs 36 active supervisors now, against 71 at 12:23.
      - **Server box:** `checking` at 14:43:33 and `done` at 14:44:03. `/health` answers v0.0.85.
      - **The inventory settled at 14:44:52:** both rows read `idle`, `complete`, `verified`, "done: v0.0.85". As at
        12:35, a read just after the server's restart caught its row `pending`/`incomplete` for one measurement.
      - **Publish to converged:** 30 min.
      - STATUS: fleet and server v0.0.85, newest v0.0.85, backups fleet 108M/server 513M, disk free fleet 105G/work
        volume 235G/server 33G, no anomalies.
    - **2026-10-05 15:27 UTC — v0.0.86 (#240, the GPT lane's macOS reds) published at 14:49 and auto-converged
      unattended.** The fleet box ran 15:14:33–15:20:45, its sweep verifying 37 supervisors, all ordinary passes; the
      server box followed. For `stable`, the GPT lane's macOS reds are now addressed on `main`. The next daily full run,
      or a stable gate, measures it.
      - STATUS: fleet and server v0.0.86, newest v0.0.86, backups fleet 121M/server 516M, disk free fleet 106G/work
        volume 143G/server 33G, no anomalies.
      - **The work volume fell from 235G to 124G free between 14:27 and about 15:35.** The writer is a root `rsync`,
        running since about 15:02, that copies the session temp tree and the worker temp tree from the root disk onto
        the volume. That is an operator migration, not a ccrc process. It was reported to the operator with the rate
        (about 100G/h), because if the sources outsize what is left, every worktree on the volume runs out of space.

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

- **2026-09-30 22:50 UTC — review 196 closed; wave 8 gets its one fix round, by the committed bar.**
  - **The review** (66 agents; six lenses; three refuters per finding) measured the first live prune on fixtures of
    both boxes:
    - the update INTO this build prunes nothing;
    - the next removes the 31 oldest timestamped dirs on the fleet box and the 9 oldest on the server box;
    - it never removes a sibling, a plain file, the run's own backup, the previous tree backup or the newest earlier
      coord.db;
    - a gate failure, `--no-gate`, a restore child and a refused run prune nothing.
  - **F1 is a behaviour defect this delta introduced.** Item G's new zero sweep line says no supervisor was active
    when the pre-sweep listing merely FAILED. The bar's first-review rule gives it the round.
  - **Two attack rounds on my rulings** (workflows `wf_e87b8d0a-51d`, three Opus; `wf_672d8ccd-837`, two Opus) found
    more under F1:
    - the same failed listing also empties the per-unit KillMode preflight, so `try-restart` runs with only the
      template probe checked. That is pre-existing: `main` and `deploy.sh` share it;
    - a failed verify listing makes item G's new "not active after it" warnings false.
  - **Ruled:**
    - An unmeasured pre-sweep listing is a failed preflight: the sweep refuses and restarts nothing, which is R1's
      terms applied to an input they did not name.
    - An unmeasured verify listing verifies nothing.
    - Both take reserve number 3599 (bare: its definition goes on the worker branch).
    - The trade-off is accepted: a refused sweep is visible only in that run's output (R10k).
  - **The round also carries** F2 and F4 through F10: the comments, the D-3596 premise (the WARN stays; no text
    asserts unmeasured service-manager behaviour), the guards, the citations, and pins for timestamp-shaped links and
    files. F3 and the refuted R-b, R-c and R-f go to residue R10.
  - **The bar's class 1, clarified** in the tightening direction: it names a top-level entry that is not a timestamped
    backup, or anything a timestamp-named link points to. "Timestamped backup" is `main`'s `_bak_prune` shape, a
    `YYYYMMDD-HHMMSS` name that `[ -d ]` accepts.
  - The rulings are in `.superpowers/rulings-run182-fix1.md` on the coordinator's worktree.

- **2026-10-01 00:50 UTC — wave 8's fix round 1 done at `2555b082`; scoped review run 203 dispatched.**
  - **Re-measured:** 7 commits on `1eb9b011`, all by the noreply identity; 6 files, +307/−40. `main` is unmoved at
    `1f9fa22d`, so there is no remerge. Reserve number 3599 was spent (bare: its definition is on the worker branch),
    and 3600–3603 stay unspent.
  - **The worker's gate:** load stayed 17–26, so the six shards were not run, as the rulings allow. Every file in the
    round's gate list is green, and so are the three guards after the last commit. At `1eb9b011` every Linux CI leg
    was green, with only macOS red.
  - **Measured by me, read-only, for the fail-closed sweep:**
    - On both boxes (systemd 255.4), a `list-units` pattern that matches nothing exits 0, so an empty or
      supervisor-less box does not trip the refusal.
    - Today's 17:07 detached auto update ran as a transient unit in the user manager. Its `systemctl` calls reached
      the bus, and its sweep restarted and printed the every-live line. So the refusal fires only on a real listing
      failure.
  - **The scoped review** runs under the bar committed at 21:20, with class 1 as clarified at 22:50. It adds one lens
    on the live sweep. After it, #219 merges.

- **2026-10-01 01:50 UTC — review 203 closed; #219 merges under the committed bar.**
  - **The review** (37 agents, four lenses including the live-sweep lens, 0 refuted) found no behaviour finding.
    Items 1–9 were done as ruled at every lens, and the round's "does not touch" list was respected.
  - **The live-sweep lens, on fixtures:**
    - neither new fork fires on a healthy box: an empty listing, a server role, `--from pwa`, or a `--from watchdog`
      flip;
    - the (a) refusal leaves the exit code, `update.json` and `_bak_gc` identical to the KillMode refusal, on both
      callers;
    - the one Linux restart call is reached only after the per-unit loop.
  - **Five coverage/prose findings,** none meeting the bar, go to residue R11.
  - **Ruled:** one `ccrc-update` describe group's `afterAll` cleanup hook timed out under load 33 with no failed test.
    That is load. The worker's run of the same file in four groups had none, and every Linux CI leg is green at
    `2555b082`. No quiet-box re-run.

- **2026-10-02 11:25 UTC — the operator approved wave 9 and split the macOS reds by owner.**
  - **The measurement.** main's latest daily full run (`0db98707`, run 36960555979) has 57 failing macOS
    cases in 8 files (counted per file from the three test-macos logs). The earlier count of 9 was taken at `a742eb6a`, before the GPT lane's #217 merged.
    - **12 are this programme's:** `ccrc-update` (4: the killed-flip `--detach` control, `_upd_redact`'s
      `jq` escaping, `_upd_phase` and `BASHPID` under bash 3.2, the long-HOME floor), `update-spawn` (2, the
      grandchild pipes), `ccrc-install` (5: two versioned-tree cases, and three missing-dependency cases whose
      harness has no `systemd-run` on Darwin), and `ccd-tmux-anchor` (1, D-3525's dotted id).
    - **45 are the GPT lane's:** `ccrc-codex` (39), `ccrc-account` (4), `ccgpt-runtime` (1) and
      `ccd-account-auth` (1). Their causes: the fake LiteLLM stand-in never listens on macOS, the port probe
      answers 1, and `/bin/true` does not exist there.
  - **The operator's rulings:**
    - wave 9 fixes this programme's 12, plus the residue worth shipping;
    - the GPT lane's 45 are reported to that programme (mail 3139; the count corrected after);
    - `stable` waits for both.
  - **Scoping:** three Opus scouts (workflow `wf_cfc47ce3-16a`) re-measure the 12 and residue R2–R11 at
    `6ca3d163`, before scope is chosen.

- **2026-10-02 14:20 UTC — wave 9 planned: stable readiness.**
  - **Scoping** (workflow `wf_cfc47ce3-16a`, three Opus scouts) re-measured this programme's 12 macOS reds and the
    residue R2–R11 at `6ca3d163`.
    - The 12 are deterministic, not flaky: identical in the 10-01 and 10-02 daily runs.
    - Eleven are harness or platform-scoping defects with no product change. The PATH-less spawns resolve
      macOS's `/bin/bash` 3.2. A Linux-only `--detach` control runs under a plain `it`. `setsid` is absent on
      macOS. openrsync re-execs through the recorder stub. A `#217` guard contradicts the Darwin block's PATH.
    - One, M8, is a real product bug from the tmux version, not from macOS. tmux 3.7c keeps a `.` in a session
      name, where 3.4 rewrites it, so ccd's predicted target misses a live dotted session. Both live boxes run tmux
      3.4, and no live session id contains `.` or `:`, measured read-only. So the fix renames no live session.
  - **Scope, as ruled:** the 12, plus the residue small and safe to ship unattended: R10d and R9-F8
    (containment), R10a and R10e (doctor's auth reader), R10g (`ccrc backup` racing a prune, and deleting its
    own backup at KEEP=0, measured), and a prose batch.
    - Deferred to wave 10, because each needs a design ruling: R2 (the lease group), R3 (hung or pid-reused
      updaters, the probe-to-acquire window), R4-1/R4-3, R8a–h, R9-R1 (moot on both live boxes, which keep only
      digested versions; still live for a box on v0.0.38–v0.0.48), R10c, R10f, R10i, R10j, R10k, and the
      `ccd/ccd` harness containment.
  - **Planning:** an Opus writer (`wf_6d861426-169`), then two attack rounds of 38 and 21 breaks, with 4
    blocking in each (`wf_6d861426-169`, `wf_877090d0-920`). Every break was applied, and one Opus verifier
    (`wf_5eaebba1-74e`) found none unresolved. It found two new important defects, which I fixed in the plan:
    - the killed-flip remedy names `--role`, so a bare install cannot write the server build in place on a fleet
      box;
    - the containment rule is scoped to the ccrc builders this wave edits.
  - **Rulings in it:**
    - a spaced or non-canonical key answers "not measured", never a modelled value;
    - on Darwin the reader decides only when every line of both files is a plain assignment with no CR;
    - `ccrc backup` locks its prune only, and the copy-in-progress race is accepted residue;
    - the dotted-id reverse maps stay lossy until wave 10;
    - the remedy names no command when the version is not kept complete;
    - done means the 12 green on the PR's `test-macos` legs, not the GPT lane's 45.
  - **Deviations:** the plan defines the 23 numbers issued for it. The brief names a five-number reserve.
  - Main was merged into this branch first, at `6ca3d163`. Its three hand-resolved plan files take `main`'s
    merged versions, byte for byte.

- **2026-10-04 12:46 UTC: wave 9 dispatched (run 223) to `ccrc-pwa-amber-harbor`.**
  - The first try, on 10-02, was refused `cap-concurrency` (7 of 7 running). It was retried on the operator's word
    today, with 3 runs active.
  - **Re-measured before dispatch, at `main` `59a435f0`, 13 commits past the plan's base:**
    - Task 2's two censuses, the id↔name copies and the live-name readers, still give the same eleven lines each,
      only shifted.
    - `_tmux`'s body and the count of tmux creators are unchanged. Every `ccd/ccrc` function Tasks 2, 4 and 5
      name is present.
    - `_upd_backup_set` gained a `ccd-body` row (#222). It changes nothing in Task 5's keep-set, which identifies
      a tree backup by its `server-dist`/`agent-dist` copies.
  - **The brief was updated in two places:**
    - It says the anchors still hold at `59a435f0`.
    - It names the claims standing today: 955 (run 174, `ccd/ccrc`, PR #215, which also edits `ccd/ccd`) and
      957 (run 255, `README.md`). The two it named on 10-02 have ended.
  - #222 has merged, but the plan's ban on editing `ccdWsHelpers.ts` stands as written. The ruling did not
    change.
  - The route, the items and the reserve are unchanged.

- **2026-10-04 22:56 UTC: R12 investigated, split into two waves, and ruled.**
  - **The investigation:** workflow `wf_790a5b99-8ca`, read-only, with five Opus agents (three readers, a
    synthesis and a completeness critic) over `main` at `b40f4145`. It confirmed the defect.
    - `_upd_sweep`'s Linux arm lists once (`ccd/ccrc` `after_listing`), then verifies serially, and the first
      failure is a `_ccrc_die`. That die writes phase `failed` and exits 1, after the gate passed, so nothing is
      restored.
    - The server's `isHalting` reads the row and holds every move until a human acks. Nothing settles a failed
      row on its own.
    - The macOS arm (`_ccrc_job_stayed_up` over `kicked`) has the same shape.
    - `deploy.sh` calls the same script per unit.
  - **Measured before the rulings:**
    - The archive wrote `ccrc-pwa-still-summit.stopped` at 22:10:50 (content `<epoch> ccd`), one second before
      the unit stopped at 22:10:51. A check that read that stamp would have passed this exact case.
    - Once a stopped unit is unloaded, systemd 255 reports its `ActiveEnterTimestamp` as empty. So no freshness
      check can rest on it.
    - The unit sets `Restart=always`, so a crash reads `activating` or `failed`, and `inactive` is reached only
      by an explicit stop.
  - **The vital fact for sequencing:** the move INTO a fix runs the old `_upd_sweep`. That sweep resolves
    `deploy/verify-service.sh` through `~/ccrc` at call time, and by then the link names the NEW tree. So a
    classifier in the script protects the very move that ships it, and a fix in `_upd_sweep` alone protects
    nothing until the move after.
  - **Wave 10 = R12's script half.** It covers `deploy/verify-service.sh` and its tests only, and touches no
    `ccd/ccrc` or `ccd/ccd`, so it runs beside wave 9 with no overlapping file.
    - For a `claude-session@<id>.service` unit that fails, the script re-polls, within a bound, until the
      unit settles.
    - It passes, with exit 0 and its own "stopped on purpose" line, iff the unit settled `inactive` AND either
      `~/.cc-sessions/<id>.stopped` exists OR the row is purged (no `<id>.uuid`).
      - The critic's B1: ws-rm, forget, reap and reclaim all purge `.stopped` within seconds.
    - Every other unit, and every other state, fails exactly as today.
    - Every test runs on a fixture HOME. The critic's I7: today's harness spreads the real `HOME`.
    - A cross-version case runs `main`'s current `_upd_sweep` against the new script.
  - **Wave 11 = R12's sweep half, after wave 9 merges.** Wave 9 and claim 955 both hold `ccd/ccrc`. It covers:
    - one shared window, by concurrent per-unit calls rather than a new multi-unit argument (B2: an older
      script, reached by a rollback flip, would verify only the first unit);
    - the report-ownership guard on the sweep's die;
    - a die never inside a pipeline subshell (I8);
    - the die's wording, which names a backup no path restores;
    - the 200-character cap;
    - the Darwin arm.

    The deferrals listed for wave 10 on 10-02 move to wave 12.
  - **Rulings:**
    - An UNSTAMPED `inactive` unit, such as a hand `systemctl stop`, still fails. This is conservative and
      unchanged, and it is revisited once wave 11 has measured the swap rate inside a window.
    - No freshness clause. Under `Restart=always` an `inactive` unit is always a deliberate stop, so a stale
      stamp can only wave through a deliberate stop, never a crash (the critic's I1, accepted).
    - No bulk-stop cap (I9). The verify asks whether the NEW supervisor stays up. A ccd verb that stops
      sessions is not a supervisor crash, and reclaim's correctness is the child-reclamation programme's guard.
    - One pane death inside the window, which reads as MainPID churn, still fails in waves 10 and 11 (the
      critic's I4). Wave 11's single window cuts that exposure about N-fold. Whether one OOM'd session should
      halt the fleet is a question for the operator after that, with measurement.
  - **The halted fleet row:** advised to the operator to ack. A repeat false failure costs one more ack, and the
    box stays healthy. Holding the ack would freeze v0.0.79 (#215) and stall-watch wave 6's server half until
    wave 10 releases. Until then, a stop by hand or by a coordinator during a fleet move can fail it again.

- **2026-10-04 23:59 UTC: wave 10 planned (run 261).**
  - **Planning:** an Opus writer, then two Opus attackers (live safety; tests and containment), a revision, an
    Opus verifier, and a final edit (`wf_9e152cc0-e35`, `wf_8d68b90d-a85`).
    - The attacks found one blocking break. The draft's classifier also ran on the crash-loop branch, so a pane
      death followed by a stamped stop would have passed, against ruling 6. Now `fail()` passes the observed word
      on, and only `inactive`, `deactivating` or no-MainPID is classified.
    - They also found a FIFO hang in the harness's registry snapshot.
    - The verifier found nothing blocking and nine minor issues, all applied. Among them, Task 2's mutation row
      mutates a scratch COPY, so `ccd/ccrc` is never written.
  - **Rulings on its six readings, all of them derivable:**
    - an absent registry or an unset HOME fails, and an id containing `/` is refused;
    - Task 2 sources the checkout's `ccd/ccrc`, and wave 11 re-homes it;
    - the pass line reaches stdout only;
    - only a stop-shaped failure is classified, so an observed `activating` or `failed` is never classified
      either;
    - no systemd version check, because the premise is `Restart=always`'s documented semantics.
  - Numbers 3946 to 3957 were issued to run 261. The plan defines D-3946..D-3949, the brief's reserve is numbers
    3950 to 3954, and 3955 to 3957 are kept for fix rounds. Each is written bare until it is defined.

- **2026-10-05 01:13 UTC: ask 16 from run 261's worker answered "Rerun foreground".** Claude Code's memory-pressure
  reaper killed the Task 3 server gate during `ccrc-install`. The box had 2 GiB free, with 6 of 7 GiB of swap in
  use. Tasks 1–2 had passed review, the agent suite was 452/452, and the new case 6/6.
  - Ruled from the plan: suites run "in the foreground, one command per call", and the brief puts the full gate
    "before the push". So letting CI stand in for the gate is out, and the reaper takes idle background shells,
    not a foreground run.

- **2026-10-05 02:19 UTC: wave 10's wave-done, re-measured, and the bar committed BEFORE its review.**
  - **The claim:** PR #247 at `a9a1cef8`, re-measured. It is open, not draft and mergeable. Its head equals the
    fingerprint. All 8 commits carry the noreply identity, and it changes 4 files: the plan, the script, and the
    two test files. `main` is unmoved at `b40f4145`.
    - The worker reports every mutation row (M1–M21, Mgate, Mword, T1–T7) red, exactly as listed. Its line-pin
      diff and its scope check are empty.
    - The server suite was NOT run in full on the box, because of load and memory. Full CI run 37254804678 on the
      tip is the arbiter, and on the PR every Linux leg that has finished is green. `probe-macos` failed, and it
      gates nothing.
  - **Bar for the merge.** The held-out review (clause 14) must find NO confirmed finding of these classes:
    1. a crashed, crash-looping, restarting or never-started session unit, or any non-session unit, passes the
       script;
    2. any passing path, or any non-session unit, behaves differently from `main`;
    3. the move INTO this wave is not protected, meaning that `main`'s `_upd_sweep` with the new script returns
       non-zero for a stamped or purged deliberate stop;
    4. a test reads or writes outside its fixture HOME, or a real tool can run;
    5. a write to `ccd/ccrc` or any other out-of-scope file, or a moved line among 48–62;
    6. an undefined or unissued deviation number.

    Also, every Linux leg of run 37254804678 must be green.
  - **The rounds:** one bar-class finding gets one fix round, and then a scoped review. A coverage or prose
    finding is fixed in that round if one runs, and otherwise becomes residue. The worker's parked note, that
    a never-existed id reads as purged and no sweep can reach it, is residue for wave 11 unless the review shows
    it reachable.

- **2026-10-05 02:43 UTC: the work volume was full, and review 263 was held for 21 min.**
  - The first dispatch of review run 263, at 02:21, was refused with a bare 502. `ccd ws-add` reported that
    `~/worktrees` had 5 GB free against its 10 GB floor.
  - The worktrees live on the attached work volume, not the root disk: 99% used, 5.6 GB free. The hourly probe
    measured `$HOME`'s filesystem only, so it never saw this. It now reports `work:` and flags anything under
    15 GB.
  - The fix was the volume growth that has been owed to the operator since 2026-10-02.
  - **What was freed, and by whom:**
    - I removed only my own scratch, about 0.7 GB.
    - Wave 10's worker, on request, removed about 5.1 GiB of its own killed-run test fixtures, which no process
      was using. That left 12 GB free.
    - Review 263 was then dispatched at 02:42.
  - **Consequence for briefs:** my wave 9 and 10 briefs had put worker scratch and `TMPDIR` on this volume, which
    was the right call on 10-01, when the root disk was the scarce one. From now on, scratch goes on the root
    disk.

- **2026-10-05 03:17 UTC: review 263 ruled. Wave 10 meets the bar, and #247 merges.**
  - **The review:** `ccrc-pwa-clear-meadow`, workflow `wf_4f6cc413-32b`, 54 agents. Six Opus lenses ran, each
    finding got three Sonnet refuters, and the majority decided: 5 findings confirmed, 11 refuted. No lens went
    unverified and none was unexamined.
    - `main`'s unedited `_upd_sweep` with the new script returns 0/0/1/1 for a stamped stop, a purged stop, an
      unstamped stop and a crash. So the move INTO wave 10 is protected.
  - **CI:** every Linux leg of run 37254804678 and of the PR is green. `full-suite` is red only through the macOS
    legs. None of the macOS reds is in a wave 10 file, re-measured from the four job logs.
  - **Rulings:**
    - **F2: residue R13a, by the bar.** A never-loaded or oddly named session unit, with the registry present
      and no `<id>.uuid`, reads as purged and passes. That is class 1 by the letter. It was measured
      unreachable: both sweeps list only active units, the gate and `_inst_enable` pass only the agent and
      server units, and ccd's ids match `^[A-Za-z0-9._-]+$`.
      - Wave 11 closes it: the id must match ccd's grammar, and the unit must read `LoadState=loaded` before the
        purged arm.
    - **F1, F3, F4 and F5: residue R13b–e.** No fix round runs, so they are fixed in wave 11:
      - F1: an unpinned re-poll `sleep`;
      - F3: an unpinned `-L` half on the evidence read;
      - F4: an unpinned `?*` in the unit glob;
      - F5: one plan sentence wider than its Global Constraint.
  - **Seen while measuring macOS for `stable`:** the full run also fails on macOS in `session-hook-merge-deny.test.ts`,
    in 20 heredoc cases of "the worker merge deny". That file is landing-order wave 2's (#234) and is not in the
    10-02 census. Its owner, `ccrc-pwa-quiet-river`, is told, because it also blocks `stable`.
    - `ccd-account-auth.test.ts`'s one red is already in the GPT lane's 45.
    - An earlier `ccd-lifecycle-purge` match was the word FAIL inside a passing case's title.

- **2026-10-05 05:52 UTC: wave 9's wave-done, re-measured, and the bar committed BEFORE its review.**
  - **The claim:** PR #251 at `f74f5e90`, re-measured.
    - It is open, not draft and mergeable, and its head equals the fingerprint.
    - All 18 commits carry the noreply identity. It changes 28 files, and the scope check (agent/src, deploy,
      pwa, server/src, units, the two forbidden test helpers) prints nothing.
    - It absorbed `main` once at `b40f4145`. `main` has since moved to `a6daa9cf` (wave 10, four disjoint
      files). PR CI tests the merge ref, so it covers that state.
  - **The worker's suite: red, "load, not a defect".**
    - Every file that failed in the sharded run is green in isolation, except `tmp-sweep`'s fail-closed case,
      which reds identically on a `git archive` of `main` (a fleet-box environment case).
    - The PWA's 14 timeouts were under load, and each of those files is green alone.
    - The worker holds no macOS result yet.
  - **Bar for the merge.** The held-out review (clause 14) must find NO confirmed finding of these classes:
    1. **Task 2, live:**
       - a live session, dotted or not, reads as gone, or a `-t` target misses it, on tmux 3.4 or 3.7c;
       - any change to the tmux name of a live-alphabet id (no `.` or `:`);
       - a supervisor that changes behaviour on a live box;
    2. **Task 4:** doctor says ARMED where the unit leaves the gate off, or prints a value a secret file holds;
    3. **Task 5:**
       - the prune removes this run's own backup, a dir named at or after it began, the newest earlier tree
         backup or coord.db snapshot, a hand-named sibling or a plain file;
       - it prunes without the lock;
       - it breaks `ccrc backup`'s pinned echo or exit contract;
    4. **Task 3:** a test that runs the real `ccd/ccrc` and is not structurally contained, or any read or write of
       a live path;
    5. **Task 1:** any product change (it is test-only);
    6. **Scope and numbering:** an edit under `deploy/`, to a unit, `ccdWsHelpers.ts` or `codexLaneFixture.ts`, or
       an undefined or unissued deviation number.
  - **CI and macOS:**
    - Every Linux leg of the PR must be green. A file the selection does not run is held to the worker's isolated
      green, and the `tmp-sweep` case is accepted as `main`-red.
    - **macOS acceptance** is read from the PR's `test-macos` legs:
      - each of the 12 cases by name, green, with case 4 skipped;
      - none of Task 4's `itDarwin` twins red (A1d, E3d, E5d, E6d, E13, E14d, X2d, X3d, X4d).

      A macOS red outside those sets is the GPT lane's or landing-order's.
  - **The rounds:** one bar-class finding gets one fix round, and then a scoped review. A coverage or prose
    finding is fixed in that round if one runs, and otherwise becomes residue. The worker's six parked minors are
    residue for wave 11 or 12 unless the review shows one reachable live.

- **2026-10-05 06:29 UTC: wave 9's macOS acceptance met, read from PR #251's own `test-macos` legs** (run
  37269535399, jobs 111633442008 and 111633442042).
  - The four files that hold the 12 cases are green on macOS:
    - `ccrc-update`: 503 tests, 123 skipped;
    - `ccrc-install`: 313 tests, 48 skipped;
    - `update-spawn`: 15 tests;
    - `ccd-tmux-anchor`: 34 tests.

    Case 4 is `itLinux` now, so it skips on macOS by construction.
  - `update-killed-arms` is green too.
  - The legs' remaining reds are all the GPT lane's: `ccrc-codex` 39, `ccrc-account` 8, `ccrc-doctor` 7,
    `ccgpt-runtime` 1, `ccd-account-auth` 1.
    - `ccrc-doctor`'s seven are all "codex, part 2" and `--fix: codex` cases, from Plan 3a (#239). So none of
      Task 4's `itDarwin` twins is red.
  - Every Linux leg of the PR is green. The held-out review (run 265, `ccrc-pwa-warm-mesa`, dispatched 05:54) is
    still to rule.

- **2026-10-05 07:10 UTC: review 265 closed; wave 9 gets its one fix round, by the committed bar.**
  - **The review** (workflow `wf_175156c7-659`, 38 agents; the panel plus three brief lenses and the whole-branch
    pass, all Opus, three Sonnet refuters per finding) confirmed nine findings 3–0 and refuted one.
    - Bar classes 1 and 3–6 found nothing. Every tmux name and `-t` target is identical to `b40f4145`'s for the live
      alphabet, measured on tmux 3.4 on a private socket.
    - The prune keeps every protected shape and takes the lock. Containment holds, Task 1 is test-only, and scope
      and numbering are clean.
    - The merge's `ccd/ccd` line 2 was recomputed, not picked. README is 5609 lines, `main`'s count.
    - All 10 re-measured mutation rows red. Every file this wave changed is green on macOS.
  - **F1 meets class 2.** On macOS, a NUL byte in either env file makes doctor read `CCRC_AUTH=on` (ARMED). The
    launchd job's `/bin/bash` 3.2 `.` truncates the file at the NUL, so the gate stays off. The Darwin plain reader
    reads through `read -r`, which drops the NUL; the Linux arm already refuses one (D-3831). It is not reachable
    live, since both boxes are Linux.
  - **Ruled: the one fix round.** Class 2 names no platform and no live-reach condition (class 1 names "a live box";
    class 2 does not). The Darwin arm is this wave's own code, written to close exactly this class. So "pre-existing
    in outcome" does not move F1 to residue.
    - F1 takes reserve number 3832 (bare: its definition goes on the worker branch).
    - The round also carries F2 (the export arm brought to D-3823's own text), F3 (a pin for the own-dir guard),
      and F4–F8 (prose and citations; F8 only if `ccd/ccd` stays line-neutral).
    - F9 is `main`'s file and joins R13 as (f). F4's filter factoring, F5's raw-spawn scan and the worker's six
      parked minors become R14.
  - **The scoped review's bar** is committed in the rulings before that review runs. It holds this round's delta to
    six classes. One of them is that a NUL anywhere in either file on Darwin never reads ARMED or decides a key.
    After that review, #251 merges.
  - The worker does not merge `main`: `a6daa9cf`'s four files are disjoint, and `git merge-tree` is clean.
  - The rulings are in `.superpowers/rulings-run223-fix1.md` on the coordinator's worktree.

- **2026-10-05 07:47 UTC: wave 9's fix round 1 done at `670d25fd`; scoped review run 266 dispatched.**
  - **Re-measured:**
    - One commit on `f74f5e90`, by the noreply identity: 7 files, +157/−28. PR #251's head equals it.
    - The scope check prints nothing, README is 5609 lines, and the only new number is 3832 (bare: defined in the
      plan on the worker branch).
    - `main` (`4100ae1c9`) was not merged, and `git merge-tree` onto it is clean.
  - **The worker's gate** (foreground, one file per call, TMPDIR on the root disk) is green: ccrc-doctor, ccrc-update,
    ccrc-containment, ccd-tmux-anchor, ownership, session-hook (no anchor drift), typecheck-tests, macos-platform and
    the three guards. Each new pin's mutation row reds. `ccd/ccd` stays line-neutral and is restamped.
  - **CI** on the new merge ref is still running. The scoped review (run 266, `ccrc-pwa-plain-prairie`) runs the
    panel plus one auth-reader lens over this round's delta. After it, #251 merges under the bar in the rulings, and
    I read E19d and the 12 cases on the PR's `test-macos` legs.

- **2026-10-05 08:50 UTC: scoped review 266 closed; wave 9 gets fix round 2, announced as the last.**
  - **The review** (31 agents; the panel plus an auth-reader lens, three Sonnet refuters per finding) confirmed four
    findings and refuted two.
    - Item 2 was read against systemd v255's own `env-file.c`: no input moves from rc 3 to a value systemd would not
      hand the unit.
    - The prune, `ccd/ccd`'s comment-only restamp, B10's fixture-local `date` stub, scope and tracked text are clean.
    - All four re-measured mutation rows red as recorded.
  - **F1 meets round 1's scoped class 2.** The new NUL detector reads in the caller's locale. The Linux caller pins
    `LC_ALL=C`; the Darwin caller does not.
    - Under a UTF-8 locale, a NUL right after an incomplete UTF-8 lead byte is missed, so doctor says ARMED while
      the launchd job's gate is off.
    - Every pin runs under `LC_ALL=C`, which is why E19d and U4 are green on macOS.
  - **Ruled: it goes back.**
    - The outcome predates the round, but class 2 was written to test whether item 1 holds. A reading that excused
      every pre-existing outcome would leave it empty.
    - The failing code is the round's own detector, and the plan's D-3832 text says "anywhere".
    - The fix is the review's measured remedy, placed at the Darwin arm's entry, with the detector pinned too. It
      takes reserve number 3833 (bare: its definition goes on the worker branch).
    - F2 (the same locale root merging two lines; pre-existing) is covered by that one pin. F4 (a mutation row's
      wording) is fixed in the round. F3 is residue R14(e): no line number is owed, because since the anchor only a
      line naming exactly the key can trigger the verdict.
  - **CI at `670d25fd`:** `server 3/5` is red only on `ccrc-update`'s `afterAll` fixture cleanup, which timed out at
    20 s with all 2720 tests passing; it was green at `f74f5e90`. The worker checks that B10 leaves nothing that slows
    removal. The push re-runs CI, and a repeat is reported rather than its timeout widened.
  - **The bound:** this is the last round. Its scoped review sends a finding back only if the round's own delta makes
    doctor say ARMED where the gate is off (either platform, any locale) or changes a Linux verdict. Anything else is
    residue, and after that review #251 merges.
  - The rulings are in `.superpowers/rulings-run223-fix2.md` on the coordinator's worktree.

- **2026-10-05 09:37 UTC: wave 9's fix round 2 done at `0491a823`; its scoped review waits for disk.**
  - **Re-measured:**
    - One commit on `670d25fd`, by the noreply identity: 4 files, +99/−13. PR #251's head equals it.
    - The scope check prints nothing, README is 5609 lines, and the only new number is 3833 (bare: defined in the
      plan on the worker branch).
    - `main` (`4100ae1c9`) was not merged, and `git merge-tree` onto it is clean.
  - **The worker's claim:**
    - The Darwin arm and the NUL detector each carry their own `LC_ALL=C`.
    - F1 and F2 now read rc 3 and `off` under C, C.UTF-8 and en_US.UTF-8.
    - A differential fuzz (2,500 file pairs × 2 keys) changed no Linux verdict under either locale. It moved four
      Darwin verdicts, all from rc 0 to rc 3.
    - The new rows fail, never skip, when no UTF-8 locale takes effect.
    - B10 leaves nothing behind that slows the fixture cleanup.
  - **Ruled: R14(f).** The worker found the Linux `unit`-mode line loop reads in the caller's locale too. Under UTF-8,
    a line ending in an incomplete UTF-8 sequence merges with the next, which can give a false ARMED on Linux.
    - It is identical at `b40f4145` and outside round 2's bar, which forbids any Linux verdict change, so the worker
      left it.
    - Live reach: only a hand-edited or corrupted file. No shipped writer emits one.
    - It is residue R14(f) and the first item for wave 11, which edits `ccd/ccrc` anyway.
  - **Blocked on disk, not on the review:**
    - A review run always spawns fresh (the open route refuses a `sessionId` on one), and `ccd ws-add` refuses below
      10 GB free on the work volume, which reads 9.41 GB.
    - The brief is staged. The review dispatches once the operator resizes the volume or approves deleting the
      finished waves' leftovers.
    - Nothing deploys meanwhile in any case: both boxes are held by the unacked v0.0.78 fleet row.

- **2026-10-05 10:29 UTC: scoped review run 269 dispatched; CI green on Linux; macOS acceptance met at `0491a823`.**
  - **Dispatched:** the work volume read 10.48 GB at 10:27, so the staged brief went to `ccrc-pwa-swift-prairie` at
    10:28, and the run was advanced to `working`. The review is the panel over round 2's delta, under the round-2 bar's
    two classes.
  - **CI run 37290717097:** every Linux leg is green, `server 3/5` included. Its `afterAll` timeout at `670d25fd` did
    not recur.
  - **macOS, read case by case from the `test-macos` legs:**
    - The files that hold the 12 cases are green: `ccrc-update` (504 tests, 123 skipped), `ccrc-install` (313, 48
      skipped), `update-spawn` (15) and `ccd-tmux-anchor` (34). So are `update-killed-arms`, `ccrc-containment`,
      `ccrc-cli`, `ccd-route-settle` and `macos-platform`.
    - In `ccrc-doctor`: E19d, U4u and U4n are ✓, and so are all nine of Task 4's `itDarwin` twins (A1d, E3d, E5d,
      E6d, E13, E14d, X2d, X3d, X4d). Its seven reds are all "codex, part 2" and "`--fix`: codex" cases (Plan 3a).
    - The other reds are the GPT lane's: `ccrc-codex` 39, `ccrc-account` 8, `ccd-account-auth` 1 and
      `ccgpt-runtime` 1.

- **2026-10-05 11:10 UTC: scoped review 269 closed; wave 9 MERGED as `00f8a193` (#251).**
  - **The review** (27 agents; the panel, three Sonnet refuters per finding) found nothing in either class of the
    round-2 bar.
    - **Darwin:** fuzzes of 3,000 to 9,120 file pairs were checked against a bash 3.2.57 oracle running the launchd
      plist's own source line. They found 0 false ARMED under C, C.UTF-8 and en_US.UTF-8; `670d25fd` under UTF-8
      had 35 to 1,776 mismatches.
    - **Linux:** 0 verdicts changed under any locale.
    - T4-M31, M32 and M33 re-measured as recorded.
  - **Its four minors become residue R14(g–j):** a pin for the plain test's own line loop, D-3833's fuzz sentence,
    the macOS locale record, and a pre-existing POSIX-mode readonly abort.
    - **F2's question, ruled:** a corpus count in a deviation's text reads as a claim about the change. So the
      sentence is reworded to the property it is meant to state. That is prose, so it is residue, not a send-back.
  - **The merge.**
    - The PR was merged at its reviewed tip with `--match-head-commit`.
    - The merged tree equals `git merge-tree` of `0491a823` onto `b5593725` (`d00d4074`).
    - `main` had moved from the tested `4100ae1c9` by #252 alone, one plan file, no deviation number added, and no
      file of this wave's.
  - **Runs:** wave 11's run 270 was opened (planned) before run 223 closed final as merged (`released:true`, child
    reclaim queued, which frees the worker's workspace on the work volume). Review run 269 is done.
  - **Wave 11's block,** allocated at its run's open (clause 10): numbers 3972 to 3991, twenty, for the plan's
    departures and a worker reserve (bare: none is defined yet).
  - **Wave 11's scope, ruled:**
    - R12's sweep half (the 2026-10-04 22:56 list);
    - R13 (a–f);
    - R14 (f–j), the auth reader's residue, with (f) first. It edits the same `ccd/ccrc` functions and test file the
      wave touches anyway.
    - R14 (a–e) joins wave 12's deferrals.

- **2026-10-05 13:58 UTC: wave 11's plan drafted and attacked; the operator re-ruled ruling 6 ("re-check once").**
  - **The draft:** one Opus writer, read-only on `main` at `00f8a193`, produced 9 tasks. The departures are numbers
    3972 to 3982, 3983 to 3986 are spare, and 3987 to 3991 are the worker's reserve (bare: the plan is not yet
    committed).
    - It measured `LoadState` on systemd 255's system manager.
    - It measured a stub prototype of the concurrent verify: 65 units in 8.7 s, against about 11.6 min serial.
    - It measured which variable names abort the launchd job's `.` under bash 3.2.57 and 5.2.
  - **The attack** (workflow `wf_6ef19291-c0d`: four Opus lenses, read-only on the live box, then one Sonnet
    refuter per lens) confirmed 26 findings. None was blocking after refutation; nine were important.
  - **F1 (live window), measured on the 24 recorded update sweeps since 2026-09-29:**
    - Supervisor exits run hot right after a sweep's restart: 3 in the first 120 s against 0.25 expected at the
      0.30/h baseline.
    - The shared window puts every unit's one exposure about 22 to 27 s after the restart. On 2026-10-04 at 22:06, a
      supervisor whose tmux session ended exited 28 s after its restart and came back at +30 s.
    - A shared window would have failed that update. The serial loop passed it, because it verified the unit after
      the unit recovered. So: the old sweep with wave 10's script fails 0 of 24; the planned sweep fails 1 of 24.
    - Ruling 6's premise, "wave 11's single window cuts that exposure about N-fold", holds for permanent stops only,
      not for a transient death.
  - **The operator's ruling (13:58, asked as 22:56's deferred question): "Re-check once."**
    - A unit whose verify fails in a crash-like way (a non-zero exit and no "stopped on purpose" line) gets ONE more
      single-unit verify after its batch. The update fails only if that also fails. Every re-checked unit is named.
    - Units that read crash-shaped (`activating` or `failed`) in the post-restart listing are verified, with the same
      re-check, instead of only warned about. So a crash-looping build fails, where today it can pass (the
      attack's F4: wave 8 item G only warns).
    - `inactive` keeps item G's warning, because it is a deliberate stop.
    - It supersedes ruling 6 for wave 11. It takes two of the spare numbers.
  - **My rulings on the rest:** every confirmed finding is applied in the revision, and the plan's readings stand as
    drafted except where these change them.
    - **F3, the reload storm:** each restarted supervisor's `systemctl --user enable` reloads the user manager,
      serially, for 27 s at 71 units. Keep the bound at 128, but state the storm and mark the stub-measured timings as
      such. The re-check covers a read that times out behind it. `--no-reload` in `_svc_enable` goes to wave 12 as
      residue (a `ccd/ccd` change).
    - **F7, the root disk filling mid-sweep:** the re-check runs in the foreground, with no rc file, so a full
      scratch disk cannot fail a healthy fleet.
    - **P1, a failed fork:** the sweep never exits without a report. A failed launch falls back to serial for the
      rest.
    - **P4, leftover scratch dirs:** a sweep removes stale scratch dirs of its own prefix at its start.
    - **T-1, verify jobs that outlive their sweep:** the sweep's exit path kills its own verify children by pid, and
      a case asserts that none survives.
    - **A1, a refused name in the reason text:** `BUE_WHY` names the cause and the line number, never the name.
    - **T-4, a `-t` filter that matches nothing:** the gate asserts that each `-t` part ran at least one test.
    - **T-8, the frozen old sweep:** pin, or freeze, the helpers it calls.
  - **Measured and now stated as measured:**
    - `LoadState=loaded` holds on the live USER manager for never-existed ids, escaped ids, `..` and 35 real purged
      ids (F5).
    - A dispatched swap sleeps a 0-120 s jitter before it stops a unit. `swap.log` shows 0 dispatches within 130 s
      of any sweep (F2).

- **2026-10-05 16:04 UTC: wave 11 planned (plan `966ffe9f`) and dispatched (run 270, `ccrc-pwa-clear-meadow`).**
  - **The revisions:**
    - Round 1 applied the attack's 26 findings and the operator's re-check, as D-3983 (re-check once) and D-3984
      (crash-shaped units in the post-restart listing).
    - Round 2 applied my rulings on readings 17 to 19:
      - stop at the first failed re-check; the die names k crash-like units, the first failed re-check, and m left
        un-re-checked;
      - a unit the launcher never started gets the same re-check;
      - an unreadable crash listing prints one not-measured line, then item G's warnings.
  - **The final verify** (`wf_cc4fcd92-a09`; two Opus verifiers, each with a Sonnet refuter) ran the plan's own code on
    a scratch copy against stubs. Nothing was blocking. It measured:
    - 65 healthy units, rc 0 in 8.86 s;
    - the 22:06 shape, passing on its re-check;
    - a crash loop: one re-check, then the die;
    - stamped and unstamped stops;
    - the move INTO wave 11, the old sweep with the new script: stamped and purged pass, unstamped and crash fail as
      before;
    - a rollback flip, the new sweep with the v0.0.79 script;
    - `set -m` under every signal shape.

    The two important findings, and four minor ones, were applied in a third revision:
    - **V1:** a survivor check asserted before it reaped, so a red run could leak a verify job.
    - **V2:** the gate's `-t` sum rule could not be met as written.
    - the exit-path kill could signal a group twice (L1);
    - three mutation rows had wrong red sets (L2/V3);
    - the scope check let the systemd drop-ins through (V4).
  - **Ruled at commit:** readings 1 to 20 stand as they now read. Task 7's D3 runs on Linux with a GNU-`stat` shim for
    `_plat_size`, and an `itDarwin` twin D3d runs the real one on the macOS legs.
  - **The brief:**
    - The worker cherry-picks `966ffe9f` and does Tasks 1 to 9 in order.
    - Routing: Opus · high main loop, workflow off, compact 40; implementers Sonnet · high; per-task reviewers
      Opus · high, with extra instructions for Tasks 1–2, 5 and 6.
    - The worker never writes `ccd/ccd`, which claim 1019 (run 248) holds.
    - TMPDIR goes in the worker's scratchpad, and it stops under 20 GB free.
    - Process listings mask the box token (R16).
  - **Live effect at merge:** the move INTO wave 11 runs the box's current sweep with the new script. Wave 11's own
    sweep protects the moves after it.

- **2026-10-05 16:27 UTC: `stable` readiness — the GPT lane's macOS reds are fixed (#240, `be93d159`; its mail
  3524).**
  - **The cause:** `codexLaneFixture.ts`'s two Python stand-ins called `socket.getfqdn` between bind and listen, the
    macOS stall that #204 had fixed in the shipped shim. #240 also fixed P18 and `_rt_fail`, and made C12–C15 and L0e
    systemd-only. It is test-only.
  - **The evidence:** #240's `test-macos` 1/2 and 2/2 passed with 0 failed, on a merge ref that includes wave 9. Per
    file: `ccrc-codex` 203, `ccrc-account` 331, `ccrc-doctor` 676, `ccd-account-auth` 125, `ccgpt-runtime` 72,
    `ccrc-install` 313 and `ccrc-update` 504.
  - **What is left before a promotion:**
    - landing-order's `session-hook-merge-deny` macOS reds, in that programme's fix round (review 267: jq 1.8's `as`
      precedence);
    - then a green `full-suite` on a `main` commit, from a daily run or the stable gate. A pull request's selection
      does not count.

    The promotion itself, a fast-forward push to `stable`, is the operator's to call.
  - **2026-10-05 17:51 UTC, run 270's question (mail 3557), ruled A (answer mail 3558).** Task 2's per-task review
    found that `HISTCMD` and `OPTIND` stop the launchd job outside POSIX mode. Both are integer variables with no
    assign function, so a value that is an arithmetic error (`1/0`, `09`, `1+`) ends the job's bash with rc 1 before
    `exec`, on bash 3.2.57, 4.4 and 5.2.21, while doctor reads ARMED. That is D-3980's own class.
    - Ruled: add the two names to the refused set, spending reserve number 3987 (bare until the worker defines it).
      Refusing by name stays order-free and file-free. Refusing only non-decimal values would put a second parser in
      the plain test, and leaving it would leave a measured false ARMED in place.
  - **2026-10-05 18:24 UTC, run 270's Task 6 signal question (mail 3561), ruled (answer mail 3565).** Task 6 committed
    (`e92b38cd`), and its per-task review approved the sweep as the plan's block. The review measured two behaviours
    that the plan mandates:
    - **(1) Ctrl-C: fix in this wave, spending reserve number 3988 (bare until the worker defines it).**
      - **The behaviour:** `set -m` gives each verify job its own process group. So a SIGINT to the sweep's group
        during a concurrent batch is lost, and the run ends `SWEEP_OK`, rc 0. On `main`, the serial sweep dies in
        under a second.
      - **Why fix it:** it is a regression this wave introduces, of a class this file has already ruled (D-141,
        `cmd_passwd`: an operator's Ctrl-C must abort).
      - **The outcome required:** the run ends by SIGINT within about a second, with no `SWEEP_OK`. The in-flight jobs
        are killed through `_upd_sweep_kill`. No process survives, and no scratch dir is left. TERM and HUP stay as
        shipped.
      - **Placement cautions, which the worker measures:**
        - The sweep shell runs its own trap only after the launcher subshell returns.
        - An `exit 130` would read as a failed launcher, so the handler re-raises instead.
      - **The pin:** a SIGINT case, and a mutation row that drops the handler. Its per-task reviewer hunts for any
        verdict that moves with no SIGINT.
    - **(2) Foreground calls outside the kill's reach go to residue (R17).** These are the re-check, an unrecorded
      unit's first verify, and the no-scratch fallback. A TERM to the sweep's pid alone leaves the call to finish,
      read-only, within seconds. That is the same class as `main`'s serial loop. A unit stop kills the whole cgroup,
      and no test leaks.
    - **Also:** the worker found that `list-units --plain` prints no marker column for failed units. systemctl's man
      page says the same: `--plain` omits the bullet circles. So the crash-shaped listing parses correctly, and not
      only on systemd 255.
  - **2026-10-05 19:13 UTC, the Ctrl-C fix's review (mail 3574), ruled (answer mail 3575).** The fix landed as
    `26d3a4d7`. Its number, reserve 3988, is written bare here because it is defined on the worker's branch, not this
    one. Its shape: the launcher runs async, and the sweep shell waits on it under an INT trap that TERMs the launcher
    and re-raises.
    - **What the review measured:**
      - A SIGINT after the launch loop ends the run by INT within 0.01 s, with 0 survivors and no dir left.
      - A SIGINT during the loop can kill the launcher between a fork and that job's `.pid` write. At 120 units, one
        job then leaks: 9 of 12 group-INT runs on the head, against 2 of 12 on the Task 6 base. The leaked job is a
        read-only verify that ends by itself in about 8 s.
    - **A correction to 18:24:** the review could not reproduce a lost group INT on the base. Only an INT to the sweep
      shell alone was lost. So "on the branch a Ctrl-C is lost" is unproven for a terminal's Ctrl-C. The wave-done
      says which shape a terminal sends and what the base did with it.
    - **Ruled: one fix round under the same number, after Task 7.**
      - The launcher traps TERM to a stop flag, so every forked job gets its `.pid`. The handler waits for the
        launcher.
      - W21's launch-loop variant runs four shapes, each asserting 0 survivors: INT to the group, INT to the shell
        alone, TERM to the group, and TERM to the shell alone.
      - Base and head are measured with the same harness. The number's text points D-3972 (e) at the async launch.
    - **The stopping line:**
      - A shape that still leaks, but is no worse than the base, lands, and the leak goes to residue (R17's class).
      - Any shape worse than the base reverts the fix to the Task 6 block. Both INT behaviours then go to residue, and
        the number is recorded as "taken and reverted".
      - There is no third reshape.
  - **Noise, not this programme's:** `map-build` on `main` went red at `00f8a193` and `4100ae1c`, with five files
    "newly failing under trace". Every test leg was green. At `be93d159` only `boot.test.ts` still failed under trace,
    and at `1eda8630` none did. This belongs to the CI test-selection tooling.

  - **Live effect:** none yet. Both boxes are held by the unacked v0.0.78 fleet row. After the ack, auto moves the
    fleet box straight to the newest release, which now carries waves 9 and 10, and that move runs v0.0.78's sweep
    with wave 10's script. Wave 9's live tmux names are unchanged for every live-alphabet id (review 265, tmux 3.4).
  - **For `stable`:** this programme's macOS reds are fixed on `main`. The promotion still waits on the GPT lane's
    reds and landing-order's merge-deny cases, and on a green `full-suite` on the commit.

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
- **R11 (wave 8, review 203).**
  - **F1.** The (b) case's title says "two DEGRADED lines"; one of them is a warning.
  - **F2.** `_check_auth`'s guard-pin title and comment name the wrong mechanism: it is `|| unmeasured=1` that keeps a
    stale ARMED out. The pin itself discriminates.
  - **F3.** P18's comment says "all three in the removal set"; the plain file never enters it.
  - **F4.** D-3596's "the same way" for a directory: an unreadable regular file is not skipped silently.
  - **F5.** `_upd_sweep`'s header says a refusal's stderr "names the resolved value and the drop-in". That is false
    for the listing refusal.
- **R10 (wave 8, review 196; `rulings-run182-fix1.md`).**
  - **R10a (F3).** doctor's reader trims only a trailing CR. systemd discards surrounding whitespace, so `CCRC_AUTH=on `
    arms the gate while doctor PASSes it as OFF. The test pins the opposite premise. It is reachable only by a hand
    edit.
  - **R10b (F2).** The no-passphrase OFF line names ccrc.env even when the exposure file sets the key, and reads OFF
    when that file cannot be read.
  - **R10c (R-b).** The kill window between the sweep and `done`:
    - on a `server`/`both` box, the watchdog records `failed "abandoned … converged"` and the console halts until ack;
    - on a fleet-role box nothing rewrites `restarting`;
    - `deploy.sh`'s sweep still restarts behind the template probe alone when its listing fails.
  - **R10d (R-f).** `ssh` is unstubbed in `updateEnv` and `ccrcEnv`, which inherit the real `XDG_RUNTIME_DIR` and
    `DBUS_SESSION_BUS_ADDRESS`. It is unreached.
  - **R10e (R-e).** Non-canonical hand-written shapes can read ARMED where the gate is off.
  - **R10f (R-c).** Mixed-TZ backup names sort by name at KEEP≤1.
  - **R10g.** `ccrc backup` racing an update's prune.
  - **R10h.** Task 4's commit body gets its census arithmetic and extra-dir cause wrong. The squash body corrects it.
  - **R10i.** A timestamp-named link is a backup, so it can hold a protection.
  - **R10j.** The Darwin sweep arm cannot tell a failed `launchctl print` from an unloaded job.
  - **R10k.** A refused sweep is invisible to `update.json`, the inventory and doctor. Nothing re-sweeps.
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
- **R12 (2026-10-04, live incident): a deliberate supervisor stop during the update's serial verify fails the
  update and halts every move.** `_upd_sweep` verifies the units of one stale listing one at a time, about 8 s
  each, and dies on the first that is not active. A hand archive at v0.0.78 did it (monitoring note,
  2026-10-04 22:27). Archives, `ccd stop` and child reclaims all reach it. The fix shape is open. One option is
  to re-measure a unit that fails against its registry and warn on a deliberate stop. Another is to verify the
  whole set in one window. A third is whether one supervisor's failure after the gate passed should halt the
  fleet at all.

- **R13 (wave 10, review 263; for wave 11).** (a) F2: before the purged arm, require the id to match ccd's grammar and the unit to be `LoadState=loaded`. (b) F1: pin the re-poll's `sleep`. (c) F3: pin the `-L` half. (d) F4: pin `?*`. (e) F5: reword the plan's Task 1 summary to its Global Constraint. (f) Review 265's F9: three `ccd/ccrc` line citations in `server/test/ccrc-sweep-deliberate-stop.test.ts:7-12` go stale once wave 9 merges; re-point them by content.
- **R14 (wave 9, review 265; for wave 11 or 12).** (a) F4: give `_bak_prune` and `_bak_gc` one spelling of the removal filter. (b) F5: a census scan for raw `ccd/ccrc` spawns (no `env`, `env: process.env`, `{...process.env, HOME: dir}`), which also covers the refuted no-env `spawnSync` in `ccrc-install.test.ts`. (c) The worker's six parked minors, in its wave-done evidence. (d) F8, if the round could not keep `ccd/ccd` line-neutral (it did: closed). (e) Review 266's F3: an optional line number in the Linux per-key `BUE_WHY`. (f) FIRST for wave 11: the Linux `unit`-mode line loop in `_box_env_value` reads in the caller's locale, so under UTF-8 a line ending in an incomplete UTF-8 sequence merges with the next and can read a false ARMED (pre-existing at `b40f4145`; reachable only through a hand-edited or corrupted file); pin `LC_ALL=C` on the Linux path, with a UTF-8 row that fails when the locale does not take effect. (g) Review 269's F1: pin `_box_env_shell_plain`'s own line loop under UTF-8, with a Darwin rc-3 row (ccrc.env `CCRC_AUTH=on`, exposure file `# caf\xc3\nunset CCRC_AUTH`), which reds both the pin's relocation and T4-M31. (h) F2: reword D-3833's fuzz bullet to the property ("no move from rc 3 to a decided value; every move ends at bash's byte-wise answer"), not a corpus count. (i) F3: record which UTF-8 locale the macOS runner took, and whether U4u and U4n can red there. (j) F4: the Darwin plain test passes `POSIXLY_CORRECT=1` plus a readonly name such as `UID=0`, which aborts the launchd job, so doctor's ARMED describes a job that cannot run (pre-existing; not an exposure); refuse readonly and special names.
- **R15 (2026-10-05, the operator's screenshot; product, for a PWA wave).** The home screen hides a halt.
  - (a) While any node halts the fleet, the home banner names the halted node, its target and its detail, and offers
    that node's **Ack** in place, through the same route and the same `canAck`.
  - (b) **Update all** does not answer a silent 202 on a halted fleet: the skip and its reason are shown, or the
    button is disabled with the reason. Measured at 12:18:59 and 12:19:15: two more of the operator's taps were applies
    (202), each shown as a red refusal saying to "acknowledge that node". The button that does that is labelled
    **Ack** on another item, so the operator could not find the remedy from the refusal.
  - (c) The "boxes run different builds" banner stops advising `ccrc rollout` or `ccrc update` while auto is on and
    the console can move the nodes; it points at the console's own move or the halt.
- **R16 (2026-10-05, security; seen while monitoring, owner to rule).** The `ccrc-api` client passes the box token to
  `curl` as an `-H` header on its argv. So the token is readable in every process listing on the box
  (`/proc/<pid>/cmdline`) for the life of each call. It appeared in a coordinator's read-only `ps` during this
  monitoring. The fix shape is a header read from a 0600 file or from stdin (`curl -H @file`, or `-K -`), with a test
  that scans the argv the client builds. Rotating the token is the operator's.
- **R17 (wave 11, run 270's Task 6 review; for wave 12).** The sweep's foreground calls are outside
  `_upd_sweep_kill`'s reach: the re-check, an unrecorded unit's first verify, and the no-scratch fallback. A SIGTERM to
  the sweep's pid alone during one of them leaves the verify and its `sleep` to finish, read-only, within seconds. A
  unit stop kills the whole cgroup and leaves nothing. This is the same class as `main`'s serial loop. One fix would be
  to run each foreground call as a recorded job that the kill can reach.
## Next-wave brief

**Wave 2 (run 128) — dispatched 2026-09-23.** The brief as sent is the plan's path and sha, tasks 1–15, execution
skill `superpowers:subagent-driven-development`, routing Opus · high main loop / Sonnet · high implementers / Opus ·
high per-task reviewer / workflow off / compact 40, the deviation block and reserve above, the migration-slot
re-measure, the concurrent-wave boundary (wave 2 never edits `ccd/`, `deploy/`), the sharded full-suite gate, and
"wave-done in the same turn as the push; never end a turn to wait on CI".

**Wave 3 and wave 4 plans** are in preparation; wave 4 may be dispatched while wave 2 runs, and merges after it.
