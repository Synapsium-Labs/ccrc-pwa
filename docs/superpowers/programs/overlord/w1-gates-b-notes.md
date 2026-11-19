# Overlord W1, gates B: notes for the ledger

What gates B (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-gates.md`, Tasks 4 to 6) found while building, for the
coordinator to fold into the programme ledger. Each departure is named by a plain-words slug; no number is taken here.

## The brief's binding carries

1. **Order and witness** (`op-key-slot-after-the-fence`). The runner reads the fence's facts, then the witness: step 7a sits
   right after step 7, as ruled. W2's operation-key lookup is not built here (its port, its arm `opKeyVerdict` and its hash
   over the door, the path parameters and the body are the act rows piece's); the runner marks its place with the anchor
   `server/src/coord/overlordGateRun.ts#@op-key-slot`, between the fence read and the witness read. The witness key rides
   `x-ccrc-witness-key` (`shared/continuity-door.ts#WITNESS_KEY_HEADER`, added here beside the act headers), and the runner
   hands it to the witness port. An unreadable witness store, and the default binding until door process B binds its reader,
   answer 502 `unmeasured` and record nothing. A refused `stale-generation` write is recorded in `overlord_fence_refusals`.
2. **The act counter.** Door process A's `continuity_act_keys.counter` and its writer `advanceActCounter`, reached only through
   `overlordGateStore.ts#advanceCounterGuarded`, which reads the generation's state in the same transaction and answers
   `ended` for an ended or missing one. It adds no column and writes none itself.
3. **The port is honest.**
   - `identity.operator()` takes only an actor the account gate minted: `accounts/audit.ts#gateActorOf` mints it (an
     `actorOf` actor recorded in a second set), and `accounts/gate.ts` is its one caller in `server/src`. The server's own
     `actorOf('ccrc server', '')`, a step-up audit row's actor and a test box's throw (slug `operator-takes-only-gate-actors`).
     `gateActorOf`'s actor is also a minted actor, so every audit writer takes it as before.
   - The designation writers' `actorRefused` already requires issuer `account-gate` (gates A's F5, `isAccountGateOperator`);
     the case that a genuinely minted console actor is refused is gates A's, kept.
   - The door census reds an operator door that skips the identity port, not only a door with no row.
4. **One console mapping** (`console-results-are-minted`). `attributionIdentity.ts#consoleSubject` is the one owner of the
   console answer's text: `flag-off` dark, `unmeasured` with no device, the device actor's subject signed in. `console()`
   now mints its three answers (frozen, held in a private set), so a hand-built `{ kind: 'dark' }` is no answer and maps to
   `null`, which the rank door refuses (`internal`) and the ladder's brakes refuse (`actor`). `server.ts`'s `consoleActor`
   helper, whose callers take a string, records `unmeasured` for that `null`, never `flag-off`; it cannot occur there,
   since the helper hands `consoleSubject` the port's own answer (review 2803 N2). Its callers: the rank
   door, the ladder's brakes (`ladderActor`), and one `consoleActor` helper in `server.ts` that the renewal operator doors,
   the decision-model doors and the responses doors share (three copies of the same mapping there before).
5. **The renewal operator doors** (`renewal-doors-record-through-the-console-arm`). `POST /api/sessions/:id/renew` and
   `GET`/`POST /api/coord/renewal-mode` stay in `NOT_OVERLORD_DOORS`: they are fleet-wide W1a continuity doors, not Overlord
   routes, so they take no row of the Overlord door table. Their actor now comes through the port's console arm and its one
   mapping (`operatorActor: consoleActor`), so the text they record is the port's.
6. **The authority journal A review's F3** (`authority-f3-residual-unread-by-w1-doors`). Recorded as a residual: every W1
   Overlord door is a start door (`card-probe-note`), which skips step 3, so no W1 door reads the authority guard. The window
   is the guard's own: from a rolled-back head row with a narrowing record left past it until the next append or boot. The
   first non-start Overlord door (W2's) reads step 3 and inherits that window unless the journal closes it first.
7. **Renewing at the card door.** A card record (the card's recording page, a write whose act is `read`) by a pending body
   (`designated-pending`) refuses `renewing` at step 9's place and writes nothing; the new term reads the card afresh. A
   pending body whose incarnation is not recorded yet refuses `renewing` at step 1 at every door, the card included.

## Departures

- **`gate-store-reads-coord-db`**: the gate store's three functions take `coord.db`, as the claim door reaches
  `actKeyStore.ts`, so `CoordStore` gains no delegate and `store.ts` is not edited (the plan estimated +3).
- **`act-key-compared-in-the-gate-store`**: the key comparison (`actKeyFact`: sha256 of the presented key against the stored
  digest, with `timingSafeEqual`) lives in the gate store beside the counter, and answers the stored counter with it, so the
  runner reads the row once.
- **`fence-why-on-the-verdict`**: `FenceVerdict` and `GateVerdict` carry the fence's reason word (`why`) beside the detail, so
  the runner records `overlord_fence_refusals.why` without parsing a detail.
- **`gate-reads-and-standing-verdict-are-l1`**: which facts a door reads (`gateReads`), whether the incarnation is asked
  (`incarnationNeeded`) and step 1's early answer (`standingVerdict`) are small L1 deciders, so the runner holds no branch
  over a door class or a standing.
- **`ended-generation-reads-renewing`**: step 9 also reads an `ended` generation as `renewing` (the live read excludes ended
  rows, so it cannot arrive today; it fails closed if it ever does).
- **`gate-dep-optional-fails-closed`**: `ContinuityRouteDeps.gate` is optional. The composition root always passes it; a
  server built without it answers `unavailable` at every start door, as for an absent store. Required, it would have changed
  the suites that build the continuity routes by hand for doors they never call.
- **`continuity-v1-not-yet-held`**: `SERVER_CAPS` does not hold `continuity-v1` (W1a's last piece adds it), so a designated
  Overlord's calls at the six start doors refuse `capability-missing` at step 2 until it lands. A coordinator is answered
  `hook` at step 1 and never reaches step 2.

- **`witness-record-decided-in-l1`**: what the runner records for the witness (`used` with its id on a pass, `unwitnessed`
  with its reason on a refusal at step 7a, nothing for an unmeasured witness) is `overlordGate.ts#witnessRecordOf`, so the
  runner spells no gate word and `unwitnessed` has one `server/src` home (the core-vocab pin).
- **`gate-words-admitted-by-a-derived-guard`**: the gate's own kebab words (a standing, the fence's and the witness's reasons,
  what the runner records, the facts' arms) are admitted to the coordination kebab census through
  `overlordGate.ts#isOverlordGateKebab`, built from that decider's maps, each checked against the union it spells where one
  exists. The census's holder (approvals PR 2) agreed the one additive line.
- **`stale-designation-has-three-holders`**: the plan says `stale-designation` is spelled only in `overlordGate.ts`. The
  private store's prompt door already spells it (`operatorModel/messages.ts` and the prompt route in `server.ts`), so the
  core-vocab pin holds those three exactly. `stale-generation`'s pinned holders are the gate, the claim door
  (`continuity/actKey.ts`, `continuity/routes.ts`), the delegation lease's two files and `retire.ts`.
- **`forged-card-read-on-a-one-page-card`**: a forged card read (attributed, no act key) of a one-page card meets the
  recording page's fence on page 1, so it is answered 409 `stale-generation` (counted in `overlord_fence_refusals`) rather
  than served; a longer card serves every page but the last. Either way no card read is recorded, as ruled.
- **`gate-test-fixture`**: `server/test/overlordGateFixture.ts#hookGate` is the real runner over no designation, for the
  suites that build the continuity routes by hand; every Overlord fact port throws there.
- **`fixtures-mint-through-the-gate`**: the fifteen test files that mint a fixture operator for `identity.operator` now call
  `gateActorOf`, with the same arguments and the same subject text; no assertion changed. Two of them were held by other
  runs, whose holders agreed the edit (polish WM1 and approvals PR 2).

- **`overlord-cases-move-behind-the-gate`**: four existing cases drove the bound Overlord, or an unmeasured designation,
  through a start door and now meet the gate first. In `continuity-notes-route.test.ts`, the bound session's note is
  refused by the gate (its fixture registry holds no incarnation, so `not-the-overlord`) and writes nothing; which
  generation a passing note records stays pinned by `live-generation.test.ts`. An unmeasured designation now answers
  503 `unavailable` at the gate on a note and on a handover, as question 13 rules, where it answered the door's 502
  `unmeasured` before. In `continuity-card-route.test.ts`, the two anchor cases of the designated session test what the
  card door reads after a pass, so they build the door with `overlordGateFixture.ts#passGate`; their assertions are
  unchanged. No fixture can present a real pass today (`continuity-v1` is not held, and the witness is unbound).

- **`gate-reads-the-designation-fact`** (the first fast run's ARCH-62 census red): the decider first matched the caller
  against the binding and the pending attempt itself, two new run/session equality sites. It now asks
  `roleOf.ts#designationFactFrom` and `designationFactOf`, the one owner of a session's place in the designation (pure L1,
  L0 imports only), and adds only the incarnation from the row. So `overlordGate.ts` has one more runtime import than the
  plan's "the ladder's deciders only", and the census holds no new site. Two mutants of its set moved to the new text.

## The first fast run (PR #3076 at `5223a6bb6`)

Red in three server shards. Two were this PR's and are fixed in the next push: the ARCH-62 census (above), and
`plan-ticket-done.test.ts`, a fixture that main's WM1 (#2997) added with `actorOf`, which the absorption brought in and which
now mints through `gateActorOf` like the others. The third, `ccd-harness-integrity`'s "no override names a function nothing
ships", hit its 20 s budget on CI and passes alone here (13/13). `horkos` blocks on `proof-not-built` only (a non-author
unblocks it; nothing in the PR fixes it), and routes on `test-edited` and `test-weakened`, which are the four restated
cases above.

## Fix round 1 (review 2803)

- **F1, the binding is read first** (slug `gate-reads-the-binding-first`): fixed in `overlordGate.ts#placeOf`, not in
  `roleOf.ts#designationFactOf`, because one of that owner's callers does not agree: the private store's message keys
  (`noteKeys.ts`) read a row whose pending attempt names the bound id as a pending body, and
  `continuity-notes-message.test.ts` pins that ("pending first"). So `placeOf` asks the same owner twice: first with the pending
  attempt set aside (the binding), then as it stands (a pending `designate` attempt). No new run/session equality site. The
  gate's standing cases hold the row for a rebind and a designate attempt, and a mutant of its set (S-12) reads the pending id
  first and is killed. `roleOf.ts` is unchanged.
- **F2, the counter before the witness** (slug `counter-then-witness-spend`): a passing write runs the guarded counter's
  compare-and-set first, then spends the witness; a counter that cannot advance leaves the witness unspent for a retry, and a
  spend whose recorder throws refuses the write 503 `unavailable` at step 7a (`overlordGate.ts#spendVerdict`). They are not one
  transaction: the spend is door process B's writer, behind its own port. That departs from the plan's runner order (Task 5,
  item 6), as ruled.
- **F3, a refusal writes nothing** (slug `card-record-asked-before-any-write`): the card door asks `card-record` before
  `insertSnapshot`, when the page would complete the Overlord's read (read off the memo as it stands), and records the read
  only behind a fence that passed. The doors suite asserts all five tables unchanged on every refusal, with no exemption.
- **F4**: the bound session's note-generation pin is back, through `passGate()`, beside the 403 case, and the door's own 502
  `unmeasured` arm has a case again (a coordinator whose generations cannot be read).
- **F5**: the gate census scans every file an `overlord` row may name, and tells the runner's call from the account gate's.
- **R1, ruled: no `continuity-v1` before door process B.** `continuity-v1` joins `SERVER_CAPS` only in, or after, the pull
  request that binds the witness. If the order were broken, a designated Overlord's every write door, and the last page of
  each card it reads (the recording page, a write), would refuse 502 `unmeasured` at step 7a.
- **The card record by a pending body** gets its own slug, `card-record-pending-reads-renewing` (the coordinator's ruling,
  carry 7): spec §11.2 lets the card skip step 9, and this one arm, after step 7a, refuses a recorded read under a pending term.
- **Nits**: N1, a write with no live generation refuses through the fence decider; N2, unreadable server words answer
  `unavailable` at step 2; N3, a thrown witness lookup's message never reaches the detail; N4, an unread authority is its own
  arm, `start-door`; N5, the runner's header says what it branches on; N6, a fence refusal that cannot be recorded logs one line
  naming the door and the reason word; N7, the census checks the recording call's form; N8, `FACT_ARM_MAP` is checked against
  the unions it spells, and a stray comment went.
- **The round's mutations**, each red, each restored from a saved copy and sha-checked: the witness spent before the counter
  (two cases), a spend whose throw reads as success, the card record asked after the snapshot (the doors suite and the census),
  the witness lookup's message back in the detail; and in `mutation-floors`, S-12 (the pending id read before the binding).
  Two older mutants of the decider's set (O-6, O-7) moved to the new text of steps 2 and 3. A shell hook refused one call of
  the test subagent, a bare `vitest --version` probe outside `ccrc test`; it was reported and not retried in any form.
- **The fix round's fast run** (at `17300375f`) was red on one guard, `typecheck-tests`: the first-refusal oracle in
  `sim/gateSets.ts` still read the server words and the authority as their old types, which N2 and N4 widened. The oracle now
  reads both new arms, the generator draws unreadable server words, and the unmeasured-never-passes property swaps them. The
  tests-inclusive type check, run here once, reports nothing in the server or its tests (only `agent/`, whose `ws` is not
  installed in this worktree). The session hook's heavy-test arm then refused a commit call whose message named that guard,
  and the first report of it too; nothing ran. It was reported, and on the coordinator's ruling the commit was made with its
  message in a file.
- **N9, a follow-up for the coordinator**: `coord/routes.ts` still holds about ten older copies of the console mapping
  (`authEnabled ? deviceActor(...) : 'flag-off'`), and `continuity/routes.ts` two `?? 'flag-off'` fallbacks. They do not call
  the port; `coord/routes.ts` is held by another run's frozen claim, so this PR leaves them. They are the next place
  `console-results-are-minted` would reach.

## For the coordinator

- **Migration 109**: main took 106 (programme work map WM1, #2997), 107 (the Linear wave 4 follow-ups, #3021) and 108 (the
  mid-turn mail PR 2, #3073), so this PR's table is 109. It was renumbered at three absorptions of `main`, each on the conflict
  probe and under the brief's standing license, with every conflict an additive migration, pin or census line. The second
  gave the fix round's PR a merge ref for its fast run; the third followed the coordinator's mail naming 109. The mid-turn mail
  PR 2's holder agreed the four additive co-edits (schema, the two version pins, the rollback fixture, the floors).
- **Local measurements the box could not make**: the floors suite's two `pwa/src/face/mood.ts` sets fail to load here
  (`@ccrc/ui` is not installed in this worktree's `pwa/`), and `secret-mask`'s "typed slowly" case is the known local timing
  red (door process A1's notes measured it red on a clean `main`). The whole tests-inclusive type check is OOM-killed in the
  test slice on some runs; its one completed run here reported diagnostics only in `agent/` (no `ws` install in this
  worktree's `agent/`), none in the server or its tests. CI is the arbiter of all three.

## Measurements

- **Characterization first**: `start-doors-characterization.test.ts` (38 cases) was committed green against `main`'s doors
  before any door changed, and stays green, unchanged, behind the gate.
- **Mutant sets** (floor 1, every mutant killed): `callerStandingOf` 11, `fenceVerdict` 12, `counterVerdict` 8,
  `overlordGate` 18.
- **Hand mutations**, each restored from a saved copy and sha-checked, each red:
  - the decider: steps 5 and 6 swapped; the effective rung read at step 4; `other-incarnation` served the hook's way; a start
    door skipping step 7; `pending-unrecorded` read as `designated-pending`; `not-above` mapped to pass;
  - the store and the runner: the `ended` read dropped from the guarded counter; the fence record skipped on a fork; the
    witness default bound to `witnessed`; the incarnation read before the standing;
  - the doors: the gate call deleted from the handover door; `card` passed from the notes write door; the `return` dropped
    after a refusal at the probe answer (the census reds it; the doors suite cannot see it); the card read recorded before
    asking `card-record`; `card-unread` spelled in `routes.ts`;
  - the identity port: `operator()` taking any minted actor; `consoleSubject` taking an unminted answer.
- **Load timeouts, green alone**: `coord-db` ran 147/149 with two cases timed out at load 11 to 14 (the migration-failure
  sweep at 157 s against its 120 s budget, and a delegation-lease case at 27 s), and both passed alone; the timers and backstop
  route suites timed out the same way in a batch and passed alone (41 and 11).
- **Growth**, armed, against the merge base: green (97 cases); raw lines `server/src/server.ts` +31/-6,
  `server/src/coord/schema.ts` +21, `server/src/continuity/routes.ts` +30/-13; `store.ts` untouched.
