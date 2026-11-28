# Overlord W2, act rows A, first part: the carries of review 4218

Wave 264, run 4226, the coordinator's call 2045. One small pull request on top of the merged first part (#3664): cases, one
mutant row, comments and note sentences. No behaviour of the writer or the reader moves: the diff of server source files is
comments only. No migration, route, gate row, count line, `shared/api.ts` line, ccd file or CI workflow. No deviation number
is defined. Nothing here adds a dependence on the coding harness: every change is a case, a comment or a note line over
mechanisms the product owns.

## 1. What changed, by the review's numbers

| Finding | What changed |
|---|---|
| F1: no case settled, by the lane or the boot pass, a row a session or the operator wrote | `actCases.ts#actApplyCases` gains four cases: a session's row and an operator's row, each written `pending` by the door and settled `done` by the lane and by the boot pass. Each reads both act lines: the first is the act's own actor's subject and kind, the settle's is the server's (`server`, `server`). Mutant A5 (the text `plan.by === 'door' && ` removed, so every settle writes the act's own actor) joins the `applySettle` set |
| F2, F3: the port's doc | One paragraph for every answer that is not ok: the door ends its transaction without committing what it wrote for this act (it throws out of its `tx()`), whatever the word. `journal-append` is described with its two arms: the apply threw (the apply's savepoint alone undone, the journal's guard told `trailing`) and, rarely, the append answered ok and the read-back of the row failed (the row and its line may stand, the guard not told); the door's duty is the same in both. The file header points at it. Nothing is said of an operation-key replay |
| F5: what the ok answer's `sequence` counts | The port's doc: the sequence of the LAST record this append wrote, and the writers do not read it. Both test doubles now answer in that sense: a running count of every record appended, from 1 (the store suite's double summed over its calls, the shared cases' double adding each append's record count). Nothing reads it, so no assertion moved |
| F4: the write's apply case | A comment on the case that moves the highest id: it rests on the next id being the highest plus one (the departure `act-id-from-one-decider`), and would need another way to move the plan if ids ever came from a counter a delete does not lower. The optional case is added too: the natural key taken between the append and the apply (a refused row made to hold the key again, the highest id unmoved), answered `journal-append` with no row and no line. It pins the apply's re-ask over the key; it kills no extra mutant, since dropping `!again.ok ||` still throws (a `TypeError` on the refused answer, caught as `journal-append`), as the review's F4(c) says |
| F6: the first part's note | Section 2 below |

## 2. Corrections for the w2-act-rows-a1 note

The first part's note (`w2-act-rows-a1.md`) is not edited here (the ledger guard); these are for the coordinator to fold.

- **Section 7, limit 6.** Read: "The `act` line's own refusals are the stamp's: the six refusals of its line verdict (`unknown-kind`,
  `unknown-state`, `bad-id`, `bad-actor`, `bad-actor-kind`, and `bad-at`, a time that is not a non-negative safe integer) and a
  failed write (`write-failed`). A value that cannot be serialised throws from the row insert, not from the stamp. Both are
  reached inside the apply, after the append, and answered `journal-append`, as the request record's writers do." The rest of
  the limit (neither writer pre-asks the stamp; the ticketed pre-check) stands.
- **Section 5's lead.** Read: "Every new decider is registered at floor 1. No floor is lowered." The conditional about the floors
  pair's holder is stale: all nine act-row keys are in the floors file at 1 on `main`. Section 3's "The floors pair registration
  is a packet to its holder (below)" is stale for the same reason: it was registered.
- **Section 5's table, `applySettle` row.** After this PR: 4 of 4 (A5 added, below).
- **Section 7, limit 8.** It holds for every answer that is not ok, not only `journal-append` (the port's doc, F3 above).

## 3. Mutation rows

Floors runner (`server/test/sim/mutation-floors.test.ts`), the act-row keys, at this PR's tip. No floor moves: every key stays at 1
with every mutant killed.

| Decider | Before (`main` 1a2471681e) | After |
|---|---|---|
| `server/src/coord/overlordActs.ts#actNaturalKey` | 12 of 12 | unchanged |
| `server/src/coord/overlordActs.ts#nextActId` | 6 of 6 | unchanged |
| `server/src/coord/overlordActs.ts#actWriteVerdict` | 14 of 14 | unchanged |
| `server/src/coord/overlordActs.ts#actSettleVerdict` | 5 of 5 | unchanged |
| `server/src/coord/overlordActs.ts#writeCountGroups` | 4 of 4 | unchanged |
| `server/src/coord/overlordActCeiling.ts#countReadable` | 6 of 6 | unchanged |
| `server/src/coord/overlordActsStore.ts#applyWrite` | 1 of 1 | 1 of 1 (the new key case kills nothing new, section 1) |
| `server/src/coord/overlordActsStore.ts#applySettle` | 3 of 3 | 4 of 4: A5, every settle's line the act's own actor's |
| `server/src/coord/overlordCeilingWiring.ts#ceilingLatchPorts` | 2 of 2 | unchanged |

Red first, measured: with A5's change made by hand in the store, the store suite went red in exactly the four new cases (lane and
boot, session and operator), and the acts, act writers, ceiling wiring and act ceiling suites stayed green beside it (4 failed,
95 passed). The line was restored before anything else ran.

## 4. Departures

None.
