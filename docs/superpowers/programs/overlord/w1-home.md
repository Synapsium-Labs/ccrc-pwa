# Overlord W1 home, PR A: notes for the ledger

Run 3302 built PR A of `docs/superpowers/plans/2026-11-14-overlord-w1/w1-home.md`: Tasks 1 to 3, the home and the places.
This note lists what the build measured and where it departed from the plan. Each departure has a slug, and the
coordinator mints its number when it folds this note into the ledger. PR B and PR C write their own notes.

## What landed

- **The deciders (L1).** `pwa/src/overlord/homePlace.ts` holds `overlordShown`, `designationStateOf`, `homePlace` (over
  the table `HOME_TABLE`) and `OVERLORD_DOOR`. `pwa/src/lib/places.ts` derives `placesFor`, `deskPlacesFor` and
  `phoneDoorsFit`, and the constants `PLACES` and `DESK_PLACES` are gone. `ledgers-console.test.ts` pins the new names to
  `places.ts` and the old ones to nowhere.
- **The routes.** `/` is the `home` route. The Fleet is `/fleet`, and its path is declared once, as `FLEET_PATH`. The
  Overlord's place is `/overlord`. `ProgrammeScreen.tsx` imports `FLEET_PATH` in place of its own copy.
- **The store (L4).** `pwa/src/stores/overlord.ts` is the console's one reader of the capability words, the designation
  and the ladder. It polls every 60 s while the page is visible, re-reads when the page comes back to the front, and
  makes no Overlord read without `overlord-v1`.
- **The bars.** All three bars draw the derived places. Instrument's wordmark runs `go-home` and is named "ccrc, Home".
  Every go-fleet door names `FLEET_PATH`, and `pwa/test/go-fleet-census.test.ts` holds that with planted cases.
- **Mutation floors.** `server/test/sim/homeSets.ts` adds the mutants H1 to H8 over the five deciders. All eight are
  killed, and each floor is 1.

## Departures

- **`read-outcome-is-l1`.** The plan gave each read's state change to the store. It is the L1 function
  `nextReadState` in `pwa/src/overlord/readOutcome.ts`, so the store decides nothing: an answer is `answered`, the
  read's own 404 is `absent`, and a failure is `stale` after an answer and `unmeasured` before one.
- **`home-settled-decides-the-replace`.** `homeSettled` (L1, in `homePlace.ts`) says when `/` may replace itself: when no
  read the answer depends on is still loading. With the word, a designated Overlord's ladder must answer too, because
  the rung `off` sends the home to the Fleet.
- **`cap-and-rung-reads-are-l1`.** `capReadOf` and `rungReadOf` turn the store's read states into the inputs that
  `homePlace` takes. An older server with no ladder (`absent`) reads the rung as unmeasured, so the place keeps the brake.
- **`replace-waits-for-the-commit`.** This one is a bug that the build found. A child's effect runs before its
  parent's, and the shell's `useLocation` subscribes to `popstate` in its own effect. So when the home was already
  decided at the first mount, the home route's replace dispatched before the shell listened, and the replace was lost.
  `useReplaceWhen` now defers the replace to a microtask. `home-route.test.tsx` has a shell-shaped case that is red
  without the deferral.
- **`phone-bar-measures-its-own-width`.** `phoneDoorsFit` takes the bar's own width. The bar measures it with a
  `ResizeObserver` and reads the window's width until it is laid out. No new resize listener was added.
- **`refined-wordmarks-are-not-doors`.** The plan said Refined's wordmarks run `go-home` "where they are doors today".
  Neither `AppBar`'s wordmark nor `PhoneHeader`'s is a door, so they are unchanged. Only Instrument's wordmark runs
  `go-home`.
- **`command-context-carries-the-home`.** `go-home` and the gated `go-overlord` read the home and the word through
  `CommandContext` (`home`, `overlordShown`), which the command layer fills from the store. So `commands.ts` stays free
  of stores. `go-overlord` is offered, and `g o` is bound, only while the word is advertised.
- **`place-path-helper`.** `placePath(id)` in `routes.ts` reads a place's path off `ROUTES`. `FLEET_PATH` is
  `placePath('fleet')`, and the home route navigates to `placePath(home.place)`.
- **`overlord-route-heading-word`.** PR A's place draws its heading and a state word per designation kind. The words are
  `DESIGNATION_WORDS` in `homePlace.ts`, and PR B's `placeWords.ts` may take them over.
- **`older-health-has-no-caps`.** An older server's `/health` has no `caps`. The store reads that as an answer with no
  words, not as a failure.
- **`unreadable-body-is-a-failure`.** A 2xx body without the read's own field (`designation` or `operatorRung`) is a
  failure (`unreadable answer`), never a row read as nothing.
- **`health-routed-in-the-browser-harness`.** `pwa/browser/app.ts` routes `GET /health` by its exact path. Unnamed, it
  answers a server with no words, so the existing browser cases see no Overlord with no edit.
