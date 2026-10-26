# ARCH-60 follow-up (#1407): the adopted arm's residual

A plan note for PR #1573 (the bind-site census and the probe corpus, at the merge base's stamp). It defines the one
deviation that PR names, and records the gap 2 design it withdrew. It edits no other plan and no programme ledger.

## The counted exit, as measured

`server/test/run-binding-bind-records.test.ts` drives every call of `bindSession`, `setSession` and `markDispatched` in
`server/src` through the path that reaches it, over two fixtures: a worker whose birth on record `childBirthOf` places,
and one whose only birth on record it cannot place. It reads what each bind wrote on the run it bound. The census is the
same over the merge base (`865e1833b`) and this PR, because since round 8 this PR writes the merge base's stamp
unchanged (`CoordStore.stampOccupantBirth`: the newest placeable birth on record for the id, else none):

- Over a placeable birth, 5 of the 6 driven arms record it: the open route (`holdAndBindSession`),
  `CoordStore.markDispatched`, `CoordStore.dispatchRun`, the `CoordStore.setSession` pass-through and the fresh-spawn
  arm of `dispatch.ts#spawnFresh`. The one that records none is the adopted arm (D-6993, below).
- Over an unplaceable birth, only the fresh-spawn arm records one (its own). The other five record none: gap 2, a
  residual of this PR (below), left to the follow-up.

So the exit "unbound-incarnation bind sites go to 0" is NOT met by this PR. It is met for every site except the adopted
arm whenever the id has a placeable birth on record, and it is not met at all for an id whose only births are
unplaceable. Rounds 6 and 7 closed that second part with a fallback stamp; round 8 withdrew it (below).

## Deviations found

- **D-6993.** The adopted arm of `spawnFresh` (a `ws-add` cut short in flight, whose new,
  unheld workspace the dispatch adopts) binds with an explicit `null` birth and records no incarnation. It stays that
  way by design. The child-reclamation spec (`docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`
  section 5.1, and the placement rule in section 5.3) says an adopted workspace holds no birth that is provably its
  own: the dispatch did not watch it being minted, so `childBirthOf` must read it `unplaceable`, and the bind gate and
  the close hold rather than date PR rows against it. Two candidate sources were checked and rejected:
  - **The occupant stamp's source** (the birth a later wave of the id records). For an adopted id, no run of this
    dispatch recorded a birth, so any birth on record for the id may be an EARLIER occupant's under a recycled name.
    Writing it on the adopting run, or anchoring the reader to it, would bind the adopted worker's runs to that earlier
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
    were tried on earlier rounds of PR #1573 and both made a shape worse than the merge base. The first took the newest
    birth on record for the id and made an earlier occupant's open run the adopted worker's parent, the D6 ghost
    (D-5920). The second took the birth the worker's own minting run recorded, while no newer one was on record. A
    recorded birth on a re-stamped minting run is never proven to be the LIVE occupant's: after a same-id redraw by an
    older build (a cross-build rollback) or a crash between `ws-add` and `setSession`, it is an earlier occupant's on the
    same run. Anchored to it, the readers dropped the live occupant's waves and kept a dead coordinator's. So every
    `unplaceable` worker keeps the merge base's id-string rule, and `runWire.incarnationsOfSessions` builds the fleet's
    incarnations from the marks alone, with no series read per session per frame.
  - **The write.** The stamp is the merge base's, unchanged: the newest PLACEABLE birth on record for the id, read
    over every run recording a birth for it, whatever its `sessionId` now names. Nothing vetoes it. So a later wave
    bound to an adopted worker records what the merge base records, and while the adopted worker stays `unplaceable`
    it reads by the id-string rule, whatever that wave records. (An earlier round vetoed the stamp when another run
    named the id, recorded no birth and was dispatched after that birth, the adopted arm's shape. That veto made a
    placeable worker worse than the merge base in round 6: a failed fresh spawn that an older build later rebound to
    the worker leaves the same shape, and live databases hold it.)
  The adopted read-back case in `server/test/run-binding-bind-records.test.ts` pins this: an earlier occupant's run
  still open, the name adopted, then a later wave. `childParentOf`, `claimantsOf` and `sessionRunRead` answer the
  adopting run's claimant, on the merge base and on this PR. The census pins the arm by name, so a change that makes it
  record a birth, or a new arm that records none, reds the suite.

## The acceptance bar

On every shape in the probe corpus (`server/test/run-binding-probe-corpus.test.ts`, one case per shape a review round of
PR #1573 reported), this PR answers what the merge base answers, or a better answer. A shape where both give the same
wrong answer is an inherited residual: out of scope for this PR, listed below, and left to the follow-up for "D6 gap 1:
an unborn incarnation that reuses a workspace name still inherits a ghost run". Each corpus case pins the merge base's
answer, recorded by running the file over the merge-base sources, and this PR's answer where it differs. Since round 8
no case differs: the stamp is the merge base's, and all 53 cases give the merge base's answer on this PR.

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
- **Gap 2 (three corpus cases: "GAP 2", "the dup-arm re-open over an unplaceable wave 1", "a pre-planned wave 2 bound
  after wave 1 recorded its birth").** A later wave bound to a worker whose only birth on record cannot be placed records
  no birth. The first two still read the right parent by `openedAt`. In the third, wave 2 stays undecided once wave 1's
  dispatch moves onto the birth, so the card shows no open run and coordinator `childIds` lose it. Rounds 6 and 7 of
  this PR answered all three better through a fallback stamp, withdrawn in round 8 (next section).
- **A leftover birth for another session (R8-X1c-ctrl, N8c).** A wave stamped with another session's placeable birth,
  then moved to the worker by an older build (which keeps the birth columns), reads `unbound` for the worker, so the
  wave drops out of its parent, card and `childIds`. A verifier prototyped a reader fix: `bindsRun` uses a run's recorded
  birth only when it was recorded for the session the run names now (`sessionBornFor === sessionId`), else the
  `openedAt` rule, the test `childBirthOf` already applies. Measured on a prototype over round 7's head: R8-X1c-ctrl
  got better than the merge base, round 7's 39 corpus cases kept their answers, and one existing pin (a birth recorded
  for another session reads `unbound`) flips. That is a reader policy change, so it is left to the follow-up.
- **A wave bound before a same-id re-mint (R8-M1, R8-M2, R8-M4, R8-A1).** The minting run's birth cannot be placed when a
  later wave V is bound (a crash after `markDispatchStarted`, or an adoption), so V records nothing; the name is then
  re-minted, the worker is born after V opened, and V is undecided. `parentOrMinter` makes the minter the parent with no
  claimant (`run-unclaimed` when V is ownerless). With a placeable birth at bind time (R8-M1-ctrl) the merge base
  stamps V and reads it as the earlier occupant's, `not-a-child`. Closing these needs gap 2's stamp.

## Gap 2: the fallback stamp, withdrawn in round 8 (for the follow-up)

The design rounds 6 and 7 shipped, written down so the follow-up does not repeat it. When no birth on record for the id
could be placed, the stamp fell back to the one birth every row recorded for the id (no stamp when they disagreed), and
never to the stamped run's own `dispatchStartedAt`. It closed gap 2's three corpus cases. A fallback stamp is read: a
worker that is `unplaceable` when the wave is bound can be `born` when the wave is read (a same-id redraw moves the
minting run's `dispatchStartedAt` onto its birth, or an older build moves a run with a placeable birth back). Round 7
found three narrower versions worse than the merge base: the newest recorded birth when births disagree (P1-q, P1b-q),
the fallback written onto the minting run itself (P10, P10b, P6d), and a narrower row set, the session's series (P1-back,
P1b-back, P1d-back, P1e-back).

Round 8 found shapes where even the agreed, never-self-placing fallback is worse than the merge base. The cause in each:
the fallback writes a stamp the merge base never writes, and the columns cannot keep it with the incarnation it was
meant for.

- **An older build's rebind carries it (R8-X1c, R8-X1c-open, N8, N8b).** Another session Y's only birth is unplaceable.
  This build binds wave V to Y and the fallback stamps V with Y's birth. An older build (one that predates the birth
  columns) moves V to the worker and keeps both birth columns, so V reads `unbound` for the worker: parent `null` and
  `not-a-child` where the merge base answers V's coordinator. Any write the merge base never makes can be carried to
  another session this way, so no fallback stamp is never-worse here.
- **A current-build race (N1, N1b).** The minting run M minted the id at T0. M is re-dispatched (`markDispatchStarted`
  at T5) and `ws-add` reuses the id. A later wave X, opened after T5, is bound in the window before M records T5. The
  only birth on record is T0, with M's dispatch moved to T5: exactly gap 2's premise, so the fallback stamps X with T0.
  Once M records T5 the worker is born at T5 and X reads `unbound`. The merge base leaves X unstamped, opened after T5,
  and reads it bound.

Two narrower fallbacks were measured and rejected. Falling back only when no recorded row has a dispatch start fixes N1
and N1b but not N8 and N8b, and `spawnFresh` never writes such a row, so it closes no real gap 2. Reading a recorded
birth only when it was recorded for the session the run names now (the reader fix above) fixes R8-X1c but not N1b.
Whatever closes gap 2 must say which incarnation a stamp belongs to in a way an older build's rebind and a late
`setSession` cannot break; the birth columns alone cannot.

Both verifiers of round 4 suggested a direction for the follow-up: the minting run wins while it is open and names the
session. It is not taken here because it is a new reader rule, and the bar for this PR is "no worse than main".
