# Graphify r2 Task GR5: the read side — task note

The per-task note for Task GR5 of `2026-10-29-graphify-r2-shared-graphs.md` (D-7351). That plan's header says workers
do not edit it or its §Deviations found, so a departure is defined in a new file. This note holds GR5's two
departures, D-7556 and D-7557, and the hand-off the first one leaves to a later task, so that the obligation is in the
tree rather than only in a PR body. Both numbers are defined in `2026-10-30-graphify-r2-gr5-ruled.md`.

## Departures from the plan's text

- **The old-shape census is still read until the sweep's rewrite (D-7556).** The plan asks GR5 to
  take the `trees[]` readers in `ccd/session-hook.sh` from 1 to 0, and to re-point the two `trees[]` fixture rows in
  `server/test/session-hook.test.ts` (the sweep-writer driver beside the card describe, and the hand-written row in the
  "cwd does not exist" test) to `repos[]`. Measured on GR5's base, that cannot hold together with "GR1's pins green and
  unchanged" and "no test weakened":
  1. Nothing writes `repos[]` until GR4 rewrites the sweep; `_gs_finish` still writes `trees`.
  2. GR1's pin (c) and the two `session-hook.test.ts` rows build their census with the sweep's own writer (D-1337). A
     hook that reads only `repos[]` turns all three red, and re-pointing them now means either a hand-written
     `repos[]` shape, which drops the writer coupling D-1337 exists for, or a writer that does not exist yet.
  3. GR5 lands before GR4 (plan §Landing order), so a tree the old sweep refused would lose its reason from the card
     until GR4 deployed.

  So the hook's no-graph arm reads by repository (`source`) when the last pass holds `repos`, and otherwise reads the
  old row by `path`. The `trees[]` count in the hook stays at 1, and in `session-hook.test.ts` at 2, both inside GR1's
  may-only-shrink ceilings.

  **Hand-off (owned by GR4, in the commit that switches the sweep's writer to `repos[]`):**
  - delete the `trees` branch from the hook's no-graph jq, so the hook reads `repos[]` only;
  - re-point GR1's pin (c) in `server/test/session-hook-graph-pins.test.ts` and the two `trees[]` rows in
    `server/test/session-hook.test.ts` to the new writer's output;
  - lower `TREES_CEILING['ccd/session-hook.sh']` and `TREES_CEILING['server/test/session-hook.test.ts']` in
    `server/test/graph-r2-consumers.test.ts` to 0 (removing both keys);
  - re-point the hand-written `repos[]` census rows in `server/test/session-hook-graph-repo.test.ts` to that writer.

  The plan's Hot files list makes `ccd/session-hook.sh` GR5's only, so the fold needs to lift that fence for GR4's one
  jq-branch deletion and add the files above to GR4's Files. Until GR4's writer emits `repos[]`, the old branch is the
  only one that can match; after it, the old branch can never match again, which is why deleting it there is safe.

- **The linked tree's diff list has a character bound as well as a count (D-7557).** The plan
  bounds the card's list of differing files by `card_diff_list_max` (a count, default 20). The standing subjects
  (graphify, then hold or role, then co-tenant) share one `CARD_MAX_CHARS` clip at the emitter and graphify is joined
  first, so 20 real repository paths of about 65 characters made the graph card about 2150 characters, and the clip
  cut held case A mid-sentence. GR5 adds `CARD_DIFF_LIST_MAX_CHARS` to the hook, derived as `CARD_MAX_CHARS` minus the
  linked sentence's structural worst case with no names (903) and held case A plus co-tenant plus the two joins (1107,
  as D-1903 argued): 390 characters of names. The list stops before the first name that would pass it, so the
  branch's own files still come first and "and N more" counts every name not said. It is a card bound beside
  `CARD_MAX_CHARS`, not a deployment setting, for the same reason `CARD_MAX_CHARS` is not one: it is derived from the
  other subjects' sentences in the same file. A row in `server/test/session-hook-graph-repo.test.ts` runs 20 long
  branch paths beside held case A (a 127-character hold naming a run, a 127-character workdir, a 40-character id) and
  a 64-character project at a two-digit co-tenant count, and asserts each subject's whole sentence reaches the
  session; it is red on the PR's head before the bound.

**Mutations (each a scratch edit, then reverted).**

| Mutation | Row that reds |
|---|---|
| the list's character check is deleted (count bound only) | 20 long branch paths, held case A and a two-digit co-tenant |
| the list skips a long name and goes on to a shorter one | the same row (the branch's first path is no longer named first) |
