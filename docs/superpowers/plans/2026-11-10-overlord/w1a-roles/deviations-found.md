# W1a roles: deviations found while building it

A note for the programme's ledger pull request, written by the worker of run 1775. It adds to
`docs/superpowers/plans/2026-11-10-overlord/w1a-roles.md`, whose "Deviations found" section a feature pull request may
not edit (the ledger guard, D-6926). Each entry is a plain slug. The programme issues the numbers and defines them in
the index plan, `docs/superpowers/plans/2026-11-10-overlord.md`.

- **fleet-role-guard** — `shared/fleetRoles.ts` also exports `isFleetRole`, the table's runtime guard. It follows
  `isSessionRole`'s idiom and derives from `FLEET_ROLE_NAMES`. `server/test/rings/wire-totality.test.ts` requires every
  exported literal union in `shared/*.ts` to have a sibling `Record<X, true>` map or an `is X` guard. `FLEET_ROLES`
  types its rows as `FleetRoleRow`, not `true`, so without the guard Task 2 turns that scan red. The plan's open
  question 5 says a future wire field would add the same guard.
- **stall-import-pin** — Task 4's move gives `server/src/coord/stall.ts` a value import of `sessionRoleOf` from
  `../roleOf.js`. `server/test/stall-vocabulary.test.ts` admitted value imports only from `shared/api.ts`, plus
  `stallWatchSays` from `../sessionReading.js`, so it went red. The pin now admits `sessionRoleOf` from `../roleOf.js`.
  The import must stand alone, on one exact line, by the same rule the pin applies to `stallWatchSays`: both are L1 files
  that import only L0. The stall lane still cannot read the role table or call `roleOf` itself. The same commit
  (2d2972166) also rewrites one sentence of `stall.ts`'s module docstring, the one that lists its permitted value
  imports, so that it names `sessionRoleOf` from `../roleOf.js`. The code change in `stall.ts` is the one import.
- **deviations-in-a-note** — The brief asked for these entries in the plan's own "Deviations found" section. The ledger
  guard refuses a feature pull request that modifies an existing file under `docs/superpowers/plans/`, so they are in
  this new note instead.
