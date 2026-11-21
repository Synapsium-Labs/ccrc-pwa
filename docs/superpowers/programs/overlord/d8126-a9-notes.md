# D-8126 wave A9: notes for the ledger

Wave A9 of `docs/superpowers/plans/2026-11-09-coordinator-autonomy-default.md` puts coordinator clause 21 back into a
coordinator's context after a compaction (the roster card's line, the role card's words) and tells the coordinators
already running, once (the rollout mail). It was built for the Overlord programme (#2491), run 3051. This note lists what
was ported from the unreviewed handoff stack, what was rebuilt, and every departure from the plan, each under a slug. No
D-number was minted for any of them.

Clause 21 is clause 21 on `main`'s `ccd/coordinator-skill/SKILL.md` ("This session decides by default and keeps
going."), so the roster line, the role text and the revision word all name it by that number.

## Ported, and re-tested on today's main

The stack's range for this wave is `c1c94a8c3`, `59fb9004d`, `7688c095b` and the fix `c2212bb8a`. Its last commit
(`3203be466`) carries no hunk for this wave's files.

| Task | What came over | Changed on the way |
|---|---|---|
| A9-1 | the line's exact text and its four tests (before the first run, forty runs, a field carrying the line, no runs and a child) | the line lives in the card's one builder, not in the hook (`roster-line-in-builder`); the card's cap made structural (`roster-cap-structural`); the wake arm's card pinned to carry it |
| A9-2 | both role texts, word for word, and the three tests that pin them (`session-hook-role-card`, `install-linear-skill`, `session-hook-anchor`) | the hook's comment rewritten for the new last clause |
| A9-3 | the L1 words and key (`rolloutKey`, `rolloutMailSubject`, `rolloutMailBody`), the operator's system mail through `queueSystemMail`, and the fix's durable reader (`hasMailWithSubject`, the mail row is never pruned) with the feed key as a second reader | rebuilt as a lane over the tick's listing (below) |

## Rebuilt

**A9-3, the rollout mail.** The stack ran one pass at server start from `index.ts`, told a worker from a coordinator by
whether another run named it as the worker, and ignored `mail-disabled`. Rebuilt:

- `server/src/coord/skillRollout.ts` (L1) holds `COORDINATOR_SKILL_REVISION` (`clause-21`) and `decideRollout`, which
  decides over literal facts: the mail switch, and per claimant its `.child` reading and whether it was told. A mutant set
  (`skill-rollout.test.ts`, nine mutants, all killed) holds it.
- `server/src/coord/skillRolloutLane.ts` (L4) holds `skillRolloutPass`, run by the watcher on its own `LANE_SCHEDULE` row
  (`skillRollout`: monotonic, single flight, every 30 s, stale after two minutes) over the tick's registry listing. It
  reads, queues and records; it decides nothing.
- Once a pass settles, the process marks the revision done and later beats return at once.

## Departures

| Slug | What and why |
|---|---|
| `roster-arming-is-the-server-switch` | The brief and the plan say the roster card is armed by `$REG/coordinator-roster-card-live`. On `main` that marker is retired: D-8274 arms the card by `"rosterCard":"live"` in the same `runs list` reply, the Shadow lanes row, and the hook no longer reads the marker (pinned by `session-hook-roster-card.test.ts`). Nothing here writes either; the line rides whatever arms the card. |
| `roster-line-in-builder` | The plan puts `ROSTER_AUTONOMY_LINE` in `ccd/session-hook.sh` and passes it to jq. On `main` the card's text has one builder, `ccd/lib/roster-card.jq` (D-8201, pinned by `single-definition/roster-card.test.ts`), so the line is a literal there (`roster_autonomy_line`) and the hook passes no new argument. A test pins that the line is one literal line with no interpolation and that the hook does not spell it. |
| `roster-cap-structural` | The card was not inside `ROSTER_CARD_MAX_CHARS - 64` in the structural worst case before this wave: the awaiting-you list was unbounded, and the "+N more" line was added after the run lines were admitted. A reply with 300 runs awaiting review produced 2,048 characters (the emitter's clip saved it). Now the collapse line is reserved before a run is admitted, the awaiting-you list collapses into "+N more" under what is left, and the joined card is clipped at the cap last. Each of the three, and the line itself, has a test that goes red without it (measured by in-place mutation). Card budget arithmetic: the header and the line are about 330 characters of the 1,984. |
| `rollout-on-a-lane` | The plan sends the mail "at server start". It runs as a lane on the tick instead, so it can read the tick's registry listing: the `.child` marker (the brief's worker rule) and `mail-disabled` (the brief's hold) both come from it, and a pass held by either asks again on the next beat. A start-only pass would have had no listing to read and would have lost every mail held by `mail-disabled` until the next restart. |
| `rollout-child-is-the-marker` | A worker is told apart by its `.child` marker as the registry reads it (`SessionRecord.child`), not by another run naming it as its worker (the stack's rule). An unreadable marker, or an id the listing refused, holds that claimant; it is never told on a guess. |
| `rollout-holds-on-mail-disabled` | While `mail-disabled` stands, or the registry cannot be listed, the pass queues nothing and records nothing, and is not settled. The stack queued regardless. |
| `rollout-unlisted-claimant-settles` | A claimant of an open run with no registry row gets no mail and does not hold the pass: there is no session to tell, and one revived later starts on the new cards (A9-1, A9-2). |
| `rollout-after-settle-is-quiet` | A coordinator that first claims a run after the pass settled gets no mail: it starts on the new cards. One that claims in the window before the first settled pass is told too, which costs one mail. |
| `revision-in-l1` | `COORDINATOR_SKILL_REVISION` lives in the L1 file, not in `shared/api.ts` (which sits at its growth cap): only the server reads it. A test pins that clause 21 of the shipped `SKILL.md` is the autonomy clause it names. |
| `rollout-no-index-call` | `server/src/index.ts` is not touched: the watcher's tick runs the lane. |

## Tests run (each file alone, through `ccrc test`)

`session-hook-roster-card`, `session-hook-role-card`, `session-hook-anchor`, `install-linear-skill`, `session-hook`,
`single-definition/roster-card`, `compact-card`, `session-hook-start-loads`, `session-hook-start-report`,
`skill-rollout`, `lane-schedule`, and the server typecheck.

## For the operator

An agent-lane deploy carries the hook and the builder (`ccd/lib/roster-card.jq` is installed beside the hook). The roster
card shows the line once its Shadow lanes row is live. The rollout mail goes with the server deploy that carries this
wave, once per running coordinator.
