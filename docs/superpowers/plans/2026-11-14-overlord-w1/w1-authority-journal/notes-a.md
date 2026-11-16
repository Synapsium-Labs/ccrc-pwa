# Authority journal A: the builder's departures

The builder's notes for PR A of `docs/superpowers/plans/2026-11-14-overlord-w1/w1-authority-journal.md` (Task 1, the model;
Task 3, the grammar, the fold, the writer and the head row; Task 4, boot coherence, the heal, the guard and the snapshot pins).
Each departure from the plan's text is a plain-words slug, never a D-number (cross-plan ruling X9). The coordinator folds what
the ledger should learn into the plan.

## Departures

- **`migration-written-positionally`.** The brief says to write the migration as 82 for now. A migration's number is its
  position in `MIGRATIONS`, and responses A's 81 is not on this branch, so the entry is 81 here (header, `coord-db.test.ts`
  and `run-close-switch.test.ts` say 81). It becomes 82 at the landing merge, on the coordinator's word. The writer's and the
  guard's tests find the migration by its table, so they need no edit then.
- **`bad-entry-is-a-callers-error`.** `appendInTx` re-checks its entry through the grammar before anything else and answers
  `{ ok: false, error: 'bad-entry' }` for an entry the grammar refuses (or a Confirm record, which is `appendConfirmInTx`'s).
  The plan's error union has no word for it; like `not-in-transaction`, it is a caller's defect, never a journal state, so NL
  still holds: a narrowing is never refused by the journal's state. Narrowed by review 2219 (F1) to truly malformed entries:
  an account set's pool order or a duplicate pool is canonicalised first (`the-writer-canonicalises`). The designation door
  must still map any remaining `bad-entry` (for the index and the designation brief).
- **`the-writer-canonicalises`** (review 2219, F1, the coordinator's ruling). `appendInTx` sorts and de-duplicates both pool
  lists of an account-set entry (`canonicalAuthorityMove`, L1) before the grammar runs, so an operator narrowing is never
  refused `bad-entry` for order alone. A pure reorder journals as no change of membership (it reads `narrows`); the order lives
  in the designation row, never in the journal.
- **`stated-from-against-the-fold`** (review 2219, F2, the coordinator's ruling). While the journal is coherent, the writer
  holds a move's stated `from` against the fold's current value (`authorityAgainstFold`, L1). When they differ, the direction
  is read from the fold's value, the guard is told `diverged`, a widening against the fold is refused `authority-rolled-back`,
  and a move narrower than the fold lands `row-only`. A field no record has named yet has no fold value, so the stated `from`
  stands for its first record. While the journal is not coherent the stated `from` stands, as the plan says; `appendInTx`'s
  doc states the caller's duty (pass the row's own value, read in the same `tx()`), and a test documents the residual (a
  lying `from` over a rolled-back guard lands row-only). The ladder and designation briefs carry a test of the duty.
- **`remeasure-heals-first`** (review 2219, F4). The guard takes the boot step's own port (`AuthorityBootPort`), and
  `remeasure()` heals a torn tail, then measures, as the boot step does, so a crash-left tail is not read `malformed` there.
- **`writer-keeps-the-rows-word`** (review 2219, F6). The writer tells the guard which read failed (`journal-unreadable` or
  `rows-unreadable`, `AUTHORITY_UNREADABLE`), so a head row the append check could not read keeps `unmeasured: rows`. A
  widening that throws before the append is refused `authority-unmeasured` and the guard is not told (row 5w).
- **`append-before-listed-rows`** (review 2219, F9). `appendInTx`'s doc states the caller appends before writing any row of a
  table in `OVERLORD_AUTHORITY_TABLES` in the same transaction; a listed table's row with no record before it reads `missing`.
- **`backup-set-runs-over-a-fixture-home`** (review 2219, F8). Beside the text pin, the snapshot suite sources `ccd/ccrc` and
  runs `_upd_backup_set` and `_upd_backup_pairs` over a fixture home holding the journal, its torn directory and a memory
  directory: only the memory directory is copied, and the listing names neither.
- **`writer-reports-missing`.** `AuthorityGuardPort.writerFailed` takes every coherence cause, `missing` included, beside
  `unreadable`. The plan's list omits `missing`, but the writer measures Table 7.6a at every append, and an absent file beside a
  head row reads `missing` there as it does at boot.
- **`latch-cause-checked-by-shape`.** The grammar checks a latch's cause as a kebab word (at most 64 bytes), never against a
  closed list. The plan says the causes are checked against the ladder's L0 owner; but a latch whose cause a build does not know
  still caps the rung (the ladder plan, question 16), so a record a newer build wrote must still read after a rollback, or the
  journal would read `malformed` for a cause it has no reason to refuse. The rung words are a closed list (the spec's four,
  `OVERLORD_AUTHORITY_RUNGS`) until the ladder re-points them; a pool name is `POOL_NAME_RE`; an opaque token (an operation
  key, a session id, a generation) is printable ASCII with no space, 1 to 128 bytes.
- **`same-rung-is-not-a-widening`.** `authorityDirection` reads a rung record to the same rung, and an account set to itself,
  as `narrows`: it grants nothing. A model-class record reads `widens` whenever its `to` is `fable`, the table's literal rule.
- **`a-second-raise-keeps-the-lower-cap`.** `authorityFold` keeps the lower cap when one cause is raised twice (§7.5: "A new
  latch never raises the cap"). The plan's fold says only that a raised latch keeps its cap.
- **`empty-file-reads-as-absent`.** Coherence reads a file with no complete record and no tail as it reads an absent one: a
  fresh box when no head row or Overlord row stands, `missing` otherwise. A whole-file cut leaves such a file.
- **`heal-with-no-record-and-no-head-row`.** The heal's `prefixSound` counts "no complete record and no head row" as equal, so a
  first record torn before its row committed is healed. Coherence then reads what remains.
- **`journal-binds-its-own-file`.** The journal module exports `overlordAuthorityFileAt(ccrcDir, ops?)`, the one call of A0's
  `chainedJournalFileAt` with this format, so `journal-file-callers.test.ts` names the journal (not `index.ts`) as the adapter's
  binder. Its torn-tail heal is the one new `.cutAside(` call.
- **`boot-step-takes-a-port`.** The boot step (`runOverlordAuthorityBoot`, L4) takes `AuthorityBootPort` (`healTornTail`,
  `measure`), bound to `coord.db` by the composition root, rather than the database handle: in `server/src/coord` only the
  handle holders import `node:sqlite` (`core-vocab.test.ts`), and the journal joins that list as `overlord_authority_head`'s
  one writer.
- **`restore-detected-latch-waits-for-the-ladder`.** The plan's Task 4 has the guard's holder raise the ladder's
  `restore-detected` latch through `raiseLatch` at the boot step and on the guard's first move off `coherent`. The ladder is
  not on `main`, and the ladder plan's seam table gives that raise to authority journal B, so PR A records the verdict in the
  guard and logs it, and raises nothing.
- **`guard-starts-unmeasured`.** Before the boot step's verdict the guard reads `unmeasured: journal`, so nothing that reads it
  early can widen.
- **`writer-fixtures-skip-the-other-migrations`.** The writer's and the guard's suites build their `coord.db` from this
  piece's one migration alone (found by its table): a fixture through `openCoordDb` ran all 81 migrations per case and took
  about three minutes.

## The model's findings (Task 1)

`model-results.md` holds the numbers. What the plan's text should learn from them:

- **`epoch_in_db` is caught by L2, not I7w** (the plan's planted-mutation row now names L2, on the coordinator's word). A `coord.db`-only restore is refused by the heads at boot whatever the stored
  epoch; the harm is the Confirm after it, which sets the epoch from the lowered value, so a witness that answered refuses
  again. The planted-mutation table's row should name the liveness rule's "stays" half (L2).
- **I7w holds within two limits the plan does not state.** It is checked once every off-volume witness that holds a tuple
  has answered since boot (Q8's first window, F7b), and `off` is not a rung target (a rolled-back guard acts at the `chat`
  latch). A third limit, the told narrowings dropped at Confirm, is now an open item the coordinator ruled on (below).

## Later

- **`trailing-narrowing-window`** (review 2219, F3, the coordinator's ruling: no code change). The writer's "at once" fence is
  writer-side. When the caller's own row or commit fails after `appendInTx` answered `appended`, the head row rolls back and
  the guard stays `coherent` until the next append or boot reads the file one record past the head row (`trailing`). If that
  record narrows, the rows are wider than the file's fold in that window while the guard reads `coherent`, against the amended
  I7w's inequality (its told clause is untouched: the door threw, so the operator was never told). Gates B's step 3 must know
  it; the coordinator carries it into the gates B brief. The plan's and the model's "at once" now say writer-side.

## Open for PR B and PR C

- **`told-narrowings-survive-confirm`** (the coordinator's ruling). The model's case: the operator narrows the rung to
  `chat`, a counting witness holds the record's epoch (so the operator is told it took effect), the whole volume is restored
  from a snapshot taken before it, the boot rolls back and raises the `chat` latch, the operator confirms the restore, and
  then clears the latch. A Confirm that reads only the restored rows and the journal (both from before the narrowing) leaves
  the rung at the restored `full`, so the server acts wider than the operator was told. The ruling:
  - **I7w, amended:** an inequality in the safe direction. After Confirm, each row is at least as narrow as the journal's
    fold, never wider; equality is no longer required. A told narrowing is never dropped at Confirm.
  - **PR B:** the off-volume witness carries the newest narrowing state the operator was told took effect (the operator
    rung, Off and the raised latches), beside its counts.
  - **PR C:** Confirm takes the narrowest of the restored rows, the journal and that witness, so a told narrowing survives a
    whole-volume restore; clearing `restore-detected` never widens past it.

  The model shows it green (`model-results.md`): `told` survives Confirm, Confirm takes the told narrowings held by a
  counting witness that answered since boot, and I7w checks the inequality while the guard is coherent. Every W1 scenario
  holds; the mutation `confirm_ignores_told` (Confirm reading only the rows and the journal) is caught by I7w in `restore-w1`,
  and the inequality also catches `writer_failure_unfenced`. PR A's code does not change.
- **`confirm_no_epoch_raise` needs two restores and five exchanges** (about a million states), so it runs under
  `CCRC_MODEL=full` with three other mutations of the `confirm` scenario.

## Mutations measured by hand

Each reddened the case named and was restored from a saved copy: dropping the transaction check; writing the head row before
the append; appending over a head mismatch; appending a narrowing over a rolled-back guard; refusing a narrowing (the rule
X3b withdrew); dropping `writerFailed('trailing')` after a failed head-row write; `remeasure()` clearing a rollback;
`writerFailed` leaving a coherent guard as it is; a boot verdict overriding a rollback; the boot skipping the heal. The L1
deciders' sets are in `server/test/sim/overlordAuthoritySets.ts` (34 mutants, every one killed, floors at 1).

Fix round 1 (review 2219), each reddening its new case and restored from a saved copy: the writer not canonicalising (3 red);
the fold check dropped (4 red); the append check reporting `journal-unreadable` for a head row (1 red); a widening that throws
before the append telling the guard (1 red); `remeasure()` measuring without the heal (1 red).
