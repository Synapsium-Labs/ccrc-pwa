# Wave 188: the browser files measure the dark palette where their titles say they do (desktop polish run 4002)

The task note for desktop polish wave 188, written by its worker for the coordinator to fold into the ledger. Each claim
says whether it was **measured** (run or read on this tree by this wave) or **inferred**. Base: `main` at `aba5845760`.

## 1. In short

Seven console browser files handed the app the theme `'dark'`. That is not a theme id: the dark palette's id is
`PHOSPHOR` (`'phosphor'`, `ui/src/styles/themes.ts`). `resolveTheme` sends an unknown value to `SYSTEM`, and a Playwright
context that sets no colour scheme is light, so each "dark" case was its light case run a second time, and nothing read
back the theme the page carried. **These files never measured contrast in either theme**: what went unmeasured was the
dark palette's fit, sideways scroll and tap checks. With the real id they all pass in the dark palette, so no
stylesheet, token or palette seed moves in this wave.

The wave adds three things:

- the seven files take `PHOSPHOR` from `@ccrc/ui` and assert, after every load, that the page carries the theme they
  asked for (`expectStampedTheme`, a new shared browser module, `pwa/browser/stampedTheme.ts`);
- a hermetic tree guard in the pwa suite, `pwa/test/browser-theme-ids.test.ts`: no browser file hands the app a theme
  the app does not keep. It runs on every pull request, which runs no browser file;
- the shared opener, `openApp` in `pwa/browser/app.ts`, refuses a theme its resolver does not keep, before any context
  opens. That covers what the scan cannot resolve. The hunk went to the holder of that file's claim as a diff packet
  first, and was applied as the packet showed after their yes. Fix round 1 (review 4015) pins it with a hermetic case in
  `pwa/test/browser-dist.test.ts`.

## 2. The fault, proved (measured)

A temporary probe file, never committed, opened `/runs` in Refined at 1280 three times through `openApp`:

| asked | stored | stamped `data-theme` | body background | body colour |
|---|---|---|---|---|
| `light` | light | `light` | rgb(244, 246, 243) | rgb(26, 32, 27) |
| `dark` | dark | `light` | rgb(244, 246, 243) | rgb(26, 32, 27) |
| `phosphor` | phosphor | none (the `:root` palette) | rgb(11, 13, 12) | rgb(236, 240, 236) |

*Table 1. What the `'dark'` string drew, beside the real ids.*

## 3. The seven files in the dark palette (measured)

Each file was run alone, through `ccrc test --local`, in the foreground, with the box's existing Chrome. Nothing was
installed. Counts are the file's cases, light and dark together. The first run had the step-1 edit, with a local
stamped-theme helper in each file. The final head's runs are in section 6.

| file | what it measures | cases | result in step 1 |
|---|---|---|---|
| abandon-sheet | the sheet's fit, sideways scroll | 24 | 24 passed |
| archive-claims-sheet | the sheet's fit, sideways scroll | 32 | 32 passed |
| digest-widths | the Out of step section's fit, sideways scroll | 24 | 24 passed |
| programme-page | the page's fit, sideways scroll | 20 | 20 passed |
| run-tally | the tally's and commits' fit, sideways scroll | 40 | 40 passed |
| runs-widths | the board's rows, columns, cards, Advanced, the Stuck band; sideways scroll; the 44px foot link on a phone | 231 | 231 passed |
| landing-line | the landing block's 44px tap floor; the block's, the card's and the page's sideways scroll | 80 | 80 passed |

*Table 2. The seven files with the dark palette by its real id.*

**No case is red in the dark palette only.** None of the seven measures a contrast ratio. Contrast for these screens'
inks is the contrast gate's job (`pwa/design/contrast-check.mjs` over the generated palettes), as several other browser
files' headers already say. landing-line belongs to the landing programme. It was changed in this wave on that
programme coordinator's yes, and only in its theme loop and one stamped-theme assertion. It is green, so it keeps the
fix and the guard carries no exception for it.

The stamped-theme assertion goes red when a file is put back. Measured: programme-page with `['light', 'dark']` gave
10 failed and 10 passed, each failing with `stamped theme for dark: expected 'light' to be 'dark'`.

## 4. The guard (measured)

**Property:** every theme a browser file hands the app is one the app keeps, `resolveTheme(t) === t` (an id of
`@ccrc/ui`'s `THEMES`, or `SYSTEM`). The ids come from `@ccrc/ui`, never from a second list.

**The tree scan** (`pwa/test/browser-theme-ids.test.ts`) parses every TypeScript source under `pwa/browser`,
subdirectories included as the browser leg collects them, with the repository's one parser (`server/test/scan/parse.ts`,
D-8288). What it reads is a closed list of seven shapes (`SHAPES`, after fix round 1):

| shape | what it reads |
|---|---|
| theme property | `{ theme: 'x' }`, through a spread object or a conditional; `{ theme }` or `{ theme: X }` when the name is a `const` holding a literal, declared once in the file (fix round 2) |
| themes list | a list bound to a name or a property matching `/themes\|palettes/i` |
| theme loop | `for (const theme of [...])` |
| tuple loop | `for (const [theme, width] of [[...], ...])`: the cell in theme's position of each row |
| theme argument | a literal in the place of a `theme` parameter of a function declared or bound in the same file |
| mapped list | a literal list whose method's callback binds `theme`, or a tuple holding it, as its first parameter: `[PHOSPHOR, 'light'].flatMap((theme) => …)` |
| each table | `it.each(table)(title, (…, theme, …) => …)`: the cell in theme's parameter position of each row, or the row itself for a first parameter |

*Table 3. The shapes the scan reads.*

**Anything else is unread, and is the opener's to refuse** (fix round 2, review 4025, the coordinator's ruling). A static
scan cannot list everything it does not read, so the header names what the scan reads, as the closed list above, and
gives the unread shapes as examples, not as a complete list. Each example has its own read-nothing pin:
- a string built by concatenation, or a template with a substitution;
- a value or a list imported from another module;
- a call, or an element or member read;
- the default value of a `theme` parameter. This is live today in phone-bar's file: its `open` defaults `theme` to
  `'light'`, and three of its calls leave the argument out;
- the right side of a `??` or `||` fallback;
- a `let` or a `var`, reassigned or not;
- a name declared more than once in the file;
- a tagged-template each table;
- a method call (`h.open(skin, 'x')`);
- a callback that binds `theme` as a later parameter (`.reduce((acc, theme) => …)`);
- a list that is not a literal;
- a spread argument list;
- a callback whose parameter has another name (`(t) => ({ theme: t })`).

`openApp` refuses each of these at run time, before any context opens, but that runs only in the merge queue's browser
leg, never in a pull request's fast run.

- **A narrowing, accepted as a trade.** Round 0 read any declaration with a string literal initializer as a file
  constant, `let` and `var` included. Fix round 1 reads only a `const`, so a `let` or a `var`, reassigned or not, is no
  longer read. This narrows the scan. The coordinator accepts it as a trade: a reassigned binding judged by its first
  value gives false reds and false passes both.
- **A name declared more than once is not resolved** (fix round 2, review 4025 F1). File constants are one map by name
  with no scopes. Before this round, two same-named bindings judged one against the other's value. Measured by review
  4025: two functions each with its own `const theme`, `'dark'` and `'light'`, passed silently; an outer constant
  shadowed by an inner one, and a file constant beside a parameter of the same name, each went red on a value the app
  never received. Now a name declared more than once, as a variable, a parameter, a function or a class, anywhere in
  the file, reads nothing. A name declared once still resolves, before or after its use. No real file's count moved:
  the scan reads 151 literals in 104 of 142 files on the head and 152 in 105 of 143 on the merge with `main`, the
  same as before this round.
- **Counting the mapped list.** Round 1's "20 sites in 19 files" was a count by a search of call sites. The scan's
  mapped-list shape finds 20 literals in 16 files.

- Exceptions: named files only, each with the GitHub issue that owns its fix, never a pattern. None today. A test
  holds each named exception to a file that still needs one.
- **Floors (fix round 1, review 4015 F5; re-measured in fix round 2).** Measured on the head merged with `main`
  `a45831a795`, the same as on `6df8f8bb63`: **152 literals in 105 of 143 files**. By shape: theme property 60, themes
  list 48, mapped list 20, theme loop 8, theme argument 7, tuple loop 5, each table 4. Each shape's floor is in
  `SHAPE_FLOORS`, 1 each, so a shape the visitor stops reading is red whatever the total is. Its red message says that a
  shape which leaves the tree on purpose lowers its own floor in the same commit, with the reason (fix round 2). The totals' floors are 120 literals and 80 files, about four fifths of the measure, rounded
  down to ten. **Correction:** round 0's note and PR body said 131 literals in 90 files. The 131 was counted over
  `main`'s seven files, whose `'dark'` and `'light'` literals count where the head has the `PHOSPHOR` identifier. The
  head itself had 122 literals in 90 files, as review 4015 measured.
- Red first: against `main`'s seven files the scan is red, naming exactly the nine sites. Those are the theme lists or
  loops of all seven, plus runs-widths' two literal opens. It finds no other file.

**The opener's refusal** is pinned by `pwa/test/browser-dist.test.ts` (fix round 1, review 4015 F4). Over a stand-in
browser that counts contexts: `"dark"`, `""` and `"Light"` each throw the refusal's message, naming the theme, with 0
contexts opened; `light`, `PHOSPHOR` and `SYSTEM` each open one.

### Mutants (measured, each applied alone, the suite run, the file restored)

| # | mutant | result |
|---|---|---|
| M1 | abandon-sheet's theme loop back to `'dark'` | killed: `theme loop 'dark'` |
| M2 | archive-claims-sheet's theme loop back to `'dark'` | killed: `theme loop 'dark'` |
| M3 | digest-widths' `MATRIX.themes` back to `'dark'` | killed: `themes list 'dark'` |
| M4 | programme-page's `THEMES` back to `'dark'` | killed: `themes list 'dark'` |
| M5 | run-tally's `THEMES` back to `'dark'` | killed: `themes list 'dark'` |
| M6 | runs-widths' `MATRIX.themes` back to `'dark'` | killed: `themes list 'dark'` |
| M7 | landing-line's theme loop back to `'dark'` | killed: `theme loop 'dark'` |
| M8 | runs-widths' literal open (the Instrument 1920 case) back to `theme: 'dark'` | killed: `theme property 'dark'` |
| M9 | new shape: a bare string argument, `openSheet(360, skin, 'dark', 667)` | killed: `theme argument 'dark'` |
| M10 | new shape: a spread object, `{ ...{ skin, width }, ...{ theme: 'dark' } }` | killed: `theme property 'dark'` |
| M11 | new shape: a file constant, `const DUSK = 'dark'` in the theme list | killed: `themes list 'dark'` |
| M12 | new shape: a spread argument list, `openSheet(...([360, skin, 'dark', 667] as const))` | **survives the scan**, by design: see below |
| G1 to G4 | the guard's own theme property, themes list, theme loop and theme argument branches each disabled | killed: the shape's own case, and the floor |
| G5 | the guard's file-constant resolution removed | killed: the file-constant case |
| G6 | the guard judging by a hand rule in place of `resolveTheme` | killed: the catalogue case |
| R1 | fix round 1: the opener's refusal block removed from `app.ts` | killed: browser-dist, 3 failed (`"dark"`, `""`, `"Light"`) |
| R2 | fix round 1: chat-colour's mapped list `[PHOSPHOR, 'light']` to `'dark'` (review 4015's mutant) | killed: `mapped list 'dark'` |
| R2b | fix round 1: reader-appearance's AP-3 each table, theme column `'phosphor'` to `'dark'` | killed: `each table 'dark'` |
| R3a | fix round 1: abandon-sheet given `const theme = 'dark'`, read by its shorthand `{ skin, theme, width }` (review 4015's mutant) | killed: `theme property 'dark'` |
| R3b | fix round 1: delegation-rows' tuple loop cell `['light', 360]` to `'dark'` | killed: `tuple loop 'dark'` |
| G7 | the mapped-list branch disabled | killed: its case and the per-shape floor |
| G8 | the each-table branch disabled | killed: its case and the per-shape floor |
| G9 | tuple rows disabled | killed: the tuple and mapped-list cases and the per-shape floor |
| G10 | the shorthand branch disabled | killed: the shorthand case |
| G11 | a `let` counted as a file constant | killed: the not-read case (the narrowing above) |
| G12 | the listing not recursive | killed: the subdirectory case (it survived before that case was added: no subdirectory exists today) |
| R2 | fix round 2: the refusal to resolve a name declared more than once removed | killed: the declared-more-than-once case |
| R3a | fix round 2: chat-colour's mapped list to `'dark'`, to read the red message | killed; the line ends `if that list is not themes, rename the callback's parameter, or take the named-file exception route (EXCEPTIONS, with its issue)` |
| R3b | fix round 2: the each-table floor raised past the tree, to read the red message | killed: `each table literals found (if this shape left the tree on purpose, lower its floor in SHAPE_FLOORS in the same commit, with the reason)` |

*Table 4. The mutants and what killed them.*

**What the scan cannot see:** the shapes listed above as not read. The opener's refusal stops those. Measured in round
0: M12 applied to abandon-sheet and run in the browser gave 4 failed and 20 passed, each failing with `openApp: theme
"dark" is not one the app keeps (an id of @ccrc/ui's THEMES, or SYSTEM); the app would draw "system" in its place`.

## 5. Follow-ups (not in this wave, on the coordinator's ruling)

- **browser-theme-scan-carries** (a ticket of its own, the coordinator's ruling on review 4025):
  - reading a `theme` parameter's default value, and the right side of a `??` or `||` fallback;
  - pinning the tree scan's own listing call site, so a flat listing there goes red (review 4025 F6);
  - one stand-in browser in the opener's suite, `browser-dist.test.ts`, in place of the two near copies (F8).

- **One stamped-theme check for every file through the opener.** Measured: 118 browser files open the app through
  `openApp`. 94 of them assert that the page-error list is empty and 24 do not, most of the 24 being reader and docs
  files. A shared check on first load would need either an edit to those 24 (several are held by other runs) or a
  failure path of its own. It is a check on how the app applies a theme on every load, so it is its own wave.
- **The Overlord's browser file** (`overlord-place`, draft #3457). Measured at its head `8cdd2725c4` (read only, no edit):
  it asks for `PALETTES = ['light', PHOSPHOR]`, by the ids the app keeps, and asserts the stamped theme in each case. The
  scan reads that list as a themes list, with both values kept, so it passes as it stands.

## 6. Evidence on the final head

Round 0: every browser file once on the head (base `aba5845760`): 125 of 128 files green, and 3 load-timing reds, each
green alone. Then on a local merge with `fabd9d399d`: the seven files and the two browser files `main` had changed,
522/522. Fix round 1 changes no browser file's cases (only the helper's header comment), so the seven were not re-run.
Its evidence is the two suites above on the head and on the head merged with `main`, the mutants in Table 4, and the pwa
typecheck. Fix round 2 changes only the scan and this note. Its evidence is the same two suites on the head and on a
local merge with `a45831a795`, the counts above, the R2 and R3 rows of Table 4, and the pwa compile check. The PR body and
the wave-done name the runs.

## 7. The judge's size reason

horkos's one blocking reason, `editorial-diff-over-bound`, is about the editorial lane's size, not a defect. The
coordinator ruled that this stays one pull request (neither guard can land before the seven files) and rules on the
reason at landing. Nothing was cut to chase the bound.
