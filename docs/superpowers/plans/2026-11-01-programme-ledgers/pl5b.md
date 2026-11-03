# Task PL5b: the programme view, Goals and the programme box chip

A task note for the programme ledger (Task PL5b, D-7713). The coordinator folds what it needs into the ledger; this file is
not the ledger. Times are UTC, 2026-11-03.

## What shipped

- **Phase A** (review 1323's carries, then `GoalsPanel`): `programmeWaitsOn` answers `work` for any open run no earlier arm
  matches, so `ended` means exactly "no run outside done and failed" (R1); the mixed-row priority pins (F1), the `orderItems` id
  tie-break pin (F2), the `ItemKind` comment (F3), and `OPEN_ITEM_STATES` derived from `ITEM_TRANSITIONS` (F4). `GoalsPanel`:
  "In short" with its date, "Open the spec in Docs" (built through `docsPageUrl(docsLocation(...))`, and only from a path that
  passes `isSpecPath` in a project that passes the project grammar), and "Changed since approval" with each ruling and PR;
  an unmerged change reads "spec update pending (PR #n)".
- **The programme view** (`ProgrammeScreen.tsx`, route `programme`, `programmePath(slug)`, the ladder arm, `api.goals(slug)`):
  Goals on one side, this programme's share of the list on the other. Goals are drawn from the list's copy at once and replaced
  by the server's answer; a failed read with no copy says so ("Goals could not be read."). With nothing waiting on the operator the
  card reads "Nothing needs you. Waiting on: <WAITS_ON_WORDS>", named only once the runs frame has been heard. The rows, the
  recently cleared trail and the back button are the combined list's own (`ItemRows`, `ClearedTrail`, `Back`), extracted so the
  markup census sees one copy of each.
- **The chip** (`ProgrammeBox.tsx`, `.pg-waiting` in `programmeBox.css`): "N waiting on you" after the title above zero, the
  figure capped by the badges' one cap ("99+"), a `Door` to `programmePath(slug)`. It reads its number off the fleet store on a
  leaf of its own and takes no prop, so the card's memo holds and neither skin's list passes it anything. The Door's 44 px floor
  stays under a finger and relaxes to the line's height under a mouse.
- A change that came from an item links to it ("Open the item that prompted it") while the list still holds that item.

## Departures from the plan, for the ledger to number

- `pl5b-chip-counts-questions` (ruling 14290): the plan's chip counts `waitingCount`, the open items only. The chip counts what
  the programme view's heading counts, the programme's open items plus its sessions' questions (spec §2 defines "waiting on you"
  once, as open, sent back and session questions). One sum, `waitingTotal`, is read by `programmeWaitingCount` (the chip) and by
  `groupByProgramme`'s `waiting` (the view's heading, the rail, the navigation badge). Like the badge, the chip waits for the
  list and the fleet frame: before both it draws nothing.
- `pl5b-goals-links-in-a-sentence`: phase A drew each `TextLink` alone in its element, which `tap-targets.test.tsx` refuses (a
  link alone is a control and needs a tap floor). Each now sits inside a sentence ("Open the spec in Docs to read all of it.",
  "Open the item that prompted it").
- `pl5b-goals-two-sources`: the plan says the screen fetches `api.goals(slug)`. It does, and draws the `waiting` frame's copy of
  the programme's Goals until the answer comes, so a quiet fetch never shows "no spec is pinned yet" for "not heard".
- `pl5b-extracted-shared-markup`: `WaitingScreen.tsx` and `WaitingRoutes.tsx` (PL5a's) export `ItemRows`, `ClearedTrail`, `Back`,
  `useHeard` and `useUnavailable`, which the view reuses; the markup census refused a second copy of each block. The wording the
  list shows is unchanged.
- `pl5b-ended-words-literal`: for a programme with no open run the sentence reads "Nothing needs you. Waiting on: nothing: the
  programme has no open run", the plan's `<WAITS_ON_WORDS>` taken literally.

## Measured

- The browser file `programme-box.browser.test.ts` (26 of 26): the widest chip ("99+ waiting on you", a programme with 100 open
  items) at 390, 1280 and 1920, in both skins and two palettes: inside its box, the kicker not overflowing, 4.5:1, 44 px under a
  coarse pointer; and the programme view opened from it at the same widths: no sideways scroll, no page error, the name in the
  programme's hue at 4.5:1, a pending change at 4.5:1. The whole of `pwa/browser` through `ccrc test`: 49 of 50 files green; the
  fiftieth, `session-header.browser.test.ts`, shows the same two reds (`.chat-head` 200.8 against an accepted 188, at 900) on a
  clean copy of `origin/main`, so they are not this branch's.
- The mutants of both phases are in the pull request body, each run red and restored from a saved copy with the sha256 checked.
