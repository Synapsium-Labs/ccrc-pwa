# Follow-up: a transient answer beside a kept answer that names no model

Programme `model-class-advance`, epic `models-sheet`, checkpoint `sheet-live`, ticket `transient-beside-kept-answer`.
Run 2822. It closes four gaps that wave 5's landing check found, after wave 5 ruled that a transient answer (`busy`,
`not-started`) keeps the lane's last answer and makes one bounded re-read.

## What was there before (measured on `main` at 51ab7b589)

- **Sheet:** a kept answer that names no model (`unreadable`, `unsupported`, `refused`, or an `absent` that is not an
  Anthropic lane's) beside a transient word showed one element only: the kept answer's words, ending "the sheet reads
  again when it is opened", with no transient line. The new sheet cases (twelve: six kept answers by two transient
  words) were red there: no `models-read-transient` element.
- **Picker:** the same pair showed the transient sentence only. `main` pinned it:
  `lanePickerNote({ kind: 'unreadable' }, 'busy')` was `laneReadWords({ kind: 'busy' })`, so the picker no longer said why
  no model was shown.
- **Server read:** `show`'s null registry with no `anthropic` boolean read as `absent` with no `laneKind`, the same value
  as `no-such-account`.

## What changed

1. **Both things are said, on both surfaces.** `laneTransientBeside` (`pwa/src/lib/models.ts`) is the one decider for
   whether the transient word is said beside the kept answer. It is used by the picker's note (`lanePickerNote`) and by
   the sheet. The picker says the kept answer's sentence, then the transient sentence. The sheet shows two lines,
   `models-read-state` (the kept answer's words) and `models-read-transient` (the transient line). When the transient
   line is shown, `modelsReadStateWords` ends with "listed below by name" instead of "reads again when it is opened",
   so "again" is said once, as fix round 2's N2 had it.
2. **The Anthropic case through the session screen.** An Anthropic lane's `absent` is read on mount; opening the picker
   reads again and the box is busy. The absent keeps its lane kind, the picker adds no note, and the busy does not
   replace it. If the hook lets the transient answer replace the kept one, this case goes red (measured).
3. **The `LaneModelsView` docstring** now says what the hook keeps: any answer that is not transient, not only a good
   read.
4. **An `absent` with no lane kind now has one cause.** Every `show` body has carried the `anthropic` boolean since the
   registry's first plan (`describe` and `orphanDescribe` in the models op). So a null registry without it is a body
   off the grammar, and `readShowAnswer` now reads it as `unreadable`, as it reads every other off-grammar body. Choice
   and reason: the two causes were one value that the PWA worded as "the fleet box did not find this lane's models",
   which was false for a lane the box did find. Splitting `absent` with a new `laneKind` would have added a wire word
   for a body no build sends. Reading it as `unreadable` keeps the wire's vocabulary as it is and makes the existing
   words true. `shared/models.ts` names the one remaining case: a server from before R3b fix round 1 (F1) sent no
   `laneKind` at all, so from it an `absent` with none may also be a lane with no registry.

## Decisions to record

The coordinator ruled (fix round 1) that neither departs from a plan's written decision: both refine the ticket, and
they stay named by slug here with no deviation number.

- `sheet-anthropic-no-transient-line`: on the sheet, an Anthropic lane's kept `absent` shows its own words and no
  transient line, as the picker shows no note there (F1). Both surfaces say the same two things, or the same one. The
  rule has one home, `laneAbsentByDesign` (`pwa/src/lib/models.ts`), which the picker's note and the transient decider
  both ask (review 2824, F1).
- A kept `unsupported` beside `busy` reads as a contradiction (the build does not offer the read, yet the box was busy
  with one), but it is reachable only when the fleet box's agent is updated while a sheet stays open, and it is as
  designed: each line is true of the answer it words (review 2824, F2).
- `absent-anthropic-key-unreadable`: item 4 changes what the server answers, not only its text. A null registry whose
  `show` body lacks the `anthropic` boolean (missing, a string, or null) is now `unreadable`. That replaces the F1
  test case that pinned it as an `absent` with no `laneKind`. Two fixtures sent that body and now send `show`'s real
  one: one in the `readLaneModels` cases and one in the `GET /api/models/:lane` cases.
- The wave 5 note (`r3b-retire-grant.md`) says an `absent` with no `laneKind` means `no-such-account`. That is now the
  only cause from this server, so the note stays true; it is not edited here.

## Mixed versions

The wire's shape is unchanged. An older PWA reads the newer server's `unreadable` with its existing words. A newer PWA
on an older server reads an `absent` with no `laneKind` with the same words as before. The two-line sheet and the
two-sentence note are PWA-only.
