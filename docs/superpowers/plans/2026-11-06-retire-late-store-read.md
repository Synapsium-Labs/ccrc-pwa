# Retire acts re-read the run store nearest the argv

The operator ruled on OA-C20 (plan `2026-10-27-consolidation-arch44-retire.md`) on 2026-11-06: the retire executors stay
on the session's queue, off the coordination serialiser, and child-spent and archive-expired move their store check as
close to the verb as it can go. This plan records the code half. The correction to spec K1's wording is its own change.

## What changed

Both rows gain one step, `store-last`, after their last listing and before anything else. Temp-folder cleanup's
`hold-last` has the same place in its row. The steps from it to the argv are synchronous, so the store rows it reads are
the rows the argv is composed on.

The check before the audit stays. It is what stops a row with an open run from spending an audit, and every outcome it
answers keeps its word and order.

- **archive-expired:** `readExpiryStore` again. It was already synchronous. The step stands before the shadow arm, so
  "would expire" says what the verb would have done.
- **child-spent:** this is not the same read again, because `readChildSiblings` waits on the registry once per claimant.
  A read that waited would leave that wait between the store and the argv. So the read splits: the `store` step keeps
  the claimants it placed (`readChildSiblingsPlaced`), and `store-last` repeats only the store half
  (`childSiblingsAtAct`) over them, then the coordination fence. A claimant the earlier read did not place is
  `unmeasured`, and its run keeps the child.

## Deviations found

- **D-8091 (2026-11-06)** — Retire acts re-read the run store nearest the argv: child-spent and archive-expired gain `store-last` past their last await (OA-C20's ruling), and child-spent's is the store half alone, over the claimants its earlier read placed.
