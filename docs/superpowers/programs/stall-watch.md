# Program: stall-watch

Spec: `docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md` (rev 3.1, approved 2026-09-29)
Plans: `docs/superpowers/plans/2026-09-29-worker-stall-watch-w1.md`, `…/2026-09-30-worker-stall-watch-w2.md`,
`…/2026-10-02-stall-watch-reactivation-quiet.md` (wave 3), `…/2026-10-02-worker-stall-watch-w3.md` (wave 4: skills and
docs; the file keeps the spec's "wave 3" name)
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
| 3 | the quiet clocks restart when a run re-enters an active state (shadow-review class 1) | server | #228 (merges after #227) | **review clean** — run 221 accepted, review run 224 clean (4 Minor, ruled R11); PR awaits the operator's merge |
| 4 | the coordinator and worker clauses (spec §6.1, §6.2) and the continuity amendment (§6.3) | skills (reach homes through `ccrc update`) | — | **dispatched** 2026-10-02 as run 226; **awaiting review**: #232 at `571268cdc`. Clauses 16/17 per R14 and R15; the wave-done (20:16) was re-measured and accepted. **accepted, merging**. Review run 239 (dispatched 22:39 after a `cap-daily` wait, R16) found 4 Minor and no blocker (R17). The run waits at `merging` for the operator's squash-merge of #232 |
| 5 | follow-ups: indexes for the stall watch's mail read (a migration); a curated sweep of wave 2's parked minors; wave 3's follow-ups and its review's pins | server | — | planned and reviewed; dispatches after #227 and #228 merge |
| 6 | the wave-2 review's fixes: G1 (the `worker` alias hides fix rounds from the quiet arm), G2 (busy-gate holds misreported as mail-stuck/coord-deaf), G3 (the dialog cap keyed per dialog), G4 (run-less latches across a restart) | server | — | planned and reviewed (R19); dispatches after waves 3–5 land |

Waves 1 and 2 ran before this ledger existed, under subagent-driven development in one session; their records are
the two plans' own "Deviations found" sections and their PRs. Run-tracked waves start at 3.

## Arming track (the operator's hand; files in the fleet registry)

| marker | arms | state | gate |
|---|---|---|---|
| `stall-watch-live` | wave 1's r1 (a check mailed to the worker; never pushed) | not armed | recommended now — the shadow review found every false r1 harmless, and run 237's 15 h silence (2026-10-03) is a fourth true stall r1 would have caught |
| `stall-watch-escalate` | r2 (coordinator report), r3 and every operator push, including the limit, dialog and coordinator-ball caps | not armed | after #228 is deployed and wave 6 re-keys the dialog cap, and only while w2-live is off or `mail-gate-busy` is armed (R18). r2/r3 were true on run 237, and the dialog cap is 2/2 true |
| `mail-gate-busy-shadow` | the busy gate logs only | not armed | **recommended now** (R18). Its log is the evidence for `mail-gate-busy`, which removes the mail-stuck/coord-deaf false class at its cause |
| `mail-gate-busy` | busy delivery | not armed | after busy-shadow evidence; C7 (the spinner row on a busy+done pane) is still unobserved |
| `stall-watch-w2-live` | every wave-2 arm's sends | not armed | the 48 h review is done (R18). It is NOT ready as one marker. orphan-d is 2/2 true, but mail-stuck (0/4) and coord-deaf (0/1) misreport busy-gate deafness, and w2-live also switches the quiet ladder to the marker clock, which was never measured in shadow. It arms after wave 6 and a busy-shadow period |

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
- **Routing note:** the `subagent` route field takes `haiku` or `sonnet` only (the roster's subagent class list); a
  review run's Opus lenses come from the panel script, so its route names `sonnet` there.
- **Deviation block: twenty numbers, the first of them 3788** (allocated once, 2026-10-02, before wave 3's run-open;
  floor now 3808). Thirteen are assigned: wave 3's plan defines three, wave 4's four, wave 5's two and wave 6's four, one per
  departure slug, and one more was assigned to wave 3 at its wave-done. The other seven are headroom for departures a wave reports. A worker never calls the allocator (worker clause 11): it
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
- **Wave 6:** `docs/superpowers/plans/2026-10-03-stall-watch-w6-review-fixes.md`, all four tasks, on a fresh child.
  - Read by its sha.
  - Dispatched only after wave 5's PR is proven merged: it re-anchors against wave 5's `stall.ts` and `store.ts` by
    content.
  - Its precondition also needs this plan on `main`, so that `deviation-refs` can resolve the four numbers its code
    cites.
- **Wave 4** is accepted and waits at `merging` (R17).
