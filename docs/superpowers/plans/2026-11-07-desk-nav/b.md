# Desk-nav Task B: the desk Docs head (D-8101), task note

This note records how Task B was built against today's `main`, ahead of the library take-up wave, by the wave-107 brief
of 2026-11-08. It names each departure from the plan's Task B by slug, for the coordinator to fold into the plan's
Deviations found. D-8101 is the only number cited.

## In short

At 600 px and wider, in both skins, the Docs head is now one row (back, the crumbs, then GitHub, Share and Export,
each an icon beside its words) over one dense truth line. At 1280 x 800 under a mouse the head is 76 px from its top
to the bottom of the truth line, and a document's title is at y = 310 in Instrument and 306 in Refined (378 in Refined
at the base). Under a coarse pointer every control keeps the 44 px floor. The compact head below 600 px is unchanged,
and its figures equal the base to the pixel. The two draft caveat banners show only while a draft is in view.

## Departures

| Slug | What departs from the plan, and why |
|---|---|
| `b-before-take-up` | Built before #2346's take-up wave, per the brief. There is no merge wait, and Step 1 is dropped: `readerChromeFor`, `ReaderBarContext`, `oneBarTools` and `docs-tool` do not exist on `main`. `headLayoutFor` keeps its two arguments and today's answers, and the reader frame keeps its own bar. The Interfaces bullet "reader tools in the desk row", Step 5's `reader-frame.browser.test.ts` rows and mutants 1 and 2 are dropped too. `DESK_TITLE_MAX` is this tree's figure, not the plan's 200 (below). |
| `caveats-follow-drafts` | `caveat-hash` and `caveat-filters` (`DocsBanners.tsx`) show only when a draft is in view (`n > 0`, the count the hint banners use). Both describe how drafts are read, so on a page with no draft they say nothing a reader can act on. With a draft in view they show as before, words unchanged. |
| `full-head-scoped` | Every new rule in `docs.css` is scoped to `.docs-full`, a class the full head now carries, not to `.docs-head` and `.docs-truth` as the plan's CSS block reads. The compact head's Page details panel draws the same `TruthLine` and `.docs-actions`, and an unscoped rule would move it (its open-panel figure is pinned to the base below). |
| `docs-line-h-follows-tap-min` | `--docs-line-h` is `var(--tap-min)` in `:root`, not a literal `44px`, so it follows the tap token as every other floor does. The dense `28px` is inside a new `@media (pointer: fine)` block in `tokens.css`, as the plan says. |
| `full-head-names-in-pins` | Two existing pins read the full head's actions by their visible words: `docs-screen.test.tsx`'s two M4.SH8 cases and `docs-compact-head.test.tsx`'s "the full header keeps its line of actions". They now read each action's name (`aria-label`, else its text), because the row shows "GitHub" and names the link "View on GitHub". The order and the names they pin are unchanged. The plan said `docs-compact-head.test.tsx` would stay green with no edit; this one case pins the full head at 600 px and wider, not the compact head. |
| `phone-listings-take-the-row` | A listing (a project, a section, a directory) keeps the full head at every width, so on a phone it now draws the row and the dense line too. No rule keys on a viewport width, and the brief forbids one. There the row is narrower than the container query (396 px at 412), so the action words hide and each action keeps its icon and its name. |
| `note-gives-way` | GitHub's "may differ" note stays in the row. It is the one part of the actions that gives way (cut with an ellipsis, its full words in its `title`), so `.docs-actions` is `flex: 0 1 auto`, not `flex: none`. Each action inside it is `flex: none`. |
| `crumb-floor-beside-separator` | A middle crumb gives way down to one tap beside its `/` (`min-width: calc(var(--tap-min) + 1ch + var(--sp-1))`), not to `--tap-min` alone. With the bare tap as the floor, a four-letter crumb such as a project name was cut to two letters at 1280. The last crumb, the page itself, gives way last and keeps its whole name in its `title`. |
| `copy-commit-margin` | In a flex line a whitespace-only text run is not rendered, so the space between the commit and copy commit was lost. The dense line gives copy commit `margin-inline-start: 1ch`, one mono space. The ` · ` separators keep their spaces through `white-space: pre`. |
| `row-one-line-by-centres` | Step 5's "share one box top ±1" is measured as one vertical centre ±1: back and the actions are a tap tall, and the page's own crumb is a line of text centred in the row, so their tops differ by design. |
| `main-thread-execution` | The plan names subagent-driven development. The task is one tight set of files in one context, so it was built test-first in the worker's main thread, with no subagents. |

## Measured

### The container query's width

Measured in Chrome at 600 and 1280, in both skins and under both pointers. Back is 44 and the row has two 4 px gaps. The
folded crumbs at their floor (the `…` button and two crumbs at a tap and a separator each) are about 164. The widest
actions with their words (GitHub, Share and "Export (plain view)") are 313 at every width. That comes to about 529, so the
words hide below 530 (`@container docs-head (width < 530px)`). A leaf at 600 has a 584 px row.

### Figures (`PHH-FIGURE`, `docs-compact-head.browser.test.ts`)

The base is `main` at `435773d66`. Instrument at 1280 is not among the base's lines: the base file measured Refined
only at the desk. The spec measured Instrument at 382.

| View | Base: px above the title | This tree: px above the title | This tree: head height |
|---|---|---|---|
| 412 x 915 Refined (compact) | 125 (frame at 48) | 125 (frame at 48) | — |
| 412 x 915 Instrument (compact) | 125 (frame at 48) | 125 (frame at 48) | — |
| 599 x 915 Refined (compact) | 125 | 125 | — |
| 412 x 915 Refined, Page details open | 402.5 (frame at 325.5) | 402.5 (frame at 325.5) | — |
| 600 x 960 Refined, touch | 289 | 189 | 92 |
| 600 x 960 Refined, mouse | — | 173 | 76 |
| 768 x 1024 Refined, touch | 313 | 213 | 92 |
| 1280 x 800 Refined, mouse | 378 | 306 | 76 |
| 1280 x 800 Instrument, mouse | 382 (the spec's measure) | 310 | 76 |
| 1280 x 800 Refined, touch | — | 322 | 92 |
| 915 x 412 Refined, touch | 398 | 298 | 92 |

`DESK_TITLE_MAX` is 320, the next 10 px step above this tree's 310 (Instrument, the larger of the two skins). The
frame's own bar still puts the title 101 px into the frame at a desk. The head's own height under a mouse at 1280 is
76 px (row 44, gap 4, line 28), under the brief's 80.

## What the take-up wave must re-anchor

- **The full head's markup.** `DocsHead`'s full return is now `header.docs-head.docs-full` holding `.docs-head-bar`
  (BackButton, Crumbs, Actions with `row` forms), then the `TruthLine`, then the plain-view note and "Updated to". The
  take-up's host bar draws its tools in that row, before `.docs-actions`, and `headLayoutFor`'s third argument starts
  from today's two-argument form.
- **The desk figure.** At 1280 x 800 the base for the take-up is this tree's 310 (Instrument) and 306 (Refined), and the
  head's 76 px; the take-up then removes the frame's own bar (101 px into the frame) and lowers `DESK_TITLE_MAX`.
- **The container query's width.** If the row gains reader tools, 530 is re-measured with them.

## Mutants

Each mutant was applied to a saved copy and restored from it, with its sha checked. Every one went red.

| # | Mutant | Red in |
|---|---|---|
| 3 | `Actions` moved back under the truth line | `docs-desk-head` "a leaf's head is one row" (and eight more of its cases); browser "the row is one line" (both skins) |
| 4 | the 28px value moved out of the `pointer: fine` block (into `:root`) | `tap-targets` "--docs-line-h is --tap-min in :root and below it only inside @media (pointer: fine)"; browser "a touch laptop keeps the floor" (both views) |
| 5 | `.docs-full .docs-crumbs` given `flex: none` | `docs-desk-css` "the crumbs take the room the actions leave"; browser "at 600 the crumbs give way first" |
| 6 | the GitHub link's `aria-label` set to the short word | `docs-desk-head` "GitHub shows GitHub and is named View on GitHub", and "a leaf's head is one row" |
| 7 | a desk rule written under `@media (min-width: 600px)` | `docs-desk-css` "no rule keys on a viewport width". Not `docs-compact-css`: that file pins only the max-width blocks. |
| 8 | the `n > 0` guard dropped from both caveats | `docs-banners` "a holder with both caveats and no draft in view (n = 0) shows no caveat banner" |
| 9 | the container query removed | `docs-desk-css` "the action words hide only under the docs-head container query"; browser "a row narrower than the container query hides the action words" |
| 10 | the chip's and copy commit's `--docs-line-h` rule removed | `docs-desk-css` "the truth line is one line at --docs-line-h"; browser "the row is one line" (the line grows past 28) |

Mutants 1 and 2 belong to Step 1, which is dropped (`b-before-take-up`).
