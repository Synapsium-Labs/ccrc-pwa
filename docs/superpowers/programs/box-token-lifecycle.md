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
| 1 | 1, part A | Server authority and its files; the accept-set check; boot mint and recovery; the claim door and its census set; the `token-sync` agent op; the both-role writer | 320 | #330 | **IN REVIEW** 2026-10-08 17:18 UTC: wave-done at `f3d151e42` (mail 4023), re-measured; the bar is in the 17:18 entry; D-4400 to D-4409 spent. Was: DISPATCHED 2026-10-08 13:26 UTC to `ccrc-pwa-bright-mesa`; plan D-4388 to D-4399, worker reserve 4400 to 4409 |
| 2 | 1, part B | `ccrc token sync`; doctor `box-token` (PASS or SKIP only); the console card and the rotate route; `deploy.sh` stops shipping the token; notify's tolerance removed; README | — | — | to open before row 1 closes |
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
