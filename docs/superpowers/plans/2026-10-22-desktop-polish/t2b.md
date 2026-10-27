# Task T2b: no floating `+` at the desk in Instrument

A task note for the programme ledger (Task T2b, D-6328, run 1070). The coordinator folds what it needs into the ledger;
this file is not the ledger. Times are UTC, 2026-10-27.

## Step 0: anchors at `ef8442580`

| Anchor | Plan said | Measured |
|---|---|---|
| `FleetScreen.tsx`'s legacy round `+` (the `Fab` fallback) | ≈:356-358 | :375-379; the `Fab` slot is read at :154. It stays: it is what renders outside a frame, where `useFrameSet()` is null |
| `instrument.css`'s desk `.ins-frame .fab` | ≈:47-52 | :47-52, with its comment at :45-46, inside `@media (min-width: 900px)` |
| `TopBar.tsx`'s `+` | ≈:44-46 | :41-43 |
| `door.ts`'s `DOOR_EVENT` | ≈:15 | :15 |
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
| MA: `.ref-fab`'s `bottom` without `var(--safe-bottom)` | green (P0) | RED: "+ New sits on the home indicator (16 px clear of the edge, inset 34)", both palettes at 390 |
| MB: `ToastHost`'s bottom without `var(--phone-nav-h,0px)` | green (P0) | RED: the toast's bottom 786 against + New's top 784, both palettes at 390 |

MA and MB ran together in both P0 and P1, one run each, not one mutant at a time. MA only lowers `+ New`, which can only
help the toast case pass, so the toast case's red under both is a red under MB alone.

## Departures, by slug

- `t2b-carries-r13-in-refined-phone-browser`: `refined-phone.browser.test.ts` is not in the plan's Files for T2b. The
  coordinator added it for R13's two cases only (ask 168), with S5b's consent.
