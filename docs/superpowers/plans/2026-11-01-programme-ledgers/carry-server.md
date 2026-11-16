# Desktop polish: the server carry ("Part S")

Task note for the server carry pull request (run 1428, programme desktop-polish wave 85). It clears the review carries the
programme ruled out of earlier pull requests: PL4 (review 1338), PL7 (review 1348), C3 and C4 (reviews 1382 and 1383), PL6
(reviews 1389 and 1416) and the PL6 follow-up (review 1426). The rows are the coordinator's carry list of 2026-11-04, Part S,
rows 1 to 6 and 21 to 37; its sibling, Part C (run 1430), does the console rows in other files. One deviation number was
issued for this pull request, and every departure below is named by slug under it. The number is not spelled here, for the
reason the PL6 follow-up note gives (`deviation-refs`' floor case refuses a tracked reference above the ledger's defined
high-water until the coordinator folds the note into the ledger); the pull request body and the wave-done mail name it.

## Step 0: what was measured before any change

Measured on this branch at `7b362246a` (`main`), by reading the code and the tests. Every row was still open; none was
already fixed on `main`. Row 4b (the duplicate assertions) was done before, as the carry list says, and is not redone.

| Row | Measured |
|---|---|
| 1 | Open. `shared/ledgers.ts` (`tickMailLeftBehind`'s doc) says a left-behind mail "can never be acknowledged by its recipient"; `ledgersRoutes.ts`'s guard comment says "nothing will ever acknowledge it". `watch.ts`'s `listedIds` doc calls `registryIds` "the mail and census lanes'": its one reader is `sweepTmpSweepCensus`. The first-listing note is missing from both presence docblocks. |
| 2 | Open. `readRegistryMeasured` computes the listed ids and drops them; the tick re-derives them from `names` and spreads `refused` (a subset) into them. |
| 3 | Open. The warn-once case throws one constant message and has no success between failures. |
| 4 | Open. The handler holds the outstanding-state check, `tickMailLeftBehind` the recipient arm. |
| 5, 6 | Open. Clause 20's harvest regex needs the backtick straight after the verb; clauses 20 and 17 parse the client's ROUTES table inline. |
| 21, 22 | Open. The tick comment names the lifecycle mirror as a registry lister and leaves out `readLimits`. |
| 23 | Open. "returns before every lane below the registry read". |
| 24 | Open. "no row waits when N <= DIALOG_CAPTURE_CONCURRENCY", unqualified. |
| 25, 26 | Open. The class doc's "never overwrites a newer one" has no "while fresh"; `keptWalk` and `keptProbe` skip a negative-age entry and serve it again once the clock reaches its stamp. |
| 27 | Open. Linear's routes spell `no-store` and the body errors for themselves; five UTF-8 byte counters (`shared/ledgers.ts`, `shared/docs.ts`, `shared/testbox.ts`, `shared/slug.ts`'s encoder wrapper, `pwa/src/lib/markdownGuard.ts`). |
| 28 | Open. The PUT builds its path with `path.join`; the read and Remove find entries by exact name. `shapeProgramSlug` allows capitals; slot slugs are lower case only. |
| 29 to 32 | Open, as the rows say (`ledgersSecrets.ts`'s header; `mask.ts`'s retire doc and `MAX_PREVIOUS_KEYS`; the Remove doc). |
| 33, 37 | Open in `pl6-followup.md`. |
| 34 | Open. "taken while a lane secret existed". |
| 35 | Open. `settle` logs "has not landed; retrying" after `close()`. |
| 36 | Open. One unreadable slot shows the programme-wide `secrets-unreadable` sentence. |

## What this pull request does

| Row | Done |
|---|---|
| 1 | The decider's doc and the guard comment say what is true: the recipient is gone and no longer the coordinator, so the guard must not wait on it; nothing re-addresses the mail (a revived session can still be delivered it and ack it). `watch.ts` names the one reader of `registryIds`, and both presence docblocks say the ids are the first listing's (a row retired after the second listing reads `unmeasured` for one tick). |
| 2 | Characterized green on `main` first (`ledgers-registry-ids`: every `*.uuid` basename, a refused id and a torn row included, no other name). Then `RegistryRead.listedIds`, written once in `readRegistryMeasured`; the watcher reads it, and the `...refused` spread is gone. A guard pins `endsWith('.uuid')` to `registry.ts` alone. |
| 3 | Two cases: error A then error B warns twice; A, a success, A warns twice. Review 1338's two survivors are now killed. |
| 4 | `earlierTickBlocks` in `shared/ledgers.ts` decides over (delivery state, recipient, coordinator, recipient's presence); the handler acts on its answer. `tickMailLeftBehind` is gone. |
| 5 | The harvest takes a span with arguments (`[^`]*` before the closing backtick), and the count of `ccrc-api` in the clause must equal the span count. |
| 6 | Clauses 20 and 17 read the client's rows through `clientRoutes()`. |
| 21, 22 | The tick comment says "among others", names `readLimits` inside `assembleFleet`, and says the lifecycle mirror reads only its own journal directory. |
| 23 | "…below its fail-shut return". |
| 24 | "with equal capture times, … otherwise a row waits for the slowest capture of the batch". |
| 25 | "while the kept walk is fresh". |
| 26 | A kept walk or verdict whose age reads negative is dropped the first time it is asked for; a test pins both. |
| 27 | Linear's routes take `credentialBodyRoute` and the new `noStoreRoute` from `accounts/gate.ts`; the Linear route suites (connection, workspaces, resolve, proxy), which pin 400 and 413 as fixed words and `no-store` on every answer, ran green on `main` before the move and unchanged after it. One UTF-8 counter, `shared/utf8.ts`, characterized green on `main` first (`utf8-bytes`); every other counter imports it, and `markdownGuard` re-exports it as `utf8ByteLength`. Two single-definition guards. |
| 28 | `secret-name-collides` (409): the PUT refuses a programme slug or slot name that case-folds to a stored entry but is spelled differently, on every platform, before any write. Its `REFUSAL_STATUS` row, its console sentence, and the leak scan carries it with the value. Read and Remove stay exact-name. |
| 29 | `writeOperatorSecret`'s header says the window opens after any rotation followed by a restart, before the boot re-key lands, for every stored slot; the reorder in `index.ts` is not done, as ruled. |
| 30 | "while its generation holds rows", in the header, in the retire doc, and on `MAX_PREVIOUS_KEYS` itself. |
| 31 | The retire doc and the Remove doc say that after a rotation and then a restart the rows reload but match nothing, citing the one place the fact is stated (`SecretMasker`'s class doc: previous tokens are memory-only). |
| 32 | "unless a re-save un-retires it meanwhile". |
| 33 | `pl6f-r2-rekey-window` adds that the first re-key after a rotation clears the lane too. |
| 34 | "while one of those secrets existed" (the secrets-posture comment only; the line count is unchanged). |
| 35 | A re-key that fails after `close()` logs nothing; tested, with a CONTROL that the same failure while open logs the line. |
| 36 | `STORED_TEXT.slotUnreadable`: "The box could not read the secret saved for this item, so this page cannot tell whether one is stored. Check that the server can read its folder of stored secrets on the box, then reload this page." |
| 37 | `pl6f-hook-unchanged` names the spellings the pattern matches but no test pins (the backslash spelling, the Bash `/./` separator, an assignment), and one split-quote read form is pinned in `session-hook-account-deny.test.ts`. The leak scan also captures `process.stdout.write` and `process.stderr.write`, with a control that a direct write is seen. |

Recorded, nothing built: N3 (moving `fleetRowsUsable` and `ProjectWalkCache`), and the hook residuals (review 1389 A5,
`pl6f-r1-hook-residuals`).

## Departures (all under the one issued number)

- **carry-s-row27-pins**: two ring pins over row 27's readers were not in this pull request's first gate set and went
  red on its first CI run after the main merge: `docs-shared` (`shared/docs.ts` imports only the redactor) and
  `markdown-purity` (the parse worker's closure is exactly its lib files). Each now admits `shared/utf8.ts`, which
  imports nothing, and still refuses any other import (mutants R27f and R27g). The `docs-shared` pin holds
  `utf8.ts` to the same L0 refusals as the redactor. The headers of `shared/docs.ts` and `shared/slug.ts` now name
  the counter as an import.
- **carry-s-utf8-reach**: row 27's counter reached past the brief's expected files: a new L0 file, `shared/utf8.ts`, and
  `shared/docs.ts`, `shared/testbox.ts`, `shared/slug.ts` (a fifth counter, an encoder wrapper) and
  `pwa/src/lib/markdownGuard.ts`, all claimed and unheld. `markdownGuard` re-exports the counter under its old name, so
  none of its readers changes (two of them are held by another run). Left alone, and outside the guard's reach on purpose:
  inline uses of the platform's own counter (`shared/api.ts`'s route value bound, held by another run; the server's
  `Buffer.byteLength` and encoder wrappers in `coord/ledgersMail.ts`, `linear/ops.ts`, `tmpSweep.ts`,
  `coord/childReclaim.ts` and `coord/route.ts`). They count the same way; folding them is a follow-up if wanted.
- **carry-s-row2-fixture**: the move commit of row 2 adds `listedIds` to the one hand-built `RegistryRead` in
  `fleet-read-model.test.ts`, a type requirement of the new field, besides the test imports.
- **carry-s-row27-characterization**: the Linear half of row 27 is characterized by the existing route suites, run green
  on `main` before the move, not by a new file.
- **carry-s-row4-presence-asked**: the handler now asks the recipient's presence for every earlier mail, a delivered or
  acknowledged one included, since the decider takes it as an input. It is a read of the last fleet frame, no I/O.
- **carry-s-row26-unasked**: an entry that nobody asks for while the clock is behind its stamp is still served once the
  clock reaches it: a wall clock cannot see a step it was never asked across. Said in the class doc.
- **carry-s-row28-slot-arm**: the slot arm can only meet a store entry this server did not write (slot slugs are lower
  case), such as one made by hand; it is tested with one. The programme arm is the reachable one.
- **carry-s-row36-home**: the slot's sentence is in `STORED_TEXT` in `ItemView.tsx`, with the other stored-secret words,
  not in `refusalWords.ts`: it is a state the item view shows, not a refusal word a route answers.
- **carry-s-row5-mutant**: row 5's mutant changes the count in the test; a mutant that adds a clause-20 verb with arguments
  would have to edit the skill's text, which this pull request does not touch.
- **carry-s-row37-pin-only**: the split-quote pin is green on the hook as it is; no hook mutant was run (the hook is not in
  this pull request).
- **carry-s-arch06-parse**: the guard that Linear's routes and the ledger routes import the home is keyed on the parse
  (`test/scan`), because a literal source pin over a `server/src` file reds ARCH-06's ratchet.
- **carry-s-ledger-edit**: `pl6-followup.md` is edited (rows 33 and 37), as the brief directs; the head commit carries a
  `Ledger-Edit` trailer for the ledger guard.

## Claims

3417 (the brief's files), 3421 (row 2, 26 and 27's further files and tests), 3422 (the credential route guard), 3426 (row
27's two ring pins). No file held by another programme was edited. In `ccd/ccrc-doctor-checks` only the secrets-posture
comment changed.

## Mutants

Each applied in place, the suite run, and the file restored from the bytes held in memory, sha256 checked equal.

| Mutant | Result |
|---|---|
| R2a registry's listed ids built from the valid ids only | killed: ledgers-registry-ids "are every `*.uuid` basename of the listing, a refused id included, and no other name" |
| R2b the watcher's set built from the records | killed: the same case, and "hold a listed row that could not be assembled…" |
| R2c a second `.uuid` parse left in `watch.ts` | killed: ledgers-registry-ids "are derived from the listing in registry.ts alone" |
| R3/R2b (review 1338's) the reset after a success removed | killed: ledgers-frame "error A, a success, then error A again is warned twice…" (it survived at review 1338) |
| R3/R2c (review 1338's) a latch instead of the comparison | killed: ledgers-frame "error A, then a different error B, is warned twice…" (it survived at review 1338) |
| R4a the decider drops the outstanding-state check | killed: ledgers-policy "a mail no longer outstanding never blocks…"; ledgers-operator-routes "F3: return, acknowledge, tick again answers 200…" |
| R4b the coordinator's own dead mail released | killed: ledgers-policy "an outstanding mail blocks, except one left behind…"; ledgers-operator-routes "F1: the recipient that is still the programme's coordinator blocks, though it reads dead" |
| R4c an alive displaced recipient released | killed: ledgers-policy (the same case); ledgers-operator-routes "F1: with the displaced coordinator alive…", "F2: the duplicate guard finds the newest tick mail…" |
| R5 the span count off by one | killed: coordinator-skill "names only client verbs the closed client really has…" |
| R6 the client's `goals.pin` row renamed | killed: the same case, read through `clientRoutes()` |
| R26a `keptWalk` keeps a negative-age walk | killed: projects-route-cache "a kept walk or verdict whose age reads negative is dropped…" |
| R26b `keptProbe` keeps a negative-age verdict | killed: the same case |
| R27a Linear's own `no-store` hook put back | killed: single-definition/credential-body-route "the Linear routes and the ledger routes take both from the home…" |
| R27b Linear's own body-error mapping put back | killed: single-definition/credential-body-route "the body-error mapping is spelled in the home alone" |
| R27c a hand-written counter put back in `shared/testbox.ts` | killed: single-definition/utf8-bytes "the code-point arithmetic is spelled in the home alone", "the home imports nothing, and the readers import it" |
| R27d `slug.ts`'s encoder wrapper put back | killed: single-definition/utf8-bytes "no file of the shared kernel or the PWA wraps an encoder's length…" |
| R27e the home counts an astral code point 3 | killed: utf8-bytes "counts what an encoder writes…", "counts a surrogate pair 4…" |
| R28a the case-collision refusal removed | killed: ledgers-secrets "a programme slug that case-folds…", "a slot name that case-folds…", and the leak scan |
| R28b the programme arm compares without folding | killed: ledgers-secrets "a programme slug that case-folds…", and the leak scan |
| R28c the slot arm compares without folding | killed: ledgers-secrets "a slot name that case-folds…" |
| R28d the console sentence keyed on another word | killed: item-view "the sentence table is the routes' own codes…" |
| R35 the closed check before the retry log removed | killed: secret-mask "fails after close() and logs no … retrying line…" (that run also showed the suite's timing-bound case red under load; the suite is green alone) |
| R36 the item view shows the programme-wide sentence | killed: item-secret "a slot the box cannot read says so…" |
| R37a the leak scan's stream capture removed | killed: ledgers-secrets "the leak scan: a saved SECRET-MARK value…" (its stream control) |
| R27f a third import (`./api.js`) in `shared/docs.ts` | killed: docs-shared "imports only `./redact.mjs` and `./utf8.js`…" |
| R27g `markdownGuard.ts` re-exports from another shared file | killed: markdown-purity "is exactly the worker-side lib files and the shared byte counter", "imports nothing outside the closure…" |
