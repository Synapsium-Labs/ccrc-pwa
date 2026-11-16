# Stall watch card: name the marker that holds it, and how to lift it

- **D-8339 (2026-11-11)** — stall watch held by a marker: while `stall-watch-disabled` or `mail-gate-strict` holds the watch, the Settings › Automation › Stall watch card's held line names that marker, the strict gate's adds one line on what it does (mail is delivered to idle sessions only), and each is followed by its remedy (remove the marker from the registry at a terminal on the fleet box); both stay terminal-only emergency overrides with no control on the card, and `stall-watch-disabled` becomes a switchboard row (`shared/switches.ts`), its name spelled once there.

## Why

The card already said the watch was "held back by the fleet box" because of "its kill switch" or "its mail gate is set to
strict", but not which file holds it or what to do about it. Both are hand-touched markers with no writer in the tree, so
the operator had to know the marker's name from the README to lift the hold.

## What changes

Two PRs, because `shared/switches.ts` is a W1a-owned file and `server/test/consolidation-path-guard.test.ts` keeps any
diff that touches it off `pwa/` (the split earlier PRs made, server half first).

PR 1, the switchboard row and the server half:

- `shared/switches.ts`: `STALL_WATCH_DISABLED_MARKER` and its row (C5, hand-only, absent: the watch runs at the level that
  applies). `mail-gate-strict` was already a row.
- `server/src/coord/stall.ts`: the lane's marker map keys the kill switch by the row's constant, and `stallArmingOf` reads
  it through the constant. Nothing the lane does changes; the name is now spelled in `shared/switches.ts` alone.
- Tests: the switchboard row (`server/test/switches.test.ts`), the single-definition pin moved to the row, and
  `stall.ts`'s import pin.

PR 2, the card, once PR 1 has landed (no `shared/switches.ts` edit, so the guard passes):

- `shared/api.ts`: `STALL_HELD_TEXT.watchOff` and `.gateStrict` carry a `{marker}` slot; new `STALL_HELD_DOES` (the strict
  gate's effect) and `STALL_HELD_REMEDY` (the terminal remedy, saying there is no control here).
- `pwa/src/screens/StallWatchSection.tsx`: `STALL_HELD_MARKER` maps the held flag to its marker constant, and the Now block
  draws, per held flag, the held line (amber), then for a marker's hold its effect line (strict only) and its remedy line
  (secondary ink). Mail off and the wave-2 hold name no marker. No button, switch or checkbox is added.
- Tests: the held text per marker and the rendered card (`pwa/test/settings-screen.test.tsx`), and a browser test at 360,
  390, 1280 and 1920 in both skins (`pwa/browser/stall-watch-held.browser.test.ts`): every held line is on screen, whole,
  inside the card, set to wrap (no `nowrap`, ellipsis or hidden overflow), a remedy wraps at phone width, and the page
  never scrolls sideways.

## Deviations found

- No wire change. `StallHeld` already says which override holds the watch, one boolean per cause (`watchOff` is the kill
  switch, `gateStrict` the strict gate, as `stallBoxHeld` sets them), so the marker follows from the flag one to one. The
  wire stays booleans, as §13 of the settings design wants; the PWA fills the name from the switchboard's constant.
- The settings design (2026-10-05 §13) worded the held lines "without file names". D-8339 departs from that for the two
  terminal-only overrides: an override the card cannot lift is only actionable if the card names it.
- One change, two PRs: the first cut edited `shared/switches.ts` beside `pwa/`, which the W1a path guard
  (`consolidation-path-guard.test.ts`, run on every PR) holds red. The row and the server half land first; the card
  follows and cites D-8339 without defining it again.
