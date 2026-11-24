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
- `browser-without-web-locks-rereads`: the fallback when the browser has no lock API is deliberate: it re-reads before the write,
  in one synchronous task. A lock request that rejects or throws is a failure, not permission to write unlocked.
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
- `witness-key-avoids-auth`: the console keeps its tuple under `ccrc:overlord-witness:v1`, not the plan's `ccrc:authority-witness:v1`.
  The resume banner's test refuses any storage read whose key matches `auth`, `attempt` or `resume`, and `authority` matches `auth`.
  Renaming the key keeps that guard as it is.
- Not covered here, PR C's: Confirm leaves `restore-detected` standing, stamped with the Confirm record's sequence. A latch raised
  row-only over an incoherent journal can be cleared only once Confirm makes the journal coherent.

## Review round: local proof before integration

- `rollback-witness-keeps-told`: Confirm's narrowest `told` includes a parsed rollback verdict from an off-volume source, as well as a
  consistent one. Stale, malformed and unmeasured answers and non-off-volume sources do not contribute. Rollback evidence is not a
  holding receipt.
- `refused-offer-keeps-rollback-evidence`: a rollback or unmeasured verdict gets no offer. A holder takes a higher base; on the same
  base it takes a strictly higher epoch only if no measured term regresses or disappears. Both carriers use that same keep rule.

The focused negative controls and regressions were observed on fixtures, not a live box:

| Check | Observed before the fix | Observed after the fix |
| --- | --- | --- |
| Tuple retention | 2 failed: a higher base was refused and a same-base offer could erase a measured term | 21 passed |
| Browser client | 2 failed: a delayed response replaced a newer tuple and a write ran before the lock | 10 passed |
| Agent carrier | Oversized held JSON was accepted; a separate targeted check failed because an oversized offer was written | 17 passed |
| Server exchange | 9 failed: publication on rollback or a trailing record, ready ordering, unreadable own facts, rollback `told`, and boot confidence | 30 passed |
| Witness route | 1 failed: 200 instead of 503 for a measured rollback | 9 passed |
| Message issuance | Targeted test failed: issued 2 with a witnessed floor of 40, rather than 41 | 33 passed |
| Witness policy and selected mutation checks | The new eligibility line left two stale mutation targets | Policy: 51 passed; seven witness mutation sets and two floor checks passed, with no floor edit |

The restore-latch fixture (11), coordination rings (20), box-token census (69), and privacy-journal census (3) passed. Source
typechecks passed in all three packages. The server test-project typecheck exceeded the test slice's 6 GiB cap (exit 137); its
result is unmeasured. A full suite was not run. The original red-first chronology for Tasks 5–7 remains partly unmeasured.
Confirm and the measured agent relation are not wired or verified by this local round.

## Integration with landed Confirm, Isolation and Renewal

- `confirm-requires-verified-bound`: ruling 10 preserves the landed Confirm policy. A readable malformed journal is a distinct
  refusal and its bytes stay in place; line count bounds sequences, not epoch or generation. An unreadable journal remains
  unmeasured. Verified history that reaches the committed head supplies an epoch and generation bound; a higher witness can raise
  that bound, but cannot establish one by itself.
- Confirm's `RestoreWitnessFacts` port now uses the real exchange, with no stand-in or duplicate epoch formula. Confirm gives
  `epoch(file)` the exact verified snapshot used by its planner. Publication separately requires the file to agree with committed
  rows; it does not attest trailing records or an open transaction.
- The exchange reads the agent's relation through Isolation's `relationOf(linkOf(fleetState))`. W1 Isolation returns `same-host`
  or `unmeasured`, never affirmative `other-host` proof. A matching tuple with an unproved relation did not lift boot confidence,
  earn a holding receipt, or contribute `told` in the fixture with the real Isolation reader. No live agent evidence is claimed.
- The ladder keeps both inputs and Renewal's `probes-failed-twice` latch. The approved three-file peer patch keeps the landed
  gate and mutation pins and adds seven witness floors. The route census measured 298 declarations, 295 HTTP, 187 gated HTTP and
  108 exempt HTTP. The schema matches the named main base byte for byte: the authority head is at `MIGRATIONS[80]` (`user_version`
  80 → 81), with no new migration or change to `FLEET_PROTO = 1`.
- Private store A's `PrivacyJournalHead` remains wired in `index.ts` over its head and digest reads (plan question 11).

| Wiring check | Stand-in or constant | Shipped wiring |
| --- | --- | --- |
| Restore retains the witnessed narrowing | `full` | `chat` |
| Restore raises the independently verified epoch bound | 5 | 6 |
| Confirm withdraws boot confidence, even after a prior-boot witness at the new base | `lifted` | `standing` until restart |
| Exchange reads the current Isolation link | Replacing the reader callback in the inspected source with constant `unmeasured` failed the composition assertion: 1 failed / 36 passed | 37 passed; the exchange returned `held` with synthetic `other-host` proof at the reader port and `not-yet` on the same link and tuple at a fresh ready without proof |

The Isolation check inspects the boot-only wiring without starting the server, and tests holdings through the exchange separately.
Its affirmative word is synthetic: W1's real Isolation reader still cannot prove another kernel. No production wiring changed.

The route file went from 2 failed / 9 passed to 11 passed in the fleet test lane. The malformed and unreadable cases were already
passing before wiring and still pass. The first integrated source check found two wrong type imports; the corrected source check
passed in the lane. The test-project check then found a missing `shared-user` fixture input, and the ladder-read file found three
Isolation-only cases that did not lift the unrelated witness condition. Both fixtures were corrected without changing policy;
the test-project check exited 0 and ladder read went from 3 failed / 7 passed to 10 passed in the lane. This supersedes the prior
local test-project measurement gap, not the record of its exit 137.

| Focused evidence | Measured in the fleet test lane |
| --- | --- |
| Restore and witness | Confirm route 11, restore 55, generation 10, exchange 31 (including the Isolation fixture), witness policy 51, witness route 9, witness link 5 |
| Journal and ladder | Journal 42, guard 19, restore latch 11, ladder policy 68, read 10, actor 25, route 42, seams 11 |
| Censuses and schema | Auth gate 383, Overlord doors 29, box token 69, coordination rings 20, privacy journal 3, coordination DB 155, migration slots 2, mutation floors 307 |
| Fleet and carrier | Fleet identity 6, fleet state 73, remote connect 81, Isolation facts 35, agent witness 17, models ops 40, Overlord history ops 22, test-box ops 22 |
| Store, browser and guards | Message store 33, browser retention 21, browser client 10, carrier deny 20, selected request-op census 1 and rejection census 6 |
| Typechecks | Server, agent and browser source; server test project |

These are local measurements, not a full suite or CI results. The request-op and rejection censuses ran as selections within their
files; the other cases in those two files were not measured by these runs.

## Second independent review

- `witness-maximum-raise-is-bounded`: apply one ceiling to each witnessed epoch, restore generation and message id independently,
  for every source. A counter above the ceiling cannot raise its maximum; other eligible counters in the tuple still can. This is
  not a parser ceiling. The wire, verdict, fence, keep rule and offers are unchanged, including offers after a local counter
  passes the ceiling. A fixture used the real message store, Confirm and exchange to check both sides of the boundary and a
  mixed tuple; the guard still saw a higher base as rollback. At the ceiling the next counters were safe and the server's own
  above-ceiling offer parsed and counted as a consistent holding.
- Tests pin no boot-confidence lift after a same-boot rollback, no effect from an obsolete connection's reply, no unlocked write
  when a lock request rejects or throws, and no blocking or symlink following at the agent carrier. The FIFO test stops a missing
  nonblocking flag before the open can hang the runner; the symlink fixture has no target to read.

### Known limits

A forged agent file can open a gap in message ids, the epoch and the restore generation, once and at most up to the witnessed
raise ceiling; it cannot exhaust a counter, deny issuance or Confirm through counter exhaustion, or lift trust in W1. The normal
rollback verdict can still fence. Once a server's counters stand above the ceiling (beyond a realistic lifetime without a forged
raise), those above-ceiling witnessed maxima are not used. After a later rollback, protection against reuse rests on the verdict's
fence and the database and journal highest values.
