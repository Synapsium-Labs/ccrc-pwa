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
