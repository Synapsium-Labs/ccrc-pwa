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
first, would lose the request after one pass. The due clears when the renewal starts or the generation ends.

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
or from a soft-renewal count it could not read.

### restarted-from-the-coordinator-sweep

The widened D5 arm reaches the long-lived sessions the stall watch already judges run-less: the run coordinators
(`judgeStallCoordinator`), each read through `roleFactsOf` as a claimant of open runs, so a row whose child marker reads a
child is never told. The Overlord's role joins in W1 with the role (slug lost-task-nudge-is-the-d5-arm).

### renew-now-offered-to-coordinators

The console offers "Renew now" in the session's ⋯ menu for a row whose `role` is `coordinator`, the one long-lived role the
fleet frame names today. The door refuses `renew-not-long-lived` for any such row that has no live generation, and the
console says so.

### migration-slot

The migration is entry 83 on this branch. Responses B and portfolio B each hold 83 on theirs, so the coordinator
renumbers it at landing. Re-measure the slot before merge, as its comment says.

## Stable exports for W1's consumers

Designation B (Restart) and private store B read these:

- `renewDoorVerdict`, `renewNowStands`, `promptRenewing` and `renewalModeOf` (`server/src/continuity/renewNow.ts`).
- `liveStateOf` and `markOperatorPrompt` (`server/src/continuity/promptHandoffs.ts`).
- `markProgrammesOf` and `operatorQuietOf` (`server/src/continuity/operatorMark.ts`).
- `precompactField` (`server/src/continuity/precompact.ts`).
- `longLivedOf` (`server/src/coord/rollTarget.ts`).
- `RENEW_REQUESTS_CURSOR` (`continuityStore.ts`).
- The refusal words `HANDOFF_REFUSALS` (`renewing`, `renew-not-long-lived`, `renew-pending`).
