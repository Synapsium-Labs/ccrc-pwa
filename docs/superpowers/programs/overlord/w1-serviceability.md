# Overlord W1 serviceability, PR B: what the ledger should learn

Run 3296, worker `ccrc-pwa-overlord-w1-svc-b`, plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability.md`
Tasks 4 to 7, with the W1 index's row "Serviceability and limits" (B adds the runway read `GET /api/pools/runway`). Built
against `main` at `b33a9ae137`. The coordinator mints the numbers; each departure is named by its slug.

## What shipped

- `shared/loadLines.ts` (L0): the three lines (70, 85, 95), `LOAD_FRESH_S`, the sampler's beat and keep, the runway's fit
  bounds, and the wire words: `Crossing`, `EarliestReset`, `PoolRunwayAnswer`, `LineState` and `PoolRunwayWire`.
- `server/src/poolRunway.ts` (L1): `windowCrossing`, `accountCrossing`, `poolCrossing`, `earliestReset`, `poolRunway`, and the
  read's two helpers `runwayPools` and `runwayByPool`.
- `server/src/accountLoad.ts` (L1): `overlordLoadCandidates`, `loadLines`, `classUnservableReading`,
  `accountLoadMoveReading`, the ladder's `loadLineReading` and `loadFactsOf`.
- `limit_samples` (migration 121) behind `server/src/coord/limitSamplesStore.ts` (L3), with three `CoordStore` delegates.
- `server/src/limitSampler.ts`: the pass, run by the new `limitSamples` lane row every five minutes over the listed tick's own
  reading.
- `GET /api/pools/runway` in `server/src/poolRunwayRoute.ts` (L4): each pool's `PoolRunwayAnswer`, masked.
- The ladder's `load-past-95` row and its input.

## Departures, by slug

- **`ts-mutants-ride-mutant-sets`.** The plan says mutants are built with `mutation-run.py`. That helper runs Python modules
  only, so the TypeScript deciders' mutants are `MUTANT_SETS` entries (`server/test/sim/accountLoadSets.ts`), which
  `mutate.ts` builds in a temp directory it removes. 24 mutants, all killed. Two candidate mutants are equivalent and are not
  listed (one sample spans 0 s, so `current.length < 2` alone changes nothing; a 0 rate projects to Infinity, past every reset).
- **`an-unmeasured-window-voids-a-future-crossing`.** The plan's account rule says "the earlier window's `at`". A window that
  could not be projected might cross sooner than the other's future `at`, so a future `at` beside an unmeasured window reads
  `unmeasured`; an `at` already past stands. This is the plan's own "under needs proof" rule applied to a projection.
- **`one-window-proves-past`.** A load line reads `past` from the larger of a candidate's read, unrolled windows even when the
  other window is unread, because one known window bounds `max(five, seven)` from below. "Under" still needs `measured()`
  (both windows) on a fresh reading. This keeps F1 true for an account at the ceiling whose five-hour figure is unread.
- **`load-lines-read-no-share`.** The ladder's input is synchronous and the Fable share is an async file read, so the facts the
  lines read carry no share. No line can read differently: a share decides only Fable's answer, and Fable serves where `opus`
  does not only when the seven-day figure is at the ceiling (98, past every line) or unread (no fresh load, so no "under").
- **`runway-read-lists-enabled-anthropic-accounts-by-pool`.** The home plan's question 6 names the read but not its accounts. It
  counts every enabled Anthropic roster account (the only accounts sampled, F14) by its resolved pool, an account in two pools
  in each, untagged accounts under `pool: null`. An account whose pool is undecidable (`malformed`, `unreadable`, `stale`) is in
  no pool, never folded into `null`. Samples are read back over the weekly window (`RUNWAY_READ_S`), past which every reading
  has rolled over. A read that throws answers 503, never an empty list.
- **`sampler-store-is-its-own-port`.** Task 5 names `WatcherCoordMember` for the sampler's two store members. The store reaches
  the watcher as its own optional deps port, `deps.limitSamples` (the forecast lane's shape), so `coord/ports.ts` and the store
  port census do not move.

## Notes for the ledger

- The `soft` line's pin against ccd's `FRESH_PICK_SOFT_PCT` lands here: the ccd arms' C1 is on `main`.
- `LOAD_FRESH_S` (3,600 s) is pinned greater than the keepalive's default window plus its timer, both harvested from the tree.
- The 95% row's notice is `none`. An unmeasured line caps at `chat` by the ladder's rule (F3), and nobody designated lifts it.
- Behaviour at merge: the sampler writes rows every five minutes, at most one per Anthropic account per reading; nothing reads
  them but the runway read; the 95% row reads `lifted` until an Overlord exists.
- Spec fixes for the spec-fixes run (from the plan, unchanged): Table 11.5b's 95% row and `LOAD_FRESH_S`; §6.8's "caps no rung",
  which the ladder's rule overrides for the 95% row.
