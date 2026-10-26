# The architecture spec's status refresh: Plan note

PR #1568 refreshes the status tables of `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` to match
`main` (ARCH-02a, #528). This note is a new file because shared ledger documents change only on a ledger branch. One
number, D-6992, was issued for the refresh.

## Deviations found

- **D-6992** — `spec-status-refresh` (ARCH-02a, #528): the 2026-08-10 architecture spec's status rows are re-measured on
  `main` and cited by symbol, never by line number. Increments 4, 5 and 6 read done: the one guarded delivery writer
  (`CoordStore`'s `writeDelivery`, answering `DeliveryWrite`) closed ARCH-15 (#532), and `FleetWatcher.mailPass` reads
  every answer through `FleetWatcher.landed`; the catch-to-null folds moved with ARCH-08b (#534). Increment 7 reads
  partly: ARCH-03 (#541) added the consumer-side ports, but the watcher still takes the whole `CoordStore`
  (`Deps.coord`). Enforcement rows for wire totality (ARCH-12, #552) and the docstring-claim rule (ARCH-07, #558) read
  done; the import-direction row stays partly, with the exemption sets that remain only allowed to shrink. Docs only:
  no code or test changes.
