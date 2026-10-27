# Task T2d: the Inbox and Runs counts show only what waits on the operator

A task note for the programme ledger (Task T2d, D-6330). The coordinator folds what it needs into the ledger; this
file is not the ledger. Times are UTC, 2026-10-27. The branch started at `ef8442580` (`main`).

## Step 0: the anchors, re-measured at `ef8442580`

| Plan anchor | Measured |
|---|---|
| `FleetScreen.tsx` the mail door's count ≈:186-187 | :201-204 |
| `FleetScreen.tsx` the runs line ≈:160-162, ≈:252-259 | the label :170-179, the row :271-278 (the row's markup is unchanged, for T2f) |
| `AppBar.tsx` the badge reads ≈:45-47, the cap ≈:24 | :46-48, :25 |
| `PhoneHeader.tsx` the badge reads ≈:40-45, the cap ≈:22 | :47 and :56-57, :24 |
| `MailBadge.tsx` the cap ≈:17 | :17 |
| `Rail.tsx` the cap, and its comment on `useNavBadges`'s readers (R32's F8) | :54, and :10-13 |
| `instrument-shell.test.tsx` ≈:259-270 | the rail's Inbox cases are :449-509 |
| `fleet-screen.test.tsx` the runs line | no case; the runs row was pinned only in `tap-targets.test.tsx` :476-490 |

The readers on `main`: `unreadMailCount` was read by `useNavBadges` (AppBar, PhoneHeader, Rail) and by `FleetScreen`
for the fleet head's `MailBadge`. `openRunCount` was read by `useNavBadges` only. The runs line and `fleetSummary` each
counted open runs through `isRunClosed` directly.

The fleet store's first-frame fact is `fleetFrameSeen` (`stores/fleet.ts`), set only by the first `{type:'fleet'}`
frame; `sessions` is hydrated from the offline snapshot before it, so a count keyed on `sessions` alone would print
the snapshot as a fact. `waitingOnYou` and `runsNeedYou` take `null` until their frames, and a door draws no badge for
`null` or 0.

## What changed

- `fleet/navBadges.ts` owns the counts: `waitingOnYou`, `runsNeedYou`, `runsLineLabel`, `badgePrint` and
  `BADGE_PRINT_CAP` (the one print cap; the four copies went), and the two units the doors say. `useNavBadges` returns
  `{waiting, runsNeedYou}`.
- Every Inbox door counts `waitingOnYou` and says "waiting for you": Refined's tab and phone door, Instrument's rail
  door (R32's F1) and the fleet head's mail door. The Runs doors count `runsNeedYou` and say "needs you".
- The runs line reads "N active" (`ACTIVE_RUN_STATES`, through `runState`, so a state this build does not know is
  active), "N open", "none active", or "—" before the runs frame.

## Mutation table

Run and recorded in `pwa/test/needs-you-counts.test.ts`'s header: thirteen mutants, all killed, including the plan's
six rows and R32's F5 case, which moved to the Inbox's own rows (`mail-screen.test.tsx`).

## Departures, by slug

- `unread-count-retired`: `unreadMailCount` had no reader once every door counted what waits on the operator, so it
  was deleted (the coordinator's ruling on the ask). The Inbox's rows keep their unread mark.
- `fleethead-prop-name`: `FleetHead`'s `unreadMail` prop is now `waiting`. `FleetHead.tsx` was not in the plan's Files.
- `browser-tests-unnamed`: three browser files asserted the old names and were not in the plan's Files:
  `refined-bar.browser`, `refined-phone.browser` (both under S5b's claim, edited with its exact consent) and
  `instrument-desk.browser`.

## Residuals

- `fleetsummary-second-spelling`: `fleetSummary.ts` counts `s.bucket === 'attention'` inline rather than through
  `operatorAsk`. It is not in T2d's Files and was left alone.
- Before the first fleet frame the mail door's accessible name reads "Mail — nothing waiting for you", because
  `FleetScreen` passes `waiting ?? 0`. Nothing is drawn, but the name states a zero that is not yet known. The fix is
  for `MailBadge` and `FleetHead` to take `number | null`.
- `navBadges.ts` exports a hook, so the rings place it in L4. Its pure counts cannot be imported by an L1 module until
  they move to a module of their own.
- The gate `fleetFrameSeen ? sessions : null` is written in two places, `useNavBadges` and `FleetScreen`, because
  FleetScreen reads a store passed as a prop.
- Comments outside T2d's files still say the feed's unread count feeds a door: `lib/seen.ts` (`isUnseenAt`'s doc),
  `instrument.css` (the rail count's rule), `ui/src/primitives/count-badge.tsx` and `stores/fleet.ts` (the feed's
  doc).
