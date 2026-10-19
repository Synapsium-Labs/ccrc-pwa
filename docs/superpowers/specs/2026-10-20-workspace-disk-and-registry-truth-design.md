# Workspace disk and registry truth: carried copies, archived-workspace audit gaps, and the PR ledger's branch

**Spec** · 2026-10-20 · Status: approved by the coordinator under the operator's autonomous-backlog mandate of 2026-10-19; the operator may overrule any decision · Owner: the ccrc coordinator · Issues: #317, #318, #124 (with #120, closed into #318 as its duplicate on the tracker, still open on GitHub) · Plan: `docs/superpowers/plans/2026-10-20-workspace-disk-and-registry-truth.md`

**Related:** `2026-09-23-session-continuity-design.md` (the carry; wave 4b is open as #435), `2026-09-22-child-workspace-reclamation-design.md` (the reclaim ladder and tail), the workspace-lifecycle programme (`ws-expire`, `docs/superpowers/programs/workspace-lifecycle.md`), `2026-08-11-artifact-lifecycle-policy.md` (rows 5, 6 and 10, and its Open Questions 1 and 6), `2026-08-10-architecture-ddd-clean-solid.md`, and the consolidation wave's draft design (`2026-10-19-ccrc-consolidation-wave-design.md`, rev 1, on branch `docs/consolidation-wave-spec`, not yet on `main`).

## In short

Three backlog issues share one theme: what the fleet box holds on disk, and what the registry says about it, can each be wrong in a way that costs space or misleads a destructive decision.

- **#317, carried copies.** A swap copies the session's transcript to the new account and never removes the source. Before #338 every sidecar was copied too. One fleet box measured about 120 GiB of redundant copies, roughly 18% of its work volume (2026-10-07). #338 fixed the sidecar link and made a copy say why and how much. What remains is collecting the copies already on disk and the transcript copies every swap still makes. This spec answers it with **one verb, `ccd carry-dedupe`**: read-only by default, with an `--apply` that only the operator runs. The swap itself never deletes anything. It gains a **carry receipt** on the lifecycle journal row it already writes, and `--apply` drops a source copy only on that receipt plus a content proof.
- **#318, archived-workspace audit gaps.** The expiry lane's shadow output exposed five gaps. Re-checked against `origin/main`: item 1 (a branch that is gone) was fixed by #326 except for one case the audit still promises and the act refuses. Items 2 to 4 are open and get one task each: a stale empty `index.lock` stops reading as `tree-busy`; the permission pass skips ignored build directories; a review child gets a ceiling that surfaces it to its coordinator. The #120 duplicate's ask, a **ranked total of the bytes archived workspaces hold, each with its verdict**, joins as a read model on the expiry lane. Item 5 (worktrees no registry row names) needs an operator ruling for its `.claude/worktrees` half and stays an **open operator question** (§6).
- **#124, the registry's branch and PR ledger.** On `main` today ccd already flags branch drift and never repairs it, and a purged slug can no longer be reused while any registry file stands. The live defect is narrower: two server readers of `.prhistory` take the newest row whatever its branch. They will now count only rows for the workspace's current branch.

Nine tasks, one PR each. The ccd tasks land after #435 and before the consolidation wave's W5 moves the reap and retire helpers, so W5's characterization pins see the corrected behaviour. Nothing here restarts a session, blocks a swap or arms a lane.

## 1. The problem, measured

Code citations are to `origin/main` `4bc6c756d`. Line numbers are hints, written `≈:`, and each also names its function. Box figures come from the issues' own read-only measurements on one fleet box (2026-10-07). This design took no new measurement on any box.

### 1.1 Carried copies (#317)

- **The transcript is copied and never removed.** `_swap_carry_jsonl` (`ccd/ccd` ≈:25138) copies one file per distinct inode with `_plat_cp_replace` and deletes nothing from the source. Its header gives the reason it never links: "the transcript is the one file that gets APPENDED to, so an aliased source would grow a conversation that account never had." That reason stands. A link is the wrong fix for transcripts.
- **A sanitized carry rewrites the copy.** On a hop from an external backend to an Anthropic one the swap passes `sanitize=1` (≈:27846), and `_sanitize_anthropic` rewrites empty text blocks in the destination copy. **A carried transcript is therefore not always a byte prefix of the source's later content.** Any proof that two copies hold the same conversation must allow for that.
- **Sidecars.** Since #338 (D-4500, D-4501), a failed `cp -al` first links through a common mount the kernel's own mount table proves (`_carry_link_route` ≈:25350), and a remaining copy logs `(copy: <cause> <bytes> bytes)`. Copies made before #338 stay on disk. Nothing collects them.
- **The swap already journals.** `cmd_swap` writes one lifecycle row at the flip: `_lc_done swap "$id" "" meas.from … meas.wrapper … meas.uuid …` (≈:27939). It records who moved where. It does not record what was carried.
- **On the box (issue figures):** 48.9 GiB of transcripts, 39.7 GiB of them in copies other than the largest per uuid (163 uuids). 131.5 GiB of sidecars, of which 80.6 GiB repeats a file with the same uuid, relative path and size. One session alone held 22 sidecar trees on 16 accounts with no file linked.
- **Why hand cleanup is unsafe:** the issue records a live session whose same-size copy appeared on another account under three minutes after an automatic swap back. "Keep the largest copy" was refuted by measurement.

### 1.2 Archived-workspace audit gaps (#318, #120)

The expiry lane runs in shadow until `$REG/expire-lane-live` exists (`server/src/archivedExpiry.ts`, `server/src/watch.ts`). Its first six hours of shadow output were 104 rows: 84 "would be cleaned up", 14 failed, 5 refused, 1 deferred. Each item re-checked on `origin/main`:

1. **Branch gone: fixed, with one residue.** #326 ("the gone-branch pin") made a branch proven absent no failure: `_ws_reclaim_pin_contained` (≈:31419) pins HEAD, the WIP commit and the reflogs and skips the missing tip. One case still fails: HEAD still **symbolic** to the gone branch. The pin refuses it ("HEAD names no commit for the WIP commit to stand on", ≈:31465). The audit ladder, though, reads `RECLAIM_HEAD` as empty (≈:30218) and **mints a token anyway** (≈:30237). The shadow promises an act the pin refuses, which is the issue's own complaint, now only for this shape.
2. **Stale lock: open.** Rung 6 of `_ws_reclaim_ladder` (≈:30086-30100, and the nested checkout's twin ≈:30190) refuses `tree-busy` while `index.lock` exists at all. On the expiry side `tree-busy` is a retry word (`EXPIRE_TOKEN_KIND`), and `ws-expire` has no `--defer-expired` because "presence defers WITHOUT a ceiling" (≈:33743). A lock that a crash left behind therefore holds the workspace for good. The issue's example was an empty file dated two weeks earlier with no holder.
3. **Audit timeouts: open.** `_ws_reclaim_normalise` (≈:28793) walks the whole tree under one `REAP_SCAN_SECONDS=30` bound (≈:11517) with `find -exec chmod`. Under a load average of 20-30, 12 of 14 failures were this bound. Every one passed on a later pass, so this is lost passes, not lost safety. `node_modules` and `cdk.out` dominate the walk.
4. **Review children: open.** `childReclaimSweepVerdict`'s review rule (`server/src/childReclaimSweep.ts` ≈:665-671) keeps a review child while the run it reviewed is not terminal, and `review-report-live` is class `ordinary` (≈:577). It never reaches the banner, and nothing bounds it. Six of seven archived children were held this way behind three runs left `awaiting-review` for a week.
5. **Unregistered worktrees: open, and needs a ruling.** 325 linked worktrees with no registry row: 161 under the ccd worktree root and 164 under `<project>/.claude/worktrees`. The lifecycle policy's rows 5 and 6 (`2026-08-11-artifact-lifecycle-policy.md`) say nothing runs ws-gc's orphan arm, and row 6 is "UNASSIGNED — operator ruling required (§Open Q6)".

**#120's ask, folded in:** "a surfaced, ranked total of disk held by archived-unreaped workspaces with each one's audit verdict beside it", so a refusal that is really a bug shows up as one. The bytes are already on the wire: every `FleetSession` carries `archivedBytes`, read from the archive manifest's `worktreeBytes` (`server/src/registry.ts` `manifestBytes` ≈:632). The expiry lane already audits every archived row each pass. **Nothing joins the two or ranks them.**

### 1.3 The registry's branch and PR ledger (#124)

The issue was filed in mid-September. Re-checked on `main`:

- **Drift is flagged, never repaired, by design.** `cmd_pr_state` (≈:10740-10781) answers `{"phase":"unknown","reason":"branch-drift"}` and persists nothing when git's worktree record and the registry's `branch` disagree. Its comment argues why it must not switch source: doing so "would silently re-bind every drifted workspace on the fleet at the next 120 s sweep … irreversible". `ws-audit` reports `drift`, `divergence.ts` (≈:332) raises a `branch-drift` integrity row the PWA renders, and `ccd ws-rename` is the reconciling verb (the operator's act).
- **A purged slug no longer inherits fields.** `_ws_slug_free` (≈:6581) is now an any-field check over `$REG/<id>.*` and the private families, so `ws-add` cannot reuse a slug while a `.prhistory`, `.prnumber` or `.prphase` from a previous occupant stands.
- **The ledger rows already carry their branch.** The `.prhistory` writer, the only one (the chokepoint at ≈:6033), appends `{pr, branch, phase, recordedAt}` (≈:6207).
- **The live defect: two readers ignore that branch.**
  - `childSpent` (`server/src/coord/childSpent.ts` ≈:235-239) answers `spent` from the newest `.prhistory` row, whatever its branch, and that verdict feeds child reclamation.
  - `closeRun` folds every row into the run's `prLineage` (`server/src/coord/close.ts` ≈:541-545).
  - A workspace that changed branch (a `ws-rename`, a resumed wave on a new branch, or drift that was later reconciled) carries rows about **another branch's** PR into both decisions.

## 2. Decisions

Each decision lists the alternatives considered. The chosen one is the safest that needs no operator ruling.

### 2.1 #317: when may a carry's source be dropped?

| Option | Verdict |
|---|---|
| (a) Drop the source inline, at the end of a successful swap | **Rejected.** The swap cannot know two of the issue's three conditions at that moment: whether the resumed session runs on the destination, and whether the destination transcript has grown past the copied size. Waiting for them would hold the swap open, and account switching is never blocked. It would also put a deletion on the path the auto-swap takes, which runs with the server down, and it would race the measured "swapped back within three minutes" case. |
| (b) Drop the source later, from a receipt the swap writes, in the verb that already owns duplicate copies | **Chosen.** The swap's existing `swap` `done` journal row gains a **carry receipt**: `meas.carry.bytes` (the size of the transcript copy landed at the slot the resumed session reads first), `meas.carry.sidecars` (the worst sidecar outcome: `none`, `linked`, `copied`, `merged`, `deferred` or `kept`) and `dec.force 1` on a forced swap. `ccd carry-dedupe --apply` may drop a source copy named by a receipt only when all of these hold, read fresh at the act: the registry row's `wrapper` is the receipt's destination; the destination copy is strictly larger than `meas.carry.bytes`; the receipt's sidecar word is not `deferred` or `kept`; the swap was not forced; the content proof (§2.2) holds; and no swap of that uuid is newer than 24 hours. |
| (c) A per-swap receipt file beside the registry row | **Rejected.** A second record of a fact the lifecycle journal already holds, and `_reg_purge` would take it with the row. The journal (`$REG/.lifecycle/`) is the append-only record `_reg_purge` cannot reach. |

**The receipt never gates the swap.** `_lc_emit` "is best-effort and NEVER gates an act" (≈:4320). A receipt that fails to write costs only that source copy's eligibility: `--apply` then falls back to §2.2's general keeper rule, which can keep the copy and never drops more.

### 2.2 #317: `ccd carry-dedupe`, its keeper order and its proof

- **One verb, two modes.** `ccd carry-dedupe [--dry-run|--apply] [--uuid <u>] [--json]`. With no mode flag it is `--dry-run`. The dry run is read-only: per uuid it lists every copy across the account config roots the roster names, picks the keeper, says for each other copy whether it is removable and why, and totals the bytes. `--apply` does the same and acts.
- **It lives in the carry's own program.** The proof and the link run as new subcommands of `_carry_py`, the python program the carry walk and the link route already are. Links go through `_carry_link_route` (≈:25350), so dedupe links exactly where the carry would and copies nowhere. This is the existing owner of carry, not a second mechanism.
- **The keeper, in order:**
  1. the destination of a valid receipt (§2.1);
  2. else the account the registry row's `wrapper` names, when a live row owns the uuid;
  3. else, for a uuid no row owns (a forgotten or reaped session), the strictly largest copy, which must also be the newest by mtime.

  Any tie, or rules 2 and 3 disagreeing with what the copies show, **skips the uuid** with a reason. Nothing is guessed.
- **The content proof for a transcript.** A copy other than the keeper may be unlinked only when one of these holds:
  1. its bytes are a prefix of the keeper's; or
  2. every line of it that carries a `uuid` field names a uuid the keeper also holds, and every line without one is byte-equal to some line of the keeper.

  The second arm is what a sanitized carry needs (§1.1): `_sanitize_anthropic` rewrites line content but keeps each message's `uuid`. A line that does not parse fails the proof. A failed proof keeps the copy and names it.
- **Sidecars.** A file in a non-keeper sidecar tree whose relative path, size and bytes equal the keeper's file is replaced by a hard link to it (`os.link` through the proven route, then an atomic rename). A file with no equal is left in place and counted. **No sidecar file is ever unlinked without a link standing in its place**, so no sidecar content is removed.
- **Bounds on concurrency:** each uuid runs under the box-wide `$REG/.carry.lock` (`_carry_slot_take` ≈:25330, non-blocking: a contended slot skips the uuid and says so). Any uuid with a `swap` journal row newer than 24 hours is skipped. A live session's own transcript is the keeper by rule 2 and is never written.
- **Who may run `--apply`.** The operator only. It refuses when `CLAUDECODE` is set, without a TTY, or inside a `cc-*` pane: the same three speed bumps `ccrc history`'s writing verbs carry (`2026-10-05` §8.4). Those bumps live in `ccd/history/lib.mjs`, and ccd's bash cannot call them, so the verb needs a bash twin. That is legitimately different (another process and language), and the twin is pinned to the same three conditions. CLAUDE.md's SAFETY section gains the line. **No timer runs `--apply` in this programme**, and the server never composes it: it has no `CCD_ARGV` row and no agent whitelist entry.
- **Each act is journalled.** A new act word, `dedupe`, is added to the closed vocabulary in both twins (`_LC_ACTS` in ccd, `LIFECYCLE_ACTS` in `shared/api.ts`; `ccd-lifecycle-emit.test.ts` keeps them equal). Each row carries the uuid, the copy's account, the bytes returned and the proof arm.

**Alternatives rejected:**
- Linking transcripts: the carry's own header forbids it (§1.1).
- A separate dedupe program or timer: a parallel mechanism beside the carry's.
- Letting the server run dedupe as a lane: a new destructive lane with no ruling to arm it, on content the policy's Open Question 1 still holds as possibly operator-permanent.

### 2.3 #318 item 1 residue: the audit must refuse what the pin refuses

- **Chosen:** the ladder reads HEAD's symbolic ref beside `RECLAIM_HEAD`. When HEAD is symbolic to `refs/heads/<branch>` and `_ws_reclaim_tip_read` has proven that branch absent, the ladder refuses with a new terminal word, `branch-gone-checked-out`, before any token is minted.
- **One predicate, two callers:** the pin's guard (≈:31465) and the ladder call one helper, `_ws_reclaim_head_unborn`, so the audit cannot drift from the act again.
- **Its kind is `terminal`** in `EXPIRE_TOKEN_KIND` and in child reclamation's kinds. It is reported once (attention) and not asked again until the row changes. Calling it `retry` would rebuild the old retry loop.
- **Rejected:** (a) letting the pin commit WIP with no parent. That would make an unrelated root commit and lose the branch context. (b) Treating it as `unmeasured`. It is a measured fact, and `unmeasured` is retried.

### 2.4 #318 item 2: a stale `index.lock` is not a busy tree

- **Chosen:** rung 6 classifies the lock before refusing. It is **stale** when all of these hold:
  - the lock is a regular, empty file;
  - its mtime is older than `WS_INDEX_LOCK_STALE_S` (6 hours);
  - the existing process probe names no holder of it (`_ws_path_users` ≈:31966, the same walk the `in-use` rung uses).

  A stale lock passes the rung, and the audit document and the journal carry `staleLock: <path>`. A lock that is held, non-empty or young is `tree-busy`, exactly as today. A probe that cannot run is `unmeasured`, never stale.
- **The verb never deletes the lock on its own.** The tail removes the whole tree, the lock with it, after the pin. The pin copies the index through a scratch file and never takes the lock (git replaces an index by rename, ≈:30090), so a stale lock cannot tear the copy.
- **The same rule covers the nested checkout's twin** (≈:30190).
- **Rejected:** (a) deleting the lock in the audit, because an audit never writes; (b) a `--defer-expired` for expiry, which the expiry contract refuses on purpose; (c) a new terminal word, which would hand the operator a chore the box can prove safe.

### 2.5 #318 item 3: the permission pass skips ignored build directories

- **Chosen:** `_ws_reclaim_normalise` prunes directories named `node_modules`, `cdk.out` or `dist` that git reports as ignored (`git check-ignore -q`, run contained like every other git call on this path). The bound stays 30 s.
- **Why it is safe:**
  - The pass exists so that git's reads of the tree are honest (a mode-000 directory answers `git status` clean), and git never reads inside an ignored directory.
  - The ignored scan (`_ws_collect_ignored`) still walks those directories for secret-shaped files under its own bound, and it refuses on a `find` error. An unreadable entry inside a pruned directory therefore still stops the audit, just through a different rung.
  - The tail's removal of an entry it cannot remove answers `worktree-remove-failed` after everything is pinned, which is resumable.
- **Rejected:**
  - Raising the bound toward the runner's 90 s (`server/src/remote/runner.ts` ≈:49): `ws-audit` holds the reap lock meanwhile, and a slower audit only moves the timeout.
  - A per-entry bound: `_ws_collect_ignored`'s comment measured that shape costing 226 bounds.

### 2.6 #318 item 4: a ceiling for review children

- **Chosen:** once the review child's own run has been closed for more than `REVIEW_CHILD_CEILING_MS` (7 days, the same horizon as expiry) and the run it reviewed is still not terminal, the verdict answers a new kept word, `review-report-stale`, in place of `review-report-live`. It joins `CHILD_RECLAIM_SKIP` as class `kept` (≈:530), so the banner lists the child. Its sentence names the reviewed run and says the child is reclaimed once that run closes.
- **Coordinator first.** The attention row reaches the reviewed run's coordinator first (the coordinator-first routing ruling, 2026-10-17). The release is the coordinator's existing act: closing or abandoning the reviewed run makes it terminal, and the next pass reclaims the child.
- **The input is a column that already exists:** the review run's `closedAt` (`runs`, `coord/schema.ts` ≈:91). No schema change.
- **Rejected:**
  - Reclaiming after the ceiling: the coordinator cites the report's path in fix-round mail, and deleting it would lose evidence a still-open run needs.
  - A coordinator "release review child" verb: a second door beside the run's own close.

### 2.7 #120 folded into #318: the ranked bytes total

- **Chosen:** a pure L1 function in `server/src/archivedExpiry.ts`, `rankArchivedHeld(rows, verdicts)`, joins each archived row's `archivedBytes` to the expiry lane's latest verdict for it. A verdict is its word and kind, or `not-yet-audited`. The result is ranked by bytes, descending, with the total and a count of rows whose size is unmeasured (`null` counts as unmeasured, never 0).
- **Where it is read:** the lane's L4 owner composes it once per pass. `GET /api/fleet/health` carries it as an additive, optional block, `archivedHeld`. Absent means unknown, under the wire's absence-permits rule.
- **It renders in shadow too,** because the shadow is exactly when the operator needs it.
- **No PWA file in this programme.** The PWA's health card for it belongs to the PWA epic (the consolidation wave's W7), which must meet the UI rule (360, 390, 1280 and 1920 wide, both skins, both themes). Until then it is read from the route.
- **Rejected:**
  - A second scan with `du`: the bytes are already measured once per archive.
  - Computing it in the PWA: that puts a server fact in the client, which K14 forbids.

### 2.8 #124: repair drift or flag it, and reset the PR fields or filter by branch

- **Drift: flag, never repair (unchanged).** ccd keeps its shipped stance (§1.3): repairing `.branch` from HEAD on a timer would silently re-bind PRs and append irreversible ledger rows. `ccd ws-rename` stays the one reconciling act, and it is the operator's. This programme pins that no reader repairs it. The pin goes in `ccd-pr-state.test.ts`: drift answers `unknown`/`branch-drift` and leaves `prnumber`, `prphase` and `.prhistory` byte-identical.
- **Reuse: filter by branch, never erase.**
  - **Chosen:** every server reader of `.prhistory` counts a row only when its `branch` equals the branch it is asking about: the session row's registry `branch` in `childSpent`, and the run's `branch` in `closeRun`'s fold.
  - A row whose branch differs is not evidence for this workspace. In `childSpent` that makes the verdict fall through to the live rung, which measures and moves toward keeping, never toward reclaiming.
  - `readPrHistory` already returns `branch` (`server/src/coord/prhistory.ts` ≈:121-123), so the reader set does not grow.
- **Reset rejected.** Erasing `.prnumber`, `.prphase` and `.prhistory` on a branch change would destroy the append-only lineage that archive manifests fold ("prhistory intact"). It would also add a second writer to the chokepoint, which is the only line allowed to replace `prnumber`. A purged slug is already clean (`_ws_slug_free`).
- **The merge-safety point the issue makes stands:** `ws-reap`'s Phase C proves a merge by patch-id and reachability, not by the registry's PR fields. This programme changes nothing there.

## 3. How it fits the consolidation wave

The consolidation design is a draft, rev 1, not on `main`. These fits follow its rev 1. If its rulings move a boundary, the plan's tasks keep their content and only their owner names change.

| Task | Context | Cluster and wave | Why it lands first |
|---|---|---|---|
| carry receipt, `carry-dedupe` | C1 Fleet Registry & Accounts (swap and carry stay bash at the OS edge, §5.13) | none: carry is listed as "what stays" | The receipt rides the existing `swap` journal row (C1's facts recorded). No new writer per fact. |
| gone-branch ladder refusal, stale lock, permission prune | C4 Workspace Lifecycle, ccd side | K2, W5 (`_ws_reclaim_ladder` is "SHARED by `_ws_reclaim_eval` and `_ws_expire_eval`") | W5 moves shared helpers and pins their behaviour. Landing these first means W5 characterizes the corrected ladder, not the one that loops. |
| review-child ceiling | C4, server side | K1, W4: a per-reason evidence rule of `child-spent` | It is "legitimately different" evidence that K1 keeps as a per-reason policy row. When `decideRetire` lands it moves as a row, unchanged. |
| ranked held bytes | C4 read model of the `archive-expired` reason | K1, W4 | It is the reason's read model. It writes no feed row, so the K6 funnel is not involved. |
| `.prhistory` branch filter | C4 (the PR half stays in C4: "the PR ledger … are evidence for the `merged` retire reason") | none | It narrows evidence. It adds no reader. |

**What none of these does:**
- touch `_auto_swap_check`, `_swap_idle_gate`, `_swap_target`, the pool grammar or the strand path;
- add a server lane, a timer, a switch or a feed writer;
- change `CCD_ARGV`, the agent whitelist or `FLEET_PROTO`.

## 4. What must not break

- **Account switching is never blocked.** The receipt is three more key-value pairs on a journal call that always returns 0. The swap's rc, its refusal sentences and its timing are unchanged. A pin asserts that a receipt write that fails still swaps.
- **No herd restart.** No task restarts a supervisor or requires a roll. ccd changes ride the next ordinary release, agent lane first.
- **Hibernation's contract and coordinator-first routing.** The review-child attention row goes to the coordinator first. Nothing reads or writes `hibernate-live`.
- **The SAFETY rules.** `ws-reclaim` and `ws-expire` stay the server's acts. `carry-dedupe --apply` joins the operator-only list. Tests use fixture HOMEs only (`makeCcdHarness`), and no test runs a verb against a live box.
- **The ladder's TOCTOU guard.** Every new rung and classification runs inside the verb's in-lock recompute as well as at the audit, through the one shared ladder.
- **Expiry's "presence defers without a ceiling".** A held `index.lock` is still `tree-busy` and still retried. Only a lock the box proves stale passes.
- **Wire discipline.** `archivedHeld` is additive and optional, and the new words are added to their L0 tables (`EXPIRE_TOKEN_KIND`, `CHILD_RECLAIM_SKIP`, `LIFECYCLE_ACTS`). An older PWA ignores all of it.
- **The UI rule.** No `pwa/` file changes in this programme. Any later card meets 360, 390, 1280 and 1920 wide × refined and instrument × dark and light, and a card stays a glance whose header is a superset.

## 5. Tests

Each task's red-first cases and mutation table are in the plan. In summary:

- `ccd-carry-receipt.test.ts` (new): the receipt's three fields on a plain, a sanitized, a forced and a deferred carry; a failed journal write still swaps.
- `ccd-carry-dedupe.test.ts` (new): keeper order, ties skipped, the prefix arm, the uuid-superset arm over a sanitized copy, a line that does not parse keeps the copy, sidecars linked never unlinked, the 24 h quiet, the contended `.carry.lock`, and `--apply`'s three refusals.
- `ccd-lifecycle-emit.test.ts` (existing): `dedupe` in both twins.
- `ccd-child-reclaim-ladder.test.ts`, `ccd-ws-expire-ladder.test.ts`, `ccd-child-reclaim-gone-branch.test.ts` and `archived-expiry-policy.test.ts`: `branch-gone-checked-out` refused before a token, terminal on both lanes; stale versus held versus young versus non-empty locks; an unmeasured probe; the ignored-build prune, with an unreadable entry inside it still refused by the ignored scan.
- `child-reclaim-sweep-policy.test.ts`: `review-report-stale` past the ceiling, `review-report-live` before it, and the class table.
- `archived-expiry-lane.test.ts` and `fleet-health.test.ts`: ranking, `null` bytes counted as unmeasured, a block absent before the first pass.
- `ccd-pr-state.test.ts`: the drift pin. `child-reclaim-spent.test.ts` and `run-routes.test.ts` (the close fold): rows for another branch are ignored.

## 6. Open operator question

**Q1. Unregistered worktrees (#318 item 5).**
- **The question:** may anything collect worktrees under `<project>/.claude/worktrees`, which Claude Code's own subagent and workflow mechanism creates, and if so on what evidence?
- **Why it is open:** the lifecycle policy's row 6 is UNASSIGNED pending its Open Question 6, and ccd's rule is "ccd removes only what it created". Assigning an owner is a policy decision this programme has no standing to make.
- **What this programme does meanwhile:** nothing destructive. The ranked held-bytes read model (§2.7) covers registry rows only. The ccd-root orphans (row 5) keep their existing operator verb, `ws-gc --prune`, and automating them would be a new `retire` reason under K1 (W4), which is out of scope here.

**Recommendation for the ruling:** treat row 6 as Claude Code's own scratch. Collect such a worktree only when all of these hold:
- it is clean;
- its HEAD is reachable from a remote ref;
- no process holds a cwd, fd or `TMPDIR` in it;
- it has been idle seven days.

Collect it through ws-gc's existing orphan rules, as an audit-token pass, never with `--force`.

No other question in this design needs the operator. Two acts are the operator's whenever they choose, and nothing here depends on them: running `ccd carry-dedupe --apply`, and arming the expiry lane (`expire-lane-live`).

## 7. Review log

**rev 0 (2026-10-20).** Written against `origin/main` `4bc6c756d`, the three issues and their GitHub twins, the #120 duplicate, and the consolidation draft rev 1. Re-checking the issues against `main` narrowed #318 item 1 to the symbolic-HEAD residue and #124 to the two `.prhistory` readers.
