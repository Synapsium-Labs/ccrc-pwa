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
| 2b | 1, follow-up | Part 2 of the arming plan: `retired-presented` clears when a rotation answers it (number 4552), then the flip, `_BT_ARMS_ON` 0 to 1, with the fresh-box classes (number 4553 if ruled). Bound: merged before row 3's first PR | 377 | — | **Run 377 open, planned** 2026-10-11 00:42 UTC, before run 370 closed. waits on: part 1's merge; the operator's Decisions 1 and 2; the operator's ruling on the GPT-lane Plan 4 soak (`ccrc-pwa-clear-mesa` recommends accepting `box-token` WARNs by name on the sampler's doctor baseline; the window closes about 10-21 10:31 UTC); rulings on residue 8(a) and R-i; claim 1141 |
| 3 | 2 | The weekly schedule; the agent link token by the same code-then-HTTPS claim | — | — | later |
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
- **Model auto-advance is not this programme's.** The operator assigned it to `ccrc-pwa-clear-mesa` at 11:25 UTC. The
  shared operator-window marker that coordinator proposed is off by the 13:28 ruling.

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
