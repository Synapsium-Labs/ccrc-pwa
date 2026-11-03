# D6 gap 1 follow-up (#1532): the open minting run wins

**Status:** as built, 2026-11-03. Follow-up to #1407 and PR #1573, whose plan note
(`docs/superpowers/plans/2026-10-26-arch-60-adopted-arm-residual.md`) records the residuals this closes, the gap 2
fallback stamp that round 8 withdrew, and the two narrower fallbacks it rejected. This note defines the one deviation
the PR names. It writes no stamp, adds no column and runs no migration.

## Decision

- **D-7877 (2026-11-03)** — `binding-minting-run-wins`. While the run a child's mark names is still open, still names
  the child and records a dispatch start, and the child's birth cannot be placed (`unplaceable`), that run is the
  child's occupant and it wins over the id-string pick. A run naming the child does not bind when all five hold:

  1. it opened before the minting run's `dispatchStartedAt`;
  2. another coordinator claims it (its `claimedBy` is not the minting run's);
  3. it carries a birth recorded for this child (`sessionBornFor` is the child's id);
  4. that birth is older than the minting run's `dispatchStartedAt`;
  5. that birth is the run's own mint (it equals the run's own `dispatchStartedAt`, the placeable birth `childBirthOf`
     and the stamp writer recognise) or the minting run's own earlier birth (the `sessionBornAt` the minting run
     recorded for this child, older than its dispatch start: the occupant before a redraw or a re-dispatch).

  Such a run was bound to an earlier occupant of the name, so it is no parent, claimant or child of the live one. Every
  other run keeps the id-string rule. A coordinator, a manual workspace, an unreadable mark, a closed minting run, one
  that names another session and one with no dispatch start are read as before. Born children are read as before.

  Where it lives: `server/src/coord/runBinding.ts` (`bindsRun`, through `OpenMint` on the unborn incarnation, which only
  `incarnationOf` builds from the minting run's row). The three places that build a child's incarnation from its mark
  pass that row: `incarnationOfMark` (the fleet card and the runs frame's `childIds`), `heldFor` and the drift lane. The
  stamp writer (`CoordStore.stampOccupantBirth`), the birth columns, the explicit-null adopted bind (D-6993) and the
  delegation reads (`claimantAt`) are unchanged. The series read (`CoordStore.bindingRunsOf` and `bindingRows.ts`) now
  also carries each run's `dispatchStartedAt`, an existing column, for clause 5.

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
- **A stamped birth is no proof of whose wave it is (clause 5, review round 2).** Another coordinator's pre-planned wave,
  opened before the dispatch start and bound by this build after it, is stamped with the newest placeable birth on
  record. While the minting run's birth cannot be placed that is an EARLIER occupant's birth, though the wave is the live
  occupant's. With clauses 1 to 4 alone it dropped out: its coordinator lost the parent, its claim and its `childIds`,
  and the card showed the minting run (rows M-P1, M-P2 and M-P3, each worse than main before clause 5). The bind time is
  not recorded, but the birth itself says which occupant it names. An earlier occupant's own minting run carries its own
  dispatch start as its birth. A wave bound to the minting run's occupant before the redraw carries the minting run's
  own earlier birth, which the stamp writer can no longer pick once the redraw or re-dispatch has moved the dispatch
  start. A wave bound after the start can carry neither, so clause 5 keeps it bound, as on main.

## The counted exit, as measured

`server/test/run-binding-probe-corpus.test.ts` has 52 cases plus the consistency check on main, and 62 plus the check
here (63 tests). The `base` column is green over main's sources (`BINDING_CORPUS_EXPECT=base`, the file run in a
worktree of `origin/main`), and the branch's answers are green over this branch.

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
- **Four rows from review round 2, another coordinator's pre-planned wave bound after the dispatch start** (each answered
  worse than main under clauses 1 to 4, and keeps main's answer or better with clause 5):
  - **M-P1:** the adopted arm, an earlier occupant minted and done, wave X opened before the adoption and bound after
    it, stamped with the earlier occupant's birth: coord-x stays the parent, a claimant and X's lister (`same`).
  - **M-P2:** the same with the wave opened between the adopting run's open and the adoption (`same`).
  - **M-P2o:** M-P2 with the earlier occupant's minting run still open: that run drops out and the wave stays (`better`).
  - **M-P3:** a redrawn minting run instead of the adopted arm, the wave stamped with the earlier occupant's birth
    because the minting run's own is no longer placeable (`same`).
- **No row answers worse than main.** The other 47 cases keep main's answer.

The readers' suites stay green one file at a time: `run-binding`, `run-binding-readers`, `run-binding-bind-records`,
`run-binding-census`, `run-binding-characterization`, `run-binding-occupant-birth`, `run-binding-bound-birth`,
`run-wire`, `bindings-of`, `drift-lane`, `drift-findings`, `drift-push`, `fleet`, `coord-store`, `run-routes`,
`w7-run-binding-parity`, `cross-project-claimant-security` and the census and pin suites that read the binding.
`asks-mint.test.ts` has 6 failures on this machine that main's sources give too (unrelated to the binding).

## Mutation table

Each mutation applied alone to this branch; the count is failed tests per file.

| Mutation | corpus (63) | `run-binding` (25) | `drift-lane` (26) | `run-binding-bind-records` (23) |
|---|---|---|---|---|
| Drop the rule (an unborn child always binds by the id-string rule) | 12: the six M rows, the five flips, M-P2o | 2 | 1 | 0 |
| Invert the predicate | 17: those 12, P10, P6d, M-P1, M-P2, M-P3 | 2 | 1 | 1 |
| Ignore the explicit null (the adopted arm's bind stamps like a later wave) | 3: M-P1, M-P2, M-P2o | 0 | 0 | 4: the census pins the arm by name |
| Drop clause 1 (opened before the start) | 0 | 2 | 0 | 0 |
| Drop clause 2 (another coordinator) | 8: R1, R2, the rollback flip, M-G1, M-R3, M-X, M-M, M-P3 | 2 | 0 | 0 |
| Drop clause 3 (recorded for this child) | 0 | 2 | 0 | 0 |
| Drop clause 4 (older than the start) | 0 | 1 | 0 | 0 |
| Drop clause 5 (any older birth will do: review round 1's rule) | 4: M-P1, M-P2, M-P2o, M-P3 | 2 | 0 | 0 |
| Clause 5 without the run's own mint | 7: the LOWER-id and HIGHER-id flips, M-G1, M-W, M-A, M-X, M-P2o | 1 | 1 | 0 |
| Clause 5 without the minting run's earlier birth | 5: R1, R2, the rollback flip, M-R3, M-M | 1 | 0 | 0 |
| The earlier birth read for any session, or not older than the start | 0 | 1 | 0 | 0 |
| `heldFor` builds the incarnation without the minting run | 5: the HIGHER-id flip, the rollback flip, M-A, M-R3, M-M (the `held` column) | 0 | 0 | 0 |
| The drift lane builds it without the minting run | 0 | 0 | 1 | 0 |
| `incarnationOfMark` builds it without the minting run | 12 | 0 | 0 | 0 |

Clauses 1 and 3 no longer change a corpus row: clause 5 already keeps M-W's later wave and M-X's leftover birth bound.
They stay because they are the measured reasons of round 1 and the unit tests pin each one.

## Known limits

- **An earlier occupant's wave that only carries that occupant's birth.** A wave bound to an earlier occupant E, stamped
  with E's birth, is neither its own mint nor the minting run's earlier birth, so it keeps the id-string rule while E's
  own minting run drops out. The columns cannot tell it from the live occupant's pre-planned wave bound after the
  dispatch start (M-P1 to M-P3), because the bind time is not recorded, so it answers as on main: a residual, not a
  regression.
- **Residuals left.** Every corpus row still marked `inherited`: GAP 1 with the minting run done, gap 2's three rows (no
  open minting run or no dispatch start), the leftover birth on a born child (R8-X1c-ctrl, N8c) and the waves bound
  before a same-id re-mint that is recorded (R8-M1, R8-M2, R8-M4, R8-A1), where the child is born at read time. A wave
  with no birth bound before a re-mint whose bind is not recorded yet keeps the id-string rule (clause 3).
- **A child with no mark.** A coordinator or a manual workspace that reuses a name has no minting run, so it keeps the
  id-string rule.
