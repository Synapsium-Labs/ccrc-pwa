# Wave 5k, Task 7: the line, the sheet and the mount

New:

- `pwa/src/fleet/LandingLine.tsx`, `pwa/src/fleet/LandingWithdrawSheet.tsx` and `pwa/src/fleet/landing-line.css` (L4, C5).
- The tests: `pwa/test/landing-line.test.tsx` (18), `pwa/test/landing-withdraw-sheet.test.tsx` (18) and
  `pwa/test/landing-line-hold.test.tsx` (1), with a shared fixture, `pwa/test/landingLineFixture.ts`.
- Four cases at the end of `pwa/test/project-card.test.tsx`.

Changed:

- `pwa/src/fleet/FleetCards.tsx`: the hook's call, the two props and the hold key's landing part.
- `pwa/src/fleet/ProjectCard.tsx`: the two optional props, the card's ref and `tabIndex={-1}`, and one mount line between
  the head and the body, outside the fold.
- `README.md`: section 6's block, written from the plan's own text. The old sentence occurred once, as a whole line.
- The architecture spec: the C5 rows of the three new files. The row now reads as section 9 gives it.

## Where the build follows section 4.5 in a way the plan left open

- **Where `LandingPauser` is declared.** It is in `LandingLine.tsx`, as section 4.5 shows. `LandingWithdrawer` is in the
  sheet's file, and `LandingLine` imports it.
- **How the line knows a sheet closed after an answer.** The sheet's `onClose` takes no argument (section 4.5).
  `LandingLine` therefore wraps the withdraw call it hands the sheet and marks the answer when it lands. On close it
  reads that mark to choose the `Done` order or the `Cancel` order.
- **Section 11's busy rule, on both buttons.** The pause button is never disabled while busy, and a second tap sends
  nothing. The sheet's confirm button works the same way while its call is in flight. It is disabled only under
  `SHEET_GONE`.
- **When focus counts as inside the block (R6).**
  - The block counts focus as inside from the section's focus event.
  - A blur clears that only when its `relatedTarget` is a node outside the section.
  - When the block goes, the effect moves the focus only if the document's active element is the body, or there is
    none. That is what removing a focused element leaves behind.
  - So a removal that fires a blur with no `relatedTarget` still finds the card.
- **The stylesheet.** `landing-line.css` uses tokens only. Each ink rule sets `--bg-surface`, the card's ground, beside
  it. Rows are a grid: the role text sits under the PR at phone width and on the PR's line from 600px.

## Departure: one more existing test file

`pwa/test/contrast.test.ts` lists the app's stylesheets as a closed literal (`APP_SHEETS`), which says a new sheet is "an
architectural event worth a test edit". The plan's section 3 does not name that file. I claimed it and added one line for
`src/fleet/landing-line.css`, with its reason. Slug: `landing-line-css-in-app-sheets`.

## Existing tests that render the fleet cards (R10)

`fleet-list-memo`, `accounts-one-poll` and `fleet-screen` ran green with the mount in place, with no change. So did
`line-props` and `programme-box-card`: its `project-c:-0` key is unchanged, because a card with no block adds nothing to
its part. The whole pwa suite's result is in Task 8's note.

## Runs

From `pwa/`, through `ccrc test`, all green:

- the pwa typecheck;
- `landing-line`, `landing-withdraw-sheet`, `landing-line-hold` and `project-card` (116);
- `line-props`, `programme-box-card`, `fleet-list-memo`, `accounts-one-poll` and `fleet-screen`;
- `refusal-literal-ratchet`, `fleet-css`, `css-vars`, `utility-pairs`, `contrast`, `hover-states`, `focus-ring` and
  `design-system-boundary`.

From `server/`: `rings/` whole, `census-w7/pwa` and `growth-check`, reported in Task 8's note.
