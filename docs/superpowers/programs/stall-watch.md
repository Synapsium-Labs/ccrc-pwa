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
| 4 | the coordinator and worker clauses (spec §6.1, §6.2) and the continuity amendment (§6.3) | skills (reach homes through `ccrc update`) | — | **dispatched** 2026-10-02 as run 226 (a fresh child); the spec-approved clause text (R12) |
| 5 | follow-ups: indexes for the stall watch's mail read (a migration); a curated sweep of wave 2's parked minors; wave 3's follow-ups and its review's pins | server | — | planned and reviewed; dispatches after #227 and #228 merge |

Waves 1 and 2 ran before this ledger existed, under subagent-driven development in one session; their records are
the two plans' own "Deviations found" sections and their PRs. Run-tracked waves start at 3.

## Arming track (the operator's hand; files in the fleet registry)

| marker | arms | state | gate |
|---|---|---|---|
| `stall-watch-live` | wave 1's r1 (a check mailed to the worker; never pushed) | not armed | recommended now — the shadow review found every false r1 harmless |
| `stall-watch-escalate` | r2 (coordinator report), r3 and every operator push, including the limit, dialog and coordinator-ball caps | not armed | after waves 3 and 4 land, a live period with r1 armed, and a repeat of the shadow review on live data |
| `mail-gate-busy-shadow` | the busy gate logs only | not armed | any time |
| `mail-gate-busy` | busy delivery | not armed | after busy-shadow evidence; C7 (the spinner row on a busy+done pane) is still unobserved |
| `stall-watch-w2-live` | every wave-2 arm's sends | not armed | after 48 h of wave-2 shadow (from 2026-10-01 ~12:30) and a review of it |

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
- **Routing note:** the `subagent` route field takes `haiku` or `sonnet` only (the roster's subagent class list); a
  review run's Opus lenses come from the panel script, so its route names `sonnet` there.
- **Deviation block: twenty numbers, the first of them 3788** (allocated once, 2026-10-02, before wave 3's run-open;
  floor now 3808). Nine are assigned: wave 3's plan defines three, wave 4's four and wave 5's two, one per departure slug.
  The other eleven are headroom for departures a wave reports. A worker never calls the allocator (worker clause 11): it
  names a departure in its wave-done mail, and the coordinator assigns a number from the block.

## Carried constraints (reviewers get these)

- macOS CI legs are flaky by operator ruling and gate nothing; `main`'s daily run fails the same macOS set.
- Every guard ships with a test measured red when it is deleted or mutated (mutation-table discipline).
- The README citation instrument stays green (`session-hook.test.ts`, its seven citation rows); `ccd/ccd` is generated,
  so an edit to it is restamped with `shared/mark.mjs`.
- No marker gains a writer in the tree; `single-definition.test.ts` pins the six.
- **For whichever skills wave lands second** (landing-order wave 1, continuity's clause wave, or this programme's wave
  4): landing-order wave 1's plan moves three of the five count words in `coordinator-skill.test.ts` (it misses two),
  and continuity's planned worker clause waits on CI "with the Monitor tool", while this programme's worker clause says
  a Monitor is never a wake to end a turn on. They fit only if continuity's wait happens inside the turn.
- Wave 2's parked minors live in the coordinator's review notes, not in a tracked file; wave 5's plan carries the
  curated set it fixes, written out in full.

## Next-wave brief

Wave 4: `docs/superpowers/plans/2026-10-02-worker-stall-watch-w3.md`, all tasks, on a fresh child of `ccrc-pwa`, read
by its commit sha; the spec-approved clause text (R12). Wave 5: `docs/superpowers/plans/2026-10-02-stall-watch-w5-follow-ups.md`
once its plan review is ruled, dispatched only after #227 and #228 are proven merged (it builds on wave 3's code); it
carries R11's F2 and F3 pins.
