# Follow-up: a revert's hold ends by itself (revert-ends-itself)

Programme `model-class-advance`, epic `models-sheet`, ticket `revert-ends-itself`. Run 3405. Built on `main` with
waves 3, 8 and 9 (#3221) and the follow-ups #3216, #3217, #3219, #3222 and #3223 in it. It carries the owner's
ruling (modification 94, and the settings audit's row in `docs/superpowers/specs/2026-11-22-settings-audit.md`):
classes always advance, and a Revert holds its class only until a newer model appears. The coordinator's rulings
are calls 411 and 412, and call 469 corrects them in fix round 1 (below). Hold and Release stay in the op, the door, the shell and the sheet in this run; a later run
removes them and brings Revert back on Anthropic lanes.

## What changed

- **The stored hold gains `from`**, an optional model id: what the Revert moved the class away from. The Codex
  revert writes the pin it moved from (`revertHold`); a re-run on a reverted pin keeps what the hold it replaces
  waited for. The Anthropic revert writes the class's current id from the aliases file when that row is one a launch
  can use; with no new id to read, a re-revert keeps what the hold it replaces waited for, and otherwise it leaves it
  out. It is never refused for it. `parseAdvance` checks it as it checks `hold.model`. No new `by` word.
- **One reader of what a hold waits to be passed** (`holdFrom`, `shared/model-advance.mjs`): the hold's `from`;
  else, for a HAND hold, the held id, so it ends at the next newer model; else, for a REVERT hold, its history (call
  469): on Codex the newest successful `revert` entry whose `to` is the held id, on an Anthropic lane the newest
  successful move whose `from` is the held id (its `to` is the model the Revert left); else null, unknown. A revert
  hold is never read as waiting on the held id, so it never ends on the model it left.
- **One pure decider** (`holdEnds`, beside `chooseCandidate`):
  - Codex: the class's candidate this hour is a model of `from`'s family newer than `from` (`compareVersions`); a
    hand hold on an empty class ends at its first candidate. The retired exception (call 469): once the held pin has
    been missing past the existing retire grace (`retireDue`, asked through `codexHoldEnd`), the hold ends whatever the
    candidate's reason, and the class takes the move an unheld class would take, canary first. That move may be onto
    the model the Revert left: it is then the only runnable choice besides an older one.
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
  - A revert hold whose `from` nothing derives never ends on that pass: `holdEnds` answers a `stamp`, the class's
    current id (the Codex candidate, the newest model newer than the pin; the alias's id when a launch can use it), and
    the hourly refresh records it as the hold's `from` in its own locked write (`refreshRecord` on Codex, on a fresh
    catalogue; `aliases-refresh` on Anthropic). From then on the hold ends only on a model newer than that (Codex) or a
    third id seen after it (Anthropic).
  - ccd's launch fill does not change.
- **`advance-health` and doctor.** Each lane carries `holdsWaiting` (a hold whose end has not come, with `from`), and
  `heldBehind` now names only a hold whose end has come, with `from`, `since` (the sighting that shows it: the fresh
  catalogue's observation on Codex, the alias row's evidence time on Anthropic) and `due` (`holdEndDue`: stood past
  `HOLD_END_WAIT_MS`, which is `RETIRE_GAP_MS`, one hourly refresh plus half an hour). A held class whose end has come
  is read as unheld from then on: a failed canary is `heldBack`. `model-held-behind` warns a `due` row only, never a
  class the held-back or blocked line names (a blocked row with no class names the whole lane); every other hold
  rides the verdict line's tail, so a revert hold waiting for its newer model passes and says what it waits for (a
  revert hold with no `from` yet: that the next hourly refresh records the model its Revert left).
- **No remedy tells the owner to hold, release or hold again**: held-behind, held-back, and blocked's advance-file
  (both arms), shared-family and missing-pin clauses now name what happens by itself or the line that owns the cause
  (`models` for a Codex refresh not reaching a lane, `services` for an Anthropic refresh timer). No remedy names a
  hold, a release or a button; blocked's other clauses still name shell verbs (`rm`, a refresh, `set-class`).
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

### Fix round 1 (call 469)

- A revert hold with no `from` that nothing derives no longer ends on the held id's rule: on Codex it stays held and
  the refresh stamps its candidate as `from`; on Anthropic, with the alias still at the id it left, it stays held and
  is stamped with that id, then ends on a later third id. (Before: ended on any newer model, or any other alias id,
  the reverted-from model included.)
- An Anthropic revert hold with no `from` is derived from the newest move from the held id.
- A hand hold no longer reads its history: it waits on the held id.
- A Codex held pin missing past the grace ends its hold although the model the Revert left is listed (before: the
  family rule answered that model `newer`, the retired exception never fired, and the class stayed pinned to a model
  the lane no longer offers); inside the grace it stays held.
- An Anthropic re-revert with no id to read keeps the replaced hold's `from` (before: left it out). Two existing F1
  re-revert pins in `models-op.test.ts` flip to carry it.
- `advance-health`: an empty class held by a revert with no `from` waits (`holdsWaiting`) instead of being held behind;
  the held-behind case keeps its coverage with a hand hold, in the op suite and in doctor's.
- The hold-race case accepts either lock order: a hand hold placed first is passed by the commit's newer candidate.
- New writer-level case: the commit's intent carries `endsHold`, and the one write that records the move clears the
  hold (no write records the move with the hold standing).

## Mutation rows (a `git archive` copy, each red alone; the unmutated copy green)

M1 to M13 ran on the behaviour commit; M14 to M22 on fix round 1's commit, over the two hold suites (and doctor's
held-behind and waiting cases for M21 and M22).

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
| M14 | a revert hold falls back to the held id (`holdFrom`) | red |
| M15a | the Codex stamp ends the hold on its own pass | red |
| M15b | the alias stamp ends the hold on its own pass | red |
| M16 | the retire grace on a held pin is not read (only `reason: 'retired'`) | red |
| M17 | the intent drops `endsHold` and the hold is cleared in a second write after the commit | red |
| M18 | an Anthropic re-revert does not keep the replaced hold's `from` | red |
| M19 | the Codex refresh stamps nothing | red |
| M20 | `aliases-refresh` stamps nothing | red |
| M21 | a hand hold reads its history | red |
| M22 | doctor drops the waiting line for a revert hold with no `from` | red |

## Known limits, for the ledger

- An alias that moved to an OLDER third id would end the hold on it: the arm assumes, as the resolver does, that an
  alias moves only on newer evidence.
- A stamp records the class's current id, which may already be a third one (the alias moved on, or a model newer than
  the one the Revert left came out first): the hold then waits for the next one after it. It fails held, never moving
  back. On Codex nothing is stamped while the class has no candidate (nothing newer than the pin), so such a hold waits
  until one appears, is stamped with it, and ends on the one after.
- An older op recovering a pending intent that carries `endsHold` keeps the hold: it fails safe, held, not moving.
- Doctor's Codex held-behind measures from the newest catalogue observation (a Codex catalogue keeps no first sighting
  of a model), so a hold whose end has come but which the refresh never acts on (a readiness or budget skip, while it
  keeps observing) stays quiet, as an unheld class's waiting candidate is not named either. A refresh that stops
  observing is `due`, and the `models` line names it.
- A Codex revert across families (`from` in another family than the pin) ends only by retirement: the family rule
  never offers a candidate of `from`'s family.
- A move a crash recovers carries no `reason` on its entry (the intent carries `endsHold`, not the text).
- A held class waiting out the retire grace on a missing pin is still quiet in `blocked` (D-8840); its hold ends
  once the grace has passed, whatever the candidate's reason (call 469), the model the Revert left included.
- `deploy/models-op.mjs` is at the 3,000-line limit: the next change to it moves code out first or lists it.
