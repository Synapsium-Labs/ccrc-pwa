# History: the FTS5 merge steps fold once, and never past a merge in progress

- **D-8726 (2026-11-17)** — history-fts-fold-once: mergeSteps folds an FTS5 index only when no merge is in progress, and drains without folding near the 2000-segment limit; the doctor reports segment counts.

## What failed

A long-lived store reached FTS5's 2000-segment limit (`FTS5_MAX_SEGMENT`); every pass then failed with SQLITE_FULL
("database or disk is full", errcode 13) at the COMMIT of any transaction that flushed FTS pending data.

## Root cause

`mergeSteps` (`ccd/history/sweep.mjs`) ran `INSERT INTO blobs_fts(blobs_fts, rank) VALUES('merge', -64)` (and the same on
`nodes_fts`) at the start of every pass. A NEGATIVE merge calls FTS5's `fts5IndexOptimizeStruct`, which, whenever the
structure is not already "optimal" (every segment on one level, or every segment but one an input of that level's merge),
builds a new structure with every segment on one level and nMerge 0. That discards the merge in progress (its partial output
becomes one more input) and starts another, which takes a new segment id. Writer commits between passes add level-0
segments, so every pass refolded; the merge of a multi-GB index never finished, its inputs were never deleted, and the count
grew by the new level-0 segments plus one on every pass. The measured signature: 65 levels, about 1990 segments all merging
on one level and the output alone on the level above. `history-fts-fold.test.ts`'s characterization case pins the same
FTS5 behaviour on this interpreter's node:sqlite build.

## The fix

- `ccd/history/fts-structure.mjs` (new, L1): `parseFtsStructure` reads the structure record (row id 10 of `<table>_data`,
  V1 and the contentless_delete V2 form) and `decideFtsMerge` answers the next merge's rank: `continue` (+64) while any
  level has a merge in progress, `drain` (+64) from `FTS_SEGMENTS_DRAIN` (1500) segments up or when the record cannot be
  read, `fold` (-64) otherwise. A positive merge continues the merge in progress into the output segment it already has
  and takes no segment id; a fold still runs once no merge is in progress, so §6.2's purge guarantee (O47) holds: a
  positive merge alone never rewrites a small deletion in a big segment (below deletemerge's 10%).
- `store.mjs`: `ftsStructureOn` (never throws) and `ftsSegmentsOn` (status's reading), over `FTS_STRUCTURE_SQL`.
- `mergeSteps` reads the structure inside each merge's own transaction; the done rule (a `total_changes()` delta under 2
  for both tables) and the run budget are unchanged.
- Health: `status` reads both indexes' segment counts; `deriveHealth` WARNs `fts-segments-high` from 500 and FAILs
  `fts-segments-near-limit` from 1500, one line per index.

## Deviations found

- The repair hint names `ccrc history doctor --repair` (it drops and rebuilds both indexes whole; dropping an index needs
  no new segment id), not a positive-merge drain under `history-off`: no operator door runs a merge drain, and
  `--repair` is refused under `history-off` (only the binding verbs pass it). Below the limit the scheduled pass drains by
  itself, so the FAIL's remedy reads "none needed while the count falls" first.
- The structure reader is a module of its own rather than more lines in `lib.mjs` or `sweep.mjs`, both of which are on the
  growth check's per-PR limit. It needs no manifest entry: the shim runs `sweep.mjs` from the placed tree, beside its imports. `history-lib.test.ts`'s ring table gains its row (L1, importing only `lib.mjs`), and the CI floor list gains `history-fts-fold.test.ts`.
