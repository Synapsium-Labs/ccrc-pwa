# Program: public-tree-scrub

Spec: none (the operator's public-repos rule, 2026-10-12, and the ruling of 2026-10-15 ordering this clean-up)
Plan: `docs/superpowers/plans/2026-10-15-public-tree-private-name-scrub.md`
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-quiet-ridge`   Workspace: a fresh child (one PR)
**Status: wave 1 of 1 landed 2026-10-20** (run 561, #722). What remains is owed outside a wave, below.

**What this program is.** This repository is public. Its tree still carries private names from before the
2026-10-12 rule: other projects, lane and account ids, hosts, people, tracker ids and a few commercial passages.
They sit in about 290 files at `518789ad0`, almost all in historical docs and test fixtures, and in comments in
shipped code. One PR sweeps them out line-neutrally and adds a hashed ratchet class so they cannot return.

## Waves

| # | scope | deploy class | PRs | state |
|---|---|---|---|---|
| 1 | Plan Tasks 1-7: the hashed class red-first, the sweep to green | none (tests, comments, docs) | #722 | run 561, landed 2026-10-20 as `b2c17f859` |

## Decisions & deviations

- The token list and its stand-ins are LOCAL ONLY: in the clone's git common directory (`info/ccrc-private-names`,
  with the inventory in `info/ccrc-scrub/`). They are never committed, mailed or logged, and no tool prints a
  matched token.
- Inventory (2026-10-15): eight read-only agents over `origin/main`, then a completeness critic. The plan then had
  three Opus lenses with two Sonnet refuters per finding; 38 findings survived and were folded into the plan
  (two-stage matcher, `part` mode for compound ids, removal of the two literal-list classes, net-diff range
  semantics, hashes committed only for names already public in history).
- Done by the coordinator on 2026-10-15: three merged PR descriptions that named a private repository were edited
  through the REST API. GitHub keeps their old revisions until the operator removes them in the UI.
- The plan's Decisions table holds the defaults the operator may overrule.
- 2026-10-17: the operator approved the plan as written, so every default in its Decisions table stands. Wave 1 opened
  as run 561, with a block of twelve departure numbers issued at run-open. The allocator holds the block, and a
  number appears here only once the plan defines it: a tracked mention of a number not yet defined raises the
  ledger floor (`deviation-refs.test.ts`).
- **2026-10-20 — wave 1 landed.** #722 merged at 13:59Z as `b2c17f859`, at `ff12710a2`, after eleven merges of
  `main`. Every ruling below is the coordinator's.
  - Four reviews read it, and the coordinator ruled on each:
    - review 662: 19 findings, 4 important and 15 minor;
    - review 673, of fix round 1: 8 findings, 1 important and 7 minor;
    - review 684, of fix round 2: 3 minor findings confirmed, 5 refuted;
    - review 695, of fix round 3 (which also carried a land-sync): two known limits stated too narrowly or not at
      all, and a note that `main` had moved. Its rulings were applied before the merge: both limits are stated in
      D-5287 and in the PR body.
  - Departures: D-5277, D-5278, D-5279, D-5280, D-5281, D-5282, D-5283, D-5284, D-5285, D-5286, D-5287 and D-5288,
    each defined in the plan's `## Deviations found`. Run 561's block of twelve is used whole: D-5287 and D-5288, the
    two still unused at fix round 1, were taken in that round.
  - Known limits, not fixed by this PR:
    - the check for a phrase broken across two lines misses it when its part on the previous line holds a camelCase
      break in any of its words: a capital inside a word, or a character that folds to one (D-5287; older than this
      PR);
    - it also misses it when the phrase's part on either line lies more than 80 units from the line break, because
      the facing ends are cut raw at 80 units before matching (D-5287; older than this PR);
    - the forms swept by hand have no committed regrowth guard: only the local scan and the `grep -F` cross-check
      see them (D-5285).
  - The coordinator's rulings at landing, under the operator's directive of 2026-10-19:
    - A required check that is red on `main` needs a land-sync commit. An admin merge bypasses only the approval
      rule; it cannot go over a red required check (mail 7194, corrected by mail 7196).
    - Once `main` kept moving, a land-sync whose only conflict is `ccd/ccd`'s generated stamp line was ruled in
      advance for the worker: merge `main`, re-stamp, re-gate (mail 7231).
    - A listed load flake that passes alone is re-run without asking.
  - The PR's CodeQL check read failure with 43 alerts. The coordinator matched each, by path and rule, to an alert
    already open on `main`: the sweep touched those lines, so none was new.
  - Before merging, the coordinator ran the private-name scan over the would-be merge tree, which printed nothing,
    and the probe against `main` at `780c8126c`, which was clean.
- **Still owed** (the plan's "Not in this plan"):
  - the coordinator's: the pre-push hook's next version, which reads the local list and checks added lines, commit
    messages and ref names; and patching the live PR titles and bodies that carry a ticket id (Decision 4);
  - its owner's: deleting the one remote branch whose name carries a ticket id, once its PR closes;
  - the operator's: history (default: no rewrite), release tarballs (default: keep them), and removing old revisions
    of edited PR descriptions, a manual step in the GitHub UI.

## Carried constraints

- Line-neutral edits only; `ccd/ccd` re-stamped with the shipped function; no new `D-<n>` except numbers issued to
  the run.
- Claimed files wait for their holders. At plan time, open runs hold claims on several files the sweep touches
  (`ccd/ccd`, `ccd/session-hook.sh`, `README.md`, `shared/api.ts`, `ccd/ccrc-doctor-checks`,
  `server/test/single-definition.test.ts`).
- The PR diff shows the removed text; history and old release tarballs keep it (the plan's "Not in this plan").
- Since #722 merged, class 9 charges an open branch only for its net added lines. Each owner sweeps its own tip on
  its next merge of `main`.

## Next-wave brief

Wave 1 was dispatched as run 561 and landed as #722. No second wave is planned. The coordinator's two owed acts
above are not waves.
