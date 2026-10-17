# Program: public-tree-scrub

Spec: none (the operator's public-repos rule, 2026-10-12, and the ruling of 2026-10-15 ordering this clean-up)
Plan: `docs/superpowers/plans/2026-10-15-public-tree-private-name-scrub.md`
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-quiet-ridge`   Workspace: a fresh child (one PR)

**What this program is.** This repository is public. Its tree still carries private names from before the
2026-10-12 rule: other projects, lane and account ids, hosts, people, tracker ids and a few commercial passages.
They sit in about 290 files at `518789ad0`, almost all in historical docs and test fixtures, and in comments in
shipped code. One PR sweeps them out line-neutrally and adds a hashed ratchet class so they cannot return.

## Waves

| # | scope | deploy class | PRs | state |
|---|---|---|---|---|
| 1 | Plan Tasks 1-7: the hashed class red-first, the sweep to green | none (tests, comments, docs) | - | run 561, dispatching |

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

## Carried constraints

- Line-neutral edits only; `ccd/ccd` re-stamped with the shipped function; no new `D-<n>` except numbers issued to
  the run.
- Claimed files wait for their holders. At plan time, open runs hold claims on several files the sweep touches
  (`ccd/ccd`, `ccd/session-hook.sh`, `README.md`, `shared/api.ts`, `ccd/ccrc-doctor-checks`,
  `server/test/single-definition.test.ts`).
- The PR diff shows the removed text; history and old release tarballs keep it (the plan's "Not in this plan").

## Next-wave brief

Wave 1 is dispatched on the merge of this ledger. Brief: the plan path, Tasks 1-7, the local list's path, the
claims to wait on, the routing (implementers Sonnet high, per-task reviewer Opus high, workflows on), and the
run's issued departure block.
