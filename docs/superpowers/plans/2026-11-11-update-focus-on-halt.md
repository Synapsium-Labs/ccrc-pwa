# Updates: focus survives the halt arriving and leaving

- **D-8340 (2026-11-11)** — focus on the update halt's two transitions: when the last halting row's Ack lands and the next poll removes the home screen's halt banner, the focus goes to the landmark that is shown (`focusShownLandmark`, the update line's dismiss's own move) rather than to `<body>`; when a background poll brings a halt that disables a focused Install, Update all or node Update in Settings › Updates, a layout effect keyed on the halt moves the focus first to the one halt line (the control's `aria-describedby` target, now focusable from script); `rowHalts`' docstring names `isHaltingUpdate`.

Refs #2083 (the centralised-update programme's carried residue: R28, R30 and R33(a) of
`docs/superpowers/programs/centralised-update-management.md`).

## Why

- **R28.** The halt banner's row hands the focus to the banner's list when its Ack's poll drops it (wave 19, R26(a)).
  When the row was the last one halting, the poll drops the whole banner, list and all, so the focus was left on a
  removed row: `<body>` in a browser, and a keyboard or screen-reader user starts again from the top of the page.
- **R30.** Install, Update all and a node's Update wait while a node halts (wave 19, R24(a)). A poll is a background
  read, so a halt can arrive while one of them holds the focus. The control disables, and a browser drops the focus of
  a disabled control to `<body>`.
- **R33(a).** `rowHalts`' docstring did not name the rule its body asks; the wave-19 consent covered the body only.

## What changes

- `pwa/src/fleet/HaltBanner.tsx`: the row's leaving cleanup focuses the list while the list stays, and otherwise calls
  `focusShownLandmark()` (skins/frame.tsx): the main landmark, or the fleet column's where main is not rendered (a
  phone's fleet view). React detaches the list's ref before the deleted subtree's cleanups run, so a null ref is the
  sign that the list goes too.
- `pwa/src/screens/updates.tsx`: `MoveButton` holds its button by ref, and a layout effect keyed on `disabled` and
  `describedBy` moves the focus to the `describedBy` element when the button that holds the focus disables. Every
  caller passes `describedBy` only while the halt gates that control, and its value is the one halt line's id.
  `HaltLine` takes `tabIndex={-1}`. Roll back is not gated by a halt and keeps its focus.
- `server/src/coord/store.ts`: `rowHalts`' docstring names `isHaltingUpdate` (shared/update-move.ts).

## Tests

- `pwa/test/halt-banner.test.tsx`: the poll that drops the last halting row leaves the focus on the main landmark,
  not `<body>`; a control case keeps a focus that was outside the banner. Red before the change (`<body>`).
- `pwa/test/update-halt-controls.test.tsx`: a focused Install and a focused node Update that a poll disables hand the
  focus to the halt line; control cases keep a focus elsewhere and a focused Roll back. Red before the change (the
  disabled button kept it: jsdom runs no focus fix-up for a disabled control).

## Widths

Focus behaviour is width-independent. Neither the halt banner nor the halt line has a width rule (fleet.css,
settings.css), and the only width-dependent part is which landmark is shown, which `focusShownLandmark` decides from
what the browser accepted: at 390 on the fleet view the fleet column (main is hidden), at 1280 and 1920 the main
landmark.

## Deviations found

- The residue text suggested the banner's successor heading or the updates list heading for R28. The banner stack is
  placed in three spots (the fleet column, under a desk skin's bar, and the waiting list's column), so it has no one
  successor heading. The shown landmark is the move this code base already makes for a banner-area control that
  leaves the page (the update line's dismiss, `UpdateIndicator.tsx`).
- R30's target is the halt line, not the halt banner: the controls are in Settings › Updates, which draws the one halt
  line and no banner, and the line is already each gated control's description.
