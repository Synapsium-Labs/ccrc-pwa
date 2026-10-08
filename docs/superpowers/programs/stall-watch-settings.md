# Program: stall-watch-settings

Spec: `docs/superpowers/specs/2026-10-05-stall-watch-settings-design.md` (rev 3.2, approved 2026-10-05 17:46 UTC)
Plans: `docs/superpowers/plans/2026-10-05-stall-watch-settings-w1-server.md` (wave 1),
`docs/superpowers/plans/2026-10-05-stall-watch-settings-w2-pwa.md` (wave 2)
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-calm-harbor`   Workspace: **a fresh child per wave**
Predecessor: `stall-watch`, complete (its ledger's R38).

**What this program is.** The Settings page gains a **Stall watch** section with one arming ladder and one quiet
time.
- **The ladder:** Off, Log only, Check, Alert, Deliver, Everything, or "Follow the fleet box's files".
- **The quiet time:** 30 min to 12 h, in 30-minute steps.
- **Where the choice lives:** on the server, in one row of `coord.db`. It applies to the whole fleet, and the
  browser keeps no copy.
- **What it overrides:** the arming markers, but never `stall-watch-disabled`, `mail-disabled` or
  `mail-gate-strict`. No marker gains a writer.
- **Confirms:** the server decides when a write needs one. That is whenever the write would switch something on,
  shorten the quiet time, or leave Everything.
- **The split:** wave 1 ships the server and changes nothing until a choice is written (the seed is `follow` and the
  built-in quiet time). Wave 2 ships the section.

## Waves

| # | scope | deploy class | PRs | state |
|---|---|---|---|---|
| 1 | server: L0 wire types and texts; L1 `stallsettings.ts` (ladder, resolver, write effect and key, counts, busy clock); `stall.ts` (quiet time, backoff ceiling, busy clock bound); the migration and store methods; both sweeps through one never-throwing resolution; `GET`/`POST /api/coord/stall-watch` and their censuses; README, `CLAUDE.md` and the parent spec | server | — | planned |
| 2 | the Settings section: API client and hook; a multi-line `QuickConfirm`; `StallWatchSection`; the Notifications label rename; README | server (it serves the PWA) | — | planned; dispatched after wave 1 merges |

## Decisions & deviations

- **R1 (2026-10-05 17:46)**, the spec is approved.
  - The operator approved spec rev 3.2 ("Spec is good"), and the §19 defaults stand as written.
  - Before that, the operator asked for an adversarial review (14:48). Three rounds (wf_02c96a48-da4,
    wf_6b6351ad-f06, wf_be296fb4-28c) folded 44, 28 and 7 findings in turn. None was critical. The residue is
    listed in the spec's §20, and the plans settle it.
  - The operator also confirmed that the choice lives on the server, not in a browser (goal 2 reworded, `ae3895a54`).
- **R2 (17:47)**, the numbers.
  - The allocator issued this programme's block of 24 numbers.
  - Wave 1 defines fifteen: D-4022, D-4023, D-4024, D-4025, D-4026, D-4027, D-4028, D-4029, D-4030, D-4031,
    D-4032, D-4033 and D-4034 for the spec's departures, plus D-4037 and D-4038 from the plan review (R3).
  - Wave 2 defines two: D-4035 and D-4036.
  - The coordinator holds the other seven as a reserve. A departure found during a wave is named by slug in the
    wave-done mail and numbered at wave-done, never earlier.
- **R3**, the planning method: prototype, then measure.
  - The plans were written by workflow wf_974eef89-343 (13 Opus agents). Every task was built in a scratch worktree
    of `77f8d63a5` (branches `proto/sws-w1`, 7 commits, and `proto/sws-w2`, 4 commits; local only, never pushed).
    Its red and green counts and mutation tables were measured there, and the plan's code is that code.
  - Plan review wf_0743e79f-902 (26 agents) found 34 findings: 0 critical and 11 important. None changed the
    design. They were plan-text gaps: Task 7's base drift, a mutation-restore rule, an undefined helper, missing
    mutation rows, and one hand-off between the waves.
  - Fix round wf_d76e8253-74a closed all eleven. Its checkers left two items, ruled here:
    - D-4037 `quiet-raise-asks-nothing`: raising the quiet time never asks for a confirm on its own, because it can
      only reduce checks. This settles the spec's §20 title-only-sheet residue.
    - D-4038 `view-reads-stages-with-the-resolution`: the view reads the stages inside the resolution try. A reader
      throw is a bug path in pure, total code, so the section names the fault rather than reading as an unmeasured
      registry. Accepted as residue.
    - A final narrow fix round applied both, and fixed three small text slips.
- **R4**, routing for wave 1.
  - The wave is a dependent chain of seven tasks. Its plan is long because every step carries its full code.
  - Row: "Worker executing a spec'd plan: a dependent chain that fits one context" (`references/routing-matrix.md`):
    Opus · high; Sonnet · high implementers; an Opus · high per-task reviewer; Haiku scouts; workflows off; compact 40.
  - The worker extracts one task brief at a time (subagent-driven development), so a task never needs the whole plan
    in context.
  - Revisit at wave-done if the wave's evidence says the chain outgrew one context.

## Carried constraints (reviewers get these)

- Mutation-table discipline: every guard ships with a row measured red when it is removed, before and after.
- The README citation instrument stays at `7 passed | 328 skipped`; README and `CLAUDE.md` edits are made in place.
- `stall.ts` and `stallsettings.ts` stay L1: pure, and spelling no marker name. No marker gains a writer
  (`single-definition.test.ts`).
- The migration slot is measured, never assumed: 17 at `77f8d63a5`. Slots are a cross-branch namespace; whichever
  branch merges second moves up.
- Run suites in the foreground, one file per command, with a timeout of at least 600000 ms.
- macOS CI legs gate nothing.
- `deviation-refs` needs both plans on `main` before dispatch, because the code cites their numbers.
- Arming stays the operator's. The live box has `stall-watch-live` and `mail-gate-busy-shadow`. Wave 1 deploys at
  `follow`, so nothing changes until a level or a quiet time is chosen in Settings.

## Next-wave brief

- **Wave 1:** `docs/superpowers/plans/2026-10-05-stall-watch-settings-w1-server.md`, all seven tasks, on a fresh child
  of `ccrc-pwa`.
  - Read the plan by its commit sha on `main`.
  - Dispatch only after the docs PR carrying the spec, both plans and this ledger is merged (the plan's
    Preconditions 1 and 2).
  - Before dispatch: re-read claims, re-measure the migration slot, and check the child-reclamation W5 overlap the
    plan names.
  - Execution: `superpowers:subagent-driven-development` with `superpowers:test-driven-development`, with routing per
    R4.
- **Wave 2:** `docs/superpowers/plans/2026-10-05-stall-watch-settings-w2-pwa.md`, dispatched after wave 1's PR is
  proven merged.
