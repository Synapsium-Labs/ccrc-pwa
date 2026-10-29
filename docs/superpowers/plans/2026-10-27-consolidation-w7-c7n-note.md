# W7 C7n note: the departures the single readers took (2026-10-28)

Task C7n of `2026-10-27-consolidation-w7-pwa.md` (D-7192, D-7209; ARCH-75, #810, PR 5; spec K14), built from the plan
section. Each departure below is named by its slug, in this note, in the commit that took it where one did, and in the
PR body. This note allocates no number.

## slug cold-runs-reader-home

The plan says the cold runs go 2 -> 1 but does not name where the one reader lives. Both screens had their own
module-scope `() => api.runs(true)` default. The one reader is `pwa/src/screens/useColdRuns.ts#loadColdRuns`: the run
board's default, moved beside the hook both screens now read through, with its comment. `RunsScreen` and `MailScreen`
both default `loadRuns` to it, and each keeps its injectable `loadRuns` prop. The request is the same
`GET /api/runs?closed=1`. Taken in Step 4's commit.

## slug step-rows-own-file

Step 1's `refreshFeed()` rows and Step 2's `rereadOnTransitions` rows sit in a new file,
`pwa/test/w7-single-readers.test.tsx`, not in `stores.test.ts`. Open #1627 holds `stores.test.ts`, and a new file keeps
C7n line-disjoint from it. Each row is the plan's own: one request per call at limit 100, the default reader being
`api.feed(100)`, the answer merged with its dropped count and `'ok'`, `'error'` with nothing written, the connect-time
read and `refreshFeed()` sharing the reader, and for `useColdRuns` a fake-timer and transition row for the default,
for `true` and for `false`.

## slug durable-read-done-mark

The connect-time durable read used to mark itself done in the same turn its answer landed, before the merge.
`stores.test.ts`'s row "does not ask again on a later reconnect once the first read has already succeeded" depends on
that timing. The shared reader takes an optional `onAnswer` callback that runs first in the answer's own turn, so the
connect-time read's done mark lands in that same turn and the row is green unchanged. `refreshFeed()` passes none.
Taken in Step 1's commit.

## slug feed-seam-suites

The plan names `mail-screen.test.tsx` and `w7-mail-states.test.tsx` as the suites whose injected `loadFeed` becomes the
store's `fetchFeed`. `tap-targets.test.tsx` also mounted `MailScreen` with `loadFeed` (two rows), so it moves to the
same seam: its `makeStore` takes an optional `fetchFeed`. In `w7-mail-states.test.tsx` and `tap-targets.test.tsx`,
`makeStore(load)` creates the store with that reader. In `mail-screen.test.tsx`, where many rows create the store
before the loader they hand it, `withFeed(store, load)` names the reader of a store `makeStore()` made, and a store
with none reads `api.feed`. Only the mount lines and the helpers change. No `expect` changes in any of the three
(exception 1). Taken in Step 3's commit.

## slug project-spies-unchanged

The plan lists `new-session-sheet.test.tsx`, `new-session-name.test.tsx` and `lifecycle-ui.test.tsx` for re-pointing,
because each mocks a moved read. Each spies `api.projects` on the `api` object, and the one loader calls that member
when it is called, so every spy still sees the read and each suite is green unchanged. No suite mounts an open
`StartProgramSheet` without its `loadProjects` prop: `start-program.test.tsx` and `tap-targets.test.tsx` pass it, and
`RunsScreen`'s suites mount it closed. So no suite reaches the new default, and none is re-pointed. That keeps C7n off
`lifecycle-ui.test.tsx` and `start-program.test.tsx`, which open #1784 holds.

## slug runs-screen-test-untouched

The plan's re-point list names `runs-screen.test.tsx`. That suite is not edited: the shared-file queue lands other W7
tasks there first, and Step 2 keeps it unchanged. It spies `api.runs`, which `loadColdRuns` calls when it is called, so
its 140 rows are green unchanged, and its re-read rows are the ones that red when `rereadOnTransitions` defaults to
`false` (measured: three rows red).

## slug rename-test-import

Step 7 says the two renamed files keep their contents except the header's first line. The renamed test also changes
its import path (`../src/session/buildAndSpend`), since the module it imports moved. Its rows, including the rows it
holds for `fleet/sessionFacts.ts` (D-6714), are unchanged.

## slug single-readers-browser-row

Step 9 asks for the Inbox, the run board and the two sheets' project lists to be verified at every width and skin
through the browser tests. No browser case opened `/mail`, or either sheet's project list, with a request count. Step 9
adds `pwa/browser/single-readers.browser.test.ts`: phone 360 and 390, laptop 1280 and wide 1920, Refined and
Instrument, light and dark (16 views, two cases each). Each view holds the Inbox's "Loading…" while its read on open is
parked, "Nothing yet." once it lands empty, one feed and one runs request per open (a re-open asks again), the error
sentence when the feed read answers 503, the board's "No runs." with one `GET /api/runs?closed=1` on its mount, and
the Start programme and New session project lists, each drawn from one class-blind `GET /api/projects`. It is green
on the base tree and on the tip alike (32 of 32 each), so every cell of the per-width table reads 'unchanged'.
