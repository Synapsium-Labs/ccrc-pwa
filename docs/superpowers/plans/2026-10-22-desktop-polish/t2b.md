# Task T2b: no floating `+` at the desk in Instrument

A task note for the programme ledger (Task T2b, D-6328, run 1070). The coordinator folds what it needs into the ledger;
this file is not the ledger. Times are UTC, 2026-10-27.

## Step 0: anchors at `ef8442580`

| Anchor | Plan said | Measured |
|---|---|---|
| `FleetScreen.tsx`'s legacy round `+` (the `Fab` fallback) | ≈:356-358 | :375-379; the `Fab` slot is read at :154. It stays: it is what renders outside a frame, where `useFrameSet()` is null |
| `instrument.css`'s desk `.ins-frame .fab` | ≈:47-52 | the comment at :47-48 and the rule at :49-52, inside `@media (min-width: 900px)` (the first Step 0 report said :45-46 and :47-52; corrected under review 1090) |
| `TopBar.tsx`'s `+` | ≈:44-46 | :41-43 |
| `door.ts`'s `DOOR_EVENT` | ≈:15 | :17 (the first Step 0 report said :15, a miscount; corrected under review 1083's A6) |
| `sheet-focus-ring.browser.test.tsx`'s locator | `button.fab`, ≈:52-56 | #1139 had already widened it to `[data-command="new-session"]:visible, button.fab[aria-label="New session"]:visible`. T2b narrows it to the first arm, since every visible New session door now carries the mark |

## What changed

- `PhoneFab` (`skins/instrument/PhoneFab.tsx`) renders the round `+`, built with `commandDoor('new-session')`, only while
  `useDesk()` is false, and nothing at the desk. It is Instrument's `Fab` part. It is mounted and unmounted, never hidden
  by CSS, and the desk rule that placed `.fab` in `instrument.css` leaves.
- `control-census.test.ts` gains the `PhoneFab.tsx <button> fab` entry (T3a's consent, mail 11063).
- R13's two items, carried under the coordinator's ruling on ask 168, are TEST fixes in
  `refined-phone.browser.test.ts` (S5b's consent, mail 11076). They do not change Refined's behaviour:
  - F1: the toast-above-`+ New` case now raises a real toast through `ToastHost` (the update line's dismiss) and
    measures its bottom against `+ New`'s top. The hand-copied host div is gone.
  - F2: the phone cases run with a 34 px bottom safe-area inset, emulated through the DevTools protocol
    (`Emulation.setSafeAreaInsetsOverride`), so `env(safe-area-inset-bottom)` is not zero. A Chrome without the
    command fails the case; it never measures at zero.

## Mutation tables, run

instrument-shell (jsdom), each mutant on the working tree, this suite alone, then restored:

| Mutant | Expected red | Result |
|---|---|---|
| `PhoneFab` mounted at every width | "exactly one [data-command=new-session] at 900, 1280 and 1920" | RED |
| `PhoneFab` with its own `onClick` that navigates (door mark kept) | "at 390 the round + dispatches the new-session door event" | RED |
| `PhoneFab` gated on `(min-width: 600px)` | "at 899 the round + is the one New session door" | RED (1 failed, 30 passed; the run before it died on a worker-start timeout under load and was re-run alone) |

refined-phone (browser), red-first for R13:

| Mutant | Old file | New file |
|---|---|---|
| MA: `.ref-fab`'s `bottom` without `var(--safe-bottom)` | green (P0) | RED: "+ New sits on the home indicator (16 px clear of the edge, inset 34)" in all six phone views (360, 390 and 438, both palettes) |
| MB: `ToastHost`'s bottom without `var(--phone-nav-h,0px)` | green (P0) | RED: the toast's bottom against + New's top in all six phone views (786 against 784 at 390 with MA beside it; 786 against 750 with MB alone, measured by review 1090) |

MA and MB ran together in both P0 and P1, one run each, not one mutant at a time. MA only lowers `+ New`, which can only
help the toast case pass, so the toast case's red under both is a red under MB alone. The worker's own new-file run was
filtered to the two views at 390; review 1083 measured all six phone views red.

instrument-fab (browser, `pwa/browser/instrument-fab.browser.test.ts`, added under review 1083's A2), Instrument at
899, 900 and 1280 in both palettes, each mutant on the working tree, then restored:

| Mutant | Result |
|---|---|
| V: `@media (max-width: 899.98px) { .fab { visibility: hidden } }` appended to `fleet.css` | the file's first version: GREEN at 899 (it counted a client rect only). Under review 1090's F1 a door counts only when `checkVisibility({ visibilityProperty: true, opacityProperty: true })` also passes: RED at 899, both palettes (`{ doors: 0, fabs: 1, fabIsDoor: false, inTopBar: false }`) |
| `PhoneFab` mounted at every width | RED at 900 and 1280, both palettes: two doors and a `.fab` (`{ doors: 2, fabs: 1, fabIsDoor: false, inTopBar: false }`); re-run at the visibility change |
| `PhoneFab` gated on `(min-width: 600px)` | RED at 899, both palettes: no door (`{ doors: 0, fabs: 0, fabIsDoor: false, inTopBar: false }`); re-run at the visibility change |

Unmutated: 6 of 6. The jsdom suites (instrument-shell, skin-boundary, control-census, fleet-flows) pass 98 of 98 at the
tip with the standard flags.

## Departures, by slug

- `t2b-carries-r13-in-refined-phone-browser`: `refined-phone.browser.test.ts` is not in the plan's Files for T2b. The
  coordinator added it for R13's two cases only (ask 168), with S5b's consent.
- `t2b-fab-layout-browser-pin`: `pwa/browser/instrument-fab.browser.test.ts`, a browser file the plan does not name,
  added under review 1083's A2 because the files that hold Instrument's other browser cases belong to other tasks.
- The 899 case in `instrument-shell.test.tsx` and its mutation-table row went beyond S5b's first consent (mail 11070,
  two cases). S5b consented to exactly those lines afterwards (mail 11283).

## Follow-up for S11

`shell.css`'s desk rule `.app-shell .fab` (≈:268-272, it moved the round `+` to the sidebar's lower left) is now a dead
rule: it applies to nothing. The legacy fallback in `FleetScreen.tsx` renders only outside a frame, so it is never a
descendant of `.app-shell`, and no frame mounts a `.fab` at 900 and up. It is outside T2b's Files (S5b holds the file),
so it stays, for S11 to remove.
