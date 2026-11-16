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
  still holds: a narrowing is never refused by the journal's state.
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

- **`epoch_in_db` is caught by L2, not I7w.** A `coord.db`-only restore is refused by the heads at boot whatever the stored
  epoch; the harm is the Confirm after it, which sets the epoch from the lowered value, so a witness that answered refuses
  again. The planted-mutation table's row should name the liveness rule's "stays" half (L2).
- **I7w holds within three limits the plan does not state.** It is checked once every off-volume witness that holds a tuple
  has answered since boot (Q8's first window, F7b); the narrowings the operator was told took effect are dropped at Confirm;
  and `off` is not a rung target (a rolled-back guard acts at the `chat` latch). The second is a decision for PR C and the
  ladder's latch-clear door: after a whole-volume restore and Confirm, clearing `restore-detected` lets the server act on the
  rung row the restore brought back, which can be wider than a narrowing the operator was told took effect.
- **`confirm_no_epoch_raise` needs two restores and five exchanges** (about a million states), so it runs under
  `CCRC_MODEL=full` with three other mutations of the `confirm` scenario.

## Mutations measured by hand

Each reddened the case named and was restored from a saved copy: dropping the transaction check; writing the head row before
the append; appending over a head mismatch; appending a narrowing over a rolled-back guard; refusing a narrowing (the rule
X3b withdrew); dropping `writerFailed('trailing')` after a failed head-row write; `remeasure()` clearing a rollback;
`writerFailed` leaving a coherent guard as it is; a boot verdict overriding a rollback; the boot skipping the heal. The L1
deciders' sets are in `server/test/sim/overlordAuthoritySets.ts` (34 mutants, every one killed, floors at 1).
