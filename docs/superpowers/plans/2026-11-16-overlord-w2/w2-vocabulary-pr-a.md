# Overlord W2 vocabulary, PR A: build notes

Notes from building `w2-vocabulary.md` (Tasks 1 to 3) in one pull request. The coordinator folds them into the
ledger on its own pull request; this file edits no ledger row.

## What shipped

- `shared/refusal.ts#OVERLORD_REFUSALS` holds the eleven W2 words of Table V1, each with the status the plan's
  question 1 gives it, after `read-ceiling`. The group's doc comment and the spread's comment in `REFUSAL_STATUS`
  say W1 and W2.
- `server/test/single-definition/refusal-table.data.json`'s `waveMap` holds no `W2` entry.
- `server/test/single-definition/refusal-table.test.ts` pins `W2_GROUP` beside `W1_GROUP`, takes `W2` out of
  `WAVES`, and adds two controls.

## Departures, by slug

The plan's three slugs, built as written:

- **`w2-word-statuses`**: the eleven statuses of Table V1.
- **`w2-words-no-console-sentence-yet`**: no sentence in `pwa/src/lib/refusalWords.ts`.
- **`w2-leaves-the-wave-list`**: `WAVES` loses `W2`.

One more, found in passing (slug **`w2-vocab-mutation-harness`**): `mutation-run.py` compiles a Python module, and
the guarded file is TypeScript. The run wraps `shared/refusal.ts`'s text in a one-string Python module, and its test
function writes each mutant's text over the file, runs the guard, and restores the file from a saved copy. The file
was byte-identical to that copy after the run.

## Measurements

- **Red first (Task 1):** `refusal-table.test.ts` on the base, with the W2 pins: 3 failed, 21 passed. The two new
  controls passed.
- **Green (Task 2):** 24 passed.
- **Mutation (Task 2, step 5):** eleven row deletions and eleven one-family status changes (403 to 409, 409 to 403,
  429 to 409, 400 to 409): killed 22 of 22.
- **Readers (Task 3):** `practice-cases` 21, `single-definition/vocabularies` 158, `refusal-status` 27, all passed.
  Eighteen `pwa` suites that read `shared/refusal.ts` or `refusalWords.ts` passed.
- **Type checks:** server `tsconfig.json`, server `test/tsconfig.tests.json` and `pwa`: no errors.
- **Guards:** every `single-definition/*` and `rings/*` file, `sim/mutation-floors` (126), `growth-check` (armed,
  61 passed, 3 skipped), `anchors`, `citations`, `dtbd`, `topology-clean`, `typecheck-tests`, `private-names` and
  `deviation-refs` (after `git fetch origin main`): all passed, one file at a time.
- **Shared file:** `shared/refusal.ts` is co-edited with portfolio B (#2904), which agreed. Its edit is a
  `LEDGER_ROUTE_REFUSALS` row and does not overlap this one; whichever lands second merges `main` once.
