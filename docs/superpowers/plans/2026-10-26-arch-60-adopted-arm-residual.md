# ARCH-60 follow-up (#1407): the adopted arm's residual

A plan note for PR #1573 (every bind records the incarnation it binds to). It defines the one deviation that PR leaves
standing. It edits no other plan and no programme ledger.

## The counted exit, as measured

`server/test/run-binding-bind-records.test.ts` drives every call of `bindSession`, `setSession` and `markDispatched` in
`server/src` through the path that reaches it, over one fixture: a worker whose only birth on record cannot be placed by
`childBirthOf`. It reads what each bind wrote on the run it bound. Run over the pre-fix source (`d6aae6879`), 5 of the 6
driven arms recorded no birth: the open route (`holdAndBindSession`), `CoordStore.markDispatched`,
`CoordStore.dispatchRun`, the `CoordStore.setSession` pass-through and the adopted arm of `dispatch.ts#spawnFresh`. Only
the fresh-spawn arm recorded one. After the fix, 1 arm records none: the adopted arm. So the exit "unbound-incarnation
bind sites go to 0" is met for every site except that one, which is named below.

## Deviations found

- **D-6993.** The adopted arm of `spawnFresh` (a `ws-add` cut short in flight, whose new,
  unheld workspace the dispatch adopts) binds with an explicit `null` birth and records no incarnation. It stays that
  way by design. The child-reclamation spec (`docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`
  section 5.1, and the placement rule in section 5.3) says an adopted workspace holds no birth that is provably its
  own: the dispatch did not watch it being minted, so `childBirthOf` must read it `unplaceable`, and the bind gate and
  the close hold rather than date PR rows against it. Two candidate sources were checked and rejected:
  - **The occupant stamp's source** (the newest birth any run of the series recorded for the id). For an adopted id,
    no run of this dispatch recorded a birth, so any birth on record for the id may be an EARLIER occupant's under a
    recycled name. Stamping it, or anchoring the reader to it, would bind the adopted worker's runs to that earlier
    occupant, which is the ghost-parent error #1407 exists to remove.
  - **The registry row** (`$REG/<id>.spawn`, the epoch ccd's `_spawn` writes). It is ccd's clock, in seconds, written
    on every spawn of the id, not once at mint, and the server's birth column is a server-clock instant taken just
    before the `ws-add` (spec section 5.3). Writing it on the minting run would also put a birth on the row
    `childBirthOf` reads, which then stays `unplaceable` only because the two instants differ: a coincidence, not a
    rule.
  Consequence, accepted: an adopted worker reads by the id-string rule, the same residual as a `not-a-child` session
  (#1532). Its parent is the claimant of the newest open run that names the id, which is the adopting run's. A run of
  an earlier occupant that is still open also names the id. Without a birth the columns cannot tell it apart, so
  `claimantsOf` still lists its claimant after the adopting one.
  Neither half borrows a birth that another run recorded for the id:
  - **The read.** `anchoredIncarnation` (`server/src/coord/runBinding.ts`, applied over the worker's series by
    `bindingOf`, `claimantsOf` and `boundRunsOf`, and by `runWire.incarnationsOfSessions` for `childrenOf`) anchors an
    `unplaceable` worker only to the birth its OWN minting run recorded for it. That is the re-stamped arm of
    `childBirthOf`, which carries the birth as `recorded`. An adopted worker's minting run records none, so it is never
    dated to an earlier occupant. The first anchor of this PR (`0d1b8ead5`) took the newest birth on record for the id
    and made the earlier occupant's open run the parent, the D6 ghost (D-5920). The anchor also holds only while that
    birth is the newest the series records for the id, which is what the stamp writes. After a cross-build rollback
    with a same-id redraw, a newer birth is on record, the live occupant's new-build waves carry it, and the worker
    keeps the id-string rule, as on the merge base. Pinned in `run-binding-bind-records.test.ts` ("the stamp and the
    anchor agree after a cross-build rollback"), red at `b974fc5e7`.
  - **The write.** `occupantBirthOf`, the stamp's source, answers no birth when a run of the series names the id,
    records no birth, and was dispatched after the newest birth on record. That shape is an adoption, because every
    fresh spawn records its birth as its own `dispatchStartedAt`. So a later wave bound to an adopted worker records
    nothing, and it too reads by the id-string rule.
  The adopted read-back case in `server/test/run-binding-bind-records.test.ts` pins both halves: an earlier occupant's
  run still open, the name adopted, then a later wave. `childParentOf`, `claimantsOf` and `sessionRunRead` answer the
  adopting run's claimant, and the later wave records no birth. The read half is red at `0d1b8ead5` and green on the
  merge base (`ccba6f9b6`). The stamp half is red on the merge base, whose placeable-only stamp gave the later wave the
  earlier occupant's birth. The census pins the arm
  by name, so a change that makes it record a birth, or a new arm that records none, reds the suite.
