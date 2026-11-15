# The Overlord W1 pool set, PR A2 (Task 3): measurements and departures

This note belongs to `w1-pool-set.md` and sits beside `w1-pool-set-departures.md` (PR A1's), which a feature pull request
may not edit. The coordinator folds it into the ledger. A departure is named by a slug; no D-number is invented.

## Characterization (Step 1), green on `main` before any edit

| Suite | Tests passed |
|---|---|
| `server/test/ccd-pool-ok.test.ts` | 48 |
| `server/test/ccd-route-fields.test.ts` | 49 |

The `_pool_ok ` line count over `ccdSource()` was 16 (the figure `ccd/ccd`'s header states). Today's project and account
sentences of `_pool_undecidable_why` and `_pool_mismatch_why` are pinned by the new suite's characterization block, green
against the unchanged renderers before their set arms were added.

## What PR A2 adds

- `ccd/lib/pool-set.sh`: `_session_pool_side` (the one reader of a session's side), `_pool_ok_set` (`_pool_ok`'s set
  case, called bare), and the two set renderers `_pool_set_undecidable_why` and `_pool_set_mismatch_why`.
- `ccd/ccd`: `_pool_ok`'s one set arm, `_pool_undecidable_why`'s fifth argument (the session id) and its set arm,
  `_pool_mismatch_why`'s set arm, and `cmd_route`'s refusal of a `poolset` or `acctorder` write from a session's shell.
- Nothing calls `_session_pool_side` yet (Task 4 is PR A3), so placement is unchanged.
