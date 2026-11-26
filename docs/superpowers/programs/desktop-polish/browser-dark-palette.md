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
  first, and was applied as the packet showed after their yes.

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

**The tree scan** (`pwa/test/browser-theme-ids.test.ts`) parses every `pwa/browser/*.ts{,x}` with the repository's one
parser (`server/test/scan/parse.ts`, D-8288). It collects each string literal that reaches the app as a theme, in four
shapes: a `theme` property in an object literal, spread objects included; an array bound to a name or a property
matching `/themes|palettes/i`; the array of a `for (const theme of [...])`; and a string argument in the place of a
`theme` parameter of a function declared or bound in the same file. A `theme` value that is a file constant
(`const DUSK = 'dark'`) is resolved to its literal, and both arms of a conditional are read.

- Exceptions: named files only, each with the GitHub issue that owns its fix, never a pattern. None today. A test
  holds each named exception to a file that still needs one.
- Non-vacuity floor: at least 120 theme literals across at least 80 files. Measured on this tree: 131 literals in 90
  of the 142 files.
- Red first: against `main`'s seven files it is red, naming exactly the nine sites. Those are the theme lists or loops
  of all seven, plus runs-widths' two literal opens. It finds no other file.

### Mutants (measured, each applied alone, the guard run, the file restored)

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

*Table 3. The mutants and what killed them.*

**What the scan cannot see:** a spread argument list (M12), a value imported from another module, or a value built at
run time. The opener's refusal stops those. Measured: M12 applied to abandon-sheet and run in the browser gave 4 failed
and 20 passed, each failing with `openApp: theme "dark" is not one the app keeps (an id of @ccrc/ui's THEMES, or
SYSTEM); the app would draw "system" in its place`.

## 5. Follow-ups (not in this wave, on the coordinator's ruling)

- **One stamped-theme check for every file through the opener.** Measured: 118 browser files open the app through
  `openApp`. 94 of them assert that the page-error list is empty and 24 do not, most of the 24 being reader and docs
  files. A shared check on first load would need either an edit to those 24 (several are held by other runs) or a
  failure path of its own. It is a check on how the app applies a theme on every load, so it is its own wave.
- **The Overlord's browser file** (`overlord-place`, draft #3457) still asked for `'dark'` at that PR's tip when this
  wave was built. Its holder is fixing it in their own fix round. If that file reaches `main` unfixed, the tree scan
  and the opener's refusal both go red on it, which is what they are for. This wave does not edit it.

## 6. Evidence on the final head

The opener changes, so every browser file is measured once on the final head merged with current `main`. The run and
its per-file counts are in the wave-done mail and the PR body. The hermetic pwa suite, the pwa typecheck and the guard
are named there too.
