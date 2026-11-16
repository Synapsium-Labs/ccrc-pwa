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
  refusing here would block every mark on the box. Within this repository the skip leaves two guards: the by-tree index guards a
  tree shared with the unreadable lease (rule 10 refuses `unmeasured`), and git's worktree list (the stanza half of the same
  rule) sees a nesting of this repository's own worktrees. Neither sees across repositories: the by-tree key is per common
  directory and the stanza list is this project's only. So a worktree of ANOTHER repository nested in or around the tree,
  whose lease's carrier cannot be read, is not caught. That residual gap is accepted, because refusing there would block every
  mark on the box (review 1429, A2). A second gap lies inside this repository (review 1438 F2, mail 14786): lease A's tree has
  lost its admin record while its directory stands, and A's carrier cannot be read. A lease marked on a tree nested inside A's is
  then not caught, because git's worktree list no longer shows A and the carrier half skips A. Only that inside direction can be
  built, and it needs both faults at once; it is accepted for the same reason. W5-L28 pins the skip (a malformed and an
  unreadable carrier) and W5-L27 the carrier half it leaves in place.
- **D-7936** — `lease-mark-id-census` (W5-G7): `id-argv-census.test.ts` registers `leaseMark` as `no-id`, as it does `prLanding`,
  and `server/src/ccdargv.ts` joins its `GATE_FILES`. The census probes a builder's id by argument position, and `leaseMark` takes one
  object; its three ids (the lease, the parent and a promoted session) are each checked once, inside the builder, which throws before
  any argv is built (W5-G6b). PR6, the first caller, adds its own call-site row.
- **D-7937** — `release-keeps-the-stored-fingerprint` (rules 5 and 11; mail 14732, review 1429 F2): a `released` mark with a stored
  carrier never recomputes the fingerprint. It keeps the stored fingerprint, creation base, branch and path, as D-7825 already
  does when the tree is gone. Rules 5 and 11 as written refuse such a release `fingerprint-mismatch` when the lease's admin record
  has been reused by a new tree at the same path. A release only ends this lease's claim: it writes no hold and, by D-7934, never
  takes or re-points the by-tree entry, so the fingerprint check that protects holding marks has nothing to protect. Refusing it
  would leave a new lease on the reused tree `tree-held` for good. Rules 6 and 7 (a link on the path, the main checkout) still
  read the tree the record names now. A release keeps the stored fingerprint and still proves that it names the lease's own
  record and project (review 1438 F1, mail 14786): rule 4 keeps the stored `project` and `adminRecord`, and a `released` mark
  with a stored carrier whose `--project` or `--admin-record-hex` differs refuses `fingerprint-mismatch` (the closed
  `LEASE_MARK_REFUSALS` word that already means "not the tree this carrier records") and writes nothing. That also closes the
  D-7825 variant, a release naming a different record that does not exist. W5-L16b pins the release of a reused record (W5-LM24
  restores the recompute and reds it); W5-L16c (another live record) and W5-L16d (another project) pin the binding (W5-LM30 drops
  the comparison and reds both).
- **D-7938** — `rule-4-decided-at-rule-12` (rule 4; mail 14732): plan rule 4 decides `generation-conflict` and `unchanged` first,
  and the verb decides them at rule 12, after rules 5 to 11. The compared body holds measured fields (the fingerprint, the creation
  base, the branch), so it cannot be built before they are read. The consequence: a re-drive of a lost answer after the tree
  switched branch answers `generation-conflict` (a standing refusal), not `unchanged`. No code change.
- **D-7939** — `fingerprint-out-var-form` (Task 5.1.3, the library's Interfaces; mail 14786, review 1438 A-b): the library gains
  `_dl_fingerprint_to <var> …`, an out-var form the plan's Interfaces do not name, so that the fingerprint's unmeasured reason
  reaches the caller's refusal (review 1429's `DL_WHY` minor, W5-L29); `_dl_fingerprint` stays the printing form the
  Interfaces name, now a wrapper over it. A `_to` form must be in the tick-diet out-var census's `PLANNED_FORMS` (its E1c
  row reds otherwise), so `server/test/ccdTickDietRunner.ts`, a file outside PR1's file list (claim 3424), admits it to
  `PLANNED_FORMS` and `LANDED`, planned and landed in one commit as `_roster_fp_to` (D-7717) was.

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
- **The `@ccd-lib:lease` pointer** (review 1429 F1, not a departure: the plan names the region) puts the library into
  `ccdSource()`. That exposed two pins, each updated with its reason: `ccd-id-cap.test.ts` counts five `_reg_id_cap` calls (the
  three mint sites, and `cmd_ws_lease_mark`'s two CHECKS of `--parent` and `--promoted-session`, which mint nothing), and
  `ccd-ws-add-child.test.ts` sets apart the verb's `--generation` and `--journal-seq` grammar lines, which share the run-id bound
  but are not run ids. The library's second marker (`# @ccd-lib:lease-mark`, which `ccdSource()` never split on) is now a plain
  comment: the library is one region.
- **The readers' missing directories** (review 1429 F3, not a departure: the plan's interface says rc 3 is proven absent):
  `_dl_carrier_read` and `_dl_tree_owner` answer rc 3 when `$REG/delegation`, `leases/` or `by-tree/` is cleanly absent under a
  searchable parent, and rc 4 for a link, a non-directory or an unsearchable one (`_dl_dirs_measured`, W5-L26).
- **Carried, not built here**: a tree-level lock (review 1429 A1) goes to PR6, whose text will say how marks of different leases
  on one tree are serialised (the lane's mark step and the later synchronous marks). PR6's rule 3 wording (A3) goes there too.
  `_dl_tree_owner` answering rc 3 when `by-tree/` is absent although `leases/` holds carriers (review 1438 A-e) goes to PR4's
  dispatch, which rules whether its rung reads that state as unmeasured; `_dl_dirs_measured`'s comment now claims only what it
  measures (no entry of that name now).
- **Not taken, for the rider** (review 1438 A-f, both from round 1, same-user accident guards): the write path follows links
  after `_dl_leases_dir`'s check (`chmod`, the lock's `>>`, the temp files at predictable names), and the lock's descriptor has
  no close-on-exec, so the verb's child processes inherit it.
- **The pointer guard** (review 1438 A-a): `ccd-lib-load.test.ts` asserts that every `@ccd-lib:<id>` region of every library has
  a pointer in ccd/ccd, every pointer a region, and every marker line one `\w+` id. W5-LM23 (drop the pointer) and W5-LM23c
  (restore the stray `lease-mark` marker) red it.
- **Minors taken** (review 1429): the lock's `exec` no longer silences the process's stderr; the carrier reader checks that the
  file's `leaseId` is the lease asked for (W5-L14b); `--expires-at ""` refuses `usage` (W5-L5); the fingerprint's unmeasured
  reason reaches the answer through `_dl_fingerprint_to`, with `_dl_fingerprint` kept as the printing form PR2 consumes
  (W5-L29; D-7939); `LeaseMarkArgs` and `leaseMarkArgv` sit above `CCD_ARGV`'s JSDoc; W5-L18's holder is its own process group,
  killed whole, and the row waits until a probe cannot take the lock.
- **Minors left for later** (review 1429): `_ws_orphan_stanzas` folds a failed `git worktree list` into no worktrees (it is
  `disk-retention.sh`'s, the orphan lane's, for PR4's review); the D-6051 python parse check does not cover the reader's `-c`
  string (behaviour rows run it); the mutation-table wording points other than W5-LM9; and the mark's cost, one `python3` per
  carrier ever written in the nesting loop, carried to PR6.
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
| W5-LM8 | W5-L16 (re-measured in round 2) |
| W5-LM9 (drop the bash `! -L` test alone) | W5-L14, through its dangling-link and self-loop sub-cases (round 2), which python never opens. In round 1 it survived and was explained wrongly as equivalent (review 1429 F5): the second layer covers a link to an existing file only. |
| W5-LM9b (drop both layers) | W5-L14 |
| W5-LM10 | W5-L3, W5-L4 |
| W5-LM10b | W5-L3 |
| W5-LM11 | W5-L2, W5-L23 |
| W5-LM12 | W5-L18: it waited out the holder and answered instead of `busy` (after 5 s in round 1; after 30 s when re-measured in round 2, whose holder sleeps 30 s and is killed whole) |
| W5-LM13 | W5-L25 |
| W5-LM19 | W5-L23, W5-L23b |
| W5-LM20 | W5-L23 |
| W5-LM21 (tree-held for any other lease) | W5-L13 |
| W5-LM22 | W5-L23b |
| W5-LM21b (git reads outside `_ws_reclaim_contained`) | **survived**: an equivalent mutant. The verb runs `rev-parse`, `symbolic-ref` and `worktree list` only, none of which refreshes an index, so nothing W5-L22 lists changes either way. The containment stays as defence for a later read. |
| W5-LM14 | W5-L5 |
| W5-LM15 | `g25-ws-lease-mark-without-lease.ts` (it compiles), W5-G2 |
| W5-LM16 (the body's guard) | the reach test's unprivileged-bash row |
| W5-LM16b (the launcher's classifier) | the reach test's three launcher rows |
| W5-LM17 | W5-G8, the CHILD_DENY_RULES row |
| W5-LM18 | W5-G6c |
| W5-LM23 (drop the `@ccd-lib:lease` pointer; one mutant, three suites) | `ccd-id-cap` "each mint site carries its own die line", `ccd-ws-add-child` "spells the literal run-id pattern once", and from round 3 `ccd-lib-load` "every region of every library is spliced back by a pointer line" |
| W5-LM23c (restore the stray `# @ccd-lib:lease-mark` marker) | `ccd-lib-load` "every region of every library…" |
| W5-LM24 (a release recomputes the fingerprint again) | W5-L16b |
| W5-LM25 (a missing directory answers rc 4 again) | W5-L26 |
| W5-LM25b (`_dl_tree_owner` stops measuring `by-tree/` itself) | W5-L26 (`by-tree` a regular file) |
| W5-LM26 (delete rule 9's carrier half) | W5-L27 |
| W5-LM26b (an unreadable other carrier refuses `unmeasured`) | W5-L28 |
| W5-LM27 (drop the reader's `leaseId` check) | W5-L14b |
| W5-LM28 (`--expires-at ""` passes the usage check) | W5-L5 |
| W5-LM29 (the fingerprint read through `$(...)` again) | W5-L29 |
| W5-LM30 (a release no longer compares its project and record with the stored carrier) | W5-L16c, W5-L16d |
