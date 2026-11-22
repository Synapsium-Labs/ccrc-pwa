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
  and the ladder. Every 60 s while the page is visible, one timer re-reads the designation and the ladder (with the
  word), and re-reads the capability words too while their last read failed (`readFailed`). An answer without the word is
  read again only when the page comes back to the front, which re-reads everything. A hidden page does not poll, and no
  Overlord read is made without `overlord-v1`.
- **The bars.** All three bars draw the derived places. Instrument's wordmark runs `go-home` and is named "ccrc, Home".
  Every go-fleet door names `FLEET_PATH`, and `pwa/test/go-fleet-census.test.ts` holds that with planted cases.
- **Mutation floors.** `server/test/sim/homeSets.ts` adds the mutants H1 to H18 over eleven deciders: the plan's five,
  and, from review 3319 (F3, A10), `homeSettled` (its caps, designation and ladder waits), `capReadOf`, `rungReadOf`,
  `designationWordOf`, `nextReadState` and `readFailed`. All eighteen are killed, and each floor is 1.
- **The characterization (review 3319 F4).** `pwa/test/fleet-characterization.test.tsx` holds what the Fleet drew at `/` on
  the branch's unmodified base, b33a9ae137: a probe ran the test's own measuring code at `/` in a checkout of that commit,
  in Refined at a phone width and at 1280 px, from the same fixture. The test asserts that `/fleet` on this branch draws
  exactly that picture. The base drew `/` and kept the address `/`.
- **The browser cases that mean the Fleet open `/fleet` (review 3319 F1).** 91 entries in 41 browser files moved from `/`
  to `/fleet`, with one coupled helper comparison (`frame-cost`'s `ready`) and no assertion removed. Three stay at the
  root on purpose: `auth-resume`'s relaunch at `/` and `skin-default`'s two first visits. The new
  `pwa/browser/home-root.browser.test.ts` holds the root itself: `/` lands on `/fleet` (or `/overlord`), and Back leaves
  the app.

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
- **`replace-names-its-from`.** A second bug, found by review 3319 (F1) in the browser. `navigate` runs its history call
  inside a view transition, which the browser runs a frame later. So the home's deferred replace could land after a tap or
  a test had already opened another page, and overwrite it (lazy-screens failed 9 of 17 and accounts-cards 4 of 24 at
  515c82f3). `navigate` takes `from`, the address the move leaves, and does nothing once the page has left it: it checks
  when called and again when the history call runs. `useReplaceWhen` passes the address it was asked from. The pins are a
  held-transition case in `home-route.test.tsx`, two router cases, and a browser case in `home-root.browser.test.ts`
  that holds the first transition 800 ms and taps Runs meanwhile. Each is red without the guard. When the tap lands
  while the replace waits, Chrome skips the first transition and rejects its `ready` promise, which `navigate` has never
  held; the browser case allows that one rejection and no other error.
- **`phone-bar-measures-its-own-width`.** `phoneDoorsFit` takes the bar's own width. The bar measures it with a
  `ResizeObserver` and reads the window's width until it is laid out. No new resize listener was added.
- **`refined-wordmarks-are-not-doors`.** The plan said Refined's wordmarks run `go-home` "where they are doors today".
  Neither `AppBar`'s wordmark nor `PhoneHeader`'s is a door, so they are unchanged. Only Instrument's wordmark runs
  `go-home`.
- **`command-context-carries-the-home`.** `go-home` and the gated `go-overlord` read the home and the word through
  `CommandContext` (`home`, `overlordShown`), which the command layer fills from the store. So `commands.ts` stays free
  of stores. `go-overlord` is offered only while the word is advertised. `useShortcuts` binds a chord whatever its
  command's `when`, so a "Go to" command's run asks its `when` too and does nothing where it is not offered: `g o` without
  the word moves nothing (review 3319 A1, pinned by keydown in `overlord-chord.test.tsx`).
- **`place-path-helper`.** `placePath(id)` in `routes.ts` reads a place's path off `ROUTES`. `FLEET_PATH` is
  `placePath('fleet')`, and the home route navigates to `placePath(home.place)`.
- **`overlord-route-heading-word`.** PR A's place draws its heading and a state word per designation kind. The words are
  `DESIGNATION_WORDS` in `homePlace.ts`, and PR B's `placeWords.ts` may take them over. `designationWordOf` (L1) picks the
  word from the read itself, so a read still in flight says "Loading…" and only a failed read says it could not be read
  (review 3319 A3).
- **`older-health-has-no-caps`.** An older server's `/health` has no `caps`. The store reads that as an answer with no
  words, not as a failure.
- **`poll-rereads-failed-caps`.** Review 3319 (F2): the plan read the capability words at start and on focus only, so one
  failed first read hid the Overlord until a reload. The visible poll's one timer now reads them again on each tick while
  their last read failed (`readFailed`, L1: `unmeasured` or `stale`), and the Overlord's reads follow on the same tick.
  An answer without the word is not a failure, so the poll leaves it.
- **`unreadable-body-is-a-failure`.** A 2xx body without the read's own field (`designation` or `operatorRung`) is a
  failure (`unreadable answer`), never a row read as nothing.
- **`phone-door-floor-is-the-word`.** The plan fitted phone doors at the 44 px tap minimum. In the browser leg, "Accounts"
  was cut at 45.7 px and at 48 px, and needs 49. So `phoneDoorsFit` keeps each door at `PHONE_DOOR_FIT_PX` (50 px), which
  is never less than the tap minimum. With the Overlord's door, all eight doors fit from 400 px, Docs goes to Search from
  360 to 399 px (390 included), and Accounts goes to Search too at 320. Without the Overlord, today's seven fit from
  350 px. At 320 Docs goes to Search, because seven doors there are 45.7 px each, and "Accounts" was already cut on `main`.
- **`refined-crowded-bar-sheds-words`.** With the Overlord's and the Fleet's tabs, Refined's bar has seven tabs, and at
  900 px the line ran 105 px past its frame, cutting New session (1 px past at 1100). Below 1200 px (`REF_ROOMY_QUERY`), a
  bar of more than five tabs names each tab by its place's short word where it has one ("Waiting") and draws New session
  as its "+" alone, still named "New session", as Instrument's is. A bar of five tabs is unchanged at every width.
- **`refined-fleet-tab-follows-toprouteof`.** Review 3319 (A5): Refined's tabs were current by exact route, so with the
  Fleet tab drawn it was not current on a session. The Fleet tab now reads `topRouteOf`, as Instrument's door does, and is
  current on `/fleet` and on a session; every other tab is current on its own route, as before.
- **`health-routed-in-the-browser-harness`.** `pwa/browser/app.ts` routes `GET /health` by its exact path. Unnamed, it
  answers a server with no words, so the existing browser cases see no Overlord with no edit. That held for the word,
  not for the path: the cases that opened `/` meaning the Fleet now open `/fleet` (above).
- **`store-reads-health-at-start`.** The store's capability read is the app's one read of `/health` at start, before any
  screen. `ask-inline.browser.test.ts` counted every `/health` request to hold that the ask sheet reads none (W7 C7p), and
  the full browser leg on this PR counted the store's read too (8 cases, 1 read each). The count now starts when the sheet
  is drawn, so the sheet's own reads still fail it (measured with a read added to the answer path: all 8 red), and the
  start read is held to one.
