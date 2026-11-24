# A worker whose run closed stays in its programme's box: plan

When a worker's run closes while its programme still has open work, the worker's row fell out of the programme's box on
its project card, into "Not in a programme", and its label read "run not on the board". The operator approved keeping
such a worker in its programme's box, as a finished member, for as long as the programme is active. This plan does that
with one additive wire fact and one decider.

## Measured

- `pwa/src/fleet/programmeBoxes.ts#programmeBoxes` puts a top-level row in a box only when it claims an open run or is
  bound to one (`rowRun`, through `pwa/src/fleet/runWords.ts#boundOpenRun`). Every other row went to `lone`.
- The runs frame carries open runs only (`emitRuns`, and `nestFleet.ts`'s header says so), so a closed run's programme
  was unknown to the card. `FleetSession.run` (the newest run bound to the session's incarnation, any state) carried the
  run's id, state and claimant, and no programme.
- `pwa/src/fleet/runWords.ts#childOfRunLabel` printed "run not on the board" for a child that no open run names.
- On the live fleet, read only: two held child workspaces whose `.child` runs had closed (`done`) while their
  programmes still had open waves. Both rows rendered under "Not in a programme". Neither is in the Released fold,
  because a hold keeps a workspace its programme's (`server/src/coord/released.ts#releasedFrom`).

## The design, and why this one

**The wire fact (D-8980).** `SessionRun` (`FleetSession.run` and `.openRun`) gains two optional fields, `program` and
`wave`, the bound run's own columns. The server already reads them in the binding's series query
(`CoordStore#bindingRunsOf`, through `seriesRows`) and dropped them. `bindingReads.ts`'s `toSessionRun` is the one
projection that writes them. They are additive: `FLEET_PROTO` is not bumped, `sessionRunOf` stays the one reader,
`reviveFleetSession` keeps a readable pair and drops a malformed one without dropping the run, and an older server's
row has neither. A wave this process cannot represent is left out. It does not fail the series, because no binding
decision reads it.

**What "the programme is still active" means.** It means the closed run's claimant still claims an open run of the same
programme (whose worker is not itself). The runs frame already carries that fact, and it is the same fact that makes
the programme's box, so the box and the kept row can never disagree within one frame. Two alternatives were rejected:

- A server-side "programme state" field on `FleetSession`. `programs.state` is not a reliable activity fact. The close
  retires a programme whenever its open-run count reaches 0, and opening the next wave never sets it back
  (`CoordStore#programmeLive`'s note, D-8558), so it can read `done` while a wave is open. A per-session activity field
  would also be a second writer of a fact the runs frame already carries.
- Adding closed runs to the runs frame. Every reader of that frame assumes open runs only (the tree, the boxes, the
  dispatch cap's readers, the hue map), so that change would be far larger and riskier than one field.

**The decider (D-8981).** `pwa/src/fleet/runWords.ts#keptRunOf` (L1, beside the run binding's named readers) answers a
`KeptRun` (`id`, `program`, `wave`, `coordinatorId`) when all of these hold:

- the session's newest bound run has closed;
- no open run binds the session;
- the wire names the run's programme;
- the run's claimant still claims open work of that programme.

Otherwise it answers `null`. The worker side is the server's incarnation binding, so a recycled workspace name is never
kept for the occupant before it. The coordinator side is the run's claimant column, which the reclaim door moves with
every run of the programme (`UPDATE runs SET claimedBy … WHERE program = ?`), so a succession re-parents a kept worker
too.

- `pwa/src/fleet/fleetTree.ts#keptOfFleet` asks it once per frame over the fleet's open runs. A coordinator's open work
  may all render on other cards, so a card's own runs cannot answer it.
- `pwa/src/fleet/nestFleet.ts#nestFleet` gains rule 6, with an optional `kept` map. The default is today's tree. Under
  rule 6, a kept worker brackets under its coordinator when the coordinator is on this card's list, after the working
  children and before a spawn. Rule 4 holds: the coordinator counts as a parent, and a kept worker that is a parent
  stays at the top level. Every row of a kept session carries its `kept` answer (`FleetRow.kept`), so nothing decides
  it again.
- The box therefore lists the kept worker among its children. The rollup folds it like any other worker, and the footer
  counts it. `programmeBoxes.ts#rowClaimant` and `#rowProgramme` read a row's run, else its `kept` answer. With them,
  a kept worker whose coordinator renders on another card is a "Worker of programmes elsewhere", in its programme's
  hue, and the Status view (`statusGroups.ts#statusView`) makes it that box's member. `fleetTree`'s per-card hues
  include the kept workers' programmes.
- A programme with no open run left (done or abandoned) keeps no one. Its workers stay "Not in a programme", as they did
  before.

**The label (D-8982).** `childOfRunLabel` reads `ChildRunContext.kept` when no open run names the child. The label is
`<programme> · wave N · run closed` (`keptRunWords`), and the title (`keptRunTitle`) names the run number and the
coordinator. `childRunContext` takes the tree's answer, and it names the kept run's coordinator when there is no open
parent. It leaves the key out when there is none, so every other context is byte-identical. `ProjectCard` passes the
row's answer. Instrument's `FleetTable` passes the same decider's answer over the same runs.

**The run-binding census.** `server/test/rings/pwa-one-owner.test.ts`'s run-binding block (D-7182, D-8049) is
unchanged and green. The kept decision is made in `runWords.ts` over the wire's binding, and its answer names the
coordinator as `coordinatorId`, so `nestFleet`'s membership test reads a decided answer, not a run's raw `claimedBy`.

## Not changed

- The session header's coordination line (`coordinationOf`, `SessionScreen`) still describes a session with no open
  run as it did before. The fleet row's label is where the operator reads it.
- The Released fold, the hold, the reclaim and every server decision about the workspace are untouched. This change
  is presentation over one added wire fact.

## Tests

- `server/test/run-wire.test.ts`: the binding read carries the programme and wave of the newest closed run and of the
  open run, `assembleFleet` sends them, and `reviveFleetSession` keeps a readable pair, drops a malformed one and keeps
  the run. The older exact-shape cases now include the two fields. Measured red before the change: 3 of the new cases.
- `pwa/test/kept-worker.test.ts`: the decider (kept, programme done, another programme, another coordinator, an open
  run, newer-closed-older-open, an older server, an ownerless run); rule 6 (nested after the working children, under a
  coordinator whose open work is all on another card, elsewhere with its hue, lone when the programme is done, rule 4
  both ways, no map gives today's tree); the label. Red before the change, as a missing export. Each guard was also
  measured red by mutation: no `kept` handed to the tree (4 cases), no activity check (2), the old claimant reader in
  the boxes (1), no kept arm in the label (1), the coordinator not made a parent (1), and no open-run check (1).
- `pwa/test/programme-box-card.test.tsx`: the card draws the kept worker in the box's tray, in the programme's hue,
  labelled `port-api · wave 1 · run closed`. Red with the tree's `kept` argument removed.
- `pwa/test/runBindingFixture.ts#withProgrammeBinding` is opt-in. The suites that characterise today's tree keep their
  captured input, so their snapshots are unchanged and prove the default tree did not move.

## Deviations found

- **D-8980 (2026-11-24)**: session-run-carries-programme. `FleetSession.run` and `.openRun` named a run's id, state and
  claimant only, so a worker whose run had closed could not say which programme it worked for: the runs frame carries
  open runs only. `SessionRun` gains optional `program` and `wave`, projected once by `toSessionRun` from the binding
  series that already read them. Additive, `FLEET_PROTO` unchanged, revived field by field.
- **D-8981 (2026-11-24)**: kept-worker-stays-in-programme-box. A worker whose run closed while its programme still had
  open work fell to "Not in a programme". `keptRunOf` decides that the programme still keeps it (its run's claimant
  claims open work of that programme), `nestFleet`'s rule 6 brackets it under that coordinator, and `rowClaimant` files
  it under "Workers of programmes elsewhere" when the coordinator is on another card. A done or abandoned programme
  keeps no one.
- **D-8982 (2026-11-24)**: kept-worker-label-run-closed. Such a worker's label read "run not on the board". It now reads
  `<programme> · wave N · run closed`, and the title names the run and the coordinator.
