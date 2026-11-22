# Follow-up: one bad row no longer blinds a lane (cache-row-skip)

Programme `model-class-advance`, epic `anthropic-arm`, ticket `cache-row-skip`. Run 3357. Built on `main` with wave 3
(#3118), wave 8 (#3122) and the pins of #3216 and #3217 in it. This is wave 7's review finding F5.

## What changed

- **The catalogue cache is read row by row** (`parseCatalogueCache`, `shared/model-aliases.mjs`). Before, the first
  row that broke a field threw, and the whole file read as `invalid`. Then all four classes lost the cache as a source,
  and doctor said `alias-source-absent` for every one. Now:
  - a model row whose id is missing or is not a model id, whose `min_claude_code_version` is not a plain version (for
    example `2.1.300-beta`), or that is not an object, is left out of `rows`. Every other row reads as before. A row
    that is left out does not hide a later readable row with the same id;
  - a class whose `provider_alias_targets.<class>.default` is present but is not a model id gets a null target. Only
    that class loses the cache as a source. The other classes keep their targets.
- **The reading names what it skipped.** A current reading now carries `skipped`, a list of `{at, why}` in file order,
  targets first. `at` is the field that breaks, for example `models[3].min_claude_code_version` or
  `provider_alias_targets.opus.default`. `why` says what is wrong with it. The list is `[]` when nothing was skipped.
  The type is `CacheSkip`, in `shared/model-aliases.d.mts`.
- **These still make the whole file `invalid`**, because they are about the file and not one row: a file that is not
  an object, a missing or non-object `catalog.config`, a `fetchedAt` that is not a time, and a `models` field that is
  not a list.
- **Nothing new is written to disk.** The aliases file records the cache's reading as `cache: {fetchedAt, format}`,
  and this change adds no field to it. The skip list exists only in the reading in memory.
- **There is still one reader.** Nothing else parses Claude Code's catalogue cache. `deploy/models-anthropic.mjs` calls
  `parseCatalogueCache`, and `ccd/lib/model-aliases.sh` reads the aliases file, not the cache. Neither file changed.

## A target whose row was skipped

Such a target reads exactly as a target with no row does today. The class keeps the target as its cache candidate.
The row is looked up in the box's other caches, and if none of them has it, the class has `row: null` and
`rowFrom: null`. A target with no row names no minimum build, so the lane counts it as launchable on any build:
`unlaunchable` stays null. So a target whose own row carries a minimum this build cannot read, such as a beta version,
is treated as launchable. The resolver case for a beta minimum pins this: the class equals the same file with that row
deleted.

## Existing cases that changed

- In the cache tests, `invalid answers why` asserted whole-file `invalid` for four inputs that are now skips: a bad id
  row, a row with no id, a malformed opus target, and a minimum of `soon`. Those four moved to a new case that asserts
  a current reading and its exact skip entry, plus a row that is not an object. `invalid answers why` gained the
  file-level case for a `models` field that is not a list.
- The hand-built current readings in three test helpers gained `skipped: []` for the new required field: `at` in the
  cache tests, `cache` in the resolve tests and `example` in the aliases-file tests. No assertion changed in them.

## Measured

- **New cases.** In the cache tests: a clean file skips nothing; one bad id row among good ones; one beta minimum; a
  malformed target for one class; and a skipped row followed by a readable row with the same id. In the resolve tests,
  each of these is run against the real fixture: the other classes resolve from the cache exactly as with the clean
  file, deep-equal, and the skip list names the row.
- **Mutation rows**, each run alone in a `git archive` copy, never this worktree. The cache and resolve tests were run
  against each:
  - a bad row makes the whole file invalid again: red, 6 failing;
  - the skip list loses the row: red, 6 failing;
  - the skip list loses the row's reason: red, 6 failing;
  - a malformed target blinds every class: red, 3 failing.

  The unmutated copy is green.

## Carries (not this ticket)

- **Surfacing a skipped row.** Doctor and the models sheet do not show the skip list yet. A lane whose cache has a row
  this build cannot read gives no sign of it.
- **A skipped row's minimum build.** As said above, a target whose row was skipped counts as launchable on any build.
  If that matters, a later ticket could treat it as unlaunchable, or unobserved.

## Notes for the ledger

- No departure from the brief, and no new number.
