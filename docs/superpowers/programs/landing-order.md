# Program: landing-order

Spec: `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`
Plans: `docs/superpowers/plans/2026-09-2?-landing-order-wave<N>-*.md` — each written once the waves it depends on
have landed what it reads
Home project: `ccrc-pwa`   Coordinator: assigned at the first run-open   Workspace: **a fresh one per wave**
Companion programme: `docs/superpowers/programs/session-continuity.md`

**What this program is.** The fleet manufactures main churn — ritual syncs, `update-branch`, repeat absorptions —
and lands in whatever order merges happen to arrive, testing no composition. This programme stops the churn,
makes landing order a recorded fact, and lets the coordinator land a tested composition. **The coordinator
merges, workers never do, and nothing merges unattended** (spec §3, R5). The operator's rulings are the spec's §3
(R1–R10); every §11 decision was ruled on 2026-09-23.

## Waves

| # | spec stage | scope | deploy class | depends on | PRs | state |
|---|---|---|---|---|---|---|
| 1 | 1 | worker clause 16 and coordinator clause 15 with their pins and count words; the PreToolUse advisory on syncs of `main`; `ccrc restamp`; `update-branch` pinned absent from executable source and counted in the skills; wave-lifecycle step 6 written gated | skills, hook (fleet box) | — | — | planned |
| 2 | 2, repository code | `ci.yml` gains `merge_group`, the macOS skip and a `pull_request` concurrency group; `pr-state`'s `queue` field; the dequeue feed event and coordinator mail; the hook denies `gh pr merge` to workers; clause 15's native-queue sentence | ccd, hook, server | wave 1 | — | planned |
| 2b | 2, the bypass deny | the hook denies `--admin` and a `gh api` merge call in every fleet session | hook | the operator's queue ruleset, approvals at 0, and the proof run | — | to plan |
| 3 | 3 | `ccd-land-probe`, the read-only conflict radar, and its opt-in mirror | ccd, deploy | — | — | to plan |
| 4 | 4 | the opted-in lineage table; `lineage-unmeasured` | server | wave 3 | — | to plan |
| 5 | 5 | the landing line: entries, intents, holds, `land-candidate`, the coordinator's pinned merge, the PWA doors | server, ccd, skills, pwa | waves 2–4; session-continuity wave 1 | — | to plan |

**Step 6 of the wave lifecycle** — wave N+1 opens without `sessionId`, so dispatch mints a fresh child from
current `main` — goes live only with child-reclamation's reclaim-on-close wave (CCR-15 wave 3). Wave 1 writes it
gated on that.

## Decisions & deviations

- **2026-09-23 — the design, its rulings and the written spec.** Approved in the brainstorm (R1–R8); the operator
  ruled both open decisions on the written spec the same day: break-glass keeps the repository-admin role as the
  ruleset's only bypass actor (R9); strict protection comes off intake-platform and data-internal after a week of
  coordinator landings with composition tests (R10).
- **2026-09-23 — stage 2 split into two waves.** The spec's own rollout order puts the `--admin` deny after the
  operator's ruleset change and the proof run (§5.2 steps 2–4), so it ships as wave 2b rather than behind a flag in
  wave 2. Not a deviation — the spec's order, drawn as waves.
- **2026-09-24 — the Maintain-role bypass comes off.** The operator confirmed the removal wave 2's runbook makes
  (Task 7 Step 4) when it adds the queue rule: the repository-admin role stays the ruleset's only bypass actor.
- **2026-09-24 — execution: coordinator dispatch.** The operator creates one coordinator per programme from its
  ticket. Each wave goes to a fresh worker workspace running subagent-driven development, a review run reads the
  worker's branch, and the coordinator rules and merges; the plans reach a worker only from `main`, so the docs
  PR carrying the specs, the ledgers and the first four plans merges before the first dispatch.
- **Deviation blocks** are minted per wave, at that wave's run-open, by the coordinator. No `D-` token appears in
  this file until a plan on the same ref defines it (`deviation-refs.test.ts`).

## Carried constraints

- **Another programme edits `ci.yml`.** CI test selection (spec on `ws/ccrc-ci-runs-optimization`, awaiting the
  operator's review) reshapes the same workflow. Wave 2's `merge_group` trigger, macOS skip and concurrency group
  are written to survive that reshaping, and whichever lands second merges the other's shape rather than
  overwriting it. Two points that programme must carry: a `merge_group` run keeps a run-unique concurrency group
  (never its shared push-to-main refresh group, which may drop runs), and its mode table needs a `merge_group` row.
- **The skill pins move with the clauses.** `worker-skill.test.ts`, `coordinator-skill.test.ts`, and the
  clause-count words in `README.md` and `CLAUDE.md` that both pins read move in the same commit as a clause.
  session-continuity wave 8 appends its clauses after this programme's wave 1.
- **The hook is a contract, not an access boundary.** Identity on the fleet is attribution; the fleet's single
  GitHub login holds the admin role (R9).
- **SAFETY.** Never a destructive `ccd` verb against the live host; never touch tmux, `~/.cc-sessions`,
  `~/.cc-limits` or `claude-session@*.service` directly; fixture HOMEs only in tests; `gh` stays off the exec
  whitelist; never print secret contents.

## Next-wave brief

Waves 1 and 2 are planned and reviewed; once the docs PR has merged, dispatch wave 1 on a fresh workspace with its
plan path and this file. Wave 2 needs wave 1's clause 15 to append its native-queue sentence to. After wave 2
merges, the operator applies the ruleset and approval change and runs the proof (spec §5.2 steps 2–3); wave 2b is
planned and dispatched only on that proof's result.
