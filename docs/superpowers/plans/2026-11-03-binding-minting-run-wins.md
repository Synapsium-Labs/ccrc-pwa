# D6 gap 1 follow-up (#1532): the open minting run wins

**Status:** as built, 2026-11-03. Follow-up to #1407 and PR #1573, whose plan note
(`docs/superpowers/plans/2026-10-26-arch-60-adopted-arm-residual.md`) records the residuals this closes, the gap 2
fallback stamp that round 8 withdrew, and the two narrower fallbacks it rejected. This note defines the one deviation
the PR names. It writes no stamp, adds no column and runs no migration.

## Decision

- **D-7877 (2026-11-03)** — `binding-minting-run-wins`. While the run a child's mark names is still open, still names
  the child and records a dispatch start, and the child's birth cannot be placed (`unplaceable`), that run is the
  child's occupant and it wins over the id-string pick. A run naming the child does not bind when all four hold:

  1. it opened before the minting run's `dispatchStartedAt`;
  2. another coordinator claims it (its `claimedBy` is not the minting run's);
  3. it carries a birth recorded for this child (`sessionBornFor` is the child's id);
  4. that birth is older than the minting run's `dispatchStartedAt`.

  Such a run was bound to an earlier occupant of the name, so it is no parent, claimant or child of the live one. Every
  other run keeps the id-string rule. A coordinator, a manual workspace, an unreadable mark, a closed minting run, one
  that names another session and one with no dispatch start are read as before. Born children are read as before.

  Where it lives: `server/src/coord/runBinding.ts` (`bindsRun`, through `OpenMint` on the unborn incarnation, which only
  `incarnationOf` builds from the minting run's row). The three places that build a child's incarnation from its mark
  pass that row: `incarnationOfMark` (the fleet card and the runs frame's `childIds`), `heldFor` and the drift lane. The
  stamp writer (`CoordStore.stampOccupantBirth`), the birth columns, the explicit-null adopted bind (D-6993) and the
  delegation reads (`claimantAt`) are unchanged.

## Why each clause, and why not the triage wording as written

The triage wording was: runs that predate the minting run and belong to another occupant answer `unbound`, using the
stamped birth where present, else `openedAt` against the minting run's `dispatchStartedAt`. Measured on the corpus, two
parts of it made shapes worse than main, so the rule keeps only the part that never did:

- **A stamp alone does not prove an earlier occupant.** The stamp is the merge base's: the newest placeable birth on
  record for the id. While the minting run's birth cannot be placed, a wave bound to the live occupant records the
  EARLIER occupant's birth. In "the adopted arm under a recycled name, the earlier occupant's run still open with the
  LOWER id, then a later wave", wave2 opened after the adoption and records T1, the earlier occupant's birth. Read by
  its stamp, it dropped out of the card and of coord-live's `childIds`. Clause 1 keeps it: a run opened after the
  dispatch start cannot be an earlier occupant's.
- **`openedAt` alone does not prove one either.** A run with no birth that opened before the dispatch start is either an
  earlier occupant's run bound by an older build or the live occupant's pre-planned wave bound with no stamp. P10 and P6d
  are the second: no name is reused, and another coordinator's pre-planned wave L, bound by an older build, dropped out
  of `claimants` and coord-b's `childIds`. Clause 3 keeps it, and a birth recorded for another session (a leftover birth,
  row M-X) is read the same way: never as this child's.
- **The minter's own runs.** The minting run itself opened before its own dispatch start and, after a redraw, carries
  its earlier birth; the minter's pre-planned waves can carry an earlier birth too. Clause 2 keeps every run its
  coordinator claims bound, as before. The series read by ordinal proves no run id, so the minting run is recognised by
  its claimant, not by its id.

## The counted exit, as measured

`server/test/run-binding-probe-corpus.test.ts` has 52 cases plus the consistency check on main, and 58 plus the check
here (59 tests). The `base` column is green over main's sources (`BINDING_CORPUS_EXPECT=base`, with
`runBinding.ts`, `runWire.ts`, `heldFor.ts` and `driftLane.ts` taken from `origin/main`), and the branch's answers are
green over this branch.

- **Six new rows, each better than main** (each was red on main before the rule):
  - **M-G1 (gap 1):** an unplaceable child (its minting run re-dispatched, the bind not recorded yet) under a reused
    name, the earlier occupant's minting run still open: coord-gone no longer claims or lists it.
  - **M-W (gap 2):** another coordinator's later wave bound while the minting run's birth cannot be placed (an older
    build minted it), the earlier occupant's minting run still open: the wave records the earlier birth and still binds,
    and coord-ghost drops out.
  - **M-A (adopted arm):** the earlier occupant's open run holds the higher id, then the adopter's later wave: the parent
    is coord-live, not coord-gone.
  - **M-R3 (rollback):** the minting run open and redrawn, with three open waves from three coordinators: coord-live is
    the parent, and neither ghost coordinator lists the child.
  - **M-X (leftover birth):** a wave carrying another session's birth stays bound, and the earlier occupant's run drops out.
  - **M-M (re-mint):** another coordinator's wave stamped with the occupant's birth, then a same-id re-mint whose bind is
    not recorded yet: coord-a, not coord-b, is the parent.
- **Five existing rows flip to better** (same premise): "the adopted arm under a recycled name … LOWER id", R1, R2, and
  the two former residuals "the adopted arm with the earlier occupant's open run holding the HIGHER id" and "a
  cross-build rollback with C's minting run R still open and a third coordinator's open wave".
- **No row answers worse than main.** The other 47 cases keep main's answer.

The readers' suites stay green one file at a time: `run-binding`, `run-binding-readers`, `run-binding-bind-records`,
`run-binding-census`, `run-binding-characterization`, `run-binding-occupant-birth`, `run-binding-bound-birth`,
`run-wire`, `bindings-of`, `drift-lane`, `drift-findings`, `drift-push`, `fleet`, `coord-store`, `run-routes`,
`w7-run-binding-parity`, `cross-project-claimant-security` and the census and pin suites that read the binding.
`asks-mint.test.ts` has 6 failures on this machine that main's sources give too (unrelated to the binding).

## Mutation table

Each mutation applied alone to this branch; the count is failed tests per file.

| Mutation | corpus (59) | `run-binding` (24) | `drift-lane` (26) | `run-binding-bind-records` (23) |
|---|---|---|---|---|
| Drop the rule (an unborn child always binds by the id-string rule) | 11: the six new rows and the five flips | 1 | 1 | 0 |
| Invert the predicate | 13: those 11, P10 and P6d | 1 | 1 | 1 |
| Ignore the explicit null (the adopted arm's bind stamps like a later wave) | 0 | 0 | 0 | 4: the census pins the arm by name |
| Drop clause 1 (opened before the start) | 1: M-W | 1 | 0 | 0 |
| Drop clause 2 (another coordinator) | 7: R1, R2, the rollback flip, M-G1, M-R3, M-X, M-M | 1 | 0 | 0 |
| Drop clause 3 (recorded for this child) | 1: M-X | 1 | 0 | 0 |
| Drop clause 4 (older than the start) | 0 | 1 | 0 | 0 |
| `heldFor` builds the incarnation without the minting run | 5: the HIGHER-id flip, the rollback flip, M-A, M-R3, M-M (the `held` column) | 0 | 0 | 0 |
| The drift lane builds it without the minting run | 0 | 0 | 1 | 0 |
| `incarnationOfMark` builds it without the minting run | 11 | 0 | 0 | 0 |

## Known limits

- **Another coordinator's pre-planned wave, bound while the birth cannot be placed.** A wave planned before the minting
  run's dispatch start, claimed by another coordinator and bound by this build after it, while the child's birth cannot
  be placed, records the newest placeable birth on record for the id. When that is an earlier occupant's, the four
  clauses hold and the wave does not bind, though it is the live occupant's. Measured on a scratch fixture (an earlier
  occupant minted and done, the adopted arm, then the pre-planned wave bound): main answers that coordinator as the
  parent and both coordinators as claimants; this branch answers the minting run's coordinator alone. The columns cannot
  tell this wave from an earlier occupant's wave bound before the dispatch start, because the bind time is not recorded:
  the plan note's conclusion that the birth columns alone cannot say which incarnation a stamp belongs to still holds. It
  lasts only while the minting run is open, and its answer is the minting run's own claimant. It is not a corpus row,
  because the corpus pins no case worse than main.
- **Residuals left.** Every corpus row still marked `inherited`: GAP 1 with the minting run done, gap 2's three rows (no
  open minting run or no dispatch start), the leftover birth on a born child (R8-X1c-ctrl, N8c) and the waves bound
  before a same-id re-mint that is recorded (R8-M1, R8-M2, R8-M4, R8-A1), where the child is born at read time. A wave
  with no birth bound before a re-mint whose bind is not recorded yet keeps the id-string rule (clause 3).
- **A child with no mark.** A coordinator or a manual workspace that reuses a name has no minting run, so it keeps the
  id-string rule.
