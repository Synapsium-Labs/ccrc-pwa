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
- **The reading names what it skipped.** Each `skipped` entry carries `at` (the bad field) and `why` (the reason).
  A skipped row also carries its normalized `rowId` if valid, or `rowId: null` if the row or its id was unreadable.
  A malformed target or a rejected string id cannot hide a valid target's row, so neither carries `rowId`. These
  are in-memory readings only.
- **These still make the whole file `invalid`**, because they are about the file and not one row: a file that is not
  an object, a missing or non-object `catalog.config`, or a current-format file with an unreadable `fetchedAt` or
  a `models` field that is not a list. Older-format readings still cannot supply a target.
- **Nothing new is written to disk.** The aliases file records the cache's reading as `cache: {fetchedAt, format}`,
  and this change adds no field to it. The skip list exists only in the reading in memory.
- **There is still one reader.** Nothing else parses Claude Code's catalogue cache. `deploy/models-anthropic.mjs` calls
  `parseCatalogueCache`, and `ccd/lib/model-aliases.sh` reads the aliases file, not the cache. Neither file changed.

## A target whose row was skipped

A skipped row may hide a minimum build; it is not evidence that no minimum exists. If the file naming the target has
no readable row for it, a skip for that id removes the class's cache candidate. If the skipped row's id could not be
read, the same rule applies to every target without a readable row in that file. The class still uses its prior or
launch evidence when available. With no such evidence it remains unobserved. Other classes keep their readings.

If the file naming the alias genuinely lacks a row, the resolver still looks for a readable row in other caches.
One skipped row there does not stop the resolver using a readable row from another cache and checking its minimum.
If no readable row exists and a skip may have hidden it, there is no cache candidate. A genuinely absent row with
no relevant skip still has no minimum, as before.

## Existing cases that changed

- In the cache tests, `invalid answers why` asserted whole-file `invalid` for four inputs that are now skips: a bad id
  row, a row with no id, a malformed opus target, and a minimum of `soon`. Those four moved to a new case that asserts
  a current reading and its exact skip entry, plus a row that is not an object. `invalid answers why` gained the
  file-level case for a `models` field that is not a list.
- The hand-built current readings in three test helpers gained `skipped: []` for the new required field: `at` in the
  cache tests, `cache` in the resolve tests and `example` in the aliases-file tests. No assertion changed in them.

- Fix round 1 changed the resolver case “one beta minimum on a target row”: it now asserts that the class loses
  its cache candidate rather than treating the target as launchable. Cache assertions now pin the normalized id on
  a version skip and `rowId: null` when the id cannot be read.

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
- **Fix round 1.** The resolver cases cover prior and launch evidence, an unreadable id beside both absent and
  readable target rows, and a box cache that has a skipped target row alongside another box cache with a readable
  one. Three independent mutations in an archive copy each failed their targeted assertion: omitting the skipped
  row's id, accepting a target despite a skipped row, and ignoring unreadable ids. Each unmutated case passed.

## Carries (not this ticket)

- **Surfacing a skipped row.** Doctor and the models sheet do not show the skip list yet. A lane whose cache has a row
  this build cannot read gives no sign of it.

## Notes for the ledger

- Fix round 1 corrects the initial brief: a skipped row is not equivalent to an absent row. No new deviation number.
