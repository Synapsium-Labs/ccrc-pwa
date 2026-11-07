# Desk-nav Task A: Instrument's desk top bar, the worker's record

A task note for the programme ledger (desktop-polish run 1608, wave 106, D-8100). The coordinator folds what it needs into
the ledger; this file is not the ledger, and it defines no number. Times are UTC, 2026-11-07.

## Starting point

- The workspace branch started at `cf00d1020` (`main`, the plan's own merge). No open pull request touched
  `pwa/src/skins/` or `pwa/browser/instrument-*` when the work began, so no merge of `main` was needed.
- Claims 3762 (the plan's files and this note) and 3763 (`pwa/browser/phone-bar.browser.test.ts`, see below) hold every
  path this task edits.

## Step 0: the characterization on main

`instrument-shell.test.tsx`, describe `the desk doors, characterized`, with one helper, `deskDoors()`. With `S` and two more
sessions waiting on the operator, the two bound to open runs, and one open item, at 1280:

- `each door's name, in order`, on `/`, `/runs`, `/settings/updates`, `/docs/project-a/specs/a.md`, `/s/<S.id>` and
  `/waiting/1`: Waiting on you, 4 waiting on you; Inbox, 3 waiting for you; Runs, 2 needs you; Accounts; Archive; Docs;
  Settings.
- `which door is current`: none on `/` and on the session; Runs, Settings, Docs and Waiting on you on the others.

On `main` `deskDoors()` read `nav.shell-rail [data-command]`: both cases PASSED there (commit `3db9e5a29`). The move commit
changed `deskDoors()` to `header.shell-accounts .ins-door:not(.ins-home)`, and both cases PASSED on it unchanged.

## Departures, by slug

The plan's own departures hold as written (`nav-holds-doors-only`, `settings-icon-door`, `home-door-follows-toprouteof`,
`door-form-mounted`, `session-crumb-test-stays`, `rail-browser-file-renamed`). Found while building:

- **`unknown-path-is-the-placeholder`** (ruled by this session's parent through a structured ask, 2026-11-07, as
  recommended). The plan's `every route says where you are` lists `/nope`, but an unknown path draws `app.tsx`'s fleet
  placeholder ("Select a session", no heading), and `topRouteOf` answers null there, so no door is current. On `main` the
  breadcrumb was empty at `/nope` too, so nothing is lost. `app.tsx` is outside the plan's files, so it is untouched: the
  case holds every `ROUTES` row to "a current door or the page's own heading" and pins `/nope` on its own as the
  placeholder with no current door.
- **`move-commit-repoints-imports`**. The plan's Step 1 says the move changes `deskDoors()` and nothing else in the test.
  The test file, and `phone-bar.test.tsx`, imported `RAIL_ITEMS` from `Rail.tsx`, which the move deletes, so neither file
  would load: the move commit also points that import at `TopBar`'s `DESK_DOORS`, and drops `Rail: null` from the `bare`
  object and from `skin-switch.test.tsx`'s two sets, which no longer type-check against `SkinSet`. On the move commit
  (`71af22632`, measured on a `git archive` of it) `instrument-shell.test.tsx` was 10 failed and 27 passed, Step 0's two
  cases among the passed. The ten were the rail describe's four ("the rail renders RAIL_ITEMS in order, …", "the rail never
  clips its tooltips, …", "the active rail item carries aria-current=page, …", "every rail item, the command field and +
  carry their data-command, …"), the top bar describe's two ("the top bar renders the wordmark first, then the crumbs, …",
  "the top bar spans the rail's column"), and four in the T2e describe ("the fourth-track attribute follows the set's
  Inspector part, …" and the rail's Inbox, Waiting on you and Runs door cases), all on the rail's grid track or its
  classes. Step 2 replaced or re-pointed every one.
- **`word-form-pill-in-flow`**. In a door with its word the count pill is a flex item between the icon and the word
  (`order`), drawn up to the door's top and pulled back over the icon's top-right corner, not absolutely placed. Measured
  first with an absolute pill: at "99+" it covered the first letters of "Waiting on you", "Inbox" and "Runs" at 1280. In the
  flow the word starts after the pill whatever it prints. In the icon form the pill keeps the rail's corner, `--sp-1` in.
  The browser Inbox case now reads 900 and 1280: at both the pill straddles the icon's right edge with the `--sp-1` top
  inset; at 900 it has the rail's right inset, and at 1280 the word clears it.
- **`phone-bar-browser-allows-the-home-door`** (ask 326, option 0, ruled 2026-11-07, with its terms in mail 16404). The Global Constraints list `phone-bar` (browser) as unchanged, but its "no bar at a desk" case counted
  `go-fleet` doors at a desk, and the plan's wordmark door runs `go-fleet`. Step 3 amends the jsdom twin of that case and
  not this one, so the whole browser suite's first run was red there (Instrument, 900 and 1280). The one line now reads as
  the jsdom twin does: at 900 and 1280 there is no phone bar, and the only `go-fleet` control is Instrument's wordmark door,
  inside the header's Primary nav; Refined draws none. Every other assertion in the file is unchanged, and the file was
  claimed (3763) before the edit.
- **`command-field-floor-pinned`**. The plan's mutant 7 (`.ins-command`'s `min-width` at `280px`) survives the browser's
  fit case: at 900 the field is 329 px wide, so a 280 px floor never binds and the bar keeps 49 px. A jsdom case pins the
  Interfaces' values (`flex: 1 100 0`, the floor `calc(var(--tap-min) + var(--sp-10))`) and goes red on it.
- **`tip-reads-the-word`** (fix round 1, ruled through a structured ask, 2026-11-07, as recommended). The plan's Interfaces
  have the icon form's tip read the door's whole name. Review 1638 A2 asked for label in name at 900 too; with the whole
  name in the tip and the pill beside it the shown text is "Inbox, 2 waiting for you 2", whose words are no run of the
  name's, space or no space. So the tip reads the door's word, and a counted door follows it with a space and its pill, as
  the word form does: both forms show "Inbox 2", and the name stays "Inbox, 2 waiting for you". It also keeps the widest
  tip inside the window (A1): Waiting on you's tip at a count of 1200 was the whole name and ran 2 px past the left edge.
- **`tip-edge`** (review 1638 F2, ruled in fix round 1). The tip lies over the first row of lane cards, which are painted in
  its own `--bg-raised`, so it takes the desk's popover elevation (`--elev-pop`) and a hairline `--edge-subtle` border, as
  the lanes flyout does; it stays self-grounded on `--bg-raised` and `--ink-primary`. contrast-check passes (9804).
- **`desk-nav-figure-needs-silent-false`**. The browser config prints no console line of a passing case, so the
  `DESK-NAV-FIGURE` lines below were read with `--silent=false` on the command line.

## Figures

`DESK-NAV-FIGURE` (`instrument-bar.browser.test.ts`, "the bar fits on one line with every badge at 99+"), seventeen lanes,
Waiting on you, Inbox and Runs at "99+", the same in both palettes and both pointers:

| Width | Bar | Doors (the wordmark door and six) | Command field | Spec §2.2's estimate |
|---|---|---|---|---|
| 900 | 868 px | 367 px | 329 px | about 670 needed of about 870 |
| 930 | 898 px | 367 px | 359 px | |
| 1100 | 1068 px | 367 px | 529 px | |
| 1279 | 1247 px | 367 px | 708 px | |
| 1280 | 1248 px | 629 px | 447 px | about 1000 needed of about 1250 |
| 1920 | 1888 px | 629 px | 1087 px | |

The doors take 367 px with icons and 629 px with words; the command field takes the rest and keeps its words at every
width measured. Fix round 1 corrected the 1280 row (review 1638 F3): the first record said 575 and 501, read before
`word-form-pill-in-flow` put the pill into the flow, which widened the three counted doors.

The lines as printed at `fix round 1`'s tip, `--silent=false` (the same in both palettes and both pointers; phosphor and
mouse shown):

```
DESK-NAV-FIGURE phosphor, 900px, mouse: bar 868 px, doors 367 px, command field 329 px
DESK-NAV-FIGURE phosphor, 930px, mouse: bar 898 px, doors 367 px, command field 359 px
DESK-NAV-FIGURE phosphor, 1100px, mouse: bar 1068 px, doors 367 px, command field 529 px
DESK-NAV-FIGURE phosphor, 1279px, mouse: bar 1247 px, doors 367 px, command field 708 px
DESK-NAV-FIGURE phosphor, 1280px, mouse: bar 1248 px, doors 629 px, command field 447 px
DESK-NAV-FIGURE phosphor, 1920px, mouse: bar 1888 px, doors 629 px, command field 1087 px
```

The main pane (`instrument-desk.browser.test.ts`, the tracks case), against spec §2.3: 560 px at 900, 940 at 1280, 1259 at
1599, 1500 at 1920, and 1180 at 1600 (the reading column 1180): +52 px at every width, as drawn.

## Red on main's tree, green on this one

The new and rewritten browser cases, run on a `git archive` of `origin/main` with this branch's two browser files copied
in: 37 failed and 26 passed of 63. The 37 are every case of `instrument-bar.browser.test.ts` (30) and the seven rewritten
cases of `instrument-desk.browser.test.ts` (the tracks case, the two 1600 cases and the four Inbox count cases); the 26
are `instrument-desk`'s unchanged cases. On this branch all 63 pass.

## Mutants

Each mutant was applied to the working tree from a saved copy, the named case was run alone (the browser cases under
`vitest.browser.config.ts`), and the copy was restored with its sha256 checked. All fourteen were re-run at fix round 1's
tree (`TopBar.tsx` 02662e84028b, `frame.tsx` a7084380395b, `instrument.css` 34a6b334cdf5). Mutants 12 to 14 are fix round
1's (review 1638 F1 and F2). Every one went red; the table is also in `instrument-shell.test.tsx`'s header.

| # | Mutant | Red in |
|---|---|---|
| 1 | Archive inserted before Accounts | `phone-bar` "they are the desk places with Archive after Accounts" |
| 2 | the wordmark door without `commandDoor('go-fleet')` | `instrument-shell` "the wordmark door runs go-fleet, …"; `phone-bar` "the desk bar shows no fleet place, …"; browser `phone-bar` "no bar at a desk" (900, 1280) |
| 3 | `DOOR_WORDS_QUERY` at `1440px` | `instrument-shell` "at 1280 and 1920 each door shows its word …"; browser "the doors show words from 1280" (1280) |
| 4 | the space before the badge removed | `instrument-shell` "label in name at 1280, and in the icon form at 900 and 1279" ("Waiting on you2") |
| 5 | the tip mounted at the words width too | `instrument-shell` the same label-in-name case; browser "the doors show words from 1280" (1280, 1920) |
| 6 | the frame's rail branch kept, drawing an empty Primary nav | `instrument-shell` "exactly one nav[aria-label="Primary"] …" (Instrument 900: 2) |
| 7 | `.ins-command`'s `min-width` raised to `280px` | `instrument-shell` "the command field takes the rest, …"; SURVIVED by the browser's "fits on one line" (24 of 24 green at six widths), see `command-field-floor-pinned` |
| 8 | the `.ins-bar-doors > .bell` rule deleted | `instrument-shell` "the bell in the bar is at the tap floor"; `control-census` "every twin exemption …"; browser "a touch screen keeps the floor" at 900 and 1280 ("Notifications off: 28 x 28") |
| 9 | the 52px track put back | `instrument-shell` "the grid has two tracks …"; browser `instrument-desk` "the tracks follow the width …" (900: 52, 340, 508) |
| 10 | the tip's `:focus-visible` rule deleted | `instrument-shell` "a door's tip shows on hover and on focus-visible, …"; browser "the tip is drawn below the icon, by hover and by Tab" (8 of 8, "Tab: opacity") |
| 11 | the current door from `matchRoute(path)?.route.id`, not `topRouteOf` | `instrument-shell` "which door is current" (`/settings/updates`); "the wordmark door … is current on / and on a session". Spelled `?.route.id`: a bare `?.id` reads a field `matchRoute`'s answer does not have, and goes red elsewhere for the wrong reason |
| 12 | the tip's `z-index` line deleted | browser "the tip is drawn below the icon, by hover and by Tab" and "the widest tips, by hover" (16 of 16, "the tip is drawn on top: expected 'div.account-gauge'"); `instrument-shell` "the tip has an edge, …" |
| 13 | the tip's hairline border dropped | `instrument-shell` "the tip has an edge: a hairline border and the popover elevation, on its own ground" |
| 14 | the tip's popover elevation dropped | `instrument-shell` the same case |

## Gates

One at a time, through `ccrc test`, on this branch.

At the first tip (`c3e8279d6`):

- `pwa` type check: green. `node design/contrast-check.mjs`: all 9804 pass.
- The whole `pwa` suite (`--heavy`), first full run: 475 files and 14135 tests, all green.
- The whole browser suite (`--heavy`), first full run: 70 of 71 files green (2514 tests), 2 tests red. Both were
  `phone-bar.browser`'s "no bar at a desk" in Instrument, at 900 and 1280 (`phone-bar-browser-allows-the-home-door`).
  That file alone after the fix: 34 of 34. The session-header Instrument 900 pair did not fail in this run.

At fix round 1's tree:

- instrument-shell, phone-bar, header, control-census, tap-targets, refined-shell, contrast, label-in-name and
  skin-boundary: 662 of 662. The `pwa` type check is green, and contrast-check passes all 9804.
- The browser `instrument-bar` and `instrument-desk` files: 85 of 85.
- The whole `pwa` suite: 475 files and 14136 tests, all green.
- The whole browser suite: 70 of 71 files green (2537 tests), 1 red: `connect-sheet.browser` "instrument, light, 360px"
  ("below 900 the sheet is a bottom sheet"). Nothing in this task renders below 900, and that file alone is 20 of 20
  green, so it was a one-off under load. The session-header Instrument 900 pair did not fail.
- The server guard suites (deviation-refs, dtbd, citations, anchors, topology-clean, private-names, ownership, rings, the
  census suites and single-definition): 48 files, green.

This box has no `/usr/bin/google-chrome`, so the browser runs set `CCRC_CHROME` to Playwright's own Chromium.
