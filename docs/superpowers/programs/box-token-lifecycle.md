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
| 2 | 1, part B | `ccrc token sync`; doctor `box-token` (PASS or SKIP only); the console card and the rotate route; `deploy.sh` stops shipping the token; notify's tolerance removed; README | 350 | — | **DISPATCHED** 2026-10-09 06:50 UTC to `ccrc-pwa-brisk-basin` (8 items: R0, then B1 to B7; route Opus·high / Sonnet / workflow off / compact 40; worker reserve 4551 to 4560). Was: **Run 350 open, planned** 2026-10-08 17:21 UTC, before run 320 closes. Deviation block 4551 to 4570 (bare until defined). Dispatch waits on #330's merge, and on the I3, I4 and sec-M2 rulings |
| 2a | 1, follow-up | The arming PR: flips doctor's `box-token` FAIL and WARN arms on. Trigger: the GPT-lane lane-1 B4 soak gate recorded closed. Bound: merged before row 3's first PR | — | — | later |
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
