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
