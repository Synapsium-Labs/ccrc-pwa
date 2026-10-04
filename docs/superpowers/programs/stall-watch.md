# Program: stall-watch

Spec: `docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md` (rev 3.1, approved 2026-09-29)
Plans: `docs/superpowers/plans/2026-09-29-worker-stall-watch-w1.md`, `…/2026-09-30-worker-stall-watch-w2.md`,
`…/2026-10-02-stall-watch-reactivation-quiet.md` (wave 3), `…/2026-10-02-worker-stall-watch-w3.md` (wave 4: skills and
docs; the file keeps the spec's "wave 3" name), `…/2026-10-02-stall-watch-w5-follow-ups.md` (wave 5),
`…/2026-10-03-stall-watch-w6-review-fixes.md` (wave 6), `…/2026-10-04-stall-watch-w7-wait-clause-amendment.md` (wave 7)
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-calm-harbor`   Workspace: **a fresh child per wave**

**What this program is.** The server notices a silent session and acts. It delivers mail past background work, and
mails a silent worker, then its coordinator, then pushes the operator. Wave 2 adds a main-thread turn marker on the
fleet box and the arms it enables. Every arm ships dark or in shadow, and the operator arms each one by hand with a
file in the fleet registry. No marker has a writer in the tree.

## Waves

| # | scope | deploy class | PRs | state |
|---|---|---|---|---|
| 1 | `shell` delivery; the run-worker quiet lane (r1 worker check, r2 coordinator report, r3 operator push), shadow until armed | server | #216 | **merged** `1f9fa22d7`, live v0.0.52 (shadow) |
| 2 | the main-thread turn marker; busy delivery behind markers; the wave-2 arms (orphan D/E, failed, frozen, dead, coordinator-deaf, mail-stuck, unreadable marker); wave 1's deferred items | fleet first, then server | #220 (Part A), #224 (Part B) | **merged** `cca1b6d79`, `f7e931fca`, live v0.0.56+ (dark) |
| 3 | the quiet clocks restart when a run re-enters an active state (shadow-review class 1) | server | #228 | **merged** `3255571a1` (2026-10-03 23:09, R22); live at the next auto-update |
| 4 | the coordinator and worker clauses (spec §6.1, §6.2) and the continuity amendment (§6.3) | skills (reach homes through `ccrc update`) | #232 | **merged** `4a3de53ea` (2026-10-03 22:59, R22); skills reach homes through `ccrc update` |
| 5 | follow-ups: indexes for the stall watch's mail read (a migration); a curated sweep of wave 2's parked minors; wave 3's follow-ups and its review's pins | server | #237 | **merged** `7e858c8bf` (2026-10-04 12:40, R26) |
| 6 | the wave-2 review's fixes: G1 (the `worker` alias hides fix rounds from the quiet arm), G2 (busy-gate holds misreported as mail-stuck/coord-deaf), G3 (the dialog cap keyed per dialog), G4 (run-less latches across a restart) | server | #241 | **merged** `698f679da` (2026-10-04 21:21, R33); live at the next auto-update |
| 7 | coordinator clause 16 amended (R2 with R17-F1, operator-approved 2026-10-04); the stop clause's wake-list scans (R17-F2, R21-F1) | skills (reach homes through `ccrc update`); Task 4 server comments | — | **dispatched** 2026-10-04 as run 259 to a fresh child (`ccrc-pwa-amber-meadow`), R33 |

Waves 1 and 2 ran before this ledger existed, under subagent-driven development in one session; their records are
the two plans' own "Deviations found" sections and their PRs. Run-tracked waves start at 3.

## Arming track (the operator's hand; files in the fleet registry)

| marker | arms | state | gate |
|---|---|---|---|
| `stall-watch-live` | wave 1's r1 (a check mailed to the worker; never pushed) | **ARMED** 2026-10-04 12:39:43, on the fleet registry at the operator's request (R26) | recommended now — the shadow review found every false r1 harmless, and run 237's 15 h silence (2026-10-03) is a fourth true stall r1 would have caught |
| `stall-watch-escalate` | r2 (coordinator report), r3 and every operator push, including the limit, dialog and coordinator-ball caps | not armed | after #228 is deployed and wave 6 re-keys the dialog cap, and only while w2-live is off or `mail-gate-busy` is armed (R18). r2/r3 were true on run 237, and the dialog cap is 2/2 true. Wave 6's review (R28) adds two accepted residues to weigh: a second menu under `dialogPending` inside one unchanged non-`waiting` word is not pushed (a miss, as before wave 6), and a plumbing restamp re-pushes a standing dialog at most once per restamp, 2 h apart (an extra true push) |
| `mail-gate-busy-shadow` | the busy gate logs only | **ARMED** 2026-10-04 12:39:43, at the operator's request (R26) | **recommended now** (R18). Its log is the evidence for `mail-gate-busy`, which removes the mail-stuck/coord-deaf false class at its cause |
| `mail-gate-busy` | busy delivery | not armed | after busy-shadow evidence; C7 (the spinner row on a busy+done pane) is still unobserved |
| `stall-watch-w2-live` | every wave-2 arm's sends | not armed | the 48 h review is done (R18). It is NOT ready as one marker. orphan-d is 2/2 true, but mail-stuck (0/4) and coord-deaf (0/1) misreport busy-gate deafness, and w2-live also switches the quiet ladder to the marker clock, which was never measured in shadow. It arms after wave 6 and a busy-shadow period. Wave 6's review (R28) found one more gate, coord-deaf's replay door (a hold of 50 min or more read deaf at the first replay); the fix round closes it (D-3803). After that it waits on the busy-shadow log review, a shadow re-measure of coord-deaf's new clocks and mail-stuck's busy hold, and R19's run-less push count between escalate and w2-live |

## The shadow review (2026-10-02)

Every shadow row in coord.db, read read-only: 16 rows, 8 episodes, 6 runs, 2026-09-30 17:13 to 2026-10-02 10:30
(about 41 h). Each episode was classified against its run's transitions, its mail and the worker's transcript by an
independent reader, then cross-checked by another. The cross-check upheld every verdict and relabelled one.

- **True stalls: 3.** A reviewer whose background jobs died with an OOM kill (r1 would have saved about 6 h, and r2
  and r3 were right too); a worker whose only wake source was killed by a restart (wave 2's orphan-D arm fired 15 min
  after it, about 3 h before the coordinator's own wake); the same worker's quiet arm 2 h later (r1 and r2 right).
- **False: 5**, in two classes:
  - **Re-activation inherits silence (2 episodes).** A run sent back from `awaiting-review` to `working` is charged
    with the silence it accrued while it was not a candidate, so r1 fires seconds after the send-back. A code fix:
    wave 3.
  - **A coordinator park expressed in prose (3 episodes).** The coordinator told a `working` worker to wait (for
    another programme to merge, or until a time) in an ordinary status or answer mail, never with a `wait:` subject,
    so the ball stayed with the worker. A protocol fix: wave 4's coordinator clause, widened (ruling R2 below).
- **The rate.** r1 fired 7 times (about 4 a day; the spec's census predicted about 3.5). In shadow a standing r1 counts
  as done, so r2 and r3 fall due on workers that never got a check; the shadow r2/r3 counts overstate a live rate.

**Since the review: one more true stall (2026-10-03, reported by landing-order's coordinator in mail 3309).**
- **What happened.** Run 237 (session-continuity wave 2) was `dispatched`. Its worker's background mutation run was
  killed by Claude Code's memory-pressure reap, with about 2 GB available on the box. The reap notice told the worker
  not to restart unasked, so it ended its turn asking its own unattended pane to "resume". It stayed silent until its
  coordinator found it by hand at 11:56, 15 hours after its last act.
- **What the shadow watch recorded** (coord.db, read read-only), all with episode key 20:46:37 (the last activity):
  - r1 at 23:06:44;
  - r2 at 00:07:29;
  - r3 at 01:08:14.
- **What arming would have saved.** Armed, r1 would have mailed the worker about 13 hours before the hand discovery,
  and the escalation arms would have followed within two more hours.
- **Verdict:** a true positive for the quiet arm, and a measured cost of leaving `stall-watch-live` unarmed.

**The wave-2 review (2026-10-03, 48 h of wave-2 shadow, R18).** It covered every stall row and run-less journal line
since the first review: 8 episodes and 13 fires. One Opus classifier read each episode, from coord.db, the server
journal, the registry and transcripts (all read-only). An Opus cross-checker re-measured every fire and corrected two.
Output: `w2-shadow-review.json` in the coordinator notes.
- **orphan-d: 2/2 true.**
  - A run-less session orphaned by an OOM restart that nothing woke for 45 h. Its two later lines restate the same
    key after server restarts.
  - Run 238's worker, silent 8 h after a restart. The quiet arm could not see it (the alias defect below).
- **mail-stuck: 0/4 and coord-deaf: 0/1, all harmless.** Each was mail held by the default `shell` gate while the
  recipient's main loop idled over a background subagent or workflow that was making progress. Not a lane fault. One
  coord-deaf was this coordinator, waiting on its own workflow.
- **dialog-cap: 2/2 true.**
  - Run 174's worker is at a Bash approval prompt.
  - Run 67's worker has been at one since 01:15 today, still standing.
  
  Only a human can clear these. Their coordinators were told (mails 3313, 3314).
- **quiet (run 237): r1, r2, r3 all true.**
- **Defects found, for wave 6:**
  - **G1, a false negative of high severity.** A fix-round send-back addressed to the alias `toId:'worker'` is invisible
    to `stallFacts`: it counts only mail from or to the worker's session id. So after a wave-done the ball stays with
    the coordinator for the whole fix round, and the quiet arm never fires. That is how run 238 went 8 h without an
    r1. Measured: 22 such mails from 3 coordinators since 09-25. #228 does not change it.
  - **G2, a false class.** mail-stuck and coord-deaf fire on mail the gate holds behind a progressing subagent.
    - mail-stuck falls back to the marker's `stopAt` under live `busy`.
    - coord-deaf counts an undelivered delivery as unacked.
    - The push text names a fault that is not there.
    - Its cause goes with `mail-gate-busy`, and a hold in the arms prevents a misreport until then.
  - **G3, a false negative.** The dialog cap is keyed once per mail episode, not per dialog, so a second dialog in one
    episode is never reported: run 174's second prompt, 16.5 h and counting. Its push also prints the episode's age,
    not the dialog's.
  - **G4, low.** Run-less latches live in memory, so a server restart repeats a notice: the shadow line in shadow, and
    a pending run-less operator push when live. The server restarted 4 times on 10-02 for auto-updates. The shadow
    line also omits its key.
- **Unverified, not clean:** frozen, dead, failed, marker-unreadable and orphan-e (no fires in 48 h). The marker-clock
  quiet ladder that w2-live switches on was never computed in shadow.

## Decisions & deviations

- **R1 (coordinator, 2026-10-02): clause numbers are taken at execution.** Today's next free numbers are coordinator 15
  and worker 16. Landing-order's planned wave 1 names the same two and has not merged; spec §10 says whichever programme
  lands second moves the count words and pins. Wave 4's plan re-measures at its first step.
- **R2 (operator decision requested, 2026-10-02): widen §6.1's coordinator clause.** Add that the coordinator sends a
  `wait:` mail whenever it parks a `working` worker behind another run or programme, or rules a timed action, not only
  in answer to a `stall:` mail. Evidence: the three prose-park episodes above. The code already reads a coordinator's
  `wait:` subject as the ball passing to it; only the producer is missing.
- **R3 (coordinator, 2026-10-02): a worker `finding` stays a ball-keeper.** The review found it latent (one episode
  would have fired had another mail not woken the worker). A finding that needs a ruling is a question; the worker
  skill already says so. No code change.
- **R4 (coordinator, 2026-10-02): the shadow review reads coord.db read-only over ssh**, per the operator's 2026-09-30
  standing ruling to measure ccrc's own machinery read-only. Nothing on either box was written.
- **R5 (coordinator, 2026-10-02): §6.3's continuity sentence states the arm as shipped.** The spec's text says the
  watch mails the session "15 minutes after the restart"; the shipped orphan-D arm mails once the session has sat idle
  (or on a background shell) for 15 minutes, within 24 hours of the restart, and only when `stall-watch-live` and
  `stall-watch-w2-live` are both armed. A spec sentence that misdescribes its own arm is worse than a recorded
  departure from the spec's words, so wave 4 writes the accurate sentence and records the departure.
- **R6 (coordinator, 2026-10-02): citations into dated plans, specs and ledgers are snapshots.** Wave 4's insertions
  move 14 cited SKILL.md lines, all in dated documents under `docs/superpowers`; no test or live doc cites a line the
  insertion moves. Those stay as written, recorded as a departure.
- **R7 (coordinator, 2026-10-02): the plans were reviewed before dispatch** — two Opus lenses per plan (spec and
  correctness; executability and test design) and a Sonnet refute pass. Wave 3: seven Minor, four refuted; rulings:
  the dialog and limit caps keep today's clock (they measure a pane or account condition, and a dialog that blocked
  the pane through a review still blocks the fix-round brief); the mutation table is staged and chunked and gains
  rows for the two filter terms; a newer sibling's send-back resetting an older run's episode is an accepted residual.
  Wave 4: two Important (the clause text is settled against R2 before dispatch; the wake-list pin is case-insensitive)
  and seven Minor, all accepted.
- **R8 (coordinator, 2026-10-02): the spec's optional `RunHealth.stallNoticedAt` and run warning (§10 "Optional") are
  not taken.** Wave 5's planner sized it at about half a day across eight files, moving four README-cited anchors; the
  escalation's operator push already reports a stall. A later wave can take it if the operator asks.
- **R9 (coordinator, 2026-10-02): wave 3's wave-done.** Two slugs reported: `caps-dedupe-pinned` gets D-3795 (two
  added cap-dedupe rows and a docstring), recorded in wave 3's plan; `deviation-refs-waits-on-227` is a merge-order
  note, not a departure (#228's code cites the numbers #227's plan defines), so it gets none. Three follow-ups go to
  wave 5: a run rebuilt by `CoordStore.reconstruct()` reads its first send-back as no re-activation (fails safe);
  the coordinator-ball push text omits the coordinator's own advance; README's coordinator-ball sentence needs its
  qualifier.
- **R10 (coordinator, 2026-10-02): this programme's ledger entries are visible to the collision guard.** Wave 5's
  planner found that `server/src/coord/ledger.ts`'s `DEFINITION` regex (the cross-tree collision scan) and
  `deviation-refs.test.ts`'s `ENTRY` regex accept different shapes, and the shape waves 1 and 2 used
  (`- **D-N** \`slug\`: …`) matched neither: all 128 of their definitions were invisible to both scans. Every
  definition in this programme's five plans now reads `- **D-N** — \`slug\` …`, edited in place (no line moves),
  and both scans see all of them; `deviation-refs` found no collision. **Side finding for the ledger tooling's
  owner** (not fixed here): the two regexes should be one, and a definition line that matches neither should fail a
  test rather than vanish.
- **R11 (coordinator, 2026-10-02): wave 3's review (run 224) is clean.** Four Minor findings: F1, a run rebuilt by
  `CoordStore.reconstruct()` has no dispatch row, so its first send-back still charges the review wait and README's
  sentence overstates it — accepted for wave 3, fixed by wave 5's Task 9 (D-3796, re-activation keyed on the edge into
  `dispatched`); F2, a stale docstring (`stallSilence`, "the same clock the caps use") — wave 5; F3, three text sites
  that read the moved clocks with no pins of their own (r2's subject span, the coordinator-ball push span,
  `stallCitedCheck`) — the push span is wave 5's Task 9, the other two get pins in wave 5; F4, the expected
  `deviation-refs` red until #227 merges. No send-back.
- **R12 (coordinator, 2026-10-02): wave 4 dispatches with the spec-approved clause text (§11 decision 13).** R2's
  widening, if the operator approves it, lands later as a one-sentence amendment to clause 15 and its pin. With r1
  armed, a parked worker answers a stall-check with `re stall-check: waiting`, which hands the ball to the coordinator,
  so the widening matters most for escalation, which stays unarmed until a live review.
- **R13 (coordinator, 2026-10-02): wave 5's plan review.** Two Opus lenses and a refute pass; eight findings, none
  refuted, all accepted: R11's three items were missing (written before R11 was ledgered; now in Tasks 8 and 9); the
  plan must be on `main` before dispatch because it alone defines D-3796, which Task 9 writes into code (it lands with
  this ledger's docs PR, and its precondition checks for it); the reference row's generator overflowed double
  precision and collapsed its fixture (now 32-bit safe, with explicit horizon-edge mails); two find texts crossing a
  line wrap, the slot-dependent spellings for a migration slot other than 15, one mutation row's description, and
  this ledger's block count.
- **R14 (coordinator, 2026-10-02): wave 4 yields the skill files to landing-order wave 1.** Landing-order's wave 1
  (run 218, coordinator `ccrc-pwa-quiet-river`) was dispatched at 10:33, before wave 4, and holds claim 882 on the six
  files wave 4's Tasks 1–2 edit; its plan also takes coordinator 15 and worker 16. Wave 4's worker did Task 3
  (uncontested) and asked; ruling: it never edits a contested path, commits Task 3, waits (on a `wait:` mail, so the
  stall watch reads the ball as the coordinator's) for landing-order's PR to MERGE, then merges `main` and renumbers
  to the next free numbers (16 and 17) through its plan's renumber step. Landing-order's coordinator was told, with
  the count-word gap our planner found in its plan. **This session's defect:** coordinator clause 10 says to read
  `GET /api/claims` before a dispatch; the last check was at 10:31, five hours before wave 4's dispatch, and missed
  run 218's claim. Every later dispatch in this programme re-reads the claims first.
- **R15 (coordinator, 2026-10-02 19:51): wave 4 resumes. Its absorb comes from the worker's own probe, not from this
  session.** Landing-order wave 1 merged at 19:46 (#231, `10f32755`). Its coordinator said so by mail. By 19:49, run 218
  was closed and claim 882 released, measured by a fresh read of `GET /api/claims`. The merge put two absorb rules on
  `main`: coordinator clause 15, under which a coordinator asks for an absorb only on a conflict it has measured, a
  land-sync or an ejection; and worker clause 16, under which a worker absorbs only on its own measured conflict, a red
  check that `main` passes, or a coordinator's `fix-round`. The homes still carry the older skills, installed at
  v0.0.60, but this programme follows the rules `main` carries. `ws/still-cove` (Task 3 only) merged clean against
  `origin/main` (`merge-tree` rc 0), so R14's step "then merges `main`" and Task 1 Step 1's
  `main > HEAD → git merge origin/main` branch are superseded. The worker:
  - commits the smallest edit at the insertion point;
  - absorbs on the conflict its own probe then measures;
  - renumbers in that merge commit, through the plan's "If this PR is overtaken" section: coordinator 16, worker 17,
    count words `sixteen`/`seventeen`, and the `stall.ts` comment row;
  - measures every mutation row after the merge.

  `main`'s two new clauses contain no Monitor wait.
- **R16 (coordinator, 2026-10-02 20:19): wave 4's wave-done is accepted for review, and its finding goes to the
  continuity programme.**
  - **The claim matched.** Mail 3249 claimed tip `571268cdc` on PR #232. The branch tip and the PR head both read
    `571268cdc`, and the branch's merge base with `main` is `10f32755`.
  - **The server accepted it.** It moved run 226 to `awaiting-review`, and the three items are settled done.
  - **The worker's "suite: red" is load.** Its full-suite shard 1 reds in `boot.test`'s 8 s `/health` budget, and the
    worker reproduced that on a clean `main` at load ~25. Every listed file was green. CI's selection is the arbiter.
  - **The review is waiting for a slot.** Review run 239 is open, with its brief kept in the coordinator notes. Its
    dispatch was refused `cap-daily`: 24 of 24 dispatches in the rolling 24 h, fleet-wide. Landing-order's run 238
    waits on the same cap. This session proposed a split: 238 takes the 21:27:39 slot (run 213 ages out), and 239
    takes 22:34:18 (run 214). Raising `maxSessionsPerDay` is the operator's door.
    Agreed (mails 3253, 3276-3278). The later slots are split as follows, and whoever won't use a slot they hold mails
    the other before it ages out:
    - landing-order: 00:09:10, 02:42:08, 11:53:20 and 11:54:07 (mails 3301, 3302);
    - this programme: 10:11:41 and 11:53:42, for a wave 4 re-review if one is needed and for wave 5's dispatch.
  - **The worker's finding is routed.** `monitor-wait-conflict-continuity-stage5` says continuity's planned stage-5
    worker clause (a Monitor wait) contradicts worker clause 17. It went to continuity's coordinator (mail 3252); this
    programme takes no number for it.
  - **The worker's three minors wait.** They are `lostBg` without an antecedent, `stallClause()` with no -1 guard,
    and the S3 comment. They are ruled with the review.
- **R17 (coordinator, 2026-10-02 22:51): wave 4 is accepted.** Review run 239 read tip `571268cdc` and closed done
  (report kept in the coordinator notes). It found four Minor findings and no blocker:
  - every suite green;
  - mutation rows C1–C15 and W1–W21 red as planned;
  - the contract text byte-equal to the plan;
  - landing-order's clauses byte-identical to `main`.

  Rulings:
  - **F1, the ball after `wait:`.** Coordinator clause 16 says a `wait:` holds the ball "until your next mail". The
    server's ball rule, which spec :299-300 chose, hands the ball back at the worker's next ordinary `status` mail.
    Worker clause 17 prompts exactly that mail. The cost is bounded:
    - one extra r1 stall-check per such `wait:`;
    - the worker answers it with `re stall-check: waiting`, which returns the ball (R12);
    - escalation stays unarmed;
    - today it is shadow only.

    The clause text is operator-approved (§11 decision 13), so the fix joins **R2's pending amendment**. The
    operator is asked to approve one amendment that both widens the clause and states the ball truthfully, e.g.
    "until your next mail or the worker's next ordinary mail". It is not a server change: the spec chose that rule.
  - **F2.** The S4 row pins the sentence, not the property. This conforms to the plan (D-3792). A `resume` scan of
    the wake list is parked for the next wave that edits `worker-skill.test.ts`.
  - **F3.** Merge commit `7e806d87` is a second red commit. It is accepted as history and takes no number. R15
    offered the smallest-commit route, so Task 1–2 sites did not exist at merge time, and "renumber in the merge
    commit" covered only the sites that existed. The operator squash-merges #232, so `main` carries no red commit.
  - **F4.** The stall spec still says "clause 16" at :526, :605 and :947. These are left as a dated snapshot (R6,
    D-3790's reasoning; spec :30 says §6's numbers are the next free ones). The mapping as shipped: spec "clause
    15" is coordinator 16, and spec "clause 16" is worker 17.
  - **The worker's three minors are parked.**
    - `lostBg` without an antecedent is the plan's verbatim text.
    - `stallClause()` has no -1 guard. It is a test helper that cannot fire.
    - The S3 comment's wording is cosmetic.

  **Run 226 waits at `merging`, not closed.** Three other waves touch the same files: #228, landing-order wave 2
  (run 238) and workspace-lifecycle wave 2 (run 236). A conflict before the merge then has a live worker, through
  `merging → working` and a `fix-round` (worker clause 16's third trigger). After a merge proof the run closes
  `final:true`, with wave 5's run opened first.
  Re-measured 2026-10-03 after workspace-lifecycle wave 2 merged (#233, `fe7b9775`), whose README and CLAUDE.md hunks
  landed under claim 897. #227, #228 and #232 each merge clean against `main`.
  - **The merged tree,** in the operator's merge order (main, then #227, then #228, then #232), built in a scratch
    worktree since removed.
  - **What ran on it:** the README citation cases (7 passed / 328 skipped), the skill pins, `single-definition`,
    `deviation-refs`, `dtbd`, `topology-clean` and the six stall suites. All green.
  - **Result:** no conflict, measured, so no fix-round (mail 3330).
  Re-measured the same way after session-continuity wave 2 merged (#235, `db44b136`; README +54 lines). The results
  were identical and all green.
- **R18 (coordinator, 2026-10-03 12:15): the wave-2 review sets the arming order and adds a wave 6.** The order:
  1. `stall-watch-live` now. Its one r1 in the window was true.
  2. `mail-gate-busy-shadow` now.
  3. Wave 6 fixes G1–G4. It is planned now and dispatched after waves 3–5 land, because it edits the same `stall.ts`.
  4. `mail-gate-busy` after its shadow log is reviewed.
  5. `stall-watch-escalate` and `stall-watch-w2-live` after wave 6 is live, with a live review between them.
  
  The programme becomes six waves. The review is the shadow review that spec §5 asks for before w2-live, so its fixes
  are in scope (the precedent is wave 3, from the first review).
- **R19 (coordinator, 2026-10-03 13:43): wave 6's plan, and the gate on G4's deferral.** The plan is
  `docs/superpowers/plans/2026-10-03-stall-watch-w6-review-fixes.md`, four tasks, defining D-3797, D-3798, D-3799 and
  D-3800.
  - **How it was made.** Four Opus verifiers re-measured G1–G4 against wave 3's tip and confirmed all four. G1 is wider
    than the review said: 12 of the 23 mails sent to the alias `worker` since 09-25 landed while the coordinator held the
    ball, five of them answers to a worker's question, and the coordinator skill tells coordinators to use the alias. An
    Opus planner wrote the plan. Two Opus lenses reviewed it, and two fix rounds followed, each re-reviewed.
  - **Rulings in those rounds:**
    - coord-deaf times from the first delivery (the replay count tells it: a replay re-stamps `deliveredAt`);
    - a still-queued, undelivered mail is bounded at `DELEGATE_CAP_MS + COORD_DEAF_MS`, about 5 h, not held forever.
      A coordinator stuck in a running turn has no other arm;
    - a row parked before delivery is timed from its queue, as before;
    - the dialog cap is done when any standing row was written since the dialog's onset, whatever its key.
  - **Left as residuals in the plan:** the limit cap still keys on the mail episode (a limit clears itself), and
    mail-stuck still reads `shell` as idle under strict mode, which nobody arms.
  - **G4's durable run-less latch stays deferred** (D-3751's ruling stands). It has a gate: between arming
    `stall-watch-escalate` and `stall-watch-w2-live` (R18 step 5), count the repeated run-less operator pushes against
    server restarts and registry flaps. Then either accept the repeat, or fund the latch the plan sketches under "Not in
    this wave".
  - **Its guards are measured:** `deviation-refs` 31/31 once the plan is tracked; `dtbd` and `topology-clean` green.
- **R20 (coordinator, 2026-10-03 18:33): wave 4 goes back for one absorb.**
  - **The conflict.** Landing-order wave 2 merged as #234 (`0087a045`). It appends its native-queue sentence to the
    end of coordinator clause 15 and edits `CONTRACT[14]`. `git merge-tree` of `ws/still-cove` against `origin/main`
    then exited 1 on `ccd/coordinator-skill/SKILL.md` and `server/test/coordinator-skill.test.ts`. #227 and #228
    still merge clean.
  - **The licence.** This is the measured conflict that coordinator clause 15 licenses, and the second-lander rule
    agreed in mails 3240 and 3241. Run 226 went `merging → working`, and the worker got a `fix-round` (mail 3358):
    - re-probe;
    - take a fresh claim on the two files only (claims 891 and 897 had lapsed at the 8 h cap, and run 174 holds
      README in claim 950);
    - `git merge origin/main`, keeping both sides: clause 15 with #234's sentence, ours at 16, count word unchanged;
    - re-gate, including C1–C15 and the citation cases;
    - send a fresh wave-done.
  - **What follows.** A new review run reads the merge, and the run then returns to `merging`.
  - **18:37, the wave-done.** The fix round returned (mail 3359) and was re-measured:
    - tip `bc1a13edd`;
    - the probe against `main` exits 0;
    - three hunks were resolved by hand, every one byte-checked;
    - the gate is green, with `coordinator-skill` at 156;
    - C1–C15 red as planned.

    Run 226 is at `awaiting-review`. Review run 251 was dispatched to read the merge.
- **R21 (coordinator, 2026-10-03 18:48): wave 4 accepted again after its absorb.**
  - **What the review read.** Review run 251 read `bc1a13edd` and closed done.
  - **The merge lens:** nothing found, each check by hash.
    - Clause 15 equals `main`'s.
    - Clause 16 equals `571268cdc`'s.
    - `CONTRACT[14]` and `CONTRACT[15]`, and both imports, are as briefed.
    - The count word reads `sixteen` everywhere.
    - `--remerge-diff` touches only the two conflicted files.
    - Nothing of `main` is reverted.
  - **The gates:** all suites green, and C1–C15 red as planned.
  - **Findings.** F1 is new and Minor: the S3 row guards on three words only. It is parked with R17's F2 (the
    `resume` scan) for the next wave that edits `worker-skill.test.ts`. F2 and F3 repeat R17's rulings.
  - **Where the run stands.** Run 226 is back at `merging` (worker told, mail 3362), waiting for the operator's
    squash-merge of #232.
- **R22 (coordinator, 2026-10-03 23:10): the operator said "Do the pr merges", and waves 3 and 4 are on `main`.**
  - **The merges.** Each was squash-merged with `--admin`, pinned to its reviewed head with `--match-head-commit`,
    after a fresh `git merge-tree` against `main`:
    - #227 at `84bae7299`;
    - #232 at `4a3de53ea`; head `bc1a13edd` = handoff, wave 4's merge proof;
    - #228 at `3255571a1`; head `c8555f818` = handoff, wave 3's merge proof.
  - **#228 needed a fresh CI run.** The first admin merge of #228 was refused: branch protection enforces the
    required checks on admins, and #228's only red was `deviation-refs` from before #227 landed. A re-run reuses the
    old merge ref, so this session cancelled it. Instead it closed and reopened the PR for a fresh `pull_request`
    run (37160223742), on which all four required checks passed. Before that, `main` plus #228 had measured green
    locally: `deviation-refs`, the stall suites, `mail-sweep`, `push-copy`, the citation cases and `tsc`.
  - **`full-suite` on #227 and #232** is red only because the macOS legs are red. It is not a required check (the
    operator's ruling on macOS).
  - **Wave 4 is closed.** Run 252 (wave 5 of 6) was opened first, then run 226 closed `final:true`: `done`,
    `released:true`, child reclaim queued.
  - **Wave 5's dispatch waits.** Re-reading `GET /api/claims` before it (clause 10) found run 174's claim 950
    (child-reclamation wave 4, #215) holding `server/src/coord/store.ts` and `README.md`. Wave 5 edits both, and its
    migration's slot 15 is also #215's. This session proposed the second-lander rule to run 174's coordinator (mail
    3363) and holds the dispatch for the answer. #215 was last pushed 09-30, and its worker has been at a Bash
    approval prompt since 10-02 19:38.
- **R23 (coordinator, 2026-10-03 23:14): wave 5 dispatched under an agreed claim overlap.**
  - **The agreement.** Run 174's coordinator agreed (mail 3364) to the second-lander rule for claim 950:
    - both PRs land;
    - whichever merges second merges `main`, keeps both sides, renumbers its own migration to the next free
      `user_version`, and re-runs coord-db, coord-store and the README citation cases;
    - wave 5's `store.ts` edits stay inside the stall read, and its README edits stay inside the stall-watch
      paragraphs.

    #215 is not yet up for review, so wave 5 will probably land first and keep slot 15.
  - **The dispatch.** Claims were re-read immediately before it; 950 is the only other ccrc-pwa claim, and it is
    covered by the agreement. The dispatch window was at 9 of 24. The brief reads the plan at `main`'s `3255571a1`.
    Route: Opus · high, workflows off, compact 40, subagent `sonnet`. Nine items.
  - **A correction to R22.** Run 174's worker was not at an approval prompt continuously since 10-02 19:38. It
    committed between 15:43 and 17:35 today and was blocked again after (its coordinator, mail 3364). R18 measured
    it at a prompt at 12:13, and that measurement stands.
- **R24 (coordinator, 2026-10-04 00:41): wave 5's wave-done is accepted for review, and its two departures are
  numbered.**
  - **The claim matched.** Mail 3368 claimed tip `365a5c516` on PR #237. The tip, the local copy and the PR head
    agree, and it merges clean against `main`.
  - **The server accepted it.** Run 252 is at `awaiting-review`, items 9/9.
  - **The migration is slot 15.** `main` still has 14 entries, so there is no landing delta.
  - **The claim agreement held.** The `store.ts` edits are inside `stallMailFor`, plus two docstring lines of the
    method Task 1 names. README has one line, in place.
  - **Its "suite: red" is environmental.** `tmp-sweep` is the known red, `typecheck-tests` was missing pwa modules
    (12/12 once installed), and `ccd-spawn-split` passed in isolation.
  - **Departures accepted and numbered** from the block, following wave 3's precedent (D-3795 at its wave-done):
    - D-3801 `w8-it-titles-renumbered`: 28 step-prefixed `it` titles follow §10's numbering, titles only;
    - D-3802 `d3796-premise-pinned`: one row pins that only `planned` reaches `dispatched`, measured red under an
      added edge.

    Their definitions go into wave 5's plan on this session's next ledger PR. The code cites neither.
  - **A watch item for the review and CI.** The `EXPLAIN QUERY PLAN` pins were measured on the box's Node 24 /
    SQLite 3.51. CI runs Node 22. The review is asked whether the pins hold across SQLite versions, and CI's result
    on `stall-store` and `coord-db` is the arbiter.
- **R25 (coordinator, 2026-10-04 01:03): wave 5 accepted.** Review run 253 read `365a5c516` and closed done. Every
  suite was green, all 27 mutation rows and T4 were red as planned, and both `tsc` projects were clean.
  - **The pins.** The `EXPLAIN QUERY PLAN` pins assert which index is used, not exact text. `stall-store`, `coord-db`
    and `asks-store` are green under Node 22.13.0 (SQLite 3.47.2) and 22.23.3, and the plan-shape mutations red
    there too. CI's required checks on #237 are green.
  - **Wave 6's anchors.** All 28 resolve once.
  - **A correction to R24's review brief.** `db.ts` reads a database NEWER than the build as-is (rule 3). It does not
    refuse it.
  - **F1, six wave-1-subset `it` titles still on wave 1's step numbers.** Folded into D-3801's definition. Wave 6's
    brief carries the six, titles only.
  - **F2, D-3794's proof-bound line over-promises when the background count is unmeasured (`bg` -1).** Residue. The
    deadline half of the sentence holds, and every captured lane sends `background_tasks`, so `bg` -1 comes only from a
    restart, a clear or an old binary. A later wave may extend the line.
  - **F3, a lane row's title overclaims `stallCitedCheck`.** The filter is already pinned by an L1 row (measured).
    Wave 6's brief carries a retitle.
  - **F4, `delivery mailId` has no failure row, deliberately and unreachably.** Wave 6's brief carries one comment
    saying so.
  - **D-3801 and D-3802 are defined in wave 5's plan** on this ledger branch. The code cites neither.
  - **Where the run stands.** Run 252 is at `merging` (worker told, mail 3371), waiting for #237's merge.
- **R26 (coordinator, 2026-10-04 12:43): arming, the last merges, and the last wave.**
  - **The operator said "Do the arming run for me."** At 12:39:43 this session created
    `~/.cc-sessions/stall-watch-live` and `~/.cc-sessions/mail-gate-busy-shadow` on the fleet box. That is the arming
    step R18 recommended, and none other.
    - Both boxes measured v0.0.69 (`3255571a1`, which carries wave 3's fix and wave 4's skills) beforehand.
    - No marker existed before. `mail-disabled` is absent.
    - This is a one-time act at the operator's explicit request. The tree still has no writer for any marker.
  - **The operator said "Yes to merges."** #237 (wave 5) and #238 (ledger R22–R25) were squash-merged with `--admin`,
    each pinned to its head:
    - #237 at `7e858c8bf`; its head `365a5c516` equals the handoff, which is wave 5's merge proof;
    - #238 at `0750f4490`.
  - **Wave 6 is dispatched.** Wave 6's run 255 was opened first. Then run 252 closed `final:true`: `done`,
    `released:true`, child reclaim queued. Wave 6 was then dispatched to a fresh child.
    - The checks before dispatch: claims re-read (run 174's three claims do not overlap), the window at 8 of 24, and
      the plan's preconditions measured on `main`.
    - The brief reads the plan at `0750f4490`, carries R25's three carry-overs, and warns the worker that its own run
      is now watched.
  - **An open operator question (2026-10-04): should arming default on for other installs, or be a Settings-page
    toggle?** Today no install arms anything; the markers have no writer in the tree, by design. This session's advice
    is in its reply to the operator. A toggle would be a spec change, planned only on the operator's yes.
- **R27 (coordinator, 2026-10-04 15:09): wave 6's wave-done is verified, and its review is dispatched.**
  - **The claim.** Mail 3385 (15:05:56) reports PR #241 from `ws/warm-basin`: five commits on base `59a435f0d`
    (Tasks 1–4 under D-3797, D-3798, D-3799 and D-3800, then R25's carry-overs under D-3801). Its suite line reads `red`,
    `failure: unclear`: the worker's full server run had 17 reds in 10 files the wave does not touch, at load average
    about 170. Sixteen passed in isolation; the seventeenth is `tmp-sweep`'s known FAILS CLOSED row.
  - **Re-measured, not believed.** The branch tip, the PR head and the handoff all read `4980d79fb`. The merge-tree
    probe against `main` (`c9ada6543`) is clean, so nothing licensed an absorb (worker clause 16), and the worker
    took none. Run 255 advanced `working` then `awaiting-review`, and the server's re-measurement agreed. All five
    items settled `done`.
  - **Review run 256 is dispatched** to a fresh reviewer, with the held-out panel and one wave lens, THE FOUR DEFECTS
    AND THE ARMING. It measures D-3798's accepted cost (a replayed mail timed from its queue time), G3's restamp,
    and whether each R18 gate on `stall-watch-escalate` and `stall-watch-w2-live` closes once this merges. It also
    runs the stall suites on the merged tree, since `main` moved after the wave's base. The worker's own minors go
    to the panel to confirm or refute; this session rules on the report, not on the mail.
- **R28 (coordinator, 2026-10-04 15:38): review 256 rules wave 6 clean but for one finding, and one fix round goes
  back.** Review run 256 (`ccrc-pwa-soft-mesa`) read `4980d79fb`: 43 panel agents, none died, 13 raised, 10 survived,
  merged to 9. Every suite is green at the tip, 29 of 29 mutation rows red, and the tree merged with `main`
  (`c9ada6543`) is clean, its five stall suites and `single-definition` green. Each of G1–G4 is closed where R18
  measured it. PR #241's required checks are green. Run 256 closed `done` on its own fingerprint. Rulings:
  - **F1, fix now (D-3803).** The replay door: D-3798 (b) timed a replayed row from its queue, so a gate hold of 50 min
    or more read deaf at the first replay, 10 min after delivery. That is G2's class again, and it would sit in the
    shadow census `stall-watch-w2-live` arms on. The reviewer proved the worker's proposed estimate sound (never early,
    late only, bounded), so it lands in this PR rather than a wave 7. `MAIL_REPLAY_MS`'s value moves to `shared/api.ts`,
    the precedent `MAIL_MAX_ATTEMPTS` set; `shared/api.ts` is unclaimed.
  - **F2 and F3, accepted as residue, no code.** F2: under `dialogPending` with an unchanged non-`waiting` word, a
    second menu is not pushed (the build before wave 6 missed it too). F3: a plumbing restamp re-pushes a standing dialog
    at most once per restamp, 2 h apart, which is an extra true push, never a miss. Both are written on the arming
    track beside `stall-watch-escalate`. Keying `dialogPending` on its own onset needs a stamp the pane scrape does not
    carry (`fleet.ts` reads it as a `Set<string>` of session ids), so it would be a design change, not a fix.
  - **F4, accepted.** Worker clause 16 governs over the plan's handoff-gate "merge origin/main": the probe is clean,
    #239 touches none of the nine files, and the reviewer ran the merged tree green. The fix round takes no absorb
    unless the worker's own probe measures a trigger.
  - **F7 and F8, fix now (D-3804).** Add the multi-run row; drop the unpinnable `m.runId !== null` conjunct; seed one
    prior delivery in the coordinator mail-stuck shadow fixture.
  - **F5, F6 and F9, fix now, no number.** PR body: `watch.ts` changes three lines, not two. Wording at README :2717
    and `stall.ts` :63 and :1714: busy delivers only while `mail-gate-strict` is absent. The two titles at
    `stall-verdict.test.ts` :1592 and :685 say "once per dialog".
  - **The worker's "was delivered at" minor is refuted (3/3)**: the sentence is true and prints the queue age beside it.
  - **Arming readiness, from the review.** `stall-watch-escalate`'s code gates close on merge; it still waits on wave 6
    deployed and seen live in shadow, G1's newly visible fix-round r2/r3 shapes, and the operator's R2/R17-F1 clause
    amendment. `stall-watch-w2-live` is not ready (arming track).
- **R29 (coordinator, 2026-10-04 16:33): the fix round is verified, and its review is dispatched.**
  - **The claim.** Mail 3397 reports two commits on `4980d79fb`. `94063f217` carries all five R28 rulings (D-3803 and
    D-3804): `MAIL_REPLAY_MS`'s value is in `shared/api.ts`, at the end of the file so cited lines do not shift.
    `b29aba143` fixes three stale comments its own re-review found. The worker re-gated each suite: stall-verdict
    301 (+4), the rest unchanged, the citation instrument 7 passed | 328 skipped, and 33 mutation rows red (the plan's
    29 plus four new). Its suite line stays `red`/`unclear`, on purpose: clause 15 reads the first full run, which was
    the load run R27 records.
  - **Re-measured.** The branch tip, the PR head and the handoff all read `b29aba143`. The probe against `main`
    (`c9ada6543`) is clean, and no absorb was taken. Run 255 advanced to `awaiting-review` and the server agreed.
  - **Review run 257** is dispatched to a fresh reviewer, with the held-out panel and a fix-round lens. The lens
    covers: whether D-3803's estimate is ever early, every caller of `stallToWorker` after the dropped conjunct, the
    two re-derived assertions, and whether `shared/api.ts` stays L0. The reviewer also runs the merged tree and the
    PWA build. The dispatch call timed out on the client (curl rc 28), but the run list shows it dispatched with the
    brief queued, so it was not re-sent.
- **R30 (coordinator, 2026-10-04 17:04): the operator approves the amendment and the Settings section, and adds a
  wave 7.**
  - **"Amendments approved."** The operator approved R2 together with R17-F1 as one amendment to coordinator clause
    16. It widens the `wait:` mail to every park of a `working` worker behind another run or programme, and to every
    ruled timed action, not only answers to a `stall:` mail. It also states the ball the way the server reads it:
    the worker's next ordinary mail hands it back. Spec §11 decision 13's text gains the amendment; the server's ball
    rule is unchanged. It ships as **wave 7**, with the two parked worker-skill pins (R17-F2's `resume` scan and
    R21-F1's three-word guard). The plan is being drafted and reviewed before dispatch. It defines D-3805 and D-3806
    from the block, leaving one number of headroom.
  - **Overlap.** PR #215 (run 174, claim 956) also edits both skill files and both skill tests, in other clauses
    (its coordinator clause 3, for one). Wave 7 dispatches only once claim 956 is released or the two coordinators
    agree a split like R23. Either way, the second PR to land merges `main` and keeps both sides.
  - **"Clear stuck bash approvals, if they are still there."** Measured read-only at 17:01: neither is still there.
    `MekWarLive-swift-harbor` restarted at 17:01 after a rate limit and reads `done`. `ccrc-pwa-swift-hollow` reads
    `working`, with a prompt submitted at 16:58. Neither hookstate carries an `ask`. Nothing was typed into any pane.
  - **"Yes to stall watch section", with the question "should we be able to configure any parameters?"** That is a
    design question with its own spec. It is brainstormed with the operator before any plan, starting from a
    read-only survey of the stall watch's constants, ccrc's configuration precedents and the Settings screen.
- **R31 (coordinator, 2026-10-04 17:47): wave 7's plan is drafted and reviewed.** A planner (Opus) measured the plan
  on `main` at `22f7931af`, prototyped every edit in a scratch tree and removed it. Two Opus lenses, the contract text
  and executability, returned seven findings. One was Important, and every one was folded or answered.
  - **The prototype measured:** coordinator-skill 156 → 159, worker-skill 48 → 50; the README instrument unchanged; the
    SKILL.md edit line-neutral. The mutation rows go red as planned. Six of the worker rows go undetected on today's
    tests, which is the gap R21-F1 named.
  - **The overlap measured:** #215 never touches clause 16 or `CONTRACT[15]`, and merging the prototype with #215
    conflicts on no file that #215 does not already conflict on against `main`. The prototype merges cleanly with
    #241.
  - **Rulings on the planner's questions:**
    - The clause bytes are this session's to settle under the operator's approval. They read "whenever you tell a
      `working` worker to wait, behind another run or programme or until a time", not R2's "parks", because "park" means
      a mail-delivery park in the coordinator references. The ball sentence names every hand-back exception, so that
      three rows can pin it. That makes the clause about 1140 characters, which is accepted.
    - A parked `dispatched` worker is not named in the clause, and is recorded as residue.
    - The plan lands on `main` through the ledger PR before dispatch. That is the wave 6 convention, and it is the
      plan's own precondition 1.
    - The plan's own "merge origin/main first" and handoff-merge sentences are rewritten to worker clause 16's measured
      triggers (review 256's F4).
  - **The Important finding goes to the operator.** The true ball sentence, together with worker clause 17's turn-end
    mail ("mail the coordinator what you did and what wakes you next"), means a worker that acknowledges a `wait:`
    hands the ball straight back. The widening then helps only while the worker stays silent. One cure is a
    worker-clause sentence: the turn-end mail after a `wait:` takes a subject beginning `re stall-check: waiting`, which
    already passes the ball. That is a worker-skill change beyond the approved amendment, so the operator decides it.
    It would take the block's last number.
- **R32 (coordinator, 2026-10-04 17:51): wave 6 is accepted, and its residue moves to wave 7.** Review run 257
  (`ccrc-pwa-still-summit`) read the fix round at `b29aba143`. The panel ran 52 agents, none died: 16 findings raised,
  12 survived, merged into 7. Every suite is green: stall-verdict 301, the citation instrument 7 passed, both `tsc`
  runs and the PWA build. The fix-round mutation rows are red, and so are three of the reviewer's own. Restoring the
  dropped conjunct stays green, which proves it was unreachable. The merged tree is green against both `c9ada6543`
  and `22f7931af`. D-3803's estimate is never early with serial replays, its lateness is bounded (deaf by the sixth
  replay), and it closes R28's replay-door gate on `stall-watch-w2-live`. Run 257 closed `done` on its own fingerprint.
  Rulings:
  - **F1, a landing order, not a defect.** D-3803 and D-3804 are cited in code and defined only on this ledger branch.
    Ledger PR #243 carries both definitions and merges BEFORE #241, so `main` never cites an undefined number. #243 also
    reconciles three sentences in wave 6's plan that D-3803 contradicted: "exactly four" numbers, "No `shared/` edit",
    and D-3798 (b)'s queue rule for replayed rows.
  - **F3, keep the floor.** `Math.max(passed.at, …)` stays as a defensive guard (it binds on a backward clock step). A
    comment says so, and its row is labelled as unreachable from the store but a valid L1 input.
  - **F2, F4, F5, F6 and F7, accepted for wave 7's Task 4.** They are wording and test hygiene, with no behaviour change
    and no number: the strict-mode gate wording, the replay interval imported rather than copied in a sweep row, the
    estimate's one-send-per-interval assumption, where `MAIL_REPLAY_MS`'s meaning lives, and one comment word. A third
    fix round would cost a review cycle for no verdict change.
  - **The split observation, left as it is.** `stallDeafBody` prints the queue age and the newest delivery, never the
    estimate. Everything it prints is true, and wave 6's plan left it alone on purpose.
  - Run 255 advanced to `merging`. The merge is the operator's call: #243 first, then #241, each pinned to its head.
  - **Wave 7's overlap is agreed.** Run 174's coordinator said yes in mail 3401: both PRs land, the second merges
    `main` and keeps both sides, and wave 7 stays inside clause 16, `CONTRACT[15]` and its own rows. Wave 7 gains a
    precondition that #241 is merged, since Task 4 edits wave 6's text.
- **R33 (coordinator, 2026-10-04 21:23): the operator said "yes merge all". Wave 6 is on `main`, and wave 7 is
  dispatched.**
  - **#243 (ledger R26–R32 and the plans) merged first**, squashed at `b620da428` (21:21:29) and pinned to its head
    `3e04dd23c`. Its required checks were green; the macOS legs gate nothing.
  - **#241 (wave 6) merged second**, squashed at `698f679da` (21:21:52) and pinned to its head. The PR's head
    `b29aba143` equals the handoff commit, which is the merge proof. The probe against the new `main` was clean
    beforehand, and its required checks were green at that head.
  - **The runs.** Wave 7's run 259 was opened first. Run 255 then closed `final:true`: `done`, `released:true`, child
    reclaim queued.
  - **Wave 7 was dispatched** to a fresh child. Before dispatch: claims re-read (claim 956 had lapsed, and only run 174's
    claim 959 stands, with no overlap), 8 of 24 dispatches in the window, and the plan's preconditions measured. The
    brief reads the plan at `b620da428` and carries the split agreed with run 174.
  - **Still open with the operator:** the worker-clause sentence (R31's Important finding), and the Settings section's
    scope (R30).
- **Routing note:** the `subagent` route field takes `haiku` or `sonnet` only (the roster's subagent class list); a
  review run's Opus lenses come from the panel script, so its route names `sonnet` there.
- **Deviation block: twenty numbers, the first of them 3788** (allocated once, 2026-10-02, before wave 3's run-open;
  floor now 3808). Seventeen are assigned, one per departure slug, each defined in its wave's plan: wave 3's three (one
  at wave-done), wave 4's four, wave 5's four (two at wave-done) and wave 6's six (two at its review, R28). The other
  three are headroom for departures a wave reports. A worker never calls the allocator (worker clause 11): it
  names a departure in its wave-done mail, and the coordinator assigns a number from the block.

## Carried constraints (reviewers get these)

- macOS CI legs are flaky by operator ruling and gate nothing; `main`'s daily run fails the same macOS set.
- Every guard ships with a test measured red when it is deleted or mutated (mutation-table discipline).
- The README citation instrument stays green (`session-hook.test.ts`, its seven citation rows); `ccd/ccd` is generated,
  so an edit to it is restamped with `shared/mark.mjs`.
- No marker gains a writer in the tree; `single-definition.test.ts` pins the six.
- **For whichever skills wave lands second** (landing-order wave 1, continuity's clause wave, or this programme's wave
  4): landing-order wave 1 landed first (#231) and moved all five count words in `coordinator-skill.test.ts`
  (measured on `main`; the two its plan missed were added at our mail), so wave 4 moves every count word it finds,
  and continuity's planned worker clause waits on CI "with the Monitor tool", while this programme's worker clause says
  a Monitor is never a wake to end a turn on. They fit only if continuity's wait happens inside the turn.
- **Landing-order wave 2 (run 238, dispatched 2026-10-02) overlaps wave 4.** Run 238's Task 5 touches three files:
  - `ccd/coordinator-skill/SKILL.md`: it appends a sentence to coordinator clause 15, adding no clause and moving no
    count word;
  - `coordinator-skill.test.ts`: it edits `CONTRACT[14]`;
  - `references/wave-lifecycle.md`.

  Wave 4's clause 16 and `CONTRACT[15]` sit next to those edits. Both coordinators agreed (mails 3240 and 3241) that
  whichever lands second keeps both sides: clause 15 keeps the appended sentence, ours stays 16, and the count words
  follow `main`. The worker absorbs only on its own probe. If wave 4's PR is already open and idle when run 238 lands,
  this session measures the conflict and sends the fix-round.
- **Workspace-lifecycle wave 2 (run 236) shares claim 897's CLAUDE.md and README** under the same rule (mails 3245 and
  3246). Its two hunks are one box-token sentence and a short archive subsection; wave 4's are count words only.
  README is cited by line number, so whichever PR lands second re-runs the seven citation rows in
  `session-hook.test.ts` after merging main.
- Wave 2's parked minors live in the coordinator's review notes, not in a tracked file; wave 5's plan carries the
  curated set it fixes, written out in full.

## Next-wave brief

- **Wave 5:** `docs/superpowers/plans/2026-10-02-stall-watch-w5-follow-ups.md`, all tasks, on a fresh child of
  `ccrc-pwa`.
  - Read by its commit sha.
  - Dispatched only after #227 and #228 are proven merged; it builds on wave 3's code.
  - It carries R11's F2 and F3 pins.
  - Before dispatch: re-read claims, and take a dispatch slot by measurement or by agreement with landing-order (R16).
- **Wave 6:** dispatched (R26). Plan `docs/superpowers/plans/2026-10-03-stall-watch-w6-review-fixes.md`, all four tasks, on a fresh child.
  - Read by its sha.
  - Dispatched only after wave 5's PR is proven merged: it re-anchors against wave 5's `stall.ts` and `store.ts` by
    content.
  - Its precondition also needs this plan on `main`, so that `deviation-refs` can resolve the four numbers its code
    cites.
- **Wave 6 brief additions (R25):** the six wave-1-subset `it` titles in `stall-verdict.test.ts` (D-3801, titles
  only); the retitle of the `stallCitedCheck` lane row in `stall-sweep.test.ts`; and one comment beside
  `stall-store.test.ts`'s proven-column `it.each`, saying why `delivery mailId` has no row.
- **Waves 3 and 4** are merged (R22). **Wave 5** is accepted and waits at `merging` (R25).
