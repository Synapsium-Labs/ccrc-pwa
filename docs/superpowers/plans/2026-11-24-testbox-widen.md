# Test box: widen what the box runs, as one row of several packages

**Goal:** the test box runs this repository's `agent`, `ui` and `pwa` packages, and the `tsc` head, as well as the
`server` package's vitest runs, through the repository table that already exists (spec 2026-10-28 §2.5, §2.6).

**Why:** on the first day with remote runs on, the fleet's runs log held more `runs-locally` fallbacks than remote runs.
The box's row named one package, `server`, with one command head, `./node_modules/.bin/vitest`. Of the fallbacks whose
command could be read back, about half were `pwa` vitest and `tsc` runs, and about a third were `server` typechecks.
The box's reader (`shared/testbox.ts#parseRepoRow`), its gate (`agent/src/testbox/spec.ts#commandHead`) and its prepare
(`agent/src/testbox/service.ts`, one install step per row package, in row order) already take a row of several packages
with several heads. The only thing that made one package with one head was the connect card's row builder.

**What is config, not code.** No row ships in the tree (spec 2026-11-07 C15: the operator fills it on the card). Widening
the live box is a new row in its repository table, applied by root on the box with the installed installer's
`--reapply --repos <row file>`. That edits `repos.d` only, so the box file's digest, and with it the parity record, does
not move. This plan changes the card, so a later Connect (or Replace) writes the same wide row rather than narrowing it
back to one package.

## Task 1: the card builds several packages and several heads (D-9009)

- [x] `pwa/src/fleet/testboxAdminWords.ts` (L1): `repoRowOf` and `repoDraftProblems` move here from the card, which
  only renders them. The package field takes folders in install order, separated by spaces. The command field takes
  heads separated by commas, every package gets every head, and the default is §2.5's four heads with the runner first
  (`TESTBOX_DEFAULT_HEADS`). The first package's first head stays the one parity runs (`_tba_row_record`). A typed
  install input goes to the listed package its path starts with, else to the first package, so a one-package draft
  builds exactly the row it built before.
- [x] `pwa/test/testbox-repo-draft.test.ts`: the default heads, a four-package row that `parseRepoRow` takes, the input
  assignment, and each field's problem (a package or head named twice is said on its own field, not as a bad row).
  It was red before the move (the functions did not exist), and green after.
- [x] `pwa/src/fleet/TestBoxConnect.test.tsx`: Install sends a two-package row, each package with the default heads.

## Task 2: the live row (operator, by hand, on the box)

Not a change to this tree. The row the operator applies, and the measurements behind it, are in the PR description.
Install order is `server`, `agent`, `ui`, `pwa`, as spec §2.2 orders them: `server` stays first, so parity's leg is
unchanged; `ui` comes before `pwa`, whose `@ccrc/ui` link resolves `ui`'s dependencies from `ui/node_modules`.

## Deviations found

- **D-9009** — the connect card could only build a repository row of one package with one command head, while the box's
  row reader, its gate and its prepare all take several. The card now builds several of each (Task 1), and §2.5's four
  heads are its default. Left open: there is no act that changes a connected box's rows. Connect is the only writer
  of the fleet host's row record (`_tba_rows_save`), so a row applied by root on the box is not on that record. Parity
  still runs the record's first package and first head, which a row that keeps `server` and the runner first leaves the
  same.
- **D-9010** — measured while widening: the server tests typecheck (`tsc --noEmit -p test/tsconfig.tests.json`) needs
  `agent`'s `node_modules`, because its program includes `agent/src` (which imports `ws`). It cannot pass on a box whose
  row lacks `agent`, which is one reason `agent` joins the row. Under TypeScript 7's native compiler that typecheck
  peaked at about 4.8 GB resident on a 14-core workstation. That is above the run slice's default
  `CCRC_TESTBOX_RUN_MEMORY_MAX` (4G, swap 1G), so on the box it may be killed for memory, which a session would read as
  a red run. `server`'s own `tsc --noEmit` peaked at about 0.8 GB, and `pwa`'s (TypeScript 6) at about 2.2 GB. Left
  open: measure the tests typecheck on the box. Until then, either raise the run memory limit (a run-shaping setting,
  so parity goes stale and is run again) or accept that this one command can fail there for memory.
