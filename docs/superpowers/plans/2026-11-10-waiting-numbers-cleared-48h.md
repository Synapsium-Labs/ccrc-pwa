# Waiting on you: item numbers, and a 48-hour Recently cleared trail

## Goal

Two operator asks on the Waiting on you screen. Each operator item's card and page show its number (`#129`), the item's own `id` from the API, so a coordinator's "item 129" can be matched to it. The Recently cleared trail covers the last 48 hours instead of seven days, shows the newest five, and has a Show all control that reveals the rest of the 48-hour list and folds it back.

## What was read first

- `ItemView.id` in `shared/ledgers.ts` is the item's row id, the number every coordinator route and mail already names; the console printed it nowhere.
- The server already filters the trail: `itemsFor` in `server/src/coord/ledgersStore.ts` keeps `done` items whose `closedAt >= now - CLEARED_WINDOW_MS`, newest first, and `CLEARED_WINDOW_MS` lives once in `shared/ledgers.ts`. The console drew whatever it was sent.
- `server/test/token-shared.test.ts` counted `CLEARED_WINDOW_MS` among the seven-day holders, so the census loses it.

## Deviations found

- **D-8194 (2026-11-10)** — Waiting on you shows each item's number (#id) on its card and page; Recently cleared covers 48 hours (one shared CLEARED_WINDOW_MS), newest five with Show all.

## Design

- One window: `CLEARED_WINDOW_MS` becomes `48 * 3600 * 1000` in `shared/ledgers.ts`. The server's list and the console's trail both read it; the console also applies it against the page clock (`clearedTrail` in `pwa/src/ledgers/ledgerWords.ts`, edge included as the server includes it), so a list heard a while ago does not show what has since aged out.
- The number is `itemNumber` in `ledgerWords.ts` (`#` and the id). On a card it sits under the kind chip from 521 px up, and beside it on a one-column row (phone, and the list beside an open item); on the item's page it sits beside the kind chip; a cleared row carries it in its tail. Mono, the meta's ink, never truncated.
- The trail shows `CLEARED_SHOWN` (5) newest; a ghost `Button` reads "Show all N" (`aria-expanded`), and "Show fewer" once open. Five or fewer draw no control.

## Tasks

- [x] T1. Tests first, red: `pwa/test/ledger-words.test.ts` (window, order, number), `pwa/test/waiting-screen.test.tsx` (card and cleared-row numbers, the 47h59m and 48h01m boundary, five and Show all), `pwa/test/item-view.test.tsx` (the page's number); `server/test/ledgers-policy.test.ts` pins 48 hours; the seven-day holders census drops the trail.
- [x] T2. Build: the constant, `clearedTrail`, `itemNumber`, the card, page and trail markup and their CSS.

## Follow-up: item links, the grouped trail, and an item past the window

The rest of the operator's acceptance, under the same D-8194.

- **"item N" links.** `itemRefsIn` in `pwa/src/ledgers/ledgerLinks.ts` finds "item 129", "item #12" and every number of "items 12 and 13" (a number glued to a word, zero and a leading zero are none); `linkRuns`, the item text's one link renderer (not the chat's Markdown), takes an `itemHref` and draws each number it answers as a link to that item's page, in the text between the other links only. The routes answer it (`useItemHref` in `WaitingRoutes.tsx`): a number the list holds (open or cleared) at once, any other once `GET /api/items/:id` has said it is an item (`useItemRefs` in `itemReads.ts`, read once per page life); a number that is no item stays text. On the item's page the what, why, steps and sent-back notes link in place. A card is one button and a link cannot sit inside a button, so a card's references are linked on a "Mentions item 12, item 13" line under it, in its list item.
- **A closed item is read-only.** Its panel says it is done, withdrawn or dismissed (`closedItemWords`) and offers no act.
- **The grouped trail.** Show all opens the whole 48 hours grouped by programme (`clearedGroups`): a heading per programme in the order of its newest clear, its swatch in the programme's hue, its name and count, each collapsed until pressed. Which groups are open lives in the trail's own state: Show fewer forgets it, and so does leaving the page; nothing is stored. The list filtered to one programme has one group, so it shows its share as one plain list.
- **An item past the window opens.** `GET /api/items/:id` (session-gated, no box token) answers any item the operator was shown, whatever its state and age; an item still held, or settled inside its hold (`operatorWasShown`, the list's own rule), is `unknown-item`. The item route reads it when the live list does not hold the id (`useItemRead`) and draws it read-only once closed; it says the item is gone only while nothing was read.

### Tasks

- [x] T3. Tests first, red: `server/test/ledgers-operator-routes.test.ts` (the read: past the window, withdrawn, held, unknown, malformed), `pwa/test/ledger-links.test.ts` (the references), `pwa/test/item-view.test.tsx` (links in place, a closed item read-only), `pwa/test/waiting-screen.test.tsx` (grouped, collapsed, in hue, nothing remembered, the Mentions line), `pwa/test/waiting-routes.test.tsx` (an item past the window opens read-only; links to heard and read items), `pwa/browser/waiting.browser.test.ts` (the grouped trail and a card's link at 390, 1280 and 1920 in both skins).
- [x] T4. Build: the route and its census rows (`LEDGER_OPERATOR_DOORS`, `MASKED_GET_ROUTES`, the gate's route counts, CLAUDE.md's bullet), the client read, `itemReads.ts`, the references, the closed panel, the grouped trail and their CSS.
