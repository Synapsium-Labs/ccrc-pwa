# Overlord W1, door process B1: notes for the ledger

What door process B1 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-door-process.md`, Tasks 7 and 9) found while
building, for the coordinator to fold into the programme ledger. Each departure is named by a plain-words slug; no number
is taken here.

## The brief's binding carries

1. **F2-a, the witness recorder answers whether it spent.** `OverlordGateDeps.recordWitness` returns whether the check was
   written; `overlordGateRun.ts`'s spend reads that answer, so a not-spent answer refuses the write at step 7a (503
   `unavailable`), as a throw already did. The order stands: the guarded counter advances first, then the witness is spent;
   a counter that cannot advance leaves the witness unspent. Red case in `overlord-gate-run.test.ts`.
2. **F3-a, snapshot rows, not counts.** The doors suite's multi-page last-page refusal compares the snapshot rows themselves,
   so a snapshot written before the fence reds it.
3. **`continuity-v1`** (gates B's R1): it joins `SERVER_CAPS` in this PR, in its own commit after the binding and its cases
   (the witness ports in `continuity/witnessPorts.ts`, the recorder's answer, the latch). Its readers are gates B's step 2 and
   the designation doors' `DESIGNATE_SERVER_WORDS`, so from this merge a designated Overlord's start doors pass step 2 and the
   operator may designate and rebind. The witness itself still reads `unmeasured` (502, nothing counted) until the fleet's ccd
   advertises `door-witness-v1`, so a server updated before the fleet refuses Overlord writes and fires no latch.
4. **The key's consumer checks designation and term.** Confirmed in gates B's runner, unchanged here: step 1
   (`callerStandingOf`) refuses a caller that is no longer the designated session (`not-the-overlord` at a write-only door;
   a start door serves another session the hook's way and never consumes its key), and step 5 (`fenceVerdict('term', …)`)
   refuses a write whose live generation's term is not the designation's (`stale-designation`). Both have red cases already:
   the standing cases in `server/test/sim/gateSets.ts` (run by `overlord-gate.test.ts` and its mutation floor) read another
   or a no-longer-bound id as `other`, and the term cases there and in `overlord-gate-doors.test.ts` (each write door at an
   older term is 409 `stale-designation` at step 5, writing nothing). B1 adds none and binds nothing there.
5. **The Overlord's forms name the doors, not `ccrc-api`** (door A2's `card-body-still-names-ccrc-api`). The Overlord's card
   body is still one line until W1's card ships (`card.ts#CARD_OVERLORD_LINE`), so it holds no `ccrc-api` wording to change.
   The two renewal mails did: `renewalFeed.ts#RENEWAL_MAIL_OF_ROLE` now chooses the handover ask's and the spot round's
   bodies by role, as `FIRST_PROMPT_OF_ROLE` chooses the first line, and the Overlord's name its note handover door and its
   probe door. Its mutant set rides `firstPromptSets.ts` (slug `renewal-mails-by-role`).
6. **The Overlord's urgent mail through the door's mail act.** Neither Task 7 nor Task 9 covers it, so it is not wired here;
   it is on the carries list (the coordinator's ruling; slug `urgent-mail-arm-is-a-follow-up`).
7. **The live restart measurement** (door A2's departure 2): unmeasured, and it carries (the coordinator's ruling). See
   "Live steps" below.

## Departures

- **`witness-header-stays-in-continuity-door`**: the plan lists `WITNESS_KEY_HEADER` in `shared/continuity-reports.ts`; gates
  B already put it in `shared/continuity-door.ts` beside the act headers, so it stays there and the reports file names it.
- **`refusal-row-in-spec-table`**: `unknown-message` (404) joins the W1 group. The refusal-table data's `codeOnly` list may only
  shrink, so its Table 11.6 row is added to the spec instead.
- **`pickup-port-always-built`**: the composition root always passes the pick-up port; with no private store open it answers
  502 `unmeasured`. `unavailable` is only reachable on a hand-built server that omits the dep.
- **`witnesses-for-optional-now`**: `witnessesFor` takes an optional `now`, so it applies the keep itself.
- **`witness-deny-tested-through-a-hook-copy`**: no real deny arm names a `mcp__door__*` tool, so the "a denied call sends no
  witness" case injects a deny arm after the last real one in a temporary copy of the hook.
- **`read-row-has-no-verb`**: the `read` tool has `verb: null` and runs the argv builder of the reader row it names;
  `door-tools.test.ts` exempts it from "every verb is a ROUTES key" and pins the null.
- **`read-enum-omitted-when-empty`**: with no reader rows, the `door` field carries no `enum` (an empty one is invalid JSON
  Schema) and its description says no door is readable yet.
- **`witness-null-without-jq`**: if jq cannot run in the door process, the call goes without a witness key, which the gate
  reads as unwitnessed: it fails closed.
- **`nudge-pattern-has-no-regex`**: the hook's nudge-line match uses `startswith`/`endswith` and a code-point digit check (no
  Oniguruma), and takes only a canonical positive safe integer.
- **`readers-clear-on-bg-zero-regardless-of-roster`**: `readers-clear` is sent on every main-turn Stop with a measured
  background count of 0, even when the hook's own roster was already empty, so a lost stop heals.
- **`hookstate-equality-by-comparison`**: "hookstate unchanged by a report" is pinned by comparing the state file with and
  without the door hash after the same events (timestamps zeroed), since the event itself rewrites the file.
- **`read-ledger-caller-is-a-role`**: `read_ledger.caller` is `overlord`, `reader` or `operator`, never a session id, so
  `readsBetween` takes callers and the probe door counts `overlord` and `reader` lines between ask and answer; `covered` is
  true only for the designated session (`identityOf(...) === 'overlord'`), so a coordinator stays uncovered.
- **`off-model-reads-modelswitchesof-on-the-store`**: the ladder's input reads switches through `CoordStore.modelSwitchesOf`,
  because the coord ring may not name `coord.db`; absent, it reads unmeasured.
- **`off-model-window-on-the-server-clock`**: the switch window starts at the generation's start row's `receivedAt` (the
  server's clock), read through `CoordStore.modelSwitchesOf(sessionId, startId)`; a missing or unreadable start is a failed
  read (unmeasured, never lifted). The first build floored it at `startReportedAt`, the hook's clock, against rows windowed by
  `receivedAt`: a hook clock ahead of the server's could hide a switch and read the condition lifted (fail open). An automated
  security review of the commit flagged it; fixed in its own commit with a red case.
- **`off-model-measured-difference-outranks-unmeasured`**: a measured class difference answers true even beside an unmeasured
  input; otherwise an unknown start class or a failed switch read is unmeasured.
- **`witnessed-key-not-stored`**: `continuity_witness_checks.witnessKey` is always null: the key is a call digest and nothing
  reads it back.
- **`witness-precedence-used-first`**: when several witnesses fail for different reasons, the verdict's reason is `used`, then
  `before-generation`, then `stale`, then `reader-scope` (stated in `hookReports.ts` and tested).
- **`latch-raised-under-the-callers-actor`**: the latch is the server's act, but the ladder's brake takes only an actor the
  identity adapter minted, and the server has none of its own (`actorOf('ccrc server', '')` is refused). So `WitnessCheck`
  carries the attributed caller's actor and the latch row's `raisedBy` names the designated session whose writes were counted;
  its detail names the count. A follow-up: a server-brake actor kind for latches the server raises.
- **`core-vocab-four-holders`**: `unwitnessed` is spelled by the gate, `hookReports.ts`, `hookReportStore.ts` and
  `witnessPorts.ts` (the recorded outcome), and the core-vocab pin lists the four.
- **`report-door-not-an-overlord-row`**: the report door is a fleet-wide box-token lane, not an Overlord door, so it joins
  `overlordDoors.ts#NOT_OVERLORD_DOORS`, as the start report does.
- **`witness-test-shared-db`**: `continuity-witness.test.ts` shares one fixture `coord.db` and drops tables by renaming them; a
  fresh database a case ran past the timeouts on the fleet box.
- **`shared-api-one-line`**: the plan gives `shared/api.ts` 0 lines in B1; `continuity-v1` costs one code line (the map row, the
  union widened in place), within its cap (5127 of 5140); the coordinator accepted it.
- **`off-model-reading-is-l1`**: `overlordLadder.ts#offModelReading` maps the answer to a condition reading (decide in L1).
- **`off-model-replay-reads-not-passed-in-w1`** (the plan's slug): a measured off-model reads `standing`.
- **`report-keep-is-its-own-seven-days`**: `REPORT_KEEP_MS` (seven days, the plan's starting value) joins the seven-day
  holders in `token-shared.test.ts` as the nineteenth separate quantity, by the coordinator's ruling (2026-11-20, run 2832).
- **`pickup-owner-check-is-not-a-binding`**: the report door's picked-up arm compares a message's addressee with the
  reporting session. No run is read, so `runSessionCensus.ts`'s `NOT_BINDING_SITES` names it. That file was held by the
  capacity Task 1 worker, who consented to the one additive row.

## Residuals

- **`closed-book-reads-the-ledger`**: nothing in `server/src` writes the read ledger in W1 (`recordRead` has no caller), so
  `reads` is 0 until board and history B's read doors write it. Until then a covered, measured session with no card or notes
  read between ask and answer answers `closed`. The timer list door is not a ledger reader either.
- **`closed-book-route-wiring-untested-end-to-end`**: the designated session's probe answer passes gates B's fence, which no
  fixture can present, so the probe route's ledger wiring (three lines) is covered by `bookOf`, `ledgerFactsOf` and the store's
  `readsBetween`, not by a route case.
- `readersRunning` and `modelDriftOf` ship tested and unwired: the renewal readings piece wires them into `renewalInputsOf`.

## Live steps

- **The restart measurement** (door A2's departure 2, whether Claude Code restarts a dead door process): **unmeasured, and
  it carries.** The test box read off (no box, the admin link not connected), so it could not be measured there, and it was
  not rerouted to a scratch session on the fleet box (the session hook refused that route for A2). Until it is measured, a
  dead door process means no doors until the session's next start.
- **Task 7 Step 5** (the hook's key and the door process's key agree on the pinned build, and the `_meta` tool-use id as a
  fallback): measured in the suites, not live. `session-hook-door-reports.test.ts` runs one fixture input (a large integer, a
  float, a unicode escape and keys out of order) through the hook's arm and the door process's `witnessKeyOf`, and the two
  keys are equal; both canonicalise through the same `jq -cS`. The live step on the pinned build carries with the restart
  measurement, for the same reason.

## Carries (the coordinator's list)

- The Overlord's urgent mail through the door's mail act.
- A server-brake actor kind, so a latch the server raises names the server (`latch-raised-under-the-callers-actor`).
- The live restart measurement and Task 7's live key check, on the test box once it is up.

## For the coordinator

- **README** (item 486, the operator's yes): run 1850's holder consented (mail 27083) to this PR's two additive hunks, built
  against `main` at 963286cc9: the auth paragraph's machine-lane count word, ninety-two to ninety-three, and the continuity
  doors sentence naming the report door. Run 1850 keeps its claim on README.md; the consent covers this packet only.
- **Migration**: 110 by position on this branch; approvals PR 3 builds on 110, so this becomes 111 at the absorb.

## Measurements

- **Growth**, armed, against the merge base (`growth-check.test.ts`, 97/97): `ccd/session-hook.sh` +18 (the plan's figure 22),
  `server/src/coord/schema.ts` +7 (24), `server/src/server.ts` +3 (4), `ccd/ccd` +1 (1), `ccd (program)` +1 (1), `ccd/ccrc` 0,
  `shared/api.ts` 5127 of its 5140 cap (+1, accepted). No waiver.
- **Mutant sets** (floor 1, every mutant killed): `hookReportOf` 20, `witnessVerdict` 15, `unwitnessedLatchDue` 7, `offModelOf` 8,
  `modelDriftOf` 6, `readersRunning` 8, `offModelReading` 6, `bookOf`'s new arm 10 and `ledgerFactsOf` 4, `RENEWAL_MAIL_OF_ROLE` 9.
- **Hand mutations, each red and restored from a saved copy, sha-checked:** in the hook, the witness ignoring a deny, the door
  hash gate and the child gate removed, five loosenings of the nudge-line match, `readers-clear` on any background count, the
  report bound changed, the send not under `_hook_timeout`, `agentId` always carried, `jq -S` dropped; in the client, the
  witness header for a non-hex key, the key left exported, the header renamed; in the door process, no witness key passed, the
  key kept in the child's environment, `read` serving unmarked rows, the pre-image's newline and `-S` dropped; `door-witness-v1`
  removed from `cmd_caps`; the report door's `not-owner` on another session's message, and the store's prune; the card door's
  `insertSnapshot` moved before the `card-record` ask (F3-a: the row compare reds it, a count compare does not); the off-model
  floor at the hook's clock; the Overlord's renewal mail swapped to a coordinator's.
- **The 38-case characterization** (`start-doors-characterization.test.ts`) passes 38/38 behind the bound witness, unchanged.
- **Load timeouts, green alone or red on `main` too:** `coord-db`'s migration-failure sweep times out at its 120 s bound at
  load 15 to 17 on this branch and on a `main` snapshot alike (126 s there); its delegation-lease case timed out in a batch and
  passes alone. `deviation-refs`' two-tree scan timed out once in a batch and passes alone (34/34).
- **Not run here:** the ccd suite for account sign-in, one of the suites that hold `CCD_CAPABILITY_TOKENS`: the session hook
  refused the call, because its text names an account act, and it was not rerouted. The tests-inclusive type check is
  OOM-killed in the test slice; the server's own type check is clean. CI is the arbiter of both.
- **The first full run (at fd573aad6) was red**, and every red was this change's guard pins:
  - the `degradedReading` mutant set's four old texts occurred twice, because `offModelReading` repeats its gate lines;
  - the client's route count;
  - the witness key's environment row in the settings census;
  - the run/session census row above;
  - the seven-day holder above;
  - a readonly array in the witness test, which only the tests-inclusive type check sees.

  All six were fixed in one round, and each suite passes alone. The tests-inclusive check passes over B1's test files in a
  narrowed project. `storybook-a11y` failed on the runner's apt install, which this change cannot reach.
