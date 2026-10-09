# Program: session-continuity

Spec: `docs/superpowers/specs/2026-09-23-session-continuity-design.md`
Plans: `docs/superpowers/plans/2026-09-2?-session-continuity-wave<N>-*.md` — each written once the waves it depends on
have measured what it needs (the table's "depends on" column)
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-quiet-river` (assigned by the operator 2026-10-02)   Workspace: **a fresh one per wave**
Ticket: `CCR-18` (Linear; mirrored as GitHub issue #197) — the coordinator is created from it
Companion programme: `docs/superpowers/programs/landing-order.md`

**What this program is.** A restart — limit rescue, auto-home, manual swap, supervisor revival — is today a place
where work is lost: the swap carry skips a session's journals on a return visit, the restarted session is told
nothing specific, a resumed session is rescued again on the limit banner it brought with it, the operator's
`/model` reverts, and Claude Code's pressure reap kills the watchers of idle sessions while real orphans go
uncollected. This programme makes a restart a place where work is handed over. It adds no revival: the swap stays
the one sanctioned restart. The operator's rulings are the spec's §3 (C1–C14); §11 items 1–5 were ruled on
2026-09-23, and item 6, found at plan review, on 2026-09-24.

## Waves

| # | spec stage | scope | deploy class | depends on | PRs | state |
|---|---|---|---|---|---|---|
| 1 | 1 | the carry merges instead of skipping; its slot and byte budget; `(merged +N ~R !D)`; the prerequisite write-model measurement; `deploy/measure-continuity.py` with its carry counter | **AGENT-FIRST** (ccd) | — | #230 | merged 2026-10-02 (`a934a59b`); run 219 closed; deploy AGENT-FIRST by the update mechanism |
| 2 | 4, rules 2–3 (rule 1 shipped in #207) | the dated row the waits read; the rescue wait near a five-hour reset (600 s) with its own grace; the no-room wait; spread, no-bounce, the chain wait; `$REG/<id>.rescuewait`; the stage-4 instrument rows | **AGENT-FIRST** (ccd) | — | #235 | merged 2026-10-03 (`db44b136`); run 237 closed; deploy via ccrc's updater |
| 3 | 7 | `$REG/<id>.typed`; the operator's own `/model`/`/effort` promoted to the route record before a stop; the alias table and the `familyClassOf` port with its agreement pin; FIRST, wave 2's residue | **AGENT-FIRST** (ccd) | — | #250 | merged 2026-10-05 (`77f8d63a`); run 248 closed; deploy AGENT-FIRST via ccrc's updater |
| 4 | 6, first part | the reap-class OOM count in the instrument (its baseline week starts at deploy); `ccd-scope-sweep` with its units, verdict record and doctor reader; the limit-banner harness leak | **AGENT-FIRST** (ccd, deploy, doctor) | wave 3 | #299 | merged 2026-10-06 (`1bb88d5e`); run 274 closed; deploy AGENT-FIRST via ccrc's updater (baseline B starts at deploy); run 274 (`ccrc-pwa-still-river`); plan #288 (`0dad0fdf`); block 4012–4021 + 4088–4093 |
| 4b | 6, first part | `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` in the spawn environment; 3925's `/clear` fix | **AGENT-FIRST** (ccd) | wave 4 plus its one baseline week | — | run 308 open (planned; the run's wave 5), block 4316–4325; to plan; FIRST commit: wave 4's residue (review 305 F1(a), the PASS line, I1, …) |
| 5 | 2 | the spike: native exit handoff under ccd; a paused workflow under a blocked parent; `OOMPolicy=continue` on a scratch pane scope | measurement — needs a scratch account from the operator | wave 1 | — | to plan |
| 6 | 3 | graceful stop; the launch record; the manifest; the composed redrive prompt | **AGENT-FIRST** | waves 1, 5 | — | after wave 5 |
| 7 | 4, the refusal | non-rescue swaps refuse while delegated work is in flight; `--cut-delegated`; its own 409 | **AGENT-FIRST**, then server | wave 6 | — | after wave 6 |
| 8 | 5 | the three skill clauses; review-panel's "resume before re-run"; run signals; `FleetSession.delegations` and its chip | skills, server, pwa | wave 6; landing-order wave 1's clauses | — | after wave 6 |
| 9 | 6, second part | ccd stops a pane's scope when it ends the pane | **AGENT-FIRST** | waves 5, 6 | — | after wave 6 |

Waves 1–4 are independent in function and may be worked in parallel, but each edits `ccd/ccd`, so they land one at
a time: each lands on current `main` by a clean `git merge` (landing-order clause 16's triggers), re-stamps, and
re-measures the citation corpus and the `_reg_get` census on the merged tree before its final gate.

## Decisions & deviations

- **2026-09-23 — the design, its rulings and the written spec.** Approved in the brainstorm (C1–C8); the operator
  ruled every open decision on the written spec the same day (C9–C14). Two adversarial rounds and a numbers and
  consistency pass preceded the rulings; each measurement the spec cites names its instrument.
- **2026-09-23 — stage 4 split at the source.** The spec's §10 said `1 → 2 → 3 → {4, 5}`, but stage 4's rules 1–3
  read only the transcript, the limits files and the swap log. Corrected in the spec before any plan was written,
  so wave 2 ships the rescue policy early and wave 7 carries the refusal that needs stage 3's scan. Not a deviation
  — the spec over-constrained itself and was fixed at the source.
- **Amendment slugs.** Each is minted by the plan that implements it and defined in that plan's
  `## Deviations found` in the same act: `sidecar-carry-merges` (wave 1), `carried-in-banner-is-not-a-block` and
  `rescue-waits-near-reset` (wave 2), `operator-model-survives-restart` (wave 3), `inert-scope-sweep` (wave 4).
- **2026-09-24 — §11 item 6 ruled: leave it and count it.** A stalled session whose own account is the only one with
  room idles as today; no in-place restart is sanctioned. Wave 2's plan gains the count — four `noroom_…` rows in
  `measure-continuity.py --stage 4`, measured red-first and by seven mutations on the plan's prototype — and the
  question returns to the operator with that count in hand.
- **2026-09-24 — execution: coordinator dispatch.** The operator creates one coordinator per programme from its
  ticket. Each wave goes to a fresh worker workspace running subagent-driven development, a review run reads the
  worker's branch, and the coordinator rules and merges; the plans reach a worker only from `main`, so the docs
  PR carrying the specs, the ledgers and the first four plans merges before the first dispatch.
- **2026-09-28 — the plans re-measured against `main` `c62e22b9`.** Nine commits landed after 2026-09-24 (#182–#186,
  #192–#195); three edit `ccd/ccd`. Wave 1 holds: only line hints, README's two anchors and one scan total moved, and
  every count and mutation row reproduced on a copy of `c62e22b9` with its edits applied. **Wave 2 is HELD for a
  re-plan:** #195 (D-3522) made the rescue read a 401 its own process wrote as a block, and the plan as written drops
  that detection (Task 1), rules the 401 `carried-in` on an account rescued onto after a rate limit (Task 2), and lets a
  transcript-only 401 chain-wait (Task 4). The plan's status block names the measured fix; the re-plan is
  prototype-first on current `main`.
- **2026-09-28 (evening) — wave 1 re-measured again; wave 2's Tasks 1–2 superseded.** `main` moved to `023fe94d`
  (child-reclamation wave 3, #187; update-management wave 4, #181). Wave 1 still holds: `_swap_carry_sidecars` is
  byte-identical, 54 lines lower, and only hints, README's anchors and counts moved (restated at `023fe94d`). **Ruled
  by the operator** in the same day's residue batch: stage 4 rule 1 (C12) ships now as its own one-task fix on
  #195's carrier, the pane's process start (`_pane_born`), not on `$REG/<id>.landed`, and a landing whose Claude
  Code never came up (`.spawn` rc 4) is still moved. That fix supersedes wave 2's Tasks 1–2; D-3497 stays rule 1's
  number. Tasks 3–5 are re-planned on its reader once it is on `main`; a draft re-plan against #195 alone is not
  used, and its safety review's two rules carry forward (the plan's status block).
- **2026-09-30 — wave 2 re-planned on the shipped carried-in fix.** Prototype-first on `main` `c88625aa`. The held
  plan's Tasks 3–6 are its Tasks 1–4; Tasks 1–2 are not rebuilt, because #207 shipped rule 1. The waits read the row
  that blocked a session through a new `dated` mode of the transcript reader, cached in `.tdate` beside the carried-in
  fix's own answer, so the 30 s `tscan` cache never hides the reset. Three reviews (rescue-verdict safety at `xhigh`,
  tests and mutations, executability and merges) raised 23 findings: 22 were applied, and one was refused because it
  conflicted with a safer fix, shown by measurement. An independent verification followed; 102 mutation rows, all red.
  The three rules carried from the shelved draft's safety review hold, each pinned: a pane tmux cannot place, or lost
  auth on either surface, takes no wait; a row written at or after its own reset keeps that reset nowhere; and a
  stalled no-room wait moves the moment a target has room. **One default is the planner's, for the operator to
  confirm or reverse** (the plan's open question 4): the hold in place after a reset turned ends `RESCUE_CHAIN_WAIT`
  (30 minutes) past the reset, where the spec held it without end; measured, `main` rescues that input at once. The
  plan's deploy step measures ccrc's own update mechanism and moves nothing by hand (operator ruling 2026-09-30).
  §11 item 6's four `noroom_…` rows ship in its instrument (CCR-20). The spec records rule 1 as shipped and amends
  rules 2–3 to the plan (rev 6). Before the docs PR the plan was replayed onto `main` `5b1c58a8`: every edit applies
  and its suites are green there.
- **2026-10-02 — the coordinator assigned.** The operator made session `ccrc-pwa-quiet-river` — the planning session
  that wrote this programme's plans — the coordinator of landing-order, session-continuity and workspace-lifecycle
  together. Each wave is its own run under that session id; a fresh coordinator resumes only under the same id
  (the coordinator skill's `references/resume.md`).
  **Wave 1 dispatches now; wave 2 waits until wave 1 has landed.** Both edit `ccd/ccd`, and the coordinator does
  not dispatch two of its own workers onto overlapping files (coordinator clause 10) — the ledger's "may be worked
  in parallel" stays true of the plans, which merge either way, but this coordinator serialises them; it also
  keeps one fewer suite-running worker on the memory-bound fleet box.
- **2026-10-02 — wave 1 dispatched as run 219** to a fresh workspace (`ccrc-pwa-swift-ridge`, branch `ws/swift-ridge`),
  executing by subagent-driven development on the matrix's "worker executing a spec'd plan" row (Opus · high,
  Sonnet · high implementers, an Opus · high reviewer per task, workflow off, compact 40). Its deviation
  numbers, issued at run-open and written bare here until a plan on the same ref defines them: 3768 through 3777.
  The brief adds two rules that post-date the plan: the wave stops at the PR (the coordinator merges; the
  fleet moves by ccrc's own update mechanism, operator ruling 2026-09-30), and main is measured fresh.
- **2026-10-02 — Task 1's STOP row ruled a false positive (run 219).** The write-model probe printed one
  `journal: born at its last write (STOP)` row out of 151 finished-here runs. That row was the window's only killed
  run (13 s). Its journal has two rows, written on one inode, and was born 67 ms before its last write. A
  temp-and-rename journal is born at its last write, and a two-row journal cannot pass the probe's three-line
  criterion whatever the write model. Everything that can decide the question agrees with the plan:
  - the other 150 journals are append-in-place;
  - that run's agent log grew on one inode;
  - the live sample grew on one inode;
  - linkmode shows no crossover.

  Ruled: the plan's verdict stands and Task 2 proceeds. The worker records this as a departure from its own block.
  The probe's criterion is not changed in this wave.
- **2026-10-02 — wave 1 done, in review.** Run 219's wave-done (PR #230, tip `48c9156e`) passed the server's
  re-measurement. The run is at `awaiting-review` and its four items are settled.
  - The worker merged main `cf9e4cc8` (#222). The only conflict was `ccd/ccd`'s stamp, which it re-stamped. The
    citation census after the merge reads stated=base=tree, with nothing entering or leaving.
  - Departures: the worker used 3768 through 3771 from its block, each defined in the plan on the branch. 3772
    through 3777 went unused.
  - Task 1's baseline reproduced spec §1.2 exactly.
  - Task 4 Steps 6–7 (rollout and the week-after measurement) were skipped by standing rule. They are owed after
    the merge, through ccrc's own update mechanism.
  - **Signals:** `suite: red`, `failure: unclear`. The reds are boot.test's timing ceiling at load 64 (this wave
    changes no `server/src`), the known tmp-sweep red, two cases that pass when run alone, and PWA timeouts.
    **Routing is not escalated:** the red measures the box.
  - **Review:** review run 227 went to `ccrc-pwa-keen-prairie` on Opus · high with workflows on. It runs the held-out
    panel, plus the plan's own merge-safety lens on Opus · xhigh, because this wave replaces files inside live
    account roots.
- **2026-10-02 — review 227 ruled: one fix round.**
  - **The panel.** Four lenses, the plan's merge-safety lens on Opus · xhigh included, with 52 agents, none
    unverified and nothing unexamined: 14 confirmed and 2 refuted. Ten plan mutation rows re-ran red as stated. The
    citation census is stated=base=tree, and the spec §1.2 baseline reproduced read-only. CI's required checks are
    green.
  - **Two important findings.** Two guards that are correct but pinned by nothing:
    - the same-size, older-record arm of "replace only when strictly newer" (the wave's one irreversible act);
    - "slot taken once".

    Each stayed green under its mutation.
  - **Twelve minor findings:**
    - stale mutation counts;
    - two `(kept: error)` causes without a test;
    - the `!D` row's longer-copy choice;
    - two unpinned dry-pass prices;
    - "nothing waits" pinned only by a hang;
    - two comments that overstate (the slot's scope, the drain);
    - an avoidable compare;
    - a `set -u` exit through `mapfile`;
    - the UTF-8 reconfigure line;
    - the instrument's two TZ conversions.

  **Ruled: everything is fixed in this wave except F10.** The repo's rule is that a guard ships with a test that
  reds, and this wave replaces files inside live account roots. Its six departures take the block's unused 3772
  through 3777, one per group. F10 (a same-size record that is not newer is still compared) is carried forward,
  because deciding it in the dry pass would move F1's effective guard.
- **2026-10-02 — wave 1's fix round done, in re-review.** The fresh wave-done (tip `322298e5`) passed the server's
  re-measurement.
  - **Fixes:** seven commits, numbered 3772 through 3777, which uses up the block.
    - Eighteen new mutation rows (46–63), each green before its case and red after.
    - F11's `set -u` exit is closed in shipped code.
    - The stale counts are restated on the final files.
  - **F10:** untouched, as ruled.
  - **Named costs the departures record:**
    - the python3 and `mapfile` pins work by shadowing, not by a real missing binary;
    - under the blocking-flock mutation, measure-continuity's real-carry case still hangs.
  - **Re-review:** review run 230 went to `ccrc-pwa-amber-basin`. It runs the held-out panel plus the merge-safety lens
    on Opus · xhigh, because the round edits the carry block.
- **2026-10-02 — re-review 230 ruled: fix round 2.**
  - **The panel:** four lenses, the merge-safety lens included, none unverified and nothing unexamined.
  - **Measured:** every ruling holds on behaviour. F11 is rc 0 on every path, F10 is byte-identical, and twelve rows
    re-measured to their cells.
  - **One important finding.** D-3776 said the real here-string temp failure cannot be made in a fixture. That is
    false: `ulimit -f 16` makes it cheaply. So the ruling's "pin it if a fixture can" condition is met, and
    real-cause cases join the shadow pins.
  - **Six minor findings, all text:**
    - the header points the first fill cost at `deferred_*` instead of `kept: budget`;
    - "measured at zero" drops the census's two assumptions;
    - a test comment says two cases where there are three;
    - row 17's message is stale;
    - D-3774's denominator is stale;
    - row 50 says "every case" where the measured count is 30 of 41.
  - **Numbering:** each fix extends its departure, so no new number.
- **2026-10-02 — fix round 2 done, in re-review.**
  - **Fixes:** one commit (tip `d1ca968e`). The real-cause `ulimit -f` cases die under `set -u` against the
    pre-F11 code and pass at the tip; the new rows are 64 and 65.
  - **Rows re-run:** rows 1 through 65 were re-run on the 43-case file and the moved counts restated.
  - **Citations:** the citation census reads stated=base=tree.
  - **Re-review:** review run 233 went out with the held-out panel over `322298e5..d1ca968e`.
- **2026-10-02 — wave 1 accepted and merged.**
  - **Review 233** read fix round 2 and found two minor text inaccuracies, neither needing a ruling:
    - a test comment sizes paths at "~100 bytes" where they are ~165 bytes or more;
    - D-3774's list of moved rows leaves its scope unstated.

    Every ruling held on behaviour. The `ulimit -f` cases reach the real here-string failure at
    `ccd/ccd:22567`. The walker is byte-identical, and no non-comment `ccd/ccd` line changed. Accepted, with both
    texts carried into wave 2's first commit rather than paying another round trip.
  - **Totals:** three review runs (227, 230, 233) and two fix rounds. All ten numbers used, 3768 through 3777.
  - **Merge:** #230 shared no file with #229 (merged a minute earlier), and the merge-tree was clean. Squash-merged
    at the verified tip `d1ca968e` as `a934a59b`. Wave 2's run (237) was opened first. Run 219 closed `done`,
    released, and its child was queued for reclaim.
  - **Deploy:** AGENT-FIRST, through ccrc's own update mechanism.
  - **Owed after convergence:** the plan's Task 4 Steps 6–7 measurement (`measure-continuity.py --stage 1` past
    `--deployed`).
- **2026-10-02 — wave 2 dispatched as run 237** to a fresh workspace, on the "worker executing a spec'd plan" row (Opus
  · high, Sonnet · high implementers, an Opus · high reviewer per task, workflow off, compact 40). Its deviation
  numbers, written bare: 3846 through 3855.
  - **Anchors:** replayed in order against `a934a59b`, 28 of 30 match. The two that don't are the `_reg_purge`
    inventory: the stall watch's `turn` took 42, so `rescuewait` makes 43.
  - **Serialised (clause 10):** Task 3's README edits wait for landing-order #231 (run 218 claims README).
  - **Instrument:** `measure-continuity.py` takes the extend arm.
  - **Open questions:** the plan's four stay the operator's, built at the plan's defaults.
- **2026-10-02 21:30 — wave 1 deployed.** Both boxes run v0.0.63 (`10f32755`, which carries #230), applied from the
  console 19:52–20:00.
  - **Proof:** the fleet box's installed `ccd` body (`~/ccrc-versions/v0.0.63/ccd/ccd`; since #222
    `~/.local/bin/ccd` is a launcher) carries `_swap_carry_merge_walk() {` once.
  - **Owed:** Task 4 Step 7's §9 measurement, one week after the deploy (about 2026-10-09), read-only, on the fleet
    box.
- **2026-10-03 11:56 — run 237 resumed after 15 idle hours** (mail 3307).
  - **What happened.** The worker's last turn ended at 21:06 on 2026-10-02 with Task 2's code applied: red-first
    15|79 of 94, as the plan forecast, and 17 of 24 mutation rows matching. Claude Code had killed its background
    mutation run for low memory. It restored `ccd/ccd` from its snapshot, then asked for "resume" at its own pane,
    where no one is attached. No mail was sent, so the coordinator heard nothing. Nothing in the fleet woke it.
  - **The resume:**
    - the remaining rows (2.8 again, then 2.18–2.24) and Tasks 3–4 run in the FOREGROUND, one file per process;
    - a killed run is restored from the snapshot, reported in a status mail, and the turn ends;
    - its Task 2 finding comes as a `question` mail, while the plan's text ships unchanged meanwhile. The finding:
      do-not-bounce's strand push says no account can take the session while the account it just left has room.
  - **README:** no claim is live. The worker claims it before Task 3. Stall-watch #232 also edits README, and the
    second lander merges main and keeps both sides.
- **2026-10-03 12:01 — ruling on run 237's Task 2 finding** (question 3308, answer 3312): option (B), fixed in this
  wave.
  - **The finding.** When do-not-bounce strands a rescue (the only account with room is one the session just left
    blocked), the strand marker, swap.log and banner say no account in the pool can take it.
  - **The ruling.** Those two conditions ask the operator for opposite acts, so collapsing them is the overloaded-result
    defect CLAUDE.md names, and it invites the hand bounce rule 3 exists to stop.
    - `_rescue_strand_cause` probes `_swap_target` unskipped on the no-target strand path only.
    - It feeds `_strand_mark`'s existing 4th argument, one line for one line.
    - It has a test, a no-room control, a mutation row, and the measured per-tick cost stated in its departure.
  - **Option (C) was declined:** it adds a history read to every computed cause.
  - **The stall watch's shadow rows** (stall-watch coordinator, mail 3311) caught run 237's silence: r1 at 23:06,
    r2 at 00:07 and r3 at 01:08 on 2026-10-03. Armed, r1 would have mailed the worker about 13 hours before it was
    found by hand.
- **2026-10-03 15:05 — wave 2 done: PR #235 at `55137231`** (wave-done 3331; report
  `~/.cc-clips/ccrc-pwa-calm-delta/wave-done-237-55137231.md`).
  - **Re-measured:** the tip is the claimed sha, and the branch has absorbed main `fe7b9775` (#231, then #233, both
    clean). Advanced to `working`, then `awaiting-review`, both ok. All 5 items are settled.
  - **Counts:** every red-first and green count matches the plan where it states one. All 102 mutation rows are red,
    plus 4 added. The first full run had 3 reds, all load or main-red; the second run's only red is tmp-sweep, which
    is red on main. Agent 422, PWA 3205. Signals: `suite: red`, `failure: unclear`.
  - **Departures:**
    - 3846: the residue;
    - 3847: inventory 43, plus ccd-auto-swap-pool's window, which `strandnotify` had overflowed;
    - 3848: the stage-4 TZ pin;
    - 3849: ruling B, costing about 111 ms per no-room strand tick and 178 ms per do-not-bounce strand tick;
    - 3850: CLAUDE.md's README figure.
    3851–3855 are unused.
  - **Census:** cite-remeasure reads 147/197/52/35, with stated = base = tree. `_reg_get` reads 179/150. The stage-4
    live baseline (248 rescues, 4 sessions, max 4) reproduces the plan.
  - **Six minors are carried for the review to weigh:**
    - the `_rescuewait_close clear` fork;
    - `end=swap` written before the dispatch;
    - the 4300-digit `reset=`;
    - the quadratic scans;
    - failed dispatches counted as rescues;
    - §9's target of 0.
  - **Review run 246** was dispatched at 15:07 to `ccrc-pwa-swift-harbor`. The window had room.
- **2026-10-03 16:38 — review 246 ruled; wave 2 MERGED as #235 (`db44b136`)**, squash, at the reviewed head
  `55137231`, with every required check green (report `~/.cc-clips/ccrc-pwa-swift-harbor/review-246-55137231.md`;
  27 agents, no lens unverified; 4 confirmed and 4 refuted, all minor).
  - **The safety questions, measured:**
    - no input makes a session wait forever, because every hold in `_rescue_policy` is bounded;
    - there is no bounce on the rescue path;
    - a stalled pane is never held past a turned reset;
    - open question 4's bound is as planned.
    The panel replayed the plan's blocks onto `fe7b9775` and found the code matches byte for byte, apart from the
    ledgered departures.
  - **Carried to wave 3's first commit (residue):**
    - F1: `end=swap` is written before a dispatch that can be refused, so stage 4 counts `noroom:swap`/`chain:swap`
      for a refused auto-rescue. Until it is fixed, a stage-4 reading subtracts refused dispatches, which swap.log's
      `_swap_refuse` lines show.
    - F2: "its only account with room" can be one of several; say "best".
    - F3: README :1579 and the comment at ccd :23225 scope "a strand reads no swap log" to the genuine no-room strand.
    - F5: a `[[ -e "$REG/$id.rescuewait" ]]` guard on the `clear` close, which forks about 1.7 ms per tick per
      session today.
    - The worker's minors 3–5: cap `reset=` at `\d{1,12}`, a set beside the skip lists, and whether the rescue count
      keys on a landing.
  - **F6, ruled: spec §9's stage-4 target.** "Sessions with 4+ auto-rescues in an hour: 0" cannot be met by design,
    because a chain wait that runs its full 30 minutes still ends in a fourth rescue inside the hour. The target is
    restated to what the design promises: 0 sessions with a fourth rescue in an hour that NO chain wait preceded.
    The raw 4+ count is still reported. It is spec text, so it goes in wave 3's residue commit; the stall-watch
    programme claims the spec, so check its claims first.
  - **The boundary:**
    - wave 3's run 248 opened first (planned; block 3896–3905, written bare);
    - run 237 closed `final` (`released:true`, `childReclaim:queued`).
  - **Overlap notices** (mails 3343–3345):
    - landing's run 238 merges main and re-stamps before its wave-done;
    - #215 and #232 are second landers on ccd/ccd and on README/CLAUDE.md.
  - **Deploy:** AGENT-FIRST (ccd only), through ccrc's updater. The §9 stage-4 week-after reading follows it, with
    F1's subtraction.
  - **For wave 4b's priority:** on the night of 2026-10-02, Claude Code's background-shell memory reap killed work
    in three sessions, and run 237 sat idle for 15 hours. Wave 4b ships `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1`,
    so that night is measured evidence for it.
- **2026-10-04 21:20 — wave 3 planned** (#245, `docs/superpowers/plans/2026-10-04-session-continuity-wave3-operator-choice.md`).
  - **How it was made:** drafted on a measured prototype, reviewed by three Opus lenses, and all 16 findings applied.
    The plan's 45 blocks replay byte-identically onto main.
  - **Two design changes from review:**
    - a journal floor, so the first post-deploy stop never promotes keystrokes the old ccd typed;
    - the acknowledgement shapes the fleet actually writes, measured read-only across 6,669 transcripts.
  - **Rulings on its open questions:**
    - (a) the stage-4 filter is confirmed: count a fourth rescue only where a chain wait could have held it;
    - (b) the floor's two one-time costs are accepted;
    - (c) gpt-lane sessions are SKIPPED, keyed on `_is_anthropic_backend` like the settle;
    - (d) a supervisor revival (`cmd_ensure` after a crash) also keeps the operator's choice, because stage 7's
      purpose is surviving a RESTART, and a crash revival is the fleet's commonest restart;
    - (e) `opus[1m]` losing its 1M context is accepted and listed, because the record has no context field;
    - (f) `ccd stop` and `ws-archive` keep the choice, as planned;
    - (g) the older unguarded `int()` calls in `--stage 4` are carried.
  - **Numbers:** 3896–3905, plus 3921–3925 issued for the plan's nine slugs, rulings (c) and (d), and the worker's
    own.
- **2026-10-04 22:22 — wave 3 dispatched** (run 248 → `ccrc-pwa-still-harbor`; branch `ws/still-harbor` at
  `b40f4145`, nothing ahead of `main` although the slug was wave 2's worker's; worker skill present; route Opus · high,
  Sonnet subagents, workflow off, compact 40; five items, one per plan task).
  - **Plan merged first:** #245 (`f789d97d`), every required check green.
  - **Held 20 minutes** while ccrc's PWA-driven update to v0.0.78 restarted the fleet agent. The update ended `failed`
    on a hand archive inside its serial verify window, not on a broken box (landing-order ledger, same date).
  - **The brief was re-dated at dispatch.** #215 merged at `b40f4145` (22:10) before it, so the overlap line now says
    the branch already carries it and the plan's anchors in ccd/ccd, ccd/ccrc and session-hook.test.ts must be
    re-measured.
- **2026-10-05 10:00 — wave 3's wave-done** (mail 3469; PR #250 at `b00849ee`): every task done.
  - **Numbers defined:** 3896–3905 and 3921. The worker also used all four spares:
    - 3922: the journal floor follows rotation;
    - 3923: one transcript read per restart (`choicekept`);
    - 3924: a lane change moves the floor;
    - 3925: a `/model` typed before `/clear` is lost. It is listed as a known cost, with the code fix deferred.
  - **Re-measured:** the tip matches the claim, and every required Linux check is green. The reds are load or
    tmp-sweep, which is red on main. The run went to `awaiting-review`, and its five items were settled.
  - **Review run 268** is dispatched to `ccrc-pwa-plain-hollow`. It was first refused by ccd's 10 GB disk floor;
    this coordinator's three spent planning worktrees were removed (1.85 GB, all clean and pushed) and it was
    dispatched again.
  - **The worker's asks,** ruled after the review:
    1. confirm 3922–3924;
    2. defer the `/clear` fix, or require it now. The review costs the fix. ccd's own header there says "NEVER A
       SILENT LOSS".
- **2026-10-05 10:27 — review 268 reported** (mail 3498; `~/.cc-clips/ccrc-pwa-plain-hollow/review-268-b00849ee.md`).
  - **What it found:** 13 findings, no blocker. Every suite is green, 16 rows are red (spec §5.7's four among them),
    the merge onto `4100ae1c` is clean, and the residue is whole.
  - **F1:** `_supervised_start`'s unsupervised fallbacks revive without a keep, a silent loss.
  - **F2–F4 need rulings:** the "NEVER A SILENT LOSS" header; effort applied before model; 3925's `/clear` fix,
    costed at about 10 lines on the supervisor tick.
  - **Not yet ruled.** This coordinator's brief omitted the held-out panel's Lenses line, so the reviewer ran four
    Opus lenses of its own and no Sonnet refute pass. That is a defect of the brief, not of the reviewer. Mail 3501
    asks it to put F1–F13 through the refute pass and report again. Review 268 stays open until then, because a
    close would reclaim the reviewer's workspace. Review 267 had the same omission and was corrected in flight
    (mail 3500).
- **2026-10-05 10:35 — review 268 ruled; fix round 1 sent** (mail 3503). The review run closed `done`, keeping its
  workspace (`review-report-live`).
  - **The panel** (votes in `review-268-b00849ee-panel.md`): 39 Sonnet refuters, three per finding, all voted.
    - CONFIRMED: F1, F2, F3, F6, F10 (c)(d)(e), F11, F12.
    - REFUTED: F4, F5, F7, F8, F9, F13.
    - Recorded departure from the panel: the does-it-reproduce lens was the reviewer's own measurement (suites, 16
      rows, citations, the merge probe) rather than a fresh agent, and the refuters named no explicit effort. It is
      accepted for this round; the re-review runs the panel as written.
  - **Confirmed departures:** 3922, 3923, 3924.
  - **Rulings:**
    - F1 (3966): the guarded keep moves into `_spawn_start`, one choke point covering `_supervised_start`'s
      unsupervised fallbacks and ws-restore.
    - F2 (3967): the "NEVER A SILENT LOSS" header and README's list are made true, and acknowledgement-wording drift
      logs `unmeasured` once per keep. `--stage 7` must never read a rewording as zero.
    - F3 (3968): model and effort are applied as one `cmd_route` call.
    - F6 (3969): the stop-site keeps are gated on `choicekept`, and the marker is removed only after a successful kill
      or spawn.
    - 3925 (`/clear`) is DEFERRED to wave 4, carrying the review's `_sync_uuid` design note as advice.
    - F10 (c)(d)(e), F11 and F12 are text.
  - **Numbers:** 3966–3971 issued (3970–3971 spares).
- **2026-10-05 15:34 — fix round 1 done** (wave-done 3528, PR #250 at `f6faff4c`).
  - **The fixes, one commit each:**
    - F1 `6db10976` (3966): the keep at `_spawn_start`'s choke point;
    - F6 `2aed328c` (3969): stop keeps gated on `choicekept`, a failed kill unmarks, an absent tmux server proves the
      session gone;
    - F3 `c02b96f1` (3968): one route call;
    - F2(b) `0a7a6579` (3967): acknowledgement drift reads as unmeasured;
    - the prose `148178f4` and `cb8bbe6f`.
  - **Evidence:** every row is measured red. The first full run's only red is tmp-sweep, red on main too.
  - **Main merged** (`00f8a193`; clause 16 trigger 1, the stamp line only). The census is 182/153 and S6-R11 is
    unchanged. 3970 and 3971 are unused.
  - **Residuals parked:** R1 (a deleted tmux socket reads as absent and keeps a live pane marked), plus nits R2 and
    R3.
  - **Re-measured:** the tip matches the claim, and the run went to `awaiting-review`. Required CI was still running
    after the push.
  - **Acceptance review 272** is dispatched to `ccrc-pwa-amber-harbor`. Its brief names the held-out panel (three
    fresh Opus lenses and three Sonnet refuters per finding) and asks it to classify R1.
- **2026-10-05 17:03 — review 272 ACCEPTED wave 3; MERGED as #250 (`77f8d63a`)**, squash, at the reviewed head `f6faff4c`, every
  required check green. Report: `~/.cc-clips/ccrc-pwa-amber-harbor/review-272-f6faff4c.md`.
  - **The panel ran as written:** three Opus lenses and Sonnet refuters, 17 confirmed and 2 refuted, nothing
    unexamined, no lens unverified.
  - **The safety core holds:** all 28 rows red, spec §5.7's four among them; the census 182/153; S6-R11 unchanged;
    the merge is the stamp only.
  - **11 findings, all minor, carried to wave 4's FIRST commit as residue** (the precedent of landing's wave 1 and
    workspace-lifecycle's wave 2):
    - F1 (R1): narrow `_operator_choice_unmark`'s absent arm to tmux's "no server running", as ws-reclaim does, so a
      deleted socket stops reading as gone.
    - F2: recognise the `/effort` slider's own acknowledgement if a counts-only transcript census finds its
      wording; otherwise ledger the noise in the 3967 entry.
    - F3–F11: the plan's mutation cells that do not reproduce as written (3.30, 3.35); text-only pins on cmd_swap's
      3969 lines; comment drift (R3 among it); the refused-command prose; the unpinned `not given` arm; the
      ws-restore case; two red-first claims citing no commit; the `measure-continuity` key name.
  - **The boundary:**
    - wave 4's run 274 opened first (planned; block 4012–4021, written bare);
    - run 248 closed `final` (`released:true`, `childReclaim:queued`).
  - **Overlap notice** (mail 3553): landing's #248 must now absorb main (#281 in README and the doctor test; #250 on
    ccd/ccd's stamp) in its next round, not during review 273.
  - **Deploy:** AGENT-FIRST, through ccrc's own updater.
- **2026-10-05 17:05 — wave 4's rulings, and its plan is drafting** (workflow wf_db90af4f-0dd, to branch
  `docs/session-continuity-wave4-plan`).
  - **(A)** The first commit is review 272's residue F1–F11, as ruled above.
  - **(B)** Scope: stage 6 part one minus the spawn variable. That is the reap-class OOM count (its baseline week
    starts at this wave's deploy), `ccd-scope-sweep` with its verdict record and doctor reader, and the
    limit-banner harness leak.
  - **(C) The stop ships SHADOWED.** The sweep records "would stop" and stops a scope only while
    `$REG/scope-sweep-live` exists. Like `stall-watch-live`, nothing in the tree writes that file; the operator
    arms it by hand.
    - Why: it is a minute-cadence sweep that kills processes on the live fleet. The fleet's precedent
      (`stall-watch-live`, `mail-gate-busy-shadow`) observes such a verdict before arming it. This is a named
      departure from §5.6, and the operator may reverse it.
  - **(D)** What it must never stop is pinned class by class: ccd's own server scope, non-pane scopes, an
    unparseable Description, a live foreign server, a live pane, a reused pid.
  - **(E)** 3925's `/clear` fix moves to wave 4b, beside the spawn variable. Both change what a session's next start
    does.
  - **(F)** The units are installed by the installer spine.
  - **(G)** The overlap rule with #248, run 245 and run 271.
- **2026-10-06 04:55 — wave 4's plan is ready: #288** (`1cbb1c75`, 4,604 lines, 8 tasks, 13 departure slugs).
  - **How it was made:** four Opus lenses, none unverified; the reviser applied all 33 findings.
  - **What the safety lens found:** no path to a stop while shadowed, while paused or in any must-never-stop class.
    Its fixes: the cgroup and CPU sanity guard is pinned; the first-seen clock is boot-relative and bounded; an
    unreadable socket table carries rather than reading as clear.
  - **The verifier** replayed every anchor exactly once onto `d2bac7ae`. All 26 re-run rows went red. Three counts
    moved with #287, as pre-flight 15 says.
  - **Rulings on its open questions:**
    - accepted: at most three stops per tick once armed; a point-in-time reading of inert survivors; the 120 s MCP
      window; editing wave 3's merged plan entries in place (text only).
    - **arming `scope-sweep-live` is the operator's,** recommended after a week of shadow verdicts that match what the
      operator would stop by hand;
    - the leaked test tmux server (`/tmp/tmuxtest_verify`, alive since 2026-09-14) is reported to the operator. The
      sweep ignores it by design, and no session may touch tmux.
  - **Numbers:** 4088–4093 issued (the last three slugs, then three spares).
  - **Pre-deploy stage-6 reading, from the plan:** 2026-09-28 to 2026-10-05 17:00 had 40 pane-scope OOM stops, 2 of
    them reap-class. Baseline B is read one week after this wave deploys; the deploy time is recorded here when it
    happens.
  - The brief and its dispatch body are ready. Run 274 dispatches when #288 merges.
- **2026-10-06 05:20 — #288 merged** (`0dad0fdf`, 05:19, required checks green). The ledgers' own PR #289 merged beside it
  (`21f536a5`).
  - **Run 274's dispatch was refused `cap-concurrency`** (seven of seven active runs fleet-wide). Nothing on the
    run was touched; it stays planned, with the same brief and route.
  - It dispatches when a slot frees. Review 284 closing frees one of this coordinator's own.
- **2026-10-06 06:53 — wave 4 dispatched** (run 274 → `ccrc-pwa-still-river`; worker skill present; route Opus · high,
  Sonnet subagents, workflow off, compact 40; eight items, one per plan task).
  - **The concurrency cap refused it three times first** (05:19, 05:53 and 06:23, seven of seven). A slot freed
    by 06:53.
  - **The workspace branch is at `9221416a`**, origin/main (after #291), with nothing ahead. It contains #288.
- **2026-10-06 07:02 — ask 18 answered: option 0, Task 1 edits `ccd/ccd` now** and stays the first commit. Explained in
  mails 3646–3648.
  - **`ccd/ccd` is shared by region, not by claim.** Claim 1043 (run 250) does not block a disjoint-region edit,
    and nobody takes, breaks or waits on a `ccd/ccd` claim for it. The regions: run 250 has the stamp and its
    `pr-state` lines; run 245 has the RECLAIM/EXPIRE region and the spawn paths' refusal; run 274 has wave 3's
    operator-choice section, then what its plan names. The second to land merges main, re-stamps and re-runs the
    citation cases, cite-remeasure and the `_reg_get` census. A worker whose edit must leave its region asks first.
- **2026-10-06 20:21 — wave 4 done: PR #299 at `34cfe5ee`** (wave-done 3694; progress 3662; 14 commits plus a merge of
  main `77c11245`; report copied to the coordinator's evidence on receipt; the mail was read at 20:15, held behind a
  background workflow).
  - **What landed:** Tasks 1–8, each reviewed by Opus, with the kill-safety lens on the sweep. The whole-branch
    review says ready to merge.
  - **The spares, all three used:**
    - 4091: a spawn is claimed by one scope only;
    - 4092: a scope with a child cgroup, or an unreadable cgroup dir, is carried and never stopped. This was a
      CRITICAL wrong-stop path, caught before merge: a stop kills the whole subtree.
    - 4093: the merge block keeps one stamp line.
  - **The stop ships shadowed,** and nothing writes `scope-sweep-live`.
  - **Pre-deploy readings, counts only:**
    - 2026-09-16 to 2026-09-24: 16 stops, 0 reap-class;
    - 2026-09-28 to 2026-10-05 17:00: 40 stops, 2 reap-class.
  - **Re-measured:**
    - The tip matches the claim, and the four required checks are green (CI 37463910980).
    - #299 now conflicts with main `b27fabc15` (#290) on `ccd/ccd`, `ccrc-install.test.ts` and
      `single-definition.test.ts`. It merges main after the review, not during it.
    - The run went from `dispatched` to `working` to `awaiting-review`, and its eight items were settled.
  - **Acceptance review 305** was dispatched to `ccrc-pwa-warm-mesa`, with the held-out panel named.
  - **The worker's residue for wave 4b:**
    - I1, a record line kind for carried or unmeasurable scopes;
    - `s6_inert`'s staleness;
    - the zombie child;
    - the paused log line;
    - baseline B's non-zero check;
    - the per-task minors.
  - **ccrc-history's runs 293 and 302** are cleared to edit README, the doctor checks, deploy.sh and the other paths
    in their own regions, while 274's claim 1046 stands (3750).
- **2026-10-06 21:53 — review 305 ACCEPTED wave 4** (review-done 3757, reviewed tip `34cfe5ee`; report copied on receipt).
  - **The verdict:** 39 agents, none unverified; 9 confirmed (one important) and 3 refuted. All 30 mutation rows are
    red, covering every never-stop class (4092's child cgroup included), the shadow gate and the paused file, three per
    tick, the unmeasurable carry, the forged-record bounds, 4091, the doctor bounds and the harness group kill.
  - **No path to a stop while shadowed or paused:** there is one read of `scope-sweep-live` and one stop call. The
    readings reproduce: 16 stops / 0 reap-class, and 40 / 2. Departures 4091, 4092 and 4093 are confirmed.
  - **The landing round was sent** (mail 3758; run 274 is back at `working`):
    - merge main, keeping both sides of `ccrc-install.test.ts` and `single-definition.test.ts`, then re-stamp;
    - the text and one-byte fixes F2 (qualified), F3, F4, F6–F9;
    - one clause in 4020's entry naming F1's (a)–(c) and F5.
  - **Rulings:**
    - F2 is accepted as 4092's cost. A scope with a child cgroup is never stopped, even live, and the text says so.
    - F6: the worker's in-plan definitions were sanctioned by the brief, so the plan's three sentences were stale.
  - **CARRIED to wave 4b's FIRST commit:**
    - F1(a): a line doctor cannot read answers through the "cannot read" WARN with its rewrite remedy, never the
      dead-scope stop remedy;
    - doctor's PASS line, qualified for a carried live scope.
    These sit beside the worker's residue (I1, `s6_inert`'s staleness, the zombie, the paused log line, baseline B's
    non-zero check).
- **2026-10-06 22:54 — wave 4 MERGED: #299** (`1bb88d5e`, 22:54; after review 305 and the landing round).
  - **The landing round** (wave-done 3766 at `8c48de36`) merged main `8d85c7cf4` and hit FOUR conflicts, not the three
    measured. The fourth was `ccd/ccrc-doctor-checks`: main's `_check_model-default` (#302) and this wave's
    `_check_scope-sweep` were both appended after `_check_timeout`, and both were kept byte-identical. The round's own
    commits are text, comments, one blank line and the stamp (verified file by file).
  - **The re-gate** was green on every file's first run. Correction 3767: the round did not re-run the whole suite. By
    clause 15 its suite word is `unrun`; the last whole run is 3694's, with 4 known environmental reds.
  - **Runs:** 274 advanced to `merging`, then closed final (`merged`), and its child workspace is queued for
    reclamation. **Run 308 (wave 4b, the run's wave 5) was opened first,** planned, with numbers 4316–4325 written bare.
  - **Next:** wave 4b waits for baseline B's week, which starts at THIS wave's deploy. The deploy time is recorded
    here when both boxes carry `1bb88d5e`. The stop stays shadowed until the operator arms `scope-sweep-live`.
- **2026-10-07 00:26 — wave 4 DEPLOYED: baseline B starts 2026-10-06 23:16 UTC.** Both boxes run v0.0.110 (`1bb88d5e`), applied
  from the console. The fleet box finished at 23:16:17 and the server box at 23:16:50 (each box's `update.json`, phase
  `done`; `ccrc version` reads `1bb88d5e` on both). Baseline B's week ends 2026-10-13 23:16 UTC. Wave 4b (run 308) is
  planned after that reading, and the stop stays shadowed until the operator arms `scope-sweep-live`.
- **2026-10-08 — issue #317 amends stage 1, off-wave: a link `EXDEV` refused goes through a common mount, and a copy
  says why and how much.** Items 1–2 of the issue, the scope the operator set in its comment; items 3–4 (drop the
  source, `carry-dedupe`) are not part of it. Plan `docs/superpowers/plans/2026-10-08-carry-link-via-mount.md` defines
  D-4500 (`carry-links-through-common-mount`) and D-4501 (`carry-copy-says-why`), issued by the allocator; the spec's
  rev 9 carries them into §1.2 item 1, §5.1, §8 and §9. The plan's doctor `carry` check was dropped at dispatch and
  follows separately. Deploy **AGENT-FIRST** (ccd and the instrument), after the read-only pre-check: each account
  root and its path under the whole-volume mount share one `dev:inode`, the mount is read-write for the fleet user,
  and no unit has a private mount namespace (verified by the operator at dispatch). Afterwards, stage 1's
  `--stage 1 --json` should show `link_via_mount` rising and no `exdev-*` key in `copy_by_cause`.
- **Deviation blocks** are minted per wave, at that wave's run-open, by the coordinator. No `D-` token appears in
  this file until a plan on the same ref defines it (`deviation-refs.test.ts`).

## Carried constraints

- **Every wave that edits `ccd/ccd`** re-stamps it (`ownership.test.ts`), pays the citation tax for every cited file
  it moves (`session-hook.test.ts` S6-R11), keeps edits above the frozen corpus anchors length-neutral, and
  re-measures `ccd-reg-get-census.test.ts`'s sentence if it adds a `_reg_get` call.
- **Child-reclamation edits the same `ccd/ccd` lines.** Its wave 3 (run 148, dispatched 2026-09-24) rewrites the
  `_reg_get` census sentence wave 2 also rewrites; wave 2's plan locates those lines by content and derives its
  numbers from whatever the base states, so either may land first (re-measured 2026-09-24 against `main` `b501698a`).
- **The instrument grows with the programme.** `deploy/measure-continuity.py` is read-only and run by hand on the
  fleet box; wave 1 creates it with the carry counter, and every later wave adds the rows of spec §9 it owns in the
  same PR as the mechanism they measure.
- **Claude Code's regime changed on 2026-09-15.** Workflow agents pause at a five-hour limit and re-run after the
  reset. Any delegated-work baseline a plan uses is re-cut at 2026-09-16 (spec §1.1).
- **The fleet box is memory-bound.** A pane scope throttles at 8G and dies at 12G with its session
  (`OOMPolicy=stop`), and the session slice sits near its 24G ceiling. Run suites in the foreground, one at a time,
  sharded; never two full server suites at once from one pane.
- **`deploy/measure-continuity.py` has one shape, whichever wave lands first.** One registry `STAGES = {N: stageN}`,
  each `stageN(ctx)` returning named sections; `ctx` carries the home, the swap log, `since`/`until` as epochs
  (swap-log stamps are local time), `all_copies` and `deployed`; the CLI is `--stage N` (repeatable), `--home`,
  `--swap-log`, `--since`, `--until`, `--deployed`, `--all-copies`, `--json`. A wave that finds the file already
  there keeps its header, helpers and parser and adds only its own stage block and registry entry.
- **A later carry wave owes F10 (review 227).** A same-size record whose source is not newer is still queued as a
  tier-0 compare costing twice its size, ahead of every journal, although its outcome is fixed. Decide it from
  `lstat` in the dry pass, and move F1's pin to that decision in the same commit.
- **Stage 5's worker clause must agree with the stall watch's worker clause 17** (peer finding
  `monitor-wait-conflict-continuity-stage5`, from stall-watch wave 4 via its coordinator, 2026-10-02).
  - **The conflict.** Spec §5.5 (about `:486`) and §5.6 item 1 (about `:506`) have workers wait on CI or a deploy
    with the Monitor tool. Clause 17 (#232, in review) says a turn ends only on a wake you can name, and "a
    background shell or Monitor is never that wake".
  - **Before stage 5 is planned,** reword the spec so a Monitor (or a Monitor over a Bash loop) keeps a watcher
    alive INSIDE a turn and is never an end-of-turn wake.
  - **Not now:** the spec is under the stall watch's claim 891, and stage 5 is unplanned.
- **SAFETY.** Never a destructive `ccd` verb against the live host; never touch tmux, `~/.cc-sessions`,
  `~/.cc-limits` or `claude-session@*.service` directly; fixture HOMEs only in tests; never print secret contents.

- **Every brief says how a killed run is reported.** A worker that ends its turn waiting for a word typed at its
  own pane is never woken, because only mail reaches it. A run killed by the memory reaper, or anything else, is
  restored and reported in a status mail; long runs go in the foreground (run 237, 2026-10-02).

## Next-wave brief

Waves 1 and 2 are merged (#230 `a934a59b`, #235 `db44b136`). Owed after their deploys:
- wave 1's §9 stage-1 measurement, about 2026-10-09;
- wave 2's stage-4 reading, with refused dispatches subtracted (F1 above).

Wave 3 (spec stage 7: `$REG/<id>.typed`, the operator's own `/model`/`/effort` promoted to the route record, the
alias table) is run 248, dispatched 2026-10-04 22:22 to `ccrc-pwa-still-harbor`, with deviation numbers 3896 to
3905 and 3921 to 3925, written bare.
- **Its plan's FIRST commit is wave 2's residue**, the list above from review 246: F1, F2, F3, F5, the minors 3–5
  and F6's restated §9 target.

Wave 3 is merged (#250 `77f8d63a`). Wave 4 is run 274 (planned; deviation numbers 4012 to 4021, written bare), and
it is to plan.
- **Its FIRST commit is wave 3's residue,** review 272's F1–F11, ruled as above.
- **Then the reap-class OOM count and the scope sweep.** Wave 4b, the pressure-reap disable, follows.
- **It also owes** 3925's `/clear` code fix (review 268's F4 design note: read the outgoing transcript at the uuid
  rotation).
Both are AGENT-FIRST.
2026-10-02's reaped runs argue for planning 4b early.
