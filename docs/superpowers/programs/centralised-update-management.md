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
| 2 | W2 | control plane, read-only: `MIGRATIONS[13]`, catalogue poller, node inventory, resolver, projection route + server-role writer, `GET /api/updates`, intent/refresh/ack, derived `builds` | agent-first (read allowlist), then server | — | **dispatched** (run 128, 2026-09-23); plan `1288beec` |
| 3 | W3 | `/settings`, `UpdateBanner`, release push once per tag, move controls DISABLED | server | — | **run 130 open, planned**; plan `d638c602`; dispatches when wave 2 merges |
| 4 | W4 part A | node side: `ccd-update-sync`, the projection reader in `cmd_update`, `--channel/--detach/--from/--no-gate`, the lock, `update.json`, `previous`, `install-step`, the health gate, `_upd_restore` arms 2–3, `ccrc rollback`, the watchdog, doctor `provenance` + unarmed-exposure, `ccrc channel`, `--check caps=`, `rollout --channel`, the W4 cap words | fleet-first | — | **dispatched** (run 129, 2026-09-23 09:5x UTC, `ccrc-pwa-keen-meadow`); plan `4b361c00`; tasks 15–16 wait for wave 2's merge |
| 5 | W4 part B | convergence: `update/dispatch.ts`, the agent `update` op + `ops` on ready, `apply`/`rollback` routes, the PWA controls enabled | agent-first | — | **run 132 open, planned**; plan `6acbff6d`; dispatches when waves 2, 3 and 4 have merged |
| 6 | W5 | versioned installs: `~/ccrc-versions/<tag>` + symlink flip, migration + crash recovery, restore arm 1, GC, `ccrc versions`; the rehearsal | fleet-first | — | planned |
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
- **Wave 6 is being planned** (2026-09-23) against wave 4's committed plan; its run and block open when its plan is final.

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
