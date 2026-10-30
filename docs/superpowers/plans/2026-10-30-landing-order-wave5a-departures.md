# Landing order wave 5a: five departures from its plan and its claims, recorded

- **D-7544 (2026-10-30)** — `vocab-case-census-not-pin` (Task 2): the `ProjectEvidence` case in
  `server/test/single-definition/vocabularies.test.ts` is a census over every scanned file. It expects
  `server/src/registry.ts` to be the one file that carries the derived `ProjectEvidence` line. The plan asked for a
  literal `toMatch` on `registry.ts`.
- **D-7545 (2026-10-30)** — `ccd-path-spelled-once` (Task 4): the retire-verdicts fixture writes its launcher at
  `path.join(repo, path.relative(ROOT, CCD))`, and `baseCcd` reads it through the same expression. The brief spelled it
  `path.join(repo, 'ccd', 'ccd')`.
- **D-7546 (2026-10-30)** — `read-5-lists-the-latest-run` (review 1232, M1): §5b's read 5 asks GitHub's
  `commits/{ref}/check-runs` with no `filter`, and its default, `latest`, lists only the newest run of each name. So
  the verdict's strict rule decides over the latest run of each name. A required name that failed and was then rerun
  green reads green. This amends the reading of D-7536 and of §5b's stop paragraph, and the verdict block is unchanged.
- **D-7547 (2026-10-30)** — `project-evidence-holds-for-an-io-failure` (review 1232, F1): D-7532 and the plan's Review
  Focus 1 hold for an io failure only. The server and the radar read `.project` by different rules, so four shapes the
  radar holds can still read as `measured` or `absent` on the server, and a landing can then read cleaner.
- **D-7548 (2026-10-30)** — `chip-drops-four` (review 1232, F2 and F3): the chip's sentence drops four things, not
  three: the plan's three and the path-cut note of a dropped conflict line. Its "under 5,000 characters" holds for one
  measured fleet, not as a bound.

**D-7544.** The plan's literal pin would have raised `advance-switches`' D-6114 ratchet row for `registry.ts` from 2
to 3, and that row may only shrink. Review 1232 measured it: with the literal pin, `advance-switches` is red and
`vocabularies` is green. The census goes red under the plan's mutant T2-16, so the guard is no weaker.

**D-7545.** The brief's literal spelling reds `core-vocab`'s check that one file spells the path to the `ccd` script.
Review 1232 measured that red. The shipped spelling keeps that check green and names the same file.

**D-7546.** Review 1232 measured it on one head of this repository. The `server 11/12` shard, and the `test (server)`
summary with it, failed on its workflow run's first attempt and passed on the second. Read 5 lists 43 runs there and no failure. The same read with
`filter=all` lists 83 runs and two failures. The verdict block's own `jq` arm prints `red` when it is handed both runs,
so the new row in `coordinator-landing-verdict.test.ts` pins the arm, not what live GitHub sends it.

Two answers are open, and each decides what clears a red, so both are the operator's:
- **Add `filter=all` to read 5.** The gate would then hold the rule the text states. A flake cleared by a rerun could
  then never land without a new head.
- **Restate the stop paragraph** as the rule over the latest run of each name. That is the gate every landing so far
  has used.

Until the operator answers, the coordinator reads each head with `filter=all` as well, read-only and outside the block.
It reports a required name that failed on any attempt before the enqueue.

**D-7547.** The radar reads `.project` with `O_NOFOLLOW`, as one line of UTF-8 of at most 4096 bytes, and holds any
row whose file fails that read: its head gets `id: null`. The server's reader follows symlinks, trims, and decodes
leniently. Review 1232 measured four shapes with the shipped probe in a fixture HOME:
- a second line;
- bytes that are not UTF-8;
- a dangling symlink;
- a symlink to another project's file.

In each, the radar held the row while the server recorded `measured` or `absent`. The other sessions' landings then
read `cut.unbound = false`. Review 1232 found that each shape needs a corrupt or hand-made registry file (`ccd`'s
writer refuses symlinks). The
server read `.project` the same way before this wave, so D-7532 narrows the gap and does not open it. Carried to the
next wave that edits `registry.ts` or `radar.ts`: the server's reader takes the radar's rule.

**D-7548.** These are the four things dropped:
- conflict lines past `CHIP_LINES_MAX`;
- the path-cut note of such a dropped line, " (more paths not recorded)", which is part of its line, so the header's
  "A cut is never dropped" does not hold for it;
- paths past `CHIP_PATHS_MAX` on one line;
- PRs past `CHIP_PATHS_MAX` in a clause, "not measured" or "not paired".

The chip's word stays `conflict`, and "and N more" counts the dropped lines, so no reading reads fuller than it is.
A dropped line's path cut does not set `partial`, because that line is already a conflict.

Review 1232 measured sentences of 5,228 to 7,455 characters, and 6,083 with three 2,000-character paths, because
`CHIP_PATHS_MAX` bounds how many paths a line names, not how long each one is. On the live wire the server cuts each
path at `RADAR_PATH_MAX` (300), so the real worst case is under 10,000. Carried: the header of `conflictWords.ts` and
the bound the plan states are restated, or the PWA reader gains a bound on each path.

The plan is not edited, because merged plans are append-only. This file is the record, and the programme ledger
folds it in (Decisions, 2026-10-30 08:16).
