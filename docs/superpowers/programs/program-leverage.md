# Program: program-leverage

Spec: `docs/superpowers/specs/2026-08-28-program-leverage-design.md` (this branch)
Plan: per-wave, committed by each wave's worker on its workspace branch (registry-durability precedent)
Workspace: `ccrc-pwa-brisk-meadow` — the COORDINATOR's session (workspace `brisk-meadow`, branch
`ws/brisk-meadow`); operator-designated 2026-08-28, workspace-resident (not a main checkout).
Worker workspaces are spawned per wave by dispatch.

Ledger + spec live on `ws/brisk-meadow` (pushed) until program close; a worker reads them by
fetching that ref (D-108 precedent). At close the docs PR to main with the final wave.

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | F1 — drift fixes (ungated-door count, coordinator trigger/resume wording, stale `_id()` anchor) + the coordinator-resume runbook (`references/resume.md`). AGENT-FIRST deploy. | — | planned — dispatch HELD for operator spec review |
| 2 | F2 — dispatch-time `skillState` preflight (measure, never refuse) + synchronous deviation-floor seed on first allocation | — | planned |
| 3 | F3 — per-project program-ready badge (server measurement + /runs board) | — | planned |
| 4 | F4 — program kickoff rides the idle-gated mail lane (`queueSystemMail`), direct-injection race retired | — | planned |
| 5 | F5 — `POST /api/runs/:id/reclaim` (4th ungated door, dead-proof) + PWA resume affordance; door count → four | — | planned |
| 6 | F6+F7a — `COORD_QUIET_MS`/`COORD_COOLDOWN_MS` for coordinator recipients + `POST /api/coord/caps` operator dial | — | planned |
| 7 | F7 — program health on the board (parked mail, replay high-water, rejection counts, un-briefed coordinator) | — | planned |
| 8 | F8 — measured-read completion (`readFileB64`/`readFileFrom`, agent `stat` EACCES lie) + `MailDeliveryState` terminality audit. AGENT-FIRST deploy. | — | planned |

## Decisions & deviations

- **Operator ruling (2026-08-28): the reclaim door ships UNGATED + dead-proof** — measured-dead
  (registry-proven absent, or present with a gone/dead tmux verdict) is the guard, not a
  credential; unmeasurable refuses, never proceeds. Recorded in spec §7/§11.
- **Operator ruling (2026-08-28): wave-1 dispatch HOLDS for operator review of the spec.** The
  run is opened and the block allocated; dispatch fires on the operator's go.
- **Two programs are active concurrently** (`battlescape-operational`, MekWarLive, wave 2/6 at
  open time): every `toId:'coordinator'` mail in this program MUST carry `runId` — the
  runId-less form resolves only when exactly one program is active. Briefs restate this.
- **Build 9 remnants are a NON-GOAL**: peers/claims/allocator/lifecycle shipped in build 9/9b
  (`docs/superpowers/plans/2026-08-24-build9b-peers-claims-allocator.md`); the pre-program
  memory note claiming build 9 was "awaiting review" was stale and is corrected.
- **Deviation block:** allocated at run-open (clause 10) — see the run-open entry appended below.

## Carried constraints

- Waves 1 and 8 are **AGENT-FIRST** deploys (they touch `ccd/coordinator-skill/` and the agent's
  IO half respectively).
- The destructive-verb census (`coordinator-skill.test.ts:97-105`) counts the three destructive
  verbs across SKILL.md + ALL references — wave 1's new `resume.md` must not name them.
- Wire discipline everywhere: additive-only fields, single reader per field, older-peer omission
  tolerated, no `FLEET_PROTO` bump, no new ccd verbs, no overloaded null at any new seam
  (unmeasurable ≠ false throughout F3/F5/F7).
- Root CLAUDE.md's ungated-door count is corrected exactly once per change, BY the wave that
  changes it: F1 writes three, F5 writes four.
- Wave 5 depends on wave 1 (the runbook's re-kickoff template text) and wave 4 (the mail-lane
  kickoff it reuses). Waves 2, 3, 6, 7 are independent of each other.
- Every wave: mutation-table discipline — a guard ships WITH a test measured red on guard
  deletion; TDD red-first; deviations recorded against this program's allocated block.

## Next-wave brief

**Wave 1 — F1: drift fixes + the coordinator-resume runbook.** Spec:
`docs/superpowers/specs/2026-08-28-program-leverage-design.md` §3 (fetch `ws/brisk-meadow` from
origin to read it), tasks 1–4 exactly as numbered there. Write your own plan under
`docs/superpowers/plans/` on your workspace branch first (superpowers:writing-plans), then
execute it with superpowers:executing-plans. Constraints that bind this wave: the destructive-verb
census (spec §3 design item 3 — `resume.md` must not name the three verbs); the trigger-sentence
fix must keep the operator-designation arm and must not assert the coordinator is a main checkout
(this program's own coordinator is workspace-resident); new pins in `coordinator-skill.test.ts`
follow the existing verbatim-literal style; AGENT-FIRST deploy order when shipping. Commit on
this workspace's own branch — never a separate feature branch. All mail to the coordinator names
this run's `runId`. Deviations: use this program's allocated block (number range in the ledger's
run-open entry).
