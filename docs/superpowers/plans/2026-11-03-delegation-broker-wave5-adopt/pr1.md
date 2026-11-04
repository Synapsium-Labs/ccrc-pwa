# Wave 5, PR1: the lease library, the carrier and `ws-lease-mark` (task note)

This note is PR1's record for the wave's ledger pull request (Global Constraints, "Ledger edits"). The coordinator folds it into the
plan and the programme ledger. This PR edits no existing plan and not the programme ledger.

## Consent to edit files another run holds

- `ccd/session-hook.sh`, `ccd/install-session-hooks.sh` and `CLAUDE.md`: under claim 3387 (run 1410), by its coordinator's consent
  relayed in mail 14660, in disjoint hunks only. PR1 adds `ws-lease-mark` in place to the hook's two `APPROVAL_FORBIDDEN_JQ` verb lists
  and to the installer's child-deny loop, and to `CLAUDE.md` the SAFETY bullet beside `ws-reclaim`'s siblings and the
  coordination-invariant sentence after "Zero new ccd verbs for coordination mutation". Nothing else in those files.
- `README.md`: under claim 3395 (run 1312), by its coordinator's consent relayed in mail 14664, for the twin lines beside the three
  train-proof library mentions only (the libraries list, the backup restore, and the pin paragraph, whose "second library" sentence
  now names the third).

## Deviations found

- **D-7934** — `release-never-takes-an-index-entry` (rule 10, rule 12): a `released` mark never writes, re-points or is refused by the
  by-tree entry. Rule 12 says every mark repairs the entry; for a release that would re-point an entry to a lease that no longer
  holds, and rule 10 would refuse a release with `tree-held` when a new lease had reused the admin record. So a release reads the
  entry only to refuse `unmeasured` when it cannot be read, and otherwise leaves it as it stands. The `index-cleared` heal (D-7805)
  is unchanged.
- **D-7935** — `nesting-skips-an-unreadable-carrier` (rule 9): the carrier half of the `nested` check skips another lease's carrier
  that cannot be read, rather than refusing `unmeasured`. Review Focus 1 says one corrupt carrier blocks one tree, never the lane;
  refusing here would block every mark on the box. A tree shared with the unreadable lease is still guarded by the by-tree index
  (rule 10 refuses `unmeasured`), and git's own worktree list (the stanza half of the same rule) still sees every live nesting.
- **D-7936** — `lease-mark-id-census` (W5-G7): `id-argv-census.test.ts` registers `leaseMark` as `no-id`, as it does `prLanding`,
  and `server/src/ccdargv.ts` joins its `GATE_FILES`. The census probes a builder's id by argument position, and `leaseMark` takes one
  object; its three ids (the lease, the parent and a promoted session) are each checked once, inside the builder, which throws before
  any argv is built (W5-G6b). PR6, the first caller, adds its own call-site row.
- D-7937, D-7938 and D-7939: unused.

## Measured, not departures

- **Rule 9's containing checkouts include the main checkout** (git's stanza list does), so a tree inside the main checkout but not at
  `.claude/worktrees/<name>` or `.superpowers/worktrees/<name>` refuses `nested`, as the carve-out's text names the main checkout among
  the containing checkouts.
- **A failed index or carrier rename answers `unmeasured`**: `LEASE_MARK_REFUSALS` has no write-failed word.
- **Cross-context edges**: `cmd_ws_lease_mark` calls `_reg_id_ok` and `_reg_id_cap` (C1) and `_child_runid_valid` (C5). The plan
  foresaw `_reg_get`, which the verb never needs: rule 9 reads the registry through `_ws_orphan_registered`.
- **W5-G4** is measured by a new `server/test/ccd-ws-lease-mark-reach.test.ts` (the `ws-shed-deps` twin: one table run against the
  body's entry guard and the installed launcher) beside the plan's `agent/test/ccd-entry-exec.test.ts` case, which reaches the
  launcher only.
- **The backup set's sidecar check** (`ccrc-update-flip-backups.test.ts`) matched any `delegation` in a backup row, so the
  library's own row (`ccd-lib-delegation-lease.sh`) read as a sidecar in the first full run. The pattern now carves out
  `-lease.sh` only, and still matches `delegation-events.log`, `delegation-checkpoint.json`, `coordination-*` and `coord.db`.
- **W5-L16** makes a new commit before re-adding the tree, so the re-added tree's creation base differs: `_plat_btime` is whole
  seconds and an inode can be reused, so a same-second re-add could otherwise measure the same fingerprint.

## The mutation table, as measured

Each mutant applied alone to the working tree from a saved copy, restored and checked by SHA-256, each run bounded by `timeout -k 10
600` and `ulimit -u` at the measured thread count plus 1500.

| Mutant | Went red |
|---|---|
| W5-LM1, LM2, LM3, LM4 | W5-L7, W5-L8, W5-L9, W5-L10 |
| W5-LM5 | W5-L11, W5-L24 |
| W5-LM5b | W5-L24 |
| W5-LM6 | W5-L12 |
| W5-LM7 | W5-L13 |
| W5-LM8 | W5-L16 |
| W5-LM9 (drop the bash `! -L` test alone) | **survived**: the reader's python opens with `O_NOFOLLOW`, a second layer that still refuses the link |
| W5-LM9b (drop both layers) | W5-L14 |
| W5-LM10 | W5-L3, W5-L4 |
| W5-LM10b | W5-L3 |
| W5-LM11 | W5-L2, W5-L23 |
| W5-LM12 | W5-L18 (answered after the 5 s hold instead of `busy`) |
| W5-LM13 | W5-L25 |
| W5-LM19 | W5-L23, W5-L23b |
| W5-LM20 | W5-L23 |
| W5-LM21 (tree-held for any other lease) | W5-L13 |
| W5-LM22 | W5-L23b |
| W5-LM21 (git reads outside `_ws_reclaim_contained`) | **survived**: an equivalent mutant. The verb runs `rev-parse`, `symbolic-ref` and `worktree list` only, none of which refreshes an index, so nothing W5-L22 lists changes either way. The containment stays as defence for a later read. |
| W5-LM14 | W5-L5 |
| W5-LM15 | `g25-ws-lease-mark-without-lease.ts` (it compiles), W5-G2 |
| W5-LM16 (the body's guard) | the reach test's unprivileged-bash row |
| W5-LM16b (the launcher's classifier) | the reach test's three launcher rows |
| W5-LM17 | W5-G8, the CHILD_DENY_RULES row |
| W5-LM18 | W5-G6c |
