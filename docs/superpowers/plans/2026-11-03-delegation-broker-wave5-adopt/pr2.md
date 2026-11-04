# Wave 5, PR2: the read-only `ws-lease-audit` (task note)

This note is PR2's record for the wave's ledger pull request (Global Constraints, "Ledger edits"). The coordinator folds it into the
plan and the programme ledger. This PR edits no existing plan and not the programme ledger.

## Deviations found

None. The deviation block issued to this PR at run-open is unused: nothing below departs from the plan's text. (Its numbers are not written here, because a mention alone would raise the ledger floor, `deviation-refs`' floor case.)

## Measured, not departures

- **The fixture move (Task 5.2.1 Step 1).** `server/test/leaseFixture.ts` exports the seven names the plan lists (`LEASE`, `OTHER`,
  `INC`, `hex`, `agentTree(h, name?)`, `mark(h, over?, pre?)`, `carrier(h, id?)`) and `STUBS`, plus the helpers their bodies need
  (`THIRD`, `BASE`, `Flags`, `Out`, `run`, `reg`, `leasesDir`, `main`, `carrierPath`), every one taking the harness. In the move
  commit `ccd-ws-lease-mark.test.ts` binds them to its own harness under their old names, one line each, so no call site and no
  case changed; that is the reading of "changing only imports" taken here. `agentTree` keeps its two optional trailing
  parameters (`at`, `from`), which W5-L27's nested trees use.
- **`changed` is unmeasured whenever `dirty` or `aheadOfBase` is**, even when the other fact reads `true`, as the rule's text says
  ("makes that fact and `changed` unmeasured"). A consumer reads unmeasured as changed (a missing audit counts as changed), so no
  consumer can tell the two apart.
- **The exit status** is 1 whenever any fact is unmeasured, `holders` included (the interface's "rc 0 measured, 1 unmeasured or
  refused"); the document is still `ok: true` there (W5-AU4b, W5-AU5, W5-AU9).
- **The main checkout.** A main checkout PROVEN absent refuses `no-tree`; one that is a link, not a directory or not directly under
  the physical projects root refuses `unmeasured`, because `LEASE_AUDIT_REFUSALS` holds no `not-under-projects-root` word and
  such a checkout does not prove the tree gone.
- **What a moved tree answers.** The box-side fingerprint binds the tree's directory identity, not its path, so a tree moved by
  `git worktree move` on one filesystem keeps its fingerprint, and the audit measures it where its admin record names it now. The
  audit does not compare the carrier's `canonicalPath` with that place; the answer carries no path.
- **`holders`** asks `_ws_path_users_many` of the tree as git records it and of its physical spelling when they differ (the orphan
  ladder's `_ws_orphan_holders` shape), then `_ws_cwd_users` of the physical one, and unions the pids, sorted and each once. Any
  unmeasured slot, a probe that does not answer 0, or a pid that is not one positive number answers `"unmeasured"`. Without
  `--holders` neither probe is asked (W5-AU9's last case stubs both to kill the shell).
- **"Writes nothing" holds for every durable path.** `_ws_gc_dirty`, the dirt reader the plan names, captures `git status`'s
  stderr in one `_plat_mktemp` file under the session's temp root and removes it; nothing is written under `$REG`, the tree, its
  admin record or the common directory's worktrees entry (W5-AU7, with the mark's lock file removed first so an opened one would
  show, and a tracked file's stat record made stale so an index refresh would show).
- **The direct-entry boundary.** The plan puts the read-only verb behind the privileged entry check (the body's guard and the
  launcher's `is_protected` tuple), as its writer is. W5-G12 is measured twice: by `agent/test/ccd-entry-exec.test.ts` (through the
  real exec op) and by two shapes and a case variant added to `server/test/ccd-ws-lease-mark-reach.test.ts`, PR1's twin of the
  `ws-shed-deps` reach test.
- **W5-G10** (the caps token) is measured by `ccd-archive.test.ts`, which holds `cmd_caps`'s advertised capabilities exactly equal
  to `server/test/ccdCapTokens.ts`, where `lease-audit-v1` is added, and by `ccd-verb-sets.test.ts`, which holds `ws-lease-audit`
  to a dispatch arm.
- **Rows the plan does not list.** W5-AU0 (the grammar: every usage error is rc 2 with one line) and W5-AU10 (the verb's refusal
  words are exactly `LEASE_AUDIT_REFUSALS`, read from the library's text).
- **The runner row** is `'ws-lease-audit': 60_000`: the two holder walks at 10 s each (`WS_PATH_USERS_SCAN_S`,
  `WS_CWD_USERS_SCAN_S`), and 40 s for a large tree's `git status` and `rev-list`, under the agent's 300 s maximum
  (`MAX_EXEC_TIMEOUT_MS`). `timeoutMsFor` is exported, unchanged; W5-G15 reads the two bounds from `ccd/ccd` and the maximum from
  `agent/src/server.ts`.
- **The first full CI run was red on two static pins this PR reaches but its tip list does not name.**
  `ccd-ws-add-child`'s run-id census counts every `[0-9]{0,9}` spelling in `ccdSource()`, and the audit's first spelling of its
  three number grammars (`--generation`, the `rev-list` count and a holder pid) used that bound. They now read `^[1-9][0-9]*$`
  (or `^(0|[1-9][0-9]*)$`) with `${#x} -le 10`, the same ten digits, so the run-id grammar keeps its one spelling and the
  pin is unchanged. `single-definition/core-vocab`'s "one path to the ccd script" refused W5-G15's own spelling of
  `ccd/ccd`, which now reads `ccdWsHelpers.ts`'s `CCD`.

## The mutation table, as measured

Each mutant applied alone to the working tree from a saved copy, restored and checked by SHA-256, each run bounded by `timeout -k 10
600` and `ulimit -u` at the measured thread count plus 1500. The coordinator skill's `mutation-run.py` mutates Python modules only,
so the bash and TypeScript mutants used the saved-copy driver PR1 used.

| Mutant | Edit | Went red |
|---|---|---|
| W5-AUM1 | `dirty` read with `--untracked-files=no` in place of `_ws_gc_dirty` | W5-AU2 (the untracked case) |
| W5-AUM2 | an unmeasured `aheadOfBase` folded to 0 | W5-AU4b |
| W5-AUM2b | `base` dropped from the fingerprint's inputs | W5-AU4 (answers `ok`) |
| W5-AUM3 | the generation compare skipped | W5-AU3 |
| W5-AUM4 | the generation dropped from the token's inputs | W5-AU8 |
| W5-AUM5 | the lock file touched at the ladder's start | W5-AU7 |
| W5-AUM6 | `holders` unmeasured folded to `[]` | W5-AU9 |
| W5-AUM7 | `ws-lease-audit` added to `FORBIDDEN_CCD_VERBS` | W5-G14 |
| W5-AUM8 | the ladder run outside `_ws_reclaim_contained` | W5-AU7 (the admin record's directory changes: `git status` refreshes the index, a lock and a rename) |
