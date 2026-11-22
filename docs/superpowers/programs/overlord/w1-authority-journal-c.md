# Overlord W1, authority journal PR C: Confirm the restore

The task note of authority journal PR C (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-authority-journal.md`, Tasks 8
and 9). The coordinator folds it into the programme ledger. Departures are named by slug; the coordinator mints their numbers.

## What shipped

- `server/src/coord/overlordRestore.ts` (L1): `restoreStricter` (one row per authority field), `journalSideOf`, `toldNarrowed`
  and `confirmRestorePlan`.
- `server/src/coord/overlordAuthorityJournal.ts`: `appendConfirmInTx`, the one append allowed over an incoherent journal, with a
  whole-file cut first over a file that cannot be folded.
- `server/src/coord/overlordDesignationStore.ts`: `applyDesignationRestoreInTx`, the designation's inner, unjournalled writer.
- `server/src/coord/overlordRestoreState.ts` (L4): the one transaction (`confirm`), `restoreGeneration()`, `termRaised()`, the
  `RestoreWitnessFacts` port and its pre-witness stand-in.
- `server/src/responses/stamp.ts`: the response rows' restore stamp reads `restoreGeneration()`.
- Two doors in `server/src/coord/overlordRoutes.ts`: `GET /api/overlord/restore` and `POST /api/overlord/restore/confirm`.
- `pwa/src/overlord/RestoreBanner.tsx`, with `api.overlordRestore` and `api.confirmRestore`.

## The stricter-of table (W1)

| Field | The stricter |
|---|---|
| The binding | The row's, when the journal's last designate, rebind or retire binds the same session. Otherwise none, and both ids join the past ids |
| `term` | The higher of the two, plus one |
| `operatorRung` | The lower rung, then lower again by a counting witness's told rung |
| Latches | The union, each cause at the lower cap, with a counting witness's told latches joined the same way |
| The account set | The intersection, and `untagged` only when both hold it |
| The model class | `opus` unless both read `fable` |

An absent side reads the narrowest value of every field, and an absent ladder row reads `off`.

Later waves add rows: grants latched suspended (W3), the reconciliation pass and the act ids (W2), classes (W3), the privacy
journal's replay (W4), and the decision-model rows (`decision-rows-restore-after-c`, still open).

## Mutation floors

`restoreStricter` (9 mutants) and `confirmRestorePlan` (15 mutants) are in `mutation-floors.json` at 1: every mutant is killed.
By hand, restored from a saved copy each time, 11 mutants of the L3 and L4 guards were killed: the append's head check, its
entry-kind check, the trailing report after a failed table write, `guard.confirmed()`, the offer after commit, the generation's
guard and coherence checks, the past ids and owed stops of a cleared binding, the absent ladder row read as `chat`, and the
stamp left `unmeasured`.

## Departures, by slug

- **`confirm-reads-the-witness-by-port`**: Confirm reads PR B's facts through `RestoreWitnessFacts` (`epoch`, `privacy`,
  `highest`, `told`, `offerNow`), declared by its consumer in `overlordRestoreState.ts`. Until PR B lands, `preWitnessFacts`
  stands in: no witness has answered, the privacy head is absent, and the epoch is question 7's formula over the authority
  journal alone. That formula is PR B's `authorityEpoch`; whichever of B and C lands second replaces the stand-in line in
  `index.ts` with B's exchange and deletes the copy (agreed with run 3299, the coordinator's ruling of 2026-11-22).
- **`told-narrowings-survive-confirm`** (the coordinator's ruling, carried by run 3299): Confirm also takes the narrowest told
  state a counting witness holds, for the rung and the latches.
- **`confirm-clears-like-retire`**: a binding Confirm clears ends the bound and pending bodies' generations, owes their stops,
  and cancels a pending attempt with outcome `retired`, as retire does; the door drains the owed stops. The plan says only that
  the row binds no session. The schema's CHECK refuses a pending rebind with no binding, so the pending attempt must go too.
- **`confirm-inserts-an-absent-designation-row`**: with no designation row, Confirm inserts one holding the raised term, so a
  later designate raises the term above the journal's.
- **`restore-read-door`**: the banner reads the guard through a second door, `GET /api/overlord/restore` (the gate with no
  step-up). The plan named only the Confirm door; question 14's banner needs the state to show and hide.
- **`confirm-file-moved-refuses-conflict`**: `appendConfirmInTx` re-checks that the file's head is still the one the plan read,
  and refuses `changed` (the door's 409 `conflict`) otherwise, writing nothing.
- **`new-chain-is-record-one`**: the record's `newChain` is true whenever it is record 1, over an empty or absent file as well as
  after a whole-file cut.
- **`confirm-bound-includes-the-head-row`**: over a file that cannot be folded, the bound is never below the head row's sequence,
  nor below what the verified records' last Confirm carried. A file ending in a tail bounds at its records plus one, since a
  tail holds no LF.
- **`restore-generation-read-fresh`**: `restoreGeneration()` reads and verifies the file on every call, with no cache, and
  answers `unmeasured` unless both the guard and the file against its head row read coherent. The plan's cache refreshed after
  each append is left for the verified-head cache of the plan's Later list.
- **`term-raised-unbound-reads-not-raised`**: with nothing bound, `termRaised` reads `not-raised` (there is no generation to
  renew); a bound session with no live `overlord` generation reads `unmeasured`.
- **`stamp-takes-the-shared-type`**: `responseStampNow` takes the shared `RestoreStamp`, and `index.ts` passes
  `restoreGeneration()`, so the C6 module imports nothing from C5.

## Residuals

- A failure between the whole-file cut and the Confirm append leaves an empty file. The next Confirm bounds its epoch and
  generation by the head row only; the cut bytes are kept under `~/.ccrc/overlord-authority-torn/`, not read back.
- Two of the plan's cases need PR B's exchange and are left to the second lander: after an in-boot Confirm the console's next
  exchange reads `stale` and takes the new tuple, and `no-witness-since-boot` stays until the next boot. This PR pins its side:
  `offerNow` is called once after the commit, and the `restore-detected` latch stands.
- The server tests were written after the code, not red first; every guard was then mutation-measured as above. The banner's
  test was red first.
- `CLAUDE.md`'s box-token bullet does not yet name the two doors. The review judge refuses a PR that changes a rules file
  together with anything else (`rules-mixed`), and no test pins that sentence, so it is left for a rules PR of its own. In the
  Overlord doors sentence, after "a latch clear always takes the step-up.", the text to add is: "Confirm the restore
  (authority journal C), `GET /api/overlord/restore` (the guard's state) and `POST /api/overlord/restore/confirm` (behind the
  step-up), consults no box token either and is session-gated when armed, and refuses `auth-off` dark." The next sentence then
  begins "All three sets of doors" in place of "Both sets of doors".
