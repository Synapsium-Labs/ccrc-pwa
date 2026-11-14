# A running holder's claim outlives the 8 h hard cap as a chain

- **D-8395 (2026-11-12)** — Operator ruling, option (a): a holder of a live claim that is measured RUNNING and re-takes the same or covered paths inside the last `CLAIM_LEASE_MS` before the hard cap gets a new row with a fresh lease and a fresh 8 h hard cap. The new row's `chainedFrom` (migration 62) names the old row, which ends `released` with `endedBy:'rechained'`. The 200 answer adds `rechained: [{from, to}]`, and `GET /api/claims?all=1` shows the chain. A holder that is not running keeps today's renewal and lapses at the cap. This amends D12's "no renewal moves the horizon" for this one case.

## Why

D12 made the hard cap (`CLAIM_HARD_CAP_MS`, 8 h) the one bound no renewal moves, so that doubt cannot hold a claim
forever. The guidance said a long program "re-declares its claim rather than holding it forever", but a re-declare
only renewed the lease, clipped at the same cap. A worker still busy after eight hours therefore lost its path
claims at the cap without being told, and its paths read as free to every peer.

## What changed

- `server/src/coord/claims.ts` (L1): `claimLivenessProbe(sessions, refused)` is the holder reading that
  `FleetWatcher.claimProbe` used to hold inline. It is moved unchanged, and the watcher's renew and lapse lanes now
  call it. `rechainDue(row, now, verdict)` and `rechainTargets(own, paths, now, verdict)` decide the re-chain, and
  `heldWithin` says whether a requested path rides a re-chained row.
- `server/src/coord/schema.ts`: migration 62, `ALTER TABLE claims ADD COLUMN chainedFrom INTEGER`.
- `server/src/coord/store.ts`: `claimAttempt` takes `callerLiveness`. For each own live claim `rechainTargets`
  admits, it releases the old row with `endedBy 'rechained'`, clearing the mirror bit in the same transaction, then
  inserts a new row with the old row's whole path set, a fresh lease and a fresh hard cap, and `chainedFrom`. Requested
  paths that equal or lie inside a re-chained row's paths ride that row. Every other path keeps the existing renew or
  fresh-row logic. The ok arm carries `rechained`. `ClaimSummary` rows carry `chainedFrom`.
- `server/src/coord/routes.ts`: `POST /api/claims` measures the caller only when it holds such a claim on the asked
  paths, through one memoized fleet read (`measureFleet`) that the conflict arm now shares. That keeps one registry
  read per request. An unlistable registry is doubt, and doubt never re-chains. The 200 adds `rechained` only when
  it is not empty, and `renewed` is true for a re-chain.
- `shared/api.ts`: `ClaimSummary.chainedFrom`, `ClaimRechain`, `ClaimTakeAnswer.rechained`, and the closed end word
  `CLAIM_RECHAIN_ENDS` / `ClaimRechainEnd` / `isClaimRechainEnd`. The `CLAIM_HARD_CAP_MS` docstring records the
  amendment.
- D12 amendment noted in the Build 9 design spec, the README's claims paragraph and `shared/api.ts`.
  `references/peer-protocol.md` tells a worker to re-take its paths before the hard cap when it is still busy, and
  explains how a coordinator reads a chain in `?all=1`.

## Deviations found

- The re-chain fires only inside the last `CLAIM_LEASE_MS` before the cap. That is the point from which a plain
  renewal is clipped by the cap. Earlier, a renewal already gives a full lease, so a running holder's re-take renews
  in place, as it did before, and a worker writing its intent every ten minutes does not leave 48 chain rows per
  window.
- Only a measured `running` verdict re-chains. Doubt (`unmeasurable`) still renews the lease on the watcher's tick,
  but it never moves the cap, which keeps D12's "doubt cannot hold forever".
- The old row ends in the existing `released` state, not a fifth state. `CLAIM_STATES` stays the four stored words,
  and the end is told apart by `endedBy:'rechained'` (a closed word with its own guard). It is a single word, so the
  mail-routes kebab census never sees it.
- The coordinator and worker `SKILL.md` files are at their byte caps, so the worker guidance is in
  `references/peer-protocol.md`, the long form the worker skill's clause 11 points to (the D-8392 precedent).
- The hibernation census counts `LivenessVerdict` readers. The claims, routes and store rows record the new
  readers, and each is held awake: a caller posting a claim is awake.
