# The ledger-edit guard: Plan note

PR #1520 adds `.github/ci/ledger-guard.mjs` and its own `ledger guard` CI job: a pull request whose head branch is
not `ledger/<programme>` may not modify, delete or rename away an existing file under `docs/superpowers/programs/`
or `docs/superpowers/plans/`; it adds a new note instead. This note is a new file for that reason. One number,
D-6926, was issued for the rule.

## Deviations found

- **D-6926** — `ledger-guard`: shared ledger documents change only on a `ledger/<programme>` branch, checked by
  `.github/ci/ledger-guard.mjs` (tested in `server/test/ci-ledger-guard.test.ts`) in a job of its own, so an error
  or a violation there fails only that check and never skips the test jobs. The escape is a `Ledger-Edit: <reason>`
  trailer on the pull request's head commit; a trailer on an earlier commit does not count. It runs warn-only
  (`LEDGER_GUARD_MODE: warn`, step `continue-on-error`) until the open pull requests that edit a ledger have landed.
