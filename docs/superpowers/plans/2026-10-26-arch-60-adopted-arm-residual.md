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
    no run of this dispatch recorded a birth, so any birth on record for the id is an EARLIER occupant's under a
    recycled name. Stamping it would bind the adopted worker's run to that earlier occupant, which is the ghost-parent
    error #1407 exists to remove.
  - **The registry row** (`$REG/<id>.spawn`, the epoch ccd's `_spawn` writes). It is ccd's clock, in seconds, written
    on every spawn of the id, not once at mint, and the server's birth column is a server-clock instant taken just
    before the `ws-add` (spec section 5.3). Writing it on the minting run would also put a birth on the row
    `childBirthOf` reads, which then stays `unplaceable` only because the two instants differ: a coincidence, not a
    rule.
  Consequence, accepted: a later wave bound to an adopted worker stamps no birth unless a run of its series recorded
  one, and reads by the id-string rule, the same residual as a `not-a-child` session (#1532). The census pins the arm
  by name, so a change that makes it record a birth, or a new arm that records none, reds the suite.
