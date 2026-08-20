# Program: registry-durability

Spec: none — two carried Build-8 tickets (`docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md`,
"Carried"); scope is stated per wave in this ledger, and each wave's worker commits its own plan.
Plan: per-wave, committed by the worker on the workspace branch (wave 1: `docs/superpowers/plans/2026-08-20-fleetio-measured-read.md`)
Workspace: (spawned by wave-1 dispatch)
Coordinator: claude-ccrc-pwa (Fable tier — operator-set for this session)

**The first program driven through the `ccrc-worker` skill** (build4 predates it; its briefs
carried the whole protocol inline). The program's purpose is double, and deliberately so: retire
the two carried registry-durability tickets, and prove the worker-skill dispatch machinery live —
the pending proof the worker-skill slice named.

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | The `FleetIO.readFile` null collapse: a result-returning read (absent vs unreadable) at the seam, local + remote halves, `field()` consumes it | — | planned |
| 2 | `_reg_set` atomic writes (tmp+rename, same dir/filesystem); `_substrate_mark` rides the same helper | — | planned |

## Decisions & deviations

- **F-1 (2026-08-20, pre-dispatch — the program's first finding, found before its first call
  succeeded):** both skills taught `TOKEN=$(cat ~/.cc-secrets/ccrc-mail.token)` against the
  example-shaped token file (a `#`-comment preamble above one value line), so every coordination
  write answered a bare 400 before any route logic ran — the coordinator's own opening `GET` found
  it; a worker following its skill verbatim would have wedged on its first ack with no refusal
  code anywhere. Fixed in PR #70 (both skills + the wave-lifecycle reference now carry
  `deploy/notify.sh`'s exact extraction pipeline; a pin reddens on regression) and deployed
  agent-first before this program opened.
- Wave order is dependency-free; sequential anyway (one workspace, and wave 2's ccd surface wants
  wave 1's registry semantics settled).

## Carried constraints

- Wave 1 must not regress the registry ladder's listed-vs-readable call sites — `.hold`,
  `.substrate` and the identity triple read presence off `RegistryRead.names` DELIBERATELY
  (`HOLD_UNREADABLE`/`SUBSTRATE_UNREADABLE`); migrate a call site only where semantics are
  provably identical, and say which in the plan.
- Older-agent tolerance is fail-shut: a frame omitting the new distinction reads `unreadable`,
  never `absent` (absence-permits, single reader).
- Wave 2 touches `ccd/ccd`: provenance re-stamp in every commit; agent-first deploy.

## Next-wave brief

Program `registry-durability`, wave 1 of 2. Ledger: `docs/superpowers/programs/registry-durability.md`.

GOAL — kill the `FleetIO.readFile` null collapse (CLAUDE.md "Open on main" names it: the
`// null = missing` docstring is FALSE today). `server/src/io.ts`'s local read and
`server/src/remote/io.ts`'s remote read both map EVERY failure — missing, unreadable,
agent-disconnected — to one null; `server/src/registry.ts`'s `field()` (~:250) inherits the
collapse, and the registry ladder works AROUND it per-field via `RegistryRead.names`
(`HOLD_UNREADABLE`, registry.ts ~:225, is the worked example). The general fix: a
RESULT-RETURNING read at the seam, so absent and unreadable stop sharing a value.

SHAPE (settled — do not redesign): ADDITIVE. Add a reader beside `readFile` — e.g.
`readFileMeasured(path): Promise<{ ok: true; content: string } | { ok: false; reason: 'absent' | 'unreadable' }>`
— declared where `FleetIO` is declared; `readFile` stays and derives from it, so existing callers
are untouched until deliberately migrated. Remote half: the agent's read op distinguishes ENOENT
from every other failure ADDITIVELY on the frame (absence-permits: an older agent omits the field
and the server-side SINGLE reader collapses to `unreadable` — never `absent` — the fail-shut
direction). Migrate `field()` and, through it, ladder call sites ONLY where semantics are provably
identical; the names-based reads may stay where migration would change behavior — the plan says
which, per site.

FIRST TASK: survey every `FleetIO.readFile` consumer (`grep -rn readFile server/src`) plus the
agent's file-read path, and commit a short plan
(`docs/superpowers/plans/2026-08-20-fleetio-measured-read.md`) ON THIS WORKSPACE'S BRANCH. Then
execute it with `superpowers:subagent-driven-development` — the execution skill this brief names.
TDD red-first; every guard mutation-measured (before/after counts in the plan's deviations);
suites run from inside each package as `./node_modules/.bin/vitest run` (never bare `npx vitest`);
`single-definition` and `typecheck-tests` green; wire discipline additive-only (`FLEET_PROTO`
stays 1).

Commit on this workspace's own branch; do not create or switch to a separate feature branch.

DONE = PR open from the workspace branch against main, CI green, `wave-done` mail whose body
carries the JSON fingerprint `{branchTip, prNumber, prPhase: "open", handoffCommit}` with
`branchTip === handoffCommit ===` the branch tip's 40-hex sha.

OUT OF SCOPE: wave 2 (`_reg_set` atomicity, `ccd/ccd`); any registry semantic change beyond
de-collapsing; merging or deploying (the coordinator's job).
