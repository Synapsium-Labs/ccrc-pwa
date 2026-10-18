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
| 11 | — (R12, sweep half) | `_upd_sweep`: one shared verify window by concurrent per-unit calls, the die's report-ownership guard and wording, no die in a subshell, the Darwin arm | fleet-first | — | **MERGED** `d2bac7ae` (PR #287, run 270 done) 2026-10-06 02:37 UTC, released as v0.0.92 (dev). The merged tree is byte-identical to the tested tip `33f4eaaa` (`main` unmoved at `d12b5aba`, every Linux leg green). Review 281 met none of the bar's eight classes; its four findings and D3's macOS red go to R19, before stable. Was: **IN REVIEW** 2026-10-06 01:29 UTC: wave-done at `33f4eaaa`, PR #287, `main` `d12b5aba` merged in as `9b3ba1fa`; reserve numbers 3987 and 3988 spent (bare: their definitions are on the worker branch); the bar is committed in the 01:29 entry; review run 281 dispatched 01:32 UTC to `ccrc-pwa-amber-cove` (the held-out panel plus five wave lenses). Was: **DISPATCHED** 2026-10-05 16:04 UTC to `ccrc-pwa-clear-meadow` (run 270). Plan `966ffe9f`, 9 tasks; it defines D-3972 to D-3984, and the five-number reserve, numbers 3987 to 3991, is named in the brief. Was: **Run 270 open, planned** 2026-10-05 11:10 UTC, opened before run 223 closed so the programme keeps an open run; to plan, with R13, R14 and R14(f) first. Was: **SCOPED** 2026-10-04 22:56 UTC; after wave 9 merges (`ccd/ccrc`). The 10-02 wave-10 deferrals move to wave 12. |
| 12 | — (wave 11's test and prose residue) | before stable: R19 (D3's GNU-only shim, F1's unpinnable filter, F2's W20 prose, F3's NEW+S10 pin, F4's S0 naming); R18(c)–(e) prose. No shipped runtime code changes | none (tests and docs) | — | **MERGED** `9221416a` (PR #291, run 282 done) 2026-10-06 06:40 UTC. The merged tree `a6c85f7c` equals `merge-tree`'s, and every branch file is byte-identical to the tested tip `7b0a5454` (`main` had moved by docs only, to `21f536a5`). Review 286 met none of the bar's seven classes; `server 4/5`'s cleanup-hook timeout re-ran green. Was: **IN REVIEW** 2026-10-06 05:57 UTC: wave-done at `7b0a5454`, PR #291; reserve number 4072 spent (bare: defined on the worker branch); the bar is in the 05:57 entry; review run 286 dispatched 05:59 UTC to `ccrc-pwa-warm-ridge` (the held-out panel plus two lenses: pins and fixtures, the truth of the prose). Was: **DISPATCHED** 2026-10-06 04:37 UTC to `ccrc-pwa-soft-delta` (run 282; 5 items; route Opus·high / Sonnet / workflow off / compact 40). Was: **Run 282 open, planned** 2026-10-06 02:38 UTC, opened before run 270 closed. Deviation block 4068 to 4087 (bare until defined). Scoped 02:45 UTC; plan `04c977cb` + `bc495fed` (drafted by workflow `wf_a11d694f-c70`: prototype, attack, revise; readings ruled 04:35). 5 tasks; it defines D-4068 to D-4071, and the reserve is numbers 4072 to 4076 (Reading 8's ruling spends 4072). |
| 13 | — (security + CI) | R16: the box token leaves `curl`'s argv in `ccd/ccrc-api` and `deploy/notify.sh` (`-K -` with a stdin `header = …` config, the idiom `ccd-pool-sync` and `ccd-update-sync` ship), and the test curl front admits exactly that; R20: the CI cleanup-hook timeout and wave 12's As-built bullet | fleet-first (the client and the hook reach every home through the install spine) | — | **MERGED** `8b0547b4` (PR #295, 2026-10-06 16:03:00 UTC, run 287 done). The merged tree is byte-identical to `git merge-tree` of the reviewed tip `77cf2367` onto `main` at `b3b5a73e` (`154cbb2c`), and `main` did not move after the review. Every Linux leg was green; the only macOS red was landing-order's. Scoped review 297 met none of the round's five classes; its five coverage and prose findings are residue R23. Was: **FIX ROUND 1 DONE** 2026-10-06 13:01 UTC at `77cf2367` (mail 3698; one commit on `ee5dd409`, 3 files, the round's only; no number spent; `main` not merged, `merge-tree` onto `b3b5a73e` clean; every Linux leg green on PR run 37465993934 and full run 37465994132). Scoped review run 297 dispatched 15:34 UTC to `ccrc-pwa-plain-cove`, after waiting out the fleet-wide daily cap (24 of 24). Both runs' only macOS red is landing-order's `session-hook-merge-deny`. After the review, #295 merges. Was: **FIX ROUND 1 SENT** 2026-10-06 12:27 UTC (mail 3690, `rulings-run287-fix1.md`) on review 294 at `ee5dd409`. Its F1, the test curl front failing open when grep cannot run, meets the bar's class 3 as written, so the bar gives the one round. A scoped review follows under the bar in the rulings, then #295 merges. Was: **IN REVIEW** 2026-10-06 11:34 UTC: wave-done at `ee5dd409`, PR #295; reserve number 4096 spent (bare: defined on the worker branch); the bar is in the 11:34 entry; review run 294 dispatched 11:35 UTC to `ccrc-pwa-quiet-harbor` (the held-out panel plus two lenses: token exposure and the front's parser; delivery, compatibility and the cleanup). Was: **DISPATCHED** 2026-10-06 10:01 UTC to `ccrc-pwa-still-ridge` (run 287; 6 items; route Opus·high / Sonnet / workflow off / compact 40; held 20 min by the fleet-wide daily cap, 24 of 24). Was: **Run 287 open, planned** 2026-10-06 06:41 UTC; re-scoped 07:07 UTC to R16 + R20 (scoping workflow `wf_286a790a-7fa`). Deviation block 4094 to 4113 (bare until defined). Plan `31f24eac` (workflow `wf_3aff815b-3ef`; readings ruled 09:30): 6 tasks; it defines D-4094 and D-4095, and the reserve is numbers 4096 to 4100 (Reading 4 spends 4096). |
| 14 | — (R15, PWA) | the home screen shows a halt and offers Ack in place; **Update all** says why it skipped; the skew banner drops the stale `ccrc rollout` advice | server (PWA bundle) | — | **MERGED** `03afca8b` (PR #309, 2026-10-07 03:28:56 UTC, run 299 done; released as v0.0.113 at 03:29:52). The merged tree is byte-identical to `git merge-tree` of the reviewed tip `e4357fb7` onto `main` at `543777fbe` (`f8217ccd`), and `main` did not move after the review. Every Linux leg was green, and the macOS reds are other programmes'. The last scoped review, 312, met none of the round-2 bar's classes; its three coverage and prose findings are residue R27. Was: **FIX ROUND 2 DONE** 2026-10-07 02:15 UTC at `e4357fb7` (mail 3790; two commits on `c613f551`, the six admitted files; reserve number 4273 spent, bare: defined on the worker branch). Scoped review run 312 dispatched 03:13 UTC to `ccrc-pwa-swift-mesa`, after waiting out the daily cap. Was: **FIX ROUND 2 (THE LAST) SENT** 2026-10-07 01:48 UTC (mail 3788, `rulings-run299-fix2.md`) on scoped review 311 at `c613f551`. A read issued before the Ack's outcome still releases the hold (F1, class 2 then 1; F2, class 1 and 3), so the round-1 bar gives the narrow round 2. A scoped review follows; a class 1 to 3 finding after it stops the merge and goes to the operator. Was: **FIX ROUND 1 DONE** 2026-10-07 01:16 UTC at `c613f551` (mail 3785; two commits on `3f5f382c`, the round's 6 files; reserve number 4272 spent, bare: defined on the worker branch; `main` not merged, `merge-tree` onto `543777fbe` clean). Scoped review run 311 dispatched 01:33 UTC to `ccrc-pwa-plain-river`, after waiting out the daily cap. Was: **FIX ROUND 1 SENT** 2026-10-06 22:48 UTC (mail 3770, `rulings-run299-fix1.md`) on review 307 at `3f5f382c`. Its F1, an Ack sent twice against one lease after a lost answer, meets the bar's class 2 as written, so the bar gives the one round. A scoped review follows, then #309 merges. Was: **IN REVIEW** 2026-10-06 22:18 UTC: wave-done at `3f5f382c`, PR #309 (12 commits, 23 files, exactly File structure's); reserve numbers 4270 and 4271 spent (bare: defined on the worker branch); the bar is in the 22:18 entry; review run 307 dispatched 22:20 UTC to `ccrc-pwa-brisk-meadow` (the held-out panel plus two lenses: state truth and the dispatcher; what the operator sees). Was: **DISPATCHED** 2026-10-06 19:57 UTC to `ccrc-pwa-amber-harbor` (run 299; 7 items; route Opus·high / Sonnet / workflow off / compact 40), after the operator reviewed the plan ("looks good", 19:55). Was: **Planned; the shape ruled.** Plan `053cf1cb5` (workflow `wf_f9c94b88-140`; 7 tasks; it defines D-4266 to D-4269, and the reserve is numbers 4270 to 4274). The operator saw the designs and ruled "all recommended" at 2026-10-06 19:00 UTC. Was: **Run 299 open, planned** 2026-10-06 16:03 UTC, opened before run 287 closed. Deviation block 4266 to 4285 (bare until defined). |
| 15 | — (`ccd/ccd`) | `--no-reload` for `_svc_enable`, alone | fleet-first | — | **ACCEPTED; WAITS FOR #410** 2026-10-18 03:07 UTC: #448 merged at `46c50a9a4`; #441 still lands after #410 (path identity's fence), then one merge of `main`. Was: **ACCEPTED; READY BUT FOR THE ORDER** 2026-10-17 22:50 UTC: wording round verified at `7bc2d9015` (mail 6049), run 300 awaiting-review; waits for #410 and #448, then one merge of `main`. Was: **ACCEPTED; WORDING ROUND** 2026-10-17 22:45 UTC: review 576 accepted fix round 1 at `c0fe55ee5` (7 minor, wording only); the wording round (mail 6047) needs no review if its diff is comments, prose and the stamp only; lands after #410 and #448. Was: **FIX ROUND 1 DONE** 2026-10-17 22:26 UTC: verified at `c0fe55ee5` (mail 6037), run 300 awaiting-review; scoped review run 576 dispatched (reviewer clear-hollow); lands after #410 and #448. Was: **FIX ROUND 1** 2026-10-17 22:15 UTC (mail 6034): review 573 accepted the round's design with six findings; the EPERM absorb narrows to the SIGTERM call (number 5335, bare until wave 20's plan defines it), plus F2 to F6; then a scoped review; lands after #410 and #448. Was: **WAVE-DONE WITH WAVE 20** 2026-10-17 16:40 UTC: verified at `97493f9b2` (mail 5979); full run 39050387114 for macOS; scoped review run 573 dispatched 21:45 (reviewer calm-delta); lands after #410 and #448 (the freeze); one merge after #410 by the stamp ruling. Was: **CARRIES WAVE 20** (2026-10-17 16:20 UTC, mail 5969): wave 20's B2 repair as an added task, then one scoped review; lands after #410, first-ready against #448. Was: **Reviewed and accepted; lands after #410 and #448** (2026-10-17 15:40 UTC; no longer after #435, which lands after it, mail 5953). Was: **Reviewed and accepted** (2026-10-16): PR #441 at `9888457bc`; review 510 found one prose minor (R31); lands after #410, run 360 and #435. Was: **cleared to dispatch** (2026-10-16): both consents in; plan `527296ffc` + `ca3abb150`. Was: **planned; dispatch on consent** (2026-10-15 22:11): claim 1396 (run 308) holds `ccd/ccd`, claim 1423 (run 360) holds `ccd/ccrc`; Reading 7 re-ruled; lands last among the `ccd/ccd` landers; adds R25(c) and R25(a)'s code-comment half. Was: **planned; dispatch held on three claims.** Plan `527296ffc` (workflow `wf_f9c94b88-140`; 2 tasks; it defines D-4286, and the reserve is numbers 4287 to 4291). It waits until claims 1057 (`ccd/ccd`), 1058 (`macos-platform.test.ts`) and 1055 (`ccd/ccrc`) have ended (Reading 7). Was: **Run 300 open, planned** 2026-10-06 16:07 UTC. Deviation block 4286 to 4295 (bare until defined). To plan. `ccd/ccd` is unclaimed, but open PRs #299, #301 and #303 also edit it, so whichever lands later rebases and restamps. |
| 16 | — (sweep and verify; before stable) | R18(e) (item 3's false "is FAILED" warning, the stale-pid comment), Reading 9's sweep half (warn only), the pgid clause's comment, T6-INT-W closed, R18(a), R18(b), R10j, R8c, R10c(3), R8g | fleet-first; auto moves it, the coordinator watches | — | **MERGED** `13f11b696` (PR #444, 2026-10-17 20:06 UTC, run 484 done); tree equals the merge-tree of the reviewed tip `eee9001f1` with `main` at `7f066a117`; review 568 found 5 minor (F1, F2 and F4's clock source to wave 17, F3 to the docs PR, F5 to R34). Was: **IN REVIEW** 2026-10-17 19:21 UTC: review run 568 dispatched (reviewer still-river), reading the tip of the latest wave-done, `eee9001f1` (D-5145, mail 5990). Was: 16:30 UTC: landing round verified at `14839f785` (mail 5976; D-5144 on line 242); review run 568 opened, dispatch at 19:21 (cap-daily). Was: **LANDING ROUND** 2026-10-17 15:40 UTC (mail 5950): merge `main`, number 5144 and its rows, re-gate, a fresh wave-done, one scoped review; then the first ready of #444 and #448 lands. Was: **Fix round 1** (2026-10-16): PR #444 at `e2c48be75`, review 512: F3 and F4 fixed now, then the run-360 merge and one scoped review. Was: run 484, plan `0f07ddcb9` |
| 17 | — (install, doctor, backup prune) | `ccrc-api` placed by the install spine and removed by uninstall (README's `ccrc-api` lines), Reading 9's doctor half (WARN only), R10k, R8f, R14(a), R10i, R34 (both KEEP spellings; D1c pins them equal), R25(a)'s code-comment half, R35(b) | fleet-first; auto moves it, the coordinator watches | — | **TASK 11** 2026-10-18 05:40 UTC (mail 6197): #482 merged, so the worker merges `main` (clean), runs the census on its own new spawns first, does Task 11 and Task 12, then the wave-done and the whole-branch review; its landing merge follows #441. Full run 39096832066: Linux green, Darwin D5, D6, D13 green, one macOS flake (R40). Was: **TASKS 4, 6, 7 DONE** 2026-10-18 04:00 UTC: at `218fd588a` (mail 6164): `main` merged as `0e62e2767` (six bin-list unions), #448's `_bak_*` text matched the plan, Task 4's `NRestarts` read is D-5328 (mail 6165); Task 11 after #482, then Task 12 and the whole-branch review; a full run after #482's landing runs. Was: **GROUP B AND #448 TASKS** 2026-10-18 03:07 UTC (mail 6159): #448 merged; the worker merges `main` (six bin-list conflicts with #569, resolved as unions), takes the `ccd/ccrc-doctor-checks` claim and does Tasks 4, 6 and 7 Steps 1 to 4; Task 11 after #482. Was: **GROUP A DONE** 2026-10-17 23:02 UTC: PR #566 at `a695bde11` (mail 6053); Task 7 Step 5 now; Tasks 4, 6 and 7 wait for #448, Task 11 for #482; full run 39077484519 for Task 16's macOS proof. Was: **DISPATCHED** 2026-10-17 21:46 UTC (run 564, worker soft-meadow), Group A. Was: **PLANNED** 2026-10-17 20:40 UTC: plan `3f6aef755` (D-5313 to D-5327, the worker's reserve 5328 to 5332), its 14 readings ruled; Group A dispatches in the 21:43 cap slot; Tasks 6 and 7 wait for #448, Task 4 for #448 and #410 (claim 1557), Task 11 for #482. Was: **PLANNING** 2026-10-17 20:10 UTC: adds review 568's F1 (a W24 row) and F2 (`REAL_BOUND_MS`), R36 (`deploy.sh`'s `TS` clock) and R35(d); the plan workflow `wf_fdee8558-414` runs one agent at a time. Was: 15:40 UTC: run 564 open (planned), block 5313 to 5332; plan workflow `wf_012aef14-576`; README's `ccrc-api` lines move to the docs PR; lands after #448, #482, #444 and #441. Was: waits for run 360 to land (claims 1388, 1410, 1423) and claim 1403 (run 468, #425) on README (2026-10-15 22:11) |
| 18 | — (test containment) | `makeCcdHarness` containment parity, R14(b)'s raw-spawn census, R23(a), R23(b), R23(d) | none (tests) | — | **MERGED** 2026-10-18 05:42 UTC: #482 as `65f4b5ab4` at `75a5af496` (the wording round, comments and prose only, measured), tree equal to the tested merge with `36d536c99`; run 517 closed `done`. Was: **FR3 ACCEPTED; WORDING ROUND** 2026-10-18 05:10 UTC (mail 6192): review 585 accepted fix round 3 at `f8fa675eb` (3 minor, wording; F3 ruled hygiene, no pin); one comments-and-prose round, measured by the coordinator, no review; then #482 merges. Was: **FIX ROUND 3 IN REVIEW** 2026-10-18 04:50 UTC: verified at `f8fa675eb` (mail 6184), CodeQL green, alerts 118 to 120 fixed and their threads resolved by the bot; run 517 awaiting-review; scoped review run 585 dispatched (reviewer keen-delta). Was: **FIX ROUND 3 (CodeQL)** 2026-10-18 04:30 UTC (mail 6181): F16 accepted (+25 tests, all this wave's; two flakes); the merge was refused because three CodeQL threads are open ("All comments must be resolved"); alerts 118 to 120 are fixed in code, then one short scoped review, then the merge. Was: **PART 2 VERIFIED** 2026-10-18 03:40 UTC: wave-done at `d7662ee11` (mail 6161), run 517 awaiting-review, no review run (merge only `main`, census unchanged, prose only); #482 merges once its required checks are green and F16's full-run comparison (39094213607 against 39093762060) is in the PR body (mail 6162). Was: **PART 2** 2026-10-18 03:07 UTC (mail 6158): #448 merged at `46c50a9a4`; run 517 back at working; merge `main` (measured clean), the census and two delegation suites, review 577's F1 to F4, the T2 re-measure, one wave-done; then #482 merges. Was: **PART 1 ACCEPTED** 2026-10-18 00:25 UTC: review 577 accepted fix round 2 at `f5e311970` (4 minor, wording); part 2 after #448 (merge `main`, the census and two delegation suites, the CI summary, review 577's wording, the T2 re-measure), with no review unless the census lists change. Was: **FIX ROUND 2 DONE** 2026-10-17 23:40 UTC: verified at `f5e311970` (mail 6065), run 517 awaiting-review; scoped review run 577 dispatched 23:57 (reviewer plain-prairie); part 2 after #448. Was: **FIX ROUND 2** 2026-10-17 23:20 UTC (mail 6059): review 574 found 8 minor at `1065b9994`; F4's bus-address refusal (number 5258) and the census pins, then a short scoped review; part 2 after #448. Was: **PART 1 VERIFIED** 2026-10-17 16:40 UTC at `aaf923a4b` (mail 5978), prose commit `1065b9994` (mail 5992); scoped review run 574 dispatched 21:45 (reviewer amber-delta); part 2 after #448. Was: **LANDING ROUND, PART 1** 2026-10-17 15:40 UTC (mail 5951): merge `main`, the single re-measure, a fresh wave-done, the scoped review; part 2 and the landing after #448. Was: **FIX ROUND 1 DONE** 2026-10-17 04:35 UTC: verified at `81bf1f135` (PR #482), run 517 awaiting-review, held for #448; then the landing round and one scoped review. Was: **FIX ROUND 1** 2026-10-17 03:45 UTC: review 535 (18 findings) ruled in plan `3098b03ea`, mail 5698. Was: **IN REVIEW** 2026-10-17 02:55 UTC: wave-done at `b5b83ad66` (PR #482), run 517 awaiting-review, review run 535. Was: **DISPATCHED** 2026-10-17 00:50 UTC (run 517, worker still-delta): plan `f9abdcc0e` (D-5247 to D-5253, reserve 5254 to 5258), readings ruled; lands after run 360. Was: **PLANNING** 2026-10-16 18:00 UTC: run 517 opened (planned), block 5247 to 5266; the plan workflow runs (`wf_21fbd9dc-804`). `ccdWsHelpers.ts` is unclaimed since claim 1396 ended. Was: to plan; `ccdWsHelpers.ts` held by claim 1396 (run 308); R14(b) and R23 can go first (2026-10-15 22:11) |
| 19 | — (PWA and server residue) | R24(a), (b), (d), R26(a)-(d), R27(a), R27(b)'s test half; B5, the `update-inventory.test.ts` stable flake | server | — | **MERGED** `a6b2606c9` (PR #443, 2026-10-16 12:54 UTC, run 483 done); tree equals merge-tree of the reviewed tip `95aa8f3bf`; review 511 found 4 minor (R33) |
| 20 | — (B2: the Docs helper's group stop) | `_stop`, `_signal_group` and `_group_alive` survive Darwin's EPERM from a zombie-only group; row 64 of `ccd-docs-tree.test.ts` goes green on macOS (operator ruling 2026-10-17 15:50) | fleet-first | — | **RIDES WAVE 15** 2026-10-17 16:20 UTC: plan `808f9f549` (D-5333, D-5334; unmeasured); dispatch refused `cap-daily` (48 of 48), so the work rides run 300's branch (#441, mail 5969); run 566 stays planned as the plan's record. Was: **PLANNING** 2026-10-17 15:51 UTC: run 566 open (planned), block 5333 to 5342; plan workflow `wf_dae77d40-97a`; `ccd/ccd` consent asked of claim 1557's coordinator (mail 5957); lands after #410, first-ready against #448 |
| — | — | docs PR: R22, R24(e), R23(c), (e), R27(b)'s plan half, R27(c), R25(a), (b), R35(c), README's Reading 9 clause, README's `ccrc-api` lines (from wave 17, 2026-10-17), review 568's F3 (the wave 16 plan's two KEEP=0 sentences, superseded by D-5144), the closure sentences | none (docs) | — | **PART 1 DRAFTING** 2026-10-18 05:55 UTC: #425 merged (`7284c8501`), but run 561 (the public-tree scrub) now holds `README.md` and `ccrc-account.test.ts`, and wave 17 holds `ccrc-update.test.ts`. Part 1, now: R22, R24(e)'s spec half, R23(c) and (e), R27(b)'s plan half and (c), R25(b), review 568's F3, and R35(c) in the three free files. Part 2, after #441, wave 17 and run 561: README (R24(e), Reading 9, `ccrc-api`), R25(a) and (c) (they describe #441's `--no-reload`), R35(c)'s last two files, the closure. Was: to write; README half waits for claim 1403 (#425) (2026-10-15 22:11) |
| — | — | final rollout: promote to `stable` (the coordinator, ruling 2026-10-15), auto convergence and a read-only `ccrc rollout --check` (no hand `ccrc rollout`, ruling 2026-09-30), the exit criteria measured live (the operator taps the rehearsal) | — | — | planned; stable waits on B2 (on #441, after #410 and, by the freeze of 21:00, #448) and a green `full-suite` on a released commit; wave 16 and D-5238's tests landed 2026-10-17 20:06 (#444). Was: on B2 (on #441), wave 16 and D-5238's load-sensitive tests; B1 cleared 2026-10-17 16:25 (full run 39045734294). Was: on B1 (#429 merged 2026-10-17 13:20; full run 39045734294 on `main` tests it on macOS), B2 (wave 20, run 566, by the operator's ruling of 2026-10-17 15:50) and wave 16. Was: on B1 (a green macOS run confirms #429), B2 and wave 16. Was: on B1, B2, B5 and wave 16 (B5 left with wave 19) |

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
    - **2026-10-06 03:06 UTC — v0.0.92 (#287, wave 11) published at 02:38 and auto-converged unattended. This was the
      move INTO wave 11.** v0.0.87 to v0.0.91 had converged the same way, with no anomaly, by 02:38.
      - **Fleet box:** `installing` at 02:55:36, `restarting` at 02:56:37, `done` at 03:02:41. The gate passed at
        02:56:30.
        - The sweep was v0.0.91's OLD serial `_upd_sweep`, running v0.0.92's new `verify-service.sh`. It finished at
          03:02:36, with no "stopped on purpose" line and no "did not stay up".
        - 44 supervisors are active now.
      - **Server box:** `done` at 03:03:42. `/health` answers v0.0.92.
      - **The server's inventory row** read `pending`/`incomplete` at 03:03:48 and 03:04:04. It was settled by
        03:06:42, the usual post-restart lag over two readings.
      - **Publish to converged:** 28 min.
      - **What runs from here:** every later move runs wave 11's NEW sweep, as does any rollback by flip.
      - STATUS: fleet and server v0.0.92, newest v0.0.92, backups fleet 123M/server 532M, disk free fleet 216G/work
        volume 90G/server 33G, no anomalies.
    - **2026-10-06 07:10 UTC — v0.0.94 (docs, #288/#289) and v0.0.95 (#291, wave 12) auto-converged unattended.**
      The v0.0.94 move was the first run of wave 11's NEW sweep: about 48 supervisors in 23 s, with no re-check (the
      06:41 entry). v0.0.95 followed it. No action was taken.
      - STATUS: fleet and server v0.0.95, newest v0.0.95, backups fleet 134M/server 539M, disk free fleet 218G/work
        volume 77G/server 33G, no anomalies.
    - **2026-10-07 03:30 UTC — v0.0.96 to v0.0.112 auto-converged unattended.** That covers wave 13 (v0.0.101) and
      the merges of other programmes since. No action was taken. The fleet box's `~/.local/bin/ccrc-api` is still the
      2026-09-17 regular-file copy (D-4094), so it keeps putting the token on curl's argv until the operator relinks
      it. v0.0.113 (wave 14) was published at 03:29:52 and is converging.
      - STATUS: fleet and server v0.0.112, newest v0.0.113, backups fleet 138M/server 568M, disk free fleet 217G/work
        volume 84G/server 33G, no anomalies.
    - **2026-10-07 09:42 UTC — v0.0.113 (wave 14) to v0.0.116 auto-converged unattended.** No action was taken. Wave 14's
      halt banner is live on the server box.
      - STATUS: fleet and server v0.0.116, newest v0.0.116, backups fleet 142M/server 573M, disk free fleet 218G/work
        volume 88G/server 33G, no anomalies.
    - **2026-10-08 11:17 UTC — v0.0.117 to v0.0.122 auto-converged unattended.** No action was taken.
      - The operator paused auto-install for the GPT-lane window (2026-10-07 10:06 to 11:21 UTC), then restored it to
        `channel` on dev. Both boxes moved on from there by themselves.
      - The hourly check's job had expired. It was re-created at 11:17, so the gap had no probe.
      - STATUS: fleet and server v0.0.122, newest v0.0.122, backups fleet 144M/server 585M, disk free fleet 216G/work
        volume 264G/server 33G, no anomalies.
    - **2026-10-08 12:42 UTC — v0.0.123 auto-converged unattended.** No action was taken.
      - STATUS: fleet and server v0.0.123, newest v0.0.123, backups fleet 144M/server 588M, disk free fleet 216G/work
        volume 268G/server 33G, no anomalies.
    - **2026-10-08 14:42 UTC — v0.0.124 and v0.0.125 auto-converged unattended.** No action was taken. They carry
      child-reclamation wave 6 (#326) and that programme's docs (#329).
      - STATUS: fleet and server v0.0.125, newest v0.0.125, backups fleet 145M/server 594M, disk free fleet 216G/work
        volume 271G/server 33G, no anomalies.
    - **2026-10-08 18:42 UTC: v0.0.126 published at 18:12:29, and the fleet box's auto move to it is in flight.** That
      release is child-reclamation's wave 7 plan (#331). The fleet box's `update.json` read `installing` toward
      v0.0.126 from 18:42:24 (`--from pwa`, the dispatcher's path). The server box follows the fleet. No action was
      taken.
      - STATUS: fleet and server v0.0.125, newest v0.0.126, backups fleet 145M/server 594M, disk free fleet 216G/work
        volume 268G/server 33G, no anomalies.
    - **2026-10-08 19:42 UTC: v0.0.126 auto-converged unattended.** No action was taken.
      - STATUS: fleet and server v0.0.126, newest v0.0.126, backups fleet 146M/server 598M, disk free fleet 216G/work
        volume 264G/server 33G, no anomalies.
    - **2026-10-08 21:42 UTC: v0.0.127 auto-converged unattended.** It was published at 21:09:49 and carries
      child-reclamation's wave 8 plan (#332). No action was taken.
      - STATUS: fleet and server v0.0.127, newest v0.0.127, backups fleet 146M/server 601M, disk free fleet 216G/work
        volume 264G/server 33G, no anomalies.
    - **2026-10-09 06:27 UTC: v0.0.128 to v0.0.132 auto-converged unattended.** No action was taken.
      - Two of the five carry code: v0.0.130 (02:12:56) is ccrc history W1-B1 (#315), and v0.0.131 (03:11:12) is the
        native docs reader's wave 2 (#319). The other three are docs.
      - The hourly check did not fire between 21:42 and 06:27, because this session was waiting on an operator
        question. The gap had no probe.
      - STATUS: fleet and server v0.0.132, newest v0.0.132, backups fleet 145M/server 612M, disk free fleet 216G/work
        volume 262G/server 33G, no anomalies.
    - **2026-10-09 07:42 UTC: v0.0.133 auto-converged unattended.** It is box-token-lifecycle's part A (#330), published
      at 06:45:52. The fleet box's agent restarted at 07:03 and the server at 07:05. No action was taken.
      - STATUS: fleet and server v0.0.133, newest v0.0.133, backups fleet 145M/server 613M, disk free fleet 216G/work
        volume 266G/server 33G, no anomalies.
    - **2026-10-09 08:42 UTC: v0.0.134 auto-converged unattended.** It is workspace lifecycle's wave 5 (#335), published
      at 08:24:16. No action was taken.
      - STATUS: fleet and server v0.0.134, newest v0.0.134, backups fleet 146M/server 614M, disk free fleet 216G/work
        volume 269G/server 33G, no anomalies.
    - **2026-10-09 10:42 UTC: v0.0.135 auto-converged unattended, and v0.0.136 is not yet moved.** No action was taken.
      - v0.0.135 (10:07:38) is #338, ccd carrying sidecars by link.
      - v0.0.136 (10:21:06) is #337, a test-only change: one owned temp parent per vitest run.
      - The fleet box's `update.json` reads `done` toward v0.0.135. The 21 minutes since v0.0.136 is inside the usual
        30 to 50 minute lag.
      - STATUS: fleet and server v0.0.135, newest v0.0.136, backups fleet 146M/server 616M, disk free fleet 215G/work
        volume 264G/server 33G, no anomalies.
    - **2026-10-09 11:42 UTC: v0.0.136 auto-converged unattended.** No action was taken.
      - STATUS: fleet and server v0.0.136, newest v0.0.136, backups fleet 147M/server 617M, disk free fleet 215G/work
        volume 263G/server 33G, no anomalies.
    - **2026-10-09 14:42 UTC: v0.0.137 published at 14:32:53; not yet moved, inside the usual lag.** It is #325, the
      route read-back fix in `ccd/ccd`, merged at 14:31:58. No action was taken.
      - **Wave 15 (run 300) is still held, by live claims now rather than by open PRs.** #325, #315 and #326 have all
        landed. But claim 1132 (child reclamation's wave 7, run 347) holds `ccd/ccd` and
        `server/test/macos-platform.test.ts`. Claim 1129 (box-token part B, run 350) holds `ccd/ccrc`. `ccd/ccd` edits
        merge serially, so wave 15 waits for wave 7's to land.
      - STATUS: fleet and server v0.0.136, newest v0.0.137, backups fleet 147M/server 617M, disk free fleet 210G/work
        volume 258G/server 33G, no anomalies.
    - **2026-10-09 15:42 UTC: v0.0.137 auto-converged unattended.** No action was taken. Wave 15 is still held by
      claims 1132 and 1129.
      - STATUS: fleet and server v0.0.137, newest v0.0.137, backups fleet 147M/server 618M, disk free fleet 214G/work
        volume 253G/server 33G, no anomalies.
    - **2026-10-10 20:43 UTC: v0.0.138 and v0.0.139 auto-converged unattended on 10-09; v0.0.140 published at
      20:40:48, not yet moved, inside the usual lag.** No action was taken.
      - The hourly checks paused for 27 hours, while this session waited on an operator answer. Each move in that
        time was measured afterwards from the box-token driver's own hold log. v0.0.138 (#339, published 18:47:51)
        moved the fleet at 18:51 and the server at 18:53. v0.0.139 (#343, published 18:55:47) moved the fleet at
        19:25 and the server at 19:27. Both went fleet first.
      - v0.0.140 is #341, box-token part B. Its move starts the first live rotation of the box token, which the
        box-token programme's ledger watches.
      - **Wave 15 (run 300) is still held.** Claim 1142 (child reclamation's wave 7, run 347, PR #344) holds `ccd/ccd`
        and `server/test/macos-platform.test.ts`. Claim 1141 (ccrc-history's wave 3, run 354) holds `ccd/ccrc`.
      - STATUS: fleet and server v0.0.139, newest v0.0.140, backups fleet 148M/server 621M, disk free fleet 215G/work
        volume 247G/server 33G, no anomalies.
    - **2026-10-10 21:42 UTC: v0.0.140, v0.0.141 and v0.0.142 converged.** No action was taken.
      - v0.0.140 (#341) moved the fleet at 21:00 and the server at 21:02, 20 minutes after it was published. The
        box-token programme's first live rotation followed at 21:04 and caused no 401.
      - v0.0.141 (#340, docs) and v0.0.142 (#345, docs) were published at 21:11 and 21:12. The fleet moved straight
        to v0.0.142 at 21:33 and the server at 21:35.
      - Both boxes' `update.json` read `from: pwa`, the dispatcher's word for a console move. Its 21-minute lag
        matches v0.0.140's auto move, but this check cannot tell a tap from auto.
      - Across the server's restart the box token stayed on generation 3: doctor reads `PASS`, with no hold and no
        failure.
      - Wave 15 (run 300) is still held, by claims 1142 (`ccd/ccd`, `macos-platform.test.ts`) and 1141 (`ccd/ccrc`).
      - STATUS: fleet and server v0.0.142, newest v0.0.142, backups fleet 164M/server 624M, disk free fleet 215G/work
        volume 254G/server 33G, no anomalies.
    - **2026-10-10 22:42 UTC: v0.0.143 converged.** No action was taken. It is #347, the box-token programme's
      docs PR, published at 22:20:24. The fleet moved at 22:36, 16 minutes later, and the server at 22:38. The box
      token stayed on generation 3 across the restart, with no hold, no failure and no fleet 401. Wave 15 (run 300)
      is still held by claims 1142 and 1141.
      - STATUS: fleet and server v0.0.143, newest v0.0.143, backups fleet 164M/server 626M, disk free fleet 215G/work
        volume 252G/server 33G, no anomalies.
    - **2026-10-11 00:45 UTC: v0.0.144 published at 00:44:06; not yet moved, inside the usual lag.** No action was
      taken. It is #348, box-token row 2a: test pins, plus three shipped lines, which are the token verb's
      temp-beside-the-destination guard, notify.sh's placeholder guard, and one log sentence. Wave 15 (run 300) is
      still held by claims 1142 and 1141.
      - STATUS: fleet and server v0.0.143, newest v0.0.144, backups fleet 164M/server 626M, disk free fleet 215G/work
        volume 250G/server 33G, no anomalies.
    - **2026-10-11 13:15 UTC: v0.0.144 to v0.0.147 converged unattended.** No action was taken. The hourly checks
      paused for about 12 hours while this session waited on an operator answer. The moves were measured afterwards.
      - The releases:
        - v0.0.144 was #348 (box-token row 2a), published 00:44.
        - v0.0.145 was #344 (child reclamation's wave 7, `ccd/ccd`), published 00:56.
        - v0.0.146 was workspace lifecycle's wave 6 plan (docs), published 08:59.
        - v0.0.147 was child reclamation's wave 8 server half, published 12:14.
      - Both boxes and `/health` read v0.0.147.
      - The box token held through every restart. Doctor reads `PASS … generation #3, rotated 16 h ago, fleet
        confirmed, retired value refused`, with no hold, no failure and no fleet 401.
      - **Wave 15 (run 300) has a new blocker.**
        - Claims 1142 and 1141 have ended, and #344 has landed.
        - Claim 1149 (workspace lifecycle's wave 6, run 358) now holds `ccd/ccd`, and `ccd/ccd` edits merge serially.
        - `ccd/ccrc` and `server/test/macos-platform.test.ts` are free. Claim 1141's run 354 touches only
          `ccd/history/*` and the history tests, measured in its workspace read-only.
        - So wave 15 waits for wave 6's `ccd/ccd` edit to land.
      - STATUS: fleet and server v0.0.147, newest v0.0.147, backups fleet 166M/server 631M, disk free fleet 219G/work
        volume 246G/server 33G, no anomalies.
    - **2026-10-11 16:42 UTC: v0.0.148 published at 16:33:03; not yet moved, inside the usual lag.** No action was
      taken. It is #352, child reclamation's wave 9 plan and contract (docs). Wave 15 (run 300) is still held by claim
      1149 (`ccd/ccd`, workspace lifecycle's wave 6) and claim 1155 (`ccd/ccrc`, box-token row 2b, run 377).
      - STATUS: fleet and server v0.0.147, newest v0.0.148, backups fleet 166M/server 631M, disk free fleet 219G/work
        volume 243G/server 33G, no anomalies.
    - **2026-10-11 17:42 UTC: v0.0.148 auto-converged unattended.** No action was taken.
      - **Wave 15 (run 300) is still held, now by open PRs.** Claim 1149 has ended, but its PR #351 (workspace
        lifecycle's wave 6) is open and edits `ccd/ccd`, and `ccd/ccd` merges serially. Box-token row 2b's PR #353
        (claim 1155) edits `ccd/ccrc`. `server/test/macos-platform.test.ts` is free.
      - STATUS: fleet and server v0.0.148, newest v0.0.148, backups fleet 166M/server 633M, disk free fleet 219G/work
        volume 241G/server 33G, no anomalies.
    - **2026-10-12 10:00 UTC: v0.0.149 auto-converged unattended.** No action was taken. It is #354, child
      reclamation's wave 9 (the temp-root collector's server lane, shadowed), published at 07:29:38. The hourly checks
      paused for about 16 hours while this session waited on an operator answer. The box token held, with doctor
      reading `PASS … generation #3`. Wave 15 (run 300) is still held by the open PRs #351 (`ccd/ccd`) and #353
      (`ccd/ccrc`).
      - STATUS: fleet and server v0.0.149, newest v0.0.149, backups fleet 167M/server 635M, disk free fleet 217G/work
        volume 224G/server 33G, no anomalies.
    - **2026-10-12 14:46 UTC: v0.0.150 to v0.0.152 auto-converged unattended.** No action was taken.
      - The releases: v0.0.150 is #322, stall watch settings' wave 2, published at 14:14:18. v0.0.151 (a docs
        commit) followed at 14:35:01, and v0.0.152 (#356, docs) at 14:35:58. Both boxes had reached v0.0.150 by the
        next move. v0.0.151 was skipped, because the auto move went to the newest.
      - The move to v0.0.152 was fleet first, one node at a time. The fleet box ran 14:39:11 to 14:41:47, and the
        server 14:42:47 to 14:43:09.
      - The 14:42 hourly probe landed in the gap between the two. It read "boxes differ" and the fleet row
        `pending`. Its re-probes then read the server row `pending` and `incomplete` for about two minutes after the
        server's own record said `done` and `install: complete`. That is the inventory's once-a-minute re-measure
        lagging, not a fault. Every anomaly cleared by 14:45:10.
      - The box token held: `PASS` on both boxes (server generation #3, fleet sync proved). Server doctor: 25 passed,
        0 warned, 0 failed. Fleet doctor: 33 passed, 6 warned, 0 failed, with no warning from `box-token`.
      - Wave 15 (run 300) is still held by the open PRs #351 (`ccd/ccd`) and #353 (`ccd/ccrc`).
      - STATUS: fleet and server v0.0.152, newest v0.0.152, backups fleet 168M/server 641M, disk free fleet 217G/work
        volume 201G/server 33G, no anomalies.
    - **2026-10-12 18:50 UTC: v0.0.153, the box-token arming (#353), auto-converged unattended.** No action was taken.
      - It was published at 18:41:26. The fleet box ran 18:44:27 to 18:46:39 and the server 18:46:55 to 18:47:18. Both
        `update.json` records read `done`, and both boxes had converged by 18:48:46.
      - Doctor's `box-token` FAIL and WARN arms are now on.
        - Both boxes read `PASS`: the server on generation #3, and the fleet with its sync proved.
        - Server doctor: 25 passed, 0 warned, 0 failed.
        - Fleet doctor: 33 passed, 6 warned, 0 failed. They are the same six warnings as at 14:46, and none is from
          `box-token`.
        - No update exited 3.
      - The driver's new owe rule is live. Its first tick wrote `retiredPresentedAt: null`, and it owes no rotation.
      - Between the checks, at 17:46, a hand-started `ccrc update --force` reinstalled v0.0.152 on the fleet box after
        a tmux out-of-memory event. That was not the auto mechanism. The 16:42 and 17:42 checks did not run.
      - Wave 15 (run 300) is now held by the open PR #351 (`ccd/ccd`) alone.
      - STATUS: fleet and server v0.0.153, newest v0.0.153, backups fleet 170M/server 645M, disk free fleet 217G/work
        volume 245G/server 33G, no anomalies.
    - **2026-10-12 20:02 UTC: v0.0.155 converged, but the server did not move by auto. Someone moved it by hand after a
      14-minute stall. A mechanism defect, for a wave.**
      - **The releases:** v0.0.154 (#360) and v0.0.155 (#359), both docs-only, were published at 18:49:09 and 18:53:18.
      - **The poller noticed v0.0.155 at 19:17:08.** That is within its design. It polls every 30 minutes, the server's
        own restart at 18:47:07 reset the clock, and the notice landed 30:01 after the boot poll. v0.0.154 was never
        announced, by design, because only the newest tag is. The fleet moved by auto at 19:17:20 to 19:19:22.
      - **The server did not follow.** Its node row kept the 19:17:20 note "waiting-for-fleet — fleet's auto update to
        v0.0.155 has not landed", although the fleet landed at 19:19:22. Twice earlier today the same gate released within a
        minute of the fleet landing: at 14:41, and at 18:46 for the arming.
      - **At 19:33:12 someone else started a transient unit by hand,** "server catch-up to v0.0.155 (fleet already there)".
        The server's `update.json` reads `from: cli`, 19:33:13 to 19:33:35. Its health gate passed, and its doctor reads
        25 passed, 0 warned, 0 failed. Both boxes read `box-token` PASS, and both now run v0.0.155.
      - **The evidence, read-only:**
        - The old server process logged nothing from 19:17:42 to its stop at 19:33:23. Its dead-coordinator sweep had
          logged every 3 to 9 minutes until 19:11:52.
        - In that window the only coordination writes were route calls: one mail posted and delivered inline, an ack,
          and one run closed. No delivery shows the tick lane at work.
        - The silence began 2 seconds after the fleet's own install restarted its agent, at 19:17:40.
      - **The cause, from a four-agent read-only code reading:**
        - The planner rebuilds from `coord.db` on every 60-second inventory run, so it should have released by about
          19:20.
        - So the old process most likely completed no inventory run after the agent restart: its inventory or tick lane
          stopped silently.
        - The code cannot settle which mechanism did it. The candidates are an inventory run that never finished (its
          projection write has no deadline), a lease held by another row, or a silent acquire refusal.
        - Without the hand action, the server would most likely have stayed on v0.0.153 until something restarted it.
      - **To fix through a wave:**
        1. **The refusal note never clears.** This is certain in the code. A server with no move keeps a stale
           "waiting-for-fleet" sentence for good. Clear it, or replace it with the node's resolve detail.
        2. **The inventory and dispatch lanes can stop silently.** Record when each last completed. Warn, and show it on
           `GET /api/updates` and the console, when either is older than 3 intervals, or when an idle node with an
           intended auto move stays unmoved past a bound.
        3. **Bound the projection write** inside the inventory run with a deadline.
        4. **Log each dispatch decision once per change.** The plane logged no decision from 18:48 to 19:33, which is
           why this took a code reading to diagnose.
        5. **Optional:** poll again a few minutes after a server boot, or poll faster while auto is on the dev channel.
           The 30-minute cadence is by design, for the unauthenticated request budget.
      - Wave 15 (run 300) is still held by the open PR #351 (`ccd/ccd`) alone.
      - STATUS: fleet and server v0.0.155, newest v0.0.155, backups fleet 170M/server 649M, disk free fleet 215G/work
        volume 241G/server 33G, no anomalies at 19:42.
    - **2026-10-12 20:46 UTC: v0.0.156 to v0.0.158 auto-converged unattended.** No action was taken.
      - The releases were three docs and governance merges: v0.0.156 (#357) at 19:56:02, v0.0.157 at 20:05:37 and v0.0.158
        at 20:13:38.
      - The server followed the fleet by auto each time:
        - v0.0.156: the fleet ran 20:04:09 to 20:06:09, and the server 20:06:35 to 20:06:58.
        - v0.0.157: the fleet ran 20:07:51 to 20:09:58, and the server 20:10:23 to 20:10:45.
        - v0.0.158: the fleet ran 20:41:13 to 20:43:11, and the server 20:43:43 to 20:44:07.

        So the gate that stalled at 19:19 released in about 30 seconds three times. The stall stays a defect of a
        process's lanes, as the entry above says.
      - The 20:42 hourly probe landed mid-move: "boxes differ", and the fleet row `pending` and `incomplete`. That is
        transient. v0.0.158's 27-minute start lag is the 30-minute poller: the server's v0.0.157 install restarted it at
        20:10:45, and its next poll fell at about 20:40:45.
      - Both boxes read `box-token` PASS. Server doctor: 25 passed, 0 warned, 0 failed. Fleet doctor: 33 passed, 6
        warned, 0 failed.
      - Wave 15 (run 300) is still held by the open PR #351 (`ccd/ccd`).
      - STATUS: fleet and server v0.0.158, newest v0.0.158, backups fleet 172M/server 660M, disk free fleet 217G/work
        volume 244G/server 33G, no anomalies at 20:45.
    - **2026-10-13 01:52 UTC: v0.0.159 (#377, docs) auto-converged unattended.** No action was taken.
      - It was published at 01:22:54. The poller noticed it on schedule (the server last booted at 20:44, so it polls
        near :14 and :44).
      - The fleet box ran 01:45:18 to 01:47:52, and the server followed by auto at 01:48:56 to 01:49:19, 64 seconds
        after the fleet. The 01:42 probe read no anomaly: the release was still within the poll window.
      - Both boxes read `box-token` PASS. Server doctor: 25 passed, 0 warned, 0 failed. Fleet doctor: 33 passed, 7
        warned, 0 failed. The one new warning is graphify's ("the last graph-sweep pass finished 81 minutes ago"), from
        the graph sweep, not the update machinery.
      - v0.0.160 (#321, delegation broker's wave 2) was published at 01:49:47, during this move. It moves at the next poll,
        about 02:19.
      - Wave 15 (run 300) is still held by the open PR #351 (`ccd/ccd`).
      - STATUS: fleet and server v0.0.159, newest v0.0.160, backups fleet 172M/server 663M, disk free fleet 217G/work
        volume 220G/server 33G, converged at 01:51.
    - **2026-10-13 02:43 UTC: v0.0.162 auto-converged unattended, past v0.0.160 and v0.0.161.** No action was taken.
      - The releases:
        - v0.0.160, #321 (delegation broker's wave 2), at 01:49:47;
        - v0.0.161, #380 (docs), at 02:11:26;
        - v0.0.162, #379 (the role skills say they are never for a subagent), at 02:15:45.
      - The 02:19 poll found all three, and the auto move went straight to the newest. The fleet box ran 02:19:46 to
        02:21:50, and the server followed at 02:22:10 to 02:22:32, 20 seconds after the fleet.
      - Both boxes read `box-token` PASS. Server doctor: 25 passed, 0 warned, 0 failed. Fleet doctor: 33 passed, 6
        warned, 0 failed; graphify's sweep-age warning has cleared.
      - v0.0.163 (the GPT lanes' system-prompt and parallel-tool-call fix) was published at 02:27:28, after the poll. It
        moves at the next one, about 02:52.
      - Wave 15 (run 300) is still held by the open PR #351 (`ccd/ccd`).
      - STATUS: fleet and server v0.0.162, newest v0.0.163, backups fleet 145M/server 667M, disk free fleet 217G/work
        volume 220G/server 33G, no anomalies at 02:42.
    - **2026-10-13 03:44 UTC: v0.0.163 (#378, the GPT lanes' system-prompt and parallel-tool-call fix) auto-converged
      unattended.** No action was taken.
      - It was published at 02:27:28. The server last booted at 02:22:32, so its next poll fell at about 02:52:32.
      - The fleet box ran 02:53:04 to 02:58:23, and the server followed by auto at 02:58:48 to 02:59:12, 25 seconds
        after the fleet. Both reports read `phase: done` and `from: pwa` (defect A).
      - The fleet's run took 5 min 19 s, against 2 to 2.5 min for the four before it. The box's load average was 30
        to 32 on 16 cores at the probe. Nothing failed, so this is read as load, not a defect.
      - Both boxes read `box-token` PASS. Server doctor: 25 passed, 0 warned, 0 failed. Fleet doctor: 33 passed, 6
        warned, 0 failed.
      - **Wave 15 (run 300) is held twice, not once.** The open PR #351 (`ccd/ccd`) still holds it. So does claim 1213
        (run 354, ccrc-history's recall batch), live on `ccd/ccrc`, the file whose line 911 wave 15 edits. The claim
        was made at 00:52 and renews; its hard cap is 08:52. The ruling on wave 15's Reading 7 dispatches it
        only once every claim on its three files has ended.
        - The 01:52 and 02:43 entries named #351 alone. They were incomplete, unless the claim's paths were widened
          after they were written; that cannot be told from here.
      - STATUS: fleet and server v0.0.163, newest v0.0.163, backups fleet 145M/server 670M, disk free fleet 215G/work
        volume 222G/server 33G, no anomalies at 03:42.
    - **2026-10-13 07:43 UTC: v0.0.164 (#376, box-token row 2c) auto-converged unattended.** No action was taken.
      - It was published at 07:02:42. The fleet box ran 07:32:32 to 07:34:33, and the server followed by auto at
        07:35:02 to 07:35:29, 29 seconds after the fleet. Both reports read `phase: done` and `from: pwa` (defect A).
      - The release changes doctor's armed `box-token` verdicts on boxes that lost token files. Both boxes still read
        `box-token` PASS. Server doctor: 25 passed, 0 warned, 0 failed. Fleet doctor: 33 passed, 6 warned, 0 failed.
      - **Wave 15 (run 300)** is still held twice: by the open PR #351 (`ccd/ccd`), and on `ccd/ccrc` by run 354, whose
        claim 1213 ended and whose claim 1227 now holds that file.
      - STATUS: fleet and server v0.0.164, newest v0.0.164, backups fleet 145M/server 672M, disk free fleet 215G/work
        volume 218G/server 32G, no anomalies at 07:42.
    - **2026-10-13 11:44 UTC: v0.0.165 and v0.0.166 auto-converged unattended.** No action was taken.
      - v0.0.165 (#381, native docs reader's wave 4) was published at 10:56:50. The server moved at 11:08:56 to
        11:09:21, after the fleet.
      - v0.0.166 (#383, docs) was published at 11:33:20. The server last booted at 11:09:08, so its next poll fell at
        about 11:39. The fleet box ran 11:40:16 to 11:42:11, and the server followed at 11:42:47 to 11:43:11, 36
        seconds after the fleet.
      - **The 11:42 probe landed mid-move.** It read "boxes differ" and the fleet row `pending`, 20 seconds after the
        fleet finished. That was transient: re-measured, the server reached v0.0.166 at 11:43:11.
      - Both boxes read `box-token` PASS. Server doctor: 26 passed, 0 warned, 0 failed. Fleet doctor: 33 passed, 6
        warned, 0 failed. Each box gained one check, from #381.
      - **Wave 15 (run 300)** is still held by the open PR #351 (`ccd/ccd`) and by claim 1227 on `ccd/ccrc`.
      - STATUS: fleet and server v0.0.166, newest v0.0.166, backups fleet 145M/server 675M, disk free fleet 217G/work
        volume 218G/server 33G, converged at 11:43.
    - **2026-10-13 12:42 UTC: v0.0.167 (#111, PHP code blocks highlighted in chat) published at 12:26:28; not yet
      moved.** Both boxes are on v0.0.166. The server last booted at 11:43:11, so its next poll falls at about 12:43,
      and the auto move follows it. Wave 15 (run 300) is still held by the open PR #351 and by claim 1240 on
      `ccd/ccrc` (run 354; claim 1227 ended).
      - STATUS: fleet and server v0.0.166, newest v0.0.167, backups fleet 145M/server 677M, disk free fleet 215G/work
        volume 215G/server 32G, no anomalies at 12:42.
    - **2026-10-13 13:43 UTC: v0.0.167 auto-converged unattended; v0.0.168 (#385, docs) published at 13:19:50.** No
      action was taken.
      - v0.0.167: the fleet box ran 12:44:21 to 12:46:32, and the server followed at 12:46:54 to 12:47:19, 22 seconds
        after the fleet. Both reports read `phase: done` and `from: pwa`.
      - Both boxes read `box-token` PASS. Server doctor: 26 passed, 0 warned, 0 failed. Fleet doctor: 33 passed, 6
        warned, 0 failed.
      - v0.0.168 came out after the server's 13:17 poll (it last booted at 12:47:06), so it moves at about 13:47.
      - Wave 15 (run 300) is still held by the open PR #351 and by claim 1240 on `ccd/ccrc`.
      - STATUS: fleet and server v0.0.167, newest v0.0.168, backups fleet 145M/server 678M, disk free fleet 217G/work
        volume 216G/server 32G, no anomalies at 13:42.
    - **2026-10-13 14:43 UTC: v0.0.168 auto-converged unattended; v0.0.169 (#152, text and PDF attachments) published at
      14:28:58.** No action was taken.
      - v0.0.168: the fleet box ran 13:48:11 to 13:50:07, and the server followed at 13:50:40 to 13:51:05, 33 seconds
        after the fleet.
      - Both boxes read `box-token` PASS. Server doctor: 26 passed, 0 warned, 0 failed. Fleet doctor: 33 passed, 6
        warned, 0 failed.
      - v0.0.169 came out after the server's 14:20 poll (it last booted at 13:50:52), so it moves at about 14:50.
      - Wave 15 (run 300) is still held by the open PR #351 and by claim 1240 on `ccd/ccrc`.
      - STATUS: fleet and server v0.0.168, newest v0.0.169, backups fleet 146M/server 680M, disk free fleet 218G/work
        volume 212G/server 32G, no anomalies at 14:42.
    - **2026-10-13 15:43 UTC: v0.0.169 auto-converged unattended; v0.0.170 to v0.0.172 published.** No action was taken.
      - v0.0.169: the fleet box ran 14:51:48 to 14:53:49, and the server followed at 14:54:12 to 14:54:38, 23 seconds
        after the fleet.
      - Both boxes read `box-token` PASS. Server doctor: 26 passed, 0 warned, 0 failed. Fleet doctor: 33 passed, 6
        warned, 0 failed.
      - Three releases followed within four minutes:
        - v0.0.170, #157 (one account row, many writers), at 15:39:12;
        - v0.0.171, #156 (a box that scrolled out of the capture is unmeasured), at 15:40:50;
        - v0.0.172, #386 (a GitHub slug's shape), at 15:42:32.

        The server last booted at 14:54:24, so its next poll falls at about 15:54, and the auto move should go straight
        to v0.0.172.
      - Wave 15 (run 300) is still held by the open PR #351 and by claim 1240 on `ccd/ccrc`.
      - STATUS: fleet and server v0.0.169, newest v0.0.172, backups fleet 146M/server 682M, disk free fleet 211G/work
        volume 208G/server 32G, no anomalies at 15:42.
    - **2026-10-13 16:43 UTC: v0.0.172 auto-converged unattended, past v0.0.170 and v0.0.171.** No action was taken.
      - The 15:54 poll found all three, and the auto move went straight to the newest. The fleet box ran 15:54:43 to
        15:56:54, and the server followed at 15:57:07 to 15:57:32, 13 seconds after the fleet.
      - Both boxes read `box-token` PASS. Server doctor: 26 passed, 0 warned, 0 failed. Fleet doctor: 33 passed, 6
        warned, 0 failed.
      - **Wave 15 (run 300)** is now held three ways: by the open PR #351, by claim 1247 (run 358, the run behind #351)
        on `ccd/ccd`, and by claim 1240 (run 354) on `ccd/ccrc`.
      - STATUS: fleet and server v0.0.172, newest v0.0.172, backups fleet 146M/server 684M, disk free fleet 206G/work
        volume 219G/server 32G, no anomalies at 16:42.
    - **2026-10-13 17:43 UTC: v0.0.174 auto-converged unattended, past v0.0.173.** No action was taken.
      - The releases: v0.0.173, #391 (a refused gateway connection is waited out), at 16:58:59; and v0.0.174, #392 (a
        subagent cannot load a ccrc role skill), at 17:00:11.
      - The next poll found both, and the auto move went straight to the newest. The fleet box ran 17:28:10 to 17:30:18,
        and the server followed at 17:30:44 to 17:31:10, 26 seconds after the fleet.
      - Both boxes read `box-token` PASS. Server doctor: 26 passed, 0 warned, 0 failed. Fleet doctor: 33 passed, 6
        warned, 0 failed.
      - The fleet's backups grew from 146M to 159M, one more kept build.
      - Wave 15 (run 300) is still held by the open PR #351, by claim 1247 on `ccd/ccd` and by claim 1254 (run 354;
        1240 ended) on `ccd/ccrc`.
      - STATUS: fleet and server v0.0.174, newest v0.0.174, backups fleet 159M/server 686M, disk free fleet 209G/work
        volume 217G/server 32G, no anomalies at 17:42.
    - **2026-10-13 20:43 UTC: v0.0.175 auto-converged unattended.** No action was taken.
      - The release: v0.0.175, #393 (docs only: the supervisor tick and fleet observer specs, and their plan), at
        20:21:50.
      - The next poll found it. The fleet box ran 20:31:41 to 20:33:59, and the server followed at 20:34:11 to
        20:34:37, 12 seconds after the fleet.
      - Both boxes read `box-token` PASS. Server doctor: 26 passed, 0 warned, 0 failed. Fleet doctor: 33 passed, 6
        warned, 0 failed.
      - The fleet's backups grew from 159M to 175M, one more kept build.
      - Wave 15 (run 300) is still held by the open PR #351, by claim 1247 on `ccd/ccd` and by claim 1254 on
        `ccd/ccrc`.
      - STATUS: fleet and server v0.0.175, newest v0.0.175, backups fleet 175M/server 688M, disk free fleet 206G/work
        volume 212G/server 32G, no anomalies at 20:42.
    - **2026-10-13 23:43 UTC: v0.0.177 auto-converged unattended, past v0.0.176; #351 has merged.** No action was taken.
      - The releases: v0.0.176, #351 (workspace lifecycle wave 6), at 23:23:02; and v0.0.177, #362 (stall watch
        settings wave 3), at 23:24:59.
      - The next poll found both, and the auto move went straight to the newest. The fleet box ran 23:35:50 to
        23:38:04, and the server followed at 23:38:29 to 23:38:55, 25 seconds after the fleet.
      - Both boxes read `box-token` PASS (the server: "rotated 3 d ago"). Server doctor: 26 passed, 0 warned, 0 failed.
        Fleet doctor: 33 passed, 6 warned, 0 failed.
      - **Wave 15 (run 300)** is now held by one thing: claim 1268 (run 354) on `ccd/ccrc`. #351 merged at 23:22:04,
        and claim 1247 on `ccd/ccd` ended with run 358. The plan was written against an older `main`, and #351 changed
        `ccd/ccd`, so the plan's citations are re-measured before any dispatch. A dispatch also needs a slot under the
        daily cap.
      - STATUS: fleet and server v0.0.177, newest v0.0.177, backups fleet 175M/server 690M, disk free fleet 209G/work
        volume 216G/server 32G, no anomalies at 23:42.
    - **2026-10-14 00:50 UTC: v0.0.178 and v0.0.179 auto-converged unattended, one after the other.** No action was
      taken.
      - The releases, both docs only: v0.0.178, #394 (a programme ledger), at 23:53:23; and v0.0.179, #396 (a plan and
        its ledger), at 00:17:22.
      - **v0.0.178.** The fleet box ran 00:09:48 to 00:11:54, and the server followed at 00:12:18 to 00:12:44.
      - **v0.0.179.** The server's next poll, 30 minutes after its own restart, found it. The fleet box ran 00:43:35 to
        00:46:07, and the server followed at 00:47:02 to 00:47:27, 55 seconds after the fleet.
      - **The fleet's v0.0.179 update closed `done` with "doctor exited 1 - the box moved; its health is ccrc
        doctor's"**: the case an update reports as exit 3 (the report records no exit code). Its closing doctor read one
        FAIL, `history: tick-stale`: reads at 00:44 and 00:45 gave "the last tick ran 12 min ago" and "13 min ago",
        against a 10-minute limit. That check is the history programme's, not the update mechanism's. Under the box's
        load (about 24 on 16 cores), sweep passes ran back to back for up to 7.5 minutes, and the check dates the tick
        from the last finished pass, so a long pass plus the next one crossed the 10 minutes. The server still followed,
        as an exit 3 should allow. At 00:48 the fleet doctor read the history check PASS ("last tick 551s ago"), with 0
        failed.
      - Both boxes read `box-token` PASS. Server doctor: 26 passed, 0 warned, 0 failed. Fleet doctor at 00:48: 33
        passed, 7 warned, 0 failed. The seventh WARN is `graphify`'s "the last graph-sweep pass finished 48 minutes
        ago", also a load reading.
      - Wave 15 (run 300) is still held by claim 1268 (run 354) on `ccd/ccrc` alone.
      - STATUS: fleet and server v0.0.179, newest v0.0.179, backups fleet 176M/server 695M, disk free fleet 210G/work
        volume 213G/server 32G, no anomalies at 00:50.
    - **2026-10-14 04:42 UTC: v0.0.180 auto-converged unattended.** No action was taken.
      - The release: v0.0.180, #399 (stall watch settings wave 4, code in `ccd/`, `server/`, `pwa/` and `shared/`),
        merged at 03:59:31 and released at 04:00:25.
      - The server's poll, 30 minutes after its 00:47 restart (the seventh since), found it. The fleet box ran
        04:18:34 to 04:20:27, and the server followed at 04:21:05 to 04:21:31, 38 seconds after the fleet. Both
        reports read `phase: done` and `from: pwa` (defect A), with no detail.
      - Both boxes read `box-token` PASS. Server doctor: 26 passed, 0 warned, 0 failed. Fleet doctor: 33 passed, 6
        warned, 0 failed.
      - Wave 15 (run 300) is still held, now by two claims: 1268 (run 354) on `ccd/ccrc` and 1281 (run 360) on
        `ccd/ccd`.
      - STATUS: fleet and server v0.0.180, newest v0.0.180, backups fleet 176M/server 697M, disk free fleet 219G/work
        volume 204G/server 32G, no anomalies at 04:42.
    - **2026-10-14 10:42 UTC: v0.0.181 auto-converged unattended; v0.0.182 released, its move not yet due.** No action
      was taken.
      - The releases: v0.0.181 is #395 (the supervisor tick diet's wave 1, which edits `ccd/ccd`), merged at 10:20:30
        and released at 10:21:52. v0.0.182 is #190 (the terminal fit, interim), merged at 10:36:45 and released at
        10:37:46.
      - The fleet box ran 10:22:33 to 10:24:55, and the server followed at 10:25:13 to 10:25:38. Both reports read
        `phase: done` and `from: pwa` (defect A), with no detail.
      - The fleet box started 41 seconds after the release. A 30-minute poll counted from the server's 04:21 restart
        falls at about 10:21:31, before the release, unless the cadence drifted. The server's journal logs neither a
        poll nor a tap, so with defect A the two cannot be told apart.
      - v0.0.182 waits for the server's next poll, about 30 minutes after its 10:25 restart.
      - Both boxes read `box-token` PASS (server: generation #3, rotated 3 d ago). Server doctor: 26 passed, 0 warned,
        0 failed. Fleet doctor: 33 passed, 6 warned, 0 failed.
      - Wave 15 (run 300) is still held, by claims 1298 (run 354) on `ccd/ccrc` and 1302 (run 360) on `ccd/ccd`.
        #395 moved `ccd/ccd` again, so its plan's re-measure now covers that too.
      - STATUS: fleet and server v0.0.181, newest v0.0.182, backups fleet 176M/server 700M, disk free fleet 217G/work
        volume 199G/server 32G, no anomalies at 10:42.
    - **2026-10-14 11:42 UTC: v0.0.182 auto-converged unattended; the fleet box's run exited 3 on a history FAIL.** No
      action was taken.
      - The fleet box ran 10:56:11 to 10:58:32, about 30 minutes after the server's 10:25 restart, so it was most likely
        the server's poll. The server followed at 10:58:56 to 10:59:22. Both reports read `phase: done` and
        `from: pwa` (defect A).
      - The fleet box's report says its trailing doctor exited 1. Its one FAIL, at 10:58:03, was `history: tick-stale`:
        the history sweep's last tick was 12 minutes old, against a 10-minute bound. The run exited 3, the box stayed on
        v0.0.182 (D-3114), and the server still moved. The mechanism behaved as designed. The FAIL is the history
        programme's known tick-stale flap, which that programme has queued as its next wave's first task. It had
        cleared by 11:42.
      - Both boxes read `box-token` PASS. Server doctor: 26 passed, 0 warned, 0 failed. Fleet doctor: 33 passed, 6
        warned, 0 failed.
      - Wave 15 (run 300) is still held, by 1298 (run 354, now `awaiting-review`) on `ccd/ccrc` and 1302 (run 360) on
        `ccd/ccd`.
      - STATUS: fleet and server v0.0.182, newest v0.0.182, backups fleet 177M/server 702M, disk free fleet 220G/work
        volume 194G/server 32G, no anomalies at 11:42.
    - **2026-10-14 14:42 UTC: v0.0.184 auto-converged unattended, past v0.0.183; the fleet box's run exited 3 on the
      same history FAIL.** No action was taken.
      - v0.0.183 was released at 13:42:07 and v0.0.184 at 13:48:47. Neither box moved to v0.0.183: both releases fell
        inside one 30-minute poll interval of the server.
      - The fleet box ran 14:00:19 to 14:02:39, about a minute after a poll falls due on the server's 30-minute grid
        from its 10:59 restart, so most likely the server's poll again. The server followed at 14:02:50 to 14:03:15.
        Both reports read `phase: done` and `from: pwa` (defect A).
      - The fleet box's trailing doctor exited 1. Its one FAIL, at 14:01:50, was `history: tick-stale` again: the last
        tick was 13 minutes old, against the 10-minute bound. The history sweeps ran back to back, each finishing 4 to
        8 minutes after it started. The run exited 3, the box stayed on v0.0.184 (D-3114), and the server still moved.
        The mechanism behaved as designed. It is the history programme's flap, now at two updates in a row, and it had
        cleared by 14:42.
      - The fleet sweep skipped three supervisor units that had already failed before it began, and it counted one
        restart failure as transient once its re-check passed.
      - This is the first release on the boxes that carries #403 (the box-token rotation schedule). Both boxes read
        `box-token` PASS, in the run and at 14:42. Server doctor: 26 passed, 0 warned, 0 failed. Fleet doctor: 33
        passed, 7 warned, 0 failed.
      - Wave 15 (run 300) is still held, by 1298 (run 354, `working` again) on `ccd/ccrc` and 1302 (run 360) on
        `ccd/ccd`.
      - STATUS: fleet and server v0.0.184, newest v0.0.184, backups fleet 177M/server 706M, disk free fleet 216G/work
        volume 197G/server 32G, no anomalies at 14:42.
    - **2026-10-14 15:42 UTC: v0.0.186, then v0.0.187, auto-converged unattended, past v0.0.185. The probe caught the
      second move in flight. The fleet box's history FAIL outlived both runs.** No action was taken.
      - v0.0.185 (`6da6fa4bb`, #407) was released at 15:04:14, v0.0.186 (`5bee9961f`) at 15:17:02 and v0.0.187
        (`520ee5652`, #408) at 15:38:44. Neither box moved to v0.0.185: the server's next poll came after v0.0.186 was
        out.
      - **The first move.** The fleet box ran from 15:34:03 to 15:38:26, about a minute after a poll falls due on the
        server's grid from its 14:03 restart. The server followed from 15:38:34 to 15:39:00.
      - **The second move.** v0.0.187 came out during the server's own install. The fleet box ran from 15:39:55 to
        15:42:13, about a minute after the server restarted on v0.0.186, which fits the poll on the first tick after
        start. The server followed from 15:42:46 to 15:43:12. Every report reads `phase: done` and `from: pwa`
        (defect A).
      - **The probe.**
        - At 15:42:22 it printed two ANOMALY lines: the boxes differed (fleet v0.0.187, server v0.0.186), and the
          inventory read the fleet row `pending`.
        - At 15:44:06 the server row still read `pending` and `incomplete`, under a minute after its run ended.
        - At 15:44:25 it read OK, with no anomalies.

        It was a move in flight and a once-a-minute inventory catching up. The mechanism behaved as designed.
      - **The history FAIL.** Both fleet runs exited 3 on one FAIL, `history: tick-stale` (16, then 20 minutes old,
        against the 10-minute bound), and each box stayed on its new build (D-3114). Unlike at 14:00, it had not
        cleared afterwards: at 15:43 it read 21 minutes.
        - The history sweep that started at 15:31:55 was killed at 15:41:55, at its unit's 10-minute start timeout.
          Both fleet runs fell inside it. The earlier sweeps each finished 5 to 10 minutes after they started.
        - A fresh sweep started at 15:42:07.

        This is the history programme's to fix, not this one's.
      - Both boxes read `box-token` PASS. Server doctor: 26 passed, 0 warned, 0 failed. Fleet doctor at 15:43: 32
        passed, 8 warned, 1 failed (the history FAIL).
      - Wave 15 (run 300) is still held, by 1298 (run 354, `working`) on `ccd/ccrc` and 1302 (run 360, `dispatched`)
        on `ccd/ccd`. #408 touched none of its files.
      - STATUS: fleet and server v0.0.187, newest v0.0.187, backups fleet 178M/server 714M, disk free fleet 218G/work
        volume 193G/server 32G, no anomalies at 15:44.
    - **2026-10-14 16:42 UTC: v0.0.190 auto-converged unattended, past v0.0.188 and v0.0.189, with both runs clean.
      v0.0.191 is released.** No action was taken.
      - v0.0.188 (`84729c722`, #400) was released at 16:02:24, v0.0.189 (`3786aa755`, #401) at 16:03:45, v0.0.190
        (`af62cc229`) at 16:05:20 and v0.0.191 (`c7776b080`, #406) at 16:17:54.
      - The fleet box ran from 16:13:33 to 16:15:34, about 20 seconds after a poll falls due on the server's grid from
        its 15:43 restart. The server followed from 16:16:03 to 16:16:29. Both reports read `phase: done` and
        `from: pwa` (defect A), with no doctor detail.
      - Both trailing doctors passed. This is the fleet box's first clean run in four. Fleet: 34 passed, 7 warned, 0
        failed. Server: 26 passed, 0 warned, 0 failed. Both read `box-token` PASS.
      - The history sweeps since 15:42:07 each finished 4 to 8 minutes after they started, and none hit the unit's
        timeout.
      - v0.0.191 came out about a minute and a half after the server's restart, so the boxes stay on v0.0.190 until
        the next poll, due about 16:46.
      - Wave 15 (run 300) is still held: 1332 (run 354, `working`; it replaces 1298) on `ccd/ccrc`, and 1302 (run 360,
        `dispatched`) on `ccd/ccd`. None of the four merges touched its files.
      - STATUS: fleet and server v0.0.190, newest v0.0.191, backups fleet 178M/server 717M, disk free fleet 217G/work
        volume 189G/server 32G, no anomalies at 16:42.
    - **2026-10-14 17:42 UTC: v0.0.191 auto-converged unattended, with both runs clean.** No action was taken.
      - The fleet box ran from 16:47:22 to 16:49:08, about a minute after a poll falls due on the server's grid from its
        16:16 restart, as the 16:42 entry expected. The server followed from 16:49:49 to 16:50:14. Both reports read
        `phase: done` and `from: pwa` (defect A), with no doctor detail.
      - Both trailing doctors passed. Fleet: 34 passed, 6 warned, 0 failed. Server: 26 passed, 0 warned, 0 failed.
        Both read `box-token` PASS. No history sweep has hit its timeout since 15:41:55.
      - Nothing has merged since v0.0.191. Wave 15 (run 300) is still held, by 1332 (run 354, `working`) on `ccd/ccrc`
        and 1302 (run 360, `dispatched`) on `ccd/ccd`.
      - STATUS: fleet and server v0.0.191, newest v0.0.191, backups fleet 179M/server 720M, disk free fleet 217G/work
        volume 190G/server 32G, no anomalies at 17:42.
    - **2026-10-15 02:42 UTC: v0.0.192, then v0.0.193, converged unattended. The first move's trigger is undetermined,
      and the second fleet run exited 3 on the history FAIL.** No action was taken.
      - v0.0.192 (`630288e33`, #342) was released at 01:50:24 and v0.0.193 (`adf8d4b23`, #412) at 02:27:04.
      - **The first move.** The fleet box ran from 01:53:17 to 01:55:27, and the server followed from 01:56:57 to
        01:57:22. Both doctors passed: fleet 34 passed, 6 warned, 0 failed; server 26 passed, 0 warned, 0 failed.
        - The server had restarted at 16:50:01, so its polls fell due at 01:50:01 and 02:20:01. The first of those came
          23 seconds before the release, and the fleet box started more than 3 minutes after it.
        - A tap and a poll write the same `from: pwa` (defect A), so this move's trigger cannot be read from the
          boxes, as with v0.0.181.
      - **The second move.** The fleet box ran from 02:27:27 to 02:29:29, about 17 seconds after a poll falls due on
        the grid from the server's 01:57 restart. The server followed from 02:29:59 to 02:30:25. Every report reads
        `phase: done` and `from: pwa` (defect A).
      - **The history FAIL.** The fleet box's second run exited 3 on one FAIL, `history: tick-stale`, the last tick 10
        minutes old against the 10-minute bound. The box stayed on v0.0.193 (D-3114), and the server still moved. The
        mechanism behaved as designed. The FAIL had cleared by 02:43, and no history sweep has hit its timeout since
        15:41:55 on 2026-10-14.
      - Both boxes read `box-token` PASS, the server's generation #3 now 4 days old. Fleet doctor at 02:43: 33 passed,
        8 warned, 0 failed. Server: 26 passed, 0 warned, 0 failed.
      - Wave 15 (run 300) is still held, by 1349 (run 354, `working`) on `ccd/ccrc` and by a new claim, 1352 (run 433,
        `awaiting-review`), on `ccd/ccd`. Run 360 is still `dispatched`, and its `ccd/ccd` work has not landed.
        Neither merge touched wave 15's files.
      - STATUS: fleet and server v0.0.193, newest v0.0.193, backups fleet 180M/server 727M, disk free fleet 220G/work
        volume 186G/server 32G, no anomalies at 02:42.
    - **2026-10-15 03:42 UTC: v0.0.194 (`354118383`, #413) auto-converged unattended, with both runs clean.** No action
      was taken.
      - The release was published at 02:45:39. The fleet box ran from 03:00:34 to 03:02:27, about 22 seconds after a
        poll falls due on the grid from the server's 02:30:12 restart. The server followed from 03:03:08 to 03:03:34.
        Both reports read `phase: done` and `from: pwa` (defect A), with no doctor detail.
      - Both trailing doctors passed. Fleet: 34 passed, 6 warned, 0 failed. Server: 26 passed, 0 warned, 0 failed.
        Both read `box-token` PASS, the server's generation #3 still 4 days old.
      - The merge touched none of wave 15's files. Wave 15 (run 300) is still held, by 1349 (run 354, now
        `awaiting-review`) on `ccd/ccrc` and by 1352 (run 433, `awaiting-review`) on `ccd/ccd`. Run 360 is still
        `dispatched`, and its `ccd/ccd` work has not landed.
      - STATUS: fleet and server v0.0.194, newest v0.0.194, backups fleet 180M/server 730M, disk free fleet 220G/work
        volume 185G/server 32G, no anomalies at 03:42.
    - **2026-10-15 06:42 UTC: v0.0.195 (`de0ab03e1`, #404, history B2) auto-converged unattended. The fleet run exited 3
      on a new history FAIL that only the operator can clear.** No action was taken.
      - The release was published at 06:16:37. The fleet box ran from 06:34:34 to 06:36:08, about a minute after a
        poll falls due on the grid from the server's 03:03:21 restart. The server followed from 06:37:05 to 06:37:30,
        and its doctor passed (26 passed, 0 warned, 0 failed). Both reports read `phase: done` and `from: pwa`
        (defect A).
      - **The FAIL.** The fleet box's trailing doctor failed on one line, `history: migration-needs-op`: the store needs
        a migration to v2, a copy of about 319 seconds, too long for a scheduled pass. Its remedy is
        `ccrc history doctor --migrate`, run by the operator from a terminal outside any session. The box stayed on
        v0.0.195 (D-3114), and the server still moved, so the update mechanism behaved as designed.
      - **What it costs until then.** Since the install, every 2-minute history sweep ends at once with
        `history-sweep: migration-needs-op`, so this box captures no new session text. Every later fleet update will
        exit 3 on the same line. The history programme named this step for after its deploy, and it owns it.
      - Fleet doctor at 06:43: 32 passed, 7 warned, 1 failed. Both boxes read `box-token` PASS, the server's
        generation #3 still 4 days old.
      - #404 ended claim 1349 and changed `ccd/ccrc` (21 lines added, 13 removed), so wave 15's plan has one more move
        to re-measure. Wave 15 (run 300) is still held by 1352 (run 433, `awaiting-review`) on `ccd/ccd`. Run 360 is
        still `dispatched`, and its `ccd/ccd` work has not landed.
      - STATUS: fleet and server v0.0.195, newest v0.0.195, backups fleet 180M/server 733M, disk free fleet 220G/work
        volume 187G/server 32G, no anomalies at 06:42.
    - **2026-10-15 09:42 UTC: v0.0.196, v0.0.197 and v0.0.198 auto-converged unattended. The history migration ran at
      the operator's request, and the third fleet run was the first clean one since v0.0.194.**
      - **v0.0.196** (`377ede61d`, #414), released 08:29:28. The fleet box installed from 08:38:27 to 08:41:14, about
        a minute after a poll falls due on the grid from the server's 06:37:17 restart. Its run exited 3 on two FAILs,
        `history: migration-needs-op` and `history: lag-high` (7745 seconds). The server followed from 08:42:15 to
        08:42:38, clean.
      - **The migration.** The operator asked the coordinator to run `ccrc history doctor --migrate` for them. It ran
        from 09:09:24 to 09:11:04 as a transient user unit outside the coordinator's session, with a memory cap and
        the highest OOM score, so a kill would take the migration and not a live session. The store went from schema
        v1 to v2, behind a 1.55 GB snapshot that is kept, at 21.6 MB/s, exit 0. Capture resumed: the backlog of about
        63 MB drained to zero by 09:15:21. While the text index is backfilled the scheduled passes run long (9 minutes
        7 seconds, then 5:34, 4:14 and 3:55), each under the 10-minute kill. This was the operator's act through the
        coordinator, not the update mechanism's. The hourly check still runs no mutating verb of its own.
      - **v0.0.197** (`3210b434d`, #417), released 08:57:12. The fleet box installed from 09:13:46 to 09:16:17, about a
        minute after the 09:12:24 poll on the grid from the 08:42:24 restart. Its run exited 3 on `history: lag-high`
        alone (9844 seconds), with the backlog still draining. The server followed from 09:16:54 to 09:17:16, clean.
      - **v0.0.198** (`cb72ca064`, #416), released 09:12:51, 27 seconds after that poll. The server's restart at
        09:17:03 polled on its first tick. The fleet box ran from 09:18:09 to 09:21:45 with its doctor clean (33
        passed, 8 warned, 0 failed), and the server followed from 09:22:19 to 09:22:45. Both reports read `phase:
        done` and `from: pwa` (defect A).
      - Both boxes read `box-token` PASS, the server's generation #3 still 4 days old. Fleet doctor at 09:43: 33
        passed, 8 warned, 0 failed, with `history: ok`. Server: 26 passed, 0 warned, 0 failed.
      - None of the three merges touched wave 15's files. Wave 15 (run 300) is still held, by claim 1370 (run 433,
        `working`; it replaced 1352) on `ccd/ccd`. Run 360 is still `dispatched`, and its `ccd/ccd` work has not
        landed.
      - STATUS: fleet and server v0.0.198, newest v0.0.198, backups fleet 181M/server 739M, disk free fleet 219G/work
        volume 179G/server 32G, no anomalies at 09:42.
    - **2026-10-15 21:41 UTC: v0.0.199 to v0.0.201 auto-converged unattended; one poll took the newest of three.**
      - v0.0.199 (`1d6b24a3b`, #418), v0.0.200 (`bc52c8272`, #411) and v0.0.201 (`a3cebde1b`, #419) were released at
        13:01:26, 13:15:40 and 13:18:20, all inside one poll interval (the grid runs from the server's 09:22 restart).
        The 13:22 poll resolved v0.0.201 alone, as designed: auto installs the newest, never each tag in turn.
      - Fleet box: v0.0.198 to v0.0.201, 13:24:05 to 13:25:41, `phase: done`, doctor 34 passed, 6 warned, 0 failed.
        The server box restarted onto it at 13:26:51; its doctor reads 26 passed, 0 warned, 0 failed.
      - `box-token` PASS, generation #3 at 5 days. Two of the merges touched no file of wave 15; #411 edits `ccd/ccd`.
      - STATUS: fleet and server v0.0.201, newest v0.0.201, backups fleet 181M/server 741M, disk free fleet 216G/work
        volume 153G/server 32G, no anomalies at 21:41.
    - **2026-10-16 10:58 UTC: auto moved the boxes to v0.0.203; then the intent was set to `auto=stable`, and a tap
      moved them to v0.0.206. v0.0.207 and v0.0.208 stay unapplied, as designed.**
      - Auto moves, read off coord.db's `update` feed rows (wave 8's source record): v0.0.201 to v0.0.202 (fleet 21:59,
        server 22:01) and v0.0.202 to v0.0.203 (fleet 22:32, server 22:36), each row reading "auto update".
      - 22:36:38: the fleet-wide intent was set from the PWA (`setBy: pwa`) to channel `dev`, `auto=stable`. Auto now
        installs only a stable release. v0.0.204 to v0.0.206 (22:45, 23:00, 23:22) moved no box.
      - 10:05:45 (fleet) and 10:08:21 (server): "requested update from v0.0.203 to v0.0.206", a tap. This is the
        first live proof that the feed tells a tap from an auto move (defect A, closed 2026-10-15). Fleet 10:05:45 to
        10:07:21, doctor 34 passed, 6 warned, 0 failed; the server restarted at 10:08:35, doctor 26/0/0. Both
        reports read `phase: done`.
      - v0.0.207 (10:44:32) and v0.0.208 (10:55:35) are newer dev releases. Under `auto=stable`, nothing moves until
        a stable promotion or a tap. So a stable promotion now moves both boxes, by auto.
      - `box-token` PASS on both; the server's generation #3 is 5 days old, so the first scheduled rotation is near.
      - STATUS: fleet and server v0.0.206, newest v0.0.208, intent dev/auto=stable, backups fleet 183M/server 750M,
        disk free fleet 216G/work volume 143G/server 32G, no anomalies at 10:58.
    - **2026-10-16 11:58 UTC:** v0.0.209 released at 11:07:09; under `auto=stable` no box moved, as designed.
      STATUS: fleet and server v0.0.206, newest v0.0.209, intent dev/auto=stable, backups fleet 183M/server 750M, disk
      free fleet 216G/work volume 140G/server 32G, no anomalies at 11:58.
    - **2026-10-16 12:58 UTC:** a tap moved both boxes from v0.0.206 to v0.0.209, read from the feed as "requested
      update" (fleet 12:50:34 to 12:52:14, doctor 34/6/0; server restarted at 12:53:31, doctor 26/0/0). v0.0.210
      (12:55:44, wave 19's merge) stays unapplied under `auto=stable`. STATUS: fleet and server v0.0.209, newest
      v0.0.210, intent dev/auto=stable, backups fleet 184M/server 754M, disk free fleet 215G/work volume 141G/server
      32G, no anomalies at 12:58.
    - **2026-10-16 13:58 UTC:** v0.0.211 released at 13:31:24 (#446, a UI change); under `auto=stable` no box moved,
      as designed. STATUS: fleet and server v0.0.209, newest v0.0.211, intent dev/auto=stable, backups fleet
      184M/server 754M, disk free fleet 216G/work volume 141G/server 32G, no anomalies at 13:58.
    - **2026-10-16 14:58 UTC:** v0.0.212 released at 14:14:21 (#447, a UI change); under `auto=stable` no box moved,
      as designed. STATUS: fleet and server v0.0.209, newest v0.0.212, intent dev/auto=stable, backups fleet
      184M/server 754M, disk free fleet 216G/work volume 140G/server 32G, no anomalies at 14:58.
    - **2026-10-16 15:58 UTC:** the probe's auto rule fired on v0.0.212 under `auto=stable`, a false anomaly. The
      rule now reads the intent (see the 18:00 entry). Nothing else changed through 19:58.
    - **2026-10-16 20:58 UTC:** a tap moved both boxes from v0.0.209 to v0.0.212, read from the feed as "requested
      update" (fleet 20:51:55 to 20:53:36, doctor 34/6/0; server 20:54:33 to 20:54:59, restarted at 20:54:46, doctor
      26/0/0). The fleet run warned "is FAILED — try-restart skipped it" for three supervisors that had failed before
      the run: the warning wave 16's item 3 rewords. STATUS: fleet and server v0.0.212, newest v0.0.212, intent
      dev/auto=stable, backups fleet 184M/server 759M, disk free fleet 216G/work volume 139G/server 32G, no anomalies.
    - **2026-10-16 21:58 UTC:** v0.0.213 to v0.0.216 released between 21:20 and 21:37 (#449 to #452, UI and docs). A
      tap moved both boxes from v0.0.212 to v0.0.214, read from the feed as "requested update" (fleet 21:37:56 to
      21:39:36, doctor 34/6/0; server 21:40:27 to 21:40:53, restarted at 21:40:39, doctor 26/0/0). STATUS: fleet and
      server v0.0.214, newest v0.0.216, intent dev/auto=stable, backups fleet 185M/server 764M, disk free fleet
      215G/work volume 138G/server 32G, no anomalies.
    - **2026-10-17 07:58 UTC:** a tap moved both boxes from v0.0.214 to v0.0.216, read from the feed as "requested
      update" (fleet 07:01:09 to 07:03:57, doctor 34/6/0; server 07:04:39 to 07:05:05, restarted at 07:04:52, doctor
      26/0/0). The fleet run's sweep again skipped supervisors that had failed before it, four this time (one at
      06:38, three on 10-12). STATUS: fleet and server v0.0.216, newest v0.0.216, intent dev/auto=stable, backups
      fleet 186M/server 771M, disk free fleet 216G/work volume 123G/server 32G, no anomalies.
    - **2026-10-17 10:58 UTC:** v0.0.217 released at 10:49:26 (#483, a server change to how the PWA is served);
      under `auto=stable` no box moved, as designed. STATUS: fleet and server v0.0.216, newest v0.0.217, intent
      dev/auto=stable, backups fleet 186M/server 771M, disk free fleet 216G/work volume 117G/server 32G, no anomalies.
    - **2026-10-17 11:58 UTC:** a tap moved both boxes from v0.0.216 to v0.0.217, read from the feed as "requested
      update" (fleet 11:24:37 to 11:26:36, doctor 34/6/0; server 11:27:08 to 11:27:35, restarted at 11:27:22, doctor
      26/0/0); the fleet sweep skipped the same four failed supervisors. v0.0.218 released at 11:52:45 (#484, a PWA
      fix) and stays unapplied under `auto=stable`. STATUS: fleet and server v0.0.217, newest v0.0.218, intent
      dev/auto=stable, backups fleet 187M/server 778M, disk free fleet 216G/work volume 116G/server 32G, no anomalies.
    - **2026-10-17 12:58 UTC:** a tap moved both boxes from v0.0.217 to v0.0.218, read from the feed as "requested
      update" (fleet 12:13:50 to 12:15:49, doctor 34/6/0; server 12:16:36 to 12:17:01, restarted at 12:16:48, doctor
      26/0/0); the fleet sweep skipped the same four failed supervisors. v0.0.219 to v0.0.222 released between 12:13
      and 12:51 (#487, #488, #485 and #489) and stay unapplied under `auto=stable`. STATUS: fleet and server
      v0.0.218, newest v0.0.222, intent dev/auto=stable, backups fleet 188M/server 786M, disk free fleet 216G/work
      volume 114G/server 32G, no anomalies.
    - **2026-10-17 13:58 UTC:** a tap moved both boxes from v0.0.218 to v0.0.221, read from the feed as "requested
      update" (fleet 13:14:46 to 13:16:50, doctor 34/6/0; server 13:17:16 to 13:17:42, restarted at 13:17:29, doctor
      26/0/0); the fleet sweep skipped the same four failed supervisors. v0.0.223 released at 13:21:30 (#429, B1's
      fix) and stays unapplied under `auto=stable`. STATUS: fleet and server v0.0.221, newest v0.0.223, intent
      dev/auto=stable, backups fleet 189M/server 794M, disk free fleet 215G/work volume 113G/server 32G, no anomalies.
    - **2026-10-17 14:58 UTC:** v0.0.224 to v0.0.226 released (14:21:03, 14:24:41, 14:48:05; #486, #491, #493) and
      stay unapplied under `auto=stable`. STATUS: fleet and server v0.0.221, newest v0.0.226, intent dev/auto=stable,
      backups fleet 189M/server 794M, disk free fleet 215G/work volume 114G/server 32G, no anomalies.
    - **2026-10-17 15:58 UTC:** a tap moved both boxes from v0.0.221 to v0.0.226, read from the feed as "requested
      update" (fleet 15:24:52 to 15:26:48, doctor 34/6/0; server 15:27:34 to 15:28:00, restarted at 15:27:47, doctor
      26/0/0). The fleet sweep skipped the same four failed supervisors, and the fleet's prune took its backups from
      189M to 175M. STATUS: fleet and server v0.0.226, newest v0.0.226, intent dev/auto=stable, backups fleet
      175M/server 801M, disk free fleet 214G/work volume 111G/server 32G, no anomalies.
    - **2026-10-17 16:58 UTC:** v0.0.227 released at 16:14:29 (#495, docs) and stays unapplied under `auto=stable`.
      STATUS: fleet and server v0.0.226, newest v0.0.227, intent dev/auto=stable, backups fleet 175M/server 801M,
      disk free fleet 214G/work volume 111G/server 32G, no anomalies.
    - **2026-10-17 17:58 UTC:** v0.0.228 released at 17:38:41 (#497) and stays unapplied under `auto=stable`.
      STATUS: fleet and server v0.0.226, newest v0.0.228, intent dev/auto=stable, backups fleet 175M/server 801M,
      disk free fleet 214G/work volume 108G/server 32G, no anomalies.
    - **2026-10-17 18:58 UTC:** v0.0.229 (17:59, #505), v0.0.230 (18:10, #499), v0.0.231 (18:26, #502) and
      v0.0.232 (18:50, #498) released and stay unapplied under `auto=stable`. #498 adds one `SERVER_CAPS` case to
      `dispatch-live-gate.test.ts`; #444 still merges clean (measured). STATUS: fleet and server v0.0.226, newest
      v0.0.232, intent dev/auto=stable, backups fleet 175M/server 801M, disk free fleet 214G/work volume 87G/server
      32G, no anomalies.
    - **2026-10-17 19:59 UTC:** both boxes moved v0.0.226 → v0.0.234 by the operator's console requests (feed rows
      23210 and 23211: fleet 19:47:12, server 19:49:57; `from: pwa`, phase `done` on both). Doctor: fleet 35 passed,
      6 warned, 0 failed; server 26 passed. The fleet sweep named four supervisors FAILED and skipped; each was
      already failed (5 restarts) since 2026-10-12 or 06:38 today, so the warning is true (Reading 9's case).
      v0.0.233 (19:15, #503) and v0.0.235 (19:39, #504) released. STATUS: fleet and server v0.0.234, newest
      v0.0.235, intent dev/auto=stable, backups fleet 144M/server 809M, disk free fleet 214G/work volume 84G/server
      32G, no anomalies.
    - **2026-10-17 20:58 UTC:** both boxes moved v0.0.234 → v0.0.237 by the operator's console requests (fleet
      20:50:10, server 20:51:42; `from: pwa`, `done`). v0.0.236 is #444 (wave 16), so both boxes now carry it; the
      sweep that ran was v0.0.234's, so wave 16's sweep first runs on the next move. Doctor: fleet 35 passed, 6 warned,
      0 failed; server 26 passed. The same four pre-failed supervisors were named and skipped. v0.0.238 and v0.0.239
      released. STATUS: fleet and server v0.0.237, newest v0.0.239, intent dev/auto=stable, backups fleet 145M/server
      815M, disk free fleet 213G/work volume 85G/server 32G, no anomalies.
    - **2026-10-17 21:58 UTC:** v0.0.240 (21:18, #510), v0.0.241 (21:23, #509) and v0.0.242 (21:51, #511) released and
      stay unapplied under `auto=stable`. STATUS: fleet and server v0.0.237, newest v0.0.242, intent dev/auto=stable,
      backups fleet 145M/server 815M, disk free fleet 214G/work volume 84G/server 32G, no anomalies.
    - **2026-10-17 22:58 UTC:** two moves, each the operator's console request (`from: pwa`, `done`): v0.0.237 →
      v0.0.242 (fleet 22:20:28, server 22:23:15) and v0.0.242 → v0.0.244 (fleet 22:28:04, server 22:30:53). The first
      was driven by v0.0.237, which carries wave 16, so wave 16's sweep ran live for the first time: the four
      pre-failed supervisors were named once each by item 3's line and got no second line, as designed. Doctor: fleet
      34 passed, 8 warned (two new graphify-sweep warnings, not the update path), 0 failed; server 26 passed, twice.
      v0.0.245 and v0.0.246 released. STATUS: fleet and server v0.0.244, newest v0.0.246, intent dev/auto=stable,
      backups fleet 131M/server 826M, disk free fleet 214G/work volume 81G/server 32G, no anomalies.
    - **2026-10-17 23:59 UTC:** v0.0.247 to v0.0.251 released (the last at 23:56) and stay unapplied under
      `auto=stable`; no box moved. STATUS: fleet and server v0.0.244, newest v0.0.251, intent dev/auto=stable, backups
      fleet 131M/server 826M, disk free fleet 214G/work volume 78G/server 32G, no anomalies.
    - **2026-10-18 00:58 UTC:** v0.0.252 released at 00:31 (#570, the swap route) and stays unapplied under
      `auto=stable`; no box moved. STATUS: fleet and server v0.0.244, newest v0.0.252, intent dev/auto=stable, backups
      fleet 131M/server 826M, disk free fleet 210G/work volume 75G/server 32G, no anomalies.
    - **2026-10-18 01:58 UTC:** v0.0.253 to v0.0.255 released (#575, #564, #572; the last at 01:30) and stay
      unapplied under `auto=stable`; no box moved. STATUS: fleet and server v0.0.244, newest v0.0.255, intent
      dev/auto=stable, backups fleet 131M/server 826M, disk free fleet 213G/work volume 77G/server 32G, no anomalies.
    - **2026-10-18 02:58 UTC:** v0.0.256 and v0.0.257 released (#574, #579; the last at 02:34) and stay unapplied
      under `auto=stable`; no box moved. STATUS: fleet and server v0.0.244, newest v0.0.257, intent dev/auto=stable,
      backups fleet 131M/server 826M, disk free fleet 212G/work volume 88G/server 32G, no anomalies.
    - **2026-10-18 03:58 UTC:** v0.0.258 (#448) and v0.0.259 (#582, docs) released and stay unapplied under
      `auto=stable`; no box moved. STATUS: fleet and server v0.0.244, newest v0.0.259, intent dev/auto=stable, backups
      fleet 131M/server 826M, disk free fleet 212G/work volume 95G/server 32G, no anomalies.
    - **2026-10-18 04:59 UTC:** v0.0.260 (#581) released at 04:01 and stays unapplied under `auto=stable`; no box
      moved. STATUS: fleet and server v0.0.244, newest v0.0.260, intent dev/auto=stable, backups fleet 131M/server
      826M, disk free fleet 212G/work volume 93G/server 32G, no anomalies.
    - **2026-10-18 06:00 UTC:** v0.0.261 (#482, wave 18) and v0.0.262 (#425) released and stay unapplied under
      `auto=stable`; no box moved. STATUS: fleet and server v0.0.244, newest v0.0.262, intent dev/auto=stable, backups
      fleet 131M/server 826M, disk free fleet 212G/work volume 96G/server 32G, no anomalies.

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
  - **2026-10-05 20:46 UTC, the fix's round 2 (question mail 3588), ruled KEEP (answer mail 3589).**
    - **The approved launcher TERM trap measured worse than the base.** Each job and its bash briefly inherit the
      handler, so a TERM that lands then is lost. TERM to the shell alone leaked 18 of 36 runs, against the base's 4
      of 36.
    - **What landed instead:** the worker's round carries the same flag as a FILE (`$vdir/stop`, read at each loop
      top), as `63f1cc15`. That is a different mechanism from the one approved. It was landed and then asked about, and
      the ruling says that next time it is asked first.
    - **Leaked runs, Task 6 base `e92b38cd` against head `63f1cc15`** (24 or more per shape per sha):

      | Shape | Base | Head |
      |---|---|---|
      | INT to the group | 5/24 | 0/24 |
      | INT to the shell alone | 1/24, and the INT was swallowed in 24/24 | 0/24 |
      | TERM to the group | 28/72 | 30/96 (39% to 31%) |
      | TERM to the shell alone | 4/36, and the TERM was swallowed in 32/36 with a dir left in 26/36 | 0/24 |

      The head left no dir in any shape. No shape is worse than the base.
    - **Why keep:** the stopping line judged the round's outcome against the base, and the file is the flag that was
      approved.
    - **Two finishing changes, and then the signal path is closed for this wave:**
      - **Delete the INT handler and its save and restore of the caller's trap.** Dropping it reds nothing, because
        the async launcher lets an untrapped INT end the sweep shell at `wait`, and the exit chain's first entry stops
        the launcher. If the four shapes get worse without it, it is restored and pinned.
      - **Pin the loop-top check by its bound.** Signal a 120-unit sweep once 10 `.pid` files exist, and assert the
        final count stays within a measured slack. If the box cannot separate the two cases, the check is listed as an
        unpinned bound.
    - **To residue (R17):** the TERM-to-the-group leak and the rejected trap.
    - **21:10 UTC, the INT handler is kept after all (status mail 3592, answer mail 3593).** The round's own review
      found the shape that only the handler fixes. Given a caller INT trap that does not exit, a SIGINT to the shell
      without the handler stays unhandled for 15 s or more, leaves the dir, and leaves hundreds of survivors in the
      launch loop. With the handler, the shell dies by INT in under 10 ms. No real caller sets an INT trap today. The
      handler stays as in `63f1cc15`, pinned by that case and by a row that checks the caller's trap is restored after
      a sweep with no signal. Each pin reds when its mechanism is dropped. Interleaved runs measured TERM to the group
      at parity, 6 of 24 on the base against 7 of 24 on the head, which supersedes 39% and 31%.
  - **2026-10-05 21:50 UTC, run 270's README question (mail 3598), ruled A (answer mail 3599).**
    - **The finding:** the whole-branch review found no Critical. Its one Important: #283 (`d12b5aba`, merged after
      the branch's base) added a README sentence describing the update sweep's verify rule. After this wave merges,
      that sentence describes the serial loop. It also leaves out the re-check, the verifying of crash-shaped units and
      the report-ownership skip.
    - **The plan was wrong here:** its "Not in this wave" said README states no such rule, which was true at
      `00f8a193`.
    - **The ruling:** README.md is this wave's one scope exception, for that sentence.
      - The worker first merges `origin/main` locally and pushes. It never uses update-branch, which unbinds the PR.
        `merge-tree` was clean, measured at tip `cc1b6f12`.
      - It then edits the sentence in place, true of every arm that ships. The deliberate-stop pass stays Linux-only,
        and deploy.sh's loop gets no re-check claim.
      - It amends the plan's "Not in this wave" line, and runs the 15 README-pinning files.
      - Task 9's gate runs on the merged tree.
  - **Noise, not this programme's:** `map-build` on `main` went red at `00f8a193` and `4100ae1c`, with five files
    "newly failing under trace". Every test leg was green. At `be93d159` only `boot.test.ts` still failed under trace,
    and at `1eda8630` none did. This belongs to the CI test-selection tooling.

  - **Live effect:** none yet. Both boxes are held by the unacked v0.0.78 fleet row. After the ack, auto moves the
    fleet box straight to the newest release, which now carries waves 9 and 10, and that move runs v0.0.78's sweep
    with wave 10's script. Wave 9's live tmux names are unchanged for every live-alphabet id (review 265, tmux 3.4).
  - **For `stable`:** this programme's macOS reds are fixed on `main`. The promotion still waits on the GPT lane's
    reds and landing-order's merge-deny cases, and on a green `full-suite` on the commit.

- **2026-10-06 01:29 UTC: wave 11's wave-done (mail 3610), re-measured, and the bar committed BEFORE its review.**
  - **The claim:** PR #287 at `33f4eaaa`, re-measured.
    - It is open, not draft and mergeable. Its head equals the fingerprint and the workspace's local tip.
    - It has 19 commits, all with the noreply author and committer. One is a merge: `origin/main` `d12b5aba` merged in
      as `9b3ba1fa`, per the 21:50 ruling.
    - The range against `main` is 17 files, +4036/−326.
    - Run 270 moved `dispatched` → `working` → `awaiting-review`. The direct move was refused `bad-transition`.
  - **What the worker reports:**
    - `suite: red`, `failure: unclear`. The first full sequence of shards had four file reds: `boot` (a long TMPDIR
      socket path), `session-hook` (a known load flake), `ccrc-install` (an `afterAll` timeout at load 28–37) and
      `tmp-sweep` (the known fleet-box `CLAUDE_CONFIG_DIR` case). Each was green in isolation, and none is in a file
      this branch touches.
    - Every gate file is green. `ccrc-update` 502 and `ccrc-doctor` 670 ran as `-t` parts summing to `vitest list`.
      `tsc` exits 0.
    - The scope check prints only `README.md`, the ruled exception (5729 → 5732 lines).
    - Reserve numbers 3987 and 3988 are spent. 3989, 3990 and 3991 are written nowhere.
    - A terminal Ctrl-C is a group SIGINT, which the base already died on within 0.01 s. That closes the 3575
      question: the fix stands for the shell-alone shape and the launch-loop leak.
  - **CI is the arbiter for the four reds:** full run 37399068946 (`mode=full`; the PR's selection was not readable
    through the API) and PR run 37398985082. Both were in progress at 01:29.
  - **Bar for the merge.** The held-out review (clause 14) must find NO confirmed finding of these classes:
    1. **The new sweep's verdict is wrong.** On either platform, it fails an update where every unit stays up, or
       where every stop is one the script passes on purpose. Or a crashed, crash-looping, restarting or never-started
       unit passes it, through the window or the re-check.
    2. **The re-check is not the operator's.** For example: a non-crash-like failure is re-checked; a unit gets more
       than one re-check; re-checks continue past the first that failed; or a unit with no recorded result passes
       without a verify of its own. The ruling is "Re-check once" (D-3983, Readings 17–18).
    3. **A pairing is unprotected.** `main`'s frozen `_upd_sweep` with the new script returns non-zero for a stamped
       or purged deliberate stop, or zero for a crash; that is the move INTO this wave. Or the new sweep with an
       older script (S10 or S0) fails a healthy unit or passes a crash.
    4. **The purged arm passes a crashed, crash-looping or never-started unit, or reads a registry other than the
       fixture's.**
    5. **Doctor says ARMED where the gate is off.** That is, where the unit (Linux) or the launchd job (Darwin) leaves
       the gate off, in any locale. Or a Linux verdict that `main` decides correctly changes to a wrong one.
    6. **A process or a file is left that the ruled residue does not cover.** A verify job outlives its sweep or
       test in a shape other than R17's (TERM to the group in the fork window; the foreground calls). Or a test reads
       or writes outside its fixture HOME, or a real tool can run.
    7. **An out-of-scope write.** That means any file outside the plan's File structure other than README's one
       ruled sentence, and any write to `ccd/ccd`, `deploy/systemd` or a unit.
    8. **A wrong deviation number.** That is, one undefined or unissued, or any definition beyond D-3972 to D-3984
       and reserve numbers 3987 and 3988.

    Also, every Linux leg of full run 37399068946 must be green, or each red must be shown to be a known flake by
    an isolated re-run on CI. The macOS legs gate no merge; I read the cases the wave-done lists myself, and they
    gate the stable promotion.
  - **The rounds:** one bar-class finding gets one fix round, and then a scoped review. A coverage or prose finding
    is fixed in that round if one runs, and otherwise becomes residue.
  - **The worker's seven residue items, ruled now so the review does not resend them:**
    - Item 1 is R17 as ruled, with one prose point: number 3988's sentence "a stale pid is never signalled"
      overclaims a microsecond window.
    - Item 3 is a false operator sentence, which predates this wave but meets D-3984 here. It is the "is FAILED —
      try-restart skipped it and this sweep did not verify it" warning for a unit that this wave then verifies.
    - Both of those are coverage or prose: fixed in a fix round if one runs, otherwise wave 12.
    - Items 2 (pre-existing in the script: an unsearchable registry, and `_reg_purge`'s order), 4 (Darwin), 5
      (wording), 6 (mutation bookkeeping) and 7 (the W21 bound) go to wave 12 as R18.

- **2026-10-06 02:35 UTC: review 281 ruled. Wave 11 meets the bar, and #287 merges.**
  - **The review:** run by `ccrc-pwa-amber-cove` (workflow `wf_e7d29566-e2c`, 38 agents, 0 errors). It ran the
    held-out panel and the five wave lenses on Opus, with three Sonnet refuters per finding and the majority
    deciding. No lens went unverified and none was unexamined. 4 findings were confirmed and 6 refuted.
    - **What the lenses measured beyond the findings:**
      - The frozen sweep is byte-identical to `_upd_sweep` at every tag from v0.0.59 to v0.0.91.
      - A 36-case pairing matrix (OLD+S11, NEW+S11, NEW+S10, NEW+S0) was all correct.
      - About 30 adversarial inputs to the purged arm all fail.
      - A Linux differential of 3000 pairs × 3 locales gave 0 differences against `main`.
      - On Darwin, 125 names × 28 values on bash 3.2 and 4.4: only HISTCMD and OPTIND stop the job, and both are
        refused.
      - Every signal shape matched the worker's tables.
      - 12 no-signal fixtures × 3 runs were byte-identical between head and base.
    - **The four confirmed findings** are all coverage or prose, introduced by the branch, and meet no bar class:
      - F1: D-3984's "was active before" filter cannot go red, because every fixture plants its units as active
        before the restart;
      - F2: the plan's W20 row contradicts the shipped `toBe(-1)`;
      - F3: no case pins the NEW sweep with S10, which was measured correct;
      - F4: the S0 fixture is misnamed as wave 10's script; it is v0.0.79's.
  - **CI:**
    - Every Linux leg of full run 37399068946 and of PR run 37398985082 is green. `full-suite` is red only through
      the macOS legs.
    - The macOS reds, split by owner and re-measured from the job logs:
      - **`ccrc-update` D3 is this programme's, and the defect is my ruling.** The plan's ruling (Task 7's D3) said
        "D3 runs on every platform" with a GNU-only `stat -c %s` shim, which BSD stat refuses. Its `itDarwin` twin D3d,
        on the real `_plat_size`, passed on the same leg, so the shipped code is right on macOS.
      - **`session-hook-merge-deny` is landing-order's**, in that programme's fix round. It is red on `main`'s
        daily too.
      - **`platform-hazards` D-2661's FIFO-EOF case is a flake.** It failed on the full run and passed on the PR
        run's macOS leg at the same tip. The case predates this branch.
    - **The macOS cases the wave-done listed are all green:**
      - E20d, D0–D2, D4, D6–D8 and D3d passed.
      - `ccrc-doctor` passed whole on macOS: 685 tests, 73 skipped, so U4p, U5 and U5l passed.
      - R14(i) recorded that the runner takes C.UTF-8 under bash 5.3.15, where the unpinned reads do not misread. So
        U4n, U4u F2 and G1 cannot go red there; that is the answer R14(i) asked for.
  - **Rulings:**
    - **The merge:** no confirmed finding meets classes 1–8, and every Linux leg is green. By the bar, no fix round
      runs, and #287 merges.
    - **R19, before stable, to residue:** D3 becomes Linux-only, or takes a portable shim; D3d already covers Darwin
      with the real primitive. This is test-only. It lands before `stable` is promoted, with F1 to F4 and R18(e), in
      the first small part of wave 12.
    - **Two refuted signal findings are kept as notes:**
      - In R17: a second SIGINT within about 10 ms of the first cuts the INT cleanup short. One refuter would keep it
        as residue.
      - In R18: if a caller traps a signal other than INT, `wait` returns early, and a run takes about twice as
        long with the right verdict. No caller does this today.

- **2026-10-06 02:39 UTC: #287 merged, and wave 12 opened.**
  - **The merge:** `gh pr merge 287 --squash --admin --match-head-commit 33f4eaaa` made `d2bac7ae` at 02:37:15.
    - Its tree, `f2f134b1`, is byte-identical to the tested tip's. `main` did not move, and the tip already contained
      `main`.
    - Run 270 went `merging`, and closed `done` with `childReclaim: queued`. Run 282 opened first, so the programme
      always had an open run.
  - **Wave 12** is run 282, planned, with block 4068 to 4087 issued at its open. R19 goes first, as a small part, so
    that `stable` waits only on landing-order's merge-deny and a `main` full-suite.
  - **Live effect:** v0.0.92 was released at 02:38.
    - Both boxes run v0.0.91, which the auto policy installed since v0.0.86, with no anomaly.
    - The move to v0.0.92 is the move INTO wave 11, so it runs the OLD `_upd_sweep` with the NEW `verify-service.sh`.
      Review 281 measured that pairing at 0/0/1/1, and Task 4's X-cases pin it.
    - A read-only watcher follows both boxes until each is terminal.

- **2026-10-06 02:45 UTC: wave 12 scoped narrow.**
  - **Scope:** wave 12 is wave 11's test and prose residue: R19 and R18(c)–(e). It changes no shipped runtime code, so
    `stable` waits on it for hours, not days.
  - **Wave 13** takes the live-code residue: item 3's warning, R17, and R18(a)–(b). It also takes the older list.
  - **Watch point:** the first release after v0.0.92 is the first live run of wave 11's NEW sweep, whichever
    programme ships it. The hourly probe watches that move.

- **2026-10-06 04:35 UTC: wave 12's plan committed (`04c977cb`, time fix `bc495fed`), and its readings ruled.**
  - **The planning:** workflow `wf_a11d694f-c70` ran 6 agents and took 110 min. A Sonnet scout measured the anchors at
    `d2bac7ae`. An Opus drafter prototyped every change in its own worktree and measured each mutation row. Three Opus
    lenses (pins, fixtures, scope) gave 23 findings; an Opus reviser applied 22 and made one a reading.
  - **The child workspaces' evidence was gone.** Run 270 closed with `childReclaim: queued`. Its workspace was then
    reclaimed, and so was review 281's, including the review report the close had read. That is the reclamation
    design, not a fault.
    - I recovered run 270's wave-done artifact and review 281's report from this session's own record. Both are in
      the coordinator's worktree under `.superpowers/w11-evidence/`, gitignored, for wave 12's worker.
    - The wave-11 task reports were not recovered.
  - **Rulings** (the plan's last section):
    - Readings 1, 2, 5, 6, 7, 10 and 11 stand as written.
    - **Reading 3:** the wave-11 worker's own row mapping wins over the plan's guess.
    - **Reading 4:** the pgid clause goes to wave 13.
    - **Reading 8:** the re-raise, which I ruled into the live sweep on 10-05, gets its pin now, test-only, with a
      stopping line. It spends reserve number 4072 (bare until defined). T6-INT-W goes to wave 13.
    - **Reading 9:** to wave 13.
    - **Reading 12:** `ccrc-doctor`'s non-auth parts go to CI's selection.
    - **One addition:** Q10, review 281's tenth S10 shape (crash-shaped, `failed`, purged).

- **2026-10-06 05:57 UTC: wave 12's wave-done (mail 3637), re-measured, and the bar committed BEFORE its review.**
  - **Evidence:** copied on receipt into the coordinator's worktree under `.superpowers/w12-evidence/` (gitignored).
    That covers the mail, the task briefs and reports, the review diffs and the gate log.
  - **The claim:** PR #291 at `7b0a5454`, re-measured.
    - It is open, not draft and mergeable. Its head equals the fingerprint and the local tip.
    - It has 8 commits, each with the noreply author and committer, and changes 8 files (+1664/−36), exactly File
      structure's. There is no merge.
    - `main` moved by docs only (`0dad0fdf`, `21f536a5`), touching none of the branch's files. `merge-tree` is clean.
  - **What the worker reports:**
    - `suite: unrun`: no whole server suite ran locally. Every gate file was green, including `ccrc-update`
      (20 + 169 + 313 = 502, equal to `vitest list`) and doctor's auth part.
    - **Every mutation row matched its expected set.** The rows:
      - W17e reds only under the filter's mutant.
      - Every Q case proves S10 by digest.
      - The re-raise pin (reserve number 4072): 8 of 8 green with no mutation, and 5 of 5 red when the re-raise is
        dropped.
      - The wave-11 rows re-measured with the same sets as that worker's.
      - T7-1's isolated mutant, measured for the first time, reds D1 only.
    - The D-number check prints nothing.
    - README went from 5732 to 5735 lines.
  - **CI at 05:57:** full run 37420910246 and PR run 37420844106 were in progress.
    - The PR's `probe-macos` was red on D-2661's FIFO-EOF case. That case belongs to account-connections wave 1, and
      its plan already logs it as OPEN and intermittent. It is the second red in three recent macOS runs, and it
      gates nothing here.
    - `main`'s daily run at `d2bac7ae` was red on macOS through D3, which this wave fixes, and landing-order's
      merge-deny cases.
  - **Bar for the merge.** The held-out review (clause 14) must find NO confirmed finding of these classes:
    1. a change to shipped runtime code: anything under `ccd/`, `deploy/`, `server/src`, `agent/src`, `pwa/` or
       `shared/`, or a unit;
    2. a new or changed pin that cannot red when its guard is mutated, or that passes on the pairing or shape it
       claims to guard. That covers W17e, Q0–Q10 and the re-raise pin;
    3. a test that reads or writes outside its fixture HOME, or a real tool that can run;
    4. S10 not byte-identical to v0.0.91's `deploy/verify-service.sh`, or any edit to the S0 or OLD-sweep fixtures;
    5. README or the amended wave-11 plan stating something false about shipped behaviour or measured red sets. That
       includes an amendment with no dated marker, and a red set recorded as the wave-11 worker's that is not in its
       wave-done;
    6. a case this branch adds or changes going red on macOS on correct code. D3 must be skipped there, and D3d must
       pass;
    7. a wrong deviation number: anything defined beyond D-4068 to D-4071 and reserve number 4072, or 4073 to 4087
       written with the prefix.

    Also, every Linux leg of full run 37420910246 must be green. On the macOS legs, every red must be named and owned,
    and none may be this branch's.
  - **The rounds:** as for wave 11. One bar-class finding gets one fix round, then a scoped review. A coverage or prose
    finding is fixed in that round if one runs, otherwise it becomes residue for wave 13.

- **2026-10-06 06:31 UTC: review 286 ruled. Wave 12 meets the bar; #291 merges once `server 4/5` re-runs green.**
  - **The review:** run by `ccrc-pwa-warm-ridge` (workflow `wf_4dd7d251-566`, 40 agents, 0 errors). It ran the held-out
    panel and both wave lenses. No lens went unverified and none was unexamined. 2 findings were confirmed and 9
    refuted. Its report was copied into the coordinator's worktree under `.superpowers/w12-evidence/` before the
    close.
    - **What the lenses measured:**
      - W17e reds 2 of 65 under the filter's mutant, causally.
      - With `preRestart` absent, all 60 other boxes write listings byte-identical to `d2bac7ae`'s.
      - S10 is `cmp`-equal to v0.0.91's script.
      - A `makeBox` that ignores `verifySrc` reds R2 and Q1–Q10.
      - The re-raise pin was 8 of 8 green with no mutation, at load 31–45, and an `exit 130` mutant reds its five shell
        arms 3 of 3.
      - README's sentence is true of every arm.
      - Every amendment is dated, and every wave-11 red set is quoted in run 270's wave-done.
      - Only D-4068 to D-4071 and reserve number 4072 are defined.
    - **macOS:** D3d passed, D3 was skipped, and no macOS red belongs to the branch.
  - **Rulings:**
    - **F1 (CI):** full run 37420910246's `server 4/5` was red with every test passing (8056). The cause was
      `ccrc-update.test.ts`'s `afterAll(removeTmpFixtures)` timing out at 20 s.
      - The branch adds no fixture to that file, and the PR run's Linux legs are all green.
      - **Ruled:** re-run that one job (attempt 2). Merge only when it is green. The timeout is not widened.
      - The same hook timed out on a shard at `670d25fd` in wave 9, so this is now recurring. It goes to residue as
        R20.
    - **F2 (prose):** the plan's "As built" leaves out the worker's two deliberate citation corrections. The shipped
      citations are the true ones, so this goes to wave 13 as one As-built bullet (R20).
    - **F3:** the PR body gives the `/files` view beside the plan link only. It is cosmetic, and moot once merged, so
      no action.

- **2026-10-06 06:41 UTC: #291 merged; wave 13 opened; and the NEW sweep's first live run was clean.**
  - **The merge:** `gh pr merge 291 --squash --admin --match-head-commit 7b0a5454` made `9221416a` at 06:40:57.
    - Its tree, `a6c85f7c`, is the one `merge-tree` predicted. Every branch file is identical to the tested tip.
    - Every Linux leg of both runs was green, `server 4/5` on its re-run. `full-suite` was red only through landing-order's
      macOS merge-deny cases.
    - Run 282 went `merging`, and closed `done` with `childReclaim: queued`. Run 287 (wave 13) opened first, with
      block 4094 to 4113 issued at its open.
  - **The NEW sweep's first live run.** v0.0.93 and v0.0.94 (#288 and #289, docs) were published at 05:20. The auto
    policy moved both boxes from v0.0.92 straight to v0.0.94, so the move ran wave 11's NEW `_upd_sweep` with S11.
    - **Fleet box:** started 05:33:45. The gate passed at 05:34:45, and the sweep ended at 05:35:08.
      - **That is 23 s for about 48 supervisors**, against about 6 min for v0.0.92's serial sweep at 44.
      - There was no re-check line, no stopped-on-purpose line and no failure.
    - **Server box:** done at 05:35:35.
    - The probe at 06:41 reads both boxes on v0.0.94, with no anomalies.
  - **For `stable`:** this programme's macOS red (D3) is fixed on `main` as of `9221416a`. Three things remain:
    - landing-order's `session-hook-merge-deny` macOS reds;
    - D-2661's intermittent FIFO-EOF case (account-connections wave 1), which can red a macOS leg on its own;
    - a green `full-suite` on a `main` commit.

    The promotion is the operator's to call.

- **2026-10-06 07:07 UTC: wave 13 re-scoped, and the residue mapped to waves 13–19.**
  - **The scoping:** workflow `wf_286a790a-7fa` ran 5 agents in 24 min. Two Sonnet inventories measured 61 queued items
    at `main` `9221416a`. An Opus designer split them, an Opus critic gave nine findings (all applied), and an Opus
    reviser re-measured. The result is copied into the coordinator's worktree under `.superpowers/w13-evidence/`.
  - **The constraint:** claim 1046 (session-continuity wave 4, run 274) holds `ccd/ccrc`, `ccd/ccrc-doctor-checks`,
    `deploy/deploy.sh`, `agent/test/deploy-verify.test.ts` and `README.md`. So every sweep, verify-script and prune
    item waits on that claim (waves 16–19). Claim 1043 has ended, so `ccd/ccd` is free (wave 15).
  - **Wave 13 is R16 + R20, the unclaimed security and CI pair.** I take R16 into this programme, since no other
    programme owns `ccrc-api`.
    - **R16's shape:** `-K -`, a stdin `curl` config carrying `header = "x-ccrc-mail-token: …"`. Two shipped sites
      already use it (`ccd-pool-sync`, `ccd-update-sync`), so the spelling and escaping follow theirs.
    - `ccrc-api` reads stdin for `--body -` before `curl` runs. A case must prove that the two uses do not collide.
    - **The test curl front's `-K -` rule moves into wave 13.** Without it, any contained case that drives `ccrc-api`
      or `notify.sh` through `loopbackCurlFront`, which refuses `-K`, would exit 97, and `notify.sh`'s refusal is
      silent. `containedTools.ts` is unclaimed. The rule admits only `header = "…"` lines and refuses `url`, `proxy`,
      `connect-to` and every other key, with mutation rows.
    - **R20(a):** the cleanup removes only the dirs made inside the current test, and the 20 s timeout is not
      widened. `installTreeFixture.ts` is under claim 1046 and is not edited.
    - **R20(b):** wave 12's As-built bullet.
    - **Risk:** a broken `ccrc-api` breaks every session's mail, claims and ledger calls fleet-wide, within about an
      hour of the merge. The plan's attack gets a lens for that blast radius and one for the config-file parsing.
  - **Ruled now, so no plan re-asks:**
    - **Dropped, measured closed:** R14(d), R4-2, R8i, R9's done items, R10 a/b/d/e/g/h, and R14(e), which was ruled
      not owed. R-D's two halves stay accepted residue.
    - **R4-3 is closed as accepted.** It is a few hundred bytes per SIGKILLed phase, and never read. A new deletion
      sweep inside every update is the larger risk.
    - **T6-INT-W:** wave 16 pins it only if that needs no new seam in shipped code. Otherwise it closes as an
      unpinnable guard, with its measurement.
    - **R17(a) and (b) are closed as accepted residue.** They are bounded at about 8 s, read-only, and at parity with
      the base, and the real sender is a cgroup stop. R17(c) and R18's caller-other-signal note stay as notes. The
      ruling against a third reshape of the TERM trap stands.
    - **Held, unscheduled until each gets a design:** R2 (the lease model), R3, R8a/d/e, R10c's phase design, R10f,
      R10k and the dotted-id reverse maps. R9-R1, R9-F2, R8b, R4-1 and R9-F4 are moot on this fleet, since both boxes
      keep only digested versions. They stay listed because the repo is public.
    - **Never recovered:** the text of R14(c)'s six minors, R8h's row and review 181's F3/F5/F7/F9/F10 lived in
      reclaimed workspaces. They close unless someone re-finds them.
  - **Asked of the operator (none of these blocks wave 13):**
    1. **Reading 9:** a unit that was already crash-looping BEFORE an update and is still down after it: warn only,
       or verify it and fail the update? The 13:58 "Re-check once" text verifies every crash-shaped unit, and D-3984
       narrowed that to units active before.
    2. **Attended first moves:** for waves 16 and 17, which change the sweep and the verify script, should auto be
       held while they merge, with the next move applied from the console while watched? Or should whichever auto
       move comes next be watched?
    3. **R16:** rotate the box token once wave 13 is live on both boxes?
    4. **R15's product shape:** Ack in place on the home screen's halt banner.
    5. **Dotted ids:** look the registry up by sanitised name, or have `ws-add` refuse colliding ids, which narrows
       the id alphabet?

- **2026-10-06 09:30 UTC: wave 13's plan committed (`31f24eac`), and its readings ruled.**
  - **The planning:** workflow `wf_3aff815b-3ef` ran 6 agents and took 140 min. A Sonnet scout and an Opus drafter
    prototyped every change in their own worktrees. Three Opus attack lenses (security and config parsing; fleet-wide
    blast radius and compatibility; pins, containment and the CI hook) gave 14 findings, and all 14 were applied. The
    evidence is in the coordinator's worktree under `.superpowers/w13-evidence/`.
  - **The fact that corrects my 07:07 scope (D-4094): the install spine never placed `ccrc-api`.**
    - `_inst_bins` has no line for it.
    - README's install block links it (`ln -sfn ~/ccrc/ccd/ccrc-api ~/.local/bin/ccrc-api`, "a link follows every
      update"). `deploy.sh agent` copies it.
    - The fleet box holds a copy dated 2026-09-17, byte-identical to `main`'s.
    - So the merge fixes `notify.sh` live on the next release, through the spine. The client is fixed live only where it
      is a link.
  - **Rulings:**
    - **Reading 1:** the operator relinks the fleet box's client once, and the spine line goes to wave 16 (claim 1046
      holds `ccd/ccrc` and README).
    - **Reading 2:** token rotation waits until the client on the box resolves into a release tree at or after this
      merge.
    - **Reading 4:** `ccrc-api`'s `set +x` is a departure, so it spends reserve number 4096 (bare until defined). An
      inherited xtrace printed the token 4 times, measured.
    - **Reading 6:** the test curl front's shared widening is accepted (D-4095).
    - **Reading 7:** the JSON body that still rides argv goes to residue as R21.
    - **Reading 9:** a near-full CI selection is accepted.
    - Readings 3, 5 and 8 stand as written.

- **2026-10-06 11:34 UTC: wave 13's wave-done (mail 3668), re-measured, and the bar committed BEFORE its review.**
  - **Evidence:** copied on receipt into the coordinator's worktree under `.superpowers/w13-evidence/`.
  - **The claim:** PR #295 at `ee5dd409`, re-measured.
    - It is open and not draft. Its head equals the fingerprint and the local tip.
    - It has 7 commits, each with the noreply author and committer. They include a merge of `main` at `26e3318b`, as
      the plan's Task 6 asked.
    - It changes 14 files (+1783/−24), exactly File structure's. The only shipped ones are `ccd/ccrc-api` and
      `deploy/notify.sh`.
  - **`main` has moved since** by `d5f95837` (#292, GPT lane Plan 3b Part A, code) and `4e7cf095` (#285, docs).
    - Neither touches any of the 14 files, and `merge-tree` is clean.
    - #292's `ccd/ccrc` cites `deploy/notify.sh:29`, and that line is byte-identical at the tip.
  - **What the worker reports:**
    - `suite: unrun`. The 30-file gate was green on first runs, including `ccrc-update` (20 + 169 + 313 = 502).
    - All 33 mutation rows matched their listed sets.
    - **Header-arrival proofs** used real curl against a real listener: a GET, a `--json <file>` body, a `--json -`
      body, hostile caller stdin, a drive-through behind the front, and the armed feed route. In every case the header
      arrived and the token was on no argv.
    - The reviewer's `/proc` scan found 0 hits over 8 call shapes, where the baseline client gave 10.
    - **R20(a):** the `afterAll` went from 648 homes (2.48 GB, 3.8 s) to 0. The largest per-test cleanup took 95 ms.
    - Reserve number 4096 is spent on `set +x`.
    - **D-4094 is unchanged:** this fleet box's client is a regular file, so it keeps leaking until the operator
      relinks it.
  - **Bar for the merge.** The held-out review (clause 14) must find NO confirmed finding of these classes:
    1. the token reaches argv, stderr, a file, a log or the transcript on any path of either sender: success,
       refusal, transport failure, `--json -`, or `ccrc-api` under an inherited xtrace. The pre-existing exported-`TOKEN`
       environ case and `notify.sh`'s xtrace, both ruled or recorded, are excepted;
    2. any `ccrc-api` verb family fails to deliver the header or the body to a real listener, or `notify.sh` with a
       token fails to deliver the header, or a caller's stdin reaches curl's config;
    3. the test curl front admits a config or option that can move the connection off the checked URL, read a file, or
       carry a non-header directive, or now passes a previously refused variant. The pre-existing argv `-H @file` and
       `-w @file` are wave 19's;
    4. a new pin that cannot red when its guard is mutated;
    5. R20(a) leaves a home behind at the end of a file, removes another test's home, or widens the 20 s timeout;
    6. a test reads a real token, or reads or writes outside its fixture HOME, or a real tool can run;
    7. an edit outside File structure, including any file claim 1046 holds;
    8. a wrong deviation number: anything defined beyond D-4094, D-4095 and reserve number 4096, or 4097 to 4113
       written with the prefix.

    Also, every Linux leg of full run 37456924516 must be green. On the macOS legs, every red must be named and owned,
    and none may be this branch's. A sender's `curl` on the macOS legs counts as a Linux-class requirement: BSD curl
    must accept `-K -`.
  - **The rounds:** one bar-class finding gets one fix round, then a scoped review. Coverage and prose findings are
    fixed in that round if one runs, otherwise they become residue.

- **2026-10-06 12:26 UTC: review 294 closed (wave 13 at `ee5dd409`); the one fix round sent, by the committed bar.**
  - **Evidence:** the report and the review-done mail (3687) are copied under `.superpowers/w13-evidence/`. The run
    closed `done`, its reviewer held (`review-report-live`).
  - **The panel:** 38 agents on opus·high plus sonnet refuters, 0 dead, 0 unverified lenses, 0 unexamined findings.
    It confirmed 4 distinct minors and refuted 5. All 18 named suites were green at the tip. The tip was re-measured
    unchanged at the end, and `merge-tree` onto `main` at `b3b5a73e` (#294) is clean.
  - **F1 is class 3, so the bar gives one round.** The front's `cfg_ok` is `! printf … | grep -qvE`. When grep cannot
    run, the `!` turns 127 or 2 into a pass, and a `-K -` config with a `url =` line reaches the real curl. The
    review re-measured this.
    - No caller has a grep-less PATH today. But the class names no precondition, and tests build their own stub
      PATHs.
    - `-K` was refused outright at `26e3318b`, so this branch introduced the fail-open. The sibling `allowed()`
      already fails closed.
    - Ruled: the check passes only on grep's exit 1; the front's other tool statuses are audited for the same fold;
      the fix is pinned by two rows and a mutation. Reserve number 4097 is spent only if D-4095's text must change.
  - **Fixed in the round, because it runs:** F2 (the blank-line prose; a trailing blank is stripped and the config is
    re-fed normalised; one pass row pins it) and F4 (number 4096's baseline count is 5; 4 is the T2-6 mutant's).
  - **Not in the round:** F3 is residue R22, the coordinator's. The refuted `~/.curlrc` item is not residue: a writer
    of the user's own curl config can already read the token file. The `@-` body note needs no action.
  - **CI, full run 37456924516:** every Linux leg is green. `test-macos` 2/4 is red with 21 cases in 2 files, measured
    from the job log:
    - `session-hook-merge-deny` (20 cases): landing-order's, already ruled.
    - `ccd-child-reclaim-verb-reflogs` (1 case, `:394`, `purge-refused` on a `.compactions.lock`):
      child-reclamation's (wave 4, #215). This branch touches neither the file nor `ccd/`. Its coordinator
      confirmed it at 12:32 UTC (mail 3692). It is intermittent: the case passed on `test-macos` in the last three
      daily full runs on `main`. It is the purge's lock wait, not the reflog keep, and it is carried to their wave 7.
      If the stable gate needs it green first, the answer is a full re-run, not a code change.
    - BSD curl accepts `-K -`: the senders' cases pass on every macOS shard.
  - **The round's bar** is at the end of the rulings file. It names five classes: the front still fails open; a
    previously admitted config now refuses; a pin that cannot red; an edit outside the round's files or to either
    shipped sender; a wrong number. Every Linux leg of the round's full run must also be green. A class 1 or 2
    finding gets a narrow round 2, the last; coverage and prose become residue.
  - **Routing:** unchanged (Opus·high / Sonnet / workflow off / compact 40). The round is small, and the wave
    returned no evidence for a change.
  - **Noted, not this programme's:** `main`'s push-time `map-build` job has been red since `77c11245` (#286, 08:28).
    `ccrc-install-graphify.test.ts` newly fails under trace. The map is still published.

- **2026-10-06 13:03 UTC: wave 13's fix round 1 done at `77cf2367`, re-measured; scoped review run 297 opened.**
  - **Evidence:** the wave-done (mail 3698), `fix1-report.md` and the worker's own scoped review are copied under
    `.superpowers/w13-evidence/`.
  - **The claim, re-measured:**
    - PR #295 is open and not draft. Its head equals the fingerprint and the pushed tip.
    - One commit on `ee5dd409`, noreply author and committer. It changes 3 files (+101/−9): `containedTools.ts`,
      `ccrc-containment.test.ts` and the plan. Neither shipped sender changed.
    - `main` is not merged, and `merge-tree` onto `main` at `b3b5a73e` is clean.
    - Every Linux leg is green on PR run 37465993934 and full run 37465994132. Their macOS legs were still running.
  - **What the worker reports:**
    - **F1:** `cfg_ok` passes only on grep's exit 1. The audit names seven sites the verdict rests on; `cfg_ok`'s
      grep was the only fold.
    - **`cfg=$(cat)`'s status stays unchecked.** A partial read checks and feeds the same prefix. Refusing on it
      would refuse a closed-stdin `-K -` call that passes at `ee5dd409`, which the ruling forbids.
    - **Pins:** two rows (a grep stub exiting 2; a PATH without grep carrying a `url =` line). Both were red at the
      old front.
    - **Mutation rows:** T1-16 reds exactly those two; T1-17 reds the F2 row; T1-18 reds 25.
    - **No number:** D-4095's text already says every other line is refused, so the fix brings the code to it, and
      reserve number 4097 is unwritten.
    - **F2 and F4** are corrected as ruled.
  - **Routing:** the scoped review gets the held-out panel plus one lens: fail closed, and still pass what passed. It
    runs under the bar in `rulings-run287-fix1.md`.
  - **The dispatch waited on the fleet-wide daily cap** (24 of 24). It went out at 15:34:28 UTC, to
    `ccrc-pwa-plain-cove`.
  - **macOS, measured from the job logs:** on both runs (PR `test-macos` 2/2, full `test-macos` 2/4), the only red is
    `session-hook-merge-deny`'s 20 cases (landing-order's, ruled). Every other macOS leg is green, including the
    shard where child-reclamation's `ccd-child-reclaim-verb-reflogs` failed at `ee5dd409`. That fits its owner's
    reading that the failure is intermittent.

- **2026-10-06 16:03 UTC: scoped review 297 closed clean; wave 13 merged as `8b0547b4` (#295); wave 14's run 299 opened.**
  - **Evidence:** the report and the review-done mail (3715) are copied under `.superpowers/w13-evidence/`. So is the
    worker's whole SDD directory (`sdd-final/`, 27 files), taken before the reclaim queued by run 287's close.
  - **The verdict:** 28 agents, none dead, no unverified lens, no unexamined finding. There is NO confirmed finding of
    the round's classes 1 to 5.
    - Class 1: in 6480 rows per front, under dash and bash, across every grep, cat and stdin failure mode, no
      forbidden config line reached the real curl at the tip. Review 294's F1 reproduces at `ee5dd409` and is fixed.
    - Class 2: with a real grep, the tip and the base give identical results in every row, both senders' shapes
      included.
    - Class 3: T1-16, T1-17 and T1-18 red exactly the rows the plan lists.
    - Classes 4 and 5: only the round's three files changed, and no number beyond 4096 is defined.
  - **Ruled: merge.** The five confirmed findings are coverage and prose, meeting no class, so they are residue R23.
    The one that asked for a ruling (F3) is ruled there.
  - **The merge, re-measured first:** `main` was unmoved at `b3b5a73e` since the review, and PR #295's head was
    `77cf2367`. The repository has no merge queue. Run 287 went to `merging`, then `gh pr merge 295 --squash --admin
    --match-head-commit 77cf2367…` landed `8b0547b4` at 16:03:00. Its tree `154cbb2c` equals `git merge-tree`'s.
  - **The close order:** run 299 (wave 14) opened at 16:03:24, and its block 4266 to 4285 was allocated. Then run 287
    closed `final` as merged at 16:03:30: `done`, released, `childReclaim: queued`.
  - **What reaches the boxes:** the next release carries both senders. `deploy/notify.sh` reaches every home through
    the install spine. `ccd/ccrc-api` does not (D-4094): a box whose `~/.local/bin/ccrc-api` is a copied regular
    file keeps the old client, which leaks the token, until the operator relinks it. The fleet box is such a box. The
    rotation follows the relink.
  - **R22 is now due:** the spec's `ccrc-api-closed.test.ts:289` cite is stale on `main` from this merge.
  - **Found after the merge (16:05 UTC), not this programme's PR:** PR #304 (`ws/ci-cleanup-timeout`, opened 15:33
    from a workflow worktree in the main checkout) makes the same R20(a) change, and it now conflicts with `main` in
    `ccrc-update.test.ts` and `tmpHelpers.ts`. It also touches `ccrc-install-graphify.test.ts`, the file behind
    `main`'s `map-build` red. Reported to the operator. This programme does not edit it.
  - **Claim 1046 has ended** (session-continuity wave 4, run 274), but run 274 is still dispatched and its PR #299
    edits `ccd/ccd` and `ccd/ccrc`. So waves 16 to 19 stay gated, now on #299's landing. Claim 1052 (ccrc-history wave
    1) holds `README.md`, `ccd/ccrc-doctor-checks` and `deploy/deploy.sh`.
  - **Wave 15's run 300** opened at 16:07 with block 4286 to 4295. Both plans are drafted next. Wave 14 dispatches
    only once the operator confirms R15's shape (the 07:07 entry's question 4).

- **2026-10-06 19:01 UTC: wave 14's shape ruled by the operator ("all recommended"), and its plan committed (`053cf1cb5`).**
  - **The planning:** workflow `wf_f9c94b88-140` ran 10 agents (two pipelines, one per wave) in 121 min, with none dead.
    For each wave: a Sonnet scout, an Opus prototyping drafter, two Opus attack lenses, then an Opus reviser. Wave 14's
    lenses were product and state, then pins and scope. Their 17 findings: 13 applied, 4 made Readings. The plan's own
    evidence is in the coordinator's scratchpad, not tracked.
  - **What the lenses changed:**
    - The skew banner's halt arm no longer promises that the console moves the box. It names what follows the Ack:
      auto, or the terminal verbs.
    - Its auto arm uses the dispatcher's own auto path, moved to L0 under D-4266 (`autoPermits`, `carriesUpdateGate`).
    - A halted row says "last tried", never "moving to".
    - The Ack holds per lease, so it cannot be sent twice.
    - The five holder pins left `single-definition.test.ts`, which claim 1056 now holds, for the wave's own
      `update-move.test.ts`.
    - Claims 1048 and 1049 ended, so the banner's rules go in `fleet.css` in place.
  - **Shown to the operator** as mockups in the PWA's own tokens and copy: the Ack's place (its own banner, the release
    banner or the skew banner), Update all disabled or enabled, the skew banner's cases, the wording, amber or red, and
    the three gaps. The operator ruled "all recommended" at 19:00 UTC, and the plan's "Coordinator rulings" section
    records each reading.
  - **The plan is served for the operator's review** from this branch (committed and pushed, so `?ref=` serves it).
  - **Residue R24** takes Readings 11, 12, 13, 15 and 16.
  - **Dispatch waits on the operator's review** of the committed plan. Run 299 stays `planned` until the operator says
    to go, or asks for changes, which become a revision of this plan.

- **2026-10-06 19:58 UTC: wave 14 dispatched (run 299); wave 15's plan committed (`527296ffc`) and held on three claims.**
  - **Wave 14:** the operator reviewed plan `053cf1cb5` on the docserver and said "looks good" at 19:55.
    - The brief (`scratchpad/brief-w14.md`) names the plan commit to cherry-pick, Tasks 1 to 7, and five reviewer
      instructions. Those cover the dispatcher's equivalence, the one Ack, the Ack held per lease, Update all only on a
      halt, and each skew arm's truth.
    - The approved strings are not reworded.
    - **`main`'s moves:** #301, #300, #305 and #290. #290 edits `fleet.css` and `fleet-screen.test.tsx`, but not at
      the ends this wave appends to. The contrast counts are re-measured as `main`'s plus the plan's delta.
    - No live claim touches its files.
    - Dispatched 19:57:43 to `ccrc-pwa-amber-harbor`. Route unchanged.
  - **Wave 15's plan:**
    - **The change:** one line, `systemctl --user enable --no-reload "$1"`, in `ccd/ccd` and byte-identically in
      `ccd/ccrc`'s platform twin (D-4286). It is line-neutral, so no citation moves.
    - **Measured:** the attack lens measured it on a real systemd 255 user manager in a throwaway container. A
      self-heal that repairs a missing link leaves a cosmetic "outdated" state; `enable --now` keeps its one reload.
    - **The lenses:** systemd and pins. Their 11 findings were all applied.
    - **Readings ruled:**
      - Reading 7: the dispatch is held until claims 1057, 1058 and 1055 have ended. A claim that lapses at its cap
        while its PR is open does not count.
      - Reading 1: both files.
      - Reading 2: an unconditional `--no-reload`.
      - Reading 3: accept the cosmetic state. The post-release reload count is my own read-only measurement.
      - Readings 4 and 5: residue R25.
      - Reading 6: land independently; the later lander restamps.

- **2026-10-06 22:18 UTC: wave 14's wave-done (mail 3760), re-measured, and the bar committed BEFORE its review.**
  - **Evidence:** the wave-done and the worker's whole SDD directory (34 files) are copied under
    `.superpowers/w14-evidence/`.
  - **The claim, re-measured:**
    - PR #309 is open against `main` and not draft. Its head equals the fingerprint and the pushed tip.
    - It has 12 commits, each with the noreply author and committer. It changes 23 files, exactly File structure's.
    - `main` has moved to `8d85c7cf4` since #290 (the delegation broker's wave 1, two `ccd`/doctor fixes, and
      `ccrc-install-graphify`'s opt-in to R20(a), which supersedes PR #304's approach). None of those touches the
      23 files, and `merge-tree` is clean.
    - CI: on PR run 37539242567 and full run 37539454072, every finished leg is green. The server shards and macOS
      legs were still running at 22:18.
  - **What the worker reports:**
    - `suite: unrun`; the full run is the arbiter.
    - Every listed mutation row was measured. Four differ from the plan's red sets, each explained, and seven rows
      are new.
    - **Contrast, in place:** `main` is ALL 634 PASS, and the branch is ALL 636 PASS. The two new lines are
      `.halt-banner` at 8.52 dark and 4.94 light.
    - **`dispatch.ts`'s equivalence** was proven by its reviewer against the base. The six update suites are green.
  - **Two reserve numbers spent**, both making the skew banner's auto claim stricter. No approved string changed.
    - Number 4270: the auto arm also needs the node's stamp to read, because the dispatcher refuses an unread stamp
      on every tick. `stampUnread` moves to L0, a second behaviour-neutral delegation.
    - Number 4271: every node must end on one release tag. Otherwise auto would move the leader and widen the skew.
  - **The worker's own rulings:** it did not re-merge `main` at Task 7 (merge-tree is clean, and no overlap). It left
    the standing request that outranks auto as residue.
  - **Bar for the merge.** The held-out review (clause 14) must find NO confirmed finding of these classes:
    1. any input on which `isHalting`, `moveRefusal`, `autoPermits`, `currentOf` or the auto path answers differently
       from the base;
    2. the halt banner says a false thing in a reachable state: a halting node missing; a non-halting one shown,
       including a `failed` + `provenance:` row; or an Ack that can be sent twice against one lease, or whose gate
       differs from Settings' `canAck`;
    3. Update all is enabled while a node halts or disabled while none does, or the sheet hides a halted skip;
    4. a skew-banner sentence that is false in a reachable state: it promises a move the dispatcher would not make,
       or it drops the terminal verbs where the console cannot vouch;
    5. the fleet screen throws or blanks on a malformed row, or polls `/api/updates` more than once;
    6. an operator-approved string changed, a colour rule ungrounded, or the contrast audit red;
    7. a new pin that cannot red when its guard is mutated;
    8. an edit outside File structure, or any claimed path;
    9. a wrong deviation number: anything defined beyond D-4266 to D-4269 and reserve numbers 4270 and 4271, or 4272
       to 4285 written with the prefix.

    Also, every Linux leg of full run 37539454072 must be green. On the macOS legs, every red must be named and owned,
    and none may be this branch's.
  - **The rounds:** one bar-class finding gets one fix round, then a scoped review. Coverage and prose findings are
    fixed in that round if one runs; otherwise they become residue.
  - **Review run 307** was dispatched at 22:20:17 to `ccrc-pwa-brisk-meadow`. It runs the held-out panel plus two
    lenses. One proves the dispatcher's equivalence and builds a truth table of what each surface shows. The other
    renders the screen at phone width in both themes, checks accessibility and contrast, and compares every approved
    string character for character.

- **2026-10-06 22:47 UTC: review 307 closed (wave 14 at `3f5f382c`); the one fix round sent, by the committed bar.**
  - **Evidence:** the report and the review-done mail (3769) are copied under `.superpowers/w14-evidence/`. The run
    closed `done`, its reviewer held (`review-report-live`).
  - **The panel:** 39 agents, none dead, no unverified lens, nothing unexamined. Six findings survived.
    - **Class 1:** the dispatcher's answers at the base and the tip are byte-identical over 2,681,778 inputs. Three
      mutations proved the probe sensitive.
    - **Class 6:** all 16 approved strings match character for character, and contrast is ALL 636 PASS.
    - **Every named suite is green.**
  - **F1 is class 2, so the bar gives one round.**
    - **The input:** an ack commits, its response is lost (a fetch rejection or a proxy 5xx), and the re-poll fails.
    - **The result:** `sendAck` reads `refused`, the row re-arms against the same lease, and a second tap re-acks the
      now-idle row, clearing `requestedTag` and the refusals.
    - **The panel split:** two copies kept 2–1, two refuted 3–0 on the plan's "a refusal re-arms".
    - **Ruled:** a refusal is an answer the server gave; no answer is not a refusal. As with wave 13's F1, the class
      names no precondition.
    - **The rule:** re-arm at once only on a 4xx refusal. A clean 200 holds as now. Any other ending holds until a
      successful read taken after the tap; it re-arms only if that read still shows the same lease. No new string.
      Reserve number 4272 is spent only if D-4267's text must change.
  - **Fixed in the round, because it runs:**
    - F2, class 7: the lease-key pin changes `target` and `startedAt` together, so cases for each alone are added.
    - F3: the Acked button's accessible name follows its visible label, a WCAG 2.5.3 fix. The approved visible
      strings do not change.
    - F4 and F5: comments.
    - F6: a fixture's shape.
  - **Not in the round:** residue R26.
  - **CI on `3f5f382c`:** every Linux leg of both runs is green. The macOS reds are not this branch's:
    `session-hook-merge-deny` (20, landing-order's) on full `test-macos` 2/4, and `ccd-docs-tree` (2, the native Docs
    reader's, #301) on 4/4.
  - **The round's bar** is at the end of the rulings file. Its six classes:
    1. a double Ack on any ending;
    2. an Ack stranded after a fresh read with the same lease, or re-armed on a read that is not fresh;
    3. a regression, or a changed approved string;
    4. a pin that cannot red;
    5. an edit outside scope;
    6. a wrong number.

    Every Linux leg of the round's full run must also be green.
  - **Routing:** unchanged.

- **2026-10-07 01:18 UTC: wave 14's fix round 1 done at `c613f551`, re-measured; scoped review run 311 opened.**
  - **Evidence:** the wave-done (mail 3785) and the worker's SDD directory (`sdd-fix1/`, 40 files) are copied under
    `.superpowers/w14-evidence/`.
  - **The claim, re-measured:**
    - PR #309's head is `c613f551`. That is two commits on `3f5f382c`, both noreply.
    - They change the round's 6 files (+258/−34).
    - `main` (`543777fbe`) is not merged, and `merge-tree` is clean.
  - **What the worker reports:**
    - **F1:** `sendAck` has a fourth word, `unanswered`, for a rejection, any 5xx or a timeout. Only a 4xx refusal
      re-arms at once. An unanswered or unreadable ending holds until the view object changes, meaning a later
      successful read. It re-arms only if that read shows the same lease. Number 4272 is spent on the outcome text.
    - **Pins:** the six endings, the fresh-read re-arm and follow, a mid-flight read, and a screen-level case through
      the real hook. Mutations M1 to M6 and K1, K2 and K7 each red.
    - **F2 to F6** were done as ruled. The approved strings are unchanged.
  - **The disclosed race:** a poll issued while the POST is in flight, served before the commit, can land unrendered
    when the outcome arrives. That read then releases the hold early. The worker confirmed it with the real hook.
  - **My clarification,** sent to the scoped review: a fresh read is one issued after the ack's outcome arrived, never
    one issued mid-flight. So the race is the scoped bar's class 2, or class 1 if it lets a second POST through. The
    review measures it and rules it against the bar. The narrowest fix needs a read-issue signal from
    `useUpdatesView.ts`, which is outside the round's files.
  - **CI on `c613f551`:** PR run 37556126212 and full run 37556157078 were running at send.
  - **Review run 311** was dispatched at 01:33:19 to `ccrc-pwa-plain-river`, after waiting out the fleet-wide daily cap.
  - **`main`'s moves since the review:**
    - #299 (session-continuity wave 4) and landing-order wave 3 have merged.
    - So claim 1046's paths have landed, and waves 16 to 18 now wait on claim 1055 (ccrc-history wave 2) instead,
      which holds `ccd/ccrc`, `README.md`, `deploy/deploy.sh` and `ccd/ccrc-doctor-checks`.
    - Landing-order wave 3 carries "the merge deny's payload cap". Whether it clears the `session-hook-merge-deny`
      macOS reds, a stable blocker, is read on the next full run.

- **2026-10-07 01:47 UTC: scoped review 311 closed (wave 14 at `c613f551`); the narrow round 2, the last, sent.**
  - **Evidence:** the report and the review-done mail (3787) are copied under `.superpowers/w14-evidence/`.
  - **The panel:** four lenses, 34 agents, all verified. Nine confirmed copies reduce to two behaviour findings with
    one root cause, plus three coverage and prose findings.
  - **F1 (class 2, then 1):**
    - **Input:** a read issued before the Ack's outcome (before the tap, or mid-flight) shows the same lease. It
      renders after an `unanswered` outcome.
    - **Result:** it ends the hold, because the hold compares view identity at the outcome. A second POST goes out.
    - **Measured** with the real hook and React's real scheduler (`posts=2`); the control gives `posts=1`. This is
      the race the worker disclosed. Cell (a), a read issued before the tap, fails even the round-1 wording.
  - **F2 (class 1 and 3):** the same release re-arms an `unreadable` Ack. At `3f5f382c` that Ack held on the lease
    (`posts=1`). Now the button shows **Ack** against a lease the server has most likely cleared, so a button that was
    true at `3f5f382c` now shows a false thing.
  - **Ruled:**
    - The fresh-read definition is binding: a read issued after the outcome arrived.
    - `useUpdatesView.ts` and `use-updates-view.test.tsx` are admitted to the round, beside `FleetScreen.tsx`, which
      only the worker's own claim holds.
    - The narrowest signal, shape (a) or (b), takes reserve number 4273.
    - The hook's three callers stay as they are, and the screen still polls once.
    - F3 and F5, the prose about the mechanism this round rewrites, are corrected in it. F4 is the round's pin.
  - **CI on `c613f551`:** every Linux leg of both runs is green. The full run's macOS reds are not this branch's:
    `ccd-docs-tree` and `ccd-docs-index` (the native Docs reader, #301), and `session-hook-merge-deny`
    (landing-order).
  - **The last bar** is at the end of the rulings file. A class 1, 2 or 3 finding after round 2 stops the merge and
    goes to the operator.

- **2026-10-07 02:17 UTC: wave 14's round 2 done at `e4357fb7`, re-measured; the last scoped review, run 312, opened.**
  - **Evidence:** the wave-done (mail 3790) and `sdd-fix2/` (47 files) are copied under `.superpowers/w14-evidence/`.
  - **The claim, re-measured:**
    - PR #309's head is `e4357fb7`: two noreply commits on `c613f551`.
    - They change exactly the six admitted files (+461/−121), under the worker's own claims 1059 and 1067.
    - `main` (`543777fbe`) is not merged, and `merge-tree` is clean.
  - **What the worker reports:**
    - **Shape (a):** `useUpdatesView` carries `seq`, set in the same `setState` as `view`, and `reload()` returns its
      issue number. `HaltRow` calls `onAcked()` inside the outcome callback and holds while `seq < after`. With no
      datable read, it holds on the lease.
    - **Unchanged:** `UpdateBanner` and `SettingsScreen` are untouched, the screen still polls once, and no string
      changed.
    - **Pins:** 16 real-hook cells, 4 lease-fallback cases and 8 signal cases. Mutations R2-1 to R2-8 each red.
    - **The worker's own pre-push probe:** with the real hook, React's scheduler and StrictMode, `posts=1` in every
      cell, against `posts=2` under the round-1 rule.
  - **The last scoped review** runs the panel plus two lenses: every ending against every read timing with the real
    hook, and the hook's contract and callers. A class 1, 2 or 3 finding stops the merge and goes to the operator.
  - **It was dispatched** at 03:13:12 to `ccrc-pwa-swift-mesa`, after waiting out the fleet-wide daily cap.

- **2026-10-07 03:29 UTC: the last scoped review, 312, closed clean; wave 14 merged as `03afca8b` (#309).**
  - **Evidence:** the report, the review-done mail (3793) and the worker's final SDD directory (`sdd-final/`, 47 files)
    are copied under `.superpowers/w14-evidence/`. They were taken before the reclaim queued by run 299's close.
  - **The verdict:** 17 agents on five Opus lenses, with no error, no unverified lens and nothing unexamined. There is
    NO confirmed finding of the round-2 bar's classes 1 to 6.
    - **The probe:** with the real hook, StrictMode and React's real scheduler, 275 cases at the tip, `c613f551` and
      `3f5f382c`. It found no second POST against one lease, no release by a pre-outcome read, and no stranding.
      Review 311's F1 and F2 reproduce at `c613f551` and are fixed at the tip.
    - **The hook** changed additively. `UpdateBanner` and `SettingsScreen` are unchanged, the screen polls once, and
      no string changed.
    - One finding was refuted 3–0: a 2xx hold released by a pre-outcome read showing a NEW lease is the ruled 2xx rule.
  - **Ruled: merge.** The three confirmed findings, coverage and prose meeting no class, are residue R27.
  - **CI on `e4357fb7`:** every Linux leg of PR run 37561003792 and full run 37561003437 is green. I named the macOS
    reds from the job logs' summaries: `ccd-docs-tree` (2, the native Docs reader's, #301) on both, and
    `session-hook-merge-deny` (20, landing-order's) on full `test-macos` 1/4. A `ccd-lifecycle-purge` line that
    matched a grep was a test NAME containing "FAIL", not a failure.
  - **The merge, re-measured first:**
    - `main` was unmoved at `543777fbe` since the review, PR #309's head was `e4357fb7`, and the repository has no
      merge queue.
    - Run 299 went to `merging`, then `gh pr merge 309 --squash --admin --match-head-commit e4357fb7…` landed
      `03afca8b` at 03:28:56. Its tree `f8217ccd` equals `git merge-tree`'s.
    - Run 300 (wave 15) was already open, so run 299 closed `final` as merged at 03:29:11: `done`, released,
      `childReclaim: queued`.
  - **Released** as v0.0.113 at 03:29:52. Both boxes were on v0.0.112 at 03:30 with no anomalies. The PWA change
    reaches the server box by auto. `dispatch.ts`'s change is behaviour-neutral, as review 307 proved over 2,681,778
    inputs.
  - **Rounds spent:** the full review (307), fix round 1, scoped review 311, the narrow round 2 (the last), and scoped
    review 312. Reserve numbers 4270 to 4273 were spent; 4274 to 4285 are unwritten.
  - **Next:**
    - Wave 15 dispatches once claims 1055, 1057 and 1058 have ended.
    - Waves 16 to 18 now wait on claim 1055 (ccrc-history wave 2), not on claim 1046.
    - The docs PR for R22 and R24(e) follows.

- **2026-10-07 09:42 UTC: wave 15 still held; the stable blockers re-read off `main`'s daily run.**
  - **Wave 15:** claims 1055, 1057 and 1058 ended, but their runs re-claimed the same paths. Claim 1070 (run 291,
    child-reclamation wave 6) holds `ccd/ccd`. Claim 1071 holds `server/test/macos-platform.test.ts`. Claim 1072 (run
    302, ccrc-history wave 2) holds `ccd/ccrc` and `README.md`. Under Reading 7's ruling, run 300 stays `planned`.
  - **Waves 16 to 18** wait on claim 1072 for the same reason. The docs PR for R22 and R24(e) waits on it too, because
    R24(e) is README's.
  - **`main`'s daily full run, 37567376733 at `03afca8b`:** every Linux leg is green. Its reds:
    - `probe-macos`: `platform-hazards.test.ts`, D-2661 candidate (b), the output FIFO never reaching EOF. This is the
      known account-connections item, and it has failed every day since 2026-10-04.
    - `test-macos` 1/4: `ccd-docs-tree.test.ts` (2 cases; the native Docs reader's, #301).
    - `map-build`: news from the map build, informational.
    - `session-hook-merge-deny` is gone from the daily run. Landing-order wave 3, which merged before `03afca8b`,
      cleared it.
  - **So stable now waits on:** D-2661 (account-connections), `ccd-docs-tree` (the native Docs reader), and then a
    green `full-suite` on a `main` commit. The promotion is the operator's call.

- **2026-10-07 09:45 UTC: the fleet box's client relinked, under the operator's go ("happy for you to do what's
  necessary"); the argv leak measured closed.**
  - **The act (D-4094's remedy):**
    - `~/.local/bin/ccrc-api` was the 2026-09-17 regular-file copy. It still put the token on curl's argv with `-H`.
    - It is now a symlink to `~/ccrc/ccd/ccrc-api`, which is the release tree's wave-13 client: `-K -` and `set +x`.
    - The swap was atomic: a symlink at a temporary name, then `mv -T`. So no session call could find the file
      missing.
    - The old file is kept in the coordinator's scratchpad for rollback.
    - `whoami` and `mail list` answered through the new link at once.
  - **Measured closed:** a `/proc/*/cmdline` scan over 496 passes, during 40 real client calls and the fleet's own
    traffic, saw 386 `curl` processes. None carried the header on argv.
    - A first scan reported 6 hits. They were the scanner itself, whose own command line held the pattern text. The
      rescan builds the pattern from pieces and excludes itself.
  - **The other sender:** `~/.cc-sessions/notify.sh` was placed by the 2026-10-06 16:19 release with `-K -`, and it has
    no `-H` token line.
  - **No other copy** of the client was found under the home.
  - **Exposure:** `/proc` is mounted without `hidepid`, but the box has one login account, and its one container runs in
    its own pid namespace. So the argv was readable only to this account's own processes. The open question for
    rotation is copies of the value written down: transcripts, scrollback and logs.
  - **Copies of the live value, measured** by reading it into a process and printing counts only: 35 transcript files,
    across 17 of the 19 account homes' `projects` trees, hold it in plain text. A looser scan, for any header with a
    value, found 81 files. The difference is fixture tokens. Each copy is a working credential on disk. Because a
    transcript is model context, each is also a copy that was sent to an external service. Rotation is the only
    remedy: deleting files would edit other sessions' transcripts, and it would not reach what was already sent.
  - **The rotation:** the server reads the token once, at boot (`server/src/index.ts`). A rotation is a new value in
    `deploy/ccrc-mail.token`, placed at the fleet box's `~/.cc-secrets/ccrc-mail.token` and the server box's
    `~/.ccrc/mail.token`, then a server restart. The release lane never touches it. Proposed to the operator, not done.

- **2026-10-07 10:44 UTC: operator ruling: no hand rotation. The box token's rotation waits for an automated feature.**
  - **The operator's words:** "Surely this should be an automated ccrc feature that is handled without intervention",
    then "we can wait for the feature".
  - **Why it is manual today, measured:**
    - The value is made by hand into the gitignored `deploy/ccrc-mail.token`. Only `deploy.sh`'s `ship_secret` places
      it, by copy and `chmod`.
    - `ccrc install` mints and places neither box copy: it excludes the file. It asks for the agent link token by hand.
    - The server reads the token once at boot and accepts exactly one value (`server/src/index.ts:57`). So a change is
      a restart, with a 401 window until the fleet copy matches.
    - The agent cannot write `~/.cc-secrets`, so the server cannot push the fleet copy.
  - **Why waiting is acceptable:** the 35 transcript copies sit in homes that only this box's one login account can
    read, and that account already reads the token file. What the copies add is the value having been sent as model
    context, and any backup of those homes.
  - **Next:** a design (brainstorming, then an HTML spec for the operator's review) for an automated lifecycle of the
    box token, and of the agent link token. Its scope: minted by the server at install, rotated on a schedule and on a
    trigger, an overlap window, a reload without restart, and a fleet-side pull. Its first rotation retires the leaked
    value. Where it runs (this programme or its own) is decided with the spec.

- **2026-10-07 11:01 UTC: correction to the 10:44 entry. The exposure is wider than it says, so the operator is asked to
  re-decide.**
  - **What the 10:44 entry got wrong:** it weighed only who can read the copies on this box. The question is what the
    value opens once read.
  - **Measured:**
    - The fleet box reaches the server through its public HTTPS name. The proxy config on the server box has no
      source-address matcher.
    - A box-token route asked over that name with no credential answered 401 `unauthenticated`. So it is reachable, and
      the token alone admits it.
    - The machine lanes are exempt from the session gate by design (`server/src/auth/gate.ts`, reason 2).
  - **So:** whoever holds the leaked value can use every box-token lane from the internet: mail into a session, run
    open and dispatch (a brief to a worker session), asks, claims and ledger allocations.
    - The known copies are still the 35 transcripts and the model context they were sent as. No outside holder is
      known.
  - **Design consequence:** a fleet pull authenticated by the current token would hand each replacement to whoever
    holds the leaked value. The first rotation would then retire nothing. The handout needs another credential.

- **2026-10-07 11:06 UTC: operator, re-deciding after the correction: "build the feature instead of manual rotation".**
  The leaked value stays live until the feature's first rotation. Design is under way (brainstorming, then an HTML spec
  for the operator's review). Its first wave is to be the smallest one that can retire the leaked value safely.

- **2026-10-15 21:41 UTC: the operator: take the programme to completion. Three rulings, and the order to the end.**
  - **The operator's words:** "ok your goal as coordinator is to take this programme to completion".
  - **Rulings, asked and answered today:**
    - **Reading 9 (wave 16): warn only.** A unit that was crash-looping before an update and is still down after it
      is named by the update and by doctor. It does not fail the update. This keeps D-3984's narrowing: only units
      active before the restart are verified.
    - **Stable: the coordinator promotes.** When a released commit has a green `full-suite` and no before-stable item
      is open, the coordinator fast-forwards `stable` to it and reports. Demotion stays a manual
      `gh release edit --prerelease`. This replaces "the promotion is the operator's call" (2026-10-07 09:42).
    - **The rehearsal's live half: the operator taps, the coordinator watches.** In a quiet window the operator taps
      Rollback and then forward in the PWA on each node. The coordinator measures and records it read-only. The crash
      inside the update window stays covered by the suites and is recorded as not run live. The 2026-09-30 ruling
      stands: the coordinator moves no box.
  - **The coordinator's default for question 2 of 2026-10-06 (attended first moves, waves 16 and 17):** auto moves
    the boxes as for every release, and the coordinator watches the first move onto each, read-only. The health gate
    restores a failed move (exit 4). The operator may still hold auto for either.
  - **Corrected:** the waves table's "gated on claim 1046" for waves 16 to 19 was out of date. That claim ended. Their
    files are now held by other runs: `README.md` by run 468, `ccd/ccrc-api` and `ccd/ccrc-doctor-checks` by run 360,
    and `server/test/ccdWsHelpers.ts` by run 308. Wave 15 waits on claim 1370 (run 433, now `awaiting-review`) on
    `ccd/ccd`, and on run 360's unlanded `ccd/ccd` work.
  - **What is left, in order:**
    1. Wave 15: re-measure its plan against `main`, then dispatch once `ccd/ccd` is free, or once its holders consent
       to a concurrent wave that lands last.
    2. Waves 16 to 19: plan them from a fresh measure of their residue, with Reading 9 ruled.
    3. A PWA residue wave (R24, R26, R27) and the coordinator's docs PR (R7, R22, R24(e), R25).
    4. The held residue, triaged: fixed in a wave, or closed as a documented limitation.
    5. Stable: `main`'s daily full runs failed on 10-14 and 10-15 (38676520249 at `354118383`). The blockers are
       re-measured, then the promotion.
    6. The live exit criteria: the operator's taps above, and wave 3's phone-side checks.

- **2026-10-15 22:11 UTC: the cut to completion. Waves 15 to 19 re-scoped, the residue placed or closed, Reading 7
  re-ruled, and the stable path.**
  - **How it was measured:** a workflow of 7 agents at `main` `a3cebde1b`:
    - an Opus re-measure of wave 15's plan;
    - two Opus censuses of the residue, node side and PWA/prose side;
    - a Sonnet read of the stable gate, and a Sonnet read of the claims and the exit criteria;
    - an Opus planner, then an Opus completeness critic. The critic re-read every closure of kind fixed or moot in
      code and found none wrong. Its corrections are applied below.
  - **Wave 15's plan still holds.** Every anchor holds by its quoted text; only line numbers moved (`ccd/ccd` grew
    from 29868 to 39777 lines). The plan is refreshed against `main` immediately before dispatch.
  - **Reading 7, re-ruled (the coordinator's own ruling).** Another run's unlanded work in a file holds a wave's
    dispatch only when it has a hunk in the region the wave edits. Otherwise it sets the landing order: the wave lands
    last among them, takes either side of the marker line, and restamps. A live claim on the file still needs its
    holder's consent. Measured for wave 15: #410, run 360's branch and run 308's branch have no hunk in either
    platform block (`ccd/ccd` 41-1221, `ccd/ccrc` 70-1250).
  - **The new cut** (it replaces rows 16 to 19; the waves table carries it):
    - **Wave 15:** `--no-reload`, with R25(c) and the code-comment half of R25(a), which become false when it merges.
      Claim 1396 (run 308) holds `ccd/ccd` and claim 1423 (run 360) holds `ccd/ccrc`, so it dispatches on consent.
    - **Wave 16, before stable:** the sweep and the verify script. Item 3's false "is FAILED" warning and the
      stale-pid comment (R18(e), which review 281's ruling tied to stable), Reading 9's sweep half (warn only), the
      pgid clause's comment, T6-INT-W closed as unpinnable, R18(a) (the `-x` test, and a re-read in the verify script
      rather than `_reg_purge`'s order), R18(b), R10j, R8c, R10c(3) and R8g. Claim 1423 (run 360) holds `ccd/ccrc` and
      `deploy/deploy.sh`, with hunks disjoint from these, so it dispatches on consent and lands after run 360.
    - **Wave 17, behind run 360:** `ccrc-api` placed by the install spine and removed by uninstall (with README's
      `ccrc-api` lines, the uninstall paragraph among them), Reading 9's doctor half (a WARN that never FAILs), R10k (a
      refused sweep recorded as a detail word, read by the same WARN), R8f, and the backup prune's R14(a) and R10i.
      Those two moved here because run 360's unlanded branch rewrites `_bak_list`, `_bak_prune` and `_bak_gc`. It
      waits for run 360 to land (claims 1388, 1410, 1423) and for claim 1403 (run 468, #425) on README.
    - **Wave 18:** test containment. `makeCcdHarness` parity, R14(b)'s raw-spawn census, R23(a), (b) and (d). Tests
      only. Claim 1396 (run 308) holds `server/test/ccdWsHelpers.ts`; R14(b) and R23 can go first.
    - **Wave 19, dispatchable now:** the PWA and server residue. R24(a), (b) and (d), R26(a) to (d), R27(a), R27(b)'s
      test half, and B5, the stable flake at `server/test/update-inventory.test.ts:425` (a 50 ms budget). The
      SettingsScreen line (claim 1392) and the `shared/api.ts` docstring (claim 1390) go last, or are cut.
    - **The coordinator's docs PR:** R22, R24(e), R23(c) and (e), R27(b)'s plan half, R27(c), R25(b), R25(a)'s plan
      sentence, README's Reading 9 clause, and the closure sentences below. Its README half waits for #425 (claim 1403).
      #384 is a merge partner on README and CLAUDE.md.
  - **Closed as fixed,** re-read in code: R1, R5 and R6 (wave 7); R7, R11, R4-2, R8i, R9-F1, F6 and F8, #214's macOS
    reds, and R10a, b, d, e, g and h (wave 9); R12, R13 and R14(f) to (j) (waves 10 and 11); R14(d); R15 (wave 14); R16,
    R20 and the curl front's `-K` rule (wave 13, with #403 automating the rotation); R18(c), R18(d)'s bookkeeping and
    R19 (wave 12); and the live audit's A, B, C, D, F(1), F(2), F(4), G1 and G2 (wave 8).
    - **Defect A** is closed: wave 8 writes each move's source (auto or requested) as an `update` feed row in
      `coord.db`. `update.json`'s `from: pwa` is the spec's §10, by design. The monitoring notes stop calling it a
      defect.
  - **Closed as moot:** E (wave 8's ruling), R4-1, R8b, R9-R1, R9-F2 and R9-F4 (both boxes keep only digested versions).
  - **Closed as documented limitations,** each with a sentence in the docs PR. This overturns the 2026-10-06 07:07
    "held, unscheduled until each gets a design" for every item it named except R10k, which goes to wave 17:
    - R2 (the lease on a rekey), R3(a) to (c) and the reused pid, R4-3, R8a, R8d, R8e, R10c(1) and (2), R10f, R14(e),
      R17, R18's caller traps, R21, R24(c), R-D and R-B (wave 9's accepted residue), F(3), G3, H (box config), and the
      dotted-id reverse maps, with question 5 of 2026-10-06.
    - Never recovered, and closed: R8h, R9-F3, F5, F7, F9 and F10, and R14(c).
  - **Carried constraints M1 to M7 and the trust-roots note:** read as handled by wave 4 and README's trust-roots
    passage. The docs PR confirms each one and marks the section closed.
  - **The final-rollout row, changed:** `ccrc rollout` becomes auto convergence plus a read-only `ccrc rollout --check`,
    because the coordinator moves no box (2026-09-30).
  - **The stable path.** `full-suite` needs every Linux leg, node-floor, build-pwa, typecheck and the four `test-macos`
    shards. On 10-15's daily run (38676520249) everything else was green. Four things stand before a promotion:
    - B1, `ccd-child-reclaim-row-generation` (two macOS cases), the child-reclamation programme's;
    - B2, `ccd-docs-tree` row 64 (macOS), the native Docs reader's;
    - B5, in wave 19; and wave 16, for R18(e).
    - The coordinator mails B1 and B2 to their coordinators. The first promotion follows the first released commit with
      a green `full-suite` after those land; the final one follows the release that carries the last wave and the docs
      PR.
  - **Parked until after completion:** Dependabot #367 and #368, the verifier's `@sigstore` majors. They must land
    together, and they need node 24.15 or later on both boxes (both run 24.14.1) and an engines raise.
  - **The live exit criteria:**
    - The rehearsal: the operator turns auto off, taps Rollback and then forward on each node, fleet first, and turns
      auto back on. The coordinator reads `ccrc versions`, `update.json`, `ccrc rollout --check` and the feed rows
      before and after each move.
    - Wave 3's phone-side banner and push, on the release after the final promotion.
    - The fixture-only criteria, W5's fixture rehearsal among them, cited from the `full-suite` run that promotes
      stable.
    - The W1 spike's answer, recorded from its plan and #161.

- **2026-10-16 10:14 UTC: waves 15, 16 and 19 planned and cleared to dispatch; the consents; three new residue items.**
  - **Consents:**
    - The delegation programme (run 360): wave 15 yes, and wave 16 yes, fenced. The fences: prune_backups changes
      only its KEEP validation; the wave stays out of run 360's ccd/ccrc and deploy.sh regions; it lands second, by
      merge. Any later change to what that pruner deletes must keep run 360's protected sets.
    - The session-continuity programme ratified wave 15's ccd/ccd change, and its claim's holder consented, to exactly
      `--no-reload` plus the two platform-block comments. That claim (1396) has since ended. Never rebase, force-push or
      update-branch; absorb `main` only on a permitted trigger; restamp with the supported tool and verify.
  - **Wave 15 (run 300):** the plan is `527296ffc` plus the re-measure `ca3abb150`. Its scope adds R25(c). R25(a)'s
    code-comment half moves to wave 17, because `deploy/deploy.sh` is under run 360's claim.
  - **Wave 16 (run 484, block 5135 to 5154):** plan `0f07ddcb9`. A workflow wrote it (a Sonnet scout, an Opus
    drafter prototyping red-first, three Opus attack lenses and an Opus reviser). The coordinator ruled its readings,
    taking Reading 6 against the recommendation: freeze the pre-wave-16 verify script and pin the newer sweep against
    it, because an unattended rollback pairs the two.
  - **Wave 19 (run 483, block 5115 to 5134):** plan `8fe4b7cee`, written by the same workflow shape. Its readings
    are ruled as recommended. Claims 1474 (`store.ts`) and 1471 (`shared/api.ts`), both run 360's, hold Task 2's
    store half and Task 7 until that programme consents; without consent, each is cut, never deleted.
  - **Residue added (wave 19's Readings 11, 14 and 16):** R28, R29 and R30, listed below.
  - **Stable blockers:**
    - B1: the child-reclamation programme found the cause (Homebrew's `flock` refuses `-w 0`). Its fix is PR #429,
      test-only, with a full run dispatched on the branch. A pull request skips `test-macos` since #413.
    - B2: the operator authorised the native Docs reader programme's diagnostic, a test-only throwaway branch plus one
      full run. No repair has been chosen yet.

- **2026-10-16 10:52 UTC: wave 15 reviewed and accepted (run 300, PR #441 at
  `9888457bc`); it waits for its landing slot.**
  - **Wave-done** (5453): scope exactly the consents (`ccd/ccd` at the marker, :866, :881 and :882; `ccd/ccrc` at :895,
    :910 and :911), line-neutral, restamped, mutation rows T1-0 to T1-5 measured, reserve unspent. `suite: unrun`: the
    plan's gate files only, all green. PR CI ran the four key files, green. Its one red, `pools-prose`'s README-size
    ratchet, is base-red and fixed on `main` by #440.
  - **Review run 510:** the held-out panel plus a systemd and fleet-blast-radius lens, 37 agents, no unverified lens,
    no unexamined finding. All 15 suites green at the tip, every mutation row reproduced, scope, marker, modes and
    platform parity hold. Six panel claims were refuted 3/3, all superseded by the plan's 2026-10-16 section.
    - **F1 (minor, prose):** the plan's Tech Stack says node `>=22.13.0`; the packages say `>=22.16.0`. **Ruled:
      residue R31**, fixed in the docs PR. A docs push now would move the reviewed tip for one token.
    - **The lens's one behaviour note,** judged no regression: if a spine dies between `_inst_units` and
      `_inst_enable`, newly placed units now stay unloaded until the next explicit reload, where the next supervisor
      restart used to load them, possibly half-placed. `deploy.sh`'s comment naming `_svc_enable` as a reloader is
      R25(a)'s half, in wave 17.
  - **Landing:** after #410, run 360 and #435, by the consents. Then the worker merges `main` (never a rebase),
    restamps, re-runs the gate, and sends a fresh wave-done. The worker holds at `9888457bc` until the landing mail.

- **2026-10-16 12:53 UTC: wave 19 reviewed and accepted (run 483, PR #443 at `95aa8f3bf`); B2 diagnosed, its repair
  authorised.**
  - **Wave-done** (5458): `suite: green`. The whole pwa package was green on its first full run (6627 tests), all 8
    tasks landed and none was cut, and the reserve is unspent. The two consented spans held: `rowHalts`' body plus an
    import, and the `PROVENANCE_DETAIL_PREFIX` comment. PR CI is all green.
  - **Review run 511:** the held-out panel plus PWA and server lenses. No lens was unverified, 4 findings survived, all
    minor, no behaviour defect, and 5 were refuted. The rulings:
    - **F1:** `rowHalts`' docstring is kept as shipped. The consent's fence (body only) governs, and the old text is
      still true. Naming `isHaltingUpdate` in it is residue R33(a), for when `store.ts` is free.
    - **F2:** `fleet-screen.test.tsx`'s "marked seen" assertion was narrowed to `[role="status"]`. D-5124's
      always-mounted announcement region forced it, and the test's comment says so. It is accepted as part of D-5124's
      footprint, recorded here, with no plan addendum.
    - **F3:** the measured red sets are supersets of the plan's table. Every listed case is among the reds: T4-1 reds
      2, T4-2 2, T4-3 5, T4-5 4 and T4-7 2. `update-halt-controls` has 15 cases (two were added: T4-8's survivor and
      T4-12), and the package has 6627. Accepted. The plan's table stays as the drafting record.
    - **F4:** B5's comment (`update-inventory.test.ts:415-416`) names `expired()` where the deciding path is
      `deadline.race`'s null. The case keeps its meaning, and T1-1 still reds it. Residue R33(b), one line, in the
      docs PR.
  - **B2** (the native Docs reader programme's diagnostic, run 38893503016): on Darwin the helper's `_stop` gets EPERM
    from its first `killpg(SIGTERM)`, the error escapes before `Spawned` returns, and row 64 reads `unreadable`. Public
    XNU source fits an existing zombie-only group answering EPERM; that is unconfirmed for the runner. The operator
    authorised that programme's repair through its own plan, wave, review and merge. The coordinator offered a
    reap-before-signal shape as input; the shape is theirs.
  - **Residue added:** R32 (wave 16's worker: when an update dies, `_upd_sweep_die` exits before Reading 9's naming
    loop, so a prior unit gets no line on that path) and R33.

- **2026-10-16 12:57 UTC: wave 19 merged; wave 16 reviewed (review 512) and sent back for a narrow fix round.**
  - **Wave 19 merged:** #443 as `a6b2606c9` at 12:54:37. Its tree `ab199a1bd` equals `git merge-tree` of the reviewed
    tip `95aa8f3bf` onto `main` at `179f7b184`. Run 483 closed final, workspace released. B5 is off the stable list.
  - **Wave 16's wave-done** (5460): PR #444 at `e2c48be75`. `suite: unrun`: the whole server suite timed out one shard
    at load 18, and every named file is green. Reading 6 (b)'s frozen script is pinned by digest (S15, P0 to P7).
  - **Review run 512:** six findings, one important. Every suite green at the tip; seven mutation rows re-measured and
    red as listed; no fenced region touched. The rulings:
    - **F1 (important):** the pre-landing push and wave-done went against the plan's Task 8 Step 1. **Ruled licensed**
      by the coordinator's dispatch brief. The post-landing merge and re-gate prove the landed tree.
    - **F2:** `deploy.sh`'s KEEP regex accepts non-ASCII digits under a UTF-8 locale. It fails safe there. `_keep_ok`,
      which D1c pins equal and which sits in run 360's fence, ends the script on the same input through `10#`.
      **Residue R34, for wave 17, both spellings at once.**
    - **F3:** the D-5136 warnings say only a supervisor active before the restart is verified, but the sweep, as Reading
      1 (a) rules, verifies any unit not in `prior`. **Fix now.**
    - **F4:** J6's header claims a reap before any assertion, but a failed marker assertion skips the kill and the reap.
      **Fix now** (a `finally`).
    - **F5** (a commit message) and **F6** (two dated specs' approximate anchors): no action.
  - **The order from here:** the worker fixes F3 and F4 and pushes. When run 360 lands, it merges `main`, re-gates and
    sends a fresh wave-done. One scoped review then covers F3, F4 and the merge, and only then does it merge.

- **2026-10-16 13:05 UTC: B2's repair is planned by its owner, and wave 15 consents to its `ccd/ccd` edit.**
  - The native Docs reader programme accepted the repair (its reply on run 413). It runs through its own
    plan, wave, held-out review and merge, with the CI it needs, and no Darwin skip. It does not assume that a
    reap-before-signal shape is enough.
  - The repair edits `ccd/ccd` inside `_docs_py`, the Docs helper (`_stop` at `ccd/ccd:36730` on `main`). Claim 1478,
    wave 15's, holds that file. The coordinator gave wave 15's consent (mail 5475), under the re-ruled Reading 7:
    wave 15's unlanded hunks are line 2 (the generated marker) and lines 866, 881 and 882 (`_svc_enable`), so the
    regions are disjoint, and the claim sets only the landing order.
  - **Landing order:** whichever merges first goes first. The other merges `main`, re-runs `ccrc restamp`, and
    re-gates; the marker is never merged by hand. B2 does not wait for wave 15, which lands after #410, run 360
    and #435.

- **2026-10-16 13:15 UTC: wave 16's fix round 1 is done, and run 484 waits at `awaiting-review` for run 360.**
  - The wave-done (5478) puts PR #444 at `9c355b049`: `cd0d1d29e` fixes F3 (both D-5136 warnings now name the units
    that are never verified, and `ccd/ccrc` stays at 24083 lines, every line in its place) and `9c355b049` fixes F4
    (J6 kills and reaps in a `finally`). The worker reds each new wording and the old J6 by mutation, and restores.
  - `suite: unrun`; every named file is green: deploy-verify 105, `ccrc-update`'s seven parts (506 titles), the sweep
    window, Darwin helper, deliberate-stop and versions-warn files (109), and single-definition, typecheck-tests and
    topology-clean (652). No D-number spent.
  - The coordinator re-measured the branch: the tip is `9c355b049`, the two commits change four files, and it merges
    cleanly onto `main` at `a6b2606c9`. The server accepted the advance to `awaiting-review`.
  - **Unchanged order:** when run 360 lands, the landing mail; the worker merges `main`, re-gates and sends a fresh
    wave-done; then one scoped review of F3, F4 and the merge; then the merge.

- **2026-10-16 18:00 UTC: wave 18 opened for planning; the probe's auto rule reads the intent.**
  - **Wave 18** (test containment) is the one wave nothing blocks. Run 517 is open, `planned`, with block 5247 to
    5266. A plan workflow (`wf_21fbd9dc-804`: a scout, a drafter that prototypes red-first in its own worktree,
    three attack lenses and a reviser) writes it from `main` at `256b25ecb`. Scope: the parity the wave 9 plan
    deferred (`makeCcdHarness` and `ghContainedEnv` still pass the real `XDG_RUNTIME_DIR` and
    `DBUS_SESSION_BUS_ADDRESS`, and leave ssh, scp and curl unpoisoned; the plan first measures what is still open),
    R14(b)'s raw-spawn census, and R23(a), (b) and (d). Tests only. 175 test files import the harness, so the plan
    runs each that spawns `ccd` before and after.
  - **The hourly probe** flagged v0.0.212 at 15:58 as unapplied. Under `auto=stable` that is the design: the newest
    stable release is still v0.0.11. The coordinator's probe now reads the `*` intent row's auto mode. Under
    `auto=stable` it flags only a stable release above the fleet box an hour after the last `release-stable` run.
    The mechanism did nothing wrong, and no wave is needed.

- **2026-10-16 21:15 UTC: an operator ruling for wave 16: `deploy.sh`'s `prune_backups` must refuse KEEP=0.**
  - The delegation broker's coordinator relayed it (run 360, PR #448). Its wave 3 makes `deploy.sh`'s server arm
    write the coordination snapshot into the same `<backups>/<ts>` directories that `prune_backups` prunes, and
    that pruner goes by age alone (`sort | head -n -$keep`). At KEEP=0 it removes the directory the deploy has just
    captured; review 518's refuter measured it. Wave 16 at `9c355b049` accepts 0 to 9999 (D-5142). That range is
    right for `_bak_prune` and `_bak_gc`, whose keep sets hold the current operation's directory, and wrong here.
    The operator accepted the age-only pruner for wave 3's soak on one condition: wave 16 refuses 0 there, or never
    removes the newest directory.
  - **Ruled: wave 16 takes it in its landing round,** after #448 lands. The D-5142 test stays byte-equal to
    `_keep_ok`, so D1c is unchanged. A second, separate test on the next line refuses any all-zeros KEEP (0, 00,
    0000) with `[[ $keep =~ ^0+$ ]]`. It is a string test, so a non-ASCII digit never reaches arithmetic (R34). It
    has its own warning, prunes nothing and returns 1, the invalid-KEEP path. The directory selection and the delete
    line stay byte-unchanged, inside run 360's fence (mail 5255). The worker defines it as number 5144, the next
    unspent (bare here until defined), and pins it with deploy-verify rows (KEEP=0 and KEEP=0000 remove nothing, and
    the newest directory survives; KEEP=1 still prunes to one) and a measured mutation row. Answered by mail 5517.
    The head goes to run 360's coordinator with the merge.
  - **The order is now:** #448 lands, then the landing mail: merge `main`, number 5144 with its rows, re-gate, and
    a fresh wave-done. One scoped review covers F3, F4, the merge and number 5144. Then the merge.

- **2026-10-17 00:50 UTC: wave 18 planned, its readings ruled, and dispatched (run 517).**
  - **The plan** is `f9abdcc0e`, alone on this branch. The workflow (`wf_21fbd9dc-804`) ran a scout, a drafter
    that prototyped in its own worktree, and a finisher. Both first agents died when the session slice ran out of
    memory, at 22:09 and 22:34 on 2026-10-16. Three attack lenses (containment, census pins, process) and a
    reviser followed. The reviser ran no vitest, because the slice stayed above 21 GB. Its revised rows are marked
    unmeasured, and the worker measures each first. The plan defines D-5247 to D-5253; the worker's reserve is 5254
    to 5258, and the coordinator holds 5259 to 5266.
  - **Shape:** `makeCcdHarness` asks a new opt-in `net` flag that plants ssh, scp and curl poisons. The user bus
    follows `systemd` in `ghContainedEnv`, set to fixture paths under HOME. A named `stubContainedTool` is the one
    door for a stub. A new raw-spawn census covers both test trees. Plus R23(a), (b) and (d). The prototype measured
    the shape that also plants the network tools for every `systemd` caller at 116 reds in five files, so `net`
    stays opt-in.
  - **Rulings, appended to the plan:** Reading 1 (a), with (b) as the measured fallback; Reading 2 (a); Reading 3
    (a), with the second ring as residue R35(a); Reading 4 (a), and the wave lands after run 360, whose files the
    census counts; Reading 5 (a), R35(c); Readings 6 to 8 as recommended, so CI arbitrates `ccrc-install`,
    `ccrc-update` and `ccrc-doctor`. If wave 15 or 16 lands first, Task 7 re-runs their test files that reach the
    harness.
  - **A correction to wave 16's Reading 9 ruling,** which named wave 18 for widening `sweepFixture.ts`'s Darwin
    helper cases: that file is wave 16's and is not on `main`. It moves to R35(d).
  - **Dispatch:** checked before it, no live claim names a wave-18 file. #435 touches `ccdWsHelpers.ts` in one
    disjoint hunk. Dispatched at 00:50 to `still-delta`; route Opus, high, Sonnet subagents, workflow off,
    compact 40; eight items. The slice read 23.6 GB at dispatch. The plan's memory rules apply: one vitest at a
    time, `--maxWorkers=2`, wait above 21 GB for at most 30 minutes, then CI.

- **2026-10-17 02:55 UTC: wave 18's wave-done (mail 5673), re-measured; review run 535 dispatched.**
  - **The claim:** PR #482 at `b5b83ad66`, eight commits (the plan's cherry-pick, then Tasks 1 to 5 and two
    follow-ups). The worker spent number 5254 (`stubContainedTool` refuses `gh`, whose poison every
    `ghContainedEnv` call rewrites) and number 5255 (the census names its scope and blind spots). Both are defined
    on the worker branch, so they are bare here; numbers 5256 to 5258 are unspent. Reading 1's bus fallback was not
    taken: no file it ran had a bus-caused red. The mutation rows were measured and match.
  - **Not run locally, because of memory:** the importer census before and after (19 batches, 282 files), both
    reach-spy logs, and the gate's shards. The slice stayed above 21 GB except for one brief dip. 28 single files ran
    green at the plan's counts. CI is the arbiter: the PR's `test (server)` and a dispatched full run on the branch.
    No trusted full run exists on `main` at or after the base, so the before is `main`'s next daily.
  - **Re-measured by the coordinator:** the PR head and the handoff commit are `b5b83ad66`. The diff is exactly the
    plan's 11 files. It merges cleanly onto `main` at `0a06ebb9a`. The PR body, the commits and the diff name nothing
    private. Run 517 went `dispatched` to `working` to `awaiting-review`; the server accepted both.
  - **Review run 535** (`swift-cove`): the held-out panel, plus three lenses: containment and silent coverage, the
    census, and measurement and landing. That last lens reads both CI runs and says whether they cover what the local
    census did not. The brief carries the same memory rule as the worker's.
  - **Order:** the review, then the landing after run 360: merge `main`, re-run the census and update its lists,
    re-run the harness files, and a fresh wave-done.

- **2026-10-17 03:45 UTC: review 535 ruled; wave 18's fix round 1 sent (mail 5698).**
  - **The review** (`swift-cove`, at `b5b83ad66`): the held-out panel plus three wave lenses, 93 agents, none died.
    18 findings survived the refuters (three important, F1 to F3) and 6 were refuted. No suite ran locally, because
    the memory gate never opened. CI is green on every Linux leg: the PR's selection (305 of 714 server files, all
    280 harness reachers among them) and a full run on the branch. The full run's only reds are two macOS shards
    that `main`'s daily shares. Run 535 closed `done` on the reviewer's fingerprint.
  - **The findings:** the census misses a command line built by `.join` or `+` (six live sites, none bare today,
    F1); three of its detector arms have no corpus line or mutation row (F2); and the reach-spy logs never ran
    anywhere (F3). The minor ones are more census spellings, the bus gate's `;` and `%` forms, missing red rows,
    a mutation table measured before the tip, and prose.
  - **Before ruling,** three critics checked the draft rulings (rigour, proportion, factual premises; workflow
    `wf_a3883085-0c3`). They found that two of its fixes, done naively, make false hits (one in a file run 360
    holds). They also found that it gave new detector arms no mutation rows, and that it measured the table twice.
  - **Ruled, in plan `3098b03ea`:**
    - **Fix or name.** Fix a census gap when it is live in the tree, when it breaks the header's own promise, or
      when it is a gate this wave created. Otherwise name it. A fix that would touch a claimed file is named. The
      header's claim is restated to the spellings it lists.
    - **Mutation rows.** Every new arm and guard gets a measured mutation row.
    - **F3: the reach-spy run is not a merge gate.** Its safety half is pinned structurally. Its coverage half
      (which tests meet a poison and stay green) is lost for this wave and goes to residue R35(e).
    - **D-numbers.** Numbers 5256 and 5257 go to the census widenings and the bus refusal.
    - **The gate.** The table is re-measured once, at the landing tip, and the full CI runs stand in for the
      local shards.
  - **A correction.** The 00:50 entry, and the plan's first rulings, said `sweepFixture.ts` is not on `main`. It
    is: wave 11 (#287) added it. R35(d) stands for another reason: wave 16 (#444) edits the file.
  - **The order:** fix round 1, a wave-done, then held for #448. Then the landing round (merge `main`, the single
    re-measure, a fresh wave-done), and one scoped review of the round and the merge. That review checks only the
    ruled fixes, the new rows and any new real-tree hit, so it converges.

- **2026-10-17 04:35 UTC: wave 18's fix round 1 done (mail 5726), verified, and held for #448 (mail 5727).**
  - **The claim:** `81bf1f135`, seven commits on `b5b83ad66`. The rulings' cherry-pick, then F4 (number 5257), F10
    and F11, the census (number 5256: F1, F2, F5 to F8, the header narrowed to the spellings it lists), the prose,
    the strays listing, and four fixes from the worker's own review of the round. Number 5258 is unspent.
  - **Measured by the worker:**
    - The census, run standalone, passes all 7 rows. Each new mutation row reds as recorded. Over the whole tree,
      script spawns go from 181 to 191, all ten new ones contained. Hits and the allow lists are unchanged, and no
      claimed file was edited.
    - Vitest, one file per call: the harness, pool-sync, runbook-holds, ccrc-containment, tmux-anchor and census
      files are green. `ccd-workspaces` is 80 of 81: one case timed out at load 20 and passes alone. The vitest
      mutation rows red as ruled.
    - The strays listing took the ruling's second option (no `net`, no assertion), because an assertion there
      measured green.
  - **Pending the landing tip,** because the memory bar never reopened: `typecheck-tests`, `tsc`, the three
    ledger guards, `single-definition`, and the census under vitest.
  - **Re-measured by the coordinator:** the tip and the handoff commit match. The diff is the same 11 files, with
    nothing outside them. It merges cleanly onto `main` at `0a06ebb9a`. Nothing private appears in it. Numbers 5256
    and 5257 are defined. The server accepted `working` to `awaiting-review`.

- **2026-10-17 13:20 UTC: an operator ruling: the coordinator merges the PRs this programme needs, in order; #429
  merged.**
  - **The ruling,** given in chat just after 13:00: "You can merge required PRs in the correct order." It covers
    the PRs this programme's completion needs, including other programmes' PRs on its path that were waiting for a
    merge approval. It does not cover their content acceptance, or plans like #436. A coordinator that already has
    its own merge authority (for #425 and #448) keeps it.
  - **#429 (B1) merged** at 13:20:17 as `5fa7efddc`, squashed with `--admin` and pinned to the head `51c371227`.
    One test file, +7/-2, every check green on its head. Its parent is the measured main `71fb70189`, and its tree
    equals `merge-tree`'s prediction. `main` had not touched the test file or the lock function since its base.
    B1 clears when a full run shows the row-generation case green on macOS. Today's daily run, before the merge,
    still failed it at test-macos 2/4. #434 is superseded by #440 (the same one-line change, merged 10-16).
  - **Main moved** with #483 to #489 since the morning. Against `5fa7efddc`, #444 and #482 merge cleanly, and
    #397, #410, #425, #435, #441 and #448 conflict: #489 in `dispatch.ts`, `single-definition.test.ts` and
    `README.md`, #487 in `README.md`, and #485 in `ccd/ccd`.
  - **The order:**
    1. #429, done.
    2. #397, then #410, after their landing rounds (mail 5889 to path identity's coordinator).
    3. #425, after both, by its own coordinator (mail 5890).
    4. #448, by its own coordinator (mail 5892). Then waves 16 (#444) and 18 (#482), each after its landing
       round and one scoped review.
    5. #435, then wave 15 (#441), the last `ccd/ccd` lander.
  - **#435 is still blocked.** Its review (run 489) was refused on 10-16, because the deployed `ccd` has only
    `haiku` and `sonnet` as subagent classes, and its brief named `opus`. That is still so on v0.0.221. Mail 5891
    told its coordinator that, under clause 14, a route with `subagent=sonnet` does not demote the review panel.
    If #435 stays blocked, wave 15 may land ahead of it, and the second lander restamps `ccd/ccd`.

- **2026-10-17 15:40 UTC: the landing rounds run in parallel; wave 17 opened and planning; B1's full run; B2
  measured.** The operator asked for progress ("everything feels stalled"). Measured against `main` at
  `67f4c17bd`: #444 and #482 merge cleanly. #397, #410, #425, #435, #441 and #448 conflict. #448 is the hub:
  it shares files with #397, #410, #425, #435, #441 and #444. Its fix round 4 is done, and review 563 is
  dispatched. Run 360's claims have lapsed.
  - **Wave 16 (#444):** its landing round starts now, not after #448 (mail 5950). It merges `main`, adds number
    5144 with its rows, re-gates, and sends a fresh wave-done; then one scoped review. After that, whichever of #444
    and #448 is ready first lands, and the other merges `main`. If #444 lands first, the KEEP=0 refusal is in place
    when #448's snapshot ships, which is the operator's soak condition. Mail 5952 told #448's coordinator; it
    may object, and #444 then waits as before.
  - **Wave 18 (#482):** part 1 of its landing round starts now: merge `main`, the single re-measure, a fresh
    wave-done, then the scoped review (mail 5951). It still lands after #448, because its census should not reach
    #448's harness files before #448 has run under it. Part 2 follows #448: merge `main` again, then the census and
    the two delegation files. A clean merge that edits none of its files needs no second review.
  - **Wave 15 (#441)** no longer waits for #435. It lands after #410 and #448, and #435 lands after it,
    restamping `ccd/ccd` (mail 5953).
  - **Wave 17** had no plan. Run 564 is open, with deviation block 5313 to 5332 (bare until defined). A plan
    workflow (`wf_012aef14-576`: a scout, a drafter, three attack lenses and a reviser) drafts it on a projected
    base: `main` with #448 merged, its anchors taken by content, and disjoint from #444, #482 and #441. README's
    `ccrc-api` lines move to the docs PR, so wave 17 no longer waits for #425's README claim. It lands after
    #448, #482, #444 and #441.
  - **B1:** a full run on `main` (39045734294) is the first test of #429 on macOS.
  - **B2** is measured. Row 64 of `ccd-docs-tree.test.ts` fails on macOS because the Docs helper's `_stop` (in
    `ccd/ccd`) re-raises EPERM from `killpg`. Darwin answers EPERM when every member of a group is a zombie.
    `_group_alive` also reads EPERM as alive. The Docs reader programme has opened no repair wave since its
    authorisation, so who repairs it is put to the operator.

- **2026-10-17 15:50 UTC: an operator ruling: this programme repairs B2, as wave 20 (run 566).**
  - **The ruling,** given in chat: "This programme fixes it". It moves the repair the operator authorised to the
    native Docs reader programme on 10-16 to this programme. Mail 5956 told that programme's coordinator, and
    asked for any runner measurements it holds. Its diagnostic branch stays unlanded.
  - **Run 566** is open, with deviation block 5333 to 5342 (bare until defined). Its scope is the smallest change
    to the Docs helper's `_stop`, `_signal_group` and `_group_alive` in `ccd/ccd`. It adds a Linux row that injects
    Darwin's EPERM and a mutation row for each new arm, and leaves row 64 byte-unchanged as the macOS proof. A
    dispatched full run on the branch gives that proof, because a pull request skips `test-macos`.
  - **The plan** is drafted by workflow `wf_dae77d40-97a` (a drafter, two attack lenses and a reviser). Claim
    1557 (run 433, #410's landing) holds `ccd/ccd`. Mail 5957 asked its coordinator for consent to the three
    functions; without it, wave 20 dispatches after #410 lands.
  - **The order:** after #410, then the first ready of wave 20 and #448. Every later `ccd/ccd` lander restamps.
  - **Replies.** #448's coordinator accepts first-ready for #444 with a freeze (mail 5954, accepted by 5960). Once
    either side sends its worker the landing absorb of the other PR, the other does not merge until that PR has
    landed, or until the side that started says it has stopped. #444's current round merges `main` without
    #448, so it is not an absorb. Review 563's ruling is expected between 16:30 and 17:30. #435's coordinator says
    review 489 is closed failed and gives no restart date (mail 5955), so wave 15 stays ahead of #435.
  - **16:05 UTC.** This session restarted at about 16:03, and again at 16:06 a minute after both plan workflows
    resumed: the session slice sits at its 24 GiB cap with 88 pane scopes, and the out-of-memory killer took this
    session as the largest process once its in-process agents grew. Both drafters died with prototypes in their
    worktrees and no plan file. Until the slice has headroom, wave 20's plan is written by the coordinator from its
    drafter's prototype, and wave 17's plan waits; wave 17 cannot land before #448, #482 and #444 anyway. The Docs
    reader programme's coordinator sent its runner evidence (mail 5958). On macOS 26.6.2 with CPython 3.15.0, the
    first `killpg(SIGTERM)` raised EPERM after an overflow, and the error escaped as "spawn: Operation not
    permitted". Why EPERM, and whether any member was live, was not measured, so the plan treats the zombie cause as a
    hypothesis. Path identity's coordinator is still waiting on the holder of claim 1557 before it consents to the
    `ccd/ccd` edits (mail 5962). The full run on `main` failed one shard, `dispatch-live-gate.test.ts`'s D-5238
    pair (an elapsed bound of 18000 against 17000, then an `ok:true`). #489's own PR run passed that file, so its
    failed jobs re-run once the macOS legs finish.
  - **16:20 UTC: wave 20 rides wave 15's branch.** The coordinator wrote wave 20's plan from its drafter's
    prototype (`808f9f549`, D-5333 and D-5334, nothing measured, no attack lenses). Run 566's dispatch was refused
    `cap-daily`: 48 of 48 fleet-wide, with the next slot at 19:19 UTC and the next five from 21:41. Wave 15 (run
    300, #441) already edits and restamps `ccd/ccd` and lands after #410, so mail 5969 gives it wave 20 as an added
    task: Task 1 (the replay rows) now, and the `ccd/ccd` edit on the coordinator's mail once claim 1557's holder
    consents or #410 lands. One scoped review reads the wave 20 commits and the merge. Run 566 stays planned, as the
    record of the plan and its numbers. Mail 5970 points path identity's consent at run 300's worker.
  - **The order for the slots:** at 19:19, wave 16's scoped review, if its landing round's wave-done is in (it
    touches no `ccd/ccd`, so nothing holds it but the review). From 21:41: the review of #441 with wave 20, wave
    18's scoped review, and wave 17's worker once its plan exists.

- **2026-10-17 16:45 UTC: B1 cleared; waves 16, 15 with 20, and 18 verified; D-5238's load-sensitive tests.**
  - **B1 is cleared.** On the full run on `main` (39045734294), `test-macos 2/4` is green (177 files). It was red in
    both of the last two daily runs. `test-macos 3/4` is red on B2's row 64, as expected, and on
    `platform-hazards.test.ts:283` (D-2661's FIFO), which was not red in the last three macOS runs. The failed jobs
    re-run.
  - **The consent.** Path identity's coordinator granted the `ccd/ccd` consent (mails 5967 and 5973), with the
    holder's concurrence. It covers only the Docs helper's `Sys._stop`, `Sys._signal_group` and `Sys._group_alive`,
    plus the restamp, on run 300's branch. Claim 1557 stays theirs, and #410 lands first. The holder named
    obligations: `ccd-id-cap`, `session-hook`'s citations and `archived-expiry-policy`.
  - **Wave 16 (mail 5976), verified at `14839f785`.** The merge of `main` is clean and brought only `main`. D-5144
    sits as a separate statement on line 242, not on the next line, to keep `deploy.sh` line-neutral. Its rows hold,
    and deleting it reds D3 three times. The substitution is accepted. Scoped review run 568 is open, and its
    dispatch was refused `cap-daily`. It goes at 19:21, when a slot frees.
  - **Run 300 (#441, mail 5979), verified at `97493f9b2`.** Three commits on wave 15's unchanged ones: the plan, the
    rows (D-5334) and the fix (D-5333). Every changed `ccd/ccd` line is inside the fence or the stamp, and
    `mark.mjs --check` passes. The rows were measured red first (2 red, 1 green), then green (3 of 3, 187 in the
    file). Mutation rows M1 to M4 each red their expected cases. The obligations are green (session-hook 13,
    archived-expiry-policy 76, ownership 14, mark-check 7), except `ccd-id-cap`, which exists only on #410's
    branch. #441 conflicts with `main` only on line 2, through #485. Full run 39050387114 on the branch is the
    macOS proof.
  - **The ruling for #441's merge after #410:** one merge takes #485 and #410 at once. If line 2 is its only
    conflict, the verb resolves it. No second review is needed if, after it, `ccd-id-cap`, `session-hook`'s
    citations, `archived-expiry-policy`, `ownership`, `mark-check`, `ccd-docs-tree` and both waves' gate files are
    green. Any other conflict gets a narrow review.
  - **Wave 18 (mail 5978), part 1 verified at `aaf923a4b`.** The merge touched none of its 11 files. The census rows
    are re-measured standalone. Its vitest rows are held, because the slice read 24.0 GiB from 15:45 to 16:37; the
    worker runs them when the bar opens. PR CI (39050279614) runs the guards and the census meanwhile.
  - **D-5238's tests are load-sensitive.** `dispatch-live-gate.test.ts` (#489) failed in `server 9/12` on both
    attempts of the full run on `main`. Locally it fails 4 of 16 at `main` and 3 of 16 at #489's own merge commit
    `71fb70189`, at load 20 to 50. #489's PR run passed it at 12:28. It fakes `setTimeout`, but its elapsed bounds
    and the route's wait read the real clock. Unless it is fixed, it can red the stable gate's `full-suite`. The
    owner is the working-state programme (#484 to #489), whose session this coordinator cannot find. It is put to
    the operator.
  - **16:50 UTC: an operator ruling: this programme fixes D-5238's tests.** The route's `waitForMeasuredVerdict`
    counts its own fake `setTimeout` steps and reads no clock. The test's `advance` moves fake time after a fixed 40
    `setImmediate` turns, so under load the route's real I/O falls behind fake time. The fix is test-only: fake
    time moves only while the route is parked on a fake timer, bounded by real time. A new row puts a real delay on
    every read, and its mutation row restores the old flush. It rides wave 16's branch as D-5145 (mail 5982), before
    review 568. Review 568's brief now covers it, and the review waits for that wave-done. No other PR or claim
    touches the file.
  - **17:05 UTC: wave 18's held rows (mail 5988), ruled (mail 5989).** Every row reds as recorded except T1-3 and
    T1-4 (6 of 27, was 4 of 25) and T1-6 (3 of 27, was 1). Each also reds H18-10 and H18-11, fix round 1's D-5257
    rows, which a mutation that stops the fixture pair, or keeps a pair half under HOME, must red. The measured
    sets are supersets, so the plan's T1 table records them as the landing-tip values in one prose commit, with a
    fresh wave-done. `typecheck-tests` timed out twice under load (CLAUDE.md lists it as a load flake). A direct
    `tsc` over the test config and `server/` exits 0, and PR CI 39050279614 is green.
  - **17:08 UTC: D-5145 verified at `eee9001f1` (mail 5990).** One commit on `14839f785`, touching only
    `dispatch-live-gate.test.ts` and the plan. Nothing under `server/src` changed, and no assertion was removed. The
    new real-delay row passes, and it reds with the old flush, which also reds five old cases at load 107. The file is
    17 of 17 three times in a row at load 49 to 65. Before the fix it failed 5 and 4 of 16 at load 42. The advance
    is refused `review-in-flight` while review 568 is open, so that review reads the live tip `eee9001f1`.
  - **17:15 UTC:** wave 18's prose commit `1065b9994` (mail 5992) records the T1 sets as ruled. It touches only the
    plan, and run 517 is advanced at that tip.
  - **18:00 UTC: B2 is proven on macOS.** On the full run on #441's branch (39050387114), `test-macos 3/4` is
    green, so row 64 passes with D-5333. The run's other reds all come from the branch's base, which predates two
    fixes on `main`: `pools-prose`'s README-size ratchet (`server 7/12`, `test-macos 1/4`; fixed by #440) and B1's
    row-generation case (`test-macos 2/4`; fixed by #429). The merge after #410 takes both.
  - **19:21 UTC: review run 568 dispatched** (reviewer still-river, brief queued) in the cap slot that freed at
    19:19:51. It reads #444 at the tip of the latest wave-done, `eee9001f1`, scoped to `e2c48be75..` that tip: F3, F4,
    the merge, number 5144 and D-5145, with the held-out panel and the soak-condition lens. #498 (another programme,
    merged 18:48) adds one `SERVER_CAPS` case to `dispatch-live-gate.test.ts`; #444's merge with `main` is clean, and
    the coordinator re-runs that file on the merge result before it merges #444.
  - **19:30 UTC: review runs 573 and 574 opened** (planned, no slot held). 573 reviews run 300: wave 20's three
    commits on #441 (`9888457bc..` the tip), with the consent fence, D-5334's replay, the macOS proof and a stop-safety
    lens. 574 reviews run 517: wave 18's fix round 1, its merge and its prose commit on #482 (`b5b83ad66..` the tip),
    with a containment lens. Both briefs are written; the cap's next slots free at 21:41 and 21:43, and a one-shot
    dispatches both at 21:42.

- **2026-10-17 20:06 UTC: review 568 accepted wave 16; #444 merged as `13f11b696`.**
  - **The review** (still-river, at `eee9001f1`, the held-out panel and the soak lens, 43 agents, none died): five
    minor findings, three refuted. F3 and F4 of review 512 are fixed, the merge is clean, D-5144's same-line
    substitution is sound, and every named suite is green (one `ccrc-update` load timeout, green alone). CI at the
    tip is green on every leg. Run 568 closed `done` on the reviewer's fingerprint.
  - **Rulings.** F1 (no row pins that a unit absent from the pre-restart listing is still verified) and F2
    (`REAL_BOUND_MS` equals the 20 s test timeout, so the named errors surface as timeouts) go to wave 17 as test
    rows; neither is a defect in shipped code. F3 (the wave 16 plan's two KEEP=0 sentences) goes to the docs PR.
    F4: the operator's condition, "refuses 0 there, or never removes the newest directory", is met by its first
    arm; the clock-skew hazard it found becomes R36, for wave 17, and #448's coordinator is told (mail 6005). F5 is
    added to R34.
  - **The merge.** First ready under the freeze: no absorb of either PR had been sent. `main` was `7f066a117`, the
    merge-tree was clean, and `dispatch-live-gate.test.ts` (which #498 also edits) was 18 of 18 twice on the exact
    merge result at load 23 to 24. Squash with admin, pinned to `eee9001f1`; the merge commit's parent and tree
    match. Run 484 closed `done`.
  - **Stable** now waits on #441 (B2, after #410) and a green `full-suite` on a released commit.
  - **Path identity** was told that #501 (`d48b7008f`) moved `ccd/ccd` under #410 and #397 (mail 6003).

- **2026-10-17 20:40 UTC: wave 17's plan, `3f6aef755`, with its readings ruled.**
  - **How it was written.** Workflow `wf_fdee8558-414`, one agent at a time because the slice sat near its cap: a
    drafter (continuing the dead drafters' prototype on a projection of `main` with #448, #444, #482 and #441), three
    attack lenses in turn (install-doctor 11 findings, prune-keep 5, process 11) and a reviser, which applied 25 and
    declined four with reasons. No vitest ran (the slice read above 21 GB); bash rows measured what they could,
    and the rest is marked unmeasured. The prototype diff is kept outside the repo for the worker.
  - **The design.** `ccrc-api` placed by `_inst_bins` on every role but server (D-5313). `update.json` gains an
    additive `sweep` key (D-5314, D-5315): `ok`, `down: <n>: <ids>` for every unit already activating or failed
    before the restart, `refused: listing|killmode|job-file`, `unverified: relist` and `died: sweep`. A new doctor
    check, `update-sweep`, answers SKIP, PASS or WARN and never FAIL (D-5316). Then R8f, R14(a), R10i, R34, R25(a)'s
    comment half and R35(b) (D-5317 to D-5322).
  - **Ruled in:** Reading 5 (R32's naming loops move above the die, D-5323); Reading 6 option 1 (`deploy.sh`'s remote
    lister skips links, with a D3c row); Reading 12 (on Linux the doctor PASSes a recorded unit only at `active`
    with `NRestarts` 0, because one `active` read is what a crash-looping unit shows between restarts). The other
    eleven readings are accepted as the plan chose. Readings 3, 7 and 8 become residue R37 and R38.
  - **Added:** Tasks 13 to 16, D-5324 to D-5327: review 568's F1 (a W24 row) and F2 (`REAL_BOUND_MS` below the test
    timeout), R36 (the prune keeps its own `$TS` directory by path) and R35(d) (the Darwin job helpers' bash-only
    cases run on macOS).
  - **A correction.** Row 15's history says wave 15 adds R25(a)'s code-comment half. It does not: the projection
    with #441 still carries both stale comments, so the item stays in wave 17 (Task 9).
  - **Dispatch.** Group A (Tasks 1, 2, 3, 5, 8, 9, 10, 13 to 16) starts at dispatch, in the 21:43 cap slot. Tasks 6
    and 7 wait for #448; Task 4 for #448 and claim 1557 (#410); Task 11 for #482.
  - **21:00 UTC: the freeze binds.** #448's landing absorb started (mail 6021, base `27f0a24a0`). Under 5954/5960
    nothing of ours merges into a file #448 shares until #448 lands or its coordinator says the absorb stopped:
    #441 (it shares `ccd/ccd`) now waits on both #410 and #448, and #482 lands after #448 as before. Confirmed in
    mail 6022. #410's landing round (`4a75bff66`) merged an older `main`, so it conflicts on `ccd/ccd` again.
  - **21:45 UTC: three dispatches** in the cap slots that freed at 21:41 and 21:43: review 573 (wave 20 on #441, at
    `97493f9b2`, reviewer calm-delta), review 574 (wave 18 part 1 on #482, at `1065b9994`, reviewer amber-delta) and
    wave 17's worker (run 564, soft-meadow, Group A). The first two calls timed out in transport but had dispatched;
    `runs list` and the queued briefs (mails 6029 to 6031) confirm all three.
- **2026-10-17 22:15 UTC: review 573 ruled; wave 20's fix round 1 sent (mail 6034).**
  - **The review** (calm-delta, at `97493f9b2`, the held-out panel plus a stop-safety lens, 46 agents, none died): six
    findings, four refuted. The consent fence holds, the stamp reads `ccrc-unmodified`, T20-M1 to T20-M4 reproduce
    exactly, and every named suite is green (one `deviation-refs` load timeout, green alone). Run 573 closed `done`.
  - **F1, ruled:** the EPERM absorb applies only at the SIGTERM call (number 5335, from the coordinator's part of
    run 566's block, bare until the plan defines it). At the SIGKILL call it could hide a refusal to stop a live
    member with foreign credentials, and failing loud is the safer error. B2's case meets the zombie leader at the
    first signal, so the fix still covers it.
  - **F2 to F5:** an EINVAL row with mutation T20-M5, a bounded wait in the raced half of case 2, and the plan's
    Reading 2 and case 2 wording.
  - **F6, a correction to the 18:00 entry:** row 64 ran on `test-macos 2/4` of full run 39050387114 (job
    117447659194), not 3/4, and passed there; 2/4 was red only for the row-generation case #429 fixed. On `main`, row
    64 is red on macOS in two of two recent full runs. The full run after #441's landing merge is the second sample.
  - **Merge hazards** the reviewer named for the landing merge: line 2 restamped from the merged tree, a
    `git grep '_signal_group('` for any new caller, `ccd-id-cap` (from #410), and a full run.
  - **22:26 UTC: fix round 1 verified at `c0fe55ee5` (mail 6037); review run 576 dispatched.** Three commits on
    `97493f9b2`, in three files. In `ccd/ccd` only line 2, `Sys._stop` and `Sys._signal_group` changed, the stamp
    reads `ccrc-unmodified` with one marker line, and #441's plan defines number 5335. The worker reports the
    describe red first, then 4 passed, T20-M1 to T20-M6 each red as recorded, and the gate green. Under the fix
    T20-M2 and T20-M3 first measured green, so case 3's fakes now refuse only the SIGTERM; review 576 judges that.
    A cap slot was free (45 of 48), so review 576 went at once (reviewer clear-hollow).
  - **22:45 UTC: review 576 accepted fix round 1** (clear-hollow, at `c0fe55ee5`, the held-out panel plus the
    stop-safety lens, 46 agents, none died). Seven findings, all minor and wording only; none needs a ruling. The
    narrowed absorb holds on every path, the fence and the stamp hold, T20-M1 to T20-M6 each red on exactly their
    recorded cases, the worker's re-aimed case 3 reproduces, and every named suite is green, with the six Docs
    suites run by the reviewer. The one path that returns with a live member (a partial refusal, which `killpg`
    answers with rc 0) predates wave 20; only the docstring's "never hidden" overclaims it. Run 576 closed `done`.
  - **Ruled:** the seven go to the worker now as a wording round (mail 6047), while #410 and #448 have not landed.
    It needs no review run if `git diff c0fe55ee5..` the tip changes only comments, the docstring, plan prose and
    line 2, which the coordinator measures.
  - **22:50 UTC: the wording round, measured at `7bc2d9015` (mail 6049).** One commit on `c0fe55ee5`. In `ccd/ccd` it
    changes line 2 and four lines of `_signal_group`'s docstring; in the test, comment lines only; in the plan, prose.
    The stamp reads `ccrc-unmodified` with one marker line. So it needs no review run, by the 22:45 ruling. Run 300
    is awaiting-review at that tip. #441 waits only for #410 and #448.
  - **23:02 UTC: wave 17's Group A done** (mail 6053): Tasks 1, 2, 3, 5, 8, 9, 10 and 13 to 16 on PR #566 at
    `a695bde11`, each with an Opus task review; merge-tree with `main` is clean. An extra claim (1588) froze
    v0.0.84's sweep copy into a test fixture before `_upd_phase` gained the sweep key, as that pin's own message
    asks; accepted. Ruled (mail 6055): Task 7 Step 5, `deploy.sh`'s lister, goes now, because #448's only
    `deploy.sh` hunk is in its server arm; claim 1557 has ended and #410's only doctor-checks hunk is in
    `_check_pools`, so Task 4 waits only for #448. Full run 39077484519 dispatched on the branch for Task 16.
- **2026-10-17 23:20 UTC: review 574 ruled; wave 18's fix round 2 sent (mail 6059).**
  - **The review** (amber-delta, at `1065b9994`; the held-out panel plus a containment lens, run one agent at a
    time after an out-of-memory kill): eight minor findings, six refuted. The merge touches none of the 11 files,
    the held rows reproduce exactly and the superset is sound, script spawns go 181 to 191 at the ten cited sites
    with hits and allow lists unchanged, and the nine named suites are green; CI at the tip is green. Run 574
    closed `done`.
  - **Rulings, by the fix-or-name rule:** F4 is fixed: `busPath` reads the last `path=` key where libdbus reads
    the first, in a gate this wave created, so a first address with two `path=` keys is refused (number 5258,
    the worker's last reserve number, bare until the plan defines it). F7: the part-1 re-measure at `aaf923a4b`
    is the single landing re-measure, by the 15:40 split; the plan records the split. F2 and F3, changed arms
    with no pin, get corpus lines and mutation rows; F5's shapes, none live, are named; F1, F6 and F8 are prose.
  - **Then** a short scoped review of the round, while #448 has not landed; part 2 follows #448.
  - **23:36 UTC: wave 17's full run 39077484519** (on #566 at `a695bde11`): Task 16's proof is green, because
    `ccrc-darwin-job-helpers` ran on `test-macos 1/4` (11 tests, 9 passed, 2 Linux-only skipped). Two legs are red.
    `server 3/12`: one exact-set case in `ccrc-install.test.ts` (the Darwin arm forced on Linux) does not expect
    `ccrc-api`, a Task 1 miss, sent back now (mail 6066). `test-macos 2/4`: row 64, which is B2 itself, red on
    `main` the same way until #441 lands.
  - **23:40 UTC: wave 18's fix round 2 verified at `f5e311970` (mail 6065).** Three commits on `1065b9994`, in four
    files (tests and the plan); the plan defines number 5258; the merge with `main` is clean. The worker reports
    H18-12 red first, T1-17 and T3-31 to T3-34 each red on exactly their own lines, T1-3, T1-4 and T1-6 now 7, 7
    and 4 of 28 with H18-12 added (recorded by the 17:05 superset ruling), the real tree unchanged, and the gate
    green. Review run 577 is open; the cap is 48 of 48 until 23:56, so a one-shot dispatches it at 23:57.
  - **23:57 UTC:** review run 577 dispatched in the slot that freed at 23:56 (reviewer plain-prairie), at `f5e311970`.
  - **2026-10-18 00:11 UTC:** wave 17's Task 1 miss is fixed at `98bcb882c` (mail 6077): the Darwin-arm exact set
    expects `ccrc-api` for both and fleet and not for server, a grep found no other such set, and Task 16 records
    its macOS proof (run 39077484519, shard 1/4). The worker waits for #448 and #482.
  - **00:25 UTC: review 577 accepted wave 18's fix round 2** (plain-prairie, at `f5e311970`). Four minor findings,
    all plan or PR-body wording; none needs a ruling. D-5258's refusal is exactly as ruled and agrees with libdbus,
    T1-17 and T3-31 to T3-34 red as recorded, the real tree is unchanged, and the eight suites are green. Run 577
    closed `done`. Ruled (mail 6087): the wording and a re-measure of T2-1, T2-2a to T2-2d and T2-5 (their file
    changed in fix round 1) ride part 2, which needs no review if the merge brings only `main`, the census stays
    green with no list change, and the rest is prose. Four pre-existing containment items go to R35(f).
  - **03:05 UTC: #410's landing review has room to dispatch.** Path identity's review run 575 (of run 433, #410)
    was refused `cap-daily` at 48 of 48 and is still planned; its coordinator does not retry on its own. The
    rolling window measured 45 of 48, so path identity was told (mail 6155) that 575 can dispatch, that #441
    lands only after #410, and that #410 at `4a75bff66` conflicts with `main` `9ce0d5310` on `ccd/ccd`'s stamp
    line alone. Their dispatch and their merge stay theirs; they mail when #410 lands.
  - **03:07 UTC: #448 merged (`46c50a9a4`, mail 6157), so the freeze of 5954/5960 ends.** Measured with
    `git merge-tree` against it: #482 is clean; #566 conflicts in six places, all bin lists that #569 grew with
    `ccd-tool-adj`; #441 and #410 conflict only on `ccd/ccd`'s stamp line. Run 517 is back at working, and
    part 2 has gone out (mail 6158). Wave 17 has its Group B claim (now free), its merge of `main` and Tasks 4,
    6 and 7 Steps 1 to 4 (mail 6159), re-read against #448's landed `_bak_*` text. #441 still waits for #410.
  - **03:40 UTC: wave 18's part 2 verified at `d7662ee11` (mail 6161); no review run.** `f6f4ed6b8` merges
    `f5e311970` with `46c50a9a4` and its remerge-diff is empty; `d7662ee11` touches only the plan; the census file
    is byte-identical to `f5e311970`. Ruled (mail 6162): T1-11 holds (it reds more, because `main` added cases). #482
    merges once its required checks are green and F16's comparison is done: AFTER 39094213607 (`mode=full` at the
    tip) against BEFORE 39093762060 (the daily on `46c50a9a4`), both ids in the PR body. The worker runs the
    comparison when I mail that the runs have finished. CodeQL's three test-file alerts go to R39.
  - **04:00 UTC: wave 17's Tasks 4, 6 and 7 Steps 1 to 4 are done at `218fd588a` (mail 6164).** `main` merged as
    `0e62e2767`, its six bin-list conflicts resolved as unions. #448's landed `_bak_*` text matched the plan's quotes.
    Claims 1607 (Group B) and 1608 (Group A, re-declared). Ruled (mail 6165): Task 4 reads `ActiveState` and
    `NRestarts` by name, because `--value` prints them in the manager's order; that fit is D-5328, and the ruled
    outcomes stand. The `mode=full` run it asks for goes out after #482's landing runs, so the two don't compete for
    runners; it covers the Darwin rows D5, D6 and D13.
  - **04:15 UTC: #425 now lands before #397 and #410 (mail 6171, its coordinator).** No PR of ours shares a file
    with #425; the docs PR's README half waits for #425's claim, so this frees it sooner. Path identity's review
    run 575 dispatched at 03:11. Told #425's coordinator (mail 6172): wave 17 waits for #482, not #425, and nothing
    on our side asks #410 to wait for #425.
  - **04:24 UTC: F16 starts, and wave 17's full run is out.** Every server shard has finished in both runs. AFTER
    39094213607 reds one server file, `ccrc-account.test.ts` C3 ("the supervisor recorded no tier pid"). That file
    is 357 of 357 green at the same tip in #482's PR run 39093501177, and in the wave's earlier full run
    38996557605, so I read it as a flake. The worker classifies it in the comparison and re-runs its describe alone
    (mail 6177). Wave 17's `mode=full` run 39096832066 at `dcb9ec8f5` was dispatched (mail 6178).
  - **04:30 UTC: F16 accepted; #482's merge refused; fix round 3.** The comparison (mail 6180): AFTER 754 files and
    40607 tests against BEFORE 753 and 40582, +25, all in this wave's files; `ccrc-account` C3 green locally, and
    `platform-hazards` once on macOS, are flakes; the other macOS reds are `main`'s. Main moved to `36d536c99`
    (#581); on the exact merge result the census, `single-definition`, containment and both `tsc` runs are green.
    `gh pr merge --admin` was then refused by a repository rule, "All comments must be resolved": CodeQL's alerts
    118 to 120 each hold an open thread. Earlier ones were fixed in code (84, by #404) or dismissed by the
    operator (109). Dismissal stays theirs, so the fix is ours (mail 6181): `pat()` escapes every metacharacter, and
    the two shell paths ride the environment as in #404. Then one short scoped review; F16 is not re-run.
  - **04:50 UTC: fix round 3 verified at `f8fa675eb` (mail 6184); review run 585 dispatched (keen-delta).**
    `pat()` escapes every metacharacter; `sh` runs a constant `bash -c` with the ccd path and the snippet in the
    env (alert 119's sources were the fixture HOME inside callers' snippets, not the ccd path); runbook-holds'
    one binding carries `DOCTOR_CHECKS`. D-5259 records it. CodeQL finds 0, and the bot resolved all three threads.
    The review reads only `d7662ee11..f8fa675eb`, centred on `sh`'s `eval` semantics and containment.
  - **04:55 UTC: wave 17's full run 39096832066 (`dcb9ec8f5`) has finished (mail 6189).** Linux is all green.
    The Darwin rows D5, D6 and D13 of the `update-sweep` check pass on macOS 3/4. The macOS reds are `main`'s
    daily's (`ccd-docs-index`, `ccd-docs-tree` row 64, which is B2, `session-hook-turnmark`, `ccrc-doctor`
    delegation-hooks), plus one `main` lacks: `ccrc-codex` L0a. L0a was green on macOS in three earlier runs, and
    the wave touches no codex or lane file; the worker classifies it.
    Classified (mail 6190): no wave 17 hunk is on L0a's path. It is a macOS timing flake from the fixture's two
    writes (R40); the plan records it and the Darwin rows at `71aa0cde4`.
  - **05:10 UTC: review 585 accepted wave 18's fix round 3** (keen-delta, at `f8fa675eb`). 11 of 11 suites green,
    CodeQL 0, selection run 39098296623 green over 662 server files. Three minor findings, all wording: F1 (D-5259
    says both spawns are census script spawns; only `sh`'s is), F2 (the `eval` comment overstates; three differences
    no caller meets), F3 (two env properties unpinned). Run 585 closed `done`. Ruled (mail 6192): F3 is hygiene, not
    a guard, since the panel refuted its containment reading 2/1. So no pin; the comment says so. One comments-and-prose
    round, no review; I measure the diff, and then #482 merges.
  - **05:42 UTC: #482 merged as `65f4b5ab4`; wave 18 is done.** The wording round `75a5af496` (mail 6193) changes only
    `//` lines in `ccdWsHelpers.ts` and the plan's prose. CodeQL was clean with no open thread. `server 9/12` failed
    once, on a vitest teardown error in `collect-switch-lane.test.ts` with all 2860 tests passing, and its re-run was
    green. On the exact merge with `36d536c99`, the census, `single-definition`, containment, `runbook-holds` and the
    test `tsc` were green. Merged with `--match-head-commit`; the parent is `36d536c99` and the tree equals the tested
    merge. Run 517 closed `done` (claim released, child reclaim queued). Wave 17 has Task 11 (mail 6197): merge `main`
    (clean), run the census over its own new spawns first, contain any hit with no new allow entry, then Task 11 and
    Task 12.
  - **05:55 UTC: the docs PR splits in two.** #425 merged at `7284c8501` (mail 6201) and released `README.md`, but
    run 561, the public-tree scrub, took it at once, with `ccrc-account.test.ts`. Part 1 drafts now, from a worktree
    at `main`, by a workflow of read-only drafters and an Opus verifier per group (`wf_c582546b-f9e`); I apply only
    verified edits. Part 2 carries README, R25(a) and (c) (true only once #441's `--no-reload` lands), the two held
    test files' citations and the closure.

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
  - **Added 20:46 UTC, from the Ctrl-C fix's round 2:**
    - **A TERM to the whole process group** still leaks one job in some runs, at parity with the base (6 of 24 on the
      base against 7 of 24 on the head, interleaved). The launcher dies between a fork and that job's `.pid` write, so
      the kill never sees the job. The sender is a unit stop, which TERMs the whole cgroup anyway, and the leaked verify
      is read-only and ends by itself in about 8 s.
    - **Do not retry a TERM trap in the launcher.** It was measured and rejected: the jobs briefly inherit its
      handler, and a TERM to the shell alone then leaked 18 of 36 runs.
- **R18 (wave 11, run 270's wave-done residue; for wave 12).**
  - (a) Pre-existing in `deploy/verify-service.sh`, from the Task 5 review:
    - An unsearchable `~/.cc-sessions`, with no x bit, makes `[ -e ]` and `[ -L ]` fail with EACCES, so a kept row
      reads as purged. One fix is to test `[ -x "$reg" ]` beside `[ -d "$reg" ]`.
    - `_reg_purge` deletes `.stopped` before `.uuid`, so a verify that lands between the two reads an unstamped stop,
      and a deliberate stop fails. The new sweep's re-check covers it; the OLD sweep, on the move into wave 11, does
      not.
  - (b) Darwin:
    - An INT to the sweep shell alone during the shared window is swallowed while bash waits out the foreground
      `sleep`. A group INT, which is what Ctrl-C sends, aborts within 1 s.
    - `_ccrc_job_stayed_up` passes vacuously when it is given no arguments. Every caller guards against that.
  - (c) Wording:
    - README's sentence should say that the crash-shaped verify applies to units active before the restart, and that
      "one shared window" holds for 128 units or fewer, given a scratch dir.
    - D-3977 begins a sentence in lowercase, and one comment line in `ccrc-doctor.test.ts` is too long.
    - The plan says "five helpers", but there are six.
  - (d) Mutation bookkeeping:
    - T5-6 under-lists its red set, and T7-1's respelling is coarse.
    - The rows added in the wave (T4-7, T6-INT2 to INT5, T2-6 and T2-7) are recorded only in the worker's reports.
    - Removing the pgid filter's "TERMed group" exception reds nothing.
  - (e) Item 1's prose point and item 3's false warning, from the 01:29 entry, land here unless a fix round takes
    them.
- **R19 — before stable (wave 11, review 281; for wave 12's first part).**
  - (a) `ccrc-update` D3 runs on macOS with a GNU-only `stat -c %s` shim and goes red there. The cause is the
    coordinator's ruling on the plan. Make D3 Linux-only, or give it a portable shim. D3d covers Darwin.
  - (b) F1: plant a crash-listed unit that was not active before the restart, while another unit is missing. Assert
    it is not verified, with a mutation row for the filter.
  - (c) F2: amend the plan's W20 row to the shipped `toBe(-1)`, with the worker's reason.
  - (d) F3: freeze S10, the script at v0.0.80–v0.0.91, as a fixture, and pin the NEW sweep with it.
  - (e) F4: rename the S0 fixture's prose to "pre-wave-10 (v0.0.79)".
- **R20 (wave 12, review 286; for wave 13).**
  - (a) **CI:** `ccrc-update.test.ts`'s file-level `afterAll(removeTmpFixtures)` (`server/test/tmpHelpers.ts`) can
    exceed vitest's 20 s hook timeout on a CI shard while every test passes. It happened at `670d25fd` (wave 9) and at
    `7b0a5454` (wave 12). Measure what the hook removes and why it takes longer than 20 s, then make the cleanup cheaper
    or spread it out. Do not widen the timeout.
  - (b) **Prose:** wave 12's "As built" section should name the worker's two citation corrections: A9's "(run 270's
    wave-done, residue item 7)", and A19's T6-RERAISE quote of `_upd_sweep`'s INT-handler comment.
- **R21 (wave 13, Reading 7; low).** `ccrc-api` still passes the JSON body on curl's argv (`--data-binary "$body"`).
  The body carries no token, but process listings can show mail bodies and ask answers. Moving it off argv needs a
  temp file, because `-d @-` cannot share stdin with `-K -`.
- **R22 (wave 13, review 294 F3; the coordinator's, after #295 merges).** Spec 2026-09-20 line 45 cites
  `ccrc-api-closed.test.ts:289` for the `EXEC_COMMANDS` pin. Wave 13's Task 2 inserts 13 lines above it, so after #295
  merges the pin sits at `:302`. Re-cite it by content in the coordinator's next docs PR. Specs are on wave 13's
  never-write list, and the cite is true on `main` until the merge.
- **R23 (wave 13, scoped review 297; coverage and prose, for the next wave that touches the curl front).**
  - (a) `containedTools.ts:126-127` and the worker's audit site (c) say a closed stdin passes as an empty config.
    That holds under dash only. Under bash, `cfg=$(cat)` with fd 0 closed hangs, which fails closed: the command
    substitution's pipe lands on fd 0, so cat reads its own output. This is pre-existing behaviour, and macOS's
    `/bin/sh` is bash. Say "under dash", or name the hang.
  - (b) The two new fail-closed rows assert that curl-poison contains the refusal record, not that it holds only that
    record, which is what the ruling asked. This is the older refusal rows' looser pattern.
  - (c) The round appended an aside to the coordinator's Reading 4 ruling (plan:1264): 5 at baseline, 4 for the T2-6
    mutant, citing number 4096. But plan:1280 says the ruling was left as written. **Ruled: keep the annotation.** It
    corrects a count and does not reshape the ruling. Correct plan:1280 to say the ruling carries an aside.
  - (d) A LEADING blank line refuses, as measured, but no row feeds one. The cited row's blank line is interior.
  - (e) plan:1291 says all three new rows carry no URL argument. The F2 pass row carries one.
- **R24 (wave 14, its plan's Readings; for the next PWA wave unless noted).**
  - (a) Settings' release-row Install sends `{all: true}` and stays enabled on a halt. Disable it, and the per-node
    Update, with `updateAllHaltedText`'s line (Reading 16).
  - (b) Staleness after a failed poll is marked on no update surface. Mark it on all of them at once: "as of the last
    read". While a failure stands, the skew arm answers `cli` (Reading 15).
  - (c) The halt banner could list the requests a racing `{all: true}` wrote while the halt stood (Reading 11).
  - (d) The store's `rowHalts` can call `isHaltingUpdate`, and Settings' `caps.includes(UPDATE_GATE_CAP)` can call
    `carriesUpdateGate`. The SQL form stays (Reading 12).
  - (e) README's skew, Update-all and move-sheet passages, and spec §13: the coordinator's docs PR after the merge
    (Reading 13).
- **R25 (wave 15, its plan's Readings 4 and 5; prose, for a wave that may write the files).**
  - (a) Stale prose about `_svc_enable`'s reload: `deploy/deploy.sh:771` (claim 1055 at planning),
    `agent/test/deploy-verify.test.ts:907`, and the telemetry-keepalive plan at :1701.
  - (b) The wave-11 plan's wrong `:21947 / cmd_ensure` anchor.
  - (c) The two platform-block comments: `ccd/ccd:881` says "no start", and `ccd/ccd:866` with `ccd/ccrc:895` says "the
    same call minus the start". They should say the call links the unit without reloading the manager.
- **R26 (wave 14, review 307 and wave-done 3760; for the next PWA wave).**
  - (a) Focus drops to `<body>` when the focused Ack disables on a hold.
  - (b) `server/src/update/resolve.ts:236`'s `autoGateBlockers` spells `!n.caps.includes(UPDATE_GATE_CAP)` inline;
    it could call `carriesUpdateGate`. This is pre-existing.
  - (c) The `PROVENANCE_DETAIL_PREFIX` docstring in `pwa/src/lib/api.ts`.
  - (d) Extra untagged inventory nodes push the skew arm to `cli`. That is the safe direction; say it in the arm's
    comment.
- **R27 (wave 14, scoped review 312; coverage and prose, for the next PWA wave).**
  - (a) The `Number.isInteger(issued)` sub-term of `HaltBanner.tsx:73`'s lease fallback cannot red: no reachable input
    differs. The fallback itself is pinned (R2-6). Remove the sub-term, or pin it.
  - (b) The plan (`:239`, `:1579`) and `halt-banner.test.tsx` (`:316`, `:318`) cite "ruling G", which no coordinator
    ruling is. They should cite round 2's FIX item 1 (`useUpdatesView(0)`).
  - (c) The plan's Task 4 test listing (`:1149-1152`, `:1210-1211`, `:1220`) mounts `HaltBanner` without `seq` and
    with `onAcked=vi.fn()`, unlike the shipped props. Its pre-existing siblings (`:1545-1546`, the Step 6 count) need
    the same correction.
- **R28 (wave 19, Reading 11; for a PWA wave).** When the last halting row's Ack lands, the next poll unmounts the
  whole halt banner and focus falls to `<body>`.
- **R29 (wave 19, Reading 14; the stable path).** The heir-guard case in `update-store-nodes.test.ts` can red by load at
  20 s on the shipped body too, the same class as B5.
- **R30 (wave 19, Reading 16; for a PWA wave).** A background poll that brings a halt disables a focused Install or
  Update, and focus drops to `<body>`. The fix shape is a layout effect keyed on the halted flag.
- **R31 (wave 15, review 510 F1; the docs PR).** The wave-15 plan's Tech Stack (plan:37) says node `>=22.13.0`; every
  package declares `>=22.16.0`, pinned by `node-floor.test.ts`. Also from wave 15's own review:
  `server/test/coord-prhistory.test.ts:41` cites `ccd/ccd:881-884` for unrelated behaviour, a citation already stale
  before the wave.
- **R32 (wave 16's worker; a node wave).** When an update dies, `_upd_sweep_die` exits before Reading 9's naming loop,
  so a unit already down before the restart is not named on that path. Item G shares the path.
- **R33 (wave 19, review 511; the docs PR and a later store fold).** (a) `rowHalts`' docstring could name
  `isHaltingUpdate`; the consent allowed the body only. (b) `server/test/update-inventory.test.ts:415-416`: B5's comment
  names `expired()`, but the deciding path is `deadline.race`'s null (`server/src/pools.ts:65-66`).
- **R34 (wave 16, review 512 F2; wave 17).** `^[0-9]{1,4}$` accepts non-ASCII decimal digits under a UTF-8 locale, in
  `deploy/deploy.sh`'s KEEP check and in `ccd/ccrc`'s `_keep_ok`. `agent/test/deploy-verify.test.ts` D1c pins the two
  as equal. `deploy.sh` fails safe; `_keep_ok`'s caller then fails `10#$keep`. Fix both at once (`[0123456789]`, or
  `LC_ALL=C`), with a non-ASCII row.
  Review 568 F5 adds: D-5144's all-zeros test is ASCII-only, so an Arabic-Indic zero passes both tests; the remote
  `head` then fails and nothing is removed, but `prune_backups` returns 0 and prints no warning.
- **R35 (wave 18, Readings 3 to 5, and wave 16's Reading 9; test containment).** (a) After stable, the second ring:
  about 79 files call `ghContainedEnv` directly and keep the real ssh, scp and curl. About 35 spawns in 10 `ccrc-*`
  files with thin builders keep the real bus too. A later test wave gives each builder `net`, or
  `ccrcContainedEnv`, file by file. (b) Wave 17: the `ccrc-doctor.test.ts` `_box_role` spawn on the census's
  `ALLOWED`, and the sliced members in `ccrc-doctor` and `ccrc-install`, get `ccrcContainedEnv`, and the census
  lists follow. (c) The docs PR: seven comment citations into `ccdWsHelpers.ts` were already stale at `256b25ecb`.
  (d) After wave 16 lands, `sweepFixture.ts`'s Darwin helper cases become plain `it`, with a dispatched full run.
  (e) From review 535 (F3, F4, F8, F9): a harness cleanup that reports any poison record left behind, so that the
  tests that meet a poison and stay green become a standing red rather than a one-time log. Also the symlinked bus
  value, and the census's named spellings (a script path followed by arguments, three namespace spellings, lexical
  scope and destructuring).
  (f) From review 577, none live: a bus path through `sym/..` resolves inside HOME lexically but not physically;
  `ccd-version.test.ts` overwrites the builder's bus pair after the call; `loginctl` is not in `CONTAINED_TOOLS`;
  a thin builder without `systemd` keeps the caller's bus pair (D-5253's blind spot by design).
- **R36 (review 568 F4; wave 17).** `deploy.sh`'s `prune_backups` keeps the newest directory by name, and `TS` comes
  from the deploying machine's clock (`date +%Y%m%d-%H%M%S`), while `ccrc update` and `ccrc backup` name directories
  in the same backups directory by the box's clock. With the deploying machine behind the box and KEEP=1, a deploy's
  own directory sorts first and is pruned, which under #448 holds its coordination snapshot. Take `TS` from the box,
  or protect the run's own directory by path, as `_bak_gc` does. If #448 fixes it, wave 17 drops it.
- **R37 (wave 17's Readings 3 and 8; a later server wave).** `GET /api/updates` does not read wave 17's new `sweep`
  key (one reader in the inventory, an optional wire field, an absent key read as not measured). Item G's units, active
  before the restart and not after it, stay named on stderr only; a third word class is the option.
- **R38 (wave 17's Reading 7).** The other `[0-9]` validators in `ccd/ccrc`, `CCRC_SWEEP_VERIFY_JOBS`'s among them,
  accept non-ASCII digits under a UTF-8 locale. R34 fixed only the KEEP pair.
- **R39 (wave 18's CodeQL; fix round 3).** #482's `CodeQL` leg is red with three alerts, all in test files:
  `raw-spawn-census.test.ts`'s `pat()` escapes `$` but not `\` (high; its inputs are identifiers), and two warnings for
  shell text built from a path (`ccdWsHelpers.ts`'s `sh`, `runbook-holds.test.ts`'s doctor spawn, whose path rides
  `$1`). Reviews 574 and 577 read all three as false positives. `CodeQL` is not a required check, but each alert's
  open review thread blocks the merge ("All comments must be resolved"), and dismissing an alert is the operator's
  act. So wave 18's fix round 3 fixes all three in code (2026-10-18 04:30 UTC).
- **R40 (wave 17's full run; not this programme's file).** `codexLaneFixture.ts`'s `complete_inactive()` writes `state`
  and then `pid` as two writes, and `ccrc-codex.test.ts`'s L0a reads `pid` as soon as `state` reads inactive. A slow
  macOS runner read between them once (run 39096832066). One write (pid first, or a single rename), or reading
  `pid` inside the same `eventually`, closes it. It belongs to the GPT lane's fixtures; tell their owner.

## Next-wave brief

**Wave 2 (run 128) — dispatched 2026-09-23.** The brief as sent is the plan's path and sha, tasks 1–15, execution
skill `superpowers:subagent-driven-development`, routing Opus · high main loop / Sonnet · high implementers / Opus ·
high per-task reviewer / workflow off / compact 40, the deviation block and reserve above, the migration-slot
re-measure, the concurrent-wave boundary (wave 2 never edits `ccd/`, `deploy/`), the sharded full-suite gate, and
"wave-done in the same turn as the push; never end a turn to wait on CI".

**Wave 3 and wave 4 plans** are in preparation; wave 4 may be dispatched while wave 2 runs, and merges after it.
