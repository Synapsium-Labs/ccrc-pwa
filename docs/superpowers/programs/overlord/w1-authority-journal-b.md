# Authority journal B: the builder's departures

These are the builder's notes for PR B of the Overlord W1 authority journal plan
(`docs/superpowers/plans/2026-11-14-overlord-w1/w1-authority-journal.md`), Tasks 5 to 7: the witness tuple, the epoch and the verdict; the exchange over the agent link and the console; the ladder's two cause rows.
Each departure from the plan's text, or ruling added after the plan was written, is named by a plain-words slug, never a D-number, so
the coordinator can allocate numbers when it folds them into the plan.

## Departures

- `witness-carries-told-narrowings`: the tuple carries a `told` field, the operator's rung and the standing latches as of the tuple's
  epoch (latches sorted by cause, each cause once). A later Confirm can then keep a narrowing the operator was told took effect. The
  coordinator ruled this after the plan was written, so the plan's interface lacks the field.
- `privacy-empty-is-its-own-word`: the tuple's `privacy` is `WitnessHead | 'absent' | 'empty'`, and the port answers `empty` beside
  `absent`. The plan's port answers `absent` for an unwired journal, but a wired journal can hold no record, and folding the two into one
  value would be an overloaded null. A witness holding `empty` contradicts no head the server reads; a witness holding a head against a
  server reading `empty` is a `witness-heads` mismatch.
- `negative-term-reads-unmeasured`: an epoch term below zero (a journal shorter than the last Confirm says it was) answers `unmeasured`,
  never a clamped zero, because the epoch cannot then be measured as a count of records since the base. The verdict reads it as
  `unmeasured: journal`.
- `told-and-offer-answers-are-typed`: `currentWitnessTuple` answers `{kind: 'tuple'}` or `{kind: 'unmeasured', why}` instead of a null,
  and it parses its own tuple back before offering it, so a tuple the console would refuse is never sent.
- `rows-4-and-5-are-exclusive`: the plan's row 4 (base below) and row 5 (base above, or equal with a higher term) cannot both match, so
  a literal swap of the two is an equivalent mutant. The mutant set instead moves the term comparison ahead of the stale row, which the
  suite kills with a witness whose base is below the server's and whose terms are higher.
- `row-3-order`: when several server facts are unmeasured, the authority journal is named first (`journal`), then the privacy read
  (`privacy-head`), then an epoch that is unmeasured on its own (`journal`).
- `off-volume-holds-under-this-boot`: a holder under this boot still holds a narrowing off the volume, so `offVolumeHeld` takes no
  boot nonce (the plan's signature); only `witnessVerdict`'s `counts` asks whether a restore is ruled out.
- `witness-rungs-spelled-in-l0`: `shared/authorityWitness.ts` spells its own rung list, because L0 files import nothing. The server's L1
  witness file holds a compile-time mutual-assignability check against the ladder's `Rung`, and the suite checks the two runtime lists
  are equal and in the same order.
- `held-for-compares-authority-sequence`: the ladder's `NarrowingWitness.heldFor(recordSequence)` asks `offVolumeHeld` with each
  counting holder's authority head sequence in place of its epoch (`offVolumeHolders`). A record's own epoch also counts privacy
  records appended before it, which the server cannot recover; the authority sequence is exact, and the digest check that made the
  holder's verdict `consistent` proved the same chain. Only holders whose base equals the server's count.
- `ready-witness-five-words`: the ready field reads `tuple`, `nothing`, `unmeasured` (the agent's file is unreadable or malformed),
  `absent` (an older agent) or `malformed`. The exchange judges `absent` as holding nothing and `unmeasured` as malformed, so neither
  refuses nor counts, as the plan's failure table says.
- `ready-always-sends-field`: the agent always sends `authorityWitness` (a tuple, `null` or `'unmeasured'`), read fresh at each ready.
- `link-malformed-on-op-error`: the server's op adapter (`witnessLinkOver`) maps an agent op error other than `bad-request` to
  `malformed`; `bad-request` is `predates-op`, an unsent frame `unsent`, a timeout or drop `lost`. Each leaves the last answer standing.
- `claude-md-safety-sentence`: the account-deny suite holds every deny-list path named in `CLAUDE.md`'s SAFETY section, so one
  sentence there names `~/.ccrc/authority-witness.json` (no session edits it; a read stays open).
- `ops-order`: the agent lists `witness` before `overlord-history`, which it appends conditionally after the literal list.
- `api-returns-raw`: the console's `overlordWitness` call returns the server's JSON and throws its refusal, as its neighbours do; the
  witness client builds its own `offer | refused | malformed | failed` answer, so `pwa/src/lib/api.ts` grows by four lines.
- `page-clock-injection`: the console client reads visibility through `lib/pageClock.ts` (the one owner of the page's visibility
  listener), never a second listener.
- `signed-in-by-shell`: the app shell starts the console exchange unless sign-in is lost, and stops it otherwise; while sign-in is
  dark the door answers `auth-off` and the client records `refused`.
- `narrowing-nudge-unwired`: `nudgeWitness()` is exported for the console's narrowing doors, but no console control calls the rung,
  Pause or latch doors yet (home B's). The 60 s exchange holds a narrowing within a minute until then.
- `post-append-nudge-through-the-guard-port`: the writer's port gains an optional `appended?()`, called once after a successful append
  and head-row apply; the guard defers its listeners past the caller's transaction, and the exchange nudges the agent from it. That is
  the plan's "post-commit nudge from the writer's caller", made once at the writer instead of at every caller.
- `guard-witness-unmeasured`: the guard gains `witnessUnmeasured(why)`, which moves a coherent guard to `unmeasured` (`journal` or
  `privacy-head`) when the exchange cannot read the server's own facts; the plan names the state but no input for it.
- `privacy-digest-read`: the private store gains `privacyJournalDigestAt(sequence)` beside `privacyJournalHead()`, so the verdict can
  check a witness's privacy head below the server's head, not only at it.
- `door-unmeasured-maps-to-rolled-back`: the console door answers 503 `authority-rolled-back` with cause `unmeasured: <why>` when no
  tuple can be offered (X2's door mapping).

- `server-actor-is-attributed`: the `restore-detected` raise needs an actor, and a server lane has none, so the attribution adapter
  gains its one server mint, `serverActorOf(lane)` (`CallerIdentity.server`), kind and issuer `server`, strength `attributed`: the three
  strengths describe a caller, and the server holds no credential. A brake accepts it; a widening refuses it.
- `restore-latch-raised-once`: measured, `raiseLatchInTx` answers `changed: false` for a cause that already stands, so a raise at each
  boot over the same rollback leaves one standing row, and the listener adds no skip of its own.
- `restore-raise-deferred-in-transaction`: the guard leaves `coherent` from inside the writer's open transaction (its `writerFailed`),
  where a raise would open a nested transaction; the raise runs at once at boot and waits past an open transaction otherwise.
- `restore-raise-in-own-file`: the raise is `coord/overlordRestoreLatch.ts` (L4), which `index.ts` registers on the guard's
  `onRefusing` before the boot step runs, so a refusing boot verdict raises too.
- `no-witness-input-absent-is-unmeasured`: the ladder's input table reads `unmeasured` when no exchange is wired (a test server, a
  build without the exchange), so the `advise` cap applies, failing closed.
- `witness-door-is-view`: the door table's row for `POST /api/overlord/witness` is an operator door of verb class `view`: it records
  no row and changes no authority; what it can do is make the server refuse.
- Not covered here, PR C's: Confirm leaves `restore-detected` standing, stamped with the Confirm record's sequence. A latch raised
  row-only over an incoherent journal can be cleared only once Confirm makes the journal coherent.

## Seams with peers

- PR C (Confirm the restore) declares its consumer port `RestoreWitnessFacts` (`epoch()`, `highest()`, `offerNow()`, `told()`) with a
  stand-in adapter; this PR's exchange answers those four reads in that shape. Whichever lands second wires the exchange in place of
  the stand-in and deletes the stand-in's copy of the epoch formula.
- The isolation word's per-link relation port (`AgentHostRelation`, `relationOf(linkOf(fleetState))`): until it lands, the exchange's
  `relationOf` answers `unmeasured`, so no agent counts. Whichever lands second re-points `HostRelation` to `AgentHostRelation |
  'console'` and the exchange's `relationOf` to the port.
- Private store A's `PrivacyJournalHead`: wired in `index.ts` over the store's head and digest reads (plan question 11).
