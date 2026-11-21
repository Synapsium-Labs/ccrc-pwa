# Program: linear-hierarchy

Spec: `docs/superpowers/specs/2026-11-10-linear-hierarchy-design.md` (approved by the operator 2026-11-10, #2574)
Plan: `docs/superpowers/plans/2026-11-10-linear-hierarchy.md` (its "Deviations found" section is binding)
Fixtures: `server/test/fixtures/linear/README.md`, "What FX2 measured"
Home project: `ccrc-pwa`   Coordinator: the claimant of the programme's runs (`ccrc-api runs list`)
Workspace: **a fresh child per wave** (one PR per child; every wave builds on the previous wave's merged code)
Deviation blocks: numbers 8672 to 8681 (allocated 2026-11-16 at run-open; D-8672..D-8674 defined in the plan, the rest issued
by this coordinator in briefs), 8699 to 8708 (2026-11-16), 8720 to 8725 (2026-11-17) and 8733 to 8742 (2026-11-18, for the
wave 4 follow-ups and waves 5 to 7). The waves' own numbers stay D-8182..D-8186.

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
| 3 | the plan sync: open, move and close of the Linear objects; the initiatives-off item; the item act route; dispatch waits for its ticket's issue | D-8182 | #2941 | **merged** 2026-11-17 as `806246f55` (head `77d1b427d`, by the merge queue; run 2243 closed done): run 2243 (ticket `w3-plan-sync`), branch `ws/linear-hier-w3`, wave-done at `35bb54112` (5/5 items); review run 2311 found 7 important (F1-F7), sent back for fix round 1; fix round 1 done at `a1fb568bf` 2026-11-17; review round 2 (run 2332) found 1 important (plan text only) and 9 advisories: **accepted**, enqueued at `a1fb568bf`; dequeued 2026-11-17 on a conflict with main in `laneSchedule.ts` and `lane-schedule.test.ts`, sent back as an ejection (base `f4905e009`) for one merge of main; merged at `77d1b427d`, review round 3 (run 2346, the held-out panel) clean, re-enqueued at `77d1b427d` |
| 3 fix | Linear's 255-character description cap; the cancel comment's journal field | D-8708 | #2973 | **merged** 2026-11-17 as `d3f357f24` (head `640458837`; run 2358 closed done; reviews 2364 and 2368; dequeued once on a collector test's load timeout and re-enqueued) |
| 4 | drift, inbound and public text: migration (landed as **95**), the drift pass, persistent drift, `plan triage`/`plan take`, the Upkeep epic, the Linear owner item, `plan-owned` | D-8183 | #2982 | **merged** 2026-11-18 as `98d3b29d4` (head `9c9e42614`, by the merge queue; run 2337 closed done): Tasks 4.1–4.4 plus Task 4.5, wave 3's carried findings; six review rounds (2386, 2394, 2408, 2427, 2435 withdrawn, 2443), the cap lifted by the operator after round 3; dequeued once on a migration conflict with #2987 and ejected for one merge of main |
| 4 follow-ups | the gaps wave 4's reviews carried (D-8725): restores honour every hold, drift scope follows the binding, the page cursor, retired inbound rows, lost-reply creates, the read order, and the advisories | D-8183 | #3021 | **merged** 2026-11-19 as `04b297898` (head `11788af93`, by the merge queue; run 2446 closed done): D-8733..D-8736 defined; five review rounds (2457, 2524, 2571, 2753, 2798), the cap lifted by the operator for rounds 4 and 5; dropped by the queue once on a migration conflict, then five merges of main as other PRs took slots 101 to 106, landing as migration **107** |
| 4 follow-ups, second set | the findings rounds 3 to 5 carried (below) | D-8183 | #3088 | **merged** 2026-11-20 as `b60aeefd2` (head `4098b57c3`, by the merge queue; run 2810 closed done): three review rounds (2834, 2874, 2885); round 3's minors went to the clause follow-up |
| 5 | the console: the project row's hierarchy settings, the epic and Upkeep pages, the five hierarchy items' controls (Tasks 5.1, 5.3, 5.4; the Plan section is the work map's Work card) | D-8184 | #3022 | **merged** 2026-11-18 as `8d6e5c03c` (head `f36c800fc`, by the merge queue; run 2447 closed done): three review rounds (2453, 2462, 2491); accepted at round 3 with one dormant finding and the advisories carried to wave 7 |
| 6 | the coordinator, worker and Linear skills (without the coordinator's plan clause, D-8739) | D-8185 | #3040 | **merged** 2026-11-18 as `6f5421139` (head `3a40c558b`, by the merge queue; run 2505 closed done): three review rounds (2580, 2590, 2597) |
| 6 clause | the coordinator's plan clause (22), its count words in README and CLAUDE.md, the Linear skill's wording, `api.md`'s pointer to `plan.md`, and #3088's leftover words and pins (D-8739) | D-8185 | #3119 | **merged** 2026-11-20 as `9c3c5dddf` (head `fab3d9cf6`, by the merge queue; run 2878 closed done): three review rounds (2920, 2929, 2960); accepted at the cap with its last words carried to ticket `w6-words` |
| 7 | the per-team migration: start, map propose and check, approve, apply, report, follow-up maps, put back | D-8186 | #3109 | **merged** 2026-11-20 as `7d517766f` (head `983ffcd67`, by the merge queue; run 2846 closed done): D-8795 to D-8802 defined; three review rounds (2892, 2918, 2955); accepted at the cap, migration **114**; round 3's findings went to `w7-fixes` |
| 7 fixes | review 2955's findings: the report keeps a level closed with no relation, an issue the owner has taken leaves the migration (listed taken), a close asks again before each write, put back leaves a held issue alone | D-8186 | #3137 | **merged** 2026-11-21 as `4ef2c2518` (head `085a48a14`, by the merge queue; run 2984 closed done): three review rounds (2998, 3004, 3016); accepted at the cap, two narrow windows carried to `w7-race`; its two issued numbers unused |
| pilot fixes | the migration resolves a project's team through its workspace (`w8-migration-workspace`), a take during put back's or reconcile's read (`w7-race`), and review 3020's words | D-8186, D-8808 | #3145 | **merged** 2026-11-21 as `e6522b99b` (head `35e7f1d91`, by the merge queue; run 3027 closed done): three review rounds (3038, 3048, 3073); accepted at the cap with its last findings fixed in `w8-pilot-guards`; its two issued numbers unused |
| pilot guards | review 3073's findings: the console state reads Not measured with no Reshape when the owner or the row's own workspace cannot be measured, red tests for three standing guards, true console sentences for a refused Return and for `unreachable`, one owner answer for a failed listing and an unreadable slot (`w8-pilot-guards`) | D-8186, D-8808 | #3150 | **merged** 2026-11-21 as `de0825f46` (head `cf8bc1900`, by the merge queue; run 3082 closed done): two review rounds (3087, 3096); ships in v0.0.1369 and later |
| 6 words | the plan reference and the ledger say what the code does: `malformed` and the doors' `unreachable`, triage's own decisions, a held ticket, clause 22's words recorded (`w6-words`) | D-8185, D-8808 | #3151 | **merged** 2026-11-21 as `bedc03d85` (head `83f5ece6b`, by the merge queue; run 3102 closed done): three review rounds (3106, 3110, 3121); landed with known limits, carried to `w6-unreachable-scope` (run 3129) |
| 6 unreachable | the plan reference names every cause of `unreachable` at the doors (`w6-unreachable-scope`) | D-8185, D-8808 | #3155 | **merged** 2026-11-21 as `fd16dcd0c` (head `1fb38e62d`, by the merge queue; run 3129 closed done): one review round (3144); its minor words carried to `w6-plan-ref-words` |
| 8 triage | the triage row choice decides in the plan policy, with one holder predicate (`w8-triage-l1`; D-8808's stated bend closed) | D-8808 | #3157 | **merged** 2026-11-21 as `6574dcd6f` (head `e4daf0aba`, by the merge queue; run 3155 closed done): two review rounds (3172, 3180); no behaviour change |
| 8 | team and workspace mapping (spec §3.1): the project row's workspace, the pass over workspace and key pairs, attached issues as evidence (built, off), a coordinator's suggestion, the Overlord's link as a call made for the operator, the console | D-8808, D-8809 | #3123 | **merged** 2026-11-21 as `6c3ea2c55` (head `dbc6483eb`, by the merge queue; run 2862 closed done): three review rounds (2971, 2997, 3020); accepted at the cap, migration **116**; six follow-up tickets, one dropped as built |

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

- **2026-11-17, review round 2 of wave 3 (run 2332), ruled by the coordinator.** Every ruling of fix round 1 is built
  as ruled, each with a named test seen red. Wave 3 is accepted and lands at `a1fb568bf`. The rulings:
  - F1 (the plan's interface text for `markSyncDue`, `deferSync` and `ensureTicketBound` is now false): the change
    follows the plan's own outcome table ("deferred by the backoff"), so it is a departure in the interface text, not
    in intent. It is D-8702 (failure-hold): `plan_sync_due.attempts` marks a failure's hold, `deferSync` takes
    `why = failure | wait` and a wait resets the mark, `markSyncDue` keeps a held `dueAt`, and a held programme's
    dispatch starts no pass. The coordinator defines it in the plan and amends the interface lines on this ledger PR,
    after #2941 merges, so the worker's PR needs no further push.
  - The worker's unruled calls are accepted. Unread project statuses keep waiting, with no settle, because the
    workspace cannot sync until its statuses read; the cost is bounded in calls (about 36 to 108 directory calls an
    hour per slot) and in mail (one an episode). The hold also covers rate-limited, malformed, a refused key, an
    unreadable store and an ok answer with no id. The episode mail is once per programme, workspace and episode.
  - Carried to wave 4: A1 (a restart loses the probe's settled mark, so a refill that reads `on` creates no initiative
    until something marks the programme due: persist the mark or mark every programme due at boot); the in-memory
    episode streaks (a restart can mail once more); M3 with A9 (a failing workspace starves the programme's later
    steps in other workspaces: hold per workspace); A3 (three decisions left in planSync's L4: the probe re-check, the
    held dispatch and `deferFor`); A4 (a project updated while its initiative failed re-sends its link once); A6 (the
    probe mail misstates a bound initiative's wait and an unclosed end); A7 (a test that never asserts its second
    statuses read); and round 1's A1, A3, A4 and A11.
  - Carried to wave 7's brief: A5 (`ticketOfRun` reads tickets that were put back) and the F3/F5 interaction (a bound
    ticket put back may take its held team off its project).
  - Wording, fixed on this ledger PR: D-8699 retries at every requeue, refill and plan change, and only its mail is
    once (A8); neither wait is bounded in time while refills fail, so "both waits are bounded" becomes "both are
    bounded in calls and mail" (A2); M3 holds for as long as the failing workspace keeps failing, not 30 minutes (A9).

- **2026-11-17 — wave 3 landed and wave 4 dispatched (the coordinator).** #2941 merged by the queue at `806246f55`
  (head `77d1b427d`) and run 2243 closed `done`. On this ledger PR D-8702 (failure-hold) is defined in the plan's
  "Deviations found" and the interface lines for `markSyncDue`, `deferSync` and `ensureTicketBound` are amended to
  it; D-8699's wording, the wave 3 note's "bounded" sentence (A2) and its M3 line (A9) are corrected; wave 3's
  checkboxes are ticked. The wave 3 note stays where it is, because the plan's D-8675..D-8702 cite it as their record.
  Wave 4 (run 2337) carries wave 3's findings as a Task 4.5 of its own: five correctness fixes first (persist the
  probe's settled mark or mark every programme due at boot; hold per workspace; the project's team before the issue's
  create; adopt and move an object stranded by a team-key change; extra `teamIds` to the write policy), then six that the
  worker may ask to defer. Desktop-polish's WM6 has not started, so wave 4 changes `planPolicy.ts` first; whichever
  lands second merges the other once. Its coordinator was told at dispatch.

- **2026-11-17 — wave 3's first live run, and a fix (the coordinator).** Once wave 3 deployed, the sync failed the
  programme's initiative and five of its six epics with `linear-invalid`. Measured from the plan: the one epic created
  had a 248-character description, and the five that failed had 338 to 474. Linear refuses a description over 255
  characters, and FX2 had measured only the 80-character name cap. Fix run 2358 (#2973, D-8708) fits initiative,
  project and milestone descriptions to 255 and puts the status notes first. The public-text check reads both the full
  and the cut text (review 2364's F1). Wave 4's worker found a second live defect, and the same PR fixes it: the
  cancel comment journalled its field as `comment`, which the journal refuses, so a programme with a dropped ticket was
  held on its backoff for ever. Review 2368's advisories are ruled: D-8708's wording is corrected on this ledger PR (a
  fitting body ending in whitespace also moves once; only the first note is never cut). The idempotence, noted-current
  and astral-character tests, and placing spec 7.2's dated Restored lines before the cut, go to wave 4. Spec 6.1 is
  amended for the cap. Sending the full text in `content` waits for a capture, on the operator's go. Spec
  modification 39 cannot be marked merged, because it was recorded before its ledger PR existed: from now on the ledger
  PR is opened before `goals modify`.
- **2026-11-17 — the work map's WM0 starts before wave 4 lands (the coordinator, with desktop-polish's coordinator).**
  Wave 4 grants WM0 a co-edit on the plan files. Whichever lands second takes the next migration slot, merges the
  other's store changes once and re-measures the count pins.

- **2026-11-17 — wave 4's departures and questions (the coordinator).** Issued and defined in the plan by the worker:
  drift-actor-unread (D-8703), catch-up-by-fingerprint (D-8704), inbound-open-and-kept-text (D-8705),
  triage-own-programme-epic (D-8706) and write-ask-project-teams (D-8707). D-8681's link is ruled one-way: a planned
  link that is missing is drift, and an extra link is not. The seven-day persistence window joins the token-shared
  census as a separate quantity (design §7.4). The full record is the wave's task note
  `docs/superpowers/plans/2026-11-10-linear-hierarchy/w4-drift.md`, which stays where it is because the plan's
  D-8703..D-8707 and D-8720..D-8725 cite it.

- **2026-11-17 to 2026-11-18 — wave 4's review rounds, ruled by the coordinator.**
  - Round 1 (run 2386) found four important and four minor defects; all were fixed. A third block was allocated and
    four departures issued: kept-plan-quiet (D-8720), restore-comment-daily (D-8721), issue-adopt-by-id (D-8722) and
    w4-schema-additions (D-8723).
  - Round 2 (run 2394): an inbound close's hold clears only once its cancel succeeds; a deferred restore keeps the
    watermark of every kind whose event rides on it (a D-8723 clause); only *Keep the plan* quiets persistence.
    A key that is not configured is a plain retry each beat in both lanes, mailed to the owner once and making no
    Linear call. A refused key (401) goes through the plan sync's one owner of slot rejection and holds both lanes for
    that workspace. The inbound lane keeps its own holds for the other retry words, because an inbound close must
    never hold a programme's plan sync.
  - Round 3 (run 2408): a close's malformed answers count per issue, not per workspace; a rate-limited answer's wait
    floors the close's hold; each refusal word has its own owner mail, once per issue. The review cap was reached
    here, and the operator lifted it for the run. #2964's done-test reader guard went red on the drift grace's own
    reading of a run's merge, so that reading moved to the done tests' one reader and one decider, with the guard
    unchanged. D-8703 gained a clause: the grace accepts any completion after a merge, because the actor is unread.
  - Round 4 (run 2427) accepted the wave at `41a8c443e`. Its A3 and A4 are D-8724 (w4-names-and-pass-word),
    defined on this ledger PR with the plan's interface lines amended.
  - The queue dropped the PR on a conflict with #2987, which had taken migration 94 and added a lane. The run was
    ejected for one merge of main, and the wave's migration landed as 95.
  - Round 5 (run 2435) was withdrawn when #2996 (the other-lanes table) landed. Its report still came and found the
    first merge exact on both sides.
  - The crossing with #2996: the table gains two plan-door rows (`planTake`, and `planTriage` keyed on its team), and
    the triage door asks the table right after the caller's identity, as every plan door does. #2996's census was
    widened to pin the same order for both door helpers, with the same meaning.
  - Round 6 (run 2443) found nothing in its scope, and the wave landed.

- **2026-11-18 — wave 4 landed; the follow-ups and wave 5 run in parallel (the coordinator).** #2982 merged by the
  queue at `98d3b29d4` (head `9c9e42614`), and run 2337 closed `done`. The checkpoint `drift-landed` is met. On this
  ledger PR D-8724 and D-8725 are defined and wave 4's checkboxes are ticked. The gaps the reviews carried are D-8725
  (w4-carried-gaps), and they go to a follow-up run of the drift epic (run 2446, ticket `w4-follow-ups`), ruled to land
  before wave 7. From wave 4's deploy, the drift pass and the inbound lane act on every team that holds a bound project,
  and today that is this programme's own team. Nothing in D-8725 deletes or adopts anything in Linear. With no Linear
  owner set, an issue filed straight into that team waits, and its project raises one *Name a Linear owner* item.
  Issues the fleet files through the proxy are ccrc's own and never inbound. The coordinator watches the first passes
  after the deploy and reports what they did. Wave 5 (run 2447) builds Tasks 5.1, 5.3 and 5.4. The work map's Work card
  has not landed, and desktop-polish's coordinator was told the split stands.

- **2026-11-18 — wave 5's review rounds, ruled by the coordinator.**
  - Round 1 (run 2453) found four important findings. Check again read "Sent." when nothing was queued. The linking card
    unlocked a row on a stale read and could quietly revert a saved setting (two findings, one rule). The owner select's
    default option named nobody for a named owner or a shared-key sibling. All were fixed, with A1 to A7. D-8737
    (map-shapes-early) was issued at build time: Task 7.1's map shapes go into `shared/plan.ts` verbatim and the map and
    report bodies stay unwired until wave 7.
  - Round 2 (run 2462) found two important findings. A 5xx unlocked a row as a refusal would, so the card now uses the
    repo's `writeOutcomeUnknown`. The default option named the named owner, not who choosing it gives. The ruling is
    that the option names who the operator gets by choosing it. The server computes that pick (`ownerNow.ifUnnamed`),
    beside `ownerNow.project`, which fix round 1 added. Both are D-8738 (owner-now-wire), optional fields in a wave the
    plan calls PWA-only. D-8737 was amended: the map body draws counts and class groups, and wave 7 adds spec §11.3's
    epics and checkpoints section with its read.
  - Round 3 (run 2491) found one important finding, dormant until wave 7, and eight advisories. The review cap was
    reached and none blocks the wave, so all are carried to wave 7 (below).

- **2026-11-18 — wave 5 landed; wave 6 opened (the coordinator).** #3022 merged by the queue at `8d6e5c03c` (head
  `f36c800fc`), and run 2447 closed `done`. The checkpoint `console-landed` is met. Wave 5's checkboxes are ticked on
  this ledger PR. Task 5.2 is left unticked with a line saying the Work card replaces it. Desktop-polish's coordinator
  was told that `epicPath` is on main, so the Work card's epic row can link to the epic page. Wave 6 (run 2505) was
  opened before run 2447 closed. Its brief names the skill files other open PRs also change: the coordinator's recall
  clause (#2919, also a clause 21), `ticket-required` in `references/plan.md` (#3001), and #2997 and #2986. Whichever
  lands second renumbers and merges main once.

- **2026-11-18 — review round 1 of the wave 4 follow-ups (run 2457), ruled by the coordinator.** Two guards had no test
  that goes red: the drift pass's skip of a sync write landing after its read, and plan take's choice between two
  handed rows of one identifier. Two findings need code:
  - The restore comment now quotes values, including a Linear project name people typed, so it passes the public-text
    check before it is sent (spec §6.1). If the check refuses, the fields are still restored, and the comment falls
    back to the fixed sentence that names only the fields restored.
  - A stored inbound row whose issue moves out of a managed team is retired with its own cause. Take, triage and the
    close re-read the issue first and refuse. The lane re-reads open rows by id on a bounded interval and stores
    nothing new of the issue.
  All six advisories are fixed in the same round.

- **2026-11-18 — wave 6 split, then landed (the coordinator).** The coordinator skill's pin file and README were frozen by
  another programme's open work, so wave 6 shipped the skills without the coordinator contract's plan clause (D-8739,
  skills-clause-later). The clause, its count word and the README and CLAUDE.md words are the follow-up ticket
  `w6-clause` under the skills epic. Round 1 (run 2580) added the console-only approvals rule to the coordinator's
  Linear pointer and corrected the follow-up filing rule. Round 2 (run 2590) corrected that ruling again: a worker files
  a follow-up with `plan ticket-add` whenever its run has a ticket, and only a `plan-owned` refusal narrows it. Round 3
  (run 2597) was accepted with four findings carried to the clause follow-up. #3040 merged by the queue at
  `6f5421139` (head `3a40c558b`), and run 2505 closed `done`. The checkpoint `skills-landed` stays open until the clause
  lands.

- **2026-11-19 — the coordinator clause's number (the coordinator, agreed with the Overlord).** The Overlord's autonomy
  clause (D-8126) takes clause 21 and lands first. This programme's plan clause becomes 22, with its count word, on a
  package rebuilt against main as that change leaves it. The two are not combined into one request.

- **2026-11-18 to 2026-11-19 — the wave 4 follow-ups' review rounds and landing (the coordinator).**
  - Round 2 (run 2524) sent the run back once more under the coordinator's rulings. Round 3 (run 2571) was accepted at
    the review cap, and its findings are carried to a second follow-up run (below). One ruling from round 3 binds that run:
    with an unmeasured home, `plan take` fails closed rather than resolving an Upkeep ticket by identifier alone.
  - The queue dropped the PR on a migration conflict. Other PRs then took slots 101 to 106 one after another (#3003,
    #3045, #3035, #3043, #3056, #2997). The coordinator agreed with the other programmes' coordinators that landing
    order settles every slot: a later lander makes a rows-only renumber (the schema entry, the coord-db count pins, the
    run-close undo order and replay count, and the note's words). A rows-only renumber of an accepted tip lands without
    review; a merge that resolves code files gets a narrow merge review. The task note moved to
    `docs/superpowers/programs/linear-hierarchy/w4-follow-ups.md` for the ledger guard's layout arm (#2986, D-8719).
  - The operator lifted the review cap for run 2446. Round 4 (run 2753) read the merges and the move and was clean.
    Round 5 (run 2798) read the slot-107 merge, which resolved five code files beside #2997's `plan ticket-done` row,
    and was clean. Main's ticket-done capability gate stands beside this run's table gate; folding it in is carried.
  - #3021 merged by the queue at `04b297898` (head `11788af93`), and run 2446 closed `done`. D-8733 (drift reads every
    team), D-8734 (the drift cursor and return tables), D-8735 (inbound rows retired) and D-8736 (the follow-ups' words)
    are on main.

- **2026-11-19 — the second follow-up run (the coordinator).** Run 2810 (ticket `w4-follow-ups-2`, drift epic) takes what
  rounds 3 to 5 carried: a returned or reopened inbound note cleared inside triage's and take's transaction (a code fix
  with a test), the unmeasured-home ruling, the drift record's wording for one-way link fields, two missing tests, the
  public-text check before the inbound lane's close post, single-definition rows for three shared lists, the
  ticket-done gate folded into the client's table gate, and the refusal lists, comments and note figures. After
  desktop polish's #3075 (an epic may list no waves) merges, it also rewords the plan's wave-epic-mismatch lines and
  Task 2.1's epic wire contract; the coordinator amends the spec's §12 on a ledger PR. Numbers 8740 and 8741 are issued
  to that run.

- **2026-11-19 — the repo's review judge on #3088 (the coordinator).** The judge reads #3088 red for rules-mixed (the
  coordinator skill's two reference files beside code) and proof-not-built. As for #3040 and wave 4, no split: the judge
  is not a required check, and the reference edits name the refusals of the code they ship with.

- **2026-11-19 — team and workspace mapping (the operator, item 489).** The operator asked whether coordinators or the
  Overlord could map a project with no mapping to a Linear team and organisation, noting that several repositories may
  share one team; a product of several repositories is left for later. The operator chose: coordinators suggest a team,
  and the Overlord may link one as a call made in the operator's name. The spec gains §3.1 (the project row names a
  workspace; the pass reads workspace and key pairs; issues attached to the repository's pull requests are evidence, off
  until the operator's go for one live capture; the coordinator's suggestion; the Overlord's link) and design calls 30 to
  32; the plan gains wave 8, alongside wave 7's pilot.

- **2026-11-20 — an epic may list no waves, on main (the coordinator).** Desktop polish's #3075 (WM6) merged at
  `208afddca`. The spec's §4.1 amendment, §12's coordinator line and design call 2 now say which epics count (live
  ones) and when a run with no ticket is refused `ticket-required`. The plan's wave-epic-mismatch lines and Task 2.1's
  wire contract (`waves?` on `PlanEpicBody`) are run 2810's item 14, taken into its fix round.

- **2026-11-20 — the operator answers item 496 (the landing-order programme).** Its coordinator then accepted additive
  packets from every programme. The clause follow-up landed clause 22 in #3119 itself rather than in a run of its own,
  and waves 7 and 8 set README's lane count word through the same packets. The coordinator's item 502, which pointed at item 496, was
  withdrawn as moot.

- **2026-11-20 — wave 7's rulings (the coordinator).** D-8795 (the migration's policy interfaces), D-8796 (the
  migration goes through the plan sync, charged to lane `migration` with a per-tick budget), D-8797 (the Upkeep link
  shows whenever there is a team key), D-8798 (apply sets planRequired only for programmes the map names or that have
  declared a plan), D-8799 (the map item settles on Approve), D-8800 (the migration's columns), D-8801 (a finished
  entry carries a pull request or a one-line reason) and D-8802 (planBy follows the last put). Review round 3 (run
  2955) found defects that cannot fire until the operator starts a team's migration, so #3109 landed at the cap and a
  follow-up run fixed them: an issue the team's Linear owner has taken through inbound leaves the migration, is listed
  taken, is never written over, and is never named in the owner's map mail.

- **2026-11-20 — the live capture (the operator, item 498).** The operator said go: one read-only capture of the issues
  attached to this repository's pull requests, through the central key, once Task 8.3's read is merged and deployed.
  The coordinator runs it, records the answer as a scrubbed fixture in a follow-up, and only then may the evidence be
  wired (ticket `w8-attached-wire`).

- **2026-11-20 — wave 8's rulings (the coordinator).** D-8808 (the mapping wave's departures) and D-8809 (the
  Overlord's confirm: act kind `link-team` at the full rung only, its calls filed under `linear-sync`, the link stored as
  source `auto` plus its call id, one function deriving the wire's source). In review: a key written with no workspace
  is stored only when one connected workspace holds it (two is refused `team-ambiguous`, an unreadable store
  `unavailable`); an unchanged Save is not the operator's decision; only a session that claims an open run may suggest
  a team, one suggestion each; the Overlord's call names no session.

- **2026-11-21 — what waits before the pilot (the coordinator).** Review 2997 found the migration lane and the plan-map
  route still resolve a team by its key alone, and review 3016 found two windows where an owner's take lands during one
  read. Both are wave 7's code; run 3027 fixes them with review 3020's words. The pilot team's migration is not started
  before that run lands, and its report goes to the operator before any other team.

- **2026-11-21 — the owner rule answers three ways (the coordinator; call 36, big).** When ccrc cannot read which
  workspace a team key belongs to, the owner is never guessed from the projects that name their workspace. The one owner
  rule answers an owner, none, or unmeasured, from one routing reader that tells an unreadable record from an empty one.
  On unmeasured every consumer refuses (`unreachable`) or holds and retries, nothing is mailed, recorded or settled,
  and the console shows Not measured with no Reshape. A Return never settles without a recipient. Built in #3145 and
  #3150, recorded in D-8808.

- **2026-11-21 — landing at the review cap (the coordinator; calls 40, 41 and 76, routine).** #3145 landed at the cap as
  safer than main, its last findings fixed in #3150 before the pilot. #3151 stayed whole although the review judge
  flags rules-mixed, because a pin test cannot leave the rules file it pins without turning a required check red; it
  landed at the cap with known limits carried to `w6-unreachable-scope`.

- **2026-11-21 — the pilot gate is clear (the coordinator).** The operator's item 533 asks for a rollout of v0.0.1369 or
  later and one team's map from the console (Reshape in Linear, then Ask for the map). The report goes to the operator
  before any other team is started. The live capture of item 498 follows that rollout.

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

Every planned wave and every fix before the pilot has landed (#3145, #3150). The pilot is the operator's alone (item
533): a rollout of v0.0.1369 or later, then one team's map from the console; its map is approved there; its report goes
to the operator before any other team is started. After that rollout the coordinator makes item 498's one read-only
capture, records it as a scrubbed fixture, and only then may `w8-attached-wire` switch the evidence on.

In flight: run 3187, ticket `w8-ambiguous-notice` (an item for the operator when a shared team key sits only on rows that
name no workspace; review 3048 F5).

Open follow-up tickets: `w6-plan-ref-words` (review 3144's words in the plan reference), `w8-attached-wire` (after the
capture), `w8-overlord-skill`, `w8-call-anchor` and `w8-skill-section` (the coordinator skill's linking section, reviewed text in the wave 8 note). Each is a
rules or small code change of its own.
