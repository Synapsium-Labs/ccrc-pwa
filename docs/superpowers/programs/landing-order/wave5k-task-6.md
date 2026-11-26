# Wave 5k, Task 6: the hook (D-9108)

`pwa/src/fleet/useLandingLines.ts` (L4, C5), with `pwa/test/use-landing-lines.test.tsx`, and its C5 row.

- One `usePoll` at `LANDING_LINE_POLL_MS = 60_000`. Its request:
  - reads the current projects, de-duplicated and sorted;
  - records their key before its first `await` (section 11);
  - starts each read as `Promise.resolve().then(() => read(p, signal))`;
  - resolves with a `Map` of one `PollOutcome` per project, and never rejects.
- `onOutcome` keeps each project's previous state object when `sameLandingState` says it is unchanged, and keeps the
  whole `Map` when no project changed.
- The project-set effect is declared after the `usePoll` call and reloads once when the sorted key differs from the
  key the last request read (R4).
- `reload` is a `useCallback` over the poll's own `reload`, stable for the hook's life.

## The request's raw is pinned directly

The case that pins the request's raw wraps the real `usePoll` in a pass-through mock, which records each raw it lands,
and asserts that raw is a `Map` with one outcome per project, in sorted order.

## Runs

`use-landing-lines` (11), the pwa typecheck, and from `server/` `rings/pwa-one-owner` (42), `census-w7/pwa` (55) and
`rings/totality` (11): green.
