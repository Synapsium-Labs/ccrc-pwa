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
   `null`, which every caller refuses: the rank door answers `internal`, the ladder's brakes `actor`. Its callers: the rank
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

## For the coordinator

- **Migration 106**: main ends at 105 (#3056). The mid-turn mail PR 2 holds 106 in its own merge; whichever lands second
  renumbers (its holder agreed the four additive co-edits: schema, the two version pins, the rollback fixture, the floors).
