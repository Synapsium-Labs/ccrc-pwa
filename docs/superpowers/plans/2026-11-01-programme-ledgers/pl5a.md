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
- `pl5a-no-hand-drawn-controls`: rows are `BareRow`, the options `RadioFieldset`, the typed answer `TextInput`, so the control
  census needed no entries (a Decide item with no options takes a one-line answer, not a textarea).

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
says. `pwa/test/command-layer.test.tsx`, also named in the leave, needed no change.

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
