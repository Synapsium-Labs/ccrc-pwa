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
| 2 | the Settings section: API client and hook; a multi-line `QuickConfirm`; `StallWatchSection`; the Notifications label rename; README; wave 1's review residue | server (it serves the PWA) | #322 | run 322 `awaiting-review` at `505ffbff4`; review run 330 dispatched (R23) |

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
