# Updates: the sweep key on the wire, and three follow-up rows

- **D-8386 (2026-11-12)** — `update-sweep-on-the-wire`: `GET /api/updates` reads `update.json`'s `sweep` key through one reader (`sweepFrom`, `server/src/update/inventory.ts`), stores it in `nodes.reportedSweep` (migration 61) and sends it as the node report's optional `sweep`, where an absent or malformed key is not measured; Settings › Updates shows it as one line on the node row; with it, a whole-line pin and four silent rows for `ccrc update`'s skewed warning, and the R44 row for a file name holding a space or a newline in `release-artifact.test.ts`.

Refs #2083 (the centralised-update programme's carried residue: R37, R44's last item and review 1326's F6, in
`docs/superpowers/programs/centralised-update-management.md`).

## Why

- **R37.** `ccrc update` records what its supervisor sweep did as `update.json`'s `sweep` key (wave 17, D-5314,
  D-5315): `ok`, `down: <n>: <ids>`, `refused: <why>`, `unverified: relist`, `died: sweep` or the watchdog's
  `died: abandoned`. The server's report reader read keys by name and skipped this one, so only `ccrc doctor` and the
  run's own output ever showed it.
- **F6 (review 1326).** `_upd_fleet_warn`'s skewed clause had one row (`ccrc-update-fetch.test.ts`), which matches a
  fragment of the line. Nothing held the whole line, or that the other build words stay silent.
- **R44.** The verify file-set check joins names with spaces, so one file whose name holds a space or a newline
  between the two expected names passes it, and the regular-file check is what refuses it. No row planted that shape.

## What changes

- `shared/api.ts`: `UpdateSweepHead`, its map, `UPDATE_SWEEP_MAX` (200, the writer's cut) and `isUpdateSweepWord`;
  `NodeReportWire.sweep?: string`.
- `server/src/update/inventory.ts`: `sweepFrom`, used by `reportFrom` (printable ASCII, cut to 200, then the guard).
  The phase table does not read it: `sameReport` and the lease plan are unchanged.
- `server/src/coord/schema.ts`: migration 61, `ALTER TABLE nodes ADD COLUMN reportedSweep TEXT`, in the report group.
  `server/src/coord/store.ts` writes it in `upsertNodeMeasurement` and reads it back through the guard.
- `server/src/update/routes.ts`: `toNodeWire` sends `report.sweep` only when the row holds one.
- `pwa/src/screens/updates.tsx`: `sweepLine`, one `settings-node-detail` line ("Supervisor sweep: …") on the node row,
  shown only when measured.
- `deploy/release-artifact.sh`: two comments credit the file-set and regular-file checks together.
- `ccd/ccrc`: `_upd_phase`'s comment on the `sweep` key names the server's reader. No code changes in `ccd/ccrc`.

## Tests

- `server/test/update-inventory.test.ts`: `reportFrom` reads the key (every word shape), returns null for an absent
  key and for eleven malformed values, bounds it, and the sweep reaches the row and is cleared by a later report
  without it.
- `server/test/update-store-nodes.test.ts`, `update-routes.test.ts`: the column round-trips, a stored non-word reads
  null, and the wire field is present only when measured.
- `server/test/update-writer-groups.test.ts`, `coord-db.test.ts`: `reportedSweep` joins the report group; the
  schema stands at 61.
- `server/test/ccrc-update-fetch.test.ts`: the skewed WARN is exactly one line; `agreed`, `unknown`, an absent build
  and an unknown word print none. Red under a mutant that warns on anything but `agreed`.
- `server/test/release-artifact.test.ts`: W26-V14, a space and a newline. Red with the regular-file check removed.
- `pwa/test/update-sweep-line.test.tsx` (jsdom) and `pwa/browser/update-sweep-line.browser.test.ts` (Chrome): the
  longest `down` record wraps inside its node row with no sideways overflow at 390, 1280 and 1920, in both skins.

## Deviations found

- The two `pwa/test/build-line.test.tsx` comments (near :7 and :258) that #2083 listed were already corrected by
  #2308 (D-8017's slice, 2026-11-05): both now say #2079 retired the field from the wire. Nothing to change.
- F6's skewed WARN already had a row that greps a fragment of the line. This change adds the whole-line row and the
  silent rows, not a first row.
