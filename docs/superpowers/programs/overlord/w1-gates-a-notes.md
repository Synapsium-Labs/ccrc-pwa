# Overlord W1, gates A: notes for the ledger

What gates A (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-gates.md`, Tasks 1 to 3) found while building, for the
coordinator to fold into the programme ledger. Each departure is named by a plain-words slug; no number is taken here.

## Departures

- **`ladder-columns-wait-for-pr-b`**: the ladder is not on `main`, so `OverlordDoorRow` carries no `ladderClass` and no `act`
  column yet. PR B adds both with the ladder's `DoorClass` and `LadderActKind`, as the plan's Task 1 allows.
- **`ratify-door-joins-the-table`**: portfolio B's ratify door (`POST /api/programmes/:slug/goals/ratify`) is on `main`, so it
  gets its row (`goals-ratify`, operator, `admin`) and records its actor through `identity.operator`, the same text as before.
  The private store's prompt route, the ladder's operator doors and Confirm the restore are not on `main`: they call the
  port themselves when they land.
- **`actor-detail-optional-on-the-wire`**: `DesignationView.actorDetail` and `pending.actorDetail` are optional in the type.
  The server's one reader always sets both; absence means only an older server (absence-permits). Required, they would
  have reddened the type check of eight test fixtures that build a view by hand and that sibling pieces edit.
- **`pending-actor-backfilled-by-the-migration`**: the plan's migration gives the three pending actor columns no default,
  so a pending attempt standing at the upgrade would read as a half actor (`unmeasured`). The migration fills them with
  `operator`, `account-gate`, `operator` where `pendingActor` is set, measured the same way as the live defaults (only the
  account gate's doors wrote the row before it).
- **`designate-writes-the-live-actor-too`**: designation A's `designatePending` already writes the row's `actor` beside
  `pendingActor`; it now writes the live actor's four columns together from the same `RecordedActor`, so the subject and its
  kind never disagree. `goLive` then copies the attempt's four onto the binding, as ruled.
- **`actor-refusal-is-internal`**: a writer's `{ ok: false, reason: 'actor' }` reaches the wire as `internal` (500): a door
  that hands a writer an actor the port did not mint is a programming error, not a caller's mistake.
- **`store-delegates-unchanged`**: `CoordStore`'s designation delegates type their input as the store's own
  `DesignateInput` and `RetireInput`, so `store.ts` needs no edit (the plan estimated +2).
- **`overlord-door-class-waits-for-other-lanes`**: the other-lanes piece's write-door census is not on `main`, so there is no
  census to add the class `overlord-door` to. Whichever lands second reads `OVERLORD_DOORS` for it.

## For the coordinator

- **Private names doors**: `PUT` and `GET /api/overlord/private-names` (`operatorModel/nameListRoutes.ts`) sit under
  `/api/overlord/` but are not in the plan's table, so they take no row here and that file is not in the census. Rule
  whether they are Overlord operator doors.
- **Designation C's setters**: designation C (run 2397) adds `setModelClass` and `setAccountSet`, which take the gate's actor
  as a string. Whichever of us lands second switches them to `RecordedActor`, `isRecordedActor`, the four live columns and
  `reason: 'actor'` (agreed by mail).
- **Migration slot**: this PR's migration is positional at 92 today; the second lander renumbers.
