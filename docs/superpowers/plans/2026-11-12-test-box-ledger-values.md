# Test box ledger: old and new values for settings edits

- **D-8399 (2026-11-12)** — `testbox-ledger-values`: the operator's ruling on the test box settings ledger (#2438, "every write is a ledger line: who, what, old value and new value; secret-bearing settings show presence only"). An `ok` `settings-fleet` or `settings-box` row of `testbox_events` records each setting the act changed with its old and new value, each value read through that setting's own typed reader (`fitsTestboxShape`, the L0 copy of `_tb_shape`), so a row still holds no free text; a secret-bearing setting (the fleet host's token and push key files, the box service's token file), and every path, address or list (the readers' is-set display classes), records presence only (`set`, `not set`, `default`, `unknown`); a refused or failed edit records no values. This amends TC12 of `docs/superpowers/plans/2026-11-10-test-box-connect.md` (D-8166), whose rows carried closed codes only.

Refs #2438.

## Why

TC12 built the ledger with closed vocabularies and no free text, so a settings edit's row said only that the edit happened.
The ledger could not answer "what did it change, from what, to what". The ruling keeps TC12's purpose (nothing a row holds
is free text, an address, a path or a secret) and adds the values a setting's own reader already shows.

## What changes

- `shared/testbox-admin.ts` (L0): `TESTBOX_SECRET_BEARING_KEYS`, `TESTBOX_LEDGER_VALUE_MAX` (24), the presence words, the
  `TestboxSettingChange` type, `testboxLedgerValueOf` (a value through its key's shape), `testboxLedgerValueOfRow` (a box
  settings reader row) and `readTestboxLedgerChanges`, the one reader the writer, the store's read and the console's guard use.
- `shared/api.ts`: `TestboxEventRow.changes?`, absent from an older server and from a row with none.
- `server/src/coord/schema.ts`: migration 63 (62 went to D-8395, which merged first), `testbox_events.changes` (nullable) and `testbox_staged_changes`.
- `server/src/testboxAudit.ts`: `write` takes `changes` only on an `ok` settings row and only what the reader takes;
  `recent` reads them back through the reader; `stage` and `staged` hold a long act's changes by its id; any row with that
  act id drops them; `sweep` sweeps staged rows with the ledger.
- `server/src/testboxAdmin.ts`: `settings-fleet` records the verb's own answer (`before` and `settings`, the one reader's rows
  either side of the write); `settings-box` reads the status before the act for the old values, takes the new ones from the
  sent values through their shapes, and stages them by the act's id.
- `server/src/testboxLane.ts`: a `settings-box` end row that ended `ok` carries what was staged.
- `ccd/ccrc-testbox-admin`: `settings-fleet` answers `before`, the reader's rows before the write, in the shape of `settings`
  (`_tba_fleet_rows`, which both now use). An older verb sends none, and the old side then reads `unknown`.
- `pwa/src/fleet/`: the row guard reads `changes` through the shared reader (a list it refuses is dropped and the row still
  shown); the last act at every band, and each row of the wide band's ledger, list the changes under their line, one per
  line, wrapping.
- `pwa/src/screens/settings/settings.css`: the change list, and a floor on the connected card's state column (below).

## Tests

- `server/test/testbox-ledger-values.test.ts`: the value rules (a non-secret value through its shape, bounded; a
  secret-bearing key, a path or a list presence only, over all 47 keys), the stored-changes reader's refusals, the writer and
  reader over a real coord.db, staging, and the migration (one nullable column and one table; an older build's writer still
  writes).
- `server/test/testbox-admin-routes.test.ts`: a non-secret fleet change records old and new as parsed values (a value off its
  shape records `unknown`, never its text); an older verb's answer; a secret-bearing setting, a path or a list records presence
  only even when the verb sent the text; a refused change records nothing new (no values, nothing staged, a 400 writes no row);
  a box edit stages its old values from the status read before it.
- `server/test/testbox-admin-lane.test.ts`: an `ok` end row carries the staged changes once across a restart; a failed one
  records none and drops them; a row with nothing staged is as before; another long act never takes them.
- `server/test/testbox-admin-acts.test.ts`: the real verb answers `before` through the same reader as `settings`.
- `pwa/src/fleet/TestBoxManage.test.tsx` and `pwa/browser/testbox-manage.browser.test.ts`: the changes under the last act at
  every band and under the wide ledger's row; in Chrome at 360, 390, 1280, 1470 and 1920, both skins and both themes, the
  longest key and a value at the bound wrap inside the card with no sideways overflow.
- Pins: `coord-db.test.ts` (schema 63), `run-close-switch.test.ts` (its rewind drops the new table), `testbox-pins.test.ts`
  (two new readers of a test box key).

## Deviations found

- **The connected card's state column was 0px wide at the wide band.** The card sits beside the ledger there, so its main
  grid is narrow, and `minmax(0, 1fr) minmax(0, 28rem)` gave the controls all of it: the last act was already drawn one
  character per line, and the change lines made it thousands of pixels tall. The existing width test held only that the
  controls start after the state ends, which a 0px state passes. The state column now has a floor of `min(16rem, 100%)`, and
  the width test holds it at every laptop and wide width.
- **Old values come from two readers.** The fleet host's from the verb's own reader, inside the lock, either side of the
  write; the box's from the status snapshot (`testbox-box-settings.json`), which is refreshed after every act and at most
  every six hours, so a hand edit on the box since the last refresh is not seen as the old value.
- **The new value of a box edit is the sent value through its shape**, not a re-read: the act applies later, and a failed
  apply records no values at all.
