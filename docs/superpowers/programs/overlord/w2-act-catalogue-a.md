# Overlord W2, the act catalogue, PR A (run 4112, wave 251)

The task note of the act catalogue's first pull request: the move of the rung cells into the catalogue, the catalogue
whole, its oracles, and the act ceiling at gate step 10. Plan: `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md`,
Tasks A1 to A4. PR B (the may-act decider) is not this pull request. No deviation number was issued for this wave;
every departure is named by slug below, for the coordinator to fold into the ledger.

## Step 0: what main held, measured against the plan

The plan is a snapshot of 2026-11-16. Measured on `main` at `5576023f25`:

| The plan says | Main holds | What this pull request did |
|---|---|---|
| §3: the ladder, the gates and the isolation word are not built | All three are built (`shared/overlord-ladder.ts`, `server/src/coord/overlordGate.ts`, `overlordGateRun.ts`, `shared/isolation.ts`) | Built against main's code (the coordinator's item 1) |
| Three W1 act kinds | Four: `link-team` (D-8809), cells refuse, refuse, allow, named by the `link-team` door row | Characterized all four; the catalogue has its row, today's cells unchanged (item 2, ruled in call 1816) |
| The move's importers: the ladder, the door table, the gate file and the area file | The ladder's L1 file, the door table, the ladder suite, the skill suite and the ladder's single-definition file. The gate file imports none of the moved names | Every importer followed in the move commit (item 3) |
| `rungStep(effective, door, act)` | `rungStep(effective, door, act, cells = RUNG_CELLS)`: the table is an argument, and the simulator's cases pass a synthetic one | The table argument is kept, so a test still hands it a synthetic catalogue (item 4) |
| One gate mutant matches `rungStep`'s call | `O-13` in `server/test/sim/gateSets.ts`, by the text `rungStep(ladder.rung.rung, door.ladderClass, door.act)` | The call's text is unchanged, so `O-13` still matches; measured killed before and after |
| `act-ceiling`, `operator-only`, `identity-too-weak`, `server-not-isolated` on the wave map | All four are in `OVERLORD_REFUSALS` already (the W2 vocabulary landed) | Read from there; no wave-map change |
| The spec's Table 7.1a as the plan read it | Table 7.1a has grown rows since (R22 and R23: the coordination pause, the review cap, `answer-approval`, `reclaim-run` and others) | Not built here: the plan governs this wave (known limit 1) |

Which doors can reach the count reader's default at merge (item 5): **none**. Every Overlord door row of today names
`read`, `write-note`, `acknowledge` or `link-team`, each of whose ceilings is `held-by`, or no act kind (the three timer
rows). A case derives that from each row's kind and that kind's ceiling (`overlord-act-ceiling.test.ts`, "no door of
today reaches the count reader"), so a kind changed to `counted` with a door of today naming it reds there (call 1816,
condition 3). A second case walks every Overlord door row through the read gate with a count reader that records
every call: every row answers as before and the reader is never called.

## What was built

Seven commits, in order:

1. `test(overlord)`: the characterization, green on main against the ladder's code: `rungStep` for the four W1 kinds
   at every rung and both door classes, every door row's act kind, and the gate's answer at every Overlord door row at
   every rung, each value written out (`server/test/overlord-rung-cells-characterization.test.ts`).
2. `refactor(overlord)`: the move. `shared/overlord.ts` (L0, K) holds the cells under each row's `rungs`; the ladder's
   four names are deleted with no alias; every importer follows. No value, order or signature changes; the
   characterization is untouched.
3. `feat(overlord)`, `rungStep`'s signature: the five cell words; only `refuse` refuses; the pass carries the cell, or
   `skipped`; `rung-below` names `null` when no rung allows (before: `full`). A commit of its own (item 4).
4. `feat(overlord)`, the catalogue whole: every column of Table 4a, the class, reversibility, cover and compensator
   words, `CLASS_COVERS`, every row of Table 4 and the team link's, `actRow` and `effectiveClasses`.
5. `test(overlord)`, the oracles: D-8126 §3's act list (Table 9), what never relaxes, the SAFETY scan, the
   compensators and one home for the catalogue.
6. `feat(overlord)`, the ceilings: Table 5's groups and each row's ceiling, `overlordActCeiling.ts`
   (`actCeilingStep`, `ceilingLatchDue`), gate step 10's ceiling half, the runner's `ActCountReader` with its stated
   default and the latch raise, the cause row, and its console sentence.
7. `test(overlord)`: the four new mutant sets registered in `mutation-floors` at floor 1 (after the holder's yes to
   the packet), the gate's new word in the inbox simulator's gate-word table (`GATE_WORDS`, a record over every gate
   word, whose wake decider holds on any refusal word alike; its count pin moves from fourteen to fifteen), and this note.

Brief item 9: everything added is the product's own table and deciders, read by the server's gate and drawn by the
console. Nothing depends on a surface one agent harness has.

## The fourth kind's row, and where each field was read (call 1816, condition 1)

| Field | Value | Read from, or chosen |
|---|---|---|
| `classes` | none | **Chosen**, and ruled (call 1816): the operator ruled (item 489) that the Overlord may link a team as its own call, which the operator may overturn. Any class but O3 takes no cover, and O3 would need a grant or a request, so the decider of PR B would refuse at `full` what today's cell allows. The linear hierarchy spec (§3.1, item 5) names no class |
| `reversibility` | compensable | The linear hierarchy spec §3.1 item 5: "Overturning is the operator's own write, which makes the key `manual`"; the plan sync's objects already made stay |
| `compensator` | `operator-relink`, `POST /api/projects/:project/linking` | The operator's write, as registered today in `server/src/linking/routes.ts`; the compensators' oracle finds it registered |
| `rungs` | refuse, refuse, allow | Today's cells, moved unchanged |
| `ceiling` | held-by "the linking rule" | `autoLinkAllowed` in the confirm door: one link for a project with no stored key and no operator decision |
| `leastStrength` | `attributed` | Measured: the confirm door's caller is attributed. Its `onRequest` checks the box token, and the gate's step 1 checks the id and uuid through the attribution adapter, which mints `attributed` (`server/src/auth/attributionIdentity.ts`, `server/src/linking/routes.ts`) |
| `verbClass` | `operate` | Measured: the `link-team` row in `server/src/coord/overlordDoors.ts` |
| `actor` | `overlord` | Measured: the row's group is `overlord` and `others: 'refuse'`; the call is recorded with the caller's own id as its maker |
| `answer` | false | Measured: the door's body (`parseTeamConfirm`) carries a project, a team and a workspace, no item or ask; it records a call of its own, not an answer to a held question |
| `carrier`, `mayCarry` | false, none | Measured: the body names no effect, and the door performs none but the link |
| `covers` | none | Follows from class none |

## Departures, by slug

- **`team-link-is-the-fourth-kind`**: the plan knew three W1 kinds; main has four. The characterization and the
  catalogue carry `link-team` with today's cells (item 2, call 1816).
- **`team-link-compensated-by-the-operators-relink`**: the plan's compensators were three; a fourth,
  `operator-relink`, names the operator's own linking write (call 1816, condition 2). The oracle reds a compensator
  whose door is not registered.
- **`acknowledge-cell-reads-the-index`**: `acknowledge`'s ceiling owner reads the W2 index's later wording, "one
  acknowledgement for each operator message, each held delivery to the role and each band-3 request row", where the
  plan's Table 6 said "one acknowledgement for each operator message" (item 6).
- **`rung-step-keeps-its-table-argument`**: the plan's `rungStep(effective, door, act)` drops the table argument; it is
  kept, defaulting to the catalogue's cells, so the simulator's synthetic tables still work (item 4).
- **`gate-reads-names-the-count-group`**: the plan has the runner decide which doors read a count from the row; here
  `gateReads` (L1) answers the group to count, or `null`, so the runner acts on the decider's answer and holds no rule.
- **`act-ceiling-verdict-names-its-limit`**: an `act-ceiling` verdict carries `limit` beside the plan's fields, for
  the refusal's detail.
- **`ceiling-latch-raises-on-unmeasured-standing`**: "unless one stands" raises when the standing read could not be
  measured: a raise only narrows, and the one writer answers a second raise `changed: false`. A measured standing latch
  is never raised again (its own red case).
- **`count-asked-in-all-only-until-a-door-names-its-target`**: the runner asks the count with no programme (`null`),
  because no door of this piece names a target; the door that names one passes it (known limit 2).
- **`effective-classes-takes-a-string`**: `effectiveClasses`' act is a string, so an act the lookup lacks reads
  `unknown`, never class none.
- **`plan-step-5-mutations-kept-as-control-cases`**: Task A3's by-hand mutations are CONTROL cases over an edited copy
  of the table, so a rule that stops biting is a red suite. Task A2's by-hand mutations were run by hand: each reddened
  a case of `overlord-act-catalogue.test.ts` and was restored.
- **`mutant-sets-registered-in-a-later-commit`**: the floors pair was held by another run (its claims); the sets were
  measured with the in-tree runner first and registered after the holder's yes, in a commit of their own.
- **`ladder-test-reads-the-catalogues-list`**: `overlord-ladder.test.ts` held the act-kind list exactly; the catalogue
  owns it now, so that line holds W1's four are in it and `overlord-act-catalogue.test.ts` pins the list whole.
- **`latch-cause-has-a-console-sentence`**: the new cause needs its sentence in `pwa/src/overlord/ladderWords.ts`,
  a record over every cause (call 1827). The table's totality and a non-empty sentence per cause are already held by
  `pwa/test/overlord-words.test.ts`.

## The seam

Files outside server and shared: `pwa/src/overlord/ladderWords.ts`, one line, under call 1827. `shared/api.ts`, every
route, door row, gate row, count line, migration, client row, ccd file, CI workflow and history gate-code file are
untouched. `server/src/server.ts` grows by 7 lines (the count reader's default and the latch's two ports). Test files of
other areas that changed: the floors pair (`server/test/sim/mutation-floors.test.ts` and `.json`, a packet to its holder,
answered yes) and the inbox simulator's gate-word table with its count pin (`server/test/sim/overlordInboxSets.ts`,
`server/test/overlord-inbox-deciders.test.ts`), because `GateWord` gained `act-ceiling`.

## The three files the judge calls weakened

The judge (horkos) is red on #3608 for `rules-mixed` (the skill suite's one import line, which the move required) and
`proof-not-built`; the coordinator ruled to leave it so, with no alias and no split. Its non-blocking `test-weakened`
names three files; for each, what the old assertion held, what the new one holds, and why nothing is lost:

- **`server/test/overlord-inbox-deciders.test.ts`**: the old pin held the gate-word list the wake cases walk at exactly
  fourteen; the new one holds exactly fifteen, the new row being `act-ceiling`, gate step 10's ceiling refusal. Nothing is
  lost: the count stays exact, the list is a record over `GateWord`, so the compiler still holds it total, and every
  case that walked the fourteen walks the fifteen, the wake holding on `act-ceiling` as on every refusal word.
- **`server/test/sim/mutation-floors.test.ts`**: no assertion changed. The file gained one import and one spread
  (`ACT_CATALOGUE_MUTANT_SETS`), and its floors file four keys at 1. Nothing is lost: every existing set and floor is as
  on main, "no floor falls below its value at the merge-base" passes, and four more deciders now have every mutant killed.
- **`server/test/single-definition/ladder-rung-words.test.ts`**: the old check held `RUNG_CELL_MAP` and `RUNG_CELLS`
  defined only in `shared/overlord-ladder.ts`. The new one holds the cells' map, `OVERLORD_ACT_KIND_MAP`, defined only in
  `shared/overlord.ts`, and the four old names absent from every source root, with three one-home scans added (a cell
  map, the class-to-covers map, a list of act kinds). Nothing is lost: "defined once, in its home" still holds for the
  new home, and the old names cannot come back as an alias.

## Mutation, before and after

| Decider | Before (main) | After |
|---|---|---|
| `server/src/coord/overlordLadder.ts#rungStep` | 7 of 7 killed | 12 of 12 (S8 to S12: only allow passes, the pass names allow, the skip names a cell, rung-below names only an allowing rung, by-grant refuses) |
| `server/src/coord/overlordGate.ts#overlordGate` | 19 of 19 | 26 of 26 (O-20 to O-26: the ceiling before the rung, the latch dropped, the half skipped, an unavailable count passing, a start door reading a count, a held-by kind counted, the two words swapped); O-13 killed before and after |
| `shared/overlord.ts#actRow` | new | 3 of 3, floor 1 |
| `shared/overlord.ts#effectiveClasses` | new | 6 of 6, floor 1 |
| `server/src/coord/overlordActCeiling.ts#actCeilingStep` | new | 14 of 14, floor 1 (the plan's least was 12) |
| `server/src/coord/overlordActCeiling.ts#ceilingLatchDue` | new | 3 of 3, floor 1 |

No floor was lowered.

## What PR B reads from this one

- `OVERLORD_ACT_KINDS`, `OverlordActRow`, `actRow` and `ActRowLookup` (its trailing lookup parameter), and
  `effectiveClasses`, which already marks each member `act` or `effect`.
- `CLASS_COVERS` and `COVER_KINDS`; `RUNG_CELL_WORDS` and `RungCellWord`; the row's `answer`, `carrier`, `mayCarry`
  and `leastStrength`.
- `CeilingVerdict` and `actCeilingStep` from `server/src/coord/overlordActCeiling.ts`, for the effect's ceiling verdict
  it takes as an input (F9): the door asks `actCeilingStep(act, effect, { act: 'not-asked', effect: <count> })`.
- `rungStep`'s pass carries the cell, the input `MayActFacts.cell` binds.

## Known limits

1. The spec's Table 7.1a has rows this plan did not carry (R22 and R23's kinds). They are not in the catalogue, so no
   door can perform them; a later plan adds them.
2. The runner asks every count in all only (`programme: null`) until a door that names its target passes it.
3. `ActCountReader`'s default refuses every counted kind; act rows A replaces it, and `overlord-route-v1` must not ship
   while it stands (the index's change).
4. The whole test project's type check is killed by the test slice's memory cap on this box; it was run narrowed to the
   changed test files and their imports, and the main project's and the console's type checks ran whole.
