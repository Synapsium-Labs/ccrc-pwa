# W1a renewal hand-offs: departures and measurements

What the build of `w1a-renewal-handoffs.md` (Tasks 1 to 7) found, by slug, for the coordinator to fold into the ledger. No
D-number is defined here.

## Measurements

### precompact-json-block-measured

The plan's Task 6 precondition and the coordinator's ruling: the PreCompact arm prints `{"decision":"block","reason":...}` and
exits 0, and W0-13 had measured only the exit-code-2 form. Measured on 2026-11-16 on Claude Code 2.1.325 (the newest build
installed on the fleet box), in a fixture HOME (a throwaway `HOME` in the session's scratch directory, with nothing of the
fleet's configuration in it and a dummy API key), with a `PreCompact` hook that reads its input, logs that it ran, prints
the JSON block form and exits 0:

| Run | Hook output | What Claude Code did |
|---|---|---|
| `/compact` on a resumed fixture conversation | `{"decision":"block","reason":"fixture: the JSON block form"}`, exit 0 | `Compaction blocked by PreCompact hook: [<hook>]: fixture: the JSON block form`, and no API call |
| Control: the same, with the hook printing nothing | nothing, exit 0 | the compaction went on (`Not enough messages to compact.`, decided after the hook) |

The hook ran in both runs. So the build honours the JSON block form, and the four failures the plan lists for a build that
ignores it do not occur on it. The run used a manual `/compact`. In the bundled code the PreCompact hooks are run by one
function for every trigger (the trigger is only its matcher), and the automatic, reactive and precomputed paths each read
its `blockedBy`. The arm itself refuses only `auto`.

The plan's other two facts were not measured, and both fail open:

- **Claude Code's precomputed automatic compaction.** The bundled strings carry `Precomputed compact blocked by PreCompact
  hook`, so a precomputed run does consult PreCompact. If it fires first, the arm's once-a-turn refusal is spent there,
  and that turn's proactive compaction passes. The arm then refuses less often, never more.
- **The order of UserPromptSubmit and an automatic PreCompact at a turn's start.** If PreCompact runs first, the arm reads
  the previous turn's marker and may let the compaction through. At worst it refuses every other turn, never twice in one.

So the lane writes `refuse`, live only (Task 6). A later build that changes either order is caught by the compaction
piece's shadow evidence, not by this note.

## Departures

### renewal-mode-door-in-continuity-routes

The plan puts `GET`/`POST /api/coord/renewal-mode` in `server/src/coord/routes.ts`. That file is held by another run, whose
holder agreed to one inserted block and no import line. The door needs imports, so it registers in
`server/src/continuity/routes.ts` beside Renew now: the setting is a continuity setting (owner C3), and that file is this
piece's own. Census consequence: the door is in `CONTINUITY_SESSION_DOORS` (`box-token-census.test.ts`), not in
`coord-pause-route.test.ts`'s `SESSION_ONLY`, and `CLAUDE.md`'s continuity sentence names it, so the "seventeen" sentence is
unchanged. It is still session-gated when sign-in is armed, with no box token.
`coord-routes-single-file.test.ts` names both halves in `OWN_FILE_ROUTES`, and `secret-mask.test.ts` exempts the read (one
setting word, its default and its choices), as it does the roll-idle and plain-auto-memory reads.

### renewal-mode-switch-row-own-pr

The plan's Task 4 modifies `shared/switches.ts` (the `renewal-mode` row). `consolidation-path-guard.test.ts` refuses a diff
that touches `shared/switches.ts` beside any `pwa/` path, and Task 4's PWA row is in this PR. So the switchboard row follows
in a PR of its own, as plain-auto-memory's did (#2799): the row (setting `renewal_mode_settings.mode`, default `when-away`,
owner `C3`, writer `POST /api/coord/renewal-mode`), `switches.test.ts`'s three counts and maps (49 rows, 9 settings, the
writer), and a case in `renewal-mode-route.test.ts` that reads the row. Nothing reads the row at run time: the store, the
lane and the door read `renewal_mode_settings`.

### renewal-mode-unseeded

The migration creates `renewal_mode_settings` with no seed row. No row reads as the spec's default (`renewalModeOf`, the
same narrowing a lost row takes), and the door's write inserts it. A seed would put the literal `'when-away'` in
`server/src/coord/schema.ts`, which `mail-routes.test.ts`'s kebab-token census refuses as an undeclared code.

### operator-mark-quiet-own-row

Ruling F5 (review 1902): the route writes the mark's `at` only, and the lane keeps `quiet` in a row of its own, keyed on
`at`. So the migration has `operator_marks(programme, at)`, written only by the prompt route, and
`operator_mark_quiet(programme, at, quiet)`, written only by the generations lane, instead of the plan's one table with a
`quiet` column. A `quiet` kept for an older `at` reads as none, which is 0. The lane's write is still a compare-and-set on
the `at` it read (`advanceMarkQuiet`), and the plan's mutation (advance without it) still goes red.

### renew-door-reads-the-live-generation

`renew-not-long-lived` is decided from the session's live generation: one of a role whose `longLived` column is true. The
renewal lane mints generations for nothing else, and the request acts on that generation, so this is the measured fact.
The card's role read would leave a coordinator with no open run, whose intent is unread, undecided.

### renew-now-stands-until-renewed

A Renew now request is read once (the cursor). But `renewNow` also stands while the generation still carries the
`operator` due (`renewNowStands`). Otherwise a renewal that waits, for the box's `hibernate-fresh` or for the Overlord
first, would lose the request after one pass. The due clears when the renewal starts or the generation ends: the mint that
ends a generation clears an `operator` due on the ended row (review 2312 F1).

### renew-now-never-renews-from-shadow

The coordinator's ruling F1 on review 2312: a Renew now pressed in shadow never renews anything, then or later.

- The request row carries `live`, whether the `continuity` row was live when the operator pressed it (a column of this
  piece's own table, in its own migration entry). The door answers `{ ok, id, shadow }`, and the console's toast says a
  press in shadow is recorded and that nothing renews while continuity is in shadow.
- The lane reads a request only when it was pressed live and is read on a live pass. A shadow press, or a live press first
  read once the row is lowered, is passed over with the cursor and logged as a shadow line, so it never becomes a due.
- `renewNowStands(requested, dueWhy, live)` is false in shadow, so a shadow pass never writes an `operator` due, and its
  due write clears one a live pass left before the row was lowered.
- Tests (`continuity-renew-now.test.ts`): the flip (press in shadow, read in shadow, row armed, the next pass renews
  nothing), the race (press in shadow first read on a live pass), the lowering (a live `operator` due cleared by the next
  shadow pass) and the end (the ended row carries no `operator` due). Mutants, measured: the
  mutation set `renewNowStands` (`handoffSets.ts`: N1 the due written in shadow, N2 a standing due kept in shadow, N3 a
  request read in shadow; floor in `mutation-floors.json`); and the lane read with neither live check (every request read,
  `renewNow` ignoring the row): `continuity-renew-now.test.ts` 4 failed, 14 passed.

The prompt route and the door share one lookup, `sessionLiveGeneration` (`continuityStore.ts`), which
`runSessionCensus.ts` names as no binding site: a generation row's own session, no run.

### roll-long-lived-reads-the-live-generation

Task 5 gathers `longLived` from `roleFactsOf`, with intent unread, as the generations lane reads it. The rule is
`longLivedOf` (L1, `rollTarget.ts`):

- A decided role reads by its column.
- An ambiguity whose members agree (worker or reviewer) is decided.
- A coordinator-or-plain reading (no open run claimed) is long-lived exactly when the renewal lane holds a live
  generation for it. If that could not be read, it is null, which holds the session as `role-unknown` while the row is
  live.

So a plain session with no generation is rolled as today.

### roll-mutants-named

The plan names the `rollTargetVerdict` mutants "drop `renewal-owns`" and "let `renewal-owns` win over a pinned row". The
set (`server/test/sim/handoffSets.ts`) has four: drop it (H1), read it while shadow (H2), roll an unread long-life (H3),
and let it win over `off` (H4, read as the pinned row). The `stallRestartedVerdict` set has: the old short-lived-only arm
(S1), widened past long-lived roles (S2), a worker told run-less (S3), and no subject key (S4).

### precompact-write-on-the-acts-deps

The field is written by the renewal acts (`RenewalActsDeps.routePrecompact`, wired in `renewalWiring.ts` through
`CCD_ARGV.routeSet` behind the `route` verb's capability), not through a new `SessionHost` method. The port is held by
another run (designation A), whose body adapter keeps it as it is. The lane plans the act (`precompact-field`), live only,
and only when the value differs from what the registry read. It never writes over a field the registry could not read,
or from a soft-renewal count it could not read. The write refuses an id that is not a registry id before `routeSet` composes
its argv (`id-argv-census.test.ts`'s `precompact-id` gate), as the renewal act's own `renew` does.

### precompact-retracted-to-allow

The coordinator's ruling F2 on review 2312: the field never outlives its reason. Every pass, live or shadow, walks the
registry rows that carry the field (not only the live generations) and retracts `refuse` on a row while the `continuity`
row is not live, or, while it is, on a row with no live generation (`precompactRetractions`, L1, `precompact.ts`). The
retraction writes `allow`, not a clear: ccd's `route` clears only `compact`, `compactwindow`, `poolset`, `acctorder` and
`profiledigest` on an empty value, and `precompact` takes `refuse` or `allow` alone. It rides `GenerationsResult.retract`,
which the watcher hands to the wiring's `retract` whatever the row, through the same `routeSet` writer and its id gate.
This departs from "shadow writes nothing" for this one field, by the ruling. Tests (`continuity-precompact-field.test.ts`):
a lowering to shadow retracts it, a generation that ends unreplaced retracts it, a live generation inside its budget keeps
`refuse`. Mutants, measured: the mutation set `precompactRetractions` (P1 shadow retracts nothing, P2 a live generation
retracted, P3 any field retracted, P4 an unread live pass retracts); and the lane's `retract.push` deleted:
`continuity-precompact-field.test.ts` 3 failed, 11 passed.

### restarted-from-the-coordinator-sweep

The widened D5 arm reaches the long-lived sessions the stall watch already judges run-less: the run coordinators
(`judgeStallCoordinator`), each read through `roleFactsOf` as a claimant of open runs, so a row whose child marker reads a
child is never told. The Overlord's role joins in W1 with the role (slug lost-task-nudge-is-the-d5-arm). The watcher asks
`longLivedOf` (L1) for the session's long-life rather than reading the role table inline (review 2312 F3).

### roll-act-rereads-continuity

Review 2312 F6: the roll's act-time re-check (`atAct`) and `afterAct` re-read the `continuity` row
(`continuityLiveOf`, `rollLane.ts`) instead of the pass's snapshot. A row armed while the pass ran then holds a session the
pass judged in shadow: its long-life was not read (null), which is `role-unknown` while live. Test: `roll-sweep-handoff.test.ts`, the row armed between the
pass read and the act (inside the stubbed `release` read the re-check makes). Mutant, measured: the `atAct` re-read deleted,
1 failed, 2 passed.

### wiring-tests-at-the-watcher

Review 2312 F9: two watcher-level tests reach the wiring the L1 tests cannot. Both measured red on their mutant:

- `roll-sweep-handoff.test.ts` drives `FleetWatcher.sweepRoll` with the `continuity` row live and a long-lived coordinator,
  which is skipped `renewal-owns` with no `hibernate` call (a shadow control rolls it). Deleting `continuity: coord, ` from
  the `rollPass` call: 1 failed, 2 passed.
- `stall-restarted-watch.test.ts` drives the stall sweep's run-less coordinator path with `stall-watch-w2-live` armed: one
  `restarted:` self-mail with no run, none on a second sweep (a dark control sends none). Deleting
  `...stallRestartedVerdicts(si, now), ` from `judgeStallCoordinator`'s array: 1 failed, 1 passed.

### checkpointed-not-held

Review 2312 F4: `promptRenewing` holds prompts in `clearing` and `carded` only. `checkpointed` is deliberately not held: the
old conversation is live then and is being asked for its handover note, so a prompt typed in it is answered and can enter
the note, and the spec does not ask for it. `continuity-prompt-renewing.test.ts` pins today's behaviour.

### renew-now-offered-to-coordinators

The console offers "Renew now" in the session's ⋯ menu for a row whose `role` is `coordinator`, the one long-lived role the
fleet frame names today. The door refuses `renew-not-long-lived` for any such row that has no live generation, and the
console says so. Review 2312 F5 asked to hide the item on plain rows if the frame can tell them apart without a new read. It
cannot: `FleetSession.role` is `sessionRoleOf(child)`, the child axis only, so it reads `coordinator` for any
coordinator-or-plain row, and which of them holds a long-lived generation is a coord.db read. The item stays offered, and
the door's refusal is the answer. The prompt's `renewing` sentence now says "Between conversations (starting or renewing)",
since a long-lived session's start or wake holds prompts in `carded` too (F7).

### migration-slot

The migration is entry 86 on this branch: overlaps (#2949) landed 85 on main after responses B (#2914) took 84, and fix round 1 of review 2312 absorbed both,
as the coordinator ordered (renumbered 85 -> 86 on its word of 2026-11-17). Others may hold 86 too; the second to land renumbers on the coordinator's word. Re-measure the
slot before merge, as its comment says.

## Stable exports for W1's consumers

Designation B (Restart) and private store B read these:

- `renewDoorVerdict`, `renewNowStands`, `promptRenewing` and `renewalModeOf` (`server/src/continuity/renewNow.ts`).
- `liveStateOf` and `markOperatorPrompt` (`server/src/continuity/promptHandoffs.ts`).
- `markProgrammesOf` and `operatorQuietOf` (`server/src/continuity/operatorMark.ts`).
- `precompactField` and `precompactRetractions` (`server/src/continuity/precompact.ts`).
- `longLivedOf` (`server/src/coord/rollTarget.ts`).
- `RENEW_REQUESTS_CURSOR` and `sessionLiveGeneration` (`continuityStore.ts`).
- The refusal words `HANDOFF_REFUSALS` (`renewing`, `renew-not-long-lived`, `renew-pending`).
