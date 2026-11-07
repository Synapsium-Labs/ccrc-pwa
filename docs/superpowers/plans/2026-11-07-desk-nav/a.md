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
  object and from `skin-switch.test.tsx`'s two sets, which no longer type-check against `SkinSet`. The old rail and top
  bar describes were red on the move commit, as the plan expects, and Step 2 replaced them.
- **`word-form-pill-in-flow`**. In a door with its word the count pill is a flex item between the icon and the word
  (`order`), drawn up to the door's top and pulled back over the icon's top-right corner, not absolutely placed. Measured
  first with an absolute pill: at "99+" it covered the first letters of "Waiting on you", "Inbox" and "Runs" at 1280. In the
  flow the word starts after the pill whatever it prints. In the icon form the pill keeps the rail's corner, `--sp-1` in.
  The browser Inbox case now reads 900 and 1280: at both the pill straddles the icon's right edge with the `--sp-1` top
  inset; at 900 it has the rail's right inset, and at 1280 the word clears it.
- **`phone-bar-browser-allows-the-home-door`** (ruled by this session's parent through a structured ask, 2026-11-07, as
  recommended). The Global Constraints list `phone-bar` (browser) as unchanged, but its "no bar at a desk" case counted
  `go-fleet` doors at a desk, and the plan's wordmark door runs `go-fleet`. Step 3 amends the jsdom twin of that case and
  not this one, so the whole browser suite's first run was red there (Instrument, 900 and 1280). The one line now reads as
  the jsdom twin does: at a desk the only `go-fleet` is Instrument's wordmark door, holding the wordmark, and Refined draws
  none. The file was claimed (3763) before the edit.
- **`command-field-floor-pinned`**. The plan's mutant 7 (`.ins-command`'s `min-width` at `280px`) survives the browser's
  fit case: at 900 the field is 329 px wide, so a 280 px floor never binds and the bar keeps 49 px. A jsdom case pins the
  Interfaces' values (`flex: 1 100 0`, the floor `calc(var(--tap-min) + var(--sp-10))`) and goes red on it.
- **`desk-nav-figure-needs-silent-false`**. The browser config prints no console line of a passing case, so the
  `DESK-NAV-FIGURE` lines below were read with `--silent=false` on the command line.

## Figures

`DESK-NAV-FIGURE` (`instrument-bar.browser.test.ts`, "the bar fits on one line with every badge at 99+"), seventeen lanes,
Waiting on you, Inbox and Runs at "99+", the same in both palettes and both pointers:

| Width | Bar | Doors (the wordmark door and six) | Command field | Spec §2.2's estimate |
|---|---|---|---|---|
| 900 | 868 px | 367 px | 329 px | about 670 needed of about 870 |
| 930 | 898 px | 367 px | 359 px | |
| 1280 | 1248 px | 575 px | 501 px | about 1000 needed of about 1250 |

The doors take 367 px with icons and 575 px with words; the command field takes the rest and keeps its words at every
width measured.

The main pane (`instrument-desk.browser.test.ts`, the tracks case), against spec §2.3: 560 px at 900, 940 at 1280, 1259 at
1599, 1500 at 1920, and 1180 at 1600 (the reading column 1180): +52 px at every width, as drawn.

## Red on main's tree, green on this one

The new and rewritten browser cases, run on a `git archive` of `origin/main` with this branch's two browser files copied
in: 37 failed and 26 passed of 63. The 37 are every case of `instrument-bar.browser.test.ts` (30) and the seven rewritten
cases of `instrument-desk.browser.test.ts` (the tracks case, the two 1600 cases and the four Inbox count cases); the 26
are `instrument-desk`'s unchanged cases. On this branch all 63 pass.

## Mutants

Each mutant was applied to the working tree from a saved copy, the named case was run alone (the browser cases under
`vitest.browser.config.ts`), and the copy was restored with its sha256 checked (`TopBar.tsx` f237e484efd5, `frame.tsx`
32b12ac6d37e, `instrument.css` 47aa996c709e). Every one went red; the table is also in `instrument-shell.test.tsx`'s header.

| # | Mutant | Red in |
|---|---|---|
| 1 | Archive inserted before Accounts | `phone-bar` "they are the desk places with Archive after Accounts" |
| 2 | the wordmark door without `commandDoor('go-fleet')` | `instrument-shell` "the wordmark door runs go-fleet, …"; `phone-bar` "the desk bar shows no fleet place, …"; browser `phone-bar` "no bar at a desk" (900, 1280) |
| 3 | `DOOR_WORDS_QUERY` at `1440px` | `instrument-shell` "at 1280 and 1920 each door shows its word …"; browser "the doors show words from 1280" (1280) |
| 4 | the space before the badge removed | `instrument-shell` "label in name at 1280" ("Waiting on you2") |
| 5 | the tip mounted at the words width too | `instrument-shell` "label in name at 1280"; browser "the doors show words from 1280" (1280, 1920) |
| 6 | the frame's rail branch kept, drawing an empty Primary nav | `instrument-shell` "exactly one nav[aria-label="Primary"] …" (Instrument 900: 2) |
| 7 | `.ins-command`'s `min-width` raised to `280px` | `instrument-shell` "the command field takes the rest, …"; SURVIVED by the browser's "fits on one line" (12 of 12 green), see `command-field-floor-pinned` |
| 8 | the `.ins-bar-doors > .bell` rule deleted | `instrument-shell` "the bell in the bar is at the tap floor"; `control-census` "every twin exemption …"; browser "a touch screen keeps the floor" ("Notifications off: 28 x 28") |
| 9 | the 52px track put back | `instrument-shell` "the grid has two tracks …"; browser `instrument-desk` "the tracks follow the width …" (900: 52, 340, 508) |
| 10 | the tip's `:focus-visible` rule deleted | browser "the tip is drawn below the icon, by hover and by Tab" (8 of 8, "Tab: opacity") |
| 11 | the current door from `matchRoute`, not `topRouteOf` | `instrument-shell` "which door is current" (`/settings/updates`); "the wordmark door … is current on / and on a session" |

## Gates

One at a time, through `ccrc test`, on this branch:

- `pwa` type check (`tsc --noEmit`): green.
- `node design/contrast-check.mjs`: all 9804 pass.
- The whole `pwa` suite (`--heavy`), first full run: 475 files, 14135 tests, green.
- The whole browser suite (`--heavy`), first full run: 70 of 71 files, 2514 tests green, 2 red: `phone-bar.browser`'s "no
  bar at a desk" in Instrument at 900 and 1280 (`phone-bar-browser-allows-the-home-door`). That file alone after the fix:
  34 of 34. The session-header Instrument 900 pair, red on `main` on this box, did not fail in this run.
- This box has no `/usr/bin/google-chrome`: the browser runs set `CCRC_CHROME` to Playwright's own Chromium.
