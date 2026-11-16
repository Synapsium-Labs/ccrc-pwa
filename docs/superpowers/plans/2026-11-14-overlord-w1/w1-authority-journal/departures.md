# Authority journal A0: the builder's departures

The builder's notes for PR A0 of `docs/superpowers/plans/2026-11-14-overlord-w1/w1-authority-journal.md` (Task 2: `chainNext`,
the byte-level append-only port and the chained-journal file adapter). Each departure from the plan's text is a plain-words
slug, never a D-number (cross-plan ruling X9). The coordinator folds what the ledger should learn into it.

## Departures

- **`landing-fs-ops-is-the-io-subset`.** The plan says `AppendOnlyFsOps` is `LandingJournalFsOps` renamed, with
  `ftruncateSync`, `mkdirSync` and `renameSync` added, and re-exported under its old name. The landing journal's own tests
  build a six-operation double, and a test may change only its imports in a move. So `LandingJournalFsOps` is the
  six-operation subset (`AppendOnlyIoOps`), and `createLandingJournal` fills the three cut operations from `node:fs`. The
  landing binding never cuts, so they are never called through it.
- **`aside-dir-is-a-child-name`.** The plan's `AppendOnlyCut.asideDir` is "the directory the cut bytes are kept in". The port
  takes it as ONE path component, a directory inside the journal's own directory (the authority journal's
  `~/.ccrc/overlord-authority-torn/` is one). That makes the cut's durability exact: the directory's entry is made durable by
  the parent fsync the port already does, before the truncate. A path of more than one component, `.`, `..`, or an empty
  name is refused as a `RangeError` before any I/O, as are an offset outside the file and a kept name ending `.partial`
  (the port's temporary name for the kept bytes before the rename).
- **`cut-arguments-are-range-errors`.** An argument outside the cut's contract (above), and a cut asked of an absence
  snapshot, are programming errors and throw `RangeError`; they are not words of `AppendOnlyCutError`. Every I/O outcome is
  still an answer.
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
- **`notes-file-path`.** The brief names `w1-authority-journal-a0.md` for these notes; the plan's Global Constraints name
  `w1-authority-journal/departures.md`. The plan governs (worker clause 6), so this file is the plan's.

## Mutations measured by hand (Step 5)

Recorded in the pull request body with the case each one reddened.
