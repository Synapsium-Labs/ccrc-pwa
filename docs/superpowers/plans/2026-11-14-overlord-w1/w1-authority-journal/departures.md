# Authority journal A0: the builder's departures

The builder's notes for PR A0 of `docs/superpowers/plans/2026-11-14-overlord-w1/w1-authority-journal.md` (Task 2: `chainNext`,
the byte-level append-only port and the chained-journal file adapter). Each departure from the plan's text is a plain-words
slug, never a D-number (cross-plan ruling X9). The coordinator folds what the ledger should learn into it.

## Departures

- **`landing-fs-ops-is-the-io-subset`.** The plan says `AppendOnlyFsOps` is `LandingJournalFsOps` renamed, with
  `ftruncateSync`, `mkdirSync` and `renameSync` added, and re-exported under its old name. The landing journal's own tests
  build a six-operation double, and a test may change only its imports in a move. So `LandingJournalFsOps` is the
  six-operation subset (`AppendOnlyIoOps`), and `createLandingJournal` fills the cut's operations (`fchmodSync`,
  `ftruncateSync`, `mkdirSync`, `renameSync`; fix round 1 added `fchmodSync`) from `node:fs`. The landing binding never
  cuts, so they are never called through it.
- **`aside-dir-is-a-child-name`.** The plan's `AppendOnlyCut.asideDir` is "the directory the cut bytes are kept in". The port
  takes it as ONE path component, a directory inside the journal's own directory (the authority journal's
  `~/.ccrc/overlord-authority-torn/` is one). That makes the cut's durability exact: the directory's entry is made durable by
  the parent fsync the port already does, before the truncate. A path of more than one component, `.`, `..`, or an empty
  name is refused as a `RangeError` before any I/O, as are an offset outside the file and a kept name ending `.partial`
  (the port's temporary name for the kept bytes before the rename).
- **`cut-arguments-are-range-errors`.** An argument outside the cut's contract (above), and a cut asked of an absence
  snapshot, are programming errors and throw `RangeError`; they are not words of `AppendOnlyCutError`. Every I/O outcome is
  still an answer. Since fix round 1 (review 2191 F10) the cut spends the snapshot before it throws, so "a cut spends it"
  holds on every path.
- **`append-over-a-torn-tail-is-malformed`.** `appendNext` answers `malformed` on `go` over a file that ends in a torn tail as
  well as over a `malformed` one: a file with a tail has no clean end to append after. The caller heals (`cutAside` with the
  kernel's plan) first. `check` still sees the tail, so the caller decides.
- **`adapter-reads-complete-from-start`.** The adapter verifies every file as complete from sequence 1 (`completeFromStart`):
  neither W1 journal is ever compacted, and a whole-file cut starts the new chain at record 1. A journal that is ever
  compacted would need an option here.
- **`census-reads-the-adapter-as-a-taker`.** `chained-journal-formats.test.ts` reads the format-taking exports of
  `chainedJournalFile.ts` as well as the kernel's, so a format passed only to `chainedJournalFileAt`, unannotated, is still
  found by the kinds census. The plan did not name this; it keeps the census whole once both W1 journals bind the adapter.
- **`truncate-census-lists-the-port-cut`.** `delegation-wave3.integration.test.ts` keeps a closed list of every truncating
  call in a server file that can reach a file. The port's one cut adds three spellings there (its fs-operations member,
  that member's `node:fs` default, and the cut's one call), so the list names them, with a comment saying they cut the
  Overlord's chained journals and name neither delegation file. The plan did not name this census.
- **`whole-cut-name-is-content-addressed`** (review 2191 F1, the coordinator's ruling). The plan's
  `{ kind: 'whole'; asideName: string }` is `{ kind: 'whole' }`: the adapter derives the kept name,
  `<length>-<sha256>.whole` (`wholeCutName`), as the kernel's heal plan names a tail `<offset>-<sha256>.tail`. Confirm the
  restore over a `malformed` journal (Task 8, question 17) passes no name.
- **`kept-name-never-replaced`** (F1). The port opens an existing kept name before it writes: other bytes there answer
  `changed` and nothing is removed or replaced; the same bytes are an idempotent retry and answer ok. A directory or a
  symlink at the kept name is `unwritable`.
- **`one-writer-process-per-file`** (F4). The port's header states that each file it binds has one writer process, and that
  the port re-proves but does not lock, so a second writer is caught afterwards (`changed`), never prevented. The cut also
  compares `fstat(fd).size` with the snapshot's length just before it truncates.
- **`modes-fixed-through-descriptors`** (F7, the coordinator's ruling). An existing quarantine directory that is not 0700 is
  set to 0700 through its descriptor, and the temporary file to 0600 before the rename; a failed `fchmod` is `unwritable`.
  The port's fs operations gain `fchmodSync`. The plan said "created, mode 0700, when absent"; the cut never refuses a
  wider mode, it narrows it.
- **`aside-path-reproved-after-rename`** (F8). After the rename the cut re-opens the quarantine path (`O_NOFOLLOW`,
  `O_DIRECTORY`) and compares its identity with the descriptor it holds; a mismatch is `changed`, before any truncate.
- **`space-words-cut-only`** (F9, F12b). In the cut, `ENOSPC`, `EDQUOT` and a directory where a file is made (`EISDIR`) are
  `unwritable`, and `ELOOP` at the open of the leaf for the cut is `changed`. The append's open keeps the words it had
  before the move (only `EACCES`, `EPERM` and `EROFS` are `unwritable`), so the landing journal's answers are unchanged; the
  append's open now reuses the shared `writeFailure` for exactly that mapping.
- **`journal-file-callers-census`** (F3). `server/test/journal-file-callers.test.ts` holds who binds the port (the landing
  binding and the adapter), who binds the adapter (none yet: authority journal A and private store A each add their file),
  every `.cutAside(` call (the adapter's only), and that no chained-journal binding names the landing journal's file.
- **`notes-file-path`.** The brief names `w1-authority-journal-a0.md` for these notes; the plan's Global Constraints name
  `w1-authority-journal/departures.md`. The plan governs (worker clause 6), so this file is the plan's.

## Mutations measured by hand (Step 5)

Recorded in the pull request body with the case each one reddened.
