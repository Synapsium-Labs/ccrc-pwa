# Task PL5a: the Waiting on you list, the item view and the navigation entry

A task note for the programme ledger (Task PL5a, D-7712). The coordinator folds what it needs into the ledger; this file is
not the ledger. Times are UTC, 2026-11-02.

## What shipped

- **The list** (`pwa/src/ledgers/WaitingScreen.tsx`, `ledgerWords.ts`): items grouped by programme in the fleet's hue,
  programmes with a blocking item first, the sessions' questions joined from the fleet frame's `attention` bucket, a summary
  line, a rail that filters to one programme, and "Recently cleared". `null` (no frame yet) reads as "waiting for the first
  update", never as "Nothing needs you."
- **The item view** (`ItemView.tsx`): what, why, how as numbered steps, the history, and the panel for the kind. A refused tick
  is put in the operator's words with the button left enabled. A sent-back note is history ("sent back: ..."), never the
  item's state. A secret item has no input and no tick here: the paste panel is PL6's.
- **The navigation**: one `waitingItemsCount` (open items plus question rows, never an item being checked), read by the Refined
  tab, the phone door and the Instrument rail item; two route rows and their ladder arms (`WaitingRoutes.tsx`).
- **The two carries**: the list is read again on focus and when the page becomes visible (review 1336), once for the whole shell
  from `FleetChromeProvider`; the blocking push carries `url: '/waiting'` (review 1331 F1). Review 1332 F5 (the Mail feed's label
  for a blocking record) is left: the label table is keyed by the notice's kind (`coord` is "config" for every `coord` record),
  not by the record's title, so a distinct word is not a one-row change.

## Departures from the plan, for the ledger to number

- `pl5a-waiting-on-the-fleet-store`: the plan puts the view in `waitingStore.ts`. It lives on the fleet store (`waiting`,
  `setWaiting`, the frame's parse and apply in `stores/fleet.ts`, which the plan's Files list does not name), so the badge and
  both screens read one value; `waitingStore.ts` holds the refetch. A reconnect keeps the last view: a blip is not an empty list.
- `pl5a-route-hosts`: two ladder arms in a new file, `pwa/src/ledgers/WaitingRoutes.tsx`, which is the only reader of the store
  and the router in that directory; the screens take props. Not in the plan's Files list.
- `pl5a-gate-output-buffer`: `design/contrast-check.mjs` prints about 1.03 MB on `main`, and 1,080,469 bytes with `ledgers.css`
  in the audit, past `spawnSync`'s 1,048,576-byte default. The two tests that capture that output (`contrast.test.ts` and
  `ink-tiers.test.ts`, `runGate`) were killed with `status: null`. One line each: `maxBuffer: 16 * 1024 * 1024`, in a commit of
  its own. Any later stylesheet would have hit the same cliff.
- `pl5a-no-hand-drawn-controls`: rows are `BareRow`, the options `RadioFieldset`, the typed answer and the note `TextInput`, so the
  control census needed no entries (the note is a one-line field, not a textarea).

## Measured

- The browser file (`pwa/browser/waiting.browser.test.ts`): 144 of 144 at 390, 1280 and 1920, in both skins and all twelve
  palettes: no sideways scroll, no page error, each group's left rule the computed `--prog-<hue>`, every pill and the band's
  programme name at 4.5:1. A `color-mix()` ground reads back from `getComputedStyle` as `color(srgb r g b)` in 0 to 1; a parser
  that takes it for 0 to 255 reports 3.64:1 for a pair the static audit passes. The test scales it.
- The contrast gate: ALL 8892 PASS with the new sheet, and no rule of it in the uncovered census. A hue's text on its own tint
  is measured only when the ink and the ground are on one rule through a variable (`--pg-ink` on `--pg-tint`); a per-hue colour
  rule with the ground on another rule is not measured at all.

## Edited under another run's claim, with leave (not claimed)

`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (the one cell), `pwa/src/lib/routes.ts`, `pwa/src/app.tsx`,
`pwa/test/app.test.tsx` and `pwa/test/command-registry.test.ts`, each placed apart from the holder's own edits as its leave
says. `pwa/test/command-layer.test.tsx`, also named in the leave, needed no change. After review 1359 (F11) `routes.ts` and
`app.tsx` carry only what the leave named: the two route rows, the two ladder arms (the item's arm is `ItemRouteAt`, which
derives the id) and one import. `itemPath` and the id derivation live in `pwa/src/ledgers/WaitingRoutes.tsx`. The go-waiting
assertions of `command-registry.test.ts` are one `it` of their own (F10).

## Mutants

Each run on the working tree, the named suites alone, then restored from a saved copy and its sha256 checked equal.

| # | Mutant | Red cases | sha256 of the file, before and after (equal) |
|---|---|---|---|
| M1 | the nav badge counts checking items | the nav badge counts open items plus question rows, not checking | `5fee45fe9e6e` |
| M2 | the stale label dropped | a checking item reads Checking… and a stale one reads ticked; coordinator not responding; a stale checking item says the coordinator is not responding | `5fee45fe9e6e` |
| M3 | the focus refetch dropped | FleetChromeProvider reads GET /api/waiting when the tab regains focus; a failed read leaves the held view alone (+1) | `8e0cb7ef8e59` |
| M4 | the visibility refetch dropped | reads it again when the page becomes visible, and not when it is hidden | `8e0cb7ef8e59` |
| M5 | the shell's chrome stops mounting the refetch | FleetChromeProvider reads GET /api/waiting when the tab regains focus | `e337a6a316a4` |
| M6 | the blocking push loses its url | (plan PL3); pushes only on a change to true | `53c78353bf34` |
| M7 | programmes with a blocking item no longer first | groups by programme in hue, programmes with a blocking item first | `5fee45fe9e6e` |
| M8 | a refused tick leaves the button disabled | a refused tick shows the refusal sentence and leaves the button enabled | `828c9ef03262` |
| M9 | Dismiss offered while the programme has an open run | Dismiss is offered only while the programme has no open run | `828c9ef03262` |
| M10 | a secret item gets a Mark done button | a secret item has no input and no tick here (the paste panel is a later wave) | `828c9ef03262` |
| M11 | a returned item no longer reads Came back | a returned item shows the coordinator's note under Came back; the summary counts items by state | `5fee45fe9e6e` |
| M12 | no frame yet reads as an empty list | no frame yet is not the empty list | `bfce165c7e2e` |
| M13 | the store takes any waiting frame | a malformed frame is dropped and the held view stays | `16b5c6de3d15` |
| M14 | a reconnect clears the held list | a reconnect keeps the last view: a blip is not an empty list | `16b5c6de3d15` |
| M15 | ink-tiers' spawner loses maxBuffer | the gate excepts exactly Solarized Light and Catppuccin Latte, each at exactly 0.10 with a reason, and holds every other palette to exactly 0.12 and every step to 0.04 (D-5155) | `8b0abe9b6f09` |
| M16 | contrast.test's spawner loses maxBuffer | a @keyframes stop the auditor cannot read as a number is a FAILURE, not a skip; a GROUNDS entry whose rule stopped being self-grounded is a FAILURE (+26) | `1d5d3a76451d` |
| M17 | the checking pill's pair changed to a weaker one | measures every pill and panel pair in every palette, through the stylesheet | `f8c658175d13` |
| M18 | a refusal sentence is its bare slug | a refused tick shows the refusal sentence and leaves the button enabled; every refusal the tick and dismiss routes name has a sentence, not a bare slug | `9320857a8ecd` |
| M19 | the badge count answers before the fleet frame | null before the waiting frame; null before the fleet frame | `55f2131e4ed9` |
| M20 | the Refined app bar loses its Waiting on you tab | every tab, search, settings and New session carry their data-command; the Waiting on you tab's name says 'waiting on you' with the count of open items and questions, not checking (+1) | `83342c2f90a6` |
| M21 | the phone header loses its Waiting on you door | the Waiting on you door's name carries its count, and prints no badge before the waiting frame; the phone header holds the wordmark and the five doors, each with its word as its accessible name, each at least --tap-min, each carrying its data-command | `7c96ff5c5c02` |
| M22 | the Instrument rail loses its Waiting on you item | every rail item, the command field and + carry their data-command; a rail item's tooltip shows on focus-visible; the rail renders RAIL_ITEMS in order, Activity not rendered, each with its word as its name and at least --tap-min tall (+1) | `e650fdd3e370` |
| M23 | the ladder drops the /waiting arm | `/waiting` renders the list in the detail pane, and the item path opens one item; every ROUTES row is reached by a probe, and every probe renders what the table says | `facc920a9dcb` |
| M24 | itemPath builds the wrong path | opens an item at its own path and a question at its session | `9e83d17358da` |
| M25 | Dismiss offered before the runs frame lands | Dismiss is offered only once the runs frame says the programme has no open run | `721e979ed9f6` |
| M26 | questions counted before the fleet frame | counts a session's question only once the fleet frame has landed | `721e979ed9f6` |
| M27 | the list draws no hue on its groups (real Chrome) | the list at 1280 (catppuccin-latte): no sideways scroll, no page error, each group in its hue, every pill at 4.5:1; the list at 1280 (catppuccin-mocha): no sideways scroll, no page error, each group in its hue, every pill at 4.5:1 (+34) | `bfce165c7e2e` |
| M28 | the soon pill drawn in tertiary ink (real Chrome) | the list at 1280 (catppuccin-latte): no sideways scroll, no page error, each group in its hue, every pill at 4.5:1; the list at 1280 (catppuccin-mocha): no sideways scroll, no page error, each group in its hue, every pill at 4.5:1 (+34) | `83f082b9d8b3` |

## Fix round 1 (review 1359)

What changed, by finding. F1: the Decide panel offers the options and "Your own answer", and an optional "Note to the
coordinator"; the note rides inside `answer` (the choice, a blank line, `Note: <note>`), the whole string held to `ANSWER_MAX` by
`maxLength` and a visible count. F2: a programme with no open run shows its items with `WAITS_ON_WORDS.ended` and only Dismiss, in
the item view and on its group in the list. F3: before the first fleet frame, or the runs frame, the screens get `null` and say
they are waiting. F4: sentences for `bad-request`, `too-large`, `unknown-item` and `not-configured`; a test holds the sentence
table to `LEDGER_ROUTE_REFUSALS` and `ITEM_MOVE_REFUSALS`; `/waiting` says so when this box has no coordination database. F5: one
`isWaitingView` for the frame and the read, and one read in flight per store (a read after a tick starts after it). F6: the stale
sentence is the coordinator's side. F7: the needed-by pill shows in every state (the counts are unchanged). F8: one
`programmeIsLive` in `ledgerWords.ts`, built on `programsWithOpenRun`. F9, F10, F11 and F12c as the coordinator ruled. F13:
the browser file asserts the question row and uses slugs whose alphabetical order differs from blocking-first; the screen test's
two notes differ; a session whose bound and claimed runs name different programmes is one row.

Departures for the ledger to number, new in this round:

- `pl5a-note-in-answer`: the operator's note travels inside the tick's `answer` string, because PL4's tick body is
  `{answer?: string}` and the route takes any decide answer of 1 to `ANSWER_MAX` characters. The PWA joins them
  (`\n\nNote: `); no route or wire changes.
- `pl5a-refetch-mount`: `FleetChromeProvider` mounts `useWaitingRefetch` once for the whole shell (review 1336's carry needs a
  shell-wide mount; the plan's Files list names no chrome file). Already in this branch since the first round; named here now.

Mutants of this round, each run on the committed tree against the named suites, then restored from a saved copy and its sha256
checked equal (the twelve-hex prefix is the file's, before and after). R1 to R7 are the review's M1 to M7; N1 to N20 are this
round's cases. All 27 killed.

| # | Mutant | Red case (first) | sha256 of the file, before and after (equal) |
|---|---|---|---|
| R1 | M1: the nav badge counts checking items | the groups add up to the door count (+1) | `386f334728b5` |
| R2 | M2: the stale label dropped | a checking item reads Checking… and a stale one reads ticked; coordinator not responding (+1) | `386f334728b5` |
| R3 | M3: the focus refetch dropped | FleetChromeProvider reads GET /api/waiting when the tab regains focus (+2) | `6e9ab5bb14dc` |
| R4 | M4: isBlocking ignores state | an item being checked is not blocking: its programme does not sort first and it does not lead it | `386f334728b5` |
| R5 | M5: a secret item's answer reaches the DOM | never renders the answer of a secret item | `4ea76a9196d3` |
| R6 | M6: the group's waiting count doubles its questions (the rail and its total) | a group counts its open items and its questions once each, and not what is being checked (+2) | `386f334728b5` |
| R7 | M7: the refetch takes any answer for a list | takes exactly what the frame takes: a list of three arrays, and nothing else | `6e9ab5bb14dc` |
| N1 | F1: the Decide panel has no "Your own answer" option | an own answer and a note go together, and a blank note adds nothing (+2) | `4ea76a9196d3` |
| N2 | F1: the note is dropped from the answer | a note to the coordinator rides inside the answer (+2) | `4ea76a9196d3` |
| N3 | F1: the note has no maxLength of its own | the whole answer, note included, is held to the server's limit by maxLength and a visible count | `4ea76a9196d3` |
| N4 | F1: an answer past the limit can still be sent | a value field has the limit and the count too (+1) | `4ea76a9196d3` |
| N5 | F1: the visible count is dropped | a value field has the limit and the count too (+1) | `4ea76a9196d3` |
| N6 | F2: Mark done is offered on an ended programme | an ended programme's item offers only Dismiss, with the one line that says why | `4ea76a9196d3` |
| N7 | F2: the item view's ended line is dropped | an ended programme's item being checked says the same and offers Dismiss (+1) | `4ea76a9196d3` |
| N8 | F2: the list's ended mark on a group is dropped | a programme with no open run is marked ended, and one with a run, or whose runs are unheard, is  | `9929901a7c9c` |
| N9 | F3: the route passes the snapshot's sessions before the fleet frame | waits for the fleet frame before it calls the list empty or lists a session's question | `c3163185f40d` |
| N10 | F3: the screen treats null sessions as none | before the first fleet frame it says it is waiting, never that nothing needs the operator | `9929901a7c9c` |
| N11 | F4: the programme-unclaimed sentence says dismiss | the programme-unclaimed sentence never says to dismiss: a dismiss is refused while its run is op | `6bfb579e5012` |
| N12 | F4: a route code loses its sentence (unknown-item) | the sentence table is the routes' own codes, so a new code cannot slip by without a sentence | `6bfb579e5012` |
| N13 | F4: /waiting never says this box has no list | says there is no list to wait for when this box has no coordination database | `c3163185f40d` |
| N14 | F5: a focus read does not join the one on the wire | a tab that becomes visible and focused reads once (+1) | `6e9ab5bb14dc` |
| N15 | F5: the re-read after a tick reuses the read already on the wire | a read asked for after a move starts after the one on the wire, so it sees the move | `6e9ab5bb14dc` |
| N16 | F6: the stale sentence says the coordinator has not picked it up | a stale checking item says the coordinator is not responding, whatever made it stale | `4ea76a9196d3` |
| N17 | F7: a checking item loses its needed-by pill | a checking item wears its state and its needed-by, and a stale one says so (+2) | `386f334728b5` |
| N18 | F8: unheard runs read as an ended programme | Dismiss is offered only once the runs frame says the programme has no open run (+7) | `386f334728b5` |
| N19 | F11: the item arm is not keyed by its id | ItemRouteAt keys the item by its id, so a typed answer does not follow the operator to the next  | `c3163185f40d` |
| N20 | F12c: the list's path is not the route row's | Dismiss calls the route, reads the list again and goes back to the list (+2) | `c3163185f40d` |
