# Program: crossrepo-programmes

Spec: `docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md` (design approved in dialogue by the
operator 2026-09-08; inherits every 2026-08-11 ruling from `2026-08-11-crossrepo-programmes-design.md`)
Plan: three wave plans, written before the program opened —
`docs/superpowers/plans/2026-09-08-crossrepo-wave{1-server,2-skills-pwa,3-docs-flip}.md`
Workspace: worker workspace spawned by wave 1's dispatch (recorded in the Waves table once it exists)
Coordinator: operator-designated at open (ruled 2026-09-09, the clean path): a FRESH main-checkout session
of ccrc-pwa started from the run board's Start Program door, which queues the standing kickoff
(`programKickoff`, `shared/api.ts`) that invokes the `ccrc-coordinator` skill — the operator types no skill.
Opened only AFTER account-pools has closed: the sheet refuses a project with an open run, and the refusal
is real — coordinator-role mail carrying no `runId` resolves to the single active programme FLEET-wide
(`coord/routes.ts`, the mail ingress's role resolution), so two open programmes make every such mail
`unknown-recipient`. The operator stops the live main checkout of ccrc-pwa first (the sheet starts a main
checkout and refuses while one is alive). NOT the account-pools coordinator, which owns a live program of
its own.

The spec, the three plans and this ledger merge to `main` BEFORE wave 1 is dispatched, so every worker
workspace is cut with its requirements in the tree. This ledger moves on the coordinator's branch (pushed
after every wave) and lands on `main` with the final wave.

Execution shape, every wave: the worker invokes `superpowers:subagent-driven-development` on its own
workspace branch — fresh implementer subagent per task, task review after each, whole-branch review at the
end — then pushes, opens the PR and mails `wave-done`. The coordinator re-measures, reviews the PR with an
independent lens, merges (a hand-written squash body), deploys AGENT-FIRST where the wave says so, and
briefs the next wave — opening wave N+1's run BEFORE closing wave N's.

Ledger block: **D-2054–D-2070** — seventeen numbers minted in ONE allocator call on 2026-09-08 at plan time
(floor 2071) and FULLY DEFINED across the three plans' `## Deviations found` sections (wave 1: D-2054–D-2061;
wave 2: D-2062–D-2065; wave 3: D-2066–D-2070), each ratified by the orchestrator and folded into the spec's
sentences the same day. It is not a reserve. An execution-time deviation gets its own allocator
call: the worker writes `D-TBD-<slug>` with a full entry and mails a `deviation-request` naming the count;
the coordinator mints exactly that many, defines them in the same act, and mails the numbers back.

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | Server + shared: `project-mismatch` at open and at dispatch resume, `home-mismatch`, the one migration (`programs.homeProject`, `feed_events.runId`), `homeProject` at open with the legacy generation, `RunSummary.homeProject`, the `worker` mail role, `bindSession` and the heir re-issue, the programme filters on mail and feed, `ccrc-api` rows, both refusal codes named in the coordinator skill. AGENT-FIRST (the skill sentence ships via the install lane). | — | not opened |
| 2 | Skills + PWA: the coordinator skill's boundary sentences, the worker skill's foreign-plan sentence, the runs-screen badge and crossing marker, the fleet card's marker and abroad line, the mail screen's programme grouping and chip. AGENT-FIRST. | — | not opened |
| 3 | Docs + the legacy flip: README sections, the Aug 11 spec's status line, this ledger's close, and `HOME_PROJECT_LEGACY_ACCEPTED → false` as its own commit ONLY when the operator's read of `run_events` and `runs` on the server box shows zero `legacy-home-project` events AND at least one run opened over seven consecutive days (D-2066, D-2067) — else deferred with both numbers recorded. NOT agent-first (D-2069). | — | not opened |

Dogfood follows as its own program after wave 2 is live: home `custom-tools`, wave 1 there, wave 2 in
`data-internal`, on real work the operator names, opened without `sessionId`. Exit criteria = spec §9's
acceptance list, verbatim.

## Decisions & deviations

- **Order (2026-09-08, operator):** of the three genuinely open roadmap items (Build 5 remnants, the
  review-notes → prompt loop, cross-repo programmes) this one is built first — the spec and rulings
  existed, and the four seams re-measured today were open exactly as the Aug draft described them.
- **Mail addressing (2026-09-08, operator):** the Aug 11 proposal adopted IN FULL — role addressing for
  both roles, a replacement occupant inherits its predecessor's undelivered mail, a programme filter on
  mail, feed and the mail screen. The mechanism is the one the tree already has: resolution at send time,
  and at occupant change the D-1425 act (a fresh delivery row to the heir, the predecessor's row parked)
  generalised by role and funnelled through `bindSession`, the one writer of `runs.sessionId`. Stated
  honestly in the spec: no route re-binds a live run today, so the worker arm is reached only by the
  store test that drives it — the funnel exists so that the day a recovery re-binds a run, the promise
  holds.
- **Dogfood pair (2026-09-08, operator):** custom-tools ↔ data-internal, the pair that was live traffic
  in August; not intake ↔ data-internal, whose dependency is still future.
- **Two corrections from the plan's pre-read, folded into the spec before the plans were written:**
  `NotifyEvent` and `feed_events` carry no `runId`, so the one migration also adds `feed_events.runId`;
  and `coordinator-skill.test.ts` requires every `RunRefuseCode` to be named in the skill corpus the
  moment it exists, so the refusal-list sentence and its wave-lifecycle rows belong to wave 1 — which is
  therefore agent-first as well.
- **The legacy home stays NULL** in the column while the generation lasts (the reviewer's catch): a
  default written into the column would make the later explicit home collide with a guess. The RESPONSE
  defaults; the column tells the truth.
- **`worker` requires a `runId`; `coordinator` keeps its single-active-programme fallback** — two roles,
  two conditions, not folded.

## Carried constraints

- **account-pools wave 3 is in `server/src/coord/{routes,store}.ts` now** (run 35, dispatched
  2026-09-08). Wave 1's worker rebases over it before opening its PR; a conflict in `openRun` or the
  route's body validation is expected, not a defect.
- **The coordinator skill's ten clauses and the worker skill's twelve stay VERBATIM** — every addition is
  an additive paragraph with its own harvest pin (`coordinator-skill.test.ts:92-118`,
  `worker-skill.test.ts:34-71`).
- **`nestFleet.ts` and its five rules do not change.** The marker is computed in the card from the run it
  already has; the home card's abroad line rides an additive prop.
- **`FLEET_PROTO` stays 1.** `RunSummary.homeProject` and `NotifyEvent.runId` are additive with one
  tolerant reader each — `runHomeProject` (`runWords.ts`) and `reviveNotifyEvent` (`shared/api.ts`); the
  offline snapshot persists neither runs nor feed, so `offline.test.ts` pins its key set instead (D-2062).
- **Exactly one migration across the three waves**, in wave 1, both columns.
- **The legacy flip is dated by evidence**, not by the calendar: zero `legacy-home-project` events AND at
  least one run opened over seven consecutive days, both read by the operator on the server box because no
  route exposes `run_events` (D-2066, D-2067). Wave 3 records both numbers either way.
- **Wave 1 is live before wave 2 ships** — the guard exists before the skill tells coordinators to cross.

## Next-wave brief

Wave 1. Plan: `docs/superpowers/plans/2026-09-08-crossrepo-wave1-server.md`, Tasks 1–9, in order — each
refusal code is declared, first emitted and named in the skill in ONE commit (`project-mismatch` in Task 1,
`home-mismatch` in Task 4, D-2054), so no suite is red between commits except `dtbd`, which is red by
design until the numbers are substituted. Execution skill: `superpowers:subagent-driven-development`. Commit on this workspace's own
branch, never a separate feature branch. Interfaces the later waves consume are the spec's cross-wave
names, verbatim: `sessionProject`, `programHome`, `setProgramHome`, `bindSession`, `resolveWorker`,
`requeueAbandonedMail`, `mailForProgram`, `feedEventsForProgram`, `RunSummary.homeProject`,
`NotifyEvent.runId`, `HOME_PROJECT_LEGACY_ACCEPTED` and `homeProjectVerdict`, `MAIL_REBIND_SUPERSEDED_ERROR`,
the run events `legacy-home-project` and
`home-project-backfilled`, the refusals `project-mismatch` and `home-mismatch` with `by`. Deviations
found during execution: `D-TBD-<slug>` with a full entry, then a `deviation-request` mail with the count.
Before `wave-done`: the whole-suite gate in all three packages, `git fetch origin main` then
`deviation-refs`, and the rebase over account-pools wave 3. The wave is AGENT-FIRST.
