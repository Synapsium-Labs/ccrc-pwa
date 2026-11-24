# Approvals PR 3b: the route hunks that wire the park (applied in PR 3, by packet)

Plan: `docs/superpowers/plans/2026-11-18-overlord-approvals.md`, §3.3 and Tasks 3.1 to 3.3. The coordinator first split these
hunks from PR 3 (ruling of 2026-11-19), because another run holds the route file (`server/src/coord/routes.ts`). Item 486 then
let that holder take a packet (mail 27068). The holder said yes to this exact packet on 2026-11-20 (mail 27138), so it rides
PR 3 on its own branch. The route file's claim stays the holder's, and nothing is released.

The packet is a diff against `main` at `963286cc9`: twelve lines added in six hunks, and nothing removed or rewritten. Outside
the route file it needs two more changes. `server/src/server.ts` gains one field on one line (door process B1's yes, mail
27114). `APPROVAL_RULED_GRACE_MS` moves from `server/src/watch.ts` to `server/src/askwindow.ts` (capacity Task 2's yes, mail
27111).

## The six hunks

1. **Imports.** Three lines go after the notice import: `approvalOperatorArm` from `./approvalParkDoor.js`, `type AccountGate`
   from `../accounts/gate.js`, and `APPROVAL_RULED_GRACE_MS` from `../askwindow.js`.
2. **The door's wiring.** `OperatorDoorWiring` gains `readonly gate: AccountGate;`, with its doc line. `server.ts` passes
   `gate: accountGate`, the gate that the other step-up doors are given.
3. **H4: the claimant door's deny standing.** `claimantDeps` gains `denyStanding,`, with a comment line. The one signing site
   then re-checks the child's deny currency at signing for the claimant's in-window allow too, as it already does for a
   retry. This closes PR 0's residual.
4. **H1: the `201` carries the park's word.** One early answer goes before the existing one in the request route's `minted`
   case. When the mint decided a park word, it answers `{id, waitS, park}`. A mint with no park step answers as before.
5. **H2: the ruling read records `fetchedAt`.** One added call goes after the read builds its answer:
   `questions.noteRulingServed(row, Date.now(), APPROVAL_RULED_GRACE_MS)`. It records `fetchedAt` the first time a ruling is
   served at least the grace before its record expires, and never again. A failed write is warned about and never becomes a
   refusal.
6. **H3: the operator door's `approval-<n>` arm.** One arm goes before the door's `kind-mismatch` line. An `approval-<n>` id is
   handed to `approvalOperatorArm`, which asks the account gate (with its step-up) first and presses nothing. An `ask-<n>` id is
   still `kind-mismatch`, and a `session-<id>` answer is unchanged.

The holder checked the packet read-only. It applies cleanly at `963286cc9`. The holder's own frozen changes to the file are
more than two hundred lines from the nearest hunk, and a three-way merge of their frozen tip with `main` plus this packet is
clean. If another packet lands first on the same lines and a hunk no longer applies, the hunk is rebuilt. A rebuild that keeps
the same twelve added lines needs no new packet. Any other change does.

## The lane's gate

`shared/lane-arm.ts`'s `approval-park` row keeps its gate until PR 3v (the verifier's v2 rule,
`approvals-pr3-verifier-patch.md`) is on the fleet box. Its words now name only the verifier. When PR 3v is there, the gate
goes (`gate: null`). Live is then the operator's, behind the card's step-up, and refused while sign-in is dark.

## Its tests

`server/test/approval-park-routes.test.ts` runs the real server over a fixture HOME. It was committed red first: on the tree
without the packet it failed exactly the H1 to H4 cases, and with the packet it passes 8 of 8. It pins:

- **H1:** a held mint answers `{id, waitS, park: 'shadow'}` while the lane is gated.
- **H2:** serving a ruling records `fetchedAt` once, and a second read leaves it as it was. A held row records nothing.
- **H3:** an `approval-<n>` id reaches the arm, whose account gate answers `auth-off` while sign-in is dark. An `ask-<n>` id is
  still `kind-mismatch`.
- **H4:** a row minted current whose managed deny file changed before the ruling is refused `deny-not-current`, and the row
  stays held. A deny is still signed.

Each hunk's mutant was measured red against this suite, with the file restored from a saved copy each time:

- the `201` without `park`;
- the ruling read not recording;
- the door answering `kind-mismatch` for an approval id;
- `claimantDeps` without `denyStanding`.

The arm's press-free core and the grace rule are PR 3's own (`approval-park.test.ts`). No door is added: the arm is a path of
the existing operator door, so the box-token and auth-gate censuses are unchanged. They are re-run.

## Before Live

Task 3.2 asks for a measurement before Live, on a fixture child under the current build: does a model retry a parked command
unchanged, and does the park burn a turn? It belongs in PR 3v's note, and the lane stays shadow until it has been read.
