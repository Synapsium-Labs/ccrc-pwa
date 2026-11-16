# Start new sessions here: the Accounts card's home-able switch

## Goal

The operator can say, from the Accounts screen, whether new sessions may start on an account: the roster's `homeAble`. Until now it could be changed only on the fleet box (`ccrc account set --placement`, or a hand edit of `accounts.json`). The control must not be confused with the lane's on/off switch: it has its own label, its own row and its own words, and a tap asks before it changes anything.

## What was read first

- `shared/roster.ts`: `homeAble` is a required boolean on every roster row; `RosterWire` carries it to the PWA.
- `deploy/account-op.mjs`: `set-placement --file --id --placement full|overflow` already writes `homeAble` (`full` is `true`), through `writeRoster`, the roster's one writer, and refuses a value off the enum (`bad-argv`) and an id the roster does not hold (`unknown-id`). A lane already placed so is a no-op.
- `ccd/ccrc` `_acct_set`: `ccrc account set --placement` takes the lane lock and the placement lock, refuses `last-home-able` for the only placeable lane, then runs `set-placement` and regenerates the projection (`CCRC_HOME_ABLE`).
- `server/src/accounts/routes.ts`: `POST /api/accounts/:id/set` takes `{stated?, placement?}` behind the account gate (session verdict, origin, the `account-v2` cap; no step-up), runs `ccrc account set`, re-reads the roster and answers `{ok, roster, lane}`. `shared/account-argv.ts` holds `placement` to the enum before any verb runs. `last-home-able` already crosses as its own route word.
- `pwa/src/lib/api.ts`: `accountSet(id, {placement})` already exists. Nothing in the PWA sent `placement`.
- `pwa/src/fleet/AccountKnob.tsx`: the kill switch moves only on the server's ack, has no confirm (it is reversible), and its row reads "On: new sessions can land here".

## Deviations found

- **D-8195 (2026-11-10)** — the Accounts card's "Start new sessions here" switch: the roster's `homeAble`, written by the existing `set-placement` op through `POST /api/accounts/:id/set {placement}`; no second writer, a confirm sheet on every tap, and the kill switch renamed `<id>: lane on or off` so the two never share a name.

## Design

- **No new op, route or client call.** The brief asked for a `set-homeable` op beside `set-placement`. That op would be a second writer of the same field, under the same lock, with the same refusal; `set-placement` is that writer already (`full` / `overflow` are `homeAble` true / false, spec §8.4). The switch sends `{placement: 'full' | 'overflow'}` to the existing route.
- **Its own row, under the kill switch's.** `AccountHomeAble` draws the switch, a visible label "Start new sessions here" and a sentence: "New sessions can start on it." or "Overflow only: new sessions start on other accounts." Both switches share one drawing, `LaneSwitch` (the markup census refuses the same block written twice). The kill switch's accessible name becomes `<id>: lane on or off`; the new switch's is `<label>: Start new sessions here`.
- **One tap, then a confirm.** A tap opens `QuickConfirm`: "New sessions can start on <label>." or "New sessions will not start on <label>; running sessions stay." Only its confirm sends the act.
- **It moves only on the server's ack.** `useLaneActs.place` runs it as the lane's one act in flight (`LaneActKind` gains `placement`), holds the roster the route re-read until the refreshed `/api/accounts` lands, and toasts a refusal worded from its code (`laneActRefusal('placement', …)`, which learns `last-home-able`). Offline, an insecure origin or a fleet without the acts draw it disabled, named by the knob row's reason.

## Tasks

- [x] T1. Tests first, red: `pwa/test/account-homeable.test.tsx` (the words, the row beside the knob, confirm and cancel, the ack, a refusal, a screen that cannot act).
- [x] T2. Build: the words in `accountWords.ts`, `LaneSwitch` and `place` in `AccountKnob.tsx`, `AccountHomeAble.tsx`, the screen's row, its CSS; the control, markup and role censuses.
- [x] T3. Server: `account-op-set-placement.test.ts` pins the op the switch reaches; `account-routes-write.test.ts` pins `{placement}` alone (refused with no session, run for a signed-in one, `last-home-able` as its word, an off-enum value refused before any verb).
- [x] T4. Every width: `account-knob.browser.test.ts` measures the row and the confirm at 360, 390, 1280 and 1920 in both skins and both themes.
