# Fleet disk retention: live scratch, orphan worktrees, loose temp entries and a disk alarm

**Spec** · 2026-10-23 · Status: draft for review. It implements the operator's four rulings of 2026-10-23 on #1119; the rulings are fixed, and only the open questions in §9 need the operator · Owner: the ccrc coordinator · Issue: #1119 (the incident, with the rulings as its comment) · Plan: `docs/superpowers/plans/2026-10-23-fleet-disk-retention.md`

**Related:** `2026-08-11-artifact-lifecycle-policy.md` (rows 5, 6 and 9, Tier C, Open Questions 6 and "declared byte budget per box"), `2026-09-22-child-workspace-reclamation-design.md` §5.10 (`ws-collect`), `docs/superpowers/programs/child-reclamation-contract.md` (R38, R57, R59), `2026-10-20-workspace-disk-and-registry-truth-design.md` (#840: §6 Q1's orphan rule, the `archivedHeld` block, the stale-lock rule D-5945), `2026-10-12-path-identity-design.md` with open PR #1132 (W3: which tree `git worktree remove` may delete), `docs/superpowers/plans/2026-10-08-server-test-run-tmp-parent.md` (#337, its deferred Task 5 and "proposal 3, the sweeper"), `2026-10-19-ccrc-consolidation-wave-design.md` (K1 retire reasons, K6 funnel, K12 switches), #298, #316, #317, #318.

## In short

The fleet work volume filled to 99% twice in two days. Four classes held most of it, and three of them had no owner in ccrc. The operator ruled that the prevention belongs to ccrc, not to box-local timers. This spec builds each ruling on the mechanism that already owns the neighbouring class, so no new collector competes with an old one on the same files.

- **Ruling 1, live scratch.** `ccd-tmp-sweep` gains a **live arm**. Inside a live session's `scratchpad/` and `tasks/`, it moves a top-level entry that has been untouched for 14 days and that no process holds (cwd, fd, file mapping or `TMPDIR`) into a quarantine, and deletes it 24 hours later if still unheld. The server mails the session what was moved. A **budget notice** at 20 GiB per session goes to the session and its coordinator. #1119 item 1, the cap on finished task `.output` logs, rides the same arm.
- **Ruling 2, orphan worktrees.** A new server lane, shaped like the temp-root collector, removes a linked worktree that no registry row names, under #840 §6 Q1's rule: clean, HEAD on a remote, no holder, idle 7 days, an audit token, never `--force`. It covers the ccd worktree root and `<project>/.claude/worktrees` and `<project>/.superpowers/worktrees`. Anything else is left and reported. A tree that fails only "HEAD on a remote" can be rescued (its commits pinned under the attic) and then removed, behind its own arm. This resolves the lifecycle policy's Open Question 6.
- **Ruling 3, `~/.cc-tmp`.** D-5888 is reversed. `ws-collect` gains a **loose arm**: an entry of `~/.cc-tmp` with no witness and no `.child`/`.uuid` row, ctime-quiet for 48 hours and unheld, is collected through the same quarantine, token and re-proof as a witnessed leaf. #337's two deferred follow-ups land with it: vitest's own `tmpDir` joins the run's signal arm, and `ccd-tmp-sweep` collects a dead run's `ccrc-testrun-*` root that no later run revisits.
- **Ruling 4, the disk alarm.** The agent reports `statfs` for every fleet work filesystem. `GET /api/fleet/health` carries a `disk` block. The server raises a banner and an operator notification at 85% and a critical one at 92%. At critical, each sweep measures its own filesystem and runs in **pressure mode** with shorter, fixed ages. Doctor's `_check_disk` measures the work filesystems rather than `$HOME` alone. The box-local disk guard is retired once this ships.

Every destructive arm ships in shadow, writes "would" rows first, and is armed by a marker with no writer in the tree. Nineteen tasks, one PR each, in four waves (§8).

## 1. The problem, measured

Code citations are to `origin/main` `a68c90f15`. Line numbers are hints, written `≈:`, and each names its function. Box figures were measured read-only on a fleet host on 2026-10-22 and 2026-10-23 (the issue body and its rulings comment); this design took no new measurement on any box.

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

Two in-repo measurements disagree on `<T>`. The 2026-10-17 routing plan (≈:536-545) says `<T>` is `$CLAUDE_CODE_TMPDIR`, else the literal `/tmp`, and that `TMPDIR` is not consulted. The child-reclamation ledger (`docs/superpowers/programs/child-reclamation.md` ≈:2937) says the scratchpad follows `TMPDIR`. A workstation running Claude Code 2.1.308 today keeps its scratchpad under `/tmp/claude-<uid>` while `TMPDIR` names another directory, which supports the first. The live arm therefore takes its roots from a measured list (§2.1), and the plan's first fleet task measures it read-only before anything is built on either answer.

## 2. Decisions

Each ruling's design names the existing owner it extends, the exact rule, and the alternatives rejected. Where a rule says "untouched", "quiet" or "idle", it means **every** entry under the candidate, walked without following links and without crossing a filesystem, under a bound; a walk that hits its bound answers `unmeasured`, which keeps the candidate.

### 2.1 Ruling 1: the live arm of `ccd-tmp-sweep`

**Owner.** `ccd-tmp-sweep` is already the collector of this class (lifecycle row `claude-tmp-session-dirs`, policy row 9). The live arm runs in the same program, under the same lock and pause file, after today's pass. Today's dead-unit rules are unchanged.

**Roots.** The sweep walks each of these that exists, is a directory owned by this uid, and resolves physically where it should:
1. today's root, `${TMPDIR:-/tmp}/claude-<uid>`;
2. `/tmp/claude-<uid>`, when it differs from (1) (§1.3);
3. `<physical ~/.cc-tmp>/<id>/claude-<uid>` for each witnessed child leaf, when Step 0 finds Claude Code's scratch there.

A root is listed in the census with the arm that read it, so a root added or missing is visible.

**Population.** Only units today's pass classifies **live**. For each, the candidates are the direct children of `<unit>/scratchpad/` and `<unit>/tasks/`. The unit itself, `scratchpad/` and `tasks/` themselves, and anything else in the unit are never candidates.

**Who is told.** The unit's uuid is mapped to a registry id by reading `$REG/*.uuid` once per pass (read-only). A live unit whose uuid no row holds (a session ccd did not start) is skipped and counted as `live-unmapped`: it cannot be told, so it is not swept.

**The rule.** A candidate moves only when all of these hold, measured at the pass and again immediately before the move:
- **untouched 14 days:** every entry under it has mtime and ctime older than 14 days, and every regular file has an atime older than 14 days, unless its filesystem is mounted `noatime` (then atime is not read, and the census says so). Directory atimes are never read, because the sweep's own walk refreshes them. The walk is `find -P <c> -xdev` under `LC_ALL=C`, bounded at 30 s per candidate and 2,000,000 entries per pass;
- **unheld:** `ccd path-users` (§2.6.1) answers nobody for the candidate on both its literal and physical spellings: no process of this uid has its cwd, an open fd, a file-backed mapping, or a `TMPDIR` equal to or under it;
- **arm live:** `~/.ccrc/tmp-sweep-live-arm` exists. Without it the arm records "would move" and touches nothing;
- **not paused:** `~/.ccrc/tmp-sweep-paused` is absent (today's brake).

**The act: quarantine, then delete.** A moving candidate is renamed, without replacing, to `<root>/.ccd-tmp-quarantine/<uuid>/<ns>.<name>` on the same filesystem. On a later pass at least 24 hours on, the sweep asks the holder probe once more about the quarantined path and then removes it with `rm -rf --one-file-system`. Until then the session can move it back; the mail says how. A held quarantined entry stays and is re-asked next pass. A rename that fails leaves the entry where it was and counts as `failed`.

**The census.** The sweep replaces `~/.ccrc/tmp-sweep.json` atomically at the end of every pass. It is the only writer. Its shape is `{v:1, at, liveAt, pressure, arm:'shadow'|'live', roots:[…], sessions:[{id, uuid, bytes, scratchBytes, tasksBytes, entries}], moved:[{seq, id, uuid, name, kind, bytes, at, shadow, quarantine}], counts:{…}}`. `seq` is monotonic across passes. `moved` keeps the last 1,000 rows or 7 days. `kind` is `scratch`, `task-output`, `output-capped` or `test-run`.

**Mail and the budget notice (server).** The server reads the census through the agent's node-file reads (a new `NODE_FILES` key, `tmpSweep`). For each session with new non-shadow `moved` rows it queues one system mail per pass from the `operator` role, kind `status`, subject `tmp-sweep: moved <n> entries (seq <a>-<b>)`, deduplicated by `hasMailWithSubject`. The body lists each entry, its size, its quarantine path and the sentence "move it back before <time> to keep it". The **budget notice** reads `sessions[].bytes`: at 20 GiB or more, it mails the session and, when the session is a run's worker, that run's coordinator (`resolveCoordinator`). It fires once per band, where band = ⌊bytes / 20 GiB⌋, and re-arms when the total falls below 18 GiB. Its body names the five largest entries and the 14-day rule. The notice deletes nothing, so it ships live, not shadowed.

**Cadence.** The live arm runs at most every 6 hours (`liveAt` in the census); under pressure it runs every pass.

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
- **arming:** shadow unless `$REG/orphan-tree-live` exists; the rescue arm is shadow unless `$REG/orphan-tree-rescue-live` also exists. Neither marker has a writer in the tree;
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
| tmp-sweep, live arm cadence | 6 hours | every pass |
| tmp-sweep, test-run quiet | 6 hours | 1 hour |
| ws-collect, loose floor | 48 hours | 24 hours (never below the witnessed 24-hour floor) |
| ws-collect, witnessed floor | 24 hours | 24 hours (raise-only by design) |
| orphan trees, idle | 7 days | 3 days |
| orphan trees, census cadence | 6 hours | 1 hour |

**Retiring the box-local guard.** The box's own disk guard watches the same two thresholds and the work volume's bind mounts. Once the banner, the notification and doctor have shipped, and `CCRC_WORK_MOUNTS` lists the bind targets, the guard is redundant and the operator removes its timer (§8).

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

## 3. Ownership, before and after

| Class | Before | After |
|---|---|---|
| Dead session units under `claude-<uid>` | `ccd-tmp-sweep`, 7 days | unchanged; 2 days under pressure |
| Live session `scratchpad/` and `tasks/` entries | **none** | `ccd-tmp-sweep` live arm: 14 days untouched, unheld, quarantine 24 h, mailed |
| Finished task `.output` over 1 GiB | **none** | `ccd-tmp-sweep` live arm: capped to head and tail |
| Per-session temp bytes | **not measured** | tmp-sweep census; budget notice at 20 GiB to the session and its coordinator |
| `ccrc-testrun-*` roots no later run visits | **none** (the next run under the same `TMPDIR` only) | `ccd-tmp-sweep` test-run arm; vitest's `tmpDir` in the run's own arm |
| Witnessed `~/.cc-tmp/<id>` leaves with no row | `ws-collect` | unchanged |
| Unwitnessed leaves and loose `~/.cc-tmp` entries | **the operator's** (D-5888, R57, R59) | `ws-collect` loose arm: 48 h ctime-quiet, unheld, token-bound identity |
| ccd-root orphan worktrees (policy row 5) | `ws-gc --prune`, operator only | orphan-tree lane (server, `ws-orphan`); `ws-gc --prune` stays for the operator on the same rules |
| `.claude/worktrees` (policy row 6) | **UNASSIGNED** (Open Q6) | orphan-tree lane, class `claude` |
| `.superpowers/worktrees` | **undeclared** | orphan-tree lane, class `superpowers` |
| Other linked worktrees | reported by `ws-gc` | reported by the census, `other`, never removed |
| Fleet work filesystem fill | box-local guard; doctor on `$HOME` only | agent `disk` op → health `disk` block → banner and notice; doctor on every work filesystem |
| Transcripts and sidecars | #317 / #840 P4-7..9 | unchanged (out of scope) |

## 4. Why it is safe

- **Fail toward keeping.** Every unreadable, unmeasured, truncated or ambiguous answer keeps the candidate and says why. A walk past its bound is `unmeasured`. A census past its cap audits nothing new.
- **Holders.** One probe, extended only toward refusing: cwd, every fd, every file mapping and `TMPDIR`, on both spellings, asked at the pass and again nearest each act. Processes of another uid cannot be read without root; the fleet runs one uid, and this is a stated residual.
- **Quiet floors.** Every rule waits for every entry to be quiet, not the candidate's top level. Ctime is used wherever an entry could be renamed or chmodded into place. The floors are box-measured and a server argument cannot lower one.
- **Reversibility.** The live arm and both collect arms move before they delete. The live arm's 24 h grace is the session's window to put an entry back.
- **Tokens and licences.** Both server lanes act only on a token the box recomputes inside its lock, seen twice an interval apart, so a tree or entry that changes between the audit and the act is refused.
- **Arming and kill switches.** Each new destructive arm ships in shadow and is armed by its own marker, none of which has a writer in the tree: `~/.ccrc/tmp-sweep-live-arm`, `$REG/collect-loose-live`, `$REG/orphan-tree-live`, `$REG/orphan-tree-rescue-live`. `tmp-sweep-paused` stops the box sweep, `reclaim-paused` stops both server lanes, and the collect switch stops the loose arm with the witnessed one.
- **Disjoint collectors.** tmp-sweep acts only inside units it measures live, or on units it measures dead; `ws-collect` only on `~/.cc-tmp` entries with no row; the orphan lane only on worktrees with no row; reclaim and expire only on rows. A path is in at most one population.
- **No herd.** Server lanes act at most once per pass fleet-wide. Nothing restarts a session. Account switching is untouched: none of this code runs on the swap path.
- **SAFETY.** The new verbs are the server's (§2.6.2). Every test uses a fixture HOME (`makeCcdHarness`). Nobody runs a new verb against a live box from a shell or a test.

## 5. Wire and deploy

- **Agent:** a new op, `disk`, in `ready.ops`. A new `NODE_FILES` key, `tmpSweep: 'tmp-sweep.json'`. New grant prefixes: `['ws-audit','--orphans']`, `['ws-audit','--orphan-hex']`, `['ws-audit','--collect-census']`, `['ws-audit','--loose-hex']` and `['ws-orphan','--expect']`, with `'ws-orphan': '--expect'` in `REQUIRED_VERB_FLAG`. `ws-gc` stays in `UNGRANTABLE_VERBS`.
- **ccd capabilities:** `path-users-v1`, `collect-loose-v1`, `orphan-v1`. The server's `CCD_CAN` rows refuse without them, so each server lane is inert on a box whose ccd predates it.
- **Server ↔ PWA:** `FleetHealth.disk`, optional, through `readDiskHealth`. A new banner id. New feed titles in their lanes' tables.
- **No `FLEET_PROTO` bump** and no coord.db migration. Everything is additive and absence-permits.
- **Order:** agent lane first, as `ccrc rollout` does by default. A server reading a field the agent does not yet send reads unmeasured.

## 6. Lifecycle and policy edits

- `shared/lifecycle.ts`:
  - `claude-tmp-session-dirs`: the collector names the live arm, its 14 days, its quarantine and its pressure ages; the bound becomes "session lifetime + 7 days, and 14 days untouched inside a live session".
  - `child-tmp-roots`: the D-5888 comment says it is reversed by the loose arm.
  - new `cc-tmp-loose-entries` (`~/.cc-tmp/<name>` with no witness and no row; pattern S; collector `ws-collect` loose arm).
  - `server-test-run-dirs`: the collector adds the test-run arm.
  - new `ccd-orphan-worktrees` and `agent-worktrees` (`.claude/worktrees`, `.superpowers/worktrees`; pattern W; collector the orphan-tree lane).
  - new `tmp-sweep-census` (`~/.ccrc/tmp-sweep.json`; pattern X).
- `2026-08-11-artifact-lifecycle-policy.md`: rows 5, 6 and 9 name their collectors; foreign worktrees move from Tier C to Tier B; Open Question 6 is marked RESOLVED 2026-10-23 with option (a), and the "declared byte budget per box" question cites the 85/92 alarm and the 20 GiB session budget as a partial answer.
- `child-reclamation-contract.md`: R38 and R59 amended (§2.4).
- `README.md`: the tmp-sweep section, the collector section, a new orphan-tree section, and Fleet health's field list.
- `CLAUDE.md`: the SAFETY line for `ws-orphan`, and the load-flake bullet if a new suite walks the real `/proc`.

## 7. Tests

The plan carries each task's red-first cases and mutation table. In summary:
- **Probe:** a fake process table with a mapping, an fd, a cwd and a `TMPDIR`, each holding one of several paths answered by one walk; an unreadable `map_files` falls back to `maps`; the walk past its bound is unmeasured.
- **tmp-sweep:** a live unit's old entry moves to quarantine and is deleted a pass later; a young file deep under an old directory keeps it; an atime-fresh file keeps it (and is ignored on a `noatime` fixture); a held entry stays; `scratchpad/` itself and the unit itself are never candidates; an unmapped live unit is skipped; shadow writes rows and moves nothing; the census shape and `seq`; the output cap's head, marker and tail; the test-run arm's listener, quiet and holder rules; pressure ages from a fake `df`.
- **Mail and budget:** one mail per pass per session, deduplicated; no mail for shadow rows; the notice's band crossing and re-arm; the coordinator copy.
- **Loose collect:** every census class; hex names, including option-like and dotted ones; the floor; a recreated name fails the token; the open-run hold exempts loose entries; shadow under the loose marker; resume from a loose record.
- **Orphan trees:** every census class; every ladder rung's refusal, red when that rung is deleted; the rescue token only for rung 9; the verb's lock, recompute, pin, re-ask and no `--force` (a mutant that adds it is red); `branch -d` for `ccd-root` only; the lane's licence, pacing, arming and feed rows.
- **Alarm:** each threshold with hysteresis and the two-measurement debounce; inode-driven levels; a missing expected mount is critical; one push per episode level; the block absent before the first measure and with an older agent; doctor's per-filesystem lines; the bash twins equal L0.
- **UI:** the banner at 360, 390, 1280 and 1920 wide, in both skins and both themes, shown at warn and critical and hidden otherwise.

## 8. Rollout

1. **Wave 1, see it** (DR-1 to DR-6): vocabulary, the agent op, the health block, the notice, the banner, doctor. Nothing deletes. After it deploys, the operator watches one real crossing or a fixture-driven one.
2. **Wave 2, live scratch** (DR-7 to DR-12): the probe, the live arm in shadow, the output cap, the test-run arm, vitest's `tmpDir`, mail and the budget notice. The budget notice is live at once. After a week of shadow rows, the operator arms `tmp-sweep-live-arm`.
3. **Wave 3, loose `~/.cc-tmp`** (DR-13 to DR-15), in shadow until `collect-loose-live`.
4. **Wave 4, orphan worktrees** (DR-16 to DR-19), in shadow until `orphan-tree-live`; rescue until `orphan-tree-rescue-live`.
5. **Then** the operator retires the box-local guard (§2.5) and lists `CCRC_WORK_MOUNTS`.

Every ccd change deploys agent lane first. Waves 2 to 4 are independent of each other once DR-7 lands, and each waits for #1132 where it edits the same ladder region (the plan's Gates).

## 9. Open questions for the operator

1. **Rescue then remove.** May a clean, idle, unheld tree whose HEAD is on no remote be removed after its commits are pinned under `refs/ccrc/attic/orphan/`? **Recommendation:** yes, behind its own marker, after the main arm has run live for a week.
2. **Reads count as touches.** Should a file read in the last 14 days (its atime, under `relatime`) keep a live entry? **Recommendation:** yes. It keeps more, and an atime never makes the sweep delete.
3. **Arming by marker or by Settings.** The three new arms ship with hand-touched markers. **Recommendation:** markers now; Settings switches in the PWA epic, as the collect switch did in its wave 10.
4. **Pressure ages.** Confirm or change the table in §2.5.3.
5. **The guard's mount half.** Should `CCRC_WORK_MOUNTS` carry the work volume's bind targets so the box-local guard can be removed entirely? **Recommendation:** yes. Without it, keep the guard's mount check and retire only its fill check.
6. **Who hears the budget notice.** The session and its coordinator. Should the operator's feed also record each crossing? **Recommendation:** record-only, never pushed; the disk alarm is the operator's page.
7. **Scratch inside a live child's leaf.** If Step 0 finds Claude Code's scratch under `~/.cc-tmp/<id>/claude-<uid>`, the live arm sweeps there too. Confirm.
8. **The output cap.** 1 GiB, keeping 64 MiB at each end. Confirm.
9. **Claude Code's branches.** Leave the branches of removed `claude` and `superpowers` trees, and never remove `other`-class trees. Confirm.

## 10. Out of scope and follow-ups

- **#1119 item 3, work inside transcript directories:** a follow-up issue. Sketch: a doctor line, and a health count of non-transcript files above a size under `<config>/projects/<cwd>/<uuid>/`; a skill rule saying where working files go. Its collection needs a transcript-retention ruling (policy Open Q1).
- **Skill text for long output** (#1119 item 1's second half): the coordinator and worker skills' clauses are pinned verbatim, so a new clause is its own reviewed change.
- **Transcript dedupe** (#317, #840 P4-7 to P4-9): unchanged.
- **Settings switches** for the new arms (§9 Q3).
- **A PWA card** for the `holders` view beyond the banner line: the PWA epic.

## 11. Review log

**rev 0 (2026-10-23).** Written against `origin/main` `a68c90f15`, the rulings comment on #1119, and the open PRs measured that day (#1132 holds `ccd/ccd`, `CLAUDE.md` and the reclamation contract; #1114 holds `ccd/ccd`; #1164 holds `BannerStack.tsx`; #1162 holds `watch.ts`; #1149 holds `shared/api.ts` and `CLAUDE.md`; #1154 holds `shared/lifecycle.ts`).
