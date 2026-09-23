# Program: session-continuity

Spec: `docs/superpowers/specs/2026-09-23-session-continuity-design.md`
Plans: `docs/superpowers/plans/2026-09-2?-session-continuity-wave<N>-*.md` — each written once the waves it depends on
have measured what it needs (the table's "depends on" column)
Home project: `ccrc-pwa`   Coordinator: assigned at the first run-open   Workspace: **a fresh one per wave**
Companion programme: `docs/superpowers/programs/landing-order.md`

**What this program is.** A restart — limit rescue, auto-home, manual swap, supervisor revival — is today a place
where work is lost: the swap carry skips a session's journals on a return visit, the restarted session is told
nothing specific, a resumed session is rescued again on the limit banner it brought with it, the operator's
`/model` reverts, and Claude Code's pressure reap kills the watchers of idle sessions while real orphans go
uncollected. This programme makes a restart a place where work is handed over. It adds no revival: the swap stays
the one sanctioned restart. The operator's rulings are the spec's §3 (C1–C14); every §11 decision was ruled on
2026-09-23.

## Waves

| # | spec stage | scope | deploy class | depends on | PRs | state |
|---|---|---|---|---|---|---|
| 1 | 1 | the carry merges instead of skipping; its slot and byte budget; `(merged +N ~R !D)`; the prerequisite write-model measurement; `deploy/measure-continuity.py` with its carry counter | **AGENT-FIRST** (ccd) | — | — | planned |
| 2 | 4, rules 1–3 | `$REG/<id>.landed`; a carried-in banner is not a block; the rescue wait near a five-hour reset (600 s) with its own grace; spread, no-bounce, the chain wait; `$REG/<id>.rescuewait` | **AGENT-FIRST** (ccd) | — | — | planned |
| 3 | 7 | `$REG/<id>.typed`; the operator's own `/model`/`/effort` promoted to the route record before a stop; the alias table and the `familyClassOf` port with its agreement pin | **AGENT-FIRST** (ccd) | — | — | to plan |
| 4 | 6, first part | the reap-class OOM count in the instrument (its baseline week starts at deploy); `ccd-scope-sweep` with its units, verdict record and doctor reader; the limit-banner harness leak | **AGENT-FIRST** (ccd, deploy, doctor) | — | — | to plan |
| 4b | 6, first part | `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` in the spawn environment | **AGENT-FIRST** (ccd) | wave 4 plus its one baseline week | — | to plan |
| 5 | 2 | the spike: native exit handoff under ccd; a paused workflow under a blocked parent; `OOMPolicy=continue` on a scratch pane scope | measurement — needs a scratch account from the operator | wave 1 | — | to plan |
| 6 | 3 | graceful stop; the launch record; the manifest; the composed redrive prompt | **AGENT-FIRST** | waves 1, 5 | — | after wave 5 |
| 7 | 4, the refusal | non-rescue swaps refuse while delegated work is in flight; `--cut-delegated`; its own 409 | **AGENT-FIRST**, then server | wave 6 | — | after wave 6 |
| 8 | 5 | the three skill clauses; review-panel's "resume before re-run"; run signals; `FleetSession.delegations` and its chip | skills, server, pwa | wave 6; landing-order wave 1's clauses | — | after wave 6 |
| 9 | 6, second part | ccd stops a pane's scope when it ends the pane | **AGENT-FIRST** | waves 5, 6 | — | after wave 6 |

Waves 1–4 are independent in function and may be worked in parallel, but each edits `ccd/ccd`, so they land one at
a time: each lands on current `main` by a clean `git merge` (landing-order clause 16's triggers), re-stamps, and
re-measures the citation corpus and the `_reg_get` census on the merged tree before its final gate.

## Decisions & deviations

- **2026-09-23 — the design, its rulings and the written spec.** Approved in the brainstorm (C1–C8); the operator
  ruled every open decision on the written spec the same day (C9–C14). Two adversarial rounds and a numbers and
  consistency pass preceded the rulings; each measurement the spec cites names its instrument.
- **2026-09-23 — stage 4 split at the source.** The spec's §10 said `1 → 2 → 3 → {4, 5}`, but stage 4's rules 1–3
  read only the transcript, the limits files and the swap log. Corrected in the spec before any plan was written,
  so wave 2 ships the rescue policy early and wave 7 carries the refusal that needs stage 3's scan. Not a deviation
  — the spec over-constrained itself and was fixed at the source.
- **Amendment slugs.** Each is minted by the plan that implements it and defined in that plan's
  `## Deviations found` in the same act: `sidecar-carry-merges` (wave 1), `carried-in-banner-is-not-a-block` and
  `rescue-waits-near-reset` (wave 2), `operator-model-survives-restart` (wave 3), `inert-scope-sweep` (wave 4).
- **Deviation blocks** are minted per wave, at that wave's run-open, by the coordinator. No `D-` token appears in
  this file until a plan on the same ref defines it (`deviation-refs.test.ts`).

## Carried constraints

- **Every wave that edits `ccd/ccd`** re-stamps it (`ownership.test.ts`), pays the citation tax for every cited file
  it moves (`session-hook.test.ts` S6-R11), keeps edits above the frozen corpus anchors length-neutral, and
  re-measures `ccd-reg-get-census.test.ts`'s sentence if it adds a `_reg_get` call.
- **The instrument grows with the programme.** `deploy/measure-continuity.py` is read-only and run by hand on the
  fleet box; wave 1 creates it with the carry counter, and every later wave adds the rows of spec §9 it owns in the
  same PR as the mechanism they measure.
- **Claude Code's regime changed on 2026-09-15.** Workflow agents pause at a five-hour limit and re-run after the
  reset. Any delegated-work baseline a plan uses is re-cut at 2026-09-16 (spec §1.1).
- **The fleet box is memory-bound.** A pane scope throttles at 8G and dies at 12G with its session
  (`OOMPolicy=stop`), and the session slice sits near its 24G ceiling. Run suites in the foreground, one at a time,
  sharded; never two full server suites at once from one pane.
- **SAFETY.** Never a destructive `ccd` verb against the live host; never touch tmux, `~/.cc-sessions`,
  `~/.cc-limits` or `claude-session@*.service` directly; fixture HOMEs only in tests; never print secret contents.

## Next-wave brief

Waves 1 and 2 are planned; dispatch either on a fresh workspace with its plan path and this file. Wave 1's first
task is the write-model measurement its rules depend on — if it contradicts the spec's append-in-place assumption,
the rules change in the plan before any code. Wave 2 changes a verdict every rescue and strand decision runs on;
its safety lens is `xhigh`.
