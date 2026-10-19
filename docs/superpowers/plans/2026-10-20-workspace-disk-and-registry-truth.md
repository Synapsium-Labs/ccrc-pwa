# Workspace disk and registry truth: carried copies, archived-workspace audit gaps, the PR ledger's branch — Implementation Plan

> **For agentic workers:** nine PRs, Tasks P4-1 to P4-9, one task per PR. REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Routing is per task (§Tasks, **Routing**). Every band-3 task is written and reviewed natively and never handed off. Workers do not edit §Deviations and decisions.

**Spec:** `docs/superpowers/specs/2026-10-20-workspace-disk-and-registry-truth-design.md` (rev 0), approved by the coordinator under the operator's autonomous-backlog mandate of 2026-10-19; the operator may overrule any decision.

**Issues:** #317 (carried copies), #318 (archived-workspace audit gaps, with #120's ranked total folded in), #124 (the registry's branch and PR ledger).

**Base:** `origin/main` `4bc6c756d`. Anchors are `≈:` hints into that commit and each names its function. Re-ground every anchor in Step 0, because #435 moves `ccd/ccd`.

**Deploy class.** P4-1 to P4-3 are SERVER only. P4-4 to P4-9 are FLEET (`ccd/ccd`), deployed agent-first like any `ccd` change. None restarts a session, and each takes effect at the next ordinary release.

## Gates

Open PRs measured at `4bc6c756d` (`gh pr list --state open --json number,title,files`). Only #435, #722 and #740 hold `ccd/ccd`. #435 also holds `ccd/ccrc-doctor-checks`, `deploy/measure-continuity.py`, `server/test/ccdWsHelpers.ts` and `README.md`. #722 holds `ccd/ccrc-doctor-checks` and `README.md`. #434, #816 and #818 hold `CLAUDE.md`. No open PR holds any other file below.

| Task | #435 (continuity 4b) | #722 / #740 | Other | Consolidation |
|---|---|---|---|---|
| P4-1 `.prhistory` branch filter | none | none | none | none |
| P4-2 review-child ceiling | none | none | none | before W4 (K1) |
| P4-3 ranked held bytes | none | none | none | before W4 (K1) |
| P4-4 gone-branch refusal in the ladder | **after** (it rewrites `ccd/ccd`) | rebase + `ccrc restamp` if either is still open | none | **before** W5 (K2) |
| P4-5 stale `index.lock` | **after** | as P4-4 | after P4-4 (same rung region) | **before** W5 |
| P4-6 permission prune | **after** | as P4-4 | none | **before** W5 |
| P4-7 carry receipt | **after** (it edits the carry and `_ci_*`) | as P4-4 | none | none (carry stays bash) |
| P4-8 `carry-dedupe --dry-run` | **after** | as P4-4 | after P4-7 | none |
| P4-9 `carry-dedupe --apply` | **after** | as P4-4 | after P4-8; `CLAUDE.md` after #816/#818 (rebase, line-disjoint) | none |

## Global constraints

- **Public repo.** Fixtures use neutral names (`project-a`, `lane-a`, `pool-a`). Never write a host, an account or lane name, another project's name, an absolute home path or a private tracker id.
- **SAFETY.** FIXTURE HOMEs only (`makeCcdHarness`, `server/test/ccdWsHelpers.ts`). No test runs a verb against a live `$HOME`. Nobody runs `ws-reclaim`, `ws-expire`, `ws-reap`, `ws-gc --prune` or `carry-dedupe --apply` against a live box. Nobody touches tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` out of band.
- **Account switching is never blocked.** Nothing on the swap path may wait, refuse or fail because of this programme's code.
- **No herd restart, and no lane is armed.** No new timer, server lane, `CCD_ARGV` row or whitelist entry.
- **Wire: additive only.** No `FLEET_PROTO` bump. Every new word joins its one L0 table.
- **No `pwa/` file.** The ranked total's card belongs to the PWA epic.
- **`ccd/ccd` edits:** keep the generated stamp honest with `ccrc restamp` after any rebase, never by hand. Run `bash -n ccd/ccd`.
- **Tests:** `./node_modules/.bin/vitest run <file> --maxWorkers=2`, one suite at a time, in the foreground, from `server/`. Re-run a known load flake alone before calling it a break.
- **Commits:** a characterization commit (green on the old code) comes before a behaviour commit whenever existing behaviour moves (consolidation rule 1/1b).

## Review focus

1. **No new deletion path the operator did not run.** Only P4-9 deletes. It deletes only under its proof, never from a session, and nothing schedules it.
2. **The audit promises only what the act will do.** P4-4 to P4-6 change the shared ladder, so the expiry and reclaim lanes must agree, at the audit and at the in-lock recompute.
3. **Fail toward keeping.** Every unreadable, unparsed, tied or unmeasured case keeps the file, the workspace or the row, and names why.
4. **One owner.** The receipt rides the `swap` journal row. Dedupe lives in `_carry_py` and links through `_carry_link_route`. The ceiling is a row of `CHILD_RECLAIM_SKIP`. The ranked total is an L1 function beside `expiryAttention`. Flag any second mechanism.

## Tasks

### Task P4-1: `.prhistory` rows count only for the branch they name (D-5941; spec §2.8) — no gate

**Routing:** band 3 (it changes evidence that feeds child reclamation). **Lane:** SERVER.

**Files:**
- Modify `server/src/coord/childSpent.ts` (`childSpent` ≈:229-243): rung 2 keeps only entries whose `branch === rec.branch`. No match falls through to the live rung.
- Modify `server/src/coord/close.ts` (≈:541-545): `foldPrLineage` receives only entries whose `branch` equals the run's `branch`. A run with a null `branch` folds nothing and says so in a comment. The `prhistory-unreadable` refusal is unchanged.
- Modify `server/test/child-reclaim-spent.test.ts`, `server/test/run-routes.test.ts` (the close fold) and `server/test/ccd-pr-state.test.ts` (the drift pin).

- [ ] **Step 0: Re-ground.** Read `readPrHistory` (`server/src/coord/prhistory.ts` ≈:90-125) and confirm each entry carries `branch`. Read `SessionRecord.branch` and `RunRow.branch`.
- [ ] **Step 1: Characterize (green on main).**
  - `ccd-pr-state.test.ts`: "branch drift answers `unknown`/`branch-drift` and leaves `prnumber`, `prphase` and `.prhistory` byte-identical". This pins the flag-never-repair stance.
  - `child-reclaim-spent.test.ts`: "a `.prhistory` row for this branch answers spent from `prhistory`".
- [ ] **Step 2: Red.**
  - `child-reclaim-spent.test.ts`: "a row for another branch only: falls through to the live rung"; "rows for two branches: the newest row for this branch decides, never a newer row for the other".
  - `run-routes.test.ts`: "close folds only this run's branch's rows into `prLineage`".
- [ ] **Step 3: Green.**
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | filter removed in `childSpent` | child-reclaim-spent | "a row for another branch only" |
  | filter compares against the run's `workspace` | run-routes | "close folds only this run's branch's rows" |
  | `pr-state` drift arm persists `prphase` | ccd-pr-state | "leaves … byte-identical" |

- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/vitest run test/child-reclaim-spent.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-pr-state.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coord-prhistory.test.ts --maxWorkers=2

### Task P4-2: a review child past its ceiling surfaces to its coordinator (D-5942; spec §2.6) — no gate

**Routing:** band 3 (the reclaim decider). **Lane:** SERVER.

**Files:**
- Modify `server/src/childReclaimSweep.ts`:
  - `ChildReclaimSweepSkip`/`ChildReclaimKeptWord` gain `review-report-stale`;
  - `CHILD_RECLAIM_SKIP` (≈:530) gains its `kept` row and sentence;
  - `childReclaimSweepVerdict` (≈:665-671) answers it once `now − mintingRun.closedAt > REVIEW_CHILD_CEILING_MS` (7 days, exported once) and the reviewed run is not terminal.
- Modify `server/src/watch.ts` (≈:4171): the minting-run projection carries `closedAt`. Add the pass's `nowMs` to the input if it is not there already (Step 0).
- Modify `server/test/child-reclaim-sweep-policy.test.ts` and `server/test/child-reclaim-attention-arms.test.ts`.

- [ ] **Step 0: Re-ground.** Find the input's clock (`skewMs` is there; check for a now). Find where kept words reach the attention list and its coordinator-first routing.
- [ ] **Step 1: Red.**
  - "reviewed run open, review run closed 6 days ago: `review-report-live`";
  - "… closed 8 days ago: `review-report-stale`, class kept";
  - "review run not closed (`closedAt` null): `review-report-live`, never stale";
  - "reviewed run terminal: eligible as today";
  - "the stale word's attention row names the reviewed run and reaches its coordinator first".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | ceiling compared with `>=` 0 (always stale) | child-reclaim-sweep-policy | "closed 6 days ago" |
  | `closedAt` null read as 0 | child-reclaim-sweep-policy | "`closedAt` null … never stale" |
  | the stale word classed `ordinary` | child-reclaim-sweep-policy | "class kept" |
  | stale answered `eligible` | child-reclaim-sweep-policy | "closed 8 days ago" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep-policy.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/child-reclaim-attention-arms.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/child-reclaim-prose.test.ts --maxWorkers=2

### Task P4-3: the ranked total of bytes archived workspaces hold, each with its verdict (D-5943; spec §2.7) — no gate

**Routing:** band 2, spec-able. It is a pure read model with no decision, so it may go to `handoff-run`. The orchestrator reviews the diff.

**Lane:** SERVER.

**Files:**
- Modify `server/src/archivedExpiry.ts` (L1): `rankArchivedHeld(records, state)` → `{ totalBytes, unmeasured, rows: [{ sessionId, bytes, verdict, kind }] }`, ranked by bytes descending with ties broken by id. `null` bytes are counted in `unmeasured` and placed last. A row the lane has not audited reads `not-yet-audited`.
- Modify `server/src/watch.ts` (≈:5371): compose it beside `expiryAttention`, plus one accessor, `archivedHeld()`.
- Modify `shared/api.ts` (`FleetHealth` ≈:3554): an optional `archivedHeld` block and its single reader.
- Modify `server/src/server.ts` (`/api/fleet/health` ≈:1322): read the accessor once. The block is absent before the first pass.
- Modify `server/test/archived-expiry-policy.test.ts` and `server/test/fleet-health.test.ts`.

- [ ] **Step 0: Re-ground.** Read `ArchivedExpiryEntry` (≈:422) for the last outcome word, and `FleetSession.archivedBytes`.
- [ ] **Step 1: Red.**
  - "ranked by bytes, descending";
  - "null bytes are unmeasured, never 0, and last";
  - "a never-audited row reads `not-yet-audited`";
  - "the total sums measured rows only";
  - "fleet health has no `archivedHeld` before the first pass";
  - "an older reader ignores the block".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `null` coerced to 0 | archived-expiry-policy | "null bytes are unmeasured" |
  | ascending sort | archived-expiry-policy | "ranked by bytes, descending" |
  | block emitted as `{}` before the first pass | fleet-health | "no `archivedHeld` before the first pass" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/archived-expiry-lane.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/fleet-health.test.ts --maxWorkers=2

### Task P4-4: the ladder refuses a HEAD still checked out on a gone branch (D-5944; spec §2.3) — GATED: after #435

**Routing:** band 3 (the destructive ladder). **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd`:
  - a new helper `_ws_reclaim_head_unborn <workdir> <branch>` answers 0 when HEAD is symbolic to `refs/heads/<branch>` and `RECLAIM_BRANCHSTATE` is `absent`;
  - `_ws_reclaim_ladder` (≈:30217, after `_ws_reclaim_tip_read`) refuses `branch-gone-checked-out`;
  - `_ws_reclaim_pin_contained` (≈:31465) uses the same helper;
  - the terminal-word list (≈:13241) and the vocabulary comment (≈:33732) gain the word.
- Modify `server/src/archivedExpiry.ts` (`ExpireToken`, `EXPIRE_TOKEN_KIND` ≈:40: `terminal`), `server/src/coord/childReclaim.ts` (≈:62/80: `terminal`) and `server/src/wsaudit.ts` (≈:48: its sentence).
- Modify `server/test/ccd-child-reclaim-gone-branch.test.ts`, `server/test/ccd-ws-expire-ladder.test.ts` and `server/test/archived-expiry-policy.test.ts`.

- [ ] **Step 0: Re-ground** on post-#435 `main`. Confirm the ladder still mints with an empty `head=` for this shape. Measure it with a fixture and record the red.
- [ ] **Step 1: Red.**
  - "ws-audit on a child whose HEAD is symbolic to a deleted branch refuses `branch-gone-checked-out`, no token";
  - "the same for ws-expire's audit";
  - "a detached HEAD on a gone branch still passes (the #326 case)";
  - "`EXPIRE_TOKEN_KIND` and the reclaim kinds read it `terminal`".
- [ ] **Step 2: Green.** Run `ccrc restamp`.
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | ladder call removed (pin keeps it) | ccd-child-reclaim-gone-branch | "refuses `branch-gone-checked-out`, no token" |
  | helper ignores `RECLAIM_BRANCHSTATE` | ccd-child-reclaim-gone-branch | "a detached HEAD … still passes" |
  | word kind `retry` | archived-expiry-policy | "reads it `terminal`" |

- [ ] **Step 4: Verify.**

      bash -n ccd/ccd
      cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-gone-branch.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-ladder.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/child-reclaim-refusals.test.ts --maxWorkers=2

### Task P4-5: a stale, empty, unheld `index.lock` is named, not `tree-busy` (D-5945; spec §2.4) — GATED: after #435 and P4-4

**Routing:** band 3. **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd`:
  - `WS_INDEX_LOCK_STALE_S=21600`, declared once beside `REAP_SCAN_SECONDS`;
  - a new helper `_ws_index_lock_state <lockpath>` → `absent | held | stale | unmeasured`. `stale` needs a regular file of size 0, an mtime older than the bound, and `_ws_path_users` (≈:31966) answering 0;
  - rung 6 of `_ws_reclaim_ladder` (≈:30097-30100) and the nested twin (≈:30189-30190) refuse `tree-busy` only on `held`, pass on `stale` (recording `staleLock` in the audit document and the journal) and answer unmeasured on `unmeasured`;
  - `staleLock` joins the fingerprint inputs, so the in-lock recompute binds it.
- Modify `server/test/ccd-child-reclaim-ladder.test.ts` and `server/test/ccd-ws-expire-ladder.test.ts`.

- [ ] **Step 0: Re-ground.** Read `_ws_path_users`'s answers and bound. Confirm the pin never takes `index.lock` (it copies the index, ≈:30496 `_ws_reclaim_index_src`).
- [ ] **Step 1: Red.**
  - "an empty lock older than the bound with no holder: passes, `staleLock` named";
  - "the same lock held by a process: `tree-busy`";
  - "a young empty lock: `tree-busy`";
  - "a non-empty old lock: `tree-busy`";
  - "a probe that cannot run: unmeasured";
  - "the nested checkout's lock follows the same rule";
  - "ws-expire's audit and verb agree".
- [ ] **Step 2: Green.** Run `ccrc restamp`.
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | holder probe skipped | ccd-child-reclaim-ladder | "held by a process: `tree-busy`" |
  | size check dropped | ccd-child-reclaim-ladder | "non-empty old lock" |
  | age check dropped | ccd-child-reclaim-ladder | "young empty lock" |
  | unmeasured read as stale | ccd-child-reclaim-ladder | "a probe that cannot run" |
  | nested twin left on the old rule | ccd-child-reclaim-ladder | "the nested checkout's lock" |

- [ ] **Step 4: Verify.**

      bash -n ccd/ccd
      cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-ladder.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts --maxWorkers=2

### Task P4-6: the permission pass skips ignored build directories (D-5946; spec §2.5) — GATED: after #435

**Routing:** band 3. **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd`:
  - `_ws_reclaim_normalise` (≈:28793-28848): before the `find`, list the top-level-and-nested directories named `node_modules`, `cdk.out` or `dist` that `git check-ignore -q` reports ignored (contained, bounded inside `REAP_SCAN_SECONDS`), and add `-prune` arms for them;
  - the residual check (`left=`) uses the same prunes;
  - the header comment states why the ignored scan still covers them.
- Modify `server/test/ccd-child-reclaim-audit.test.ts`.

- [ ] **Step 0: Re-ground.** Confirm `_ws_collect_ignored` refuses on a `find` error inside an ignored directory: build a fixture with a mode-000 directory under an ignored `node_modules`.
- [ ] **Step 1: Red.**
  - "a mode-000 directory under an ignored `node_modules` is not chmodded by the pass, and the audit still refuses through the ignored scan";
  - "a `node_modules` that is NOT ignored is still normalised";
  - "a tracked `dist` is still normalised";
  - "the pass over a tree whose bulk is ignored `node_modules` finishes inside the bound (fixture with a fake slow `find` budget)".
- [ ] **Step 2: Green.** Run `ccrc restamp`.
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | prune without the `check-ignore` test | ccd-child-reclaim-audit | "NOT ignored is still normalised" |
  | ignored scan's error path bypassed | ccd-child-reclaim-audit | "still refuses through the ignored scan" |
  | residual check left unpruned | ccd-child-reclaim-audit | "finishes inside the bound" |

- [ ] **Step 4: Verify.**

      bash -n ccd/ccd
      cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-audit.test.ts --maxWorkers=2

### Task P4-7: the carry receipt on the swap's journal row (D-5947; spec §2.1) — GATED: after #435

**Routing:** band 3 (the swap path). **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd`:
  - `_swap_carry_jsonl` (≈:25138) sets the caller's local `CARRY_JSONL_BYTES` (the size of the copy landed at the `mdir` slot), the `CARRY_SLOT_FD` idiom;
  - `_swap_carry_sidecars` (≈:25840) sets the caller's local `CARRY_SIDECARS_WORST`, with `none < linked < copied < merged < deferred < kept` (the worst word wins);
  - `cmd_swap`'s `_lc_done swap` (≈:27939) appends `meas.carry.bytes`, `meas.carry.sidecars` and, when `$force`, `dec.force 1`.
- Create `server/test/ccd-carry-receipt.test.ts`.

- [ ] **Step 0: Re-ground** on post-#435 `cmd_swap`. Confirm `_lc_emit` accepts `meas.carry.*` keys (its key grammar) and that the journal line stays under `_LC_LINE_MAX`.
- [ ] **Step 1: Red.**
  - "a plain swap's row carries the bytes and `linked`/`none`";
  - "a sanitized carry's bytes are the sanitized copy's";
  - "a merge that deferred says `deferred`";
  - "a forced swap carries `dec.force 1`";
  - "a journal directory that cannot be written still swaps, rc and stdout unchanged";
  - "the refusal path writes no receipt".
- [ ] **Step 2: Green.** Run `ccrc restamp`.
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | bytes taken from the source, not the `mdir` copy | ccd-carry-receipt | "a sanitized carry's bytes" |
  | worst-word order inverted | ccd-carry-receipt | "says `deferred`" |
  | receipt write made fatal | ccd-carry-receipt | "still swaps" |
  | `dec.force` dropped | ccd-carry-receipt | "carries `dec.force 1`" |

- [ ] **Step 4: Verify.**

      bash -n ccd/ccd
      cd server && ./node_modules/.bin/vitest run test/ccd-carry-receipt.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-swap-carry.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-swap-carry-merge.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-lifecycle-emit.test.ts --maxWorkers=2

### Task P4-8: `ccd carry-dedupe --dry-run`, the keeper and the proof (D-5948; spec §2.2) — GATED: after P4-7

**Routing:** band 3 (it is the proof P4-9 deletes on). **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd`:
  - `cmd_carry_dedupe` and its dispatch line and usage. Mode `--dry-run` is the default, with `--uuid` and `--json`; `--apply` answers "not in this build" until P4-9;
  - `_carry_py` (≈:25427) gains the modes `dedupe-plan` (enumerate the copies under every roster account root, choose the keeper, run the transcript proof and the sidecar equality, price the bytes) and nothing that writes.
- Create `server/test/ccd-carry-dedupe.test.ts`.

- [ ] **Step 0: Re-ground.** Read how the roster's account roots are listed (`accounts.sh`), `_transcript_matches`, and the receipt from P4-7.
- [ ] **Step 1: Red.**
  - **Keeper order:** "a receipt names the keeper"; "else the registry `wrapper`"; "a rowless uuid keeps the strictly largest-and-newest copy"; "a tie skips the uuid, named".
  - **Proof:** "a byte-prefix copy is removable"; "a sanitized copy (rewritten text, same uuids) is removable by the uuid arm"; "a copy holding one uuid the keeper lacks is kept"; "an unparseable line keeps the copy"; "a uuid swapped in the last 24 h is skipped".
  - **Sidecars:** "equal files are priced as links, unequal ones kept".
  - **Read-only:** "the dry run writes nothing (tree checksum before and after)"; "the JSON totals equal the sum of the rows".
- [ ] **Step 2: Green.** Run `ccrc restamp`.
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | uuid arm accepts a missing uuid | ccd-carry-dedupe | "one uuid the keeper lacks is kept" |
  | ties broken by name | ccd-carry-dedupe | "a tie skips the uuid" |
  | 24 h quiet ignored | ccd-carry-dedupe | "swapped in the last 24 h" |
  | unparseable line skipped instead of failing | ccd-carry-dedupe | "an unparseable line keeps the copy" |
  | registry rule placed above the receipt | ccd-carry-dedupe | "a receipt names the keeper" |

- [ ] **Step 4: Verify.**

      bash -n ccd/ccd
      cd server && ./node_modules/.bin/vitest run test/ccd-carry-dedupe.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-carry-link-route.test.ts --maxWorkers=2

### Task P4-9: `ccd carry-dedupe --apply`, the operator's verb (D-5949; spec §2.1, §2.2) — GATED: after P4-8

**Routing:** band 3, **two reviewers** (it deletes transcript copies). **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd`:
  - `cmd_carry_dedupe --apply`: refuses when `CLAUDECODE` is set, without a TTY, or inside a `cc-*` pane;
  - per uuid it takes `_carry_slot_take` (contended: skip, named), re-reads the receipt, the registry row and the copies, and re-runs the proof at the act;
  - sidecars: link equal files through `_carry_link_route` and an atomic rename;
  - transcripts: unlink only a proven copy;
  - one `dedupe` journal row per act;
  - `_LC_ACTS` gains `dedupe`.
- Modify `shared/api.ts` (`LIFECYCLE_ACTS` ≈:7687 and its map): `dedupe`.
- Modify `CLAUDE.md` SAFETY: one line, "`ccd carry-dedupe --apply` is the operator's; a session never runs it."
- Modify `server/test/ccd-carry-dedupe.test.ts` and `server/test/ccd-lifecycle-emit.test.ts`.

- [ ] **Step 0: Re-ground.** Read `ccrc history`'s three-bump refusal (`ccd/history/lib.mjs`) and copy its conditions, never its code. Read `_carry_slot_take`'s never-unlink rule.
- [ ] **Step 1: Red.**
  - **Refusals:** "refuses with `CLAUDECODE` set"; "refuses without a TTY"; "refuses in a `cc-*` pane".
  - **Acts:** "a proven copy is unlinked and journalled `dedupe`"; "an unproven copy stands"; "a receipt with `deferred`, `kept` or `dec.force` keeps the source"; "the registry `wrapper` disagreeing with the receipt keeps both"; "a copy changed between plan and act (size grew) is re-proved and kept if the proof fails"; "a sidecar file is replaced by a link to an identical keeper file and its content is unchanged"; "a sidecar link that the route refuses leaves the file in place"; "a contended `.carry.lock` skips the uuid"; "the live session's transcript is never written".
  - **Vocabulary:** "`dedupe` is in both act vocabularies".
- [ ] **Step 2: Green.** Run `ccrc restamp`.
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `CLAUDECODE` check removed | ccd-carry-dedupe | "refuses with `CLAUDECODE` set" |
  | proof not re-run at the act | ccd-carry-dedupe | "a copy changed between plan and act" |
  | sidecar unlinked before the link lands | ccd-carry-dedupe | "content is unchanged" |
  | `dec.force` ignored | ccd-carry-dedupe | "… or `dec.force` keeps the source" |
  | slot taken blocking | ccd-carry-dedupe | "a contended `.carry.lock` skips" |
  | `dedupe` missing from L0 | ccd-lifecycle-emit | set equality |

- [ ] **Step 4: Verify.**

      bash -n ccd/ccd
      cd server && ./node_modules/.bin/vitest run test/ccd-carry-dedupe.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-lifecycle-emit.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-swap-carry.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

## Operator acts

None is required to build or land any task. Each of the following is the operator's to take, whenever they choose:

- **Run the dry run, then `--apply`.** After P4-9 deploys, the operator may run `ccd carry-dedupe --dry-run --json` on the fleet box to see the reclaimable bytes, then `ccd carry-dedupe --apply` from their own shell. Nothing runs it otherwise.
- **Arm the expiry lane** (`expire-lane-live`). That is unchanged by this programme. P4-3's ranked total and P4-4 to P4-6 make the shadow's promise match the act.
- **Rule on the open question** about `.claude/worktrees` (spec §6 Q1).

## Rollback

- **Server tasks:** a revert. `archivedHeld` is optional, and an older PWA ignores it.
- **ccd tasks:** `ccrc rollback` to the previous release, fleet lane. Tasks P4-4 and P4-5 only refuse or pass a rung, P4-6 only prunes a read-only walk, P4-7 only adds journal keys, and P4-8 writes nothing.
- **P4-9:** deletes only what its proof showed the keeper already holds. A rollback removes the verb. The journal keeps every act.

## Deviations and decisions

### Issued for this work and defined here

Block D-5940 to D-5949, issued to this programme. One per task, D-5941 to D-5949; D-5940 is issued and unused.

- **D-5941** — `prhistory-branch-filter` (Task P4-1; spec §2.8): `.prhistory` rows count as PR evidence only for the branch they name. `childSpent`'s ledger rung and `closeRun`'s lineage fold read only rows whose `branch` equals the session's or run's branch, and a row for another branch falls through to the live rung. Branch drift stays flagged and is never repaired (`ccd ws-rename` is the operator's reconciling act), and this is pinned in `ccd-pr-state.test.ts`. Reset-on-reuse was rejected: the ledger is append-only and the chokepoint is its one writer.
- **D-5942** — `review-child-ceiling` (Task P4-2; spec §2.6): a review child whose own run closed more than seven days ago, while the run it reviewed is still not terminal, answers the kept word `review-report-stale`. It reaches the banner and the reviewed run's coordinator first. Closing or abandoning the reviewed run releases it, and nothing reclaims it before that.
- **D-5943** — `archived-held-ranked` (Task P4-3; spec §2.7): `rankArchivedHeld` (L1) joins each archived row's `archivedBytes` to the expiry lane's latest verdict, ranked by bytes. `null` is unmeasured, never 0. It is published as the optional `archivedHeld` block of `GET /api/fleet/health`, absent before the lane's first pass, in shadow and armed alike. #120's ask is answered here.
- **D-5944** — `branch-gone-checked-out` (Task P4-4; spec §2.3): the reclaim/expire ladder refuses, with a terminal word and before minting a token, a tree whose HEAD is still symbolic to a branch proven absent. The pin and the ladder share one predicate, `_ws_reclaim_head_unborn`, so the audit never promises what the pin refuses.
- **D-5945** — `stale-index-lock` (Task P4-5; spec §2.4): rung 6 passes an `index.lock` that is a regular, empty file older than six hours with no holder the process probe can find, and names it `staleLock` in the audit and the journal. A held, young or non-empty lock stays `tree-busy`, and an unmeasured probe stays unmeasured. ccd never deletes the lock on its own: the tail removes it with the tree.
- **D-5946** — `normalise-prunes-ignored-build` (Task P4-6; spec §2.5): the permission pass prunes `node_modules`, `cdk.out` and `dist` directories that git reports ignored. The ignored scan still walks them and still refuses on an unreadable entry. The 30 s bound is unchanged.
- **D-5947** — `carry-receipt` (Task P4-7; spec §2.1): the swap's existing `swap` `done` journal row carries `meas.carry.bytes`, `meas.carry.sidecars` (the worst sidecar outcome) and `dec.force 1` on a forced swap. It is best-effort and never gates the swap.
- **D-5948** — `carry-dedupe-plan` (Task P4-8; spec §2.2): `ccd carry-dedupe` defaults to a read-only dry run in `_carry_py`.
  - Keeper order: the receipt's destination, else the registry row's `wrapper`, else the strictly largest-and-newest copy; any tie skips.
  - Transcript proof: a byte prefix, or every uuid-bearing line's uuid held by the keeper and every other line byte-equal to one of the keeper's.
  - Bounds: a 24-hour swap quiet, and no write.
- **D-5949** — `carry-dedupe-apply` (Task P4-9; spec §2.1, §2.2): `--apply` is the operator's alone. It refuses with `CLAUDECODE` set, without a TTY, or in a `cc-*` pane. Per uuid it acts under the non-blocking `.carry.lock` and re-proves at the act. It links equal sidecar files through the proven route and never unlinks a sidecar without a link in its place. It unlinks a transcript copy only on the proof and, where a receipt exists, only under all of the receipt's conditions. Each act is journalled under the new act word `dedupe`. No timer and no server lane runs it.

### Issued and unused

D-5940

### Decisions recorded while planning

- **#124 needs no `ccd/ccd` edit.** The triage expected all three issues to edit `ccd/ccd`. Re-checked on `main`, drift is already flagged-not-repaired and slug reuse is already any-field, so P4-1 is server-only and is not gated on #435.
- **#318 item 1 is narrowed** to the symbolic-HEAD residue. #326 fixed the rest.
- **The source drop is not inline in the swap** (spec §2.1 (a)). It is P4-9's, on P4-7's receipt.

## Out of scope

- **#318 item 5:** collecting unregistered worktrees, both `.claude/worktrees` (operator question, spec §6 Q1) and the ccd-root orphans. A K1 `retire` reason in the consolidation wave's W4 would cover the latter.
- **Any PWA card** for `archivedHeld`: the PWA epic, W7, under the UI rule.
- **A schedule for `carry-dedupe --apply`:** a later operator ruling, not this programme.
- **The artifact-lifecycle policy's Open Question 1** (transcript retention). Dedupe removes no conversation content.
- **Changing the carry to link transcripts:** forbidden by the carry's own header.

## Review log

**rev 0 (2026-10-20).** Written with the spec's rev 0 against `origin/main` `4bc6c756d` and the 25 open PRs measured that day.
