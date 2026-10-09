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
| 1 | server: L0 wire types and texts; L1 `stallsettings.ts` (ladder, resolver, write effect and key, counts, busy clock); `stall.ts` (quiet time, backoff ceiling, busy clock bound); the migration and store methods; both sweeps through one never-throwing resolution; `GET`/`POST /api/coord/stall-watch` and their censuses; README, `CLAUDE.md` and the parent spec | server | #320 | merged `7f7bf4afc` 2026-10-07 (v0.0.119); run 295 closed `done` (R20) |
| 2 | the Settings section: API client and hook; a multi-line `QuickConfirm`; `StallWatchSection`; the Notifications label rename; README; wave 1's review residue | server (it serves the PWA) | #322 | run 322 `awaiting-review` at `451854d1d`; review 340 accepted; merge awaits the operator (R31) |

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
- **R5 (2026-10-06 11:39)**, run 260's shared claims do not block W1's start.
  - PR #285 merged as `4e7cf095f`; all of its checks passed. Run 295 is open in `planned` state, and the programme's
    deviation block is not allocated again.
  - Run 260 still holds `shared/api.ts`, `server/src/coord/store.ts`, `server/src/watch.ts`,
    `server/src/coord/routes.ts` and related tests for child-reclamation W5. The W1 plan names this exact overlap and
    says it does not block the start: the worker takes the full all-or-nothing claim, reports the expected 409, and
    works only uncontested paths until the coordinator sequences the shared paths after release.
  - Preserve the seven-item wave. The child-reclamation coordinator was notified by mail 3674; no early release was
    asked. Any same-sentence co-edit still stops for a coordinator ruling under the plan's overtaken-PR rule.
- **R6 (2026-10-06 11:47)**, dispatch waits at the measured concurrency cap.
  - The first dispatch of run 295 was refused `cap-concurrency`, with `limit: 7` and `running: 7`. The server spawned
    and held nothing; the run remains planned, with its seven-item brief and route ready to resend unchanged.
  - Wait for one active run to leave `dispatched`, `working` or `unknown`, then retry run 295 once. Do not open a
    replacement run, change routing, split the wave or bypass the cap.
- **R7 (2026-10-06 11:50)**, child-reclamation W6 and this wave proceed without ordering each other.
  - The child-reclamation coordinator's mail 3675 names its planned run 291 and merged plan #293 (`26e3318b`). That
    wave also edits `shared/api.ts` additively and makes a small mirror-clock/frame edit in `server/src/watch.ts`;
    it does not edit `server/src/coord/store.ts` or `server/src/coord/routes.ts`.
  - Once run 260 releases its claims, both waves may proceed. Edits stay in their own regions; whichever PR lands
    second merges current `main` (never rebases), resolves only structural adjacency, and re-runs `single-definition`,
    `typecheck-tests`, the `session-hook` citation cases and `deviation-refs`. A same-sentence edit still returns for
    a coordinator ruling under R5 rather than being resolved mechanically.
- **R8 (2026-10-06 11:54)**, the one cap retry reached the rolling daily gate.
  - The retry first confirmed run 295 was still planned, run 260's overlapping claims were still live, and
    `origin/main` `b3b5a73ed` still carried 16 migrations. Dispatch was then refused `cap-daily`, with `limit: 24`
    and `used: 24`.
  - The server again spawned and held nothing; run 295 remains planned with no workspace, branch or queued brief.
    Do not poll, retry again, open another run or alter routing. Resume from this run after the rolling budget ages out.
- **R9 (2026-10-06 12:37)**, the operator-directed resume still met the rolling daily gate.
  - `ccrc-api whoami` proved this pane is the programme coordinator `ccrc-pwa-calm-harbor`. Run 295 remained planned,
    `origin/main` remained `b3b5a73ed` with 16 migrations, and run 260 still held the expected overlapping claims.
  - The unchanged seven-item brief and R4 route were dispatched once. The server refused `cap-daily` with `limit: 24`
    and `used: 24`, creating no worker, workspace, branch, hold or queued brief. Leave run 295 planned and make no
    replacement, split, routing change or further retry until there is a real indication that the rolling budget cleared.
- **R10 (2026-10-07 09:58)**, wave 1 is dispatched.
  - A complete `runs list --closed 1` snapshot at 09:56 measured 19 of 24 rolling dispatches and 3 active runs. Run 295
    was this programme's only open run, still planned and untouched.
  - `ccrc-api whoami` proved this pane is `ccrc-pwa-calm-harbor`. `origin/main` `58de9f969` still carries 16
    migrations, so slot 17 stays free, and the W1 plan blob is unchanged.
  - Claims: run 260's are gone. Of the W1 claim set, run 291 (child-reclamation W6, claim 1070) holds `shared/api.ts`
    and `server/src/watch.ts`, as R7 foresaw, and run 302 (ccrc-history W2 B1, claim 1072) holds `README.md` and
    `CLAUDE.md`, which only Task 7 edits. The brief's claim rule covers both holders: the worker reports the 409 with
    its holder and paths, works only uncontested paths, and the coordinator sequences each release.
  - The unchanged seven-item brief and R4 route went out once. The server spawned `ccrc-pwa-swift-meadow` (workspace
    `swift-meadow`, branch `ws/swift-meadow`): `adopted` false, `spawnState` null, `skillState` present, brief queued.
    The run reads `dispatched` with 0 of 7 items. The registry shows the route applied as `class=opus effort=high
    subagent=sonnet workflow=off` with compact 40, and the hold `program:stall-watch-settings wave:1/2 run:295`.
- **R11 (2026-10-07 10:03)**, the claim 409: one regioned co-edit is asked for, and everything else waits.
  - The worker's mail 3809: the full 28-path claim was refused, as R10 expected. It holds claim 1074 on the other 24
    paths, keeps the four contested ones declared, and edits nothing contested. Task 1 begins with `shared/api.ts`, so
    the chain cannot start while claim 1070 holds it.
  - Measured: run 291 still needs both paths. Its remaining Tasks 8, 10, 11 and 12 modify `shared/api.ts`, where its
    edits sit at `LifecycleMeas`, mid-file, and its Task 12 modifies `server/src/watch.ts`. Claim 1070 can run to
    16:54 UTC. Run 302's claim 1072 says that wave is down to its confirmation suite and PR, and only W1's Task 7 needs
    `README.md` and `CLAUDE.md`.
  - Ruling: claims stay exclusive by default, and a lapse is not a release. The worker takes a contested path only on
    this coordinator's confirmation. Mail 3813 asks run 291's coordinator to consent to one co-edit: W1 appends its new
    block at the very end of `shared/api.ts`, changes no line above it, and lands under R7's merge rule. On consent,
    Task 1 starts under that limit; on a refusal, it waits for claim 1070's release. `server/src/watch.ts` (Task 5)
    and `README.md`/`CLAUDE.md` (Task 7) are not in the request; they are re-read when W1 reaches them. The worker
    has this as mail 3814.
  - Why: R7 already lets both waves proceed in their own regions, and a block appended at the end of the file cannot
    textually meet 291's mid-file edits. Cost if wrong: one structural merge in `shared/api.ts` at the second landing.
- **R12 (2026-10-07 10:05)**, Task 1 starts under the consented co-edit.
  - Run 291's coordinator answered yes in mail 3815, under exactly R11's limits. It measured run 291's own edits to
    `shared/api.ts` at its tip `e5effb842` as interior only: `CoordStatus` near :3813, `LcRefusalToken` and
    `LC_REFUSAL_WORD`, and `LifecycleMeas` near :7640. If W1's block cites `shared/api.ts` lines and wave 6 lands
    first, re-pointing them is W1's.
  - Checked against the merged W1 plan: only Task 1 edits `shared/api.ts`, as one hunk appended after the last line and
    never inserted above it, so the consent covers W1's whole use of the path.
  - Mail 3817 tells the worker that this confirmation, not a claim, licenses that one path. `server/src/watch.ts`
    (Task 5) and `README.md`/`CLAUDE.md` (Task 7) still wait for their claims' release, and the wave-done names
    mail 3815 and R12 in its claim state.
- **R13 (2026-10-07 11:33)**, two more regioned co-edits are asked for, and Task 5 waits on them.
  - The worker's mail 3828: Tasks 1-4 are committed on `ws/swift-meadow` at `6e5b469f2`, each task-reviewed and with
    its mutation table red as planned; the migration took slot 17 (16 entries at `origin/main` `282e79e44`). At
    Task 5, `server/src/watch.ts` is still under claim 1070 and `README.md`/`CLAUDE.md` under claim 1072. Task 6
    builds on Task 5 and also edits `CLAUDE.md`, so the chain cannot be reordered around them.
  - Measured on `282e79e44`, with W1's regions taken from `proto/sws-w1` (the plan's own code):
    - `watch.ts`: run 291's Task 12 edits the `./coord/childReclaim.js` import (:84-88), `currentChildMarks` (:1594),
      `tick()`'s `childMarks` assignment (:1762) and `emitCoord` (:2155). W1 edits three import lines (:19, :40,
      :56-66) plus one new import after :66, the stall-sweep constants (:205-207), fields after `stallWarned`
      (:894), `sweepStalls` (:4113 on) and `sweepMail` (:4869 on). The nearest pair is about 18 lines apart.
    - Docs: run 302 inserts one bullet after `CLAUDE.md`:78 and edits `README.md` :494, :1104 and :5069, plus a block
      appended at its end. W1 edits `CLAUDE.md` :257, :280 and :304 on, and the README's stall-watch section (about
      :3900-4360). The nearest pairs are about 180 and 700 lines apart.
  - Ruling: ask each holder's coordinator for a co-edit limited to W1's measured regions, on R11's terms. Mail 3830
    asks run 291's coordinator for `watch.ts`. Mail 3831 asks run 302's coordinator for `README.md` and `CLAUDE.md`,
    and a release before W1 reaches Task 6 answers it as well. The worker stays stopped and is not mailed until an
    answer arrives. A refusal means W1 waits for that claim's release.
- **R14 (2026-10-07 11:35)**, Task 5 starts under the `watch.ts` co-edit, and Task 6 still waits.
  - Run 291's coordinator answered yes in mail 3832, for exactly W1's listed regions and on 3815's terms. At run
    291's tip `899e4f12a`, wave 6 has not edited `watch.ts` yet, and its plan touches only Task 12's four sites.
  - Mail 3834 gives the worker the regions line by line and names wave 6's four sites as untouchable. If the plan's
    Task 5 code needs a line in one of them, the worker stops and reports.
  - Task 6 cannot be split around `CLAUDE.md`: `box-token-census.test.ts` checks the session-gated-writes sentence
    against the new route in the same commit. The worker finishes Task 5 and stops before Task 6 until mail 3831 is
    answered or claim 1072 is released.
- **R15 (2026-10-07 12:09)**, Tasks 6 and 7 proceed under the docs co-edit, and no contested path remains.
  - Run 302's coordinator answered yes in mail 3836, for exactly W1's listed regions. It says run 302's one remaining
    pre-PR change touches neither file.
  - Checked against the merged W1 plan: Task 7's nine README edits sit in the mail-gate paragraph (strict's runbook
    included), the stall-watch paragraph and the wave-2 runbook, about :3903-4352 on `282e79e44`. Its `CLAUDE.md`
    edits sit at :257, about :280 (Task 6) and :304 on. The prototype's `CLAUDE.md`:10 size-claim hunk is stale:
    the plan edits no size claim, because #283 already made it.
  - Mail 3837 gives the worker those limits and run 302's untouchable regions, and lets Tasks 6 and 7 follow Task 5
    without a further stop. The second landing re-runs the README citation instrument.
- **R16 (2026-10-07 14:53)**, all seven tasks are implemented, and wave-done waits inside a turn.
  - The worker's mail 3856 is a status, not a wave-done. All seven tasks are task-reviewed on Opus, and the final
    whole-branch review found 0 Critical and 0 Important. `ws/swift-meadow` is pushed at `ccd3eced1` as PR #320, and
    full CI run 37639105813 started at 14:43.
  - Claims: run 302 released claim 1072 (mail 3840), and the worker took `README.md` and `CLAUDE.md` as claim 1076.
    Claim 1074 holds the other 24 paths. `shared/api.ts` and `watch.ts` stay licensed co-edits under R12 and R14.
  - The worker's turn marker read `done` at 14:51:50 while CI ran. That is the shape that stranded a finished wave for
    20 hours before: a CI result wakes no session. Mail 3857 tells it to wait inside a turn with a backgrounded
    `gh run watch --exit-status`, then send wave-done in that turn, naming any failing leg rather than waiting on a
    fix.
  - `judgeStall`'s signature and its `StallInput` literal (about :4187-4216 on `origin/main`) are outside R14's
    literal list but inside none of wave 6's four sites, and the plan requires them. Accepted. The omission was in
    this coordinator's list in mail 3830, not in the worker's reading. Mail 3858 tells run 291's coordinator so, and
    `git merge-tree` against `ws/amber-river` at `899e4f12a` is clean.
- **R17 (2026-10-07 15:11)**, wave 1's wave-done is verified, and review run 319 is dispatched.
  - Mail 3861 is the wave-done, with fingerprint `ccd3eced1b17` (tip and handoff commit) and PR #320 `open`. It is
    copied to `.superpowers/sdd/stall-watch-settings/w1-wave-done.md`, and the worker's SDD workspace (`progress.md`
    and every `mut-*.out`) to `w1-child-evidence/`, before any reclaim.
  - Re-measured: the origin tip, the worker's checkout and PR #320's head all read `ccd3eced1`; the tree is clean and
    the PR mergeable. Run 295 advanced to `working`, then to `awaiting-review`, on the worker's fingerprint
    unchanged; the server's own re-measurement accepted it.
  - The suite signal reads `green`, and it is accepted. On full run 37639105813 every Linux leg is green, and the one
    red is `test-macos` 4/4 (two rows of `ccd-docs-tree.test.ts`, a file this wave does not touch, green on Linux in
    isolation). macOS legs gate nothing. PR #320's own required `test (server)` is green.
  - Review run 319 opened with the programme's own title, so the programme keeps its name. It was dispatched once to
    `ccrc-pwa-bright-hollow` (`skillState` present) with route `class=opus effort=high subagent=sonnet workflow=on`
    and compact 40, so the reviewer can run the panel as a Workflow. The brief
    (`.superpowers/sdd/stall-watch-settings/w1-review-brief.md`) names the held-out panel, the whole-branch pass
    (deploy inertness, layering, never-throwing resolution, the censuses, slot 17, the three co-edit regions and the
    worker's three departure slugs), every suite, the carried constraints and the fifteen ledgered numbers. The
    report goes to the reviewer's `~/.cc-clips/`, per reviewer clause 7.
  - The worker's three items for ruling wait for the review report: (a) the parked plan-mandated duplication, (b) the
    docs saying "Settings" before wave 2 builds the section, and (c) the migration slot re-measured before merge.
- **R18 (2026-10-07 15:21)**, the operator authorizes PR #320's merge "when ready".
  - The operator said "merge when ready". Ready means all of these, measured at merge time, not remembered:
    - Review run 319's report is accepted by its close, and it leaves no confirmed or unexamined critical or important
      finding unresolved. A finding that is fixed returns through a fix round, a fresh wave-done and a scoped review
      of the new tip before it counts.
    - The head being merged is the run's verified `handoffCommit`, and PR #320's required checks are green on it.
      macOS legs gate nothing.
    - Slot 17 is still free on current `origin/main`. If another merge took it, the migration moves up in a fix round
      before merge, and no applied migration is edited.
    - If run 291's wave 6 lands first, W1 merges current `main` without rebasing and re-runs the R7 guards first.
  - Merge with `gh pr merge 320 --admin --squash --match-head-commit <handoffCommit>`, after measuring whether `main`
    requires the merge queue. The squash subject must not carry the PR title's deviation-number range.
  - Not authorized by this ruling: `ccrc rollout` or `ccrc update` by hand. The release lane carries the merge, and
    deployment is verified read-only afterwards: the migration applied, the seed still `follow`, and
    `GET /api/coord/stall-watch` answering.
  - After the merge, wave 2's run opens before run 295 closes.
- **R19 (2026-10-07 16:15)**, review 319 is accepted, and wave 1 is ready to merge.
  - Review run 319 (`ccrc-pwa-bright-hollow`, mail 3870) reviewed `ccd3eced1` with the held-out panel: 30 agents, 0
    errors. The reproduce lens first came back empty, so the reviewer re-ran it with a checked list: 28 claims, 26
    reproduce. Five minor findings survived the refute pass: correctness 3 (F1-F3), spec 1 (F4) and reproduce 1
    (F5). None is critical or important. The whole-branch pass found nothing: inert on deploy, layering,
    never-throwing, the session-only censuses, slot 17 free, no hunk in run 291's or run 302's regions, and
    `merge-tree` clean against both and against `origin/main`. The close accepted `{reviewedTip, report}`: `done`,
    `released`. The report is copied to `.superpowers/sdd/stall-watch-settings/w1-review-319-report.md`.
  - F4: none of the plan's five unnumbered candidates needs a number, because none departs from behaviour the spec
    prescribes.
    - The derived `StallStored` keeps the `absent`/`unreadable` pair defined once (`single-definition`).
    - `stallSettingsAfter`'s `at` keeps L1 free of a clock.
    - `stallBoxHeld` is the L1 reader the spec's files-only Follow reading needs.
    - The prose suite is an added guard.
    - The M16b pin lives beside the route whose SQL it scans, and still goes red as §14 asks (M16b-1, M16b-2 and
      M16b-3 measured). §14 names the guard and its mutation; the file it lives in is the plan's choice.
  - The worker's three slugs (`kebab-union-fourteenth`, `t6-gate-numeral-red-order`, `t6-m16b3-two-reds`) are
    plan-hint drift. The reviewer re-measured M16-9 and M16b-3, and none needs a number.
  - Residue, parked and carried to wave 2's brief as one declared item: F1 (the L0 text block's header overstates
    its duration rule), F2 (the unread `StallResolution.levelSource`), F3 (a `coord-db` message that misnames its
    red), F5 (`stallResolveNow`'s "nothing else reads the row") and the worker's parked plan-mandated duplication.
    Each is behaviour-neutral. If wave 2 cannot take their paths, they ride a small follow-up after both land.
  - The README, `CLAUDE.md` and the parent spec say "chosen in Settings" before wave 2 builds the section. Accepted,
    because the plan prescribes this prose and each sentence names `POST /api/coord/stall-watch`. Until wave 2
    deploys, a choice can be made only through that session-gated door. Wave 2 is dispatched right after this merge.
    Promoting a wave-1-only build to `stable` is the operator's call; the coordinator advises against it until wave 2
    merges.
  - The README citation instrument reads `15 passed | 320 skipped (335)` at both the base and the tip, so the wave
    did not move it. The carried `7 passed | 328 skipped` was stale: `main` gained citation rows after the plan was
    measured. The worker's wave-done repeated that figure, and it does not reproduce. The carried constraint below
    now says "unchanged by a wave", as measured.
  - R18's bar is met. The review leaves no critical or important finding open. PR #320's head is the verified
    `handoffCommit` `ccd3eced1`, and its required checks pass. The failing checks are `test-macos` 1/2 and 2/2 only,
    and macOS legs gate nothing. `origin/main` `282e79e44` still carries 16 migrations, so slot 17 is free. Run 291's
    wave 6 has not landed. `main` requires no merge queue.
- **R20 (2026-10-07 16:20)**, wave 1 is merged and closed, and wave 2 is dispatched.
  - Run 295 advanced to `merging` on its fingerprint. PR #320 merged at 16:15:45 as `7f7bf4afc`, with
    `--admin --squash --match-head-commit ccd3eced1` and a subject without the title's number range. `main` now
    carries 17 migrations, and the release lane published prerelease v0.0.119 at 16:16:47. Nothing was rolled out by
    hand.
  - Wave 2's run 322 opened before run 295 closed, without a `sessionId`, because wave 1's child was spent. Run 295's
    close needs `final` as a boolean: `{fingerprint, final:false}` answered `done`, `released`, `childReclaim` queued.
    The first try omitted `final` and was refused `bad-request` with no detail. Its evidence was copied first (R17).
  - Routing for wave 2 stays R4's, on wave 1's evidence: suite green on the first full run, the final review clean,
    and the seven-task chain fit one context.
  - Wave 2 declares five items: its plan's four tasks, then wave 1's review residue. R19's residue is narrowed to
    F1, F2, F3 and F5, the stale `stallArmingOf` comment in `sweepStalls`, and an equality pin for
    `stallResolveNow`'s fallback arming, as wave 1's final review suggested. The plan-mandated duplications stand as
    accepted residue: the view's double `effective` literal (D-4038), the third feed-row block in `routes.ts`, and
    `stallFaultReason`'s copy.
  - The residue touches `shared/api.ts` and `watch.ts`, still under run 291's claim 1070, in wave 1's own lines only.
    Mail 3871 asks run 291's coordinator for that co-edit. Item 5 runs last, and the worker waits for this
    coordinator's confirmation before it touches either file.
  - The plan's operator questions. (1) README :967's "the phone-push bell for this browser" becomes "the push bell for
    this browser": the operator's 2026-10-05 directive (no device distinction) already rules it. (2)
    `UNCONFIRMED_TEXT`'s "Saved —" is left as it is and put to the operator.
  - Run 322 was dispatched once to `ccrc-pwa-calm-basin` (`adopted` false, `skillState` present, 0 of 5 items).
    `ws/calm-basin` sits at `7f7bf4afc`, 0 commits ahead or behind, and the registry shows R4's route, compact 40 and
    the hold `program:stall-watch-settings wave:2/2 run:322`. Daily usage stood at 21 of 24, with 5 active runs.
  - Deploy verification is pending: this fleet box still reported v0.0.118 at 16:20. Once the updater moves the
    boxes, the read-only checks are the server's `/health` version (a server that answers has applied migration 17,
    since a failed migration refuses to start) and the fleet box's `ccrc version`.
- **R21 (2026-10-07 16:22)**, wave 2's residue co-edit is confirmed.
  - Run 291's coordinator answered yes in mail 3872, for exactly mail 3871's lines on `7f7bf4afc`: `shared/api.ts`
    :9251 inside wave 1's block, and `watch.ts`'s `StallResolution` (:215-218), `sweepStalls`' outer catch comment
    (:4207-4208), and `stallResolveNow`'s docstring and two returns (:4219-4251). It measured run 291's tip
    `9bdcb0d2a`, which now carries its Task 12, as clean in `merge-tree` against `main`, with no hunk near those lines.
  - Mail 3874 tells the worker that this confirmation licenses those lines, so item 5 runs without a stop. Any
    other line in either file is a stop-and-report.
- **R22 (2026-10-07 19:29)**, wave 2's wave-done is verified, and its review dispatch waits at the daily cap.
  - Mail 3916 is the wave-done: fingerprint `505ffbff4425` (tip and handoff commit), PR #322 `open`, suite `green`,
    all five items done. Item 5 stayed inside R21's lines and kept `StallResolution.levelSource` pinned on both arms,
    because spec §9 prescribes the field. The final whole-branch review found no Critical or Important finding. The
    mail is copied to `w2-wave-done.md`, and the worker's SDD workspace to `w2-child-evidence/`, before any reclaim.
  - Re-measured: the origin tip, the clean worker checkout and PR #322's head all read `505ffbff4`. `main` has not
    moved from `7f7bf4afc`, the PR is mergeable, its required checks are green (macOS still pending), and `schema.ts`
    is untouched. Run 322 advanced to `working`, then to `awaiting-review`, on the worker's fingerprint unchanged.
  - Review run 330 opened with the programme's title. Its brief (`w2-review-brief.md`) names the held-out panel, a
    whole-branch pass (no browser copy, no client-side ladder policy, the poll, D-4035, D-4036, `QuickConfirm`'s
    single-string callers, wording, lane discipline, the six departure slugs), every suite and the carried
    constraints. Its dispatch was refused `cap-daily`, `limit` 24 and `used` 24, spawning nothing. A snapshot sorted
    by `dispatchedAt` puts the next age-out at 19:57:43 (run 299). One session-only wake at 19:58 resends the same
    payload once.
  - Correction to R19. The plan's README citation instrument is `session-hook.test.ts -t 'CITATION DEBT|README
    HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'`, and it reads `7 passed | 328 skipped`, which
    both workers reported. Review 319's brief gave the reviewer `-t 'census|citation'` instead, a broader filter that
    reads `15 passed | 320 skipped`. The mistake was this coordinator's. R19's "does not reproduce" was wrong, and the
    carried constraint below is restored with the exact command.
  - Wave 2's six departure slugs, the worker's question on `coord-db`'s slot match, its parked residue and the
    plan's operator question 2 wait for the review report.
- **R23 (2026-10-07 19:58)**, review run 330 is dispatched.
  - At 19:58 run 330 was still the planned review of run 322, run 322 was still `awaiting-review`, and
    `origin/ws/calm-basin` was still at `505ffbff4`. The unchanged payload went out once and was accepted. The
    reviewer is `ccrc-pwa-quiet-mesa` (`adopted` false, `skillState` present, brief queued), and its route
    (`workflow=on`) lets it run the panel as a Workflow.
  - The worker's mail 3921: CI run 37671873640 finished with every required check green. Both macOS legs are red in
    docs-reader suites (`ccd-docs-index`, `ccd-docs-tree`) that this wave does not touch, and they gate nothing.
  - The fleet box reported v0.0.119 (`7f7bf4afc`, wave 1) at 19:30, so the updater has moved it. The server box's
    `/health` stays unverified here: it is reachable only by raw HTTP, which this session does not use.
- **R24 (2026-10-07 20:27)**, review 330 is accepted, and wave 2 goes back for one fix round.
  - Review run 330 (`ccrc-pwa-quiet-mesa`, mail 3926) reviewed `505ffbff4` with the held-out panel. The reproduce
    lens came back empty, so the reviewer re-ran it with a checked list: 32 claims, 30 reproduced. Nine findings were
    confirmed, one was refuted 2/3, and the reviewer added F10 from the whole-branch pass. By lens: correctness 4
    (F1 important, F2-F4 minor), spec 4 (F5-F8), reproduce 1 (F9), whole-branch 1 (F10). Every suite is green, the
    citation instrument reads `7 passed | 328 skipped (335)`, lane discipline holds, and `merge-tree` is clean
    against `main`, `ws/amber-river` and `ws/soft-delta`. The close accepted `{reviewedTip, report}`, and the report
    is copied to `w2-review-330-report.md`.
  - F1 (important): a write that never got an answer toasts `UNCONFIRMED_TEXT`, "Saved — …". This is the plan's
    operator question 2, now rated important. Ruling: give that arm its own honest line, which does not say "Saved"
    and says the change was not confirmed; the re-read that follows is unchanged. The line goes in wave 1's L0
    stall-watch block, now that run 291 has released claim 1070. The 2xx-but-unreadable arm keeps `UNCONFIRMED_TEXT`.
    The operator sees the wording before the merge and may overrule it.
  - F10, wire-guard tolerance: dropping a present but malformed `next` or `filesExceed`, and rendering the rest, is
    accepted. A skewed or buggy server's malformed optional block should cost only that block, as a malformed
    `counts` element already does under §13, not blank the whole section. Since §13 says a failed read, this is a
    numbered departure, `malformed-optional-block-is-dropped`. Its number comes from this programme's wave 2
    reserve: it is named to the worker by mail, defined in the W2 plan's Deviations section and cited at the guard
    in this fix round, and not written here until that definition is on `main`. The malformed-`fallback` arm stays
    as §13 has it: the whole answer fails.
  - F5 and F6: the ledger's record suffices. Item 5 is behaviour-neutral scope this coordinator declared (R20,
    R21), not a spec departure. README :967's "push bell" applies the operator's 2026-10-05 directive. No plan entry
    is added for either.
  - Fixed in the round: F2 (keep the defensive branch, and retitle its test as an off-wire shape that cites
    D-4037), F3 (a stored quiet time equal to the built-in selects the built-in option), F4 (qualify the section
    header, and break the `SettingsScreen` import cycle if no pinned citation moves), F7 (the README pin's header
    docstring, and the D-4036 entry's "Pinned by" text in the W2 plan, amended by this ruling), F8 (cite
    `notifications-label-says-push (D-4036)` at the label), F9 (a refusal detail never renders blank). The worker's
    question is approved: `coord-db`'s slot-17 row matches `CREATE TABLE stall_settings`, so a later legitimate
    `ALTER` does not trip it.
  - The six departure slugs. `quiet-range-bounds-the-select`, `unanswered-write-reads-unconfirmed`,
    `quiet-select-shows-no-unanswered-value` and `readme-section-sentence-pinned-to-l0` implement the spec in forms
    it does not spell out, and need no number. `levelSource-kept-per-spec-9` is no departure. The tolerant half of
    `malformed-fallback-refuses-the-answer` becomes `malformed-optional-block-is-dropped`, numbered above.
  - Residue that stands: the README pin's own copy of the PWA device-word list, `quietText` duplicating the
    server's `stallQuietWords`, the spec's touch-only wording ("never the tap", "stops a finger"), and the
    commit-subject slip on `1a728b248` (the panel refuted it 2/3).
  - Next: run 322 back to `working`, then a `fix-round` mail. The fix round ends in a fresh wave-done, a new review
    run for the new tip, and then the operator's merge decision.
- **R25 (2026-10-07 21:33)**, fix round 1's wave-done is verified, and its review waits at the cap.
  - Mail 3933 claims `7253060da`. Re-measured: `origin/ws/calm-basin`, the workspace `HEAD` and PR #322's head all
    read `7253060da`, the workspace is clean, and the PR is open. The nine commits since `505ffbff4` touch ten files.
    `server/src` is unchanged, the one `shared/api.ts` hunk is a new key inside wave 1's stall-watch block, and
    `merge-tree` against `origin/main` (`8c446eab0`) is clean. The server took the fingerprint, and run 322 is
    `awaiting-review`. Every required CI check on run 37687688296 is green; the macOS legs were still running and
    gate nothing. The child's evidence is copied to `w2-fix1-child-evidence/`.
  - F1's line, for the operator before the merge: "Not confirmed — the server did not answer; the screen will
    re-check." Operator question 2 now covers only the 2xx-but-unreadable arm's "Saved —".
  - The worker also corrected the plan's prose on two candidate entries, a residue bullet and operator question 2,
    to match what ships, and offered to revert it. It is kept, because a plan that describes the old behaviour would
    mislead. The review checks only whether the corrections are accurate.
  - The worker's three observations go to the review. One is caused by R24's shape for F3: with 7 200 000 stored,
    the built-in option is already selected, so resetting to `default` takes two changes. The other two: the
    device-word scan does not read `settingsText.ts`, and `coord-db` matches one spelling of the DDL.
  - Review run 333 is open (planned) for the new tip. Its brief is `w2-fix1-review-brief.md`: the held-out panel on
    `505ffbff4..<tip>`, R24's nine items, the whole-wave properties, the suites and the citation instrument. The
    rolling daily cap reads 24 of 24, and its next age-out is 22:20:17 (run 307), so one session-only wake at 22:21
    sends the payload once.
- **R26 (2026-10-08 03:13)**, review run 333 is dispatched.
  - The unchanged payload went out at 03:13:42 and was accepted. The reviewer is `ccrc-pwa-amber-meadow` (`adopted`
    false, `skillState` present, brief queued). Its registry route reads opus, high effort, sonnet subagents,
    workflow on and compact 40, so it can run the panel as a Workflow. Before the send, run 333 was still
    `planned`, run 322 was still `awaiting-review`, and `origin/ws/calm-basin` was still `7253060da`.
  - Three earlier sends were refused `cap-daily` and spawned nothing. Each time, another programme took the freed
    slot first:
    - at 22:21, child-reclamation's review run 335, at 22:20:33;
    - at 22:28, workspace-lifecycle's run 314, at 22:28:10;
    - at 01:34, native-docs-reader's review run 336, at 01:34:16.
  - A timed background attempt for 01:33:21 was killed by the session's memory-pressure reaper while it slept, and
    it sent nothing. The send that landed waited only seconds after a wake on the age-out minute (run 312, 03:13:12).
  - Next: `review-done`, then this session advances run 333 to `working`, closes it with the reviewer's
    `{reviewedTip, report}`, and rules. After that it asks the operator about merging PR #322.
- **R27 (2026-10-08 03:35)**, review 333 is accepted, and wave 2 goes back for a second fix round.
  - Review run 333 (`ccrc-pwa-amber-meadow`, mail 3968) reviewed `7253060da` with the held-out panel (Workflow
    `wf_4f19a26c-003`): 42 agents, no lens unverified, 11 confirmed, 2 refuted 3/3. They merge into seven
    findings: F1 and F2 important, F3 to F7 minor.
    - R24's nine items are addressed as ruled. Every mutation row the worker reported re-measured exactly.
    - Every suite is green. The one PWA red, `contrast.test.ts`, passed twice in isolation, so it is load.
    - The citation instrument reads `7 passed | 328 skipped (335)`, and `deviation-refs` 31.
    - Lanes are clean, and `merge-tree` is clean against `origin/main`, `ws/amber-river` and `ws/soft-delta`.
    - Run 333 closed `done` and released. The report is copied to `w2-review-333-report.md`.
  - F1 (important): R24's shape for F3 was wrong, and this ruling replaces it. A stored 7 200 000 is a choice
    pinned at that number, not the built-in: the server reports it as `chosen`, a `default` write over it is a real
    change, and only NULL follows the built-in. Selecting the built-in option for it shows "Built-in" beside a quiet
    line that says "chosen here". It also turns a one-write reset into two, and it would hide a pin if a later build
    moved the built-in. Ruling: when the stored number equals the built-in, the select shows it as its own option,
    labelled with the quiet line's wording (`chosenHere` over `quietText`, no new string). Picking Built-in from there
    is then one change that writes `default`. The comment and the candidate entry are corrected, and a row pins the
    one-write reset.
  - F2 (important): `STALL_CONFIRM_TEXT.unanswered` is a key that spec §12's enumeration of that object does not
    list, and three plan lines still say W2 adds no L0 string. Adding a key outside a list the spec enumerates is a
    departure, not a silence, so it takes a number from this programme's wave 2 reserve. That number is
    `unanswered-write-has-its-own-l0-line`, named to the worker by mail and defined in the W2 plan in this round. It
    is cited at the key and at the section's use, and it is not written here until that definition is on `main`.
    The three plan lines are amended to say the fix round adds one L0 key. The neighbouring candidate
    `unanswered-write-reads-unconfirmed` keeps only its unnumbered half, reading a network failure as unconfirmed
    rather than as a refusal.
  - F3 (minor): the docstring's reading is accepted. The `HTTP <status>` fallback fills the server-answer detail
    slot, as `apiErrorText`'s own `request failed (<status>)` floor already does; it is not section copy. The plan's
    Task 1 sentence "No new string is added" is amended to say so, and it takes no number.
  - F4 (minor): the `coord-db` needle `CREATE TABLE stall_settings` prefix-matches `stall_settings_new`, which is
    SQLite's table-rebuild idiom, so a legitimate later migration would trip the row R24 meant to spare. The needle
    must stop at the table name, with the reviewer's mutation (an appended `stall_settings_new` create-and-drop) as a
    row measured green on the count and frozen rows. The existing second-`CREATE` row must stay red.
  - F5 (minor): the plan prose that still contradicts what ships is amended in place:
    - Task 1 at ≈:403-406 and Task 3's notes at ≈:1756-1758, both on the network arm.
    - The Goal, Global Constraints and "Deliberately unchanged" lines on `shared/` and `server/src`. They are made
      true of the whole wave: Tasks 1 to 4 add no L0 string, the fix round adds one key, and item 5's comment and
      test edits are coordinator scope (R20, R21).
    - The File Structure table gains `pwa/src/screens/settingsText.ts`, `shared/api.ts` and item 5's two test files.
    - README's "phone-push bell", under "Deliberately unchanged" and as the first operator question, is already
      reworded and pinned: it is marked as settled by the operator's 2026-10-05 directive.
  - The worker's second observation is taken: the device-word scan also reads `settingsText.ts`, the module meant to
    hold text the Settings sections share. One line in the scan's list, with a mutation row.
  - F6 and F7: no change.
    - F6: spec §13's `SettingsScreen.tsx ≈:72` is an unpinned approximate anchor in a spec outside this wave's lanes,
      and anchors are snapshots.
    - F7: an overstated commit subject on `8b66f4616`. History is not rewritten.
  - F1's line for the operator stands as "Not confirmed — the server did not answer; the screen will re-check."
  - Next: run 322 is back at `working` (fingerprint `7253060da`), and the `fix-round` mail goes out. The round ends
    in a fresh wave-done, a new review run for the new tip, and then the operator's merge decision.
- **R28 (2026-10-08 04:27)**, fix round 2's wave-done is verified, and its review waits at the cap.
  - Mail 3970 claims `6cef2ae46`. Re-measured:
    - `origin/ws/calm-basin`, the workspace `HEAD` and PR #322's head all read `6cef2ae46`, the workspace is clean,
      and the PR is open.
    - The seven commits since `7253060da` touch five files. `server/src` is unchanged, and the one `shared/api.ts`
      hunk is a two-line comment inside wave 1's stall-watch block.
    - `merge-tree` is clean against `origin/main` (`3c33d3218`) and against `ws/swift-cove` (workspace-lifecycle run
      314, to which the worker waived regions by mail 3944).
    - The server took the fingerprint, and run 322 is `awaiting-review`.
    - Every required CI check on run 37725973446 is green.
    - The child's evidence is copied to `w2-fix2-child-evidence/`.
  - Claims: claim 1083 lapsed at its 8-hour cap. The worker released 1087 and holds claim 1101 over this round's
    paths.
  - The worker's notes go to the review. The pinned option sits right after Built-in, a position R27 did not set.
    Mutation rows X40 and X48 still quote first-cut code lines.
  - Review run 338 is open (planned). Its brief is `w2-fix2-review-brief.md`: the panel on `7253060da..<tip>`,
    R27's six items, the whole-wave properties, lanes (now including `ws/swift-cove`), the suites and the citation
    instrument. The cap reads 24 of 24, and the next age-out is 05:02:17 (run 313).
  - Three sends lost a freed slot within seconds (R26), so a session-only wake at 05:02 starts a timed background
    attempt 2 s after the age-out. The attempt re-checks the preconditions first and sends once.
  - Dispatched (05:02). The preconditions held at 05:02:04 (338 `planned`, 322 `awaiting-review`, tip
    `6cef2ae46`). The send went out at the age-out and was accepted, its answer arriving at 05:02:36. The reviewer is
    `ccrc-pwa-warm-mesa` (`adopted` false, `skillState` present, brief queued), and its registry route reads opus,
    high effort, sonnet subagents, workflow on and compact 40. Next: `review-done`, then this session advances run
    338 to `working`, closes it, and rules. After that it asks the operator about merging PR #322.
- **R29 (2026-10-08 05:23)**, review 338 is accepted, and wave 2 goes back for a third fix round.
  - Review run 338 (`ccrc-pwa-warm-mesa`, mail 3980) reviewed `6cef2ae46` with the held-out panel (Workflow
    `wf_fb8b0b1b-451`): 30 agents, no lens unverified, 8 confirmed and 1 refuted. Merged, that is seven findings:
    F1 and F3 important, the rest minor.
    - R27's six items are addressed, F5 with residue. Every mutation row re-measured as reported.
    - Every suite is green; four PWA reds under panel load were green in isolation.
    - The citation instrument reads `7 passed | 328 skipped (335)`.
    - `merge-tree` is clean against `origin/main`, `ws/amber-river`, `ws/soft-delta` and `ws/swift-cove`.
    - Run 338 closed `done` and released. The report is copied to `w2-review-338-report.md`.
  - Before ruling on F1 and F2, this session put both proposed rulings to three Opus·high refuters (Workflow
    `wf_ffbcfd62-d2b`, a spec lens, a user-screen lens and a consistency lens). None refuted either ruling. Their
    output is saved to `r29-refute-workflow.json`.
  - F1 (important): spec §13 item 4 says the select offers Built-in and every step except the built-in's "so the
    built-in value appears once". A pinned 7 200 000 shown as its own option puts that value in the select twice.
    The spec is not silent there, so this is a numbered departure, `pinned-built-in-value-is-its-own-option`, from
    the wave 2 reserve. It is named to the worker by mail, defined in the W2 plan, and cited at the pinned-option arm
    and at `quietChoices`' docstring. It is not written here until that definition is on `main`. The candidate
    `quiet-select-shows-no-unanswered-value` loses that half. The spec-faithful alternative is to select nothing for
    a pinned 7 200 000, which would hide a real pinned choice; it is rejected for that reason.
  - F2 (minor): the pinned option is labelled `chosenHere`, but under a fallback or an unreadable level the server
    sends `quiet.source` `default`. The screen then shows "2 h (built-in)" over a selected "2 h (chosen here)".
    - Ruling: the pinned option is labelled exactly as `quietChoices` labels every step, plain `quietText`, and it
      sits at its step's numeric place. It is the missing step, shown back for the stored case.
    - A step label never claims a source; the quiet line above it alone says where the effective value comes from,
      as it already does for a stored 3 h under a fallback.
    - This supersedes R27's label clause ("labelled with the quiet line's wording"). Every other part of R27's F1
      stands.
    - Rows pin the label under `source` `chosen` and `default`, and the position. Each is measured red under its
      mutation, as numbered X rows in the plan's own table.
  - F3 (important): `unanswered-write-has-its-own-l0-line`'s "Pinned by" cites mutation rows X48 and X60, whose quoted code and failing-row title no
    longer exist. They are re-measured against what ships and corrected in place.
  - F4 (minor): fix round 2's pinned-option guard has no row in the plan's mutation table. Fix round 2's mutations
    and this round's are added to Task 3's table as numbered X rows.
  - F5 (minor): the plan's Deviations lead sentence says the two fix-round numbers did not come from the 17:47 call.
    The reviewer read the allocator: they were issued in this programme's 17:47 block as reserve and assigned later,
    by R24 and R27. The sentence is reworded to say so, naming no range.
  - F6 and F7 (minor), in place:
    - the "row 5" that is the README pin's sixth row;
    - `stall-settings-readme`'s line and row counts;
    - a one-line note that the File Structure table's line and row counts are first-cut figures, with the shipped
      files governing;
    - the second operator question's last sentence, now false;
    - the Tech Stack's Node floor, to `>=22.16.0` as the engines say;
    - "W1's L0 block is complete", qualified to Tasks 1 to 4.
  - The round is bounded: the worker fixes exactly these, and the next review is scoped to this round's diff and the
    passages it edits.
  - Next: run 322 is back at `working` (fingerprint `6cef2ae46`), and the `fix-round` mail goes out.
- **R30 (2026-10-08 06:14)**, fix round 3's wave-done is verified, and its review waits at the cap.
  - Mail 3982 claims `451854d1d` and reports `suite: red`, `failure: unclear`.
    - The first whole-PWA run timed out in eight files while the worker's own re-review ran mutations alongside it.
    - Each of those files passed alone, a clean re-run at `451854d1d` was green (108 files, 3520 tests), and CI's
      `test (pwa)` on run 37734778375 is green.
    - The worker's clause 15 keeps the first run's signal. This session reads it as load, not code; the review
      re-runs the suite alone.
  - Re-measured:
    - `origin/ws/calm-basin`, the workspace `HEAD` and PR #322's head all read `451854d1d`, and the workspace is
      clean.
    - Every CI check is green except the advisory macOS legs, which were still running.
    - The six commits touch only `StallWatchSection.tsx`, `settings-screen.test.tsx` and the W2 plan.
    - `merge-tree` is clean against `origin/main`, `ws/swift-cove`, `ws/amber-river` and `ws/soft-delta`.
    - The server took the fingerprint, and run 322 is `awaiting-review`.
    - The child's evidence is copied to `w2-fix3-child-evidence/`. Claim 1101 is held.
  - Review run 340 is open (planned). Its brief, `w2-fix3-review-brief.md`, is bounded as R29 said: the panel on
    `6cef2ae46..<tip>`, R29's six items, and the passages this round edits. Untouched first-cut plan prose is
    residue, never a finding. The whole wave gets only the property and lane checks.
  - The cap reads 24 of 24, and the next age-out is 08:47:32 (run 306). A session-only wake at 08:47 starts the
    timed attempt, which re-checks the preconditions and sends once at 08:47:34.
  - The 08:47 attempt was refused `cap-daily` and spawned nothing. Native-docs-reader's review run 337 reached the
    dispatch route first.
    - Dispatches are serialised, and the cap check runs a few seconds before `dispatchStartedAt` is stamped. Mine
      queued behind 337's spawn and was then checked at 24 of 24.
    - `capsUsage` counts `dispatchedAt > now - 24 h` (`server/src/coord/store.ts` `capsUsage`), so the age-out was
      measured right. Only the whole-second target, which fired one second late, lost the race.
  - Dispatched (09:58). The retry slept to the millisecond, run 295's age-out plus 250 ms. The preconditions held at
    09:58:19 (340 `planned`, 322 `awaiting-review`, tip `451854d1d`). It was accepted, its answer arriving at
    09:58:44. The reviewer is `ccrc-pwa-keen-mesa` (`adopted` false, `skillState` present, brief queued), and its
    registry route reads opus, high effort, sonnet subagents, workflow on and compact 40. Next: `review-done`, then
    close run 340 and rule. After that this session asks the operator about merging PR #322.
- **R31 (2026-10-08 10:21)**, review 340 is accepted, and wave 2 is ready for the operator's merge decision.
  - Review run 340 (`ccrc-pwa-keen-mesa`, mail 3994) reviewed `451854d1d`, bounded as R29 said. The held-out panel
    (Workflow `wf_ac4564ff-3dc`) ran 24 agents with no lens unverified: 5 confirmed, 2 refuted.
    - R29's six items all hold. X48, X60 and X61 to X66 re-measured out of tree and match the plan.
    - Every suite is green. The whole PWA suite, run alone, reads 108 files and 3520 tests. The citation instrument
      reads `7 passed | 328 skipped (335)`.
    - Lanes are empty, and `merge-tree` is clean against `origin/main` (`852c04512`), `ws/amber-river`,
      `ws/soft-delta` and `ws/swift-cove`.
    - Run 340 closed `done` and released. The report is copied to `w2-review-340-report.md`.
  - Its one finding, F1, is minor prose: Task 3's mutation table header says "out of 183" over a footer that says
    "All are counted out of 187". It is accepted as residue, not sent back: it needs no ruling, changes no
    behaviour, and another round would cost a review and a cap slot for one sentence in a plan document.
  - Residue that stands, each a first-cut snapshot in the plan or a test title, none behaviour:
    - X37 and X38's failing counts at 187;
    - X41 and X43's old test title;
    - X59's drifted anchor;
    - Task 4's "5 failed (5)";
    - the source-`default` row's title saying "under a fallback" over a fixture with none (N2). Its asserted
      property holds either way, and X65 reds it.
    These are left for a later plan-hygiene pass. The shipped files govern, as the plan's own first-cut note says.
  - PR #322 at `451854d1d`: every CI check is green except `test-macos 2/2`, which is advisory and gates nothing.
  - Operator decisions before the merge:
    - F1's line (R24) for a write with no answer: "Not confirmed — the server did not answer; the screen will
      re-check."
    - Operator question 2, now only for the 2xx-but-unreadable arm: "Saved — the server's answer could not be read;
      the screen will re-check."
    - Merge PR #322, by `--admin --squash --match-head-commit 451854d1dc0e7d70aef392e509f7d108688cd633`.
  - After the merge: run 322 closes with `final:true`, the programme's last close. Then this session checks the
    deploy read-only and opens a docs PR for this ledger, writing the three fix-round numbers only once their
    definitions are on `main`.
- **R32 (2026-10-09 00:53)**, cross-programme finding 4063: a worker's ask was invisible, and the stall watch's
  dialog cap kept being pushed back.
  - Child-reclamation's coordinator (`ccrc-pwa-calm-mesa`, mail 4063) reported that worker
    `ccrc-pwa-clear-summit` (run 347; Claude Code 2.1.294, `bypassPermissions`) has been parked on an
    AskUserQuestion since 2026-10-08 21:28:43Z. There is no ask row, the hookstate reads `working` with a null ask,
    and no stall signal or mail went out.
  - This session ran a read-only forensic workflow (`wf_3df2ac3d-c0a`; three Opus·high lenses: transcript
    timeline, hook and ask path, stall watch). Its output is saved to `finding-4063-forensics.json`. All three
    lenses support one cause.
    - The hook. `ccd/session-hook.sh` parses a subagent's `agent_id` into `paid` but checks it only for the turn
      marker. Every PreToolUse or PostToolUse writes `state=working, ask=null` over the session's hookstate,
      whoever sent it.
    - The timeline. A background subagent launched 29 s before the ask made its first tool call 3.1 s after it,
      then 57 more until its SubagentStop at 21:39:30, which carried the clobbered state forward.
    - The control. `ccrc-pwa-bright-river`, on the same version and mode with no subagent running, recorded
      `waiting` with its questions through PermissionRequest.
    - The server. It mints an ask row only on the first pane tick that sees a new menu (`watch.ts` ≈:6567), so an
      ask clobbered within about 3 s is never recovered.
  - The stall watch's part, which is this lineage's.
    - With no ask, the case falls to the dialog hold (2b). The design means 2a, where a pending AskUserQuestion is
      legitimate and goes to the asks lane.
    - The dialog cap's quiet clock counts the newest mail sent to the worker even when the gate cannot deliver it,
      and a `waiting` pane is never delivered to. The coordinator's mails 4055 and 4060 each restarted the 2 h
      clock, so it falls due at 2026-10-09 01:29:13Z.
    - At the box's arming (`stall-watch-live` without `stall-watch-escalate`, level Check), the dialog cap records
      only a shadow row and pushes nothing. A stuck dialog reaches no human unless the operator chooses Alert or
      above.
    - `runs signals` carries no stall fields, so its silence was never evidence that no stall row exists.
  - Owners, as this session reads them. None of the fixes is in this programme's scope, and none is implemented
    here.
    - (1) The hook: subagent events (non-empty `paid`) must not change the main thread's state or ask, carrying
      them forward as SubagentStart and SubagentStop already do. The test is main AskUserQuestion, then a Bash with
      `agent_id`, then SubagentStop, still `waiting` with the questions. It belongs to the ask lane's owner.
    - (2) The dialog cap times a `waiting` dialog from the live stamp, or counts only delivered mail. It belongs to
      the stall watch: a follow-up to this lineage.
    - (3) Arming stays the operator's.
  - Routed: a reply to `ccrc-pwa-calm-mesa`, and a report to the operator, who decides whether (1) and (2) open as
    a programme.

## Carried constraints (reviewers get these)

- Mutation-table discipline: every guard ships with a row measured red when it is removed, before and after.
- The README citation instrument (`session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE
  BOUND|TWO CORPUS|whole corpus'`) stays at `7 passed | 328 skipped (335)` (R22). README and `CLAUDE.md` edits are
  made in place.
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

- **Wave 1:** run 295, `docs/superpowers/plans/2026-10-05-stall-watch-settings-w1-server.md`, all seven tasks,
  on a fresh child of `ccrc-pwa`.
  - Read the plan at merged commit `4e7cf095f` (plan blob `30994b7702d2b8627c2cf9e64bf5b66d94eb50c9`).
  - The docs prerequisite is satisfied: PR #285 merged on 2026-10-06 11:33 UTC with every CI check green.
  - Re-read claims at dispatch. Run 260's known overlap does not block the start: follow R5 and the plan's claim
    precondition, work only uncontested paths after the expected all-or-nothing 409, and sequence the shared paths
    when they release. A different holder gets the same treatment; do not split the seven-task wave.
  - The migration count on `origin/main` at `b3b5a73ed` remains 16, so W1's planned migration is still slot 17;
    re-measure it immediately before dispatch and again before merge.
  - Execution: `superpowers:subagent-driven-development` with `superpowers:test-driven-development`, with routing per
    R4.
  - Done: merged as `7f7bf4afc` (#320), and run 295 closed (R20).
- **Wave 2:** run 322, `docs/superpowers/plans/2026-10-05-stall-watch-settings-w2-pwa.md`, all four tasks plus wave
  1's review residue, on the fresh child `ccrc-pwa-calm-basin`. Its brief is
  `.superpowers/sdd/stall-watch-settings/w2-wave-brief.md` (R20).
  - Item 5 touches `shared/api.ts` and `watch.ts` only in the lines run 291's coordinator consented to (mail 3872),
    as confirmed in R21 (mail 3874).
  - At wave-done: re-measure, advance, then a review run with the held-out panel. The merge is the operator's call.
    Wave 2 is the last wave, so its close carries `final:true`.
