# W7 C7j: the session fixture's archived rung, and the pins it reaches

- **D-7468 (2026-10-29)** — W7 C7j: the PWA session fixture derives the archived rung; the header archived-chip pin scopes to the chip; the Archive focus walk's rows carry the archived bucket.

**D-7468.** Task C7j of `docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md` (D-7188) moves the 8 "is it archived" sites from an absence check on `archivedAt` to `shared/api.ts#isArchivedRow`, which reads the server's bucket (archived or cleanup; OA-C15 (a), D-7265). The plan names `pwa/test/fleetFixture.ts` for C7j ("bucket, if a fixture needs it"). The build measured that it does: 37 tests in 9 PWA suites built an archived row by passing only `archivedAt`, so the row kept the fixture's default bucket (`idle`) and often its default live status. No server sends that row. Read by the bucket, those tests would describe a different row from the one they name.

1. **`pwa/test/fleetFixture.ts#fleetSession` derives the archived rung**, the way it already derives `presence` (D-7181). A caller that passes `archivedAt` and no `bucket` gets the bucket `sessionBucket` gives an archived row: `archived`, or `cleanup` when the PR merged. A caller that also names no `status` gets the pane `ws-archive` leaves, gone (`status` dead, under `DEAD_LIFECYCLE` unless it names its own lifecycle). A caller that names a live `status` keeps it and its bucket. That is the archived row with a live pane, class (i), which no bucket files archived. A caller that names a `bucket` is never changed.
2. **`pwa/test/header.test.tsx`, "says just "archived" when the PR number is not known".** With the row the server sends, the status chip also reads "archived". The pin now finds the archived chip by its class (`chip--archived`) and asserts there is exactly one with the text "archived". It is no looser: a chip with any other text, or two archived chips, still reds.
3. **`pwa/browser/page-head-focus.browser.test.ts`, the Archive screen's 30 rows.** Its hand-written archived row (pane gone, `archivedAt` set) carried `bucket: 'dead'`, where the server files that row `archived`. The row now carries `bucket: 'archived'`, so the Archive screen still lists the 30 rows the focus walk steps through. Every assertion is unchanged.

All three land in one test-only commit before the behaviour commit. The whole PWA suite is green there on the old sites (364 files). No other assertion changes, and none is dropped or loosened.

The plan file is not edited, because merged plans are append-only. This note is the record.
