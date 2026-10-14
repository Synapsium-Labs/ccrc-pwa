# Program: box-token-lifecycle

Spec: `docs/superpowers/specs/2026-10-07-box-token-lifecycle-design.html` (approved 2026-10-07 15:23 UTC, revision 5).
Plan (wave 1, spec wave 1 parts A and B): `docs/superpowers/plans/2026-10-07-box-token-lifecycle-w1.md` (16 tasks: A1 to A9, B1 to B7).
Coordinator: `ccrc-pwa-bright-river`. This session also coordinates `centralised-update-management`; its ledger carries
the origin of this programme: the entries of 2026-10-07 from 09:45 to 11:06 UTC.

The programme makes ccrc mint and rotate its own box token, and later its agent link token, with no human after
install. Its first rotation retires the value that leaked into transcripts through the old argv bug. That value still
works from the internet: the server's public name has no source matcher, and the machine lanes skip the session gate.

## Waves

The spec's wave 1 ships as two runs: part A, then part B. The machinery's wave numbers therefore run one ahead of the
spec's after wave 1.

| # | spec wave | scope | run | PRs | state |
|---|---|---|---|---|---|
| 1 | 1, part A | Server authority and its files; the accept-set check; boot mint and recovery; the claim door and its census set; the `token-sync` agent op; the both-role writer | 320 | #330 | **MERGED** `f82cb9fbc` (PR #330, 2026-10-09 06:44:52 UTC; run 320 done, child reclaim queued; released as v0.0.133 at 06:45:52). The merged tree is byte-identical to `git merge-tree` of the reviewed tip `d9adc2c5a` onto `main` at `d33a566bb` (`4512d88d`). That tip is `fa384df19`, which review 352 read, plus a clean merge of `main`. Every Linux leg was green. Was: **MERGE RULED** 2026-10-09 06:25 UTC by the operator, on scoped review 352 at `fa384df19`: its F1 to F13 and number 4411's wording become part B's first task. The worker merges `main` (`d33a566bb`) and re-runs the shared pins first (mail 4084); the run is back at `working` for that step. Was: **FIX ROUND 1 DONE** 2026-10-08 20:56 UTC at `fa384df19` (mail 4039; seven fix commits on `f3d151e42` and a merge of `main` at `226bb881c`, docs only); numbers 4410 to 4413 spent, bare: defined on the worker branch; reserve 4414 to 4417 unspent. Scoped review run 352 dispatched 20:59 UTC to `ccrc-pwa-amber-river`. Was: **FIX ROUND 1 SENT** 2026-10-08 17:46 UTC (mail 4029, `rulings-run320-fix1.md`) on review 349 at `f3d151e42`: F1 meets class 3, so the bar gives the one round; numbers 4410 to 4413 ruled, reserve 4414 to 4417 (bare until defined on the worker branch). A scoped review follows. Was: **IN REVIEW** 2026-10-08 17:18 UTC: wave-done at `f3d151e42` (mail 4023), re-measured; the bar is in the 17:18 entry; D-4400 to D-4409 spent; review run 349 dispatched 17:20 UTC to `ccrc-pwa-still-meadow` (the held-out panel plus two lenses: security; state machine and live safety). Was: DISPATCHED 2026-10-08 13:26 UTC to `ccrc-pwa-bright-mesa`; plan D-4388 to D-4399, worker reserve 4400 to 4409 |
| 2 | 1, part B | `ccrc token sync`; doctor `box-token` (PASS or SKIP only); the console card and the rotate route; `deploy.sh` stops shipping the token; notify's tolerance removed; README | 350 | #341 | **LANDED LIVE** 2026-10-10 21:10:39 UTC: the first rotation retired the leaked value with no human act, and the §10.3 proof passed (`probe: 401 refused`). **MERGED** `928f5938b` (PR #341, 2026-10-10 20:39:50 UTC; run 350 done) on the operator's "merge now, pin in row 2a". Its tree is byte-identical to the merge-tree of the reviewed tip `7424434c6` onto `main` at `5c922c866`, which was tested before the merge. Was: **TO THE OPERATOR** 2026-10-09 17:26 UTC: scoped review 365 found R1 and R2, class 11 (pins short of a near variant; code correct; live rotation 29 of 29). Was: **FIX ROUND 1 DONE** 2026-10-09 16:10 UTC at `7424434c6` (mail 4134; six fix commits and a merge of `main` at `7c71244db`); no number spent, reserve 4552 to 4560 untouched. Scoped review run 365 dispatched 16:13 UTC to `ccrc-pwa-keen-cove`. Was: **FIX ROUND 1 SENT** 2026-10-09 14:32 UTC (mail 4124, `rulings-run350-fix1.md`) on review 362 at `569bb148c`: F1 meets class 6, so the bar gives the one round; no number assigned (reserve 4552 to 4560). A scoped review follows. Was: **IN REVIEW** 2026-10-09 12:00 UTC: wave-done at `569bb148c` (mail 4115), re-measured; the bar is in the 12:00 entry; numbers 4414 and 4551 defined, bare until #341 merges; review run 362 dispatched 12:04 UTC to `ccrc-pwa-brisk-delta` (the held-out panel plus three lenses: security; the first live rotation; what the operator sees). Was: **DISPATCHED** 2026-10-09 06:50 UTC to `ccrc-pwa-brisk-basin` (8 items: R0, then B1 to B7; route Opus·high / Sonnet / workflow off / compact 40; worker reserve 4551 to 4560). Was: **Run 350 open, planned** 2026-10-08 17:21 UTC, before run 320 closes. Deviation block 4551 to 4570 (bare until defined). Dispatch waits on #330's merge, and on the I3, I4 and sec-M2 rulings |
| 2a | 1, follow-up | Part 1 of the arming plan (`docs/superpowers/plans/2026-10-10-box-token-lifecycle-w1-arming.md`): review 365's R1 and R2 pins, red-first; R3 and R4; review 362's R-f and R-g; the token-line stripper's quote state; the 12:00 entry's residue 3 and 5, and residue 2, 4 and 6(a) if claim 1141 is gone. The arms stay off | 370 | #348 | **MERGED** `c6e8c5d8d` (PR #348, 2026-10-11 00:43:17 UTC; run 370 done) on review 375, clean by the 23:59 bar. Its tree is byte-identical to the reviewed tip `b747f3681`, since `main` had not moved. Was: **IN REVIEW** 2026-10-10 23:59 UTC: wave-done at `b747f3681` (mail 4193), re-measured; review run 375 dispatched 10-11 00:02 UTC to `ccrc-pwa-warm-summit`; Task 11 not taken (claim 1141 live), so it moves to part 2; the bar is in the 23:59 entry. Was: **DISPATCHED** 2026-10-10 22:20 UTC to `ccrc-pwa-amber-harbor` (9 items: Tasks 1, 2, 5 to 10, and 11 only if claim 1141 is gone; route Opus·high / Sonnet / workflow off / compact 40). The plan reached `main` in #347. Was: **PLANNED** 2026-10-10 22:15 UTC: the plan was drafted, attacked (26 breaks: 23 applied, 1 risk note, 1 rejected) and split. The brief goes out once the plan reaches `main`. Was: **Run 370 open, planned** 2026-10-10 20:33 UTC, before run 350 closed |
| 2b | 1, follow-up | Part 2 of the arming plan: `retired-presented` clears when a rotation answers it (number 4552), then the flip, `_BT_ARMS_ON` 0 to 1, with the fresh-box classes (number 4553 if ruled). Bound: merged before row 3's first PR | 377 | #353 | **MERGED** `82464a449` (PR #353, 2026-10-12 18:40 UTC), **live on both boxes as v0.0.153 at 18:48 UTC, both `PASS`**, tree verified, run 377 closed final; the operator ruled "merge now, fix both after" on review 391's two class-3 edges, which go to row 2c. Was: **TO THE OPERATOR** 2026-10-12 18:24 UTC: review 391 at `250f7f318` is clean on nine classes; two class-3 cases (F1, a server left with only its retired file; F2, a fleet box that synced, refused, then lost both files) contradict D-139's "lost stays FAIL", so the merge waits on the operator. Was: **IN SCOPED REVIEW** 2026-10-12 12:55 UTC: the fix-round wave-done at `250f7f318` (mail 4315), re-measured; review run 391 against the committed bar, where a bar-class finding now goes to the operator. Was: **FIX ROUND 1 SENT** 2026-10-12 10:03 UTC (mail 4287, `rulings-run377-fix1.md`) on review 383 at `f167754b1`: F1, F5 and F12 meet class 3, F2 class 1, F3 class 7; the operator ruled D-139 wins (never-handed reads PASS with its sentence); run 377 back to `working`. Was: **IN REVIEW** 2026-10-11 18:06 UTC: wave-done at `f167754b1` (mail 4244), re-measured; the bar is in the 18:06 entry. Was: **DISPATCHED** 2026-10-11 13:20 UTC to `ccrc-pwa-clear-harbor` (6 items: the rulings into the plan, Tasks 3, 4, 11, R and 12; route Opus·high / Sonnet / workflow off / compact 40); README consent granted (mail 4227) and the operator's Plan 4 ruling made (option 2, mail 4225), both forwarded in mail 4229. Was: **Run 377 open, planned** 2026-10-11 00:42 UTC, before run 370 closed. waits on: the operator's Decisions 1 and 2; the operator's ruling on the GPT-lane Plan 4 soak (`ccrc-pwa-clear-mesa` recommends accepting `box-token` WARNs by name on the sampler's doctor baseline; the window closes about 10-21 10:31 UTC); rulings on residue 8(a) and R-i; claim 1141 |
| 2c | 1, follow-up | D-139's two edges from review 391: a server arm that counts its sibling files as history (F1), and a sync refusal that keeps the last held generation (F2); review 391's F3 to F10 prose and coverage. Numbers 4554 to 4558. Bound: merged before row 3's first PR | 398 | #376 | **MERGED** 2026-10-13 07:01 UTC as `e4405056e`, **live on both boxes as v0.0.164 at 07:35 UTC, both `PASS`**; review 409 clean at the bar; run 398 closed final. Was: **IN SCOPED REVIEW** 2026-10-13 05:36 UTC: fix round 1's wave-done at `faa0ef03e` (mail 4512), re-measured; review run 409. Was: **FIX ROUND 1 SENT** 2026-10-13 03:17 UTC (mail 4502, `rulings-run398-fix1.md`) on review 405 at `6faca9bdf`: F1 (an own-write box's fleet-side records are a server trace) meets class 3; F2's prefixed commit-message literal is kept off `main` by a hand-written squash body. Was: **IN REVIEW** 2026-10-13 00:46 UTC: the wave-done at `6faca9bdf` (mail 4445), re-measured; the bar is in the 00:46 entry; review run 405. Was: **DISPATCHED** 2026-10-12 19:34 UTC to `ccrc-pwa-calm-delta` (7 items; the plan rides in its PR as Task 1; route Opus·high / Sonnet / workflow off / compact 40). Was: **planned** 2026-10-12 18:39 UTC, opened before run 377 closed |
| 3 | 2 | The weekly schedule; the agent link token by the same code-then-HTTPS claim. Split (proposed in the 2026-10-13 07:46 entry): 3a the schedule plus row 2c's residue; 3b dormant link readers; 3c link rotation; 3d its arming; 3e pairing | 410 (3a) | #403 (3a) | 3a **MERGED** `8b36d8b6a` (PR #403, 2026-10-14 13:40:57 UTC; released as v0.0.183 at 13:42:07), on the held-out review clean by the bar and group G's closing commit. Live on both boxes inside v0.0.184 since 14:03 UTC, and the live proof holds (the 14:42 entry). Run 410 stays `planned`: it was never dispatched. Was: **planned** 2026-10-13 07:00 UTC, opened before run 398 closed. 3a **in progress** from 23:19 UTC in the coordinator's own workspace, by the operator's direction (the daily cap refused its dispatch twice). The operator ruled both questions before 08:19 UTC (accept and guard; console code before arming), so the order is 3a, 3b, 3c, 3d pairing and repair, 3e arming |
| 4 | 3 | A token per box, stored as hashes | — | — | later |

## Decisions & deviations

- **2026-10-07, operator rulings that shaped the design** (the spec's §1.1 and Agreed box carry the words):
  - 10:31: "Surely this should be an automated ccrc feature that is handled without intervention".
  - 11:06, after the exposure was measured: "build the feature instead of manual rotation", and "it won't take weeks".
  - Brainstorming answers: retire the leak first (phasing); a one-time code over the agent link, then a fetch (the
    handout); all three design sections "Looks right".
  - 12:40: R1 hold on an explicit marker (amended by R5); R2 plain http rotates and shows its transport; R3 the boot
    recovers a server-written file; R4 weekly.
  - 13:55: R5 drops the marker. Every rotation holds only on mechanical conditions, and `auto=off` never holds. The
    operator's words at 13:28, on the model auto-advance design: "if I've set up auto-install why pause it? If I don't
    want auto-install I'll just switch it off".
  - 15:23: "spec reads right to me". Also agreed: wave 2's agent token travels by the same claim, and the gitignored
    source token is deleted after the proof.
  - 15:30: the doctor FAIL arms stay off in wave 1 and are switched on before the weekly schedule ships.
- **2026-10-07 15:31 UTC: run 320 opened** (planned). Deviation block issued: 4388, 4389, 4390, 4391, 4392, 4393, 4394,
  4395, 4396, 4397, 4398, 4399, 4400, 4401, 4402, 4403, 4404, 4405, 4406, 4407, 4408, 4409, 4410, 4411, 4412, 4413, 4414,
  4415, 4416, 4417. The block serves both runs of spec wave 1. Numbers are written bare until the plan or a worker
  defines them.
- **2026-10-07 17:24 UTC: the wave-1 plan was written** by a workflow: a contract, six prototyping drafters, two attack
  lenses, and an assembly pass. It defines D-4388 to D-4397. The coordinator assigned **D-4398**, the unreadable
  generation read with no hold word: a technical narrowing that keeps the spec's §6 intent that an unreadable read is never
  read as behind.
- **2026-10-07 about 21:13 UTC, operator rulings on the plan:**
  - The agent.env fleet marker: "Has a CCRC_AGENT_TOKEN line". `agent.env` marks a fleet box only when it has a
    `CCRC_AGENT_TOKEN` key line or cannot be read. Defined as **D-4399**.
  - Execution: "Dispatch to a worker". Run 320 goes to a worker, which runs subagent-driven-development, then the
    held-out review panel. Part B follows as the next run.
  - Numbers 4400 to 4417 stay reserved, written bare.
- **2026-10-08 13:26 UTC: run 320 dispatched** to `ccrc-pwa-bright-mesa`, after one `cap-daily` refusal at 12:39.
  - #324 merged on 2026-10-07 at 21:50 as `3c33d321`, putting the spec, ledger and plan on `main`.
  - **A coordinator ruling: dispatched before #315 and #322 merged.** Their claims, 1078 on
    `server/test/single-definition.test.ts` and 1083 on `README.md`, had lapsed, but both PRs were still in review after 13
    hours. The leaked value stays live until this programme's first rotation, so waiting was the larger cost. The brief has
    the worker merge `main` just before its edits to those two files and again before it pushes. A conflict there is
    textual: keep both sides.
  - Worker reserve: 4400 to 4409. Numbers 4410 to 4417 are the coordinator's.
- **2026-10-08 17:18 UTC: run 320's wave-done (mail 4023), re-measured; the bar committed before its review.**
  - **Evidence:** the wave-done, the worker's four final reports and its SDD directory are copied under
    `.superpowers/btl-w1-evidence/` (gitignored).
  - **The claim, re-measured:**
    - PR #330 is open against `main`, not draft, and mergeable. Its head equals the fingerprint and the pushed tip,
      `f3d151e42`.
    - It has 15 commits, each with the noreply author and committer; two merge `main`. `main` (`a3a8f62bc`) is an
      ancestor of the tip.
    - It changes 44 files: exactly Part A's 43 File Structure paths, plus 10 lines in the plan's Deviations found.
    - The only live claims on project `ccrc-pwa` are the run's own, 1110 and 1111.
    - CI: PR run 37806512332 and full run 37806504081 are green on every Linux leg. `full-suite` is red only because
      it needs the macOS legs, which gate nothing (operator ruling 2026-09-28). The worker names their owners:
      child-workspace reclamation and the native docs reader. None is a file this branch touches.
    - The advance to `awaiting-review` first answered `pr-unmeasurable`, because ccd's `pr-state` timed out on the
      loaded box. A re-read answered `open`, and the retry was accepted.
  - **What the worker reports:**
    - Each task had a Sonnet implementer and an Opus review. Then came a three-lens final review (security, state
      machine, conventions), one fix wave and a scoped re-review. About 60 mutation rows were measured red, then green.
    - The live-safety pin is `token-rotation-e2e.test.ts`, "LIVE SAFETY: part A alone rotates nothing on a fleet
      whose ccrc has no token verb (D-4395)".
    - Counts, as `main` / plan / after: gate routes 88 / 86 / 90; `ROUTES` 91 / 89 / 93; exempt 32 / 32 / 33;
      reasons 6 / 6 / 7; lanes 27 / 27 / 27. The plan was drafted at `282e79e44`, and every delta is the plan's.
    - D-4400 to D-4409 are defined; the worker reserve is spent.
    - **Three spec-level gaps, raised for a ruling and written nowhere in the tree:**
      - I3: a retired value written back to the fleet file alone is never resynced.
      - I4: the pending cap has no exit but a confirming generation read, and Rotate now answers `joined` while
        nothing runs.
      - sec-M2: a failed retired-digest append loses the record for good.
    - None of the three is reachable on the live fleet in part A, because the `verb-missing` hold stops every
      hand-out. They are ruled before part B is dispatched, with numbers from 4410 to 4417.
  - **Bar for the merge.** The held-out review (clause 14) must find NO confirmed finding of these classes:
    1. **Live:** with part A alone on the live fleet (its `ccrc` has no `token` verb, and boot adopts the hand-made
       token), a reachable state in which part A promotes, retires or drops a value, makes a fleet lane answer 401,
       or re-sends without bound: a failure count, a backoff ladder, or a re-probe faster than the plan's.
    2. **Never 401 the fleet:** a value the fleet holds or may hold leaves the accept set before the fleet confirmed a
       later one; or a promotion happens on anything but the fleet's confirmation over the link (an op result, or a
       generation read measured after the hand-out), an HTTP sighting included.
    3. **The leak's retirement:** a retired value adopted at boot, accepted, or handed out again; or the previous
       value retired before the new one was presented, or kept past its hard bound.
    4. **Secrets:** a token value, a claim code or the sha256 of either in a log, argv, the environment, an op
       result, a non-token file, any response but the claim's one 200, or test output; or a token file not 0600
       from birth.
    5. **The claim door:** a budget checked before the live-code compare; a miss that burns a code; a same-tick pair
       answering other than one 200 and one 410; or a response without `Cache-Control: no-store`, Fastify's own 400
       and 413 included.
    6. **The accept set:** an early exit or a short-circuit fold in the compare; the injected comparator called other
       than once per slot; or a literal-string `mailToken` that no longer works.
    7. **Boot:** a hand-made unusable or placeholder `mail.token` that no longer refuses boot; the fleet file written
       on a box not recorded `both`, or whose `agent.env` has a `CCRC_AGENT_TOKEN` line; or a recovery proof that
       prints anything.
    8. **Census and gate:** a door not pinned in both directions; a route count, the seventh reason or a census set
       moving without the others; a box-token lane lost; or the rotate route reachable without a session.
    9. A ring broken by imports, an overloaded null at a seam the plan names, a non-additive wire change, or a second
       definition of an L0 word.
    10. A new pin that cannot red when its guard is mutated.
    11. An edit outside Part A's File Structure and the plan's Deviations found, or on another live claim's path.
    12. A wrong deviation number: anything defined beyond D-4388 to D-4409, or 4410 to 4417 written with the prefix.

    Also, every Linux leg of the full run on the reviewed tip must be green.
  - **The rounds:** one bar-class finding gets one fix round, then a scoped review. Coverage and prose findings are
    fixed in that round if one runs; otherwise they become residue. A fix round's numbers are named in its mail, from
    4410 to 4417.
  - **Review run 349** was dispatched at 17:20:26 to `ccrc-pwa-still-meadow`. It runs the held-out panel plus two
    lenses. The security lens walks the leaked value from adoption to retirement, the public door, the accept-set
    compare and every place a secret could surface. The state-machine lens walks G3's interleavings, proves part A
    rotates nothing on the live fleet, checks the worker's fixes for C1 and I2, and says whether I3, I4 and sec-M2 are
    real and reachable.
- **2026-10-08 17:21 UTC: run 350 opened for row 2 (spec wave 1, part B), planned, before run 320 closes.** Deviation
  block issued: 4551, 4552, 4553, 4554, 4555, 4556, 4557, 4558, 4559, 4560, 4561, 4562, 4563, 4564, 4565, 4566, 4567,
  4568, 4569, 4570. Numbers are written bare until defined. The dispatch waits for #330 to merge and for the rulings on
  I3, I4 and sec-M2.
- **2026-10-08 17:46 UTC: review 349 closed (run 320 at `f3d151e42`); the one fix round sent, by the committed bar.**
  - **The panel:** 5 of 5 lenses returned. They raised 20 findings; 15 survived the refute pass (14 by 3–0, one by 2–1),
    5 were refuted, and none is unexamined. Merged, that is 12 findings plus the raised sec-M2. By lens: correctness
    F1, F2, F3, F4, F10 and sec-M2; spec F3, F5, F9, F10, F11; does-it-reproduce F6, F8, F12; security F1; state
    machine F7.
  - **Nothing live.** No lens found a state reachable on the live fleet with part A alone: the `verb-missing` hold
    comes before any stage, is persisted, and is re-probed hourly or on a fresh ready. The worker's C1 and I2 fixes
    were mutated in a copy, and each went red. Every suite the brief named is green.
  - **Classes met:** F1 class 3 (an unusable retired file lets boot re-adopt a written-back retired value); F2 class
    3 by its letter; F5, F6 and F7 class 10; F11 class 9, as ruled. So the bar gives the one fix round.
  - **The raised items are real and none is reachable live in part A:** I3, I4 and sec-M2. sec-M2 was reproduced by
    a probe, and F1 is its upstream half. They are fixed in this round, because they live in part A's code and part
    B makes them reachable.
  - **Rulings (numbers bare until the worker branch defines them):**
    - Number 4410 (F1, sec-M2): a retired digest is durable before its value leaves the accept set. It is kept in
      `box-token.json` until the append lands, and a failed append is retried, never dropped. With the retired file
      `unusable`, boot never adopts a value it did not write: it mints, owes a forward rotation, warns, and moves the
      file aside. A read failure on that file reads `unreadable` and refuses boot.
    - Number 4411 (F2): a later generation the fleet confirmed is a third exit from Previous, beside spec Figure 5's
      two. The early retirement logs the retirement line and records its digest.
    - Number 4412 (I3): a retired presentation on any box-token lane owes a forward rotation (`retired-presented`).
      None is owed while a rotation is owed or in flight, and presentations owe at most one per `HOLD_REPROBE_MS`.
      The server cannot tell the fleet from the leaked holder, so the bound is the protection.
    - Number 4413 (I4): while both pending values at the cap are past `confirmBy`, a forward rotation may stage into
      a third slot. Its confirmation drops both. Rotate now answers `joined` only while something is in flight, and
      answers the `pending-cap` hold otherwise.
    - Without a number: F3's three backoff routes closed; F4 bounds `pending`; F5, F6 and F7's pins made able to
      red; F8 pinned against the tree's real `ccd/ccrc`; F9 counts Fastify-rejected claim bodies as misses; F10 door
      lines carry the node id; F11 derives from L0, with the scan widened; F12's sentence corrected.
  - The worker reserve for the round is 4414 to 4417. A scoped review of the fix range follows the wave-done.
- **2026-10-08 18:13 UTC: R56 consent given to child-workspace reclamation's wave 7 (run 347) on six paths of claim
  1110** (mail 4030 asked, 4031 answered, 4032 told the worker). Those paths are `agent/src/whitelist.ts`,
  `README.md`, `CLAUDE.md`, `agent/CLAUDE.md`, `server/test/single-definition.test.ts` and
  `server/test/whitelist-subset.test.ts`.
  - Wave 7 only appends in its own regions, and re-points README anchors by content.
  - Whichever PR lands second merges `main` (a merge, never a rebase), keeps both sides, and re-runs the whitelist
    suites, single-definition and the README census.
  - Run 320's fix round is not expected to touch those files except perhaps README or a test pin, and it keeps to its
    own lines.
- **2026-10-08 20:57 UTC: fix round 1's wave-done (mail 4039), re-measured.**
  - **Evidence:** the wave-done and `run-320-fix1-evidence.md` are copied under `.superpowers/btl-w1-evidence/`, and
    the task reports are refreshed.
  - **The claim, re-measured:**
    - PR #330 is open and mergeable. Its head equals the fingerprint and the pushed tip, `fa384df19`.
    - Seven fix commits sit on `f3d151e42`, each with the noreply identity, then a merge of `main` at `226bb881c`. The
      merge brings exactly `main`'s three docs files, and `main` is an ancestor of the tip.
    - The fix commits touch 19 files, all Part A File Structure paths, plus 4 lines in the plan's Deviations found.
      The whole PR is still Part A's 43 paths plus the plan.
    - Live claims: the run's own 1115 and 1116 (re-declared from 1110 and 1111 at the 8 h cap), and wave 7's 1113 and
      1114, which share no path with them.
    - CI: PR run 37835237897 and full run 37835240897 are green on every Linux leg. `full-suite` is red only through
      the macOS legs, the same seven files as before, none this branch's.
  - **Run 320 advanced to `awaiting-review`** at `fa384df19`.
  - **The worker's readings, held for the scoped review to judge against the rulings:**
    - Number 4413: `joined` only while a send runs, a promotion is recorded or a press's tick runs. A press during a
      confirm wait answers `started`. The hold answers before `rate-limited`. Boot keeps up to three unverifiable
      pending files.
    - F4: an over-cap state reads `unusable` (why `over-cap`), and boot refuses with the file byte-identical.
    - Number 4410, tightened:
      - While a set-aside retired file exists, boot keeps the foreign-value posture; removing that file after a review
        re-allows adoption.
      - A failed listing of set-aside files refuses boot.
      - The holder refreshes its retired list once an append lands.
    - F8: the pin runs the real `ccd/ccrc` with a verb that can never exist, so part B's verb cannot red it.
    - F10: the driver logs the node it bound for each generation. The door's interfaces are unchanged.
    - F3: a successful stage resets backoff, and a closed gate spends a Rotate-now press.
  - **Rulings on the worker's four questions:**
    1. A second lost exit hand-out, or three unverifiable pending files at boot, leaves `pending-cap` until a
       generation read names one. That is the ruling's shape: no value is dropped (G3), and the 24 h stall alert is
       the backstop. It is recorded as a known limit, for wave 2's schedule to revisit.
    2. Number 4411's early retirement logs "grace ended" verbatim, which is not true there. A distinct wording that
       says the fleet confirmed a later generation is permitted. It is residue: the first commit of part B's run
       carries it, with `server/src/token/driver.ts` admitted for that one line. The tip stays as it is.
    3. Number 4412's once-per-`HOLD_REPROBE_MS` clock is held in memory, so a restart allows one extra owed rotation.
       Accepted: it is still bounded, and the holder of the leaked value cannot cause a restart.
    4. Rejected claim bodies past the miss budget answer 429, as other misses do. Accepted.
  - **After the scoped review:** a confirmed finding of a bar class stops the merge and goes to the operator. Coverage
    and prose findings become residue for part B's run.
  - **Scoped review run 352** was dispatched at 20:59:27 to `ccrc-pwa-amber-river`, on `f3d151e42..c6064a0fc` plus
    the merge's check. It runs the held-out panel, plus the security and state-machine lenses. It also reports, for
    each of review 349's findings and for I3, I4 and sec-M2, whether it is closed, and judges the worker's readings
    against the rulings.
- **2026-10-08 21:51 UTC: review 352 closed (fix round 1 at `fa384df19`); one finding meets a bar class by its letter,
  so it went to the operator.**
  - **The panel:** six Opus lenses (the held-out three, security, state machine, and closure), with three Sonnet
    refuters per finding; 93 agents, none unverified and none unexamined. 17 confirmed findings dedupe to 13, all
    minor, and 12 were refuted.
  - **Closure:** every ruled pin reds when its fix is reverted (27 of 27 rows). Review 349's F1 to F12, I3, I4 and
    sec-M2 are each closed. Live safety was re-proved: with part A alone, `verb-missing` gives no failure count, no
    401 and no promotion. No new line prints a value, a code or a digest.
  - **Bar classes, each needing at least two faults or a both-local box, and none reachable live in part A:**
    - F1, class 3 by its letter: a failed digest append followed by an unusable `box-token.json` loses the digest,
      and a written-back value is then adopted. Fix direction: an unusable state file takes the foreign posture.
    - F2, class 3 borderline: on a both box, a persistently failing own-write blocks the previous value's
      retirement past its hard bound on disk. The accept set still honours the bound in memory.
    - F3, class 3 by its letter only (2–1): `retireValue` deletes an unreadable previous file with no digest.
    - F4, class 10 on a strict reading: the door's import pin misses an indented or same-line import.
  - **The rest, no class:**
    - F5: number 4413's worker reading is looser than the ruling's "actually in flight".
    - F6: a failed foreign mint loses the owed rotation.
    - F7 to F9: unpinned arms.
    - F10 and F11: door lines missing a node id.
    - F12 and F13: prose.
- **2026-10-09 06:25 UTC: the operator ruled "Merge now, fix in part B".**
  - Part A merges as reviewed.
  - F1 to F13 and number 4411's "grace ended" wording become part B's first task, on part A's files, before part
    B's token verb ships. Part B's review gates them.
  - `main` had moved to `d33a566bb` (#315, #319 and four docs PRs), with six files changed on both sides. So the
    worker first merges `main` and re-runs the shared pins (mail 4084). A test edit beyond the merge stops and comes
    to me, because claim 1124 (run 342) now holds `server.ts`, `gate.ts`, `auth-gate`, `box-token-census` and
    `single-definition`.
  - **06:28: two overnight claim agreements by the worker, read late and adopted.** Both are on the 4032 terms: separate
    regions, and the PR that lands second merges `main` and keeps both sides.
    - 4057: `server/src/coord/routes.ts` and `README.md`, with workspace lifecycle's wave 5.
    - 4078: claim 1124's five files, with the native docs reader's wave 3 (`ccrc-pwa-calm-canyon`, mail 4075). Its
      extra term is that the second PR re-derives every route and census count by measurement.
    - So mail 4085 corrected 4084's step 3: a count numeral re-derived after the merge needs no stop. Any other
      test edit still does.
- **2026-10-09 06:44 UTC: part A merged as `f82cb9fbc` (#330); run 320 closed `done`.**
  - **The merge-only step (mail 4086), re-measured:**
    - The tip `d9adc2c5a` has parents `fa384df19` and `d33a566bb`. Its tree equals `git merge-tree` of those two, so
      the push is a pure merge.
    - The PR's diff against `main` is still Part A's 43 paths plus the plan.
    - On the merged tree, the shared pins grew only by `main`'s new cases. whitelist-subset is 108 and
      single-definition 523. No numeral part A asserts moved: routes 90, `ROUTES` 93, exempt 33, and census 29 green.
    - PR run 37893912731: every Linux leg was green. The macOS legs were still running, and they gate nothing.
  - **The merge:** `gh pr merge 330 --squash --admin --match-head-commit d9adc2c5a`, with no branch deletion. The merged
    tree `4512d88d` equals the tip's tree and `merge-tree`'s.
  - **The close:** `final:true`, because run 350 was opened with no session id. The answer was `released:true` and
    `childReclaim:queued`, and the closed row reads `done` at `d9adc2c5a`. The worker's evidence and SDD directory are
    copied under `.superpowers/btl-w1-evidence/`.
  - **Live effect, expected by the plan and to be measured read-only once both boxes run v0.0.133:**
    - boot adopts the hand-made token and owes the first rotation;
    - the driver holds `verb-missing`;
    - `/api/notify` fails shut, which the fleet's `notify.sh` survives because it presents the token;
    - no fleet lane answers 401.
  - **Numbers:** 4414 to 4417, the fix round's unspent reserve, return to the coordinator, so 4414 to 4417 are free.
- **2026-10-09 06:50 UTC: run 350 (part B) dispatched to `ccrc-pwa-brisk-basin`.**
  - **R0 comes first:** review 352's F1 to F13 and number 4411's wording, on part A's files, which are admitted for R0
    only. The rules are in `partB-r0-residue.md`, beside the review report.
  - **Number 4414 is ruled and assigned now, bare until the worker defines it.** No path retires or drops a value without its
    durable digest, and no failure makes boot adopt a value it did not write. It covers four cases:
    - F1: an unusable `box-token.json` takes D-4410's foreign posture;
    - F3: an unreadable value file is never deleted unrecorded;
    - F2: the hard-bound retirement is never blocked by a failing own-write;
    - F6: a failed foreign mint keeps its owed rotation.
  - The rest of R0 is conformance with no number: F4's statement-level import pin, F5's `joined` only while in
    flight, F7 to F9's pins, F10 and F11's node ids, F12 and F13's prose, and number 4411's line.
  - **Numbers:** 4415 to 4417 and 4561 to 4570 stay the coordinator's, bare. The worker reserve is 4551 to 4560.
  - **Routing:** the same as run 320's, because that shape delivered: one fix round, each task reviewed, and the panel
    clean on everything live. Five reviewers get an extra instruction: R0, B1, B4, B5 and B7.
  - **The live effect, stated in the brief:** the merge arms the first live rotation with no human act. G3 governs
    it, with no fleet 401 at any step. The worker names the pin that proves it.
  - **Claims and hot files:**
    - Claim 1125 (run 347) holds `shared/api.ts`. Consent was asked in mail 4087, and the worker does B7 before B6
      if no answer has come.
    - Open PRs #322, #335, #189, #107 and #325 share README and other hot files. The worker merges `main` before each
      edit to them, keeping both sides.
  - **The arming PR (row 2a)** can follow part B's merge. Its trigger, the GPT-lane lane-1 B4 soak gate, passed on
    2026-10-08 at 11:20 UTC.
- **2026-10-09 06:53 UTC: claim 1125 consent granted** by child-reclamation's coordinator (mail 4088) and forwarded to
  the worker (4091). B6's import line and `UpdatesView` field are disjoint from wave 7's regions. The import moves
  every README `shared/api.ts` anchor by one, so whichever PR lands second re-points them by content and re-runs the
  session-hook citation cases.
- **2026-10-09 07:42 UTC: part A measured live, read-only, on v0.0.133. It behaves as the plan says.**
  - **Server log:** the server restarted at 07:05:29. It logged "box token: adopted the hand-made value … the first
    rotation is owed", then "held: update-in-flight (server)", then at 07:07:29 "held: verb-missing (fleet)".
  - **`box-token.json`** (no secret; 0600) reads `origin: adopted`, `rotationOwed: true`, `owedWhy: adopted` and
    `hold: verb-missing`. It shows 0 failures, 0 pending, no previous, no fleet confirmation and no sync. Both counters
    are 0, so no retired or previous value has been presented.
  - **The token files:** no `box-token-retired.json` exists, and `mail.token` is untouched (Sep 09). On the fleet box,
    neither `box-token-generation` nor `token-sync.json` exists. The source, fleet and server copies are still equal,
    measured by digest comparison only.
  - **No 401:** the box-token lanes still answer 200 (`GET /api/ledger`, mail list). The agent restarted cleanly at
    07:03, and the server logged no notify refusal. `/api/notify`'s answers themselves were not measured.
  - So part A rotates nothing live. The leaked value stays valid until part B's merge arms the first rotation.
- **2026-10-09 12:00 UTC: run 350's wave-done (mail 4115), re-measured; the bar committed before its review.**
  - **Evidence:** the wave-done and the worker's SDD directory are copied under `.superpowers/btl-w2-evidence/`.
  - **The claim, re-measured:**
    - PR #341 is open against `main`, not draft, and mergeable. Its head equals the fingerprint and the pushed tip,
      `569bb148c`.
    - It has 22 commits, each with the noreply identity; three merge `main`. `main` (`1fb98effd`) is an ancestor of
      the tip, and `merge-tree` is clean.
    - It changes 44 files: every Part B File Structure path, R0's admitted part A files and the plan. Two more are
      pins its own changes moved, which the plan's lists missed:
      - `server/test/peers-claims-l0.test.ts`: `shared/api.ts`'s type-only imports, three to four, from the consented
        import;
      - `server/test/session-hook.test.ts`: the citation census, where `deploy.sh` goes from 4 to 3 because B7's
        deletion moved lines.
    - The only live claims on its paths are the run's own. The open PRs that share files are #322, #325, #189, #107
      and older ones; none is in review.
    - CI: PR run 37923766740 is green on every Linux leg, with macOS still running. No full run had been made, so the
      coordinator started `workflow_dispatch` full run 37927184994 at 11:59.
  - **What the worker reports:**
    - R0 and B1 to B7 each passed an Opus per-task review. Then a three-reviewer whole-branch review found no
      critical or important finding, and one fix wave followed.
    - **The live-effect pin** is `token-rotation-real-verb.test.ts`, "release-lane fleet box, remote server: from an
      adopted hand-made token through the first rotation, no fleet lane answers 401". It runs the real agent op,
      verb, claim door and curl, and probes before, during and after each tick, through promotion, grace and
      retirement. At the end the old value answers `401 refused`.
    - **Its stated gaps:** it boots from no state file rather than one part A wrote; its gate rows are literals; and
      its transport is http.
    - **The rollout note:** under auto's fleet-first order, the fleet's new cap opens the gate. So the FIRST live
      rotation may be driven by the server's previous build, v0.0.133, which lacks R0. The happy path is the same.
  - **Rulings:**
    - Number 4551, the worker's own (doctor gains `retire-overdue:<min>` and `retiring-unlanded:<min>`, SKIP in wave 1 and
      FAIL when armed), is **confirmed**. It keeps Review Focus 4: no PASS while a retirement is stuck.
    - **Item 1, accepted as number 4414's stated cost:** an unusable `box-token.json` forces a mint, and a remote fleet is
      refused until a code resync. Part B gives the fleet the verb, so the resync is automatic. A fleet with no verb
      is the double-fault case.
    - **Items 2 to 8 are residue.** Each goes to row 2a's brief, or to wave 2 when its file is under another claim:
      - 2: `cmd_token`'s missing-script word;
      - 3: `/api/notify`'s wrong-token log advice in `server.ts`, under claim 1124;
      - 4: `agent/test/deploy-verify.test.ts`'s `ship_secret` prose;
      - 5: notify.sh posting the placeholder;
      - 6: the README's `node-id-unmeasured` remedy, and the stall clock restarting with the process;
      - 7: deploy.sh never rewriting `ccrc-caps`, and `ccrc-api` placed only by deploy.sh (with CUM wave 16);
      - 8: no doctor word for a set-aside state file, the dangling `agent.env` symlink, and an absent `mail.token`
        with an unusable state.
    - **Departures accepted:**
      - B6 kept to the consent's letter;
      - B7 added a README sentence;
      - the fix wave edited R0-admitted `boot.ts` strings;
      - the two pins above, admitted as re-measurements of B6 and B7's own changes, if the review confirms that each
        edit is only that.
  - **Bar for the merge.** This merge arms the first live rotation with no human act. The held-out review (clause 14)
    must find NO confirmed finding of these classes:
    1. **The first live rotation (G3):** on the live topology, a reachable state in which a fleet lane answers 401,
       during the rollout or after it. That topology is a remote server, a release-lane fleet box, an adopted
       hand-made token, notify.sh, and `ccrc-api`'s reads of the fleet file. It includes the mixed-version path: the
       fleet on this build while the server still runs v0.0.133 drives the rotation, then the server restarts into
       this build at the hand-out, the promotion or grace.
    2. **The leak's retirement:** once the first rotation completes, the leaked value is not refused within the
       plan's bound, or a retired value can come back: adopted, accepted, or handed out again. number 4414's four sequences
       are included.
    3. **Secrets:** a token value, a claim code or a sha256 of either appears in any of these places:
       - the verb's stdout, stderr or argv, the environment, or `token-sync.json`;
       - a doctor line, the console card or `GET /api/updates`;
       - a log, a non-token file, or test output.

       A token file that is not 0600 from birth also meets this class.
    4. **The shell verb:**
       - curl given a value other than on stdin through `-K -`;
       - a token-handling shell file that does not start `set +x`, then `umask 077`;
       - a non-atomic fleet-file write, or a lost comment preamble;
       - the generation file recorded before the value file is in place;
       - a shell spelling the parity scan does not hold to L0.
    5. **Doctor:** a stuck state that prints PASS, number 4551's words included; the arms on (`_BT_ARMS_ON` other than 0);
       or a SKIP that moves doctor's exit code or summary.
    6. **The console:** the card says a false thing in a reachable state; Rotate now is sent twice for one press; or
       the card throws or misrenders on an absent or malformed `boxToken`, which is what an older server sends.
    7. **deploy.sh and notify.sh:** deploy.sh still ships a token, or its rsync excludes changed; notify.sh puts a
       value on argv, or POSTs with no value (the placeholder is residue 5).
    8. **Uninstall:** it removes a value, state or fleet token file, or it leaves the two non-secret files.
    9. **R0:** an item not closed by a pin that reds on revert.
    10. A ring broken by imports, an overloaded null at a seam the plan names, a non-additive wire change, or a second
        definition of an L0 word.
    11. A new pin that cannot red when its guard is mutated.
    12. **Scope:** an edit outside Part B's File Structure, R0's admitted files, the plan's Deviations found and the two
        admitted pins; or outside the consented `shared/api.ts` scope.
    13. **Deviation numbers:** anything defined beyond D-4388 to D-4413 and numbers 4414 and 4551; or 4415 to 4417, or 4552 to 4570,
        written with the prefix.

    Also, every Linux leg of full run 37927184994 must be green.
  - **The rounds:** one bar-class finding gets one fix round, then a scoped review. After that review, a bar-class
    finding stops the merge and goes to the operator. Coverage and prose findings become residue for row 2a.
  - **Review run 362** was dispatched at 12:04:20 to `ccrc-pwa-brisk-delta`. It runs the held-out panel plus three
    lenses:
    - **security:** the verb's shell, file modes, the probe, doctor, the API view, notify.sh, deploy.sh, uninstall and
      number 4414;
    - **the first live rotation:** it simulates the live topology in both rollout orders, fleet-first with the server
      on part A and then restarting mid-rotation, and server-first. It proves no fleet 401, the leaked value refused,
      and the worker's stated gaps closed;
    - **what the operator sees:** every doctor line, and the card for every state, at phone width and desktop.
- **2026-10-09 14:32 UTC: review 362 closed (part B at `569bb148c`); the one fix round sent, by the committed bar.**
  - **The panel:** the held-out three lenses, the three the brief named, and one of the reviewer's own (R0 and
    new-pin mutation), with a second round on the gaps a completeness critic named. 115 agents ran, with none dead
    and none unexamined; 11 findings were confirmed.
  - **The first live rotation, simulated (classes 1 and 2):** none found.
    - Part A (`f82cb9fbc`) and the tip were loaded side by side, with `CCRC_AUTH=on`, each build's own gate rows, a
      TLS front, and a release-lane fleet box moving from v0.0.133's `ccrc` to the tip's.
    - Every case started from the state part A's boot wrote live at 07:42.
    - 18 of 18 cases passed: fleet first with restarts at the hand-out, in promotion (three kill points) and in
      grace; part A running the whole rotation; and server first.
    - No lane answered 401 at any step: `ccrc-api` mail and ledger, notify.sh, the agent link, pool sync and update
      sync.
    - At the end the old value answers `probe: 401 refused`, its digest is in the retired list, and written back it
      is not adopted.
    - The simulation has teeth: two planted mutations each red it.
  - **Not measured by the review:** whether the live fleet box's `ccrc-api` passes the verb's stale-client check. The
    coordinator measured it read-only: it resolves to the release tree's `ccd/ccrc-api` (v0.0.136), with no `-H
    x-ccrc-mail-token` line and with `-K -`, so it passes.
  - **Classes met:**
    - F1, class 6: after a failed boot mint, the card says "no current value", yet shows generation #2 and "fleet
      confirmed".
    - F3, class 6, fault-only: the `behind` sentence says "older".
    - F2, ruled class 11: the spec's named pin for the atomic, fsynced fleet-file write cannot red.
    - F4, class 10: the doctor's generation-id shape and sync words are spelled again with no L0 pin.
    - F5, class 11: the no-ship pin matches only the name `ship_secret`.
  - **Coverage and prose, fixed in the same round:** F6 to F11.
  - **Rulings:**
    - F1 is fixed in `view()`: no current generation and no fleet confirmation while the holder has none.
    - F2's three guards are pinned: temp-then-rename, the file `fsync`, and the directory `fsync`.
    - F3's sentence becomes "not on the current generation".
    - F4 and F5 are pinned in this round.
  - **Residue for row 2a, or wave 2:** the refuted R-a (an in-repo slim live-topology simulation), R-f, R-g, R-i and
    R-j. R-j asks whether D-4410's no-foreign-adoption rule extends to the sibling value files.
- **2026-10-09 16:11 UTC: fix round 1's wave-done (mail 4134), re-measured.**
  - **Evidence:** the wave-done and the worker's SDD directory (`fix1-evidence.md`) are refreshed under
    `.superpowers/btl-w2-evidence/`. So is review 362's own evidence, including its live-rotation simulations.
  - **The claim, re-measured:**
    - PR #341 is open and mergeable, and its head equals the fingerprint, `7424434c6`.
    - `e4c8c8d6f` merges `main` at `7c71244db` (#325). Its tree equals `git merge-tree` of `569bb148c` and
      `7c71244db`, so it carries only `main`.
    - Six fix commits follow, each with the noreply identity. They touch 12 files, all within part B's admitted set.
      The whole PR has no path outside that set and the two admitted pins.
    - CI: full run 37951858448 is green on every Linux leg, and `full-suite` is red only through macOS on files this
      branch does not touch. PR run 37951857311 is green on Linux, with macOS still running.
  - **The worker's measurements:** every finding with a mutation row reds when reverted. F1 is pinned in the driver's
    view and in the card, F2 by four mutations, F3 and F6 by each sentence, F4 by each spelling site and the tuple,
    and F5 by a re-ship in either arm.
  - **Its two rulings, accepted:**
    - The `deploy.sh` comment stripper resets quote state per line. A contrived re-ship inside a multi-line quoted
      remote script would pass; that is residue for row 2a.
    - Noise in the CONTROL row under any verb mutant.
  - **Run 350 advanced to `awaiting-review`** at `7424434c6`.
  - **Scoped review run 365** was dispatched at 16:13:13 to `ccrc-pwa-keen-cove`, on `e4c8c8d6f..7424434c6`. It
    runs the held-out panel, plus three lenses:
    - **security**, including whether F2's and F5's pins red under near-variants;
    - **the first live rotation, re-run:** review 362's 29 simulation cases, re-pointed at the tip;
    - **what the operator sees:** F1, F3 and F6 rendered.

    It also reports whether each of F1 to F11 is closed. After it, a bar-class finding stops the merge and goes to
    the operator.
- **2026-10-09 17:26 UTC: review 365 closed (part B fix round 1 at `7424434c6`); two findings meet class 11, so by
  the committed bar the merge goes to the operator.**
  - **Evidence:** the review-done (mail 4143) and the report are copied under `.superpowers/btl-w2-evidence/`. The
    reviewer re-measured the tip, unchanged, before it sent.
  - **The panel:** the held-out three lenses, the brief's three, four closure lenses and a completeness critic. 68
    agents ran, with none dead and none unexamined. Four findings were confirmed (a fifth merged as a duplicate) and
    14 were refuted.
  - **The first live rotation, re-run (classes 1 and 2):** none found.
    - All 29 of review 362's cases pass at the tip: round 1's 11 and round 2's 18, in both rollout orders and at
      every restart point.
    - No fleet lane answers 401 outside number 4414's write-back window.
    - At the end the old value answers `probe: 401 refused`. Its digest is in the retired list, and written back it
      is not adopted.
    - Both of review 362's planted mutations still red the simulation.
    - F1's `view()` change is a pure read. The driver decides from its state record and never reads the view.
  - **What the operator sees (class 6):** none found. The reviewer made 23 renders, at 390 px and 1280 px in both
    themes. Every sentence is true against `view()`, and nothing scrolls sideways at 390 px.
  - **Security (classes 3, 4 and 7):** no non-comment line changed in the verb, the doctor checks, `policy.ts`,
    `deploy.sh` or `notify.sh`. `driver.ts` adds only the `holds` gating.
  - **Review 362's F1 and F3 to F11 are closed** by pins that red on revert, or by sentences that are now true. F2 is
    closed only in part.
  - **Rulings:**
    - **R1 meets class 11.** F2's "no in-place open of the destination" pin judges only a run that starts with no
      destination file. A mutant that truncates and rewrites an existing fleet token file in place (N1c) keeps the
      pin green. Yet an existing destination is the first live rotation's own path, since it starts from the
      adopted hand-made token. The ruling's own words name this mutation, so the pin cannot red when its guard is
      mutated. The code at the tip is correct.
    - **R2 meets class 11 on one arm.** F1's driver pin runs on a server-role rig, so the `own-write` arm the ruling
      names is unpinned: mutant M6 stays green. The code at the tip is correct.
    - **R3 is coverage and prose, residue for row 2a.** The doctor's fourth-spelling scanner misses `\d`-style and
      spelled-out hex classes, so its docstring and commit subject claim more than it holds. The ruling's three
      sites are held.
    - **R4 is prose, residue for row 2a.** A line citation in `install-worker-skill.test.ts` moved, and that file
      is outside the round's admitted set.
  - **Review run 365 is closed.** Run 350 stays at `awaiting-review` until the operator rules.
  - **Asked of the operator at 17:26:** merge #341 now and carry R1 and R2's pins in row 2a (pinned red-first,
    before the arming lands); or run a second, test-only fix round followed by a scoped review.
- **2026-10-10 20:40 UTC: the operator ruled "merge now, pin in row 2a"; #341 merged; run 350 closed; row 2a is run
  370.**
  - **The ruling** answers the 17:26 question. R1's and R2's pins go to row 2a and are pinned red-first, before
    the arming lands: a runner row whose destination already exists, judged by the same check, which mutant N1c
    must red; and F1's sequence repeated on the both-role rig, which mutant M6 must red. R3 and R4 stay residue
    for row 2a.
  - **Run 370 opened at 20:33 UTC, before run 350 closed,** as wave 3 of 5 (row 2a, the arming PR), planned and
    with no session named.
  - **Re-measured first.** The answer came 27 hours after the question, so everything was measured again before
    the merge:
    - The tip was unchanged at `7424434c6`, and the PR was open and mergeable.
    - `main` had moved to `5c922c866`, by #339 (the docs reader's routes) and #343 (docs). Neither shares a file
      with #341. Both boxes were already converged on v0.0.139.
    - The exact merge result, `git merge-tree` of `5c922c866` and the tip, was built as an unpushed commit and
      tested in a scratch worktree. The cross-file scanners, the typecheck and the token suites all pass on it:
      `single-definition` 530, `box-token-census` 37, `auth-gate` 166, `deviation-refs` 31, `dtbd` 1,
      `topology-clean` 55, `typecheck-tests` 12, `token-rotation-e2e` 96, `token-boot` 71, `update-routes` 41,
      and `tsc --noEmit` clean.
    - No live claim overlapped the PR's 30 files.
  - **The live state before the merge (read-only):** `box-token.json` reads `origin: adopted`, `rotationOwed:
    true`, `hold: verb-missing` on the fleet, and generation 1 current. It has held there since 10-09 19:29. The
    fleet box has no `token-sync.json` yet.
  - **Merged** at 20:39:50 UTC as `928f5938b`, with `--squash --admin --match-head-commit`. Its tree,
    `d5eaef6af`, is byte-identical to the tested merge result.
  - **Run 350 closed** (prPhase merged, final). Its child reclaim is deferred while the programme's hold stands.
  - **Next:**
    - Watch the first live rotation read-only, from the release through auto's fleet-first move, the hand-out,
      promotion, grace and retirement.
    - Then the §10.3 proof.
    - Then the operator deletes `deploy/ccrc-mail.token`.
    - Then row 2a's brief.
- **2026-10-10 21:19 UTC: the first live rotation ran with no human act, and the §10.3 proof passed. The leaked
  value is refused.**
  - **The move (read-only, from the driver's own log and `box-token.json`):**
    - 21:00:36: held `update-in-flight` on the fleet while auto moved the fleet box to v0.0.140. Then held
      `update-in-flight` on the server, which restarted into v0.0.140 at 21:02:39.
    - 21:04:39: the rotation started (generation 2, owed word `adopted`), and generation 2 was handed out to the
      fleet node.
    - 21:04:40: the fleet confirmed it (op-result) and generation 2 was promoted. The fleet's `token-sync.json`
      reads `synced`, transport https, `proof: proved`, and its token file is 0600.
    - 21:10:39: grace ended. The adopted hand-made value, generation 1, was retired and is refused.
    - No 401 at any step. The server's log has no 401 line since 20:55. The fleet box's `ccrc-agent`, pool-sync and
      update-sync journals have none. `ccrc-api` works on the new value.
  - **The §10.3 proof, read-only, no value printed:**
    - Server doctor: `PASS box-token: server: generation #2, rotated 6 min ago, fleet confirmed, retired value
      refused`, with 25 passed and 0 failed.
    - Fleet doctor: `PASS box-token: fleet: token file 0600, generation recorded, last sync proved, transport
      https`. Its 6 WARNs are all outside this programme.
    - `ccrc token probe --file deploy/ccrc-mail.token`, from the checkout that holds the gitignored source token,
      prints `probe: 401 refused`. A control probe of the fleet's current file prints `probe: 400 accepted`: it
      passed the gate, so the 401 is the token's.
    - Not measured: `GET /api/updates`' `boxToken`. It is session-gated and the server's auth is armed, so a
      coordinator has no read of it. In its place, `box-token.json`, the file that view projects, reads `origin:
      rotated`, `rotationOwed: false`, no hold, `retiredRefusedAt` set and 0 failures.
  - **The proof's probe rotated the token once more, by design.** The probe presented generation 1 on `GET
    /api/ledger`, and D-4412 then owed one forward rotation (`retired-presented`). Generation 3 was handed out at
    21:12:39 and confirmed in one second. Generation 2 retired at 21:18:39. No 401 occurred. The bound is one such
    rotation per hour.
  - **For row 2a's brief:** with the arms on, doctor FAILs on `retired-presented`. Its count is "since the server
    started", so it clears only on a restart. The §10.3 probe alone would hold doctor at FAIL until the next server
    restart, and so would any later presentation of the leaked value. Today it reads `SKIP box-token: server:
    retired-presented … reported as SKIP until the FAIL and WARN arms ship`. Row 2a must rule how that FAIL clears
    before it arms.
  - **ccrc-history was told (mail 4173). Its coordinator answered (4174):** its stores learn each value's length and
    digest while the value is live, and never forget one. They learned a new pair at 21:05 and another at 21:13, so
    the leaked value stays redacted. The digest feed from the spec's Later box is recorded in that programme's
    ledger as a Later candidate; it matters only for a store bound after a value retired. I declined to mail a
    digest (class 3's spirit) and offered a yes/no compare instead (4176). It also found a defect of its own that
    my mail exposed: history learned two token-file comment words as secrets. Its fix rides its B2.
  - **Next:**
    - The operator deletes `deploy/ccrc-mail.token`. It holds only a retired value now, and nothing ships it.
    - Row 2a's brief (run 370).
- **2026-10-10 22:15 UTC: row 2a planned and split into two parts.**
  - **The plan** is `docs/superpowers/plans/2026-10-10-box-token-lifecycle-w1-arming.md`, from `main` at `995a05750`.
    - A workflow wrote it: three Sonnet scouts, one Opus drafter, two Opus attack lenses (pins and safety) and one
      Opus reviser.
    - The attack found 26 breaks: 3 critical, 10 important and 13 minor. 23 were applied, 1 is a risk note and 1
      was rejected with its reason.
  - **What the attack found:**
    - **The `retired-presented` FAIL, armed, clears only on a restart.** D-4412 as merged also forgets a
      presentation that lands inside its re-probe hour, so "clear when the next rotation completes" alone would
      wedge doctor at FAIL. This is Decision 1. Option A (recommended): a lifetime stamp, plus an owe while the
      stamp is unanswered, under the same one-an-hour bound. B: demote it to WARN. C: keep it restart-only.
    - **Armed, a fresh box fails doctor.** `token-absent` and `fleet-token-absent` are FAIL, and `ccrc install`'s
      exit code is doctor's. So every fresh install would exit non-zero until its first rotation. This is
      Decision 2, put to the operator after the flip's Step 0 has measured which fixtures red. (a) is
      recommended: WARN on a box that was never handed a value, FAIL on a box that once held one.
    - **The GPT-lane programme's Plan 4 soak** (from 10-09 13:50, to about 10-21). Its sampler STOPs on any doctor
      FAIL, and on a WARN class its 10-06 baseline lacks. The flip waits for that coordinator's answer.
    - **Claim 1141** (ccrc-history B2, run 354) holds `ccd/ccrc`, `ccd/ccrc-doctor-checks`, README, CLAUDE.md and
      several install suites. Its hard expiry is 10-11 04:34 UTC.
  - **The split.** The flip needs every one of those answers, and the pins need none.
    - Part 1 is row 2a, run 370: Tasks 1, 2, 5 to 10, and 11 if 1141 is gone. All its files are free and the arms
      stay off. It defines no number.
    - Part 2 is row 2b, a later run: Tasks 3, 4, 12, and 11 if still owed. It defines 4552, and 4553 if ruled.
  - **Rulings, mine:**
    - R-a (a slim in-repo copy of review 362's live-topology simulation) is not owed. The live first rotation
      passed, the existing real-verb pin stays, and a copy would only be a regression guard.
    - Residue 8(a) and R-i are ruled before part 2's dispatch.
    - Residue 6(b), 7, 8(b), 8(c), R-j, V3 and V15 stay where the plan's "Not in this PR" puts them.
  - **Next:** the plan and this ledger reach `main` in one docs PR, then run 370's brief is dispatched. I will ask
    the GPT-lane coordinator about Plan 4 now, and the operator Decisions 1 and 2 before part 2.
- **2026-10-10 22:20 UTC: the plan reached `main` (#347), and run 370 was dispatched.**
  - **#347 merged** at 22:19:24 UTC as `562ef658c`, with `--squash --admin --match-head-commit`. Its tree,
    `ab9d918a8`, is byte-identical to `git merge-tree` of `main` (`995a05750`) and the reviewed head
    `73ea09c46`. Every Linux leg was green.
  - **Run 370 was dispatched at 22:20:02 UTC** to `ccrc-pwa-amber-harbor` (workspace `amber-harbor`). It carries
    9 items: Tasks 1, 2, 5 to 10, and Task 11 only if claim 1141 is gone when the worker reaches it. The route is
    Opus·high, Sonnet implementers, workflow off, compact 40. The brief is in the scratchpad as
    `brief-w2a.md`.
    - Claims at dispatch: no live claim on part 1's files. Claim 1141 (run 354) still holds Task 11's
      `ccd/ccrc`, `agent/test/deploy-verify.test.ts` and `README.md`.
  - **The GPT-lane answer (mail 4186 from `ccrc-pwa-clear-mesa`):**
    - It recommends option 2: the operator accepts `box-token`'s WARNs by name on the Plan 4 sampler's doctor
      baseline. The precedent is ruling WARN-ACCEPTED-B4 of 2026-10-07 (D-4673).
    - The sampler matches the check name only, so the acceptance covers every WARN state of `box-token`.
    - A FAIL still STOPs a sample, which holds Plan 4's go but rolls nothing back.
    - The window closes about 2026-10-21 10:31 UTC; the first clean clock reading is 10-22 09:17 UTC.
    - It put the ruling to the operator and will mail it. Until then the answer is pending, and row 2b waits on it.
- **2026-10-10 23:59 UTC: run 370's wave-done (mail 4193), re-measured; the bar committed before its review.**
  - **Evidence:** the wave-done, the worker's report and its SDD directory are copied under
    `.superpowers/btl-w2a-evidence/`.
  - **The claim, re-measured:**
    - PR #348 is open against `main`, not draft, and mergeable. Its head equals the fingerprint and the pushed tip,
      `b747f3681`.
    - It has 9 commits, each with the noreply identity: one per task, plus a fix-round commit for Task 5. `main`
      (`562ef658c`) is an ancestor, and `merge-tree` is clean.
    - It changes 12 files, every one in part 1's admitted set. Three shipped lines change:
      - `ccd/ccrc-token-sync` gains the temp-beside-the-destination guard (2 lines);
      - `deploy/notify.sh` gains the placeholder guard (2 lines);
      - `server/src/server.ts` changes one line of log advice.

      The rest is tests.
    - The only live claim on its paths is the run's own (1144).
    - CI: PR run 38095641336 and full run 38095643688 are green on every Linux leg. macOS is advisory.
  - **What the worker reports:**
    - Every task was red-first, and each named mutant reds its new pin (counts in the report). R1 reds under N1c on
      both the violations and the inode. R2 reds under M6, alone. The 15 R-f mutant spellings each red.
    - **Limits named:**
      - R-f's `f.read(cap + 1)` read is memory only.
      - R3's subset mutant is pinned by a near-miss control instead.
      - R-g's mounted case reaches one site.
      - The FIFO row can hang under its mutant on a loaded box.
    - **Its finding for part 2:** notify.sh now sends nothing for a placeholder fleet token, while doctor's fleet
      reader reads the placeholder as ok. So a placeholder fleet file gives no signal anywhere. A fleet-side
      `placeholder` word belongs in part 2, in `ccd/ccrc-doctor-checks`.
  - **Rulings:**
    - Task 11 moves to part 2, because claim 1141 was live.
    - The worker's three rulings are accepted: the Sonnet trailer on Task 1, R3's near-miss control, and R3's
      folded expansions.
    - The placeholder finding is part 2 residue.
  - **Bar for the merge.** The merge ships the verb's guard to every rotation, with the arms still off. The held-out
    review (clause 14) must find NO confirmed finding of these classes:
    1. **Live rotation:** a reachable live state in which the verb refuses a write it should make, or a fleet lane
       answers 401. That covers the new guard under symlinked or relative paths, a `$SECRETS` that differs from
       the token file's directory, and every rotation in review 362's simulation re-run at the tip.
    2. **Secrets:** a token value, a claim code or a sha256 of either in any output, log, test output, or file
       other than a token file.
    3. **notify.sh:** a POST with the placeholder or with no value, a value on argv, or a real-value POST that no
       longer goes out.
    4. **A new pin that cannot red when its guard is mutated,** R1 under N1c and R2 under M6 above all. Each
       claimed mutant row must reproduce.
    5. **Arms:** `_BT_ARMS_ON` other than 0, or any doctor class or exit-code change.
    6. A ring broken by imports, a second definition of an L0 word, or an overloaded null at a seam.
    7. **Scope:** an edit outside part 1's File Structure rows and the plan file.
    8. **Deviation numbers:** any number defined, or 4552 to 4570 written with the prefix.

    Also, every Linux leg of both runs must stay green.
  - **The rounds:** one bar-class finding gets one fix round, then a scoped review. After that review, a bar-class
    finding stops the merge and goes to the operator. Coverage and prose findings become part 2 residue.
  - **Review run 375** was dispatched on 2026-10-11 at 00:02 UTC to `ccrc-pwa-warm-summit`. Run 370 was advanced
    to `working` and then to `awaiting-review` at `b747f3681`. The review runs the held-out panel plus three lenses:
    - **the live rotation:** review 362's 29 simulation cases re-run at the tip, and the new guard attacked through
      symlinked, relative, slashed and symlink-target paths;
    - **pin teeth:** the worker's mutant rows reproduced, and near variants of N1c and M6;
    - **secrets and notify.**
- **2026-10-11 00:43 UTC: review 375 closed (row 2a at `b747f3681`), clean by the bar; #348 merged; row 2b is run
  377.**
  - **The panel:** the held-out three lenses and the brief's three. 36 agents ran, with none dead, none unexamined
    and no lens unverified. 10 findings were raised: 9 survived the refute pass, and 1 was refuted 3/3.
  - **The live rotation (class 1):** none found. Review 362's simulation passes at the tip: round 1's 11 cases,
    round 2's 18, and a server-first set of 16 the reviewer built. There is no stray 401 outside number 4414's
    window, and the old value is never adopted. The new guard is lexical, but it is unreachable live: both paths
    share one literal `$SECRETS` prefix, and 15 HOME shapes match `main` row for row.
  - **Pin teeth (class 4):** none found. Every claimed mutant row reproduces: R1 under N1c, R2 under M6, Tasks 5,
    6, 8, 9 and 10, and all 15 of Task 7's spellings. Two near variants each of N1c and M6 red too.
  - **Rulings:**
    - **F1 meets no class for this merge; it is part 2 residue.** A placeholder preceded by a UTF-8 BOM or a no-break
      space is still POSTed by notify.sh, because `tr -d '[:space:]'` is byte-wise while the server's
      `extractToken` trims those characters. The line is identical at `main`, where every placeholder spelling was
      POSTed, so the merge narrows the gap and opens none. Reaching it takes a hand-edited fleet file, since the
      verb's writer emits ASCII only. The POST carries the public placeholder and draws a 401. Part 2 makes
      notify.sh's trim match `extractToken`'s, with a pin.
    - **F2 to F7 meet no class.** All go to part 2's residue:
      - F2: the new advice's `ccrc token probe --file …` needs `--url` on a both-role box, which has no
        `agent.env`;
      - F3: the guard is lexical; whether to compare real paths is for part 2;
      - F4: the advice pin holds only its probe half;
      - F5: R3's docstring says "any spelling", but the scanner counts quantified classes only;
      - F6: R4's cited describe title wraps, so it does not grep verbatim;
      - F7: R2's plant is redundant, and its comment's reason is wrong.
  - **Every Linux leg of both runs is green.** The full run's `full-suite` is red only through macOS, on files
    outside this diff.
  - **Run 377 opened at 00:42 UTC, before run 370 closed,** as wave 4 of 6 (row 2b), planned and with no session.
    The machinery's wave count rises to 6 because row 2b was inserted.
  - **Merged** at 00:43:17 UTC as `c6e8c5d8d`, with `--squash --admin --match-head-commit`. The tree, `3b9d46412`,
    is byte-identical to the reviewed tip's. **Run 370 closed** (prPhase merged, final). Its child reclaim is
    deferred by the programme's hold.
  - **The live effect:** the release carries the verb's guard to both boxes. The next rotation is the first to run
    through it. The hourly checks confirm that the token holds steady, and no hand rotation is made to test it.
  - **Part 2's residue, now complete:**
    - from the plan: Task 11 (residue 2, 4 and 6(a)) and its rulings;
    - the worker's finding: a placeholder fleet token file gives no signal anywhere, so a fleet-side `placeholder`
      word belongs in doctor;
    - review 375's F1 to F7.
  - **Part 2 still waits on:**
    - the operator's Decisions 1 and 2;
    - the operator's ruling on the GPT-lane Plan 4 baseline;
    - rulings on residue 8(a) and R-i;
    - claim 1141.
- **2026-10-11 01:30 UTC: row 2b's Step 0 measured (Task 12 Step 0, read-only, in throwaway worktrees at
  `c6e8c5d8d`); Decisions 1 and 2 go to the operator.**
  - **How it was measured:** `_BT_ARMS_ON=1` was set in a copy and the plan's nine files were run one per call. Every
    red was re-run unflipped. The checks file was restored byte-identical each time.
  - **196 arming reds:**
    - **76 in `doctor-box-token`,** by construction. The harness flips a copy and expects the shipped file at 0.
      Task 12 Step 1's `disarmedCopy` rewrite absorbs all of them under any option.
    - **96 in `ccrc-install` and 24 in `ccrc-update`.** Each is an exit code: install exits 1 and update exits 3,
      because doctor prints `FAIL box-token` on a fixture HOME that was never handed a value.
    - **Green under the flip:** `ccrc-account`, `ccrc-uninstall`, `install-census`, `ccrc-doctor-graphify` and
      `token-rotation-real-verb`.
    - **Unmeasured:** `ccrc-doctor`, which timed out at 590 s in both states, and the role split of `ccrc-install`'s
      96.
  - **A gap in the plan.** The fake `python3` in both fixture files refuses `python3 -I -c`, so the box-token check's
    two readers return nothing there. On every fixture, the server arm reads `state-unreadable` (FAIL) and the
    fleet arm `sync-unreadable` (WARN), not the absent words a real box gives. So no option clears the fixture reds
    by itself. Task 12 must also let those two programs through the fakes. And Step 4's "box-token reads PASS once
    `liveBox()` has the fleet files" holds only after that.
  - **On a real fresh box, armed:**
    - server: `token-absent` (FAIL) and `state-absent` (WARN);
    - fleet: `fleet-token-absent` (FAIL), `no-generation` and `never-synced` (WARN).

    So under (b) every fresh install exits 1 until its first rotation, and keeps `~/ccrc.migrating`. Under (a), a
    fresh box reads WARN everywhere, and doctor's exit stays 0.
  - **Plan corrections for row 2b's brief:**
    - the fixture-`python3` change in `ccrc-install.test.ts` and `ccrc-update.test.ts`;
    - (a)'s history test decided after the state read, not at the `token-absent` finding;
    - `ccrc-doctor` measured by CI.
  - **Decisions 1 and 2 were put to the operator** at 01:30 UTC.
- **2026-10-11 13:18 UTC: the operator ruled Decisions 1 and 2. Row 2b is ruled through, and its gates are
  re-measured.**
  - **The operator's rulings,** answered at about 13:15 UTC, about 12 hours after the question:
    - **Decision 1: A.** An armed `retired-presented` FAIL stands only while a retired presentation is unanswered,
      meaning it is newer than the last completed rotation. The driver keeps a lifetime stamp. D-4412 owes a rotation
      while the stamp is unanswered, under the same one-an-hour bound. This is number 4552, as the plan wrote it.
    - **Decision 2: (a).** `token-absent` and `fleet-token-absent` take their armed class from history. They are WARN
      on a box never handed a value, or on a server with no state file, and FAIL otherwise. This is number 4553.
  - **My rulings:**
    - **Residue 8(a) is not owed.** A set-aside `box-token.json.unusable-*` is already reported when it happens: boot
      logs it, and the forward rotation it owes shows as `rotation-owed:<why>` until that rotation completes. The
      file is kept as evidence for a human. A doctor WARN that only a human's removal clears would be a hand step.
      Retention and pruning go to row 3.
    - **R-i is not owed.** The fleet PASS line keeps "last sync proved" with no age, because the age of a proved sync
      is no health signal once rotations are weekly. The console card shows the time.
    - **The placeholder fleet file (row 2a's worker's finding):** doctor's fleet reader reads the shipped
      placeholder as the existing FAIL word `fleet-token-unusable`, with the literal held to `PLACEHOLDER_TOKEN`.
      No new word is needed.
    - **Review 375's F1 to F7 ride row 2b:**
      - F1: notify.sh's trim matches `extractToken`'s, U+FEFF and U+00A0 included, with a pin.
      - F2: the advice names `--url` for a box with no `agent.env`.
      - F3: the guard stays lexical, and its comment says why that suffices (one literal `$SECRETS` prefix).
      - F4: the advice pin holds both halves.
      - F5 to F7: prose.
    - **The GPT-lane Plan 4 gate moves from dispatch to the merge.** Building the flip touches no live box. Only its
      release would, so the merge waits for the operator's ruling on the sampler's baseline. `ccrc-pwa-clear-mesa`
      recommends option 2 (mail 4186) and brings it to the operator.
  - **Gates re-measured at 13:15 to 13:18:**
    - Claim 1141 has ended. Its run 354 changes only `ccd/history/*`, `ccd/compact-card.*`, `ci.yml` and the history
      tests, measured read-only in its workspace. So no row 2b file is under it.
    - Claim 1153 (run 358, workspace lifecycle's wave 6, `ccrc-pwa-quiet-river`) holds `README.md`. Row 2b's two
      README edits, the `box-token` doctor row and residue 6(a)'s sentence, are disjoint from wave 6's paragraphs.
      Consent was asked.
    - No open PR that touches row 2b's files has moved since September.
    - The live server reads `PASS … generation #3`, with `retiredPresented` 0. So the legacy arm owes nothing at the
      arming release.
  - **Step 0's plan corrections go into row 2b's brief:**
    - the fixture `python3` in `ccrc-install.test.ts` and `ccrc-update.test.ts` lets the two box-token programs
      through;
    - (a)'s history is decided after the state read;
    - `ccrc-doctor` and `ccrc-install` are run split by `-t`, with CI the arbiter.
- **2026-10-11 13:20 UTC: run 377 (row 2b) dispatched** to `ccrc-pwa-clear-harbor` at 13:20:56.
  - **The brief:** `brief-w2b.md` in the scratchpad. Its detail file is `.superpowers/btl-w2b-evidence/brief-w2b-detail.md`
    (Step 0's corrections, Task R's items and the per-task reviewers' extra instructions). The detail moved out
    because the composed brief would pass the mail's 8192-byte body cap.
  - **Six items:** the rulings into the plan, Task 3 (4552), Task 4, Task 11, Task R, and Task 12 (4553).
  - **Claims at dispatch:** only claim 1153 (run 358) touches the wave's files, on `README.md`, and that waits on
    consent (mail 4226 to `ccrc-pwa-quiet-river`).
  - **The merge waits on the operator's ruling on the GPT-lane Plan 4 sampler baseline.**
- **2026-10-11 13:23 UTC: both of row 2b's outside gates are cleared, and forwarded to the worker (mail 4229).**
  - **README consent** from `ccrc-pwa-quiet-river` (mail 4227), under claim 1153. It covers exactly the `box-token`
    doctor row and the node-id sentence. Wave 6's README hunks (about :3549, :3585 and :3789) are disjoint. The
    claim-1125 rule applies: the second lander merges `main`, keeps both sides, re-points citations by content, and
    re-runs the session-hook citation cases and `pools-prose` (README's length numeral).
  - **The operator's Plan 4 ruling** reached me through `ccrc-pwa-clear-mesa` (mail 4225): option 2,
    WARN-ACCEPTED-BOXTOKEN, under D-4673.
    - `box-token` WARNs are accepted by name on both lanes' soak-sampler baseline. A dry check counts zero new WARNs.
    - A `box-token` FAIL still STOPs a sample, which holds Plan 4's go but rolls nothing back.
    - The window closes about 10-21 10:31 UTC.
    - So row 2b's merge no longer waits on Plan 4. A PASS box must still stay PASS.
- **2026-10-11 18:06 UTC: run 377's wave-done (mail 4244), re-measured; the bar committed before its review.**
  - **Evidence:** the wave-done and the worker's SDD directory (`wave-done-377.md`, `step0-remeasure.md`,
    `final-review.md`) are copied under `.superpowers/btl-w2b-evidence/`.
  - **The claim, re-measured:**
    - PR #353 is open and mergeable. Its head equals the fingerprint, `f167754b1`, and the flip is the last commit.
    - It has 15 commits, each with the noreply identity, on base `d0c2b7803`.
    - `main` is now `d9647b76b` (#352, docs). It shares no file with the PR, and `merge-tree` is clean.
    - It changes 24 files, every one in the admitted set.
    - Claims: run 377's own (1155), and run 358's README claim (1161, renewed from 1153), under the consent of
      mail 4227.
    - CI: PR run 38159729051 is green. Full run 38159732468 is green on every Linux leg (643 server files, 30976
      tests), and red only through macOS 1/4 and 4/4.
  - **What the worker reports:**
    - Step 0's 196 reds re-measured on the tip: `doctor-box-token` 152 passed, `ccrc-update` 503 passed,
      `ccrc-install` 303 passed and 1 failed. The 1 is "not a git checkout", which reds only when `TMPDIR` sits
      inside a checkout, and was red with the arms off too.
    - Numbers 4552 and 4553 are defined, bare.
    - Both consented README edits were made.
    - Limits: Task 4's presence-collapse mutant is equivalent, yet listed as a pin. Lowering `token-absent` on an
      unreadable state cannot red. A fresh server whose first mint failed reads WARN. The server-arm placeholder
      remedy names the console card. The first-sync interplay with `~/.cc-secrets` needs an owner.
  - **The live read the worker asked for (Review Focus 3):** the server's `box-token.json` counters read
    `retiredPresented: 0` with no `retiredPresentedAt` key, and generation 3 with no hold. So the legacy arm owes
    nothing at the arming release. Re-measured again before the merge.
  - **Rulings:**
    - **The own-write narrowing (Task 12 M1) is accepted, provisionally.** On a both-role box, a leftover
      `token-sync.json` with no generation file WARNs, not FAILs. A both box's fleet history is its own-write
      record, not a sync report, so this stays within (a). The review judges it.
    - **D-139 goes to the operator.** D-139 ("a fresh install ends green") is the operator's standing ruling. Under
      Decision 2 (a), a fresh install ends with one `box-token` WARN until its first hand-out. Three times already,
      D-139 has moved a WARN that a fresh box cannot help to PASS or to silence: auth, the census, and unsigned
      (the last a coordinator ruling over a plan's text, 2026-09-23). But the operator's (a) explicitly said WARN,
      and only the operator reshapes a ruling. So the operator chooses between the two. A PASS-or-SKIP verdict for
      the never-handed state would be a fix-round item. Keeping (a) as built needs no change.
  - **Bar for the merge.** This merge arms doctor's `box-token` FAIL and WARN on both live boxes. It changes the live
    driver's owe rule, and makes a `box-token` FAIL stop a GPT-lane Plan 4 sample. The held-out review must find NO
    confirmed finding of these classes:
    1. **The live driver:** the new owe rule rotates more than once an hour for `retired-presented`, wedges (a stamp
       that can never be answered), causes a fleet 401, or owes anything from today's live state (count 0, no key).
    2. **The live boxes after the release:** on a box in today's state (server `PASS` on generation 3; fleet `PASS`,
       sync proved), the armed doctor prints anything but `PASS`, or an `update`, `rollout` or `install` exit code
       changes.
    3. **Fresh boxes:**
       - a never-handed box FAILs;
       - a box that once held a value and lost it reads less than FAIL, other than the accepted own-write narrowing;
       - an unreadable state reads as absent.
    4. **The kill switch:** a disarmed copy prints PASS; the constant is not a single line; or the SKIP tail
       misreports.
    5. **Secrets:** a value, a claim code or a sha256 of either in any output, log, test output, or file other than
       a token file.
    6. **notify.sh:** it POSTs the placeholder, in any spelling `extractToken` refuses; a real-value POST is lost; or
       a value reaches argv.
    7. **A new pin that cannot red when its guard is mutated,** the listed equivalent mutant included.
    8. A ring broken by imports, a second definition of an L0 word, or an overloaded null at a seam, the
       presence-before-null reads above all.
    9. **Scope:** an edit outside the admitted set, or a README edit outside the two consented places.
    10. **Deviation numbers:** anything defined beyond 4552 and 4553, or 4554 to 4570 written with the prefix.

    Also, every Linux leg of both runs must stay green.
  - **The rounds:** one bar-class finding gets one fix round, then a scoped review. After that review, a bar-class
    finding stops the merge and goes to the operator. Coverage and prose findings become residue for row 3.
  - **Review run 383** was dispatched at 18:08:30 UTC to `ccrc-pwa-amber-hollow`, after run 377 was advanced to
    `awaiting-review` at `f167754b1`. It runs the held-out panel plus three lenses:
    - **the live boxes after the release:** today's live shape in fixtures stays `PASS` armed, its first tick owes
      nothing, and review 362's 29 cases re-run at the tip;
    - **the driver's new owe rule:** storm, wedge, restart, legacy and clock;
    - **doctor's classes and the kill switch,** plus secrets and notify.
- **2026-10-12 10:03 UTC: review 383 closed (row 2b at `f167754b1`); the one fix round sent, by the committed bar; the
  operator ruled D-139 over (a)'s WARN.**
  - **The panel:** the held-out three lenses, the brief's three, and a closures lens. 89 agents ran, with none dead
    and none unexamined. 12 findings were raised and 3 refuted. Every briefed suite passed: `ccrc-install` 299
    and `ccrc-doctor` 891, each over all its describe blocks, run with `-t`.
  - **The live boxes after the release (classes 1 and 2): none found.**
    - In today's live shape, both armed arms print `PASS`.
    - The tip's server, booted from that state, owes nothing: its first tick writes only `retiredPresentedAt:
      null`.
    - Review 362's 29 cases pass at the tip.
    - No update, rollout or install exit code changes.
  - **Classes met:**
    - **F1, class 3:** on a both/local box with a valid state that records the hand-out, the fleet and generation
      files gone read WARN, not FAIL. The own-write narrowing hides a lost value.
    - **F2, class 1:** a `retiredPresentedAt` ahead of the clock, after a clock step back and a restart, is never
      answered. That means hourly rotations and a doctor FAIL until the wall clock passes it.
    - **F3, class 7:** the equivalent presence-collapse mutant is still listed as a pin.
    - **F5, class 3:** an unsearchable `~/.cc-secrets` reads as an absent token, and is lowered to WARN.
    - **F12, class 3:** a first sync that was refused writes a report, so a never-handed box FAILs.
  - **The operator's ruling,** answered at about 10:00 UTC, about 16 hours after the 18:10 question: **D-139 wins.**
    A fresh install ends green. The never-handed state prints `PASS` with its sentence, following the auth and
    unsigned precedents, and a box that lost a value stays FAIL. This replaces (a)'s WARN for the never-handed
    state, and 4553 is amended to say so.
  - **Rulings** (`rulings-run377-fix1.md`):
    - F1: the server's record outranks the generation file alone.
    - F2: a stamp ahead of the clock is clamped to `now` in `noteCounters`, and 4552 is amended.
    - F3: the row is delisted or reworded, and the limit named.
    - F5: absent is told from unmeasured, and an unsearchable parent is FAIL.
    - F12: only a generation file or a `synced` report is history. A refused sync still shows its own `sync:<word>`.
    - F4 is not class 7 (a coverage gap), but is fixed with a generated row per trim-set code point, for both copies.
    - F6 (pre-existing) is fixed: the has-a-value pass strips like the placeholder pass.
    - F7 is accepted as a cost, at one an hour.
    - F8, F9 and F11 are prose fixes.
    - F10 disappears under D-139.
    - The restart pair is the ruled design.
    - The worker's reserve for anything else is 4554 to 4558.
  - **A safety incident, reported by the reviewer itself.**
    - One review subagent, reproducing F2, passed `--file ~/.cc-secrets/ccrc-mail.token` unquoted. The shell
      expanded `~` to the live HOME, so the token-sync verb's probe read the LIVE fleet token file.
    - It sent the value to `--url http://127.0.0.1:9`, where nothing listens, and the result was `probe: 000
      unmeasured`.
    - The value was not printed, hashed or stored, and the live server was not contacted.
    - **Ruling:** by the letter it is a read of the live file, a breach of the brief's "never read `~/.cc-secrets/`".
      Nothing was exposed: the value went to curl on stdin, and curl reached no listener. So no rotation is owed for
      it, and the operator rules out a hand rotation anyway.
    - **Prevention:** from this review on, every review brief tells lenses to run each verb with `HOME` exported to
      a fixture HOME and with every path quoted. The operator is told.
  - **Run 377 was advanced back to `working`** at `f167754b1`. A scoped review of the fix range follows. After it, a
    bar-class finding stops the merge and goes to the operator.
- **2026-10-12 12:55 UTC: run 377's fix-round wave-done (mail 4315), re-measured; scoped review run 391 opened.**
  - **Evidence:** the wave-done and the worker's four round reports (`wave-done-377-fr1.md`, its part S and part D
    reviews, and the re-review) are copied under `.superpowers/btl-w2b-evidence/fr1/`.
  - **The claim, re-measured:**
    - PR #353 is open and mergeable. Its head equals the fingerprint and the pushed tip, `250f7f318`.
    - There are 14 fix commits on top of the flip (`f167754b1`), and `f167754b1` is still an ancestor, so nothing
      was rewritten. The flip is followed only by fix commits.
    - The round changes 11 files, every one already in the PR, which still changes 24 files.
    - `main` is `28e8dc1b2` (#354), and `merge-tree` is clean, so no merge was owed.
    - Claims: run 377's own claim 1155 lapsed at its cap, and the round ran under 1173. README is under run 358's
      claim 1172, renewed from 1161. The round changes only the `box-token` doctor row, the place mail 4227
      consented to.
    - CI: PR run 38249638198 and full run 38249631142 (643 server files, 31081 tests, 0 failed) are green on every
      Linux leg. Their macOS legs were still running, and gate nothing.
  - **What the worker reports:**
    - Each finding was measured red, then green, with mutant rows for D-139, F1, F2, F4, F5 and F6.
    - A fresh install ends 0 warned, 0 failed. The live-shape golden moved 0 lines.
    - 4552 and 4553 are amended; nothing else is defined, and the 4554 to 4558 reserve is unused.
    - Ten named limits, in the wave-done artifact.
  - **Two departures from my words, accepted provisionally; the review verifies each:**
    - **F12's history is wider than `synced`.** The worker also counts `proof-failed`, `proof-unmeasured` and any
      report that carries a generation. In each of those cases `ccrc-token-sync` has written the value, and the
      ruling's intent is "a value was written to this box". Accepted, if the review confirms the write case by case.
    - **The clamp's unanswered branch is `max(now, lastRotationAt+1)`, not plain `now`.** Plain `now` would read as
      answered whenever `lastRotationAt` is ahead of the clock, which the ruling forbids ("unanswered until a
      rotation completes after that"). This adapts the mechanics to keep the intent. The review attacks it with
      `lastRotationAt` ahead of the clock.
  - **The worker's limits, read against the bar:**
    - **Limits 4 and 5 read partly as class 3 by their words.** Two of the three cases are a box that held a value
      and reads never-handed (`PASS`):
      - synced, then a refusal that wrote nothing, then both fleet files lost (`token-sync.json` keeps only its
        last run);
      - a server left with only `box-token-retired.json`.

      The third, a server after a failed first mint, never held a value. It reads as no class by the words, but its
      `PASS` sentence is false. Limit 4 comes from my F12 ruling's own word and the report keeping only its last run.
      The review classifies all three. A confirmed class-3 finding after this review goes to the operator, by the
      bar.
    - **Limit 3 is pre-existing:** a presentation while the clock is behind `lastRotationAt` reads as answered at
      once. It owes less, not more, so it reads as no class by the words. The review judges it with limit 2, the
      two-rotation bound after a clock step back.
    - d1b's in-memory bound has no test row, and its code is untouched. The review re-runs review 383's d1b case.
  - **Run 377 was advanced to `awaiting-review`** at `250f7f318` at 12:52 UTC. **Review run 391** opened at 12:52
    UTC, for dispatch after this entry. Its brief is the held-out panel, plus three lenses:
    - the live driver and the live boxes, with the clamp attacked;
    - doctor's fresh-box classes and the switch, with F12's write cases and limits 4 and 5;
    - secrets, notify, scope and numbers.

    Every brief from this review on carries the fixture-`HOME` rule: each verb runs with `HOME` exported to a fixture
    in the same command, every path is quoted, and no `~` appears in an argument.
  - **Before the merge:** re-measure the live server's `box-token.json` counters, which must still read
    `retiredPresented: 0` with no `retiredPresentedAt` key. Open row 3's run before closing 377.
- **2026-10-12 18:24 UTC: review 391 closed (row 2b at `250f7f318`). It is clean on nine classes, and two class-3
  cases go to the operator.**
  - **The panel:** the held-out three lenses plus the brief's three, all on Opus, each with three Sonnet refuters. 60
    agents ran, with none dead and none unexamined. 11 findings were confirmed (some merged across lenses), and 7 were
    refuted.
    - Every briefed suite passed. The load timeouts each passed when re-run alone.
    - Every Linux leg is green on both CI runs.
    - `main` is now `da1373cf6`, and `merge-tree` is still clean.
    - Every agent prompt carried the fixture-`HOME` rule, and no live file was read.
  - **Classes 1, 2 and 4 to 10: none found.**
    - In today's live shape, both armed arms print `PASS` rc 0.
    - The tip's server, booted from that state, owes nothing.
    - Review 362's 29 cases pass, b1 gives one rotation, and d1b's bound holds.
    - The clamp's `max()` was attacked with no wedge, no storm and no fleet 401.
    - No update, rollout or install exit code changes.
  - **Both provisional rulings hold.**
    - F12's wider history was checked word by word against the real sync verb. Each word counted as history wrote the
      value, and each refusal wrote nothing.
    - The clamp keeps "never cleared".
  - **Every finding of review 383, and D-139, is closed at the tip,** each with a pin that reds when its fix is reverted.
  - **Class 3, by its words, against D-139's own sentence ("a box that once held a value and lost it stays FAIL"):**
    - **F1:** a server left with only `box-token-retired.json` (or `mail-previous.token`) reads `PASS` "no value has been
      minted here yet". It read WARN before this round. The panel split.
    - **F2:** a fleet box that synced, then refused (`bad-code`), then lost its token file and its generation file
      reads WARN. It read FAIL before this round.
      - The refuters set it aside 3 to 0, as F12's ruled outcome.
      - But D-139 is the operator's ruling and outranks mine. 4553's sentence that this case reads `PASS` is wrong; it
        reads WARN.
  - **Facts for the ruling,** from a six-agent read-only workflow on the tip (three Opus investigators, each with a
    Sonnet refuter; the claims held):
    - **Neither state is reachable by ccrc itself.**
      - No code deletes either token file. Each is only replaced by an atomic rename.
      - F1 needs files lost by hand or to the disk, while no server runs. The next boot mints a fresh value, owing no
        rotation, and clears the state.
      - F2 needs a person to delete the fleet token file. Its WARN still shows the refusal and a remedy, but says
        "no value has been handed to this box", which is false.
    - **Both fixes are small:**
      - F1 is about 6 lines in doctor's server arm: existence checks on the sibling files, never their contents. It
        is off the rotation path.
      - F2 is about 15 lines. The sync verb's refusal path carries the last held generation in a new field, and
        doctor reads it. The verb runs on every live rotation, but this code runs only on a refusal.
    - Neither fix changes a live box's verdict.
  - **Minor, for residue:**
    - F3: a failed first mint reads `PASS` (class none).
    - F4: a presentation is lost while the clock is behind `lastRotationAt` (pre-existing, class none).
    - F5 to F10: prose and coverage.
  - **Live re-measure, 18:18 UTC:** the server's counters read 0 and 0, with no `retiredPresentedAt` key and no hold. The
    fleet's last sync is `synced`.
  - **A co-edit agreement (mail 4324, 13:05 UTC).** Native docs reader wave 4 (run 367) may co-edit four files under
    claim 1173: the doctor checks file and the doctor, install and update tests. The terms are mail 4077's: each side
    edits only its own lines, and the second lander merges `main`, keeps both sides, re-derives every count and re-runs
    the touched suites.
  - **Run 377 stays `awaiting-review`.** The merge waits on the operator.
- **2026-10-12 18:42 UTC: the operator ruled "merge now, fix both after". Row 2b merged as #353; row 2c is run 398.**
  - **The ruling (about 18:30 UTC, on the 18:24 entry's question):** #353 merges as it is. A small row 2c PR, before
    row 3, fixes both class-3 edges of D-139 and carries review 391's minor findings. The two exceptions to "a box
    that once held a value and lost it stays FAIL" stand only until row 2c lands. Each needs a person or the disk to
    delete token files, and no live box is in either state.
  - **Run 398 (row 2c, wave 5 of 7) opened `planned` at 18:39:49 UTC,** before run 377 closed. It names no
    `sessionId`; a fresh worker is dispatched once its brief is written.
  - **#353 merged at 18:40 UTC as `82464a449`,** with `--squash --admin --match-head-commit 250f7f318`.
    - Its parent is `da1373cf6`.
    - The merged tree equals `git merge-tree`'s tree for `da1373cf6` and the tip (`84a806dc7`).
    - Before the merge, the PR's title, body and every commit message were checked against the public-repo rule.
    - The live server's counters were re-measured 22 minutes before: 0 and 0, no `retiredPresentedAt` key, no hold.
  - **Run 377 was closed final** (`prPhase: merged`). Claims 1173 and 1172 have ended. The worker's SDD directory (52
    files) was copied under `.superpowers/btl-w2b-evidence/sdd-final/` before the close.
  - **Told:**
    - the GPT-lane coordinator (mail 4370), that the arms are on and both boxes read `PASS`;
    - native docs reader (mails 4371 and 4373), that its wave 4 is now the second lander for the four co-edited files;
    - workspace lifecycle (mail 4372), that #351 shares only `README.md` with the merge and still merges clean.
  - **Centralised update's wave 15 (run 300) is now held by #351 alone,** on `ccd/ccd`.
  - **Row 2c's scope, for its brief:**
    - **F1:** in doctor's server arm, a `token-absent` box whose state reads absent stays FAIL when a sibling file
      exists (`box-token-retired.json`, `mail-previous.token`, or a set-aside copy). Test existence only, never
      contents. Make the both-role own-write fleet arm agree.
    - **F2:** `ccrc-token-sync`'s refusal path carries the last held generation in a new report field, read from
      the generation file or the previous report. Doctor's refusal-only rule then needs that field absent. A synced
      report's bytes, the verb's stdout, and every exit code and first stderr line stay as they are, because the verb
      runs on every live rotation.
    - **Review 391's F3 to F10,** prose and coverage, including 4552's "an hour apart" wording and 4553's wrong `PASS`
      sentence for F2's case.
    - F4's lost presentation is pre-existing. Row 2c's plan rules on whether to fix it.
    - Numbers: 4554 to 4558, defined in the commit that first cites each.
  - **Next:** watch the arming release reach both boxes read-only. Both must stay `PASS`, with no update exit 3. Then
    write row 2c's plan and brief.
- **2026-10-12 18:51 UTC: the arming is live on both boxes (v0.0.153), and both read `PASS`.**
  - **A correction to the 18:42 entry:** the operator's ruling was answered before 18:39:49 UTC, when run 398 opened.
    "About 18:30" was not measured.
  - **The release:** v0.0.153 is #353, published at 18:41:26. The fleet box ran 18:44:27 to 18:46:39, and the server
    18:46:55 to 18:47:18. Both records read `done`, and both boxes had converged by 18:48:46.
  - **The armed doctor:**
    - Server: `PASS box-token: server: generation #3, rotated 45 h ago, fleet confirmed, retired value refused`. Its
      doctor reads 25 passed, 0 warned, 0 failed.
    - Fleet: `PASS box-token: fleet: token file 0600, generation recorded, last sync proved, transport https`. Its doctor
      reads 33 passed, 6 warned, 0 failed, and none of the six is from `box-token`.
    - No update exit code moved.
  - **The driver under 4552:**
    - The first tick wrote `retiredPresentedAt: null`, as reviews 383 and 391 predicted.
    - `rotationOwed` is false, the counters read 0 and 0, and there is no hold.
    - The fleet's last sync is still `synced`.
  - **Bar classes 1 and 2 held on the live boxes.** The GPT-lane coordinator was told the arms are on (mail 4370). Nothing
    read below `PASS`, so no follow-up was owed.
  - **Next:** row 2c's plan and brief (run 398).
- **2026-10-12 19:34 UTC: row 2c (run 398) dispatched** to `ccrc-pwa-calm-delta` at 19:34:13, with 7 items (Tasks 1 to 7).
  - **The plan was drafted by a workflow** at `82464a449`:
    - three Sonnet scouts measured the code and test sites;
    - an Opus drafter wrote the plan;
    - two Opus attackers tested it, one on live safety and one on pin teeth;
    - an Opus reviser applied all 19 of their breaks (5 important, 14 minor) after checking each against the code. Among
      them: a FIFO pin that could not red, and an unlistable-directory guard that would have failed a fresh box.
  - **The plan rides in the worker's PR as Task 1,** at `docs/superpowers/plans/2026-10-12-box-token-lifecycle-row-2c.md`.
    The evidence copy is under `.superpowers/btl-w2c-evidence/`.
  - **Coordinator rulings on the plan's open points:**
    - F3's sentence clause stays: it extends D-139's words without reshaping them.
    - `mail-pending-<id>.token` is not a trace in row 2c; row 3 decides.
    - A token directory that exists and cannot be listed reads FAIL, because boot refuses there too.
    - F4 stays out, as a named limit for row 3.
  - **Numbers:** 4554 (F1, amending 4553) and 4555 (F2, amending 4553), each defined bare in Task 1's commit. The spares
    are 4556 to 4558, each taken only after a mail.
  - **Routing:** main loop Opus·high, workflow off, compact 40; implementers Sonnet·high; per-task reviewers Opus·high,
    with a second Opus reviewer on Tasks 2 and 4. The worker is on an Anthropic lane.
  - **Claims:** none live on the plan's files at 18:52. Mail 4324's co-edit terms with native docs reader wave 4 are
    extended to run 398 (mail 4388). #351 touches `README.md`.
  - **The brief carries the fixture-`HOME` rule,** and forbids subagents to send mail.
- **2026-10-13 00:46 UTC: run 398's wave-done (mail 4445), re-measured; the bar committed before its review.**
  - **Evidence:** the wave-done and the worker's SDD directory (25 files) are copied under
    `.superpowers/btl-w2c-evidence/sdd/`.
  - **The claim, re-measured:**
    - PR #376 is open and mergeable. Its head equals the fingerprint and the pushed tip, `6faca9bdf`.
    - It has 7 commits, each with the noreply identity. The plan is the first commit, and it equals the coordinator's
      evidence copy byte for byte; Task 6 then settled its text.
    - It changes exactly the plan's 9 File Structure files.
    - `main` is `2d1835188`, and `merge-tree` is clean, so no absorb was owed.
    - The only claim on its files is the run's own, 1204.
    - The PR's title, body, commit messages and added lines name no private host, path, lane, account or project.
    - No number from 4554 to 4570 is written with the prefix.
    - CI: PR run 38319352407 and full run 38327049307 are green on every Linux leg. Their macOS legs were still running
      or queued, and gate nothing.
  - **What the worker reports:**
    - Each task was measured red, then green, with its mutation rows.
    - The live shape read `PASS` at every commit, measured on `git archive` copies.
    - 4554 and 4555 are defined bare, and 4552 and 4553 amended in prose. No spare was taken.
    - New limits:
      - 4554: an unlistable directory that also holds a named trace gets the restart remedy; and `[ -r ]` stands in
        for listability.
      - 4555: a stale generation file after a post-write `write-failed`.
    - Equivalent mutants are named in the commits.
    - A coordinator mail at 00:42 (4444) told the worker that the macOS legs need not hold the wave-done.
  - **Bar for the merge.** This merge reaches both live boxes by auto. It changes `ccrc-token-sync`, which every live
    rotation runs, and doctor's armed `box-token` verdicts. The held-out review must find NO confirmed finding of these
    classes:
    1. **The live rotation path:** any change to a synced report's bytes, the verb's stdout line, an exit code or a
       first stderr line; a refusal that can block or hang (a FIFO, a link, an unreadable file); a `set -u` or
       redirect slip; or anything that can turn a live rotation's result into a different word or a fleet 401.
    2. **The live boxes after the release:** on a box in today's shape, the armed doctor prints anything but `PASS`, or
       an `update`, `rollout` or `install` exit code changes.
    3. **Fresh and lost boxes:**
       - a never-handed box FAILs (D-139);
       - a box that held a value and lost it reads less than FAIL, other than the plan's named limits (4554's traces,
         4555's `held`);
       - an undecidable history reads `PASS`;
       - a token directory that does not exist yet reads FAIL.
    4. **The kill switch:** a disarmed copy prints anything but SKIP for a real finding and `PASS` for never-handed.
    5. **Secrets:** a value, a claim code or a sha256 in any output, log, test output or report; or doctor opening
       `mail-previous.token`.
    6. **A new pin that cannot red** when its guard is mutated, the FIFO rows' elapsed-time checks included.
    7. **An overloaded null** (`held: null`), a second definition of an L0 word, or a broken shape pin (doctor's three
       generation-id literals, the verb's three `python3 -I -c` lines).
    8. **Scope:** an edit outside the 9 files, anything under `server/src/`, `agent/src/`, `shared/`, `deploy/` or
       `ccd/ccd`, or a README edit beyond the `box-token` row.
    9. **Numbers:** anything defined beyond 4554 and 4555, or 4554 to 4570 written with the prefix.
    10. **The public repo:** a private name in the diff, a commit message or the PR body.

    Also, every Linux leg of both runs must stay green.
  - **The rounds:** a bar-class finding gets one fix round, then a scoped review. After that review, a bar-class finding
    stops the merge and goes to the operator. Coverage and prose findings become residue for row 3.
  - **Run 398 was advanced to `awaiting-review`** at `6faca9bdf` at 00:46 UTC. **Review run 405** opened at 00:46 UTC, for
    dispatch after this entry. Its brief runs the held-out panel, plus three lenses:
    - the live rotation path and the live boxes;
    - doctor's fresh and lost classes and the kill switch;
    - secrets, scope, numbers and the public repo.

    It carries the fixture-`HOME` rule.
- **2026-10-13 03:17 UTC: review 405 closed (row 2c at `6faca9bdf`); fix round 1 sent, by the committed bar.**
  - **The panel:** the held-out three lenses plus the brief's three (7 Opus lenses in all), each with three Sonnet
    refuters. 19 agents ran, with none dead and none unexamined. 3 findings were confirmed (2 distinct), and 1 was
    refuted.
  - **Classes 1, 2, 4 to 8 and 10: none found.**
    - The real sync verb was run at the tip and at `main`, 85 cases a side. Exit code, stdout, full stderr and every
      file are identical. The only report change is `held` on the 36 refusals that wrote nothing.
    - 25 `_ts_held` attack shapes, in 3 modes each, blocked nothing; the worst case took 730 ms.
    - The FIFO pins red at about 5.1 s.
    - Review 362's 29 cases pass.
    - Both live shapes read `PASS` rc 0, and no exit code changes.
    - The kill switch holds, and `strace` shows `mail-previous.token` is never opened.
    - Exactly the 9 files change, and no private name appears.
    - Review 391's F1 to F10 are all closed, or out by "Not in this PR".
  - **F1, class 3 by its words, pre-existing:** on an own-write both/local box, the server's `mail.token` and state
    deleted, with the fleet file and `box-token-generation` kept, read `PASS`. The server arm counts only the server
    directory's siblings.
    - **Ruled:** on an own-write box those fleet-side records are the server's own writes, so they are a server trace
      under D-139. They are fixed in this round, amending 4554. A box with `agent.env`, and a server-role or fleet-role
      box, never use the rule, so neither live box changes.
  - **F2, class 9 by its words:** the tip commit's message writes 4554 with the prefix. The repository's squash default
    is `COMMIT_MESSAGES`, so a default squash would carry it to `main`.
    - **Ruled:** no history rewrite. The coordinator writes the squash body at merge, with numbers bare, and greps it
      before merging. This round's commit messages write numbers bare.
  - **F3, prose:** the plan's Review Focus class numbers are aligned to this bar.
  - **The rulings** are in `rulings-run398-fix1.md` (mail 4502). Run 398 was advanced back to `working` at
    `6faca9bdf`. A scoped review of the fix range follows. After it, a bar-class finding stops the merge and goes to the
    operator.
  - **Co-edit consents on claim 1204, ratified:**
    - the worker's consent to run 354 (mails 4447 and 4449, on mail 4362's terms), for README, the doctor checks file,
      and the doctor and install tests;
    - the coordinator's consent to runs 399 and 400 (mail 4458, on their R56 terms), for README outside the
      `box-token` row.

    No lines overlap row 2c's.
- **2026-10-13 05:36 UTC: run 398's fix-round wave-done (mail 4512), re-measured; scoped review run 409 opened.**
  - **Evidence:** the wave-done and the worker's SDD directory (33 files, with `wave-done-fix1.md`) are copied under
    `.superpowers/btl-w2c-evidence/sdd-fix1/`.
  - **The claim, re-measured:**
    - PR #376 is open and mergeable. Its head equals the fingerprint and the pushed tip, `faa0ef03e`.
    - The fix range, `6faca9bdf..faa0ef03e`, has 4 commits, each with the noreply identity. They change 5 files, all
      among the PR's 9, and the PR still changes exactly those 9.
    - `ccd/ccrc-token-sync` and its tests are untouched in the range. The README change is the `box-token` row only.
    - `main` is `05df8c4e0`, and `merge-tree` is clean, so no absorb was owed.
    - No number from 4554 to 4570 is written with the prefix in the range's diff or its messages. The PR's one prefixed
      literal is still `6faca9bdf`'s message (review 405 F2), which the squash body written at merge keeps off `main`.
    - The range's added lines, its messages and the PR body name no private host, path, lane, account or project.
    - CI: PR run 38350375371 is green on every leg, macOS included. Full run 38350406489 is green on every Linux leg;
      its macOS legs were still running or queued, and gate nothing.
    - **Claims:** 1204 reached its 8-hour cap at 03:36. Run 354 took `README.md` as claim 1222 at 03:41, under consent
      4449, and the worker's claim 1223 holds the other 8 paths. The worker's README cell edit (03:46) was made under
      4449's terms, and it told run 354 (mail 4503).
  - **What the worker reports:**
    - **F1:** on an own-write box (role both, fleet not remote, no `agent.env` marking the fleet), the fleet token file
      and the generation file are server traces. They are tested by existence only, before the unlistable test, and read
      FAIL with the trace sentence and the restart remedy. 6 rows were red of 264, then 264 green. Its five mutants red
      6, 4, 4, 2 and 2 rows.
    - A both box with `agent.env`, a both box with a remote fleet, and a server-role box keep `6faca9bdf`'s reading,
      byte for byte.
    - **The window: no stop.** `mail.token` is written before either fleet-side file, and no path writes them while it
      is absent. Install's one doctor runs after the restart and `verify-service`'s 8 seconds.
    - The live shape is green at each code commit, and the fresh both-role install golden has not moved.
    - **New limits in 4554:**
      - a purged box whose reinstall's first mint fails now reads FAIL, so that install exits 1 (before, it read the
        never-minted PASS);
      - an unsearchable `~/.cc-secrets` hides the fleet-file trace, so the server part prints the never-minted
        sentence, while the fleet arm keeps the verdict at FAIL;
      - an unlistable token directory beside a surviving own-write file gets the restart remedy, and reads FAIL either
        way.
    - F2: no history was rewritten. F3: Review Focus is relabelled to the bar's class numbers.
  - **For the review:** no live box is own-write, and the live shapes are byte-unchanged, so the purge limit's exit 1
    does not meet class 2 by its words. Whether it, or the unsearchable-directory sentence, meets class 3 is the
    review's to measure.
  - **Run 398 was advanced to `awaiting-review` at 05:35:14 UTC.** Review run 409 opened `planned`, scoped to the
    fix range, under the committed bar and the rounds rule: after it, a bar-class finding stops the merge and goes to
    the operator.
- **2026-10-13 07:03 UTC: review 409 clean at the bar; row 3 opened as run 410; row 2c merged as #376, and run 398
  closed.**
  - **Review 409** (mail 4521, report `review-409-faa0ef03.md`) read the fix range at `faa0ef03e`. It ran the held-out
    panel plus the brief's three lenses: 36 agents, none dead, empty or unverified. It confirmed one distinct finding
    and refuted seven.
    - **Classes 1 to 10: no finding.**
      - The rotation path is byte-unchanged across the range.
      - Both live shapes read `PASS` rc 0, byte-identical in both trees. A grid of 2430 fixture HOMEs found every row
        that is not own-write byte-identical to `6faca9bdf`. Only 72 own-write rows differ, each with the token and
        state absent and a fleet-side file present.
      - No `update`, `rollout` or `install` exit code changes for a box in a live shape.
      - The window answer holds, a missing token directory still reads the fresh `PASS`, and the kill switch holds.
      - `strace` shows the server arm never opens the fleet file, the generation file or `mail-previous.token`.
      - Scope, numbers and the public repo are clean.
      - Review 405's F1 and F3 are closed, and its F2 was left to the squash body, as ruled.
    - **F1, prose, introduced by `aac9361bf`, no bar class:** the plan's purge limit says the box read "the
      never-minted PASS" before this round. It read WARN, rc 2: its server part was that PASS, beside the fleet part's
      `no-generation`. The FAIL at the tip and install's exit moving from 0 to 1 are right.
      - **Correction:** this ledger's 05:36 entry repeats the worker's wrong words ("before, it read the never-minted
        PASS"). Before this round, that box read WARN, rc 2.
    - **Refuted, but kept as advice (R2 and R3):** on an own-write box whose token directory cannot be listed, a
      surviving fleet-side file now gets the restart remedy, where `chmod u+r` is right. This is a named 4554 limit, and
      the verdict is FAIL either way. Moving the own-write block after the unlisted test would keep every verdict and
      row, and no row pins the order.
  - **Ruled:** nothing needs a ruling. Under the rounds rule, F1 and the R2/R3 reorder are residue for row 3. So is the
    unsearchable-`~/.cc-secrets` sentence that 4554 names.
  - **Review run 409** was advanced to `working` and closed `done` with the reviewer's `reviewedTip` and report.
  - **Run 410 (row 3, wave 6 of 7) opened `planned` at 07:00:33 UTC,** before run 398 closed. It names no
    `sessionId`; its plan and brief come next.
  - **The live counters were re-measured at 07:00:**
    - server: generation 3, `rotationOwed` false, no hold, 0 failures, both presentation counters 0, and no
      `retiredPresentedAt`;
    - fleet: the last sync was `synced` and `proved`, over https.
  - **#376 merged at 07:01:40 UTC as `e4405056e`,** with `--squash --admin --match-head-commit faa0ef03e`.
    - Its parent is `05df8c4e0`. Its tree equals `git merge-tree`'s tree for that parent and the tip.
    - **The squash message was written by hand:** numbers bare, grepped for a prefixed number and for private names
      before the merge, and grepped again on `main` after it. So `6faca9bdf`'s prefixed literal (review 405 F2) did not
      reach `main`.
    - v0.0.164 was published at 07:02:42.
  - **Run 398 was closed final** (`prPhase: merged`) at 07:02:12, and its child reclaim is queued. The worker's SDD
    directory (33 files) was copied under `.superpowers/btl-w2c-evidence/sdd-final/` before the close. Claim 1223
    has ended.
  - **Told** (mails 4523 to 4527), each with the files #376 touched and the second lander's terms:
    - run 354's worker and its coordinator, for README (claim 1222, consent 4449) and their doctor edits;
    - native docs reader, for its wave 4's doctor edits (mails 4324/4388);
    - path identity and child reclamation, for README outside the `box-token` row (mail 4458);
    - the GPT-lane coordinator, that both live boxes are expected to keep reading `PASS`.
  - **CI note:** the full run's four macOS legs, and so its `full-suite` summary, are red, in files outside this PR.
    They gate nothing.
  - **Next:** watch v0.0.164 reach both boxes read-only. Both must read `PASS`, with no update exit 3. Then write
    row 3's plan, with this residue, and its brief.
- **2026-10-13 07:46 UTC: v0.0.164 live on both boxes, both `PASS`; row 3's facts measured and its split proposed.**
  - **v0.0.164 (#376) landed by auto.** The fleet box ran 07:32:32 to 07:34:33, and the server 07:35:02 to 07:35:29.
    Both boxes read `box-token` PASS: the server "generation #3, rotated 2 d ago, fleet confirmed, retired value
    refused", 25 passed and 0 failed; the fleet "token file 0600, generation recorded, last sync proved, transport
    https", 0 failed. No update exited 3, so the GPT-lane coordinator needs no notice.
  - **The facts workflow** (6 agents: three scouts, an architect and two attack lenses, all on Opus except one Sonnet
    scout) measured `main` at `e4405056e`. Its output is in
    `.superpowers/btl-w3-evidence/facts-workflow-wstkjf1cr.json`.
    The attacks found 3 critical and 12 major breaks against the architect's proposal, and they shape what follows.
  - **The split** (proposed; each part is its own run, PR and review, and each gets its own bar):
    - **3a: the weekly schedule, plus row 2c's residue.** Small, and safe alone. This is run 410.
    - **3b: dormant agent-link readers.** Both processes read a ccrc-owned file at each hello or connect, with a
      constant-time compare, a non-secret generation marker, and a distinct, logged 4401 state. Nothing writes the
      files yet. It must be live on both boxes before anything can rotate.
    - **3c: link rotation on the server and agent,** behind a cap word. It has its own op and its own claim kind, and
      the server proves the new value with a probe socket rather than a reconnect.
    - **3d: the arming part:** the fleet verb, the cap word, doctor's link arm, the console and the redactor sources.
    - **3e: install-time pairing goes.**
  - **Ruled by the coordinator, for 3a** (the readings named in the workflow output):
    - **R4:** the schedule is a derived trigger, `scheduled`, recomputed each tick and never persisted, so a rollback
      reads `box-token.json` unchanged.
    - **R5, as amended by the attack:** the anchor is `lastRotationAt`, or `current.since` when that is null. An anchor
      in the future is due only when it is more than one interval ahead; otherwise the schedule waits, and the view and
      doctor say the stamp is in the future. 4552's clamp rows stay green unchanged.
    - **R6, as amended:** the interval is declared once in L0 (`shared/box-token.ts`). It is pinned by name and by value
      across `server/src`, `pwa/src`, `agent/src` and `shared/`, with doctor's shell copy and its slack pinned to L0.
      The pins live in `token-shared.test.ts`, which keeps 3a off claim 1219.
    - **R7:** doctor's server arm gains a WARN, `rotation-overdue` (the anchor older than the interval plus a slack
      declared in L0, with no standing hold), and the view gains an optional `nextRotationAt`. The card line waits
      for 3d.
    - **R8:** `scheduled` sits after `rotate-now` in the why chain and is subject to backoff, so an `unsent` restage
      cannot loop every tick.
    - **R18 and R19 (residue):** both trace blocks move below the unlisted test, so an unlistable directory gets the
      `chmod u+r` remedy; and an unsearchable `~/.cc-secrets` gets its own trace word and remedy, with no new FAIL
      class.
    - **R20:** the coordinator proves the first scheduled rotation live, read-only, as §10.3 proved the first rotation.
  - **Ruled by the coordinator, for the link parts:**
    - **R3, code only:** the link claim uses the same code-only door semantics as the box token. That is the 15:23
      ruling's "the same code-then-HTTPS claim". Requiring the box token as well adds no factor against the party the
      spec's §7 accepts, because that party already receives the box token's codes over the same link.
    - **R9:** a distinct op word, template and claim kind for the link, so an older verb can never write a link value
      over the fleet's box-token file.
    - The serialisation runs one way only: a link rotation waits while a box-token value is in flight, and the box-token
      driver, its gate and its hold words stay byte-unchanged.
    - **Retirement evicts.** A connection that said hello with a retired value must be closed or re-authenticated: the
      attack's critical finding. 3c carries it as a bar class.
    - The rest (R10 to R17) is ruled in 3b's and 3c's plans, after the operator's answers below.
  - **To the operator:**
    - **G5 against G6 for the link token.** After the first link rotation, a rollback to a build older than 3b reads
      only its EnvironmentFile and cuts the link. The unattended watchdog rollback can do this too.
    - **What replaces install-time pairing,** and whether a repair door must exist before rotation is armed.
  - **Blockers for 3a:** none on its files. Run 400's claims 1218 (`shared/api.ts`) and 1219
    (`single-definition.test.ts`) end by 10:35, and 3a needs neither. Open PR #381 (native docs reader) touches the
    doctor checks file under the co-edit terms.
  - **Numbers:** 3a uses 4556 to 4560, and the coordinator keeps 4561 to 4570. Later parts get fresh blocks.
- **2026-10-13 08:19 UTC: the operator ruled row 3's two questions, both as recommended** (answered after 07:50, before
  08:19).
  - **G5 against G6 for the link token: "Accept, guard it".**
    - The ruling of 2026-10-07 15:23 stands. Both processes read a ccrc-owned file at each hello, the EnvironmentFile
      only seeds it, and no link value reaches any environment (G5).
    - The guard: rotation arms only on builds that already carry the link readers (3b), on both boxes. So the update
      watchdog's unattended one-step rollback, and the gate-failure restore, always land on a build that reads the file.
    - The residual: only a deliberate hand rollback below 3b, after a rotation, cuts the link. Doctor FAILs that state,
      and the repair door below fixes it in one act. README names the residual.
    - The systemd drop-in that would have carried the value into every build's environment is not built.
  - **Pairing: "Console code, before arming".**
    - A one-time, short-lived code is shown in the console behind the passkey session. It is typed at
      `ccrc install --role fleet`, or at a repair verb on the fleet box, and the fleet trades it over HTTPS for its link
      files. No secret is typed or pasted.
    - The same door repairs any later mismatch in one act. It lands before rotation is armed.
  - **The split, reordered by the second ruling:**
    - 3a: the schedule and row 2c's residue;
    - 3b: the dormant readers, with the generation marker;
    - 3c: rotation on the server and agent, dormant behind its cap word, with eviction of connections that said hello
      with a retired value;
    - 3d: the pairing and repair door, with install-time pairing removed and the D-4399 marker re-keyed;
    - 3e: the arming part (the verb's link mode, the cap word, doctor's link arm, the console and the redactor
      sources).
  - **Not reopened:** R3 stays code-only, as the 07:46 entry ruled.
- **2026-10-13 08:49 UTC: row 3a's plan is written and its questions answered; run 410's dispatch follows.**
  - **The plan workflow** (4 agents on Opus: a drafter, two attack lenses and a reviser) wrote it from `main` at
    `e4405056e`. The attacks found 21 breaks: 1 critical, 7 important and 13 minor. All were applied, and none was
    rejected.
    - The critical break: the e2e plant used the wrong rig's clock.
    - The most dangerous important break: an apostrophe inside doctor's single-quoted `_BT_PY_STATE` program. That
      would have read `state-unreadable` FAIL on the live server. The plan now forbids any `'` in either program, with
      a grep check.
  - **The coordinator answered the plan's four questions** (about 08:40):
    - **Q1, taken as 4558:** the scheduled trigger gets its own backoff, held in memory only, which a fresh agent ready
      does not clear. Owed rotations and "Rotate now" keep spec §5.1's rule. A weekly schedule is never urgent.
      Without this, a link that reconnects inside every tick would stage and write a pending file every tick, and on
      lost answers would climb to doctor's `failed:*` FAIL unattended. A persistent real fault still reaches that
      FAIL across the backoff's steps (G4).
    - **Q2, confirmed:** the interval's value pin allows exactly three separate seven-day quantities. They are the new
      interval, `LEDGER_STALE_MS`, and child reclamation's `CHILD_RECLAIM_LEAF_KEPT_HORIZON_MS`, which 3a does not
      touch.
    - **Q3, accepted for 3a:** a stamp ahead of the clock shows in the view only as a `nextRotationAt` more than one
      interval ahead, because the view carries no server clock. 3e's card may add one.
    - **Q4, accepted as true:** a box whose gate never opens persists its existing hold word and reads WARN
      `held:<word>` one interval after its anchor. No exit code moves, and neither live box is such a box.
  - **The plan** is `.superpowers/btl-w3-evidence/2026-10-13-box-token-lifecycle-row-3a.md` (860 lines). Task 1
    commits it byte for byte. It defines 4556 (the derived schedule and its anchor), 4557 (the overdue WARN and the
    view field) and 4558 (the scheduled-miss backoff), and it amends 4552 and 4554 in prose. 4559 and 4560 are spare.
  - **Its files are clear of live claims.** Run 400's claim 1218 holds `server/src/update/inventory.ts`, which 3a only
    reads. Open #381 (native docs reader) also edits the doctor checks file, under mail 4324's co-edit terms.
- **Model auto-advance is not this programme's.** The operator assigned it to `ccrc-pwa-clear-mesa` at 11:25 UTC. The
  shared operator-window marker that coordinator proposed is off by the 13:28 ruling.
- **2026-10-13 23:20 UTC: the daily cap refused run 410 twice; the operator directed row 3a into the coordinator's own
  workspace.**
  - **The refusals.** At 22:43 two slots were free (5 of 7 active), but `runs dispatch 410` answered `cap-daily` (24 of
    24, the fleet-wide rolling window). The one retry, at 23:11, met the same answer: another programme's work run took
    the slot that review 403's age-out freed at 23:09:50, 62 seconds later. The next age-outs were 00:24:47 and
    00:48:44.
  - **The operator's direction (23:19):** "take it up in this workspace itself". The coordinator runs row 3a itself,
    not through a dispatch:
    - in a worktree of its own, on a new branch `box-token-lifecycle-row-3a` from `main` at `300aedf88`, because its
      own checkout carries the centralised-update ledger, which the hourly check still writes;
    - under claim 1272 (run 410, the plan's ten edited files, hard cap 2026-10-14 07:22);
    - by the brief's execution skill and routing: a Sonnet·high implementer per task, an Opus·high per-task reviewer,
      a second Opus reviewer on Tasks 3 and 5, and at most two fix rounds a task (workflow `wf_d8f2e161-7b1`).
  - **Task 1 is committed** as `de241128a`: the plan byte for byte (`cmp` identical to the evidence copy), after
    `deviation-refs` (31 passed) and `dtbd` (1 passed).
  - **What stays.** Run 410 keeps its row. No session holds it, so it stays `planned` and takes no dispatch slot. The
    held-out panel still reviews the PR (clause 14), and 3a's merge bar is written here before that review, as for row
    2c. How run 410 closes with no dispatched session is measured before anything advances it.
  - **`main` moved** from the plan's `e4405056e` to `300aedf88`. Of the plan's edited files only the doctor checks
    moved, by #381 (lines from 8047, and line 213's list), as the brief already says.
- **2026-10-14 08:04 UTC: row 3a's PR #403 opened at `d1b35d82d`, re-measured; the bar committed before its review.**
  - **How it was built.** In the coordinator's own worktree, by the operator's 23:19 direction: no dispatch, and run
    410 stays `planned`. Tasks 2 to 7 each had a Sonnet·high implementer and an Opus·high reviewer, with a second Opus
    lens on Tasks 3 and 5. Every task was approved with no fix round, and the reviews carried 36 minors. The
    coordinator ruled them into four new commits, groups A, B, C and E (`44e8a4aee`, `c2b7c0522`, `eee4a90a9`,
    `e3f7f31fd`), each with its own Opus review. A fifth, group F (`d1b35d82d`), closed the minors those reviews
    passed on. No commit was amended once a later one sat on it.
  - **The claim, re-measured:**
    - PR #403 is open and mergeable. Its head equals the pushed tip, `d1b35d82d`.
    - It has 12 commits, each with the noreply identity. The plan is the first commit, `de241128a`, and it equals the
      evidence copy byte for byte; Task 7 and groups E and F then settled its text.
    - It changes exactly the plan's 10 File Structure files.
    - `main` is `b953aefa4`, 5 commits past the base `300aedf88`, none of them on these files. `merge-tree` is clean,
      so no absorb is owed.
    - The only claim on its files is the run's own. 1272 lapsed at its hard cap at 07:22, and 1289 re-took the same
      10 paths at 07:26.
    - The PR's title, body, commit messages and added lines name no private host, path, lane, account or project.
    - No number from 4552 to 4570 is written with the prefix, in the tree, the messages or the PR body.
    - CI: PR run 38532462858 and full run 38532471392 started at 08:03 on `d1b35d82d`. Their results are a later
      entry.
  - **What the verification measured** at `e3f7f31fd`, and again at the tip for every file group F touched:
    - The plan's 18 suites, one file per call, all green (`doctor-box-token` 282, `token-rotation-e2e` 123,
      `token-policy` 112, `token-shared` 39 and `single-definition` 537 among them).
    - `ccrc-doctor`, `ccrc-install` and `ccrc-update` split by `-t`, with coverage reconciled against `vitest list`:
      898, 299 and 502 listed tests, every one covered, 0 failed in 27 pattern runs.
    - The live-shape set read `PASS` at all 12 commits.
    - `GateInput`, `rotationGate` and `runTick`'s fresh-ready reset are byte-identical to the base. The token-sync op,
      `ccrc-token-sync` and the claim door are not in the diff. `_BT_PY_STATE` gains no `'`.
    - 4556, 4557 and 4558 are defined bare, and 4552 and 4554 amended in prose. 4559 and 4560 are unused.
    - The PR body corrects the commit messages' miscounts, and lists every named limit and the minors left for the
      review.
  - **Bar for the merge.** This merge reaches both live boxes by auto. It changes the server's token driver, which runs
    on the live server, and doctor's armed `box-token` verdicts, which count in every `update`, `rollout` and
    `install` exit code. The held-out review must find NO confirmed finding of these classes (the plan's Review Focus
    uses the same numbers):
    1. **The live rotation path:** a change to anything in Review Focus 1's empty list, to `rotationGate`, to
       `GateInput` or to the fresh-ready reset; a scheduled stage that bypasses the normal backoff, sits before a
       press, sets `rotateRequested` or runs beside another rotation; or a scheduled-miss backoff that can hold an
       owed rotation or a press, survive a promotion, reach a commit, or let a flapping link stage faster than once
       per ladder step.
    2. **The live boxes after the release:** on a box in today's shape, the armed doctor prints anything but `PASS`,
       or an `update`, `rollout` or `install` exit code changes.
    3. **The previous build:** a scheduled stage, hand-out or promotion persists a new key, owed word or hold word, so
       the previous build, its PWA or its doctor would read `box-token.json` differently; or `nextRotationAt` is not
       optional and additive.
    4. **The anchor and the clock:** a null anchor not counted from `current.since`; a future anchor within one
       interval that does not wait, or one beyond it that is not due; a boundary off by one; or a 4552 clamp row
       edited.
    5. **The residue:** a verdict or rc on Task 6's grid that differs from `e4405056e`, beyond the sentence and remedy
       moves the plan names; or `unsearchable` folded into `unlisted`.
    6. **Pins:** a second home of the interval or the slack, a scout spelling the value scan misses, or a new pin that
       cannot red when its guard is mutated.
    7. **Seams:** an overloaded null (`nextRotationAt` null for anything but no current value), or a second
       definition of an L0 word.
    8. **Secrets:** a value, a claim code or a sha256 in any output, log, test output or report; or doctor opening the
       fleet file or `mail-previous.token`.
    9. **Scope:** an edit outside the 10 files.
    10. **Numbers:** anything defined beyond 4556, 4557 and 4558, or 4552 to 4570 written with the prefix.
    11. **The public repo:** a private name in the diff, a commit message or the PR body.

    Also, every Linux leg of both runs must stay green.
  - **The rounds:** a bar-class finding gets one fix round, then a scoped review. After that review, a bar-class
    finding stops the merge and goes to the operator. Coverage and prose findings, with the six minors the PR body
    lists, go into one commit before the merge or become residue for 3b.
  - **The review.** No review run can be dispatched for a work run that was never dispatched, so the coordinator runs
    the held-out panel here, in its own shape (clause 14): three Opus lenses and a Sonnet refute pass per finding. The
    lenses are the live rotation path and the previous build; doctor's live `PASS` and the residue's verdicts; and
    pins, secrets, scope, numbers and the public repo. The panel reads the PR at `d1b35d82d`; the coordinator does not
    read the diff itself. How run 410 closes with no dispatched session is measured before anything advances it.
  - **A citation to re-point (mail 4787, review 438's F2).** #399 moved `server/test/single-definition.test.ts` down
    by 21 lines. The spec cites its seven-day-threshold pin at `:4774-4780`, which now begins at `:4798`. No test
    reads the citation. Row 3a does not edit the spec, so the next edit of the spec re-points it.
- **2026-10-14 09:32 UTC: row 3a's held-out review of PR #403 at `d1b35d82d`, clean by the bar; group G sent.**
  - **Its shape (correcting the 08:04 entry).** That entry named three bar lenses as "the" panel. What ran is the
    panel as written, plus those three lenses, as row 2c's review did:
    - The panel's own three lenses, correctness, spec conformance and does-it-reproduce, ran as the reference script
      states. One line was added to its read-only text: the fixture-`HOME` rule, because the reproduce lens runs
      suites.
    - The three bar lenses were the live rotation path and the previous build; doctor's live `PASS` and the
      residue; and pins, secrets, scope, numbers and the public repo.
    - Every finding went to three Sonnet refuters, and the majority decided. The lenses read a local clone at the
      tip, not the coordinator's worktree. Two restarts of this session (at 08:13 and 09:06 UTC) cut the runs. Each
      was resumed from its recorded results, and no lens was lost.
  - **The verdict: clean by the bar.** Every lens reported, and nothing was left unexamined. All findings are
    minor, and none is of a bar class.
    - The panel: correctness 1 confirmed; spec 1 confirmed and 1 refuted; reproduce 3 confirmed (one of them a
      record of what reproduced) and 1 refuted.
    - The bar lenses: live path 3 confirmed and 1 refuted; doctor and residue 1 confirmed; pins, scope and public 2
      confirmed.
  - **The one class-1 claim, refuted 3 to 0.** It said that a scheduled value handed out with its answer lost
    becomes an owed `confirm-deadline` rotation after the confirm window, and then stages once per tick on a
    flapping link. The refuters found it is spec §5.1's owed rule, which Q1 left unchanged. It is bounded by the
    confirm window and the pending cap (measured: 3 sends in 7 minutes, then the cap's hold). It becomes a named
    limit.
  - **What the reproduce lens re-measured.** Every green count it could run, and about 45 of the commits' mutants,
    reproduce. The grid and the prose pin are evidence scripts outside the tree, so their counts are records.
  - **The two real defects among the minors:**
    - Doctor's overdue WARN tests `pending` but not `promoting`. So a state left by a crash between promote's
      discard and its commit reads `WARN rotation-overdue ... nothing in flight` rc 2, where the base read `PASS ... a
      rotation in progress` rc 0. That state is reachable, so Task 5's "equivalent mutant" record was wrong. It is
      not today's live shape, and a WARN moves no exit code.
    - The one-definition pin misses a second definition typed `: number`.
  - **The rest:**
    - E8d's title claims a scheduled-miss hold no row can show (P8 alone pins it).
    - Review Focus 8's kill-switch sentence is backed by one row only.
    - Three more limits: the scheduled-to-owed path; a backward clock step after a miss; and a press during a
      scheduled stage's pending write, labelled scheduled.
    - The value scan's hex, octal and binary blind spot.
    - The six minors the PR body lists.
  - **CI at `d1b35d82d`.** Every Linux leg of PR run 38532462858 and of full run 38532471392 is green. The PR run's
    selection ran 579 test files in five shards, among them `token-shared`, `token-policy`, `token-rotation-e2e`,
    `doctor-box-token`, `ccrc-doctor` and `ccrc-install`. The macOS legs of both runs are red, so the full run's
    `full-suite` is red too, because it counts them. Both runs fail the same 23 tests in 8 files this branch does not
    touch (`ccd-child-reclaim-*`, `ccd-docs-tree`, `ccd-leaf-remove` and `ccd-review-335-pins`), and none in a token,
    doctor, install or update file. macOS gates nothing (ruling 2026-09-28).
  - **The ruling.** No fix round is owed, because the bar is clean. By the bar's last line, every confirmed minor and
    the PR body's six go into ONE commit, group G, before the merge:
    - the overdue clause gains the promoting test, pinned red first, with Task 6's grid re-run;
    - the pin's regex admits `: number`;
    - E8g is added, with a miss standing and presses through it, and E8d is re-titled;
    - the kill-switch rows are extended;
    - the comments, limits and records are corrected.

    It is reviewed by two Opus lenses, the rulings and the live doctor and driver, and re-verified: the suites, the
    doctor, install and update split with coverage reconciled, and the scans. The merge follows when it is green.
- **2026-10-14 13:42 UTC: row 3a merged as `8b36d8b6a` (#403), released as v0.0.183; claim 1289 released.**
  - **Group G (`fa9e05f72`)** closed every finding the review confirmed and the PR body's six minors, by the 09:32
    entry's ruling:
    - doctor's overdue WARN now also requires nothing promoting. A crash between an abandoned promotion's discard and
      its commit had read WARN "nothing in flight" where `main` read PASS "a rotation in progress". The new row reds
      before the fix and under its mutant.
    - the one-definition pin admits a typed second definition;
    - E8g presses while a scheduled miss stands, and is the only row that reds when the miss backoff's scope is
      widened to every why;
    - the new residue rows assert the kill switch's SKIP;
    - the limits and records are corrected.

    Its two Opus lenses (the rulings; the live doctor and driver) approved it with minors only. Its three verifiers
    are green at `fa9e05f72`:
    - every suite;
    - the doctor, install and update split, re-reconciled at 898, 299 and 502, all passed (at load 45 to 105, with
      raised timeouts; every red passed alone);
    - the scans.

    Task 6's grid has 0 verdict or rc moves against `e4405056e` in its own states. The planted crash state reads PASS
    again, as at `e4405056e`.
  - **Commit H (`5772edebb`)** is prose only: three plan sentences group G's reviews passed on.
  - **CI at `5772edebb`.** PR run 38569369095 and full run 38569360585: every Linux leg is green. The PR run
    selected 161 files, among them the six the plan names. The macOS legs are red in 9 files this branch does not
    touch (the same 8 as before, plus `ccd-docs-index`), so the full run's `full-suite` is red. macOS gates nothing.
  - **The merge.** `gh pr merge 403 --squash --admin --match-head-commit 5772edebb`, with no branch deletion and a
    hand-written body (numbers bare, scanned).
    - `main` was at `e66ca6acd`. #395 and #190 had landed since the base, on none of the branch's files, and
      `merge-tree` was clean.
    - The run's own claim was the only one on its files, and 1289 was released after the merge.
  - **Corrections.** The 09:32 entry said no finding is "of a bar class". Three confirmed minors were tagged with
    their nearest class (one 4, two 6), and none breaks it:
    - the backward clock step leaves the anchor rule intact, so the schedule is still due and only 4558's backoff
      holds the stage longer;
    - the two pin findings have no holder in the tree.

    All three are fixed or named limits.
  - **Run 410** was never dispatched, so it cannot advance and stays `planned`. Ending it is the operator's abandon
    door; nothing here forces it.
  - **Next:**
    - the live proof: both boxes on v0.0.183 read `box-token` PASS, and no update exits 3 on a `box-token` FAIL;
    - the first scheduled rotation, read-only, expected about 2026-10-17 (R20);
    - 3b's plan (the dormant link readers).
- **2026-10-14 14:42 UTC: row 3a is live on both boxes, inside v0.0.184, and the live proof holds.** One read-only
  read per box.
  - **The release.** v0.0.183 (13:42:07) was never installed. v0.0.184 (`ccc239319`, 13:48:47) came out inside the
    same poll interval, and it contains `8b36d8b6a`. The fleet box moved from 14:00:19 to 14:02:39 and the server box
    from 14:02:50 to 14:03:15, on the update mechanism's own poll. Nothing here ran an update.
  - **The proof, as the 13:42 entry set it:**
    - both boxes report v0.0.184, `phase: done`;
    - `box-token` reads PASS on both, in each update's trailing doctor and again at 14:42. The server reads
      "generation #3, rotated 3 d ago, fleet confirmed, retired value refused". The fleet box reads its token file
      0600, a generation recorded and its last sync proved;
    - no update exited 3 on a `box-token` FAIL. The server's run was clean (26 passed, 0 failed). The fleet box's run
      exited 3 on its one FAIL, `history: tick-stale`, the history programme's flap, as at v0.0.182. It had cleared
      by 14:42.
  - **The schedule.** Generation #3, rotated 3 days ago, is inside the 7-day interval: no rotation is due and no WARN
    stands, and the PASS line names no stamp ahead of the clock.
  - **R20.** The first scheduled rotation falls due once that anchor is 7 days old, about 2026-10-17 or 18. It is
    observed read-only. If it does not happen, the overdue WARN follows a day later.
  - **Run 410** stays `planned`. Next: R20, then 3b's plan (the dormant link readers).

## Carried constraints

- **Claims held when the plan was started (15:30 UTC), each blocking a file wave 1 touches:**
  - 1070 (run 291): `shared/api.ts`, `server/src/watch.ts`.
  - 1074 (run 295): `server/src/coord/routes.ts`, `server/src/auth/gate.ts`, `server/src/coord/schema.ts`, `store.ts`.
  - 1075 (run 315): `agent/src/whitelist.ts`, `server/src/ccdargv.ts`.
  - 1076 (run 295): `README.md`, `CLAUDE.md`.
  - 1077 (run 302): `ccd/ccrc`, `ccd/ccrc-doctor-checks`, `deploy/deploy.sh`, `ccd/session-hook.sh`, `install.sh`.
  - 1078 (run 302): `server/test/single-definition.test.ts`, `server/test/ccrc-install.test.ts`.
  - The plan also touches `README.md` (A2, A8, B6), `CLAUDE.md` (A8), both under 1076, and
    `pwa/src/fleet/useUpdatesView.ts` (B6), which no claim covers.
  - Re-read `GET /api/claims?project=ccrc-pwa` before each dispatch. A lapsed claim whose PR is still open doesn't
    count as ended.
- **The GPT-lane programme (`ccrc-pwa-clear-mesa`):** no action is needed from it, because a rotation is invisible to
  its gates. But the doctor check ships PASS or SKIP only, and no new doctor WARN may ship while one of its soak gates is
  open (lane 1's B4 gate closes about 2026-10-08 11:19 UTC).
- **ccrc-history (run 302's programme):** its verbatim store copies transcripts that hold the leaked value. Feed it
  the retired values' digests (the spec's Later box). Send that coordinator a note when wave 1 lands.
- **Centralised-update wave 16** adds `_inst_bins ccrc-api`. The rotation's stale-client check judges by content, so
  it doesn't wait on that wave, but the two must agree.
- **The live proof after wave 1 lands is the coordinator's,** read-only, never printing the value (the spec's §10.3).
  Then the operator deletes `deploy/ccrc-mail.token`.

## Next-wave brief

Wave 1 (run 320) is spec wave 1, part A. The brief is written once the plan is approved, and it names: the plan path
and part A's task range; the deviation block above; the claims to wait for; subagent-driven-development as the
execution skill; and the routing from the routing matrix.
