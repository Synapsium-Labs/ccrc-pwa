# Wave R3b: the lane-models read grant retired

A task note for the programme ledger (model-class-advance, wave R3b, as re-planned on 2026-11-16 in
[the codex-arm plan](../../plans/2026-10-15-model-class-auto-advance-codex-arm.md); D-8406, D-8688 and D-8693 say what
R3 left for this wave). The coordinator folds what it needs into [the ledger](../model-class-advance.md); this file is
not the ledger. The two departures are defined in the plan's "Deviations found" as D-8757 and D-8758, and cited here.
Fix rounds 1 (review 2586) and 2 (review 2618) are folded into the sections below.

## What landed

- **The grant is gone.** The agent's file whitelist no longer admits a lane's class registry or catalogue under
  `~/.ccrc/models` (`isLaneModelsFile` and its import left `agent/src/whitelist.ts`), and `agent/CLAUDE.md` says so.
  The grant's shape, `isLaneModelsReadName`, left `shared/models.{mjs,d.mts,ts}` as well: nothing else read it.
- **The server reads a lane through the `models` op alone.** `readLaneModels` (`server/src/laneModels.ts`) has no files
  path: no server source file names `MODELS_DIR_NAME`, `registryFileName` or `catalogueFileName` any more.
- **Every outcome is its own arm of `LaneModelsRead`** (`shared/models.ts`), by the coordinator's rulings for this wave:

  | What happened | The read answers |
  |---|---|
  | A ready frame whose ops lack `models`, or the bare local io | `unsupported` (this build does not offer the read; no fallback) |
  | The frame never left, the launcher could not start, or no ready frame yet (F5) | `not-started` |
  | The server's builder refused the lane | `refused`, with the builder's `why` |
  | The agent's one models gate was held | `busy` (transient: the hook asks once more, and opening the picker or the sheet reads again) |
  | A timeout, an output past its cap, a lost answer, a stdout off the grammar | `unreadable`, as before |
  | `catalogue-unreadable`, `catalogue-invalid`, `registry-invalid`, `roster-absent`, `roster-unreadable`, `roster-invalid`, `no-answer` | `unreadable` with that `code` |
  | An empty stdout at exit 1 (`ccrc` died before the lane) | `unreadable` with code `no-output` (D-8758) |
  | `show`'s registry is null | `absent`, with `laneKind` `anthropic` or `never-made` from `show`'s `anthropic` key (F1); no `laneKind` for `no-such-account` (the fleet box's roster has no such lane), which the PWA words as models not found, never as no registry (N1) |
  | The argv-grammar words, `registry-unreadable`, any other refusal | `unreadable`, no code (D-8693) |

- **An advance state word this server does not know** reads `{state: 'invalid'}` with the lane's classes kept
  (`readAdvanceReport`), lifting D-8693's "unreadable until wave 5". Only a string `state` that is not one of the four
  wire words (`absent`, `unreadable`, `invalid`, `ok`) takes this arm. The rest of `readAdvanceReport` is as R3 left it
  (F8): no `advance` key is `unreported`; an `ok` with no `pending` key is `unreported` before its classes are looked at;
  a known `unreadable` or `invalid` keeps its `detail` when it is a string and reads `null` otherwise; and an advance
  that is not an object, has no string `state`, or is an `ok` with `pending` whose classes do not parse makes the whole
  read `unreadable`. No advance state word was added.
- **Words.** `laneReadWords` (`pwa/src/lib/models.ts`) gives each arm but `read` one sentence, and names an
  `unreadable`'s reason from `LANE_UNREADABLE_CODE_WORDS`, a table keyed on the type, so a reason the server adds is a
  compile error in the PWA until it is worded. The Models sheet says it (`modelsReadStateWords`, with the class names
  listed below on every arm but `absent`), and so does the session's model picker, in a note above its rows
  (`PickSheet`'s new `note`, through `lanePickerNote`). The picker's note is said only where a model is actually missing:
  never over an Anthropic lane's `absent`, whose rows are the client's own aliases by design, nor over a `read` (F1).
- **A transient answer keeps the last non-transient one (F2, N1).** `busy` and `not-started` say nothing ran, so
  `useLaneModels` and the screen cache keep the lane's last answer that was not transient (a `read`, or an `absent`,
  `unreadable`, `refused` or `unsupported`) and the word rides beside it (`useLaneModelsView`'s `transient`, said by the
  picker's note and by the sheet's `models-read-transient` line). So an Anthropic lane's `absent` rides through a `busy`,
  and the picker still says nothing over its alias rows. Each transient answer asks again once, three seconds later
  (`LANE_TRANSIENT_RETRY_MS`); the retry is known by its issue number, its own answer schedules nothing, so it never
  loops, and a non-transient answer drops a retry still pending (N3). With nothing to keep, the transient arm is shown as
  the read. A non-transient answer replaces the read. The two transient sentences say what happened and that opening the
  picker or the sheet reads the lane again, and promise nothing more (N2); `not-started` says the request did not reach
  the fleet box. After an act whose read is transient, the sheet shows that read in place, because the lane's last answer
  predates the act, and drops the lane's cache entry, so another surface reads the lane fresh (N4); it then reads the
  lane again. `asLaneModelsRead` reads each new arm; an `unreadable` code it does not word is dropped
  (absence permits), and a `refused` with no builder word is off the grammar. The sheet's "model files could not be
  read" sentence no longer speaks of files.
- **Stale comments corrected:** `shared/models.mjs` (`MODELS_DIR_NAME`'s readers; `MODELS_LANE_ID_RE` and
  `MODELS_RESERVED_IDS`, which the `models` op's lane guard has read since R3), `shared/models.ts` (the advance read's
  absent key), `agent/src/whitelist.ts` (`checkPath`), `server/src/laneModels.ts` (header and the after-act read).

## The mixed-version window

- **New server, agent that still holds the grant (R3 or R4).** The agent lists the op, so the server uses it and never
  sends a file read, whatever `show` answers (`lane-models-grant-retired.test.ts`). The new arms show as words.
- **Old server (R3 or R4), new agent.** Wherever `show` answers, the old server shows what it always did. Where it would
  have fallen back to the files (`busy`, `not-started`, the carried refusals, `ccrc` dying before the lane), the new
  agent refuses the read (`forbidden`), the old server reads that as `unreadable`, and its pickers show class names
  only and its sheet says the lane could not be read just now. That lasts until the server box updates.
- **Old PWA bundle, new server (F6).** A tab opened before the server updated runs the old reader, which knows only
  `read`, `absent` and `unreadable`. For a GET answering `unsupported`, `not-started`, `refused` or `busy` it shows that
  the console got an answer it cannot read, with class names only; an `unreadable` code or an `absent` lane kind it
  ignores. An act whose after-act read answers `busy` makes the old sheet say the change may have happened, though it
  landed; its next read shows the lane. Nothing crashes, and a reload of the tab ends it (the update marks the reload
  pending until the next screen move).

## Departures and notes for the ledger

- D-8757 (was `mca-w5-ccrcdir-param-kept`): `readLaneModels` keeps its `ccrcDir` parameter, unread (`_ccrcDir`),
  because `server/test/models-op.test.ts` (#2943's) still passes it. The sites that now only feed it: the parameter,
  `LaneModelsRouteDeps.ccrcDir` in `server/src/laneModelsRoutes.ts`, and its wiring in `server/src/server.ts` (the GET's
  call and `registerLaneModelsRoutes`'s `ccrcDir`). The removal is the plan ticket `ccrcdir-param-drop`, after #2943, and it must also touch the test files that pass
  the parameter: `lane-models-op`, `lane-models`, `lane-models-post`, `lane-models-hold-race` and
  `lane-models-grant-retired` (N6).
- D-8758 (was `mca-w5-no-output-code`): an empty stdout at exit 1 reads `unreadable` with the server's own code
  `no-output`.
- The picker words reach the session's model picker. The new-session sheet's Class choice and the inspector's routing
  line still show class names on a non-`read` answer, with no sentence; neither had one for `absent` or `unreadable`.
- `server/src/server.ts`'s comment on the GET ("before any file is named") was left alone: the file is in another
  session's claim, and the comment is not false, only no longer the whole story.
- The R4 note's sentence that an after-act `busy` "falls back to the files" is corrected in this PR: that read answers
  `busy`.
- The repo's review judge's `rules-mixed` red on this PR is a known false positive: `agent/CLAUDE.md` stays beside the
  code, because its sentence would be false the moment the code merges (the coordinator's ruling, fix round 1).
