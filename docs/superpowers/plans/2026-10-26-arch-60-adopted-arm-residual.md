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
  Consequence, accepted: an adopted worker reads by the id-string rule, the same rule as every `unplaceable` worker and
  every `not-a-child` session (#1532). Its parent is the claimant of the newest open run that names the id. A run of an
  earlier occupant that is still open also names the id, and without a birth the columns cannot tell it apart, so
  `claimantsOf` still lists its claimant, and when that run holds the HIGHER id it is the parent (an inherited residual,
  below).
  Neither half borrows a birth that another run recorded for the id:
  - **The read.** No reader anchors an `unplaceable` worker to any birth on record (round 5 of PR #1573). Two anchors
    were tried and both made a shape worse than the merge base. The first (`0d1b8ead5`) took the newest birth on record
    for the id and made an earlier occupant's open run the adopted worker's parent, the D6 ghost (D-5920). The second
    (`b974fc5e7`, `7d1850675`) took the birth the worker's own minting run recorded, while no newer one was on record. A
    recorded birth on a re-stamped minting run is never proven to be the LIVE occupant's: after a same-id redraw by an
    older build (a cross-build rollback) or a crash between `ws-add` and `setSession`, it is an earlier occupant's on the
    same run. Anchored to it, the readers dropped the live occupant's waves and kept a dead coordinator's. So every
    `unplaceable` worker keeps the merge base's id-string rule, and `runWire.incarnationsOfSessions` builds the fleet's
    incarnations from the marks alone, with no series read per session per frame.
  - **The write.** `occupantBirthOf`, the stamp's source, answers no birth when ANOTHER run of the series names the id,
    records no birth, and was dispatched after the newest birth on record. The adopted arm has that shape. The shape does
    not prove an adoption (a run whose fresh spawn failed and that was later rebound to the worker has it too), so the
    stamp declines rather than guesses. The run being stamped is excluded: its own failed spawn attempt is no adoption
    of the name, and counting it left a later wave of a placeable worker unstamped and undecidable (found in the round-4 review). So a
    later wave bound to an adopted worker records nothing, and it too reads by the id-string rule.
  The adopted read-back case in `server/test/run-binding-bind-records.test.ts` pins both halves: an earlier occupant's
  run still open, the name adopted, then a later wave. `childParentOf`, `claimantsOf` and `sessionRunRead` answer the
  adopting run's claimant, and the later wave records no birth. The read half is red at `0d1b8ead5` and green on the
  merge base. The stamp half is red on the merge base, whose placeable-only stamp gave the later wave the earlier
  occupant's birth. The census pins the arm by name, so a change that makes it record a birth, or a new arm that records
  none, reds the suite.

## The acceptance bar

On every shape in the probe corpus (`server/test/run-binding-probe-corpus.test.ts`, one case per shape a review round of
PR #1573 reported), this PR answers what the merge base answers, or a better answer. A shape where both give the same
wrong answer is an inherited residual: out of scope for this PR, listed below, and left to the follow-up for "D6 gap 1:
an unborn incarnation that reuses a workspace name still inherits a ghost run". Each corpus case pins the merge base's
answer, recorded by running the file over the merge-base sources, and this PR's answer where it differs.

## Residuals, inherited from main

Each is a corpus case marked `residual: 'inherited'`, whose answer is the same on the merge base and on this PR.

- **GAP 1 (unplaceable).** An earlier occupant's run is still open and the live occupant's minting run, whose birth
  cannot be placed, is done. By the id-string rule the earlier occupant's run is the worker's open run: its claimant is
  the parent, the card shows it, and its coordinator's `childIds` list it. The same rule lists an earlier occupant's open
  run among `childIds` in other shapes too (the corpus case "a placeable older birth, a newer unplaceable one").
- **The adopted arm, the earlier occupant's open run holding the higher id.** The id-string rule takes the newest open
  run that names the id, which is the earlier occupant's, so its claimant is the parent instead of the adopting run's.
- **A cross-build rollback with the minting run still open and a third coordinator's open wave.** An older build redraws
  the name on the minting run R, which stays open; a wave of the earlier occupant, claimed by a third coordinator, is
  newer and still open, so that coordinator is the parent instead of R's.

Both verifiers of round 4 suggested a direction for the follow-up: the minting run wins while it is open and names the
session. It is not taken here because it is a new reader rule, and the bar for this PR is "no worse than main".
