# Desktop polish, carry C: the console carry PR (run 1430, D-7951)

One PR that clears the console review carries the programme ruled out of PL5a, PL5b and the PL9 follow-up: rows 7 to 20 and
38 to 41 of the coordinator's carry list (2026-11-04). The rulings bind where a row and its review report disagree. The
server carries are a sibling PR (part S, run 1428), in disjoint files. This note is what the ledger should learn; the
coordinator folds it.

## Step 0: what main showed at 7b362246a

Every row was re-measured on this branch before any change. None was already fixed on main.

| Row | Review | What main showed | Outcome |
|---|---|---|---|
| 7 | 1379 F1 | `refined-bar.browser.test.ts`'s touch check filters its selection and never counts it | done |
| 8 | 1379 F3 | `refined.css`'s comment reads "6px, not 12" | done (leave 14719) |
| 9 | 1379 F4 | `pl5a.md` defines the room "beyond their 16px gap" for figures taken at 12px | done |
| 10 | 1379 F5 | `.ref-tab` has no `min-width` floor | done (leave 14719) |
| 11 | 1379 F6 | no phone case draws the Waiting badge; the bar test has no 1000px case | done |
| 12 | 1388 F1 | `/programmes/a.b` matches the `programme` row, so `shellViewOf` answers `session` and a phone draws a blank pane | done |
| 13 | 1388 F2 | the Goals comment says the frame is "never older than the one fetch" | done |
| 14 | 1388 F3 | `matchRoute` throws URIError on `/programmes/%zz`, `/s/%zz` and `/settings/%zz` | done |
| 15 | 1388 F4 | the ended-sentence comment cites `pl5b-ended-words-literal` | done |
| 16 | 1388 advisories | `programmeIsOpenable` encodes before it asks the grammar; the plain count has no label; the door's label spells "waiting on you" again | done |
| 17 | 1386 F6 | `useGoalsRead` keeps the old slug's answer across a slug change on one mount | done |
| 18 | 1386 F7 | the chip goes to the lead programme only | no change, as ruled |
| 19 | 1386 F8 | `isGoalsFor` lives in the screen and checks the fetched copy only | done |
| 20 | 1386 F9, F10, F12 | `programmeWaitingCount` answers 0 for "not heard"; `WaitingChip` reads the store; "wave N of M" is spelled in both screens | F9 and F12 done; F10 no change, as ruled |
| 38 | 1408 F1 | `.wl-banners:empty` never matches, so the box keeps its padding with no banner | done |
| 39 | 1408 F2(b) | no test fails when the `shownList` cell is removed in the slug-no-longer-known case | done |
| 40 | 1408 F3 | `positionWords(place, '')` reads "2 of 3, " | done |
| 41 | 1408 F4 | the column sentences lack "once a list has been heard"; `pl9.md` names only Instrument's pool-lag loss | done |

## Rows ruled no change

- **Row 18 (review 1386 F7).** With one coordinator over several programmes, only the lead gets a chip, and a coordinator's
  own question is attributed to its first claimed run's programme. That is the attribution rule of an earlier task (the list
  task's `questionRows`), not this chip's, so nothing changes here.
- **Row 20, F10 (review 1386 F10).** `WaitingChip` reads the global `useFleetStore`. In production this is the same object the
  frame's chrome reads, and the file header says why the chip takes no prop. Nothing changes.

## How the rows were built, and the departures

- **Row 12, `carry-c-route-accepts`.** A route row may carry `accepts(param)`. When it refuses the decoded parameter, the
  row is no match and `matchRoute` reads on, so `/programmes/a.b` is a path outside the table. A phone then shows the fleet,
  and a desk shows the placeholder. The ladder's own `isProgrammeSlug` check is now dead, so it is gone, and the app.tsx
  comment says why. `shell.css` is unchanged: once `shellViewOf` answers `fleet`, the phone swap is right without a rule.
- **Row 14.** A malformed escape in any captured segment makes the whole path unmatched (`null`), as the ruling says, on
  every row that captures. One guard (`decodeParam`).
- **Row 16, `carry-c-plain-count-sr-only`.** The plain count's label is a hidden figure and a spoken one: the capped figure
  is `aria-hidden` and the real count is said in an `sr-only` span. It is not an `aria-label`, because a plain span has no
  role that takes a name. The chip's words are one function over a figure, `waitingChipWords`, with the navigation badge's
  unit (`WAITING_BADGE_UNIT`). It is read for the drawn figure, the spoken one and the door's label.
- **Row 19.** `isGoalsFor` is in `pwa/src/ledgers/waitingView.ts`, beside `isWaitingView`. It is asked of the frame's entry
  and of the fetched answer. An entry it refuses is no copy, so the fetched one is drawn.
- **Row 20, F9.** `programmeWaitingCount` answers `number | null`. Its one caller, the chip, draws nothing for either null
  or zero.
- **Row 20, F12, `carry-c-wave-words-split`.** The work-wave words are `waveOfWords` in `runWords.ts`, and
  `programmeWaveTail` calls them. The programme head and the list's group heading call `waveOfWords` too. They do not call
  `programmeWaveTail`, whose leading ` · ` and review wording neither screen draws. A test pins that the template has one
  holder in `pwa/src`.
- **Row 7, `carry-c-bar-four-doors`.** "Six tabs plus the doors" was measured: the bar holds four doors (the notification
  bell, search, settings and new session). The check counts six tabs and four doors.
- **Row 10.** `.ref-tab` takes `min-width: var(--tap-min)`, under leave 14719 (run 1421's claim 3411, exactly two hunks of
  `refined.css`, rows 8 and 10). The bar test asserts every tab's computed minimum width is at least 44px. Its first version
  compared `< 44`, which `auto` (NaN) never meets, so the floor's mutant survived it. It now asserts `>= 44`.
- **Row 11.** The phone case serves a list of 100 open items (101 with the one asking session) and checks the three badges,
  the Waiting one reading "99+". The 1000px bar case is coverage only: the layout at 1000 fits whichever padding applies, so
  no mutant of the stylesheet turns it red.
- **Row 38.** The box takes the fleet column's room only under Refined's own test, `:has(> .banner-slot > *, > .banner-more)`,
  read from `refined.css` without editing it. The three sentences (the ledgers.css comment, the `ItemListColumn` JSDoc and
  `pl9-banners-keep-the-fleet-gutters` in `pl9.md`) now say the box takes no room with no banner. A browser case at 900 and
  1280 asserts the empty box is 0px tall in Instrument, with the list at the column's top, and that Refined draws no box.
- **Row 39.** The new case (the open item withdrawn, its programme named nowhere) passed before any change, because it pins
  the existing cell. The cell's mutant turns it red.
- **Row 41, `carry-c-list-column-sentence`.** `ListColumn.tsx`'s sentence carries the same false claim review 1408 F4(i)
  names in `FleetColumn.tsx`, so it gains "once a list has been heard" beside the ruled addition. The ruled addition says
  what Refined loses there too: the pool-lag readout and the count line. `pl9.md`'s A-2 sentence names both.
- **Files beyond the brief's list.** `pwa/src/fleet/runWords.ts` (row 20 F12) and `pwa/src/ledgers/waitingView.ts` (row 19),
  under claim 3420. Neither file was held. `pwa/src/styles/shell.css` was not edited (row 12, above).

## Mutants

Each mutant was applied in place, run alone through `ccrc test`, and restored from a saved copy, with sha256 equal before and
after.

| Mutant | Row | Edit | Red cases |
|---|---|---|---|
| M12 | 12 | drop `accepts: isProgrammeSlug` from the programme row | programme-screen "a slug the owner refuses is no route at all"; app "`/programmes/<a name the owner refuses>` is no route" |
| M14 | 14 | `decodeURIComponent` unguarded | programme-screen "a malformed percent escape is no route"; app "every ROUTES row is reached by a probe" |
| M16a | 16 | drop the grammar check before the encode | programme-screen "programmeIsOpenable asks the grammar before it encodes" |
| M16b | 16 | the plain count draws the capped figure alone | programme-box-card "a plain count past the cap says the real count" |
| M16c | 16 | the chip's words spell "waiting on you" | programme-box-card "spells "waiting on you" nowhere in its own source" |
| M17 | 17 | `useGoalsRead` returns its state with no slug check | programme-screen "a new slug on the same mount resets the read" |
| M19 | 19 | the frame's entry drawn unchecked | programme-screen "a frame entry that is not a Goals view is not drawn" |
| M20F9 | 20 | "not heard" answers 0 | ledger-words "is zero for a programme with nothing open, and null until…" |
| M20F12 | 20 | WaitingScreen spells the template itself | programme-screen "the "wave N of M" template is spelled once" |
| M39 | 39 | the column ignores the published list | waiting-routes "the open item gone and its programme no longer known", and the existing F3 case |
| M40 | 40 | `positionWords` always adds ", title" | ledger-words "the position as announced carries the item's title"; waiting-routes "the open item gone with its place kept" |
| M38 | 38 | `.wl-banners` padding ungated | item-nav, Instrument, "at 900" and "at 1280: with no banner to show, the box … takes no room" |
| M10 | 10 | drop `.ref-tab`'s `min-width` | refined-bar, all 10 touch cases ("has no tap floor") |
| M7 | 7 | rename `.ref-tabs` (`ref-tablist`) | refined-bar, all 10 touch cases ("0 tabs measured, not 6") |
| M11 | 11 | the phone's Waiting door counts 0 | refined-phone, all 6 "with the Waiting badge drawn" cases |
