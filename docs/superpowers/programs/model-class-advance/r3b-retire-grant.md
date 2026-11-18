# Wave R3b: the lane-models read grant retired

A task note for the programme ledger (model-class-advance, wave R3b, as re-planned on 2026-11-16 in
[the codex-arm plan](../../plans/2026-10-15-model-class-auto-advance-codex-arm.md); D-8406, D-8688 and D-8693 say what
R3 left for this wave). The coordinator folds what it needs into [the ledger](../model-class-advance.md); this file is
not the ledger. Departures are named by slug below, for the coordinator to number.

## What landed

- **The grant is gone.** The agent's file whitelist no longer admits a lane's class registry or catalogue under
  `~/.ccrc/models` (`isLaneModelsFile` and its import left `agent/src/whitelist.ts`), and `agent/CLAUDE.md` says so.
  The grant's shape, `isLaneModelsReadName`, left `shared/models.{mjs,d.mts,ts}` as well: nothing else read it.
- **The server reads a lane through the `models` op alone.** `readLaneModels` (`server/src/laneModels.ts`) has no files
  path: no server source file names `MODELS_DIR_NAME`, `registryFileName` or `catalogueFileName` any more.
- **Every outcome is its own arm of `LaneModelsRead`** (`shared/models.ts`), by the coordinator's rulings for this wave:

  | What happened | The read answers |
  |---|---|
  | An agent without the op, or the bare local io | `unsupported` (this build does not offer the read; no fallback) |
  | The frame never left, or the launcher could not start | `not-started` |
  | The server's builder refused the lane | `refused`, with the builder's `why` |
  | The agent's one models gate was held | `busy` (transient: the next read recovers it) |
  | A timeout, an output past its cap, a lost answer, a stdout off the grammar | `unreadable`, as before |
  | `catalogue-unreadable`, `catalogue-invalid`, `registry-invalid`, `roster-absent`, `roster-unreadable`, `roster-invalid`, `no-answer` | `unreadable` with that `code` |
  | An empty stdout at exit 1 (`ccrc` died before the lane) | `unreadable` with code `no-output` |
  | The argv-grammar words, `registry-unreadable`, any other refusal | `unreadable`, no code (D-8693) |

- **An advance state word this server does not know** reads `{state: 'invalid'}` with the lane's classes kept
  (`readAdvanceReport`), lifting D-8693's "unreadable until wave 5". Only a string `state` that is not one of the four
  wire words takes this arm; an advance that is not an object, has no string `state`, or is an `ok` whose classes do
  not parse still makes the whole read `unreadable`, as D-8693 left it. No advance state word was added.
- **Words.** `laneReadWords` (`pwa/src/lib/models.ts`) gives each arm but `read` one sentence, and names an
  `unreadable`'s reason from `LANE_UNREADABLE_CODE_WORDS`, a table keyed on the type, so a reason the server adds is a
  compile error in the PWA until it is worded. The Models sheet says it (`modelsReadStateWords`, with the class names
  listed below on every arm but `absent`), and so does the session's model picker, in a note above its rows
  (`PickSheet`'s new `note`). `asLaneModelsRead` reads each new arm; an `unreadable` code it does not word is dropped
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

## Departures and notes for the ledger

- `mca-w5-ccrcdir-param-kept`: `readLaneModels` keeps its `ccrcDir` parameter, unread (`_ccrcDir`), because
  `server/test/models-op.test.ts` calls it with that argument and is in another open pull request's files and another
  session's claim. It can go once that pull request has landed.
- `mca-w5-no-output-code`: the empty-stdout-at-exit-1 case needed a code word to carry; it is `no-output`, a word of
  the server's own (no `ccrc` prints it), in the same type as the refusal codes.
- The picker words reach the session's model picker. The new-session sheet's Class choice and the inspector's routing
  line still show class names on a non-`read` answer, with no sentence; neither had one for `absent` or `unreadable`.
- `server/src/server.ts`'s comment on the GET ("before any file is named") was left alone: the file is in another
  session's claim, and the comment is not false, only no longer the whole story.
- The R4 note's sentence that an after-act `busy` "falls back to the files" is now stale: that read answers `busy`.
