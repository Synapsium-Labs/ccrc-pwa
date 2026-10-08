# Child-reclamation wave 7: the temp-root collector (`ws-collect`), inert, and the reclaim tail's ccd corrections Implementation Plan

> **For agentic workers:** this plan is dispatched as a wave to a `ccrc-worker` session; follow the `ccrc-worker` skill for the protocol (ack, claims, asks, wave-done). To execute the tasks, REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Programme:** child-reclamation (CCR-15), **wave 7 of 9**, run 347. **Deploy class: AGENT-FIRST, and inert.** Everything this wave ships moves with the fleet box's `ccd`. No server composes `ws-collect` until wave 9. The server-side files this wave touches only DECLARE: a constant, a budget row, union members and sentences.

**Goal:** Ship the verb that takes back a temp root nobody owns any more, and make it unable to take anything else. After this wave:
- `ccd ws-audit --session <id> --collect` says whether a witnessed temp root can be collected, and mints a token when it can;
- `ccd ws-collect --expect <token> --session <id>` moves that leaf into a quarantine slot by rename, re-proves that nobody was handed it, and only then removes it;
- a crash at any step leaves a record under `$REG/tmpquarantine/` that the next audit finds, whatever the witness now says;
- the reclaim tail says `containment-refuted` when it proves a tree is not the child's own, instead of retrying the same `worktree-remove-failed` for ever;
- a reclaim token also binds the workspace's generation, so a licence minted for one generation cannot be spent on a re-mint (X1's ccd half);
- three ccd corrections land: the failed document says whether a breadcrumb stood (`crumb`), rung 8 stops reading git's silent omission as "no record", and the normalise reason is capped;
- review 346's prose findings are corrected, and review 341's missing pins are added.

**Architecture:** four areas.
1. **The reclaim tail's corrections (Tasks 1 to 3).** These are reclaim-ladder and tail code, shared with ws-expire.
   - `_ws_reclaim_owned` becomes three-valued, and the tail prints `containment-refuted` on a proven "not own".
   - `_WS_RCL_CRUMB` carries `crumb`.
   - Rung 8 asks `_ws_reclaim_log_of` before it believes a missing record.
   - `_WS_NORMALISE_WHY` is capped.
   - `_ws_reclaim_generation` binds the reclaim token to the generation.
2. **The collector's building blocks (Task 4).** A new COLLECT region holds:
   - the quarantine record (`$REG/tmpquarantine/`);
   - the quarantine directory and its slots;
   - the move-and-prove helper (`mv -T -n --no-copy`, proven by lstat);
   - the ctime-only idle walk, and the token;
   - R64 Rule 2 for a leaf (`_ws_collect_rows_clear`);
   - the checkout alias on `_ws_leaf_checkouts` and `_ws_leaf_remove`.
3. **The verb (Tasks 5 to 8).**
   - `ws-audit --collect` (Task 5) and `ws-collect` (Task 6), exactly as contract §14 R66 to R68 rule.
   - Task 7 wires them as ws-expire was wired: caps, the entry guard and `is_protected`, the agent grant, the declarations.
   - Task 8 is the SAFETY suite: a recycled-slug spawn at every step boundary, a crash after every step, forgeries, and the scan pins R67 rests on.
4. **Prose, pins and docs (Tasks 9 and 10),** then the whole-branch pass (Task 11).

**Tech Stack:**
- bash 5 (`ccd/ccd`, `set -uo pipefail`, re-stamped by `ccd/ccrc restamp`);
- GNU coreutils ≥ 9.2 for `mv --no-copy`, measured on the fleet box at 9.4. Without it the verb answers unmeasured;
- GNU findutils (`find -P -xdev -printf %C@`);
- git ≥ 2.43;
- python3 ≥ 3.7;
- Linux `/proc` and `/proc/self/mountinfo`;
- TypeScript (server and shared), vitest 4;
- Node ≥ 22.13.0.

`node:sqlite` is untouched, and there is no migration. The PWA changes by one `ACT_WORD` entry and its test.

**Spec:** `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`, at §5.2 (the temp root and the two collectors), §5.5, §5.6, §7 and §8. Task 10 writes this wave's text into each of them, and adds the collector's own section.

**Contract:** `docs/superpowers/programs/child-reclamation-contract.md`. **§14 (wave 7's pre-flight, R65 to R72) BINDS this plan** and amends §1 to §13. The coordinator's rulings on the task drafts are folded in below, under "Rulings that amend the task text", and a ruling wins over any task text it names. Every "contract §N" or "R6x/R7x" in this plan means that file.

**Programme ledger:** `docs/superpowers/programs/child-reclamation.md`.

**HARD BOUNDARY.** This wave edits only these files:
- `ccd/ccd`:
  - a new COLLECT region below line 19109;
  - the RECLAIM region, for Tasks 1 to 3;
  - the entry guard and the caps line, line-count-neutral;
  - the `ws-audit` hand-off, line-count-neutral;
- `ccd/ccd-entry.py` (`is_protected`);
- `agent/src/whitelist.ts`, and the agent tests it needs;
- `server/src/ccdargv.ts` (`COLLECT_CAP`, with no composer);
- `server/src/remote/runner.ts` (one budget row);
- `shared/api.ts` (the `collect` act, the new refusal words and their sentences, and the additive keys);
- `server/test/**`;
- `deploy/measure-workspace-lifecycle.py`, only if Task 7 rules the act needs a class there, and its test;
- `pwa/src/session/journalWords.ts` (one `ACT_WORD` entry) and `pwa/test/journal-words.test.ts` (Task 4's act part);
- `README.md`, `CLAUDE.md` and `agent/CLAUDE.md` (Task 10, plus the citation tax a `shared/api.ts` insertion owes);
- the spec, and the contract's "§14 as built" note (Task 10).

It adds:
- **exactly ONE new ccd verb,** `ws-collect`, and one audit mode, `ws-audit --collect`, which rides the existing granted `['ws-audit','--session']` prefix;
- **one capability pair,** `collect-v1` and `ws-collect`, on the existing caps line;
- **one agent grant,** with `--expect` required;
- **no server composer.** No `server/src` file builds a `ws-collect` argv except the declared, uncalled builder, and a scan pins that;
- **no coord.db migration, no PWA change beyond the one `ACT_WORD` entry, and no `deploy/` change** beyond the one named above. `server/src/deadCoordinator.ts` is workspace-lifecycle's and is never edited.

It does NOT edit `_ws_expire_locked` or `_ws_expire_cwd_users`, which are workspace-lifecycle's (R72). It adds no `_reg_get` call. A step that seems to need anything outside this boundary STOPS: name it by slug in the wave-done, and build nothing.

---

## Global Constraints

Each line binds every task.

- **Fixture HOMEs only.** Every ccd case runs under `makeCcdHarness` homes (`server/test/ccdWsHelpers.ts`), cleaned by `tmpHelpers.ts`. Every `~/.cc-tmp`, `$REG`, quarantine and record path derives from the fixture HOME. No new test file spreads `process.env`: it builds its environment, or takes `inheritedEnv()`.
- **Never run `ccd` against the live `$HOME`,** from a shell or a test. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*.service`. Never print a secret file's contents.
- **No destructive verb against the live host:** `ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore`, `ws-reclaim`, `ws-expire` and `ws-collect`. The live residue in `~/.cc-tmp` stays the operator's (R59, R71). That covers every unwitnessed leaf, the three kept leaves, the row-less ones, the clips orphans, and the leaked tmux servers in `ccrc-pwa-brisk-river`'s leaf.
- **Re-stamp after EVERY `ccd/ccd` edit:** run `bash ccd/ccrc restamp ccd/ccd`, then `node shared/mark.mjs --check ccd/ccd` (exit 0) and `server/test/ownership.test.ts`. Never commit an unstamped `ccd/ccd`.
- **The 19109 boundary and the citation tax.**
  - An edit at or above `ccd/ccd:19109` keeps the LINE COUNT unchanged, or re-measures the session-hook census with the instrument, never by hand. That covers the platform block, the entry guard, the LC act list, `_ws_slug_free`, the caps line and the `ws-audit` hand-off.
  - `ccd/ccd` lines 1 to 1221 are a platform block, byte-identical with `ccd/ccrc`'s. This wave adds no `_plat_` helper: the move primitive is inline in the COLLECT region, on its Linux arm.
  - Each insertion into `shared/api.ts` re-points README's `shared/api.ts:` anchors BY CONTENT, in the same task's commit.
- **R56's overlap rule (contract §14 R72).**
  - Workspace-lifecycle (`ccrc-pwa-quiet-river`; its wave 5 is run 345) edits the EXPIRE region. This wave never edits `_ws_expire_locked` or `_ws_expire_cwd_users`.
  - The second lander merges `main` (`git merge`, never a rebase), re-stamps, and re-runs `ownership.test.ts`, `mark.mjs --check`, the citation cases, `single-definition` and `deviation-refs`.
  - Open PR #319 appends to `agent/src/whitelist.ts`, `server/src/ccdargv.ts` and `server/src/remote/runner.ts`, and takes bypass fixtures g16 to g19. Task 0 measures every append point. Each task appends after whatever is last at the tree it works on.
- **New tests go in NEW files,** because of the 600 s foreground ceiling. An existing test file changes only at the line a task names. Every new file runs in under 500 s alone.
- **Run vitest in the foreground, from inside the package:** `./node_modules/.bin/vitest run test/<file>`, with a timeout of at least 600000 ms. Never bare `npx vitest`, and never backgrounded. Re-run a known load flake in isolation before calling it a break.
- **No `D-` token in a commit message, and no number range anywhere.** No file gains a `D-` token for a number `origin/main` does not define. The coordinator assigns this wave's numbers at the fix round; name a departure by slug.
- **Branch discipline:** one commit per task, on this workspace's own branch, never a feature branch. Absorb `main` only on a worker clause-16 licence, with `git merge`.
- **R23: committed code comments and test titles cite the SPEC, never the contract.** Where a task's text says "R6x" inside a committed comment or an `it`/`describe` title, write the spec section Task 10 fills:
  - R66, R67 and R68 → the spec's new collector section (§5.10);
  - R69 and R70 → spec §5.6;
  - X1's generation → spec §5.5.
- **Locate code by CONTENT.** Line numbers are hints at `b0647d850`.
- **Topology-clean:** no hostname, IP, tailnet name or docserver URL in any committed file, this plan included.
- **Mutation-table discipline:** every guard ships with a case that goes red when the guard is deleted or mutated, measured before and after. Revert each mutation before the next.
- **Wire:** additive only, absence permits, ONE reader per field, and no `FLEET_PROTO` bump. This wave adds no reader; wave 8 and wave 9 add them.
- **Linux-first.** On Darwin the collector answers unmeasured, which refuses. Each real-process or real-rename describe skips off Linux, and says so.

## Rulings that amend the task text (binding; the coordinator, 2026-10-08)

The coordinator ruled on the task drafts, and those rulings are ALREADY APPLIED in the task text below. This section is the record of them, and it adds the rulings made after the drafts were reconciled. Wherever any task text still disagrees with a ruling here, the ruling wins, and the worker names the disagreement by slug in the wave-done.

**Applied in the text.**
- **The act is declared first.** The `collect` act is declared in Task 4's first part, "4-act", moved there from Task 7: ccd's `_LC_ACTS` (line-count-neutral), `LifecycleAct`, `LIFECYCLE_ACT_MAP`, the PWA's `ACT_WORD`, the instrument's class, and the act pins. Task 7 keeps the cap, the reachability and the grant.
- **Each word is declared in the commit of its first literal journal site:**
  - `containment-refuted` in Task 1;
  - `witness-mismatch` and `quarantine-kept` in Task 5;
  - `not-witnessed`, `registered` and `not-idle` in Task 6.
  - The audit's held lock answers the existing word `in-progress`.
- **The move is ONE function** in the COLLECT region, exempted BY NAME in `macos-platform.test.ts`.
- **The floor has one function,** `_ws_collect_floor_s`, which prints `max(86400, WS_COLLECT_IDLE_FLOOR_S)`. A test lowers the floor only by redefining that function in its sourced harness, never through the knob.
- **The quarantine record carries no slot path.** The slot is derived from the record's NAME and the physical quarantine directory.
- **The row rule compares an absent spelling literally,** so the ask after the move is never vacuous.
- **Task 6 owns the seams** `_ws_collect_gap` and `_ws_collect_mountinfo`. Task 8's Step 10 is a stub.
- **The alias is two trailing positionals,** and it is the leaf's PHYSICAL pre-move spelling.
- **The containment and the strip.** Every collector step that runs git runs under `_ws_reclaim_contained`. Task 4 widens `git-env-strip.test.ts`'s SCOPE.
- **Task 2 guards the zero head.** An all-zero recorded `HEAD` reads unmeasured.

**Ruled after reconciliation; these bind wherever the text disagrees.**
- **R-a: the record reader has four answers, never an overloaded rc 2.** The reader answers:
  - 0: parsed;
  - 1: absent;
  - 2: malformed, including a body `id=` that differs from the name's id, and a bad `checkouts=` encoding;
  - 3: unmeasured, when the physical `~/.cc-tmp` cannot be resolved, so the slot cannot be derived.

  Callers read 2 as `quarantine-kept` (terminal) and 3 as unmeasured (retried). Every caller and case that reads the reader's rc is adjusted to match.
- **R-b: `checkouts=` stays in the record.** It carries the percent-encoded `admin=backlink` pairs that the alias needs on a resume. "The record body carries no path" means no SLOT path. The reader rejects a malformed encoding with rc 2.
- **R-c: the boundary.**
  - The HARD BOUNDARY admits `pwa/src/session/journalWords.ts` (one `ACT_WORD` entry) and `pwa/test/journal-words.test.ts`.
  - The docstring edit Task 4's act part drafts in `server/src/deadCoordinator.ts` is DROPPED. That file is workspace-lifecycle's (R72), and the collector act's exclusion from its deliberate-put-down set is pinned by a test only.
  - Task 11's Step 4 admits these two PWA files.
- **R-d: the idle walk's bound is 30 s.** `WS_COLLECT_IDLE_SCAN_S` is 30, not R68's 60.
  - This is the departure `idle-walk-bound-30s`. With the in-use probe's 10 s and the checkout scan's 30 s, the audit fits the 90 s `ws-audit` runner row: 70 s plus the row pass.
  - The largest live leaf walks in at most 4.8 s, warm. A timeout answers unmeasured, and the leaf is retried.
  - Wave 9 may still key a budget on the mode.
- **R-e: a retaken original path is terminal only while it is retaken.** A record whose original path is retaken answers `quarantine-kept` for as long as it is retaken. Once the path is free again, the next pass resumes from the record, with every re-proof. The drafted cases read it this way.
- **R-f: a leaf that vanishes before step 2 is a retry.** A leaf absent at step 2's lstat, after the evaluation saw it, answers `state-changed` and is retried, never `witness-mismatch`. The next audit takes the witness-without-leaf arm.
- **R-g: Task 6 adopts Task 5's registry check.** Task 6 calls `_ws_collect_registered`, Task 5's function, for its registry check. When Task 6 adds its `_WS_RCL_CRUMB=''` shadow, it also amends Task 2's comment above `_WS_RCL_CRUMB=''` to name that shadow.
- **R-h: Task 2 measures both arms.** It also measures the STANDING arm with an admin `HEAD` at mode 000, and states the outcome. If that arm can pin a zero id too, the same guard covers it.
  - The pre-existing hazard is measured on git 2.43: `git update-ref` with an all-zero new value exits 0 and DELETES the named ref.
  - The wave-done reports, in its own paragraph, whether any arm reached that before this wave.
- **R-i: Task 4 names the alias.** Task 4's 4E ends `_ws_leaf_checkout_one`'s "OUTSIDE IT" sentence with the alias clause, so Task 9's pointer reaches a complete sentence.
- **R-j: counts are measured, never copied.** Every count, mutation row's red text and wall time a draft marks as derived, predicted or unmeasured is measured by the worker. The measured value replaces the draft's, and a mismatch in a count is not a departure.

## Review Focus (the five failure modes most likely to bite)

1. **A recycled-slug spawn loses its leaf.** A ws-add re-mints the id while the collector works, and `_child_tmpdir`'s `mkdir -p` hands the new child the inode the collector is about to remove.
   - Pinned by Task 8's step-boundary cases, from before step 1 to after step 6.
   - Pinned by the unlistable-`$REG` case, where the slug proof must answer unmeasured and never free.
   - Pinned by the three scan pins: one TMPDIR composer, one `.child` writer, and the marker read before the `mkdir`.
2. **A quarantine slot is orphaned, or a kept record is dropped in silence.** A crash after the move, a witness rewritten by a recycled spawn, or a later tail's drop must never leave a leaf in a slot that no audit visits. Pinned by Task 8's crash-after-every-step cases, and by Task 6's record-order cases: the record is written before the move and dropped LAST.
3. **A foreign tree is removed through the collector.** Three shapes:
   - a recycled git admin name makes a moved worktree look like the leaf's own;
   - a stopped session's clone sits inside a dead child's leaf;
   - a link or file swapped in at the id.

   Pinned by Task 4's alias conditions (1) and (2), by `_ws_collect_rows_clear`, by Task 6's step 2, and by Task 8's full-verb cases for each.
4. **The idle floor or the token is wrong.** Three shapes:
   - a future mtime holds a leaf for ever;
   - a floor or token re-asked after the move, whose ctime it re-stamps, never passes;
   - a token that does not change when the tree does.

   Pinned by Task 4's walk and token cases, and by Task 6's "nothing is asked of the tree after the move".
5. **A reclaim or expire stop becomes a continue.** R69 or R70 turns a stop into a continue, a refusal into a removal, or a terminal into a silent retry. Pinned by Task 1's per-arm cases (every refusal arm keeps a non-zero rc), Task 2's rung-8 and vanished-arm cases, and Task 3's re-mint case.

## File Structure

Every file this wave touches, and the tasks that touch it. Each task's own **Files** block is the authority for what it does there.

| File | Task(s) |
|---|---|
| `ccd/ccd` | 1, 2, 3, 4, 5, 6, 7, 8, 9 |
| `shared/api.ts` | 1, 3, 4, 5, 6 |
| `server/test/lifecycle-refusal-word.test.ts` | 1, 5, 6 |
| `server/test/ccd-child-reclaim-verb-tail.test.ts` | 1 |
| `server/test/ccd-child-reclaim-verb.test.ts` | 1, 2 |
| `server/test/ccd-child-reclaim-recovery.test.ts` | 1 |
| `README.md` | 1, 4, 5, 6 |
| `server/test/containmentRefutedFamilies.ts` (new) | 1 |
| `server/test/ccd-reclaim-owned-rc.test.ts` | 1 |
| `server/test/ccd-reclaim-tail-refuted.test.ts` | 1 |
| `server/test/ccd-expire-tail-refuted.test.ts` | 1 |
| `server/test/containment-refuted-word.test.ts` | 1 |
| `server/test/git-env-strip.test.ts` | 1, 4 |
| `server/test/ccd-child-reclaim-hardening.test.ts` | 1 |
| `server/test/ccd-child-reclaim-unmeasured-journal.test.ts` | 2 |
| `server/test/ccd-child-reclaim-crumb.test.ts` | 2 |
| `server/test/ccd-child-reclaim-why-cap.test.ts` | 2 |
| `server/test/ccd-child-reclaim-silent-omission.test.ts` | 2 |
| `server/test/ccd-child-reclaim-audit.test.ts` | 3, 5 |
| `server/test/ccd-child-reclaim-row-generation.test.ts` | 3 |
| `server/test/macos-platform.test.ts` | 4, 6 |
| `server/test/ccd-workspaces.test.ts` | 4 |
| `pwa/src/session/journalWords.ts` | 4 |
| `pwa/test/journal-words.test.ts` | 4 |
| `deploy/measure-workspace-lifecycle.py` | 4 |
| `server/src/deadCoordinator.ts` | none: its docstring edit is DROPPED (R-c) |
| `server/test/lifecycle-acts.test.ts` | 4 |
| `server/test/lifecycle-vocabulary.test.ts` | 4 |
| `server/test/ccd-lifecycle-emit.test.ts` | 4 |
| `server/test/single-definition.test.ts` | 4 |
| `server/test/ws-collect-act.test.ts` | 4, 7 |
| `server/test/ccd-collect-record.test.ts` | 4 |
| `server/test/ccd-collect-quarantine.test.ts` | 4 |
| `server/test/ccd-collect-idle-token.test.ts` | 4 |
| `server/test/ccd-collect-rows.test.ts` | 4 |
| `server/test/ccd-leaf-checkouts-alias.test.ts` | 4 |
| `server/test/ccd-child-reclaim-pause.test.ts` | 5 |
| `server/test/ccd-die-containment.test.ts` | 5 |
| `server/test/ccd-ws-expire-audit.test.ts` | 5 |
| `server/test/ccd-wsaudit-nonpoison.test.ts` | 5 |
| `server/test/ccd-refusal-scan.test.ts` | 5, 6 |
| `server/test/collectFixture.ts` (new) | 5 |
| `server/test/wsCollectFixture.ts` (new) | 5, 6 |
| `server/test/collectRaceFixture.ts` (new) | 5, 8 |
| `server/test/ccd-collect-audit.test.ts` | 5 |
| `server/test/ccd-collect-audit-rungs.test.ts` | 5 |
| `server/test/ccd-collect-audit-resume.test.ts` | 5 |
| `server/test/ccd-ws-collect-verb.test.ts` (new) | 6 |
| `server/test/ccd-ws-collect-move.test.ts` (new) | 6 |
| `server/test/ccd-ws-collect-reprove.test.ts` (new) | 6 |
| `server/test/ccd-ws-collect-order.test.ts` (new) | 6 |
| `server/test/ccd-ws-collect-resume.test.ts` (new) | 6 |
| `ccd/ccd-entry.py` | 7 |
| `server/src/ccdargv.ts` | 7 |
| `server/src/remote/runner.ts` | 7 |
| `agent/src/whitelist.ts` | 7 |
| `agent/test/types/bypasses/g20-ws-collect-without-expect.ts` (new) | 7 |
| `agent/test/types/ok/legit-whitelist.ts` | 7 |
| `agent/test/whitelist-structural.test.ts` | 7 |
| `agent/test/ccd-entry-exec.test.ts` | 7 |
| `server/test/ccd-archive.test.ts` | 7 |
| `server/test/caps-token-shape.test.ts` | 7 |
| `server/test/whitelist-subset.test.ts` | 7 |
| `server/test/remote-runner.test.ts` | 7 |
| `server/test/ccdargv-dec-parity.test.ts` | 7 |
| `server/test/ccd-ws-collect-reach.test.ts` | 7 |
| `server/test/ws-collect-wiring.test.ts` | 7 |
| `server/test/ccd-collect-race-spawn.test.ts` (new) | 8 |
| `server/test/ccd-collect-race-crash.test.ts` (new) | 8 |
| `server/test/ccd-collect-race-forge.test.ts` (new) | 8 |
| `server/test/ccd-collect-race-substrate.test.ts` (new) | 8 |
| `server/test/ccd-collect-race-ids.test.ts` (new) | 8 |
| `server/test/ccd-collect-race-admin.test.ts` (new) | 8 |
| `server/test/ccd-collect-recycle-pins.test.ts` (new) | 8 |
| `server/test/ccd-child-tmpdir.test.ts` | 8 |
| `server/test/ccd-child-reclaim-done-kept.test.ts` | 9 |
| `server/test/ccd-leaf-checkouts.test.ts` | 9 |
| `server/test/ccd-dir-physical-builtin.test.ts` | 9 |
| `server/test/ccd-leaf-checkouts-pins.test.ts` | 9 |
| `docs/superpowers/plans/2026-10-06-child-reclamation-wave6-reclaim-repairs.md` | 9 |

## Execution order and dependencies

Task 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11. Each task is one commit on the workspace branch.

| Task | Needs | Model routing | Why this place |
|---|---|---|---|
| 0 Entry conditions | — | `sonnet`, medium | Proves the tree, the tools, the overlaps and every anchor's starting state |
| 1 `_ws_reclaim_owned` three-valued, `containment-refuted` | 0 | `opus`, high | The first token declaration. The tail's rc handling that Task 2 builds on |
| 2 `crumb`, the reason cap, rung 8 | 1 | `opus`, high | Edits the same failure path as Task 1, so it comes after |
| 3 X1's generation | 2 | `opus`, high | The last RECLAIM-region edit, before the COLLECT region opens |
| 4 The `collect` act (4-act), then the collector's building blocks | 0 | `opus`, xhigh | The act exists before anything journals it; then everything Tasks 5, 6 and 8 consume |
| 5 `ws-audit --collect` | 4 | `opus`, high | Mints the token Task 6 spends. Declares its refusal words |
| 6 `ws-collect` | 4, 5 | `opus`, xhigh | The destructive verb |
| 7 Wiring | 5, 6 | `opus`, high | The dispatcher arm and the caps line in one commit, the entry guard, `is_protected` and the grant, once the verb exists |
| 8 The SAFETY suite | 6, 7 | `opus`, xhigh | Runs the verb through its real entry |
| 9 Review 346's prose and 341's pins | 0 | `sonnet`, high | Independent of the collector |
| 10 Docs | 1–9 | `sonnet`, high | Writes the spec sections the code comments cite (R23) |
| 11 Whole-branch verification and the PR | 0–10 | `sonnet`, high | The wave-done's `suite:` line |

Tasks 1 to 9 each end with a re-stamp. Every task that inserts into `shared/api.ts` pays README's re-pointing in its own commit.

---

### Task 0: Entry conditions

**Model routing:** `sonnet`, effort `medium`.

**Files:** none. Nothing is written by this task.

This task is measured on this workspace's own checkout, before Task 1, from the workspace root.
- Each command prints what its comment states.
- If any does not, **STOP**: report the command and its exact output to the coordinator, and build nothing.

- [ ] **Step 1: The tree**

```bash
git merge-base --is-ancestor b0647d850 HEAD; echo "a1 rc=$?"                                        # (a1) rc=0: wave 6 is in the tree
grep -c '^## 14\. Rulings, 2026-10-08' docs/superpowers/programs/child-reclamation-contract.md       # (a2) 1: contract §14 is committed
grep -c '^### §12 as built' docs/superpowers/programs/child-reclamation-contract.md                 # (a3) 1
```

- [ ] **Step 2: Wave 6's symbols, which this wave consumes**

```bash
for f in _ws_leaf_remove _ws_leaf_checkouts _ws_leaf_why_line _ws_tmproot_witness_read _ws_tmproot_witness_write \
         _ws_tmproot_witness_drop _ws_tmproot_remove _ws_path_users _ws_dir_physical _child_tmpdir _ws_reclaim_owned \
         _ws_reclaim_failed_json _ws_reclaim_fail _ws_reclaim_ladder _ws_reclaim_workdir_shared _ws_reclaim_log_of \
         _ws_reclaim_absent _ws_slug_free; do
  printf '%s %s\n' "$f" "$(grep -c "^$f() *{" ccd/ccd)"; done                                     # (b1) every count is 1
```

- [ ] **Step 3: Tools**

```bash
uname -s                                                                  # (c1) Linux
mv --version | head -1                                                    # (c2) GNU coreutils, 9.2 or newer
mv --help | grep -c -- '--no-copy'                                        # (c3) 1 or more
/usr/bin/find --version | head -1                                         # (c4) GNU findutils
d=$(mktemp -d); stat -c '%.9W %W' "$d"; rmdir "$d"                        # (c5) a non-zero nanosecond birth time and its whole second
git --version                                                             # (c6) 2.43.0 or newer
python3 -c 'import sys; print(sys.version_info >= (3, 7))'                # (c7) True
```

- On (c1) not Linux: Tasks 4, 6 and 8's real-rename and real-process describes skip. Report it, and continue only if the coordinator says so.
- On (c2) older than 9.2, or (c3) 0: STOP. The verb's unmeasured arm for a missing `--no-copy` is pinned by a shim in Task 4, never by this box's `mv`.

- [ ] **Step 4: The stamp, the regions and the citation boundary**

```bash
node shared/mark.mjs --check ccd/ccd; echo "d1 rc=$?"                                               # (d1) rc=0
grep -n 'RECLAIM-BEGIN\|RECLAIM-END\|EXPIRE-BEGIN\|EXPIRE-END' ccd/ccd                             # (d2) four lines, every number > 19109
grep -ohE 'ccd/ccd:[0-9]+(-[0-9]+)?' docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md README.md \
  | sed -E 's/.*://; s/.*-//' | sort -n | tail -1                                                   # (d3) 19109: the frozen boundary
grep -n 'echo reclaim-pause-v1; echo expire-v1; echo ws-expire' ccd/ccd                             # (d4) one line < 19109: the caps line Task 7 extends in place
grep -n '^_child_tmpdir()' ccd/ccd                                                                  # (d5) one line > 19109
```

If (d3) prints a number other than 19109, read every "19109" in this plan as that number, and report it.

- [ ] **Step 5: Overlaps, measured at dispatch (R72)**

```bash
~/.local/bin/ccrc-api claims list --project ccrc-pwa                                                # (e1) no live claim on a path this wave edits, or the coordinator's recorded agreement in the brief
gh pr view 319 --json state -q .state                                                               # (e2) MERGED or OPEN: record it
grep -n 'REQUIRED_VERB_FLAG' agent/src/whitelist.ts | head -3                                       # (e3) the object Task 7 appends to: record its last entry
grep -n "export const EXPIRE_CAP\|export const DOCS_CAP" server/src/ccdargv.ts                     # (e4) record which constant is last
ls server/test/fixtures | grep -oE '^g[0-9]+' | sort -V | tail -1                                   # (e5) the highest bypass fixture: Task 7 takes the next
```

Read (e5)'s directory from the bypass suite's own fixture root if `server/test/fixtures` is not it. Locate that suite by content: `grep -ln 'g15' server/test/*.ts`.

- [ ] **Step 6: Nothing of this wave exists yet**

```bash
grep -c 'ws-collect\|_ws_collect_\|tmpquarantine\|containment-refuted\|collect-v1\|_ws_reclaim_generation\|_WS_RCL_CRUMB' ccd/ccd   # (f1) 0
grep -c "'collect'\|containment-refuted\|not-witnessed\|witness-mismatch\|quarantine-kept" shared/api.ts                     # (f2) 0
grep -c 'ws-collect' agent/src/whitelist.ts server/src/ccdargv.ts server/src/remote/runner.ts ccd/ccd-entry.py              # (f3) 0 in each
```

- [ ] **Step 7: The three facts R67's proof rests on (Task 8 pins them)**

```bash
grep -n '_child_tmpdir ' ccd/ccd | grep -v '^[0-9]*:_child_tmpdir()' | grep -v '^[0-9]*: *#'        # (g1) exactly one call site
grep -n '\.child"' ccd/ccd | grep -E '>|printf|_reg_set|touch' | head                               # (g2) one writer, in ws-add
awk '/^_child_tmpdir\(\)/,/^}/' ccd/ccd | grep -n '_reg_get\|mkdir -p'                              # (g3) the marker read's line comes before the mkdir's
```

If (g1), (g2) or (g3) disagrees, STOP: R67's proof does not hold on this tree.

---

### Task 1: `_ws_reclaim_owned` answers three ways, and the shared tail names a proven refusal `containment-refuted`

**Model routing:** **`opus`, effort `high`**. This is SAFETY-critical: it edits the destructive tail that `ws-reclaim` and `ws-expire` share, at its only removal-time identity check. Wave 7's SAFETY panel asks R69's bounded question of this diff, for both verbs: no arm newly reaches the pin, the settle or a removal, and none continues past a stop it used to make.

**Why:** Today `_ws_reclaim_owned` (ccd/ccd:28671 at `b0647d850`; `grep -n '^_ws_reclaim_owned() {' ccd/ccd`) folds every refusal into rc 1 through one `_WS_OWNED_WHY`, the unmeasured arms included: `_ws_reclaim_absent` rc 2, `_ws_reclaim_record` rc 2, `_ws_reclaim_workdir_shared` rc 2, a failed `_ws_nested_checkouts`, and `_ws_reclaim_moved_check` rc 2, which `|| { _WS_OWNED_WHY="$_WS_MOVED_WHY"; return 1; }` folds into 1. That is an adapter narrowing a distinction it received. The tail therefore cannot tell a PROVEN refusal from a question that could not be asked, and it prints resumable `worktree-remove-failed` for both. A proven one (another row in the child, a moved foreign tree, the main checkout) then retries for ever with nothing to say it will not heal by itself.

This task does exactly what contract §14 rules in R69's ccd side, and nothing more:
- `_ws_reclaim_owned` answers 0 own, 1 PROVEN not own, 2 could not be asked. Every rc-2 sub-answer stays 2, `_ws_reclaim_moved_check`'s rc 2 included, and so does any answer the moved-tree check never gives.
- The tail prints and journals `containment-refuted` from its OWN literal `_ws_reclaim_fail` call site, only on rc 1. These are the five arm families rc 1 covers:
  - a SHARED, NESTED or THROUGH registry row at, inside or through the worktree or either leaf;
  - a gone row's moved tree inside the child (`_ws_reclaim_moved_check` rc 1);
  - a workdir that is the main checkout or the project directory;
  - a link or a non-directory at the workdir;
  - a tombstone workdir that is not one plain path.
- Everything else stays resumable `worktree-remove-failed`: every rc 2 (the unplaced, unresolvable, `/proc` and unleaf rows among them), the registry/tombstone disagreement arm, and every later git-removal failure. That leaves the no-worktree-record arm. git 2.43's list silently omits a record whose `gitdir` it cannot read (spec §5.5, rung 8), so "no record" is not proof there. This task therefore makes that arm answer **2**, and its word stays `worktree-remove-failed` (ruling T1 OPEN1, ACCEPTED: the no-worktree-record arm answers 2, could not be asked). Task 2's rung-8 fix is at the ladder's call site only and does not reach this function.
- The word is declared in this task's commit, beside its emission: in `LcRefusalToken`, in `LC_REFUSAL_WORD` (with a sentence that is true under any server) and in `lifecycle-refusal-word.test.ts`'s `ALL_TOKENS` (18 → 19). It joins neither `SENTENCES` (`wsaudit.ts`; `lifecycle-refusal-word.test.ts` holds the two maps disjoint, and `wsaudit.test.ts` harvests only `refused`/`verdict` literals, never a `failed` document), nor `CHILD_RECLAIM_TOKEN_KIND`, nor `ExpireToken`, nor the audit's terminal journal case list. `ccd-refusal-scan.test.ts:197` harvests `_ws_reclaim_fail "…" "…" <word>` literals, so a declared word with no literal call site reds, and so does an emitted literal that is undeclared. That is why the word is a literal at its own call site and is never chosen through a variable.

**Every caller of `_ws_reclaim_owned`, measured at `b0647d850`.** There is ONE call site: `_ws_reclaim_tail` at ccd/ccd:29705 (`grep -n 'if ! _ws_reclaim_owned "\$id" "\$workdir" "\$main"; then' ccd/ccd`).
- It runs after the tail's step (1) (unsupervise, the anchored kill, the unit and pane re-measure), after the bounded temp-root wait, the tombstone read and the row/record agreement check, and BEFORE step (2) (the settle).
- `_ws_reclaim_tail` has two callers: `_ws_reclaim_locked` (ccd/ccd:30342, `grep -n '_ws_reclaim_tail "\$id" "\$phase" "\$lctx" "\$RECLAIM_CHILDOF"' ccd/ccd`) and `_ws_expire_locked` (ccd/ccd:31056, `grep -n '_ws_reclaim_tail "\$id" "\$phase" "\$lctx" "\$EXPIRE_ARCHIVED_AT"' ccd/ccd`).
- Each enters the tail on its fresh arm (`children`, or `branch` on the vanished arm) and on every resumed arm (the breadcrumb's phase). So "the tail at each phase" and "the resume paths" are all this one site. On a resumed arm it is the ONLY identity check: `_ws_reclaim_resume_eval` and `_ws_expire_resume_eval` run no ladder.
- The settle (`_ws_reclaim_pin`), the nested step (`_ws_reclaim_nested_proven`, `_ws_reclaim_nested_record`), the ladder and the locked recomputation never call it.
- The ladder's own `_ws_reclaim_moved_check` call (ccd/ccd:27206, `grep -n '_ws_reclaim_moved_check "\$nested"; rc=\$?' ccd/ccd`) already reads all three answers, and it is unchanged.
- The comments at ccd/ccd:29773 and :29897 name the function and stay true.

| Call site | Today | After this task |
|---|---|---|
| `_ws_reclaim_tail`, every phase, fresh and resumed, both verbs | `if ! _ws_reclaim_owned …; then _ws_reclaim_fail … worktree-remove-failed …; return 1; fi` | `case` on the rc. 0 goes on. 1 is `_ws_reclaim_fail … containment-refuted …; return 1`. Anything else is `_ws_reclaim_fail … worktree-remove-failed …` (today's text, byte for byte) followed by `return 1`. Both stops are where today's stop is. |

**Today's parsers, and why shipping the word agent-first is safe.**
- `parseChildReclaimResult` (server/src/coord/childReclaim.ts:732; `grep -n 'export function parseChildReclaimResult' server/src/coord/childReclaim.ts`) reads any `failed` word outside `CHILD_RECLAIM_PRE_CRUMB_FAILED` (:310) as `resume: 'resumable'` (:775).
- `parseExpireResult` (server/src/archivedExpiry.ts:211) reads any `failed` word but `probe-unmeasured` as `resumable: true` (:231). So the expiry lane asks again on its backoff and never parks the row at +∞.
- The sweep's `childReclaimFailureLine` (server/src/childReclaimSweep.ts:936) reads the journal line as a failure line. `childReclaimTerminalRefusal` (:974) reads only a `refused` outcome, so the child is never excluded from the lane.
- So until wave 8 lands, both lanes retry the word, backing off, exactly as they retry `worktree-remove-failed` today. That is safe because the resumed tail deletes nothing before `_ws_reclaim_owned`.
- This task pins that reading with a test. Wave 8 changes it deliberately (the `stuck` class).

**This reaches `ws-expire` (R72).** The tail is shared, so `ws-expire` prints the word for the same arms, with no edit in the EXPIRE region. `_ws_expire_locked` is not touched. The coordinator tells workspace-lifecycle (quiet-river), and the worker names the change in the wave-done.

**Files:**
- Modify: `ccd/ccd`. Make three edits, all below the frozen citation boundary (ccd/ccd:19109). That means line count is free, no platform-block line changes, no `_reg_get` is added, and no `_plat_` helper is added. The line numbers are hints at `b0647d850`; find each edit by its quoted text:
  1. Replace `_ws_reclaim_owned` whole, from `_WS_OWNED_WHY=''` (ccd/ccd:28670) through its closing `}` (:28713).
  2. In `_ws_reclaim_tail`, append ` orc` to the line `  local clipskept='' clipswhy='' tmpkept='' tmpwhy='' lfrc cword tword gone dparts tmpq tarc` (ccd/ccd:29552). This edit is line-neutral.
  3. Replace the five lines `  if ! _ws_reclaim_owned "$id" "$workdir" "$main"; then` … `  fi` (ccd/ccd:29705-29709).
- Modify: `shared/api.ts`. Two edits:
  - The `LcRefusalToken` union's last member, `  | 'run-id-malformed';` (shared/api.ts:7881; `grep -n "  | 'run-id-malformed';" shared/api.ts`), loses its `;`, and one member line is added below it.
  - One entry is added to `LC_REFUSAL_WORD` directly after the `'run-id-malformed':` entry and before the map's closing `};` (shared/api.ts:7984-7986; `grep -n "^  'run-id-malformed':" shared/api.ts`).
  - #322 (stall-watch W2) also edits this file, so locate both by content.
- Modify: `server/test/lifecycle-refusal-word.test.ts`. Two edits:
  - `ALL_TOKENS`' line `  'token-malformed': true, 'run-id-malformed': true,` (:28) becomes `  'token-malformed': true, 'run-id-malformed': true, 'containment-refuted': true,`.
  - `expect(TOKENS.length).toBe(18);` (:36) becomes `toBe(19)`. If another wave has already raised it, raise it from what you measure by one.
- Modify: `server/test/ccd-child-reclaim-verb-tail.test.ts`. Change these expectations, and only these (Step 1 lists them).
- Modify: `server/test/ccd-child-reclaim-verb.test.ts`. Change three expectations and one title (Step 1).
- Modify: `server/test/ccd-child-reclaim-recovery.test.ts`. Change three rc expectations from `'1'` to `'2'` (Step 1).
- Modify, only if Step 5's citation case reds on it: `README.md`. Its `shared/api.ts` anchors are repaired by content (R56). README is in run 320's claim 1110 (R72): dispatch timing covers this.
- Create: `server/test/containmentRefutedFamilies.ts`. This is a test helper, not a suite. It holds the ten proven shapes, the seam and the two assertion helpers, shared by the two end-to-end suites.
- Test (new): `server/test/ccd-reclaim-owned-rc.test.ts`. One case per arm of `_ws_reclaim_owned`, asked of the function directly.
- Test (new): `server/test/ccd-reclaim-tail-refuted.test.ts`. End to end on `ws-reclaim`: each family on a resumed arm, one on the fresh arm, the retry, and one case per rc-2 shape.
- Test (new): `server/test/ccd-expire-tail-refuted.test.ts`. End to end on `ws-expire`: each family planted inside the tail's first act, one on a resumed arm, and two rc-2 shapes.
- Test (new): `server/test/containment-refuted-word.test.ts`. The word's sentence, its vocabulary home, and today's parsers reading it as retried.- NOT edited here: `server/test/git-env-strip.test.ts`. Its `SCOPE` does not yet name this task's `ccd-reclaim-*` suites, `ccd-expire-tail-refuted.test.ts` or `containmentRefutedFamilies.ts`; Task 4 widens it for the whole wave and lists these files in its `later` array (ruling G12), so this task leaves that file alone.

**Interfaces:**
- Consumes (at `b0647d850`):
  - `_ws_reclaim_plain_path <path>`. rc 0 means one plain absolute spelling (ccd/ccd:26629, `grep -n '^_ws_reclaim_plain_path()' ccd/ccd`).
  - `_ws_reclaim_absent <path>`. 0 proven absent, 1 stands, 2 not asked, with `_WS_ABSENT_WHY` (ccd/ccd:26646).
  - `_ws_reclaim_record <main> <path>`. 0 recorded (`RECLAIM_REC_MAIN`), 1 no record, 2 list unreadable (ccd/ccd:25979).
  - `_ws_reclaim_workdir_shared <id> <workdir>`. rc 0 with `_WS_SHARED_ROWS`/`_WS_NESTED_ROWS`/`_WS_THROUGH_ROWS`/`_WS_RECORDED_GDIRS`, or rc 2 with `_WS_SHARED_WHY` (ccd/ccd:26015). It never answers 1, and the caller maps any non-zero answer to 2.
  - `_ws_nested_checkouts <dir>` (ccd/ccd:11237).
  - `_ws_reclaim_moved_check <nested>`. 0, or 1 (proven), or 2 (not asked), with `_WS_MOVED_WHY` (ccd/ccd:26473). Unchanged.
  - `_ws_reclaim_fail <id> <lctx> <token> <detail> [k v]…` (ccd/ccd:28658). Unchanged: Task 2 adds no argument to it (ruling T2 DEP2; see Produces).
  - `_ws_tombstone_patch <id> <json>` (ccd/ccd:28523).
  - Server side: `parseChildReclaimResult` (server/src/coord/childReclaim.ts:732), `childReclaimTokenKind` (:102), `parseExpireResult` (server/src/archivedExpiry.ts:211), `childReclaimFailureLine` and `childReclaimTerminalRefusal` (server/src/childReclaimSweep.ts:936, :974), `SENTENCES` and `refusalSentence` (server/src/wsaudit.ts).
  - Test side: `makePrHarness` (`ccdPrHelpers.ts`); `WS_ADD` (`ccdWsHelpers.ts`); `makeChild`, `evalOf`, `childReclaimVerb`, `CHILD_ID`, `CHILD_BRANCH`, `CHILD_RUN` (`childReclaimFixture.ts`); `verbHelpers` (`childReclaimVerbHelpers.ts`: `interrupted`, `resumeToken`); `makeArchived`, `expireEvalOf`, `expireVerb`, `EXP_ID`, `EXP_BRANCH`, `EXP_STUBS` (`wsExpireFixture.ts`); `eventsOf` (`lifecycleHelpers.ts`).
- Produces:
  ```bash
  _ws_reclaim_owned <id> <workdir> <main>   # rc 0 own | 1 PROVEN not own (_WS_OWNED_WHY) | 2 could not be asked (_WS_OWNED_WHY)
  # _ws_reclaim_tail, at its one re-ask: on rc 1, exactly this literal (the cross-language scan's position):
  #   _ws_reclaim_fail "$id" "$lctx" containment-refuted "<_WS_OWNED_WHY> — so the tree at that path is not only <id>'s own; the session was stopped, nothing further was deleted, and a retry finds the same until that tree or row is moved or removed"
  # stdout {"failed":"containment-refuted","detail":"…"}, exit 1; journal: act reclaim|expire, outcome failed,
  # refusal containment-refuted, verb ws-reclaim|ws-expire; the tombstone and the `<act>:<phase>` breadcrumb stand.
  # On rc 2: today's `worktree-remove-failed` call, byte for byte.
  ```
  - `shared/api.ts`: `LcRefusalToken` gains `'containment-refuted'`. `LC_REFUSAL_WORD['containment-refuted']` is its sentence.
  - For Task 2 (crumb): Task 2 adds no argument (ruling T2 DEP2): `crumb` rides the global `_WS_RCL_CRUMB`, which the tail sets to `true`, so `containment-refuted` prints `"crumb":true` with no edit at this call site. Both `_ws_reclaim_fail` calls stay byte-identical, so the literal prefix `_ws_reclaim_fail "$id" "$lctx" containment-refuted` must stay matchable by `ccd-refusal-scan.test.ts`'s regex `/_ws_reclaim_fail\s+"[^"]*"\s+"[^"]*"\s+([a-z][a-z0-9-]*)/`.
  - For wave 8: `server/test/containment-refuted-word.test.ts`'s "today's parsers" describe pins `resume: 'resumable'` and `resumable: true`. Wave 8's `stuck` class changes those pins on purpose (the rulings' 'Wave 8 inherits' list carries this as T1 OPEN3).
  - Test helper `server/test/containmentRefutedFamilies.ts` exports `FAMILIES`, `seam`, `seamRan`, `assertRefuted`, `assertUnproven`, and the types `Subject`, `Target`, `Shape`, `Family`, `Run`.

- [ ] **Step 1: Write the failing tests**

Create `server/test/containmentRefutedFamilies.ts`:

```ts
// The PROVEN refusals of `_ws_reclaim_owned` (child reclamation wave 7, spec
// §5.6) — ten shapes in its five arm families — shared by the ws-reclaim and
// ws-expire suites, because the tail they exercise is one tail. Each shape is
// BASH, run in the sourced ccd shell: between a resume token and the verb (a
// resumed arm), or inside the tail's first act (`seam`, a fresh arm, after the
// ladder passed and the pin and the breadcrumb were written).
// FIXTURE HOME ONLY: every path below is under `h.home`.
import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
import type { PrHarness } from './ccdPrHelpers.js';
import { WS_ADD } from './ccdWsHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';

export interface Subject { readonly id: string; readonly wt: string; readonly main: string }
export interface Target extends Subject { readonly act: 'reclaim' | 'expire'; readonly branch: string }
export interface Run { readonly code: number; readonly stdout: string; readonly stderr: string }
export interface Shape {
  /** The bash that makes the shape; every statement `;`-terminated, nothing on stdout. */
  readonly plant: string;
  /** A substring of the tail's detail: this arm's `_WS_OWNED_WHY`. */
  readonly why: string;
  /** Another session's work, which the refusal must leave standing. */
  readonly keeps: readonly string[];
  /** Whether the subject's own tree still stands at its workdir once planted. */
  readonly treeStands: boolean;
}
export interface Family { readonly name: string; readonly make: (h: PrHarness, s: Subject) => Shape }

const reg = (h: PrHarness, file: string): string => path.join(h.home, '.cc-sessions', file);
/** Another session's STANDING registry row: its two files, as `ccd start` writes them. */
const rowSh = (h: PrHarness, id: string, workdir: string): string =>
  `printf '%s' 'u-${id}' > "${reg(h, `${id}.uuid`)}"; printf '%s' "${workdir}" > "${reg(h, `${id}.workdir`)}";`;
/** The subject's row AND the record its pin wrote, re-pointed together, so the agreement rung passes. */
const repointSh = (h: PrHarness, s: Subject, project: string | undefined, workdir: string): string =>
  (project === undefined ? '' : `printf '%s' '${project}' > "${reg(h, `${s.id}.project`)}"; `)
  + `printf '%s' "${workdir}" > "${reg(h, `${s.id}.workdir`)}"; `
  + `_ws_tombstone_patch ${s.id} '${JSON.stringify(project === undefined ? { workdir } : { project, workdir })}' >/dev/null;`;
/** `projects/demo2`: a LINKED worktree of the subject's repository, used as a project directory. */
const linkedProject = (h: PrHarness, s: Subject): string => {
  const demo2 = path.join(h.home, 'projects', 'demo2');
  h.git(s.main, 'worktree', 'add', '-q', '-b', 'proj2-main', demo2);
  return demo2;
};

export const FAMILIES: readonly Family[] = [
  { name: 'SHARED: another registry row names the workdir', make: (h, s) => ({
    plant: rowSh(h, 'demo-twin', s.wt), why: `${s.wt} is also named by registry row(s) demo-twin`, keeps: [], treeStands: true }) },
  { name: 'NESTED: a registry row rooted inside the worktree', make: (h, s) => {
    const root = path.join(s.wt, 'server');
    return { plant: `mkdir -p "${root}"; printf live > "${root}/live.txt"; ${rowSh(h, 'demo-nested', root)}`,
      why: 'registry row(s) demo-nested rooted inside', keeps: [path.join(root, 'live.txt')], treeStands: true };
  } },
  { name: 'NESTED: a registry row inside the temp root, a leaf the tail removes', make: (h, s) => {
    const root = path.join(h.home, '.cc-tmp', s.id, 'wt');
    return { plant: `mkdir -p "${root}"; printf live > "${root}/live.txt"; ${rowSh(h, 'demo-nested', root)}`,
      why: 'registry row(s) demo-nested rooted inside', keeps: [path.join(root, 'live.txt')], treeStands: true };
  } },
  { name: 'THROUGH: a registry row spelled through the workdir', make: (h, s) => ({
    plant: rowSh(h, 'demo-up', `${s.wt}/..`),
    why: `registry row(s) demo-up spell their workdir through ${s.wt}, not as one plain path`, keeps: [], treeStands: true }) },
  { name: 'MOVED: a gone row’s tree moved inside the child', make: (h, s) => {
    h.makeGhRepo('demo2', 'o/r2');
    h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add demo2`);
    const wt2 = path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
    fs.writeFileSync(path.join(wt2, 'precious.txt'), 'uncommitted work of the other session\n');
    const moved = path.join(s.wt, 'vendor', 'still-harbor');
    return { plant: `mkdir -p "${path.dirname(moved)}"; mv "${wt2}" "${moved}";`,
      why: 'registry row demo2-still-harbor, whose workdir is gone', keeps: [path.join(moved, 'precious.txt')], treeStands: true };
  } },
  { name: 'MAIN: the workdir is the project’s main checkout', make: (h, s) => {
    const demo2 = linkedProject(h, s);
    fs.writeFileSync(path.join(s.main, 'main-work.txt'), 'the project’s own uncommitted work\n');
    return { plant: repointSh(h, s, 'demo2', s.main), why: `${s.main} is ${demo2}'s main checkout`,
      keeps: [path.join(s.main, 'main-work.txt')], treeStands: true };
  } },
  { name: 'PROJECT: the workdir is the project directory itself', make: (h, s) => {
    const demo2 = linkedProject(h, s);
    fs.writeFileSync(path.join(demo2, 'proj-work.txt'), 'the project’s own uncommitted work\n');
    return { plant: repointSh(h, s, 'demo2', demo2), why: `${demo2} is the project directory ${demo2} itself`,
      keeps: [path.join(demo2, 'proj-work.txt')], treeStands: true };
  } },
  { name: 'LINK: a symbolic link to another worktree stands at the workdir', make: (h, s) => {
    const other = path.join(h.home, 'other');
    h.git(s.main, 'worktree', 'add', '-q', '--detach', other, 'main');
    fs.writeFileSync(path.join(other, 'dirty.txt'), 'another session’s uncommitted work\n');
    return { plant: `rm -rf "${s.wt}"; ln -s "${other}" "${s.wt}";`, why: `${s.wt} is a symbolic link`,
      keeps: [path.join(other, 'dirty.txt')], treeStands: false };
  } },
  { name: 'NOT A DIRECTORY: a file stands at the workdir', make: (_h, s) => ({
    plant: `rm -rf "${s.wt}"; printf 'not a tree' > "${s.wt}";`, why: `something that is not a directory stands at ${s.wt}`,
    keeps: [s.wt], treeStands: false }) },
  { name: 'NOT PLAIN: the recorded workdir is not one plain path', make: (h, s) => ({
    plant: repointSh(h, s, undefined, `${s.wt}/`), why: 'not one plain absolute path', keeps: [], treeStands: true }) },
];

/** The tail's first act, `_ws_unsupervise` (recorded, as `CHILD_STUBS` records it), redefined to plant a shape. */
export const seam = (plant: string): string =>
  `_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls"; : > "$HOME/seam-ran"; ${plant} };`;
export const seamRan = (h: PrHarness): boolean => fs.existsSync(path.join(h.home, 'seam-ran'));

const stopped = (h: PrHarness, r: Run, t: Target, word: string, why: string,
  keeps: readonly string[], treeStands: boolean, phase: string): Record<string, unknown> => {
  // What is on disk FIRST: a tail that went on past its stop shows here.
  for (const f of keeps) expect(fs.existsSync(f), `${f} stands: another session’s work — ${r.stdout}`).toBe(true);
  if (treeStands) {
    for (const f of ['f1.txt', 'f2.txt']) {
      expect(fs.existsSync(path.join(t.wt, f)), `the ${t.act}’s own ${f} stands — ${r.stdout}`).toBe(true);
    }
  }
  expect(h.git(t.main, 'branch', '--list', t.branch), 'its branch stands').toContain(t.branch);
  expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.reaped', `${t.id}.json`)), 'the tombstone stands').toBe(true);
  expect(h.reg(t.id, 'uuid'), 'the registry row stands').not.toBeNull();
  expect(h.reg(t.id, 'reaping'), 'the breadcrumb stays, for the retry').toBe(`${t.act}:${phase}`);
  expect(h.calls(), 'the session was stopped before the re-ask').toContain(`tmux kill-session -t =cc-${t.id}:`);
  expect(r.code, r.stdout + r.stderr).toBe(1);
  const doc = JSON.parse(r.stdout) as Record<string, unknown>;
  expect(doc['failed'], String(doc['detail'])).toBe(word);
  expect(doc['refused'], 'a failure after the act started, never a refusal').toBeUndefined();
  expect(String(doc['detail'])).toContain(why);
  expect(String(doc['detail'])).toContain('nothing further was deleted');
  const row = eventsOf(h.home, t.act).filter((e) => e['outcome'] === 'failed').pop();
  expect(row, 'the failure is journaled').toBeDefined();
  expect([row!['refusal'], row!['verb'], row!['detail']], 'the journal row and the document say one word and one detail')
    .toEqual([word, `ws-${t.act}`, doc['detail']]);
  return doc;
};

/** A PROVEN refusal: `containment-refuted`, the session stopped, nothing further deleted. */
export function assertRefuted(h: PrHarness, r: Run, t: Target, shape: Shape, phase: string): void {
  stopped(h, r, t, 'containment-refuted', shape.why, shape.keeps, shape.treeStands, phase);
}
/** A question that could not be asked: still `worktree-remove-failed`, today's detail. */
export function assertUnproven(h: PrHarness, r: Run, t: Target, why: string, phase: string): void {
  const doc = stopped(h, r, t, 'worktree-remove-failed', why, [], true, phase);
  expect(String(doc['detail'])).toContain('ccd cannot prove the tree at that path is');
}
```

Create `server/test/ccd-reclaim-owned-rc.test.ts`:

```ts
// `_ws_reclaim_owned` answers THREE ways (child reclamation wave 7, spec §5.6):
// 0, the tree at the workdir is provably the child's own; 1, it is PROVEN not
// to be; 2, that could not be asked. The shared tail of ws-reclaim and ws-expire
// names the two refusals apart (`containment-refuted`, `worktree-remove-failed`),
// so each arm is pinned to its own answer here, and no question that was not
// asked may answer 1. The tail's word is pinned end to end in
// `ccd-reclaim-tail-refuted.test.ts` and `ccd-expire-tail-refuted.test.ts`.
// FIXTURE HOME ONLY (`makePrHarness`): nothing here runs a verb; every
// repository, row and leaf is under the HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { WS_ADD } from './ccdWsHelpers.js';
import { CHILD_ID, makeChild, type Child } from './childReclaimFixture.js';

let h: PrHarness;
let restore: [string, number][] = [];
beforeEach(() => { h = makePrHarness('ccrc-owned-rc-'); restore = []; });
afterEach(() => {
  for (const [p, m] of restore.reverse()) { try { fs.chmodSync(p, m); } catch { /* gone */ } }
  h.cleanup();
});
const ROOT_USER = process.getuid?.() === 0;
const shut = (p: string, mode = 0o000): void => { restore.push([p, fs.statSync(p).mode & 0o7777]); fs.chmodSync(p, mode); };

interface Answer { rc: string; why: string }
const owned = (wd: string, main: string, pre = ''): Answer => {
  const [rc = '', why = ''] = h.sh(`${pre} _ws_reclaim_owned ${CHILD_ID} "${wd}" "${main}"; printf '%s\\x1f%s' "$?" "$_WS_OWNED_WHY"`)
    .split('\x1f');
  return { rc, why };
};
const row = (id: string, workdir: string): void => {
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.uuid`), `u-${id}`);
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.workdir`), workdir);
};
/** A plain workspace of ANOTHER repository, `demo2-still-harbor`, with its own registry row; its tree. */
const foreign = (): string => {
  h.makeGhRepo('demo2', 'o/r2');
  h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add demo2`);
  return path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
};
/** A gone row placed on git's record, so the moved-tree question is asked at all. */
const goneForeign = (c: Child): void => {
  const wt2 = foreign();
  expect(owned(c.wt, c.main).rc, 'the CONTROL: while the other tree stands nothing is scanned').toBe('0');
  fs.rmSync(wt2, { recursive: true, force: true });
};
const linkedProject = (c: Child): string => {
  const demo2 = path.join(h.home, 'projects', 'demo2');
  h.git(c.main, 'worktree', 'add', '-q', '-b', 'proj2-main', demo2);
  return demo2;
};
const proven = (a: Answer, why: string): void => { expect(a.rc, a.why).toBe('1'); expect(a.why).toContain(why); };
const unasked = (a: Answer, why: string): void => { expect(a.rc, a.why).toBe('2'); expect(a.why).toContain(why); };

describe('_ws_reclaim_owned — 0: the child’s own', () => {
  it('CONTROL: the child’s own tree answers 0', () => {
    const c = makeChild(h);
    const a = owned(c.wt, c.main);
    expect(a.rc, a.why).toBe('0');
    expect(a.why).toBe('');
  }, 120_000);
});

describe('_ws_reclaim_owned — 1: PROVEN not the child’s own', () => {
  it('1: a workdir that is not one plain path', () => {
    const c = makeChild(h);
    proven(owned(`${c.wt}/`, c.main), 'not one plain absolute path');
  }, 120_000);

  it('1: a symbolic link at the workdir', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    fs.symlinkSync(path.join(h.home, 'nowhere'), c.wt);
    proven(owned(c.wt, c.main), `${c.wt} is a symbolic link`);
  }, 120_000);

  it('1: something that is not a directory at the workdir', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    fs.writeFileSync(c.wt, 'not a tree');
    proven(owned(c.wt, c.main), `something that is not a directory stands at ${c.wt}`);
  }, 120_000);

  it('1: the workdir is the project’s main checkout', () => {
    const c = makeChild(h);
    const demo2 = linkedProject(c);
    proven(owned(c.main, demo2), `${c.main} is ${demo2}'s main checkout`);
  }, 120_000);

  it('1: the workdir is the project directory itself', () => {
    const c = makeChild(h);
    const demo2 = linkedProject(c);
    proven(owned(demo2, demo2), `${demo2} is the project directory ${demo2} itself`);
  }, 120_000);

  it('1: SHARED — another registry row names the workdir', () => {
    const c = makeChild(h);
    row('demo-twin', c.wt);
    proven(owned(c.wt, c.main), `${c.wt} is also named by registry row(s) demo-twin`);
  }, 120_000);

  it('1: NESTED — a registry row rooted inside the worktree', () => {
    const c = makeChild(h);
    fs.mkdirSync(path.join(c.wt, 'server'));
    row('demo-nested', path.join(c.wt, 'server'));
    proven(owned(c.wt, c.main), 'registry row(s) demo-nested rooted inside');
  }, 120_000);

  it('1: NESTED — a registry row inside the clips directory, a leaf the tail removes', () => {
    const c = makeChild(h);
    const leafwt = path.join(h.home, '.cc-clips', CHILD_ID, 'wt');
    fs.mkdirSync(leafwt, { recursive: true });
    row('demo-nested', leafwt);
    proven(owned(c.wt, c.main), 'registry row(s) demo-nested rooted inside');
  }, 120_000);

  it('1: THROUGH — a registry row spelled through the workdir', () => {
    const c = makeChild(h);
    row('demo-up', `${c.wt}/..`);
    proven(owned(c.wt, c.main), `registry row(s) demo-up spell their workdir through ${c.wt}, not as one plain path`);
  }, 120_000);

  it('1: a gone row’s tree moved inside the child', () => {
    const c = makeChild(h);
    const wt2 = foreign();
    expect(owned(c.wt, c.main).rc, 'the CONTROL: the other tree stands outside the child').toBe('0');
    fs.mkdirSync(path.join(c.wt, 'vendor'));
    fs.renameSync(wt2, path.join(c.wt, 'vendor', 'still-harbor'));
    proven(owned(c.wt, c.main), 'registry row demo2-still-harbor, whose workdir is gone');
  }, 120_000);
});

describe('_ws_reclaim_owned — 2: could not be asked, never folded into 1', () => {
  it('2: the workdir’s absence cannot be proven', (ctx) => {
    if (ROOT_USER) { ctx.skip(); return; }
    const c = makeChild(h);
    const demo = path.join(h.home, 'worktrees', 'demo');
    shut(demo);
    unasked(owned(c.wt, c.main), 'was never asked');
  }, 120_000);

  it('2: git’s worktree list cannot be read', () => {
    const c = makeChild(h);
    unasked(owned(c.wt, c.main, 'git() { case "$*" in *"worktree list"*) return 128 ;; esac; command git "$@"; };'),
      `could not read ${c.main}'s worktree list`);
  }, 120_000);

  it('2, never 1: a tree that stands with no worktree record (git omits a record it cannot read)', () => {
    const c = makeChild(h);
    fs.rmSync(path.join(c.main, '.git', 'worktrees', 'quiet-basin'), { recursive: true, force: true });
    unasked(owned(c.wt, c.main), `${c.main} has no worktree record for the tree at ${c.wt}`);
  }, 120_000);

  it('2: another row that cannot be placed', () => {
    const c = makeChild(h);
    row('demo-nested', 'quiet-basin/server');
    const a = owned(c.wt, c.main);
    unasked(a, 'could not ask whether another registry row names');
    expect(a.why).toContain('registry row(s) demo-nested name no plain absolute workdir');
  }, 120_000);

  it('2: a registry that cannot be listed', (ctx) => {
    if (ROOT_USER) { ctx.skip(); return; }
    const c = makeChild(h);
    shut(path.join(h.home, '.cc-sessions'), 0o300);
    unasked(owned(c.wt, c.main), 'could not list');
  }, 120_000);

  it('2: a child that cannot be scanned for a gone row’s moved tree', (ctx) => {
    if (ROOT_USER) { ctx.skip(); return; }
    const c = makeChild(h);
    goneForeign(c);
    const s = path.join(c.wt, 'shut');
    fs.mkdirSync(s);
    shut(s);
    unasked(owned(c.wt, c.main), `could not scan ${c.wt} for a gone row's moved tree`);
  }, 120_000);

  it('2, never 1: a nested checkout whose git directory cannot be read', () => {
    const c = makeChild(h);
    goneForeign(c);
    fs.mkdirSync(path.join(c.wt, 'bogus'));
    fs.writeFileSync(path.join(c.wt, 'bogus', '.git'), 'gitdir: /nowhere\n');
    unasked(owned(c.wt, c.main), `could not read the git directory of the checkout at ${path.join(c.wt, 'bogus')}`);
  }, 120_000);

  it('2, never 1: an answer the moved-tree check never gives', () => {
    const c = makeChild(h);
    goneForeign(c);
    unasked(owned(c.wt, c.main, '_ws_reclaim_moved_check() { return 7; };'), 'answered 7');
  }, 120_000);
});
```

Create `server/test/ccd-reclaim-tail-refuted.test.ts`:

```ts
// The shared tail's word for a PROVEN refusal (child reclamation wave 7, spec
// §5.6), end to end on ws-reclaim. `_ws_reclaim_owned` is the tail's
// removal-time re-ask, and on a RESUMED arm it is the only identity check there
// is. When it PROVES the tree at the workdir is not only the child's own, the
// tail prints and journals `containment-refuted`. When the question could not be
// asked, the word stays `worktree-remove-failed`. Either way the tail stops where
// it always stopped: after the unit and the pane, before the settle, with the
// tombstone and the breadcrumb standing and nothing further deleted. A retry
// meets the same thing, and once the other row is gone it completes. What stands
// on disk is asserted first, then the word.
// FIXTURE HOME ONLY (`makePrHarness`): the unit and the pane are stubbed
// (`CHILD_STUBS`); every repository, row and leaf is under the HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { WS_ADD } from './ccdWsHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import { CHILD_BRANCH, CHILD_ID, childReclaimVerb, evalOf, makeChild, type Child } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import {
  FAMILIES, assertRefuted, assertUnproven, seam, seamRan, type Run, type Target,
} from './containmentRefutedFamilies.js';

let h: PrHarness;
let restore: [string, number][] = [];
beforeEach(() => { h = makePrHarness('ccrc-reclaim-refuted-'); restore = []; });
afterEach(() => {
  for (const [p, m] of restore.reverse()) { try { fs.chmodSync(p, m); } catch { /* gone */ } }
  h.cleanup();
});
const ROOT_USER = process.getuid?.() === 0;
const WAIT = 'CCD_RECLAIM_TMPROOT_WAIT_S=2;';
const { interrupted, resumeToken } = verbHelpers(() => h);
const T = (c: Child): Target => ({ act: 'reclaim', id: CHILD_ID, wt: c.wt, main: c.main, branch: CHILD_BRANCH });
/** A reclaim interrupted after its pin, its breadcrumb at `worktree`; the resume token, minted before any shape. */
const resumed = (c: Child): string => { interrupted(c, 'worktree'); return resumeToken('worktree'); };
const foreignTree = (): string => {
  h.makeGhRepo('demo2', 'o/r2');
  h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add demo2`);
  return path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
};

describe('a PROVEN refusal is containment-refuted — ws-reclaim, resumed at `worktree` (spec §5.6)', () => {
  for (const fam of FAMILIES) {
    it(fam.name, () => {
      const c = makeChild(h);
      const shape = fam.make(h, T(c));
      const tok = resumed(c);
      h.sh(shape.plant);
      assertRefuted(h, childReclaimVerb(h, tok, { pre: WAIT }), T(c), shape, 'worktree');
    }, 120_000);
  }
});

describe('the fresh arm, and the retry', () => {
  it('SHARED, planted inside the tail’s first act after the ladder passed: containment-refuted, the fresh breadcrumb kept', () => {
    const c = makeChild(h);
    const shape = FAMILIES[0]!.make(h, T(c));
    const tok = evalOf(h).token;
    expect(tok, 'the CONTROL: without the row the ladder passes').toMatch(/^[0-9a-f]{64}$/);
    const r = childReclaimVerb(h, tok, { pre: WAIT + seam(shape.plant) });
    expect(seamRan(h), 'the CONTROL: the shape was planted inside the tail').toBe(true);
    assertRefuted(h, r, T(c), shape, 'children');
  }, 120_000);

  it('a retry meets the same refutation; once the other row is gone the next attempt resumes from the breadcrumb and completes', () => {
    const c = makeChild(h);
    const shape = FAMILIES[0]!.make(h, T(c));
    interrupted(c, 'worktree');
    h.sh(shape.plant);
    assertRefuted(h, childReclaimVerb(h, resumeToken('worktree'), { pre: WAIT }), T(c), shape, 'worktree');
    assertRefuted(h, childReclaimVerb(h, resumeToken('worktree'), { pre: WAIT }), T(c), shape, 'worktree');
    expect(eventsOf(h.home, 'reclaim').filter((e) => e['refusal'] === 'containment-refuted'),
      'one journal row per attempt').toHaveLength(2);
    for (const f of ['demo-twin.uuid', 'demo-twin.workdir']) fs.rmSync(path.join(h.home, '.cc-sessions', f));
    const r = childReclaimVerb(h, resumeToken('worktree'), { pre: WAIT });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as Record<string, unknown>)['reclaimed']).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the tree went, once it was the child’s own alone').toBe(false);
  }, 180_000);
});

describe('what could not be asked stays worktree-remove-failed — ws-reclaim, resumed at `worktree`', () => {
  it('the workdir’s absence cannot be proven (its parent cannot be searched)', (ctx) => {
    if (ROOT_USER) { ctx.skip(); return; }
    const c = makeChild(h);
    const tok = resumed(c);
    const demo = path.join(h.home, 'worktrees', 'demo');
    let r: Run;
    fs.chmodSync(demo, 0o000);
    try { r = childReclaimVerb(h, tok, { pre: WAIT }); } finally { fs.chmodSync(demo, 0o755); }
    assertUnproven(h, r, T(c), `${demo} cannot be searched`, 'worktree');
  }, 120_000);

  it('git’s worktree list cannot be read', () => {
    const c = makeChild(h);
    const tok = resumed(c);
    const r = childReclaimVerb(h, tok,
      { pre: `${WAIT} git() { case "$*" in *"worktree list"*) return 128 ;; esac; command git "$@"; };` });
    assertUnproven(h, r, T(c), `could not read ${c.main}'s worktree list`, 'worktree');
  }, 120_000);

  it('a tree that stands with no worktree record', () => {
    const c = makeChild(h);
    const tok = resumed(c);
    fs.rmSync(path.join(c.main, '.git', 'worktrees', 'quiet-basin'), { recursive: true, force: true });
    assertUnproven(h, childReclaimVerb(h, tok, { pre: WAIT }), T(c), `${c.main} has no worktree record for the tree at ${c.wt}`, 'worktree');
  }, 120_000);

  it('another row that cannot be placed', () => {
    const c = makeChild(h);
    const tok = resumed(c);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-nested.uuid'), 'u-nested');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-nested.workdir'), 'quiet-basin/server');
    assertUnproven(h, childReclaimVerb(h, tok, { pre: WAIT }), T(c), 'registry row(s) demo-nested name no plain absolute workdir', 'worktree');
  }, 120_000);

  it('a child that cannot be scanned for a gone row’s moved tree', (ctx) => {
    if (ROOT_USER) { ctx.skip(); return; }
    const c = makeChild(h);
    const wt2 = foreignTree();
    const tok = resumed(c);
    fs.rmSync(wt2, { recursive: true, force: true });
    const s = path.join(c.wt, 'shut');
    fs.mkdirSync(s);
    fs.chmodSync(s, 0o000);
    restore.push([s, 0o755]);
    assertUnproven(h, childReclaimVerb(h, tok, { pre: WAIT }), T(c), `could not scan ${c.wt} for a gone row's moved tree`, 'worktree');
  }, 120_000);

  it('a nested checkout whose git directory cannot be read — never folded into a proof', () => {
    const c = makeChild(h);
    const wt2 = foreignTree();
    const tok = resumed(c);
    fs.rmSync(wt2, { recursive: true, force: true });
    fs.mkdirSync(path.join(c.wt, 'bogus'));
    fs.writeFileSync(path.join(c.wt, 'bogus', '.git'), 'gitdir: /nowhere\n');
    assertUnproven(h, childReclaimVerb(h, tok, { pre: WAIT }), T(c), 'could not read the git directory of the checkout at', 'worktree');
  }, 120_000);
});
```

Create `server/test/ccd-expire-tail-refuted.test.ts`:

```ts
// ws-expire takes ws-reclaim's tail (spec §5.6), so the tail's word for a
// PROVEN refusal is the expiry's too (child reclamation wave 7). Each shape is
// planted INSIDE the tail's first act (`seam`), after the in-lock ladder passed
// and the pin and the `expire:children` breadcrumb were written. That is the
// window the tail's re-ask exists for. One shape is planted while a RESUMED expiry
// was down. What could not be asked stays `worktree-remove-failed`.
// FIXTURE HOME ONLY (`makePrHarness`): the unit and the pane are stubbed
// (`EXP_STUBS`); every repository, row and leaf is under the HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { WS_ADD } from './ccdWsHelpers.js';
import {
  EXP_BRANCH, EXP_ID, EXP_STUBS, expireEvalOf, expireVerb, makeArchived, type Archived,
} from './wsExpireFixture.js';
import { FAMILIES, assertRefuted, assertUnproven, seam, seamRan, type Target } from './containmentRefutedFamilies.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-expire-refuted-'); });
afterEach(() => { h.cleanup(); });
const WAIT = 'CCD_RECLAIM_TMPROOT_WAIT_S=2;';
const T = (a: Archived): Target => ({ act: 'expire', id: EXP_ID, wt: a.wt, main: a.main, branch: EXP_BRANCH });
const expirable = (): string => {
  const e = expireEvalOf(h);
  expect(e.verdict, `the CONTROL: ${e.detail}`).toBe('expirable');
  return e.token;
};

describe('a PROVEN refusal is containment-refuted — ws-expire, planted inside the tail’s first act (spec §5.6)', () => {
  for (const fam of FAMILIES) {
    it(fam.name, () => {
      const a = makeArchived(h);
      const shape = fam.make(h, T(a));
      const r = expireVerb(h, expirable(), { pre: WAIT + seam(shape.plant) });
      expect(seamRan(h), 'the CONTROL: the shape was planted inside the tail').toBe(true);
      assertRefuted(h, r, T(a), shape, 'children');
    }, 120_000);
  }

  it('a RESUMED expiry at `worktree` too: SHARED, planted while the act was down', () => {
    const a = makeArchived(h);
    const shape = FAMILIES[0]!.make(h, T(a));
    h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_eval ${EXP_ID} >/dev/null`
      + ` && _ws_reclaim_pin ${EXP_ID} "${a.wt}" "${a.main}" "$REAP_BRANCH" "$EXPIRE_ARCHIVED_AT"`
      + ` && _ws_tombstone ${EXP_ID} '[]' "$(_ws_reclaim_tomb_fields "$EXPIRE_ARCHIVED_AT" present)" >/dev/null`
      + ` && _reg_set ${EXP_ID} reaping expire:worktree`);
    expect(h.reg(EXP_ID, 'reaping'), 'the CONTROL: interrupted at `worktree`').toBe('expire:worktree');
    const tok = h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_resume_eval ${EXP_ID} worktree >/dev/null; printf '%s' "$REAP_TOKEN"`);
    h.sh(shape.plant);
    assertRefuted(h, expireVerb(h, tok, { pre: WAIT }), T(a), shape, 'worktree');
  }, 120_000);
});

describe('what could not be asked stays worktree-remove-failed — ws-expire', () => {
  it('a tree that stands with no worktree record (its admin directory removed inside the tail’s first act)', () => {
    const a = makeArchived(h);
    const r = expireVerb(h, expirable(),
      { pre: WAIT + seam(`rm -rf "${path.join(a.main, '.git', 'worktrees', 'quiet-dune')}";`) });
    expect(seamRan(h)).toBe(true);
    assertUnproven(h, r, T(a), `${a.main} has no worktree record for the tree at ${a.wt}`, 'children');
  }, 120_000);

  it('a nested checkout whose git directory cannot be read — never folded into a proof', () => {
    const a = makeArchived(h);
    h.makeGhRepo('demo2', 'o/r2');
    h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add demo2`);
    const wt2 = path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
    const bogus = path.join(a.wt, 'bogus');
    const r = expireVerb(h, expirable(), { pre: WAIT + seam(
      `rm -rf "${wt2}"; mkdir -p "${bogus}"; echo 'gitdir: /nowhere' > "${bogus}/.git";`) });
    expect(seamRan(h)).toBe(true);
    assertUnproven(h, r, T(a), 'could not read the git directory of the checkout at', 'children');
  }, 120_000);
});
```

Create `server/test/containment-refuted-word.test.ts`:

```ts
// `containment-refuted` (child reclamation wave 7, spec §5.6) is the shared
// tail's word for a PROVEN refusal at its removal-time re-ask. It is declared
// with its ccd emission (`_ws_reclaim_tail`'s literal `_ws_reclaim_fail …
// containment-refuted`). Its sentence says only what is true under any server.
// Until a server classes it, both parsers read it as the resumable failure it
// is, so it is retried. Wave 8's `stuck` class changes the parser pins below on
// purpose.
import { describe, it, expect } from 'vitest';
import { LC_REFUSAL_WORD, isLcRefusalToken, lcRefusalWord } from '../../shared/api.js';
import { SENTENCES, refusalSentence } from '../src/wsaudit.js';
import { childReclaimTokenKind, parseChildReclaimResult } from '../src/coord/childReclaim.js';
import { parseExpireResult } from '../src/archivedExpiry.js';
import { childReclaimFailureLine, childReclaimTerminalRefusal } from '../src/childReclaimSweep.js';

const W = 'containment-refuted' as const;
const DOC = JSON.stringify({ failed: W, detail: 'd' });

describe('the word', () => {
  it('is a journal-only token with a word of its own, never a SENTENCES key', () => {
    expect(isLcRefusalToken(W)).toBe(true);
    expect(W in SENTENCES, 'one word for one token, once').toBe(false);
    expect(lcRefusalWord(W)).toBe(LC_REFUSAL_WORD[W]);
    expect(lcRefusalWord(W)).not.toBe(refusalSentence(W));
  });

  it('says what is true under any server: stopped, nothing further deleted, and a retry meets the same', () => {
    expect(LC_REFUSAL_WORD[W]).toMatch(/The session was stopped/);
    expect(LC_REFUSAL_WORD[W]).toMatch(/nothing further was deleted/);
    expect(LC_REFUSAL_WORD[W]).toMatch(/A retry finds the same thing until that other tree or row is moved or removed/);
  });

  it('promises nothing a server decides: not whether or when ccrc retries, nor that anything is intact', () => {
    expect(LC_REFUSAL_WORD[W]).not.toMatch(/intact|will not|won’t|never retr|from the start|resumes|tries again/i);
  });
});

describe('today’s parsers read it as a resumable failure — retried', () => {
  it('parseChildReclaimResult: failed, resumable, with its token', () => {
    expect(parseChildReclaimResult('demo-quiet-basin', DOC, '')).toEqual({
      kind: 'failed', resume: 'resumable', detail: `${W}: d`, token: W });
  });

  it('parseExpireResult: failed, resumable — the expiry lane asks again on its backoff, never at +∞', () => {
    expect(parseExpireResult('demo-quiet-dune', DOC, '')).toEqual({ kind: 'failed', resumable: true, detail: `${W}: d` });
  });

  it('the sweep reads its journal line as a FAILURE line, never a terminal refusal', () => {
    expect(childReclaimFailureLine({ outcome: 'failed', refusal: W })).toBe(true);
    expect(childReclaimTokenKind(W)).toBeNull();
    expect(childReclaimTerminalRefusal(
      { sessionId: 'demo-quiet-basin', outcome: 'failed', refusal: W, at: 1, failingSince: 1 }, childReclaimTokenKind,
    )).toBe(false);
  });
});
```

Edit `server/test/lifecycle-refusal-word.test.ts` as **Files** says: add `'containment-refuted': true` to `ALL_TOKENS`, and raise the count from 18 to 19.

Then change the existing expectations this ruling changes. Find each by its test title (`grep -nF`); the line numbers are hints at `b0647d850`. Each assertion below names a PROVEN arm, so it now reads `containment-refuted`:
- `server/test/ccd-child-reclaim-verb-tail.test.ts`:
  - In `another registry row naming the same workdir stops a RESUMED tail, asked again on that arm, and an unlistable registry does too`, change the FIRST `expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');` (:335, the `demo-twin` half) to `.toBe('containment-refuted')`.
  - In `` a registry row rooted INSIDE the child (`<child>/${shape}`) stops a RESUMED tail ``, change `expect(o.failed).toBe('worktree-remove-failed');` (:373) to `'containment-refuted'`.
  - In `a registry row spelled THROUGH the child (\`<child>/..\`) stops a RESUMED tail…` (:393) and `the same row stops a RESUMED tail whose tree is already GONE…` (:414), make the same change.
  - In `a workdir that is the project’s MAIN checkout, or the project directory itself, is never removed — both rungs`, change both `expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');` (:450, :458) to `'containment-refuted'`.
  - In `` ${label}: the same row stops a RESUMED tail with `worktree-remove-failed` … `` (:545), the line becomes `expect(o.failed).toBe(unplaceable(value) ? 'worktree-remove-failed' : 'containment-refuted');`. On Linux the row is unplaceable (rc 2). Where a platform places it, it is NESTED (rc 1).
  - In `the same child stops a RESUMED tail with \`worktree-remove-failed\` …` (:601), the line becomes `expect(o.failed).toBe(kept ? 'worktree-remove-failed' : 'containment-refuted');`.
  - LEFT AS THEY ARE, because each is a nested-step, removal-step, agreement, unmeasured or no-record arm: :106, :127, :310, :431, :637, :654, :678, :699, :739, :766, :819, :844, :862, :932, :1002, :1033, :1144.
- `server/test/ccd-child-reclaim-verb.test.ts`:
  - In `(c1) a LIVE link planted at resume phase \`worktree\`…` (:394), `(c2) a DANGLING link…` (:415) and `the workdir is held to one plain absolute spelling…` (:442), change `.toBe('worktree-remove-failed')` to `.toBe('containment-refuted')`.
  - (c2)'s title `…reaches the removal step and fails worktree-remove-failed — nothing removed` (:402) becomes `…reaches the removal step and fails containment-refuted — nothing removed`.
  - LEFT AS THEY ARE: :952 and :982 (an unresolvable projection, rc 2).
- `server/test/ccd-child-reclaim-recovery.test.ts`, in `_ws_reclaim_owned: a checkout inside the child whose git directory cannot be read, or resolved completely, is unmeasured` (:423, :429) and `_ws_reclaim_owned: a child it cannot scan for a gone row’s moved tree is unmeasured` (:445): `toBe('1')` becomes `toBe('2')`. Their titles already say "unmeasured". :388 and :403 (a moved tree, PROVEN) stay `'1'`.
- `server/test/ccd-child-reclaim-hardening.test.ts` is NOT edited: its four `worktree-remove-failed` cases (:1014, :1033, :1253, :1277) are unresolvable rows (rc 2).

- [ ] **Step 2: Run the tests to verify they fail**

Run each in the FOREGROUND, timeout ≥ 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-reclaim-owned-rc.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-reclaim-tail-refuted.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-expire-tail-refuted.test.ts
cd server && ./node_modules/.bin/vitest run test/containment-refuted-word.test.ts test/lifecycle-refusal-word.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-tail.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-recovery.test.ts
```

Expected:
- **`ccd-reclaim-owned-rc`:** the CONTROL and every `1:` case PASS. Today's function already answers 1 for these, and they pin the split from here on. Every `2` case FAILS with `expected '1' to be '2'`, because today's fold answers 1. On root, the three mode-based cases are skipped.
- **`ccd-reclaim-tail-refuted`:** every family case, the fresh-arm case and the retry case FAIL at the word, with `expected 'worktree-remove-failed' to be 'containment-refuted'`. The disk assertions before it pass, because today's tail stops there too. The six `worktree-remove-failed` cases PASS: they pin what this task must not change.
- **`ccd-expire-tail-refuted`:** every family case and the resumed case FAIL in the same way. The two `worktree-remove-failed` cases PASS.
- **`containment-refuted-word`:**
  - `is a journal-only token…` FAILS with `expected false to be true`.
  - The two sentence cases FAIL with `.toMatch() expects to receive a string, but got undefined` (`.not.toMatch` likewise).
  - The three parser cases PASS: today's reading, pinned.
- **`lifecycle-refusal-word`:** `isLcRefusalToken(containment-refuted)` gives `expected false to be true`. `covers the whole union` gives `expected 18 to be 19`.
- **The three edited suites:** each edited `containment-refuted` assertion gives `expected 'worktree-remove-failed' to be 'containment-refuted'`. Each recovery `'2'` gives `expected '1' to be '2'`.

- [ ] **Step 3: Make `_ws_reclaim_owned` three-valued**

In `ccd/ccd`, replace from `_WS_OWNED_WHY=''` through the closing `}` of `_ws_reclaim_owned` with:

```bash
_WS_OWNED_WHY=''
_ws_reclaim_owned() {   # id workdir main -> 0 when the tree at workdir is still provably the child's own;
  #                          1 (_WS_OWNED_WHY) when it is PROVEN not to be; 2 (_WS_OWNED_WHY) when
  #                          that could not be asked
  # THE LADDER'S IDENTITY RUNGS, RE-ASKED AT REMOVAL TIME (spec §5.5, rung 9
  # asked of the path), on the fresh arm AND every resumed one: the resumed arm
  # has no ladder in front of it, and on every arm the tree stands until the
  # tail removes it. One plain absolute spelling (a trailing `/` makes `-L`
  # follow the link it asks about); a LEAF that is not a link (a symlinked
  # ancestor stays legal); git's record of it, read from $main — a list that
  # could not be read asked nothing, and a tree that stands with no record is
  # not PROVEN one of $main's worktrees; not the MAIN checkout, asked twice (git's
  # first stanza, and the resolved path against $main's); and no OTHER registry
  # row naming it or rooted inside it, literally or resolved, nor at, inside or
  # through its clips directory or temp root (spec §5.5, §5.6) — an unlistable
  # registry, or a leaf that cannot be measured, asked nothing; and, where a
  # gone row was placed on git's record (spec §5.5), no checkout inside the
  # tree that is that row's moved tree.
  #
  # THREE ANSWERS, NOT TWO (spec §5.6). The tail stops on 1 and on 2 alike, in
  # the same place — after the unit and the pane, before the settle and before
  # anything further is deleted — but it names them apart. 1 is a PROOF that
  # the tree is not only the child's own: a workdir that is not one plain path
  # (the record is immutable), a link or a non-directory at it, the main
  # checkout or the project directory, another registry row SHARED with it,
  # NESTED in it or in a leaf, or spelled THROUGH it, or a gone row's tree moved
  # inside it. A retry meets the same proof until that tree or row is moved or
  # removed. 2 is a question that could not be asked, which a retry may answer.
  # So nothing that was not asked is ever folded into 1: an unprovable absence,
  # an unreadable worktree list, a registry that could not be asked, a scan that
  # failed, and `_ws_reclaim_moved_check`'s own 2 — or any answer it never
  # gives — are all 2. So is a tree that stands with no worktree record: git's
  # list silently omits a record whose `gitdir` it cannot read (spec §5.5, rung
  # 8), so "no record" there is no proof.
  local id="$1" wd="$2" main="$3" rc nested
  _WS_OWNED_WHY=''
  _ws_reclaim_plain_path "$wd" \
    || { _WS_OWNED_WHY="the workdir is spelled '$wd' — not one plain absolute path"; return 1; }
  [[ ! -L "$wd" ]] || { _WS_OWNED_WHY="$wd is a symbolic link — ccd never follows a link to a tree it would pin or remove"; return 1; }
  _ws_reclaim_absent "$wd"; rc=$?
  (( rc != 2 )) || { _WS_OWNED_WHY="$_WS_ABSENT_WHY — whether the tree at $wd stands or is gone was never asked"; return 2; }
  [[ ! -e "$wd" || -d "$wd" ]] || { _WS_OWNED_WHY="something that is not a directory stands at $wd"; return 1; }
  _ws_reclaim_record "$main" "$wd"; rc=$?
  (( rc != 2 )) || { _WS_OWNED_WHY="could not read $main's worktree list, so whether git records $wd was never asked"; return 2; }
  [[ ! -d "$wd" ]] || (( rc == 0 )) || { _WS_OWNED_WHY="$main has no worktree record for the tree at $wd"; return 2; }
  (( ! RECLAIM_REC_MAIN )) || { _WS_OWNED_WHY="$wd is $main's main checkout"; return 1; }
  [[ "$(_ws_realpath "$wd")" != "$(_ws_realpath "$main")" ]] || { _WS_OWNED_WHY="$wd is the project directory $main itself"; return 1; }
  _ws_reclaim_workdir_shared "$id" "$wd" \
    || { _WS_OWNED_WHY="could not ask whether another registry row names $wd or a path inside it: $_WS_SHARED_WHY"; return 2; }
  [[ -z "$_WS_SHARED_ROWS" ]] || { _WS_OWNED_WHY="$wd is also named by registry row(s) $_WS_SHARED_ROWS"; return 1; }
  [[ -z "$_WS_NESTED_ROWS" ]] || { _WS_OWNED_WHY="$wd has registry row(s) $_WS_NESTED_ROWS rooted inside it, or in its clips directory or temp root, each another session's tree"; return 1; }
  [[ -z "$_WS_THROUGH_ROWS" ]] || { _WS_OWNED_WHY="registry row(s) $_WS_THROUGH_ROWS spell their workdir through $wd, not as one plain path, so ccd cannot prove it lies outside $wd"; return 1; }
  # Scanned only when a row was placed on git's record: every other tail asks
  # exactly what it asked before (`_ws_reclaim_moved_check` says why).
  if [[ -n "$_WS_RECORDED_GDIRS" && -d "$wd" ]]; then
    nested=$(_ws_nested_checkouts "$wd") \
      || { _WS_OWNED_WHY="could not scan $wd for a gone row's moved tree"; return 2; }
    _ws_reclaim_moved_check "$nested"; rc=$?
    case "$rc" in
      0) : ;;
      1) _WS_OWNED_WHY="$_WS_MOVED_WHY"; return 1 ;;
      *) _WS_OWNED_WHY="${_WS_MOVED_WHY:-the moved-tree check answered $rc, an answer it never gives, so whether a gone row's tree was moved inside $wd was never asked}"; return 2 ;;
    esac
  fi
  return 0
}
```

Every `_WS_OWNED_WHY` text is today's, byte for byte, so every existing `detail` assertion still holds. Only the rc of six arms changes (absent, record, no-record, registry, scan and moved-check rc 2, from 1 to 2). The moved-check call is no longer an `||` fold, and it gains the `*)` arm.

- [ ] **Step 4: The tail names the two refusals apart, and the word is declared**

In `_ws_reclaim_tail`, append ` orc` to `local clipskept='' clipswhy='' tmpkept='' tmpwhy='' lfrc cword tword gone dparts tmpq tarc`. Then replace:

```bash
  if ! _ws_reclaim_owned "$id" "$workdir" "$main"; then
    _ws_reclaim_fail "$id" "$lctx" worktree-remove-failed \
      "$_WS_OWNED_WHY — ccd cannot prove the tree at that path is $id's own, so nothing further was deleted"
    return 1
  fi
```

with:

```bash
  # THE TREE IS RE-PROVEN THE CHILD'S OWN (spec §5.5, §5.6) — on a resumed arm
  # the only identity check there is — and a refusal says how it was reached. A
  # PROOF that it is not (rc 1) is `containment-refuted`, from this literal call
  # site: a retry meets the same thing until the other tree or row is moved or
  # removed. A question that could not be asked (rc 2) stays
  # `worktree-remove-failed`. Both stop HERE, where the tail always stopped: the
  # unit stopped and the pane killed, the tombstone and the breadcrumb standing,
  # nothing further deleted, and no step after this one run.
  _ws_reclaim_owned "$id" "$workdir" "$main"; orc=$?
  case "$orc" in
    0) : ;;
    1) _ws_reclaim_fail "$id" "$lctx" containment-refuted \
         "$_WS_OWNED_WHY — so the tree at that path is not only $id's own; the session was stopped, nothing further was deleted, and a retry finds the same until that tree or row is moved or removed"
       return 1 ;;
    *) _ws_reclaim_fail "$id" "$lctx" worktree-remove-failed \
         "$_WS_OWNED_WHY — ccd cannot prove the tree at that path is $id's own, so nothing further was deleted"
       return 1 ;;
  esac
```

In `shared/api.ts`, the union's last member line becomes these two lines:

```ts
  | 'run-id-malformed'        // ws-reclaim (spec §5.9): `--child-of` fails ccd's run-id grammar — journaled `refused` before the lock, once the session id is valid
  | 'containment-refuted';    // ws-reclaim or ws-expire (spec §5.6): the tail's removal-time re-ask PROVED the tree at the workdir is not only the child's own, so it stopped before deleting anything further — journaled `failed`, never `refused`
```

Directly after the `'run-id-malformed':` entry of `LC_REFUSAL_WORD` (its sentence line, ending `…not something about this workspace.',`) and before the map's `};`, add:

```ts
  // Child reclamation, wave 7 (spec §5.6). The tail's removal-time re-ask
  // (`_ws_reclaim_owned`) PROVED that what it would remove is not only the
  // child's own: another session's registry row at, inside or through the
  // worktree or a leaf, a gone row's tree moved inside it, a workdir that is the
  // main checkout or the project directory, a link or a non-directory at the
  // workdir, or a recorded workdir that is not one plain path. It only ever rides
  // `_lc_fail`, after the unit was stopped and the pane killed, from ws-reclaim
  // and ws-expire alike, because the tail is shared. The sentence says only what
  // is true under any server. It never says whether, or when, ccrc retries.
  'containment-refuted':
    'ccrc found that what it would remove is not only this workspace’s own tree — another session’s tree or registry row lies at, inside or through it, or the recorded path is not this workspace’s worktree — so it stopped. The session was stopped and nothing further was deleted. A retry finds the same thing until that other tree or row is moved or removed.',
```

- [ ] **Step 5: Run the tests to verify they pass, then the gates**

Every vitest call runs in the FOREGROUND, timeout ≥ 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-reclaim-owned-rc.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-reclaim-tail-refuted.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-expire-tail-refuted.test.ts
cd server && ./node_modules/.bin/vitest run test/containment-refuted-word.test.ts test/lifecycle-refusal-word.test.ts test/ccd-refusal-scan.test.ts test/wsaudit.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-tail.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-recovery.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-hardening.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-leaf-rows.test.ts test/ccd-child-reclaim-leaf-moved.test.ts test/ccd-child-reclaim-leaf-moved-expire.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-leaf-moved-resume.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim-pre-crumb.test.ts test/child-reclaim-status.test.ts test/child-reclaim-chip-source.test.ts test/single-definition.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p .
cd pwa && ./node_modules/.bin/tsc --noEmit
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'
```

Expected:
- All green.
- `ccd-refusal-scan`'s set-equality holds in both directions: the literal `_ws_reclaim_fail "$id" "$lctx" containment-refuted` is found, and the word is declared.
- `wsaudit` stays green with NO edit, because a `failed` document is no `refused` literal.
- `tsc` prints nothing for server and pwa.
- `mark.mjs --check` exits 0, and `ownership` is green.

**THE CITATION CASE.** All the ccd/ccd edits are below line 19109, so the frozen corpus's ccd anchors do not move. The ONE line added to the `LcRefusalToken` union does move README's `shared/api.ts` anchors that sit below it. Find README's sentence with `grep -n 'shared/api.ts:[0-9]' README.md`, which prints one hit. At `b0647d850` it is README.md:4797, citing `shared/api.ts:7873-7875` and then `:7919`, `:7927` and `:7940`.
- `:7873-7875` (the three `purge-*` union members) do not move, because the new member goes below them.
- `:7919`, `:7927` and `:7940` (the three `purge-*` entries of `LC_REFUSAL_WORD`) move down by one.

If the case reds on them, REPAIR BY CONTENT, never by arithmetic:
1. Read the lines with `grep -n "^  'purge-refused':\|^  'purge-incomplete':\|^  'purge-mechanism-absent':" shared/api.ts`.
2. Re-point README at what that prints.
3. Re-run the describe until it is green.

If anything OTHER than README reds, STOP and report: a frozen-corpus census is never adjusted here.

- [ ] **Step 6: Mutation check**

Make each mutation alone on the Step 4 tree, run its command (FOREGROUND, under 600 s; `-t` narrows to the case), see the stated red, then revert. F_OWN is `test/ccd-reclaim-owned-rc.test.ts`, F_RCL is `test/ccd-reclaim-tail-refuted.test.ts`, F_EXP is `test/ccd-expire-tail-refuted.test.ts` and F_WORD is `test/containment-refuted-word.test.ts`. Every command runs as `cd server && ./node_modules/.bin/vitest run <file> [-t '<case>']`.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | In `_ws_reclaim_owned`, the plain-path arm's `…not one plain absolute path"; return 1; }` becomes `return 0; }` | F_OWN `-t 'not one plain path'` | `expected '0' to be '1'` |
| 2 | The link arm's `…tree it would pin or remove"; return 1; }` becomes `return 0; }` | F_OWN `-t 'symbolic link at the workdir'` | `expected '0' to be '1'` |
| 3 | The non-directory arm's `…not a directory stands at $wd"; return 1; }` becomes `return 0; }` | F_OWN `-t 'not a directory at the workdir'` | `expected '0' to be '1'` |
| 4 | The main-checkout arm's `…main checkout"; return 1; }` becomes `return 0; }` | F_OWN `-t 'main checkout'` | `expected '0' to be '1'` |
| 5 | The project-directory arm's `…$main itself"; return 1; }` becomes `return 0; }` | F_OWN `-t 'project directory itself'` | `expected '0' to be '1'` |
| 6 | The SHARED arm's `…registry row(s) $_WS_SHARED_ROWS"; return 1; }` becomes `return 0; }` | F_OWN `-t 'SHARED'` | `expected '0' to be '1'` |
| 7 | The NESTED arm's `…each another session's tree"; return 1; }` becomes `return 0; }` | F_OWN `-t 'NESTED'` | both NESTED cases: `expected '0' to be '1'` |
| 8 | The THROUGH arm's `…lies outside $wd"; return 1; }` becomes `return 0; }` | F_OWN `-t 'THROUGH'` | `expected '0' to be '1'` |
| 9 | `1) _WS_OWNED_WHY="$_WS_MOVED_WHY"; return 1 ;;` becomes `return 0 ;;` | F_OWN `-t 'moved inside the child'` | `expected '0' to be '1'` |
| 10 | The absent arm's `…stands or is gone was never asked"; return 2; }` becomes `return 0; }` | F_OWN `-t 'absence cannot be proven'` (not root) | `expected '0' to be '2'` |
| 11 | The same arm's `return 2; }` becomes `return 1; }` | same | `expected '1' to be '2'` |
| 12 | The worktree-list arm's `…was never asked"; return 2; }` becomes `return 0; }` | F_OWN `-t 'worktree list cannot be read'` | `expected '0' to be '2'` |
| 13 | The no-record arm's `…no worktree record for the tree at $wd"; return 2; }` becomes `return 0; }` | F_OWN `-t 'no worktree record'` | `expected '0' to be '2'` |
| 14 | The same arm's `return 2; }` becomes `return 1; }` | F_OWN `-t 'no worktree record'`, then F_RCL `-t 'no worktree record'` | `expected '1' to be '2'`; then `expected 'containment-refuted' to be 'worktree-remove-failed'` |
| 15 | The registry arm's `…a path inside it: $_WS_SHARED_WHY"; return 2; }` becomes `return 0; }` | F_OWN `-t 'cannot be placed'` | `expected '0' to be '2'` |
| 16 | The scan arm's `…for a gone row's moved tree"; return 2; }` becomes `return 0; }` | F_OWN `-t 'cannot be scanned'` (not root) | `expected '0' to be '2'` |
| 17 | The `*)` arm's `…was never asked}"; return 2 ;;` becomes `return 0 ;;` | F_OWN `-t 'never 1'` | the git-directory and never-gives cases: `expected '0' to be '2'` |
| 18 | The same `*)` arm's `return 2 ;;` becomes `return 1 ;;` (the old fold) | F_OWN `-t 'never 1'`, then F_RCL `-t 'git directory cannot be read'` | `expected '1' to be '2'`; then `expected 'containment-refuted' to be 'worktree-remove-failed'` |
| 19 | In the tail's `1)` arm, `containment-refuted` becomes `worktree-remove-failed` | F_RCL `-t 'SHARED'`; then `test/ccd-refusal-scan.test.ts` | `expected 'worktree-remove-failed' to be 'containment-refuted'`; then `declared journal-only tokens with no literal ccd call-site argument: expected [ 'containment-refuted' ] to deeply equal []` |
| 20 | In the tail's `*)` arm, `worktree-remove-failed` becomes `containment-refuted` | F_RCL `-t 'cannot be placed'` | `expected 'containment-refuted' to be 'worktree-remove-failed'` |
| 21 | In the tail's `1)` arm, delete `return 1 ;;`, leaving `;;`. The tail goes on past its stop | F_RCL `-t 'resumed at'` (the SHARED family) | `the reclaim’s own f1.txt stands — …: expected false to be true`. The settle and step (4) ran, and the tree was removed. |
| 22 | In the tail's `*)` arm, delete `return 1 ;;`, leaving `;;` | F_RCL `-t 'cannot be placed'` | `the reclaim’s own f1.txt stands — …: expected false to be true` |
| 23 | Under F_EXP, mutation 19 again | F_EXP `-t 'SHARED'` | `expected 'worktree-remove-failed' to be 'containment-refuted'` (the expiry takes the same tail) |
| 24 | Delete the `'containment-refuted':` entry (its comment and its two lines) from `LC_REFUSAL_WORD` | `cd server && ./node_modules/.bin/tsc --noEmit -p .`; then F_WORD | `TS2741: Property ''containment-refuted'' is missing in type …`; then `expected false to be true` |
| 25 | Delete the union member AND the map entry | `test/ccd-refusal-scan.test.ts` | `tokens no vocabulary owns: expected [ 'containment-refuted' ] to deeply equal []` |
| 26 | In the sentence, `nothing further was deleted` becomes `nothing was deleted` | F_WORD | `expected '…' to match /nothing further was deleted/` |
| 27 | Add `'containment-refuted'` to `CHILD_RECLAIM_PRE_CRUMB_FAILED` (server/src/coord/childReclaim.ts:310) | F_WORD `-t 'parseChildReclaimResult'` | a `toEqual` diff, `resume: 'resumable'` expected and `'not-resumable'` received |
| 28 | In `parseExpireResult`, `resumable: v.failed !== 'probe-unmeasured'` becomes `resumable: false` | F_WORD `-t 'parseExpireResult'` | a `toEqual` diff, `resumable: true` expected and `false` received |

Two arms have no red of their own:
- The `*)` arm's fallback text `${_WS_MOVED_WHY:-…}` is reached only by the never-gives case, which pins the rc and `answered 7`.
- `_ws_reclaim_workdir_shared` never answers 1, so the registry arm's mapping of any non-zero answer to 2 is defence in depth.

Revert every mutation, re-stamp (`bash ccd/ccrc restamp ccd/ccd`, `node shared/mark.mjs --check ccd/ccd`, `cd server && ./node_modules/.bin/vitest run test/ownership.test.ts`), and re-run Step 5 green.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccd shared/api.ts \
  server/test/lifecycle-refusal-word.test.ts server/test/ccd-child-reclaim-verb-tail.test.ts \
  server/test/ccd-child-reclaim-verb.test.ts server/test/ccd-child-reclaim-recovery.test.ts \
  server/test/containmentRefutedFamilies.ts server/test/ccd-reclaim-owned-rc.test.ts \
  server/test/ccd-reclaim-tail-refuted.test.ts server/test/ccd-expire-tail-refuted.test.ts \
  server/test/containment-refuted-word.test.ts
git add README.md   # only if Step 5 repaired its shared/api.ts anchors
git commit -m "$(cat <<'MSG'
fix(ccd): the reclaim tail names a proven refusal containment-refuted

_ws_reclaim_owned answers three ways: 0 own, 1 proven not own, 2 could
not be asked. Nothing unasked folds into 1 any more: the moved-tree
check's own 2 (or any answer it never gives), a failed scan, an
unreadable worktree list, a registry that could not be asked, an
unprovable absence, and a tree with no worktree record are all 2.

The tail that ws-reclaim and ws-expire share prints and journals
containment-refuted on 1, from its own literal call site, and keeps
worktree-remove-failed on 2. Both stop where the tail always stopped:
after the unit and the pane, before the settle, with the tombstone and
the breadcrumb standing and nothing further deleted.

shared/api.ts declares the word with a sentence that is true under any
server. Today's parsers read it as a resumable failure and retry it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```
---

### Task 2: R70 — `crumb`'s ccd half, the capped permission-pass reason, and rung 8's silent omission

**Model routing:** **`opus`, effort `high`**. SAFETY-bounded: every edit sits in the reclaim ladder, the shared reclaim/expiry tail or `_ws_reclaim_log_of` (which the pin phase reads), all shared with `ws-expire`. R70's SAFETY bound is the review question for this task: no arm newly reaches the pin, the settle or a removal, and none continues past a stop it used to make.

**Why:** Contract §14 R70 carries three ccd corrections, each of them shared with `ws-expire`. The coordinator's ruling on the drafts (T2, from OPEN5) adds a fourth guard on the vanished arm, the all-zero recorded HEAD, set out below the vanished-arm paragraph:
- **(A) `crumb`.** A `"failed"` document does not say whether it was printed before or after the act's breadcrumb. So the server reads a pre-breadcrumb `pin-failed` or `tombstone-unwritable` as "resumes where it stopped", and the resumed arm's `probe-unmeasured` as "retried from the start" (the residuals that "§12 as built" carried to wave 7). ccd now says which, additively. Wave 8 adds the reader.
- **(B) `_WS_NORMALISE_WHY` is uncapped.** It carries `$left`, a name the SESSION chose, plus a line of `find`'s stderr. A long or non-UTF-8 name grows at the journal encoder (`_lc_json`, ccd/ccd:4815; its 2048-byte cap `_LC_LINE_MAX`, :4346). The encoder then falls back to its last-resort line and drops `detail`, `verb` and every `dec.*` except `surface`. Measured in Step 8: the row of a `tree-unreadable` refusal comes back `truncated`, with no `verb` and no `dec.actor`.
- **(C) Rung 8's silent omission.** On git 2.43, `git worktree list --porcelain` exits 0 and OMITS the stanza of a record whose admin `gitdir` it cannot read. With `worktrees/` itself unlistable, it omits EVERY linked stanza. `_ws_reclaim_record` (ccd/ccd:25979) then answers rc 1, and the ladder refuses the TERMINAL `no-worktree-record` (ccd/ccd:27063-27064, `grep -n '_reap_refuse no-worktree-record "$main has no worktree record for $workdir"' ccd/ccd`, the second hit; the first, :12001, is ws-reap's and is not touched). That breaks spec §5.5's rule that a read that failed measured nothing.

Measured at `b0647d850` in a scratch fixture with GNU git 2.43.0. Each row gives `_ws_reclaim_record`'s rc, then `_ws_reclaim_log_of <main> tree <wt> 0`'s rc:

| shape | tree standing | tree gone |
|---|---|---|
| control | 0 / 0 | 0 (prunable) / 0 |
| admin `gitdir` mode 000 | **1** / 1 | **1** / 1 |
| admin dir mode 000 | **1** / 1 | **1** / 1 |
| `worktrees/` mode 000 | **1** / 1 | **1** / 1 |
| admin dir removed (truly no record) | 1 / **1** | 1 / 0 |
| plain directory, no `.git` (truly no record) | 1 / **1** | n/a |
| admin `HEAD` mode 000 | 0 (`HEAD 0000000`) / 1 | 0 (`HEAD 0000000`) / 0 |

**Read the bold cells. The ruling's literal ask does not separate the clean case for a STANDING tree.** For an existing directory, `_ws_reclaim_log_of … tree <workdir> 0` takes its standing arm, which runs `rev-parse` inside the tree and then `_ws_reclaim_gitdir_own`. That arm fails on the truly-no-record shapes too, so asked literally, `no-worktree-record` could never be answered. The walk R70 means is the GONE arm's walk of `<common>/worktrees/*/gitdir`, the one the breadcrumb arm (`_ws_reclaim_recorded_crumb`, ccd/ccd:26457-26470) reaches because its workdir is gone. So this task:
- EXTRACTS that walk, unchanged, into `_ws_reclaim_admin_entries`. `_ws_reclaim_log_of`'s gone arm calls it, so there is still one matcher of an admin entry to a path.
- Asks it through a new `_ws_reclaim_no_record` at the ladder's call site, never inside `_ws_reclaim_record` (it has six callers: :26404, :26457, :27054, :27267, :28695, :29953).

This is the departure `rung8-asks-the-admin-walk-not-log-of`, ACCEPTED by the coordinator (ruling T2 DEP1).

**The vanished arm (ccd/ccd:27267, `rec=1` proceeds), measured under the silent omission.** The fixture is `makeChild`, the tree removed, then the admin `gitdir` set to mode 000 or `worktrees/` set to mode 000. Results:
- `_ws_reclaim_eval` answers `reclaimable`, with a token minted over `record=1`.
- `ws-reclaim` then journals `intent`, then `failed pin-failed`. The detail is `…/worktrees/quiet-basin/gitdir cannot be read — whether … is git's record of … was never asked`, or `…/.git/worktrees cannot be listed — …`.
- `_ws_reclaim_pin_absent`'s own `_ws_reclaim_log_of "$main" tree "$workdir" "${rhead:+1}"` (ccd/ccd:28588) walks the same entries and fails.
- There is no tombstone and no breadcrumb, and the branch is intact.

So proceeding is SAFE today: it stops at the pin phase, before anything is destroyed. But it licenses a destructive call over a misread, journals an intent and a `pin-failed` on every pass, and reads as resumable. **Ruled here: the vanished arm takes the same ask.** Its stop moves EARLIER, to the audit (`unmeasured`, no intent). No arm newly reaches the pin. A tree git truly no longer records (pruned) still proceeds, because no entry names it.

**The all-zero recorded HEAD (ruling T2, from OPEN5: a guard this task adds).** The table's last row: git lists a record whose admin `HEAD` is at mode 000 with the all-zero object id, so `_ws_reclaim_record` answers rc 0 with `RECLAIM_REC_HEAD` = `0000…`. On the vanished arm that id becomes `RECLAIM_HEAD` (:27273), the token's `head=` input and the pin's `recordhead`. `grep -n 'RECLAIM_REC_HEAD' ccd/ccd` lists the reset in `_ws_reclaim_reset` (:25763), `_ws_reclaim_record`'s header, reset and parser (:25980, :25996, :26005), two `local` shadows (:26389, :26432) and exactly ONE read, :27273. The present arm takes its HEAD from `rev-parse` inside the tree, never from the record. So the guard sits at that one read, inside `_ws_reclaim_eval_absent` and never inside `_ws_reclaim_record`: an all-zero `RECLAIM_REC_HEAD` answers `unmeasured`, retried, before any token is minted. The vanished arm is shared, so `ws-expire` answers the same. Red first: an admin `HEAD` at mode 000 on the vanished arm (Step 13's all-zero case). Measured by the plan's author with git 2.43.0 in a throwaway repository, and re-measured by the worker in Step 16:
- `git update-ref <ref> <all-zero id>` exits 0 and DELETES the ref it names (an existing `refs/ccrc/attic/t/<sha>` was gone afterwards);
- today the zero id never reaches it. `_ws_reclaim_attic_extra` (`grep -n '^_ws_reclaim_attic_extra() {' ccd/ccd`) asks `git cat-file -e "<id>^{commit}"` first, which exits 128 on the zero id, so the verb stops `pin-failed`. The one ref such a call would name is `refs/ccrc/attic/<id>/<all-zero id>`, which no pin creates (each pin is named for the commit it pins).

Step 22 states both in their own paragraph.

**This reaches `ws-expire`.** The ladder (`_ws_reclaim_ladder`, :26925) is SHARED with `_ws_expire_eval` (:30782), and the tail is shared too. `no-worktree-record` is terminal in both lanes (`server/src/coord/childReclaim.ts:77`, `server/src/archivedExpiry.ts:46`), so the silent-omission shape now reads as a retried unmeasured answer on both lanes:
- on reclaim, one journaled `failed probe-unmeasured` (verb `ws-audit`) per audit pass, bounded by R20's backoff;
- on expiry, an exit-1 audit journaled nowhere.

`_ws_expire_locked` (:31003) is NOT edited (R72; workspace-lifecycle run 345's B4 edits it). So `ws-expire`'s pre-breadcrumb documents carry no `crumb`: its direct `_ws_reclaim_failed_json probe-unmeasured` (:31014) and its `pin-failed` and `tombstone-unwritable` (:31043, :31051). That is absence, never a wrong value. The worker names all five in the wave-done for quiet-river: crumb's absence there, the rung-8 verdict change, the vanished-arm change, the all-zero-HEAD guard (ruling T2 OPEN5), and the reason cap.

**Files:**
- Modify `ccd/ccd`. Every edit is BELOW ccd/ccd:19109, so the frozen citation census is untouched. Only line 2 (the restamp) changes above it. The measured line count went from 35185 to 35267 (+82) before the all-zero-HEAD guard (ruling T2 OPEN5) was added. The guard adds about 9 more lines; re-measure and state the figure. The line numbers below are hints at `b0647d850`; locate each edit by its quoted text. If Task 1 has landed first, its edits to the tail and to `_ws_reclaim_owned` move these lines, and only the anchors hold.
  1. **A:** the global plus `_ws_reclaim_failed_json` (:28620-28625, `grep -n '^_ws_reclaim_failed_json() {' ccd/ccd`).
  2. **A:** `_ws_reclaim_locked`, two insertions: after `phase="$RECLAIM_RESUME_PHASE"; resumed="$phase"` (:30257, the FIRST of its two hits; the second, :31008, is `_ws_expire_locked`'s and is never touched), and before `phase="$start"` (:30340, the hit directly under `reaping "reclaim:$start"`).
  3. **A:** `_ws_reclaim_tail`, one insertion after `[[ "$_WS_RCL_ACT" != expire ]] || { noun=expiry; …` (:29553).
  4. **B:** `_ws_reclaim_normalise` (:25811). One comment paragraph goes above `# \`-user\` GOVERNS BOTH ARMS` (:25833), and three assignments change (:25847, :25853, :25857).
  5. **C:** the ladder's record refusal (:27063-27064).
  6. **C:** the vanished arm, after `(( rec == 2 ))`'s unmeasured line (:27268-27269): the silent-omission ask, then the all-zero-HEAD guard (ruling T2 OPEN5).
  7. **C:** `_ws_reclaim_log_of` (:28029). Its `local` line (:28057) loses `d g real n`. Its gone-arm walk (:28084 to the function's closing `}` at :28110) MOVES, byte for byte, into `_ws_reclaim_admin_entries`, which `_ws_reclaim_log_of` now calls. `_ws_reclaim_no_record` is inserted after it, directly above `_ws_reclaim_reflog_ids() {` (:28112).
- Modify `server/test/ccd-child-reclaim-verb.test.ts`: one line (:453, `grep -n "toEqual({ failed: 'pin-failed', detail: 'the disk is full' })"`).
- Modify `server/test/ccd-child-reclaim-unmeasured-journal.test.ts`: `printedBy` (:35-39).
- Test (new): `server/test/ccd-child-reclaim-crumb.test.ts`, `server/test/ccd-child-reclaim-why-cap.test.ts`, `server/test/ccd-child-reclaim-silent-omission.test.ts`. They are three files because of R56's 600 s foreground ceiling. Measured together: 26 cases in about 20 s, before the all-zero-HEAD case was added (27 with it).

**Interfaces:**
- Consumes (at `b0647d850`):
  - `_ws_leaf_why_line <text>`: prints printable ASCII, cut at 300 bytes, the cut marked `…` (ccd/ccd:29473, `grep -n '^_ws_leaf_why_line() {' ccd/ccd`). Wave 6's one cutter, unchanged.
  - `_ws_reclaim_record <main> <path>`: rc 0 / 1 / 2 (ccd/ccd:25979). Not edited.
  - `_ws_reclaim_log_of <main> tree|branch <arg> [recorded]` (ccd/ccd:28029). Its contract is unchanged.
  - `_ws_reclaim_unmeasured <detail>` (:25788) and `_reap_refuse <word> <detail>` (:11891).
  - `_ws_reclaim_fork`, and `RECLAIM_RESUME_PHASE` (:30195). `_ws_reclaim_fail id lctx token detail [k v]…` (:28658). Not edited; its call sites stay literally unchanged, which `ccd-refusal-scan.test.ts:197`'s regex reads. `crumb` rides the global `_WS_RCL_CRUMB`, never an argument: the departure `crumb-rides-a-global-not-an-argument` is ACCEPTED (ruling T2 DEP2).
  - Test side:
    - `makePrHarness` (`ccdPrHelpers.ts`), whose `h.sh(snippet, env)` is the harness's own;
    - `makeChild`, `evalOf`, `childReclaimVerb`, `CHILD_ID`, `CHILD_STUBS`, `CHILD_ENV` (`childReclaimFixture.ts`);
    - `verbHelpers` (`interrupted`, `resumeToken`, `failedPairAgrees`) (`childReclaimVerbHelpers.ts`);
    - `makeArchived`, `expireToken`, `expireVerb`, `expireAudit`, `expireEvalOf`, `EXP_ID`, `EXP_STUBS` (`wsExpireFixture.ts`);
    - `eventsOf`, `decOf` (`lifecycleHelpers.ts`).
- Produces:
  ```bash
  _WS_RCL_CRUMB                                  # '' (omit) | true | false — assigned '' when ccd is read; set ONLY by
                                                 # _ws_reclaim_locked (false fresh / true resumed / '' over an unreadable
                                                 # breadcrumb; true once its breadcrumb is written) and by _ws_reclaim_tail (true)
  _ws_reclaim_failed_json <token> <detail>       # {"failed":…,"detail":…} plus ,"crumb":true|false ONLY when _WS_RCL_CRUMB is
                                                 # one of those two literals
  _ws_reclaim_admin_entries <common> <path> <recorded>
                                                 # rc 0: `<d>/logs/HEAD` + `gitdir:<d>` appended to _WS_LOGS per entry naming
                                                 # <path>/.git; rc 1 (_WS_KEEP_WHY): worktrees/ or an entry unreadable, or
                                                 # recorded=1 and none names it. _ws_reclaim_log_of's old gone-arm walk, moved.
  _ws_reclaim_no_record <common> <workdir>       # rc 0 no admin entry names <workdir>/.git, every entry read;
                                                 # rc 1 (_WS_NOREC_WHY) one does — git's list omitted a record that exists;
                                                 # rc 2 (_WS_NOREC_WHY) worktrees/ or an entry could not be read.
                                                 # Shadows _WS_LOGS and _WS_KEEP_WHY.
  _WS_NORMALISE_WHY                              # now always ONE line: <= 300 bytes printable ASCII, plus "…" when cut
  ```
  - Verdicts: under a silent omission, the ladder answers `unmeasured` where it answered `no-worktree-record` (tree standing) or `reclaimable` (vanished arm). `no-worktree-record` stays TERMINAL where no admin entry names the tree. On the vanished arm, a record git lists with the all-zero HEAD also answers `unmeasured` (ruling T2 OPEN5), where the ladder minted a token over `head=0000…`.
  - Wave 8 reads `crumb` absence-permits, and reads `true` as "printed past the act's breadcrumb: the act had started" (ruling T2 OPEN4), never as "a breadcrumb stands now": the tail's `purge-*` failures print `true` after `_reg_purge` took the row and its `.reaping` file. Task 1's `containment-refuted`, printed through `_ws_reclaim_fail` in the tail, carries `crumb:true` with no edit of its own, because the tail sets `_WS_RCL_CRUMB=true`.
  - Later, Task 6's `cmd_ws_collect` shadows `_WS_RCL_CRUMB` to `''` with `local`, so a collection's documents carry no crumb. Task 6 then amends this task's comment above `_WS_RCL_CRUMB=''` to say so. At this task's commit the comment's "and by nothing else" is true as written.

- [ ] **Step 0: Record the untouched regions (R70, R72)**

Run on the branch before any edit, and keep the output:
```bash
awk '/^_ws_expire_locked\(\) \{/,/^}$/' ccd/ccd | sha256sum
awk '/^_ws_reclaim_record\(\) \{/,/^}$/' ccd/ccd | sha256sum
grep -c '_reg_get' ccd/ccd
sed -n '/^# ── THE PLATFORM LAYER/,/^# ── END PLATFORM LAYER/p' ccd/ccd | sha256sum
```
Step 21 re-runs these four, and all four must print the same. `_ws_expire_locked` is workspace-lifecycle's (R72), and `_ws_reclaim_record` is never edited (R70). This task adds no `_reg_get`, and the platform layer (ccd/ccd:41-1221, `# ── THE PLATFORM LAYER` to `# ── END PLATFORM LAYER`) is byte-identical with `ccd/ccrc`. Line 2's stamp lies outside it, and that is the only line above 19109 that changes.

#### Part A — `crumb`

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-child-reclaim-crumb.test.ts`:

```ts
// `crumb` — whether a `"failed"` document was printed past the act's breadcrumb
// (child reclamation spec §5.6, §7 item 6). ADDITIVE and ccd-side only: the key
// is printed when the printer was told, and omitted otherwise, so a reader takes
// its absence as unmeasured and never as either value.
//   - `ws-reclaim` says `false` on its fresh arm before its breadcrumb, the
//     resumed state (`true`) on its resumed arm, and `true` once its breadcrumb
//     is written;
//   - the SHARED tail says `true`, for `ws-reclaim` and `ws-expire` alike;
//   - `true` means printed past the act's breadcrumb (the act had started),
//     never that a breadcrumb stands now: a tail `purge-*` failure prints it
//     after the row and its breadcrumb were purged;
//   - `ws-expire`'s own pre-breadcrumb documents (its `probe-unmeasured`,
//     `pin-failed` and `tombstone-unwritable`) carry NO key: its locked body is
//     another programme's region and is not edited;
//   - a breadcrumb that stands but cannot be read says nothing either way.
// FIXTURE HOMEs ONLY: every ccd call runs through the harness, never against $HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import { CHILD_ENV, CHILD_ID, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { EXP_ID, EXP_STUBS, expireToken, expireVerb, makeArchived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-crumb-'); });
afterEach(() => { h.cleanup(); });
const { interrupted, resumeToken, failedPairAgrees } = verbHelpers(() => h);

type Doc = Record<string, unknown>;
const docOf = (r: { stdout: string }): Doc => JSON.parse(r.stdout) as Doc;
const PIN_FAILS = '_ws_wip_commit() { RECLAIM_WIP_WHY="the disk is full"; return 1; };';
const STASH_FAILS = '_ws_reclaim_stash_shas() { return 1; };';
const UNIT_UP = '_svc_is_active() { printf active; };';
/** A unit that is down for the ladder and UP again once the tail has unsupervised it: the expiry's
 *  presence rung passes, and the tail's re-measure stops it, past its breadcrumb. */
const UNIT_BACK_UP =
  '_svc_is_active() { if grep -q "^unsupervise" "$HOME/ccd-calls" 2>/dev/null; then printf active; else printf inactive; fi; };';

describe('the printer: the key only when told, and only ever a boolean', () => {
  const print = (crumb: string): string =>
    h.sh(`_WS_RCL_CRUMB='${crumb}'; _ws_reclaim_failed_json some-word 'a detail'`);
  it('omits the key when nothing set it, prints true or false when set, and never prints another value', () => {
    expect(print('')).toBe('{"failed":"some-word","detail":"a detail"}');
    expect(print('false')).toBe('{"failed":"some-word","detail":"a detail","crumb":false}');
    expect(print('true')).toBe('{"failed":"some-word","detail":"a detail","crumb":true}');
    expect(print('yes'), 'a value that is not a boolean is not printed').toBe('{"failed":"some-word","detail":"a detail"}');
  }, 30_000);

  it('is assigned when ccd is read, so an exported value never reaches a document', () => {
    expect(h.sh('_ws_reclaim_failed_json some-word d', { _WS_RCL_CRUMB: 'true' }))
      .toBe('{"failed":"some-word","detail":"d"}');
  }, 30_000);
});

describe('ws-reclaim', () => {
  it('fresh arm, before the breadcrumb: pin-failed says crumb false — and the journal row is unchanged', () => {
    makeChild(h);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: PIN_FAILS });
    expect(r.code, r.stderr).toBe(1);
    expect(docOf(r)).toEqual({ failed: 'pin-failed', detail: 'the disk is full', crumb: false });
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb was written').toBeNull();
    failedPairAgrees(r);
    const row = eventsOf(h.home, 'reclaim').filter((e) => e['outcome'] === 'failed').pop()!;
    expect(row, 'crumb is the document’s, never a journal key').not.toHaveProperty('crumb');
  }, 60_000);

  it('fresh arm: the locked recomputation’s probe-unmeasured says crumb false', () => {
    makeChild(h);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: STASH_FAILS });
    expect(r.code, r.stderr).toBe(1);
    expect(docOf(r)).toMatchObject({ failed: 'probe-unmeasured', crumb: false });
  }, 60_000);

  it('resumed arm: probe-unmeasured over a standing breadcrumb says crumb TRUE (the next attempt resumes)', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    const tomb = path.join(h.home, '.cc-sessions', '.reaped', `${CHILD_ID}.json`);
    fs.chmodSync(tomb, 0o000);
    try {
      const r = childReclaimVerb(h, tok);
      expect(r.code, r.stdout + r.stderr).toBe(1);
      expect(docOf(r)).toMatchObject({ failed: 'probe-unmeasured', crumb: true });
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stands').toBe('reclaim:worktree');
    } finally { fs.chmodSync(tomb, 0o644); }
  }, 60_000);

  it('a breadcrumb that stands but cannot be read: probe-unmeasured carries NO crumb', () => {
    makeChild(h);
    const tok = evalOf(h).token;
    fs.mkdirSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.reaping`));
    const r = childReclaimVerb(h, tok);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const d = docOf(r);
    expect(d['failed']).toBe('probe-unmeasured');
    expect(d, 'whether an act started is unknown, so nothing is said').not.toHaveProperty('crumb');
  }, 60_000);

  it('past the breadcrumb: the tail’s failure says crumb true', () => {
    makeChild(h);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: UNIT_UP });
    expect(r.code, r.stderr).toBe(1);
    expect(docOf(r)).toMatchObject({ failed: 'unit-still-active', crumb: true });
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:children');
  }, 60_000);
});

describe('ws-expire — its locked body is not edited', () => {
  it('pre-breadcrumb pin-failed carries NO crumb, even with one exported', () => {
    makeArchived(h);
    const tok = expireToken(h);
    let out = '';
    try {
      out = h.sh(`${EXP_STUBS} ${PIN_FAILS} ${CHILD_ENV} cmd_ws_expire --expect ${tok} --session ${EXP_ID}`,
        { _WS_RCL_CRUMB: 'false' });
    } catch (e) { out = String((e as { stdout?: string }).stdout ?? ''); }
    expect(JSON.parse(out)).toEqual({ failed: 'pin-failed', detail: 'the disk is full' });
    expect(h.reg(EXP_ID, 'reaping')).toBeNull();
  }, 90_000);

  it('its own probe-unmeasured (printed by `_ws_reclaim_failed_json` directly) carries NO crumb', () => {
    makeArchived(h);
    const r = expireVerb(h, expireToken(h), { pre: STASH_FAILS });
    expect(r.code, r.stderr).toBe(1);
    const d = docOf(r);
    expect(d['failed']).toBe('probe-unmeasured');
    expect(d).not.toHaveProperty('crumb');
  }, 90_000);

  it('the SHARED tail says crumb true for an expiry too', () => {
    makeArchived(h);
    const r = expireVerb(h, expireToken(h), { pre: UNIT_BACK_UP });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(docOf(r)).toMatchObject({ failed: 'unit-still-active', crumb: true });
    expect(h.reg(EXP_ID, 'reaping'), 'past the breadcrumb').toBe('expire:children');
  }, 90_000);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-crumb.test.ts
```
Expected: `Tests  6 failed | 4 passed (10)`.
- Red:
  - "omits the key when nothing set it, …", with `Expected: "{"failed":"some-word","detail":"a detail","crumb":false}"` and `Received: "{"failed":"some-word","detail":"a detail"}"`;
  - "fresh arm, before the breadcrumb: pin-failed …" (`expected { failed: 'pin-failed', …(1) } to deeply equal { failed: 'pin-failed', …(2) }`);
  - "fresh arm: the locked recomputation's probe-unmeasured …";
  - "resumed arm: …";
  - "past the breadcrumb: …";
  - "the SHARED tail says crumb true for an expiry too" (each `to match object`).
- Green already, because they pin the OMISSION that must survive:
  - "is assigned when ccd is read";
  - "a breadcrumb that stands but cannot be read";
  - both ws-expire no-crumb cases.

- [ ] **Step 3: Implement**

In `ccd/ccd`, replace the whole of `_ws_reclaim_failed_json` (:28620-28625) with:

```bash
# WHETHER A FAILURE WAS PRINTED PAST THE ACT'S BREADCRUMB (spec §5.6, §7 item 6):
# `false` before it (nothing started, so a retry starts over), `true` past it:
# the act had started. `true` says the breadcrumb was WRITTEN, never that it
# stands now. The tail's `purge-*` failures print it after `_reg_purge` took
# the row and its `.reaping` file. '' prints NO key: a reader takes
# that absence as unmeasured, never as either value. Set by `_ws_reclaim_locked`
# and by the shared tail, and by nothing else — so `ws-expire`'s own
# pre-breadcrumb documents carry no key. Assigned here, when ccd is read, so an
# exported value can never reach a document.
_WS_RCL_CRUMB=''
_ws_reclaim_failed_json() {   # token detail -> the post-start failure document on stdout, with
  #                                `"crumb":true|false` only when _WS_RCL_CRUMB says one
  # `"failed"`, NEVER `"refused"`: a failure after the act started is not a
  # ladder answer, and `server/test/wsaudit.test.ts` harvests every literal
  # refusal object as one. The server reads this as `failed` and retries.
  # ONLY the two literals print: any other value omits the key, never prints it.
  local crumb=''
  case "$_WS_RCL_CRUMB" in true|false) crumb=",\"crumb\":$_WS_RCL_CRUMB" ;; esac
  printf '{"failed":%s,"detail":%s%s}\n' "$(_json_str "$1")" "$(_json_str "$2")" "$crumb"
}
```

In `_ws_reclaim_tail` (:29542), directly under `[[ "$_WS_RCL_ACT" != expire ]] || { noun=expiry; donekey=expired; bindkey=archivedAt; }` and above `tomb="$REG/.reaped/$id.json"`, insert:

```bash
  # Every failure from here on is printed past a breadcrumb, for both verbs
  # (`crumb`, spec §5.6).
  _WS_RCL_CRUMB=true
```

In `_ws_reclaim_locked` (:30252), directly under `phase="$RECLAIM_RESUME_PHASE"; resumed="$phase"`, insert:

```bash
  # `crumb` (spec §5.6): a resumed arm's breadcrumb already stands (`true`); a
  # fresh arm's is not written yet (`false`); a breadcrumb that stands but could
  # not be read leaves it unsaid — whether an act started is not known.
  if [[ -n "$phase" ]]; then _WS_RCL_CRUMB=true
  elif [[ -e "$REG/$id.reaping" || -L "$REG/$id.reaping" ]]; then _WS_RCL_CRUMB=''
  else _WS_RCL_CRUMB=false; fi
```

In the same function, directly above `    phase="$start"` (:30340, under the `tombstone-unwritable` block), insert `    _WS_RCL_CRUMB=true`.

The middle arm is the departure `crumb-unsaid-over-an-unreadable-breadcrumb`, ACCEPTED (ruling T2 DEP3). It mirrors `_ws_reclaim_fork_contained`'s own test for a standing but unreadable breadcrumb (`[[ -z "$rbc" ]] && [[ -e "$REG/$id.reaping" || -L "$REG/$id.reaping" ]]`, :30224). The `-e` and `-L` tests are no `_reg_get`. The whole lock is held, so no breadcrumb can appear between the fork and this test. The after-breadcrumb `true` is what the interface says. It is redundant with the tail's own `true` on today's code, because nothing prints a failure between the two, so no mutation row pins it alone (row A8 pins the pair).

- [ ] **Step 4: Run it to pass, and repair the two exact-shape assertions it breaks**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-crumb.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-unmeasured-journal.test.ts
```
Expected:
- `crumb`: `10 passed`.
- The other two each red ONE case. Both are exact-shape pins of the old document, and the fresh arm's `false` is the measured new truth:
  - `ccd-child-reclaim-verb` "pin-failed destroys nothing, …": `expected { failed: 'pin-failed', …(2) } to deeply equal { failed: 'pin-failed', …(1) }`;
  - `ccd-child-reclaim-unmeasured-journal` "journals failed probe-unmeasured, …": `the stdout bytes are the ones _ws_reclaim_failed_json always printed`, with `Received: "{…,"crumb":false}"`.

Repair each with the smallest edit:
- In `server/test/ccd-child-reclaim-verb.test.ts`, change `expect(JSON.parse(r.stdout)).toEqual({ failed: 'pin-failed', detail: 'the disk is full' });` to `expect(JSON.parse(r.stdout)).toEqual({ failed: 'pin-failed', detail: 'the disk is full', crumb: false });`.
- In `server/test/ccd-child-reclaim-unmeasured-journal.test.ts`, replace `printedBy` with:
  ```ts
  /** What `_ws_reclaim_failed_json` prints for this detail: ccd's own printer, never a re-spelling. The fresh
   *  arm's `crumb` is `false` (wave 7, spec §5.6): nothing had started. */
  const printedBy = (detail: string): string => {
    fs.writeFileSync(path.join(h.home, 'detail.txt'), detail);
    return h.sh('_WS_RCL_CRUMB=false; _ws_reclaim_failed_json probe-unmeasured "$(cat "$HOME/detail.txt")"');
  };
  ```

Then find any OTHER whole-document pin on your tree, including any that Task 1 added for `containment-refuted`:
```bash
grep -rn "toEqual({ failed:\|toStrictEqual({ failed:\|_ws_reclaim_failed_json" server/test/*.ts
```
- At `b0647d850` the grep finds only the two above, plus `ccd-child-reclaim-crumb.test.ts`'s own.
- A whole-document `toEqual` of a TAIL failure gains `crumb: true`.
- A whole-document `toEqual` of a `ws-reclaim` pre-breadcrumb failure gains `crumb: false`.
- A `ws-expire` pre-breadcrumb one stays as it is.
- `toMatchObject` and `.failed` reads need nothing.

Re-run the two files: green (`70 passed`, `7 passed`).

- [ ] **Step 5: Mutation check (Part A)**

Each row: make the edit, run the command, see the red, then revert. vitest sources the working `ccd/ccd`, so no re-stamp is needed between rows; Step 6 re-stamps once.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| A1 | Replace `  case "$_WS_RCL_CRUMB" in true\|false) crumb=",\"crumb\":$_WS_RCL_CRUMB" ;; esac` with `  crumb=",\"crumb\":$_WS_RCL_CRUMB"` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-crumb.test.ts` | 5 failed: "omits the key when nothing set it …" (`expected '{"failed":"some-word","detail":"a det…' to be '{"failed":"some-word","detail":"a det…'`), "is assigned when ccd is read", "a breadcrumb that stands but cannot be read", and both ws-expire no-crumb cases |
| A2 | Delete the line `_WS_RCL_CRUMB=''` above `_ws_reclaim_failed_json() {` | same | 3 failed: "is assigned when ccd is read" (`expected '{"failed":"some-word","detail":"d","c…' to be '{"failed":"some-word","detail":"d"}'`), "pre-breadcrumb pin-failed carries NO crumb, even with one exported" (`expected { failed: 'pin-failed', …(2) } to deeply equal { failed: 'pin-failed', …(1) }`), and "its own probe-unmeasured …" (`ccd/ccd: line …: _WS_RCL_CRUMB: unbound variable`) |
| A3 | Change that line to `_WS_RCL_CRUMB=false` (a global default in place of "unsaid") | same `-t 'ws-expire'` | 2 failed: "pre-breadcrumb pin-failed carries NO crumb …" (`to deeply equal { failed: 'pin-failed', …(1) }`) and "its own probe-unmeasured …" (`expected { failed: 'probe-unmeasured', …(2) } to not have property "crumb"`) |
| A4 | In `_ws_reclaim_locked`, delete the line `  elif [[ -e "$REG/$id.reaping" \|\| -L "$REG/$id.reaping" ]]; then _WS_RCL_CRUMB=''` | same `-t 'cannot be read'` | `whether an act started is unknown, so nothing is said: expected { failed: 'probe-unmeasured', …(2) } to not have property "crumb"` |
| A5 | Change `if [[ -n "$phase" ]]; then _WS_RCL_CRUMB=true` to `… _WS_RCL_CRUMB=false` | same `-t 'resumed arm'` | `expected { failed: 'probe-unmeasured', …(2) } to match object { failed: 'probe-unmeasured', …(1) }` |
| A6 | Change `  else _WS_RCL_CRUMB=false; fi` to `  else _WS_RCL_CRUMB=''; fi` | same `-t 'fresh arm'` | 2 failed: "fresh arm, before the breadcrumb: pin-failed …" (`expected { failed: 'pin-failed', …(1) } to deeply equal { failed: 'pin-failed', …(2) }`) and "fresh arm: … probe-unmeasured …" |
| A7 | Delete the tail's `  _WS_RCL_CRUMB=true` (under `# (\`crumb\`, spec §5.6).`) | same `-t 'tail'` | "the SHARED tail says crumb true for an expiry too": `expected { failed: 'unit-still-active', …(1) } to match object { failed: 'unit-still-active', …(1) }` (ws-reclaim's own tail case stays green through row A8's line) |
| A8 | A7's deletion PLUS `_ws_reclaim_locked`'s `    _WS_RCL_CRUMB=true` above `    phase="$start"` | same `-t 'past the breadcrumb'` | `expected { failed: 'unit-still-active', …(2) } to match object { failed: 'unit-still-active', …(1) }` (the locked `false` leaks into the tail). Deleting the locked line ALONE stays green, because the tail's own `true` covers it. That is stated, not a gap |

- [ ] **Step 6: Re-stamp, gates, commit (Part A)**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-tail.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim.test.ts test/ccd-refusal-scan.test.ts test/wsaudit.test.ts test/ccd-review-335-pins.test.ts
```
Expected:
- `restamp: ccd/ccd: restamped`, then `ccd/ccd: ccrc-unmodified`, and ownership is green;
- verb-tail: 74 passed;
- ws-expire-verb: 32 passed (about 134 s alone; run it alone);
- the last line: 151, 11, 25 and 5 passed.

Every existing parser reads named keys only (`parseChildReclaimResult`, `server/src/coord/childReclaim.ts:755`; `archivedExpiry.ts:229`), so the additive key changes no server answer.

```bash
git add ccd/ccd server/test/ccd-child-reclaim-crumb.test.ts server/test/ccd-child-reclaim-verb.test.ts \
  server/test/ccd-child-reclaim-unmeasured-journal.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): a failed document says whether it was printed past the breadcrumb

ws-reclaim's failure documents gain an additive "crumb" key: false on the
fresh arm before the breadcrumb is written, true on a resumed arm and in the
shared tail (both verbs), and absent where nothing is known — a breadcrumb
that stands but cannot be read, and every document ws-expire prints before its
own breadcrumb (its locked body is not edited). Only the two literals are ever
printed, and the global is assigned when ccd is read, so an exported value
never reaches a document. "true" means the act had started (its breadcrumb
was written), never that a breadcrumb stands now. The journal rows are
unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

#### Part B — the capped permission-pass reason

- [ ] **Step 7: Write the failing test**

Create `server/test/ccd-child-reclaim-why-cap.test.ts`:

```ts
// `_WS_NORMALISE_WHY` is cut to ONE line a journal row can carry (child
// reclamation spec §5.5, rung 8's permission pass): printable ASCII, 300 bytes,
// the cut marked "…", through wave 6's one cutter `_ws_leaf_why_line`. It can
// carry a name the SESSION chose — the entry still unreadable after the pass —
// and raw, a long or non-UTF-8 name grows six-fold at the journal's encoder,
// which then drops `detail`, `verb` and every `dec.*` but the surface to fit
// its line cap. No token reads it, so no token changes.
// FIXTURE HOMEs ONLY: every ccd call runs through the harness, never against $HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { decOf, eventsOf } from './lifecycleHelpers.js';
import { CHILD_ID, childReclaimVerb, makeChild } from './childReclaimFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-why-cap-'); });
afterEach(() => { h.cleanup(); });

/** A name the session chose: control bytes, and 240 bytes that are no UTF-8 (each reaches the encoder as six). */
const NAME = Buffer.concat([Buffer.from('evil\t\x1b\x7f\x01'), Buffer.alloc(120, 0x80), Buffer.alloc(120, 0xff)]);
/** A `chmod` that exits 0 and changes nothing — the shape of an entry another uid owns, which this uid cannot fix
 *  (`ccd-child-reclaim-ladder.test.ts`'s own shim). `find -exec` resolves chmod on PATH. */
const shimChmod = (): string => {
  const shim = path.join(h.home, 'shim');
  fs.mkdirSync(shim, { recursive: true });
  fs.writeFileSync(path.join(shim, 'chmod'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return `PATH="${shim}:$PATH";`;
};
/** A mode-000 directory under `dir` named NAME; returns its path, as bytes. */
const lockedUnder = (dir: string): Buffer => {
  const p = Buffer.concat([Buffer.from(`${dir}/`), NAME]);
  fs.mkdirSync(p);
  fs.writeFileSync(Buffer.concat([p, Buffer.from('/x')]), 'x');
  fs.chmodSync(p, 0o000);
  return p;
};
const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
const printableThenMark = (s: string): void => {
  expect(s.endsWith('…'), 'a cut is marked').toBe(true);
  expect(s.slice(0, -1), 'printable ASCII only').toMatch(/^[\x20-\x7e]*$/);
};

describe('_ws_reclaim_normalise: every reason it sets is one capped line', () => {
  it('rc 1 (an entry still unreadable after the pass) — the session-chosen name is cut, the rc unchanged', () => {
    const { wt } = makeChild(h);
    const locked = lockedUnder(wt);
    try {
      const out = h.sh(`${shimChmod()} _ws_reclaim_normalise "${wt}"; printf '%s\\x1f%s' "$?" "$_WS_NORMALISE_WHY"`);
      const [rc = '', why = ''] = out.split('\x1f');
      expect(rc).toBe('1');
      expect(bytes(why), why).toBeLessThanOrEqual(303);
      expect(why.startsWith(`${fs.realpathSync(wt)}/evil?`) || why.startsWith(`${wt}/evil?`), why).toBe(true);
      printableThenMark(why);
    } finally { fs.chmodSync(locked, 0o755); }
  }, 60_000);

  it.each([
    ['the pass ran out of time (124)', 124],
    ['the pass did not run to the end (125)', 125],
  ] as const)('rc 2, %s — a long directory path is cut too', (_what, code) => {
    const long = Buffer.concat([Buffer.from(`${h.home}/`), NAME]);
    fs.mkdirSync(long);
    const out = h.sh(`_plat_timeout() { return ${code}; }; d=$(printf '%s' "$HOME"/evil*);`
      + ` _ws_reclaim_normalise "$d"; printf '%s\\x1f%s' "$?" "$_WS_NORMALISE_WHY"`);
    const [rc = '', why = ''] = out.split('\x1f');
    expect(rc).toBe('2');
    expect(why.startsWith('the permission pass over '), why).toBe(true);
    expect(bytes(why), why).toBeLessThanOrEqual(303);
    printableThenMark(why);
  }, 30_000);
});

describe('the ladder’s refusal row keeps its verb and its decision (spec §5.9)', () => {
  it('tree-unreadable over a session-chosen name: verb, dec.actor and detail survive, uncut by the encoder', () => {
    const { wt } = makeChild(h);
    const locked = lockedUnder(wt);
    try {
      const r = childReclaimVerb(h, '0'.repeat(64), {
        pre: shimChmod(), extra: "--surface agent --actor 'run:7 reclaim close' --reason why-cap",
      });
      expect(r.code, r.stderr).toBe(0);
      const doc = JSON.parse(r.stdout) as { refused: string; detail: string };
      expect(doc.refused).toBe('tree-unreadable');
      const row = eventsOf(h.home, 'reclaim').filter((e) => e['outcome'] === 'refused').pop()!;
      expect(row['refusal']).toBe('tree-unreadable');
      expect(row['truncated'], 'the row was never cut down to fit').toBeUndefined();
      expect(row['verb']).toBe('ws-reclaim');
      expect(decOf(row)['actor']).toBe('run:7 reclaim close');
      expect(decOf(row)['reason']).toBe('why-cap');
      expect(row['detail'], 'the journal and the document carry one detail').toBe(doc.detail);
      expect(doc.detail.startsWith(`${wt} cannot be read: `), doc.detail).toBe(true);
      printableThenMark(doc.detail);
    } finally { fs.chmodSync(locked, 0o755); }
    expect(h.reg(CHILD_ID, 'reaping'), 'a refusal starts nothing').toBeNull();
  }, 90_000);
});
```

- [ ] **Step 8: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-why-cap.test.ts
```
Expected: `Tests  4 failed (4)`.
- The rc-1 case: `… is still unreadable after the permission pass find: '…': Permission denied: expected <n> to be less than or equal to 303` (n is about 1900; it depends on HOME's length).
- The two rc-2 cases: `… did not finish within 30s: expected <n> to be less than or equal to 303` (n is about 820), and the `(rc 125)` twin.
- The verb case: `the row was never cut down to fit: expected true to be undefined`. This is the measured loss. Today's row falls to the encoder's last-resort line, with no `verb`, no `detail` and no `dec.actor`.

- [ ] **Step 9: Implement**

In `_ws_reclaim_normalise` (:25811), insert directly above `  # \`-user\` GOVERNS BOTH ARMS, so the disjunction is parenthesised as a whole:`:

```bash
  # EVERY REASON IS ONE CAPPED LINE (spec §5.5, §5.9): `$left` is a name the
  # session chose and `$d` a path, and a long or non-UTF-8 one, raw, grows at
  # the journal's encoder until the refusal row loses its `detail`, `verb` and
  # `dec.*`. So each reason that carries one goes through `_ws_leaf_why_line`
  # (printable ASCII, 300 bytes, the cut marked). The two fixed sentences are
  # short ASCII already. No token reads this reason.
  #
```

Then change the three assignments that interpolate:

```bash
    rm -f "$errf"; _WS_NORMALISE_WHY=$(_ws_leaf_why_line "the permission pass over $d did not finish within ${REAP_SCAN_SECONDS}s"); return 2
```
```bash
    rm -f "$errf"; _WS_NORMALISE_WHY=$(_ws_leaf_why_line "the permission pass over $d did not run to completion (rc $rc)"); return 2
```
```bash
    _WS_NORMALISE_WHY=$(_ws_leaf_why_line "${left:+$left is still unreadable after the permission pass}${left:+ }$(head -1 "$errf" 2>/dev/null)")
```

The two constant sentences (`'could not read this uid'`, `'could not make a scratch file'`) stay as they are.

- No token reads `_WS_NORMALISE_WHY`: `grep -n '_WS_NORMALISE_WHY' ccd/ccd` lists only the function, the six ladder sites (:27125-27129, :27289-27290) and `_ws_leaf_remove`'s two (:29404-29405). None of them is a fingerprint input.
- The tail's second cut (`_ws_leaf_why_line "$_WS_LEAF_WHY"`, :30013-30061) over a reason already cut answers byte for byte what one cut of the raw reason answered. The first cut leaves 300 clean bytes followed by `…`. The re-cut maps the `…` to `???` past byte 300 and drops it, so `ccd-leaf-remove` is unchanged.

- [ ] **Step 10: Run it to pass, and the suites that read the reason**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-why-cap.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-leaf-remove.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-ladder.test.ts
```
Expected: 4, 145, 43 and 55 passed (`ccd-leaf-remove` takes about 86 s and `ccd-ws-expire-ladder` about 98 s; run each alone).

- [ ] **Step 11: Mutation check (Part B)**

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| B1 | Restore the rc-1 arm to `    _WS_NORMALISE_WHY="${left:+$left is still unreadable after the permission pass}${left:+ }$(head -1 "$errf" 2>/dev/null)"` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-why-cap.test.ts` | 2 failed: the rc-1 case (`expected <~1900> to be less than or equal to 303`) and the verb case (`the row was never cut down to fit: expected true to be undefined`) |
| B2 | Restore the 124 arm to `_WS_NORMALISE_WHY="the permission pass over $d did not finish within ${REAP_SCAN_SECONDS}s"` | same `-t 'rc 2'` | "rc 2, the pass ran out of time (124)": `expected <~820> to be less than or equal to 303` |
| B3 | Restore the rc arm to `_WS_NORMALISE_WHY="the permission pass over $d did not run to completion (rc $rc)"` | same `-t 'rc 2'` | "rc 2, the pass did not run to the end (125)": `expected <~830> to be less than or equal to 303` |

- [ ] **Step 12: Re-stamp, gates, commit (Part B)**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts
git add ccd/ccd server/test/ccd-child-reclaim-why-cap.test.ts
git commit -m "$(cat <<'MSG'
fix(ccd): the permission pass's reason is one capped line

_WS_NORMALISE_WHY can carry a name the session chose and a line of find's
stderr. Raw, a long or non-UTF-8 name grew at the journal encoder until a
tree-unreadable refusal row fell to its last-resort line and lost its
detail, verb and decision. Every reason that interpolates a path now goes
through the tail's one cutter (printable ASCII, 300 bytes, the cut marked).
No token reads the reason.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

#### Part C — rung 8's silent omission, on both arms, and the all-zero recorded HEAD

- [ ] **Step 13: Write the failing test**

Create `server/test/ccd-child-reclaim-silent-omission.test.ts`:

```ts
// Git's SILENCE is asked before it is believed (child reclamation spec §5.5,
// rung 8's rule: a read that failed measured nothing). `git worktree list
// --porcelain` exits 0 and OMITS the stanza of a record whose admin `gitdir` it
// cannot read — and every linked stanza when `worktrees/` cannot be listed
// (measured, git 2.43). So the ladder's "no record" proves nothing until git's
// admin entries are read whole, through `_ws_reclaim_log_of`'s own walk:
//   - an entry that could not be read            -> unmeasured (retried);
//   - an entry that names the tree git omitted   -> unmeasured (retried);
//   - no entry names it, every entry read        -> no-worktree-record (TERMINAL), as before.
// The ladder is SHARED: the change reaches `ws-expire` too (a case below). And
// the vanished arm, where "no record" proceeds, takes the same ask. There, too,
// a record git lists with the all-zero HEAD (its admin `HEAD` unreadable) names
// no commit that was read, so it is unmeasured, never the head the pin keeps.
// FIXTURE HOMEs ONLY: every ccd call runs through the harness, never against $HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import { CHILD_STUBS, CHILD_ID, evalOf, makeChild } from './childReclaimFixture.js';
import { expireAudit, expireEvalOf, makeArchived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-omission-'); });
afterEach(() => { h.cleanup(); });

/** git's admin entry for a workspace: `<main>/.git/worktrees/<basename of its tree>`. */
const adminOf = (main: string, slug: string): string => path.join(main, '.git', 'worktrees', slug);
/** Chmod `p` to `mode` for the body, and back to 0755/0644 after, whatever the body did. */
const withMode = <T>(p: string, mode: number, body: () => T): T => {
  const restore = fs.statSync(p).isDirectory() ? 0o755 : 0o644;
  fs.chmodSync(p, mode);
  try { return body(); } finally { fs.chmodSync(p, restore); }
};
/** git's list omits the record although every admin entry reads: the shape no chmod makes, stubbed at its one reader. */
const LIST_OMITS = '_ws_reclaim_record() { RECLAIM_REC_BRANCH=; RECLAIM_REC_HEAD=; RECLAIM_REC_MAIN=0; RECLAIM_REC_PRUNABLE=0; return 1; };';

describe('the ladder’s record check, over a STANDING tree', () => {
  it('the CONTROL: git lists the record, so the child is reclaimable', () => {
    makeChild(h);
    expect(evalOf(h).verdict).toBe('reclaimable');
  }, 60_000);

  it('the admin entry’s gitdir is unreadable: git omits it, and the ladder answers unmeasured — never no-worktree-record', () => {
    const { main } = makeChild(h);
    const r = withMode(path.join(adminOf(main, 'quiet-basin'), 'gitdir'), 0o000, () => evalOf(h));
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain('gitdir cannot be read');
  }, 60_000);

  it('worktrees/ cannot be listed: git omits every linked record, and the ladder answers unmeasured', () => {
    const { main } = makeChild(h);
    const r = withMode(path.join(main, '.git', 'worktrees'), 0o000, () => evalOf(h));
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain('cannot be listed');
  }, 60_000);

  it('an entry that reads and names the tree, while git’s list printed none: unmeasured — git omitted a record that exists', () => {
    makeChild(h);
    const r = evalOf(h, { pre: LIST_OMITS });
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain('omitted a record that exists');
  }, 60_000);

  it('the TERMINAL word stands where nothing names the tree: the admin entry is gone, every other entry read', () => {
    const { main } = makeChild(h);
    fs.rmSync(adminOf(main, 'quiet-basin'), { recursive: true, force: true });
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('no-worktree-record');
  }, 60_000);

  it('the audit journals the unmeasured answer as a failed probe-unmeasured line (retried), never the terminal refusal', () => {
    const { main } = makeChild(h);
    const r = withMode(path.join(adminOf(main, 'quiet-basin'), 'gitdir'), 0o000,
      () => h.run(`${CHILD_STUBS} _session_verdict() { echo gone; }; cmd_ws_audit --session ${CHILD_ID} --reclaim`));
    expect(r.code, r.stdout).toBe(1);
    expect((JSON.parse(r.stdout) as Record<string, unknown>)['verdict']).toBe('unmeasured');
    expect(eventsOf(h.home, 'reclaim').map((e) => [e['outcome'], e['refusal'], e['verb']]))
      .toEqual([['failed', 'probe-unmeasured', 'ws-audit']]);
  }, 60_000);
});

describe('the vanished arm: "no record" proceeds there, so it takes the same ask', () => {
  it('the CONTROL: a gone tree git still records (prunable) is reclaimable over what is left', () => {
    const { wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    expect(evalOf(h).verdict).toBe('reclaimable');
  }, 60_000);

  it('a gone tree whose admin gitdir is unreadable: unmeasured — today it read reclaimable with record=1', () => {
    const { main, wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    const r = withMode(path.join(adminOf(main, 'quiet-basin'), 'gitdir'), 0o000, () => evalOf(h));
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
  }, 60_000);

  it('a gone tree with worktrees/ unlistable: unmeasured', () => {
    const { main, wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    const r = withMode(path.join(main, '.git', 'worktrees'), 0o000, () => evalOf(h));
    expect(r.verdict, r.detail).toBe('unmeasured');
  }, 60_000);

  it('a gone tree whose record git lists with the all-zero HEAD (its admin HEAD unreadable): unmeasured, never pinned', () => {
    const { main, wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    const r = withMode(path.join(adminOf(main, 'quiet-basin'), 'HEAD'), 0o000, () => evalOf(h));
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain('all-zero HEAD');
  }, 60_000);

  it('a gone tree git truly no longer records (pruned), every entry read: still reclaimable', () => {
    const { main, wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    h.git(main, 'worktree', 'prune');
    expect(evalOf(h).verdict).toBe('reclaimable');
  }, 60_000);
});

describe('`_ws_reclaim_log_of`’s gone arm asks the SAME walk it always did', () => {
  it('a gone checkout whose admin gitdir is unreadable fails to locate its reflog (rc 1)', () => {
    const { main, wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    const out = withMode(path.join(adminOf(main, 'quiet-basin'), 'gitdir'), 0o000,
      () => h.sh(`_WS_LOGS=(); _ws_reclaim_log_of "${main}" tree "${wt}" 0; printf '%s' "$?"`));
    expect(out).toBe('1');
  }, 60_000);
});

describe('ws-expire runs the same ladder, so it answers the same', () => {
  it('an archived workspace whose admin gitdir is unreadable: expiry unmeasured (exit 1, journaled nowhere), never no-worktree-record', () => {
    const { main } = makeArchived(h);
    const gitdir = path.join(adminOf(main, 'quiet-dune'), 'gitdir');
    const r = withMode(gitdir, 0o000, () => expireEvalOf(h));
    expect(r.verdict, r.detail).toBe('unmeasured');
    const a = withMode(gitdir, 0o000, () => expireAudit(h));
    expect(a.code, a.stdout).toBe(1);
    expect((JSON.parse(a.stdout) as Record<string, unknown>)['verdict']).toBe('unmeasured');
    expect(eventsOf(h.home, 'expire'), 'an expiry’s unmeasured answer is journaled nowhere').toEqual([]);
  }, 90_000);
});
```

- [ ] **Step 14: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-silent-omission.test.ts
```
Expected: `Tests  8 failed | 5 passed (13)`.
- The three standing-tree cases (gitdir, `worktrees/`, list-omits) red with `<main> has no worktree record for <wt>: expected 'no-worktree-record' to be 'unmeasured'`.
- The audit case reds with `expected +0 to be 1`: today the audit exits 0 with a terminal refusal.
- The three vanished cases (admin `gitdir`, `worktrees/`, and the all-zero HEAD) red with `expected 'reclaimable' to be 'unmeasured'`. The all-zero case's red is drafted from the measured table row (`0 (HEAD 0000000) / 0`, tree gone); if it is green here, STOP and report, because the guard would then pin nothing.
- The expiry case reds with `… worktrees/demo/quiet-dune: expected 'no-worktree-record' to be 'unmeasured'`.
- Green already:
  - both CONTROLS;
  - the TERMINAL case (admin entry removed);
  - the pruned vanished case;
  - the `_ws_reclaim_log_of` gone-arm case, which pins the walk this task moves.

- [ ] **Step 15: Extract the walk (no behaviour change)**

In `_ws_reclaim_log_of` (:28029), change the `local` line (:28057) to:

```bash
  local main="$1" kind="$2" arg="$3" recorded="${4:-0}" common f gd rc
```

Replace everything from `  _ws_reclaim_absent "$common/worktrees"; rc=$?` (:28084) to the function's closing `}` (:28110) with one call and a new function. Move the original lines into its body UNCHANGED, the `for d in …` loop and the `(( n || ! recorded ))` check included:

```bash
  _ws_reclaim_admin_entries "$common" "$arg" "$recorded"
}

_ws_reclaim_admin_entries() {   # common path recorded -> 0 with `<d>/logs/HEAD` and `gitdir:<d>` appended to
  #                                  _WS_LOGS for every <common>/worktrees/<d> whose `gitdir` names <path>/.git (as
  #                                  given, or resolved); 1 (_WS_KEEP_WHY) when `worktrees/` or an entry could not
  #                                  be read, or `recorded` is 1 and no entry names it
  # GIT'S ADMIN ENTRIES, READ WHOLE — `_ws_reclaim_log_of`'s walk of a gone
  # checkout, and the ONE matcher of an entry to a path: the ladder asks it
  # too, of a STANDING tree git's list printed no record of
  # (`_ws_reclaim_no_record`). `_ws_reclaim_log_of` says why each refusal here
  # is a failure and never "no entry".
  local common="$1" arg="$2" recorded="${3:-0}" d g real rc n=0
  _ws_reclaim_absent "$common/worktrees"; rc=$?
  #   … the original lines :28085-:28109, byte for byte, ending:
  (( n || ! recorded )) \
    || { _WS_KEEP_WHY="git records a checkout at $arg, but no $common/worktrees/*/gitdir entry names $arg/.git — its HEAD reflog could not be located, so it was never read"; return 1; }
  return 0
}
```

Verify that the move is byte-exact: `diff <(git show HEAD:ccd/ccd | sed -n '/^_ws_reclaim_log_of() {/,/^}$/p' | sed -n '/_ws_reclaim_absent "\$common\/worktrees"; rc=\$?/,/^  return 0$/p') <(sed -n '/^_ws_reclaim_admin_entries() {/,/^}$/p' ccd/ccd | sed -n '/_ws_reclaim_absent "\$common\/worktrees"; rc=\$?/,/^  return 0$/p')` prints nothing.

`ccd-child-reclaim-hardening.test.ts:628`'s source slice (`_ws_reclaim_log_of() {` to `_ws_reclaim_reflog_ids() {`) still holds the standing arm unchanged, and its "no inline gitdir read" pin reads only the standing sub-slice.

- [ ] **Step 16: Implement the ask, the two call sites, and the all-zero-HEAD guard**

Directly above `_ws_reclaim_reflog_ids() {`, insert:

```bash
_WS_NOREC_WHY=''
_ws_reclaim_no_record() {   # common workdir -> 0 when NO admin entry of the repository whose common dir is
  #                              common names <workdir>/.git, every entry read; 1 (_WS_NOREC_WHY) when one does —
  #                              git's list omitted a record that exists; 2 (_WS_NOREC_WHY) when `worktrees/` or
  #                              an entry could not be read
  # GIT'S "NO RECORD" IS BELIEVED ONLY ONCE ITS ADMIN ENTRIES ARE READ (spec
  # §5.5, rung 8's rule: a read that failed measured nothing). `git worktree
  # list` exits 0 and OMITS the stanza of a record whose `gitdir` it cannot
  # read — every linked stanza when `worktrees/` cannot be listed (measured,
  # git 2.43) — so `_ws_reclaim_record`'s rc 1 alone reads an unreadable
  # record as none. Asked of the entries themselves, through the one matcher
  # (`_ws_reclaim_admin_entries`), whether the tree stands or is gone. Its
  # readers' globals are shadowed: asking this changes nothing a caller read.
  local common="$1" w="$2" e
  local -a _WS_LOGS=()
  local _WS_KEEP_WHY=''
  _WS_NOREC_WHY=''
  _ws_reclaim_admin_entries "$common" "$w" 0 \
    || { _WS_NOREC_WHY="$_WS_KEEP_WHY — git's worktree list leaves out a record it cannot read, so its silence about $w measured nothing"; return 2; }
  for e in ${_WS_LOGS[@]+"${_WS_LOGS[@]}"}; do
    [[ "$e" == gitdir:* ]] || continue
    _WS_NOREC_WHY="${e#gitdir:} names $w/.git, but git's worktree list printed no record of it — the list omitted a record that exists"
    return 1
  done
  return 0
}
```

The ladder (:27063-27064). Replace

```bash
  (( rc == 0 )) \
    || { _reap_refuse no-worktree-record "$main has no worktree record for $workdir"; return 1; }
```
with
```bash
  # A list that printed NO record is believed only once git's admin entries
  # are read (`_ws_reclaim_no_record`): an entry it could not read, or one that
  # names this tree, is unmeasured and retried, never the terminal word.
  if (( rc != 0 )); then
    _ws_reclaim_no_record "$mainreal" "$workdir" \
      || { _ws_reclaim_unmeasured "$_WS_NOREC_WHY"; return 1; }
    _reap_refuse no-worktree-record "$main has no worktree record for $workdir"; return 1
  fi
```

(`rc` is 0 or 1 there, because rc 2 already answered unmeasured at :27055-27056. `mainreal` is the ladder's own `_ws_common_dir "$main"`, :27052.)

The vanished arm (`_ws_reclaim_eval_absent`, :27244). Directly under its `(( rec == 2 ))` unmeasured line (:27268-27269), insert:

```bash
  # "No record" is an INPUT here (`record=1`), and with it the pin keeps no
  # HEAD of git's record — so it is believed only once git's admin entries are
  # read (`_ws_reclaim_no_record`), exactly as on the present arm.
  if (( rec == 1 )); then
    _ws_reclaim_no_record "$mainreal" "$workdir" \
      || { _ws_reclaim_unmeasured "$_WS_NOREC_WHY"; return 1; }
  fi
  # AN ALL-ZERO HEAD NAMES NO COMMIT THAT WAS READ (spec §5.5, rung 8's rule):
  # git lists a record whose admin `HEAD` it cannot read with the null id. As
  # the pin's recorded head it would bind the token, then stop the pin; so it
  # is unmeasured here, at the one read of `RECLAIM_REC_HEAD`, and retried.
  if (( rec == 0 )) && [[ "$RECLAIM_REC_HEAD" =~ ^0+$ ]]; then
    _ws_reclaim_unmeasured "git's worktree record of $workdir names the all-zero HEAD — git lists a record whose admin HEAD it cannot read that way, so the commit it holds was never read"
    return 1
  fi
```

(`mainreal` is the arm's own, :27265. `_ws_reclaim_no_record` never touches `RECLAIM_REC_*`, which the arm reads on the next lines.)

The all-zero guard sits at `RECLAIM_REC_HEAD`'s ONE read. Confirm that on your tree: `grep -n 'RECLAIM_REC_HEAD' ccd/ccd` lists the resets, `_ws_reclaim_record`'s header and parser, two `local` shadows, and exactly one line that reads it, `wthead="$RECLAIM_REC_BRANCH"; RECLAIM_HEAD="$RECLAIM_REC_HEAD"`, directly below the guard. If Task 1 or any other change added a second reader, guard it the same way, or STOP and report. `^0+$` matches the SHA-1 and the SHA-256 null id alike, and never `''` (no `HEAD` line, so no record HEAD).

Then measure what `git update-ref` does with a zero value today (ruling T2 OPEN5), in a THROWAWAY repository, never the live one or a fixture HOME's:

```bash
z=$(mktemp -d) && git -C "$z" init -q \
  && git -C "$z" -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m x
sha=$(git -C "$z" rev-parse HEAD); zero=$(printf '0%.0s' {1..40})
git -C "$z" update-ref "refs/ccrc/attic/t/$sha" "$sha"
git -C "$z" update-ref "refs/ccrc/attic/t/$sha" "$zero"; echo "rc=$?"; git -C "$z" for-each-ref refs/ccrc/
git -C "$z" cat-file -e "$zero^{commit}" 2>/dev/null; echo "rc=$?"
rm -rf "$z"
```

Expected (measured with git 2.43.0): `rc=0` and NOTHING listed, because a zero new value DELETES the ref it names; then `rc=128`, which is `_ws_reclaim_attic_extra`'s `cat-file -e "${sha}^{commit}"` refusing the zero id before its `update-ref` runs. Re-read `_ws_reclaim_attic_extra` on your tree and confirm that check still precedes the `update-ref`. Step 22 states both results.

- [ ] **Step 17: Run it to pass, and every suite that reaches the ladder, the record or the walk**

Run each line on its own, in the foreground, with a timeout of at least 600000 ms. The figures are measured at `b0647d850` plus this task:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-silent-omission.test.ts      # 13 passed, ~15 s
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts               # 145 passed
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-recovery.test.ts             # 25 passed
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-hardening.test.ts            # 98 passed
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-reflogs.test.ts         # 49 passed, ~242 s: ALONE
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-gone-branch.test.ts          # 26 passed
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts                # 23 passed, ~64 s
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-leaf-rows.test.ts test/ccd-child-reclaim-leaf-moved.test.ts test/ccd-child-reclaim-leaf-moved-expire.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-ladder.test.ts                   # 55 passed, ~98 s
cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-audit.test.ts                    # 20 passed
cd server && ./node_modules/.bin/vitest run test/ccd-ws-audit.test.ts                           # 141 passed | 4 skipped, ~346 s: ALONE
```

- `ccd-ws-audit` sits near the ceiling. If it is killed, re-run it alone on an idle box; it is a ws-reap suite that sources the same file.
- The existing `no-worktree-record` case ("refuses no-worktree-record — TERMINAL — …", `ccd-child-reclaim-ladder.test.ts`) stays green: its admin entry is REMOVED, so no entry names the tree.

- [ ] **Step 18: Mutation check (Part C)**

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| C1 | Restore the ladder's two original lines `(( rc == 0 )) \` / `    \|\| { _reap_refuse no-worktree-record "$main has no worktree record for $workdir"; return 1; }` in place of the `if (( rc != 0 )); then … fi` block | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-silent-omission.test.ts` | 5 failed: the gitdir, worktrees/ and list-omits cases (`expected 'no-worktree-record' to be 'unmeasured'`), the audit case (`expected +0 to be 1`) and the ws-expire case |
| C2 | In `_ws_reclaim_no_record`, replace `    \|\| { _WS_NOREC_WHY="$_WS_KEEP_WHY — git's worktree list leaves out …"; return 2; }` with `    \|\| return 0` | same | 6 failed: both standing unreadable cases, the audit case, both vanished unreadable cases (`expected 'reclaimable' to be 'unmeasured'`) and the ws-expire case. Only the list-omits case stays green |
| C3 | In `_ws_reclaim_no_record`'s loop, replace `    [[ "$e" == gitdir:* ]] \|\| continue` with `    continue` | same `-t 'omitted a record'` | `expected 'no-worktree-record' to be 'unmeasured'` |
| C4 | Delete the vanished arm's `  if (( rec == 1 )); then … fi` block | same `-t 'vanished arm'` | 2 failed: "a gone tree whose admin gitdir is unreadable" and "… worktrees/ unlistable" (`expected 'reclaimable' to be 'unmeasured'`) |
| C5 | In `_ws_reclaim_log_of`, replace `  _ws_reclaim_admin_entries "$common" "$arg" "$recorded"` with `  return 0` | same `-t 'gone arm'` | `expected '0' to be '1'` |
| C6 | Make `_ws_reclaim_no_record` always unmeasured: insert `  _WS_NOREC_WHY=x; return 2` above its `_ws_reclaim_admin_entries` call | same `-t 'TERMINAL\|pruned'` | 2 failed: "the TERMINAL word stands …" (`x: expected 'unmeasured' to be 'no-worktree-record'`) and "… (pruned) …: still reclaimable" (`expected 'unmeasured' to be 'reclaimable'`) |
| C7 | Delete the vanished arm's guard `  if (( rec == 0 )) && [[ "$RECLAIM_REC_HEAD" =~ ^0+$ ]]; then … fi` (four lines) | same `-t 'all-zero'` | "a gone tree whose record git lists with the all-zero HEAD …": `expected 'reclaimable' to be 'unmeasured'` (drafted from the measured table row; measure it) |
| C8 | Change `[[ "$RECLAIM_REC_HEAD" =~ ^0+$ ]]` to `[[ "$RECLAIM_REC_HEAD" =~ ^0* ]]` (matches every head) | same `-t 'vanished arm'` | the CONTROL "a gone tree git still records (prunable) is reclaimable …": `expected 'unmeasured' to be 'reclaimable'` (the pruned case stays green: its `rec` is 1). Drafted, not measured; measure it |

- [ ] **Step 19: Re-stamp, gates, commit (Part C)**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts
git add ccd/ccd server/test/ccd-child-reclaim-silent-omission.test.ts
git commit -m "$(cat <<'MSG'
fix(ccd): git's "no worktree record" is believed only once its entries are read

git worktree list exits 0 and silently omits a record whose admin gitdir it
cannot read (every linked record when worktrees/ cannot be listed). The
reclaim and expiry ladder read that as no record: the terminal
no-worktree-record over a standing tree, and record=1 on the vanished arm,
which then stopped pin-failed at the pin. Both now read git's admin entries
through log_of's own walk (moved, unchanged, into _ws_reclaim_admin_entries):
an entry that cannot be read, or one naming the tree, answers unmeasured and
is retried; only a tree no entry names keeps no-worktree-record. No arm
reaches the pin that did not before; the vanished arm stops earlier.
The vanished arm also answers unmeasured on a record git lists with the
all-zero HEAD (an admin HEAD it cannot read), instead of binding that id
as the head the pin keeps.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

- [ ] **Step 20: The whole task's gates**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'   # 13 passed
(cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts -t 'ccd/ccd carries no un-shimmed GNU call')
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p .
```
All are green. The citation case is untouched because no edit lies above ccd/ccd:19109 except line 2's stamp. If it reds, STOP and report: a frozen-corpus census is never adjusted here.

- [ ] **Step 21: The untouched regions, re-measured**

Re-run Step 0's four commands. Each prints exactly what it printed before Step 1:
- `_ws_expire_locked`'s hash and `_ws_reclaim_record`'s hash unchanged;
- the `_reg_get` count unchanged;
- the platform layer's hash unchanged.

A difference is a defect of this task, never a figure to update.

- [ ] **Step 22: Wave-done notes (for the coordinator and quiet-river)**

Name these five in the wave-done, for workspace-lifecycle:
- `crumb` is absent on `ws-expire`'s pre-breadcrumb documents and `true` on its tail's.
- Over a standing tree, rung 8's silent omission now answers `unmeasured` (expiry audit exit 1, journaled nowhere) where it answered `no-worktree-record`.
- On the vanished arm, a silent omission now answers `unmeasured` where the ladder minted a token over `record=1` and the verb then stopped `pin-failed` at its pin.
- On the vanished arm, a record git lists with the all-zero HEAD (an admin `HEAD` it cannot read) now answers `unmeasured` where the ladder minted a token over `head=0000…` and the verb then stopped `pin-failed` at its pin (ruling T2 OPEN5).
- The permission-pass reason is capped.

On reclaim, the omission shape now journals one `failed probe-unmeasured` per audit pass, which R20's backoff bounds and wave 8's pacing tier carries.

**What a zero id does at `update-ref` (its own paragraph, ruling T2 OPEN5).** State Step 16's measurement: `git update-ref <ref> <all-zero id>` exits 0 and DELETES the ref it names. Before this task no zero id reached it: `_ws_reclaim_attic_extra` asks `cat-file -e "<id>^{commit}"` first (rc 128 on the zero id), and the one ref such a call would name, `refs/ccrc/attic/<id>/<all-zero id>`, is one no pin creates, so no existing attic ref could be deleted through it. After this task the vanished arm answers `unmeasured` on such a record before any pin runs. If your measurement differs (a zero id reaches `update-ref`, or any attic ref was deleted), say so here and STOP for a ruling.

`crumb:true` means "printed past the act's breadcrumb: the act had started", never "a breadcrumb stands now" (ruling T2 OPEN4); wave 8's reader takes it so. A stray non-directory entry under `<common>/worktrees/` now also holds every silent-omission ask unmeasured; Task 10 widens the existing stray-entry residual sentence to say so (ruling T2 OPEN6).

---

### Task 3: X1's ccd half — the reclaim token binds the row's generation

**Model routing:** **`opus`, effort `high`**. This is SAFETY-critical: it changes the consent check of `ws-reclaim`, the destructive verb, which is the token recomputed and compared inside the reap lock. Wave 7's SAFETY panel reads this diff with R69 and R70 (contract R70, "The SAFETY bound").

**Why:** Contract R65 gives wave 7 the ccd half of X1. The reclaim token must bind the workspace's GENERATION, a value minted with the row and never rotated by `/clear` or a swap. Then a token that `ws-audit --reclaim` minted over one row can never be spent on a re-mint of the same id, even when every other input matches. The pre-flight found that every other token input (tip, status digest, clips manifest and the rest) can match across a same-run re-mint of a recycled slug. The audit document also gains an additive `generation` key, which wave 8's server half reads to key its queued licence (R65, wave 8). Nothing in this task touches server code.

**Task 0's measurement: `$REG/<id>.generation` IS the value.** This was measured by reading the code at `b0647d850`, and Step 2's first case re-measures it in a fixture HOME. Line numbers are at `b0647d850`; locate each one by its grep.

- **It is written in exactly two places.**
  - (1) `_reg_generation_mint`'s no-clobber `link "$src" "$p"` (ccd/ccd:3804; `grep -n 'link "\$src" "\$p"' ccd/ccd`). The only way to reach it is `_reg_generation_init` (ccd/ccd:3814; `grep -n '^_reg_generation_init()' ccd/ccd`), which mints ONLY on genuine absence (`0) return 0 ;;` for a present valid value, `1) return 1 ;;` for a present invalid one, which is never repaired).
  - (2) `_reg_purge`'s generation-LAST unlink, `rm -f "$REG/$id.generation"` (ccd/ccd:4091).
  - `ccd/session-hook.sh` only reads it (`_hook_generation_ok`, session-hook.sh:1303).
  - Both write sites are already pinned by `server/test/session-hook.test.ts`'s canonical-write census, entries 13 and 15, in the case `'the found set EQUALS the allow-list'`. So a third writer reds that census.
- **The `_reg_generation_init` callers** (`grep -n '_reg_generation_init "' ccd/ccd`) are:
  - `cmd_ws_add` (:7278). It mints before any row field and DIES on any failure. It writes `.child` later, at :7366 (`grep -n '_reg_set "\$id" child "\$lc_child"' ccd/ccd`), and that is the only `.child` writer. So every child row carries a generation from birth.
  - `cmd_ws_restore` (:10452), `cmd_start` (:22345) and `cmd_ensure` (:22572).
  - All four mint only into absence. So a respawn, a restore, a swap (whose tail reaches `cmd_ensure`) and a compaction never rotate a present generation.
- **A swap does not touch it.** `cmd_swap` (ccd/ccd:24832) writes `wrapper`, `lastswap`, `swappin` and `supervised` (:25128 and nearby), never the generation, and calls no `_reg_purge`.
- **`/clear` does not touch it.** The hook's `SessionStart source=clear` arm (session-hook.sh:3019) writes nothing to it.
- **The `uuid` is NOT the value.** `_sync_uuid` (ccd/ccd:15813) rewrites `$REG/<id>.uuid` within a row: "Claude Code rotates the active session uuid during normal operation (/clear, compaction)".
- **Only `_reg_purge` (ccd/ccd:3849) removes it.** Its callers are `ws-rm` (:7935), `ws-reap` (:14892), `ws-gc --prune` (:15474), `forget` (:25469) and the reclaim/expire tail (:30075). Each of them ends a row. A later row on the same id is minted afresh with a new UUID.
- **The read is `_reg_generation_read` (ccd/ccd:3752).** It answers 0 + `REG_GENERATION`, 1 when present but invalid, or 2 when genuinely absent. It reads through an owned hard-link alias on a held descriptor and rechecks the inode, and it is the one reader. No new `_reg_get` is added.

**Decisions this task makes:**
- **Absent or invalid is unmeasured, never a value.** `_ws_reclaim_generation` answers rc 2 for both. The ladder then answers `unmeasured` (exit 1, retried) and mints no token.
  - ccd's own writers never leave either state on a `.child` row: `cmd_ws_add` mints first and dies otherwise.
  - A `.child` row without one is either pre-mechanism or hand-made. Binding `generation=` (empty) would hand that row a licence that no re-mint could invalidate.  - **The liveness residual is zero today (ruling T3 OPEN2).** Such a row can never be reclaimed by the sweep: it answers `unmeasured` on every pass, which is retried and never terminal. `cmd_ensure` heals an absent one at the next supervised respawn, and an invalid one never heals, by design. The coordinator measured the fleet read-only at 2026-10-08 15:56Z, and all 35 `.child` rows carry a 36-byte generation. Task 10 states the residual and that figure. This task measures nothing on the live fleet.
- **The read happens at rungs 1–2 (identity), after the marker and before the binding.** So the terminal refusals `no-such-session`, `not-a-workspace` and `not-a-child` are unchanged for every existing row.
- **Both fresh arms are bound, and so is the RESUME token (ruling T3 OPEN3: the resume token is bound too).** The present and vanished arms are bound through `_WS_LADDER_BIND`. `mode=reclaim-resume` is bound too, because a resume token is also minted at the audit and spent under the lock. `ws-expire`'s binding is NOT changed (`_ws_expire_eval` and `_ws_expire_locked` are workspace-lifecycle's, R72). `ccd-ws-expire-ladder.test.ts`'s exact `['mode=expire', 'id=…', 'archivedAt=…']` pin stays green and proves it.
- **An old-format token is REFUSED at spend as stale (`state-changed`), never accepted.**
  - The token is an opaque sha256. ccd cannot tell a pre-wave-7 token from a wrong one.
  - Accepting it would mean computing a second, generation-less token inside the lock and comparing against that. That is exactly the unbound licence X1 closes.
  - `state-changed` is `retry` in `CHILD_RECLAIM_TOKEN_KIND` (server/src/coord/childReclaim.ts:82) and a defer word (:210). So the cost is one deferred pass for a child whose audit and spend straddle the ccd update. The next pass re-audits on the new ccd. No capability bump is needed, because the token stays opaque 64-hex (T3 OPEN4, accepted).
- **The server needs no change, verified.**
  - `parseChildReclaimAudit` (server/src/coord/childReclaim.ts:608; `grep -n '^export function parseChildReclaimAudit' server/src/coord/childReclaim.ts`) reads only `id`, `mode`, `verdict`, `token` (`TOKEN_SHAPE`, 64 hex, :585), `childOf` and `detail`. It ignores any other key.
  - The token is carried opaquely into `ws-reclaim --expect` (`childReclaimAct`, step 6 at :938).
  - `server/src/ccdargv.ts:403-413` composes the argv and never reads the document.
  - No other server reader takes the `--reclaim` document (`grep -rn 'ws-audit.*--reclaim' server/src` finds only `ccdargv.ts` and `childReclaim.ts`).
  - Step 2 pins the tolerance both ways: with the key, with `null`, and without it (an older ccd).

**Files:**
- Modify: `ccd/ccd`. Make five edits. Locate each by its quoted text; Tasks 1 and 2 have already moved the line numbers below.
  1. `_ws_reclaim_reset` (ccd/ccd:25754, RECLAIM region). Add ONE line, `RECLAIM_GENERATION=""`, directly under `  RECLAIM_CHILDOF=""        # the marker's run id, as READ — never inferred from anything else`.
  2. Insert `_ws_reclaim_generation` directly below `_ws_reclaim_fingerprint`'s closing `}` (ccd/ccd:25786; `grep -n '^_ws_reclaim_fingerprint() {' ccd/ccd`) and above `_ws_reclaim_unmeasured() {`.
  3. `_ws_reclaim_eval` (ccd/ccd:26921). Replace the one line `  _WS_LADDER_BIND=("mode=reclaim" "id=$id" "childOf=$RECLAIM_CHILDOF" "deferExpired=$RECLAIM_DEFER")`.
  4. `_ws_reclaim_resume_eval` (ccd/ccd:27311). Make three edits: its header comment, the read after `RECLAIM_CHILDOF="$mark"`, and its fingerprint (:27340).
  5. `cmd_ws_audit`'s reclaim printf (ccd/ccd:13163-13164; `grep -n '"mode":"reclaim","childOf":%s,' ccd/ccd`). This is ABOVE the frozen citation boundary, so the edit is LINE-NEUTRAL: the same two lines are rewritten in place.
  - Edits 1–4 are below ccd/ccd:19109 (RECLAIM region, `RECLAIM-BEGIN` at :25721).
- Modify: `server/test/ccd-child-reclaim-audit.test.ts`. One line, :64: the reclaim document's exact key order gains `'generation'` after `'childOf'`.
- Test: `server/test/ccd-child-reclaim-row-generation.test.ts` (new; R56: new cases go in a new file). `git-env-strip.test.ts`'s SCOPE already matches it (`ccd-child-reclaim-.*\.test\.ts`, measured at `b0647d850`), so G12's SCOPE widening (Task 4's) needs no entry for this file.
- No edit to `shared/api.ts` (no new word and no new `meas.` key), to `server/src/**`, to the agent, or to the EXPIRE region.- No edit to the spec. The new code comments cite spec §5.5 for the generation token input and the audit's `generation` key. Task 10 writes both into the spec: the row's generation is an input of the fresh and resume reclaim tokens, and `ws-audit --reclaim` prints `generation` as a string or null (T3 OPEN1, accepted).

**Interfaces:**
- Consumes (at `b0647d850`):
  - `_reg_generation_read <id>`: rc 0 with `REG_GENERATION` set; rc 1 present but invalid; rc 2 genuinely absent. ccd/ccd:3752.
  - `_reg_generation_valid <value>`: 0 iff exactly the 36-byte lowercase UUID grammar. ccd/ccd:3731.
  - `_reg_generation_init <id>`, used only by the tests to model a re-mint and a respawn's re-init. ccd/ccd:3814.
  - `_compact_lock_acquire <id> <wait>` / `_compact_lock_release <fd>` / `COMPACT_LOCK_FD`, used by the tests only. This is the lock row creation takes around the mint.
  - `_ws_reclaim_unmeasured <detail>` → rc 1, `REAP_VERDICT=unmeasured`. ccd/ccd:25788.
  - `_ws_reclaim_fingerprint key=value…` → sha256 hex. ccd/ccd:25782.
  - `_WS_LADDER_BIND`: the token's leading inputs, set by the caller's rungs 1–2.
  - Test side:
    - from `server/test/childReclaimFixture.ts`: `makeChild`, `evalOf`, `childReclaimVerb`, `CHILD_ID`, `CHILD_RUN`, `CHILD_STUBS`;
    - from `server/test/childReclaimVerbHelpers.ts`: `verbHelpers` → `intact`, `refusedWith`, `interrupted`, `resumeToken`;
    - from `server/test/ccdPrHelpers.ts`: `makePrHarness`, `GH_STUB`;
    - from `server/src/coord/childReclaim.ts`: `parseChildReclaimAudit`.
- Produces:
  ```bash
  _ws_reclaim_generation <id>   # prints the row's generation (36 bytes, no LF), rc 0; prints nothing, rc 2 when it
                                #   could not be read as one (absent, or present and not the grammar)
  RECLAIM_GENERATION            # the generation as READ by the ladder's rungs 1-2 or the resume eval; '' = never read
                                #   (reset by `_ws_reclaim_reset`)
  ```
  - Token inputs:
    - the fresh token (present arm and vanished arm, through `_WS_LADDER_BIND`) is `mode=reclaim id=<id> childOf=<run> deferExpired=<0|1> generation=<uuid> …`;
    - the resume token is `mode=reclaim-resume id=<id> childOf=<run> generation=<uuid> deferExpired=… phase=… branch=… tip=…`.
  - `ws-audit --session <id> --reclaim` prints `"generation":"<uuid>"` or `"generation":null` on EVERY reclaim document, directly after `childOf`. The value is the generation when rungs 1–2 read it, and `null` when a rung refused before the read or the read was unmeasured.
  - For wave 8: the key is ABSENT on an older ccd. Read it absence-permits, as `string | null | undefined`, and never fold absence into a value. Wave 8 inherits this reading (ruling: "Wave 8 inherits T3 OPEN5").

- [ ] **Step 1: Re-measure the anchors (read-only)**

```bash
grep -n '^_reg_generation_read()\|^_reg_generation_mint()\|^_reg_generation_init()' ccd/ccd   # three lines
grep -n '_reg_generation_init "' ccd/ccd          # four call sites + 3822 inside init: ws-add, restore, start, ensure
grep -n 'rm -f "\$REG/\$id.generation"' ccd/ccd   # one line, inside _reg_purge
grep -n '"mode=reclaim" "id=\$id" "childOf=\$RECLAIM_CHILDOF" "deferExpired=\$RECLAIM_DEFER")' ccd/ccd   # one line
grep -n '"mode=reclaim-resume" "id=\$id" "childOf=\$mark"' ccd/ccd   # one line
grep -n '"mode":"reclaim","childOf":%s,' ccd/ccd  # one line, < 19109
grep -c 'generation=' ccd/ccd                      # 0: no token binds it yet
grep -n '^_ws_attic_pin() {' ccd/ccd               # NOTE this number: Step 4(e) must leave it unchanged
```

If any count differs, STOP and report. In particular, a second `.generation` writer means Task 0's measurement no longer holds.

- [ ] **Step 2: Write the failing test**

Create `server/test/ccd-child-reclaim-row-generation.test.ts`:

```ts
// X1's ccd half (child reclamation wave 7, spec 2026-09-22 §5.5): the reclaim
// token binds the ROW'S GENERATION — `$REG/<id>.generation`, minted once by row
// creation (`cmd_ws_add`, before any row field), removed last by `_reg_purge`,
// and rewritten by nothing else — so a token `ws-audit --reclaim` minted over
// one row is never spent on a re-mint of the same id, even when every other
// input matches. `/clear` and a swap rewrite `uuid` and `wrapper`, never the
// generation, and spend normally. The audit prints the value as an additive
// `generation` key; the server reads the document absence-permits.
// FIXTURE HOME ONLY (`makePrHarness`): every registry path is under its HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CHILD_ID, CHILD_RUN, CHILD_STUBS, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { parseChildReclaimAudit } from '../src/coord/childReclaim.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-row-generation-'); });
afterEach(() => { h.cleanup(); });
const { intact, refusedWith, interrupted, resumeToken } = verbHelpers(() => h);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const genFile = (): string => path.join(h.home, '.cc-sessions', `${CHILD_ID}.generation`);
/** The file's exact bytes — 36, no LF (`_reg_generation_valid`); never trimmed. */
const gen = (): string => fs.readFileSync(genFile(), 'utf8');
/** Under the compaction lock, as row creation and `cmd_ensure` take it around the mint. */
const locked = (body: string): void => {
  h.sh(`_compact_lock_acquire ${CHILD_ID} 5 || exit 9; ${body}; rc=$?; _compact_lock_release "$COMPACT_LOCK_FD"; exit $rc`);
};
/** A RE-MINT of this id's generation and of nothing else: `_reg_purge`'s
 *  unlink, then row creation's mint. A real same-run re-mint (`_reg_purge`,
 *  then `cmd_ws_add --child` on the recycled slug) also moves the worktree and
 *  the branch, which other token inputs already catch; the case the generation
 *  closes is the one where every other input matches, which is this one. */
const remint = (): void => { locked(`rm -f "$REG/${CHILD_ID}.generation" && _reg_generation_init ${CHILD_ID}`); };
/** What `/clear` writes to the row (`_sync_uuid`: a new `uuid`), what a swap
 *  writes (`cmd_swap`: `wrapper`, `lastswap`), and a respawn's re-init
 *  (`cmd_ensure`, `cmd_ws_restore`: `_reg_generation_init`, idempotent). */
const clearAndSwap = (): void => {
  const other = h.reg(CHILD_ID, 'wrapper') === 'claude' ? 'claude-a' : 'claude';
  h.sh(`_reg_set ${CHILD_ID} uuid "$(_plat_uuid)" && _reg_set ${CHILD_ID} wrapper ${other}`
    + ` && _reg_set ${CHILD_ID} lastswap "$(date +%s)"`);
  locked(`_reg_generation_init ${CHILD_ID}`);
};
/** `_ws_reclaim_fingerprint` redefined to write its inputs, answering the same
 *  hash (`ccd-child-reclaim-gone-branch.test.ts`'s device). */
const FP_CAPTURE = '_ws_reclaim_fingerprint() { printf \'%s\\n\' "$@" > "$HOME/fp-inputs";'
  + ' printf \'%s\\n\' "$@" | _plat_sha256 | cut -d\' \' -f1; };';
const fpInputs = (): string[] => fs.readFileSync(path.join(h.home, 'fp-inputs'), 'utf8').split('\n').filter(Boolean);
/** The token the ladder minted BEFORE this wave: the same inputs, less the generation. */
const PRE_WAVE7_FP = '_ws_reclaim_fingerprint() { local a=() x; for x in "$@"; do [[ "$x" == generation=* ]] || a+=("$x"); done;'
  + ' printf \'%s\\n\' "${a[@]}" | _plat_sha256 | cut -d\' \' -f1; };';
const AUDIT_STUBS = `${CHILD_STUBS} _session_verdict() { echo gone; }; ${GH_STUB}`;
const auditRun = (): { code: number; stdout: string; stderr: string } =>
  h.run(`${AUDIT_STUBS} cmd_ws_audit --session ${CHILD_ID} --reclaim`);
const auditDoc = (): Record<string, unknown> => {
  const r = auditRun();
  expect(r.code, r.stdout + r.stderr).toBe(0);
  return JSON.parse(r.stdout.trim()) as Record<string, unknown>;
};

describe('the value — minted with the row, rotated by nothing but a purge and a re-mint (Task 0, measured)', () => {
  it('ws-add mints it; /clear, a swap and a respawn leave it; the purge removes it; a re-mint is a new value', () => {
    makeChild(h);
    const g0 = gen();
    expect(g0, 'the real ws-add minted one, exactly the grammar').toMatch(UUID);
    expect(g0).toHaveLength(36);
    clearAndSwap();
    expect(gen(), '/clear, a swap and a respawn re-init rotate nothing').toBe(g0);
    h.sh(`_reg_purge ${CHILD_ID} || true`);
    expect(fs.existsSync(genFile()), 'the purge takes it with the row').toBe(false);
    locked(`_reg_generation_init ${CHILD_ID}`);
    expect(gen()).toMatch(UUID);
    expect(gen(), 'the next row of this id is a new generation').not.toBe(g0);
  }, 90_000);
});

describe('the token binds it', () => {
  it('the present arm and the resume take it as an input, exactly once, and it is the file’s value', () => {
    const c = makeChild(h);
    expect(evalOf(h, { pre: FP_CAPTURE }).verdict).toBe('reclaimable');
    expect(fpInputs().filter((l) => l.startsWith('generation=')), 'the present arm').toEqual([`generation=${gen()}`]);
    interrupted(c, 'worktree');
    h.sh(`${CHILD_STUBS} ${FP_CAPTURE} _ws_reclaim_resume_eval ${CHILD_ID} 0 ${CHILD_RUN} worktree >/dev/null`);
    expect(fpInputs()[0], 'the CONTROL: this was the resume token').toBe('mode=reclaim-resume');
    expect(fpInputs().filter((l) => l.startsWith('generation=')), 'the resume').toEqual([`generation=${gen()}`]);
  }, 90_000);

  it('the vanished arm takes it too — through the same binding', () => {
    const c = makeChild(h);
    h.git(c.main, 'worktree', 'remove', '--force', c.wt);
    const e = evalOf(h, { pre: FP_CAPTURE });
    expect(e.verdict, e.detail).toBe('reclaimable');
    expect(fpInputs()).toContain('worktree=absent');
    expect(fpInputs().filter((l) => l.startsWith('generation='))).toEqual([`generation=${gen()}`]);
  }, 90_000);

  it('a re-mint between the audit and the spend refuses state-changed, and touches nothing', () => {
    const c = makeChild(h);
    const a = auditDoc();
    expect(a['verdict']).toBe('reclaimable');
    const g0 = gen();
    expect(a['generation'], 'the audit says which row it minted over').toBe(g0);
    remint();
    expect(gen(), 'the CONTROL: the re-mint is a new value').not.toBe(g0);
    expect(refusedWith(childReclaimVerb(h, String(a['token'])))).toBe('state-changed');
    intact(c);
    // The CONTROL: a fresh audit over the re-minted row mints another token, which spends.
    const b = auditDoc();
    expect(b['generation']).toBe(gen());
    expect(b['token']).not.toBe(a['token']);
    const r = childReclaimVerb(h, String(b['token']));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
  }, 120_000);

  it('/clear, a swap and a respawn between the audit and the spend do NOT refuse — the generation is not the uuid', () => {
    makeChild(h);
    const a = auditDoc();
    const u0 = h.reg(CHILD_ID, 'uuid');
    clearAndSwap();
    expect(h.reg(CHILD_ID, 'uuid'), 'the CONTROL: /clear rotated the uuid').not.toBe(u0);
    expect(gen(), 'and not the generation').toBe(a['generation']);
    const r = childReclaimVerb(h, String(a['token']));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
  }, 120_000);

  it('a resume token is bound too: a re-mint under a reclaim: breadcrumb refuses state-changed', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    remint();
    expect(refusedWith(childReclaimVerb(h, tok))).toBe('state-changed');
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stands').toBe('reclaim:worktree');
    intact(c);
    const r = childReclaimVerb(h, resumeToken('worktree'));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed, 'the CONTROL: a resume token over the standing row spends').toBe(CHILD_ID);
  }, 120_000);

  it('an old-format token — minted before this wave, with no generation input — is refused as stale (state-changed), never accepted', () => {
    const c = makeChild(h);
    const old = evalOf(h, { pre: PRE_WAVE7_FP });
    const cur = evalOf(h);
    expect(old.verdict).toBe('reclaimable');
    expect(old.token).toMatch(/^[0-9a-f]{64}$/);
    expect(old.token, 'the stub drops exactly the generation; without it in the binding the two are one token').not.toBe(cur.token);
    expect(refusedWith(childReclaimVerb(h, old.token))).toBe('state-changed');
    intact(c);
  }, 90_000);
});

describe('no generation, no token', () => {
  it('an absent or malformed generation is unmeasured — never a token, never a terminal word; the audit says null and exits 1', () => {
    const c = makeChild(h);
    const good = gen();
    fs.rmSync(genFile());
    const e = evalOf(h);
    expect(e.verdict).toBe('unmeasured');
    expect(e.token).toBe('');
    expect(e.detail).toContain(`${CHILD_ID}.generation`);
    const r = auditRun();
    expect(r.code, r.stdout).toBe(1);
    const d = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(d['verdict']).toBe('unmeasured');
    expect(d['generation']).toBeNull();
    expect(d['token']).toBeUndefined();
    fs.writeFileSync(genFile(), `${good}\n`);   // 37 bytes: present, and not the grammar
    expect(evalOf(h).verdict, 'a malformed generation').toBe('unmeasured');
    fs.writeFileSync(genFile(), good);
    interrupted(c, 'worktree');
    fs.rmSync(genFile());
    const v = h.sh(`${CHILD_STUBS} _ws_reclaim_resume_eval ${CHILD_ID} 0 ${CHILD_RUN} worktree >/dev/null;`
      + ' printf \'%s\\x1f%s\' "$REAP_VERDICT" "$REAP_TOKEN"');
    expect(v.split('\x1f'), 'the resume mints none either').toEqual(['unmeasured', '']);
  }, 120_000);

  it('every reclaim document says generation: the value on a measured row, null where rungs 1-2 refused first; no value leaks', () => {
    makeChild(h);
    const a = auditDoc();
    expect(Object.keys(a)).toContain('generation');
    expect(a['generation']).toBe(gen());
    expect(h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 '' >/dev/null; _ws_reclaim_eval demo-no-such-row 0 '' >/dev/null;`
      + ' printf \'[%s]\' "$RECLAIM_GENERATION"'), 'a refused eval never carries the last row’s value').toBe('[]');
    fs.rmSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.child`));
    const r = auditDoc();
    expect(r['verdict']).toBe('not-a-child');
    expect(r['generation']).toBeNull();
  }, 90_000);
});

describe('the server reads the additive key absence-permits', () => {
  const TOK = 'a'.repeat(64);
  const base = { id: CHILD_ID, mode: 'reclaim', childOf: CHILD_RUN };
  it('parseChildReclaimAudit answers the same with the key, with null, and without it (an older ccd)', () => {
    const want = { kind: 'token', token: TOK, childOf: CHILD_RUN };
    for (const extra of [{}, { generation: '0123abcd-0123-4567-89ab-0123456789ab' }, { generation: null }]) {
      expect(parseChildReclaimAudit(CHILD_ID, JSON.stringify({ ...base, ...extra, verdict: 'reclaimable', detail: '', token: TOK })))
        .toEqual(want);
    }
    expect(parseChildReclaimAudit(CHILD_ID, JSON.stringify({ ...base, generation: null, verdict: 'not-a-child', detail: 'd' })))
      .toEqual({ kind: 'refused', token: 'not-a-child', detail: 'd' });
  });

  it('this build’s own document parses to its token', () => {
    makeChild(h);
    const out = auditRun().stdout.trim();
    expect(parseChildReclaimAudit(CHILD_ID, out))
      .toEqual({ kind: 'token', token: (JSON.parse(out) as { token: string }).token, childOf: CHILD_RUN });
  }, 60_000);
});
```

In `server/test/ccd-child-reclaim-audit.test.ts`, change the one line (`grep -n "'mode', 'childOf', 'verdict', 'detail', 'token'" server/test/ccd-child-reclaim-audit.test.ts`, :64):

```ts
    expect(Object.keys(a)).toEqual([...PLAIN_KEYS.slice(0, -2), 'mode', 'childOf', 'generation', 'verdict', 'detail', 'token']);
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-row-generation.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts -t 'prints mode, childOf and the SAME token'
```

Expected, before Step 4:
- **The measurement case PASSES.** It pins existing code, and is Task 0's measurement in a fixture HOME. If it reds, STOP and report: the generation is not the value, and the rest of this task does not apply.
- "the present arm and the resume…": `the present arm: expected [] to deeply equal [ 'generation=…' ]`.
- "the vanished arm…": `expected [] to deeply equal [ 'generation=…' ]`.
- "a re-mint…": `the audit says which row it minted over: expected undefined to be '<uuid>'`.
- "/clear, a swap…": `and not the generation: expected '<uuid>' to be undefined`.
- "a resume token is bound too": `a refusal never also reports a reclaim: expected 'demo-quiet-basin' to be undefined`.
- "an old-format token…": `the stub drops exactly the generation…: expected '<hex>' not to be '<hex>'`.
- "an absent or malformed generation…": `expected 'reclaimable' to be 'unmeasured'`.
- "every reclaim document…": `expected [ 'id', …, 'token' ] to include 'generation'`.
- Both server cases PASS. They characterise the existing reader, and the rows below prove each is live.
- The audit case reds on the key order: `expected [ …, 'mode', 'childOf', 'verdict', … ] to deeply equal [ …, 'mode', 'childOf', 'generation', 'verdict', … ]`.

- [ ] **Step 4: Implement**

(a) In `_ws_reclaim_reset`, directly under `  RECLAIM_CHILDOF=""        # the marker's run id, as READ — never inferred from anything else`, add:

```bash
  RECLAIM_GENERATION=""     # the row's generation as READ (`_ws_reclaim_generation`) — a token input; '' = never read
```

(b) Directly below `_ws_reclaim_fingerprint`'s closing `}` and above `_ws_reclaim_unmeasured() {`, insert:

```bash

_ws_reclaim_generation() {   # id -> prints the row's generation (`$REG/<id>.generation`, spec §5.5), rc 0;
  #                               prints nothing, rc 2, when it could not be read as one: absent, or
  #                               present and not the 36-byte grammar
  # THE ONE READER, `_reg_generation_read`: an owned hard-link alias on a held
  # descriptor and a same-inode recheck, never `_reg_get` or a bare `cat`, which
  # name the path twice. The generation is minted with the row (`cmd_ws_add`,
  # before any row field) and removed last by `_reg_purge`; nothing else writes
  # it — not `/clear`, which rewrites `uuid` (`_sync_uuid`), not a swap, not a
  # respawn's re-init, which mints only into absence. So it is the one value
  # that differs between a row and a re-mint of its id. ABSENT AND INVALID ARE
  # BOTH 2, never a value: `cmd_ws_add` dies before it writes `.child` when it
  # cannot mint, so neither is a state ccd's own writers leave on a child, and a
  # token bound to `generation=` would be one no re-mint could invalidate.
  _reg_generation_read "$1" || return 2
  printf '%s' "$REG_GENERATION"
}
```

(c) In `_ws_reclaim_eval`, replace the one line `  _WS_LADDER_BIND=("mode=reclaim" "id=$id" "childOf=$RECLAIM_CHILDOF" "deferExpired=$RECLAIM_DEFER")` with:

```bash
  # …AND WHICH ROW IT IS (spec §5.5): the row's generation is a token input, so
  # a token minted over this row is never spent on a re-mint of the same id,
  # whatever else matches. Asked after rungs 1-2, so their terminal words are
  # unchanged; unreadable, it mints no token (`_ws_reclaim_generation`).
  RECLAIM_GENERATION=$(_ws_reclaim_generation "$id") \
    || { _ws_reclaim_unmeasured "$REG/$id.generation could not be read as this row's generation (absent, or not one 36-byte lowercase UUID) — which row a token would bind is unknown"; return 1; }
  _WS_LADDER_BIND=("mode=reclaim" "id=$id" "childOf=$RECLAIM_CHILDOF" "deferExpired=$RECLAIM_DEFER" "generation=$RECLAIM_GENERATION")
```

(d) In `_ws_reclaim_resume_eval`, make three edits:
- In its header comment, replace `  # BEFORE anything else runs, and its token binds the phase and the recorded` / `  # tip, so a stale resume token refuses \`state-changed\` like any other.` with:

```bash
  # BEFORE anything else runs, and its token binds the phase, the recorded tip
  # and the row's generation, so a stale resume token refuses `state-changed`
  # like any other — a re-mint of the id included.
```

  (Two lines become three; this is below the boundary.)
- Replace the two lines `  RECLAIM_CHILDOF="$mark"` / `  [[ ! -e "$REG/reclaim-paused" && ! -L "$REG/reclaim-paused" ]] \`. This pair is unique to the resume eval; the fresh eval's `RECLAIM_CHILDOF="$mark"` is followed by the binding. Replace them with:

```bash
  RECLAIM_CHILDOF="$mark"
  RECLAIM_GENERATION=$(_ws_reclaim_generation "$id") \
    || { _ws_reclaim_unmeasured "$REG/$id.generation could not be read as this row's generation (absent, or not one 36-byte lowercase UUID) — an interrupted reclaim does not finish on a row it cannot identify"; return 1; }
  [[ ! -e "$REG/reclaim-paused" && ! -L "$REG/reclaim-paused" ]] \
```

- Replace the fingerprint's first line `  REAP_TOKEN=$(_ws_reclaim_fingerprint "mode=reclaim-resume" "id=$id" "childOf=$mark" \` with these two lines, leaving its continuation line unchanged:

```bash
  REAP_TOKEN=$(_ws_reclaim_fingerprint "mode=reclaim-resume" "id=$id" "childOf=$mark" \
    "generation=$RECLAIM_GENERATION" \
```

(e) **LINE-NEUTRAL: above ccd/ccd:19109.** In `cmd_ws_audit`, replace exactly the two lines

```bash
    printf '"mode":"reclaim","childOf":%s,' \
      "$( _child_runid_valid "$RECLAIM_CHILDOF" && echo "$RECLAIM_CHILDOF" || echo null)"
```

with exactly two lines:

```bash
    printf '"mode":"reclaim","childOf":%s,"generation":%s,' \
      "$( _child_runid_valid "$RECLAIM_CHILDOF" && echo "$RECLAIM_CHILDOF" || echo null)" "$( _reg_generation_valid "$RECLAIM_GENERATION" && printf '"%s"' "$RECLAIM_GENERATION" || echo null)"
```

- No `_json_str` is added. The value is printed raw only after `_reg_generation_valid` admits it (36 bytes of `[0-9a-f-]`), exactly as `childOf` is printed raw after `_child_runid_valid`. So the "Nineteen `_json_str` substitutions" comment in `cmd_ws_audit` stays as true as it was.
- No comment is added here. The RECLAIM region's "WS-AUDIT --RECLAIM" note says why the audit's code may not grow; extend it below the boundary only if you want, with one sentence: "The document carries `generation`, the row's generation the ladder bound into the token, or null where rungs 1-2 refused before reading it."
- Then verify: `grep -n '^_ws_attic_pin() {' ccd/ccd` prints the number Step 1 noted. If it does not, the edit added a line above the boundary: undo it and redo it in place.

- [ ] **Step 5: Run the tests to verify they pass, then the gates**

Run each in the FOREGROUND, every call under 600 s:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-row-generation.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-tail.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-reflogs.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-gone-branch.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pin.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-recovery.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-unmeasured-journal.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-hardening.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-leaf-moved.test.ts test/ccd-child-reclaim-leaf-moved-resume.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-ladder.test.ts test/ccd-ws-expire-verb.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim.test.ts test/child-reclaim-pre-crumb.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-lifecycle-purge.test.ts
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/ccd-refusal-scan.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p .
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'the found set EQUALS the allow-list'
```

Expected:
- **The new file passes in full.** `ccd-child-reclaim-audit` is green with the one-line key-order change.
- **The existing ladder, verb and resume suites stay green unchanged.** Every child they build comes through the real `cmd_ws_add --child`, so it carries a generation. Every rungs-1–2 refusal they assert (`no-such-session`, `not-a-workspace`, `not-a-child`) is still asked before the read.
- **`ccd-ws-expire-ladder` stays green.** Its case "an expiry token is never a reclaim token over the same facts" pins expire's binding at exactly `['mode=expire', 'id=…', 'archivedAt=…']`, and that is the proof this task did not touch the EXPIRE region.
- **The canonical-write census stays green.** No site writes `$REG/<id>.generation`; the new code only calls `_reg_generation_read`, whose one alias `link` is census entry 17, count 1.
- **The citation case is green, because edit (e) is line-neutral.** If it reds on a citation of the two rewritten lines' CONTENT, re-point that citation by content and name it in the wave-done. Any other red in the frozen corpus means STOP and report; a frozen-corpus census is never adjusted here.
- `tsc` prints nothing; `mark.mjs --check` exits 0; `ownership` is green.

- [ ] **Step 6: Mutation check**

Apply one mutation at a time. Re-stamp after each ccd edit (`bash ccd/ccrc restamp ccd/ccd`), run the command, see the red, then revert.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | In `_ws_reclaim_eval`'s binding, delete ` "generation=$RECLAIM_GENERATION"` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-row-generation.test.ts` | "a re-mint…": `a refusal never also reports a reclaim: expected 'demo-quiet-basin' to be undefined`; "the present arm…": `the present arm: expected [] to deeply equal [ 'generation=…' ]`; "an old-format token": `…: expected '<hex>' not to be '<hex>'` |
| 2 | In the same binding, replace `"generation=$RECLAIM_GENERATION"` with `"generation=$(cat "$REG/$id.uuid")"` (binding the uuid, which `/clear` rotates) | same | "/clear, a swap and a respawn…": `expected undefined to be 'demo-quiet-basin'` (the spend refuses `state-changed`); "the present arm…": `expected [ 'generation=<uuid>' ] to deeply equal [ 'generation=<gen>' ]` |
| 3 | In `_ws_reclaim_eval`, replace `\|\| { _ws_reclaim_unmeasured "$REG/$id.generation could not be read …"; return 1; }` with `\|\| :` | same | "an absent or malformed generation…": `expected 'reclaimable' to be 'unmeasured'` |
| 4 | In `_ws_reclaim_generation`, replace `_reg_generation_read "$1" \|\| return 2` with `_reg_generation_read "$1"; (( $? != 1 )) \|\| return 2` (absence folded into the value `''`) | same | "an absent or malformed generation…": `expected 'reclaimable' to be 'unmeasured'` |
| 5 | In `_ws_reclaim_resume_eval`'s fingerprint, delete the line `    "generation=$RECLAIM_GENERATION" \` | same | "a resume token is bound too": `a refusal never also reports a reclaim: expected 'demo-quiet-basin' to be undefined`; "the present arm and the resume…": `the resume: expected [] to deeply equal [ 'generation=…' ]` |
| 6 | In `_ws_reclaim_resume_eval`, delete the two-line `RECLAIM_GENERATION=$(_ws_reclaim_generation "$id") \|\| { …; return 1; }` statement (keep the input) | same | "an absent or malformed generation…": `the resume mints none either: expected [ 'reclaimable', '<hex>' ] to deeply equal [ 'unmeasured', '' ]`; "a resume token is bound too": `…expected 'demo-quiet-basin' to be undefined` |
| 7 | In `_ws_reclaim_reset`, delete `RECLAIM_GENERATION=""` | same | "every reclaim document…": `a refused eval never carries the last row’s value: expected '[<uuid>]' to be '[]'` (and, in a fresh shell, the `not-a-child` audit dies `RECLAIM_GENERATION: unbound variable` under `set -u`: `expected 1 to be 0`) |
| 8 | In `cmd_ws_audit`'s printf, replace the generation argument `"$( _reg_generation_valid … \|\| echo null)"` with `null` | same | "a re-mint…": `the audit says which row it minted over: expected null to be '<uuid>'`; "every reclaim document…": `expected null to be '<uuid>'` |
| 9 | In the same argument, replace `\|\| echo null` with `\|\| printf '""'` | same | "every reclaim document…": `expected '' to be null`; "an absent or malformed generation…": `expected '' to be null` |
| 10 | Drop the key: restore `printf '"mode":"reclaim","childOf":%s,' \` and delete the second argument | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts -t 'prints mode, childOf'` | `expected [ …, 'childOf', 'verdict', … ] to deeply equal [ …, 'childOf', 'generation', 'verdict', … ]` |
| 11 | In `_reg_generation_init`, replace `    0) return 0 ;;` with `    0) rm -f "$REG/$1.generation" ;;` (a respawn re-mints) | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-row-generation.test.ts -t 'the value'` | `/clear, a swap and a respawn re-init rotate nothing: expected '<new>' to be '<old>'`. This proves the Task 0 pin is live; revert at once, because `ccd-lifecycle-purge` depends on this arm too. |
| 12 | In `server/src/coord/childReclaim.ts`'s `parseChildReclaimAudit`, directly under `if (v.mode !== 'reclaim') …`, add `if ('generation' in v) return { kind: 'unreadable', detail: 'strict' };` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-row-generation.test.ts -t 'absence-permits'` | `expected { kind: 'unreadable', detail: 'strict' } to deeply equal { kind: 'token', … }`. This proves the tolerance pin is live. |

Revert each mutation, re-stamp, and re-run the Step 5 commands green.

- [ ] **Step 7: Re-stamp and commit**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
git add ccd/ccd server/test/ccd-child-reclaim-row-generation.test.ts server/test/ccd-child-reclaim-audit.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): the reclaim token binds the row's generation

ws-audit --reclaim and ws-reclaim now bind $REG/<id>.generation into the
reclaim token, on the present and vanished arms and on the resume token.
The generation is minted with the row and removed only by the purge, and
/clear, a swap and a respawn never rotate it. So a token minted over one
row is never spent on a re-mint of the same id, even when every other
input matches: the spend refuses state-changed. An absent or malformed
generation is unmeasured and mints no token. The audit document gains an
additive "generation" key (null where rungs 1-2 refused first), printed
line-neutrally. A token minted before this change is refused as stale,
once, and the next audit mints a bound one.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: The collector's building blocks — the `collect` act, its record, quarantine, rename, idle walk, token, row rule and checkout alias

**Model routing:** **`opus`, effort `high`**, for all six parts (4-act, 4A-4E). This is SAFETY-critical: these are the pieces `ws-collect` deletes with (Task 6), and the checkout alias changes what the ONE removal helper `_ws_leaf_remove` may remove. Wave 7's SAFETY panel reads this diff with Task 6's.

**Why:** Contract §14 rules a new destructive verb, `ws-collect`, for a witnessed temp root whose row is gone (R66–R68). Its safety rests on pieces that do not exist at `b0647d850`, and this task builds each one as a separately tested function, INERT: nothing calls any of them until Tasks 5 and 6 compose them. The six parts, one commit each:

- **4-act — the `collect` act** (ruling G1; moved from Task 7 Part A). ccd's `_LC_ACTS` (one line for one), `LifecycleAct` and `LIFECYCLE_ACT_MAP`, the PWA's `ACT_WORD`, the lifecycle instrument's `NEUTRAL_ACTS`, and the act pins (`server/test/ws-collect-act.test.ts`). It lands FIRST, so the act exists before Task 5 first journals it (T5 DEP4, T6 OPEN6, T7 OPEN1).
- **4A — the quarantine record** (R66). `$REG/tmpquarantine/<id>.<ns>.<pid>` is the collector's resume authority, written before anything moves and dropped last. It is a dotless registry subdirectory on the `pools/`/`tmproots/` precedent, pinned invisible to `_reg_purge`, `_ws_slug_free`, `ccd ls` and the server's registry read, with its own census. Its body names NO path (ruling G5): the slot is DERIVED from the record's file name under the physical quarantine, so a space in a physical path can never split a record; only `checkouts=` carries paths, percent-encoded. Its records are found by EXACT parse, because ids admit dots. Measured by the attack: a `<id>.*` glob for `p-calm-mesa` matches `p-calm-mesa.v2-quiet-river`'s record (the nested-id hazard `_ws_slug_free`'s dot-leading pass already guards against, `grep -n 'THE DOT-LEADING PRIVATE FAMILIES' ccd/ccd`).
- **4B — the quarantine, the slot, and the rename and its proof** (R67 steps 3–4). The rename is `mv -T -n --no-copy`, one `renameat2(RENAME_NOREPLACE)`. It is spelled inline in ONE collector function, never as a `_plat_` helper: ccd/ccd:1-1221 is the platform block, byte-identical with ccd/ccrc. Its proof is an lstat, never mv's exit code.
  - Measured on the fleet (ext4, coreutils 9.4): the rename keeps ino, the nanosecond btime and mtime, and stamps ctime. It refuses an existing empty directory with rc 1, where a plain `mv -T` and python's `os.rename` replace it.
  - coreutils 9.2 changed what `mv -n` answers on a skip, so the exit code proves nothing.
  - `server/test/macos-platform.test.ts` refuses `mv -T` outside the platform block (its `gnuOnly` row `'mv -T'`). It gains a one-function exemption for `_ws_collect_mv`, pinned exactly as the hook's `_hook_epoch_ms` exemption is pinned.
- **4C — the idle walk, the floor and the token** (R68). The walk takes the newest CTIME, in ns, over the whole leaf, never mtime: a future mtime would hold a leaf forever (attack, measured). It is GNU `find -P <leaf> -xdev` under `LC_ALL=C`, bounded at 60 s and 2,000,000 entries; the largest live leaf measured 76,915 entries in at most 4.8 s.
  - The floor is max(24 h, `WS_COLLECT_IDLE_FLOOR_S`), and the knob only raises it.
  - `_ws_collect_floor_s` is the floor's ONE definition (ruling G4). The knob only raises the floor; the one test-only seam that lowers it is redefining `_ws_collect_floor_s` in a sourced harness (`_ws_collect_floor_s() { echo 0; };`), never the knob. `_ws_collect_now_ns` stays a clock seam: a case may name the instant, as `_ws_expire_now` is named.
  - The token is `_ws_reclaim_fingerprint`'s encoding over `mode=collect` and R68's inputs.
- **4D — the row rule** (R64 Rule 2 for the collector, R68). Measured by the attack: without it, a stopped session's clone inside a dead child's temp root is deleted with the leaf. `_ws_reclaim_workdir_shared` CAN be called directly, with the leaf as the workdir, and it is. That is ONE registry pass with its comparisons — equal, inside, through, literal and resolved, standing rows and rows placed by either R54 arm — and no copy of a 300-line chain.
  - Two differences, each stated in the function's header:
    - that helper skips the id's own row, so the collector asks `$REG/<id>.workdir` first, and any own row refuses;
    - it also compares the id's clips leaf, which fails closed (departure `rows-clear-also-asks-the-clips-leaf`).
  - Its recorded-placement arm runs git on other rows' repositories, so Tasks 5 and 6 call it only under `_ws_reclaim_contained`.
- **4E — the checkout alias** (R67, "The checkout question across the move"). After the move, the leaf's own linked worktrees back-link to the PRE-MOVE spelling, so `_ws_leaf_checkouts` would refuse every one. Its `_ws_leaf_checkout_one` back-link rule is at ccd/ccd:29191-29211 (`grep -n "OUTSIDE IT: only a linked worktree whose admin directory" ccd/ccd`).
  - The additive alias passes such a back-link only under BOTH conditions: (1) the pre-move ask accepted this admin directory with this back-link value, and (2) `_ws_reclaim_absent` proves nothing stands at the pre-move spelling now.
  - Each condition has its own measured break, and each is mutation-pinned:
    - without (1), a foreign worktree moved into an orphan leaf passes, and its uncommitted work is deleted, once a recycled slug's `git worktree add` re-creates its pruned admin name at the pre-move spelling and that child's temp root is later removed;
    - without (2), the leaf's own worktree passes while a recycled slug's LIVE worktree holds the same admin name with the same back-link value.
  - Every other caller passes no alias and is answered exactly as before.

**Not in this task.** These are Task 6's, and Task 6 composes them from what this task produces:
- the post-move listing control on `$REG`;
- the `/proc/self/mountinfo` check;
- the witness compare-and-drop;
- the writer's temp-file reaping;
- the in-use probe calls;
- the record order, restore and resume.

The `collect` act is declared here (4-act), and no ccd code in this task journals it. The refusal words are Tasks 1, 5 and 6's (ruling G2), and the audit is Task 5's. Nothing in this task's ccd code is journaled, and nothing in it prints a refusal or verdict document, so the COLLECT region holds none of the shapes `ccd-wsaudit-nonpoison.test.ts` and `ccd-refusal-scan.test.ts` harvest. Task 5's commit, the first to spell a word there, teaches both the COLLECT block (G2).

**The citation boundary.** Every ccd/ccd edit but one is below ccd/ccd:19109. The exception is 4-act's E6, the first line of `_LC_ACTS` (ccd/ccd:4368), changed one line for one, so no cited line moves. Below the boundary, the first changed line is the `_ws_dir_physical` header (ccd/ccd:28804 at `b0647d850`). The frozen block, the caps line, the entry guard, `_ws_slug_free` and the ws-audit hand-off are not touched. There is no new `_reg_get` call (not even in a comment: `ccd-reg-get-census.test.ts` counts the call shape), and no `_plat_` helper is added. Workspace-lifecycle's `_ws_expire_locked` and `_ws_expire_cwd_users` are not touched (R72).

**Files:**
- Modify: `ccd/ccd`. Locate every edit by its grep anchor; the line numbers are `b0647d850`'s and move with Tasks 1–3:
  0. **4-act (E6):** the first line of `_LC_ACTS` (ccd/ccd:4368; `grep -n '^_LC_ACTS=(' ccd/ccd`), one line for one, above the citation boundary.
  1. **4A:** insert the COLLECT region (its two markers, its header and the record functions) directly below `# ── end archived-workspace expiry ───────────────────────────────────────────── EXPIRE-END ──` (ccd/ccd:31251; `grep -n 'EXPIRE-END' ccd/ccd`) and above the blank line before `MIRROR-BEGIN` (:31253).
  2. **4B, 4C, 4D:** insert each part's functions directly ABOVE the line `# ── end temp-root collection ─────────────────────────────────────────────────── COLLECT-END ──`, in part order.
  3. **4B:** in `_ws_dir_physical`'s header, change its caller census from seven to eight — the eighth, `_ws_collect_qpath`, lands in 4A (ccd/ccd:28804-28810; `grep -n 'THE ONE PHYSICAL RESOLUTION its seven callers share' ccd/ccd`).
  4. **4E:** `_WS_CHECKOUTS_WHY=''` and `_ws_leaf_checkout_one` (ccd/ccd:29149-29212; `grep -n '^_ws_leaf_checkout_one()' ccd/ccd`); `_ws_leaf_checkouts` (:29213-29275); and `_ws_leaf_remove` (its signature at :29276, its `local` line at :29364, and its checkout call at :29401, `grep -nF '    _ws_leaf_checkouts "$leaf"; rc=$?' ccd/ccd`).
- Modify: `server/test/macos-platform.test.ts` (4B). Edit `scannedText` (:241-244, `grep -n 'function scannedText' server/test/macos-platform.test.ts`), and add one case directly after the hook's exemption pin (`grep -n "exemption is the epoch copy, and nothing else" server/test/macos-platform.test.ts`, :289-306).
- Modify: `server/test/ccd-workspaces.test.ts` (4A). Add ONE `DISPOSITION` entry directly after the `ccd-child-tmproot-witness.test.ts` entry (:1556-1557; `grep -n "file: 'ccd-child-tmproot-witness.test.ts', grammar: 'residue'" server/test/ccd-workspaces.test.ts`). The disposition scan (`every _ws_slug_residue and ws-add-refusal assertion is on the disposition list`) reds on any unlisted `_ws_slug_residue` line, and 4A's invisibility case adds two.
- Modify: `server/test/git-env-strip.test.ts` (4A, ruling G12). Widen `SCOPE` (`grep -n 'const SCOPE = ' server/test/git-env-strip.test.ts`), one line for one, and add this wave's collector suites and fixtures to the `later` array of the case `SCOPE names every new ccd suite and fixture …`, red first.
- Modify (4-act, ruling G1; Task 7 Part A's files, moved here):
  - `shared/api.ts`: the `LifecycleAct` union, after the `'expire'` member (`grep -n "  | 'expire'        // ws-expire" shared/api.ts`), and `LIFECYCLE_ACT_MAP`'s third line (`grep -n "'attic-drop': true, reap: true, reclaim: true, expire: true," shared/api.ts`);
  - `pwa/src/session/journalWords.ts:32` (`grep -n "reclaim: 'reclaimed', expire: 'expired'" pwa/src/session/journalWords.ts`), one `ACT_WORD` entry. `pwa/test/journal-words.test.ts` is run, unchanged. G1 admits both to the HARD BOUNDARY;
  - `deploy/measure-workspace-lifecycle.py`: `NEUTRAL_ACTS` and its comment (`grep -n '^NEUTRAL_ACTS' deploy/measure-workspace-lifecycle.py`). This task rules the instrument's class: NEUTRAL;
  - `server/src/deadCoordinator.ts`: the `DEAD_COORDINATOR_DELIBERATE_ACTS` docstring only, the list unchanged (`grep -n '^export const DEAD_COORDINATOR_DELIBERATE_ACTS' server/src/deadCoordinator.ts`). The plan frame's HARD BOUNDARY does not list this file yet: the coordinator admits it, or this docstring edit is dropped;
  - the cardinals `collect` moves, each in place: `server/test/lifecycle-acts.test.ts:18`, `:33`, `:54`; `server/test/lifecycle-vocabulary.test.ts:149`; `server/test/ccd-lifecycle-emit.test.ts:28`; `server/test/single-definition.test.ts:3077` (a CITED file: a digit replaced in place);
  - only if Step act-4 reds on it: `README.md`, its `shared/api.ts:` anchors re-pointed BY CONTENT (README is under claim 1110 until it ends, Task 0).
- Test (all new; R56):
  - `server/test/ws-collect-act.test.ts` (4-act)
  - `server/test/ccd-collect-record.test.ts` (4A)
  - `server/test/ccd-collect-quarantine.test.ts` (4B)
  - `server/test/ccd-collect-idle-token.test.ts` (4C)
  - `server/test/ccd-collect-rows.test.ts` (4D)
  - `server/test/ccd-leaf-checkouts-alias.test.ts` (4E)

**Interfaces:**
- Consumes (at `b0647d850`; each line number is a hint, and each grep finds it):
  - `_ws_tmproot_id_ok <id>` (ccd/ccd:20812, `grep -n '^_ws_tmproot_id_ok()' ccd/ccd`). It is the id grammar a witness is named for: `[A-Za-z0-9._-]+`, never dot-leading.
  - `_ws_tmproot_witness_read <id>` → 0 sets `_WS_WIT_DEV _WS_WIT_INO _WS_WIT_BTIME _WS_WIT_RUN _WS_WIT_UID _WS_WIT_AT` | 1 absent | 2 malformed (:20814). `_ws_tmproot_witness_write <id> <leaf> <run>` (:20844), used by tests only.
  - `_child_runid_valid <run>` (:20902).
  - `_ws_reclaim_fingerprint key=value...` → sha256 hex (:25782).
  - `_ws_reclaim_workdir_shared <id> <workdir>` → rc 0 with `_WS_SHARED_ROWS _WS_NESTED_ROWS _WS_THROUGH_ROWS` (comma lists, '' = none) | rc 2 with `_WS_SHARED_WHY` (:26015). It skips the row of `<id>` itself, and it compares `~/.cc-clips/<id>` and `~/.cc-tmp/<id>` as leaves.
  - `_ws_reclaim_absent <path>` → 0 proven absent | 1 stands | 2 unmeasured, `_WS_ABSENT_WHY` (:26646).
  - `_ws_dir_physical <dir>` → 0 with `_WS_PHYS` | 1 with `_WS_PHYS_WHY` (:28802).
  - `_ws_leaf_uid <path>` → owner uid via `ls -dn`, a test seam (:29117).
  - `_ws_leaf_checkout_one`, `_ws_leaf_checkouts`, `_ws_leaf_remove` (:29150, :29213, :29276).
  - `_plat_devino` (:265, an lstat: `stat -c '%d:%i'`), `_plat_btime` (:264, whole seconds), `_plat_mode` (:423), `_plat_mktemp` (:416), `_plat_timeout` (:525; rc 124 on its deadline).
  - Test side:
    - `makePrHarness` (`server/test/ccdPrHelpers.ts:43`), built on `makeCcdHarness` (`server/test/ccdWsHelpers.ts:520`);
    - `CCD` (`ccdWsHelpers.ts:24`);
    - `inheritedEnv` (`server/test/gitEnvStrip.ts:46`);
    - `seedRoster` (`server/test/helpers.ts:120`);
    - `localIO` (`server/src/io.ts:173`);
    - `loadConfig` (`server/src/config.ts:398`);
    - `readRegistryMeasured` (`server/src/registry.ts:1114`);
    - 4-act: `makeCcdHarness` (`server/test/ccdWsHelpers.ts`), `NO_TMUX` and `readJournal` (`server/test/lifecycleHelpers.ts`), and `deadCoordinatorJournal`, `DEAD_COORDINATOR_DELIBERATE_ACTS`, `DEAD_COORDINATOR_JOURNAL_ACTS` and `DEAD_COORDINATOR_JOURNAL_TRUSTED` (`server/src/deadCoordinator.ts`).
- Produces (ccd/ccd, all in the COLLECT region except 4E's three and 4-act's `_LC_ACTS` member):
  ```bash
  # 4-act (ruling G1; moved from Task 7 Part A)
  # journal act: collect                 — _LC_ACTS, LifecycleAct, LIFECYCLE_ACT_MAP, ACT_WORD.collect = 'temp root collected'
  # instrument: 'collect' in NEUTRAL_ACTS — never ENDS_THE_ARCHIVE, never RETURN_ACTS
  # dead-coordinator: 'collect' in neither DEAD_COORDINATOR_DELIBERATE_ACTS nor DEAD_COORDINATOR_JOURNAL_ACTS
  # region markers (Tasks 5-7 add the audit and the verb INSIDE them; any test that cuts marked blocks learns COLLECT there;
  #   no other marker in ccd/ccd may contain the substring `COLLECT-BEGIN` or `COLLECT-END`: every slicer uses indexOf)
  # ── temp-root collection: ws-collect (spec 2026-09-22 §5.2, §5.6) ─── COLLECT-BEGIN ──   …   # ── end temp-root collection ─── COLLECT-END ──
  # 4A
  _ws_collect_enc <text>                 # stdout: every byte outside [A-Za-z0-9._/:@+~-] as %XX (injective)
  _ws_collect_pairs_ok <list>            # 0: '' or `<enc>=<enc>(,<enc>=<enc>)*`
  _ws_collect_rec_id <name>              # 0 + _WS_REC_ID: `<id>.<ns>.<pid>` less its two trailing all-digit fields | 1
  _ws_collect_qrec_dir                   # stdout: "$REG/tmpquarantine"
  _ws_collect_qpath                      # 0 + _WS_QPATH = <physical ~/.cc-tmp>/.ccd-quarantine, resolved and NEVER made | 2 (_WS_QPATH_WHY)
  _ws_collect_record_write <id> <slot> <token>   # 0 written AND read back | 1 not written (_WS_QREC_WHY); reads the caller's
                                         #   _WS_WIT_DEV/_INO/_BTIME/_RUN/_AT and _WS_CHECKOUTS_ACCEPTED; <slot> must be
                                         #   $_WS_QPATH/slot.<id>.<ns>.<pid> and only names the record. The body carries NO
                                         #   path (G5): `v=1 id= dev= ino= btime= run= at= token= checkouts=<enc admin>=<enc back-link>[,…]`
  _ws_collect_record_read <file>         # 0 sets _WS_QREC_ID _WS_QREC_SLOT(DERIVED: $_WS_QPATH/slot.<file name>) _WS_QREC_DEV
                                         #   _WS_QREC_INO _WS_QREC_BTIME _WS_QREC_RUN _WS_QREC_AT _WS_QREC_TOKEN _WS_QREC_CHECKOUTS(still
                                         #   encoded) | 1 absent | 2 malformed (a body id= that is not the name's id included), or no
                                         #   quarantine path could be resolved
  _ws_collect_records_of <id>            # 0 + _WS_QRECS[] (also printed, one per line; none when the dir is PROVEN absent) | 2 (_WS_QRECS_WHY)
  _ws_collect_record_drop <file>         # 0 gone, PROVEN | 1 not a record path, untouched | 2 not proven gone (_WS_QREC_WHY)
  WS_COLLECT_RECORD_MAX=65536
  # 4B
  _ws_collect_now_ns                     # stdout: epoch ns (`date +%s%N`) — a clock seam a test may redefine to name the instant
  _ws_collect_qdir                       # 0 + _WS_Q = <physical ~/.cc-tmp>/.ccd-quarantine (made 0700 when PROVEN absent) | 2 (_WS_Q_WHY)
  _ws_collect_slot_path <q> <id>         # 0 + _WS_SLOT = <q>/slot.<id>.<ns>.<pid> (not made) | 2
  _ws_collect_slot_make <slot>           # 0 made by this call | 1 the name stands, never reused | 2 (_WS_SLOT_WHY)
  _ws_collect_mv <src> <dst>             # mv -T -n --no-copy's own rc; 2 on Darwin, mv never run — THE one GNU spelling
  _ws_collect_mv_ok                      # 0 this box's mv has --no-copy (asked once, cached in _WS_MV_NOCOPY) | 1 no, or Darwin
  _ws_collect_ident <path> <dev:ino> <btime>     # 0 a real directory (lstat) with these | 1 anything else, or nothing | 2 unreadable
  _ws_collect_move <src> <dst> <dev:ino> <btime> # 0 PROVEN moved (dst is it AND src proven absent) | 1 PROVEN not moved (src is
                                         #   still it) | 2 unmeasured (_WS_MOVE_WHY) — the restore uses the same call, reversed
  # 4C
  WS_COLLECT_IDLE_SCAN_S=60  WS_COLLECT_IDLE_CAP=2000000
  _ws_collect_idle <leaf>                # 0 + _WS_IDLE_NEWEST_NS _WS_IDLE_COUNT _WS_IDLE_LEAF | 2 + _WS_IDLE_WHY ∈ {timeout, unreadable,
                                         #   cap, walk-failed} and _WS_IDLE_DETAIL (Darwin, and a link/file/absent leaf: walk-failed)
  _ws_collect_floor_s                    # stdout: 86400, or WS_COLLECT_IDLE_FLOOR_S when a whole number ABOVE it — the floor's ONE
                                         #   definition; a sourced test harness lowers it only by redefining this function (G4)
  _ws_collect_floor_held <newest-ns>     # 0 now - newest >= floor | 1 not yet | 2 clock or input unreadable
  _ws_collect_token <id>                 # stdout: the token | rc 2, nothing printed; binds mode=collect id dev ino btime run at
                                         #   newestCtimeNs entries, from the caller's last witness read and last walk of <…>/<id>
  # 4D
  _ws_collect_rows_clear <id> <leaf>     # 0 no row at/inside/through leaf | 1 one does, or <id>'s own .workdir row stands
                                         #   (_WS_COLLECT_ROWS_WHY) | 2 unmeasured (_WS_COLLECT_ROWS_WHY); call it under _ws_reclaim_contained
  # 4E (RECLAIM region)
  _WS_CHECKOUTS_ACCEPTED                 # after _ws_leaf_checkouts rc 0: comma list of `<enc admin>=<enc back-link>`, one per outside
                                         #   admin directory a back-link let pass ('' = none); reset on every call
  _ws_leaf_checkouts <leaf> [<alias> <accepted>]                    # the alias pair is additive; absent = today's answer, exactly
  _ws_leaf_remove <root> <id> [<expect-devino> [<alias> <accepted>]] # hands the pair to the checkout question, unchanged
  ```
  - **For Task 6, the composition this task assumes:**
    - `_ws_collect_qdir`, then `_ws_collect_slot_path "$_WS_Q" "$id"`, then `_ws_collect_record_write "$id" "$_WS_SLOT" "$token"`, then `_ws_collect_slot_make "$_WS_SLOT"` — record first, slot second (R66).
    - The leaf's PHYSICAL pre-move spelling is `${_WS_Q%/.ccd-quarantine}/$id`. Task 6 moves it to `$_WS_SLOT/leaf`, and passes the same string as the alias, because git back-links the physical path (measured in 4E's first case).
    - The removal is `_ws_leaf_remove "$_WS_SLOT" leaf "$dev:$ino" "<alias>" "$_WS_QREC_CHECKOUTS"`.
    - On a resume the slot is the record's `_WS_QREC_SLOT`, DERIVED from the record's name under `_ws_collect_qpath` (G5); no record body names it.
    - The row rule is `_ws_collect_rows_clear "$id" "$HOME/.cc-tmp/$id"` (the spelling `_child_tmpdir` hands out), asked contained.
    - A forward `_ws_collect_move` answering anything but 0 is the verb's unmeasured answer (`probe-unmeasured`): rc 1 is "not moved, proven", which is how EXDEV under `--no-copy` and a NOREPLACE refusal both read. A restore answering anything but 0 keeps the record and the slot.

#### 4-act — the `collect` act (moved from Task 7 Part A, ruling G1)

**Why `collect` is NEUTRAL to the instrument, and never a put-down to the dead-coordinator lane.** The collector acts only on an id for which no registry row and no `.child` marker stands (R68: `registered` refuses otherwise). Three consequences follow:
- **What it removes.** Whatever removed that workspace already journaled its own act (`reap`, `reclaim`, `expire`, `destroy`, `purge` or `forget`). `collect` removes only the dead id's leftover temp-root inode.
- **The instrument.** `deploy/measure-workspace-lifecycle.py` pairs an `archive` with the next return. An archived workspace has a row, so a `collect` can never stand between an archive and its return. Nor does it END an archive, because it removes no workspace: the act that removed the row ends it, or `create` on a recycled slug. NEUTRAL is the only true class. Listing it in `ENDS_THE_ARCHIVE` would turn a removal line the best-effort journal LOST into a measured end.
- **The dead-coordinator lane.** `server/src/deadCoordinator.ts` reads a deliberate act since the last start as "this coordinator was put down on purpose", and then never ends its programme. A `collect` of a crashed coordinator's temp root says nothing about how that coordinator ended: the server's own lane writes it after the row is gone.
  - Counted as deliberate, it would hide the crash and keep the dead programme's runs open forever. That is the wedge the lane exists to clear.
  - The lane's "doubt never reads as a crash" rule covers `unknown`, an act this build cannot name. `collect` is a named act with a known meaning.
  - R65 rules the same exclusion for wave 8's R61 removal set.

- [ ] **Step act-0: Measure where the act stands**

```bash
grep -n '^_LC_ACTS=(' ccd/ccd                                         # (a1) one line, < 19109 (b0647d850: 4368)
sed -n "$(grep -n '^_LC_ACTS=(' ccd/ccd | cut -d: -f1),+2p" ccd/ccd | grep -cw collect   # (a2) 0
grep -n "  | 'collect'" shared/api.ts                                 # (a3) nothing
ls pwa/node_modules/.bin/vitest pwa/node_modules/.bin/tsc            # (a4) present, else npm ci in pwa/ (Step act-4 runs pwa's vitest and tsc; Task 7 C0 (c5)'s check)
```

- If (a2) prints 1 or (a3) prints a line, an earlier task already declared the act. Run this part as a VERIFICATION pass: write the tests, expect them green, skip the code edits that already exist, and report which task carried them.

- [ ] **Step act-1: Write the failing test, and move the cardinals**

Create `server/test/ws-collect-act.test.ts`:

```ts
// The `collect` journal act (child reclamation spec 2026-09-22 §5.6, §8's wave 7): ws-collect's own act word, in every
// declaration — ccd's `_LC_ACTS`, L0's union and map, the PWA's word — and placed by the two readers that classify acts
// by name: the workspace-lifecycle instrument (NEUTRAL: it neither returns from an archive nor ends one) and the
// dead-coordinator clause (NOT a deliberate put-down). The collector acts only on an id no registry row and no child
// marker stands for, so whatever removed that workspace journaled its own act; `collect` removes a dead id's leftover
// temp root and says nothing about how the session ended. FIXTURE HOME ONLY.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIFECYCLE_ACTS, isLifecycleAct } from '../../shared/api.js';
import {
  DEAD_COORDINATOR_DELIBERATE_ACTS, DEAD_COORDINATOR_JOURNAL_ACTS, DEAD_COORDINATOR_JOURNAL_TRUSTED,
  deadCoordinatorJournal, type DeadCoordinatorJournalRow,
} from '../src/deadCoordinator.js';
import { makeCcdHarness } from './ccdWsHelpers.js';
import { NO_TMUX, readJournal } from './lifecycleHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTRUMENT = path.join(ROOT, 'deploy', 'measure-workspace-lifecycle.py');
/** One of the instrument's act tuples, read the way `measure-workspace-lifecycle.test.ts` reads them. */
const tuple = (name: string): string[] => {
  const m = new RegExp(`^${name} = \\(([^)]*)\\)`, 'm').exec(readFileSync(INSTRUMENT, 'utf8'));
  expect(m, name).not.toBeNull();
  return m![1]!.split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
};

const NOW = 1_790_000_000_000;
const GEN = '1790000000000000000';
const row = (act: string, over: Partial<DeadCoordinatorJournalRow> = {}): DeadCoordinatorJournalRow =>
  ({ act: act as DeadCoordinatorJournalRow['act'], outcome: 'done', at: NOW, gen: GEN, dec: null, meas: null, raw: '{}', ...over });
/** A successful start, as ccd writes it: `meas.rc` the STRING "0" on the line's own bytes. */
const started = row('spawn', { raw: JSON.stringify({ v: 1, act: 'spawn', outcome: 'done', meas: { rc: '0' } }) });

describe('the collect act — declared in L0 and in ccd', () => {
  it('L0 names it', () => {
    expect(isLifecycleAct('collect')).toBe(true);
    expect(LIFECYCLE_ACTS).toContain('collect');
  });

  it('ccd carries it in _LC_ACTS and journals `collect` as ITSELF — never the unknown degrade with a badact', () => {
    const h = makeCcdHarness('ccrc-ws-collect-act-');
    try {
      const acts = h.sh('printf "%s\\n" "${_LC_ACTS[@]}"').split('\n').map((l) => l.trim()).filter(Boolean);
      expect(acts.length, 'guards the guard: ccd answered its array').toBeGreaterThan(20);
      expect(acts).toContain('collect');
      h.sh(`${NO_TMUX} _lc_emit collect done demo-quiet-basin "" verb ws-collect`);
      const ev = readJournal(h.home).filter((e) => e['id'] === 'demo-quiet-basin');
      expect(ev.map((e) => e['act'])).toEqual(['collect']);
      expect(ev[0]!['badact']).toBeUndefined();
    } finally { h.cleanup(); }
  }, 60_000);
});

describe('collect removes no workspace and puts down no session — both act readers place it', () => {
  it('the workspace-lifecycle instrument classifies it NEUTRAL: no return from an archive, and no end of one', () => {
    expect(tuple('NEUTRAL_ACTS')).toContain('collect');
    expect(tuple('ENDS_THE_ARCHIVE'), 'it removes no workspace').not.toContain('collect');
    expect(tuple('RETURN_ACTS'), 'it brings nothing back').not.toContain('collect');
  });

  it('the dead-coordinator clause never reads it as a deliberate put-down, and its store read never fetches it', () => {
    expect(DEAD_COORDINATOR_DELIBERATE_ACTS).not.toContain('collect');
    expect(DEAD_COORDINATOR_JOURNAL_ACTS).not.toContain('collect');
    expect(deadCoordinatorJournal([started, row('collect', { at: NOW + 1 })], true, DEAD_COORDINATOR_JOURNAL_TRUSTED))
      .toEqual({ kind: 'quiet', started: true });
    // CONTROL: the same position holding a real put-down reads deliberate, so the row above was read, not skipped.
    expect(deadCoordinatorJournal([started, row('expire', { at: NOW + 1 })], true, DEAD_COORDINATOR_JOURNAL_TRUSTED))
      .toEqual({ kind: 'deliberate', act: 'expire', at: NOW + 1 });
  });
});
```

Then move the cardinals that `collect` changes. Each edit is in place, and no line is added:
- `server/test/lifecycle-acts.test.ts:18`: change `reclaim: true, expire: true, rehome: true,` to `reclaim: true, expire: true, collect: true, rehome: true,`. Change `:33` `expect(ACTS.length).toBe(27);` to `toBe(28)`, and `:54` `.toHaveLength(26);` to `.toHaveLength(27);`.
- `server/test/lifecycle-vocabulary.test.ts:149`: change `(26 = 23 + unarchive, …, + expire, an archived workspace’s)').toBe(26);` to `(27 = 23 + unarchive, the archive stamp a spawn clears, + reclaim, a child’s pin-then-teardown, + expire, an archived workspace’s, + collect, a dead child’s witnessed temp root)').toBe(27);`.
- `server/test/ccd-lifecycle-emit.test.ts:28`: change `.toBe(26);` to `.toBe(27);`.
- `server/test/single-definition.test.ts:3077`: change `expect(LIFECYCLE_ACTS.length).toBe(27);` to `expect(LIFECYCLE_ACTS.length).toBe(28);`. This file is CITED by the frozen corpus, so the line count stays the same.

- [ ] **Step act-2: Run them to see them fail**

```bash
(cd server && ./node_modules/.bin/vitest run test/ws-collect-act.test.ts test/lifecycle-acts.test.ts test/lifecycle-vocabulary.test.ts test/ccd-lifecycle-emit.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'act scan is looking at something')
```

Expected:
- `ws-collect-act`: "L0 names it" fails with `expected false to be true`. The ccd case fails with `expected [ 'archive', 'attic-drop', … ] to include 'collect'`. The instrument case fails with `expected [ 'attic-drop', 'claim', … ] to include 'collect'`.
  - The dead-coordinator case PASSES. It is a pin against a future edit, and mutation row ACT6 reds it.
- `lifecycle-acts`:
  - `isLifecycleAct accepts exactly the declared acts > collect` fails with `expected false to be true`;
  - `covers the whole union` fails with `expected [ …27 ] to deeply equal [ …28 ]`;
  - the degrade case fails with `expected [ … ] to have a length of 27 but got 26`.
- `lifecycle-vocabulary` and `ccd-lifecycle-emit` fail with `expected 26 to be 27`. `single-definition` fails with `expected 27 to be 28`.

- [ ] **Step act-3: Implement**

**E6, `ccd/ccd`, length-neutral.** Change the first line of `_LC_ACTS`:

```bash
_LC_ACTS=(archive attic-drop claim collect create destroy enable ensure expire forget gc
```

The other two lines of the array stay as they are.

**`shared/api.ts`.** Directly after the four lines of the `| 'expire'` member, insert:

```ts
  | 'collect'       // ws-collect (spec 2026-09-22 §5.6): a witnessed child TEMP ROOT whose
                    // workspace is already gone, moved aside and removed. Its own act, never
                    // `reclaim`'s: it removes no workspace and puts down no session (no row
                    // stands for the id when it acts), so no removal set counts it.
```

In `LIFECYCLE_ACT_MAP`, change `'attic-drop': true, reap: true, reclaim: true, expire: true, rehome: true,` to `'attic-drop': true, reap: true, reclaim: true, expire: true, collect: true, rehome: true,`. It stays one line.

**`pwa/src/session/journalWords.ts:32`.** Change `reap: 'reaped', reclaim: 'reclaimed', expire: 'expired', rehome:` to `reap: 'reaped', reclaim: 'reclaimed', expire: 'expired', collect: 'temp root collected', rehome:`.

**`deploy/measure-workspace-lifecycle.py`.** Replace the `NEUTRAL_ACTS` block and its comment with:

```python
# ccd's `_LC_ACTS` members that neither return from an archive nor end it. With `archive` itself, the three lists
# classify every act exactly once — measure-workspace-lifecycle.test.ts runs ccd's array and reds on an act that has
# no place here, so a new act is decided, never silently ignored. `collect` is here: it acts only on an id no
# registry row stands for, so it never meets an archived workspace, and it removes no workspace to end one.
NEUTRAL_ACTS = ('attic-drop', 'claim', 'enable', 'gc', 'hold', 'release', 'rename', 'rehome', 'route', 'stop',
                'supervise', 'unsupervise', 'collect')
```

**`server/src/deadCoordinator.ts`.** The list is UNCHANGED. Replace its docstring with:

```ts
/** The acts that put a session down ON PURPOSE (spec §5.4): ccd's `stop`, `archive`, `reap`, `destroy`, `purge` and
 *  `forget` (`_LC_ACTS`), CCR-15's `reclaim` and stage 3's `expire`. An `unsupervise` counts when it carries a
 *  DECLARED surface — `_ws_unsupervise`'s `dec.surface`, which reads `none` when ccd acted on its own account.
 *  `collect` (child reclamation spec 2026-09-22 §5.6) is deliberately NOT one, and the clause's store read never
 *  fetches it: the collector acts only where no registry row and no child marker stands, so it removes a dead id's
 *  leftover temp root and says nothing about how the session ended. Read as a put-down it would hide a crash and keep
 *  a dead programme open; `ws-collect-act.test.ts` pins it out. */
```

- [ ] **Step act-4: Re-stamp, run green, and run the gates**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd; echo "mark rc=$?"                       # rc=0
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ws-collect-act.test.ts test/lifecycle-acts.test.ts test/lifecycle-vocabulary.test.ts test/ccd-lifecycle-emit.test.ts)
(cd server && ./node_modules/.bin/vitest run test/measure-workspace-lifecycle.test.ts test/dead-coordinator-policy.test.ts test/lifecycle-wire.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)
(cd server && ./node_modules/.bin/tsc --noEmit -p .)
(cd pwa && ./node_modules/.bin/vitest run test/journal-words.test.ts)
(cd pwa && ./node_modules/.bin/tsc --noEmit)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND')
```

Expected: every suite green, `tsc` silent in both packages, `mark rc=0` and `ownership` green.

**The citation cases.** The four lines added to `shared/api.ts` sit above README's one `shared/api.ts:` sentence (`grep -n 'shared/api.ts:[0-9]' README.md`, one hit; at `b0647d850` README.md:4797 cites `:7873-7875`, `:7919`, `:7927` and `:7940`). Task 1 has moved them, so treat them as hints. This part pays README's `shared/api.ts:` re-pointing for the four `LifecycleAct` lines in its own commit; Tasks 5 and 6 repair from there.

Expect `README HAS ITS OWN CENSUS ENTRY` to red on those anchors. REPAIR THEM BY CONTENT, never by arithmetic:
1. Read the new line numbers:
   ```bash
   grep -n "  | 'purge-refused'\|  | 'purge-incomplete'\|  | 'purge-mechanism-absent'\|^  'purge-refused':\|^  'purge-incomplete':\|^  'purge-mechanism-absent':" shared/api.ts
   ```
2. Re-point the README sentence at what that prints.
3. Re-run the describe until it is green.

README is under claim 1110 until it ends (Task 0). If anything OTHER than README reds (`ccd/ccd`, `shared/api.ts` or `single-definition.test.ts` in the CITATION DEBT map), STOP and report: a frozen-corpus census is never adjusted here.

- [ ] **Step act-5: Mutation check**

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| ACT1 | In `_LC_ACTS`, delete `collect ` (re-stamp) | `(cd server && ./node_modules/.bin/vitest run test/ws-collect-act.test.ts test/ccd-lifecycle-emit.test.ts)` | ws-collect-act: `expected [ … ] to include 'collect'` and `expected [ 'unknown' ] to deeply equal [ 'collect' ]`. ccd-lifecycle-emit: `expected [ …26 ] to deeply equal [ …27 ]` |
| ACT2 | In `LIFECYCLE_ACT_MAP`, delete `collect: true, ` (the union member stays) | `(cd server && ./node_modules/.bin/vitest run test/lifecycle-acts.test.ts)` | `collect`: `expected false to be true`. `server tsc` also reports `TS2741: Property 'collect' is missing` |
| ACT3 | In `ACT_WORD`, delete `collect: 'temp root collected', ` | `(cd pwa && ./node_modules/.bin/vitest run test/journal-words.test.ts)` | `no word for act collect: expected undefined to be truthy`. `pwa tsc` also reports TS2741 |
| ACT4 | Move `'collect'` from `NEUTRAL_ACTS` to the end of `ENDS_THE_ARCHIVE` | `(cd server && ./node_modules/.bin/vitest run test/ws-collect-act.test.ts)` | `expected [ … ] to include 'collect'` (NEUTRAL), then `it removes no workspace: expected [ …, 'collect' ] not to include 'collect'` |
| ACT5 | Delete `, 'collect'` from `NEUTRAL_ACTS` | `(cd server && ./node_modules/.bin/vitest run test/measure-workspace-lifecycle.test.ts)` | `its act lists classify every one of ccd’s _LC_ACTS exactly once`: `expected [ … ] to deeply equal [ …, 'collect', … ]` |
| ACT6 | Append `'collect'` to `DEAD_COORDINATOR_DELIBERATE_ACTS` | `(cd server && ./node_modules/.bin/vitest run test/ws-collect-act.test.ts)` | `expected [ …, 'collect' ] not to include 'collect'`, then `expected { kind: 'deliberate', act: 'collect', … } to deeply equal { kind: 'quiet', started: true }` |

Revert each mutation, re-stamp, and re-run Step act-4's commands green.

- [ ] **Step act-6: Commit**

```bash
git add ccd/ccd shared/api.ts pwa/src/session/journalWords.ts deploy/measure-workspace-lifecycle.py \
  server/src/deadCoordinator.ts server/test/ws-collect-act.test.ts server/test/lifecycle-acts.test.ts \
  server/test/lifecycle-vocabulary.test.ts server/test/ccd-lifecycle-emit.test.ts server/test/single-definition.test.ts
git add README.md   # only if Step act-4 re-pointed its shared/api.ts anchors
git commit -m "$(cat <<'MSG'
feat(lifecycle): the collect act, in every declaration, out of every removal set

ws-collect's own journal act: ccd's _LC_ACTS (on its existing line), L0's
union and map, the PWA's word. The two readers that classify acts by name
place it: the workspace-lifecycle instrument reads it NEUTRAL (it never
meets an archived workspace and removes none), and the dead-coordinator
clause never reads it as a deliberate put-down (the collector acts only
where no row stands, so it says nothing about how a session ended).
Cardinals move 27 -> 28.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

- [ ] **Step 0: Entry checks for 4A–4E, after 4-act's commit** (stop and report if any differs)

```bash
grep -c 'COLLECT-BEGIN' ccd/ccd                                  # 0 — the region does not exist yet
grep -n 'EXPIRE-END' ccd/ccd | wc -l                              # 1 — the insertion anchor
node shared/mark.mjs --check ccd/ccd                              # ccd/ccd: ccrc-unmodified
grep -n '^_ws_leaf_checkouts() {   # leaf -> 0 when no checkout' ccd/ccd | wc -l   # 1 — no alias yet
grep -c 'tmpquarantine' ccd/ccd                                   # 0
sed -n "$(grep -n '^_LC_ACTS=(' ccd/ccd | cut -d: -f1)p" ccd/ccd | grep -cw collect   # 1 — 4-act declared the act (G1)
grep -c 'ccd-collect-' server/test/git-env-strip.test.ts          # 0 — G12's SCOPE edit is 4A's
LC_ALL=C mv --help | grep -c -e '--no-copy'                       # >= 1 on the Linux box the suite runs on
LC_ALL=C find --version | head -1                                 # GNU findutils (the walk prints %C@)
```

#### 4A — the quarantine record and `$REG/tmpquarantine/`

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-collect-record.test.ts`:

```ts
// The temp-root collector's QUARANTINE RECORD (child reclamation wave 7,
// spec §5.2 and §5.6): `$REG/tmpquarantine/<id>.<ns>.<pid>`, written before
// anything moves and dropped last, the collector's resume authority. One
// versioned key=value line: the witness line the act was taken on, the token,
// and the checkouts the pre-move question let pass, in `_ws_collect_enc`'s
// spelling. It names NO slot path (ruling G5): the slot is DERIVED from the
// record's name under the physical quarantine. Found by EXACT parse —
// the name less its two trailing all-digit dot-fields — never by a `<id>.*`
// prefix, because ids admit dots. `tmpquarantine/` is a DOTLESS registry
// subdirectory, as `tmproots/` is: no registry walker sees it.
//
// FIXTURE HOMES ONLY (`makePrHarness`, built on `makeCcdHarness`): every
// registry, record and leaf is under the harness's HOME. Nothing here runs a
// destructive verb.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD } from './ccdWsHelpers.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { seedRoster } from './helpers.js';
import { localIO } from '../src/io.js';
import { loadConfig } from '../src/config.js';
import { readRegistryMeasured } from '../src/registry.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-record-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
const NS = '1791470480213200844';
const PID = '4242';
const TOKEN = 'ab'.repeat(32);
const ROOT_USER = process.getuid?.() === 0;
const reg = (): string => path.join(h.home, '.cc-sessions');
const qrecDir = (): string => path.join(reg(), 'tmpquarantine');
const recPath = (id: string = ID, ns: string = NS, pid: string = PID): string => path.join(qrecDir(), `${id}.${ns}.${pid}`);
/** The PHYSICAL quarantine, as ccd derives it (`_ws_collect_qpath`); `~/.cc-tmp` is made so that it resolves. */
const qOf = (): string => {
  fs.mkdirSync(path.join(h.home, '.cc-tmp'), { recursive: true });
  return path.join(fs.realpathSync(path.join(h.home, '.cc-tmp')), '.ccd-quarantine');
};
const slotOf = (id: string = ID, ns: string = NS, pid: string = PID): string => path.join(qOf(), `slot.${id}.${ns}.${pid}`);
const leaf = (id: string = ID): string => path.join(h.home, '.cc-tmp', id);

/** The REAL witness of `id`'s leaf, written and read, so `_WS_WIT_*` hold it. */
const WITNESS = (id: string = ID, runId = '7'): string =>
  `mkdir -p -m 0700 "${leaf(id)}" && _ws_tmproot_witness_write ${id} "${leaf(id)}" ${runId} && _ws_tmproot_witness_read ${id};`;
/** Witness, then the record — the writer's answer and why. */
const write = (opts: { id?: string; slot?: string; token?: string; pre?: string } = {}): { rc: string; why: string } => {
  const id = opts.id ?? ID;
  const [rc = '', why = ''] = h.sh(`${opts.pre ?? WITNESS(id)} _ws_collect_record_write '${id}' '${opts.slot ?? slotOf(id)}' '${opts.token ?? TOKEN}';`
    + ' rc=$?; printf \'%s\\x1f%s\' "$rc" "$_WS_QREC_WHY"').split('\x1f');
  return { rc, why };
};
const FIELDS = '"$_WS_QREC_ID|$_WS_QREC_SLOT|$_WS_QREC_DEV|$_WS_QREC_INO|$_WS_QREC_BTIME|$_WS_QREC_RUN|$_WS_QREC_AT|$_WS_QREC_TOKEN|$_WS_QREC_CHECKOUTS"';
/** Reads a GOOD record first, so a failing read must also CLEAR every field. */
const read = (file: string): string => {
  const seed = recPath('demo-good-seed', '1', '2');
  fs.mkdirSync(qrecDir(), { recursive: true });
  qOf();
  fs.writeFileSync(seed, `v=1 id=demo-good-seed dev=1 ino=2 btime=3 run=4 at=1791470480213 token=${TOKEN} checkouts=\n`);
  return h.sh(`_ws_collect_record_read '${seed}' >/dev/null; _ws_collect_record_read '${file}'; printf '[rc=%s] %s' "$?" ${FIELDS}`);
};
const EMPTY = '||||||||';
const GOOD = (): string =>
  `v=1 id=${ID} dev=2064 ino=35 btime=1791468463 run=7 at=1791470480213 token=${TOKEN} checkouts=\n`;
const plant = (text: string, file: string = recPath()): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

describe('_ws_collect_record_write: one line, temp file then rename, proven by reading it back', () => {
  it('writes ONE versioned line naming the witness it acted on, the token and no checkouts — and no slot path (G5)', () => {
    const w = write();
    expect(w.rc, w.why).toBe('0');
    const wit = fs.readFileSync(path.join(reg(), 'tmproots', ID), 'utf8').trim();
    const f = (k: string): string => new RegExp(` ${k}=(\\S+)`).exec(wit)![1]!;
    expect(fs.readFileSync(recPath(), 'utf8')).toBe(
      `v=1 id=${ID} dev=${f('dev')} ino=${f('ino')} btime=${f('btime')} run=7 at=${f('at')} token=${TOKEN} checkouts=\n`);
    expect(fs.readdirSync(qrecDir()), 'temp file then rename: nothing else is left').toEqual([`${ID}.${NS}.${PID}`]);
    expect((fs.statSync(qrecDir()).mode & 0o777).toString(8), 'made 0700 on first write').toBe('700');
  });

  it('a checkout pair whose paths hold a space, a comma, an `=` and a `%` is spelled %XX, and reads back whole', () => {
    const admin = '/r 2,x=%/.git/worktrees/wt';
    const back = '/h/.cc-tmp/x/wt/.git';
    const spelled = '/r%202%2Cx%3D%25/.git/worktrees/wt=/h/.cc-tmp/x/wt/.git';
    const w = write({ pre: `${WITNESS()} _WS_CHECKOUTS_ACCEPTED="$(_ws_collect_enc '${admin}')=$(_ws_collect_enc '${back}')";` });
    expect(w.rc, w.why).toBe('0');
    expect(fs.readFileSync(recPath(), 'utf8')).toContain(` checkouts=${spelled}\n`);
    expect(read(recPath()).split('|')[8]).toBe(spelled);
  });

  it('the checkouts are the caller’s last _WS_CHECKOUTS_ACCEPTED, carried in their own spelling', () => {
    const co = '/r/.git/worktrees/wt=/h/.cc-tmp/x/wt/.git,/r%202/.git/worktrees/b=/h/.cc-tmp/x/b/.git';
    const w = write({ pre: `${WITNESS()} _WS_CHECKOUTS_ACCEPTED='${co}';` });
    expect(w.rc, w.why).toBe('0');
    expect(fs.readFileSync(recPath(), 'utf8')).toMatch(new RegExp(` checkouts=${co.replace(/[.%/]/g, '\\$&')}\\n$`));
  });

  it.each([
    ['an id no witness is named for', () => ({ id: '.hidden' }), 'not an id a witness is named for'],
    ['a slot named for ANOTHER id', () => ({ slot: slotOf('demo-quiet-reef') }), 'is not a slot named for'],
    ['a slot named for a NESTED id', () => ({ slot: slotOf('demo-quiet-mesa.v2-x') }), 'is not a slot named for'],
    ['a slot with no `slot.` prefix', () => ({ slot: `/x/${ID}.${NS}.${PID}` }), 'not a quarantine slot'],
    ['a relative slot', () => ({ slot: `slot.${ID}.${NS}.${PID}` }), 'not a quarantine slot'],
    ['a slot outside the physical quarantine', () => ({ slot: path.join(h.home, 'elsewhere', `slot.${ID}.${NS}.${PID}`) }), 'is not in the quarantine'],
    ['a token ccd never mints', () => ({ token: 'XYZ' }), 'not one ccd mints'],
    ['no witness read', () => ({ pre: '' }), 'no witness of'],
    ['a witness with no birth time', () => ({ pre: `${WITNESS()} _WS_WIT_BTIME=-;` }), 'no witness of'],
    ['a checkouts list ccd never writes', () => ({ pre: `${WITNESS()} _WS_CHECKOUTS_ACCEPTED='a b=c';` }), 'not a list ccd writes'],
  ] as const)('refuses %s: rc 1, nothing written', (_label, opts, why) => {
    const w = write(opts());
    expect(w.rc, w.why).toBe('1');
    expect(w.why).toContain(why);
    expect(fs.existsSync(qrecDir()) ? fs.readdirSync(qrecDir()) : []).toEqual([]);
  });

  it('a record that stands is NEVER overwritten', () => {
    plant('a record that stands\n');
    const w = write();
    expect(w.rc, w.why).toBe('1');
    expect(w.why).toContain('never overwritten');
    expect(fs.readFileSync(recPath(), 'utf8')).toBe('a record that stands\n');
  });

  it('a LINKED tmpquarantine/ is refused, never written through', () => {
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, qrecDir());
    const w = write();
    expect(w.rc, w.why).toBe('1');
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it('a FILE at tmpquarantine/ is refused', () => {
    fs.writeFileSync(qrecDir(), 'in the way');
    expect(write().rc).toBe('1');
  });

  it('a record that would pass the size cap is not written', () => {
    const big = Array.from({ length: 700 }, (_, i) => `/r/.git/worktrees/w${i}=/h/.cc-tmp/x/${'p'.repeat(80)}${i}/.git`).join(',');
    const w = write({ pre: `${WITNESS()} _WS_CHECKOUTS_ACCEPTED='${big}';` });
    expect(w.rc, w.why).toBe('1');
    expect(w.why).toContain('more than 65536 bytes');
  });

  it('a record that does not read back is removed, and answers 1', () => {
    const w = write({ pre: `${WITNESS()} _ws_collect_record_read() { return 2; };` });
    expect(w.rc, w.why).toBe('1');
    expect(w.why).toContain('did not read back');
    expect(fs.existsSync(recPath())).toBe(false);
  });
});

describe('_ws_collect_record_read: parsed, absent, or malformed — three answers, every field cleared first', () => {
  it('rc 0 sets every field; the slot is DERIVED from the name under the physical quarantine, and the checkouts stay spelled', () => {
    plant(GOOD().replace('checkouts=', 'checkouts=/a%20b=/c'));
    expect(read(recPath())).toBe(`[rc=0] ${ID}|${slotOf()}|2064|35|1791468463|7|1791470480213|${TOKEN}|/a%20b=/c`);
  });

  it('rc 1 when nothing stands there', () => {
    expect(read(recPath())).toBe(`[rc=1] ${EMPTY}`);
  });

  it('rc 2 when the physical quarantine cannot be resolved — the slot is derived, never read from the body', () => {
    plant(GOOD());
    fs.rmSync(path.join(h.home, '.cc-tmp'), { recursive: true, force: true });
    expect(h.sh(`_ws_collect_record_read '${recPath()}'; echo "[rc=$?]"`)).toBe('[rc=2]');
  });

  it.each([
    ['no trailing newline', (g: string) => g.slice(0, -1)],
    ['a second line', (g: string) => `${g}${g}`],
    ['another id in the body', (g: string) => g.replace(`id=${ID}`, 'id=demo-quiet-reef')],
    ['a body that still names a slot (the field G5 removed)', (g: string) => g.replace(' dev=', ' slot=/q/slot.x dev=')],
    ['a birth time of -', (g: string) => g.replace('btime=1791468463', 'btime=-')],
    ['a run outside the grammar', (g: string) => g.replace('run=7', 'run=07')],
    ['an unknown version', (g: string) => g.replace('v=1', 'v=2')],
    ['keys out of order', (g: string) => g.replace('dev=2064 ino=35', 'ino=35 dev=2064')],
    ['a token ccd never mints', (g: string) => g.replace(TOKEN, 'X'.repeat(64))],
    ['a checkouts list ccd never writes', (g: string) => g.replace('checkouts=', 'checkouts=a,')],
    ['an oversize body', (g: string) => `${g.slice(0, -1)}${'%41'.repeat(22000)}\n`],
  ])('rc 2 for %s', (_label, edit) => {
    plant(edit(GOOD()));
    expect(read(recPath())).toBe(`[rc=2] ${EMPTY}`);
  });

  it('rc 2 for a NAME that is no record’s — dot-leading, or no two trailing all-digit fields', () => {
    for (const n of [`.${ID}.${NS}.${PID}`, `${ID}.${NS}`, `${ID}.${NS}.x`, `.${ID}.${NS}.${PID}.4242.17.tmp`]) {
      const f = path.join(qrecDir(), n);
      plant(GOOD(), f);
      expect(read(f), n).toBe(`[rc=2] ${EMPTY}`);
    }
  });

  it('rc 2 for a directory, a link to a GOOD record, and a linked tmpquarantine/', () => {
    fs.mkdirSync(recPath(), { recursive: true });
    expect(read(recPath())).toBe(`[rc=2] ${EMPTY}`);
    fs.rmdirSync(recPath());
    const good = path.join(h.home, 'good');
    fs.writeFileSync(good, GOOD());
    fs.symlinkSync(good, recPath());
    expect(read(recPath())).toBe(`[rc=2] ${EMPTY}`);
    fs.rmSync(qrecDir(), { recursive: true });
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, `${ID}.${NS}.${PID}`), GOOD());
    fs.symlinkSync(elsewhere, qrecDir());
    expect(h.sh(`_ws_collect_record_read '${recPath()}'; echo "[rc=$?]"`)).toBe('[rc=2]');
  });

  it('CONTROL: what the writer writes, the reader reads', () => {
    const w = write();
    expect(w.rc, w.why).toBe('0');
    expect(read(recPath())).toMatch(new RegExp(`^\\[rc=0\\] ${ID}\\|${slotOf().replace(/[.]/g, '\\.')}\\|\\d+\\|\\d+\\|[1-9]\\d*\\|7\\|\\d{13}\\|${TOKEN}\\|$`));
  });
});

describe('_ws_collect_records_of: EXACT parse — a nested id is never matched', () => {
  const NESTED = 'p-calm-mesa.v2-quiet-river';
  const of = (id: string): { rc: string; out: string; arr: string } => {
    const [rc = '', out = '', arr = ''] = h.sh(`out=$(_ws_collect_records_of '${id}'); rc=$?; _ws_collect_records_of '${id}' >/dev/null;`
      + ` printf '%s\\x1f%s\\x1f%s' "$rc" "$out" "\${_WS_QRECS[*]-}"`).split('\x1f');
    return { rc, out, arr };
  };

  it('p-calm-mesa finds its own record and not p-calm-mesa.v2-quiet-river’s — and the reverse', () => {
    plant('x\n', recPath('p-calm-mesa', '11', '1'));
    plant('x\n', recPath(NESTED, '22', '2'));
    // The CONTROL, measured: the prefix glob the exact parse replaces matches BOTH.
    expect(h.sh(`compgen -G '${qrecDir()}/p-calm-mesa.*' | sort`).split('\n'))
      .toEqual([recPath('p-calm-mesa', '11', '1'), recPath(NESTED, '22', '2')].sort());
    expect(of('p-calm-mesa')).toEqual({ rc: '0', out: recPath('p-calm-mesa', '11', '1'), arr: recPath('p-calm-mesa', '11', '1') });
    expect(of(NESTED)).toEqual({ rc: '0', out: recPath(NESTED, '22', '2'), arr: recPath(NESTED, '22', '2') });
  });

  it('every record of the id is listed; a writer’s dot-leading temp file and a foreign name are not', () => {
    plant('x\n', recPath(ID, '11', '1'));
    plant('x\n', recPath(ID, '12', '2'));
    plant('x\n', path.join(qrecDir(), `.${ID}.${NS}.${PID}.4242.17.tmp`));
    plant('x\n', path.join(qrecDir(), `${ID}.notdigits.1`));
    plant('x\n', path.join(qrecDir(), ID));
    expect(of(ID).out.split('\n').sort()).toEqual([recPath(ID, '11', '1'), recPath(ID, '12', '2')].sort());
  });

  it('no tmpquarantine/ at all — PROVEN absent — is no record: rc 0, nothing', () => {
    expect(of(ID)).toEqual({ rc: '0', out: '', arr: '' });
  });

  it('a LINKED tmpquarantine/, and a FILE there, answer 2 — never "no record"', () => {
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, `${ID}.${NS}.${PID}`), 'x');
    fs.symlinkSync(elsewhere, qrecDir());
    expect(of(ID).rc).toBe('2');
    fs.unlinkSync(qrecDir());
    fs.writeFileSync(qrecDir(), 'x');
    expect(of(ID).rc).toBe('2');
  });

  it.skipIf(ROOT_USER)('a tmpquarantine/ that cannot be LISTED answers 2', () => {
    plant('x\n', recPath());
    fs.chmodSync(qrecDir(), 0o300);
    try {
      const a = of(ID);
      expect(a.rc).toBe('2');
      expect(h.sh(`_ws_collect_records_of ${ID} >/dev/null; printf '%s' "$_WS_QRECS_WHY"`)).toContain('could not list');
    } finally { fs.chmodSync(qrecDir(), 0o700); }
  });
});

describe('_ws_collect_record_drop: the record goes, PROVEN — and nothing that is not one', () => {
  it('drops a record and proves it gone', () => {
    plant('x\n', recPath());
    expect(h.sh(`_ws_collect_record_drop '${recPath()}'; echo "[rc=$?]"`)).toBe('[rc=0]');
    expect(fs.existsSync(recPath())).toBe(false);
  });

  it.each([
    ['a path outside tmpquarantine/', (): string => path.join(h.home, `${ID}.${NS}.${PID}`)],
    ['a dot-leading temp file', (): string => path.join(qrecDir(), `.${ID}.${NS}.${PID}.1.2.tmp`)],
    ['a name that is no record’s', (): string => path.join(qrecDir(), ID)],
  ])('%s answers 1 and is untouched', (_label, p) => {
    plant('keep\n', p());
    expect(h.sh(`_ws_collect_record_drop '${p()}'; echo "[rc=$?]"`)).toBe('[rc=1]');
    expect(fs.readFileSync(p(), 'utf8')).toBe('keep\n');
  });

  it('an rm that answers 0 and removed nothing is not proven gone: 2', () => {
    plant('x\n', recPath());
    expect(h.sh(`rm() { return 0; }; _ws_collect_record_drop '${recPath()}'; echo "[rc=$?]"`)).toBe('[rc=2]');
    expect(fs.existsSync(recPath())).toBe(true);
  });

  it('a DIRECTORY at the record’s name cannot be removed: 2', () => {
    fs.mkdirSync(path.join(recPath(), 'inside'), { recursive: true });
    expect(h.sh(`_ws_collect_record_drop '${recPath()}'; echo "[rc=$?]"`)).toBe('[rc=2]');
    expect(fs.existsSync(path.join(recPath(), 'inside'))).toBe(true);
  });
});

describe('$REG/tmpquarantine is invisible to every registry walker (spec §5.2, the tmproots/ precedent)', () => {
  /** Where ccd ITSELF keeps its records — never this file's own spelling of
   *  it — so each walker below is asked about the place ccd writes, wherever
   *  that is. */
  const qdir = (): string => h.sh('_ws_collect_qrec_dir');
  const seed = (id: string): void => {
    h.sh(`_reg_set ${id} wrapper claude
          _reg_set ${id} workdir '${h.home}'
          _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
  };
  /** A record of ID, written by the REAL writer, where ccd keeps it. */
  const recorded = (): { file: string; bytes: string } => {
    const w = write();
    expect(w.rc, `the CONTROL: the record was written — ${w.why}`).toBe('0');
    const file = path.join(qdir(), `${ID}.${NS}.${PID}`);
    return { file, bytes: fs.readFileSync(file, 'utf8') };
  };

  it('_reg_purge takes the row and leaves the record standing', () => {
    seed(ID);
    const r = recorded();
    h.sh(`_reg_purge ${ID}`);
    for (const f of ['uuid', 'wrapper', 'workdir']) expect(h.reg(ID, f), f).toBeNull();
    expect(fs.readFileSync(r.file, 'utf8')).toBe(r.bytes);
  });

  it('survives _reg_purge of a session whose id IS `tmpquarantine` — the collision shape', () => {
    const r = recorded();
    fs.writeFileSync(path.join(reg(), 'tmpquarantine.uuid'), 'u');
    fs.writeFileSync(path.join(reg(), 'tmpquarantine.wrapper'), 'claude');
    h.sh('_reg_purge tmpquarantine');
    expect(fs.existsSync(path.join(reg(), 'tmpquarantine.wrapper')), 'the CONTROL: that row was purged').toBe(false);
    expect(fs.readFileSync(r.file, 'utf8')).toBe(r.bytes);
  });

  it('a slug whose only trace is its record reads FREE, and _ws_slug_residue names nothing', () => {
    recorded();
    fs.rmSync(path.join(reg(), 'tmproots'), { recursive: true });
    expect(h.sh('_ws_slug_free demo quiet-mesa && echo free || echo taken')).toBe('free');
    expect(h.sh('_ws_slug_residue demo quiet-mesa')).toBe('');
  });

  it('`ccd ls` lists no row for it', () => {
    recorded();
    const out = h.sh('cmd_ls');
    expect(out).toContain('(no sessions)');
    expect(out).not.toContain('tmpquarantine');
  });

  it('the server’s registry read derives no session from it — the row beside it is the only one', async () => {
    seed('demo-calm-cove');
    recorded();
    seedRoster(h.home);
    const cfg = loadConfig({ CCRC_HOME: h.home, CCRC_PROJECTS_ROOT: path.join(h.home, 'projects') } as never);
    const r = await readRegistryMeasured(localIO, cfg);
    expect(r.listed).toBe(true);
    if (!r.listed) return;
    expect(r.names, 'the CONTROL: the listing does carry the directory').toContain(path.basename(qdir()));
    expect(r.records.map((x) => x.id)).toEqual(['demo-calm-cove']);
  });

  it('`tmpquarantine` is spelled only inside the COLLECT region, and its one walker is depth-1 and name-filtered', () => {
    // The census of THIS directory. The name-agnostic walker census in
    // `ccd-child-tmproot-witness.test.ts` proves no registry glob or find can
    // see a dotless subdirectory; this proves who may name this one.
    const src = fs.readFileSync(CCD, 'utf8');
    const b = src.indexOf('COLLECT-BEGIN');
    const e = src.indexOf('COLLECT-END');
    expect(b, 'COLLECT-BEGIN').toBeGreaterThan(-1);
    expect(e, 'COLLECT-END').toBeGreaterThan(b);
    const outside: string[] = []; const walkers: string[] = []; let at = 0;
    src.split('\n').forEach((line, i) => {
      const off = at; at += line.length + 1;
      if (/^\s*#/.test(line) || !line.includes('tmpquarantine')) return;
      if (off < b || off > e) outside.push(`ccd:${i + 1}: ${line.trim()}`);
      if (/\bfind\b/.test(line)) walkers.push(line.trim());
    });
    expect(outside).toEqual([]);
    expect(walkers).toHaveLength(1);
    expect(walkers[0]).toMatch(/-maxdepth 1\b/);
    expect(walkers[0]).toMatch(/-name\b/);
    for (const other of fs.readdirSync(path.dirname(CCD))) {
      const p = path.join(path.dirname(CCD), other);
      if (other === 'ccd' || !fs.statSync(p).isFile()) continue;
      const code = fs.readFileSync(p, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l) && l.includes('tmpquarantine'));
      expect(code, `ccd/${other} names tmpquarantine`).toEqual([]);
    }
  });
});
```

In `server/test/ccd-workspaces.test.ts`, directly after the two-line `ccd-child-tmproot-witness.test.ts` entry of `DISPOSITION`, add:

```ts
    { file: 'ccd-collect-record.test.ts', grammar: 'residue', count: 2,
      what: 'the collector\'s quarantine record census (child-reclamation wave 7): a case title and one assertion that `_ws_slug_residue` names nothing for a slug whose only trace is its dotless `$REG/tmpquarantine/<id>.<ns>.<pid>` record, the proof that the record is invisible to the slug walkers' },
```

In `server/test/git-env-strip.test.ts` (ruling G12), add these names to the `later` array of the case `SCOPE names every new ccd suite and fixture Tasks 3–11 create — before any of them exists` (`grep -n 'SCOPE names every new ccd suite' server/test/git-env-strip.test.ts`), directly after its last entry. They are this wave's ccd suites and fixtures, Task 1's to Task 9's:

```ts
      'ccd-collect-record.test.ts', 'ccd-collect-quarantine.test.ts', 'ccd-collect-idle-token.test.ts', 'ccd-collect-rows.test.ts',
      'ccd-leaf-checkouts-alias.test.ts', 'ws-collect-act.test.ts', 'ccd-reclaim-owned-rc.test.ts', 'ccd-reclaim-tail-refuted.test.ts',
      'ccd-expire-tail-refuted.test.ts', 'containmentRefutedFamilies.ts', 'ccd-collect-audit.test.ts', 'ccd-collect-audit-rungs.test.ts',
      'ccd-collect-audit-resume.test.ts', 'collectFixture.ts', 'ccd-ws-collect-verb.test.ts', 'ccd-ws-collect-move.test.ts',
      'ccd-ws-collect-reprove.test.ts', 'ccd-ws-collect-order.test.ts', 'ccd-ws-collect-resume.test.ts', 'ccd-ws-collect-reach.test.ts',
      'wsCollectFixture.ts', 'ccd-collect-race-spawn.test.ts', 'ccd-collect-race-crash.test.ts', 'ccd-collect-race-forge.test.ts',
      'ccd-collect-race-substrate.test.ts', 'ccd-collect-race-ids.test.ts', 'ccd-collect-race-admin.test.ts', 'ccd-collect-recycle-pins.test.ts',
      'collectRaceFixture.ts', 'ccd-dir-physical-builtin.test.ts', 'ccd-leaf-checkouts-pins.test.ts',
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-collect-record.test.ts` (FOREGROUND, timeout ≥ 600000 ms)

Expected: `Tests  52 failed (52)` (53 at drafting, less the four `slot=` reader rows G5 removed, plus G5's writer, reader-row and derivation cases; re-measure). Every case fails in one of two ways:
- with `bash: line 1: _ws_collect_record_write: command not found` (or `_ws_collect_record_read`, `_ws_collect_records_of`, `_ws_collect_qrec_dir`) and `_WS_QREC_WHY: unbound variable`, thrown as `Error: Command failed: bash -c source …` (ccd runs under `set -u`);
- or, for the drop cases, `expected '[rc=127]' to be '[rc=2]'` and `expected '127' to be '2'`.

`cd server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts -t 'disposition'` is GREEN at this point: the new entry counts the two `_ws_slug_residue` lines the new file already carries.

`cd server && ./node_modules/.bin/vitest run test/git-env-strip.test.ts -t 'SCOPE names every new ccd suite'` is RED: `a later task’s file the scan would never read: expected [ …(31) ] to deeply equal []` (G12).

- [ ] **Step 3: Implement**

In `ccd/ccd`, directly below the line `# ── end archived-workspace expiry ───────────────────────────────────────────── EXPIRE-END ──`, insert one blank line and then exactly this. It ends with the region's closing marker, and the existing blank line before `MIRROR-BEGIN` stays:

```bash
# ── temp-root collection: ws-collect (spec 2026-09-22 §5.2, §5.6) ─────────────── COLLECT-BEGIN ──
# A child's temp root `$HOME/.cc-tmp/<id>` that outlived its row — kept by a
# reclaim tail that found it in use, or left by a human verb — is collected by
# `ws-collect`, composed by the server and by nothing else (CLAUDE.md SAFETY:
# forbidden to every session). A SIBLING of `ws-reclaim` and `ws-expire`, never
# a flag on either: rung 2's `.child` marker is gone for this population, and
# its only evidence is the positive witness `$REG/tmproots/<id>` (spec §5.2).
# This region holds what is the collector's OWN — its quarantine record, its
# quarantine and slot, its rename and the proof of it, its idle walk, its token
# and its row rule — and borrows the rest from the RECLAIM region: the witness,
# the removal helper and its checkout question, the in-use probe, the absence
# proof and the lock `$REG/.reap-<id>.lock`.
#
# THE RECORD IS RESUME AUTHORITY; THE JOURNAL IS NOT. Before anything moves, the
# verb writes `$REG/tmpquarantine/<id>.<ns>.<pid>` (temp file, then rename): the
# witness line it acted on, the token it was given, and every checkout outside
# the leaf its pre-move question accepted. It names NO path of its own: the slot
# it moves the leaf into is DERIVED from the record's name under the physical
# quarantine (`_ws_collect_qpath`), so a space in a path never splits it. A
# crash at any later step leaves the record, and the next audit of that id finds
# it, whatever the witness says by then. ccd reads no journal to decide anything.
# The record is same-uid writable, as the witness is, and shares its TRUST note:
# it guards against ccd's own crash and a recycled id, never a hostile session.
#
# WHERE. `tmpquarantine/` is a DOTLESS registry subdirectory, the `pools/` and
# `tmproots/` precedent: every registry glob ccd ships is suffix-shaped and every
# registry `find` is depth-1 and name-filtered, so `_reg_purge`, `_ws_slug_free`,
# `ccd ls` and the server's registry read never see it, and the record outlives
# the row it was never part of (`ccd-collect-record.test.ts` pins each). Its
# writer's temp file is dot-leading inside it, never read as a record. A record
# is found by EXACT parse — its name less its two trailing all-digit dot-fields
# must equal the id — never by an `<id>.*` prefix, because ids admit dots: a
# nested project's `p-calm-mesa.v2-quiet-river` is not `p-calm-mesa`'s.
#
# THE QUARANTINE is `<physical ~/.cc-tmp>/.ccd-quarantine`, on the leaf's own file
# system so a rename never crosses one: a real directory of this uid at 0700,
# made by a plain `mkdir -m 0700` when absent and refused as anything else. A
# slot in it is `slot.<id>.<ns>.<pid>`, made by an exclusive `mkdir`; the
# `slot.` prefix keeps it clear of any rule keyed on a leaf's own name, and the
# leaf moves to `<slot>/leaf`. Its name pairs it with its record.
#
# LINUX ONLY. `_ws_collect_mv` holds the region's one GNU spelling, `mv -T -n
# --no-copy`: one renameat2(RENAME_NOREPLACE), never a copy. A box whose `mv` has
# no `--no-copy`, and Darwin, answer unmeasured, and so does the idle walk's GNU
# `find -printf` there. `macos-platform.test.ts` exempts exactly that function.
_WS_REC_ID=''
_WS_QREC_WHY=''; _WS_QRECS_WHY=''
_WS_QREC_ID=''; _WS_QREC_SLOT=''; _WS_QREC_DEV=''; _WS_QREC_INO=''; _WS_QREC_BTIME=''
_WS_QREC_RUN=''; _WS_QREC_AT=''; _WS_QREC_TOKEN=''; _WS_QREC_CHECKOUTS=''
_WS_QRECS=()
WS_COLLECT_RECORD_MAX=65536   # the most bytes one quarantine record may hold, its newline included

_ws_collect_enc() {   # text -> on stdout, every byte outside [A-Za-z0-9._/:@+~-] spelled %XX (upper-case hex)
  # ONE SPELLING FOR A PATH IN A key=value LINE (spec §5.6). A record holds
  # paths — each admin directory and back-link the checkout question accepted —
  # on one space-separated line, so a space, `,`, `=` or `%` in a path would
  # split a field. Its slot is never one of them: G5 derives it. INJECTIVE: `%` is itself spelled, so two texts never
  # encode alike, and comparing two encodings compares the texts. Bytes, never
  # characters (`LC_ALL=C`).
  local LC_ALL=C s="${1-}" o='' c i
  for (( i = 0; i < ${#s}; i++ )); do
    c="${s:i:1}"
    case "$c" in
      [A-Za-z0-9._/:@+~-]) o+="$c" ;;
      *) printf -v c '%%%02X' "'$c"; o+="$c" ;;
    esac
  done
  printf '%s' "$o"
}

_ws_collect_pairs_ok() {   # list -> 0 when '' or a comma list of `<enc>=<enc>` pairs, each side `_ws_collect_enc`'s spelling
  local LC_ALL=C e='([A-Za-z0-9._/:@+~-]|%[0-9A-F]{2})+'
  local re="^$e=$e(,$e=$e)*\$"
  [[ -z "${1-}" || "$1" =~ $re ]]
}

_ws_collect_rec_id() {   # name -> 0 with _WS_REC_ID = the id a `<id>.<ns>.<pid>` name is for: its two trailing
  #                          all-digit dot-fields stripped, and nothing else; 1 when the name is no such name
  # EXACT, NEVER A PREFIX: the longest leading part the two trailing fields leave
  # is the id, and it must itself be an id a witness is named for.
  local LC_ALL=C re='^(.+)\.([0-9]+)\.([0-9]+)$' got
  _WS_REC_ID=''
  [[ "${1-}" =~ $re ]] || return 1
  got="${BASH_REMATCH[1]}"
  _ws_tmproot_id_ok "$got" || return 1
  _WS_REC_ID="$got"
}

_ws_collect_qrec_dir() { printf '%s' "$REG/tmpquarantine"; }   # -> the quarantine records' directory (a path, not a decision)

_WS_QPATH=''; _WS_QPATH_WHY=''
_ws_collect_qpath() {   # -> 0 with _WS_QPATH = `<physical ~/.cc-tmp>/.ccd-quarantine`, resolved and NEVER made;
  #                        2 (_WS_QPATH_WHY) when ~/.cc-tmp cannot be resolved
  # ONE RESOLUTION, NO WRITE (G5). `_ws_collect_qdir` makes the quarantine
  # under this path; the record reader only DERIVES a slot under it, and the
  # audit that reads records is read-only. `_ws_dir_physical`'s eighth caller.
  local root="$HOME/.cc-tmp"
  _WS_QPATH=''; _WS_QPATH_WHY=''
  _ws_dir_physical "$root" || { _WS_QPATH_WHY="$root cannot be resolved ($_WS_PHYS_WHY)"; return 2; }
  [[ -n "$_WS_PHYS" && "$_WS_PHYS" != / ]] || { _WS_QPATH_WHY="$root resolved to an unusable path"; return 2; }
  _WS_QPATH="${_WS_PHYS%/}/.ccd-quarantine"
}

_ws_collect_record_write() {   # id slot token -> 0 written, and PROVEN by reading it back; 1 not written
  #                                (_WS_QREC_WHY) — the caller then refuses before anything moves
  # THE WITNESS LINE IT ACTED ON is the caller's last `_ws_tmproot_witness_read`
  # of id (`_WS_WIT_*`), and the CHECKOUTS its last pre-move `_ws_leaf_checkouts`
  # of the leaf (`_WS_CHECKOUTS_ACCEPTED`). A witness with no birth time (`-`) is
  # never acted on, so it is never recorded either. The record's name is its
  # slot's, less `slot.`: `<id>.<ns>.<pid>`, which pairs the two. The slot must
  # lie in the physical quarantine (`_ws_collect_qpath`), and the body names no
  # path: the reader derives the slot from the name (G5). A record that
  # stands is never overwritten, and its directory is made 0700 on first write.
  local LC_ALL=C id="${1-}" slot="${2-}" token="${3-}" dir base name f tmp line co
  _WS_QREC_WHY=''
  _ws_tmproot_id_ok "$id" || { _WS_QREC_WHY="'$id' is not an id a witness is named for, so no record was written"; return 1; }
  base="${slot##*/}"
  [[ "$slot" == /* && "$base" == slot.* ]] || { _WS_QREC_WHY="$slot is not a quarantine slot's path, so no record was written"; return 1; }
  name="${base#slot.}"
  _ws_collect_rec_id "$name" && [[ "$_WS_REC_ID" == "$id" ]] \
    || { _WS_QREC_WHY="$base is not a slot named for $id, so no record was written"; return 1; }
  _ws_collect_qpath || { _WS_QREC_WHY="$_WS_QPATH_WHY, so no record was written"; return 1; }
  [[ "${slot%/*}" == "$_WS_QPATH" ]] \
    || { _WS_QREC_WHY="$slot is not in the quarantine $_WS_QPATH, so no record was written"; return 1; }
  [[ "$token" =~ ^[0-9a-f]{64}$ ]] || { _WS_QREC_WHY="the token is not one ccd mints, so no record was written"; return 1; }
  [[ "${_WS_WIT_DEV-}" =~ ^[0-9]+$ && "${_WS_WIT_INO-}" =~ ^[0-9]+$ && "${_WS_WIT_BTIME-}" =~ ^[1-9][0-9]*$ \
     && "${_WS_WIT_AT-}" =~ ^[0-9]{13}$ ]] && _child_runid_valid "${_WS_WIT_RUN-}" \
    || { _WS_QREC_WHY="no witness of $id with a birth time was read, so no record was written"; return 1; }
  co="${_WS_CHECKOUTS_ACCEPTED-}"
  _ws_collect_pairs_ok "$co" || { _WS_QREC_WHY="the accepted checkouts are not a list ccd writes, so no record was written"; return 1; }
  line="v=1 id=$id dev=$_WS_WIT_DEV ino=$_WS_WIT_INO btime=$_WS_WIT_BTIME run=$_WS_WIT_RUN at=$_WS_WIT_AT token=$token checkouts=$co"
  (( ${#line} + 1 <= WS_COLLECT_RECORD_MAX )) \
    || { _WS_QREC_WHY="the record of $id would hold more than $WS_COLLECT_RECORD_MAX bytes, so none was written"; return 1; }
  dir=$(_ws_collect_qrec_dir)
  [[ ! -L "$dir" ]] || { _WS_QREC_WHY="$dir is a link, which is never followed, so no record was written"; return 1; }
  [[ -e "$dir" ]] || mkdir -m 0700 -- "$dir" 2>/dev/null || :
  [[ -d "$dir" && ! -L "$dir" ]] || { _WS_QREC_WHY="$dir could not be made a directory, so no record was written"; return 1; }
  f="$dir/$name"
  [[ ! -e "$f" && ! -L "$f" ]] || { _WS_QREC_WHY="$f already stands — a record is never overwritten"; return 1; }
  tmp="$dir/.$name.$BASHPID.$RANDOM.tmp"
  { printf '%s\n' "$line" > "$tmp"; } 2>/dev/null \
    || { rm -f -- "$tmp" 2>/dev/null; _WS_QREC_WHY="$tmp could not be written, so no record was written"; return 1; }
  mv -f -- "$tmp" "$f" 2>/dev/null \
    || { rm -f -- "$tmp" 2>/dev/null; _WS_QREC_WHY="$tmp could not be renamed to $f, so no record was written"; return 1; }
  if ! _ws_collect_record_read "$f" || [[ "$_WS_QREC_TOKEN" != "$token" || "$_WS_QREC_SLOT" != "$slot" ]]; then
    rm -f -- "$f" 2>/dev/null
    _WS_QREC_WHY="$f did not read back as it was written, so it was removed and nothing moves"; return 1
  fi
  return 0
}

_ws_collect_record_read() {   # file -> 0 parsed (sets _WS_QREC_ID _WS_QREC_SLOT _WS_QREC_DEV _WS_QREC_INO
  #                               _WS_QREC_BTIME _WS_QREC_RUN _WS_QREC_AT _WS_QREC_TOKEN _WS_QREC_CHECKOUTS)
  #                               | 1 absent | 2 unreadable or malformed
  # THREE ANSWERS, as the witness reader's: a link, a directory, a dot-leading
  # or unparseable NAME, and a `tmpquarantine/` that is itself a link all answer
  # 2. Every field is cleared first. The content's id must be the one its own
  # name parses to (rc 2 otherwise, G5). The body names NO path: `_WS_QREC_SLOT`
  # is DERIVED, `<physical ~/.cc-tmp>/.ccd-quarantine/slot.<name>`, through
  # `_ws_collect_qpath`, which makes nothing, so a record never names another
  # id's slot and a space in a path never splits one. `_WS_QREC_CHECKOUTS` stays in
  # `_ws_collect_enc`'s spelling, the form `_ws_leaf_checkouts`' alias compares.
  local LC_ALL=C f="${1-}" name body line fd max
  local -a m
  local re='^v=1 id=([A-Za-z0-9._-]+) dev=([0-9]+) ino=([0-9]+) btime=([1-9][0-9]*) run=([^ ]+) at=([0-9]{13}) token=([0-9a-f]{64}) checkouts=([^ ]*)$'
  _WS_QREC_ID=''; _WS_QREC_SLOT=''; _WS_QREC_DEV=''; _WS_QREC_INO=''; _WS_QREC_BTIME=''
  _WS_QREC_RUN=''; _WS_QREC_AT=''; _WS_QREC_TOKEN=''; _WS_QREC_CHECKOUTS=''
  name="${f##*/}"
  [[ "$name" != .* ]] && _ws_collect_rec_id "$name" || return 2
  [[ ! -L "${f%/*}" ]] || return 2
  [[ -e "$f" || -L "$f" ]] || return 1
  [[ -f "$f" && ! -L "$f" ]] || return 2
  max="$WS_COLLECT_RECORD_MAX"
  { exec {fd}<"$f"; } 2>/dev/null || return 2
  IFS= read -r -N "$(( max + 1 ))" body <&"$fd" || :
  { exec {fd}<&-; } 2>/dev/null || :
  (( ${#body} <= max )) && [[ "$body" == *$'\n' ]] || return 2
  line="${body%$'\n'}"
  [[ "$line" != *$'\n'* && "$line" =~ $re ]] || return 2
  m=("${BASH_REMATCH[@]}")
  [[ "${m[1]}" == "$_WS_REC_ID" ]] || return 2
  _child_runid_valid "${m[5]}" || return 2
  _ws_collect_pairs_ok "${m[8]}" || return 2
  _ws_collect_qpath || return 2
  _WS_QREC_ID="${m[1]}"; _WS_QREC_SLOT="$_WS_QPATH/slot.$name"; _WS_QREC_DEV="${m[2]}"; _WS_QREC_INO="${m[3]}"
  _WS_QREC_BTIME="${m[4]}"; _WS_QREC_RUN="${m[5]}"; _WS_QREC_AT="${m[6]}"; _WS_QREC_TOKEN="${m[7]}"
  _WS_QREC_CHECKOUTS="${m[8]}"
  return 0
}

_ws_collect_records_of() {   # id -> 0 with _WS_QRECS = the path of every record named for id EXACTLY (also printed,
  #                              one per line; none when the directory is PROVEN absent); 2 (_WS_QRECS_WHY) when the
  #                              records could not be listed
  # A RECORD IS NEVER INVISIBLE: an unlistable directory, one that is a link,
  # or a file where it should be answers 2, never "no record". Dot-leading names
  # (a writer's temp file) and names that are no `<id>.<ns>.<pid>` are skipped.
  local LC_ALL=C id="${1-}" dir outf errf err rc n
  _WS_QRECS=(); _WS_QRECS_WHY=''
  _ws_tmproot_id_ok "$id" || { _WS_QRECS_WHY="'$id' is not an id a record is named for"; return 2; }
  dir=$(_ws_collect_qrec_dir)
  [[ ! -L "$dir" ]] || { _WS_QRECS_WHY="$dir is a link, which is never followed, so its records were never listed"; return 2; }
  _ws_reclaim_absent "$dir"; rc=$?
  (( rc != 0 )) || return 0
  (( rc != 2 )) || { _WS_QRECS_WHY="$_WS_ABSENT_WHY — whether a record of $id stands was never asked"; return 2; }
  [[ -d "$dir" ]] || { _WS_QRECS_WHY="$dir is not a directory, so its records were never listed"; return 2; }
  outf=$(_plat_mktemp) || { _WS_QRECS_WHY="could not make a scratch file to list $dir"; return 2; }
  errf=$(_plat_mktemp) || { rm -f "$outf"; _WS_QRECS_WHY="could not make a scratch file to list $dir"; return 2; }
  find -P "$REG/tmpquarantine" -mindepth 1 -maxdepth 1 -name '*.*' ! -name '.*' -print0 >"$outf" 2>"$errf"; rc=$?
  err=$(cat "$errf" 2>/dev/null); rm -f "$errf"
  if (( rc != 0 )) || [[ -n "$err" ]]; then
    rm -f "$outf"
    _WS_QRECS_WHY="could not list $dir (find exit $rc${err:+: ${err%%$'\n'*}}), so whether a record of $id stands was never asked"
    return 2
  fi
  while IFS= read -r -d '' n; do
    _ws_collect_rec_id "${n##*/}" && [[ "$_WS_REC_ID" == "$id" ]] || continue
    _WS_QRECS+=("$n")
    printf '%s\n' "$n"
  done < "$outf"
  rm -f "$outf"
  return 0
}

_ws_collect_record_drop() {   # file -> 0 the record is gone, PROVEN; 1 not a record's path, nothing touched;
  #                               2 not proven gone (_WS_QREC_WHY)
  # ORDER (spec §5.6): the record goes LAST, after the slot and the witness, so
  # a crash anywhere before leaves it for the next audit.
  local f="${1-}" dir rc
  _WS_QREC_WHY=''
  dir=$(_ws_collect_qrec_dir)
  [[ "${f%/*}" == "$dir" && "${f##*/}" != .* ]] && _ws_collect_rec_id "${f##*/}" \
    || { _WS_QREC_WHY="$f is not a quarantine record's path, so nothing was touched"; return 1; }
  [[ ! -L "$dir" ]] || { _WS_QREC_WHY="$dir is a link, which is never followed, so $f was left"; return 2; }
  rm -f -- "$f" 2>/dev/null || { _WS_QREC_WHY="$f could not be removed"; return 2; }
  _ws_reclaim_absent "$f"; rc=$?
  (( rc != 1 )) || { _WS_QREC_WHY="$f stands again after its removal"; return 2; }
  (( rc != 2 )) || { _WS_QREC_WHY="$_WS_ABSENT_WHY — that $f is gone was never proven"; return 2; }
  return 0
}
# ── end temp-root collection ─────────────────────────────────────────────────── COLLECT-END ──
```

Then, in `server/test/git-env-strip.test.ts` (ruling G12), replace the `SCOPE` line (`grep -n 'const SCOPE = ' server/test/git-env-strip.test.ts`), one line for one:

```ts
  const SCOPE = /^(ccd-child-reclaim-.*\.test\.ts|ccd-child-tmproot-.*\.test\.ts|ccd-path-users\.test\.ts|ccd-leaf-remove\.test\.ts|ccd-ws-expire-.*\.test\.ts|childReclaim[A-Za-z]*\.ts|pathUsersFixture\.ts|wsExpireFixture\.ts|ccdWsHelpers\.ts)$/;
```

with:

```ts
  const SCOPE = /^(ccd-child-reclaim-.*\.test\.ts|ccd-child-tmproot-.*\.test\.ts|ccd-path-users\.test\.ts|ccd-leaf-remove\.test\.ts|ccd-ws-expire-.*\.test\.ts|ccd-collect-.*\.test\.ts|ccd-ws-collect-.*\.test\.ts|ccd-leaf-checkouts-alias\.test\.ts|ccd-leaf-checkouts-pins\.test\.ts|ccd-reclaim-.*\.test\.ts|ccd-expire-tail-refuted\.test\.ts|ccd-dir-physical-builtin\.test\.ts|ws-collect-act\.test\.ts|childReclaim[A-Za-z]*\.ts|pathUsersFixture\.ts|wsExpireFixture\.ts|collectFixture\.ts|wsCollectFixture\.ts|collectRaceFixture\.ts|containmentRefutedFamilies\.ts|ccdWsHelpers\.ts)$/;
```

- [ ] **Step 4: Run to pass, then the gates**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-collect-record.test.ts
cd server && ./node_modules/.bin/vitest run test/git-env-strip.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-tmproot-witness.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts -t 'disposition|EVERY bash call site'
cd server && ./node_modules/.bin/vitest run test/ccd-wsaudit-nonpoison.test.ts test/ccd-refusal-scan.test.ts test/ccd-reg-get-census.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'citation'
```

Expected: everything green.
- `ccd-collect-record`: 52 passed (re-measure after G5).
- `git-env-strip` green: its SCOPE now reads every collector suite and fixture, and the strip scan passes over the Task 1 files already in the tree (`ccd-reclaim-*`, `ccd-expire-tail-refuted`, `containmentRefutedFamilies.ts`). A red on one of those is Task 1's: STOP and report.
- The witness file's name-agnostic walker census stays green, and now counts 4A's `find -P "$REG/tmpquarantine" -mindepth 1 -maxdepth 1 -name …` among its registry finds.
- `ccd-wsaudit-nonpoison` holds at 67 words (55 outside the blocks): the region carries none of the four harvested shapes, in code or comment.
- `ccd-reg-get-census` is unchanged: no `_reg_get "` was written.

- [ ] **Step 5: Mutation check**

Apply each mutation alone to `ccd/ccd`, run the command, see the red, revert. Command, unless the row says otherwise: `cd server && ./node_modules/.bin/vitest run test/ccd-collect-record.test.ts`.

| # | Mutation (exact edit) | Reds | Expected failure |
|---|---|---|---|
| A1 | In `_ws_collect_records_of`, replace `    _ws_collect_rec_id "${n##*/}" && [[ "$_WS_REC_ID" == "$id" ]] \|\| continue` with `    [[ "${n##*/}" == "$id".* ]] \|\| continue` (the prefix glob) | "p-calm-mesa finds its own record…", "every record of the id is listed…" | `expected { rc: '0', …(2) } to deeply equal { rc: '0', …(2) }`; `expected [ …(3) ] to deeply equal [ …(2) ]` |
| A2 | In `_ws_collect_rec_id`, replace `re='^(.+)\.([0-9]+)\.([0-9]+)$'` with `re='^([^.]+)\.(.*)()$'` (strip at the FIRST dot) | the same two | the same two |
| A3 | In `_ws_collect_record_write`, delete the line `  [[ ! -e "$f" && ! -L "$f" ]] \|\| { _WS_QREC_WHY="$f already stands — a record is never overwritten"; return 1; }` | "a record that stands is NEVER overwritten" | `expected '0' to be '1'` |
| A4 | In `_ws_collect_record_write`, replace `"${_WS_WIT_BTIME-}" =~ ^[1-9][0-9]*$` with `-n "${_WS_WIT_BTIME-}"` | "refuses a witness with no birth time" | `expected '…did not read back as it was written…' to contain 'no witness of'` (the reader still refuses `btime=-`: defence in depth, red on the reason) |
| A5 | In `_ws_collect_record_write`, replace `  if ! _ws_collect_record_read "$f" \|\| [[ "$_WS_QREC_TOKEN" != "$token" \|\| "$_WS_QREC_SLOT" != "$slot" ]]; then` with `  if false; then` | "a record that does not read back is removed, and answers 1" | `expected '0' to be '1'` |
| A6 | In `_ws_collect_record_read`, delete `  [[ "${m[1]}" == "$_WS_REC_ID" ]] \|\| return 2` | "rc 2 for another id in the body" | `expected '[rc=0] demo-quiet-reef\|…' to be '[rc=2] \|\|\|\|\|\|\|\|'` |
| A7 | In `_ws_collect_record_read`, replace `  _ws_collect_qpath \|\| return 2` with `  _WS_QPATH=/elsewhere/.ccd-quarantine` (a slot not derived from the physical quarantine) | "rc 0 sets every field; the slot is DERIVED …", "rc 2 when the physical quarantine cannot be resolved …" | `expected '[rc=0] demo-quiet-mesa\|/elsewhere/.ccd-quarantine/…' to be '[rc=0] demo-quiet-mesa\|<physical>/.ccd-quarantine/…'`; `expected '[rc=0]' to be '[rc=2]'` (G5; re-measure the exact text) |
| A8 | In `_ws_collect_record_read`, delete `  [[ ! -L "${f%/*}" ]] \|\| return 2` | "rc 2 for a directory, a link to a GOOD record, and a linked tmpquarantine/" | `expected '[rc=0]' to be '[rc=2]'` |
| A9 | In `_ws_collect_record_read`, delete its two field-clearing lines (`_WS_QREC_ID=''; …` and `_WS_QREC_RUN=''; …`) | 14 cases (17 at drafting, less the four `slot=` rows, plus G5's slot row), the first "rc 1 when nothing stands there" | `expected '[rc=1] demo-good-seed\|…' to be '[rc=1] \|\|\|\|\|\|\|\|'` |
| A10 | In `_ws_collect_records_of`, replace `  if (( rc != 0 )) \|\| [[ -n "$err" ]]; then` with `  if false; then` | "a tmpquarantine/ that cannot be LISTED answers 2" | `expected '0' to be '2'` |
| A11 | In `_ws_collect_records_of`, delete `  [[ ! -L "$dir" ]] \|\| { _WS_QRECS_WHY="$dir is a link, …"; return 2; }` | "a LINKED tmpquarantine/, and a FILE there, answer 2" | `expected '0' to be '2'` |
| A12 | In `_ws_collect_record_drop`, delete its two-line path check (`  [[ "${f%/*}" == "$dir" && … ]] && _ws_collect_rec_id …` and its `\|\| { … return 1; }`) | the three "… answers 1 and is untouched" cases | `expected '[rc=0]' to be '[rc=1]'` |
| A13 | In `_ws_collect_record_drop`, replace `  _ws_reclaim_absent "$f"; rc=$?` and the `(( rc != 1 ))` line after it with `  rc=0` | "an rm that answers 0 and removed nothing is not proven gone: 2" | `expected '[rc=0]' to be '[rc=2]'` |
| A14 | In `_ws_collect_enc`, replace `      [A-Za-z0-9._/:@+~-]) o+="$c" ;;` with `      [A-Za-z0-9._/:@+~%-]) o+="$c" ;;` (leave `%` unspelled) | "a checkout pair whose paths hold a space, a comma, an `=` and a `%` …" | `the accepted checkouts are not a list ccd writes, so no record was written: expected '1' to be '0'` (re-measure) |
| A15 | Replace `_ws_collect_qrec_dir() { printf '%s' "$REG/tmpquarantine"; }` with `… "$REG/tmpquarantine.uuid"; }` (a registry-shaped name) | the collision case; "`ccd ls` lists no row for it" | `EISDIR: illegal operation on a directory, open '…/tmpquarantine.uuid'`; `expected 'ID  WRAPPER …' to contain '(no sessions)'` |
| A16 | Replace `_ws_collect_qrec_dir`'s body with `printf '%s' "$REG"` (records flat in `$REG`) | "the server's registry read derives no session from it" | `the CONTROL: the listing does carry the directory: expected [ … ] to include '.cc-sessions'` |
| A17 | Below `_ws_tmproot_witness_file() {…}` (outside the region), add a line `_ws_qpeek() { ls "$REG/tmpquarantine"; }` | "`tmpquarantine` is spelled only inside the COLLECT region…" | `expected [ Array(1) ] to deeply equal []` |
| A18 | In `_ws_collect_records_of`'s `find`, delete `-maxdepth 1 ` | the same census case; AND `cd server && ./node_modules/.bin/vitest run test/ccd-child-tmproot-witness.test.ts -t 'suffix-shaped'` | `expected 'find -P "$REG/tmpquarantine" -mindept…' to match /-maxdepth 1\b/`; `expected [ Array(1) ] to deeply equal []` (a find that is not depth-1 and name-filtered) |
| A19 | Delete the new `DISPOSITION` entry from `ccd-workspaces.test.ts` | `cd server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts -t 'disposition'` | `an assertion on no disposition entry: expected [ Array(1) ] to deeply equal []` |
| A20 | In `_ws_collect_record_write`, delete the two-line `  [[ "${slot%/*}" == "$_WS_QPATH" ]] \` / `    \|\| { _WS_QREC_WHY="$slot is not in the quarantine …"; return 1; }` | "refuses a slot outside the physical quarantine" | `expected '…did not read back as it was written…' to contain 'is not in the quarantine'` (the read-back of the derived slot still refuses: defence in depth, red on the reason; re-measure) |
| A21 | In `server/test/git-env-strip.test.ts`, restore `b0647d850`'s `SCOPE` line | `cd server && ./node_modules/.bin/vitest run test/git-env-strip.test.ts -t 'SCOPE names every new ccd suite'` | `a later task’s file the scan would never read: expected [ …(31) ] to deeply equal []` |

THE WRITER'S TWO LINK CHECKS HAVE NO RED OF THEIR OWN. `[[ ! -L "$dir" ]]` and the later `[[ -d "$dir" && ! -L "$dir" ]]` each refuse a linked `tmpquarantine/`, so deleting either one alone leaves "a LINKED tmpquarantine/ is refused" green; deleting both reds it (`expected '0' to be '1'`). That is defence in depth, stated rather than pinned twice.

- [ ] **Step 6: Re-stamp and commit**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd                  # ccd/ccd: ccrc-unmodified
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
git add ccd/ccd server/test/ccd-collect-record.test.ts server/test/ccd-workspaces.test.ts server/test/git-env-strip.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): the temp-root collector's quarantine record

The COLLECT region opens with the collector's resume authority:
$REG/tmpquarantine/<id>.<ns>.<pid>, one versioned key=value line naming
the witness the act was taken on, the token and the checkouts the
pre-move question let pass, percent-spelled. It names no slot: the slot
is derived from the record's name under the physical quarantine. Written
temp-then-rename and proven by reading it back; found by exact parse,
never an <id>.* prefix, so a nested id is never matched; dropped only
with its absence proven. The dotless directory is invisible to
_reg_purge, _ws_slug_free, ccd ls and the server's registry read, and
only the COLLECT region names it. git-env-strip's SCOPE now reads every
collector suite and fixture this wave adds. Nothing calls any of it yet.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

#### 4B — the quarantine, the slot, and the rename and its proof

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-collect-quarantine.test.ts`:

```ts
// The temp-root collector's QUARANTINE and its RENAME (child reclamation
// wave 7, spec §5.6). The quarantine is `<physical ~/.cc-tmp>/.ccd-quarantine`:
// a real directory of this uid at 0700, made when absent, refused as anything
// else. A slot is `slot.<id>.<ns>.<pid>`, made by an exclusive mkdir and never
// reused. The leaf moves by ONE renameat2(RENAME_NOREPLACE) — `mv -T -n
// --no-copy`, `_ws_collect_mv` — and the move is PROVEN by an lstat of where it
// went and of where it was, never by mv's exit code. A box whose mv has no
// `--no-copy`, and Darwin, never rename. A cross-device rename cannot be made
// without privileges, so its answer is a `mv` shim (a shell function).
//
// FIXTURE HOMES ONLY (`makePrHarness`): every root, quarantine and leaf is under
// the harness's HOME, and `~/.cc-tmp` is the fixture's own.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
let restore: [string, number][] = [];
beforeEach(() => { h = makePrHarness('ccrc-collect-quarantine-'); restore = []; });
afterEach(() => {
  for (const [p, m] of restore.reverse()) { try { fs.chmodSync(p, m); } catch { /* gone */ } }
  h.cleanup();
});
const chmodFor = (p: string, mode: number): void => {
  restore.push([p, fs.statSync(p).mode & 0o7777]);
  fs.chmodSync(p, mode);
};

const ID = 'demo-quiet-mesa';
const ROOT_USER = process.getuid?.() === 0;
const LINUX = process.platform === 'linux';
const root = (): string => path.join(h.home, '.cc-tmp');
const leaf = (): string => path.join(root(), ID);

/** rc and the named globals, `\x1f`-separated, from one snippet. */
const ask = (snippet: string, ...globals: string[]): string[] =>
  h.sh(`${snippet}; rc=$?; printf '%s' "$rc"; for g in ${globals.join(' ')}; do printf '\\x1f%s' "\${!g-}"; done`).split('\x1f');
/** What node sees of a directory: dev:ino and whole-second birth time, as ccd's identity reads it. */
const ident = (p: string): { di: string; bt: string } => {
  const st = fs.lstatSync(p, { bigint: true });
  return { di: `${st.dev}:${st.ino}`, bt: String(st.birthtimeNs / 1_000_000_000n) };
};

describe('_ws_collect_qdir: the quarantine is a real directory of this uid at 0700, on the leaf’s own file system', () => {
  it('absent: made 0700 under the PHYSICAL ~/.cc-tmp — a root that is a link is followed to its volume', () => {
    const vol = path.join(h.home, 'vol');
    fs.mkdirSync(vol);
    fs.symlinkSync(vol, root());
    const [rc, q, why] = ask('_ws_collect_qdir', '_WS_Q', '_WS_Q_WHY');
    expect(rc, why).toBe('0');
    expect(q).toBe(path.join(fs.realpathSync(vol), '.ccd-quarantine'));
    expect(fs.lstatSync(q!).isDirectory()).toBe(true);
    expect((fs.statSync(q!).mode & 0o777).toString(8)).toBe('700');
  });

  it('one that stands, 0700 and ours, is used as it is', () => {
    const q = path.join(root(), '.ccd-quarantine');
    fs.mkdirSync(q, { recursive: true, mode: 0o700 });
    fs.chmodSync(q, 0o700);
    const ino = fs.statSync(q).ino;
    const [rc, got] = ask('_ws_collect_qdir', '_WS_Q');
    expect(rc).toBe('0');
    expect(got).toBe(path.join(fs.realpathSync(root()), '.ccd-quarantine'));
    expect(fs.statSync(q).ino).toBe(ino);
  });

  it.each([
    ['a LINK to a directory', (q: string): void => { fs.mkdirSync(`${q}.real`, { mode: 0o700 }); fs.symlinkSync(`${q}.real`, q); }, 'not a real directory'],
    ['a FILE', (q: string): void => { fs.writeFileSync(q, 'x'); }, 'not a real directory'],
    ['mode 0755', (q: string): void => { fs.mkdirSync(q); fs.chmodSync(q, 0o755); }, 'is mode 755, not 0700'],
  ])('%s at the quarantine’s name is unmeasured: 2, and nothing is made', (_label, plant, why) => {
    fs.mkdirSync(root(), { recursive: true });
    const q = path.join(root(), '.ccd-quarantine');
    plant(q);
    const [rc, got, w] = ask('_ws_collect_qdir', '_WS_Q', '_WS_Q_WHY');
    expect(rc).toBe('2');
    expect(got).toBe('');
    expect(w).toContain(why);
  });

  it('another uid’s quarantine is unmeasured: 2', () => {
    fs.mkdirSync(path.join(root(), '.ccd-quarantine'), { recursive: true, mode: 0o700 });
    const [rc, , w] = ask('_ws_leaf_uid() { echo 999999; }; _ws_collect_qdir', '_WS_Q', '_WS_Q_WHY');
    expect(rc).toBe('2');
    expect(w).toContain('belongs to uid 999999');
  });

  it('no ~/.cc-tmp at all is unmeasured: 2, and nothing is made', () => {
    const [rc] = ask('_ws_collect_qdir', '_WS_Q');
    expect(rc).toBe('2');
    expect(fs.existsSync(root())).toBe(false);
  });
});

describe('_ws_collect_slot_path / _ws_collect_slot_make: `slot.<id>.<ns>.<pid>`, exclusive, never reused', () => {
  it('the path is `<q>/slot.<id>.<ns>.<pid>`, the ns from the collector’s clock', () => {
    const [rc, s] = ask(`_ws_collect_now_ns() { echo 1791470480213200844; }; _ws_collect_slot_path /q ${ID}`, '_WS_SLOT');
    expect(rc).toBe('0');
    expect(s).toMatch(new RegExp(`^/q/slot\\.${ID.replace(/-/g, '\\-')}\\.1791470480213200844\\.[0-9]+$`));
  });

  it.each([['.hidden'], ['a/b'], ['']])('an id no witness is named for (%j) makes no path: 2', (id) => {
    expect(ask(`_ws_collect_slot_path /q '${id}'`, '_WS_SLOT')).toEqual(['2', '']);
  });

  it('a clock that does not answer makes no path: 2', () => {
    expect(ask(`_ws_collect_now_ns() { echo soon; }; _ws_collect_slot_path /q ${ID}`, '_WS_SLOT')).toEqual(['2', '']);
  });

  it('make: a real directory at 0700, made by this call', () => {
    const s = path.join(h.home, 'q', `slot.${ID}.1.2`);
    fs.mkdirSync(path.dirname(s));
    const [rc, why] = ask(`_ws_collect_slot_make '${s}'`, '_WS_SLOT_WHY');
    expect(rc, why).toBe('0');
    expect(fs.lstatSync(s).isDirectory()).toBe(true);
    expect((fs.statSync(s).mode & 0o777).toString(8)).toBe('700');
  });

  it.each([
    ['an empty directory', (s: string): void => { fs.mkdirSync(s); }],
    ['a directory holding a leaf', (s: string): void => { fs.mkdirSync(path.join(s, 'leaf'), { recursive: true }); }],
    ['a file', (s: string): void => { fs.writeFileSync(s, 'x'); }],
    ['a dangling link', (s: string): void => { fs.symlinkSync('/nowhere', s); }],
  ])('a name that already stands (%s) is never reused: 1, and it is untouched', (_label, plant) => {
    const s = path.join(h.home, 'q', `slot.${ID}.1.2`);
    fs.mkdirSync(path.dirname(s));
    plant(s);
    const before = fs.lstatSync(s).ino;
    const [rc, why] = ask(`_ws_collect_slot_make '${s}'`, '_WS_SLOT_WHY');
    expect(rc).toBe('1');
    expect(why).toContain('never reused');
    expect(fs.lstatSync(s).ino).toBe(before);
  });

  it('the exclusive mkdir itself refuses a name that appears after the absence check: 1', () => {
    const s = path.join(h.home, 'q', `slot.${ID}.1.2`);
    fs.mkdirSync(path.dirname(s));
    // The absence proof answers "absent", and a racer makes the name before the mkdir.
    const [rc] = ask(`_ws_reclaim_absent() { mkdir -p '${s}'; return 0; }; _ws_collect_slot_make '${s}'`, '_WS_SLOT_WHY');
    expect(rc).toBe('1');
  });

  it('a parent that does not exist: 2', () => {
    const [rc] = ask(`_ws_collect_slot_make '${path.join(h.home, 'nowhere', 'slot.x.1.2')}'`, '_WS_SLOT_WHY');
    expect(rc).toBe('2');
  });
});

describe('_ws_collect_ident: an lstat — a real directory with this dev:ino and birth time, never followed', () => {
  it('the directory itself: 0; another inode, another birth time, a link to it, a file, nothing: 1', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    const { di, bt } = ident(leaf());
    const q = (p: string, d = di, b = bt): string => h.sh(`_ws_collect_ident '${p}' '${d}' '${b}'; echo $?`);
    expect(q(leaf())).toBe('0');
    expect(q(leaf(), '1:1')).toBe('1');
    expect(q(leaf(), di, String(Number(bt) + 1))).toBe('1');
    const link = path.join(h.home, 'link');
    fs.symlinkSync(leaf(), link);
    expect(q(link), 'a link to the very directory is not it').toBe('1');
    const file = path.join(h.home, 'file');
    fs.writeFileSync(file, 'x');
    expect(q(file)).toBe('1');
    expect(q(path.join(h.home, 'nothing'))).toBe('1');
  });

  it.skipIf(ROOT_USER)('nothing there, under a parent that cannot be searched, is unmeasured: 2', () => {
    const locked = path.join(h.home, 'locked');
    fs.mkdirSync(locked);
    chmodFor(locked, 0o600);
    expect(h.sh(`_ws_collect_ident '${path.join(locked, 'x')}' 1:1 1; echo $?`)).toBe('2');
  });
});

/** A shim's view of `_ws_collect_mv`'s argv: its last two arguments, whatever flags precede them. */
const LAST2 = 'last2() { s="${@: -2:1}"; d="${@: -1}"; };';

describe('_ws_collect_move: renameat2(RENAME_NOREPLACE), PROVEN by lstat — never by mv’s exit code', () => {
  const dst = (): string => path.join(h.home, 'q', 'slot.x.1.2', 'leaf');
  const setup = (): { di: string; bt: string } => {
    fs.mkdirSync(path.join(leaf(), 'cdk.out'), { recursive: true });
    fs.writeFileSync(path.join(leaf(), 'cdk.out', 'm.json'), '{}');
    fs.mkdirSync(path.dirname(dst()), { recursive: true });
    return ident(leaf());
  };
  const move = (from: string, to: string, di: string, bt: string, pre = ''): string[] =>
    ask(`${pre} _ws_collect_move '${from}' '${to}' '${di}' '${bt}'`, '_WS_MOVE_WHY');

  it.skipIf(!LINUX)('a real move: 0 — the inode and its birth time go with it, and nothing stands where it was', () => {
    const { di, bt } = setup();
    const [rc, why] = move(leaf(), dst(), di, bt);
    expect(rc, why).toBe('0');
    expect(ident(dst())).toEqual({ di, bt });
    expect(fs.existsSync(leaf())).toBe(false);
    expect(fs.readFileSync(path.join(dst(), 'cdk.out', 'm.json'), 'utf8')).toBe('{}');
  });

  it.skipIf(!LINUX)('the move BACK is the same proof: 0, the original path is the directory again and the slot’s leaf is gone', () => {
    const { di, bt } = setup();
    expect(move(leaf(), dst(), di, bt)[0]).toBe('0');
    const [rc, why] = move(dst(), leaf(), di, bt);
    expect(rc, why).toBe('0');
    expect(ident(leaf())).toEqual({ di, bt });
    expect(fs.existsSync(dst())).toBe(false);
  });

  it.skipIf(!LINUX).each([
    ['an empty directory', (p: string): void => { fs.mkdirSync(p); }],
    ['a directory holding a file', (p: string): void => { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'theirs'), 't'); }],
    ['a file', (p: string): void => { fs.writeFileSync(p, 'theirs'); }],
    ['a dangling link', (p: string): void => { fs.symlinkSync('/nowhere', p); }],
  ])('NOREPLACE: %s at the destination is never replaced — 1, both untouched', (_label, plant) => {
    const { di, bt } = setup();
    plant(dst());
    const before = fs.lstatSync(dst()).ino;
    const [rc, why] = move(leaf(), dst(), di, bt);
    expect(rc, why).toBe('1');
    expect(ident(leaf())).toEqual({ di, bt });
    expect(fs.lstatSync(dst()).ino).toBe(before);
  });

  it.skipIf(!LINUX)('a cross-device rename (EXDEV) — `--no-copy` turns it into a failure — is "not moved": 1, mv’s own words carried', () => {
    const { di, bt } = setup();
    const pre = `_WS_MV_NOCOPY=1; ${LAST2} mv() { last2 "$@"; echo "mv: cannot move '$s' to '$d': Invalid cross-device link" >&2; return 1; };`;
    const [rc, why] = move(leaf(), dst(), di, bt, pre);
    expect(rc).toBe('1');
    expect(why).toContain('Invalid cross-device link');
    expect(ident(leaf())).toEqual({ di, bt });
  });

  it.skipIf(!LINUX)('a `mv` that COPIES and answers 0 is unmeasured: 2 — the new inode is not the directory', () => {
    const { di, bt } = setup();
    const pre = `_WS_MV_NOCOPY=1; ${LAST2} mv() { last2 "$@"; cp -a -- "$s" "$d" && rm -rf -- "$s"; };`;
    const [rc, why] = move(leaf(), dst(), di, bt, pre);
    expect(rc, why).toBe('2');
    expect(why).toContain('neither');
  });

  it.skipIf(!LINUX)('a `mv` that answers 0 and moved nothing is "not moved": 1', () => {
    const { di, bt } = setup();
    const [rc, why] = move(leaf(), dst(), di, bt, '_WS_MV_NOCOPY=1; mv() { return 0; };');
    expect(rc, why).toBe('1');
    expect(why).toContain('mv exit 0');
  });

  it.skipIf(!LINUX)('a move whose source stands AGAIN (re-created in the window) is not proven: 2', () => {
    const { di, bt } = setup();
    const pre = `_WS_MV_NOCOPY=1; ${LAST2} mv() { last2 "$@"; command mv -T -- "$s" "$d" && mkdir '${leaf()}'; };`;
    const [rc, why] = move(leaf(), dst(), di, bt, pre);
    expect(rc, why).toBe('2');
    expect(why).toContain('not proven');
  });

  it.skipIf(!LINUX)('a box whose mv has no `--no-copy` never renames: 2, and nothing moved', () => {
    const { di, bt } = setup();
    const pre = 'mv() { if [[ "$1" == --help ]]; then echo "Usage: mv [OPTION]... SOURCE DEST"; return 0; fi; command mv "$@"; };';
    const [rc, why] = move(leaf(), dst(), di, bt, pre);
    expect(rc).toBe('2');
    expect(why).toContain('no \'mv --no-copy\'');
    expect(ident(leaf())).toEqual({ di, bt });
    expect(fs.existsSync(dst())).toBe(false);
  });

  it('Darwin never renames: 2, mv is never run, and nothing moved', () => {
    const { di, bt } = setup();
    const rec = 'mv() { [[ "$1" == --help ]] || echo "$*" >> "$HOME/mv-calls"; command mv "$@"; };';
    expect(h.sh(`${rec} CCD_OS=darwin; _ws_collect_mv_ok; echo $?`), 'the capability answers no on Darwin').toBe('1');
    const [rc] = move(leaf(), dst(), di, bt, `${rec} CCD_OS=darwin;`);
    expect(rc).toBe('2');
    expect(fs.existsSync(path.join(h.home, 'mv-calls')), 'mv was run').toBe(false);
    expect(ident(leaf())).toEqual({ di, bt });
  });

  it.skipIf(!LINUX)('the capability is asked of `mv --help` once, then remembered', () => {
    const out = h.sh('mv() { if [[ "$1" == --help ]]; then echo asked >> "$HOME/help-calls"; command mv --help; return; fi; command mv "$@"; };'
      + ' _ws_collect_mv_ok; a=$?; _ws_collect_mv_ok; b=$?; echo "$a$b"');
    expect(out).toBe('00');
    expect(fs.readFileSync(path.join(h.home, 'help-calls'), 'utf8')).toBe('asked\n');
  });
});
```

In `server/test/macos-platform.test.ts`, make two edits:
- replace `scannedText` (`grep -n 'function scannedText' server/test/macos-platform.test.ts`) with the constant and function below;
- add the new case directly after the closing `});` of the case `` it(`ccd/${HOOK}'s exemption is the epoch copy, and nothing else`, … `` (before the `});` that closes its describe).

```ts
  /** `ccd`'s ONE legitimate GNU spelling outside the platform block: the temp-root
   *  collector's rename, `_ws_collect_mv` (its COLLECT region), `mv -T -n
   *  --no-copy` — one renameat2(RENAME_NOREPLACE) that never falls back to a copy
   *  (spec 2026-09-22 §5.6). It stays out of the platform block by design (that
   *  block is byte-identical in `ccd` and `ccrc`, and the rename is the collector's
   *  alone), and it is LINUX-ONLY by construction: the function's first line
   *  answers 2 on Darwin before `mv` is reached. Cut exactly as the hook's epoch
   *  copy is — ONE function, pinned below — so a renamed function makes the cut
   *  MISS, which surfaces as an `mv -T` hit, never a silently wider exemption. */
  const COLLECT_MV = /^_ws_collect_mv\(\) \{[^\n]*\n[\s\S]*?\n\}\n/m;

  function scannedText(name: string): string {
    const src = readFileSync(path.join(ccdRoot, name), 'utf8');
    if (name === HOOK) return executableText(src.replace(HOOK_EPOCH_COPY, ''));
    return executableText(name === 'ccd' ? src.replace(COLLECT_MV, '') : src);
  }
```

```ts
  it('ccd/ccd’s exemption is the collector’s rename, and nothing else', () => {
    // The anti-widening half, as the hook's: ONE function, ONE spelling, and
    // its first executable line refuses Darwin before `mv` is reached.
    const src = readFileSync(path.join(ccdRoot, 'ccd'), 'utf8');
    const m = COLLECT_MV.exec(src);
    expect(m, '_ws_collect_mv must be findable — the exemption is meant to be exact').not.toBeNull();
    const cut = m![0]!;
    expect(cut.match(/^[A-Za-z_][A-Za-z0-9_]*\(\) \{/gm),
      'the exemption must be ONE function, not a region that grew').toEqual(['_ws_collect_mv() {']);
    expect(gnuHits(executableText(cut)), 'the exemption buys exactly one spelling: the no-copy rename')
      .toEqual(['mv -T: mv -T -n --no-copy -- "$1" "$2"']);
    expect(executableText(cut).split('\n')[1]?.trim(), 'its first line refuses Darwin')
      .toBe('[[ "$CCD_OS" != darwin ]] || return 2');
    // … and the rest of ccd really is scanned: the cut ends at the function.
    const text = scannedText('ccd');
    for (const anchor of ['_ws_collect_mv_ok() {', '_ws_collect_move() {']) {
      expect(text, `the cut swallowed ccd around \`${anchor}\``).toContain(anchor);
    }
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-collect-quarantine.test.ts
cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts -t 'exemption'
```

Expected:
- `Tests  34 failed (34)`, each on `command not found` read back as rc 127: `expected '127' to be '0'`, `'1'` or `'2'`, and `expected [ '127', '' ] to deeply equal [ '2', '' ]`.
- The new macOS case: `_ws_collect_mv must be findable — the exemption is meant to be exact: expected null not to be null`. The hook's case stays green.

- [ ] **Step 3: Implement**

(a) In `ccd/ccd`, directly ABOVE the line `# ── end temp-root collection ─────────────────────────────────────────────────── COLLECT-END ──`, insert one blank line and then exactly this, so that a blank line separates it from the `}` above and none separates it from the marker below:

```bash
_ws_collect_now_ns() { date +%s%N; }   # the clock the idle floor and a slot's name read, epoch ns — a function, so a test can name the instant

_WS_Q=''; _WS_Q_WHY=''
_ws_collect_qdir() {   # -> 0 with _WS_Q = the quarantine, `<physical ~/.cc-tmp>/.ccd-quarantine` (made, 0700, when
  #                       PROVEN absent); 2 (_WS_Q_WHY) when it is anything but a real directory of this uid at 0700
  local q me owner mode rc
  _WS_Q=''; _WS_Q_WHY=''
  _ws_collect_qpath || { _WS_Q_WHY="$_WS_QPATH_WHY, so no quarantine was asked for"; return 2; }
  q="$_WS_QPATH"
  _ws_reclaim_absent "$q"; rc=$?
  (( rc != 2 )) || { _WS_Q_WHY="$_WS_ABSENT_WHY — whether the quarantine stands was never asked"; return 2; }
  (( rc != 0 )) || mkdir -m 0700 -- "$q" 2>/dev/null || :
  [[ -d "$q" && ! -L "$q" ]] || { _WS_Q_WHY="$q is not a real directory (a link, not a directory, or it could not be made)"; return 2; }
  me=$(id -u) || { _WS_Q_WHY="this uid could not be read, so whether $q is ours was never asked"; return 2; }
  owner=$(_ws_leaf_uid "$q") || { _WS_Q_WHY="who owns $q could not be read"; return 2; }
  [[ "$owner" == "$me" ]] || { _WS_Q_WHY="$q belongs to uid $owner, not this uid $me"; return 2; }
  mode=$(_plat_mode "$q" 2>/dev/null) || { _WS_Q_WHY="the mode of $q could not be read"; return 2; }
  [[ "$mode" == 700 ]] || { _WS_Q_WHY="$q is mode $mode, not 0700"; return 2; }
  _WS_Q="$q"
}

_WS_SLOT=''; _WS_SLOT_WHY=''
_ws_collect_slot_path() {   # q id -> 0 with _WS_SLOT = `<q>/slot.<id>.<ns>.<pid>` (not made); 2 when the id or the clock cannot be used
  local q="${1-}" id="${2-}" ns
  _WS_SLOT=''
  _ws_tmproot_id_ok "$id" || return 2
  ns=$(_ws_collect_now_ns) && [[ "$ns" =~ ^[1-9][0-9]{9,18}$ ]] || return 2
  _WS_SLOT="${q%/}/slot.$id.$ns.$BASHPID"
}
_ws_collect_slot_make() {   # slot -> 0 made by THIS call, a real directory at 0700; 1 the name already stands (a slot
  #                              is never reused); 2 could not be made (_WS_SLOT_WHY)
  local s="${1-}" err rc
  _WS_SLOT_WHY=''
  _ws_reclaim_absent "$s"; rc=$?
  (( rc != 1 )) || { _WS_SLOT_WHY="$s already stands — a slot is never reused"; return 1; }
  (( rc != 2 )) || { _WS_SLOT_WHY="$_WS_ABSENT_WHY — whether $s stands was never asked"; return 2; }
  # EXCLUSIVE: a plain `mkdir`, never `-p`, fails on a name that stands, whoever made it.
  if ! err=$(mkdir -m 0700 -- "$s" 2>&1); then
    if [[ -e "$s" || -L "$s" ]]; then _WS_SLOT_WHY="$s already stands — a slot is never reused"; return 1; fi
    _WS_SLOT_WHY="$s could not be made: ${err%%$'\n'*}"; return 2
  fi
  [[ -d "$s" && ! -L "$s" ]] || { _WS_SLOT_WHY="$s is not a real directory after its mkdir"; return 2; }
}

_ws_collect_mv() {   # src dst -> mv's own exit code: ONE renameat2(RENAME_NOREPLACE), never a copy; 2 on Darwin, mv never run
  [[ "$CCD_OS" != darwin ]] || return 2
  mv -T -n --no-copy -- "$1" "$2"
}
_WS_MV_NOCOPY=''
_ws_collect_mv_ok() {   # -> 0 when this box's `mv` has `--no-copy` (asked once, then remembered); 1 when not, or Darwin
  local h
  [[ "$CCD_OS" != darwin ]] || return 1
  if [[ -z "$_WS_MV_NOCOPY" ]]; then
    _WS_MV_NOCOPY=0
    h=$(LC_ALL=C mv --help 2>/dev/null) && [[ "$h" == *--no-copy* ]] && _WS_MV_NOCOPY=1
  fi
  [[ "$_WS_MV_NOCOPY" == 1 ]]
}

_ws_collect_ident() {   # path dev:ino btime -> 0 path is a real directory (an lstat: never followed) with this device,
  #                        inode and birth time; 1 something else stands there, or nothing does; 2 could not be read
  local p="${1-}" want="${2-}" bt="${3-}" have hbt rc
  if [[ -L "$p" ]] || { [[ -e "$p" ]] && [[ ! -d "$p" ]]; }; then return 1; fi
  if [[ ! -e "$p" ]]; then
    _ws_reclaim_absent "$p"; rc=$?
    (( rc == 0 )) && return 1
    return 2
  fi
  have=$(_plat_devino "$p" 2>/dev/null) && [[ "$have" =~ ^[0-9]+:[0-9]+$ ]] || return 2
  hbt=$(_plat_btime "$p" 2>/dev/null) && [[ "$hbt" =~ ^-?[0-9]+$ ]] || return 2
  [[ "$have" == "$want" && "$hbt" == "$bt" ]] || return 1
  return 0
}

_WS_MOVE_WHY=''
_ws_collect_move() {   # src dst dev:ino btime -> 0 PROVEN moved: dst is that directory, and nothing stands at src;
  #                       1 PROVEN not moved: src is still that directory; 2 unmeasured (_WS_MOVE_WHY)
  # THE PROOF IS AN lstat, NEVER mv's EXIT CODE (spec §5.6): coreutils changed
  # what `mv -n` answers on a skip in 9.2, and a `mv` that copied would answer 0
  # over a new inode. The same proof serves the move into a slot and the move
  # back: the restore is proven when the original path is the directory again
  # and the slot's `leaf` is gone. A box with no `--no-copy` never renames:
  # without it a cross-device rename becomes a copy. A cross-device rename
  # with it fails, and that is "not moved" here: the caller reads every
  # non-zero answer as unmeasured.
  local src="${1-}" dst="${2-}" want="${3-}" bt="${4-}" err mrc a b
  _WS_MOVE_WHY=''
  _ws_collect_mv_ok \
    || { _WS_MOVE_WHY="this box has no 'mv --no-copy' (or is Darwin), so $src was never renamed — a rename that could copy is never used"; return 2; }
  err=$(_ws_collect_mv "$src" "$dst" 2>&1); mrc=$?
  _ws_collect_ident "$dst" "$want" "$bt"; a=$?
  if (( a == 0 )); then
    _ws_reclaim_absent "$src"; b=$?
    (( b != 0 )) || return 0
    _WS_MOVE_WHY="$dst is $want, but ${_WS_ABSENT_WHY:-something stands at $src again} — the move is not proven"
    return 2
  fi
  _ws_collect_ident "$src" "$want" "$bt"; b=$?
  if (( b == 0 )); then
    _WS_MOVE_WHY="$src was not moved to $dst (mv exit $mrc${err:+: ${err%%$'\n'*}})"
    return 1
  fi
  _WS_MOVE_WHY="neither $dst nor $src is the directory $want after the rename (mv exit $mrc${err:+: ${err%%$'\n'*}})"
  return 2
}
```

(b) In `_ws_dir_physical`'s header, replace these seven lines:

```bash
  # THE ONE PHYSICAL RESOLUTION its seven callers share: a directory a removal
  # or an in-use probe acts under, or a leaf a placement or a checkout question
  # is asked of. The three newline sites: `_ws_leaf_remove`'s root,
  # `_ws_path_users`' parent and `_ws_expire_cwd_users`' parent. The four
  # leaf-question sites: `_ws_reclaim_workdir_shared`'s leaf placement,
  # `_ws_leaf_checkouts`' leaf, and `_ws_leaf_checkout_one`'s admin directory
  # and checkout directory. A bare `$(cd -- "$d" && pwd -P)` dropped EVERY
```

with these ten:

```bash
  # THE ONE PHYSICAL RESOLUTION its eight callers share: a directory a removal
  # or an in-use probe acts under, or a leaf a placement or a checkout question
  # is asked of. The three newline sites: `_ws_leaf_remove`'s root,
  # `_ws_path_users`' parent and `_ws_expire_cwd_users`' parent. The four
  # leaf-question sites: `_ws_reclaim_workdir_shared`'s leaf placement,
  # `_ws_leaf_checkouts`' leaf, and `_ws_leaf_checkout_one`'s admin directory
  # and checkout directory. The eighth is the collector's quarantine
  # (`_ws_collect_qpath`, one call site: `_ws_collect_qdir` makes the
  # quarantine under it, and the record reader only derives a slot there).
  # A bare `$(cd -- "$d" && pwd -P)` dropped EVERY
```

- [ ] **Step 4: Run to pass, then the gates**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-collect-quarantine.test.ts
cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-leaf-root-newline.test.ts
```

Expected:
- `ccd-collect-quarantine`: 34 passed on Linux. On macOS the real-rename and `mv`-shim cases are skipped, and the Darwin case still runs.
- `macos-platform` green, including `ccd/ccd carries no un-shimmed GNU call` and the new exemption case.
- `ccd-leaf-root-newline` green: `_ws_dir_physical` is unchanged but for its comment.

- [ ] **Step 5: Mutation check**

Command, unless the row says otherwise: `cd server && ./node_modules/.bin/vitest run test/ccd-collect-quarantine.test.ts`. The `macos-platform` rows run `cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts -t 'un-shimmed GNU call|exemption'`.

| # | Mutation (exact edit) | Reds | Expected failure |
|---|---|---|---|
| B1 | In `_ws_collect_move`, directly after `  err=$(_ws_collect_mv "$src" "$dst" 2>&1); mrc=$?` add `  (( mrc != 0 )) \|\| return 0` (trust the exit code) | the COPY, answers-0 and stands-AGAIN cases | `expected '0' to be '2'`; `expected '0' to be '1'`; `expected '0' to be '2'` |
| B2 | In `_ws_collect_mv`, replace `mv -T -n --no-copy --` with `mv -T --no-copy --` (no NOREPLACE) | "NOREPLACE: an empty directory at the destination is never replaced" | `expected '0' to be '1'` (a plain `mv -T` replaces an empty directory, as measured) |
| B3 | In `_ws_collect_move`, replace `  _ws_collect_mv_ok \` with `  true \` | "a box whose mv has no `--no-copy` never renames" | `expected '0' to be '2'` |
| B4 | In `_ws_collect_mv_ok`, delete `  [[ "$CCD_OS" != darwin ]] \|\| return 1` | "Darwin never renames: 2, mv is never run, and nothing moved" | `the capability answers no on Darwin: expected '0' to be '1'` |
| B5 | In `_ws_collect_move`'s rc-0 arm, replace `    _ws_reclaim_absent "$src"; b=$?` and `    (( b != 0 )) \|\| return 0` with `    return 0` | "a move whose source stands AGAIN … is not proven: 2" | `expected '0' to be '2'` |
| B6 | In `_ws_collect_ident`, replace `  [[ "$have" == "$want" && "$hbt" == "$bt" ]] \|\| return 1` with `  [[ "$have" == "$want" ]] \|\| return 1` | the `_ws_collect_ident` case | `expected '0' to be '1'` (another birth time) |
| B7 | In `_ws_collect_qdir`, delete `  [[ "$mode" == 700 ]] \|\| { _WS_Q_WHY="$q is mode $mode, not 0700"; return 2; }` | "mode 0755 at the quarantine's name is unmeasured" | `expected '0' to be '2'` |
| B8 | In `_ws_collect_qdir`, replace `  [[ -d "$q" && ! -L "$q" ]] \|\| { _WS_Q_WHY=` with `  [[ -d "$q" ]] \|\| { _WS_Q_WHY=` | "a LINK to a directory at the quarantine's name" | `expected '…' to contain 'not a real directory'` |
| B9 | In `_ws_collect_qdir`, delete `  [[ "$owner" == "$me" ]] \|\| { _WS_Q_WHY="$q belongs to uid $owner, not this uid $me"; return 2; }` | "another uid's quarantine is unmeasured" | `expected '0' to be '2'` |
| B10 | In `_ws_collect_qpath`, replace `  _WS_QPATH="${_WS_PHYS%/}/.ccd-quarantine"` with `  _WS_QPATH="${root%/}/.ccd-quarantine"` (the logical spelling) | "absent: made 0700 under the PHYSICAL ~/.cc-tmp" | `expected '…/.cc-tmp/.ccd-quarantine' to be '…/vol/.ccd-quarantine'` |
| B11 | In `_ws_collect_slot_make`, replace `  if ! err=$(mkdir -m 0700 -- "$s" 2>&1); then` with `  if ! err=$(mkdir -p -m 0700 -- "$s" 2>&1); then` | "the exclusive mkdir itself refuses a name that appears after the absence check" | `expected '0' to be '1'` |
| B12 | B11, AND delete the two `(( rc != 1 ))`/`(( rc != 2 ))` lines above it | the four "never reused" cases, the racer case, "a parent that does not exist" | `expected '0' to be '1'`; `expected '0' to be '2'` |
| B13 | Rename `_ws_collect_mv() {` to `_ws_collect_rename() {` (definition only) | `macos-platform`: "ccd/ccd carries no un-shimmed GNU call" and the exemption case | `ccd/ccd runs a GNU-only command outside the platform block …: expected [ Array(1) ] to deeply equal []`; `_ws_collect_mv must be findable …: expected null not to be null` |
| B14 | Inside `_ws_collect_mv`, directly above its `mv` line, add `  stat -c %W "$1" >/dev/null` | `macos-platform`: the exemption case | `the exemption buys exactly one spelling: the no-copy rename: expected [ …(2) ] to deeply equal [ Array(1) ]` |
| B15 | Delete `_ws_collect_mv`'s first line `  [[ "$CCD_OS" != darwin ]] \|\| return 2` | `macos-platform`: the exemption case | `its first line refuses Darwin: expected 'mv -T -n --no-copy -- "$1" "$2"' to be '[[ "$CCD_OS" != darwin ]] \|\| return 2'` |

TWO GUARDS WITH NO BEHAVIOURAL RED OF THEIR OWN, stated:
- `_ws_collect_ident`'s `-L` arm. `_plat_devino` is itself an lstat (`stat -c` without `-L`), so a link to the very directory reads the LINK's inode and answers 1 without that arm.
- `_ws_collect_mv`'s Darwin line. `_ws_collect_mv_ok` refuses Darwin first. It is pinned instead by B15's macOS case.

- [ ] **Step 6: Re-stamp and commit**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd                  # ccd/ccd: ccrc-unmodified
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
git add ccd/ccd server/test/ccd-collect-quarantine.test.ts server/test/macos-platform.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): the collector's quarantine, its slot, and a rename proven by lstat

The quarantine is <physical ~/.cc-tmp>/.ccd-quarantine: a real directory
of this uid at 0700, made when proven absent, unmeasured as anything
else. A slot is slot.<id>.<ns>.<pid>, made by an exclusive mkdir and
never reused. The leaf moves by one renameat2(RENAME_NOREPLACE),
mv -T -n --no-copy, spelled in one Linux-only function; the move and the
move back are proven by lstat of where the directory went and of where
it was, never by mv's exit code. No --no-copy, and Darwin, never rename.
macos-platform.test.ts exempts exactly that one function and pins it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

#### 4C — the idle walk, the floor and the token

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-collect-idle-token.test.ts`:

```ts
// The temp-root collector's IDLE WALK, its FLOOR and its TOKEN (child
// reclamation wave 7, spec §5.6).
//
// The walk is GNU `find -P <leaf> -xdev` under LC_ALL=C: the newest CTIME, in
// ns, over every entry, the leaf included, and the entry count. mtime is never
// read — a user can set it into the future, and every change that moves it
// stamps ctime anyway. A timeout, an unreadable entry, the entry cap, or any
// other failure is UNMEASURED, said in its own word. The floor is
// max(24 h, WS_COLLECT_IDLE_FLOOR_S): the knob only raises it. The one
// test-only seam that lowers it is redefining `_ws_collect_floor_s` in the
// sourced harness (ruling G4), pinned below; the other cases name the instant
// instead, through the collector's clock seam `_ws_collect_now_ns`, as
// `_ws_expire_now` is named.
//
// The token is `_ws_reclaim_fingerprint`'s encoding over `mode=collect`, the id,
// the witness's dev, ino, btime, run and at, the newest ctime and the count. An
// unmeasured input mints nothing.
//
// FIXTURE HOMES ONLY (`makePrHarness`); the `find` shim is a script on PATH
// inside the HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';

let h: PrHarness;
let restore: [string, number][] = [];
beforeEach(() => { h = makePrHarness('ccrc-collect-idle-'); restore = []; });
afterEach(() => {
  for (const [p, m] of restore.reverse()) { try { fs.chmodSync(p, m); } catch { /* gone */ } }
  h.cleanup();
});
const chmodFor = (p: string, mode: number): void => {
  restore.push([p, fs.statSync(p).mode & 0o7777]);
  fs.chmodSync(p, mode);
};

const ID = 'demo-quiet-mesa';
const ROOT_USER = process.getuid?.() === 0;
const LINUX = process.platform === 'linux';
const DAY_NS = 86_400n * 1_000_000_000n;
const leaf = (id: string = ID): string => path.join(h.home, '.cc-tmp', id);

interface Walk { rc: string; newest: string; count: string; why: string; detail: string; walked: string }
const walk = (p: string, pre = ''): Walk => {
  const [rc = '', newest = '', count = '', why = '', detail = '', walked = ''] = h.sh(`${pre} _ws_collect_idle '${p}'; rc=$?;`
    + ' printf \'%s\\x1f%s\\x1f%s\\x1f%s\\x1f%s\\x1f%s\' "$rc" "$_WS_IDLE_NEWEST_NS" "$_WS_IDLE_COUNT" "$_WS_IDLE_WHY" "$_WS_IDLE_DETAIL" "$_WS_IDLE_LEAF"')
    .split('\x1f');
  return { rc, newest, count, why, detail, walked };
};
/** Node's own answer: every entry under p (p included, links not followed), and the newest ctime in ns. */
const measured = (p: string): { newest: bigint; count: number } => {
  let newest = 0n; let count = 0;
  const visit = (q: string): void => {
    const st = fs.lstatSync(q, { bigint: true });
    count += 1;
    if (st.ctimeNs > newest) newest = st.ctimeNs;
    if (st.isDirectory()) for (const e of fs.readdirSync(q)) visit(path.join(q, e));
  };
  visit(p);
  return { newest, count };
};
const plant = (): void => {
  fs.mkdirSync(path.join(leaf(), 'cdk.out', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(leaf(), 'cdk.out', 'm.json'), '{}');
  fs.writeFileSync(path.join(leaf(), 'cdk.out', 'deep', 'x'), 'x');
};

describe.skipIf(!LINUX)('_ws_collect_idle — the newest CTIME over the whole leaf, in ns, and the entry count', () => {
  it('equals node’s own lstat walk: every entry and the leaf itself, exactly', () => {
    plant();
    const w = walk(leaf());
    expect(w.rc, w.detail).toBe('0');
    const m = measured(leaf());
    expect(w.newest).toBe(String(m.newest));
    expect(w.count).toBe(String(m.count));
    expect(m.count, 'the CONTROL: the leaf, two directories and two files').toBe(5);
    expect(w.walked).toBe(leaf());
  });

  it('an EMPTY leaf is one entry, and its own ctime is the newest — the leaf is included', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    const w = walk(leaf());
    expect(w.rc, w.detail).toBe('0');
    expect(w.count).toBe('1');
    expect(w.newest).toBe(String(fs.lstatSync(leaf(), { bigint: true }).ctimeNs));
  });

  it('a FUTURE mtime holds nothing: the newest is a ctime, and a day past it the floor is reached', () => {
    plant();
    const far = new Date('2100-01-01T00:00:00Z');
    fs.utimesSync(path.join(leaf(), 'cdk.out', 'm.json'), far, far);
    fs.utimesSync(leaf(), far, far);
    const w = walk(leaf());
    expect(w.rc, w.detail).toBe('0');
    expect(BigInt(w.newest), 'not the year-2100 mtime').toBeLessThan(BigInt(Date.now() + 60_000) * 1_000_000n);
    expect(w.newest).toBe(String(measured(leaf()).newest));
    const at = BigInt(w.newest) + DAY_NS;
    expect(h.sh(`_ws_collect_now_ns() { echo ${at}; }; _ws_collect_floor_held ${w.newest}; echo $?`)).toBe('0');
  });

  it('a LINK in the leaf is one entry — its own ctime — and what it points at is never walked', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    const outside = path.join(h.home, 'outside');
    fs.mkdirSync(path.join(outside, 'a', 'b'), { recursive: true });
    fs.symlinkSync(outside, path.join(leaf(), 'link'));
    const w = walk(leaf());
    expect(w.rc, w.detail).toBe('0');
    expect(w.count).toBe('2');
  });

  it.skipIf(ROOT_USER)('an UNREADABLE entry is unmeasured, in its own word — never normalised', () => {
    plant();
    fs.mkdirSync(path.join(leaf(), 'locked'));
    fs.writeFileSync(path.join(leaf(), 'locked', 'x'), 'x');
    chmodFor(path.join(leaf(), 'locked'), 0o000);
    const w = walk(leaf());
    expect(w).toMatchObject({ rc: '2', why: 'unreadable', newest: '', count: '' });
    expect(w.detail).toContain('could not read all of');
    expect((fs.statSync(path.join(leaf(), 'locked')).mode & 0o777).toString(8), 'nothing was made readable').toBe('0');
  });

  it('more entries than the cap is unmeasured, `cap`; exactly the cap is walked', () => {
    plant();
    expect(walk(leaf(), 'WS_COLLECT_IDLE_CAP=5;'), 'the CONTROL: five entries, cap five').toMatchObject({ rc: '0', count: '5' });
    expect(walk(leaf(), 'WS_COLLECT_IDLE_CAP=4;')).toMatchObject({ rc: '2', why: 'cap', newest: '', count: '' });
  });

  it('a walk that outruns its bound is unmeasured, `timeout` — a real find that hangs, killed by the bound', () => {
    plant();
    const realFind = execFileSync('sh', ['-c', 'command -v find'], { encoding: 'utf8', env: inheritedEnv() }).trim();
    const shim = path.join(h.home, 'shim');
    fs.mkdirSync(shim);
    // Only THIS walk hangs (it alone prints change times); every other find is the real one.
    fs.writeFileSync(path.join(shim, 'find'), `#!/bin/sh\ncase " $* " in *" -printf "*) exec sleep 30 ;; esac\nexec '${realFind}' "$@"\n`,
      { mode: 0o755 });
    const t0 = Date.now();
    const w = walk(leaf(), `PATH="${shim}:$PATH"; hash -r; WS_COLLECT_IDLE_SCAN_S=1; CCD_TIMEOUT_KILL_AFTER=2;`);
    expect(Date.now() - t0, 'the bound cut it short (the shim sleeps 30 s)').toBeLessThan(20_000);
    expect(w).toMatchObject({ rc: '2', why: 'timeout', newest: '', count: '' });
  }, 60_000);

  it('a find that fails for another reason, or prints what is not a change time, is `walk-failed`', () => {
    plant();
    const shim = path.join(h.home, 'shim');
    fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, 'find'), '#!/bin/sh\necho "find: something else went wrong" >&2\nexit 1\n', { mode: 0o755 });
    expect(walk(leaf(), `PATH="${shim}:$PATH"; hash -r;`)).toMatchObject({ rc: '2', why: 'walk-failed' });
    fs.writeFileSync(path.join(shim, 'find'), '#!/bin/sh\necho "Wed Oct  8 12:00:00 2026"\n', { mode: 0o755 });
    expect(walk(leaf(), `PATH="${shim}:$PATH"; hash -r;`)).toMatchObject({ rc: '2', why: 'walk-failed' });
  });

  it('a leaf that is not a real directory — a link, a file, nothing — is never walked: `walk-failed`', () => {
    fs.mkdirSync(path.join(h.home, 'target'), { recursive: true });
    fs.mkdirSync(path.dirname(leaf()), { recursive: true });
    fs.symlinkSync(path.join(h.home, 'target'), leaf());
    expect(walk(leaf())).toMatchObject({ rc: '2', why: 'walk-failed' });
    fs.unlinkSync(leaf());
    fs.writeFileSync(leaf(), 'x');
    expect(walk(leaf())).toMatchObject({ rc: '2', why: 'walk-failed' });
    expect(walk(path.join(h.home, 'nothing'))).toMatchObject({ rc: '2', why: 'walk-failed' });
  });
});

describe('_ws_collect_idle on Darwin', () => {
  it('is unmeasured, `walk-failed`, and walks nothing', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    expect(walk(leaf(), 'CCD_OS=darwin;')).toMatchObject({ rc: '2', why: 'walk-failed', newest: '', count: '' });
  });
});

describe('_ws_collect_floor_s / _ws_collect_floor_held — max(24 h, the knob); the clock is a test seam', () => {
  const NEWEST = 1_791_400_000_000_000_000n;
  const held = (nowNs: bigint | string, env = ''): string =>
    h.sh(`${env} _ws_collect_now_ns() { echo ${nowNs}; }; _ws_collect_floor_held ${NEWEST}; echo $?`);

  it('the floor is 24 h: a day less one ns is not idle, a day is', () => {
    expect(h.sh('_ws_collect_floor_s')).toBe('86400');
    expect(held(NEWEST + DAY_NS - 1n)).toBe('1');
    expect(held(NEWEST + DAY_NS)).toBe('0');
  });

  it('the floor is read through `_ws_collect_floor_s`, the ONE test-only seam that lowers it (ruling G4)', () => {
    const FLOOR0 = '_ws_collect_floor_s() { echo 0; };';
    expect(held(NEWEST, FLOOR0), 'redefined to 0: the newest instant itself is idle').toBe('0');
    expect(held(NEWEST - 1n, FLOOR0), 'a clock behind the newest change is still not idle').toBe('1');
  });

  it('the knob RAISES it; a lower, empty or malformed value leaves it at 24 h', () => {
    expect(h.sh('WS_COLLECT_IDLE_FLOOR_S=90000; _ws_collect_floor_s')).toBe('90000');
    expect(held(NEWEST + DAY_NS, 'WS_COLLECT_IDLE_FLOOR_S=90000;')).toBe('1');
    expect(held(NEWEST + 90_000n * 1_000_000_000n, 'WS_COLLECT_IDLE_FLOOR_S=90000;')).toBe('0');
    for (const v of ['3600', '0', '', 'x', '-90000', '86400s']) {
      expect(h.sh(`WS_COLLECT_IDLE_FLOOR_S='${v}'; _ws_collect_floor_s`), `knob ${JSON.stringify(v)}`).toBe('86400');
    }
    expect(held(NEWEST + DAY_NS - 1n, 'WS_COLLECT_IDLE_FLOOR_S=3600;'), 'a lower knob never lowers it').toBe('1');
  });

  it('a newest change AHEAD of the clock (a clock stepped back) is not idle: 1', () => {
    expect(held(NEWEST - 1n)).toBe('1');
  });

  it('a clock or an input that cannot be read is unmeasured: 2', () => {
    expect(held('soon')).toBe('2');
    expect(h.sh('_ws_collect_floor_held x; echo $?')).toBe('2');
  });
});

describe('_ws_collect_token — named inputs, mode=collect first; an unmeasured input mints nothing', () => {
  const W = { dev: '2064', ino: '35429071', btime: '1791468463', run: '7', at: '1791470480213' };
  const IDLE = { newest: '1791468465283232695', count: '76915' };
  const SET = (w: Record<string, string> = W, idle: Record<string, string> = IDLE, walked = `/h/.cc-tmp/${ID}`): string =>
    `_WS_WIT_DEV='${w.dev}' _WS_WIT_INO='${w.ino}' _WS_WIT_BTIME='${w.btime}' _WS_WIT_RUN='${w.run}' _WS_WIT_AT='${w.at}';`
    + ` _WS_IDLE_NEWEST_NS='${idle.newest}' _WS_IDLE_COUNT='${idle.count}' _WS_IDLE_LEAF='${walked}';`;
  const token = (pre: string, id: string = ID): { rc: string; out: string } => {
    const [rc = '', out = ''] = h.sh(`${pre} out=$(_ws_collect_token '${id}'); rc=$?; printf '%s\\x1f%s' "$rc" "$out"`).split('\x1f');
    return { rc, out };
  };

  it('is the sha256 of exactly these named lines, in this order', () => {
    const lines = [`mode=collect`, `id=${ID}`, `dev=${W.dev}`, `ino=${W.ino}`, `btime=${W.btime}`, `run=${W.run}`,
      `at=${W.at}`, `newestCtimeNs=${IDLE.newest}`, `entries=${IDLE.count}`];
    const want = createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex');
    expect(token(SET())).toEqual({ rc: '0', out: want });
  });

  it('every input moves it: the id, each witness field, the newest ctime and the count', () => {
    const base = token(SET()).out;
    const variants = [
      token(SET(W, IDLE, '/h/.cc-tmp/demo-quiet-reef'), 'demo-quiet-reef').out,
      token(SET({ ...W, dev: '2065' })).out,
      token(SET({ ...W, ino: '35429072' })).out,
      token(SET({ ...W, btime: '1791468464' })).out,
      token(SET({ ...W, at: '1791470480214' })).out,
      token(SET({ ...W, run: '8' })).out,
      token(SET(W, { ...IDLE, newest: `${IDLE.newest.slice(0, -1)}6` })).out,
      token(SET(W, { ...IDLE, count: '76916' })).out,
    ];
    for (const v of variants) expect(v).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([base, ...variants]).size, 'nine inputs, nine tokens').toBe(9);
  });

  it('no witness read: rc 2, nothing printed', () => {
    expect(token(`_WS_IDLE_NEWEST_NS=1 _WS_IDLE_COUNT=1 _WS_IDLE_LEAF=/h/.cc-tmp/${ID};`)).toEqual({ rc: '2', out: '' });
  });

  it.each([
    ['a witness with no birth time', '_WS_WIT_BTIME=-;'],
    ['a witness run outside the grammar', '_WS_WIT_RUN=07;'],
    ['no walk made', "_WS_IDLE_NEWEST_NS='' _WS_IDLE_COUNT='';"],
    ['a walk of ANOTHER leaf', "_WS_IDLE_LEAF=/h/.cc-tmp/demo-quiet-reef;"],
    ['a walk of a NESTED id’s leaf', `_WS_IDLE_LEAF=/h/.cc-tmp/${ID}.v2-x;`],
    ['a count of 0', '_WS_IDLE_COUNT=0;'],
  ])('%s: rc 2, nothing printed', (_label, tweak) => {
    expect(token(`${SET()} ${tweak}`)).toEqual({ rc: '2', out: '' });
  });

  it('an id no witness is named for: rc 2', () => {
    expect(token(SET(W, IDLE, '/h/.cc-tmp/.x'), '.x')).toEqual({ rc: '2', out: '' });
  });

  it.skipIf(!LINUX)('CONTROL: the REAL witness and the REAL walk mint one, and any change under the leaf mints another', () => {
    fs.mkdirSync(path.join(leaf(), 'x'), { recursive: true });
    const real = `_ws_tmproot_witness_write ${ID} '${leaf()}' 7 && _ws_tmproot_witness_read ${ID} && _ws_collect_idle '${leaf()}';`;
    const a = token(real);
    expect(a.rc).toBe('0');
    expect(token(real).out, 'unchanged: the same token').toBe(a.out);
    fs.writeFileSync(path.join(leaf(), 'x', 'new'), 'n');
    const b = token(real);
    expect(b.rc).toBe('0');
    expect(b.out).not.toBe(a.out);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-collect-idle-token.test.ts`

Expected: `Tests  26 failed (26)`. The walk cases throw `Error: Command failed: bash -c source … _ws_collect_idle '…'` (`command not found`, then `_WS_IDLE_NEWEST_NS: unbound variable`). The floor and token cases read rc 127: `expected { rc: '127', out: '' } to deeply equal { rc: '2', out: '' }`.

- [ ] **Step 3: Implement**

In `ccd/ccd`, directly ABOVE `# ── end temp-root collection ─────────────────────────────────────────────────── COLLECT-END ──` (so after 4B's functions), insert one blank line and then exactly this:

```bash
WS_COLLECT_IDLE_SCAN_S=60     # bound on one leaf's idle walk (measured 2026-10-08: the largest live leaf, 76,915 entries, in at most 4.8 s)
WS_COLLECT_IDLE_CAP=2000000   # the most entries one walk counts; more is unmeasured
_WS_IDLE_NEWEST_NS=''; _WS_IDLE_COUNT=''; _WS_IDLE_WHY=''; _WS_IDLE_DETAIL=''; _WS_IDLE_LEAF=''
_ws_collect_idle() {   # leaf -> 0 with _WS_IDLE_NEWEST_NS = the newest CTIME under leaf, leaf included, in epoch ns,
  #                       _WS_IDLE_COUNT = the entries walked, leaf included, and _WS_IDLE_LEAF = leaf; 2 unmeasured,
  #                       _WS_IDLE_WHY one word of `timeout`, `unreadable`, `cap` or `walk-failed`, _WS_IDLE_DETAIL why
  # CTIME ONLY (spec §5.6). mtime is user-settable — a future one would hold a
  # leaf for ever — and every change that moves it stamps ctime too: a write, a
  # create, a delete, a rename, a chmod, a utimensat. The walk is GNU `find -P
  # <leaf> -xdev`: it never follows a link (a link's own ctime is read) and
  # never crosses a file system. It writes nothing inside the leaf: no pass
  # before it makes anything readable, so an unreadable entry is unmeasured,
  # said in its own word, and never normalised here. Bounded by
  # `WS_COLLECT_IDLE_SCAN_S` and `WS_COLLECT_IDLE_CAP`. The newest value is
  # kept as two exact integers, seconds then nanoseconds, never one float.
  local LC_ALL=C leaf="${1-}" errf res tail err frc arc
  _WS_IDLE_NEWEST_NS=''; _WS_IDLE_COUNT=''; _WS_IDLE_WHY=''; _WS_IDLE_DETAIL=''; _WS_IDLE_LEAF=''
  if [[ "$CCD_OS" == darwin ]]; then
    _WS_IDLE_WHY=walk-failed; _WS_IDLE_DETAIL="the idle walk is GNU find's, and this box is Darwin"; return 2
  fi
  [[ -d "$leaf" && ! -L "$leaf" ]] \
    || { _WS_IDLE_WHY=walk-failed; _WS_IDLE_DETAIL="$leaf is not a real directory, so it was not walked"; return 2; }
  errf=$(_plat_mktemp) || { _WS_IDLE_WHY=walk-failed; _WS_IDLE_DETAIL="could not make a scratch file to walk $leaf"; return 2; }
  res=$(LC_ALL=C _plat_timeout "$WS_COLLECT_IDLE_SCAN_S" find -P "$leaf" -xdev -printf '%C@\n' 2>"$errf" \
        | LC_ALL=C awk -v cap="$WS_COLLECT_IDLE_CAP" '
            { if (++n > cap) { over = 1; exit }
              if ($0 !~ /^[0-9]+[.][0-9]+$/) { bad = 1; exit }
              i = index($0, ".")
              s = substr($0, 1, i - 1) + 0
              f = substr(substr($0, i + 1) "000000000", 1, 9) + 0
              if (n == 1 || s > ms || (s == ms && f > mf)) { ms = s; mf = f } }
            END { if (over) exit 3
                  if (bad || n == 0) exit 4
                  printf "%d %.0f%09d\n", n, ms, mf }'
        printf '\nrc %s %s' "${PIPESTATUS[0]}" "${PIPESTATUS[1]}")
  err=$(cat "$errf" 2>/dev/null); rm -f "$errf"
  tail="${res##*$'\n'}"; res="${res%$'\n'*}"; res="${res%$'\n'}"
  read -r _ frc arc <<< "$tail"
  if [[ "$arc" == 3 ]]; then
    _WS_IDLE_WHY=cap; _WS_IDLE_DETAIL="$leaf holds more than $WS_COLLECT_IDLE_CAP entries, so its newest change was never found"; return 2
  fi
  if [[ "$frc" == 124 ]]; then
    _WS_IDLE_WHY=timeout; _WS_IDLE_DETAIL="the walk of $leaf did not finish within ${WS_COLLECT_IDLE_SCAN_S}s"; return 2
  fi
  if [[ "$frc" != 0 || -n "$err" ]]; then
    if [[ "$err" == *"Permission denied"* ]]; then _WS_IDLE_WHY=unreadable; else _WS_IDLE_WHY=walk-failed; fi
    _WS_IDLE_DETAIL="could not read all of $leaf (find exit $frc${err:+: ${err%%$'\n'*}}), so a change under what it could not read was never seen"
    return 2
  fi
  [[ "$arc" == 0 && "$res" =~ ^([1-9][0-9]*)\ ([0-9]{1,19})$ ]] \
    || { _WS_IDLE_WHY=walk-failed; _WS_IDLE_DETAIL="the walk of $leaf printed what is not a change time (awk exit $arc)"; return 2; }
  _WS_IDLE_COUNT="${BASH_REMATCH[1]}"; _WS_IDLE_NEWEST_NS="${BASH_REMATCH[2]}"; _WS_IDLE_LEAF="$leaf"
  return 0
}

_ws_collect_floor_s() {   # -> the idle floor, whole seconds: 86400 (24 h, spec §5.6), or WS_COLLECT_IDLE_FLOOR_S when it
  #                          is a whole number ABOVE that. The knob only RAISES the floor. This is the floor's ONE
  #                          definition (ruling G4): the only test-only seam that lowers it is a sourced harness
  #                          redefining this function (`_ws_collect_floor_s() { echo 0; };`), never the knob
  local b=86400 o="${WS_COLLECT_IDLE_FLOOR_S-}"
  if [[ "$o" =~ ^[0-9]{1,9}$ ]] && (( 10#$o > b )); then b=$(( 10#$o )); fi
  printf '%s' "$b"
}
_ws_collect_floor_held() {   # newest-ns -> 0 when the clock is at least the floor past it; 1 when not yet (a clock
  #                              stepped backwards only delays it); 2 when the input or the clock cannot be read
  local nw="${1-}" now fl
  [[ "$nw" =~ ^[0-9]{1,19}$ ]] || return 2
  now=$(_ws_collect_now_ns) && [[ "$now" =~ ^[1-9][0-9]{9,18}$ ]] || return 2
  fl=$(_ws_collect_floor_s)
  (( 10#$now - 10#$nw >= fl * 1000000000 )) || return 1
  return 0
}

_ws_collect_token() {   # id -> the collector's token on stdout; rc 2, nothing printed, when an input was not measured
  # THE CONSENT (spec §5.6), in `_ws_reclaim_fingerprint`'s encoding: named
  # key=value inputs, `mode=collect` first, so it never equals a reclaim, an
  # expiry or a resume token. It binds the id; the witness the caller read last
  # (`_ws_tmproot_witness_read <id>`: dev, ino, btime, run, at); and the walk the
  # caller made last (`_ws_collect_idle` of the leaf named `<id>`: the newest
  # ctime in ns and the entry count). Any change under the leaf stamps a ctime,
  # and a re-witness changes run or at, so either mints another token. An
  # unmeasured input — an empty field, a `-` birth time, a walk of another leaf —
  # mints NOTHING.
  local LC_ALL=C id="${1-}"
  _ws_tmproot_id_ok "$id" || return 2
  [[ "${_WS_WIT_DEV-}" =~ ^[0-9]+$ && "${_WS_WIT_INO-}" =~ ^[0-9]+$ && "${_WS_WIT_BTIME-}" =~ ^[1-9][0-9]*$ \
     && "${_WS_WIT_AT-}" =~ ^[0-9]{13}$ ]] || return 2
  _child_runid_valid "${_WS_WIT_RUN-}" || return 2
  [[ "${_WS_IDLE_NEWEST_NS-}" =~ ^[0-9]{1,19}$ && "${_WS_IDLE_COUNT-}" =~ ^[1-9][0-9]*$ \
     && "${_WS_IDLE_LEAF-}" == */"$id" ]] || return 2
  _ws_reclaim_fingerprint "mode=collect" "id=$id" "dev=$_WS_WIT_DEV" "ino=$_WS_WIT_INO" "btime=$_WS_WIT_BTIME" \
    "run=$_WS_WIT_RUN" "at=$_WS_WIT_AT" "newestCtimeNs=$_WS_IDLE_NEWEST_NS" "entries=$_WS_IDLE_COUNT"
}
```

- [ ] **Step 4: Run to pass**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-collect-idle-token.test.ts`

Expected: 26 passed. The timeout case takes about 3 s: the shim sleeps 30 s, and `WS_COLLECT_IDLE_SCAN_S=1` plus a 2 s kill grace cuts it.

- [ ] **Step 5: Mutation check**

Command: `cd server && ./node_modules/.bin/vitest run test/ccd-collect-idle-token.test.ts`.

| # | Mutation (exact edit) | Reds | Expected failure |
|---|---|---|---|
| C1 | In `_ws_collect_idle`, replace `-printf '%C@\n'` with `-printf '%T@\n'` (mtime) | "a FUTURE mtime holds nothing" | `not the year-2100 mtime: expected 4102444800000000000 to be less than …` |
| C2 | Replace `find -P "$leaf" -xdev -printf` with `find -P "$leaf" -xdev -mindepth 1 -printf` (the leaf excluded) | "equals node's own lstat walk", "an EMPTY leaf is one entry", the LINK case, the cap case | `expected '4' to be '5'`; `… printed what is not a change time (awk exit 4): expected '2' to be '0'` |
| C3 | Replace `find -P "$leaf"` with `find -L "$leaf"` (follow links) | "a LINK in the leaf is one entry" | `expected '4' to be '2'` |
| C4 | In the awk program, replace `{ if (++n > cap) { over = 1; exit }` with `{ ++n` | "more entries than the cap is unmeasured, `cap`" | `expected { rc: '0', …(5) } to match object { rc: '2', why: 'cap', …(2) }` |
| C5 | Replace `  if [[ "$frc" == 124 ]]; then` with `  if false; then` | "a walk that outruns its bound is unmeasured, `timeout`" | `expected { … } to match object { rc: '2', why: 'timeout', …(2) }` |
| C6 | Replace the awk line `if (n == 1 \|\| s > ms \|\| (s == ms && f > mf)) { ms = s; mf = f } }` with `v = $0 + 0; if (n == 1 \|\| v > mv) { mv = v; ms = int(v); mf = int((v - ms) * 1000000000) } }` (one float) | "equals node's own lstat walk" | `expected '<ns, low digits lost>' to be '<node's ctimeNs>'` |
| C7 | In `_ws_collect_floor_s`, replace `  if [[ "$o" =~ ^[0-9]{1,9}$ ]] && (( 10#$o > b )); then b=$(( 10#$o )); fi` with `  if [[ "$o" =~ ^[0-9]{1,9}$ ]]; then b=$(( 10#$o )); fi` (the knob may lower) | "the knob RAISES it; a lower … value leaves it at 24 h" | `knob "3600": expected '3600' to be '86400'` |
| C8 | In `_ws_collect_floor_held`, replace `>= fl * 1000000000` with `> fl * 1000000000` | "the floor is 24 h: a day less one ns is not idle, a day is" | `expected '1' to be '0'` |
| C9 | In `_ws_collect_token`, delete the input `"run=$_WS_WIT_RUN" ` | "is the sha256 of exactly these named lines", "every input moves it" | `expected { rc: '0', …(1) } to deeply equal { rc: '0', …(1) }`; `nine inputs, nine tokens: expected 8 to be 9` |
| C10 | In `_ws_collect_token`, delete the input ` "entries=$_WS_IDLE_COUNT"` | the same two | the same two |
| C11 | In `_ws_collect_token`, replace `"${_WS_WIT_BTIME-}" =~ ^[1-9][0-9]*$` with `-n "${_WS_WIT_BTIME-}"` | "a witness with no birth time: rc 2, nothing printed" | `expected { rc: '0', …(1) } to deeply equal { rc: '2', out: '' }` |
| C12 | In `_ws_collect_token`, delete `&& "${_WS_IDLE_LEAF-}" == */"$id" ` | "a walk of ANOTHER leaf" | `expected { rc: '0', …(1) } to deeply equal { rc: '2', out: '' }` |
| C13 | Delete `_ws_collect_idle`'s Darwin arm (its three-line `if [[ "$CCD_OS" == darwin ]]; then … fi`) | "_ws_collect_idle on Darwin: is unmeasured, `walk-failed`" | `expected { rc: '0', …(5) } to match object { rc: '2', why: 'walk-failed', …(2) }` |
| C14 | In `_ws_collect_floor_held`, replace `  fl=$(_ws_collect_floor_s)` with `  fl=86400` (a second definition of the floor) | "the floor is read through `_ws_collect_floor_s` …" | `redefined to 0: the newest instant itself is idle: expected '1' to be '0'` |

THE STDERR ARM HAS NO RED OF ITS OWN. Replacing `  if [[ "$frc" != 0 \|\| -n "$err" ]]; then` with `  if [[ "$frc" != 0 ]]; then` leaves "an UNREADABLE entry" green, because GNU find exits 1 whenever it reports an unreadable directory. It is defence in depth for a find that writes to stderr and still answers 0, as wave 6's checkout walk states for the same arm.

- [ ] **Step 6: Re-stamp and commit**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd                  # ccd/ccd: ccrc-unmodified
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
git add ccd/ccd server/test/ccd-collect-idle-token.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): the collector's idle walk, its floor and its token

The newest CTIME, in ns, over every entry under the leaf, the leaf
included, by GNU find -P -xdev under LC_ALL=C; mtime is never read, so
a future mtime holds nothing. A timeout (60 s), an unreadable entry, the
cap (2,000,000) and any other failure are unmeasured, each in its own
word. The floor is max(24 h, WS_COLLECT_IDLE_FLOOR_S): the knob only
raises it; the one test-only seam that lowers it is a sourced harness
redefining _ws_collect_floor_s, and _ws_collect_now_ns stays a clock
seam. The token is the reclaim fingerprint's encoding
over mode=collect, the id, the witness's dev ino btime run at, the
newest ctime and the entry count; an unmeasured input mints nothing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

#### 4D — the row rule: no registry row at, inside or through the leaf

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-collect-rows.test.ts`:

```ts
// The temp-root collector's ROW RULE (child reclamation wave 7, spec §5.5 and
// §5.6): no registry row may lie at, inside or through the leaf it collects.
// The removal helper does not ask this, so the collector asks it itself, by
// `_ws_reclaim_workdir_shared`'s own comparisons in ONE registry pass, with the
// leaf as the workdir: every row, standing or placed by either gone-row arm,
// literally and resolved — equal, inside, or spelled through it. MEASURED: a
// stopped session's clone inside a dead child's temp root is that session's
// tree, and without this rule the collector deletes it.
//
// FIXTURE HOMES ONLY (`makePrHarness`): every row, leaf and repository is under
// the harness's HOME. Nothing here removes anything.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';

let h: PrHarness;
let restore: [string, number][] = [];
beforeEach(() => { h = makePrHarness('ccrc-collect-rows-'); restore = []; });
afterEach(() => {
  for (const [p, m] of restore.reverse()) { try { fs.chmodSync(p, m); } catch { /* gone */ } }
  h.cleanup();
});
const chmodFor = (p: string, mode: number): void => {
  restore.push([p, fs.statSync(p).mode & 0o7777]);
  fs.chmodSync(p, mode);
};

const ID = 'demo-quiet-mesa';             // the dead child: its row is gone, its temp root stands
const OTHER = 'demo2-calm-cove';          // another session
const ROOT_USER = process.getuid?.() === 0;
const leaf = (): string => path.join(h.home, '.cc-tmp', ID);

/** A row for `id` naming `workdir`, as `ccd start` leaves one; `project` when given. */
const row = (id: string, workdir: string, project?: string): void => {
  h.sh(`_reg_set ${id} wrapper claude
        _reg_set ${id} uuid deadbeef-0000-4000-8000-00000000000${id.length % 10}
        _reg_set ${id} workdir '${workdir}'${project ? `\n        _reg_set ${id} project ${project}` : ''}`);
};
const clear = (pre = ''): { rc: string; why: string } => {
  const [rc = '', why = ''] = h.sh(`${pre} _ws_collect_rows_clear ${ID} '${leaf()}'; rc=$?; printf '%s\\x1f%s' "$rc" "$_WS_COLLECT_ROWS_WHY"`)
    .split('\x1f');
  return { rc, why };
};
/** A clone at `dest` (a `.git` DIRECTORY), of a repository outside the leaf. */
const cloneAt = (dest: string): void => {
  const origin = path.join(h.home, 'origins', 'up.git');
  if (!fs.existsSync(origin)) h.makeRepo('up');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execFileSync('git', ['clone', '-q', origin, dest], { env: { ...inheritedEnv(), HOME: h.home } });
};

describe('_ws_collect_rows_clear — a row at, inside or through the leaf refuses: rc 1, the row named', () => {
  it('MEASURED: a STOPPED session’s clone inside the dead child’s temp root is that session’s tree', () => {
    const clone = path.join(leaf(), 'clone');
    cloneAt(clone);
    row(OTHER, clone);                     // stopped: its row stands, no pane
    const a = clear();
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`inside: ${OTHER}`);
  }, 60_000);

  it('a row AT the leaf', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    row(OTHER, leaf());
    const a = clear();
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`at: ${OTHER}`);
  });

  it('a row spelled THROUGH the leaf, not as one plain path', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    fs.mkdirSync(path.join(h.home, 'elsewhere'), { recursive: true });
    row(OTHER, `${leaf()}/../elsewhere`);
    const a = clear();
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`through: ${OTHER}`);
  });

  it('a row INSIDE the leaf reached through a link — compared RESOLVED, not only as written', () => {
    fs.mkdirSync(path.join(leaf(), 'work'), { recursive: true });
    fs.symlinkSync(leaf(), path.join(h.home, 'alias'));
    row(OTHER, path.join(h.home, 'alias', 'work'));
    const a = clear();
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`inside: ${OTHER}`);
  });

  it('a row inside the leaf whose directory is GONE still refuses — its spelling goes with the leaf', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    row(OTHER, path.join(leaf(), 'gone-tree'));
    const a = clear();
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`inside: ${OTHER}`);
  });

  it('AFTER the move (the pre-move spelling now absent), a row literally inside it still refuses', () => {
    fs.mkdirSync(path.join(leaf(), 'clone'), { recursive: true });
    row(OTHER, path.join(leaf(), 'clone'));
    fs.renameSync(leaf(), path.join(h.home, 'moved'));
    const a = clear();
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`inside: ${OTHER}`);
  });

  it('the id’s OWN row refuses — a temp root whose id has a row is never collected', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    row(ID, path.join(h.home, 'worktrees', 'demo', 'quiet-mesa'));
    const a = clear();
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`${ID}'s own registry row stands`);
  });
});

describe('_ws_collect_rows_clear — clear: rc 0', () => {
  it('no row at all, and rows elsewhere (beside the leaf, a sibling whose id has this id as a prefix)', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    expect(clear().rc).toBe('0');
    fs.mkdirSync(path.join(h.home, 'worktrees', 'demo2', 'calm-cove'), { recursive: true });
    row(OTHER, path.join(h.home, 'worktrees', 'demo2', 'calm-cove'));
    fs.mkdirSync(`${leaf()}-x`, { recursive: true });
    row('demo-quiet-mesa-x', `${leaf()}-x`);
    const a = clear();
    expect(a.rc, a.why).toBe('0');
  });

  it('after the move, with nothing at or under the pre-move spelling: 0', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    fs.renameSync(leaf(), path.join(h.home, 'moved'));
    expect(clear().rc).toBe('0');
  });

  it('a GONE row elsewhere that git’s own record places (the git-record placement) is placed, outside: 0', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    const main = h.makeRepo('demo2');
    const wt = path.join(h.home, 'worktrees', 'demo2', 'calm-cove');
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    h.git(main, 'worktree', 'add', '-q', '-b', 'ws/calm-cove', wt);
    row(OTHER, wt, 'demo2');
    fs.rmSync(wt, { recursive: true, force: true });   // gone; git's record reads prunable
    const a = clear();
    expect(a.rc, a.why).toBe('0');
  }, 60_000);
});

describe('_ws_collect_rows_clear — unmeasured: rc 2, never "no row"', () => {
  it('a GONE row elsewhere that nothing places is unmeasured', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    row(OTHER, path.join(h.home, 'worktrees', 'demo2', 'never-made'));
    const a = clear();
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain(OTHER);
  });

  it('a row that cannot be placed at all (a relative workdir) is unmeasured', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    row(OTHER, 'worktrees/demo2/calm-cove');
    expect(clear().rc).toBe('2');
  });

  it.skipIf(ROOT_USER)('a registry that cannot be listed is unmeasured', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    row(OTHER, path.join(h.home, 'elsewhere'));
    chmodFor(path.join(h.home, '.cc-sessions'), 0o300);
    const a = clear();
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('could not list');
  });

  it('a refusal OUTRANKS an unmeasured row, whatever order the registry lists them in', () => {
    const clone = path.join(leaf(), 'clone');
    fs.mkdirSync(clone, { recursive: true });
    row(OTHER, clone);
    row('demo3-a', 'relative/path');
    row('demo3-z', 'relative/path');
    expect(clear().rc).toBe('1');
  });

  it('an id no witness is named for is never asked: 2', () => {
    const [rc = ''] = h.sh('_ws_collect_rows_clear .x /y; echo "$?"').split('\n');
    expect(rc).toBe('2');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-collect-rows.test.ts`

Expected: `Tests  15 failed (15)`. Each case throws `Error: Command failed: bash -c source … _ws_collect_rows_clear demo-quiet-mesa '…'` (`command not found`, then `_WS_COLLECT_ROWS_WHY: unbound variable`).

- [ ] **Step 3: Implement**

In `ccd/ccd`, directly ABOVE `# ── end temp-root collection ─────────────────────────────────────────────────── COLLECT-END ──` (after 4C's functions), insert one blank line and then exactly this:

```bash
_WS_COLLECT_ROWS_WHY=''
_ws_collect_rows_clear() {   # id leaf -> 0 when no registry row lies at, inside or through leaf; 1 when one does, or
  #                              id's own row stands (_WS_COLLECT_ROWS_WHY names which); 2 when that could not be asked
  #                              (_WS_COLLECT_ROWS_WHY)
  # A REGISTRY ROW AT, INSIDE OR THROUGH THE LEAF IS ANOTHER SESSION'S TREE
  # (spec §5.5, §5.6). The removal helper does not ask it, so the collector asks
  # it itself — measured: without it, a stopped session's clone inside a dead
  # child's temp root is deleted with the leaf. It is `_ws_reclaim_workdir_shared`'s
  # own question, ONE registry pass, asked with the leaf AS the workdir: every
  # row, standing or placed by either of its gone-row arms, compared literally
  # and resolved — equal, inside, or spelled through it. That helper skips the
  # id's own row; this asks it first, by its `.workdir` alone: a temp root whose
  # id has a row is never collected. It also compares the id's clips leaf, as
  # it does for a reclaim: a row there refuses too, and a clips leaf whose
  # absence cannot be proven answers 2 — both fail closed. Its git reads of
  # other rows' repositories run contained, so a caller asks this only under
  # `_ws_reclaim_contained`. Asked on the pre-move spelling, before the move
  # and after it.
  local id="${1-}" leaf="${2-}" rc
  _WS_COLLECT_ROWS_WHY=''
  _ws_tmproot_id_ok "$id" || { _WS_COLLECT_ROWS_WHY="'$id' is not an id a witness is named for"; return 2; }
  if [[ -e "$REG/$id.workdir" || -L "$REG/$id.workdir" ]]; then
    _WS_COLLECT_ROWS_WHY="$id's own registry row stands ($REG/$id.workdir) — a temp root whose id has a row is never collected"
    return 1
  fi
  _ws_reclaim_workdir_shared "$id" "$leaf"; rc=$?
  if (( rc == 0 )); then
    [[ -n "$_WS_SHARED_ROWS$_WS_NESTED_ROWS$_WS_THROUGH_ROWS" ]] || return 0
    _WS_COLLECT_ROWS_WHY="registry row(s) lie at, inside or through $leaf — at: ${_WS_SHARED_ROWS:-none}; inside: ${_WS_NESTED_ROWS:-none}; through: ${_WS_THROUGH_ROWS:-none}"
    return 1
  fi
  _WS_COLLECT_ROWS_WHY="${_WS_SHARED_WHY:-the registry could not be compared with $leaf}"
  return 2
}
```

- [ ] **Step 4: Run to pass, then the neighbour**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-collect-rows.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-leaf-rows.test.ts
```

Expected: 15 passed. `ccd-child-reclaim-leaf-rows` (wave 6's rows at, inside or through a leaf) stays green; `_ws_reclaim_workdir_shared` is not edited.

- [ ] **Step 5: Mutation check**

Command: `cd server && ./node_modules/.bin/vitest run test/ccd-collect-rows.test.ts`.

| # | Mutation (exact edit) | Reds | Expected failure |
|---|---|---|---|
| D1 | In `_ws_collect_rows_clear`'s rc-0 arm, replace `    [[ -n "$_WS_SHARED_ROWS$_WS_NESTED_ROWS$_WS_THROUGH_ROWS" ]] \|\| return 0` with `    return 0` | all six refusal cases, the MEASURED stopped-clone case first | `expected '0' to be '1'` |
| D2 | Delete the own-row arm (`  if [[ -e "$REG/$id.workdir" \|\| -L "$REG/$id.workdir" ]]; then` … `  fi`) | "the id's OWN row refuses" | `expected '0' to be '1'` |
| D3 | Replace the last two lines (`  _WS_COLLECT_ROWS_WHY="${_WS_SHARED_WHY:-…}"` and `  return 2`) with `  return 0` | the three unmeasured cases (gone row nothing places, relative workdir, unlistable registry) | `expected '0' to be '2'` |
| D4 | Replace `$_WS_SHARED_ROWS$_WS_NESTED_ROWS$_WS_THROUGH_ROWS` with `$_WS_SHARED_ROWS$_WS_NESTED_ROWS` | "a row spelled THROUGH the leaf" | `expected '0' to be '1'` |
| D5 | Replace `$_WS_SHARED_ROWS$_WS_NESTED_ROWS$_WS_THROUGH_ROWS` with `$_WS_NESTED_ROWS$_WS_THROUGH_ROWS` | "a row AT the leaf" | `expected '0' to be '1'` |
| D6 | Replace `  _ws_reclaim_workdir_shared "$id" "$leaf"; rc=$?` with `  _ws_reclaim_workdir_shared "$id" "$HOME/.cc-clips/$id"; rc=$?` (the wrong leaf) | the AT, THROUGH and after-the-move cases | `expected '…' to contain 'at: demo2-calm-cove'`; `… to contain 'through: demo2-calm-cove'`; and an unmeasured `registry row(s) demo2-calm-cove name a workdir that cannot be resolved completely …` |

The stopped-clone case stays red-able by D1 alone, not by D6: `_ws_reclaim_workdir_shared`'s own `~/.cc-tmp/<id>` leaf arm compares every row against the temp root whatever the workdir. That is the double coverage this direct call buys.

- [ ] **Step 6: Re-stamp and commit**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd                  # ccd/ccd: ccrc-unmodified
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
git add ccd/ccd server/test/ccd-collect-rows.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): the collector's row rule — no registry row at, inside or through the leaf

_ws_collect_rows_clear asks _ws_reclaim_workdir_shared's own question,
one registry pass, with the leaf as the workdir: every row, standing or
placed by either gone-row arm, literally and resolved. A stopped
session's clone inside a dead child's temp root now refuses rather than
going with the leaf. The id's own row refuses first, since that helper
skips it; an unlistable registry or an unplaceable row is unmeasured;
a refusal outranks an unmeasured row.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

#### 4E — the checkout alias across the move

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-leaf-checkouts-alias.test.ts`:

```ts
// The checkout question ACROSS THE COLLECTOR'S MOVE (child reclamation wave 7,
// spec §5.6). The collector asks `_ws_leaf_checkouts` of the leaf at its own
// path, BEFORE it moves the leaf into a quarantine slot, and records every
// admin directory OUTSIDE the leaf that passed by back-link, with that back-link
// (`_WS_CHECKOUTS_ACCEPTED`). After the move the leaf's own linked worktrees
// still back-link to the PRE-MOVE spelling, so the removal of `<slot>/leaf`
// would refuse every one of them. The ALIAS — the pre-move physical spelling and
// the accepted list, passed by the collector alone — lets such a back-link count
// as the leaf's own ONLY when (1) the same admin directory with the same
// back-link value was accepted before the move, and (2) nothing stands at the
// pre-move spelling now, PROVEN. Each condition has its own MEASURED break:
// without (1), a foreign worktree moved into an orphan leaf passes once a
// recycled slug's `git worktree add` re-creates its pruned admin name at the
// pre-move spelling and its tree is later removed; without (2), the leaf's own
// worktree passes while a recycled slug's live worktree holds its admin name.
// Every other caller passes no alias and is answered exactly as before.
//
// FIXTURE HOMES ONLY (`makePrHarness`): every repository, leaf and slot is under
// the harness's HOME. The slot lives under `$HOME/q`, outside `~/.cc-tmp`, so
// the pre-move spelling's parent can be made unsearchable on its own.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
let restore: [string, number][] = [];
beforeEach(() => { h = makePrHarness('ccrc-leaf-alias-'); restore = []; });
afterEach(() => {
  for (const [p, m] of restore.reverse()) { try { fs.chmodSync(p, m); } catch { /* gone */ } }
  h.cleanup();
});
const chmodFor = (p: string, mode: number): void => {
  restore.push([p, fs.statSync(p).mode & 0o7777]);
  fs.chmodSync(p, mode);
};

const ID = 'demo-quiet-mesa';
const ROOT_USER = process.getuid?.() === 0;
const root = (): string => path.join(h.home, '.cc-tmp');
const L = (): string => path.join(root(), ID);                     // the leaf's pre-move spelling
const slot = (): string => path.join(h.home, 'q', `slot.${ID}.1.2`);
const moved = (): string => path.join(slot(), 'leaf');            // the leaf in its slot

interface Answer { rc: string; why: string; accepted: string }
const ask = (leaf: string, alias?: { path: string; accepted: string }, pre = ''): Answer => {
  const args = alias ? ` '${alias.path}' '${alias.accepted}'` : '';
  const [rc = '', why = '', accepted = ''] = h.sh(`${pre} _ws_leaf_checkouts '${leaf}'${args}; rc=$?;`
    + ' printf \'%s\\x1f%s\\x1f%s\' "$rc" "$_WS_CHECKOUTS_WHY" "$_WS_CHECKOUTS_ACCEPTED"').split('\x1f');
  return { rc, why, accepted };
};
const remove = (args: string): { rc: string; why: string } => {
  const [rc = '', why = ''] = h.sh(`_ws_leaf_remove ${args}; rc=$?; printf '%s\\x1f%s' "$rc" "$_WS_LEAF_WHY"`).split('\x1f');
  return { rc, why };
};
const enc = (s: string): string => h.sh(`_ws_collect_enc '${s}'`);
const devino = (p: string): string => { const st = fs.lstatSync(p); return `${st.dev}:${st.ino}`; };

/** The repository OUTSIDE the leaf whose worktrees these cases make. */
const repo = (): string => (fs.existsSync(path.join(h.home, 'projects', 'demo2'))
  ? path.join(h.home, 'projects', 'demo2') : h.makeRepo('demo2'));
const adminOf = (wt: string): string => fs.realpathSync(h.git(wt, 'rev-parse', '--absolute-git-dir'));
/** The leaf's OWN worktree at L/<name>: its admin directory is outside the leaf, and back-links here. */
const ownWorktree = (name = 'wt'): { admin: string; backlink: string } => {
  fs.mkdirSync(L(), { recursive: true });
  const wt = path.join(L(), name);
  h.git(repo(), 'worktree', 'add', '-q', '-b', `scratch-${name}`, wt);
  const admin = adminOf(wt);
  return { admin, backlink: fs.readFileSync(path.join(admin, 'gitdir'), 'utf8').trim() };
};
/** The collector's move: the leaf to `<slot>/leaf`, the slot made first. */
const moveToSlot = (): void => {
  fs.mkdirSync(slot(), { recursive: true, mode: 0o700 });
  fs.renameSync(L(), moved());
};
/** A recycled slug's child: a NEW leaf at the pre-move spelling, and `git worktree add` there. */
const recycledAdd = (name: string): void => {
  fs.mkdirSync(L(), { recursive: true });
  h.git(repo(), 'worktree', 'add', '-q', '-b', `recycled-${name}`, path.join(L(), name));
};

describe('the pre-move ask records what it let pass by back-link', () => {
  it('the leaf’s own linked worktree: rc 0, and its admin directory and back-link are recorded, spelled', () => {
    const { admin, backlink } = ownWorktree();
    const a = ask(L());
    expect(a.rc, a.why).toBe('0');
    expect(backlink, 'the CONTROL: git back-links the physical spelling').toBe(`${path.join(fs.realpathSync(root()), ID, 'wt')}/.git`);
    expect(a.accepted).toBe(`${enc(admin)}=${enc(backlink)}`);
  }, 60_000);

  it('a clone, and nothing at all, record nothing — and a second ask in the same shell starts from nothing', () => {
    ownWorktree();
    const other = path.join(h.home, 'other-leaf');
    fs.mkdirSync(path.join(other, 'clone', '.git'), { recursive: true });
    const [first = '', second = ''] = h.sh(`_ws_leaf_checkouts '${L()}'; a="$_WS_CHECKOUTS_ACCEPTED";`
      + ` _ws_leaf_checkouts '${other}'; printf '%s\\x1f%s' "$a" "$_WS_CHECKOUTS_ACCEPTED"`).split('\x1f');
    expect(first, 'the CONTROL: the first ask recorded the leaf’s own worktree').not.toBe('');
    expect(second).toBe('');
  }, 60_000);
});

describe('after the move: the alias lets the leaf’s OWN worktree go, and only it', () => {
  it('CONTROL — no alias (every other caller): the moved leaf’s own worktree refuses, as today', () => {
    ownWorktree();
    moveToSlot();
    const a = ask(moved());
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('a checkout git records elsewhere');
  }, 60_000);

  it('with the alias: accepted before the move, nothing at the pre-move spelling now — the leaf’s own: 0', () => {
    ownWorktree();
    const pre = ask(L());
    expect(pre.rc, pre.why).toBe('0');
    const alias = path.join(fs.realpathSync(root()), ID);
    moveToSlot();
    const a = ask(moved(), { path: alias, accepted: pre.accepted });
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it('_ws_leaf_remove hands the alias through: the slot’s leaf is removed and proven gone', () => {
    ownWorktree();
    const pre = ask(L());
    const alias = path.join(fs.realpathSync(root()), ID);
    moveToSlot();
    const r = remove(`'${slot()}' leaf '${devino(moved())}' '${alias}' '${pre.accepted}'`);
    expect(r.rc, r.why).toBe('0');
    expect(fs.existsSync(moved())).toBe(false);
  }, 60_000);

  it('_ws_leaf_remove WITHOUT the alias — two arguments, or three — refuses exactly as before, nothing removed', () => {
    ownWorktree();
    moveToSlot();
    expect(remove(`'${slot()}' leaf`).rc).toBe('1');
    expect(remove(`'${slot()}' leaf '${devino(moved())}'`).rc).toBe('1');
    expect(fs.existsSync(path.join(moved(), 'wt', '.git'))).toBe(true);
  }, 60_000);
});

describe('condition (1): only what the PRE-MOVE ask accepted — the measured moved-tree, recycled-admin break', () => {
  /** Another session's worktree, with uncommitted work, moved into the orphan leaf at L/still-harbor. */
  const foreignInLeaf = (): { admin: string } => {
    const xorig = path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
    fs.mkdirSync(path.dirname(xorig), { recursive: true });
    h.git(repo(), 'worktree', 'add', '-q', '-b', 'ws/still-harbor', xorig);
    fs.writeFileSync(path.join(xorig, 'precious.txt'), 'uncommitted work of another session\n');
    const admin = adminOf(xorig);
    fs.mkdirSync(L(), { recursive: true });
    fs.renameSync(xorig, path.join(L(), 'still-harbor'));
    return { admin };
  };
  /** The break, step by step: the pre-move ask refuses the foreign tree (nothing is accepted); the
   *  leaf moves; `git worktree prune` drops its admin name; a recycled slug's child re-creates that
   *  name AT the pre-move spelling; and that child's own temp root is later removed, leaving the
   *  re-created admin directory back-linking to a spelling where nothing stands. */
  const theBreak = (): { admin: string; alias: string; accepted: string } => {
    const { admin } = foreignInLeaf();
    const pre = ask(L());
    expect(pre.rc, 'the CONTROL: the pre-move ask refuses the foreign tree').toBe('1');
    const alias = path.join(fs.realpathSync(root()), ID);
    moveToSlot();
    h.git(repo(), 'worktree', 'prune');
    expect(fs.existsSync(admin), 'the CONTROL: prune took the moved tree’s admin name').toBe(false);
    recycledAdd('still-harbor');
    expect(fs.readFileSync(path.join(admin, 'gitdir'), 'utf8').trim(), 'the CONTROL: the same admin name, back-linking the pre-move spelling')
      .toBe(`${alias}/still-harbor/.git`);
    fs.rmSync(L(), { recursive: true, force: true });
    return { admin, alias, accepted: pre.accepted };
  };

  it('nothing accepted before the move: the foreign tree refuses — rc 1 — and its uncommitted work stands', () => {
    const { alias, accepted } = theBreak();
    expect(accepted).toBe('');
    const a = ask(moved(), { path: alias, accepted });
    expect(a.rc, a.why).toBe('1');
    const r = remove(`'${slot()}' leaf '${devino(moved())}' '${alias}' '${accepted}'`);
    expect(r.rc, r.why).toBe('1');
    expect(fs.readFileSync(path.join(moved(), 'still-harbor', 'precious.txt'), 'utf8')).toContain('uncommitted');
  }, 60_000);

  it('the same admin directory accepted with ANOTHER back-link value refuses: the value is half of (1)', () => {
    const { admin, alias } = theBreak();
    const accepted = `${enc(admin)}=${enc(path.join(h.home, 'worktrees', 'demo2', 'still-harbor', '.git'))}`;
    const a = ask(moved(), { path: alias, accepted });
    expect(a.rc, a.why).toBe('1');
  }, 60_000);
});

describe('condition (2): nothing stands at the pre-move spelling — the measured own-worktree, recycled-admin break', () => {
  it('a recycled slug’s LIVE worktree holds the admin name, with the very back-link accepted before: rc 1', () => {
    const { admin, backlink } = ownWorktree();
    const pre = ask(L());
    expect(pre.accepted, 'the CONTROL: accepted before the move').toBe(`${enc(admin)}=${enc(backlink)}`);
    const alias = path.join(fs.realpathSync(root()), ID);
    moveToSlot();
    h.git(repo(), 'worktree', 'prune');
    recycledAdd('wt');
    expect(fs.readFileSync(path.join(admin, 'gitdir'), 'utf8').trim(), 'the CONTROL: the same admin, the same back-link value')
      .toBe(backlink);
    const a = ask(moved(), { path: alias, accepted: pre.accepted });
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('where something stands again');
  }, 60_000);

  it.skipIf(ROOT_USER)('the pre-move spelling under a parent that cannot be searched is unmeasured: 2', () => {
    ownWorktree();
    const pre = ask(L());
    const alias = path.join(fs.realpathSync(root()), ID);
    moveToSlot();
    chmodFor(root(), 0o600);
    const a = ask(moved(), { path: alias, accepted: pre.accepted });
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('was never asked');
  }, 60_000);
});

describe('the alias itself is checked before it is believed', () => {
  it.each([
    ['a relative pre-move spelling', 'tmp/x', ''],
    ['an accepted list ccd never writes', '/abs/x', 'a b'],
  ])('%s is unmeasured: 2', (_label, aliasPath, accepted) => {
    fs.mkdirSync(path.join(L(), 'clone', '.git'), { recursive: true });
    expect(ask(L(), { path: aliasPath, accepted }).rc).toBe('2');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-leaf-checkouts-alias.test.ts`

Expected: `Tests  11 failed | 1 passed (12)`.
- Each of the eleven throws `Error: Command failed: bash -c source … _ws_leaf_checkouts '…'` on `_WS_CHECKOUTS_ACCEPTED: unbound variable`. ccd runs under `set -u`, and every case that asks before it removes prints that global.
- The one green case is the control "_ws_leaf_remove WITHOUT the alias … refuses exactly as before", which is green before and after by design.

- [ ] **Step 3: Implement**

In `ccd/ccd`, make these edits (RECLAIM region):

(a) Replace the two lines

```bash
_WS_CHECKOUTS_WHY=''
_ws_leaf_checkout_one() {   # leaf-physical .git-entry -> 0 the leaf's own; 1 refused; 2 unmeasured (_WS_CHECKOUTS_WHY)
```

with

```bash
_WS_CHECKOUTS_WHY=''
_WS_CHECKOUTS_ACCEPTED=''   # `_ws_leaf_checkouts`' rc 0: every OUTSIDE admin directory a back-link let pass, with that back-link
_ws_leaf_checkout_accepted() {   # admin back-link -> appends `<admin>=<back-link>`, each `_ws_collect_enc`'s spelling, to _WS_CHECKOUTS_ACCEPTED
  _WS_CHECKOUTS_ACCEPTED+="${_WS_CHECKOUTS_ACCEPTED:+,}$(_ws_collect_enc "$1")=$(_ws_collect_enc "$2")"
}
_ws_leaf_checkout_one() {   # leaf-physical .git-entry [alias accepted] -> 0 the leaf's own; 1 refused; 2 unmeasured (_WS_CHECKOUTS_WHY)
```

and in that function replace its `local` line

```bash
  local lp="$1" f="$2" d="${2%/.git}" buf gd rest adp rec rc
```

with

```bash
  local lp="$1" f="$2" d="${2%/.git}" alias="${3-}" accepted="${4-}" buf gd rest adp rec rc pre
```

(a2) In `_ws_leaf_checkout_one`'s OUTSIDE IT comment (`grep -n 'OUTSIDE IT: only a linked worktree whose admin directory' ccd/ccd`), replace its last two lines

```bash
  # of any repository. Anything else is a tree git records elsewhere: moved
  # here, or an admin name a later worktree recycled.
```

with these three, so the sentence Task 9's `_ws_leaf_read_small` pointer defers to also names the alias:

```bash
  # of any repository — or, under the collector's alias, the pre-move spelling
  # the two conditions below admit. Anything else is a tree git records
  # elsewhere: moved here, or an admin name a later worktree recycled.
```

(b) In `_ws_leaf_checkout_one`, replace its last six lines (from `  [[ "$rec" != "$f" ]] || return 0` to its closing `}`)

```bash
  [[ "$rec" != "$f" ]] || return 0
  _ws_dir_physical "$d" \
    || { _WS_CHECKOUTS_WHY="$d cannot be resolved ($_WS_PHYS_WHY), so whether $adp records it was never asked"; return 2; }
  [[ "$rec" != "${_WS_PHYS%/}/.git" ]] || return 0
  _WS_CHECKOUTS_WHY="$f names $adp as its git directory, which git records as $rec's — the tree at $d is a checkout git records elsewhere, not the leaf's own"
  return 1
}
```

with

```bash
  [[ "$rec" != "$f" ]] || { _ws_leaf_checkout_accepted "$adp" "$rec"; return 0; }
  _ws_dir_physical "$d" \
    || { _WS_CHECKOUTS_WHY="$d cannot be resolved ($_WS_PHYS_WHY), so whether $adp records it was never asked"; return 2; }
  [[ "$rec" != "${_WS_PHYS%/}/.git" ]] || { _ws_leaf_checkout_accepted "$adp" "$rec"; return 0; }
  # THE COLLECTOR'S ALIAS (spec §5.6): a leaf asked again after the collector
  # moved it into a quarantine slot. Its trees' back-links still name the leaf's
  # PRE-MOVE spelling (`alias`, the leaf's physical path before the move), and
  # such a back-link counts as the leaf's own ONLY when (1) the pre-move ask
  # accepted this same admin directory with this same back-link value
  # (`accepted`, the quarantine record's list), and (2) nothing stands at that
  # pre-move spelling now, PROVEN. A later worktree that recycled the admin
  # name — a recycled slug's `git worktree add` at the same spelling — fails one
  # or the other and refuses, as it does with no alias.
  if [[ -n "$alias" ]]; then
    if [[ "$d" == "$lp" ]]; then pre="${alias%/}"; else pre="${alias%/}/${d#"${lp%/}/"}"; fi
    if [[ "$rec" == "$pre/.git" ]] \
       && [[ ",$accepted," == *",$(_ws_collect_enc "$adp")=$(_ws_collect_enc "$rec"),"* ]]; then
      _ws_reclaim_absent "$pre"; rc=$?
      (( rc != 0 )) || return 0
      (( rc != 2 )) || { _WS_CHECKOUTS_WHY="$_WS_ABSENT_WHY — whether anything stands again at $pre, where the tree at $d stood before it was moved, was never asked"; return 2; }
      _WS_CHECKOUTS_WHY="$f names $adp as its git directory, which git records as $rec's — the spelling the tree at $d had before it was moved, where something stands again — not the leaf's own"
      return 1
    fi
  fi
  _WS_CHECKOUTS_WHY="$f names $adp as its git directory, which git records as $rec's — the tree at $d is a checkout git records elsewhere, not the leaf's own"
  return 1
}
```

(c) In `_ws_leaf_checkouts`, make three edits.
- Replace its two-line signature comment with:

```bash
_ws_leaf_checkouts() {   # leaf [alias accepted] -> 0 when no checkout in it is one git records elsewhere; 1 refused;
  #                         2 unmeasured (each with _WS_CHECKOUTS_WHY naming the checkout, or why it was never asked);
  #                         on 0, _WS_CHECKOUTS_ACCEPTED lists every outside admin directory a back-link let pass
```

- Replace the three lines

```bash
  local lp outf errf err rc f why='' n=0
  local -a gits=()
  _WS_CHECKOUTS_WHY=''
```

with

```bash
  # THE ALIAS (the collector's alone, spec §5.6): `alias` is the leaf's physical
  # path BEFORE the collector moved it, and `accepted` the record's list of what
  # that pre-move ask let pass (`_WS_CHECKOUTS_ACCEPTED`'s spelling). With them,
  # a back-link naming the pre-move spelling is the leaf's own under the two
  # conditions `_ws_leaf_checkout_one` states. Every other caller passes
  # neither, and nothing it is answered changes.
  local lp outf errf err rc f why='' n=0 alias="${2-}" accepted="${3-}"
  local -a gits=()
  _WS_CHECKOUTS_WHY=''; _WS_CHECKOUTS_ACCEPTED=''
  if [[ -n "$alias" ]]; then
    [[ "$alias" == /* && "$alias" != *$'\n'* ]] \
      || { _WS_CHECKOUTS_WHY="the leaf's pre-move spelling '$alias' is not an absolute path, so no back-link is compared with it"; return 2; }
    _ws_collect_pairs_ok "$accepted" \
      || { _WS_CHECKOUTS_WHY="the accepted checkouts handed with $alias are not a list ccd writes"; return 2; }
  fi
```

- Replace `    _ws_leaf_checkout_one "$lp" "$f"; rc=$?` with `    _ws_leaf_checkout_one "$lp" "$f" "$alias" "$accepted"; rc=$?`.

(d) In `_ws_leaf_remove`, make three edits.
- Replace the signature line `_ws_leaf_remove() {   # root id [expect-devino] -> 0 removed, or absent — PROVEN by `_ws_reclaim_absent`;` with `_ws_leaf_remove() {   # root id [expect-devino [alias accepted]] -> 0 removed, or absent — PROVEN by `_ws_reclaim_absent`;`.
- Replace its `local` line `  local root="$1" id="$2" want="${3-}" rroot leaf me owner lreal have ldev rdev err rc` with these six lines:

```bash
  # - THE COLLECTOR'S ALIAS (spec §5.6): `alias` and `accepted`, passed by the
  #   collector alone, with the witness's dev:ino, for a leaf in a quarantine
  #   slot (`<slot>/leaf`), and handed to the checkout question unchanged
  #   (`_ws_leaf_checkouts` says what they admit). Every other caller passes
  #   neither, and is answered exactly as before.
  local root="$1" id="$2" want="${3-}" alias="${4-}" accepted="${5-}" rroot leaf me owner lreal have ldev rdev err rc
```

- Replace `    _ws_leaf_checkouts "$leaf"; rc=$?` with:

```bash
    if [[ -n "$alias" ]]; then _ws_leaf_checkouts "$leaf" "$alias" "$accepted"; rc=$?
    else _ws_leaf_checkouts "$leaf"; rc=$?; fi
```

- [ ] **Step 4: Run to pass, then every caller of the helper**

Each line is its own FOREGROUND call, timeout ≥ 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-leaf-checkouts-alias.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-leaf-checkouts.test.ts test/ccd-leaf-remove.test.ts test/ccd-leaf-root-newline.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-tmproot-witness.test.ts test/ccd-child-tmproot-witness-drop.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-leaf-moved.test.ts test/ccd-child-reclaim-leaf-moved-resume.test.ts test/ccd-child-reclaim-leaf-moved-expire.test.ts test/ccd-child-reclaim-leaf-rows.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-tail.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-done-kept.test.ts test/ccd-child-reclaim-tmproot-wait.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts
```

Expected: the alias file has 12 passed, and every other suite is green UNCHANGED. Measured on the export: 174 cases across the five leaf and witness files, 31 across the four leaf-moved and leaf-rows files, 110 across the tail, done-kept and tmproot-wait files, and 32 in ws-expire's verb. The tail, `ws-expire`'s tail and `_ws_tmproot_remove` call `_ws_leaf_remove` with two or three arguments, so they reach no alias.

- [ ] **Step 5: Mutation check**

Command: `cd server && ./node_modules/.bin/vitest run test/ccd-leaf-checkouts-alias.test.ts`.

| # | Mutation (exact edit) | Reds | Expected failure |
|---|---|---|---|
| E1 | Condition (1) dropped. Replace `    if [[ "$rec" == "$pre/.git" ]] \` and the `       && [[ ",$accepted," == … ]]; then` line under it with `    if [[ "$rec" == "$pre/.git" ]]; then` | "nothing accepted before the move: the foreign tree refuses …"; "the same admin directory accepted with ANOTHER back-link value refuses" | `expected '0' to be '1'` (both). The first case's `_ws_leaf_remove` would then delete `precious.txt`: the measured break |
| E2 | Condition (2) dropped. Replace `      _ws_reclaim_absent "$pre"; rc=$?` and `      (( rc != 0 )) \|\| return 0` with `      return 0` | "a recycled slug's LIVE worktree holds the admin name …: rc 1"; "the pre-move spelling under a parent that cannot be searched is unmeasured: 2" | `expected '0' to be '1'`; `expected '0' to be '2'` |
| E3 | Condition (1) halved. Replace `*",$(_ws_collect_enc "$adp")=$(_ws_collect_enc "$rec"),"*` with `*",$(_ws_collect_enc "$adp")="*` (the admin only) | "the same admin directory accepted with ANOTHER back-link value refuses" | `expected '0' to be '1'` |
| E4 | Disarm the alias arm: replace its first `  if [[ -n "$alias" ]]; then` (in `_ws_leaf_checkout_one`) with `  if false; then` | "with the alias: … the leaf's own: 0"; "_ws_leaf_remove hands the alias through" | `expected '1' to be '0'` (`… is a checkout git records elsewhere …`) |
| E5 | In `_ws_leaf_remove`, replace its two-line `if [[ -n "$alias" ]]; then _ws_leaf_checkouts …` / `else …; fi` with `    _ws_leaf_checkouts "$leaf"; rc=$?` | "_ws_leaf_remove hands the alias through" | `expected '1' to be '0'` |
| E6 | Replace `  [[ "$rec" != "$f" ]] \|\| { _ws_leaf_checkout_accepted "$adp" "$rec"; return 0; }` with `  [[ "$rec" != "$f" ]] \|\| return 0` | "the leaf's own linked worktree: rc 0, and its admin directory and back-link are recorded" | `expected '' to be '<enc admin>=<enc back-link>'` |
| E7 | In `_ws_leaf_checkouts`, delete the two-line `[[ "$alias" == /* && … ]] \|\| { … return 2; }` | "a relative pre-move spelling is unmeasured: 2" | `expected '0' to be '2'` |
| E8 | In the alias arm, delete `      (( rc != 2 )) \|\| { _WS_CHECKOUTS_WHY="$_WS_ABSENT_WHY — whether anything stands again at $pre, …"; return 2; }` | "the pre-move spelling under a parent that cannot be searched is unmeasured: 2" | `expected '1' to be '2'` (unmeasured read as a refusal) |
| E9 | In the alias arm, replace `      _ws_reclaim_absent "$pre"; rc=$?` with `      _ws_reclaim_absent "$pre/nothing-here"; rc=$?` (ask the wrong path) | "a recycled slug's LIVE worktree …: rc 1" | `expected '0' to be '1'` |
| E10 | Replace `  _WS_CHECKOUTS_WHY=''; _WS_CHECKOUTS_ACCEPTED=''` with `  _WS_CHECKOUTS_WHY=''` (no reset per ask) | "a clone, and nothing at all, record nothing — and a second ask in the same shell starts from nothing" | `expected '<enc admin>=<enc back-link>' to be ''` |

- [ ] **Step 6: Re-stamp and commit**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd                  # ccd/ccd: ccrc-unmodified
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
git add ccd/ccd server/test/ccd-leaf-checkouts-alias.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): the checkout question across the collector's move

_ws_leaf_checkouts records every outside admin directory a back-link let
pass, with its back-link, and _ws_leaf_checkouts and _ws_leaf_remove
take an additive alias: the leaf's physical pre-move spelling and that
recorded list. Under it, a back-link naming the pre-move spelling counts
as the leaf's own only when the same admin directory with the same
back-link value was accepted before the move, and nothing stands at the
pre-move spelling now, proven. A recycled admin name fails one or the
other and refuses, as it does with no alias; every other caller passes
no alias and is answered exactly as before.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

- [ ] **Step 7: The whole task, once more**

Each line is its own FOREGROUND call:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-collect-record.test.ts test/ccd-collect-quarantine.test.ts test/ccd-collect-idle-token.test.ts test/ccd-collect-rows.test.ts test/ccd-leaf-checkouts-alias.test.ts test/macos-platform.test.ts
cd server && ./node_modules/.bin/vitest run test/ws-collect-act.test.ts test/lifecycle-acts.test.ts test/lifecycle-vocabulary.test.ts test/ccd-lifecycle-emit.test.ts test/measure-workspace-lifecycle.test.ts test/dead-coordinator-policy.test.ts test/git-env-strip.test.ts
cd pwa && ./node_modules/.bin/vitest run test/journal-words.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-wsaudit-nonpoison.test.ts test/ccd-refusal-scan.test.ts test/ccd-reg-get-census.test.ts test/wsaudit.test.ts test/child-reclaim.test.ts test/single-definition.test.ts test/ccd-bounded-reads.test.ts test/ccd-lifecycle-contain.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'citation'
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts   # needs pwa/ and agent/ modules installed; see below
node shared/mark.mjs --check ccd/ccd && (cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
```

An isolated worktree installs server modules only. If `typecheck-tests` cannot resolve `typescript` under `pwa/`, typecheck the server tests directly. This must print nothing:

```bash
cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit 2>&1 | grep -E 'test/(ccd-collect-|ccd-leaf-checkouts-alias|macos-platform|ccd-workspaces|ws-collect-act|git-env-strip|lifecycle-acts|lifecycle-vocabulary|ccd-lifecycle-emit)'
```

Without agent modules, the agent's own `ws` errors appear in that output and are not this task's.

Expected: all green. The measured figures from the export:
- the five new files and `macos-platform`: 238 passed, 11 skipped at drafting (G5 takes 4A to 52 cases and G4 takes 4C to 26, so the sum holds; re-measure);
- the act part's line and `git-env-strip`: green;
- `ccd-workspaces`: 81;
- the session-hook citation cases: 13, so the frozen corpus is untouched;
- the new test files typecheck clean under `test/tsconfig.tests.json`.

`git diff -U0 main -- ccd/ccd | grep '^@@'` lists, besides the stamp line `ccrc restamp` rewrites, ONE hunk above ccd/ccd:19109 — 4-act's `_LC_ACTS` first line, one line for one — and otherwise only hunks below it, the first at the `_ws_dir_physical` header, about +510 lines in all. `grep -c 'COLLECT-BEGIN\|COLLECT-END' ccd/ccd` prints `2`: no other marker may contain either substring, because every slicer uses `indexOf`.

---

### Task 5: `ccd ws-audit --session <id> --collect` — the collector's audit

**Model routing:** **`opus`, effort `high`**. This is SAFETY-critical ccd code. The audit decides the population (which names the collector ever locks), and it mints the token `ws-collect` spends. Task 6's verb runs this task's evaluation again inside its own lock. Wave 7's SAFETY lens reads this diff beside Task 6's.

**Why:** Contract §14 R66 and R68 rule the collector's audit:
- It rides the existing granted `['ws-audit','--session']` prefix, so it needs no new grant.
- It audits only the POPULATION: an id with a witness `$REG/tmproots/<id>`, or with a quarantine record `$REG/tmpquarantine/<id>.<ns>.<pid>` found by exact parse. It takes `.reap-<id>.lock` for nothing else.
- Inside that lock it asks, in a fixed order, each of these words:
  - `registered`;
  - `witness-mismatch` (TERMINAL);
  - `not-idle`;
  - `in-use`;
  - `containment-unproven` (TERMINAL);
  - `paused`.
- Any probe that cannot answer is `unmeasured`: exit 1, the probe named, journaled nowhere.
- A standing quarantine record makes the audit a RESUME, whatever the witness now says. The record is the resume's authority (R66), and a resume never walks the tree or asks the floor (R67).
- Only a TERMINAL refusal is journaled, act `collect`, verb `ws-audit`, as ws-expire's audit journals.

The whole evaluation is ONE function, `_ws_collect_fork`, so the token printed is one `ws-collect` can accept. This is the expiry's `_ws_expire_fork` precedent: Task 6 calls the same function inside its lock and compares `--expect` against it (R67 step 1).

**Needs, in the tree before Step 2 (Step 1 measures each):**
- Task 4's building blocks:
  - `_ws_collect_idle`;
  - `_ws_collect_token`;
  - `_ws_collect_rows_clear`;
  - `_ws_collect_records_of`;
  - `_ws_collect_record_read`;
  - `_ws_collect_mv_ok`, the `--no-copy` capability probe;
  - `_ws_collect_ident`, `_ws_collect_floor_s` and `_ws_collect_floor_held`, consumed and NEVER redefined here (ruling G4; the identity contract);
  - the COLLECT region's two markers, `COLLECT-BEGIN ──` and `COLLECT-END ──`.
- Task 1's `containment-refuted`. It is the base the `ALL_TOKENS` count rises from.
- **The `collect` lifecycle act**, declared by Task 4's first part (ruling G1): `_LC_ACTS`, `LifecycleAct` and `LIFECYCLE_ACT_MAP`, `ACT_WORD`, and the instrument's class. This task is the act's FIRST emitter. An undeclared act journals as `act: unknown` with `badact: collect` (measured), and this task's journal cases would red on it. Step 1 (a2) must print 1; if it does not, STOP.

**Files:**
- Modify `ccd/ccd`. Make two edits; the line numbers are hints at `b0647d850`:
  1. **The hand-off**, in `cmd_ws_audit`, at ccd/ccd:12815, :12816 and :12818. Find them with `grep -n 'ws-audit --session <id> \[--reclaim' ccd/ccd` and `grep -n '"WS-AUDIT --EXPIRE", EXPIRE region' ccd/ccd`. These lines sit ABOVE the frozen 19109 boundary, so the edit rides the three existing lines and adds none. That is the `ws-expire` precedent (commit `77c11245a` put its hand-off on this same `if` line).
  2. **The audit block**, inside the COLLECT region Task 4 opened, below 19109. Insert it directly below Task 4's building blocks and above the region's end marker. It is self-delimited by its own `WS-AUDIT-COLLECT ──` and `WS-AUDIT-COLLECT-CLOSE ──` lines, which this task's source pins slice by. Its end marker must never contain the substring `COLLECT-END` (nor `COLLECT-BEGIN`): every slicer finds Task 4's region end by `indexOf('COLLECT-END')`, so a nested `…-COLLECT-END` would end the region at this block and leave Task 6's verb outside it.
- Modify `shared/api.ts`. `LcRefusalToken` and `LC_REFUSAL_WORD` each gain `witness-mismatch` and `quarantine-kept`.
- Modify `README.md`, only if Step 6 reds on it. Its `shared/api.ts:` anchors are re-pointed BY CONTENT.
- Modify these existing tests, each at one named line:
  - `server/test/lifecycle-refusal-word.test.ts`: `ALL_TOKENS` and its count;
  - `server/test/ccd-child-reclaim-pause.test.ts`: the reader list at :232;
  - `server/test/ccd-die-containment.test.ts`: the fatal list at :366, and its comment above it at :350;
  - `server/test/ccd-ws-expire-audit.test.ts`:126 and `server/test/ccd-child-reclaim-audit.test.ts`:217: the usage string;
  - `server/test/ccd-wsaudit-nonpoison.test.ts`: `withoutReclaim`'s cut list gains the COLLECT region, with one found-check (ruling G2);
  - `server/test/ccd-refusal-scan.test.ts`: one COLLECT-region case, the audit's three `verb ws-audit` emits (ruling G2).
- Create `server/test/collectFixture.ts`. It is this task's alone: Task 6 creates `server/test/wsCollectFixture.ts` and Task 8 `server/test/collectRaceFixture.ts`, and the three are never merged (their exports collide by name with different signatures).
- Test, three new files:
  - `server/test/ccd-collect-audit.test.ts`;
  - `server/test/ccd-collect-audit-rungs.test.ts`;
  - `server/test/ccd-collect-audit-resume.test.ts`.

**Interfaces:**
- Consumes, at `b0647d850` (each grep finds it):
  - `cmd_ws_audit` (ccd/ccd:12798, `grep -n '^cmd_ws_audit()' ccd/ccd`). Its `if (( $# >= 3 ))` hand-off line is ccd/ccd:12816.
  - `_ws_tmproot_id_ok <id>` (ccd/ccd:20812), `_ws_tmproot_witness_file <id>` (:20808), and `_ws_tmproot_witness_read <id>` (:20814). The reader answers 0 and sets `_WS_WIT_DEV _WS_WIT_INO _WS_WIT_BTIME _WS_WIT_RUN _WS_WIT_UID _WS_WIT_AT`, 1 for absent, and 2 for unreadable or malformed, which includes a `tmproots/` that is a link. Locate each with `grep -n '^_ws_tmproot_witness_read()' ccd/ccd`.
  - `_child_tmpdir <id>` (ccd/ccd:20733), in the tests only, which make the real witness.
  - `_ws_slug_free <project> <slug>` (ccd/ccd:6526) and `_ws_slug_residue <project> <slug>` (:6562). The slug check keys on `"$1-$2"`, so any id holding a `-` splits as `"${id%-*}" "${id##*-}"`.
  - `_ws_reclaim_absent <path>` (ccd/ccd:26646): 0 proven absent, 1 something stands, 2 `_WS_ABSENT_WHY`.
  - `_ws_dir_physical <dir>` (ccd/ccd:28802): 0 with `_WS_PHYS`, 1 with `_WS_PHYS_WHY`.
  - `_ws_path_users <path>` (ccd/ccd:28842): 0 nobody, 1 in use (`_WS_PATH_USERS_PIDS`, `_WS_PATH_USERS_WHY`), 2 unmeasured.
  - `_ws_leaf_checkouts <leaf> [<alias> <accepted>]` (ccd/ccd:29213): 0, 1 or 2, with `_WS_CHECKOUTS_WHY`. Task 4's two alias arguments (ruling G8) are NOT passed here.
  - `_ws_leaf_why_line <text>` (ccd/ccd:29473): the 300-byte printable-ASCII cutter.
  - `_ws_reclaim_fingerprint key=value…` (ccd/ccd:25782) and `_ws_reclaim_contained cmd…` (ccd/ccd:27346).
  - `_plat_devino` (ccd/ccd:265) and `_plat_btime` (:264), only to word a refusal's detail (the identity check itself is Task 4's `_ws_collect_ident`).
  - `_lc_emit` (ccd/ccd:4944), `_json_str` (:4254) and `die` (:1644).
  - From Task 4:
    - `_ws_collect_records_of <id>`: matching record PATHS, one per line, by exact parse; rc 0, or rc 2 when `tmpquarantine/` cannot be listed;
    - `_ws_collect_record_read <file>`: 0, setting `_WS_QREC_ID _WS_QREC_SLOT _WS_QREC_DEV _WS_QREC_INO _WS_QREC_BTIME _WS_QREC_RUN _WS_QREC_AT _WS_QREC_TOKEN _WS_QREC_CHECKOUTS`; 1 absent; 2 malformed, including a body whose `id=` is not the id its name parses to. The body carries no `slot=` (ruling G5): `_WS_QREC_SLOT` is DERIVED from the record's file name and the physical quarantine directory, `<physical ~/.cc-tmp>/.ccd-quarantine/slot.<name>`; `_WS_QREC_CHECKOUTS` stays encoded;
    - `_ws_collect_idle <leaf>`: 0 with `_WS_IDLE_NEWEST_NS`, `_WS_IDLE_COUNT` and `_WS_IDLE_LEAF` (the leaf walked), or 2 with `_WS_IDLE_WHY` ∈ {timeout, unreadable, cap, walk-failed} and `_WS_IDLE_DETAIL`. Any stub of it (the fixture's `walkAt`, `walkUnmeasured`, `NO_WALK`, and the inline stubs) sets all five;
    - `_ws_collect_token <id>`, which binds the `_WS_WIT_*` and `_WS_IDLE_*` this evaluation just read, and answers rc 2 with nothing printed unless `_WS_IDLE_LEAF` ends `/<id>`;
    - `_ws_collect_rows_clear <id> <leafpath>`: 0, 1 or 2, with `_WS_COLLECT_ROWS_WHY`;
    - `_ws_collect_mv_ok`, the `mv --no-copy` capability probe: 0 present, 1 absent (no why global; this task words its own detail);
    - `_ws_collect_ident <path> <dev:ino> <btime>`: 0 a real directory (lstat, never followed) with exactly that device, inode and whole-second birth time; 1 anything else, or nothing; 2 could not be read. It is the ONE identity check, which `_ws_collect_move` proves a move with, so this task never defines a second one;
    - `_ws_collect_floor_s`, which prints max(86400, `WS_COLLECT_IDLE_FLOOR_S`) and is the ONE definition of the floor, and `_ws_collect_floor_held <newest-ns>`: 0 held, 1 not yet, 2 the clock or the input unreadable (it reads `_ws_collect_now_ns`). Ruling G4.
  - Test side:
    - `makePrHarness` and `PrHarness.run` (`server/test/ccdPrHelpers.ts`), which is `makeCcdHarness` (`server/test/ccdWsHelpers.ts`) plus `run`;
    - `readJournal`, `eventsOf` and `refusalsOf` (`server/test/lifecycleHelpers.ts`);
    - `holdCwd` (`server/test/wsExpireFixture.ts:87`);
    - `CCD` (`server/test/ccdWsHelpers.ts`).
- Produces, all of them in the `WS-AUDIT-COLLECT` block. Task 6 consumes the fork and its globals:
  ```bash
  _ws_collect_audit <id>                       # `ccd ws-audit --session <id> --collect`, whole; one JSON document; exit 1 on unmeasured, else 0
  _ws_collect_fork <id>                        # THE one evaluation (audit and verb). CALLER HOLDS $REG/.reap-<id>.lock. Reads only.
  _ws_collect_eval <id>                        # the fresh rungs (called by the fork)
  _ws_collect_resume_eval <id> <record>...     # the resume (called by the fork when a record of <id> stands)
  _ws_collect_registered <id>                  # 0 free | 1 registered | 2 unmeasured; _WS_COLLECT_REG_WHY. CALLER HOLDS the lock.
  _ws_collect_paused                           # 0 | 1 with REAP_VERDICT=paused
  _ws_collect_refuse <word> <detail>           # rc 1; sets REAP_VERDICT/REAP_DETAIL (never the harvested refusal helper)
  _ws_collect_unmeasured <probe> <detail>      # rc 1; REAP_VERDICT=unmeasured, _WS_COLLECT_PROBE=<probe>
  _ws_collect_reset                            # clears every answer below
  ```
  - **The fork's answer:**
    - `REAP_VERDICT` is one of `collectable`, `registered`, `not-witnessed`, `witness-mismatch`, `not-idle`, `in-use`, `containment-unproven`, `paused`, `quarantine-kept` or `unmeasured`.
    - `REAP_DETAIL` carries the reason. `REAP_TOKEN` is 64 lowercase hex, and is set on `collectable` only.
    - `_WS_COLLECT_PROBE` is set on unmeasured only, to one of `registry`, `records`, `leaf`, `identity`, `idle:<why>`, `clock`, `in-use`, `checkouts`, `rows`, `quarantine`, `slot`, `token` or `eval`. The audit adds five more before the fork runs: `platform`, `witness`, `mv`, `flock` and `lock`.
    - `_WS_COLLECT_PHASE` is `''` on the fresh path, or `unmoved`, `moved` or `removed`.
    - `_WS_COLLECT_LEAF` is `''`, `present` or `absent`, on the fresh path.
    - `_WS_COLLECT_RECORDS` is an array of record paths. `_WS_COLLECT_RECORD` and `_WS_COLLECT_SLOT` name the record resumed and its slot.
    - `_WS_COLLECT_NEWEST_NS`, `_WS_COLLECT_ENTRIES` and `_WS_COLLECT_IDLE_AT` are set once the walk answered.
    - `_WS_WIT_*` holds the witness as read.
  - **Three token shapes:**
    - a fresh present leaf takes `_ws_collect_token <id>` (Task 4);
    - a fresh witness whose leaf is PROVEN absent, with no record, takes `_ws_reclaim_fingerprint mode=collect-absent id= dev= ino= btime= run= at=`. The verb then compare-and-drops the witness, and nothing else;
    - a resume takes `_ws_reclaim_fingerprint mode=collect-resume id= record=<name> phase= slot= dev= ino= btime= run= at= pre=<the record's token>`. The witness is NOT an input.
  - **The document:**
    ```text
    {"session":…,"mode":"collect","exists":<bool>,"collect":{"leaf":…,"witness":{dev,ino,btime,run,at}|null,
     "records":[names],"newestCtimeNs":"<ns as a STRING>"|null,"entries":<n>|null,"floorS":<n>,"idleAt":<epoch s>|null,
     "unmeasured":"<probe>"|null},["resume":"<phase>",]"verdict":…,"detail":…[,"token":…]}
    ```
    - `exists` is whether the id's leaf is a real directory.
    - `newestCtimeNs` is a string, because ns are past 2^53.
  - **The journal:** `_lc_emit collect refused "$id" "" verb ws-audit refusal <word>` for exactly `witness-mismatch`, `quarantine-kept` and `containment-unproven`. Its `detail` is cut by `_ws_leaf_why_line`.
  - **L0:** `LcRefusalToken` and `LC_REFUSAL_WORD` gain `'witness-mismatch'` and `'quarantine-kept'`.
  - **Declared later, in Task 6's commit:** `not-witnessed`, `registered` and `not-idle`, with the verb's literal journal sites (see the departure `retryable-collect-words-declared-with-the-verb`).

**Ruled detail this task carries, beyond the task text (each named in the wave-done by slug):**
- `collect-audit-lock-held-answers-in-progress`. The fixed vocabulary names no word for "another ccd process holds the reap lock", the one fact the audit's own `flock -n` can meet. The audit answers ws-reap's and ws-expire's existing `SENTENCES` word `in-progress` ("Another cleanup of this workspace is already running."). It is retryable, exit 0 and unjournaled. `reap-in-progress` and `reclaim-in-progress` are not reachable from this audit: a breadcrumb is a registry file, so `registered` answers first.
- `retryable-collect-words-declared-with-the-verb`. `ccd-refusal-scan.test.ts` holds every `LcRefusalToken` set-equal, in both directions, to a LITERAL journal call site. The audit journals only its terminal words (R66), so `not-witnessed`, `registered` and `not-idle` have no literal site in this commit. This task prints them on stdout only. Task 6 declares them (`LcRefusalToken`, `LC_REFUSAL_WORD`, `ALL_TOKENS` and the count) in the commit that journals them at the verb's literal sites.
- `witness-without-leaf-collectable-at-the-audit`. R66 ("no orphaned slot") and R50 as amended let the collector drop a witness whose leaf is proven absent, when no record names the id. The audit answers that state `collectable` with the `mode=collect-absent` token, so the verb has a consent to spend.
- `collect-act-declared-before-its-first-emitter`. Realised by ruling G1: the `collect` act is declared in Task 4's first part, so it is in the tree before this task (see **Needs**).

**Applied from the coordinator's rulings of 2026-10-08 (each named in the wave-done):**
- **G4.** The floor is Task 4's `_ws_collect_floor_s`, judged by Task 4's `_ws_collect_floor_held`. This task defines neither, and a clock it cannot read is unmeasured `clock`.
- **One identity check.** Task 4's `_ws_collect_ident <path> <dev:ino> <btime>` is the only one. A second definition later in the file would replace Task 4's and defeat `_ws_collect_move`'s proof, so this task defines none.
- **G5.** The record carries no `slot=`. The resume reads the slot Task 4's reader derives, so a record can no longer name another slot.
- **T8 OPEN4, as ruled under Task 6.** A record whose leaf stands in its slot while anything stands at the original path is `quarantine-kept`: TERMINAL, journaled, and answered on every audit. It is asked BEFORE the registry, because a retake usually brings a `.child`, whose retryable `registered` would otherwise hide it. It is read off the disk, so it clears once the original path is free again.
- **G2.** This commit is the first to spell words in the COLLECT region, so it teaches `ccd-wsaudit-nonpoison.test.ts` and `ccd-refusal-scan.test.ts` that region.
- **G9.** Step 6b measures the audit's worst case against the inherited 90 s `ws-audit` row, and states it. No runner row changes.

- [ ] **Step 1: Entry check**

Run these from the workspace root. Each prints what its comment states; if one does not, STOP and report it.

```bash
for f in _ws_collect_idle _ws_collect_token _ws_collect_rows_clear _ws_collect_records_of _ws_collect_record_read _ws_collect_mv_ok \
    _ws_collect_ident _ws_collect_floor_s _ws_collect_floor_held _ws_collect_now_ns; do
  printf '%s %s\n' "$f" "$(grep -c "^$f() *{" ccd/ccd)"; done                                  # (a1) every count is 1 (Task 4)
awk '/^_LC_ACTS=\(/,/\)/' ccd/ccd | grep -cw collect                                          # (a2) 1: Task 4's first part declared the act (ruling G1); 0 -> STOP
grep -c 'COLLECT-BEGIN ──\|COLLECT-END ──' ccd/ccd                                              # (a6) 2: Task 4's region markers, and no other line spells them
grep -c "'containment-refuted'" shared/api.ts                                                   # (a3) 2 or more: Task 1 landed
grep -c '_ws_collect_audit\|WS-AUDIT-COLLECT\|--collect' ccd/ccd                                # (a4) 0
grep -n '"WS-AUDIT --EXPIRE", EXPIRE region' ccd/ccd                                            # (a5) one line, < 19109: the hand-off line this task extends in place
```

- [ ] **Step 2: Write the failing tests**

Create `server/test/collectFixture.ts`:

```ts
// The ORPHANED, WITNESSED temp root every `ws-audit --collect` suite builds on (the temp-root collector, spec
// §5.10): a child's leaf handed out by the REAL `_child_tmpdir`, so its witness `$REG/tmproots/<id>` is the line ccd
// writes, then the child's registry row removed by hand — the leaf and its witness stay, which is what an orphan
// is. And the quarantine record a crashed `ws-collect` leaves, written in the record's one-line grammar.
//
// FIXTURE HOME ONLY (`makePrHarness`, which is `makeCcdHarness` plus `run`): every path below derives from `h.home`.
// Nothing here runs a verb that removes anything.
//
// THESE SUITES NEVER LOWER THE IDLE FLOOR. A real leaf's newest ctime is "now", and nothing unprivileged sets a ctime
// back, so a case that needs a leaf past the floor stubs the WALK's answer (`walkAt`: a shell function the snippet
// defines; the walk itself is held by its own suite) and leaves the floor to Task 4's `_ws_collect_floor_held` against
// the real clock. The production knob `WS_COLLECT_IDLE_FLOOR_S` only ever RAISES the floor; the one test-only seam that
// lowers it is redefining `_ws_collect_floor_s` in a sourced harness (ruling G4), which these suites do not need.
// A stub of the walk sets ALL FIVE of its globals: Task 4's token refuses unless `_WS_IDLE_LEAF` ends `/<id>`.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { PrHarness } from './ccdPrHelpers.js';

export const COL_ID = 'demo-quiet-mesa';
/** The run `_child_tmpdir` reads off the marker and writes into the witness. */
export const COL_RUN = '7';
/** A record's name is `<id>.<ns>.<pid>`; these are its two trailing all-digit fields. */
export const REC_NS = '1790000000000000000';
export const REC_PID = '4242';
export const recName = (id: string = COL_ID): string => `${id}.${REC_NS}.${REC_PID}`;

export const regDir = (h: PrHarness): string => path.join(h.home, '.cc-sessions');
export const leafOf = (h: PrHarness, id: string = COL_ID): string => path.join(h.home, '.cc-tmp', id);
export const witnessOf = (h: PrHarness, id: string = COL_ID): string => path.join(regDir(h), 'tmproots', id);
export const lockOf = (h: PrHarness, id: string = COL_ID): string => path.join(regDir(h), `.reap-${id}.lock`);
export const recordsDir = (h: PrHarness): string => path.join(regDir(h), 'tmpquarantine');
/** Q, `<physical ~/.cc-tmp>/.ccd-quarantine` (spec §5.10). `~/.cc-tmp` must exist. */
export const quarantineOf = (h: PrHarness): string =>
  path.join(fs.realpathSync(path.join(h.home, '.cc-tmp')), '.ccd-quarantine');

/** Epoch nanoseconds `s` seconds before now (a negative `s` is in the future). */
export const secondsAgoNs = (s: number): bigint =>
  (BigInt(Math.floor(Date.now() / 1000)) - BigInt(s)) * 1_000_000_000n;
/** The walk's answer, fixed: the newest ctime under the leaf is `newestNs`, over `count` entries. */
export const walkAt = (newestNs: bigint, count = 3): string =>
  `_ws_collect_idle() { _WS_IDLE_NEWEST_NS=${newestNs}; _WS_IDLE_COUNT=${count}; _WS_IDLE_WHY=''; _WS_IDLE_DETAIL='';`
  + ' _WS_IDLE_LEAF="$1"; return 0; };';
/** Two days idle: past the 24 h floor, and fixed for the whole file, so two audits mint one token. */
export const AGED_NS = secondsAgoNs(2 * 86_400);
export const AGED = walkAt(AGED_NS);
/** The walk could not answer, for `why`. */
export const walkUnmeasured = (why: string): string =>
  `_ws_collect_idle() { _WS_IDLE_NEWEST_NS=''; _WS_IDLE_COUNT=''; _WS_IDLE_WHY=${why};`
  + ` _WS_IDLE_DETAIL='stub: the walk did not answer (${why})'; _WS_IDLE_LEAF=''; return 2; };`;
/** A walk that must never run: it leaves `$HOME/walked` behind (an exit-0 answer carries no stderr), and answers
 *  unmeasured. */
export const NO_WALK = '_ws_collect_idle() { : > "$HOME/walked"; _WS_IDLE_NEWEST_NS=\'\'; _WS_IDLE_COUNT=\'\';'
  + ' _WS_IDLE_WHY=walk-failed; _WS_IDLE_DETAIL=\'stub: this walk must never run\'; _WS_IDLE_LEAF=\'\'; return 2; };';
export const walked = (h: PrHarness): boolean => fs.existsSync(path.join(h.home, 'walked'));
/** A box whose mv has no --no-copy: the collector's capability probe, answered no. */
export const NO_MV = '_ws_collect_mv_ok() { return 1; };';
/** Another holder of the id's reap lock: an open file description of this shell, flocked. The audit's own open of
 *  the same file is a second description, which `flock -n` cannot take. */
export const holdLock = (id: string = COL_ID): string => `exec 9>>"$REG/.reap-${id}.lock"; flock -n 9 || exit 99;`;
export const PAUSE = 'touch "$REG/reclaim-paused";';

export interface Identity { dev: string; ino: string; btime: string }
/** The identity of `p` ITSELF, by NODE's lstat — never by ccd — in the witness's spelling. */
export function identityOf(p: string): Identity {
  const st = fs.lstatSync(p, { bigint: true });
  const bt = st.birthtimeNs / 1_000_000_000n;
  return { dev: String(st.dev), ino: String(st.ino), btime: bt > 0n ? String(bt) : '-' };
}

/** A dead child's temp root: the REAL spawn path writes the leaf and its witness, two entries go inside, and the
 *  child's dot-free registry fields are removed. The leaf and the witness outlive the row. */
export function makeOrphan(h: PrHarness, id: string = COL_ID): { leaf: string } {
  h.sh(`_reg_set ${id} child ${COL_RUN} && _child_tmpdir ${id} >/dev/null`);
  const leaf = leafOf(h, id);
  fs.mkdirSync(path.join(leaf, 'cdk.out'));
  fs.writeFileSync(path.join(leaf, 'cdk.out', 'manifest.json'), '{}');
  for (const f of fs.readdirSync(regDir(h))) {
    const rest = f.startsWith(`${id}.`) ? f.slice(id.length + 1) : null;
    if (rest !== null && rest !== '' && !rest.includes('.')) fs.rmSync(path.join(regDir(h), f));
  }
  return { leaf };
}

/** ANOTHER directory at the id: the old leaf is renamed aside (kept, so its inode cannot be handed straight back to
 *  the new one — a removed inode is reused at once on ext4), and a fresh directory is made in its place. */
export function replaceLeaf(h: PrHarness, id: string = COL_ID): string {
  const leaf = leafOf(h, id);
  fs.renameSync(leaf, path.join(h.home, `old-${id}`));
  fs.mkdirSync(leaf, { mode: 0o700 });
  return leaf;
}

export interface RecordFields {
  id: string; dev: string; ino: string; btime: string; run: string; at: string; token: string; checkouts: string;
}
/** The record's one line, in its writer's field order (spec §5.10). It carries NO path (ruling G5): the slot is derived
 *  from the record's file name and the physical quarantine directory, so a space in a path never splits a record. */
export const recordLine = (r: RecordFields): string =>
  `v=1 id=${r.id} dev=${r.dev} ino=${r.ino} btime=${r.btime} run=${r.run} at=${r.at}`
  + ` token=${r.token} checkouts=${r.checkouts}\n`;
/** A record of `id` naming `ident`. Its slot is the one its file name gives, `<Q>/slot.<name>`, by derivation. */
export function recordFor(ident: Identity, id: string = COL_ID): RecordFields {
  return { id, ...ident, run: COL_RUN, at: '1790000000000', token: 'a'.repeat(64), checkouts: '' };
}
export function plantRecord(h: PrHarness, name: string, body: string): string {
  fs.mkdirSync(recordsDir(h), { recursive: true, mode: 0o700 });
  const p = path.join(recordsDir(h), name);
  fs.writeFileSync(p, body, { mode: 0o600 });
  return p;
}
/** What `ws-collect`'s move leaves: Q and the slot made 0700, and the leaf RENAMED to `<slot>/leaf` (same inode). */
export function moveIntoSlot(h: PrHarness, id: string = COL_ID, name: string = recName(id)): string {
  const q = quarantineOf(h);
  fs.mkdirSync(q, { recursive: true, mode: 0o700 });
  const slot = path.join(q, `slot.${name}`);
  fs.mkdirSync(slot, { mode: 0o700 });
  fs.renameSync(leafOf(h, id), path.join(slot, 'leaf'));
  return slot;
}

export interface Answer { code: number; stdout: string; stderr: string; doc: Record<string, unknown> | null }
/** `ccd ws-audit --session <id> --collect` through the sourced `cmd_ws_audit`, answering instead of throwing. */
export function collectAudit(h: PrHarness, opts: { id?: string; pre?: string } = {}): Answer {
  const r = h.run(`${opts.pre ?? ''} cmd_ws_audit --session ${opts.id ?? COL_ID} --collect`);
  let doc: Record<string, unknown> | null = null;
  try { doc = JSON.parse(r.stdout) as Record<string, unknown>; } catch { doc = null; }
  return { ...r, doc };
}
export const collectOf = (a: Answer): Record<string, unknown> =>
  (a.doc?.['collect'] ?? {}) as Record<string, unknown>;
export const verdictOf = (a: Answer): string => String(a.doc?.['verdict']);

/** `_ws_collect_fork`'s own answer, with the reap lock held as its callers hold it, read off the globals it sets. */
export function collectForkOf(h: PrHarness, opts: { id?: string; pre?: string } = {}):
{ verdict: string; token: string; detail: string; phase: string } {
  const id = opts.id ?? COL_ID;
  const out = h.sh(`${opts.pre ?? ''} exec {l}>>"$REG/.reap-${id}.lock"; flock -n "$l" || exit 99;`
    + ` _t() { _ws_collect_fork ${id} >/dev/null;`
    + ` printf '%s\\x1f%s\\x1f%s\\x1f%s' "$REAP_VERDICT" "$REAP_TOKEN" "$REAP_DETAIL" "$_WS_COLLECT_PHASE"; };`
    + ' _ws_reclaim_contained _t');
  const [verdict = '', token = '', detail = '', phase = ''] = out.split('\x1f');
  return { verdict, token, detail, phase };
}

/** A process of this uid, NOT in the leaf, whose environment's TMPDIR is `dir`: the shape that re-created a leaf
 *  3.7 s after a reclaim (spec §5.6). Its environment is built, never a spread of process.env. ALWAYS `stop()` it in
 *  a `finally`. */
export function holdTmpdir(dir: string): { pid: number; stop: () => void } {
  const p: ChildProcess = spawn('sleep', ['60'], {
    cwd: '/', stdio: 'ignore', env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', TMPDIR: dir },
  });
  if (p.pid === undefined) throw new Error(`could not start a process with TMPDIR=${dir}`);
  return { pid: p.pid, stop: () => { p.kill('SIGKILL'); } };
}
```

Create `server/test/ccd-collect-audit.test.ts`:

```ts
// `ws-audit --session <id> --collect`: the temp-root collector's audit (spec §5.10), read as the server's lane will
// read it — ONE JSON document on stdout, exit 1 only when a probe could not answer. The fresh rungs are held one by
// one in `ccd-collect-audit-rungs.test.ts`, the resume of a standing quarantine record in
// `ccd-collect-audit-resume.test.ts`. This file holds the document, the token, the population rule, the lock, the
// exits, the journal, the hand-off, the two declared words and the source pins.
// FIXTURE HOME ONLY (`collectFixture.ts`). Linux only where the collector measures: on Darwin it answers unmeasured
// before it reads anything, which the platform case pins on every platform.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { eventsOf, readJournal, refusalsOf } from './lifecycleHelpers.js';
import { holdCwd } from './wsExpireFixture.js';
import { LC_REFUSAL_WORD, isLcRefusalToken } from '../../shared/api.js';
import {
  AGED, AGED_NS, COL_ID, NO_MV, PAUSE, collectAudit, collectForkOf, collectOf, holdLock, identityOf, leafOf, lockOf,
  makeOrphan, plantRecord, recName, recordFor, recordLine, regDir, replaceLeaf, verdictOf, walkAt, walkUnmeasured,
  witnessOf,
} from './collectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-audit-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';

describe.skipIf(!LINUX)('ws-audit --collect: the document and the token', () => {
  it('a witnessed orphan past the idle floor is collectable: the document, in order, and the fork’s own token', () => {
    const { leaf } = makeOrphan(h);
    const a = collectAudit(h, { pre: AGED });
    expect(a.code, a.stderr).toBe(0);
    expect(Object.keys(a.doc!)).toEqual(['session', 'mode', 'exists', 'collect', 'verdict', 'detail', 'token']);
    expect(a.doc).toMatchObject({ session: COL_ID, mode: 'collect', exists: true, verdict: 'collectable', detail: '' });
    const c = collectOf(a);
    expect(Object.keys(c)).toEqual(['leaf', 'witness', 'records', 'newestCtimeNs', 'entries', 'floorS', 'idleAt', 'unmeasured']);
    expect(c).toMatchObject({
      leaf, records: [], newestCtimeNs: String(AGED_NS), entries: 3, floorS: 86_400, unmeasured: null,
      idleAt: Number(AGED_NS / 1_000_000_000n) + 86_400,
    });
    const id = identityOf(leaf);
    expect(c['witness']).toMatchObject({ dev: id.dev, ino: id.ino, btime: id.btime, run: '7' });
    expect(a.doc!['token']).toMatch(/^[0-9a-f]{64}$/);
    expect(a.doc!['token'], 'the audit prints what the one shared evaluation mints')
      .toBe(collectForkOf(h, { pre: AGED }).token);
  }, 60_000);

  it('the token moves with each fact it binds: the newest change, the entry count, the witness', () => {
    makeOrphan(h);
    const t0 = collectForkOf(h, { pre: walkAt(AGED_NS, 3) }).token;
    expect(t0).toMatch(/^[0-9a-f]{64}$/);
    expect(collectForkOf(h, { pre: walkAt(AGED_NS + 1n, 3) }).token, 'the newest change').not.toBe(t0);
    expect(collectForkOf(h, { pre: walkAt(AGED_NS, 4) }).token, 'the entry count').not.toBe(t0);
    // A later run is handed the same leaf: the witness is rewritten (its run and at move), the leaf is not.
    h.sh(`_reg_set ${COL_ID} child 8 && _child_tmpdir ${COL_ID} >/dev/null && rm -f "$REG/${COL_ID}.child"`);
    expect(collectForkOf(h, { pre: walkAt(AGED_NS, 3) }).token, 'the witness').not.toBe(t0);
  }, 90_000);

  it('it reads, and writes nothing it judges: the lock it held is the one file it adds', () => {
    const { leaf } = makeOrphan(h);
    const snap = (): Record<string, unknown> => ({
      leaf: (fs.readdirSync(leaf, { recursive: true }) as string[]).map(String).sort(),
      mtime: fs.statSync(leaf).mtimeMs,
      witness: fs.readFileSync(witnessOf(h), 'utf8'),
      tmp: fs.readdirSync(path.dirname(leaf)).sort(),
    });
    const regBefore = fs.readdirSync(regDir(h)).sort();
    const before = snap();
    expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('collectable');
    expect(snap()).toEqual(before);
    expect(fs.readdirSync(regDir(h)).sort(), 'the one file the audit adds is the lock it held')
      .toEqual([...regBefore, `.reap-${COL_ID}.lock`].sort());
    expect(readJournal(h.home), 'a collectable answer is journaled nowhere').toEqual([]);
  }, 60_000);
});

describe.skipIf(!LINUX)('the population: a witness or a record of the id, and a foreign name is never locked', () => {
  it('no witness and no record: not-witnessed, exit 0, no lock file, nothing journaled', () => {
    const a = collectAudit(h, { id: 'demo-foreign-name' });
    expect(a.code, a.stderr).toBe(0);
    expect(a.doc).toMatchObject({ verdict: 'not-witnessed', exists: false });
    expect(a.doc!['token']).toBeUndefined();
    expect(fs.existsSync(lockOf(h, 'demo-foreign-name')), 'a name ccd never handed a temp root gets no lock').toBe(false);
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('the record lookup is EXACT: a nested id’s record never puts its parent in the population', () => {
    fs.mkdirSync(path.join(h.home, '.cc-tmp'), { recursive: true });
    const nested = `${COL_ID}.7`;
    plantRecord(h, recName(nested), recordLine(recordFor({ dev: '1', ino: '2', btime: '3' }, nested)));
    plantRecord(h, `${COL_ID}.123.abc`, 'not a record of anyone\n');
    const parent = collectAudit(h);
    expect(verdictOf(parent)).toBe('not-witnessed');
    expect(fs.existsSync(lockOf(h)), `${COL_ID} is not in the population`).toBe(false);
    const child = collectAudit(h, { id: nested });
    expect(child.code, child.stderr).toBe(0);
    expect(collectOf(child)['records']).toEqual([recName(nested)]);
    expect(verdictOf(child), 'a record alone is the population').toBe('collectable');
    expect(child.doc!['resume'], 'nothing stands at either place: the record only waits to be dropped').toBe('removed');
    expect(fs.existsSync(lockOf(h, nested))).toBe(true);
  }, 60_000);

  it('a witness behind a tmproots/ that is itself a link is never followed: unmeasured, exit 1, no lock', () => {
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, COL_ID), 'v=1 planted\n');
    fs.symlinkSync(elsewhere, path.join(regDir(h), 'tmproots'));
    const a = collectAudit(h);
    expect(a.code).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('witness');
    expect(fs.existsSync(lockOf(h))).toBe(false);
  }, 60_000);

  it('an id ccd never mints dies before anything is read: nothing on stdout, no lock', () => {
    for (const bad of ['.hidden', 'a/b', 'x y']) {
      const r = h.run(`cmd_ws_audit --session '${bad}' --collect`);
      expect(r.code, bad).toBe(1);
      expect(r.stdout, bad).toBe('');
      expect(r.stderr, bad).toContain('bad session id');
    }
    expect(fs.readdirSync(regDir(h)).filter((f) => f.startsWith('.reap-'))).toEqual([]);
  }, 60_000);
});

describe.skipIf(!LINUX)('the lock: another holder of the id’s reap lock', () => {
  it('answers in-progress, exit 0, no token, nothing journaled — and released, the same leaf is collectable', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} ${holdLock()}` });
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('in-progress');
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
    expect(verdictOf(collectAudit(h, { pre: AGED })), 'the CONTROL: released').toBe('collectable');
  }, 60_000);
});

describe.skipIf(!LINUX)('unmeasured: exit 1, the probe named, no token, journaled nowhere', () => {
  it.each(['timeout', 'unreadable', 'cap', 'walk-failed'])('the idle walk answers %s', (why) => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: walkUnmeasured(why) });
    expect(a.code).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe(`idle:${why}`);
    expect(a.doc!['token']).toBeUndefined();
    expect(a.stderr).toContain('ws-audit --collect measured nothing');
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('a walk that answers a word it does not have, or no number, reads walk-failed', () => {
    makeOrphan(h);
    for (const pre of [
      '_ws_collect_idle() { _WS_IDLE_NEWEST_NS=; _WS_IDLE_COUNT=; _WS_IDLE_WHY=bogus; _WS_IDLE_DETAIL=x; _WS_IDLE_LEAF=; return 2; };',
      '_ws_collect_idle() { _WS_IDLE_NEWEST_NS=abc; _WS_IDLE_COUNT=3; _WS_IDLE_WHY=; _WS_IDLE_DETAIL=; _WS_IDLE_LEAF="$1"; return 0; };']) {
      const a = collectAudit(h, { pre });
      expect(a.code, pre).toBe(1);
      expect(collectOf(a)['unmeasured'], pre).toBe('idle:walk-failed');
    }
  }, 60_000);

  it('a box whose mv has no --no-copy: unmeasured `mv`', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} ${NO_MV}` });
    expect(a.code).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('mv');
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);
});

describe('on Darwin the collector measures nothing: unmeasured `platform`, exit 1, no lock', () => {
  it('answers before it reads the population', () => {
    const a = collectAudit(h, { pre: 'CCD_OS=darwin;' });
    expect(a.code).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('platform');
    expect(fs.existsSync(lockOf(h))).toBe(false);
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);
});

describe.skipIf(!LINUX)('the journal: a TERMINAL refusal, act collect, verb ws-audit, and nothing else', () => {
  it('witness-mismatch is journaled; not-idle, through the REAL walk, is not', () => {
    makeOrphan(h);
    expect(verdictOf(collectAudit(h)), 'a fresh leaf').toBe('not-idle');
    expect(readJournal(h.home), 'a retryable word is never journaled').toEqual([]);
    replaceLeaf(h);
    expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('witness-mismatch');
    expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'witness-mismatch' }]);
    expect(eventsOf(h.home, 'collect')[0]!['verb']).toBe('ws-audit');
  }, 60_000);

  it.each([
    ['registered', (): string => { fs.writeFileSync(path.join(regDir(h), `${COL_ID}.uuid`), 'u'); return AGED; }],
    ['in-use', (): string => AGED],
    ['paused', (): string => `${AGED} ${PAUSE}`],
    ['in-progress', (): string => `${AGED} ${holdLock()}`],
    ['unmeasured', (): string => walkUnmeasured('timeout')],
  ] as const)('%s is journaled nowhere', (word, arrange) => {
    const { leaf } = makeOrphan(h);
    const pre = arrange();
    const p = word === 'in-use' ? holdCwd(leaf) : null;
    try {
      expect(verdictOf(collectAudit(h, { pre }))).toBe(word);
    } finally { p?.stop(); }
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('the detail it journals is ONE line cut at 300 bytes; the document carries it whole', () => {
    makeOrphan(h);
    const why = `_ws_collect_rows_clear() { _WS_COLLECT_ROWS_WHY="$(printf 'x%.0s' {1..600})"$'\\n'second; return 1; };`;
    const a = collectAudit(h, { pre: `${AGED} ${why}` });
    expect(verdictOf(a)).toBe('containment-unproven');
    expect(String(a.doc!['detail']).length, 'the document is not cut').toBeGreaterThan(600);
    const detail = String(eventsOf(h.home, 'collect')[0]!['detail']);
    expect(detail).not.toContain('\n');
    expect(detail.length).toBeLessThanOrEqual(301);
    expect(detail.endsWith('…')).toBe(true);
  }, 60_000);
});

describe('the hand-off: `--collect` third and alone; the plain audit never takes it', () => {
  it('a fourth argument is a usage error that names --collect, with nothing on stdout', () => {
    const r = h.run(`cmd_ws_audit --session ${COL_ID} --collect --defer-expired`);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('usage: ccd ws-audit --session <id> [--reclaim [--defer-expired] | --expire | --collect]');
  }, 60_000);

  it('the plain audit carries no collect mode', () => {
    const r = h.run(`cmd_ws_audit --session ${COL_ID}`);
    expect(r.stdout).not.toContain('"mode":"collect"');
    expect(r.stdout).not.toContain('collectable');
  }, 60_000);
});

describe('the two TERMINAL words are declared, each with a sentence true under any server', () => {
  it.each(['witness-mismatch', 'quarantine-kept'] as const)('%s', (t) => {
    expect(isLcRefusalToken(t)).toBe(true);
    expect(LC_REFUSAL_WORD[t]).toMatch(/Nothing (further )?was removed/);
    expect(LC_REFUSAL_WORD[t]).toMatch(/on its own/);
    expect(LC_REFUSAL_WORD[t]).toMatch(/listed for you/);
  });
});

describe('the source: three terminal words journaled, and no line in a harvested shape', () => {
  const src = fs.readFileSync(CCD, 'utf8');
  const b = src.indexOf('WS-AUDIT-COLLECT ──');
  const e = src.indexOf('WS-AUDIT-COLLECT-CLOSE ──');
  const block = b > -1 && e > b ? src.slice(b, e) : '';

  it('found the block, and it holds the audit: an empty cut proves nothing', () => {
    expect(block.length).toBeGreaterThan(8000);
    expect(block).toContain('_ws_collect_audit_contained() {');
    expect(block).toContain('_ws_collect_fork() {');
  });

  it('journals exactly witness-mismatch, quarantine-kept and containment-unproven, under verb ws-audit', () => {
    const found = [...block.matchAll(/_lc_emit collect refused "\$id" "" verb ws-audit refusal ([a-z-]+)/g)]
      .map((m) => m[1]).sort();
    expect(found).toEqual(['containment-unproven', 'quarantine-kept', 'witness-mismatch']);
    expect([...block.matchAll(/_lc_emit /g)], 'no other journal line').toHaveLength(3);
  });

  it('spells no word in a shape the refusal harvests read (wsaudit.test.ts, ccd-wsaudit-nonpoison.test.ts)', () => {
    const shapes = [/_reap_refuse\s+[a-zA-Z]/, /"refused":"[a-zA-Z0-9-]+"/, /'![a-zA-Z0-9-]+/, /"verdict":"[a-zA-Z0-9-]+"/];
    expect(block.split('\n').filter((l) => shapes.some((s) => s.test(l)))).toEqual([]);
  });
});

// The leaf path the document names, as `_child_tmpdir` composes it, never resolved.
it.skipIf(!LINUX)('the document names the leaf as `_child_tmpdir` spells it', () => {
  makeOrphan(h);
  expect(collectOf(collectAudit(h))['leaf']).toBe(leafOf(h));
}, 60_000);
```

Create `server/test/ccd-collect-audit-rungs.test.ts`:

```ts
// `ws-audit --collect`'s FRESH rungs, one by one and in order (the temp-root collector, spec §5.10): registered,
// witness-mismatch, not-idle, in-use, containment-unproven, paused. The first that does not pass ends the
// evaluation, and a probe that cannot answer ends it as unmeasured, naming itself. A witness whose leaf is proven
// gone is its own answer. FIXTURE HOME ONLY (`collectFixture.ts`). Linux only: the collector measures nothing
// elsewhere, and the in-use cases run real processes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { readJournal, refusalsOf } from './lifecycleHelpers.js';
import { holdCwd } from './wsExpireFixture.js';
import {
  AGED, COL_ID, NO_WALK, PAUSE, type Answer, collectAudit, collectOf, holdTmpdir, leafOf, makeOrphan, regDir,
  replaceLeaf, secondsAgoNs, verdictOf, walkAt, walked, witnessOf,
} from './collectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-rungs-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';
const ROOT = process.getuid?.() === 0;

/** A worktree moved into the leaf: its `.git` file names an admin directory that is gone. */
const plantForeignCheckout = (leaf: string): void => {
  fs.mkdirSync(path.join(leaf, 'wt'));
  fs.writeFileSync(path.join(leaf, 'wt', '.git'), `gitdir: ${path.join(h.home, 'gone', '.git', 'worktrees', 'wt')}\n`);
};

describe.skipIf(!LINUX)('registered: a row of the id, by direct lookup, and by a listing the audit can trust', () => {
  it.each(['child', 'uuid', 'hold', 'reaping'])('a standing `%s` field: registered, exit 0, no token, nothing journaled', (field) => {
    makeOrphan(h);
    fs.writeFileSync(path.join(regDir(h), `${COL_ID}.${field}`), 'x');
    const a = collectAudit(h, { pre: AGED });
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('registered');
    expect(String(a.doc!['detail'])).toContain(`${COL_ID}.${field}`);
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it.skipIf(ROOT)('a registry that can be searched but not listed: a `.child` is still seen; any other row makes the slug UNMEASURED, never free', () => {
    makeOrphan(h);
    const reg = regDir(h);
    fs.writeFileSync(path.join(reg, `${COL_ID}.hold`), 'x');
    expect(verdictOf(collectAudit(h, { pre: AGED })), 'the CONTROL: listable, the row is seen').toBe('registered');
    fs.chmodSync(reg, 0o300);
    try {
      const a = collectAudit(h, { pre: AGED });
      expect(a.code, a.stderr).toBe(1);
      expect(verdictOf(a)).toBe('unmeasured');
      expect(collectOf(a)['unmeasured']).toBe('registry');
      fs.writeFileSync(path.join(reg, `${COL_ID}.child`), '8');
      expect(verdictOf(collectAudit(h, { pre: AGED })), 'a direct lookup needs no listing').toBe('registered');
    } finally { fs.chmodSync(reg, 0o755); }
  }, 90_000);

  it('registered outranks every later rung', () => {
    makeOrphan(h);
    fs.writeFileSync(path.join(regDir(h), `${COL_ID}.child`), '9');
    replaceLeaf(h);
    expect(verdictOf(collectAudit(h, { pre: PAUSE }))).toBe('registered');
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);
});

describe.skipIf(!LINUX)('witness-mismatch: TERMINAL, journaled, offered to the operator, never taken', () => {
  const expectMismatch = (a: Answer, detail: string): void => {
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('witness-mismatch');
    expect(String(a.doc!['detail'])).toContain(detail);
    expect(a.doc!['token']).toBeUndefined();
    expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'witness-mismatch' }]);
  };

  it('a witness ccd cannot read as it writes it', () => {
    makeOrphan(h);
    fs.writeFileSync(witnessOf(h), 'v=2 junk\n');
    expectMismatch(collectAudit(h, { pre: AGED }), 'cannot be read as ccd writes it');
  }, 60_000);

  it('a witness with no birth time is never taken on device and inode alone', () => {
    makeOrphan(h);
    fs.writeFileSync(witnessOf(h), fs.readFileSync(witnessOf(h), 'utf8').replace(/ btime=\d+ /, ' btime=- '));
    // The file system is made to keep no birth time either, so dev and ino WOULD match: only the rule refuses it.
    expectMismatch(collectAudit(h, { pre: `${AGED} _plat_btime() { echo 0; };` }), 'records no birth time');
  }, 60_000);

  it('a directory of another inode at the id', () => {
    makeOrphan(h);
    replaceLeaf(h);
    expectMismatch(collectAudit(h, { pre: AGED }), 'its witness names');
  }, 60_000);

  it('a link at the id, to the very directory its witness names: never followed, and nothing behind it is touched', () => {
    const { leaf } = makeOrphan(h);
    const moved = path.join(h.home, 'moved');
    fs.renameSync(leaf, moved);
    fs.symlinkSync(moved, leaf);
    expectMismatch(collectAudit(h, { pre: AGED }), 'is a link or not a directory');
    expect(fs.existsSync(path.join(moved, 'cdk.out', 'manifest.json'))).toBe(true);
  }, 60_000);

  it('a file at the id', () => {
    const { leaf } = makeOrphan(h);
    fs.rmSync(leaf, { recursive: true });
    fs.writeFileSync(leaf, 'a file where the leaf was');
    expectMismatch(collectAudit(h, { pre: AGED }), 'is a link or not a directory');
  }, 60_000);
});

describe.skipIf(!LINUX)('a witness whose leaf is PROVEN gone: collectable at once, so the verb can drop the witness', () => {
  it('exists false, no walk, a token of its own, and the witness still standing', () => {
    const { leaf } = makeOrphan(h);
    const present = collectAudit(h, { pre: AGED }).doc!['token'];
    fs.rmSync(leaf, { recursive: true });
    const a = collectAudit(h, { pre: NO_WALK });
    expect(a.code, a.stderr).toBe(0);
    expect(a.doc).toMatchObject({ exists: false, verdict: 'collectable' });
    expect(walked(h), 'nothing to walk').toBe(false);
    expect(collectOf(a)).toMatchObject({ newestCtimeNs: null, entries: null, idleAt: null });
    expect(a.doc!['token']).toMatch(/^[0-9a-f]{64}$/);
    expect(a.doc!['token']).not.toBe(present);
    expect(fs.existsSync(witnessOf(h)), 'an audit drops nothing').toBe(true);
  }, 60_000);

  it.skipIf(ROOT)('a leaf whose absence cannot be proven is unmeasured `leaf`, never gone', () => {
    const { leaf } = makeOrphan(h);
    const root = path.dirname(leaf);
    fs.chmodSync(root, 0o000);
    try {
      const a = collectAudit(h, { pre: AGED });
      expect(a.code, a.stderr).toBe(1);
      expect(collectOf(a)['unmeasured']).toBe('leaf');
    } finally { fs.chmodSync(root, 0o700); }
  }, 60_000);
});

describe.skipIf(!LINUX)('not-idle: the newest CTIME under the leaf, against max(24 h, the knob)', () => {
  it('a fresh leaf, through the REAL walk: not-idle, with the instant it turns collectable', () => {
    makeOrphan(h);
    const before = Math.floor(Date.now() / 1000);
    const a = collectAudit(h);
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('not-idle');
    const c = collectOf(a);
    expect(c['entries'], 'the leaf itself, cdk.out and its manifest').toBe(3);
    expect(Number(c['idleAt'])).toBeGreaterThanOrEqual(before + 86_400 - 5);
    expect(Number(c['idleAt'])).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000) + 86_400 + 1);
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('the boundary: five seconds short of the floor is not-idle, five seconds past it is collectable', () => {
    makeOrphan(h);
    expect(verdictOf(collectAudit(h, { pre: walkAt(secondsAgoNs(86_400 - 5)) }))).toBe('not-idle');
    expect(verdictOf(collectAudit(h, { pre: walkAt(secondsAgoNs(86_400 + 5)) }))).toBe('collectable');
  }, 60_000);

  it('the knob RAISES the floor', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `WS_COLLECT_IDLE_FLOOR_S=200000; ${AGED}` });
    expect(verdictOf(a)).toBe('not-idle');
    expect(collectOf(a)['floorS']).toBe(200_000);
  }, 60_000);

  it.each(['60', '0', '-5', 'abc', '1e9', ''])('the knob %j never LOWERS it', (k) => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `WS_COLLECT_IDLE_FLOOR_S='${k}'; ${walkAt(secondsAgoNs(3600))}` });
    expect(verdictOf(a)).toBe('not-idle');
    expect(collectOf(a)['floorS']).toBe(86_400);
  }, 60_000);

  it('a newest change in the FUTURE (a clock stepped back) is not-idle, never idle', () => {
    makeOrphan(h);
    expect(verdictOf(collectAudit(h, { pre: walkAt(secondsAgoNs(-3600)) }))).toBe('not-idle');
  }, 60_000);

  it('a clock that cannot be read is unmeasured `clock`, never idle (Task 4’s `_ws_collect_floor_held` answers 2)', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} _ws_collect_now_ns() { echo soon; };` });
    expect(a.code, a.stderr).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('clock');
    expect(a.doc!['token']).toBeUndefined();
  }, 60_000);

  it('mtime is never read: a leaf whose every mtime is years old is still not-idle (the REAL walk)', () => {
    const { leaf } = makeOrphan(h);
    const old = new Date('2020-01-01T00:00:00Z');
    for (const p of [path.join(leaf, 'cdk.out', 'manifest.json'), path.join(leaf, 'cdk.out'), leaf]) fs.utimesSync(p, old, old);
    expect(verdictOf(collectAudit(h))).toBe('not-idle');
  }, 60_000);
});

describe.skipIf(!LINUX)('in-use: a process of this uid in the leaf, by cwd or by TMPDIR', () => {
  it('a process whose cwd is in the leaf', () => {
    const { leaf } = makeOrphan(h);
    const p = holdCwd(path.join(leaf, 'cdk.out'));
    try {
      const a = collectAudit(h, { pre: AGED });
      expect(a.code, a.stderr).toBe(0);
      expect(verdictOf(a)).toBe('in-use');
      expect(String(a.doc!['detail'])).toContain(String(p.pid));
      expect(a.doc!['token']).toBeUndefined();
    } finally { p.stop(); }
  }, 60_000);

  it('a process whose TMPDIR is the leaf, with its cwd elsewhere: the shape that re-created a leaf', () => {
    const { leaf } = makeOrphan(h);
    const p = holdTmpdir(leaf);
    try {
      expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('in-use');
    } finally { p.stop(); }
  }, 60_000);

  it('a probe that cannot answer is unmeasured `in-use`, never "nobody"', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} _ws_path_users() { _WS_PATH_USERS_WHY='stub: the table would not list'; return 2; };` });
    expect(a.code).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('in-use');
  }, 60_000);
});

describe.skipIf(!LINUX)('containment-unproven: TERMINAL — a checkout git records elsewhere, or a row at, inside or through the leaf', () => {
  it('a worktree moved into the leaf, whose admin directory is gone: journaled, and nothing touched', () => {
    const { leaf } = makeOrphan(h);
    plantForeignCheckout(leaf);
    const a = collectAudit(h, { pre: AGED });
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('containment-unproven');
    expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'containment-unproven' }]);
    expect(fs.existsSync(path.join(leaf, 'wt', '.git'))).toBe(true);
  }, 60_000);

  it('a stopped session’s row inside the leaf (the measured loss): containment-unproven', () => {
    const { leaf } = makeOrphan(h);
    fs.mkdirSync(path.join(leaf, 'clone'));
    fs.writeFileSync(path.join(regDir(h), 'demo-other.workdir'), path.join(leaf, 'clone'));
    fs.writeFileSync(path.join(regDir(h), 'demo-other.uuid'), 'deadbeef-0000-4000-8000-000000000000');
    expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('containment-unproven');
  }, 60_000);

  it('the row rule is asked of the id and of the leaf’s own path', () => {
    const { leaf } = makeOrphan(h);
    const rows = `_ws_collect_rows_clear() { printf '%s|%s' "$1" "$2" > "$HOME/rows-asked"; _WS_COLLECT_ROWS_WHY='stub: a row'; return 1; };`;
    expect(verdictOf(collectAudit(h, { pre: `${AGED} ${rows}` }))).toBe('containment-unproven');
    expect(fs.readFileSync(path.join(h.home, 'rows-asked'), 'utf8')).toBe(`${COL_ID}|${leaf}`);
  }, 60_000);

  it('a checkout scan that cannot answer: unmeasured `checkouts`', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} _ws_leaf_checkouts() { _WS_CHECKOUTS_WHY='stub: the walk timed out'; return 2; };` });
    expect(a.code).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('checkouts');
  }, 60_000);

  it('a row rule that cannot answer: unmeasured `rows`', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} _ws_collect_rows_clear() { _WS_COLLECT_ROWS_WHY='stub: unplaceable'; return 2; };` });
    expect(a.code).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('rows');
  }, 60_000);
});

describe.skipIf(!LINUX)('paused: read inside the lock, the last rung', () => {
  it('the kill-switch: paused, exit 0, no token, nothing journaled; lowered, collectable', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} ${PAUSE}` });
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('paused');
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
    fs.rmSync(path.join(regDir(h), 'reclaim-paused'));
    expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('collectable');
  }, 60_000);

  it('a dangling link at the switch pauses too', () => {
    makeOrphan(h);
    fs.symlinkSync(path.join(h.home, 'nowhere'), path.join(regDir(h), 'reclaim-paused'));
    expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('paused');
  }, 60_000);
});

describe.skipIf(!LINUX)('the order: the first rung that does not pass ends the evaluation', () => {
  it('witness-mismatch outranks not-idle, in-use, containment and the pause', () => {
    const { leaf } = makeOrphan(h);
    replaceLeaf(h);
    plantForeignCheckout(leaf);
    const p = holdCwd(leaf);
    try { expect(verdictOf(collectAudit(h, { pre: PAUSE }))).toBe('witness-mismatch'); } finally { p.stop(); }
  }, 60_000);

  it('not-idle (the REAL walk) outranks in-use, containment and the pause', () => {
    const { leaf } = makeOrphan(h);
    plantForeignCheckout(leaf);
    const p = holdCwd(leaf);
    try { expect(verdictOf(collectAudit(h, { pre: PAUSE }))).toBe('not-idle'); } finally { p.stop(); }
  }, 60_000);

  it('in-use outranks containment and the pause', () => {
    const { leaf } = makeOrphan(h);
    plantForeignCheckout(leaf);
    const p = holdCwd(leaf);
    try { expect(verdictOf(collectAudit(h, { pre: `${AGED} ${PAUSE}` }))).toBe('in-use'); } finally { p.stop(); }
  }, 60_000);

  it('containment outranks the pause: a paused fleet still learns its terminal refusals', () => {
    const { leaf } = makeOrphan(h);
    plantForeignCheckout(leaf);
    expect(verdictOf(collectAudit(h, { pre: `${AGED} ${PAUSE}` }))).toBe('containment-unproven');
    expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'containment-unproven' }]);
  }, 60_000);
});

// The leaf the document names is `_child_tmpdir`'s spelling, untouched by any of the rungs above.
it.skipIf(!LINUX)('every rung leaves the leaf as it found it', () => {
  const { leaf } = makeOrphan(h);
  const before = (fs.readdirSync(leaf, { recursive: true }) as string[]).map(String).sort();
  for (const pre of [AGED, '', `${AGED} ${PAUSE}`]) collectAudit(h, { pre });
  expect((fs.readdirSync(leafOf(h), { recursive: true }) as string[]).map(String).sort()).toEqual(before);
}, 90_000);
```

Create `server/test/ccd-collect-audit-resume.test.ts`:

```ts
// A standing quarantine record makes `ws-audit --collect` a RESUME (the temp-root collector, spec §5.10). The record
// is the authority, whatever the witness now says, and a resume never walks the tree or asks the floor. Its phase is
// read off the disk — `unmoved`, `moved`, `removed` — and anything the collector did not leave there is
// `quarantine-kept`: TERMINAL, journaled, and the operator's. A `moved` leaf is re-proven as the verb re-proves it
// after a move. FIXTURE HOME ONLY (`collectFixture.ts`). Linux only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, readJournal, refusalsOf } from './lifecycleHelpers.js';
import { holdCwd } from './wsExpireFixture.js';
import {
  AGED, COL_ID, NO_WALK, PAUSE, type Answer, type Identity, type RecordFields, collectAudit, collectForkOf,
  collectOf, holdTmpdir, identityOf, leafOf, lockOf, makeOrphan, moveIntoSlot, plantRecord, quarantineOf, recName,
  recordFor, recordLine, regDir, verdictOf, walked, witnessOf,
} from './collectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-resume-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';

const setup = (): { leaf: string; ident: Identity } => {
  const { leaf } = makeOrphan(h);
  return { leaf, ident: identityOf(leaf) };
};
const plantOwn = (ident: Identity, over: Partial<RecordFields> = {}, name: string = recName()): string =>
  plantRecord(h, name, recordLine({ ...recordFor(ident), ...over }));

describe.skipIf(!LINUX)('the phases, read off the disk', () => {
  it('unmoved: the record stands and the leaf never left — resume `unmoved`, and no walk', () => {
    const { ident } = setup();
    plantOwn(ident);
    const a = collectAudit(h, { pre: NO_WALK });
    expect(a.code, a.stderr).toBe(0);
    expect(Object.keys(a.doc!)).toEqual(['session', 'mode', 'exists', 'collect', 'resume', 'verdict', 'detail', 'token']);
    expect(a.doc).toMatchObject({ resume: 'unmoved', verdict: 'collectable', exists: true });
    expect(collectOf(a)).toMatchObject({ records: [recName()], newestCtimeNs: null, entries: null, idleAt: null });
    expect(walked(h), 'a resume never walks the tree').toBe(false);
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('unmoved, with its empty slot already made: still unmoved', () => {
    const { ident } = setup();
    plantOwn(ident);
    fs.mkdirSync(path.join(quarantineOf(h), `slot.${recName()}`), { recursive: true, mode: 0o700 });
    expect(collectAudit(h).doc).toMatchObject({ resume: 'unmoved', verdict: 'collectable' });
  }, 60_000);

  it('moved: the leaf stands in its slot — resume `moved`, nothing at the id', () => {
    const { ident } = setup();
    plantOwn(ident);
    moveIntoSlot(h);
    const a = collectAudit(h, { pre: NO_WALK });
    expect(a.code, a.stderr).toBe(0);
    expect(a.doc).toMatchObject({ resume: 'moved', verdict: 'collectable', exists: false });
    expect(walked(h)).toBe(false);
  }, 60_000);

  it('removed: the slot is empty and the leaf is in neither place — resume `removed`', () => {
    const { ident } = setup();
    plantOwn(ident);
    const slot = moveIntoSlot(h);
    fs.rmSync(path.join(slot, 'leaf'), { recursive: true });
    expect(collectAudit(h).doc).toMatchObject({ resume: 'removed', verdict: 'collectable', exists: false });
  }, 60_000);

  it('the resume token is the fork’s, binds the phase, and is never the fresh token', () => {
    const { ident } = setup();
    const fresh = collectAudit(h, { pre: AGED }).doc!['token'];
    plantOwn(ident);
    const unmoved = collectAudit(h).doc!['token'];
    expect(unmoved).toMatch(/^[0-9a-f]{64}$/);
    expect(unmoved).toBe(collectForkOf(h).token);
    expect(collectForkOf(h).phase).toBe('unmoved');
    moveIntoSlot(h);
    const moved = collectAudit(h).doc!['token'];
    expect(new Set([fresh, unmoved, moved]).size).toBe(3);
  }, 90_000);

  it('a path retaken since the move is quarantine-kept: TERMINAL, on every audit, asked before the row it brought', () => {
    const { ident } = setup();
    plantOwn(ident);
    moveIntoSlot(h);
    const before = collectAudit(h).doc!['token'];
    // A new child on the same slug: `mkdir -p` makes a NEW leaf at the id, and its first spawn rewrites the witness.
    // Its `.child` row is LEFT standing: the retake is asked before the registry, or `registered` would hide it.
    h.sh(`_reg_set ${COL_ID} child 9 && _child_tmpdir ${COL_ID} >/dev/null`);
    expect(identityOf(leafOf(h)).ino, 'the CONTROL: another inode stands at the id').not.toBe(ident.ino);
    const a = collectAudit(h);
    expect(a.code, a.stderr).toBe(0);
    expect(a.doc).toMatchObject({ verdict: 'quarantine-kept' });
    expect(String(a.doc!['detail'])).toContain('retaken');
    expect(a.doc!['token']).toBeUndefined();
    expect(collectOf(a)['records'], 'a kept record is listed, never silent').toEqual([recName()]);
    expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'quarantine-kept' }]);
    expect(verdictOf(collectAudit(h)), 'answered on every audit').toBe('quarantine-kept');
    // Read off the disk: once the original path is free again (and its row gone), the record resumes as before, and
    // the rewritten witness changed nothing — the record is the authority.
    fs.rmSync(leafOf(h), { recursive: true });
    fs.rmSync(path.join(regDir(h), `${COL_ID}.child`));
    const c = collectAudit(h);
    expect(c.doc).toMatchObject({ resume: 'moved', verdict: 'collectable' });
    expect(c.doc!['token'], 'the witness is no input of a resume').toBe(before);
  }, 60_000);

  it('a record with no witness at all is resumed, and its lock taken', () => {
    const { ident } = setup();
    plantOwn(ident);
    fs.rmSync(witnessOf(h));
    const a = collectAudit(h);
    expect(a.doc).toMatchObject({ resume: 'unmoved', verdict: 'collectable' });
    expect(collectOf(a)['witness']).toBeNull();
    expect(fs.existsSync(lockOf(h))).toBe(true);
  }, 60_000);
});

describe.skipIf(!LINUX)('quarantine-kept: TERMINAL and journaled — what the collector did not leave is the operator’s', () => {
  const expectKept = (a: Answer, detail: string): void => {
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('quarantine-kept');
    expect(String(a.doc!['detail'])).toContain(detail);
    expect(a.doc!['token']).toBeUndefined();
    expect(collectOf(a)['records'], 'a kept record is listed, never silent').not.toEqual([]);
    expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'quarantine-kept' }]);
    expect(eventsOf(h.home, 'collect')[0]!['verb']).toBe('ws-audit');
  };

  // The three RECORD-level shapes assert the word only: whether the record reader or this audit names the fault
  // is the reader's to decide, and either way the record is kept.
  it('a record ccd cannot read as it writes it', () => {
    setup();
    plantRecord(h, recName(), 'v=1 junk\n');
    expectKept(collectAudit(h), '');
  }, 60_000);

  it('a record that names another id', () => {
    const { ident } = setup();
    plantOwn(ident, { id: 'demo-other-id' });
    expectKept(collectAudit(h), '');
  }, 60_000);

  it('a record with no birth time', () => {
    const { ident } = setup();
    plantOwn(ident, { btime: '-' });
    expectKept(collectAudit(h), '');
  }, 60_000);

  it('a slot whose leaf is a link, to the very directory the record names: never followed, nothing behind it touched', () => {
    const { ident } = setup();
    plantOwn(ident);
    const slot = moveIntoSlot(h);
    const away = path.join(h.home, 'away');
    fs.renameSync(path.join(slot, 'leaf'), away);
    fs.symlinkSync(away, path.join(slot, 'leaf'));
    expectKept(collectAudit(h), 'is a link or not a directory');
    expect(fs.existsSync(path.join(away, 'cdk.out', 'manifest.json'))).toBe(true);
  }, 60_000);

  it('a slot leaf that no longer matches its record', () => {
    const { ident } = setup();
    plantOwn(ident);
    const slot = path.join(quarantineOf(h), `slot.${recName()}`);
    fs.mkdirSync(path.join(slot, 'leaf'), { recursive: true, mode: 0o700 });
    expectKept(collectAudit(h), 'its record names');
  }, 60_000);

  it('a slot holding what the collector never put there: kept, and it stays', () => {
    const { ident } = setup();
    plantOwn(ident);
    const slot = moveIntoSlot(h);
    fs.writeFileSync(path.join(slot, 'stranger'), 's');
    expectKept(collectAudit(h), 'never put there');
    expect(fs.existsSync(path.join(slot, 'stranger'))).toBe(true);
    expect(fs.existsSync(path.join(slot, 'leaf', 'cdk.out'))).toBe(true);
  }, 60_000);

  it('two records of one id: a resume completes one and never chooses', () => {
    const { ident } = setup();
    plantOwn(ident);
    plantOwn(ident, {}, `${COL_ID}.1.2`);
    const a = collectAudit(h);
    expectKept(a, '2 quarantine records');
    expect(collectOf(a)['records']).toHaveLength(2);
  }, 60_000);
});

describe.skipIf(!LINUX)('a moved leaf is re-proven: registered, in use under either spelling, a row on the pre-move spelling, the pause', () => {
  it('a recycled spawn’s marker: registered — retried, never kept, never journaled', () => {
    const { ident } = setup();
    plantOwn(ident);
    moveIntoSlot(h);
    fs.writeFileSync(path.join(regDir(h), `${COL_ID}.child`), '9');
    const a = collectAudit(h);
    expect(verdictOf(a)).toBe('registered');
    expect(collectOf(a)['records'], 'the record is still listed').toEqual([recName()]);
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('a process whose TMPDIR is the PRE-MOVE spelling: in-use', () => {
    const { leaf, ident } = setup();
    plantOwn(ident);
    moveIntoSlot(h);
    const p = holdTmpdir(leaf);
    try {
      expect(collectAudit(h).doc).toMatchObject({ resume: 'moved', verdict: 'in-use' });
    } finally { p.stop(); }
  }, 60_000);

  it('a process whose cwd is in the slot leaf: in-use', () => {
    const { ident } = setup();
    plantOwn(ident);
    const slot = moveIntoSlot(h);
    const p = holdCwd(path.join(slot, 'leaf', 'cdk.out'));
    try {
      expect(verdictOf(collectAudit(h))).toBe('in-use');
    } finally { p.stop(); }
  }, 60_000);

  it('the row rule is asked of the PRE-MOVE spelling', () => {
    const { leaf, ident } = setup();
    plantOwn(ident);
    moveIntoSlot(h);
    const rows = `_ws_collect_rows_clear() { printf '%s|%s' "$1" "$2" > "$HOME/rows-asked"; _WS_COLLECT_ROWS_WHY='stub: a row'; return 1; };`;
    expect(verdictOf(collectAudit(h, { pre: rows }))).toBe('containment-unproven');
    expect(fs.readFileSync(path.join(h.home, 'rows-asked'), 'utf8')).toBe(`${COL_ID}|${leaf}`);
  }, 60_000);

  it('the pause holds a resume too', () => {
    const { ident } = setup();
    plantOwn(ident);
    moveIntoSlot(h);
    expect(collectAudit(h, { pre: PAUSE }).doc).toMatchObject({ resume: 'moved', verdict: 'paused' });
  }, 60_000);

  it('a quarantine directory that is a link is never followed: unmeasured `quarantine`, exit 1', () => {
    const { ident } = setup();
    plantOwn(ident);
    moveIntoSlot(h);
    const q = quarantineOf(h);
    const real = path.join(h.home, 'qreal');
    fs.renameSync(q, real);
    fs.symlinkSync(real, q);
    const a = collectAudit(h);
    expect(a.code).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('quarantine');
  }, 60_000);
});
```

Make these edits to existing tests (items 5 and 6 by ruling G2). Each sits at the line named; locate it by the quoted text.

1. `server/test/lifecycle-refusal-word.test.ts`:
   - In `ALL_TOKENS`, directly below the last entry line (on `b0647d850`, `'token-malformed': true, 'run-id-malformed': true,`; after Task 1 it holds `'containment-refuted': true` too), add `  'witness-mismatch': true, 'quarantine-kept': true,`.
   - Raise `expect(TOKENS.length).toBe(…)` by TWO from what your tree reads: 19 → 21 on a tree carrying Task 1.
2. `server/test/ccd-child-reclaim-pause.test.ts:232`: change `for (const name of ['_ws_reclaim_ladder', '_ws_reclaim_resume_eval', '_ws_expire_resume_eval'])` to `for (const name of ['_ws_reclaim_ladder', '_ws_reclaim_resume_eval', '_ws_expire_resume_eval', '_ws_collect_paused'])`.
3. `server/test/ccd-die-containment.test.ts`:
   - At :366, change `'_supervised_start', '_swap_refuse', '_ws_expire_audit_contained', '_ws_expire_refuse_return']);` to these two lines:
     ```ts
             '_supervised_start', '_swap_refuse', '_ws_collect_audit_contained', '_ws_expire_audit_contained',
             '_ws_expire_refuse_return']);
     ```
   - Directly under the comment paragraph that begins `` // `_ws_expire_audit_contained` joined them with `ws-audit --expire`: it `` (:350–:352), add:
     ```ts
         // `_ws_collect_audit_contained` joined them with `ws-audit --collect`, for the same reason: it `die`s on an
         // id or a python3 it cannot use, before any read, reached through `cmd_ws_audit`'s hand-off and never
         // inside `$( )`.
     ```
4. `server/test/ccd-ws-expire-audit.test.ts:126` and `server/test/ccd-child-reclaim-audit.test.ts:217`: in each `toContain('usage: ccd ws-audit --session <id> [--reclaim [--defer-expired] | --expire]')`, replace `| --expire]` with `| --expire | --collect]`.5. `server/test/ccd-wsaudit-nonpoison.test.ts` (ruling G2: this commit is the first to spell words in the COLLECT region, so it teaches the scan that region):
   - In `withoutReclaim`'s list, `for (const block of [reclaimRegion(text), markedBlock(text, 'MIRROR-BEGIN', 'MIRROR-END'), markedBlock(text, 'EXPIRE-BEGIN', 'EXPIRE-END')])`, add `markedBlock(text, 'COLLECT-BEGIN', 'COLLECT-END')` as a fourth entry. End the function's docstring sentence with `, and Task 4's COLLECT region, the temp-root collector's own words (child reclamation wave 7)`.
   - Directly under the mirror's found-check (the `expect.soft(markedBlock(full, 'MIRROR-BEGIN', 'MIRROR-END'), …)` statement and its `.toContain(…)` line), add:
     ```ts
         expect.soft(markedBlock(full, 'COLLECT-BEGIN', 'COLLECT-END'), 'the COLLECT region was found, and holds the collector’s audit')
           .toContain('_ws_collect_audit_contained() {');
     ```
   - The counts do not move: this block spells no harvested shape, so the scan answers 55 outside the cut regions and 67 in all. Every line added sits BELOW the `toHaveLength(55)` pin the frozen corpus cites; Step 6's citation case proves no cited line moved.
6. `server/test/ccd-refusal-scan.test.ts` (ruling G2): directly below the case `holds the expiry emits at exactly two in ws-expire — one verdict point, one flock decline (workspace lifecycle, wave 3)` (after its closing `});`), add:
   ```ts
     it('holds the collector audit’s emits at exactly three in the COLLECT region — one per TERMINAL word, verb ws-audit (child reclamation, wave 7)', () => {
       // `ws-audit --collect` journals its three TERMINAL words only (contract §14 R66), each at its own literal site in
       // `_ws_collect_audit_doc`. A fourth `verb ws-audit` emit is a retryable word journaled, which would bury the
       // journal on every pass of wave 9's lane. `ws-collect`'s own emits (Task 6) carry verb ws-collect and are not
       // counted here. Comment lines are not code.
       const region = src.slice(src.indexOf('COLLECT-BEGIN'), src.indexOf('COLLECT-END'));
       expect(region.length, 'the COLLECT region could not be sliced').toBeGreaterThan(10000);
       const code = region.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
       expect([...code.matchAll(/_lc_emit collect refused "\$id" "" verb ws-audit /g)]).toHaveLength(3);
     });
   ```
   Measure the region's length at this commit and set the floor below it, with room for an edit, as the expiry's was set. The three literal sites are already harvested by the file's cross-language case, which reads all of `src`.

- [ ] **Step 3: Run the tests to verify they fail**

Run, in the FOREGROUND with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-collect-audit.test.ts test/ccd-collect-audit-rungs.test.ts test/ccd-collect-audit-resume.test.ts)
(cd server && ./node_modules/.bin/vitest run test/lifecycle-refusal-word.test.ts test/ccd-child-reclaim-pause.test.ts test/ccd-die-containment.test.ts test/ccd-ws-expire-audit.test.ts test/ccd-child-reclaim-audit.test.ts test/ccd-wsaudit-nonpoison.test.ts test/ccd-refusal-scan.test.ts)
```

Expected: FAIL.
- **The three new files.** Today `cmd_ws_audit --session <id> --collect` falls through to the `--reclaim` usage check and dies, so:
  - every document case reds at its first assertion: `ccd: usage: ccd ws-audit --session <id> [--reclaim [--defer-expired] | --expire]: expected 1 to be 0`, or `expected 'undefined' to be '<word>'`;
  - every `collectForkOf` case throws `Command failed`, with `_ws_collect_fork: command not found` and `_WS_COLLECT_PHASE: unbound variable`;
  - the platform case: `expected 'undefined' to be 'unmeasured'`;
  - the usage case: `expected '…| --expire]' to contain '…| --expire | --collect]'`;
  - the declaration cases: `expected false to be true`;
  - "found the block": `expected 0 to be greater than 8000`.
  - "the plain audit carries no collect mode" passes already. It pins that the hand-off never leaks into the plain audit.
- **`lifecycle-refusal-word`:** `isLcRefusalToken(witness-mismatch)`: `expected false to be true`; the count: `expected 19 to be 21`.
- **`ccd-child-reclaim-pause`:** `_ws_collect_paused is not defined at column 0: expected -1 to be greater than -1`.
- **`ccd-die-containment`:** the fatal list `expected [ …, '_ws_expire_audit_contained', … ] to deeply equal [ …, '_ws_collect_audit_contained', … ]`.
- **The two usage cases:** `expected '…| --expire]' to contain '…| --expire | --collect]'`.- **`ccd-wsaudit-nonpoison`:** the new found-check, `the COLLECT region was found, and holds the collector’s audit: expected '…' to contain '_ws_collect_audit_contained() {'` (Task 4's region stands, without this block).
- **`ccd-refusal-scan`:** the new COLLECT case, `expected [] to have a length of 3 but got +0`.

- [ ] **Step 4: Implement**

(a) **The hand-off**, ABOVE the 19109 boundary. The three lines are replaced IN PLACE, and the line count is unchanged.
- In `cmd_ws_audit`, ccd/ccd:12815 and ccd/ccd:12818 each carry `die "usage: ccd ws-audit --session <id> [--reclaim [--defer-expired] | --expire]"`. In both, replace `| --expire]` with `| --expire | --collect]`.
- Replace the line at ccd/ccd:12816 (`  if (( $# >= 3 )); then [[ $3 != --expire || $# -ne 3 ]] || { _ws_expire_audit "$2"; return; }   # "WS-AUDIT --EXPIRE", EXPIRE region`) with exactly this one line:

```bash
  if (( $# >= 3 )); then [[ $3 != --expire || $# -ne 3 ]] || { _ws_expire_audit "$2"; return; }; [[ $3 != --collect || $# -ne 3 ]] || { _ws_collect_audit "$2"; return; }   # "WS-AUDIT --EXPIRE" and "WS-AUDIT --COLLECT", in their regions
```

(b) **The audit block**, below 19109. Put it in the COLLECT region Task 4 opened: directly below Task 4's building blocks, and above the region's end marker. Insert exactly:

```bash
# ── ws-audit --collect: the collector's audit (temp-root collector, spec §5.10) ───────── WS-AUDIT-COLLECT ──
# `cmd_ws_audit` sits above the frozen citation corpus's anchors, so its one
# line for this mode is a hand-off on its existing `if` line, beside the
# expiry's, and the mode is answered here, whole.
#
# THE POPULATION, decided BEFORE any lock: an id with a witness standing at
# `$REG/tmproots/<id>` (never read through a `tmproots/` that is itself a
# link), or with at least one quarantine record of it under
# `$REG/tmpquarantine/`, found by `_ws_collect_records_of`'s exact parse and
# never by an `<id>.*` prefix (ids admit dots). Anything else answers
# `not-witnessed` and takes NO lock: the audit never makes `.reap-<name>.lock`
# for a name ccd never handed a temp root.
#
# THE LOCK. Inside the population the audit takes `$REG/.reap-<id>.lock`,
# `-n` — the lock every verb that removes anything of the id takes. It writes
# nothing that lock serialises; it holds it so the registry listing control
# below has a name it KNOWS stands, its own lock file. Held by another process:
# the retryable `in-progress`, nothing journaled.
#
# THE ONE EVALUATION, `_ws_collect_fork`, which `ws-collect` runs again inside
# its own lock and compares the token against. A standing record makes it a
# RESUME (`_ws_collect_resume_eval`), whatever the witness now says: the
# record is the resume's authority, and a resume never walks the tree or asks
# the floor. Otherwise the fresh rungs (`_ws_collect_eval`), in this order, the
# first that does not pass ending it:
#   registered — `$REG/<id>.child` or `$REG/<id>.uuid` by DIRECT lookup (the
#     read `_child_tmpdir` makes, which needs no listing), then `_ws_slug_free`,
#     believed only when a WILDCARD listing of `$REG` shows the lock this
#     process holds: a `$REG` that can be searched but not listed makes every
#     glob come back empty, and `_ws_slug_free` then answers free over a
#     standing row (measured);
#   witness-mismatch (TERMINAL) — the witness unreadable, without a birth
#     time, or not the real directory at the id by dev, ino and birth time;
#   not-idle — the newest CTIME over every entry under the leaf, the leaf
#     included, younger than the floor (Task 4's `_ws_collect_floor_held`
#     against `_ws_collect_floor_s`); mtime is never read;
#   in-use — `_ws_path_users` (cwd, open file, TMPDIR);
#   containment-unproven (TERMINAL) — `_ws_leaf_checkouts` on the leaf's own
#     path, then `_ws_collect_rows_clear` (a registry row at, inside or
#     through the leaf);
#   paused — read here, inside the lock, as the verb reads it. Last, because a
#     pause stops the act and not the measurement: a paused fleet still learns
#     its terminal refusals.
# A probe that cannot answer ends it at its rung as `unmeasured`, and names
# itself in `collect.unmeasured`. A witness whose leaf is PROVEN absent, with
# no record standing, is collectable at once with a token of its own: the verb
# then drops the witness, and nothing else (spec §5.10, "no orphaned slot").
#
# THE DOCUMENT mirrors `ws-audit --expire`'s, with a `collect` object.
# `collectable` MEANS a token, spelled through `_json_str` as the other audits'
# success words are. Every word here is set through `_ws_collect_refuse`,
# never the reap ladder's refusal helper, and no line of this block is written
# in a shape the refusal harvests read (`ccd-collect-audit.test.ts` pins it).
# `unmeasured` prints the document with that word and EXITS 1 — the server
# reads any audit exit 1 as `failed` and retries — and is journaled nowhere.
# A TERMINAL word (`witness-mismatch`, `quarantine-kept`,
# `containment-unproven`) is journaled, act `collect`, verb `ws-audit`, its
# detail cut by `_ws_leaf_why_line`; nothing else the audit answers is.
#
# LINUX ONLY. On Darwin the audit answers unmeasured (`platform`) before it
# reads anything, and so does a box whose `mv` has no `--no-copy` (`mv`): the
# verb's move is one `renameat2(RENAME_NOREPLACE)` or nothing.
_WS_COLLECT_PROBE=''; _WS_COLLECT_REG_WHY=''; _WS_COLLECT_PHASE=''; _WS_COLLECT_LEAF=''
_WS_COLLECT_RECORD=''; _WS_COLLECT_SLOT=''; _WS_COLLECT_NEWEST_NS=''; _WS_COLLECT_ENTRIES=''
_WS_COLLECT_IDLE_AT=''
_WS_COLLECT_RECORDS=()

_ws_collect_reset() {   # -> every answer the collector's evaluation sets, cleared: no earlier read is ever printed
  REAP_VERDICT=''; REAP_DETAIL=''; REAP_TOKEN=''
  _WS_COLLECT_PROBE=''; _WS_COLLECT_REG_WHY=''; _WS_COLLECT_PHASE=''; _WS_COLLECT_LEAF=''
  _WS_COLLECT_RECORD=''; _WS_COLLECT_SLOT=''; _WS_COLLECT_NEWEST_NS=''; _WS_COLLECT_ENTRIES=''
  _WS_COLLECT_IDLE_AT=''
  _WS_COLLECT_RECORDS=()
  _WS_WIT_DEV=''; _WS_WIT_INO=''; _WS_WIT_BTIME=''; _WS_WIT_RUN=''; _WS_WIT_UID=''; _WS_WIT_AT=''
}
_ws_collect_refuse() { REAP_VERDICT="$1"; REAP_DETAIL="$2"; return 1; }   # word detail -> rc 1: the collector's answer, set
_ws_collect_unmeasured() { REAP_VERDICT=unmeasured; _WS_COLLECT_PROBE="$1"; REAP_DETAIL="$2"; return 1; }   # probe detail -> rc 1

# THE FLOOR AND THE IDENTITY ARE TASK 4'S, never redefined here: bash keeps
# the LAST definition of a name, so a second one in this block would replace
# Task 4's for every caller. `_ws_collect_floor_s` is the one definition of the
# floor (the knob only raises it), `_ws_collect_floor_held` the one judgment of
# it, and `_ws_collect_ident <path> <dev:ino> <btime>` the one identity check,
# the one `_ws_collect_move` proves a move with.

_ws_collect_paused() {   # -> 0 when reclamation is not paused; rc 1 with `paused` set when it is
  [[ ! -e "$REG/reclaim-paused" && ! -L "$REG/reclaim-paused" ]] \
    || { _ws_collect_refuse paused "reclamation is paused fleet-wide ($REG/reclaim-paused) — nothing is collected while it stands"; return 1; }
}

_ws_collect_registered() {   # id -> 0 when no registry row stands for id; 1 when one does; 2 when that could not be
  #                               told — each with _WS_COLLECT_REG_WHY. The CALLER HOLDS `$REG/.reap-<id>.lock`.
  local id="$1" f
  local -a ctl=()
  _WS_COLLECT_REG_WHY=''
  for f in child uuid; do
    if [[ -e "$REG/$id.$f" || -L "$REG/$id.$f" ]]; then
      _WS_COLLECT_REG_WHY="$REG/$id.$f stands — a workspace is registered as $id, so the temp root at its id is that workspace's"
      return 1
    fi
  done
  # THE LISTING CONTROL: the glob is a wildcard, so it is answered by READING
  # `$REG`, and the one name it must find is the lock this process holds open.
  ctl=("$REG/.reap-$id".lo[c]k)
  [[ ${#ctl[@]} -eq 1 && "${ctl[0]}" == "$REG/.reap-$id.lock" ]] \
    || { _WS_COLLECT_REG_WHY="a wildcard listing of $REG does not show the lock this process holds there, so $REG cannot be listed and no other row of $id could be seen"; return 2; }
  [[ "$id" == *-* ]] \
    || { _WS_COLLECT_REG_WHY="$id names no project and slug, so whether its slug is free cannot be asked"; return 2; }
  _ws_slug_free "${id%-*}" "${id##*-}" && return 0
  _WS_COLLECT_REG_WHY="the registry still holds $(_ws_slug_residue "${id%-*}" "${id##*-}") — a row of $id, or what one left behind"
  return 1
}

_ws_collect_eval() {   # id -> the FRESH rungs: REAP_VERDICT `collectable` (REAP_TOKEN), a word, or `unmeasured`
  #                        (_WS_COLLECT_PROBE). The CALLER HOLDS `$REG/.reap-<id>.lock`. Reads only.
  local id="$1" leaf="$HOME/.cc-tmp/$1" rc floor why=walk-failed
  _ws_collect_registered "$id"; rc=$?
  (( rc != 2 )) || { _ws_collect_unmeasured registry "$_WS_COLLECT_REG_WHY"; return 1; }
  (( rc != 1 )) || { _ws_collect_refuse registered "$_WS_COLLECT_REG_WHY"; return 1; }
  _ws_tmproot_witness_read "$id"; rc=$?
  (( rc != 1 )) || { _ws_collect_refuse not-witnessed "no witness stands for $id at $(_ws_tmproot_witness_file "$id") and no quarantine record names it — there is nothing to collect"; return 1; }
  (( rc != 2 )) || { _ws_collect_refuse witness-mismatch "the witness $(_ws_tmproot_witness_file "$id") cannot be read as ccd writes it — a temp root nothing vouches for is offered to the operator, never taken"; return 1; }
  [[ "$_WS_WIT_BTIME" != - ]] \
    || { _ws_collect_refuse witness-mismatch "the witness of $id records no birth time, so device and inode alone would vouch for $leaf — it is offered to the operator, never taken"; return 1; }
  _ws_reclaim_absent "$leaf"; rc=$?
  (( rc != 2 )) || { _ws_collect_unmeasured leaf "$_WS_ABSENT_WHY"; return 1; }
  if (( rc == 0 )); then
    # A WITNESS WITH NO LEAF (and the fork found no record of the id): nothing
    # to walk, probe or remove; the verb drops the witness, compared first.
    _WS_COLLECT_LEAF=absent
    _ws_collect_paused || return 1
    REAP_TOKEN=$(_ws_reclaim_fingerprint mode=collect-absent "id=$id" "dev=$_WS_WIT_DEV" "ino=$_WS_WIT_INO" \
      "btime=$_WS_WIT_BTIME" "run=$_WS_WIT_RUN" "at=$_WS_WIT_AT")
    [[ "$REAP_TOKEN" =~ ^[0-9a-f]{64}$ ]] \
      || { REAP_TOKEN=''; _ws_collect_unmeasured token "the collection token of $id could not be minted"; return 1; }
    REAP_VERDICT=collectable
    return 0
  fi
  _WS_COLLECT_LEAF=present
  [[ -d "$leaf" && ! -L "$leaf" ]] \
    || { _ws_collect_refuse witness-mismatch "$leaf is a link or not a directory — the collector takes only the directory its witness names; it is offered to the operator"; return 1; }
  _ws_collect_ident "$leaf" "$_WS_WIT_DEV:$_WS_WIT_INO" "$_WS_WIT_BTIME"; rc=$?
  (( rc != 2 )) || { _ws_collect_unmeasured identity "the device, inode or birth time of $leaf could not be read"; return 1; }
  (( rc == 0 )) \
    || { _ws_collect_refuse witness-mismatch "$leaf is $(_plat_devino "$leaf" 2>/dev/null) born $(_plat_btime "$leaf" 2>/dev/null), not the $_WS_WIT_DEV:$_WS_WIT_INO born $_WS_WIT_BTIME its witness names — it is offered to the operator, never taken"; return 1; }
  _ws_collect_idle "$leaf"; rc=$?
  if (( rc != 0 )) || [[ ! "${_WS_IDLE_NEWEST_NS-}" =~ ^[0-9]{1,19}$ || ! "${_WS_IDLE_COUNT-}" =~ ^[0-9]{1,9}$ ]]; then
    if (( rc != 0 )); then case "${_WS_IDLE_WHY-}" in timeout|unreadable|cap) why="$_WS_IDLE_WHY" ;; esac; fi
    _ws_collect_unmeasured "idle:$why" "the walk of $leaf for its newest change did not finish ($why), so how long it has been idle is unknown"
    return 1
  fi
  _WS_COLLECT_NEWEST_NS="$_WS_IDLE_NEWEST_NS"; _WS_COLLECT_ENTRIES="$_WS_IDLE_COUNT"
  floor=$(_ws_collect_floor_s)
  _WS_COLLECT_IDLE_AT=$(( (10#$_WS_COLLECT_NEWEST_NS + floor * 1000000000 + 999999999) / 1000000000 ))
  _ws_collect_floor_held "$_WS_COLLECT_NEWEST_NS"; rc=$?
  (( rc != 2 )) || { _ws_collect_unmeasured clock "this box's clock could not be read, so how long $leaf has been idle is unknown"; return 1; }
  (( rc != 1 )) || { _ws_collect_refuse not-idle "the newest change under $leaf is less than ${floor}s old — it is collectable from epoch $_WS_COLLECT_IDLE_AT, if nothing changes it first"; return 1; }
  _ws_path_users "$leaf"; rc=$?
  (( rc != 2 )) || { _ws_collect_unmeasured in-use "${_WS_PATH_USERS_WHY-}"; return 1; }
  (( rc != 1 )) || { _ws_collect_refuse in-use "a process of this uid still uses $leaf (pid ${_WS_PATH_USERS_PIDS-}: ${_WS_PATH_USERS_WHY-})"; return 1; }
  _ws_leaf_checkouts "$leaf"; rc=$?
  (( rc != 2 )) || { _ws_collect_unmeasured checkouts "${_WS_CHECKOUTS_WHY-}"; return 1; }
  (( rc != 1 )) || { _ws_collect_refuse containment-unproven "${_WS_CHECKOUTS_WHY-}"; return 1; }
  _ws_collect_rows_clear "$id" "$leaf"; rc=$?
  (( rc != 2 )) || { _ws_collect_unmeasured rows "${_WS_COLLECT_ROWS_WHY-}"; return 1; }
  (( rc != 1 )) || { _ws_collect_refuse containment-unproven "${_WS_COLLECT_ROWS_WHY-}"; return 1; }
  _ws_collect_paused || return 1
  REAP_TOKEN=$(_ws_collect_token "$id") && [[ "$REAP_TOKEN" =~ ^[0-9a-f]{64}$ ]] \
    || { REAP_TOKEN=''; _ws_collect_unmeasured token "the collection token of $id could not be minted"; return 1; }
  REAP_VERDICT=collectable
}

_ws_collect_resume_eval() {   # id record... -> a RESUME: REAP_VERDICT `collectable` with REAP_TOKEN and
  #                                _WS_COLLECT_PHASE (`unmoved`, `moved` or `removed`), a word, or `unmeasured`.
  #                                The CALLER HOLDS `$REG/.reap-<id>.lock`. Reads only, and never the tree's walk.
  # THE PHASE IS READ OFF THE DISK, never off the journal: `moved` — the
  # record's directory stands in its slot (`<slot>/leaf`, the record's dev, ino
  # and birth time) and NOTHING stands at the id; `unmoved` — it stands at the
  # id and the slot holds nothing; `removed` — it stands at neither (the slot's
  # leaf was removed, or the restore and a later tail took it). The slot is
  # never read from the record: Task 4's reader DERIVES it from the record's
  # name, `<physical ~/.cc-tmp>/.ccd-quarantine/slot.<record name>` (the record
  # body carries no path), and the slot may hold `leaf` and nothing else.
  # Anything the collector did not leave there is `quarantine-kept`: the record
  # and the slot stay for the operator, as they stand. So is a slot leaf with
  # ANYTHING at the id: the original path was retaken, the leaf can never go
  # back, and every audit answers it, TERMINAL — read off the disk, so it
  # clears once the path is free again. The registry is asked only after the
  # phase, because a retake usually brings a row, whose retryable `registered`
  # would otherwise hide it on every pass. A `moved` resume re-proves,
  # read-only, what the verb proves after a move: nobody uses either spelling,
  # and no registry row lies at, inside or through the PRE-MOVE spelling.
  local id="$1" rec name q='' slot sleaf orig="$HOME/.cc-tmp/$1" rc sstate=absent ostate=other phase ents
  shift
  (( $# == 1 )) \
    || { _ws_collect_refuse quarantine-kept "$# quarantine records name $id — a resume completes one record and never chooses between several; they are kept for the operator"; return 1; }
  rec="$1"; name="${rec##*/}"; _WS_COLLECT_RECORD="$rec"
  _ws_collect_record_read "$rec"; rc=$?
  (( rc != 1 )) || { _ws_collect_unmeasured records "the quarantine record $rec vanished while it was read"; return 1; }
  (( rc == 0 )) || { _ws_collect_refuse quarantine-kept "the quarantine record $rec cannot be read as ccd writes it — it, and whatever it names, are kept for the operator"; return 1; }
  [[ "${_WS_QREC_ID-}" == "$id" ]] \
    || { _ws_collect_refuse quarantine-kept "the quarantine record $rec names ${_WS_QREC_ID-nothing}, not $id — it is kept for the operator"; return 1; }
  [[ "${_WS_QREC_BTIME-}" =~ ^[1-9][0-9]*$ ]] \
    || { _ws_collect_refuse quarantine-kept "the quarantine record $rec records no birth time, so device and inode alone would vouch for what it names — it is kept for the operator"; return 1; }
  _ws_reclaim_absent "$HOME/.cc-tmp"; rc=$?
  (( rc != 2 )) || { _ws_collect_unmeasured quarantine "$_WS_ABSENT_WHY"; return 1; }
  if (( rc != 0 )); then
    _ws_dir_physical "$HOME/.cc-tmp" || { _ws_collect_unmeasured quarantine "$_WS_PHYS_WHY"; return 1; }
    q="$_WS_PHYS/.ccd-quarantine"
    if [[ -L "$q" ]] || { [[ -e "$q" ]] && { [[ ! -d "$q" ]] || [[ ! -O "$q" ]]; }; }; then
      _ws_collect_unmeasured quarantine "$q is a link, not a directory, or not this uid's — ccd never reads a slot through it"
      return 1
    fi
  fi
  slot="$_WS_QREC_SLOT"; sleaf="$slot/leaf"; _WS_COLLECT_SLOT="$slot"
  if [[ -L "$slot" ]] || { [[ -e "$slot" ]] && [[ ! -d "$slot" ]]; }; then
    _ws_collect_refuse quarantine-kept "the slot $slot is a link or not a directory — the collector never made it so; it is kept for the operator"
    return 1
  elif [[ -d "$slot" ]]; then
    ents=$(LC_ALL=C find -P "$slot" -mindepth 1 -maxdepth 1 -printf '%f/' 2>/dev/null) \
      || { _ws_collect_unmeasured slot "the slot $slot could not be listed"; return 1; }
    [[ -z "$ents" || "$ents" == leaf/ ]] \
      || { _ws_collect_refuse quarantine-kept "the slot $slot holds what the collector never put there — it is kept for the operator"; return 1; }
    if [[ -L "$sleaf" ]] || { [[ -e "$sleaf" ]] && [[ ! -d "$sleaf" ]]; }; then
      _ws_collect_refuse quarantine-kept "$sleaf is a link or not a directory — a slot leaf that is not the one moved there is kept for the operator"
      return 1
    elif [[ -d "$sleaf" ]]; then
      _ws_collect_ident "$sleaf" "$_WS_QREC_DEV:$_WS_QREC_INO" "$_WS_QREC_BTIME"; rc=$?
      (( rc != 2 )) || { _ws_collect_unmeasured identity "the device, inode or birth time of $sleaf could not be read"; return 1; }
      (( rc == 0 )) \
        || { _ws_collect_refuse quarantine-kept "$sleaf is $(_plat_devino "$sleaf" 2>/dev/null) born $(_plat_btime "$sleaf" 2>/dev/null), not the $_WS_QREC_DEV:$_WS_QREC_INO born $_WS_QREC_BTIME its record names — it is kept for the operator"; return 1; }
      sstate=leaf
    fi
  else
    _ws_reclaim_absent "$slot"; rc=$?
    (( rc == 0 )) || { _ws_collect_unmeasured slot "${_WS_ABSENT_WHY:-$slot stands but is neither a link, a file nor a directory}"; return 1; }
  fi
  _ws_collect_ident "$orig" "$_WS_QREC_DEV:$_WS_QREC_INO" "$_WS_QREC_BTIME"; rc=$?
  case "$rc" in
    0) ostate=match ;;
    1) _ws_reclaim_absent "$orig"; rc=$?
       (( rc != 2 )) || { _ws_collect_unmeasured leaf "$_WS_ABSENT_WHY"; return 1; }
       (( rc != 0 )) || ostate=absent ;;
    *) _ws_collect_unmeasured identity "the device, inode or birth time of $orig could not be read"; return 1 ;;
  esac
  case "$sstate:$ostate" in
    leaf:match)  _ws_collect_refuse quarantine-kept "the directory record $rec names stands both in $slot and at $orig — one of them is not what the collector moved; both are kept for the operator"; return 1 ;;
    leaf:absent) phase=moved ;;
    leaf:*)      _ws_collect_refuse quarantine-kept "something stands at $orig, the path the leaf in $slot was moved from — the original path was retaken, so the leaf cannot go back; the record, the slot and its leaf are kept for the operator"; return 1 ;;
    absent:match) phase=unmoved ;;
    *)          phase=removed ;;
  esac
  _WS_COLLECT_PHASE="$phase"
  # THE REGISTRY, asked only now: a retaken original path is TERMINAL above,
  # and a retake usually brings a row whose retryable `registered` would hide it.
  _ws_collect_registered "$id"; rc=$?
  (( rc != 2 )) || { _ws_collect_unmeasured registry "$_WS_COLLECT_REG_WHY"; return 1; }
  (( rc != 1 )) || { _ws_collect_refuse registered "$_WS_COLLECT_REG_WHY"; return 1; }
  if [[ "$phase" == moved ]]; then
    _ws_path_users "$sleaf"; rc=$?
    (( rc != 2 )) || { _ws_collect_unmeasured in-use "${_WS_PATH_USERS_WHY-}"; return 1; }
    (( rc != 1 )) || { _ws_collect_refuse in-use "a process of this uid still uses $sleaf (pid ${_WS_PATH_USERS_PIDS-}: ${_WS_PATH_USERS_WHY-})"; return 1; }
    _ws_path_users "$orig"; rc=$?
    (( rc != 2 )) || { _ws_collect_unmeasured in-use "${_WS_PATH_USERS_WHY-}"; return 1; }
    (( rc != 1 )) || { _ws_collect_refuse in-use "a process of this uid still uses $orig, the spelling $sleaf had before its move (pid ${_WS_PATH_USERS_PIDS-}: ${_WS_PATH_USERS_WHY-})"; return 1; }
    _ws_collect_rows_clear "$id" "$orig"; rc=$?
    (( rc != 2 )) || { _ws_collect_unmeasured rows "${_WS_COLLECT_ROWS_WHY-}"; return 1; }
    (( rc != 1 )) || { _ws_collect_refuse containment-unproven "${_WS_COLLECT_ROWS_WHY-}"; return 1; }
  fi
  _ws_collect_paused || return 1
  REAP_TOKEN=$(_ws_reclaim_fingerprint mode=collect-resume "id=$id" "record=$name" "phase=$phase" "slot=$slot" \
    "dev=$_WS_QREC_DEV" "ino=$_WS_QREC_INO" "btime=$_WS_QREC_BTIME" "run=${_WS_QREC_RUN-}" "at=${_WS_QREC_AT-}" \
    "pre=${_WS_QREC_TOKEN-}")
  [[ "$REAP_TOKEN" =~ ^[0-9a-f]{64}$ ]] \
    || { REAP_TOKEN=''; _ws_collect_unmeasured token "the resume token of $id could not be minted"; return 1; }
  REAP_VERDICT=collectable
}

_ws_collect_fork() {   # id -> THE ONE EVALUATION `ws-audit --collect` and `ws-collect` share: a standing record
  #                        RESUMES, else the fresh rungs. The CALLER HOLDS `$REG/.reap-<id>.lock`. Reads only.
  local id="$1" out rc
  local -a recs=()
  _ws_collect_reset
  out=$(_ws_collect_records_of "$id"); rc=$?
  (( rc == 0 )) || { _ws_collect_unmeasured records "the quarantine records of $id could not be listed"; return 1; }
  [[ -z "$out" ]] || mapfile -t recs <<< "$out"
  _WS_COLLECT_RECORDS=(${recs[@]+"${recs[@]}"})
  if (( ${#recs[@]} )); then
    _ws_tmproot_witness_read "$id" || :   # the document reports it; a resume never asks it
    _ws_collect_resume_eval "$id" "${recs[@]}"
  else
    _ws_collect_eval "$id"
  fi
}

_ws_collect_audit() {   # id -> `ccd ws-audit --session <id> --collect`, whole: ONE JSON document on stdout; exit 1 on
  #                         `unmeasured` (the server retries), else 0. Contained: the row rule's placement may ask git.
  _ws_reclaim_contained _ws_collect_audit_contained "$@"
}

_ws_collect_audit_contained() {   # `_ws_collect_audit`'s body, run under `_ws_reclaim_contained` — call that
  local id="$1" w out rc=0 lfd inpop=0
  _ws_tmproot_id_ok "$id" || die "bad session id"
  _json_str probe >/dev/null 2>&1 \
    || die "python3 unavailable — cannot quote the audit record safely"
  _ws_collect_reset
  if [[ "$CCD_OS" == darwin ]]; then
    _ws_collect_unmeasured platform "the temp-root collector runs on Linux only — on this box it measures nothing and takes nothing"
    _ws_collect_audit_doc "$id"; return
  fi
  w=$(_ws_tmproot_witness_file "$id")
  if [[ -L "$REG/tmproots" ]]; then
    _ws_collect_unmeasured witness "$REG/tmproots is a link — ccd never follows it, so whether $id is witnessed was never asked"
    _ws_collect_audit_doc "$id"; return
  fi
  [[ -e "$w" || -L "$w" ]] && inpop=1
  if (( ! inpop )); then
    out=$(_ws_collect_records_of "$id"); rc=$?
    (( rc == 0 )) || { _ws_collect_unmeasured records "the quarantine records of $id could not be listed"; _ws_collect_audit_doc "$id"; return; }
    [[ -z "$out" ]] || inpop=1
  fi
  if (( ! inpop )); then
    _ws_collect_refuse not-witnessed "no witness stands for $id and no quarantine record names it — ccd never handed out a temp root under this id that is still to be collected" || :
    _ws_collect_audit_doc "$id"; return
  fi
  _ws_collect_mv_ok || {
    _ws_collect_unmeasured mv "this box's mv has no --no-copy, so the collector's move could only ever be a copy — it measures nothing and takes nothing"
    _ws_collect_audit_doc "$id"; return; }
  command -v flock >/dev/null 2>&1 || {
    _ws_collect_unmeasured flock "flock (util-linux) is unavailable, so the reap lock of $id cannot be taken"
    _ws_collect_audit_doc "$id"; return; }
  exec {lfd}>>"$REG/.reap-$id.lock" || {
    _ws_collect_unmeasured lock "cannot open the reap lock at $REG/.reap-$id.lock"
    _ws_collect_audit_doc "$id"; return; }
  if ! flock -n "$lfd"; then
    exec {lfd}>&-
    _ws_collect_refuse in-progress "another ccd process holds the reap lock of $id — a reap, reclaim, expiry, restore or collection of it is running" || :
    _ws_collect_audit_doc "$id"; return
  fi
  _ws_collect_fork "$id" || :
  _ws_collect_audit_doc "$id"; rc=$?
  exec {lfd}>&-
  return "$rc"
}

_ws_collect_audit_doc() {   # id -> THE document on stdout, and the journal line of a TERMINAL word; rc 1 on
  #                             `unmeasured`, else 0
  local id="$1" leaf="$HOME/.cc-tmp/$1" exists=false wit=null recs='[' r first=1 newest=null entries=null
  local idleat=null probe=null cut
  [[ -n "$REAP_VERDICT" ]] \
    || _ws_collect_unmeasured eval "the evaluation of $id answered nothing" || :
  [[ -d "$leaf" && ! -L "$leaf" ]] && exists=true
  if [[ -n "$_WS_WIT_DEV" ]]; then
    wit=$(printf '{"dev":%s,"ino":%s,"btime":%s,"run":%s,"at":%s}' "$(_json_str "$_WS_WIT_DEV")" \
      "$(_json_str "$_WS_WIT_INO")" "$(_json_str "$_WS_WIT_BTIME")" "$(_json_str "$_WS_WIT_RUN")" "$(_json_str "$_WS_WIT_AT")")
  fi
  for r in ${_WS_COLLECT_RECORDS[@]+"${_WS_COLLECT_RECORDS[@]}"}; do
    (( first )) || recs+=','; first=0; recs+="$(_json_str "${r##*/}")"
  done
  recs+=']'
  [[ -z "$_WS_COLLECT_NEWEST_NS" ]] || newest=$(_json_str "$_WS_COLLECT_NEWEST_NS")
  [[ -z "$_WS_COLLECT_ENTRIES" ]] || entries="$_WS_COLLECT_ENTRIES"
  [[ -z "$_WS_COLLECT_IDLE_AT" ]] || idleat="$_WS_COLLECT_IDLE_AT"
  [[ -z "$_WS_COLLECT_PROBE" ]] || probe=$(_json_str "$_WS_COLLECT_PROBE")
  printf '{"session":%s,"mode":"collect","exists":%s,"collect":{"leaf":%s,"witness":%s,"records":%s,"newestCtimeNs":%s,"entries":%s,"floorS":%s,"idleAt":%s,"unmeasured":%s},' \
    "$(_json_str "$id")" "$exists" "$(_json_str "$leaf")" "$wit" "$recs" "$newest" "$entries" \
    "$(_ws_collect_floor_s)" "$idleat" "$probe"
  [[ -z "$_WS_COLLECT_PHASE" ]] || printf '"resume":%s,' "$(_json_str "$_WS_COLLECT_PHASE")"
  if [[ "$REAP_VERDICT" == collectable ]]; then
    printf '"verdict":%s,"detail":"","token":%s}\n' "$(_json_str "$REAP_VERDICT")" "$(_json_str "$REAP_TOKEN")"
    return 0
  fi
  printf '"verdict":%s,"detail":%s}\n' "$(_json_str "$REAP_VERDICT")" "$(_json_str "$REAP_DETAIL")"
  if [[ "$REAP_VERDICT" == unmeasured ]]; then
    echo "ccd: ws-audit --collect measured nothing ($_WS_COLLECT_PROBE): $REAP_DETAIL — retry" >&2
    return 1
  fi
  # A TERMINAL word is journaled, and only a terminal one: wave 9's lane audits
  # every pass, and a retryable word a pass would bury the journal.
  cut=$(_ws_leaf_why_line "$REAP_DETAIL")
  case "$REAP_VERDICT" in
    witness-mismatch)     _lc_emit collect refused "$id" "" verb ws-audit refusal witness-mismatch detail "$cut" ;;
    quarantine-kept)      _lc_emit collect refused "$id" "" verb ws-audit refusal quarantine-kept detail "$cut" ;;
    containment-unproven) _lc_emit collect refused "$id" "" verb ws-audit refusal containment-unproven detail "$cut" ;;
  esac
  return 0
}
# ── end ws-audit --collect ──────────────────────────────────────────────── WS-AUDIT-COLLECT-CLOSE ──
```

No line of this block may be written in a harvested shape. That rules out:
- `_reap_refuse <word>`;
- a literal `"refused":"<word>"`;
- a literal `"verdict":"<word>"`;
- `'!<word>`.

This holds in comments too. `ccd-wsaudit-nonpoison.test.ts` holds its counts (55 outside the cut regions, 67 in all) because of it, and this task's own source pin checks the block. It adds no `_reg_get` call and no `_plat_` helper.

- [ ] **Step 5: Declare the two TERMINAL words in L0 (the same commit as their journal sites)**

In `shared/api.ts`:
- **The union.** Find `LcRefusalToken`'s last member: `grep -n "^  | '[a-z-]*';" shared/api.ts` prints two lines. Use the one AFTER `export type LcRefusalToken =`; the other is `LifecycleAct`'s `'unknown';`. Delete that member's trailing `;` (keep its comment), and add directly below it:

```ts
  | 'witness-mismatch'        // ws-audit --collect and ws-collect (spec §5.10): the temp root at the id is not the real directory its witness names by dev, ino and birth time, or the witness cannot be read or has no birth time — TERMINAL, journaled `refused`: offered to the operator, never taken
  | 'quarantine-kept';        // ws-audit --collect and ws-collect (spec §5.10): a quarantine record, or its slot, is not as the collector left it — TERMINAL, journaled `refused`: kept as it stands, for the operator
```

- **The map.** Directly above the `};` that closes `LC_REFUSAL_WORD` (the first line `};` after `grep -n '^export const LC_REFUSAL_WORD' shared/api.ts`), add:

```ts
  // The temp-root collector (spec §5.10). Both TERMINAL, journaled `refused` by `ws-audit --collect` and, from its
  // own commit on, by `ws-collect`. Each says only what is true wherever it is printed: the audit removes nothing,
  // and the verb answers either word before it removes anything further.
  'witness-mismatch':
    'The temporary directory under this id is not the one ccrc recorded handing out — it was replaced or moved, or its record cannot be read or vouches for too little — so ccrc will never remove it on its own. Nothing was removed; it is listed for you to look at.',
  'quarantine-kept':
    'A temporary directory ccrc set aside to remove, or the record of it, is not as ccrc left it, so ccrc keeps both exactly as they stand and will not finish removing it on its own. Nothing further was removed; it is listed for you to look at.',
```

`not-witnessed`, `registered` and `not-idle` are NOT declared here (the departure `retryable-collect-words-declared-with-the-verb`). Each would red `ccd-refusal-scan.test.ts`'s "declared journal-only tokens with no literal ccd call-site argument" until Task 6 journals it.

- [ ] **Step 6: Re-stamp, run the tests to pass, and run the gates**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd; echo "mark rc=$?"                                                     # rc=0
git diff -U0 ccd/ccd | awk '/^@@/{split($2,o,",");split($3,n,",");s=substr(o[1],2)+0;oc=(o[2]==""?1:o[2]+0);nc=(n[2]==""?1:n[2]+0);
  if (s<19109 && oc!=nc) print "LINE COUNT CHANGED ABOVE 19109: " $0}'                                       # prints nothing
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-collect-audit.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-collect-audit-rungs.test.ts test/ccd-collect-audit-resume.test.ts)
(cd server && ./node_modules/.bin/vitest run test/lifecycle-refusal-word.test.ts test/ccd-refusal-scan.test.ts test/wsaudit.test.ts test/ccd-wsaudit-nonpoison.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pause.test.ts test/ccd-die-containment.test.ts test/child-reclaim-chip-source.test.ts test/ccd-lifecycle-contain.test.ts test/ccd-lifecycle-sites.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-audit.test.ts test/ccd-child-reclaim-audit.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/child-reclaim.test.ts)
(cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts -t 'carries no un-shimmed GNU call')
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts)
(cd server && ./node_modules/.bin/tsc --noEmit -p .)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored')
```

Expected:
- **The three new files pass in full.** Measured on a scratch copy of `b0647d850` carrying this task over stand-ins of Task 4's blocks: 30 cases in about 17 s, and 61 cases in about 30 s for the other two. Those stand-ins did not carry Task 4's `_WS_IDLE_LEAF` check or its derived slot, and the rulings have changed cases since: re-measure all three files against Task 4's REAL blocks and put those counts and times in the wave-done. On macOS every `describe.skipIf(!LINUX)` skips, and the platform, hand-off, declaration and source cases run.
- `ccd-refusal-scan` is green: the three literal `_lc_emit collect refused … refusal <word>` sites are owned by L0 or `SENTENCES`, both declared words have a site, and the new COLLECT case counts exactly three `verb ws-audit` emits.
- `ccd-wsaudit-nonpoison` is green WITH this task's edit (ruling G2): the COLLECT region is cut like the other three, its found-check passes, and the counts stay 55 and 67, because this block spells no harvested shape. `wsaudit` is green with no edit.
- `lifecycle-refusal-word` is green at the raised count. `ccd-child-reclaim-pause`, `ccd-die-containment`, both usage cases, `macos-platform`'s GNU scan (`find -printf` is not on its list, and no `stat -c` or `mv -T` is spelled here) and `typecheck-tests` are green.
- `tsc` prints nothing; `mark.mjs --check` exits 0; `ownership` is green.

**THE CITATION CASE.** The two union lines sit above README's one `shared/api.ts` sentence's map anchors. Find that sentence with `grep -n 'shared/api.ts:[0-9]' README.md`: on `b0647d850` it is README.md:4797, citing `:7873-7875`, `:7919`, `:7927` and `:7940`. The union anchors stay put, and the three map anchors each move down by the two lines added (and by Task 1's line). Repair them BY CONTENT, never by arithmetic:
- read the new lines with `grep -n "  | 'purge-refused' \|  | 'purge-incomplete' \|  | 'purge-mechanism-absent'\|^  'purge-refused':\|^  'purge-incomplete':\|^  'purge-mechanism-absent':" shared/api.ts`;
- re-point the README sentence at what that prints;
- re-run the citation case until it is green.

If anything other than README reds there, STOP and report: a frozen-corpus census is never adjusted here.
- [ ] **Step 6b: Measure the audit's worst case (ruling G9)**

The runner keys its budget on argv[0] (`server/src/remote/runner.ts:49`, `'ws-audit': 90_000`), so `ws-audit --collect` inherits the plain audit's 90 s. This step measures and states the worst case. It changes no runner row: a mode-keyed budget, if the figure needs one, is wave 9's, carried and not built here.

1. **The bounds, read from the tree.** The fresh path can spend these in sequence: the idle walk (`WS_COLLECT_IDLE_SCAN_S`, 60 s), the in-use probe (`WS_PATH_USERS_SCAN_S`, 10 s), the checkout scan (`REAP_SCAN_SECONDS`, 30 s), then the row pass. Print them:
   ```bash
   grep -n '^WS_COLLECT_IDLE_SCAN_S=\|^WS_PATH_USERS_SCAN_S=\|^REAP_SCAN_SECONDS=' ccd/ccd
   grep -n "'ws-audit':" server/src/remote/runner.ts
   ```
   On those bounds, the walk, the probe and the scan alone sum to 100 s, past the 90 s row, before the row pass is counted. State the sum.
2. **The real figure, on the largest fixture.** Add this case at the END of `ccd-collect-audit-rungs.test.ts`, run it alone, and record the line it prints. Then DELETE it before Step 8: `grep -c 'G9 MEASUREMENT' server/test/ccd-collect-audit-rungs.test.ts` must print 0.
   ```ts
   it.skipIf(!LINUX)('G9 MEASUREMENT (never committed)', () => {
     const { leaf } = makeOrphan(h);
     for (let d = 0; d < 100; d += 1) {
       const dir = path.join(leaf, 'cdk.out', `d${d}`);
       fs.mkdirSync(dir);
       for (let f = 0; f < 200; f += 1) fs.writeFileSync(path.join(dir, `f${f}`), '');
     }
     let t = Date.now();
     expect(verdictOf(collectAudit(h))).toBe('not-idle');                   // the REAL walk, over 20 103 entries
     const walkMs = Date.now() - t;
     t = Date.now();
     expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('collectable'); // every later probe real
     console.log(`G9: walk ${walkMs} ms; in-use + checkouts + rows + token ${Date.now() - t} ms`);
   }, 300_000);
   ```
   ```bash
   (cd server && ./node_modules/.bin/vitest run test/ccd-collect-audit-rungs.test.ts -t 'G9 MEASUREMENT')
   ```
3. **The wave-done states** both measured figures, the bound sum from (1), and whether either reaches 90 s. If the bound sum does (on the bounds above, it does), the wave-done says so in its own paragraph: a box whose walk runs to its bound would exceed the runner's budget, which the server reads as a failed audit and retries. Wave 9 carries the remedy (G9).

- [ ] **Step 7: Mutation check**

Make each mutation on its own, run the command, see the red, and revert it before the next. Unless stated, `COLLECT` is `(cd server && ./node_modules/.bin/vitest run test/ccd-collect-audit.test.ts)`, `RUNGS` is the same with `test/ccd-collect-audit-rungs.test.ts`, and `RESUME` is the same with `test/ccd-collect-audit-resume.test.ts`. Narrow each with `-t '<case title>'`. Every expected red below was measured on the scratch copy, except rows marked †: the coordinator's rulings of 2026-10-08 rewrote or added them, and they are NOT yet measured. Measure each, and record any red that differs.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | In the hand-off line, delete `; [[ $3 != --collect \|\| $# -ne 3 ]] \|\| { _ws_collect_audit "$2"; return; }` | COLLECT `-t 'a witnessed orphan past the idle floor'` | `ccd: usage: … \| --expire \| --collect]: expected 1 to be 0` |
| 2 | Replace the second `if (( ! inpop )); then` (the one before `_ws_collect_refuse not-witnessed`) with `if false; then` | COLLECT `-t 'no witness and no record'` | `a name ccd never handed a temp root gets no lock: expected true to be false` |
| 3 | Replace `[[ -e "$w" \|\| -L "$w" ]] && inpop=1` with `inpop=1` | same | same red |
| 4 | Replace the first `if (( ! inpop )); then` (the records lookup) with `if false; then` | COLLECT `-t 'the record lookup is EXACT'` | `expected [] to deeply equal [ 'demo-quiet-mesa.7.1790000000000000000.4242' ]` |
| 5 | Replace `if [[ -L "$REG/tmproots" ]]; then` with `if false; then` | COLLECT `-t 'tmproots/ that is itself a link'` | `expected +0 to be 1` (the witness reader answers 2, so `witness-mismatch` at exit 0, and a lock is taken) |
| 6 | Replace `if ! flock -n "$lfd"; then` with `if false; then` | COLLECT `-t 'another holder'` | `expected 'collectable' to be 'in-progress'` |
| 7 | In `_ws_collect_audit_contained`, replace `if [[ "$CCD_OS" == darwin ]]; then` with `if false; then` | COLLECT `-t 'answers before it reads the population'` | `expected +0 to be 1` (a foreign name reads `not-witnessed`) |
| 8 | Replace `_ws_collect_mv_ok \|\| {` with `true \|\| {` | COLLECT `-t 'a box whose mv has no'` | `expected +0 to be 1` |
| 9 | In `_ws_collect_audit_doc`, change the `return 1` after the `measured nothing` echo to `return 0` | COLLECT `-t 'the idle walk answers'` | `expected +0 to be 1`, in all four rows |
| 10 | Delete the `witness-mismatch)` arm of the journal `case` | COLLECT `-t 'witness-mismatch is journaled'` | `expected [] to deeply equal [ { act: 'collect', token: 'witness-mismatch' } ]` |
| 11 | Widen the `containment-unproven)` pattern to `containment-unproven\|not-idle\|in-use\|registered\|paused)` | COLLECT `-t 'is journaled nowhere'` | `expected [ { v: 1, … } ] to deeply equal []`, in three rows |
| 12 | Replace `cut=$(_ws_leaf_why_line "$REAP_DETAIL")` with `cut="$REAP_DETAIL"` | COLLECT `-t 'ONE line cut at 300'` | `expected 'xxxx…' not to contain '\n'` |
| 13 | Replace `REAP_TOKEN=$(_ws_collect_token "$id")` with `REAP_TOKEN=$(_ws_reclaim_fingerprint mode=collect "id=$id")` | COLLECT `-t 'the token moves with each fact'` | `the newest change: expected '<t0>' not to be '<t0>'` |
| 14 | In `_ws_collect_audit_contained`, replace `_ws_collect_fork "$id" \|\| :` with `_ws_collect_reset; _ws_collect_eval "$id" \|\| :` | RESUME `-t 'unmoved: the record stands'` | `expected 1 to be 0`: the fresh path walks, and the `NO_WALK` stub answers unmeasured |
| 15 | In `_ws_collect_registered`, replace `if [[ -e "$REG/$id.$f" \|\| -L "$REG/$id.$f" ]]; then` with `if false; then` | RUNGS `-t 'searched but not listed'` | `a direct lookup needs no listing: expected 'unmeasured' to be 'registered'` |
| 16 | Replace `[[ ${#ctl[@]} -eq 1 && "${ctl[0]}" == "$REG/.reap-$id.lock" ]] \` with `true \` | same | `expected +0 to be 1`: `_ws_slug_free` answers free over the unlistable `$REG`, and the leaf is collectable. Where Task 4's row rule itself answers unmeasured over an unlistable `$REG`, the red reads `expected 'rows' to be 'registry'` |
| 17 | Replace `ctl=("$REG/.reap-$id".lo[c]k)` with `ctl=("$REG/.reap-$id.lock")` (no wildcard: no listing) | same | same red as 16 |
| 18 | Replace `[[ "$_WS_WIT_BTIME" != - ]] \` with `true \` | RUNGS `-t 'no birth time is never taken'` | `expected 'collectable' to be 'witness-mismatch'`, or `expected 'unmeasured' …` if Task 4's token refuses a `-` birth time |
| 19 | Replace the fresh eval's `[[ -d "$leaf" && ! -L "$leaf" ]] \` with `true \` | RUNGS `-t 'a link at the id'` | `expected '<leaf> is <d:i> born …' to contain 'is a link or not a directory'`. The identity compare still refuses, so this red is on the reason: defence in depth |
| 20 † | Replace the fresh eval's `(( rc == 0 )) \` (the one followed by `\|\| { _ws_collect_refuse witness-mismatch "$leaf is`) with `true \` | RUNGS `-t 'a directory of another inode'` | `expected 'collectable' to be 'witness-mismatch'` |
| 21 | Replace `if (( rc == 0 )); then` (directly above `# A WITNESS WITH NO LEAF`) with `if false; then` | RUNGS `-t 'exists false, no walk'` | `expected { … verdict: 'witness-mismatch' … } to match object { exists: false, verdict: 'collectable' }` |
| 22 † | In the fresh eval, replace `(( rc != 1 )) \|\| { _ws_collect_refuse not-idle` with `true \|\| { _ws_collect_refuse not-idle` | RUNGS `-t 'a fresh leaf, through the REAL walk'` | `expected 'collectable' to be 'not-idle'` |
| 23 † | In Task 4's `_ws_collect_floor_s` (the one definition, ruling G4), replace `(( 10#$o > b ))` with `(( 10#$o >= 0 ))` | RUNGS `-t 'never LOWERS'` | `expected 'collectable' to be 'not-idle'` (rows `'60'` and `'0'`) |
| 24 | In the fresh eval, replace `(( rc != 1 )) \|\| { _ws_collect_refuse in-use "a process of this uid still uses $leaf` with `true \|\| { _ws_collect_refuse in-use "a process of this uid still uses $leaf` | RUNGS `-t 'a process whose cwd is in the leaf'` | `expected 'collectable' to be 'in-use'` |
| 25 | In the fresh eval, delete `(( rc != 2 )) \|\| { _ws_collect_unmeasured in-use "${_WS_PATH_USERS_WHY-}"; return 1; }` | RUNGS `-t 'never "nobody"'` | `expected +0 to be 1` (rc 2 passes `(( rc != 1 ))`, and the leaf is collectable) |
| 26 | In the fresh eval, delete `(( rc != 1 )) \|\| { _ws_collect_refuse containment-unproven "${_WS_CHECKOUTS_WHY-}"; return 1; }` | RUNGS `-t 'whose admin directory is gone'` | `expected 'collectable' to be 'containment-unproven'` |
| 27 | In the fresh eval, delete `(( rc != 1 )) \|\| { _ws_collect_refuse containment-unproven "${_WS_COLLECT_ROWS_WHY-}"; return 1; }` | RUNGS `-t 'stopped session'` | `expected 'collectable' to be 'containment-unproven'` |
| 28 | Replace `_ws_collect_rows_clear "$id" "$leaf"; rc=$?` with `_ws_collect_rows_clear "$id" "$HOME/.cc-clips/$id"; rc=$?` | RUNGS `-t 'asked of the id and of the leaf'` | `expected 'demo-quiet-mesa\|…/.cc-clips/demo-quiet-mesa' to be 'demo-quiet-mesa\|…/.cc-tmp/demo-quiet-mesa'` |
| 29 | Delete the fresh eval's `_ws_collect_paused \|\| return 1` directly above `REAP_TOKEN=$(_ws_collect_token` | RUNGS `-t 'the kill-switch'` | `expected 'collectable' to be 'paused'` |
| 30 | In `_ws_collect_paused`, replace `[[ ! -e "$REG/reclaim-paused" && ! -L "$REG/reclaim-paused" ]] \` with `[[ ! -e "$REG/reclaim-paused" ]] \` | RUNGS `-t 'dangling link'`, and `(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pause.test.ts)` | `expected 'collectable' to be 'paused'`, and `_ws_collect_paused does not read $REG/reclaim-paused` |
| 31 | Replace `_WS_COLLECT_LEAF=present` with `_WS_COLLECT_LEAF=present; _ws_collect_paused \|\| return 1` (the pause asked first) | RUNGS `-t 'containment outranks the pause'` | `expected 'paused' to be 'containment-unproven'` |
| 32 | In `_ws_collect_resume_eval`, insert `_ws_collect_idle "$orig" >/dev/null \|\| :` directly under `shift` | RESUME `-t 'unmoved: the record stands'` | `a resume never walks the tree: expected true to be false` |
| 33 † | Replace `(( $# == 1 )) \` with `true \` | RESUME `-t 'two records of one id'` | `expected 'collectable' to be 'quarantine-kept'`: the first record, `….1.2`, reads clean, its derived slot is empty and the leaf stands at the id, so it resumes `unmoved` |
| 34–35 | Retired by ruling G5: the record carries no `slot=`, so its slot is derived from its name and cannot disagree with it. The two cases they reddened are deleted | — | — |
| 36 | Replace `[[ -z "$ents" \|\| "$ents" == leaf/ ]] \` with `true \` | RESUME `-t 'a slot holding what'` | `expected 'collectable' to be 'quarantine-kept'` |
| 37 | Replace `if [[ -L "$sleaf" ]] \|\| { [[ -e "$sleaf" ]] && [[ ! -d "$sleaf" ]]; }; then` with `if false; then` | RESUME `-t 'a slot whose leaf is a link'` | `expected '<slot>/leaf is <d:i> born …' to contain 'is a link or not a directory'`. The identity compare still keeps it: defence in depth |
| 38 † | Replace the slot leaf's `(( rc == 0 )) \` (the one followed by `\|\| { _ws_collect_refuse quarantine-kept "$sleaf is`) with `true \` | RESUME `-t 'no longer matches its record'` | `expected 'the directory record … stands both in …' to contain 'its record names'` |
| 39 | Replace `_ws_path_users "$orig"; rc=$?` with `rc=0` | RESUME `-t 'PRE-MOVE spelling: in-use'` | `expected { … verdict: 'collectable' … } to match object { resume: 'moved', verdict: 'in-use' }` |
| 40 | Replace `_ws_path_users "$sleaf"; rc=$?` with `rc=0` | RESUME `-t 'cwd is in the slot leaf'` | `expected 'collectable' to be 'in-use'` |
| 41 | Replace `_ws_collect_rows_clear "$id" "$orig"; rc=$?` with `_ws_collect_rows_clear "$id" "$sleaf"; rc=$?` | RESUME `-t 'asked of the PRE-MOVE spelling'` | `expected 'demo-quiet-mesa\|…/slot.…/leaf' to be 'demo-quiet-mesa\|…/.cc-tmp/demo-quiet-mesa'` |
| 42 | In the resume fingerprint, delete `"phase=$phase" ` | RESUME `-t 'binds the phase'` | `expected 2 to be 3` |
| 43 | Replace `if [[ -L "$q" ]] \|\| { [[ -e "$q" ]] && { [[ ! -d "$q" ]] \|\| [[ ! -O "$q" ]]; }; }; then` with `if false; then` | RESUME `-t 'quarantine directory that is a link'` | `expected +0 to be 1` |
| 44 | In `_ws_collect_resume_eval`, delete its three `_ws_collect_registered` lines (now below the phase `case`) | RESUME `-t 'recycled spawn’s marker'` | `expected 'collectable' to be 'registered'` |
| 45 | Delete the resume eval's `_ws_collect_paused \|\| return 1` | RESUME `-t 'the pause holds a resume'` | `expected { … verdict: 'collectable' … } to match object { resume: 'moved', verdict: 'paused' }` |
| 46 | Remove `'quarantine-kept'` from the union, the map and `ALL_TOKENS` (lower the count by one) | `(cd server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts)` | `tokens no vocabulary owns: expected [ 'quarantine-kept' ] to deeply equal []` |
| 47 † | In `_ws_collect_paused`, append ` \|\| _reap_refuse paused "x"` to its last line | COLLECT `-t 'spells no word in a shape'` | `expected [ '…_reap_refuse paused "x"…' ] to deeply equal []`. `ccd-wsaudit-nonpoison` stays green: this task cuts the COLLECT region out of its 55 (ruling G2), and `paused` is already among its 67 |
| 48 † | In the fresh eval, delete `(( rc != 2 )) \|\| { _ws_collect_unmeasured clock "this box's clock could not be read, so how long $leaf has been idle is unknown"; return 1; }` | RUNGS `-t 'a clock that cannot be read'` | `expected +0 to be 1`: rc 2 passes the not-idle test, and the leaf is collectable |
| 49 † | In `_ws_collect_resume_eval`, replace `    leaf:absent) phase=moved ;;` with `    leaf:*)      phase=moved ;;` | RESUME `-t 'a path retaken since the move'` | `expected { … verdict: 'registered' … } to match object { verdict: 'quarantine-kept' }` |
| 50 † | In `_ws_collect_resume_eval`, move its three `_ws_collect_registered` lines back to directly under `shift` | same | same red: the retake's own `.child` answers the retryable `registered` first |
| 51 † | In `_ws_collect_audit_doc`'s journal `case`, add the arm `in-use) _lc_emit collect refused "$id" "" verb ws-audit refusal in-use detail "$cut" ;;` | `(cd server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts -t 'collector audit')` | `expected [ …(4) ] to have a length of 3 but got 4` |

**Five arms have no red of their own, each stated:**
- `[[ "$id" == *-* ]]`: every collector id is `<project>-<slug>`.
- The `leaf:match` arm: one directory cannot stand at two paths. Row 38 reaches it only through a mutation.
- The `_ws_collect_ident` failure arms: a stat of a directory just tested fails only on a race.
- The fresh eval's `not-witnessed` arm: a witness dropped between the population check and the lock. Measured: rewriting its word leaves every case green.
- The original path's absence probe answering 2 in the resume (`_ws_collect_unmeasured leaf`): an unreadable `~/.cc-tmp` fails the record's own derived slot first (not measured).

Revert every mutation, re-stamp (`bash ccd/ccrc restamp ccd/ccd`, `node shared/mark.mjs --check ccd/ccd`, then `ownership.test.ts`), and re-run Step 6 green.

- [ ] **Step 8: Commit**

```bash
git add ccd/ccd shared/api.ts server/test/collectFixture.ts server/test/ccd-collect-audit.test.ts \
  server/test/ccd-collect-audit-rungs.test.ts server/test/ccd-collect-audit-resume.test.ts \
  server/test/lifecycle-refusal-word.test.ts server/test/ccd-child-reclaim-pause.test.ts \
  server/test/ccd-die-containment.test.ts server/test/ccd-ws-expire-audit.test.ts server/test/ccd-child-reclaim-audit.test.ts \
  server/test/ccd-wsaudit-nonpoison.test.ts server/test/ccd-refusal-scan.test.ts
git add README.md   # only if Step 6 re-pointed its shared/api.ts anchors
git commit -m "$(cat <<'MSG'
feat(ccd): ws-audit --collect, the temp-root collector's audit

ws-audit --session <id> --collect says whether a witnessed temp root can
be collected, and mints the token ws-collect will spend. It audits only
an id with a witness or a quarantine record, found by exact parse, so it
never takes a lock for a foreign name. Inside the reap lock it asks, in
order: a registry row (by direct lookup, and by a slug check believed
only when a wildcard listing shows the lock it holds), the witness's
dev, ino and birth time, the idle floor on ctime alone, the in-use
probe, the checkout question and the row rule, then the pause. A
standing quarantine record makes it a resume, read off the disk and
never walked; a slotted leaf whose original path was retaken is
quarantine-kept, asked before the registry. Unmeasured exits 1 and is
journaled nowhere; a terminal refusal is journaled under act collect,
verb ws-audit. witness-mismatch and quarantine-kept are declared with
their journal sites, and the refusal scans are taught the COLLECT region.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: `ws-collect`, the destructive verb — quarantine by rename, re-prove, remove, and the record's order

**Model routing:** **`opus`, effort `high`**. This is wave 7's ONE destructive subject and its SAFETY panel's full subject (with Tasks 4, 5 and 8). Every line of the ccd block below decides what a server-composed verb deletes on the fleet box.

**Why:**
- **What it is.** The temp-root collector's destructive verb, exactly as the binding rulings rule it: the consent re-proved inside `$REG/.reap-<id>.lock`, an lstat of the leaf, the checkout question of the ORIGINAL path, the quarantine RECORD written before anything moves, an exclusive slot, ONE `renameat2(RENAME_NOREPLACE)` into it proven by lstat (Task 4's `_ws_collect_move`, ruling G3), the re-proofs after the move (any doubt moves the leaf back, proven, or KEEPS the record and the slot), the removal through the ONE removal helper with the alias, and then the order: the slot's leaf proven gone, the EMPTY slot rmdir'd, the witness compared and dropped, the witness writer's dead temp files reaped, the record dropped LAST. A record left by a run that died is the resume authority, and the resume never recomputes the tree token or the idle floor. A witness whose leaf the evaluation PROVED absent, with no record standing, is collected by comparing and dropping the witness alone: nothing is moved or removed (Task 5's accepted DEP3).
- **The hazard it closes (measured at `b0647d850`).** `_child_tmpdir` (`ccd/ccd:20733`, `grep -n '^_child_tmpdir() {' ccd/ccd`) reads `.child` (`:20735`) and then runs `mkdir -p` (`:20738`, `grep -nF 'mkdir -p -m 0700 -- "$root" "$dir"' ccd/ccd`), which ADOPTS whatever leaf stands at `~/.cc-tmp/<id>`. Its one call site is `_spawn_start` (`:21221`, `grep -nF 'ctmp=$(_child_tmpdir "$id")' ccd/ccd`), and nothing on a live child's spawn path takes the reap lock (`_ws_expire_spawn_gate` locks only an archived row, `:31142-31169`). So a check-then-`rm` collector could delete a temp root a recycled-slug spawn had just been handed. With the rename: a spawn before the move has `.child` standing, which step 5's DIRECT lookup sees whether or not `$REG` can be listed; a spawn after the move gets a new inode from `mkdir -p`; step 6 removes only the slot's inode, dev:ino-checked.
- **Measured facts this task builds on** (the pre-flight's and the attackers', re-read here):
  - `mv -T -n --no-copy` (GNU coreutils 9.4) is one `renameat2(…, RENAME_NOREPLACE)`. It refuses an existing destination (an EMPTY directory included) with rc 1, and moves a regular FILE onto an absent path with rc 0 — so the move is never proven by its exit code, and a file that slips in is never unlinked. Across mounts it answers EXDEV and copies nothing; without `--no-copy` it copies and leaves the copy.
  - A rename keeps the leaf's ino, nanosecond btime and mtime, and STAMPS its ctime: neither the idle floor nor the tree token is asked after the move.
  - `_ws_slug_free` (`:6526`, `grep -n '^_ws_slug_free() {' ccd/ccd`) answers FREE over a standing `.child` when `$REG` is searchable but not listable (mode 0300). A WILDCARDED listing of the held `.reap-<id>.lock` finds nothing at 0300 and finds it at 0700; a literal name is only stat'ed. Task 5's `_ws_collect_registered`, which this task asks inside the lock, therefore looks `.child` and `.uuid` up DIRECTLY and believes `_ws_slug_free` only when a wildcard listing shows the lock it holds.
  - Ids admit dots (`_ws_tmproot_id_ok`, `:20812`), so `<id>.*` reaches a nested id's files; the witness writer's temp file is `tmproots/.<id>.<BASHPID>.<RANDOM>.tmp` (`:20869`, `grep -nF '.$id.$BASHPID.$RANDOM.tmp' ccd/ccd`).
  - `_ws_tmproot_witness_drop` (`:29460`) is a plain `rm -f` of the live name, which races the writer's unlocked temp-file-then-`mv -f`. This task never calls it: the witness is compared and dropped by a move aside.
  - `/proc/<pid>/cwd` follows an ancestor's rename, so the in-use probe's cwd and fd arms see users inside the moved tree; its TMPDIR arm is a string test of the pre-move path.
- **What this task is NOT.** The evaluation and `ws-audit --collect` are Task 5's: `_ws_collect_fork`, consumed here as the ONE evaluation both the audit and this verb run (a standing record resumes, else the fresh rungs; the `_ws_expire_fork` precedent, `ccd/ccd:30909`), and with it the registry question (`_ws_collect_registered`) and the pause reader (`_ws_collect_paused`). The record, the quarantine directory, the slot, the ONE move and its lstat identity (`_ws_collect_move`, `_ws_collect_mv`, `_ws_collect_mv_ok`, `_ws_collect_ident`: ruling G3), the idle walk, the floor, the token, the row rule and the alias are Task 4's, and so is the `collect` act (ruling G1). The dispatcher arm, `ccd caps`, the entry guard, `is_protected`, the agent grant, `COLLECT_CAP` and the runner budget are Task 7's: every case here calls the SOURCED `cmd_ws_collect`, so nothing below needs them. The race-and-crash matrix is Task 8's; this task ships the seams it drives (`_ws_collect_gap`, `_ws_collect_mountinfo`: the canonical seams, ruling G7, so Task 8's Step 10 is skipped) and one case per arm.
- **Mirrored, not edited:** `cmd_ws_expire` (`ccd/ccd:30940`, `grep -n '^cmd_ws_expire() {' ccd/ccd`) for the argv, the reap lock and the flock decline; `_ws_expire_locked` (`:31003`) for the verdict point. Neither is touched (workspace-lifecycle's region). Nothing is edited above the frozen citation boundary, and no `_reg_get` call is added (`.child` and `.uuid` are asked by `_ws_collect_registered`'s direct lookup).

**Files:**
- Modify: `ccd/ccd` — ONE contiguous block, far below the frozen citation boundary, inside the COLLECT region Task 4 opened: below Task 5's `ws-audit --collect` block and directly above the region's end marker (Step 4 says where).
- Modify: `shared/api.ts` — `LcRefusalToken` and `LC_REFUSAL_WORD` gain `not-witnessed`, `registered` and `not-idle`, declared in the commit of their first journal sites (ruling G2).
- Modify: `server/test/lifecycle-refusal-word.test.ts` — `ALL_TOKENS` gains the three words; its count rises 21 -> 24.
- Modify: `README.md`, only if Step 5's citation case reds on it: its `shared/api.ts:` anchors are re-pointed BY CONTENT (Step 4b).
- Modify: `server/test/ccd-refusal-scan.test.ts` — the seventh destructive verb, its two sanctioned dies, its emit count, its die-free locked functions, and the COLLECT region's two literal refusal positions in the cross-language harvest (ruling G2).
- Not modified: `server/test/macos-platform.test.ts` — Task 4 exempts `_ws_collect_mv` by name and pins it (ruling G3); this task spells no `mv -T` of its own.
- Create: `server/test/wsCollectFixture.ts` (Task 5's fixture is `collectFixture.ts`; do not merge them — `COL_ID`, `makeOrphan`, `collectAudit`, `leafOf`, `witnessOf`, `recordsDir`, `quarantineOf` differ).
- Create: `server/test/ccd-ws-collect-verb.test.ts`, `server/test/ccd-ws-collect-move.test.ts`, `server/test/ccd-ws-collect-reprove.test.ts`, `server/test/ccd-ws-collect-order.test.ts`, `server/test/ccd-ws-collect-resume.test.ts` (five files: the 600 s foreground ceiling).

**Interfaces:**
- Consumes (Task 4, the canonical names):
  - `_ws_collect_record_write <id> <slot> <token>` — writes `$(_ws_collect_qrec_dir)/<name>` (`$REG/tmpquarantine/<name>`), where `<name>` is the slot's basename without its `slot.` prefix (`<id>.<ns>.<pid>`), from the witness fields the current shell holds (`_WS_WIT_DEV _WS_WIT_INO _WS_WIT_BTIME _WS_WIT_RUN _WS_WIT_AT`) and `_WS_CHECKOUTS_ACCEPTED`; rc 0 written and read back, 1 not (`_WS_QREC_WHY`). The body carries no `slot=` field (ruling G5).
  - `_ws_collect_record_read <file>` → rc 0 with `_WS_QREC_ID _WS_QREC_SLOT _WS_QREC_DEV _WS_QREC_INO _WS_QREC_BTIME _WS_QREC_RUN _WS_QREC_AT _WS_QREC_TOKEN _WS_QREC_CHECKOUTS`, the slot DERIVED from the record's NAME and the physical quarantine (`<physical ~/.cc-tmp>/.ccd-quarantine/slot.<name>`); 1 absent; 2 malformed, including a body whose `id=` is not the id its name parses to (ruling G5).
  - `_ws_collect_qrec_dir` (prints `$REG/tmpquarantine`); `_ws_collect_records_of <id>` (exact parse, one path per line); `_ws_collect_record_drop <file>` (rc 0 only when the record is proven gone).
  - `_ws_collect_rows_clear <id> <leafpath>` → 0 / 1 (`_WS_COLLECT_ROWS_WHY`) / 2 — asked here AFTER the move, of the LOGICAL pre-move spelling `"$HOME/.cc-tmp/$id"` (the one `_child_tmpdir` hands out), while nothing stands there, always under `_ws_reclaim_contained` (ruling G10). It compares that spelling LITERALLY even when nothing stands there (ruling G6, pinned by Task 4's 4D case "AFTER the move … still refuses"); the step-5 case "is asked AFTER the move…" pins the call, "the real rule" case the answer.
  - The quarantine directory: `_ws_collect_qdir` → rc 0 with `_WS_Q` = `<physical ~/.cc-tmp>/.ccd-quarantine` (made `mkdir -m 0700` when PROVEN absent; else a real directory, not a link, this uid, 0700), rc 2 with `_WS_Q_WHY`.
  - The slot: `_ws_collect_slot_path <q> <id>` → rc 0 with `_WS_SLOT` = `<q>/slot.<id>.<ns>.<pid>` (named, not made) | 2; `_ws_collect_slot_make <slot>` → 0 made by this call (exclusive `mkdir -m 0700`) | 1 the name stands, never reused | 2 (`_WS_SLOT_WHY`). The record is written first, then the slot is made.
  - The move (ruling G3): `_ws_collect_move <src> <dst> <dev:ino> <btime>` → 0 PROVEN moved (dst is that directory AND src proven absent) | 1 PROVEN not moved (src is still it: EXDEV under `--no-copy` and a NOREPLACE refusal land here) | 2 unmeasured (`_WS_MOVE_WHY`); the restore is the same call reversed, with the RECORD's identity. `_ws_collect_mv <src> <dst>` is the ONE function `macos-platform.test.ts` exempts by name; compare-and-drop's aside calls it directly. `_ws_collect_mv_ok` → 0 when `mv --help` lists `--no-copy`; 1 on Darwin or without it (no why global: the caller words its own detail).
  - Identity: `_ws_collect_ident <path> <dev:ino> <btime>` → 0 a real directory (lstat, never followed) with exactly that dev:ino and birth time | 1 anything else, or nothing | 2 could not be read.
  - The alias (ruling G8): `_ws_leaf_remove <root> <id> [<expect-devino> [<alias> <accepted>]]` — the alias is the leaf's PHYSICAL pre-move spelling, the accepted list the record's `_WS_QREC_CHECKOUTS` — and `_ws_leaf_checkouts` leaving its accepted pairs in `_WS_CHECKOUTS_ACCEPTED`, where `_ws_collect_record_write` reads them (E4).
  - The floor's one test-only seam (ruling G4): `_ws_collect_floor_s`, redefined in a sourced harness (`_ws_collect_floor_s() { echo 0; };`); the production knob only raises the floor (E6).
  - The `collect` act, declared by Task 4's first part (ruling G1): ccd's `_LC_ACTS` and L0's `LifecycleAct`/`LIFECYCLE_ACT_MAP`.
- Consumes (Task 5): `_ws_collect_fork <id>` — the ONE evaluation `ws-audit --collect` runs, run here inside the reap lock: a standing record goes to `_ws_collect_resume_eval`, else to `_ws_collect_eval` (the FRESH rungs only). It sets `REAP_VERDICT` (`collectable`, a refusal word, or `unmeasured`), `REAP_TOKEN` (the tree token on a fresh arm, a `mode=collect-absent` token on a witness whose leaf is PROVEN absent, the resume token on a record), `REAP_DETAIL`, `_WS_COLLECT_LEAF` (`present` | `absent` on a fresh arm, `''` on a resume), `_WS_COLLECT_RECORD` (the record it resumes, `''` on a fresh arm), `_WS_COLLECT_PHASE` (`unmoved` | `moved` | `removed` on a resume) and `_WS_COLLECT_SLOT`, and leaves `_WS_WIT_*` (fresh) or `_WS_QREC_*` (resume) in the CURRENT shell. `_ws_collect_registered <id>` → 0 free | 1 a row stands | 2 unmeasured (`_WS_COLLECT_REG_WHY`): `.child` and `.uuid` by DIRECT lookup, then `_ws_slug_free` believed only when the wildcard `"$REG/.reap-$id".lo[c]k` lists the held lock; the caller holds the lock. `_ws_collect_paused` → 0 | 1 with `REAP_VERDICT=paused` and `REAP_DETAIL` set. `cmd_ws_audit --session <id> --collect` prints `{"verdict":"collectable",…,"token":…}` (on a record, a resume token) and `quarantine-kept` for a slot whose leaf is not its record's. Task 5 declares `witness-mismatch` and `quarantine-kept` (ruling G2). This task's refusal point keeps its name `_ws_collect_refused`, one letter from Task 5's `_ws_collect_refuse`: every regex that reads either requires `\s` right after the name (Step 2 (h) does).
- Consumes (Task 2): `_WS_RCL_CRUMB`, read by `_ws_reclaim_failed_json` (`''` omits the key; `cmd_ws_collect` shadows it to `''`, which Task 2's comment above `_WS_RCL_CRUMB=''` names); `_ws_leaf_why_line` as the 300-byte cutter.
- Consumes (shipped, at `b0647d850`): `_ws_reclaim_fail id lctx token detail` (`:28658`, journals `_lc_fail "$_WS_RCL_ACT" … verb "ws-$_WS_RCL_ACT"`), `_ws_reclaim_failed_json` (`:28620`), `_ws_reclaim_absent` (`:26646`), `_ws_path_users` (`:28842`), `_ws_leaf_checkouts` (`:29213`), `_ws_leaf_remove` (`:29276`), `_ws_leaf_read_small` (`:29129`), `_ws_leaf_why_line` (`:29473`), `_ws_tmproot_witness_file`/`_id_ok`/`_read`/`_write` (`:20808`–`:20864`), `_plat_mtime` (stat WITHOUT `-L`: an lstat), `_lc_emit`/`_lc_intent`/`_lc_done`/`_lc_refuse`/`_lc_tx`/`_lc_surface_norm`/`_lc_dec_ok`, `_json_str`, `_ws_reclaim_contained` (`:27346`).
- Produces (ccd):
  ```bash
  cmd_ws_collect --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]
  #   stdout ONE JSON line: {"collected":<id>,"record":<name>,"resumed":<bool>,"witness":"dropped|kept|absent"} exit 0
  #                       | {"collected":<id>,"record":null,"resumed":false,"witness":"dropped|kept|absent"} exit 0
  #                         (the witness-only arm: a witness whose leaf is PROVEN absent, no record)
  #                       | {"refused":<word>,"detail":…,"paths":[]} exit 0 | {"failed":<word>,"detail":…} exit 1
  #   the usage, id, token and python3 dies exit 1 with nothing on stdout and journal nothing
  _ws_collect_locked token id surface actor reason      # everything the reap lock serialises
  _ws_collect_fresh id q orig lctx surface actor reason # steps 2–4, then the rest
  _ws_collect_resume id rec q orig lctx surface actor reason   # branches on Task 5's _WS_COLLECT_PHASE
  _ws_collect_witness_only id surface actor reason      # compare-and-drop alone: nothing moves, nothing is removed
  _ws_collect_after_move id rec orig lctx resumed surface actor reason   # steps 5 and 6
  _ws_collect_finish id rec slot lctx resumed           # the order from the leaf's absence to the record's drop
  _ws_collect_mountinfo                                 # SEAM: prints the mount table's PATH (/proc/self/mountinfo)
  _ws_collect_mounts_clear dir                          # 0 none at/under dir | 1 one is | 2 unmeasured (_WS_MOUNTS_WHY)
  _ws_collect_reprove id slotleaf dev:ino btime         # 0 | 1 (_WS_REPROVE_WORD, _WS_REPROVE_WHY) | 2 (_WS_REPROVE_WHY)
  _ws_collect_unwind slot rec                           # 0 slot rmdir'd EMPTY (where it stood) and record dropped | 1
  _ws_collect_keep id rec lctx why                      # prints and journals failed quarantine-kept; rc 1
  _ws_collect_putback id slot rec orig lctx why surface actor reason
  #                                                     # 0 restored (Task 4's move reversed, the RECORD's identity)
  #                                                     #   and unwound | 2 the original path was retaken: refused
  #                                                     #   quarantine-kept printed (TERMINAL) | 1 kept: failed printed
  _ws_collect_witness_cad id dev ino btime run at       # 0 with _WS_CAD=dropped|kept|absent | 2 (_WS_CAD_WHY)
  _ws_collect_reap_temps id                             # always 0; _WS_COLLECT_TEMPS_REMOVED
  _ws_collect_refused id tx word detail surface actor reason   # the ONE refusal emit past the flock decline; rc 0
  _ws_collect_gap point id [slot]                       # SEAM, a no-op; points: locked consented recorded slotted
                                                        #   moved proven restoring removed emptied witnessed dropped
  ```
  - Journal (act `collect`, verb `ws-collect`, best-effort, never gating): `intent` before the move (or as a resume or the witness-only arm starts acting; `meas.resumed` = the record's name on a resume), `done` after the record's drop (after the witness's, on the witness-only arm), `refused` (every refusal, at the one refusal point, ruling G11: the verdict point with no tx; with the intent's tx, a refusal after a PROVEN restore, and what is KEPT terminally — anything not the witnessed leaf that reached a slot, or an original path retaken since the move, rulings T8 OPEN5 and OPEN4; the flock decline), `failed` (`probe-unmeasured`, including after a PROVEN restore of an unmeasured doubt, ruling T6 OPEN8; `quarantine-kept` whenever a record stays that a later pass can finish from, ruling T6 OPEN7). No `meas.` key is added; every `detail` that carries another function's reason (a session-chosen name, a line of stderr) is cut by `_ws_leaf_why_line` first.
- Produces (L0, ruling G2): `not-witnessed`, `registered` and `not-idle` in `LcRefusalToken` and `LC_REFUSAL_WORD`, each with a sentence true under any server, and `ALL_TOKENS` 21 -> 24 — declared in this commit because this commit journals them first.
- Produces (tests): `wsCollectFixture.ts` — `COL_ID`, `COL_RUN`, `WRONG_TOKEN`, `IDLE_FLOOR_SEAM`, `GAP_LOG`, `gapAt`, `crashAt`, `evalSays`, `PROBE_STUB`, `ROWS_STUB`, `ROWS_CLEAR`, `MOUNTS_SEAM`, `realMounts`, `makeOrphan`, `collectAudit`, `collectToken`, `collectVerb`, `docOf`, and the path helpers. Task 8 has its own fixture (`collectRaceFixture.ts`); the two are never merged.

**Entry conditions, checked before Step 1 from the repository root** (line numbers in this task are hints at `b0647d850`; Tasks 1–5 move them, so locate code by the grep beside each):

```bash
grep -c '^_ws_collect_record_write() {\|^_ws_collect_record_read() {\|^_ws_collect_records_of() {\|^_ws_collect_record_drop() {\|^_ws_collect_rows_clear() {\|^_ws_collect_idle() {\|^_ws_collect_token() {' ccd/ccd
                                                         # (E1) 7: Task 4's building blocks landed
grep -c '^_ws_collect_qrec_dir() {\|^_ws_collect_slot_path() {\|^_ws_collect_slot_make() {\|^_ws_collect_move() {\|^_ws_collect_mv() {\|^_ws_collect_mv_ok() {\|^_ws_collect_ident() {' ccd/ccd
                                                         # (E1b) 7: Task 4's records directory, slot, move and identity
grep -c '^_ws_collect_ident() {' ccd/ccd                 # (E1c) 1: ONE definition, Task 4's three-argument form
grep -n '^_ws_collect_fork() {\|^_ws_collect_registered() {\|^_ws_collect_paused() {' ccd/ccd
                                                         # (E2) three lines: Task 5's evaluation, registry question and pause reader
grep -n '^_ws_collect_qdir() {' ccd/ccd; grep -c '_WS_Q_WHY' ccd/ccd
                                                         # (E3) one line, and >= 1: Task 4's quarantine-directory helper and its why
grep -n '_WS_CHECKOUTS_ACCEPTED' ccd/ccd | head -3       # (E4) Task 4's accepted-pairs global, set by _ws_leaf_checkouts
grep -n "'witness-mismatch'\|'quarantine-kept'" shared/api.ts
                                                         # (E5) each in LcRefusalToken AND LC_REFUSAL_WORD (Task 5)
grep -c "'not-witnessed'\|'registered'\|'not-idle'" shared/api.ts
                                                         # (E5a) 0: this task declares them (ruling G2)
sed -n '/^_LC_ACTS=(/,/)/p' ccd/ccd | grep -cw collect   # (E5b) 1: `collect` in ccd's _LC_ACTS, declared by Task 4 (ruling G1) ...
grep -c 'collect: true' shared/api.ts                    #        ... and >= 1: in L0's LIFECYCLE_ACT_MAP
grep -n '^_ws_collect_floor_s() {' ccd/ccd               # (E6) ONE line: the floor's only definition, the fixture's seam (ruling G4)
grep -c 'COLLECT-BEGIN' ccd/ccd; grep -c 'COLLECT-END' ccd/ccd
                                                         # (E6b) 1 and 1: Task 4's region markers alone carry the substrings
grep -c '_WS_RCL_CRUMB' ccd/ccd                          # (E7) >= 1: Task 2's crumb global
grep -c '^cmd_ws_collect() {\|^_ws_collect_locked() {\|^_ws_collect_fresh() {\|^_ws_collect_gap() {' ccd/ccd
                                                         # (E8) 0: nothing of this task stands yet
B=$(grep -ohE 'ccd/ccd:[0-9]+(-[0-9]+)?' docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md README.md \
  | sed -E 's/.*://; s/.*-//' | sort -n | tail -1); echo "$B"   # (E9) the frozen boundary (19109 at b0647d850)
sed -n "3,${B}p" ccd/ccd | sha256sum                     # (E9b) RECORD it (line 2 is the stamp): Step 5 proves it unchanged
LC_ALL=C mv --help | grep -c -- '--no-copy'              # (E10) 1 on this box (the Linux suites need it)
```

- If **E1b**, **E1c**, **E2** or **E3** differ, STOP and report: Step 4 composes Task 4's records directory, slot, move and identity and Task 5's evaluation, registry question and pause reader by these exact names (rulings G3, G5, T5 OPEN2), and defines no second of any. A second `_ws_collect_ident` (E1c above 1) is the reconciliation's CRITICAL gap: bash keeps the last definition, and a one-argument form would let `_ws_collect_move` read any readable directory at its destination as "PROVEN moved". The verb test's first CONTROL case pins the evaluation's contract.
- If **E4** prints nothing, find Task 4's name (`grep -n '^_ws_collect_\|^_ws_leaf_checkouts() {' ccd/ccd`) and use it where `_ws_collect_record_write` reads the accepted pairs. Name the substitution in the wave-done; never add a second helper.
- If **E5**, **E5a** or **E5b** fails, STOP: the cross-language scans red on a literal `quarantine-kept` this task writes, a word declared twice reds `tsc`, and every journal assertion below filters on act `collect`.
- **E6:** the fixture's `IDLE_FLOOR_SEAM` (Step 1) redefines exactly that function, the ONE test-only seam that lowers the floor (ruling G4); the production knob `WS_COLLECT_IDLE_FLOOR_S` only raises it and is never used to lower it.
- If **E6b** prints anything but 1 and 1, STOP: every COLLECT slicer (Task 4's census, the scans Task 5 taught, Step 2 (h)'s harvest) reads the FIRST `COLLECT-END`, and this task's block must read as inside the region. Task 5's own block ends `WS-AUDIT-COLLECT-CLOSE ──`.

- [ ] **Step 1: The fixture**

Create `server/test/wsCollectFixture.ts` (Task 5's fixture is `collectFixture.ts`; do not merge them — `COL_ID`, `makeOrphan`, `collectAudit`, `leafOf`, `witnessOf`, `recordsDir`, `quarantineOf` differ):

```ts
// The ORPHANED, WITNESSED temp root every `ws-collect` suite builds on (child reclamation wave 7, spec §5.2 and
// §5.6): a leaf at `$HOME/.cc-tmp/<id>` holding scratch, witnessed by the REAL writer (`_ws_tmproot_witness_write`,
// the code `_child_tmpdir` runs on every rc 0), and NO registry row for the id, so its slug reads free: the
// collector's whole population. The idle floor is lowered ONLY by redefining `_ws_collect_floor_s` in the sourced
// harness (ruling G4), never through the production knob, which can only raise it.
//
// FIXTURE HOME ONLY. `makePrHarness`'s HOME is the single isolation boundary: every `~/.cc-tmp`, `$REG`, record and
// quarantine path below derives from it, and the verb runs as a SOURCED function, never through the installed
// launcher and never against the live HOME. Every seam here (`_ws_collect_gap`, `_ws_collect_mountinfo`, a stubbed
// probe, rule or `mv`) is a shell FUNCTION a snippet defines after ccd is sourced: it shadows ccd's own for that one
// call and touches nothing else.
import fs from 'node:fs';
import path from 'node:path';
import type { PrHarness } from './ccdPrHelpers.js';

export const COL_ID = 'demo-quiet-reef';
export const COL_RUN = 7;
/** A well-formed token no ladder mints. */
export const WRONG_TOKEN = '0'.repeat(64);
/** The floor's ONE test-only seam (ruling G4): Task 4's `_ws_collect_floor_s`, the floor's only definition, redefined. */
export const IDLE_FLOOR_SEAM = '_ws_collect_floor_s() { echo 0; };';

export type Run = { code: number; stdout: string; stderr: string };

const lines = (p: string): string[] =>
  (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : []);

export const ccTmp = (h: PrHarness): string => path.join(h.home, '.cc-tmp');
export const regOf = (h: PrHarness): string => path.join(h.home, '.cc-sessions');
export const leafOf = (h: PrHarness): string => path.join(ccTmp(h), COL_ID);
/** The leaf's PHYSICAL pre-move spelling: what the verb moves, asks the checkout question of, and passes as the alias. */
export const origOf = (h: PrHarness): string => path.join(fs.realpathSync(ccTmp(h)), COL_ID);
export const witnessOf = (h: PrHarness): string => path.join(regOf(h), 'tmproots', COL_ID);
export const recordsDir = (h: PrHarness): string => path.join(regOf(h), 'tmpquarantine');
export const records = (h: PrHarness): string[] =>
  (fs.existsSync(recordsDir(h)) ? fs.readdirSync(recordsDir(h)).sort() : []);
/** `<physical ~/.cc-tmp>/.ccd-quarantine`, spelled physically, as the verb resolves it. */
export const quarantineOf = (h: PrHarness): string => path.join(fs.realpathSync(ccTmp(h)), '.ccd-quarantine');
export const slots = (h: PrHarness): string[] =>
  (fs.existsSync(quarantineOf(h)) ? fs.readdirSync(quarantineOf(h)).sort() : []);
/** The seam points the verb passed, in order (`GAP_LOG`, `gapAt`, `crashAt`). */
export const gaps = (h: PrHarness): string[] => lines(path.join(h.home, 'gaps'));
export const linesOf = (h: PrHarness, name: string): string[] => lines(path.join(h.home, name));
/** The inode at `p` now, or '' when nothing stands there; the last component is never followed. */
export const inoAt = (p: string): string => {
  try { return String(fs.lstatSync(p, { bigint: true }).ino); } catch { return ''; }
};

export interface Orphan { leaf: string; ino: string; dev: string; witness: string }
/** A witnessed orphan: scratch, a nested directory, and the witness the real writer leaves. */
export function makeOrphan(h: PrHarness): Orphan {
  const leaf = leafOf(h);
  fs.mkdirSync(path.join(leaf, 'cdk.out', 'deep'), { recursive: true });
  fs.chmodSync(leaf, 0o700);
  fs.writeFileSync(path.join(leaf, 'cdk.out', 'manifest.json'), '{}');
  fs.writeFileSync(path.join(leaf, 'scratch.txt'), 'scratch\n');
  h.sh(`_ws_tmproot_witness_write ${COL_ID} '${leaf}' ${COL_RUN}`);
  const st = fs.lstatSync(leaf, { bigint: true });
  return { leaf, ino: String(st.ino), dev: String(st.dev), witness: fs.readFileSync(witnessOf(h), 'utf8') };
}

/** Records every seam point the verb passes to `$HOME/gaps`, and does nothing else. */
export const GAP_LOG = `_ws_collect_gap() { printf '%s\\n' "$1" >> "$HOME/gaps"; };`;
/** Logs, and runs `cmd` (bash: `$2` is the id, `$3` the slot) at `point`. */
export const gapAt = (point: string, cmd: string): string =>
  `_ws_collect_gap() { printf '%s\\n' "$1" >> "$HOME/gaps"; if [[ "$1" == ${point} ]]; then ${cmd}; fi; };`;
/** A crash: the verb's process dies at `point` with no trap, and the kernel frees its lock — a SIGKILL's leftovers. */
export const crashAt = (point: string): string => gapAt(point, 'exit 137');

/** The evaluation (Task 5's `_ws_collect_fork`) answering collectable with `token`: on a fresh arm a PRESENT leaf, on
 *  a resume the record `rec` at `phase` (default `moved`) — for the cases that pin the VERB's own guards past the
 *  evaluation. It reads the witness in the current shell, as the real one does, so the verb sees the fields its
 *  consent bound; on a resume the verb reads the record itself. */
export const evalSays = (token: string, rec = '', phase = rec ? 'moved' : ''): string =>
  `_ws_collect_fork() { _ws_tmproot_witness_read "$1" >/dev/null 2>&1 || :; REAP_VERDICT=collectable;`
  + ` REAP_TOKEN=${token}; REAP_DETAIL=''; _WS_COLLECT_RECORD='${rec}'; _WS_COLLECT_PHASE='${phase}';`
  + ` _WS_COLLECT_LEAF='${rec ? '' : 'present'}'; return 0; };`;

/** The in-use probe, answering "someone" for a spelling matching the glob in `$HOME/busy-now`, and "unmeasured"
 *  while `$HOME/unmeasured-now` exists. A seam plants either AFTER the move, so the ladder's own ask passes. */
export const PROBE_STUB = '_ws_path_users() { printf \'%s\\n\' "$1" >> "$HOME/probe-asked";'
  + ' if [[ -e "$HOME/busy-now" ]] && [[ "$1" == $(cat "$HOME/busy-now") ]]; then'
  + ' _WS_PATH_USERS_PIDS=4242; _WS_PATH_USERS_WHY="pid 4242 (a stub) uses $1"; return 1; fi;'
  + ' if [[ -e "$HOME/unmeasured-now" ]]; then _WS_PATH_USERS_WHY=\'stub: the process table could not be read\'; return 2; fi;'
  + ' return 0; };';
/** Task 4's row rule, logging `id|leafpath|stands-or-absent` and answering `$HOME/rows-now`'s rc once a seam plants it. */
export const ROWS_STUB = '_ws_collect_rows_clear() {'
  + ' printf \'%s|%s|%s\\n\' "$1" "$2" "$([[ -e "$2" ]] && echo stands || echo absent)" >> "$HOME/rows-asked";'
  + ' if [[ -e "$HOME/rows-now" ]]; then _WS_COLLECT_ROWS_WHY="stub: a row lies inside $2"; return "$(cat "$HOME/rows-now")"; fi;'
  + ' return 0; };';
/** The row rule answering "no row" always, so a case can pin the guard BEFORE it without the rule backstopping. */
export const ROWS_CLEAR = '_ws_collect_rows_clear() { return 0; };';
/** The mount table at `$HOME/mountinfo` (see `realMounts`), so a seam can append to it mid-act. */
export const MOUNTS_SEAM = '_ws_collect_mountinfo() { printf \'%s\' "$HOME/mountinfo"; };';
export function realMounts(h: PrHarness): void {
  fs.writeFileSync(path.join(h.home, 'mountinfo'), fs.readFileSync('/proc/self/mountinfo'));
}

const floor = (o: { floor?: boolean }): string => (o.floor === false ? '' : IDLE_FLOOR_SEAM);

/** `ccd ws-audit --session <id> --collect` (Task 5) through the sourced function. */
export function collectAudit(h: PrHarness, opts: { pre?: string; floor?: boolean } = {}): Run {
  return h.run(`${floor(opts)} ${opts.pre ?? ''} cmd_ws_audit --session ${COL_ID} --collect`);
}

/** The token the audit mints now; throws, naming the audit's answer, when it mints none. */
export function collectToken(h: PrHarness, opts: { pre?: string; floor?: boolean } = {}): string {
  const r = collectAudit(h, opts);
  const doc = JSON.parse(r.stdout.trim().split('\n').pop() || '{}') as { verdict?: string; token?: string };
  if (doc.verdict !== 'collectable' || !doc.token) throw new Error(`the audit minted no token: ${r.stdout}${r.stderr}`);
  return doc.token;
}

/** `ws-collect` through the sourced function, answering instead of throwing. */
export function collectVerb(
  h: PrHarness, token: string, opts: { pre?: string; extra?: string; id?: string; floor?: boolean } = {},
): Run {
  return h.run(`${floor(opts)} ${opts.pre ?? ''} cmd_ws_collect --expect ${token} --session ${opts.id ?? COL_ID} ${opts.extra ?? ''}`);
}

/** The verb's ONE JSON line. */
export const docOf = (stdout: string): Record<string, unknown> =>
  JSON.parse(stdout.trim().split('\n').pop() || '') as Record<string, unknown>;
```

- [ ] **Step 2: Write the failing tests**

Five NEW files, one per step group, so no single foreground run nears the 600 s ceiling. Every case runs in a fixture HOME (`makePrHarness`), sources `ccd/ccd`, and calls `cmd_ws_collect` as a function: the verb is never run against the live HOME, and no case runs `ws-reclaim`, `ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`, `ws-restore` or `ws-expire`.

Create `server/test/ccd-ws-collect-verb.test.ts`:

```ts
// `ws-collect`, the temp-root collector's destructive verb (child reclamation wave 7, spec §5.2 and §5.6), end to
// end: a collection's whole order, the consent re-proved inside the reap lock, the pause read inside that lock, the
// population check that keeps it from ever taking a lock for a foreign name, its argv, and off Linux. Every case
// builds a witnessed orphan in a FIXTURE HOME and runs the SOURCED verb; what is asserted is what stands on disk and
// in the journal afterwards, never the verb's word alone.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { decOf, eventsOf } from './lifecycleHelpers.js';
import { LC_REFUSAL_WORD, isLcRefusalToken } from '../../shared/api.js';
import {
  COL_ID, GAP_LOG, IDLE_FLOOR_SEAM, WRONG_TOKEN, collectToken, collectVerb, docOf, evalSays, gaps, inoAt,
  leafOf, makeOrphan, quarantineOf, records, regOf, slots, witnessOf,
} from './wsCollectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-collect-verb-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';
const rows = (): unknown[][] => eventsOf(h.home, 'collect').map((e) => [e['outcome'], e['refusal'] ?? null]);

describe.skipIf(!LINUX)('a collection, end to end', () => {
  it('the CONTROLS: this box’s mv offers --no-copy, and the evaluation leaves the witness it bound in the current shell', () => {
    expect(h.sh('LC_ALL=C mv --help'), 'without it every case below refuses for the wrong reason').toContain('--no-copy');
    const o = makeOrphan(h);
    expect(h.sh(`${IDLE_FLOOR_SEAM} exec 9>>"$REG/.reap-${COL_ID}.lock"; _ws_collect_fork ${COL_ID} >/dev/null;`
      + ' printf \'%s|%s|%s|%s\' "$REAP_VERDICT" "$_WS_WIT_INO" "${_WS_COLLECT_RECORD-}" "${_WS_COLLECT_LEAF-}"'))
      .toBe(`collectable|${o.ino}||present`);
  });

  it('collects: the leaf, its slot and its record go, the witness is dropped, and ONE done document says so', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = docOf(r.stdout);
    expect(doc).toMatchObject({ collected: COL_ID, resumed: false, witness: 'dropped' });
    expect(String(doc['record'])).toMatch(/^demo-quiet-reef\.\d{19}\.\d+$/);
    expect(fs.existsSync(o.leaf), 'the leaf').toBe(false);
    expect(fs.existsSync(witnessOf(h)), 'the witness').toBe(false);
    expect(slots(h), 'no slot is left').toEqual([]);
    expect(records(h), 'no record is left').toEqual([]);
    expect(fs.statSync(quarantineOf(h)).mode & 0o777, 'the quarantine itself stays, private').toBe(0o700);
    const ev = eventsOf(h.home, 'collect');
    expect(ev.map((e) => [e['outcome'], e['verb']])).toEqual([['intent', 'ws-collect'], ['done', 'ws-collect']]);
    expect(ev[1]!['tx'], 'one transaction').toBe(ev[0]!['tx']);
    expect(String(ev[0]!['detail'])).toContain(`record ${String(doc['record'])}: moving `);
    expect(String(ev[1]!['detail'])).toMatch(/^witness dropped; 0 stale witness temp file\(s\) removed; collected /);
  });

  it('passes every step, in order, and never a restore', () => {
    makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: GAP_LOG });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(gaps(h)).toEqual(['locked', 'consented', 'recorded', 'slotted', 'moved', 'proven', 'removed', 'emptied', 'witnessed', 'dropped']);
  });

  it('--surface, --actor and --reason ride the intent row', () => {
    makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { extra: "--surface agent --actor 'collect sweep' --reason tidy" });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(decOf(eventsOf(h.home, 'collect')[0]!)).toMatchObject({ surface: 'agent', actor: 'collect sweep', reason: 'tidy' });
  });

  it('a witness whose leaf is PROVEN absent, with no record: the witness alone is compared and dropped — no quarantine, record or slot', () => {
    makeOrphan(h);
    fs.rmSync(leafOf(h), { recursive: true });
    const r = collectVerb(h, collectToken(h), { pre: GAP_LOG });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)).toEqual({ collected: COL_ID, record: null, resumed: false, witness: 'dropped' });
    expect(fs.existsSync(witnessOf(h)), 'the witness').toBe(false);
    expect(fs.existsSync(quarantineOf(h)), 'no quarantine is made for it').toBe(false);
    expect(records(h)).toEqual([]);
    expect(gaps(h)).toEqual(['locked', 'consented', 'witnessed']);
    expect(eventsOf(h.home, 'collect').map((e) => e['outcome'])).toEqual(['intent', 'done']);
  });
});

describe.skipIf(!LINUX)('the consent, recomputed inside the lock before anything moves', () => {
  it('a token that is not the one recomputed in the lock: state-changed, nothing moves', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, WRONG_TOKEN, { pre: GAP_LOG });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('state-changed');
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(gaps(h), 'refused at the verdict point').toEqual(['locked']);
    expect(records(h)).toEqual([]);
    expect(rows()).toEqual([['refused', 'state-changed']]);
  });

  it('a tree written to after the audit: state-changed — the token binds its newest ctime and its count', () => {
    const o = makeOrphan(h);
    const t = collectToken(h);
    fs.writeFileSync(path.join(o.leaf, 'late.txt'), 'written after the audit\n');
    const r = collectVerb(h, t);
    expect(docOf(r.stdout)['refused']).toBe('state-changed');
    expect(fs.readFileSync(path.join(o.leaf, 'late.txt'), 'utf8')).toBe('written after the audit\n');
  });

  it('a ladder refusal passes through as ONE refusal document and ONE refused row, nothing touched', () => {
    const o = makeOrphan(h);
    fs.writeFileSync(path.join(regOf(h), `${COL_ID}.uuid`), 'deadbeef-0000-4000-8000-000000000000\n');
    const r = collectVerb(h, WRONG_TOKEN, { pre: GAP_LOG });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('registered');
    expect(gaps(h)).toEqual(['locked']);
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(rows()).toEqual([['refused', 'registered']]);
    expect(eventsOf(h.home, 'collect')[0]!['verb']).toBe('ws-collect');
  });

  it('the ladder’s unmeasured is a failed probe-unmeasured at exit 1, with no intent — and never a crumb', () => {
    makeOrphan(h);
    const unmeasured = "_WS_RCL_CRUMB=true; _ws_collect_fork() { REAP_VERDICT=unmeasured; REAP_TOKEN='';"
      + " REAP_DETAIL='stub: the walk timed out'; _WS_COLLECT_RECORD=''; return 1; };";
    const r = collectVerb(h, WRONG_TOKEN, { pre: unmeasured });
    expect(r.code).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('probe-unmeasured');
    expect(doc, 'a collection has no breadcrumb, whatever the shared tail left in the global').not.toHaveProperty('crumb');
    expect(eventsOf(h.home, 'collect').map((e) => [e['outcome'], e['refusal'], e['verb']]))
      .toEqual([['failed', 'probe-unmeasured', 'ws-collect']]);
  });
});

describe.skipIf(!LINUX)('the pause, the lock, and never a lock for a foreign name', () => {
  it('reclaim-paused refuses paused INSIDE the lock — even over a ladder that answers collectable', () => {
    const o = makeOrphan(h);
    fs.writeFileSync(path.join(regOf(h), 'reclaim-paused'), '');
    const r = collectVerb(h, WRONG_TOKEN, { pre: `${GAP_LOG} ${evalSays(WRONG_TOKEN)}` });
    expect(docOf(r.stdout)['refused']).toBe('paused');
    expect(gaps(h), 'read after the lock, before the ladder').toEqual(['locked']);
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(rows()).toEqual([['refused', 'paused']]);
  });

  it('another holder of the reap lock: refused in-progress, journaled, nothing moves', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, WRONG_TOKEN, { pre: `exec 9>>"$REG/.reap-${COL_ID}.lock"; flock -n 9 || exit 99;` });
    expect(docOf(r.stdout)['refused']).toBe('in-progress');
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(rows()).toEqual([['refused', 'in-progress']]);
  });

  it('the locked body runs CONTAINED: every git call beneath it is hook-free and reads only the repository it names', () => {
    expect(fs.readFileSync(CCD, 'utf8')).toMatch(/\n  _ws_reclaim_contained _ws_collect_locked "\$token" "\$id" /);
  });

  it('an id with neither a witness nor a record: refused not-witnessed BEFORE any lock — none is created', () => {
    const r = collectVerb(h, WRONG_TOKEN, { id: 'demo-quiet-none' });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('not-witnessed');
    expect(fs.existsSync(path.join(regOf(h), '.reap-demo-quiet-none.lock'))).toBe(false);
    expect(eventsOf(h.home, 'collect').map((e) => [e['id'], e['refusal']])).toEqual([['demo-quiet-none', 'not-witnessed']]);
  });

  it('argv: four positionals only, no --defer-expired; a malformed or dot-leading id and a bad token die first, journaling nothing', () => {
    makeOrphan(h);
    for (const [args, err] of [
      [`--expect ${WRONG_TOKEN} --session ${COL_ID} --defer-expired`, 'usage: ccd ws-collect'],
      [`--expect ${WRONG_TOKEN} --session .hidden`, 'bad session id'],
      [`--expect ${WRONG_TOKEN} --session 'a/b'`, 'bad session id'],
      [`--expect nothex --session ${COL_ID}`, 'bad token'],
    ] as const) {
      const r = h.run(`cmd_ws_collect ${args}`);
      expect(r.code, args).toBe(1);
      expect(r.stderr, args).toContain(err);
      expect(r.stdout, `${args}: nothing on stdout`).toBe('');
    }
    expect(eventsOf(h.home, 'collect')).toEqual([]);
  });
});

describe('off Linux, or without --no-copy, nothing moves', () => {
  it('a box that is not Linux: probe-unmeasured before any quarantine, record or slot — even over a ladder that answers collectable', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, WRONG_TOKEN, { pre: `${evalSays(WRONG_TOKEN)} CCD_OS=darwin;` });
    expect(r.code).toBe(1);
    expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
    expect(fs.existsSync(quarantineOf(h)), 'the quarantine').toBe(false);
    expect(records(h)).toEqual([]);
    expect(inoAt(o.leaf)).toBe(o.ino);
  });

  it.skipIf(!LINUX)('a box whose mv offers no --no-copy: likewise — the collector never copies', () => {
    const o = makeOrphan(h);
    const oldMv = 'mv() { if [[ "$1" == --help ]]; then echo "Usage: mv [OPTION]... SOURCE DEST"; return 0; fi; command mv "$@"; };';
    const r = collectVerb(h, WRONG_TOKEN, { pre: `${evalSays(WRONG_TOKEN)} ${oldMv}` });
    expect(r.code).toBe(1);
    expect(String(docOf(r.stdout)['detail'])).toContain('--no-copy');
    expect(fs.existsSync(quarantineOf(h)), 'the quarantine').toBe(false);
    expect(inoAt(o.leaf)).toBe(o.ino);
  });
});

describe('the three RETRYABLE words are declared with their first journal sites, each with a sentence true under any server', () => {
  it.each(['not-witnessed', 'registered', 'not-idle'] as const)('%s', (t) => {
    expect(isLcRefusalToken(t)).toBe(true);
    expect(LC_REFUSAL_WORD[t]).toMatch(/Nothing was removed/);
  });
});
```

Create `server/test/ccd-ws-collect-move.test.ts`:

```ts
// `ws-collect`'s steps 2 to 4 (child reclamation wave 7, spec §5.6): the lstat of the leaf, the checkout question of
// the ORIGINAL path, the record before the slot, the slot made exclusively, and the ONE rename, proven by lstat and
// never by mv's exit code. A case forces its race into the exact gap through `_ws_collect_gap`, and shadows `mv`
// with a shell FUNCTION for that one call where it needs a box whose mv misbehaves. FIXTURE HOME ONLY.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import {
  GAP_LOG, collectToken, collectVerb, docOf, gapAt, gaps, inoAt, leafOf, linesOf, makeOrphan, origOf,
  quarantineOf, records, slots, witnessOf,
} from './wsCollectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-collect-move-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';

describe.skipIf(!LINUX)('step 2 — a real directory with the witness’s identity, or nothing moves', () => {
  for (const [what, swap] of [
    ['a symbolic link', 'mv "$HOME/.cc-tmp/$2" "$HOME/real"; ln -s "$HOME/real" "$HOME/.cc-tmp/$2"'],
    ['a regular file', 'mv "$HOME/.cc-tmp/$2" "$HOME/real"; printf data > "$HOME/.cc-tmp/$2"'],
    ['another directory', 'mv "$HOME/.cc-tmp/$2" "$HOME/real"; mkdir "$HOME/.cc-tmp/$2"'],
  ] as const) {
    it(`${what} at the leaf’s path: witness-mismatch before any record — never moved, never unlinked`, () => {
      makeOrphan(h);
      const r = collectVerb(h, collectToken(h), { pre: gapAt('consented', swap) });
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(docOf(r.stdout)['refused']).toBe('witness-mismatch');
      expect(gaps(h), 'refused before the record').toEqual(['locked', 'consented']);
      expect(records(h)).toEqual([]);
      expect(slots(h)).toEqual([]);
      expect(fs.readFileSync(path.join(h.home, 'real', 'scratch.txt'), 'utf8'), 'the witnessed tree').toBe('scratch\n');
      expect(() => fs.lstatSync(leafOf(h)), `${what} still stands where it was`).not.toThrow();
    });
  }
});

describe.skipIf(!LINUX)('step 3a — the checkout question, of the ORIGINAL path, before anything moves', () => {
  const ASK = (rc: number): string => '_ws_leaf_checkouts() { printf \'%s\\n\' "$1" >> "$HOME/checkouts-asked";'
    + ` _WS_CHECKOUTS_WHY='stub: a checkout git records elsewhere'; return ${rc}; };`;

  it('a refusal: containment-unproven; nothing moves; the question named the physical original path', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: `${GAP_LOG} ${ASK(1)}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('containment-unproven');
    expect(linesOf(h, 'checkouts-asked')).toEqual([origOf(h)]);
    expect(gaps(h)).toEqual(['locked', 'consented']);
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(records(h)).toEqual([]);
  });

  it('an unmeasured answer: probe-unmeasured at exit 1; nothing moves', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: ASK(2) });
    expect(r.code).toBe(1);
    expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(records(h)).toEqual([]);
  });
});

describe.skipIf(!LINUX)('steps 3b and 3c — the record, then the slot, made exclusively, both before the move', () => {
  const LOOK = '_ws_collect_gap() { local n s=0 l=0 i; n=$(ls -A "$REG/tmpquarantine" 2>/dev/null | wc -l);'
    + ' [[ -n "${3-}" && -d "$3" ]] && s=1; [[ -e "$HOME/.cc-tmp/$2" ]] && l=1;'
    + ' i=$(cat "$REG"/.lifecycle/journal-*.ndjson 2>/dev/null | grep -c \'"outcome":"intent"\');'
    + ' printf \'%s rec=%s slot=%s leaf=%s intent=%s\\n\' "$1" "${n// /}" "$s" "$l" "$i" >> "$HOME/looks"; };';

  it('the record, then the slot, then the intent, then the move', () => {
    makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: LOOK });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(linesOf(h, 'looks').filter((l) => /^(recorded|slotted|moved) /.test(l))).toEqual([
      'recorded rec=1 slot=0 leaf=1 intent=0',
      'slotted rec=1 slot=1 leaf=1 intent=0',
      'moved rec=1 slot=1 leaf=0 intent=1',
    ]);
  });

  it('a record that cannot be written stops everything: probe-unmeasured, no slot, the leaf where it was', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: `${GAP_LOG} _ws_collect_record_write() { return 1; };` });
    expect(r.code).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('probe-unmeasured');
    expect(String(doc['detail'])).toContain('could not be written');
    expect(gaps(h)).toEqual(['locked', 'consented']);
    expect(slots(h)).toEqual([]);
    expect(inoAt(o.leaf)).toBe(o.ino);
  });

  it('a record that does not read back as written stops everything, and is dropped', () => {
    const o = makeOrphan(h);
    const bad = '_ws_collect_record_write() { mkdir -p "$(_ws_collect_qrec_dir)";'
      + ' printf \'v=1 id=%s\\n\' "$1" > "$(_ws_collect_qrec_dir)/${2##*/slot.}"; };';
    const r = collectVerb(h, collectToken(h), { pre: `${GAP_LOG} ${bad}` });
    expect(r.code).toBe(1);
    expect(String(docOf(r.stdout)['detail'])).toContain('did not read back as written');
    expect(gaps(h)).toEqual(['locked', 'consented', 'recorded']);
    expect(records(h)).toEqual([]);
    expect(slots(h)).toEqual([]);
    expect(inoAt(o.leaf)).toBe(o.ino);
  });

  it('the slot is made EXCLUSIVELY: a name that already stands is never adopted and, not being this verb’s, never removed', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: gapAt('recorded', 'mkdir "$3"') });
    expect(r.code).toBe(1);
    expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
    expect(slots(h), 'the slot that stood').toHaveLength(1);
    expect(fs.readdirSync(path.join(quarantineOf(h), slots(h)[0]!)), 'and nothing was moved into it').toEqual([]);
    expect(records(h), 'the record is dropped').toEqual([]);
    expect(inoAt(o.leaf)).toBe(o.ino);
  });
});

describe.skipIf(!LINUX)('step 4 — ONE rename, proven by lstat, never by mv’s exit code', () => {
  /** `mv` for the one call that moves INTO a slot's leaf; every other call is the real mv. */
  const intoSlot = (body: string): string =>
    `mv() { if [[ "$1" != --help && "\${@: -1}" == */.ccd-quarantine/slot.*/leaf ]]; then ${body}; fi; command mv "$@"; };`;

  it('the argv is exactly `mv -T -n --no-copy -- <physical leaf> <slot>/leaf`', () => {
    makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: intoSlot('printf \'%s\\x1f\' "$@" >> "$HOME/mv-into"') });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const slot = path.join(quarantineOf(h), `slot.${String(docOf(r.stdout)['record'])}`);
    expect(fs.readFileSync(path.join(h.home, 'mv-into'), 'utf8').split('\x1f').filter(Boolean))
      .toEqual(['-T', '-n', '--no-copy', '--', origOf(h), `${slot}/leaf`]);
  });

  for (const [what, body] of [
    ['answers 0 and moves nothing', 'return 0'],
    ['refuses the rename across mounts (EXDEV), as --no-copy makes it', "echo 'mv: cannot move: Invalid cross-device link' >&2; return 1"],
  ] as const) {
    it(`an mv that ${what}: nothing moved, the slot and the record cleared, probe-unmeasured`, () => {
      const o = makeOrphan(h);
      const r = collectVerb(h, collectToken(h), { pre: intoSlot(body) });
      expect(r.code).toBe(1);
      const doc = docOf(r.stdout);
      expect(doc['failed']).toBe('probe-unmeasured');
      expect(String(doc['detail'])).toContain('was not proven');
      expect(inoAt(o.leaf)).toBe(o.ino);
      expect(slots(h)).toEqual([]);
      expect(records(h)).toEqual([]);
      expect(fs.readFileSync(witnessOf(h), 'utf8')).toBe(o.witness);
      expect(eventsOf(h.home, 'collect').map((e) => [e['outcome'], e['refusal'] ?? null]))
        .toEqual([['intent', null], ['failed', 'probe-unmeasured']]);
    });
  }

  it('an mv that COPIES: what reaches the slot is not the witnessed inode — KEPT there with its record, never moved back or unlinked', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), {
      pre: intoSlot('cp -a -- "${@: -2:1}" "${@: -1}" && rm -rf -- "${@: -2:1}"; return'),
    });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = docOf(r.stdout);
    expect(doc['refused'], 'anything not the witnessed leaf that reached a slot (ruling T8 OPEN5)').toBe('quarantine-kept');
    expect(String(doc['detail']), 'caught by the move’s own proof, before any re-proof').toContain('what reached');
    const slot = path.join(quarantineOf(h), slots(h)[0]!);
    expect(fs.readFileSync(path.join(slot, 'leaf', 'scratch.txt'), 'utf8'), 'the scratch, in the copy, kept in its slot').toBe('scratch\n');
    expect(inoAt(path.join(slot, 'leaf')), 'a copy is another inode').not.toBe(o.ino);
    expect(fs.existsSync(o.leaf), 'never moved back to the id’s path').toBe(false);
    expect(records(h), 'its record, kept').toHaveLength(1);
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'the witness stays: the slot is the operator’s').toBe(o.witness);
    expect(eventsOf(h.home, 'collect').map((e) => [e['outcome'], e['refusal'] ?? null]))
      .toEqual([['intent', null], ['refused', 'quarantine-kept']]);
  });
});
```

Create `server/test/ccd-ws-collect-reprove.test.ts`:

```ts
// `ws-collect`'s step 5 (child reclamation wave 7, spec §5.6): every proof re-asked AFTER the move, each made to fail
// in the exact gap (`_ws_collect_gap moved`), and the restore any doubt takes — one NOREPLACE rename back, PROVEN by
// lstat — or, when that cannot be proven, the record and the slot KEPT and nothing in them removed.
// FIXTURE HOME ONLY. A case that narrows `$REG`'s mode restores it in `finally`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import {
  COL_ID, MOUNTS_SEAM, PROBE_STUB, ROWS_CLEAR, ROWS_STUB, collectToken, collectVerb, docOf, gapAt, inoAt,
  leafOf, linesOf, makeOrphan, quarantineOf, realMounts, records, regOf, slots, witnessOf, type Orphan,
} from './wsCollectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-collect-reprove-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';
const ROOT = process.getuid?.() === 0;

/** The leaf is back at its own path, the same inode, untouched; its slot and its record are gone; its witness is kept. */
const back = (o: Orphan): void => {
  expect(inoAt(o.leaf), 'the leaf is back at its own path, the same inode').toBe(o.ino);
  expect(fs.readFileSync(path.join(o.leaf, 'scratch.txt'), 'utf8'), 'its scratch is untouched').toBe('scratch\n');
  expect(slots(h), 'its slot is gone').toEqual([]);
  expect(records(h), 'its record is gone').toEqual([]);
  expect(fs.readFileSync(witnessOf(h), 'utf8'), 'its witness is kept').toBe(o.witness);
};
/** The intent, then ONE outcome in the intent's own transaction. */
const journaled = (outcome: string, token: string): void => {
  const ev = eventsOf(h.home, 'collect');
  expect(ev.map((e) => [e['outcome'], e['refusal'] ?? null])).toEqual([['intent', null], [outcome, token]]);
  expect(ev[1]!['tx'], 'it closes the intent’s transaction').toBe(ev[0]!['tx']);
};
const slotLeaf = (): string => path.join(quarantineOf(h), slots(h)[0]!, 'leaf');

describe.skipIf(!LINUX)('(a) and (b) — the id is registered again', () => {
  it('a child marker after the move: registered, moved back', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: gapAt('moved', 'printf 7 > "$REG/$2.child"') });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('registered');
    back(o);
    journaled('refused', 'registered');
  });

  it('a registry row after the move: registered, moved back', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: gapAt('moved', 'printf x > "$REG/$2.uuid"') });
    expect(docOf(r.stdout)['refused']).toBe('registered');
    back(o);
  });

  it.skipIf(ROOT)('a child marker under a $REG that can be searched but not listed: the DIRECT lookup sees it', () => {
    const o = makeOrphan(h);
    try {
      const r = collectVerb(h, collectToken(h), { pre: gapAt('moved', 'printf 7 > "$REG/$2.child"; chmod 0300 "$REG"') });
      expect(docOf(r.stdout)['refused']).toBe('registered');
    } finally { fs.chmodSync(regOf(h), 0o700); }
    back(o);
  });

  it.skipIf(ROOT)('a row under a $REG that cannot be listed: the direct lookups miss it, `_ws_slug_free` reads free, the listing control does not — moved back', () => {
    const o = makeOrphan(h);
    try {
      const r = collectVerb(h, collectToken(h), {
        pre: `${ROWS_CLEAR} ${gapAt('moved', 'printf x > "$REG/$2.hold"; chmod 0300 "$REG"')}`,
      });
      expect(r.code).toBe(1);
      const doc = docOf(r.stdout);
      expect(doc['failed']).toBe('probe-unmeasured');
      expect(String(doc['detail'])).toContain('wildcard listing');
    } finally { fs.chmodSync(regOf(h), 0o700); }
    back(o);
    journaled('failed', 'probe-unmeasured');
  });
});

describe('the registry question itself (Task 5’s `_ws_collect_registered`, asked by step 5)', () => {
  it('an id that is not <project>-<slug> is never asked as another id: unmeasured, never free', () => {
    // `_ws_slug_free p s` asks `p-s`; split from a dash-less id, it would ask `nodash-nodash` and answer free.
    expect(h.sh('exec 9>>"$REG/.reap-nodash.lock";'
      + ' _ws_collect_registered nodash; printf \'%s\' "$?"')).toBe('2');
  });
});

describe.skipIf(!LINUX)('(c) — nobody uses it, on BOTH spellings', () => {
  it('a user of the path TMPDIR names (the probe’s string arm): in-use, moved back', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h),
      { pre: `${PROBE_STUB} ${gapAt('moved', 'printf \'%s\' "$HOME/.cc-tmp/$2" > "$HOME/busy-now"')}` });
    expect(docOf(r.stdout)['refused']).toBe('in-use');
    back(o);
    journaled('refused', 'in-use');
  });

  it('a user of the slot’s leaf (a cwd or an open file follows a rename): in-use, moved back', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h),
      { pre: `${PROBE_STUB} ${gapAt('moved', 'printf \'%s\' \'*/.ccd-quarantine/slot.*/leaf\' > "$HOME/busy-now"')}` });
    expect(docOf(r.stdout)['refused']).toBe('in-use');
    back(o);
  });

  it('a REAL process whose cwd is inside the moved tree: in-use, and the tree goes back with it', () => {
    const o = makeOrphan(h);
    const hold = '( exec {lfd}>&-; cd "$3/leaf" && exec sleep 30 ) </dev/null >/dev/null 2>&1 & echo $! > "$HOME/holder.pid";'
      + ' for _ in $(seq 100); do [[ "$(readlink "/proc/$(cat "$HOME/holder.pid")/cwd")" == "$3/leaf" ]] && break; sleep 0.05; done';
    try {
      const r = collectVerb(h, collectToken(h), { pre: gapAt('moved', hold) });
      expect(docOf(r.stdout)['refused']).toBe('in-use');
      back(o);
    } finally {
      const p = path.join(h.home, 'holder.pid');
      if (fs.existsSync(p)) { try { process.kill(Number(fs.readFileSync(p, 'utf8').trim()), 'SIGKILL'); } catch { /* gone */ } }
    }
  });

  it('a probe that could not measure: probe-unmeasured at exit 1, moved back', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: `${PROBE_STUB} ${gapAt('moved', 'touch "$HOME/unmeasured-now"')}` });
    expect(r.code).toBe(1);
    expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
    back(o);
    journaled('failed', 'probe-unmeasured');
  });
});

describe.skipIf(!LINUX)('(d) — no registry row at, inside or through the leaf, on its PRE-MOVE spelling', () => {
  it('is asked AFTER the move, of the LOGICAL pre-move spelling `_child_tmpdir` hands out, while nothing stands there', () => {
    makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: ROWS_STUB });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(linesOf(h, 'rows-asked').at(-1)).toBe(`${COL_ID}|${leafOf(h)}|absent`);
  });

  it('a row it finds: containment-unproven, moved back', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: `${ROWS_STUB} ${gapAt('moved', 'printf 1 > "$HOME/rows-now"')}` });
    expect(docOf(r.stdout)['refused']).toBe('containment-unproven');
    back(o);
  });

  it('a row it cannot place: probe-unmeasured, moved back', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: `${ROWS_STUB} ${gapAt('moved', 'printf 2 > "$HOME/rows-now"')}` });
    expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
    back(o);
  });

  it('the real rule: another session’s row inside the pre-move spelling, written after the move — moved back, nothing removed', () => {
    const o = makeOrphan(h);
    const plant = 'printf x > "$REG/demo-other.uuid"; printf demo > "$REG/demo-other.project";'
      + ' printf \'%s\\n\' "$HOME/.cc-tmp/$2/repo" > "$REG/demo-other.workdir"';
    const r = collectVerb(h, collectToken(h), { pre: gapAt('moved', plant) });
    const doc = docOf(r.stdout);
    // Task 4's rule answers a row it places inside the leaf `containment-unproven`, and a row it cannot place (its
    // workdir moved with the leaf) unmeasured. Either way the leaf goes back, and that is what this pins.
    expect(['containment-unproven', 'probe-unmeasured']).toContain(doc['refused'] ?? doc['failed']);
    back(o);
  });
});

describe.skipIf(!LINUX)('(e) — nothing mounted at or under the slot’s leaf, in the kernel’s own table', () => {
  const mountAt = (sub: string): string =>
    gapAt('moved', `printf '9999 1 0:99 / %s rw,relatime - tmpfs tmpfs rw\\n' "$3/${sub}" >> "$HOME/mountinfo"`);

  for (const sub of ['leaf/mnt', 'leaf']) {
    it(`a mount at <slot>/${sub}: moved back, then probe-unmeasured (ruling T6 OPEN8)`, () => {
      const o = makeOrphan(h);
      realMounts(h);
      const r = collectVerb(h, collectToken(h), { pre: `${MOUNTS_SEAM} ${mountAt(sub)}` });
      expect(r.code).toBe(1);
      expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
      back(o);
      journaled('failed', 'probe-unmeasured');
    });
  }

  it('the CONTROL: a mount at a SIBLING of the leaf is not under it — collected', () => {
    makeOrphan(h);
    realMounts(h);
    const r = collectVerb(h, collectToken(h), { pre: `${MOUNTS_SEAM} ${mountAt('leafy')}` });
    expect(docOf(r.stdout)['collected']).toBe(COL_ID);
  });

  it('mount points are compared ENCODED, as the kernel writes them — a space, a tab, a backslash', () => {
    // `_ws_collect_mounts_clear` compares text and never touches the path, so the directory need not exist.
    const dir = path.join(h.home, 'vol with\tspace\\and');
    const enc = (p: string): string =>
      p.replace(/\\/g, '\\134').replace(/ /g, '\\040').replace(/\t/g, '\\011').replace(/\n/g, '\\012');
    realMounts(h);
    fs.appendFileSync(path.join(h.home, 'mountinfo'), `9999 1 0:99 / ${enc(dir)}/leaf/mnt rw - tmpfs tmpfs rw\n`);
    const ask = (d: string): string => h.sh(`${MOUNTS_SEAM} _ws_collect_mounts_clear '${d}'; printf '%s' "$?"`);
    expect(ask(`${dir}/leaf`), 'the encoded line names a mount under it').toBe('1');
    expect(ask(`${dir}/leafy`), 'the CONTROL: a sibling is not under it').toBe('0');
  });

  it('a table that cannot be read: probe-unmeasured, moved back', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: '_ws_collect_mountinfo() { printf \'%s\' "$HOME/no-such-table"; };' });
    expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
    back(o);
  });

  it('a table with no mount in it: probe-unmeasured, moved back', () => {
    const o = makeOrphan(h);
    realMounts(h);
    const r = collectVerb(h, collectToken(h), { pre: `${MOUNTS_SEAM} ${gapAt('moved', ': > "$HOME/mountinfo"')}` });
    expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
    back(o);
  });
});

describe.skipIf(!LINUX)('(f) — identity, asked LAST, directly before the removal', () => {
  it('the slot’s leaf swapped after the move: nothing removed, nothing moved back — KEPT, refused quarantine-kept (ruling T8 OPEN5)', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: gapAt('moved', 'mv "$3/leaf" "$3/leaf.orig"; mkdir "$3/leaf"') });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = docOf(r.stdout);
    expect(doc['refused']).toBe('quarantine-kept');
    expect(String(doc['detail'])).toContain('not the witnessed');
    const slot = path.join(quarantineOf(h), slots(h)[0]!);
    expect(inoAt(path.join(slot, 'leaf.orig')), 'the witnessed tree, kept in its slot').toBe(o.ino);
    expect(fs.existsSync(path.join(slot, 'leaf')), 'what the slot held, kept there').toBe(true);
    expect(fs.existsSync(o.leaf), 'nothing went to the leaf’s path').toBe(false);
    expect(records(h), 'its record, kept').toHaveLength(1);
    journaled('refused', 'quarantine-kept');
  });
});

describe.skipIf(!LINUX)('the restore — NOREPLACE, proven by lstat, or the record and the slot KEPT', () => {
  it('a path retaken since the move is never clobbered: TERMINAL — refused quarantine-kept at exit 0 (ruling T8 OPEN4)', () => {
    const o = makeOrphan(h);
    const retake = 'printf 7 > "$REG/$2.child"; mkdir -p "$HOME/.cc-tmp/$2"; echo new > "$HOME/.cc-tmp/$2/new.txt"';
    const r = collectVerb(h, collectToken(h), { pre: gapAt('moved', retake) });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('quarantine-kept');
    expect(fs.readFileSync(path.join(o.leaf, 'new.txt'), 'utf8'), 'the new leaf is untouched').toBe('new\n');
    expect(inoAt(slotLeaf()), 'the witnessed leaf, kept in its slot').toBe(o.ino);
    expect(records(h)).toHaveLength(1);
    journaled('refused', 'quarantine-kept');
  });

  it('a restore that mv claims and does not make is not a restore: KEPT', () => {
    const o = makeOrphan(h);
    const noop = 'mv() { if [[ "$1" != --help && "${@: -2:1}" == */.ccd-quarantine/slot.*/leaf ]]; then return 0; fi; command mv "$@"; };';
    const r = collectVerb(h, collectToken(h), { pre: `${noop} ${gapAt('moved', 'printf 7 > "$REG/$2.child"')}` });
    expect(docOf(r.stdout)['failed']).toBe('quarantine-kept');
    expect(inoAt(slotLeaf())).toBe(o.ino);
    expect(fs.existsSync(o.leaf)).toBe(false);
    expect(records(h)).toHaveLength(1);
  });

  it('a restore that put the leaf anywhere but its own path is not a restore: KEPT', () => {
    const o = makeOrphan(h);
    const astray = 'mv() { if [[ "$1" != --help && "${@: -2:1}" == */.ccd-quarantine/slot.*/leaf ]]; then'
      + ' command mv -- "${@: -2:1}" "$HOME/astray" && mkdir "${@: -1}"; return 0; fi; command mv "$@"; };';
    const r = collectVerb(h, collectToken(h), { pre: `${astray} ${gapAt('moved', 'printf 7 > "$REG/$2.child"')}` });
    expect(docOf(r.stdout)['failed']).toBe('quarantine-kept');
    expect(inoAt(path.join(h.home, 'astray'))).toBe(o.ino);
    expect(records(h), 'the record that knows where it was').toHaveLength(1);
  });

  it('a slot that holds anything besides its leaf is never emptied by force: KEPT, what it holds stands', () => {
    const o = makeOrphan(h);
    const seam = '_ws_collect_gap() { case "$1" in moved) printf 7 > "$REG/$2.child" ;; restoring) printf s > "$3/stray" ;; esac; };';
    const r = collectVerb(h, collectToken(h), { pre: seam });
    expect(docOf(r.stdout)['failed']).toBe('quarantine-kept');
    expect(inoAt(o.leaf), 'the leaf itself did go back').toBe(o.ino);
    expect(fs.readFileSync(path.join(quarantineOf(h), slots(h)[0]!, 'stray'), 'utf8')).toBe('s');
    expect(records(h)).toHaveLength(1);
  });
});
```

Create `server/test/ccd-ws-collect-order.test.ts`:

```ts
// `ws-collect`'s step 6 and the order after it (child reclamation wave 7, spec §5.2 and §5.6): the slot's leaf goes
// through the ONE removal helper with the witness's dev:ino and the alias; then the leaf is proven gone, the EMPTY
// slot is rmdir'd (never a recursive remove), the witness is compared and dropped (moved aside, read, unlinked only
// if it is the collected one), the witness writer's dead temp files of this id are reaped, and the record goes
// LAST. FIXTURE HOME ONLY; a case that narrows a directory's mode restores it in `finally`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import {
  COL_ID, collectToken, collectVerb, docOf, gapAt, inoAt, linesOf, makeOrphan, origOf, quarantineOf, records,
  slots, witnessOf,
} from './wsCollectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-collect-order-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';
const ROOT = process.getuid?.() === 0;
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe.skipIf(!LINUX)('step 6 — the ONE removal helper, with the witness’s dev:ino and the alias', () => {
  it('is called as `_ws_leaf_remove <slot> leaf <dev:ino> <pre-move path> <accepted checkouts>`', () => {
    const o = makeOrphan(h);
    const spy = 'eval "$(declare -f _ws_leaf_remove | sed \'1s/^_ws_leaf_remove /_ws_leaf_remove_real /\')";'
      + ' _ws_leaf_remove() { printf \'%s\\x1f\' "$@" > "$HOME/remove-args"; _ws_leaf_remove_real "$@"; };';
    const r = collectVerb(h, collectToken(h), { pre: spy });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const slot = path.join(quarantineOf(h), `slot.${String(docOf(r.stdout)['record'])}`);
    expect(fs.readFileSync(path.join(h.home, 'remove-args'), 'utf8').split('\x1f').slice(0, -1))
      .toEqual([slot, 'leaf', `${o.dev}:${o.ino}`, origOf(h), '']);
  });

  it('a leaf the helper REFUSES (rc 1, nothing under it removed): moved back whole, containment-unproven', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: "_ws_leaf_remove() { _WS_LEAF_WHY='stub: a checkout git records elsewhere'; return 1; };" });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('containment-unproven');
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(slots(h)).toEqual([]);
    expect(records(h)).toEqual([]);
  });

  it('a helper that could not measure (rc 2 — an rm that failed part-way answers 2 too): the record and slot KEPT', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: "_ws_leaf_remove() { _WS_LEAF_WHY='stub: rm exit 1'; return 2; };" });
    expect(r.code).toBe(1);
    expect(docOf(r.stdout)['failed']).toBe('quarantine-kept');
    expect(inoAt(path.join(quarantineOf(h), slots(h)[0]!, 'leaf'))).toBe(o.ino);
    expect(records(h)).toHaveLength(1);
  });
});

describe.skipIf(!LINUX)('then the order: the leaf proven gone, the EMPTY slot, the witness, the record LAST', () => {
  const LOOK = '_ws_collect_gap() { local s=0 l=0 w=0 n;'
    + ' [[ -n "${3-}" && -e "$3" ]] && s=1; [[ -n "${3-}" && -e "$3/leaf" ]] && l=1; [[ -e "$REG/tmproots/$2" ]] && w=1;'
    + ' n=$(ls -A "$REG/tmpquarantine" 2>/dev/null | wc -l);'
    + ' printf \'%s slot=%s leaf=%s witness=%s record=%s\\n\' "$1" "$s" "$l" "$w" "${n// /}" >> "$HOME/looks"; };';

  it('in exactly that order', () => {
    makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: LOOK });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(linesOf(h, 'looks').filter((l) => /^(removed|emptied|witnessed) /.test(l))).toEqual([
      'removed slot=1 leaf=0 witness=1 record=1',
      'emptied slot=0 leaf=0 witness=1 record=1',
      'witnessed slot=0 leaf=0 witness=0 record=1',
    ]);
    expect(records(h)).toEqual([]);
  });

  it('rmdir, never a recursive remove: a slot holding a stray entry after the removal is KEPT, with its record and witness', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: gapAt('removed', 'printf s > "$3/stray"') });
    expect(r.code).toBe(1);
    expect(docOf(r.stdout)['failed']).toBe('quarantine-kept');
    expect(fs.readFileSync(path.join(quarantineOf(h), slots(h)[0]!, 'stray'), 'utf8')).toBe('s');
    expect(records(h)).toHaveLength(1);
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'the witness stays until the slot is gone').toBe(o.witness);
  });

  it('a record that cannot be dropped: quarantine-kept — and the next pass finishes it from the record', () => {
    makeOrphan(h);
    const r1 = collectVerb(h, collectToken(h), { pre: '_ws_collect_record_drop() { return 1; };' });
    expect(r1.code).toBe(1);
    expect(docOf(r1.stdout)['failed']).toBe('quarantine-kept');
    expect(records(h)).toHaveLength(1);
    const r2 = collectVerb(h, collectToken(h));
    expect(r2.code, r2.stdout + r2.stderr).toBe(0);
    expect(docOf(r2.stdout)).toMatchObject({ collected: COL_ID, resumed: true, witness: 'absent' });
    expect(records(h)).toEqual([]);
  });
});

describe.skipIf(!LINUX)('compare-and-drop — the witness this collection acted on goes, and nothing else', () => {
  it('a witness a recycled spawn rewrote is NOT dropped: moved aside, read, moved back', () => {
    makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: gapAt('emptied', 'sed -i "s/ run=7 / run=8 /" "$REG/tmproots/$2"') });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)).toMatchObject({ collected: COL_ID, witness: 'kept' });
    expect(fs.readFileSync(witnessOf(h), 'utf8')).toMatch(/ run=8 /);
    expect(fs.readdirSync(path.dirname(witnessOf(h))), 'no aside is left').toEqual([COL_ID]);
  });

  it('the collected one is moved ASIDE by one NOREPLACE rename and unlinked there — the live name is never rm’d', () => {
    makeOrphan(h);
    const spy = 'rm() { printf \'%s\\n\' "$*" >> "$HOME/rm-calls"; command rm "$@"; };'
      + ' mv() { printf \'%s\\n\' "$*" >> "$HOME/mv-calls"; command mv "$@"; };';
    const r = collectVerb(h, collectToken(h), { pre: spy });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const w = witnessOf(h);
    const aside = `${esc(path.dirname(w))}/\\.${esc(COL_ID)}\\.drop\\.\\d+`;
    expect(linesOf(h, 'mv-calls')).toContainEqual(expect.stringMatching(new RegExp(`^-T -n --no-copy -- ${esc(w)} ${aside}$`)));
    expect(linesOf(h, 'rm-calls')).toContainEqual(expect.stringMatching(new RegExp(`^-f -- ${aside}$`)));
    expect(linesOf(h, 'rm-calls').filter((l) => l.endsWith(` ${w}`)), 'never the live name').toEqual([]);
  });

  it('a newer witness written while ours was aside is never clobbered', () => {
    makeOrphan(h);
    const race = `mv() { command mv "$@"; local rc=$?; if [[ "\${@: -1}" == */tmproots/.${COL_ID}.drop.* ]]; then`
      + ` sed 's/ run=7 / run=9 /' "\${@: -1}" > "$REG/tmproots/${COL_ID}"; fi; return $rc; };`;
    const r = collectVerb(h, collectToken(h), { pre: race });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['witness'], 'ours was the collected one').toBe('dropped');
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'the newer one stands').toMatch(/ run=9 /);
  });

  it.skipIf(ROOT)('a witness that cannot be moved aside keeps the record: quarantine-kept, the next pass finishes', () => {
    makeOrphan(h);
    const dir = path.dirname(witnessOf(h));
    try {
      const r = collectVerb(h, collectToken(h), { pre: gapAt('emptied', 'chmod 0500 "$REG/tmproots"') });
      expect(r.code).toBe(1);
      expect(docOf(r.stdout)['failed']).toBe('quarantine-kept');
    } finally { fs.chmodSync(dir, 0o700); }
    expect(records(h)).toHaveLength(1);
    expect(fs.existsSync(witnessOf(h))).toBe(true);
  });
});

describe.skipIf(!LINUX)('the witness writer’s dead temp files — the exact shape, an hour old, of this id, while the slug reads free', () => {
  const OLD = ['.demo-quiet-reef.123.456.tmp', '.demo-quiet-reef.v2-quiet-river.4242.17.tmp', '.demo-quiet-reef.1.2.3.tmp',
    '.demo-quiet-reef.12.tmp', '.demo-quiet-reef.drop.99', '.demo-quiet-other.1.2.tmp'];
  const FRESH = ['.demo-quiet-reef.123.457.tmp'];
  const plant = (): void => {
    const d = path.dirname(witnessOf(h));
    const old = Date.now() / 1000 - 7200;
    for (const n of OLD) { fs.writeFileSync(path.join(d, n), 'x'); fs.utimesSync(path.join(d, n), old, old); }
    for (const n of FRESH) fs.writeFileSync(path.join(d, n), 'x');
  };

  it('only `.<id>.<digits>.<digits>.tmp` at least an hour old goes', () => {
    makeOrphan(h);
    plant();
    const r = collectVerb(h, collectToken(h));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.readdirSync(path.dirname(witnessOf(h))).sort()).toEqual([...OLD.slice(1), ...FRESH].sort());
    expect(String(eventsOf(h.home, 'collect').at(-1)!['detail'])).toContain('1 stale witness temp file(s) removed');
  });

  it('none goes while the slug does not read free at that instant', () => {
    makeOrphan(h);
    plant();
    const r = collectVerb(h, collectToken(h), { pre: gapAt('witnessed', 'printf 8 > "$REG/$2.child"') });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(path.join(path.dirname(witnessOf(h)), OLD[0]!))).toBe(true);
  });
});
```

Create `server/test/ccd-ws-collect-resume.test.ts`:

```ts
// `ws-collect`'s resume (child reclamation wave 7, spec §5.2 and §5.6): a run that died anywhere leaves its
// quarantine RECORD, and the next pass resumes FROM IT — never recomputing the tree token or the idle floor (the
// move stamped the leaf's ctime), re-proving the slot's leaf against the record and step 5's proofs before anything
// is removed. A record not provably this verb's (its body names another id: the reader answers 2, ruling G5), or
// whose leaf is not the one it names, is never taken.
// A crash is the verb's process exiting inside a seam (`crashAt`): no trap runs, and the kernel frees the lock.
// FIXTURE HOME ONLY.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import {
  COL_ID, GAP_LOG, WRONG_TOKEN, collectAudit, collectToken, collectVerb, crashAt, docOf, evalSays, gaps, inoAt,
  makeOrphan, quarantineOf, records, recordsDir, regOf, slots, witnessOf,
} from './wsCollectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-collect-resume-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';
const recPath = (): string => path.join(recordsDir(h), records(h)[0]!);
const slotDir = (): string => path.join(quarantineOf(h), slots(h)[0]!);

describe.skipIf(!LINUX)('a run that died resumes FROM ITS RECORD', () => {
  it('died after the move: the next pass re-proves, removes and finishes — resumed, and no second record', () => {
    const o = makeOrphan(h);
    const r1 = collectVerb(h, collectToken(h), { pre: crashAt('moved') });
    expect(r1.code).toBe(137);
    expect(fs.existsSync(o.leaf)).toBe(false);
    expect(records(h)).toHaveLength(1);
    const name = records(h)[0]!;
    const r2 = collectVerb(h, collectToken(h), { pre: GAP_LOG });
    expect(r2.code, r2.stdout + r2.stderr).toBe(0);
    expect(docOf(r2.stdout)).toMatchObject({ collected: COL_ID, record: name, resumed: true, witness: 'dropped' });
    expect(gaps(h)).toEqual(['locked', 'consented', 'recorded', 'slotted', 'moved',
      'locked', 'consented', 'moved', 'proven', 'removed', 'emptied', 'witnessed', 'dropped']);
    expect(slots(h)).toEqual([]);
    expect(records(h)).toEqual([]);
    expect(fs.existsSync(witnessOf(h))).toBe(false);
    const ev = eventsOf(h.home, 'collect').slice(-2);
    expect(ev.map((e) => e['outcome'])).toEqual(['intent', 'done']);
    expect(measOf(ev[0]!)['resumed']).toBe(name);
  });

  it('a resume never re-asks the idle floor: the move stamped the leaf’s ctime, and the floor is back at its production value', () => {
    makeOrphan(h);
    expect(collectVerb(h, collectToken(h), { pre: crashAt('moved') }).code).toBe(137);
    const r = collectVerb(h, collectToken(h, { floor: false }), { floor: false });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)).toMatchObject({ collected: COL_ID, resumed: true });
  });

  it('died before the move (a record and an empty slot): the leaf keeps its place AND its witness; state-changed; then a fresh pass collects', () => {
    const o = makeOrphan(h);
    expect(collectVerb(h, collectToken(h), { pre: crashAt('slotted') }).code).toBe(137);
    expect(slots(h)).toHaveLength(1);
    expect(records(h)).toHaveLength(1);
    const r = collectVerb(h, collectToken(h));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('state-changed');
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(fs.readFileSync(witnessOf(h), 'utf8')).toBe(o.witness);
    expect(slots(h)).toEqual([]);
    expect(records(h)).toEqual([]);
    expect(docOf(collectVerb(h, collectToken(h)).stdout)).toMatchObject({ collected: COL_ID, resumed: false });
  });

  for (const [point, witness] of [['removed', 'dropped'], ['emptied', 'dropped'], ['witnessed', 'absent']] as const) {
    it(`died at ${point}: the order finishes from there — witness ${witness}, the record last`, () => {
      makeOrphan(h);
      expect(collectVerb(h, collectToken(h), { pre: crashAt(point) }).code).toBe(137);
      expect(records(h)).toHaveLength(1);
      const r = collectVerb(h, collectToken(h));
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(docOf(r.stdout)).toMatchObject({ collected: COL_ID, resumed: true, witness });
      expect(slots(h)).toEqual([]);
      expect(records(h)).toEqual([]);
    });
  }

  it('a resume re-proves step 5: a child that took the id after the crash stops it, and the leaf goes back', () => {
    const o = makeOrphan(h);
    expect(collectVerb(h, collectToken(h), { pre: crashAt('moved') }).code).toBe(137);
    const rec = recPath();
    fs.writeFileSync(path.join(regOf(h), `${COL_ID}.child`), '8\n');
    const r = collectVerb(h, WRONG_TOKEN, { pre: evalSays(WRONG_TOKEN, rec) });
    expect(docOf(r.stdout)['refused']).toBe('registered');
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(records(h)).toEqual([]);
  });
});

describe.skipIf(!LINUX)('a record that is not provably this verb’s is never taken', () => {
  it('a slot whose leaf is not the one its record names: quarantine-kept, nothing touched — at the audit and at the verb', () => {
    const o = makeOrphan(h);
    expect(collectVerb(h, collectToken(h), { pre: crashAt('moved') }).code).toBe(137);
    const slot = slotDir();
    fs.renameSync(path.join(slot, 'leaf'), path.join(slot, 'leaf.orig'));
    fs.mkdirSync(path.join(slot, 'leaf'));
    expect(JSON.parse(collectAudit(h).stdout.trim().split('\n').pop()!).verdict, 'the audit').toBe('quarantine-kept');
    const r = collectVerb(h, WRONG_TOKEN, { pre: evalSays(WRONG_TOKEN, recPath()) });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('quarantine-kept');
    expect(inoAt(path.join(slot, 'leaf.orig'))).toBe(o.ino);
    expect(fs.existsSync(path.join(slot, 'leaf'))).toBe(true);
    expect(records(h)).toHaveLength(1);
    expect(eventsOf(h.home, 'collect').at(-1)!['refusal']).toBe('quarantine-kept');
    expect(eventsOf(h.home, 'collect').filter((e) => e['outcome'] === 'intent'),
      'the verb journaled no second intent: it acted on nothing').toHaveLength(1);
  });

  it('a forged record — named for this id, its body naming another — is never taken, and what its slot holds stands', () => {
    const o = makeOrphan(h);
    const name = `${COL_ID}.1791000000000000000.4242`;
    const slot = path.join(quarantineOf(h), `slot.${name}`);
    fs.mkdirSync(quarantineOf(h), { mode: 0o700 });
    fs.mkdirSync(path.join(slot, 'leaf'), { recursive: true });
    fs.writeFileSync(path.join(slot, 'leaf', 'precious.txt'), 'not the collector’s\n');
    const st = fs.lstatSync(path.join(slot, 'leaf'), { bigint: true });
    const at = /at=(\d{13})/.exec(o.witness)![1]!;
    fs.mkdirSync(recordsDir(h), { recursive: true });
    const rec = path.join(recordsDir(h), name);
    fs.writeFileSync(rec, `v=1 id=demo-quiet-other dev=${st.dev} ino=${st.ino}`
      + ` btime=${st.birthtimeNs / 1_000_000_000n} run=7 at=${at} token=${WRONG_TOKEN} checkouts=\n`);
    // the CONTROL: Task 4's reader refuses the forgery whole (rc 2, every field cleared, ruling G5), so the verb's own
    // read of the record is what stands between it and an act
    expect(h.sh(`_ws_collect_record_read '${rec}'; printf '%s|%s' "$?" "$_WS_QREC_SLOT"`)).toBe('2|');
    const r = collectVerb(h, WRONG_TOKEN, { pre: evalSays(WRONG_TOKEN, rec) });
    expect(docOf(r.stdout)['refused']).toBe('quarantine-kept');
    expect(fs.readFileSync(path.join(slot, 'leaf', 'precious.txt'), 'utf8')).toBe('not the collector’s\n');
    expect(inoAt(o.leaf), 'the real leaf, untouched').toBe(o.ino);
  });
});
```

Then the standing scan, red first.

In `server/test/ccd-refusal-scan.test.ts` (`grep -n "const VERBS\|const SANCTIONED\|toBe(14)" server/test/ccd-refusal-scan.test.ts`; `:33`, `:57`, `:110` at `b0647d850`):

(a) Find:

```ts
/** D4's four destructive verbs, ws-reclaim (child reclamation, wave 3) as the fifth and ws-expire (workspace lifecycle, wave 3) as the sixth. Floors are measured minima, not guesses. */
```

Replace with:

```ts
/** D4's four destructive verbs, ws-reclaim (child reclamation, wave 3) as the fifth, ws-expire (workspace lifecycle, wave 3) as the sixth and ws-collect (child reclamation, wave 7) as the seventh. Floors are measured minima, not guesses. */
```

(b) Find:

```ts
  ['cmd_ws_expire', '_ws_expire_locked', 3200],
];
```

Replace with (write the number Step 5's measurement prints where `<N>` stands; the draft of Step 4 measured 4321):

```ts
  ['cmd_ws_expire', '_ws_expire_locked', 3200],
  // Measured <N> characters for cmd_ws_collect's pre-lock parse, population check and lock when this entry was written.
  ['cmd_ws_collect', '_ws_collect_locked', 3800],
];
```

(c) Change ` * THE FOURTEEN DIES A REFUSAL RECORD CANNOT DESCRIBE, each for one stated reason.` to ` * THE SIXTEEN DIES A REFUSAL RECORD CANNOT DESCRIBE, each for one stated reason.`, and ` * id is bound. The set is EXACT: a fifteenth sanctioned die reds the count.` to ` * id is bound. The set is EXACT: a seventeenth sanctioned die reds the count.`

(d) Find the docblock's last paragraph and its close:

```ts
 * Two are cmd_ws_expire's (workspace lifecycle, wave 3), for the same reasons: its usage line runs before $id is bound, and its _json_str probe is the emitter being missing. Its four --actor/--reason checks are the SAME literals as ws-reclaim's, and its "bad token" and "bad session id" the SAME as reap's, and need no second entry.
 */
```

Replace with:

```ts
 * Two are cmd_ws_expire's (workspace lifecycle, wave 3), for the same reasons: its usage line runs before $id is bound, and its _json_str probe is the emitter being missing. Its four --actor/--reason checks are the SAME literals as ws-reclaim's, and its "bad token" and "bad session id" the SAME as reap's, and need no second entry.
 *
 * Two are cmd_ws_collect's (child reclamation, wave 7), for ws-expire's reasons: its usage line runs before $id is bound, and its _json_str probe is the emitter being missing. Its four --actor/--reason checks, "bad token" and "bad session id" are the SAME literals and need no second entry; its "bad session id" also refuses a dot-leading id, which is no child's and no witness's.
 */
```

(e) Find:

```ts
  'die "python3 unavailable — cannot quote the expiry record safely"',
];
```

Replace with:

```ts
  'die "python3 unavailable — cannot quote the expiry record safely"',
  'die "usage: ccd ws-collect --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]"',
  'die "python3 unavailable — cannot quote the collection record safely"',
];
```

(f) Change `expect(SANCTIONED.length, 'the sanctioned set changed size').toBe(14);` to `… .toBe(16);`.

(g) Directly ABOVE `  it('the reclaim lock\'s two inner functions contain NO die — past the lock, a failure is _lc_fail and JSON', () => {`, insert:

```ts
  it('holds the collection emits at exactly two in ws-collect — one refusal point, one flock decline (child reclamation, wave 7)', () => {
    // `_ws_collect_refused` journals every refusal past the lock decline — the verdict point, and a refusal after a
    // PROVEN restore — through one `_lc_emit`; the lock decline in `cmd_ws_collect` is the second. Comment lines are
    // not code.
    const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect([...code.matchAll(/_lc_emit collect refused "\$id" "[^"]*" verb ws-collect /g)]).toHaveLength(2);
  });

  it('the collector’s locked functions contain NO die — past the lock, a failure is _ws_reclaim_fail and JSON', () => {
    for (const [name, floor] of [
      ['_ws_collect_locked', 1800], ['_ws_collect_fresh', 4000], ['_ws_collect_resume', 2600],
      ['_ws_collect_after_move', 1800], ['_ws_collect_finish', 1500],
    ] as const) {
      const from = src.indexOf(`${name}() {`);
      const body = from > -1 ? src.slice(from, src.indexOf('\n}\n', from)) : '';
      expect(body.length, `${name} could not be sliced`).toBeGreaterThan(floor);
      expect([...body.matchAll(/(^|\s|\|\|\s*|;\s*)die "/g)].map((m) => lineAt(body, m.index!)),
        `${name} grew a die — past the lock, route it through _ws_reclaim_fail and the "failed" document`).toEqual([]);
    }
  });

```

The five floors in (g), and (b)'s 3800, are the draft's. Ruling G3's rewrite moved the move, its proof, the identity and the registry question out of this block, so the functions shrank: Step 5 re-measures every slice and writes each floor from that measurement.

(h) In `it('holds literal refusal arguments set-equal to the vocabularies in both directions', …)`, directly BELOW the line `    for (const m of src.matchAll(/_lc_emit\s+[a-z-]+\s+refused\s+"[^"]*"\s+""\s+verb\s+[a-z-]+\s+refusal\s+([a-z][a-z0-9-]*)/g)) found.add(m[1]!);`, insert the lines below. Ruling G2: `not-witnessed`, `registered` and `not-idle` are declared in this commit, and `registered` and `not-idle` reach the journal through a VARIABLE at the verb's one refusal point (ruling G11), so their literal sites are the evaluation's `_ws_collect_refuse <word>` lines in Task 5's block, inside the COLLECT region:

```ts
    // THE COLLECTOR (child reclamation wave 7). `ws-collect` journals every refusal at its ONE refusal point,
    // `_ws_collect_refused id tx <word> …`; the evaluation it shares with `ws-audit --collect` answers through
    // `_ws_collect_refuse <word> …`, and the verb journals that word at the same point. Both are literal positions,
    // read inside the COLLECT region only; each regex requires `\s` right after its name, so neither meets the other.
    const collect = src.slice(src.indexOf('COLLECT-BEGIN'), src.indexOf('COLLECT-END'));
    expect(collect.length, 'the COLLECT region was found — an empty cut harvests nothing').toBeGreaterThan(20000);
    for (const m of collect.matchAll(/_ws_collect_refuse\s+([a-z][a-z0-9-]*)/g)) found.add(m[1]!);
    for (const m of collect.matchAll(/_ws_collect_refused\s+"[^"]*"\s+"[^"]*"\s+([a-z][a-z0-9-]*)/g)) found.add(m[1]!);
```

`server/test/macos-platform.test.ts` is NOT edited by this task: Task 4 exempts `_ws_collect_mv` by name and pins it as one function and one spelling (ruling G3), and this block spells no `mv -T`.

- [ ] **Step 3: Run the tests to verify they fail**

Each in the FOREGROUND, timeout ≥ 600000 ms, from `server/`:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-verb.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-move.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-reprove.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-order.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-resume.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts
```

Expected: FAIL.
- **The five collect files:** every case that calls the verb reads `bash: cmd_ws_collect: command not found` as rc 127, so it fails as `expected 127 to be 0` (or `… to be 1`), or `docOf` throws `Unexpected end of JSON input` on an empty stdout. The encoder case fails `expected '127' to be '1'` (`_ws_collect_mounts_clear: command not found`). The three declaration cases fail `expected false to be true`. The verb file's first CONTROL case PASSES already: it pins Task 5's evaluation (`collectable|<ino>||present`), and so does "the registry question itself" (Task 5's `_ws_collect_registered`). If either fails, STOP — E2's contract does not hold.
- **`ccd-refusal-scan`:** `cmd_ws_collect's body could not be sliced (looked for _ws_collect_locked): expected 0 to be greater than 3800`; `a sanctioned die that no longer exists: expected [ 'die "usage: ccd ws-collect …"', 'die "python3 unavailable — cannot quote the collection record safely"' ] to deeply equal []`; the emit count `expected [] to have a length of 2`; `_ws_collect_locked could not be sliced`; and the harvest, which now reads Task 5's `_ws_collect_refuse` lines, `tokens no vocabulary owns: expected [ 'not-idle', 'not-witnessed', 'registered' ] to deeply equal []`.

- [ ] **Step 4: Implement the verb**

Insert the block below into `ccd/ccd` as ONE contiguous block, far below the frozen boundary `B` (E9), INSIDE the COLLECT region Task 4 opened: directly ABOVE the line that starts `# ── end temp-root collection` and ends `COLLECT-END ──` (`grep -n 'COLLECT-END' ccd/ccd`, one line by E6b), and so below Task 5's `ws-audit --collect` block, which ends `WS-AUDIT-COLLECT-CLOSE ──`. NEVER inside `RECLAIM-BEGIN…RECLAIM-END`, `MIRROR-BEGIN…MIRROR-END` or `EXPIRE-BEGIN…EXPIRE-END` (`grep -n 'RECLAIM-BEGIN\|RECLAIM-END\|MIRROR-BEGIN\|MIRROR-END\|EXPIRE-BEGIN\|EXPIRE-END' ccd/ccd`). `cmd_ws_collect` and `_ws_collect_locked` must stay adjacent, in that order: `ccd-refusal-scan` slices one up to the other. The block spells no `_reap_refuse <word>` and no literal `"refused":"<word>"` but the flock decline's `in-progress`, which `SENTENCES` already owns, so `wsaudit.test.ts` and `ccd-wsaudit-nonpoison.test.ts` count nothing new. Its refusal words sit at two literal positions the cross-language harvest reads — `_ws_reclaim_fail`'s third argument and `_ws_collect_refused`'s third argument (Step 2 (h)) — and a word it journals through a variable (`registered`, `not-idle`, from the evaluation or the re-proof) has its literal site at Task 5's `_ws_collect_refuse <word>`, which (h) reads too. No code line spells `tmpquarantine`: `$(_ws_collect_qrec_dir)` names it.

The draft of this block was exercised in a scratch fixture HOME with Task 4's and Task 5's functions stubbed (the happy path; a crash at `slotted`, `moved`, `removed`, `emptied` and `witnessed`, each resumed; a restore on each re-proof; a retaken path; a pre-existing slot; a copying, a no-op and an EXDEV `mv`; a rewritten and a racing witness; the temp-file shapes; `$REG` at 0300 with and without the listing control). The reconciliation of rulings G1–G12 and of the Task 6 and Task 8 rulings then rewrote steps 2 to 5, the restore, the resume and the witness-only arm onto Task 4's and Task 5's canonical functions WITHOUT re-running that harness: every case below is the worker's to measure, and a case that disagrees with this text is reported, never bent.

```bash
# ── ws-collect: the temp-root collector's destructive verb (child reclamation wave 7, spec §5.2, §5.6) ──
# An ORPHANED temp root — a child's `$HOME/.cc-tmp/<id>` whose registry row is
# gone (a human verb, or a reclaim tail that KEPT it) — is collected by this
# verb and by nothing else, and the verb is composed by the server alone
# (CLAUDE.md SAFETY). Its population is a WITNESSED id or a QUARANTINE RECORD
# (spec §5.2). Its consent is `ws-audit --collect`'s token, recomputed inside
# the reap lock by the same evaluation (`_ws_collect_fork`) — the witness, the
# registry, the in-use probe, the row rule and the idle floor, or a record and
# the phase it stands at — BEFORE anything moves. Then:
#   2  lstat the leaf: a real directory with the witness's dev, ino and birth time;
#   3  the checkout question of the ORIGINAL path, the quarantine record, the slot;
#   4  ONE rename into `<physical ~/.cc-tmp>/.ccd-quarantine/slot.<id>.<ns>.<pid>/leaf`
#      (Task 4's `_ws_collect_move`), proven by lstat, never by mv's exit code;
#   5  re-prove after the move (`_ws_collect_reprove`); any doubt moves it BACK;
#   6  remove the slot's leaf through the ONE removal helper (`_ws_leaf_remove`);
# and then spec §5.6's order: the slot's leaf proven gone, the empty slot
# rmdir'd (never a recursive remove), the witness compared and dropped, and
# the record dropped LAST. A witness whose leaf is PROVEN absent, with no
# record standing, is collected by compare-and-drop alone: nothing moves.
# WHY A RENAME: a recycled slug's `_child_tmpdir` hands out `<root>/<id>` with
# `mkdir -p`, which ADOPTS whatever stands there, and takes no lock this verb
# takes. But every hand-out reads `.child` first, so a spawn before the move
# is seen by step 5's direct lookup, a spawn after it gets a new inode, and
# step 6 removes only the slot's inode, dev:ino-checked. The move stamps the
# leaf's ctime, so neither the tree token nor the idle floor is asked after
# it: a leaf moved back waits a fresh floor.
# THE RECORD (`$REG/tmpquarantine/<id>.<ns>.<pid>`) is resume authority, never
# the journal: a run that dies anywhere leaves it, and the next audit visits it
# whatever the witness now says. A record this verb can neither finish nor
# undo is KEPT, with its slot, for the operator: never emptied, never taken.
# So is anything in a slot that is not the witnessed leaf, and a leaf whose
# original path was taken again since the move: those are TERMINAL refusals.
# LINUX-FIRST: off Linux, or with an mv that offers no `--no-copy`, nothing moves.

# THE SEAM at each step boundary: `point id [slot]`. Nothing on the box; a test
# redefines it to force a race or a crash into that exact gap. Its points, in
# order: locked consented recorded slotted moved proven removed emptied
# witnessed dropped, and restoring before any move back (ruling G7).
_ws_collect_gap() { :; }

# THE ONE MOVE, ITS PROOF AND THE IDENTITY are Task 4's (`_ws_collect_move`,
# `_ws_collect_mv`, `_ws_collect_mv_ok`, `_ws_collect_ident`: ruling G3), and
# the registry question is Task 5's (`_ws_collect_registered`). This block
# defines none of them again: a second definition would replace the first.

# THE SEAM, as `_ws_path_users_proc_root` is the in-use probe's: a test names a
# fake mount table, and the box answers its own.
_ws_collect_mountinfo() { printf '%s' /proc/self/mountinfo; }
_WS_MOUNTS_WHY=''
_ws_collect_mounts_clear() {   # dir -> 0 when no mount point is at dir or under it; 1 one is; 2 unmeasured: the table
  #                                could not be read, or held a line that is not a mount, or none (_WS_MOUNTS_WHY)
  # `dir` is PHYSICAL. A mount inside the leaf moves with it, and `rm
  # --one-file-system` stops at another file system's but CROSSES a bind mount
  # of the same one, deleting its source's content (spec §5.6's stated limit).
  # The table is the kernel's for ccd's own mount namespace; its fifth field is
  # the mount point with space, tab, newline and backslash written as \040,
  # \011, \012 and \134 — so `dir` is ENCODED the same way and the two are
  # compared as text, never decoded.
  local dir="${1%/}" mi enc fd line mp n=0
  _WS_MOUNTS_WHY=''
  mi=$(_ws_collect_mountinfo)
  enc="${dir//\\/\\134}"; enc="${enc// /\\040}"; enc="${enc//$'\t'/\\011}"; enc="${enc//$'\n'/\\012}"
  { exec {fd}<"$mi"; } 2>/dev/null \
    || { _WS_MOUNTS_WHY="$mi could not be read, so whether anything is mounted under $dir was never asked"; return 2; }
  while IFS= read -r line <&"$fd" || [[ -n "$line" ]]; do
    mp=''
    [[ "$line" != *' - '* ]] || read -r _ _ _ _ mp _ <<< "$line"
    if [[ "$mp" != /* ]]; then
      { exec {fd}<&-; } 2>/dev/null || :
      _WS_MOUNTS_WHY="$mi holds a line that is not a mount, so the table was never read whole"; return 2
    fi
    n=$(( n + 1 ))
    if [[ "$mp" == "$enc" || "$mp" == "$enc/"* ]]; then
      { exec {fd}<&-; } 2>/dev/null || :
      _WS_MOUNTS_WHY="something is mounted at $mp, at or under $dir — ccd never removes across a mount"; return 1
    fi
  done
  { exec {fd}<&-; } 2>/dev/null || :
  (( n > 0 )) || { _WS_MOUNTS_WHY="$mi listed no mount at all, so the table was never read"; return 2; }
  return 0
}

_WS_REPROVE_WORD=''; _WS_REPROVE_WHY=''
_ws_collect_reprove() {   # id slotleaf dev:ino btime -> 0 when every proof after the move holds; 1 one answered a
  #                            doubt (_WS_REPROVE_WORD, _WS_REPROVE_WHY); 2 one could not be asked (_WS_REPROVE_WHY)
  # STEP 5 (spec §5.6), never the tree token or the idle floor (the move
  # stamped the leaf's ctime). Identity is asked LAST, so the removal that
  # follows runs directly after an lstat of the slot's leaf in this lock.
  local id="$1" sl="$2" want="$3" bt="$4" rc s
  _WS_REPROVE_WORD=''; _WS_REPROVE_WHY=''
  # (a) and (b) — THE REGISTRY, by Task 5's `_ws_collect_registered`: `.child`
  # and `.uuid` by DIRECT lookup (the read `_child_tmpdir` makes, which sees
  # them whether or not `$REG` can be listed), then the slug, believed only
  # when a wildcard listing shows the reap lock this verb holds.
  _ws_collect_registered "$id"; rc=$?
  (( rc != 1 )) || { _WS_REPROVE_WORD=registered; _WS_REPROVE_WHY="$_WS_COLLECT_REG_WHY"; return 1; }
  (( rc != 2 )) || { _WS_REPROVE_WHY="$_WS_COLLECT_REG_WHY"; return 2; }
  # (c) nobody uses it, on BOTH spellings: the path TMPDIR names (the probe's
  # string arm, and its physical twin), and the slot's leaf (a cwd or an open
  # file follows a rename).
  for s in "$HOME/.cc-tmp/$id" "$sl"; do
    _ws_path_users "$s"; rc=$?
    (( rc != 1 )) || { _WS_REPROVE_WORD=in-use; _WS_REPROVE_WHY="$_WS_PATH_USERS_WHY"; return 1; }
    (( rc != 2 )) || { _WS_REPROVE_WHY="$_WS_PATH_USERS_WHY"; return 2; }
  done
  # (d) no registry row at, inside or through the leaf, on its PRE-MOVE
  # spelling: the LOGICAL one `_child_tmpdir` hands out, which the rule
  # compares LITERALLY though nothing stands there now (ruling G6).
  _ws_collect_rows_clear "$id" "$HOME/.cc-tmp/$id"; rc=$?
  (( rc != 1 )) || { _WS_REPROVE_WORD=containment-unproven; _WS_REPROVE_WHY="${_WS_COLLECT_ROWS_WHY-}"; return 1; }
  (( rc != 2 )) || { _WS_REPROVE_WHY="${_WS_COLLECT_ROWS_WHY-}"; return 2; }
  # (e) nothing mounted at or under the slot's leaf. A mount there is no doubt
  # about whose the leaf is, but a removal ccd cannot make safely: the leaf
  # goes back, and the answer is unmeasured (ruling T6 OPEN8).
  _ws_collect_mounts_clear "$sl"; rc=$?
  (( rc == 0 )) || { _WS_REPROVE_WHY="$_WS_MOUNTS_WHY"; return 2; }
  # (f) LAST: the slot's leaf is still the witnessed one. What is not is never
  # moved back to the id's path: the caller KEEPS it (ruling T8 OPEN5).
  _ws_collect_ident "$sl" "$want" "$bt"; rc=$?
  (( rc != 0 )) || return 0
  (( rc != 2 )) || { _WS_REPROVE_WHY="the identity of $sl could not be read"; return 2; }
  _WS_REPROVE_WORD=quarantine-kept
  _WS_REPROVE_WHY="$sl is not the witnessed directory $want born $bt — something else stands in the slot"
  return 1
}

_ws_collect_unwind() {   # slot rec -> 0 when the slot, where it stands, was removed EMPTY and the record dropped; else 1
  # Never a recursive remove: a slot that holds anything is not this verb's to empty.
  local slot="$1" rec="$2" rc
  _ws_reclaim_absent "$slot"; rc=$?
  if (( rc == 1 )); then
    rmdir -- "$slot" 2>/dev/null || return 1
    _ws_reclaim_absent "$slot" || return 1
  elif (( rc == 2 )); then
    return 1
  fi
  _ws_collect_record_drop "$rec"
}

_ws_collect_keep() {   # id rec lctx why -> journals and prints the failure that KEEPS a quarantine record; always rc 1
  # A KEPT RECORD HAS AN OWNER, the operator, told on every audit: nothing in
  # the record or its slot is removed here, and no session acts on one (spec §5.6).
  _ws_reclaim_fail "$1" "$3" quarantine-kept \
    "$(_ws_leaf_why_line "$4 — the quarantine record $2 is kept, with its slot where it stands; nothing in either was removed")"
}

_ws_collect_putback() {   # id slot rec orig lctx why surface actor reason -> 0 when the slot's leaf is back at orig,
  #                            PROVEN, and the slot and the record are cleared; 2 when orig was taken again since the
  #                            move (`refused quarantine-kept` printed: TERMINAL); 1 otherwise, KEPT (`failed
  #                            quarantine-kept` printed)
  # THE RESTORE is Task 4's `_ws_collect_move` reversed, with the RECORD's
  # identity, never whatever happens to stand in the slot: one NOREPLACE
  # rename, proven by lstat (the original path is that directory again, and
  # nothing stands at the slot's leaf). NOREPLACE: a path retaken since the
  # move is never clobbered, and that record is the operator's (ruling T8 OPEN4).
  local id="$1" slot="$2" rec="$3" orig="$4" lctx="$5" why="$6" mrc arc=0
  _ws_collect_gap restoring "$id" "$slot"
  _ws_collect_move "$slot/leaf" "$orig" "${_WS_QREC_DEV-}:${_WS_QREC_INO-}" "${_WS_QREC_BTIME-}"; mrc=$?
  if (( mrc == 0 )); then
    _ws_collect_unwind "$slot" "$rec" && return 0
    _ws_collect_keep "$id" "$rec" "$lctx" "$why — $id is back at $orig, but its slot $slot or its record could not be cleared"
    return 1
  fi
  if (( mrc == 1 )); then _ws_reclaim_absent "$orig"; arc=$?; fi
  if (( mrc == 1 && arc == 1 )); then
    _ws_collect_refused "$id" "$lctx" quarantine-kept \
      "$why — and $orig was taken again since the move, so the leaf cannot go back: it is kept in $slot with the quarantine record $rec, listed for the operator; nothing was removed" \
      "$7" "$8" "$9"
    return 2
  fi
  _ws_collect_keep "$id" "$rec" "$lctx" "$why — and what $slot/leaf holds could not be proven back at $orig${_WS_MOVE_WHY:+ ($_WS_MOVE_WHY)}"
  return 1
}

_WS_CAD=''; _WS_CAD_WHY=''
_ws_collect_witness_cad() {   # id dev ino btime run at -> 0 with _WS_CAD = dropped (it was the collected one), kept
  #                                (it is not, and is back) or absent; 2 unmeasured (_WS_CAD_WHY)
  # COMPARE-AND-DROP (spec §5.2). The witness writer replaces the file with an
  # unlocked temp-file-then-`mv -f`, so a read-then-`rm -f` of the live name
  # can delete a recycled spawn's FRESH witness. So the live name is moved
  # aside by one NOREPLACE rename to a dot-leading name no reader takes for an
  # id, the moved copy is read, and it is unlinked only when it is, field for
  # field, the witness this collection acted on. Anything else is moved back.
  local id="$1" dev="$2" ino="$3" bt="$4" run="$5" at="$6" w aside line='' mid pre suf rc
  _WS_CAD=''; _WS_CAD_WHY=''
  w=$(_ws_tmproot_witness_file "$id")
  [[ ! -L "${w%/*}" ]] || { _WS_CAD_WHY="${w%/*} is a link, never followed"; return 2; }
  _ws_reclaim_absent "$w"; rc=$?
  (( rc != 0 )) || { _WS_CAD=absent; return 0; }
  (( rc != 2 )) || { _WS_CAD_WHY="$_WS_ABSENT_WHY"; return 2; }
  aside="${w%/*}/.$id.drop.$BASHPID"
  _ws_reclaim_absent "$aside" || { _WS_CAD_WHY="$aside already stands, so the witness was not moved aside"; return 2; }
  _ws_collect_mv "$w" "$aside" 2>/dev/null || :
  if [[ ! -f "$aside" || -L "$aside" ]]; then
    if [[ -e "$aside" || -L "$aside" ]]; then _ws_collect_mv "$aside" "$w" 2>/dev/null || :; fi
    _WS_CAD_WHY="$w could not be moved aside to $aside"; return 2
  fi
  if _ws_leaf_read_small "$aside"; then line="${_WS_SMALL%$'\n'}"; fi
  pre="v=1 id=$id run=$run dev=$dev ino=$ino btime=$bt uid="; suf=" at=$at"
  mid="${line#"$pre"}"; mid="${mid%"$suf"}"
  if [[ "$line" != *$'\n'* && "$line" == "$pre"*"$suf" && "$mid" =~ ^[0-9]+$ ]]; then
    rm -f -- "$aside" 2>/dev/null || :
    _ws_reclaim_absent "$aside" \
      || { _WS_CAD_WHY="$aside, the collected witness moved aside, could not be unlinked"; return 2; }
    _WS_CAD=dropped; return 0
  fi
  _ws_collect_mv "$aside" "$w" 2>/dev/null || :
  _ws_reclaim_absent "$aside" \
    || echo "ccd: warn: $id's witness $w is not the one this collection acted on, and a newer one stands — the older is left at $aside, inert (no reader takes a dot-leading name for an id)" >&2
  _WS_CAD=kept; return 0
}

_WS_COLLECT_TEMPS_REMOVED=0
_ws_collect_reap_temps() {   # id -> the witness writer's DEAD temp files of this id removed (_WS_COLLECT_TEMPS_REMOVED);
  #                             never the act's answer: always rc 0
  # A writer killed between its `printf` and its `mv` leaves
  # `tmproots/.<id>.<pid>.<rand>.tmp` (spec §5.2). Under this id's reap lock,
  # and only while its slug reads free, a file goes when its name is EXACTLY
  # that shape — the id matched literally, then two all-digit fields; never an
  # `<id>.*` prefix, because ids admit dots and `.<id>.v2-x.1.2.tmp` is another
  # id's — and its mtime is at least an hour old (a live write takes
  # milliseconds). A temp file of an id with no witness is never visited.
  local id="$1" dir="$REG/tmproots" f base rest m now re='^[0-9]+\.[0-9]+\.tmp$'
  _WS_COLLECT_TEMPS_REMOVED=0
  [[ -d "$dir" && ! -L "$dir" ]] || return 0
  _ws_collect_registered "$id" || return 0
  now=$(date +%s) || return 0
  [[ "$now" =~ ^[0-9]+$ ]] || return 0
  for f in "$dir/.$id".*.tmp; do
    [[ -f "$f" && ! -L "$f" ]] || continue
    base="${f##*/}"
    [[ "$base" == ".$id."* ]] || continue
    rest="${base#".$id."}"
    [[ "$rest" =~ $re ]] || continue
    m=$(_plat_mtime "$f" 2>/dev/null) || continue
    [[ "$m" =~ ^[0-9]+$ ]] && (( now - m >= 3600 )) || continue
    rm -f -- "$f" 2>/dev/null && _WS_COLLECT_TEMPS_REMOVED=$(( _WS_COLLECT_TEMPS_REMOVED + 1 ))
  done
  return 0
}

_ws_collect_refused() {   # id tx word detail surface actor reason -> ws-collect's ONE refusal past its flock decline,
  #                            journaled and printed from one detail; rc 0
  # The verdict point before anything moved (no tx), and a refusal after a
  # PROVEN restore (the intent's tx, which this closes). The word is always an
  # argument, so no refusal scan harvests a literal from here.
  local id="$1" tx="$2" word="$3" detail="$4"
  _lc_emit collect refused "$id" "$tx" verb ws-collect refusal "$word" detail "$(_ws_leaf_why_line "$detail")" \
    dec.surface "$5" dec.actor "$6" dec.reason "$7"
  printf '{"refused":%s,"detail":%s,"paths":[]}\n' "$(_json_str "$word")" "$(_json_str "$detail")"
  return 0
}

_ws_collect_witness_only() {   # id surface actor reason — a witness whose leaf the evaluation PROVED absent, with no
  #                                record standing: compare-and-drop and the temp-file reap alone; 0 collected | 1 failed
  # NOTHING MOVES AND NOTHING IS REMOVED but the witness this collection acted
  # on (`_WS_WIT_*`, read by the evaluation in this lock): no quarantine, no
  # record and no slot are made for a leaf that is not there (spec §5.10).
  local id="$1" surface="$2" actor="$3" reason="$4" lctx
  lctx=$(_lc_tx)
  _lc_intent collect "$id" "$lctx" verb ws-collect \
    detail "$(_ws_leaf_why_line "no leaf stands at $HOME/.cc-tmp/$id: dropping its witness")" \
    dec.surface "$surface" dec.actor "$actor" dec.reason "$reason"
  _ws_collect_witness_cad "$id" "${_WS_WIT_DEV-}" "${_WS_WIT_INO-}" "${_WS_WIT_BTIME-}" "${_WS_WIT_RUN-}" "${_WS_WIT_AT-}" \
    || { _ws_reclaim_fail "$id" "$lctx" probe-unmeasured "$(_ws_leaf_why_line "the witness of $id, whose leaf is gone, could not be compared and dropped: $_WS_CAD_WHY — nothing was removed")"; return 1; }
  _ws_collect_gap witnessed "$id"
  _ws_collect_reap_temps "$id"
  _lc_done collect "$id" "$lctx" verb ws-collect meas.resumed "" \
    detail "$(_ws_leaf_why_line "witness $_WS_CAD; $_WS_COLLECT_TEMPS_REMOVED stale witness temp file(s) removed; no leaf stood at $HOME/.cc-tmp/$id")"
  printf '{"collected":%s,"record":null,"resumed":false,"witness":%s}\n' "$(_json_str "$id")" "$(_json_str "$_WS_CAD")"
  return 0
}

_ws_collect_finish() {   # id rec slot lctx resumed — spec §5.6's order, from the leaf's absence to the record's drop
  local id="$1" rec="$2" slot="$3" lctx="$4" resumed="$5" rc cad
  # the slot's leaf, PROVEN gone
  _ws_reclaim_absent "$slot/leaf"; rc=$?
  (( rc == 0 )) || { _ws_collect_keep "$id" "$rec" "$lctx" "$slot/leaf is not proven gone${_WS_ABSENT_WHY:+ ($_WS_ABSENT_WHY)}"; return 1; }
  # the EMPTY slot, by rmdir — never a recursive remove: what else it holds is not this verb's
  _ws_reclaim_absent "$slot"; rc=$?
  if (( rc == 1 )); then
    rmdir -- "$slot" 2>/dev/null || :
    _ws_reclaim_absent "$slot"; rc=$?
  fi
  (( rc == 0 )) \
    || { _ws_collect_keep "$id" "$rec" "$lctx" "the slot $slot could not be removed empty: it holds something this verb did not put there, or could not be looked at"; return 1; }
  _ws_collect_gap emptied "$id" "$slot"
  # the witness, compared and dropped
  _ws_collect_witness_cad "$id" "${_WS_QREC_DEV-}" "${_WS_QREC_INO-}" "${_WS_QREC_BTIME-}" "${_WS_QREC_RUN-}" "${_WS_QREC_AT-}" \
    || { _ws_collect_keep "$id" "$rec" "$lctx" "the leaf is gone, but its witness could not be compared and dropped: $_WS_CAD_WHY"; return 1; }
  cad="$_WS_CAD"
  _ws_collect_gap witnessed "$id" "$slot"
  _ws_collect_reap_temps "$id"
  # the record, LAST
  _ws_collect_record_drop "$rec" \
    || { _ws_collect_keep "$id" "$rec" "$lctx" "the leaf is gone and its witness $cad, but the record could not be dropped"; return 1; }
  _ws_collect_gap dropped "$id" "$slot"
  _lc_done collect "$id" "$lctx" verb ws-collect meas.resumed "$resumed" \
    detail "$(_ws_leaf_why_line "witness $cad; $_WS_COLLECT_TEMPS_REMOVED stale witness temp file(s) removed; collected $slot/leaf (record ${rec##*/})")"
  printf '{"collected":%s,"record":%s,"resumed":%s,"witness":%s}\n' "$(_json_str "$id")" "$(_json_str "${rec##*/}")" \
    "$( [[ -n "$resumed" ]] && echo true || echo false )" "$(_json_str "$cad")"
  return 0
}

_ws_collect_after_move() {   # id rec orig lctx resumed surface actor reason — steps 5 and 6, then the order to the end
  # From here on the RECORD is the authority, on both arms: it is read here.
  local id="$1" rec="$2" orig="$3" lctx="$4" resumed="$5" surface="$6" actor="$7" reason="$8"
  local slot dev ino bt rc prc why
  _ws_collect_record_read "$rec" \
    || { _ws_collect_keep "$id" "$rec" "$lctx" "the quarantine record could not be read back after the move"; return 1; }
  slot="${_WS_QREC_SLOT-}"; dev="${_WS_QREC_DEV-}"; ino="${_WS_QREC_INO-}"; bt="${_WS_QREC_BTIME-}"
  # 5 — RE-PROVE after the move. Any doubt moves the leaf back, and only a
  # PROVEN restore clears the slot and the record. A slot's leaf that is not
  # the witnessed one is never moved back: it is KEPT (ruling T8 OPEN5).
  _ws_collect_reprove "$id" "$slot/leaf" "$dev:$ino" "$bt"; rc=$?
  if (( rc != 0 )); then
    why="$_WS_REPROVE_WHY"
    if (( rc == 1 )) && [[ "$_WS_REPROVE_WORD" == quarantine-kept ]]; then
      _ws_collect_refused "$id" "$lctx" quarantine-kept \
        "$why — it is kept in $slot with the quarantine record $rec, listed for the operator; nothing was moved back or removed" \
        "$surface" "$actor" "$reason"
      return 0
    fi
    _ws_collect_putback "$id" "$slot" "$rec" "$orig" "$lctx" "$why" "$surface" "$actor" "$reason"; prc=$?
    (( prc != 2 )) || return 0
    (( prc == 0 )) || return 1
    if (( rc == 2 )); then
      _ws_reclaim_fail "$id" "$lctx" probe-unmeasured \
        "$(_ws_leaf_why_line "$why — so $id was moved back to $orig, and nothing was removed")"
      return 1
    fi
    _ws_collect_refused "$id" "$lctx" "$_WS_REPROVE_WORD" "$why — so $id was moved back to $orig, and nothing was removed" \
      "$surface" "$actor" "$reason"
    return 0
  fi
  _ws_collect_gap proven "$id" "$slot"
  # 6 — remove the slot's leaf, DIRECTLY after step 5's last proof (an lstat of
  # it, in this lock), through the ONE removal helper: the witness's dev:ino,
  # and the ALIAS (the PHYSICAL pre-move spelling and the checkouts the
  # pre-move question accepted, from the record: ruling G8), so its checkout
  # question reads the moved tree as the question before the move read it, and
  # no wider.
  _ws_leaf_remove "$slot" leaf "$dev:$ino" "$orig" "${_WS_QREC_CHECKOUTS-}"; rc=$?
  case "$rc" in
    0) : ;;
    1) # A REFUSAL, nothing under the leaf removed: it goes back by a PROVEN
       # restore and the answer is containment-unproven, or it is kept (ruling T6 OPEN11).
       why="$_WS_LEAF_WHY"
       _ws_collect_putback "$id" "$slot" "$rec" "$orig" "$lctx" "$why" "$surface" "$actor" "$reason"; prc=$?
       (( prc != 2 )) || return 0
       (( prc == 0 )) || return 1
       _ws_collect_refused "$id" "$lctx" containment-unproven "$why — so $id was moved back to $orig" \
         "$surface" "$actor" "$reason"
       return 0 ;;
    *) _ws_collect_keep "$id" "$rec" "$lctx" "$_WS_LEAF_WHY"; return 1 ;;
  esac
  _ws_collect_gap removed "$id" "$slot"
  _ws_collect_finish "$id" "$rec" "$slot" "$lctx" "$resumed"
}

_ws_collect_fresh() {   # id q orig lctx surface actor reason — steps 2 to 4 of a fresh collection, then the rest
  # The witness's fields and the token are the ones the evaluation's consent
  # bound (`_ws_collect_fork`, in this lock, a moment ago): the record holds exactly those.
  local id="$1" q="$2" orig="$3" lctx="$4" surface="$5" actor="$6" reason="$7"
  local dev="${_WS_WIT_DEV-}" ino="${_WS_WIT_INO-}" bt="${_WS_WIT_BTIME-}" run="${_WS_WIT_RUN-}" at="${_WS_WIT_AT-}" token="${REAP_TOKEN-}"
  local name slot rec rc why
  # 2 — LSTAT THE LEAF (Task 4's `_ws_collect_ident`): a real directory with
  # the witness's identity. A link, a file or a mismatch is never moved and
  # never unlinked: it is the operator's.
  _ws_collect_ident "$orig" "$dev:$ino" "$bt"; rc=$?
  case "$rc" in
    0) : ;;
    1) _ws_collect_refused "$id" "" witness-mismatch \
         "$orig is not the real directory its witness names ($dev:$ino, born $bt) — a leaf that is not the witnessed one is never moved and never unlinked; it is the operator's" \
         "$surface" "$actor" "$reason"
       return 0 ;;
    *) _ws_reclaim_fail "$id" "" probe-unmeasured "$(_ws_leaf_why_line "the identity of $orig could not be read — nothing was moved")"; return 1 ;;
  esac
  # 3a — THE CHECKOUT QUESTION, of the ORIGINAL path, before anything moves.
  # Anything but 0 stops here; the record notes each outside admin directory it
  # accepted by back-link, which is all the alias may accept after the move.
  _ws_leaf_checkouts "$orig"; rc=$?
  case "$rc" in
    0) : ;;
    1) _ws_collect_refused "$id" "" containment-unproven "$_WS_CHECKOUTS_WHY — nothing was moved" "$surface" "$actor" "$reason"
       return 0 ;;
    *) _ws_reclaim_fail "$id" "" probe-unmeasured "$(_ws_leaf_why_line "$_WS_CHECKOUTS_WHY — nothing was moved")"; return 1 ;;
  esac
  # 3b — THE RECORD, before the slot and the move: a failed write stops here.
  # The slot is NAMED first, not made (Task 4's `_ws_collect_slot_path`): the
  # record's name is the slot's, less `slot.`, which pairs the two.
  _ws_collect_slot_path "$q" "$id" \
    || { _ws_reclaim_fail "$id" "" probe-unmeasured "no quarantine slot could be named for $id (its id or the clock could not be used) — nothing was moved"; return 1; }
  slot="$_WS_SLOT"; name="${_WS_SLOT##*/slot.}"
  rec="$(_ws_collect_qrec_dir)/$name"
  _ws_collect_record_write "$id" "$slot" "$token" \
    || { _ws_reclaim_fail "$id" "" probe-unmeasured "$(_ws_leaf_why_line "the quarantine record for $id could not be written${_WS_QREC_WHY:+ ($_WS_QREC_WHY)} — nothing was moved")"; return 1; }
  _ws_collect_gap recorded "$id" "$slot"
  if ! _ws_collect_record_read "$rec" || [[ "${_WS_QREC_ID-}" != "$id" || "${_WS_QREC_SLOT-}" != "$slot" \
       || "${_WS_QREC_DEV-}" != "$dev" || "${_WS_QREC_INO-}" != "$ino" || "${_WS_QREC_BTIME-}" != "$bt" \
       || "${_WS_QREC_RUN-}" != "$run" || "${_WS_QREC_AT-}" != "$at" || "${_WS_QREC_TOKEN-}" != "$token" ]]; then
    _ws_collect_record_drop "$rec" || :
    _ws_reclaim_fail "$id" "" probe-unmeasured "the quarantine record $rec did not read back as written — nothing was moved"
    return 1
  fi
  # 3c — THE SLOT, made EXCLUSIVELY (Task 4's `_ws_collect_slot_make`): a name
  # that already stands is never adopted and, not being this verb's, never removed.
  _ws_collect_slot_make "$slot"; rc=$?
  if (( rc != 0 )); then
    _ws_collect_record_drop "$rec" || :
    if (( rc == 1 )); then
      _ws_reclaim_fail "$id" "" probe-unmeasured "the quarantine slot $slot already stood, and a slot is never adopted — nothing was moved"
    else
      _ws_reclaim_fail "$id" "" probe-unmeasured "$(_ws_leaf_why_line "${_WS_SLOT_WHY:-the quarantine slot $slot could not be made} — nothing was moved")"
    fi
    return 1
  fi
  _ws_collect_gap slotted "$id" "$slot"
  _lc_intent collect "$id" "$lctx" verb ws-collect \
    detail "$(_ws_leaf_why_line "record $name: moving $orig into $slot/leaf")" \
    dec.surface "$surface" dec.actor "$actor" dec.reason "$reason"
  # 4 — THE MOVE: Task 4's `_ws_collect_move`, ONE NOREPLACE rename proven by
  # lstat (the slot's leaf is the witnessed directory AND nothing stands at the
  # original path), never by mv's exit code.
  _ws_collect_move "$orig" "$slot/leaf" "$dev:$ino" "$bt"; rc=$?
  why="${_WS_MOVE_WHY-}"
  case "$rc" in
    0) : ;;
    1) # PROVEN NOT MOVED: the leaf is still at its path (EXDEV under --no-copy,
       # a NOREPLACE refusal, or an mv that answered without moving it).
       if _ws_collect_unwind "$slot" "$rec"; then
         _ws_reclaim_fail "$id" "$lctx" probe-unmeasured \
           "$(_ws_leaf_why_line "the move of $orig into $slot/leaf was not proven ($why) — nothing was moved")"
         return 1
       fi
       _ws_collect_keep "$id" "$rec" "$lctx" "the move of $orig was not proven, and its slot could not be cleared"
       return 1 ;;
    *) # UNMEASURED: neither path is provably the witnessed leaf. Whatever reached
       # the slot is not provably it, so it is KEPT there with its record, listed
       # for the operator, never moved back and never unlinked (ruling T8 OPEN5);
       # an EMPTY slot is cleared.
       _ws_reclaim_absent "$slot/leaf"; rc=$?
       if (( rc == 1 )); then
         _ws_collect_refused "$id" "$lctx" quarantine-kept \
           "what reached $slot/leaf is not the witnessed leaf ($why) — it is kept in its slot with the quarantine record $rec, listed for the operator; nothing was moved back or removed" \
           "$surface" "$actor" "$reason"
         return 0
       fi
       if (( rc == 0 )) && _ws_collect_unwind "$slot" "$rec"; then
         _ws_reclaim_fail "$id" "$lctx" probe-unmeasured \
           "$(_ws_leaf_why_line "the move of $orig into $slot/leaf was not proven ($why), and nothing reached the slot — nothing was moved")"
         return 1
       fi
       _ws_collect_keep "$id" "$rec" "$lctx" "$why"
       return 1 ;;
  esac
  _ws_collect_gap moved "$id" "$slot"
  _ws_collect_after_move "$id" "$rec" "$orig" "$lctx" "" "$surface" "$actor" "$reason"
}

_ws_collect_resume() {   # id rec q orig lctx surface actor reason — a quarantine record stands for id: resume FROM IT,
  #                           at the phase the evaluation read off the disk (`_WS_COLLECT_PHASE`)
  # Never the tree token or the idle floor (the move stamped the leaf's ctime):
  # the record is the authority, re-read here, and step 5's proofs follow
  # before anything is removed. The phase is Task 5's, read in this lock a
  # moment ago (`_ws_collect_resume_eval`); the verb never re-derives it.
  local id="$1" rec="$2" q="$3" orig="$4" lctx="$5" surface="$6" actor="$7" reason="$8" name slot rc
  name="${rec##*/}"
  # The reader answers 2 for a body naming another id and DERIVES the slot from
  # the record's name (ruling G5): the compare is defence in depth.
  if ! _ws_collect_record_read "$rec" || [[ "${_WS_QREC_ID-}" != "$id" || "${_WS_QREC_SLOT-}" != "$q/slot.$name" ]]; then
    _ws_collect_refused "$id" "" quarantine-kept \
      "$rec is not a quarantine record this verb wrote for $id at $q/slot.$name — a record not provably this verb's is the operator's, never taken" \
      "$surface" "$actor" "$reason"
    return 0
  fi
  slot="${_WS_QREC_SLOT-}"
  case "${_WS_COLLECT_PHASE-}" in
    moved)
      # The slot's leaf is the record's own: asked again here, before any act,
      # so a leaf that is not the one the record names is never acted on.
      _ws_collect_ident "$slot/leaf" "${_WS_QREC_DEV-}:${_WS_QREC_INO-}" "${_WS_QREC_BTIME-}"; rc=$?
      case "$rc" in
        0) : ;;
        1) _ws_collect_refused "$id" "" quarantine-kept \
             "$slot/leaf is not the directory record $name names — the slot's leaf is the operator's, never taken" \
             "$surface" "$actor" "$reason"
           return 0 ;;
        *) _ws_reclaim_fail "$id" "" probe-unmeasured "the identity of $slot/leaf could not be read — nothing was moved or removed"; return 1 ;;
      esac
      _lc_intent collect "$id" "$lctx" verb ws-collect meas.resumed "$name" \
        detail "$(_ws_leaf_why_line "resuming record $name: $slot/leaf")" \
        dec.surface "$surface" dec.actor "$actor" dec.reason "$reason"
      _ws_collect_gap moved "$id" "$slot"
      _ws_collect_after_move "$id" "$rec" "$orig" "$lctx" "$name" "$surface" "$actor" "$reason"
      return ;;
    unmoved)
      # THE MOVE NEVER HAPPENED (or was undone): the leaf stands at its path and
      # the slot holds nothing. The slot and the record are cleared, the witness
      # is KEPT, and the answer is `state-changed`: the leaf is audited afresh
      # (ruling T6 OPEN10).
      _lc_intent collect "$id" "$lctx" verb ws-collect meas.resumed "$name" \
        detail "$(_ws_leaf_why_line "record $name: $orig never left, or came back")" \
        dec.surface "$surface" dec.actor "$actor" dec.reason "$reason"
      if _ws_collect_unwind "$slot" "$rec"; then
        _ws_collect_refused "$id" "$lctx" state-changed \
          "record $name described a collection whose move never happened or was undone — $orig stands with its witness and is audited afresh; nothing was removed" \
          "$surface" "$actor" "$reason"
        return 0
      fi
      _ws_collect_keep "$id" "$rec" "$lctx" "record $name's leaf never left $orig, but its slot or the record could not be cleared"
      return 1 ;;
    removed)
      # THE REMOVAL HAD FINISHED before the run stopped: the order resumes from
      # the slot's rmdir.
      _lc_intent collect "$id" "$lctx" verb ws-collect meas.resumed "$name" \
        detail "$(_ws_leaf_why_line "resuming record $name past its removal")" \
        dec.surface "$surface" dec.actor "$actor" dec.reason "$reason"
      _ws_collect_finish "$id" "$rec" "$slot" "$lctx" "$name"
      return ;;
  esac
  _ws_reclaim_fail "$id" "" probe-unmeasured "the evaluation named no phase this verb acts on for record $name (${_WS_COLLECT_PHASE:-none}) — nothing was moved or removed"
  return 1
}

cmd_ws_collect() {   # ccd ws-collect --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]
  # THE DESTRUCTIVE VERB FOR AN ORPHANED, WITNESSED TEMP ROOT, composed by the
  # server and by nothing else. The token `ws-audit --collect` minted must equal
  # the one recomputed here, inside the reap lock. stdout is ONE JSON line:
  # `{"collected":…}`, a refusal document at exit 0, or `{"failed":…}` at exit 1
  # (a quarantine record, where one stands, resumes it).
  local lc_surface=none lc_actor='' lc_reason='' lc_gs=0 lc_ga=0 lc_gr=0 args=()
  while (( $# )); do
    case "$1" in
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-collect --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]"
                   lc_gs=1; lc_surface="$2"; shift 2 ;;
      --surface=*) lc_gs=1; lc_surface="${1#--surface=}"; shift ;;
      --actor)     [[ $# -ge 2 ]] || die "usage: ccd ws-collect --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]"
                   lc_ga=1; lc_actor="$2"; shift 2 ;;
      --actor=*)   lc_ga=1; lc_actor="${1#--actor=}"; shift ;;
      --reason)    [[ $# -ge 2 ]] || die "usage: ccd ws-collect --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]"
                   lc_gr=1; lc_reason="$2"; shift 2 ;;
      --reason=*)  lc_gr=1; lc_reason="${1#--reason=}"; shift ;;
      *)           args+=("$1"); shift ;;
    esac
  done
  if (( lc_gs )); then local lc_w; lc_w=$(_lc_surface_norm "$lc_surface"); lc_surface=${lc_w:-unknown}; fi
  if (( lc_ga )); then
    [[ -n "${lc_actor//[[:space:]]/}" ]] || die "--actor must be non-blank"
    _lc_dec_ok "$lc_actor" || die "--actor is longer than $_LC_DEC_MAX bytes"
  fi
  if (( lc_gr )); then
    [[ -n "${lc_reason//[[:space:]]/}" ]] || die "--reason must be non-blank"
    _lc_dec_ok "$lc_reason" || die "--reason is longer than $_LC_DEC_MAX bytes"
  fi
  set -- ${args[@]+"${args[@]}"}
  [[ $# -eq 4 && $1 == --expect && $3 == --session ]] \
    || die "usage: ccd ws-collect --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]"
  local token=$2 id=$4
  [[ $token =~ ^[0-9a-f]{64}$ ]]                            || die "bad token"
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] && _ws_tmproot_id_ok "$id" || die "bad session id"
  _json_str probe >/dev/null 2>&1 \
    || die "python3 unavailable — cannot quote the collection record safely"
  # THE FLAVOUR `_ws_reclaim_fail` journals under (act `collect`, verb
  # `ws-collect`), and NO `crumb`: a collection has no breadcrumb.
  local _WS_RCL_ACT=collect _WS_RCL_CRUMB=''
  # NEVER A LOCK FOR A FOREIGN NAME: the reap lock is taken only for an id in
  # the collector's population — a witness stands for it, or a record names it.
  local wf recs='' rrc=0
  wf=$(_ws_tmproot_witness_file "$id")
  recs=$(_ws_collect_records_of "$id") || rrc=$?
  if [[ ! -e "$wf" && ! -L "$wf" && -z "$recs" ]] && (( rrc == 0 )); then
    _ws_collect_refused "$id" "" not-witnessed \
      "no witness ($wf) and no quarantine record names $id, so there is nothing to collect — no lock was taken" \
      "$lc_surface" "$lc_actor" "$lc_reason"
    return 0
  fi
  # THE SHARED LOCK: `$REG/.reap-<id>.lock`, the one ws-reap, ws-reclaim,
  # ws-expire and ws-restore take, so none of them runs on this id at once.
  local lock="$REG/.reap-$id.lock" lfd rc=0
  command -v flock >/dev/null 2>&1 \
    || _lc_refuse collect "$id" flock-unavailable \
         "flock (util-linux) is unavailable — refusing to run the destructive verb unserialised"
  exec {lfd}>>"$lock" \
    || _lc_refuse collect "$id" lock-unopenable "cannot open the reap lock at $lock"
  flock -n "$lfd" || {
    _lc_emit collect refused "$id" "" verb ws-collect refusal in-progress \
      detail "another ccd process is already reaping, reclaiming, expiring, restoring or collecting $id and still holds the lock"
    exec {lfd}>&-
    printf '{"refused":"in-progress","detail":%s,"paths":[]}\n' \
      "$(_json_str "another ccd process is already reaping, reclaiming, expiring, restoring or collecting $id and still holds the lock")"
    return 0
  }
  _ws_reclaim_contained _ws_collect_locked "$token" "$id" "$lc_surface" "$lc_actor" "$lc_reason"; rc=$?
  exec {lfd}>&-
  return "$rc"
}

_ws_collect_locked() {   # token id surface actor reason — everything the reap lock serialises, for a collection
  local token="$1" id="$2" surface="$3" actor="$4" reason="$5" q rroot orig lctx rec
  _ws_collect_gap locked "$id"
  # THE PAUSE, inside the lock and before the evaluation: a fresh collection,
  # a resume and a witness-only drop alike stop on it. `_ws_collect_paused` is
  # Task 5's reader, the one the pause census pins; it sets REAP_DETAIL.
  if ! _ws_collect_paused; then
    _ws_collect_refused "$id" "" paused "${REAP_DETAIL-} — nothing was moved or removed" "$surface" "$actor" "$reason"
    return 0
  fi
  # 1 — THE CONSENT IS THE TOKEN, recomputed HERE by the one evaluation
  # `ws-audit --collect` runs (`_ws_collect_fork`): where a record stands, the
  # record, its slot's leaf and the phase read off the disk; else the witness,
  # the registry, the idle floor, the tree's newest ctime and count, the probe,
  # the checkouts and the row rule — all before anything moves.
  _ws_collect_fork "$id"
  [[ -n "${REAP_VERDICT-}" ]] || { REAP_VERDICT=unmeasured; REAP_DETAIL="the collection evaluation answered no verdict for $id"; }
  if [[ "${REAP_VERDICT-}" == collectable && "$token" != "${REAP_TOKEN-}" ]]; then
    REAP_VERDICT=state-changed
    REAP_DETAIL="expected ${REAP_TOKEN-}, was given $token — $id changed since the audit that minted the token; nothing was moved"
  fi
  if [[ "${REAP_VERDICT-}" == unmeasured ]]; then
    _ws_reclaim_fail "$id" "" probe-unmeasured "$(_ws_leaf_why_line "${REAP_DETAIL-}")"
    return 1
  fi
  if [[ "${REAP_VERDICT-}" != collectable ]]; then
    _ws_collect_refused "$id" "" "${REAP_VERDICT-}" "${REAP_DETAIL-}" "$surface" "$actor" "$reason"
    return 0
  fi
  _ws_collect_gap consented "$id"
  # LINUX-FIRST: Task 4's move is one rename that never copies, or nothing.
  _ws_collect_mv_ok \
    || { _ws_reclaim_fail "$id" "" probe-unmeasured "the collector is Linux-first and moves only by a rename that never copies: on $CCD_OS, or with an mv that offers no --no-copy, that move cannot be made — nothing was moved"; return 1; }
  # THE WITNESS-ONLY ARM (Task 5's DEP3): the witness stands, its leaf is
  # PROVEN absent and no record names the id. Nothing to move or remove.
  if [[ -z "${_WS_COLLECT_RECORD-}" && "${_WS_COLLECT_LEAF-}" == absent ]]; then
    _ws_collect_witness_only "$id" "$surface" "$actor" "$reason"
    return
  fi
  if ! _ws_collect_qdir || [[ "${_WS_Q-}" != /?*/.ccd-quarantine ]]; then
    _ws_reclaim_fail "$id" "" probe-unmeasured "$(_ws_leaf_why_line "${_WS_Q_WHY:-the quarantine directory is not <physical ~/.cc-tmp>/.ccd-quarantine} — nothing was moved")"
    return 1
  fi
  q="${_WS_Q-}"; rroot="${q%/.ccd-quarantine}"; orig="$rroot/$id"
  lctx=$(_lc_tx)
  rec="${_WS_COLLECT_RECORD-}"
  if [[ -n "$rec" ]]; then
    _ws_collect_resume "$id" "$rec" "$q" "$orig" "$lctx" "$surface" "$actor" "$reason"
  else
    _ws_collect_fresh "$id" "$q" "$orig" "$lctx" "$surface" "$actor" "$reason"
  fi
}
```

The block's guards, and the case that pins each (Step 6 mutates every one):
- **The pause** is read inside the lock by Task 5's `_ws_collect_paused`, before the evaluation and before the arms split, so a resume and a witness-only drop stop on it too.
- **The population check** comes before the lock: no witness name and no record → `not-witnessed`, and `.reap-<id>.lock` is never created for a foreign name.
- **Step 1** compares `--expect` with the evaluation's token (`_ws_collect_fork`); `unmeasured` (or no verdict at all) is a `failed probe-unmeasured` with no intent; any other word passes through the ONE refusal point (ruling G11). Then `_ws_collect_mv_ok`: off Linux, or without `--no-copy`, nothing moves.
- **The witness-only arm** (Task 5's DEP3): a fresh verdict with `_WS_COLLECT_LEAF=absent` and no record is compare-and-drop and the temp-file reap alone — no quarantine, record or slot.
- **Step 2** (`_ws_collect_ident` on the physical leaf) never moves or unlinks a link, a file or a mismatch.
- **Step 3a** asks `_ws_leaf_checkouts` of the ORIGINAL path; the accepted pairs ride the record into step 6's alias.
- **Step 3b–3c:** the slot is NAMED (`_ws_collect_slot_path`), the record is written under `$(_ws_collect_qrec_dir)` and READ BACK field for field, then the slot is made by `_ws_collect_slot_make` (exclusive); a slot name that stood is not this verb's, so only the record is dropped.
- **Step 4** is Task 4's `_ws_collect_move`: 0 proven moved; 1 proven NOT moved → the empty slot and the record are cleared, `failed probe-unmeasured`; 2 → whatever reached the slot is KEPT with its record, `refused quarantine-kept` (ruling T8 OPEN5), and an empty slot is cleared.
- **Step 5** asks, in order: the registry (`_ws_collect_registered`: `.child` and `.uuid` by direct lookup, the slug behind the wildcard-listing control); the probe on the TMPDIR spelling and on the slot's leaf; the row rule on the LOGICAL pre-move spelling (ruling G6); the mount table (a mount is unmeasured, ruling T6 OPEN8); identity LAST, whose failure KEEPS the slot's leaf (`refused quarantine-kept`, never moved back). Any other doubt → `_ws_collect_putback`: Task 4's move reversed with the RECORD's identity, then the empty slot and the record are cleared; an original path retaken since the move → `refused quarantine-kept`, TERMINAL (ruling T8 OPEN4); otherwise `failed quarantine-kept`.
- **Step 6** passes the witness's dev:ino and the alias (ruling G8); a refusal (`1`, nothing under the leaf removed) moves it back (ruling T6 OPEN11); an unmeasured answer (`2`, possibly part-removed) KEEPS the record so the next pass resumes.
- **The order:** the slot's leaf proven gone → `rmdir` of the slot (never recursive) → compare-and-drop → the temp-file reap → the record dropped LAST; any step that cannot complete keeps the record (`quarantine-kept`) so the next pass finishes from it.
- **The resume** re-reads the record (its id this id, its slot DERIVED as `<Q>/slot.<record name>`, ruling G5) and branches on Task 5's phase: `moved` → the slot's leaf asked again (anything else → `quarantine-kept`, untouched), then steps 5 and 6; `unmoved` → the slot and record cleared, the witness KEPT, `refused state-changed` (ruling T6 OPEN10); `removed` → the order from the slot's rmdir.
- **`set -u`:** every global another task sets (`REAP_*`, `_WS_WIT_*`, `_WS_QREC_*`, `_WS_Q`, `_WS_COLLECT_*`, `_WS_MOVE_WHY`, `_WS_COLLECT_ROWS_WHY`) is read as `${X-}`, so an evaluation or reader that leaves one unset ends in a refusal or a failure document, never an unbound-variable exit mid-lock.

- [ ] **Step 4b: Declare the three RETRYABLE words in L0 (the commit of their first journal sites, ruling G2)**

In `shared/api.ts`:
- **The union.** `LcRefusalToken`'s last member is Task 5's `'quarantine-kept'` (`grep -n "^  | 'quarantine-kept';" shared/api.ts`). Delete its trailing `;` (keep its comment), and add directly below it:

```ts
  | 'not-witnessed'           // ws-audit --collect and ws-collect (spec §5.2): no witness and no quarantine record names the id — RETRYABLE: there is nothing to collect
  | 'registered'              // ws-audit --collect and ws-collect (spec §5.6): a registry row stands for the id again (`.child`, `.uuid`, or what the slug still holds) — RETRYABLE: the temp root is that workspace's
  | 'not-idle';               // ws-audit --collect and ws-collect (spec §5.6): the newest change under the temp root is younger than the idle floor — RETRYABLE
```

- **The map.** Directly above the `};` that closes `LC_REFUSAL_WORD`, below Task 5's two collector entries, add:

```ts
  // The temp-root collector's RETRYABLE words (spec §5.2, §5.6): printed by `ws-audit --collect`, journaled `refused`
  // by `ws-collect` at its one refusal point. Each is true wherever it is printed: neither removes anything when it
  // answers one, and a leaf `ws-collect` had moved is back at its path before it answers `registered`.
  'not-witnessed':
    'ccrc has no record of handing out a temporary directory under this id, so there is nothing for it to clean up. Nothing was removed.',
  'registered':
    'A workspace is registered under this id again, so the temporary directory there belongs to that workspace and ccrc will not clean it up. Nothing was removed; ccrc looks again once the id is free.',
  'not-idle':
    'Something in this temporary directory changed recently, so ccrc leaves it alone for now. Nothing was removed; ccrc looks again once it has stayed unchanged long enough.',
```

In `server/test/lifecycle-refusal-word.test.ts`: in `ALL_TOKENS`, directly below Task 5's `  'witness-mismatch': true, 'quarantine-kept': true,`, add `  'not-witnessed': true, 'registered': true, 'not-idle': true,`, and raise `expect(TOKENS.length).toBe(…)` by THREE from what your tree reads: 21 → 24.

**THE CITATION CASE.** The three union lines sit above README's `shared/api.ts` map anchors, as Task 5's did. Repair them BY CONTENT, exactly as Task 5's Step 6 does: find the sentence with `grep -n 'shared/api.ts:[0-9]' README.md`, read the cited lines' new numbers with the `grep -n` that step names, re-point the sentence, and re-run `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'` until it is green. If anything other than README reds there, STOP and report: a frozen-corpus census is never adjusted here.

- [ ] **Step 5: Run the tests to verify they pass, then the gates**

First measure `cmd_ws_collect`'s slice and the five locked functions' slices, and write the numbers into Step 2 (b)'s comment and (g)'s floors: each floor is its measured length less 500, rounded down to a hundred (ruling G3's rewrite shrank the functions, so the draft's 3800, 1800, 4000, 2600, 1800 and 1500 are placeholders until measured):

```bash
node -e "const s=require('fs').readFileSync('ccd/ccd','utf8');const a=s.indexOf('cmd_ws_collect() {');console.log(s.indexOf('_ws_collect_locked() {',a)-a)"
node -e "const s=require('fs').readFileSync('ccd/ccd','utf8');for(const n of ['_ws_collect_locked','_ws_collect_fresh','_ws_collect_resume','_ws_collect_after_move','_ws_collect_finish']){const a=s.indexOf(n+'() {');console.log(n,s.indexOf('\n}\n',a)-a)}"
```

Then, each in the FOREGROUND with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-verb.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-move.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-reprove.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-order.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-resume.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts test/wsaudit.test.ts test/ccd-wsaudit-nonpoison.test.ts test/lifecycle-refusal-word.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-die-containment.test.ts test/ccd-lifecycle-contain.test.ts test/ccd-lifecycle-emit.test.ts test/ccd-reg-get-census.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-leaf-remove.test.ts test/ccd-leaf-checkouts.test.ts test/ccd-child-tmproot-witness.test.ts test/ccd-child-tmproot-witness-drop.test.ts
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p .
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

Then Task 4's and Task 5's own suites (`ccd-collect-*.test.ts` and `ccd-leaf-checkouts-alias.test.ts`), one file per run.

Then re-stamp and the ownership gates:

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'
sed -n "3,${B}p" ccd/ccd | sha256sum      # equals E9b: nothing at or above the boundary moved
```

Expected:
- All five collect files pass in full on Linux. On macOS (advisory legs) only the cases not marked Linux run — `off Linux, or without --no-copy, nothing moves`'s first case, `the registry question itself` and the three declarations — and they pass; the rest skip.
- `ccd-refusal-scan` passes: the seventh verb's body and its five locked functions are sliced above their re-measured floors, the sanctioned set is exactly 16 and every member stands, the two emits are counted, and the cross-language harvest finds every declared word at a literal site — `not-witnessed`, `registered` and `not-idle` among them, through (h)'s COLLECT harvest — and no word outside the vocabularies.
- `wsaudit` and `ccd-wsaudit-nonpoison` pass with no edit here: the verb's one literal refusal object is the flock decline's `in-progress`, already counted, and Task 5's commit taught the nonpoison scan the COLLECT block (ruling G2). `lifecycle-refusal-word` passes at 24.
- `ccd-die-containment` passes unchanged: its pinned `_`-prefixed can-die set does not grow (only `cmd_ws_collect` dies, before the lock, and it is never captured in `$( )`).
- `ccd-lifecycle-contain` passes unchanged: the verb writes `meas.resumed` alone, already declared.
- `ccd-reg-get-census` passes unchanged: no `_reg_get` was added.
- `macos-platform` passes unchanged: the block spells no `mv -T` of its own, and Task 4's `_ws_collect_mv` is the one function exempt by name (ruling G3).
- The citation case passes once README's `shared/api.ts:` anchors are re-pointed by content (Step 4b), and the boundary hash is unchanged: the ccd edit is one block far below `B`. If the citation case reds on anything but README, STOP and report — the frozen corpus is never adjusted here.
- `typecheck-tests` is a known load flake: re-run it in isolation before calling a red real.

- [ ] **Step 6: Mutation check**

One mutation at a time, each reverted before the next. Files: V `ccd-ws-collect-verb`, M `ccd-ws-collect-move`, R `ccd-ws-collect-reprove`, O `ccd-ws-collect-order`, S `ccd-ws-collect-resume`, RS `ccd-refusal-scan`, P `macos-platform` (each `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`, foreground, ≥ 600000 ms). Every function named is in Step 4's block.

| # | Mutation (exact edit) | File | Expected red |
|---|---|---|---|
| 1 | `_ws_collect_locked`: delete the whole `if ! _ws_collect_paused; then … fi` block | V | "reclaim-paused refuses paused INSIDE the lock…": `expected undefined to be 'paused'` (the stubbed evaluation answers collectable; the leaf is collected) |
| 2 | `_ws_collect_locked`: delete the `if [[ "${REAP_VERDICT-}" == collectable && "$token" != "${REAP_TOKEN-}" ]]; then … fi` block | V | "a token that is not the one recomputed…" and "a tree written to after the audit…": `expected undefined to be 'state-changed'` |
| 3 | `_ws_collect_locked`: delete the `if [[ "${REAP_VERDICT-}" == unmeasured ]]; then … fi` block | V | "the ladder's unmeasured…": `expected 0 to be 1` (it falls to the refusal point) |
| 4 | `cmd_ws_collect`: delete the population block `if [[ ! -e "$wf" && ! -L "$wf" && -z "$recs" ]] && (( rrc == 0 )); then … fi` | V | "an id with neither a witness nor a record…": `expected true to be false` (`.reap-demo-quiet-none.lock` is created) |
| 5 | `cmd_ws_collect`: `local _WS_RCL_ACT=collect _WS_RCL_CRUMB=''` → `local _WS_RCL_ACT=collect` | V | "the ladder's unmeasured… never a crumb": `expected { failed: 'probe-unmeasured', …, crumb: true } not to have property "crumb"` |
| 6 | `cmd_ws_collect`: `local _WS_RCL_ACT=collect …` → `local _WS_RCL_ACT=reclaim …` | V | same case: `expected [] to deeply equal [ [ 'failed', 'probe-unmeasured', 'ws-collect' ] ]` (the row is a `reclaim` row) |
| 7 | `cmd_ws_collect`: drop ` && _ws_tmproot_id_ok "$id"` from the `bad session id` line | V | "argv…": `.hidden: expected 0 to be 1` (a dot-leading id reaches the population check) |
| 8 | `cmd_ws_collect`: `_ws_reclaim_contained _ws_collect_locked "$token" …` → `_ws_collect_locked "$token" …` | V | "the locked body runs CONTAINED…": `expected '…' to match /\n  _ws_reclaim_contained _ws_collect_locked "\$token" "\$id" /` |
| 9 | `_ws_collect_locked`: delete the `_ws_collect_mv_ok \` / `\|\| { …; return 1; }` statement | V | "a box that is not Linux…" and "a box whose mv offers no --no-copy…": `the quarantine: expected true to be false` (the quarantine is made, and only `_ws_collect_move`'s own `_ws_collect_mv_ok` stops the move) |
| 10 | `_ws_collect_locked`: in that statement, replace the detail with `mv cannot be used — nothing was moved` | V | "a box whose mv offers no --no-copy…": `expected 'mv cannot be used — nothing was moved' to contain '--no-copy'` |
| 11 | `_ws_collect_fresh` step 2: replace the `1) _ws_collect_refused "$id" "" witness-mismatch …; return 0 ;;` arm with `1) : ;;` | M | "a symbolic link…" and "another directory…": `refused before the record: expected [ 'locked', 'consented', 'recorded', 'slotted', … ] to deeply equal [ 'locked', 'consented' ]` (what moves is not proven the witnessed leaf; the file case is backstopped: the checkout question cannot resolve a file and answers unmeasured) |
| 12 | `_ws_collect_fresh` step 3a: delete `_ws_leaf_checkouts "$orig"; rc=$?` and its `case … esac` | M | "a refusal: containment-unproven…": `expected [ '…/.ccd-quarantine/slot.…/leaf' ] to deeply equal [ '…/demo-quiet-reef' ]` (only the helper's own question, of the moved tree, is asked) |
| 13 | step 3b: `_ws_collect_record_write "$id" "$slot" "$token" \` / `\|\| { …; return 1; }` → `_ws_collect_record_write "$id" "$slot" "$token" \|\| :` | M | "a record that cannot be written…": `expected '…did not read back as written…' to contain 'could not be written'` (the read-back backstops the act; the detail reds) |
| 14 | step 3b: delete the read-back `if ! _ws_collect_record_read "$rec" \|\| … fi` block | M | "a record that does not read back as written…": `expected '…could not be read back after the move…' to contain 'did not read back as written'` (the leaf was moved, and the record is kept) |
| 15 | step 3c: `_ws_collect_slot_make "$slot"; rc=$?` → `_ws_collect_slot_make "$slot"; rc=0` | M | "the slot is made EXCLUSIVELY…": `expected 0 to be 1` (the slot that stood is adopted, and the leaf collected through it) |
| 16 | step 3c's failure arm: `_ws_collect_record_drop "$rec" \|\| :` → `_ws_collect_unwind "$slot" "$rec" \|\| :` | M | same case: `the slot that stood: expected [] to have a length of 1` |
| 17 | step 4: `_ws_collect_move "$orig" "$slot/leaf" "$dev:$ino" "$bt"; rc=$?` → `…; rc=0` | M | "an mv that answers 0 and moves nothing…" and the EXDEV case: `expected 0 to be 1` (step 5's identity backstops: the slot's leaf is absent, so it answers a refusal and nothing is removed) |
| 18 | step 4's `3)` arm: `if _ws_collect_unwind "$slot" "$rec"; then` → `if :; then` | M | "an mv that answers 0…": `expected [ 'slot.demo-quiet-reef.…' ] to deeply equal []` |
| 19 | step 4's `*)` arm: delete its `if (( rc == 1 )); then … fi` block (the refusal of what reached the slot) | M | "an mv that COPIES…": `expected 1 to be 0` (the copy is kept as a `failed`, which a later pass would try to finish, not the terminal refusal ruling T8 OPEN5 rules) |
| 20 | `_ws_collect_reprove` (a)/(b): `_ws_collect_registered "$id"; rc=$?` → `rc=0` | R | "a child marker after the move…", "a registry row after the move…" and "…searched but not listed: the DIRECT lookup sees it": `expected undefined to be 'registered'` |
| 21 | `_ws_collect_reprove` (a)/(b): delete `(( rc != 2 )) \|\| { _WS_REPROVE_WHY="$_WS_COLLECT_REG_WHY"; return 2; }` | R | "a row under a $REG that cannot be listed…": `expected 0 to be 1` (with the row rule stubbed clear, nothing else stands between that row and the removal) |
| 22 | `_ws_collect_registered` (Task 5's, asked by step 5): delete the `ctl=(…)` line and the `[[ ${#ctl[@]} -eq 1 … ]] \` / `\|\| { …; return 2; }` statement | R | "a row under a $REG that cannot be listed…": `expected 0 to be 1` (`_ws_slug_free` reads free over the `.hold` it cannot list) |
| 23 | `_ws_collect_registered` (Task 5's): delete the `[[ "$id" == *-* ]] \` / `\|\| { …; return 2; }` statement | R | "an id that is not <project>-<slug>…": `expected '0' to be '2'` |
| 24 | (c): `for s in "$HOME/.cc-tmp/$id" "$sl"; do` → `for s in "$sl"; do` | R | "a user of the path TMPDIR names…": `expected undefined to be 'in-use'` |
| 25 | (c): `for s in "$HOME/.cc-tmp/$id" "$sl"; do` → `for s in "$HOME/.cc-tmp/$id"; do` | R | "a user of the slot's leaf…" and "a REAL process whose cwd…": `expected undefined to be 'in-use'` |
| 26 | (c): delete `(( rc != 2 )) \|\| { _WS_REPROVE_WHY="$_WS_PATH_USERS_WHY"; return 2; }` | R | "a probe that could not measure…": `expected 0 to be 1` |
| 27 | (d): delete the three `_ws_collect_rows_clear` lines | R | "a row it finds…": `expected undefined to be 'containment-unproven'`; "is asked AFTER the move…": `expected <the ladder's line, or undefined> to be 'demo-quiet-reef\|…\|absent'` |
| 28 | (e): delete the two `_ws_collect_mounts_clear` lines | R | "a mount at <slot>/leaf/mnt…" and "…/leaf…": `expected undefined to be 'probe-unmeasured'` |
| 29 | `_ws_collect_mounts_clear`: replace the four `enc=` substitutions with `enc="$dir"` | R | "mount points are compared ENCODED…": `the encoded line names a mount under it: expected '0' to be '1'` |
| 30 | `_ws_collect_mounts_clear`: `[[ "$mp" == "$enc" \|\| "$mp" == "$enc/"* ]]` → `[[ "$mp" == "$enc"* ]]` | R | "the CONTROL: a mount at a SIBLING…": `expected undefined to be 'demo-quiet-reef'` (`<slot>/leafy` reads as under `<slot>/leaf`) |
| 31 | `_ws_collect_mounts_clear`: the unreadable arm `\|\| { _WS_MOUNTS_WHY="$mi could not be read…"; return 2; }` → `\|\| return 0` | R | "a table that cannot be read…": `expected undefined to be 'probe-unmeasured'` |
| 32 | `_ws_collect_mounts_clear`: delete `(( n > 0 )) \|\| { …; return 2; }` | R | "a table with no mount in it…": `expected undefined to be 'probe-unmeasured'` |
| 33 | (f): replace the identity block (from `_ws_collect_ident "$sl"` to the function's end) with `return 0` | R | "the slot's leaf swapped after the move…": `expected 1 to be 0` (backstopped by the helper's own dev:ino: nothing is removed, but the answer is a `failed`, not the terminal refusal) |
| 34 | `_ws_collect_putback`: `_ws_collect_move "$slot/leaf" "$orig" "${_WS_QREC_DEV-}:${_WS_QREC_INO-}" "${_WS_QREC_BTIME-}"; mrc=$?` → `_ws_collect_mv "$slot/leaf" "$orig" 2>/dev/null; mrc=0` | R | "a restore that put the leaf anywhere but its own path…": `expected undefined to be 'quarantine-kept'`; `the record that knows where it was: expected [] to have a length of 1` |
| 35 | (retired by ruling G3) | — | The restore's "nothing stands at the slot's leaf" half is now inside Task 4's `_ws_collect_move` (its accepted DEP3 `move-proof-requires-the-source-gone`), pinned by Task 4's own mutation rows |
| 36 | `_ws_collect_unwind`: `rmdir -- "$slot" 2>/dev/null \|\| return 1` → `rm -rf -- "$slot" \|\| return 1` | R | "a slot that holds anything besides its leaf…": `expected undefined to be 'quarantine-kept'` (the stray is removed with the slot) |
| 37 | `_ws_collect_after_move` step 5: `_ws_collect_putback "$id" "$slot" "$rec" "$orig" "$lctx" "$why" "$surface" "$actor" "$reason"; prc=$?` → `_ws_collect_unwind "$slot" "$rec" \|\| :; prc=0` | R | every "moved back" case: `the leaf is back at its own path, the same inode: expected '' to be '<ino>'` |
| 38 | step 6's `1)` arm: replace its body with `_ws_collect_keep "$id" "$rec" "$lctx" "$_WS_LEAF_WHY"; return 1 ;;` | O | "a leaf the helper REFUSES…": `expected 1 to be 0` |
| 39 | step 6's `*)` arm: replace its body with the `1)` arm's putback body | O | "a helper that could not measure…": `expected 0 to be 1` (a possibly part-removed tree is moved back as if whole) |
| 40 | `_ws_collect_finish`: `rmdir -- "$slot" 2>/dev/null \|\| :` → `rm -rf -- "$slot" 2>/dev/null \|\| :` | O | "rmdir, never a recursive remove…": `expected 0 to be 1` |
| 41 | `_ws_collect_finish`: move the three witness lines (`_ws_collect_witness_cad …`, `cad=…`, `_ws_collect_gap witnessed …`) above `# the EMPTY slot` | O | "in exactly that order": `expected [ 'removed slot=1 …', 'witnessed slot=1 leaf=0 witness=0 record=1', 'emptied slot=0 leaf=0 witness=0 record=1' ] to deeply equal [ … ]` |
| 42 | `_ws_collect_finish`: move `_ws_collect_record_drop "$rec" \` / `\|\| { …; }` above `_ws_collect_gap witnessed` | O | "in exactly that order": `… 'witnessed slot=0 leaf=0 witness=0 record=0' …` |
| 43 | `_ws_collect_finish`: the record drop's `\|\| { _ws_collect_keep …; return 1; }` → `\|\| :` | O | "a record that cannot be dropped…": `expected 0 to be 1` |
| 44 | `_ws_collect_finish`: the compare-and-drop's `\|\| { _ws_collect_keep …; return 1; }` → `\|\| :` | O | "a witness that cannot be moved aside keeps the record…": `expected 0 to be 1` |
| 45 | `_ws_collect_witness_cad`: replace everything from `aside="${w%/*}/.$id.drop.$BASHPID"` to the end with `rm -f -- "$w"; _WS_CAD=dropped; return 0` | O | "a witness a recycled spawn rewrote is NOT dropped…": `toMatchObject` fails on `witness: 'kept'` (it answers `dropped`, and the rewritten witness is gone); "the collected one is moved ASIDE…": `never the live name: expected [ '-f -- …/tmproots/demo-quiet-reef' ] to deeply equal []` |
| 46 | `_ws_collect_witness_cad`: delete ` && "$line" == "$pre"*"$suf" && "$mid" =~ ^[0-9]+$` from the compare | O | "a witness a recycled spawn rewrote…": `toMatchObject` fails on `witness: 'kept'` (it answers `dropped`) |
| 47 | `_ws_collect_reap_temps`: `[[ "$rest" =~ $re ]] \|\| continue` → `:` | O | "only `.<id>.<digits>.<digits>.tmp`…": the 3-field, the 1-field and the nested id's names are gone from the listing |
| 48 | `_ws_collect_reap_temps`: delete `[[ "$m" =~ ^[0-9]+$ ]] && (( now - m >= 3600 )) \|\| continue` | O | same case: `.demo-quiet-reef.123.457.tmp` (the fresh one) is gone from the listing |
| 49 | `_ws_collect_reap_temps`: delete `_ws_collect_registered "$id" \|\| return 0` | O | "none goes while the slug does not read free…": `expected false to be true` |
| 50 | `_ws_collect_resume`: delete ` \|\| [[ "${_WS_QREC_ID-}" != "$id" \|\| "${_WS_QREC_SLOT-}" != "$q/slot.$name" ]]` | — | NO RED OF ITS OWN (ruling G5): the reader answers 2 for a body naming another id and DERIVES the slot from the record's name, so the compare is a tautology kept as defence in depth; the forged-record case is held by the reader's rc 2 |
| 51 | `_ws_collect_resume`'s `moved)` arm: its identity `case`'s `1)` arm → `1) : ;;` | S | "a slot whose leaf is not the one its record names…": `the verb journaled no second intent: expected [ …2 items ] to have a length of 1` (step 5's identity backstops the act: still nothing removed) |
| 52 | `_ws_collect_resume`: the `unmoved)` arm → `unmoved) _ws_collect_finish "$id" "$rec" "$slot" "$lctx" "$name"; return ;;` | S | "died before the move…": `expected undefined to be 'state-changed'` (it answers collected while the leaf stands, and drops its witness) |
| 53 | `_ws_collect_fresh`: add a line `die "x"` above `# 4 — THE MOVE`; then, separately, add a second `_lc_emit collect refused "$id" "" verb ws-collect refusal paused` line in `_ws_collect_locked` | RS | "the collector's locked functions contain NO die…": `expected [ 'die "x"' ] to deeply equal []`; "holds the collection emits at exactly two…": `expected [ …3 items ] to have a length of 2` |
| 54 | RS: delete the `_ws_collect_refuse` harvest line Step 2 (h) adds | RS | "holds literal refusal arguments set-equal…": `declared journal-only tokens with no literal ccd call-site argument: expected [ 'not-idle', 'registered' ] to deeply equal []` |
| 55 | Remove `'not-idle'` from the union, the map and `ALL_TOKENS` (lower the count by one) | RS | "holds literal refusal arguments set-equal…": `tokens no vocabulary owns: expected [ 'not-idle' ] to deeply equal []` |
| 56 | `_ws_collect_fresh` step 4: replace the `_ws_collect_move …; rc=$?` line with `mv -T -n --no-copy -- "$orig" "$slot/leaf"; rc=$?` | P | "ccd/ccd carries no un-shimmed GNU call": `expected [ 'mv -T: mv -T -n --no-copy -- "$orig" "$slot/leaf"' ] to deeply equal []` (the one exempt spelling is Task 4's `_ws_collect_mv`, by name) |
| 57 | `cmd_ws_collect`: replace the `flock -n "$lfd" \|\| { … }` block with `:` | V | "another holder of the reap lock…": `expected undefined to be 'in-progress'` (the act runs unserialised) |
| 58 | `_ws_collect_putback`: in its `(( mrc == 0 ))` arm, replace `_ws_collect_unwind "$slot" "$rec" && return 0` with `return 0` | R | "a child marker after the move…": `its slot is gone: expected [ 'slot.demo-quiet-reef.…' ] to deeply equal []` |
| 59 | `_ws_collect_locked`: delete the witness-only `if [[ -z "${_WS_COLLECT_RECORD-}" && "${_WS_COLLECT_LEAF-}" == absent ]]; then … fi` block | V | "a witness whose leaf is PROVEN absent…": `expected { refused: 'witness-mismatch', … } to deeply equal { collected: 'demo-quiet-reef', record: null, … }` (the fresh arm's lstat of the absent leaf refuses) |
| 60 | `_ws_collect_after_move`: delete the `if (( rc == 1 )) && [[ "$_WS_REPROVE_WORD" == quarantine-kept ]]; then … fi` block | R | "the slot's leaf swapped after the move…": `expected 1 to be 0` (what the slot held is moved to the id's path, and the restore cannot be proven) |
| 61 | `_ws_collect_putback`: delete its `if (( mrc == 1 && arc == 1 )); then … fi` block (the retaken path) | R | "a path retaken since the move is never clobbered…": `expected 1 to be 0` (kept as a `failed`, not the terminal refusal ruling T8 OPEN4 rules) |
| 62 | `_ws_collect_after_move`: delete `_ws_collect_gap proven "$id" "$slot"`; then, separately, `_ws_collect_finish`: delete `_ws_collect_gap dropped "$id" "$slot"` | V | "passes every step, in order…": `expected [ …, 'moved', 'removed', … ] to deeply equal [ …, 'moved', 'proven', 'removed', … ]`, then `expected [ …, 'witnessed' ] to deeply equal [ …, 'witnessed', 'dropped' ]` |

Revert each mutation, re-stamp (`bash ccd/ccrc restamp ccd/ccd`), and re-run Step 5's commands green.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccd shared/api.ts server/test/wsCollectFixture.ts server/test/ccd-ws-collect-verb.test.ts \
  server/test/ccd-ws-collect-move.test.ts server/test/ccd-ws-collect-reprove.test.ts \
  server/test/ccd-ws-collect-order.test.ts server/test/ccd-ws-collect-resume.test.ts \
  server/test/ccd-refusal-scan.test.ts server/test/lifecycle-refusal-word.test.ts
git add README.md   # only if Step 4b re-pointed its shared/api.ts anchors
git commit -m "$(cat <<'MSG'
feat(ccd): ws-collect — collect an orphaned, witnessed temp root by quarantine rename

Inside the reap lock the verb reads the pause, re-proves ws-audit
--collect's token through the same evaluation (the witness, the
registry, the probe, the row rule and the idle floor, or a record and
its phase), lstats the leaf, asks the checkout question of its original
path, writes a quarantine record and reads it back, makes its slot
exclusively, and moves the leaf in with ccd's one
renameat2(RENAME_NOREPLACE), proven by lstat. After the move it re-proves
the registry by direct lookup and a listing proven able to see, the
in-use probe on both spellings, the row rule, the mount table and
identity; any doubt moves the leaf back, proven by lstat, or keeps the
record and the slot, and what is not the witnessed leaf is never moved
back. The slot's leaf goes through the one removal helper with the
alias; then the empty slot is rmdir'd, the witness is compared and
dropped, the witness writer's dead temp files of this id are reaped, and
the record is dropped last. A record left by a run that died is the
resume authority, and a witness whose leaf is gone is dropped alone.
L0 declares not-witnessed, registered and not-idle with these, their
first journal sites. Inert: nothing composes the verb yet.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

The wave-done names, for the coordinator: any name in E1–E6 that differed from the canonical one, and the STOP it caused; the slice floors Step 5 measured; that `quarantine-kept`'s `LC_REFUSAL_WORD` sentence stays true of BOTH uses (ruling T6 OPEN7) — the terminal refusal, and the verb's `failed` with a record kept and nothing further removed; that `probe-unmeasured`'s "started nothing" holds net of a moved-and-restored leaf (ruling T6 OPEN8, for the "§14 as built" note); that an inert witness aside `tmproots/.<id>.drop.<pid>` is a warned, stated residual (ruling T6 OPEN13); and that every case was measured on the worker's box against Task 4's and Task 5's real blocks, since the reconciled steps 2 to 5, the restore, the resume and the witness-only arm were never run in the drafter's scratch harness.
---

### Task 7: Wire `ws-collect`: `ccd caps`, the entry boundary, the agent grant, the builders and the budget (AGENT-FIRST, inert)

**Model routing:** **`opus`, effort `high`**. Most of this task is wiring, but two of its edits are the SECURITY lens's subject:
- the direct-entry boundary, which decides which argv start under `bash -p` (`ccd/ccd`'s guard and `ccd/ccd-entry.py`'s `is_protected`);
- the agent grant of a fourth server-composed destructive verb.

A missed shape or a wrong grant stays silent until the fleet runs it.

**Why:** §14 ships the collector AGENT-FIRST and INERT (R65): wave 7 carries ccd and the agent grant, and no server code composes the verb until the collector's lane (wave 9). This task makes what Tasks 4 to 6 built reachable, the way `77c11245a` made `ws-expire` reachable. Read that commit with `git show 77c11245a -- <path>` in this checkout (read only). The task delivers:
- `ccd caps` advertising the verb and `collect-v1` on the line `expire-v1` already shares. The edit is length-neutral, because that line sits above the frozen citation boundary.
- the dispatcher arm and the unknown-verb usage line.
- both protected shapes across the direct-entry boundary: exactly in the body's guard, and case-folded in the launcher's `is_protected`.
- the agent grant `['ws-collect','--expect']`, enrolled in `REQUIRED_VERB_FLAG` and backed by bypass fixture `g20`. `ws-audit --collect` rides `['ws-audit','--session']` with no agent change.
- `CCD_ARGV.wsCollectAudit`, `CCD_ARGV.wsCollect` and `COLLECT_CAP`, declared with no caller (ws-expire's inert wave declared its builders the same way). A scan pins that nothing composes them.
- the runner's own 240 s budget row for `ws-collect` (R68).

This task owns the CAP, and declares NO act and NO refusal word:
- Task 4's first part declares the `collect` act (ruling G1).
- Task 5 owns `witness-mismatch` and `quarantine-kept`, and Task 6 owns `not-witnessed`, `registered` and `not-idle`: their `LcRefusalToken` / `LC_REFUSAL_WORD` / `ALL_TOKENS` entries (ruling G2).
- Task 1 owns `containment-refuted`.
- Task 10 carries the `CLAUDE.md` and `agent/CLAUDE.md` text for `ws-collect` and its prose pin, modelled on `ws-expire-prose.test.ts`, which also pins that no skill corpus names the verb (ruling T7 OPEN4). This task edits no prose.

**Two parts, two commits.**
- **Part B (reachability)** needs two things from Tasks 5 and 6: `cmd_ws_audit`'s `--collect` route and `cmd_ws_collect`.
- **Part C (server and agent)** needs Part B.

**Files:**
- Modify: `ccd/ccd`. Make six edits, each located by content (line numbers are hints at `b0647d850`):
  - **E1:** the guard's header comment, `ccd/ccd:12` and `:13` (`grep -n 'A direct .ws-reclaim. or .ws-expire.' ccd/ccd`). Two lines for two lines.
  - **E2:** the entry guard, `ccd/ccd:27` and `:28` (`grep -n -F 'ws-reclaim || "${1-}" == ws-expire ]]' ccd/ccd`). Two lines for two lines.
  - **E3:** `ccd caps`' shared line, `ccd/ccd:8628` (`grep -n 'echo reclaim-pause-v1; echo expire-v1; echo ws-expire' ccd/ccd`). One line for one.
  - **E4:** the dispatcher arm, directly under `ccd/ccd:35167` (`grep -n '^  ws-expire) shift; cmd_ws_expire' ccd/ccd`). Plus one line.
  - **E5:** the unknown-verb usage, `ccd/ccd:35183` (`grep -n 'usage: ccd {start|' ccd/ccd`). One for one.
  - **E7:** the `COLLECT-V1` note in the COLLECT region Task 4 opened, directly above its `COLLECT-END` marker (below Task 5's audit and Task 6's verb). It sits below the boundary, so it is free to add lines.

  (E6, `_LC_ACTS`, moved to Task 4's first part with the act, ruling G1; the numbering is kept so the other ids do not move.)

  E1, E2 and E3 lie above the frozen citation boundary (19109, or what Task 0's (e4) measured). They are LENGTH-NEUTRAL and are proven so in Step B4.
- Modify: `ccd/ccd-entry.py`. Two edits:
  - the WHAT IS PROTECTED list (`ccd/ccd-entry.py:24` to `:28`, `grep -n '^#   ws-expire <any tail>' ccd/ccd-entry.py`);
  - `is_protected` (`ccd/ccd-entry.py:143`, `grep -n '^def is_protected' ccd/ccd-entry.py`).
- Modify: `server/src/ccdargv.ts`. Two edits:
  - `COLLECT_CAP` after the last capability constant: `EXPIRE_CAP` at `server/src/ccdargv.ts:802` on main (`grep -n '^export const EXPIRE_CAP' server/src/ccdargv.ts`), or #319's `DOCS_CAP` if it has landed (Part B);
  - the two builders directly after `wsExpire` (`server/src/ccdargv.ts:428`, `grep -n "    argv(\['ws-expire', '--expect'" server/src/ccdargv.ts`) (Part C).
- Modify: `server/src/remote/runner.ts`. Add one row directly after `'ws-expire': 240_000,` (`server/src/remote/runner.ts:58`).
- Modify: `agent/src/whitelist.ts`. Two edits:
  - `REQUIRED_VERB_FLAG` (`agent/src/whitelist.ts:310`, `grep -n '^export const REQUIRED_VERB_FLAG' agent/src/whitelist.ts`);
  - the END of `EXEC_WHITELIST.ccd`, after `['win-size',   '--session'],` at `agent/src/whitelist.ts:555` on main, or after whatever entry is last at dispatch (R72).
- Create: `agent/test/types/bypasses/g20-ws-collect-without-expect.ts`.
- Modify: `agent/test/types/ok/legit-whitelist.ts`. Add one type after `WsExpireNeedsExpect` (`:91`).
- Modify: `agent/test/whitelist-structural.test.ts`. Two edits:
  - one `EXPECTED` entry after `'g15-ws-expire-without-expect.ts'` (`:137`);
  - one throws case after `'throws on a ws-expire with no confirmation token…'` (`:349`).
- Modify: `agent/test/ccd-entry-exec.test.ts`. Add two `cases` rows before `[['ensure', 'demo-x'], false],` (`:71`).
- Modify (cardinals and exhaustive maps only, each forced by the code change):
  - `server/test/ccd-archive.test.ts:12`, `:154`, `:188`;
  - `server/test/caps-token-shape.test.ts:36`, `:75`;
  - `server/test/whitelist-subset.test.ts:70`, `:530`;
  - `server/test/remote-runner.test.ts:96`;
  - `server/test/ccdargv-dec-parity.test.ts:156`, `:227`, `:241`.
- Test (new): `server/test/ccd-ws-collect-reach.test.ts`, `server/test/ws-collect-wiring.test.ts`. (`server/test/ws-collect-act.test.ts` and the conditional README re-pointing moved to Task 4 with the act, ruling G1.)

**Interfaces:**
- Consumes:
  - Task 6: `cmd_ws_collect` in `ccd/ccd`.
    - With no arguments, it dies with a stderr line containing `usage: ccd ws-collect`, at rc 1.
    - Its argv mirrors `cmd_ws_expire`: `--expect <64 lowercase hex> --session <id> [--surface <w>] [--actor <t>] [--reason <t>]`. It strips the dec before it binds a positional.
    - For an id outside the population (no witness, no quarantine record), it prints `{"refused":"not-witnessed","detail":"…<id>…","paths":[]}` at rc 0. The detail names the id, and no lock is taken. This task only checks `toContain`, so the trailing `"paths":[]` changes nothing here.
  - Task 5: `cmd_ws_audit` routes `ws-audit --session <id> --collect` (exactly four arguments) to the collector's audit.
    - Any other `--collect` shape dies with a `ccd: usage: ccd ws-audit --session <id> [… --collect …]` line at rc 1.
  - Task 4: the COLLECT region in `ccd/ccd`, from `# ── temp-root collection: ws-collect (spec 2026-09-22 §5.2, §5.6) ─── COLLECT-BEGIN ──` to `# ── end temp-root collection ─── COLLECT-END ──`. Task 5's audit block and Task 6's `cmd_ws_collect() {` sit inside it, above `COLLECT-END`. The quarantine RECORD directory is `$REG/tmpquarantine/` (`_ws_collect_qrec_dir`); the quarantine itself is `<physical ~/.cc-tmp>/.ccd-quarantine`.
  - Task 4 (its first part, ruling G1): the `collect` journal act — `_LC_ACTS`, `LifecycleAct`, `LIFECYCLE_ACT_MAP`, `ACT_WORD.collect = 'temp root collected'`, `NEUTRAL_ACTS`, and out of the dead-coordinator lists — pinned by `server/test/ws-collect-act.test.ts`.
  - Tasks 1, 5 and 6 have already declared their refusal words in `shared/api.ts` (ruling G2): `containment-refuted` (Task 1), `witness-mismatch` and `quarantine-kept` (Task 5), `not-witnessed`, `registered` and `not-idle` (Task 6).
  - Test side:
    - `CCD`, `ghContainedEnv`, `installDirectEntry` and `DirectEntry` (`server/test/ccdWsHelpers.ts`);
    - `makePrHarness` (`server/test/ccdPrHelpers.ts`), `inheritedEnv` (`server/test/gitEnvStrip.ts`) and `itLinux` (`server/test/platformFixtures.ts`);
- Produces:
  ```text
  ccd caps                                   # prints collect-v1 and ws-collect (one shared line in cmd_caps)
  ccd ws-collect …                           # dispatched to cmd_ws_collect; named in the unknown-verb usage
  entry boundary (body, exact; launcher, case-folded):
    ws-collect <any tail>                    -> protected (bash -p)
    ws-audit --session <value> --collect     -> protected (exactly 4 argv)
  ```
  ```ts
  // agent/src/whitelist.ts
  REQUIRED_VERB_FLAG['ws-collect'] === '--expect'
  EXEC_WHITELIST.ccd ⊇ [['ws-collect', '--expect']]          // and NO new ws-audit grant
  // server/src/ccdargv.ts
  export const COLLECT_CAP = 'collect-v1';
  CCD_ARGV.wsCollectAudit: (id: string) => CcdArgv            // ['ws-audit','--session',id,'--collect']
  CCD_ARGV.wsCollect: (token: string, id: string, dec: ActorFlags | null) => CcdArgv
                                                              // ['ws-collect','--expect',token,'--session',id,...decFlags(dec)]
  // server/src/remote/runner.ts
  CCD_VERB_TIMEOUT_MS['ws-collect'] === 240_000
  ```
  - `server/test/ws-collect-wiring.test.ts`'s INERT case is the pin wave 9 must deliberately replace when it adds the builders' one caller (with `verb-gate.test.ts`'s `CAP_GATED_VERBS` entry).

---

#### Part B: reachable, behind the entry boundary

- [ ] **Step B0: Measure the starting state**

```bash
grep -n '^cmd_ws_collect() {' ccd/ccd                                  # (b1) one line, > 19109 (Task 6)
grep -c '^  ws-collect) ' ccd/ccd                                      # (b2) 0 — Task 6 left the arm to this task
grep -n 'echo reclaim-pause-v1; echo expire-v1; echo ws-expire' ccd/ccd  # (b3) one line, < 19109
grep -n -F '"${4-}" == --expire' ccd/ccd                               # (b4) one line (the guard)
grep -n 'COLLECT-BEGIN\|COLLECT-END' ccd/ccd                           # (b5) exactly two lines: Task 4's COLLECT-BEGIN and COLLECT-END markers
grep -n '^_child_tmpdir()' ccd/ccd; grep -n '^cmd_caps()' ccd/ccd; grep -n '^cmd_ws_audit()' ccd/ccd   # (b6) RECORD all three numbers
grep -n '^export const [A-Z_]*_CAP = ' server/src/ccdargv.ts | tail -1  # (b7) the last capability constant (EXPIRE_CAP on main; DOCS_CAP if #319 landed)
sed -n "$(grep -n '^_LC_ACTS=(' ccd/ccd | cut -d: -f1),+2p" ccd/ccd | grep -cw collect   # (b8) 1 — Task 4 declared the act (ruling G1)
```

- (b2) must print 0: the dispatcher arm and the caps line land in ONE commit, in this task, and Task 6 adds no arm (ruling T7 OPEN2). If it prints 1, STOP and report.
- (b5) must print exactly two lines, Task 4's markers. A third line containing `COLLECT-END` means a nested marker still carries the region's token: STOP and report, because every slicer ends the region at the first `COLLECT-END`.
- (b8) must print 1. If it prints 0, STOP: Task 4's act part has not landed (ruling G1).
- (b6)'s three numbers must be IDENTICAL after Step B3. That is the proof that every edit above the boundary is length-neutral.

- [ ] **Step B1: Write the failing tests**

Create `server/test/ccd-ws-collect-reach.test.ts`:

```ts
// `ws-collect` made REACHABLE (child reclamation spec 2026-09-22 §5.6, §8's wave 7): the dispatcher arm, the verb's
// name and its capability token `collect-v1` in `ccd caps`, and the direct-entry boundary both protected shapes cross
// — `ws-collect <any tail>` and `ws-audit --session <id> --collect` — at BOTH classifiers: the installed launcher
// (`ccd/ccd-entry.py`'s `is_protected`, a case-folding superset) and the body's own entry guard (exact). One table run
// against both, as `ccd-child-reclaim-entry.test.ts` runs its own; the collector's rows live here so that suite stays
// under the foreground ceiling. FIXTURE HOME ONLY: every launcher is a fixture install under the harness HOME, and no
// argv here reaches a collection — a protected shape is refused at entry, started over an echo body, or stopped by
// its own usage line.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, ghContainedEnv, installDirectEntry, type DirectEntry } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { itLinux } from './platformFixtures.js';

let h: PrHarness;
let de: DirectEntry;
beforeEach(() => { h = makePrHarness('ccrc-ws-collect-reach-'); });
afterEach(() => { h.cleanup(); });

const ANY_TOKEN = 'a'.repeat(64);
/** Every variable Bash startup consumes, removed so a CONTROL is clean by construction. */
const STARTUP_KEYS = ['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS', 'CDPATH', 'GLOBIGNORE'];
const cleanEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(inheritedEnv())) {
    if (k.startsWith('BASH_FUNC_') || STARTUP_KEYS.includes(k)) continue;
    env[k] = v;
  }
  return env;
};
interface Ran { code: number; stdout: string; stderr: string }
const run = (file: string, args: readonly string[], env: Record<string, string> = {}): Ran => {
  const bin = path.join(h.home, '.local', 'bin');
  const r = spawnSync(file, [...args], {
    cwd: h.home, encoding: 'utf8', timeout: 120_000,
    env: ghContainedEnv(h.home, { ...cleanEnv(), HOME: h.home, PATH: `${bin}:${process.env['PATH'] ?? ''}`, ...env },
      { systemd: true, tmux: true }),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};
/** The installed direct entry, executed by the kernel — the agent's own `execFile` shape. */
const direct = (args: readonly string[], env: Record<string, string> = {}): Ran => run(de.entry, args, env);
/** `ccd/ccd` by an EXPLICIT bash: `['-p']` is the launcher's start for a protected argv, `[]` the one it refuses. */
const bash = (flags: readonly string[], args: readonly string[], env: Record<string, string> = {}): Ran =>
  run('bash', [...flags, CCD, ...args], env);

/** A body that reports what it was started with (`$-` and its argv, NUL-terminated), installed in place of the real
 *  body, so the LAUNCHER's classification is what is read. */
const ECHO_BODY = '#!/usr/bin/env bash\n{ printf "%s\\0" "$-"; printf "%s\\0" "$@"; } > "$HOME/argv-out"\n';
const echoed = (): { flags: string; argv: string[] } => {
  const parts = fs.readFileSync(path.join(h.home, 'argv-out'), 'utf8').split('\0');
  parts.pop();
  return { flags: parts[0] ?? '', argv: parts.slice(1) };
};

describe('reachable: the capability token, the verb and the dispatcher arm', () => {
  it('ccd caps advertises the verb AND its capability token, on the line expire-v1 shares', () => {
    const advertised = h.sh('cmd_caps').split('\n');
    expect(advertised).toContain('ws-collect');
    expect(advertised).toContain('collect-v1');
    expect(advertised, 'the CONTROL: the shared line still prints its own tokens').toEqual(expect.arrayContaining(['expire-v1', 'ws-expire']));
  }, 60_000);

  it('the dispatcher routes ws-collect to its own usage, and the unknown-verb line names it', () => {
    const r = bash(['-p'], ['ws-collect']);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toContain('usage: ccd ws-collect');
    expect(r.stderr).not.toContain('usage: ccd {start|');
    expect(bash(['-p'], ['no-such-verb']).stderr).toContain('|ws-collect|');
  }, 60_000);

  it('an unprivileged explicit bash is refused at entry for both protected shapes — nothing runs', () => {
    for (const argv of [['ws-collect'], ['ws-collect', '--expect', ANY_TOKEN, '--session', 'x'],
                        ['ws-audit', '--session', 'x', '--collect']]) {
      const b = bash([], argv);
      expect(b.code, `${argv.join(' ')}: ${b.stderr.slice(0, 300)}`).toBe(125);
      expect(b.stderr).toContain('refused (entry-unprivileged)');
    }
  }, 60_000);
});

/** Any `cmd_ws_audit` usage line that names the collector's mode — Task 5's wording, matched by what it must say. */
const AUDIT_USAGE = /^ccd: usage: ccd ws-audit --session <id> \[.*--collect.*\]$/m;
/** The GRAMMAR TABLE, run against both classifiers. `true` = protected. The fourth column is where a MALFORMED audit
 *  shape must die: ordinary at both entries, and still refused by `cmd_ws_audit`'s own parse. */
const GRAMMAR: ReadonlyArray<readonly [string, readonly string[], boolean, RegExp | null]> = [
  ['ws-collect alone', ['ws-collect'], true, null],
  ['ws-collect with the full tail', ['ws-collect', '--expect', ANY_TOKEN, '--session', 'x'], true, null],
  ['ws-collect with a dec trailing', ['ws-collect', '--expect', ANY_TOKEN, '--session', 'x', '--surface', 'agent'], true, null],
  ['ws-collect with a malformed tail (the body’s parser owns that)', ['ws-collect', '--defer-expired'], true, null],
  ['valid audit --collect', ['ws-audit', '--session', 'x', '--collect'], true, null],
  ['valid audit --collect with a session value the body will reject', ['ws-audit', '--session', '../../etc/passwd', '--collect'], true, null],
  ['audit, --collect --defer-expired (no such mode)', ['ws-audit', '--session', 'x', '--collect', '--defer-expired'], false, AUDIT_USAGE],
  ['audit, a later duplicate --collect', ['ws-audit', '--session', 'x', '--collect', '--collect'], false, AUDIT_USAGE],
  ['audit, --collect out of order', ['ws-audit', '--collect', '--session', 'x'], false, AUDIT_USAGE],
  ['a verb merely CONTAINING ws-collect later', ['caps', 'ws-collect'], false, null],
  ['ws-collectx (prefix only)', ['ws-collectx'], false, null],
  // CONTROLS: the shapes beside the collector's, unchanged by its rows.
  ['valid audit --expire (control)', ['ws-audit', '--session', 'x', '--expire'], true, null],
  ['plain audit (control)', ['ws-audit', '--session', 'x'], false, null],
];

describe('the protected grammar — the launcher and the body classify the same argv the same way', () => {
  for (const [name, argv, protectedShape, dies] of GRAMMAR) {
    it(`${name} → ${protectedShape ? 'protected' : 'ordinary'}`, () => {
      de = installDirectEntry(h.home, { body: ECHO_BODY });
      const r = direct(argv);
      expect(r.code, r.stderr).toBe(0);
      const got = echoed();
      expect(got.argv, 'argv arrives exactly').toEqual([...argv]);
      expect(got.flags.includes('p'), `launcher: flags ${got.flags}`).toBe(protectedShape);
      const b = bash([], argv);
      const refusedAtEntry = b.code === 125 && /refused \(entry-/.test(b.stderr);
      expect(refusedAtEntry, `body: rc ${b.code} ${b.stderr.slice(0, 300)}`).toBe(protectedShape);
      if (dies) {
        expect(b.code, `explicit bash: ${b.stderr.slice(0, 300)}`).toBe(1);
        expect(b.stderr).toMatch(dies);
        de = installDirectEntry(h.home);
        const l = direct(argv);
        expect(l.code, `launcher: ${l.stderr.slice(0, 300)}`).toBe(1);
        expect(l.stderr).toMatch(dies);
        expect(l.stderr).not.toContain('refused (entry-');
      }
    }, 60_000);
  }
});

/** An inherited `nocasematch` folds the BODY's guard and dispatcher (in C.UTF-8 beyond ASCII: U+0130 folds to `i`),
 *  so each variant must start PROTECTED at the launcher, where `-p` drops the option. */
const DOTTED_I = 'İ';
const NOCASE = { BASHOPTS: 'nocasematch', LC_ALL: 'C.UTF-8' };
const CASE_VARIANTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['WS-COLLECT alone', ['WS-COLLECT']],
  ['Ws-Collect with the full tail', ['Ws-Collect', '--expect', ANY_TOKEN, '--session', 'x']],
  ['WS-AUDIT --SESSION x --COLLECT', ['WS-AUDIT', '--SESSION', 'x', '--COLLECT']],
  [`ws-audit --sess${DOTTED_I}on x --collect (a non-ASCII fold)`, ['ws-audit', `--sess${DOTTED_I}on`, 'x', '--collect']],
];
/** Protected at the launcher although no measured locale folds them — the superset's harmless other half. */
const SUPERSET_ONLY: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['wſ-collect (a code point no measured fold maps to s)', ['wſ-collect']],
  ['ws-coléct (two bytes, two characters to a single-byte locale)', ['ws-coléct']],
];
const CASE_ORDINARY: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['WS-COLLECTX (prefix only)', ['WS-COLLECTX']],
  ['CAPS WS-COLLECT', ['CAPS', 'WS-COLLECT']],
  ['WS-AUDIT --SESSION x --COLLECT --DEFER-EXPIRED', ['WS-AUDIT', '--SESSION', 'x', '--COLLECT', '--DEFER-EXPIRED']],
];

describe('a case variant of a protected shape starts PROTECTED — the launcher folds case, a superset', () => {
  for (const [name, argv] of [...CASE_VARIANTS, ...SUPERSET_ONLY]) {
    it(`${name} → protected at the launcher`, () => {
      de = installDirectEntry(h.home, { body: ECHO_BODY });
      const r = direct(argv, NOCASE);
      expect(r.code, r.stderr).toBe(0);
      expect(echoed().argv, 'argv arrives exactly').toEqual([...argv]);
      expect(echoed().flags.includes('p'), `launcher: flags ${echoed().flags}`).toBe(true);
    }, 60_000);
  }
  for (const [name, argv] of CASE_ORDINARY) {
    it(`${name} → ordinary at the launcher`, () => {
      de = installDirectEntry(h.home, { body: ECHO_BODY });
      expect(direct(argv, NOCASE).code).toBe(0);
      expect(echoed().flags.includes('p'), `launcher: flags ${echoed().flags}`).toBe(false);
    }, 60_000);
  }

  itLinux('the CONTROL: under that nocasematch the BODY reads every variant as protected, and none of the ordinary ones', () => {
    for (const [name, argv] of CASE_VARIANTS) {
      const b = bash([], argv, NOCASE);
      expect(b.code === 125 && /refused \(entry-unprivileged\)/.test(b.stderr), `${name}: rc ${b.code} ${b.stderr.slice(0, 200)}`).toBe(true);
    }
    for (const [name, argv] of CASE_ORDINARY) {
      expect(/refused \(entry-/.test(bash([], argv, NOCASE).stderr), name).toBe(false);
    }
  }, 120_000);

  it('started protected, the real body compares exactly again: a variant is no verb at all', () => {
    de = installDirectEntry(h.home);
    const r = direct(['WS-COLLECT', '--expect', ANY_TOKEN], NOCASE);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/^usage: ccd \{/m);
    expect(r.stderr).not.toContain('refused (entry-');
  }, 60_000);
});
```

Then make two small edits to existing tests. Both are forced, because each test holds a hand-kept list equal to what ccd prints:
- `server/test/ccd-archive.test.ts`:
  - `:12`: add `COLLECT_CAP` to the `../src/ccdargv.js` import, in alphabetical order after `CHILD_ARGV_CAP`.
  - `:154`: add `'collect-v1'` to `KNOWN_CAPABILITY_TOKENS` after `'child-argv-v1'`.
  - Directly under `:188`'s `expect(KNOWN_CAPABILITY_TOKENS).toContain(EXPIRE_CAP);`, add:
    ```ts
    // Child reclamation wave 7's token: the third spelling of `collect-v1`, held equal to the constant the collector's
    // lane will gate on (`capSupported`) and to ccd's own `echo collect-v1`.
    expect(KNOWN_CAPABILITY_TOKENS).toContain(COLLECT_CAP);
    ```
- `server/test/caps-token-shape.test.ts`:
  - `:36`: change the import to `import { COLLECT_CAP, EXPIRE_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';`.
  - Directly under `:75`'s `expect(toks).toContain('ws-expire');`, add:
    ```ts
    expect(toks).toContain(COLLECT_CAP);
    expect(toks).toContain('ws-collect');
    ```

- [ ] **Step B2: Run them to see them fail**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-reach.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts -t 'ccd caps')
(cd server && ./node_modules/.bin/vitest run test/caps-token-shape.test.ts)
```

Expected:
- **The reach suite:**
  - "advertises" fails with `expected [ … ] to include 'ws-collect'`.
  - "routes" fails with `expected '…usage: ccd {start|…' to contain 'usage: ccd ws-collect'`.
  - "refused at entry" fails with `ws-collect: expected 1 to be 125`, because the unknown verb dies at the dispatcher.
  - The grammar rows for `ws-collect` and `ws-audit … --collect` fail with `launcher: flags …: expected false to be true`.
  - The `--collect` case variants and the `SUPERSET_ONLY` rows fail the same way.
  - The "started protected" case PASSES (no verb by that name exists either way).
  - The ordinary rows and both controls PASS.
- **`ccd-archive` and `caps-token-shape`:** `COLLECT_CAP` is not yet exported, so `toContain(undefined)` fails. `ccd-archive`'s parity also fails, with `expected [ …15 ] to deeply equal [ …16 ]`.

- [ ] **Step B3: Implement**

**E1, `ccd/ccd`, two lines for two.** Replace the guard header's second and third lines:

```bash
# A direct `ws-reclaim`, `ws-expire` or `ws-collect`, or a direct `ws-audit --session <id>
# --reclaim [--defer-expired]`, `… --expire` or `… --collect`, runs under Bash >= 4.4 PRIVILEGED with
```

**E2, `ccd/ccd`, two lines for two.** Replace the guard's first two lines; its third line (`&& [[ $# -eq 4 || "${5-}" == --defer-expired ]]; }; }; then`) is unchanged:

```bash
if [[ "${BASH_SOURCE[0]}" == "${0}" ]] && { [[ "${1-}" == ws-reclaim || "${1-}" == ws-expire || "${1-}" == ws-collect ]] \
     || { [[ $# -eq 4 || $# -eq 5 ]] && [[ "${1-}" == ws-audit && "${2-}" == --session && ( "${4-}" == --reclaim || ( $# -eq 4 && ( "${4-}" == --expire || "${4-}" == --collect ) ) ) ]] \
```

`--collect` is protected at EXACTLY four arguments, as `--expire` is. With five arguments the fifth must follow `--reclaim`, so `… --collect --defer-expired` stays ordinary and dies at `cmd_ws_audit`'s own usage.

**E3, `ccd/ccd`, one line for one.** Replace `cmd_caps`' shared line:

```bash
  echo reclaim-pause-v1; echo expire-v1; echo ws-expire; echo collect-v1; echo ws-collect   # the verbs ride here, not in the list above, which sits above the frozen corpus; see "EXPIRE-V1" and "COLLECT-V1"
```

**E4, `ccd/ccd`.** Directly under `  ws-expire) shift; cmd_ws_expire "$@" ;;`, insert:

```bash
  ws-collect) shift; cmd_ws_collect "$@" ;;
```

**E5, `ccd/ccd`.** In the unknown-verb usage line, change `|ws-reclaim|ws-expire|ws-hold|` to `|ws-reclaim|ws-expire|ws-collect|ws-hold|`.

**E7, `ccd/ccd`.** Insert this paragraph as the last lines of the COLLECT region: directly above Task 4's end marker from (b5), the line that starts `# ── end temp-root collection` and ends `COLLECT-END ──`, so it lands below Task 5's audit block and Task 6's verb:

```bash
# COLLECT-V1. `cmd_caps` echoes it, and the verb `ws-collect` beside it: this
# box has `ws-audit --collect`, `ws-collect`, the `collect` journal act and the
# quarantine record under `$REG/tmpquarantine/` — one ccd inode, one token
# (spec 2026-09-22 §5.6, §8's wave 7). The server composes the destructive verb
# ONLY behind `capSupported(state, 'collect-v1')`, which refuses on no evidence;
# the collector's lane composes it, and this wave ships it inert. Both protected
# shapes cross the direct-entry boundary at the top of this file and in
# `ccd/ccd-entry.py`.
```

**`ccd/ccd-entry.py`.** In WHAT IS PROTECTED, directly under the two `ws-expire <any tail>` lines, add:

```python
#   ws-collect <any tail>                         — likewise (child reclamation wave 7: the
#     collector of a witnessed child temp root whose workspace is gone)
```

Directly under `#   ws-audit --session <value> --expire           — the expiry's token skeleton;`, add:

```python
#   ws-audit --session <value> --collect          — the collector's token skeleton;
```

Replace `is_protected`'s first two statements, leaving the final `return (…)` unchanged:

```python
def is_protected(argv):
    # CASE-INSENSITIVE, A SUPERSET ON PURPOSE — see WHAT IS PROTECTED above.
    if argv[:1] and any(folds_to(argv[0], verb) for verb in ('ws-reclaim', 'ws-expire', 'ws-collect')):
        return True
    if len(argv) == 4 and folds_to(argv[0], 'ws-audit') and folds_to(argv[1], '--session') \
            and (folds_to(argv[3], '--expire') or folds_to(argv[3], '--collect')):
        return True
```

**`server/src/ccdargv.ts`.** Directly after the last capability constant measured at (b7) (`EXPIRE_CAP` on main), add:

```ts

/** The `ccd caps` token that says this box has the child temp-root collector (child reclamation spec 2026-09-22 §5.6,
 *  §8's wave 7): `ws-audit --collect`, `ws-collect`, the `collect` journal act and the quarantine record — one ccd
 *  inode. Spelled ONCE in `server/src`; ccd's `echo collect-v1` and `ccd-archive.test.ts`'s `KNOWN_CAPABILITY_TOKENS`
 *  are the other two spellings, held equal by that test's `toContain`.
 *
 *  READ IT WITH `capSupported`, NEVER `verbSupported`: the verb it gates deletes a directory, and a destructive verb sent
 *  to a box with no evidence it exists is the failure the capability reader was built to prevent. Nothing reads it in
 *  this build — the collector's lane does, before its first audit (`ws-collect-wiring.test.ts` pins that). */
export const COLLECT_CAP = 'collect-v1';
```

- [ ] **Step B4: Re-stamp, prove length-neutrality, run green**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd; echo "mark rc=$?"                       # rc=0
grep -n '^_child_tmpdir()' ccd/ccd; grep -n '^cmd_caps()' ccd/ccd; grep -n '^cmd_ws_audit()' ccd/ccd   # IDENTICAL to (b6)
git diff -U0 -- ccd/ccd | awk -v B=19109 '/^@@/{split($2,o,",");split($3,n,",");s=substr(o[1],2)+0;oc=(o[2]==""?1:o[2]+0);nc=(n[2]==""?1:n[2]+0);if(s<=B&&oc!=nc)print "NOT NEUTRAL: " $0}'   # prints nothing
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-reach.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts -t 'ccd caps')
(cd server && ./node_modules/.bin/vitest run test/caps-token-shape.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-entry.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-reach.test.ts)
(cd server && ./node_modules/.bin/tsc --noEmit -p .)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND')
```

Use Task 0's measured boundary for `B` if it is not 19109. Expected:
- The reach suite passes in full. On macOS the body control is skipped.
- `ccd-archive`'s caps parity, `caps-token-shape`, the existing entry suite (its reclaim and expire rows) and the expire reach suite stay green.
- The awk check prints nothing, and the three anchors are unchanged.
- `server/test/git-env-strip.test.ts` stays green with no edit here: Task 4 widened its `SCOPE` to `ccd-ws-collect-.*\.test\.ts` and listed this suite in its `later` array (ruling G12). Run `(cd server && ./node_modules/.bin/vitest run test/git-env-strip.test.ts)`.
- The citation cases stay green. Every edit above the boundary is length-neutral, so a red here means a cited anchor moved: STOP and apply S6-R11 as R56 directs, never adjust the census by hand. `ccd-child-reclaim-entry` is long, so run it in the foreground with a timeout of at least 600000 ms.

- [ ] **Step B5: Mutation check**

| # | Mutation (exact edit; re-stamp after each `ccd/ccd` edit) | Command | Expected red |
|---|---|---|---|
| B1 | E3: delete `echo collect-v1; ` | `(cd server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts -t 'ccd caps')` | `expected [ …15 ] to deeply equal [ …16 ]` (the capability half); reach: `expected [ … ] to include 'collect-v1'` |
| B2 | E3: delete `; echo ws-collect` | same | `expected [ … ] to deeply equal [ …, 'ws-collect', … ]` (verbs vs dispatched arms); reach: `to include 'ws-collect'` |
| B3 | E4: delete the `ws-collect)` arm | `(cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-reach.test.ts -t 'routes')` | `expected '…usage: ccd {start|…' to contain 'usage: ccd ws-collect'` |
| B4 | E5: change `|ws-collect|ws-hold|` back to `|ws-hold|` | same | `expected '…' to contain '|ws-collect|'` |
| B5 | E2: delete ` || "${1-}" == ws-collect` | `(cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-reach.test.ts -t 'refused at entry')` | `ws-collect: expected 1 to be 125` |
| B6 | E2: replace `( "${4-}" == --expire || "${4-}" == --collect )` with `"${4-}" == --expire` | same | `ws-audit --session x --collect: expected <the audit's rc> to be 125` |
| B7 | E2: replace `( "${4-}" == --reclaim || ( $# -eq 4 && ( "${4-}" == --expire || "${4-}" == --collect ) ) )` with `( "${4-}" == --reclaim || "${4-}" == --collect || ( $# -eq 4 && "${4-}" == --expire ) )` | `(cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-reach.test.ts -t 'no such mode')` | `body: rc 125 …refused (entry-unprivileged)…: expected true to be false` |
| B8 | `is_protected`: drop `'ws-collect'` from the verb tuple | `(cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-reach.test.ts -t 'ws-collect alone')` | `launcher: flags …: expected false to be true` |
| B9 | `is_protected`: replace `(folds_to(argv[3], '--expire') or folds_to(argv[3], '--collect'))` with `folds_to(argv[3], '--expire')` | `(cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-reach.test.ts -t 'valid audit --collect')` | `launcher: flags …: expected false to be true` |
| B10 | `is_protected`: replace `folds_to(argv[0], verb)` with `argv[0] == verb` | `(cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-reach.test.ts -t 'WS-COLLECT alone')` | `launcher: flags …: expected false to be true` |
| B11 | `COLLECT_CAP = 'collect-v2'` | `(cd server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts -t 'ccd caps')` | `expected [ … ] to include 'collect-v2'` |

Revert each mutation, re-stamp, and re-run Step B4's commands green.

- [ ] **Step B6: Commit**

```bash
git add ccd/ccd ccd/ccd-entry.py server/src/ccdargv.ts server/test/ccd-ws-collect-reach.test.ts \
  server/test/ccd-archive.test.ts server/test/caps-token-shape.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): ws-collect reachable — the dispatcher, collect-v1, the entry boundary

The dispatcher routes ws-collect; ccd caps names the verb and collect-v1
on the line expire-v1 shares (length-neutral: it sits above the frozen
citation corpus), and COLLECT_CAP is its third spelling. ws-collect and
ws-audit --session <id> --collect cross the direct-entry boundary
ws-reclaim and ws-expire cross: the launcher starts them under bash -p,
folding case, and the body's guard refuses them otherwise. Every edit above
the boundary keeps its line count.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

#### Part C: the agent grant, the builders and the budget, and nothing that calls them

- [ ] **Step C0: Measure the append points (R72)**

```bash
sed -n "$(grep -n '^export const REQUIRED_VERB_FLAG' agent/src/whitelist.ts | cut -d: -f1),/^} as const;/p" agent/src/whitelist.ts   # (c1) the last entry line
awk '/^  ccd: \[/{f=1} f&&/^  \],/{print NR": "prev; exit} {prev=$0}' agent/src/whitelist.ts                                      # (c2) the ccd block's last entry
ls agent/test/types/bypasses/                                                                                                       # (c3) g15 last on main; g16 to g19 if #319 landed
grep -n "'ws-expire': 240_000" server/src/remote/runner.ts                                                                          # (c4)
ls agent/node_modules/.bin/vitest agent/node_modules/.bin/tsc                                                                       # (c5) present, else npm ci in agent/ (the pwa checks moved to Task 4 with the act, ruling G1)
```

- **(c1)** is `  'reclaim-pause': '--state', 'ws-expire': '--expect',` on main, or #319's line if #319 has landed. Append after it.
- **(c2)** is `['win-size',   '--session'],` (`agent/src/whitelist.ts:555`) on main, or #319's last grant if #319 has landed. Append after it.
- **(c3)** confirms that `g20` is free.
- **Claims.** Do not start this part while claim 1110 (run 320) holds `agent/src/whitelist.ts` or `server/test/whitelist-subset.test.ts`, unless Task 0 recorded a line-disjointness agreement.

- [ ] **Step C1: Write the failing tests**

Create `server/test/ws-collect-wiring.test.ts`:

```ts
// The collector's server and agent wiring (child reclamation spec 2026-09-22 §5.6, §8's wave 7), AGENT-FIRST and
// INERT: the agent grants `ws-collect` on its confirmation token and nothing else new — `ws-audit --collect` rides the
// existing `['ws-audit','--session']` prefix — and `CCD_ARGV` declares the two builders and `COLLECT_CAP` while NO
// server source composes either. The collector's lane is the builders' one future caller, behind
// `capSupported(COLLECT_CAP)`; the wave that adds it replaces the INERT case below with `verb-gate.test.ts`'s
// `CAP_GATED_VERBS` entry for `ws-collect`.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXEC_WHITELIST, REQUIRED_VERB_FLAG, UNGRANTABLE_VERBS, isExecAllowed } from '../../agent/src/whitelist.js';
import { CCD_ARGV, COLLECT_CAP } from '../src/ccdargv.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const TOKEN = 'a'.repeat(64);
const ID = 'demo-quiet-dune';

describe('the agent grant — ws-collect on its confirmation token, the audit on the existing prefix', () => {
  it('ws-collect is grantable ONLY with --expect, and enrolled so a bare grant can neither compile nor boot', () => {
    expect(EXEC_WHITELIST.ccd.filter((p) => p[0] === 'ws-collect'), 'exactly one grant, on its token')
      .toEqual([['ws-collect', '--expect']]);
    expect((REQUIRED_VERB_FLAG as Readonly<Record<string, string>>)['ws-collect']).toBe('--expect');
    expect(isExecAllowed('ccd', ['ws-collect'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-collect', '--session', ID])).toBe(false);
    expect(isExecAllowed('ccd', [...CCD_ARGV.wsCollect(TOKEN, ID, null)])).toBe(true);
    expect(isExecAllowed('ccd', [...CCD_ARGV.wsCollect(TOKEN, ID, { surface: 'agent', actor: 'collect sweep', reason: null })])).toBe(true);
    expect(UNGRANTABLE_VERBS as readonly string[], 'it has a lawful grantable form').not.toContain('ws-collect');
  });

  it('ws-audit --collect needs NO grant of its own: the one ws-audit grant is the one it always was', () => {
    expect(EXEC_WHITELIST.ccd.filter((p) => p[0] === 'ws-audit')).toEqual([['ws-audit', '--session']]);
    expect(isExecAllowed('ccd', [...CCD_ARGV.wsCollectAudit(ID)])).toBe(true);
  });
});

describe('the builders — the exact argv, the confirmation token leading', () => {
  it('wsCollectAudit and wsCollect build exactly what ccd parses, and the token is the one ccd echoes', () => {
    expect(CCD_ARGV.wsCollectAudit(ID)).toEqual(['ws-audit', '--session', ID, '--collect']);
    expect(CCD_ARGV.wsCollect(TOKEN, ID, null)).toEqual(['ws-collect', '--expect', TOKEN, '--session', ID]);
    expect(COLLECT_CAP).toBe('collect-v1');
  });
});

describe('INERT — no server source composes the collector', () => {
  /** Whole-line and trailing `// ` comments dropped (whitelist-subset layer 4's cut), so prose naming a builder is
   *  never read as a call. An alias (`const A = CCD_ARGV`) or a table lookup is invisible to this scan, as it is to
   *  `verb-gate.test.ts`'s; it catches the honest composer, not someone routing around it. */
  const code = (src: string): string => src.split('\n').filter((l) => !/^\s*(?:\/\/|\/\*|\*)/.test(l))
    .map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []);
  const files = (): string[] => walk(SRC).map((f) => path.relative(SRC, f).split(path.sep).join('/')).sort();
  const holders = (re: RegExp): string[] =>
    files().filter((f) => re.test(code(fs.readFileSync(path.join(SRC, f), 'utf8'))));

  it('CONTROL: the walk reaches subdirectories and the comment cut keeps code — ws-expire has its one composer', () => {
    expect(files().length, 'the walk read server/src').toBeGreaterThan(50);
    expect(holders(/\bCCD_ARGV\s*\.\s*wsExpire\s*\(/)).toEqual(['coord/expireArchived.ts']);
  });

  it('the builders, the verb, its mode flag and its token stand only where they are declared', () => {
    expect(holders(/\bwsCollect(?:Audit)?\b/), 'a reference to either builder').toEqual(['ccdargv.ts']);
    expect(holders(/['"]ws-collect['"]/), 'the verb as a literal: the builder, and the budget row').toEqual(['ccdargv.ts', 'remote/runner.ts']);
    expect(holders(/['"]--collect['"]/), 'the audit mode flag').toEqual(['ccdargv.ts']);
    expect(holders(/\bCOLLECT_CAP\b|['"]collect-v1['"]/), 'the capability token: declared, read by nothing').toEqual(['ccdargv.ts']);
  });
});
```

Create `agent/test/types/bypasses/g20-ws-collect-without-expect.ts`:

```ts
// BYPASS FIXTURE — MUST NOT COMPILE.
//
// CHILD RECLAMATION, wave 7: `['ws-collect', '--expect']` -> `['ws-collect']`,
// i.e. a grant that keeps the destructive verb and drops its confirmation
// token — g13's and g15's shape for the temp-root collector, which removes a
// witnessed child temp root whose workspace is gone.
//
// `isExecAllowed` is PREFIX-matching, so `['ws-collect']` admits the argv
// `CCD_ARGV.wsCollect` builds exactly as the two-token grant does, and
// `server/test/whitelist-subset.test.ts`'s reachability layer stays green on
// the narrowed grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`:
// it makes this edit a TS2322 on the proof line below and a boot refusal at
// module load. A bare `ws-collect` permits an UNCONFIRMED collection of any id
// the server was talked into composing, with no tree token re-proved against
// the box inside the reap lock before the move.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['ws-collect']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
```

`agent/test/types/ok/legit-whitelist.ts`: directly under `WsExpireNeedsExpect` (`:91`), add:

```ts
/** The child temp-root collector (child reclamation wave 7): enrolled on its confirmation token like its two siblings;
 *  losing the enrolment stops this project compiling. `g20-ws-collect-without-expect.ts` is the other side. */
export type WsCollectNeedsExpect = Assert<Equals<(typeof REQUIRED_VERB_FLAG)['ws-collect'], '--expect'>>;
```

`agent/test/whitelist-structural.test.ts` needs two additions:
- directly after the `'g15-ws-expire-without-expect.ts'` entry of `EXPECTED`:
  ```ts
  // CHILD RECLAMATION wave 7, g13's and g15's shape for the temp-root collector: enrolled on its confirmation token, so
  // the narrowed grant is a compile error.
  'g20-ws-collect-without-expect.ts': {
    what: 'the temp-root collector granted without its confirmation token',
    codes: ['TS2322'],
  },
  ```
- directly before `it('throws on a ws-expire with no confirmation token…`:
  ```ts
  it('throws on a ws-collect with no confirmation token, the fourth destructive verb (child reclamation wave 7)', () => {
    expect(() => auditExecWhitelist(withCcd([['ws-collect']])))
      .toThrow(/only grantable with '--expect'/);
    expect(() => auditExecWhitelist(withCcd([['ws-collect', '--session']])))
      .toThrow(/only grantable with '--expect'/);
    expect(() => auditExecWhitelist(withCcd([['ws-collect', '--expect']]))).not.toThrow();
  });
  ```

`agent/test/ccd-entry-exec.test.ts`: directly before `[['ensure', 'demo-x'], false],`, add:

```ts
      // Child reclamation wave 7: the collector's audit rides the existing `['ws-audit','--session']` grant and the
      // verb its own `['ws-collect','--expect']` — both protected shapes, both through the real exec op.
      [['ws-audit', '--session', 'demo-x', '--collect'], true],
      [['ws-collect', '--expect', 'a'.repeat(64), '--session', 'demo-x'], true],
```

`server/test/whitelist-subset.test.ts` needs two additions; both maps are keyed on `CCD_ARGV` and checked exhaustively:
- `SAMPLES`, directly under `wsExpire: [ … ],` (`:70`):
  ```ts
  // CHILD RECLAMATION wave 7: the collector's audit rides wsAudit's grant; the verb carries a dec, so layer 2 proves
  // the FLAGGED shape crosses its own grant.
  wsCollectAudit: ['demo-quiet-dune'],
  wsCollect: ['a'.repeat(64), 'demo-quiet-dune', { surface: 'agent', actor: 'collect sweep', reason: null }],
  ```
- layer 2c's `EXPECTED`, directly under `    wsExpire: [ … ],` (`:530`):
  ```ts
    wsCollectAudit: ['ws-audit', '--session', 'demo-quiet-dune', '--collect'],
    wsCollect: ['ws-collect', '--expect', 'a'.repeat(64), '--session', 'demo-quiet-dune', '--surface', 'agent', '--actor', 'collect sweep'],
  ```

`server/test/remote-runner.test.ts`: directly under the `ws-expire` row (`:96`), add:

```ts
    // The child temp-root collector: a bounded idle walk, a quarantine move and a tree removal under the reap lock.
    [['ws-collect', '--expect', 'a'.repeat(64), '--session', 'x'], 240_000],
```

`server/test/ccdargv-dec-parity.test.ts` needs three edits:
- Directly under the `'ws-expire'` probe (`:156`), add:
  ```ts
  // Child reclamation, wave 7: the temp-root collector, ws-expire's argv shape. An absent id is outside the collector's
  // population (no witness, no quarantine record), so the real verb takes no lock and answers `not-witnessed` as JSON
  // naming the id — the same witness, and proof the dec was stripped before `--session` bound.
  'ws-collect': {
    argv: (d) => CCD_ARGV.wsCollect('a'.repeat(64), ABSENT, d),
    reached: (c) => { refusedForTheAbsentSession(c); expect(c.out).toContain('"refused":"not-witnessed"'); },
  },
  ```
- Retitle `:227` to `'derives the dec-appending verbs from the table, and finds nine — the five workspace verbs, ws-add, ws-reclaim, ws-expire and ws-collect'`.
- Change `:241` to `.toEqual(['ws-add', 'ws-archive', 'ws-collect', 'ws-expire', 'ws-hold', 'ws-reclaim', 'ws-release', 'ws-rename', 'ws-restore']);`.

- [ ] **Step C2: Run them to see them fail**

```bash
(cd server && ./node_modules/.bin/vitest run test/ws-collect-wiring.test.ts test/whitelist-subset.test.ts test/remote-runner.test.ts test/ccdargv-dec-parity.test.ts)
(cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts test/ccd-entry-exec.test.ts)
```

Expected:
- **`ws-collect-wiring`:**
  - the grant case fails with `exactly one grant, on its token: expected [] to deeply equal [ [ 'ws-collect', '--expect' ] ]`;
  - the audit case and the builder case fail with `TypeError: CCD_ARGV.wsCollectAudit is not a function`;
  - the INERT control and the INERT case PASS: nothing references the builders yet, and `COLLECT_CAP` stands in `ccdargv.ts` alone.
- **`whitelist-subset`:** `has a sample for every CCD_ARGV entry` fails with `expected [ …, 'wsCollect', 'wsCollectAudit', … ] to deeply equal [ … ]`.
- **`remote-runner`:** `sends ["ws-collect",…] with a 240000 ms budget` fails with `expected 90000 to be 240000`.
- **`ccdargv-dec-parity`:** `finds nine` fails with `expected [ …8 ] to deeply equal [ …9 ]`, and `has a probe for every derived verb` passes.
- **`whitelist-structural`:**
  - `g20-ws-collect-without-expect.ts` fails with `the temp-root collector granted without its confirmation token — expected TS2322 from: …: expected [] to deeply equal [ 'TS2322' ]`;
  - `the positive control compiles clean` fails on `WsCollectNeedsExpect`;
  - the throws case fails with `expected [Function] to throw an error`.
- **`ccd-entry-exec`:** the `ws-collect` row fails with `expected { ok: false, … } to match object { ok: true, code: 0 }`.
  - The `ws-audit … --collect` row PASSES, with no agent edit: Part B's launcher already protects it and the existing grant already admits it. That is the proof the audit rides the existing prefix with zero agent change. Record it.

- [ ] **Step C3: Implement**

**`agent/src/whitelist.ts`.** In `REQUIRED_VERB_FLAG`, add a new line directly after the last entry line from (c1):

```ts
  'ws-collect': '--expect',
```

At the end of `EXEC_WHITELIST.ccd`, directly after the last grant from (c2), add:

```ts
    // THE CHILD TEMP-ROOT COLLECTOR (child reclamation spec 2026-09-22 §5.6): the fourth destructive verb, and the third
    // the SERVER sends with no human in the path — on a witnessed child temp root whose workspace is gone. Granted on its
    // confirmation token for ws-reclaim's reason, ENROLLED in `REQUIRED_VERB_FLAG` above (g20), and its audit rides
    // `['ws-audit','--session']`. ccd recomputes the token and compares it inside the reap lock before anything moves.
    ['ws-collect', '--expect'],
```

**`server/src/ccdargv.ts`.** Directly after the `wsExpire` builder (its `argv(['ws-expire', …])` line) and before `wsAttic`, add:

```ts
  /** `ws-audit --collect` (child reclamation, spec 2026-09-22 §5.6): the SAME verb and granted prefix as `wsAudit` —
   *  `['ws-audit','--session']` — with the mode flag after the id, the order `cmd_ws_audit` reads. No grant of its own,
   *  and no `--defer-expired`. Its document carries a witnessed temp root's verdict and, when it is collectable, the
   *  token `ws-collect` spends. */
  wsCollectAudit: (id: string) => argv(['ws-audit', '--session', id, '--collect']),
  /** `ws-collect` — the collector of a witnessed child temp root whose workspace is gone. `token` is
   *  `ws-audit --collect`'s, recomputed and compared by ccd inside the reap lock BEFORE anything moves. The confirmation
   *  token LEADS (`['ws-collect','--expect']` is the grant); the dec trails, and ccd strips it before it binds a
   *  positional. Composed by NOTHING in this build: the collector's lane is its one caller, behind `COLLECT_CAP`, and
   *  `ws-collect-wiring.test.ts` pins that no server source composes it until then. */
  wsCollect: (token: string, id: string, dec: ActorFlags | null) =>
    argv(['ws-collect', '--expect', token, '--session', id, ...decFlags(dec)]),
```

**`server/src/remote/runner.ts`.** Directly after `'ws-expire': 240_000,`, add:

```ts
  // The child temp-root collector (spec 2026-09-22 §5.6): a walk bounded at 60 s, a quarantine move, and the removal of
  // a tree that can hold gigabytes, all under the reap lock. It earns ws-reclaim's budget, not the flat 90 s it would
  // silently inherit without this row. Its audit is `ws-audit` and keeps that verb's row.
  'ws-collect': 240_000,
```

- [ ] **Step C4: Run green, and run the gates**

```bash
(cd server && ./node_modules/.bin/vitest run test/ws-collect-wiring.test.ts test/whitelist-subset.test.ts test/remote-runner.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccdargv-dec-parity.test.ts)
(cd server && ./node_modules/.bin/vitest run test/verb-gate.test.ts test/box-token-census.test.ts test/capsupported.test.ts)
(cd server && ./node_modules/.bin/tsc --noEmit -p .)
(cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts test/whitelist.test.ts test/ccd-entry-exec.test.ts)
(cd agent && ./node_modules/.bin/tsc --noEmit -p .)
```

Expected: every suite green, and `tsc` silent in both packages.
- **`ccdargv-dec-parity`'s `ws-collect` row** runs the REAL verb under `bash -p` in its fixture HOME. Both arms answer the identical `not-witnessed` refusal naming `__no-such-session__`.
- **`verb-gate`** needs no edit, because no call site composes `ws-collect`. Its `CAP_GATED_VERBS` entry is the collector lane's to add.
- **`box-token-census`** needs no edit, because this task adds no route.
- **The audit's budget** is unchanged: the runner keys on argv[0], so `ws-audit --collect` keeps `ws-audit`'s 90 s row. Task 5 measures the audit's worst case; a mode-keyed budget, if one is needed, is wave 9's (ruling G9).

- [ ] **Step C5: Mutation check**

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| C1 | In `REQUIRED_VERB_FLAG`, delete `'ws-collect': '--expect',` | `(cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts)` | `g20-…: the temp-root collector granted without its confirmation token — expected TS2322 …: expected [] to deeply equal [ 'TS2322' ]`; `the positive control compiles clean` red; the throws case `expected [Function] to throw an error`. Server `ws-collect-wiring`: `expected undefined to be '--expect'` |
| C2 | Narrow the grant to `['ws-collect'],`, enrolment kept | `(cd server && ./node_modules/.bin/vitest run test/ws-collect-wiring.test.ts)` | The suite fails to load: the agent module's load-time audit throws `… only grantable with '--expect' …`. `agent tsc` reports TS2322 on the `LAWFUL_EXEC_WHITELIST` line |
| C3 | Delete the `['ws-collect', '--expect'],` grant | same, then `(cd agent && ./node_modules/.bin/vitest run test/ccd-entry-exec.test.ts)` | `exactly one grant, on its token: expected [] to deeply equal [ [ 'ws-collect', '--expect' ] ]`; entry-exec: `expected { ok: false, … } to match object { ok: true, code: 0 }` on the ws-collect row |
| C4 | Add `['ws-audit'],` to the ccd block | `(cd server && ./node_modules/.bin/vitest run test/ws-collect-wiring.test.ts)` | `expected [ [ 'ws-audit', '--session' ], [ 'ws-audit' ] ] to deeply equal [ [ 'ws-audit', '--session' ] ]` |
| C5 | In `wsCollect`, swap to `argv(['ws-collect', '--session', id, '--expect', token, ...decFlags(dec)])` | same | `expected [ 'ws-collect', '--session', … ] to deeply equal [ 'ws-collect', '--expect', … ]`, and the grant case `expected false to be true` |
| C6 | In `wsCollect`, delete `, ...decFlags(dec)` | `(cd server && ./node_modules/.bin/vitest run test/ccdargv-dec-parity.test.ts test/whitelist-subset.test.ts)` | `expected [ …8 ] to deeply equal [ …9 ]`; whitelist-subset `wsCollect builds the exact argv`: the dec flags missing |
| C7 | Delete the runner row `'ws-collect': 240_000,` | `(cd server && ./node_modules/.bin/vitest run test/remote-runner.test.ts)` | `expected 90000 to be 240000`. The INERT case also reds: `expected [ 'ccdargv.ts' ] to deeply equal [ 'ccdargv.ts', 'remote/runner.ts' ]` |
| C8 | Append to `server/src/coord/expireArchived.ts`: `export const collectProbe = (): unknown => CCD_ARGV.wsCollect('a'.repeat(64), 'x', null);` | `(cd server && ./node_modules/.bin/vitest run test/ws-collect-wiring.test.ts)` | `a reference to either builder: expected [ 'ccdargv.ts', 'coord/expireArchived.ts' ] to deeply equal [ 'ccdargv.ts' ]` |
| C9 | In `server/src/coord/expireArchived.ts`, add `COLLECT_CAP` to its `../ccdargv.js` import and append `export const collectCapProbe = COLLECT_CAP;` | same | `the capability token: declared, read by nothing: expected [ 'ccdargv.ts', 'coord/expireArchived.ts' ] to deeply equal [ 'ccdargv.ts' ]` |

Revert each mutation and re-run Step C4's commands green.

- [ ] **Step C6: Commit**

```bash
git add agent/src/whitelist.ts agent/test/types/bypasses/g20-ws-collect-without-expect.ts \
  agent/test/types/ok/legit-whitelist.ts agent/test/whitelist-structural.test.ts agent/test/ccd-entry-exec.test.ts \
  server/src/ccdargv.ts server/src/remote/runner.ts server/test/ws-collect-wiring.test.ts \
  server/test/whitelist-subset.test.ts server/test/remote-runner.test.ts server/test/ccdargv-dec-parity.test.ts
git commit -m "$(cat <<'MSG'
feat(server,agent): what lets the server compose ws-collect — and no caller

The agent grant ['ws-collect','--expect'], enrolled in REQUIRED_VERB_FLAG
so a bare grant is a TS2322 and a boot refusal (g20); ws-audit --collect
rides ['ws-audit','--session'] with no agent change, proven through the
real exec op. CCD_ARGV.wsCollectAudit and wsCollect, and the 240 s budget.
Nothing calls the builders: the collector's lane is their one caller,
behind capSupported(COLLECT_CAP), and a scan of server/src pins that no
source composes the verb, its mode flag or its token until then.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: The SAFETY race and crash suite: a recycled slug, a SIGKILL, a forgery, a swap and a substrate fault at every step of `ws-collect`

**Model routing:** **`opus`, effort `high`**. This suite is the SAFETY panel's evidence for R67 and R68. Each case forces one interleaving the recycled-slug proof argues about, then reads what stands on disk. A case that passes for the wrong reason is a hole in that proof, so the implementer needs judgment, not transcription.

**Why:**
- **What R67 claims.** No spawn under a recycled slug can lose its leaf. The proof (contract §14, R67 "Why it holds"):
  - every hand-out of `~/.cc-tmp/<id>` goes through `_child_tmpdir`, which has one call site and needs `.child`;
  - a spawn before the move is seen by step 5's direct lookup, and the leaf goes back;
  - a spawn after the move gets a new inode from `mkdir -p`;
  - step 6 removes only the slot's inode, dev:ino-checked.

  R66 adds the order that makes a crash survivable: record, slot, move, re-proofs, removal, rmdir, witness, record LAST. Tasks 4, 5 and 6 build all of this. This task proves it by forcing each interleaving at the exact step boundary.
- **The cases.**
  - A recycled-slug spawn (`.child` plus `_child_tmpdir`) at each boundary: before step 1, between steps 1 and 2, between steps 2 and 4, between steps 4 and 5, between steps 5 and 6, and after step 6. The `.child`-before-the-move, `mkdir -p`-after-it split is a case of its own.
  - A straggler that re-creates the leaf after the move.
  - A SIGKILL after each of R66's eight steps, with the next audit and verb run to quiescence.
  - A witness that is rewritten, dropped, or deleted while a record stands.
  - A forged slot leaf, a forged id, a malformed record, and a slot with no record. (There is no slot PATH to forge: the record carries no `slot=`, ruling G5.)
  - A file and a link swapped in at the id between the lstat and the move.
  - EXDEV, and a `mv` with no `--no-copy`.
  - A mount point at or under the slot's leaf, through the mountinfo seam.
  - A nested id, for both records and witness temp files.
  - A registry at 0300.
  - A `cdk.out` project.
  - The measured recycled-admin-name case through the full verb.
- **The three scan pins** R67 requires: one TMPDIR composer, one `.child` writer, and the marker read placed before the `mkdir`. R67 says "Task 0 pins three facts by scan". This plan's Task 0 is the coordinator's entry-condition task, so the pins live here instead. That is the departure `scan-pins-in-task-8`. Each pin was measured red under its mutation against `b0647d850`'s `ccd/ccd` while this task was drafted.
- **How an interleaving is forced.** `_ws_collect_gap <point> <id>` is a no-op on the box, which the verb calls at each named step boundary. The precedent is `_ws_expire_return_gap` (`ccd/ccd:31241`; `grep -n '^_ws_expire_return_gap() { :; }' ccd/ccd`), forced by `server/test/ccd-ws-expire-return-race.test.ts:33` (`grep -n 'const GAP = ' server/test/ccd-ws-expire-return-race.test.ts`). A case redefines the seam:
  - to run an injection in a subshell (`gapAt`);
  - to photograph the disk (`SNAPSHOT_GAP`);
  - or to SIGKILL every shell from the seam up to the top `bash -c` (`crashAt`). This was measured to stop the verb dead, even with nested subshells in between.

  The seam is Task 6's code, and so is `_ws_collect_mountinfo` (ruling G7). This task adds no `ccd/ccd` line, and its entry conditions stop it when either seam is missing.
- **What is asserted:** what stands on disk, by inode. That means the new child's leaf, the kept slot, the record, the witness, and a decoy. It is never the verb's word alone. The words are the coordinator's rulings (T8 OPEN4 and OPEN5, applied in Task 6). A spawn at the `locked` boundary answers `registered`. A file or link swapped in answers `witness-mismatch` before the move, and `quarantine-kept` once it reached a slot; the cases here swap at `slotted`, so it reaches one. A mount point at or under the slot's leaf answers `failed` `probe-unmeasured` after a proven restore. A record whose original path is retaken is `quarantine-kept`: terminal for the verb, kept for the operator, and answered on every audit. The disk assertion still carries each mutation's red.
- **Where it runs.** Linux only, and only where `mv` has `--no-copy` (R68). A runner without it would skip silently, so a CONTROL case reds on any Linux runner that lacks it. Cases that need an unlistable registry skip under uid 0.
- **R56.** Every case is in a new file. Each file is sized to finish well under 500 s alone (estimates: the pins about 3 s, the crash file about 200 s, each other file under 150 s). Step 11 measures this.

**Files:**
- Create: `server/test/collectRaceFixture.ts`, the shared fixture.
- Create: `server/test/ccd-collect-race-spawn.test.ts`: the recycled spawn at each boundary, the straggler, and the order trace.
- Create: `server/test/ccd-collect-race-crash.test.ts`: a SIGKILL after each step, and the witness rewritten, dropped and deleted.
- Create: `server/test/ccd-collect-race-forge.test.ts`: forged record and slot, and the file and link swaps.
- Create: `server/test/ccd-collect-race-substrate.test.ts`: EXDEV, no `--no-copy`, and mountinfo.
- Create: `server/test/ccd-collect-race-ids.test.ts`: the nested id, the 0300 registry, and `cdk.out`.
- Create: `server/test/ccd-collect-race-admin.test.ts`: the recycled admin name through the full verb.
- Create: `server/test/ccd-collect-recycle-pins.test.ts`: R67's three scan pins.
- No `ccd/ccd` edit. The seams this suite drives are Task 6's (ruling G7), in the COLLECT region Task 4 opened.
- Test, as regressions: `server/test/ccd-child-tmpdir.test.ts`, `ccd-child-tmproot-witness.test.ts`, `ccd-leaf-remove.test.ts`, `ccd-leaf-checkouts.test.ts`, `typecheck-tests.test.ts`.

**Interfaces:**
- Consumes, from Tasks 4, 5, 6 and 7, by the shared names (an interface that differs is a stop, never a silent rename):
  ```bash
  cmd_ws_collect --expect <token> --session <id>    # stdout ONE JSON line: {"collected":"<id>",…} | {"refused":"<word>",…} exit 0 | {"failed":"<word>",…} exit 1
  cmd_ws_audit --session <id> --collect             # one JSON document: "verdict" always, "token" exactly when the verb may be composed (fresh or resume); exit 1 on "unmeasured"
  _ws_collect_records_of <id>                       # the record paths of exactly <id>, one per line (exact parse)
  _ws_collect_rows_clear <id> <leafpath>            # 0 clear | 1 a row at/inside/through (_WS_COLLECT_ROWS_WHY) | 2 unmeasured — stubbed by one case
  _ws_path_users <path>                             # wave 6's probe: 0 nobody — stubbed "nobody" throughout (its own suite measures it)
  _ws_slug_free <project> <slug>                    # ccd/ccd:6526 — stubbed BLIND by one case
  _child_tmpdir <id>                                # ccd/ccd:20733 — the one composer, called by the fixture as a spawn calls it
  _ws_tmproot_remove <id> / _ws_tmproot_witness_drop <id>   # ccd/ccd:29440 / :29460 — a recycled child's own tail
  ```
  - The paths are: records `$REG/tmpquarantine/<id>.<ns>.<pid>`; Q `<physical ~/.cc-tmp>/.ccd-quarantine`; slot `Q/slot.<id>.<ns>.<pid>`; the moved leaf `<slot>/leaf`; the witness `$REG/tmproots/<id>`. The record body carries no path: its slot is DERIVED from the record's file NAME and the physical quarantine directory (ruling G5).
  - The words are `registered`, `quarantine-kept`, `witness-mismatch`, `state-changed`, `not-witnessed` and `probe-unmeasured`, and the journal act is `collect`. Tasks 5 and 6 declared the words (`witness-mismatch` and `quarantine-kept` Task 5, `not-witnessed` and `registered` Task 6, ruling G2); Task 4 declared the act (ruling G1).
- Consumes these seams, both Task 6's code (ruling G7):
  ```bash
  _ws_collect_gap <point> <id> [<slot>]   # no-op on the box (`_ws_collect_gap() { :; }`), defined once, called in the verb's OWN shell (never inside $( ) or a pipeline) at:
                                   #   locked      lock held, before the pause check and the fork's evaluation (step 1)
                                   #   consented   the fork answered collectable and its token matched --expect, before any quarantine or record work
                                   #   recorded    _ws_collect_record_write answered 0, before _ws_collect_slot_make
                                   #   slotted     the slot made, directly before _ws_collect_move
                                   #   moved       the move PROVEN (_ws_collect_move answered 0; there is no line between the rename and its proof), before step 5; also on a resume whose slot leaf matches its record
                                   #   proven      step 5's last re-proof passed, before step 6's _ws_leaf_remove
                                   #   removed     step 6 answered 0 (the slot's leaf proven absent), before the rmdir
                                   #   emptied     the empty slot rmdir'd, before the witness compare-and-drop
                                   #   witnessed   the witness compared-and-dropped, before the record drop
                                   #   dropped     the record dropped, before the done journal line and stdout
                                   #   (Task 6 also calls `restoring` before a move back; no case here names it)
  _ws_collect_mountinfo            # PRINTS THE PATH of the mount table step 5 reads (/proc/self/mountinfo on the box); _ws_collect_mounts_clear opens that path, and a path it cannot open is unmeasured; step 5 reads the table through this function only
  ```
  - **The floor seam (ruling G4).** `_ws_collect_floor_s` is Task 4's one floor definition: it prints max(86400, `WS_COLLECT_IDLE_FLOOR_S`). A test lowers the floor ONLY by redefining that function in its sourced harness, never through the knob, which only raises it. It is spelled once, as `FLOOR0` in `collectRaceFixture.ts`.
- **What these cases assume of Tasks 4, 5 and 6.** Each item is some case's expectation. If one reds, either those tasks have a defect or this plan misread them. Stop and report which, with the case and its output. Never loosen the case.
  - (a) A PROVEN restore empties custody: the slot is rmdir'd and the record dropped. The verb then answers the word of the doubt that caused the restore: `registered` for a row or `.child`, or `failed` `probe-unmeasured` for an unmeasured answer, a mount point at or under the slot's leaf included (rulings T8 OPEN5, T6 OPEN8).
  - (b) A restore that is NOT proven keeps the record and the slot. Where the original path is RETAKEN (something stands there), or a slot holds anything that is not the witnessed leaf, the verb answers `refused` `quarantine-kept` at exit 0: terminal, kept for the operator, answered on every audit (rulings T8 OPEN4 and OPEN5). Any other unproven restore (an `mv` that claims a move and does not make it, a restore landing elsewhere) answers `failed` `quarantine-kept` at exit 1 (ruling T6 OPEN7); no case here forces that shape.
  - (c) A move that never happened leaves the leaf at the id with the record's inode and the slot empty. It is undone like (a): rmdir the slot, drop the record. On a RESUME whose move never happened, the verb then answers `refused` `state-changed`, the witness kept (ruling T6 OPEN10), and the next audit judges the leaf afresh.
  - (d) The audit answers a kept or malformed record before it judges the id's leaf. `quarantine-kept` is journaled as `collect` `refused` with verb `ws-audit`. A record whose original path is retaken answers `quarantine-kept` on every audit while that path stands (ruling T8 OPEN4). These cases read it state-based: once the recycled child's own tail has removed its leaf, the record resumes, as (i) says.
  - (e) `_ws_collect_record_read` answers rc 2 when the record's `id=` differs from its file name's id (ruling G5; Task 4's mutation A6 pins it). The record carries no `slot=`: its slot is derived from the record's NAME and the physical quarantine directory. Every path is taken from the record's NAME, never its body: the witness's own trust rule.
  - (f) A record and its slot share one `<ns>.<pid>` suffix.
  - (g) The `--no-copy` check is Task 4's `_ws_collect_mv_ok`: it asks `mv` for the option (its `--help`), not for its version. It runs at the audit and inside the lock before the record is written. The leaf's move and the restore are both Task 4's `_ws_collect_move`, through the ONE exempted rename function `_ws_collect_mv` (ruling G3). It and the check call `mv` by name, so a shim on PATH meets them.
  - (h) The witness writer's stale temp files are reaped during a collection of their own id.
  - (i) While a recycled child holds the slug, no audit offers a token for its record. Once the child's own tail has removed its leaf and dropped the witness, the record resumes.
  - (j) A resume never compares a tree token recomputed over the slot's leaf (the move re-stamps its ctime).
- Produces: `server/test/collectRaceFixture.ts`, for these suites and for any later ccd-side collector case:
  ```ts
  export const LINUX: boolean; export const NO_COPY: boolean; export const ROOT_USER: boolean;
  export const COL_ID = 'demo-calm-mesa'; export const DEAD_RUN = '7'; export const G2_RUN = '9'; export const TOKEN: RegExp;
  export const POINTS: readonly ['locked','consented','recorded','slotted','moved','proven','removed','emptied','witnessed','dropped']; export type Point;
  export const FLOOR0: string; export const NOBODY: string; export const COLLECT_STUBS: string;
  export function orphanLeaf(h: PrHarness, id?: string): Orphan;            // a witnessed orphan: { id, leaf, devino }
  export const g2Row: (id?: string) => string; export const g2Spawn: (id?: string, scratch?: string) => string; export function g2Departs(h: PrHarness, id?: string): void;
  export const gapAt: (acts: Partial<Record<Point, string>>) => string; export const crashAt: (point: Point) => string; export const SNAPSHOT_GAP: string;
  export const collectAudit: (h: PrHarness, id?: string, pre?: string) => Run;   // { code, stdout, stderr }
  export const collectVerb: (h: PrHarness, token: string, id?: string, pre?: string) => Run;
  export function tokenOf(h: PrHarness, id?: string, pre?: string): string;      // asserts the audit minted one
  export function settle(h: PrHarness, id?: string, pre?: string, max?: number): Round[];   // audit, spend, again, until no token
  export const docOf: (stdout: string) => Record<string, unknown>; export const factsOf: (h: PrHarness, id?: string) => Array<[string, string]>;
  export const recordsOf: (h: PrHarness, id?: string) => string[]; export const slotsOf: (h: PrHarness, id?: string) => string[];
  export const custodyHolds: (h: PrHarness, id?: string, except?: readonly string[]) => void;
  export const devinoOf: (p: string) => string | null; export const witnessField: (h: PrHarness, key: string, id?: string) => string | null;
  ```

**Entry conditions, checked before Step 1 from the repository root.** Tasks 4, 5, 6 and 7 have landed on this branch. Every line number below is at `b0647d850`, and is a hint: locate by the grep.
- `grep -c '^cmd_ws_collect() {' ccd/ccd` prints `1`.
- `grep -c '^_ws_collect_records_of() {\|^_ws_collect_record_read() {\|^_ws_collect_rows_clear() {' ccd/ccd` prints `3`.
- `grep -c 'tmpquarantine' ccd/ccd` and `grep -c '\.ccd-quarantine' ccd/ccd` each print at least `1`.
- `grep -c "'quarantine-kept'\|'not-witnessed'\|'witness-mismatch'" shared/api.ts` prints at least `3` (Tasks 5 and 6 declared the words; Task 4 declared the act, ruling G1).
- `mv --help | grep -c -- --no-copy` prints at least `1` on this box (coreutils 9.2 or later). If it does not, stop: every case here would skip.
- Task 6's seams (ruling G7) and Task 4's one floor function (ruling G4). If any of these prints `0`, stop and report: this task adds no `ccd/ccd` line.
  - `grep -c '^_ws_collect_gap() { :; }' ccd/ccd` prints `1`;
  - `grep -c '^_ws_collect_mountinfo() {' ccd/ccd` prints `1`;
  - `grep -c '_ws_collect_gap proven ' ccd/ccd` and `grep -c '_ws_collect_gap dropped ' ccd/ccd` each print at least `1` (the two points Task 6 adds for this suite);
  - `grep -c '^_ws_collect_floor_s() {' ccd/ccd` prints `1` (the function `FLOOR0` redefines).
- The premises the pins scan, still at their `b0647d850` homes:
  - `grep -nF 'ctmp=$(_child_tmpdir "$id") && tmpenv=' ccd/ccd` prints one hit (`ccd/ccd:21221`);
  - `grep -nF '_reg_set "$id" child "$lc_child"' ccd/ccd` prints one hit (`ccd/ccd:7366`);
  - `grep -nF 'run=$(_reg_get "$id" child)' ccd/ccd` (`ccd/ccd:20735`) precedes `grep -nF 'mkdir -p -m 0700 -- "$root" "$dir"' ccd/ccd` (`ccd/ccd:20738`).

- [ ] **Step 1: Write the shared fixture**

It holds the seams' redefinitions, the orphan, the recycled spawn, and the run-to-quiescence loop. Every pattern in it is anchored at the fixture HOME: a worker's own TMPDIR may lie under a `.cc-tmp`, so nothing may match `*/.cc-tmp/*` loosely.

Create `server/test/collectRaceFixture.ts`:

```ts
// The collector's race and crash suites — their shared fixture (child-workspace reclamation wave 7, spec 2026-09-22
// §5.6). `ws-collect` takes an ORPHANED temp root — a leaf `_child_tmpdir` handed to a child that is gone, still named
// by its witness — by moving it into a quarantine slot under the reap lock, re-proving that nothing has handed the slug
// out again, and only then removing the slot's leaf. These suites force every interleaving the design argues about, at
// the exact step boundary, and assert what stands on disk afterwards — never the verb's word alone.
//
// THE INTERLEAVING IS FORCED, NOT HOPED FOR. `_ws_collect_gap <point> <id>` is the seam the verb calls at each step
// boundary, a no-op on the box (`_ws_expire_return_gap`'s precedent, `ccd-ws-expire-return-race.test.ts`). A case
// redefines it to run a recycled spawn, a straggler, a swap or a SIGKILL at one named point.
//
// FIXTURE HOME ONLY. Every leaf, slot, record, witness and registry row lives under the harness's HOME
// (`makePrHarness`), and every path a shim or a gap matches is anchored THERE: a worker's own TMPDIR may itself lie
// under some `.cc-tmp`, so no pattern here may match `*/.cc-tmp/*` loosely.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
import type { PrHarness } from './ccdPrHelpers.js';

export const LINUX = process.platform === 'linux';
/** Spec §5.6: the collector runs only where `mv` has `--no-copy`; anywhere else every collection answers unmeasured,
 *  so a race case there would measure nothing. Measured, never assumed. */
export const NO_COPY: boolean = (() => {
  try { return execFileSync('mv', ['--help'], { encoding: 'utf8' }).includes('--no-copy'); } catch { return false; }
})();
export const ROOT_USER = process.getuid?.() === 0;

export const COL_ID = 'demo-calm-mesa';
export const DEAD_RUN = '7';
export const G2_RUN = '9';
export const G2_UUID = '9e2e2e2e-0000-4000-8000-000000000009';
export const TOKEN = /^[0-9a-f]{64}$/;

/** The verb's step boundaries, in the order a fresh collection passes them (spec §5.6's quarantine order), spelled as
 *  Task 6 calls `_ws_collect_gap`: `locked` lock held, before the evaluation · `consented` the token matched ·
 *  `recorded` the record written · `slotted` the slot made, before the move · `moved` the move PROVEN ·
 *  `proven` step 5's re-proofs passed · `removed` the slot's leaf proven absent · `emptied` the slot rmdir'd ·
 *  `witnessed` the witness compared-and-dropped · `dropped` the record dropped, before the verb answers. Task 6's
 *  `restoring` (before a move back) is no fresh collection's, so it is not listed. */
export const POINTS = ['locked', 'consented', 'recorded', 'slotted', 'moved', 'proven', 'removed', 'emptied',
  'witnessed', 'dropped'] as const;
export type Point = (typeof POINTS)[number];

/** The idle floor at 0 s, so every leaf a case makes is past it at once. Ruling G4: `_ws_collect_floor_s` is the ONE
 *  floor definition, and redefining it in the sourced harness is the only test seam that lowers it, never the
 *  `WS_COLLECT_IDLE_FLOOR_S` knob, which only raises it. The one spelling of that seam in these suites. */
export const FLOOR0 = '_ws_collect_floor_s() { echo 0; };';
/** Nobody uses any leaf here: the in-use probe answers "nobody" without walking /proc (its own suite measures it). */
export const NOBODY = "_ws_path_users() { _WS_PATH_USERS_PIDS=''; _WS_PATH_USERS_WHY=''; return 0; };";
export const COLLECT_STUBS = `${FLOOR0} ${NOBODY}`;

export const regOf = (h: PrHarness): string => path.join(h.home, '.cc-sessions');
export const tmpRootOf = (h: PrHarness): string => path.join(h.home, '.cc-tmp');
export const leafOf = (h: PrHarness, id = COL_ID): string => path.join(tmpRootOf(h), id);
export const quarantineOf = (h: PrHarness): string => path.join(tmpRootOf(h), '.ccd-quarantine');
export const recordDirOf = (h: PrHarness): string => path.join(regOf(h), 'tmpquarantine');
export const witnessOf = (h: PrHarness, id = COL_ID): string => path.join(regOf(h), 'tmproots', id);

/** `dev:ino` of the path ITSELF (a link is not followed), or null when nothing stands there. */
export const devinoOf = (p: string): string | null => {
  try { const s = fs.lstatSync(p, { bigint: true }); return `${s.dev}:${s.ino}`; } catch { return null; }
};

const SUFFIX = /^(.+)\.([0-9]+)\.([0-9]+)$/;
/** The record files of EXACTLY `id`: the name with its two trailing all-digit dot-fields stripped equals `id`. Never an
 *  `<id>.*` prefix match — ids admit dots, so `p-calm-mesa.v2-quiet-river.<ns>.<pid>` is not `p-calm-mesa`'s. */
export const recordsOf = (h: PrHarness, id = COL_ID): string[] => {
  const d = recordDirOf(h);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((n) => SUFFIX.exec(n)?.[1] === id).sort();
};
/** The slots of exactly `id` (`slot.<id>.<ns>.<pid>`), parsed the same way. */
export const slotsOf = (h: PrHarness, id = COL_ID): string[] => {
  const q = quarantineOf(h);
  if (!fs.existsSync(q)) return [];
  return fs.readdirSync(q).filter((n) => n.startsWith('slot.') && SUFFIX.exec(n.slice('slot.'.length))?.[1] === id).sort();
};
/** NO SLOT IS EVER ORPHANED (spec §5.6): every slot of `id` is named by a standing record of `id`, `slot.<x>` by
 *  `<x>`. `except` names a planted decoy that no record is meant to name. */
export const custodyHolds = (h: PrHarness, id = COL_ID, except: readonly string[] = []): void => {
  const recs = new Set(recordsOf(h, id));
  for (const s of slotsOf(h, id).filter((x) => !except.includes(x))) {
    expect(recs.has(s.slice('slot.'.length)), `${s} is named by a standing record`).toBe(true);
  }
};
/** One field of the witness line (` <key>=<value>`), or null. */
export const witnessField = (h: PrHarness, key: string, id = COL_ID): string | null => {
  try {
    return new RegExp(` ${key}=(\\S+)`).exec(fs.readFileSync(witnessOf(h, id), 'utf8'))?.[1] ?? null;
  } catch { return null; }
};

export interface Orphan { id: string; leaf: string; devino: string }
/** A WITNESSED ORPHAN, the collector's whole population: a child minted for run 7 asked `_child_tmpdir` for its temp
 *  root (which wrote the witness), left scratch in it, and is gone — its marker removed, the leaf and the witness left
 *  behind, as a tail that KEPT the leaf leaves them (spec §5.6). */
export function orphanLeaf(h: PrHarness, id = COL_ID): Orphan {
  const leaf = h.sh(`_reg_set ${id} child ${DEAD_RUN} && d=$(_child_tmpdir ${id}) && mkdir -p "$d/scratch" "$d/cdk.out"`
    + ` && printf 'old work\\n' > "$d/scratch/a.txt" && printf '{}' > "$d/cdk.out/manifest.json" && printf '%s' "$d"`);
  fs.rmSync(path.join(regOf(h), `${id}.child`));
  expect(leaf, 'the CONTROL: _child_tmpdir handed out the id-derived leaf').toBe(leafOf(h, id));
  expect(witnessField(h, 'run', id), 'the CONTROL: and witnessed it for the dead run').toBe(DEAD_RUN);
  const devino = devinoOf(leaf);
  expect(devino, 'the CONTROL: the leaf stands').not.toBeNull();
  return { id, leaf, devino: devino! };
}

/** A RECYCLED-SLUG SPAWN's registry half, as `ws-add` writes it: the row, then the `.child` marker (its one writer). */
export const g2Row = (id = COL_ID): string =>
  `mkdir -p "$HOME/worktrees/g2-${id}" && _reg_set ${id} uuid ${G2_UUID} && _reg_set ${id} project demo`
  + ` && _reg_set ${id} workdir "$HOME/worktrees/g2-${id}" && _reg_set ${id} child ${G2_RUN}`;
/** Its spawn half: `_child_tmpdir`, the one composer — `mkdir -p`, so it ADOPTS a directory standing at the id and makes
 *  a new one otherwise, and it rewrites the witness for its own run — then the new child's first scratch file (none
 *  when `scratch` is ''). The path it was handed is left in `$HOME/g2-dir`. */
export const g2Spawn = (id = COL_ID, scratch = 'g2.txt'): string =>
  `d=$(_child_tmpdir ${id}) && printf '%s' "$d" > "$HOME/g2-dir"`
  + (scratch === '' ? '' : ` && printf 'g2 scratch\\n' > "$d/${scratch}"`);
/** The recycled child LEAVES, as its own reclaim leaves: its tail removes its temp root and drops the witness
 *  (`_ws_tmproot_remove`, wave 6), and its row goes. */
export function g2Departs(h: PrHarness, id = COL_ID): void {
  h.sh(`_ws_tmproot_remove ${id} >/dev/null 2>&1; :`);
  for (const f of ['uuid', 'project', 'workdir', 'child']) fs.rmSync(path.join(regOf(h), `${id}.${f}`), { force: true });
  expect(fs.existsSync(leafOf(h, id)), 'the CONTROL: its own tail removed its leaf').toBe(false);
}

const linesOf = (p: string): string[] => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : []);
/** `_ws_collect_gap`, redefined: every point the verb passes is appended to `$HOME/gaps`, and a point named in `acts`
 *  runs its snippet in a SUBSHELL — nothing it sets leaks into the verb's own variables — and a snippet that fails is
 *  recorded in `$HOME/gap-errors`, so a case can prove its injection ran. */
export const gapAt = (acts: Partial<Record<Point, string>>): string => {
  const arms = Object.entries(acts)
    .map(([p, s]) => `${p}) ( ${s} ) || echo "${p}" >> "$HOME/gap-errors" ;;`).join(' ');
  return `_ws_collect_gap() { echo "$1" >> "$HOME/gaps"; case "$1" in ${arms} esac; };`;
};
export const gapsOf = (h: PrHarness): string[] => linesOf(path.join(h.home, 'gaps'));
export const gapErrorsOf = (h: PrHarness): string[] => linesOf(path.join(h.home, 'gap-errors'));

/** `_ws_collect_gap`, redefined to DIE at `point`: SIGKILL to every shell from this one up to the top `bash -c`,
 *  ancestors first and itself last, so no shell between them returns into the verb and carries on. A kill, not an exit:
 *  no trap runs, nothing is cleaned up. `$HOME/crashed-at` says it fired. Linux (`/proc/<pid>/stat`). */
export const crashAt = (point: Point): string =>
  `_ws_collect_gap() { echo "$1" >> "$HOME/gaps"; [[ "$1" == ${point} ]] || return 0;`
  + ' printf \'%s\' "$1" > "$HOME/crashed-at"; local p=$BASHPID pp; local -a chain=();'
  + ' while [[ "$p" != "$$" ]]; do chain=("$p" ${chain[@]+"${chain[@]}"});'
  + ' read -r _ _ _ pp _ < "/proc/$p/stat" || break; p=$pp; done;'
  + ' kill -KILL "$$" ${chain[@]+"${chain[@]}"}; };';
export const crashedAt = (h: PrHarness): string => {
  try { return fs.readFileSync(path.join(h.home, 'crashed-at'), 'utf8'); } catch { return ''; }
};

/** `_ws_collect_gap`, redefined to photograph the disk at every point: the HOME's `.cc-tmp`, `tmproots/` and
 *  `tmpquarantine/`, three levels deep, sorted, under a `== <point>` header in `$HOME/facts`. */
export const SNAPSHOT_GAP = '_ws_collect_gap() { { echo "== $1"; ( cd "$HOME" && find .cc-tmp .cc-sessions/tmproots'
  + ' .cc-sessions/tmpquarantine -mindepth 1 -maxdepth 3 2>/dev/null | LC_ALL=C sort ); } >> "$HOME/facts"; };';
/** Each photographed point as five flags: the leaf at the id · a record · a slot · the slot's leaf · the witness. */
export const factsOf = (h: PrHarness, id = COL_ID): Array<[string, string]> => {
  const f = path.join(h.home, 'facts');
  const raw = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const e = id.replace(/[.]/g, '\\.');
  const res = [
    new RegExp(`^\\.cc-tmp/${e}$`),
    new RegExp(`^\\.cc-sessions/tmpquarantine/${e}\\.[0-9]+\\.[0-9]+$`),
    new RegExp(`^\\.cc-tmp/\\.ccd-quarantine/slot\\.${e}\\.[0-9]+\\.[0-9]+$`),
    new RegExp(`^\\.cc-tmp/\\.ccd-quarantine/slot\\.${e}\\.[0-9]+\\.[0-9]+/leaf$`),
    new RegExp(`^\\.cc-sessions/tmproots/${e}$`),
  ];
  return raw.split(/^== /m).filter(Boolean).map((block): [string, string] => {
    const [point = '', ...entries] = block.split('\n').filter(Boolean);
    return [point, res.map((re) => (entries.some((x) => re.test(x)) ? '1' : '0')).join('')];
  });
};

export interface Run { code: number; stdout: string; stderr: string }
/** The ONE JSON line a verb or an audit prints (its last line), or `{}` when it printed none. */
export const docOf = (stdout: string): Record<string, unknown> => {
  const line = stdout.trim().split('\n').filter(Boolean).pop();
  if (line === undefined) return {};
  try { return JSON.parse(line) as Record<string, unknown>; } catch { return { unparsed: stdout }; }
};
/** `ccd ws-audit --session <id> --collect` through the sourced function, answering instead of throwing. */
export const collectAudit = (h: PrHarness, id = COL_ID, pre = ''): Run =>
  h.run(`${COLLECT_STUBS} ${pre} cmd_ws_audit --session ${id} --collect`);
/** `ccd ws-collect --expect <token> --session <id>` through the sourced function, answering instead of throwing. */
export const collectVerb = (h: PrHarness, token: string, id = COL_ID, pre = ''): Run =>
  h.run(`${COLLECT_STUBS} ${pre} cmd_ws_collect --expect ${token} --session ${id}`);
/** The token the audit mints now — asserted to BE one, so a case never spends an empty string by accident. */
export function tokenOf(h: PrHarness, id = COL_ID, pre = ''): string {
  const r = collectAudit(h, id, pre);
  const t = String(docOf(r.stdout)['token'] ?? '');
  expect(r.code, `the CONTROL: the audit answered: ${r.stdout}${r.stderr}`).toBe(0);
  expect(t, `the CONTROL: the audit minted a token: ${r.stdout}`).toMatch(TOKEN);
  return t;
}

export interface Round { audit: Run; doc: Record<string, unknown>; verb?: Run; answer?: Record<string, unknown> }
/** "The next audit and verb", run to quiescence: audit, spend the token it offers, again — at most `max` rounds,
 *  stopping at the first audit that offers none. Every round is returned, for the case to read. */
export function settle(h: PrHarness, id = COL_ID, pre = '', max = 4): Round[] {
  const rounds: Round[] = [];
  for (let i = 0; i < max; i += 1) {
    const audit = collectAudit(h, id, pre);
    const doc = docOf(audit.stdout);
    const round: Round = { audit, doc };
    rounds.push(round);
    const t = doc['token'];
    if (audit.code !== 0 || typeof t !== 'string' || !TOKEN.test(t)) break;
    round.verb = collectVerb(h, t, id, pre);
    round.answer = docOf(round.verb.stdout);
  }
  return rounds;
}
export const verdictOf = (r: Round | undefined): string => String(r?.doc['verdict']);
export const lastVerdict = (rounds: readonly Round[]): string => verdictOf(rounds[rounds.length - 1]);
export const shownRounds = (rounds: readonly Round[]): string => JSON.stringify(rounds.map((x) => [x.doc, x.answer ?? null]));
```

- [ ] **Step 2: Write the recycled-spawn suite**

Its first case is the anchor for every other file. It photographs the disk at all ten points of a fresh collection, which pins the spec's quarantine order and the seam's placement together.

Create `server/test/ccd-collect-race-spawn.test.ts`:

```ts
// THE RECYCLED SLUG, FORCED AT EVERY STEP BOUNDARY (child-workspace reclamation wave 7, spec 2026-09-22 §5.6).
// The collector's argument: every hand-out of `~/.cc-tmp/<id>` goes through `_child_tmpdir`, which needs `.child`. So
// a spawn on a recycled slug BEFORE the move is seen by step 5's direct lookup and the leaf goes back to it; a spawn
// AFTER the move gets a NEW inode from `mkdir -p`, which step 6 never touches, because it removes only the slot's
// inode, dev:ino-checked. Here a real `_child_tmpdir` runs at each boundary, and each case asserts that the new child's
// leaf stands — restored, kept beside a kept record, or never touched. Never removed. And a straggler that re-creates
// the leaf after the move makes a new, unwitnessed inode that is never taken.
// FIXTURE HOME ONLY (`collectRaceFixture.ts`). Linux only, and only where `mv --no-copy` exists (spec §5.6).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import {
  COL_ID, G2_RUN, LINUX, NO_COPY, SNAPSHOT_GAP, collectAudit, collectVerb, devinoOf, docOf, factsOf, g2Departs, g2Row,
  g2Spawn, gapAt, gapErrorsOf, gapsOf, lastVerdict, orphanLeaf, quarantineOf, recordsOf, settle, shownRounds, slotsOf,
  tokenOf, witnessField, witnessOf,
} from './collectRaceFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-spawn-'); });
afterEach(() => { h.cleanup(); });

const handedTo = (): string => fs.readFileSync(path.join(h.home, 'g2-dir'), 'utf8');

describe.skipIf(!LINUX || !NO_COPY)('the seam: ten step boundaries, in the quarantine order, each at the disk state it names', () => {
  it('a fresh collection: record, slot, move, re-proofs, the slot\'s leaf, the slot, the witness — and the record LAST', () => {
    orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, SNAPSHOT_GAP);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['collected'], r.stdout).toBe(COL_ID);
    // Five flags per point: the leaf at the id · a record · a slot · the slot's leaf · the witness.
    expect(factsOf(h)).toEqual([
      ['locked', '10001'], ['consented', '10001'], ['recorded', '11001'], ['slotted', '11101'],
      ['moved', '01111'], ['proven', '01111'], ['removed', '01101'], ['emptied', '01001'],
      ['witnessed', '01000'], ['dropped', '00000'],
    ]);
  }, 120_000);
});

describe.skipIf(!LINUX || !NO_COPY)('a recycled spawn that ADOPTS the old leaf before the move: the leaf goes back to it, whole', () => {
  it.each(['locked', 'consented', 'recorded', 'slotted'] as const)(
    'spawned at `%s`: refused; the adopted leaf stands at the id; no record, no slot',
    (point) => {
      const o = orphanLeaf(h);
      const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ [point]: `${g2Row()} && ${g2Spawn()}` }));
      expect(gapErrorsOf(h), 'the CONTROL: the spawn ran').toEqual([]);
      expect(gapsOf(h), 'the CONTROL: at its point').toContain(point);
      expect(handedTo(), 'the CONTROL: `mkdir -p` ADOPTED the old leaf').toBe(o.leaf);
      expect(r.code, r.stdout + r.stderr).toBe(0);
      const word = docOf(r.stdout)['refused'];
      if (point === 'locked') {
        // Ruled (T8 OPEN5): a spawn at the `locked` boundary answers `registered`. The fork's registry rung refuses
        // before the token is compared, and before anything is written.
        expect(word, r.stdout).toBe('registered');
        expect(gapsOf(h), 'refused inside step 1').toEqual(['locked']);
      } else {
        expect(word, r.stdout).toBe('registered');
        expect(gapsOf(h), 'step 5 refused, so step 6 never ran').not.toContain('proven');
      }
      expect(devinoOf(o.leaf), 'the new child\'s leaf is the inode it was handed').toBe(o.devino);
      expect(fs.readFileSync(path.join(o.leaf, 'g2.txt'), 'utf8'), 'its scratch survives').toBe('g2 scratch\n');
      expect(fs.readFileSync(path.join(o.leaf, 'scratch', 'a.txt'), 'utf8'), 'the old scratch is back with it').toBe('old work\n');
      expect(recordsOf(h), 'a proven restore keeps no record').toEqual([]);
      expect(slotsOf(h), 'and no slot').toEqual([]);
      expect(witnessField(h, 'run'), 'the witness is the new child\'s').toBe(G2_RUN);
    },
    120_000,
  );
});

describe.skipIf(!LINUX || !NO_COPY)('a recycled spawn AFTER the move: a new inode, never touched', () => {
  it('at `moved`: the restore is refused (NOREPLACE) — the new child\'s EMPTY leaf is never replaced — and the record and slot are KEPT until that child leaves', () => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ moved: `${g2Row()} && ${g2Spawn(COL_ID, '')}` }));
    expect(gapErrorsOf(h), 'the CONTROL: the spawn ran').toEqual([]);
    const g2 = devinoOf(o.leaf);
    expect(g2, 'the new child was handed a NEW inode at the id').not.toBeNull();
    expect(g2).not.toBe(o.devino);
    expect(fs.readdirSync(o.leaf), 'untouched, and still EMPTY: a restore that replaced it would have filled it').toEqual([]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused'], r.stdout).toBe('quarantine-kept');
    const slots = slotsOf(h);
    expect(slots, 'one slot is kept').toHaveLength(1);
    expect(recordsOf(h), 'named by its record').toEqual([slots[0]!.slice('slot.'.length)]);
    const kept = path.join(quarantineOf(h), slots[0]!, 'leaf');
    expect(devinoOf(kept), 'the old leaf is kept in its slot').toBe(o.devino);
    // While the new child holds the slug, no audit licenses anything, and nothing moves.
    for (let i = 0; i < 2; i += 1) {
      const d = docOf(collectAudit(h).stdout);
      expect(d['token'], `audit ${i + 1} offers no token while a child holds the slug: ${JSON.stringify(d)}`).toBeUndefined();
    }
    expect(devinoOf(kept)).toBe(o.devino);
    expect(devinoOf(o.leaf)).toBe(g2);
    // It leaves, as its own reclaim leaves it: the record is resumed, and only the record's inode goes.
    g2Departs(h);
    const rounds = settle(h);
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(devinoOf(kept), 'the kept leaf went once nothing held the slug').toBeNull();
    expect(slotsOf(h)).toEqual([]);
    expect(recordsOf(h)).toEqual([]);
  }, 240_000);

  it('SPLIT — `.child` written at `slotted`, the `mkdir -p` at `moved`: the same — a new inode, the restore refused, kept', () => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ slotted: g2Row(), moved: g2Spawn() }));
    expect(gapErrorsOf(h), 'the CONTROL: both halves ran').toEqual([]);
    expect(devinoOf(o.leaf), 'a NEW inode at the id').not.toBe(o.devino);
    expect(fs.readFileSync(path.join(o.leaf, 'g2.txt'), 'utf8'), 'the new child\'s scratch survives').toBe('g2 scratch\n');
    expect(docOf(r.stdout)['refused'], r.stdout).toBe('quarantine-kept');
    const slots = slotsOf(h);
    expect(slots).toHaveLength(1);
    expect(devinoOf(path.join(quarantineOf(h), slots[0]!, 'leaf')), 'the old leaf is kept in its slot').toBe(o.devino);
    expect(recordsOf(h)).toEqual([slots[0]!.slice('slot.'.length)]);
  }, 120_000);

  it.each(['proven', 'removed'] as const)(
    'at `%s`: step 6 removes the slot\'s inode alone; the new leaf and the new witness stand (compare-and-drop)',
    (point) => {
      const o = orphanLeaf(h);
      const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ [point]: `${g2Row()} && ${g2Spawn()}` }));
      expect(gapErrorsOf(h), 'the CONTROL: the spawn ran').toEqual([]);
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(docOf(r.stdout)['collected'], r.stdout).toBe(COL_ID);
      const g2 = fs.lstatSync(o.leaf, { bigint: true });
      expect(`${g2.dev}:${g2.ino}`, 'a NEW inode at the id').not.toBe(o.devino);
      expect(fs.readFileSync(path.join(o.leaf, 'g2.txt'), 'utf8'), 'the new child\'s scratch survives').toBe('g2 scratch\n');
      expect(witnessField(h, 'run'), 'the new child\'s witness stands').toBe(G2_RUN);
      expect(witnessField(h, 'ino'), 'naming the new inode').toBe(String(g2.ino));
      expect(slotsOf(h)).toEqual([]);
      expect(recordsOf(h)).toEqual([]);
    },
    120_000,
  );
});

describe.skipIf(!LINUX || !NO_COPY)('a straggler re-creating the leaf after the move', () => {
  it('at `moved`, with no row and no marker: a new, UNWITNESSED inode — the slot\'s leaf is collected, the straggler\'s is never taken', () => {
    const o = orphanLeaf(h);
    const straggle = `mkdir -p -- "${o.leaf}" && printf 'straggler\\n' > "${o.leaf}/s.txt"`;
    const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ moved: straggle }));
    expect(gapErrorsOf(h), 'the CONTROL: the straggler ran').toEqual([]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['collected'], r.stdout).toBe(COL_ID);
    expect(devinoOf(o.leaf), 'a NEW inode at the id').not.toBe(o.devino);
    expect(fs.readFileSync(path.join(o.leaf, 's.txt'), 'utf8'), 'the straggler\'s new leaf stands').toBe('straggler\n');
    expect(fs.existsSync(witnessOf(h)), 'the collected witness went with the collected leaf').toBe(false);
    for (let i = 0; i < 2; i += 1) {
      expect(docOf(collectAudit(h).stdout)['verdict'], 'an unwitnessed leaf is nothing to collect').toBe('not-witnessed');
    }
    expect(fs.readFileSync(path.join(o.leaf, 's.txt'), 'utf8')).toBe('straggler\n');
  }, 120_000);
});
```

- [ ] **Step 3: Write the crash suite**

Each case plants two decoys the resume must never touch: another id's witnessed orphan, and a slot carrying this id's own name that no record names.

Create `server/test/ccd-collect-race-crash.test.ts`:

```ts
// A SIGKILL AFTER EVERY STEP (child-workspace reclamation wave 7, spec 2026-09-22 §5.6). The quarantine record is
// written FIRST and dropped LAST, so a crash at any point leaves it, and it — not the witness, not the journal — is the
// authority the next audit resumes from. Each case kills the verb at one point, checks the invariants at the instant
// of death (no slot without its record; the leaf's inode in exactly one place), then runs "the next audit and verb" to
// quiescence: the job is finished, and nothing but the record's own inode was removed. Then the witness is rewritten,
// dropped and deleted under a standing record: the record is found whatever the witness says.
// FIXTURE HOME ONLY (`collectRaceFixture.ts`). Linux only (`/proc/<pid>/stat`), and only where `mv --no-copy` exists.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import {
  COL_ID, DEAD_RUN, G2_RUN, LINUX, NO_COPY, POINTS, TOKEN, collectAudit, collectVerb, crashAt, crashedAt, custodyHolds,
  devinoOf, docOf, g2Departs, g2Row, g2Spawn, lastVerdict, orphanLeaf, quarantineOf, recordsOf, settle, shownRounds,
  slotsOf, tokenOf, verdictOf, witnessField, witnessOf, type Orphan,
} from './collectRaceFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-crash-'); });
afterEach(() => { h.cleanup(); });

const OTHER = 'demo-quiet-river';
const DECOY = `slot.${COL_ID}.1.1`;
const ours = (): string[] => slotsOf(h).filter((s) => s !== DECOY);
const at = (p: (typeof POINTS)[number]): number => POINTS.indexOf(p);

/** What a resume must never touch: another id's witnessed orphan, and a slot carrying THIS id's own name that no
 *  record names — a slot with no record is never visited. */
const plantDecoys = (): { other: Orphan; forged: string } => {
  const other = orphanLeaf(h, OTHER);
  const forged = path.join(quarantineOf(h), DECOY, 'leaf');
  fs.mkdirSync(forged, { recursive: true });
  fs.chmodSync(quarantineOf(h), 0o700);
  fs.writeFileSync(path.join(forged, 'keep'), 'not the record\'s\n');
  return { other, forged };
};

describe.skipIf(!LINUX || !NO_COPY)('killed after each step: the next audit finds the record and finishes — removing only its inode', () => {
  it.each(POINTS.map((p, i) => [p, i] as const))('killed at `%s`', (point, i) => {
    const o = orphanLeaf(h);
    const d = plantDecoys();
    const r = collectVerb(h, tokenOf(h), COL_ID, crashAt(point));
    expect(crashedAt(h), 'the CONTROL: the kill fired where it was aimed').toBe(point);
    expect(docOf(r.stdout)['collected'], 'a killed verb reports nothing').toBeUndefined();

    // AT THE INSTANT OF DEATH.
    custodyHolds(h, COL_ID, [DECOY]);
    const recorded = i >= at('recorded') && i < at('dropped');
    expect(recordsOf(h), 'a record stands from `recorded` until it is dropped, LAST').toHaveLength(recorded ? 1 : 0);
    expect(fs.existsSync(witnessOf(h)), 'the witness stands until `witnessed`').toBe(i < at('witnessed'));
    const inSlot = ours().map((s) => path.join(quarantineOf(h), s, 'leaf'));
    const where = [o.leaf, ...inSlot].filter((p) => devinoOf(p) === o.devino);
    const expected = i < at('moved') ? [o.leaf] : i < at('removed') ? inSlot : [];
    expect(where, 'the leaf\'s inode: at the id before the move, in its slot until step 6, then nowhere').toEqual(expected);
    if (i >= at('moved') && i < at('removed')) expect(inSlot, 'one slot holds it').toHaveLength(1);

    // THE NEXT AUDIT FINDS THE RECORD, AND THE JOB IS FINISHED.
    const first = collectAudit(h);
    if (recorded) expect(docOf(first.stdout)['verdict'], 'a standing record is never "nothing to collect"').not.toBe('not-witnessed');
    expect(fs.existsSync(witnessOf(h)), 'the audit writes nothing').toBe(i < at('witnessed'));
    const rounds = settle(h);
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(devinoOf(o.leaf), 'collected').toBeNull();
    expect(ours(), 'no slot of the id is left').toEqual([]);
    expect(recordsOf(h), 'no record').toEqual([]);
    expect(fs.existsSync(witnessOf(h)), 'no witness').toBe(false);

    // NOTHING BUT THE RECORD'S INODE WAS REMOVED.
    expect(fs.readFileSync(path.join(d.forged, 'keep'), 'utf8'), 'a slot no record names is never visited').toBe('not the record\'s\n');
    expect(devinoOf(d.other.leaf), 'another id\'s orphan is untouched').toBe(d.other.devino);
    expect(witnessField(h, 'run', OTHER), 'and so is its witness').toBe(DEAD_RUN);
  }, 240_000);
});

describe.skipIf(!LINUX || !NO_COPY)('the record is found WHATEVER THE WITNESS SAYS', () => {
  /** The verb killed right after the move: the leaf in its slot, its record standing, the id's path empty. */
  const killedInSlot = (): { o: Orphan; rec: string; kept: string } => {
    const o = orphanLeaf(h);
    collectVerb(h, tokenOf(h), COL_ID, crashAt('moved'));
    expect(crashedAt(h), 'the CONTROL: the kill fired').toBe('moved');
    const recs = recordsOf(h);
    const slots = slotsOf(h);
    expect(recs, 'the CONTROL: one record stands').toHaveLength(1);
    expect(slots, 'the CONTROL: one slot').toHaveLength(1);
    const kept = path.join(quarantineOf(h), slots[0]!, 'leaf');
    expect(devinoOf(kept), 'the CONTROL: the leaf is in its slot').toBe(o.devino);
    return { o, rec: recs[0]!, kept };
  };

  it('REWRITTEN by a recycled spawn: nothing moves while that child lives; once its own tail has DROPPED the witness, the record is resumed and only its inode goes', () => {
    const c = killedInSlot();
    h.sh(`${g2Row()} && ${g2Spawn()}`);
    const g2 = devinoOf(c.o.leaf);
    expect(g2, 'the CONTROL: a new inode at the id').not.toBe(c.o.devino);
    expect(witnessField(h, 'run'), 'the CONTROL: the witness now names the new child').toBe(G2_RUN);
    for (let n = 0; n < 2; n += 1) {
      const d = docOf(collectAudit(h).stdout);
      expect(d['token'], `no token while a child holds the slug: ${JSON.stringify(d)}`).toBeUndefined();
      expect(d['verdict'], 'the record is found: never "nothing to collect"').not.toBe('not-witnessed');
    }
    expect(devinoOf(c.kept), 'the kept leaf stands').toBe(c.o.devino);
    expect(devinoOf(c.o.leaf), 'the new child\'s leaf stands').toBe(g2);
    expect(fs.readFileSync(path.join(c.o.leaf, 'g2.txt'), 'utf8')).toBe('g2 scratch\n');
    expect(recordsOf(h)).toEqual([c.rec]);
    g2Departs(h);
    expect(fs.existsSync(witnessOf(h)), 'the CONTROL: the later tail dropped the witness').toBe(false);
    const rounds = settle(h);
    expect(verdictOf(rounds[0]), 'found with no witness at all').not.toBe('not-witnessed');
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(devinoOf(c.kept)).toBeNull();
    expect(slotsOf(h)).toEqual([]);
    expect(recordsOf(h)).toEqual([]);
  }, 240_000);

  it.each([
    ['DROPPED by a later tail (`_ws_tmproot_witness_drop`)', `_ws_tmproot_witness_drop ${COL_ID} >/dev/null 2>&1; :`],
    ['ABSENT (deleted by hand)', `rm -f -- "$REG/tmproots/${COL_ID}"`],
  ])('%s: the record alone licenses the resume', (_how, drop) => {
    const c = killedInSlot();
    h.sh(drop);
    expect(fs.existsSync(witnessOf(h)), 'the CONTROL: no witness').toBe(false);
    const rounds = settle(h);
    expect(verdictOf(rounds[0]), 'a standing record is never "nothing to collect"').not.toBe('not-witnessed');
    expect(String(rounds[0]?.doc['token'] ?? ''), 'a resume token, minted from the record').toMatch(TOKEN);
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(devinoOf(c.kept)).toBeNull();
    expect(slotsOf(h)).toEqual([]);
    expect(recordsOf(h)).toEqual([]);
  }, 240_000);
});
```

- [ ] **Step 4: Write the forgery and swap suite**

Each forgery is cut from a GENUINE record (the verb is killed in its slot first). The cases therefore do not depend on the record's exact byte format. The record carries no `slot=` (ruling G5), so there is no body path to forge: its slot is derived from its NAME.

Create `server/test/ccd-collect-race-forge.test.ts`:

```ts
// FORGERIES AND SWAPS (child-workspace reclamation wave 7, spec 2026-09-22 §5.6). The quarantine record and its slot
// are same-uid writable, like the witness, so they share its trust note: they guard against ccd's own mistakes and a
// recycled id, and a forgery is caught only where it fails a re-proof. Each case forges one thing a re-proof asks — the
// slot's leaf, the record's id, its body, a slot no record names — and asserts the forgery is never
// taken, and that a kept record is LISTED (the audit journals its terminal refusal). Then a file and a link are swapped
// in at the id between step 2's lstat and step 4's move: nothing that is not the witnessed directory is ever unlinked,
// on that pass or any later one.
// FIXTURE HOME ONLY (`collectRaceFixture.ts`). Linux only, and only where `mv --no-copy` exists (spec §5.6).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import {
  COL_ID, LINUX, NO_COPY, collectAudit, collectVerb, crashAt, crashedAt, devinoOf, docOf, gapAt, gapErrorsOf, gapsOf,
  lastVerdict, orphanLeaf, quarantineOf, recordDirOf, recordsOf, settle, shownRounds, slotsOf, tokenOf, verdictOf,
  witnessOf, type Orphan,
} from './collectRaceFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-forge-'); });
afterEach(() => { h.cleanup(); });

const OTHER = 'demo-quiet-river';
/** The verb killed right after the move: the leaf in its slot, its genuine record standing. */
const killedInSlot = (): { o: Orphan; rec: string; slot: string; kept: string } => {
  const o = orphanLeaf(h);
  collectVerb(h, tokenOf(h), COL_ID, crashAt('moved'));
  expect(crashedAt(h), 'the CONTROL: the kill fired').toBe('moved');
  const [rec] = recordsOf(h);
  const [slot] = slotsOf(h);
  expect(rec, 'the CONTROL: a genuine record').toBeDefined();
  expect(slot, 'the CONTROL: its slot').toBeDefined();
  const kept = path.join(quarantineOf(h), slot!, 'leaf');
  expect(devinoOf(kept), 'the CONTROL: the leaf is in its slot').toBe(o.devino);
  return { o, rec: rec!, slot: slot!, kept };
};
/** A kept record is LISTED, never silent (spec §5.6): the audit journals its terminal refusal, `collect` / `ws-audit`. */
const keptListed = (): number => eventsOf(h.home, 'collect')
  .filter((e) => e['outcome'] === 'refused' && e['refusal'] === 'quarantine-kept' && e['verb'] === 'ws-audit').length;

describe.skipIf(!LINUX || !NO_COPY)('a forged record or slot is never taken — kept, and listed', () => {
  it('a FORGED SLOT LEAF — the record\'s slot now holds another directory: `quarantine-kept`, and neither tree is touched', () => {
    const c = killedInSlot();
    const genuine = path.join(h.home, 'genuine');
    fs.renameSync(c.kept, genuine);
    fs.mkdirSync(c.kept, { mode: 0o700 });
    fs.writeFileSync(path.join(c.kept, 'precious.txt'), 'not the leaf\n');
    const rounds = settle(h);
    expect(verdictOf(rounds[0]), shownRounds(rounds)).toBe('quarantine-kept');
    expect(rounds, 'no token: nothing was ever spent').toHaveLength(1);
    expect(fs.readFileSync(path.join(c.kept, 'precious.txt'), 'utf8'), 'the planted tree survives').toBe('not the leaf\n');
    expect(devinoOf(genuine), 'the genuine leaf, moved out, is untouched').toBe(c.o.devino);
    expect(recordsOf(h), 'the record is kept for the operator').toEqual([c.rec]);
    expect(keptListed(), 'listed: journaled at the audit').toBeGreaterThanOrEqual(1);
  }, 180_000);

  it('a record COPIED under another id\'s name, its body naming this id: kept for that id, and never applied to either', () => {
    const c = killedInSlot();
    const other = orphanLeaf(h, OTHER);
    const forged = `${OTHER}.${c.rec.slice(COL_ID.length + 1)}`;
    fs.copyFileSync(path.join(recordDirOf(h), c.rec), path.join(recordDirOf(h), forged));
    expect(docOf(collectAudit(h, OTHER).stdout)['verdict'], 'the id in the body is not the id in the name').toBe('quarantine-kept');
    // The genuine record still resumes its own id; the copy touches neither id's leaf.
    expect(lastVerdict(settle(h)), 'the genuine id finishes').toBe('not-witnessed');
    expect(devinoOf(c.kept)).toBeNull();
    expect(devinoOf(other.leaf), 'the other id\'s leaf is untouched').toBe(other.devino);
    expect(fs.existsSync(witnessOf(h, OTHER)), 'and its witness').toBe(true);
    const later = settle(h, OTHER);
    expect(verdictOf(later[0]), shownRounds(later)).toBe('quarantine-kept');
    expect(devinoOf(other.leaf)).toBe(other.devino);
  }, 240_000);

  it('a MALFORMED record — garbage under this id\'s exact record name: `quarantine-kept`; the id\'s own leaf is not taken past it', () => {
    const o = orphanLeaf(h);
    fs.mkdirSync(recordDirOf(h), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(recordDirOf(h), `${COL_ID}.1791000000000000000.4242`), 'garbage\n');
    const rounds = settle(h);
    expect(verdictOf(rounds[0]), shownRounds(rounds)).toBe('quarantine-kept');
    expect(rounds).toHaveLength(1);
    expect(devinoOf(o.leaf), 'the leaf stands').toBe(o.devino);
    expect(fs.readFileSync(path.join(o.leaf, 'scratch', 'a.txt'), 'utf8')).toBe('old work\n');
    expect(keptListed()).toBeGreaterThanOrEqual(1);
  }, 180_000);

  it('a FORGED SLOT with no record — a directory named like this id\'s slot: never visited; the id\'s own leaf is collected around it', () => {
    const o = orphanLeaf(h);
    const forged = path.join(quarantineOf(h), `slot.${COL_ID}.1.1`, 'leaf');
    fs.mkdirSync(forged, { recursive: true });
    fs.chmodSync(quarantineOf(h), 0o700);
    fs.writeFileSync(path.join(forged, 'precious.txt'), 'planted\n');
    const rounds = settle(h);
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(devinoOf(o.leaf), 'the witnessed leaf was collected').toBeNull();
    expect(fs.readFileSync(path.join(forged, 'precious.txt'), 'utf8'), 'the unrecorded slot is untouched').toBe('planted\n');
  }, 180_000);
});

describe.skipIf(!LINUX || !NO_COPY)('a file or a link swapped in at the id between step 2\'s lstat and the move: never unlinked', () => {
  const precious = (): string => path.join(h.home, 'precious');
  /** At `slotted`: the witnessed directory is moved aside (to `$HOME/aside`), `put` leaves something else at the id,
   *  and that thing's OWN inode is written to `$HOME/swapped-ino`. */
  const swapAt = (put: string): string => `mv -T -- "$HOME/.cc-tmp/${COL_ID}" "$HOME/aside" && ${put}`
    + ` && stat -c %i -- "$HOME/.cc-tmp/${COL_ID}" > "$HOME/swapped-ino"`;
  const FILE = `printf 'swapped in\\n' > "$HOME/.cc-tmp/${COL_ID}"`;
  const LINK = `ln -s -- "$HOME/precious" "$HOME/.cc-tmp/${COL_ID}"`;
  /** Where the swapped-in entry stands now — at the id, or as a slot's leaf — by its own inode. */
  const swappedWhere = (o: Orphan): string[] => {
    const ino = fs.readFileSync(path.join(h.home, 'swapped-ino'), 'utf8').trim();
    return [o.leaf, ...slotsOf(h).map((s) => path.join(quarantineOf(h), s, 'leaf'))].filter((p) => {
      try { return String(fs.lstatSync(p, { bigint: true }).ino) === ino; } catch { return false; }
    });
  };

  it.each([['a regular FILE', FILE], ['a LINK to a directory', LINK]])(
    '%s: it reaches the slot and is KEPT there, `quarantine-kept`, and listed — never unlinked; a link\'s target and the moved-aside leaf untouched',
    (_what, put) => {
      fs.mkdirSync(precious());
      fs.writeFileSync(path.join(precious(), 'keep.txt'), 'precious\n');
      const o = orphanLeaf(h);
      const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ slotted: swapAt(put) }));
      expect(gapErrorsOf(h), 'the CONTROL: the swap ran').toEqual([]);
      const d = docOf(r.stdout);
      expect(d['collected'], `nothing that is not the witnessed directory is taken: ${r.stdout}`).toBeUndefined();
      // Ruled (T8 OPEN5): anything that is not the witnessed leaf and REACHED a slot is `quarantine-kept`, terminal, at
      // exit 0: kept and listed for the operator, never unlinked. (Swapped in before step 2's lstat it would be
      // `witness-mismatch`; at `slotted` it is past that lstat, so the move carries it into the slot.)
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(d['refused'], r.stdout).toBe('quarantine-kept');
      expect(swappedWhere(o), 'the swapped-in entry still exists, once').toHaveLength(1);
      expect(fs.readFileSync(path.join(precious(), 'keep.txt'), 'utf8'), 'a link\'s target is never followed').toBe('precious\n');
      expect(devinoOf(path.join(h.home, 'aside')), 'the moved-aside leaf is untouched').toBe(o.devino);
      settle(h);
      expect(swappedWhere(o), 'and no later audit or verb unlinks it').toHaveLength(1);
      expect(fs.readFileSync(path.join(precious(), 'keep.txt'), 'utf8')).toBe('precious\n');
      expect(keptListed(), 'listed: journaled at the audit').toBeGreaterThanOrEqual(1);
    },
    240_000,
  );

  it('a file swapped in REACHES THE SLOT: the move is never proven, and it is kept there with its record — `quarantine-kept` now and on every later audit', () => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ slotted: swapAt(FILE) }));
    expect(gapErrorsOf(h), 'the CONTROL: the swap ran').toEqual([]);
    // `moved` is called only once the move is PROVEN (Task 6's seam, ruling G7), and a file at the slot's leaf is not
    // the witnessed directory, so the point is never reached and a retake injected there would never run. (A RETAKEN
    // original path, ruling T8 OPEN4, is the spawn suite's `moved` and SPLIT cases.)
    expect(gapsOf(h), 'the move was never proven').not.toContain('moved');
    expect(docOf(r.stdout)['refused'], r.stdout).toBe('quarantine-kept');
    expect(swappedWhere(o), 'the file is the slot\'s leaf').toHaveLength(1);
    const [slot] = slotsOf(h);
    const kept = path.join(quarantineOf(h), slot!, 'leaf');
    expect(fs.readFileSync(kept, 'utf8'), 'kept whole').toBe('swapped in\n');
    expect(recordsOf(h), 'with its record').toHaveLength(1);
    const rounds = settle(h);
    expect(rounds.map((x) => verdictOf(x)), 'every later audit lists it and takes nothing').toEqual(['quarantine-kept']);
    expect(fs.readFileSync(kept, 'utf8')).toBe('swapped in\n');
    expect(keptListed()).toBeGreaterThanOrEqual(1);
  }, 240_000);
});
```

- [ ] **Step 5: Write the substrate suite**

The two `mv` shims match only sources under THIS fixture's `~/.cc-tmp`. Every other `mv` (`_reg_set`'s `_plat_mv_notdir`, the witness's compare-and-drop) is the real one.

Create `server/test/ccd-collect-race-substrate.test.ts`:

```ts
// THE SUBSTRATE THE MOVE STANDS ON (child-workspace reclamation wave 7, spec 2026-09-22 §5.6). The move is one
// `renameat2(RENAME_NOREPLACE)`, spelled `mv -T -n --no-copy`, and the collector never copies: a cross-mount EXDEV, or
// a `mv` with no `--no-copy` (coreutils older than 9.2), answers unmeasured and leaves nothing behind. Both are shims on
// PATH, scoped to THIS fixture's `~/.cc-tmp`, standing in for what the fleet measured. And step 5 reads the mount table
// through `_ws_collect_mountinfo`, which prints the table's PATH: a mount point at or under the slot's leaf, or a table
// it cannot read, is doubt. The leaf goes back, proven by lstat, and the verb answers `failed` `probe-unmeasured`.
// FIXTURE HOME ONLY (`collectRaceFixture.ts`). Linux only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import {
  COL_ID, LINUX, NO_COPY, collectAudit, collectVerb, devinoOf, docOf, gapAt, gapsOf, orphanLeaf, quarantineOf,
  recordsOf, slotsOf, tmpRootOf, tokenOf,
} from './collectRaceFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-substrate-'); });
afterEach(() => { h.cleanup(); });

/** The host's own `mv`, resolved once by MEASURING this process's PATH. */
const REAL_MV = (process.env['PATH'] ?? '').split(':').filter(Boolean).map((d) => path.join(d, 'mv'))
  .find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } }) ?? '';
const shimDir = (): string => path.join(h.home, 'mvshim');
const writeShim = (body: string): void => {
  fs.mkdirSync(shimDir(), { recursive: true });
  fs.writeFileSync(path.join(shimDir(), 'mv'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
};
const SHIM = (): string => `PATH="${shimDir()}:$PATH";`;
/** rename(2) across two mounts, as the fleet measured it (coreutils 9.4): WITH `--no-copy`, EXDEV is a refusal and
 *  nothing lands at the target; WITHOUT it, mv COPIES, fails to remove the source, and LEAVES THE COPY. Only a source
 *  under this fixture's `~/.cc-tmp` is a leaf move; every other `mv` is the real one. */
const exdevShim = (): string => [
  'prev=""; last=""; nc=0',
  'for a in "$@"; do [ "$a" = --no-copy ] && nc=1; prev=$last; last=$a; done',
  'case "$prev" in',
  `  '${tmpRootOf(h)}'/*)`,
  '    if [ "$nc" = 1 ]; then echo "mv: cannot move \'$prev\' to \'$last\': Invalid cross-device link" >&2; exit 1; fi',
  '    cp -a -- "$prev" "$last" 2>/dev/null',
  '    echo "mv: cannot remove \'$prev\': Permission denied" >&2; exit 1 ;;',
  'esac',
  `exec '${REAL_MV}' "$@"`,
].join('\n');
/** A coreutils older than 9.2: no `--no-copy`. It refuses the option as GNU getopt does, and its --help never names it. */
const noNoCopyShim = (): string => [
  'for a in "$@"; do',
  '  case "$a" in',
  '    --no-copy) echo "mv: unrecognized option \'--no-copy\'" >&2; echo "Try \'mv --help\' for more information." >&2; exit 1 ;;',
  `    --help) '${REAL_MV}' --help | grep -v -e --no-copy; exit 0 ;;`,
  '  esac',
  'done',
  `exec '${REAL_MV}' "$@"`,
].join('\n');
/** Every entry under the quarantine directory, relative — what a copy would have left. */
const underQuarantine = (): string[] => {
  const q = quarantineOf(h);
  if (!fs.existsSync(q)) return [];
  return (fs.readdirSync(q, { recursive: true }) as string[]).sort();
};
/** The leaf stands at the id, whole, as the orphan was made. */
const intactAtId = (o: { leaf: string; devino: string }): void => {
  expect(devinoOf(o.leaf), 'the leaf stands at the id, the same inode').toBe(o.devino);
  expect(fs.readFileSync(path.join(o.leaf, 'scratch', 'a.txt'), 'utf8'), 'with its scratch').toBe('old work\n');
  expect(recordsOf(h), 'no record').toEqual([]);
  expect(slotsOf(h), 'no slot').toEqual([]);
};

describe.skipIf(!LINUX)('the runner itself', () => {
  it('the CONTROL: this Linux runner\'s mv has --no-copy, so the race suites RAN rather than skipped', () => {
    expect(NO_COPY, 'coreutils 9.2 or later is required to measure the collector at all').toBe(true);
    expect(path.isAbsolute(REAL_MV), `measured the host mv as ${JSON.stringify(REAL_MV)}`).toBe(true);
  });
});

describe.skipIf(!LINUX || !NO_COPY)('the move never copies', () => {
  it('EXDEV — the quarantine on another mount: `probe-unmeasured`, nothing moved, NOTHING COPIED, no record, no slot', () => {
    writeShim(exdevShim());
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h, COL_ID, SHIM()), COL_ID, SHIM());
    expect(underQuarantine(), 'nothing was copied into the quarantine').toEqual([]);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(docOf(r.stdout)['failed'], r.stdout).toBe('probe-unmeasured');
    intactAtId(o);
  }, 120_000);

  it('a `mv` with no --no-copy: the AUDIT answers `unmeasured`, exits 1, and journals nothing', () => {
    writeShim(noNoCopyShim());
    const o = orphanLeaf(h);
    const a = collectAudit(h, COL_ID, SHIM());
    expect(a.code, a.stdout + a.stderr).toBe(1);
    expect(docOf(a.stdout)['verdict'], a.stdout).toBe('unmeasured');
    expect(docOf(a.stdout)['token'], 'no token').toBeUndefined();
    expect(eventsOf(h.home, 'collect'), 'unmeasured is journaled nowhere').toEqual([]);
    intactAtId(o);
  }, 120_000);

  it('a `mv` with no --no-copy, at the VERB (the token minted where it had one): `probe-unmeasured` before anything is written', () => {
    const o = orphanLeaf(h);
    const token = tokenOf(h);
    writeShim(noNoCopyShim());
    const r = collectVerb(h, token, COL_ID, `${SHIM()} ${gapAt({})}`);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(docOf(r.stdout)['failed'], r.stdout).toBe('probe-unmeasured');
    expect(gapsOf(h), 'refused inside the lock BEFORE the record').not.toContain('recorded');
    intactAtId(o);
    expect(underQuarantine()).toEqual([]);
  }, 120_000);
});

/** `_ws_collect_mountinfo`, redefined. Task 6's seam PRINTS THE PATH of the table `_ws_collect_mounts_clear` opens, so
 *  this one writes `$HOME/mountinfo` (the real table, plus one line per `rels` whose mount point (field 5) is
 *  `<physical slot>/<rel>`, the slot found by its name at the instant step 5 asks, and one per `abs`) and prints that
 *  path. A failure prints nothing, which the reader cannot open: unmeasured. */
const MOUNTS = (rels: readonly string[], abs: readonly string[] = []): string =>
  '_ws_collect_mountinfo() { local s p r t="$HOME/mountinfo"; cat /proc/self/mountinfo > "$t" || return 1;'
  + ` for s in "$HOME/.cc-tmp/.ccd-quarantine"/slot.${COL_ID}.*; do [[ -d "$s" ]] || continue; p=$(cd -- "$s" && pwd -P) || return 1;`
  + ` for r in ${rels.map((x) => `'${x}'`).join(' ')}; do printf '4242 1 0:4242 / %s rw,relatime - tmpfs tmpfs rw\\n' "$p/$r" >> "$t"; done; done;`
  + abs.map((a) => ` printf '4243 1 0:4243 / %s rw,relatime - tmpfs tmpfs rw\\n' "${a}" >> "$t";`).join('')
  + ' printf \'%s\' "$t"; };';

describe.skipIf(!LINUX || !NO_COPY)('step 5\'s mount check, through `_ws_collect_mountinfo`', () => {
  it.each(['leaf/sub', 'leaf'])('a mount point at `<slot>/%s`: doubt — the leaf goes back, proven; `probe-unmeasured`; nothing removed', (rel) => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, MOUNTS([rel]));
    const d = docOf(r.stdout);
    expect(d['collected'], r.stdout).toBeUndefined();
    // Ruled (T8 OPEN5, T6 OPEN8): a mount at or under the slot's leaf is unmeasured, answered after a PROVEN restore.
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(d['failed'], r.stdout).toBe('probe-unmeasured');
    intactAtId(o);
  }, 120_000);

  it('a mount table that cannot be READ: unmeasured — the leaf goes back; `probe-unmeasured`', () => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, '_ws_collect_mountinfo() { printf \'%s\' "$HOME/no-such-table"; };');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(docOf(r.stdout)['failed'], r.stdout).toBe('probe-unmeasured');
    intactAtId(o);
  }, 120_000);

  it('the CONTROL: a mount at `<slot>/leaf2` is beside the leaf, not under it, and one elsewhere is nowhere near — collected', () => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, MOUNTS(['leaf2'], [path.join(h.home, 'elsewhere')]));
    expect(docOf(r.stdout)['collected'], r.stdout).toBe(COL_ID);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(devinoOf(o.leaf)).toBeNull();
  }, 120_000);
});
```

- [ ] **Step 6: Write the ids suite**

The 0300 cases chmod the fixture's `$REG` from inside the verb's gap. `afterEach` puts it back to 0700 before the HOME is removed.

Create `server/test/ccd-collect-race-ids.test.ts`:

```ts
// IDS THAT ARE NOT WHAT THEY SEEM, AND A REGISTRY THAT CANNOT BE LISTED (child-workspace reclamation wave 7, spec
// 2026-09-22 §5.6). Ids admit dots, so a NESTED id (`p-calm-mesa.v2-quiet-river` beside `p-calm-mesa`) is legal: a
// record, a slot or a witness temp file is matched by an EXACT parse, never by an `<id>.*` prefix. A registry that can
// be searched but not listed (0300) blinds `_ws_slug_free` — measured: it answers free over a standing `.child` — so
// step 5 asks the marker rows (`.child`, `.uuid`) by direct lookup AND proves its own listing sees the reap lock it holds; otherwise the slug is
// unmeasured, never free. And a project named `cdk.out` is legal while the operator's `cdk.out*` sweep reaches depth 2
// under `~/.cc-tmp`, where slots live: a slot is named `slot.…`, so no name-keyed rule meets it.
// FIXTURE HOME ONLY (`collectRaceFixture.ts`). Linux only, and only where `mv --no-copy` exists (spec §5.6).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import {
  COL_ID, G2_RUN, LINUX, NO_COPY, ROOT_USER, collectVerb, crashAt, crashedAt, devinoOf, docOf, gapAt, gapErrorsOf,
  lastVerdict, orphanLeaf, quarantineOf, recordsOf, regOf, settle, shownRounds, slotsOf, tmpRootOf, tokenOf, witnessOf,
} from './collectRaceFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-ids-'); });
afterEach(() => {
  try { fs.chmodSync(regOf(h), 0o700); } catch { /* gone */ }
  h.cleanup();
});

const A = 'p-calm-mesa';
const B = 'p-calm-mesa.v2-quiet-river';

describe.skipIf(!LINUX || !NO_COPY)('a NESTED id is never cross-matched', () => {
  it('records: B\'s kept `p-calm-mesa.v2-quiet-river.<ns>.<pid>` is never A\'s — not by the reader, not by A\'s collection', () => {
    expect(h.sh('_ws_project_valid p-calm-mesa.v2 && echo legal'), 'the CONTROL: the nested project is legal').toBe('legal');
    const a = orphanLeaf(h, A);
    const b = orphanLeaf(h, B);
    collectVerb(h, tokenOf(h, B), B, crashAt('moved'));
    expect(crashedAt(h), 'the CONTROL: B was killed in its slot').toBe('moved');
    const brec = recordsOf(h, B);
    const bslot = slotsOf(h, B);
    expect(brec, 'the CONTROL: B\'s record stands').toHaveLength(1);
    const bkept = path.join(quarantineOf(h), bslot[0]!, 'leaf');
    expect(h.sh(`_ws_collect_records_of ${A}; :`), 'A has no record: B\'s is not one of A\'s').toBe('');
    expect(h.sh(`_ws_collect_records_of ${B}; :`).split('\n').filter(Boolean).map((p) => path.basename(p)),
      'B\'s, parsed exactly').toEqual(brec);
    const rounds = settle(h, A);
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(devinoOf(a.leaf), 'A was collected').toBeNull();
    expect(devinoOf(bkept), 'B\'s kept leaf is untouched').toBe(b.devino);
    expect(recordsOf(h, B), 'B\'s record stands').toEqual(brec);
    expect(slotsOf(h, B), 'and its slot').toEqual(bslot);
    expect(fs.existsSync(witnessOf(h, B)), 'and its witness').toBe(true);
    expect(lastVerdict(settle(h, B)), 'B finishes on its own').toBe('not-witnessed');
    expect(devinoOf(bkept)).toBeNull();
  }, 240_000);

  it('the witness writer\'s temp files: only `.<id>.<digits>.<digits>.tmp`, an hour old, is reaped — never a nested id\'s, a fresh one, or another shape', () => {
    orphanLeaf(h, A);
    orphanLeaf(h, B);
    const dir = path.join(regOf(h), 'tmproots');
    const names = {
      stale: `.${A}.4242.17.tmp`, fresh: `.${A}.4243.18.tmp`, nested: `.${B}.4244.19.tmp`,
      oneField: `.${A}.4245.tmp`, suffix: `.${A}.4246.20.tmp.x`,
    };
    const old = new Date(Date.now() - 2 * 3_600_000);
    for (const [k, n] of Object.entries(names)) {
      const p = path.join(dir, n);
      fs.writeFileSync(p, 'v=1 id=partial');
      if (k !== 'fresh') fs.utimesSync(p, old, old);
    }
    expect(lastVerdict(settle(h, A)), 'A was collected').toBe('not-witnessed');
    expect(fs.readdirSync(dir).filter((n) => n.startsWith('.')).sort(), 'only A\'s stale temp file went')
      .toEqual([names.fresh, names.nested, names.oneField, names.suffix].sort());
  }, 240_000);
});

describe.skipIf(!LINUX || !NO_COPY || ROOT_USER)('a registry that can be SEARCHED but not LISTED (0300): the slug proof is unmeasured, never free', () => {
  /** Step 5's row rule, answered "clear", so the slug proof is the ONLY question an unlistable registry can trip. */
  const ROWS_CLEAR = "_ws_collect_rows_clear() { _WS_COLLECT_ROWS_WHY=''; return 0; };";

  it('the CONTROL, measured: at 0300 a direct lookup still sees `.child`, while `_ws_slug_free` answers FREE over it', () => {
    const out = h.sh(`_reg_set ${COL_ID} child ${G2_RUN}; chmod 0300 "$REG";`
      + ` [[ -e "$REG/${COL_ID}.child" ]] && echo seen; _ws_slug_free demo calm-mesa; echo "rc=$?"; chmod 0700 "$REG"`);
    expect(out.split('\n'), 'if `_ws_slug_free` ever learns to see this, step 5\'s listing control is still the spec\'s rule')
      .toEqual(['seen', 'rc=0']);
    expect(h.sh('_ws_slug_free demo calm-mesa; echo "rc=$?"'), 'and at 0700 it sees it').toBe('rc=1');
  });

  it('a row lands at `moved` behind 0300: `_ws_slug_free` reads free, the listing cannot see the held lock — unmeasured; the leaf goes back', () => {
    const o = orphanLeaf(h);
    // A `.hold`: a row step 5's direct lookups (`.child`, `.uuid`) never ask, so only the listing can see it, and the
    // listing control is the one guard left (Task 5's own rung case plants the same).
    const r = collectVerb(h, tokenOf(h), COL_ID,
      `${ROWS_CLEAR} ${gapAt({ moved: `: > "$REG/${COL_ID}.hold" && chmod 0300 "$REG"` })}`);
    fs.chmodSync(regOf(h), 0o700);
    expect(gapErrorsOf(h), 'the CONTROL: the row landed').toEqual([]);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(docOf(r.stdout)['failed'], r.stdout).toBe('probe-unmeasured');
    expect(devinoOf(o.leaf), 'restored at the id').toBe(o.devino);
    expect(recordsOf(h)).toEqual([]);
    expect(slotsOf(h)).toEqual([]);
  }, 120_000);

  it('the CONTROL: the same row at 0700 — `_ws_slug_free` sees it: `registered`, the leaf goes back', () => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, `${ROWS_CLEAR} ${gapAt({ moved: `: > "$REG/${COL_ID}.hold"` })}`);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused'], r.stdout).toBe('registered');
    expect(devinoOf(o.leaf)).toBe(o.devino);
  }, 120_000);

  it('a `.child` lands at `moved` while `_ws_slug_free` is BLIND (stubbed free): step 5\'s DIRECT lookup alone sees it — `registered`, the leaf goes back', () => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID,
      `${ROWS_CLEAR} _ws_slug_free() { return 0; }; ${gapAt({ moved: `_reg_set ${COL_ID} child ${G2_RUN}` })}`);
    expect(gapErrorsOf(h)).toEqual([]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused'], r.stdout).toBe('registered');
    expect(devinoOf(o.leaf)).toBe(o.devino);
    expect(recordsOf(h)).toEqual([]);
  }, 120_000);
});

describe.skipIf(!LINUX || !NO_COPY)('a project named `cdk.out`', () => {
  it('its kept slot is `slot.cdk.out-…`, so the operator\'s `cdk.out*` sweep at depth 2 never matches it', () => {
    expect(h.sh('_ws_project_valid cdk.out && echo legal'), 'the CONTROL: the name is legal').toBe('legal');
    const id = 'cdk.out-calm-mesa';
    orphanLeaf(h, id);
    const target = path.join(tmpRootOf(h), 'demo-quiet-river', 'cdk.out');   // the sweep's own kind of target
    fs.mkdirSync(target, { recursive: true });
    collectVerb(h, tokenOf(h, id), id, crashAt('moved'));
    expect(crashedAt(h), 'the CONTROL: killed with the leaf in its slot').toBe('moved');
    // Everything in the quarantine, and the sweep's own target, made old enough for `-mmin +60`: only a NAME can
    // keep an entry out of the sweep now.
    const old = new Date(Date.now() - 2 * 3_600_000);
    for (const n of fs.readdirSync(quarantineOf(h))) fs.utimesSync(path.join(quarantineOf(h), n), old, old);
    fs.utimesSync(target, old, old);
    // The operator's unit, verbatim but for `-exec rm -rf` (here `-print`) and `%U` (here this uid).
    const swept = h.sh('find "$HOME/.cc-tmp" -mindepth 2 -maxdepth 2 -type d -name \'cdk.out*\' -user "$(id -u)" -mmin +60 -print')
      .split('\n').filter(Boolean);
    expect(swept, 'the sweep finds its own target, and never the slot').toEqual([target]);
    const slots = slotsOf(h, id);
    expect(slots, 'one slot, named `slot.<id>.<ns>.<pid>`').toHaveLength(1);
    expect(slots[0]).toMatch(/^slot\.cdk\.out-calm-mesa\.[0-9]+\.[0-9]+$/);
    const rounds = settle(h, id);
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(slotsOf(h, id)).toEqual([]);
  }, 240_000);
});
```

- [ ] **Step 7: Write the recycled-admin suite**

git prunes and recycles the admin name for real, inside the gaps. This was measured with git in a scratch directory while the task was drafted. After `worktree prune` drops the moved tree's admin directory, a `worktree add` at `<id>/still-harbor` re-creates `worktrees/still-harbor` with the back-link `<id>/still-harbor/.git`, the pre-move spelling. The leaf's own `wt` case re-creates `worktrees/wt` with the very back-link value the pre-move ask accepted.

Create `server/test/ccd-collect-race-admin.test.ts`:

```ts
// THE RECYCLED ADMIN NAME, THROUGH THE WHOLE VERB (child-workspace reclamation wave 7, spec 2026-09-22 §5.6). After
// the move, a linked worktree inside the leaf still names its admin directory, whose `gitdir` back-link spells the
// PRE-move path, so the removal helper would refuse the leaf's own tree in the slot. The collector passes an ALIAS —
// the pre-move path and the admin=back-link pairs its pre-move ask accepted, from the record — under which such a
// back-link counts as the leaf's own ONLY when (1) the pre-move ask in this lock accepted that same admin directory
// with that same back-link, and (2) nothing stands at the pre-move spelling now. Measured at the wave's pre-flight:
// without both, a recycled admin name passes, and a moved foreign worktree's uncommitted work is deleted. Here git
// prunes and recycles the admin name for real, inside the gaps, and the verb must refuse — kept, never removed.
// FIXTURE HOME ONLY (`collectRaceFixture.ts`): every repository is under the harness's HOME. Linux only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import {
  COL_ID, LINUX, NO_COPY, collectVerb, devinoOf, docOf, g2Row, g2Spawn, gapAt, gapErrorsOf, orphanLeaf,
  quarantineOf, recordsOf, slotsOf, tokenOf,
} from './collectRaceFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-admin-'); });
afterEach(() => { h.cleanup(); });

/** The one slot's leaf, after a refusal kept it. */
const keptLeaf = (): string => {
  const slots = slotsOf(h);
  expect(slots, 'one slot is kept').toHaveLength(1);
  expect(recordsOf(h), 'with its record').toEqual([slots[0]!.slice('slot.'.length)]);
  return path.join(quarantineOf(h), slots[0]!, 'leaf');
};

describe.skipIf(!LINUX || !NO_COPY)('the checkout question across the move', () => {
  it('the CONTROL: the leaf\'s OWN linked worktree goes with it — the alias is passed, and both conditions hold', () => {
    const o = orphanLeaf(h);
    const main = h.makeRepo('demo2');
    h.git(main, 'worktree', 'add', '-q', '-b', 'ws/g1', path.join(o.leaf, 'wt'));
    const r = collectVerb(h, tokenOf(h), COL_ID);
    expect(docOf(r.stdout)['collected'], r.stdout).toBe(COL_ID);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(devinoOf(o.leaf)).toBeNull();
    expect(slotsOf(h)).toEqual([]);
    expect(recordsOf(h)).toEqual([]);
  }, 240_000);

  it('the MEASURED case: a foreign worktree with uncommitted work moved in after the pre-move ask, its admin name pruned and recycled at the pre-move spelling — refused, KEPT (condition 1)', () => {
    const o = orphanLeaf(h);
    const main = h.makeRepo('demo2');
    const xwt = path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
    fs.mkdirSync(path.dirname(xwt), { recursive: true });
    h.git(main, 'worktree', 'add', '-q', '-b', 'ws/x', xwt);
    fs.writeFileSync(path.join(xwt, 'precious.txt'), 'uncommitted work of another session\n');
    const admin = h.git(xwt, 'rev-parse', '--absolute-git-dir');
    // `slotted`: after the pre-move ask, the session's tree is moved INTO the leaf, and git prunes its record.
    const moveIn = `mv -T -- "${xwt}" "${o.leaf}/still-harbor" && git -C "${main}" worktree prune`;
    // `proven`: the recycled slug's child re-takes the admin NAME at the pre-move spelling, then drops its own tree,
    // so condition (2) holds and (1) alone must refuse.
    const recycle = `${g2Row()} && ${g2Spawn(COL_ID, '')} && git -C "${main}" worktree add -q -b ws/g2 "${o.leaf}/still-harbor"`
      + ` && rm -rf -- "${o.leaf}/still-harbor"`;
    const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ slotted: moveIn, proven: recycle }));
    expect(gapErrorsOf(h), 'the CONTROL: both injections ran').toEqual([]);
    expect(fs.readFileSync(path.join(admin, 'gitdir'), 'utf8').trim(),
      'the CONTROL: the admin name was recycled, its back-link the pre-move spelling').toBe(`${o.leaf}/still-harbor/.git`);
    expect(fs.existsSync(path.join(o.leaf, 'still-harbor')), 'the CONTROL: nothing stands at the pre-move spelling').toBe(false);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['collected'], r.stdout).toBeUndefined();
    expect(docOf(r.stdout)['refused'], r.stdout).toBe('quarantine-kept');
    expect(fs.readFileSync(path.join(keptLeaf(), 'still-harbor', 'precious.txt'), 'utf8'),
      'the session\'s uncommitted work survives').toBe('uncommitted work of another session\n');
  }, 240_000);

  it('the leaf\'s OWN worktree, its admin name re-taken by a recycled spawn at the pre-move spelling with the SAME back-link — refused, KEPT (condition 2)', () => {
    const o = orphanLeaf(h);
    const main = h.makeRepo('demo2');
    h.git(main, 'worktree', 'add', '-q', '-b', 'ws/g1', path.join(o.leaf, 'wt'));
    fs.writeFileSync(path.join(o.leaf, 'wt', 'g1.txt'), 'the dead child\'s own scratch\n');
    const admin = h.git(path.join(o.leaf, 'wt'), 'rev-parse', '--absolute-git-dir');
    const recycle = `git -C "${main}" worktree prune && ${g2Row()} && ${g2Spawn(COL_ID, '')}`
      + ` && git -C "${main}" worktree add -q -b ws/g2 "${o.leaf}/wt"`;
    const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ proven: recycle }));
    expect(gapErrorsOf(h), 'the CONTROL: the recycle ran').toEqual([]);
    expect(fs.readFileSync(path.join(admin, 'gitdir'), 'utf8').trim(),
      'the CONTROL: the same admin directory and back-link the pre-move ask accepted').toBe(`${o.leaf}/wt/.git`);
    expect(fs.existsSync(path.join(o.leaf, 'wt', '.git')), 'the CONTROL: the recycled tree stands at the pre-move spelling').toBe(true);
    expect(docOf(r.stdout)['refused'], r.stdout).toBe('quarantine-kept');
    expect(fs.readFileSync(path.join(keptLeaf(), 'wt', 'g1.txt'), 'utf8'), 'the kept tree is whole').toBe('the dead child\'s own scratch\n');
    expect(fs.existsSync(path.join(o.leaf, 'wt', '.git')), 'and the recycled tree is untouched').toBe(true);
  }, 240_000);
});
```

- [ ] **Step 8: Write the three scan pins**

These are static scans, plus one behavioural case. They were measured green on `b0647d850` (11 of 11), and each mutation in Step 12's last six rows was measured red there. The writer scan is anchored at the registry, because `ccd/ccd-account-auth:506` (`grep -n 'exec 9<>"$AUTH_RUN/in.child"' ccd/ccd-account-auth`) writes a FIFO named `in.child` that is not the marker.

Create `server/test/ccd-collect-recycle-pins.test.ts`:

```ts
// THE RECYCLED-SLUG PROOF'S THREE PREMISES, PINNED BY SCAN (child-workspace reclamation wave 7, spec 2026-09-22
// §5.6). The collector's proof that no spawn on a recycled slug can lose its leaf rests on three facts about the code
// that HANDS a leaf out.
// Each is one line a later change could quietly break, so each is scanned for, each scan is measured against planted
// lines (the CONTROL below), and each is measured red under mutation (the plan's table):
//   1. ONE TMPDIR COMPOSER. `_child_tmpdir` is called from ONE line, in `_spawn_start`, which composes the child's
//      TMPDIR from its answer; no other line composes a TMPDIR from a value, exports one, or points one under
//      `.cc-tmp`. (`ccd-child-tmpdir.test.ts` pins the FUNCTION that calls it; this pins the LINE.)
//   2. ONE `.child` WRITER. `cmd_ws_add`'s `_reg_set "$id" child …`. Nothing else writes the marker by name, by a
//      redirect or by a file verb into the registry, and every `_reg_set` whose FIELD is a variable — any of which
//      could be handed `child` — is on a reviewed census.
//   3. THE MARKER IS READ BEFORE THE MKDIR, BY DIRECT LOOKUP. `_child_tmpdir` reads `$REG/<id>.child` through
//      `_reg_get` — a path test, never a listing, so an unlistable registry cannot blind it — and answers rc 1 before
//      it makes anything.
// LITERAL PINS, and only that: a writer spelled through `eval`, a registry path held in another variable, a field
// assembled into `child` by concatenation, or a command split across a line continuation is not seen. The census in
// (2) is the backstop for the field shapes; review is the backstop for the rest.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

const REPO = path.resolve(path.dirname(CCD), '..');
const ROOTS = [path.join(REPO, 'ccd'), path.join(REPO, 'deploy')];

const walk = (dir: string, keep: (p: string) => boolean, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, keep, out);
    else if (e.isFile() && keep(p)) out.push(p);
  }
  return out;
};
/** Every shell script shipped under the roots, found by SHEBANG (`sh` or `bash`), never by a hand-kept list. */
const shellScripts = (roots: readonly string[]): string[] => roots.flatMap((r) => walk(r, (p) =>
  /^#!.*[/ ](ba)?sh(\s|$)/.test(fs.readFileSync(p, 'utf8').split('\n', 1)[0] ?? ''))).sort();
const pythonFiles = (roots: readonly string[]): string[] => roots.flatMap((r) => walk(r, (p) => p.endsWith('.py'))).sort();

/** A line as CODE: a whole-line comment is none, and a trailing ` # …` comment is cut. */
const codeOf = (line: string): string | null => (/^\s*#/.test(line) ? null : line.replace(/\s#\s.*$/, ''));
/** Every code line matching `re`, as `<file> <function>: <code>` — the function being the last `name() {` at column 0
 *  above it. */
const hits = (files: readonly string[], re: RegExp): string[] => files.flatMap((file) => {
  let fn = '(top level)';
  const out: string[] = [];
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const def = /^([A-Za-z_][A-Za-z0-9_]*)\(\)\s*\{/.exec(raw);
    if (def) fn = def[1]!;
    const code = codeOf(raw);
    if (code !== null && re.test(code)) out.push(`${path.relative(REPO, file)} ${fn}: ${code.trim()}`);
  }
  return out;
});

/** (1) A CALL of `_child_tmpdir`: its name, not followed by `()`. */
const CALLS_CHILD_TMPDIR = /\b_child_tmpdir\b(?!\(\))/;
/** (1) A TMPDIR COMPOSED FROM A VALUE: `TMPDIR=`, a quote, an expansion — the shape that puts a computed path into an
 *  environment string. A message that merely names `TMPDIR=$x` carries no quote, and a Python `b"TMPDIR="` no `$`. */
const COMPOSES_TMPDIR = /\bTMPDIR=["']\$/;
/** (1) A TMPDIR pointed under `.cc-tmp`, or exported. */
const TMPDIR_UNDER_CC_TMP = /\bTMPDIR=[^\s;]*\.cc-tmp\b|\bexport\s+TMPDIR\b/;
/** (2) The marker written BY NAME through the registry setter. */
const SETS_CHILD = /\b_reg_set\s+\S+\s+["']?child["']?(\s|$)/;
/** (2) A registry path ending `.child` as the target of a redirect or of a file verb. Anchored at the registry
 *  (`$REG`, `$_SVC_REG`, `$reg`, or a spelled `.cc-sessions`): `ccd-account-auth`'s `$AUTH_RUN/in.child` FIFO is not
 *  the marker. */
const WRITES_CHILD_PATH =
  /(>{1,2}|\b(mv|cp|ln|install|touch|tee)\b[^;&|]*?)\s*["']?(\$\{?(REG|_SVC_REG|reg)\}?|[^\s"'<>]*\.cc-sessions)\/[^\s"'<>]*\.child["']?(\s|;|$)/;
/** (2) A `_reg_set` whose FIELD is a variable. */
const VARIABLE_FIELD = /\b_reg_set\s+\S+\s+["']?\$/;

/** The four variable-field `_reg_set` calls measured at b0647d850, by the function each sits in, and why none can be
 *  handed `child`: `cmd_route` and `_route_argv_write` write a route field the route vocabulary validated first
 *  (`_route_valid`), `_pane_narrow_note` writes `<site>narrownote`, and `_route_note_floored` writes a marker every
 *  caller spells as a literal note name (`routenote…`, `swappinnote`). A new one is a possible second `.child` writer:
 *  review it, then add it here with the reason it cannot write `child`. */
const VARIABLE_FIELD_CENSUS = ['_pane_narrow_note', '_route_argv_write', '_route_note_floored', 'cmd_route'];

describe('premise 1 — ONE TMPDIR composer', () => {
  const files = shellScripts(ROOTS);

  it('the walk reaches ccd/ccd', () => {
    expect(files, 'the walk must reach the file the composer lives in').toContain(CCD);
  });

  it('`_child_tmpdir` is called from exactly ONE line, in `_spawn_start`, and that line composes the TMPDIR', () => {
    expect(hits(files, CALLS_CHILD_TMPDIR)).toEqual([
      `ccd/ccd _spawn_start: ctmp=$(_child_tmpdir "$id") && tmpenv="TMPDIR='$ctmp'"`,
    ]);
  });

  it('no other line composes a TMPDIR from a value, and none exports one or points one under `.cc-tmp`', () => {
    expect(hits(files, COMPOSES_TMPDIR)).toEqual([
      `ccd/ccd _spawn_start: ctmp=$(_child_tmpdir "$id") && tmpenv="TMPDIR='$ctmp'"`,
    ]);
    expect(hits(files, TMPDIR_UNDER_CC_TMP)).toEqual([]);
  });
});

describe('premise 2 — ONE `.child` writer', () => {
  const files = shellScripts(ROOTS);

  it('the marker is set by name at one line, in `cmd_ws_add`', () => {
    const hs = hits(files, SETS_CHILD);
    expect(hs).toHaveLength(1);
    expect(hs[0]).toMatch(/^ccd\/ccd cmd_ws_add: .*_reg_set "\$id" child "\$lc_child"/);
  });

  it('no line writes a registry `.child` path by a redirect or a file verb', () => {
    expect(hits(files, WRITES_CHILD_PATH)).toEqual([]);
  });

  it('every variable-field `_reg_set` is on the reviewed census', () => {
    expect([...new Set(hits(files, VARIABLE_FIELD).map((x) => x.replace(/^\S+ (\S+):.*$/, '$1')))].sort())
      .toEqual(VARIABLE_FIELD_CENSUS);
  });

  it('no shipped Python names a `.child` marker', () => {
    const py = pythonFiles(ROOTS);
    expect(py.length, 'the walk reached the Python helpers').toBeGreaterThan(0);
    expect(py.filter((p) => /\.child\b/.test(fs.readFileSync(p, 'utf8'))).map((p) => path.relative(REPO, p))).toEqual([]);
  });
});

describe('premise 3 — the marker is read, by direct lookup, BEFORE the mkdir', () => {
  const src = fs.readFileSync(CCD, 'utf8');

  it('`_child_tmpdir` reads `.child`, and returns on a non-child, before its one `mkdir`', () => {
    expect([...src.matchAll(/^_child_tmpdir\(\) \{/gm)], 'defined once').toHaveLength(1);
    const from = src.indexOf('\n_child_tmpdir() {');
    const code = src.slice(from, src.indexOf('\n}\n', from)).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    const read = code.indexOf('run=$(_reg_get "$id" child)');
    const judged = code.indexOf('_child_runid_valid "$run" || return 1');
    const made = code.indexOf('mkdir ');
    expect(read, 'the marker is read through `_reg_get`').toBeGreaterThan(0);
    expect(judged, 'and judged right after').toBeGreaterThan(read);
    expect(made, 'the mkdir comes after the marker is judged').toBeGreaterThan(judged);
    expect(code.match(/\bmkdir\b/g), 'one mkdir').toHaveLength(1);
  });

  it('`_reg_get` is a direct lookup — a path test, never a listing', () => {
    expect(src).toMatch(/^_reg_get\(\) \{ \[\[ -f "\$REG\/\$1\.\$2" && ! -L "\$REG\/\$1\.\$2" \]\]/m);
  });
});

describe.skipIf(process.getuid?.() === 0)('the hand-out sees `.child` whether or not the registry can be listed', () => {
  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-collect-pins-'); });
  afterEach(() => { try { fs.chmodSync(path.join(h.home, '.cc-sessions'), 0o700); } catch { /* gone */ } h.cleanup(); });

  it('at 0300 (searchable, not listable) `_child_tmpdir` still reads the marker and hands the leaf out', () => {
    const out = h.sh('_reg_set demo-calm-mesa child 9; chmod 0300 "$REG"; d=$(_child_tmpdir demo-calm-mesa);'
      + ' echo "rc=$? $d"; chmod 0700 "$REG"');
    expect(out).toBe(`rc=0 ${path.join(h.home, '.cc-tmp', 'demo-calm-mesa')}`);
  });
});

describe('the CONTROL: each scan finds the shape it names, and only that', () => {
  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-collect-pins-control-'); });
  afterEach(() => { h.cleanup(); });

  it('flags the planted writers and composers, and not the reads, the messages or the comments', () => {
    const dir = path.join(h.home, 'census-control');
    fs.mkdirSync(dir);
    const f = path.join(dir, 'planted');
    fs.writeFileSync(f, [
      '#!/usr/bin/env bash',
      'ctmp=$(_child_tmpdir "$id") && tmpenv="TMPDIR=\'$ctmp\'"',
      'x=$(_child_tmpdir "$y")',
      '# _child_tmpdir "$z"',
      '_child_tmpdir() {   # a definition',
      'export TMPDIR="$HOME/.cc-tmp/$id"',
      'shown+="carries TMPDIR=$pth"',
      '_reg_set "$id" child "$run"',
      'printf \'%s\' "$r" > "$REG/$id.child"',
      'mv -f -- "$tmp" "$REG/$id.child"',
      '[[ -e "$REG/$id.child" ]] && echo yes',
      'exec 9<>"$AUTH_RUN/in.child"',
      'echo "could not write $REG/$id.child" >&2',
      '_reg_set "$id" "$k" "$v"',
      '}',
      '',
    ].join('\n'));
    expect(shellScripts([dir])).toEqual([f]);
    const at = (re: RegExp): string[] => hits([f], re).map((x) => x.replace(/^\S+ /, ''));
    expect(at(CALLS_CHILD_TMPDIR)).toEqual([
      '(top level): ctmp=$(_child_tmpdir "$id") && tmpenv="TMPDIR=\'$ctmp\'"', '(top level): x=$(_child_tmpdir "$y")']);
    expect(at(COMPOSES_TMPDIR)).toEqual([
      '(top level): ctmp=$(_child_tmpdir "$id") && tmpenv="TMPDIR=\'$ctmp\'"', '_child_tmpdir: export TMPDIR="$HOME/.cc-tmp/$id"']);
    expect(at(TMPDIR_UNDER_CC_TMP)).toEqual(['_child_tmpdir: export TMPDIR="$HOME/.cc-tmp/$id"']);
    expect(at(SETS_CHILD)).toEqual(['_child_tmpdir: _reg_set "$id" child "$run"']);
    expect(at(WRITES_CHILD_PATH)).toEqual([
      '_child_tmpdir: printf \'%s\' "$r" > "$REG/$id.child"', '_child_tmpdir: mv -f -- "$tmp" "$REG/$id.child"']);
    expect(at(VARIABLE_FIELD)).toEqual(['_child_tmpdir: _reg_set "$id" "$k" "$v"']);
  });
});
```

- [ ] **Step 9: Run every file, and read what reds**

Run each line by itself, in the FOREGROUND, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-collect-recycle-pins.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-spawn.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-crash.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-forge.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-substrate.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-ids.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-admin.test.ts
```

Expected:
- **The pins** pass, 11 of 11. They read only premises that existed at `b0647d850`. A red there means Tasks 4, 5, 6 or 7 added a TMPDIR composer, a `.child` writer or a variable-field `_reg_set`. Each is a real finding: review it before you touch the pin.
- **Every file** passes (59 cases). The suite pins what Tasks 4, 5 and 6 built, so its red is Step 12's table.
- **When a seam point is not where these cases expect it** (Task 6 owns `_ws_collect_gap` and its points, ruling G7), these red:
  - the trace case: `expected [ … ] to deeply equal [ [ 'locked', '10001' ], … ]`;
  - an injection case: `the CONTROL: at its point: expected [ … ] to include '<point>'` (or a `gapErrorsOf`/disk assertion first);
  - a crash case: `the CONTROL: the kill fired where it was aimed: expected '' to be '<point>'`.

  Stop and report the point to the coordinator. This task adds no `ccd/ccd` line.
- **When `_ws_collect_mountinfo` does not print a path `_ws_collect_mounts_clear` opens**, every mount case reads the table as unreadable: the CONTROL reds with `expected undefined to be 'demo-calm-mesa'`. Stop and report it, as above.
- **When every case's first `tokenOf` reds** with `the CONTROL: the audit minted a token: …: expected '' to match /^[0-9a-f]{64}$/` (the audit answers `not-idle`), the audit is not judging the floor through `_ws_collect_floor_s`, the one floor function `FLOOR0` redefines (ruling G4). Stop and report it, as for any other red.
- **Any other red** is a case's expectation meeting Tasks 4, 5 and 6. Find which of the assumptions (a) through (j) listed under **Interfaces** it rests on, then STOP and report the case, its output and that assumption to the coordinator. A SAFETY suite is never loosened to fit the code. If the coordinator rules that the code is right, the case changes under a named departure in the wave-done.

- [ ] **Step 10: No `ccd/ccd` edit (ruling G7)**

The seams this suite drives, `_ws_collect_gap` (with the `proven` and `dropped` points) and `_ws_collect_mountinfo`, are Task 6's code in the COLLECT region Task 4 opened, and the entry conditions stop this task when any is missing. This task never edits `ccd/ccd`, so it re-stamps nothing and commits no seam. The step's number is kept so that Steps 11 to 13 keep theirs.

- [ ] **Step 11: Run to pass, time each file, and run the gates**

Run each file by itself, in the FOREGROUND, with a timeout of at least 600000 ms. Read each file's own wall time off vitest's `Duration` line:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-collect-recycle-pins.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-spawn.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-crash.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-forge.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-substrate.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-ids.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-admin.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-tmpdir.test.ts test/ccd-child-tmproot-witness.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-leaf-remove.test.ts test/ccd-leaf-checkouts.test.ts
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

Expected:
- PASS everywhere: 59 new cases, and the regressions unchanged.
- Each new file's `Duration` is under 500 s. If one is not, move its slowest `describe` into another new file (`ccd-collect-race-<subject>-b.test.ts`) and re-run both. Never raise a case's timeout to make a file fit.
- `typecheck-tests` is green. The new files type-check under `test/tsconfig.tests.json`, as they did against `b0647d850`'s helpers while this task was drafted.
- Record the seven durations for the wave-done.
- A case that reds only under load and passes in isolation is not called a flake until CI on the quiet box ran it. Check the PR's `select tests` summary lists the file.

- [ ] **Step 12: Mutation check**

Each row is ONE edit to `ccd/ccd`. The file is clean at this point (Task 7's commit: this task never edits it), so each edit is reverted with `git checkout -- ccd/ccd`.
- Rows naming Task 4, 5 or 6 code: locate the guard by the shared-interface call or the rule it implements, inside the collector region.
- Record the exact line you changed, before and after, in the wave-done's mutation table.
- A row that does not red is a hole. Fix the CASE, re-run that row, and commit the fix in Step 13. Never delete the row.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | In the fresh path, move `_ws_collect_record_write` and its `recorded` seam call below `_ws_collect_slot_make` and its `slotted` call | `cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-spawn.test.ts` | the trace case: `expected [ …(10) ] to deeply equal [ …(10) ]`, at the `recorded` and `slotted` rows |
| 2 | Swap R66's steps 6 and 7: the witness compare-and-drop, with its `witnessed` call, before the slot's rmdir, with its `emptied` call | same | the trace case: `expected [ …(10) ] to deeply equal [ …(10) ]`, at the `emptied` and `witnessed` rows |
| 3 | Drop the record before the witness: move `_ws_collect_record_drop`, with its `dropped` call, above the compare-and-drop | same | the trace case, at the `witnessed` and `dropped` rows |
| 4 | Delete step 5's whole slug proof: the direct `"$REG/$id.child"` lookup, the `_ws_slug_free` ask and the listing control | same | the `consented`, `recorded` and `slotted` spawn cases: `expected undefined to be 'registered'`. The verb collected the leaf the new child had adopted. `locked` stays green, because the fork's registry rung refuses it before the consent. |
| 5 | Restore without NOREPLACE: in `_ws_collect_mv`, the ONE rename both directions share (ruling G3), drop `-n` (`mv -T --no-copy`). Both directions change; only the restore meets a standing destination here | same | the `moved` case: `expected '<dev>:<ino>' not to be '<dev>:<ino>'`. The new child's EMPTY leaf was replaced by the old one. |
| 6 | Replace the witness compare-and-drop with a plain `rm -f` of `$REG/tmproots/<id>` | same | the `proven` and `removed` cases: `the new child's witness stands: expected null to be '9'` |
| 7 | Delete the witness compare-and-drop altogether | same | the straggler case: `the collected witness went with the collected leaf: expected true to be false` |
| 8 | Make the audit's population witnessed ids only: never read `$REG/tmpquarantine/` | `cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-crash.test.ts` | the DROPPED and ABSENT cases: `a standing record is never "nothing to collect": expected 'not-witnessed' not to be 'not-witnessed'`. The REWRITTEN case reds the same way after the child leaves. |
| 9 | On a resume, recompute the tree token over the slot's leaf and compare it with the record's `token=` | same | the `moved` and `proven` crash cases: `<rounds>: expected '<verdict>' to be 'not-witnessed'`. The resume never finishes: the move re-stamped the leaf's ctime. |
| 10 | Answer a record whose slot holds no leaf `quarantine-kept` | same | the `recorded`, `slotted`, `removed`, `emptied` and `witnessed` crash cases: `<rounds>: expected 'quarantine-kept' to be 'not-witnessed'` |
| 11 | In the resume's re-proof (the function the audit and the verb share), skip the slot leaf's dev, ino and btime comparison with the record | `cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-forge.test.ts` | the FORGED SLOT LEAF case: `<rounds>: expected '<verdict>' to be 'quarantine-kept'`, and then the planted tree is gone |
| 12 | Retired by ruling G5: the record carries no `slot=`, so there is no body path to take, and the OUTSIDE case is deleted. The number is kept so that the other rows keep theirs. | — | — |
| 13 | In `_ws_collect_record_read`, drop the check that `id=` equals the file name's id | same | the COPIED case: `the id in the body is not the id in the name: expected '<verdict>' to be 'quarantine-kept'` |
| 14 | In `_ws_collect_record_read`'s caller at the audit, read rc 2 (malformed) as rc 1 (absent) | same | the MALFORMED case: `<rounds>: expected '<verdict>' to be 'quarantine-kept'` (the audit judged the leaf and minted a token) |
| 15 | Add a slot listing to the audit's population: each `Q/slot.<id>.<ns>.<pid>` with no record is resumed by its own leaf's identity | same | the FORGED SLOT case: `ENOENT … precious.txt`. The unrecorded slot was taken. |
| 16 | Prove the move by `mv`'s exit status: in `_ws_collect_move`, return 0 when `_ws_collect_mv` answers 0, before `_ws_collect_ident` is asked of `<slot>/leaf` | same | the REACHED-THE-SLOT case: `the move was never proven: expected [ …, 'moved', … ] not to include 'moved'`. The FILE and LINK cases red too: `nothing that is not the witnessed directory is taken: …: expected 'demo-calm-mesa' to be undefined` (the swapped-in entry reached `_ws_leaf_remove`'s link/file arm and was unlinked), or `expected '<word>' to be 'quarantine-kept'`. |
| 17 | In the resume's re-proof, accept a slot leaf that is not a real directory | same | the REACHED-THE-SLOT case: `every later audit lists it and takes nothing: expected [ '<verdict>', … ] to deeply equal [ 'quarantine-kept' ]` |
| 18 | Drop `--no-copy` from `_ws_collect_mv` (ruling G3: one function, so both directions change; the EXDEV case fails at the forward move) | `cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-substrate.test.ts` | the EXDEV case: `nothing was copied into the quarantine: expected [ …(n) ] to deeply equal []` |
| 19 | Delete the audit's `mv --no-copy` presence check (its `_ws_collect_mv_ok` call) | same | the AUDIT case: `expected 0 to be 1` |
| 20 | Delete the in-lock `mv --no-copy` presence check (its `_ws_collect_mv_ok` call before the record; `_ws_collect_move`'s own check then refuses after it) | same | the VERB case: `refused inside the lock BEFORE the record: expected [ 'locked', 'consented', 'recorded', … ] not to include 'recorded'` |
| 21 | Delete step 5's mount check | same | the `leaf/sub` and `leaf` cases: `expected 'demo-calm-mesa' to be undefined` |
| 22 | Read a mount table that cannot be read as an empty one | same | the unreadable case: `expected 0 to be 1` |
| 23 | Compare a mount point with the slot's leaf by raw string prefix, with no `/` boundary | same | the CONTROL: `expected undefined to be 'demo-calm-mesa'` (the mount at `<slot>/leaf2` read as under the leaf) |
| 24 | In `_ws_collect_records_of`, match `"$REG/tmpquarantine/$id".*` by prefix | `cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-ids.test.ts` | the records case: `A has no record: B's is not one of A's: expected '…/p-calm-mesa.v2-quiet-river.<ns>.<pid>' to be ''` |
| 25 | Loosen the temp-file pattern to `^\.<id>\..*\.tmp$` | same | the temp-file case: `only A's stale temp file went: expected [ …(2) ] to deeply equal [ …(4) ]` |
| 26 | Drop the one-hour age test from the temp-file reap | same | the temp-file case: `only A's stale temp file went: expected [ …(3) ] to deeply equal [ …(4) ]` |
| 27 | Delete step 5's listing control: the wildcarded listing of `$REG` that must show the held `.reap-<id>.lock` | same | the 0300 row case: `expected 0 to be 1`. The leaf was collected while a row stood. |
| 28 | Delete step 5's direct lookup of `"$REG/$id.child"` (keep `_ws_slug_free` and the listing control) | same | the blind-`_ws_slug_free` case: `expected undefined to be 'registered'` |
| 29 | Name the slot `Q/<id>.<ns>.<pid>`, without the `slot.` prefix | same | the `cdk.out` case: `the sweep finds its own target, and never the slot: expected [ …(2) ] to deeply equal [ '…/demo-quiet-river/cdk.out' ]` |
| 30 | At step 6, pass `_ws_leaf_remove` no alias | `cd server && ./node_modules/.bin/vitest run test/ccd-collect-race-admin.test.ts` | the CONTROL: `expected undefined to be 'demo-calm-mesa'`. The leaf's own worktree was refused after the move. |
| 31 | Drop the alias's condition (1), "the same admin directory with the same back-link value was accepted by the pre-move ask" | same | the MEASURED case: `expected 'demo-calm-mesa' to be undefined`. The session's uncommitted work was deleted. |
| 32 | Drop the alias's condition (2), "`_ws_reclaim_absent` proves nothing stands at the pre-move spelling" | same | the condition-2 case: `expected undefined to be 'quarantine-kept'` |
| 33 | In `cmd_ensure`, add the line `  : "$(_child_tmpdir "$id")"` directly under `cmd_ensure() {` | `cd server && ./node_modules/.bin/vitest run test/ccd-collect-recycle-pins.test.ts` | `` `_child_tmpdir` is called from exactly ONE line…``: `expected [ …(2) ] to deeply equal [ Array(1) ]` (measured at `b0647d850`) |
| 34 | In `_spawn`, add the line `  export TMPDIR="$HOME/.cc-tmp/$1"` directly under `_spawn() {` | same | `no other line composes a TMPDIR…`: `expected [ …(2) ] to deeply equal [ Array(1) ]` (measured) |
| 35 | In `cmd_ws_restore`, add the line `  _reg_set "$id" child "$run"` directly under `cmd_ws_restore() {` | same | `the marker is set by name at one line…`: `expected [ …(2) ] to have a length of 1 but got 2` (measured) |
| 36 | In `cmd_ws_restore`, add the line `  printf '%s' "$run" > "$REG/$id.child"` instead | same | `no line writes a registry .child path…`: `expected [ Array(1) ] to deeply equal []` (measured) |
| 37 | In `cmd_ws_restore`, add the line `  _reg_set "$id" "$k" "$v"` instead | same | `every variable-field _reg_set is on the reviewed census`: `expected [ '_pane_narrow_note', …(4) ] to deeply equal [ '_pane_narrow_note', …(3) ]` (measured) |
| 38 | In `_child_tmpdir`, move `run=$(_reg_get "$id" child)` and `_child_runid_valid "$run" \|\| return 1` below the `if … fi` that holds the `mkdir` | same | `the mkdir comes after the marker is judged: expected <n> to be greater than <m>` (measured: `expected 190 to be greater than 528`). `ccd-child-tmpdir.test.ts`'s "rc 1 for a row with no marker, and creates NOTHING" reds with it. |

Three guards have no row of their own, and each is named so its absence from the table is a decision, not an oversight:
- The `locked` spawn case asserts `registered` (ruled, T8 OPEN5). The fork's registry rung answers before the token is compared, so deleting the comparison leaves the case green; deleting the rung reds it with `state-changed` (the new child's witness rewrite changes the token), and that rung is Task 5's to pin by its own mutation.
- The SPLIT case's NOREPLACE is row 5's guard. Its new leaf is not empty, so a replacing `mv -T` fails ENOTEMPTY there by itself.
- The `cdk.out` case's slot-name regex is row 29's guard, asserted after the sweep so that the sweep's own red comes first.

After the last row, `git checkout -- ccd/ccd`, then:

```bash
git diff --quiet -- ccd/ccd && echo clean
node shared/mark.mjs --check ccd/ccd
```

Expected: `clean`, and `mark.mjs --check` exits 0.

- [ ] **Step 13: Commit**

```bash
git add server/test/collectRaceFixture.ts server/test/ccd-collect-race-spawn.test.ts \
  server/test/ccd-collect-race-crash.test.ts server/test/ccd-collect-race-forge.test.ts \
  server/test/ccd-collect-race-substrate.test.ts server/test/ccd-collect-race-ids.test.ts \
  server/test/ccd-collect-race-admin.test.ts server/test/ccd-collect-recycle-pins.test.ts
git commit -m "$(cat <<'MSG'
test(ccd): the collector's race and crash suite, and R67's three scan pins

A recycled-slug spawn is forced into every step boundary of ws-collect,
and each case reads what stands on disk. Before the move, the leaf goes
back whole to the child that adopted it. After the move, the new child's
new inode and its witness are never touched. A SIGKILL after each step
leaves a record the next audit finds, whatever the witness says, and
the resume removes only the record's own inode. Forged records and slots
are kept and listed. A file or a link swapped in at the id is never
unlinked. EXDEV and a mv without --no-copy copy nothing. A mount under
the slot's leaf sends it back. A nested id, an unlistable registry and
a cdk.out project are never mistaken. A recycled admin name never makes
a moved foreign worktree the leaf's own.

The three premises the proof rests on are pinned by scan: one TMPDIR
composer, one .child writer, and the marker read before the mkdir.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: Review 346's prose (F1, F2, F3) and review 341's pins (F4, F5, F6, F7)

**Model routing:** **`sonnet`, effort `high`**. The ccd edits are comments only, and this task proves that mechanically. The pins add no guard: each one pins a guard wave 6 already shipped, and the mutation table shows each pin reds.

**Why:** Contract R70 carries two sets of wave 6 residue into this wave. Neither set changes any shipped behaviour.

- **Review 346's prose.** Three sentences in shipped ccd comments are wider than the code. The worker copied each faithfully from the wave-6 rulings, and each is a wrong sentence, never a wrong act.
  - **F1.** `_ws_dir_physical`'s header lists three bare `$(cd … && pwd -P)` captures, and the list reads as the full set. It is not the full set: `_ws_leaf_remove`'s own `lreal` and rung 9's `wdreal` are bare too, and so are captures further out. The header also says every named capture "makes the containment proof refuse". That is not true of the pin's `wdreal` or rung 9's, which are only label prefixes.
  - **F2.** `_ws_leaf_read_small`'s "only a back-linked tree passes" holds OUTSIDE the leaf only. An admin directory that resolves inside the leaf passes before any back-link is read (`_ws_leaf_checkout_one`'s INSIDE THE LEAF return). This is safe, because the removal takes that whole tree with the leaf.
  - **F3.** The same header says an inner NUL "splits it, unmeasured". That is true for the `.git` file caller only. For the back-link caller (`$adp/gitdir`), an inner NUL leaves an embedded newline that no compare matches, so the answer is REFUSED (rc 1), not unmeasured.
  - The wave-6 plan carries F1's and F2's sentences too (wave-6 plan :9450, :9452, :9589-9592 at `b0647d850`). **That plan is merged and immutable.** This task does not edit it. The correction is recorded in THIS plan's `## Deviations found` under the slug `wave6-plan-prose-scoped`. The coordinator defines that entry in this plan's Deviations at the fix round (ruling T9 DEP1, accepted), from the text Step 7 below hands it. F3 has no plan twin: the plan's inner-NUL sentence sits in the `.git` file bullet, where it is true.
- **Review 341's pins.** Each is a shipped guard that no case reds when it is deleted.
  - **F4.** `_ws_dir_physical`'s `unset -f builtin cd pwd printf` has no pin for a WRITABLE function named `builtin`. The shipped CONTROL shadows only `cd`, `pwd` and `printf`, which the `builtin` keyword already gets past. The shipped sentinel case plants a READONLY `builtin`, which `unset -f` cannot remove.
  - **F5.** The done document's CLIPS default arm (`(*) echo '"unmeasured"'`) is unpinned. The odd-word case swaps only `tmpkept`. The ruling's text names that existing case ("the odd-word case swaps `clipskept` too"), so this pin is a two-line edit of that case, not a new 90 s case (ruling T9 OPEN3, accepted).
  - **F6.** `_ws_leaf_read_small`'s `[[ -f "$f" ]]` guard has no case on the back-link read. The shipped FIFO case puts the FIFO at `.git` itself, and `_ws_leaf_checkout_one`'s own `! -f` arm answers that first. With the guard deleted, a FIFO at an OUTSIDE admin directory's `gitdir` blocks `wc -c` until killed (measured: rc 2 in 96 to 273 ms at the tip; a hang under the mutant). The new case runs the ask under `BOUNDED`, so a red is a fast fail, never a wedged suite.
  - **F7.** Wave 6's mutation row 17 ("no outranking") reds its case only because of this ext4's directory-hash order. The walk lists `z`, `a`, `m`. With the moved tree under `parked` or `h`, the mutant stays green. The new pin fixes the walk order with a `find` shim, as the timeout case does (`ccd-leaf-checkouts.test.ts:312`, `grep -n 'Only THIS walk hangs' server/test/ccd-leaf-checkouts.test.ts`), and lists the refusal first, between and last.

**Files:**
- Modify: `ccd/ccd`. Comments only, in two places, both BELOW the frozen boundary `ccd/ccd:19109`. The line count may change there (Step 4 measures that no line at or above 19109 changed apart from the line-2 stamp). Line numbers are hints at `b0647d850`, because Tasks 1-8 move them. Locate each edit by its grep:
  1. `_ws_dir_physical`'s header sentence (ccd/ccd:28812-28816; `grep -n 'Other bare$' ccd/ccd`, one hit, inside `grep -n '^_ws_dir_physical() {' ccd/ccd`, :28802).
  2. `_ws_leaf_read_small`'s header (ccd/ccd:29131-29136; `grep -n 'only a back-linked tree passes' ccd/ccd`, one hit, inside `grep -n '^_ws_leaf_read_small() {' ccd/ccd`, :29129).
- Modify: `server/test/ccd-child-reclaim-done-kept.test.ts`. Edit the odd-word case in place (:167-181; `grep -n 'tmpkept=odd-word' server/test/ccd-child-reclaim-done-kept.test.ts`, :175).
- Modify: `server/test/ccd-leaf-checkouts.test.ts`. Add ONE comment line above the case at :167 (`grep -n 'a refusal OUTRANKS an unmeasured entry' server/test/ccd-leaf-checkouts.test.ts`). The line points at the order-fixed pin. The case keeps its old title and fixture (ruling T9 OPEN4: keep the old title, and add the pointer comment).
- Test: `server/test/ccd-dir-physical-builtin.test.ts` (new, F4).
- Test: `server/test/ccd-leaf-checkouts-pins.test.ts` (new, F6 and F7).
- NOT modified: `docs/superpowers/plans/2026-10-06-child-reclamation-wave6-reclaim-repairs.md` (immutable). Also not modified: `_ws_expire_locked` and `_ws_expire_cwd_users` (R72), and nothing above `ccd/ccd:19109` apart from the stamp.

**Interfaces:**
- Consumes (at `b0647d850`; Tasks 1-8 may move the lines, never these contracts):
  - `_ws_dir_physical <dir>`: rc 0 sets `_WS_PHYS` to the physical path. rc 1 sets `_WS_PHYS_WHY` and leaves `_WS_PHYS` empty. ccd/ccd:28802.
  - `_ws_leaf_read_small <file>`: rc 0 sets `_WS_SMALL`, with each NUL read as a newline. rc 1 means not a regular file, or unreadable. rc 2 means more than 4096 bytes. ccd/ccd:29129.
  - `_ws_leaf_checkout_one <leaf-physical> <.git-entry> [<alias> <accepted>]`: rc 0 own, 1 refused, 2 unmeasured, with `_WS_CHECKOUTS_WHY`. ccd/ccd:29150. Task 4 adds the two trailing parameters (ruling G8); this task never passes them.
  - `_ws_leaf_checkouts <leaf> [<alias> <accepted>]`: rc 0, 1 or 2, with `_WS_CHECKOUTS_WHY`. ccd/ccd:29213. Task 4 adds the trailing alias and the accepted `admin=back-link` list (`_WS_CHECKOUTS_ACCEPTED`'s grammar; ruling G8). This task never passes them, so it asks the unchanged path every other caller uses.
  - The tail's done `printf`, with its two `case` arms (ccd/ccd:30118-30119; `grep -n 'case "\$clipskept" in' ccd/ccd`), and `_ws_tombstone_patch "$id" "{\"residueBytes\":…}"`, called from `_ws_reclaim_tail` (ccd/ccd:30070; `grep -n 'residueBytes\\":\$residue' ccd/ccd`).
  - Test side:
    - `makeCcdHarness`, `type CcdHarness`, `BOUNDED` and `CCD` (`server/test/ccdWsHelpers.ts`). `BOUNDED` runs `<secs> <argv…>` and kills the child's whole process group on the alarm, exiting 142.
    - `inheritedEnv` (`server/test/gitEnvStrip.js`).
    - In the existing done-kept file: `makePrHarness` (built on `makeCcdHarness`, so it uses a fixture HOME), `childReclaimVerb`, `evalOf`, `makeChild` and `CHILD_ID` (`server/test/childReclaimFixture.ts`), and `eventsOf` and `measOf` (`server/test/lifecycleHelpers.ts`).
- Produces:
  - No new ccd function, variable or word. The two ccd edits are comment-only, proven by `declare -f` equality (Step 4).
  - `server/test/ccd-dir-physical-builtin.test.ts`: the writable-`builtin` pin (F4).
  - `server/test/ccd-leaf-checkouts-pins.test.ts`: the FIFO back-link pin under `BOUNDED` (F6), and the order-fixed outrank pin through a `find` shim (F7).
  - The odd-word case in `ccd-child-reclaim-done-kept.test.ts` now swaps BOTH kept words (F5).
  - For the coordinator, at the fix round (ruling T9 DEP1): the text of the Deviations entry `wave6-plan-prose-scoped` (Step 7). The worker writes no number and no `D-` token.

- [ ] **Step 1: Correct `_ws_dir_physical`'s header (F1)**

  In `ccd/ccd`, inside `_ws_dir_physical`, replace exactly these lines:

  ```bash
  # removal took `<vol>/<id>` and both probes answered "nobody". Other bare
  # captures on removal paths stay bare and fail closed (a truncated root makes
  # the containment proof refuse): the tail's `wdreal`,
  # `_ws_reclaim_nested_proven`'s `real` and the pin's `wdreal`. So this is
  ```

  with:

  ```bash
  # removal took `<vol>/<id>` and both probes answered "nobody". This speaks
  # for its eight callers only. Bare captures stand elsewhere, and the ones
  # named here are examples, not a census. Some fail closed: the tail's
  # `wdreal` and `_ws_reclaim_nested_proven`'s `real` (a truncated root makes
  # the containment proof refuse), and `_ws_leaf_remove`'s `lreal` (it must
  # equal the leaf, or the leaf is refused). Others are LABEL PREFIXES only,
  # never a path acted under: the pin's `wdreal` and rung 9's, which name a
  # nested checkout's paths relative to the workdir; any refusal comes later,
  # from the tail's containment proof. So this is
  ```

  The next line (`` # `_ws_reclaim_resolve`'s own entry, exactly: POSIX mode by ASSIGNMENT, ``) stays as it is. If an earlier task of this wave already reworded this sentence, keep that wording and apply only this scoping: the sentence speaks for the eight callers (Task 4's 4B made the census eight, adding `_ws_collect_qdir`), the names are examples, and the two `wdreal`s are label prefixes. Report it in the wave-done.

- [ ] **Step 2: Correct `_ws_leaf_read_small`'s header (F2, F3)**

  In `ccd/ccd`, inside `_ws_leaf_read_small`, replace exactly these lines:

  ```bash
  # answers 1). A NUL becomes a newline, never dropped: INSIDE a line it splits
  # it, unmeasured; a TRAILING one is a line end the caller strips, so `gitdir:
  # A\0` and `gitdir: A\n\0` both read as A. Git reads the second as `A\n` and
  # fails; ccd answers measured, safely: only a back-linked tree passes.
  ```

  with:

  ```bash
  # answers 1). A NUL becomes a newline, never dropped. What an INNER one means
  # is each caller's: in the `.git` file it splits the line, unmeasured; in an
  # admin directory's `gitdir` back-link it leaves a newline no compare
  # matches, so the tree is refused. A TRAILING one is a line end each caller
  # strips, so `gitdir: A\0` and `gitdir: A\n\0` both read as A. Git reads the
  # second as `A\n` and fails; ccd answers measured, safely: an A inside the
  # leaf passes before any back-link is read (removing the leaf removes all of
  # it), and outside the leaf only a tree git back-links passes
  # (`_ws_leaf_checkout_one` says which back-links count).
  ```

  The two lines above it (`# A FILE READ AS A FILE, bounded: …` and `# before the bytes, …`) stay as they are. If Task 4's alias wording already sits in `_ws_leaf_checkout_one`'s OUTSIDE IT comment, the pointer above covers it. Do not enumerate the alias here.

  These sentences cite no contract and no review (R23).

- [ ] **Step 3: Re-stamp, then check the stamp and ownership**

  ```bash
  bash ccd/ccrc restamp ccd/ccd
  node shared/mark.mjs --check ccd/ccd
  bash -n ccd/ccd && echo syntax-ok
  cd server && ./node_modules/.bin/vitest run test/ownership.test.ts
  ```

  Expected: `mark.mjs` exits 0 (`ccrc-unmodified`), `syntax-ok` prints, and `ownership` is green.

- [ ] **Step 4: Prove the ccd edit comment-only and below the boundary**

  ```bash
  # (a) every changed line is a comment (the line-2 stamp is one too)
  git diff -U0 -- ccd/ccd | grep -E '^[-+]' | grep -vE '^(\+\+\+|---) ' | grep -vE '^[-+][[:space:]]*#' \
    && echo 'NON-COMMENT LINE CHANGED' || echo comment-only
  # (b) no hunk at or above the frozen boundary except the stamp
  git diff -U0 -- ccd/ccd | awk '/^@@/{split($2,a,","); n=substr(a[1],2)+0; if (n!=2 && n<=19109) print "AT OR ABOVE 19109: " $0}'
  # (c) the two functions' bodies are identical (declare -f drops comments); never sources ccd/ccd, so no HOME is touched
  SCR=$(mktemp -d)
  git show HEAD:ccd/ccd > "$SCR/ccd.base"; cp ccd/ccd "$SCR/ccd.work"
  for rev in base work; do for fn in _ws_dir_physical _ws_leaf_read_small; do
    awk -v fn="$fn" '$0 ~ "^"fn"\\(\\) \\{" {f=1} f{print} f && /^\}/{exit}' "$SCR/ccd.$rev" > "$SCR/$fn.$rev.sh"
    env -i bash --norc --noprofile -c "source '$SCR/$fn.$rev.sh'; declare -f $fn" > "$SCR/$fn.$rev.decl"
  done; done
  for fn in _ws_dir_physical _ws_leaf_read_small; do cmp "$SCR/$fn.base.decl" "$SCR/$fn.work.decl" && echo "$fn: body unchanged"; done
  cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'
  ```

  Expected:
  - (a) prints `comment-only`.
  - (b) prints nothing.
  - (c) prints `_ws_dir_physical: body unchanged` and `_ws_leaf_read_small: body unchanged`.
  - The citation case is green. Nothing at or above 19109 moved, so its frozen corpus is untouched. If it reds, STOP and report: a frozen-corpus census is never adjusted here.

  Then run the suites these helpers serve, in the FOREGROUND with each call under 600 s:

  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccd-leaf-root-newline.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccd-leaf-checkouts.test.ts
  ```

  Expected: both are green and unchanged.

- [ ] **Step 5: Commit the prose**

  ```bash
  git add ccd/ccd
  git commit -m "$(cat <<'MSG'
  docs(ccd): scope three helper comments to what the code does

  _ws_dir_physical's header spoke as if its three named bare captures were
  the whole set. It now speaks for its eight callers only, names its
  examples as examples, and says which bare captures fail closed and which
  are only label prefixes. _ws_leaf_read_small's header now says what an
  inner NUL means for each caller (unmeasured in the .git file, refused in
  the back-link), and that "only a back-linked tree passes" holds outside
  the leaf only. Comments only: both bodies are unchanged under declare -f.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  MSG
  )"
  ```

- [ ] **Step 6: Write the pins**

  **(F4)** Create `server/test/ccd-dir-physical-builtin.test.ts`:

  ```ts
  // `_ws_dir_physical` (child reclamation, spec §5.6) reads `pwd -P` through
  // `builtin`, in a subshell that first unsets every function named after a
  // command it calls: `builtin`, `cd`, `pwd`, `printf`. The `builtin` keyword
  // already gets past a function named `cd`, `pwd` or `printf`, so only the
  // unset stops a WRITABLE function named `builtin` from answering for it. A
  // READONLY one survives the unset; the newline suite's sentinel case pins
  // that, and this file pins the writable one.
  // FIXTURE HOME ONLY: every directory is under the harness's HOME.
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import fs from 'node:fs';
  import path from 'node:path';
  import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-dir-physical-builtin-'); });
  afterEach(() => { h.cleanup(); });

  /** The helper's rc, `_WS_PHYS` and `_WS_PHYS_WHY`. */
  const phys = (dir: string, pre = ''): { rc: string; phys: string; why: string } => {
    const [rc = '', p = '', why = ''] = h.sh(`${pre} _ws_dir_physical "${dir}"; rc=$?;`
      + ` printf '%s\\x1f%s\\x1f%s' "$rc" "$_WS_PHYS" "$_WS_PHYS_WHY"`).split('\x1f');
    return { rc, phys: p, why };
  };

  /** A writable `builtin` that lies for `pwd` and passes every other builtin through. */
  const LYING_BUILTIN = 'builtin() { if [[ "$1" == pwd ]]; then command printf "/elsewhere\\n";'
    + ' else command builtin "$@"; fi; };';

  describe('_ws_dir_physical — a WRITABLE function named `builtin` cannot answer for it', () => {
    it('a lying `builtin` in the caller’s shell is unset before the read: the physical path, never its lie', () => {
      const vol = path.join(h.home, 'vol');
      fs.mkdirSync(vol);
      fs.symlinkSync(vol, path.join(h.home, 'root'));
      expect(h.sh(`${LYING_BUILTIN} builtin cd -- "${vol}" && builtin pwd -P`),
        'the CONTROL: in the caller’s own shell the function is live, and lies').toBe('/elsewhere');
      const a = phys(path.join(h.home, 'root'), LYING_BUILTIN);
      expect(a.rc, a.why).toBe('0');
      expect(a.phys, 'the lying builtin was unset before the read').toBe(fs.realpathSync(vol));
      expect(a.why).toBe('');
    }, 60_000);
  });
  ```

  **(F6, F7)** Create `server/test/ccd-leaf-checkouts-pins.test.ts`:

  ```ts
  // Two pins on `_ws_leaf_checkouts` (child reclamation, spec §5.5 and §5.6).
  // (1) `_ws_leaf_read_small` tests `-f` BEFORE it opens a file, so a FIFO is
  // never opened. A FIFO at `.git` itself never reaches that guard, because
  // `_ws_leaf_checkout_one`'s own `! -f` arm answers it first. Here the FIFO
  // is an OUTSIDE admin directory's `gitdir` back-link, which is read only
  // through the helper: rc 2, at once. The ask runs under BOUNDED, so a build
  // that opens the FIFO reds in seconds and never wedges the suite.
  // (2) A refusal OUTRANKS an unmeasured entry WHATEVER ORDER the walk lists
  // them in. A `find` shim sorts the walk by name, so the refusal is listed
  // first, between and last on any file system, never by a directory hash.
  // FIXTURE HOME ONLY: every repository, leaf, FIFO and shim is under the
  // harness's HOME.
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import { execFileSync } from 'node:child_process';
  import fs from 'node:fs';
  import path from 'node:path';
  import { makeCcdHarness, BOUNDED, CCD, type CcdHarness } from './ccdWsHelpers.js';
  import { inheritedEnv } from './gitEnvStrip.js';

  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-leaf-checkouts-pins-'); });
  afterEach(() => { h.cleanup(); });

  const ID = 'demo-quiet-basin';
  const leafOf = (): string => path.join(h.home, 'root', ID);

  interface Answer { rc: string; why: string }
  const ask = (leaf: string, pre = ''): Answer => {
    const [rc = '', why = ''] = h.sh(`${pre} _ws_leaf_checkouts "${leaf}"; rc=$?;`
      + ' printf \'%s\\x1f%s\' "$rc" "$_WS_CHECKOUTS_WHY"').split('\x1f');
    return { rc, why };
  };

  /** A linked worktree of a repository OUTSIDE the leaf, then `mv`'d to `dest`: its `.git` still names the
   *  admin directory, whose `gitdir` back-link names the tree's OLD path, so the tree is refused. */
  const movedTree = (dest: string, name = 'still-harbor'): { admin: string } => {
    const main = fs.existsSync(path.join(h.home, 'projects', 'demo2')) ? path.join(h.home, 'projects', 'demo2') : h.makeRepo('demo2');
    const wt = path.join(h.home, 'worktrees', 'demo2', name);
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    h.git(main, 'worktree', 'add', '-q', '-b', `ws/${name}`, wt);
    fs.writeFileSync(path.join(wt, 'precious.txt'), 'uncommitted work of another session\n');
    const admin = h.git(wt, 'rev-parse', '--absolute-git-dir');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(wt, dest);
    expect(fs.readFileSync(path.join(dest, '.git'), 'utf8').trim(), 'the CONTROL: the moved tree names its admin dir')
      .toBe(`gitdir: ${admin}`);
    return { admin };
  };

  describe('the back-link is read only as a regular file — a FIFO there is never opened', () => {
    it('a FIFO as an OUTSIDE admin directory’s `gitdir` answers rc 2 at once — the walk never blocks on it', () => {
      const { admin } = movedTree(path.join(leafOf(), 'parked', 'still-harbor'));
      expect(ask(leafOf()).rc, 'the CONTROL: the fixture reaches the back-link read (a regular one naming another tree refuses)')
        .toBe('1');
      const back = path.join(admin, 'gitdir');
      fs.rmSync(back);
      execFileSync('mkfifo', [back]);
      expect(fs.statSync(back).isFIFO(), 'the CONTROL: a FIFO stands at the back-link').toBe(true);
      const inner = 'source "$1"; _ws_leaf_checkouts "$2"; rc=$?; printf "%s\\x1f%s" "$rc" "$_WS_CHECKOUTS_WHY"';
      const [body = '', bounded = ''] = h.sh(`${BOUNDED} 10 bash -c '${inner}' _ "${CCD}" "${leafOf()}"; printf '\\x1e%s' "$?"`)
        .split('\x1e');
      expect(bounded, 'the ask returned inside the 10 s bound — 142 means the FIFO was opened and blocked').toBe('0');
      const [rc = '', why = ''] = body.split('\x1f');
      expect(rc, why).toBe('2');
      expect(why).toContain(`${back} could not be read whole`);
    }, 60_000);
  });

  describe('a refusal OUTRANKS an unmeasured entry — in every order the walk can list them', () => {
    /** A `find` shim on PATH. THIS walk (it alone carries `-xdev` and `.git`) runs the real find, then lists its
     *  hits sorted by name (LC_ALL=C) and records that order; every other find is the real one. */
    const shimmed = (): string => {
      const realFind = execFileSync('sh', ['-c', 'command -v find'], { encoding: 'utf8', env: inheritedEnv() }).trim();
      const shim = path.join(h.home, 'shim');
      fs.mkdirSync(shim);
      fs.writeFileSync(path.join(shim, 'find'), [
        '#!/bin/sh',
        'case " $* " in *" -xdev "*" .git "*)',
        `  '${realFind}' "$@" > "$HOME/find-shim.out" || exit $?`,
        '  LC_ALL=C sort -z "$HOME/find-shim.out" > "$HOME/find-shim.order" || exit 1',
        '  exec cat "$HOME/find-shim.order" ;;',
        'esac',
        `exec '${realFind}' "$@"`,
        '',
      ].join('\n'), { mode: 0o755 });
      return `PATH="${shim}:$PATH"; hash -r;`;
    };

    it.each([['first', 'a'], ['between', 'm'], ['last', 'z']] as const)(
      'the refusal listed %s (the moved tree under `%s`), the two malformed `.git` files around it: rc 1',
      (_where, at) => {
        movedTree(path.join(leafOf(), at, 'still-harbor'));
        for (const d of ['a', 'm', 'z'].filter((n) => n !== at)) {
          fs.mkdirSync(path.join(leafOf(), d), { recursive: true });
          fs.writeFileSync(path.join(leafOf(), d, '.git'), 'not a gitdir line\n');
        }
        const a = ask(leafOf(), shimmed());
        const lp = fs.realpathSync(leafOf());
        const order = fs.readFileSync(path.join(h.home, 'find-shim.order'), 'utf8').split('\0').filter(Boolean);
        expect(order, 'the CONTROL: the shim fixed the walk’s order')
          .toEqual(['a', 'm', 'z'].map((d) => path.join(lp, d, d === at ? 'still-harbor/.git' : '.git')));
        expect(a.rc, a.why).toBe('1');
        expect(a.why).toContain(`${lp}/${at}/still-harbor/.git`);
      }, 60_000);
  });
  ```

  **(F7, the old case)** In `server/test/ccd-leaf-checkouts.test.ts`, add one line directly above `it('a refusal OUTRANKS an unmeasured entry, whichever order the walk lists them in', () => {`:

  ```ts
    // This fixture leaves the walk's order to the file system; `ccd-leaf-checkouts-pins.test.ts` fixes it, first, between and last.
  ```

  **(F5)** In `server/test/ccd-child-reclaim-done-kept.test.ts`, in the case `'a word outside the three — a value no arm names — prints \`unmeasured\`, never null'`, replace:

  ```ts
      const odd = 'eval "_t_patch_real()$(declare -f _ws_tombstone_patch | tail -n +2)";'
        + ' _ws_tombstone_patch() { [[ "${FUNCNAME[1]-}" == _ws_reclaim_tail && "${2-}" == *residueBytes* ]] && tmpkept=odd-word; _t_patch_real "$@"; };';
      const r = childReclaimVerb(h, evalOf(h).token, { pre: `${CLIPS_NOT_OURS} ${TMP_IN_USE} ${odd}` });
      expect(r.code, r.stdout + r.stderr).toBe(0);
      const doc = JSON.parse(r.stdout) as Doc;
      expect(doc['clipsKept']).toBe('refused');
      expect(measOf(doneRow('reclaim'))['tmpRootKept'], 'the CONTROL: the tail carried the odd word').toBe('odd-word');
  ```

  with:

  ```ts
      // BOTH kept words are replaced: each key has its own default arm, and each is pinned.
      const odd = 'eval "_t_patch_real()$(declare -f _ws_tombstone_patch | tail -n +2)";'
        + ' _ws_tombstone_patch() { [[ "${FUNCNAME[1]-}" == _ws_reclaim_tail && "${2-}" == *residueBytes* ]]'
        + ' && { clipskept=odd-clips; tmpkept=odd-word; }; _t_patch_real "$@"; };';
      const r = childReclaimVerb(h, evalOf(h).token, { pre: `${CLIPS_NOT_OURS} ${TMP_IN_USE} ${odd}` });
      expect(r.code, r.stdout + r.stderr).toBe(0);
      const doc = JSON.parse(r.stdout) as Doc;
      expect(measOf(doneRow('reclaim'))['clipsKept'], 'the CONTROL: the tail carried the odd clips word').toBe('odd-clips');
      expect(measOf(doneRow('reclaim'))['tmpRootKept'], 'the CONTROL: the tail carried the odd word').toBe('odd-word');
      expect(doc['clipsKept'], 'an unnamed clips value is unmeasured, never nothing kept').toBe('unmeasured');
  ```

  The case's last line (`expect(doc['tmpRootKept'], 'an unnamed value is unmeasured, never nothing kept').toBe('unmeasured');`) stays. If Tasks 1-8 moved the residue patch call out of `_ws_reclaim_tail`, or changed its `residueBytes` argument, point the predicate at the new site and say so in the wave-done.

- [ ] **Step 7: Run the pins. They are GREEN at once, because each pins a guard that already ships. The red is the mutation table's**

  In the FOREGROUND, with each call under 600 s:

  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccd-dir-physical-builtin.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccd-leaf-checkouts-pins.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-done-kept.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccd-leaf-checkouts.test.ts
  cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
  cd server && ./node_modules/.bin/vitest run test/git-env-strip.test.ts
  ```

  Expected:
  - The new F4 file has 1 passed.
  - The new F6/F7 file has 4 passed. The FIFO case finishes in well under a second of ccd time.
  - `ccd-child-reclaim-done-kept` has 8 passed.
  - `ccd-leaf-checkouts` is green and unchanged in count.
  - `typecheck-tests` is green (the new files compile).
  - `git-env-strip` is green. Both new files are in its SCOPE (Task 4, ruling G12): neither spreads `process.env`, every git call goes through `h.git`, and the F7 shim's only spawn (`execFileSync('sh', …)`) passes `inheritedEnv()`.

  A pin that is RED here is not a pin of the shipped guard. STOP and report it. Never weaken an assertion to pass.

  **Hand the Deviations text to the coordinator (it is not written by the worker).** Paste this, verbatim, into the wave-done under the slug `wave6-plan-prose-scoped`, for the coordinator to define with an issued number at the fix round (ruling T9 DEP1):

  > `wave6-plan-prose-scoped` (Task 9). The wave-6 plan (`docs/superpowers/plans/2026-10-06-child-reclamation-wave6-reclaim-repairs.md`) is merged and is not edited. Review 346 found three of its sentences too wide, and they are corrected here:
  > - "and only a tree git back-links passes" (its F2 NUL bullet) and "what passes is back-linked by git's own record" (the bullet after it) hold OUTSIDE the leaf only. An admin directory that resolves inside the leaf passes before any back-link is read (its own F1d bullet). That is safe, because the removal takes the whole tree with the leaf. Read them as "outside the leaf, only a tree git back-links passes" and "what passes outside the leaf is back-linked by git's own record; what passes inside it goes whole with the leaf".
  > - "Other captures stay bare (review 341, F3)" names three captures as if they were the set. They are examples, not a census. `_ws_leaf_remove`'s `lreal` and rung 9's `wdreal` are bare too, and so are captures further out (`_ws_realpath`'s `real`, `_ws_nested_checkouts`, `cmd_ws_rm`'s `cdir`). The tail's `wdreal`, `_ws_reclaim_nested_proven`'s `real` and `lreal` fail closed. The pin's `wdreal` and rung 9's are label prefixes only, and any refusal comes later, from the tail's containment proof.
  > - Review 346's F3 has no plan twin: the plan's inner-NUL sentence sits in the `.git` file bullet, where it is true. The ccd comments are corrected in this wave's Task 9.

- [ ] **Step 8: Mutation check, then commit**

  Before each row, save the tree: `SCR=$(mktemp -d); cp ccd/ccd "$SCR/ccd.keep"`. After each row, restore it and prove the restore: `cp "$SCR/ccd.keep" ccd/ccd && cmp "$SCR/ccd.keep" ccd/ccd`. Do this for the test files too (rows 7-8). Never use `git checkout` or `git stash` to revert. Each mutation edits ONE line, located by its grep inside the named function. `unset -f builtin cd pwd printf` has TWO hits (`_ws_reclaim_resolve` and `_ws_dir_physical`). Mutate only the one inside `_ws_dir_physical`, for example:

  ```bash
  L=$(awk '/^_ws_dir_physical\(\) \{/{f=1} f && /unset -f builtin cd pwd printf 2>\/dev\/null; /{print NR; exit}' ccd/ccd)
  sed -i "${L}s|unset -f builtin cd pwd printf 2>/dev/null; ||" ccd/ccd    # row 1
  grep -c 'unset -f builtin cd pwd printf' ccd/ccd                        # 1: the _ws_reclaim_resolve twin is untouched
  ```

  | # | Mutation (exact edit) | Command | Expected red |
  |---|---|---|---|
  | 1 | In `_ws_dir_physical` only, delete `unset -f builtin cd pwd printf 2>/dev/null; ` | `cd server && ./node_modules/.bin/vitest run test/ccd-dir-physical-builtin.test.ts` | `the lying builtin was unset before the read: expected '/elsewhere' to be '<…>/vol'` |
  | 2 | In `_ws_dir_physical` only, replace `unset -f builtin cd pwd printf` with `unset -f cd pwd printf` | same | the same red as row 1 |
  | 3 | In `_ws_leaf_read_small`, replace `[[ -f "$f" ]] \|\| return 1` with `:` | `cd server && ./node_modules/.bin/vitest run test/ccd-leaf-checkouts-pins.test.ts -t 'FIFO'` | after about 10 s: `the ask returned inside the 10 s bound — 142 means the FIFO was opened and blocked: expected '142' to be '0'`. A fast fail, never a hang |
  | 4 | In `_ws_leaf_checkouts`, replace `(( rc == 0 )) \|\| [[ -n "$why" ]] \|\| why="$_WS_CHECKOUTS_WHY"` with `(( rc == 0 )) \|\| return 2` (wave 6's row 17) | `cd server && ./node_modules/.bin/vitest run test/ccd-leaf-checkouts-pins.test.ts -t 'OUTRANKS'` | `between` and `last`: `expected '2' to be '1'`. `first` stays green, because the refusal is met before any unmeasured entry. That case is the order CONTROL, and it is why the other two exist |
  | 5 | In `_ws_leaf_checkouts`, replace `(( rc != 1 )) \|\| return 1` with `(( rc != 1 )) \|\| { [[ -n "$why" ]] \|\| why="$_WS_CHECKOUTS_WHY"; }` (a refusal demoted to unmeasured) | same | all three: `expected '2' to be '1'` |
  | 6 | In the done `printf`, on the `case "$clipskept" in` line only, replace `(*) echo '"unmeasured"' ;;` with `(*) echo null ;;` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-done-kept.test.ts -t 'a word outside the three'` | `an unnamed clips value is unmeasured, never nothing kept: expected null to be 'unmeasured'` |
  | 7 | On the same line, replace `(*) echo '"unmeasured"' ;;` with `(*) echo "\"$clipskept\"" ;;` | same | `an unnamed clips value is unmeasured, never nothing kept: expected 'odd-clips' to be 'unmeasured'` |
  | 8 | TEST self-check (F7's CONTROL): in the shim, replace the `case` arm's body with `  exec '${realFind}' "$@" ;;` (no sort, no order file) | `cd server && ./node_modules/.bin/vitest run test/ccd-leaf-checkouts-pins.test.ts -t 'OUTRANKS'` | each case: `ENOENT: no such file or directory, open '…/find-shim.order'`. The order assertion cannot pass without the shim, so a shim that stopped being used reds |
  | 9 | TEST self-check (F5): in the done-kept odd case, drop `clipskept=odd-clips; ` from the patch | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-done-kept.test.ts -t 'a word outside the three'` | `the CONTROL: the tail carried the odd clips word: expected 'refused' to be 'odd-clips'` |

  **Unpinned:**
  - Dropping `in-use` from the clips named arm is an EQUIVALENT mutant. The value falls through to the default and prints the same `"unmeasured"`, and the tail never assigns `clipskept=in-use`. No row can red it, and none is claimed.
  - Row 3 runs under `BOUNDED`. If it hangs past the vitest case timeout instead of failing at about 10 s, the bound is broken. STOP and report, and do not raise the timeout.

  Revert each mutation (restore and `cmp`), re-stamp with `bash ccd/ccrc restamp ccd/ccd`, and check `node shared/mark.mjs --check ccd/ccd` (exit 0) and `cd server && ./node_modules/.bin/vitest run test/ownership.test.ts` (green). The re-stamp must leave ccd/ccd byte-identical to the Step 5 commit (`git diff --quiet -- ccd/ccd && echo clean`). Then re-run the Step 7 commands green. Then:

  ```bash
  git add server/test/ccd-dir-physical-builtin.test.ts server/test/ccd-leaf-checkouts-pins.test.ts \
    server/test/ccd-child-reclaim-done-kept.test.ts server/test/ccd-leaf-checkouts.test.ts
  git commit -m "$(cat <<'MSG'
  test(ccd): pin four wave-6 guards that no case reddened alone

  A writable function named builtin can no longer slip past
  _ws_dir_physical unpinned: its unset is now red when dropped. A FIFO at
  an outside admin directory's gitdir back-link answers unmeasured at once,
  and the ask runs bounded, so a build that opens it fails in seconds. A
  refusal outranks an unmeasured entry in a walk whose order a find shim
  fixes, first, between and last, on any file system. The done document's
  odd-word case now swaps the clips word too, so both default arms are
  pinned.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  MSG
  )"
  ```

---

### Task 10: Docs

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`
- Modify: `docs/superpowers/programs/child-reclamation-contract.md` (append "### §14 as built (wave 7, run 347)" at the end of §14 ONLY; sections 1 to 14 are never edited)
- Modify: `README.md`, `CLAUDE.md`, `agent/CLAUDE.md`

**Interfaces:**
- Consumes: the code of Tasks 1 to 9, as built.
- Produces: the spec text every code comment of this wave cites (R23).

Write in the spec's voice. The spec cites no contract rule and carries no `D-` token. Measure every claim against the code at this branch's tip; a sentence that is not true of the code is a defect.

- [ ] **Step 1: The spec**
  - **A NEW section, §5.10 "The temp-root collector".** It states:
    - the population: witnessed ids and quarantine records;
    - the candidate rules, and which are ccd's and which the lane's;
    - the token's inputs;
    - the seven steps and the record order;
    - the restore and its lstat proof;
    - resume from the record;
    - the checkout question across the move;
    - the unmeasured answers, Darwin included;
    - the stated residuals: atime is not consulted, a nested mount's contents are not walked, a backwards clock step delays the floor, the operator's sweeper delays a CDK-using orphan's floor, the two adoption shapes, the witness writer's temp files of an unwitnessed id, and EBUSY and the same-file-system bind mount, which are unmeasured on this fleet.
  - **§5.2.** Two collectors become: `ccd-tmp-sweep`, and `ws-collect`. The witness paragraph says the collector also drops a witness, by compare-and-drop and only last. Its "a witness with no leaf is cleaned" reads "only when no quarantine record of that id stands".
  - **§5.5.** The reclaim token's generation input (X1's ccd half), and rung 8's silent-omission reading.
  - **§5.6.**
    - `_ws_reclaim_owned`'s three answers, and the `containment-refuted` failed word and the five shapes that print it.
    - The `crumb` key, and that ws-expire's pre-breadcrumb documents omit it.
    - The capped normalise reason.
    - The sentence "only the tail removes a witness" now names the collector.
    - R64's Rule 2 is NOT carried by the removal helper; the collector asks it itself.
  - **§7 item 6.** The residuals above, and review 346's corrected sentences.
  - **§8.** The waves table reads 7 (this wave), 8 (reclaim's server half) and 9 (the lane). R58's stale gate (workspace-lifecycle 3b) is met.
- [ ] **Step 2: The contract's "§14 as built" note**
  - Append one note at the end of §14, in the style of "§12 as built". It states where the code narrowed or spelled out R65 to R72.
  - Every departure named by slug in this wave gets one sentence.
  - Write each number singly, never as a range.
- [ ] **Step 3: README, CLAUDE.md and agent/CLAUDE.md**
  - CLAUDE.md's SAFETY section names the verb, beside `ws-reclaim` and `ws-expire`: "`ws-collect` is forbidden to every session too: it is the SERVER's act on an ORPHANED, WITNESSED temp root only, behind a token re-proved on the box — never a session's verb, and never run against the live host from a shell or a test."
  - agent/CLAUDE.md: the new grant, as ws-expire's was added.
  - README: the verb's paragraph beside ws-expire's, and the citation tax this wave's `shared/api.ts` insertions owe, re-pointed by content.
  - CLAUDE.md, README.md and agent/CLAUDE.md are claim-1110 paths (R72): append only, in their own region, and if the claim still lives, edit only under the agreement the brief records.
- [ ] **Step 4: Run the docs scanners**

```bash
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts \
  test/expiry-lane-prose.test.ts test/box-token-census.test.ts
```

Expected: PASS. A red names its sentence; fix the text, never the test.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md docs/superpowers/programs/child-reclamation-contract.md README.md CLAUDE.md agent/CLAUDE.md
git commit -F - <<'EOF'
docs(collect): the temp-root collector and the tail's corrections, as built

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: Whole-branch verification and the PR

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified, with one exception: if Step 3's re-measurement moves a citation census, `server/test/session-hook.test.ts` and `README.md` change, in their own `docs(census)` commit.

**Interfaces:**
- Consumes: everything Tasks 1 to 10 produced.
- Produces: the wave-7 branch, pushed, with its PR open against `main`. Landing and the deploy are the coordinator's.

- [ ] **Step 1: The FIRST full run after implementation, in the worktree, in the foreground**

This run's verdict is the wave-done's `suite:` line (worker clause 15). Record it before any fix. A red here stays `red` however many fix rounds follow.

```bash
cd server && npm ci && find test -name '*.test.ts' | wc -l
cd server && ./node_modules/.bin/vitest run --shard=1/24      # … through --shard=24/24, one call each
cd agent  && npm ci && npm run test
cd pwa    && npm ci && npm run test
```

- Run each line from the workspace root, in the FOREGROUND, with a timeout of 600000 ms, one after another. Use ONE denominator for the whole set. If a shard overruns 600 s, re-run the WHOLE set at `/48`. Run `ccrc-install` and `ccrc-doctor` by `-t` describe partitions that sum to the file.
- Record each shard's `Test Files` line, and check that their sum equals the `find` count.
- Before calling a red a break, re-run it IN ISOLATION if it is a CLAUDE.md load flake, `tmp-sweep` ("FAILS CLOSED" reds on the fleet box on an untouched `main`), a `ccd-child-reclaim-*`, `ccd-ws-expire-*` or `ccd-collect-*` suite, or this wave's real-process and real-rename suites.
- A red that a clean checkout of `origin/main` also shows is reported once as `main-red`, and left alone (worker clause 16).
- Record the wall time of every NEW suite against the 600 s ceiling. A suite at 500 s or more is named in the wave-done.

- [ ] **Step 2: Type-check, build, and the deviation and token cross-checks**

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p .
cd agent  && npx tsc --noEmit -p . 2>/dev/null || (cd agent && npm run build)
cd pwa    && npm run build
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts \
  test/single-definition.test.ts test/topology-clean.test.ts test/lifecycle-refusal-word.test.ts test/ccd-refusal-scan.test.ts
git log origin/main..HEAD --format=%B | grep -cE 'D-[0-9]'
git log origin/main..HEAD --format=%B | grep -cE '[0-9]{4} ?(–|\.\.|-) ?[0-9]{4}'
git diff origin/main...HEAD | grep -nE '^\+.*D-[0-9]+ ?(–|\.\.|-) ?(D-)?[0-9]+'
```

Expected:
- every type-check and build exits 0;
- the vitest files PASS;
- both `grep -c` lines print `0`;
- the last line prints nothing.

- [ ] **Step 3: The stamp, line-count neutrality above the boundary, and the citation tax**

```bash
node shared/mark.mjs --check ccd/ccd; echo "mark rc=$?"
git diff -U0 origin/main...HEAD -- ccd/ccd | awk '/^@@/{ split($2,o,","); split($3,n,","); os=substr(o[1],2)+0;
  oc=(o[2]==""?1:o[2]+0); nc=(n[2]==""?1:n[2]+0); if (os<=19109){ d+=nc-oc; print } } END{ print "delta above 19109: " d+0 }'
git diff --numstat origin/main...HEAD -- ccd/ccrc
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored|CITATION DEBT|README HAS ITS OWN CENSUS|THE RANGE BOUND')
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts)
```

Expected:
- `mark rc=0`;
- `delta above 19109: 0`. The printed hunks are the stamp (line 2), the entry guard, the caps line, the `ws-audit` hand-off and any LC-act line, each with equal old and new counts;
- `ccd/ccrc`'s numstat is empty: this wave never edits it;
- `ownership` and the citation cases PASS, and `session-hook.test.ts` PASSES in full.

- [ ] **Step 4: The hard boundary, and inertness**

```bash
git diff --name-only origin/main...HEAD | grep -vE '^(ccd/ccd|ccd/ccd-entry\.py|agent/src/whitelist\.ts|agent/test/|server/src/ccdargv\.ts|server/src/remote/runner\.ts|shared/api\.ts|server/test/|pwa/src/session/journalWords\.ts|pwa/test/journal-words\.test\.ts|deploy/measure-workspace-lifecycle\.py|README\.md|CLAUDE\.md|agent/CLAUDE\.md|docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design\.md|docs/superpowers/programs/child-reclamation-contract\.md)'
grep -n '^cmd_ws_[a-z_]*()' <(git show origin/main:ccd/ccd) | sed 's/^[0-9]*://' | sort > /tmp/w7-verbs-main
grep -n '^cmd_ws_[a-z_]*()' ccd/ccd | sed 's/^[0-9]*://' | sort | comm -13 /tmp/w7-verbs-main -
grep -rn "'ws-collect'" server/src | grep -v 'ccdargv.ts\|remote/runner.ts'
git diff origin/main...HEAD -- server/src/coord/schema.ts server/src/deadCoordinator.ts | head -1
git diff --name-only origin/main...HEAD -- pwa/
rm -f /tmp/w7-verbs-main
```

Expected:
- the first command prints nothing;
- the second prints exactly `cmd_ws_collect() {` plus its argv comment;
- the third prints nothing: no composer;
- the fourth prints nothing, and the fifth prints only `pwa/src/session/journalWords.ts` and `pwa/test/journal-words.test.ts`.

- [ ] **Step 5: Push, and open the PR**

```bash
git push -u origin HEAD
gh pr create --base main --title "Child reclamation wave 7: the temp-root collector (ws-collect), inert, and the reclaim tail's ccd corrections" --body-file <your body file>
```

The body lists:
- the tasks;
- the boundary;
- the suite verdict;
- each stated residual;
- each departure by slug;
- the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

It carries no box path and no docserver link.

- [ ] **Step 6: The wave-done**

Send it per the worker skill: the `suite:` and `failure:` lines, then the fingerprint, then the account. The account lists:
- each task's commit;
- every new suite's wall time;
- every mutation row, measured red then restored;
- every departure by slug;
- the stated residuals;
- the R72 overlaps as they stood at the push.

---

## Review lenses

These lenses run IN ADDITION to the held-out panel (`ccd/coordinator-skill/references/review-panel.md`), which runs as written (coordinator clause 14). The review brief names that panel.
- Every finding from these lenses gets the panel's refuters, and the majority decides.
- A lens that dies or returns nothing is unverified, never approval.
- Each reviewer reads in its own worktree, at one measured tip. The plan text the branch is held to is the blob at `planSha`.
- Every scratch case a lens runs uses fixture HOMEs only, is never committed, and never runs `ccd` against the live `$HOME`.

### 0. SAFETY: what `ws-collect` deletes (opus, xhigh, MANDATORY)

The destructive subject is this one alone (R65). Read the COLLECT region whole, plus `_ws_leaf_remove`, `_ws_leaf_checkouts`, `_ws_path_users`, `_ws_slug_free`, `_child_tmpdir` and the witness functions, at the tip, against `origin/main`.

**Re-derive at the tip:**
- **The deletion inventory.** Enumerate every deleting call `ws-collect` makes, each with its guard and its order:
  - the helper's removal of `<slot>/leaf`;
  - the `rmdir` of the slot;
  - the witness's move-aside and unlink;
  - the record's unlink;
  - the witness writer's temp files.

  Nothing else may delete. The original path `~/.cc-tmp/<id>` is never removed in place.
- **The recycled-slug proof (R67).**
  - Construct a spawn at every step boundary yourself, and confirm Task 8's cases match your outcomes.
  - Confirm the proof rests on `.child`'s direct lookup, `_ws_slug_free` with the listing control, and the move, and on no btime comparison alone.
- **Crash and resume (R66).**
  - Kill the verb after every step. Confirm that the next audit finds the record whatever the witness says, that no slot is orphaned, and that a resume removes nothing but the record's inode.
  - Confirm that a forged record or slot is never taken.
- **The restore.** It is proven by lstat, never by mv's exit code. An unproven restore keeps the record and the slot whole: never a recursive remove.
- **The checkout question across the move.**
  - The alias's conditions (1) and (2) each red under mutation.
  - The recycled-admin-name case refuses through the full verb.
- **Rule 2.** A stopped session's clone inside a dead child's leaf answers `containment-unproven`, before the move and on the pre-move spelling after it.
- **The floor and the token.**
  - Neither is asked after the move.
  - The floor reads ctime only, so a future mtime does not hold a leaf.
  - Any content, name, mode, owner or link change changes the token.
  - Each unmeasured why (timeout, unreadable, cap) refuses.
- **The bounded question for R69, R70 and X1, for BOTH verbs:**
  - no arm of `_ws_reclaim_owned`, the tail, the ladder or the settle newly reaches the pin, the settle or a removal;
  - none continues past a stop it used to make;
  - a re-mint between a reclaim audit and its spend refuses.

### 1. SECURITY (opus, high, MANDATORY)

- **The authority files.** The record, the witness and the slot are same-uid writable. Confirm the trust note in each header, and that no path is ever taken from a file body: every path derives from the id.
- **Parsing.**
  - A record's exact id parse holds for nested and dotted ids.
  - Dot-leading names are never ids.
  - The temp-file sweep's exact regex.
  - The mountinfo parse, including escaped spaces and `\012` in a mount path.
- **The move primitive.** `mv -T -n --no-copy` semantics, and its capability probe. EXDEV refuses. A copy never happens.
- **The environment.**
  - `LC_ALL=C`, and the `find` and `mv` resolution (no PATH shadowing from the caller).
  - Every git call in the checkout question, and whether it runs contained.
- **The entry.**
  - The agent grant requires `--expect`.
  - `is_protected` covers the verb and the audit argv, case-folded.
  - The entry guard and the argv validation order: the session id is validated before anything is journaled.

### 2. Derivation and wire (opus, high)

- **The token.** Its derivation, its comparison at spend, and its stability across a no-op re-audit.
- **The declarations.**
  - The new refusal words, `containment-refuted` and the `collect` act, each in `LcRefusalToken` and `LC_REFUSAL_WORD`, and in every scan that holds ccd's literals against them, in both directions.
  - `COLLECT_CAP` and the caps line.
- **X1.**
  - The generation key and token input.
  - The server tolerates the additive key under absence-permits.
  - An old-format token is handled as Task 3 rules.
- **`crumb`.** The key is printed only when set, and ws-expire's pre-breadcrumb documents omit it.
- **The runner budget and inertness.** The 240 s budget row is present. No composer exists.

### 3. Cost and platform (sonnet, high)

- **The idle walk's cost.** Measure it on the largest fixture, and one cold-cache measurement where possible.
- **The audit's cost per id.**
- **Platform.**
  - Every Darwin path answers unmeasured.
  - The `--no-copy` capability probe.
  - Each Linux-only describe skips with a reason.

---

## Deviations found

This wave's numbers come from the block the allocator issued for run 347. The coordinator assigns them at the fix round, one per departure, each defined here, singly. A departure the worker finds is named by slug in the wave-done.
