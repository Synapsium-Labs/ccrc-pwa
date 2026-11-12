# A lapsed claim reads as lapsed, not as never taken

- **D-8392 (2026-11-12)** — Public issue #145: the default `GET /api/claims?project=<p>` answer adds `recentlyLapsed` (the rows that lapsed within the last `CLAIM_LEASE_MS`, each `state:'lapsed'` with `endedAt` and `endedBy`) beside `claims`, which keeps meaning live rows only; `POST /api/claims`' 200 answer adds `lapsedSince: [{id, endedAt, endedBy}]` when the caller re-takes paths its OWN recently lapsed row held. No lapse mail, no new knob, no change to the lease or the 8 h hard cap.

## Why

The server renews a running holder's claims every tick, keeps a sleeping holder awake, and keeps a lapsed claim as a
row with `state:'lapsed'`, `endedAt` and `endedBy` (`expired`, `session-gone`, `hard-cap`). But the read the
coordinator skill's clause 10 tells a coordinator to make, `GET /api/claims?project=<p>`, returned only live
unexpired rows, so a claim that had just lapsed read exactly like a path nobody ever claimed. And a holder that
re-took its paths after a lapse got `renewed:false` and nothing else, so it never learned its claim had a gap in
which another session could have edited those paths.

## What changed

- `shared/api.ts`: `ClaimLapse` (`{id, endedAt, endedBy}`), `ClaimsListAnswer` (`claims`, optional
  `recentlyLapsed`) and `ClaimTakeAnswer` (the 200 fields, optional `lapsedSince`). The window is `CLAIM_LEASE_MS`,
  the existing lease constant.
- `server/src/coord/claims.ts` (L1): `lapseWindowStart(now)`, `recentlyLapsedClaims(rows, now)` and
  `ownLapsesUnder(rows, sessionId, paths, now)`. A `lapsed` row counts by its `endedAt`; a `live` row whose lease has
  run out before any sweep lapsed it is reported the way the sweep would word it (`hard-cap` when the hard cap ran
  out, `expired` otherwise), ended at its `expiresAt`, so it is never missing from both lists. Released and broken
  rows are not lapses. The overlap test is `pathsOverlap`, the conflict rule's containment.
- `server/src/coord/store.ts`: `lapsedClaimsSince(project, since, heldBy?)`, the bounded read of recent `lapsed`
  rows; `claimAttempt`'s ok arm carries `lapsedSince`, read inside the same transaction after the in-transaction
  expiry, so a lease that ran out unswept is already the lapse it is.
- `server/src/coord/routes.ts`: the default per-project `GET /api/claims` answers `recentlyLapsed`; the other arms
  are unchanged. `POST /api/claims`' 200 adds `lapsedSince` only when it is not empty.
- `ccrc-api claims list` prints the response body verbatim, so the new field and its `state:"lapsed"` rows reach the
  caller with no client change (pinned by a test that runs the client against a real server).
- Coordinator skill clause 10 now says a `recentlyLapsed` row on a path the wave uses is its holder's until it
  confirms (reworded to stay inside the skill's byte cap); `references/peer-protocol.md` describes both fields and
  what a worker does with `lapsedSince` (re-check what landed on those paths since `endedAt` before editing, and
  report the gap); `references/wave-lifecycle-run-care.md`'s route line names `recentlyLapsed`.

## Deviations found

- `recentlyLapsed` is on the per-project default answer only, the read clause 10 names. The no-project default
  (the PWA's whole-fleet HotFilesStrip read) and both `all=1` arms are unchanged, so no existing caller's answer
  changes.
- Clause 10 had to stay within the coordinator SKILL.md's byte cap (the skill-size ratchet allows growth only by a
  new clause), so its first sentence was tightened: "a worker never calls the allocator mid-wave" became "no worker
  calls the allocator", which the worker skill already states.
- `lapsedSince[].endedAt` is when the gap began, the lapsed row's `expiresAt`, not the stored `endedAt`. Every
  lapse fires at or after `expiresAt`, and a lease that ran out unswept is lapsed by the re-taking attempt itself
  with `endedAt = now`, so the stored value would have made the window to re-check read as zero, and a lease that
  ran out hours before a late sweep would have read as a fresh one. The `GET` rows keep the stored `endedAt` and
  carry `expiresAt` beside it.
- The worker SKILL.md is at its cap too, so the worker's instruction for `lapsedSince` lives in
  `references/peer-protocol.md`, which the worker skill already names as the long form of its claim calls.
