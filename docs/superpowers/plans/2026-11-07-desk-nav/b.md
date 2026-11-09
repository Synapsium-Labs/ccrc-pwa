# Desk-nav Task B: the desk Docs head (D-8101), task note

This note records how Task B was built against today's `main`, ahead of the library take-up wave, by the wave-107 brief
of 2026-11-08, fix round 1's rulings on review 1691 and fix round 2's on review 1697. It names each departure from the plan's Task B by slug, for the
coordinator to fold into the plan's Deviations found. D-8101 is the only number cited.

## In short

At 600 px and wider, in both skins, the Docs head is one row (back, the crumbs, then GitHub, Share, Export and Open
committed version, each an icon beside its words) over one dense truth line, in the common case. Fix round 1's ruling is
that readable wins where compact and readable conflict, so the head grows where its content needs room. Fix round 2
set the order in which the row gives way when room runs short: the action words hide first (icons only, names kept),
then the middle crumbs fold behind `…`, then the page's name shortens to its floor, and only then do the actions wrap
onto a second line. No drawn crumb is ever clipped. The truth line wraps rather than hide a fact.

At 1280 x 800 under a mouse, a committed leaf on the default ref still has a 76 px head, from its top to the bottom of
the truth line, and its title is at y = 310 in Instrument and 306 in Refined (378 in Refined at the base). Under a
coarse pointer every control keeps the 44 px floor. Below 600 px nothing changes: the compact leaf head, and the stacked
head a listing draws there, both equal the base to the pixel. The two draft caveat banners show only when the tree has
a draft. A modified draft at 1280 now shows the page's whole name (265.2 px) on one row, its actions as icons.

## Departures

| Slug | What departs from the plan, and why |
|---|---|
| `b-before-take-up` | Built before #2346's take-up wave, per the brief. There is no merge wait, and Step 1 is dropped: `readerChromeFor`, `ReaderBarContext`, `oneBarTools` and `docs-tool` do not exist on `main`. `headLayoutFor` keeps its two arguments and today's answers, and the reader frame keeps its own bar. The Interfaces bullet "reader tools in the desk row", Step 5's `reader-frame.browser.test.ts` rows and mutants 1 and 2 are dropped too. `DESK_TITLE_MAX` is this tree's figure, not the plan's 200 (below). What the take-up must re-anchor is listed below. |
| `caveats-follow-drafts` | `caveat-hash` and `caveat-filters` (`DocsBanners.tsx`) show only whenever the tree has a draft (`n > 0`, the tree's own draft count, the one the hint banners use). Both describe how drafts are read, so with no draft they say nothing a reader can act on. With a draft they show as before, words unchanged. |
| `full-head-scoped` | Every new rule in `docs.css` is scoped to `.docs-full`, a class the desk head carries, not to `.docs-head` and `.docs-truth` as the plan's CSS block reads. The compact head's Page details panel draws the same `TruthLine` and `.docs-actions`, and an unscoped rule would move it (its open-panel figure equals the base). No rule keys on a viewport width: mutant 7 (a desk rule under `@media (min-width: 600px)`) is red in `docs-desk-css` "no rule keys on a viewport width" only, since `docs-compact-css` pins only the max-width blocks. |
| `docs-line-h-follows-tap-min` | `--docs-line-h` is `var(--tap-min)` in `:root`, not a literal `44px`, so it follows the tap token as every other floor does. The dense `28px` is inside a new `@media (pointer: fine)` block in `tokens.css`, as the plan says. Nothing else under `ui/src` or `pwa/src` defines it (pinned). |
| `full-head-names-in-pins` | Existing pins read the full head's actions by their visible words or their old waiting name: `docs-screen.test.tsx`'s two M4.SH8 cases and its Share describe's `updatingTo`, and `docs-compact-head.test.tsx`'s "the full header keeps its line of actions". They now read each action's name: `aria-label`, else its text, and "Share: Updating to …" for a waiting Share (F4). The order and the actions they pin are unchanged. The plan said `docs-compact-head.test.tsx` would stay green with no edit; this one case pins the full head at 600 px and wider, not the compact head. |
| `phone-listings-keep-main` | Was `phone-listings-take-the-row`, reverted by fix round 1's ruling (F2(b)). Below 600 px a listing (a project, a section, a directory) or the index draws the stacked head as `main` draws it: the crumbs row, the truth line, then the actions in words. `fullHeadFormFor(compactWidth)` decides which (`row` at 600 px and wider, `stacked` below). The phone figure equals the base: 224.5 px at 412, pinned in the browser file. |
| `note-gives-way` | GitHub's may-differ note in the row is a marker (`≠`). Its words are its `title`, a screen reader's text inside it, and the GitHub link's accessible description (`aria-describedby`), as fix round 1 ruled (F1). It takes no room from the crumbs and never shrinks. In the words form (the stacked head and the compact panel) the note is drawn as before. |
| `crumb-floor-beside-separator` | The crumbs have a real floor (F1; fix round 2, item 2): every crumb drawn, at a tap beside its `/`, plus one more character for the page's own. `Crumbs` sets `--docs-crumbs-n` to the number it draws, the `…` button counted, and the floor built from it is their flex basis, so the row breaks a line before the crumbs would go under it. No drawn crumb is ever clipped: swept from 900 to 1480 px, in both skins and under both pointers, every drawn crumb is at least 44 px wide and wholly inside the crumbs. Each desk crumb is a tap wide even when its words are shorter ("Docs" was 39.2 px). On a shared line the crumbs grow into the room the actions leave, up to their whole words. Inside them a middle crumb gives way first, down to one tap beside its `/`, and the page's own crumb last, down to a tap and one more character. When the page's name is still not whole with the action words hidden, the middle crumbs fold behind `…` at any width, as below 900 px they always did. The list is still end-justified, so only a row narrower than the floor itself, which no width of 600 px or more has, could clip; what it clipped would be the earliest crumbs, never the page's name. Every crumb carries its whole name in its `title`. |
| `actions-wrap-not-clip` | When the row is short it gives way in the order fix round 2 ruled: (1) the action words hide, each icon keeping its name and `title`; (2) the middle crumbs fold behind `…`; (3) the page's name shortens to its floor; (4) only then do the actions wrap onto a second line, at its end. Steps 1 and 2 are `HeadRow`'s, in `DocsHead.tsx`. A ResizeObserver on the row (its width), a MutationObserver on the row outside the crumbs (an action's words, a navigation, the tree arriving) and the document's font loads each re-measure from step 0. Each try renders synchronously (`flushSync`) from the observer's callback, so a stage that does not fit is never painted. The row keeps the first stage that shows the page's whole name, every drawn crumb inside the crumbs and the actions on the crumbs' line. Starting from 0 every time makes the stage a function of width and contents alone. Steps 3 and 4 are docs.css's flex rules. "Whole" is measured to the subpixel: the name's text against its box (a Range), since a name cut by a fraction of a pixel still draws its ellipsis while the integer `scrollWidth` and `clientWidth` agree (found by this round's own screenshot of the draft at 1280). The middle crumbs' flex-shrink is a hundred thousand times the page's, so the name's share of a shortfall stays under the engine's 1/64 px layout unit, and the name gives way only once the middle crumbs cannot. On the modified draft, swept from 900 to 1480 px in 20 px steps, a wider window never shows less of the name. The one place a narrower window shows more is where the actions wrap: GitHub's refusal, a sentence that wraps to its own line rather than be cut to nothing, wraps between 900 and 1100 px (Instrument; 1080 in Refined), and the name then has the first line. Wider than a line of their own, the actions wrap among themselves (no measured state needs it). GitHub's refusal is cut there with an ellipsis, its whole sentence in its `title`. A disabled Share or Export is dimmed to 0.35, as the compact bar's is. Only an action drawn as an icon beside its words drops the link underline. Open committed version takes the icon form (`file-text`, no new icon vendored), named as before. |
| `truth-line-wraps` | The plan's line is one line with the via sentence giving way. Fix round 1 ruled (F2) that it hides no fact. It is one dense line when its facts fit, and wraps onto a second line when they do not. It clips nothing. Only the via sentence gives way, to an ellipsis, from a small basis (`12ch`) up to its whole words, which its `title` carries. Every other part keeps its whole words and is never wider than the line; one longer than a line, such as a failed chip's sentence, wraps inside itself. |
| `copy-commit-margin` | In a flex line a whitespace-only text run is not rendered, so the space between the commit and copy commit was lost. The dense line gives copy commit `margin-inline-start: 1ch`, one mono space. The ` · ` separators keep their spaces through `white-space: pre`. |
| `row-one-line-by-centres` | Step 5's "share one box top ±1" is measured as one vertical centre ±1: back and the actions are a tap tall, and the page's own crumb is a line of text centred in the row, so their tops differ by design. |
| `query-width-from-the-common-case` | The container query still hides the words below a 530 px row: back (44), the folded crumbs at the floor this wave first measured (about 164) and the widest common actions (GitHub, Share and "Export (plain view)", 313), with the row's gaps. Since fix round 2 it is a backstop: `HeadRow` hides the words whenever the page's whole name does not fit with them, at any width, so between about 530 and 552 px the actions no longer wrap with their words showing. No leaf at 600 px or wider has a row under 530 in either skin, so the browser checks the query on a head narrowed by hand. |
| `truth-line-ring-default` | Round 0 drew the truth line's focus ring inside its controls (`.docs-full > .docs-truth :focus-visible { outline-offset: -2px }`, pinned in `docs-desk-css`), because the line clipped. Fix round 1 made the line wrap and clip nothing (F2), so that rule and its pin were removed, and the line's controls draw the default ring outside their boxes. The row keeps its inset ring, because the crumbs still clip. |
| `main-thread-execution` | The plan names subagent-driven development. The task is one tight set of files in one context, so it was built test-first in the worker's main thread, with no subagents. |

## Measured

### Figures (`PHH-FIGURE`, `docs-compact-head.browser.test.ts`)

The base is `main` at `435773d66`. Instrument at 1280 is not among the base's lines: the base file measured Refined only
at the desk. The spec measured Instrument at 382. "Round 0" is the first wave-done tip, `a53cf89e2`.

| View | Base: px above the title | Round 0 | This tree | This tree: head height |
|---|---|---|---|---|
| 412 x 915 Refined (compact) | 125 (frame at 48) | 125 | 125 (frame at 48) | — |
| 412 x 915 Instrument (compact) | 125 (frame at 48) | 125 | 125 (frame at 48) | — |
| 599 x 915 Refined (compact) | 125 | 125 | 125 | — |
| 412 x 915 Refined, Page details open | 402.5 (frame at 325.5) | 402.5 | 402.5 | — |
| 412 x 915 Refined, a listing (stacked) | head 224.5 | head changed (`phone-listings-take-the-row`) | head 224.5 | 224.5 |
| 600 x 960 Refined, touch | 289 | 189 | 233 | 136 (the line wraps) |
| 600 x 960 Refined, mouse | — | 173 | 201 | 104 (the line wraps) |
| 768 x 1024 Refined, touch | 313 | 213 | 213 | 92 |
| 1280 x 800 Refined, mouse | 378 | 306 | 306 | 76 |
| 1280 x 800 Instrument, mouse | 382 (the spec's measure) | 310 | 310 | 76 |
| 1280 x 800 Refined, touch | — | 322 | 322 | 92 |
| 915 x 412 Refined, touch | 398 | 298 | 342 | 136 (the line wraps) |

**Why the line wraps at 600 (fix round 2, item 3).** The via sentence keeps its `12ch` basis. At about 600 px a
committed leaf's facts fit one line only if the via shrinks to nothing: review 1697 measured it 6.2 px wide there (3.0
for a draft at 768), a bare cut with no room for the 7.2 px ellipsis, and no basis that leaves an ellipsis keeps one
line at those two points. The coordinator ruled that a legible fragment of the via with an ellipsis, plus a second line,
wins over one line that hides it silently. So the 600 px rows above take a second dense line (head 104 under a mouse,
136 under touch), as does 915 x 412 under touch; review 1697 measured the same for a draft at 768. No code changed for
this.

`DESK_TITLE_MAX` stays 320 (fix round 1's ruling, F9), the next 10 px step above this tree's 310. The frame's own bar
still puts the title 101 px into the frame at a desk. A touch laptop's title measures 322 at 1280 x 800, which the
brief asserts for a mouse only.

### Fix round 1's states

- **Wide actions, F1** (fine pointer, 600, 768 and 1280, both skins). A modified draft shows the note marker and Open
  committed version; a local ref ahead of origin shows the marker alone; a GitHub refusal shows its sentence. In every
  case the page's name is visible and at least 44 px wide (least: 56.7, the refusal at 1280), and every action lies
  inside the head. At fix round 1's tip the row took a second line where the actions needed it: the draft at 600 and
  768, and the refusal at 600 and 768, with a third line at 600. Since fix round 2 the draft and the ref ahead of origin
  are one row at every width, the draft's actions as icons. The draft's name is 261.7 px at 600 and whole (265.2) at 768
  and 1280; the ahead ref's is whole everywhere. The refusal takes a second line at 600 only: its name is whole there,
  61.7 px at 768, and 233.7 in Instrument and 253.7 in Refined at 1280.
- **Long truth lines, F2** (the same views). A failed fetch, a diverged branch and a dangling origin/HEAD each keep
  every fact inside the head, the line's `scrollWidth` equal to its `clientWidth`, and no part but the via sentence cut.
  The line takes two dense lines (56 to 57.5 px), and three for the diverged branch at 600 (74 px). At 1280 a dangling
  HEAD fits one line (28 px) in both skins, as measured at fix round 2's tip; review 1697 measured two in both skins at
  fix round 1's tip.

## What the take-up wave must re-anchor

- **The full head's markup.** `DocsHead`'s desk return is `header.docs-head.docs-full` holding `.docs-head-bar` (BackButton,
  Crumbs, then `Actions form="row"`), then the `TruthLine`, then the plain-view note and "Updated to". Below 600 px,
  `fullHeadFormFor` draws the stacked head instead. The take-up's host bar draws its tools in the row, before
  `.docs-actions`.
- **`headLayoutFor`.** Its third argument and its `one-bar` answer start from today's two-argument form, whose answers are
  unchanged.
- **`readerChromeFor` at every width, and the `DocsScreen` slot** that reads it: Step 1's host bar, not built here.
- **The frame bar's tool list** (Step 0), which decides the row's reader tools: not taken.
- **The `reader-frame.browser.test.ts` desk rows** (Step 5) and **mutants 1 and 2** (Step 6): dropped here, owed there.
- **W5b (#2350)**, which restyles `TruthLine`. The dense line's rules key on its child classes `.docs-truth-via`,
  `-relation`, `-source` and `-ref`, plus `-dangling`, `.docs-fresh` and `.docs-copy`. A renamed or regrouped part
  silently drops out of the wrap and ellipsis rules, so `docs-desk-css.test.ts` and the browser's long-line cases are
  the ones to re-read.
- **The desk figure.** At 1280 x 800 the base for the take-up is this tree's 310 (Instrument) and 306 (Refined), and the
  head's 76 px. A touch laptop's title measures 322 there. The take-up then removes the frame's own bar (101 px into the
  frame) and lowers `DESK_TITLE_MAX`.
- **The container query's width.** If the row gains reader tools, 530 is re-measured with them.
- **`HeadRow`'s measure.** `rowFits` reads the page's crumb, the crumbs' items and `.docs-actions` in the row. Reader
  tools drawn in the row change what fits, so the take-up re-reads it, and the order's browser sweeps, with them.

## Mutants

Each mutant was applied to a saved copy and restored from it, with its sha checked. Mutant 7's red is in
`docs-desk-css` only: `docs-compact-css` pins only the max-width blocks, so it stays green.

### Round 0

| # | Mutant | Red in |
|---|---|---|
| 3 | `Actions` moved back under the truth line | `docs-desk-head` "a leaf's head is one row" (and eight more of its cases); browser "the row is one line" (both skins) |
| 4 | the 28px value moved out of the `pointer: fine` block (into `:root`) | `tap-targets` "--docs-line-h is --tap-min in :root and below it only inside @media (pointer: fine)"; browser "a touch laptop keeps the floor" (both views) |
| 5 | `.docs-full .docs-crumbs` given `flex: none` | `docs-desk-css` "the crumbs have a real floor: the crumbs drawn at a tap each is their basis …"; browser, re-measured at fix round 2: 16 cases, among them "at 600 the action words give way first", the 600 px full-head cases and every fix round 1 wide state at 600 |
| 6 | the GitHub link's `aria-label` set to the short word | `docs-desk-head` "GitHub shows GitHub and is named View on GitHub", and "a leaf's head is one row" |
| 7 | a desk rule written under `@media (min-width: 600px)` | `docs-desk-css` "no rule keys on a viewport width" only |
| 8 | the `n > 0` guard dropped from both caveats | `docs-banners` "a holder with both caveats and no draft in the tree (n = 0) shows no caveat banner" |
| 9 | the container query removed | `docs-desk-css` "the action words hide when the row asks … and under the docs-head container query, nowhere else" (its name since fix round 2); browser "a row narrower than the container query hides the action words" |
| 10 | the chip's and copy commit's `--docs-line-h` rule removed | `docs-desk-css` "the truth line is one line at --docs-line-h"; browser "the row is one line" (the line grows past 28) |

Mutants 1 and 2 belong to the dropped Step 1 (`b-before-take-up`).

### Fix round 1

| Id | Mutant | Red in |
|---|---|---|
| F1a | the crumbs' basis back to `0` | `docs-desk-css` "the crumbs have a real floor". Browser, as review 1697 measured at fix round 1's tip: the modified draft at 600 and the refusal at 768, both skins (the draft at 768 stayed green). Re-measured at fix round 2: eight cases, the refusal at 600 (both skins), the refusal's crumb sweeps (both skins, both pointers) and the 460 px unfold case (both skins) |
| F1b | the crumbs' `justify-content: flex-end` removed | `docs-desk-css` "the crumbs are one line … clipped at the start" |
| F1c | the note drawn in words in the row | `docs-desk-head` "GitHub's may-differ note is a marker" (both states) |
| F1d | the actions' `flex-wrap: wrap` back to `nowrap` | `docs-desk-css` "the actions sit at the row's end". The browser half survives: in every settled state the actions fit a line of their own or the refusal shrinks first. The rule is for a transient "Updating to …" Export, which no fixture holds still. |
| F2a | the truth line's `flex-wrap: wrap` removed | `docs-desk-css` "the truth line is one line … wraps". Browser, 22 cases, both skins, as review 1697 measured and re-measured at fix round 2: the failed fetch and the diverged branch at 600, 768 and 1280, the dangling origin/HEAD at 600 and 768, the ref ahead of origin at 600 and 768, and the modified draft at 600 |
| F2b | the chip's `white-space: normal` back to `pre` | `docs-desk-css` "every fact keeps its place"; browser "a failed fetch" at 600 (both skins) |
| F2v | the via sentence's `title` removed | `docs-desk-head` "the via sentence … carries its whole words in its title" |
| F2c | `fullHeadFormFor` always `row` | `docs-desk-head` "below 600 px a project / a section / a directory draws the head as main draws it"; browser "a listing below 600 px" |
| F3a | the row's disabled fade removed | `docs-desk-css` "a disabled Share or Export in the row is dimmed" |
| F3r | the fade's `OPACITY_REGISTRY` entry renamed away | `contrast` "the gate command" (an unregistered fade) |
| F3b | the underline dropped on every row action | `docs-desk-css` "only an action drawn as an icon beside its words drops the underline" |
| F4 | Share's row name back to its bare words while waiting | `docs-desk-head` "while the leaf moves to its pin, Share is named Share: <words>" |
| F5a | a middle crumb's `title` removed | `docs-desk-head` "every crumb that can shorten carries its whole name in its title" |
| F5b | the refusal's ellipsis rule removed | `docs-desk-css` "GitHub's refusal in the row shortens with an ellipsis" |
| F5c | the refusal's `title` removed | `docs-desk-head` "GitHub's refusal in the row carries its whole words in its title" |
| X4 | the last crumb's `title` removed | `docs-desk-head` "every crumb that can shorten carries its whole name in its title" |
| X2 | `.docs-full .docs-actions > * { flex: none }` removed | `docs-desk-css` "the actions sit at the row's end" |
| NT | the note's `title` removed | `docs-desk-head` "GitHub's may-differ note is a marker" (both states) |
| NG | the note's `flex: none` changed to shrink | `docs-desk-css` "GitHub's may-differ note in the row is a marker: it never shrinks" |
| X1 | a per-skin `--docs-line-h: 28px` in `skins.css` | `tap-targets` "is defined only in tokens.css, those two times" |

### Fix round 2

| Id | Mutant | Red in |
|---|---|---|
| M1a | `HeadRow` never leaves stage 0 (the words always shown) | `docs-desk-head` "the name is whole only as icons: the words hide first"; browser, nine cases: the draft at 1280, 600 and 768, its sweep (both skins) and "at 600 the action words give way first" |
| M1b | the `[data-words='off']` rule removed | `docs-desk-css` "the action words hide when the row asks …"; browser, the same nine cases as M1a |
| R2b | the crumbs' basis back to a fixed three | `docs-desk-css` "the crumbs have a real floor"; browser "a modified draft, its head 460 px wide … `…` unfolds every crumb" (both skins). The sweeps stay green: there the crumbs drawn are three whenever they are tight |
| M2b | a desk crumb's `min-width` back to `0` | `docs-desk-css` "the crumbs are one line …"; browser, every crumb sweep and unfold case ("Docs" is 39.2 px) |
| M2c | the fold switched off (`fold={false}`) | `docs-desk-head` "the name is whole only with the crumbs folded" and "the name is never whole"; browser, the 460 px unfold case only (no `…` to tap). In the sweeps the row wraps instead, and no crumb is clipped |
| X1b | an inline-style `--docs-line-h` on the truth line (review 1697's) | `tap-targets` "is defined only in tokens.css … no skin, sheet or inline style …" (green, 90/90, before F9(a)) |
| X1c | the same through `style.setProperty` | the same case |
| F2vb | the via's class renamed | `docs-desk-head` "the via sentence … carries its whole words in its title" (green before F9(b)) |
| S1 | the middle crumbs' flex-shrink back to a thousand | browser "the modified draft at 1280 … the page's whole name shows" (both skins: the name cut by a fraction, the crumbs fold) |
| S2 | `rowFits` without the text-against-box measure | `docs-desk-head` "a name cut by a fraction of a pixel is not whole". The browser cases stay green: with S1's factor in place no fixture cuts the name by a fraction |

M1a to M2c were measured at their own item's commit (9c381a5be, 9a652c2bb), X1b to F2vb at 4749a8105, and S1 and S2 at
92a707f87.

## Fix round 1: rulings and commits

The coordinator's mail of 2026-11-08 ruled on review 1691 (run 1691 read `a53cf89e2`). Where compact and readable
conflict, readable wins. One commit per numbered item:

1. **F1**: the crumbs never go to nothing (a94db1460).
2. **F2**: the truth line hides no fact, and phone listings keep main's head (aaf2e8922).
3. **F3**: a waiting row action is dimmed, and text-only actions keep the underline (0d456838e).
4. **F4**: a waiting Share in the row is named "Share: <words>" (719177ec2).
5. **F5**: crumbs and GitHub's refusal keep their whole words in `title` (deda96a67).
6. **F6**: the pins the extra mutants showed missing (7032930fd).
7. **F7**: this record, and `DocsBanners`' comment, now "whenever the tree has a draft" (b92f44095).
8. **F8 and F9**: `DESK_TITLE_MAX` stays 320. The PR body's browser count is corrected. The screenshots are PNGs in the
   worker's clips, listed in the wave-done, not attached to the PR.

The fix round's new fixtures did not satisfy pwa's types (a relation's counterpart was incomplete), so one more commit
completes them, with no assertion changed (d881392f8). The commits before it may fail the type check one by one; the
PR is squash-merged.

## Fix round 2: rulings and commits

The coordinator's mail of 2026-11-09 ruled on review 1697 (run 1697 read `d881392f8`). This was the last fix round. The
governing rule is unchanged, and the ruling added the order in which the row gives way: the action words, then the
middle crumbs, then the page's name, then a second line. One commit per numbered item:

1. **F4 and F3**: the action words give way first, at any width (9c381a5be), and the page's name is whole to the
   subpixel before the row stops giving way (92a707f87, found by this round's screenshot; a second commit for item 1).
2. **F1**: no drawn crumb is clipped, at any width; the middle crumbs fold first (9a652c2bb).
3. **F2**: the via keeps its `12ch` basis; the cause of the second line at 600 is recorded (20f935fc6).
4. **F6**: the PR body lists the departures as they stand after this round (patched over REST, no commit).
5. **F7**: this record (this commit).
6. **F8**: the stale comments in docs.css and `docs-desk-css.test.ts` (9080302c2).
7. **F9 (a) and (b)**: the inline-style definition caught, and the via asked to exist (4749a8105).

The coordinator carries F5 (a touch user cannot read the may-differ marker's words) as `touch-marker-words`, and F9 (d)
(the control census's class for `.docs-fresh` and `.docs-copy`). F9 (e) needs nothing: the PR is squash-merged.
