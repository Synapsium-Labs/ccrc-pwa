# Follow-up: a revert's hold ends by itself (revert-ends-itself)

Programme `model-class-advance`, epic `models-sheet`, ticket `revert-ends-itself`. Run 3405. Built on `main` with
waves 3, 8 and 9 (#3221) and the follow-ups #3216, #3217, #3219, #3222 and #3223 in it. It carries the owner's
ruling (modification 94, and the settings audit's row in `docs/superpowers/specs/2026-11-22-settings-audit.md`):
classes always advance, and a Revert holds its class only until a newer model appears. The coordinator's rulings
are calls 411 and 412. Hold and Release stay in the op, the door, the shell and the sheet in this run; a later run
removes them and brings Revert back on Anthropic lanes.

## What changed

- **The stored hold gains `from`**, an optional model id: what the Revert moved the class away from. The Codex
  revert writes the pin it moved from (`revertHold`); a re-run on a reverted pin keeps what the hold it replaces
  waited for. The Anthropic revert writes the class's current id from the aliases file when that row is one a launch
  can use, and leaves it out otherwise; it is never refused for it. `parseAdvance` checks it as it checks
  `hold.model`. No new `by` word.
- **One reader of what a hold waits to be passed** (`holdFrom`, `shared/model-advance.mjs`): the hold's `from`;
  else the newest successful `revert` entry whose `to` is the held id (only the Codex arm records one); else the held
  id, so a hand hold ends at the next newer model.
- **One pure decider** (`holdEnds`, beside `chooseCandidate`):
  - Codex: the class's candidate this hour is a model of `from`'s family newer than `from` (`compareVersions`); a
    hold on an empty class ends at its first candidate. The one retired exception: a held pin the retire grace has
    retired (`reason: 'retired'`) ends its hold, and the class takes the move an unheld class would take.
  - Anthropic: the alias row names an id other than `from` and other than the held id, the row is launchable and not
    unobserved, and its evidence came after the hold began (`heldUnobserved`, asked of the hold standing now).
- **The writers act on it under the lane lock, clearing the hold in the write that records the move.**
  - `advance-plan` answers `held: false` for a class whose hold ends, so the step canaries it like any class.
  - `advance-commit` asks `holdEndFor` (ends only on the candidate it was planned on), marks the intent
    `endsHold: true` so a move a crash recovers clears it too (`reconcilePending`), records a `reason` on the entry
    (`holdEndEntry`), and clears the hold (`endHold`). A failed canary or a failed move keeps the hold.
  - `aliases-refresh` settles an ending hold as a release is settled: one move from the held id to the alias's id,
    `previous` at the held id, `releasedAt` at the refresh, the hold cleared in that advance write, and the aliases
    file written resolved without that hold. Its crash key now reads for every class: a newest `ok` move to the
    alias's id later than the aliases file it started from is answered and nothing is appended, whatever id that
    older file names (a hold's end may be the first refresh to see the id).
  - ccd's launch fill does not change.
- **`advance-health` and doctor.** Each lane carries `holdsWaiting` (a hold whose end has not come, with `from`), and
  `heldBehind` now names only a hold whose end has come, with `from`, `since` (the sighting that shows it: the fresh
  catalogue's observation on Codex, the alias row's evidence time on Anthropic) and `due` (`holdEndDue`: stood past
  `HOLD_END_WAIT_MS`, which is `RETIRE_GAP_MS`, one hourly refresh plus half an hour). A held class whose end has come
  is read as unheld from then on: a failed canary is `heldBack`. `model-held-behind` warns a `due` row only, never a
  class the held-back or blocked line names (a blocked row with no class names the whole lane); every other hold
  rides the verdict line's tail, so a revert hold waiting for its newer model passes and says what it waits for.
- **No remedy tells the owner to hold, release or hold again**: held-behind, held-back, and blocked's advance-file
  (both arms), shared-family and missing-pin clauses now name what happens by itself or the line that owns the cause
  (`models` for a Codex refresh not reaching a lane, `services` for an Anthropic refresh timer), never a shell verb
  or a button.
- **A read fact.** `show` (every answer `describe` builds) carries `revertHoldEnds: true`, a constant of the op; the
  server's one reader (`readShowAnswer`, `server/src/laneModels.ts`) carries it on a `read` as an optional
  `revertHoldEnds: true`, and reads anything else, or its absence from an older op, as "does not". The console does
  not use it yet.
- **`heldUnobserved` moved** into `shared/model-advance.mjs`, re-exported from `shared/model-aliases.mjs` unchanged,
  so the decider asks the one rule without an import cycle (consent of run 3403, which holds that file: the packet's
  three hunks, unchanged).
- `deploy/models-op.mjs` stays at 3,000 lines, the growth check's limit: the decisions it makes about a hold are the
  pure helpers `revertHold`, `holdEndFor`, `holdEndEntry` and `holdReading`.

## Cases the behaviour change flips

The characterization commit pins today's behaviour green on `main` (`server/test/models-op-hold-ends.test.ts`);
the behaviour commit flips these, each now pinned:

- Codex: a revert hold once a model newer than the one it left appears (moves, hold cleared in the move's write); a
  hand hold with a newer model (ends: its `from` is the pin); a held pin the retire grace has retired (moves, the
  entry says why); a failed canary on an ending hold (recorded, hold kept, where it was abandoned `held`).
- Anthropic: a revert hold once the alias names a third id observed after the hold (one move, hold cleared,
  `releasedAt`); a hand hold once the alias names another id after it.
- Existing pins changed to match: every revert hold now carries `from`; `advance-plan`'s and `advance-commit`'s
  `held` cases use a hold that waits on the candidate (a hand hold would end); `advance-health`'s held cases, its lane
  shape (`holdsWaiting`), and the held-back case D-5221 (only while a hold stands); the alias F4 and F1 cases (a third
  id now ends the hold); the release-settle cases hold after the cache naming X3, so the alias's move rests on older
  evidence and the release still has something to settle; the bash advance step's two hold cases use a waiting hold;
  the hold-race case (a hand hold is now passed); every doctor remedy and the held-behind lines.
- Unchanged and still pinned: a revert hold while the newest model is the one it left; a revert hold an older build
  wrote, read from its history; the alias at the id the Revert left, and a third id on evidence older than the hold.

## Mutation rows (a `git archive` copy of the behaviour commit, each red alone; the unmutated copy green)

| Row | Mutation | Result |
|---|---|---|
| M1 | `advance-plan` does not ask the decider | red |
| M2 | `advance-commit` abandons every held class | red |
| M3 | `aliases-refresh` does not ask the decider | red |
| M4 | the hold's `from` ignored (`holdFrom`) | red |
| M5 | the unobserved rule dropped (alias arm) | red |
| M6 | doctor warns inside the refresh window (`due` not read) | red |
| M7 | the wait before `due` dropped | red |
| M8 | the commit leaves an ended hold standing | red |
| M9 | the refresh leaves an ended hold standing | red |
| M10 | a recovered move keeps the ended hold | red |
| M11 | doctor warns a class the held-back line names | red |
| M12 | the Codex revert writes no `from` | red |
| M13 | the Anthropic revert writes no `from` | red |

## Known limits, for the ledger

- An alias that moved to an OLDER third id would end the hold on it: the arm assumes, as the resolver does, that an
  alias moves only on newer evidence.
- A Codex catalogue keeps no first sighting of a model, so `since` is the newest fresh observation: a refresh that
  keeps observing but never reaches the class (readiness, budget) is not `due`, as an unheld class's waiting
  candidate is not named either. A refresh that stops observing is, and the `models` line names it.
- A Codex revert across families (`from` in another family than the pin) ends only by retirement: the family rule
  never offers a candidate of `from`'s family.
- A move a crash recovers carries no `reason` on its entry (the intent carries `endsHold`, not the text).
- A held class waiting out the retire grace on a missing pin is still quiet in `blocked` (D-8840); its hold ends
  once the grace has passed.
- `deploy/models-op.mjs` is at the 3,000-line limit: the next change to it moves code out first or lists it.
