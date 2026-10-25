# Fleet disk retention: live scratch, orphan worktrees, loose temp entries and a disk alarm

**Spec** · 2026-10-23 · Status: draft for review, rev 3. It implements the operator's four rulings of 2026-10-23 on #1119, the operator's answers to rev 0's open questions, and the operator's four lifecycle-exit rulings G1 to G4 of the same day (posted on #1167 and #1119); the rulings are fixed, and every question is ruled (§9) · Owner: the ccrc coordinator · Issue: #1119 (the incident, with the rulings as its comment) · Plan: `docs/superpowers/plans/2026-10-23-fleet-disk-retention.md`

**Related:** `2026-08-11-artifact-lifecycle-policy.md` (rows 5, 6 and 9, Tier C, Open Questions 6 and "declared byte budget per box"), `2026-09-22-child-workspace-reclamation-design.md` §5.10 (`ws-collect`), `docs/superpowers/programs/child-reclamation-contract.md` (R38, R57, R59), `2026-10-20-workspace-disk-and-registry-truth-design.md` (#840: §6 Q1's orphan rule, the `archivedHeld` block, the stale-lock rule D-5945), `2026-10-12-path-identity-design.md` with open PR #1132 (W3: which tree `git worktree remove` may delete), `docs/superpowers/plans/2026-10-08-server-test-run-tmp-parent.md` (#337, its deferred Task 5 and "proposal 3, the sweeper"), `2026-10-19-ccrc-consolidation-wave-design.md` (K1 retire reasons, K6 funnel, K12 switches), `2026-09-24-workspace-lifecycle-design.md` (L3, rung 2′: expiry and children), the stop-done and hibernation lanes (`server/src/stopDone.ts`, `server/src/coord/hibernate.ts`), #298, #316, #317, #318.

## In short

The fleet work volume filled to 99% twice in two days. Four classes held most of it, and three of them had no owner in ccrc. The operator ruled that the prevention belongs to ccrc, not to box-local timers. This spec builds each ruling on the mechanism that already owns the neighbouring class, so no new collector competes with an old one on the same files.

- **Ruling 1, live scratch.** `ccd-tmp-sweep` gains a **live arm**. Inside a live session's `scratchpad/` and `tasks/`, it moves a top-level entry that has been untouched for 14 days and that no process holds (cwd, fd, file mapping or `TMPDIR`) into a quarantine, and deletes it 24 hours later if still unheld. The server mails the session what was moved. A **size budget that enforces** bounds what the age rule cannot. Over 20 GiB, the session and its coordinator are mailed. After a 24-hour grace (none at critical pressure), the oldest entries untouched for 48 hours, unheld and with git work rescued, are removed oldest-first until the session is under 15 GiB. #1119 item 1, the cap on finished task `.output` logs, rides the same arm.
- **Ruling 2, orphan worktrees.** A new server lane, shaped like the temp-root collector, removes a linked worktree that no registry row names, under #840 §6 Q1's rule: clean, HEAD on a remote, no holder, idle 7 days, an audit token, never `--force`. It covers the ccd worktree root and `<project>/.claude/worktrees` and `<project>/.superpowers/worktrees`. Anything else is left and reported. A tree that fails only "HEAD on a remote" can be rescued (its commits pinned under the attic) and then removed, behind its own arm. This resolves the lifecycle policy's Open Question 6.
- **Ruling 3, `~/.cc-tmp`.** D-5888 is reversed. `ws-collect` gains a **loose arm**: an entry of `~/.cc-tmp` with no witness and no `.child`/`.uuid` row, ctime-quiet for 48 hours and unheld, is collected through the same quarantine, token and re-proof as a witnessed leaf. #337's two deferred follow-ups land with it: vitest's own `tmpDir` joins the run's signal arm, and `ccd-tmp-sweep` collects a dead run's `ccrc-testrun-*` root that no later run revisits.
- **Ruling 4, the disk alarm.** The agent reports `statfs` for every fleet work filesystem and whether each listed work mount is mounted. `GET /api/fleet/health` carries a `disk` block. The server raises a banner and an operator notification at 85% and a critical one at 92%. At critical, each sweep measures its own filesystem and runs in **pressure mode** with shorter, fixed ages. Doctor's `_check_disk` measures the work filesystems rather than `$HOME` alone. ccrc takes over the box-local disk guard's bind-mount check, and the guard is deleted.
- **Wave 5, lifecycle exits (G1 to G4).** Four classes of workspace never left the fleet. Each gets an exit through the lane that already owns its neighbour:
  - **G3:** the reclaim and expiry ladder's rung 9 stops refusing a nested repository whose work is on none of its remotes. It **rescues it into the attic, then proceeds**. The orphan ladder's nested-checkout rung gets the same rescue. The source is fixed too: test runs and workflow steps keep their temp under the session's `TMPDIR`, never inside the tree.
  - **G2:** a child kept as held, run-absent, under review or behind a terminal refusal, and idle 7 days, is reclaimed through the normal pin, and its coordinator is mailed. A child that coordinated is still never taken.
  - **Archived children:** `ws-expire` accepts an archived child 7 days after its archive, so "archived" always means "gone in 7 days".
  - **G1/G4:** a non-child, non-coordinator session with no pane for 14 days is archived, and expires 7 days later. Trees nested inside coordinators' workspaces go through the orphan-tree rules.

Every destructive arm ships in shadow, writes "would" rows first, and is armed by a marker with no writer in the tree. Thirty-one tasks, one PR each, in five waves (§8).

## 1. The problem, measured

Code citations are to `origin/main` `a68c90f15`. Line numbers are hints, written `≈:`, and each names its function. Box figures were measured read-only on a fleet host on 2026-10-22 and 2026-10-23 (the issue body, its rulings comments, and rev 1's trace of the `.tmp-step0` trees, §1.4).

### 1.1 What filled the volume

A 673 GiB work volume reached 99%: about 650 GiB used and 22.5 million inodes.

| Class | Size | Owner in ccrc on `main` |
|---|---|---|
| Live sessions' Claude scratch, `<T>/claude-<uid>/<key>/<uuid>/{scratchpad,tasks}` | ~194 GiB in 24 live sessions; one long-lived coordinator held 91 GiB, mostly dozens of full repository copies made for review lenses | none. `ccd-tmp-sweep` skips a live session's unit whole |
| Transcripts and sidecars under the config dirs | 188 GiB real, at most 53 GiB of it cross-account copies | #317 / #840 P4-7 to P4-9, unlanded (out of scope here) |
| Worktrees: the ccd root, `.claude/worktrees`, `.superpowers/worktrees` | ~99 GiB; about 300 trees with no registry row | none. `ws-gc --prune` is operator-only; `.claude/worktrees` is policy Open Q6 |
| `~/.cc-tmp` | ~74 GiB, mostly leaked vitest run roots, many for workspaces that no longer exist | witnessed leaves only (`ws-collect`); loose entries declined by D-5888 |

The day before, one coordinator alone held about 70 GiB: a 26 GiB working folder written inside its own transcript directory, 10.7 GiB in three background-task `.output` logs from one day, and 31 GiB of finished workflow copies in its scratchpad.

Two passes by hand freed about 18 GiB and then about 118 GiB. Each deleted nothing without a holder check and a quiet check. This spec automates what those passes proved safe.

### 1.2 What exists today, and its gap

- **`ccd-tmp-sweep`** (`ccd/ccd-tmp-sweep`, hourly user timer). Its population is `${TMPDIR:-/tmp}/claude-<uid>`: each `<project>/<uuid>` unit plus loose top-level entries (≈:264-279). It removes a unit only when it is **not live** (`_ts_collect_live` ≈:175-232: uuids from claude argv, `sessions/<pid>.json`, hibernated rows), **not in use** (`_ts_holder` ≈:244-248: `/proc/*/cwd` and `/proc/*/fd` only) and **not recent** (`_ts_age` ≈:251-258: mtime, `CCD_TMP_SWEEP_MAX_AGE_DAYS=7`). It deletes with `rm -rf --one-file-system` after a re-check, with no quarantine. Its record is one summary line in the journal; nothing in the server reads it. **Gap:** a live unit is skipped whole, however old its contents.
- **`ws-collect`** (spec 2026-09-22 §5.10; ccd `cmd_ws_collect` ≈:37765; server `collectLane.ts`, `coord/collectTempRoot.ts`, `watch.ts` `sweepTempRootCollect` ≈:4953). Its population is the two registry listings `$REG/tmproots/` and `$REG/tmpquarantine/` (`collectPopulation` ≈:418-458), never `~/.cc-tmp` itself. A name with no witness answers `not-witnessed` (`_ws_collect_audit_contained` ≈:37022, `cmd_ws_collect` ≈:37841). Its floor is newest ctime ≥ `max(86400, knob)`; it moves by rename into `.ccd-quarantine`, re-proves, then removes. **Gap:** every unwitnessed leaf and every loose file is "the operator's" (R57, R59), and D-5888 declared that class ownerless.
- **`ws-gc`** (`cmd_ws_gc` ≈:16075). Its scan (`_ws_gc_scan` ≈:15581) lists every linked worktree of every checkout under `$PROJECTS_ROOT`, and its classifier (`_ws_gc_row` ≈:15491) calls a tree `orphan` only at exactly `$WORKTREES_ROOT/<project>/<slug>`; `.claude/worktrees` trees are `foreign`. The `--prune` orphan arm (`_ws_gc_prune_row` ≈:15911-16052) checks dirty, HEAD, detached, merged-into-`origin/HEAD`, ignored secrets and nested checkouts, then `git worktree remove` without `--force` and `git branch -d`. **Gap:** no holder probe, no idle check, no token; and `ws-gc` is in `UNGRANTABLE_VERBS` (`agent/src/whitelist.ts:370`), so nothing but a human runs it.
- **Disk guards.** `ws-add` refuses below `CCD_DISK_FLOOR_GB` (10 GiB free on `$WORKTREES_ROOT`, `ccd/ccd` ≈:6998-7015, ≈:7271). Doctor's `_check_disk` (`ccd/ccrc-doctor-checks` ≈:2279-2343) reads `df -Pk "$HOME"` only, against 2 and 10 GiB absolute. Neither reaches the server. The agent has no statfs op, `FleetIO` has no statfs member, and `/api/fleet/health` carries no disk figure. **Gap:** the server learns of a full disk only when things start failing.
- **The run root (#337).** `server/test/run-tmp.globalsetup.mjs` reaps a dead run's `ccrc-testrun-*` root once quiet, but only when a later run starts under the same `TMPDIR` (≈:59-61). Its plan deferred two items: vitest's own `TestProject.tmpDir` in the signal arm (dropped Task 5) and "proposal 3, the sweeper" for roots no later run visits.
- **Mail from the box.** No box-side script sends mail. `POST /api/mail` needs a registry sender with a matching uuid (`coord/routes.ts` ≈:865-907). The server's own system mail is sent as the `coordinator` or `operator` role (`SYSTEM_MAIL_SENDER_MAP`, `coord/rundefs.ts` ≈:229).

### 1.3 Where Claude Code's scratch lives

Two in-repo measurements disagree on `<T>`. The 2026-10-17 routing plan (≈:536-545) says `<T>` is `$CLAUDE_CODE_TMPDIR`, else the literal `/tmp`, and that `TMPDIR` is not consulted. The child-reclamation ledger (`docs/superpowers/programs/child-reclamation.md` ≈:2937) says the scratchpad follows `TMPDIR`. A workstation running Claude Code 2.1.308 keeps its scratchpad under `/tmp/claude-<uid>` while `TMPDIR` names another directory.

**Settled (rev 1):** the operator's ops pass observed **both** on a fleet host. One child's scratch sat under `~/.cc-tmp/<id>/claude-<uid>/…/scratchpad`, and the 194 GiB of live scratch sat under `/tmp/claude-<uid>`. The live arm therefore walks both kinds of root (§2.1), and the operator ruled that a child leaf's scratch is swept under the same rules (§9.1 Q7).

### 1.4 Workspaces that never leave (rev 1)

A trace of a coordinated child's lifecycle against `main` found why the fleet listed Done 11, Dead 50 and Archived 16 of 110 rows, all holding disk, while 12 worked:

- **Stranded by a nested repository (G3).** A workflow script's shared prompt told every step to `export TMPDIR="$PWD/.tmp-step0"` inside its isolated worktree (`<project>/.claude/worktrees/wf_<run>-<n>`). Nothing in ccrc or Claude Code chose that path. The agent writing the script did. The suite's per-run parent (#316) then refused, because its `live.sock` path passed the 108-byte socket limit under that deep `TMPDIR`. So fixtures, test-fixture git repositories among them, went loose into the tree. Those repositories hold commits on no remote. The ladder's rung 9 calls that `containment-unproven`, which is **terminal** (spec 2026-09-22 ≈:400, contract §3 ≈:160). Nothing ever asked again, and the untracked files also kept Claude Code from cleaning its own worktrees.
- **Kept children (G2).** `childReclaimSweepVerdict` (≈:616-710) keeps a child for good on `held` (≈:621), `minting-run-absent` (≈:630), `review-report-live` or `review-report-stale` (≈:687-690), and `terminal-refusal` (≈:623). Nothing in the sweep ever retries a terminal child. Its input carries no idle time at all (`ChildReclaimSweepInput` ≈:416-452).
- **Archived children.** `ws-expire` refuses any row with a `.child` marker (`_ws_expire_not_child` ≈:34870), and the expiry lane skips them (`archivedExpiryVerdict` ≈:387). Child reclaim, meanwhile, does not consider archive. `close.ts` archives a failed child whose reclaim decision is no (≈:569-571), and from then on no lane owns it.
- **Dead non-children (G1).** No lane archives a session that lost its pane. `ws-archive` is composed only by the archive door and by `close.ts`. The stop-done and hibernation lanes hibernate, and hibernation is not an exit.
- **Coordinators' nested trees (G4).** A coordinator's workspace is never reclaimed (rule 4, R37), so the Claude Code worktrees inside it, `<workdir>/.claude/worktrees/*`, have no exit at all.

**Context, not design input:** the operator armed `expire-lane-live` on a fleet host on 2026-10-23, with the go-ahead given that day. Its shadow feed had shown overdue archived workspaces since 2026-09-30. `collect-lane-live` was already present. Neither changes this design. Archived workspaces now leave in 7 days, which is why the exits above all route into archive or the existing pin.

## 2. Decisions

Each ruling's design names the existing owner it extends, the exact rule, and the alternatives rejected. Where a rule says "untouched", "quiet" or "idle", it means **every** entry under the candidate, walked without following links and without crossing a filesystem, under a bound; a walk that hits its bound answers `unmeasured`, which keeps the candidate.

### 2.1 Ruling 1: the live arm of `ccd-tmp-sweep`

**Owner.** `ccd-tmp-sweep` is already the collector of this class (lifecycle row `claude-tmp-session-dirs`, policy row 9). The live arm runs in the same program, under the same lock and pause file, after today's pass. Today's dead-unit rules are unchanged.

**Roots.** The sweep walks each of these that exists, is a directory owned by this uid, and resolves physically where it should:
1. today's root, `${TMPDIR:-/tmp}/claude-<uid>`;
2. `/tmp/claude-<uid>`, when it differs from (1) (§1.3);
3. `<physical ~/.cc-tmp>/<id>/claude-<uid>` for each witnessed child leaf whose row is live (observed on a fleet host, §1.3; ruled §9.1 Q7).

A root is listed in the census with the arm that read it, so a root added or missing is visible.

**Population.** Only units today's pass classifies **live**. For each, the candidates are the direct children of `<unit>/scratchpad/` and `<unit>/tasks/`. The unit itself, `scratchpad/` and `tasks/` themselves, and anything else in the unit are never candidates.

**Who is told.** The unit's uuid is mapped to a registry id by reading `$REG/*.uuid` once per pass (read-only). A live unit whose uuid no row holds (a session ccd did not start) is skipped and counted as `live-unmapped`: it cannot be told, so it is not swept.

**The rule.** A candidate moves only when all of these hold, measured at the pass and again immediately before the move:
- **untouched 14 days:** every entry under it has mtime and ctime older than 14 days, and every regular file has an atime older than 14 days, unless its filesystem is mounted `noatime` (then atime is not read, and the census says so). Directory atimes are never read, because the sweep's own walk refreshes them. The walk is `find -P <c> -xdev` under `LC_ALL=C`, bounded at 30 s per candidate and 2,000,000 entries per pass;
- **unheld:** `ccd path-users` (§2.6.1) answers nobody for the candidate on both its literal and physical spellings: no process of this uid has its cwd, an open fd, a file-backed mapping, or a `TMPDIR` equal to or under it;
- **arm live:** `~/.ccrc/tmp-sweep-live-arm` exists. Without it the arm records "would move" and touches nothing;
- **not paused:** `~/.ccrc/tmp-sweep-paused` is absent (today's brake).

**The act: quarantine, then delete.** A moving candidate is renamed, without replacing, to `<root>/.ccd-tmp-quarantine/<uuid>/<ns>.<name>` on the same filesystem. On a later pass at least 24 hours on, the sweep asks the holder probe once more about the quarantined path and then removes it with `rm -rf --one-file-system`. Until then the session can move it back; the mail says how. A held quarantined entry stays and is re-asked next pass. A rename that fails leaves the entry where it was and counts as `failed`.

**The census.** The sweep replaces `~/.ccrc/tmp-sweep.json` atomically at the end of every pass. It is the only writer. Its shape is `{v:1, at, liveAt, pressure, arm:'shadow'|'live', roots:[…], sessions:[{id, uuid, bytes, scratchBytes, tasksBytes, entries}], moved:[{seq, id, uuid, name, kind, bytes, at, shadow, quarantine}], counts:{…}}`. Each session row also carries `budget: {state, overSince, enforceAt, removedBytes, kept:[{name, why}]}` (§2.1.1). `seq` is monotonic across passes. `moved` keeps the last 1,000 rows or 7 days. `kind` is `scratch`, `budget`, `task-output`, `output-capped` or `test-run`. A `test-run` row names no session: its `id` and `uuid` are both empty strings, and the server's reader parses them as "no session" and mails no one about the row (D-6854).

**Mail and the budget notice (server).** The server reads the census through the agent's node-file reads (a new `NODE_FILES` key, `tmpSweep`). For each session with new non-shadow `moved` rows it queues one system mail per pass from the `operator` role, kind `status`, subject `tmp-sweep: moved <n> entries (seq <a>-<b>)`, deduplicated by `hasMailWithSubject`. The body lists each entry, its size, its quarantine path and the sentence "move it back before <time> to keep it". The **budget notice** reads `sessions[].budget`. When a session's `overSince` is new, it mails the session and its coordinator: for a run's worker that run's `claimedBy` (`resolveCoordinator`), and for a session that coordinates, no one else. It is sent once per over-budget episode, keyed on `overSince`. Its body names the total, the five largest entries, and the instant `enforceAt` after which the sweep removes entries untouched for 48 hours, oldest first, until the session is under 15 GiB. At critical pressure the body says enforcement has already begun. Budget removals reach the session in the ordinary receipt mail, as kind `budget` rows with their quarantine paths. Entries the budget had to keep (held, touched within 48 hours, or git work that could not be rescued) are listed too, with why. The notice deletes nothing, so it ships live. The enforcement rides the live arm's switch.

**Cadence.** The live arm runs at most every 6 hours (`liveAt` in the census); under pressure it runs every pass.

#### 2.1.1 The size budget enforces (operator ruling 2026-10-23 (3))

The age rule cannot bound a busy coordinator's scratch. After a 7-day pass, five busy coordinators still held about 105 GiB, nearly all of it younger than a week: full repository copies made for each review lens. So the live arm also enforces a size budget:
- **What counts:** a session's `scratchpad/` and `tasks/` under every root the arm walks, a child leaf's `~/.cc-tmp/<id>/claude-<uid>` included, summed across the session's units (every `<key>` for its uuid). Quarantined bytes do not count: they sit outside the unit, waiting for their grace.
- **Over budget:** above `CCD_TMP_BUDGET_GB` (20). The sweep records `overSince` on the first pass that measures it over, and `enforceAt` = `overSince` + 24 hours. At critical pressure (§2.5.1), `enforceAt` = `overSince`, so there is no grace.
- **Enforcement:** on a pass at or after `enforceAt`, if the session is still over 20 GiB, the sweep ranks the top-level entries of its `scratchpad/` and `tasks/` by newest touch, oldest first. It takes them in that order until the session's counted bytes fall under `CCD_TMP_BUDGET_TARGET_GB` (15). An entry is taken only if all of these hold:
  - it is untouched for 48 hours, by the same rule as §2.1 (mtime and ctime of every entry, and regular-file atime unless `noatime`);
  - the holder probe answers nobody;
  - its git work is rescued. An entry that is or holds a repository with work on none of its remotes (dirty, or commits no remote has) is rescued first through DR-20's `_ws_nested_rescue`, reached by the box-local entry `ccd scratch-rescue` (privileged, forbidden to sessions, called only by the sweep), into the session's own project repository's attic under `refs/ccrc/attic/<id>/scratch/<namehex>/`. Until DR-20 lands, or when the session has no project repository or the rescue fails or passes its 512 MiB bound, the entry is kept, with why `git-work-unrescued`.
- **The act** is the live arm's: the same quarantine rename, and deletion after the quarantine grace (24 hours, or 1 hour under pressure, §2.5.3), with a fresh holder ask.
- **What it never does:** take an entry touched within 48 hours, even if the session stays over budget. The census then reads `budget.state: 'over-unremovable'`, and the notice's episode stays open. It never takes `scratchpad/` or `tasks/` themselves, or the unit. It never acts on a session that is `live-unmapped`.
- **Episode end:** the budget episode ends when the counted bytes fall under 15 GiB. A later rise over 20 GiB starts a new episode with a new notice and a new grace.
- **Arming:** with the live arm. Without `~/.ccrc/tmp-sweep-live-arm`, the census records "would remove (budget)" rows and touches nothing. The notice is sent either way.

The age rule of §2.1 and the budget run in the same pass. The age rule goes first, so the budget counts what it left.

**#1119 item 1, task output.** On the same arm and switch, a `tasks/*.output` regular file larger than 1 GiB, unheld and with mtime older than 1 hour, is rewritten as its first 64 MiB, one marker line naming the bytes cut, and its last 64 MiB: written to a temp file in the same directory and renamed over the original. The census row is `output-capped`, and the mail lists it.

**Alternatives rejected.**
- A second sweep or a server lane for live scratch: a second collector on the same root (the policy's "D-36 lesson", ≈:59-62).
- Deleting in place, as the dead arm does: a live session may still want a file it last read weeks ago; the 24-hour quarantine makes the act reversible inside the session's own working day.
- Sweeping a live unit whole, or `scratchpad/` itself: the session's open working set lives there.
- Mail from the box: there is no box sender (§1.2), and impersonating a session's own id would break mail's attribution.

### 2.2 #337's follow-ups: run roots no later run revisits

- **vitest's `tmpDir` (the dropped Task 5).** `run-tmp.globalsetup.mjs`'s `setup(project)` passes `project.tmpDir` to its signal arm, which removes it (lstat, a directory owned by this uid) on a signal, exactly as the 2026-10-08 plan wrote it.
- **The sweeper (proposal 3).** `ccd-tmp-sweep` gains a **test-run arm**. In each `TMPDIR` the sweep knows of (the box's own, and each witnessed live child leaf `~/.cc-tmp/<id>/`), a top-level entry matching `^ccrc-testrun-[A-Za-z0-9]{6}(\.dead)?$` is removed when its `live.sock` has no listener (no row in `/proc/net/unix` bound at that path, the liveness the run itself uses, D-4499), its newest ctime is older than 6 hours, and the holder probe answers nobody. It removes by renaming to the `.dead` twin and then `rm -rf --one-file-system`, as `condemn` does. It shares the live arm's switch and shadow rows. A leaf whose row is gone is not this arm's: `ws-collect` takes the whole leaf (§2.4).

### 2.3 Ruling 2: the orphan-worktree lane

**Owner and shape.** No collector owns these trees, so this is a new lane. It is the server's act through an agent-whitelisted verb with a token re-proved on the box, built on the collector's template: an L1 decider, an L3 executor, an L4 tick in `watch.ts`. Its evidence rules are `ws-gc`'s orphan rules plus the holder, idle and remote checks #840 §6 Q1 recommends, in one rule set the census, the audit and the verb share. `ws-gc --prune` keeps its operator use and calls the same rules. When the consolidation wave's W4 lands `decideRetire`, this lane becomes one reason row beside `temp-orphan` (both are acts on a directory with no registry row).

**Population: one census.** `ccd ws-audit --orphans` (read-only) runs `_ws_gc_scan`'s listing and classifies each linked worktree by location:
- `ccd-root`: exactly `$WORKTREES_ROOT/<project>/<slug>` with no `$REG/<project>-<slug>.uuid`;
- `claude`: `<main>/.claude/worktrees/<name>`;
- `superpowers`: `<main>/.superpowers/worktrees/<name>`;
- `other`: anywhere else. Reported only, never audited for removal.

Each row carries the path as hex, its class, main checkout, branch or `detached`, HEAD, the `locked` and `prunable` flags, and the report-only age in days. The census is bounded at 4,096 rows and 60 s; past either it answers `truncated` and the lane audits nothing new that pass. Directories under those roots that no `git worktree list` names are reported `not-a-worktree` and are the operator's.

**The audit: one ladder.** `ccd ws-audit --orphan-hex <hex>` answers the first refusal word that applies, or a token:

| # | Rule | Refusal |
|---|---|---|
| 1 | a linked worktree of a main checkout under `$PROJECTS_ROOT`, by identity (its stanza `-ef` the path) | `not-a-worktree` |
| 2 | class `ccd-root`, `claude` or `superpowers` | `out-of-scope` |
| 3 | not the main checkout under any spelling (`-ef`, #1132) | `not-a-workspace` |
| 4 | no registry row's workdir is at, inside or through it (by identity, #1132's `_ws_path_ident`); for `ccd-root`, no `.uuid` row by slug | `registered` |
| 5 | not `locked` in git | `locked` |
| 6 | `git status --porcelain --untracked-files=all` is empty and readable | `dirty`, `tree-unreadable` |
| 7 | no operation in progress in its admin dir, and no `index.lock` (D-5945's stale-lock rule is not on `main` yet; when it lands, this rung calls it as the ladder does) | `tree-busy` |
| 8 | HEAD reads | `head-unreadable` |
| 9 | `git rev-list --count HEAD --not --remotes` is 0 (hook-free, any stderr refuses) | `head-not-on-remote` |
| 10 | no ignored file is secret-shaped (`_ws_gc_reclaimable`) | `secrets-ignored` |
| 11 | no nested checkout (`_ws_nested_checkouts`) | `nested-checkout` |
| 12 | `ccd path-users` answers nobody on both spellings (cwd, fd, file mapping, `TMPDIR`) | `in-use` |
| 13 | newest ctime of every entry, `.git` file included, older than 7 days | `changed-recently` |
| 14 | `reclaim-paused` absent (asked last) | `paused` |

Any rung that cannot be measured answers `unmeasured`, which is retried. The token is `_ws_reclaim_fingerprint` over `mode=orphan`, the path hex, the tree's and main checkout's and admin dir's `dev:ino[:btime]`, HEAD, branch, the status and ignored digests, the newest ctime in ns, the entry count and the floor. When the only refusal is rung 9, the document also carries a **rescue token** (`mode=orphan-rescue`, the same inputs).

**The verb.** `ccd ws-orphan --expect <token> --tree-hex <hex> [--rescue] [--surface <w>] [--actor <t>] [--reason <t>]`:
1. take `$REG/.orphan-<sha16>.lock` with `flock -n` (contended answers `locked-elsewhere`, retried);
2. recompute the ladder inside the lock and compare tokens (`state-changed` otherwise);
3. `_lc_intent destroy … verb ws-orphan`;
4. with `--rescue` and a rescue token only: pin HEAD and every sha in the tree's own reflog under `refs/ccrc/attic/orphan/<sha16>/` through `_ws_attic_pin`'s shape. The objects are already in the shared store, so this copies nothing. A pin that fails stops the act (`pin-failed`);
5. ask the holder probe once more, nearest the act;
6. `git -C <main> worktree remove <path>`, **never `--force`**. Git's refusal is `worktree-remove-failed`, terminal for that token, and the tree is left;
7. for `ccd-root` only, `git branch -d <branch>` when no other worktree has it checked out (never `-D`; a refusal is reported `branch-kept`). Branches of `claude` and `superpowers` trees are left: they are refs, not bytes, and their owner is Claude Code or the skill;
8. `_lc_done` or `_lc_fail`.

**The lane.** `server/src/orphanTreeLane.ts` (L1), `server/src/coord/collectOrphanTree.ts` (L3), `sweepOrphanTrees` in `watch.ts` (L4):
- census every 6 hours (hourly under pressure); audits at most 2 per pass (4 under pressure); at most one act per pass fleet-wide, on the `KeyedQueue` key;
- **licence:** two audits of one unchanged token at least one hour apart; the second is the act job's own;
- **gates:** `reclaim-paused`; ccd's `orphan-v1` capability (`ccdCan`); the arming markers; the maintenance mode when it lands;
- **arming:** shadow unless `$REG/orphan-tree-live` exists; the rescue arm is shadow unless `$REG/orphan-tree-rescue-live` also exists. Neither marker has a writer in the tree. The rescue marker is set only after the main arm has run live for a week (ruled, §9.1 Q1);
- **feed:** `kind:'coord'`, `record-only`, one row per change of (path, outcome): `orphan worktree removed`, `orphan worktree would be removed`, `orphan worktree left` with the refusal's sentence;
- **health:** the `disk` block's `orphanTrees` carries counts by class and outcome, and bytes where an audit measured them (`du -skx`, bounded at 30 s, report only).

**Alternatives rejected.**
- Granting `ws-gc --prune` to the agent: it has no token and no holder probe; it stays ungrantable.
- `git worktree remove --force`, or removing dirty trees after a patch: the ruling forbids `--force`, and git without it refuses a dirty tree anyway.
- A rescue bundle file per tree: it copies bytes during a disk incident, while an attic pin keeps the same commits for about 50 bytes a ref.
- Scanning `.claude/worktrees` directories by name: `git worktree list` is the exact list of what git thinks is a worktree; a directory it does not name is not one.

### 2.4 Ruling 3: the loose arm of `ws-collect`, reversing D-5888

**Owner.** `ws-collect` already collects `~/.cc-tmp` leaves. The loose arm is the same lane, the same quarantine, the same re-proof and the same switch, with a population read from `~/.cc-tmp` and an identity bound by the token instead of a witness.

**Population: a census.** `ccd ws-audit --collect-census` (read-only) lists `~/.cc-tmp`'s top-level entries, bounded at `COLLECT_POPULATION_MAX` (1,024; past it, `truncated`). Each is classed in this order:
- `quarantine`: `.ccd-quarantine`. Never a candidate;
- `witnessed`: a `$REG/tmproots/<name>` witness stands. Today's arm takes it;
- `registered`: `$REG/<name>.child` or `$REG/<name>.uuid` exists, by direct lookup, with the slug-free listing control `_ws_collect_prelock` uses;
- `refused`: a symbolic link, a socket, a FIFO or a device, or a name that is not printable UTF-8 without `/`. The operator's;
- `loose`: everything else, directories and regular files both.

Names cross the wire as hex (`--loose-hex`), so no name can be read as an option.

**The audit.** `ccd ws-audit --loose-hex <hex> --collect` re-classes the entry and then runs §5.10's rungs that do not need a witness: lstat type and owner uid; the idle walk (newest ctime, never mtime) with a floor of `max(172800, WS_COLLECT_LOOSE_FLOOR_S)`; the in-use probe (now `ccd path-users`, with file mappings); no registry row at, inside or through it; the checkout question (no worktree admin dir points inside it); pause asked last. The token is `mode=collect-loose` over the name hex, `dev:ino`, btime or `-`, type, uid, newest ctime in ns, entry count and floor.

**The verb.** `ws-collect --expect <token> --loose-hex <hex>` rides the existing grant. It takes the box-wide `$REG/.collect-loose.lock`, recomputes, writes a record to its own family `$REG/tmpquarantine-loose/<sha16>.<ns>.<pid>` (the §5.10 one-line format plus `name=<hex>`), moves the entry into `.ccd-quarantine/slot.loose.<sha16>.<ns>.<pid>/leaf`, re-proves (registry, in-use on both spellings, mountinfo, identity against the token), puts it back on any doubt, and removes it through `_ws_leaf_remove` (a regular file is unlinked). Resume reads the loose record family exactly as today's resume reads its own.

**The lane.** `collectPopulation` adds the census's `loose` names and the loose record family. The licence, pacing and gates are today's. Two changes: the open-run hold's rule (e), `no-witness-run`, does not apply to a loose entry (it has no run to wait for, and would otherwise hold it forever); and a loose candidate is shadow ("temp entry would be collected") unless `$REG/collect-loose-live` exists **and** the lane is effectively live.

**Why this is safe where D-5888 declined it.** D-5888 declined loose entries because nothing identified them. The token now binds the entry's own identity, the licence needs two observations of that same token an interval apart, the floor is twice the witnessed one, and the holder probe now sees mappings and `TMPDIR`. A loose entry recreated under the same name has a new inode and fails the token.

**Contract and catalogue.** R38 ("no collector touches the foreign entries") and R59 ("stays the operator's") are amended to name the loose arm and its rules. The `child-tmp-roots` comment that cites D-5888 says it was reversed by this ruling, and a new lifecycle row declares the class (§6).

### 2.5 Ruling 4: the disk alarm and pressure mode

**One vocabulary (L0, `shared/disk.ts`, imports nothing).** `DISK_WORK_ROOTS`, a table of labels and HOME-relative templates: `home`, `projects`, `worktrees`, `cc-tmp`, `claude-tmp` (`${TMPDIR:-/tmp}` and `/tmp`), `config-dirs` (every roster config dir), `ccrc`, `registry`. `DISK_WARN_PCT = 85`, `DISK_CRITICAL_PCT = 92`, `DISK_CLEAR_MARGIN_PCT = 2`. The `DiskHealth` type and its single reader, `readDiskHealth(health: unknown)`, which answers `null` (unknown) for anything absent or malformed. The pressure-mode ages are one table here too (§2.5.3).

**The agent's `disk` op.** It takes no arguments, so no path crosses the link. The agent resolves the table against its own HOME and the roster config dirs, calls `fs.promises.statfs` on each under a 5 s deadline (the history sweep's `statfsWithDeadline` pattern), groups roots by `st_dev`, and names each filesystem's mount point and type from `/proc/self/mountinfo`. An optional `CCRC_WORK_MOUNTS` in `agent.env` lists paths that must be mount points; each is answered `mounted: true|false`. The answer is `{at, filesystems:[{dev, mount, fsType, roots, sizeBytes, availBytes, files, filesFree, readOnly}], missing:[{label, why}], expectedMounts:[{path, mounted}]}`. The op is advertised in `ready.ops`, so an older agent's absence reads as unmeasured.

**The server.** A `sweepDisk` tick in `watch.ts` every 60 s asks the op in remote mode, or measures the same table with node's `statfs` in local mode, through one new `FleetIO` member, `statfsMeasured`. A pure L1 decider, `diskVerdict(prev, measured, now)` in `server/src/disk.ts`, gives each filesystem a level from the larger of its bytes-used and inodes-used percentages: `warn` at 85, `critical` at 92, clearing only 2 points below the level it holds. A level must hold for two consecutive measurements before it changes, so one bad read never pages. An expected mount that is missing is `critical`. The worst filesystem is the fleet's level; nothing measured is `unmeasured`, never `ok`.

`GET /api/fleet/health` gains the optional `disk` block: `{at, level, filesystems:[…, level], expectedMounts, pressure, holders}`. `holders` is the "who is growing" view the issue asked for, joined from facts already measured: the tmp-sweep census's five largest sessions, `archivedHeld`'s total, the loose census's count and bytes, and `orphanTrees`.

**The notification.** On a rise to `warn` or `critical`, one notice through the funnel, `notify(…, 'push')`, `kind:'coord'`, `sessionId:''`, with `dedupeKey` `disk:<dev>:<level>:<episode>`, where an episode starts at a rise from `ok`. A rise to `critical` pushes even when `warn` already did. A clear is recorded, never pushed.

**The banner.** A new `disk` id in `BannerStack` (ranked after `fleet-host`), shown at `warn` and `critical`: one line, "Fleet disk 93% full · 41 GiB free · sweeps in pressure mode", that opens the health detail. It reads only the server's sentence and level. It meets the UI rule at 360, 390, 1280 and 1920 wide, in both skins and both themes (§7).

#### 2.5.1 Pressure mode is decided on the box

A sweep's age floor is a safety property, so the server can never lower one. Each box-side sweep measures its own filesystem: `ccd`'s `_disk_pressure <path>` and `ccd-tmp-sweep`'s twin `_ts_pressure` read `df -Pk` and `df -Pi` and answer pressure at 92% or more of either. Their constants are pinned equal to L0's by a test that reads the bash. The server's own level only raises pacing (more audits per pass); the act cap stays one per pass, so pressure never makes a herd.

#### 2.5.2 Doctor measures the work filesystems

`_check_disk` resolves the same roots in bash (its twin of the table, pinned by the same test), groups them by `df -P` filesystem, and gives one line per filesystem: FAIL at 92% bytes or inodes or under 2 GiB free, WARN at 85% or under 10 GiB, PASS otherwise. The worst line sets the check's rc.

#### 2.5.3 The pressure ages

| Sweep | Normal | Under pressure |
|---|---|---|
| tmp-sweep, dead units | 7 days | 2 days |
| tmp-sweep, live entries untouched | 14 days | 3 days |
| tmp-sweep, quarantine grace | 24 hours | 1 hour |
| tmp-sweep, budget grace after the notice | 24 hours | none |
| tmp-sweep, budget's untouched floor | 48 hours | 48 hours (never lowered) |
| tmp-sweep, live arm cadence | 6 hours | every pass |
| tmp-sweep, test-run quiet | 6 hours | 1 hour |
| ws-collect, loose floor | 48 hours | 24 hours (never below the witnessed 24-hour floor) |
| ws-collect, witnessed floor | 24 hours | 24 hours (raise-only by design) |
| orphan trees, idle | 7 days | 3 days |
| orphan trees, census cadence | 6 hours | 1 hour |

**Deleting the box-local guard (ruled, §9.1 Q5).** The box's own disk guard watches the same two thresholds, whether the work volume is mounted, and whether each of its bind mounts is live. ccrc takes over all three. `CCRC_WORK_MOUNTS` lists the volume's mount point and every bind target, and the agent answers each `mounted` from `/proc/self/mountinfo`. A listed path that is not a mount point is `critical`, and the notice names it, so a silently absent volume pages as plainly as a full one. Once the banner, the notification and doctor have shipped, and one real or fixture-driven warn has reached the banner and the push, the operator deletes the guard's script, service and timer (§8).

### 2.6 Shared pieces

#### 2.6.1 One holder probe

`_ws_path_users` (`ccd/ccd` ≈:32753) already walks this uid's processes once for cwd, every fd and `TMPDIR`. It gains two things, both of which can only add holders:
- **file mappings:** each process's `/proc/<pid>/map_files/` link targets, falling back to the path column of `/proc/<pid>/maps`;
- **many paths, one walk:** a list of paths answered in one walk, each with its own verdict.

A read-only entry, `ccd path-users --json <path>…`, exposes it to `ccd-tmp-sweep`, so the sweep and every ccd verb ask one probe. `_ts_holder` stays for today's dead arm and is characterized, not moved. #1132's `_ws_cwd_users` keeps the cwd-by-identity question; this probe keeps fds, mappings and `TMPDIR`.

#### 2.6.2 New verbs are the server's, never a session's

`ws-orphan` and the loose forms of `ws-collect` are destructive. Each:
- sits behind ccd's privileged direct-entry check (`ccd/ccd` ≈:27-29), like `ws-collect`;
- joins `FORBIDDEN_CCD_VERBS` (`server/src/coord/approvalguard.ts` ≈:124) as `ws-orphan` (the loose collect is already covered by `ws-collect`);
- gets a SAFETY line in `CLAUDE.md`: the SERVER's act on an orphaned worktree only, behind a token re-proved on the box, never a session's verb and never run against the live host from a shell or a test.

`ccd path-users`, `ws-audit --orphans`, `ws-audit --orphan-hex`, `ws-audit --collect-census` and `ws-audit --loose-hex` are read-only.

Wave 5 adds **no new verb**. It widens three verbs that are already forbidden to sessions and already the server's, each through a flag the server composes and the box re-proves: `ws-reclaim --stale`, `ws-expire --child-of` and `ws-archive --if-no-pane` (§2.7). `FORBIDDEN_CCD_VERBS` already names all three heads. CLAUDE.md's SAFETY lines for `ws-expire` ("never a child") and `ws-reclaim` change to say exactly what the new forms take (§2.7.6).

### 2.7 Wave 5: lifecycle exits (rulings G1 to G4)

Each exit is built on the lane that owns its neighbour, and none adds a lane where an existing lane can take the case. The new arms are child reclaim's stale arm, expiry's child arm, and a stale-archive arm. Each ships shadowed behind its own marker.

#### 2.7.1 G3: rung 9 rescues a nested repository, then proceeds

**Today.** Rung 9 of `_ws_reclaim_ladder` (`ccd/ccd` ≈:30929-30991) pins and removes a nested checkout of this repository. A nested checkout of another repository must prove itself clean, with every commit on one of its own remotes (`_ws_reclaim_foreign_clean` ≈:30563-30616). Otherwise the rung answers `containment-unproven`, which both lanes treat as terminal (`CHILD_RECLAIM_TOKEN_KIND`, `coord/childReclaim.ts` ≈:78-93; `EXPIRE_TOKEN_KIND`, `archivedExpiry.ts` ≈:41-61). The spec called this "reap, and note" and refused it (2026-09-22 ≈:484-492). The operator has now ruled the other way.

**The rescue.** When `_ws_reclaim_foreign_clean` fails for a nested repository `N` (dirty, hidden-flag edits, or commits on none of its remotes), the ladder classes `N` as **rescuable** rather than refusing. The pin phase then does three things for each rescuable `N`, before anything is removed:
1. **Captures its uncommitted state.** It makes a WIP commit inside `N` the way `_ws_wip_commit` (≈:31462) does for this repository: `commit-tree` from a scratch index copy, with untracked files that are not ignored added to it. No ref moves in `N`.
2. **Fetches it into the attic.** `git -C <main> fetch --no-tags --no-write-fetch-head <N> '+refs/*:refs/ccrc/attic/<id>/nested/<pathhex>/refs/*'`, plus the WIP commit as `refs/ccrc/attic/<id>/nested/<pathhex>/wip`, every git call contained like the rest of the pin (`_ws_reclaim_contained` ≈:31151). The commits then live in the main repository's object store under the one attic namespace `refs/ccrc/*`, which nothing garbage-collects (policy row 15).
3. **Re-proves it.** Every rescued sha must resolve under the attic ref before the tail may run. A failure is `nested-rescue-failed`, retryable, and nothing is removed.

The tail then removes the tree as it does today: its foreign checkouts go with the `--force` removal that follows the pin (≈:34219). The tombstone's `containment` gains `rescued: [{path, refs, wip, bytes}]` beside `sameRepository` and `foreignProven` (≈:32343-32366).

**Bounds.** A nested repository whose objects missing from the main store exceed `WS_NESTED_RESCUE_MAX_MB` (512 MiB, raise-only) answers `nested-rescue-too-large`. That word is terminal: it is reported on the banner, and nothing is taken. The fetch runs under the pin's existing time bound. A nested repository that cannot be read stays `unmeasured`.

**Why refs, not a bundle file.** The attic is already the record that `_reg_purge` cannot reach and that survives reaps. A bundle file would be a new artifact class with its own lifecycle row and a second record of the same fact. The cost is that a foreign history's objects enter the project repository's store. They are reachable only from `refs/ccrc/*`, which no push carries.

**The token** binds the rescue: `nestedRescue=<pathhex>:<HEAD or ->:<status digest>` for each rescuable `N`, in `REAP_CHILDDIGEST`'s inputs (≈:31010). A nested repository that changes between the audit and the act fails the token.

**Arming.** ccd reads `$REG/nested-rescue-live` at the audit and again inside the lock. Without the marker, rung 9 answers `containment-unproven` exactly as today, and the audit document carries `nestedRescue: {wouldRescue: [...]}` so the shadow feed can show what it would rescue. The other `containment-unproven` producers (a leaf link, a shared or nested registry row, a workdir of another repository, a gitdir that is not its own, a moved tree; ≈:30740-30864, ≈:30989) are unchanged and stay terminal.

**Because the ladder is shared,** the rescue applies to `ws-reclaim` and `ws-expire` alike, in both evals and both resumes.

**The orphan ladder gets the same arm (§2.3, rung 11).** A nested checkout of the tree's own repository blocks a tree today. Under the arm, a same-repository nested checkout is pinned under `refs/ccrc/attic/orphan/<sha16>/nested/<pathhex>/`, and a foreign one is rescued as above. The orphan tree is still removed without `--force`, and git refuses a tree with untracked files. So the verb first removes the rescued nested directory itself: the same `_ws_leaf_remove` the collector uses, after a holder ask, inside the lock and after the re-prove. Only then does it run `git worktree remove`. A tree whose only blocker is rung 11 gets a rescue token, as rung 9 does under §2.3's rescue.

#### 2.7.2 G3's source: temp under `TMPDIR`, never inside a tree

The trees were stranded by an agent-authored instruction (§1.4). Two fixes, and neither touches Claude Code:
- **The suite refuses a temp root inside a work tree.** `run-tmp.globalsetup.mjs` resolves `os.tmpdir()` physically. If any ancestor holds a `.git`, it does not build its run parent there. It uses `CCRC_SESSION_TMPDIR` instead, when that is set and itself lies outside every work tree, and otherwise the box's own `/tmp`. It prints its `ccrc-test:` line naming the move. `mkTmp` (`server/test/tmpHelpers.ts` ≈:49) follows it through the run parent. The 2026-10-08 ruling that a too-long `TMPDIR` refuses rather than degrades still stands: a tree-relative `TMPDIR` was the long one here, and moving out of the tree removes the length.
- **ccd exports the session's own temp root.** Each spawn exports `CCRC_SESSION_TMPDIR`: the child's `~/.cc-tmp/<id>`, or the box's `TMPDIR` for any other session. An agent that overrides `TMPDIR` later cannot hide where the session's temp belongs.
- **The skills say it.** The coordinator and worker skills gain one clause each: a workflow script, a worker brief or a test step never sets `TMPDIR` or writes scratch inside a work tree. It uses the session's `TMPDIR`. The clauses are pinned verbatim, so this is its own reviewed change.

#### 2.7.3 G2: kept children are reclaimed after 7 idle days

**Population.** A child whose sweep verdict is `held`, `minting-run-absent`, `review-report-live`, `review-report-stale` or `terminal-refusal`. Never `coordinating`: `has-coordinated` stays excluded (rule 4, R37, R40). Never the doubt words, which mean "measure again".

**Idle, measured on both sides.** The server knows run and mail activity. The box knows pane activity. Each must agree before anything moves:
- **Server (L1, `childReclaimSweep.ts`):** the newest of the minting run's latest `run_events.at`, the latest `run_events.at` of any run naming the session, the latest mail delivery to or from the session, and the session's `statusUpdatedAt`. All must be older than `CHILD_STALE_IDLE_MS` (7 days). Any one unreadable means not stale.
- **Box (ccd, a new ladder rung on the stale arm only):** the newest of the current uuid's transcript mtime (`_transcript_path`), `.lastend`, `.spawn`, `.woke` and `.supervised`, and tmux's `#{window_activity}` when a pane is up. All must be older than `WS_STALE_IDLE_S` (604800 s, raise-only). Anything unmeasured refuses `not-idle`.

**The act is the normal reclaim.** `ws-reclaim --expect <tok> --child-of <run> --session <id> --stale <word> [--hold-digest <sha256>]`. The stale word changes exactly one rung:
- `--stale held`: rung 4 passes a hold whose content hashes to `--hold-digest`; any other hold, or a changed one, refuses `held`;
- `--stale run-absent`, `--stale review`: no rung changes. Those keeps were the server's alone;
- `--stale terminal`: no rung changes. The child is simply **asked again** once per 7 idle days. If the ladder now passes, which G3's rescue will often make true, it is reclaimed. If it still refuses terminally, it stays kept, and its banner row comes back with the new date.

The token binds `stale=<word>`, the hold digest and the box's idle instant. Everything else is today's pin and tail: the pin captures the branch, the WIP and any review report under `refs/ccrc/attic/<id>/`, and the tail removes the tree and the child's temp root.

**The coordinator is told.** After a reclaim done on the stale arm, the server sends system mail from the `operator` role to the minting run's `claimedBy` (`resolveCoordinator(runId)`), kind `status`. The mail names the child, why it was stale, and the attic refs it can re-dispatch from (`git worktree add <path> refs/ccrc/attic/<id>/<sha>`). A run-absent child has no coordinator to tell, so a `kind:'coord'` feed row records it instead.

**Arming.** The verdict answers `stale-eligible:<word>` and the lane acts only when `$REG/child-stale-reclaim-live` exists. Without it, it records "child would be reclaimed (stale)" once per child and word. `reclaim-paused` and the coming per-reason off switch (ARCH-77) stop it with the rest of child reclaim.

**What this reverses.** R32 and R34 ("a person's hold is never released") are amended: a hold now protects for 7 idle days. R41's kept list loses `minting-run-absent`, `reviewed-run-absent` and `review-report-stale`, which become stale-eligible. D-5942's "nothing reclaims it before that" is superseded: the review report is preserved by the pin, and the mail names where. The spec's §5.9 line "a child under a hold is never asked" (2026-09-22 ≈:1021) is amended the same way.

#### 2.7.4 Archived children expire after 7 days

**Box.** `ws-audit --session <id> --expire --child-of <run>` and `ws-expire --expect <tok> --session <id> --child-of <run>`. Without `--child-of`, a child refuses `child`, exactly as today, so an older server changes nothing. With it, `_ws_expire_not_child` (≈:34870) passes only when the marker parses as a run id equal to `--child-of`. An unreadable marker still refuses. The token binds `childOf`. Every other expiry rule stands unchanged: rung 2′'s seven days from `.archived` (`WS_EXPIRE_AFTER_S`), the tightened presence rung (no pane up, no cwd user), and no `--defer-expired`. The tail is the shared tail, so the child's pin, its temp root and its tombstone are reclaim's.

**Server.** `archivedExpiryVerdict` (≈:387) stops skipping a `child` mark when `$REG/expire-child-live` exists. It still skips an `unreadable` mark, and its store rules (`open-run`, `coordinating`, `review-open`) apply to children as they do to anyone. Without the marker, an archived child past its 7 days is recorded "would be expired (child)". The child reclaim lane keeps its own population, so an archived child that becomes reclaim-eligible first is reclaimed first. Both verbs take the same reap lock, so the two cannot race.

#### 2.7.5 G1 and G4: dead non-children are archived; coordinators' nested trees are collected

**G1, the stale-archive arm.** It is a new arm, because no lane archives today. Its verdict lives beside the expiry lane's (`server/src/archivedExpiry.ts` gains `staleArchiveVerdict`), since archive is the step before expiry and the two share their population read.

A row is archived when all of these hold:
- it is a workspace (`workspace !== null`), with no `.child` marker in any reading, not archived and not held;
- it has never been a run's `claimedBy`, in any state or generation (`childReclaimCoordinatorClaims` and `openCoordinatorIds` both empty for it);
- no pane, measured on two passes at least an hour apart;
- **no pane for 14 days:** the newest of its latest `spawn`, `start` and `supervise` acts in the lifecycle mirror (`lifecycle_events`), `.supervised`, `.spawn`, `.woke` and its current transcript's mtime is older than `STALE_ARCHIVE_AFTER_MS` (14 days). No evidence at all means unmeasured, and the row is kept. A hibernated row counts as having no pane (ruled, §9.1 item 12);
- nobody is viewing it (retire defers on `visible`, D-5242).

**The act** is `ws-archive --session <id> --if-no-pane --reason stale`. The new flag refuses `live` when a tmux session or an active unit exists at the act, so an archive can never kill a pane that came back. `.archivedreason`'s grammar gains `stale`. The archive starts expiry's seven days.

**Pacing and arming.** Hourly, at most one act per pass fleet-wide, shadow until `$REG/stale-archive-live`. Each act writes a `kind:'coord'` feed row. There is no mail, because the session is not running.

**G4: coordinators' nested trees.** The orphan census's `claude` and `superpowers` classes widen from `<main>/.claude/worktrees/*` to `<checkout>/.claude/worktrees/*` for any checkout of the repository, the main checkout or a linked workspace. Rung 4 then distinguishes two cases. A registry row whose workdir is the tree, or lies inside it, still refuses `registered`. A row whose workdir **contains** the tree passes, and the census names it as `inside: <id>`. The server's lane takes such a tree only when that containing row is a coordinator (any run's `claimedBy`). For any other containing row that is a workspace it reports "goes with its workspace": that row's own reclaim or expiry pins and removes its nested checkouts at rung 9. A containing row with no workspace marker (a plain session, or the main checkout) is no nesting: it has no reclaim or expiry exit, and every `<main>/.claude/worktrees` tree is inside the main checkout's row, so the literal reading would empty the lane's own population (D-6635). Such a tree is a candidate like any other. A containing row that cannot be read, or whose `workspace` marker cannot be measured, keeps the tree, and the lane says so once per tree. Every other orphan rule is unchanged: clean, HEAD on a remote, no holder, idle 7 days, never `--force`, and Q1's rescue arm.

#### 2.7.6 SAFETY text

- `ws-reclaim`: "…the SERVER's act on a CHILD workspace only … or, on its stale arm, a child that its sweep kept and both the server and the box measure idle seven days, never one that coordinated."
- `ws-expire`: "…on an ARCHIVED workspace only, seven days after its archive (never a main checkout; a child only through `--child-of` naming its marker's run)…"
- `ws-archive` stays forbidden to sessions. Its new `--if-no-pane` form is the server's stale-archive arm.

#### 2.7.7 How wave 5 meets #840 P4-4 to P4-6 and the consolidation wave

P4-4 (gone-branch refusal), P4-5 (stale `index.lock`) and P4-6 (permission prune) are planned and not on `main`. Each edits a different rung of the same ladder (HEAD, rung 6, rung 8), and G3 edits rung 9. If P4-4 to P4-6 are in flight, the wave-5 ladder task rebases after them. Otherwise it lands first, and they rebase. Either order keeps one ladder. The orphan ladder's rung 7 calls P4-5's helper once it lands. In the consolidation wave, the stale arm is a per-reason evidence row of `child-spent`, the expiry child arm is a row of `archive-expired`, and the stale archive is an edge of the sleep→retire graph (`decideRetire` and `decideSleep`, K1). None is a new lane shape.

## 3. Ownership, before and after

| Class | Before | After |
|---|---|---|
| Dead session units under `claude-<uid>` | `ccd-tmp-sweep`, 7 days | unchanged; 2 days under pressure |
| Live session `scratchpad/` and `tasks/` entries, under `/tmp` and inside live child leaves | **none** | `ccd-tmp-sweep` live arm: 14 days untouched, unheld, quarantine 24 h, mailed |
| Finished task `.output` over 1 GiB | **none** | `ccd-tmp-sweep` live arm: capped to head and tail |
| Per-session temp bytes | **not measured** | tmp-sweep census; over 20 GiB, a notice to the session and its coordinator, then after 24 h (none at critical) the oldest entries untouched 48 h are removed until under 15 GiB |
| `ccrc-testrun-*` roots no later run visits | **none** (the next run under the same `TMPDIR` only) | `ccd-tmp-sweep` test-run arm; vitest's `tmpDir` in the run's own arm |
| Test temp written inside a work tree | **nothing stops it** | the suite moves its run parent out of any work tree; ccd exports `CCRC_SESSION_TMPDIR`; the skills say it |
| Witnessed `~/.cc-tmp/<id>` leaves with no row | `ws-collect` | unchanged |
| Unwitnessed leaves and loose `~/.cc-tmp` entries | **the operator's** (D-5888, R57, R59) | `ws-collect` loose arm: 48 h ctime-quiet, unheld, token-bound identity |
| ccd-root orphan worktrees (policy row 5) | `ws-gc --prune`, operator only | orphan-tree lane (server, `ws-orphan`); `ws-gc --prune` stays for the operator on the same rules |
| `.claude/worktrees` and `.superpowers/worktrees` of any checkout, coordinators' workspaces included (policy row 6) | **UNASSIGNED** (Open Q6); inside a coordinator, **no exit** | orphan-tree lane, classes `claude` and `superpowers` |
| Other linked worktrees | reported by `ws-gc` | reported by the census, `other`, never removed |
| A child stranded by a nested repository with work on no remote | **terminal** `containment-unproven`, never asked again | rung 9 rescues the repository into the attic, then the ladder proceeds |
| Children kept as held, run-absent, under review or behind a terminal refusal | **kept for good** | child reclaim's stale arm after 7 idle days, measured on both sides; the coordinator is mailed |
| Children that coordinated | never reclaimed | unchanged (rule 4) |
| Archived children | **no owner** (expiry skips them, reclaim does not look) | expiry's child arm, 7 days after the archive |
| Dead non-child, non-coordinator workspaces | **no owner** | stale-archive arm after 14 days with no pane, then expiry 7 days later |
| Fleet work filesystem fill and work-mount liveness | box-local guard; doctor on `$HOME` only | agent `disk` op → health `disk` block → banner and notice; doctor on every work filesystem; the guard is deleted |
| Transcripts and sidecars | #317 / #840 P4-7..9 | unchanged (out of scope) |

## 4. Why it is safe

- **Fail toward keeping.** Every unreadable, unmeasured, truncated or ambiguous answer keeps the candidate and says why. A walk past its bound is `unmeasured`. A census past its cap audits nothing new.
- **Holders.** One probe, extended only toward refusing: cwd, every fd, every file mapping and `TMPDIR`, on both spellings, asked at the pass and again nearest each act. Processes of another uid cannot be read without root; the fleet runs one uid, and this is a stated residual.
- **Quiet floors.** Every rule waits for every entry to be quiet, not the candidate's top level. Ctime is used wherever an entry could be renamed or chmodded into place. The floors are box-measured, and a server argument cannot lower one. Wave 5's idle clocks are measured on both sides, and either side alone can refuse.
- **Lossless where work can exist.** Every wave-5 exit ends in the existing pin before the tail removes anything: the branch, the WIP and the reflogs under `refs/ccrc/attic/<id>/`, and now each nested repository's refs and WIP. The pin is re-proved before the tail runs, and a pin that fails stops the act. The orphan lane removes only clean trees whose HEAD is on a remote, or rescued ones.
- **Reversibility.** The live arm and both collect arms move before they delete. The live arm's 24 h grace is the session's window to put an entry back. A stale-reclaimed child is re-dispatched from its attic refs, and the mail says how.
- **Tokens and licences.** Every server act runs on a token the box recomputes inside its lock, seen twice an interval apart. A tree or entry that changes between the audit and the act is refused. Each widened verb binds its new input into the token: `stale` and the hold digest, `childOf` for expiry, and each rescued nested repository.
- **Arming and kill switches.** Each new destructive arm ships in shadow and is armed by its own marker, none of which has a writer in the tree:
  - `~/.ccrc/tmp-sweep-live-arm`;
  - `$REG/collect-loose-live`;
  - `$REG/orphan-tree-live` and `$REG/orphan-tree-rescue-live`;
  - `$REG/nested-rescue-live`, read by ccd itself;
  - `$REG/child-stale-reclaim-live`;
  - `$REG/expire-child-live`;
  - `$REG/stale-archive-live`.

  `tmp-sweep-paused` stops the box sweep. `reclaim-paused` stops every server lane here. The collect switch stops the loose arm with the witnessed one.
- **What stays excluded.** A child that coordinated, a main checkout, an unreadable child marker, a row someone is viewing, and a pane that is up at the act.
- **Disjoint collectors.** tmp-sweep acts only inside units it measures live, or on units it measures dead. `ws-collect` acts only on `~/.cc-tmp` entries with no row. The orphan lane acts only on worktrees no row is or lies inside. Reclaim and expire act only on rows, and they share one reap lock. A path is in at most one population, except an archived child, which both reclaim and expiry may take; whichever holds the lock first takes it.
- **No herd.** Each server lane acts at most once per pass fleet-wide. Nothing restarts a session. Account switching is untouched: none of this code runs on the swap path.
- **SAFETY.** The new and widened verbs are the server's (§2.6.2, §2.7.6). Every test uses a fixture HOME (`makeCcdHarness`). Nobody runs a destructive verb against a live box from a shell or a test.

## 5. Wire and deploy

- **Agent:**
  - a new op, `disk`, in `ready.ops`;
  - a new `NODE_FILES` key, `tmpSweep: 'tmp-sweep.json'`;
  - new grant prefixes: `['ws-audit','--orphans']`, `['ws-audit','--orphan-hex']`, `['ws-audit','--collect-census']`, `['ws-audit','--loose-hex']` and `['ws-orphan','--expect']`, with `'ws-orphan': '--expect'` in `REQUIRED_VERB_FLAG`;
  - `ws-gc` stays in `UNGRANTABLE_VERBS`;
  - wave 5's flags ride grants that already exist: `['ws-reclaim','--expect']`, `['ws-expire','--expect']`, `['ws-audit','--session']` and `['ws-archive','--session']`.
- **ccd capabilities:** `path-users-v1`, `collect-loose-v1`, `orphan-v1`, `nested-rescue-v1`, `reclaim-stale-v1`, `expire-child-v1` and `archive-if-no-pane-v1`. The server's `CCD_CAN` rows refuse without them, so each arm is inert on a box whose ccd predates it. A server that composes `--stale`, `--child-of` or `--if-no-pane` never does so without the capability, because an older ccd would reject the extra argument as a usage error.
- **Server ↔ PWA:** `FleetHealth.disk`, optional, through `readDiskHealth`. A new banner id. New feed titles in their lanes' tables. New kept and stale words in `CHILD_RECLAIM_SKIP` and the L0 kept-word table.
- **No `FLEET_PROTO` bump** and no coord.db migration. Everything is additive and absence-permits.
- **Order:** agent lane first, as `ccrc rollout` does by default. A server reading a field the agent does not yet send reads unmeasured.

## 6. Lifecycle and policy edits

- `shared/lifecycle.ts`:
  - `claude-tmp-session-dirs`: the collector names the live arm, its 14 days, its quarantine and its pressure ages; the bound becomes "session lifetime + 7 days, and 14 days untouched inside a live session".
  - `child-tmp-roots`: the D-5888 comment says it is reversed by the loose arm; the collector adds the live arm for scratch inside a live leaf.
  - new `cc-tmp-loose-entries` (`~/.cc-tmp/<name>` with no witness and no row; pattern S; collector the `ws-collect` loose arm).
  - `server-test-run-dirs`: the collector adds the test-run arm.
  - new `ccd-orphan-worktrees` and `agent-worktrees` (`.claude/worktrees`, `.superpowers/worktrees` of any checkout; pattern W; collector the orphan-tree lane).
  - new `tmp-sweep-census` (`~/.ccrc/tmp-sweep.json`; pattern X).
  - new `child-workspaces` (pattern W; collectors: ws-reclaim on close and by the sweep, its stale arm at 7 idle days, and expiry once archived; bound "the run's close, or 7 idle days when kept, or 7 days after an archive; never while it coordinated").
  - new `archived-workspaces` (pattern W; collector ws-expire, children included; bound 7 days after the archive).
  - new `attic-nested-rescues` (`refs/ccrc/attic/<id>/nested/<pathhex>/*` in the project repository; pattern O, like the attic refs; ruling: policy Open Q4 still holds the attic's horizon).
- `2026-08-11-artifact-lifecycle-policy.md`:
  - rows 5, 6 and 9 name their collectors, and foreign worktrees move from Tier C to Tier B;
  - row 4 (archived) names the stale-archive inflow and the child arm;
  - row 15 (attic refs) names the nested rescue;
  - Open Question 6 is RESOLVED 2026-10-23 with option (a);
  - the "declared byte budget per box" question cites the 85/92 alarm and the 20 GiB session budget as a partial answer.
- `2026-09-22-child-workspace-reclamation-design.md` and `child-reclamation-contract.md`:
  - R38 and R59 (loose entries, §2.4);
  - the rung-9 row (≈:400) and its "reap, and note" paragraph (≈:484-492), with the contract's §3 `containment-unproven` row (≈:160): nested repositories are rescued under the arm;
  - R32 and R34 (holds), R41's kept list, and §5.9's "a child under a hold is never asked": the stale arm (§2.7.3);
  - R37 and R40 unchanged.
- `2026-09-24-workspace-lifecycle-design.md`: rung 2′ (≈:326-330), the eligibility line (≈:360) and "an expiry never touches a row with a child marker" (≈:433-434) name the `--child-of` form.
- `README.md`: the tmp-sweep section, the collector section, a new orphan-tree section, the child-reclaim and expiry sections, and Fleet health's field list.
- `CLAUDE.md`: the SAFETY lines for `ws-orphan`, `ws-reclaim` and `ws-expire` (§2.7.6), and the load-flake bullet if a new suite walks the real `/proc`.

## 7. Tests

The plan carries each task's red-first cases and mutation table. In summary:
- **Probe:** a fake process table with a mapping, an fd, a cwd and a `TMPDIR`, each holding one of several paths answered by one walk; an unreadable `map_files` falls back to `maps`; the walk past its bound is unmeasured.
- **tmp-sweep:** a live unit's old entry moves to quarantine and is deleted a pass later; a young file deep under an old directory keeps it; an atime-fresh file keeps it (and is ignored on a `noatime` fixture); a held entry stays; `scratchpad/` itself and the unit itself are never candidates; an unmapped live unit is skipped; shadow writes rows and moves nothing; the census shape and `seq`; the output cap's head, marker and tail; the test-run arm's listener, quiet and holder rules; pressure ages from a fake `df`.
- **Mail and budget:** one mail per pass per session, deduplicated; no mail for shadow rows; one notice per over-budget episode, with the coordinator copy. On the box: the first pass over budget sends a notice and removes nothing; still over after 24 hours, the oldest unheld entries untouched for 48 hours are removed until the session is under 15 GiB; an entry touched within 48 hours is never removed even while the session stays over; at critical pressure there is no grace; git work on no remote is rescued first or kept.
- **Loose collect:** every census class; hex names, including option-like and dotted ones; the floor; a recreated name fails the token; the open-run hold exempts loose entries; shadow under the loose marker; resume from a loose record.
- **Orphan trees:** every census class, trees inside a coordinator's workspace included; every ladder rung's refusal, red when that rung is deleted; the rescue token for rung 9 and rung 11; the verb's lock, recompute, pin, re-ask and no `--force` (a mutant that adds it is red); `branch -d` for `ccd-root` only; the lane's licence, pacing, arming and feed rows.
- **Alarm:** each threshold with hysteresis and the two-measurement debounce; inode-driven levels; a missing expected mount is critical; one push per episode level; the block absent before the first measure and with an older agent; doctor's per-filesystem lines; the bash twins equal L0.
- **Nested rescue:** a child whose tree holds a test-fixture repository with unpushed commits and untracked files. Under the marker, the audit mints a token naming it, the pin fetches its refs and its WIP into the attic, and the tail removes the tree. Every rescued sha resolves afterwards. Without the marker, `containment-unproven` as today. A repository over the size bound is `nested-rescue-too-large`. A nested commit made between the audit and the act gives `state-changed`. The other `containment-unproven` producers stay terminal. The expiry ladder behaves the same.
- **Temp source:** a run started with `TMPDIR` inside a fixture work tree builds its parent under `CCRC_SESSION_TMPDIR`, or under `/tmp`, and says so; one outside any tree behaves as today; the spawn exports `CCRC_SESSION_TMPDIR`.
- **Stale reclaim:** each kept word at 6 days is kept and at 8 days is stale-eligible; `coordinating` never is; any idle input unreadable keeps; the box refuses `not-idle` when the transcript is fresh even though the server says stale; `--stale held` with a changed hold refuses `held`; a terminal child is re-asked once per 7 idle days; the coordinator mail names the attic refs; a run-absent child writes a feed row; shadow writes "would"; the per-reason marker gates.
- **Expiry child arm:** without `--child-of` a child refuses `child`; with a matching marker it expires through the shared tail and its temp root goes; a mismatched or unreadable marker refuses; the lane skips children without the marker and records "would"; an older ccd (no capability) is never sent the flag.
- **Stale archive:** a non-child, never-claimant workspace with no pane for 15 days is archived on its second observation; 13 days, a viewer, a hold, any claim or a child marker keeps it; no evidence keeps it; `--if-no-pane` refuses when a pane came back; `.archivedreason` reads `stale`.
- **UI:** the banner at 360, 390, 1280 and 1920 wide, in both skins and both themes, shown at warn and critical and hidden otherwise.

## 8. Rollout

1. **Wave 1, see it** (DR-1 to DR-6): vocabulary, the agent op, the health block, the notice, the banner, doctor. Nothing deletes. After it deploys, the operator watches one real crossing or a fixture-driven one.
2. **Wave 2, live scratch** (DR-7 to DR-12): the probe, the live arm in shadow, the output cap, the test-run arm, vitest's `tmpDir`, mail, and the budget. The budget notice is live at once. Its enforcement arms with the live arm. Until then, the temporary box bridge implements the same rule. After a week of shadow rows, the operator arms `tmp-sweep-live-arm`.
3. **Wave 3, loose `~/.cc-tmp`** (DR-13 to DR-15), in shadow until `collect-loose-live`.
4. **Wave 4, orphan worktrees** (DR-16 to DR-19), in shadow until `orphan-tree-live`. The rescue stays shadowed until `orphan-tree-rescue-live`, a week after the main arm went live.
5. **Wave 5, lifecycle exits** (DR-20 to DR-31). The temp-source fix (DR-24, DR-25) lands first, because it stops the inflow. Then the nested rescue (DR-20, DR-21), then the stale reclaim, the expiry child arm and the stale archive, each shadowed until its marker. Arm the nested rescue first: it is what turns most terminal children into ordinary reclaims.
6. **Then** the operator deletes the box-local guard (§2.5), with `CCRC_WORK_MOUNTS` listing the work volume and its bind targets.

Every ccd change deploys agent lane first. Waves 2 to 5 are independent of each other once DR-7 lands, except as the plan's dependency table says. Each waits for #1132 where it edits the same ladder region (the plan's Gates).

## 9. Questions for the operator

### 9.1 Resolved (operator, 2026-10-23; items 10 to 16 are the wave-5 questions, ruled as recommended in a comment on #1167)

1. **Rescue then remove:** yes. The rescue arm has its own marker, `orphan-tree-rescue-live`, set only after a week of the main arm running live.
2. **Reads count as touches:** yes, as recommended.
3. **Arming:** hand-touched markers now, Settings switches in the PWA epic, as recommended.
4. **Pressure ages:** the table in §2.5.3, as recommended. Ruling (3) added two rows: the budget's grace, 24 hours, none at critical; and its 48-hour untouched floor, never lowered.
5. **The guard's mount half:** yes. `CCRC_WORK_MOUNTS` carries the bind targets, ccrc takes over the bind-mount liveness check, and the box guard is deleted entirely.
6. **Who hears the budget notice:** the session and its coordinator. The operator's feed records each crossing, never pushed, as recommended. Ruling (3) makes the budget enforce after the notice (§2.1.1).
7. **Scratch inside a live child's leaf:** yes. A child leaf's `~/.cc-tmp/<id>/claude-<uid>` scratch is swept under the same rules. Both locations were observed on a fleet host (§1.3).
8. **The output cap:** 1 GiB, keeping 64 MiB at each end, as recommended.
9. **Claude Code's branches:** leave them, and never remove `other`-class trees, as recommended.

10. **Hand holds (G2):** yes. A hold the operator set by hand lapses after 7 idle days like a programme's, and the hold's text is quoted in the coordinator mail. R34 is amended accordingly.
11. **The nested-rescue size bound:** 512 MiB of objects per nested repository. Beyond it, the child stays terminal (`nested-rescue-too-large`) and is reported.
12. **Hibernated rows and G1:** a hibernated workspace counts as having no pane for the 14 days.
13. **"Non-coordinator" for G1:** never a run's `claimedBy`, in any state or generation.
14. **G4's scope:** the orphan rules apply to trees nested inside coordinators' workspaces only. A tree inside any other workspace waits for that workspace's own exit.
15. **Terminal children:** a `terminal-refusal` child is re-audited once per 7 idle days. If it is still terminal, it stays and is reported again. Nothing forces past a terminal word.
16. **Review children:** the stale arm reclaims a review child while the run it reviewed is still open. The pin keeps the report, and the mail names where it is. **This explicitly supersedes D-5942's "nothing reclaims it before that".**

No question in this design is open.

## 10. Out of scope and follow-ups

- **#1119 item 3, work inside transcript directories:** a follow-up issue. Sketch: a doctor line, and a health count of non-transcript files above a size under `<config>/projects/<cwd>/<uuid>/`; a skill rule saying where working files go. Its collection needs a transcript-retention ruling (policy Open Q1).
- **Skill text for long output** (#1119 item 1's second half): it rides DR-25's skill change (one clause: redirect long command output to a rotated file or `tail`).
- **Transcript dedupe** (#317, #840 P4-7 to P4-9): unchanged.
- **Settings switches** for the new arms (§9.1 Q3).
- **A PWA card** for the `holders` view beyond the banner line: the PWA epic.

## 11. Review log

**rev 0 (2026-10-23).** Written against `origin/main` `a68c90f15`, the rulings comment on #1119, and the open PRs measured that day (#1132 holds `ccd/ccd`, `CLAUDE.md` and the reclamation contract; #1114 holds `ccd/ccd`; #1164 holds `BannerStack.tsx`; #1162 holds `watch.ts`; #1149 holds `shared/api.ts` and `CLAUDE.md`; #1154 holds `shared/lifecycle.ts`).

**rev 1 (2026-10-23).** The operator answered rev 0's nine questions (§9.1) and added rulings G1 to G4 (§1.4, §2.7). Re-checked against `origin/main` `bd895fbe4`, where every file cited is byte-unchanged from `a68c90f15`. #840 P4-4 to P4-6 were confirmed not on `main` (§2.7.7). The `.tmp-step0` trees were traced read-only to an agent-authored workflow prompt (§1.4). §2.5's guard retirement became deletion. Twelve tasks were added, DR-20 to DR-31.

**rev 2 (2026-10-23).** The operator ruled §9.2's seven questions as recommended, and they move into §9.1 as items 10 to 16. Item 16 supersedes D-5942's "nothing reclaims it before that". No question remains open.

**rev 3 (2026-10-23).** Operator ruling (3), posted on #1167: the size budget enforces (§2.1.1). It notifies over 20 GiB, waits a 24-hour grace (none at critical), then removes the oldest unheld entries untouched for 48 hours, with git work rescued, until the session is under 15 GiB. DR-8 and DR-12 are amended under their issued numbers, D-6620 and D-6624.
