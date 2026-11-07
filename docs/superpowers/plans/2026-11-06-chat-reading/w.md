# Task W: the desk width (D-8059), task note

What the ledger should learn from Task W of `docs/superpowers/plans/2026-11-06-chat-reading.md`. The coordinator folds this
note into the ledger. Departures are named by slug only; this note allocates no number.

## Step 0: measured on main (`6954765b6`)

Chrome (Playwright's Chromium) over the production build, Phosphor & Ink, the harness `tool-well-colour.browser.test.ts`
uses, through `browser/chat-width.browser.test.ts` with `CCRC_SHOTS` set. "Pane" is the content width of `.chat-item`'s
parent; "column" is `.chat-item`'s width; the paragraph is a 900-word paragraph in `.msg-assist`.

| View | Pane | Column, before | Paragraph, before | Column, after | Paragraph, after |
|---|---|---|---|---|---|
| Refined 1280 | 960 | 780 | 716 | 960 | 755.8 |
| Refined 1600, inspector rail | 880 | 820 | 716 | 880 | 755.8 |
| Refined 1600, rail hidden | 1200 | 820 | 716 | 1200 | 755.8 |
| Refined 2560 | 1840 | 820 | 716 | 1200 | 755.8 |
| Refined 390 | 390 | 390 | 358 | 390 | 358 |
| Instrument 1280 | 888 | 860 | 716 | 888 | 856 (the column binds) |
| Instrument 1600 | 1128 | 860 | 716 | 1128 | 875.2 |
| Instrument 2560 | 2088 | 860 | 716 | 2088 | 875.2 |
| Instrument 390 | 390 | 390 | 358 | 390 | 358 |

Geist's `ch` at the prose size is **9.938 px** in both skins (0.6625 em at 15 px), so 72ch is 716 px, 76ch is 755.8 px and
88ch is 875.2 px.

## Departures, by slug

- **`w-ch-footing-wider-than-estimated`.** Spec §2.1 estimated `ch` at about 0.6 em, with Instrument's prose at 14 px:
  76ch "about 680 px" and 88ch "about 740 px". Measured: `ch` is 0.6625 em, and the chat prose is 15 px in Instrument as
  well (`.msg-assist` reads `--fs-base`, not `--fs-prose`, in both skins), so 76ch is 755.8 px and 88ch is 875.2 px. The
  plan's ch values ship as written; whether Instrument's measure should come down (about 79ch would give the spec's
  740 px) is a design call for the operator, not this task.
- **`w-two-browser-files-pinned-the-old-column`.** Two browser files outside the plan's file list pinned the old column:
  `inspector-hide.browser.test.ts` (820 in Refined at 1600 and 1920) and `instrument-desk.browser.test.ts` (860 in
  Instrument at 1600). They now read 1200 and the whole detail pane (1128). Claimed (3680) before the edit; nobody held them.
- **`w-wider-card-broke-three-fixture-premises`.** The whole browser suite's first run on this change found three
  fixtures whose premises held only in the old narrow column: `ask-inline.browser.test.ts`'s two-line question fitted on
  one line in Instrument's 1920 card (now about 1390 px of text), and its eighty-line question no longer asked for 40% of
  a 1440 pane; `wheel.ts`'s 150-word answer chip no longer passed `--well-max` at 1920. The question is now 259
  characters (two lines from the narrowest card, Instrument's 1280 at about 830 px of text, to Instrument's 1920 one),
  the long question 160 lines, and the chip
  400 words. The assertions are unchanged. Claimed (3685, 3686) before the edit.
- **`w-session-header-900-red-on-main-here`.** `session-header.browser.test.ts`'s "Instrument's interim header … at 900
  no taller than the accepted growth" is red on this box (200.8 px against 188, both palettes) with main's four source
  files put back, so it is not this change; most likely this box's Chromium against CI's Chrome. Left alone, reported.
- **`w-reading-column-case-walks-the-block`.** `refined-session.test.tsx`'s existing reading-column case matched a ≥900
  block holding exactly one rule; with the prose rule and the bubble beside the column rule it no longer matched. It now
  walks every rule of the block, with the same assertions.
- **`w-mutant4-layout-equivalent-in-chrome`.** Mutant 4 (the column's `min(var(--measure-chat), 100%)` dropped to
  `var(--measure-chat)`) reds `refined-session.test.tsx` but not the browser's "no horizontal page scroll": the column
  rule also sets `width: 100%`, and a `max-width` only caps, so the column stays inside the pane and the layout is
  identical. No browser case can tell the two apart; the scrape is the guard for it.
- **`w-ask-in-the-fixture-hides-the-transcript-in-pictures`.** With the inline ask up, the transcript is near its floor in
  a 900-tall window, so the test takes a second picture per view with the ask put away after measuring
  (`chat-width-<view>-transcript.png`). The measures are taken with the ask up.

## Mutants (Step 4)

Each applied, the named files run, restored from a saved copy, sha checked.

| # | Mutant | Red |
|---|---|---|
| 1 | the ≥1600 `--measure-chat: 820px` put back | `chat-width.test.ts` "no width block re-declares --measure-chat"; browser "the column is the cap or the pane" and "code, tables and the composer take the full column" (Refined 1600 both, 2560) |
| 2 | the chat prose rule deleted | `chat-width.test.ts` "at ≥900, .chat-item .msg-assist's prose children …"; browser "prose is held …" (all seven desk views) |
| 3 | `--measure-chat-prose` removed from `SKIN_TOKENS` | `chat-width.test.ts` "SKIN_TOKENS.density names …"; `skin-identity.test.ts` "holds on the tree" and "reds a palette token planted inside one of Instrument's @media blocks" |
| 4 | the column's `min(…, 100%)` dropped | `refined-session.test.tsx` "the transcript's column reads min(var(--measure-chat), 100%)"; browser green (layout-equivalent, above) |
| 5 | the prose rule's media query removed | browser "390 is unchanged" (both skins); `chat-width.test.ts` and `refined-session.test.tsx`'s prose-rule cases |

## Fix round 1 (review 1578)

What changed, by the coordinator's rulings:

- **F2.** The user's bubble at 900 and up is `max-width: min(70%, var(--measure-chat-prose))`, so a user turn is never
  wider than the reply beside it. Pinned in the browser: the bubble is at most the paragraph's width in every desk view,
  and sits at `min(70% of the column, the prose measure)`; the scrape pins the new value. The spec amendment is the
  coordinator's to record.
- **F9.** `.msg-attach` takes the same cap at 900 and up. The browser test's user turn carries a document clip with a
  long name, so the attachment grid reaches its cap; it is never wider than the bubble and shares its right edge.
- **F3.** The measure resolves once, on `.msg-assist`: `@property --chat-prose-cap { syntax: '<length>'; inherits: true;
  initial-value: 0px }` in chat.css, set by `.chat-item .msg-assist { --chat-prose-cap: var(--measure-chat-prose) }` and
  read by the prose children's cap. **The scrape is updated, not kept:** it now names the registered property (its
  `@property` rule, its `<length>` syntax, `inherits: true`), the one rule that sets it from `var(--measure-chat-prose)`,
  and the children reading `var(--chat-prose-cap)`. In the browser, the h1's and h2's max-width equal the paragraph's in
  both skins (before: Refined 1038.2 / 882.4 px against 755.8; Instrument 1202.1 / 1021.8 against 875.2). prose.css and
  the Docs reader's `--measure-prose` are untouched.
- **F8.** At 390, both skins, the bubble is 85% of the column (browser).
- **F7, F11.** Comments corrected: ask-inline's 1600-with-rail case now exercises the `100%` arm; its two-line question's
  narrowest card is Instrument's 1280 (about 830 px of text); instrument.css's reading column is the whole detail pane;
  refined-session's header names its new case; ui/README.md names `--measure-chat-prose`.
- **F10.** The repeated `toHaveLength(10)` is gone; `proseMeasureList()` still throws unless prose.css has its one
  measure rule.

Departure, by slug:

- **`w-f3-census-entry-for-the-registered-length`.** `.chat-item .msg-assist { --chat-prose-cap: … }` sets a custom
  property on a ui-owned class, which `ui-package-boundary.test.ts`'s appearance census counts as a reach-in (it exempts
  layout properties only). The rule carries no colour, border or type, and it cannot move to prose.css, which the Docs
  reader shares, so it is recorded in the census with that reason (claimed, 3704). Found by the whole pwa suite's first
  run of this round; tests only, inside the ruling's bounds.

Mutants, re-run on this round's tree (each restored from a saved copy, sha checked):

| # | Mutant | Red |
|---|---|---|
| 1 | ≥1600 `--measure-chat: 820px` put back | scrape "no width block …"; browser column and full-column cases (Refined 1600 both, 2560) |
| 2 | the chat prose rule deleted | scrape prose-children case; refined-session prose case; browser "prose is held" (7 views), "headings share" (7), bubble (4) |
| 3 | `--measure-chat-prose` out of `SKIN_TOKENS` | scrape "SKIN_TOKENS.density …"; skin-identity's two cases |
| 4 | the column's `min(…, 100%)` dropped | refined-session column case (browser equivalent, as before) |
| 5 | the prose rules out of the ≥900 block | browser "390 is unchanged" (both skins); scrape prose and registered-length cases; refined-session prose case |
| 6 | the bubble back to `70%` | scrape bubble/attachments case; browser bubble case at Refined 2560, Refined 1600 rail hidden, Instrument 2560 |
| 7 | `.msg-attach` dropped from the cap | scrape bubble/attachments case; browser bubble case (attachments wider than the bubble, 7 views) |
| 8 | `@property --chat-prose-cap` removed | scrape registered-length case; browser "headings share the paragraphs' measure" (7 views) |
| 9 | the base `.msg-user` 85% → 70% | browser "390 is unchanged" (both skins); the scrapes stay green, as ruled (a browser pin) |
