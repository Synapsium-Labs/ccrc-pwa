# Overlord W1, authority journal PR C: Confirm the restore

The task note of authority journal PR C (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-authority-journal.md`, Tasks 8
and 9). The coordinator folds it into the programme ledger. Departures are named by slug; the coordinator mints their numbers.
The fix round after review 3334 changed what Confirm does when the journal is damaged. The sections below describe the PR after
that round.

## What shipped

- `server/src/coord/overlordRestore.ts` (L1): `restoreStricter` (one row per authority field), `journalSideOf`, `toldNarrowed`
  and `confirmRestorePlan`.
- `server/src/coord/overlordAuthorityJournal.ts`: `appendConfirmInTx`, the one append allowed over an incoherent journal. It
  can set a torn tail aside first, through the kernel's tail cut, and it never sets the whole file aside.
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

## The bound on the epoch and the generation (review 3334, F1 to F3 and F5)

The epoch and the restore generation must never repeat a value. Confirm sets both above an upper bound on what was issued before.
Only the journal's verified records can prove that bound, and only when they reach the head row:

- The head row moves only after its record's line ending is on disk, so nothing beyond the verified records was acknowledged.
- A torn tail was never a record.

A witness's highest value only raises the bound. It never proves that nothing higher was issued, and the pre-witness stand-in's 0
and 0 least of all. So `confirmRestorePlan` now:

- **refuses** over a `malformed` file, and over records that do not reach the head row (`missing` with a head row, `behind`,
  `diverged`). It writes nothing, cuts nothing and keeps every byte. A higher witness does not change the answer;
- **heals first**: the door runs the torn-tail heal through its owner (`healTornTail`, the kernel's rule) before it reads the
  facts. It also measures an `unmeasured` guard again first, under the guard's `remeasure` contract;
- **cuts only a torn tail** that the heal refused, and only after records that reach the head row. It uses the kernel's tail cut,
  then appends after the last verified record, and the journal side is the records' fold.

**Correcting the plan's question 17.** The plan says a malformed file's "count of lines bounds every sequence it held, and so every
value it could have issued". The first half holds; the second does not. Confirm sets `epochAtConfirm` and `restoreGeneration`
above the sequence, so a record can carry values far above its line count. Review 3334 reproduced the failure: two whole-file
cuts in a row made the generation go from 5 back to 3. The whole-file cut and its line-count bound are therefore not shipped.

The residual of question 13 is unchanged. A whole-volume restore brings back an older journal that agrees with its rows. That
restore is still bounded only by the witnesses that answered since boot. No new case relies on a witness.

## Mutation floors

- `restoreStricter` (9 mutants) and `confirmRestorePlan` (16 mutants, rewritten for the fix round) are in
  `mutation-floors.json` at 1. Every mutant is killed, measured after the fix round. The designation store's sets were measured
  again after its edit, and every mutant is killed.
- **Hand mutants, fix round.** 17 hand mutants were run, each restored from a saved copy, and all 17 were killed. They cover:
  - the told state dropped at the transaction;
  - no remeasure before Confirm, and none before the read;
  - no heal before Confirm;
  - `termRaised` reading `>=`;
  - `restoreGeneration`'s throwing read answering 0;
  - `guard.confirmed()` dropped, and no `trailing` after a throw past the append;
  - the tail not cut, the head check removed, a failed append telling the guard nothing, and any entry kind appended;
  - the journal-only body owing no stop, and an absent row owing nothing;
  - the owed bodies' generations not ended, and `stopsOwed` not extended;
  - a kept binding the row does not hold.
- **Earlier hand mutants.** The first round's 11 hand mutants, on lines that still stand, are kept: the absent ladder row read as
  `chat`, the offer after commit, and the generation's guard and coherence checks.
- **The composition root.** The line in `index.ts` that sets the response stamp is pinned by text. The same composition is
  measured at the real insert seam: an item raised to the operator through the sender's funnel.

## Departures, by slug

- **`confirm-reads-the-witness-by-port`**: Confirm reads PR B's facts through `RestoreWitnessFacts` (`epoch`, `privacy`,
  `highest`, `told`, `offerNow`), declared by its consumer in `overlordRestoreState.ts`.
  - Until PR B lands, `preWitnessFacts` stands in: no witness has answered, and the privacy head is absent.
  - Its epoch is question 7's formula over the journal's verified records alone. A torn tail does not count.
  - That formula is PR B's `authorityEpoch`. Whichever of B and C lands second swaps the stand-in line in `index.ts` for B's
    exchange and deletes the copy (agreed with run 3299; the coordinator's ruling of 2026-11-22).
- **`told-narrowings-survive-confirm`** (the coordinator's ruling, carried by run 3299): Confirm also takes the narrowest told
  state a counting witness holds, for the rung and the latches. It is pinned at the transaction seam with a stub witness.
- **`confirm-clears-like-retire`**: a binding Confirm clears ends the generations of every body either side binds and owes each
  one stop, once:
  - the bodies are the row's bound and pending sessions, and the session the journal's verified fold binds (review 3334 F4);
  - a pending attempt is cancelled with outcome `retired`, as retire does, and the door drains the owed stops;
  - with no designation row, the stop of a body only the journal binds is owed on the inserted row.

  The plan says only that the row binds no session. The schema's CHECK refuses a pending rebind with no binding, so the pending
  attempt must go too.
- **`confirm-inserts-an-absent-designation-row`**: with no designation row, Confirm inserts one holding the raised term, so a
  later designate raises the term above the journal's.
- **`restore-read-door`**: the banner reads the guard through a second door, `GET /api/overlord/restore` (the gate with no
  step-up). It measures an `unmeasured` guard again first (review 3334 A3). The plan named only the Confirm door; question 14's
  banner needs the state to show and hide.
- **`confirm-file-moved-refuses-conflict`**: `appendConfirmInTx` re-checks that the file's head is still the one the plan read,
  and refuses `changed` (the door's 409 `conflict`) otherwise, writing nothing.
- **`new-chain-is-record-one`**: the record's `newChain` is true exactly when it is record 1, over an empty or absent file.
- **`confirm-refuses-without-a-measured-bound`** (replaces `confirm-bound-includes-the-head-row` and question 17's whole-file
  cut): a malformed journal, or one whose records do not reach the head row, refuses `journal-unreadable` with a fixed sentence
  and writes nothing (see "The bound" above).
- **`confirm-cuts-only-the-torn-tail`**: over records that reach the head row, a torn tail the boot's heal refused is set aside
  with the kernel's tail cut. The heal refused it because the head row was older than the last record. The plan's whole-file cut
  would have dropped the verified records' fold from the stricter-of (review 3334 F3). After a failed append the evidence is kept,
  so the retry confirms above the journal's last generation.
- **`confirm-heals-and-remeasures-first`**: before its transaction, Confirm measures an `unmeasured` guard again and runs the
  torn-tail heal through its owner. Over a coherent guard, a healable tail is healed and nothing waits.
- **`restore-generation-read-fresh`**: `restoreGeneration()` reads and verifies the file on every call, with no cache. It answers
  `unmeasured` unless both the guard and the file against its head row read coherent, and also when the read throws. The plan's
  cache refreshed after each append is left for the verified-head cache of the plan's Later list. Its per-insert cost is
  unmeasured (review 3334 A7).
- **`term-raised-unbound-reads-not-raised`**: `termRaised` reads as follows:
  - `not-raised` with nothing bound (there is no generation to renew);
  - `unmeasured` for a bound session with no live `overlord` generation.

  It is pinned in this PR, and nothing calls it yet: the plan gives its wiring to the renewal readings piece.
- **`stamp-takes-the-shared-type`**: `responseStampNow` takes the shared `RestoreStamp`, and `index.ts` passes
  `restoreGeneration()`, so the C6 module imports nothing from C5.
- **`confirm-refusals-say-fixed-sentences`**: every Confirm refusal and failure detail is a fixed sentence with closed words. It
  never carries an exception's message or a port's text (review 3334 A8).

## For the second lander (PR B or C, whichever lands second)

- **Swap the stand-in.** Build the exchange before `OverlordRestoreState`, or bind its witness late, and replace
  `preWitnessFacts` with it.
  - Adapt B's `PrivacyJournalHead` to `ConfirmPrivacyRead`.
  - B's `epoch()` must not count a torn tail, as the stand-in does not.
  - Pin that B's epoch and the stand-in's agree while the privacy head is absent.
- **Higher tuple.** B's `highest()` is every witness that answered since boot. Pin through the real exchange that a console with
  a higher epoch and generation raises both on the next Confirm.
- **Exactly one notification after commit.** Keep B's `appended?.()` out of `writeHeadRow`: Confirm already calls `offerNow()`
  once after commit. Pin that a Confirm triggers one exchange and `appendInTx` still triggers one.
- **The two cases that need B's exchange.** After an in-boot Confirm, the console's next exchange reads `stale` and takes the new
  tuple. `no-witness-since-boot` stays until the next boot.
- **Pass seq-a's argument.** Seq-a's `endOverlordGeneration` gains an `at` argument; pass it in `applyDesignationRestoreInTx`.

## Residuals

- **A malformed journal, or one missing records its head row attests, cannot be confirmed.** Its doors stay refused
  (`authority-rolled-back`) until a bound can be measured. Nothing in W1 measures one there:
  - the line count bounds sequences only;
  - a witness only raises;
  - carrying the counters beside the head row would need a migration, which this round rules out.

  This is fail-closed, as the fix round directs. It needs a ruling on how such a journal is recovered without hand work.
- **A tail cut can fail after it began** (its bytes are already kept aside). Confirm then answers `journal-unwritable`, saying
  nothing was appended, and the retry confirms. This is pinned with a failed truncation.
- **The banner is not mounted yet.** `RestoreBanner` is mounted nowhere until home B adds its one line, so the Confirm control is
  unreachable from the console until then (the plan's question 14).
- **Tests were written after the code.** The server tests, both the first build's and this fix round's, came after the code, not
  red first. Every guard was then mutation-measured, as above. The banner's test was red first.
- **The rules-mixed judge reason cannot be split out.** `box-token-census.test.ts` ("CLAUDE.md's box-token bullet is TRUE, not
  merely present") holds `CLAUDE.md`'s box-token bullet to name every session-only door. So the sentence for the two doors lands
  with them. Measured: with `CLAUDE.md` left at the merge base, that case is red.
