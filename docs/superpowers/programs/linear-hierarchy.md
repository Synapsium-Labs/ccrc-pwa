# Program: linear-hierarchy

Spec: `docs/superpowers/specs/2026-11-10-linear-hierarchy-design.md` (approved by the operator 2026-11-10, #2574)
Plan: `docs/superpowers/plans/2026-11-10-linear-hierarchy.md` (its "Deviations found" section is binding)
Fixtures: `server/test/fixtures/linear/README.md`, "What FX2 measured"
Home project: `ccrc-pwa`   Coordinator: the claimant of the programme's runs (`ccrc-api runs list`)
Workspace: **a fresh child per wave** (one PR per child; every wave builds on the previous wave's merged code)
Deviation block: numbers 8672 to 8681 (allocated 2026-11-16 at run-open; D-8672..D-8674 defined in the plan, the rest issued
by this coordinator in briefs). The waves' own numbers stay D-8182..D-8186.

**What this programme is.** ccrc's plan gains epics, checkpoints and tickets, and ccrc keeps a matching Linear
hierarchy itself: product = team, programme = initiative, epic = project, checkpoint = project milestone, ticket =
issue. ccrc's plan is the source of truth; people only read Linear; drift is put back with a comment and an edit made
in Linear is never adopted. Each project's Linear owner (a console setting) drafts that team's migration map and routes
issues filed straight into Linear; each programme's coordinator owns its own epics and checkpoints. This is a parallel
lane: it never blocks other work.

## The operator's rulings (2026-11-10)

They decide every question the plan leaves open.

- **Mapping:** product (a ccrc project, by its team key) = Team; programme = Initiative; epic (one plan-sized stage) =
  Project; checkpoint = Project milestone; ticket (a wave or task) = Issue. It applies to every project ccrc works on.
- ccrc creates the Linear objects itself and keeps them moving.
- ccrc's plan is the source of truth. People only read Linear. Drift is put back, with a comment, and an edit made in
  Linear is never adopted.
- The Linear owner is a per-project console setting. It drafts that team's migration map and routes bugs filed
  straight in Linear. Each programme's coordinator owns its own epics and checkpoints.
- **Migration (wave 7):** pilot team first. Per team: map, then the operator approves it in the console, then apply,
  then report. Nothing is ever deleted. The pilot's report goes to the operator before any other team.
- This is a parallel lane. It never blocks other work.

## Waves

| # | scope | D | PRs | state |
|---|---|---|---|---|
| — | the design | D-8179 | #2574 | **merged** 2026-11-11 as `b7ef181bf` (no run: landed before this programme was opened) |
| 1 | the proxy additions | D-8180 | #2612 | **merged** 2026-11-11 as `a9cfd134f` (no run) |
| 2 | the plan model and the per-project Linear owner, server half (migration landed as **59**, not 57) | D-8181 | #2661 | **merged** 2026-11-11 as `ec5e1f513` (no run) |
| FX2 | Linear's real answers recorded as fixtures | D-8407 | #2746 | **merged** 2026-11-13 as `591fa065a` (no run) |
| 3 | the plan sync: open, move and close of the Linear objects; the initiatives-off item; the item act route; dispatch waits for its ticket's issue | D-8182 | #2941 | **in review** 2026-11-16: run 2243 (ticket `w3-plan-sync`), branch `ws/linear-hier-w3`, wave-done at `35bb54112` (5/5 items); review run 2311 found 7 important (F1-F7), sent back for fix round 1; fix round 1 done at `a1fb568bf` 2026-11-17, review round 2 is run 2332 |
| 4 | drift, inbound and public text: migration (next free slot), the drift pass, persistent drift, `plan triage`/`plan take`, the Upkeep epic, the Linear owner item, `plan-owned` | D-8183 | — | not started |
| 5 | the console: the project row's hierarchy settings, the programme page's Plan section, the epic and Upkeep pages, the five hierarchy items' controls | D-8184 | — | not started |
| 6 | the coordinator, worker and Linear skills | D-8185 | — | not started |
| 7 | the per-team migration: start, map propose and check, approve, apply, report, follow-up maps, put back; then the pilot team | D-8186 | — | not started |

## Decisions & deviations

- **2026-11-16 — the programme is opened for waves 3 to 7 (D-8672).** The design, waves 1 and 2 and FX2 landed as plain
  PRs with no run, so no programme row, plan or ledger existed. This coordinator opened it: this ledger, the plan
  declared through `ccrc-api plan put` (a `foundations` epic for waves 1 and 2 whose three checkpoints are met by
  #2612, #2661 and #2746; one epic per wave from 3 to 7), and the plan's checkboxes for waves 1 and 2 ticked after the
  code was measured on `main` (`hierarchyOps.ts`, `ccrcCall.ts`, `planStore.ts`, `planPolicy.ts`, `planRoutes.ts`,
  `hierarchyRoutes.ts`, `shared/plan.ts`, `shared/private-names.mjs`, `publicTextClasses.ts` and
  `references/plan.md` all present). Run waves are numbered 3 to 7, of 7, so a run's wave matches the plan's.
- **2026-11-16 — migration slots (D-8673).** Wave 2's migration landed as entry 59, not 57. `main` ends at 82 today and
  open PRs hold later slots, so wave 4's migration (the plan's 58) takes the next free slot when it is built and is
  renumbered again at landing if one lands first.
- **2026-11-16 — an abandoned programme's initiative reads Canceled (D-8674).** Task 3.1 says an abandoned programme's
  initiative uses a canceled status only if FX2 found one. FX2's answer 2 found `Canceled`. So Task 3.3's row
  "initiative `Completed` with 'Abandoned on…'" becomes initiative `Canceled` with the "Abandoned on <date>: <why>"
  line. A finished programme still reads `Completed`. This follows the plan's own condition; it is not a new decision.

- **2026-11-16 — the programme page's Plan section is the desktop-polish Work card (agreed with that programme's
  coordinator).** The operator asked desktop-polish for a Work card on the programme page that shows a programme's work,
  done and remaining. Its design (#2913, `docs/superpowers/specs/2026-11-16-programme-work-map-design.md`) builds on
  this plan model unchanged, adds phases (`plan_phases`, `plan_phase_refs`), and keeps Task 5.2's read, done-when
  list and Open in Linear links. So wave 5 builds Tasks 5.1, 5.3 and 5.4, and not `PlanSection.tsx`. This is
  re-checked at wave 5's dispatch: if the Work card has not landed by then, the two coordinators agree who builds the
  section before either does. The Work card's WM0/WM1 and this programme's wave 4 both change `planStore.ts`,
  `planRoutes.ts`, `planPolicy.ts` and `ccd/ccrc-api`. Whichever lands second takes the next migration slot and merges
  the other's store changes.
- **2026-11-16 — a phase becomes a label on each issue it references, written by the sync (the operator's ruling on
  desktop-polish item 356, relayed by its coordinator).** The label is an owned field of the plan sync and of the
  drift rules (design §5.3, §6, §7.2). A ticket may be referenced by more than one phase, so an issue may carry more
  than one phase label. The phases come from the Work card's tables (`plan_phases`, `plan_phase_refs`, spec on #2913),
  which are not built yet. So this is scope for a later wave of this programme, planned once those tables land; the
  same rulings call a stage a phase, not a wave, on the console (items 354, 355).

- **2026-11-16 — wave 3's seven departures are issued D-8675 to D-8681 (the whole block), defined in the plan's
  "Deviations found" (where `deviation-refs.test.ts` reads definitions; its scan does not enter plan subdirectories),
  with the full record in the wave's task note `docs/superpowers/plans/2026-11-10-linear-hierarchy/w3-plan-sync.md`.** conflict-detail (D-8675),
  recovery-by-request-id (D-8676), link-by-fingerprint (D-8677), write-ask-destination-team (D-8678), pr-link-rule
  (D-8679), requeue-keeps-bound (D-8680), no-unlink (D-8681). All were accepted as the worker proposed them. Waves 4 to 7
  take a fresh block from the allocator. Carried to wave 4: what a project switched off after it was linked does to its
  existing link (D-8681 leaves the link in place); `creator { id }` on `issueOwned` at the next capture; a project's
  extra `teamIds` passed to the write policy.

- **2026-11-16 — an epic may list no waves (the operator's answer to desktop-polish item 359, relayed by its
  coordinator).** A run into a waveless epic names one of its tickets, and its wave is not checked against that epic.
  A run that names no ticket, into a plan where any epic lists no waves, is refused `ticket-required`. Epics that list
  waves keep `waves-not-contiguous`, `wave-overlap` and `wave-epic-mismatch`. The work-map plan's Task WM6 builds it
  (`shared/plan.ts`, `planPolicy.ts`, `openRun.ts`), after its WM0 and WM1. The design's §4.1 "Wave" call and §16
  call 2, and the plan's clause 21 (Task 6.1), are amended to match. Wave 4's Task 4.3 also changes `planPolicy.ts`,
  and its Upkeep epic is a natural waveless epic: whichever of WM6 and wave 4 lands second builds on the other by
  merge. The two coordinators agree the order at wave 4's dispatch.

- **2026-11-16 — review 2311 of wave 3 (tip `35bb54112`): fix round 1, and a second deviation block (numbers 8699
  to 8708, allocated for wave 3's fix round and waves 4 to 7).** Fixed in the round:
  - F1, an unread statuses page or an `unknown` initiatives probe defers instead of failing every epic (D-8701);
  - F2, a team key moved to another workspace creates no initiative there;
  - F3, a bound ticket's team stays on its epic's project;
  - F5, the snapshot leaves out put-back records, as Task 3.1 says;
  - F6, an open checkpoint's milestone leaves `targetDate` alone; ccrc owns the date only once the checkpoint is met
    (spec §6.2; the ruling is D-8700);
  - F7, route-level and lane-wiring tests that go red on mutation;
  - the advisories A2 (a mismatch with no old slot fails once), A5 (`item-act-mismatch`'s sentence), A7/A12 (a
    failure's backoff holds) and A8 (the note's record).

  D-8701's exit, ruled in the round: after 3 consecutive directory refills that read the initiatives probe as
  `unknown`, the pass settles without the initiative step and mails the programme's coordinator once per workspace
  and episode. It raises no "Turn on initiatives" item, because the probe never answers `off` and an unreadable probe
  is not a feature that is off. An `on` reading later creates the initiative and links the projects.

  Fix round 1 came back at `a1fb568bf` (main absorbed once). The worker ruled one point alone: unread project
  statuses keep waiting on the backoff and mail the coordinator once per episode after 3 unread refills, with no
  settle. Review round 2 (run 2332) is asked to judge that, the in-memory episode streaks (a restart can mail twice)
  and M3 (a failure in one workspace holds the whole programme).

  F4 is ledgered as D-8699 (ownership-by-name-first-page): proving ownership of an initiative or project with ten or
  more same-named objects can fail. The fix needs `creator { id }` on the by-id documents in the frozen `ops.ts`, so it
  waits for the next capture, on the operator's go. A1, A3, A4, A6, A10 and A11 are carried to wave 4.

## Carried constraints

Reviewers of every wave get these.

- **Build to FX2's facts, not the design's guesses.** Every hierarchy create takes a caller-chosen id. A repeated
  initiative or project id answers "conflict on insert"; a repeated milestone answers "name not unique" (bind the
  milestone of that name whose id is the step's `requestId`, never a second create). A milestone has no creator: it
  binds by exact name inside its bound project. Comments go on an initiative or a project, never a milestone.
  Updating a milestone does not move its project's `updatedAt` (and a description-only edit did not move its own).
  `InitiativeStatus` is Proposed, Planned, Active, Completed, Canceled. A project name is at most 80 characters, and
  an epic title allows 255: the sync fits the name to 80 before `projectCreate` and `projectUpdate`, and its by-name
  bind compares the name as sent.
- **Initiatives are on in every workspace the operator has.** The initiatives-off path (Task 3.5's item) is built and
  tested, but nothing live exercises it: `readInitiativesProbe` answers `on` or `unknown`, never `off`.
- **Six documents stay constructed** (`changedProjects`, `changedMilestones`, `changedIssues`, `teamOpenIssues`,
  `projectUpdate`, `initiativeToProjectDelete`). Tests run against the fixtures. No live Linear capture or probe without
  the operator's go, and only with the central key ccrc already holds. Never ask for, store or print another key.
- **Overlap.** The large-file programme (D-8635) freezes `server/src/coord/delegation-checkpoint.ts` (10 net lines a
  PR, no waiver) and caps `shared/api.ts` (absolute; it may only fall): new vocabulary goes in `shared/plan.ts`. Files
  of 1,500+ lines take caps, and `server/src/linear/ops.ts` stands at 1,441 lines. The listed files (`watch.ts`,
  `server.ts`, `coord/store.ts`, `coord/routes.ts`, `pwa/src/lib/api.ts`) grow at most 40 net code lines a PR. The ccd
  file split (#2907) moves functions out of `ccd/ccd` and yields to open PRs: this programme's bash change is
  `ccd/ccrc-api` only. Before editing a big file or ccd, list the open PRs; never start a move or split of our own.
- **Claims.** Other workers hold claims on shared files this programme touches (wave 3: `watch.ts`,
  `laneSchedule.ts`, `index.ts`, `server.ts`, `coord/routes.ts`, `lane-schedule.test.ts`, `run-routes.test.ts`,
  `secret-mask.test.ts`, `auth-gate.test.ts`, `shared/refusal.ts`). Work the uncontested files first, and ask each
  holder before editing a contested one. Never ask another worker to wait for this programme.
- **Public repo.** No Linear issue ids, team keys or names, workspace names, hostnames, account or session names, or
  emails in code, tests, commits or PR text. Cite D-numbers. The `ccrc-pwa` repository's linking mode is `public`.
- **Wave 3 makes the first real Linear writes.** From its deploy on, every programme with a declared plan, this one
  included, is created in Linear as an initiative with its epics. After it merges and deploys, the coordinator watches
  the first programme it creates and reports what it made, with links.
- **Wave 5 is console UI.** It is judged at phone (390), laptop (1280) and wide (1920), plus the plan's 360 and 1470,
  in both skins and both themes. Every operator action is a console control on the item it concerns.
- **Wave 7 touches real teams.** Pilot team first; its report goes to the operator before any other team. Approvals
  happen in the console, never in chat.

## Next-wave brief

Wave 3 (D-8182), the plan sync: plan Tasks 3.1 to 3.5, on a fresh child, building on `main` (waves 1 and 2 and FX2
merged). Departures already ruled: D-8673 (no migration in this wave), D-8674 (abandoned → `Canceled`), and the FX2
departures in D-8407 (milestone binds by name, "name not unique", the 80-character project name). New departures take
numbers from this programme's block (numbers 8675 to 8681), issued by the coordinator.
