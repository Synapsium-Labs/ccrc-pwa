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
| 1 | 1, part A | Server authority and its files; the accept-set check; boot mint and recovery; the claim door and its census set; the `token-sync` agent op; the both-role writer | 320 | — | planned; deviation block 4388 to 4417 (30, shared with row 2); dispatch held on claims, see Carried constraints |
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
  read as behind. One item waits on the operator before run 320 is dispatched: the agent.env fleet marker (the
  plan's pending deviation). Numbers 4399 to 4417 stay reserved, written bare.
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
