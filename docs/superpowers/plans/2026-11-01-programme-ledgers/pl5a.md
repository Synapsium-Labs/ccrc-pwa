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
assertions of `command-registry.test.ts` are one `it` of their own (F10). `pwa/test/app.test.tsx` rewrote one assertion: see `pl5a-item-route-unsafe-id` below.

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

## Fix round 2 (review 1362)

F1: on a Decide item, Mark done is ready only with a decision (an option, or own text that is not empty), so a note alone no
longer sends `Note: ...` with no choice. F2: `openRunsOf` in `ledgerWords.ts` is the one measurement of a programme's open runs,
read by the list's wave label and by `programmeIsLive`; no open-run filter is left in `pwa/src/ledgers`. F3: accepted and
declared below. F4: the comment word on `command-registry.test.ts` line 208 is restored. F5: tests pin the call sites (the hook
joins the read on the wire; a dismiss re-reads the list; a tick's re-read starts after a focus read already on the wire). F6: a
list with items waits for the fleet frame.

Departure for the ledger to number, new in this round:

- `pl5a-item-route-unsafe-id`: `/waiting/<digits past the safe integers>` names no item, so the item arm (`ItemRouteAt`) now says "That item is not on the list any more." where it used to fall through to the shell placeholder; the `app.test.tsx` assertion that expected the placeholder was rewritten to expect that sentence (moving the id derivation out of `app.tsx`, ruling 11, made it so).

Mutants of this round (the review's E1, E2a, E2b and E3b, and the cases for F1 and F2), each run on the committed tree against
the named suites, then restored from a saved copy and its sha256 checked equal. All 7 killed.

| # | Mutant | Red case (first) | sha256 of the file, before and after (equal) |
|---|---|---|---|
| S1 | F1: a note alone makes a Decide item ready (the composed string is tested, not the choice) | "Your own answer" left empty is no decision: a note alone does not enable Mark done | `c3e74002f96e` |
| S2 | F2: openRunsOf counts a closed run (the wave label and the liveness both read it) | Dismiss is offered only once the runs frame says the programme has no open run (+4) | `65ddd48f1a14` |
| S3 | F2: programmeIsLive stops reading openRunsOf | a programme with no open run is marked ended, and one with a run, or whose runs are unheard, is not (+1) | `65ddd48f1a14` |
| E1 | F5 E1: the hook's refetch no longer joins the read on the wire | a tab that becomes visible and focused reads once | `6e9ab5bb14dc` |
| E2a | F5 E2a: the post-tick re-read joins a read that predates the move | a tick's re-read starts after a focus read already on the wire, so the list shows the tick | `c3163185f40d` |
| E2b | F5 E2b: the re-read after a dismiss is deleted | Dismiss calls the route, reads the list again and goes back to the list | `c3163185f40d` |
| E3b | F6 E3b: a list with items is shown before the fleet frame, without its questions | a list with items waits for the fleet frame too: its rows are not shown without the sessions' questi | `395a5ecd848a` |

## Fix round 3 (the merge queue's browser run)

#2146 was dequeued because `browser (pwa) 2/2` failed two existing browser files that the new nav door broke and that a PR's
fast CI skips: `refined-bar.browser.test.ts` ("New session is cut" at 900 and 930px) and `refined-phone.browser.test.ts` (the
row holds six parts, not five; at 360px a door was cut). Reproduced at 7682df4c8 through `ccrc test` (14 cases), fixed in
`pwa/src/skins/refined/refined.css` without loosening either guard, and the phone test now counts the wordmark and five doors.
The whole `pwa/browser` suite then ran through `ccrc test`: 48 of 49 files pass; `session-header.browser.test.ts` fails two
cases at 900px locally (`.chat-head` 200.8px against 188px) on a pristine `origin/main` checkout too, with identical numbers, and
with the Waiting rail item removed, so it is this box's Chromium, not this change; the merge queue's own run passed it.

Departure for the ledger to number, new in this round:

- `pl5a-phone-door`: the Waiting on you door joins the phone header's row as a fifth door (the wordmark and five 44px squares), and the app bar keeps its six tabs; two stylesheet rules make them fit. Measured in Chrome (before the fix, then after): at 360px the wordmark and five doors needed 326px of the 320px row (the last door 6px past its edge) and now leave 18px free between the wordmark and the doors, the doors 4px apart instead of 8 from 380px down; at 390px the row is untouched (32px free). At 900px the bar's line ran 32px past its frame (New session cut) and the tabs' side padding is now 8px under 1000px (12 above), leaving 32px free between the tabs and the doors, with New session at the frame's edge; at 930px it ran 2px over and now leaves 62px free. No door shrinks below 44px, and the phone browser test's count of parts is the wordmark and five doors.

Mutants of this round (the old layout or door count restored; each run on the committed tree against the browser file, then
restored from a saved copy and its sha256 checked equal). All 3 killed.

| # | Mutant | Red case (first) | sha256 of the file, before and after (equal) |
|---|---|---|---|
| P1 | the 360px phone row keeps an 8px gap between five doors (the old layout) | `refined-phone.browser.test.ts`: refined, light, 360px (+1) | `fe9b5f8b9ab2` |
| P2 | the app bar keeps 12px tab padding at 900 with six tabs (the old layout) | `refined-bar.browser.test.ts`: refined, light, 900px, mouse (+7) | `fe9b5f8b9ab2` |
| P3 | the phone header drops the Waiting door (the old door count) | `refined-phone.browser.test.ts`: refined, light, 360px (+5) | `e226b7a9b062` |


## Fix round 5 (review 1374: the 900px bar with the Waiting count drawn)

Review 1374 found what round 3 missed: its fit was measured with no waiting view in the bar test's fixture, so the Waiting tab
drew no count badge. The badge shows whenever anything waits on the operator (the common case), and at 900px `+ New session`
was cut again, in both palettes and under both pointers. Sent back and fixed; the rules did not move (no door or tab below a
finger's square under a coarse pointer, nothing hidden or truncated to make it fit).

- **Red first.** `pwa/browser/refined-bar.browser.test.ts` now serves a waiting view of a hundred open items, so with the
  twelve sessions that ask the operator the Waiting tab counts 112 and prints its widest badge, "99+" (`badgePrint` caps at 99;
  the badge is 31.8px wide). The test waits for that badge before it measures. With the round 3 stylesheet this fails at 900px
  (4 of 16 cases: both palettes, mouse and touch), at 930, 960 and 1280 it passes. The file's "tightest case" comment now says so.
- **The room.** Under 1000px the tabs' side padding is 6px (it was 8 from round 3, 12 before) and the bar line's gap is 12px (16
  above). That gives back 24 + 8 = 32px, in `pwa/src/skins/refined/refined.css`. The touch check now covers every tab as well as
  every door (each at least 44 x 44); the narrowest tab (Fleet, Docs) is 47.6px wide.
- **Measured in Chrome, "99+" badge drawn** (the room between the tabs and the doors beyond the bar line's gap, which is 16px
  in round 3's figures and at 1280px, and 12px in this round's figures under 1000px; negative when the line overruns; New
  session cut when negative): at 900px, round 3's rule: 20.8px past the frame; this round: 11.2px free. At
  930px: round 3: 9.2px free; this round: 41.2px free. (At 960px 39.2 before, 71.2 after; at 1280px unchanged, 311.2.) The Waiting
  tab is 152.1px wide at 900 (156.1 with 8px padding).
- **A1.** `pwa/browser/refined-phone.browser.test.ts` now names the row's doors in order, `go-waiting go-inbox go-runs go-docs
  go-settings`, beside the count of parts, so a different door in Waiting's place no longer passes. The phone fixture serves no
  waiting view, so no phone Waiting badge is drawn there; the phone badge sits on the glyph's corner and does not change the
  row's fit, and the phone figures of round 3 stand (360px: 18px free; 390px: 32px free).

Departure for the ledger to number, restated (still `pl5a-phone-door`, the figures now with the Waiting badge present):

- `pl5a-phone-door`: the Waiting on you door joins the phone header's row as a fifth door (the wordmark and five 44px squares)
  and the app bar keeps its six tabs; stylesheet rules make them fit. App bar at 900px with the "99+" badge: the line ran 20.8px
  past its frame with round 3's rule (8px tab padding, 16px gap) and now has 11.2px free (6px padding, 12px gap, under 1000px);
  at 930px 9.2px free became 41.2px. Phone row: 360px 18px free, 390px 32px free (doors 4px apart under 380px). **Rejected
  alternative:** moving Waiting on you to the phone's overflow place (the Settings page or a menu) would have kept the row at
  four doors, but the Waiting list is the operator's one place to find what waits on them, and a phone must keep it one tap away
  like Inbox and Runs.

Mutants of this round (each run on the working tree against its browser file, then restored from a saved copy and its sha256
checked equal). Both killed.

| # | Mutant | Red cases | sha256 of the file, before and after (equal) |
|---|---|---|---|
| Q1 | the room recovery undone: round 3's rule (8px tab padding, no gap rule) under 1000px | `refined-bar.browser.test.ts`: the four 900px cases (4 of 16) | `refined.css` `49ffcf3cb000` |
| Q2 | a different door (`go-accounts`) in Waiting's place, six parts kept | `refined-phone.browser.test.ts`: "the doors are go-accounts go-inbox go-runs go-docs go-settings" (6 of 41) | `PhoneHeader.tsx` `e226b7a9b062` |
