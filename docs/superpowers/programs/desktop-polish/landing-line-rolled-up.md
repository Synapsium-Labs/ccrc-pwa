# Wave 192: the landing line on a project card starts rolled up (run 4073, D-9153)

The task note for desktop polish wave 192, written by its worker for the coordinator to fold into the ledger. The
operator asked, of a 430 px card whose line held six tall rows with a Withdraw button each, for the line to start rolled
up with a short summary of the PRs in it, and to unroll to today's view. The rules of the landing console
(`docs/superpowers/plans/2026-11-26-landing-order-wave5k-console.md`, sections 4.5, 5, 11 and 12, and
`docs/superpowers/plans/2026-11-27-landing-order-wave5m-carried-corrections.md`, sections 4.2, 5 and 6.1) still bind
wherever the brief and its seven additions (mail 39468) did not change them.

## What shipped

- **The disclosure (ruling 1; D-9153).** The block's title is a button, `@ccrc/ui`'s `BareRow` (the card's own Released
  and Archived disclosures use it), carrying the title and a `▸`/`▾` mark hidden from assistive tech, with `aria-expanded` and `aria-controls` naming the open body. A native button, so a tap, Enter and Space all
  work (Enter and Space measured in Chrome by the browser file). Only its tap opens or closes the block.
- **Rolled up (rulings 2 and 3).** In document order: the disclosure, the status sentence (unchanged words, still the
  live region), the stale sentence when the last read failed, and one summary line, for example
  `6 in line: #101, #104, #107 (waiting on a withdrawn entry), #110, #102 (sent back), #109 (set aside)`. Nothing else:
  the pause control, its error, the rows and their Withdraw buttons are not in the document, so they are in neither
  the tab order nor the accessibility tree.
- **Open (ruling 4).** Today's view, unchanged, inside the body the disclosure controls: the pause button (still placed
  on the title row by grid placement, the body drawn with `display: contents`), the alert, the rows. The summary is not
  drawn. The body is in the document only while open (the additions' wrapper condition).
- **The same status and stale elements in both states.** They sit outside the body, so a change is announced once; a
  case holds element identity across a roll-up and an unroll.
- **The summary is no live region (addition 6).** It is outside the status element and carries no live attribute, nor
  does anything around it: a read that changes only the order announces nothing.
- **The words (ruling 2).** Four new entries in `landingWords.ts`, each once: `SUMMARY_COUNT` (`One in line` for one
  entry, `<n> in line` for several), `SUMMARY_WORD` (`waiting on a withdrawn entry`, `sent back`, `set aside`),
  `SUMMARY_ENTRY` (`#<pr>` or `#<pr> (<word>)`) and `SUMMARY_MORE` (`and <n> more`). `landingLineView.ts` chooses the
  word by the row's role (the head and an entry plainly in line carry none), cuts the list after
  `LANDING_SUMMARY_NAMED` = 12 and composes the line into `LandingLineCard.summary` (`null` exactly when there is no
  row: a pause on an empty line). The component draws the string. No existing sentence or its speaker moved.
- **The choice's home (ruling 5).** `foldState.ts` owns it: a module-scope set of opened projects with
  `toggleLandingLineOpen`, `useLandingLineOpen` (a `useSyncExternalStore` reader) and `resetLandingLineOpen` (for
  tests). Legitimately different from the two stores beside it in one respect, by the same ruling: it is kept in
  memory, never in the browser, so a reload starts rolled up. Module scope, not a component's state, is what lets it
  outlive what unmounts: a re-read, the card folding, Instrument's switch to Status and back, and the block going and
  coming back on a later read. Two readers: `LandingLine` and `FleetCards`' view-hold key.
- **The view hold (ruling 7).** `landingLineHoldPart(state, open)`. Open, its part is today's byte for byte: the row
  count, the status letter, `s` while stale. Rolled up, it holds what that block's height depends on: `c`, then how
  many entries the summary names (`0` when it draws none, at most 12), `+` when it says how many more, then the same
  status letter and `s`. Like the open form (R8), it holds no wrapped text: a changed short word, an ejection's reason
  or a different `by` list keeps the key; so does a line growing past thirteen entries, whose summary only changes
  digits. `FleetCards` passes `landingLineOpen.has(project)` and its memo depends on the set.
- **Focus (ruling 6 and addition 3).** The fallbacks keep their order with the disclosure added after the pause button:
  after Done the pause button, else the disclosure, else the card; after Cancel the row's Withdraw first, then the same;
  a read that removes the focused control, as after Done. The focus effect also runs when the block opens or closes,
  still only when focus has fallen to the page and the block holds a record. So a tap that does not focus the
  disclosure (an engine that focuses no button on a click) and rolls up from a row's Withdraw or from the pause button
  puts focus on the disclosure; no record, or focus elsewhere on the page, moves nothing (addition 2's two halves kept).
  An earlier build of this wave moved focus in the tap handler before rolling up; it was replaced by the effect, one
  mechanism, when addition 3 arrived.
- **Not touched (ruling 8 and "what must not move").** The rows' design, the sheet, the doors, the read, the hook, the
  server, every wire field, `fleet.css`, `ui/` and `ProjectCard.tsx`. `landing-line.css` gains the body, the
  disclosure's flex row and the summary's ink beside its ground (`--ink-secondary` on `--bg-surface`, tokens only; the
  contrast gate passes).

## D-9153

Issued by the coordinator (mail 39468) and defined in `docs/superpowers/plans/2026-10-22-desktop-polish.md`, "Deviations
found", after D-9141, on the head commit with its `Ledger-Edit` trailer: the block starts rolled up behind a disclosure
button on its title row, a second control there beside the pause button, where the console plan's sections 5 and 11
had one. The source comments in `LandingLine.tsx` and `landing-line.css` name it.

## Existing assertions changed, and why

- `pwa/test/landing-line.test.tsx` (29 cases, main's count since #3477): every case that draws a block renders through
  `renderOpen`, which is `render` plus the one added tap on the disclosure; a `beforeEach` resets the module's choice.
  No assertion was dropped or loosened. One assertion's reading changed: the pinned document order (section 12, B4).
  It held that the region's direct children are title, status, stale, pause, alert, rows. It holds the same order with
  the pause button, the alert and the rows read through the open body, which draws no box (`display: contents`); the
  title is now the disclosure button carrying it (addition 5). The rolled-up order (disclosure, status, stale, summary)
  is pinned by a new case.
- `pwa/test/landing-line-hold.test.tsx`: the case that reads `~5r`, `~5rs`, `~5p` taps project-a's disclosure once
  first, so its parts are the open block's, unchanged.
- `pwa/test/landing-line-view.test.ts`: the hold-part cases pass `open: true`; every expected value is unchanged.
- `pwa/browser/landing-line.browser.test.ts`: each of the four families taps the disclosure once (`unroll`) before
  reading the open block. The terminal family's block comes back on a later read still open, and that case now also
  asserts it (no second tap).

## The cases added

- `pwa/test/landing-line-rolled-up.test.tsx`, new: rolled up on first draw (a native button, `aria-expanded` false,
  `aria-controls` naming a body absent until open and present in the region with the pause button and the list once
  open); no pause control, error, list or Withdraw in the tree, the disclosure the only Tab stop; the rolled-up order;
  the summary as no live region; the summary for one, six and thirteen entries; the three short words; status and
  stale the same elements in both states; paused, held and main-red lines rolled up; a pause on an empty line (rolled
  up the paused sentence, open `Resume line`); a re-read, a status change and a failed read leave it rolled up; a pause
  refusal kept across a roll-up; the focus cases of ruling 6 and addition 3; the sheet kept when the block is rolled up
  under it.
- `pwa/test/landing-line-hold.test.tsx`: the rolled-up part (`c5r`) and a tap moving it to `5r` and back; a change
  nobody sees rolled up keeps the key; the choice kept across a re-read, the card folding and unfolding, and the block
  going and coming back; kept when the cards unmount and mount again.
- `pwa/test/landing-line-view.test.ts`: the rolled-up hold part (letters, `c0p`, `c12`, `c12+`, a role change keeping
  it) and the summary (one, six, thirteen and twenty entries, section 5's line, a paused line, none for an empty one).
- `pwa/test/landing-words.test.ts`: the four new entries pinned byte for byte.
- `pwa/test/foldState.test.ts`: rolled up until toggled, per project; the choice outlives the hook that read it; a
  toggle writes nothing to local or session storage; a reload (the module evaluated afresh) starts rolled up.
- `pwa/browser/landing-line.browser.test.ts`, a fifth family at every width, skin and theme: every block rolled up on
  first draw with the disclosure its only control; the three summaries; each at the tap floor, inside the card, not
  running sideways, no page scroll, thirteen entries wrapping to two or more lines at 360 and 390; Chrome's own
  accessibility tree over CDP, rolled up (the disclosure and the status, no pause, list or Withdraw) and open (the
  disclosure, the pause button, five Withdraws, one list of five items under the region, through the contents box);
  Enter opens and Space closes with focus kept on the disclosure; kept open across a re-read; Instrument's Status and
  back; a reload rolls every block up.

## Mutation rows

Each row replaced one string in one file, ran the named suites through `ccrc test --local`, and restored the file; the
diff of the tree was byte-identical before and after the whole run. A driver in the session's scratch did it, one mutant
at a time. Every row went red, each in the case named for its rule (count of red cases in brackets).

| Row | Mutation | Red |
|---|---|---|
| R1-open-by-default | the block starts open | 27 |
| R1-no-aria-expanded | no `aria-expanded` | 9 |
| R1-no-aria-controls | no `aria-controls` | 1 |
| R1-opened-by-a-failed-read | a stale read opens it | 3 |
| W-body-present-rolled-up | the body (pause, rows) drawn rolled up | 13 |
| R4-summary-drawn-open | the summary drawn open too | 1 |
| R4-status-remounted-per-state | the status keyed by the state | 1 |
| R4-stale-remounted-per-state | the stale sentence keyed by the state | 1 |
| R6-summary-a-live-region | `aria-live` on the summary | 1 |
| R6-summary-inside-status | the summary inside the status element | 5 |
| R2-no-waits-word, -ejected-, -unknown- | one short word dropped | 3 each |
| R2-cut-at-thirteen | the cut at 13 | 3 |
| R2-order-reversed | the list reversed | 10 |
| R2-count-of-named-only | the count of the named entries only | 2 |
| R2-no-more-tail | no `and <n> more` | 2 |
| R2-one-said-as-number | `1 in line` | 2 |
| R7-rolled-part-is-open-part | the rolled-up part is the open part | 4 |
| R7-rolled-part-uncapped | the named count not capped | 1 |
| R7-fleet-key-ignores-open | `FleetCards` passes open always | 1 |
| R7-fleet-key-memo-stale | the set left out of the memo | 2 |
| R5-stored-in-the-browser | the set also written to local storage | 1 |
| R5-forgotten-when-the-cards-unmount | the set cleared when its last reader goes | 2 |
| R5-forgotten-when-the-block-goes | rolled up when the state is `none` | 1 |
| R5-forgotten-on-a-re-read | rolled up on a new state | 2 |
| R6-done-without-disclosure | Done's chain without the disclosure | 1 |
| R6-cancel-without-disclosure | Cancel's chain without the disclosure | 1 |
| R6-cancel-disclosure-before-row | the disclosure before the row on Cancel | 5 |
| R6-read-removal-without-disclosure | the effect's chain without the disclosure | 2 |
| R6-effect-not-run-on-open-or-close | `open` left out of the effect | 2 |
| R6-no-record-moves-focus | the early return for no record removed | 2 |
| R6-focus-elsewhere-moved | the "focus fell to the page" check removed | 2 |

The landing programme's four rows (addition 4), measured again on this tip with the existing cases opened first, each
as wave 5m measured it:

- **X-door** (the sheet's confirm returns before its door, `|| true` on its guard): 11 red, the same eleven: both
  unmount cases, the only-entry withdrawal, the terminal entry, the refusal followed by an empty read, both Done cases,
  the one-re-read-per-answer case, Cancel in flight, Escape in flight, and the sheet opened again.
- **FR8** (the wrapper's generation check removed): 2 red, both unmount cases.
- **NOREC** (the section's `onFocus` record removed): 4 red: Cancel in flight, Resume on a line with no entries then an
  empty read, the blur to nowhere, and the control case.
- **M-noheld** (no early return without a record): 1 red, the fix round's case; R6-no-record-moves-focus is the same
  mutation, read by both files (2 red).

Restored sha256 at the measured tip, each equal to the committed bytes:
`LandingLine.tsx` a4921080d637fa9cf1d1982d48694925e68255cf99798fdccc47f952e84ba21a (after the full suite's fix; every row
re-measured there with the same counts),
`LandingWithdrawSheet.tsx` 858910ec7141c30383f5927e9c266c7a194258d6496dd7556e3c6ede2a329a03,
`landingLineView.ts` db524f938cade87780b8b808b59d58894e0a507526ed5954cc8db630f67294d4,
`landingWords.ts` 4f4178325449e3f39094a116ea02b7f2bda71e6849febd9ebcc108617b53a2fb,
`foldState.ts` 6d95e867b2850359dfcbc0a439dd9e8bb6ec282443f87375db53853027e5af4b,
`FleetCards.tsx` 76ecee9479ede39d79152f996266c03fc20d4bf93f054a4393e2a248365d6aba.

## Tests that read a changed file as text, run alone

Searched `server/test` and `pwa/test` for every test naming a changed file. Each was run alone with
`ccrc test --local`:

<!-- id:text-readers -->
Each alone, with `ccrc test --local`, on this branch with the D-9153 entry in place:

- `server/test/fleet-health.test.ts` (names `FleetCards`): 57 passed.
- `server/test/delegation-wave3.integration.test.ts` (names `FleetCards`): 36 passed.
- `server/test/deviation-refs.test.ts` (reads the desktop-polish plan, D-9153 included): 35 passed.
- `server/test/drawer-mask-screen.test.ts` (names the desktop-polish plan): 13 passed.
- `server/test/watcher-quiet-census.test.ts` (names the desktop-polish plan): 4 passed.
- In `pwa/test`, the files naming a changed file (`contrast`, `w7-storage-keys`, `fleet-screen`, `fleet-screen-frame`,
  `strip-expanded`, `project-card`, `programme-box`, `programme-box-card`, `useBoxClock`, `overlord-readiness-line`,
  `landing-withdraw-sheet` and the landing files) ran in the full pwa suite, which a pull request runs whole for a
  `pwa/src` change.

The full pwa suite, the wave's first full run after the build: red, 3 failed of 22230 (`control-census`,
`design-system-boundary`, `ui-package-boundary`): the disclosure was a plain `<button>` wearing `BARE_ROW`'s classes, which
two guards refuse (a hand-drawn control; a class constant without its primitive). Fixed by drawing `BareRow` itself and
finding it through the block for focus; every mutation row re-measured on the fix with the same counts. Second full run:
660 files, 22228 passed, 2 skipped, no type errors.

## The browser files on this head merged with main

<!-- id:browser-run -->
Every file under `pwa/browser` (133 files) on this branch's head merged with `origin/main` (7d2c9aecb3) in a scratch tree (merge c7344a6155, never pushed), with `ccrc test --local` and Chromium from the local cache (no browser install). Files ran one at a time (`--no-file-parallelism --maxWorkers=1`), in nine runs of 10 to 25 files, each run building the PWA once. After the full pwa suite found the disclosure hand-drawn (below), the fix commit was merged into the same scratch tree (merge bc4eda4240) and the landing file run again. No other browser file draws a landing block: the shared fixture answers no landing read (F4), so the fix changes nothing they draw.

- `abandon-sheet.browser.test.ts`: 24/24, passed.
- `account-knob.browser.test.ts`: 16/16, passed.
- `account-pool-unavailable.browser.test.ts`: 16/16, passed.
- `accounts-cards.browser.test.ts`: 24/24, passed.
- `accounts-open.browser.test.ts`: 16/16, passed.
- `accounts-openrouter-card.browser.test.ts`: 16/16, passed.
- `add-project-sheet.browser.test.ts`: 7/7, passed.
- `archive-claims-sheet.browser.test.ts`: 32/32, passed.
- `archive-unowned.browser.test.ts`: 60/60, passed.
- `ask-inline.browser.test.ts`: 512/512, passed.
- `ask-surface.browser.test.ts`: 42/42, passed.
- `auth-resume.browser.test.ts`: 16/16, passed.
- `backup-banner.browser.test.ts`: 84/84, passed.
- `browser-tools-card.browser.test.ts`: 8/8, passed.
- `build-behind.browser.test.ts`: 12/12, passed.
- `calls-made.browser.test.ts`: 12/12, passed.
- `caps-dial.browser.test.ts`: 4/4, passed.
- `chat-colour.browser.test.ts`: 16/16, passed.
- `chat-foot.browser.test.ts`: 22/22, passed.
- `chat-history.browser.test.ts`: 46/46, passed.
- `chat-links.browser.test.ts`: 14/14, passed.
- `chat-width.browser.test.ts`: 46/46, passed.
- `chatgpt-sheet.browser.test.ts`: 32/32, passed.
- `compaction-fold.browser.test.ts`: 16/16, passed.
- `confirm-focus.browser.test.ts`: 16/16, passed.
- `connect-sheet.browser.test.ts`: 20/20, passed.
- `content-focus-ring.browser.test.tsx`: 32/32, passed.
- `delegation-adopt-card.browser.test.ts`: 36/36, passed.
- `delegation-rows.browser.test.ts`: 76/76, passed.
- `digest-widths.browser.test.ts`: 24/24, passed.
- `disk-banner.browser.test.ts`: 32/32, passed.
- `docs-compact-head.browser.test.ts`: 157/157, passed.
- `docs-export.browser.test.ts`: 18/18, passed.
- `docs-headers.browser.test.ts`: 13/13, passed.
- `docs-mockup-export.browser.test.ts`: 20/20, passed.
- `docs-mockup.browser.test.ts`: 23/23, passed.
- `docs-own-tab.browser.test.ts`: 12/12, passed.
- `docs-review.browser.test.ts`: 12/12, passed.
- `drawer-prompt-glyph.browser.test.ts`: 16/16, passed.
- `epic-page.browser.test.ts`: 5/5, passed.
- `fleet-reconnecting.browser.test.ts`: 8/8, passed.
- `fleet-toggle-row.browser.test.ts`: 8/8, passed.
- `frame-cost.browser.test.ts`: 52/53 in its run: red once on `a fleet frame of 80 rows on / costs under the ceiling (refined, 1920)`, `window-overrun: window 1 spanned 3241 ms, past 2000 ms + 1000 ms` (load average 7 to 8: the measuring window overran, not the cost); run again alone on the same tree, 53/53, passed.
- `goals-door-height.browser.test.ts`: 30/30, passed.
- `helpers-rail.browser.test.ts`: 4/4, passed.
- `home-root.browser.test.ts`: 6/6, passed.
- `inspector-hide.browser.test.ts`: 8/8, passed.
- `instrument-bar.browser.test.ts`: 57/57, passed.
- `instrument-desk.browser.test.ts`: 33/33, passed.
- `instrument-fab.browser.test.ts`: 6/6, passed.
- `instrument-group-seen.browser.test.ts`: 8/8, passed.
- `item-nav.browser.test.ts`: 54/54, passed.
- `item-wrap.browser.test.ts`: 16/16, passed.
- `landing-line.browser.test.ts`: 100/100, passed; again on the second merge (the fix round's head), 100/100, passed.
- `lanes-row.browser.test.ts`: 89/89, passed.
- `lazy-screens.browser.test.tsx`: 17/17, passed.
- `limit-wait-row.browser.test.ts`: 78/78, passed.
- `linear-items.browser.test.ts`: 168/168, passed.
- `linear-workspaces.browser.test.ts`: 16/16, passed.
- `mail-rows.browser.test.ts`: 26/26, passed.
- `mockup-parse.browser.test.ts`: 71/71, passed.
- `model-sheet-labels.browser.test.ts`: 16/16, passed.
- `models-sheet-anthropic.browser.test.ts`: 3/3, passed.
- `models-sheet.browser.test.ts`: 8/8, passed.
- `move-sessions.browser.test.ts`: 24/24, passed.
- `name-field.browser.test.tsx`: 22/22, passed.
- `one-waiting-page.browser.test.ts`: 12/12, passed.
- `overlord-place.browser.test.ts`: 128/128, passed.
- `overrides-in-force.browser.test.ts`: 25/25, passed.
- `page-head-focus.browser.test.ts`: 16/16, passed.
- `palette-search.browser.test.ts`: 12/12, passed.
- `pane-scope-stop-card.browser.test.ts`: 8/8, passed.
- `paste-chips.browser.test.ts`: 33/33, passed.
- `pdf-frame.browser.test.ts`: 11/11, passed.
- `pdf-labs.browser.test.ts`: 12/12, passed.
- `phone-bar.browser.test.ts`: 58/58, passed.
- `programme-box.browser.test.ts`: 60/60, passed.
- `programme-page.browser.test.ts`: 20/20, passed.
- `programme-work-page.browser.test.ts`: 24/24, passed.
- `project-linking-card-wide.browser.test.ts`: 10/10, passed.
- `project-linking-card.browser.test.ts`: 12/12, passed.
- `reader-appearance.browser.test.ts`: 28/28, passed.
- `reader-frame.browser.test.ts`: 61/61, passed.
- `reader-history.browser.test.ts`: 12/12, passed.
- `reader-lab.browser.test.ts`: 1/1, passed.
- `reader-mode-head.browser.test.ts`: 2/2, passed.
- `reader-mode-lab.browser.test.ts`: 4/4, passed.
- `reader-mode.browser.test.ts`: 24/24, passed.
- `reader-places.browser.test.ts`: 10/10, passed.
- `reauth-sheet.browser.test.ts`: 20/20, passed.
- `refined-bar.browser.test.ts`: 29/29, passed.
- `refined-phone.browser.test.ts`: 53/53, passed.
- `refusal-copy.browser.test.ts`: 16/16, passed.
- `remove-sheet.browser.test.ts`: 16/16, passed.
- `review-cap-coord.browser.test.ts`: 12/12, passed.
- `role-fact.browser.test.ts`: 66/66, passed.
- `roll-idle-card.browser.test.ts`: 3/3, passed.
- `row-fit.browser.test.ts`: 133/133, passed.
- `run-tally.browser.test.ts`: 40/40, passed.
- `runs-widths.browser.test.ts`: 231/231, passed.
- `scope-sweep-card.browser.test.ts`: 8/8, passed.
- `session-header.browser.test.ts`: 76/76, passed.
- `session-panel-words.browser.test.ts`: 22/22, passed.
- `session-timers.browser.test.ts`: 17/17, passed.
- `settings-diagnostics.browser.test.ts`: 4/4, passed.
- `settings-integrations.browser.test.ts`: 5/5, passed.
- `shadow-lanes-card.browser.test.ts`: 16/16, passed.
- `sheet-desktop-arm.browser.test.tsx`: 40/40, passed.
- `sheet-focus-ring.browser.test.tsx`: 32/32, passed.
- `sheet-footer.browser.test.tsx`: 36/36, passed.
- `sheet-stack-hide.browser.test.ts`: 10/10, passed.
- `sign-in-sheet.browser.test.ts`: 16/16, passed.
- `single-readers.browser.test.ts`: 32/32, passed.
- `skin-default.browser.test.ts`: 8/8, passed.
- `stall-watch-held.browser.test.ts`: 9/9, passed.
- `testbox-builds.browser.test.ts`: 3/3, passed.
- `testbox-card.browser.test.ts`: 9/9, passed.
- `testbox-connect.browser.test.ts`: 20/20, passed.
- `testbox-manage.browser.test.ts`: 60/60, passed.
- `tool-activity.browser.test.ts`: 48/48, passed.
- `tool-group-fit.browser.test.ts`: 16/16, passed.
- `tool-well-colour.browser.test.ts`: 16/16, passed.
- `transcript-work-card.browser.test.ts`: 32/32, passed.
- `update-indicator.browser.test.ts`: 36/36, passed.
- `update-sweep-line.browser.test.ts`: 7/7, passed.
- `vaul-motion.browser.test.tsx`: 80/80, passed.
- `waiting-close-run.browser.test.ts`: 18/18, passed.
- `waiting-controls.browser.test.ts`: 134/134, passed.
- `waiting-doors.browser.test.ts`: 28/28, passed.
- `waiting.browser.test.ts`: 202/202, passed.
- `wheel-chain-chip.browser.test.ts`: 16/16, passed.
- `wheel-chain-well.browser.test.ts`: 8/8, passed.
- `wheel-chain.browser.test.ts`: 40/40, passed.

## Pictures

Under `docs/design/2026-10-22-desktop-polish/landing-line-rolled-up/`, every fixture invented (projects `project-a` to
`project-d`, lane `lane-a`, PRs 101 to 402): `before-<skin>-<theme>-<width>.png` on main's build (7d2c9aecb3), and
`after-rolled-up-…` and `after-open-…` on this branch, for Refined and Instrument, light and phosphor, 390 and 1440
wide. Each shows four cards: six entries with each kind of word, thirteen entries, one entry, and a line paused by the
operator. The phone's tab bar and the New button were hidden for the picture only.

## Probes

- `git merge-tree` of this head against `origin/main` (7d2c9aecb3): clean, exit 0; nothing absorbed.
- Against #3281's head (0eeaaa092b): exit 1 on `pwa/src/fleet/fleetTree.ts`, which this branch does not touch; main
  itself conflicts with that head on the same file. This branch does not edit `ProjectCard.tsx`.

## Not claimed

- Enter, Space and the accessibility tree are measured in Chrome only; this suite drives no other engine, and WebKit
  has dropped roles under a `display: contents` box before.
- The disclosure keeps the title's ground, so it shows no hover lift (the card's own fold button shows none either).
- The rolled-up hold key does not follow wrapped text, as R8 ruled for the rows.
